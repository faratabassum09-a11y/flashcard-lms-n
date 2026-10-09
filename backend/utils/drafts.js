// Draft answers: validation (pure, unit-tested) and the automatic "submit what they had" job.
const Result = require("../models/result");
const Draft  = require("../models/draft");
const Test   = require("../models/test");
const cache  = require("./cache");
const { scoreTestDetailed, toStr } = require("./scoring");
const { getCardMap } = require("./examData");
const writes = require("./writes");

const MAX_ANSWER_CHARS = 4000;
const SUBMIT_GRACE_MS  = 2 * 60 * 1000;   // a late submit (slow network, retries) is still accepted this long after time is up

// Keep only answers that belong to this test, as trimmed-length strings. Anything else is dropped.
function sanitizeAnswers(test, raw) {
  const ok = new Set((test.questions || []).map(q => String(q.questionId && q.questionId._id ? q.questionId._id : q.questionId)));
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!ok.has(k)) continue;
      const s = toStr(v).slice(0, MAX_ANSWER_CHARS);
      if (s) out[k] = s;
    }
  }
  return out;
}
function sanitizeFlags(test, raw) {
  const ok = new Set((test.questions || []).map(q => String(q.questionId && q.questionId._id ? q.questionId._id : q.questionId)));
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const k of Object.keys(raw)) if (ok.has(k) && raw[k]) out[k] = true;
  return out;
}

// Mark one student's answers and store the result. Returns true if a result was created (false = already existed).
// Live submits are batched into bulk writes (writes.insertResult); the background finalizer stores one at a time.
async function storeResult(test, userId, answers, { batched = true } = {}) {
  const cardMap = await getCardMap(test);
  const { score, total, details } = scoreTestDetailed(test.questions, cardMap, answers);
  if (batched) return writes.insertResult({ userId, testId: test._id, score, total, details });
  try {
    await Result.create({ userId, testId: test._id, score, total, answers: details });
    return true;
  } catch (e) {
    if (e && e.code === 11000) return false;
    throw e;
  }
}

// Runs every minute. For every saved draft whose test is over (deadline + grace passed, or the test was ended by
// the teacher and the student has been silent for 3 minutes) it marks the saved answers, so a student whose
// browser died still gets a result. Drafts of deleted tests are removed.
async function finalizeDrafts(log = console) {
  const now = Date.now();
  const drafts = await Draft.find({}).select("userId testId answers updatedAt").limit(2000).lean();
  if (!drafts.length) return 0;
  const byTest = new Map();
  for (const d of drafts) { const k = String(d.testId); if (!byTest.has(k)) byTest.set(k, []); byTest.get(k).push(d); }
  let made = 0;
  for (const [testId, list] of byTest) {
    const test = await Test.findById(testId).lean();
    if (!test) { await Draft.deleteMany({ testId }); continue; }
    const over = test.startTime && now > new Date(test.startTime).getTime() + test.duration * 60000 + SUBMIT_GRACE_MS;
    for (const d of list) {
      const silent = test.isEnded && now - new Date(d.updatedAt).getTime() > 3 * 60000;
      if (!over && !silent) continue;
      try {
        if (await storeResult(test, d.userId, d.answers || {}, { batched: false })) made++;
        await Draft.deleteOne({ _id: d._id });
      } catch (e) { log.error("finalizeDrafts error:", e.message); }
    }
  }
  if (made) cache.clearBoards();
  return made;
}

module.exports = { sanitizeAnswers, sanitizeFlags, storeResult, finalizeDrafts, MAX_ANSWER_CHARS, SUBMIT_GRACE_MS };
