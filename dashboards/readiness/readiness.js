/* Readiness Command Dashboard - all processing happens in the browser. */
(function () {
  "use strict";

  // ---------- constants ----------
  var STD = { strength: 90, mosq: 85, med: 85, eoh: 90, eor: 85, itr: 85, ctr: 80 };
  var METRICS = [
    { k: "strength", label: "Assigned strength", lc: "assigned strength", short: "Strength", color: "#5aa6e6" },
    { k: "mosq", label: "MOS-qualified", lc: "MOS qualification", short: "MOSQ", color: "#a9b97a" },
    { k: "med", label: "Medically ready", lc: "medical readiness", short: "Medical", color: "#5fbf7f" },
    { k: "eoh", label: "Equipment on-hand", lc: "equipment on-hand", short: "Equip on-hand", color: "#d6c48f" },
    { k: "eor", label: "Equipment op. readiness", lc: "equipment operational readiness", short: "Equip OR", color: "#e3b34c" },
    { k: "itr", label: "Individual training", lc: "individual training", short: "Indiv. training", color: "#b48ee0" },
    { k: "ctr", label: "Collective training", lc: "collective training", short: "Collective trng", color: "#e08ab4" }
  ];
  var RATING_COLORS = { C1: "#5fbf7f", C2: "#a9c16a", C3: "#e3b34c", C4: "#e0645c" };
  var COLUMNS = [
    ["month", true, "Reporting month, YYYY-MM"], ["unit_id", true, "Unique unit identifier"],
    ["unit_name", true, "Display name of the unit"], ["battalion", true, "Parent battalion"],
    ["brigade", true, "Parent brigade / group"], ["location", true, "City or armory location"],
    ["lat", false, "Latitude (for the map)"], ["lon", false, "Longitude (for the map)"],
    ["authorized", true, "Authorized strength (count)"], ["assigned", true, "Assigned strength (count)"],
    ["mosq_pct", true, "% of assigned who are MOS-qualified"],
    ["mrc1", true, "Count in medical readiness category 1"], ["mrc2", true, "Count in MRC 2"],
    ["mrc3", true, "Count in MRC 3"], ["mrc4", true, "Count in MRC 4"],
    ["equip_on_hand_pct", true, "% of authorized equipment on hand"],
    ["equip_or_pct", true, "% of on-hand equipment operational"],
    ["ind_training_pct", true, "% of individual training requirements current"],
    ["coll_training_pct", true, "% of collective tasks trained/practiced"],
    ["readiness_rating", false, "C1-C4; computed if blank"]
  ];
  var NUMERIC = ["lat", "lon", "authorized", "assigned", "mosq_pct", "mrc1", "mrc2", "mrc3", "mrc4",
    "equip_on_hand_pct", "equip_or_pct", "ind_training_pct", "coll_training_pct"];

  // ---------- state ----------
  var DEMO = window.READINESS_DATA || { records: [], events: [] };
  var state = { records: [], events: [], months: [], showAll: false, sortKey: "score", sortAsc: false, source: "Demo dataset" };
  var charts = {};
  var $ = function (id) { return document.getElementById(id); };

  // ---------- helpers ----------
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function monthLabel(m) { var p = m.split("-"); return MON[+p[1] - 1] + " " + p[0]; }
  function monthShort(m) { var p = m.split("-"); return MON[+p[1] - 1] + " '" + p[0].slice(2); }
  function fmt(v, d) { return v == null || isNaN(v) ? "\u2014" : v.toFixed(d == null ? 1 : d); }
  function uniq(a) { return Array.from(new Set(a)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function sum(a, f) { var t = 0; for (var i = 0; i < a.length; i++) t += f(a[i]); return t; }
  function wavg(a, f, w) { var tw = sum(a, w); return tw ? sum(a, function (r) { return f(r) * w(r); }) / tw : NaN; }

  function computeRating(r) {
    var strength = 100 * r.assigned / r.authorized;
    var med = 100 * (r.mrc1 + r.mrc2) / r.assigned;
    var p = Math.min(strength, r.mosq_pct, med), e = Math.min(r.equip_on_hand_pct, r.equip_or_pct),
      t = (r.ind_training_pct + r.coll_training_pct) / 2;
    function lvl(v, a, b, c) { return v >= a ? 1 : v >= b ? 2 : v >= c ? 3 : 4; }
    var lv = [lvl(p, 86, 78, 68), lvl(e, 90, 82, 72), lvl(t, 86, 76, 62)];
    var avg = Math.round((lv[0] + lv[1] + lv[2]) / 3 + 1e-9);
    return "C" + Math.max(avg, Math.max.apply(null, lv) - 1);
  }

  function unitMetrics(r) {
    return {
      strength: 100 * r.assigned / r.authorized, mosq: r.mosq_pct, med: 100 * (r.mrc1 + r.mrc2) / r.assigned,
      eoh: r.equip_on_hand_pct, eor: r.equip_or_pct, itr: r.ind_training_pct, ctr: r.coll_training_pct
    };
  }

  function aggregate(rows) {
    if (!rows.length) return null;
    var asg = function (r) { return r.assigned; }, auth = function (r) { return r.authorized; };
    var ratings = { C1: 0, C2: 0, C3: 0, C4: 0 };
    rows.forEach(function (r) { ratings[r.readiness_rating] = (ratings[r.readiness_rating] || 0) + 1; });
    return {
      n: rows.length, assigned: sum(rows, asg), authorized: sum(rows, auth),
      strength: 100 * sum(rows, asg) / sum(rows, auth),
      mosq: wavg(rows, function (r) { return r.mosq_pct; }, asg),
      med: 100 * sum(rows, function (r) { return r.mrc1 + r.mrc2; }) / sum(rows, asg),
      eoh: wavg(rows, function (r) { return r.equip_on_hand_pct; }, auth),
      eor: wavg(rows, function (r) { return r.equip_or_pct; }, auth),
      itr: wavg(rows, function (r) { return r.ind_training_pct; }, asg),
      ctr: wavg(rows, function (r) { return r.coll_training_pct; }, asg),
      mrc: [1, 2, 3, 4].map(function (i) { return sum(rows, function (r) { return r["mrc" + i]; }); }),
      ratings: ratings, ready: 100 * (ratings.C1 + ratings.C2) / rows.length
    };
  }

  // ---------- data loading ----------
  function normalize(recs) {
    var out = [];
    recs.forEach(function (raw) {
      var r = {};
      Object.keys(raw).forEach(function (k) { r[String(k).trim().toLowerCase()] = raw[k]; });
      if (!r.month || !r.unit_id) return;
      var m = String(r.month).trim();
      if (/^\d{4}-\d{1,2}(-\d{1,2})?$/.test(m)) { var p = m.split("-"); m = p[0] + "-" + ("0" + p[1]).slice(-2); }
      else if (r.month instanceof Date) { m = r.month.getFullYear() + "-" + ("0" + (r.month.getMonth() + 1)).slice(-2); }
      else { var d = new Date(m); if (!isNaN(d)) m = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); else return; }
      r.month = m;
      NUMERIC.forEach(function (k) { r[k] = r[k] === "" || r[k] == null ? null : +r[k]; });
      ["unit_id", "unit_name", "battalion", "brigade", "location"].forEach(function (k) { r[k] = String(r[k] == null ? "" : r[k]).trim(); });
      if (!r.unit_name) r.unit_name = r.unit_id;
      if (!r.authorized || !r.assigned) return;
      r.readiness_rating = String(r.readiness_rating || "").trim().toUpperCase();
      if (!/^C[1-4]$/.test(r.readiness_rating)) r.readiness_rating = computeRating(r);
      out.push(r);
    });
    return out;
  }

  function setData(records, events, source) {
    state.records = normalize(records);
    state.events = (events || []).map(function (e) {
      var o = {}; Object.keys(e).forEach(function (k) { o[String(k).trim().toLowerCase()] = e[k]; });
      ["start", "end"].forEach(function (k) { if (o[k] instanceof Date) o[k] = o[k].toISOString().slice(0, 10); else o[k] = String(o[k] || "").slice(0, 10); });
      return o;
    });
    state.months = uniq(state.records.map(function (r) { return r.month; })).sort();
    state.source = source;
    $("sourceLabel").textContent = source === "Demo dataset" ? "" : " \u00B7 " + source;
    buildFilters(true);
    render();
  }

  // ---------- filters ----------
  function fillSelect(sel, values, allLabel, keep) {
    var cur = sel.value;
    sel.innerHTML = (allLabel ? '<option value="">' + allLabel + "</option>" : "") +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + "</option>"; }).join("");
    if (keep && values.indexOf(cur) >= 0) sel.value = cur;
  }
  function buildFilters(reset) {
    var R = state.records;
    var b = $("fBrigade").value, bn = $("fBattalion").value;
    if (reset) { b = ""; bn = ""; }
    fillSelect($("fBrigade"), uniq(R.map(function (r) { return r.brigade; })).sort(), "All brigades", !reset);
    var bnPool = R.filter(function (r) { return !b || r.brigade === b; });
    fillSelect($("fBattalion"), uniq(bnPool.map(function (r) { return r.battalion; })).sort(), "All battalions", !reset);
    var locPool = bnPool.filter(function (r) { return !$("fBattalion").value || r.battalion === $("fBattalion").value; });
    fillSelect($("fLocation"), uniq(locPool.map(function (r) { return r.location; })).sort(), "All locations", !reset);
    var mSel = $("fMonth"), cur = mSel.value;
    mSel.innerHTML = state.months.slice().reverse().map(function (m) { return '<option value="' + m + '">' + monthLabel(m) + "</option>"; }).join("");
    if (!reset && state.months.indexOf(cur) >= 0) mSel.value = cur;
  }
  function scopeRows() {
    var b = $("fBrigade").value, bn = $("fBattalion").value, loc = $("fLocation").value;
    return state.records.filter(function (r) {
      return (!b || r.brigade === b) && (!bn || r.battalion === bn) && (!loc || r.location === loc);
    });
  }
  function scopeLabel() {
    var parts = [$("fBrigade").value, $("fBattalion").value, $("fLocation").value].filter(Boolean);
    return parts.length ? parts.join(" \u203A ") : "All units statewide";
  }

  // ---------- attention scoring ----------
  var DRIVER_LABEL = { strength: "Strength", mosq: "MOSQ", med: "Medical", eoh: "Equip on-hand", eor: "Equip OR", itr: "Indiv. trng", ctr: "Coll. trng" };
  function scoreUnits(cur, prevByUnit) {
    return cur.map(function (r) {
      var m = unitMetrics(r), p = prevByUnit[r.unit_id] ? unitMetrics(prevByUnit[r.unit_id]) : null;
      var drivers = [], score = 0;
      Object.keys(STD).forEach(function (k) {
        var gap = STD[k] - m[k];
        if (gap > 0) { score += gap; drivers.push({ k: k, w: gap, text: DRIVER_LABEL[k] + " " + m[k].toFixed(0) + "% < " + STD[k] + "%", type: "gap" }); }
        if (p) {
          var drop = p[k] - m[k];
          if (drop >= 3) { score += drop * 0.6; drivers.push({ k: k, w: drop * 0.6, text: DRIVER_LABEL[k] + " \u25BC" + drop.toFixed(1) + " pts MoM", type: "trend" }); }
        }
      });
      if (r.readiness_rating === "C3") score += 5;
      if (r.readiness_rating === "C4") score += 12;
      drivers.sort(function (a, b) { return b.w - a.w; });
      var o = { r: r, m: m, score: score, drivers: drivers, prevRating: prevByUnit[r.unit_id] ? prevByUnit[r.unit_id].readiness_rating : null };
      return o;
    });
  }

  // ---------- render ----------
  function render() {
    if (!state.records.length) { $("summary").textContent = "No data loaded."; return; }
    var month = $("fMonth").value || state.months[state.months.length - 1];
    var mi = state.months.indexOf(month), prevMonth = mi > 0 ? state.months[mi - 1] : null;
    var scoped = scopeRows();
    var cur = scoped.filter(function (r) { return r.month === month; });
    var prev = prevMonth ? scoped.filter(function (r) { return r.month === prevMonth; }) : [];
    var A = aggregate(cur), P = aggregate(prev);
    $("asofLabel").textContent = monthLabel(month);
    $("scopeLabel").textContent = scopeLabel();
    var prevByUnit = {}; prev.forEach(function (r) { prevByUnit[r.unit_id] = r; });
    var scored = scoreUnits(cur, prevByUnit);
    renderKpis(A, P, prevMonth);
    renderSummary(A, P, scored, cur, scoped, month, prevMonth);
    renderTrend(scoped, month);
    renderRatings(scoped, month);
    renderBn(cur);
    renderMed(A);
    renderMap(cur, scored);
    renderTable(scored);
    renderEvents(month);
  }

  function deltaHtml(a, b, unit) {
    if (b == null || isNaN(b)) return '<span class="delta flat">no prior month</span>';
    var d = a - b, cls = Math.abs(d) < 0.05 ? "flat" : d > 0 ? "up" : "down";
    var arrow = cls === "flat" ? "\u25AC" : d > 0 ? "\u25B2" : "\u25BC";
    return '<span class="delta ' + cls + '">' + arrow + " " + (d > 0 ? "+" : "") + d.toFixed(1) + (unit || " pts") + "</span> vs prior month";
  }
  function stColor(v, std) { return v >= std ? "var(--good)" : v >= std - 7 ? "var(--warn)" : "var(--bad)"; }

  function renderKpis(A, P) {
    if (!A) { $("kpis").innerHTML = '<div class="kpi">No units match the filters.</div>'; return; }
    var cards = METRICS.map(function (m) {
      return '<div class="kpi" style="--st:' + stColor(A[m.k], STD[m.k]) + '"><div class="lbl">' + m.label + '</div><div class="val">' + fmt(A[m.k]) + '%</div><div class="sub">' +
        deltaHtml(A[m.k], P ? P[m.k] : null) + (m.k === "strength" ? '<br>' + A.assigned.toLocaleString() + " of " + A.authorized.toLocaleString() + " authorized" : '<br>Standard ' + STD[m.k] + "%") + "</div></div>";
    });
    cards.push('<div class="kpi" style="--st:' + stColor(A.ready, 75) + '"><div class="lbl">Units rated C1&ndash;C2</div><div class="val">' + (A.ratings.C1 + A.ratings.C2) + " / " + A.n + '</div><div class="sub">' +
      deltaHtml(A.ready, P ? P.ready : null, " pts") + "<br>C3: " + A.ratings.C3 + " &middot; C4: " + A.ratings.C4 + "</div></div>");
    $("kpis").innerHTML = cards.join("");
  }

  function renderSummary(A, P, scored, cur, scoped, month, prevMonth) {
    if (!A) { $("summary").textContent = "No units match the current filters for " + monthLabel(month) + "."; return; }
    var s = [];
    var bns = uniq(cur.map(function (r) { return r.battalion; })).length;
    s.push("As of " + monthLabel(month) + ", " + scopeLabel().replace("All units statewide", "the statewide force") + " comprises " + A.n + " unit" + (A.n > 1 ? "s" : "") + " across " + bns + " battalion" + (bns > 1 ? "s" : "") +
      ", with " + A.assigned.toLocaleString() + " Soldiers assigned against " + A.authorized.toLocaleString() + " authorized (" + A.strength.toFixed(1) + "%).");
    var ready = A.ratings.C1 + A.ratings.C2;
    var rs = ready + " of " + A.n + " units (" + A.ready.toFixed(0) + "%) are rated C1 or C2";
    if (P) { var d = ready - (P.ratings.C1 + P.ratings.C2); rs += d === 0 ? ", unchanged from " + monthLabel(prevMonth) : d > 0 ? ", up " + d + " from " + monthLabel(prevMonth) : ", down " + (-d) + " from " + monthLabel(prevMonth); }
    s.push(rs + ".");
    // biggest movers
    if (P) {
      var moves = METRICS.map(function (m) { return { m: m, d: A[m.k] - P[m.k] }; }).sort(function (a, b) { return a.d - b.d; });
      var worst = moves[0], best = moves[moves.length - 1];
      var parts = [];
      if (worst.d <= -0.5) parts.push(worst.m.lc + " fell the most (" + worst.d.toFixed(1) + " pts to " + A[worst.m.k].toFixed(1) + "%)");
      if (best.d >= 0.5) parts.push(best.m.lc + " improved the most (+" + best.d.toFixed(1) + " pts to " + A[best.m.k].toFixed(1) + "%)");
      if (parts.length) s.push("Month over month, " + parts.join(", while ") + ".");
      else s.push("Key indicators were essentially flat month over month.");
    }
    var below = METRICS.filter(function (m) { return A[m.k] < STD[m.k]; });
    if (below.length) s.push("Below standard in aggregate: " + below.map(function (m) { return m.lc + " (" + A[m.k].toFixed(1) + "% vs " + STD[m.k] + "%)"; }).join("; ") + ".");
    else s.push("All aggregate indicators meet standard.");
    var top = scored.slice().sort(function (a, b) { return b.score - a.score; }).filter(function (u) { return u.score > 0; }).slice(0, 3);
    if (top.length) {
      s.push("Priority for command attention: " + top.map(function (u) { return u.r.unit_name + " (" + u.r.readiness_rating + ", " + (u.drivers[0] ? u.drivers[0].text : "multiple factors") + ")"; }).join("; ") + ".");
      var counts = {}; scored.forEach(function (u) { u.drivers.forEach(function (d) { if (d.type === "gap") counts[d.k] = (counts[d.k] || 0) + 1; }); });
      var common = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      if (common && counts[common] >= 2) s.push("The most common shortfall is " + METRICS.filter(function (m) { return m.k === common; })[0].lc + ", below standard in " + counts[common] + " of " + A.n + " units.");
    }
    var ev = upcomingEvents(month).slice(0, 1)[0];
    if (ev) s.push("Next scheduled event: " + ev.type.toLowerCase() + " for " + (ev.battalion === "All" ? "all units" : ev.battalion) + " beginning " + new Date(ev.start + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + (ev.notes ? " (" + ev.notes + ")" : "") + ".");
    $("summary").textContent = s.join(" ");
  }

  function chartBase() {
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      plugins: { legend: { labels: { boxWidth: 12, boxHeight: 12 } }, tooltip: { mode: "index", intersect: false } },
      scales: { x: { grid: { color: "rgba(60,95,143,.25)" } }, y: { grid: { color: "rgba(60,95,143,.25)" } } }
    };
  }
  function upsert(id, cfg) {
    if (charts[id]) { charts[id].data = cfg.data; charts[id].options = cfg.options; charts[id].update(); }
    else charts[id] = new Chart($(id), cfg);
  }

  function renderTrend(scoped, month) {
    var ms = state.months.filter(function (m) { return m <= month; });
    var aggs = ms.map(function (m) { return aggregate(scoped.filter(function (r) { return r.month === m; })); });
    var opts = chartBase();
    opts.scales.y.suggestedMin = 70; opts.scales.y.suggestedMax = 100;
    opts.scales.y.ticks = { callback: function (v) { return v + "%"; } };
    opts.plugins.legend.position = "bottom";
    opts.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + (c.parsed.y == null ? "\u2014" : c.parsed.y.toFixed(1) + "%"); } };
    upsert("cTrend", {
      type: "line", options: opts,
      data: {
        labels: ms.map(monthShort), datasets: METRICS.map(function (m) {
          return { label: m.short, data: aggs.map(function (a) { return a ? +a[m.k].toFixed(2) : null; }), borderColor: m.color, backgroundColor: m.color, tension: .3, pointRadius: 2, borderWidth: 2 };
        })
      }
    });
  }

  function renderRatings(scoped, month) {
    var ms = state.months.filter(function (m) { return m <= month; });
    var opts = chartBase();
    opts.scales.x.stacked = true; opts.scales.y.stacked = true; opts.scales.y.title = { display: true, text: "Units" };
    opts.plugins.legend.position = "bottom";
    upsert("cRating", {
      type: "bar", options: opts,
      data: {
        labels: ms.map(monthShort), datasets: ["C1", "C2", "C3", "C4"].map(function (c) {
          return { label: c, backgroundColor: RATING_COLORS[c], data: ms.map(function (m) { return scoped.filter(function (r) { return r.month === m && r.readiness_rating === c; }).length; }) };
        })
      }
    });
  }

  function renderBn(cur) {
    var bns = uniq(cur.map(function (r) { return r.battalion; }));
    var rows = bns.map(function (b) {
      var a = aggregate(cur.filter(function (r) { return r.battalion === b; }));
      var idx = (a.strength + a.mosq + a.med + a.eoh + a.eor + a.itr + a.ctr) / 7;
      return { b: b, idx: idx, a: a };
    }).sort(function (x, y) { return y.idx - x.idx; });
    var opts = chartBase();
    opts.indexAxis = "y"; opts.plugins.legend.display = false;
    opts.scales.x.min = 70; opts.scales.x.max = 100; opts.scales.x.ticks = { callback: function (v) { return v + "%"; } };
    opts.scales.y.ticks = { font: { size: 10 } };
    opts.plugins.tooltip.callbacks = {
      label: function (c) { var a = rows[c.dataIndex].a; return ["Readiness index: " + c.parsed.x.toFixed(1) + "%", "Units: " + a.n + " (C1-C2: " + (a.ratings.C1 + a.ratings.C2) + ")", "Strength " + a.strength.toFixed(0) + "% | Med " + a.med.toFixed(0) + "% | Equip OR " + a.eor.toFixed(0) + "%"]; }
    };
    upsert("cBn", {
      type: "bar", options: opts,
      data: {
        labels: rows.map(function (r) { return r.b.replace(" Bn", ""); }),
        datasets: [{ label: "Readiness index", data: rows.map(function (r) { return +r.idx.toFixed(2); }), backgroundColor: rows.map(function (r) { return r.idx >= 88 ? "#5fbf7f" : r.idx >= 84 ? "#a9c16a" : r.idx >= 80 ? "#e3b34c" : "#e0645c"; }), borderRadius: 4 }]
      }
    });
  }

  function renderMed(A) {
    var opts = { responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, cutout: "58%", plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } };
    var tot = A ? A.mrc.reduce(function (x, y) { return x + y; }, 0) : 0;
    opts.plugins.tooltip = { callbacks: { label: function (c) { return c.label + ": " + c.parsed.toLocaleString() + " (" + (100 * c.parsed / tot).toFixed(1) + "%)"; } } };
    upsert("cMed", {
      type: "doughnut", options: opts,
      data: { labels: ["MRC 1 Ready", "MRC 2 Minor gaps", "MRC 3 Temp not ready", "MRC 4 Not ready/unknown"], datasets: [{ data: A ? A.mrc : [], backgroundColor: ["#5fbf7f", "#a9c16a", "#e3b34c", "#e0645c"], borderColor: "#132540", borderWidth: 2 }] }
    });
  }

  function renderMap(cur, scored) {
    var W = 620, H = 400, pad = 18;
    var minLon = -96.7, maxLon = -90.1, minLat = 40.35, maxLat = 43.55, kx = Math.cos(42 * Math.PI / 180);
    var sx = (W - 2 * pad) / ((maxLon - minLon) * kx), sy = (H - 2 * pad) / (maxLat - minLat), s = Math.min(sx, sy);
    var offX = (W - (maxLon - minLon) * kx * s) / 2;
    function proj(lon, lat) { return [offX + (lon - minLon) * kx * s, pad + (maxLat - lat) * s]; }
    var path = window.IOWA_OUTLINE.map(function (p, i) { var q = proj(p[0], p[1]); return (i ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1); }).join("") + "Z";
    var byLoc = {};
    scored.forEach(function (u) {
      var r = u.r; if (r.lat == null || r.lon == null) return;
      var L = byLoc[r.location] || (byLoc[r.location] = { name: r.location, lat: 0, lon: 0, n: 0, units: [], worst: 1, asg: 0 });
      L.lat += r.lat; L.lon += r.lon; L.n++; L.units.push(u); L.asg += r.assigned;
      L.worst = Math.max(L.worst, +r.readiness_rating.slice(1));
    });
    var sel = $("fLocation").value;
    var dots = Object.keys(byLoc).map(function (k) {
      var L = byLoc[k], q = proj(L.lon / L.n, L.lat / L.n), rad = 5 + Math.sqrt(L.asg) * 0.55;
      var tip = L.name + " \u2014 " + L.n + " unit" + (L.n > 1 ? "s" : "") + ", " + L.asg + " assigned\n" + L.units.map(function (u) { return u.r.unit_name + ": " + u.r.readiness_rating; }).join("\n");
      return '<g class="city' + (sel === L.name ? " sel" : "") + '" data-loc="' + esc(L.name) + '" tabindex="0"><title>' + esc(tip) + '</title><circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="' + rad.toFixed(1) + '" fill="' + RATING_COLORS["C" + L.worst] + '"></circle>' +
        '<text x="' + (q[0] + rad + 3).toFixed(1) + '" y="' + (q[1] + 3).toFixed(1) + '">' + esc(L.name) + "</text></g>";
    }).join("");
    $("map").innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Map of Iowa showing unit locations colored by lowest unit rating"><path class="state" d="' + path + '"></path>' + dots + "</svg>";
    $("mapLegend").innerHTML = ["C1", "C2", "C3", "C4"].map(function (c) { return '<span><i style="background:' + RATING_COLORS[c] + '"></i>Lowest unit ' + c + "</span>"; }).join("") + "<span>Bubble size = assigned strength. Click a bubble to filter.</span>";
    Array.prototype.forEach.call($("map").querySelectorAll(".city"), function (g) {
      function pick() { var loc = g.getAttribute("data-loc"); var f = $("fLocation"); if (Array.prototype.some.call(f.options, function (o) { return o.value === loc; })) { f.value = f.value === loc ? "" : loc; render(); } }
      g.addEventListener("click", pick);
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
  }

  var TABLE_COLS = [
    { k: "rank", label: "#", num: true },
    { k: "unit", label: "Unit" },
    { k: "location", label: "Location", cls: "hide-sm" },
    { k: "rating", label: "Rating" },
    { k: "score", label: "Attention", num: true },
    { k: "strength", label: "Strength", num: true, cls: "hide-sm" },
    { k: "med", label: "Medical", num: true, cls: "hide-sm" },
    { k: "eor", label: "Equip OR", num: true, cls: "hide-sm" },
    { k: "ctr", label: "Coll. trng", num: true, cls: "hide-sm" },
    { k: "drivers", label: "Top drivers" }
  ];
  var lastTable = [];
  function sortVal(u, k) {
    if (k === "unit") return u.r.unit_name; if (k === "location") return u.r.location;
    if (k === "rating") return u.r.readiness_rating; if (k === "score" || k === "rank") return u.score;
    return u.m[k];
  }
  function renderTable(scored) {
    var ranked = scored.slice().sort(function (a, b) { return b.score - a.score; });
    ranked.forEach(function (u, i) { u.rank = i + 1; });
    var k = state.sortKey, asc = state.sortAsc;
    var rows = ranked.slice();
    if (k !== "score" || asc) rows.sort(function (a, b) { var x = sortVal(a, k), y = sortVal(b, k); var c = x < y ? -1 : x > y ? 1 : 0; return asc ? c : -c; });
    lastTable = rows;
    var shown = state.showAll ? rows : rows.filter(function (u) { return u.score > 0; }).slice(0, 10);
    $("btnAll").textContent = state.showAll ? "Show top 10" : "Show all " + rows.length + " units";
    var thead = "<tr>" + TABLE_COLS.map(function (c) { return '<th data-k="' + c.k + '" class="' + (c.cls || "") + (state.sortKey === c.k || (c.k === "rank" && state.sortKey === "score") ? " sorted" + (state.sortAsc ? " asc" : "") : "") + '">' + c.label + "</th>"; }).join("") + "</tr>";
    $("tUnits").querySelector("thead").innerHTML = thead;
    function pc(v, std) { return '<span class="' + (v < std ? "bad" : "ok") + '">' + v.toFixed(0) + "%</span>"; }
    $("tUnits").querySelector("tbody").innerHTML = shown.length ? shown.map(function (u) {
      var chg = u.prevRating && u.prevRating !== u.r.readiness_rating ? ' <span class="muted small">(was ' + u.prevRating + ")</span>" : "";
      return "<tr><td class=\"num\">" + u.rank + "</td><td><div class=\"unit\">" + esc(u.r.unit_name) + '</div><div class="bn">' + esc(u.r.battalion) + '</div></td><td class="hide-sm">' + esc(u.r.location) + '</td><td><span class="rating ' + u.r.readiness_rating + '">' + u.r.readiness_rating + "</span>" + chg + '</td><td class="num score">' + u.score.toFixed(1) +
        '</td><td class="num hide-sm">' + pc(u.m.strength, STD.strength) + '</td><td class="num hide-sm">' + pc(u.m.med, STD.med) + '</td><td class="num hide-sm">' + pc(u.m.eor, STD.eor) + '</td><td class="num hide-sm">' + pc(u.m.ctr, STD.ctr) + "</td><td>" +
        (u.drivers.length ? u.drivers.slice(0, 3).map(function (d) { return '<span class="drv ' + (d.type === "trend" ? "trend" : "") + '">' + esc(d.text) + "</span>"; }).join("") : '<span class="muted small">Meets all standards</span>') + "</td></tr>";
    }).join("") : '<tr><td colspan="10" class="muted">No units below standard for this selection.</td></tr>';
    Array.prototype.forEach.call($("tUnits").querySelectorAll("th"), function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-k"); if (key === "rank") key = "score";
        if (key === "drivers") return;
        if (state.sortKey === key) state.sortAsc = !state.sortAsc; else { state.sortKey = key; state.sortAsc = key === "unit" || key === "location"; }
        render();
      });
    });
  }

  function exportCsv() {
    var month = $("fMonth").value;
    var hdr = ["as_of_month", "attention_rank", "unit_id", "unit_name", "battalion", "brigade", "location", "readiness_rating", "attention_score", "assigned", "authorized", "strength_pct", "mosq_pct", "medical_ready_pct", "equip_on_hand_pct", "equip_or_pct", "ind_training_pct", "coll_training_pct", "top_drivers"];
    var lines = [hdr.join(",")].concat(lastTable.map(function (u) {
      var r = u.r, m = u.m;
      return [month, u.rank, r.unit_id, r.unit_name, r.battalion, r.brigade, r.location, r.readiness_rating, u.score.toFixed(1), r.assigned, r.authorized, m.strength.toFixed(1), m.mosq.toFixed(1), m.med.toFixed(1), m.eoh.toFixed(1), m.eor.toFixed(1), m.itr.toFixed(1), m.ctr.toFixed(1), u.drivers.slice(0, 3).map(function (d) { return d.text; }).join("; ")]
        .map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",");
    }));
    var blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "readiness_units_" + month + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function upcomingEvents(month) {
    var p = month.split("-"), after = new Date(+p[0], +p[1], 1); // first day after selected month
    var b = $("fBrigade").value, bn = $("fBattalion").value, loc = $("fLocation").value;
    var limit = new Date(after); limit.setDate(limit.getDate() + 120);
    return state.events.filter(function (e) {
      var d = new Date(e.start + "T12:00:00");
      if (isNaN(d) || d < after || d > limit) return false;
      if (b && e.brigade !== "All" && e.brigade !== b) return false;
      if (bn && e.battalion !== "All" && e.battalion !== bn) return false;
      if (loc && e.battalion !== "All" && String(e.location || "").indexOf(loc) !== 0) return false;
      return true;
    }).sort(function (x, y) { return x.start < y.start ? -1 : 1; });
  }
  function renderEvents(month) {
    var ev = upcomingEvents(month);
    function d(s) { return new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
    $("tEvents").querySelector("tbody").innerHTML = ev.length ? ev.slice(0, 14).map(function (e) {
      return "<tr><td style=\"white-space:nowrap\">" + d(e.start) + (e.end && e.end !== e.start ? "\u2013" + d(e.end) : "") + "</td><td>" + esc(e.type) + "</td><td>" + esc(e.battalion === "All" ? "All units" : e.battalion) + "</td><td>" + esc(e.location) + "</td><td>" + esc(e.notes) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="muted">No events in the 120 days after ' + monthLabel(month) + " for this selection.</td></tr>";
  }

  // ---------- file loading ----------
  function loadFile(file) {
    var msg = $("loadMsg"); msg.className = "loadmsg"; msg.textContent = "Reading " + file.name + "\u2026";
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
        var first = wb.SheetNames.filter(function (n) { return n.toLowerCase() !== "events"; })[0];
        var recs = XLSX.utils.sheet_to_json(wb.Sheets[first], { defval: "", raw: true });
        var evName = wb.SheetNames.filter(function (n) { return n.toLowerCase() === "events"; })[0];
        var evs = evName ? XLSX.utils.sheet_to_json(wb.Sheets[evName], { defval: "" }) : [];
        if (!recs.length) throw new Error("The file has no rows.");
        var cols = Object.keys(recs[0]).map(function (c) { return String(c).trim().toLowerCase(); });
        var missing = COLUMNS.filter(function (c) { return c[1] && cols.indexOf(c[0]) < 0; }).map(function (c) { return c[0]; });
        if (missing.length) throw new Error("Missing required column(s): " + missing.join(", ") + ". Download the template to see the expected layout.");
        var before = recs.length;
        setData(recs, evs, "Your file: " + file.name);
        var kept = state.records.length;
        msg.className = "loadmsg okm";
        msg.textContent = "Loaded " + kept + " of " + before + " rows from " + file.name + (kept < before ? " (rows missing month, unit_id, authorized or assigned were skipped)" : "") + ". Data stays in this browser tab.";
      } catch (err) { msg.className = "loadmsg err"; msg.textContent = "Could not load file: " + err.message; }
    };
    reader.onerror = function () { msg.className = "loadmsg err"; msg.textContent = "Could not read the file."; };
    reader.readAsArrayBuffer(file);
  }

  // ---------- print theming ----------
  function themeCharts(light) {
    Chart.defaults.color = light ? "#222" : "#c7d3e3";
    Chart.defaults.borderColor = light ? "rgba(0,0,0,.12)" : "rgba(60,95,143,.25)";
    Object.keys(charts).forEach(function (k) {
      var c = charts[k];
      if (c.options.scales) Object.keys(c.options.scales).forEach(function (a) { var sc = c.options.scales[a]; sc.ticks = sc.ticks || {}; sc.ticks.color = Chart.defaults.color; if (sc.grid) sc.grid.color = Chart.defaults.borderColor; if (sc.title) sc.title.color = Chart.defaults.color; });
      if (c.options.plugins && c.options.plugins.legend) { c.options.plugins.legend.labels = c.options.plugins.legend.labels || {}; c.options.plugins.legend.labels.color = Chart.defaults.color; }
      c.update("none");
    });
  }

  // ---------- init ----------
  function init() {
    Chart.defaults.color = "#c7d3e3";
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.borderColor = "rgba(60,95,143,.25)";
    $("dictBody").innerHTML = COLUMNS.map(function (c) { return "<tr><td><code>" + c[0] + "</code></td><td>" + (c[1] ? "Yes" : "Optional") + "</td><td>" + c[2] + "</td></tr>"; }).join("");
    $("fBrigade").addEventListener("change", function () { $("fBattalion").value = ""; $("fLocation").value = ""; buildFilters(false); render(); });
    $("fBattalion").addEventListener("change", function () { $("fLocation").value = ""; buildFilters(false); render(); });
    $("fLocation").addEventListener("change", render);
    $("fMonth").addEventListener("change", render);
    $("btnReset").addEventListener("click", function () { state.sortKey = "score"; state.sortAsc = false; buildFilters(true); render(); });
    $("btnAll").addEventListener("click", function () { state.showAll = !state.showAll; render(); });
    $("btnCsv").addEventListener("click", exportCsv);
    $("btnPrint").addEventListener("click", function () { window.print(); });
    $("btnLoad").addEventListener("click", function () { var p = $("loadPanel"); p.hidden = !p.hidden; });
    $("fileInput").addEventListener("change", function (e) { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; });
    $("btnDemo").addEventListener("click", function () { setData(DEMO.records, DEMO.events, "Demo dataset"); $("loadMsg").className = "loadmsg okm"; $("loadMsg").textContent = "Demo data restored."; });
    window.addEventListener("beforeprint", function () { themeCharts(true); });
    window.addEventListener("afterprint", function () { themeCharts(false); });
    setData(DEMO.records, DEMO.events, "Demo dataset");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
