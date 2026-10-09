// Session memory cache + request coalescing (no database needed).
const test = require("node:test");
const assert = require("node:assert");
const CachedSessionStore = require("../backend/utils/cachedSessionStore");
const once = require("../backend/utils/once");

const fakeInner = () => { const db = new Map(); let reads = 0, writes = 0;
  return { db, get reads() { return reads; }, get writes() { return writes; },
    get: (sid, cb) => { reads++; cb(null, db.has(sid) ? JSON.parse(db.get(sid)) : null); },
    set: (sid, s, cb) => { writes++; db.set(sid, JSON.stringify(s)); cb && cb(); },
    destroy: (sid, cb) => { db.delete(sid); cb && cb(); }, touch: (sid, s, cb) => cb && cb() }; };
const tick = () => new Promise(r => setTimeout(r, 5));
const p = (fn) => new Promise((res, rej) => fn((e, v) => e ? rej(e) : res(v)));

test("reads come from memory after the first save, and are independent copies", async () => {
  const inner = fakeInner(), st = new CachedSessionStore(inner);
  await p(cb => st.set("a", { cookie: {}, passport: { user: "u1" } }, cb));
  const x = await p(cb => st.get("a", cb)); x.passport.user = "changed";
  const y = await p(cb => st.get("a", cb));
  await tick();
  assert.equal(y.passport.user, "u1"); assert.equal(inner.reads, 0); assert.equal(inner.writes, 1);   // saved in the background
});
test("after a restart the session is loaded from the database once, then cached", async () => {
  const inner = fakeInner(); inner.db.set("b", JSON.stringify({ cookie: {}, n: 1 }));
  const st = new CachedSessionStore(inner);
  await p(cb => st.get("b", cb)); await p(cb => st.get("b", cb));
  assert.equal(inner.reads, 1);
});
test("destroy removes it everywhere; expired cookies are not served", async () => {
  const inner = fakeInner(), st = new CachedSessionStore(inner);
  await p(cb => st.set("c", { cookie: {} }, cb)); await p(cb => st.destroy("c", cb)); await tick();
  assert.equal(await p(cb => st.get("c", cb)), null); assert.equal(inner.db.has("c"), false);   // background ops run in order
  await p(cb => st.set("d", { cookie: { expires: new Date(Date.now() - 1000).toISOString() } }, cb));
  assert.equal(await p(cb => st.get("d", cb)), null);
});
test("once(): 300 simultaneous callers share one lookup; errors are not remembered", async () => {
  let n = 0; const slow = () => new Promise(r => setTimeout(() => r(++n), 20));
  const r = await Promise.all(Array.from({ length: 300 }, () => once("k", slow)));
  assert.equal(n, 1); assert.ok(r.every(v => v === 1));
  await assert.rejects(once("e", async () => { throw new Error("x"); }));
  assert.equal(await once("e", async () => 5), 5);
});
