/* Status of Funds dashboard (GFEBS funds management export). All processing is local; nothing is uploaded. */
(function () {
  "use strict";
  var K = window.DashKit, $ = K.$, esc = K.esc;

  // [key, shown as, export header aliases (normalized: lowercase, letters and digits only), type, used for]
  var COLS = [
    ["doc", "Document Number", ["contractdocno"], "id", "Detail table, search, document count"],
    ["ci", "Commitment Item", ["commitmentitemfipex", "commitmentitem"], "text", "Chart, filter; ALLOBJ lines removed"],
    ["fa", "Functional Area", ["functionalareafarea", "functionalarea"], "text", "Chart, filter"],
    ["appn", "Appropriation", ["appropriationtype", "appropriation"], "text", "Chart, filter"],
    ["fy", "Fiscal Year", ["fiscalyear"], "fy", "Chart, filter"],
    ["obl", "Obligation", ["obligationamtcum", "obligation", "obligations"], "money", "Totals, charts"],
    ["com", "Commitments", ["commitmentamtcum", "commitments", "commitment"], "money", "Totals, charts"],
    ["sag", "Sag", ["sag"], "text", "Chart, filter"],
    ["mdep", "MDEP", ["mdep"], "text", "Chart, filter"]
  ];
  var EXPORT_NAME = { doc: "contract_doc_no", ci: "commitment_item_fipex", fa: "functional_area_farea", appn: "appropriation_type", fy: "fiscal_year", obl: "obligation_amt_cum", com: "commitment_amt_cum", sag: "sag", mdep: "mdep" };
  var DIMS = [["fy", "fFy", "cFy", "All years"], ["appn", "fAppn", "cAppn", "All"], ["sag", "fSag", "cSag", "All"], ["mdep", "fMdep", "cMdep", "All"], ["fa", "fFa", "cFa", "All"], ["ci", "fCi", "cCi", "All"]];
  var TEXT_KEYS = ["doc", "ci", "fa", "appn", "fy", "sag", "mdep"];
  var TOPN = 10, BLANK = "(blank)", PAGE = 100, MAXROWS = 5000;
  var C_OBL = "#5aa6e6", C_COM = "#e3b34c";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var S = { files: [], failed: null, fileOrder: 0, recs: [], source: "demo", allobj: 0, showAll: false, sort: { k: "obl", dir: -1 }, shown: [] };

  // ---------- header matching ----------
  function decodeX(h) { return String(h == null ? "" : h).replace(/_x([0-9a-fA-F]{4})_/g, function (m, x) { return String.fromCharCode(parseInt(x, 16)); }); }
  function norm(h) { return decodeX(h).replace(/\u00a0/g, " ").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  // Personal identifier columns are skipped by header alone; their cells are never read.
  function isPii(h) {
    var s = decodeX(h).toLowerCase();
    if (/social\s*_?security/.test(s)) return true;
    return s.split(/[^a-z0-9]+/).some(function (t) { return /^ssn|ssn$/.test(t); });
  }
  var ALIAS = {};
  COLS.forEach(function (c) { ALIAS[norm(c[1])] = c[0]; c[2].forEach(function (a) { if (!ALIAS[a]) ALIAS[a] = c[0]; }); });

  // ---------- cell parsing ----------
  function txt(v) { return v == null ? "" : String(v).replace(/\u00a0/g, " ").trim(); }
  function blankish(v) {
    if (v == null) return true;
    if (typeof v === "number") return !isFinite(v);
    var s = txt(v);
    return !s || /^#(ref!|n\/a|value!|div\/0!|name\?|null!|num!|spill!|calc!)$/i.test(s) || /^\(?\s*blank\s*\)?$/i.test(s) || /^(n\/a|null|none)$/i.test(s);
  }
  function parseAmt(v) { // number, or null for blank, or NaN for unreadable text
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (blankish(v)) return null;
    var s = txt(v).replace(/[\s$,]/g, "");
    if (/^[-\u2013\u2014]+$/.test(s)) return 0;                                   // accounting zero "-"
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/^[-\u2212]/.test(s)) { neg = !neg; s = s.slice(1); }
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }                         // SAP trailing minus "1,234.56-"
    s = s.replace(/^\$/, "");
    if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
    var n = parseFloat(s); return neg ? -n : n;
  }
  function idText(v) {
    if (blankish(v)) return "";
    if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
    return txt(v);
  }
  function fyText(v) {
    if (blankish(v)) return "";
    if (typeof v === "number") return String(Math.round(v));
    var s = txt(v); return /^\d{4}\.0+$/.test(s) ? s.split(".")[0] : s;
  }
  function isAllobj(v) { return typeof v === "string" ? txt(v).toUpperCase() === "ALLOBJ" : false; }

  // ---------- table parsing ----------
  // src: { rows: number of rows, get(r, c) -> cell value }. Only header cells and the 9 mapped columns are ever read.
  function parseSource(src) {
    var hi = 0, best = -1, maxC = src.cols;
    for (var r = 0; r < Math.min(src.rows, 20); r++) {
      var sc = 0; for (var c = 0; c < maxC; c++) { var h = src.get(r, c); if (h != null && h !== "" && ALIAS[norm(h)]) sc++; }
      if (sc > best) { best = sc; hi = r; }
    }
    var map = {}, extra = [], dupes = [], pii = 0;
    for (var ci = 0; ci < maxC; ci++) {
      var hv = src.get(hi, ci); if (hv == null || txt(hv) === "") continue;
      if (isPii(hv)) { pii++; continue; }
      var k = ALIAS[norm(hv)];
      if (!k) { extra.push(txt(decodeX(hv))); continue; }
      if (map[k] != null) { dupes.push(txt(decodeX(hv))); continue; }
      map[k] = ci;
    }
    var rep = { headerRow: hi + 1, matched: COLS.filter(function (c) { return map[c[0]] != null; }).map(function (c) { return c[1]; }),
      missing: COLS.filter(function (c) { return map[c[0]] == null; }).map(function (c) { return EXPORT_NAME[c[0]] + " (" + c[1] + ")"; }),
      extra: extra, dupes: dupes, pii: pii, rowsRead: 0, rowsLoaded: 0, blankRows: 0, allobj: 0, badNumber: 0, badNumberExamples: [], fatal: null };
    if (map.ci == null) { rep.fatal = "No Commitment Item column (commitment_item_fipex) was found, so ALLOBJ lines cannot be removed. The file was not loaded. Check that the sheet is the funds export and its header row is intact."; return { records: [], report: rep }; }
    if (map.obl == null && map.com == null) { rep.fatal = "Neither obligation_amt_cum nor commitment_amt_cum was found, so there is nothing to total. The file was not loaded."; return { records: [], report: rep }; }
    var keys = Object.keys(map), out = [];
    for (var rr = hi + 1; rr < src.rows; rr++) {
      var raw = {}, empty = true;
      keys.forEach(function (k) { var v = src.get(rr, map[k]); raw[k] = v; if (!blankish(v)) empty = false; });
      if (empty) { rep.blankRows++; continue; }
      rep.rowsRead++;
      if (isAllobj(raw.ci)) { rep.allobj++; continue; }                              // removed completely, nothing else read
      var rec = { _row: rr + 1, doc: idText(raw.doc), ci: idText(raw.ci), fa: idText(raw.fa), appn: idText(raw.appn), fy: fyText(raw.fy), sag: idText(raw.sag), mdep: idText(raw.mdep) };
      ["obl", "com"].forEach(function (k) {
        var n = k in raw ? parseAmt(raw[k]) : null;
        if (n !== null && isNaN(n)) { rep.badNumber++; if (rep.badNumberExamples.length < 5) rep.badNumberExamples.push({ row: rr + 1, column: EXPORT_NAME[k], value: txt(raw[k]) }); n = null; }
        rec[k] = n;
      });
      out.push(rec);
    }
    rep.rowsLoaded = out.length;
    return { records: out, report: rep };
  }
  function aoaSource(aoa) { var w = 0; aoa.forEach(function (r) { if (r && r.length > w) w = r.length; }); return { rows: aoa.length, cols: w, get: function (r, c) { var row = aoa[r]; return row ? row[c] : null; } }; }
  function sheetSource(ws) {
    if (!ws || !ws["!ref"]) return { rows: 0, cols: 0, get: function () { return null; } };
    var rg = XLSX.utils.decode_range(ws["!ref"]), r0 = rg.s.r, c0 = rg.s.c;
    return { rows: rg.e.r - r0 + 1, cols: rg.e.c - c0 + 1, get: function (r, c) { var cell = ws[XLSX.utils.encode_cell({ r: r + r0, c: c + c0 })]; return !cell || cell.t === "e" ? null : cell.v; } };
  }
  function headerScore(src) {
    var best = 0;
    for (var r = 0; r < Math.min(src.rows, 20); r++) { var sc = 0; for (var c = 0; c < src.cols; c++) { var h = src.get(r, c); if (h != null && h !== "" && ALIAS[norm(h)]) sc++; } best = Math.max(best, sc); }
    return best;
  }
  function readFile(file, cb) {
    var reader = new FileReader(), isCsv = /\.csv$/i.test(file.name);
    reader.onload = function (e) {
      try {
        var wb = isCsv ? XLSX.read(e.target.result, { type: "string", raw: true }) : XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: false });
        var pick = wb.SheetNames[0], bestScore = -1;
        wb.SheetNames.forEach(function (n) { var s = headerScore(sheetSource(wb.Sheets[n])); if (s > bestScore) { bestScore = s; pick = n; } });
        cb(null, { res: parseSource(sheetSource(wb.Sheets[pick])), sheetName: isCsv ? file.name : pick });
      } catch (err) { cb(err); }
    };
    reader.onerror = function () { cb(new Error("Could not read the file.")); };
    if (isCsv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  }

  // ---------- helpers ----------
  function n(v) { return v || 0; }
  function money(v) { return K.money(v); }
  function full(v) { return v == null ? "" : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dv(r, k) { return r[k] || BLANK; }
  function cmpVal(a, b) { // numeric-aware text compare
    var na = +a, nb = +b;
    if (a !== "" && b !== "" && isFinite(na) && isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
  }
  function plural(x, w) { return K.fmt(x) + " " + w + (x === 1 ? "" : "s"); }
  function today() { return new Date(); }
  function fmtStamp(d) { return ("0" + d.getDate()).slice(-2) + "-" + MON[d.getMonth()] + "-" + String(d.getFullYear()).slice(2) + " " + ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2); }
  function setDisclaimer(own) {
    var d = document.getElementById("dataDisclaimer");
    if (d) d.textContent = own ? "Showing data loaded from your files on this device. Nothing is uploaded."
      : "Data shown is fictional for demonstration. Not an official Iowa National Guard product.";
  }

  // ---------- data install ----------
  function applyData(recs, source) {
    recs.forEach(function (r, i) { r._i = i; });
    S.recs = recs; S.source = source; S.showAll = false; setDisclaimer(source === "file");
    buildFilters(true); render();
    $("btnAdd").hidden = $("btnClear").hidden = source !== "file";
    var sv = $("btnSave"); sv.disabled = source !== "file";
    sv.title = source === "file" ? "Download one offline HTML file with the " + K.fmt(recs.length) + " loaded lines built in (real data: handle per policy)" : "Load your files first";
  }
  function loadDemo() {
    var D = window.FUNDS_DEMO, p = parseSource(aoaSource([D.headers].concat(D.rows)));
    p.records.forEach(function (r) { r._src = "Demo"; });
    S.files = []; S.failed = null; S.allobj = p.report.allobj; S.demoRep = p.report;
    applyData(p.records, "demo"); renderReport();
  }

  // ---------- multi-file loading ----------
  function readFiles(list, cb) {
    var files = Array.prototype.slice.call(list), out = [], i = 0;
    (function next() {
      if (i >= files.length) return cb(out);
      var f = files[i++];
      setBar("busy", "Reading " + i + " of " + files.length + ": " + f.name + "\u2026", 0);
      readFile(f, function (err, res) {
        var e = { name: f.name, lastModified: f.lastModified || 0, order: S.fileOrder++ };
        if (err) e.error = err.message || String(err);
        else { e.sheetName = res.sheetName; e.rep = res.res.report; e.records = res.res.records; e.records.forEach(function (r) { r._src = f.name; }); }
        out.push(e); setTimeout(next, 0);
      });
    })();
  }
  function usable(e) { return !e.error && !e.rep.fatal && !e.dupOf && e.records.length > 0; }
  function sig(e) { // identical content = same export loaded twice
    var h = 0, s = e.records.map(function (r) { return [r.doc, r.ci, r.fa, r.appn, r.fy, r.obl, r.com, r.sag, r.mdep].join("|"); }).join("\n");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return e.records.length + ":" + h;
  }
  function loadFiles(list, append) {
    if (!list || !list.length) return;
    readFiles(list, function (entries) {
      var keepPrev = append && S.source === "file", all = (keepPrev ? S.files : []).concat(entries);
      if (!all.some(usable)) { S.failed = entries; renderReport(); setExpanded(true, false); return; }
      S.failed = null; S.files = all; combine(); renderReport(); setExpanded(false);
    });
  }
  function combine() {
    var seen = {};
    S.files.forEach(function (e) { e.dupOf = null; if (e.error || e.rep.fatal || !e.records.length) return; var s = sig(e); if (seen[s]) e.dupOf = seen[s]; else seen[s] = e.name; });
    var recs = [], ok = S.files.filter(usable);
    ok.forEach(function (e) { for (var i = 0; i < e.records.length; i++) recs.push(e.records[i]); });
    S.allobj = ok.reduce(function (t, e) { return t + e.rep.allobj; }, 0);
    applyData(recs, "file");
  }
  function clearFiles() { S.files = []; S.failed = null; $("fileInput").value = ""; $("addInput").value = ""; if (!(SAVED && loadSaved()) && !(PA && loadPA())) loadDemo(); setExpanded(false); }
  function showDemo() { S.files = []; S.failed = null; $("fileInput").value = ""; $("addInput").value = ""; loadDemo(); setExpanded(false); }

  // ---------- save with data (one HTML file with the loaded lines embedded; only the 9 columns, never ALLOBJ) ----------
  var SAVED_ID = "finance" + "Saved", SAVED = null;
  function readSaved() {
    var el = document.getElementById(SAVED_ID); if (!el) return null;
    try { var o = JSON.parse(el.textContent); return o && o.v === 1 && o.rows ? o : null; } catch (e) { return null; }
  }
  function srcNames() { var out = []; S.files.filter(usable).forEach(function (e) { (e.srcNames || [e.name]).forEach(function (nm) { if (out.indexOf(nm) < 0) out.push(nm); }); }); return out; }
  function loadSaved() {
    var D = SAVED, p = parseSource(aoaSource([D.headers].concat(D.rows)));
    p.records.forEach(function (r, i) { r._src = D.src[i] || ""; });
    p.report.allobj = D.allobjRemoved || 0;
    S.files = [{ name: "Saved data (" + plural(D.files.length, "source file") + ")", srcNames: D.files, rep: p.report, records: p.records, embedded: true, order: S.fileOrder++ }];
    S.failed = null; S.allobj = D.allobjRemoved || 0;
    applyData(p.records, "file"); renderReport();
    return true;
  }
  function showBanner() {
    var sa = new Date(SAVED.savedAt);
    $("realBanner").hidden = false;
    $("realBannerMeta").textContent = "Data as of " + fmtStamp(sa) + " \u00b7 " + K.fmt(SAVED.rows.length) + " lines from " + plural(SAVED.files.length, "source file") + ": " + SAVED.files.join(", ");
    $("realBannerMeta").title = SAVED.files.join("\n");
  }
  function safeJson(o) { return JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
  function snapshot() {
    var now = new Date();
    return { v: 1, savedAt: now.toISOString(), files: srcNames(), allobjRemoved: S.allobj,
      headers: COLS.map(function (c) { return c[1]; }),
      rows: S.recs.map(function (r) { return COLS.map(function (c) { var v = r[c[0]]; return v == null ? "" : c[3] === "money" ? v : String(v); }); }),
      src: S.recs.map(function (r) { return r._src || ""; }) };
  }
  function pageSource(cb) {
    var cap = window.__dashSrc, scripts = [], seen = false, external = false;
    Array.prototype.forEach.call(document.scripts, function (sc) {
      if (sc.id === SAVED_ID) return;
      if (seen) { scripts.push(sc.outerHTML); if (sc.src) external = true; }
      else if (sc.textContent.indexOf("__dashSrc") >= 0) seen = true;
    });
    if (cap && seen && !external) return cb(null, "<!doctype html>\n" + cap.replace(/<\/body>\s*<\/html>\s*$/i, "") + "\n" + scripts.join("\n") + "\n</body>\n</html>\n");
    if (/^https?:$/.test(location.protocol)) {
      var url = new URL("../../downloads/finance-dashboard.html", location.href).href;
      return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then(function (t) { cb(null, t); }, function (e) { cb(e); });
    }
    cb(new Error("This copy loads its scripts from separate files. Open the single-file finance-dashboard.html to save with data."));
  }
  function saveWithData() {
    if (S.source !== "file") return;
    var btn = $("btnSave"), label = btn.innerHTML; btn.disabled = true; btn.textContent = "Saving\u2026";
    pageSource(function (err, html) {
      btn.innerHTML = label; btn.disabled = S.source !== "file";
      if (err) { alert("Could not build the saved file: " + (err.message || err)); return; }
      // a Power Automate copy: drop its refresh-time tag (its data block is never part of the captured source)
      var mt = '<meta name="pa-' + 'refreshed"', mi = html.indexOf(mt), he = html.search(/<\/head\s*>/i);
      if (mi >= 0 && mi < he) html = html.slice(0, mi) + html.slice(html.indexOf(">", mi) + 1).replace(/^\n/, "");
      var snap = snapshot(), tag = "<script id=\"" + SAVED_ID + "\" type=\"application/json\">" + safeJson(snap) + "</scr" + "ipt>\n";
      var m, i = -1, re = /<\/body\s*>/gi; while ((m = re.exec(html))) i = m.index;
      if (i < 0) { alert("Could not build the saved file."); return; }
      html = html.slice(0, i) + tag + html.slice(i);
      var d = new Date(snap.savedAt), name = "FUNDS-REAL-DATA-" + ("0" + d.getDate()).slice(-2) + MON[d.getMonth()] + String(d.getFullYear()).slice(2) + ".html";
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    });
  }

  // ---------- automatic refresh (Power Automate template) ----------
  // The template ends with a raw-text element holding a placeholder. A scheduled flow replaces it with the rows from
  // Excel Online "List rows present in a table": [{file, rows:[{header: value}]}], {value:[...]}, or a flat row array.
  var PA_ID = "embedded" + "-data", PA_TOKEN = "__PA_" + "DATA__", PA_TS_TOKEN = "__PA_" + "REFRESHED__", PA = null;
  var PA_SKIP = /^(@odata\.|itemInternalId$)/i;
  function jsonEnd(s, a) {
    var depth = 0, inStr = false, bs = false;
    for (var i = a; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (inStr) { if (bs) bs = false; else if (c === 92) bs = true; else if (c === 34) inStr = false; continue; }
      if (c === 34) inStr = true;
      else if (c === 91 || c === 123) depth++;
      else if (c === 93 || c === 125) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }
  function readPA() {
    var el = document.getElementById(PA_ID); if (!el) return null;
    var s = String(el.textContent || "").trim();
    if (!s || s.slice(0, PA_TOKEN.length) === PA_TOKEN) return null;
    var meta = document.querySelector('meta[name="pa-refreshed"]'), ts = meta ? String(meta.getAttribute("content") || "").trim() : "";
    var out = { refreshed: ts && ts !== PA_TS_TOKEN ? ts : "", sources: [], error: null };
    try {
      var a = s.search(/[\[{]/); if (a < 0) throw new Error("no JSON found");
      var b = jsonEnd(s, a); if (b < 0) b = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
      if (b < a) throw new Error("no JSON found");
      var o = JSON.parse(s.slice(a, b + 1));
      if (typeof o === "string") o = JSON.parse(o);
      out.sources = paSources(o);
      if (!out.sources.length) throw new Error("no rows found");
    } catch (e) { out.error = (e && e.message) || String(e); }
    return out;
  }
  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
  function paSources(o) {
    if (isObj(o)) o = Array.isArray(o.files) ? o.files : Array.isArray(o.value) && !Array.isArray(o.rows) ? [{ rows: o.value }] : [o];
    if (!Array.isArray(o)) return [];
    var srcs = [], flat = [];
    o.forEach(function (x) {
      if (!isObj(x)) return;
      var rows = Array.isArray(x.rows) ? x.rows : Array.isArray(x.value) ? x.value : null;
      if (rows) srcs.push({ file: x.file || x.name || x.FileName || "", modified: x.modified || x.Modified || "", rows: rows });
      else flat.push(x);
    });
    if (flat.length) srcs.push({ file: "Automatic refresh", modified: "", rows: flat });
    srcs.forEach(function (x, i) { x.file = String(x.file || "Source " + (i + 1)); });
    return srcs;
  }
  function rowsSource(rows) { // row objects -> parse source; personal identifier keys are dropped, never read
    var hs = [], seen = Object.create(null);
    rows = rows.filter(isObj);
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (PA_SKIP.test(k) || isPii(k) || seen[k]) return; seen[k] = 1; hs.push(k); }); });
    return { rows: rows.length + 1, cols: hs.length, get: function (r, c) { if (r === 0) return hs[c]; var v = rows[r - 1][hs[c]]; return v == null ? "" : isObj(v) || Array.isArray(v) ? JSON.stringify(v) : v; } };
  }
  function loadPA() {
    if (!PA || PA.error) return false;
    var entries = PA.sources.map(function (src) {
      var p = parseSource(rowsSource(src.rows));
      p.records.forEach(function (r) { r._src = src.file; });
      return { name: src.file, sheetName: src.file, lastModified: Date.parse(src.modified) || 0, order: S.fileOrder++, rep: p.report, records: p.records, automatic: true };
    });
    if (!entries.some(usable)) { S.files = []; S.failed = entries; PA.error = "none of the " + entries.length + " source table(s) had readable rows"; return false; }
    S.failed = null; S.files = entries; combine(); renderReport();
    return true;
  }
  function showPABanner() {
    var names = PA.sources.map(function (x) { return x.file; });
    $("realBanner").hidden = false;
    if (PA.error) {
      $("realBanner").classList.add("pa-error");
      $("realBannerMeta").textContent = "Automatic refresh data could not be read (" + PA.error + "). The charts below show FICTIONAL demo data. Check the flow's run history.";
      setBar("err", "Automatic refresh data could not be read \u00b7 showing fictional demo data", 1);
      return;
    }
    $("realBannerMeta").textContent = "Data refreshed " + (PA.refreshed || "(time not recorded)") + " (automatic) \u00b7 " + K.fmt(S.recs.length) + " lines from " + plural(names.length, "source file") + ": " + names.join(", ");
    $("realBannerMeta").title = names.join("\n");
  }

  // ---------- load report ----------
  function codes(list) { return list.map(function (m) { return "<code>" + esc(m) + "</code>"; }).join(", "); }
  function fileLines(e) {
    var h = [], warns = 0, rep = e.rep;
    if (e.error) return { html: '<p class="err">Could not read this file: ' + esc(e.error) + "</p>", warns: 1 };
    if (rep.fatal) return { html: '<p class="err">' + esc(rep.fatal) + "</p>" + (rep.missing.length ? '<p class="muted">Missing: ' + codes(rep.missing) + "</p>" : ""), warns: 1 };
    if (e.dupOf) return { html: '<p class="warn">Same content as ' + esc(e.dupOf) + "; skipped so its amounts are not counted twice.</p>", warns: 1 };
    var ok = rep.matched.length === COLS.length;
    h.push('<p class="' + (rep.rowsLoaded ? "ok" : "err") + '">Loaded ' + plural(rep.rowsLoaded, "line") + " of " + K.fmt(rep.rowsRead) + " read" + (e.sheetName && e.sheetName !== e.name ? " from sheet &ldquo;" + esc(e.sheetName) + "&rdquo; (header row " + rep.headerRow + ")" : "") + "." + (rep.blankRows ? ' <span class="muted">' + K.fmt(rep.blankRows) + " blank row(s) ignored.</span>" : "") + "</p>");
    h.push('<p class="ok"><strong>' + plural(rep.allobj, "ALLOBJ line") + " removed</strong> (not counted anywhere).</p>");
    h.push('<p class="' + (ok ? "ok" : "warn") + '">' + rep.matched.length + " of " + COLS.length + " columns matched." + "</p>");
    if (!ok) { warns++; h.push('<p class="warn">Missing: ' + codes(rep.missing) + "</p>"); }
    if (rep.pii) h.push('<p class="muted">' + plural(rep.pii, "personal identifier column") + " skipped without reading.</p>");
    if (rep.extra.length) h.push('<details class="muted"><summary>' + plural(rep.extra.length, "other column") + " ignored</summary><p class=\"muted\">" + codes(rep.extra) + "</p></details>");
    if (rep.dupes.length) h.push('<p class="muted">Repeated columns ignored (first one used): ' + codes(rep.dupes) + "</p>");
    if (rep.badNumber) {
      warns++;
      h.push('<p class="warn">' + rep.badNumber + " amount cell(s) could not be read and were treated as blank. Examples: " + rep.badNumberExamples.map(function (x) { return "row " + x.row + " <code>" + esc(x.column) + "</code> = &ldquo;" + esc(x.value) + "&rdquo;"; }).join("; ") + ".</p>");
    }
    return { html: h.join(""), warns: warns };
  }
  function renderReport() {
    var el = $("loadReport"), h = [], warns = 0;
    if (S.failed) {
      S.failed.forEach(function (e) { h.push('<div class="filerep"><h4>' + esc(e.name) + "</h4>" + fileLines(e).html + "</div>"); });
      h.push('<p class="muted">Nothing was loaded; the dashboard still shows the previous data.</p>');
      el.innerHTML = h.join("");
      setBar("err", "Could not load " + (S.failed.length === 1 ? S.failed[0].name : S.failed.length + " files") + " \u00b7 still showing the previous data", 1);
      return;
    }
    if (S.source === "demo") {
      el.innerHTML = '<p class="muted">Showing the built-in fictional demo data (' + plural(S.recs.length, "line") + " in the funds export layout; " + plural(S.allobj, "ALLOBJ line") + " removed). Choose one or more exports, or drop them here.</p>";
      setBar("ok", "Demo data (fictional) \u00b7 " + plural(S.recs.length, "line") + " \u00b7 " + plural(S.allobj, "ALLOBJ line") + " removed", 0);
      return;
    }
    S.files.forEach(function (e) {
      var fl = fileLines(e); warns += fl.warns;
      var head = esc(e.name) + (usable(e) ? " \u00b7 " + plural(e.rep.rowsLoaded, "line") + " \u00b7 " + e.rep.matched.length + "/" + COLS.length + " columns" : " \u00b7 not loaded") + (fl.warns ? ' \u00b7 <span class="warn">' + fl.warns + " warning" + (fl.warns === 1 ? "" : "s") + "</span>" : "");
      h.push('<details class="filerep"' + (fl.warns || S.files.length === 1 ? " open" : "") + "><summary>" + head + "</summary>" + fl.html + "</details>");
    });
    var nf = S.files.filter(usable).length;
    h.push('<div class="combined"><p class="ok"><strong>Combined: ' + plural(S.recs.length, "line") + " from " + plural(nf, "file") + "</strong> \u00b7 " + plural(S.allobj, "ALLOBJ line") + " removed.</p></div>");
    el.innerHTML = h.join("");
    var line = (nf === 1 ? S.files.filter(usable)[0].name : nf + " files") + " \u00b7 " + plural(S.recs.length, "line") + " \u00b7 " + plural(S.allobj, "ALLOBJ line") + " removed";
    setBar(warns ? "warn" : "ok", line, warns);
  }
  function setBar(state, textLine, warns) {
    var bar = $("loadBar");
    bar.className = "loadbar no-print chrome" + (state === "ok" ? "" : " " + state);
    $("lbIcon").innerHTML = state === "ok" ? "&#10003;" : state === "warn" ? "&#9888;" : state === "busy" ? "&#8987;" : "&#10005;";
    $("lbText").textContent = textLine;
    var bd = $("lbBadge"); bd.hidden = !warns || state === "err"; bd.textContent = warns + " warning" + (warns === 1 ? "" : "s");
  }
  var LS_KEY = "financeDash.loadPanelExpanded";
  function lsGet() { try { return localStorage.getItem(LS_KEY) === "1"; } catch (e) { return false; } }
  function setExpanded(open, persist) {
    $("loadPanel").hidden = !open;
    $("btnDetails").textContent = open ? "Hide details" : "Show details";
    $("btnDetails").setAttribute("aria-expanded", String(open));
    if (persist !== false) { try { localStorage.setItem(LS_KEY, open ? "1" : "0"); } catch (e) { /* storage unavailable */ } }
  }
  function setPresent(on) {
    document.body.classList.toggle("present", on);
    $("btnPresent").setAttribute("aria-pressed", String(on));
    $("btnPresent").textContent = on ? "Exit presentation" : "Presentation mode";
    setTimeout(function () { Object.keys(K.charts).forEach(function (k) { K.charts[k].resize(); }); }, 50);
  }

  // ---------- filters ----------
  function buildFilters(reset) {
    DIMS.forEach(function (d) {
      var vals = K.uniq(S.recs.map(function (r) { return dv(r, d[0]); })).sort(function (a, b) { return a === BLANK ? 1 : b === BLANK ? -1 : cmpVal(a, b); });
      K.fillSelect($(d[1]), vals, d[3], !reset);
    });
  }
  function F() { var f = {}; DIMS.forEach(function (d) { f[d[0]] = $(d[1]).value; }); return f; }
  function pass(r, f) { for (var k in f) if (f[k] && dv(r, k) !== f[k]) return false; return true; }
  function currentRows() { var f = F(); return S.recs.filter(function (r) { return pass(r, f); }); }

  // ---------- render ----------
  function render() {
    var f = F(), rows = currentRows();
    var scope = DIMS.filter(function (d) { return f[d[0]]; }).map(function (d) { var c = COLS.filter(function (x) { return x[0] === d[0]; })[0]; return c[1] + " " + f[d[0]]; });
    $("asofLabel").textContent = plural(rows.length, "line") + " \u00b7 " + plural(docCount(rows), "document");
    $("scopeLabel").textContent = scope.length ? scope.join(" \u00b7 ") : "All funds";
    $("sourceLabel").textContent = S.source === "file" ? " \u00b7 " + (SAVED && S.files[0] && S.files[0].embedded ? "Saved data" : PA && S.files[0] && S.files[0].automatic ? "Automatic refresh" : "Your " + (S.files.filter(usable).length === 1 ? "file: " + S.files.filter(usable)[0].name : S.files.filter(usable).length + " files")) : " \u00b7 Demo data";
    kpis(rows); summary(rows, f);
    DIMS.forEach(function (d) { chart(d, rows); });
    S.base = rows; table();
  }
  function docCount(rows) { var s = Object.create(null), c = 0; rows.forEach(function (r) { if (r.doc && !s[r.doc]) { s[r.doc] = 1; c++; } }); return c; }
  function kpi(lbl, val, sub, cls, title) { return '<div class="kpi' + (cls ? " " + cls : "") + '"' + (title ? ' title="' + esc(title) + '"' : "") + '><div class="lbl">' + lbl + '</div><div class="val">' + val + '</div><div class="sub">' + (sub || "&nbsp;") + "</div></div>"; }
  function kpis(rows) {
    var o = K.sum(rows, function (r) { return n(r.obl); }), c = K.sum(rows, function (r) { return n(r.com); }), nd = docCount(rows);
    $("kpis").innerHTML = [
      kpi("Total Obligation", money(o), full(o), "obl", full(o)),
      kpi("Total Commitments", money(c), full(c), "com", full(c)),
      kpi("Lines", K.fmt(rows.length), plural(S.allobj, "ALLOBJ line") + " removed from the data", "", "ALLOBJ lines are removed when the file is read and never counted"),
      kpi("Documents", K.fmt(nd), nd ? "avg " + money(o / nd) + " obligation per document" : "", "", "Distinct Document Numbers")
    ].join("");
  }
  function group(rows, k) {
    var m = Object.create(null);
    rows.forEach(function (r) { var key = dv(r, k), g = m[key] || (m[key] = { label: key, obl: 0, com: 0, lines: 0 }); g.obl += n(r.obl); g.com += n(r.com); g.lines++; });
    return Object.keys(m).map(function (x) { return m[x]; });
  }
  function ranked(rows, k) { return group(rows, k).sort(function (a, b) { return Math.max(Math.abs(b.obl), Math.abs(b.com)) - Math.max(Math.abs(a.obl), Math.abs(a.com)) || cmpVal(a.label, b.label); }); }
  function summary(rows, f) {
    if (!rows.length) { $("summary").textContent = "No lines match the current filters."; return; }
    var o = K.sum(rows, function (r) { return n(r.obl); }), c = K.sum(rows, function (r) { return n(r.com); }), s = [];
    s.push(plural(rows.length, "line") + " across " + plural(docCount(rows), "document") + ": Obligation " + full(o) + " and Commitments " + full(c) + ".");
    [["appn", "appropriation"], ["sag", "Sag"], ["mdep", "MDEP"], ["ci", "commitment item"]].forEach(function (d) {
      if (f[d[0]]) return;
      var g = ranked(rows, d[0]).sort(function (a, b) { return b.obl - a.obl; });
      if (g.length > 1 && g[0].obl > 0) s.push("Largest " + d[1] + " by obligation: " + g[0].label + " (" + money(g[0].obl) + ", " + Math.round(g[0].obl / (o || 1) * 100) + "%).");
    });
    if (!f.fy) { var fy = group(rows, "fy").sort(function (a, b) { return cmpVal(a.label, b.label); }); if (fy.length > 1) s.push("By fiscal year: " + fy.map(function (g) { return g.label + " " + money(g.obl); }).join(", ") + " obligated."); }
    var neg = rows.filter(function (r) { return n(r.obl) < 0; }).length;
    if (neg) s.push(plural(neg, "line") + " show a negative obligation (de-obligation).");
    s.push(plural(S.allobj, "ALLOBJ line") + (S.allobj === 1 ? " was" : " were") + " removed and " + (S.allobj === 1 ? "is" : "are") + " not included.");
    $("summary").textContent = s.join(" ");
  }
  function chart(d, rows) {
    var k = d[0], horiz = k !== "fy" && k !== "appn", g;
    if (k === "fy") g = group(rows, k).sort(function (a, b) { return a.label === BLANK ? 1 : b.label === BLANK ? -1 : cmpVal(a.label, b.label); });
    else {
      g = ranked(rows, k);
      if (g.length > TOPN + 1) {
        var rest = g.slice(TOPN), oth = { label: "Other (" + rest.length + ")", obl: 0, com: 0, other: true };
        rest.forEach(function (x) { oth.obl += x.obl; oth.com += x.com; });
        g = g.slice(0, TOPN).concat([oth]);
      }
    }
    var o = K.chartBase(), ax = horiz ? "x" : "y";
    if (horiz) o.indexAxis = "y";
    o.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + full(c.raw); } };
    o.scales[ax].ticks = { callback: function (v) { return money(v); } };
    o.onClick = function (e, els) { if (!els.length) return; var x = g[els[0].index]; if (!x || x.other) return; $(d[1]).value = x.label; render(); };
    o.onHover = function (e, els) { e.native.target.style.cursor = els.length && g[els[0].index] && !g[els[0].index].other ? "pointer" : "default"; };
    K.upsert(d[2], { type: "bar", data: { labels: g.map(function (x) { return x.label; }), datasets: [
      { label: "Obligation", data: g.map(function (x) { return x.obl; }), backgroundColor: C_OBL },
      { label: "Commitments", data: g.map(function (x) { return x.com; }), backgroundColor: C_COM }] }, options: o });
  }

  // ---------- detail table ----------
  function match(r, q) { return TEXT_KEYS.some(function (k) { return r[k] && String(r[k]).toLowerCase().indexOf(q) >= 0; }); }
  function sorted(rows) {
    var k = S.sort.k, dir = S.sort.dir, isM = COLS.filter(function (c) { return c[0] === k; })[0][3] === "money";
    return rows.slice().sort(function (a, b) {
      var x = isM ? n(a[k]) - n(b[k]) : cmpVal(a[k] || "", b[k] || "");
      return x * dir || cmpVal(a.doc, b.doc);
    });
  }
  function table() {
    var q = ($("fSearch").value || "").trim().toLowerCase(), rows = S.base || [];
    if (q) rows = rows.filter(function (r) { return match(r, q); });
    rows = sorted(rows); S.shown = rows;
    $("searchNote").textContent = q ? K.fmt(rows.length) + " of " + K.fmt(S.base.length) + " lines match \u201c" + $("fSearch").value.trim() + "\u201d" : "";
    $("tDocs").tHead.innerHTML = "<tr>" + COLS.map(function (c) { var on = S.sort.k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[3] === "money" ? "num" : "") + (on ? " sorted" + (S.sort.dir > 0 ? " asc" : "") : "") + '" aria-sort="' + (on ? (S.sort.dir > 0 ? "ascending" : "descending") : "none") + '">' + esc(c[1]) + "</th>"; }).join("") + "</tr>";
    var lim = S.showAll ? MAXROWS : PAGE, show = rows.slice(0, lim);
    $("tDocs").tBodies[0].innerHTML = show.length ? show.map(function (r) {
      return "<tr>" + COLS.map(function (c) { var v = r[c[0]]; if (c[3] === "money") return '<td class="num' + (v < 0 ? " neg" : "") + '">' + (v == null ? '<span class="muted">\u2014</span>' : full(v)) + "</td>"; return "<td>" + (v ? esc(v) : '<span class="muted">\u2014</span>') + "</td>"; }).join("") + "</tr>";
    }).join("") : '<tr><td colspan="' + COLS.length + '" class="muted">' + (q ? "No lines match the search in the current selection." : "No lines match the current filters.") + "</td></tr>";
    var to = K.sum(rows, function (r) { return n(r.obl); }), tc = K.sum(rows, function (r) { return n(r.com); });
    $("tDocs").tFoot.innerHTML = rows.length ? "<tr>" + COLS.map(function (c, i) { return c[0] === "obl" ? '<td class="num">' + full(to) + "</td>" : c[0] === "com" ? '<td class="num">' + full(tc) + "</td>" : i === 0 ? "<td>Total (" + plural(rows.length, "line") + (rows.length > show.length ? ", " + K.fmt(show.length) + " shown" : "") + ")</td>" : "<td></td>"; }).join("") + "</tr>" : "";
    var btn = $("btnAll");
    btn.style.display = rows.length > PAGE ? "" : "none";
    btn.textContent = S.showAll ? "Show " + PAGE : rows.length > MAXROWS ? "Show first " + K.fmt(MAXROWS) : "Show all " + K.fmt(rows.length);
  }
  function exportCsv() {
    var d = new Date(), stamp = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    K.downloadCsv("status_of_funds_" + stamp + ".csv", COLS.map(function (c) { return c[1]; }),
      (S.shown || []).map(function (r) { return COLS.map(function (c) { var v = r[c[0]]; return v == null ? "" : c[3] === "money" ? v.toFixed(2) : v; }); }));
  }

  // ---------- wiring ----------
  function init() {
    K.initCharts();
    $("dictBody").innerHTML = COLS.map(function (c, i) { return "<tr><td>" + (i + 1) + "</td><td><code>" + esc(EXPORT_NAME[c[0]]) + "</code></td><td>" + esc(c[1]) + "</td><td>" + esc(c[4]) + "</td></tr>"; }).join("");
    $("btnLoad").addEventListener("click", function () { $("fileInput").click(); });
    $("btnDetails").addEventListener("click", function () { setExpanded($("loadPanel").hidden); });
    $("btnPresent").addEventListener("click", function () { setPresent(!document.body.classList.contains("present")); });
    setExpanded(lsGet(), false);
    $("btnPrint").addEventListener("click", function () { window.print(); });
    $("btnDemo").addEventListener("click", showDemo);
    $("btnSave").addEventListener("click", saveWithData);
    $("fileInput").addEventListener("change", function (e) { loadFiles(e.target.files, false); });
    $("addInput").addEventListener("change", function (e) { loadFiles(e.target.files, true); this.value = ""; });
    $("btnAdd").addEventListener("click", function () { $("addInput").click(); });
    $("btnClear").addEventListener("click", clearFiles);
    ["dragover", "drop"].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }); });
    ["loadBar", "loadPanel"].forEach(function (id) {
      var el = $(id);
      el.addEventListener("dragover", function (e) { e.preventDefault(); el.classList.add("dragging"); });
      el.addEventListener("dragleave", function () { el.classList.remove("dragging"); });
      el.addEventListener("drop", function (e) { e.preventDefault(); el.classList.remove("dragging"); if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files, e.shiftKey); });
    });
    DIMS.forEach(function (d) { $(d[1]).addEventListener("change", function () { S.showAll = false; render(); }); });
    $("btnReset").addEventListener("click", function () { DIMS.forEach(function (d) { $(d[1]).value = ""; }); $("fSearch").value = ""; S.showAll = false; render(); });
    $("btnCsv").addEventListener("click", exportCsv);
    var st; $("fSearch").addEventListener("input", function () { clearTimeout(st); st = setTimeout(table, 120); });
    $("fSearch").addEventListener("keydown", function (e) { if (e.key === "Escape" && this.value) { e.stopPropagation(); this.value = ""; table(); } });
    $("btnAll").addEventListener("click", function () { S.showAll = !S.showAll; table(); });
    $("tDocs").tHead.addEventListener("click", function (e) {
      var th = e.target.closest("th[data-k]"); if (!th) return; var k = th.getAttribute("data-k");
      var isMoney = COLS.filter(function (c) { return c[0] === k; })[0][3] === "money";
      S.sort = S.sort.k === k ? { k: k, dir: -S.sort.dir } : { k: k, dir: isMoney ? -1 : 1 }; table();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("present")) setPresent(false); });
    SAVED = readSaved(); PA = SAVED ? null : readPA();
    if (SAVED) { showBanner(); document.title = "REAL DATA \u00b7 " + document.title; loadSaved(); }
    else if (PA) { document.title = "REAL DATA \u00b7 " + document.title; if (!loadPA()) loadDemo(); showPABanner(); }
    else loadDemo();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
