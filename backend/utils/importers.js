// Bulk-import readers: Excel / CSV and PDF  ->  plain row objects.
//   readRows(file, "cards")  -> [{ question, answer, keywords? }]
//   readRows(file, "users")  -> [{ username, password }]
// Excel/CSV: every sheet is read; headers are matched loosely (Question / Q, Answer / Ans, Roll No / Username ...).
// PDF: text PDFs only (a scanned image has no text to read). Supported layouts are described in the admin upload dialogs.
const path = require("path");
const xlsx = require("xlsx");
const { toStr } = require("./scoring");

const MAX_ROWS = 20000;
const MAX_PDF_PAGES = 300;

const normKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const HEADERS = {
  cards: {
    question: /^(questions?|ques|que|q)$/,
    answer:   /^(answers?|ans|a)$/,
    keywords: /^(key ?words?|tags?)$/
  },
  users: {
    username: /^(user ?name|user ?id|user|roll ?(no|number|num)|reg(istration)? ?(no|number|num)|login)$/,
    password: /^(pass(word)?|pwd|passcode|user password)$/,
    section:  /^(sec|section|class section|class|batch|group)$/        // optional
  }
};
const REQUIRED = { cards: ["question", "answer"], users: ["username", "password"] };

// ───────────────────────── Excel / CSV ─────────────────────────
function excelRows(buffer, kind) {
  const defs = HEADERS[kind];
  const wb = xlsx.read(buffer, { type: "buffer" });
  const out = [];
  for (const name of wb.SheetNames) {
    const data = xlsx.utils.sheet_to_json(wb.Sheets[name]);
    for (const raw of data) {
      const row = {};
      for (const [k, v] of Object.entries(raw)) {
        const nk = normKey(k);
        for (const f of Object.keys(defs)) {
          if (row[f] === undefined && defs[f].test(nk) && toStr(v).trim() !== "") row[f] = v;   // numbers (0, 42) are valid values
        }
      }
      if (Object.keys(row).length) out.push(row);
      if (out.length > MAX_ROWS) throw new Error(`Too many rows (limit ${MAX_ROWS} per file)`);
    }
  }
  return out;
}

// ───────────────────────── PDF ─────────────────────────
let pdfjsPromise;
const loadPdfjs = () => pdfjsPromise || (pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs"));

// -> [{ items: [{ x, end, h, str }] }] in reading order, page by page
async function pdfLines(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0
  }).promise;
  const lines = [];
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .filter(i => typeof i.str === "string" && i.str.trim() !== "")   // pdfjs emits wide blank items across column gaps; spacing is rebuilt from x positions
        .map(i => ({ x: i.transform[4], y: i.transform[5], end: i.transform[4] + (i.width || 0),
                     h: Math.max(4, Math.abs(i.height) || Math.abs(i.transform[3]) || 10), str: i.str }))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      let cur = null;
      for (const it of items) {
        if (cur && Math.abs(it.y - cur.y) <= Math.max(2, it.h * 0.45)) cur.items.push(it);
        else { cur = { y: it.y, items: [it] }; lines.push(cur); }
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
  return lines.filter(l => joinItems(l.items) !== "");
}

function joinItems(items) {
  let out = "", prev = null;
  for (const it of items) {
    if (prev && it.x - prev.end > it.h * 0.12 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
    out += it.str;
    prev = it;
  }
  return out.replace(/\s+/g, " ").trim();
}

// cells separated by a visible gap (used for headers and header-less tables)
function partsOf(line, gap = 1.5) {          // gap = how many text heights of blank space separate two cells
  const parts = [];
  let cur = null;
  for (const it of line.items) {
    if (cur && it.x - cur.end <= Math.max(it.h * gap, 6)) { cur.items.push(it); cur.end = it.end; }
    else { cur = { x: it.x, end: it.end, items: [it] }; parts.push(cur); }
  }
  return parts.map(p => ({ x: p.x, str: joinItems(p.items) })).filter(p => p.str);
}

const text = (line) => joinItems(line.items);
const isNoise = (s) => /^(page\s*)?\d{1,4}\s*(of|\/)\s*\d{1,4}$/i.test(s) || /^page\s*\d{1,4}$/i.test(s);

// Table with a header row (Question | Answer | Keywords, or Username | Password). Columns come from the header's x positions,
// so wrapped (multi-line) cells are handled: a line starts a new row only when all required cells are present.
function tableRows(lines, kind) {
  const defs = HEADERS[kind], need = REQUIRED[kind];
  const fieldOf = (s) => Object.keys(defs).find(f => defs[f].test(normKey(s)));
  const isHeader = (l) => { const f = new Set(partsOf(l, 0.7).map(p => fieldOf(p.str)).filter(Boolean)); return need.every(n => f.has(n)); };

  const hi = lines.findIndex(isHeader);
  if (hi < 0) return null;
  const cols = partsOf(lines[hi], 0.7).map(p => ({ x: p.x, field: fieldOf(p.str) || null }));
  const colOf = (x) => { let c = 0; cols.forEach((col, i) => { if (col.x - 8 <= x) c = i; }); return c; };

  const rows = [];
  for (const line of lines.slice(hi + 1)) {
    if (isHeader(line) || isNoise(text(line))) continue;
    const cells = {};
    const byCol = new Map();
    for (const it of line.items) {
      const i = colOf(it.x);
      if (!byCol.has(i)) byCol.set(i, []);
      byCol.get(i).push(it);
    }
    for (const [i, its] of byCol) {
      const f = cols[i].field;
      if (f) cells[f] = joinItems(its);
    }
    if (!Object.keys(cells).length) continue;
    if (need.every(n => cells[n])) rows.push(cells);
    else if (rows.length) {                                   // continuation of a wrapped cell
      const last = rows[rows.length - 1];
      for (const f of Object.keys(cells)) last[f] = (last[f] ? last[f] + " " : "") + cells[f];
    }
  }
  return rows;
}

// "Q: ... A: ... Keywords: ..." blocks (also "Question 3.", "Ans -", numbered "1. ... / Answer: ...")
const Q_RE = /^(?:\d+\s*[.)]\s*)?q(?:uestion)?\s*\d*\s*[:.)\-–—]\s*(.*)$/i;
const A_RE = /^a(?:ns(?:wer)?)?\s*\d*\s*[:.)\-–—]\s*(.*)$/i;
const K_RE = /^(?:key\s*words?|kw)\s*[:\-–—]\s*(.*)$/i;
const NUM_RE = /^\d+\s*[.)]\s*(.*)$/;

