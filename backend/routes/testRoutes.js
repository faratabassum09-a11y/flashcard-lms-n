const express    = require("express");
const router     = express.Router();
const isLoggedIn = require("../middleware/isLoggedIn");
const isStaff    = require("../middleware/isStaff");
const testController = require("../controllers/testController");

router.get("/tests",             isLoggedIn,          testController.getTests);
router.post("/create-test",      isLoggedIn, isStaff, testController.createTest);
router.get("/test/:id",          isLoggedIn,          testController.getStartTest);
router.post("/test/:id/draft",    isLoggedIn,          testController.saveDraft);
router.post("/submit-test",      isLoggedIn,          testController.submitTest);
router.get("/result/:testId",    isLoggedIn,          testController.getResult);
router.post("/log-event",        isLoggedIn,          testController.logEvent);

module.exports = router;
