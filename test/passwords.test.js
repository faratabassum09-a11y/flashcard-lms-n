const test = require("node:test");
const assert = require("node:assert");
const P = require("../backend/utils/passwords");

test("fast hash: verifies the right password, rejects wrong ones, salts differ", async () => {
  const a = await P.hashPassword("Roll#1234"), b = await P.hashPassword("Roll#1234");
  assert.strictEqual(a.hash.length, 64); assert.ok(P.isFast(a.hash));
  assert.notStrictEqual(a.salt, b.salt); assert.notStrictEqual(a.hash, b.hash);
  assert.strictEqual(await P.verifyFast(a.hash, a.salt, "Roll#1234"), true);
  assert.strictEqual(await P.verifyFast(a.hash, a.salt, "roll#1234"), false);
  assert.strictEqual(await P.verifyFast(a.hash, a.salt, ""), false);
  assert.strictEqual(await P.verifyFast(a.hash, "other", "Roll#1234"), false);
});

test("old long hashes are not treated as fast hashes, garbage never verifies", async () => {
  assert.strictEqual(P.isFast("a".repeat(1024)), false);
  assert.strictEqual(P.isFast(undefined), false);
  assert.strictEqual(await P.verifyFast("a".repeat(1024), "s", "x"), false);
  assert.strictEqual(await P.verifyFast(undefined, undefined, "x"), false);
});

test("300 hashes finish quickly", async () => {
  const t = Date.now();
  await Promise.all(Array.from({ length: 300 }, (_, i) => P.hashPassword("pw" + i)));
  console.log(`300 fast hashes: ${Date.now() - t} ms`);
  assert.ok(Date.now() - t < 20000);
});
