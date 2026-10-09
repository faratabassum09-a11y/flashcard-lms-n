const User      = require("../models/user");
const Test      = require("../models/test");
const Result    = require("../models/result");
const Draft     = require("../models/draft");
const Flashcard = require("../models/flashcard");
const Upload    = require("../models/upload");
const Announcement = require("../models/announcement");
const Section   = require("../models/section");
const xlsx      = require("xlsx");
const mongoose  = require("mongoose");
const PDFDocument = require("pdfkit");
const cache     = require("../utils/cache");
const userCache = require("../utils/userCache");
const { explain } = require("../utils/dbFix");
const { toStr, scaleTo, EXAM_OUT_OF } = require("../utils/scoring");
const { generateKeywords, parseKeywordList } = require("../utils/keywords");
const { sectionCounts, ensureSections, clearSectionCache, audienceOf, sectionFilter, UNASSIGNED } = require("../utils/sections");
const { isSuper, isTeacher, STUDENTS, ownTests, canManageTest, allowedSubjects } = require("../utils/roles");
const { pct, gradeFor, summarize, rankRows } = require("../utils/analytics");
const { isId, escapeRegex, safeBack, pageParam, nameOf, normSection } = require("../utils/helpers");
const { subjectCounts, buildFilter } = require("./flashcardController");
const { readRows } = require("../utils/importers");
const { filesOf } = require("../middleware/uploadFiles");

const getUsername = (row) =>
  toStr(row.username ?? row.Username ?? row.USERNAME ?? row["user name"] ?? row["User Name"]).trim();
const getPassword = (row) =>
  toStr(row.password ?? row.Password ?? row.PASSWORD ?? row.pass ?? row.PASS ?? row["user password"]).trim();

const getSection = (row) => normSection(row.section);

const NOT_ADMIN = STUDENTS;            // students only: never the admin, never teachers
const notStudent = (u) => !u || u.username === "admin" || u.role === "teacher";

// teachers may only work with their own subjects; the admin with all (allowedSubjects -> null)
const subjectOk = (req, subject) => { const a = allowedSubjects(req.user); return !a || a.includes(subject); };
// a teacher can only open/change tests they created
async function ownTest(req, id, fields = "createdBy") {
  const t = isId(String(id)) ? await Test.findById(id).select(fields).lean() : null;
  return t && canManageTest(req.user, t) ? t : null;
}
const denied = (req, res, back = "/tests") => { req.flash("error", "You can only manage tests you created"); return res.redirect(back); };
const NO_KEYWORDS = { $or: [{ keywords: { $exists: false } }, { keywords: { $size: 0 } }] };

// ───────────────────────── Manage hub (create test, upload students, announcements) ─────────────────────────
module.exports.getAdmin = async (req, res) => {
  const allowed = allowedSubjects(req.user);                      // null for the admin
  const cardFilter = allowed ? { subject: { $in: allowed } } : {};
  const [cards, allSubjects, announcements, studentCount, sections] = await Promise.all([
    Flashcard.find(cardFilter).select("subject question").sort({ subject: 1, _id: 1 }).lean(),
    subjectCounts(),
    isSuper(req.user) ? Announcement.find({}).sort({ pinned: -1, createdAt: -1 }).limit(20).lean() : [],
    User.countDocuments(NOT_ADMIN),
    sectionCounts()
  ]);
  const subjects = allowed ? allowed.map(n => ({ subject: n, count: (allSubjects.find(x => x.subject === n) || {}).count || 0 })) : allSubjects;
  // compact JSON for the client-side question picker (much faster than server-rendering thousands of rows)
  const pool = cards.map(c => ({ id: String(c._id), s: c.subject, q: c.question }));
  res.render("users/admin", { title: isSuper(req.user) ? "Manage" : "Create a test", pool, subjects, announcements, studentCount, sections });
};

