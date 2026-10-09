const mongoose  = require("mongoose");
const Test      = require("../models/test");
const Result    = require("../models/result");
const Flashcard = require("../models/flashcard");
const User      = require("../models/user");
const { scoreTestDetailed, scaleTo, EXAM_OUT_OF } = require("../utils/scoring");
const { normSection, testOpenTo, testFilterFor } = require("../utils/helpers");
const { sectionCounts, audienceOf } = require("../utils/sections");
const { isStaff, ownTests, allowedSubjects } = require("../utils/roles");
const cache     = require("../utils/cache");
const { pct, gradeFor } = require("../utils/analytics");
const { getTestBoard } = require("./leaderboardController");
const Draft     = require("../models/draft");
const { getTestForStudents, getTestLean } = require("../utils/examData");
const writes    = require("../utils/writes");
const { sanitizeAnswers, sanitizeFlags, storeResult, SUBMIT_GRACE_MS } = require("../utils/drafts");

// Students get a little extra time on the server so a submit that fires exactly
// when the client timer hits 0 (plus network delay, retries) is not rejected.
const GRACE_MS = SUBMIT_GRACE_MS;

const isId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

function shuffleArray(arr) {            // Fisher-Yates (the old sort-based shuffle was biased)
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// live / upcoming / ended, taking the clock into account (the scheduler only runs once a minute)
function statusOf(t, now) {
  if (t.isEnded) return "ended";
  if (t.isActive && t.startTime) {
    return now - new Date(t.startTime).getTime() >= t.duration * 60000 ? "ended" : "live";
  }
  return t.isActive ? "live" : "upcoming";
}

module.exports.getTests = async (req, res) => {
  const isAdmin = isStaff(req.user);
  const secQ = isAdmin ? normSection(req.query.section) : "";
  // students only see tests meant for everyone or for their own section; the admin sees all tests, a teacher only their own,
  // and staff can narrow the list to one section
  const match = isAdmin
    ? { ...ownTests(req.user), ...(secQ ? { $or: [{ sections: { $exists: false } }, { sections: { $size: 0 } }, { sections: secQ }] } : {}) }
    : testFilterFor(req.user);
  const tests = await Test.aggregate([
    { $match: match },
    { $sort: { scheduledStart: -1, _id: -1 } },
    { $project: { name: 1, subject: 1, description: 1, duration: 1, isActive: 1, isEnded: 1, startTime: 1, sections: 1,
                  scheduledStart: 1, scheduledEnd: 1, allowCheck: 1, createdByName: 1, qCount: { $size: { $ifNull: ["$questions", []] } } } }
  ]);
  const now = Date.now();
  let mine = {}, attempts = {}, counts = { list: [], unassigned: 0, total: 0 };

  if (isAdmin) {
    const [g, c] = await Promise.all([
      Result.aggregate([{ $group: { _id: "$testId", n: { $sum: 1 } } }]),
      sectionCounts()
    ]);
    g.forEach(x => { attempts[String(x._id)] = x.n; });
    counts = c;
  } else {
    const rs = await Result.find({ userId: req.user._id }).select("testId score total").lean();
    rs.forEach(r => { mine[String(r.testId)] = { score: r.score, total: r.total, percent: pct(r.score, r.total), written: scaleTo(r.score, r.total, EXAM_OUT_OF) }; });
  }

  tests.forEach(t => {
    t.status = statusOf(t, now);
    t.endsAt = t.startTime ? new Date(new Date(t.startTime).getTime() + t.duration * 60000) : null;
    t.result = mine[String(t._id)] || null;
    t.attempted = attempts[String(t._id)] || 0;
    t.audience = isAdmin ? audienceOf(t, counts) : 0;
    t.sections = t.sections || [];
  });
  // live first, then upcoming (soonest first), then ended (newest first)
  const rank = { live: 0, upcoming: 1, ended: 2 };
  tests.sort((x, y) => rank[x.status] - rank[y.status]);

  res.set("Cache-Control", "no-store");
  res.render("tests", { title: "Tests", tests, totalStudents: counts.total, sections: counts.list, section: secQ });
};

const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]);

