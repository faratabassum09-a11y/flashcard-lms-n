// Shared helpers for e2e.js / loadtest.js (Node 18+; uses global fetch/FormData/Blob).
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });      // ADMIN_USER / ADMIN_PASSWORD / BASE_URL / STUDENTS can live in .env
const xlsx = require("xlsx");

const BASE = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { console.error("ADMIN_PASSWORD is not set. Put ADMIN_PASSWORD=... in .env (or set $env:ADMIN_PASSWORD in PowerShell)."); process.exit(1); }

class Client {
  constructor() { this.cookie = ""; }
  async req(path, { method = "GET", form, multipart, json } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    let body;
    if (form)      { headers["content-type"] = "application/x-www-form-urlencoded"; body = form instanceof URLSearchParams ? form : new URLSearchParams(form); }
    if (json)      { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
    if (multipart) body = multipart;
    const res = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) {
      const jar = new Map(this.cookie.split("; ").filter(Boolean).map(c => c.split(/=(.*)/s).slice(0, 2)));
      for (const c of set) { const [kv] = c.split(";"); const [k, v] = kv.split(/=(.*)/s); jar.set(k, v); }
      this.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    const text = res.headers.get("content-type")?.includes("pdf") ? "" : await res.text();
    return { status: res.status, location: res.headers.get("location"), headers: res.headers, text };
  }
  async login(username, password) {
    const r = await this.req("/login", { method: "POST", form: { username, password } });
    return r.status === 302 && !/\/login$/.test(r.location || "");
  }
}

const sheetBuffer = (rows) => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), "Sheet1");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
};
const xlsxForm = (rows, fields = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", new Blob([sheetBuffer(rows)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "data.xlsx");
  return fd;
};

const assert = require("node:assert");
let passed = 0;
const step = (name, cond, extra = "") => {
  if (!cond) { console.error(`  ✗ ${name} ${extra}`); process.exitCode = 1; throw new Error("E2E step failed: " + name); }
  passed++; console.log(`  ✓ ${name}`);
};

// create users + flashcards + a started test; returns ids
async function seedExam(admin, { token, students, cards, marks, duration = 10 }) {
  let r = await admin.req("/upload-users", { method: "POST", multipart: xlsxForm(students.map(s => ({ username: s.username, password: s.password }))) });
  step("admin uploads student users", r.status === 302);

  const subject = "E2E-" + token;
  r = await admin.req("/upload-flashcards", { method: "POST", multipart: xlsxForm(cards, { subject }) });
  step("admin uploads flashcards", r.status === 302);

  // the create-test page ships its question list as JSON for the client-side picker: [{id, s: subject, q: question}]
  r = await admin.req("/admin");
  const found = [];
  const pm = /<script type="application\/json" id="poolData">([\s\S]*?)<\/script>/.exec(r.text);
  if (pm) for (const c of JSON.parse(pm[1])) if (c.s === subject && c.q.toLowerCase().includes(token.toLowerCase())) found.push({ q: c.q, id: c.id });
  step(`flashcards visible on admin page (${found.length}/${cards.length})`, found.length === cards.length);

  const form = new URLSearchParams({ name: "E2E Test " + token, duration: String(duration), subject, allowCheck: "on", showReview: "on" });
  found.forEach((f, i) => { form.append("questionIds", f.id); form.append("marks", String(marks[i] ?? 5)); });
  r = await admin.req("/create-test", { method: "POST", form });
  step("admin creates test", r.status === 303 || r.status === 302, `(got ${r.status})`);

  r = await admin.req("/tests");
  const at = r.text.indexOf("E2E Test " + token);
  const idm = at >= 0 && /\/admin\/start-test\/([a-f\d]{24})/.exec(r.text.slice(at));
  step("test appears in list", !!idm);
  const testId = idm[1];

  r = await admin.req("/admin/start-test/" + testId, { method: "POST", form: {} });
  step("admin starts test", r.status === 302);
  return { testId, cardIds: found.map(f => f.id), cardQuestions: found.map(f => f.q) };
}

module.exports = { BASE, ADMIN_USER, ADMIN_PASSWORD, Client, xlsxForm, step, seedExam };
