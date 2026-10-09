// Real end-to-end check against a RUNNING server + real MongoDB.
//   1) start the app (npm start) against a TEST database
//   2) BASE_URL=http://localhost:5000 npm run e2e
// Covers: admin login, bulk user upload, flashcard upload, test creation + marks,
// student login, test page, check-answer, submit, awarded marks, double-submit,
// result page, admin results page, PDF export, cleanup via upload delete.
const { BASE, ADMIN_USER, ADMIN_PASSWORD, Client, xlsxForm, step, seedExam } = require("./lib");

(async () => {
  console.log("E2E against", BASE);
  const token = Date.now().toString(36);
  const students = [1, 2, 3].map(i => ({ username: `e2e_${token}_${i}`, password: `Pw!${token}${i}` }));
  const cards = [
    { question: `${token} What does a plant use to make food?`, answer: "sunlight water chlorophyll carbon dioxide", keywords: "sunlight,water,chlorophyll,carbon dioxide" },
    { question: `${token} What is 6 times 7?`, answer: "42" },
    { question: `${token} Powerhouse of the cell?`, answer: "mitochondria", keywords: "mitochondria" },
  ];
  const marks = [4, 2, 6];                       // total 12

  const admin = new Client();
  step("admin can log in", await admin.login(ADMIN_USER, ADMIN_PASSWORD));
  const { testId, cardIds, cardQuestions } = await seedExam(admin, { token, students, cards, marks });

  // map card ids back to our cards by question text
  const idOf = (needle) => cardIds[cardQuestions.findIndex(q => q.includes(needle))];
  const [plant, math, cell] = [idOf("plant"), idOf("times"), idOf("powerhouse")];

  // ---- student 1: 3/4 keywords (full 4) + correct number (2) + wrong (0) => 6/12
  const s1 = new Client();
  step("student can log in", await s1.login(students[0].username, students[0].password));
  let r = await s1.req("/test/" + testId);
  step("student opens the test page", r.status === 200 && /id="timer"/.test(r.text));
  step("answers/keywords are NOT leaked in test page", !/chlorophyll/i.test(r.text) && !/mitochondria/i.test(r.text));

  r = await s1.req(`/test/${testId}/draft`, { method: "POST", json: { answers: { [plant]: "sunlight" }, flags: {} } });
  step("autosave works", /"ok":true/.test(r.text));
  r = await s1.req("/check-answer", { method: "POST", json: { questionId: plant, answer: "sunlight and water and chlorophyll" } });
  step("check-answer returns 75%", JSON.parse(r.text).percent === 75);

  const submit = (c, answers) => {
    const f = new URLSearchParams({ testId });
    for (const [id, a] of Object.entries(answers)) f.append(`answers[${id}]`, a);
    return c.req("/submit-test", { method: "POST", form: f });
  };
  r = await submit(s1, { [plant]: "It uses sunlight, water and chlorophyll", [math]: "The answer is 42", [cell]: "nucleus" });
  step("submit redirects to result page", r.status === 303 && r.location.endsWith("/result/" + testId));
  r = await s1.req("/result/" + testId);
  step("student sees 10 / 20 (6 of 12 raw marks)", /kpi-value tnum">\s*10\s*<small>\/\s*20/.test(r.text));

  r = await submit(s1, { [plant]: "everything perfect" });
  r = await s1.req("/result/" + testId);
  step("double-submit does not change marks", /kpi-value tnum">\s*10\s*<small>\/\s*20/.test(r.text));
  r = await s1.req("/test/" + testId);
  step("re-opening an attempted test is blocked", r.status === 302);

  // ---- student 2: perfect => 12/12 ; student 3: nothing => 0/12
  const s2 = new Client(); await s2.login(students[1].username, students[1].password);
  await submit(s2, { [plant]: "sunlight water chlorophyll carbon dioxide", [math]: "42", [cell]: "Mitochondria!" });
  r = await s2.req("/result/" + testId);
  step("perfect answers => 20 / 20", /kpi-value tnum">\s*20\s*<small>\/\s*20/.test(r.text));

  const s3 = new Client(); await s3.login(students[2].username, students[2].password);
  await submit(s3, {});
  r = await s3.req("/result/" + testId);
  step("blank answers => 0 / 20", /kpi-value tnum">\s*0\s*<small>\/\s*20/.test(r.text));

  // ---- admin views
  r = await admin.req("/admin/results/" + testId);
  step("admin results page lists the scores", r.status === 200 && r.text.includes(students[0].username));
  r = await admin.req("/admin/results/pdf/" + testId);
  step("PDF export works", r.status === 200 && /pdf/.test(r.headers.get("content-type")));
  r = await s1.req("/admin");
  step("student cannot open admin area", r.status === 302 && /dashboard|login/.test(r.location));

  // ---- cleanup: delete the uploads (removes our users + cards)
  r = await admin.req("/admin/uploads");
  const ids = [...r.text.matchAll(/\/admin\/uploads\/delete\/([a-f\d]{24})/g)].map(m => m[1]);
  step("uploads listed for cleanup", ids.length >= 2);
  r = await admin.req("/admin/delete-test/" + testId + "?_method=DELETE", { method: "POST" });
  console.log("\nE2E PASSED. (Test data uses the token", token + "; remove via Admin → Uploads if desired.)");
})().catch(e => { console.error("\nE2E FAILED:", e.message); process.exit(1); });
