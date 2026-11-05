/* Command Dashboard: PR Tracker. Four PR files named L1..L4 (level = the number in the file name). Only five columns are read:
   Cardholder Name, Purchase requisition, Merchant / Description, Short Text, Total Value. Nothing is uploaded. */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, C = w.CMD, $ = K.$, esc = K.esc, full = L.full, plural = L.plural, cmpVal = L.cmpVal;
  var COLS = [ // key, shown as, source header, aliases (normalized)
    ["card", "Cardholder", "Cardholder Name", ["cardholdername", "cardholder", "cardholdersname", "nameofcardholder"]],
    ["pr", "PR Number", "Purchase requisition", ["purchaserequisition", "purchaserequisitionnumber", "purchaserequisitionno", "purchasereq", "prnumber", "prno", "requisitionnumber"]],
    ["merch", "Merchant", "Merchant / Description", ["merchantdescription", "merchant", "merchantname"]],
    ["desc", "Description", "Short Text", ["shorttext", "shorttextdescription"]],
    ["val", "Total Value", "Total Value", ["totalvalue", "totalamount", "totalprice"]]
  ];
  var ALIAS = {}; COLS.forEach(function (c) { c[3].forEach(function (a) { ALIAS[a] = c[0]; }); });
  var PAGE = 100, TOPN = 10;
  var S = { files: [], items: [], levels: [], cross: [], repeat: 0, sort: { k: "level", dir: -1 }, showAll: false, shown: [], order: 0 };

  function levelOf(fname) {
    var base = String(fname || "").replace(/\.[a-z0-9]+$/i, "");
    var m = base.match(/(?:^|[^a-z0-9])(?:l|lvl|level)\s*[-_ ]?\s*(\d{1,2})(?![0-9])/i);
    return m && +m[1] > 0 ? +m[1] : null;
  }
  // first.middle.last(.mil)(@domain) -> "First Last"; also handles "Last, First M" and "First Last"
  function title(x) { return x.toLowerCase().replace(/(^|[-' ])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }).replace(/^Mc([a-z])/, function (m, a) { return "Mc" + a.toUpperCase(); }); }
  function cardName(v) {
    var s = L.txt(v); if (!s) return "";
    s = s.replace(/^mailto:/i, "").replace(/@.*$/, "").trim(); if (!s) return "";
    var parts;
    if (/,/.test(s)) { var p = s.split(","); parts = (p.slice(1).join(" ") + " " + p[0]).trim().split(/[\s.]+/); }
    else if (/\./.test(s) && !/\s/.test(s)) parts = s.split(".");
    else parts = s.split(/[\s_]+/);
    parts = parts.map(function (x) { return x.replace(/\d+$/, "").trim(); }).filter(Boolean);
    while (parts.length > 2 && /^(mil|civ|ctr|nfg|usa|usarmy|contractor)$/i.test(parts[parts.length - 1])) parts.pop();
    if (!parts.length) return "";
    return (parts.length === 1 ? [parts[0]] : [parts[0], parts[parts.length - 1]]).map(title).join(" ");
  }
  function prText(v) { var s = L.idText(v).replace(/\s+/g, ""); return s.replace(/\.0+$/, ""); }

  function classify(src, fname) {
    var best = null;
    for (var r = 0; r < Math.min(src.rows, 25); r++) {
      var got = {};
      for (var c = 0; c < src.cols; c++) { var h = src.get(r, c); if (h == null || h === "") continue; var k = ALIAS[L.norm(h)]; if (k) got[k] = 1; }
      var cnt = Object.keys(got).length;
      if (got.pr && cnt >= 2 && (!best || cnt + 3 > best.score)) best = { kind: "pr", score: cnt + 3 };
    }
    return best;
  }
  function parse(kind, src, fname, ws, name) {
    var hm = L.mapHeaders(src, ALIAS), map = hm.map, lvl = levelOf(fname);
    var rep = { headerRow: hm.hi + 1, level: lvl, missing: COLS.filter(function (c) { return map[c[0]] == null; }).map(function (c) { return c[2]; }),
      extra: hm.extra, pii: hm.pii, rowsRead: 0, rowsLoaded: 0, blankRows: 0, totalRows: 0, noPr: 0, badNumber: 0, badNumberExamples: [] };
    var e = { name: name, kind: "pr", kindLabel: lvl ? "PR file \u00b7 Level " + lvl : "PR file", level: lvl, rep: rep, rows: [], order: S.order++, fatal: null };
    if (map.pr == null) { e.fatal = "No Purchase requisition column was found."; return e; }
    if (!lvl) { e.fatal = "Could not tell the level from the file name. Name PR files L1, L2, L3, L4 (for example L3.xlsx)."; return e; }
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var raw = {}, empty = true;
      Object.keys(map).forEach(function (k) { var v = src.get(rr, map[k]); raw[k] = v; if (!L.blankish(v)) empty = false; });
      if (empty) { rep.blankRows++; continue; }
      rep.rowsRead++;
      var pr = prText(raw.pr);
      if (!pr) { if (L.blankish(raw.card) && L.blankish(raw.merch)) rep.totalRows++; else rep.noPr++; continue; }   // total rows / lines without a PR number
      var x = map.val != null ? L.parseAmt(raw.val) : null;
      if (x !== null && isNaN(x)) { L.badNum(rep, rr + 1, "Total Value", raw.val); x = null; }
      e.rows.push({ pr: pr, card: cardName(raw.card), merch: L.txt(raw.merch).replace(/\s+/g, " "), desc: L.txt(raw.desc).replace(/\s+/g, " "), val: x });
    }
    rep.rowsLoaded = e.rows.length; e.count = e.rows.length;
    return e;
  }
  function usable(e) { return !e.fatal && !e.dupOf && e.rows.length > 0; }
  // A new upload replaces the earlier file(s) of the same level.
  function ingest(entries) {
    var lv = entries.filter(function (e) { return !e.fatal; }).map(function (e) { return e.level; });
    S.files = S.files.filter(function (e) { return e.fatal ? false : lv.indexOf(e.level) < 0; }).concat(entries);
    combine();
  }
  function mode(list) { var c = {}, best = "", bn = 0; list.forEach(function (x) { if (!x) return; c[x] = (c[x] || 0) + 1; if (c[x] > bn) { bn = c[x]; best = x; } }); return best; }
  function combine() {
    var seen = {};
    S.files.forEach(function (e) { e.dupOf = null; if (e.fatal) return; var s = C.sig(e.level + "\n" + e.rows.map(function (r) { return [r.pr, r.card, r.merch, r.desc, r.val].join("|"); }).join("\n")); if (seen[s]) e.dupOf = seen[s]; else seen[s] = e.name; });
    var groups = {}, list = [];
    S.files.filter(usable).forEach(function (e) {
      e.rows.forEach(function (r) {
        var k = e.level + "|" + r.pr, g = groups[k];
        if (!g) { g = groups[k] = { level: e.level, pr: r.pr, rows: [], file: e.name }; list.push(g); }
        g.rows.push(r);
      });
    });
    var repeat = 0, multi = 0;
    var items = list.map(function (g) {
      var vals = g.rows.map(function (r) { return r.val; }).filter(function (v) { return v != null; });
      var rep = g.rows.length > 1 && vals.length === g.rows.length && vals[0] !== 0 && vals.every(function (v) { return Math.abs(v - vals[0]) < 0.005; });
      if (rep) repeat++; if (g.rows.length > 1) multi++;
      var descs = K.uniq(g.rows.map(function (r) { return r.desc; }).filter(Boolean));
      return { level: g.level, pr: g.pr, card: mode(g.rows.map(function (r) { return r.card; })), merch: mode(g.rows.map(function (r) { return r.merch; })),
        desc: descs[0] ? descs[0] + (descs.length > 1 ? " (+" + (descs.length - 1) + " more)" : "") : "", descs: descs.join(" | "),
        val: rep ? vals[0] : vals.reduce(function (a, b) { return a + b; }, 0), lines: g.rows.length, repeated: rep, file: g.file, alsoIn: [] };
    });
    // a PR listed in several level files is shown once, at its highest level
    var byPr = {}, cross = [];
    items.forEach(function (it) {
      var x = byPr[it.pr]; if (!x) { byPr[it.pr] = it; return; }
      var hi = it.level > x.level ? it : x, lo = hi === it ? x : it;
      hi.alsoIn = K.uniq(hi.alsoIn.concat([lo.level], lo.alsoIn)); byPr[it.pr] = hi;
    });
    S.items = Object.keys(byPr).map(function (k) { return byPr[k]; });
    S.items.forEach(function (it) { if (it.alsoIn.length) cross.push(it); });
    S.cross = cross; S.repeat = repeat; S.multi = multi;
    S.levels = K.uniq(S.files.filter(usable).map(function (e) { return e.level; }).concat(S.items.map(function (i) { return i.level; }))).sort(function (a, b) { return a - b; });
    S.showAll = false;
    S.files.forEach(function (e) { e.warns = e.fatal || e.dupOf ? 1 : e.rep.noPr || e.rep.badNumber || e.rep.missing.length ? 1 : 0; e.status = e.fatal ? e.fatal : "Level " + e.level + " \u00b7 " + plural(e.rows.length, "line"); });
    buildFilters();
  }
  function clear() { S.files = []; combine(); }
  function demo() {
    var D = w.COMMAND_DEMO; if (!D) return;
    S.files = D.pr.map(function (f) { return parse("pr", L.aoaSource(f.grid), f.name, null, f.name); });
    combine();
  }
  // saved copy: the five columns, cardholder already shown as First Last
  function snapshot() { return { files: S.files.filter(usable).map(function (e) { return { name: e.name, level: e.level, rows: e.rows.map(function (r) { return [r.card, r.pr, r.merch, r.desc, r.val == null ? "" : r.val]; }) }; }) }; }
  function restore(o) {
    S.files = (o.files || []).map(function (f) {
      var e = parse("pr", L.aoaSource([COLS.map(function (c) { return c[2]; })].concat(f.rows)), "L" + f.level + ".xlsx", null, f.name);
      return e;
    });
    combine();
  }

  // ---------- report ----------
  function report() {
    if (!S.files.length) return { html: "", warns: 0 };
    var h = [], warns = 0;
    S.files.forEach(function (e) {
      var r = e.rep, x = [];
      if (e.fatal) x.push('<p class="err">' + esc(e.fatal) + "</p>");
      else if (e.dupOf) x.push('<p class="warn">Same content as ' + esc(e.dupOf) + "; skipped so nothing is counted twice.</p>");
      else {
        x.push('<p class="ok">Level ' + e.level + ": " + plural(r.rowsLoaded, "line") + " read (header row " + r.headerRow + ").</p>");
        if (r.missing.length) x.push('<p class="warn">Columns not found: ' + r.missing.map(function (m) { return "<code>" + esc(m) + "</code>"; }).join(", ") + ".</p>");
        if (r.noPr) x.push('<p class="warn">' + plural(r.noPr, "line") + " without a Purchase requisition number skipped.</p>");
        if (r.totalRows) x.push('<p class="muted">' + plural(r.totalRows, "total or summary row") + " ignored.</p>");
        if (r.badNumber) x.push('<p class="warn">' + plural(r.badNumber, "Total Value cell") + " could not be read (counted as $0).</p>");
        if (r.pii) x.push('<p class="muted">' + plural(r.pii, "personal identifier column") + " skipped without reading.</p>");
        if (r.extra.length) x.push('<p class="muted">' + plural(r.extra.length, "other column") + " ignored.</p>");
      }
      warns += e.warns || 0;
      h.push('<details class="filerep"' + (e.warns ? " open" : "") + "><summary>" + esc(e.name) + "</summary>" + x.join("") + "</details>");
    });
    h.push('<div class="combined"><p class="ok"><strong>' + plural(S.items.length, "PR") + "</strong> across " + plural(S.levels.length, "level") + ".</p>");
    if (S.multi) h.push('<p class="muted">' + plural(S.multi, "PR") + " had several lines in one level file and are shown as one PR. " + (S.repeat ? plural(S.repeat, "of them") + " repeated the same Total Value on every line, so that amount was counted once; the rest were added up." : "Their line values were added up.") + "</p>");
    if (S.cross.length) {
      warns++;
      h.push('<p class="warn">' + plural(S.cross.length, "PR") + " appear in more than one level file and are shown only at the highest level: " +
        S.cross.slice(0, 25).map(function (it) { return "<code>" + esc(it.pr) + "</code> L" + it.level + " (also L" + it.alsoIn.join(", L") + ")"; }).join("; ") + (S.cross.length > 25 ? " &hellip;" : "") + "</p>");
    }
    h.push("</div>");
    return { html: h.join(""), warns: warns };
  }

  // ---------- filters + render ----------
  function buildFilters() {
    K.fillSelect($("prLevel"), S.levels.map(String), "All levels", true, S.levels.map(function (l) { return "Level " + l; }));
    var cards = K.uniq(S.items.map(function (i) { return i.card || L.BLANK; })).sort(cmpVal), mer = K.uniq(S.items.map(function (i) { return i.merch || L.BLANK; })).sort(cmpVal);
    K.fillSelect($("prCard"), cards, "All cardholders", true); K.fillSelect($("prMerch"), mer, "All merchants", true);
  }
  function F() { return { level: $("prLevel").value, card: $("prCard").value, merch: $("prMerch").value, q: ($("prSearch").value || "").trim().toLowerCase() }; }
  function pass(it, f, skipLevel) {
    if (f.level && !skipLevel && String(it.level) !== f.level) return false;
    if (f.card && (it.card || L.BLANK) !== f.card) return false;
    if (f.merch && (it.merch || L.BLANK) !== f.merch) return false;
    if (f.q && [it.pr, it.card, it.merch, it.descs, "level " + it.level, "l" + it.level].join(" ").toLowerCase().indexOf(f.q) < 0) return false;
    return true;
  }
  function byLevel(items) {
    var m = {}; S.levels.forEach(function (l) { m[l] = { level: l, count: 0, value: 0 }; });
    items.forEach(function (it) { var g = m[it.level] || (m[it.level] = { level: it.level, count: 0, value: 0 }); g.count++; g.value += it.val; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.level - b.level; });
  }
  function render() {
    var f = F(), rows = S.items.filter(function (it) { return pass(it, f); }), rowsAll = S.items.filter(function (it) { return pass(it, f, true); });
    var tv = K.sum(rows, function (i) { return i.val; }), lv = byLevel(rowsAll), tot = K.sum(rowsAll, function (i) { return i.val; }) || 1;
    var scope = [f.level ? "Level " + f.level : "", f.card, f.merch, f.q ? "\u201c" + f.q + "\u201d" : ""].filter(Boolean);
    $("prScope").textContent = plural(rows.length, "PR") + " \u00b7 " + full(tv) + (scope.length ? " \u00b7 " + scope.join(" \u00b7 ") : "");
    var h = ['<div class="kpi"><div class="lbl">All PRs</div><div class="val">' + K.fmt(rowsAll.length) + '</div><div class="sub">' + full(K.sum(rowsAll, function (i) { return i.val; })) + "</div></div>"];
    lv.forEach(function (g) {
      h.push('<div class="kpi click' + (f.level === String(g.level) ? " sel" : "") + '" data-level="' + g.level + '" style="--st:' + C.levelColor(g.level) + '"><div class="lbl">Level ' + g.level + '</div><div class="val">' + K.fmt(g.count) + '</div><div class="sub">' + full(g.value) + " \u00b7 " + Math.round(g.value / tot * 100) + "% of value</div></div>");
    });
    $("prKpis").innerHTML = h.join(""); $("prKpis").style.gridTemplateColumns = "repeat(" + Math.min(6, lv.length + 1) + ",1fr)";
    var maxv = Math.max.apply(null, lv.map(function (g) { return g.value; }).concat([1]));
    $("prPipe").innerHTML = lv.length ? lv.map(function (g) {
      return '<div class="stage' + (f.level === String(g.level) ? " sel" : "") + '" data-level="' + g.level + '" style="--lc:' + C.levelColor(g.level) + '"><div class="sl">Level ' + g.level + '</div><div class="sn">' + K.fmt(g.count) + '</div><div class="sv">' + full(g.value) + '</div><div class="sb"><i style="width:' + (g.value / maxv * 100).toFixed(1) + '%"></i></div></div>';
    }).join("") : '<p class="muted">No PRs loaded.</p>';
    barChart("cPrCard", rows, "card", "prCard"); barChart("cPrMerch", rows, "merch", "prMerch");
    S.base = rows; table();
  }
  function barChart(id, rows, key, sel) {
    var m = {}, list = [];
    rows.forEach(function (it) { var k = it[key] || L.BLANK, g = m[k]; if (!g) { g = m[k] = { label: k, total: 0, lv: {} }; list.push(g); } g.total += it.val; g.lv[it.level] = (g.lv[it.level] || 0) + it.val; });
    list.sort(function (a, b) { return b.total - a.total || cmpVal(a.label, b.label); });
    if (list.length > TOPN + 1) { var rest = list.slice(TOPN), o = { label: "Other (" + rest.length + ")", total: 0, lv: {}, other: true }; rest.forEach(function (g) { o.total += g.total; Object.keys(g.lv).forEach(function (l) { o.lv[l] = (o.lv[l] || 0) + g.lv[l]; }); }); list = list.slice(0, TOPN).concat([o]); }
    var o2 = K.chartBase(); o2.indexAxis = "y"; o2.scales.x.stacked = o2.scales.y.stacked = true;
    o2.scales.x.ticks = { callback: function (v) { return K.money(v); } };
    o2.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + full(c.raw); } };
    o2.onClick = function (e, els) { if (!els.length) return; var g = list[els[0].index]; if (!g || g.other) return; $(sel).value = g.label; S.showAll = false; render(); };
    o2.onHover = function (e, els) { e.native.target.style.cursor = els.length && list[els[0].index] && !list[els[0].index].other ? "pointer" : "default"; };
    K.upsert(id, { type: "bar", data: { labels: list.map(function (g) { return g.label; }), datasets: S.levels.map(function (l) { return { label: "Level " + l, data: list.map(function (g) { return g.lv[l] || 0; }), backgroundColor: C.levelColor(l) }; }) }, options: o2 });
  }
  var TCOLS = [["level", "Level", 0], ["pr", "PR Number", 0], ["card", "Cardholder", 0], ["merch", "Merchant", 0], ["desc", "Description", 0], ["lines", "Lines", 1], ["val", "Total Value", 1]];
  function table() {
    var k = S.sort.k, dir = S.sort.dir, num = k === "val" || k === "lines" || k === "level";
    var rows = (S.base || []).slice().sort(function (a, b) { var x = num ? a[k] - b[k] : cmpVal(a[k] || "", b[k] || ""); return x * dir || b.val - a.val || cmpVal(a.pr, b.pr); });
    S.shown = rows;
    var f = F(); $("prNote").textContent = f.q ? K.fmt(rows.length) + " PRs match \u201c" + $("prSearch").value.trim() + "\u201d" : "";
    $("tPr").tHead.innerHTML = "<tr>" + TCOLS.map(function (c) { var on = k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[2] ? "num" : "") + (on ? " sorted" + (dir > 0 ? " asc" : "") : "") + '">' + c[1] + "</th>"; }).join("") + "</tr>";
    var show = rows.slice(0, S.showAll ? 5000 : PAGE), dash = '<span class="muted">\u2014</span>';
    $("tPr").tBodies[0].innerHTML = show.length ? show.map(function (it) {
      return '<tr><td><span class="lvl" style="--lc:' + C.levelColor(it.level) + '">L' + it.level + "</span></td><td>" + esc(it.pr) + "</td><td>" + (it.card ? esc(it.card) : dash) + "</td><td>" + (it.merch ? esc(it.merch) : dash) +
        '</td><td class="wrapc" title="' + esc(it.descs) + '">' + (it.desc ? esc(it.desc) : dash) + '</td><td class="num">' + it.lines + '</td><td class="num">' + full(it.val) + "</td></tr>";
    }).join("") : '<tr><td colspan="7" class="muted">' + (S.items.length ? "No PRs match the current filters." : "No PR files loaded.") + "</td></tr>";
    $("tPr").tFoot.innerHTML = rows.length ? '<tr><td colspan="5">Total (' + plural(rows.length, "PR") + (rows.length > show.length ? ", " + K.fmt(show.length) + " shown" : "") + ')</td><td class="num">' + K.fmt(K.sum(rows, function (i) { return i.lines; })) + '</td><td class="num">' + full(K.sum(rows, function (i) { return i.val; })) + "</td></tr>" : "";
    var b = $("prAll"); b.style.display = rows.length > PAGE ? "" : "none"; b.textContent = S.showAll ? "Show " + PAGE : "Show all " + K.fmt(rows.length);
  }
  function exportCsv() {
    var d = new Date();
    K.downloadCsv("pr_tracker_" + d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) + ".csv", ["Level", "PR Number", "Cardholder", "Merchant", "Description", "Lines", "Total Value"],
      S.shown.map(function (it) { return [it.level, it.pr, it.card, it.merch, it.descs, it.lines, it.val.toFixed(2)]; }));
  }
  function summary() {
    if (!S.items.length) return null;
    return { count: S.items.length, value: K.sum(S.items, function (i) { return i.val; }), levels: byLevel(S.items) };
  }

  C.register("pr", {
    classify: classify, parse: parse, ingest: ingest, clear: clear, demo: demo, snapshot: snapshot, restore: restore, report: report, render: render,
    entries: function () { return S.files; }, hasData: function () { return S.items.length > 0; }, summary: summary,
    init: function () {
      ["prLevel", "prCard", "prMerch"].forEach(function (id) { $(id).addEventListener("change", function () { S.showAll = false; render(); }); });
      var st; $("prSearch").addEventListener("input", function () { clearTimeout(st); st = setTimeout(render, 150); });
      $("prReset").addEventListener("click", function () { ["prLevel", "prCard", "prMerch", "prSearch"].forEach(function (id) { $(id).value = ""; }); S.showAll = false; render(); });
      function lvlClick(e) { var x = e.target.closest("[data-level]"); if (!x) return; var v = x.getAttribute("data-level"); $("prLevel").value = $("prLevel").value === v ? "" : v; S.showAll = false; render(); }
      $("prKpis").addEventListener("click", lvlClick); $("prPipe").addEventListener("click", lvlClick);
      $("prCsv").addEventListener("click", exportCsv);
      $("prAll").addEventListener("click", function () { S.showAll = !S.showAll; table(); });
      $("tPr").tHead.addEventListener("click", function (e) { var th = e.target.closest("th[data-k]"); if (!th) return; var k = th.getAttribute("data-k"); S.sort = S.sort.k === k ? { k: k, dir: -S.sort.dir } : { k: k, dir: k === "val" || k === "lines" || k === "level" ? -1 : 1 }; table(); });
    },
    _state: S, _cardName: cardName, _levelOf: levelOf
  });
})(window);
