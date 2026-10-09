/* FlashPortal — shared behaviour (theme, drawer, toasts, confirm dialogs, countdowns, small helpers). No dependencies. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ── Theme ── */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-theme-toggle]");
    if (!t) return;
    var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    store.set("theme", next);
  });

  /* ── Mobile drawer ── */
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-nav-toggle]")) document.body.classList.toggle("nav-open");
    else if (document.body.classList.contains("nav-open") && e.target.closest(".sidebar a")) document.body.classList.remove("nav-open");
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") document.body.classList.remove("nav-open"); });

  /* ── Toasts ── */
  var ICON = { ok: "check-circle", bad: "x-circle", info: "info" };
  function toast(msg, type) {
    var box = $("#toasts"); if (!box) return;
    type = type || "info";
    var el = document.createElement("div");
    el.className = "toast " + type;
    el.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-' + (ICON[type] || "info") + '"/></svg><p></p>' +
      '<button class="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Dismiss"><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button>';
    el.querySelector("p").textContent = msg;
    var close = function () { el.classList.add("out"); setTimeout(function () { el.remove(); }, 260); };
    el.querySelector("button").addEventListener("click", close);
    box.appendChild(el);
    setTimeout(close, 5000);
  }
  window.toast = toast;
  var td = $("#toast-data");
  if (td) { try { JSON.parse(td.textContent).forEach(function (t) { toast(t.msg, t.type); }); } catch (e) {} }

  /* ── Confirm dialog (replaces ugly window.confirm). Usage: <form data-confirm="Delete this?" data-confirm-ok="Delete"> ── */
  var dlg;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "modal";
    dlg.innerHTML = '<form method="dialog"><div class="modal-body"><h3></h3><p></p></div><div class="modal-foot">' +
      '<button class="btn btn-ghost" value="cancel">Cancel</button><button class="btn btn-primary" value="ok" autofocus></button></div></form>';
    document.body.appendChild(dlg);
    return dlg;
  }
  function ask(opts, cb) {
    if (!window.HTMLDialogElement) { if (window.confirm(opts.text || opts.title)) cb(); return; }
    var d = ensureDialog();
    d.querySelector("h3").textContent = opts.title || "Are you sure?";
    d.querySelector("p").textContent = opts.text || "";
    var ok = d.querySelector('button[value="ok"]');
    ok.textContent = opts.ok || "Confirm";
    ok.className = "btn " + (opts.danger ? "btn-danger" : "btn-primary");
    d.onclose = function () { if (d.returnValue === "ok") cb(); d.returnValue = ""; };
    d.showModal();
  }
  window.askConfirm = ask;
  document.addEventListener("submit", function (e) {
    var f = e.target, sub = e.submitter;
    if (f.__confirmed) return;
    var src = (sub && sub.hasAttribute("data-confirm")) ? sub : (f.hasAttribute("data-confirm") ? f : null);
    if (src) {
      e.preventDefault();
      ask({ title: src.getAttribute("data-confirm-title") || "Are you sure?", text: src.getAttribute("data-confirm"),
            ok: src.getAttribute("data-confirm-ok") || "Confirm", danger: src.getAttribute("data-confirm-tone") !== "primary" }, function () {
        f.__confirmed = true;
        if (f.requestSubmit && sub) f.requestSubmit(sub); else f.submit();
      });
      return;
    }
    /* double-submit guard + loading state */
    if (f.hasAttribute("data-no-loading")) return;
    if (f.__busy) { e.preventDefault(); return; }
    f.__busy = true;
    if (sub) sub.classList.add("is-loading");
    setTimeout(function () { f.__busy = false; if (sub) sub.classList.remove("is-loading"); }, 8000);   // recover if the request fails
  }, true);

  /* ── Generic dialogs: <button data-open="#id"> ── */
  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { var d = $(o.getAttribute("data-open")); if (d && d.showModal) { d.showModal(); var i = $("input:not([type=hidden]),textarea", d); if (i) i.focus(); } }
    var c = e.target.closest("[data-close]");
    if (c) { var dd = c.closest("dialog"); if (dd) dd.close(); }
    if (e.target.tagName === "DIALOG" && e.target.classList.contains("modal")) e.target.close();
  });

  /* ── Tabs ── */
  $$("[data-tabs]").forEach(function (root) {
    var tabs = $$("[role=tab]", root);
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
    function show(i) {
      tabs.forEach(function (t, j) { t.setAttribute("aria-selected", j === i ? "true" : "false"); });
      panels.forEach(function (p, j) { if (p) p.hidden = j !== i; });
    }
    tabs.forEach(function (t, i) { t.addEventListener("click", function () { show(i); }); });
    var start = tabs.findIndex(function (t) { return t.getAttribute("aria-selected") === "true"; });
    show(start < 0 ? 0 : start);
  });

  /* ── Live table / list filter: <input data-filter="#tbody"> filters children by text ── */
  $$("[data-filter]").forEach(function (inp) {
    var target = $(inp.getAttribute("data-filter"));
    if (!target) return;
    var rows = $$(inp.getAttribute("data-filter-items") || "tr", target);
    inp.addEventListener("input", function () {
      var q = inp.value.trim().toLowerCase();
      rows.forEach(function (r) { r.hidden = q && r.textContent.toLowerCase().indexOf(q) === -1; });
    });
  });

  /* ── Countdowns: <span data-countdown="ISO" data-mode="until|left"> ── */
  var cds = $$("[data-countdown]");
  function fmtDur(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    var p = function (n) { return n < 10 ? "0" + n : n; };
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + ":" + p(m) + ":" + p(x);
    return p(m) + ":" + p(x);
  }
  function tick() {
    var now = Date.now();
    cds.forEach(function (el) {
      var t = new Date(el.getAttribute("data-countdown")).getTime();
      if (isNaN(t)) return;
      var left = t - now;
      if (left <= 0) {
        el.textContent = el.getAttribute("data-mode") === "left" ? "Time is up" : "Starting…";
        if (!el.__r) {
          el.__r = true;
          var key = "cd:" + location.pathname, n = parseInt(store.get(key) || "0", 10);
          if (n < 6) { store.set(key, String(n + 1)); setTimeout(function () { location.reload(); }, 6000 + Math.random() * 4000); }
        }
      } else el.textContent = fmtDur(left);
    });
  }
  if (cds.length) { tick(); setInterval(tick, 1000); }

  /* ── Dropzone file name ── */
  $$(".dropzone").forEach(function (z) {
    var inp = $("input[type=file]", z), label = $("[data-file-name]", z);
    if (!inp) return;
    inp.addEventListener("change", function () {
      if (!label) return;
      var n = inp.files.length, names = Array.prototype.map.call(inp.files, function (f) { return f.name; });
      label.textContent = !n ? label.getAttribute("data-default") : n === 1 ? names[0] : n + " files: " + names.slice(0, 3).join(", ") + (n > 3 ? " +" + (n - 3) + " more" : "");
    });
    ["dragenter", "dragover"].forEach(function (ev) { z.addEventListener(ev, function (e) { e.preventDefault(); z.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { z.addEventListener(ev, function () { z.classList.remove("is-over"); }); });
    z.addEventListener("drop", function (e) { e.preventDefault(); if (e.dataTransfer.files.length) { inp.files = e.dataTransfer.files; inp.dispatchEvent(new Event("change")); } });
  });

  /* ── Password reveal + strength meter ── */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-reveal]"); if (!b) return;
    var inp = b.parentElement.querySelector("input"); if (!inp) return;
    var show = inp.type === "password"; inp.type = show ? "text" : "password";
    b.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-' + (show ? "eye-off" : "eye") + '"/></svg>';
  });
  $$("[data-strength]").forEach(function (inp) {
    var meter = $(inp.getAttribute("data-strength"));
    inp.addEventListener("input", function () {
      var v = inp.value, s = 0;
      if (v.length >= 6) s++; if (v.length >= 10) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
      meter.setAttribute("data-s", v ? String(Math.max(1, s)) : "0");
    });
  });

  /* ── Checkbox that switches another input off: <input type="checkbox" data-disables="#subject"> ── */
  $$("[data-disables]").forEach(function (cb) {
    var t = $(cb.getAttribute("data-disables")); if (!t) return;
    var req = t.required;
    cb.addEventListener("change", function () { t.disabled = cb.checked; t.required = req && !cb.checked; });
  });

  /* ── Misc ── */
  $$("select[data-autosubmit]").forEach(function (s) { s.addEventListener("change", function () { s.form.submit(); }); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      var s = $("[data-search]"); if (s) { e.preventDefault(); s.focus(); s.select(); }
    }
  });
})();
