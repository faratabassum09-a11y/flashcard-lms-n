const User         = require("../models/user");
const Test         = require("../models/test");
const Result       = require("../models/result");
const Flashcard    = require("../models/flashcard");
const Announcement = require("../models/announcement");
const { pct }      = require("../utils/analytics");
const { scaleTo, EXAM_OUT_OF } = require("../utils/scoring");
const { testFilterFor } = require("../utils/helpers");
const { sectionCounts, audienceOf } = require("../utils/sections");
const { isStaff, isSuper, ownTests, allowedSubjects } = require("../utils/roles");
const { getOverallBoard } = require("./leaderboardController");

const TEST_FIELDS = "name subject duration isActive isEnded startTime scheduledStart scheduledEnd sections";

module.exports.getDashboard = async (req, res) => {
  const announcements = await Announcement.find({}).sort({ pinned: -1, createdAt: -1 }).limit(4).lean();

  // ───────── ADMIN / TEACHER ─────────
  if (isStaff(req.user)) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const mine = ownTests(req.user);                              // admin: every test, teacher: only their own
    const allowed = allowedSubjects(req.user);
    const myIds = isSuper(req.user) ? null : (await Test.find(mine).select("_id").lean()).map(t => t._id);
    const resFilter = myIds ? { testId: { $in: myIds } } : {};
    const [counts, totalTests, activeTests, totalFlashcards, submissions24h, upcomingTests, recent, perTest] = await Promise.all([
      sectionCounts(),
      Test.countDocuments(mine),
      Test.countDocuments({ ...mine, isActive: true, isEnded: false }),
      allowed ? Flashcard.countDocuments({ subject: { $in: allowed } }) : Flashcard.estimatedDocumentCount(),
      Result.countDocuments({ ...resFilter, submittedAt: { $gte: since } }),
      Test.find({ ...mine, isEnded: false }).select(TEST_FIELDS).sort({ isActive: -1, scheduledStart: 1 }).limit(5).lean(),
      Result.find(resFilter).sort({ submittedAt: -1 }).limit(8)
        .populate("userId", "username displayName").populate("testId", "name subject").select("userId testId score total submittedAt").lean(),
      Result.aggregate([{ $match: resFilter }, { $group: { _id: "$testId", n: { $sum: 1 } } }])
    ]);
    const attempts = new Map(perTest.map(x => [String(x._id), x.n]));
    const totalStudents = counts.total;
    upcomingTests.forEach(t => { t.attempted = attempts.get(String(t._id)) || 0; t.audience = audienceOf(t, counts); });

    return res.render("dashboard", {
      title: "Overview",
      username: req.user.username,
      announcements,
      stats: { totalStudents, sectionList: counts.list, totalTests, activeTests, totalFlashcards, submissions24h, upcomingTests, recent }
    });
  }

  // ───────── STUDENT ─────────
  const [results, me, totalFlashcards, openTests, board] = await Promise.all([
    Result.find({ userId: req.user._id }).select("testId score total submittedAt")
      .populate("testId", "name subject").sort({ submittedAt: -1 }).lean(),
    User.findById(req.user._id).select("known bookmarks").lean(),
    Flashcard.estimatedDocumentCount(),
    Test.find({ isEnded: false, ...testFilterFor(req.user) }).select(TEST_FIELDS).sort({ isActive: -1, scheduledStart: 1 }).lean(),
    getOverallBoard()
  ]);

  let totalMarks = 0, totalPossible = 0;
  results.forEach(r => { totalMarks += r.score || 0; totalPossible += r.total || 0; });
  const avgScore = pct(totalMarks, totalPossible);

  const done = new Set(results.map(r => String(r.testId && r.testId._id)));
  const available = openTests.filter(t => !done.has(String(t._id)));

  // oldest -> newest for the trend chart
  const trend = results.slice(0, 12).reverse().map(r => ({
    label: r.testId ? r.testId.name : "Test", percent: pct(r.score, r.total)
  }));

  const mine = board.rows.find(r => String(r.key) === String(req.user._id));

  res.render("dashboard", {
    title: "Dashboard",
    username: req.user.username,
    announcements,
    stats: {
      totalTests: results.length,
      totalMarks: Math.round(totalMarks * 10) / 10,
      avgScore, avg20: scaleTo(totalMarks, totalPossible, EXAM_OUT_OF),
      availableTests: available.length,
      available: available.slice(0, 4),
      recentResults: results.slice(0, 5),
      trend,
      mastered: (me && me.known ? me.known.length : 0),
      bookmarked: (me && me.bookmarks ? me.bookmarks.length : 0),
      totalFlashcards,
      rank: mine ? mine.rank : null,
      ranked: board.rows.length
    }
  });
};
