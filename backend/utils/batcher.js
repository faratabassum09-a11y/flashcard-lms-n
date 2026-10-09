// Micro-batching: many callers within a few milliseconds are served by ONE database round trip.
//   const save = batcher(async (items) => { ...one bulk query...; return items.map(() => result); }, { delayMs: 20 });
//   const r = await save(item);
// 300 students pressing submit in the same second become a handful of bulk writes instead of 300 separate ones, which matters
// most when the database is not on the same machine (every round trip then costs 50-300 ms).
module.exports = function batcher(flush, { delayMs = 20, max = 300 } = {}) {
  let queue = [], timer = null;
  const run = async () => {
    timer = null;
    const items = queue; queue = [];
    try {
      const out = await flush(items.map(i => i.v));
      items.forEach((it, i) => it.resolve(out[i]));
    } catch (e) { items.forEach(it => it.reject(e)); }
  };
  return (v) => new Promise((resolve, reject) => {
    queue.push({ v, resolve, reject });
    if (queue.length >= max) { clearTimeout(timer); run(); }
    else if (!timer) timer = setTimeout(run, delayMs);
  });
};
