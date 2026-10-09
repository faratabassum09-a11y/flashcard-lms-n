// Start-up helpers: database health + clean-up of leftovers from older projects/versions.

// Old databases sometimes carry an extra UNIQUE index on the users collection (e.g. email_1 or rollNo_1 from an earlier
// project). Every new account without that field then collides on "null" and creating students/teachers fails.
// Only the username index may be unique, so remove the others.
async function dropStrayUserIndexes(db) {
  let idx;
  try { idx = await db.collection("users").indexes(); } catch (e) { return; }        // collection does not exist yet
  for (const i of idx) {
    if (i.name === "_id_" || !i.unique) continue;
    const keys = Object.keys(i.key || {});
    if (keys.length === 1 && keys[0] === "username") continue;
    try {
      await db.collection("users").dropIndex(i.name);
      console.log(`Removed leftover unique index "${i.name}" on users (it stopped new accounts from being created)`);
    } catch (e) { console.warn(`Could not remove index "${i.name}":`, e.message); }
  }
}

// Round-trip time to MongoDB. Most "the site is very slow" cases are a database in a far-away region.
async function measureDb(db) {
  const times = [];
  for (let i = 0; i < 3; i++) { const t = Date.now(); await db.admin().ping(); times.push(Date.now() - t); }
  const ms = Math.min(...times);
  console.log(`Database round-trip: ${ms} ms`);
  if (ms > 120) {
    console.warn(`⚠  Your database answers slowly (${ms} ms per query). Every page makes several queries, so pages will feel slow.\n` +
                 `   Fix: use a MongoDB Atlas cluster in a nearby region (Mumbai / ap-south-1), or install MongoDB locally for testing.`);
  }
  return ms;
}

// A short, safe description of a database error for the admin screen
function explain(e) {
  if (!e) return "unknown error";
  if (e.code === 11000) return `database rule blocked it (duplicate ${Object.keys(e.keyPattern || e.keyValue || {}).join(", ") || "key"})`;
  if (/buffering timed out|ServerSelection|ECONN|ETIMEDOUT|ENOTFOUND/i.test(e.name + " " + e.message)) return "cannot reach the database right now (check internet / Atlas IP access list)";
  if (e.name === "ValidationError") return Object.values(e.errors || {}).map(x => x.message).join("; ");
  return String(e.message || e).slice(0, 160);
}

module.exports = { dropStrayUserIndexes, measureDb, explain };
