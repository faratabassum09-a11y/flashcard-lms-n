// Batched database access for the exam hot paths (see batcher.js). Each function behaves like the single query it replaces.
const Draft  = require("../models/draft");
const Result = require("../models/result");
const batcher = require("./batcher");

const key = (u, t) => String(u) + "|" + String(t);
const code = (w) => (w && (w.code ?? (w.err && w.err.code)));
const onlyDuplicates = (e) => e && (e.code === 11000 || (Array.isArray(e.writeErrors) && e.writeErrors.length > 0 && e.writeErrors.every(w => code(w) === 11000)));

// Autosave: one bulk upsert for every save that arrives within ~20 ms. Acknowledged by the database before the student sees "ok".
const saveDraft = batcher(async (items) => {
  const last = new Map(items.map(i => [key(i.userId, i.testId), i]));          // two saves of one student in a batch: keep the newest
  const now = new Date();
  const ops = [...last.values()].map(i => ({ updateOne: { filter: { userId: i.userId, testId: i.testId },
    update: { $set: { answers: i.answers, flags: i.flags, updatedAt: now } }, upsert: true } }));
  try { await Draft.bulkWrite(ops, { ordered: false, writeConcern: { w: 1 } }); }
  catch (e) { if (!onlyDuplicates(e)) throw e; }                              // a racing upsert of the same student: the other one won
  return items.map(() => true);
});

// Remove drafts after a successful submit (fire and forget at the call site).
const deleteDraft = batcher(async (items) => {
  await Draft.deleteMany({ $or: items.map(i => ({ userId: i.userId, testId: i.testId })) });
  return items.map(() => true);
}, { delayMs: 100 });

// Insert results; resolves true when THIS call created the result, false when the student already had one.
const insertResult = batcher(async (items) => {
  const firstOf = new Map(); items.forEach((it, i) => { const k = key(it.userId, it.testId); if (!firstOf.has(k)) firstOf.set(k, i); });
  const idx = [...firstOf.values()];
  const ops = idx.map(i => { const it = items[i]; return { updateOne: { filter: { userId: it.userId, testId: it.testId },
    update: { $setOnInsert: { score: it.score, total: it.total, answers: it.details, submittedAt: new Date() } }, upsert: true } }; });
  let created = new Set();
  try {
    const r = await Result.bulkWrite(ops, { ordered: false });
    created = new Set(Object.keys(r.upsertedIds || {}).map(n => idx[Number(n)]));
  } catch (e) { if (!onlyDuplicates(e)) throw e; }                              // already stored by a racing request
  return items.map((_, i) => created.has(i));
});

// "Has this student already submitted?" and "what did they autosave?" for every student opening the test together.
const hasResult = batcher(async (items) => {
  const rows = await Result.find({ $or: items.map(i => ({ userId: i.userId, testId: i.testId })) }).select("userId testId").lean();
  const have = new Set(rows.map(r => key(r.userId, r.testId)));
  return items.map(i => have.has(key(i.userId, i.testId)));
}, { delayMs: 15 });

const getDraft = batcher(async (items) => {
  const rows = await Draft.find({ $or: items.map(i => ({ userId: i.userId, testId: i.testId })) }).select("userId testId answers flags updatedAt").lean();
  const by = new Map(rows.map(r => [key(r.userId, r.testId), r]));
  return items.map(i => by.get(key(i.userId, i.testId)) || null);
}, { delayMs: 15 });

module.exports = { saveDraft, deleteDraft, insertResult, hasResult, getDraft };