module.exports.createTest = async (req, res) => {
  const fail = (msg) => { req.flash("error", msg); return res.redirect("/admin"); };
  try {
    let { name, duration, subject, description, questionIds, marks, scheduledStart, scheduledEnd } = req.body;
    name = String(name || "").trim();
    subject = String(subject || "").trim();
    const dur = Number(duration);
    const allowed = allowedSubjects(req.user);                       // null = admin (any subject); array = teacher
    if (allowed && !allowed.length) return fail("The administrator has not given you a subject yet");

    if (!name)                              return fail("Test name is required");
    if (!Number.isFinite(dur) || dur <= 0)  return fail("Duration must be a positive number of minutes");

    // ── questions: picked by hand, or N random ones from a subject ──
    let formatted;
    if (req.body.pickMode === "random") {
      const count = Math.floor(Number(req.body.randomCount));
      const each = Number(req.body.randomMarks || 1);
      const pick = String(req.body.randomSubject || "").trim();
      if (!Number.isFinite(count) || count < 1 || count > 200) return fail("How many random questions? Enter a number from 1 to 200");
      if (!Number.isFinite(each) || each <= 0)               return fail("Marks must be positive numbers");
      if (pick && allowed && !allowed.includes(pick))        return fail("You can only use your own subjects");
      const match = pick ? { subject: pick } : allowed ? { subject: { $in: allowed } } : {};
      const available = await Flashcard.countDocuments(match);
      if (available < count) return fail(`Only ${available} question${available === 1 ? " is" : "s are"} available${pick ? " in " + pick : ""} — lower the number or add more flashcards`);
      const sample = await Flashcard.aggregate([{ $match: match }, { $sample: { size: count } }, { $project: { _id: 1 } }]);
      formatted = sample.map(c => ({ questionId: c._id, marks: each }));
      if (!subject) subject = pick || (allowed && allowed.length === 1 ? allowed[0] : "");
    } else {
      questionIds = arr(questionIds); marks = arr(marks);
      if (questionIds.length === 0)            return fail("Select at least one question");
      if (!questionIds.every(isId))            return fail("Invalid question selected");
      if (marks.length !== questionIds.length) return fail("Every selected question needs marks");
      formatted = questionIds.map((id, i) => ({ questionId: id, marks: Number(marks[i]) }));
      if (formatted.some(q => !Number.isFinite(q.marks) || q.marks <= 0)) return fail("Marks must be positive numbers");
      const unique = new Set(questionIds).size;
      const existing = await Flashcard.countDocuments(allowed ? { _id: { $in: questionIds }, subject: { $in: allowed } } : { _id: { $in: questionIds } });
      if (existing !== unique) return fail(allowed ? "You can only use questions from your own subjects" : "Some selected questions no longer exist");
    }
    if (allowed) {
      if (!subject && allowed.length === 1) subject = allowed[0];
      if (!allowed.includes(subject)) return fail("Choose the subject of this test from your subjects");
    }

    const toDate = (v) => (v ? new Date(v) : null);
    const start = toDate(scheduledStart), end = toDate(scheduledEnd);
    if ((start && isNaN(start)) || (end && isNaN(end))) return fail("Invalid scheduled date/time");
    if (start && end && end <= start)                   return fail("Scheduled end must be after scheduled start");

    // ── class sections: "all students", or chosen sections (one shared test, or one test per section with its own time) ──
    let secs = [];
    if (req.body.target === "sections") {
      secs = [...new Set(arr(req.body.secOn).map(normSection).filter(Boolean))];
      if (!secs.length) return fail("Choose at least one section, or switch to “All students”");
    }
    const sameTime = secs.length <= 1 || req.body.sameTime === "on";

    const base = {
      subject, duration: dur,
      description: String(description || "").trim().slice(0, 500),
      allowCheck: req.body.allowCheck === "on",
      showReview: req.body.showReview === "on",
      questions: formatted,
      createdBy: req.user._id, createdByName: req.user.displayName || req.user.username
    };

    const docs = [];
    if (sameTime) {
      docs.push({ ...base, name, sections: secs, scheduledStart: start, scheduledEnd: end });
    } else {
      const names = arr(req.body.secName).map(normSection), starts = arr(req.body.secStart), ends = arr(req.body.secEnd);
      const own = new Map(names.map((n, i) => [n, { s: starts[i], e: ends[i] }]));
      for (const sec of secs) {
        const t = own.get(sec) || {};
        const s = t.s ? new Date(t.s) : start, e = t.e ? new Date(t.e) : end;
        if ((s && isNaN(s)) || (e && isNaN(e))) return fail(`Invalid date/time for section ${sec}`);
        if (s && e && e <= s) return fail(`Section ${sec}: end must be after start`);
        docs.push({ ...base, name: `${name} — Sec ${sec}`, sections: [sec], scheduledStart: s, scheduledEnd: e });
      }
    }
    for (const d of docs) await Test.create(d);

    const how = req.body.pickMode === "random" ? ` with ${formatted.length} random question${formatted.length === 1 ? "" : "s"}` : "";
    req.flash("success", docs.length > 1
      ? `${docs.length} tests created${how}, one for each section (${secs.join(", ")}), each with its own timing. Start them from the Tests page or let the schedule start them.`
      : secs.length ? `Test created${how} for section${secs.length > 1 ? "s" : ""} ${secs.join(", ")}. Start it from the Tests page or let the schedule start it.`
                    : `Test created${how}. Start it from the Tests page or let the schedule start it.`);
    return res.redirect(303, "/tests");
  } catch (err) {
    console.error("createTest error:", err);
    return fail("Error creating test");
  }
};

