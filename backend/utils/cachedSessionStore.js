// Session store = MongoDB (durable: a server restart does not sign anyone out) + an in-memory copy in front of it.
//
// Why: every page / autosave / submit request used to read the session from MongoDB. Each of those reads was ALSO
// decrypted with a synchronous PBKDF2 key derivation (~10 ms of blocked event loop per request, connect-mongo `crypto` option),
// so 300 students froze the whole server. Now a request is answered from memory; MongoDB is only written when the
// session really changes (login, logout, flash message) and read after a restart.
//
// Single Node process only (that is how this app runs). If you ever run several instances, set SESSION_MEMORY_TTL_MS=0
// or put a shared store (Redis) here.
const session = require("express-session");

const MAX_ENTRIES = 20000;

class CachedSessionStore extends session.Store {
  constructor(inner, { ttlMs = 5 * 60 * 1000 } = {}) {
    super();
    this.inner = inner;
    this.ttlMs = ttlMs;
    this.pending = new Map();
    this.mem = new Map();                                   // sid -> { json, exp }
    if (inner && inner.on) inner.on("error", (e) => this.emit("error", e));
    if (ttlMs > 0) { const t = setInterval(() => this._sweep(), 60 * 1000); t.unref(); }
  }

  _sweep() { const now = Date.now(); for (const [k, v] of this.mem) if (v.exp <= now) this.mem.delete(k); }
  _remember(sid, sess) {
    if (this.ttlMs <= 0) return;
    if (this.mem.size >= MAX_ENTRIES) this.mem.delete(this.mem.keys().next().value);
    this.mem.delete(sid);                                   // re-insert = most recently used goes last
    this.mem.set(sid, { json: JSON.stringify(sess), exp: Date.now() + this.ttlMs });
  }
  _expired(sess) { const e = sess && sess.cookie && sess.cookie.expires; return e && new Date(e).getTime() <= Date.now(); }

  get(sid, cb) {
    const hit = this.mem.get(sid);
    if (hit && hit.exp > Date.now()) {
      const sess = JSON.parse(hit.json);                    // fresh copy: express-session mutates what it is given
      if (this._expired(sess)) { this.mem.delete(sid); return cb(null, null); }
      return cb(null, sess);
    }
    this.inner.get(sid, (err, sess) => {
      if (err) return cb(err);
      if (sess) this._remember(sid, sess);
      cb(null, sess || null);
    });
  }

  // Write-behind: the in-memory copy is the truth for this process, so the request continues at once and MongoDB is updated in the
  // background (in order per session). Only a crash within a few milliseconds of a sign-in could lose it: that student signs in again.
  _persist(sid, op) {
    const prev = this.pending.get(sid) || Promise.resolve();
    const next = prev.then(() => new Promise((resolve) => op((err) => { if (err) this.emit("error", err); resolve(); })));
    this.pending.set(sid, next);
    next.then(() => { if (this.pending.get(sid) === next) this.pending.delete(sid); });
  }

  set(sid, sess, cb) {
    this._remember(sid, sess);
    const snapshot = JSON.parse(JSON.stringify(sess));
    this._persist(sid, (done) => this.inner.set(sid, snapshot, done));
    if (cb) cb();
  }

  touch(sid, sess, cb) {
    const hit = this.mem.get(sid);
    if (hit) hit.exp = Date.now() + this.ttlMs;
    if (this.inner.touch) return this.inner.touch(sid, sess, cb);
    if (cb) cb();
  }

  destroy(sid, cb) {
    this.mem.delete(sid);
    this._persist(sid, (done) => this.inner.destroy(sid, done));
    if (cb) cb();
  }
}

module.exports = CachedSessionStore;
