// Bulk import readers: PDF (several layouts) and Excel (several sheets, loose headers). No database needed.
const test = require("node:test");
const assert = require("node:assert");
const xlsx = require("xlsx");
const { pdfRows, excelRows } = require("../backend/utils/importers");

// Minimal text-PDF writer: pages = [[ [x, y, text], ... ]]
function pdf(pages) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = pages.map((items) => {
    const stream = items.map(([x, y, t]) => `BT /F1 11 Tf ${x} ${y} Td (${t.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n"; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

test("PDF flashcards: Q:/A:/Keywords blocks, wrapped answers, page numbers ignored", async () => {
  const rows = await pdfRows(pdf([[
    [50, 780, "Q1. What is photosynthesis?"], [50, 765, "Ans: Plants make food using sunlight,"], [50, 750, "water and carbon dioxide"],
    [50, 735, "Keywords: sunlight, water, carbon dioxide"], [50, 710, "Q2. Powerhouse of the cell?"], [50, 695, "A: Mitochondria"], [50, 40, "Page 1 of 2"]
  ], [[50, 780, "Question 3: Capital of France?"], [50, 765, "Answer: Paris"]]]), "cards");
  assert.deepStrictEqual(rows.map(r => r.question), ["What is photosynthesis?", "Powerhouse of the cell?", "Capital of France?"]);
  assert.strictEqual(rows[0].answer, "Plants make food using sunlight, water and carbon dioxide");
  assert.strictEqual(rows[0].keywords, "sunlight, water, carbon dioxide");
  assert.strictEqual(rows[1].keywords, undefined);
});

test("PDF flashcards: table with header, serial-number column, wrapped cells, repeated header", async () => {
  const hdr = (y) => [[50, y, "S.No"], [90, y, "Question"], [330, y, "Answer"], [480, y, "Keywords"]];
  const rows = await pdfRows(pdf([[
    ...hdr(780), [50, 760, "1"], [90, 760, "What is the unit of force that is very very long"], [330, 760, "Newton"], [480, 760, "newton"],
    [90, 746, "and wraps to a second line?"], [50, 720, "2"], [90, 720, "Define osmosis"], [330, 720, "Movement of water across a membrane"], [330, 706, "from low to high solute"]
  ], [...hdr(780), [50, 760, "3"], [90, 760, "2+2?"], [330, 760, "4"]]]), "cards");
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].question, "What is the unit of force that is very very long and wraps to a second line?");
  assert.strictEqual(rows[0].keywords, "newton");
  assert.strictEqual(rows[1].answer, "Movement of water across a membrane from low to high solute");
  assert.deepStrictEqual([rows[2].question, rows[2].answer], ["2+2?", "4"]);
});

test("PDF flashcards: numbered list and header-less two-column table", async () => {
  const a = await pdfRows(pdf([[[50, 780, "1. Who wrote Hamlet?"], [50, 765, "Answer: Shakespeare"], [50, 740, "2. Who painted Mona Lisa?"], [50, 725, "Answer: Leonardo da Vinci"]]]), "cards");
  assert.deepStrictEqual(a.map(r => r.answer), ["Shakespeare", "Leonardo da Vinci"]);
  const b = await pdfRows(pdf([[[50, 780, "Largest planet"], [300, 780, "Jupiter"], [50, 760, "Smallest planet"], [300, 760, "Mercury"]]]), "cards");
  assert.deepStrictEqual(b.map(r => [r.question, r.answer]), [["Largest planet", "Jupiter"], ["Smallest planet", "Mercury"]]);
});

test("PDF students: header table and plain lines", async () => {
  const t = await pdfRows(pdf([[[50, 780, "Roll No"], [200, 780, "Password"], [50, 760, "21A91A0501"], [200, 760, "Pass@123"], [50, 745, "21A91A0502"], [200, 745, "Pass@124"]]]), "users");
  assert.deepStrictEqual(t, [{ username: "21A91A0501", password: "Pass@123" }, { username: "21A91A0502", password: "Pass@124" }]);
  const p = await pdfRows(pdf([[[50, 780, "username password"], [50, 760, "1. 21B01 abc123"], [50, 745, "21B03,qwe456"]]]), "users");
  assert.deepStrictEqual(p, [{ username: "21B01", password: "abc123" }, { username: "21B03", password: "qwe456" }]);
});

test("PDF students: optional section column (table and plain lines), numeric roll numbers stay roll numbers", async () => {
  const t = await pdfRows(pdf([[[50, 780, "Roll No"], [160, 780, "Password"], [300, 780, "Section"], [50, 760, "21A91A0501"], [160, 760, "Pass@123"], [300, 760, "A"], [50, 745, "21A91A0502"], [160, 745, "Pass@124"], [300, 745, "B"]]]), "users");
  assert.deepStrictEqual(t, [{ username: "21A91A0501", password: "Pass@123", section: "A" }, { username: "21A91A0502", password: "Pass@124", section: "B" }]);
  const p = await pdfRows(pdf([[[50, 780, "21B01 abc123 CSE-A"], [50, 765, "21B02,qwe456,CSE-B"], [50, 750, "101 pw1 A"], [50, 735, "102 pw2 B"]]]), "users");
  assert.deepStrictEqual(p, [{ username: "21B01", password: "abc123", section: "CSE-A" }, { username: "21B02", password: "qwe456", section: "CSE-B" },
                             { username: "101", password: "pw1", section: "A" }, { username: "102", password: "pw2", section: "B" }]);
  const q = await pdfRows(pdf([[[50, 780, "1. 21B01 abc123 A"], [50, 765, "2. 21B02 qwe456 B"]]]), "users");   // serial + roll + password + section
  assert.deepStrictEqual(q.map(r => [r.username, r.section]), [["21B01", "A"], ["21B02", "B"]]);
});

test("Excel students: a section column is picked up (Section / Sec / Class)", () => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([{ "Roll No": "21A01", Password: "x1y2z3", Section: "a" }, { "Roll No": "21A02", Password: "k9", Class: "B" }]), "Sheet1");
  assert.deepStrictEqual(excelRows(xlsx.write(wb, { type: "buffer", bookType: "xlsx" }), "users"),
    [{ username: "21A01", password: "x1y2z3", section: "a" }, { username: "21A02", password: "k9", section: "B" }]);
});

test("PDF without text is rejected with a clear message", async () => {
  await assert.rejects(pdfRows(pdf([[]]), "cards"), /No selectable text/);
});

test("Excel: every sheet is read, headers matched loosely, numeric cells kept", () => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([{ Questions: "2-2?", Ans: 0 }, { Questions: "Capital of India?", Ans: "New Delhi", "Key Words": "delhi" }]), "S1");
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([{ Q: "Symbol of gold?", A: "Au" }]), "S2");
  const rows = excelRows(xlsx.write(wb, { type: "buffer", bookType: "xlsx" }), "cards");
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].answer, 0);
  assert.strictEqual(rows[1].keywords, "delhi");
  assert.strictEqual(rows[2].question, "Symbol of gold?");

  const wb2 = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb2, xlsx.utils.json_to_sheet([{ "Roll No.": "21A01", Password: "x1y2z3" }]), "Sheet1");
  assert.deepStrictEqual(excelRows(xlsx.write(wb2, { type: "buffer", bookType: "xlsx" }), "users"), [{ username: "21A01", password: "x1y2z3" }]);
});
