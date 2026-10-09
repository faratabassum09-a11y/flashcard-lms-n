/* Admin: client-side question picker for "Create test" (fast even with thousands of flashcards). */
(function () {
  "use strict";
  var raw = document.getElementById("poolData"); if (!raw) return;
  var pool = JSON.parse(raw.textContent), sel = new Map(), LIMIT = 150;
  var $ = function (id) { return document.getElementById(id); };
  var list = $("pList"), shown = [];

  function visible() {
    var q = $("pSearch").value.trim().toLowerCase(), s = $("pSubject").value;
    return pool.filter(function (c) { return (!s || c.s === s) && (!q || c.q.toLowerCase().indexOf(q) > -1); });
  }
  function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
  function render() {
    var all = visible(); shown = all.slice(0, LIMIT);
    list.innerHTML = shown.map(function (c) {
      var on = sel.has(c.id), m = on ? sel.get(c.id) : "";
      return '<label class="pick' + (on ? " is-on" : "") + '" data-id="' + c.id + '"><input type="checkbox"' + (on ? " checked" : "") + '>' +
        '<span class="q">' + esc(c.q) + '<small>' + esc(c.s) + '</small></span>' +
        '<input class="input input-sm marks" type="number" min="0.5" step="0.5" value="' + (on ? m : $("pMarks").value) + '" aria-label="Marks"></label>';
    }).join("") || '<div class="empty" style="padding:24px">No questions match.</div>';
    if (all.length > LIMIT) list.insertAdjacentHTML("beforeend", '<div class="muted small center" style="padding:12px">Showing first ' + LIMIT + ' of ' + all.length + ' — refine the search to see more.</div>');
    $("poolInfo").textContent = all.length + " of " + pool.length + " questions";
    stats();
  }
  function stats() {
    var t = 0; sel.forEach(function (m) { t += Number(m) || 0; });
    $("pCount").textContent = sel.size; $("pTotal").textContent = Math.round(t * 10) / 10;
  }
  list.addEventListener("change", function (e) {
    var row = e.target.closest(".pick"); if (!row) return; var id = row.dataset.id, marks = row.querySelector(".marks");
    if (e.target.type === "checkbox") { if (e.target.checked) sel.set(id, marks.value || $("pMarks").value); else sel.delete(id); row.classList.toggle("is-on", e.target.checked); }
    else if (sel.has(id)) sel.set(id, e.target.value);
    stats();
  });
  list.addEventListener("input", function (e) { var row = e.target.closest(".pick"); if (row && e.target.classList.contains("marks") && sel.has(row.dataset.id)) { sel.set(row.dataset.id, e.target.value); stats(); } });
  $("pSearch").addEventListener("input", render); $("pSubject").addEventListener("change", render);
  $("pAll").addEventListener("click", function () { shown.forEach(function (c) { if (!sel.has(c.id)) sel.set(c.id, $("pMarks").value || 1); }); render(); });
  $("pNone").addEventListener("click", function () { sel.clear(); render(); });
  $("pMarks").addEventListener("change", function () { sel.forEach(function (_, id) { sel.set(id, $("pMarks").value); }); render(); });

  $("testForm").addEventListener("submit", function (e) {
    var out = $("hiddenOut"); out.innerHTML = "";
    if ($("pickMode").value === "random") {                      // random: the server picks the questions, nothing to send
      var n = Number($("rCount").value), av = availableRandom();
      if (!(n >= 1)) { e.preventDefault(); e.stopImmediatePropagation(); window.toast && window.toast("Enter how many random questions you want", "bad"); return; }
      if (n > av) { e.preventDefault(); e.stopImmediatePropagation(); window.toast && window.toast("Only " + av + " questions available — lower the number", "bad"); return; }
      return;
    }
    if (!sel.size) { e.preventDefault(); e.stopImmediatePropagation(); window.toast && window.toast("Select at least one question", "bad"); return; }
    sel.forEach(function (m, id) {
      out.insertAdjacentHTML("beforeend", '<input type="hidden" name="questionIds" value="' + id + '"><input type="hidden" name="marks" value="' + (Number(m) > 0 ? m : 1) + '">');
    });
  }, true);
  // ── manual / random switch ──
  function availableRandom() {
    var o = $("rSub").selectedOptions[0];
    return o && o.dataset.n !== undefined ? Number(o.dataset.n) : pool.length;
  }
  function showAvail() { $("randAvail").textContent = availableRandom(); }
  document.querySelectorAll(".seg-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      var random = b.dataset.mode === "random";
      $("pickMode").value = b.dataset.mode;
      document.querySelectorAll(".seg-btn").forEach(function (x) { x.classList.toggle("is-active", x === b); x.setAttribute("aria-selected", x === b); });
      $("randPanel").hidden = !random; $("picker").hidden = random;
      if (random) showAvail();
    });
  });
  $("rSub").addEventListener("change", showAvail);
  render();
})();

/* Admin: "Who writes this test?" - show the section list, and per-section times when sections write at different times. */
(function () {
  "use strict";
  var box = document.getElementById("targetBox"); if (!box) return;
  var panel = document.getElementById("secPanel"); if (!panel) return;
  var same = document.getElementById("sameTime");
  function sync() {
    var on = box.querySelector('input[name="target"]:checked').value === "sections";
    panel.hidden = !on;
    panel.classList.toggle("diff", on && !same.checked);
  }
  box.addEventListener("change", sync); sync();
  document.getElementById("secAll").addEventListener("click", function () { panel.querySelectorAll('input[name="secOn"]').forEach(function (c) { c.checked = true; }); });
  document.getElementById("secNone").addEventListener("click", function () { panel.querySelectorAll('input[name="secOn"]').forEach(function (c) { c.checked = false; }); });
  var form = document.getElementById("testForm");
  if (form) form.addEventListener("submit", function (e) {
    if (box.querySelector('input[name="target"]:checked').value === "sections" && !panel.querySelector('input[name="secOn"]:checked')) {
      e.preventDefault(); e.stopImmediatePropagation(); window.toast && window.toast("Tick at least one section", "bad");
    }
  }, true);
})();
