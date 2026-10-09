const mongoose = require("mongoose");

// Presentation marks (out of 5) entered by the teacher for a student in a test.
// Kept separate from Result so a student who presented but did not write the test can still get marks.
const presentationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  testId: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
  marks:  { type: Number, min: 0, max: 5, required: true },
  updatedAt: { type: Date, default: Date.now }
});
presentationSchema.index({ testId: 1, userId: 1 }, { unique: true });
presentationSchema.index({ userId: 1 });

module.exports = mongoose.model("Presentation", presentationSchema);
