// Renders EVERY page with realistic data (no database needed) and checks the output is sane.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const express = require("express");
const ejsMate = require("ejs-mate");
const { fixtures, baseLocals } = require("./fixtures");

const app = express();
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../frontend/views"));
app.set("layout", "layouts/boilerplate");
const render = (view, data) => new Promise((res, rej) => app.render(view, data, (e, html) => e ? rej(e) : res(html)));

for (const [name, f] of Object.entries(fixtures)) {
  test(`page renders: ${name}`, async () => {
    const html = await render(f.view, { ...baseLocals(f), ...f.data });
    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /\/css\/style\.css/);
    assert.ok(!/cdn\.jsdelivr|cdnjs\.cloudflare|fonts\.googleapis/.test(html), "no CDN dependencies");
    assert.ok(!/undefined|\[object Object\]|NaN/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), "no undefined/NaN leaked into the page");
  });
}

test("student pages show the student navigation, admin pages the admin one", async () => {
  const s = await render("dashboard", { ...baseLocals(fixtures.dashboard), ...fixtures.dashboard.data });
  assert.match(s, /Leaderboard/); assert.ok(!/Students<\/a>/.test(s));
  const a = await render("dashboard", { ...baseLocals(fixtures.dashboardAdmin), ...fixtures.dashboardAdmin.data });
  assert.match(a, /Admin console/); assert.match(a, /href="\/admin\/students"/);
});

test("exam page: questions, timer, answer boxes, no answers leaked", async () => {
  const html = await render("startTest", { ...baseLocals(fixtures.startTest), ...fixtures.startTest.data });
  assert.match(html, /What is photosynthesis\?/);
  assert.match(html, /name="answers\[00000000000000000000000c\]"/);
  assert.match(html, /data-remaining="1320"/);
  assert.match(html, /data-check/);                       // allowCheck on
  assert.ok(!/Mitochondria/.test(html), "expected answers must never be sent to the exam page");
});

test("exam page hides 'Check match' when the test does not allow it", async () => {
  const d = JSON.parse(JSON.stringify(fixtures.startTest.data)); d.test.allowCheck = false;
  const html = await render("startTest", { ...baseLocals(fixtures.startTest), ...d });
  assert.ok(!/<button[^>]*data-check/.test(html));
});

test("user-provided text is escaped (XSS)", async () => {
  const d = JSON.parse(JSON.stringify(fixtures.flashcards.data)); d.cards[0].question = '<img src=x onerror=alert(1)>';
  const html = await render("flashcards", { ...baseLocals(fixtures.flashcards), ...d });
  assert.ok(!html.includes("<img src=x"));
  const s = JSON.parse(JSON.stringify(fixtures.study.data)); s.deck[0].q = "</script><script>alert(1)</script>";
  const h2 = await render("study", { ...baseLocals(fixtures.study), ...s });
  assert.ok(!h2.includes("</script><script>alert(1)"));
});

test("result page: review hidden until the test has ended", async () => {
  const d = { ...fixtures.result.data, ended: false, review: null, rank: null, top: [] };
  const html = await render("result", { ...baseLocals(fixtures.result), ...d });
  assert.match(html, /unlock when the test ends/); assert.ok(!/Answer review/.test(html));
  const ok = await render("result", { ...baseLocals(fixtures.result), ...fixtures.result.data });
  assert.match(ok, /Answer review/); assert.match(ok, /#12/);
});

test("every signed-in page has a Sign out button (POST) and starts in dark mode (the default)", async () => {
  for (const key of ["dashboard", "dashboardAdmin"]) {
    const html = await render(fixtures[key].view, { ...baseLocals(fixtures[key]), ...fixtures[key].data });
    assert.match(html, /<html lang="en" data-theme="dark">/);
    assert.ok((html.match(/<form[^>]*action="\/logout"[^>]*method="POST"/g) || []).length >= 2, "sidebar + top bar sign-out");
  }
});

test("upload dialogs accept several Excel/CSV/PDF files", async () => {
  for (const key of ["adminStudents", "adminFlashcards"]) {
    const html = await render(fixtures[key].view, { ...baseLocals(fixtures[key]), ...fixtures[key].data });
    assert.match(html, /name="files" accept="\.xlsx,\.xls,\.csv,\.pdf" multiple/);
  }
});

test("create-test form offers sections, per-section times and a 20-mark note", async () => {
  const html = await render("users/admin", { ...baseLocals(fixtures.adminHub), ...fixtures.adminHub.data });
  assert.match(html, /name="target" value="sections"/);
  assert.match(html, /name="secOn" value="A"/); assert.match(html, /name="secStart"/); assert.match(html, /name="sameTime"/);
  assert.match(html, /reported out of <b>20<\/b>/);
  const none = await render("users/admin", { ...baseLocals(fixtures.adminHubNoSections), ...fixtures.adminHubNoSections.data });
  assert.match(none, /name="target" value="sections" disabled/);                              // no sections yet -> option disabled
});

test("admin results: section tabs, marks out of 20 and section-aware exports", async () => {
  const html = await render("adminTestResults", { ...baseLocals(fixtures.adminTestResults), ...fixtures.adminTestResults.data });
  assert.match(html, /Section-wise summary/); assert.match(html, /\?section=A/);
  assert.match(html, /Marks \/20/);
  assert.ok(!/resent/i.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), "no presentation marks any more");
});

