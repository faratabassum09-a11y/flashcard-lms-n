// Pure helpers for ranking, grades and statistics (unit-tested, no database).

const pct = (score, total) => (total > 0 ? Math.round((score / total) * 1000) / 10 : 0);

function gradeFor(percent) {
  if (percent >= 90) return { letter: "A+", label: "Outstanding", tone: "success" };
  if (percent >= 80) return { letter: "A",  label: "Excellent",   tone: "success" };
  if (percent >= 70) return { letter: "B",  label: "Very good",   tone: "success" };
  if (percent >= 60) return { letter: "C",  label: "Good",        tone: "info" };
  if (percent >= 50) return { letter: "D",  label: "Fair",        tone: "warning" };
  if (percent >= 40) return { letter: "E",  label: "Needs work",  tone: "warning" };
  return { letter: "F", label: "Keep practising", tone: "danger" };
}

// rows: [{ key, percent, ...rest }] -> sorted desc with competition ranking (ties share a rank: 1,2,2,4)
function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => b.percent - a.percent || (b.tests || 0) - (a.tests || 0) || String(a.name).localeCompare(String(b.name)));
  let rank = 0, prev = null;
  sorted.forEach((r, i) => {
    const sig = r.percent + "|" + (r.tests || 0);
    if (sig !== prev) { rank = i + 1; prev = sig; }
    r.rank = rank;
  });
  return sorted;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// percents: array of 0-100 numbers
function summarize(percents) {
  const n = percents.length;
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count: 0 }));
  if (!n) return { count: 0, avg: 0, median: 0, high: 0, low: 0, passRate: 0, bins };
  let sum = 0, high = -Infinity, low = Infinity, pass = 0;
  for (const p of percents) {
    sum += p; if (p > high) high = p; if (p < low) low = p; if (p >= 40) pass++;
    bins[Math.min(9, Math.floor(p / 10))].count++;
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  return { count: n, avg: r1(sum / n), median: r1(median(percents)), high: r1(high), low: r1(low), passRate: Math.round((pass / n) * 100), bins };
}

// Tiny TTL cache for hot, read-mostly pages (leaderboards) so 200 students refreshing do not all hit the database.
function ttlCache(ttlMs) {
  const m = new Map();
  return {
    get(k) { const e = m.get(k); if (e && e.exp > Date.now()) return e.v; m.delete(k); return undefined; },
    set(k, v) { m.set(k, { v, exp: Date.now() + ttlMs }); if (m.size > 200) m.delete(m.keys().next().value); return v; },
    clear() { m.clear(); }
  };
}

module.exports = { pct, gradeFor, rankRows, summarize, median, ttlCache };
