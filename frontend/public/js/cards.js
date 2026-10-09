/* Flashcard browse page: flip, save, mark as mastered (synced to the server). */
(function () {
  "use strict";
  var grid = document.getElementById("cards");
  if (!grid) return;
  var counter = document.getElementById("masteredCount");

  function post(id, action) {
    return fetch("/flashcards/" + id + "/progress", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action: action })
    }).then(function (r) { if (!r.ok) throw new Error("bad"); return r.json(); });
  }
  function setBtns(card, act, on) {
    card.querySelectorAll('[data-act="' + act + '"]').forEach(function (b) { b.classList.toggle("on", on); });
  }

  grid.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    var card = e.target.closest(".fc");
    if (!card) return;
    if (!btn) { card.classList.toggle("is-flipped"); return; }
    e.stopPropagation();
    var act = btn.getAttribute("data-act"), on = !btn.classList.contains("on"), id = card.getAttribute("data-id");
    setBtns(card, act, on);
    if (act === "known") { card.classList.toggle("is-known", on); if (counter) counter.textContent = Math.max(0, parseInt(counter.textContent, 10) + (on ? 1 : -1)); }
    post(id, act === "known" ? (on ? "known" : "unknown") : (on ? "bookmark" : "unbookmark")).catch(function () {
      setBtns(card, act, !on);
      if (act === "known") { card.classList.toggle("is-known", !on); if (counter) counter.textContent = Math.max(0, parseInt(counter.textContent, 10) + (on ? -1 : 1)); }
      window.toast && window.toast("Could not save — check your connection", "bad");
    });
  });
  grid.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("fc")) { e.preventDefault(); e.target.classList.toggle("is-flipped"); }
  });
})();
