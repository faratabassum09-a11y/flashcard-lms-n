const mongoose = require("mongoose");
const User   = require("../models/user");
const Test   = require("../models/test");
const Result = require("../models/result");
const cache  = require("../utils/cache");
const once   = require("../utils/once");
const { pct, rankRows, gradeFor } = require("../utils/analytics");
const { isId, nameOf, normSection, testFilterFor } = require("../utils/helpers");
const { sectionCounts } = require("../utils/sections");
const { isStaff, ownTests } = require("../utils/roles");

// Overall board: total marks / total possible across every test a student has taken.
async function getOverallBoard() {
  const hit = cache.boards.get("overall");
  if (hit) return hit;

  return once("board:overall", async () => {
  const groups = await Result.aggregate([
    { $group: { _id: "$userId", score: { $sum: "$score" }, total: { $sum: "$total" }, tests: { $sum: 1 } } }
  ]);
  const users = await User.find({ _id: { $in: groups.map(g => g._id) } }).select("username displayName section").lean();
  const byId = new Map(users.map(u => [String(u._id), u]));

  const rows = groups.filter(g => byId.has(String(g._id)) && byId.get(String(g._id)).username !== "admin").map(g => ({
    key: String(g._id),
    name: nameOf(byId.get(String(g._id))), section: byId.get(String(g._id)).section || "",
    percent: pct(g.score, g.total),
    score: Math.round(g.score * 10) / 10, total: g.total, tests: g.tests
  }));
  return cache.boards.set("overall", { rows: rankRows(rows) });
  });
}

async function getTestBoard(testId) {
  const k = "test:" + testId;
  const hit = cache.boards.get(k);
  if (hit) return hit;

  return once(k, async () => {
  const results = await Result.find({ testId }).select("userId score total").lean();
  const users = await User.find({ _id: { $in: results.map(r => r.userId) } }).select("username displayName section").lean();
  const byId = new Map(users.map(u => [String(u._id), u]));
  const rows = results.filter(r => byId.has(String(r.userId))).map(r => ({
    key: String(r.userId), name: nameOf(byId.get(String(r.userId))), section: byId.get(String(r.userId)).section || "",
    percent: pct(r.score, r.total), score: r.score, total: r.total, tests: 1
  }));
  return cache.boards.set(k, { rows: rankRows(rows) });
  });
}

module.exports.getOverallBoard = getOverallBoard;
module.exports.getTestBoard = getTestBoard;

module.exports.getLeaderboard = async (req, res) => {
  const isAdmin = isStaff(req.user);
  const endedTests = await Test.find({ isEnded: true, ...(isAdmin ? ownTests(req.user) : testFilterFor(req.user)) }).select("name subject scheduledStart startTime").sort({ startTime: -1, _id: -1 }).limit(50).lean();
  const testId = isId(req.query.test) ? req.query.test : null;
  const selected = testId ? endedTests.find(t => String(t._id) === testId) : null;

  // "My section" (students) / any section (admin) narrows the board; ranks are recalculated inside that section
  const scopeQ = String(req.query.sec || "");
  const sec = scopeQ === "mine" ? (req.user.section || "") : isAdmin ? normSection(scopeQ) : "";
  const sections = isAdmin ? (await sectionCounts()).list : [];

  const board = selected ? await getTestBoard(selected._id) : await getOverallBoard();
  const all = sec ? rankRows(board.rows.filter(r => r.section === sec).map(r => ({ ...r }))) : board.rows;
  const me = String(req.user._id);
  const mine = all.find(r => r.key === me) || null;

  res.render("leaderboard", {
    title: "Leaderboard",
    endedTests, selected, mine, sec, sections, mySection: req.user.section || "",
    rows: all.slice(0, 50).map(r => ({ ...r, isMe: r.key === me, grade: gradeFor(r.percent) })),
    participants: all.length
  });
};
