/* Admin test builder: fast client-side question picker (renders only what is visible, handles thousands of cards). */
(function () {
  "use strict";
  var data = document.getElementById("pool-data"); if (!data) return;
  var pool = JSON.parse(data.textContent), sel = {};           // sel[id] = marks
  var $ = function (id) { return document.getElementById(id); };
  var list = $("pickList"), LIMIT = 200;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function visible() {
    var q = $("pickSearch").value.trim().toLowerCase(), s = $("pickSubject").value;
    return pool.filter(function (p) { return (!s || p.s === s) && (!q || p.q.toLowerCase().indexOf(q) > -1); });
  }
  function render() {
    var v = visible(), shown = v.slice(0, LIMIT);
    list.innerHTML = shown.map(function (p) {
      var on = sel[p.id] !== undefined;
      return '<label class="pick' + (on ? " is-on" : "") + '" data-id="' + p.id + '"><input type="checkbox"' + (on ? " checked" : "") + '>' +
        '<span class="q">' + esc(p.q) + '<small>' + esc(p.s) + '</small></span>' +
        '<input class="input input-sm marks" type="number" min="1" step="0.5" value="' + (on ? sel[p.id] : 1) + '" aria-label="Marks"></label>';
    }).join("") || '<div class="empty"><p>No questions match.</p></div>';
    if (v.length > LIMIT) list.insertAdjacentHTML("beforeend", '<div class="muted small center" style="padding:12px">Showing first ' + LIMIT + ' of ' + v.length + ' — refine the search to see more.</div>');
    summary();
  }
  function summary() {
    var ids = Object.keys(sel), m = 0; ids.forEach(function (i) { m += Number(sel[i]) || 0; });
    $("pickCount").textContent = ids.length; $("pickMarks").textContent = Math.round(m * 10) / 10;
    $("pickHidden").innerHTML = ids.map(function (i) { return '<input type="hidden" name="questionIds" value="' + i + '"><input type="hidden" name="marks" value="' + (Number(sel[i]) || 1) + '">'; }).join("");
  }
  list.addEventListener("change", function (e) {
    var row = e.target.closest(".pick"); if (!row) return; var id = row.dataset.id;
    if (e.target.type === "checkbox") { if (e.target.checked) sel[id] = Number(row.querySelector(".marks").value) || 1; else delete sel[id]; row.classList.toggle("is-on", e.target.checked); }
    else if (sel[id] !== undefined) sel[id] = Number(e.target.value) || 1;
    summary();
  });
  $("pickSearch").addEventListener("input", render); $("pickSubject").addEventListener("change", render);
  $("pickAll").addEventListener("click", function () { var d = Number($("bulkMarks").value) || 1; visible().forEach(function (p) { if (sel[p.id] === undefined) sel[p.id] = d; }); render(); });
  $("pickNone").addEventListener("click", function () { sel = {}; render(); });
  $("applyMarks").addEventListener("click", function () { var d = Number($("bulkMarks").value) || 1; Object.keys(sel).forEach(function (i) { sel[i] = d; }); render(); });
  $("testBuilder").addEventListener("submit", function (e) {
    if (!Object.keys(sel).length) { e.preventDefault(); window.toast && window.toast("Select at least one question", "bad"); }
  });
  render();
})();
