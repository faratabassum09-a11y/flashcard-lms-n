const test = require("node:test");
const assert = require("node:assert");
const A = require("../backend/utils/analytics");

test("rankRows: competition ranking with ties", () => {
  const r = A.rankRows([{ name: "a", percent: 90 }, { name: "b", percent: 90 }, { name: "c", percent: 70 }, { name: "d", percent: 95 }]);
  assert.deepStrictEqual(r.map(x => [x.name, x.rank]), [["d", 1], ["a", 2], ["b", 2], ["c", 4]]);
});
test("gradeFor bands", () => {
  assert.strictEqual(A.gradeFor(95).letter, "A+"); assert.strictEqual(A.gradeFor(75).letter, "B");
  assert.strictEqual(A.gradeFor(40).letter, "E"); assert.strictEqual(A.gradeFor(10).letter, "F");
});
test("summarize: stats and 10 bins (100 lands in the last bin)", () => {
  const s = A.summarize([100, 90, 50, 40, 10]);
  assert.strictEqual(s.count, 5); assert.strictEqual(s.avg, 58); assert.strictEqual(s.median, 50);
  assert.strictEqual(s.high, 100); assert.strictEqual(s.low, 10); assert.strictEqual(s.passRate, 80);
  assert.strictEqual(s.bins[9].count, 2); assert.strictEqual(s.bins.reduce((a, b) => a + b.count, 0), 5);
  assert.strictEqual(A.summarize([]).count, 0);
});
test("pct handles zero totals", () => { assert.strictEqual(A.pct(5, 0), 0); assert.strictEqual(A.pct(1, 3), 33.3); });
test("ttlCache expires and clears", async () => {
  const c = A.ttlCache(20); c.set("k", 1); assert.strictEqual(c.get("k"), 1);
  await new Promise(r => setTimeout(r, 30)); assert.strictEqual(c.get("k"), undefined);
  c.set("x", 2); c.clear(); assert.strictEqual(c.get("x"), undefined);
});
test("format helpers never throw on bad input", () => {
  const f = require("../backend/utils/format");
  assert.strictEqual(f.date(null), "—"); assert.strictEqual(f.local("nope"), ""); assert.strictEqual(f.initials(""), "?");
  assert.match(f.ago(new Date()), /just now/);
});
