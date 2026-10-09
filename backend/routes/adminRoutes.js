const express    = require("express");
const router     = express.Router();
const isLoggedIn = require("../middleware/isLoggedIn");
const isAdmin    = require("../middleware/isAdmin");     // the administrator only
const isStaff    = require("../middleware/isStaff");     // administrator or teacher
const a          = require("../controllers/adminController");

const bulkUpload = require("../middleware/uploadFiles");
const admin = [isLoggedIn, isAdmin];
const staff = [isLoggedIn, isStaff];

// ── create a test (admin + teachers) ──
router.get("/admin",                              ...staff, a.getAdmin);

// ── students, sections, teachers, uploads, announcements: administrator only ──
router.get("/admin/students",                     ...admin, a.getStudents);
router.get("/admin/students/:id",                 ...admin, a.getStudent);
router.post("/upload-users",                      ...admin, bulkUpload("/admin/students"), a.uploadUsers);
router.post("/admin/students",                    ...admin, a.addStudent);
router.post("/admin/students/assign-section",     ...admin, a.assignSection);
router.post("/admin/students/:id/section",        ...admin, a.setStudentSection);
router.post("/admin/students/:id/reset-password", ...admin, a.resetPassword);
router.delete("/admin/students/:id",              ...admin, a.deleteStudent);

router.post("/admin/sections",                    ...admin, a.createSection);
router.post("/admin/sections/delete",             ...admin, a.deleteSection);

router.get("/admin/teachers",                     ...admin, a.getTeachers);
router.post("/admin/teachers",                    ...admin, a.createTeacher);
router.post("/admin/teachers/:id",                ...admin, a.updateTeacher);
router.post("/admin/teachers/:id/reset-password", ...admin, a.resetTeacherPassword);
router.delete("/admin/teachers/:id",              ...admin, a.deleteTeacher);

router.get("/admin/uploads",                      ...admin, a.getUploads);
router.get("/admin/uploads/view/:id",             ...admin, a.viewUpload);
router.delete("/admin/uploads/delete/:id",        ...admin, a.deleteUpload);

router.post("/admin/announcements",               ...admin, a.createAnnouncement);
router.delete("/admin/announcements/:id",         ...admin, a.deleteAnnouncement);

router.get("/admin/template/:kind",               ...staff, a.downloadTemplate);      // students template is admin-only (checked inside)

// ── flashcards: admin (all subjects) + teachers (their own subjects, enforced in the controller) ──
router.get("/admin/flashcards",                   ...staff, a.getAdminFlashcards);
router.post("/admin/flashcards",                  ...staff, a.createFlashcard);
router.post("/admin/flashcards/delete-subject",   ...admin, a.deleteSubject);
router.post("/admin/flashcards/auto-keywords",    ...staff, a.autoKeywords);
router.post("/admin/keywords/preview",            ...staff, a.previewKeywords);
router.put("/admin/flashcards/:id",               ...staff, a.updateFlashcard);
router.delete("/admin/flashcards/:id",            ...staff, a.deleteFlashcard);

// ── results & test controls: admin (all tests) + teachers (their own tests, enforced in the controller) ──
router.get("/admin/results",                      ...staff, a.getResults);
router.get("/admin/results/pdf/:testId",          ...staff, a.downloadResultPDF);
router.get("/admin/results/csv/:testId",          ...staff, a.downloadResultCSV);
router.get("/admin/results/:testId",              ...staff, a.getTestResults);
router.post("/admin/results/:testId/reset/:userId", ...staff, a.resetAttempt);

router.post("/admin/start-test/:id",              ...staff, a.startTest);
router.post("/admin/end-test/:id",                ...staff, a.endTest);
router.post("/admin/duplicate-test/:id",          ...staff, a.duplicateTest);
router.delete("/admin/delete-test/:id",           ...staff, a.deleteTest);

module.exports = router;
