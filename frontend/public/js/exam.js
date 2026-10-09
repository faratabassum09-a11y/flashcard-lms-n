/* Test-taking screen: timer (deadline based), autosave, palette, flags, fullscreen + tab-switch rules, safe submit. */
(function () {
  "use strict";
  var root = document.getElementById("exam");
  if (!root) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var testId = root.dataset.testId, user = root.dataset.user, total = parseInt(root.dataset.count, 10), allowCheck = root.dataset.allowCheck === "true";
  var deadline = Date.now() + parseInt(root.dataset.remaining, 10) * 1000;      // shared test clock, fixed when the page loaded
  var cards = $$(".q-card"), pals = $$(".pbtn"), form = $("#testForm");
  var draftKey = "exam:" + testId + ":" + user;
  var started = false, submitted = false, fsTimer = null, violations = 0, cur = 0, flags = {};

  /* ── draft (survives refresh) ── */
  function readDraft() { try { return JSON.parse(localStorage.getItem(draftKey) || "{}"); } catch (e) { return {}; } }
  var saveT, dirty = false, lastSync = 0, syncing = false;
  function collect() { var a = {}; cards.forEach(function (c) { var v = $("textarea", c).value; if (v) a[c.dataset.qid] = v; }); return a; }
  function saveDraft() {
    dirty = true;
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      var d = { a: collect(), f: flags, t: Date.now() };
      try { localStorage.setItem(draftKey, JSON.stringify(d)); } catch (e) {}
    }, 350);
  }
  // Start from the newest copy: this device's, or the one saved on the server (other device / cleared browser).
  var local = readDraft(), remote = {};
  try { var el = document.getElementById("serverDraft"); if (el) remote = JSON.parse(el.textContent) || {}; } catch (e) {}
  var draft = (remote.t && remote.t > (local.t || 0)) ? remote : local;
  cards.forEach(function (c) {
    var q = c.dataset.qid, v = (draft.a && draft.a[q]) || (local.a && local.a[q]) || (remote.a && remote.a[q]);
    if (v) $("textarea", c).value = v;
    if (draft.f && draft.f[q]) flags[q] = true;
  });

  /* ── connection banner + server-side autosave (every ~15 s, only when something changed) ── */
  var net = $("#netBanner");
  function setNet(msg) { if (!net) return; if (msg) { net.textContent = msg; net.classList.add("show"); } else net.classList.remove("show"); }
  window.addEventListener("offline", function () { setNet("You are offline. Keep writing: your answers are saved on this device and will be sent when the connection returns."); });
  window.addEventListener("online", function () { setNet(""); syncNow(); });
  function syncNow() {
    if (syncing || submitted || !window.fetch || !started) return;
    syncing = true; var snap = { answers: collect(), flags: flags }; var was = dirty; dirty = false;
    fetch("/test/" + testId + "/draft", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(snap) })
      .then(function (r) { if (r.status === 401) { setNet("You were signed out. Open the sign-in page in a new tab, sign in, and keep writing. Your answers are kept."); throw new Error("auth"); } if (!r.ok) throw new Error("http"); return r.json(); })
      .then(function () { lastSync = Date.now(); if (navigator.onLine !== false) setNet(""); })
      .catch(function () { dirty = dirty || was; })
      .then(function () { syncing = false; });
  }
  setInterval(function () { if (dirty && Date.now() - lastSync > 12000) syncNow(); }, 5000);

  /* ── progress / palette ── */
  function answered(i) { return $("textarea", cards[i]).value.trim().length > 0; }
  function refresh() {
    var n = 0;
    cards.forEach(function (c, i) {
      var a = answered(i); if (a) n++;
      pals[i].classList.toggle("is-done", a);
      pals[i].classList.toggle("is-flag", !!flags[c.dataset.qid]);
      pals[i].classList.toggle("is-current", i === cur);
    });
    $("#answeredN").textContent = n;
    $("#progressBar").style.setProperty("--v", (n / total * 100) + "%");
    return n;
  }
  function show(i) {
    cur = Math.max(0, Math.min(total - 1, i));
    cards.forEach(function (c, j) { c.classList.toggle("is-on", j === cur); });
    var fl = $("[data-flag]", cards[cur]); fl.querySelector("span").textContent = flags[cards[cur].dataset.qid] ? "Flagged" : "Flag for review";
    fl.style.color = flags[cards[cur].dataset.qid] ? "var(--warn)" : "";
    refresh();
    var t = $("textarea", cards[cur]); if (t && started) t.focus({ preventScroll: true });
    $(".exam-main").scrollTop = 0;
  }
  pals.forEach(function (b) { b.addEventListener("click", function () { show(+b.dataset.i); }); });
  cards.forEach(function (c) {
    $("textarea", c).addEventListener("input", function () { refresh(); saveDraft(); });
    var p = $("[data-prev]", c), n = $("[data-next]", c), f = $("[data-finish]", c), fl = $("[data-flag]", c), ck = $("[data-check]", c);
    if (p) p.addEventListener("click", function () { show(cur - 1); });
    if (n) n.addEventListener("click", function () { show(cur + 1); });
    if (f) f.addEventListener("click", confirmSubmit);
    fl.addEventListener("click", function () { var q = c.dataset.qid; if (flags[q]) delete flags[q]; else flags[q] = true; show(cur); saveDraft(); });
    if (ck && allowCheck) ck.addEventListener("click", function () {
      var out = $("[data-check-result]", c); out.textContent = "Checking…";
      fetch("/check-answer", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ questionId: c.dataset.qid, answer: $("textarea", c).value, testId: testId }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { out.textContent = d.error ? d.error : "Match: " + d.percent + "%"; out.className = "small " + (d.percent >= 75 ? "ok" : d.percent >= 50 ? "warn" : "bad"); })
        .catch(function () { out.textContent = "Could not check"; });
    });
  });

  /* ── timer (computed from the deadline, so background throttling cannot slow it down) ── */
  function tickTimer() {
    if (submitted) return;
    var left = Math.max(0, Math.round((deadline - Date.now()) / 1000)), m = Math.floor(left / 60), s = left % 60;
    $("#timer").textContent = m + ":" + (s < 10 ? "0" : "") + s;
    $("#timerBox").classList.toggle("low", left <= 60);
    if (left <= 0) autoSubmit("Time is up");
  }

  /* ── start (must run inside the click so fullscreen is allowed) ── */
  function enterFs() {
    var el = document.documentElement, r = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    return r ? Promise.resolve(r.call(el)) : Promise.reject(new Error("unsupported"));
  }
  $("#startBtn").addEventListener("click", function () {
    enterFs().then(function () {
      started = true;
      $("#intro").style.display = "none"; root.classList.add("is-on");
      show(0); tickTimer(); setInterval(tickTimer, 1000);
    }).catch(function () {
      window.toast && window.toast("Full screen is required. Please allow it and press Start again.", "bad");
    });
  });
  $("#resumeBtn").addEventListener("click", function () { enterFs().catch(function () { window.toast && window.toast("Could not re-enter full screen", "bad"); }); });

  /* ── submit ── */
  var dlg = $("#submitDlg");
  function confirmSubmit() {
    if (submitted) return;
    var n = refresh(), un = total - n, fl = Object.keys(flags).length;
    $("#submitSummary").textContent = "You answered " + n + " of " + total + " questions." + (un ? " " + un + " " + (un === 1 ? "is" : "are") + " still blank." : "") + (fl ? " " + fl + " flagged for review." : "");
    dlg.onclose = function () { if (dlg.returnValue === "ok") doSubmit(); dlg.returnValue = ""; };
    dlg.showModal();
  }
  $("#submitBtn").addEventListener("click", confirmSubmit);

  // The answers stay on this device until the server confirms. A failed or slow submit is retried automatically
  // (the server accepts a repeat safely: one result per student), so a network blip can never lose a test.
  var payload = null, tries = 0, sending = false;
  function sendNow() {
    if (sending) return; sending = true; tries++;
    var msg = $("#submitReason"), btn = $("#retryBtn"); if (btn) btn.style.display = "none";
    fetch("/submit-test", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) })
      .then(function (r) {
        if (r.status === 401) { var e = new Error("auth"); e.auth = true; throw e; }
        return r.json().then(function (d) { d.httpOk = r.ok; return d; });
      })
      .then(function (d) {
        sending = false;
        if (d && d.ok) { try { localStorage.removeItem(draftKey); } catch (e) {} window.location.href = d.redirect || "/tests"; return; }
        if (d && d.final) { msg.textContent = d.message + ". Please tell your teacher."; if (btn) { btn.textContent = "Back to tests"; btn.onclick = function () { window.location.href = "/tests"; }; btn.style.display = ""; } return; }
        retryLater("The server is busy");
      })
      .catch(function (e) { sending = false; retryLater(e && e.auth ? "You were signed out. Sign in again in a new tab, then press Retry" : "Connection problem"); });
  }
  function retryLater(why) {
    var msg = $("#submitReason"), btn = $("#retryBtn"), wait = Math.min(15, 2 + tries * 2) + Math.random() * 2, left = Math.ceil(wait);
    if (btn) { btn.textContent = "Retry now"; btn.onclick = function () { clearInterval(iv); sendNow(); }; btn.style.display = ""; }
    var iv = setInterval(function () {
      left--; msg.textContent = why + ". Your answers are safe. Trying again in " + Math.max(left, 0) + "s…";
      if (left <= 0) { clearInterval(iv); sendNow(); }
    }, 1000);
    msg.textContent = why + ". Your answers are safe. Trying again in " + left + "s…";
  }
  function doSubmit(reason) {
    if (submitted) return;
    submitted = true; clearFsWarn();
    payload = { testId: testId, answers: collect() };             // snapshot taken NOW, before inputs lock
    try { localStorage.setItem(draftKey, JSON.stringify({ a: payload.answers, f: flags, t: Date.now() })); } catch (e) {}
    $("#submitReason").textContent = reason ? reason + " — submitting your answers now." : "Saving your answers and calculating your marks.";
    $$("textarea").forEach(function (t) { t.readOnly = true; });
    $("#submittedOverlay").classList.add("show");
    if (dlg.open) dlg.close();
    try { if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) {}
    if (!window.fetch) { form.submit(); return; }                 // very old browser: plain form post
    // When the clock runs out every student submits in the same second; spread them over ~3 s (the server allows 2 min grace)
    var jitter = reason === "Time is up" ? Math.random() * 3000 : 0;
    setTimeout(sendNow, jitter);
  }
  function autoSubmit(msg) { if (submitted) return; logViolation(msg); doSubmit(msg); }

  /* ── rule enforcement (client-side; violations are logged on the server for review) ── */
  function logViolation(reason) {
    violations++;
    var el = $("#violationCount"); if (el) el.textContent = "Warnings: " + violations;
    try { fetch("/log-event", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", keepalive: true,
      body: JSON.stringify({ testId: testId, reason: reason, time: Date.now() }) }); } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden && started && !submitted) autoSubmit("Tab or window switch detected"); });
  window.addEventListener("blur", function () { if (started && !submitted) logViolation("Window lost focus"); });

  function onFs() {
    if (!started || submitted) return;
    var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!on) { logViolation("Exited full screen"); startFsWarn(); } else clearFsWarn();
  }
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);
  function startFsWarn() {
    if (fsTimer) return;
    var b = $("#warnBanner"), c = $("#warnCount"), n = 5; b.classList.add("show"); c.textContent = n;
    fsTimer = setInterval(function () { n--; c.textContent = n; if (n <= 0) { clearInterval(fsTimer); fsTimer = null; autoSubmit("Left full screen and did not return"); } }, 1000);
  }
  function clearFsWarn() { if (fsTimer) { clearInterval(fsTimer); fsTimer = null; } $("#warnBanner").classList.remove("show"); }

  ["copy", "paste", "cut", "contextmenu", "dragstart"].forEach(function (ev) { document.addEventListener(ev, function (e) { if (started && !submitted) e.preventDefault(); }); });
  document.addEventListener("keydown", function (e) {
    if (!started || submitted) return;
    var k = (e.key || "").toLowerCase();
    if (e.key === "F12" || e.key === "PrintScreen") return e.preventDefault();
    if (e.ctrlKey && ["c", "v", "x", "a", "u", "p", "s", "w", "n", "t"].indexOf(k) > -1) return e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].indexOf(k) > -1) return e.preventDefault();
    if (e.altKey && e.key === "Tab") return e.preventDefault();
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); show(cur + 1); }
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); show(cur - 1); }
  });
  window.addEventListener("beforeunload", function (e) { if (started && !submitted) { e.preventDefault(); e.returnValue = ""; } });
  window.addEventListener("pagehide", function () { if (started && !submitted && dirty && navigator.sendBeacon) { try { navigator.sendBeacon("/test/" + testId + "/draft", new Blob([JSON.stringify({ answers: collect(), flags: flags })], { type: "application/json" })); } catch (e) {} } });
})();
