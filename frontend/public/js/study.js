/* Full-screen-ish flashcard study mode with keyboard shortcuts and server-synced progress. */
(function () {
  "use strict";
  var raw = document.getElementById("deck-data");
  if (!raw) return;
  var deck = JSON.parse(raw.textContent), order = deck.map(function (_, i) { return i; });
  var i = 0, knew = {}, learn = {};
  var $ = function (id) { return document.getElementById(id); };
  var card = $("card");

  function post(id, action) {
    return fetch("/flashcards/" + id + "/progress", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ action: action }) })
      .catch(function () { window.toast && window.toast("Could not save progress", "bad"); });
  }
  function cur() { return deck[order[i]]; }

  function render() {
    var c = cur();
    card.classList.remove("is-flipped");
    $("qText").textContent = c.q; $("aText").textContent = c.a; $("subjF").textContent = c.s;
    $("pos").textContent = i + 1;
    $("bar").style.setProperty("--v", (i / deck.length * 100) + "%");
    $("knewN").textContent = Object.keys(knew).length; $("learnN").textContent = Object.keys(learn).length;
    ["bmF", "bmB"].forEach(function (id) { $(id).classList.toggle("on", !!c.b); });
    $("tryInput").value = ""; $("tryRes").classList.remove("show");
  }
  function flip() { card.classList.toggle("is-flipped"); }
  function go(d) { i = Math.min(deck.length, Math.max(0, i + d)); if (i >= deck.length) return finish(); render(); }
  function finish() {
    $("studyApp").hidden = true; $("summary").hidden = false;
    var k = Object.keys(knew).length, l = deck.length - k;
    $("sumKnew").textContent = k;
    $("sumLearnTxt").textContent = l ? l + " still to go — they are saved as 'still learning'." : "Every card in this round is now mastered.";
    $("bar").style.setProperty("--v", "100%");
  }
  function mark(known) {
    var c = cur();
    if (known) { knew[c.id] = 1; delete learn[c.id]; c.k = true; post(c.id, "known"); }
    else { learn[c.id] = 1; delete knew[c.id]; c.k = false; post(c.id, "unknown"); }
    go(1);
  }
  function toggleSave() {
    var c = cur(); c.b = !c.b;
    ["bmF", "bmB"].forEach(function (id) { $(id).classList.toggle("on", c.b); });
    post(c.id, c.b ? "bookmark" : "unbookmark");
  }
  function shuffle() {
    for (var n = order.length - 1; n > 0; n--) { var j = Math.floor(Math.random() * (n + 1)), t = order[n]; order[n] = order[j]; order[j] = t; }
    i = 0; render(); window.toast && window.toast("Deck shuffled", "ok");
  }

  card.addEventListener("click", function (e) { if (e.target.closest(".fc-act")) return; flip(); });
  $("btnKnow").addEventListener("click", function () { mark(true); });
  $("btnLearn").addEventListener("click", function () { mark(false); });
  $("btnNext").addEventListener("click", function () { go(1); });
  $("btnPrev").addEventListener("click", function () { go(-1); });
  $("btnShuffle").addEventListener("click", shuffle);
  $("bmF").addEventListener("click", function (e) { e.stopPropagation(); toggleSave(); });
  $("bmB").addEventListener("click", function (e) { e.stopPropagation(); toggleSave(); });
  $("sumRestart").addEventListener("click", function () { i = 0; knew = {}; learn = {}; $("summary").hidden = true; $("studyApp").hidden = false; render(); });

  document.addEventListener("keydown", function (e) {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if ($("studyApp").hidden) return;
    var k = e.key.toLowerCase();
    if (k === " " || k === "enter") { e.preventDefault(); flip(); }
    else if (k === "arrowright") go(1); else if (k === "arrowleft") go(-1);
    else if (k === "k") mark(true); else if (k === "l") mark(false);
    else if (k === "b") toggleSave(); else if (k === "s") shuffle();
  });

  /* "test yourself": uses the same matching as real tests, but nothing is recorded */
  $("tryBtn").addEventListener("click", function () {
    var btn = this; btn.disabled = true;
    fetch("/check-answer", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ questionId: cur().id, answer: $("tryInput").value }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var p = d.percent || 0;
        $("tryBar").style.setProperty("--v", p + "%");
        $("tryBar").className = "bar grow " + (p >= 75 ? "ok" : p >= 50 ? "warn" : "bad");
        $("tryPct").textContent = p + "% match" + (p >= 75 ? " — full marks!" : p >= 50 ? " — half marks" : "");
        $("tryRes").classList.add("show");
      })
      .catch(function () { window.toast && window.toast("Could not check right now", "bad"); })
      .then(function () { btn.disabled = false; });
  });

  render();
})();
