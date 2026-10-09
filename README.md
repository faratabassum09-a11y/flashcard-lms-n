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
See CHANGES.md


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