// ───────────────────────── Students ─────────────────────────
module.exports.uploadUsers = async (req, res) => {
  try {
    const files = filesOf(req);
    if (!files.length) { req.flash("error", "No file uploaded"); return res.redirect("/admin/students"); }

    let created = 0, skipped = 0, okFiles = 0;
    const problems = [];
    const defaultSection = normSection(req.body.section);          // optional: put every student of these files in this section
    for (const file of files) {
      try {
        const data = await readRows(file, "users");
        const wanted = data.map(getUsername).filter(Boolean);
        // one query for all existing usernames instead of one per row
        const existing = new Set((await User.find({ username: { $in: wanted } }).select("username").lean()).map(u => u.username));
        existing.add("admin");

        const todo = [];
        for (const row of data) {
          const username = getUsername(row), password = getPassword(row);
          if (!username || !password || /\s/.test(username) || username.length > 40 || existing.has(username)) { skipped++; continue; }
          existing.add(username);          // also protects against duplicates inside the same file
          todo.push({ username, password, section: getSection(row) || defaultSection });
        }
        const made = [];
        for (let i = 0; i < todo.length; i += 24) {           // 24 accounts at a time (fast hashing runs on the thread pool)
          await Promise.all(todo.slice(i, i + 24).map(async (t) => {
            try { await User.registerFast({ username: t.username, section: t.section || undefined }, t.password); made.push({ username: t.username, section: t.section || "", password: "••••••" }); }
            catch (e) { skipped++; if (e.name !== "UserExistsError") { if (!problems.length) console.error("uploadUsers: could not create", t.username, "-", e.message); if (problems.length < 3) problems.push(`${t.username}: ${explain(e)}`); } }
          }));
        }
        await ensureSections(made.map(m => m.section));
        created += made.length; okFiles++;
        // The record keeps only the accounts this file really created, so deleting the upload can never remove older accounts.
        // Passwords are never stored.
        await Upload.create({ filename: file.originalname, type: "users", rows: made });
      } catch (e) {
        problems.push(`${file.originalname}: ${e.message}`);
      }
    }

    cache.clearBoards();
    if (okFiles) req.flash("success", `Students created: ${created}, skipped: ${skipped} (already existing or missing username/password) from ${okFiles} file${okFiles === 1 ? "" : "s"}`);
    if (problems.length) req.flash("error", "Not imported - " + problems.slice(0, 4).join(" | ") + (problems.length > 4 ? ` (+${problems.length - 4} more)` : ""));
    res.redirect("/admin/students");
  } catch (err) {
    console.error("uploadUsers error:", err);
    req.flash("error", err.message);
    res.redirect("/admin/students");
  }
};

module.exports.addStudent = async (req, res) => {
  const username = toStr(req.body.username).trim();
  const password = toStr(req.body.password);
  if (!username || /\s/.test(username) || username.length > 40) { req.flash("error", "Enter a roll number / username without spaces"); return res.redirect("/admin/students"); }
  if (username.toLowerCase() === "admin") { req.flash("error", "That username is reserved"); return res.redirect("/admin/students"); }
  if (password.length < 6) { req.flash("error", "Password must be at least 6 characters"); return res.redirect("/admin/students"); }
  try {
    const section = normSection(req.body.section);
    await User.registerFast({ username, section: section || undefined }, password);
    await ensureSections([section]);
    req.flash("success", `Student ${username} added${section ? " to section " + section : ""}`);
  } catch (e) {
    if (e.name !== "UserExistsError") console.error("addStudent failed:", e);
    req.flash("error", e.name === "UserExistsError" ? "That username already exists" : "Could not add student: " + explain(e));
  }
  res.redirect("/admin/students");
};

