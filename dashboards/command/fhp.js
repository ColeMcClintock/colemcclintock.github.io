/* Aviation Dashboard: Flying Hour Program (FHP) reader and Aircraft Key. Used by the Fuel page (fuel.js).
   FHP layout (default; read flexibly): month headers Oct..Sep in F11:Q11, one aircraft line per row from row 13 with planned
   hours per month in F:Q, and a cost-per-hour block below (E20 = row 13's $/hr, E21 = row 14's, ...).
   Planned $ per month = planned hours x cost per hour. Nothing is uploaded; only this browser tab reads the file. */
(function (w) {
  "use strict";
  var L = w.FundsLib, C = w.CMD;
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  var DEFAULT = { headerRow: 11, firstCol: 5, firstRow: 13, costCol: 4, costRow: 20 };   // 1-based rows; 0-based columns (F = 5, E = 4)
  var TOTAL_RE = /\b(grand\s*)?(sub\s*)?totals?\b|^sum$/i, COST_RE = /cost|\$|per\s*(flying\s*)?h(ou)?r|\/\s*h(ou)?r|\brate\b|\bcph\b|price/i;
  function col(c) { var s = ""; c++; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; }
  function cell(r, c) { return col(c) + (r + 1); }
  function num(v) { var x = L.parseAmt(v); return x == null || isNaN(x) ? null : x; }
  function text(v) { return typeof v === "string" ? L.txt(v) : ""; }
  // calendar month (1-12) and year (or null) of a month-like header: Oct, October, Sept., Oct-26, OCT 2026, 10/1/2026, 2026-10-01, Excel date
  function monthOf(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) ? null : { m: v.getMonth() + 1, y: v.getFullYear() };
    if (typeof v === "number") { if (v < 20000 || v > 80000) return null; var p = XLSX.SSF.parse_date_code(v); return p ? { m: p.m, y: p.y } : null; }
    var s = L.txt(v).toLowerCase().replace(/\s+/g, " "), m;
    if ((m = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:[\s\-\/']*(\d{2}|\d{4}))?$/))) return { m: MON[m[1]], y: m[2] ? (m[2].length === 2 ? 2000 + +m[2] : +m[2]) : null };
    if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/))) return +m[2] >= 1 && +m[2] <= 12 ? { m: +m[2], y: +m[1] } : null;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) return +m[1] >= 1 && +m[1] <= 12 ? { m: +m[1], y: m[3].length === 2 ? 2000 + +m[3] : +m[3] } : null;
    if ((m = s.match(/^(\d{1,2})\/(\d{2}|\d{4})$/))) return +m[1] >= 1 && +m[1] <= 12 ? { m: +m[1], y: m[2].length === 2 ? 2000 + +m[2] : +m[2] } : null;
    return null;
  }
  function fmOfCal(m) { return (m + 2) % 12 + 1; }   // Oct = 1 ... Sep = 12
  // the month header row: at least 10 different months in one row (the default row 11 is tried first)
  function headerRow(src) {
    function at(r) {
      var map = {}, years = {}, n = 0;
      for (var c = 0; c < src.cols; c++) { var mo = monthOf(src.get(r, c)); if (!mo) continue; var fm = fmOfCal(mo.m); if (map[fm] == null) { map[fm] = c; n++; if (mo.y) years[fm] = mo.y; } }
      return n >= 10 ? { row: r, map: map, n: n, years: years } : null;
    }
    var d = DEFAULT.headerRow - 1, h = d < src.rows ? at(d) : null; if (h) return h;
    for (var r = 0; r < Math.min(src.rows, 60); r++) { h = at(r); if (h) return h; }
    return null;
  }
  function keywords(src, fname, upto) {
    var t = String(fname || "");
    for (var r = 0; r < Math.min(src.rows, upto || 12); r++) for (var c = 0; c < Math.min(src.cols, 20); c++) { var v = src.get(r, c); if (typeof v === "string") t += " " + v; }
    return /flying\s*hours?|\bFHP\b|flight\s*hours?|\bhours?\b|\bhrs\b/i.test(t);
  }
  function classify(src, fname) {
    var h = headerRow(src); if (!h) return null;
    var p = parse(src, fname, fname, true);
    if (!p.rows.length) return null;
    var hasCost = p.rows.some(function (r) { return r.cph != null; }), kw = keywords(src, fname, h.row + 1);
    if (!hasCost && !kw) return null;          // a month grid without hours keywords or a $/hr block is not an FHP (e.g. a spend plan)
    return { kind: "fhp", score: 60 + (hasCost ? 10 : 0) + (kw ? 5 : 0) };
  }
  function labelOf(src, r, upto, skip) {
    var parts = [];
    for (var c = 0; c < upto; c++) { if (c === skip) continue; var t = text(src.get(r, c)); if (t && !/^\$?[\d,.]+$/.test(t)) parts.push(t); }
    return parts.join(" \u00b7 ");
  }
  function parse(src, fname, name, quick) {
    var rep = { notes: [], warns: 0 }, out = { kind: "fhp", kindLabel: "Flying Hour Program", name: name, file: fname, rows: [], rep: rep, fatal: null };
    var h = headerRow(src);
    if (!h) { out.fatal = "No month header row (October \u2026 September) was found."; return out; }
    var fms = Object.keys(h.map).map(Number), cols = fms.map(function (k) { return h.map[k]; }), first = Math.min.apply(null, cols), last = Math.max.apply(null, cols);
    rep.headerRow = h.row + 1; rep.months = cell(h.row, first) + ":" + cell(h.row, last); rep.missingMonths = [];
    for (var fm = 1; fm <= 12; fm++) if (h.map[fm] == null) rep.missingMonths.push(L.FY_MON[fm - 1]);
    // fiscal year: header dates, else "FY27" / "FY 2027" text above the grid or in the file name, else the current fiscal year
    var fy = null, fyFrom = "";
    if (h.years[1]) { fy = String(h.years[1] + 1); fyFrom = "month header dates"; }
    else { var yk = Object.keys(h.years); if (yk.length) { var k0 = +yk[0], y0 = h.years[k0]; fy = String(k0 <= 3 ? y0 + 1 : y0); fyFrom = "month header dates"; } }
    if (!fy) {
      var t = String(fname || ""); for (var r0 = 0; r0 <= h.row; r0++) for (var c0 = 0; c0 < Math.min(src.cols, 20); c0++) { var v0 = src.get(r0, c0); if (typeof v0 === "string") t += " " + v0; }
      var m = t.match(/\bFY\s*'?(\d{4}|\d{2})\b/i); if (m) { fy = String(m[1].length === 2 ? 2000 + +m[1] : +m[1]); fyFrom = "\u201c" + m[0] + "\u201d"; }
    }
    if (!fy) { fy = C.currentFy(); fyFrom = "current fiscal year (no year in the file)"; }
    out.fy = fy; rep.fyFrom = fyFrom;
    // cost/hr column inside the hour rows (variant layout): a label-area header such as "$/hr" or "Cost per hour"
    var inlineCost = null; for (var ci = 0; ci < first; ci++) { var hv = text(src.get(h.row, ci)); if (hv && COST_RE.test(hv)) { inlineCost = ci; break; } }
    // hour rows: below the header, numeric hours in the month columns, until a blank gap after the first row or a Total row
    var rows = [], blankBefore = 0, r;
    for (r = h.row + 1; r < src.rows; r++) {
      var hours = [], any = false, bad = 0;
      for (var f = 1; f <= 12; f++) { var c = h.map[f], v = c == null ? null : src.get(r, c), x = num(v); if (x != null) any = true; else if (!L.blankish(v)) bad++; hours.push(x == null ? 0 : x); }
      var lab = labelOf(src, r, first, inlineCost);
      if (!any) { if (rows.length) break; if (++blankBefore > 6) break; continue; }
      if (TOTAL_RE.test(lab)) { rep.totalRow = r + 1; break; }
      if (lab && COST_RE.test(lab) && !/aircraft|uh-|ch-|ah-|hh-|lakota|black ?hawk|chinook/i.test(lab)) break;
      if (!lab && rows.length >= 2 && hours.every(function (hv2, i) { return Math.abs(hv2 - rows.reduce(function (s, q) { return s + q.hours[i]; }, 0)) < 0.01; })) { rep.totalRow = r + 1; break; }   // unlabeled total row
      var cph0 = inlineCost != null ? num(src.get(r, inlineCost)) : null;
      rows.push({ row: r + 1, label: lab || "Row " + (r + 1), hours: hours, cph: cph0, costCell: cph0 != null ? cell(r, inlineCost) : "", costBy: cph0 != null ? "same row" : "", bad: bad });
    }
    out.rows = rows;
    if (!rows.length) { out.fatal = "No rows with planned hours below the month headers."; return out; }
    // cost-per-hour block below the hour rows: column E by default, else the label-area column with the most $ values
    var lastRow = rows[rows.length - 1].row - 1, need = rows.filter(function (q) { return q.cph == null; }).length;
    if (need) {
      var start = lastRow + 1, end = Math.min(src.rows, lastRow + 40), best = null;
      var candCols = []; for (var cc = 0; cc < Math.min(src.cols, last + 3); cc++) candCols.push(cc);
      candCols.forEach(function (cc2) {
        var ents = [];
        for (var rr = start; rr < end; rr++) {
          var hasHours = false; for (var f2 = 1; f2 <= 12; f2++) { var c2 = h.map[f2]; if (c2 != null && num(src.get(rr, c2)) != null) { hasHours = true; break; } }
          var v2 = src.get(rr, cc2), x2 = num(v2); if (x2 == null || x2 <= 0 || hasHours) continue;
          var lab2 = labelOf(src, rr, Math.max(first, cc2 + 1), cc2);
          if (/\b(total|average|avg|blended|sum)\b/i.test(lab2)) continue;
          ents.push({ row: rr, value: x2, label: lab2 });
        }
        var score = ents.length >= rows.length ? 100 : ents.length; if (cc2 === DEFAULT.costCol) score += 0.5;
        if (ents.some(function (e) { return COST_RE.test(e.label); })) score += 0.25;
        if (ents.length && (!best || score > best.score)) best = { col: cc2, ents: ents, score: score };
      });
      if (best) {
        var ents = best.ents, CG = new RegExp(COST_RE.source, "gi"), norm = function (s) { return L.norm(String(s).replace(CG, " ")); };
        // by label when every hour row's label is found in one distinct cost label; otherwise by order (1st cost = 1st hour row)
        var byLabel = null, used = {};
        if (ents.every(function (e) { return norm(e.label).length >= 2; })) {
          byLabel = rows.map(function (q) { var nl = L.norm(q.label); var hit = ents.filter(function (e, i) { var ne = norm(e.label); return !used[i] && ne && (nl.indexOf(ne) >= 0 || ne.indexOf(nl) >= 0); }); if (hit.length !== 1) return null; used[ents.indexOf(hit[0])] = 1; return hit[0]; });
          if (byLabel.some(function (x3) { return !x3; })) byLabel = null;
        }
        var k = 0;
        rows.forEach(function (q, i) {
          if (q.cph != null) return;
          var e = byLabel ? byLabel[i] : ents[k++]; if (!e) return;
          q.cph = e.value; q.costCell = cell(e.row, best.col); q.costBy = byLabel ? "label" : "order";
        });
        rep.costBlock = cell(ents[0].row, best.col) + (ents.length > 1 ? ":" + cell(ents[Math.min(ents.length, rows.length) - 1].row, best.col) : "");
        if (ents.length > rows.length && !byLabel) rep.notes.push(ents.length + " cost values found below the hours; the first " + rows.length + " were used in order.");
      }
    }
    rows.forEach(function (q) {
      q.annualHours = Math.round(q.hours.reduce(function (s, x) { return s + x; }, 0) * 100) / 100;
      q.cost = q.hours.map(function (x) { return q.cph == null ? 0 : Math.round(x * q.cph * 100) / 100; });
      q.annualCost = Math.round(q.cost.reduce(function (s, x) { return s + x; }, 0) * 100) / 100;
      if (q.cph == null) { rep.warns++; }
    });
    var exact = rep.headerRow === DEFAULT.headerRow && first === DEFAULT.firstCol && rows[0].row === DEFAULT.firstRow && rows.every(function (q, i) { return q.costCell === col(DEFAULT.costCol) + (DEFAULT.costRow + i); });
    rep.layout = exact ? "default" : "detected";
    if (quick) return out;
    out.count = rows.length;
    return out;
  }
  // ---------- Aircraft Key: Aircraft -> AASF ----------
  var AK_AIR = ["aircraft", "aircraftname", "aircrafttype", "airframe", "tail", "tailnumber", "mds", "vehicle", "platform", "fhprow", "line"], AK_AASF = ["aasf", "aasfname", "facility", "site", "fueltracker", "tracker", "location"];
  function keyHeader(src) {
    for (var r = 0; r < Math.min(src.rows, 15); r++) {
      var a = null, b = null;
      for (var c = 0; c < src.cols; c++) { var n = L.norm(src.get(r, c)); if (a == null && AK_AIR.indexOf(n) >= 0) a = c; else if (b == null && AK_AASF.indexOf(n) >= 0) b = c; }
      if (a != null && b != null) return { row: r, air: a, aasf: b };
    }
    return null;
  }
  function classifyKey(src) { var h = keyHeader(src); return h ? { kind: "akey", score: 35 } : null; }
  function parseKey(src, fname, name) {
    var h = keyHeader(src), e = { kind: "akey", kindLabel: "Aircraft Key", name: name, file: fname, rows: [], fatal: null, blank: 0 };
    if (!h) { e.fatal = "An Aircraft Key needs Aircraft and AASF columns."; return e; }
    for (var r = h.row + 1; r < src.rows; r++) {
      var a = L.txt(src.get(r, h.air)).replace(/\s+/g, " "), b = L.txt(src.get(r, h.aasf)).replace(/\s+/g, " ");
      if (!a && !b) { e.blank++; continue; }
      if (!a || !b) { e.blank++; continue; }
      e.rows.push([a, b]);
    }
    e.count = e.rows.length; if (!e.rows.length) e.fatal = "No Aircraft \u2192 AASF rows found.";
    return e;
  }
  // ---------- matching (case-insensitive, trimmed, fuzzy-tolerant) ----------
  function dl(a, b) {   // Damerau-Levenshtein (optimal string alignment)
    var d = [], i, j; for (i = 0; i <= a.length; i++) { d[i] = [i]; } for (j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) {
      var cst = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cst);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }
  function tol(n) { return n <= 3 ? 0 : n <= 6 ? 1 : 2; }
  // Fuzzy only for names without digits: UH-60M must never match UH-60L.
  function same(a, b) { a = L.norm(a); b = L.norm(b); if (!a || !b) return false; if (a === b) return true; if (/\d/.test(a) || /\d/.test(b)) return false; return dl(a, b) <= tol(Math.min(a.length, b.length)); }
  // best candidate for a label: exact, then contains (either way, longest wins), then fuzzy on the whole text or on words
  function best(label, cands) {
    var nl = L.norm(label); if (!nl) return null;
    var ex = cands.filter(function (c) { return L.norm(c) === nl; }); if (ex.length) return ex[0];
    var ct = cands.filter(function (c) { var n = L.norm(c); return n.length >= 3 && (nl.indexOf(n) >= 0 || n.indexOf(nl) >= 0); }).sort(function (a, b) { return L.norm(b).length - L.norm(a).length; });
    if (ct.length) return ct[0];
    var fz = cands.filter(function (c) { return same(c, label); }); if (fz.length === 1) return fz[0];
    var words = String(label).toLowerCase().split(/[^a-z0-9]+/).filter(function (x) { return x.length >= 4 && !/\d/.test(x); });
    var wz = cands.filter(function (c) { var cw = String(c).toLowerCase().split(/[^a-z0-9]+/).filter(function (x) { return x.length >= 4 && !/\d/.test(x); }); return cw.length && cw.every(function (x) { return words.some(function (y) { return dl(x, y) <= tol(x.length); }); }); });
    return wz.length === 1 ? wz[0] : null;
  }
  C.FHP = { parse: parse, classify: classify, classifyKey: classifyKey, parseKey: parseKey, best: best, same: same, monthOf: monthOf, headerRow: headerRow, DEFAULT: DEFAULT, cell: cell };
})(window);
