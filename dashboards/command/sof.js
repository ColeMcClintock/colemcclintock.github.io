/* Aviation Dashboard: Status of Funds page. Port of dashboards/finance/finance.js (same schema and math) using the shared
   FundsLib (funding.js) and FundsTrend (plan.js). Everything runs in this browser tab; nothing is uploaded. */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, TR = w.FundsTrend, C = w.CMD, $ = K.$, esc = K.esc;
  // ===== CONFIG =====
  // The GFEBS export carries commitments (Total Expenditure) and disbursements as negative numbers.
  // true = multiply commitment_amt_cum and disbursement_amt_cum by -1 when the export is read.
  // Aviation dashboard: Obligation is CALCULATED, obligation_amt_cum is not read.
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
    ["obl", "Obligation", "money"], ["com", "Total Expenditure", "money"], ["disb", "Disbursement", "money"]];
  var ALIAS = L.aliasMap(COLS);
  var DIMS = [["fy", "fFy", "cFy", "All years"], ["appn", "fAppn", "cAppn", "All"], ["sag", "fSag", "cSag", "All"], ["mdep", "fMdep", "cMdep", "All"], ["acctL", "fAcct", "cAcct", "All"], ["fa", "fFa", null, "All"], ["ciL", "fCi", "cCi", "All"], ["fm", "fFm", null, "All months"]];
  var DIM_KEYS = DIMS.map(function (d) { return d[0]; });
  var TEXT_KEYS = ["doc", "ci", "ciL", "fa", "acctL", "appn", "fy", "fm", "sag", "mdep"];
  var TOPN = 10, C_TDP = "#b08968", C_OBL = "#3b82f6", C_DISB = "#84cc16", C_BAL = "#16a34a";
  var KIND_LABEL = { "export": "Funds export", funding: "Funding file", plan: "Spend plan", key: "Account Key", cikey: "Commitment Item Key" };
  var S = { files: [], recs: [], fund: null, plan: null, allobj: 0, showAll: false, sort: { k: "obl", dir: -1 }, shown: [], order: 0 };

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
  // Aviation dashboard: no Reservations. The funding file is Fiscal Year, Account, TDP, AFP; a Reservations column is ignored.
  function parseFunding(src) {
    var p = L.parseFunding(src), r = p.report;
    p.rows.forEach(function (row) { delete row.res; });
    r.amts = (r.amts || []).filter(function (k) { return k !== "res"; });
    r.missing = (r.missing || []).filter(function (m) { return m !== "Reservations"; });
    if (r.fatal) r.fatal = r.fatal.replace("TDP, AFP or Reservations", "TDP or AFP");
    else if (!r.amts.length) { r.fatal = "No TDP or AFP column was found."; p.rows = []; r.rowsLoaded = 0; }
    return p;
  }
  function fundTable(j) {   // shared funding table without its Reservations column
    L.table.render(S.fund, j);
    var fn = $("fundNote"); if (fn) fn.textContent = fn.textContent.replace("TDP \u2212 Reservations \u2212 Obligation", "TDP \u2212 Obligation");
    var t = $("tFund"), th = t.tHead.querySelector('th[data-k="res"]'); if (!th) return;
    var i = Array.prototype.indexOf.call(th.parentNode.children, th);
    [t.tHead, t.tBodies[0], t.tFoot].forEach(function (sec) { Array.prototype.forEach.call(sec.rows, function (tr) { if (tr.cells.length > i && !(tr.cells.length === 1 && tr.cells[0].colSpan > 1)) tr.deleteCell(i); }); });
  }
  function fundCsv() {   // same CSV as the shared table, minus Reservations
    var dl = K.downloadCsv;
    K.downloadCsv = function (name, head, rows) { var i = head.indexOf("Reservations"); if (i >= 0) { head = head.filter(function (x, k) { return k !== i; }); rows = rows.map(function (r) { return r.filter(function (x, k) { return k !== i; }); }); } return dl.call(K, name, head, rows); };
    try { L.table.exportCsv(); } finally { K.downloadCsv = dl; }
  }
  function parseAs(kind, src, noFlip) { return kind === "funding" ? parseFunding(src) : kind === "plan" ? TR.parsePlan(src) : kind === "key" ? L.parseKey(src) : kind === "cikey" ? L.parseCiKey(src) : parseExport(src, noFlip); }
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
  }
  function aoa(t) { return L.aoaSource([t.headers].concat(t.rows)); }
  function demo() {
    var D = w.FUNDS_DEMO; if (!D) return;
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
    h.push('<div class="combined"><p class="ok"><strong>Combined: ' + plural(S.recs.length, "line") + " from " + plural(ex.length, "export file") + "</strong></p>" + fu.html + ci + (S.plan ? '<p class="ok">Spend plan: ' + plural(S.plan.rows.length, "row") + ".</p>" : '<p class="muted">No spend plan loaded (optional).</p>') + "</div>");
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

  // ---------- render ----------
  function money(v) { return K.money(v); }
  function docCount(rows) { var s = Object.create(null), c = 0; rows.forEach(function (r) { if (r.doc && !s[r.doc]) { s[r.doc] = 1; c++; } }); return c; }
  function render() {
    var f = F(), rows = S.recs.filter(function (r) { return pass(r, f); }), j = L.joined(S.fund, rows, f, DIM_KEYS);
    var scope = DIMS.filter(function (d) { return f[d[0]]; }).map(function (d) { return LABEL[d[0]] + " " + f[d[0]]; });
    $("asofLabel").textContent = plural(rows.length, "line") + " \u00b7 " + plural(docCount(rows), "document");
    $("scopeLabel").textContent = scope.length ? scope.join(" \u00b7 ") : "All funds";
    kpis(rows, j); position(rows, j); trend(f); summary(rows, f, j);
    DIMS.forEach(function (d) { chart(d, rows, j); });
    fundTable(j);
    S.base = rows; table();
  }
  function trend(f) {
    var f2 = {}; Object.keys(f).forEach(function (k) { f2[k] = k === "fy" || k === "fm" ? "" : f[k]; });
    var scope = S.recs.filter(function (r) { return pass(r, f2); }), filtered = DIM_KEYS.some(function (k) { return f2[k]; });
    S.trend = TR.render({ rows: scope, f: f, fund: S.fund, plan: S.plan, filtered: filtered, source: "file",
      joinedFor: function (fy) { var f3 = {}; Object.keys(f2).forEach(function (k) { f3[k] = f2[k]; }); f3.fy = fy; return L.joined(S.fund, scope.filter(function (r) { return r.fy === fy; }), f3, DIM_KEYS); } });
  }
  function kpi(lbl, val, sub, cls, title) { return '<div class="kpi' + (cls ? " " + cls : "") + '"' + (title ? ' title="' + esc(title) + '"' : "") + '><div class="lbl">' + lbl + '</div><div class="val">' + val + '</div><div class="sub">' + (sub || "&nbsp;") + "</div></div>"; }
  function needKpi(lbl, cls) { return kpi(lbl, "Not loaded", "Comes from the funding file", cls + " need"); }
  function kpis(rows, j) {
    var o = K.sum(rows, function (r) { return n(r.obl); }), d = K.sum(rows, function (r) { return n(r.disb); }), h = [];
    if (j) {
      var t = j.totals, nk = j.nonKey.length ? "Set per " + L.keyLabel(S.fund.keys) + "; not split by " + j.nonKey.map(function (k) { return LABEL[k]; }).join(", ") : "";
      h.push(kpi("TDP", money(t.tdp), nk || "Full-year funding", "tdp", full(t.tdp)));
      h.push(kpi("AFP", money(t.afp), "Funded to date" + (t.tdp ? " \u00b7 " + Math.round(t.afp / t.tdp * 100) + "% of TDP" : ""), "afp", full(t.afp)));
    } else { h.push(needKpi("TDP", "tdp")); h.push(needKpi("AFP", "afp")); }
    h.push(kpi("Obligation", money(o), plural(rows.length, "line") + " \u00b7 " + plural(docCount(rows), "doc"), "obl", full(o)));
    h.push(kpi("Disbursement", money(d), "Total Expenditure " + money(o + d), "disb", full(d)));
    if (j) { var b = j.totals.bal; h.push(kpi("Balance", money(b), "TDP \u2212 Oblig. \u2212 Disb.", "bal " + (b < 0 ? "bad" : "good"), full(b))); }
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
    j.groups.forEach(function (x) { var key = L.kn(k, x[k]), g = m[key]; if (!g) { g = m[key] = { label: x[k] || BLANK, obl: 0, disb: 0, tdp: 0, lines: 0 }; out.push(g); } g.obl += x.obl; g.disb += x.disb; g.tdp += n(x.tdp); g.lines += x.lines; });
    return out;
  }
  function mag(g) { return Math.max(Math.abs(g.obl), Math.abs(g.disb), Math.abs(n(g.tdp))); }
  function summary(rows, f, j) {
    if (!rows.length && !(j && j.groups.length)) { $("summary").textContent = S.recs.length ? "No lines match the current filters." : "No Status of Funds data loaded."; return; }
    var o = K.sum(rows, function (r) { return n(r.obl); }), d = K.sum(rows, function (r) { return n(r.disb); }), s = [];
    s.push(plural(rows.length, "line") + " across " + plural(docCount(rows), "document") + ": Obligation " + full(o) + " and Disbursement " + full(d) + ".");
    if (j) {
      var t = j.totals;
      s.push("TDP " + full(t.tdp) + ", AFP " + full(t.afp) + "; Balance (TDP \u2212 Obligation \u2212 Disbursement) " + full(t.bal) + ".");
      var neg = j.groups.filter(function (g) { return g.funded && g.bal < 0; }).sort(function (a, b) { return a.bal - b.bal; });
      if (neg.length) s.push(plural(neg.length, "account") + " " + (neg.length === 1 ? "has" : "have") + " a negative balance; the largest is " + (neg[0].label || neg[0].acct) + (neg[0].fy ? " (FY" + neg[0].fy + ")" : "") + " at " + full(neg[0].bal) + ".");
      if (t.unfundedLines) s.push(plural(t.unfundedLines, "line") + " (" + money(t.unfundedObl) + " obligated) have no matching funding row.");
    }
    if (S.trend && S.trend.tdp) { var sp = S.trend.total / S.trend.tdp; s.push("FY" + S.trend.fy + ": " + Math.round(sp * 100) + "% of TDP spent with " + Math.round(S.trend.elapsed / 12 * 100) + "% of the year elapsed."); }
    if (!f.ciL) { var g = group(rows, "ciL").sort(function (a, b) { return b.obl - a.obl; }); if (g.length > 1 && g[0].obl > 0) s.push("Largest commitment item by obligation: " + g[0].label + " (" + money(g[0].obl) + ", " + Math.round(g[0].obl / (o || 1) * 100) + "%)."); }
    $("summary").textContent = s.join(" ");
  }
  function moneyAxis(o, ax) { o.scales[ax].ticks = { callback: function (v) { return money(v); } }; o.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + full(c.raw); } }; return o; }
  function position(rows, j) {
    var o = moneyAxis(K.chartBase(), "x"); o.indexAxis = "y"; o.scales.x.stacked = true; o.scales.y.stacked = true;
    var ob = K.sum(rows, function (r) { return n(r.obl); }), di = K.sum(rows, function (r) { return n(r.disb); }), t = j ? j.totals : null;
    var ds = [{ label: "Obligation", data: [ob], backgroundColor: C_OBL }, { label: "Disbursement", data: [di], backgroundColor: C_DISB }];
    if (t) { ds.push({ label: "Balance", data: [Math.max(0, t.bal)], backgroundColor: C_BAL }); }
    K.upsert("cPos", { type: "bar", data: { labels: [t ? "TDP " + money(t.tdp) : "Spent"], datasets: ds }, options: o });
    $("posNote").textContent = t ? (t.bal < 0 ? "Over TDP by " + full(-t.bal) + "." : full(t.bal) + " left (" + (t.tdp ? Math.round(t.bal / t.tdp * 100) : 0) + "% of TDP).") : "";
  }
  function chart(d, rows, j) {
    if (!d[2]) return;
    var k = d[0], horiz = k !== "fy" && k !== "appn", withTdp = j && S.fund.keys.indexOf(k === "acctL" ? "acct" : k) >= 0 && S.fund.amts.indexOf("tdp") >= 0;
    var g = withTdp ? groupJoined(j, k) : group(rows, k);
    if (k === "fy") g.sort(function (a, b) { return a.label === BLANK ? 1 : b.label === BLANK ? -1 : cmpVal(a.label, b.label); });
    else {
      g.sort(function (a, b) { return mag(b) - mag(a) || cmpVal(a.label, b.label); });
      if (g.length > TOPN + 1) {
        var rest = g.slice(TOPN), oth = { label: "Other (" + rest.length + ")", obl: 0, disb: 0, tdp: 0, other: true };
        rest.forEach(function (x) { oth.obl += x.obl; oth.disb += x.disb; oth.tdp += n(x.tdp); });
        g = g.slice(0, TOPN).concat([oth]);
      }
    }
    var o = moneyAxis(K.chartBase(), horiz ? "x" : "y");
    if (horiz) o.indexAxis = "y";
    o.onClick = function (e, els) { if (!els.length) return; var x = g[els[0].index]; if (!x || x.other) return; $(d[1]).value = x.label; S.showAll = false; render(); };
    o.onHover = function (e, els) { e.native.target.style.cursor = els.length && g[els[0].index] && !g[els[0].index].other ? "pointer" : "default"; };
    var ds = [];
    if (withTdp) ds.push({ label: "TDP", data: g.map(function (x) { return x.tdp; }), backgroundColor: C_TDP });
    ds.push({ label: "Obligation", data: g.map(function (x) { return x.obl; }), backgroundColor: C_OBL });
    ds.push({ label: "Disbursement", data: g.map(function (x) { return x.disb; }), backgroundColor: C_DISB });
    if (withTdp) ds.push({ label: "Balance", data: g.map(function (x) { return x.other ? null : n(x.tdp) - x.obl - x.disb; }), backgroundColor: C_BAL });
    K.upsert(d[2], { type: "bar", data: { labels: g.map(function (x) { return x.label; }), datasets: ds }, options: o });
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

  // ---------- home overview: the year the trend would pick (current FY once it has 2 months, else the latest earlier year) ----------
  function homeSummary() {
    if (!S.recs.length && !S.fund) return null;
    var years = K.uniq(S.recs.map(function (r) { return r.fy; }).filter(Boolean)).sort(), now = L.fiscalNow(new Date()), mby = {};
    S.recs.forEach(function (r) { if (r.fy && r.fmn) { mby[r.fy] = mby[r.fy] || {}; mby[r.fy][r.fmn] = 1; } });
    var fy = years.indexOf(now.fy) >= 0 && Object.keys(mby[now.fy] || {}).length >= 2 ? now.fy : (years.filter(function (y) { return +y < +now.fy; }).pop() || years[years.length - 1] || "");
    var rows = S.recs.filter(function (r) { return r.fy === fy; }), j = S.fund ? L.joined(S.fund, rows, { fy: fy }, DIM_KEYS) : null;
    var o = K.sum(rows, function (r) { return n(r.obl); }), d = K.sum(rows, function (r) { return n(r.disb); });
    var el = fy === now.fy ? now.fm : +fy < +now.fy ? 12 : 0;
    return { fy: fy, obl: o, disb: d, lines: rows.length, tdp: j ? j.totals.tdp : null, afp: j ? j.totals.afp : null, bal: j ? j.totals.bal : null, elapsed: el / 12 };
  }

  // ---------- page registration ----------
  C.register("sof", {
    classify: function (src) { var c = L.classify(src, ALIAS); return c.kind ? c : null; },
    parse: function (kind, src, fname, ws, name) { return mkEntry(name, kind, parseAs(kind, src)); },
    ingest: ingest, clear: clear, demo: demo, snapshot: snapshot, restore: restore, report: report, render: render,
    entries: function () { return S.files; }, hasData: function () { return S.recs.length > 0 || !!S.fund; }, summary: homeSummary,
    init: function () {
      ["tFy", "tMetric"].forEach(function (id) { $(id).addEventListener("change", render); });
      DIMS.forEach(function (d) { $(d[1]).addEventListener("change", function () { S.showAll = false; render(); }); });
      $("btnReset").addEventListener("click", function () { DIMS.forEach(function (d) { $(d[1]).value = ""; }); $("fSearch").value = ""; S.showAll = false; render(); });
      $("btnCsv").addEventListener("click", exportCsv);
      $("btnFundCsv").addEventListener("click", fundCsv);
      $("btnFundAll").addEventListener("click", function () { L.table.toggleAll(); render(); });
      $("tFund").tHead.addEventListener("click", function (e) { var th = e.target.closest("th[data-k]"); if (th) { L.table.sortBy(th.getAttribute("data-k")); render(); } });
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
