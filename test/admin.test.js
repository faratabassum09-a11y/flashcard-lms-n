// Admin side of sections / teachers / auto keywords, driven through the REAL controller with in-memory
// stand-ins for the Mongoose models (no MongoDB needed). Real-database coverage: scripts/e2e.js
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const oid = (() => { let n = 100; return () => (++n).toString(16).padStart(24, "0"); })();
const db = { users: [], tests: [], results: [], cards: [], sections: [] };

// minimal Mongo-style matcher: $and $or $in $ne $exists $size and plain equality
function matches(doc, f) {
  return Object.entries(f || {}).every(([k, v]) => {
    if (k === "$and") return v.every(x => matches(doc, x));
    if (k === "$or") return v.some(x => matches(doc, x));
    const val = doc[k];
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      return Object.entries(v).every(([op, arg]) => {
        if (op === "$in") return arg.map(String).includes(String(val));
        if (op === "$ne") return String(val) !== String(arg);
        if (op === "$exists") return (val !== undefined) === arg;
        if (op === "$size") return Array.isArray(val) && val.length === arg;
        return true;
      });
    }
    return String(val) === String(v) || (Array.isArray(val) && val.map(String).includes(String(v)));
  });
}
const chain = (get) => { const q = { select: () => q, sort: () => q, lean: () => q, populate: () => q, skip: () => q, limit: () => q,
  cursor: () => ({ async *[Symbol.asyncIterator]() { for (const x of await get()) yield x; } }),
  then: (res, rej) => Promise.resolve().then(get).then(res, rej) }; return q; };

function FakeUser(o) { Object.assign(this, o); }
const applyUpdate = (u, upd) => { for (const [k, v] of Object.entries(upd)) { if (k === "$set") Object.assign(u, v); else if (k === "$unset") Object.keys(v).forEach(x => delete u[x]); else u[k] = v; } };
Object.assign(FakeUser, {
  find: (f) => chain(() => db.users.filter(u => matches(u, f))),
  findOne: (f) => { const q = chain(() => db.users.find(u => matches(u, f)) || null); return q; },
  findById: (id) => chain(() => db.users.find(u => u._id === String(id)) || null),
  countDocuments: async (f) => db.users.filter(u => matches(u, f)).length,
  registerFast: async (u, pw) => FakeUser.register(u, pw),
  register: async (u, pw) => { if (db.users.some(x => x.username === u.username)) { const e = new Error("exists"); e.name = "UserExistsError"; throw e; } db.users.push({ _id: oid(), ...u, pw }); },
  updateMany: async (f, upd) => { let n = 0; db.users.filter(u => matches(u, f)).forEach(u => { applyUpdate(u, upd); n++; }); return { modifiedCount: n }; },
  updateOne: async (f, upd) => { const u = db.users.find(x => matches(x, f)); if (u) applyUpdate(u, upd); },
  deleteOne: async (f) => { db.users = db.users.filter(u => !matches(u, f)); },
  aggregate: async () => { const g = {}; db.users.filter(u => u.username !== "admin" && u.role !== "teacher").forEach(u => { g[u.section || ""] = (g[u.section || ""] || 0) + 1; }); return Object.entries(g).map(([k, n]) => ({ _id: k, n })); },
});
FakeUser.aggregate = async (pipe) => {
  if (pipe[0].$match && pipe[0].$match.createdBy) return [];
  if (pipe[0].$match && pipe[0].$match.role === "teacher") return [];
  const g = {}; db.users.filter(u => u.username !== "admin" && u.role !== "teacher").forEach(u => { g[u.section || ""] = (g[u.section || ""] || 0) + 1; }); return Object.entries(g).map(([k, n]) => ({ _id: k, n }));
};
const FakeTest = {
  findById: (id) => chain(() => db.tests.find(t => t._id === String(id)) || null),
  find: (f) => chain(() => db.tests.filter(t => matches(t, f))),
  exists: async (f) => db.tests.find(t => t._id === String(f._id)) ? { _id: 1 } : null,
  findByIdAndUpdate: async (id, upd) => { const t = db.tests.find(x => x._id === String(id)); if (t) Object.assign(t, upd); },
  findByIdAndDelete: async (id) => { db.tests = db.tests.filter(t => t._id !== String(id)); },
  estimatedDocumentCount: async () => db.tests.length,
  aggregate: async () => [],
  create: async (d) => { const t = { _id: oid(), ...d }; db.tests.push(t); return t; },
};
const FakeSection = {
  find: () => chain(() => db.sections.map(name => ({ name }))),
  bulkWrite: async (ops) => { ops.forEach(o => { const n = o.updateOne.filter.name; if (!db.sections.includes(n)) db.sections.push(n); }); },
  deleteOne: async (f) => { db.sections = db.sections.filter(n => n !== f.name); },
};
const FakeResult = { find: (f) => chain(() => db.results.filter(r => matches(r, f))), aggregate: async () => [], deleteOne: async () => ({ deletedCount: 1 }), deleteMany: async () => ({}) };
const FakeCard = {
  find: (f) => chain(() => db.cards.filter(c => matches(c, f))),
  bulkWrite: async (ops) => { for (const o of ops) { const c = db.cards.find(x => x._id === o.updateOne.filter._id); Object.assign(c, o.updateOne.update.$set); } },
  create: async (c) => { db.cards.push({ _id: oid(), ...c }); },
  updateOne: async (f, upd) => { const c = db.cards.find(x => matches(x, f)); if (c) Object.assign(c, upd); return { matchedCount: c ? 1 : 0 }; },
  deleteOne: async (f) => { db.cards = db.cards.filter(c => !matches(c, f)); },
  countDocuments: async (f) => db.cards.filter(c => matches(c, f)).length, estimatedDocumentCount: async () => db.cards.length };
