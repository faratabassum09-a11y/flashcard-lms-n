// Cached, read-only exam data shared by all students (see cache.js). Never mutate what these return.
const Test      = require("../models/test");
const Flashcard = require("../models/flashcard");
const cache     = require("./cache");
const once      = require("./once");

// The test with the question TEXT only (never answers/keywords) - used to open the exam screen.
async function getTestForStudents(id) {
  const key = "q:" + id;
  let t = cache.exam.get(key);
  if (t === undefined) {
    t = await once(key, () => Test.findById(id).populate({ path: "questions.questionId", select: "question" }).lean());
    if (t) cache.exam.set(key, t);              // a missing test is not cached, so a new test shows up at once
  }
  return t;
}

// The bare test document (status, duration, questions + marks) - used to accept submits and saves.
async function getTestLean(id) {
  const key = "t:" + id;
  let t = cache.exam.get(key);
  if (t === undefined) {
    t = await once(key, () => Test.findById(id).lean());
    if (t) cache.exam.set(key, t);
  }
  return t;
}

// Map<flashcardId, {answer, keywords}> for marking one test.
async function getCardMap(test) {
  const key = "c:" + test._id;
  let m = cache.cards.get(key);
  if (!m) {
    m = await once(key, async () => {
      const ids = test.questions.map(q => q.questionId);
      const cards = await Flashcard.find({ _id: { $in: ids } }).select("answer keywords").lean();
      return new Map(cards.map(c => [String(c._id), c]));
    });
    cache.cards.set(key, m);
  }
  return m;
}

module.exports = { getTestForStudents, getTestLean, getCardMap };