test("student result shows marks out of 20 and no presentation marks", async () => {
  const html = await render("result", { ...baseLocals(fixtures.result), ...fixtures.result.data });
  assert.match(html, /15 <small>\/ 20<\/small>/);
  assert.ok(!/resentation/.test(html));
});

test("students page: section DROPDOWN (total + every section, even empty ones), New section dialog, bulk move", async () => {
  const html = await render("adminStudents", { ...baseLocals(fixtures.adminStudents), ...fixtures.adminStudents.data });
  assert.match(html, /<select class="select" name="section" data-autosubmit/);
  assert.match(html, /All students \(213\)/); assert.match(html, /Section A \(120\)/); assert.match(html, /Section C \(0\)/); assert.match(html, /No section \(3\)/);
  assert.match(html, /action="\/admin\/sections"/); assert.match(html, /action="\/admin\/students\/assign-section"/);
});

test("teachers page: list, add / edit / password dialogs", async () => {
  const html = await render("adminTeachers", { ...baseLocals(fixtures.adminTeachers), ...fixtures.adminTeachers.data });
  assert.match(html, /t\.sharma/); assert.match(html, /action="\/admin\/teachers"/); assert.match(html, /name="newSubjects"/); assert.match(html, /no subject yet/);
});

test("create-test form: manual / random choice, 'Check match %' ticked by default", async () => {
  const html = await render("users/admin", { ...baseLocals(fixtures.adminHub), ...fixtures.adminHub.data });
  assert.match(html, /name="pickMode" id="pickMode" value="manual"/);
  assert.match(html, /data-mode="random"/); assert.match(html, /name="randomCount"/); assert.match(html, /name="randomSubject"/);
  assert.match(html, /name="allowCheck" checked/);
});

test("teacher console: own navigation, subject select, no admin-only links", async () => {
  const hub = await render("users/admin", { ...baseLocals(fixtures.teacherHub), ...fixtures.teacherHub.data });
  assert.match(hub, /Teacher console/); assert.match(hub, /<select class="select" id="tsub" name="subject" required>/);
  assert.ok(!/href="\/admin\/students"/.test(hub) && !/href="\/admin\/teachers"/.test(hub) && !/id="announcements"/.test(hub));
  const dash = await render("dashboard", { ...baseLocals(fixtures.teacherDashboard), ...fixtures.teacherDashboard.data });
  assert.ok(!/href="\/admin\/students"/.test(dash) && !/Post an announcement/.test(dash));
  const fc = await render("adminFlashcards", { ...baseLocals(fixtures.teacherFlashcards), ...fixtures.teacherFlashcards.data });
  assert.match(fc, /<select class="select" id="cs" name="subject" required>/); assert.ok(!/Delete subject/.test(fc));
  const admin = await render("dashboard", { ...baseLocals(fixtures.dashboardAdmin), ...fixtures.dashboardAdmin.data });
  assert.match(admin, /href="\/admin\/teachers"/);
});

test("flashcard manager: keywords are automatic (generate buttons, no typing required)", async () => {
  const html = await render("adminFlashcards", { ...baseLocals(fixtures.adminFlashcards), ...fixtures.adminFlashcards.data });
  assert.match(html, /auto-keywords/); assert.match(html, /id="kwGen"/); assert.match(html, /created automatically/);
});
