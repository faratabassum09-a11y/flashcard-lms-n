const mongoose = require("mongoose");
const passportLocalMongoose = require("passport-local-mongoose").default;
const passwords = require("../utils/passwords");
const batcher = require("../utils/batcher");

const userSchema = new mongoose.Schema({
  username:    { type: String, required: true, unique: true },
  displayName: { type: String, trim: true, maxlength: 40 },   // shown on leaderboards instead of the roll number
  section:     { type: String, trim: true, maxlength: 20, index: true },   // class section, e.g. "A", "CSE-B" (empty = not assigned)
  role:        { type: String, enum: ["student", "teacher"], default: "student" },   // the account named "admin" is the administrator
  subjects:    [{ type: String, trim: true }],                                         // teachers: the subjects they may create tests / flashcards for
  uploadBatch: String,
  known:       [{ type: mongoose.Schema.Types.ObjectId }],      // flashcards the student marked "mastered"
  bookmarks:   [{ type: mongoose.Schema.Types.ObjectId }],      // flashcards the student saved
  createdAt:   { type: Date, default: Date.now }
});
userSchema.plugin(passportLocalMongoose);

// ── Fast passwords (see utils/passwords.js) ──
// Create an account with a fast hash. Throws an error named "UserExistsError" for a duplicate username (same as register()).
userSchema.statics.registerFast = async function (fields, password) {
  const { salt, hash } = await passwords.hashPassword(password);
  try {
    return await this.create({ ...fields, salt, hash });
  } catch (e) {
    if (e && e.code === 11000) { const x = new Error("A user with the given username is already registered"); x.name = "UserExistsError"; throw x; }
    throw e;
  }
};
// Set a new password on a loaded user document (call save() afterwards).
userSchema.methods.setPasswordFast = async function (password) {
  const { salt, hash } = await passwords.hashPassword(password);
  this.salt = salt; this.hash = hash;
};
// Check a username + password. New (fast) hashes are verified here; an old slow hash is verified by the library exactly as
// before and, on success, replaced by a fast one - so each student pays the slow check once, then every login is fast.
// 300 students signing in together = one database query instead of 300.
userSchema.statics.findForLogin = batcher(async (names) => {
  const docs = await mongoose.model("User").find({ username: { $in: [...new Set(names)] } }).select("+hash +salt");
  const by = new Map(docs.map(d => [d.username, d]));
  return names.map(n => by.get(n) || null);
}, { delayMs: 15 });
userSchema.statics.findLeanForSession = batcher(async (names) => {
  const docs = await mongoose.model("User").find({ username: { $in: [...new Set(names)] } }).select("username displayName section role subjects").lean();
  const by = new Map(docs.map(d => [d.username, d]));
  return names.map(n => by.get(n) || null);
}, { delayMs: 15 });
userSchema.statics.checkPassword = async function (username, password) {
  const user = await this.findForLogin(String(username));
  if (!user) return null;
  if (passwords.isFast(user.hash)) return (await passwords.verifyFast(user.hash, user.salt, password)) ? user : null;
  const legacy = this.authenticate();                       // the library's own check, unchanged
  const ok = await new Promise((resolve) => legacy(username, password, (err, u) => resolve(!err && !!u)));
  if (!ok) return null;
  try {
    const f = await passwords.hashPassword(password);
    await this.updateOne({ _id: user._id }, { $set: { salt: f.salt, hash: f.hash } });
  } catch (e) { /* upgrade is best-effort; the login itself succeeded */ }
  return user;
};

module.exports = mongoose.model("User", userSchema);
