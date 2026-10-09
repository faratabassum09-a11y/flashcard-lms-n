// Shared answer-matching / scoring logic (pure functions, unit-tested).

const { generateKeywords, stem } = require("./keywords");

const FULL_MARK_PERCENT = 75;  // >= 75% keyword match -> full marks
const HALF_MARK_PERCENT = 50;  // >= 50% keyword match -> half marks

// Every test is reported out of 20, whatever the per-question marks add up to.
const EXAM_OUT_OF = 20;

// Excel cells can be numbers/dates/objects - always coerce safely to a string.
function toStr(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(toStr).join(" ");
  if (typeof v === "object") return "";
  return String(v);
}

// Unicode-aware (the old /\w/ version erased Hindi/Urdu/Telugu/Arabic text).
function normalizeText(str) {
  return toStr(str)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const stemText = (normalized) => normalized.split(" ").map(stem).join(" ");

// Whole-word / whole-phrase match without building a RegExp per keyword
// (faster for 200 simultaneous submissions and immune to regex edge cases).
// Word endings are forgiven ("network" matches "networks"). userStem can be passed in to avoid recomputing it per keyword.
function matchKeyword(normalizedUserAnswer, keyword, userStem) {
  const kw = normalizeText(keyword);
  if (!kw) return false;
  if ((" " + normalizedUserAnswer + " ").includes(" " + kw + " ")) return true;
  const us = userStem !== undefined ? userStem : stemText(normalizedUserAnswer);
  return (" " + us + " ").includes(" " + stemText(kw) + " ");
}

// Keywords are generated automatically from the answer (see keywords.js); kept under the old name too.
function extractKeywords(answerText) {
  return generateKeywords(answerText);
}

function digitsOnly(s) {
  return (toStr(s).match(/\d+/g) || []).join("");
}

// Returns 0-100: how much of the expected answer the student's text covers.
function matchPercent(userAnswerRaw, flashcard) {
  const user = normalizeText(userAnswerRaw);
  if (!user) return 0;
  const keywords = Array.isArray(flashcard.keywords) && flashcard.keywords.length
    ? flashcard.keywords
    : extractKeywords(flashcard.answer);

  if (keywords.length > 0) {
    const us = stemText(user);
    const hits = keywords.filter(k => matchKeyword(user, k, us)).length;
    return (hits / keywords.length) * 100;
  }
  const ud = digitsOnly(user), cd = digitsOnly(flashcard.answer);
  return ud && ud === cd ? 100 : 0;
}

function marksFor(percent, marks) {
  if (percent >= FULL_MARK_PERCENT) return marks;
  if (percent >= HALF_MARK_PERCENT) return marks * 0.5;
  return 0;
}

// questions: [{questionId, marks}], cardMap: Map<idString, flashcard>, answers: {idString: text}
// Questions whose flashcard was deleted are excluded from the total so students are not penalised.
// Returns the totals plus per-question detail (stored so students can review their test later).
function scoreTestDetailed(questions, cardMap, answers) {
  let score = 0, total = 0;
  const details = [];
  const safeAnswers = answers && typeof answers === "object" ? answers : {};
  for (const q of questions) {
    const id = String(q.questionId);
    const card = cardMap.get(id);
    if (!card) continue;
    const marks = Number(q.marks) > 0 ? Number(q.marks) : 1;
    const raw = toStr(safeAnswers[id]).slice(0, 4000);
    const percent = matchPercent(raw, card);
    const got = marksFor(percent, marks);
    total += marks;
    score += got;
    details.push({ q: q.questionId, a: raw, p: Math.round(percent), m: got, t: marks });
  }
  return { score: Math.round(score * 10) / 10, total, details };
}

function scoreTest(questions, cardMap, answers) {
  const { score, total } = scoreTestDetailed(questions, cardMap, answers);
  return { score, total };
}

// Scales a raw score to a fixed maximum (default 20), one decimal place.
function scaleTo(score, total, max = EXAM_OUT_OF) {
  const s = Number(score), t = Number(total);
  if (!(t > 0) || !Number.isFinite(s)) return 0;
  return Math.round((s / t) * max * 10) / 10;
}

module.exports = {
  scaleTo, EXAM_OUT_OF,
  normalizeText, matchKeyword, extractKeywords, matchPercent, marksFor, scoreTest, scoreTestDetailed, toStr,
  FULL_MARK_PERCENT, HALF_MARK_PERCENT
};
