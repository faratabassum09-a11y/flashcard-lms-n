const mongoose = require("mongoose");

// A class section (A, B, CSE-C ...). Created by the admin so it can be chosen before any student is in it.
const sectionSchema = new mongoose.Schema({
  name:      { type: String, required: true, unique: true, trim: true, maxlength: 20 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Section", sectionSchema);