module.exports.getStudents = async (req, res) => {
  const PAGE = 30;
  const q = toStr(req.query.q).trim().slice(0, 40);
  const section = toStr(req.query.section) === UNASSIGNED ? UNASSIGNED : normSection(req.query.section);
  const page = pageParam(req.query.page);
  const conds = [NOT_ADMIN];
  if (q) { const rx = new RegExp(escapeRegex(q), "i"); conds.push({ $or: [{ username: rx }, { displayName: rx }] }); }
  const sf = sectionFilter(section); if (sf) conds.push(sf);
  const filter = { $and: conds };

  const [total, grand, users, testCount, sections] = await Promise.all([
    User.countDocuments(filter),
    User.countDocuments(NOT_ADMIN),
    User.find(filter).select("username displayName section createdAt").sort({ section: 1, username: 1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
    Test.estimatedDocumentCount(),
    sectionCounts()
  ]);
  const stats = await Result.aggregate([
    { $match: { userId: { $in: users.map(u => u._id) } } },
    { $group: { _id: "$userId", score: { $sum: "$score" }, total: { $sum: "$total" }, tests: { $sum: 1 } } }
  ]);
  const byUser = new Map(stats.map(s => [String(s._id), s]));
  users.forEach(u => {
    const s = byUser.get(String(u._id));
    u.tests = s ? s.tests : 0;
    u.avg = s ? pct(s.score, s.total) : null;
    u.avg20 = s ? scaleTo(s.score, s.total, EXAM_OUT_OF) : null;
  });
  res.render("adminStudents", { title: "Students", users, q, section, sections, page, pages: Math.max(1, Math.ceil(total / PAGE)), total, grand, testCount });
};

// Move several students (ticked on the Students page) into a section, or clear their section.
module.exports.assignSection = async (req, res) => {
  const back = safeBack(req.body.back, "/admin/students");
  let ids = req.body.ids; if (!Array.isArray(ids)) ids = ids ? [ids] : [];
  ids = ids.filter(isId).slice(0, 2000);
  const section = normSection(req.body.section);
  if (!ids.length) { req.flash("error", "Tick at least one student first"); return res.redirect(back); }
  const r = await User.updateMany({ _id: { $in: ids }, ...NOT_ADMIN }, section ? { $set: { section } } : { $unset: { section: 1 } });
  await ensureSections([section]);
  cache.clearBoards();
  req.flash("success", section ? `${r.modifiedCount ?? ids.length} student(s) moved to section ${section}` : `Section cleared for ${r.modifiedCount ?? ids.length} student(s)`);
  res.redirect(back);
};

module.exports.setStudentSection = async (req, res) => {
  const back = isId(req.params.id) ? "/admin/students/" + req.params.id : "/admin/students";
  const section = normSection(req.body.section);
  const user = isId(req.params.id) ? await User.findById(req.params.id).select("username role") : null;
  if (notStudent(user)) { req.flash("error", "Student not found"); return res.redirect("/admin/students"); }
  await User.updateOne({ _id: user._id }, section ? { $set: { section } } : { $unset: { section: 1 } });
  await ensureSections([section]);
  cache.clearBoards();
  req.flash("success", section ? `${user.username} is now in section ${section}` : `Section cleared for ${user.username}`);
  res.redirect(back);
};

module.exports.getStudent = async (req, res) => {
  const user = isId(req.params.id) ? await User.findById(req.params.id).select("username displayName section role createdAt known bookmarks").lean() : null;
  if (notStudent(user)) { req.flash("error", "Student not found"); return res.redirect("/admin/students"); }
  const [results, sections] = await Promise.all([
    Result.find({ userId: user._id }).select("testId score total submittedAt").populate("testId", "name subject").sort({ submittedAt: -1 }).lean(),
    sectionCounts()
  ]);
  let s = 0, t = 0; results.forEach(r => { s += r.score || 0; t += r.total || 0; });
  results.forEach(r => {
    r.percent = pct(r.score, r.total); r.grade = gradeFor(r.percent);
    r.written = scaleTo(r.score, r.total, EXAM_OUT_OF);
  });
  res.render("adminStudent", { title: user.username, student: user, results, sections, avg: pct(s, t), avg20: scaleTo(s, t, EXAM_OUT_OF), mastered: (user.known || []).length });
};

module.exports.resetPassword = async (req, res) => {
  const back = isId(req.params.id) ? "/admin/students/" + req.params.id : "/admin/students";
  const pw = toStr(req.body.newPassword);
  if (pw.length < 6) { req.flash("error", "Password must be at least 6 characters"); return res.redirect(back); }
  const user = isId(req.params.id) ? await User.findById(req.params.id) : null;
  if (notStudent(user)) { req.flash("error", "Student not found"); return res.redirect("/admin/students"); }
  await user.setPasswordFast(pw);
  await user.save();
  req.flash("success", `Password reset for ${user.username}`);
  res.redirect(back);
};

module.exports.deleteStudent = async (req, res) => {
  const user = isId(req.params.id) ? await User.findById(req.params.id).select("username role").lean() : null;
  if (notStudent(user)) { req.flash("error", "Student not found"); return res.redirect("/admin/students"); }
  await Result.deleteMany({ userId: user._id });
  await User.deleteOne({ _id: user._id }); clearSectionCache(); userCache.clear();
  cache.clearBoards();
  req.flash("success", `Student ${user.username} and their results were deleted`);
  res.redirect("/admin/students");
};

// ───────────────────────── Sections (create the option first, fill it later) ─────────────────────────
module.exports.createSection = async (req, res) => {
  const back = safeBack(req.body.back, "/admin/students");
  const names = [...new Set(toStr(req.body.names ?? req.body.name).split(/[,\n;]/).map(normSection).filter(Boolean))];
  if (!names.length) { req.flash("error", "Type a section name, e.g. A or CSE-B"); return res.redirect(back); }
  await ensureSections(names);
  req.flash("success", names.length === 1 ? `Section ${names[0]} created — choose it from the Section list` : `Sections created: ${names.join(", ")}`);
  res.redirect(names.length === 1 ? "/admin/students?section=" + encodeURIComponent(names[0]) : back);
};

module.exports.deleteSection = async (req, res) => {
  const name = normSection(req.body.section);
  const n = name ? await User.countDocuments({ ...NOT_ADMIN, section: name }) : 0;
  if (!name) req.flash("error", "Section not found");
  else if (n) req.flash("error", `Section ${name} still has ${n} student${n === 1 ? "" : "s"}. Move them to another section first.`);
  else { await Section.deleteOne({ name }); req.flash("success", `Section ${name} deleted`); }
  res.redirect("/admin/students");
};

// ───────────────────────── Teachers ─────────────────────────
const TEACHER = { role: "teacher", username: { $ne: "admin" } };
const subjectsFromBody = (b) => {
  const picked = Array.isArray(b.subjects) ? b.subjects : b.subjects ? [b.subjects] : [];
  const typed = toStr(b.newSubjects).split(/[,;\n]/);
  return [...new Set([...picked, ...typed].map(x => toStr(x).trim().slice(0, 80)).filter(Boolean))].slice(0, 40);
};

module.exports.getTeachers = async (req, res) => {
  const [teachers, subjects, counts] = await Promise.all([
    User.find(TEACHER).select("username displayName subjects createdAt").sort({ username: 1 }).lean(),
    subjectCounts(),
    Test.aggregate([{ $match: { createdBy: { $ne: null } } }, { $group: { _id: "$createdBy", n: { $sum: 1 } } }])
  ]);
  const byT = new Map(counts.map(c => [String(c._id), c.n]));
  teachers.forEach(t => { t.tests = byT.get(String(t._id)) || 0; });
  res.render("adminTeachers", { title: "Teachers", teachers, subjects });
};

module.exports.createTeacher = async (req, res) => {
  const username = toStr(req.body.username).trim();
  const password = toStr(req.body.password);
  const displayName = toStr(req.body.displayName).replace(/\s+/g, " ").trim().slice(0, 40);
  if (!username || /\s/.test(username) || username.length > 40) { req.flash("error", "Enter a username without spaces (e.g. t.sharma)"); return res.redirect("/admin/teachers"); }
  if (username.toLowerCase() === "admin") { req.flash("error", "That username is reserved"); return res.redirect("/admin/teachers"); }
  if (password.length < 6) { req.flash("error", "Password must be at least 6 characters"); return res.redirect("/admin/teachers"); }
  const subjects = subjectsFromBody(req.body);
  try {
    await User.registerFast({ username, displayName: displayName || undefined, role: "teacher", subjects }, password);
    req.flash("success", `Teacher ${username} created${subjects.length ? " for " + subjects.join(", ") : " — now give them at least one subject"}. They sign in on the normal login page.`);
  } catch (e) {
    if (e.name !== "UserExistsError") console.error("createTeacher failed:", e);
    req.flash("error", e.name === "UserExistsError" ? "That username already exists" : "Could not create the teacher: " + explain(e));
  }
  res.redirect("/admin/teachers");
};

module.exports.updateTeacher = async (req, res) => {
  const t = isId(req.params.id) ? await User.findOne({ _id: req.params.id, ...TEACHER }).select("username") : null;
  if (!t) { req.flash("error", "Teacher not found"); return res.redirect("/admin/teachers"); }
  const displayName = toStr(req.body.displayName).replace(/\s+/g, " ").trim().slice(0, 40);
  userCache.clear();
  await User.updateOne({ _id: t._id }, { subjects: subjectsFromBody(req.body), ...(displayName ? { displayName } : { $unset: { displayName: 1 } }) });
  req.flash("success", `Teacher ${t.username} updated`);
  res.redirect("/admin/teachers");
};

module.exports.resetTeacherPassword = async (req, res) => {
  const pw = toStr(req.body.newPassword);
  const t = isId(req.params.id) ? await User.findOne({ _id: req.params.id, ...TEACHER }) : null;
  if (!t) { req.flash("error", "Teacher not found"); return res.redirect("/admin/teachers"); }
  if (pw.length < 6) { req.flash("error", "Password must be at least 6 characters"); return res.redirect("/admin/teachers"); }
  await t.setPasswordFast(pw); await t.save();
  req.flash("success", `Password reset for ${t.username}`);
  res.redirect("/admin/teachers");
};

module.exports.deleteTeacher = async (req, res) => {
  const t = isId(req.params.id) ? await User.findOne({ _id: req.params.id, ...TEACHER }).select("username").lean() : null;
  if (!t) { req.flash("error", "Teacher not found"); return res.redirect("/admin/teachers"); }
  await User.deleteOne({ _id: t._id }); userCache.clear();
  req.flash("success", `Teacher ${t.username} removed. Their tests and results are kept (you can still see them).`);
  res.redirect("/admin/teachers");
};

// ───────────────────────── Flashcard manager ─────────────────────────
module.exports.getAdminFlashcards = async (req, res) => {
  const PAGE = 25;
  const page = pageParam(req.query.page);
  const allowed = allowedSubjects(req.user);                     // null for the admin
  const filter = buildFilter(req.query, null);
  if (allowed) filter.subject = filter.subject && allowed.includes(filter.subject) ? filter.subject : { $in: allowed };
  const missingFilter = allowed ? { $and: [NO_KEYWORDS, { subject: { $in: allowed } }] } : NO_KEYWORDS;
  const [allSubjects, total, cards, uploads, missing] = await Promise.all([
    subjectCounts(),
    Flashcard.countDocuments(filter),
    Flashcard.find(filter).select("subject question answer keywords").sort({ subject: 1, _id: 1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
    isSuper(req.user) ? Upload.find({ type: "flashcards" }).select("filename subject uploadedAt").sort({ uploadedAt: -1 }).limit(5).lean() : [],
    Flashcard.countDocuments(missingFilter)
  ]);
  const subjects = allowed ? allSubjects.filter(x => allowed.includes(x.subject)) : allSubjects;
  const wanted = toStr(req.query.subject).trim();
  res.render("adminFlashcards", {
    title: "Flashcards", subjects, cards, uploads, missing, total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
    q: toStr(req.query.q).trim().slice(0, 60), subject: subjects.some(x => x.subject === wanted) ? wanted : "all",
    totalCards: subjects.reduce((a, x) => a + x.count, 0),
    mySubjects: allowed
  });
};

const cardFromBody = (b) => {
  const subject = toStr(b.subject).trim().slice(0, 80);
  const question = toStr(b.question).trim().slice(0, 2000);
  const answer = toStr(b.answer).trim().slice(0, 4000);
  // Teachers may type keywords, but they never have to: when the box is empty they are generated from the answer.
  const typed = parseKeywordList(b.keywords);
  const keywords = typed.length ? typed : generateKeywords(answer);
  return { subject, question, answer, keywords };
};

module.exports.createFlashcard = async (req, res) => {
  const c = cardFromBody(req.body);
  if (!c.subject || !c.question || !c.answer) { req.flash("error", "Subject, question and answer are all required"); return res.redirect("/admin/flashcards"); }
  if (!subjectOk(req, c.subject)) { req.flash("error", "You can only add cards to your own subjects (" + (req.user.subjects || []).join(", ") + ")"); return res.redirect("/admin/flashcards"); }
  await Flashcard.create(c);
  cache.subjects.clear();
  req.flash("success", "Flashcard added");
  res.redirect(safeBack(req.body.back, "/admin/flashcards"));
};

module.exports.updateFlashcard = async (req, res) => {
  const back = safeBack(req.body.back, "/admin/flashcards");
  const c = cardFromBody(req.body);
  if (!isId(req.params.id) || !c.subject || !c.question || !c.answer) { req.flash("error", "Subject, question and answer are all required"); return res.redirect(back); }
  if (!subjectOk(req, c.subject)) { req.flash("error", "You can only use your own subjects"); return res.redirect(back); }
  const a = allowedSubjects(req.user);
  await Flashcard.updateOne(a ? { _id: req.params.id, subject: { $in: a } } : { _id: req.params.id }, c);
  cache.subjects.clear();
  req.flash("success", "Flashcard updated");
  res.redirect(back);
};

// Live preview for the add/edit dialog ("Generate" button): returns the keywords the system would create.
module.exports.previewKeywords = (req, res) => {
  res.json({ keywords: generateKeywords(toStr(req.body && req.body.answer).slice(0, 4000)) });
};

// One click: generate keywords for every card that has none (mode "missing"), or rebuild all of them (mode "all").
// Optional subject limits the work to that subject.
module.exports.autoKeywords = async (req, res) => {
  const back = safeBack(req.body.back, "/admin/flashcards");
  const all = req.body.mode === "all";
  const subject = toStr(req.body.subject).trim();
  const filter = {};
  const a = allowedSubjects(req.user);
  if (subject && subject !== "all") filter.subject = a && !a.includes(subject) ? "\u0000" : subject;
  else if (a) filter.subject = { $in: a };
  if (!all) Object.assign(filter, NO_KEYWORDS);
  let n = 0, batch = [];
  const cursor = Flashcard.find(filter).select("answer").lean().cursor();
  for await (const c of cursor) {
    batch.push({ updateOne: { filter: { _id: c._id }, update: { $set: { keywords: generateKeywords(c.answer) } } } });
    n++;
    if (batch.length >= 500) { await Flashcard.bulkWrite(batch, { ordered: false }); batch = []; }
  }
  if (batch.length) await Flashcard.bulkWrite(batch, { ordered: false });
  req.flash("success", n ? `Keywords generated automatically for ${n} flashcard${n === 1 ? "" : "s"}` : "Every flashcard already has keywords");
  res.redirect(back);
};

module.exports.deleteFlashcard = async (req, res) => {
  if (isId(req.params.id)) { const a = allowedSubjects(req.user); await Flashcard.deleteOne(a ? { _id: req.params.id, subject: { $in: a } } : { _id: req.params.id }); cache.subjects.clear(); req.flash("success", "Flashcard deleted"); }
  res.redirect(safeBack(req.body.back || req.query.back, "/admin/flashcards"));
};

module.exports.deleteSubject = async (req, res) => {
  const subject = toStr(req.body.subject).trim();
  if (subject) {
    const r = await Flashcard.deleteMany({ subject });
    cache.subjects.clear();
    req.flash("success", `Deleted ${r.deletedCount || 0} flashcards from “${subject}”`);
  }
  res.redirect("/admin/flashcards");
};

// ───────────────────────── Upload history ─────────────────────────
module.exports.getUploads = async (req, res) => {
  const [userUploads, flashcardUploads] = await Promise.all([
    Upload.find({ type: "users"      }).sort({ uploadedAt: -1 }).lean(),   // views show rows.length
    Upload.find({ type: "flashcards" }).sort({ uploadedAt: -1 }).lean()
  ]);
  res.render("adminUploads", { title: "Uploads", userUploads, flashcardUploads });
};

module.exports.viewUpload = async (req, res) => {
  const uploadDoc = isId(req.params.id) ? await Upload.findById(req.params.id).lean() : null;
  if (!uploadDoc) { req.flash("error", "Upload not found"); return res.redirect("/admin/uploads"); }
  const rows = Array.isArray(uploadDoc.rows) ? uploadDoc.rows : [];
  const columns = [...new Set(rows.slice(0, 200).flatMap(r => Object.keys(r || {})))].slice(0, 12);
  res.render("adminUploadView", { title: uploadDoc.filename, uploadDoc, rows: rows.slice(0, 500), columns, totalRows: rows.length });
};

module.exports.deleteUpload = async (req, res) => {
  try {
    const uploadDoc = isId(req.params.id) ? await Upload.findById(req.params.id) : null;
    if (!uploadDoc) { req.flash("error", "Upload record not found"); return res.redirect("/admin/uploads"); }

    if (uploadDoc.type === "users") {
      const usernames = uploadDoc.rows.map(getUsername).filter(u => u && u !== "admin");   // never delete the admin
      const users = await User.find({ username: { $in: usernames } }).select("_id").lean();
      const ids = users.map(u => u._id);
      await Result.deleteMany({ userId: { $in: ids } });
      const r = await User.deleteMany({ _id: { $in: ids } });
      req.flash("success", `Upload deleted. ${r.deletedCount || 0} user(s) removed.`);
    } else if (uploadDoc.type === "flashcards") {
      // cards created by this upload (new uploads are tagged); fall back to subject+question for old uploads
      let removed = (await Flashcard.deleteMany({ uploadId: uploadDoc._id })).deletedCount || 0;
      if (removed === 0) {
        for (const row of uploadDoc.rows) {
          const question = toStr(row.question ?? row.Question ?? row.QUESTION).trim();
          if (!question) continue;
          const filter = { question, uploadId: { $exists: false } };
          if (uploadDoc.subject) filter.subject = uploadDoc.subject;
          removed += (await Flashcard.deleteMany(filter)).deletedCount || 0;
        }
      }
      cache.subjects.clear();
      req.flash("success", `Upload deleted. ${removed} flashcard(s) removed.`);
    }

    cache.clearBoards();
    await Upload.findByIdAndDelete(uploadDoc._id);
    res.redirect("/admin/uploads");
  } catch (err) {
    console.error("deleteUpload error:", err);
    req.flash("error", err.message);
    res.redirect("/admin/uploads");
  }
};

// ───────────────────────── Results & analytics ─────────────────────────
module.exports.getResults = async (req, res) => {
  const [tests, groups, counts] = await Promise.all([
    Test.find(ownTests(req.user)).select("name subject duration isActive isEnded startTime scheduledStart sections createdByName").sort({ scheduledStart: -1, _id: -1 }).lean(),
    Result.aggregate([{ $group: { _id: "$testId", n: { $sum: 1 }, score: { $sum: "$score" }, total: { $sum: "$total" } } }]),
    sectionCounts()
  ]);
  const byTest = new Map(groups.map(g => [String(g._id), g]));
  tests.forEach(t => {
    const g = byTest.get(String(t._id));
    t.attempted = g ? g.n : 0;
    t.avg = g ? pct(g.score, g.total) : null;
    t.avg20 = g ? scaleTo(g.score, g.total, EXAM_OUT_OF) : null;
    t.audience = audienceOf(t, counts);
    t.participation = t.audience ? Math.min(100, Math.round((t.attempted / t.audience) * 100)) : 0;
  });
  res.render("adminResults", { title: "Results", tests, totalStudents: counts.total });
};

// Everything the results page / CSV / PDF need. `section` ("" = all, "__none", or a section name) narrows the student list.
async function loadTestReport(testId, section = "") {
  const test = await Test.findById(testId).lean();
  if (!test) return null;
  const secs = test.sections || [];
  const scope = [NOT_ADMIN];
  if (secs.length) scope.push({ section: { $in: secs } });            // a test for sections A and B only lists those students
  const [users, results] = await Promise.all([
    User.find({ $and: scope }).select("username displayName section").sort({ username: 1 }).lean(),
    Result.find({ testId: test._id }).select("userId score total submittedAt").lean()
  ]);
  const byUser = new Map(results.map(r => [String(r.userId), r]));
  let rows = users.map(u => {
    const r = byUser.get(String(u._id));
    const percent = r ? pct(r.score, r.total) : null;
    const written = r ? scaleTo(r.score, r.total, EXAM_OUT_OF) : null;
    return { userId: String(u._id), username: u.username, name: u.displayName || "", section: u.section || "", attempted: !!r,
             score: r ? r.score : null, total: r ? r.total : null, written,
             percent, grade: r ? gradeFor(percent) : null, submittedAt: r ? r.submittedAt : null };
  });

  // per-section overview (always for the whole test, so the tabs stay stable)
  const secMap = new Map();
  rows.forEach(r => {
    const k = r.section || "";
    if (!secMap.has(k)) secMap.set(k, { section: k, students: 0, submitted: 0, sum: 0, high: null });
    const g = secMap.get(k); g.students++;
    if (r.attempted) { g.submitted++; g.sum += r.written; g.high = g.high === null ? r.written : Math.max(g.high, r.written); }
  });
  const sectionStats = [...secMap.values()].map(g => ({ section: g.section, students: g.students, submitted: g.submitted,
    avg: g.submitted ? Math.round((g.sum / g.submitted) * 10) / 10 : null, high: g.high }))
    .sort((a, b) => (a.section ? 0 : 1) - (b.section ? 0 : 1) || a.section.localeCompare(b.section, undefined, { numeric: true }));

  if (section === UNASSIGNED) rows = rows.filter(r => !r.section);
  else if (section) rows = rows.filter(r => r.section === section);

  const ranked = rankRows(rows.filter(r => r.attempted).map(r => ({ ...r, key: r.userId })));
  const rankOf = new Map(ranked.map(r => [r.userId, r.rank]));
  rows.forEach(r => { r.rank = rankOf.get(r.userId) || null; });
  return { test, rows, section, sectionStats, summary: summarize(rows.filter(r => r.attempted).map(r => r.percent)) };
}

// loads the report only if this person may see the test (admin: all; teacher: their own)
async function reportFor(req, section) {
  if (!isId(req.params.testId)) return null;
  const r = await loadTestReport(req.params.testId, section);
  return r && canManageTest(req.user, r.test) ? r : null;
}

const sectionParam = (v) => (toStr(v) === UNASSIGNED ? UNASSIGNED : normSection(v));

module.exports.getTestResults = async (req, res) => {
  const report = await reportFor(req, sectionParam(req.query.section));
  if (!report) { req.flash("error", "Test not found"); return res.redirect("/admin/results"); }

  // per-question difficulty (only for results saved after this update, which store answers)
  const qa = await Result.aggregate([
    { $match: { testId: report.test._id } }, { $unwind: "$answers" },
    { $group: { _id: "$answers.q", avg: { $avg: "$answers.p" }, n: { $sum: 1 },
                full: { $sum: { $cond: [{ $gte: ["$answers.m", "$answers.t"] }, 1, 0] } } } }
  ]);
  const cards = await Flashcard.find({ _id: { $in: qa.map(x => x._id) } }).select("question").lean();
  const text = new Map(cards.map(c => [String(c._id), c.question]));
  const questions = qa.filter(x => text.has(String(x._id))).map(x => ({
    question: text.get(String(x._id)), avg: Math.round(x.avg), full: x.full, n: x.n, fullPct: Math.round((x.full / x.n) * 100)
  })).sort((a, b) => a.avg - b.avg);

  res.render("adminTestResults", { title: report.test.name, ...report, questions, examMax: EXAM_OUT_OF });
};

const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // block spreadsheet formula injection
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

module.exports.downloadResultCSV = async (req, res) => {
  const section = sectionParam(req.query.section);
  const report = await reportFor(req, section);
  if (!report) return res.status(404).send("Test not found");
  const head = ["Rank", "Roll no / username", "Display name", "Section", "Status", `Marks (out of ${EXAM_OUT_OF})`, "Percent", "Grade", "Raw score", "Raw total", "Submitted at"];
  const lines = [head.map(csvCell).join(",")];
  [...report.rows].sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }) || (a.rank || 1e9) - (b.rank || 1e9) || a.username.localeCompare(b.username)).forEach(r => {
    lines.push([r.rank || "", r.username, r.name, r.section, r.attempted ? "Submitted" : "Not attempted", r.written ?? "",
      r.percent ?? "", r.grade ? r.grade.letter : "", r.score ?? "", r.total ?? "", r.submittedAt ? new Date(r.submittedAt).toISOString() : ""].map(csvCell).join(","));
  });
  const tag = section ? "-" + (section === UNASSIGNED ? "no-section" : section) : "";
  const safeName = (String(report.test.name || "test") + tag).replace(/[^\w.-]+/g, "_").slice(0, 80) || "test";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}-results.csv"`);
  res.send("\ufeff" + lines.join("\r\n"));
};

