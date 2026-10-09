// Automatic keyword generation - teachers no longer have to type keywords.
// Given the model answer, pick the words a student MUST mention to earn marks:
// content words, numbers, acronyms and capitalised terms are favoured; filler words are dropped;
// long answers get a sensible cap so that the 75% / 50% marking rule stays fair.
// Pure functions (unit-tested, no database).

const STOP = new Set((
  "a about above across after again against all almost along already also although always am among an and another any anyone anything are " +
  "around as at be became because become becomes been before behind being below between both but by can cannot could did do does doing done " +
  "down during each either else enough even ever every few for from further get gets got had has have having he her here hers herself him " +
  "himself his how however i if in into is it its itself just keep kind known let like made make makes many may me might more most much must " +
  "my myself near need needs neither no nor not nothing now of off often on once one only onto or other others our ours ourselves out over " +
  "own per perhaps quite rather really said same say says see seen several shall she should since so some something sometimes still such " +
  "take taken than that the their theirs them themselves then there therefore these they thing things this those though through thus to too " +
  "toward under until up upon us use used uses using very via was we well were what whatever when whenever where whereas whether which while " +
  "who whom whose why will with within without would yes yet you your yours yourself called referred includes include including etc eg ie " +
  "means mean example examples way ways type types form forms based often usually generally basically simply given give gives"
).split(/\s+/));

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const NON_ASCII_LETTER = /[^\u0000-\u007f]/;

// Very light stemmer so "network" / "networks", "store" / "stores", "storing" can match each other.
// Applied to plain ASCII words only; other scripts are compared exactly.
function stem(w) {
  if (w.length < 5 || NON_ASCII_LETTER.test(w) || /\d/.test(w)) return w;
  let r = w;
  if (r.endsWith("ies") && r.length > 5) r = r.slice(0, -3) + "y";
  else if (r.endsWith("sses")) r = r.slice(0, -2);
  else if (/(ches|shes|xes)$/.test(r)) r = r.slice(0, -2);
  else if (r.endsWith("ing") && r.length > 6) r = r.slice(0, -3);
  else if (r.endsWith("ed") && r.length > 5) r = r.slice(0, -2);
  else if (r.endsWith("s") && !/(ss|us|is)$/.test(r)) r = r.slice(0, -1);
  if (r.length > 4 && r.endsWith("e")) r = r.slice(0, -1);      // store / stores / stored / storing all meet at "stor"
  return r;
}

function toText(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(toText).join(" ");
  return typeof v === "object" ? "" : String(v);
}

// opts.max  hard cap (default 8)
function generateKeywords(answer, opts = {}) {
  const hardMax = Math.max(1, opts.max || 8);
  const text = toText(answer).slice(0, 6000);
  const raw = text.match(WORD) || [];
  if (!raw.length) return [];

  // sentence starts (so "Plants" at the start of a sentence is not mistaken for a proper noun)
  const startIdx = new Set();
  { let atStart = true, m; const re = /[\p{L}\p{M}\p{N}]+|[.!?\n]+/gu; let i = 0;
    while ((m = re.exec(text))) { if (/^[.!?\n]/.test(m[0])) atStart = true; else { if (atStart) startIdx.add(i); atStart = false; i++; } } }

  const info = new Map();            // lowercase word -> info
  raw.forEach((tok, i) => {
    const w = tok.toLowerCase();
    const isNum = /^\d+$/.test(tok);
    const hasDigit = /\d/.test(tok);
    const acronym = tok.length >= 2 && tok.length <= 8 && tok === tok.toUpperCase() && /\p{Lu}/u.test(tok);
    const capital = !acronym && /^\p{Lu}/u.test(tok) && !startIdx.has(i);
    const nonLatin = NON_ASCII_LETTER.test(tok);
    const longEnough = tok.length >= 3 || nonLatin && tok.length >= 2;
    const e = info.get(w);
    if (e) { e.freq++; e.acronym = e.acronym || acronym; e.capital = e.capital || capital; return; }
    info.set(w, { w, tok, idx: i, freq: 1, isNum, hasDigit, acronym, capital, ok: !STOP.has(w) && (longEnough || acronym || hasDigit) });
  });

  let cands = [...info.values()].filter(c => c.ok);
  if (!cands.length) cands = [...info.values()].filter(c => !STOP.has(c.w));        // very short answers like "F = ma"
  if (!cands.length) cands = [...info.values()];                                    // answer is only filler words
  // "plant" and "plants" count once
  const seenStem = new Set();
  cands = cands.filter(c => { const s = stem(c.w); if (seenStem.has(s)) return false; seenStem.add(s); return true; });

  const n = cands.length;
  const want = n <= 3 ? n : Math.min(hardMax, Math.max(3, Math.ceil(n * 0.5)));
  if (n > want) {
    const total = raw.length || 1;
    cands.forEach(c => {
      c.score = 1 + Math.min(c.w.length, 12) * 0.15 + (c.acronym ? 1.5 : 0) + (c.isNum || c.hasDigit ? 1.2 : 0) +
                (c.capital ? 1 : 0) + 0.3 * Math.min(c.freq - 1, 2) + (1 - c.idx / total) * 0.4;
    });
    cands = cands.sort((a, b) => b.score - a.score || a.idx - b.idx).slice(0, want);
  }
  return cands.sort((a, b) => a.idx - b.idx).map(c => c.w);
}

// "a, b; c" -> ["a","b","c"]  (what the teacher types in the keywords box)
function parseKeywordList(str, limit = 60) {
  return toText(str).split(/[,;\n]/).map(k => k.trim()).filter(Boolean).slice(0, limit);
}

module.exports = { generateKeywords, parseKeywordList, stem, STOP };
