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

  // ---------- funding file ----------
  // [key, shown as, header aliases (normalized), role]. "key" columns can be used to match the export; "label" is carried along.
  var FCOLS = [
    ["fy", "Fiscal Year", ["fiscalyear", "fy"], "key"],
    ["appn", "Appropriation", ["appropriationtype", "appropriation", "appn"], "key"],
    ["sag", "Sag", ["sag"], "key"],
    ["mdep", "MDEP", ["mdep"], "key"],
    ["fa", "Functional Area", ["functionalareafarea", "functionalarea", "farea"], "key"],
    ["ci", "Commitment Item", ["commitmentitemfipex", "commitmentitem"], "key"],
    ["acct", "Account", ["account", "accountname", "acctname", "acct"], "label"],
    ["tdp", "TDP", ["tdp"], "money"],
    ["afp", "AFP", ["afp"], "money"],
    ["res", "Reservations", ["reservations", "reservation"], "money"]
  ];
  var KEY_ORDER = ["fy", "appn", "sag", "mdep", "fa", "ci"], AMTS = ["tdp", "afp", "res"];
  var FLABEL = {}; FCOLS.forEach(function (c) { FLABEL[c[0]] = c[1]; }); FLABEL.fm = "Fiscal Month";
  var FALIAS = aliasMap(FCOLS), FUND_AMT = ["tdp", "afp", "reservations", "reservation"];
  var PLAN_AMT = ["plannedamount", "planamount", "plannedamt", "planned", "spendplan", "plan", "plannedspend", "planamt"];
  var EXPORT_ONLY = ["contractdocno", "commitmentitemfipex", "obligationamtcum", "commitmentamtcum", "disbursementamtcum", "documentnumber", "obligation", "disbursement"];
  function keyLabel(keys) { return keys.map(function (k) { return FLABEL[k]; }).join(" + "); }

  // Which kind of table is this: "export", "funding" or "plan" (spend plan)? Uses the best header row in the first 20 rows.
  function classify(src, exportAlias) {
    var best = { kind: null, score: 0 };
    for (var r = 0; r < Math.min(src.rows, 20); r++) {
      var ex = 0, exOnly = 0, fa = 0, pl = 0;
      for (var c = 0; c < src.cols; c++) {
        var h = src.get(r, c); if (h == null || h === "") continue; var nh = norm(h);
        if (exportAlias[nh]) ex++; if (EXPORT_ONLY.indexOf(nh) >= 0) exOnly++; if (FUND_AMT.indexOf(nh) >= 0) fa++; if (PLAN_AMT.indexOf(nh) >= 0) pl++;
      }
      if (fa && !exOnly && fa + 1 > best.score) best = { kind: "funding", score: fa + 1 };
      else if (pl && !exOnly && !fa && pl + 1 > best.score) best = { kind: "plan", score: pl + 1 };
      else if (exOnly && ex > best.score) best = { kind: "export", score: ex };
    }
    return best;
  }
  function parseFunding(src) {
    var hm = mapHeaders(src, FALIAS), map = hm.map, amts = AMTS.filter(function (k) { return map[k] != null; });
    var rep = { kind: "funding", headerRow: hm.hi + 1, amts: amts, keys: [], keysIgnored: [], noFa: 0,
      missing: AMTS.filter(function (k) { return map[k] == null; }).map(function (k) { return FLABEL[k]; }).concat(map.fa == null ? ["Functional Area"] : []),
      extra: hm.extra, dupes: hm.dupes, pii: hm.pii, rowsRead: 0, rowsLoaded: 0, blankRows: 0, badNumber: 0, badNumberExamples: [], fatal: null };
    if (map.fa == null) { rep.fatal = "No Functional Area column was found in the funding file, so it cannot be matched to the export."; return { rows: [], report: rep }; }
    if (!amts.length) { rep.fatal = "No TDP, AFP or Reservations column was found."; return { rows: [], report: rep }; }
    var keyCols = KEY_ORDER.filter(function (k) { return map[k] != null; }), out = [];
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var row = { _row: rr + 1 }, empty = true;
      keyCols.forEach(function (k) { var v = src.get(rr, map[k]); row[k] = k === "fy" ? fyText(v) : idText(v); if (row[k]) empty = false; });
      if (map.acct != null) row.acct = idText(src.get(rr, map.acct));
      amts.forEach(function (k) { var v = src.get(rr, map[k]), x = parseAmt(v); if (!blankish(v)) empty = false; if (x !== null && isNaN(x)) { badNum(rep, rr + 1, FLABEL[k], v); x = null; } row[k] = x; });
      if (empty) { rep.blankRows++; continue; }
      rep.rowsRead++;
      if (!row.fa) { rep.noFa++; continue; }
      out.push(row);
    }
    // a key column is used only if every row has a value; Commitment Item holding ALLOBJ (funding set at ALLOBJ level) is not a match key
    var used = [];
    keyCols.forEach(function (k) {
      if (k === "fa") return;
      var complete = out.every(function (r) { return r[k]; }), allobj = k === "ci" && out.some(function (r) { return isAllobj(r.ci); });
      if (!complete || allobj) { rep.keysIgnored.push(FLABEL[k] + (allobj ? " (ALLOBJ level)" : " (some rows blank)")); out.forEach(function (r) { delete r[k]; }); }
      else used.push(k);
    });
    rep.keys = KEY_ORDER.filter(function (k) { return k === "fa" || used.indexOf(k) >= 0; });
    rep.hasAcct = map.acct != null; rep.rowsLoaded = out.length;
    return { rows: out, report: rep };
  }
  // Combine funding files. Match keys = key columns every funding file has AND the export lines have; rows sharing a key are added up.
  function buildFund(entries, recs) {
    if (!entries.length) return null;
    var keys = KEY_ORDER.filter(function (k) { return entries.every(function (e) { return e.rep.keys.indexOf(k) >= 0; }); });
    var dropped = keys.filter(function (k) { return k !== "fa" && !recs.some(function (r) { return r[k]; }); });
    keys = keys.filter(function (k) { return dropped.indexOf(k) < 0; });
    var amts = AMTS.filter(function (k) { return entries.some(function (e) { return e.rep.amts.indexOf(k) >= 0; }); });
    var by = Object.create(null), rows = [], merged = 0, acctByFa = Object.create(null);
    entries.forEach(function (e) {
      e.rows.forEach(function (r) {
        if (r.acct && !acctByFa[kn("fa", r.fa)]) acctByFa[kn("fa", r.fa)] = r.acct;
        var key = keys.map(function (k) { return kn(k, r[k]); }).join("\u0001"), g = by[key];
        if (g) { merged++; amts.forEach(function (k) { if (r[k] != null) g[k] = n(g[k]) + r[k]; }); if (!g.acct && r.acct) g.acct = r.acct; return; }
        g = by[key] = { _key: key, acct: r.acct || "" };
        keys.forEach(function (k) { g[k] = r[k]; }); amts.forEach(function (k) { g[k] = r[k]; });
        rows.push(g);
      });
    });
    return { keys: keys, amts: amts, rows: rows, merged: merged, dropped: dropped, acctByFa: acctByFa, hasAcct: entries.some(function (e) { return e.rep.hasAcct; }), files: entries.map(function (e) { return e.name; }) };
  }
  function account(fund, fa) { return fund && fa ? fund.acctByFa[kn("fa", fa)] || "" : ""; }
  // Joined view for the current filters: one group per match key (funding rows, plus keys that have lines but no funding row).
  // f = {dimKey: selected label}; dims = dimension keys that can be filtered.
  function joined(fund, rows, f, dims) {
    if (!fund) return null;
    var keys = fund.keys, nonKey = dims.filter(function (d) { return f[d] && keys.indexOf(d) < 0; });
    var by = Object.create(null), list = [];
    function grp(key, src) {
      var g = by[key];
      if (!g) { g = by[key] = { key: key, tdp: null, afp: null, res: null, obl: 0, disb: 0, lines: 0, funded: false, acct: "" }; keys.forEach(function (k) { g[k] = src[k] || ""; }); list.push(g); }
      return g;
    }
    rows.forEach(function (r) { var g = grp(keys.map(function (k) { return kn(k, r[k]); }).join("\u0001"), r); g.obl += n(r.obl); g.disb += n(r.disb); g.lines++; });
    fund.rows.forEach(function (fr) {
      for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (f[k] && kn(k, fr[k]) !== kn(k, f[k] === BLANK ? "" : f[k])) return; }
      if (nonKey.length && !by[fr._key]) return;                 // filtered on a column funding lacks: only rows with matching lines
      var g = grp(fr._key, fr); g.funded = true; g.acct = fr.acct || "";
      fund.amts.forEach(function (k) { g[k] = fr[k]; });
      keys.forEach(function (k) { if (!g[k]) g[k] = fr[k] || ""; });
    });
    list.forEach(function (g) {
      if (!g.acct) g.acct = account(fund, g.fa);
      g.bal = g.funded ? n(g.tdp) - n(g.res) - g.obl - g.disb : null;   // Balance = TDP - Reservations - Obligation - Disbursement
      g.pct = g.funded && g.tdp ? g.obl / g.tdp : null;
    });
    var t = { tdp: 0, afp: 0, res: 0, obl: 0, disb: 0, unfundedLines: 0, unfundedObl: 0, noLines: 0 };
    list.forEach(function (g) { t.tdp += n(g.tdp); t.afp += n(g.afp); t.res += n(g.res); t.obl += g.obl; t.disb += g.disb; if (!g.funded) { t.unfundedLines += g.lines; t.unfundedObl += g.obl; } else if (!g.lines) t.noLines++; });
    t.bal = t.tdp - t.res - t.obl - t.disb;
    return { groups: list, totals: t, nonKey: nonKey };
  }
  // Load-report lines about the funding match. Returns {html, warns}
  function reportLines(fund, recs, dims) {
    if (!fund) return { html: '<p class="warn">No funding file loaded: TDP, AFP, Reservations and Balance are not shown. Use &ldquo;Funding file&rdquo; or load it together with the export.</p>', warns: 1 };
    var j = joined(fund, recs, {}, dims), t = j.totals, h = [], warns = 0, codes = function (l) { return l.map(function (x) { return "<code>" + esc(x) + "</code>"; }).join(", "); };
    h.push('<p class="ok">Funding matched to the lines on <strong>' + esc(keyLabel(fund.keys)) + "</strong> (" + plural(fund.rows.length, "funding row") + ").</p>");
    if (fund.dropped.length) h.push('<p class="muted">Not matched on ' + codes(fund.dropped.map(function (k) { return FLABEL[k]; })) + " because the export lines do not have it; funding is added up instead.</p>");
    if (fund.merged) h.push('<p class="muted">' + plural(fund.merged, "funding row") + " shared a match key with another row and were added together.</p>");
    if (t.unfundedLines) { warns++; h.push('<p class="warn">' + plural(t.unfundedLines, "line") + " (obligation " + full(t.unfundedObl) + ") have no matching funding row. They still count in Obligation and Balance.</p>"); }
    if (t.noLines) h.push('<p class="muted">' + plural(t.noLines, "funding row") + " have no lines in the export yet.</p>");
    return { html: h.join(""), warns: warns };
  }
  function fileLines(e, codes) { // funding entry part of a file report
    var rep = e.rep, h = [], warns = 0;
    h.push('<p class="ok">Funding file: ' + plural(rep.rowsLoaded, "row") + " loaded (header row " + rep.headerRow + "). Amounts: " + codes(rep.amts.map(function (k) { return FLABEL[k]; })) + ". Match columns: " + codes(rep.keys.map(function (k) { return FLABEL[k]; })) + (rep.hasAcct ? ". Account names found" : "") + ".</p>");
    if (rep.missing.length) { warns++; h.push('<p class="warn">Not in this file: ' + codes(rep.missing) + " (shown as $0).</p>"); }
    if (rep.keysIgnored.length) h.push('<p class="muted">Not used for matching: ' + codes(rep.keysIgnored) + ".</p>");
    if (rep.noFa) { warns++; h.push('<p class="warn">' + plural(rep.noFa, "row") + " without a Functional Area skipped.</p>"); }
    return { html: h.join(""), warns: warns };
  }

  // ---------- funding vs execution table ----------
  var FT_AMT = [["tdp", "TDP"], ["afp", "AFP"], ["res", "Reservations"], ["obl", "Obligation"], ["disb", "Disbursement"], ["bal", "Balance"], ["pct", "% obligated"]];
  var T = { sort: { k: "bal", dir: 1 }, all: false, shown: [], fund: null };
  function tableCols(fund) {
    var cols = fund.keys.map(function (k) { return [k, FLABEL[k], true]; });
    if (fund.hasAcct) { var i = fund.keys.indexOf("fa"); cols.splice(i + 1, 0, ["acct", "Account", true]); }
    return cols.concat(FT_AMT);
  }
  function renderTable(fund, j) {
    $("fundPanel").hidden = !j; $("fundNeed").hidden = !!j; T.fund = fund;
    if (!j) { T.shown = []; return; }
    var fs = T.sort, cols = tableCols(fund), isText = cols.some(function (c) { return c[0] === fs.k && c[2]; });
    var rows = j.groups.slice().sort(function (a, b) {
      if (isText) return cmpVal(a[fs.k] || "", b[fs.k] || "") * fs.dir || cmpVal(a.key, b.key);
      var an = a[fs.k] == null, bn = b[fs.k] == null;
      if (an !== bn) return an ? 1 : -1;
      return (n(a[fs.k]) - n(b[fs.k])) * fs.dir || cmpVal(a.key, b.key);
    });
    T.shown = rows;
    $("fundNote").textContent = "Matched on " + keyLabel(fund.keys) + ". " + (j.nonKey.length ? "Funding is not split by " + j.nonKey.map(function (k) { return FLABEL[k]; }).join(", ") + ": the rows shown are those with matching lines, at their full funding. " : "") + "Balance = TDP \u2212 Reservations \u2212 Obligation \u2212 Disbursement. Click a column header to sort.";
    $("tFund").tHead.innerHTML = "<tr>" + cols.map(function (c) { var on = fs.k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[2] ? "" : "num") + (on ? " sorted" + (fs.dir > 0 ? " asc" : "") : "") + '">' + esc(c[1]) + "</th>"; }).join("") + "</tr>";
    var show = rows.slice(0, T.all ? MAXROWS : PAGE), noFund = { tdp: 1, afp: 1, res: 1, bal: 1 };
    function cell(g, c) {
      var v = g[c[0]];
      if (c[2]) return "<td>" + (v ? esc(v) : '<span class="muted">\u2014</span>') + "</td>";
      if (c[0] === "pct") return '<td class="num">' + (v == null ? '<span class="muted">\u2014</span>' : Math.round(v * 100) + "%") + "</td>";
      if (!g.funded && noFund[c[0]]) return '<td class="num"><span class="muted">' + (c[0] === "tdp" ? "no funding row" : "\u2014") + "</span></td>";
      if (v == null) return '<td class="num"><span class="muted">\u2014</span></td>';
      return '<td class="num' + (v < 0 ? " neg" : "") + (c[0] === "bal" && v < 0 ? " cf-bad" : "") + '">' + full(v) + "</td>";
    }
    $("tFund").tBodies[0].innerHTML = show.length ? show.map(function (g) { return '<tr class="' + (g.funded ? "" : "unfunded") + '">' + cols.map(function (c) { return cell(g, c); }).join("") + "</tr>"; }).join("")
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
    K.downloadCsv("funding_vs_execution_" + stamp + ".csv", cols.map(function (c) { return c[1]; }), T.shown.map(function (g) {
      return cols.map(function (c) {
        var v = g[c[0]]; if (c[2]) return v || "";
        if (c[0] === "pct") return v == null ? "" : (v * 100).toFixed(1);
        if (!g.funded && ["tdp", "afp", "res", "bal"].indexOf(c[0]) >= 0) return "";
        return v == null ? "" : v.toFixed(2);
      });
    }));
  }
  // header click: returns true when the sort changed (caller re-renders)
  function sortBy(k) { var text = KEY_ORDER.indexOf(k) >= 0 || k === "acct"; T.sort = T.sort.k === k ? { k: k, dir: -T.sort.dir } : { k: k, dir: text || k === "bal" ? 1 : -1 }; }

  w.FundsLib = {
    BLANK: BLANK, PAGE: PAGE, MAXROWS: MAXROWS,
    decodeX: decodeX, norm: norm, isPii: isPii, aliasMap: aliasMap, txt: txt, blankish: blankish, parseAmt: parseAmt, idText: idText, fyText: fyText,
    isAllobj: isAllobj, FY_MON: FY_MON, fmNum: fmNum, fmLabel: fmLabel, fiscalNow: fiscalNow, kn: kn, n: n, full: full, plural: plural, cmpVal: cmpVal, isObj: isObj,
    aoaSource: aoaSource, sheetSource: sheetSource, rowsSource: rowsSource, mapHeaders: mapHeaders, badNum: badNum,
    FCOLS: FCOLS, FLABEL: FLABEL, KEY_ORDER: KEY_ORDER, keyLabel: keyLabel, classify: classify, parseFunding: parseFunding, buildFund: buildFund,
    account: account, joined: joined, reportLines: reportLines, fileLines: fileLines,
    table: { render: renderTable, exportCsv: exportCsv, sortBy: sortBy, toggleAll: function () { T.all = !T.all; } }
  };
})(window);
