/* Safety & Mishaps dashboard (ASMIS export layout). All processing is local. */
(function () {
  "use strict";
  var K = window.DashKit, A = window.ASMIS, $ = K.$, esc = K.esc;
  var CLASSES = A.CLASS_ORDER;   // A, B, C, D, E (Ground), R (NG), Unclassified
  var CLS_COLOR = { A: "#e0645c", B: "#e88a4c", C: "#e3b34c", D: "#a9c16a", E: "#7fb3d5", R: "#b59ad8", Unclassified: "#4a5a70" };
  var CLS_SUB = { A: "$2.5M+ or fatality / PTD", B: "$600K+ or PPD / 3+ hospitalized", C: "$60K+ or lost-time injury", D: "$25K+ or restricted-duty injury", E: "Ground", R: "National Guard", Unclassified: "No class assigned yet" };
  function clsColor(c) { return CLS_COLOR[c] || "#c9a27e"; }
  function clsList() { // classes present in the loaded data, in standard order, then unrecognized raw values
    var have = K.uniq(S.recs.map(function (r) { return r.cls; }).filter(function (c) { return c != null; }));
    return CLASSES.filter(function (c) { return have.indexOf(c) >= 0; }).concat(have.filter(function (c) { return CLASSES.indexOf(c) < 0; }).sort());
  }
  var STATUSES = ["Investigation Ongoing", "In Review NGB", "Final"];
  var DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var TBANDS = [["0000-0359", 0], ["0400-0759", 4], ["0800-1159", 8], ["1200-1559", 12], ["1600-1959", 16], ["2000-2359", 20]];
  var FYM = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  var SUPPRESS = 3;
  var DEMO_KEYS = ["gender", "rank", "age_years", "yos"];

  var S = { recs: [], have: {}, strength: null, asOf: new Date(), source: "demo", fileName: "", showAll: false, hf: [] };

  function d0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
  function iso(d) { return A.iso(d); }
  function fd(d) { return d ? A.fmtDate(d) : "\u2014"; }
  function n(v) { return v || 0; }
  function cnt(a, f) { var m = {}; a.forEach(function (r) { var k = f(r); if (k == null || k === "") return; m[k] = (m[k] || 0) + 1; }); return m; }
  function sortKeys(m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); }); }
  function pill(c) {
    if (c == null) return "";
    var known = CLASSES.indexOf(c) >= 0, cls = c === "Unclassified" ? "U" : known ? c : "NM";
    return '<span class="pill ' + cls + '" title="' + esc(A.classLabel(c)) + '">' + esc(c === "Unclassified" ? "Unclass." : c) + "</span>";
  }
  function rag(r) { return r.isOverdue ? "red" : (r.daysToDue <= 30 ? "amber" : "green"); }
  function ragLabel(r) { return { red: "Overdue", amber: "Due within 30 days", green: "On time" }[rag(r)]; }

  // ---------- load ----------
  function loadAoa(aoa, asOf, strength, source, fileName, sheetName) {
    var res = A.parseTable(aoa, asOf);
    report(res.report, source, fileName, sheetName, strength);
    if (res.report.fatal || !res.records.length) return false;
    S.recs = res.records; S.asOf = asOf; S.strength = strength; S.source = source; S.fileName = fileName || "";
    S.have = {}; res.report.matched.forEach(function (k) { S.have[k] = res.records.some(function (r) { return r[k] != null && r[k] !== ""; }); });
    S.hf = []; S.showAll = false;
    applyVisibility(); buildFilters(true); render();
    return true;
  }
  function loadDemo() {
    var D = window.ASMIS_DATA, p = D.exportDate.split("-");
    loadAoa(A.objectsToAoa(D.headers, D.rows), new Date(+p[0], +p[1] - 1, +p[2], 12), D.strength.map(function (s) { return { msc: s.MSC, battalion: s.Battalion, assigned: s.Assigned }; }), "demo", "", "");
  }
  function codes(list) { return list.map(function (m) { return "<code>" + esc(m) + "</code>"; }).join(", "); }
  // Builds the detailed load report and the compact status bar.
  function report(rep, source, fileName, sheetName, strength) {
    var el = $("loadReport"), h = [], warns = 0;
    if (source === "demo") {
      el.innerHTML = '<p class="muted">Showing the built-in fictional demo data (' + K.fmt(rep.rowsLoaded) + " records in the ASMIS export layout).</p>";
      setBar("ok", "Demo data (fictional) \u00b7 " + K.fmt(rep.rowsLoaded) + " accidents \u00b7 " + rep.requiredMatched + "/" + rep.totalColumns + " columns", 0);
      return;
    }
    if (rep.fatal) {
      el.innerHTML = '<p class="err"><strong>Could not load ' + esc(fileName) + ".</strong> " + esc(rep.fatal) + "</p>" + (rep.missing.length ? '<p class="muted">Missing: ' + codes(rep.missing) + "</p>" : "");
      setBar("err", "Could not load " + fileName + " \u00b7 still showing the previous data", 1); setExpanded(true, false); return;
    }
    var ok = rep.requiredMatched === rep.totalColumns;
    h.push("<p class=\"" + (rep.rowsLoaded ? "ok" : "err") + "\"><strong>Loaded " + K.fmt(rep.rowsLoaded) + " of " + K.fmt(rep.rowsRead) + " rows</strong> from " + esc(fileName) + (sheetName && sheetName !== fileName ? " (sheet &ldquo;" + esc(sheetName) + "&rdquo;, header row " + rep.headerRow + ")" : "") + "." + (rep.blankRows ? ' <span class="muted">' + K.fmt(rep.blankRows) + " blank row(s) ignored.</span>" : "") + "</p>");
    h.push("<p class=\"" + (ok ? "ok" : "warn") + "\"><strong>" + rep.requiredMatched + " of " + rep.totalColumns + " columns matched.</strong>" + (ok ? "" : " Visuals that need a missing column are hidden.") + "</p>");
    if (!ok) warns++;
    if (rep.missing.length) h.push('<p class="warn">Missing: ' + codes(rep.missing) + "</p>");
    if (rep.optional.length) h.push('<p class="ok">Optional columns used: ' + codes(rep.optional) + "</p>");
    if (rep.extra.length) h.push('<p class="muted">Extra columns ignored: ' + codes(rep.extra) + "</p>");
    if (rep.dupes.length) h.push('<p class="muted">Duplicate columns ignored: ' + codes(rep.dupes) + "</p>");
    if (rep.badDate.length) {
      warns++;
      h.push('<p class="err">' + rep.badDate.length + " row(s) with data were skipped because Accident Date is blank or unreadable (" + (rep.badDate.length === 1 ? "row " : "rows ") + rep.badDate.slice(0, 8).map(function (b) { return b.row + (b.value ? " &ldquo;" + esc(b.value) + "&rdquo;" : " blank"); }).join(", ") + (rep.badDate.length > 8 ? ", &hellip;" : "") + ").</p>");
    } else h.push('<p class="ok">All accident dates parsed.</p>');
    if (rep.badNumber) {
      warns++;
      h.push('<p class="warn">' + rep.badNumber + " number/currency cell(s) contain text that could not be read and were treated as blank. Examples: " +
        rep.badNumberExamples.map(function (x) { return "row " + x.row + " <code>" + esc(x.column) + "</code> = &ldquo;" + esc(x.value) + "&rdquo;"; }).join("; ") + ".</p>");
    }
    if (rep.otherClass) { warns++; h.push('<p class="warn">' + rep.otherClass + " row(s) have an unrecognized Accident Class, shown as-is: " + codes(rep.otherClassValues.slice(0, 8)) + ".</p>"); }
    if (rep.unclassified) h.push('<p class="muted">' + rep.unclassified + " record(s) have no Accident Class yet; shown as Unclassified.</p>");
    if (rep.computedOverdue) h.push('<p class="muted">Days Overdue was blank for ' + rep.computedOverdue + " open record(s); computed from the due date and today.</p>");
    if (rep.computedDue) h.push('<p class="muted">Due Date was blank for ' + rep.computedDue + " record(s); set to accident date + 90 days.</p>");
    h.push('<p class="muted">' + (strength ? "Strength sheet found: " + strength.length + " battalion(s); rates per 1,000 shown." : "No Strength sheet: rates per 1,000 are not shown.") + "</p>");
    el.innerHTML = h.join("");
    setBar(rep.rowsLoaded ? (warns ? "warn" : "ok") : "err", fileName + " \u00b7 " + K.fmt(rep.rowsLoaded) + " accidents \u00b7 " + rep.requiredMatched + "/" + rep.totalColumns + " columns", warns);
  }
  function setBar(state, textLine, warns) {
    var bar = $("loadBar");
    bar.className = "loadbar no-print chrome" + (state === "ok" ? "" : " " + state);
    $("lbIcon").innerHTML = state === "ok" ? "&#10003;" : state === "warn" ? "&#9888;" : "&#10005;";
    $("lbText").textContent = textLine;
    var bd = $("lbBadge"); bd.hidden = !warns || state === "err"; bd.textContent = warns + " warning" + (warns === 1 ? "" : "s");
  }
  var LS_KEY = "safetyDash.loadPanelExpanded";
  function lsGet() { try { return localStorage.getItem(LS_KEY) === "1"; } catch (e) { return false; } }
  function setExpanded(open, persist) {
    $("loadPanel").hidden = !open;
    $("btnDetails").textContent = open ? "Hide details" : "Show details";
    $("btnDetails").setAttribute("aria-expanded", String(open));
    if (persist !== false) { try { localStorage.setItem(LS_KEY, open ? "1" : "0"); } catch (e) { /* storage unavailable (file://, private mode) */ } }
  }
  function setPresent(on) {
    document.body.classList.toggle("present", on);
    $("btnPresent").setAttribute("aria-pressed", String(on));
    $("btnPresent").textContent = on ? "Exit presentation" : "Presentation mode";
    setTimeout(function () { Object.keys(K.charts).forEach(function (k) { K.charts[k].resize(); }); }, 50);
  }

  function applyVisibility() {
    document.querySelectorAll("[data-req]").forEach(function (el) {
      var ok = el.getAttribute("data-req").split(",").every(function (k) { return S.have[k]; });
      el.classList.toggle("hidden-missing", !ok);
    });
    document.querySelectorAll("[data-req-any]").forEach(function (el) {
      el.classList.toggle("hidden-missing", !el.getAttribute("data-req-any").split(",").some(function (k) { return S.have[k]; }));
    });
    var map = { fMsc: "msc", fBn: "battalion", fUic: "uic", fClass: "cls", fStatus: "status", fDuty: "duty_status", fOn: "on_duty", fSub: "subtype", fCause: "cause" };
    Object.keys(map).forEach(function (id) { $(id).parentNode.classList.toggle("hidden-missing", !S.have[map[id]]); });
  }

  // ---------- filters ----------
  function opts(key, order) {
    var v = K.uniq(S.recs.map(function (r) { return r[key]; }).filter(function (x) { return x != null && x !== ""; }));
    if (order) v.sort(function (a, b) { var i = order.indexOf(a), j = order.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || (a < b ? -1 : 1); });
    else v.sort();
    return v;
  }
  function buildFilters(reset) {
    var fys = K.uniq(S.recs.map(function (r) { return r.fy; })).sort();
    var fsel = $("fFy"); fsel.innerHTML = '<option value="">All years</option>' + fys.map(function (y) { return '<option value="' + y + '">FY' + String(y).slice(2) + "</option>"; }).join("");
    if (reset) { $("fFrom").value = ""; $("fTo").value = ""; }
    cascade(reset);
    var cl = clsList(); K.fillSelect($("fClass"), cl, "All classes", !reset, cl.map(A.classLabel));
    K.fillSelect($("fStatus"), opts("status", STATUSES), "All statuses", !reset);
    K.fillSelect($("fDuty"), opts("duty_status", ["MDAY", "AGR", "ADOS", "AT"]), "All", !reset);
    $("fOn").innerHTML = '<option value="">All</option><option value="Y">On duty</option><option value="N">Off duty</option>';
    K.fillSelect($("fSub"), opts("subtype"), "All subtypes", !reset);
    K.fillSelect($("fCause"), opts("cause"), "All causes", !reset);
  }
  function cascade(reset) {
    var msc = reset ? "" : $("fMsc").value, bn = reset ? "" : $("fBn").value;
    K.fillSelect($("fMsc"), opts("msc"), "All MSCs", !reset);
    var bns = K.uniq(S.recs.filter(function (r) { return !msc || r.msc === msc; }).map(function (r) { return r.battalion; }).filter(Boolean)).sort();
    K.fillSelect($("fBn"), bns, "All battalions", !reset);
    if (bns.indexOf(bn) < 0) $("fBn").value = "";
    bn = $("fBn").value;
    var uics = K.uniq(S.recs.filter(function (r) { return (!msc || r.msc === msc) && (!bn || r.battalion === bn); }).map(function (r) { return r.uic; }).filter(Boolean)).sort();
    var u = $("fUic").value; K.fillSelect($("fUic"), uics, "All UICs", !reset); if (uics.indexOf(u) < 0) $("fUic").value = "";
  }
  function F() {
    var f = { from: $("fFrom").value, to: $("fTo").value, msc: $("fMsc").value, bn: $("fBn").value, uic: $("fUic").value, cls: $("fClass").value,
      status: $("fStatus").value, duty: $("fDuty").value, on: $("fOn").value, sub: $("fSub").value, cause: $("fCause").value };
    return f;
  }
  function pass(r, f, ignoreDates) {
    if (!ignoreDates) { var di = iso(r.date); if (f.from && di < f.from) return false; if (f.to && di > f.to) return false; }
    if (f.msc && r.msc !== f.msc) return false; if (f.bn && r.battalion !== f.bn) return false; if (f.uic && r.uic !== f.uic) return false;
    if (f.cls && r.cls !== f.cls) return false; if (f.status && r.status !== f.status) return false; if (f.duty && r.duty_status !== f.duty) return false;
    if (f.on && r.on_duty !== (f.on === "Y")) return false; if (f.sub && r.subtype !== f.sub) return false; if (f.cause && r.cause !== f.cause) return false;
    return true;
  }

  // ---------- render ----------
  function render() {
    var f = F(), rows = S.recs.filter(function (r) { return pass(r, f); }), all = S.recs.filter(function (r) { return pass(r, f, true); });
    rows.sort(function (a, b) { return b.date - a.date; });
    var scope = [f.msc, f.bn, f.uic ? "UIC " + f.uic : "", f.cls ? "Class " + f.cls : "", f.status, f.duty, f.on ? (f.on === "Y" ? "On duty" : "Off duty") : "", f.sub, f.cause].filter(Boolean);
    var range = rangeOf(f, rows);
    $("asofLabel").textContent = K.fmt(rows.length) + " accident" + (rows.length === 1 ? "" : "s") + " \u00b7 " + (range ? fd(range[0]) + " to " + fd(range[1]) : "no data");
    $("scopeLabel").textContent = scope.length ? scope.join(" \u00b7 ") : "All MSCs";
    $("sourceLabel").textContent = S.source === "file" ? " \u00b7 Your file: " + S.fileName + " (as of today, " + fd(S.asOf) + ")" : " \u00b7 Demo data as of " + fd(S.asOf);
    kpis(rows, f, range);
    summary(rows, all, f, range);
    tracker(rows);
    monthly(rows, range);
    fyChart(all, f);
    breakdowns(rows);
    heat(rows);
    hfacs(rows);
    cost(rows);
    demographics(rows);
    allTable(rows);
  }
  function rangeOf(f, rows) {
    if (!rows.length && !f.from && !f.to) return null;
    var ds = rows.map(function (r) { return r.date; });
    var lo = f.from ? new Date(f.from + "T12:00") : new Date(Math.min.apply(null, ds));
    var hi = f.to ? new Date(f.to + "T12:00") : (S.source === "demo" || !rows.length ? S.asOf : new Date(Math.max(Math.max.apply(null, ds), Math.min(S.asOf, Date.now()))));
    if (!f.to && S.source === "demo") hi = S.asOf;
    return [lo, hi];
  }
  function strengthFor(f) {
    if (!S.strength || f.uic) return null;
    var s = S.strength.filter(function (x) { return (!f.msc || x.msc === f.msc) && (!f.bn || x.battalion === f.bn); });
    var t = K.sum(s, function (x) { return x.assigned; }); return t > 0 ? t : null;
  }
  function kpi(lbl, val, sub, cls, title) { return '<div class="kpi' + (cls ? " " + cls : "") + '"' + (title ? ' title="' + esc(title) + '"' : "") + '><div class="lbl">' + lbl + '</div><div class="val">' + val + '</div><div class="sub">' + (sub || "&nbsp;") + "</div></div>"; }
  function kpis(rows, f, range) {
    var c = cnt(rows, function (r) { return r.cls; }), str = strengthFor(f), months = range ? Math.max(1, (range[1] - range[0]) / 864e5 / 30.44) : 0;
    var rate = str && months ? rows.length / str * 1000 * 12 / months : null;
    var open = rows.filter(function (r) { return r.open; }), od = open.filter(function (r) { return r.isOverdue; });
    var ab = S.recs.filter(function (r) { return pass(r, f, true) && (r.cls === "A" || r.cls === "B") && r.date <= S.asOf; }).sort(function (a, b) { return b.date - a.date; })[0];
    var since = ab ? Math.round((d0(S.asOf) - d0(ab.date)) / 864e5) : null;
    var ecodN = rows.filter(function (r) { return r.hasEcod; }).length, inj = rows.filter(function (r) { return r.injury; }).length;
    var h = [];
    h.push(kpi("Total accidents", K.fmt(rows.length), rate != null ? K.fmt(rate, 2) + " per 1,000 / yr (" + K.fmt(str) + " assigned)" : (S.have.injury ? K.fmt(inj) + " with injury" : "")));
    CLASSES.forEach(function (k) { if (S.have.cls) h.push(kpi(A.classLabel(k), K.fmt(c[k] || 0), CLS_SUB[k], (k === "A" || k === "B") && c[k] ? "bad" : "")); });
    var oth = Object.keys(c).filter(function (k) { return CLASSES.indexOf(k) < 0; });
    if (oth.length) h.push(kpi("Other class values", K.fmt(K.sum(oth, function (k) { return c[k]; })), oth.slice(0, 3).join(", ")));
    if (S.have.c_total) h.push(kpi("Total accident cost", K.money(K.sum(rows, function (r) { return n(r.c_total); })), "injury + material"));
    if (S.have.c_injury) h.push(kpi("Injury cost", K.money(K.sum(rows, function (r) { return n(r.c_injury); })), K.fmt(inj) + " injury record" + (inj === 1 ? "" : "s")));
    if (S.have.ecod || S.have.prop) h.push(kpi("Material ECOD", K.money(K.sum(rows, function (r) { return n(r.ecod); })), K.fmt(ecodN) + " with material damage; blank = none"));
    if (S.have.days_lost) h.push(kpi("Days lost", K.fmt(K.sum(rows, function (r) { return n(r.days_lost); })), S.have.days_restr ? K.fmt(K.sum(rows, function (r) { return n(r.days_restr); })) + " days restricted" : ""));
    if (S.have.status) h.push(kpi("Open investigations", K.fmt(open.length), "Ongoing " + open.filter(function (r) { return r.status === "Investigation Ongoing"; }).length + " \u00b7 NGB review " + open.filter(function (r) { return r.status === "In Review NGB"; }).length));
    if (S.have.status) h.push(kpi("Overdue investigations", K.fmt(od.length), od.length ? "oldest " + Math.max.apply(null, od.map(function (r) { return r.overdue; })) + " days past due" : "none past 90 days", od.length ? "bad" : "good"));
    if (S.have.cls) h.push(kpi("Days since last Class A/B", since == null ? "\u2014" : K.fmt(since), ab ? "Class " + ab.cls + " on " + fd(ab.date) + (ab.ccir ? " (" + esc(ab.ccir) + ")" : "") : "none on record", since != null && since < 90 ? "bad" : "good", "Counts to " + fd(S.asOf) + "; ignores the date-range filter"));
    $("kpis").innerHTML = h.join("");
  }

  function top(m) { var k = sortKeys(m)[0]; return k ? [k, m[k]] : null; }
  function pct(a, b) { return b ? Math.round(a / b * 100) + "%" : "0%"; }
  function summary(rows, all, f, range) {
    if (!rows.length) { $("summary").textContent = "No accidents match the current filters."; return; }
    var c = cnt(rows, function (r) { return r.cls; }), s = [];
    s.push(K.fmt(rows.length) + " accident" + (rows.length === 1 ? "" : "s") + " reported " + (range ? "from " + fd(range[0]) + " to " + fd(range[1]) : "") + (S.have.cls ? " (" + clsList().filter(function (k) { return c[k]; }).map(function (k) { return (k === "Unclassified" ? "unclassified " : k.length === 1 ? "Class " + k + " " : k + " ") + c[k]; }).join(", ").replace(/, Class /g, ", ") + ")" : "") + ".");
    if (S.have.c_total) { var tc = K.sum(rows, function (r) { return n(r.c_total); }), ic = K.sum(rows, function (r) { return n(r.c_injury); }), ec = K.sum(rows, function (r) { return n(r.ecod); });
      s.push("Total cost " + K.money(tc) + (S.have.c_injury ? ": " + K.money(ic) + " injury and " + K.money(ec) + " material damage" : "") + "."); }
    var ts = S.have.subtype && top(cnt(rows, function (r) { return r.subtype; })), tcz = S.have.cause && top(cnt(rows, function (r) { return r.cause; }));
    if (ts) s.push("The most common accident subtype is " + ts[0] + " (" + ts[1] + ", " + pct(ts[1], rows.length) + ")" + (tcz ? " and the leading cause is " + tcz[0] + " (" + tcz[1] + ")" : "") + ".");
    if (S.have.on_duty) { var off = rows.filter(function (r) { return r.on_duty === false; }); if (off.length) s.push(off.length + " (" + pct(off.length, rows.length) + ") occurred off duty" + (S.have.subtype ? ", " + off.filter(function (r) { return r.subtype === "POV"; }).length + " of them POV" : "") + "."); }
    if (!f.bn && S.have.battalion) { var tb = top(cnt(rows, function (r) { return r.battalion; })); if (tb && tb[1] >= 3) s.push(tb[0] + " has the most accidents in the selection (" + tb[1] + ")."); }
    if (S.have.status) {
      var open = rows.filter(function (r) { return r.open; }), od = open.filter(function (r) { return r.isOverdue; }).sort(function (a, b) { return b.overdue - a.overdue; });
      s.push(open.length + " investigation" + (open.length === 1 ? " is" : "s are") + " open; " + (od.length ? od.length + " " + (od.length === 1 ? "is" : "are") + " past the 90-day suspense, the oldest " + (od[0].ccir ? "CCIR " + od[0].ccir + " " : "") + "at " + od[0].overdue + " days overdue." : "none are past the 90-day suspense."));
    }
    if (S.have.cls) { var ab = all.filter(function (r) { return r.cls === "A" || r.cls === "B"; }).sort(function (a, b) { return b.date - a.date; })[0];
      if (ab) s.push("Last Class A/B: " + fd(ab.date) + " (" + Math.round((d0(S.asOf) - d0(ab.date)) / 864e5) + " days ago)."); }
    if (S.have.hf_cat) { var th = top(cnt(rows, function (r) { return r.hf_cat; })); if (th) s.push("Top HFACS category: " + th[0] + " (" + th[1] + ")."); }
    // FYTD comparison
    var asOf = S.asOf, fy = asOf.getMonth() >= 9 ? asOf.getFullYear() + 1 : asOf.getFullYear(), doy = function (d) { var st = new Date(d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1, 9, 1, 12); return Math.round((d0(d) - st) / 864e5); }, cut = doy(asOf);
    var cur = all.filter(function (r) { return r.fy === fy && doy(r.date) <= cut; }).length, prev = all.filter(function (r) { return r.fy === fy - 1 && doy(r.date) <= cut; }).length;
    if (prev || cur) s.push("FY" + String(fy).slice(2) + " to date: " + cur + " vs " + prev + " at the same point in FY" + String(fy - 1).slice(2) + ".");
    $("summary").textContent = s.join(" ");
  }

  // ---------- tracker ----------
  function trackRows(rows) { return rows.filter(function (r) { return r.open; }).sort(function (a, b) { return b.overdue - a.overdue || a.due - b.due; }); }
  function tracker(rows) {
    var o = trackRows(rows), xa = S.have.assigned_to, xc = S.have.comments, ncol = 10 + (xa ? 1 : 0) + (xc ? 1 : 0);
    $("tTrack").tHead.innerHTML = '<tr><th>RAG</th><th>CCIR #</th><th class="hide-sm">ASMIS #</th><th>MSC</th><th class="hide-sm">Battalion</th><th>Class</th><th>Status</th><th>Accident date</th><th class="hide-sm">Due date</th><th>Days overdue</th>' + (xa ? "<th>Assigned to</th>" : "") + (xc ? '<th class="hide-sm">Comments</th>' : "") + "</tr>";
    var tb = $("tTrack").tBodies[0];
    tb.innerHTML = o.length ? o.map(function (r) {
      return '<tr data-i="' + S.recs.indexOf(r) + '"><td><span class="rag ' + rag(r) + '" title="' + ragLabel(r) + '"></span></td><td>' + esc(r.ccir || "") + '</td><td class="hide-sm">' + esc(r.asmis || "") + "</td><td>" + esc(r.msc || "") + '</td><td class="hide-sm">' + esc(r.battalion || "") + "</td><td>" + pill(r.cls) + "</td><td>" + esc(r.status || "") + "</td><td>" + fd(r.date) + '</td><td class="hide-sm">' + fd(r.due) + '</td><td class="' + (r.isOverdue ? "cf-bad" : r.daysToDue <= 30 ? "cf-warn" : "") + '">' + (r.isOverdue ? r.overdue : "\u2014") + "</td>" +
        (xa ? '<td class="comment">' + esc(r.assigned_to || "") + "</td>" : "") + (xc ? '<td class="comment hide-sm">' + esc(r.comments || "") + "</td>" : "") + "</tr>";
    }).join("") : '<tr><td colspan="' + ncol + '" class="muted">No open investigations in the current selection.</td></tr>';
    var sc = cnt(rows, function (r) { return r.status; }), labels = STATUSES.filter(function (s) { return sc[s]; }).concat(sortKeys(sc).filter(function (s) { return STATUSES.indexOf(s) < 0; }));
    K.upsert("cPipe", { type: "bar", data: { labels: labels, datasets: [{ label: "Accidents", data: labels.map(function (l) { return sc[l]; }), backgroundColor: labels.map(function (l) { return { "Investigation Ongoing": "#e3b34c", "In Review NGB": "#5aa6e6", "Final": "#5fbf7f" }[l] || "#8b9bb0"; }) }] },
      options: Object.assign(K.chartBase(), { indexAxis: "y", plugins: { legend: { display: false } } }) });
    var B = [["0-30", 0, 30], ["31-60", 31, 60], ["61-90", 61, 90], ["90+", 91, 1e9]];
    K.upsert("cAging", { type: "bar", data: { labels: B.map(function (b) { return b[0] + " days"; }), datasets: [
      { label: "Investigation Ongoing", data: B.map(function (b) { return o.filter(function (r) { return r.status === "Investigation Ongoing" && r.acc_age >= b[1] && r.acc_age <= b[2]; }).length; }), backgroundColor: "#e3b34c" },
      { label: "In Review NGB", data: B.map(function (b) { return o.filter(function (r) { return r.status !== "Investigation Ongoing" && r.acc_age >= b[1] && r.acc_age <= b[2]; }).length; }), backgroundColor: "#5aa6e6" }] },
      options: stacked() });
  }
  function stacked(horiz) { var o = K.chartBase(); o.scales.x.stacked = true; o.scales.y.stacked = true; if (horiz) o.indexAxis = "y"; o.scales[horiz ? "x" : "y"].ticks = { precision: 0 }; return o; }

  // ---------- trends ----------
  function monthly(rows, range) {
    if (!range) { K.upsert("cMonthly", { type: "bar", data: { labels: [], datasets: [] }, options: stacked() }); return; }
    var m0 = A.iso(range[0]).slice(0, 7), m1 = A.iso(range[1]).slice(0, 7), months = [];
    for (var m = m0; m <= m1 && months.length < 120; m = K.addMonths(m, 1)) months.push(m);
    var cls = S.have.cls ? clsList() : [null];
    K.upsert("cMonthly", { type: "bar", data: { labels: months.map(K.monthShort), datasets: cls.map(function (c) {
      return { label: c ? A.classLabel(c) : "Accidents", data: months.map(function (mm) { return rows.filter(function (r) { return r.month === mm && (!c || r.cls === c); }).length; }), backgroundColor: c ? clsColor(c) : "#5aa6e6" }; }) },
      options: stacked() });
  }
  function fyChart(all, f) {
    var fys = K.uniq(all.map(function (r) { return r.fy; })).sort().slice(-4), cols = ["#8b9bb0", "#a9c16a", "#5aa6e6", "#e3b34c"].slice(-fys.length);
    var cur = S.asOf.getMonth() >= 9 ? S.asOf.getFullYear() + 1 : S.asOf.getFullYear(), curIdx = (S.asOf.getMonth() + 3) % 12;
    K.upsert("cFy", { type: "line", data: { labels: FYM, datasets: fys.map(function (y, i) {
      var acc = 0, data = FYM.map(function (_, mi) { acc += all.filter(function (r) { return r.fy === y && r.fyMonth === mi; }).length; return y === cur && mi > curIdx ? null : acc; });
      return { label: "FY" + String(y).slice(2), data: data, borderColor: cols[i], backgroundColor: cols[i], borderWidth: y === cur ? 3 : 2, pointRadius: 2, tension: .2, spanGaps: false };
    }) }, options: (function () { var o = K.chartBase(); o.scales.y.beginAtZero = true; o.scales.y.ticks = { precision: 0 }; return o; })() });
    $("fyNote").textContent = "Cumulative count by fiscal month (Oct to Sep). Uses every filter except the date range.";
  }

  // ---------- breakdowns ----------
  function byClassBar(id, rows, key, order, horiz, limit) {
    var m = cnt(rows, function (r) { return r[key]; }), labels = order ? order.filter(function (k) { return m[k]; }).concat(sortKeys(m).filter(function (k) { return order.indexOf(k) < 0; })) : sortKeys(m);
    if (limit) labels = labels.slice(0, limit);
    var cls = S.have.cls ? clsList() : [null];
    K.upsert(id, { type: "bar", data: { labels: labels, datasets: cls.map(function (c) {
      return { label: c ? A.classLabel(c) : "Accidents", data: labels.map(function (l) { return rows.filter(function (r) { return r[key] === l && (!c || r.cls === c); }).length; }), backgroundColor: c ? clsColor(c) : "#5aa6e6" }; }) },
      options: stacked(horiz) });
    return labels;
  }
  function breakdowns(rows) {
    if (S.have.subtype) byClassBar("cSub", rows, "subtype", ["AMV", "ACV", "POV", "GSA", "Air", "Injury", "Other"], true);
    if (S.have.cause) byClassBar("cCause", rows, "cause", null, true);
    if (S.have.msc) byClassBar("cMsc", rows, "msc", null, true);
    if (S.have.battalion) {
      var str = S.strength ? S.strength.reduce(function (m, s) { m[s.battalion] = s.assigned; return m; }, {}) : null;
      byClassBar("cBn", rows, "battalion", null, true, 20);
      $("bnNote").textContent = str ? "Hover a bar for counts. Rates per 1,000 by battalion are in the tooltip footer." : "";
      if (str && K.charts.cBn) {
        var range = rangeOf(F(), rows), months = range ? Math.max(1, (range[1] - range[0]) / 864e5 / 30.44) : 12;
        K.charts.cBn.options.plugins.tooltip.callbacks = { footer: function (it) { var b = it[0].label, t = rows.filter(function (r) { return r.battalion === b; }).length; return str[b] ? "Rate: " + (t / str[b] * 1000 * 12 / months).toFixed(2) + " per 1,000 / yr" : ""; } };
        K.charts.cBn.update();
      }
    }
    if (S.have.duty_status) { var m = cnt(rows, function (r) { return r.duty_status; }), l = ["MDAY", "AGR", "ADOS", "AT"].filter(function (k) { return m[k]; }).concat(sortKeys(m).filter(function (k) { return ["MDAY", "AGR", "ADOS", "AT"].indexOf(k) < 0; }));
      K.upsert("cDuty", { type: "bar", data: { labels: l, datasets: [{ label: "Accidents", data: l.map(function (k) { return m[k]; }), backgroundColor: "#5aa6e6" }] }, options: (function () { var o = K.chartBase(); o.plugins.legend.display = false; o.scales.y.ticks = { precision: 0 }; return o; })() }); }
    if (S.have.on_duty) { var on = rows.filter(function (r) { return r.on_duty === true; }).length, off = rows.filter(function (r) { return r.on_duty === false; }).length;
      K.upsert("cOn", { type: "doughnut", data: { labels: ["On duty", "Off duty"], datasets: [{ data: [on, off], backgroundColor: ["#a9c16a", "#e88a4c"], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } } }); }
    if (S.have.dow) { K.upsert("cDow", { type: "bar", data: { labels: DOW.map(function (d) { return d.slice(0, 3); }), datasets: [{ label: "Accidents", data: DOW.map(function (_, i) { return rows.filter(function (r) { return r.dowIdx === i; }).length; }), backgroundColor: DOW.map(function (_, i) { return i >= 5 ? "#e3b34c" : "#5aa6e6"; }) }] }, options: (function () { var o = K.chartBase(); o.plugins.legend.display = false; o.scales.y.ticks = { precision: 0 }; return o; })() }); }
  }
  function heat(rows) {
    if (!S.have.dow || !S.have.tod) return;
    var g = DOW.map(function (_, di) { return TBANDS.map(function (b) { return rows.filter(function (r) { return r.dowIdx === di && r.tod != null && r.tod >= b[1] && r.tod < b[1] + 4; }).length; }); });
    var mx = Math.max(1, Math.max.apply(null, g.map(function (r) { return Math.max.apply(null, r); })));
    var unk = rows.filter(function (r) { return r.tod == null || r.dowIdx < 0; }).length;
    $("tHeat").innerHTML = "<thead><tr><th></th>" + TBANDS.map(function (b) { return "<th>" + b[0] + "</th>"; }).join("") + "</tr></thead><tbody>" + DOW.map(function (d, di) {
      return "<tr><th>" + d.slice(0, 3) + "</th>" + g[di].map(function (v) { return '<td style="background:' + (v ? K.heatColor(v / mx) : "rgba(60,95,143,.15)") + (v ? "" : ";color:#5c6f88") + '">' + v + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody>" + (unk ? '<caption class="muted small" style="caption-side:bottom;text-align:left">' + unk + " record(s) without a readable day or time are not shown.</caption>" : "");
  }
  function hfacs(rows) {
    if (!S.have.hf_cat) return;
    var lv = ["hf_cat", "hf_fail", "hf_sub"], d = S.hf.length, sub = rows.filter(function (r) { return S.hf.every(function (v, i) { return r[lv[i]] === v; }); });
    if (d > 0 && !S.have[lv[d]]) { S.hf = S.hf.slice(0, d - 1); return hfacs(rows); }
    var m = cnt(sub, function (r) { return r[lv[Math.min(d, 2)]] || "(blank)"; }), labels = sortKeys(m).slice(0, 15);
    K.upsert("cHf", { type: "bar", data: { labels: labels, datasets: [{ label: ["Category", "Failure", "Subfailure"][d], data: labels.map(function (l) { return m[l]; }), backgroundColor: ["#8a9a5b", "#5aa6e6", "#e3b34c"][d] }] },
      options: (function () { var o = K.chartBase(); o.indexAxis = "y"; o.plugins.legend.display = false; o.scales.x.ticks = { precision: 0 };
        o.onClick = function (e, els) { if (!els.length || S.hf.length >= 2 || !S.have[lv[S.hf.length + 1]]) return; var l = labels[els[0].index]; if (l === "(blank)") return; S.hf.push(l); hfacs(currentRows()); };
        o.onHover = function (e, els) { e.native.target.style.cursor = els.length && S.hf.length < 2 ? "pointer" : "default"; }; return o; })() });
    $("hfCrumbs").innerHTML = '<button type="button" data-d="0">All categories</button>' + S.hf.map(function (v, i) { return '<button type="button" data-d="' + (i + 1) + '">' + esc(v) + "</button>"; }).join("");
  }
  function currentRows() { var f = F(); return S.recs.filter(function (r) { return pass(r, f); }); }
  function cost(rows) {
    if (!S.have.c_total) return;
    var fys = K.uniq(rows.map(function (r) { return r.fy; })).sort();
    var comp = [["c_away", "Days away from work", "#5aa6e6"], ["c_hosp", "Days hospitalized", "#8a9a5b"], ["c_ppd", "Perm. partial disability", "#e3b34c"], ["c_ptd", "Perm. total disability", "#e88a4c"], ["c_fat", "Fatality", "#e0645c"], ["ecod", "Material ECOD", "#b59ad8"]].filter(function (c) { return S.have[c[0]]; });
    var ds = comp.map(function (c) { return { label: c[1], data: fys.map(function (y) { return K.sum(rows.filter(function (r) { return r.fy === y; }), function (r) { return n(r[c[0]]); }); }), backgroundColor: c[2] }; });
    var other = fys.map(function (y, i) { var t = K.sum(rows.filter(function (r) { return r.fy === y; }), function (r) { return n(r.c_total); }); return Math.max(0, t - K.sum(ds, function (d) { return d.data[i]; })); });
    if (other.some(function (v) { return v > 0.5; })) ds.push({ label: "Other / unallocated", data: other, backgroundColor: "#8b9bb0" });
    var o = stacked(true); o.scales.x.ticks = { callback: function (v) { return K.money(v); } }; o.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + K.money(c.raw); } };
    K.upsert("cCost", { type: "bar", data: { labels: fys.map(function (y) { return "FY" + String(y).slice(2); }), datasets: ds }, options: o });
  }

  // ---------- demographics (aggregated, suppressed) ----------
  function rankGroup(r) {
    var s = String(r || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return null;
    if (/^(PVT|PV1|PV2|PFC|SPC|CPL|E[1-4])$/.test(s)) return "E1-E4";
    if (/^(SGT|SSG|E[56])$/.test(s)) return "E5-E6";
    if (/^(SFC|MSG|1SG|SGM|CSM|E[789])$/.test(s)) return "E7-E9";
    if (/^(WO1|CW[2-5]|W[1-5])$/.test(s)) return "Warrant";
    if (/^(2LT|1LT|CPT|O[1-3])$/.test(s)) return "O1-O3";
    if (/^(MAJ|LTC|COL|BG|MG|O[4-9])$/.test(s)) return "O4+";
    if (/^(GS|WG|CIV|CIVILIAN)/.test(s)) return "Civilian";
    return "Other";
  }
  function band(v, cuts) { if (v == null) return null; for (var i = 0; i < cuts.length; i++) if (v <= cuts[i][1]) return cuts[i][0]; return cuts[cuts.length - 1][0]; }
  var AGEB = [["17-20", 20], ["21-24", 24], ["25-29", 29], ["30-39", 39], ["40+", 999]], YOSB = [["0-2", 2], ["3-5", 5], ["6-10", 10], ["11-20", 20], ["21+", 999]];
  function demographics(rows) {
    var supp = 0;
    function draw(id, key, fn, order) {
      if (!S.have[key]) return;
      var m = cnt(rows, function (r) { return fn(r[key]); }), labels = (order || sortKeys(m)).filter(function (k) { return m[k]; });
      var shown = labels.filter(function (k) { return m[k] >= SUPPRESS; }), hid = labels.length - shown.length; supp += hid;
      var o = K.chartBase(); o.plugins.legend.display = false; o.scales.y.ticks = { precision: 0 };
      K.upsert(id, { type: "bar", data: { labels: shown.concat(hid ? ["Suppressed"] : []), datasets: [{ label: "Accidents", data: shown.map(function (k) { return m[k]; }).concat(hid ? [0] : []), backgroundColor: "#8a9a5b" }] }, options: o });
    }
    draw("cGender", "gender", function (v) { var s = String(v || "").trim().toUpperCase(); return !s ? null : s[0] === "M" ? "Male" : s[0] === "F" ? "Female" : "Other"; }, ["Male", "Female", "Other"]);
    draw("cRank", "rank", rankGroup, ["E1-E4", "E5-E6", "E7-E9", "Warrant", "O1-O3", "O4+", "Civilian", "Other"]);
    draw("cAge", "age_years", function (v) { return band(v, AGEB); }, AGEB.map(function (b) { return b[0]; }));
    draw("cYos", "yos", function (v) { return band(v, YOSB); }, YOSB.map(function (b) { return b[0]; }));
    $("suppNote").textContent = supp ? supp + " group(s) with fewer than " + SUPPRESS + " records are suppressed in the current selection." : "No groups suppressed in the current selection.";
  }

  // ---------- tables / drawer ----------
  function allTable(rows) {
    var show = S.showAll ? rows : rows.slice(0, 25);
    $("tAll").tBodies[0].innerHTML = show.length ? show.map(function (r) {
      return '<tr data-i="' + S.recs.indexOf(r) + '"><td>' + fd(r.date) + "</td><td>" + esc(r.ccir || r.accident_no || "") + "</td><td>" + esc(r.msc || "") + '</td><td class="hide-sm">' + esc(r.battalion || "") + "</td><td>" + pill(r.cls) + '</td><td class="hide-sm">' + esc(r.subtype || "") + '</td><td class="hide-sm">' + esc(r.cause || "") + '</td><td class="hide-sm">' + esc(r.status || "") + "</td><td>" + (r.c_total != null ? K.money(r.c_total) : "\u2014") + "</td></tr>";
    }).join("") : '<tr><td colspan="9" class="muted">No accidents match the current filters.</td></tr>';
    $("btnAll").textContent = S.showAll ? "Show 25" : "Show all " + rows.length;
    $("btnAll").style.display = rows.length > 25 ? "" : "none";
  }
  function openDrawer(r) {
    $("dTitle").innerHTML = (r.ccir ? "CCIR " + esc(r.ccir) : "Accident " + esc(r.accident_no || "")) + " " + pill(r.cls);
    var dEl = $("drawer"); dEl.setAttribute("aria-label", "Accident detail");
    var h = [];
    h.push('<p><span class="rag ' + (r.open ? rag(r) : "green") + '"></span> ' + esc(r.status || "") + (r.open ? " \u00b7 " + ragLabel(r) + (r.isOverdue ? " (" + r.overdue + " days)" : "") : "") + "</p>");
    if (S.have.summary) h.push('<div class="narr">' + esc(r.summary || "No summary provided.") + "</div>");
    h.push("<dl>" + A.COLUMNS.filter(function (c) { return c[0] !== "summary" && DEMO_KEYS.indexOf(c[0]) < 0 && (c[0] in r) && r[c[0]] !== undefined && S.have.hasOwnProperty(c[0]); }).map(function (c) {
      var k = c[0], v = r["_t_" + k];
      if (k === "cls") v = (v ? v + " \u2192 " : "") + A.classLabel(r.cls);
      if (k === "due" && r._dueComputed) v = fd(r.due) + " (computed)";
      if (k === "overdue" && (v === "" || v == null)) v = r.open ? String(r.overdue) + " (computed)" : "";
      return "<dt>" + (k === "msc" ? "MSC" : esc(c[1])) + "</dt><dd>" + (v === "" || v == null ? '<span class="muted">blank</span>' : esc(v)) + "</dd>";
    }).join("") + "</dl>");
    if (DEMO_KEYS.some(function (k) { return S.have[k]; })) h.push('<p class="muted small" style="margin-top:12px">Gender, rank, age and years of service are shown only in aggregate (Demographics panel).</p>');
    $("dBody").innerHTML = h.join("");
    $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false"); $("scrim").hidden = false; $("dClose").focus();
  }
  function closeDrawer() { $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true"); $("scrim").hidden = true; }

  function exportCsv() {
    var o = trackRows(currentRows());
    var xa = S.have.assigned_to, xc = S.have.comments;
    K.downloadCsv("investigation_tracker_" + iso(new Date()) + ".csv", ["RAG", "CCIR #", "ASMIS #", "MSC", "Battalion", "Unit UIC", "Accident Class", "Status", "Accident Date", "Due Date", "Days Overdue", "Accident Age"].concat(xa ? ["Assigned To"] : [], xc ? ["Comments"] : []),
      o.map(function (r) { return [ragLabel(r), r.ccir || "", r.asmis || "", r.msc || "", r.battalion || "", r.uic || "", A.classLabel(r.cls), r.status || "", fd(r.date), fd(r.due), r.isOverdue ? r.overdue : 0, r.acc_age].concat(xa ? [r.assigned_to || ""] : [], xc ? [r.comments || ""] : []); }));
  }

  // ---------- wiring ----------
  function init() {
    K.initCharts();
    $("dictBody").innerHTML = A.COLUMNS.map(function (c, i) { return "<tr><td>" + (i + 1) + "</td><td><code>" + esc(c[1]) + "</code>" + (c[0] === "msc" ? " <span class=\"muted\">(shown as MSC; a column named MSC also works)</span>" : "") + "</td><td>" + esc(c[4]) + "</td></tr>"; }).join("");
    $("btnLoad").addEventListener("click", function () { $("fileInput").click(); });
    $("btnDetails").addEventListener("click", function () { setExpanded($("loadPanel").hidden); });
    $("btnPresent").addEventListener("click", function () { setPresent(!document.body.classList.contains("present")); });
    setExpanded(lsGet(), false);
    $("btnPrint").addEventListener("click", function () { window.print(); });
    $("btnDemo").addEventListener("click", function () { $("fileInput").value = ""; loadDemo(); });
    $("fileInput").addEventListener("change", function (e) {
      var file = e.target.files[0]; if (!file) return;
      $("loadReport").innerHTML = "<p>Reading " + esc(file.name) + "&hellip;</p>";
      A.readFile(file, function (err, res) {
        if (err) { $("loadReport").innerHTML = '<p class="err"><strong>Could not read ' + esc(file.name) + ".</strong> " + esc(err.message || err) + "</p>"; setBar("err", "Could not read " + file.name, 1); setExpanded(true, false); return; }
        var now = new Date(), okLoad = loadAoa(res.aoa, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), res.strength, "file", file.name, res.sheetName);
        if (okLoad) setExpanded(false);
      });
    });
    $("fFy").addEventListener("change", function () { var y = +this.value; if (y) { $("fFrom").value = (y - 1) + "-10-01"; $("fTo").value = y + "-09-30"; } else { $("fFrom").value = ""; $("fTo").value = ""; } S.hf = []; render(); });
    ["fFrom", "fTo"].forEach(function (id) { $(id).addEventListener("change", function () { $("fFy").value = ""; render(); }); });
    $("fMsc").addEventListener("change", function () { cascade(false); render(); });
    $("fBn").addEventListener("change", function () { cascade(false); render(); });
    ["fUic", "fClass", "fStatus", "fDuty", "fOn", "fSub", "fCause"].forEach(function (id) { $(id).addEventListener("change", function () { S.hf = []; render(); }); });
    $("btnReset").addEventListener("click", function () { S.hf = []; buildFilters(true); ["fFy", "fClass", "fStatus", "fDuty", "fOn", "fSub", "fCause"].forEach(function (id) { $(id).value = ""; }); render(); });
    $("btnCsv").addEventListener("click", exportCsv);
    $("btnAll").addEventListener("click", function () { S.showAll = !S.showAll; allTable(currentRows().sort(function (a, b) { return b.date - a.date; })); });
    ["tTrack", "tAll"].forEach(function (id) { $(id).addEventListener("click", function (e) { var tr = e.target.closest("tr[data-i]"); if (tr) openDrawer(S.recs[+tr.getAttribute("data-i")]); }); });
    $("hfCrumbs").addEventListener("click", function (e) { var b = e.target.closest("button[data-d]"); if (!b) return; S.hf = S.hf.slice(0, +b.getAttribute("data-d")); hfacs(currentRows()); });
    $("dClose").addEventListener("click", closeDrawer); $("scrim").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if ($("drawer").classList.contains("open")) closeDrawer();
      else if (document.body.classList.contains("present")) setPresent(false);
    });
    loadDemo();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
