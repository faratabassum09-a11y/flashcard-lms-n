const mongoose = require("mongoose");

// Work-in-progress answers saved from the exam screen every few seconds.
// If a student's browser crashes, their battery dies or the network drops at the end, nothing is lost:
// they get the answers back when they reopen the test, and anything still unsubmitted after the test
// is over is marked automatically from the last saved copy (see utils/drafts.js).
const draftSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  testId:  { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
  answers: { type: mongoose.Schema.Types.Mixed, default: {} },   // { flashcardId: "text" }
  flags:   { type: mongoose.Schema.Types.Mixed, default: {} },   // { flashcardId: true }
  updatedAt: { type: Date, default: Date.now }
}, { minimize: false });

draftSchema.index({ userId: 1, testId: 1 }, { unique: true });
draftSchema.index({ testId: 1 });
draftSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });   // housekeeping

module.exports = mongoose.model("Draft", draftSchema);
