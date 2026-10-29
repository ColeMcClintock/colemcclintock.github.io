/* Status of Funds Dashboard - all processing happens in the browser. */
(function () {
  "use strict";
  var K = window.DashKit, $ = K.$, esc = K.esc, uniq = K.uniq, sum = K.sum, money = K.money;
  var APPN_COLORS = { NGPA: "#5aa6e6", OMNG: "#a9b97a", MCNG: "#d6c48f", STATE: "#b48ee0" };
  var ONE_YEAR = { NGPA: 1, OMNG: 1, STATE: 1 };
  var COLUMNS = [
    ["fy", false, "Fiscal year, e.g. FY26 (derived from month if blank)"], ["month", true, "Month, YYYY-MM"],
    ["appropriation", true, "NGPA, OMNG, MCNG, STATE (or your own)"], ["program_code", true, "Program / funding code"], ["program_name", false, "Program description"],
    ["brigade", true, "Parent brigade / command"], ["organization", true, "Battalion or fund holder"],
    ["afp", true, "Annual Funding Program (enter once per program/org/FY)"], ["allotment", true, "Funds released this month"],
    ["plan_obligations", true, "Spend plan for this month"], ["commitments", true, "Commitments this month"], ["obligations", true, "Obligations this month"],
    ["disbursements", true, "Disbursements this month"], ["tdy_obligations", false, "Travel (TDY) obligations this month"]
  ];
  var NUM = ["afp", "allotment", "plan_obligations", "commitments", "obligations", "disbursements", "tdy_obligations"];
  var DEMO = window.FINANCE_DATA || { records: [], ufr: [] };
  var S = { recs: [], ufr: [], sortKey: "var", sortAsc: true, varRows: [] };

  function fyOf(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); return "FY" + String(mo >= 10 ? y + 1 : y).slice(2); }
  function fyMonths(fy) { var y = 2000 + +fy.slice(2) - 1, out = []; for (var i = 0; i < 12; i++) out.push(K.addMonths(y + "-10", i)); return out; }

  function normalize(rows) {
    var out = [];
    rows.forEach(function (r0) {
      var r = K.lowerKeys(r0), m = K.toMonth(r.month); if (!m || !r.program_code) return;
      var o = { month: m, fy: String(r.fy || "").trim().toUpperCase() || fyOf(m), appropriation: String(r.appropriation || "").trim().toUpperCase(),
        program_code: String(r.program_code).trim(), program_name: String(r.program_name || r.program_code).trim(),
        brigade: String(r.brigade || "").trim(), organization: String(r.organization || "").trim() };
      if (!/^FY\d{2}$/.test(o.fy)) o.fy = fyOf(m);
      NUM.forEach(function (k) { o[k] = +r[k] || 0; });
      out.push(o);
    });
    return out;
  }
  function setData(recs, ufr, source) {
    S.recs = normalize(recs);
    S.ufr = (ufr || []).map(function (u0) { var u = K.lowerKeys(u0); u.amount = +u.amount || 0; u.fy = String(u.fy || "").toUpperCase(); return u; });
    $("sourceLabel").textContent = source === "demo" ? "" : " \u00B7 " + source;
    buildFilters(true); render();
  }

  function buildFilters(reset) {
    var R = S.recs, fys = uniq(R.map(function (r) { return r.fy; })).sort();
    var fy = reset ? null : $("fFy").value;
    K.fillSelect($("fFy"), fys, null, !reset);
    if (reset) $("fFy").value = fys.indexOf("FY26") >= 0 ? "FY26" : fys[fys.length - 1];
    fy = $("fFy").value;
    var months = uniq(R.filter(function (r) { return r.fy === fy; }).map(function (r) { return r.month; })).sort().reverse(), cur = $("fMonth").value;
    K.fillSelect($("fMonth"), months, null, false, months.map(K.monthLabel));
    if (!reset && months.indexOf(cur) >= 0) $("fMonth").value = cur;
    K.fillSelect($("fAppn"), uniq(R.map(function (r) { return r.appropriation; })).sort(), "All appropriations", !reset);
    K.fillSelect($("fBrigade"), uniq(R.map(function (r) { return r.brigade; })).sort(), "All brigades", !reset);
    var b = $("fBrigade").value;
    K.fillSelect($("fOrg"), uniq(R.filter(function (r) { return !b || r.brigade === b; }).map(function (r) { return r.organization; })).sort(), "All organizations", !reset);
  }
  function scopeLabel() { var p = [$("fAppn").value, $("fBrigade").value, $("fOrg").value].filter(Boolean); return p.length ? p.join(" \u203A ") : "All funds, all organizations"; }

  function totals(rows) {
    var o = {}; NUM.forEach(function (k) { o[k] = sum(rows, function (r) { return r[k]; }); }); return o;
  }

  function render() {
    if (!S.recs.length) { $("summary").textContent = "No data loaded."; return; }
    var fy = $("fFy").value, asof = $("fMonth").value, months = fyMonths(fy);
    var mi = months.indexOf(asof), remaining = 11 - mi;
    var ap = $("fAppn").value, b = $("fBrigade").value, org = $("fOrg").value;
    var scoped = S.recs.filter(function (r) { return r.fy === fy && (!ap || r.appropriation === ap) && (!b || r.brigade === b) && (!org || r.organization === org); });
    var toDate = scoped.filter(function (r) { return r.month <= asof; });
    var T = totals(toDate), AFP = sum(scoped, function (r) { return r.afp; });
    $("asofLabel").textContent = fy + " as of " + K.monthLabel(asof) + " (" + (mi + 1) + " of 12 months)";
    $("scopeLabel").textContent = scopeLabel();
    // per program x org detail for projection & variance
    var groups = {};
    scoped.forEach(function (r) { var k = r.appropriation + "|" + r.program_code; (groups[k] = groups[k] || []).push(r); });
    var proj = 0, varRows = [];
    Object.keys(groups).forEach(function (k) {
      var rs = groups[k], td = rs.filter(function (r) { return r.month <= asof; }), t = totals(td), afp = sum(rs, function (r) { return r.afp; });
      // project each org line separately so seasonal plans are respected
      var byOrg = {}; rs.forEach(function (r) { (byOrg[r.organization] = byOrg[r.organization] || []).push(r); });
      var p = 0;
      Object.keys(byOrg).forEach(function (o) {
        var x = byOrg[o], a = sum(x, function (r) { return r.afp; }), tt = totals(x.filter(function (r) { return r.month <= asof; }));
        var planRemain = Math.max(0, a - tt.plan_obligations), pace = tt.plan_obligations ? Math.min(1.15, Math.max(0.5, tt.obligations / tt.plan_obligations)) : 1;
        // trust the observed pace more as the year goes on; programs usually recover part of a shortfall
        pace = 1 + (pace - 1) * 0.6 * Math.min(1, (mi + 1) / 6);
        p += Math.min(a * 1.05, tt.obligations + planRemain * pace);
      });
      proj += p;
      var r0 = rs[0], oblPct = afp ? 100 * t.obligations / afp : 0, planPct = afp ? 100 * t.plan_obligations / afp : 0, projPct = afp ? 100 * p / afp : 0;
      var flag = ["On track", "good"];
      if (remaining === 0 && oblPct >= 99) flag = ["Closed at " + oblPct.toFixed(1) + "%", "good"];
      else if (ONE_YEAR[r0.appropriation] && remaining === 0) flag = ["Expired unobligated " + money(afp - t.obligations), "bad"];
      else if (ONE_YEAR[r0.appropriation] && remaining <= 3 && projPct < 97 && afp - p > 25000) flag = ["Use-or-lose risk: " + money(afp - p) + " projected unobligated", "bad"];
      else if (oblPct - planPct < -5) flag = ["Behind plan", "bad"];
      else if (oblPct - planPct < -2) flag = ["Slightly behind plan", "warn"];
      else if (oblPct - planPct > 5) flag = ["Ahead of plan; check for overrun", "warn"];
      varRows.push({ appn: r0.appropriation, code: r0.program_code, name: r0.program_name, afp: afp, obl: t.obligations, plan: t.plan_obligations, oblPct: oblPct, planPct: planPct,
        var: oblPct - planPct, varD: t.obligations - t.plan_obligations, projPct: projPct, projShort: Math.max(0, afp - p), unobl: afp - t.obligations, openCom: Math.max(0, t.commitments - t.obligations), tdy: t.tdy_obligations, flag: flag });
    });
    S.varRows = varRows;
    var last3 = months.slice(Math.max(0, mi - 2), mi + 1), burn = sum(scoped.filter(function (r) { return last3.indexOf(r.month) >= 0; }), function (r) { return r.obligations; }) / last3.length;
    var A = { afp: AFP, allot: T.allotment, com: T.commitments, obl: T.obligations, dis: T.disbursements, plan: T.plan_obligations, tdy: T.tdy_obligations, proj: proj, burn: burn, remaining: remaining };
    // prior month for deltas
    var prevM = mi > 0 ? months[mi - 1] : null, Tp = prevM ? totals(scoped.filter(function (r) { return r.month <= prevM; })) : null;
    renderKpis(A, Tp);
    renderScurve(scoped, months, mi, AFP);
    renderFunnel(A);
    renderAppn(scoped, months, mi);
    renderTdy(scoped, months, mi);
    renderVar();
    var ufr = renderUfr(fy, b, org);
    renderSummary(A, fy, asof, varRows, ufr);
  }

  function pct(a, b) { return b ? 100 * a / b : 0; }
  function renderKpis(A, Tp) {
    var v = pct(A.obl, A.afp) - pct(A.plan, A.afp), projPct = pct(A.proj, A.afp);
    var cards = [
      ["Annual Funding Program", money(A.afp, 1), "Allotted to date " + money(A.allot, 1), pct(A.allot, A.afp).toFixed(0) + "% of AFP released", "var(--info)"],
      ["Obligated", pct(A.obl, A.afp).toFixed(1) + "%", '<span class="delta ' + (v >= -2 ? "up" : "down") + '">' + (v >= 0 ? "\u25B2 +" : "\u25BC ") + Math.abs(v).toFixed(1) + " pts</span> vs plan (" + pct(A.plan, A.afp).toFixed(1) + "%)", money(A.obl, 1) + " obligated", v >= -2 ? "var(--good)" : v >= -5 ? "var(--warn)" : "var(--bad)"],
      ["Disbursed", money(A.dis, 1), pct(A.dis, A.obl).toFixed(0) + "% of obligations paid", "Open commitments " + money(Math.max(0, A.com - A.obl)), "var(--olive)"],
      ["Unobligated balance", money(A.afp - A.obl, 1), "Allotted, not obligated " + money(A.allot - A.obl, 1), A.burn ? "Burn " + money(A.burn, 1) + "/mo" : "", A.remaining <= 3 && A.afp - A.obl > A.burn * A.remaining * 1.1 ? "var(--warn)" : "var(--olive)"],
      ["Projected EOY execution", projPct.toFixed(1) + "%", "Projected " + money(A.proj, 1), A.remaining + " month" + (A.remaining === 1 ? "" : "s") + " remaining", projPct >= 98 ? "var(--good)" : projPct >= 95 ? "var(--warn)" : "var(--bad)"],
      ["Travel (TDY) obligations", money(A.tdy, 1), Tp ? '<span class="delta flat">+' + money(A.tdy - Tp.tdy_obligations) + "</span> this month" : "First month of FY", pct(A.tdy, A.obl).toFixed(1) + "% of obligations", "var(--sand)"]
    ];
    $("kpis").innerHTML = cards.map(function (c) { return '<div class="kpi" style="--st:' + c[4] + '"><div class="lbl">' + c[0] + '</div><div class="val">' + c[1] + '</div><div class="sub">' + c[2] + "<br>" + c[3] + "</div></div>"; }).join("");
  }

  function cum(arr) { var t = 0; return arr.map(function (v) { return v == null ? null : (t += v); }); }
  function renderScurve(scoped, months, mi, AFP) {
    var by = function (k, upto) { return months.map(function (m, i) { return upto != null && i > upto ? null : sum(scoped.filter(function (r) { return r.month === m; }), function (r) { return r[k]; }); }); };
    var o = K.chartBase(); o.scales.y.ticks = { callback: function (v) { return money(v, 0); } }; o.scales.y.beginAtZero = true;
    o.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + money(c.parsed.y, 2) + " (" + pct(c.parsed.y, AFP).toFixed(1) + "% of AFP)"; } };
    var obl = cum(by("obligations", mi)), dis = cum(by("disbursements", mi)), al = cum(by("allotment", mi));
    // future months beyond data stay null
    K.upsert("cScurve", { type: "line", options: o, data: { labels: months.map(K.monthShort), datasets: [
      { label: "AFP", data: months.map(function () { return AFP; }), borderColor: "#9fb0c6", borderDash: [2, 3], pointRadius: 0, borderWidth: 1.5 },
      { label: "Spend plan", data: cum(by("plan_obligations")), borderColor: "#d6c48f", borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
      { label: "Allotted", data: al, borderColor: "#5aa6e6", stepped: true, pointRadius: 0, borderWidth: 1.5 },
      { label: "Obligated", data: obl, borderColor: "#8fd19e", backgroundColor: "rgba(95,191,127,.15)", fill: true, tension: .25, pointRadius: 3, borderWidth: 3 },
      { label: "Disbursed", data: dis, borderColor: "#e3b34c", tension: .25, pointRadius: 2, borderWidth: 2 }
    ] } });
  }
  function renderFunnel(A) {
    var labels = ["Annual Funding Program", "Allotted (received)", "Committed", "Obligated", "Disbursed"], vals = [A.afp, A.allot, A.com, A.obl, A.dis];
    var o = K.chartBase(); o.indexAxis = "y"; o.plugins.legend.display = false;
    o.scales.x.ticks = { callback: function (v) { return money(v, 0); } }; o.scales.x.beginAtZero = true;
    o.plugins.tooltip.callbacks = { label: function (c) { return money(c.parsed.x, 2) + " (" + pct(c.parsed.x, A.afp).toFixed(1) + "% of AFP)"; } };
    K.upsert("cFunnel", { type: "bar", options: o, data: { labels: labels, datasets: [{ data: vals, backgroundColor: ["#3c5f8f", "#5aa6e6", "#a9b97a", "#5fbf7f", "#e3b34c"], borderRadius: 4 }] } });
  }
  function renderAppn(scoped, months, mi) {
    var ap = uniq(scoped.map(function (r) { return r.appropriation; })).sort();
    var o = K.chartBase(); o.scales.x.stacked = true; o.scales.y.stacked = true; o.scales.y.ticks = { callback: function (v) { return money(v, 0); } };
    o.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + money(c.parsed.y, 2); } };
    K.upsert("cAppn", { type: "bar", options: o, data: { labels: months.slice(0, mi + 1).map(K.monthShort), datasets: ap.map(function (a) {
      return { label: a, backgroundColor: APPN_COLORS[a] || "#8aa", data: months.slice(0, mi + 1).map(function (m) { return sum(scoped.filter(function (r) { return r.month === m && r.appropriation === a; }), function (r) { return r.obligations; }); }) };
    }) } });
  }
  function renderTdy(scoped, months, mi) {
    var ms = months.slice(0, mi + 1), v = ms.map(function (m) { return sum(scoped.filter(function (r) { return r.month === m; }), function (r) { return r.tdy_obligations; }); });
    var o = K.chartBase(); o.scales.y.ticks = { callback: function (x) { return money(x, 0); } }; o.scales.y1 = { position: "right", grid: { display: false }, ticks: { callback: function (x) { return money(x, 0); } } };
    o.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + money(c.parsed.y, 2); } };
    K.upsert("cTdy", { type: "bar", options: o, data: { labels: ms.map(K.monthShort), datasets: [
      { label: "TDY this month", data: v, backgroundColor: "#d6c48f", borderRadius: 4, yAxisID: "y" },
      { type: "line", label: "Cumulative TDY", data: cum(v), borderColor: "#5aa6e6", pointRadius: 2, tension: .25, yAxisID: "y1" }] } });
  }

  var VCOLS = [["code", "Program"], ["appn", "Appn"], ["afp", "AFP"], ["obl", "Obligated"], ["oblPct", "Obl %"], ["planPct", "Plan %"], ["var", "Variance (pts)"], ["varD", "Variance ($)"], ["projPct", "Proj. EOY %"], ["unobl", "Unobligated"], ["flag", "Status"]];
  function renderVar() {
    var k = S.sortKey, asc = S.sortAsc;
    var rows = S.varRows.slice().sort(function (a, b) { var x = k === "flag" ? a.flag[0] : a[k], y = k === "flag" ? b.flag[0] : b[k]; var c = x < y ? -1 : x > y ? 1 : 0; return asc ? c : -c; });
    $("tVar").querySelector("thead").innerHTML = "<tr>" + VCOLS.map(function (c) { return '<th data-k="' + c[0] + '" class="' + (k === c[0] ? "sorted" + (asc ? " asc" : "") : "") + (["afp", "planPct", "varD", "unobl"].indexOf(c[0]) >= 0 ? " hide-sm" : "") + '">' + c[1] + "</th>"; }).join("") + "</tr>";
    function cf(v) { return v < -5 ? "cf-bad" : v < -2 ? "cf-warn" : "cf-good"; }
    $("tVar").querySelector("tbody").innerHTML = rows.map(function (r) {
      return '<tr><td><div class="unit">' + esc(r.code) + '</div><div class="bn">' + esc(r.name) + "</div></td><td>" + esc(r.appn) + '</td><td class="num hide-sm">' + money(r.afp, 2) + '</td><td class="num">' + money(r.obl, 2) +
        '</td><td class="num">' + r.oblPct.toFixed(1) + '%</td><td class="num hide-sm">' + r.planPct.toFixed(1) + '%</td><td class="num ' + cf(r.var) + '"><strong>' + (r.var >= 0 ? "+" : "") + r.var.toFixed(1) + '</strong></td><td class="num hide-sm ' + cf(r.var) + '">' + (r.varD >= 0 ? "+" : "") + money(r.varD) +
        '</td><td class="num ' + (r.projPct < 95 ? "cf-bad" : r.projPct < 98 ? "cf-warn" : "cf-good") + '">' + r.projPct.toFixed(1) + '%</td><td class="num hide-sm">' + money(r.unobl, 2) + '</td><td><span class="flag ' + r.flag[1] + '">' + esc(r.flag[0]) + "</span></td></tr>";
    }).join("");
    Array.prototype.forEach.call($("tVar").querySelectorAll("th"), function (th) {
      th.onclick = function () { var key = th.getAttribute("data-k"); if (S.sortKey === key) S.sortAsc = !S.sortAsc; else { S.sortKey = key; S.sortAsc = key === "var" || key === "code" || key === "projPct"; } renderVar(); };
    });
  }

  function renderUfr(fy, b, org) {
    var rows = S.ufr.filter(function (u) { return (!u.fy || u.fy === fy) && (!b || u.brigade === b) && (!org || u.organization === org); })
      .sort(function (x, y) { return (+x.priority - +y.priority) || y.amount - x.amount; });
    var open = rows.filter(function (u) { return !/funded/i.test(u.status) || /unfunded/i.test(u.status); });
    $("ufrNote").textContent = rows.length ? rows.length + " requirements, " + money(sum(rows, function (u) { return u.amount; }), 2) + " total; " + open.length + " still open (" + money(sum(open, function (u) { return u.amount; }), 2) + "). Sorted by priority, then amount." : "No unfunded requirements recorded for this selection.";
    var cls = function (s) { return /^funded/i.test(s) ? "good" : /validated/i.test(s) ? "warn" : ""; };
    $("tUfr").querySelector("tbody").innerHTML = rows.map(function (u) {
      return "<tr><td>" + esc(u.ufr_id) + '</td><td><div class="unit">' + esc(u.title) + '</div><div class="bn">' + esc(u.impact || "") + "</div></td><td>" + esc(u.program_code) + "</td><td>" + esc(u.organization) + '</td><td class="num">' + esc(u.priority) + '</td><td><span class="flag ' + cls(u.status) + '">' + esc(u.status) + '</span></td><td class="num">' + money(u.amount) + "</td></tr>";
    }).join("") || '<tr><td colspan="7" class="muted">None.</td></tr>';
    return { all: rows, open: open };
  }

  function renderSummary(A, fy, asof, varRows, ufr) {
    var s = [], oblPct = pct(A.obl, A.afp), planPct = pct(A.plan, A.afp), v = oblPct - planPct;
    s.push("As of " + K.monthLabel(asof) + " (" + fy + "), " + scopeLabel().replace("All funds, all organizations", "the command") + " has obligated " + money(A.obl, 1) + " of a " + money(A.afp, 1) + " Annual Funding Program (" + oblPct.toFixed(1) + "%), " +
      (Math.abs(v) < 0.5 ? "on plan" : Math.abs(v).toFixed(1) + " points " + (v > 0 ? "ahead of" : "behind") + " the " + planPct.toFixed(1) + "% spend plan") + ".");
    s.push(money(A.dis, 1) + " has been disbursed (" + pct(A.dis, A.obl).toFixed(0) + "% of obligations), and " + money(A.allot - A.obl, 1) + " of funds received is not yet obligated.");
    if (A.remaining > 0) s.push("At the current pace the year is projected to close at " + pct(A.proj, A.afp).toFixed(1) + "% execution, leaving about " + money(Math.max(0, A.afp - A.proj), 1) + " unobligated; average monthly obligations over the last " + Math.min(3, 12 - A.remaining) + " month" + (12 - A.remaining > 1 ? "s were " : " were ") + money(A.burn, 1) + ".");
    else s.push("The fiscal year has closed at " + oblPct.toFixed(1) + "% execution.");
    var behind = varRows.filter(function (r) { return r.var < -2; }).sort(function (a, b) { return a.varD - b.varD; }).slice(0, 3);
    if (behind.length) s.push("Largest shortfalls against plan: " + behind.map(function (r) { return r.code + " " + r.name + " (" + r.var.toFixed(1) + " pts, " + money(r.varD) + ")"; }).join("; ") + ".");
    var risk = varRows.filter(function (r) { return r.flag[1] === "bad" && /Use-or-lose|Expired/.test(r.flag[0]); }).sort(function (x, y) { return (A.remaining ? y.projShort - x.projShort : y.unobl - x.unobl); });
    if (risk.length) s.push((A.remaining === 0 ? "One-year funds that expired unobligated: " : "Use-or-lose risk in " + risk.length + " one-year program" + (risk.length > 1 ? "s" : "") + ": ") + risk.slice(0, 3).map(function (r) { return r.code + " (" + money(A.remaining ? r.projShort : r.unobl) + (A.remaining ? " projected short" : "") + ")"; }).join(", ") + (A.remaining === 0 ? "." : "; recommend reallocating to validated UFRs."));
    if (ufr.open.length) s.push(ufr.open.length + " unfunded requirement" + (ufr.open.length > 1 ? "s" : "") + " totaling " + money(sum(ufr.open, function (u) { return u.amount; }), 2) + " remain open; the top priority is " + ufr.open[0].title + " (" + money(ufr.open[0].amount) + ").");
    s.push("Travel obligations total " + money(A.tdy, 1) + " to date.");
    $("summary").textContent = s.join(" ");
  }

  function exportCsv() {
    K.downloadCsv("status_of_funds_variance_" + $("fFy").value + "_" + $("fMonth").value + ".csv",
      ["fy", "as_of", "program_code", "program_name", "appropriation", "afp", "obligated", "obligation_rate_pct", "plan_rate_pct", "variance_pts", "variance_dollars", "projected_eoy_pct", "unobligated", "open_commitments", "tdy", "status"],
      S.varRows.map(function (r) { return [$("fFy").value, $("fMonth").value, r.code, r.name, r.appn, r.afp, r.obl, r.oblPct.toFixed(2), r.planPct.toFixed(2), r.var.toFixed(2), r.varD, r.projPct.toFixed(2), r.unobl, r.openCom, r.tdy, r.flag[0]]; }));
  }

  function init() {
    K.initCharts(); K.dictTable("dictBody", COLUMNS);
    $("fFy").onchange = function () { $("fMonth").value = ""; buildFilters(false); var m = $("fMonth"); m.selectedIndex = 0; render(); };
    $("fBrigade").onchange = function () { $("fOrg").value = ""; buildFilters(false); render(); };
    ["fMonth", "fAppn", "fOrg"].forEach(function (id) { $(id).onchange = render; });
    $("btnReset").onclick = function () { S.sortKey = "var"; S.sortAsc = true; buildFilters(true); render(); };
    $("btnCsv").onclick = exportCsv;
    $("btnPrint").onclick = function () { window.print(); };
    $("btnLoad").onclick = function () { $("loadPanel").hidden = !$("loadPanel").hidden; };
    $("btnDemo").onclick = function () { setData(DEMO.records, DEMO.ufr, "demo"); $("loadMsg").className = "loadmsg okm"; $("loadMsg").textContent = "Demo data restored."; };
    $("fileInput").onchange = function (e) {
      var f = e.target.files[0]; if (!f) return; var msg = $("loadMsg"); msg.className = "loadmsg"; msg.textContent = "Reading " + f.name + "\u2026";
      K.readWorkbook(f, function (err, wb) {
        try {
          if (err) throw err;
          var miss = K.missingCols(wb._first, COLUMNS.filter(function (c) { return c[1]; }).map(function (c) { return c[0]; }));
          if (miss.length) throw new Error("Missing required column(s): " + miss.join(", ") + ".");
          setData(wb._first, wb.ufr || [], "Your file: " + f.name);
          msg.className = "loadmsg okm"; msg.textContent = "Loaded " + S.recs.length + " of " + wb._first.length + " rows from " + f.name + ". Data stays in this browser tab.";
        } catch (e2) { msg.className = "loadmsg err"; msg.textContent = "Could not load file: " + e2.message; }
      });
      e.target.value = "";
    };
    setData(DEMO.records, DEMO.ufr, "demo");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
