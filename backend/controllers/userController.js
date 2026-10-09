const User   = require("../models/user");
const Result = require("../models/result");
const Flashcard = require("../models/flashcard");
const { pct, gradeFor } = require("../utils/analytics");
const { scaleTo, EXAM_OUT_OF } = require("../utils/scoring");
const { getOverallBoard } = require("./leaderboardController");

module.exports.getProfile = async (req, res) => {
  const isAdmin = require("../utils/roles").isStaff(req.user);
  const [user, results, totalCards, board] = await Promise.all([
    User.findById(req.user._id).select("username displayName section known bookmarks createdAt").lean(),
    isAdmin ? [] : Result.find({ userId: req.user._id }).select("testId score total submittedAt")
      .populate("testId", "name subject").sort({ submittedAt: -1 }).limit(100).lean(),
    Flashcard.estimatedDocumentCount(),
    isAdmin ? { rows: [] } : getOverallBoard()
  ]);

  let totalMarks = 0, totalPossible = 0, best = null;
  results.forEach(r => {
    totalMarks += r.score || 0; totalPossible += r.total || 0;
    const p = pct(r.score, r.total);
    if (!best || p > best.percent) best = { percent: p, name: r.testId ? r.testId.name : "Test" };
  });
  const avg = pct(totalMarks, totalPossible);
  const mine = board.rows.find(r => r.key === String(req.user._id));

  res.render("profile", {
    title: "Profile",
    user, results,
    stats: {
      tests: results.length, avg, avg20: scaleTo(totalMarks, totalPossible, EXAM_OUT_OF), grade: gradeFor(avg), best,
      marks: Math.round(totalMarks * 10) / 10,
      mastered: (user.known || []).length, bookmarked: (user.bookmarks || []).length, totalCards,
      rank: mine ? mine.rank : null, ranked: board.rows.length
    }
  });
};

module.exports.getSettings = async (req, res) => {
  const user = await User.findById(req.user._id).select("username displayName").lean();
  res.render("settings", { title: "Settings", user });
};

module.exports.updateProfile = async (req, res) => {
  const name = String(req.body.displayName || "").replace(/\s+/g, " ").trim().slice(0, 40);
  await User.updateOne({ _id: req.user._id }, name ? { displayName: name } : { $unset: { displayName: 1 } });
  require("../utils/userCache").clear();
  req.flash("success", name ? "Display name updated" : "Display name removed — your roll number will be shown");
  res.redirect("/settings");
};

module.exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    req.flash("error", "New password must be at least 6 characters");
    return res.redirect("/settings");
  }
  if (newPassword !== confirmPassword) {
    req.flash("error", "New password and confirmation do not match");
    return res.redirect("/settings");
  }
  try {
    if (!(await User.checkPassword(req.user.username, String(currentPassword || "")))) throw new Error("wrong password");
    const user = await User.findById(req.user._id);
    await user.setPasswordFast(newPassword);
    await user.save();
    req.flash("success", "Password changed successfully");
  } catch (err) {
    req.flash("error", "Current password is incorrect");
  }
  res.redirect("/settings");
};
