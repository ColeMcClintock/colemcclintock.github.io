/* G1 Dashboard: PR Tracker. Four PR files named L1..L4 (level = the number in the file name). Only five columns are read:
   Cardholder Name, Purchase requisition, Merchant / Description, Short Text, Total Value. Nothing is uploaded. */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, C = w.G1, $ = K.$, esc = K.esc, full = L.full, plural = L.plural, cmpVal = L.cmpVal;
  var COLS = [ // key, shown as, source header, aliases (normalized)
    ["card", "Cardholder", "Cardholder Name", ["cardholdername", "cardholder", "cardholdersname", "nameofcardholder"]],
    ["pr", "PR Number", "Purchase requisition", ["purchaserequisition", "purchaserequisitionnumber", "purchaserequisitionno", "purchasereq", "prnumber", "prno", "requisitionnumber"]],
    ["merch", "Merchant", "Merchant / Description", ["merchantdescription", "merchant", "merchantname"]],
    ["desc", "Description", "Short Text", ["shorttext", "shorttextdescription"]],
    ["val", "Total Value", "Total Value", ["totalvalue", "totalamount", "totalprice"]]
  ];
  var ALIAS = {}; COLS.forEach(function (c) { c[3].forEach(function (a) { ALIAS[a] = c[0]; }); });
  var PAGE = 100, TOPN = 10;
  var S = { files: [], keys: [], key: null, typed: false, items: [], levels: [], cross: [],  sort: { k: "level", dir: -1 }, showAll: false, shown: [], order: 0, ks: null };
  // Cardholder Key: Cardholder (email style or First Last), optional Display Name, any Type column is ignored
  var TYPES = [], TYPE_COLORS = {};
  var KEYCOLS = { card: ["cardholder", "cardholdername", "cardholders"], disp: ["displayname", "display", "showas", "nametoshow"] };
  var KALIAS = {}; Object.keys(KEYCOLS).forEach(function (k) { KEYCOLS[k].forEach(function (a) { KALIAS[a] = k; }); });
  function typeOf(v) { return ""; }
  function typeColor(t) { return TYPE_COLORS[t] || "#94a3b8"; }

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
  function matchKey(v) { return cardName(v).toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim(); }
  function prText(v) { var s = L.idText(v).replace(/\s+/g, ""); return s.replace(/\.0+$/, ""); }

  function classify(src, fname) {
    var best = null;
    for (var r = 0; r < Math.min(src.rows, 25); r++) {
      var got = {};
      for (var c = 0; c < src.cols; c++) { var h = src.get(r, c); if (h == null || h === "") continue; var k = ALIAS[L.norm(h)]; if (k) got[k] = 1; }
      var cnt = Object.keys(got).length;
      if (got.pr && cnt >= 2 && (!best || cnt + 3 > best.score)) best = { kind: "pr", score: cnt + 3 };
      var kg = {}, other = 0;
      for (var c2 = 0; c2 < src.cols; c2++) { var h2 = src.get(r, c2); if (h2 == null || h2 === "") continue; var k2 = KALIAS[L.norm(h2)]; if (k2) kg[k2] = 1; else other++; }
      if (!got.pr && kg.card && (kg.disp || kg.type || other <= 1) && (!best || best.kind === "key" && 3 + (kg.disp ? 1 : 0) + (kg.type ? 1 : 0) > best.score))
        best = { kind: "key", score: 3 + (kg.disp ? 1 : 0) + (kg.type ? 1 : 0) };
    }
    return best;
  }
  function parseKey(src, name) {
    var hi = -1, map = {};
    for (var r = 0; r < Math.min(src.rows, 25) && hi < 0; r++) {
      var m = {}; for (var c = 0; c < src.cols; c++) { var k = KALIAS[L.norm(src.get(r, c) || "")]; if (k && m[k] == null) m[k] = c; }
      if (m.card != null) { hi = r; map = m; }
    }
    var e = { name: name, kind: "key", kindLabel: "Cardholder Key", rows: [], order: S.order++, fatal: null, rep: { headerRow: hi + 1, dupNames: 0, unread: 0, hasType: map.type != null, hasDisp: map.disp != null } };
    if (hi < 0) { e.fatal = "No Cardholder column was found."; return e; }
    var seen = {};
    for (var rr = hi + 1; rr < src.rows; rr++) {
      var raw = L.txt(src.get(rr, map.card)); if (!raw) continue;
      var k2 = matchKey(raw); if (!k2) { e.rep.unread++; continue; }
      if (seen[k2]) { e.rep.dupNames++; continue; }
      seen[k2] = 1;
      e.rows.push({ raw: raw, key: k2, disp: map.disp != null ? L.txt(src.get(rr, map.disp)).replace(/\s+/g, " ") : "", type: map.type != null ? typeOf(src.get(rr, map.type)) : "", typeRaw: map.type != null ? L.txt(src.get(rr, map.type)) : "" });
    }
    e.count = e.rows.length;
    if (!e.rows.length) e.fatal = "The Cardholder Key has no names in it.";
    return e;
  }
  function parse(kind, src, fname, ws, name) {
    if (kind === "key") return parseKey(src, name);
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
    var keys = entries.filter(function (e) { return e.kind === "key"; }); entries = entries.filter(function (e) { return e.kind !== "key"; });
    if (keys.length) S.keys = (keys.some(function (e) { return !e.fatal; }) ? [] : S.keys.filter(function (e) { return !e.fatal; })).concat(keys);   // a new key replaces the old one
    var lv = entries.filter(function (e) { return !e.fatal; }).map(function (e) { return e.level; });
    S.files = S.files.filter(function (e) { return e.fatal ? false : lv.indexOf(e.level) < 0; }).concat(entries);
    combine();
  }
  function mode(list) { var c = {}, best = "", bn = 0; list.forEach(function (x) { if (!x) return; c[x] = (c[x] || 0) + 1; if (c[x] > bn) { bn = c[x]; best = x; } }); return best; }
  function combine() {
    var seen = {};
    S.files.forEach(function (e) { e.dupOf = null; if (e.fatal) return; var s = C.sig(e.level + "\n" + e.rows.map(function (r) { return [r.pr, r.card, r.merch, r.desc, r.val].join("|"); }).join("\n")); if (seen[s]) e.dupOf = seen[s]; else seen[s] = e.name; });
    var good = S.keys.filter(function (e) { return !e.fatal; });
    S.key = good.length ? good[good.length - 1] : null;
    S.typed = false; // G1 never splits cardholders by Type; an uploaded Type column is ignored.
    var km = {}, ks = null;
    if (S.key) {
      S.key.rows.forEach(function (k) { km[k.key] = k; });
      ks = { names: S.key.rows.length, notInKey: 0, untyped: 0, untypedNames: 0, matched: {}, byType: {} };
      S.key.rows.forEach(function (k) { if (S.typed && !k.type) ks.untypedNames++; if (k.type) ks.byType[k.type] = (ks.byType[k.type] || 0) + 1; });
    }
    var groups = {}, list = [];
    if (ks) S.files.forEach(function (e) { if (!e.fatal && !e.dupOf && e.prevExcl) { ks.notInKey += e.prevExcl.notInKey || 0; ks.untyped += e.prevExcl.untyped || 0; } });
    S.files.filter(usable).forEach(function (e) {
      e.rows.forEach(function (r) {
        if (ks) {   // only cardholders in the key; the rest are left out entirely
          var k = km[matchKey(r.card)];
          if (!k) { ks.notInKey++; return; }
          if (S.typed && !k.type) { ks.untyped++; return; }
          ks.matched[k.key] = 1;
          r = { pr: r.pr, card: k.disp || r.card, merch: r.merch, desc: r.desc, val: r.val, type: k.type };
        }
        var k = e.level + "|" + r.pr, g = groups[k];
        if (!g) { g = groups[k] = { level: e.level, pr: r.pr, rows: [], file: e.name }; list.push(g); }
        g.rows.push(r);
      });
    });
    var multi = 0;
    // Each line of a PR is its own item: the PR value is ALWAYS the sum of its lines' Total Value.
    // Description = Short Text of the line with the highest Total Value (first such line on a tie; if it has no Short Text, the next highest line that has one).
    var items = list.map(function (g) {
      var vals = g.rows.map(function (r) { return r.val; }).filter(function (v) { return v != null; });
      if (g.rows.length > 1) multi++;
      var descs = K.uniq(g.rows.map(function (r) { return r.desc; }).filter(Boolean));
      var top = g.rows.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { return x.r.desc; })
        .sort(function (a, b) { var av = a.r.val == null ? -Infinity : a.r.val, bv = b.r.val == null ? -Infinity : b.r.val; return bv - av || a.i - b.i; })[0];
      return { level: g.level, pr: g.pr, type: S.typed ? g.rows[0].type : "", card: mode(g.rows.map(function (r) { return r.card; })), merch: mode(g.rows.map(function (r) { return r.merch; })),
        desc: top ? top.r.desc : "", descs: descs.join(" | "),
        val: Math.round(vals.reduce(function (a, b) { return a + b; }, 0) * 100) / 100, lines: g.rows.length, file: g.file, alsoIn: [] };
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
    S.cross = cross; S.multi = multi; S.ks = ks;
    S.levels = K.uniq(S.files.filter(usable).map(function (e) { return e.level; }).concat(S.items.map(function (i) { return i.level; }))).sort(function (a, b) { return a - b; });
    S.showAll = false;
    S.files.forEach(function (e) { e.warns = e.fatal || e.dupOf ? 1 : e.rep.noPr || e.rep.badNumber || e.rep.missing.length ? 1 : 0; e.status = e.fatal ? e.fatal : "Level " + e.level + " \u00b7 " + plural(e.rows.length, "line"); });
    buildFilters();
  }
  function clear() { S.files = []; S.keys = []; combine(); }
  function demo() {
    var D = w.G1_DEMO; if (!D) return;
    S.files = D.pr.map(function (f) { return parse("pr", L.aoaSource(f.grid), f.name, null, f.name); });
    S.keys = D.prKey ? [parseKey(L.aoaSource(D.prKey.grid), D.prKey.name)] : [];
    combine();
  }
  // saved copy: the five columns, cardholder already shown as First Last
  // With a key loaded, only the rows of key cardholders are written into the saved copy (the left-out counts are kept for the details panel).
  function keep(r, km) { if (!km) return true; var k = km[matchKey(r.card)]; return !!k && (!S.typed || !!k.type); }
  function snapshot() {
    var km = null; if (S.key) { km = {}; S.key.rows.forEach(function (k) { km[k.key] = k; }); }
    return {
      files: S.files.filter(function (e) { return usable(e) || (!e.fatal && !e.dupOf && e.prevExcl); }).map(function (e) {
        var ex = { notInKey: (e.prevExcl && e.prevExcl.notInKey) || 0, untyped: (e.prevExcl && e.prevExcl.untyped) || 0 };
        if (km) e.rows.forEach(function (r) { var k = km[matchKey(r.card)]; if (!k) ex.notInKey++; else if (S.typed && !k.type) ex.untyped++; });
        return { name: e.name, level: e.level, excl: ex, rows: e.rows.filter(function (r) { return keep(r, km); }).map(function (r) { return [r.card, r.pr, r.merch, r.desc, r.val == null ? "" : r.val]; }) };
      }),
      key: S.key ? { name: S.key.name, rows: S.key.rows.map(function (k) { return [k.raw, k.disp]; }) } : null
    };
  }
  function restore(o) {
    S.files = (o.files || []).map(function (f) {
      var e = parse("pr", L.aoaSource([COLS.map(function (c) { return c[2]; })].concat(f.rows)), "L" + f.level + ".xlsx", null, f.name);
      if (f.excl) e.prevExcl = f.excl;
      return e;
    });
    S.keys = o.key ? [parseKey(L.aoaSource([["Cardholder", "Display Name"]].concat(o.key.rows)), o.key.name)] : [];
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
    S.keys.forEach(function (e) {
      var x = [];
      if (e.fatal) x.push('<p class="err">' + esc(e.fatal) + "</p>");
      else {
        x.push('<p class="ok">Cardholder Key: ' + plural(e.rows.length, "row") + " read (header row " + e.rep.headerRow + ").</p>");
        if (e.rep.dupNames) x.push('<p class="muted">' + plural(e.rep.dupNames, "repeated name") + " ignored.</p>");
        if (e.rep.unread) x.push('<p class="warn">' + plural(e.rep.unread, "Cardholder cell") + " could not be read as a name.</p>");
      }
      if (e.fatal) warns++;
      h.push('<details class="filerep"' + (e.fatal ? " open" : "") + "><summary>" + esc(e.name) + "</summary>" + x.join("") + "</details>");
    });
    var ks = S.ks;
    if (ks) {
      h.push('<div class="combined"><p class="ok"><strong>Cardholder Key:</strong> ' + plural(ks.names, "row") + (S.typed ? " (" + TYPES.map(function (t) { return (ks.byType[t] || 0) + " " + t; }).join(", ") + ")" : "") + "; " + K.fmt(Object.keys(ks.matched).length) + " of them " + (Object.keys(ks.matched).length === 1 ? "has" : "have") + " PRs in the files.</p>");
      h.push('<p class="' + (ks.notInKey ? "warn" : "muted") + '">' + plural(ks.notInKey, "PR row") + " left out because the cardholder is not in the key.</p>");
      h.push("</div>");
    }
    h.push('<div class="combined"><p class="ok"><strong>' + plural(S.items.length, "PR") + "</strong> across " + plural(S.levels.length, "level") + ".</p>");
    if (S.multi) h.push('<p class="muted">' + plural(S.multi, "PR") + " had several lines in one level file and are shown as one PR: Total Value is the sum of its lines and the Description is the Short Text of its highest-value line.</p>");
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
  function F() { return { type: S.typed ? $("prType").value : "", level: $("prLevel").value, card: $("prCard").value, merch: $("prMerch").value, q: ($("prSearch").value || "").trim().toLowerCase() }; }
  function pass(it, f, skipLevel) {
    if (f.level && !skipLevel && String(it.level) !== f.level) return false;
    if (f.type && it.type !== f.type) return false;
    if (f.card && (it.card || L.BLANK) !== f.card) return false;
    if (f.merch && (it.merch || L.BLANK) !== f.merch) return false;
    if (f.q && [it.pr, it.card, it.merch, it.descs, it.type, "level " + it.level, "l" + it.level].join(" ").toLowerCase().indexOf(f.q) < 0) return false;
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
    var scope = [f.type, f.level ? "Level " + f.level : "", f.card, f.merch, f.q ? "\u201c" + f.q + "\u201d" : ""].filter(Boolean);
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
    $("prChartNote").textContent = "Largest 10; bars are split by " + (S.typed ? "type" : "level") + ". Click a bar to filter by it.";
    barChart("cPrCard", rows, "card", "prCard"); barChart("cPrMerch", rows, "merch", "prMerch");
    S.base = rows; table();
  }
  function barChart(id, rows, key, sel) {
    var m = {}, list = [];
    var by = S.typed ? "type" : "level", series = S.typed ? TYPES : S.levels;
    rows.forEach(function (it) { var k = it[key] || L.BLANK, g = m[k]; if (!g) { g = m[k] = { label: k, total: 0, lv: {} }; list.push(g); } g.total += it.val; g.lv[it[by]] = (g.lv[it[by]] || 0) + it.val; });
    list.sort(function (a, b) { return b.total - a.total || cmpVal(a.label, b.label); });
    if (list.length > TOPN + 1) { var rest = list.slice(TOPN), o = { label: "Other (" + rest.length + ")", total: 0, lv: {}, other: true }; rest.forEach(function (g) { o.total += g.total; Object.keys(g.lv).forEach(function (l) { o.lv[l] = (o.lv[l] || 0) + g.lv[l]; }); }); list = list.slice(0, TOPN).concat([o]); }
    var o2 = K.chartBase(); o2.indexAxis = "y"; o2.scales.x.stacked = o2.scales.y.stacked = true;
    o2.scales.x.ticks = { callback: function (v) { return K.money(v); } };
    o2.plugins.tooltip.callbacks = { label: function (c) { return c.dataset.label + ": " + full(c.raw); } };
    o2.onClick = function (e, els) { if (!els.length) return; var g = list[els[0].index]; if (!g || g.other) return; $(sel).value = g.label; S.showAll = false; render(); };
    o2.onHover = function (e, els) { e.native.target.style.cursor = els.length && list[els[0].index] && !list[els[0].index].other ? "pointer" : "default"; };
    K.upsert(id, { type: "bar", data: { labels: list.map(function (g) { return g.label; }), datasets: series.map(function (l) { return { label: S.typed ? l : "Level " + l, data: list.map(function (g) { return g.lv[l] || 0; }), backgroundColor: S.typed ? typeColor(l) : C.levelColor(l) }; }) }, options: o2 });
  }
  var TCOLS0 = [["level", "Level", 0], ["type", "Type", 0], ["pr", "PR Number", 0], ["card", "Cardholder", 0], ["merch", "Merchant", 0], ["desc", "Description", 0], ["lines", "Lines", 1], ["val", "Total Value", 1]];
  function table() {
    var TCOLS = TCOLS0.filter(function (c) { return S.typed || c[0] !== "type"; });
    var k = S.sort.k, dir = S.sort.dir, num = k === "val" || k === "lines" || k === "level";
    var rows = (S.base || []).slice().sort(function (a, b) { var x = num ? a[k] - b[k] : cmpVal(a[k] || "", b[k] || ""); return x * dir || b.val - a.val || cmpVal(a.pr, b.pr); });
    S.shown = rows;
    var f = F(); $("prNote").textContent = f.q ? K.fmt(rows.length) + " PRs match \u201c" + $("prSearch").value.trim() + "\u201d" : "";
    $("tPr").tHead.innerHTML = "<tr>" + TCOLS.map(function (c) { var on = k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[2] ? "num" : "") + (on ? " sorted" + (dir > 0 ? " asc" : "") : "") + '">' + c[1] + "</th>"; }).join("") + "</tr>";
    var show = rows.slice(0, S.showAll ? 5000 : PAGE), dash = '<span class="muted">\u2014</span>';
    $("tPr").tBodies[0].innerHTML = show.length ? show.map(function (it) {
      return '<tr><td><span class="lvl" style="--lc:' + C.levelColor(it.level) + '">L' + it.level + "</span></td>" + (S.typed ? '<td><span class="tpill" style="--tc:' + typeColor(it.type) + '">' + esc(it.type) + "</span></td>" : "") + "<td>" + esc(it.pr) + "</td><td>" + (it.card ? esc(it.card) : dash) + "</td><td>" + (it.merch ? esc(it.merch) : dash) +
        '</td><td class="wrapc" title="' + esc(it.descs) + '">' + (it.desc ? esc(it.desc) : dash) + '</td><td class="num">' + it.lines + '</td><td class="num">' + full(it.val) + "</td></tr>";
    }).join("") : '<tr><td colspan="' + TCOLS.length + '" class="muted">' + (S.items.length ? "No PRs match the current filters." : "No PR files loaded.") + "</td></tr>";
    $("tPr").tFoot.innerHTML = rows.length ? '<tr><td colspan="' + (TCOLS.length - 2) + '">Total (' + plural(rows.length, "PR") + (rows.length > show.length ? ", " + K.fmt(show.length) + " shown" : "") + ')</td><td class="num">' + K.fmt(K.sum(rows, function (i) { return i.lines; })) + '</td><td class="num">' + full(K.sum(rows, function (i) { return i.val; })) + "</td></tr>" : "";
    var b = $("prAll"); b.style.display = rows.length > PAGE ? "" : "none"; b.textContent = S.showAll ? "Show " + PAGE : "Show all " + K.fmt(rows.length);
  }
  function exportCsv() {
    var d = new Date();
    K.downloadCsv("pr_tracker_" + d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) + ".csv", ["Level", "PR Number", "Cardholder", "Merchant", "Description", "Lines", "Total Value"],
      S.shown.map(function (it) { return [it.level, it.pr, it.card, it.merch, it.desc, it.lines, it.val.toFixed(2)]; }));
  }
  function summary() {
    if (!S.items.length) return null;
    return { count: S.items.length, value: K.sum(S.items, function (i) { return i.val; }), levels: byLevel(S.items),
      types: S.typed ? TYPES.map(function (t) { var its = S.items.filter(function (i) { return i.type === t; }); return { type: t, color: typeColor(t), count: its.length, value: K.sum(its, function (i) { return i.val; }), levels: byLevel(its).filter(function (g) { return g.count > 0; }) }; }) : null };
  }

  C.register("pr", {
    classify: classify, parse: parse, ingest: ingest, clear: clear, demo: demo, snapshot: snapshot, restore: restore, report: report, render: render,
    entries: function () { return S.files.concat(S.keys); }, hasData: function () { return S.items.length > 0; }, summary: summary,
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
    _state: S, _cardName: cardName, _matchKey: matchKey, _levelOf: levelOf
  });
})(window);
