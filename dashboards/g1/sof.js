/* G1 Dashboard: Status of Funds page. Port of dashboards/finance/finance.js (same schema and math) using the shared
   FundsLib (funding.js) and FundsTrend (plan.js). Everything runs in this browser tab; nothing is uploaded. */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, TR = w.FundsTrend, C = w.G1, $ = K.$, esc = K.esc;
  // ===== CONFIG =====
  // The GFEBS export carries commitments (Total Expenditure) and disbursements as negative numbers.
  // true = multiply commitment_amt_cum and disbursement_amt_cum by -1 when the export is read.
  // G1 dashboard: Obligation is CALCULATED, obligation_amt_cum is not read.
  //   raw export:  obligation = disbursement_amt_cum - commitment_amt_cum
  //   flipped:     Obligation = Total Expenditure - Disbursement   (same number)
  //   Spent = Obligation + Disbursement = Total Expenditure;  Balance = TDP - Obligation - Disbursement
  // Funding, spend plan and key files are never flipped. Saved copies store the flipped amounts and are never flipped again.
  var FLIP_EXPORT_SIGN = true;
  // ==================
  var n = L.n, full = L.full, plural = L.plural, cmpVal = L.cmpVal, idText = L.idText, BLANK = L.BLANK, PAGE = L.PAGE, MAXROWS = L.MAXROWS;
  var COLS = [
    ["doc", "Document Number", ["contractdocno"], "id", "Line table, search, document count"],
    ["ci", "Commitment Item", ["commitmentitemfipex", "commitmentitem"], "text", "Shown as its description from the Commitment Item Key"],
    ["fa", "Functional Area", ["functionalareafarea", "functionalarea"], "text", "Filter; rolled up to Account, Sag and MDEP through the Account Key"],
    ["appn", "Appropriation", ["appropriationtype", "appropriation"], "text", "Chart, filter"],
    ["fy", "Fiscal Year", ["fiscalyear"], "fy", "Chart, filter, funding match, trend year"],
    ["fm", "Fiscal Month", ["fiscalmonth", "fiscalmonthno", "fiscalmonthnumber", "fiscalmo", "fiscalperiod", "fiscalper"], "fm", "Trend charts, filter (1 = Oct ... 12 = Sep)"],
    ["obl", "Obligation", [], "money", "Calculated: Total Expenditure \u2212 Disbursement"],
    ["com", "Total Expenditure", ["commitmentamtcum", "totalexpenditure", "commitments"], "money", "Obligation + Disbursement"],
    ["disb", "Disbursement", ["disbursementamtcum", "disbursement", "disbursements"], "money", "KPI, charts, Balance"]
  ];
  var EXPORT_NAME = { doc: "contract_doc_no", ci: "commitment_item_fipex", fa: "functional_area_farea", appn: "appropriation_type", fy: "fiscal_year", fm: "fiscal_month", obl: "calculated", com: "commitment_amt_cum", disb: "disbursement_amt_cum" };
  var LABEL = {}; COLS.forEach(function (c) { LABEL[c[0]] = c[1]; });
  LABEL.acctL = "Account"; LABEL.ciL = "Commitment Item"; LABEL.sag = "Sag"; LABEL.mdep = "MDEP";
  var TCOLS = [["doc", "Document Number", "id"], ["ciL", "Commitment Item", "ciL"], ["ci", "CI Code", "text"], ["fa", "Functional Area", "text"], ["acctL", "Account", "acct"],
    ["sag", "Sag", "keyed"], ["mdep", "MDEP", "keyed"], ["appn", "Appropriation", "text"], ["fy", "Fiscal Year", "fy"], ["fm", "Fiscal Month", "fm"],
    ["com", "Total Expenditure", "money"], ["obl", "Obligation", "money"], ["disb", "Disbursement", "money"]];
  var ALIAS = L.aliasMap(COLS);
  var DIMS = [["fy", "fFy", "cFy", "All years"], ["appn", "fAppn", "cAppn", "All"], ["sag", "fSag", "cSag", "All"], ["mdep", "fMdep", "cMdep", "All"], ["acctL", "fAcct", "cAcct", "All"], ["fa", "fFa", null, "All"], ["ciL", "fCi", "cCi", "All"], ["fm", "fFm", null, "All months"]];
  var DIM_KEYS = DIMS.map(function (d) { return d[0]; });
  var TEXT_KEYS = ["doc", "ci", "ciL", "fa", "acctL", "appn", "fy", "fm", "sag", "mdep"];
  var TOPN = 10;
  var KIND_LABEL = { "export": "Funds export", funding: "Funding file", plan: "Spend plan", key: "Account Key", cikey: "Commitment Item Key" };
  var S = { files: [], recs: [], fund: null, plan: null, allobj: 0, showAll: false, sort: { k: "com", dir: -1 }, asort: { k: "te", dir: -1 }, open: {}, shown: [], order: 0 };

  // ---------- export parsing (only header cells and the mapped columns are ever read) ----------
  // saved = a saved copy's own data: amounts are already flipped and Obligation already calculated (read as stored, never recalculated)
  function parseExport(src, noFlip, saved) {
    var flip = FLIP_EXPORT_SIGN && !noFlip;
    var hm = L.mapHeaders(src, ALIAS), map = hm.map;
    if (!saved) delete map.obl;                                   // never read from a raw export
    var rep = { kind: "export", headerRow: hm.hi + 1, matched: COLS.filter(function (c) { return c[0] !== "obl" && map[c[0]] != null; }).map(function (c) { return c[1]; }),
      missing: COLS.filter(function (c) { return c[0] !== "obl" && map[c[0]] == null; }).map(function (c) { return EXPORT_NAME[c[0]] + " (" + c[1] + ")"; }), negObl: 0, negOblExamples: [],
      extra: hm.extra, dupes: hm.dupes, pii: hm.pii, rowsRead: 0, rowsLoaded: 0, blankRows: 0, allobj: 0, badNumber: 0, badNumberExamples: [], badMonth: 0, badMonthExamples: [], fatal: null };
    if (map.ci == null) { rep.fatal = "No Commitment Item column (commitment_item_fipex) was found. The file was not loaded."; return { records: [], report: rep }; }
    if (map.com == null || map.disb == null) {
      var miss = [map.com == null ? "commitment_amt_cum (Total Expenditure)" : "", map.disb == null ? "disbursement_amt_cum (Disbursement)" : ""].filter(Boolean);
      rep.fatal = "Missing " + miss.join(" and ") + ". Both are needed to calculate Obligation (Total Expenditure \u2212 Disbursement). The file was not loaded.";
      rep.missing = miss; return { records: [], report: rep };
    }
    var keys = Object.keys(map), out = [];
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var raw = {}, empty = true;
      keys.forEach(function (k) { var v = src.get(rr, map[k]); raw[k] = v; if (!L.blankish(v)) empty = false; });
      if (empty) { rep.blankRows++; continue; }
      rep.rowsRead++;
      if (L.isAllobj(raw.ci)) { rep.allobj++; continue; }
      var rec = { _row: rr + 1, doc: idText(raw.doc), ci: idText(raw.ci), fa: idText(raw.fa), appn: idText(raw.appn), fy: L.fyText(raw.fy) };
      var fmn = "fm" in raw ? L.fmNum(raw.fm) : null;
      if (fmn !== null && isNaN(fmn)) { rep.badMonth++; if (rep.badMonthExamples.length < 5) rep.badMonthExamples.push({ row: rr + 1, value: L.txt(raw.fm) }); fmn = null; }
      rec.fmn = fmn; rec.fm = L.fmLabel(fmn);
      (saved && "obl" in raw ? ["obl", "com", "disb"] : ["com", "disb"]).forEach(function (k) {
        var x = k in raw ? L.parseAmt(raw[k]) : null;
        if (x !== null && isNaN(x)) { L.badNum(rep, rr + 1, EXPORT_NAME[k], raw[k]); x = null; }
        if (flip && x) x = -x;
        rec[k] = x;
      });
      if (!(saved && "obl" in raw)) {                             // Obligation = Total Expenditure - Disbursement
        rec.obl = rec.com == null && rec.disb == null ? null : Math.round((n(rec.com) - n(rec.disb)) * 100) / 100;
        if (rec.obl < 0) { rep.negObl++; if (rep.negOblExamples.length < 5) rep.negOblExamples.push({ row: rr + 1, value: rec.obl }); }
      }
      out.push(rec);
    }
    rep.rowsLoaded = out.length; rep.flipped = flip;
    return { records: out, report: rep };
  }
  // G1 dashboard: no Reservations. The funding file is Fiscal Year, Account, TDP, AFP; a Reservations column is ignored.
  function parseFunding(src) {
    var p = L.parseFunding(src), r = p.report;
    p.rows.forEach(function (row) { delete row.res; });
    r.amts = (r.amts || []).filter(function (k) { return k !== "res"; });
    r.missing = (r.missing || []).filter(function (m) { return m !== "Reservations"; });
    if (r.fatal) r.fatal = r.fatal.replace("TDP, AFP or Reservations", "TDP or AFP");
    else if (!r.amts.length) { r.fatal = "No TDP or AFP column was found."; p.rows = []; r.rowsLoaded = 0; }
    return p;
  }
  // the spend plan is always for the current fiscal year (1 October starts the next one) unless the file gives a Fiscal Year
  function parsePlanCur(src) {
    var res = TR.parsePlan(src), cur = C.currentFy(), k = 0;
    res.rows.forEach(function (r) { if (!r.fy) { r.fy = cur; k++; } });
    if (k) res.report.fyAssigned = { n: k, fy: cur };
    return res;
  }
  function parseAs(kind, src, noFlip) { return kind === "funding" ? parseFunding(src) : kind === "plan" ? parsePlanCur(src) : kind === "key" ? L.parseKey(src) : kind === "cikey" ? L.parseCiKey(src) : parseExport(src, noFlip); }
  function derive(recs) {
    var ciLoaded = L.ciInfo().size > 0;
    recs.forEach(function (r) {
      var k = L.keyed(r.fa); r.acct = k.acct; r.acctL = k.acct || L.UNMAPPED; r.sag = k.sag; r.mdep = k.mdep;
      var d = L.ciDesc(r.ci); r.ciDesc = d; r.ciUnm = ciLoaded && !!r.ci && !d;
      r.ciL = d || (r.ciUnm && L.ciIsDesc(r.ci) ? r.ci + " (Unmapped)" : r.ci);
    });
  }
  function keysFrom(entries) {
    L.buildCiKey(entries.filter(function (e) { return e.kind === "cikey"; }));
    L.buildKey(entries.filter(function (e) { return e.kind === "key"; }), entries.filter(function (e) { return e.kind === "funding"; }));
  }
  function mkEntry(name, kind, res, extra) {
    var e = { name: name, kind: kind, kindLabel: KIND_LABEL[kind], rep: res.report, order: S.order++, fatal: res.report.fatal || null };
    if (kind !== "export") e.rows = res.rows; else { e.records = res.records; e.records.forEach(function (r) { r._src = name; }); }
    for (var k in extra || {}) e[k] = extra[k];
    return e;
  }
  function usable(e) { return !e.error && !e.fatal && !e.dupOf && (e.kind !== "export" ? e.rows.length > 0 : e.records.length > 0); }
  function sig(e) {
    var s = e.kind === "funding" ? e.rows.map(function (r) { return [r.fy, r.acct, r.fa, r.tdp, r.afp, r.res].join("|"); }).join("\n")
      : e.kind === "plan" ? e.rows.map(function (r) { return [r.fy, r.fa, r.acct, r.fm, r.amt].join("|"); }).join("\n")
      : e.kind === "key" ? e.rows.map(function (r) { return [r.fa, r.acct, r.sag, r.mdep].join("|"); }).join("\n")
      : e.kind === "cikey" ? e.rows.map(function (r) { return [r.ci, r.desc].join("|"); }).join("\n")
      : e.records.map(function (r) { return [r.doc, r.ci, r.fa, r.appn, r.fy, r.fm, r.obl, r.com, r.disb].join("|"); }).join("\n");
    return e.kind + ":" + C.sig(s);
  }
  // A new upload replaces earlier files of the kinds it brings (a new export keeps the funding file and the keys, and vice versa).
  function ingest(entries) {
    var kinds = entries.filter(function (e) { return !e.fatal; }).map(function (e) { return e.kind; });
    S.files = S.files.filter(function (e) { return kinds.indexOf(e.kind) < 0; }).concat(entries);
    combine();
  }
  function combine() {
    var seen = {};
    S.files.forEach(function (e) { e.dupOf = null; if (e.error || e.fatal) return; var s = sig(e); if (seen[s]) e.dupOf = seen[s]; else seen[s] = e.name; });
    var ok = S.files.filter(usable), recs = [];
    ok.filter(function (e) { return e.kind === "export"; }).forEach(function (e) { for (var i = 0; i < e.records.length; i++) recs.push(e.records[i]); });
    S.allobj = ok.reduce(function (t, e) { return t + (e.kind === "export" ? e.rep.allobj : 0); }, 0);
    keysFrom(ok); derive(recs);
    recs.forEach(function (r, i) { r._i = i; });
    S.recs = recs; S.fund = L.buildFund(ok.filter(function (e) { return e.kind === "funding"; }), recs); S.plan = TR.buildPlan(ok.filter(function (e) { return e.kind === "plan"; }));
    S.showAll = false;
    S.files.forEach(function (e) { e.count = e.kind === "export" ? (e.records || []).length : (e.rows || []).length; var fl = fileLines(e); e.warns = fl.warns; });
    buildFilters(true);
    var fy = autoFy(); if (fy && $("fFy").querySelector('option[value="' + fy + '"]')) $("fFy").value = fy;   // open on one fiscal year (pace needs one)
    S.open = {};
  }
  function aoa(t) { return L.aoaSource([t.headers].concat(t.rows)); }
  function demo() {
    var D = w.G1_FUNDS_DEMO; if (!D) return;
    S.files = [mkEntry("Demo funds export", "export", parseExport(aoa(D))), mkEntry("Demo funding file", "funding", parseFunding(aoa(D.funding))),
      mkEntry("Demo spend plan", "plan", TR.parsePlan(aoa(D.plan))), mkEntry("Demo Account Key", "key", L.parseKey(aoa(D.key))), mkEntry("Demo Commitment Item Key", "cikey", L.parseCiKey(aoa(D.cikey)))];
    combine();
  }
  function clear() { S.files = []; combine(); }

  // ---------- save with data / restore (amounts saved already sign-flipped; never flipped again) ----------
  function srcNames(kind) { var out = []; S.files.filter(function (e) { return usable(e) && e.kind === kind; }).forEach(function (e) { (e.srcNames || [e.name]).forEach(function (nm) { if (out.indexOf(nm) < 0) out.push(nm); }); }); return out; }
  function snapshot() {
    var o = { files: srcNames("export"), allobjRemoved: S.allobj, signFlipped: true, oblCalculated: true, headers: COLS.map(function (c) { return c[1]; }),
      rows: S.recs.map(function (r) { return COLS.map(function (c) { var v = r[c[0]]; return v == null ? "" : c[3] === "money" ? v : c[3] === "fm" ? (r.fmn || "") : String(v); }); }) };
    if (S.fund) {
      var am = S.fund.amts;
      o.funding = { files: srcNames("funding"), headers: ["Fiscal Year", "Account", "Functional Area"].concat(am.map(function (k) { return L.FLABEL[k]; })),
        rows: S.fund.rows.map(function (r) { return [r.fy || "", r.unmapped ? "" : r.acct, r.unmapped ? r.fa : ""].concat(am.map(function (k) { return r[k] == null ? "" : r[k]; })); }) };
    }
    var kr = L.keyRows(), cr = L.ciRows();
    if (kr.length) o.key = { files: srcNames("key"), headers: ["Functional Area", "Account", "Sag", "MDEP"], rows: kr };
    if (cr.length) o.cikey = { files: srcNames("cikey"), headers: ["Commitment Item", "Description"], rows: cr };
    if (S.plan) o.plan = { files: srcNames("plan"), headers: TR.PCOLS.map(function (c) { return c[1]; }), rows: S.plan.rows.map(function (r) { return [r.fy, r.fa, r.acct, r.fm, r.amt == null ? "" : r.amt]; }) };
    return o;
  }
  function restore(D) {
    S.files = [];
    if (D.rows && D.rows.length) {
      var p = parseExport(aoa(D), D.signFlipped !== false, D.oblCalculated === true);   // saved amounts are already flipped; Obligation already calculated
      p.report.allobj = D.allobjRemoved || 0;
      S.files.push(mkEntry(nameOf(D.files, "Saved funds export"), "export", p, { srcNames: D.files }));
    }
    [["funding", parseFunding, "Saved funding file"], ["plan", TR.parsePlan, "Saved spend plan"], ["key", L.parseKey, "Saved Account Key"], ["cikey", L.parseCiKey, "Saved Commitment Item Key"]].forEach(function (x) {
      var B = D[x[0]]; if (!B) return;
      S.files.push(mkEntry(nameOf(B.files, x[2]), x[0], x[1](aoa(B)), { srcNames: B.files }));
    });
    combine();
  }
  function nameOf(files, dflt) { return files && files.length ? files.join(", ") : dflt; }

  // ---------- details report ----------
  function codes(list) { return list.map(function (m) { return "<code>" + esc(m) + "</code>"; }).join(", "); }
  function fileLines(e) {
    var h = [], warns = 0, rep = e.rep;
    if (rep.fatal) return { html: '<p class="err">' + esc(rep.fatal) + "</p>" + (rep.missing && rep.missing.length ? '<p class="muted">Missing: ' + codes(rep.missing) + "</p>" : ""), warns: 1 };
    if (e.dupOf) return { html: '<p class="warn">Same content as ' + esc(e.dupOf) + "; skipped so its amounts are not counted twice.</p>", warns: 1 };
    if (e.kind !== "export") { var fl = (e.kind === "plan" ? TR : L).fileLines(e, codes); h.push(fl.html); warns += fl.warns; }
    else {
      h.push('<p class="' + (rep.rowsLoaded ? "ok" : "err") + '">Funds export: loaded ' + plural(rep.rowsLoaded, "line") + " of " + K.fmt(rep.rowsRead) + " read (header row " + rep.headerRow + ")." + (rep.blankRows ? ' <span class="muted">' + K.fmt(rep.blankRows) + " blank row(s) ignored.</span>" : "") + "</p>");
      h.push('<p class="' + (rep.flipped ? "ok" : "muted") + '">' + (rep.flipped ? "Amounts sign-flipped (&times; &minus;1): Total Expenditure (commitment_amt_cum) and Disbursement come through negative and are shown as positive. Obligation = Total Expenditure &minus; Disbursement; obligation_amt_cum is not read." : "Amounts used as saved (already sign-flipped and calculated; not flipped or recalculated again).") + "</p>");
      var ok = rep.matched.length === COLS.length - 1;
      h.push('<p class="' + (ok ? "ok" : "warn") + '">' + rep.matched.length + " of " + (COLS.length - 1) + " columns matched.</p>");
      if (rep.negObl) { warns++; h.push('<p class="warn">' + plural(rep.negObl, "line") + " where Disbursement is larger than Total Expenditure, so the calculated Obligation is negative (kept as is). Rows: " + rep.negOblExamples.map(function (x) { return x.row + " (" + full(x.value) + ")"; }).join(", ") + (rep.negObl > rep.negOblExamples.length ? " &hellip;" : "") + "</p>"); }
      if (!ok) { warns++; h.push('<p class="warn">Missing: ' + codes(rep.missing) + "</p>"); }
      if (rep.badMonth) { warns++; h.push('<p class="warn">' + rep.badMonth + " fiscal month value(s) are not 1&ndash;12 or a month name and were treated as blank.</p>"); }
    }
    if (rep.pii) h.push('<p class="muted">' + plural(rep.pii, "personal identifier column") + " skipped without reading.</p>");
    if (rep.extra && rep.extra.length) h.push('<details class="muted"><summary>' + plural(rep.extra.length, "other column") + " ignored</summary><p class=\"muted\">" + codes(rep.extra) + "</p></details>");
    if (rep.badNumber) { warns++; h.push('<p class="warn">' + rep.badNumber + " amount cell(s) could not be read and were treated as blank. Examples: " + rep.badNumberExamples.map(function (x) { return "row " + x.row + " <code>" + esc(x.column) + "</code> = &ldquo;" + esc(x.value) + "&rdquo;"; }).join("; ") + ".</p>"); }
    return { html: h.join(""), warns: warns };
  }
  function report() {
    if (!S.files.length) return { html: "", warns: 0 };
    var h = [], warns = 0;
    S.files.forEach(function (e) {
      var fl = fileLines(e); warns += fl.warns;
      h.push('<details class="filerep"' + (fl.warns ? " open" : "") + "><summary>" + esc(e.name) + " \u00b7 " + esc(KIND_LABEL[e.kind]) + (fl.warns ? ' \u00b7 <span class="warn">' + fl.warns + " note" + (fl.warns === 1 ? "" : "s") + "</span>" : "") + "</summary>" + fl.html + "</details>");
    });
    var ex = S.files.filter(function (e) { return usable(e) && e.kind === "export"; }), fu = L.reportLines(S.fund, S.recs, DIM_KEYS); warns += fu.warns; fu.html = fu.html.replace(/TDP, AFP, Reservations and Balance/g, "TDP, AFP and Balance");
    var ciu = Object.create(null), ciList = [];
    S.recs.forEach(function (r) { if (r.ciUnm && !ciu[r.ci]) { ciu[r.ci] = 1; ciList.push(r.ci); } });
    var sh = L.ciShared();
    var ci = !L.ciInfo().size ? '<p class="muted">No Commitment Item Key loaded: commitment items show as codes.</p>'
      : '<p class="ok">Commitment Item Key: ' + plural(L.ciInfo().size, "code") + " with descriptions.</p>" + (sh.length ? '<p class="muted">' + plural(sh.length, "description") + " shared by several codes, added together: " + sh.slice(0, 10).map(function (x) { return esc(x.desc) + " (" + esc(x.codes.join(", ")) + ")"; }).join("; ") + ".</p>" : "")
        + (ciList.length ? '<p class="warn">' + plural(ciList.length, "unmapped commitment item") + " shown as the raw code: " + codes(ciList.slice(0, 15)) + ".</p>" : "");
    if (ciList.length) warns++;
    h.push('<div class="combined"><p class="ok"><strong>Combined: ' + plural(S.recs.length, "line") + " from " + plural(ex.length, "export file") + "</strong></p>" + fu.html + ci + (S.plan ? '<p class="ok">Spend plan: ' + plural(S.plan.rows.length, "row") + "." + S.files.filter(function (e) { return e.kind === "plan" && e.rep && e.rep.fyAssigned; }).map(function (e) { return " " + plural(e.rep.fyAssigned.n, "row") + " of " + esc(e.name) + " had no Fiscal Year and count for FY" + esc(e.rep.fyAssigned.fy) + " (the current fiscal year)."; }).join("") + "</p>" : '<p class="muted">No spend plan loaded (optional).</p>') + "</div>");
    return { html: h.join(""), warns: warns };
  }

  // ---------- filters ----------
  function dv(r, k) { return r[k] || BLANK; }
  function buildFilters(reset) {
    DIMS.forEach(function (d) {
      var k = d[0], vals = S.recs.map(function (r) { return dv(r, k); });
      if (S.fund && S.fund.keys.indexOf(k) >= 0) {
        var have = Object.create(null); S.recs.forEach(function (r) { have[L.kn(k, r[k])] = 1; });
        S.fund.rows.forEach(function (r) { if (!have[L.kn(k, r[k])]) vals.push(r[k] || BLANK); });
      }
      vals = K.uniq(vals).sort(function (a, b) { return a === BLANK ? 1 : b === BLANK ? -1 : cmpVal(a, b); });
      var labels = k === "fa" ? vals.map(function (v) { var a = L.acctOf(v); return a ? v + " \u00b7 " + a : v; }) : null;
      K.fillSelect($(d[1]), vals, d[3], !reset, labels);
    });
  }
  function F() { var f = {}; DIMS.forEach(function (d) { f[d[0]] = $(d[1]).value; }); return f; }
  function pass(r, f) { for (var k in f) if (f[k] && dv(r, k) !== f[k]) return false; return true; }

  // ---------- render (account-centric: Total Expenditure by Account vs TDP) ----------
  // Total Expenditure (TE) = commitment_amt_cum = Obligation + Disbursement; Balance = TDP - TE (= TDP - Obligation - Disbursement)
  var C_TE = "#2563eb", C_REM = "#cbd5e1", C_AFP = "#b45309";
  var CI_COLORS = ["#2563eb", "#0d9488", "#f59e0b", "#7c3aed", "#db2777", "#65a30d", "#ea580c", "#0891b2", "#94a3b8"];
  function money(v) { return K.money(v); }
  function docCount(rows) { var s = Object.create(null), c = 0; rows.forEach(function (r) { if (r.doc && !s[r.doc]) { s[r.doc] = 1; c++; } }); return c; }
  function te(r) { return n(r.com); }
  function r2(x) { return Math.round(x * 100) / 100; }
  // the year the page opens on: the current fiscal year whenever it has lines, else the latest earlier year
  function autoFy() {
    var years = K.uniq(S.recs.map(function (r) { return r.fy; }).filter(Boolean)).sort(), now = C.currentFy();
    return years.indexOf(now) >= 0 ? now : (years.filter(function (y) { return +y < +now; }).pop() || years[years.length - 1] || "");
  }
  function scopeFy(f, rows) { if (f.fy && f.fy !== BLANK) return f.fy; var ys = K.uniq(rows.map(function (r) { return r.fy; }).filter(Boolean)); return ys.length === 1 ? ys[0] : ""; }
  function elapsedOf(fy) { return fy ? C.fyProgress(fy).pct : null; }
  // one row per Account (funding joined across the years in scope) with its commitment items
  function accounts(rows, j, el) {
    var m = Object.create(null), out = [];
    function get(label) { var a = m[label]; if (!a) { a = m[label] = { label: label, unmapped: label === L.UNMAPPED, tdp: 0, afp: 0, funded: false, obl: 0, disb: 0, te: 0, lines: 0, ci: {} }; out.push(a); } return a; }
    if (j) j.groups.forEach(function (g) { var a = get(g.acctL); if (g.funded) { a.funded = true; a.tdp += n(g.tdp); a.afp += n(g.afp); } });
    rows.forEach(function (r) {
      var a = get(r.acctL || L.UNMAPPED); a.obl += n(r.obl); a.disb += n(r.disb); a.te += te(r); a.lines++;
      var k = r.ciL || BLANK, c = a.ci[k] || (a.ci[k] = { label: k, te: 0, obl: 0, disb: 0, lines: 0 }); c.te += te(r); c.obl += n(r.obl); c.disb += n(r.disb); c.lines++;
    });
    var info = L.keyInfo().info || {};
    out.forEach(function (a) {
      a.te = r2(a.te); a.obl = r2(a.obl); a.disb = r2(a.disb);
      var i = a.unmapped ? {} : info[L.an(a.label)] || {}; a.sag = i.sag || ""; a.mdep = i.mdep || "";
      a.bal = a.funded ? r2(a.tdp - a.te) : null; a.pct = a.funded && a.tdp ? a.te / a.tdp : null;
      a.pace = a.pct != null && el ? C.pace(a.pct, el) : { k: "na", t: "\u2014" };
      a.cis = Object.keys(a.ci).map(function (k) { return a.ci[k]; }).sort(function (x, y) { return y.te - x.te; });
    });
    return out.filter(function (a) { return a.funded || a.lines; });
  }
  function render() {
    var f = F(), rows = S.recs.filter(function (r) { return pass(r, f); }), j = L.joined(S.fund, rows, f, DIM_KEYS);
    var scope = DIMS.filter(function (d) { return f[d[0]]; }).map(function (d) { return LABEL[d[0]] + " " + f[d[0]]; });
    $("asofLabel").textContent = plural(rows.length, "line") + " \u00b7 " + plural(docCount(rows), "document");
    $("scopeLabel").textContent = scope.length ? scope.join(" \u00b7 ") : "All funds";
    var fy = scopeFy(f, rows), el = elapsedOf(fy), acc = accounts(rows, j, el);
    S.view = { f: f, fy: fy, el: el, acc: acc, j: j, rows: rows };
    kpis(rows, j, fy, el); trend(f); summary(rows, f, j, acc, fy, el);
    acctChart(acc); ciAcctChart(acc); ciSelChart(acc, f);
    acctTable();
    S.base = rows; table();
  }
  function trend(f) {
    var f2 = {}; Object.keys(f).forEach(function (k) { f2[k] = k === "fy" || k === "fm" ? "" : f[k]; });
    var scope = S.recs.filter(function (r) { return pass(r, f2); }), filtered = DIM_KEYS.some(function (k) { return f2[k]; });
    $("tMetric").value = "od";                                   // Total Expenditure = Obligation + Disbursement
    S.trend = TR.render({ rows: scope, f: f, fund: S.fund, plan: S.plan, filtered: filtered, source: "file",
      joinedFor: function (fy) { var f3 = {}; Object.keys(f2).forEach(function (k) { f3[k] = f2[k]; }); f3.fy = fy; return L.joined(S.fund, scope.filter(function (r) { return r.fy === fy; }), f3, DIM_KEYS); } });
    // shared trend code says "Obligation + Disbursement"; on this page that is Total Expenditure
    [["cCum", ["Cumulative Total Expenditure"]], ["cMon", ["Total Expenditure"]]].forEach(function (x) {
      var ch = w.Chart && w.Chart.getChart(x[0]); if (!ch || !ch.data.datasets.length) return; ch.data.datasets[0].label = x[1][0]; ch.update("none");
    });
    ["pace", "trendNote"].forEach(function (id) { var el = $(id); if (el) el.innerHTML = el.innerHTML.replace(/\s*\(?Obligation \+ Disbursement\)?/g, function (m) { return /\(/.test(m) ? " (Total Expenditure)" : " Total Expenditure"; }).replace("% of TDP spent", "% of TDP expended"); });
  }
  function kpi(lbl, val, sub, cls, title) { return '<div class="kpi' + (cls ? " " + cls : "") + '"' + (title ? ' title="' + esc(title) + '"' : "") + '><div class="lbl">' + lbl + '</div><div class="val">' + val + '</div><div class="sub">' + (sub || "&nbsp;") + "</div></div>"; }
  function needKpi(lbl, cls) { return kpi(lbl, "Not loaded", "Comes from the funding file", cls + " need"); }
  function kpis(rows, j, fy, el) {
    var t = K.sum(rows, te), h = [];
    if (j) {
      var tt = j.totals, nk = j.nonKey.length ? "Set per " + L.keyLabel(S.fund.keys) + "; not split by " + j.nonKey.map(function (k) { return LABEL[k]; }).join(", ") : "";
      h.push(kpi("TDP", money(tt.tdp), nk || (fy ? "FY" + fy + " funding" : "Full-year funding"), "tdp", full(tt.tdp)));
      h.push(kpi("AFP", money(tt.afp), "Funded to date" + (tt.tdp ? " \u00b7 " + Math.round(tt.afp / tt.tdp * 100) + "% of TDP" : ""), "afp", full(tt.afp)));
    } else { h.push(needKpi("TDP", "tdp")); h.push(needKpi("AFP", "afp")); }
    h.push(kpi("Total Expenditure", money(t), plural(rows.length, "line") + " \u00b7 " + plural(docCount(rows), "doc"), "te", full(t)));
    if (j) {
      var b = r2(j.totals.tdp - t); h.push(kpi("Balance", money(b), "TDP \u2212 Total Expenditure", "bal " + (b < 0 ? "bad" : "good"), full(b)));
      var p = j.totals.tdp ? t / j.totals.tdp : null, st = p != null && el ? C.pace(p, el) : null;
      h.push(kpi("% of TDP expended", C.pct(p), el != null ? "vs " + C.pct(el) + " of FY" + fy + " elapsed" + (st ? ' <span class="pill ' + st.k + '">' + st.t + "</span>" : "") : "Pick one fiscal year to compare with the year elapsed", "pct", p == null ? "" : (p * 100).toFixed(1) + "% expended"));
    } else { h.push(needKpi("Balance", "bal")); h.push(needKpi("% of TDP expended", "pct")); }
    $("kpis").innerHTML = h.join("");
  }
  function summary(rows, f, j, acc, fy, el) {
    if (!rows.length && !(j && j.groups.length)) { $("summary").textContent = S.recs.length ? "No lines match the current filters." : "No Status of Funds data loaded."; return; }
    var t = K.sum(rows, te), s = [];
    if (j && j.totals.tdp) s.push((fy ? "FY" + fy + ": " : "") + "Total Expenditure " + full(t) + " of TDP " + full(j.totals.tdp) + " (" + C.pct(t / j.totals.tdp) + (el != null ? " with " + C.pct(el) + " of the year elapsed" : "") + "); balance " + full(r2(j.totals.tdp - t)) + ".");
    else s.push("Total Expenditure " + full(t) + " across " + plural(rows.length, "line") + ".");
    var funded = acc.filter(function (a) { return a.pct != null; });
    if (funded.length > 1 && !f.acctL) {
      var hi = funded.slice().sort(function (a, b) { return b.pct - a.pct; })[0]; s.push("Highest % expended: " + hi.label + " at " + C.pct(hi.pct) + ".");
      var over = funded.filter(function (a) { return a.pace.k === "over"; }), neg = funded.filter(function (a) { return a.bal < 0; });
      if (el != null) s.push(plural(over.length, "account") + " over pace, " + funded.filter(function (a) { return a.pace.k === "under"; }).length + " under, " + funded.filter(function (a) { return a.pace.k === "on"; }).length + " on pace.");
      if (neg.length) s.push(plural(neg.length, "account") + " " + (neg.length === 1 ? "is" : "are") + " over TDP.");
    }
    var one = f.acctL ? acc.filter(function (a) { return a.label === f.acctL; })[0] : null, cis = one ? one.cis : null;
    if (!cis) { var m = {}; rows.forEach(function (r) { var k = r.ciL || BLANK; m[k] = (m[k] || 0) + te(r); }); cis = Object.keys(m).map(function (k) { return { label: k, te: m[k] }; }).sort(function (a, b) { return b.te - a.te; }); }
    if (cis.length > 1 && cis[0].te > 0 && !f.ciL) s.push("Largest commitment item" + (one ? " in " + one.label : "") + ": " + cis[0].label + " (" + money(cis[0].te) + ", " + Math.round(cis[0].te / (t || 1) * 100) + "%).");
    $("summary").textContent = s.join(" ");
  }
  function moneyAxis(o, ax) { o.scales[ax].ticks = { callback: function (v) { return money(v); } }; o.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + full(c.raw); } }; return o; }
  function sizeBox(id, count) { var box = $(id).parentNode; box.style.height = Math.max(220, 56 + count * 30) + "px"; }
  function pickAcct(label) { if (!label || !Array.prototype.some.call($("fAcct").options, function (o) { return o.value === label; })) return; $("fAcct").value = $("fAcct").value === label ? "" : label; S.showAll = false; render(); }
  function sortedAcc(acc) {
    var by = $("acctSort").value || "te";
    return acc.slice().sort(function (a, b) { return by === "pct" ? (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct) || b.te - a.te : b.te - a.te || cmpVal(a.label, b.label); });
  }
  // primary chart: TE vs TDP per Account (TE + remaining = TDP), AFP marker, % expended in the label
  function acctChart(acc) {
    var list = sortedAcc(acc); sizeBox("cAcctTe", list.length);
    var o = moneyAxis(K.chartBase(), "x"); o.indexAxis = "y"; o.scales.x.stacked = true; o.scales.y.stacked = true;
    o.plugins.tooltip.mode = "index"; o.plugins.tooltip.intersect = false;
    o.plugins.tooltip.callbacks = {
      title: function (it) { return list[it[0].dataIndex].label; },
      label: function () { return null; },
      afterBody: function (it) { var a = list[it[0].dataIndex]; return ["Total Expenditure: " + full(a.te), "TDP: " + (a.funded ? full(a.tdp) : "no funding row"), "AFP: " + (a.funded ? full(a.afp) : "\u2014"), "% expended: " + C.pct(a.pct, 1), "Remaining: " + (a.bal == null ? "\u2014" : full(a.bal)), "Pace: " + a.pace.t]; }
    };
    o.onClick = function (e, els) { if (els.length) pickAcct(list[els[0].index].label); };
    o.onHover = function (e, els) { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
    var labels = list.map(function (a) { return a.label + (a.pct != null ? "  \u00b7 " + C.pct(a.pct) : ""); });
    K.upsert("cAcctTe", { type: "bar", data: { labels: labels, datasets: [
      { label: "Total Expenditure", data: list.map(function (a) { return a.te; }), backgroundColor: list.map(function (a) { return a.bal != null && a.bal < 0 ? "#dc2626" : C_TE; }), stack: "s" },
      { label: "Remaining (TDP \u2212 TE)", data: list.map(function (a) { return a.bal != null && a.bal > 0 ? a.bal : 0; }), backgroundColor: C_REM, stack: "s" },
      { type: "line", label: "AFP", indexAxis: "y", data: list.map(function (a) { return a.funded ? a.afp : null; }), showLine: false, pointStyle: "line", pointRotation: 90, pointRadius: 11, pointHoverRadius: 14, borderWidth: 4, borderColor: C_AFP, backgroundColor: C_AFP }
    ] }, options: o });
    $("acctNote").textContent = list.length ? "Bar = TDP: blue is Total Expenditure, grey is what remains (red = over TDP). Orange tick = AFP. Click an account to filter the page to it." : "";
  }
  function ciTop(acc) {
    var m = {}; acc.forEach(function (a) { a.cis.forEach(function (c) { m[c.label] = (m[c.label] || 0) + c.te; }); });
    var keys = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
    return keys.length > 9 ? keys.slice(0, 8) : keys;
  }
  // commitment items within accounts: stacked TE per Account, one segment per commitment item description
  function ciAcctChart(acc) {
    var list = sortedAcc(acc).filter(function (a) { return a.te; }), top = ciTop(list), other = list.some(function (a) { return a.cis.some(function (c) { return top.indexOf(c.label) < 0; }); });
    sizeBox("cCiAcct", list.length);
    var o = moneyAxis(K.chartBase(), "x"); o.indexAxis = "y"; o.scales.x.stacked = true; o.scales.y.stacked = true;
    o.onClick = function (e, els) { if (els.length) pickAcct(list[els[0].index].label); };
    o.onHover = function (e, els) { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
    var ds = top.map(function (k, i) { return { label: k, data: list.map(function (a) { return a.ci[k] ? r2(a.ci[k].te) : 0; }), backgroundColor: CI_COLORS[i % CI_COLORS.length] }; });
    if (other) ds.push({ label: "Other items", data: list.map(function (a) { return r2(a.cis.filter(function (c) { return top.indexOf(c.label) < 0; }).reduce(function (s, c) { return s + c.te; }, 0)); }), backgroundColor: "#cbd5e1" });
    K.upsert("cCiAcct", { type: "bar", data: { labels: list.map(function (a) { return a.label; }), datasets: ds }, options: o });
  }
  // breakdown for the selected account (or all accounts): TE by commitment item; click filters to the item
  function ciSelChart(acc, f) {
    var one = f.acctL ? acc.filter(function (a) { return a.label === f.acctL; })[0] : null, cis;
    if (one) cis = one.cis.slice();
    else { var m = {}; acc.forEach(function (a) { a.cis.forEach(function (c) { var x = m[c.label] || (m[c.label] = { label: c.label, te: 0 }); x.te += c.te; }); }); cis = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.te - a.te; }); }
    if (cis.length > TOPN + 1) { var rest = cis.slice(TOPN); cis = cis.slice(0, TOPN).concat([{ label: "Other (" + rest.length + ")", te: rest.reduce(function (s, c) { return s + c.te; }, 0), other: true }]); }
    $("ciSelTitle").textContent = "Commitment items \u00b7 " + (one ? one.label : "all accounts");
    var tot = cis.reduce(function (s, c) { return s + c.te; }, 0) || 1;
    sizeBox("cCi", cis.length);
    var o = moneyAxis(K.chartBase(), "x"); o.indexAxis = "y";
    o.plugins.tooltip.callbacks = { label: function (c) { return "Total Expenditure: " + full(c.raw) + " (" + Math.round(c.raw / tot * 100) + "%)"; } };
    o.onClick = function (e, els) { if (!els.length) return; var x = cis[els[0].index]; if (!x || x.other) return; $("fCi").value = $("fCi").value === x.label ? "" : x.label; S.showAll = false; render(); };
    o.onHover = function (e, els) { e.native.target.style.cursor = els.length && cis[els[0].index] && !cis[els[0].index].other ? "pointer" : "default"; };
    K.upsert("cCi", { type: "bar", data: { labels: cis.map(function (c) { return c.label; }), datasets: [{ label: "Total Expenditure", data: cis.map(function (c) { return r2(c.te); }), backgroundColor: C_TE }] }, options: o });
  }
  // account table: sortable, each account expands to its commitment items (TE, with Obligation / Disbursement as secondary columns)
  var ACOLS = [["label", "Account", "text"], ["sag", "Sag", "text"], ["mdep", "MDEP", "text"], ["tdp", "TDP", "money"], ["afp", "AFP", "money"], ["te", "Total Expenditure", "money"],
    ["bal", "Balance", "money"], ["pct", "% expended", "pct"], ["pace", "Pace", "pace"], ["obl", "Obligation", "money2"], ["disb", "Disbursement", "money2"]];
  function acctSorted() {
    var k = S.asort.k, dir = S.asort.dir, acc = (S.view && S.view.acc) || [];
    return acc.slice().sort(function (a, b) {
      var x = k === "pace" ? (a.pace.r || 0) - (b.pace.r || 0) : ACOLS.filter(function (c) { return c[0] === k; })[0][2] === "text" ? cmpVal(a[k] || "", b[k] || "") : (a[k] == null ? -Infinity : a[k]) - (b[k] == null ? -Infinity : b[k]);
      return x * dir || b.te - a.te;
    });
  }
  function acctTable() {
    var rows = acctSorted(), dash = '<span class="muted">\u2014</span>', t = $("tAcct");
    t.tHead.innerHTML = "<tr>" + ACOLS.map(function (c) { var on = S.asort.k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[2] === "text" || c[2] === "pace" ? "" : "num") + (c[2] === "money2" ? " sec" : "") + (on ? " sorted" + (S.asort.dir > 0 ? " asc" : "") : "") + '">' + c[1] + "</th>"; }).join("") + "</tr>";
    function mcell(v, cls) { return '<td class="num' + (cls || "") + (v != null && v < 0 ? " neg" : "") + '">' + (v == null ? dash : full(v)) + "</td>"; }
    var h = [];
    rows.forEach(function (a) {
      var open = !!S.open[a.label];
      h.push('<tr class="arow' + (open ? " open" : "") + '" data-a="' + esc(a.label) + '"><td><button class="caret" type="button" aria-label="Show commitment items" data-x="' + esc(a.label) + '">' + (open ? "\u25be" : "\u25b8") + '</button><button class="alink" type="button" data-f="' + esc(a.label) + '">' + (a.unmapped ? '<span class="flag">Unmapped</span>' : esc(a.label)) + "</button></td>" +
        "<td>" + (a.sag ? esc(a.sag) : dash) + "</td><td>" + (a.mdep ? esc(a.mdep) : dash) + "</td>" +
        (a.funded ? mcell(a.tdp) + mcell(a.afp) : '<td class="num"><span class="muted">no funding row</span></td><td class="num">' + dash + "</td>") +
        mcell(a.te) + (a.funded ? mcell(a.bal, a.bal < 0 ? " cf-bad" : "") : '<td class="num">' + dash + "</td>") +
        '<td class="num">' + (a.pct == null ? dash : '<span class="xbar"><i style="width:' + Math.min(100, a.pct * 100).toFixed(1) + '%"></i></span>' + C.pct(a.pct, 1)) + "</td>" +
        "<td>" + (a.pace.k === "na" ? dash : '<span class="pill ' + a.pace.k + '">' + a.pace.t + "</span>") + "</td>" + mcell(a.obl, " sec") + mcell(a.disb, " sec") + "</tr>");
      if (open) a.cis.forEach(function (c) {
        h.push('<tr class="cirow"><td class="ci" colspan="5">' + esc(c.label) + ' <span class="muted">\u00b7 ' + plural(c.lines, "line") + "</span></td>" + mcell(r2(c.te)) + '<td></td><td class="num muted">' + (a.te ? Math.round(c.te / a.te * 100) + "% of account" : "") + "</td><td></td>" + mcell(r2(c.obl), " sec") + mcell(r2(c.disb), " sec") + "</tr>");
      });
    });
    t.tBodies[0].innerHTML = h.length ? h.join("") : '<tr><td colspan="' + ACOLS.length + '" class="muted">Nothing matches the current filters.</td></tr>';
    var tot = { tdp: 0, afp: 0, te: 0, obl: 0, disb: 0 }, anyF = false;
    rows.forEach(function (a) { tot.te += a.te; tot.obl += a.obl; tot.disb += a.disb; if (a.funded) { anyF = true; tot.tdp += a.tdp; tot.afp += a.afp; } });
    t.tFoot.innerHTML = rows.length ? "<tr><td colspan=\"3\">Total (" + plural(rows.length, "account") + ")</td>" + (anyF ? mcell(r2(tot.tdp)) + mcell(r2(tot.afp)) : "<td></td><td></td>") + mcell(r2(tot.te)) +
      (anyF ? mcell(r2(tot.tdp - tot.te)) : "<td></td>") + '<td class="num">' + (anyF && tot.tdp ? C.pct(tot.te / tot.tdp, 1) : "") + "</td><td></td>" + mcell(r2(tot.obl), " sec") + mcell(r2(tot.disb), " sec") + "</tr>" : "";
    $("acctTableNote").textContent = "One row per Account" + (S.view && S.view.fy ? " for FY" + S.view.fy : " across the years in scope") + ". Balance = TDP \u2212 Total Expenditure. Pace compares % expended with " + (S.view && S.view.el != null ? C.pct(S.view.el) + " of the fiscal year elapsed (\u00b110% = on pace)" : "the year elapsed once one fiscal year is selected") + ". \u25b8 shows the commitment items; click an account name to filter the page.";
  }
  function acctCsv() {
    var head = ["Row", "Account", "Commitment Item", "Sag", "MDEP", "TDP", "AFP", "Total Expenditure", "Balance", "% expended", "Pace", "Obligation", "Disbursement"], out = [];
    function m(v) { return v == null ? "" : v.toFixed(2); }
    acctSorted().forEach(function (a) {
      out.push(["Account", a.label, "", a.sag, a.mdep, a.funded ? m(a.tdp) : "", a.funded ? m(a.afp) : "", m(a.te), m(a.bal), a.pct == null ? "" : (a.pct * 100).toFixed(1), a.pace.k === "na" ? "" : a.pace.t, m(a.obl), m(a.disb)]);
      a.cis.forEach(function (c) { out.push(["Commitment item", a.label, c.label, a.sag, a.mdep, "", "", m(r2(c.te)), "", "", "", m(r2(c.obl)), m(r2(c.disb))]); });
    });
    K.downloadCsv("status_of_funds_accounts_" + stamp() + ".csv", head, out);
  }

  // ---------- line table ----------
  function match(r, q) { return TEXT_KEYS.some(function (k) { return r[k] && String(r[k]).toLowerCase().indexOf(q) >= 0; }); }
  function isMoney(k) { return TCOLS.filter(function (c) { return c[0] === k; })[0][2] === "money"; }
  function tcell(r, c) {
    var v = r[c[0]], t = c[2], flag = ' <span class="flag">Unmapped</span>', dash = '<span class="muted">\u2014</span>';
    if (t === "money") return '<td class="num' + (v < 0 ? " neg" : "") + '">' + (v == null ? dash : full(v)) + "</td>";
    if (t === "ciL") return '<td title="' + esc(r.ci) + '">' + (r.ciUnm ? esc(r.ci) + flag : v ? esc(v) : dash) + "</td>";
    if (t === "acct" || t === "keyed") return "<td>" + (r.acct ? (v ? esc(v) : dash) : (r.fa ? '<span class="flag">Unmapped</span>' : dash)) + "</td>";
    return "<td>" + (v ? esc(v) : dash) + "</td>";
  }
  function table() {
    var q = ($("fSearch").value || "").trim().toLowerCase(), rows = S.base || [];
    if (q) rows = rows.filter(function (r) { return match(r, q); });
    var k = S.sort.k, dir = S.sort.dir, m = isMoney(k);
    rows = rows.slice().sort(function (a, b) { var x = m ? n(a[k]) - n(b[k]) : cmpVal(a[k] || "", b[k] || ""); return x * dir || cmpVal(a.doc, b.doc); });
    S.shown = rows;
    $("searchNote").textContent = q ? K.fmt(rows.length) + " of " + K.fmt(S.base.length) + " lines match \u201c" + $("fSearch").value.trim() + "\u201d" : "";
    $("tDocs").tHead.innerHTML = "<tr>" + TCOLS.map(function (c) { var on = S.sort.k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[2] === "money" ? "num" : "") + (on ? " sorted" + (S.sort.dir > 0 ? " asc" : "") : "") + '">' + esc(c[1]) + "</th>"; }).join("") + "</tr>";
    var show = rows.slice(0, S.showAll ? MAXROWS : PAGE);
    $("tDocs").tBodies[0].innerHTML = show.length ? show.map(function (r) { return "<tr>" + TCOLS.map(function (c) { return tcell(r, c); }).join("") + "</tr>"; }).join("")
      : '<tr><td colspan="' + TCOLS.length + '" class="muted">' + (q ? "No lines match the search." : "No lines match the current filters.") + "</td></tr>";
    var tot = {}; ["obl", "com", "disb"].forEach(function (x) { tot[x] = K.sum(rows, function (r) { return n(r[x]); }); });
    $("tDocs").tFoot.innerHTML = rows.length ? "<tr>" + TCOLS.map(function (c, i) { return tot[c[0]] != null ? '<td class="num">' + full(tot[c[0]]) + "</td>" : i === 0 ? "<td>Total (" + plural(rows.length, "line") + (rows.length > show.length ? ", " + K.fmt(show.length) + " shown" : "") + ")</td>" : "<td></td>"; }).join("") + "</tr>" : "";
    var btn = $("btnAll"); btn.style.display = rows.length > PAGE ? "" : "none";
    btn.textContent = S.showAll ? "Show " + PAGE : rows.length > MAXROWS ? "Show first " + K.fmt(MAXROWS) : "Show all " + K.fmt(rows.length);
  }
  function stamp() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function exportCsv() {
    K.downloadCsv("status_of_funds_lines_" + stamp() + ".csv", TCOLS.map(function (c) { return c[1]; }),
      (S.shown || []).map(function (r) { return TCOLS.map(function (c) { var v = r[c[0]]; return v == null ? "" : c[2] === "money" ? v.toFixed(2) : c[2] === "ciL" && r.ciUnm ? r.ci + " (Unmapped)" : v; }); }));
  }

  // ---------- home overview: the year the page opens on, TDP / TE / Balance and the accounts furthest along ----------
  function homeSummary() {
    if (!S.recs.length && !S.fund) return null;
    var fy = autoFy(), rows = S.recs.filter(function (r) { return r.fy === fy; }), j = S.fund ? L.joined(S.fund, rows, { fy: fy }, DIM_KEYS) : null;
    var el = elapsedOf(fy), t = r2(K.sum(rows, te)), acc = accounts(rows, j, el).filter(function (a) { return a.pct != null; }).sort(function (a, b) { return b.pct - a.pct; });
    return { fy: fy, te: t, lines: rows.length, tdp: j ? j.totals.tdp : null, afp: j ? j.totals.afp : null, bal: j ? r2(j.totals.tdp - t) : null, elapsed: el, pct: j && j.totals.tdp ? t / j.totals.tdp : null, top: acc.slice(0, 5) };
  }

  // ---------- feed for the Spend Plans page: Total Expenditure per account and fiscal month, exactly as this page counts it
  // (sign-flipped, ALLOBJ rows removed, Functional Area -> Account through the Account Key). Each line's cumulative-to-date
  // amount is counted once, in its own fiscal month, so a year's months add up to the year's Total Expenditure.
  function feed() {
    var act = [], nm = {};
    S.recs.forEach(function (r) {
      if (!r.fy) return;
      if (!r.fmn) { var x = nm[r.fy] = nm[r.fy] || { lines: 0, te: 0 }; x.lines++; x.te = r2(x.te + te(r)); return; }
      act.push({ fy: r.fy, acct: r.acctL || L.UNMAPPED, fm: r.fmn, te: te(r) });
    });
    var plan = S.plan ? S.plan.rows.filter(function (r) { return r.fm && r.amt != null && !isNaN(r.amt); }).map(function (r) {
      return { fy: r.fy || "", acct: r.acct || L.acctOf(r.fa) || r.fa || L.UNMAPPED, fm: +r.fm, amt: n(r.amt) };
    }) : [];
    return { actual: act, noMonth: nm, plan: plan, planFiles: S.plan ? S.plan.files : [], fy: autoFy() };
  }

  // ---------- page registration ----------
  C.register("sof", {
    feed: feed,
    classify: function (src) { var c = L.classify(src, ALIAS); return c.kind ? c : null; },
    parse: function (kind, src, fname, ws, name) { return mkEntry(name, kind, parseAs(kind, src)); },
    ingest: ingest, clear: clear, demo: demo, snapshot: snapshot, restore: restore, report: report, render: render,
    entries: function () { return S.files; }, hasData: function () { return S.recs.length > 0 || !!S.fund; }, summary: homeSummary,
    init: function () {
      ["tFy", "tMetric"].forEach(function (id) { $(id).addEventListener("change", render); });
      DIMS.forEach(function (d) { $(d[1]).addEventListener("change", function () { S.showAll = false; render(); }); });
      $("btnReset").addEventListener("click", function () { DIMS.forEach(function (d) { $(d[1]).value = ""; }); $("fSearch").value = ""; S.showAll = false; render(); });
      $("btnCsv").addEventListener("click", exportCsv);
      $("btnAcctCsv").addEventListener("click", acctCsv);
      $("acctSort").addEventListener("change", render);
      $("tAcct").tHead.addEventListener("click", function (e) { var th = e.target.closest("th[data-k]"); if (!th) return; var k = th.getAttribute("data-k"); S.asort = S.asort.k === k ? { k: k, dir: -S.asort.dir } : { k: k, dir: k === "label" || k === "sag" || k === "mdep" ? 1 : -1 }; acctTable(); });
      $("tAcct").tBodies[0].addEventListener("click", function (e) {
        var x = e.target.closest("[data-x]"); if (x) { var k = x.getAttribute("data-x"); S.open[k] = !S.open[k]; acctTable(); return; }
        var fl = e.target.closest("[data-f]"); if (fl) pickAcct(fl.getAttribute("data-f"));
      });
      var st; $("fSearch").addEventListener("input", function () { clearTimeout(st); st = setTimeout(table, 120); });
      $("btnAll").addEventListener("click", function () { S.showAll = !S.showAll; table(); });
      $("tDocs").tHead.addEventListener("click", function (e) {
        var th = e.target.closest("th[data-k]"); if (!th) return; var k = th.getAttribute("data-k");
        S.sort = S.sort.k === k ? { k: k, dir: -S.sort.dir } : { k: k, dir: isMoney(k) ? -1 : 1 }; table();
      });
    },
    _state: S
  });
})(window);
