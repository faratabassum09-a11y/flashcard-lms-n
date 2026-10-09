const express     = require("express");
const router      = express.Router();
const isLoggedIn  = require("../middleware/isLoggedIn");
const dashboardController   = require("../controllers/dashboardController");
const leaderboardController = require("../controllers/leaderboardController");

router.get("/dashboard",   isLoggedIn, dashboardController.getDashboard);
router.get("/leaderboard", isLoggedIn, leaderboardController.getLeaderboard);

module.exports = router;
