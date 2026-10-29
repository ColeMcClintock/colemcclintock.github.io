/* Safety & Mishaps Dashboard - all processing happens in the browser. */
(function () {
  "use strict";
  var K = window.DashKit, $ = K.$, esc = K.esc, uniq = K.uniq, sum = K.sum;
  var CLASSES = ["A", "B", "C", "D"];
  var CLASS_COLORS = { A: "#e0645c", B: "#e88a4c", C: "#e3b34c", D: "#a9c16a", NM: "#5aa6e6" };
  var WEIGHT = { A: 50, B: 20, C: 5, D: 2, NM: 0.5 };
  var COLUMNS = [
    ["date", true, "Date of the event (YYYY-MM-DD)"], ["unit_id", true, "Unique unit identifier"], ["unit_name", true, "Unit display name"],
    ["battalion", true, "Parent battalion"], ["brigade", true, "Parent brigade / command"], ["location", true, "City or armory"],
    ["event_type", true, "Mishap or Near miss"], ["mishap_class", true, "A, B, C or D (blank for near misses)"],
    ["category", true, "e.g. POV/AOV vehicle, Tactical vehicle, Range, Heat/cold injury"], ["duty_status", true, "On-duty or Off-duty"],
    ["days_lost", true, "Lost workdays"], ["cost", true, "Total cost in dollars"], ["root_cause", false, "Primary root-cause factor"],
    ["unit_strength", false, "Assigned strength (used for rates if no strength sheet)"]
  ];
  var DEMO = window.SAFETY_DATA || { records: [], strength: [] };
  var S = { recs: [], strength: {}, months: [], sortKey: "rate", sortAsc: false, showAll: false, unitRows: [] };

  function normalize(rows) {
    var out = [];
    rows.forEach(function (raw) {
      var r = K.lowerKeys(raw);
      var d = K.toISODate(r.date); if (!d || !r.unit_id) return;
      var et = /near/i.test(r.event_type) ? "Near miss" : "Mishap";
      var cls = et === "Near miss" ? "NM" : String(r.mishap_class || "").trim().toUpperCase().replace("CLASS ", "");
      if (et === "Mishap" && CLASSES.indexOf(cls) < 0) return;
      out.push({
        date: d, month: d.slice(0, 7), unit_id: String(r.unit_id).trim(), unit_name: String(r.unit_name || r.unit_id).trim(),
        battalion: String(r.battalion || "").trim(), brigade: String(r.brigade || "").trim(), location: String(r.location || "").trim(),
        event_type: et, mishap_class: cls, category: String(r.category || "Other").trim(), duty_status: /off/i.test(r.duty_status) ? "Off-duty" : "On-duty",
        days_lost: +r.days_lost || 0, cost: +r.cost || 0, root_cause: String(r.root_cause || "Not recorded").trim(), unit_strength: +r.unit_strength || null
      });
    });
    return out;
  }
  function setData(recs, strengthRows, source) {
    S.recs = normalize(recs);
    S.strength = {};
    (strengthRows || []).forEach(function (r0) { var r = K.lowerKeys(r0), m = K.toMonth(r.month); if (m && r.unit_id) S.strength[m + "|" + String(r.unit_id).trim()] = +r.assigned || 0; });
    S.unitStrength = {};
    S.recs.forEach(function (r) { if (r.unit_strength) S.unitStrength[r.unit_id] = r.unit_strength; });
    S.units = {}; S.recs.forEach(function (r) { S.units[r.unit_id] = r; });
    if (strengthRows && strengthRows.length && !Object.keys(S.units).length) {}
    var ms = uniq(S.recs.map(function (r) { return r.month; }).concat(Object.keys(S.strength).map(function (k) { return k.split("|")[0]; }))).sort();
    S.months = [];
    if (ms.length) { for (var m = ms[0]; m <= ms[ms.length - 1]; m = K.addMonths(m, 1)) S.months.push(m); }
    // demo strength table lists all units even with zero mishaps
    S.allUnits = {};
    Object.keys(S.strength).forEach(function (k) { S.allUnits[k.split("|")[1]] = true; });
    Object.keys(S.units).forEach(function (u) { S.allUnits[u] = true; });
    S.unitInfo = {};
    (source === "demo" ? (DEMO.units || []) : []).forEach(function (u) { S.unitInfo[u.unit_id] = u; });
    S.recs.forEach(function (r) { S.unitInfo[r.unit_id] = S.unitInfo[r.unit_id] || r; });
    $("sourceLabel").textContent = source === "demo" ? "" : " \u00B7 " + source;
    buildFilters(true); render();
  }

  function unitList() { return Object.keys(S.unitInfo).map(function (k) { return S.unitInfo[k]; }); }
  function buildFilters(reset) {
    var U = unitList(), b = reset ? "" : $("fBrigade").value;
    K.fillSelect($("fBrigade"), uniq(U.map(function (u) { return u.brigade; })).sort(), "All brigades", !reset);
    var pool = U.filter(function (u) { return !$("fBrigade").value || u.brigade === $("fBrigade").value; });
    K.fillSelect($("fBattalion"), uniq(pool.map(function (u) { return u.battalion; })).sort(), "All battalions", !reset);
    pool = pool.filter(function (u) { return !$("fBattalion").value || u.battalion === $("fBattalion").value; });
    K.fillSelect($("fLocation"), uniq(pool.map(function (u) { return u.location; })).sort(), "All locations", !reset);
    var ends = S.months.slice(Math.min(11, Math.max(0, S.months.length - 1))).reverse(), cur = $("fEnd").value;
    K.fillSelect($("fEnd"), ends, null, false, ends.map(K.monthLabel));
    if (!reset && ends.indexOf(cur) >= 0) $("fEnd").value = cur;
    if (reset) $("fDuty").value = "";
  }
  function inScopeUnit(u) {
    var b = $("fBrigade").value, bn = $("fBattalion").value, loc = $("fLocation").value;
    return (!b || u.brigade === b) && (!bn || u.battalion === bn) && (!loc || u.location === loc);
  }
  function scopeLabel() { var p = [$("fBrigade").value, $("fBattalion").value, $("fLocation").value, $("fDuty").value].filter(Boolean); return p.length ? p.join(" \u203A ") : "All units statewide"; }

  function windowMonths(end) { var out = []; for (var i = 11; i >= 0; i--) out.push(K.addMonths(end, -i)); return out; }
  function unitStrength(uid, months) {
    var vals = months.map(function (m) { return S.strength[m + "|" + uid]; }).filter(function (v) { return v != null; });
    if (vals.length) return sum(vals) / vals.length;
    return S.unitStrength[uid] || null;
  }
  function strengthFor(unitIds, months) {
    var t = 0, ok = false;
    unitIds.forEach(function (u) { var s = unitStrength(u, months); if (s) { t += s; ok = true; } });
    return ok ? t : null;
  }

  function stats(recs, strength) {
    var m = recs.filter(function (r) { return r.event_type === "Mishap"; });
    var o = { mishaps: m.length, nm: recs.length - m.length, ac: m.filter(function (r) { return r.mishap_class !== "D"; }).length,
      days: sum(m, function (r) { return r.days_lost; }), cost: sum(m, function (r) { return r.cost; }), byClass: {} };
    CLASSES.forEach(function (c) { o.byClass[c] = m.filter(function (r) { return r.mishap_class === c; }).length; });
    o.rate = strength ? 1000 * o.mishaps / strength : null;
    o.onduty = m.filter(function (r) { return r.duty_status === "On-duty"; }).length;
    return o;
  }

  function render() {
    if (!S.recs.length) { $("summary").textContent = "No data loaded."; return; }
    var end = $("fEnd").value || S.months[S.months.length - 1];
    var cur = windowMonths(end), prev = windowMonths(K.addMonths(end, -12));
    var duty = $("fDuty").value;
    var units = unitList().filter(inScopeUnit).map(function (u) { return u.unit_id; });
    var uset = {}; units.forEach(function (u) { uset[u] = 1; });
    var scoped = S.recs.filter(function (r) { return uset[r.unit_id] && (!duty || r.duty_status === duty); });
    var inW = function (ms) { var set = {}; ms.forEach(function (m) { set[m] = 1; }); return function (r) { return set[r.month]; }; };
    var C = scoped.filter(inW(cur)), P = scoped.filter(inW(prev));
    var prevAvail = prev.filter(function (m) { return S.months.indexOf(m) >= 0; }).length;
    var sC = strengthFor(units, cur), sP = strengthFor(units, prev);
    var A = stats(C, sC), B = prevAvail ? stats(P, sP) : null;
    $("windowLabel").textContent = "12 months ending " + K.monthLabel(end);
    $("scopeLabel").textContent = scopeLabel();
    var endDate = K.monthEnd(end);
    var lastAB = scoped.filter(function (r) { return (r.mishap_class === "A" || r.mishap_class === "B") && new Date(r.date + "T12:00:00") <= endDate; }).sort(function (x, y) { return x.date < y.date ? 1 : -1; })[0];
    var daysSince = lastAB ? Math.floor((endDate - new Date(lastAB.date + "T00:00:00")) / 864e5) : null;
    renderKpis(A, B, prevAvail, daysSince, lastAB, scoped);
    renderTrend(C, P, cur, prev, prevAvail);
    renderClass(A);
    renderCat(C);
    renderCause(C);
    var seasonal = renderHeat(scoped);
    var unitRows = renderUnits(C, P, units, cur);
    var hot = renderHot(C, P, units, cur);
    renderSummary(A, B, prevAvail, daysSince, lastAB, C, seasonal, unitRows, hot, end);
  }

  function delta(a, b, lowerIsBetter, money) {
    if (b == null || a == null) return '<span class="delta flat">no prior-year data</span>';
    var d = a - b, cls = Math.abs(d) < 1e-9 ? "flat" : (d < 0) === lowerIsBetter ? "up" : "down";
    var pct = b ? " (" + (d > 0 ? "+" : "") + (100 * d / b).toFixed(0) + "%)" : "";
    var txt = money ? K.money(d) : (Math.abs(d) < 10 && d % 1 ? d.toFixed(2) : K.fmt(d));
    return '<span class="delta ' + cls + '">' + (d > 0 ? "\u25B2 +" : d < 0 ? "\u25BC " : "\u25AC ") + txt.replace("-", "") + pct + "</span> vs prior yr";
  }
  function renderKpis(A, B, prevAvail, daysSince, lastAB) {
    var col = function (good) { return good ? "var(--good)" : "var(--bad)"; };
    var cards = [
      ["Mishap rate per 1,000", A.rate == null ? "\u2014" : A.rate.toFixed(1), delta(A.rate, B && B.rate, true), A.mishaps + " Class A\u2013D mishaps", col(!B || A.rate <= B.rate)],
      ["Class A\u2013C mishaps", A.ac, delta(A.ac, B && B.ac, true), "A " + A.byClass.A + " \u00B7 B " + A.byClass.B + " \u00B7 C " + A.byClass.C, col(!B || A.ac <= B.ac)],
      ["Lost workdays", K.fmt(A.days), delta(A.days, B && B.days, true), "Class D: " + A.byClass.D + " events", col(!B || A.days <= B.days)],
      ["Mishap cost", K.money(A.cost, 1), delta(A.cost, B && B.cost, true, true), "Property damage + injury", col(!B || A.cost <= B.cost)],
      ["Days since last Class A/B", daysSince == null ? "None" : K.fmt(daysSince), lastAB ? "Last: Class " + lastAB.mishap_class + ", " + esc(lastAB.category) : "No Class A/B on record", lastAB ? esc(lastAB.unit_name) + " \u00B7 " + lastAB.date : "", col(daysSince == null || daysSince > 180)],
      ["Near misses reported", A.nm, delta(A.nm, B && B.nm, false), (A.mishaps ? (A.nm / A.mishaps).toFixed(1) : "\u2014") + " per mishap", col(A.mishaps === 0 || A.nm / A.mishaps >= 1)]
    ];
    $("kpis").innerHTML = cards.map(function (c) { return '<div class="kpi" style="--st:' + c[4] + '"><div class="lbl">' + c[0] + '</div><div class="val">' + c[1] + '</div><div class="sub">' + c[2] + "<br>" + c[3] + "</div></div>"; }).join("");
  }

  function renderTrend(C, P, cur, prev, prevAvail) {
    var cnt = function (rs, m) { return rs.filter(function (r) { return r.month === m && r.event_type === "Mishap"; }).length; };
    var nm = function (rs, m) { return rs.filter(function (r) { return r.month === m && r.event_type !== "Mishap"; }).length; };
    var o = K.chartBase(); o.scales.y.beginAtZero = true; o.scales.y.ticks = { precision: 0 };
    var ds = [{ type: "bar", label: "Mishaps (this period)", data: cur.map(function (m) { return cnt(C, m); }), backgroundColor: "#e3b34c", borderRadius: 4, order: 2 },
      { type: "bar", label: "Near misses", data: cur.map(function (m) { return nm(C, m); }), backgroundColor: "rgba(90,166,230,.55)", borderRadius: 4, order: 3 }];
    if (prevAvail) ds.push({ type: "line", label: "Mishaps (prior year)", data: prev.map(function (m) { return S.months.indexOf(m) >= 0 ? cnt(P, m) : null; }), borderColor: "#c7d3e3", borderDash: [5, 4], pointRadius: 2, tension: .3, order: 1 });
    K.upsert("cTrend", { type: "bar", options: o, data: { labels: cur.map(function (m) { return K.MON[+m.slice(5) - 1]; }), datasets: ds } });
  }
  function renderClass(A) {
    var o = { responsive: true, maintainAspectRatio: false, cutout: "58%", plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } };
    K.upsert("cClass", { type: "doughnut", options: o, data: { labels: CLASSES.map(function (c) { return "Class " + c; }), datasets: [{ data: CLASSES.map(function (c) { return A.byClass[c]; }), backgroundColor: CLASSES.map(function (c) { return CLASS_COLORS[c]; }), borderColor: "#132540", borderWidth: 2 }] } });
  }
  function renderCat(C) {
    var M = C.filter(function (r) { return r.event_type === "Mishap"; });
    var cats = uniq(S.recs.map(function (r) { return r.category; })).sort(function (a, b) { return M.filter(function (r) { return r.category === b; }).length - M.filter(function (r) { return r.category === a; }).length; });
    var o = K.chartBase(); o.indexAxis = "y"; o.scales.x.stacked = true; o.scales.y.stacked = true; o.scales.x.ticks = { precision: 0 };
    K.upsert("cCat", { type: "bar", options: o, data: { labels: cats, datasets: CLASSES.map(function (c) { return { label: "Class " + c, backgroundColor: CLASS_COLORS[c], data: cats.map(function (k) { return M.filter(function (r) { return r.category === k && r.mishap_class === c; }).length; }) }; }) } });
  }
  function renderCause(C) {
    var counts = {}; C.forEach(function (r) { counts[r.root_cause] = (counts[r.root_cause] || 0) + (r.event_type === "Mishap" ? 1 : 0); });
    var top = Object.keys(counts).filter(function (k) { return counts[k] > 0; }).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 10);
    var o = K.chartBase(); o.indexAxis = "y"; o.plugins.legend.display = false; o.scales.x.ticks = { precision: 0 }; o.scales.y.ticks = { font: { size: 11 } };
    K.upsert("cCause", { type: "bar", options: o, data: { labels: top, datasets: [{ label: "Mishaps", data: top.map(function (k) { return counts[k]; }), backgroundColor: "#a9b97a", borderRadius: 4 }] } });
  }

  function renderHeat(scoped) {
    var M = scoped.filter(function (r) { return r.event_type === "Mishap"; });
    var cats = uniq(S.recs.map(function (r) { return r.category; })).sort();
    var grid = {}, max = 0;
    M.forEach(function (r) { var k = r.category + "|" + (+r.month.slice(5)); grid[k] = (grid[k] || 0) + 1; max = Math.max(max, grid[k]); });
    var h = "<thead><tr><th></th>" + K.MON.map(function (m) { return "<th>" + m + "</th>"; }).join("") + "<th>Total</th></tr></thead><tbody>";
    cats.forEach(function (c) {
      var tot = 0;
      h += '<tr><th class="rowh">' + esc(c) + "</th>" + K.MON.map(function (_, i) {
        var v = grid[c + "|" + (i + 1)] || 0; tot += v;
        return '<td style="background:' + K.heatColor(max ? v / max : 0) + ";color:" + (v / max > .25 ? "#0a1424" : "#9fb0c6") + '">' + (v || "") + "</td>";
      }).join("") + '<td style="color:#c7d3e3">' + tot + "</td></tr>";
    });
    $("tHeat").innerHTML = h + "</tbody>";
    // seasonal callouts: 3-month window holding the largest share of a category
    var notes = [];
    cats.forEach(function (c) {
      var arr = K.MON.map(function (_, i) { return grid[c + "|" + (i + 1)] || 0; }), tot = sum(arr);
      if (tot < 4) return;
      var best = 0, bi = 0;
      for (var i = 0; i < 12; i++) { var s = arr[i] + arr[(i + 1) % 12] + arr[(i + 2) % 12]; if (s > best) { best = s; bi = i; } }
      var share = best / tot;
      if (share >= 0.45) notes.push({ c: c, share: share, span: K.MON[bi] + "\u2013" + K.MON[(bi + 2) % 12], n: best, tot: tot });
    });
    notes.sort(function (a, b) { return b.share - a.share; });
    $("seasonal").innerHTML = notes.length ? "<strong>Seasonal pattern:</strong> " + notes.slice(0, 4).map(function (n) { return esc(n.c) + " concentrates in " + n.span + " (" + n.n + " of " + n.tot + ", " + (100 * n.share).toFixed(0) + "%)"; }).join("; ") + ". Plan pre-season safety briefs, risk assessments, and inspections ahead of these windows."
      : "No strong seasonal concentration in the current selection.";
    return notes;
  }

  var UCOLS = [["rank", "#"], ["unit", "Unit"], ["strength", "Avg strength"], ["mishaps", "Mishaps"], ["rate", "Rate / 1,000"], ["ac", "Class A\u2013C"], ["days", "Days lost"], ["cost", "Cost"], ["nm", "Near misses"], ["topcat", "Top category"], ["chg", "vs prior yr"]];
  function renderUnits(C, P, units, cur) {
    var rows = units.map(function (u) {
      var info = S.unitInfo[u], rc = C.filter(function (r) { return r.unit_id === u; }), rp = P.filter(function (r) { return r.unit_id === u; });
      var st = unitStrength(u, cur), a = stats(rc, st), b = stats(rp, st);
      var cc = {}; rc.forEach(function (r) { if (r.event_type === "Mishap") cc[r.category] = (cc[r.category] || 0) + 1; });
      var topcat = Object.keys(cc).sort(function (x, y) { return cc[y] - cc[x]; })[0] || "\u2014";
      return { u: u, info: info, strength: st, mishaps: a.mishaps, rate: a.rate, ac: a.ac, days: a.days, cost: a.cost, nm: a.nm, topcat: topcat, chg: a.mishaps - b.mishaps };
    });
    rows.sort(function (x, y) { return (y.rate || 0) - (x.rate || 0) || y.mishaps - x.mishaps; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    var k = S.sortKey, asc = S.sortAsc;
    if (k !== "rate" || asc) rows = rows.slice().sort(function (x, y) {
      var a = k === "unit" ? x.info.unit_name : x[k === "rank" ? "rate" : k], b = k === "unit" ? y.info.unit_name : y[k === "rank" ? "rate" : k];
      var c = a < b ? -1 : a > b ? 1 : 0; return asc ? c : -c;
    });
    S.unitRows = rows;
    var shown = S.showAll ? rows : rows.slice(0, 10);
    $("btnAll").textContent = S.showAll ? "Show top 10" : "Show all " + rows.length;
    $("tUnits").querySelector("thead").innerHTML = "<tr>" + UCOLS.map(function (c) { return '<th data-k="' + c[0] + '" class="' + (S.sortKey === c[0] ? "sorted" + (S.sortAsc ? " asc" : "") : "") + (["strength", "nm", "chg", "cost"].indexOf(c[0]) >= 0 ? " hide-sm" : "") + '">' + c[1] + "</th>"; }).join("") + "</tr>";
    var maxRate = Math.max.apply(null, rows.map(function (r) { return r.rate || 0; }).concat([1]));
    $("tUnits").querySelector("tbody").innerHTML = shown.map(function (r) {
      return '<tr><td class="num">' + r.rank + '</td><td><div class="unit">' + esc(r.info.unit_name) + '</div><div class="bn">' + esc(r.info.battalion) + " \u00B7 " + esc(r.info.location) + '</div></td><td class="num hide-sm">' + K.fmt(r.strength) + '</td><td class="num">' + r.mishaps +
        '</td><td class="num"><strong>' + (r.rate == null ? "\u2014" : r.rate.toFixed(1)) + '</strong><div class="bar-in"><i style="width:' + (100 * (r.rate || 0) / maxRate).toFixed(0) + '%"></i></div></td><td class="num">' + r.ac + '</td><td class="num">' + r.days + '</td><td class="num hide-sm">' + K.money(r.cost) + '</td><td class="num hide-sm">' + r.nm +
        "</td><td>" + esc(r.topcat) + '</td><td class="num hide-sm ' + (r.chg > 0 ? "bad" : "") + '">' + (r.chg > 0 ? "+" : "") + r.chg + "</td></tr>";
    }).join("");
    Array.prototype.forEach.call($("tUnits").querySelectorAll("th"), function (th) {
      th.onclick = function () { var key = th.getAttribute("data-k"); if (key === "rank") key = "rate"; if (S.sortKey === key) S.sortAsc = !S.sortAsc; else { S.sortKey = key; S.sortAsc = key === "unit" || key === "topcat"; } render(); };
    });
    return rows;
  }

  function renderHot(C, P, units, cur) {
    var byBn = {};
    units.forEach(function (u) { var bn = S.unitInfo[u].battalion; byBn[bn] = (byBn[bn] || 0) + (unitStrength(u, cur) || 0); });
    var keys = {};
    C.concat(P).forEach(function (r) { if (byBn[r.battalion] != null) keys[r.battalion + "|" + r.category] = 1; });
    var rows = Object.keys(keys).map(function (k) {
      var p = k.split("|"), rc = C.filter(function (r) { return r.battalion === p[0] && r.category === p[1]; }), rp = P.filter(function (r) { return r.battalion === p[0] && r.category === p[1]; });
      var sev = sum(rc, function (r) { return WEIGHT[r.mishap_class] || 0; }), st = byBn[p[0]] || null;
      var m = rc.filter(function (r) { return r.event_type === "Mishap"; }), mp = rp.filter(function (r) { return r.event_type === "Mishap"; });
      var flags = [];
      if (m.some(function (r) { return r.mishap_class === "A" || r.mishap_class === "B"; })) flags.push(["Severe (A/B)", ""]);
      if (m.length >= 3) flags.push(["Repeat (" + m.length + ")", ""]);
      if (m.length > mp.length && m.length >= 2) flags.push(["Rising (+" + (m.length - mp.length) + ")", "warn"]);
      if (m.length >= 2 && (rc.length - m.length) < m.length) flags.push(["Low near-miss reporting", "warn"]);
      return { bn: p[0], cat: p[1], score: st ? 1000 * sev / st : sev, mishaps: m.length, nm: rc.length - m.length, days: sum(m, function (r) { return r.days_lost; }), cost: sum(m, function (r) { return r.cost; }), flags: flags };
    }).filter(function (r) { return r.mishaps > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 10);
    $("tHot").querySelector("tbody").innerHTML = rows.length ? rows.map(function (r, i) {
      return '<tr><td class="num">' + (i + 1) + "</td><td>" + esc(r.bn) + "</td><td>" + esc(r.cat) + '</td><td class="num score">' + r.score.toFixed(1) + '</td><td class="num">' + r.mishaps + '</td><td class="num">' + r.nm + '</td><td class="num">' + r.days + '</td><td class="num">' + K.money(r.cost) + "</td><td>" +
        (r.flags.length ? r.flags.map(function (f) { return '<span class="flag ' + f[1] + '">' + f[0] + "</span>"; }).join("") : '<span class="muted small">\u2014</span>') + "</td></tr>";
    }).join("") : '<tr><td colspan="9" class="muted">No mishaps in this selection.</td></tr>';
    return rows;
  }

  function renderSummary(A, B, prevAvail, daysSince, lastAB, C, seasonal, unitRows, hot, end) {
    var s = [];
    s.push("For the 12 months ending " + K.monthLabel(end) + ", " + scopeLabel().replace("All units statewide", "units statewide") + " recorded " + A.mishaps + " Class A\u2013D mishap" + (A.mishaps === 1 ? "" : "s") +
      (A.rate != null ? " (" + A.rate.toFixed(1) + " per 1,000 personnel)" : "") + ", with " + K.fmt(A.days) + " lost workdays and " + K.money(A.cost, 1) + " in losses.");
    if (B && B.mishaps != null) {
      var d = A.mishaps - B.mishaps;
      s.push(d === 0 ? "That is unchanged from the prior 12 months." : "That is " + (d < 0 ? "down " + (-d) : "up " + d) + " from the prior 12 months (" + B.mishaps + ")" + (B.rate != null && A.rate != null ? ", a rate change of " + (A.rate - B.rate > 0 ? "+" : "") + (A.rate - B.rate).toFixed(1) + " per 1,000" : "") + ".");
    }
    if (A.mishaps) s.push(Math.round(100 * A.onduty / A.mishaps) + "% of mishaps occurred on duty; " + (A.mishaps - A.onduty) + (A.mishaps - A.onduty === 1 ? " was" : " were") + " off duty.");
    var cats = {}; C.forEach(function (r) { if (r.event_type === "Mishap") cats[r.category] = (cats[r.category] || 0) + 1; });
    var topc = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).slice(0, 2);
    if (topc.length) s.push("Leading categories: " + topc.map(function (c) { return c + " (" + cats[c] + ")"; }).join(" and ") + ".");
    s.push(lastAB ? "It has been " + K.fmt(daysSince) + " days since the last Class A or B mishap (Class " + lastAB.mishap_class + ", " + lastAB.category + ", " + lastAB.unit_name + ")." : "There is no Class A or B mishap on record in this scope.");
    var u = unitRows.filter(function (r) { return r.mishaps > 0; }).slice(0, 2);
    if (u.length) s.push("Highest normalized rates: " + u.map(function (r) { return r.info.unit_name + " (" + (r.rate == null ? r.mishaps + " mishaps" : r.rate.toFixed(1) + " per 1,000") + ")"; }).join(" and ") + ".");
    if (hot.length) s.push("Top hotspot: " + hot[0].bn + ", " + hot[0].cat + (hot[0].flags.length ? " (" + hot[0].flags.map(function (f) { return f[0]; }).join(", ") + ")" : "") + ".");
    if (seasonal.length) s.push("Seasonal focus: " + seasonal.slice(0, 2).map(function (n) { return n.c + " in " + n.span; }).join(" and ") + ".");
    s.push("Near-miss reporting: " + A.nm + " reports" + (A.mishaps ? " (" + (A.nm / A.mishaps).toFixed(1) + " per mishap)" : "") + (B ? (A.nm >= B.nm ? ", up from " : ", down from ") + B.nm + " the prior year." : "."));
    $("summary").textContent = s.join(" ");
  }

  function exportCsv() {
    K.downloadCsv("safety_unit_ranking_" + ($("fEnd").value || "") + ".csv",
      ["rank", "unit_id", "unit_name", "battalion", "brigade", "location", "avg_strength", "mishaps", "rate_per_1000", "class_a_c", "days_lost", "cost", "near_misses", "top_category", "change_vs_prior_year"],
      S.unitRows.map(function (r) { return [r.rank, r.u, r.info.unit_name, r.info.battalion, r.info.brigade, r.info.location, r.strength == null ? "" : r.strength.toFixed(0), r.mishaps, r.rate == null ? "" : r.rate.toFixed(2), r.ac, r.days, r.cost, r.nm, r.topcat, r.chg]; }));
  }

  function init() {
    K.initCharts(); K.dictTable("dictBody", COLUMNS);
    ["fBrigade", "fBattalion"].forEach(function (id, i) { $(id).addEventListener("change", function () { if (i === 0) $("fBattalion").value = ""; $("fLocation").value = ""; buildFilters(false); render(); }); });
    ["fLocation", "fDuty", "fEnd"].forEach(function (id) { $(id).addEventListener("change", render); });
    $("btnReset").onclick = function () { S.sortKey = "rate"; S.sortAsc = false; buildFilters(true); render(); };
    $("btnAll").onclick = function () { S.showAll = !S.showAll; render(); };
    $("btnCsv").onclick = exportCsv;
    $("btnPrint").onclick = function () { window.print(); };
    $("btnLoad").onclick = function () { $("loadPanel").hidden = !$("loadPanel").hidden; };
    $("btnDemo").onclick = function () { setData(DEMO.records, DEMO.strength, "demo"); $("loadMsg").className = "loadmsg okm"; $("loadMsg").textContent = "Demo data restored."; };
    $("fileInput").onchange = function (e) {
      var f = e.target.files[0]; if (!f) return; var msg = $("loadMsg"); msg.className = "loadmsg"; msg.textContent = "Reading " + f.name + "\u2026";
      K.readWorkbook(f, function (err, wb) {
        try {
          if (err) throw err;
          var miss = K.missingCols(wb._first, COLUMNS.filter(function (c) { return c[1]; }).map(function (c) { return c[0]; }));
          if (miss.length) throw new Error("Missing required column(s): " + miss.join(", ") + ".");
          setData(wb._first, wb.strength || [], "Your file: " + f.name);
          msg.className = "loadmsg okm"; msg.textContent = "Loaded " + S.recs.length + " of " + wb._first.length + " rows from " + f.name + ". Data stays in this browser tab.";
        } catch (e2) { msg.className = "loadmsg err"; msg.textContent = "Could not load file: " + e2.message; }
      });
      e.target.value = "";
    };
    setData(DEMO.records, DEMO.strength, "demo");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
