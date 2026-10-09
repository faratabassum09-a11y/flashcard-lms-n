const mongoose = require("mongoose");

const testSchema = new mongoose.Schema({
  name: String,
  subject: String,
  description: { type: String, trim: true, maxlength: 500 },
  duration: Number,

  questions: [
    {
      questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Flashcard" },
      marks: { type: Number, default: 1 }
    }
  ],

  // which class sections write this test (empty = every student). Each section can have its own test/time.
  sections: { type: [String], default: [] },

  // who created it (teachers only see and manage their own tests; the admin sees everything)
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  createdByName: { type: String, trim: true },

  isActive: { type: Boolean, default: false },
  isEnded:  { type: Boolean, default: false },
  startTime: Date,

  // options (old tests have none of these -> sensible defaults below)
  allowCheck: { type: Boolean, default: false },   // show the "Check match %" button during the test
  showReview: { type: Boolean, default: true },    // after the test ends, students can review answers

  //scheduled window
  scheduledStart: Date,   // e.g. "2025-05-07T10:00"
  scheduledEnd:   Date    // e.g. "2025-05-07T10:30"
});

testSchema.index({ isActive: 1, isEnded: 1 });
testSchema.index({ scheduledStart: 1 });

module.exports = mongoose.model("Test", testSchema);