function labeledCards(lines) {
  const strs = lines.map(l => partsOf(l).map(p => p.str).join(" ")).filter(s => s && !isNoise(s));
  const aCount = strs.filter(s => A_RE.test(s)).length;
  if (!aCount) return null;

  const numbered = !strs.some(s => Q_RE.test(s));            // numbered questions only when there are no "Q:" labels
  const cards = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.q.length && cur.a.length) cards.push({ question: cur.q.join(" ").trim(), answer: cur.a.join(" ").trim(), keywords: cur.k.join(" ").trim() || undefined });
    cur = null;
  };
  const start = (first) => { flush(); cur = { q: first ? [first] : [], a: [], k: [], field: "q" }; };

  for (const s of strs) {
    let m;
    if ((m = s.match(Q_RE))) { start(m[1]); continue; }
    if (cur && cur.field !== "k" && (m = s.match(A_RE))) { cur.field = "a"; if (m[1]) cur.a.push(m[1]); continue; }
    if (cur && cur.a.length && (m = s.match(K_RE))) { cur.field = "k"; if (m[1]) cur.k.push(m[1]); continue; }
    if (numbered && (m = s.match(NUM_RE)) && (!cur || cur.a.length)) { start(m[1]); continue; }   // "1. question" without a "Q:" label
    if (!cur) continue;
    cur[cur.field].push(s);
  }
  flush();
  return cards;
}

// Header-less table: every line has 2-3 visibly separated cells (question | answer | keywords)
function gapCards(lines) {
  const rows = [];
  let multi = 0, total = 0;
  for (const l of lines) {
    const s = text(l);
    if (isNoise(s)) continue;
    total++;
    const p = partsOf(l);
    if (p.length >= 2) {
      multi++;
      rows.push({ question: p[0].str, answer: p[1].str, keywords: p[2] ? p.slice(2).map(x => x.str).join(" ") : undefined });
    } else if (rows.length) rows[rows.length - 1].answer += " " + s;
  }
  return multi >= Math.max(1, total * 0.5) ? rows : null;
}

function plainUsers(lines) {
  const out = [];
  let lastSerial = 0;
  for (const l of lines) {
    const s = text(l);
    if (!s || isNoise(s)) continue;
    let t = s.split(/[\t,|;]+|\s+/).map(x => x.trim()).filter(Boolean);
    // serial-number column: "1." / "2)" always; a bare number only when it counts 1,2,3... (so roll numbers like 101 stay roll numbers)
    if (t.length >= 3 && /^\d{1,5}[.)]?$/.test(t[0])) {
      const n = parseInt(t[0], 10);
      if (/[.)]$/.test(t[0]) || t.length >= 4 || n === lastSerial + 1) { lastSerial = n; t = t.slice(1); }
    }
    if (t.length < 2) continue;
    if (HEADERS.users.username.test(normKey(t[0])) && HEADERS.users.password.test(normKey(t[1]))) continue;   // header line
    const row = { username: t[0], password: t[1] };
    if (t[2]) row.section = t[2];                                                       // optional third column: section
    out.push(row);
  }
  return out;
}

async function pdfRows(buffer, kind) {
  const lines = await pdfLines(buffer);
  if (!lines.length) throw new Error("No selectable text found in this PDF (scanned/image PDFs cannot be read)");
  if (kind === "users") return tableRows(lines, "users") || plainUsers(lines);
  return tableRows(lines, "cards") || labeledCards(lines) || gapCards(lines) || [];
}

// ───────────────────────── entry point ─────────────────────────
const EXCEL_EXT = new Set([".xlsx", ".xlsm", ".xls", ".csv", ".ods"]);

async function readRows(file, kind) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const buf = file.buffer;
  const isPdf = ext === ".pdf" || (buf && buf.slice(0, 5).toString("latin1") === "%PDF-");
  let rows;
  if (isPdf) rows = await pdfRows(buf, kind);
  else if (EXCEL_EXT.has(ext)) rows = excelRows(buf, kind);
  else throw new Error("unsupported file type (use .xlsx, .xls, .csv or .pdf)");
  if (rows.length > MAX_ROWS) throw new Error(`too many rows (limit ${MAX_ROWS} per file)`);
  return rows;
}

module.exports = { readRows, excelRows, pdfRows, MAX_ROWS };
