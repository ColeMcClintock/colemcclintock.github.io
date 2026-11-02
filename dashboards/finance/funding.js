/* Status of Funds: shared parsing helpers and the funding file (TDP, AFP, Reservations).
   Loaded before finance.js. Everything runs in the browser; nothing is uploaded. */
(function (w) {
  "use strict";
  var K = w.DashKit, $ = K.$, esc = K.esc;
  var BLANK = "(blank)", PAGE = 100, MAXROWS = 5000;

  // ---------- header + cell helpers (shared with finance.js) ----------
  function decodeX(h) { return String(h == null ? "" : h).replace(/_x([0-9a-fA-F]{4})_/g, function (m, x) { return String.fromCharCode(parseInt(x, 16)); }); }
  function norm(h) { return decodeX(h).replace(/\u00a0/g, " ").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  // Personal identifier columns are skipped by header alone; their cells are never read.
  function isPii(h) {
    var s = decodeX(h).toLowerCase();
    if (/social\s*_?security/.test(s)) return true;
    return s.split(/[^a-z0-9]+/).some(function (t) { return /^ssn|ssn$/.test(t); });
  }
  function aliasMap(cols) { var m = {}; cols.forEach(function (c) { m[norm(c[1])] = c[0]; c[2].forEach(function (a) { if (!m[a]) m[a] = c[0]; }); }); return m; }
  function txt(v) { return v == null ? "" : String(v).replace(/\u00a0/g, " ").trim(); }
  function blankish(v) {
    if (v == null) return true;
    if (typeof v === "number") return !isFinite(v);
    var s = txt(v);
    return !s || /^#(ref!|n\/a|value!|div\/0!|name\?|null!|num!|spill!|calc!)$/i.test(s) || /^\(?\s*blank\s*\)?$/i.test(s) || /^(n\/a|null|none)$/i.test(s);
  }
  function parseAmt(v) { // number, null for blank, NaN for unreadable text
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (blankish(v)) return null;
    var s = txt(v).replace(/[\s$,]/g, "");
    if (/^[-\u2013\u2014]+$/.test(s)) return 0;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/^[-\u2212]/.test(s)) { neg = !neg; s = s.slice(1); }
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    s = s.replace(/^\$/, "");
    if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
    var n = parseFloat(s); return neg ? -n : n;
  }
  function idText(v) {
    if (blankish(v)) return "";
    if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
    return txt(v);
  }
  function fyText(v) { // 2026, "2026", "FY26", "FY 2026", "26" -> "2026"
    if (blankish(v)) return "";
    var s = typeof v === "number" ? String(Math.round(v)) : txt(v), m = s.match(/^(?:fy\s*)?(\d{2}|\d{4})(?:\.0+)?$/i);
    if (!m) return s;
    return m[1].length === 2 ? "20" + m[1] : m[1];
  }
  // Fiscal month: 1 = Oct ... 12 = Sep (federal fiscal year). Accepts 1, "01", "1.0", "P01", "Per 1", "1 - Oct", "Oct", "October".
  var FY_MON = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  var MON_FM = { oct: 1, nov: 2, dec: 3, jan: 4, feb: 5, mar: 6, apr: 7, may: 8, jun: 9, jul: 10, aug: 11, sep: 12 };
  function fmNum(v) { // 1..12, null for blank, NaN for unreadable
    if (blankish(v)) return null;
    if (typeof v === "number") return v === Math.round(v) && v >= 1 && v <= 12 ? v : NaN;
    var s = txt(v).toLowerCase(), m = s.match(/^(?:p|per|period|fm|m)?\s*0*(\d{1,2})(?:\.0+)?(?:\s*[-\u2013:.]?\s*[a-z]{3,9}\.?)?$/);
    if (m) { var x = +m[1]; return x >= 1 && x <= 12 ? x : NaN; }
    m = s.match(/^([a-z]{3})[a-z]*\.?$/);
    return m && MON_FM[m[1]] ? MON_FM[m[1]] : NaN;
  }
  function fmLabel(x) { return x ? x + " - " + FY_MON[x - 1] : ""; }
  function fiscalNow(d) { var m = d.getMonth(); return { fy: String(d.getFullYear() + (m >= 9 ? 1 : 0)), fm: (m + 3) % 12 + 1 }; }
  function isAllobj(v) { return typeof v === "string" && txt(v).toUpperCase() === "ALLOBJ"; }
  function kn(d, v) { // join key for one dimension value
    var s = (d === "fy" ? fyText(v) : idText(v)).toUpperCase().replace(/\s+/g, "");
    return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s;
  }
  function n(v) { return v || 0; }
  function full(v) { return v == null ? "" : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function plural(x, word) { return K.fmt(x) + " " + word + (x === 1 ? "" : "s"); }
  function cmpVal(a, b) {
    var na = +a, nb = +b;
    if (a !== "" && b !== "" && isFinite(na) && isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
  }

  // ---------- sources: a sheet, an array of arrays, or Power Automate row objects ----------
  function aoaSource(aoa) { var wd = 0; aoa.forEach(function (r) { if (r && r.length > wd) wd = r.length; }); return { rows: aoa.length, cols: wd, get: function (r, c) { var row = aoa[r]; return row ? row[c] : null; } }; }
  function sheetSource(ws) {
    if (!ws || !ws["!ref"]) return { rows: 0, cols: 0, get: function () { return null; } };
    var rg = XLSX.utils.decode_range(ws["!ref"]), r0 = rg.s.r, c0 = rg.s.c;
    return { rows: rg.e.r - r0 + 1, cols: rg.e.c - c0 + 1, get: function (r, c) { var cell = ws[XLSX.utils.encode_cell({ r: r + r0, c: c + c0 })]; return !cell || cell.t === "e" ? null : cell.v; } }; // error cells (#REF!) = blank
  }
  var PA_SKIP = /^(@odata\.|itemInternalId$)/i;
  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
  function rowsSource(rows) { // personal identifier keys are dropped and never read
    var hs = [], seen = Object.create(null);
    rows = rows.filter(isObj);
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (PA_SKIP.test(k) || isPii(k) || seen[k]) return; seen[k] = 1; hs.push(k); }); });
    return { rows: rows.length + 1, cols: hs.length, get: function (r, c) { if (r === 0) return hs[c]; var v = rows[r - 1][hs[c]]; return v == null ? "" : isObj(v) || Array.isArray(v) ? JSON.stringify(v) : v; } };
  }
  function mapHeaders(src, alias) {
    var hi = 0, best = -1;
    for (var r = 0; r < Math.min(src.rows, 20); r++) {
      var sc = 0; for (var c = 0; c < src.cols; c++) { var h = src.get(r, c); if (h != null && h !== "" && alias[norm(h)]) sc++; }
      if (sc > best) { best = sc; hi = r; }
    }
    var map = {}, extra = [], dupes = [], pii = 0;
    for (var ci = 0; ci < src.cols; ci++) {
      var hv = src.get(hi, ci); if (hv == null || txt(hv) === "") continue;
      if (isPii(hv)) { pii++; continue; }
      var k = alias[norm(hv)];
      if (!k) { extra.push(txt(decodeX(hv))); continue; }
      if (map[k] != null) { dupes.push(txt(decodeX(hv))); continue; }
      map[k] = ci;
    }
    return { hi: hi, map: map, extra: extra, dupes: dupes, pii: pii };
  }
  function badNum(rep, row, col, v) { rep.badNumber++; if (rep.badNumberExamples.length < 5) rep.badNumberExamples.push({ row: row, column: col, value: txt(v) }); }

  // ---------- side files: Account Key (Functional Area -> Account) and funding (per Account) ----------
  // Account names match ignoring case and repeated spaces. Several Functional Areas can roll up to one Account.
  function an(v) { return txt(v).replace(/\s+/g, " ").toUpperCase(); }
  var ACCT_AL = ["account", "accountname", "acctname", "acct"], FA_AL = ["functionalareafarea", "functionalarea", "farea"];
  var KCOLS = [["fa", "Functional Area", FA_AL], ["acct", "Account", ACCT_AL], ["sag", "Sag", ["sag"]], ["mdep", "MDEP", ["mdep"]]];
  var FCOLS = [
    ["fy", "Fiscal Year", ["fiscalyear", "fy"]],
    ["acct", "Account", ACCT_AL],
    ["fa", "Functional Area", FA_AL],                     // older format: funding by Functional Area, mapped to an Account through the key
    ["tdp", "TDP", ["tdp"]],
    ["afp", "AFP", ["afp"]],
    ["res", "Reservations", ["reservations", "reservation"]]
  ];
  var AMTS = ["tdp", "afp", "res"];
  var FLABEL = { fy: "Fiscal Year", acct: "Account", acctL: "Account", ciL: "Commitment Item", fa: "Functional Area", fm: "Fiscal Month", appn: "Appropriation", sag: "Sag", mdep: "MDEP", ci: "Commitment Item", tdp: "TDP", afp: "AFP", res: "Reservations" };
  var KALIAS = aliasMap(KCOLS), FALIAS = aliasMap(FCOLS), FUND_AMT = ["tdp", "afp", "reservations", "reservation"];
  var PLAN_AMT = ["plannedamount", "planamount", "plannedamt", "planned", "spendplan", "plan", "plannedspend", "planamt"];
  var EXPORT_ONLY = ["contractdocno", "commitmentitemfipex", "obligationamtcum", "commitmentamtcum", "disbursementamtcum", "documentnumber", "obligation", "disbursement"];
  var UNMAPPED = "Unmapped";
  var CI_AL = ["commitmentitem", "commitmentitemfipex", "ci", "commitmentitemcode", "cicode"], DESC_AL = ["description", "desc", "commitmentitemdescription", "cidescription", "name", "commitmentitemname"];
  var CKCOLS = [["ci", "Commitment Item", CI_AL], ["desc", "Description", DESC_AL]], CKALIAS = aliasMap(CKCOLS);
  function keyLabel(keys) { return keys.map(function (k) { return FLABEL[k]; }).join(" + "); }

  // Which kind of table is this: "export", "funding", "plan" (spend plan) or "key" (Account Key)? Uses the best header row in the first 20 rows.
  function classify(src, exportAlias) {
    var best = { kind: null, score: 0 };
    for (var r = 0; r < Math.min(src.rows, 20); r++) {
      var ex = 0, exOnly = 0, fa = 0, pl = 0, hFa = 0, hAcct = 0, hCi = 0, hDesc = 0;
      for (var c = 0; c < src.cols; c++) {
        var h = src.get(r, c); if (h == null || h === "") continue; var nh = norm(h);
        if (exportAlias[nh]) ex++; if (EXPORT_ONLY.indexOf(nh) >= 0) exOnly++; if (FUND_AMT.indexOf(nh) >= 0) fa++; if (PLAN_AMT.indexOf(nh) >= 0) pl++;
        if (FA_AL.indexOf(nh) >= 0) hFa = 1; if (ACCT_AL.indexOf(nh) >= 0) hAcct = 1; if (CI_AL.indexOf(nh) >= 0) hCi = 1; if (DESC_AL.indexOf(nh) >= 0) hDesc = 1;
      }
      if (fa && !exOnly && fa + 1 > best.score) best = { kind: "funding", score: fa + 1 };
      else if (pl && !exOnly && !fa && pl + 1 > best.score) best = { kind: "plan", score: pl + 1 };
      else if (exOnly && ex > best.score) best = { kind: "export", score: ex };
      else if (hFa && hAcct && !exOnly && !fa && !pl && 2 > best.score) best = { kind: "key", score: 2 };
      else if (hCi && hDesc && !hFa && !exOnly && !fa && !pl && 2 > best.score) best = { kind: "cikey", score: 2 };
    }
    return best;
  }

  // ---------- Account Key ----------
  var KEY = { map: Object.create(null), byAcct: Object.create(null), info: Object.create(null), files: [], fromFunding: 0, size: 0, conflicts: 0, infoConflicts: [] };
  function parseKey(src) {
    var hm = mapHeaders(src, KALIAS), map = hm.map, out = [];
    var rep = { kind: "key", headerRow: hm.hi + 1, extra: hm.extra, dupes: hm.dupes, pii: hm.pii, rowsRead: 0, rowsLoaded: 0, blankRows: 0, noAcct: 0, conflicts: [], fatal: null, missing: [] };
    if (map.fa == null || map.acct == null) { rep.missing = [map.fa == null ? "Functional Area" : null, map.acct == null ? "Account" : null].filter(Boolean); rep.fatal = "An Account Key needs Functional Area and Account columns."; return { rows: [], report: rep }; }
    var seen = Object.create(null);
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var fa = idText(src.get(rr, map.fa)), ac = txt(src.get(rr, map.acct)).replace(/\s+/g, " ");
      var sag = map.sag != null ? idText(src.get(rr, map.sag)) : "", mdep = map.mdep != null ? idText(src.get(rr, map.mdep)) : "";
      if (!fa && !ac) { rep.blankRows++; continue; }
      rep.rowsRead++;
      if (!fa || !ac) { rep.noAcct++; continue; }
      var k = kn("fa", fa);
      if (seen[k]) { if (an(seen[k]) !== an(ac) && rep.conflicts.length < 50) rep.conflicts.push(fa + ": " + seen[k] + " / " + ac); continue; }
      seen[k] = ac; out.push({ fa: fa, acct: ac, sag: sag, mdep: mdep });
    }
    rep.rowsLoaded = out.length; rep.hasSag = map.sag != null; rep.hasMdep = map.mdep != null;
    return { rows: out, report: rep };
  }
  // Key files first; Functional Area + Account pairs found in funding rows fill gaps (older funding format).
  function buildKey(keyEntries, fundEntries) {
    var K2 = { map: Object.create(null), byAcct: Object.create(null), info: Object.create(null), files: keyEntries.map(function (e) { return e.name; }), fromFunding: 0, size: 0, conflicts: 0, infoConflicts: [] };
    function info(ac, sag, mdep) { // one Sag and one MDEP per Account; the first one listed wins
      var a = an(ac), i = K2.info[a] || (K2.info[a] = { sag: "", mdep: "" });
      [["sag", sag, "Sag"], ["mdep", mdep, "MDEP"]].forEach(function (x) {
        if (!x[1]) return;
        if (!i[x[0]]) i[x[0]] = x[1];
        else if (kn(x[0], i[x[0]]) !== kn(x[0], x[1]) && K2.infoConflicts.length < 50 && !K2.infoConflicts.some(function (c) { return c.acct === ac && c.what === x[2]; })) K2.infoConflicts.push({ acct: ac, what: x[2], first: i[x[0]], other: x[1] });
      });
    }
    function add(fa, ac, implicit) {
      var k = kn("fa", fa); if (!k || !ac) return;
      if (K2.map[k]) { if (an(K2.map[k]) !== an(ac)) K2.conflicts++; return; }
      K2.map[k] = ac; K2.size++; if (implicit) K2.fromFunding++;
      (K2.byAcct[an(ac)] = K2.byAcct[an(ac)] || []).push(fa);
    }
    keyEntries.forEach(function (e) { e.rows.forEach(function (r) { add(r.fa, r.acct); info(r.acct, r.sag, r.mdep); }); });
    (fundEntries || []).forEach(function (e) { e.rows.forEach(function (r) { if (r.fa && r.acct) add(r.fa, r.acct, true); }); });
    KEY = K2; return K2;
  }
  function acctOf(fa) { return fa ? KEY.map[kn("fa", fa)] || "" : ""; }
  // Sag / MDEP come from the Account Key, per Account. Unmapped Functional Areas get "Unmapped".
  function keyed(fa) { var ac = acctOf(fa); if (!ac) return { acct: "", sag: "Unmapped", mdep: "Unmapped" }; var i = KEY.info[an(ac)] || {}; return { acct: ac, sag: i.sag || "", mdep: i.mdep || "" }; }
  function lineId(r) { return r.acct ? "A:" + an(r.acct) : "F:" + kn("fa", r.fa); }

  // ---------- Commitment Item Key (code -> description) ----------
  var CIKEY = { map: Object.create(null), size: 0, files: [], conflicts: 0 };
  function parseCiKey(src) {
    var hm = mapHeaders(src, CKALIAS), map = hm.map, out = [], seen = Object.create(null);
    var rep = { kind: "cikey", headerRow: hm.hi + 1, extra: hm.extra, dupes: hm.dupes, pii: hm.pii, rowsRead: 0, rowsLoaded: 0, blankRows: 0, noDesc: 0, conflicts: [], fatal: null, missing: [] };
    if (map.ci == null || map.desc == null) { rep.missing = [map.ci == null ? "Commitment Item" : null, map.desc == null ? "Description" : null].filter(Boolean); rep.fatal = "A Commitment Item Key needs Commitment Item and Description columns."; return { rows: [], report: rep }; }
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var ci = idText(src.get(rr, map.ci)), d = txt(src.get(rr, map.desc)).replace(/\s+/g, " ");
      if (!ci && !d) { rep.blankRows++; continue; }
      rep.rowsRead++;
      if (!ci || !d) { rep.noDesc++; continue; }
      var k = kn("ci", ci);
      if (seen[k]) { if (seen[k] !== d && rep.conflicts.length < 50) rep.conflicts.push(ci + ": " + seen[k] + " / " + d); continue; }
      seen[k] = d; out.push({ ci: ci, desc: d });
    }
    rep.rowsLoaded = out.length;
    return { rows: out, report: rep };
  }
  // Descriptions are matched ignoring case and spaces: every code whose description matches gets the SAME label
  // (the first spelling in the key), so charts, filters and summaries add those codes together.
  function dk(d) { return String(d || "").toUpperCase().replace(/\s+/g, ""); }
  function buildCiKey(entries) {
    var C = { map: Object.create(null), size: 0, files: entries.map(function (e) { return e.name; }), conflicts: 0, canon: Object.create(null), codes: Object.create(null) };
    entries.forEach(function (e) { e.rows.forEach(function (r) {
      var k = kn("ci", r.ci), d = dk(r.desc);
      if (C.map[k]) { if (dk(C.map[k]) !== d) C.conflicts++; return; }
      if (!C.canon[d]) { C.canon[d] = r.desc.trim(); C.codes[d] = []; }
      C.map[k] = C.canon[d]; C.codes[d].push(r.ci); C.size++;
    }); });
    CIKEY = C; return C;
  }
  function ciIsDesc(v) { return !!CIKEY.canon && !!CIKEY.canon[dk(v)]; }
  function ciCodes(desc) { return (CIKEY.codes && CIKEY.codes[dk(desc)]) || []; }
  function ciShared() { var out = []; Object.keys(CIKEY.codes || {}).forEach(function (d) { if (CIKEY.codes[d].length > 1) out.push({ desc: CIKEY.canon[d], codes: CIKEY.codes[d] }); }); return out; }
  function ciDesc(code) { return code ? CIKEY.map[kn("ci", code)] || "" : ""; }
  function ciRows() { var out = []; Object.keys(CIKEY.map).forEach(function (k) { out.push([k, CIKEY.map[k]]); }); return out; }

  // ---------- funding file: Fiscal Year (optional), Account, TDP, AFP, Reservations ----------
  function parseFunding(src) {
    var hm = mapHeaders(src, FALIAS), map = hm.map, amts = AMTS.filter(function (k) { return map[k] != null; });
    var rep = { kind: "funding", headerRow: hm.hi + 1, amts: amts, keys: [], byFa: map.acct == null && map.fa != null, noAcct: 0,
      missing: AMTS.filter(function (k) { return map[k] == null; }).map(function (k) { return FLABEL[k]; }),
      extra: hm.extra, dupes: hm.dupes, pii: hm.pii, rowsRead: 0, rowsLoaded: 0, blankRows: 0, badNumber: 0, badNumberExamples: [], fatal: null };
    if (map.acct == null && map.fa == null) { rep.fatal = "No Account column was found in the funding file, so it cannot be matched to the export."; rep.missing.push("Account"); return { rows: [], report: rep }; }
    if (!amts.length) { rep.fatal = "No TDP, AFP or Reservations column was found."; return { rows: [], report: rep }; }
    var out = [];
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var row = { _row: rr + 1 }, empty = true;
      row.fy = map.fy != null ? fyText(src.get(rr, map.fy)) : "";
      row.acct = map.acct != null ? txt(src.get(rr, map.acct)).replace(/\s+/g, " ") : "";
      row.fa = map.fa != null ? idText(src.get(rr, map.fa)) : "";
      if (row.fy || row.acct || row.fa) empty = false;
      amts.forEach(function (k) { var v = src.get(rr, map[k]), x = parseAmt(v); if (!blankish(v)) empty = false; if (x !== null && isNaN(x)) { badNum(rep, rr + 1, FLABEL[k], v); x = null; } row[k] = x; });
      if (empty) { rep.blankRows++; continue; }
      rep.rowsRead++;
      if (!row.acct && !row.fa) { rep.noAcct++; continue; }
      out.push(row);
    }
    rep.hasFy = map.fy != null && out.length > 0 && out.every(function (r) { return r.fy; });
    rep.keys = (rep.hasFy ? ["fy"] : []).concat(["acct"]);
    rep.rowsLoaded = out.length;
    return { rows: out, report: rep };
  }
  // Funding rows are summed per (Fiscal Year +) Account. Rows given by Functional Area are mapped through the key;
  // a Functional Area missing from the key stays as its own unmapped row.
  function buildFund(entries, recs) {
    if (!entries.length) return null;
    var useFy = entries.every(function (e) { return e.rep.hasFy; }) && recs.some(function (r) { return r.fy; });
    var amts = AMTS.filter(function (k) { return entries.some(function (e) { return e.rep.amts.indexOf(k) >= 0; }); });
    var by = Object.create(null), rows = [], merged = 0, viaKey = 0, unmappedFa = [];
    entries.forEach(function (e) {
      e.rows.forEach(function (r) {
        var ac = r.acct || acctOf(r.fa); if (!r.acct && ac) viaKey++;
        var id = ac ? "A:" + an(ac) : "F:" + kn("fa", r.fa); if (!ac && unmappedFa.indexOf(r.fa) < 0) unmappedFa.push(r.fa);
        var key = (useFy ? kn("fy", r.fy) : "") + "\u0001" + id, g = by[key];
        if (g) { merged++; amts.forEach(function (k) { if (r[k] != null) g[k] = n(g[k]) + r[k]; }); return; }
        g = by[key] = { _key: key, id: id, fy: useFy ? r.fy : "", acct: ac || "", fa: ac ? "" : r.fa, unmapped: !ac };
        amts.forEach(function (k) { g[k] = r[k]; });
        rows.push(g);
      });
    });
    return { keys: (useFy ? ["fy"] : []).concat(["acct"]), useFy: useFy, amts: amts, rows: rows, merged: merged, viaKey: viaKey, unmappedFa: unmappedFa,
      dropped: entries.every(function (e) { return e.rep.hasFy; }) && !useFy ? ["fy"] : [], files: entries.map(function (e) { return e.name; }) };
  }
  // Joined view for the current filters: one group per (Fiscal Year +) Account, plus one per unmapped Functional Area.
  // f = {dimKey: selected label}; dims = filterable dimension keys. Account filter key is "acctL".
  function joined(fund, rows, f, dims) {
    if (!fund) return null;
    var useFy = fund.useFy, nonKey = dims.filter(function (d) { return f[d] && d !== "acctL" && d !== "sag" && d !== "mdep" && !(useFy && d === "fy"); });
    var by = Object.create(null), list = [];
    function grp(key, fy, src) {
      var g = by[key];
      if (!g) { g = by[key] = { key: key, fy: fy || "", acct: src.acct || "", fa: src.acct ? "" : src.fa || "", unmapped: !src.acct, tdp: null, afp: null, res: null, obl: 0, disb: 0, lines: 0, funded: false, fas: [] }; list.push(g); }
      return g;
    }
    rows.forEach(function (r) {
      var g = grp((useFy ? kn("fy", r.fy) : "") + "\u0001" + lineId(r), useFy ? r.fy : "", r);
      g.obl += n(r.obl); g.disb += n(r.disb); g.lines++; if (r.fa && g.fas.indexOf(r.fa) < 0) g.fas.push(r.fa);
    });
    fund.rows.forEach(function (fr) {
      if (useFy && f.fy && kn("fy", fr.fy) !== kn("fy", f.fy === BLANK ? "" : f.fy)) return;
      if (f.acctL) { if (f.acctL === UNMAPPED ? !fr.unmapped : fr.unmapped || an(fr.acct) !== an(f.acctL)) return; }
      if (f.sag || f.mdep) { var inf = fr.unmapped ? { sag: UNMAPPED, mdep: UNMAPPED } : KEY.info[an(fr.acct)] || {}; if ((f.sag && (inf.sag || BLANK) !== f.sag) || (f.mdep && (inf.mdep || BLANK) !== f.mdep)) return; }  // one Sag / MDEP per Account
      if (nonKey.length && !by[fr._key]) return;                 // filtered on a column funding lacks: only rows with matching lines
      var g = grp(fr._key, fr.fy, fr); g.funded = true;
      fund.amts.forEach(function (k) { g[k] = fr[k]; });
    });
    list.forEach(function (g) {
      g.acctL = g.unmapped ? UNMAPPED : g.acct;
      g.label = g.unmapped ? g.fa : g.acct;
      var keyFas = g.unmapped ? [] : KEY.byAcct[an(g.acct)] || [];
      g.keyOnly = keyFas.filter(function (x) { return g.fas.indexOf(x) < 0; });
      g.fas.sort(cmpVal);
      g.bal = g.funded ? n(g.tdp) - n(g.res) - g.obl - g.disb : null;   // Balance = TDP - Reservations - Obligation - Disbursement
      g.pct = g.funded && g.tdp ? g.obl / g.tdp : null;
    });
    var t = { tdp: 0, afp: 0, res: 0, obl: 0, disb: 0, unfundedLines: 0, unfundedObl: 0, unmappedLines: 0, unmappedObl: 0, unmappedFas: 0, noLines: 0 };
    list.forEach(function (g) {
      t.tdp += n(g.tdp); t.afp += n(g.afp); t.res += n(g.res); t.obl += g.obl; t.disb += g.disb;
      if (g.unmapped && g.lines) { t.unmappedLines += g.lines; t.unmappedObl += g.obl; t.unmappedFas++; }
      else if (!g.funded) { t.unfundedLines += g.lines; t.unfundedObl += g.obl; }
      else if (!g.lines) t.noLines++;
    });
    t.bal = t.tdp - t.res - t.obl - t.disb;
    return { groups: list, totals: t, nonKey: nonKey };
  }
  // Load-report lines about the Account Key and the funding match. Returns {html, warns}
  function reportLines(fund, recs, dims) {
    var h = [], warns = 0, codes = function (l) { return l.map(function (x) { return "<code>" + esc(x) + "</code>"; }).join(", "); };
    var unm = Object.create(null), unmList = [];
    recs.forEach(function (r) { if (!r.acct && r.fa) { if (!unm[r.fa]) { unm[r.fa] = { fa: r.fa, obl: 0, lines: 0 }; unmList.push(unm[r.fa]); } unm[r.fa].obl += n(r.obl); unm[r.fa].lines++; } });
    var nAcct = Object.keys(KEY.byAcct).length;
    if (!KEY.size) { warns++; h.push('<p class="warn">No Account Key loaded: Functional Areas cannot be rolled up to Accounts. Load the Account Key (Functional Area, Account).</p>'); }
    else h.push('<p class="ok">Account Key: ' + plural(KEY.size, "Functional Area") + " &rarr; " + plural(nAcct, "Account") + (KEY.files.length ? " from " + esc(KEY.files.join(", ")) : "") + (KEY.fromFunding ? " (" + K.fmt(KEY.fromFunding) + " pair(s) taken from the funding file)" : "") + ".</p>");
    if (KEY.infoConflicts.length) { warns++; h.push('<p class="warn">Account Key lists different values for the same Account (first one used): ' + codes(KEY.infoConflicts.map(function (c) { return c.acct + " " + c.what + ": " + c.first + " / " + c.other; }).slice(0, 10)) + ".</p>"); }
    if (KEY.conflicts) { warns++; h.push('<p class="warn">' + plural(KEY.conflicts, "Functional Area") + " appear with two different Accounts; the first one is used.</p>"); }
    if (unmList.length) {
      warns++; unmList.sort(function (a, b) { return b.obl - a.obl; });
      h.push('<p class="warn"><strong>' + plural(unmList.length, "unmapped Functional Area") + "</strong> (" + plural(unmList.reduce(function (s, x) { return s + x.lines; }, 0), "line") + ", obligation " + full(unmList.reduce(function (s, x) { return s + x.obl; }, 0)) + ") are not in the Account Key. They count in the totals but are not matched to funding: " + codes(unmList.slice(0, 12).map(function (x) { return x.fa; })) + (unmList.length > 12 ? " &hellip;" : "") + ".</p>");
    }
    if (!fund) { warns++; h.push('<p class="warn">No funding file loaded: TDP, AFP, Reservations and Balance are not shown. Use &ldquo;Funding file&rdquo; or load it together with the export.</p>'); return { html: h.join(""), warns: warns }; }
    var j = joined(fund, recs, {}, dims), t = j.totals;
    h.push('<p class="ok">Funding matched to the lines per <strong>' + esc(keyLabel(fund.keys)) + "</strong> (" + plural(fund.rows.length, "funding row") + ").</p>");
    if (fund.dropped.length) h.push('<p class="muted">Not matched on Fiscal Year because the export lines do not have it; funding is added up across years instead.</p>');
    if (fund.viaKey) h.push('<p class="muted">' + plural(fund.viaKey, "funding row") + " given by Functional Area were mapped to their Account through the key.</p>");
    if (fund.unmappedFa.length) { warns++; h.push('<p class="warn">Funding rows for ' + plural(fund.unmappedFa.length, "Functional Area") + " not in the Account Key stay as their own rows: " + codes(fund.unmappedFa.slice(0, 12)) + ".</p>"); }
    if (fund.merged) h.push('<p class="muted">' + plural(fund.merged, "funding row") + " shared an Account" + (fund.useFy ? " and Fiscal Year" : "") + " with another row and were added together.</p>");
    if (t.unfundedLines) { warns++; h.push('<p class="warn">' + plural(t.unfundedLines, "line") + " (obligation " + full(t.unfundedObl) + ") belong to Accounts with no funding row. They still count in Obligation and Balance.</p>"); }
    if (t.noLines) h.push('<p class="muted">' + plural(t.noLines, "funding row") + " have no lines in the export yet (check the Account name spelling if that is unexpected).</p>");
    return { html: h.join(""), warns: warns };
  }
  function fileLines(e, codes) { // funding or key entry part of a file report
    var rep = e.rep, h = [], warns = 0;
    if (e.kind === "cikey") {
      h.push('<p class="ok">Commitment Item Key: ' + plural(rep.rowsLoaded, "code") + " loaded (header row " + rep.headerRow + ").</p>");
      if (rep.noDesc) { warns++; h.push('<p class="warn">' + plural(rep.noDesc, "row") + " without both a code and a description skipped.</p>"); }
      if (rep.conflicts.length) { warns++; h.push('<p class="warn">Listed twice with different descriptions (first one used): ' + codes(rep.conflicts.slice(0, 8)) + ".</p>"); }
      return { html: h.join(""), warns: warns };
    }
    if (e.kind === "key") {
      h.push('<p class="ok">Account Key: ' + plural(rep.rowsLoaded, "Functional Area") + " loaded (header row " + rep.headerRow + ")." + (rep.hasSag && rep.hasMdep ? " Sag and MDEP read per Account." : "") + "</p>");
      if (!rep.hasSag || !rep.hasMdep) { warns++; h.push('<p class="warn">No ' + [rep.hasSag ? "" : "Sag", rep.hasMdep ? "" : "MDEP"].filter(Boolean).join(" or ") + " column in the Account Key, so it is blank on the dashboard.</p>"); }
      if (rep.noAcct) { warns++; h.push('<p class="warn">' + plural(rep.noAcct, "row") + " without both a Functional Area and an Account skipped.</p>"); }
      if (rep.conflicts.length) { warns++; h.push('<p class="warn">Listed twice with different Accounts (first one used): ' + codes(rep.conflicts.slice(0, 8)) + ".</p>"); }
      return { html: h.join(""), warns: warns };
    }
    h.push('<p class="ok">Funding file: ' + plural(rep.rowsLoaded, "row") + " loaded (header row " + rep.headerRow + "). Amounts: " + codes(rep.amts.map(function (k) { return FLABEL[k]; })) + ". Per " + (rep.hasFy ? "Fiscal Year + " : "") + (rep.byFa ? "Functional Area (older format; mapped to Accounts through the key)" : "Account") + ". Amounts are used as given (not sign-flipped).</p>");
    if (rep.missing.length) { warns++; h.push('<p class="warn">Not in this file: ' + codes(rep.missing) + " (shown as $0).</p>"); }
    if (rep.noAcct) { warns++; h.push('<p class="warn">' + plural(rep.noAcct, "row") + " without an Account skipped.</p>"); }
    return { html: h.join(""), warns: warns };
  }

  // ---------- funding vs execution table: one row per (Fiscal Year +) Account, listing its Functional Areas ----------
  var FT_AMT = [["tdp", "TDP"], ["afp", "AFP"], ["res", "Reservations"], ["obl", "Obligation"], ["disb", "Disbursement"], ["bal", "Balance"], ["pct", "% obligated"]];
  var T = { sort: { k: "bal", dir: 1 }, all: false, shown: [], fund: null };
  function tableCols(fund) { return (fund.useFy ? [["fy", "Fiscal Year", true]] : []).concat([["label", "Account", true], ["fas", "Functional Areas", true]], FT_AMT); }
  function fasText(g) { return g.fas.join(", ") + (g.keyOnly.length ? (g.fas.length ? "; " : "") + "no lines: " + g.keyOnly.join(", ") : ""); }
  function renderTable(fund, j) {
    $("fundPanel").hidden = !j; $("fundNeed").hidden = !!j; T.fund = fund;
    if (!j) { T.shown = []; return; }
    var fs = T.sort, cols = tableCols(fund), isText = cols.some(function (c) { return c[0] === fs.k && c[2]; });
    var rows = j.groups.slice().sort(function (a, b) {
      if (isText) return cmpVal(fs.k === "fas" ? a.fas.join(",") : a[fs.k] || "", fs.k === "fas" ? b.fas.join(",") : b[fs.k] || "") * fs.dir || cmpVal(a.key, b.key);
      var aN = a[fs.k] == null, bN = b[fs.k] == null;
      if (aN !== bN) return aN ? 1 : -1;
      return (n(a[fs.k]) - n(b[fs.k])) * fs.dir || cmpVal(a.key, b.key);
    });
    T.shown = rows;
    $("fundNote").textContent = "One row per " + keyLabel(fund.keys) + "; Functional Areas roll up through the Account Key. " + (j.nonKey.length ? "Funding is set per Account, not split by " + j.nonKey.map(function (k) { return FLABEL[k]; }).join(", ") + ": the rows shown are those with matching lines, at their full funding. " : "") + "Balance = TDP \u2212 Reservations \u2212 Obligation \u2212 Disbursement. Click a header to sort.";
    $("tFund").tHead.innerHTML = "<tr>" + cols.map(function (c) { var on = fs.k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[2] ? "" : "num") + (on ? " sorted" + (fs.dir > 0 ? " asc" : "") : "") + '">' + esc(c[1]) + "</th>"; }).join("") + "</tr>";
    var show = rows.slice(0, T.all ? MAXROWS : PAGE), noFund = { tdp: 1, afp: 1, res: 1, bal: 1 };
    function cell(g, c) {
      var v = g[c[0]];
      if (c[0] === "label") return "<td>" + esc(g.label || BLANK) + (g.unmapped ? ' <span class="flag">Unmapped</span>' : "") + "</td>";
      if (c[0] === "fas") { var tx = fasText(g); return '<td class="fas" title="' + esc(tx) + '">' + (g.fas.length ? '<span class="fan">' + g.fas.length + "</span> " : "") + (tx ? esc(tx) : '<span class="muted">\u2014</span>') + "</td>"; }
      if (c[2]) return "<td>" + (v ? esc(v) : '<span class="muted">\u2014</span>') + "</td>";
      if (c[0] === "pct") return '<td class="num">' + (v == null ? '<span class="muted">\u2014</span>' : Math.round(v * 100) + "%") + "</td>";
      if (!g.funded && noFund[c[0]]) return '<td class="num"><span class="muted">' + (c[0] === "tdp" ? (g.unmapped ? "not in key" : "no funding row") : "\u2014") + "</span></td>";
      if (v == null) return '<td class="num"><span class="muted">\u2014</span></td>';
      return '<td class="num' + (v < 0 ? " neg" : "") + (c[0] === "bal" && v < 0 ? " cf-bad" : "") + '">' + full(v) + "</td>";
    }
    $("tFund").tBodies[0].innerHTML = show.length ? show.map(function (g) { return '<tr class="' + (g.funded ? "" : "unfunded") + (g.unmapped ? " unmapped" : "") + '">' + cols.map(function (c) { return cell(g, c); }).join("") + "</tr>"; }).join("")
      : '<tr><td colspan="' + cols.length + '" class="muted">Nothing matches the current filters.</td></tr>';
    var t = j.totals;
    $("tFund").tFoot.innerHTML = rows.length ? "<tr>" + cols.map(function (c, i) {
      if (c[2]) return i === 0 ? "<td>Total (" + plural(rows.length, "row") + ")</td>" : "<td></td>";
      if (c[0] === "pct") return '<td class="num">' + (t.tdp ? Math.round(t.obl / t.tdp * 100) + "%" : "\u2014") + "</td>";
      return '<td class="num' + (t[c[0]] < 0 ? " neg" : "") + '">' + full(t[c[0]]) + "</td>";
    }).join("") + "</tr>" : "";
    var btn = $("btnFundAll"); btn.style.display = rows.length > PAGE ? "" : "none"; btn.textContent = T.all ? "Show " + PAGE : "Show all " + K.fmt(rows.length);
  }
  function exportCsv() {
    if (!T.fund) return;
    var cols = tableCols(T.fund), d = new Date(), stamp = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    K.downloadCsv("funding_vs_execution_" + stamp + ".csv", cols.map(function (c) { return c[1]; }).concat(["Mapped"]), T.shown.map(function (g) {
      return cols.map(function (c) {
        var v = g[c[0]];
        if (c[0] === "fas") return fasText(g);
        if (c[2]) return v || "";
        if (c[0] === "pct") return v == null ? "" : (v * 100).toFixed(1);
        if (!g.funded && ["tdp", "afp", "res", "bal"].indexOf(c[0]) >= 0) return "";
        return v == null ? "" : v.toFixed(2);
      }).concat([g.unmapped ? "Unmapped" : "Yes"]);
    }));
  }
  function sortBy(k) { var text = ["fy", "label", "fas"].indexOf(k) >= 0; T.sort = T.sort.k === k ? { k: k, dir: -T.sort.dir } : { k: k, dir: text || k === "bal" ? 1 : -1 }; }
  function keyRows() { var out = []; Object.keys(KEY.byAcct).forEach(function (a) { var i = KEY.info[a] || {}; KEY.byAcct[a].forEach(function (fa) { out.push([fa, KEY.map[kn("fa", fa)], i.sag || "", i.mdep || ""]); }); }); return out; }

  w.FundsLib = {
    BLANK: BLANK, PAGE: PAGE, MAXROWS: MAXROWS, UNMAPPED: UNMAPPED,
    decodeX: decodeX, norm: norm, isPii: isPii, aliasMap: aliasMap, txt: txt, blankish: blankish, parseAmt: parseAmt, idText: idText, fyText: fyText,
    isAllobj: isAllobj, FY_MON: FY_MON, fmNum: fmNum, fmLabel: fmLabel, fiscalNow: fiscalNow, kn: kn, an: an, n: n, full: full, plural: plural, cmpVal: cmpVal, isObj: isObj,
    aoaSource: aoaSource, sheetSource: sheetSource, rowsSource: rowsSource, mapHeaders: mapHeaders, badNum: badNum,
    FLABEL: FLABEL, keyLabel: keyLabel, classify: classify, parseFunding: parseFunding, buildFund: buildFund, parseKey: parseKey, buildKey: buildKey,
    parseCiKey: parseCiKey, buildCiKey: buildCiKey, ciDesc: ciDesc, ciRows: ciRows, ciIsDesc: ciIsDesc, ciCodes: ciCodes, ciShared: ciShared, ciInfo: function () { return CIKEY; },
    acctOf: acctOf, keyed: keyed, keyRows: keyRows, keyInfo: function () { return KEY; }, joined: joined, reportLines: reportLines, fileLines: fileLines,
    table: { render: renderTable, exportCsv: exportCsv, sortBy: sortBy, toggleAll: function () { T.all = !T.all; } }
  };
})(window);
