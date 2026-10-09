// Request coalescing: when many callers ask for the same thing at the same moment (300 students opening the same test),
// only the first one hits the database; the rest wait for that one answer. Failed lookups are not remembered.
const inflight = new Map();
module.exports = function once(key, fn) {
  let p = inflight.get(key);
  if (!p) {
    p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
};
