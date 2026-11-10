/* G1 Dashboard core (window.G1, saved block g1Saved). No localStorage/IndexedDB: all state is tab-local.
   Keys and snapshots are G1-only; no Aviation saved block is read.
    page routing, one upload for every page, the data details drawer, and Save with data.
   Everything runs in this browser tab; the page makes no network requests and nothing is uploaded. */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, $ = K.$, esc = K.esc;
  var MODS = [], BY = {};
  var C = w.G1 = { mods: BY, source: "empty", loadedAt: null, savedAt: null, failed: [],
    standalone: document.documentElement.hasAttribute("data-standalone"), PAGES: ["home", "sof", "spend", "fh", "pr", "esgr"] };
  var TITLE = { home: "Home", sof: "Status of Funds", pr: "PR Tracker", spend: "Spend Plans", fh: "Funeral Honors", esgr: "ESGR" };
  var MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  C.register = function (id, m) { m.id = id; m.dirty = true; MODS.push(m); BY[id] = m; };
  C.TITLE = TITLE;

  // ---------- shared helpers ----------
  C.fyOf = function (d) { return d ? String(d.getFullYear() + (d.getMonth() >= 9 ? 1 : 0)) : ""; };
  C.fmOf = function (d) { return d ? (d.getMonth() + 3) % 12 + 1 : null; };
  C.currentFy = function () { return C.fyOf(new Date()); };
  // share of a fiscal year elapsed, counted in days from 1 October (past years = 1, future years = 0)
  C.fyProgress = function (fy, today) {
    today = today || new Date();
    var s = new Date(+fy - 1, 9, 1), e = new Date(+fy, 9, 1), days = Math.round((e - s) / 864e5);
    if (today < s) return { pct: 0, day: 0, days: days, state: "future" };
    if (today >= e) return { pct: 1, day: days, days: days, state: "past" };
    var day = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - s) / 864e5) + 1;
    return { pct: day / days, day: day, days: days, state: "current" };
  };
  // On pace = within 10% of the straight-line pace (spend share / elapsed share between 0.9 and 1.1)
  C.pace = function (used, elapsed) {
    if (used == null || !isFinite(used) || !elapsed) return { k: "na", t: "No budget" };
    var r = used / elapsed;
    return r > 1.1 ? { k: "over", t: "Over pace", r: r } : r < 0.9 ? { k: "under", t: "Under pace", r: r } : { k: "on", t: "On pace", r: r };
  };
  C.pct = function (x, d) { return x == null || !isFinite(x) ? "\u2014" : (x * 100).toFixed(d || 0) + "%"; };
  C.dateText = function (d) { return d ? ("0" + d.getDate()).slice(-2) + " " + MONS[d.getMonth()] + " " + d.getFullYear() : ""; };
  C.stamp = function (d) { return C.dateText(d) + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); };
  C.sig = function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ":" + h; };
  C.LEVEL_COLORS = ["#a5b4fc", "#818cf8", "#6366f1", "#4338ca", "#312e81", "#1e1b4b"];
  C.levelColor = function (lv) { return C.LEVEL_COLORS[Math.max(0, Math.min(C.LEVEL_COLORS.length - 1, lv - 1))]; };
  C.AASF_COLORS = ["#ea580c", "#0d9488", "#7c3aed", "#2563eb", "#db2777", "#65a30d", "#ca8a04"];

  // ---------- light chart theme ----------
  function chartsInit() {
    Chart.defaults.color = "#475569"; Chart.defaults.borderColor = "#e2e8f0";
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    var base = K.chartBase;
    K.chartBase = function () {
      var o = base(); o.scales.x.grid.color = "rgba(15,23,42,.06)"; o.scales.y.grid.color = "rgba(15,23,42,.06)";
      o.plugins.legend.labels.usePointStyle = true; o.plugins.legend.labels.pointStyle = "rectRounded"; o.elements = { bar: { borderRadius: 4 } };
      return o;
    };
  }

  // ---------- routing (hash, so the browser Back button works) ----------
  // Hash routing is local to this document.
  function page() { var h = location.hash.replace(/^#\/?/, ""), p = h.split("/")[0]; C.sub = C.PAGES.indexOf(p) >= 0 ? decodeURIComponent(h.slice(p.length + 1)) : ""; return C.PAGES.indexOf(p) >= 0 ? p : "home"; }
  C.go = function (p) { if ("#/" + p === location.hash) show(); else location.hash = "#/" + p; };
  function show() {
    var p = page();
    if (C.cur === p && C.lastSub !== C.sub && BY[p]) BY[p].dirty = true;
    C.lastSub = C.sub;
    C.PAGES.forEach(function (x) { $("page-" + x).hidden = x !== p; });
    Array.prototype.forEach.call(document.querySelectorAll("#tabs button"), function (b) { b.classList.toggle("on", b.getAttribute("data-go") === p); });
    document.title = (p === "home" ? "" : TITLE[p] + " \u00b7 ") + "G1 Dashboard";
    if (C.cur !== p || C.sub) w.scrollTo(0, 0);
    C.cur = p; renderPage(p); headerState();
  }
  function renderPage(p) {
    if (p === "home") { if (C.renderHome) C.renderHome(); return; }
    var m = BY[p]; if (!m) return;
    var has = m.hasData();
    Array.prototype.forEach.call(document.querySelectorAll('[data-nodata="' + p + '"]'), function (el) { el.hidden = has; });
    if (m.dirty) { m.dirty = false; m.render(); }
  }
  C.refresh = function () { MODS.forEach(function (m) { m.dirty = true; }); renderPage(page()); renderDrawer(); headerState(); };

  // ---------- reading files: each sheet is offered to every page; the best header match wins ----------
  function readFile(file, cb) {
    var reader = new FileReader(), isCsv = /\.csv$/i.test(file.name);
    reader.onload = function (e) {
      try {
        var wb = isCsv ? XLSX.read(e.target.result, { type: "string", raw: true }) : XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: false });
        cb(null, routeWorkbook(file.name, wb, isCsv));
      } catch (err) { cb(err); }
    };
    reader.onerror = function () { cb(new Error("Could not read the file.")); };
    if (isCsv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  }
  function routeWorkbook(fileName, wb, isCsv) {
    var best = {};
    wb.SheetNames.forEach(function (sn) {
      var ws = wb.Sheets[sn], src = L.sheetSource(ws);
      MODS.forEach(function (m) {
        [].concat(m.classify(src, fileName, ws) || []).forEach(function (c) {
          if (!c || !c.kind) return;
          var key = m.id + "|" + c.kind;
          if (!best[key] || c.score > best[key].score) best[key] = { score: c.score, mod: m, kind: c.kind, src: src, ws: ws, sheet: isCsv ? fileName : sn };
        });
      });
    });
    var keys = Object.keys(best); if (!keys.length) return [];
    var top = {}; keys.forEach(function (k) { var b = best[k]; top[b.mod.id] = Math.max(top[b.mod.id] || 0, b.score); });
    var win = Object.keys(top).sort(function (a, b) { return top[b] - top[a]; })[0];
    var mine = keys.filter(function (k) { return best[k].mod.id === win; });
    return mine.map(function (k) {
      var b = best[k], name = fileName + (mine.length > 1 ? " \u00b7 " + b.sheet : "");
      var e = b.mod.parse(b.kind, b.src, fileName, b.ws, name);
      e.page = win; e.kind = b.kind; e.file = fileName; e.name = name; e.sheet = b.sheet;
      return e;
    });
  }
  C.loadFiles = function (list) {
    var files = Array.prototype.slice.call(list || []); if (!files.length) return;
    var out = [], i = 0;
    toast("Reading " + files.length + " file" + (files.length === 1 ? "" : "s") + "\u2026");
    (function next() {
      if (i >= files.length) return done(out);
      var f = files[i++];
      readFile(f, function (err, entries) {
        if (err) out.push({ file: f.name, name: f.name, error: "Could not read this file: " + (err.message || String(err)) });
        else if (!entries.length) out.push({ file: f.name, name: f.name, error: "Not recognized: its headers match none of the dashboard's files (funds export, funding file, keys, spend plan, L1–L4 PR file, Stipends, MFH Duty, DTS)." });
        else entries.forEach(function (e) { out.push(e); });
        setTimeout(next, 0);
      });
    })();
    function done(entries) {
      var ok = entries.filter(function (e) { return !e.error; }), good = ok.filter(function (e) { return !e.fatal; });
      C.failed = entries.filter(function (e) { return e.error; });
      if (!good.length) {
        C.failed = entries; renderDrawer(); headerState();
        toast("Nothing could be loaded from " + (entries.length === 1 ? entries[0].name : entries.length + " files") + ".", true); return;
      }
      if (C.source !== "file") { MODS.forEach(function (m) { m.clear(); m.asOf = null; }); }
      C.source = "file"; C.loadedAt = new Date();
      MODS.forEach(function (m) {
        var mine = ok.filter(function (e) { return e.page === m.id; }); if (!mine.length) return;
        m.ingest(mine); if (mine.some(function (e) { return !e.fatal; })) m.asOf = C.loadedAt;   // "Data as of" = when this page's files were last uploaded
      });
      C.refresh();
      var pages = []; good.forEach(function (e) { if (pages.indexOf(TITLE[e.page]) < 0) pages.push(TITLE[e.page]); });
      var bad = entries.length - good.length;
      toast("Loaded " + good.length + " file" + (good.length === 1 ? "" : "s") + " \u2192 " + pages.join(", ") + (bad ? " \u00b7 " + bad + " not loaded" : ""), bad > 0);
    }
  };
  C.loadDemo = function () {
    var now = new Date();
    MODS.forEach(function (m) { m.clear(); m.asOf = null; if (m.demo) { m.demo(); m.asOf = now; } });
    C.source = "demo"; C.failed = []; C.loadedAt = null; C.savedAt = null; C.refresh();
  };
  C.clearAll = function () {
    MODS.forEach(function (m) { m.clear(); m.asOf = null; });
    C.source = "empty"; C.failed = []; C.loadedAt = null; C.savedAt = null; C.refresh();
  };
  C.hasDemo = function () { return !!(w.G1_FUNDS_DEMO && w.G1_DEMO); };

  // ---------- data details drawer ----------
  function openDrawer(on) {
    $("drawer").hidden = !on; $("scrim").hidden = !on; $("btnInfo").setAttribute("aria-expanded", String(on));
    if (on) renderDrawer();
  }
  function renderDrawer() {
    var rows = [], warns = 0;
    MODS.forEach(function (m) {
      m.entries().forEach(function (e) {
        var st = e.error || e.fatal ? "err" : e.dupOf ? "warn" : e.warns ? "warn" : "ok";
        var msg = e.error || e.fatal || (e.dupOf ? "Same content as " + e.dupOf + "; skipped" : e.status || "Loaded");
        if (st !== "ok") warns++;
        rows.push("<tr><td>" + esc(e.name) + "</td><td>" + esc(e.kindLabel || e.kind) + "</td><td>" + esc(TITLE[m.id]) + '</td><td class="num">' + (e.count == null ? "" : K.fmt(e.count)) + '</td><td class="st-' + st + '">' + esc(msg) + "</td></tr>");
      });
    });
    (C.failed || []).forEach(function (e) { warns++; rows.push("<tr><td>" + esc(e.name) + '</td><td>\u2014</td><td>\u2014</td><td></td><td class="st-err">' + esc(e.error || e.fatal || "Not loaded") + "</td></tr>"); });
    $("tFiles").tBodies[0].innerHTML = rows.length ? rows.join("") : '<tr><td colspan="5" class="muted">' + (C.source === "demo" ? "Showing the built-in demo data (fictional)." : "No files loaded yet.") + "</td></tr>";
    [["sof", "dSof", "loadReport"], ["pr", "dPr", "prReport"], ["spend", "dSpend", "spReport"], ["fh", "dFh", "fhReport"], ["esgr", "dEsgr", "esgrReport"]].forEach(function (x) {
      var m = BY[x[0]]; if (!m) return;
      var r = m.report(); $(x[2]).innerHTML = r.html || '<p class="muted">Nothing loaded.</p>';
      var s = $(x[1]).querySelector("summary"); s.innerHTML = esc(TITLE[x[0]]) + (r.warns ? '<span class="warnc">' + r.warns + " note" + (r.warns === 1 ? "" : "s") + "</span>" : "");
      warns += r.warns || 0;
    });
    $("dState").textContent = C.source === "demo" ? "Showing demo data (fictional)." : C.source === "empty" ? "No data loaded." :
      C.savedAt && !C.loadedAt ? "Showing data saved " + C.stamp(C.savedAt) + "." : "Showing your files" + (C.loadedAt ? ", last loaded " + C.stamp(C.loadedAt) : "") + ".";
    $("infoDot").hidden = !warns || C.source !== "file";
    var sv = $("btnSave"); sv.disabled = C.source !== "file"; sv.title = C.source === "file" ? "Download one HTML file with the loaded data built in" : "Load your files first";
    $("btnDemo").hidden = !C.hasDemo();
  }
  C.renderDrawer = renderDrawer;
  // "Data as of" = when that page's Excel files were last uploaded (kept inside a saved copy)
  C.asOfText = function (d) { return d ? "Data as of " + C.dateText(d) : ""; };
  C.latestAsOf = function () { var t = null; MODS.forEach(function (m) { if (m.asOf && m.hasData() && (!t || m.asOf > t)) t = m.asOf; }); return t; };
  function headerState() {
    var p = page(), m = BY[p];
    $("asOf").textContent = p === "home" ? C.asOfText(C.latestAsOf()) : "";  // pages show their own date under the title
    MODS.forEach(function (x) { var el = $("asof-" + x.id); if (el) el.textContent = x.hasData() ? C.asOfText(x.asOf) : ""; });
  }
  C.headerState = headerState;
  var tt;
  function toast(msg, warn) {
    var t = $("toast"); clearTimeout(tt);
    t.innerHTML = "<span>" + esc(msg) + "</span>" + (warn ? '<button type="button" data-open="1">Details</button>' : "");
    t.hidden = false; tt = setTimeout(function () { t.hidden = true; }, warn ? 7000 : 3500);
  }
  C.toast = toast;

  // ---------- save with data: one HTML file with the loaded data built in (no banner) ----------
  var SAVED_ID = "g1" + "Saved";
  function readSaved() {
    var el = document.getElementById(SAVED_ID); if (!el) return null;
    try { var o = JSON.parse(el.textContent); return o && o.v === 1 ? o : null; } catch (e) { return null; }
  }
  function safeJson(o) { return JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
  function pageSource(cb) {
    var cap = w.__dashSrc, scripts = [], seen = false, external = false;
    Array.prototype.forEach.call(document.scripts, function (sc) {
      if (sc.id === SAVED_ID) return;
      if (seen) { scripts.push(sc.outerHTML); if (sc.src) external = true; }
      else if (sc.textContent.indexOf("__dashSrc") >= 0) seen = true;
    });
    if (cap && seen && !external) return cb(null, "<!doctype html>\n" + cap.replace(/<\/body>\s*<\/html>\s*$/i, "") + "\n" + scripts.join("\n") + "\n</body>\n</html>\n");
    if (/^https?:$/.test(location.protocol)) {
      var url = new URL("../../downloads/g1-dashboard.html", location.href).href;
      return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }).then(function (t) { cb(null, t); }, function (e) { cb(e); });
    }
    cb(new Error("This copy loads its scripts from separate files. Open the single-file g1-dashboard.html to save with data."));
  }
  function saveWithData() {
    if (C.source !== "file") return;
    var btn = $("btnSave"), label = btn.textContent; btn.disabled = true; btn.textContent = "Saving\u2026";
    pageSource(function (err, html) {
      btn.textContent = label; btn.disabled = C.source !== "file";
      if (err) { alert("Could not build the saved file: " + (err.message || err)); return; }
      var snap = { v: 1, savedAt: new Date().toISOString() };
      MODS.forEach(function (m) { if (m.hasData()) { snap[m.id] = m.snapshot(); snap[m.id].asOf = m.asOf ? m.asOf.toISOString() : null; } });
      var tag = '<script id="' + SAVED_ID + '" type="application/json">' + safeJson(snap) + "</scr" + "ipt>\n";
      var mm, i = -1, re = /<\/body\s*>/gi; while ((mm = re.exec(html))) i = mm.index;
      if (i < 0) { alert("Could not build the saved file."); return; }
      html = html.slice(0, i) + tag + html.slice(i);
      var d = new Date(snap.savedAt), name = "G1-Dashboard-" + ("0" + d.getDate()).slice(-2) + MONS[d.getMonth()] + String(d.getFullYear()).slice(2) + ".html";
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    });
  }

  // ---------- wiring ----------
  function init() {
    chartsInit();
    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target : null; if (!t) return;
      var g = t.closest("[data-go]"); if (g) { C.go(g.getAttribute("data-go")); if (!$("drawer").hidden) openDrawer(false); return; }
      if (t.closest("[data-upload]")) { $("fileInput").click(); return; }
      if (t.closest("[data-open]")) { openDrawer(true); $("toast").hidden = true; }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("drawer").hidden) openDrawer(false);
      if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("article[data-go]")) { e.preventDefault(); C.go(e.target.getAttribute("data-go")); }
    });
    $("btnUpload").addEventListener("click", function () { $("fileInput").click(); });
    $("fileInput").addEventListener("change", function (e) { C.loadFiles(e.target.files); this.value = ""; });
    $("btnInfo").addEventListener("click", function () { openDrawer($("drawer").hidden); });
    $("btnClose").addEventListener("click", function () { openDrawer(false); });
    $("scrim").addEventListener("click", function () { openDrawer(false); });
    $("btnSave").addEventListener("click", saveWithData);
    $("btnDemo").addEventListener("click", function () { C.loadDemo(); openDrawer(false); });
    $("btnClear").addEventListener("click", function () { if (C.source === "empty" || confirm("Clear the loaded data from this page? (Your files are not changed.)")) C.clearAll(); });
    var depth = 0;
    document.addEventListener("dragenter", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) { depth++; $("dropOver").hidden = false; } });
    document.addEventListener("dragleave", function () { if (--depth <= 0) { depth = 0; $("dropOver").hidden = true; } });
    document.addEventListener("dragover", function (e) { e.preventDefault(); });
    document.addEventListener("drop", function (e) { e.preventDefault(); depth = 0; $("dropOver").hidden = true; if (e.dataTransfer && e.dataTransfer.files.length) C.loadFiles(e.dataTransfer.files); });
    w.addEventListener("hashchange", show);
    MODS.forEach(function (m) { if (m.init) m.init(); });
    var saved = readSaved();
    if (saved) {
      MODS.forEach(function (m) { var o = saved[m.id]; if (o && m.restore) { m.restore(o); m.asOf = o.asOf ? new Date(o.asOf) : new Date(saved.savedAt); } });
      C.source = "file"; C.savedAt = new Date(saved.savedAt); C.loadedAt = null;
    } else if (!C.standalone && C.hasDemo()) { var now = new Date(); MODS.forEach(function (m) { if (m.demo) { m.demo(); m.asOf = now; } }); C.source = "demo"; }
    C.refresh(); show();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else setTimeout(init, 0);
})(window);
