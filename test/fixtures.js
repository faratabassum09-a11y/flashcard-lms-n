// Realistic sample data for every page. Used by views.test.js (render check) and scripts/preview.js (visual check).
const fmt = require("../backend/utils/format");
const { gradeFor, summarize } = require("../backend/utils/analytics");
const now = Date.now(), min = 60000, day = 86400000;
const id = (n) => n.toString(16).padStart(24, "0");
const long = "Photosynthesis is the process by which green plants make food using sunlight, water and carbon dioxide, releasing oxygen.";

const tests = [
  { _id: id(1), name: "Biology — Unit 2 Quiz", subject: "Biology", duration: 30, qCount: 12, status: "live", isActive: true, isEnded: false, startTime: new Date(now - 8 * min), endsAt: new Date(now + 22 * min), scheduledStart: new Date(now - 8 * min), description: "Covers cells and photosynthesis.", attempted: 96, sections: ["A"], audience: 120 },
  { _id: id(2), name: "Physics — Motion & Force", subject: "Physics", duration: 45, qCount: 20, status: "upcoming", isActive: false, isEnded: false, scheduledStart: new Date(now + 2 * day), attempted: 0, sections: ["B"], audience: 90 },
  { _id: id(3), name: "Chemistry — Periodic Table", subject: "Chemistry", duration: 20, qCount: 10, status: "ended", isActive: false, isEnded: true, startTime: new Date(now - 3 * day), scheduledStart: new Date(now - 3 * day), attempted: 180, sections: [], audience: 210, result: { score: 7.5, total: 10, percent: 75, written: 15 } },
  { _id: id(4), name: "Maths — Algebra", subject: "Maths", duration: 60, qCount: 25, status: "ended", isActive: false, isEnded: true, startTime: new Date(now - 6 * day), attempted: 120, sections: [], audience: 210 }
];
const cards = [
  { _id: id(11), subject: "Biology", question: "What is photosynthesis?", answer: long, known: true, bookmarked: false },
  { _id: id(12), subject: "Biology", question: "Which organelle is called the powerhouse of the cell?", answer: "Mitochondria", known: false, bookmarked: true },
  { _id: id(13), subject: "Physics", question: "State Newton's second law of motion.", answer: "Force equals mass times acceleration (F = ma).", known: false, bookmarked: false }
];
const board = [
  { key: "a", name: "Ananya R", percent: 96, score: 48, total: 50, tests: 4, rank: 1 },
  { key: "b", name: "Karthik S", percent: 91.5, score: 45.8, total: 50, tests: 4, rank: 2 },
  { key: "c", name: "Fatima Z", percent: 88, score: 44, total: 50, tests: 4, rank: 3 },
  { key: "d", name: "Rahul M", percent: 74, score: 37, total: 50, tests: 4, rank: 4 },
  { key: "u1", name: "stud1", percent: 62, score: 31, total: 50, tests: 3, rank: 5, isMe: true },
  { key: "f", name: "Divya P", percent: 41, score: 20.5, total: 50, tests: 2, rank: 6 }
].map(r => ({ ...r, grade: gradeFor(r.percent) }));
const ann = [{ title: "Mid-term test on Friday", body: "Bring your ID card. Syllabus: Units 1–3.", pinned: true, createdAt: new Date(now - 3600000) }];

