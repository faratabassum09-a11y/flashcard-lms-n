// Class sections (A, B, CSE-C ...): counts and "how many students is this test for".
const User = require("../models/user");
const Section = require("../models/section");
const { STUDENTS } = require("./roles");
const userCache = require("./userCache");
const NOT_ADMIN = STUDENTS;                    // (name kept) students only: no admin, no teachers
const byName = (a, b) => a.section.localeCompare(b.section, undefined, { numeric: true });

let cached = null, cachedAt = 0;
const clearSectionCache = () => { cached = null; };
// -> { list: [{section, count}], unassigned, total }   (sections that exist but are still empty are listed with count 0)
// Remembered for a few seconds: every staff page asks for it, and it only changes when students/sections change.
async function sectionCounts() {
  if (cached && Date.now() - cachedAt < 10000) return cached;
  cached = null;
  const [rows, named] = await Promise.all([
    User.aggregate([{ $match: NOT_ADMIN }, { $group: { _id: { $ifNull: ["$section", ""] }, n: { $sum: 1 } } }]),
    Section.find({}).select("name").lean()
  ]);
  const map = new Map();
  named.forEach(x => map.set(x.name, 0));
  rows.filter(r => r._id).forEach(r => map.set(r._id, r.n));
  const list = [...map].map(([section, count]) => ({ section, count })).sort(byName);
  const unassigned = (rows.find(r => !r._id) || {}).n || 0;
  const out = { list, unassigned, total: list.reduce((a, s) => a + s.count, 0) + unassigned };
  cached = out; cachedAt = Date.now();
  return out;
}

// make sure these section names exist as options (called whenever a student is put into a section)
async function ensureSections(names) {
  clearSectionCache();
  userCache.clear();                                        // students' sections changed -> reload signed-in users
  const clean = [...new Set((names || []).filter(Boolean))];
  if (!clean.length) return;
  await Section.bulkWrite(clean.map(name => ({ updateOne: { filter: { name }, update: { $setOnInsert: { name } }, upsert: true } })), { ordered: false });
}

// number of students a test is meant for
function audienceOf(test, counts) {
  const secs = (test && test.sections) || [];
  if (!secs.length) return counts.total;
  const m = new Map(counts.list.map(s => [s.section, s.count]));
  return secs.reduce((a, s) => a + (m.get(s) || 0), 0);
}

// Mongo filter for the "section" query parameter: "" = everyone, "__none" = not assigned, otherwise that section
const UNASSIGNED = "__none";
function sectionFilter(section) {
  if (!section) return null;
  if (section === UNASSIGNED) return { $or: [{ section: { $exists: false } }, { section: "" }, { section: null }] };
  return { section };
}

module.exports = { sectionCounts, ensureSections, clearSectionCache, audienceOf, sectionFilter, UNASSIGNED, NOT_ADMIN };
