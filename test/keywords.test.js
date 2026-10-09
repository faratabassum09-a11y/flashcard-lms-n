const test = require("node:test");
const assert = require("node:assert");
const { generateKeywords, parseKeywordList, stem } = require("../backend/utils/keywords");
const S = require("../backend/utils/scoring");

test("keywords: filler words are dropped, order of appearance kept", () => {
  assert.deepStrictEqual(generateKeywords("The water cycle, with water and rain"), ["water", "cycle", "rain"]);
});

test("keywords: one-word and tiny answers still get a keyword", () => {
  assert.deepStrictEqual(generateKeywords("Mitochondria"), ["mitochondria"]);
  assert.deepStrictEqual(generateKeywords("F = ma"), ["f", "ma"]);
  assert.deepStrictEqual(generateKeywords("42"), ["42"]);
});

test("keywords: numbers and acronyms are kept, long answers are capped", () => {
  const k = generateKeywords("TCP/IP is a suite of 7 layered protocols used on the Internet; HTTP runs over TCP in 1991 designs.");
  for (const w of ["tcp", "ip", "7", "http", "1991"]) assert.ok(k.includes(w), w + " should be a keyword");
  const long = generateKeywords("Plants make food using sunlight, water and carbon dioxide, releasing oxygen in a process called Photosynthesis inside chloroplasts with chlorophyll pigments absorbing light energy to build glucose sugar molecules for growth");
  assert.ok(long.length >= 3 && long.length <= 8, "capped at 8, got " + long.length);
});

test("keywords: plural/singular duplicates count once; other scripts work", () => {
  assert.deepStrictEqual(generateKeywords("Plants and plant roots"), ["plants", "roots"]);
  assert.deepStrictEqual(generateKeywords("భారతదేశం రాజధాని న్యూఢిల్లీ"), ["భారతదేశం", "రాజధాని", "న్యూఢిల్లీ"]);
  assert.deepStrictEqual(generateKeywords(""), []);
  assert.deepStrictEqual(generateKeywords(null), []);
});

test("keywords: typed list parsing", () => {
  assert.deepStrictEqual(parseKeywordList("a, b;c\n d ,, "), ["a", "b", "c", "d"]);
  assert.deepStrictEqual(parseKeywordList(""), []);
});

test("marking forgives word endings (network / networks)", () => {
  const card = { answer: "x", keywords: ["network", "protocol", "layer"] };
  assert.strictEqual(S.matchPercent("computer networks use protocols in layers", card), 100);
  assert.strictEqual(S.matchPercent("nothing relevant", card), 0);
  assert.ok(stem("studies") === "study" && stem("boxes") === "box" && stem("class") === "class");
});

test("auto keywords + marking work together: an answer in the student's own words earns marks", () => {
  const model = "Photosynthesis is the process by which green plants make food using sunlight, water and carbon dioxide.";
  const card = { answer: model, keywords: generateKeywords(model) };
  assert.ok(S.matchPercent("Green plants prepare food from sunlight and water through photosynthesis", card) >= 50);
  assert.strictEqual(S.matchPercent("The mitochondria is the powerhouse", card), 0);
});

test("marks are reported out of 20", () => {
  assert.strictEqual(S.scaleTo(6, 12), 10);
  assert.strictEqual(S.scaleTo(7.5, 10), 15);
  assert.strictEqual(S.scaleTo(1, 3), 6.7);
  assert.strictEqual(S.scaleTo(0, 0), 0);
  assert.strictEqual(S.scaleTo(5, 5), 20);
  assert.strictEqual(S.EXAM_OUT_OF, 20);
});
