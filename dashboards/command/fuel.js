/* Aviation Dashboard: Fuel. One tracker per AASF (file name = AASF name). Budget in cell B1; table header near row 13 with
   Date, Milstrip Number, Gallons, Total Cost. Other columns, blank rows and total rows are ignored. Nothing is uploaded. */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, C = w.CMD, $ = K.$, esc = K.esc, full = L.full, plural = L.plural, cmpVal = L.cmpVal;
  var ALIAS = {};
  [["date", ["date", "transactiondate", "issuedate", "dateissued", "dateofissue", "fueldate", "datefueled"]],
   ["ms", ["milstripnumber", "milstrip", "milstripno", "milstripdocumentnumber", "milstripdoc", "milstripdocno"]],
   ["gal", ["gallons", "gals", "gallonsissued", "totalgallons", "qtygallons", "quantitygallons", "gal"]],
   ["cost", ["totalcost", "cost", "totalamount", "extendedcost", "totalprice", "totaldollars"]]].forEach(function (c) { c[1].forEach(function (a) { ALIAS[a] = c[0]; }); });
  var FYM = L.FY_MON, MONS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var PAGE = 100;
  var S = { files: [], recs: [], aasfs: [], sort: { k: "d", dir: -1 }, showAll: false, shown: [], order: 0, fhp: null, akey: null, over: {}, demoFhp: false, settingsAt: null };
  // FHP rows -> AASF overrides and the Aircraft Key are also kept in this browser (Aviation-only key) so they survive new uploads.
  var STORE_KEY = "aviation-fuel-fhp-settings", IGNORE = "__ignore__";

  function aasfName(fname) { return String(fname || "").replace(/\.[a-z0-9]+$/i, "").replace(/\s*\(\d+\)$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().replace(/[\s-]*\bfuel(\s*tracker)?$/i, "").replace(/^fuel(\s*tracker)?\b[\s-]*/i, "").trim() || "AASF"; }
  function mk(y, m, d) { if (y < 100) y += 2000; var x = new Date(y, m, d); return x.getFullYear() === y && x.getMonth() === m && x.getDate() === d && y > 1990 && y < 2100 ? x : null; }
  // Excel serial dates and typed dates: 10/03/2026, 2026-10-03, 03OCT26, 3-Oct-2026, Oct 3, 2026
  function toDate(v) {
    if (v == null || L.blankish(v)) return null;
    if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    if (typeof v === "number") { if (v < 20000 || v > 80000) return null; var p = XLSX.SSF.parse_date_code(v); return p ? mk(p.y, p.m - 1, p.d) : null; }
    var s = L.txt(v), m;
    if (/^\d{5}(\.\d+)?$/.test(s)) return toDate(+s);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/))) return mk(+m[3], +m[1] - 1, +m[2]);
    if ((m = s.match(/^(\d{1,2})[\s\-]?([a-z]{3})[a-z]*\.?[\s\-,]*(\d{2}|\d{4})$/i)) && MONS[m[2].toLowerCase()] != null) return mk(+m[3], MONS[m[2].toLowerCase()], +m[1]);
    if ((m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i)) && MONS[m[1].toLowerCase()] != null) return mk(+m[3], MONS[m[1].toLowerCase()], +m[2]);
    return null;
  }
  function iso(d) { return d ? d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) : ""; }

  function classify(src, fname) {
    var out = [], fh = C.FHP.classify(src, fname), ak = C.FHP.classifyKey(src), fu = classifyFuel(src);
    if (fu) out.push(fu); if (fh && !fu) out.push(fh); if (ak && !fu && !fh) out.push(ak);
    return out;
  }
  function classifyFuel(src) {
    var best = null;
    for (var r = 0; r < Math.min(src.rows, 30); r++) {
      var got = {};
      for (var c = 0; c < src.cols; c++) { var h = src.get(r, c); if (h == null || h === "") continue; var k = ALIAS[L.norm(h)]; if (k) got[k] = 1; }
      var cnt = Object.keys(got).length;
      if (got.gal && cnt >= 3 && (!best || cnt + 3 > best.score)) best = { kind: "fuel", score: cnt + 3 };
    }
    return best;
  }
  // b1 = the value of cell B1 (the AASF's total fuel budget)
  function parse(kind, src, fname, ws, name, b1) {
    if (kind === "fhp") { var f = C.FHP.parse(src, fname, name); fhpStatus(f); return f; }
    if (kind === "akey") { var k = C.FHP.parseKey(src, fname, name); k.status = k.fatal || plural(k.rows.length, "aircraft") + " \u2192 " + plural(K.uniq(k.rows.map(function (r) { return r[1].toUpperCase(); })).length, "AASF"); return k; }
    if (ws) { var cell = ws.B1; b1 = cell && cell.t !== "e" ? cell.v : null; }
    var hm = L.mapHeaders(src, ALIAS), map = hm.map;
    // mapHeaders looks at the first 20 rows; look further for trackers with a taller top block
    if (map.gal == null) { for (var hr = 20; hr < Math.min(src.rows, 40); hr++) { var t = {}; for (var c = 0; c < src.cols; c++) { var k = ALIAS[L.norm(src.get(hr, c))]; if (k && t[k] == null) t[k] = c; } if (t.gal != null && Object.keys(t).length >= 3) { hm = { hi: hr, map: t, extra: [], pii: 0 }; map = t; break; } } }
    var aasf = aasfName(fname), budget = L.parseAmt(b1), budgetFrom = "B1";
    if (budget == null || isNaN(budget)) {                       // fallback: a "budget" label above the table with a number beside it
      budget = null;
      for (var r = 0; r < hm.hi && budget == null; r++) for (var cc = 0; cc < Math.min(src.cols, 8); cc++) {
        var lab = src.get(r, cc); if (typeof lab !== "string" || !/budget/i.test(lab)) continue;
        var x = L.parseAmt(src.get(r, cc + 1)); if (x != null && !isNaN(x)) { budget = x; budgetFrom = XLSX.utils.encode_cell({ r: r, c: cc + 1 }); break; }
      }
    }
    var rep = { headerRow: hm.hi + 1, budgetFrom: budget == null ? null : budgetFrom, missing: [["date", "Date"], ["ms", "Milstrip Number"], ["gal", "Gallons"], ["cost", "Total Cost"]].filter(function (x) { return map[x[0]] == null; }).map(function (x) { return x[1]; }),
      rowsRead: 0, blankRows: 0, totalRows: 0, badDate: 0, badDateEx: [], badNumber: 0, badNumberExamples: [], pii: hm.pii };
    var e = { name: name, kind: "fuel", kindLabel: "Fuel tracker", aasf: aasf, budget: budget, rep: rep, rows: [], order: S.order++, fatal: null };
    if (map.gal == null || map.cost == null) { e.fatal = "No Gallons and Total Cost header row was found."; return e; }
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var vd = map.date != null ? src.get(rr, map.date) : null, vm = map.ms != null ? src.get(rr, map.ms) : null, vg = src.get(rr, map.gal), vc = src.get(rr, map.cost);
      if ([vd, vm, vg, vc].every(L.blankish)) { rep.blankRows++; continue; }
      var td = typeof vd === "string" ? vd : "", tm = typeof vm === "string" ? vm : "";
      if (/\b(total|totals|subtotal|sum|grand)\b/i.test(td + " " + tm) || (L.blankish(vd) && L.blankish(vm))) { rep.totalRows++; continue; }
      rep.rowsRead++;
      var d = toDate(vd);
      if (!d) { rep.badDate++; if (rep.badDateEx.length < 5) rep.badDateEx.push({ row: rr + 1, value: L.txt(vd) }); }
      var gal = L.parseAmt(vg), cost = L.parseAmt(vc);
      if (gal !== null && isNaN(gal)) { L.badNum(rep, rr + 1, "Gallons", vg); gal = null; }
      if (cost !== null && isNaN(cost)) { L.badNum(rep, rr + 1, "Total Cost", vc); cost = null; }
      e.rows.push({ d: d, iso: iso(d), fy: C.fyOf(d), fm: C.fmOf(d), ms: L.idText(vm), gal: gal, cost: cost, aasf: aasf });
    }
    e.count = e.rows.length;
    return e;
  }
  function usable(e) { return !e.fatal && !e.dupOf; }
  function key(a) { return String(a).toUpperCase(); }
  // A new upload replaces the earlier tracker for the same AASF.
  function ingest(entries) {
    var fh = entries.filter(function (e) { return e.kind === "fhp"; }), ak = entries.filter(function (e) { return e.kind === "akey"; });
    entries = entries.filter(function (e) { return e.kind !== "fhp" && e.kind !== "akey"; });
    var gf = fh.filter(function (e) { return !e.fatal; }), gk = ak.filter(function (e) { return !e.fatal; });
    if (gf.length) { S.fhp = gf[gf.length - 1]; S.demoFhp = false; } else if (fh.length && !S.fhp) S.fhp = fh[fh.length - 1];
    if (gk.length) { S.akey = gk[gk.length - 1]; S.demoFhp = false; saveSettings(); } else if (ak.length && !S.akey) S.akey = ak[ak.length - 1];
    if (!entries.length) { combine(); return; }
    var names = entries.filter(function (e) { return !e.fatal; }).map(function (e) { return key(e.aasf); });
    S.files = S.files.filter(function (e) { return !e.fatal && names.indexOf(key(e.aasf)) < 0; }).concat(entries);
    combine();
  }
  function combine() {
    var seen = {};
    S.files.forEach(function (e) { e.dupOf = null; if (e.fatal) return; var s = key(e.aasf) + C.sig(e.rows.map(function (r) { return [r.iso, r.ms, r.gal, r.cost].join("|"); }).join("\n")); if (seen[s]) e.dupOf = seen[s]; else seen[s] = e.name; });
    var ok = S.files.filter(usable), recs = [], aas = {};
    ok.forEach(function (e) {
      var a = aas[key(e.aasf)];
      if (!a) a = aas[key(e.aasf)] = { name: e.aasf, budget: null, files: [] };
      if (e.budget != null) a.budget = (a.budget || 0) + e.budget;
      a.files.push(e.name);
      e.rows.forEach(function (r) { recs.push(r); });
    });
    S.recs = recs; S.aasfs = Object.keys(aas).map(function (k) { return aas[k]; }).sort(function (a, b) { return cmpVal(a.name, b.name); });
    S.aasfs.forEach(function (a, i) { a.color = C.AASF_COLORS[i % C.AASF_COLORS.length]; });
    S.files.forEach(function (e) {
      var r = e.rep; e.warns = e.fatal || e.dupOf || e.budget == null || r.badDate || r.badNumber || (r.missing && r.missing.length) ? 1 : 0;
      e.status = e.fatal || (e.aasf + " \u00b7 budget " + (e.budget == null ? "not found" : full(e.budget)) + " \u00b7 " + plural(e.rows.length, "transaction"));
    });
    S.showAll = false; buildFilters();
  }
  function clear() {
    S.files = []; S.fhp = null; S.demoFhp = false; S.akey = null; S.over = {}; S.settingsAt = null;
    var loc = readSettings(); if (loc) applySettings(loc);
    combine();
  }
  function demo() {
    var D = w.COMMAND_DEMO; if (!D) return;
    S.files = D.fuel.map(function (f) { return parse("fuel", L.aoaSource(f.grid), f.name, null, f.name, (f.grid[0] || [])[1]); });
    if (D.fhp && !readSettings()) {   // the fictional demo FHP and Aircraft Key (never written to browser storage)
      S.fhp = C.FHP.parse(L.aoaSource(D.fhp.grid), D.fhp.name, D.fhp.name); fhpStatus(S.fhp);
      S.akey = C.FHP.parseKey(L.aoaSource(D.aircraftKey.grid), D.aircraftKey.name, D.aircraftKey.name); S.akey.status = plural(S.akey.rows.length, "aircraft");
      S.over = {}; S.demoFhp = true;
    }
    combine();
  }
  function snapshot() {
    var o = { files: S.files.filter(usable).map(function (e) { return { name: e.name, aasf: e.aasf, budget: e.budget, rows: e.rows.map(function (r) { return [r.iso, r.ms, r.gal == null ? "" : r.gal, r.cost == null ? "" : r.cost]; }) }; }) };
    if (S.fhp && !S.fhp.fatal) o.fhp = { name: S.fhp.name, file: S.fhp.file, fy: S.fhp.fy, rows: S.fhp.rows.map(function (q) { return { row: q.row, label: q.label, hours: q.hours, cph: q.cph, costCell: q.costCell, costBy: q.costBy, annualHours: q.annualHours, cost: q.cost, annualCost: q.annualCost }; }), rep: S.fhp.rep };
    if (S.akey && !S.akey.fatal) o.akey = { name: S.akey.name, rows: S.akey.rows };
    o.over = S.over; o.settingsAt = S.settingsAt;
    return o;
  }
  function restore(o) {
    S.files = (o.files || []).map(function (f) {
      var grid = [["Total Fuel Budget", f.budget == null ? "" : f.budget], ["Date", "Milstrip Number", "Gallons", "Total Cost"]].concat(f.rows);
      var e = parse("fuel", L.aoaSource(grid), (f.aasf || "AASF") + ".xlsx", null, f.name, f.budget);
      return e;
    });
    S.fhp = o.fhp ? { kind: "fhp", kindLabel: "Flying Hour Program", name: o.fhp.name, file: o.fhp.file, fy: o.fhp.fy, rows: o.fhp.rows || [], rep: o.fhp.rep || { notes: [] }, count: (o.fhp.rows || []).length, fatal: null } : null;
    if (S.fhp) fhpStatus(S.fhp);
    S.demoFhp = false;
    // Save with data carries the mapping too; this browser's copy wins only when it is newer
    var loc = readSettings();
    if (loc && loc.updatedAt && (!o.settingsAt || loc.updatedAt > o.settingsAt)) applySettings(loc);
    else { S.akey = o.akey ? { kind: "akey", kindLabel: "Aircraft Key", name: o.akey.name, rows: o.akey.rows || [], count: (o.akey.rows || []).length, fatal: null, status: plural((o.akey.rows || []).length, "aircraft") } : null; S.over = o.over || {}; S.settingsAt = o.settingsAt || null; if (S.akey || Object.keys(S.over).length) writeSettings(); }
    combine();
  }
  // ---------- FHP settings (overrides + Aircraft Key) in this browser ----------
  function readSettings() { try { var t = w.localStorage.getItem(STORE_KEY); var o = t ? JSON.parse(t) : null; return o && o.v === 1 ? o : null; } catch (e) { return null; } }
  function writeSettings() {
    if (S.demoFhp) return;
    try { w.localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, updatedAt: S.settingsAt || new Date().toISOString(), over: S.over, akey: S.akey && !S.akey.fatal ? { name: S.akey.name, rows: S.akey.rows } : null })); } catch (e) { }
  }
  function saveSettings() { S.settingsAt = new Date().toISOString(); writeSettings(); }
  function applySettings(o) {
    S.over = o.over || {}; S.settingsAt = o.updatedAt || null;
    S.akey = o.akey ? { kind: "akey", kindLabel: "Aircraft Key", name: o.akey.name + " (kept in this browser)", rows: o.akey.rows || [], count: (o.akey.rows || []).length, fatal: null, status: plural((o.akey.rows || []).length, "aircraft") + " \u00b7 kept in this browser" } : null;
  }
  function fhpStatus(f) {
    if (f.fatal) { f.status = f.fatal; f.warns = 1; return; }
    var miss = f.rows.filter(function (q) { return q.cph == null; }).length;
    f.warns = miss || (f.rep.missingMonths && f.rep.missingMonths.length) ? 1 : 0;
    f.status = "FY" + f.fy + " \u00b7 " + plural(f.rows.length, "aircraft row") + " \u00b7 " + full(f.rows.reduce(function (t, q) { return t + q.annualCost; }, 0)) + " planned" + (miss ? " \u00b7 " + miss + " without $/hr" : "");
  }
  // ---------- FHP rows -> AASF: manual choice, then Aircraft Key, then automatic label match ----------
  function rowKey(label) { return L.norm(label); }
  function trackerFor(name) { var t = S.aasfs.map(function (a) { return a.name; }); return C.FHP.best(name, t) || name; }
  function autoMap(q) {
    if (S.akey && !S.akey.fatal) {
      var air = S.akey.rows.map(function (r) { return r[0]; }), hit = C.FHP.best(q.label, air);
      if (hit) { var row = S.akey.rows[air.indexOf(hit)]; return { aasf: trackerFor(row[1]), via: "Aircraft Key", key: hit }; }
    }
    var t = C.FHP.best(q.label, S.aasfs.map(function (a) { return a.name; }));
    return t ? { aasf: t, via: "name match" } : { aasf: null, via: "unmapped" };
  }
  function mapRow(q) {
    var o = S.over[rowKey(q.label)], a = autoMap(q);
    if (o === IGNORE) return { aasf: null, via: "ignored", auto: a };
    if (o) return { aasf: o, via: "manual", auto: a };
    return { aasf: a.aasf, via: a.via, key: a.key, auto: a };
  }
  function fhpGroups() {
    if (!S.fhp || S.fhp.fatal) return [];
    var g = {}, order = [];
    S.fhp.rows.forEach(function (q) {
      var m = mapRow(q); q.map = m; if (!m.aasf) return;
      var k = key(m.aasf), x = g[k];
      if (!x) { x = g[k] = { name: m.aasf, rows: [], plan: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], hours: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }; order.push(k); }
      x.rows.push(q); for (var i = 0; i < 12; i++) { x.plan[i] += q.cost[i]; x.hours[i] += q.hours[i]; }
    });
    return order.map(function (k) { var x = g[k]; x.tracker = S.aasfs.filter(function (a) { return key(a.name) === k; })[0] || null; return x; });
  }
  function today() { return C.today ? C.today() : new Date(); }
  // share of each fiscal month that counts as "to date" (current month prorated by days)
  function monthShare(fy) {
    var p = C.fyProgress(fy, today()), f = [];
    if (p.state === "past") return [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    if (p.state === "future") return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var t = today(), cur = C.fmOf(t), dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    for (var i = 1; i <= 12; i++) f.push(i < cur ? 1 : i === cur ? t.getDate() / dim : 0);
    return f;
  }
  // On pace = within 5% of planned-to-date (exactly 5% counts as on pace); Over = more than 5% above; Under = more than 5% below
  function fhpPace(v) {
    if (v == null || !isFinite(v)) return { k: "na", t: "No plan to date" };
    var x = Math.round(v * 1e6) / 1e6;
    return x > 0.05 ? { k: "over", t: "Over pace" } : x < -0.05 ? { k: "funder", t: "Under pace" } : { k: "on", t: "On pace" };
  }
  function r2(x) { return Math.round(x * 100) / 100; }
  function fhpStats(fy, only) {
    if (!S.fhp || S.fhp.fatal || S.fhp.fy !== fy) return null;
    var share = monthShare(fy), groups = fhpGroups().filter(function (g) { return !only || only.indexOf(key(g.name)) >= 0; });
    function calc(g, plan, hours, spent, budget) {
      var pTD = 0, hTD = 0, ann = 0, annH = 0; for (var i = 0; i < 12; i++) { pTD += plan[i] * share[i]; hTD += hours[i] * share[i]; ann += plan[i]; annH += hours[i]; }
      var blended = annH ? ann / annH : null, v = pTD ? (spent - pTD) / pTD : null;
      return { plannedTD: r2(pTD), hoursTD: Math.round(hTD * 10) / 10, annual: r2(ann), annualHours: r2(annH), blended: blended, spent: r2(spent), implied: blended ? Math.round(spent / blended * 10) / 10 : null, v: v, pace: fhpPace(v), budget: budget, vsBudget: budget == null ? null : r2(ann - budget) };
    }
    var list = groups.map(function (g) {
      var spent = g.tracker ? K.sum(S.recs.filter(function (r) { return r.aasf === g.tracker.name && r.fy === fy; }), function (r) { return r.cost || 0; }) : 0;
      var o = calc(g, g.plan, g.hours, spent, g.tracker ? g.tracker.budget : null); o.name = g.name; o.group = g; o.tracker = g.tracker; o.color = g.tracker ? g.tracker.color : "#94a3b8"; return o;
    });
    var withT = list.filter(function (x) { return x.tracker; }), P = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], H = P.slice();
    withT.forEach(function (x) { for (var i = 0; i < 12; i++) { P[i] += x.group.plan[i]; H[i] += x.group.hours[i]; } });
    var bud = withT.some(function (x) { return x.budget != null; }) ? K.sum(withT, function (x) { return x.budget || 0; }) : null;
    var roll = calc(null, P, H, K.sum(withT, function (x) { return x.spent; }), bud); roll.plan = P;
    return { fy: fy, share: share, list: list, roll: roll };
  }
  function report() {
    if (!S.files.length && !S.fhp && !S.akey) return { html: "", warns: 0 };
    var h = [], warns = 0;
    S.files.forEach(function (e) {
      var r = e.rep, x = [];
      if (e.fatal) x.push('<p class="err">' + esc(e.fatal) + "</p>");
      else if (e.dupOf) x.push('<p class="warn">Same content as ' + esc(e.dupOf) + "; skipped.</p>");
      else {
        x.push('<p class="ok">AASF <strong>' + esc(e.aasf) + "</strong> (from the file name): " + plural(e.rows.length, "transaction") + " (header row " + r.headerRow + ").</p>");
        x.push(e.budget == null ? '<p class="warn">No budget found in B1, so % used and pace are not shown for this AASF.</p>' : '<p class="ok">Budget ' + full(e.budget) + " from " + esc(r.budgetFrom) + ".</p>");
        if (r.missing.length) x.push('<p class="warn">Columns not found: ' + r.missing.join(", ") + ".</p>");
        if (r.totalRows) x.push('<p class="muted">' + plural(r.totalRows, "total or summary row") + " ignored.</p>");
        if (r.badDate) x.push('<p class="warn">' + plural(r.badDate, "row") + " with a date that could not be read: listed in the table but not counted in any fiscal year. Examples: " + r.badDateEx.map(function (b) { return "row " + b.row + " = &ldquo;" + esc(b.value) + "&rdquo;"; }).join("; ") + ".</p>");
        if (r.badNumber) x.push('<p class="warn">' + plural(r.badNumber, "Gallons or Total Cost cell") + " could not be read (counted as 0).</p>");
        var fys = K.uniq(e.rows.map(function (q) { return q.fy; }).filter(Boolean)).sort();
        if (fys.length > 1) x.push('<p class="muted">Rows span FY' + fys.join(", FY") + "; the B1 budget is compared with each fiscal year on its own.</p>");
      }
      warns += e.warns || 0;
      h.push('<details class="filerep"' + (e.warns ? " open" : "") + "><summary>" + esc(e.name) + "</summary>" + x.join("") + "</details>");
    });
    var fr = fhpReport(); h.push(fr.html); warns += fr.warns;
    return { html: h.join(""), warns: warns };
  }

  function fhpReport() {
    var h = [], warns = 0, F = S.fhp;
    if (F) {
      var x = [];
      if (F.fatal) { x.push('<p class="err">' + esc(F.fatal) + "</p>"); warns++; }
      else {
        var R = F.rep, D = C.FHP.DEFAULT;
        x.push('<p class="ok">Flying Hour Program for <strong>FY' + esc(F.fy) + "</strong> (" + esc(R.fyFrom) + "). Month headers in row " + R.headerRow + " (" + esc(R.months) + ")" + (R.costBlock ? "; cost per hour from " + esc(R.costBlock) : "") + ".</p>");
        x.push(R.layout === "default" ? '<p class="muted">Default layout: months F11:Q11, aircraft rows from row 13, cost per hour E20 onward (E20 = row 13, E21 = row 14 \u2026).</p>' : '<p class="warn">Layout differs from the default (months F11:Q11, rows from 13, $/hr E20 onward); it was found automatically as shown below. Check each row.</p>');
        if (R.missingMonths && R.missingMonths.length) { warns++; x.push('<p class="warn">Months not found in the header row: ' + esc(R.missingMonths.join(", ")) + " (counted as 0 hours).</p>"); }
        if (R.totalRow) x.push('<p class="muted">Total row ' + R.totalRow + " skipped.</p>");
        (R.notes || []).forEach(function (n) { x.push('<p class="muted">' + esc(n) + "</p>"); });
        x.push('<div class="tablewrap"><table class="grid fhprep"><thead><tr><th>Row</th><th>Aircraft (label)</th>' + L.FY_MON.map(function (m) { return '<th class="num">' + m + "</th>"; }).join("") + '<th class="num">Hours</th><th class="num">$/hr</th><th>$/hr cell</th><th class="num">Planned $</th><th>AASF</th></tr></thead><tbody>' +
          F.rows.map(function (q) {
            var m = q.map || mapRow(q); if (q.cph == null || !m.aasf) warns++;
            return "<tr><td>" + q.row + "</td><td>" + esc(q.label) + "</td>" + q.hours.map(function (v) { return '<td class="num">' + K.fmt(v, v % 1 ? 1 : 0) + "</td>"; }).join("") + '<td class="num">' + K.fmt(q.annualHours, 1) + '</td><td class="num">' + (q.cph == null ? '<span class="flag">missing</span>' : full(q.cph)) + "</td><td>" + esc(q.costCell || "") + (q.costBy ? ' <span class="muted">(' + esc(q.costBy === "order" ? "by order" : q.costBy === "label" ? "by label" : q.costBy) + ")</span>" : "") +
              '</td><td class="num">' + full(q.annualCost) + "</td><td>" + (m.aasf ? esc(m.aasf) + ' <span class="muted">(' + esc(m.via) + (m.key ? ": " + esc(m.key) : "") + ")</span>" : m.via === "ignored" ? '<span class="muted">Ignored</span>' : '<span class="flag">Not mapped \u2014 add to Aircraft Key</span>') + "</td></tr>";
          }).join("") + "</tbody></table></div>");
        x.push('<p class="muted">Planned $ = hours \u00d7 cost per hour, per month. Rows mapped to the same AASF are added together. Mapping order: your choice in \u201cFHP rows \u2192 AASF\u201d, then the Aircraft Key, then a match of the row label to a fuel tracker name.</p>');
      }
      h.push('<details class="filerep"' + (warns ? " open" : "") + "><summary>" + esc(F.name) + " \u00b7 Flying Hour Program</summary>" + x.join("") + "</details>");
    }
    if (S.akey) {
      var A = S.akey, used = {};
      if (F && !F.fatal) F.rows.forEach(function (q) { var m = q.map || mapRow(q); if (m.key) used[m.key] = 1; });
      h.push('<details class="filerep"><summary>' + esc(A.name) + " \u00b7 Aircraft Key</summary>" + (A.fatal ? '<p class="err">' + esc(A.fatal) + "</p>" : '<p class="ok">' + plural(A.rows.length, "aircraft") + ": " + A.rows.map(function (r) { return esc(r[0]) + " \u2192 " + esc(r[1]) + (used[r[0]] ? "" : ' <span class="muted">(not in the FHP)</span>'); }).join("; ") + ".</p>") + "</details>");
    }
    if (F || S.akey) h.push('<p class="muted">The FHP row \u2192 AASF choices and the Aircraft Key are also kept in this browser (localStorage key ' + STORE_KEY + ") so they survive new uploads; fuel and FHP numbers are not stored.</p>");
    return { html: h.join(""), warns: warns };
  }
  // ---------- filters ----------
  function years() { return K.uniq(S.recs.map(function (r) { return r.fy; }).filter(Boolean)).sort(); }
  function autoFy() { var ys = years(), cur = C.currentFy(); return ys.indexOf(cur) >= 0 ? cur : ys.filter(function (y) { return +y < +cur; }).pop() || ys[ys.length - 1] || cur; }
  function buildFilters() {
    var ys = years(), sel = $("fuFy"), cur = sel.value;
    sel.innerHTML = ys.slice().reverse().map(function (y) { return '<option value="' + y + '">FY' + y + "</option>"; }).join("") || '<option value="">\u2014</option>';
    sel.value = ys.indexOf(cur) >= 0 ? cur : autoFy();
    K.fillSelect($("fuAasf"), S.aasfs.map(function (a) { return a.name; }), "All AASFs", true);
  }
  function stats(fy, aasfs) {
    var prog = C.fyProgress(fy), out = aasfs.map(function (a) {
      var rows = S.recs.filter(function (r) { return r.aasf === a.name && r.fy === fy; });
      var spent = K.sum(rows, function (r) { return r.cost || 0; }), gal = K.sum(rows, function (r) { return r.gal || 0; });
      var used = a.budget ? spent / a.budget : null;
      return { name: a.name, color: a.color, budget: a.budget, spent: spent, gal: gal, rows: rows, used: used, rem: a.budget == null ? null : a.budget - spent,
        pace: C.pace(used, prog.pct), proj: prog.pct > 0 ? spent / prog.pct : null };
    });
    var b = out.some(function (x) { return x.budget != null; }) ? K.sum(out, function (x) { return x.budget || 0; }) : null;
    var sp = K.sum(out, function (x) { return x.spent; }), spb = K.sum(out, function (x) { return x.budget != null ? x.spent : 0; }), gal = K.sum(out, function (x) { return x.gal; });
    var used = b ? spb / b : null;
    return { fy: fy, prog: prog, list: out, budget: b, spent: sp, gal: gal, used: used, rem: b == null ? null : b - spb, pace: C.pace(used, prog.pct), proj: prog.pct > 0 && b ? spb / prog.pct : null };
  }
  function gauge(used, elapsed, over) {
    return '<div class="gauge"><div class="g' + (over ? " over" : "") + '" style="width:' + Math.min(100, Math.max(0, (used || 0) * 100)).toFixed(1) + '%"></div><div class="mk" data-l="Pace ' + C.pct(elapsed) + '" style="left:' + (elapsed * 100).toFixed(1) + '%"></div></div>';
  }
  function progText(p, fy) { return p.state === "current" ? "Day " + p.day + " of " + p.days + " in FY" + fy : p.state === "past" ? "FY" + fy + " complete" : "FY" + fy + " not started"; }

  // ---------- render ----------
  function render() {
    var fy = $("fuFy").value || autoFy(), af = $("fuAasf").value, sel = S.aasfs.filter(function (a) { return !af || a.name === af; });
    var st = stats(fy, sel), all = stats(fy, S.aasfs), p = st.prog;
    var fs = fhpStats(fy, af ? [key(af)] : null), fsAll = fhpStats(fy, null);
    $("fuBasisL").hidden = !fsAll;
    var useF = !!fs && $("fuBasis").value === "fhp"; S.useF = useF;
    $("fuScope").textContent = (af || plural(S.aasfs.length, "AASF")) + " \u00b7 FY" + fy + " \u00b7 " + progText(p, fy) + " (" + C.pct(p.pct) + " elapsed)";
    var ppg = st.gal ? st.spent / st.gal : null;
    $("fuKpis").innerHTML = [
      ["Budget", st.budget == null ? "\u2014" : K.money(st.budget), st.budget == null ? "No budget in B1" : full(st.budget), "--st:#94a3b8"],
      ["Spent", K.money(st.spent), full(st.spent), "--st:#ea580c"],
      ["Remaining", st.rem == null ? "\u2014" : K.money(st.rem), st.rem == null ? "" : full(st.rem), "--st:" + (st.rem != null && st.rem < 0 ? "#dc2626" : "#16a34a")],
      ["Budget used", C.pct(st.used), C.pct(p.pct) + " of the year elapsed", "--st:#f59e0b"],
      ["Gallons", K.fmt(st.gal), plural(K.sum(st.list, function (x) { return x.rows.length; }), "transaction"), "--st:#0d9488"],
      ["Avg cost / gallon", ppg == null ? "\u2014" : "$" + ppg.toFixed(2), "Total cost \u00f7 gallons", "--st:#7c3aed"]
    ].map(function (k) { return '<div class="kpi" style="' + k[3] + '"><div class="lbl">' + k[0] + '</div><div class="val">' + k[1] + '</div><div class="sub">' + esc(k[2]) + "</div></div>"; }).join("");
    var pc = st.pace, h = '<div class="fpace"><div class="pbar"><div class="plbl">Budget used</div><div class="track"><div class="fill" style="background:#ea580c;width:' + Math.min(100, (st.used || 0) * 100).toFixed(1) + '%"></div></div><div class="pval">' + C.pct(st.used) + "</div></div>" +
      '<div class="pbar"><div class="plbl">Fiscal year elapsed</div><div class="track"><div class="fill year" style="width:' + (p.pct * 100).toFixed(1) + '%"></div></div><div class="pval">' + C.pct(p.pct) + "</div></div>";
    if (useF) {
      var R = fs.roll, k = R.pace;
      h += '<p class="pstat ' + (k.k === "funder" ? "funder" : k.k) + '"><strong>' + k.t + "</strong> against the Flying Hour Program &middot; " + full(R.spent) + " spent vs " + full(R.plannedTD) + " planned to date (hours &times; $/hr)" + (R.v == null ? "" : ", " + C.varText(R.v)) + ". Within &plusmn;5% is on pace.</p>";
    } else if (st.budget == null) h += '<p class="pstat">No budget found for the selected AASF' + (sel.length === 1 ? "" : "s") + ".</p>";
    else h += '<p class="pstat ' + pc.k + '"><strong>' + pc.t + "</strong> &middot; " + full(st.spent) + " spent of " + full(st.budget) + " with " + C.pct(p.pct) + " of FY" + esc(fy) + " elapsed" +
      (p.state === "current" && st.proj != null ? ". At this rate the year ends near " + full(st.proj) + " (" + C.pct(st.proj / st.budget) + " of budget)." : ".") + "</p>";
    if (!S.fhp) h += '<p class="pstat muted fhpnote">Straight-line pace. Load the Flying Hour Program (FHP) Excel for hour-based pace (planned hours &times; cost per hour).</p>';
    else if (S.fhp.fatal) h += '<p class="pstat muted fhpnote">The Flying Hour Program file could not be read; see the details drawer. Showing straight-line pace.</p>';
    else if (!fsAll) h += '<p class="pstat muted fhpnote">The Flying Hour Program loaded is for FY' + esc(S.fhp.fy) + '; FY' + esc(fy) + " uses straight-line pace.</p>";
    else if (!useF) h += '<p class="pstat muted fhpnote">Showing straight-line pace; switch Pace basis to Flying Hour Program for hour-based pace.</p>';
    $("fuPace").innerHTML = h + "</div>";
    var fmap = {}; if (fsAll) fsAll.list.forEach(function (x) { fmap[key(x.name)] = x; });
    $("fuCards").innerHTML = all.list.map(function (a) {
      if (useF) { var fx = fmap[key(a.name)]; a = Object.assign({}, a, { pace: fx ? fx.pace : { k: "na", t: "No FHP rows" } }); }
      return '<div class="acard' + (af === a.name ? " sel" : "") + '" data-aasf="' + esc(a.name) + '"><h3><span style="width:10px;height:10px;border-radius:50%;background:' + a.color + ';display:inline-block"></span>' + esc(a.name) +
        '<span class="pill ' + a.pace.k + '">' + (a.budget == null && !useF ? "No budget" : a.pace.t) + "</span></h3>" +
        '<div class="nums"><span>Spent<b>' + K.money(a.spent) + "</b></span><span>Budget<b>" + (a.budget == null ? "\u2014" : K.money(a.budget)) + "</b></span><span>Remaining<b>" + (a.rem == null ? "\u2014" : K.money(a.rem)) + "</b></span></div>" +
        gauge(a.used, p.pct, a.pace.k === "over") + '<div class="gnote"><span>' + C.pct(a.used) + " used</span><span>" + (p.state === "current" && a.proj != null && a.budget ? "Projected " + C.pct(a.proj / a.budget) : K.fmt(a.gal) + " gal") + "</span></div></div>";
    }).join("") || '<p class="muted">No fuel trackers loaded.</p>';
    charts(st, all, fy, useF ? fs : null);
    renderFhp(fy, fsAll, af);
    S.base = S.recs.filter(function (r) { return (!af || r.aasf === af) && (r.fy === fy || !r.fy); }); table();
  }
  // ---------- Flying Hour Program panel ----------
  function chipF(p) { return '<span class="pill ' + p.k + '">' + esc(p.t) + "</span>"; }
  function renderFhp(fy, fs, af) {
    var box = $("fuFhp"); box.hidden = !S.fhp;
    if (!S.fhp) return;
    var F = S.fhp, body = [], groups = fhpGroups();
    if (F.fatal) { $("fuFhpBody").innerHTML = '<p class="warn">' + esc(F.fatal) + "</p>"; $("fuFhpCharts").innerHTML = ""; mapPanel(); return; }
    if (!fs) body.push('<p class="muted">This Flying Hour Program is for FY' + esc(F.fy) + ". Choose FY" + esc(F.fy) + " to compare it with fuel spending.</p>");
    else {
      var R = fs.roll, list = fs.list.filter(function (x) { return !af || key(x.name) === key(af); });
      body.push('<div class="kpis k4">' + [
        ["Planned to date (FHP)", full(R.plannedTD), K.fmt(R.hoursTD, 1) + " planned hours to date", "#2563eb"],
        ["Actual fuel to date", full(R.spent), (R.implied == null ? "" : "\u2248 " + K.fmt(R.implied, 1) + " implied hours at " + full(R.blended) + "/hr blended"), "#ea580c"],
        ["Pace", (R.v == null ? "\u2014" : C.varText(R.v)), R.pace.t + " (on pace within \u00b15%)", R.pace.k === "over" ? "#dc2626" : R.pace.k === "funder" ? "#d97706" : "#16a34a"],
        ["Full-year FHP vs budget", full(R.annual), R.budget == null ? "No B1 budget" : "Budget (B1) " + full(R.budget) + " \u00b7 " + (R.vsBudget > 0 ? "over by " + full(R.vsBudget) : R.vsBudget < 0 ? "under by " + full(-R.vsBudget) : "equal"), "#64748b"]
      ].map(function (k) { return '<div class="kpi" style="--st:' + k[3] + '"><div class="lbl">' + k[0] + '</div><div class="val">' + k[1] + '</div><div class="sub">' + esc(k[2]) + "</div></div>"; }).join("") + "</div>");
      body.push('<div class="tablewrap"><table class="grid" id="tFhp"><thead><tr><th>AASF</th><th>Aircraft</th><th class="num">Planned to date</th><th class="num">Actual to date</th><th class="num">Variance</th><th>Pace</th><th class="num">Planned hrs to date</th><th class="num">Implied hrs</th><th class="num">Full-year FHP $</th><th class="num">Budget (B1)</th><th class="num">FHP \u2212 B1</th></tr></thead><tbody>' +
        list.map(function (x) {
          return '<tr data-aasf="' + esc(x.name) + '"><td><span class="dotc" style="background:' + x.color + '"></span>' + esc(x.name) + (x.tracker ? "" : ' <span class="flag">no fuel tracker loaded</span>') + "</td><td>" + x.group.rows.map(function (q) { return esc(q.label); }).join(" + ") + '</td><td class="num">' + full(x.plannedTD) + '</td><td class="num">' + (x.tracker ? full(x.spent) : "\u2014") + '</td><td class="num">' + (x.tracker && x.v != null ? C.varText(x.v) : "\u2014") + "</td><td>" + (x.tracker ? chipF(x.pace) : '<span class="pill na">No tracker</span>') +
            '</td><td class="num">' + K.fmt(x.hoursTD, 1) + '</td><td class="num">' + (x.tracker && x.implied != null ? K.fmt(x.implied, 1) : "\u2014") + '</td><td class="num">' + full(x.annual) + '</td><td class="num">' + (x.budget == null ? "\u2014" : full(x.budget)) + '</td><td class="num' + (x.vsBudget > 0 ? " neg" : "") + '">' + (x.vsBudget == null ? "\u2014" : (x.vsBudget > 0 ? "+" : "") + full(x.vsBudget)) + "</td></tr>";
        }).join("") + '</tbody><tfoot><tr><td colspan="2">All mapped AASFs</td><td class="num">' + full(R.plannedTD) + '</td><td class="num">' + full(R.spent) + '</td><td class="num">' + (R.v == null ? "\u2014" : C.varText(R.v)) + "</td><td>" + chipF(R.pace) + '</td><td class="num">' + K.fmt(R.hoursTD, 1) + '</td><td class="num">' + (R.implied == null ? "\u2014" : K.fmt(R.implied, 1)) + '</td><td class="num">' + full(R.annual) + '</td><td class="num">' + (R.budget == null ? "\u2014" : full(R.budget)) + '</td><td class="num">' + (R.vsBudget == null ? "\u2014" : (R.vsBudget > 0 ? "+" : "") + full(R.vsBudget)) + "</td></tr></tfoot></table></div>");
      var p = C.fyProgress(fy, today());
      body.push('<p class="muted small">Planned $ = planned hours \u00d7 cost per hour, by fiscal month; aircraft on the same AASF are added together. To date = completed months plus the current month prorated by days (' + (p.state === "current" ? "day " + today().getDate() + " of " + L.FY_MON[C.fmOf(today()) - 1] : p.state) + "). Implied hours = actual fuel $ \u00f7 that AASF\u2019s blended $/hr (full-year FHP $ \u00f7 hours). Over pace (red) = more than 5% above planned to date; Under pace (amber) = more than 5% below; exactly 5% is on pace.</p>");
    }
    $("fuFhpBody").innerHTML = body.join("");
    // per-AASF charts: cumulative FHP plan vs cumulative actual fuel $, with the B1 budget for reference
    var holder = $("fuFhpCharts"), shown = fs ? fs.list.filter(function (x) { return !af || key(x.name) === key(af); }) : [];
    holder.innerHTML = shown.map(function (x, i) { return '<section class="panel fhpc"><h3><span class="dotc" style="background:' + x.color + '"></span>' + esc(x.name) + " " + (x.tracker ? chipF(x.pace) : "") + '</h3><div class="chartbox sm"><canvas id="cFhp' + i + '"></canvas></div></section>'; }).join("");
    var labels = FYM.map(function (m, i) { return (i + 1) + " " + m; });
    shown.forEach(function (x, i) {
      var rows = x.tracker ? S.recs.filter(function (r) { return r.aasf === x.tracker.name && r.fy === fy; }) : [], last = lastMonth(fy, [].concat.apply([], fs.list.filter(function (y) { return y.tracker; }).map(function (y) { return S.recs.filter(function (r) { return r.aasf === y.tracker.name && r.fy === fy; }); })));
      var o = K.chartBase(); o.scales.y.ticks = { callback: function (v) { return K.money(v); } }; o.plugins.tooltip.callbacks = { label: function (z) { return z.dataset.label + ": " + full(z.raw); } };
      var ds = [{ label: "FHP planned (cumulative)", data: cum(x.group.plan, 12), borderColor: "#2563eb", backgroundColor: "#2563eb", pointRadius: 2, tension: .15 },
        { label: "Actual fuel (cumulative)", data: x.tracker ? cum(monthly(rows, function (r) { return r.cost || 0; }), last) : [], borderColor: "#ea580c", backgroundColor: "rgba(234,88,12,.12)", fill: true, pointRadius: 3, tension: .2 }];
      if (x.budget != null) ds.push({ label: "Budget (B1)", data: labels.map(function () { return x.budget; }), borderColor: "#94a3b8", borderDash: [6, 4], pointRadius: 0 });
      K.upsert("cFhp" + i, { type: "line", data: { labels: labels, datasets: ds }, options: o });
    });
    mapPanel(groups);
  }
  function mapPanel() {
    var F = S.fhp; if (!F || F.fatal) { $("fuFhpMap").innerHTML = ""; return; }
    var tr = S.aasfs.map(function (a) { return a.name; }), un = 0;
    var h = '<table class="grid" id="tFhpMap"><thead><tr><th>FHP row</th><th>Aircraft (label)</th><th class="num">Hours</th><th class="num">$/hr</th><th>AASF</th><th></th></tr></thead><tbody>' + F.rows.map(function (q) {
      var m = mapRow(q), k = rowKey(q.label), cur = S.over[k] || "", a = m.auto || autoMap(q);
      if (!m.aasf && m.via !== "ignored") un++;
      var opts = '<option value="">Automatic' + (a.aasf ? ": " + esc(a.aasf) + " (" + esc(a.via) + ")" : " (not matched)") + "</option>" + tr.map(function (t) { return '<option value="' + esc(t) + '"' + (cur === t ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") +
        (cur && cur !== IGNORE && tr.indexOf(cur) < 0 ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + " (no tracker loaded)</option>" : "") + '<option value="' + IGNORE + '"' + (cur === IGNORE ? " selected" : "") + ">Ignore</option>";
      return '<tr data-label="' + esc(q.label) + '"><td>' + q.row + "</td><td>" + esc(q.label) + '</td><td class="num">' + K.fmt(q.annualHours, 1) + '</td><td class="num">' + (q.cph == null ? '<span class="flag">missing</span>' : full(q.cph)) + '</td><td><select data-row="' + esc(k) + '" aria-label="AASF for ' + esc(q.label) + '">' + opts + "</select></td><td>" +
        (m.via === "manual" ? '<span class="muted">your choice</span>' : m.via === "ignored" ? '<span class="muted">ignored</span>' : m.aasf ? '<span class="muted">' + esc(m.via) + "</span>" : '<span class="flag unm">Not mapped \u2014 add \u201c' + esc(q.label) + '\u201d to the Aircraft Key or pick an AASF</span>') + "</td></tr>";
    }).join("") + "</tbody></table>";
    $("fuFhpMap").innerHTML = h + '<p class="muted small">Order: your choice here, then the Aircraft Key (Aircraft, AASF), then a match of the row label to a fuel tracker name. Choices are saved with Save with data and kept in this browser.</p>';
    $("fuFhpMapSum").textContent = "FHP rows \u2192 AASF" + (un ? " \u00b7 " + un + " not mapped" : "");
    if (un) $("fuFhpMapBox").open = true;
  }
  function lastMonth(fy, rows) { var p = C.fyProgress(fy); if (p.state === "past") return 12; var lm = 0; rows.forEach(function (r) { if (r.fm > lm) lm = r.fm; }); return p.state === "current" ? Math.max(lm, C.fmOf(new Date())) : lm; }
  function monthly(rows, f) { var m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; rows.forEach(function (r) { if (r.fm) m[r.fm - 1] += f(r); }); return m; }
  function cum(m, last) { var t = 0; return m.map(function (v, i) { t += v; return i < last ? Math.round(t * 100) / 100 : null; }); }
  function charts(st, all, fy, fs) {
    var labels = FYM.map(function (m, i) { return (i + 1) + " " + m; }), rows = [].concat.apply([], st.list.map(function (a) { return a.rows; })), last = lastMonth(fy, rows);
    var mo = function () { var o = K.chartBase(); o.scales.y.ticks = { callback: function (v) { return K.money(v); } }; o.plugins.tooltip.callbacks = { label: function (x) { return x.dataset.label + ": " + full(x.raw); } }; return o; };
    var ds = [{ label: "Cumulative spend", data: cum(monthly(rows, function (r) { return r.cost || 0; }), last), borderColor: "#ea580c", backgroundColor: "rgba(234,88,12,.12)", fill: true, tension: .2, pointRadius: 3 }];
    if (fs) ds.push({ label: "FHP planned (hours \u00d7 $/hr)", data: cum(fs.list.filter(function (x) { return x.tracker; }).reduce(function (m, x) { return m.map(function (v, i) { return v + x.group.plan[i]; }); }, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 12), borderColor: "#2563eb", backgroundColor: "#2563eb", pointRadius: 2, fill: false, tension: .15 });
    $("fuCumTitle").textContent = fs ? "Cumulative spend vs Flying Hour Program plan" : "Cumulative spend vs straight-line budget pace";
    if (st.budget) ds.push({ label: "Straight-line budget pace", data: labels.map(function (x, i) { return Math.round(st.budget * (i + 1) / 12); }), borderColor: "#94a3b8", borderDash: [6, 4], pointRadius: 0, fill: false });
    K.upsert("cFuCum", { type: "line", data: { labels: labels, datasets: ds }, options: mo() });
    $("fuCumNote").textContent = (st.list.length > 1 ? "All " + st.list.length + " AASFs combined" : st.list.length ? st.list[0].name : "") + " \u00b7 by fiscal month (1 = Oct). " + (last < 12 ? "Months after " + (last ? FYM[last - 1] : "the start") + " are not drawn yet." : "");
    var po = K.chartBase(); po.scales.y.ticks = { callback: function (v) { return v + "%"; } }; po.plugins.tooltip.callbacks = { label: function (x) { return x.dataset.label + ": " + (x.raw == null ? "\u2014" : x.raw.toFixed(1) + "%"); } };
    var pds = all.list.filter(function (a) { return a.budget; }).map(function (a) { return { label: a.name, data: cum(monthly(a.rows, function (r) { return r.cost || 0; }), last).map(function (v) { return v == null ? null : v / a.budget * 100; }), borderColor: a.color, backgroundColor: a.color, tension: .2, pointRadius: 2 }; });
    pds.push({ label: "Straight-line pace", data: labels.map(function (x, i) { return (i + 1) / 12 * 100; }), borderColor: "#94a3b8", borderDash: [6, 4], pointRadius: 0 });
    K.upsert("cFuPct", { type: "line", data: { labels: labels, datasets: pds }, options: po });
    var mo2 = mo(); mo2.scales.x.stacked = true; mo2.scales.y.stacked = true;
    mo2.scales.y1 = { position: "right", grid: { drawOnChartArea: false }, ticks: { callback: function (v) { return K.fmt(v); } } };
    mo2.plugins.tooltip.callbacks = { label: function (x) { return x.dataset.label + ": " + (x.dataset.yAxisID === "y1" ? K.fmt(x.raw) + " gal" : full(x.raw)); } };
    var mds = st.list.map(function (a) { return { type: "bar", label: a.name + " cost", data: monthly(a.rows, function (r) { return r.cost || 0; }).map(function (v, i) { return i < last ? Math.round(v * 100) / 100 : null; }), backgroundColor: a.color, stack: "c" }; });
    mds.push({ type: "line", label: "Gallons", yAxisID: "y1", data: monthly(rows, function (r) { return r.gal || 0; }).map(function (v, i) { return i < last ? Math.round(v) : null; }), borderColor: "#0f172a", backgroundColor: "#0f172a", pointRadius: 2, tension: .2 });
    K.upsert("cFuMon", { type: "bar", data: { labels: labels, datasets: mds }, options: mo2 });
    var go = K.chartBase(); go.scales.y.ticks = { callback: function (v) { return "$" + Number(v).toFixed(2); } }; go.plugins.tooltip.callbacks = { label: function (x) { return x.dataset.label + ": " + (x.raw == null ? "\u2014" : "$" + x.raw.toFixed(3) + "/gal"); } };
    var gds = st.list.map(function (a) { var c = monthly(a.rows, function (r) { return r.cost || 0; }), g = monthly(a.rows, function (r) { return r.gal || 0; }); return { label: a.name, data: c.map(function (v, i) { return g[i] ? v / g[i] : null; }), borderColor: a.color, backgroundColor: a.color, tension: .2, pointRadius: 3, spanGaps: true }; });
    K.upsert("cFuPpg", { type: "line", data: { labels: labels, datasets: gds }, options: go });
  }
  var TCOLS = [["d", "Date", 0], ["aasf", "AASF", 0], ["ms", "Milstrip Number", 0], ["gal", "Gallons", 1], ["cost", "Total Cost", 1], ["ppg", "$ / gal", 1], ["fm", "Fiscal Month", 0]];
  function table() {
    var q = ($("fuSearch").value || "").trim().toLowerCase(), rows = S.base || [];
    if (q) rows = rows.filter(function (r) { return [r.iso, r.aasf, r.ms, C.dateText(r.d)].join(" ").toLowerCase().indexOf(q) >= 0; });
    var k = S.sort.k, dir = S.sort.dir;
    rows = rows.slice().sort(function (a, b) {
      var x = k === "d" ? (a.d ? +a.d : 0) - (b.d ? +b.d : 0) : k === "ppg" ? (a.gal ? a.cost / a.gal : 0) - (b.gal ? b.cost / b.gal : 0) : k === "gal" || k === "cost" || k === "fm" ? (a[k] || 0) - (b[k] || 0) : cmpVal(a[k] || "", b[k] || "");
      return x * dir || cmpVal(a.ms, b.ms);
    });
    S.shown = rows;
    $("fuNote").textContent = q ? K.fmt(rows.length) + " transactions match \u201c" + $("fuSearch").value.trim() + "\u201d" : "";
    $("tFu").tHead.innerHTML = "<tr>" + TCOLS.map(function (c) { var on = k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[2] ? "num" : "") + (on ? " sorted" + (dir > 0 ? " asc" : "") : "") + '">' + esc(c[1]) + "</th>"; }).join("") + "</tr>";
    var show = rows.slice(0, S.showAll ? 5000 : PAGE), dash = '<span class="muted">\u2014</span>';
    $("tFu").tBodies[0].innerHTML = show.length ? show.map(function (r) {
      return "<tr><td>" + (r.d ? C.dateText(r.d) : '<span class="flag">No date</span>') + "</td><td>" + esc(r.aasf) + "</td><td>" + (r.ms ? esc(r.ms) : dash) + '</td><td class="num">' + (r.gal == null ? dash : K.fmt(r.gal, 1)) + '</td><td class="num">' + (r.cost == null ? dash : full(r.cost)) +
        '</td><td class="num">' + (r.gal && r.cost != null ? "$" + (r.cost / r.gal).toFixed(3) : dash) + "</td><td>" + (r.fm ? L.fmLabel(r.fm) : dash) + "</td></tr>";
    }).join("") : '<tr><td colspan="7" class="muted">' + (S.recs.length ? "No transactions match." : "No fuel trackers loaded.") + "</td></tr>";
    var g = K.sum(rows, function (r) { return r.gal || 0; }), c = K.sum(rows, function (r) { return r.cost || 0; });
    $("tFu").tFoot.innerHTML = rows.length ? '<tr><td colspan="3">Total (' + plural(rows.length, "transaction") + (rows.length > show.length ? ", " + K.fmt(show.length) + " shown" : "") + ')</td><td class="num">' + K.fmt(g, 1) + '</td><td class="num">' + full(c) + '</td><td class="num">' + (g ? "$" + (c / g).toFixed(3) : "") + "</td><td></td></tr>" : "";
    var b = $("fuAll"); b.style.display = rows.length > PAGE ? "" : "none"; b.textContent = S.showAll ? "Show " + PAGE : "Show all " + K.fmt(rows.length);
  }
  function exportCsv() {
    var d = new Date();
    K.downloadCsv("fuel_transactions_" + d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) + ".csv", ["Date", "AASF", "Milstrip Number", "Gallons", "Total Cost", "Fiscal Year", "Fiscal Month"],
      S.shown.map(function (r) { return [r.iso, r.aasf, r.ms, r.gal == null ? "" : r.gal, r.cost == null ? "" : r.cost.toFixed(2), r.fy, r.fm || ""]; }));
  }
  function summary() { if (!S.recs.length && !S.aasfs.length) return null; return stats(autoFy(), S.aasfs); }

  C.register("fuel", {
    classify: classify, parse: parse, ingest: ingest, clear: clear, demo: demo, snapshot: snapshot, restore: restore, report: report, render: render,
    entries: function () { return S.files.concat(S.fhp ? [S.fhp] : [], S.akey && S.akey.file ? [S.akey] : []); }, hasData: function () { return S.aasfs.length > 0 || !!(S.fhp && !S.fhp.fatal); }, summary: summary,
    init: function () {
      ["fuFy", "fuAasf"].forEach(function (id) { $(id).addEventListener("change", function () { S.showAll = false; render(); }); });
      $("fuReset").addEventListener("click", function () { $("fuAasf").value = ""; $("fuFy").value = autoFy(); $("fuSearch").value = ""; S.showAll = false; render(); });
      $("fuCards").addEventListener("click", function (e) { var c = e.target.closest("[data-aasf]"); if (!c) return; var v = c.getAttribute("data-aasf"); $("fuAasf").value = $("fuAasf").value === v ? "" : v; S.showAll = false; render(); });
      var st; $("fuSearch").addEventListener("input", function () { clearTimeout(st); st = setTimeout(table, 120); });
      $("fuCsv").addEventListener("click", exportCsv);
      $("fuAll").addEventListener("click", function () { S.showAll = !S.showAll; table(); });
      $("fuBasis").addEventListener("change", function () { render(); });
      $("fuFhpMap").addEventListener("change", function (e) {
        var t = e.target; if (!t.matches || !t.matches("select[data-row]")) return;
        var k = t.getAttribute("data-row"); if (t.value) S.over[k] = t.value; else delete S.over[k];
        saveSettings(); render(); if (C.renderDrawer) C.renderDrawer();
      });
      $("fuFhpCharts").addEventListener("click", function () { });
      $("tFu").tHead.addEventListener("click", function (e) { var th = e.target.closest("th[data-k]"); if (!th) return; var k = th.getAttribute("data-k"); S.sort = S.sort.k === k ? { k: k, dir: -S.sort.dir } : { k: k, dir: k === "aasf" || k === "ms" ? 1 : -1 }; table(); });
    },
    _state: S, _toDate: toDate, fhpStats: function (fy) { return fhpStats(fy || $("fuFy").value || autoFy()); }, fhpGroups: fhpGroups, mapRow: mapRow, fhpPace: fhpPace, STORE_KEY: STORE_KEY
  });
})(window);
