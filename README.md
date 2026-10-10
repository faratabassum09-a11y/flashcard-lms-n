# Flashcard LMS

## Run
```
npm install
cp .env.example .env      # fill in MONGO_URI and SESSION_SECRET
npm run seed:admin        # creates user "admin" (password from ADMIN_PASSWORD)
npm start
```
Health check for your host: `GET /healthz`.

## Test
```
npm test                  # scoring/marks, PDF + Excel importers, ranking/analytics, create->take->submit->marks flow, every page rendered. Includes: scoring/marks, ranking/analytics, create->take->submit->marks flow, every page rendered (no DB needed)
node scripts/preview.js   # look at every page with sample data, no database: http://localhost:4000
npm start                 # in another terminal, against a TEST database
npm run e2e               # full end-to-end against the real running server + MongoDB
STUDENTS=300 npm run load # 300 students log in, open the test, autosave and submit at the same time
```

## Marks rules
Each question's keywords are matched as whole words (word endings forgiven): >= 75% matched = full marks, >= 50% = half marks, else 0.
Keywords are generated automatically from the answer (teachers can still edit them). The test total is shown **out of 20**.
Students can be put in **sections**; a test can be set for chosen sections, each with its own start/end time.

## What was fixed / improved
See the Changelog at the end of this file.


## What's in the app
**Students** — dashboard (stats, score trend, live tests with countdown, announcements), flashcards (search, subject filter, flip, save, mark mastered, paginated),
study mode (keyboard driven, shuffle, "test yourself"), tests (Live / Upcoming / Completed), exam screen (autosave, flag for review, question palette),
result page (grade, rank, percentile, full answer review once the test ends), leaderboard (overall and per test), profile, settings (display name, password, theme).

