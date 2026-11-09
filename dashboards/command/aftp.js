/* Aviation Dashboard: AFTPs (layout preview on fictional demo data). Per soldier: AFTPs used, paid, unpaid and the $ still
   outstanding; clicking a soldier opens every AFTP date (#/aftp/<id>). Unpaid AFTPs are highlighted: amber while the oldest
   unpaid one is up to 60 days old, red after that.
   Data model (kept separate so the real AFTP report can be mapped in once its format is known; nothing is uploaded yet):
     soldiers  {id, rank, name}
     aftps     {sid, date: Date, amount, paid: true/false, paidDate: Date|null} */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, C = w.CMD, $ = K.$, esc = K.esc, plural = L.plural, full = L.full;
  var FM = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  var RANKS = ["PV1", "PV2", "PFC", "SPC", "CPL", "SGT", "SSG", "SFC", "MSG", "1SG", "SGM", "CSM", "WO1", "CW2", "CW3", "CW4", "CW5", "2LT", "1LT", "CPT", "MAJ", "LTC", "COL"];
  var LATE = 60, C_PAID = "#3b82f6", C_AMBER = "#f59e0b", C_RED = "#dc2626";
  var S = { soldiers: [], aftps: [], files: [], sort: { k: "out", dir: -1 }, q: "" };

  // ---------- adapters: source -> model ----------
  function day(s) { if (!s) return null; var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function iso(d) { return d ? d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) : null; }
  function fromPlain(o) {   // the demo object and Save-with-data both use this plain shape
    S.soldiers = (o.soldiers || []).map(function (s) { return { id: String(s.id), rank: String(s.rank || ""), name: String(s.name || "") }; });
    S.aftps = (o.aftps || []).map(function (a) { return { sid: String(a.sid), date: day(a.date), amount: +a.amount || 0, paid: !!a.paid, paidDate: a.paid ? day(a.paidDate) : null }; }).filter(function (a) { return a.date; });
  }
  function toPlain() { return { demo: !!S.demo, soldiers: S.soldiers, aftps: S.aftps.map(function (a) { return { sid: a.sid, date: iso(a.date), amount: a.amount, paid: a.paid, paidDate: iso(a.paidDate) }; }) }; }
  function clear() { S.soldiers = []; S.aftps = []; S.files = []; S.demo = false; }
  function demo() { var D = w.COMMAND_DEMO; if (D && D.aftp) { fromPlain(D.aftp); S.demo = true; S.files = [{ name: "Demo AFTP data", kind: "aftp", kindLabel: "AFTP report (demo)", count: S.aftps.length, status: "Fictional soldiers" }]; } }

  // ---------- derived ----------
  function today() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function days(a, b) { return Math.round((b - a) / 864e5); }
  C.aftpAge = function (a, now) { return a.paid ? null : days(a.date, now || today()); };
  function name(s) { return s.rank + " " + s.name; }
  function F() { return { fy: $("afFy").value, rank: $("afRank").value, st: $("afStatus").value }; }
  function inFy(a, fy) { return !fy || C.fyOf(a.date) === fy; }
  function stats(f) {
    var now = today(), by = {};
    S.soldiers.forEach(function (s) { if (f.rank && s.rank !== f.rank) return; by[s.id] = { s: s, id: s.id, name: name(s), rank: s.rank, used: 0, paid: 0, unpaid: 0, out: 0, paidAmt: 0, oldest: null, last: null }; });
    S.aftps.forEach(function (a) {
      var x = by[a.sid]; if (!x || !inFy(a, f.fy)) return;
      x.used++; if (!x.last || a.date > x.last) x.last = a.date;
      if (a.paid) { x.paid++; x.paidAmt += a.amount; }
      else { x.unpaid++; x.out += a.amount; var age = days(a.date, now); if (x.oldest == null || age > x.oldest) x.oldest = age; }
    });
    var list = Object.keys(by).map(function (k) { var x = by[k]; x.out = Math.round(x.out * 100) / 100; x.sev = !x.unpaid ? "ok" : x.oldest > LATE ? "red" : "amber"; return x; }).filter(function (x) { return x.used > 0; });
    if (f.st === "unpaid") list = list.filter(function (x) { return x.unpaid > 0; }); else if (f.st === "paid") list = list.filter(function (x) { return !x.unpaid; });
    return list;
  }
  function sevColor(k) { return k === "red" ? C_RED : k === "amber" ? C_AMBER : C_PAID; }

  // ---------- render ----------
  function render() {
    var fys = K.uniq(S.aftps.map(function (a) { return C.fyOf(a.date); })).sort(), fy = $("afFy").value;
    $("afFy").innerHTML = '<option value="">All years</option>' + fys.map(function (y) { return '<option value="' + y + '">FY' + y + "</option>"; }).join("");
    $("afFy").value = fys.indexOf(fy) >= 0 ? fy : fy === "" && $("afFy").dataset.touched ? "" : fys[fys.length - 1] || "";
    var rk = $("afRank").value, have = K.uniq(S.soldiers.map(function (s) { return s.rank; })).sort(function (a, b) { return RANKS.indexOf(a) - RANKS.indexOf(b); });
    $("afRank").innerHTML = '<option value="">All ranks</option>' + have.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join(""); $("afRank").value = have.indexOf(rk) >= 0 ? rk : "";
    var sid = C.sub, sol = sid ? S.soldiers.filter(function (s) { return s.id === sid; })[0] : null;
    $("afDemo").hidden = !S.demo;
    $("afList").hidden = !!sol; $("afDetail").hidden = !sol;
    var f = F();
    $("afScope").innerHTML = "<strong>" + (f.fy ? "FY" + esc(f.fy) : "All years") + "</strong> \u00b7 " + plural(S.soldiers.length, "soldier");
    if (sol) return detail(sol, f);
    var list = stats(f);
    kpis(list); topChart(list); monthChart(f, list); table(list);
  }
  function kpi(lbl, val, sub, color) { return '<div class="kpi" style="--st:' + color + '"><div class="lbl">' + lbl + '</div><div class="val">' + val + '</div><div class="sub">' + (sub || "&nbsp;") + "</div></div>"; }
  function kpis(list) {
    var t = { used: 0, paid: 0, unpaid: 0, out: 0, paidAmt: 0 }, who = 0, red = 0;
    list.forEach(function (x) { t.used += x.used; t.paid += x.paid; t.unpaid += x.unpaid; t.out += x.out; t.paidAmt += x.paidAmt; if (x.unpaid) who++; if (x.sev === "red") red++; });
    var bad = t.unpaid ? (red ? C_RED : C_AMBER) : "#16a34a";
    $("afKpis").innerHTML = kpi("AFTPs used", K.fmt(t.used), plural(list.length, "soldier"), "#475569") +
      kpi("AFTPs paid", K.fmt(t.paid), K.money(t.paidAmt) + " paid", C_PAID) +
      kpi("AFTPs unpaid", '<span style="color:' + (t.unpaid ? bad : "inherit") + '">' + K.fmt(t.unpaid) + "</span>", t.used ? C.pct(t.unpaid / t.used, 1) + " of AFTPs used" : "", bad) +
      kpi("Outstanding", '<span style="color:' + (t.out ? bad : "inherit") + '">$' + K.fmt(t.out) + "</span>", full(t.out) + " not yet paid", bad) +
      kpi("Soldiers with unpaid AFTPs", '<span style="color:' + (who ? bad : "inherit") + '">' + K.fmt(who) + "</span>", red ? plural(red, "soldier") + " waiting over " + LATE + " days" : who ? "None waiting over " + LATE + " days" : "Everyone is paid", bad);
    S.total = t; S.who = who;
  }
  function topChart(list) {
    var top = list.filter(function (x) { return x.out > 0; }).sort(function (a, b) { return b.out - a.out; }).slice(0, 10);
    var o = K.chartBase(); o.indexAxis = "y"; o.plugins.legend.display = false;
    o.scales.x.ticks = { callback: function (v) { return "$" + K.fmt(v); } }; o.scales.x.beginAtZero = true;
    o.plugins.tooltip.callbacks = { label: function (c) { var x = top[c.dataIndex]; return [full(x.out) + " outstanding", plural(x.unpaid, "unpaid AFTP"), "Oldest unpaid: " + x.oldest + " days"]; } };
    o.onClick = function (e, els) { if (els.length) C.go("aftp/" + encodeURIComponent(top[els[0].index].id)); };
    o.onHover = function (e, els) { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
    K.upsert("cAfTop", { type: "bar", data: { labels: top.map(function (x) { return x.name; }), datasets: [{ label: "Outstanding", data: top.map(function (x) { return x.out; }), backgroundColor: top.map(function (x) { return sevColor(x.sev); }) }] }, options: o });
    $("afTopBox").style.height = Math.max(160, 40 + top.length * 30) + "px";
    $("afTopNote").innerHTML = top.length ? '<span class="sw" style="background:' + C_AMBER + '"></span>Oldest unpaid AFTP ' + LATE + ' days or less <span class="sw" style="background:' + C_RED + '"></span>Over ' + LATE + " days. Click a bar to open the soldier." : "No unpaid AFTPs.";
  }
  function monthChart(f, list) {
    var ids = {}; list.forEach(function (x) { ids[x.id] = 1; });
    var paid = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], un = paid.slice(), pAmt = paid.slice(), uAmt = paid.slice();
    S.aftps.forEach(function (a) { if (!ids[a.sid] || !inFy(a, f.fy)) return; var i = C.fmOf(a.date) - 1; if (a.paid) { paid[i]++; pAmt[i] += a.amount; } else { un[i]++; uAmt[i] += a.amount; } });
    var o = K.chartBase(); o.scales.x.stacked = true; o.scales.y.stacked = true; o.scales.y.ticks = { precision: 0 };
    o.plugins.tooltip.callbacks = { label: function (c) { var amt = c.datasetIndex ? uAmt : pAmt; return c.dataset.label + ": " + c.parsed.y + " (" + full(Math.round(amt[c.dataIndex] * 100) / 100) + ")"; } };
    K.upsert("cAfMon", { type: "bar", data: { labels: FM, datasets: [{ label: "Paid", data: paid, backgroundColor: C_PAID }, { label: "Unpaid", data: un, backgroundColor: C_AMBER }] }, options: o });
  }
  var COLS = [["name", "Soldier", "text"], ["rank", "Rank", "rank"], ["used", "AFTPs used", "num"], ["paid", "Paid", "num"], ["unpaid", "Unpaid", "num"], ["out", "Outstanding", "money"], ["oldest", "Oldest unpaid", "num"], ["last", "Last AFTP", "date"]];
  function table(list) {
    var q = S.q.trim().toLowerCase(), rows = q ? list.filter(function (x) { return (x.name + " " + x.rank).toLowerCase().indexOf(q) >= 0; }) : list.slice();
    var k = S.sort.k, dir = S.sort.dir;
    rows.sort(function (a, b) {
      var va = a[k], vb = b[k];
      if (k === "rank") { va = RANKS.indexOf(a.rank); vb = RANKS.indexOf(b.rank); }
      if (k === "name") { va = a.s.name.split(" ").pop() + " " + a.s.name; vb = b.s.name.split(" ").pop() + " " + b.s.name; return dir * va.localeCompare(vb); }
      if (va == null) va = -Infinity; if (vb == null) vb = -Infinity;
      return dir * ((va > vb) - (va < vb)) || a.name.localeCompare(b.name);
    });
    var t = $("tAftp");
    t.tHead.innerHTML = "<tr>" + COLS.map(function (c) { return '<th data-k="' + c[0] + '"' + ' class="' + (c[2] === "num" || c[2] === "money" ? "num " : "") + (k === c[0] ? "sorted" + (dir > 0 ? " asc" : "") : "") + '">' + c[1] + "</th>"; }).join("") + "</tr>";
    t.tBodies[0].innerHTML = rows.length ? rows.map(function (x) {
      return '<tr class="sol ' + x.sev + '" data-sid="' + esc(x.id) + '" tabindex="0"><td><span class="slink">' + esc(x.s.name) + '</span></td><td>' + esc(x.rank) + '</td><td class="num">' + x.used + '</td><td class="num">' + x.paid +
        '</td><td class="num">' + (x.unpaid ? '<span class="upill ' + x.sev + '">' + x.unpaid + " unpaid</span>" : '<span class="muted">0</span>') + '</td><td class="num' + (x.out ? " out " + x.sev : "") + '">' + (x.out ? full(x.out) : "\u2014") +
        '</td><td class="num">' + (x.oldest == null ? "\u2014" : x.oldest + " days") + "</td><td>" + C.dateText(x.last) + "</td></tr>";
    }).join("") : '<tr><td colspan="8" class="muted">No soldiers match.</td></tr>';
    $("afNote").textContent = q ? plural(rows.length, "soldier") + " match \u201c" + S.q.trim() + "\u201d" : "";
  }
  function detail(s, f) {
    var now = today(), mine = S.aftps.filter(function (a) { return a.sid === s.id; }).sort(function (a, b) { return a.date - b.date; });
    var un = mine.filter(function (a) { return !a.paid; }), out = Math.round(un.reduce(function (t, a) { return t + a.amount; }, 0) * 100) / 100;
    var oldest = un.length ? Math.max.apply(null, un.map(function (a) { return days(a.date, now); })) : null, sev = !un.length ? "ok" : oldest > LATE ? "red" : "amber";
    $("afDName").textContent = name(s);
    $("afDSub").textContent = plural(mine.length, "AFTP") + " \u00b7 " + (mine.length ? C.dateText(mine[0].date) + " \u2013 " + C.dateText(mine[mine.length - 1].date) : "") + " \u00b7 " + full(mine.length ? mine[0].amount : 0) + " per AFTP";
    $("afDKpis").innerHTML = kpi("AFTPs used", K.fmt(mine.length), "", "#475569") + kpi("Paid", K.fmt(mine.length - un.length), full(Math.round((mine.reduce(function (t, a) { return t + a.amount; }, 0) - out) * 100) / 100), C_PAID) +
      kpi("Unpaid", '<span style="color:' + (un.length ? sevColor(sev) : "inherit") + '">' + un.length + "</span>", oldest == null ? "All paid" : "Oldest " + oldest + " days", un.length ? sevColor(sev) : "#16a34a") +
      kpi("Outstanding", '<span style="color:' + (out ? sevColor(sev) : "inherit") + '">' + full(out) + "</span>", "", out ? sevColor(sev) : "#16a34a");
    $("tAfDetail").tBodies[0].innerHTML = mine.map(function (a, i) {
      var age = a.paid ? days(a.date, a.paidDate) : days(a.date, now), k = a.paid ? "paid" : age > LATE ? "red" : "amber";
      return '<tr class="' + (a.paid ? "" : "sol " + k) + '"><td class="num">' + (i + 1) + "</td><td>" + C.dateText(a.date) + "</td><td>FY" + C.fyOf(a.date) + " \u00b7 " + FM[C.fmOf(a.date) - 1] + '</td><td><span class="spill ' + k + '">' + (a.paid ? "Paid" : "Unpaid") + '</span></td><td class="num">' + full(a.amount) +
        "</td><td>" + (a.paid ? C.dateText(a.paidDate) : "\u2014") + '</td><td class="num' + (a.paid ? "" : " out " + k) + '">' + (a.paid ? "paid after " + age + " days" : age + " days outstanding") + "</td></tr>";
    }).join("");
    $("tAfDetail").tFoot.innerHTML = '<tr><td></td><td colspan="3"><strong>Total</strong></td><td class="num"><strong>' + full(Math.round(mine.reduce(function (t, a) { return t + a.amount; }, 0) * 100) / 100) + "</strong></td><td></td><td class=\"num\">" + (out ? full(out) + " outstanding" : "") + "</td></tr>";
  }
  function exportCsv() {
    var list = stats(F()), lines = [["Soldier", "Rank", "AFTPs used", "Paid", "Unpaid", "Outstanding", "Oldest unpaid (days)"].join(",")];
    list.forEach(function (x) { lines.push(['"' + x.s.name.replace(/"/g, '""') + '"', x.rank, x.used, x.paid, x.unpaid, x.out.toFixed(2), x.oldest == null ? "" : x.oldest].join(",")); });
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv" })); a.download = "AFTPs.csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function report() {
    return { html: (S.aftps.length ? '<p class="ok"><strong>Layout preview:</strong> ' + plural(S.soldiers.length, "soldier") + ", " + plural(S.aftps.length, "AFTP") + ".</p>" : '<p class="muted">No AFTP data loaded.</p>') +
      '<p class="muted">AFTP report upload is coming soon, once the report format is available.</p>' +
      '<p class="ok">Days outstanding = days from the AFTP date to today for unpaid AFTPs (amber up to ' + LATE + " days, red after); for paid AFTPs, days from the AFTP date to the paid date.</p>", warns: 0 };
  }
  function summary() {
    if (!S.aftps.length) return null;
    var fys = K.uniq(S.aftps.map(function (a) { return C.fyOf(a.date); })).sort(), fy = fys[fys.length - 1], list = stats({ fy: fy, rank: "", st: "" });
    var t = { used: 0, paid: 0, unpaid: 0, out: 0 }; list.forEach(function (x) { t.used += x.used; t.paid += x.paid; t.unpaid += x.unpaid; t.out += x.out; });
    var top = list.filter(function (x) { return x.out > 0; }).sort(function (a, b) { return b.out - a.out; });
    return { demo: !!S.demo, fy: fy, used: t.used, paid: t.paid, unpaid: t.unpaid, out: Math.round(t.out * 100) / 100, who: top.length, red: top.filter(function (x) { return x.sev === "red"; }).length, top: top.slice(0, 3).map(function (x) { return { id: x.id, name: x.name, out: x.out, unpaid: x.unpaid, sev: x.sev }; }) };
  }

  C.register("aftp", {
    classify: function () { return null; },   // the AFTP report format is not known yet: no upload is read for this page
    parse: function () { return {}; }, ingest: function () {},
    clear: clear, demo: demo, snapshot: toPlain, restore: function (o) { fromPlain(o); S.demo = !!o.demo; S.files = [{ name: "Saved AFTP data", kind: "aftp", kindLabel: "AFTP report", count: S.aftps.length, status: "Saved" }]; },
    report: report, render: render, summary: summary, entries: function () { return S.files; }, hasData: function () { return S.aftps.length > 0; }, _state: S,
    init: function () {
      ["afFy", "afRank", "afStatus"].forEach(function (id) { $(id).addEventListener("change", function () { if (id === "afFy") this.dataset.touched = "1"; render(); }); });
      $("afReset").addEventListener("click", function () { $("afFy").value = ""; delete $("afFy").dataset.touched; $("afRank").value = ""; $("afStatus").value = ""; $("afSearch").value = ""; S.q = ""; render(); });
      var st; $("afSearch").addEventListener("input", function () { clearTimeout(st); S.q = this.value; st = setTimeout(function () { table(stats(F())); }, 100); });
      $("afCsv").addEventListener("click", exportCsv);
      $("tAftp").tHead.addEventListener("click", function (e) { var th = e.target.closest("th[data-k]"); if (!th) return; var k = th.getAttribute("data-k"); S.sort = S.sort.k === k ? { k: k, dir: -S.sort.dir } : { k: k, dir: k === "name" || k === "rank" ? 1 : -1 }; table(stats(F())); });
      function open(e) { var tr = e.target.closest("tr[data-sid]"); if (tr) C.go("aftp/" + encodeURIComponent(tr.getAttribute("data-sid"))); }
      $("tAftp").tBodies[0].addEventListener("click", open);
      $("tAftp").tBodies[0].addEventListener("keydown", function (e) { if (e.key === "Enter") open(e); });
      $("afBack").addEventListener("click", function () { C.go("aftp"); });
    }
  });
})(window);
