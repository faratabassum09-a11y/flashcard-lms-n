const express     = require("express");
const router      = express.Router();
const isLoggedIn  = require("../middleware/isLoggedIn");
const isStaff     = require("../middleware/isStaff");
const flashcardController = require("../controllers/flashcardController");

const bulkUpload = require("../middleware/uploadFiles");

router.get("/flashcards",               isLoggedIn,          flashcardController.getFlashcards);
router.get("/flashcards/study",         isLoggedIn,          flashcardController.getStudy);
router.post("/flashcards/:id/progress", isLoggedIn,          flashcardController.setProgress);
router.post("/upload-flashcards",       isLoggedIn, isStaff, bulkUpload("/admin/flashcards"), flashcardController.uploadFlashcards);
router.post("/check-answer",            isLoggedIn,          flashcardController.checkAnswer);

module.exports = router;
