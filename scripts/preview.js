// Dev tool: serves every page with sample data (no database) so you can look at the design.
//   node scripts/preview.js   ->  http://localhost:4000/  (index of all pages)
const path = require("path");
const express = require("express");
const ejsMate = require("ejs-mate");
const { fixtures, baseLocals } = require("../test/fixtures");

const app = express();
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../frontend/views"));
app.use(express.static(path.join(__dirname, "../frontend/public")));
app.get("/", (req, res) => res.send(Object.keys(fixtures).map(k => `<p><a href="/preview/${k}">${k}</a></p>`).join("")));
app.get("/preview/:name", (req, res) => {
  const f = fixtures[req.params.name];
  if (!f) return res.status(404).send("unknown page");
  res.render(f.view, { ...baseLocals(f), ...f.data, path: req.query.path || baseLocals(f).path });
});
app.listen(process.env.PORT || 4000, () => console.log("Preview on http://localhost:" + (process.env.PORT || 4000)));