module.exports.resetAttempt = async (req, res) => {
  const { testId, userId } = req.params;
  if (isId(testId) && isId(userId)) {
    if (!(await ownTest(req, testId))) return denied(req, res, "/admin/results");
    const r = await Result.deleteOne({ testId, userId });
    await Draft.deleteOne({ testId, userId });
    cache.clearBoards();
    req.flash(r.deletedCount ? "success" : "error", r.deletedCount ? "Attempt cleared — the student can take the test again while it is live" : "No attempt found");
  }
  res.redirect(safeBack(req.body.back, isId(testId) ? "/admin/results/" + testId : "/admin/results"));
};

module.exports.downloadResultPDF = async (req, res) => {
  try {
    if (!isId(req.params.testId)) return res.status(404).send("Test not found");
    const section = sectionParam(req.query.section);
    const report = await reportFor(req, section);
    if (!report) return res.status(404).send("Test not found");
    const { test } = report;
    const rows = [...report.rows].sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }) || a.username.localeCompare(b.username));

    const tag = section ? "-" + (section === UNASSIGNED ? "no-section" : section) : "";
    const safeName = (String(test.name || "test") + tag).replace(/[^\w.-]+/g, "_").slice(0, 80) || "test";
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-results.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).text("TEST RESULT REPORT", { align: "center" });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Test Name : ${test.name}`);
    doc.text(`Subject   : ${test.subject || "-"}`);
    doc.text(`Duration  : ${test.duration} Minutes`);
    doc.text(`Section   : ${section ? (section === UNASSIGNED ? "Not assigned" : section) : (test.sections && test.sections.length ? test.sections.join(", ") : "All sections")}`);
    doc.text(`Marks     : out of ${EXAM_OUT_OF}`);
    doc.moveDown(1.5);

    // column boundaries (x) - A4 with 40pt margins
    const X = [40, 75, 250, 320, 400, 470, 560];
    const label = ["No", "Student", "Section", `Marks/${EXAM_OUT_OF}`, "%", "Status"];
    const line = (y, cells, bold) => {
      doc.rect(40, y, 520, 24).stroke();
      X.slice(1, -1).forEach(x => doc.moveTo(x, y).lineTo(x, y + 24).stroke());
      doc.fontSize(bold ? 10 : 10);
      cells.forEach((c, i) => doc.text(String(c), X[i] + 4, y + 7, { width: X[i + 1] - X[i] - 8, lineBreak: false }));
    };
    let y = doc.y; line(y, label, true); y += 24;
    rows.forEach((r, i) => {
      if (y > 760) { doc.addPage(); y = 50; line(y, label, true); y += 24; }
      line(y, [i + 1, r.username, r.section || "-", r.written ?? "", r.percent === null ? "" : Math.round(r.percent) + "%", r.attempted ? "Submitted" : "NA"]);
      y += 24;
    });
    doc.end();
  } catch (err) {
    console.error("PDF error:", err);
    if (!res.headersSent) res.status(500).send("Could not generate PDF");
  }
};

// ───────────────────────── Test controls ─────────────────────────
module.exports.startTest = async (req, res) => {
  if (isId(req.params.id)) {
    if (!(await ownTest(req, req.params.id))) return denied(req, res);
    await Test.findByIdAndUpdate(req.params.id, { isActive: true, isEnded: false, startTime: new Date() });
    cache.clearExam();
    req.flash("success", "Test started — students can open it now");
  }
  res.redirect(safeBack(req.body.back, "/tests"));
};

module.exports.endTest = async (req, res) => {
  if (isId(req.params.id)) {
    if (!(await ownTest(req, req.params.id))) return denied(req, res);
    await Test.findByIdAndUpdate(req.params.id, { isActive: false, isEnded: true });
    cache.clearExam(); cache.clearBoards();
    req.flash("success", "Test ended — results and review are now visible to students");
  }
  res.redirect(safeBack(req.body.back, "/tests"));
};

module.exports.deleteTest = async (req, res) => {
  if (isId(req.params.id)) {
    if (!(await ownTest(req, req.params.id))) return denied(req, res);
    await Test.findByIdAndDelete(req.params.id);
    await Result.deleteMany({ testId: req.params.id });
    await Draft.deleteMany({ testId: req.params.id });
    cache.clearExam(); cache.clearBoards();
    req.flash("success", "Test deleted");
  }
  res.redirect("/tests");
};

module.exports.duplicateTest = async (req, res) => {
  const t = isId(req.params.id) ? await Test.findById(req.params.id).lean() : null;
  if (!t) { req.flash("error", "Test not found"); return res.redirect("/tests"); }
  if (!canManageTest(req.user, t)) return denied(req, res);
  await Test.create({
    createdBy: req.user._id, createdByName: req.user.displayName || req.user.username,
    name: (t.name || "Test") + " (copy)", subject: t.subject, description: t.description, duration: t.duration,
    questions: t.questions.map(q => ({ questionId: q.questionId, marks: q.marks })), sections: t.sections || [],
    allowCheck: !!t.allowCheck, showReview: t.showReview !== false
  });
  req.flash("success", "Test duplicated — it is not started yet");
  res.redirect("/tests");
};

// ───────────────────────── Announcements ─────────────────────────
module.exports.createAnnouncement = async (req, res) => {
  const title = toStr(req.body.title).trim().slice(0, 120);
  if (!title) { req.flash("error", "Give the announcement a title"); return res.redirect("/admin#announcements"); }
  await Announcement.create({ title, body: toStr(req.body.body).trim().slice(0, 1000), pinned: req.body.pinned === "on" });
  req.flash("success", "Announcement posted — students see it on their dashboard");
  res.redirect("/admin#announcements");
};

module.exports.deleteAnnouncement = async (req, res) => {
  if (isId(req.params.id)) await Announcement.deleteOne({ _id: req.params.id });
  req.flash("success", "Announcement removed");
  res.redirect("/admin#announcements");
};

// ───────────────────────── Excel templates ─────────────────────────
module.exports.downloadTemplate = (req, res) => {
  const kind = req.params.kind;
  const rows = kind === "users"
    ? [{ username: "21A91A0501", password: "ChangeMe@123", section: "A" }, { username: "21A91A0502", password: "ChangeMe@124", section: "B" }]
    : [{ question: "What is photosynthesis?", answer: "Plants make food using sunlight, water and carbon dioxide", keywords: "sunlight, water, carbon dioxide" },
       { question: "Powerhouse of the cell?", answer: "Mitochondria", keywords: "" }];
  if (!["users", "flashcards"].includes(kind)) return res.status(404).send("Unknown template");
  if (kind === "users" && !isSuper(req.user)) return res.status(403).send("Only the administrator can use the students template");
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), "Sheet1");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${kind}-template.xlsx"`);
  res.send(xlsx.write(wb, { type: "buffer", bookType: "xlsx" }));
};
