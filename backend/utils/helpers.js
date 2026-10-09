const isId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Only allow redirecting back to a path on this site (prevents open redirects)
const safeBack = (v, fallback) => (typeof v === "string" && /^\/(?!\/)[\w\-\/?=&%.]*$/.test(v) ? v : fallback);
const pageParam = (v) => Math.max(1, Math.min(10000, parseInt(v, 10) || 1));
const nameOf = (u) => (u && (u.displayName || u.username)) || "Student";

// Section names are typed by teachers / read from Excel: "a", " A ", "cse-a" -> "A", "CSE-A"
const normSection = (v) => String(v === null || v === undefined ? "" : v)
  .replace(/[^\p{L}\p{N} _.\-\/]/gu, "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 20);

// Can this student see / take this test? (tests with no sections are for everyone)
const testOpenTo = (test, user) => {
  const secs = (test && test.sections) || [];
  if (!secs.length) return true;
  return !!(user && user.section && secs.includes(user.section));
};
// Same rule as a Mongo filter (for list pages)
const testFilterFor = (user) => {
  const none = { $or: [{ sections: { $exists: false } }, { sections: { $size: 0 } }] };
  return user && user.section ? { $or: [...none.$or, { sections: user.section }] } : none;
};

module.exports = { isId, escapeRegex, safeBack, pageParam, nameOf, normSection, testOpenTo, testFilterFor };