module.exports.getStartTest = async (req, res) => {
  const bounce = (msg) => { req.flash("error", msg); return res.redirect("/tests"); };

  if (!isId(req.params.id)) return bounce("Test not found");

  // Shared (cached) copy of the test: 300 students opening it together cost one database read, not 300.
  const test = await getTestForStudents(req.params.id);
  if (!test) return bounce("Test not found");
  if (!testOpenTo(test, req.user)) return bounce("❌ This test is for a different section");

  const now      = Date.now();
  const start    = test.startTime ? new Date(test.startTime).getTime() : 0;
  const duration = test.duration * 60 * 1000;

  if (!test.isActive && !test.isEnded) return bounce("❌ Test not started yet");
  if (test.isEnded || now - start >= duration) return bounce("❌ Test has ended");

  const [alreadyDone, saved] = await Promise.all([
    writes.hasResult({ testId: test._id, userId: req.user._id }),          // batched: 300 students -> 1 query
    writes.getDraft({ testId: test._id, userId: req.user._id })
  ]);
  if (alreadyDone) return bounce("❌ You have already attempted this test");

  const remainingTime = Math.max(0, Math.floor((start + duration - now) / 1000));
  if (remainingTime <= 0) return bounce("❌ Test time expired");

  // drop questions whose flashcard was deleted after the test was created
  const live = test.questions.filter(q => q.questionId && q.questionId._id);
  if (live.length === 0) return bounce("This test has no valid questions");

  res.render("startTest", {
    test: { ...test, questions: shuffleArray(live) },
    currUser: req.user,
    remainingTime,
    serverDraft: saved ? { a: saved.answers || {}, f: saved.flags || {}, t: new Date(saved.updatedAt).getTime() } : null
  });
};

// Autosave from the exam screen (JSON). Cheap: one cached read + one upsert.
module.exports.saveDraft = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ ok: false });
    const test = await getTestLean(req.params.id);
    if (!test || !testOpenTo(test, req.user) || !test.startTime) return res.status(404).json({ ok: false });
    if (Date.now() > new Date(test.startTime).getTime() + test.duration * 60000 + GRACE_MS) return res.json({ ok: false, over: true });
    const answers = sanitizeAnswers(test, req.body && req.body.answers);
    const flags   = sanitizeFlags(test, req.body && req.body.flags);
    await writes.saveDraft({ userId: req.user._id, testId: test._id, answers, flags });     // batched bulk upsert
    return res.json({ ok: true, t: Date.now() });
  } catch (err) {
    if (err && err.code === 11000) return res.json({ ok: true });      // two saves raced; the other one won
    console.error("saveDraft error:", err.message);
    return res.status(500).json({ ok: false });
  }
};