const inject = (rel, mod) => { const p = require.resolve(path.join("../backend", rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: mod }; };
inject("models/user", FakeUser); inject("models/test", FakeTest); inject("models/result", FakeResult); inject("models/section", FakeSection);
inject("models/flashcard", FakeCard); inject("models/upload", {}); inject("models/announcement", {});
inject("models/draft", { deleteOne: async () => ({}), deleteMany: async () => ({}) });
const A = require("../backend/controllers/adminController");

const mk = (over = {}) => {
  const flashes = [], out = { redirect: null, rendered: null, headers: {}, body: null };
  const req = { body: {}, params: {}, query: {}, user: { username: "admin" }, flash: (t, m) => flashes.push([t, m]), ...over };
  const res = { redirect(a) { out.redirect = a; return res; }, render(v, d) { out.rendered = { view: v, data: d }; return res; },
    setHeader(k, v) { out.headers[k] = v; return res; }, send(b) { out.body = b; return res; }, status() { return res; }, json(b) { out.body = b; return res; } };
  return { req, res, out, flashes };
};
const student = (username, section, extra = {}) => { const u = { _id: oid(), username, section, ...extra }; if (!section) delete u.section; db.users.push(u); return u; };

const { clearSectionCache } = require("../backend/utils/sections");
function setup() {
  clearSectionCache();
  Object.assign(db, { users: [{ _id: "adm", username: "admin" }], tests: [], results: [], cards: [], sections: [] });
  const a1 = student("A1", "A"), a2 = student("A2", "A"), b1 = student("B1", "B"), c1 = student("C1", "C"), n1 = student("N1");
  const t = { _id: oid(), name: "Unit 1", subject: "Bio", duration: 30, sections: ["A", "B"], isEnded: true, questions: [] };
  db.tests.push(t);
  db.results.push({ userId: a1._id, testId: t._id, score: 9, total: 10, submittedAt: new Date() },
                  { userId: b1._id, testId: t._id, score: 5, total: 10, submittedAt: new Date() });
  return { a1, a2, b1, c1, n1, t };
}

test("results page: a test for sections A and B lists only those students, with marks out of 20", async () => {
  const { t } = setup();
  const m = mk({ params: { testId: t._id } });
  await A.getTestResults(m.req, m.res);
  const d = m.out.rendered.data;
  assert.deepStrictEqual(d.rows.map(r => r.username).sort(), ["A1", "A2", "B1"]);                // C and unassigned students are not part of this test
  const a1 = d.rows.find(r => r.username === "A1");
  assert.deepStrictEqual([a1.written, a1.rank], [18, 1]);
  assert.strictEqual(d.rows.find(r => r.username === "B1").written, 10);
  assert.strictEqual(d.examMax, 20);
  assert.deepStrictEqual(d.sectionStats.map(s => [s.section, s.students, s.submitted, s.avg]), [["A", 2, 1, 18], ["B", 1, 1, 10]]);
});

test("results page: section filter narrows the list and re-ranks inside the section", async () => {
  const { t } = setup();
  const m = mk({ params: { testId: t._id }, query: { section: "b" } });
  await A.getTestResults(m.req, m.res);
  const d = m.out.rendered.data;
  assert.deepStrictEqual(d.rows.map(r => [r.username, r.rank]), [["B1", 1]]);                      // B1 is #2 overall but #1 in section B
  assert.strictEqual(d.section, "B");
  assert.strictEqual(d.sectionStats.length, 2);                                                    // tabs stay available
});

test("CSV export: section column, marks out of 20, and the section filter", async () => {
  const { t } = setup();
  let m = mk({ params: { testId: t._id } });
  await A.downloadResultCSV(m.req, m.res);
  const lines = m.out.body.replace("\ufeff", "").split("\r\n");
  assert.match(lines[0], /Section.*Marks \(out of 20\).*Percent/);
  assert.match(lines.find(l => l.includes("A1")), /^1,A1,,A,Submitted,18,90,A\+,/);
  assert.strictEqual(lines.length, 4);                                                             // header + A1 + A2 + B1

  m = mk({ params: { testId: t._id }, query: { section: "B" } });
  await A.downloadResultCSV(m.req, m.res);
  assert.strictEqual(m.out.body.split("\r\n").length, 2);
  assert.match(m.out.headers["Content-Disposition"], /Unit_1-B-results\.csv/);
});

test("students: bulk move into a section, and clearing it", async () => {
  const { a2, n1 } = setup();
  let m = mk({ body: { ids: [a2._id, n1._id, "admin", "x"], section: " cse-b " } });
  await A.assignSection(m.req, m.res);
  assert.strictEqual(db.users.find(u => u._id === a2._id).section, "CSE-B");
  assert.strictEqual(db.users.find(u => u._id === n1._id).section, "CSE-B");
  m = mk({ body: { ids: a2._id, section: "" } });
  await A.assignSection(m.req, m.res);
  assert.strictEqual(db.users.find(u => u._id === a2._id).section, undefined);
  m = mk({ body: { section: "A" } });                                                              // nothing ticked
  await A.assignSection(m.req, m.res);
  assert.match(m.flashes[0][1], /Tick at least one/);
});

test("flashcards: keywords are generated automatically (preview, blank on save, bulk 'missing' vs 'all')", async () => {
  db.cards.length = 0;
  const a = "Photosynthesis is the process by which green plants make food using sunlight, water and carbon dioxide.";
  let m = mk({ body: { answer: a } });
  A.previewKeywords(m.req, m.res);
  assert.ok(m.out.body.keywords.includes("photosynthesis") && m.out.body.keywords.includes("sunlight"));

  db.cards.push({ _id: "c1", subject: "Bio", question: "Q1", answer: a, keywords: [] },
                { _id: "c2", subject: "Bio", question: "Q2", answer: "Mitochondria", keywords: ["custom"] },
                { _id: "c3", subject: "Phy", question: "Q3", answer: "Force equals mass times acceleration" });
  m = mk({ body: { mode: "missing" } });
  await A.autoKeywords(m.req, m.res);
  assert.ok(db.cards[0].keywords.length >= 3);
  assert.deepStrictEqual(db.cards[1].keywords, ["custom"]);                                        // hand-typed keywords are untouched
  assert.ok(db.cards[2].keywords.includes("force"));
  assert.match(m.flashes[0][1], /2 flashcards/);

  m = mk({ body: { mode: "all", subject: "Bio" } });                                               // rebuild only inside one subject
  await A.autoKeywords(m.req, m.res);
  assert.deepStrictEqual(db.cards[1].keywords, ["mitochondria"]);
  m = mk({ body: { mode: "missing" } });
  await A.autoKeywords(m.req, m.res);
  assert.match(m.flashes[0][1], /already has keywords/);
});

// ───────────────────────── sections as dropdown options ─────────────────────────
test("sections: create one (or several) before any student is in it; it shows up with 0 students", async () => {
  setup(); db.sections = [];
  let m = mk({ body: { names: " cse-a, B ,, " } });
  await A.createSection(m.req, m.res);
  assert.deepStrictEqual(db.sections.sort(), ["B", "CSE-A"]);
  m = mk({ query: {} });
  await A.getStudents(m.req, m.res);
  const d = m.out.rendered.data;
  assert.deepStrictEqual(d.sections.list.map(x => [x.section, x.count]), [["A", 2], ["B", 1], ["C", 1], ["CSE-A", 0]]);   // students' sections + the new empty one
  assert.strictEqual(d.sections.total, 5); assert.strictEqual(d.sections.unassigned, 1);
});

test("sections: typing a new section for a student creates the option automatically; empty ones can be deleted, used ones cannot", async () => {
  const { n1 } = setup(); db.sections = [];
  let m = mk({ body: { ids: [n1._id], section: "d" } });
  await A.assignSection(m.req, m.res);
  assert.ok(db.sections.includes("D"));

  m = mk({ body: { section: "D" } });
  await A.deleteSection(m.req, m.res);
  assert.ok(db.sections.includes("D")); assert.match(m.flashes[0][1], /still has 1 student/);

  db.sections.push("EMPTY");
  m = mk({ body: { section: "EMPTY" } });
  await A.deleteSection(m.req, m.res);
  assert.ok(!db.sections.includes("EMPTY"));
});

test("students list: filtering by a section returns exactly its students; teachers never count as students", async () => {
  setup();
  db.users.push({ _id: oid(), username: "t.sharma", role: "teacher", subjects: ["Bio"] });
  let m = mk({ query: { section: "a" } });
  await A.getStudents(m.req, m.res);
  assert.strictEqual(m.out.rendered.data.section, "A");
  const all = mk({ query: {} });
  await A.getStudents(all.req, all.res);
  assert.strictEqual(all.out.rendered.data.grand, 5);                                              // 5 students, the teacher is not one of them
});

// ───────────────────────── teachers ─────────────────────────
test("admin creates a teacher with subjects; duplicates and weak passwords are refused", async () => {
  setup();
  let m = mk({ body: { username: "t.sharma", displayName: "Mr Sharma", password: "secret1", subjects: ["Bio", "Chem"], newSubjects: "Physics, Bio" } });
  await A.createTeacher(m.req, m.res);
  const t = db.users.find(u => u.username === "t.sharma");
  assert.strictEqual(t.role, "teacher"); assert.deepStrictEqual(t.subjects, ["Bio", "Chem", "Physics"]);
  m = mk({ body: { username: "t.sharma", password: "secret1" } });
  await A.createTeacher(m.req, m.res); assert.match(m.flashes[0][1], /already exists/);
  m = mk({ body: { username: "t2", password: "123" } });
  await A.createTeacher(m.req, m.res); assert.match(m.flashes[0][1], /at least 6/);
  m = mk({ body: { username: "admin", password: "secret1" } });
  await A.createTeacher(m.req, m.res); assert.match(m.flashes[0][1], /reserved/);

  m = mk({ params: { id: t._id }, body: { subjects: "Bio", newSubjects: "", displayName: "" } });
  await A.updateTeacher(m.req, m.res);
  assert.deepStrictEqual(db.users.find(u => u.username === "t.sharma").subjects, ["Bio"]);

  m = mk({ params: { id: t._id } });
  await A.deleteTeacher(m.req, m.res);
  assert.ok(!db.users.some(u => u.username === "t.sharma"));
});

test("a teacher can open results only of their own tests; the admin sees all", async () => {
  const { t } = setup();
  const mine = { _id: oid(), name: "Mine", subject: "Bio", duration: 10, sections: [], isEnded: true, questions: [], createdBy: "t1" };
  db.tests.push(mine);
  const teacher = { _id: "t1", username: "t.sharma", role: "teacher", subjects: ["Bio"] };
  let m = mk({ user: teacher, params: { testId: mine._id } });
  await A.getTestResults(m.req, m.res);
  assert.strictEqual(m.out.rendered.view, "adminTestResults");

  m = mk({ user: teacher, params: { testId: t._id } });                                           // admin's test
  await A.getTestResults(m.req, m.res);
  assert.strictEqual(m.out.redirect, "/admin/results"); assert.strictEqual(m.out.rendered, null);

  m = mk({ user: teacher, params: { testId: t._id } });
  await A.downloadResultCSV(m.req, m.res);
  assert.strictEqual(m.out.body, "Test not found");

  m = mk({ params: { testId: mine._id } });                                                        // admin sees the teacher's test
  await A.getTestResults(m.req, m.res);
  assert.strictEqual(m.out.rendered.view, "adminTestResults");
});

test("a teacher cannot start, end or delete someone else's test", async () => {
  const { t } = setup();
  const mine = { _id: oid(), name: "Mine", duration: 10, createdBy: "t1" };
  db.tests.push(mine);
  const teacher = { _id: "t1", username: "t.sharma", role: "teacher", subjects: ["Bio"] };
  let m = mk({ user: teacher, params: { id: t._id }, body: {} });
  await A.startTest(m.req, m.res);
  assert.match(m.flashes[0][1], /only manage tests you created/); assert.ok(!t.isActive);
  m = mk({ user: teacher, params: { id: t._id }, body: {} });
  await A.deleteTest(m.req, m.res);
  assert.ok(db.tests.some(x => x._id === t._id));

  m = mk({ user: teacher, params: { id: mine._id }, body: {} });
  await A.startTest(m.req, m.res);
  assert.strictEqual(db.tests.find(x => x._id === mine._id).isActive, true);
});

test("a teacher can add flashcards only to their own subjects", async () => {
  setup(); db.cards.length = 0;
  const teacher = { _id: "t1", username: "t.sharma", role: "teacher", subjects: ["Bio"] };
  let m = mk({ user: teacher, body: { subject: "Phy", question: "Q", answer: "Force equals mass times acceleration" } });
  await A.createFlashcard(m.req, m.res);
  assert.strictEqual(db.cards.length, 0); assert.match(m.flashes[0][1], /own subjects/);
  m = mk({ user: teacher, body: { subject: "Bio", question: "Q", answer: "Mitochondria produce energy for the cell" } });
  await A.createFlashcard(m.req, m.res);
  assert.strictEqual(db.cards.length, 1); assert.ok(db.cards[0].keywords.length >= 1);            // keywords generated automatically
});
