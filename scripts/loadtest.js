// Simulates N students (default 300) logging in at the same moment, opening the test, autosaving and submitting
// (half through the exam screen's JSON path, half through the plain form fallback).
//   BASE_URL=http://localhost:5000 STUDENTS=200 npm run load
const { BASE, ADMIN_USER, ADMIN_PASSWORD, Client, step, seedExam } = require("./lib");
const N = Number(process.env.STUDENTS || 300);
const pct = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

(async () => {
  console.log(`Load test: ${N} students against ${BASE}`);
  const token = "L" + Date.now().toString(36);
  const students = Array.from({ length: N }, (_, i) => ({ username: `load_${token}_${i}`, password: `Pw!${token}${i}` }));
  const cards = Array.from({ length: 10 }, (_, i) => ({ question: `${token} question ${i}?`, answer: `alpha${i} beta${i} gamma${i} delta${i}`, keywords: `alpha${i},beta${i},gamma${i},delta${i}` }));
  const admin = new Client();
  step("admin login", await admin.login(ADMIN_USER, ADMIN_PASSWORD));
  const { testId, cardIds } = await seedExam(admin, { token, students, cards, marks: cards.map(() => 5), duration: 30 });

  const lat = { login: [], open: [], save: [], submit: [] }; let errors = 0, wrong = 0;
  const timed = async (k, fn) => { const t = performance.now(); const r = await fn(); lat[k].push(performance.now() - t); return r; };

  const t0 = performance.now();
  await Promise.all(students.map(async (s, idx) => {
    try {
      const c = new Client();
      const ok = await timed("login", () => c.login(s.username, s.password));
      if (!ok) { errors++; return; }
      const open = await timed("open", () => c.req("/test/" + testId));
      if (open.status !== 200) { errors++; return; }
      const answers = {}; cardIds.forEach((id, i) => { answers[id] = `alpha${i} beta${i} gamma${i} delta${i}`; });
      const sv = await timed("save", () => c.req(`/test/${testId}/draft`, { method: "POST", json: { answers, flags: {} } }));
      if (sv.status !== 200 || !/"ok":true/.test(sv.text)) { errors++; return; }
      if (idx % 2 === 0) {                                     // exam screen path (JSON)
        const sub = await timed("submit", () => c.req("/submit-test", { method: "POST", json: { testId, answers } }));
        if (sub.status !== 200 || !/"ok":true/.test(sub.text)) { errors++; return; }
      } else {                                                 // plain form fallback
        const f = new URLSearchParams({ testId });
        cardIds.forEach((id, i) => f.append(`answers[${id}]`, answers[id]));
        const sub = await timed("submit", () => c.req("/submit-test", { method: "POST", form: f }));
        if (sub.status !== 303) { errors++; return; }
      }
      const res = await c.req("/result/" + testId);
      if (!/kpi-value tnum">\s*20\s*<small>\/\s*20/.test(res.text)) wrong++;   // results are shown out of 20
    } catch (e) { errors++; }
  }));
  const secs = ((performance.now() - t0) / 1000).toFixed(1);

  console.log(`\nDone in ${secs}s — errors: ${errors}, wrong marks: ${wrong}`);
  for (const [k, a] of Object.entries(lat)) if (a.length) console.log(`${k.padEnd(7)} p50 ${pct(a, .5).toFixed(0)}ms  p95 ${pct(a, .95).toFixed(0)}ms  max ${Math.max(...a).toFixed(0)}ms`);
  console.log(errors === 0 && wrong === 0 ? "LOAD TEST PASSED" : "LOAD TEST FAILED");
  process.exit(errors === 0 && wrong === 0 ? 0 : 1);
})().catch(e => { console.error("LOAD TEST FAILED:", e.message); process.exit(1); });
