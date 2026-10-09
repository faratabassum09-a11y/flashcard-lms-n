// The signed-in user is loaded on EVERY request; caching it for a few seconds removes one database round-trip per page.
const map = new Map();
const TTL = 20 * 1000;
module.exports = {
  get(username) { const h = map.get(username); return h && h.exp > Date.now() ? { ...h.u } : null; },
  set(username, u) { if (map.size > 2000) map.clear(); map.set(username, { u, exp: Date.now() + TTL }); },
  clear() { map.clear(); }
};
