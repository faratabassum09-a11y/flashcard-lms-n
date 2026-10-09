const test = require("node:test");
const assert = require("node:assert");
const S = require("../backend/utils/scoring");

test("normalizeText: case, punctuation, whitespace, non-string input", () => {
  assert.strictEqual(S.normalizeText("  Hello,   WORLD!! "), "hello world");
  assert.strictEqual(S.normalizeText(42), "42");
  assert.strictEqual(S.normalizeText(null), "");
  assert.strictEqual(S.normalizeText({ $ne: 1 }), "");           // object injection -> empty, no crash
});

test("normalizeText keeps non-English scripts", () => {
  assert.strictEqual(S.normalizeText("हिंदी, भाषा!"), "हिंदी भाषा");
  assert.strictEqual(S.normalizeText("اردو زبان"), "اردو زبان");
});

test("matchKeyword is whole-word / whole-phrase", () => {
  assert.ok(S.matchKeyword("plants make food by photosynthesis", "photosynthesis"));
  assert.ok(!S.matchKeyword("photosynthesis", "synthesis"));       // no partial-word credit
  assert.ok(S.matchKeyword("the speed of light", "speed of light"));
  assert.ok(!S.matchKeyword("anything", ""));
  assert.ok(S.matchKeyword("cost is 5 rupees", "5"));
});

test("matchKeyword is safe with regex metacharacters", () => {
  assert.doesNotThrow(() => S.matchKeyword("a b", "(a+)+$[["));
});

test("marksFor thresholds: >=75 full, >=50 half, else 0", () => {
  assert.strictEqual(S.marksFor(100, 5), 5);
  assert.strictEqual(S.marksFor(75, 5), 5);
  assert.strictEqual(S.marksFor(74.9, 5), 2.5);
  assert.strictEqual(S.marksFor(50, 5), 2.5);
  assert.strictEqual(S.marksFor(49.9, 5), 0);
  assert.strictEqual(S.marksFor(0, 5), 0);
});

test("matchPercent with keywords", () => {
  const card = { answer: "x", keywords: ["alpha", "beta", "gamma", "delta"] };
  assert.strictEqual(S.matchPercent("alpha beta gamma delta", card), 100);
  assert.strictEqual(S.matchPercent("Alpha, BETA and gamma", card), 75);
  assert.strictEqual(S.matchPercent("alpha beta", card), 50);
  assert.strictEqual(S.matchPercent("", card), 0);
});

test("matchPercent numeric answers without keywords", () => {
  assert.strictEqual(S.matchPercent("42", { answer: "42", keywords: [] }), 100);
  assert.strictEqual(S.matchPercent("43", { answer: "42", keywords: [] }), 0);
  assert.strictEqual(S.matchPercent("0", { answer: 0, keywords: [] }), 100);   // numeric Excel cell
});

test("extractKeywords drops stopwords/short/duplicate words", () => {
  assert.deepStrictEqual(S.extractKeywords("The water cycle, with water and rain"), ["water", "cycle", "rain"]);
});

test("scoreTest: totals, marks weighting, rounding, deleted cards excluded", () => {
  const cards = new Map([
    ["a", { answer: "red green", keywords: ["red", "green"] }],
    ["b", { answer: "blue", keywords: ["blue"] }],
    ["c", { answer: "x y z w", keywords: ["x", "y", "z", "w"] }],
  ]);
  const questions = [
    { questionId: "a", marks: 5 },
    { questionId: "b", marks: 3 },
    { questionId: "c", marks: 4 },
    { questionId: "deleted", marks: 10 },     // flashcard no longer exists -> not counted
  ];
  // a: 2/2 -> 5 ; b: wrong -> 0 ; c: 2/4=50% -> 2
  const r = S.scoreTest(questions, cards, { a: "Red and Green", b: "yellow", c: "x y" });
  assert.deepStrictEqual(r, { score: 7, total: 12 });
});

test("scoreTest: missing/garbage answers never crash and score 0", () => {
  const cards = new Map([["a", { answer: "k", keywords: ["kk"] }]]);
  for (const bad of [undefined, null, "str", 5, [], { a: { x: 1 } }]) {
    assert.deepStrictEqual(S.scoreTest([{ questionId: "a", marks: 2 }], cards, bad), { score: 0, total: 2 });
  }
});

test("scoreTest: invalid marks fall back to 1", () => {
  const cards = new Map([["a", { answer: "k", keywords: ["k"] }]]);
  assert.deepStrictEqual(S.scoreTest([{ questionId: "a", marks: "abc" }], cards, { a: "k" }), { score: 1, total: 1 });
});
