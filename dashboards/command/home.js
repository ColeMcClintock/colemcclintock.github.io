/* Aviation Dashboard: Home page (tiles + overview from whatever data is loaded). */
(function (w) {
  "use strict";
  var K = w.DashKit, L = w.FundsLib, C = w.CMD, $ = K.$, esc = K.esc, full = L.full, plural = L.plural;
  function pic(cls, icon) { return '<span class="pic ' + cls + '"><svg class="ic"><use href="#' + icon + '"/></svg></span>'; }
  function head(cls, icon, title, m) { return "<h3>" + pic(cls, icon) + esc(title) + (m && m.asOf ? '<span class="oasof">' + esc(C.asOfText(m.asOf)) + "</span>" : "") + '<span class="more">Open &rsaquo;</span></h3>'; }
  function stat(l, v, s, cls) { return '<div class="stat' + (cls ? " " + cls : "") + '"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + (s || "&nbsp;") + "</div></div>"; }
  function ring(p) {
    var r = 26, c = 2 * Math.PI * r, off = c * (1 - p.pct);
    return '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="7"/><circle cx="32" cy="32" r="' + r + '" fill="none" stroke="#2563eb" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 32 32)"/></svg>';
  }
  C.renderHome = function () {
    var fy = C.currentFy(), p = C.fyProgress(fy), sof = C.mods.sof.summary(), pr = C.mods.pr.summary(), fu = C.mods.fuel.summary();
    var any = !!(sof || pr || fu), last = C.latestAsOf();
    $("hEyebrow").textContent = "FY" + fy + " \u00b7 Day " + p.day + " of " + p.days;
    $("hLead").textContent = last ? C.asOfText(last) : any ? "Funds, purchase requests and fuel in one place." : "Upload your Excel files to see funds, purchase requests and fuel in one place.";
    $("fyRing").innerHTML = ring(p) + '<div><div class="rv">' + C.pct(p.pct) + '</div><div class="rl">of FY' + fy + " elapsed</div></div>";
    $("homeEmpty").hidden = any; $("homeOverview").hidden = !any;
    $("tsSof").textContent = sof ? (sof.bal != null ? "Balance " + K.money(sof.bal) + " \u00b7 FY" + sof.fy : "Obligated " + K.money(sof.obl)) : "No data loaded";
    $("tsPr").textContent = pr ? (pr.types ? pr.types.map(function (t) { return t.type + " " + K.money(t.value); }).join(" \u00b7 ") : plural(pr.count, "PR") + " \u00b7 " + K.money(pr.value)) : "No data loaded";
    $("tsFuel").textContent = fu ? (fu.used != null ? C.pct(fu.used) + " of budget used \u00b7 FY" + fu.fy : K.money(fu.spent) + " spent") : "No data loaded";
    if (!any) return;
    // Status of Funds
    var h = head("t-sof", "i-sof", "Status of Funds" + (sof && sof.fy ? " \u00b7 FY" + sof.fy : ""), C.mods.sof);
    if (!sof) h += '<div class="empty">No Status of Funds files loaded.</div>';
    else {
      var spent = sof.obl + sof.disb;
      h += '<div class="big3">' + stat("TDP", sof.tdp == null ? "\u2014" : K.money(sof.tdp), sof.tdp == null ? "Funding file not loaded" : "AFP " + K.money(sof.afp)) +
        stat("Obligated", K.money(sof.obl), "Disbursed " + K.money(sof.disb)) +
        stat("Balance", sof.bal == null ? "\u2014" : K.money(sof.bal), sof.res ? "After " + K.money(sof.res) + " reservations" : "TDP \u2212 Res. \u2212 Oblig. \u2212 Disb.", sof.bal == null ? "" : sof.bal < 0 ? "bad" : "good") + "</div>";
      if (sof.tdp) {
        var sp = spent / sof.tdp, st = C.pace(sp, sof.elapsed);
        h += '<div class="gauge" style="margin-top:22px"><div class="g" style="background:linear-gradient(90deg,#60a5fa,#2563eb);width:' + Math.min(100, sp * 100).toFixed(1) + '%"></div><div class="mk" data-l="Pace ' + C.pct(sof.elapsed) + '" style="left:' + (sof.elapsed * 100).toFixed(1) + '%"></div></div>' +
          '<div class="gnote"><span>' + C.pct(sp) + " of TDP spent (obligation + disbursement)</span><span>" + (sof.elapsed ? '<span class="pill ' + st.k + '">' + st.t + "</span>" : "") + "</span></div>";
      }
    }
    $("oSof").innerHTML = h;
    // PR Tracker
    h = head("t-pr", "i-card", "PR Tracker", C.mods.pr);
    if (!pr) h += '<div class="empty">No PR files loaded.</div>';
    else {
      var mx = Math.max.apply(null, pr.levels.map(function (g) { return g.count; }).concat([1]));
      h += '<div class="big3">' + stat("PRs being tracked", K.fmt(pr.count), "across " + plural(pr.levels.length, "level")) + stat("Total value", K.money(pr.value), full(pr.value)) +
        stat("Highest level", pr.levels.length ? "L" + pr.levels[pr.levels.length - 1].level : "\u2014", pr.levels.length ? plural(pr.levels[pr.levels.length - 1].count, "PR") : "") + "</div>";
      if (pr.types) h += '<div class="htypes">' + pr.types.map(function (t) {
        return '<div class="ht" style="--tc:' + t.color + '"><div class="hn"><span class="tdot"></span>' + esc(t.type) + '</div><div class="hv">' + K.money(t.value) + '</div><div class="hl">' + plural(t.count, "PR") + (t.levels.length ? " \u00b7 " + t.levels.map(function (g) { return "L" + g.level + " " + K.fmt(g.count); }).join(" \u00b7 ") : "") + "</div></div>";
      }).join("") + "</div>";
      h += '<div class="lvlbars">' + pr.levels.map(function (g) {
        return '<div class="lvlbar"><span><span class="lvl" style="--lc:' + C.levelColor(g.level) + '">L' + g.level + '</span></span><div class="tr"><div class="fi" style="background:' + C.levelColor(g.level) + ";width:" + (g.count / mx * 100).toFixed(1) + '%"></div></div><span class="nv">' + K.fmt(g.count) + " \u00b7 " + K.money(g.value) + "</span></div>";
      }).join("") + "</div>";
    }
    $("oPr").innerHTML = h;
    // Fuel
    h = head("t-fuel", "i-fuel", "Fuel" + (fu ? " \u00b7 FY" + fu.fy : ""), C.mods.fuel);
    if (!fu) h += '<div class="empty">No fuel trackers loaded.</div>';
    else {
      h += '<div class="big3" style="grid-template-columns:repeat(4,1fr)">' + stat("Budget", fu.budget == null ? "\u2014" : K.money(fu.budget), plural(fu.list.length, "AASF")) + stat("Spent", K.money(fu.spent), K.fmt(fu.gal) + " gallons") +
        stat("Remaining", fu.rem == null ? "\u2014" : K.money(fu.rem), fu.used == null ? "" : C.pct(fu.used) + " used", fu.rem != null && fu.rem < 0 ? "bad" : "") +
        stat("Pace", fu.budget == null ? "\u2014" : esc(fu.pace.t), C.pct(fu.prog.pct) + " of the year elapsed", fu.pace.k === "over" ? "bad" : fu.pace.k === "on" ? "good" : "") + "</div>";
      h += '<div class="aasfs" style="margin:16px 0 0">' + fu.list.map(function (a) {
        return '<div><div style="display:flex;align-items:center;gap:8px;font-weight:650;font-size:.92rem"><span style="width:9px;height:9px;border-radius:50%;background:' + a.color + '"></span>' + esc(a.name) + '<span class="pill ' + a.pace.k + '">' + (a.budget == null ? "No budget" : a.pace.t) + "</span></div>" +
          '<div class="gauge" style="margin-top:20px"><div class="g' + (a.pace.k === "over" ? " over" : "") + '" style="width:' + Math.min(100, (a.used || 0) * 100).toFixed(1) + '%"></div><div class="mk" data-l="Pace" style="left:' + (fu.prog.pct * 100).toFixed(1) + '%"></div></div>' +
          '<div class="gnote"><span>' + K.money(a.spent) + " of " + (a.budget == null ? "\u2014" : K.money(a.budget)) + "</span><span>" + C.pct(a.used) + "</span></div></div>";
      }).join("") + "</div>";
    }
    $("oFuel").innerHTML = h;
  };
})(window);
