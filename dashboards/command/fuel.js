/* Command Dashboard: Fuel. One tracker per AASF (file name = AASF name). Budget in cell B1; table header near row 13 with
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
  var S = { files: [], recs: [], aasfs: [], sort: { k: "d", dir: -1 }, showAll: false, shown: [], order: 0 };

  function aasfName(fname) { return String(fname || "").replace(/\.[a-z0-9]+$/i, "").replace(/\s*\(\d+\)$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "AASF"; }
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

  function classify(src) {
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
  function clear() { S.files = []; combine(); }
  function demo() {
    var D = w.COMMAND_DEMO; if (!D) return;
    S.files = D.fuel.map(function (f) { return parse("fuel", L.aoaSource(f.grid), f.name, null, f.name, (f.grid[0] || [])[1]); });
    combine();
  }
  function snapshot() { return { files: S.files.filter(usable).map(function (e) { return { name: e.name, aasf: e.aasf, budget: e.budget, rows: e.rows.map(function (r) { return [r.iso, r.ms, r.gal == null ? "" : r.gal, r.cost == null ? "" : r.cost]; }) }; }) }; }
  function restore(o) {
    S.files = (o.files || []).map(function (f) {
      var grid = [["Total Fuel Budget", f.budget == null ? "" : f.budget], ["Date", "Milstrip Number", "Gallons", "Total Cost"]].concat(f.rows);
      var e = parse("fuel", L.aoaSource(grid), (f.aasf || "AASF") + ".xlsx", null, f.name, f.budget);
      return e;
    });
    combine();
  }
  function report() {
    if (!S.files.length) return { html: "", warns: 0 };
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
    if (st.budget == null) h += '<p class="pstat">No budget found for the selected AASF' + (sel.length === 1 ? "" : "s") + ".</p>";
    else h += '<p class="pstat ' + pc.k + '"><strong>' + pc.t + "</strong> &middot; " + full(st.spent) + " spent of " + full(st.budget) + " with " + C.pct(p.pct) + " of FY" + esc(fy) + " elapsed" +
      (p.state === "current" && st.proj != null ? ". At this rate the year ends near " + full(st.proj) + " (" + C.pct(st.proj / st.budget) + " of budget)." : ".") + "</p>";
    $("fuPace").innerHTML = h + "</div>";
    $("fuCards").innerHTML = all.list.map(function (a) {
      return '<div class="acard' + (af === a.name ? " sel" : "") + '" data-aasf="' + esc(a.name) + '"><h3><span style="width:10px;height:10px;border-radius:50%;background:' + a.color + ';display:inline-block"></span>' + esc(a.name) +
        '<span class="pill ' + a.pace.k + '">' + (a.budget == null ? "No budget" : a.pace.t) + "</span></h3>" +
        '<div class="nums"><span>Spent<b>' + K.money(a.spent) + "</b></span><span>Budget<b>" + (a.budget == null ? "\u2014" : K.money(a.budget)) + "</b></span><span>Remaining<b>" + (a.rem == null ? "\u2014" : K.money(a.rem)) + "</b></span></div>" +
        gauge(a.used, p.pct, a.pace.k === "over") + '<div class="gnote"><span>' + C.pct(a.used) + " used</span><span>" + (p.state === "current" && a.proj != null && a.budget ? "Projected " + C.pct(a.proj / a.budget) : K.fmt(a.gal) + " gal") + "</span></div></div>";
    }).join("") || '<p class="muted">No fuel trackers loaded.</p>';
    charts(st, all, fy);
    S.base = S.recs.filter(function (r) { return (!af || r.aasf === af) && (r.fy === fy || !r.fy); }); table();
  }
  function lastMonth(fy, rows) { var p = C.fyProgress(fy); if (p.state === "past") return 12; var lm = 0; rows.forEach(function (r) { if (r.fm > lm) lm = r.fm; }); return p.state === "current" ? Math.max(lm, C.fmOf(new Date())) : lm; }
  function monthly(rows, f) { var m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; rows.forEach(function (r) { if (r.fm) m[r.fm - 1] += f(r); }); return m; }
  function cum(m, last) { var t = 0; return m.map(function (v, i) { t += v; return i < last ? Math.round(t * 100) / 100 : null; }); }
  function charts(st, all, fy) {
    var labels = FYM.map(function (m, i) { return (i + 1) + " " + m; }), rows = [].concat.apply([], st.list.map(function (a) { return a.rows; })), last = lastMonth(fy, rows);
    var mo = function () { var o = K.chartBase(); o.scales.y.ticks = { callback: function (v) { return K.money(v); } }; o.plugins.tooltip.callbacks = { label: function (x) { return x.dataset.label + ": " + full(x.raw); } }; return o; };
    var ds = [{ label: "Cumulative spend", data: cum(monthly(rows, function (r) { return r.cost || 0; }), last), borderColor: "#ea580c", backgroundColor: "rgba(234,88,12,.12)", fill: true, tension: .2, pointRadius: 3 }];
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
    entries: function () { return S.files; }, hasData: function () { return S.aasfs.length > 0; }, summary: summary,
    init: function () {
      ["fuFy", "fuAasf"].forEach(function (id) { $(id).addEventListener("change", function () { S.showAll = false; render(); }); });
      $("fuReset").addEventListener("click", function () { $("fuAasf").value = ""; $("fuFy").value = autoFy(); $("fuSearch").value = ""; S.showAll = false; render(); });
      $("fuCards").addEventListener("click", function (e) { var c = e.target.closest("[data-aasf]"); if (!c) return; var v = c.getAttribute("data-aasf"); $("fuAasf").value = $("fuAasf").value === v ? "" : v; S.showAll = false; render(); });
      var st; $("fuSearch").addEventListener("input", function () { clearTimeout(st); st = setTimeout(table, 120); });
      $("fuCsv").addEventListener("click", exportCsv);
      $("fuAll").addEventListener("click", function () { S.showAll = !S.showAll; table(); });
      $("tFu").tHead.addEventListener("click", function (e) { var th = e.target.closest("th[data-k]"); if (!th) return; var k = th.getAttribute("data-k"); S.sort = S.sort.k === k ? { k: k, dir: -S.sort.dir } : { k: k, dir: k === "aasf" || k === "ms" ? 1 : -1 }; table(); });
    },
    _state: S, _toDate: toDate
  });
})(window);
