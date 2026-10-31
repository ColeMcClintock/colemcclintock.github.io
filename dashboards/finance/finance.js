/* Status of Funds dashboard (core). Reads the GFEBS funds management export locally; nothing is uploaded.
   Funding (TDP, AFP, Reservations) comes from a separate funding file: see funding.js (loaded first). */
(function () {
  "use strict";
  var K = window.DashKit, L = window.FundsLib, $ = K.$, esc = K.esc;
  var n = L.n, full = L.full, plural = L.plural, cmpVal = L.cmpVal, idText = L.idText, BLANK = L.BLANK, PAGE = L.PAGE, MAXROWS = L.MAXROWS;

  // Export columns: [key, shown as, header aliases (normalized: lowercase letters and digits only), type, used for]
  var COLS = [
    ["doc", "Document Number", ["contractdocno"], "id", "Line table, search, document count"],
    ["ci", "Commitment Item", ["commitmentitemfipex", "commitmentitem"], "text", "Chart, filter; ALLOBJ lines removed"],
    ["fa", "Functional Area", ["functionalareafarea", "functionalarea"], "text", "Chart, filter, funding match"],
    ["appn", "Appropriation", ["appropriationtype", "appropriation"], "text", "Chart, filter"],
    ["fy", "Fiscal Year", ["fiscalyear"], "fy", "Chart, filter, funding match"],
    ["obl", "Obligation", ["obligationamtcum", "obligation", "obligations"], "money", "KPI, charts, Balance"],
    ["com", "Commitments", ["commitmentamtcum", "commitments"], "money", "Line table and CSV only"],
    ["disb", "Disbursement", ["disbursementamtcum", "disbursement", "disbursements"], "money", "KPI, charts, Balance"],
    ["sag", "Sag", ["sag"], "text", "Chart, filter, funding match"],
    ["mdep", "MDEP", ["mdep"], "text", "Chart, filter, funding match"]
  ];
  var EXPORT_NAME = { doc: "contract_doc_no", ci: "commitment_item_fipex", fa: "functional_area_farea", appn: "appropriation_type", fy: "fiscal_year", obl: "obligation_amt_cum", com: "commitment_amt_cum", disb: "disbursement_amt_cum", sag: "sag", mdep: "mdep" };
  var LABEL = {}; COLS.forEach(function (c) { LABEL[c[0]] = c[1]; });
  var ALIAS = L.aliasMap(COLS);
  var DIMS = [["fy", "fFy", "cFy", "All years"], ["appn", "fAppn", "cAppn", "All"], ["sag", "fSag", "cSag", "All"], ["mdep", "fMdep", "cMdep", "All"], ["fa", "fFa", "cFa", "All"], ["ci", "fCi", "cCi", "All"]];
  var DIM_KEYS = DIMS.map(function (d) { return d[0]; });
  var TEXT_KEYS = ["doc", "ci", "fa", "appn", "fy", "sag", "mdep"];
  var TOPN = 10, C_TDP = "#c9a27e", C_OBL = "#5aa6e6", C_DISB = "#a9c16a", C_RES = "#e3b34c", C_BAL = "#5fbf7f";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var S = { files: [], failed: null, fileOrder: 0, recs: [], fund: null, source: "demo", allobj: 0, showAll: false, sort: { k: "obl", dir: -1 }, shown: [] };

  // ---------- export parsing (only header cells and the mapped columns are ever read) ----------
  function parseExport(src) {
    var hm = L.mapHeaders(src, ALIAS), map = hm.map;
    var rep = { kind: "export", headerRow: hm.hi + 1, matched: COLS.filter(function (c) { return map[c[0]] != null; }).map(function (c) { return c[1]; }),
      missing: COLS.filter(function (c) { return map[c[0]] == null; }).map(function (c) { return EXPORT_NAME[c[0]] + " (" + c[1] + ")"; }),
      extra: hm.extra, dupes: hm.dupes, pii: hm.pii, rowsRead: 0, rowsLoaded: 0, blankRows: 0, allobj: 0, badNumber: 0, badNumberExamples: [], fatal: null };
    if (map.ci == null) { rep.fatal = "No Commitment Item column (commitment_item_fipex) was found, so ALLOBJ lines cannot be removed. The file was not loaded."; return { records: [], report: rep }; }
    if (map.obl == null && map.disb == null && map.com == null) { rep.fatal = "No obligation_amt_cum or disbursement_amt_cum column was found, so there is nothing to total. The file was not loaded."; return { records: [], report: rep }; }
    var keys = Object.keys(map), out = [];
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var raw = {}, empty = true;
      keys.forEach(function (k) { var v = src.get(rr, map[k]); raw[k] = v; if (!L.blankish(v)) empty = false; });
      if (empty) { rep.blankRows++; continue; }
      rep.rowsRead++;
      if (L.isAllobj(raw.ci)) { rep.allobj++; continue; }                            // removed completely
      var rec = { _row: rr + 1, doc: idText(raw.doc), ci: idText(raw.ci), fa: idText(raw.fa), appn: idText(raw.appn), fy: L.fyText(raw.fy), sag: idText(raw.sag), mdep: idText(raw.mdep) };
      ["obl", "com", "disb"].forEach(function (k) {
        var x = k in raw ? L.parseAmt(raw[k]) : null;
        if (x !== null && isNaN(x)) { L.badNum(rep, rr + 1, EXPORT_NAME[k], raw[k]); x = null; }
        rec[k] = x;
      });
      out.push(rec);
    }
    rep.rowsLoaded = out.length;
    return { records: out, report: rep };
  }
  function parseAs(kind, src) { return kind === "funding" ? L.parseFunding(src) : parseExport(src); }
  function readFile(file, force, cb) {
    var reader = new FileReader(), isCsv = /\.csv$/i.test(file.name);
    reader.onload = function (e) {
      try {
        var wb = isCsv ? XLSX.read(e.target.result, { type: "string", raw: true }) : XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: false });
        var best = {};                                                                    // best sheet per kind
        wb.SheetNames.forEach(function (nm) {
          var src = L.sheetSource(wb.Sheets[nm]), c = L.classify(src, ALIAS), kind = force || c.kind;
          if (!kind || (force && c.kind && c.kind !== force)) return;
          if (!best[kind] || c.score > best[kind].score) best[kind] = { score: c.score, name: nm, src: src };
        });
        var out = Object.keys(best).map(function (kind) { var b = best[kind]; return { kind: kind, sheetName: isCsv ? file.name : b.name, res: parseAs(kind, b.src) }; });
        if (!out.length) throw new Error(force === "funding" ? "No TDP, AFP or Reservations column was found." : "Neither a funds export (commitment_item_fipex, obligation_amt_cum, ...) nor a funding file (TDP, AFP, Reservations) header row was found.");
        cb(null, out);
      } catch (err) { cb(err); }
    };
    reader.onerror = function () { cb(new Error("Could not read the file.")); };
    if (isCsv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  }

  // ---------- helpers ----------
  function money(v) { return K.money(v); }
  function dv(r, k) { return r[k] || BLANK; }
  function fmtStamp(d) { return ("0" + d.getDate()).slice(-2) + "-" + MON[d.getMonth()] + "-" + String(d.getFullYear()).slice(2) + " " + ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2); }
  function stamp() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function setDisclaimer(own) {
    var d = document.getElementById("dataDisclaimer");
    if (d) d.textContent = own ? "Showing data loaded from your files on this device. Nothing is uploaded."
      : "Data shown is fictional for demonstration. Not an official Iowa National Guard product.";
  }
  function codes(list) { return list.map(function (m) { return "<code>" + esc(m) + "</code>"; }).join(", "); }
  function exportsOk() { return S.files.filter(function (e) { return usable(e) && e.kind === "export"; }); }

  // ---------- data install ----------
  function applyData(recs, fund, source) {
    recs.forEach(function (r, i) { r._i = i; });
    S.recs = recs; S.fund = fund; S.source = source; S.showAll = false; setDisclaimer(source === "file");
    buildFilters(true); render();
    $("btnAdd").hidden = $("btnClear").hidden = source !== "file";
    var sv = $("btnSave"); sv.disabled = source !== "file";
    sv.title = source === "file" ? "Download one offline HTML file with the " + K.fmt(recs.length) + " loaded lines" + (fund ? " and " + plural(fund.rows.length, "funding row") : "") + " built in (real data: handle per policy)" : "Load your files first";
  }
  function loadDemo() {
    var D = window.FUNDS_DEMO, p = parseExport(L.aoaSource([D.headers].concat(D.rows))), fp = L.parseFunding(L.aoaSource([D.funding.headers].concat(D.funding.rows)));
    S.files = []; S.failed = null; S.allobj = p.report.allobj;
    applyData(p.records, L.buildFund([{ name: "Demo funding", rep: fp.report, rows: fp.rows }], p.records), "demo"); renderReport();
  }

  // ---------- multi-file loading (each file's kind is detected from its headers) ----------
  function entryFrom(name, sheetName, kind, res) {
    var e = { name: name, kind: kind, sheetName: sheetName, rep: res.report, order: S.fileOrder++ };
    if (kind === "funding") e.rows = res.rows; else { e.records = res.records; e.records.forEach(function (r) { r._src = name; }); }
    return e;
  }
  function readFiles(list, force, cb) {
    var files = Array.prototype.slice.call(list), out = [], i = 0;
    (function next() {
      if (i >= files.length) return cb(out);
      var f = files[i++];
      setBar("busy", "Reading " + i + " of " + files.length + ": " + f.name + "\u2026", 0);
      readFile(f, force, function (err, parts) {
        if (err) out.push({ name: f.name, kind: force || "unknown", error: err.message || String(err), order: S.fileOrder++ });
        else parts.forEach(function (p) { out.push(entryFrom(f.name + (parts.length > 1 ? " \u00b7 " + p.sheetName : ""), p.sheetName, p.kind, p.res)); });
        setTimeout(next, 0);
      });
    })();
  }
  function usable(e) { return !e.error && !e.rep.fatal && !e.dupOf && (e.kind === "funding" ? e.rows.length > 0 : e.records.length > 0); }
  function sig(e) { // identical content = same file loaded twice
    var h = 0, s = e.kind === "funding" ? e.rows.map(function (r) { return [r.fy, r.appn, r.sag, r.mdep, r.fa, r.ci, r.tdp, r.afp, r.res].join("|"); }).join("\n")
      : e.records.map(function (r) { return [r.doc, r.ci, r.fa, r.appn, r.fy, r.obl, r.com, r.disb, r.sag, r.mdep].join("|"); }).join("\n");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return e.kind + (e.kind === "funding" ? e.rows.length : e.records.length) + ":" + h;
  }
  // "Load files" replaces loaded files of the kinds it brings (a new export keeps the funding file and vice versa); "Add" keeps everything.
  function loadFiles(list, append, force) {
    if (!list || !list.length) return;
    readFiles(list, force, function (entries) {
      var prev = S.source === "file" ? S.files : [], kinds = entries.filter(function (e) { return !e.error; }).map(function (e) { return e.kind; });
      var all = (append ? prev : prev.filter(function (e) { return kinds.indexOf(e.kind) < 0; })).concat(entries);
      if (!all.some(usable)) { S.failed = entries; renderReport(); setExpanded(true, false); return; }
      S.failed = null; S.files = all; combine(); renderReport(); setExpanded(false);
    });
  }
  function combine() {
    var seen = {};
    S.files.forEach(function (e) { e.dupOf = null; if (e.error || e.rep.fatal) return; var s = sig(e); if (seen[s]) e.dupOf = seen[s]; else seen[s] = e.name; });
    var ok = S.files.filter(usable), recs = [];
    ok.filter(function (e) { return e.kind === "export"; }).forEach(function (e) { for (var i = 0; i < e.records.length; i++) recs.push(e.records[i]); });
    S.allobj = ok.reduce(function (t, e) { return t + (e.kind === "export" ? e.rep.allobj : 0); }, 0);
    applyData(recs, L.buildFund(ok.filter(function (e) { return e.kind === "funding"; }), recs), "file");
  }
  function resetInputs() { ["fileInput", "addInput", "fundInput"].forEach(function (id) { $(id).value = ""; }); }
  function clearFiles() { S.files = []; S.failed = null; resetInputs(); if (!(SAVED && loadSaved()) && !(PA && loadPA())) loadDemo(); setExpanded(false); }
  function showDemo() { S.files = []; S.failed = null; resetInputs(); loadDemo(); setExpanded(false); }

  // ---------- save with data (lines without ALLOBJ, only the listed columns, plus funding rows) ----------
  var SAVED_ID = "finance" + "Saved", SAVED = null;
  function readSaved() {
    var el = document.getElementById(SAVED_ID); if (!el) return null;
    try { var o = JSON.parse(el.textContent); return o && o.v === 1 && o.rows ? o : null; } catch (e) { return null; }
  }
  function srcNames(kind) { var out = []; S.files.filter(function (e) { return usable(e) && e.kind === kind; }).forEach(function (e) { (e.srcNames || [e.name]).forEach(function (nm) { if (out.indexOf(nm) < 0) out.push(nm); }); }); return out; }
  function loadSaved() {
    var D = SAVED, p = parseExport(L.aoaSource([D.headers].concat(D.rows)));
    p.records.forEach(function (r, i) { r._src = D.src[i] || ""; });
    p.report.allobj = D.allobjRemoved || 0;
    S.files = [{ name: "Saved export data (" + plural(D.files.length, "source file") + ")", kind: "export", srcNames: D.files, rep: p.report, records: p.records, embedded: true, order: S.fileOrder++ }];
    if (D.funding) {
      var fp = L.parseFunding(L.aoaSource([D.funding.headers].concat(D.funding.rows)));
      S.files.push({ name: "Saved funding data (" + plural(D.funding.files.length, "source file") + ")", kind: "funding", srcNames: D.funding.files, rep: fp.report, rows: fp.rows, embedded: true, order: S.fileOrder++ });
    }
    S.failed = null; combine(); renderReport();
    return true;
  }
  function showBanner() {
    var sa = new Date(SAVED.savedAt), names = SAVED.files.concat(SAVED.funding ? SAVED.funding.files : []);
    $("realBanner").hidden = false;
    $("realBannerMeta").textContent = "Data as of " + fmtStamp(sa) + " \u00b7 " + K.fmt(SAVED.rows.length) + " lines" + (SAVED.funding ? " + " + plural(SAVED.funding.rows.length, "funding row") : "") + " from " + plural(names.length, "source file") + ": " + names.join(", ");
    $("realBannerMeta").title = names.join("\n");
  }
  function safeJson(o) { return JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
  function snapshot() {
    var o = { v: 1, savedAt: new Date().toISOString(), files: srcNames("export"), allobjRemoved: S.allobj,
      headers: COLS.map(function (c) { return c[1]; }),
      rows: S.recs.map(function (r) { return COLS.map(function (c) { var v = r[c[0]]; return v == null ? "" : c[3] === "money" ? v : String(v); }); }),
      src: S.recs.map(function (r) { return r._src || ""; }) };
    if (S.fund) {
      var cols = S.fund.keys.concat(S.fund.hasAcct ? ["acct"] : [], S.fund.amts);
      o.funding = { files: srcNames("funding"), headers: cols.map(function (k) { return L.FLABEL[k]; }), rows: S.fund.rows.map(function (r) { return cols.map(function (k) { var v = r[k]; return v == null ? "" : v; }); }) };
    }
    return o;
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
  // A scheduled flow replaces the placeholder at the end of the template with [{file, rows}, {file, rows}] from two
  // "List rows present in a table" steps (export table + funding table). Each table is identified by its headers.
  var PA_ID = "embedded" + "-data", PA_TOKEN = "__PA_" + "DATA__", PA_TS_TOKEN = "__PA_" + "REFRESHED__", PA = null;
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
  function paSources(o) {
    var isObj = L.isObj;
    if (isObj(o)) o = Array.isArray(o.files) ? o.files : Array.isArray(o.value) && !Array.isArray(o.rows) ? [{ rows: o.value }] : [o];
    if (!Array.isArray(o)) return [];
    var srcs = [], flat = [];
    o.forEach(function (x) {
      if (!isObj(x)) return;
      var rows = Array.isArray(x.rows) ? x.rows : Array.isArray(x.value) ? x.value : null;
      if (rows) srcs.push({ file: x.file || x.name || x.FileName || "", rows: rows }); else flat.push(x);
    });
    if (flat.length) srcs.push({ file: "Automatic refresh", rows: flat });
    srcs.forEach(function (x, i) { x.file = String(x.file || "Source " + (i + 1)); });
    return srcs;
  }
  function loadPA() {
    if (!PA || PA.error) return false;
    var entries = PA.sources.map(function (src) {
      var s = L.rowsSource(src.rows), kind = L.classify(s, ALIAS).kind;
      if (!kind) return { name: src.file, kind: "unknown", error: "headers match neither the funds export nor a funding table", order: S.fileOrder++ };
      var e = entryFrom(src.file, src.file, kind, parseAs(kind, s)); e.automatic = true; return e;
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
    $("realBannerMeta").textContent = "Data refreshed " + (PA.refreshed || "(time not recorded)") + " (automatic) \u00b7 " + K.fmt(S.recs.length) + " lines" + (S.fund ? " + " + plural(S.fund.rows.length, "funding row") : "") + " from " + plural(names.length, "table") + ": " + names.join(", ");
    $("realBannerMeta").title = names.join("\n");
  }

  // ---------- load report ----------
  function fileLines(e) {
    var h = [], warns = 0, rep = e.rep;
    if (e.error) return { html: '<p class="err">Could not read this file: ' + esc(e.error) + "</p>", warns: 1 };
    if (rep.fatal) return { html: '<p class="err">' + esc(rep.fatal) + "</p>" + (rep.missing.length ? '<p class="muted">Missing: ' + codes(rep.missing) + "</p>" : ""), warns: 1 };
    if (e.dupOf) return { html: '<p class="warn">Same content as ' + esc(e.dupOf) + "; skipped so its amounts are not counted twice.</p>", warns: 1 };
    if (e.kind === "funding") { var fl = L.fileLines(e, codes); h.push(fl.html); warns += fl.warns; }
    else {
      h.push('<p class="' + (rep.rowsLoaded ? "ok" : "err") + '">Funds export: loaded ' + plural(rep.rowsLoaded, "line") + " of " + K.fmt(rep.rowsRead) + " read (header row " + rep.headerRow + ")." + (rep.blankRows ? ' <span class="muted">' + K.fmt(rep.blankRows) + " blank row(s) ignored.</span>" : "") + "</p>");
      h.push('<p class="ok"><strong>' + plural(rep.allobj, "ALLOBJ line") + " removed</strong> (not counted anywhere).</p>");
      var ok = rep.matched.length === COLS.length;
      h.push('<p class="' + (ok ? "ok" : "warn") + '">' + rep.matched.length + " of " + COLS.length + " columns matched.</p>");
      if (!ok) { warns++; h.push('<p class="warn">Missing: ' + codes(rep.missing) + "</p>"); }
    }
    if (rep.pii) h.push('<p class="muted">' + plural(rep.pii, "personal identifier column") + " skipped without reading.</p>");
    if (rep.extra.length) h.push('<details class="muted"><summary>' + plural(rep.extra.length, "other column") + " ignored</summary><p class=\"muted\">" + codes(rep.extra) + "</p></details>");
    if (rep.dupes.length) h.push('<p class="muted">Repeated columns ignored (first one used): ' + codes(rep.dupes) + "</p>");
    if (rep.badNumber) { warns++; h.push('<p class="warn">' + rep.badNumber + " amount cell(s) could not be read and were treated as blank. Examples: " + rep.badNumberExamples.map(function (x) { return "row " + x.row + " <code>" + esc(x.column) + "</code> = &ldquo;" + esc(x.value) + "&rdquo;"; }).join("; ") + ".</p>"); }
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
      el.innerHTML = '<p class="muted">Showing the built-in fictional demo data: ' + plural(S.recs.length, "line") + " in the funds export layout (" + plural(S.allobj, "ALLOBJ line") + " removed) and a fictional funding file with " + plural(S.fund ? S.fund.rows.length : 0, "row") + " matched on " + esc(S.fund ? L.keyLabel(S.fund.keys) : "") + ". Choose your export and funding file, or drop them here.</p>";
      setBar("ok", "Demo data (fictional) \u00b7 " + plural(S.recs.length, "line") + " \u00b7 " + plural(S.allobj, "ALLOBJ line") + " removed \u00b7 demo funding file", 0);
      return;
    }
    S.files.forEach(function (e) {
      var fl = fileLines(e); warns += fl.warns;
      var cnt = e.kind === "funding" ? plural(e.rows ? e.rows.length : 0, "row") : plural(e.records ? e.records.length : 0, "line");
      var head = esc(e.name) + " \u00b7 " + (e.kind === "funding" ? "funding" : e.kind === "export" ? "export" : "unknown") + (usable(e) ? " \u00b7 " + cnt : " \u00b7 not loaded") + (fl.warns ? ' \u00b7 <span class="warn">' + fl.warns + " warning" + (fl.warns === 1 ? "" : "s") + "</span>" : "");
      h.push('<details class="filerep"' + (fl.warns || S.files.length === 1 ? " open" : "") + "><summary>" + head + "</summary>" + fl.html + "</details>");
    });
    var ex = exportsOk(), fu = L.reportLines(S.fund, S.recs, DIM_KEYS); warns += fu.warns;
    h.push('<div class="combined"><p class="ok"><strong>Combined: ' + plural(S.recs.length, "line") + " from " + plural(ex.length, "export file") + "</strong> \u00b7 " + plural(S.allobj, "ALLOBJ line") + " removed.</p>" + (ex.length ? "" : '<p class="warn">No funds export loaded yet: Obligation and Disbursement are $0. Load the export with &ldquo;Add more files&rdquo;.</p>') + fu.html + "</div>");
    if (!ex.length) warns++;
    el.innerHTML = h.join("");
    setBar(warns ? "warn" : "ok", (ex.length === 1 ? ex[0].name : plural(ex.length, "export")) + " \u00b7 " + plural(S.recs.length, "line") + " \u00b7 " + plural(S.allobj, "ALLOBJ line") + " removed \u00b7 " + (S.fund ? "funding: " + S.fund.files.join(", ") : "no funding file"), warns);
  }
  function setBar(state, textLine, warns) {
    $("loadBar").className = "loadbar no-print chrome" + (state === "ok" ? "" : " " + state);
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
      var k = d[0], vals = S.recs.map(function (r) { return dv(r, k); });
      if (S.fund && S.fund.keys.indexOf(k) >= 0) {
        var have = Object.create(null); S.recs.forEach(function (r) { have[L.kn(k, r[k])] = 1; });
        S.fund.rows.forEach(function (r) { if (!have[L.kn(k, r[k])]) vals.push(r[k] || BLANK); });
      }
      vals = K.uniq(vals).sort(function (a, b) { return a === BLANK ? 1 : b === BLANK ? -1 : cmpVal(a, b); });
      var labels = k === "fa" && S.fund && S.fund.hasAcct ? vals.map(function (v) { var a = L.account(S.fund, v); return a ? v + " \u00b7 " + a : v; }) : null;
      K.fillSelect($(d[1]), vals, d[3], !reset, labels);
    });
  }
  function F() { var f = {}; DIMS.forEach(function (d) { f[d[0]] = $(d[1]).value; }); return f; }
  function pass(r, f) { for (var k in f) if (f[k] && dv(r, k) !== f[k]) return false; return true; }
  function currentRows() { var f = F(); return S.recs.filter(function (r) { return pass(r, f); }); }

  // ---------- render ----------
  function render() {
    var f = F(), rows = currentRows(), j = L.joined(S.fund, rows, f, DIM_KEYS);
    var scope = DIMS.filter(function (d) { return f[d[0]]; }).map(function (d) { return LABEL[d[0]] + " " + f[d[0]]; }), ex = exportsOk();
    $("asofLabel").textContent = plural(rows.length, "line") + " \u00b7 " + plural(docCount(rows), "document");
    $("scopeLabel").textContent = scope.length ? scope.join(" \u00b7 ") : "All funds";
    $("sourceLabel").textContent = S.source === "file" ? " \u00b7 " + (SAVED && S.files[0] && S.files[0].embedded ? "Saved data" : PA && S.files[0] && S.files[0].automatic ? "Automatic refresh" : "Your " + (ex.length === 1 ? "file: " + ex[0].name : plural(ex.length, "export file"))) + (S.fund ? " + funding" : "") : " \u00b7 Demo data";
    kpis(rows, j); summary(rows, f, j); position(rows, j);
    DIMS.forEach(function (d) { chart(d, rows, j); });
    L.table.render(S.fund, j);
    S.base = rows; table();
  }
  function docCount(rows) { var s = Object.create(null), c = 0; rows.forEach(function (r) { if (r.doc && !s[r.doc]) { s[r.doc] = 1; c++; } }); return c; }
  function kpi(lbl, val, sub, cls, title) { return '<div class="kpi' + (cls ? " " + cls : "") + '"' + (title ? ' title="' + esc(title) + '"' : "") + '><div class="lbl">' + lbl + '</div><div class="val">' + val + '</div><div class="sub">' + (sub || "&nbsp;") + "</div></div>"; }
  function needKpi(lbl, cls) { return kpi(lbl, '<button class="btn ghost sm needfund" type="button" data-fund="1">Load funding file</button>', "Comes from the funding file", cls + " need"); }
  function kpis(rows, j) {
    var o = K.sum(rows, function (r) { return n(r.obl); }), d = K.sum(rows, function (r) { return n(r.disb); }), h = [];
    if (j) {
      var t = j.totals, nk = j.nonKey.length ? "Set per " + L.keyLabel(S.fund.keys) + "; not split by " + j.nonKey.map(function (k) { return LABEL[k]; }).join(", ") : "";
      h.push(kpi("TDP", money(t.tdp), nk || "Full-year funding \u00b7 " + full(t.tdp), "tdp", full(t.tdp)));
      h.push(kpi("AFP", money(t.afp), "Funded to date" + (t.tdp ? " \u00b7 " + Math.round(t.afp / t.tdp * 100) + "% of TDP" : ""), "afp", full(t.afp)));
      h.push(kpi("Reservations", money(t.res), "Known costs not yet obligated", "res", full(t.res)));
    } else { h.push(needKpi("TDP", "tdp")); h.push(needKpi("AFP", "afp")); h.push(needKpi("Reservations", "res")); }
    h.push(kpi("Obligation", money(o), plural(rows.length, "line") + " \u00b7 " + plural(docCount(rows), "doc") + " \u00b7 " + K.fmt(S.allobj) + " ALLOBJ removed", "obl", full(o)));
    h.push(kpi("Disbursement", money(d), full(d), "disb", full(d)));
    if (j) { var b = j.totals.bal; h.push(kpi("Balance", money(b), "TDP \u2212 Reservations \u2212 Obligation \u2212 Disbursement", "bal " + (b < 0 ? "bad" : "good"), full(b))); }
    else h.push(needKpi("Balance", "bal"));
    $("kpis").innerHTML = h.join("");
  }
  function group(rows, k) {
    var m = Object.create(null), out = [];
    rows.forEach(function (r) { var key = L.kn(k, r[k]), g = m[key]; if (!g) { g = m[key] = { label: dv(r, k), obl: 0, disb: 0, tdp: null, lines: 0 }; out.push(g); } g.obl += n(r.obl); g.disb += n(r.disb); g.lines++; });
    return out;
  }
  function groupJoined(j, k) {
    var m = Object.create(null), out = [];
    j.groups.forEach(function (x) { var key = L.kn(k, x[k]), g = m[key]; if (!g) { g = m[key] = { label: x[k] || BLANK, obl: 0, disb: 0, tdp: 0, res: 0, lines: 0 }; out.push(g); } g.obl += x.obl; g.disb += x.disb; g.tdp += n(x.tdp); g.res += n(x.res); g.lines += x.lines; });
    return out;
  }
  function mag(g) { return Math.max(Math.abs(g.obl), Math.abs(g.disb), Math.abs(n(g.tdp))); }
  function summary(rows, f, j) {
    if (!rows.length && !(j && j.groups.length)) { $("summary").textContent = "No lines match the current filters."; return; }
    var o = K.sum(rows, function (r) { return n(r.obl); }), d = K.sum(rows, function (r) { return n(r.disb); }), s = [];
    s.push(plural(rows.length, "line") + " across " + plural(docCount(rows), "document") + ": Obligation " + full(o) + " and Disbursement " + full(d) + ".");
    if (j) {
      var t = j.totals;
      s.push("TDP " + full(t.tdp) + ", AFP " + full(t.afp) + ", Reservations " + full(t.res) + "; Balance " + full(t.bal) + " (TDP \u2212 Reservations \u2212 Obligation \u2212 Disbursement).");
      var neg = j.groups.filter(function (g) { return g.funded && g.bal < 0; }).sort(function (a, b) { return a.bal - b.bal; });
      if (neg.length) s.push(plural(neg.length, "funding row") + " " + (neg.length === 1 ? "has" : "have") + " a negative balance; the largest is " + S.fund.keys.map(function (k) { return neg[0][k]; }).join(" / ") + (neg[0].acct ? " (" + neg[0].acct + ")" : "") + " at " + full(neg[0].bal) + ".");
      if (t.unfundedLines) s.push(plural(t.unfundedLines, "line") + " (" + money(t.unfundedObl) + " obligated) have no matching funding row.");
    } else s.push("Load the funding file to see TDP, AFP, Reservations and Balance.");
    if (!f.ci) { var g = group(rows, "ci").sort(function (a, b) { return b.obl - a.obl; }); if (g.length > 1 && g[0].obl > 0) s.push("Largest commitment item by obligation: " + g[0].label + " (" + money(g[0].obl) + ", " + Math.round(g[0].obl / (o || 1) * 100) + "%)."); }
    s.push(plural(S.allobj, "ALLOBJ line") + (S.allobj === 1 ? " was" : " were") + " removed and " + (S.allobj === 1 ? "is" : "are") + " not included.");
    $("summary").textContent = s.join(" ");
  }
  function moneyAxis(o, ax) { o.scales[ax].ticks = { callback: function (v) { return money(v); } }; o.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + full(c.raw); } }; return o; }
  // Where the money stands: TDP split into Obligation, Disbursement, Reservations and Balance
  function position(rows, j) {
    var o = moneyAxis(K.chartBase(), "x"); o.indexAxis = "y"; o.scales.x.stacked = true; o.scales.y.stacked = true;
    var ob = K.sum(rows, function (r) { return n(r.obl); }), di = K.sum(rows, function (r) { return n(r.disb); });
    var t = j ? j.totals : null;
    var ds = [{ label: "Obligation", data: [ob], backgroundColor: C_OBL }, { label: "Disbursement", data: [di], backgroundColor: C_DISB }];
    if (t) { ds.push({ label: "Reservations", data: [t.res], backgroundColor: C_RES }); ds.push({ label: "Balance", data: [Math.max(0, t.bal)], backgroundColor: C_BAL }); }
    K.upsert("cPos", { type: "bar", data: { labels: [t ? "TDP " + money(t.tdp) : "Spent"], datasets: ds }, options: o });
    $("posNote").textContent = t ? (t.bal < 0 ? "Over TDP by " + full(-t.bal) + "." : full(t.bal) + " left (" + (t.tdp ? Math.round(t.bal / t.tdp * 100) : 0) + "% of TDP).") : "Load the funding file to see Reservations and the Balance left.";
  }
  function chart(d, rows, j) {
    var k = d[0], horiz = k !== "fy" && k !== "appn", withTdp = j && S.fund.keys.indexOf(k) >= 0 && S.fund.amts.indexOf("tdp") >= 0;
    var g = withTdp ? groupJoined(j, k) : group(rows, k);
    if (k === "fy") g.sort(function (a, b) { return a.label === BLANK ? 1 : b.label === BLANK ? -1 : cmpVal(a.label, b.label); });
    else {
      g.sort(function (a, b) { return mag(b) - mag(a) || cmpVal(a.label, b.label); });
      if (g.length > TOPN + 1) {
        var rest = g.slice(TOPN), oth = { label: "Other (" + rest.length + ")", obl: 0, disb: 0, tdp: 0, res: 0, other: true };
        rest.forEach(function (x) { oth.obl += x.obl; oth.disb += x.disb; oth.tdp += n(x.tdp); oth.res += n(x.res); });
        g = g.slice(0, TOPN).concat([oth]);
      }
    }
    var o = moneyAxis(K.chartBase(), horiz ? "x" : "y");
    if (horiz) o.indexAxis = "y";
    o.onClick = function (e, els) { if (!els.length) return; var x = g[els[0].index]; if (!x || x.other) return; $(d[1]).value = x.label; render(); };
    o.onHover = function (e, els) { e.native.target.style.cursor = els.length && g[els[0].index] && !g[els[0].index].other ? "pointer" : "default"; };
    var ds = [];
    if (withTdp) ds.push({ label: "TDP", data: g.map(function (x) { return x.tdp; }), backgroundColor: C_TDP });
    ds.push({ label: "Obligation", data: g.map(function (x) { return x.obl; }), backgroundColor: C_OBL });
    ds.push({ label: "Disbursement", data: g.map(function (x) { return x.disb; }), backgroundColor: C_DISB });
    if (withTdp) ds.push({ label: "Balance", data: g.map(function (x) { return x.other ? null : n(x.tdp) - n(x.res) - x.obl - x.disb; }), backgroundColor: C_BAL });
    var labels = g.map(function (x) { var a = k === "fa" && !x.other ? L.account(S.fund, x.label) : ""; return a ? x.label + " \u00b7 " + a : x.label; });
    K.upsert(d[2], { type: "bar", data: { labels: labels, datasets: ds }, options: o });
  }

  // ---------- line table ----------
  function match(r, q) { return TEXT_KEYS.some(function (k) { return r[k] && String(r[k]).toLowerCase().indexOf(q) >= 0; }) || (S.fund && L.account(S.fund, r.fa).toLowerCase().indexOf(q) >= 0); }
  function isMoney(k) { return COLS.filter(function (c) { return c[0] === k; })[0][3] === "money"; }
  function sorted(rows) {
    var k = S.sort.k, dir = S.sort.dir, m = isMoney(k);
    return rows.slice().sort(function (a, b) { var x = m ? n(a[k]) - n(b[k]) : cmpVal(a[k] || "", b[k] || ""); return x * dir || cmpVal(a.doc, b.doc); });
  }
  function table() {
    var q = ($("fSearch").value || "").trim().toLowerCase(), rows = S.base || [];
    if (q) rows = rows.filter(function (r) { return match(r, q); });
    rows = sorted(rows); S.shown = rows;
    $("searchNote").textContent = q ? K.fmt(rows.length) + " of " + K.fmt(S.base.length) + " lines match \u201c" + $("fSearch").value.trim() + "\u201d" : "";
    $("tDocs").tHead.innerHTML = "<tr>" + COLS.map(function (c) { var on = S.sort.k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[3] === "money" ? "num" : "") + (on ? " sorted" + (S.sort.dir > 0 ? " asc" : "") : "") + '" aria-sort="' + (on ? (S.sort.dir > 0 ? "ascending" : "descending") : "none") + '">' + esc(c[1]) + "</th>"; }).join("") + "</tr>";
    var show = rows.slice(0, S.showAll ? MAXROWS : PAGE);
    $("tDocs").tBodies[0].innerHTML = show.length ? show.map(function (r) {
      return "<tr>" + COLS.map(function (c) { var v = r[c[0]]; if (c[3] === "money") return '<td class="num' + (v < 0 ? " neg" : "") + '">' + (v == null ? '<span class="muted">\u2014</span>' : full(v)) + "</td>"; return "<td>" + (v ? esc(v) : '<span class="muted">\u2014</span>') + "</td>"; }).join("") + "</tr>";
    }).join("") : '<tr><td colspan="' + COLS.length + '" class="muted">' + (q ? "No lines match the search in the current selection." : "No lines match the current filters.") + "</td></tr>";
    var tot = {}; ["obl", "com", "disb"].forEach(function (k) { tot[k] = K.sum(rows, function (r) { return n(r[k]); }); });
    $("tDocs").tFoot.innerHTML = rows.length ? "<tr>" + COLS.map(function (c, i) { return tot[c[0]] != null ? '<td class="num">' + full(tot[c[0]]) + "</td>" : i === 0 ? "<td>Total (" + plural(rows.length, "line") + (rows.length > show.length ? ", " + K.fmt(show.length) + " shown" : "") + ")</td>" : "<td></td>"; }).join("") + "</tr>" : "";
    var btn = $("btnAll");
    btn.style.display = rows.length > PAGE ? "" : "none";
    btn.textContent = S.showAll ? "Show " + PAGE : rows.length > MAXROWS ? "Show first " + K.fmt(MAXROWS) : "Show all " + K.fmt(rows.length);
  }
  function exportCsv() {
    K.downloadCsv("status_of_funds_lines_" + stamp() + ".csv", COLS.map(function (c) { return c[1]; }),
      (S.shown || []).map(function (r) { return COLS.map(function (c) { var v = r[c[0]]; return v == null ? "" : c[3] === "money" ? v.toFixed(2) : v; }); }));
  }

  // ---------- wiring ----------
  function init() {
    K.initCharts();
    $("dictBody").innerHTML = COLS.map(function (c, i) { return "<tr><td>" + (i + 1) + "</td><td><code>" + esc(EXPORT_NAME[c[0]]) + "</code></td><td>" + esc(c[1]) + "</td><td>" + esc(c[4]) + "</td></tr>"; }).join("");
    $("btnLoad").addEventListener("click", function () { $("fileInput").click(); });
    $("btnFund").addEventListener("click", function () { $("fundInput").click(); });
    document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-fund]")) $("fundInput").click(); });
    $("btnDetails").addEventListener("click", function () { setExpanded($("loadPanel").hidden); });
    $("btnPresent").addEventListener("click", function () { setPresent(!document.body.classList.contains("present")); });
    setExpanded(lsGet(), false);
    $("btnPrint").addEventListener("click", function () { window.print(); });
    $("btnDemo").addEventListener("click", showDemo);
    $("btnSave").addEventListener("click", saveWithData);
    $("fileInput").addEventListener("change", function (e) { loadFiles(e.target.files, false); });
    $("addInput").addEventListener("change", function (e) { loadFiles(e.target.files, true); this.value = ""; });
    $("fundInput").addEventListener("change", function (e) { loadFiles(e.target.files, false, "funding"); this.value = ""; });
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
    $("btnFundCsv").addEventListener("click", L.table.exportCsv);
    $("btnFundAll").addEventListener("click", function () { L.table.toggleAll(); render(); });
    $("tFund").tHead.addEventListener("click", function (e) { var th = e.target.closest("th[data-k]"); if (th) { L.table.sortBy(th.getAttribute("data-k")); render(); } });
    var st; $("fSearch").addEventListener("input", function () { clearTimeout(st); st = setTimeout(table, 120); });
    $("fSearch").addEventListener("keydown", function (e) { if (e.key === "Escape" && this.value) { e.stopPropagation(); this.value = ""; table(); } });
    $("btnAll").addEventListener("click", function () { S.showAll = !S.showAll; table(); });
    $("tDocs").tHead.addEventListener("click", function (e) {
      var th = e.target.closest("th[data-k]"); if (!th) return; var k = th.getAttribute("data-k");
      S.sort = S.sort.k === k ? { k: k, dir: -S.sort.dir } : { k: k, dir: isMoney(k) ? -1 : 1 }; table();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("present")) setPresent(false); });
    SAVED = readSaved(); PA = SAVED ? null : readPA();
    if (SAVED) { showBanner(); document.title = "REAL DATA \u00b7 " + document.title; loadSaved(); }
    else if (PA) { document.title = "REAL DATA \u00b7 " + document.title; if (!loadPA()) loadDemo(); showPABanner(); }
    else loadDemo();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
