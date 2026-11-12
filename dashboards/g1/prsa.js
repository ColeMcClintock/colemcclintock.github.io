/* PRSA Planner (Status of Funds page). PRSA is one fund spread across several SOF accounts.
   Accounts: G1.PROGRAM_ACCOUNT_MATCH.prsa (programs.js), ticked/unticked by the user.
   Persistence: the plan lives in document state (embedded by Save with data as g1Saved.prsa)
   and autosaves to this browser's localStorage under STORE_KEY so frequent edits survive reloads.
   Only the planning rows/settings are stored; SOF and report data are never written to storage.
   Nothing leaves the machine. */
(function (w) {
  "use strict";
  var C = w.G1, K = w.DashKit, L = w.FundsLib, $ = K.$, esc = K.esc, full = L.full;
  var STORE_KEY = "g1-prsa-plan";
  var FM = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  var FULLM = ["october", "november", "december", "january", "february", "march", "april", "may", "june", "july", "august", "september"];
  var STATUSES = ["Idea", "Planned", "Committed", "Done"];
  var SCOLOR = { Idea: "#64748b", Planned: "#2563eb", Committed: "#b45309", Done: "#15803d" };
  var DEFAULT_CATS = ["Travel", "Supplies", "Contracts", "Training", "Other"];
  var HEAD = ["Order", "Description / Planning factor", "Account", "Category", "Amount", "Target month", "Status", "Include", "Notes"];
  var seq = 0, saveTimer = null, storeOk = true, lastSaved = null;
  function blank() { return { v: 1, updatedAt: null, demo: false, excluded: [], adjust: 0, categories: DEFAULT_CATS.slice(), rows: [] }; }
  var P = blank();
  function r2(x) { return Math.round(x * 100) / 100; }
  function id() { return "r" + Date.now().toString(36) + (seq++).toString(36); }
  function num(v) { var n = L.parseAmt(v); return n == null || !isFinite(n) ? 0 : r2(n); }
  function normStatus(s) { s = L.txt(s).toLowerCase(); for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].toLowerCase() === s) return STATUSES[i]; return "Idea"; }
  function normMonth(v) {
    if (v == null || v === "") return "";
    if (typeof v === "number") return v >= 1 && v <= 12 && v % 1 === 0 ? v : "";
    var s = L.txt(v).toLowerCase().replace(/\.$/, ""); if (!s || s === "unscheduled") return "";
    if (/^\d{1,2}$/.test(s)) { var n = +s; return n >= 1 && n <= 12 ? n : ""; }
    for (var i = 0; i < 12; i++) if (FULLM[i] === s || FULLM[i].slice(0, 3) === s.slice(0, 3) && FULLM[i].indexOf(s) === 0) return i + 1;
    if (s === "sept") return 12; return "";
  }
  function yes(v) { if (typeof v === "boolean") return v; var s = L.txt(v).toLowerCase(); return s === "" ? true : /^(y|yes|true|1|x|included?)$/.test(s); }
  function clean(o) {
    var p = blank(); o = o || {};
    p.updatedAt = o.updatedAt || null; p.demo = !!o.demo; p.adjust = num(o.adjust);
    p.excluded = Array.isArray(o.excluded) ? o.excluded.map(L.txt).filter(Boolean) : [];
    p.categories = Array.isArray(o.categories) && o.categories.length ? o.categories.map(L.txt).filter(Boolean) : DEFAULT_CATS.slice();
    p.rows = (Array.isArray(o.rows) ? o.rows : []).map(function (r) {
      return { id: L.txt(r.id) || id(), desc: L.txt(r.desc), account: L.txt(r.account) || "Pooled", category: L.txt(r.category), amount: num(r.amount),
        month: normMonth(r.month), status: normStatus(r.status), include: r.include !== false, notes: L.txt(r.notes) };
    });
    return p;
  }
  // ---------- persistence ----------
  function readLocal() { try { var t = w.localStorage.getItem(STORE_KEY); return t ? clean(JSON.parse(t)) : null; } catch (e) { storeOk = false; return null; } }
  function writeLocal() {
    saveTimer = null;
    if (P.demo) { indicator(); return; }
    try { w.localStorage.setItem(STORE_KEY, JSON.stringify(P)); storeOk = true; lastSaved = new Date(); } catch (e) { storeOk = false; }
    indicator();
  }
  function changed(full) { P.updatedAt = new Date().toISOString(); clearTimeout(saveTimer); saveTimer = setTimeout(writeLocal, 250); $("prsaSaved").textContent = P.demo ? "Demo plan \u00b7 not saved" : "Saving\u2026"; $("prsaSaved").className = "prsa-saved off"; if (full) render(); else totals(); }
  function indicator() {
    var el = $("prsaSaved"); if (!el) return;
    if (P.demo) { el.textContent = "Demo plan \u00b7 not saved"; el.className = "prsa-saved off"; return; }
    if (!storeOk) { el.textContent = "Browser storage unavailable \u00b7 use Export plan"; el.className = "prsa-saved off"; return; }
    var t = lastSaved || (P.updatedAt ? new Date(P.updatedAt) : null);
    el.textContent = t ? "\u2713 Saved " + ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2) : ""; el.className = "prsa-saved";
  }
  // ---------- model ----------
  function fy() { var v = $("fFy") && $("fFy").value; return v || C.programs.defaultFy(C.programs.getYears()); }
  function accounts() {
    var list = C.programs.accountData("prsa", fy()).list.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list.map(function (a) { var on = P.excluded.indexOf(a.name) < 0; return { name: a.name, tdp: a.tdp, afp: a.afp, te: a.te, obl: a.obl, disb: a.disb, funded: a.funded, bal: a.funded ? r2(a.tdp - a.te) : null, on: on }; });
  }
  function calc() {
    var acc = accounts(), on = acc.filter(function (a) { return a.on; });
    var avail = r2(on.reduce(function (s, a) { return s + (a.bal || 0); }, 0)), adj = P.adjust || 0, start = r2(avail + adj);
    var inc = P.rows.filter(function (r) { return r.include; }), planned = r2(inc.reduce(function (s, r) { return s + r.amount; }, 0));
    var st = {}; STATUSES.forEach(function (s) { st[s] = { inc: 0, all: 0, n: 0 }; });
    P.rows.forEach(function (r) { var o = st[r.status]; o.all = r2(o.all + r.amount); o.n++; if (r.include) o.inc = r2(o.inc + r.amount); });
    var unsched = r2(inc.filter(function (r) { return !r.month; }).reduce(function (s, r) { return s + r.amount; }, 0)), run = start - unsched, months = FM.map(function (m, i) {
      run = r2(run - inc.filter(function (r) { return r.month === i + 1; }).reduce(function (s, r) { return s + r.amount; }, 0)); return run; });
    var byAcct = {}; inc.forEach(function (r) { byAcct[r.account] = r2((byAcct[r.account] || 0) + r.amount); });
    return { accounts: acc, available: avail, adjust: adj, start: start, planned: planned, remaining: r2(start - planned), status: st, unscheduled: unsched, months: months, byAcct: byAcct, fy: fy() };
  }
  // ---------- rendering ----------
  function kpi(l, v, sub, color, neg) { return '<div class="kpi' + (neg ? " neg" : "") + '" style="--st:' + color + '"><div class="lbl">' + l + '</div><div class="val">' + v + '</div><div class="sub">' + sub + "</div></div>"; }
  function totals() {
    var m = calc(), neg = m.remaining < 0;
    $("prsaKpis").innerHTML = kpi("Pooled available", full(m.available), m.accounts.filter(function (a) { return a.on; }).length + " of " + m.accounts.length + " PRSA accounts", "#2563eb") +
      kpi("Adjust available", full(m.adjust), "Scenario offset", "#64748b") + kpi("Included projections", full(m.planned), P.rows.filter(function (r) { return r.include; }).length + " of " + P.rows.length + " rows", "#b45309") +
      kpi("Projected remaining", full(m.remaining), neg ? "Over-committed" : "Available + adjust \u2212 projections", neg ? "#b91c1c" : "#15803d", neg);
    $("prsaSummary").innerHTML = "Available <b>" + esc(full(m.start)) + "</b> \u00b7 Projected remaining <b class=\"" + (neg ? "neg" : "") + "\" id=\"prsaRemain\">" + esc(full(m.remaining)) + "</b>";
    $("prsaFy").textContent = "FY" + m.fy + " \u00b7 name contains \u201cPRSA\u201d";
    var t = $("tPrsaAcct");
    t.tHead.innerHTML = '<tr><th>Include</th><th>Account</th><th class="num">TDP</th><th class="num">AFP</th><th class="num">Total Expenditure</th><th class="num">Obligation</th><th class="num">Disbursement</th><th class="num">Balance</th><th class="num">Planned here</th><th class="num">After plan</th></tr>';
    t.tBodies[0].innerHTML = m.accounts.map(function (a) {
      var pl = m.byAcct[a.name] || 0, after = a.bal == null ? null : r2(a.bal - pl);
      return '<tr><td><input type="checkbox" data-acct="' + esc(a.name) + '"' + (a.on ? " checked" : "") + ' aria-label="Include ' + esc(a.name) + '"></td><td>' + esc(a.name) + '</td><td class="num">' + (a.funded ? full(a.tdp) : "\u2014") + '</td><td class="num">' + (a.funded ? full(a.afp) : "\u2014") + '</td><td class="num">' + full(a.te) + '</td><td class="num">' + full(a.obl) + '</td><td class="num">' + full(a.disb) + '</td><td class="num' + (a.bal < 0 ? " neg" : "") + '">' + (a.bal == null ? '<span class="hint">no funding</span>' : full(a.bal)) + '</td><td class="num">' + (pl ? full(pl) : "\u2014") + '</td><td class="num' + (after < 0 ? " neg" : "") + '">' + (after == null ? "\u2014" : full(after)) + "</td></tr>";
    }).join("") || '<tr><td colspan="10" class="muted">No PRSA accounts in the loaded Status of Funds data for FY' + esc(m.fy) + '. Pooled planning still works with Adjust available.</td></tr>';
    var pooled = m.byAcct.Pooled || 0;
    t.tFoot.innerHTML = m.accounts.length ? '<tr><td></td><td>Pooled (ticked accounts)' + (pooled ? ' \u00b7 pooled rows ' + esc(full(pooled)) : "") + '</td><td class="num">' + full(sum(m.accounts, "tdp")) + '</td><td class="num">' + full(sum(m.accounts, "afp")) + '</td><td class="num">' + full(sum(m.accounts, "te")) + '</td><td class="num">' + full(sum(m.accounts, "obl")) + '</td><td class="num">' + full(sum(m.accounts, "disb")) + '</td><td class="num">' + full(m.available) + '</td><td class="num">' + full(m.planned) + '</td><td class="num' + (m.available - m.planned < 0 ? " neg" : "") + '">' + full(r2(m.available - m.planned)) + "</td></tr>" : "";
    $("prsaStatus").innerHTML = STATUSES.map(function (s) { var o = m.status[s]; return '<div class="statuscount" style="--sc:' + SCOLOR[s] + '" data-status="' + s + '"><strong>' + esc(full(o.inc)) + "</strong><span>" + s + " \u00b7 " + o.n + " row" + (o.n === 1 ? "" : "s") + (o.all !== o.inc ? " \u00b7 " + esc(full(o.all)) + " incl. what-ifs" : "") + "</span></div>"; }).join("");
    var foot = $("tPrsaPlan").tFoot; foot.innerHTML = P.rows.length ? '<tr><td></td><td>Included total</td><td></td><td></td><td class="num">' + full(m.planned) + '</td><td colspan="5"></td></tr>' : "";
    charts(m);
  }
  function sum(rows, k) { return r2(rows.filter(function (a) { return a.on; }).reduce(function (s, a) { return s + (a[k] || 0); }, 0)); }
  function charts(m) {
    var labels = ["Available"], data = [], colors = [], lvl = m.available;
    data.push([0, m.available]); colors.push("#2563eb");
    if (m.adjust) { labels.push("Adjust"); data.push([lvl, lvl + m.adjust]); colors.push(m.adjust > 0 ? "#16a34a" : "#dc2626"); lvl += m.adjust; }
    STATUSES.forEach(function (s) { var v = m.status[s].inc; if (!v) return; labels.push(s); data.push([lvl - v, lvl]); colors.push(SCOLOR[s]); lvl -= v; });
    labels.push("Projected remaining"); data.push([0, m.remaining]); colors.push(m.remaining < 0 ? "#dc2626" : "#15803d");
    var o = K.chartBase(); o.plugins.legend.display = false; o.plugins.tooltip = { callbacks: { label: function (c) { var v = c.raw; return full(r2(v[1] - v[0])); } } }; o.scales.y.ticks = { callback: function (v) { return K.money(v); } };
    K.upsert("cPrsaFall", { type: "bar", data: { labels: labels, datasets: [{ label: "PRSA", data: data, backgroundColor: colors }] }, options: o });
    var o2 = K.chartBase(); o2.plugins.legend.display = false; o2.plugins.tooltip = { callbacks: { label: function (c) { return "Remaining: " + full(c.raw); } } }; o2.scales.y.ticks = { callback: function (v) { return K.money(v); } };
    K.upsert("cPrsaMonth", { type: "bar", data: { labels: FM, datasets: [{ label: "Projected remaining", data: m.months, backgroundColor: m.months.map(function (v) { return v < 0 ? "#dc2626" : "#0d9488"; }) }] }, options: o2 });
  }
  function opts(list, value, extra) { if (value && list.indexOf(value) < 0) list = list.concat([value]); return (extra || "") + list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === value ? " selected" : "") + ">" + esc(v) + "</option>"; }).join(""); }
  function table() {
    var acc = ["Pooled"].concat(accounts().map(function (a) { return a.name; })), y = fy();
    var t = $("tPrsaPlan");
    t.tHead.innerHTML = "<tr><th></th><th>Description / Planning factor</th><th>Account</th><th>Category</th><th class=\"num\">Amount</th><th>Target month</th><th>Status</th><th>Include</th><th>Notes</th><th></th></tr>";
    t.tBodies[0].innerHTML = P.rows.map(function (r, i) {
      var mo = '<option value="">Unscheduled</option>' + FM.map(function (m, j) { var cy = j < 3 ? +y - 1 : +y; return '<option value="' + (j + 1) + '"' + (r.month === j + 1 ? " selected" : "") + ">" + m + " " + String(cy).slice(2) + "</option>"; }).join("");
      return '<tr data-id="' + esc(r.id) + '"' + (r.include ? "" : ' class="off"') + '><td class="rowbtns"><button type="button" data-act="up" title="Move up" aria-label="Move up"' + (i ? "" : " disabled") + '>\u2191</button><button type="button" data-act="down" title="Move down" aria-label="Move down"' + (i < P.rows.length - 1 ? "" : " disabled") + '>\u2193</button></td>' +
        '<td class="desc"><input type="text" data-f="desc" value="' + esc(r.desc) + '" placeholder="Planning factor" aria-label="Description"></td>' +
        '<td><select data-f="account" aria-label="Account">' + opts(acc, r.account) + "</select></td>" +
        '<td><select data-f="category" aria-label="Category">' + opts(P.categories.slice(), r.category, '<option value="">\u2014</option>') + "</select></td>" +
        '<td><input type="number" step="0.01" data-f="amount" value="' + (r.amount || r.amount === 0 ? r.amount : "") + '" aria-label="Amount"></td>' +
        '<td><select data-f="month" aria-label="Target month">' + mo + "</select></td>" +
        '<td><select data-f="status" aria-label="Status">' + opts(STATUSES.slice(), r.status) + "</select></td>" +
        '<td><input type="checkbox" data-f="include"' + (r.include ? " checked" : "") + ' aria-label="Include in projection"></td>' +
        '<td class="notes"><input type="text" data-f="notes" value="' + esc(r.notes) + '" aria-label="Notes"></td>' +
        '<td class="rowbtns"><button type="button" class="del" data-act="del" title="Delete row" aria-label="Delete row">\u2715</button></td></tr>';
    }).join("") || '<tr><td colspan="10" class="muted">No planning rows yet. Use “+ Add row”.</td></tr>';
  }
  function render() {
    if (!$("prsaPanel")) return;
    table();
    var adj = $("prsaAdjust"); if (document.activeElement !== adj) adj.value = P.adjust ? P.adjust : "";
    var cats = $("prsaCats"); if (document.activeElement !== cats) cats.value = P.categories.join(", ");
    totals(); indicator();
  }
  // ---------- import / export ----------
  function exportPlan() {
    var m = calc(), rows = [HEAD].concat(P.rows.map(function (r, i) { return [i + 1, r.desc, r.account, r.category, r.amount, r.month ? FM[r.month - 1] : "", r.status, r.include ? "Yes" : "No", r.notes]; }));
    var settings = [["Setting", "Value"], ["Adjust available", P.adjust || 0], ["Categories", P.categories.join(", ")], ["Excluded accounts", P.excluded.join("; ")], ["Fiscal year", "FY" + m.fy], ["Updated", P.updatedAt || ""]];
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "PRSA Plan"); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(settings), "Settings");
    var d = new Date(), name = "G1-PRSA-Plan-" + ("0" + d.getDate()).slice(-2) + K.MON[d.getMonth()] + String(d.getFullYear()).slice(2) + ".xlsx";
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function parsePlan(wb) {
    var out = null, hmap = { order: "order", descriptionplanningfactor: "desc", description: "desc", planningfactor: "desc", account: "account", category: "category", amount: "amount", targetmonth: "month", month: "month", status: "status", include: "include", included: "include", notes: "notes" };
    wb.SheetNames.forEach(function (sn) {
      if (out) return; var aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "" });
      for (var r = 0; r < Math.min(15, aoa.length); r++) {
        var map = {}; (aoa[r] || []).forEach(function (h, c) { var k = hmap[L.norm(h)]; if (k && map[k] == null) map[k] = c; });
        if (map.desc != null && map.amount != null) {
          out = { rows: [] };
          for (var i = r + 1; i < aoa.length; i++) {
            var row = aoa[i] || [], g = function (k) { return map[k] == null ? "" : row[map[k]]; };
            if (!L.txt(g("desc")) && L.blankish(g("amount"))) continue;
            out.rows.push({ desc: g("desc"), account: g("account"), category: g("category"), amount: g("amount"), month: normMonth(g("month")), status: g("status"), include: yes(g("include")), notes: g("notes") });
          }
          return;
        }
      }
    });
    if (!out) return null;
    var st = wb.Sheets.Settings;
    if (st) XLSX.utils.sheet_to_json(st, { header: 1, raw: true, defval: "" }).forEach(function (r) {
      var k = L.norm(r[0]); if (k === "adjustavailable") out.adjust = r[1]; else if (k === "categories") out.categories = L.txt(r[1]).split(",").map(L.txt).filter(Boolean); else if (k === "excludedaccounts") out.excluded = L.txt(r[1]).split(";").map(L.txt).filter(Boolean);
    });
    return out;
  }
  function importPlan(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var o = null; try { o = parsePlan(XLSX.read(new Uint8Array(e.target.result), { type: "array" })); } catch (err) { o = null; }
      if (!o) { C.toast("Not a PRSA plan: needs Description and Amount columns.", true); return; }
      if (P.rows.length && !confirm("Replace the current PRSA plan (" + P.rows.length + " rows) with " + o.rows.length + " rows from " + file.name + "?")) return;
      var keep = P; P = clean(o); if (o.categories == null) P.categories = keep.categories; P.rows.forEach(function (r) { if (r.category && P.categories.indexOf(r.category) < 0) P.categories.push(r.category); });
      P.demo = false; changed(true); C.toast("Imported " + P.rows.length + " PRSA plan rows.");
    };
    reader.readAsArrayBuffer(file);
  }
  // ---------- demo ----------
  function demoPlan() {
    var p = blank(); p.demo = true; p.updatedAt = new Date().toISOString(); p.adjust = 15000;
    p.rows = [
      { desc: "Annual conference travel (example)", account: "PRSA Travel", category: "Travel", amount: 18500, month: 3, status: "Planned", include: true, notes: "Fictional demo row" },
      { desc: "Office supplies restock (example)", account: "PRSA Supplies", category: "Supplies", amount: 6200, month: 5, status: "Committed", include: true, notes: "" },
      { desc: "Facilitator contract (example)", account: "Pooled", category: "Contracts", amount: 42000, month: 7, status: "Idea", include: true, notes: "What-if: toggle Include" },
      { desc: "Workshop training seats (example)", account: "PRSA Operations", category: "Training", amount: 9800, month: 9, status: "Planned", include: true, notes: "" },
      { desc: "Year-end equipment buy (example)", account: "Pooled", category: "Other", amount: 25000, month: "", status: "Idea", include: false, notes: "Excluded scenario" }
    ].map(function (r) { r.id = id(); return r; });
    return p;
  }
  // ---------- wiring ----------
  function init() {
    var local = readLocal(); if (local) { P = local; lastSaved = local.updatedAt ? new Date(local.updatedAt) : null; }
    var sof = C.mods.sof, orig = sof.render; sof.render = function () { orig.apply(this, arguments); render(); };
    $("prsaAdd").addEventListener("click", function () { P.rows.push({ id: id(), desc: "", account: "Pooled", category: "", amount: 0, month: "", status: "Idea", include: true, notes: "" }); changed(true); var ins = $("tPrsaPlan").querySelectorAll('input[data-f="desc"]'); if (ins.length) ins[ins.length - 1].focus(); });
    $("prsaExport").addEventListener("click", exportPlan);
    $("prsaImport").addEventListener("click", function () { $("prsaFile").click(); });
    $("prsaFile").addEventListener("change", function () { if (this.files[0]) importPlan(this.files[0]); this.value = ""; });
    $("prsaClear").addEventListener("click", function () { if (!confirm("Clear the PRSA plan? This removes every planning row and the Adjust available amount from this page and this browser. Export the plan first if you want a backup.")) return; var cats = P.categories; P = blank(); P.categories = cats; changed(true); });
    $("prsaAdjust").addEventListener("input", function () { P.adjust = num(this.value); changed(false); });
    $("prsaCats").addEventListener("change", function () { var c = this.value.split(",").map(L.txt).filter(Boolean); P.categories = c.length ? K.uniq(c) : DEFAULT_CATS.slice();
      // Update the dropdowns in place so a click elsewhere (e.g. Delete) is not lost to a table rebuild on blur.
      $("tPrsaPlan").querySelectorAll('select[data-f="category"]').forEach(function (sel) { var tr = sel.closest("tr[data-id]"), r = tr && P.rows.filter(function (x) { return x.id === tr.getAttribute("data-id"); })[0]; if (r) sel.innerHTML = opts(P.categories.slice(), r.category, '<option value="">\u2014</option>'); });
      changed(false); });
    $("tPrsaAcct").addEventListener("change", function (e) { var t = e.target, a = t.getAttribute && t.getAttribute("data-acct"); if (a == null) return; P.excluded = P.excluded.filter(function (x) { return x !== a; }); if (!t.checked) P.excluded.push(a); changed(false); });
    var body = $("tPrsaPlan").tBodies[0];
    function edit(e, fullRender) {
      var t = e.target, f = t.getAttribute && t.getAttribute("data-f"); if (!f) return;
      var tr = t.closest("tr[data-id]"), r = P.rows.filter(function (x) { return x.id === tr.getAttribute("data-id"); })[0]; if (!r) return;
      if (f === "include") { r.include = t.checked; tr.classList.toggle("off", !t.checked); }
      else if (f === "amount") r.amount = num(t.value);
      else if (f === "month") r.month = t.value ? +t.value : "";
      else r[f] = t.value;
      changed(fullRender);
    }
    body.addEventListener("input", function (e) { if (e.target.tagName === "INPUT" && e.target.type !== "checkbox") edit(e, false); });
    body.addEventListener("change", function (e) { if (e.target.tagName === "SELECT" || e.target.type === "checkbox") edit(e, false); });
    body.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]"); if (!b) return;
      var tr = b.closest("tr[data-id]"), i = P.rows.map(function (x) { return x.id; }).indexOf(tr.getAttribute("data-id")), act = b.getAttribute("data-act");
      if (act === "del") { if (P.rows[i].desc && !confirm("Delete \u201c" + P.rows[i].desc + "\u201d?")) return; P.rows.splice(i, 1); }
      else { var j = act === "up" ? i - 1 : i + 1; if (j < 0 || j >= P.rows.length) return; var x = P.rows[i]; P.rows[i] = P.rows[j]; P.rows[j] = x; }
      changed(true);
    });
    // Flush a pending autosave if the tab is closed or reloaded inside the debounce window.
    function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeLocal(); } }
    w.addEventListener("pagehide", flush); w.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
    // Another tab of this dashboard edited the plan: pick it up.
    w.addEventListener("storage", function (e) { if (e.key !== STORE_KEY || !e.newValue) return; try { P = clean(JSON.parse(e.newValue)); lastSaved = new Date(); render(); } catch (err) { } });
  }
  C.register("prsa", {
    classify: function () { return null; }, parse: function () { return {}; }, ingest: function () { },
    // Loading files or Clear data never wipes a real plan; only the fictional demo plan is reset.
    clear: function () { if (P.demo) { P = readLocal() || blank(); } },
    demo: function () { if (!readLocal() && !P.rows.length) P = demoPlan(); },
    snapshot: function () { return JSON.parse(JSON.stringify(P)); },
    // Embedded (Save with data) plan wins when it is newer than this browser's autosave.
    restore: function (o) { var e = clean(o), local = readLocal(); if (!local || !local.updatedAt || (e.updatedAt && e.updatedAt > local.updatedAt)) { P = e; P.demo = false; writeLocal(); } },
    render: render, report: function () { return { html: "", warns: 0 }; }, entries: function () { return []; },
    hasData: function () { return !P.demo && (P.rows.length > 0 || !!P.adjust || P.excluded.length > 0); }, init: init
  });
  C.prsa = { STORE_KEY: STORE_KEY, state: function () { return P; }, calc: calc, accounts: accounts, parsePlan: parsePlan, render: render };
})(window);