const fixtures = {
  login: { view: "users/login", data: {}, anon: true },
  error: { view: "error", data: { err: { statusCode: 404, message: "Page not found" } } },
  dashboard: { view: "dashboard", data: { username: "stud1", announcements: ann, stats: {
    totalTests: 3, totalMarks: 31, avgScore: 62, avg20: 12.4, availableTests: 2, available: tests.slice(0, 2),
    recentResults: [{ score: 7.5, total: 10, submittedAt: new Date(now - day), testId: { _id: id(3), name: "Chemistry — Periodic Table", subject: "Chemistry" } }],
    trend: [{ label: "A", percent: 40 }, { label: "B", percent: 55 }, { label: "C", percent: 48 }, { label: "D", percent: 72 }, { label: "E", percent: 75 }],
    mastered: 34, bookmarked: 6, totalFlashcards: 240, rank: 5, ranked: 180 } } },
  dashboardAdmin: { view: "dashboard", admin: true, data: { username: "admin", announcements: ann, stats: {
    totalStudents: 210, sectionList: [{ section: "A", count: 120 }, { section: "B", count: 90 }], totalTests: 14, activeTests: 1, totalFlashcards: 640, submissions24h: 96,
    upcomingTests: tests.slice(0, 2), recent: [{ score: 8, total: 10, submittedAt: new Date(), userId: { username: "21A91A0501", displayName: "Ananya R" }, testId: { name: "Biology — Unit 2 Quiz" } }] } } },
  flashcards: { view: "flashcards", data: { cards, subjects: [{ subject: "Biology", count: 120 }, { subject: "Physics", count: 90 }], total: 3, totalCards: 210, page: 1, pages: 3, q: "", subject: "all", filter: "all", masteredCount: 34, bookmarkCount: 6 } },
  study: { view: "study", data: { deck: cards.map(c => ({ id: c._id, s: c.subject, q: c.question, a: c.answer, k: c.known, b: c.bookmarked })), subject: "all", filter: "learning" } },
  tests: { view: "tests", data: { tests, totalStudents: 210, sections: [], section: "" } },
  testsAdmin: { view: "tests", admin: true, data: { tests, totalStudents: 210, sections: [{ section: "A", count: 120 }, { section: "B", count: 90 }], section: "" } },
  startTest: { view: "startTest", anon: false, data: { remainingTime: 1320, test: { _id: id(1), name: "Biology — Unit 2 Quiz", subject: "Biology", duration: 30, description: "Covers cells.", allowCheck: true, questions: cards.map((c, i) => ({ marks: i + 1, questionId: { _id: c._id, question: c.question } })) } } },
  result: { view: "result", data: { test: { _id: id(3), name: "Chemistry — Periodic Table", subject: "Chemistry" }, totalScore: 7.5, total: 10, written: 15, examMax: 20, percentage: 75, grade: gradeFor(75), submittedAt: new Date(now - day), ended: true, rank: 12, participants: 180, beats: 93, top: board.slice(0, 3),
    review: [{ question: cards[0].question, correct: cards[0].answer, yours: "plants make food with sunlight and water", percent: 66, got: 2, max: 4, verdict: "partial" }, { question: cards[1].question, correct: "Mitochondria", yours: "Mitochondria", percent: 100, got: 2, max: 2, verdict: "full" }, { question: cards[2].question, correct: cards[2].answer, yours: "", percent: 0, got: 0, max: 4, verdict: "none" }] } },
  leaderboard: { view: "leaderboard", data: { endedTests: [tests[2], tests[3]], selected: null, mine: board[4], rows: board, participants: 180, sec: "", sections: [], mySection: "A" } },
  leaderboardAdmin: { view: "leaderboard", admin: true, data: { endedTests: [tests[2]], selected: null, mine: null, rows: board, participants: 6, sec: "A", sections: [{ section: "A", count: 120 }], mySection: "" } },
  profile: { view: "profile", data: { user: { username: "stud1", displayName: "Stud One", section: "A", createdAt: new Date(now - 60 * day), known: [], bookmarks: [] },
    results: [{ score: 7.5, total: 10, submittedAt: new Date(now - day), testId: { _id: id(3), name: "Chemistry — Periodic Table", subject: "Chemistry" } }],
    stats: { tests: 1, avg: 75, avg20: 15, grade: gradeFor(75), best: { percent: 75, name: "Chemistry" }, marks: 7.5, mastered: 34, bookmarked: 6, totalCards: 240, rank: 5, ranked: 180 } } },
  settings: { view: "settings", data: { user: { username: "stud1", displayName: "Stud One" } } },
  adminHub: { view: "users/admin", admin: true, data: { pool: cards.map(c => ({ id: c._id, s: c.subject, q: c.question })), subjects: [{ subject: "Biology", count: 2 }, { subject: "Physics", count: 1 }], announcements: ann.map(a => ({ ...a, _id: id(50) })), studentCount: 210, sections: { list: [{ section: "A", count: 120 }, { section: "B", count: 90 }], unassigned: 3, total: 213 } } },
  adminHubNoSections: { view: "users/admin", admin: true, data: { pool: cards.map(c => ({ id: c._id, s: c.subject, q: c.question })), subjects: [{ subject: "Biology", count: 2 }], announcements: [], studentCount: 5, sections: { list: [], unassigned: 5, total: 5 } } },
  adminStudents: { view: "adminStudents", admin: true, data: { users: [{ _id: id(21), username: "21A91A0501", displayName: "Ananya R", section: "A", createdAt: new Date(now - 30 * day), tests: 4, avg: 96, avg20: 19.2 }, { _id: id(22), username: "21A91A0502", createdAt: new Date(), tests: 0, avg: null, avg20: null }], q: "", section: "A", sections: { list: [{ section: "A", count: 120 }, { section: "B", count: 90 }, { section: "C", count: 0 }], unassigned: 3, total: 213 }, page: 1, pages: 1, total: 2, grand: 210, testCount: 14 } },
  adminStudent: { view: "adminStudent", admin: true, data: { student: { _id: id(21), username: "21A91A0501", displayName: "Ananya R", section: "A", createdAt: new Date(now - 30 * day) }, sections: { list: [{ section: "A", count: 120 }], unassigned: 0, total: 120 }, mastered: 12, avg: 75, avg20: 15,
    results: [{ score: 7.5, total: 10, percent: 75, written: 15, grade: gradeFor(75), submittedAt: new Date(), testId: { _id: id(3), name: "Chemistry", subject: "Chemistry" } }] } },
  adminFlashcards: { view: "adminFlashcards", admin: true, data: { subjects: [{ subject: "Biology", count: 120 }], cards: cards.map((c, i) => ({ ...c, keywords: i === 2 ? [] : ["sunlight", "water", "carbon", "dioxide", "oxygen", "glucose"] })), uploads: [{ _id: id(60), filename: "bio.xlsx", subject: "Biology" }], missing: 2, total: 3, page: 1, pages: 1, q: "", subject: "all", totalCards: 210 } },
  adminResults: { view: "adminResults", admin: true, data: { tests: tests.map(t => ({ ...t, avg: 71.4, avg20: 14.3, participation: 80 })), totalStudents: 210 } },
  adminTestResults: { view: "adminTestResults", admin: true, data: { test: { _id: id(3), name: "Chemistry — Periodic Table", subject: "Chemistry", duration: 20, isEnded: true, isActive: false, sections: ["A", "B"] },
    section: "", examMax: 20,
    sectionStats: [{ section: "A", students: 120, submitted: 100, avg: 14.2, high: 19.5 }, { section: "B", students: 90, submitted: 80, avg: 12.9, high: 18 }],
    rows: [{ userId: id(21), username: "21A91A0501", name: "Ananya R", section: "A", attempted: true, score: 9, total: 10, written: 18, percent: 90, grade: gradeFor(90), submittedAt: new Date(), rank: 1 },
           { userId: id(22), username: "21A91A0502", name: "", section: "B", attempted: false, score: null, total: null, written: null, percent: null, grade: null, rank: null }],
    summary: summarize([90, 75, 62, 55, 41, 88, 30]), questions: [{ question: "Hardest question?", avg: 38, full: 3, n: 10, fullPct: 30 }] } },
  adminTeachers: { view: "adminTeachers", admin: true, data: { subjects: [{ subject: "Biology", count: 120 }, { subject: "Physics", count: 90 }],
    teachers: [{ _id: id(81), username: "t.sharma", displayName: "Mr Sharma", subjects: ["Biology", "Zoology"], tests: 3, createdAt: new Date(now - 9 * day) }, { _id: id(82), username: "t.rao", subjects: [], tests: 0, createdAt: new Date() }] } },
  adminTeachersEmpty: { view: "adminTeachers", admin: true, data: { subjects: [], teachers: [] } },
  teacherHub: { view: "users/admin", teacher: true, data: { pool: cards.slice(0, 2).map(c => ({ id: c._id, s: c.subject, q: c.question })), subjects: [{ subject: "Biology", count: 2 }], announcements: [], studentCount: 210, sections: { list: [{ section: "A", count: 120 }, { section: "B", count: 90 }], unassigned: 0, total: 210 } } },
  teacherDashboard: { view: "dashboard", teacher: true, data: { username: "t.sharma", announcements: ann, stats: {
    totalStudents: 210, sectionList: [{ section: "A", count: 120 }], totalTests: 3, activeTests: 1, totalFlashcards: 120, submissions24h: 40, upcomingTests: tests.slice(0, 2), recent: [] } } },
  teacherTests: { view: "tests", teacher: true, data: { tests, totalStudents: 210, sections: [{ section: "A", count: 120 }], section: "" } },
  teacherFlashcards: { view: "adminFlashcards", teacher: true, data: { subjects: [{ subject: "Biology", count: 120 }], mySubjects: ["Biology"], cards: cards.slice(0, 2).map(c => ({ ...c, keywords: ["sunlight"] })), uploads: [], missing: 0, total: 2, page: 1, pages: 1, q: "", subject: "all", totalCards: 120 } },
  adminUploads: { view: "adminUploads", admin: true, data: { userUploads: [{ _id: id(70), filename: "students.xlsx", rows: [{}, {}], uploadedAt: new Date() }], flashcardUploads: [{ _id: id(71), filename: "bio.xlsx", subject: "Biology", rows: [{}], uploadedAt: new Date() }] } },
  adminUploadView: { view: "adminUploadView", admin: true, data: { uploadDoc: { filename: "bio.xlsx", type: "flashcards", subject: "Biology", uploadedAt: new Date() }, rows: [{ question: "Q1", answer: "A1" }], columns: ["question", "answer"], totalRows: 1 } }
};

const baseLocals = (f) => {
  const icons = require("../backend/utils/icons");
  const admin = !!f.admin;
  return {
    success: [], error: [], fmt, icon: icons.icon, sprite: icons.sprite, assetV: "test", path: "/" + f.view,
    isAdmin: admin || !!f.teacher, isSuper: admin, isTeacher: !!f.teacher, title: "Preview",
    currUser: f.anon ? undefined : f.teacher ? { _id: "t1", username: "t.sharma", displayName: "Mr Sharma", role: "teacher", subjects: ["Biology"] }
      : { _id: "u1", username: admin ? "admin" : "stud1", displayName: admin ? undefined : "Stud One" }
  };
};
module.exports = { fixtures, baseLocals };