module.exports.submitTest = async (req, res) => {
  // The exam screen sends JSON (so it can retry safely); a plain form post still works as a fallback.
  const json = !!req.is("application/json");
  const done = (testId) => json ? res.json({ ok: true, redirect: "/result/" + testId }) : res.redirect(303, "/result/" + testId);
  const bounce = (msg, final = true) => {
    if (json) return res.status(final ? 200 : 500).json({ ok: false, final, message: msg.replace(/^❌\s*/, "") });
    req.flash("error", msg); return res.redirect("/tests");
  };
  try {
    const { testId, answers } = req.body || {};
    if (!isId(testId)) return bounce("Invalid test");

    const test = await getTestLean(testId);
    if (!test) return bounce("Invalid test");
    if (!testOpenTo(test, req.user)) return bounce("❌ This test is for a different section");
    if (!test.startTime) return bounce("Test has not started");

    // Past the deadline + grace: do not take new answers, but never throw away what was already auto-saved.
    const late = Date.now() > new Date(test.startTime).getTime() + test.duration * 60000 + GRACE_MS;
    let toMark = answers;
    if (late) {
      const d = await Draft.findOne({ testId: test._id, userId: req.user._id }).select("answers").lean();
      if (!d) return bounce("❌ Time is over - your answers were not accepted");
      toMark = d.answers || {};
    }

    // Marking uses the shared card cache; the unique index (userId+testId) is what stops a second result,
    // so there is no separate "already submitted?" read on this hot path.
    const created = await storeResult(test, req.user._id, sanitizeAnswers(test, toMark));
    if (created) cache.clearBoards();
    writes.deleteDraft({ userId: req.user._id, testId: test._id }).catch(() => {});
    return done(test._id);                                         // PRG: refresh no longer re-submits
  } catch (err) {
    console.error("submitTest error:", err);
    return bounce("Something went wrong while submitting. Please contact your teacher.", false);
  }
};

module.exports.getResult = async (req, res) => {
  if (!isId(req.params.testId)) { req.flash("error", "Result not found"); return res.redirect("/tests"); }
  const [result, test] = await Promise.all([
    Result.findOne({ testId: req.params.testId, userId: req.user._id }).lean(),
    Test.findById(req.params.testId).select("name subject duration isEnded startTime showReview").lean()
  ]);
  if (!result) { req.flash("error", "No result found for this test"); return res.redirect("/tests"); }

  const percentage = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
  const ended = !test || statusOf(test, Date.now()) === "ended";

  let rank = null, participants = 0, top = [], beats = 0, review = null;
  if (ended && test) {
    const board = await getTestBoard(test._id);
    const me = String(req.user._id);
    const mine = board.rows.find(r => r.key === me);
    participants = board.rows.length;
    rank = mine ? mine.rank : null;
    top = board.rows.slice(0, 5).map(r => ({ ...r, isMe: r.key === me }));
    if (mine && participants > 1) beats = Math.round((board.rows.filter(r => r.percent < mine.percent).length / (participants - 1)) * 100);

    if (test.showReview !== false && result.answers && result.answers.length) {
      const cards = await Flashcard.find({ _id: { $in: result.answers.map(a => a.q) } }).select("question answer").lean();
      const byId = new Map(cards.map(c => [String(c._id), c]));
      review = result.answers.filter(a => byId.has(String(a.q))).map(a => ({
        question: byId.get(String(a.q)).question,
        correct:  byId.get(String(a.q)).answer,
        yours:    a.a || "",
        percent:  a.p || 0,
        got: a.m, max: a.t,
        verdict: a.m >= a.t ? "full" : a.m > 0 ? "partial" : "none"
      }));
    }
  }

  res.render("result", {
    title: "Result",
    test: test || { name: "Test", subject: "" },
    totalScore: result.score,
    total: result.total,
    written: scaleTo(result.score, result.total, EXAM_OUT_OF), examMax: EXAM_OUT_OF,
    percentage,
    grade: gradeFor(percentage),
    submittedAt: result.submittedAt,
    ended, rank, participants, top, beats, review
  });
};

module.exports.logEvent = (req, res) => {
  try {
    const { testId, reason, time } = req.body;
    const t = Number(time);
    console.log(`[VIOLATION] user=${req.user.username} test=${String(testId).slice(0, 24)} reason="${String(reason).slice(0, 120)}" time=${new Date(Number.isFinite(t) ? t : Date.now()).toISOString()}`);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
};