**Admin** — overview, create test (fast question picker, options), tests (start / end / duplicate / delete), results with analytics (score distribution,
hardest questions, CSV + PDF export, reset a student's attempt), students (search, add one, Excel/CSV/PDF bulk upload, reset password, delete, per-student history),
flashcard manager (add / edit / delete / delete subject / bulk Excel, CSV or PDF upload), announcements, upload history, Excel templates.

## Files
- `frontend/public/css/style.css` — the single design system (dark + light themes, responsive). `frontend/public/js/` — small per-page scripts.
- `backend/utils/` — `analytics.js` (ranking, grades, stats), `format.js` (dates), `icons.js` (inline SVG icons), `cache.js`.

## Roles
- **admin** (username `admin`): everything — students, sections, teachers, uploads, all tests.
- **teacher** (created in Admin → Teachers): signs in on the normal login page; can create tests (manual pick or N random questions), manage flashcards and see results — only for their own subjects and own tests.
- **student**: takes tests of their section (or tests for all students).

---

## Changelog

## Changes

### v6.3 — fast logins (the real bottleneck for 300 students)
- Password checks were the slowest thing in the app: each one cost a few hundred milliseconds of CPU, so 300 logins in the same second queued for tens of seconds (and uploading 300 students took ~20 s). New passwords now use a **16x cheaper** salted PBKDF2 (same algorithm and rounds, shorter output): measured 3.8 ms vs 61 ms per hash.
- **Nobody is locked out.** Old passwords keep working: the first login of an existing account is checked the old way (once) and the account is upgraded to the fast hash automatically; every login after that is fast. New students, teachers, uploads, password resets and password changes use the fast hash straight away.
- Bulk student upload creates 24 accounts at a time (was 8).
- A POST without a body no longer crashes a page.
- New `test/passwords.test.js`.

### v6.2 — built for 300 students writing at once, without disruption
**No answer can be lost any more**
- **Autosave on the server** (new `drafts` collection): the exam screen saves every ~15 s (only when something changed) and when the page is closed. Reopen the test on the same or another device and your answers are back.
- **Submit retries by itself.** The test is sent in the background; if the network blips or the server is busy, the screen says "Your answers are safe. Trying again in Ns…" and retries until it works (a Retry button is there too). Answers stay on the device until the server confirms. Submitting twice is safe (one result per student).
- **Auto-marking safety net**: a student whose browser crashed, battery died or Wi-Fi dropped at the end gets a result anyway: every minute the server marks the last saved answers of any test that is over. A late submit (after the 2-minute grace) marks the last autosaved copy instead of throwing the work away.
- Grace for a submit that arrives after the clock hits 0 is now **2 minutes** (was 1) so retries can finish. The clock-out submits are spread over ~3 s instead of 300 in the same second.
- Offline / signed-out banner on the exam screen; answer boxes limited to 4000 characters.

**Faster under load**
- 300 students opening the same test now cost **one** database read (shared 5 s cache) instead of 300+; marking reuses a shared answers cache (20 s) and no longer does a separate "already submitted?" read. Cleared automatically on start / end / delete, on the scheduler tick and on any flashcard change.
- "Check match %" uses the same caches (was 2 reads per click).
- Autosave rate limit 40/min per student.
- `npm run load` now simulates **300 students** and also exercises autosave + both submit paths.

**Tests**: new tests for autosave, restore, JSON submit, retry, late submit and auto-marking. The old "late submit" test was adjusted to the new 2-minute grace.

### v6.1 — fixes: "Could not add student / teacher" and slow pages
- The real reason is now shown on screen and printed in the console (before, every failure said just "Could not add…").
- On start-up the server removes leftover **unique indexes** on the users collection left by older projects (e.g. `email_1`) — they blocked every new account. Only `username` may be unique.
- Console now prints **"Database round-trip: N ms"** and warns when the database is far away (the usual cause of slow pages), and logs any page slower than 0.8 s as `[SLOW]`.
- Fewer database round-trips per page: the signed-in user and the section counts are remembered for a few seconds.

### v6 — teachers, section dropdown, random questions

- **Presentation marks removed.** Results are simply **out of 20** everywhere (student result, profile, dashboard, admin results, CSV, PDF).
- **Students page:** one **Section dropdown** — "All students (total)", every section with its count, and "No section". Choosing one lists exactly that section's students. **New section** button creates the option immediately (even with 0 students); typing a new section when adding / uploading / moving students creates it automatically. An empty section can be deleted.
- **Teachers** (Admin → Teachers): the admin creates a teacher (username, password, subjects) who signs in on the normal login page and gets a teacher console: create tests, add/edit flashcards, see results — **only for their own subjects and their own tests**. Teachers cannot see other teachers' tests/results, students management, uploads or announcements. This is enforced on the server (create, pick questions, start/end/delete/duplicate, results, CSV/PDF, flashcards, uploads). The admin still sees everything (each test shows who created it).
- **Choose questions: two ways** — *Pick manually* (as before) or *Pick randomly*: enter how many (e.g. 10), the subject (or all), marks per question, and the system picks that many different random questions when the test is created. Shows how many are available and refuses if you ask for more.
- **"Check match %" during the test is now ticked by default** (untick for a strict test).
- Fix: `npm run seed:admin` now reads the `.env` in the project root.

### v5 — class sections, automatic keywords, marks out of 20 + presentation out of 5

**Sections (A, B, C ... / CSE-A)**
- Every student can have a **section**: set when adding one student, with a `section` column in Excel/CSV/PDF uploads, a "section for everyone in these files" box on upload, per student, or by ticking several students and pressing **Move to section**.
- Admin → Students has section tabs (All / Section A / B / No section) with counts, a Section column, and search inside a section.
- **Create test → "Who writes this test?"**: *All students*, or *Selected sections*. Sections that write **at the same time** share one test; untick "Same time" and give each section **its own start and end time** — one test is created per section (named "Unit 1 — Sec A"), so each section starts, ends and is marked separately.
- Students only see, open and submit tests meant for their section (enforced on the server, not just hidden). Tests for "All students" are open to everyone.
- Admin → Results: tabs per section, a **section-wise summary** (students, submitted, average /20, highest), ranking inside a section, and CSV / PDF exports for the whole test or one section. Participation counts only the students the test is meant for.
- Leaderboard: "Everyone / My section" for students, any section for the admin. Tests page: admin can filter by section.

**Keywords are automatic**
- New generator (`backend/utils/keywords.js`): picks content words, numbers and acronyms, drops filler words, merges plural/singular duplicates, keeps the count sensible for long answers (max 8) so the 75% / 50% rule stays fair. Works for English and other scripts (Telugu, Hindi ...).
- Teachers never type keywords: leave the box empty when adding/editing/uploading (Excel, CSV, PDF) and they are generated. In the add/edit dialog they appear automatically after the answer is typed (and a **Generate** button refreshes them) — editable if wanted.
- Flashcards page: **Generate for cards without keywords** (one click) and **Regenerate all** (confirm; replaces hand-typed ones).
- Marking now forgives word endings (network / networks, store / stored). The 75% / 50% rules are unchanged.

**Marks**
- Every test is reported **out of 20** (whatever the per-question marks add up to are scaled to 20): student result page, tests list, dashboard, profile, leaderboard, admin results, CSV and PDF. Per-question marks act as weights; during the test each question shows its share of the 20.
- **Presentation marks out of 5**, entered by the teacher on the results page (one box per student, Save presentation marks; halves allowed, empty = not given). Students see **Written x/20 · Presentation y/5 · Total z/25** on their result and profile. Stored separately, so a student who presented but missed the test can still be marked.
- Raw scores are still stored unchanged; old results display out of 20 automatically.

**Notes**
- Existing students/tests have no section → they behave exactly as before ("All students").
- New tests: `test/keywords.test.js`, `test/admin.test.js`, section/marks cases in `flow`, `views`, `importers`. Fixed a stale view test (dark mode is the v4 default).

### v4 — dark by default + premium redesign

- **Dark mode is the default again** on every page (login and exam screen included). The sun/moon toggle still switches to light and remembers the choice on that device.
- **New look** (all CSS, still no images, web fonts or CDN files, so pages stay light for ~300 students at once): aurora-style background glow, glass-like cards with a soft top highlight, gradient brand and buttons with glow and shine on hover, sidebar with glowing active-page marker and framed profile card, bigger stat tiles with tinted icon badges, pill-style filters, richer tables, tabs, badges, progress bars, dialogs, upload boxes and flashcards that lift on hover, a glowing live-test card, a gold-glow leaderboard winner, and a gentle fade-in when a page opens.
- **New login page**: animated gradient orbs and a faint grid on the left, glass feature cards, a larger sign-in card. The animation is disabled on phones and for people who prefer reduced motion.
- Sign out, bulk upload and everything from v3 are unchanged.

### v3 — bulk uploads, sign out

- **Bulk uploads, Excel and PDF.** Admin → Students and Admin → Flashcards now take several files at once (up to 20 files, 10 MB each): `.xlsx`, `.xls`, `.csv` and `.pdf`.
  Excel/CSV: every sheet is read and headers are matched loosely (`Question`/`Q`, `Answer`/`Ans`, `Keywords`, `Username`/`Roll No`, `Password`).
  PDF (text PDFs only, not scans): flashcards as `Q:`/`A:`/`Keywords:` blocks, as a table with Question | Answer headers (wrapped cells and repeated headers are fine), or as a numbered list; students as a Username | Password table or one `roll password` per line.
  Flashcards: optional "use each file's name as its subject". One upload record per file, so deleting an upload still removes exactly its own cards/students.
  A bad file no longer stops the others — the result message lists what was imported and what was not, and why. Parsing lives in `backend/utils/importers.js`.
- Student uploads: the upload record now keeps only the accounts that file really created (before, it listed every row, so deleting an upload could remove older accounts with the same username). Passwords are still never stored.
- **Sign out** is now a real button: bottom of the sidebar (the sidebar scrolls, so it can no longer fall off the screen on phones/short windows) and an icon in the top bar. It uses POST; the old `/logout` link still works.
- New dependency: `pdfjs-dist` (PDF reading). Run `npm install`. Node 20.19+ is required (you are on 24).

### v2 — redesign, speed and new features

#### Speed
- Removed Bootstrap, two Font Awesome copies and two Google Fonts (6 blocking CDN requests per page). One 47 KB stylesheet (~10 KB gzipped), system fonts, inline SVG icons.
- gzip compression for every response; static files cached for 30 days in production (cache-busted on each deploy).
- `/flashcards` is paginated (24 per page) and filtered in the database — it used to render every card at once.
- Logged-in user is loaded with only `username` + `displayName` on every request (was the whole document incl. password hash).
- Lean/projected queries on dashboards, tests list, results; leaderboard and subject counts cached for 30–60 s.
- Test creation picker is client-side (handles thousands of flashcards); the exam timer is deadline based and no longer drifts in background tabs.

#### New for students
Leaderboard (overall + per test) · answer review after a test ends · rank and percentile · grades · score trend chart · flashcard study mode with keyboard shortcuts ·
mastered / saved cards (stored on the account, so they follow the student between devices) · "test yourself" practice · live countdowns · exam autosave, flag for review,
question palette · display name (shown on leaderboards instead of the roll number) · light and dark theme · mobile bottom navigation.

#### New for admins
Per-test analytics (average, median, pass rate, score distribution, hardest questions) · CSV export (spreadsheet-formula safe) · reset a student's attempt ·
student manager (search, add, reset password, delete, history) · flashcard manager (add, edit, delete, delete subject) · announcements · duplicate a test ·
Excel templates · test options (answer review on/off, "Check match %" on/off).

#### Behaviour changes to know about
- "Check match %" during a test is now **off by default** and is a per-test option (previously always on). Old tests therefore no longer show the button.
- Results now store each answer, so review and question analytics work for tests taken from now on (older results show the score only).
- After a test ends students can see the expected answers (turn off per test with "Answer review").
- Flashcard upload moved from /flashcards to Admin → Flashcards; the student upload moved to Admin → Students. The old POST URLs still work.
- Admin results page is now a list of tests; click one for the student table.

## v1 fixes (previous round)

### Marks & test correctness
- Server now enforces the time limit on submit (duration + 60s grace). Before, the timer was browser-only, so anyone could submit late.
- Submit uses ONE database query for all questions (was one query per question).
- Double-click / two tabs / refresh on submit can no longer produce an error: result is shown once; refresh no longer re-posts. New page `/result/:testId`.
- Deleted flashcards no longer count against students' totals.
- Answer matching is Unicode-aware (old version erased Hindi/Urdu/Telugu/Arabic text) and uses whole-word matching without building a RegExp per keyword.
- Numeric Excel cells (answer = 42 or 0) no longer crash flashcard upload or scoring.
- "Check Match %" is read-only now (it used to write keywords to the database on a GET-like path) and is rate limited (40/min/student).
- Test creation is validated (name, duration, marks, dates, question ids) and reports errors instead of showing a blank "Error creating test".
- Question shuffle is now a proper Fisher-Yates shuffle.
- Test page no longer loads answers/keywords from the database for the student.

### Speed for ~200 simultaneous students
- Mongo connection pool 50 (default was 5); crypto thread pool 16 so classroom-wide logins don't queue.
- Scheduler: 3 bulk updates per minute instead of loading all active tests.
- Admin results: O(1) lookups instead of scanning all results for every student x test; PDF likewise.
- Flashcard upload uses insertMany; user upload checks existing users in one query.
- Indexes added on tests (isActive/isEnded, scheduledStart) and flashcards (uploadId).
- Lean queries on hot pages; static files cacheable in production.

### Security / safety
- Request-body IDs are validated (blocks NoSQL operator injection like testId[$ne]=...).
- Login rate limit (per IP+username, so a classroom behind one IP isn't locked out).
- Student passwords are no longer stored in plaintext in upload records.
- Deleting a user upload can never delete the `admin` account, and removes those students' results.
- Deleting a flashcard upload removes exactly its cards (before: every card anywhere with the same question text).
- Session cookie config fixed (invalid `expires`), SameSite + optional Secure flag, basic security headers, request size limits.
- PDF filename sanitised. Production error pages hide internals. Admin password comes from ADMIN_PASSWORD, not hard-coded.
- Server timezone defaults to Asia/Kolkata (cloud hosts run UTC, which shifted scheduled tests by 5.5 hours). Override with TZ.

### Known limitations / your decisions
- "Check Match %" during a test tells students how close they are; with 40 checks/min a determined student can probe keywords. Remove the button in startTest.ejs if tests should be strict.
- Tab-switch / fullscreen rules are browser-side and can be bypassed by a determined student; violations are only logged.
- Rate limiter is in-memory: if you run several server instances, use a shared store.
- Everyone sees the same global timer (start time of the test), so late joiners get less time. This is how it already worked.

### Load fix (300 students at once)
- Sessions: removed connect-mongo `crypto` (a synchronous PBKDF2 of ~10 ms ran on EVERY request and froze the server); sessions now live in MongoDB (collection `sessions_v2`) with an in-memory copy in front (`utils/cachedSessionStore.js`). Students sign in once more after this update.
- `utils/once.js`: 300 simultaneous requests for the same test / card answers / leaderboard share one database read.
- EJS view cache is always on except when NODE_ENV=development.
- v6.5 (database round trips): logins, test opens, autosaves, submits and draft clean-up are batched (`utils/batcher.js`, `utils/writes.js`, `models/user.js`) so 300 students cost a few queries, not ~2000. Sessions are saved to MongoDB in the background (memory copy is used meanwhile). The sign-in warms the user cache so the next page needs no lookup.
