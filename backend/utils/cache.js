const { ttlCache } = require("./analytics");
// Shared short-lived caches.
//  boards   - leaderboards (cleared whenever a test is submitted/changed)
//  subjects - flashcard subject counts (clearing it also clears the scoring cache, because cards changed)
//  exam     - a test + its question text, shared by every student opening the same test (5 s)
//  cards    - the answers/keywords used to mark a test, shared by every submit (20 s)
// With 300 students this turns ~900 database reads at test start/finish into a handful.
const subjects = ttlCache(60 * 1000);
const cards    = ttlCache(20 * 1000);
const exam     = ttlCache(5 * 1000);
const clearSubjects = subjects.clear.bind(subjects);
subjects.clear = () => { clearSubjects(); cards.clear(); };

module.exports = {
  boards: ttlCache(30 * 1000),
  subjects, cards, exam,
  clearBoards() { this.boards.clear(); },
  clearExam()   { exam.clear(); cards.clear(); }      // call when a test is started / ended / deleted
};
