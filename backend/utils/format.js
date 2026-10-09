// Date helpers exposed to every view as `fmt`. Always rendered in the server's configured timezone (Asia/Kolkata by default).
const tz = () => process.env.TZ || "Asia/Kolkata";
const toDate = (d) => (d instanceof Date ? d : new Date(d));
const valid = (d) => d && !isNaN(toDate(d));

const make = (opts) => (d) => (valid(d) ? new Intl.DateTimeFormat("en-IN", { timeZone: tz(), ...opts }).format(toDate(d)) : "—");

module.exports = {
  date:     make({ day: "numeric", month: "short", year: "numeric" }),
  short:    make({ day: "numeric", month: "short" }),
  time:     make({ hour: "numeric", minute: "2-digit", hour12: true }),
  dateTime: make({ day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }),
  iso: (d) => (valid(d) ? toDate(d).toISOString() : ""),
  // value for <input type="datetime-local"> in server timezone
  local: (d) => {
    if (!valid(d)) return "";
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz(), hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(toDate(d)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  },
  ago: (d) => {
    if (!valid(d)) return "";
    const s = Math.round((Date.now() - toDate(d).getTime()) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 86400 * 7) return Math.round(s / 86400) + " d ago";
    return module.exports.date(d);
  },
  initials: (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?",
  // raw score -> marks out of 20 (one decimal)
  scaled: (score, total, max = 20) => (Number(total) > 0 ? Math.round((Number(score) || 0) / Number(total) * max * 10) / 10 : 0),
  num: (n) => (Math.round((Number(n) || 0) * 10) / 10).toString()
};
