const mongoose = require("mongoose");

const resultSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  testId: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },

  score: Number,
  total: Number,

  // per-question detail (q = flashcard id, a = student's answer, p = match %, m = marks awarded, t = marks available)
  answers: [{
    _id: false,
    q: mongoose.Schema.Types.ObjectId,
    a: { type: String, default: "" },
    p: Number,
    m: Number,
    t: Number
  }],

  submittedAt: { type: Date, default: Date.now }
});

resultSchema.index({ userId: 1 });
resultSchema.index({ testId: 1, score: -1 });
resultSchema.index({ userId: 1, testId: 1 }, { unique: true });

module.exports = mongoose.model("Result", resultSchema);
