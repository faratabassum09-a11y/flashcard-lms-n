const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema({
  title:     { type: String, required: true, trim: true, maxlength: 120 },
  body:      { type: String, trim: true, maxlength: 1000, default: "" },
  pinned:    { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
announcementSchema.index({ pinned: -1, createdAt: -1 });

module.exports = mongoose.model("Announcement", announcementSchema);
