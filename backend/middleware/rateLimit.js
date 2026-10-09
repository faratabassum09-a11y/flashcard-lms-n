// Tiny in-memory fixed-window rate limiter (no extra dependency).
// Fine for a single Node process; use a shared store (Redis) if you run several instances.
module.exports = function rateLimit({ windowMs, max, keyFn, onLimit }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  timer.unref();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    h.count++;
    if (h.count > max) {
      res.set("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return onLimit(req, res);
    }
    next();
  };
};
