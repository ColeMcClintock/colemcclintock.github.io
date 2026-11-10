/* G1 Dashboard: Spend Plans (layout preview). Planned amount by Account and fiscal month vs actual Total Expenditure
   from the Status of Funds page. Everything runs in this browser tab.
   Data model (kept separate so a real spend-plan report can be mapped in later):
     plan    {fy:"2026", acct:"Funeral Honors", fm:1..12, amt}   from the Status of Funds spend plan, or the optional monthly template here
     actual  {fy, acct, fm, te}                            from G1.mods.sof.feed(): Total Expenditure exactly as on Status of Funds
   Variance % = (Actual - Planned) / Planned; |variance| up to 5% green, over 5% up to 10% yellow, over 10% red. */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, C = w.G1, $ = K.$, esc = K.esc, n = L.n, plural = L.plural, full = L.full;
  var FM = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  var VCOL = { g: "#16a34a", y: "#eab308", r: "#dc2626", na: "#94a3b8" }, VTXT = { g: "Within 5%", y: "5\u201310% off", r: "Over 10% off", na: "No plan" };
  var PLAN_COL = "#cbd5e1";
  var S = { own: null, files: [], mode: "month", acct: "", fy: "", ownAsOf: null };

  // ---------- variance ----------
  // null when nothing was planned but something was spent (no percentage); 0 when both are zero
  C.varPct = function (a, p) { a = n(a); p = n(p); return p ? (a - p) / Math.abs(p) : a ? null : 0; };
  C.varClass = function (v) {
    if (v == null || !isFinite(v)) return "na";
    var x = Math.round(Math.abs(v) * 1e6) / 1e6;
    return x <= 0.05 ? "g" : x <= 0.10 ? "y" : "r";
  };
  C.varText = function (v) { if (v != null && Math.abs(v) < 0.0005) v = 0; return v == null || !isFinite(v) ? "\u2014" : (v > 0 ? "+" : v < 0 ? "\u2212" : "") + Math.abs(v * 100).toFixed(1) + "%"; };
  function chip(v, extra) { var k = C.varClass(v); return '<span class="vchip ' + k + '" title="' + VTXT[k] + '">' + (k === "na" && v == null ? "no plan" : C.varText(v)) + (extra || "") + "</span>"; }

  // ---------- spend plan upload: Account, October .. September (planned $ per month), always the current fiscal year ----------
  // Month headers may be full names, 3-letter abbreviations (Sept too), Excel dates or "Month 1".."Month 12" (October = 1).
  // A Fiscal Year column is optional; when present and filled in it is used, otherwise the row is for the current fiscal year.
  var MON_IDX = { oct: 1, october: 1, nov: 2, november: 2, dec: 3, december: 3, jan: 4, january: 4, feb: 5, february: 5, mar: 6, march: 6,
    apr: 7, april: 7, may: 8, jun: 9, june: 9, jul: 10, july: 10, aug: 11, august: 11, sep: 12, sept: 12, september: 12 };
  function calFm(m) { return (m + 2) % 12 + 1; }   // calendar month 1..12 -> fiscal month (October = 1)
  function headKey(h) {
    if (typeof h === "number") {   // an Excel date header (serial number)
      if (h > 20000 && h < 80000 && w.XLSX && XLSX.SSF) { var dc = XLSX.SSF.parse_date_code(h); if (dc && dc.m) return "m" + calFm(dc.m); }
      return null;
    }
    if (h instanceof Date) return "m" + calFm(h.getMonth() + 1);
    var raw = L.txt(h == null ? "" : String(h)).toLowerCase(), k = L.norm(raw), m;
    if ((m = raw.match(/^(\d{4})[-\/.](\d{1,2})(?:[-\/.]\d{1,2})?(?:[ t].*)?$/)) && +m[2] >= 1 && +m[2] <= 12) return "m" + calFm(+m[2]);     // 2026-10-01
    if ((m = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/)) && +m[1] >= 1 && +m[1] <= 12) return "m" + calFm(+m[1]);           // 10/1/2026
    if ((m = raw.match(/^([a-z]{3,9})\.?[\s\-\/']*(?:\d{1,2}[\s,]*)?(?:\d{2}|\d{4})?$/)) && MON_IDX[m[1]]) return "m" + MON_IDX[m[1]];    // Oct, October, Oct-26, Oct 2026
    if (k === "account" || k === "accountname" || k === "acct") return "acct";
    if (k === "fiscalyear" || k === "fy") return "fy";
    if ((m = k.match(/^(?:month|fm|m|fiscalmonth)(\d{1,2})$/)) && +m[1] >= 1 && +m[1] <= 12) return "m" + +m[1];
    if (MON_IDX[k]) return "m" + MON_IDX[k];
    return null;
  }
  function headerRow(src) {
    for (var r = 0; r < Math.min(src.rows, 30); r++) {
      var map = {}, months = 0;
      for (var c = 0; c < src.cols; c++) { var k = headKey(src.get(r, c)); if (k && map[k] == null) { map[k] = c; if (k[0] === "m") months++; } }
      if (map.acct != null && months >= 6) return { row: r, map: map, months: months };
    }
    return null;
  }
  function classify(src) { var h = headerRow(src); return h ? { kind: "plan12", score: 40 + h.months } : null; }
  function parse(kind, src, fname, ws, name) {
    var h = headerRow(src), rows = [], blank = 0, bad = 0;
    var e = { name: name, kind: "plan12", kindLabel: "Spend plan", count: 0, rows: rows, totals: 0 };
    if (!h) { e.fatal = "Needs an Account column and October \u2026 September columns."; return e; }
    var cur = C.currentFy(), assigned = 0;   // no Fiscal Year given: the plan is for the current fiscal year
    for (var r = h.row + 1; r < src.rows; r++) {
      var acct = L.idText(src.get(r, h.map.acct)), fy = h.map.fy == null ? "" : L.fyText(src.get(r, h.map.fy)), any = false;
      if (!acct && !fy) { blank++; continue; }
      if (/^(grand\s*)?(sub\s*)?totals?\b|^sum$/i.test(acct)) { e.totals++; continue; }   // Total rows are not accounts
      if (!fy) { fy = cur; assigned++; }
      for (var m = 1; m <= 12; m++) {
        if (h.map["m" + m] == null) continue;
        var v = src.get(r, h.map["m" + m]); if (L.blankish(v)) continue;
        var amt = L.parseAmt(v); if (amt == null || isNaN(amt)) { bad++; continue; }
        rows.push({ fy: fy, acct: acct || L.UNMAPPED, fm: m, amt: amt }); any = true;
      }
      if (any) e.count++;
    }
    if (!rows.length) e.fatal = "No planned amounts found.";
    e.warns = bad ? 1 : 0; e.fyAssigned = assigned ? { n: assigned, fy: cur } : null;
    e.status = plural(e.count, "plan row") + " (" + plural(rows.length, "month amount") + ")" + (assigned ? " \u00b7 FY" + cur + " (current fiscal year)" : "") + (e.totals ? " \u00b7 " + plural(e.totals, "total row") + " skipped" : "") + (bad ? " \u00b7 " + plural(bad, "unreadable amount") + " skipped" : "");
    return e;
  }
  function ingest(list) {
    var good = list.filter(function (e) { return !e.fatal && !e.error; });
    S.files = S.files.filter(function (e) { return !good.length; }).concat(list);   // a new monthly plan replaces the earlier one
    if (good.length) S.own = { at: new Date().toISOString(), rows: [].concat.apply([], good.map(function (e) { return e.rows; })), files: good.map(function (e) { return e.name; }) };
  }
  function clear() { S.own = null; S.files = []; S.acct = ""; S.fy = ""; }
  function snapshot() { return S.own ? { own: S.own } : {}; }
  function restore(o) {
    if (o && o.own && o.own.rows) { S.own = o.own; S.files = o.own.files.map(function (f) { return { name: f, kind: "plan12", kindLabel: "Spend plan", count: o.own.rows.length, status: "Saved spend plan" }; }); }
  }

  // ---------- model ----------
  function feed() {
    var sof = C.mods.sof, d = sof && sof.feed ? sof.feed() : { actual: [], plan: [], noMonth: {}, fy: "" };
    if (S.own) { d.plan = S.own.rows; d.planSrc = "monthly"; d.planFiles = S.own.files; } else d.planSrc = d.plan.length ? "sof" : "";
    // plan accounts take the Status of Funds spelling when the names match (trimmed, ignoring case)
    var canon = {}, f = sof && sof._state && sof._state.fund;
    if (f && f.rows) f.rows.forEach(function (r) { if (r.acct) canon[akey(r.acct)] = r.acct; });
    d.actual.forEach(function (r) { canon[akey(r.acct)] = r.acct; });
    d.plan = d.plan.map(function (r) { var c = canon[akey(r.acct)]; return { fy: r.fy, acct: c || L.txt(r.acct).replace(/\s+/g, " "), fm: r.fm, amt: r.amt, matched: !!c }; });
    return d;
  }
  // opens on the current fiscal year whenever it has a plan or actuals, else the year Status of Funds opens on
  function defaultFy(d, ys) { var now = C.currentFy(); return ys.indexOf(now) >= 0 ? now : ys.indexOf(d.fy) >= 0 ? d.fy : ys[ys.length - 1] || ""; }
  function years(d) {
    var ys = {}; d.actual.forEach(function (r) { ys[r.fy] = 1; }); d.plan.forEach(function (r) { if (r.fy) ys[r.fy] = 1; });
    return Object.keys(ys).sort();
  }
  function model(d, fy) {
    var A = {}, order = [];
    function get(label) { var k = akey(label); if (!A[k]) { A[k] = { label: label, p: zeros(), a: zeros(), planned: false }; order.push(k); } return A[k]; }
    d.plan.forEach(function (r) { if (r.fy && r.fy !== fy) return; var x = get(r.acct); x.p[r.fm - 1] += n(r.amt); x.planned = true; });
    var last = 0;
    d.actual.forEach(function (r) { if (r.fy !== fy) return; var x = get(r.acct); x.label = r.acct; x.sof = true; x.a[r.fm - 1] += r.te; if (r.fm > last) last = r.fm; });
    var list = order.map(function (k) { return A[k]; }).filter(function (x) { return x.planned || x.a.some(function (v) { return v; }); });
    list.forEach(function (x) { x.p = x.p.map(r2); x.a = x.a.map(r2); });
    list.sort(function (a, b) { return (a.label === L.UNMAPPED) - (b.label === L.UNMAPPED) || (b.planned - a.planned) || a.label.localeCompare(b.label); });
    return { fy: fy, list: list, last: last, noMonth: d.noMonth[fy] || null };
  }
  function akey(a) { return L.txt(a).replace(/\s+/g, " ").toUpperCase(); }   // plan accounts match SOF accounts trimmed, ignoring case
  // demo plan = the Status of Funds spend plan while the demo is showing (no real plan uploaded)
  function isDemoPlan(d) { return !S.own && C.source === "demo"; }
  // plan accounts with no Status of Funds account of that name (any year), for the drawer
  function unmatched(d) {
    if (!d.actual.length && !(C.mods.sof._state.fund)) return [];
    var out = []; d.plan.forEach(function (r) { if (!r.matched && out.indexOf(r.acct) < 0) out.push(r.acct); });
    return out;
  }
  function zeros() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function cum(arr) { var t = 0; return arr.map(function (v) { t += v; return r2(t); }); }
  function sumTo(arr, m) { var t = 0; for (var i = 0; i < m; i++) t += arr[i]; return r2(t); }
  function totals(list) { var p = zeros(), a = zeros(); list.forEach(function (x) { for (var i = 0; i < 12; i++) { p[i] += x.p[i]; a[i] += x.a[i]; } }); return { label: "All accounts", p: p.map(r2), a: a.map(r2), planned: list.some(function (x) { return x.planned; }) }; }
  // to-date figures through the latest month that has actuals
  function toDate(x, last) { var p = sumTo(x.p, last), a = sumTo(x.a, last); return { p: p, a: a, v: C.varPct(a, p) }; }

  // ---------- render ----------
  var M; // last model (tests read it through G1.mods.spend.model())
  function render() {
    var d = feed(), ys = years(d);
    var fySel = $("spFy"), cur = S.fy && ys.indexOf(S.fy) >= 0 ? S.fy : defaultFy(d, ys);
    fySel.innerHTML = ys.map(function (y) { return '<option value="' + esc(y) + '">FY' + esc(y) + "</option>"; }).join("");
    if (cur) fySel.value = cur;
    M = model(d, cur);
    var accts = M.list.map(function (x) { return x.label; });
    if (S.acct && accts.indexOf(S.acct) < 0) S.acct = "";
    $("spAcct").innerHTML = '<option value="">All accounts</option>' + accts.map(function (a) { return '<option' + (a === S.acct ? " selected" : "") + ">" + esc(a) + "</option>"; }).join("");
    Array.prototype.forEach.call(document.querySelectorAll("#spMode button"), function (b) { b.classList.toggle("on", b.getAttribute("data-m") === S.mode); b.setAttribute("aria-pressed", String(b.getAttribute("data-m") === S.mode)); });
    var sel = S.acct ? M.list.filter(function (x) { return x.label === S.acct; })[0] : totals(M.list);
    $("spScope").innerHTML = "<strong>FY" + esc(cur || "\u2014") + "</strong> \u00b7 " + esc(S.acct || "All accounts") + " \u00b7 " +
      (M.last ? "actuals through " + FM[M.last - 1] + " (month " + M.last + ")" : "no actuals yet");
    kpis(sel);
    chart(sel);
    grid();
    $("spDemo").hidden = !isDemoPlan(d);
    $("spNote").textContent = d.planSrc === "monthly" ? "Planned amounts from the uploaded spend plan." : d.planSrc === "sof" ? "Planned amounts from the spend plan loaded with Status of Funds." : "No spend plan loaded: planned amounts show as $0.";
  }
  function kpi(lbl, val, sub, color, title) { return '<div class="kpi" style="--st:' + color + '"' + (title ? ' title="' + esc(title) + '"' : "") + '><div class="lbl">' + lbl + '</div><div class="val">' + val + '</div><div class="sub">' + (sub || "&nbsp;") + "</div></div>"; }
  function kpis(sel) {
    var last = M.last, td = toDate(sel, last), k = C.varClass(td.v), thru = last ? (last > 1 ? "Oct\u2013" : "") + FM[last - 1] : "No months with actuals";
    var planned = M.list.filter(function (x) { return x.planned; }), off = { y: 0, r: 0 };
    planned.forEach(function (x) { var c = C.varClass(toDate(x, last).v); if (c === "y" || c === "r") off[c]++; });
    var nOff = off.y + off.r, offCol = !last ? VCOL.na : off.r ? VCOL.r : off.y ? VCOL.y : VCOL.g;
    $("spKpis").innerHTML =
      kpi("Planned to date", K.money(td.p), thru + " \u00b7 year plan " + K.money(sumTo(sel.p, 12)), "#94a3b8", full(td.p)) +
      kpi("Actual to date", K.money(td.a), "Total Expenditure, " + thru, "#2563eb", full(td.a)) +
      kpi("Variance to date", '<span class="vtxt ' + k + '">' + C.varText(td.v) + "</span>", td.v == null ? "Nothing planned" : (td.a >= td.p ? K.money(td.a - td.p) + " over plan" : K.money(td.p - td.a) + " under plan") + " \u00b7 " + VTXT[k], VCOL[k]) +
      kpi("Accounts off plan", nOff + '<span class="of"> of ' + planned.length + "</span>", last ? "Outside \u00b15% to date" + (nOff ? " \u00b7 " + off.y + " yellow, " + off.r + " red" : "") : "No actuals yet", offCol);
  }
  function chart(sel) {
    var last = M.last, cumu = S.mode === "cum";
    var P = cumu ? cum(sel.p) : sel.p, A0 = cumu ? cum(sel.a) : sel.a;
    var A = A0.map(function (v, i) { return i < last ? v : null; });
    var V = A.map(function (v, i) { return v == null ? null : C.varPct(v, P[i]); }), cols = V.map(function (v) { return VCOL[C.varClass(v)]; });
    var o = K.chartBase();
    o.scales.y.ticks = { callback: function (v) { return K.money(v); } }; o.scales.y.beginAtZero = true;
    o.plugins.tooltip.callbacks = {
      label: function (c) { return c.dataset.label + ": " + full(c.parsed.y); },
      footer: function (items) { var i = items[0].dataIndex; return V[i] == null ? (A[i] == null ? "No actuals yet" : "") : "Variance " + C.varText(V[i]) + " (" + VTXT[C.varClass(V[i])] + ")"; }
    };
    o.plugins.legend.labels.generateLabels = function () {
      return [{ text: cumu ? "Planned (cumulative)" : "Planned", fillStyle: PLAN_COL, strokeStyle: PLAN_COL, lineWidth: 0 },
        { text: (cumu ? "Actual (cumulative)" : "Actual") + ", colored by variance", fillStyle: "#2563eb", strokeStyle: "#2563eb", lineWidth: 0 }];
    };
    var ds = cumu ? [
      { type: "line", label: "Planned (cumulative)", data: P, borderColor: "#94a3b8", backgroundColor: PLAN_COL, borderDash: [6, 4], pointRadius: 3, pointBackgroundColor: "#94a3b8", tension: 0, order: 2 },
      { type: "line", label: "Actual (cumulative)", data: A, borderColor: "#2563eb", backgroundColor: "#2563eb", pointRadius: 7, pointHoverRadius: 9, pointBackgroundColor: cols, pointBorderColor: "#fff", pointBorderWidth: 2, tension: 0, spanGaps: false, order: 1 }
    ] : [
      { type: "bar", label: "Planned", data: P, backgroundColor: PLAN_COL },
      { type: "bar", label: "Actual", data: A, backgroundColor: cols }
    ];
    K.upsert("cSpend", { type: cumu ? "line" : "bar", data: { labels: FM.map(function (m, i) { return m + " (" + (i + 1) + ")"; }), datasets: ds }, options: o });
    $("spChartTitle").textContent = (cumu ? "Cumulative planned vs actual" : "Planned vs actual by month") + " \u00b7 " + (S.acct || "All accounts");
  }
  function cell(p, a, show, planned) {
    var v = show ? C.varPct(a, p) : null;
    if (show && !planned) return '<td class="vc na"><div class="pa"><span>P</span>\u2014</div><div class="pa"><span>A</span>' + K.money(a) + "</div>" + (a ? chip(null) : '<span class="vchip none">&nbsp;</span>') + "</td>";
    return '<td class="vc' + (show ? " " + C.varClass(v) : " fut") + '"><div class="pa"><span>P</span>' + K.money(p) + '</div><div class="pa"><span>A</span>' + (show ? K.money(a) : "\u2014") + "</div>" + (show ? chip(v) : '<span class="vchip none">&nbsp;</span>') + "</td>";
  }
  function grid() {
    var last = M.last, cumu = S.mode === "cum", t = $("tSpend");
    t.tHead.innerHTML = "<tr><th>Account</th>" + FM.map(function (m, i) { return '<th class="num' + (i >= last ? " fut" : "") + '">' + m + '<small>' + (i + 1) + "</small></th>"; }).join("") + '<th class="num td">To date</th><th class="num">FY plan</th></tr>';
    function row(x, isTot) {
      var P = cumu ? cum(x.p) : x.p, A = cumu ? cum(x.a) : x.a, td = toDate(x, last);
      var name = isTot ? "<strong>All accounts</strong>" : '<button type="button" class="alink" data-acct="' + esc(x.label) + '">' + esc(x.label) + "</button>" + (x.planned ? "" : '<div class="muted small">no plan</div>');
      return "<tr" + (!isTot && x.label === S.acct ? ' class="sel"' : "") + "><td class=\"an\">" + name + "</td>" + P.map(function (p, i) { return cell(p, A[i], i < last, x.planned); }).join("") +
        cell(td.p, td.a, last > 0, x.planned).replace('<td class="vc', '<td class="vc td') + '<td class="num fyp">' + K.money(sumTo(x.p, 12)) + "</td></tr>";
    }
    var rows = S.acct ? M.list.filter(function (x) { return x.label === S.acct; }) : M.list;
    t.tBodies[0].innerHTML = rows.length ? rows.map(function (x) { return row(x, false); }).join("") : '<tr><td colspan="15" class="muted">No accounts.</td></tr>';
    t.tFoot.innerHTML = !S.acct && M.list.length > 1 ? row(totals(M.list), true) : "";
    $("spGridNote").textContent = (cumu ? "Cumulative from October. " : "Each month on its own. ") + "P = planned, A = actual Total Expenditure; chips show variance (green within \u00b15%, yellow 5\u201310%, red over 10%)." +
      (last < 12 ? " Months after " + (last ? FM[last - 1] : "October") + " have no actuals yet." : "") + " Click an account to filter.";
  }

  // ---------- drawer ----------
  function report() {
    var d = feed(), h = [], warns = 0;
    h.push('<p class="ok"><strong>Layout preview.</strong> Planned amounts by Account and fiscal month; actuals are Total Expenditure from Status of Funds.</p>');
    if (d.planSrc === "monthly") h.push('<p class="ok">Plan: ' + esc(d.planFiles.join(", ")) + ", " + plural(d.plan.length, "month amount") + (S.own && S.own.at ? ", loaded " + C.dateText(new Date(S.own.at)) : "") + ".</p>");
    else if (isDemoPlan(d)) h.push('<p class="ok">Plan: demo spend plan (until a spend plan is uploaded).</p>');
    else if (d.planSrc === "sof") h.push('<p class="ok">Plan: the spend plan loaded with Status of Funds, ' + plural(d.plan.length, "row") + ".</p>");
    else { h.push('<p class="warn">No spend plan loaded.</p>'); warns++; }
    S.files.filter(function (e) { return e.fyAssigned; }).forEach(function (e) { h.push('<p class="ok">' + esc(e.name) + ": " + plural(e.fyAssigned.n, "row") + " without a Fiscal Year count for FY" + esc(e.fyAssigned.fy) + " (the current fiscal year; 1 October starts the next).</p>"); });
    h.push('<p class="ok">Actuals: ' + plural(d.actual.length, "Status of Funds line") + " with a fiscal month. Each line's cumulative-to-date amount is counted once, in its fiscal month; cumulative = running total from October, so September equals the year's Total Expenditure.</p>");
    var um = unmatched(d);
    if (um.length) { warns++; h.push('<p class="warn">' + plural(um.length, "plan account") + " not found in Status of Funds (shown as their own rows with no actuals): " + um.map(esc).join(", ") + ".</p>"); }
    Object.keys(d.noMonth).sort().forEach(function (fy) { var x = d.noMonth[fy]; warns++; h.push('<p class="warn">FY' + esc(fy) + ": " + plural(x.lines, "line") + " (" + full(x.te) + ") have no fiscal month. They count in Status of Funds Total Expenditure but in no month here.</p>"); });
    if (M && M.last) h.push('<p class="ok">FY' + esc(M.fy) + ": actuals through month " + M.last + " (" + FM[M.last - 1] + ").</p>");
    S.files.filter(function (e) { return e.fatal; }).forEach(function (e) { warns++; h.push('<p class="warn">' + esc(e.name) + ": " + esc(e.fatal) + "</p>"); });
    return { html: h.join(""), warns: warns };
  }

  // ---------- home ----------
  function summary() {
    var d = feed(); if (!d.actual.length && !d.plan.length) return null;
    var ys = years(d), fy = defaultFy(d, ys), m = model(d, fy), tot = totals(m.list), td = toDate(tot, m.last);
    var accts = m.list.filter(function (x) { return x.planned; }).map(function (x) { var t = toDate(x, m.last); return { label: x.label, v: t.v, k: C.varClass(t.v), p: t.p, a: t.a }; });
    return { demo: isDemoPlan(d), fy: fy, last: m.last, month: m.last ? FM[m.last - 1] : "", p: td.p, a: td.a, v: td.v, k: C.varClass(td.v), accts: accts,
      off: accts.filter(function (x) { return x.k === "y" || x.k === "r"; }).length };
  }

  var mod = {
    classify: classify, parse: parse, ingest: ingest, clear: clear, snapshot: snapshot, restore: restore, report: report, render: render, summary: summary,
    entries: function () { return S.files; },
    hasData: function () { var d = feed(); return d.actual.length > 0 || d.plan.length > 0; },
    model: function () { return M; }, unmatched: function () { return unmatched(feed()); }, _state: S,
    init: function () {
      $("spFy").addEventListener("change", function () { S.fy = this.value; render(); });
      $("spAcct").addEventListener("change", function () { S.acct = this.value; render(); });
      $("spMode").addEventListener("click", function (e) { var b = e.target.closest("button[data-m]"); if (b) { S.mode = b.getAttribute("data-m"); render(); } });
      $("spReset").addEventListener("click", function () { S.acct = ""; S.fy = ""; S.mode = "month"; render(); });
      $("tSpend").addEventListener("click", function (e) { var b = e.target.closest("[data-acct]"); if (b) { var a = b.getAttribute("data-acct"); S.acct = S.acct === a ? "" : a; render(); } });
    }
  };
  // "Data as of" = when the spend plan was uploaded; without one, the Status of Funds upload (actuals)
  Object.defineProperty(mod, "asOf", {
    get: function () { var s = C.mods.sof; return S.own && S.ownAsOf ? S.ownAsOf : s && s.hasData() ? s.asOf : null; },
    set: function (v) { S.ownAsOf = S.own ? v : null; }, enumerable: true, configurable: true
  });
  C.register("spend", mod);
})(window);
