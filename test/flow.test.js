// Drives the REAL controllers (create test -> start -> take -> submit -> marks -> result)
// against an in-memory stand-in for the Mongoose models, so it runs with no MongoDB.
// (Real-database coverage: scripts/e2e.js)
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const oid = (() => { let n = 0; return () => (++n).toString(16).padStart(24, "0"); })();

// ---------- tiny fake collections ----------
const db = { tests: [], results: [], cards: [], drafts: [] };
const query = (get) => {
  let pop = false;
  const run = () => {
    const doc = get();
    if (pop && doc && doc.questions) {       // emulate .populate("questions.questionId")
      return { ...doc, questions: doc.questions.map(x => ({ ...x, questionId: db.cards.find(c => c._id === String(x.questionId)) || null })) };
    }
    return doc;
  };
  const q = { select: () => q, sort: () => q, limit: () => q, populate: () => { pop = true; return q; }, lean: () => q,
              then: (res, rej) => Promise.resolve().then(run).then(res, rej) };
  return q;
};
const FakeTest = {
  create: async (d) => { const t = { _id: oid(), isActive: false, isEnded: false, ...d }; db.tests.push(t); return t; },
  findById: (id) => query(() => db.tests.find(t => t._id === String(id)) || null),
  find: () => query(() => [...db.tests]),
};
const FakeResult = {
  exists: async (f) => db.results.find(r => String(r.testId) === String(f.testId) && String(r.userId) === String(f.userId)) ? { _id: 1 } : null,
  create: async (d) => {
    if (db.results.some(r => String(r.testId) === String(d.testId) && String(r.userId) === String(d.userId))) { const e = new Error("dup"); e.code = 11000; throw e; }
    db.results.push({ _id: oid(), ...d });
  },
  findOne: (f) => query(() => db.results.find(r => String(r.testId) === String(f.testId) && String(r.userId) === String(f.userId)) || null),
  find: () => query(() => [...db.results]),
  bulkWrite: async (ops) => {                                   // upsert-if-absent ($setOnInsert), like the real batched insert
    const upsertedIds = {};
    ops.forEach((o, i) => { const f = o.updateOne.filter;
      if (!db.results.some(r => String(r.testId) === String(f.testId) && String(r.userId) === String(f.userId))) {
        const id = oid(); db.results.push({ _id: id, userId: f.userId, testId: f.testId, ...o.updateOne.update.$setOnInsert }); upsertedIds[i] = id; } });
    return { upsertedIds };
  },
};
const subjMatch = (c, f) => !f.subject || (f.subject.$in ? f.subject.$in.includes(c.subject) : f.subject === c.subject);
const FakeCard = {
  find: (f) => query(() => db.cards.filter(c => (f._id.$in || []).map(String).includes(c._id))),
  countDocuments: async (f) => db.cards.filter(c => (!f._id || f._id.$in.map(String).includes(c._id)) && subjMatch(c, f)).length,
  aggregate: async (pipe) => {                                   // [{$match}, {$sample:{size}}, {$project}]
    const pool = db.cards.filter(c => subjMatch(c, pipe[0].$match));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, pipe[1].$sample.size).map(c => ({ _id: c._id }));
  }
};
const sameKey = (d, f) => String(d.testId) === String(f.testId) && String(d.userId) === String(f.userId);
const FakeDraft = {
  findOne: (f) => query(() => db.drafts.find(d => sameKey(d, f)) || null),
  find: () => query(() => [...db.drafts]),
  updateOne: async (f, u) => { const d = db.drafts.find(x => sameKey(x, f)); if (d) Object.assign(d, u.$set); else db.drafts.push({ _id: oid(), ...f, ...u.$set }); },
  deleteOne: async (f) => { const i = db.drafts.findIndex(d => (f._id ? d._id === f._id : sameKey(d, f))); if (i > -1) db.drafts.splice(i, 1); },
  deleteMany: async (f) => { for (let i = db.drafts.length - 1; i >= 0; i--) {
      const d = db.drafts[i];
      if (f.$or ? f.$or.some(k => sameKey(d, k)) : String(d.testId) === String(f.testId)) db.drafts.splice(i, 1); } },
  bulkWrite: async (ops) => { for (const o of ops) { const f = o.updateOne.filter, u = o.updateOne.update.$set;
      const d = db.drafts.find(x => sameKey(x, f)); if (d) Object.assign(d, u); else db.drafts.push({ _id: oid(), ...f, ...u }); } },
};
const inject = (rel, mod) => { const p = require.resolve(path.join("../backend", rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: mod }; };
inject("models/test", FakeTest); inject("models/result", FakeResult); inject("models/flashcard", FakeCard); inject("models/draft", FakeDraft);
const cache = require("../backend/utils/cache");
const C = require("../backend/controllers/testController");

// ---------- fake req/res ----------
const mk = (over = {}) => {
  const flashes = [];
  cache.clearExam();                       // the shared exam caches live a few seconds in production; each fake request starts clean
  const req = { body: {}, params: {}, user: { _id: "u1", username: "stud1" }, flash: (t, m) => flashes.push([t, m]), is: () => false, ...over };
  const out = { redirect: null, rendered: null, status: 200 };
  const res = {
    redirect(a, b) { out.redirect = b || a; out.status = b ? a : 302; return res; },
    render(v, d) { out.rendered = { view: v, data: d }; return res; },
    set() { return res; }, send(m) { out.sent = m; return res; },
    json(b) { out.json = b; return res; }, status(c) { out.status = c; return res; },
  };
  return { req, res, out, flashes };
};

const addCard = (answer, keywords, question = "Q?", subject = "Gen") => { const c = { _id: oid(), question, answer, keywords, subject }; db.cards.push(c); return c; };

test("create test validates input and stores marks in the right order", async () => {
  const a = addCard("red green", ["red", "green"], "Colours?");
  const b = addCard("blue", ["blue"], "Sky?");

  let m = mk({ body: { name: "", duration: "10", questionIds: [a._id], marks: ["5"] } });
  await C.createTest(m.req, m.res);
  assert.match(m.flashes[0][1], /name/i);

  m = mk({ body: { name: "T", duration: "-5", questionIds: [a._id], marks: ["5"] } });
  await C.createTest(m.req, m.res);
  assert.match(m.flashes[0][1], /duration/i);

  m = mk({ body: { name: "T", duration: "10", questionIds: [a._id, b._id], marks: ["5"] } });
  await C.createTest(m.req, m.res);
  assert.match(m.flashes[0][1], /marks/i);

  m = mk({ body: { name: "T", duration: "10", questionIds: { $ne: 1 }, marks: ["5"] } });
  await C.createTest(m.req, m.res);
  assert.ok(m.flashes[0][0] === "error");

  m = mk({ body: { name: "Unit Test", duration: "30", subject: "Sci", questionIds: [a._id, b._id], marks: ["5", "3"],
                   scheduledStart: "2026-10-07T10:00", scheduledEnd: "2026-10-07T11:00" } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(m.out.status, 303);
  assert.strictEqual(db.tests.length, 1);
  assert.deepStrictEqual(db.tests[0].questions.map(q => q.marks), [5, 3]);
});

test("end-to-end: student takes test, marks are awarded correctly, double submit is safe", async () => {
  db.tests.length = 0; db.results.length = 0; db.cards.length = 0;
  const q1 = addCard("photosynthesis sunlight chlorophyll water", ["photosynthesis", "sunlight", "chlorophyll", "water"]);
  const q2 = addCard("42", []);
  const q3 = addCard("mitochondria", ["mitochondria"]);
  const t = await FakeTest.create({
    name: "Bio", subject: "Science", duration: 30,
    questions: [{ questionId: q1._id, marks: 4 }, { questionId: q2._id, marks: 2 }, { questionId: q3._id, marks: 6 }],
    isActive: true, startTime: new Date()
  });

  // student opens the test page
  let m = mk({ params: { id: t._id } });
  await C.getStartTest(m.req, m.res);
  assert.strictEqual(m.out.rendered.view, "startTest");
  assert.strictEqual(m.out.rendered.data.test.questions.length, 3);
  assert.ok(m.out.rendered.data.remainingTime > 1700 && m.out.rendered.data.remainingTime <= 1800);

  // submit: q1 3/4 keywords (75% -> full 4), q2 correct (2), q3 wrong (0)  => 6 / 12
  const answers = { [q1._id]: "Plants use sunlight and water, chlorophyll helps", [q2._id]: "The answer is 42", [q3._id]: "nucleus" };
  m = mk({ body: { testId: t._id, answers } });
  await C.submitTest(m.req, m.res);
  assert.strictEqual(m.out.status, 303);
  assert.strictEqual(m.out.redirect, "/result/" + t._id);
  assert.deepStrictEqual([db.results[0].score, db.results[0].total], [6, 12]);

  // double submit (second tab / double click) -> still one result, no crash
  m = mk({ body: { testId: t._id, answers: {} } });
  await C.submitTest(m.req, m.res);
  assert.strictEqual(db.results.length, 1);
  assert.strictEqual(db.results[0].score, 6);

  // result page
  m = mk({ params: { testId: t._id } });
  await C.getResult(m.req, m.res);
  const rd = m.out.rendered.data;
  assert.deepStrictEqual([rd.totalScore, rd.total, rd.percentage, rd.grade.letter, rd.ended], [6, 12, 50, "D", false]);
  // per-question detail is stored for the later review
  assert.deepStrictEqual(db.results[0].answers.map(a => [a.m, a.t]), [[4, 4], [2, 2], [0, 6]]);

  // attempting again is blocked
  m = mk({ params: { id: t._id } });
  await C.getStartTest(m.req, m.res);
  assert.strictEqual(m.out.redirect, "/tests");
  assert.match(m.flashes[0][1], /already attempted/);
});

test("late submissions are rejected server-side, in-grace ones accepted", async () => {
  db.results.length = 0;
  const c = addCard("x", ["x"]);
  const late = await FakeTest.create({ name: "L", duration: 10, questions: [{ questionId: c._id, marks: 1 }], isActive: true, startTime: new Date(Date.now() - 14 * 60000) });   // 4 min late: beyond the 2 min grace
  let m = mk({ body: { testId: late._id, answers: { [c._id]: "x" } } });
  await C.submitTest(m.req, m.res);
  assert.strictEqual(db.results.length, 0);
  assert.match(m.flashes[0][1], /Time is over/);

  const edge = await FakeTest.create({ name: "E", duration: 10, questions: [{ questionId: c._id, marks: 1 }], isActive: true, startTime: new Date(Date.now() - 10 * 60000 - 20000) });
  m = mk({ body: { testId: edge._id, answers: { [c._id]: "x" } } });
  await C.submitTest(m.req, m.res);
  assert.strictEqual(db.results.length, 1);
  assert.strictEqual(db.results[0].score, 1);
});

test("hostile input cannot crash or inject", async () => {
  let m = mk({ body: { testId: { $ne: null }, answers: {} } });
  await C.submitTest(m.req, m.res);
  assert.strictEqual(m.out.redirect, "/tests");
  m = mk({ params: { id: "not-an-id" } });
  await C.getStartTest(m.req, m.res);
  assert.strictEqual(m.out.redirect, "/tests");
});

test("not-started and ended tests cannot be opened", async () => {
  const c = addCard("x", ["x"]);
  const ns = await FakeTest.create({ name: "NS", duration: 10, questions: [{ questionId: c._id, marks: 1 }] });
  let m = mk({ params: { id: ns._id } });
  await C.getStartTest(m.req, m.res);
  assert.match(m.flashes[0][1], /not started/);
  const en = await FakeTest.create({ name: "EN", duration: 10, questions: [{ questionId: c._id, marks: 1 }], isEnded: true, startTime: new Date() });
  m = mk({ params: { id: en._id } });
  await C.getStartTest(m.req, m.res);
  assert.match(m.flashes[0][1], /ended/);
});

// ───────────────────────── sections ─────────────────────────
test("create test for ALL students stores no sections", async () => {
  db.tests.length = 0;
  const a = addCard("red", ["red"]);
  const m = mk({ body: { name: "All", duration: "10", questionIds: [a._id], marks: ["1"], target: "all" } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests.length, 1);
  assert.deepStrictEqual(db.tests[0].sections, []);
});

test("create test for selected sections at the SAME time makes one shared test", async () => {
  db.tests.length = 0;
  const a = addCard("red", ["red"]);
  const m = mk({ body: { name: "Unit 1", duration: "20", questionIds: [a._id], marks: ["1"], target: "sections", secOn: ["a", " b "], sameTime: "on",
                         scheduledStart: "2026-10-09T10:00", scheduledEnd: "2026-10-09T11:00", secName: ["A", "B", "C"], secStart: ["", "", ""], secEnd: ["", "", ""] } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests.length, 1);
  assert.deepStrictEqual(db.tests[0].sections, ["A", "B"]);          // section names are normalised
  assert.strictEqual(db.tests[0].name, "Unit 1");
});

test("sections writing at DIFFERENT times get one test each, with their own schedule", async () => {
  db.tests.length = 0;
  const a = addCard("red", ["red"]);
  const m = mk({ body: { name: "Unit 1", duration: "20", questionIds: [a._id], marks: ["1"], target: "sections", secOn: ["A", "C"],
                         secName: ["A", "B", "C"], secStart: ["2026-10-09T09:00", "2026-10-09T10:00", "2026-10-09T14:00"], secEnd: ["2026-10-09T10:00", "", "2026-10-09T15:00"] } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(m.out.status, 303);
  assert.strictEqual(db.tests.length, 2);
  assert.deepStrictEqual(db.tests.map(t => [t.name, t.sections]), [["Unit 1 — Sec A", ["A"]], ["Unit 1 — Sec C", ["C"]]]);
  assert.strictEqual(db.tests[0].scheduledStart.getHours(), 9);
  assert.strictEqual(db.tests[1].scheduledStart.getHours(), 14);     // section B was not ticked -> no test for it
  assert.match(m.flashes[0][1], /2 tests created/);
});

test("choosing 'selected sections' without ticking any is rejected; bad per-section times too", async () => {
  db.tests.length = 0;
  const a = addCard("red", ["red"]);
  let m = mk({ body: { name: "X", duration: "10", questionIds: [a._id], marks: ["1"], target: "sections" } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests.length, 0); assert.match(m.flashes[0][1], /section/i);
  m = mk({ body: { name: "X", duration: "10", questionIds: [a._id], marks: ["1"], target: "sections", secOn: ["A", "B"], secName: ["A", "B"],
                   secStart: ["2026-10-09T10:00", "2026-10-09T10:00"], secEnd: ["2026-10-09T09:00", ""] } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests.length, 0); assert.match(m.flashes[0][1], /Section A/);
});

test("a student can only open and submit tests of their own section", async () => {
  db.tests.length = 0; db.results.length = 0;
  const c = addCard("alpha beta", ["alpha", "beta"]);
  const t = await FakeTest.create({ name: "SecA", duration: 30, sections: ["A"], questions: [{ questionId: c._id, marks: 1 }], isActive: true, startTime: new Date() });

  let m = mk({ params: { id: t._id }, user: { _id: "u2", username: "s2", section: "B" } });
  await C.getStartTest(m.req, m.res);
  assert.strictEqual(m.out.redirect, "/tests"); assert.match(m.flashes[0][1], /different section/);

  m = mk({ params: { id: t._id }, user: { _id: "u3", username: "s3" } });                       // no section at all
  await C.getStartTest(m.req, m.res);
  assert.match(m.flashes[0][1], /different section/);

  m = mk({ body: { testId: t._id, answers: { [c._id]: "alpha beta" } }, user: { _id: "u2", username: "s2", section: "B" } });
  await C.submitTest(m.req, m.res);
  assert.strictEqual(db.results.length, 0);                                                      // cannot sneak a submit in

  m = mk({ params: { id: t._id }, user: { _id: "u1", username: "s1", section: "A" } });
  await C.getStartTest(m.req, m.res);
  assert.strictEqual(m.out.rendered.view, "startTest");
  m = mk({ body: { testId: t._id, answers: { [c._id]: "alpha beta" } }, user: { _id: "u1", username: "s1", section: "A" } });
  await C.submitTest(m.req, m.res);
  assert.strictEqual(db.results.length, 1);
});

test("result page shows marks out of 20", async () => {
  db.tests.length = 0; db.results.length = 0;
  const q1 = addCard("a", ["a"]), q2 = addCard("b", ["b"]), q3 = addCard("c", ["c"]), q4 = addCard("d", ["d"]);
  const t = await FakeTest.create({ name: "Marks", duration: 30, questions: [q1, q2, q3, q4].map(q => ({ questionId: q._id, marks: 2 })), isActive: true, startTime: new Date() });
  let m = mk({ body: { testId: t._id, answers: { [q1._id]: "a", [q2._id]: "b", [q3._id]: "c", [q4._id]: "zzz" } } });   // 3 of 4 right -> 6/8
  await C.submitTest(m.req, m.res);
  m = mk({ params: { testId: t._id } });
  await C.getResult(m.req, m.res);
  const d = m.out.rendered.data;
  assert.deepStrictEqual([d.totalScore, d.total], [6, 8]);
  assert.deepStrictEqual([d.written, d.examMax], [15, 20]);                                      // 6/8 -> 15 out of 20
});

// ───────────────────────── random pick, teachers ─────────────────────────
const TEACHER = { _id: "t1", username: "t.sharma", displayName: "Mr Sharma", role: "teacher", subjects: ["Bio"] };
const reset = () => { db.tests.length = 0; db.results.length = 0; db.cards.length = 0; };

test("random pick: asking for 4 random questions creates a test with 4 different questions", async () => {
  reset();
  for (let i = 0; i < 10; i++) addCard("x" + i, ["x" + i], "Q" + i, "Bio");
  const m = mk({ body: { name: "Rand", duration: "20", pickMode: "random", randomCount: "4", randomMarks: "2", randomSubject: "Bio", target: "all" } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(m.out.status, 303);
  assert.strictEqual(db.tests.length, 1);
  const q = db.tests[0].questions;
  assert.strictEqual(q.length, 4);
  assert.strictEqual(new Set(q.map(x => String(x.questionId))).size, 4);                        // no repeats
  assert.ok(q.every(x => x.marks === 2));
  assert.strictEqual(db.tests[0].subject, "Bio");
  assert.match(m.flashes[0][1], /4 random questions/);
});

test("random pick: too many / bad numbers are rejected with a clear message", async () => {
  reset();
  for (let i = 0; i < 3; i++) addCard("x", ["x"], "Q", "Bio");
  let m = mk({ body: { name: "R", duration: "20", pickMode: "random", randomCount: "5", randomSubject: "Bio" } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests.length, 0); assert.match(m.flashes[0][1], /Only 3 questions are available in Bio/);
  m = mk({ body: { name: "R", duration: "20", pickMode: "random", randomCount: "0" } });
  await C.createTest(m.req, m.res);
  assert.match(m.flashes[0][1], /1 to 200/);
  m = mk({ body: { name: "R", duration: "20", pickMode: "random", randomCount: "2", randomMarks: "-1" } });
  await C.createTest(m.req, m.res);
  assert.match(m.flashes[0][1], /Marks/);
});

test("random pick without a subject draws from every subject (admin)", async () => {
  reset();
  addCard("a", ["a"], "Q1", "Bio"); addCard("b", ["b"], "Q2", "Phy"); addCard("c", ["c"], "Q3", "Chem");
  const m = mk({ body: { name: "Mix", duration: "20", pickMode: "random", randomCount: "3" } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests[0].questions.length, 3);
});

test("teacher: random questions come only from their own subjects, and the test is theirs", async () => {
  reset();
  addCard("a", ["a"], "Q1", "Bio"); addCard("b", ["b"], "Q2", "Bio"); addCard("c", ["c"], "Q3", "Phy"); addCard("d", ["d"], "Q4", "Phy");
  let m = mk({ user: TEACHER, body: { name: "T1", duration: "20", pickMode: "random", randomCount: "2" } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests.length, 1);
  const t = db.tests[0];
  assert.strictEqual(t.subject, "Bio");                                                          // single subject -> filled in automatically
  assert.ok(t.questions.every(q => db.cards.find(c => c._id === String(q.questionId)).subject === "Bio"));
  assert.deepStrictEqual([t.createdBy, t.createdByName], ["t1", "Mr Sharma"]);

  m = mk({ user: TEACHER, body: { name: "T2", duration: "20", pickMode: "random", randomCount: "3" } });   // only 2 Bio cards exist
  await C.createTest(m.req, m.res);
  assert.match(m.flashes[0][1], /Only 2 questions are available/);

  m = mk({ user: TEACHER, body: { name: "T3", duration: "20", pickMode: "random", randomCount: "1", randomSubject: "Phy" } });
  await C.createTest(m.req, m.res);
  assert.match(m.flashes[0][1], /own subjects/);
  assert.strictEqual(db.tests.length, 1);
});

test("teacher: manual picks outside their subjects are refused; no subject assigned = cannot create", async () => {
  reset();
  const bio = addCard("a", ["a"], "Q1", "Bio"), phy = addCard("b", ["b"], "Q2", "Phy");
  let m = mk({ user: TEACHER, body: { name: "M", duration: "20", subject: "Bio", questionIds: [bio._id, phy._id], marks: ["1", "1"] } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests.length, 0); assert.match(m.flashes[0][1], /own subjects/);

  m = mk({ user: TEACHER, body: { name: "M", duration: "20", subject: "Bio", questionIds: [bio._id], marks: ["1"] } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests.length, 1);

  m = mk({ user: { ...TEACHER, subjects: [] }, body: { name: "M", duration: "20", questionIds: [bio._id], marks: ["1"] } });
  await C.createTest(m.req, m.res);
  assert.match(m.flashes[0][1], /not given you a subject/);
});

test("'Check match %' is stored on when the box is ticked (it is ticked by default in the form)", async () => {
  reset();
  const a = addCard("a", ["a"]);
  let m = mk({ body: { name: "C", duration: "10", questionIds: [a._id], marks: ["1"], allowCheck: "on" } });
  await C.createTest(m.req, m.res);
  assert.strictEqual(db.tests[0].allowCheck, true);
});


// ───────────── resilience: autosave, JSON submit, retries, auto-marking of abandoned drafts ─────────────
test("autosave stores a draft, reopening the test restores it, JSON submit marks it and removes the draft", async () => {
  db.tests.length = 0; db.results.length = 0; db.cards.length = 0; db.drafts.length = 0;
  const a = addCard("alpha beta", ["alpha", "beta"]), b = addCard("gamma", ["gamma"]);
  const t = await FakeTest.create({ name: "Auto", duration: 30, questions: [a, b].map(q => ({ questionId: q._id, marks: 1 })), isActive: true, startTime: new Date() });

  let m = mk({ params: { id: t._id }, body: { answers: { [a._id]: "alpha beta", [b._id]: "x".repeat(9000), "not-a-question": "junk" }, flags: { [a._id]: true, evil: true } } });
  await C.saveDraft(m.req, m.res);
  assert.strictEqual(m.out.json.ok, true);
  assert.strictEqual(db.drafts.length, 1);
  assert.deepStrictEqual(Object.keys(db.drafts[0].answers).sort(), [a._id, b._id].sort());   // junk key dropped
  assert.strictEqual(db.drafts[0].answers[b._id].length, 4000);                                // capped
  assert.deepStrictEqual(Object.keys(db.drafts[0].flags), [a._id]);

  m = mk({ params: { id: t._id } });                                   // refresh / new device
  await C.getStartTest(m.req, m.res);
  assert.strictEqual(m.out.rendered.data.serverDraft.a[a._id], "alpha beta");

  m = mk({ body: { testId: t._id, answers: { [a._id]: "alpha beta", [b._id]: "gamma" } }, is: (ct) => ct === "application/json" });
  await C.submitTest(m.req, m.res);
  assert.deepStrictEqual(m.out.json, { ok: true, redirect: "/result/" + t._id });
  assert.deepStrictEqual([db.results[0].score, db.results[0].total], [2, 2]);
  await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 200));                                                   // the draft is deleted in a background batch
  assert.strictEqual(db.drafts.length, 0);

  m = mk({ body: { testId: t._id, answers: {} }, is: (ct) => ct === "application/json" });       // retry after a lost response
  await C.submitTest(m.req, m.res);
  assert.strictEqual(m.out.json.ok, true); assert.strictEqual(db.results.length, 1); assert.strictEqual(db.results[0].score, 2);
});

test("a submit that arrives after time + grace uses the last autosaved answers instead of losing everything", async () => {
  db.tests.length = 0; db.results.length = 0; db.cards.length = 0; db.drafts.length = 0;
  const a = addCard("alpha", ["alpha"]);
  const t = await FakeTest.create({ name: "Late", duration: 10, questions: [{ questionId: a._id, marks: 1 }], isActive: true, startTime: new Date(Date.now() - 20 * 60000) });
  let m = mk({ body: { testId: t._id, answers: { [a._id]: "alpha" } }, is: (ct) => ct === "application/json" });
  await C.submitTest(m.req, m.res);                                    // no draft -> rejected, nothing stored
  assert.strictEqual(m.out.json.ok, false); assert.strictEqual(m.out.json.final, true); assert.strictEqual(db.results.length, 0);

  db.drafts.push({ _id: oid(), userId: "u1", testId: t._id, answers: { [a._id]: "alpha" }, updatedAt: new Date() });
  m = mk({ body: { testId: t._id, answers: { [a._id]: "cheating after the deadline" } }, is: (ct) => ct === "application/json" });
  await C.submitTest(m.req, m.res);                                    // draft exists -> marks the DRAFT, not the late text
  assert.strictEqual(m.out.json.ok, true); assert.strictEqual(db.results[0].score, 1);
});

test("finalizeDrafts marks abandoned drafts once the test is over, leaves live ones alone", async () => {
  db.tests.length = 0; db.results.length = 0; db.cards.length = 0; db.drafts.length = 0;
  const { finalizeDrafts } = require("../backend/utils/drafts");
  const a = addCard("alpha beta", ["alpha", "beta"]);
  const over = await FakeTest.create({ name: "Over", duration: 10, questions: [{ questionId: a._id, marks: 4 }], isActive: false, isEnded: true, startTime: new Date(Date.now() - 30 * 60000) });
  const live = await FakeTest.create({ name: "Live", duration: 60, questions: [{ questionId: a._id, marks: 4 }], isActive: true, startTime: new Date() });
  db.drafts.push({ _id: oid(), userId: "s1", testId: over._id, answers: { [a._id]: "alpha beta" }, updatedAt: new Date(Date.now() - 25 * 60000) });
  db.drafts.push({ _id: oid(), userId: "s2", testId: live._id, answers: { [a._id]: "alpha beta" }, updatedAt: new Date() });
  db.drafts.push({ _id: oid(), userId: "s3", testId: "f".repeat(24), answers: {}, updatedAt: new Date() });   // test was deleted
  cache.clearExam();
  const made = await finalizeDrafts({ error() {} });
  assert.strictEqual(made, 1);
  assert.deepStrictEqual(db.results.map(r => [r.userId, r.score]), [["s1", 4]]);
  assert.deepStrictEqual(db.drafts.map(d => d.userId), ["s2"]);
});
