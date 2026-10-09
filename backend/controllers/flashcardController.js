const mongoose  = require("mongoose");
const Flashcard = require("../models/flashcard");
const Upload    = require("../models/upload");
const User      = require("../models/user");
const Test      = require("../models/test");
const xlsx      = require("xlsx");
const cache     = require("../utils/cache");
const { toStr, matchPercent } = require("../utils/scoring");
const { generateKeywords, parseKeywordList } = require("../utils/keywords");
const { allowedSubjects } = require("../utils/roles");
const { isId, escapeRegex, pageParam } = require("../utils/helpers");
const { getTestLean } = require("../utils/examData");

const PAGE_SIZE = 24;


// Subject -> card count (cached 60 s; refreshed after any upload/delete)
async function subjectCounts() {
  const hit = cache.subjects.get("counts");
  if (hit) return hit;
  const rows = await Flashcard.aggregate([{ $group: { _id: "$subject", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
  return cache.subjects.set("counts", rows.map(r => ({ subject: r._id, count: r.n })));
}
module.exports.subjectCounts = subjectCounts;

// Builds the Mongo filter shared by the browse page, the study mode and the admin manager.
function buildFilter(query, me) {
  const f = {};
  const subject = toStr(query.subject).trim();
  if (subject && subject !== "all") f.subject = subject;
  const q = toStr(query.q).trim().slice(0, 60);
  if (q) { const rx = new RegExp(escapeRegex(q), "i"); f.$or = [{ question: rx }, { answer: rx }]; }
  if (me) {
    const known = me.known || [], marked = me.bookmarks || [];
    if (query.filter === "mastered")   f._id = { $in: known };
    if (query.filter === "learning")   f._id = { $nin: known };
    if (query.filter === "bookmarked") f._id = { $in: marked };
  }
  return f;
}
module.exports.buildFilter = buildFilter;

module.exports.getFlashcards = async (req, res) => {
  const [me, subjects] = await Promise.all([
    User.findById(req.user._id).select("known bookmarks").lean(),
    subjectCounts()
  ]);
  const filter = buildFilter(req.query, me);
  const page = pageParam(req.query.page);

  const [total, cards] = await Promise.all([
    Flashcard.countDocuments(filter),
    Flashcard.find(filter).select("subject question answer").sort({ subject: 1, _id: 1 })
      .skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean()
  ]);

  const known = new Set((me.known || []).map(String));
  const marked = new Set((me.bookmarks || []).map(String));
  cards.forEach(c => { c.known = known.has(String(c._id)); c.bookmarked = marked.has(String(c._id)); });

  const totalCards = subjects.reduce((a, s) => a + s.count, 0);
  res.render("flashcards", {
    title: "Flashcards",
    cards, subjects, total, totalCards, page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    q: toStr(req.query.q).trim().slice(0, 60),
    subject: toStr(req.query.subject).trim() || "all",
    filter: ["mastered", "learning", "bookmarked"].includes(req.query.filter) ? req.query.filter : "all",
    masteredCount: (me.known || []).length,
    bookmarkCount: (me.bookmarks || []).length
  });
};

// Full-screen study deck (up to 300 cards, filtered like the browse page)
module.exports.getStudy = async (req, res) => {
  const me = await User.findById(req.user._id).select("known bookmarks").lean();
  const filter = buildFilter(req.query, me);
  const cards = await Flashcard.find(filter).select("subject question answer").sort({ subject: 1, _id: 1 }).limit(300).lean();
  const known = new Set((me.known || []).map(String));
  const marked = new Set((me.bookmarks || []).map(String));
  const deck = cards.map(c => ({ id: String(c._id), s: c.subject, q: c.question, a: c.answer, k: known.has(String(c._id)), b: marked.has(String(c._id)) }));
  res.render("study", {
    title: "Study mode",
    deck,
    subject: toStr(req.query.subject).trim() || "all",
    filter: ["mastered", "learning", "bookmarked"].includes(req.query.filter) ? req.query.filter : "all"
  });
};

module.exports.setProgress = async (req, res) => {
  const id = req.params.id;
  const action = req.body && req.body.action;
  if (!isId(id)) return res.status(400).json({ ok: false });
  const oid = new mongoose.Types.ObjectId(id);
  const ops = {
    known:      { $addToSet: { known: oid } },
    unknown:    { $pull:     { known: oid } },
    bookmark:   { $addToSet: { bookmarks: oid } },
    unbookmark: { $pull:     { bookmarks: oid } }
  };
  if (!ops[action]) return res.status(400).json({ ok: false });
  await User.updateOne({ _id: req.user._id }, ops[action]);
  res.json({ ok: true });
};

// ── Admin: bulk upload (several Excel / CSV / PDF files at once) ──
const { readRows } = require("../utils/importers");
const { filesOf } = require("../middleware/uploadFiles");

const subjectFromFilename = (name) => String(name || "").replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim().slice(0, 80);

module.exports.uploadFlashcards = async (req, res) => {
  const back = "/admin/flashcards";
  try {
    const files = filesOf(req);
    const fromFile = req.body.subjectFromFile === "1";
    const subject = toStr(req.body.subject).trim().slice(0, 80);
    if (!files.length)           { req.flash("error", "No file uploaded"); return res.redirect(back); }
    if (!subject && !fromFile)   { req.flash("error", "Subject is required"); return res.redirect(back); }

    let added = 0, okFiles = 0;
    const problems = [];
    for (const file of files) {
      try {
        const rows = await readRows(file, "cards");
        const sub = fromFile ? subjectFromFilename(file.originalname) : subject;
        if (!sub) { problems.push(`${file.originalname}: could not make a subject from the file name`); continue; }
        const mine = allowedSubjects(req.user);          // teachers: own subjects only
        if (mine && !mine.includes(sub)) { problems.push(`${file.originalname}: “${sub}” is not one of your subjects (${mine.join(", ") || "none yet"})`); continue; }

        const uploadId = new mongoose.Types.ObjectId();
        const docs = [], kept = [];
        for (const row of rows) {
          const question = toStr(row.question).trim();
          const answer   = toStr(row.answer).trim();          // numbers (e.g. 0, 42) are valid answers
          if (!question || !answer) continue;
          // keywords column is optional: when it is missing or empty they are generated automatically from the answer
          const typed = row.keywords !== undefined ? parseKeywordList(row.keywords) : [];
          const keywords = typed.length ? typed : generateKeywords(answer);
          docs.push({ subject: sub, question, answer, keywords, uploadId });
          kept.push({ question, answer, keywords: row.keywords !== undefined ? toStr(row.keywords) : "" });
        }
        if (!docs.length) { problems.push(`${file.originalname}: no question/answer rows found`); continue; }

        await Flashcard.insertMany(docs, { ordered: false });          // one round-trip per file
        await Upload.create({ _id: uploadId, filename: file.originalname, type: "flashcards", subject: sub, rows: kept });
        added += docs.length; okFiles++;
      } catch (e) {
        problems.push(`${file.originalname}: ${e.message}`);
      }
    }
    cache.subjects.clear();

    if (okFiles) req.flash("success", `${added} flashcards added from ${okFiles} file${okFiles === 1 ? "" : "s"}`);
    if (problems.length) req.flash("error", "Not imported - " + problems.slice(0, 4).join(" | ") + (problems.length > 4 ? ` (+${problems.length - 4} more)` : ""));
    res.redirect(back);
  } catch (err) {
    console.error("uploadFlashcards error:", err);
    req.flash("error", err.message);
    res.redirect(back);
  }
};

// "Check Match %" button. Rate-limited in server.js; read-only (no DB writes).
// Inside a test it only works if the admin enabled it for that test; outside a test it is free practice.
module.exports.checkAnswer = async (req, res) => {
  try {
    const { questionId, answer, testId } = req.body;
    if (typeof questionId !== "string" || !isId(questionId)) return res.json({ percent: 0 });
    if (testId !== undefined) {
      const t = isId(String(testId)) ? await getTestLean(String(testId)) : null;       // shared cached copy
      if (!t || !t.allowCheck) return res.status(403).json({ percent: 0, error: "Checking is turned off for this test" });
    }
    let flashcard = cache.cards.get("one:" + questionId);
    if (!flashcard) {
      flashcard = await Flashcard.findById(questionId).select("answer keywords").lean();
      if (flashcard) cache.cards.set("one:" + questionId, flashcard);
    }
    if (!flashcard) return res.json({ percent: 0, error: "Flashcard not found" });
    return res.json({ percent: Math.round(matchPercent(answer, flashcard)) });
  } catch (err) {
    res.json({ percent: 0 });
  }
};
