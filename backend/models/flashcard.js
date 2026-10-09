const mongoose = require("mongoose");
const flashcardSchema = new mongoose.Schema({
  subject: {
    type: String,
    required: true,
    trim: true
  },

  question: {
    type: String,
    required: true,
    trim: true
  },

  answer: {
    type: String,
    required: true,
    trim: true
  },

  keywords: {
    type: [String],
    default: []
  },

  // which Excel upload created this card (lets "delete upload" remove exactly its cards)
  uploadId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  }
});

flashcardSchema.index({ subject: 1 });

module.exports = mongoose.model("Flashcard", flashcardSchema);