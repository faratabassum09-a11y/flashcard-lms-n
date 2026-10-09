// Fast password hashing (no dependencies beyond Node's crypto; unit-tested).
//
// The old hashes (passport-local-mongoose defaults: PBKDF2-SHA256, 25000 rounds, 512-byte output) cost ~16 hash blocks
// per check, i.e. a few hundred milliseconds of CPU each: 300 students logging in together queued for tens of seconds.
// New hashes use the same algorithm and rounds with a 32-byte output (1 block): ~16x faster, still salted PBKDF2.
// The two kinds are told apart by their length (64 hex characters = new), so every existing password keeps working.
const crypto = require("crypto");

const ITERATIONS = 25000, KEYLEN = 32, DIGEST = "sha256";

const derive = (password, salt) => new Promise((resolve, reject) =>
  crypto.pbkdf2(String(password), salt, ITERATIONS, KEYLEN, DIGEST, (e, key) => (e ? reject(e) : resolve(key))));

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: (await derive(password, salt)).toString("hex") };
}

const isFast = (hash) => typeof hash === "string" && hash.length === KEYLEN * 2;

async function verifyFast(hash, salt, password) {
  if (!isFast(hash) || typeof salt !== "string" || !salt) return false;
  const key = await derive(password, salt);
  const stored = Buffer.from(hash, "hex");
  return stored.length === key.length && crypto.timingSafeEqual(stored, key);
}

module.exports = { hashPassword, verifyFast, isFast, ITERATIONS, KEYLEN };
