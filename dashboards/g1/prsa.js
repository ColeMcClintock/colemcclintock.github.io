/* PRSA Planner (Status of Funds page). PRSA is one fund spread across several SOF accounts.
   Accounts: lines whose MDEP matches G1.PROGRAM_MDEP_MATCH.prsa (programs.js; export MDEP column first, then the
   Account Key MDEP). G1.PROGRAM_ACCOUNT_MATCH.prsa (account name contains PRSA) is only a fallback. Ticked/unticked by the user.
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
  var HEAD = ["Order", "Description / Planning factor", "Account", "Category", "Amount", "Target month", "Status", "Include", "Notes", "Type", "Rank", "Start date", "End date", "Soldiers"];
  // ---------- Orders lines: daily pay rates per grade (entered by the user; no built-in pay table) ----------
  var GRADES = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "W1", "W2", "W3", "W4", "W5", "O1", "O2", "O3", "O4", "O5", "O6"];
  var RATES_KEY = "g1-pay-rates", TYPES = { factor: "Planning factor", orders: "Orders" };
  function blankRates() { var o = {}; GRADES.forEach(function (g) { o[g] = null; }); return { v: 1, updatedAt: null, demo: false, rates: o }; }
  var R = blankRates(), rateTimer = null;
  function cleanRates(o) {
    var r = blankRates(); o = o || {}; r.updatedAt = o.updatedAt || null; r.demo = !!o.demo;
    var src = o.rates || {}; GRADES.forEach(function (g) { var x = L.parseAmt(src[g]); r.rates[g] = x == null || !isFinite(x) || x < 0 ? null : Math.round(x * 100) / 100; });
    return r;
  }
  function hasRates(o) { return GRADES.some(function (g) { return (o || R).rates[g] != null; }); }
  function readRates() { try { var t = w.localStorage.getItem(RATES_KEY); return t ? cleanRates(JSON.parse(t)) : null; } catch (e) { return null; } }
  function writeRates() { rateTimer = null; if (R.demo) return; try { w.localStorage.setItem(RATES_KEY, JSON.stringify(R)); } catch (e) { storeOk = false; } }
  function normGrade(v) { var s = L.txt(v).toUpperCase().replace(/[\s\-]/g, ""); var m = s.match(/^([EOW])0?(\d)$/); return m && GRADES.indexOf(m[1] + m[2]) >= 0 ? m[1] + m[2] : ""; }
  // ISO date (yyyy-mm-dd) from a date input, Excel serial, Date or text such as 10/03/2026
  function isoDate(v) {
    if (v == null || v === "") return "";
    var d = null;
    if (v instanceof Date) d = isNaN(v) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    else if (typeof v === "number") { if (v > 20000 && v < 80000) { var pc = XLSX.SSF.parse_date_code(v); if (pc) d = new Date(Date.UTC(pc.y, pc.m - 1, pc.d)); } }
    else { var t = L.txt(v), m;
      if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) d = new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]));
      else if (/^\d{5}$/.test(t)) return isoDate(+t); }
    return d && !isNaN(d) ? d.toISOString().slice(0, 10) : "";
  }
  function utc(iso) { var p = iso.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  // Orders: days are counted inclusive of start and end; amount = daily rate x days x soldiers
  function ordersCalc(r) {
    var o = { days: 0, rate: r.rank ? R.rates[r.rank] : null, count: r.count, amount: 0, warn: "" };
    if (!r.rank) o.warn = "Pick a rank";
    else if (o.rate == null) o.warn = "Set rate for " + r.rank;
    if (!r.start || !r.end) o.warn = o.warn || "Enter start and end dates";
    else { var d = Math.round((utc(r.end) - utc(r.start)) / 864e5) + 1; if (d < 1) o.warn = o.warn || "End date is before start date"; else o.days = d; }
    if (!o.warn) o.amount = r2(o.rate * o.days * o.count);
    return o;
  }
  // cost of an Orders line by fiscal month of the planner year (days in each month); days before / after that year are kept apart
  function ordersMonths(r, fyv) {
    var c = ordersCalc(r), out = { months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], before: 0, after: 0 };
    if (!c.amount) return out;
    var per = c.rate * c.count, s = utc(r.start), e = utc(r.end), fs = Date.UTC(+fyv - 1, 9, 1), fe = Date.UTC(+fyv, 8, 30);
    for (var t = s; t <= e; t += 864e5) {
      if (t < fs) out.before += per; else if (t > fe) out.after += per; else { var d = new Date(t); out.months[(d.getUTCMonth() + 3) % 12] += per; }
    }
    out.months = out.months.map(r2); out.before = r2(out.before); out.after = r2(out.after);
    return out;
  }
  function refreshOrders() { P.rows.forEach(function (r) { if (r.type === "orders") r.amount = ordersCalc(r).amount; }); }
  function calcText(r) {
    var c = ordersCalc(r);
    if (c.warn) return '<span class="flag">' + esc(c.warn) + "</span>" + (c.days ? ' <span class="muted">' + c.days + " day" + (c.days === 1 ? "" : "s") + "</span>" : "");
    return c.days + " day" + (c.days === 1 ? "" : "s") + " \u00d7 " + esc(full(c.rate)) + " \u00d7 " + c.count;
  }
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
      // rows saved before line types existed load as planning factors (unchanged behaviour)
      var type = /^orders?$/i.test(L.txt(r.type)) ? "orders" : "factor", cnt = Math.floor(L.parseAmt(r.count) || 0);
      var row = { id: L.txt(r.id) || id(), type: type, desc: L.txt(r.desc), account: L.txt(r.account) || "Pooled", category: L.txt(r.category), amount: num(r.amount),
        month: normMonth(r.month), status: normStatus(r.status), include: r.include !== false, notes: L.txt(r.notes) };
      if (type === "orders") { row.rank = normGrade(r.rank); row.start = isoDate(r.start); row.end = isoDate(r.end); row.count = cnt >= 1 ? cnt : 1; row.month = ""; }
      return row;
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
  function match() { return C.programs.mdepData("prsa", fy()); }
  function accounts(md) {
    md = md || match();
    var list = md.list.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    rekey(list.map(function (a) { return a.name; }));
    return list.map(function (a) { var on = P.excluded.indexOf(a.name) < 0; return { name: a.name, account: a.account || a.name, mdeps: a.mdeps || [], mixed: !!a.mixed, other: a.other || [], tdp: a.tdp, afp: a.afp, te: a.te, obl: a.obl, disb: a.disb, funded: a.funded, bal: a.funded ? r2(a.tdp - a.te) : null, on: on }; });
  }
  // Saved plans keep working when account labels change (e.g. account -> "account · MDEP" slices, or back):
  // a row or exclusion pointing at a name that is gone is moved to the one current name sharing its account part.
  function base(nm) { return L.an(String(nm).split(" \u00b7 ")[0]); }
  function rekey(names) {
    if (!names.length) return;
    var moved = 0;
    function fix(v) { if (v === "Pooled" || names.indexOf(v) >= 0) return v; var c = names.filter(function (n) { return base(n) === base(v); }); if (c.length === 1) { moved++; return c[0]; } return v; }
    P.rows.forEach(function (r) { r.account = fix(r.account); });
    P.excluded = P.excluded.map(fix);
    if (moved && !P.demo) { clearTimeout(saveTimer); saveTimer = setTimeout(writeLocal, 250); }
  }
  function calc() {
    refreshOrders();
    var md = match(), acc = accounts(md), on = acc.filter(function (a) { return a.on; });
    var avail = r2(on.reduce(function (s, a) { return s + (a.bal || 0); }, 0)), adj = P.adjust || 0, start = r2(avail + adj);
    var inc = P.rows.filter(function (r) { return r.include; }), planned = r2(inc.reduce(function (s, r) { return s + r.amount; }, 0));
    var st = {}; STATUSES.forEach(function (s) { st[s] = { inc: 0, all: 0, n: 0 }; });
    P.rows.forEach(function (r) { var o = st[r.status]; o.all = r2(o.all + r.amount); o.n++; if (r.include) o.inc = r2(o.inc + r.amount); });
    // planning factors land in their target month (unscheduled up front); Orders are spread by the days falling in each month
    var fyv = fy(), om = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], before = 0, after = 0;
    inc.filter(function (r) { return r.type === "orders"; }).forEach(function (r) { var x = ordersMonths(r, fyv); x.months.forEach(function (v, i) { om[i] += v; }); before += x.before; after += x.after; });
    var fac = inc.filter(function (r) { return r.type !== "orders"; });
    var unsched = r2(fac.filter(function (r) { return !r.month; }).reduce(function (s, r) { return s + r.amount; }, 0)), run = start - unsched - before, months = FM.map(function (m, i) {
      run = r2(run - om[i] - fac.filter(function (r) { return r.month === i + 1; }).reduce(function (s, r) { return s + r.amount; }, 0)); return run; });
    var byAcct = {}; inc.forEach(function (r) { byAcct[r.account] = r2((byAcct[r.account] || 0) + r.amount); });
    return { accounts: acc, available: avail, adjust: adj, start: start, planned: planned, remaining: r2(start - planned), status: st, unscheduled: unsched, months: months, ordersMonths: om.map(r2), ordersBefore: r2(before), ordersAfter: r2(after), byAcct: byAcct, fy: fyv, match: md };
  }
  // ---------- rendering ----------
  function kpi(l, v, sub, color, neg) { return '<div class="kpi' + (neg ? " neg" : "") + '" style="--st:' + color + '"><div class="lbl">' + l + '</div><div class="val">' + v + '</div><div class="sub">' + sub + "</div></div>"; }
  function totals() {
    var m = calc(), neg = m.remaining < 0;
    $("prsaKpis").innerHTML = kpi("Pooled available", full(m.available), m.accounts.filter(function (a) { return a.on; }).length + " of " + m.accounts.length + " PRSA accounts", "#2563eb") +
      kpi("Adjust available", full(m.adjust), "Scenario offset", "#64748b") + kpi("Included projections", full(m.planned), P.rows.filter(function (r) { return r.include; }).length + " of " + P.rows.length + " rows", "#b45309") +
      kpi("Projected remaining", full(m.remaining), neg ? "Over-committed" : "Available + adjust \u2212 projections", neg ? "#b91c1c" : "#15803d", neg);
    $("prsaSummary").innerHTML = "Available <b>" + esc(full(m.start)) + "</b> \u00b7 Projected remaining <b class=\"" + (neg ? "neg" : "") + "\" id=\"prsaRemain\">" + esc(full(m.remaining)) + "</b>";
    $("prsaFy").textContent = "FY" + m.fy + " \u00b7 " + ruleText(m.match);
    $("prsaNote").innerHTML = noteHtml(m.match);
    var t = $("tPrsaAcct");
    t.tHead.innerHTML = '<tr><th>Include</th><th>Account</th><th>MDEP</th><th class="num">TDP</th><th class="num">AFP</th><th class="num">Total Expenditure</th><th class="num">Obligation</th><th class="num">Disbursement</th><th class="num">Balance</th><th class="num">Planned here</th><th class="num">After plan</th></tr>';
    t.tBodies[0].innerHTML = m.accounts.map(function (a) {
      var pl = m.byAcct[a.name] || 0, after = a.bal == null ? null : r2(a.bal - pl);
      return '<tr><td><input type="checkbox" data-acct="' + esc(a.name) + '"' + (a.on ? " checked" : "") + ' aria-label="Include ' + esc(a.name) + '"></td><td>' + esc(a.name) + '</td><td>' + esc(a.mdeps.join(", ") || "\u2014") + (a.mixed ? ' <span class="hint" title="Funding is by account; this account also has MDEP ' + esc(a.other.join(", ")) + '. TDP/AFP are the whole account.">mixed MDEPs \u00b7 account-level funding</span>' : "") + '</td><td class="num">' + (a.funded ? full(a.tdp) : "\u2014") + '</td><td class="num">' + (a.funded ? full(a.afp) : "\u2014") + '</td><td class="num">' + full(a.te) + '</td><td class="num">' + full(a.obl) + '</td><td class="num">' + full(a.disb) + '</td><td class="num' + (a.bal < 0 ? " neg" : "") + '">' + (a.bal == null ? '<span class="hint">no funding</span>' : full(a.bal)) + '</td><td class="num">' + (pl ? full(pl) : "\u2014") + '</td><td class="num' + (after < 0 ? " neg" : "") + '">' + (after == null ? "\u2014" : full(after)) + "</td></tr>";
    }).join("") || '<tr><td colspan="11" class="muted">' + emptyText(m) + '</td></tr>';
    var pooled = m.byAcct.Pooled || 0;
    t.tFoot.innerHTML = m.accounts.length ? '<tr><td></td><td>Pooled (ticked accounts)' + (pooled ? ' \u00b7 pooled rows ' + esc(full(pooled)) : "") + '</td><td></td><td class="num">' + full(sum(m.accounts, "tdp")) + '</td><td class="num">' + full(sum(m.accounts, "afp")) + '</td><td class="num">' + full(sum(m.accounts, "te")) + '</td><td class="num">' + full(sum(m.accounts, "obl")) + '</td><td class="num">' + full(sum(m.accounts, "disb")) + '</td><td class="num">' + full(m.available) + '</td><td class="num">' + full(m.planned) + '</td><td class="num' + (m.available - m.planned < 0 ? " neg" : "") + '">' + full(r2(m.available - m.planned)) + "</td></tr>" : "";
    $("prsaStatus").innerHTML = STATUSES.map(function (s) { var o = m.status[s]; return '<div class="statuscount" style="--sc:' + SCOLOR[s] + '" data-status="' + s + '"><strong>' + esc(full(o.inc)) + "</strong><span>" + s + " \u00b7 " + o.n + " row" + (o.n === 1 ? "" : "s") + (o.all !== o.inc ? " \u00b7 " + esc(full(o.all)) + " incl. what-ifs" : "") + "</span></div>"; }).join("");
    var foot = $("tPrsaPlan").tFoot; foot.innerHTML = P.rows.length ? '<tr><td></td><td></td><td>Included total</td><td></td><td></td><td class="num">' + full(m.planned) + '</td><td colspan="5"></td></tr>' : "";
    $("prsaOrdNote").textContent = m.ordersBefore || m.ordersAfter ? "Orders days outside FY" + m.fy + ": " + (m.ordersBefore ? full(m.ordersBefore) + " before October (taken off up front)" : "") + (m.ordersBefore && m.ordersAfter ? "; " : "") + (m.ordersAfter ? full(m.ordersAfter) + " after September (in the total, not in this year\u2019s months)" : "") + "." : "";
    charts(m);
  }
  var SRC = { "export": "SOF export MDEP column", key: "Account Key MDEP", funding: "funding file MDEP column" };
  function ruleText(md) {
    if (md.mode === "mdep") return "MDEP = PRSA (" + Object.keys(md.srcs).map(function (k) { return SRC[k] || k; }).join(" + ") + ")";
    if (md.mode === "name") return "fallback: account name contains \u201cPRSA\u201d (no line has MDEP PRSA)";
    return "MDEP = PRSA \u00b7 none found";
  }
  function detectedText(md) { return md.detected.length ? md.detected.slice(0, 25).map(function (d) { return esc(d[0]) + " (" + K.fmt(d[1]) + ")"; }).join(", ") + (md.detected.length > 25 ? ", \u2026" : "") : "none (no MDEP column in the SOF export and no MDEP in the Account Key)"; }
  function emptyText(m) {
    var md = m.match, recs = C.mods.sof._state.recs.length;
    if (!recs) return "No Status of Funds data loaded. Pooled planning still works with Adjust available.";
    return "No lines with MDEP PRSA in the FY" + esc(m.fy) + " Status of Funds data. MDEP values found: " + detectedText(md) + ". Pooled planning still works with Adjust available.";
  }
  function noteHtml(md) {
    var t = "PRSA is an MDEP spread across several accounts. Lines are matched on MDEP (trimmed, any case, equal to or starting with \u201cPRSA\u201d); tick the accounts that make up the pool, then add planning factors to see what is left.";
    if (md.mode === "mdep" && md.fundingLevel === "account") { var mx = md.list.filter(function (a) { return a.mixed; }); t += " TDP/AFP come from the funding file by account" + (mx.length ? "; " + mx.length + " account" + (mx.length === 1 ? " mixes" : "s mix") + " PRSA with other MDEPs, so its TDP/AFP cover the whole account (add an MDEP column to the funding file to split it)." : "."); }
    if (md.mode === "mdep" && md.fundingLevel === "mdep") t += " TDP/AFP come from the funding file's MDEP column (PRSA rows only).";
    if (md.mode === "name") t += " <b>No line has MDEP PRSA</b>, so accounts whose name contains \u201cPRSA\u201d are used instead. MDEP values found: " + detectedText(md) + ".";
    return t;
  }
  function drawer() {
    if (!C.mods.sof._state.recs.length && !(C.mods.sof._state.fund)) return "";
    var md = match(), S = C.mods.sof._state, ex = S.files.filter(function (e) { return e.kind === "export" && e.rep && e.rep.mdepHeader; }).map(function (e) { return e.rep.mdepHeader; }),
      ky = S.files.filter(function (e) { return e.kind === "key" && e.rep && e.rep.hasMdep; }).map(function (e) { return e.rep.mdepHeader || "MDEP"; }),
      fd = S.files.filter(function (e) { return e.kind === "funding" && e.rep && e.rep.mdepHeader; }).map(function (e) { return e.rep.mdepHeader; });
    var h = ['<h4>PRSA Planner</h4>', '<p class="muted">Rule: ' + esc(ruleText(md)) + '. Configured as <code>PROGRAM_MDEP_MATCH.prsa</code> in programs.js (fallback <code>PROGRAM_ACCOUNT_MATCH.prsa</code>).</p>',
      '<p class="muted">MDEP columns read: SOF export ' + (ex.length ? "<code>" + K.uniq(ex).map(esc).join("</code>, <code>") + "</code>" : "none") + "; Account Key " + (ky.length ? "<code>" + K.uniq(ky).map(esc).join("</code>, <code>") + "</code>" : "none") + "; funding file " + (fd.length ? "<code>" + K.uniq(fd).map(esc).join("</code>, <code>") + "</code>" : "none") + ". The export line's MDEP is used first, then the Account Key MDEP for that line's account.</p>",
      '<p class="muted">Funding: ' + (md.fundingLevel === "mdep" ? "TDP/AFP from the funding file's MDEP column, PRSA rows only; accounts with more than one PRSA-like MDEP are split into account \u00b7 MDEP rows." : "the funding file has no MDEP column, so TDP/AFP are attributed at the account level. Expenditure, Obligation and Disbursement count only lines with MDEP PRSA; an account that also carries other MDEPs is marked \u201cmixed\u201d and its whole TDP/AFP is shown (untick it, or add an MDEP column to the funding file).") + "</p>",
      '<p class="muted">MDEP values in FY' + esc(md.fy) + " lines: " + detectedText(md) + ".</p>"];
    return h.join("");
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
    refreshOrders();
    var acc = ["Pooled"].concat(accounts().map(function (a) { return a.name; })), y = fy();
    var t = $("tPrsaPlan");
    t.tHead.innerHTML = "<tr><th></th><th>Type</th><th>Description / Planning factor</th><th>Account</th><th>Category</th><th class=\"num\">Amount</th><th>Target month / Orders</th><th>Status</th><th>Include</th><th>Notes</th><th></th></tr>";
    t.tBodies[0].innerHTML = P.rows.map(function (r, i) {
      var mo = '<option value="">Unscheduled</option>' + FM.map(function (m, j) { var cy = j < 3 ? +y - 1 : +y; return '<option value="' + (j + 1) + '"' + (r.month === j + 1 ? " selected" : "") + ">" + m + " " + String(cy).slice(2) + "</option>"; }).join("");
      return '<tr data-id="' + esc(r.id) + '"' + (r.include ? "" : ' class="off"') + '><td class="rowbtns"><button type="button" data-act="up" title="Move up" aria-label="Move up"' + (i ? "" : " disabled") + '>\u2191</button><button type="button" data-act="down" title="Move down" aria-label="Move down"' + (i < P.rows.length - 1 ? "" : " disabled") + '>\u2193</button></td>' +
        '<td><select data-f="type" aria-label="Line type">' + Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (r.type === k ? " selected" : "") + ">" + TYPES[k] + "</option>"; }).join("") + "</select></td>" +
        '<td class="desc"><input type="text" data-f="desc" value="' + esc(r.desc) + '" placeholder="' + (r.type === "orders" ? "Orders (e.g. exercise support)" : "Planning factor") + '" aria-label="Description"></td>' +
        '<td><select data-f="account" aria-label="Account">' + opts(acc, r.account) + "</select></td>" +
        '<td><select data-f="category" aria-label="Category">' + opts(P.categories.slice(), r.category, '<option value="">\u2014</option>') + "</select></td>" +
        (r.type === "orders" ?
          '<td class="num ocalc"><b class="oamt">' + esc(full(r.amount)) + '</b><div class="small ctext">' + calcText(r) + "</div></td>" +
          '<td class="orders"><select data-f="rank" aria-label="Rank"><option value="">Rank</option>' + GRADES.map(function (g) { return '<option value="' + g + '"' + (r.rank === g ? " selected" : "") + ">" + g + (R.rates[g] == null ? " (no rate)" : "") + "</option>"; }).join("") + "</select>" +
          '<input type="date" data-f="start" value="' + esc(r.start || "") + '" aria-label="Start date"><span class="muted">to</span><input type="date" data-f="end" value="' + esc(r.end || "") + '" aria-label="End date">' +
          '<label class="ocount">\u00d7 <input type="number" min="1" step="1" data-f="count" value="' + (r.count || 1) + '" aria-label="Number of soldiers"> soldier' + ((r.count || 1) === 1 ? "" : "s") + "</label></td>"
        : '<td><input type="number" step="0.01" data-f="amount" value="' + (r.amount || r.amount === 0 ? r.amount : "") + '" aria-label="Amount"></td>' +
          '<td><select data-f="month" aria-label="Target month">' + mo + "</select></td>") +
        '<td><select data-f="status" aria-label="Status">' + opts(STATUSES.slice(), r.status) + "</select></td>" +
        '<td><input type="checkbox" data-f="include"' + (r.include ? " checked" : "") + ' aria-label="Include in projection"></td>' +
        '<td class="notes"><input type="text" data-f="notes" value="' + esc(r.notes) + '" aria-label="Notes"></td>' +
        '<td class="rowbtns"><button type="button" class="del" data-act="del" title="Delete row" aria-label="Delete row">\u2715</button></td></tr>';
    }).join("") || '<tr><td colspan="11" class="muted">No planning rows yet. Use “+ Add row”.</td></tr>';
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
    var m = calc(), rows = [HEAD].concat(P.rows.map(function (r, i) { var o = r.type === "orders"; return [i + 1, r.desc, r.account, r.category, r.amount, !o && r.month ? FM[r.month - 1] : "", r.status, r.include ? "Yes" : "No", r.notes, TYPES[r.type], o ? r.rank : "", o ? r.start : "", o ? r.end : "", o ? r.count : ""]; }));
    var settings = [["Setting", "Value"], ["Adjust available", P.adjust || 0], ["Categories", P.categories.join(", ")], ["Excluded accounts", P.excluded.join("; ")], ["Fiscal year", "FY" + m.fy], ["Updated", P.updatedAt || ""]];
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "PRSA Plan"); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(settings), "Settings");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ratesAoa()), "Rates");
    var d = new Date(), name = "G1-PRSA-Plan-" + ("0" + d.getDate()).slice(-2) + K.MON[d.getMonth()] + String(d.getFullYear()).slice(2) + ".xlsx";
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function parsePlan(wb) {
    var out = null, hmap = { order: "order", descriptionplanningfactor: "desc", description: "desc", planningfactor: "desc", account: "account", category: "category", amount: "amount", targetmonth: "month", month: "month", status: "status", include: "include", included: "include", notes: "notes", type: "type", linetype: "type", rank: "rank", grade: "rank", startdate: "start", start: "start", enddate: "end", end: "end", soldiers: "count", count: "count", numberofsoldiers: "count" };
    wb.SheetNames.forEach(function (sn) {
      if (out) return; var aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "" });
      for (var r = 0; r < Math.min(15, aoa.length); r++) {
        var map = {}; (aoa[r] || []).forEach(function (h, c) { var k = hmap[L.norm(h)]; if (k && map[k] == null) map[k] = c; });
        if (map.desc != null && map.amount != null) {
          out = { rows: [] };
          for (var i = r + 1; i < aoa.length; i++) {
            var row = aoa[i] || [], g = function (k) { return map[k] == null ? "" : row[map[k]]; };
            if (!L.txt(g("desc")) && L.blankish(g("amount"))) continue;
            out.rows.push({ type: g("type"), desc: g("desc"), account: g("account"), category: g("category"), amount: g("amount"), month: normMonth(g("month")), status: g("status"), include: yes(g("include")), notes: g("notes"), rank: g("rank"), start: g("start"), end: g("end"), count: g("count") });
          }
          return;
        }
      }
    });
    if (!out) return null;
    var rt = parseRates(wb, true); if (rt) out.payRates = rt;
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
      var nr = o.payRates && hasRates(o.payRates);
      if (nr) { R = cleanRates(o.payRates); R.demo = false; R.updatedAt = new Date().toISOString(); writeRates(); }
      P.demo = false; changed(true); renderRates(); C.toast("Imported " + P.rows.length + " PRSA plan rows" + (nr ? " and daily pay rates." : "."));
    };
    reader.readAsArrayBuffer(file);
  }
  // ---------- daily pay rates: settings section, export/import ----------
  function ratesAoa() { return [["Grade", "Daily rate"]].concat(GRADES.map(function (g) { return [g, R.rates[g] == null ? "" : R.rates[g]]; })); }
  // any sheet with Grade + Daily rate (or Rate) columns; sheetOnly = only a sheet named Rates (plan files)
  function parseRates(wb, sheetOnly) {
    var names = sheetOnly ? wb.SheetNames.filter(function (n) { return /^rates?$/i.test(n) || /pay\s*rates?/i.test(n); }) : wb.SheetNames, out = null;
    names.forEach(function (sn) {
      if (out) return; var aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "" });
      for (var r = 0; r < Math.min(10, aoa.length); r++) {
        var gc = null, rc = null; (aoa[r] || []).forEach(function (h, c) { var k = L.norm(h); if (gc == null && /^(grade|rank|paygrade)$/.test(k)) gc = c; else if (rc == null && /^(dailyrate|rate|perday|dailypay|payperday|rateperday)$/.test(k)) rc = c; });
        if (gc == null || rc == null) continue;
        var o = { rates: {} };
        for (var i = r + 1; i < aoa.length; i++) { var g = normGrade((aoa[i] || [])[gc]); if (g) o.rates[g] = (aoa[i] || [])[rc]; }
        out = cleanRates(o); return;
      }
    });
    return out;
  }
  function download(wb, name) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportRates() { var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ratesAoa()), "Rates"); var d = new Date(); download(wb, "G1-Pay-Rates-" + ("0" + d.getDate()).slice(-2) + K.MON[d.getMonth()] + String(d.getFullYear()).slice(2) + ".xlsx"); }
  function importRates(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var o = null; try { o = parseRates(XLSX.read(new Uint8Array(e.target.result), { type: "array" }), false); } catch (err) { o = null; }
      if (!o) { C.toast("Not a pay rates file: needs Grade and Daily rate columns.", true); return; }
      R = o; R.demo = false; R.updatedAt = new Date().toISOString(); writeRates(); ratesChanged(true);
      C.toast("Imported daily pay rates for " + GRADES.filter(function (g) { return R.rates[g] != null; }).length + " grades.");
    };
    reader.readAsArrayBuffer(file);
  }
  function ratesChanged(full) { if (full) renderRates(); else ratesNote(); render(); }
  function ratesNote() {
    var n = GRADES.filter(function (g) { return R.rates[g] != null; }).length;
    $("ratesNote").textContent = R.demo ? "Fictional demo rates for the sample plan only \u2014 not a real pay table. Typing a rate starts your own (blank) table." : n ? n + " of 20 grades have a rate \u00b7 saved in this browser and in Save with data" : "No rates yet. Enter your own $/day; nothing is preset.";
    $("dRates").querySelector("summary").textContent = "Daily pay rates (PRSA Orders)" + (n ? " \u00b7 " + n + "/20" : "");
  }
  function renderRates() {
    var box = $("ratesGrid"); if (!box) return;
    box.innerHTML = [["Enlisted", "E"], ["Warrant", "W"], ["Officer", "O"]].map(function (grp) {
      return '<fieldset><legend>' + grp[0] + "</legend>" + GRADES.filter(function (g) { return g[0] === grp[1]; }).map(function (g) {
        return '<label>' + g + ' <input type="number" min="0" step="0.01" data-grade="' + g + '" value="' + (R.rates[g] == null ? "" : R.rates[g]) + '" placeholder="$/day" aria-label="' + g + ' daily rate"></label>';
      }).join("") + "</fieldset>";
    }).join("");
    ratesNote();
  }
  function rateInput(e) {
    var t = e.target, g = t.getAttribute && t.getAttribute("data-grade"); if (!g) return;
    if (R.demo) { var keep = R.rates; R = blankRates(); R.demo = false; box().querySelectorAll("input[data-grade]").forEach(function (i) { if (i !== t) i.value = ""; }); void keep; }
    var x = L.parseAmt(t.value); R.rates[g] = x == null || !isFinite(x) || x < 0 ? null : Math.round(x * 100) / 100;
    R.updatedAt = new Date().toISOString(); clearTimeout(rateTimer); rateTimer = setTimeout(writeRates, 250);
    ratesChanged(false);
  }
  function box() { return $("ratesGrid"); }
  function demoRates() { var r = blankRates(); r.demo = true; GRADES.forEach(function (g, i) { r.rates[g] = 100 + i * 10; }); return r; }
  // ---------- demo ----------
  function demoPlan() {
    var p = blank(); p.demo = true; p.updatedAt = new Date().toISOString(); p.adjust = 15000;
    p.rows = [
      { desc: "Annual conference travel (example)", account: "Outreach Travel", category: "Travel", amount: 18500, month: 3, status: "Planned", include: true, notes: "Fictional demo row" },
      { desc: "Office supplies restock (example)", account: "Outreach Supplies", category: "Supplies", amount: 6200, month: 5, status: "Committed", include: true, notes: "" },
      { desc: "Facilitator contract (example)", account: "Pooled", category: "Contracts", amount: 42000, month: 7, status: "Idea", include: true, notes: "What-if: toggle Include" },
      { desc: "Workshop training seats (example)", account: "Outreach Operations", category: "Training", amount: 9800, month: 9, status: "Planned", include: true, notes: "" },
      { desc: "Year-end equipment buy (example)", account: "Pooled", category: "Other", amount: 25000, month: "", status: "Idea", include: false, notes: "Excluded scenario" },
      { type: "orders", desc: "Exercise support orders (example)", account: "Outreach Operations", category: "Training", rank: "E5", start: (+fy() - 1) + "-11-17", end: (+fy() - 1) + "-12-16", count: 2, status: "Planned", include: true, notes: "Fictional demo orders" }
    ].map(function (r) { r.id = id(); if (!r.type) r.type = "factor"; return r; });
    return p;
  }
  // ---------- wiring ----------
  function init() {
    var local = readLocal(); if (local) { P = local; lastSaved = local.updatedAt ? new Date(local.updatedAt) : null; }
    var lr = readRates(); if (lr) R = lr;
    renderRates();
    box().addEventListener("input", rateInput);
    $("ratesExport").addEventListener("click", exportRates);
    $("ratesImport").addEventListener("click", function () { $("ratesFile").click(); });
    $("ratesFile").addEventListener("change", function () { if (this.files[0]) importRates(this.files[0]); this.value = ""; });
    $("prsaRatesLink").addEventListener("click", function () { $("btnInfo").click(); setTimeout(function () { var d = $("dRates"); d.open = true; d.scrollIntoView({ block: "start" }); }, 50); });
    w.addEventListener("storage", function (e) { if (e.key !== RATES_KEY || !e.newValue) return; try { R = cleanRates(JSON.parse(e.newValue)); ratesChanged(true); } catch (err) { } });
    var sof = C.mods.sof, orig = sof.render; sof.render = function () { orig.apply(this, arguments); render(); };
    var origRep = sof.report; sof.report = function () { var r = origRep.apply(this, arguments) || { html: "", warns: 0 }, d = ""; try { d = drawer(); } catch (e) { } return { html: (r.html || "") + d, warns: r.warns || 0 }; };
    $("prsaAdd").addEventListener("click", function () { P.rows.push({ id: id(), type: "factor", desc: "", account: "Pooled", category: "", amount: 0, month: "", status: "Idea", include: true, notes: "" }); changed(true); var ins = $("tPrsaPlan").querySelectorAll('input[data-f="desc"]'); if (ins.length) ins[ins.length - 1].focus(); });
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
      else if (f === "type") { r.type = t.value === "orders" ? "orders" : "factor"; if (r.type === "orders") { r.month = ""; r.count = r.count || 1; r.rank = r.rank || ""; r.start = r.start || ""; r.end = r.end || ""; } fullRender = true; }
      else if (f === "rank") r.rank = normGrade(t.value);
      else if (f === "start" || f === "end") r[f] = isoDate(t.value);
      else if (f === "count") { var cn = Math.floor(L.parseAmt(t.value) || 0); r.count = cn >= 1 ? cn : 1; }
      else r[f] = t.value;
      if (r.type === "orders" && !fullRender) { r.amount = ordersCalc(r).amount; var oa = tr.querySelector(".oamt"), ct = tr.querySelector(".ctext"); if (oa) oa.textContent = full(r.amount); if (ct) ct.innerHTML = calcText(r); }
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
    clear: function () { if (P.demo) { P = readLocal() || blank(); } if (R.demo) { R = readRates() || blankRates(); renderRates(); } },
    demo: function () { if (!readLocal() && !P.rows.length) P = demoPlan(); if (!readRates() && !hasRates()) { R = demoRates(); renderRates(); } },
    snapshot: function () { refreshOrders(); var o = JSON.parse(JSON.stringify(P)); if (!R.demo && hasRates()) o.payRates = JSON.parse(JSON.stringify(R)); return o; },
    // Embedded (Save with data) plan wins when it is newer than this browser's autosave.
    restore: function (o) {
      var e = clean(o), local = readLocal(); if (!local || !local.updatedAt || (e.updatedAt && e.updatedAt > local.updatedAt)) { P = e; P.demo = false; writeLocal(); }
      if (o.payRates) { var er = cleanRates(o.payRates), lr = readRates(); if (!lr || !lr.updatedAt || (er.updatedAt && er.updatedAt > lr.updatedAt)) { R = er; R.demo = false; writeRates(); } renderRates(); }
    },
    render: render, report: function () { return { html: "", warns: 0 }; }, entries: function () { return []; },
    hasData: function () { return !P.demo && (P.rows.length > 0 || !!P.adjust || P.excluded.length > 0) || !R.demo && hasRates(); }, init: init
  });
  C.prsa = { STORE_KEY: STORE_KEY, RATES_KEY: RATES_KEY, GRADES: GRADES, rates: function () { return R; }, ordersCalc: ordersCalc, ordersMonths: ordersMonths, parseRates: parseRates, match: match, rekey: rekey, state: function () { return P; }, calc: calc, accounts: accounts, parsePlan: parsePlan, render: render };
})(window);
