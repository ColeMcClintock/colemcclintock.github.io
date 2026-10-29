/* Power BI Starter Kit page: browse, copy and download snippets. Works offline. */
(function () {
  "use strict";
  var FILES = window.KIT_FILES || [];
  var GROUPS = [["dax", "DAX measures"], ["m", "Power Query (M)"], ["theme", "Theme JSON"], ["docs", "Docs"]];
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); };
  var current = null;

  function highlight(f) {
    var t = esc(f.text);
    if (/\.(dax|pq)$/.test(f.name)) {
      t = t.replace(/("[^"\n]*")/g, '<span class="s">$1</span>');
      t = t.replace(/^(\s*\/\/.*)$/gm, '<span class="c">$1</span>');
      t = t.replace(/\b(VAR|RETURN|CALCULATE|DIVIDE|SUMX|SUM|IF|SWITCH|TRUE|DATEADD|DATESINPERIOD|DATESYTD|FILTER|ALLSELECTED|RANKX|REMOVEFILTERS|let|in|each|then|else|if|MEASURE|DEFINE|EVALUATE)\b/g, '<span class="k">$1</span>');
    }
    return t;
  }
  function show(f) {
    current = f;
    $("fileName").textContent = f.path;
    $("code").innerHTML = highlight(f);
    var dl = $("btnDl"); dl.href = f.path; dl.setAttribute("download", f.name);
    Array.prototype.forEach.call($("fileList").querySelectorAll("button"), function (b) { b.classList.toggle("on", b.getAttribute("data-path") === f.path); });
  }
  function tab(g) {
    Array.prototype.forEach.call($("tabs").querySelectorAll("button"), function (b) { b.setAttribute("aria-selected", b.getAttribute("data-g") === g ? "true" : "false"); });
    var list = FILES.filter(function (f) { return f.group === g; });
    $("fileList").innerHTML = list.map(function (f) { return '<li><button type="button" data-path="' + f.path + '">' + esc(f.name) + "</button></li>"; }).join("");
    Array.prototype.forEach.call($("fileList").querySelectorAll("button"), function (b) {
      b.onclick = function () { show(FILES.filter(function (f) { return f.path === b.getAttribute("data-path"); })[0]); };
    });
    if (list[0]) show(list[0]);
  }
  function copy(text, btn) {
    function done() { btn.textContent = "Copied"; btn.classList.add("copied"); setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1500); }
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { btn.textContent = "Select & copy manually"; } ta.remove();
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  // minimal markdown: headings, tables, lists, paragraphs, inline code, bold
  function md(src) {
    var inline = function (s) { return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"); };
    var lines = src.split("\n"), out = [], i = 0;
    while (i < lines.length) {
      var l = lines[i];
      if (/^#{1,3} /.test(l)) { var n = l.match(/^#+/)[0].length; out.push("<h" + n + ">" + inline(l.replace(/^#+ /, "")) + "</h" + n + ">"); i++; continue; }
      if (/^\|/.test(l)) {
        var rows = []; while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        var cells = function (r) { return r.replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); }); };
        out.push("<table><thead><tr>" + cells(rows[0]).map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.slice(2).map(function (r) { return "<tr>" + cells(r).map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>");
        continue;
      }
      if (/^\s*(\d+\.|-) /.test(l)) {
        var ordered = /^\s*\d+\./.test(l), items = [];
        while (i < lines.length && /^\s*(\d+\.|-) /.test(lines[i])) { items.push(lines[i].replace(/^\s*(\d+\.|-) /, "")); i++; }
        out.push((ordered ? "<ol>" : "<ul>") + items.map(function (t) { return "<li>" + inline(t) + "</li>"; }).join("") + (ordered ? "</ol>" : "</ul>"));
        continue;
      }
      if (l.trim()) out.push("<p>" + inline(l) + "</p>");
      i++;
    }
    return out.join("");
  }
  function init() {
    var counts = function (g) { return FILES.filter(function (f) { return f.group === g; }).length; };
    var all = FILES.filter(function (f) { return f.name === "99_define_all.dax"; })[0], dax = all ? (all.text.match(/^\s*MEASURE /gm) || []).length : 0;
    var cards = [["#theme", "Themes", counts("theme"), "Dark + light, schema-valid"], ["#snippets", "DAX measures", dax, "Readiness, safety, finance, titles"],
      ["#snippets", "M queries", counts("m"), "Loader, date table, dims, facts"], ["#model", "Star schema", "1", "7 facts, 4 dimensions"], ["#build", "Build time", "30\u201360", "minutes in Power BI Desktop"]];
    $("inside").innerHTML = cards.map(function (c) { return '<a class="kpi" href="' + c[0] + '"><div class="lbl">' + c[1] + '</div><div class="val">' + c[2] + '</div><div class="sub">' + c[3] + "</div></a>"; }).join("");
    var th = FILES.filter(function (f) { return f.name === "portfolio-theme-dark.json"; })[0];
    if (th) {
      var t = JSON.parse(th.text);
      var sw = t.dataColors.map(function (c, i) { return [c, "Data " + (i + 1)]; }).concat([[t.background, "Background"], [t.good, "Good"], [t.neutral, "Neutral"], [t.bad, "Bad"]]);
      $("swatches").innerHTML = sw.map(function (s) { return '<div class="sw"><i style="background:' + s[0] + '"></i><span>' + s[0] + "<br>" + s[1] + "</span></div>"; }).join("");
    }
    $("tabs").innerHTML = GROUPS.map(function (g) { return '<button type="button" role="tab" data-g="' + g[0] + '">' + g[1] + "</button>"; }).join("");
    Array.prototype.forEach.call($("tabs").querySelectorAll("button"), function (b) { b.onclick = function () { tab(b.getAttribute("data-g")); }; });
    $("btnCopy").onclick = function () { if (current) copy(current.text, $("btnCopy")); };
    var get = function (n) { var f = FILES.filter(function (x) { return x.name === n; })[0]; return f ? md(f.text) : ""; };
    $("layout").innerHTML = get("report-layout.md");
    $("build").innerHTML = get("build-steps.md");
    tab("dax");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
