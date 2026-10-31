/* Status of Funds: spend plan file + spending trend (cumulative vs straight-line pace vs plan, monthly bars, pace indicator).
   Loaded after funding.js and before finance.js. Everything runs in the browser; nothing is uploaded. */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, $ = K.$, esc = K.esc, n = L.n, full = L.full, plural = L.plural;
  var C_ACT = "#5aa6e6", C_PACE = "#9aa7b8", C_PLAN = "#e3b34c", C_BAR = "#a9c16a";

  // ---------- spend plan file ----------
  var PCOLS = [
    ["fy", "Fiscal Year", ["fiscalyear", "fy"]],
    ["fa", "Functional Area", ["functionalareafarea", "functionalarea", "farea"]],
    ["acct", "Account", ["account", "accountname", "acctname", "acct"]],
    ["fm", "Fiscal Month", ["fiscalmonth", "month", "fiscalperiod", "period", "fm", "fiscalmo"]],
    ["amt", "Planned Amount", ["plannedamount", "planamount", "plannedamt", "planned", "spendplan", "plan", "plannedspend", "planamt"]]
  ];
  var PALIAS = L.aliasMap(PCOLS), PLABEL = {}; PCOLS.forEach(function (c) { PLABEL[c[0]] = c[1]; });
  function parsePlan(src) {
    var hm = L.mapHeaders(src, PALIAS), map = hm.map;
    var rep = { kind: "plan", headerRow: hm.hi + 1, cols: PCOLS.filter(function (c) { return map[c[0]] != null; }).map(function (c) { return c[1]; }),
      missing: [], extra: hm.extra, dupes: hm.dupes, pii: hm.pii, rowsRead: 0, rowsLoaded: 0, blankRows: 0, badMonth: 0, badNumber: 0, badNumberExamples: [], fatal: null };
    if (map.fm == null) rep.missing.push("Fiscal Month");
    if (map.amt == null) rep.missing.push("Planned Amount");
    if (rep.missing.length) { rep.fatal = "A spend plan needs Fiscal Month and Planned Amount columns; missing: " + rep.missing.join(", ") + "."; return { rows: [], report: rep }; }
    var out = [];
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var get = function (k) { return map[k] == null ? null : src.get(rr, map[k]); };
      var vfm = get("fm"), vamt = get("amt");
      if (["fy", "fa", "acct"].every(function (k) { return L.blankish(get(k)); }) && L.blankish(vfm) && L.blankish(vamt)) { rep.blankRows++; continue; }
      rep.rowsRead++;
      var fm = L.fmNum(vfm), amt = L.parseAmt(vamt);
      if (!fm) { rep.badMonth++; if (rep.badNumberExamples.length < 5) rep.badNumberExamples.push({ row: rr + 1, column: "Fiscal Month", value: L.txt(vfm) }); continue; }
      if (amt !== null && isNaN(amt)) { L.badNum(rep, rr + 1, "Planned Amount", vamt); amt = null; }
      out.push({ fy: L.fyText(get("fy")), fa: L.idText(get("fa")), acct: L.idText(get("acct")), fm: fm, amt: amt });
    }
    rep.rowsLoaded = out.length;
    return { rows: out, report: rep };
  }
  function buildPlan(entries) {
    if (!entries.length) return null;
    var rows = [];
    entries.forEach(function (e) { e.rows.forEach(function (r) { rows.push(r); }); });
    return { rows: rows, hasFy: rows.some(function (r) { return r.fy; }), hasFa: rows.some(function (r) { return r.fa; }), hasAcct: rows.some(function (r) { return r.acct; }), files: entries.map(function (e) { return e.name; }) };
  }
  function fileLines(e, codes) {
    var rep = e.rep, h = [], warns = 0;
    h.push('<p class="ok">Spend plan: ' + plural(rep.rowsLoaded, "row") + " loaded (header row " + rep.headerRow + "). Columns: " + codes(rep.cols) + ".</p>");
    if (rep.badMonth) { warns++; h.push('<p class="warn">' + plural(rep.badMonth, "row") + " skipped because the Fiscal Month is blank or not 1&ndash;12 / a month name.</p>"); }
    return { html: h.join(""), warns: warns };
  }

  // ---------- which year the trend shows ----------
  // The year filter if set; otherwise the current fiscal year once it has 2+ months of data, else the latest earlier year with data.
  function autoYear(years, monthsByYear, fFy) {
    if (fFy && fFy !== L.BLANK) return { fy: fFy, why: "the Fiscal Year filter" };
    var now = L.fiscalNow(new Date());
    if (years.indexOf(now.fy) >= 0 && (monthsByYear[now.fy] || 0) >= 2) return { fy: now.fy, why: "the current fiscal year" };
    var past = years.filter(function (y) { return +y < +now.fy; });
    if (past.length) return { fy: past[past.length - 1], why: years.indexOf(now.fy) >= 0 ? "the latest full year; FY" + now.fy + " has under 2 months of data" : "the latest year with data" };
    return years.length ? { fy: years[years.length - 1], why: "the latest year with data" } : { fy: "", why: "" };
  }
  // ---------- plan months for the year, limited to the filtered accounts when the plan has Functional Area or Account ----------
  function planMonths(plan, fund, fy, scopeRows, filtered) {
    var rows = plan.rows.filter(function (r) { return !r.fy || r.fy === fy; }), note = "";
    if (filtered) {
      if (plan.hasFa || plan.hasAcct) {
        var fas = Object.create(null), accts = Object.create(null);
        scopeRows.forEach(function (r) { if (r.fa) { fas[L.kn("fa", r.fa)] = 1; var a = L.account(fund, r.fa); if (a) accts[a.toLowerCase()] = 1; } });
        rows = rows.filter(function (r) { return r.fa ? fas[L.kn("fa", r.fa)] : r.acct ? accts[r.acct.toLowerCase()] : false; });
        note = "Plan limited to the Functional Areas in the current filters.";
      } else note = "The plan has no Functional Area or Account, so it is not split by the filters.";
    }
    var m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    rows.forEach(function (r) { m[r.fm - 1] += n(r.amt); });
    return { months: m, rows: rows.length, note: note };
  }

  // ---------- render ----------
  // c = { rows: lines after every filter except Fiscal Year / Fiscal Month, f: filters, fund, plan, joinedFor(fy), filtered: bool, source }
  var METRIC = { od: ["Obligation + Disbursement", function (r) { return n(r.obl) + n(r.disb); }], o: ["Obligation", function (r) { return n(r.obl); }], d: ["Disbursement", function (r) { return n(r.disb); }] };
  function render(c) {
    var yearsSet = Object.create(null), mby = Object.create(null), seen = Object.create(null);
    c.rows.forEach(function (r) { if (!r.fy) return; yearsSet[r.fy] = 1; if (r.fmn && !seen[r.fy + "|" + r.fmn]) { seen[r.fy + "|" + r.fmn] = 1; mby[r.fy] = (mby[r.fy] || 0) + 1; } });
    var years = Object.keys(yearsSet).sort(), sel = $("tFy"), cur = sel.value, auto = autoYear(years, mby, c.f.fy);
    sel.innerHTML = '<option value="">Auto' + (auto.fy ? " (FY" + esc(auto.fy) + ")" : "") + "</option>" + years.map(function (y) { return '<option value="' + esc(y) + '">FY' + esc(y) + "</option>"; }).join("");
    if (cur && years.indexOf(cur) >= 0) sel.value = cur;
    var fy = sel.value || auto.fy, why = sel.value ? "your choice" : auto.why;
    var mk = $("tMetric").value || "od", metric = METRIC[mk], val = metric[1];
    var yr = c.rows.filter(function (r) { return r.fy === fy; }), mon = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], noM = 0, noMAmt = 0, latest = 0, total = 0;
    yr.forEach(function (r) { var v = val(r); total += v; if (r.fmn) { mon[r.fmn - 1] += v; if (r.fmn > latest) latest = r.fmn; } else { noM++; noMAmt += v; } });
    var now = L.fiscalNow(new Date()), elapsed, elapsedWhy;
    if (fy === now.fy) { elapsed = now.fm; elapsedWhy = "today is in month " + now.fm + " (" + L.FY_MON[now.fm - 1] + ") of FY" + fy; }
    else if (+fy < +now.fy) { elapsed = 12; elapsedWhy = "FY" + fy + " has ended"; }
    else { elapsed = latest; elapsedWhy = "FY" + fy + " has not started; latest month with data"; }
    var lastM = fy === now.fy ? Math.max(now.fm, latest) : +fy < +now.fy ? 12 : latest;
    var j = c.fund && fy ? c.joinedFor(fy) : null, tdp = j && j.totals.tdp ? j.totals.tdp : null, tdpByYear = c.fund && c.fund.keys.indexOf("fy") >= 0;
    var plan = c.plan && fy ? planMonths(c.plan, c.fund, fy, c.rows, c.filtered) : null;
    var labels = L.FY_MON.map(function (m, i) { return (i + 1) + " " + m; }), cum = [], pace = [], pcum = [], run = 0, prun = 0;
    for (var i = 0; i < 12; i++) {
      run += mon[i]; cum.push(i < lastM ? Math.round(run * 100) / 100 : null);
      pace.push(tdp != null ? Math.round(tdp * (i + 1) / 12 * 100) / 100 : null);
      if (plan) { prun += plan.months[i]; pcum.push(Math.round(prun * 100) / 100); }
    }
    var mo = function (h) { var o = K.chartBase(); o.scales.y.ticks = { callback: function (v) { return K.money(v); } }; o.plugins.tooltip.callbacks = { label: function (x) { return x.dataset.label + ": " + full(x.raw); } }; return o; };
    var ds = [{ type: "line", label: "Cumulative spent (" + metric[0] + ")", data: cum, borderColor: C_ACT, backgroundColor: C_ACT, tension: 0.15, pointRadius: 3, spanGaps: false }];
    if (tdp != null) ds.push({ type: "line", label: "Straight-line pace (TDP \u00d7 month/12)", data: pace, borderColor: C_PACE, backgroundColor: C_PACE, borderDash: [6, 4], pointRadius: 0 });
    if (plan) ds.push({ type: "line", label: "Spend plan (cumulative)", data: pcum, borderColor: C_PLAN, backgroundColor: C_PLAN, pointRadius: 2 });
    K.upsert("cCum", { type: "line", data: { labels: labels, datasets: ds }, options: mo() });
    var bds = [{ type: "bar", label: "Spent (" + metric[0] + ")", data: mon.map(function (v, i) { return i < lastM ? Math.round(v * 100) / 100 : null; }), backgroundColor: C_BAR }];
    if (plan) bds.push({ type: "line", label: "Spend plan", data: plan.months, borderColor: C_PLAN, backgroundColor: C_PLAN, pointRadius: 2 });
    K.upsert("cMon", { type: "bar", data: { labels: labels, datasets: bds }, options: mo() });

    // hints
    $("paceHint").hidden = !!c.fund; $("planHint").hidden = !!c.plan || c.source === "demo";
    // where we should be
    var ep = elapsed / 12, sp = tdp ? total / tdp : null, h = [];
    if (!fy) h.push('<p class="muted">No lines with a Fiscal Year in the current filters.</p>');
    else if (sp == null) h.push('<p class="muted">' + (c.fund ? "No TDP for FY" + esc(fy) + " in the current filters" : "Load the funding file to compare spending with TDP") + ". " + Math.round(ep * 100) + "% of FY" + esc(fy) + " has elapsed (" + esc(elapsedWhy) + ").</p>");
    else {
      var diff = Math.round((sp - ep) * 100), st = Math.abs(diff) <= 5 ? "on" : diff > 0 ? "ahead" : "behind";
      h.push('<div class="pacegrid">' +
        '<div class="pbar"><div class="plbl">% of TDP spent</div><div class="track"><div class="fill spent" style="width:' + Math.min(100, Math.max(0, sp * 100)).toFixed(1) + '%"></div></div><div class="pval">' + Math.round(sp * 100) + "%</div></div>" +
        '<div class="pbar"><div class="plbl">% of year elapsed</div><div class="track"><div class="fill year" style="width:' + (ep * 100).toFixed(1) + '%"></div></div><div class="pval">' + Math.round(ep * 100) + "%</div></div></div>");
      h.push('<p class="pstat ' + st + '"><strong>' + (st === "on" ? "On pace" : st === "ahead" ? "Ahead of the straight-line pace by " + diff + " points" : "Behind the straight-line pace by " + (-diff) + " points") + "</strong> &middot; FY" + esc(fy) + ": " + full(total) + " spent (" + esc(metric[0]) + ") of TDP " + full(tdp) + "; year elapsed = " + elapsed + "/12 because " + esc(elapsedWhy) + ".</p>");
    }
    $("pace").innerHTML = h.join("");
    var notes = ["Showing FY" + (fy || "\u2014") + ": " + why + ". Spent = " + metric[0] + " by the line's fiscal month (1 = Oct \u2026 12 = Sep)."];
    if (lastM < 12) notes.push("Months after " + (lastM ? L.FY_MON[lastM - 1] : "the start") + " are not drawn yet.");
    if (noM) notes.push(plural(noM, "line") + " (" + full(noMAmt) + ") " + (noM === 1 ? "has" : "have") + " no fiscal month: counted in % of TDP, not in the monthly charts.");
    if (c.f.fm) notes.push("The Fiscal Month filter does not apply to the trend.");
    if (tdp != null && !tdpByYear) notes.push("The funding file has no Fiscal Year, so the pace uses TDP for all years.");
    if (plan && plan.note) notes.push(plan.note);
    if (plan && !plan.rows) notes.push("The spend plan has no rows for FY" + fy + ".");
    $("trendNote").textContent = notes.join(" ");
    return { fy: fy, total: total, tdp: tdp, elapsed: elapsed, cum: cum, plan: plan ? pcum : null };
  }

  w.FundsTrend = { PCOLS: PCOLS, PLABEL: PLABEL, parsePlan: parsePlan, buildPlan: buildPlan, fileLines: fileLines, render: render };
})(window);
