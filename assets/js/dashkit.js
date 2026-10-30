/* Shared helpers for the dashboards. Browser-only; no network calls. */
(function (w) {
  "use strict";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var K = {
    MON: MON,
    $: function (id) { return document.getElementById(id); },
    esc: function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); },
    uniq: function (a) { return Array.from(new Set(a)); },
    sum: function (a, f) { var t = 0; for (var i = 0; i < a.length; i++) t += f ? f(a[i]) : a[i]; return t; },
    fmt: function (v, d) { return v == null || !isFinite(v) ? "\u2014" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); },
    money: function (v, d) {
      if (v == null || !isFinite(v)) return "\u2014";
      var a = Math.abs(v), s = v < 0 ? "-" : "";
      if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(d == null ? 2 : d) + "B";
      if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(d == null ? 2 : d) + "M";
      if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(d == null ? 0 : d) + "K";
      return s + "$" + a.toFixed(0);
    },
    monthLabel: function (m) { var p = m.split("-"); return MON[+p[1] - 1] + " " + p[0]; },
    monthShort: function (m) { var p = m.split("-"); return MON[+p[1] - 1] + " '" + p[0].slice(2); },
    addMonths: function (m, n) { var p = m.split("-"), d = new Date(+p[0], +p[1] - 1 + n, 1); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); },
    monthEnd: function (m) { var p = m.split("-"); return new Date(+p[0], +p[1], 0); },
    toMonth: function (v) {
      if (v instanceof Date) return v.getFullYear() + "-" + ("0" + (v.getMonth() + 1)).slice(-2);
      var s = String(v || "").trim();
      if (/^\d{4}-\d{1,2}/.test(s)) { var p = s.split("-"); return p[0] + "-" + ("0" + p[1]).slice(-2); }
      var d = new Date(s); return isNaN(d) ? null : d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
    },
    toISODate: function (v) {
      if (v instanceof Date) return v.getFullYear() + "-" + ("0" + (v.getMonth() + 1)).slice(-2) + "-" + ("0" + v.getDate()).slice(-2);
      var s = String(v || "").trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      var d = new Date(s); return isNaN(d) ? null : K.toISODate(d);
    },
    lowerKeys: function (o) { var r = {}; Object.keys(o).forEach(function (k) { r[String(k).trim().toLowerCase()] = o[k]; }); return r; },
    fillSelect: function (sel, values, allLabel, keep, labels) {
      var cur = sel.value;
      sel.innerHTML = (allLabel ? '<option value="">' + allLabel + "</option>" : "") + values.map(function (v, i) { return '<option value="' + K.esc(v) + '">' + K.esc(labels ? labels[i] : v) + "</option>"; }).join("");
      if (keep && values.indexOf(cur) >= 0) sel.value = cur;
    },
    downloadCsv: function (filename, header, rows) {
      var q = function (v) { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var text = [header.map(q).join(",")].concat(rows.map(function (r) { return r.map(q).join(","); })).join("\r\n");
      var blob = new Blob([text], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
    /* Reads CSV/XLSX locally with SheetJS. cb(err, {name: rows[]}) */
    readWorkbook: function (file, cb) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true }), out = {};
          wb.SheetNames.forEach(function (n, i) { out[i === 0 ? "_first" : n.toLowerCase()] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "", raw: true }); if (i === 0) out[n.toLowerCase()] = out._first; });
          cb(null, out);
        } catch (err) { cb(err); }
      };
      reader.onerror = function () { cb(new Error("Could not read the file.")); };
      reader.readAsArrayBuffer(file);
    },
    missingCols: function (rows, required) {
      if (!rows || !rows.length) return required.slice();
      var cols = Object.keys(rows[0]).map(function (c) { return String(c).trim().toLowerCase(); });
      return required.filter(function (c) { return cols.indexOf(c) < 0; });
    },
    chartBase: function () {
      return {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, boxHeight: 12 } }, tooltip: { mode: "index", intersect: false } },
        scales: { x: { grid: { color: "rgba(60,95,143,.25)" } }, y: { grid: { color: "rgba(60,95,143,.25)" } } }
      };
    },
    charts: {},
    upsert: function (id, cfg) {
      var c = K.charts[id];
      if (c) { c.config.type === cfg.type ? (c.data = cfg.data, c.options = cfg.options, c.update()) : (c.destroy(), K.charts[id] = new Chart(K.$(id), cfg)); }
      else K.charts[id] = new Chart(K.$(id), cfg);
    },
    initCharts: function () {
      Chart.defaults.color = "#c7d3e3"; Chart.defaults.borderColor = "rgba(60,95,143,.25)";
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      function theme(light) {
        Chart.defaults.color = light ? "#222" : "#c7d3e3";
        var grid = light ? "rgba(0,0,0,.12)" : "rgba(60,95,143,.25)";
        Object.keys(K.charts).forEach(function (k) {
          var c = K.charts[k];
          if (c.options.scales) Object.keys(c.options.scales).forEach(function (a) { var sc = c.options.scales[a]; sc.ticks = sc.ticks || {}; sc.ticks.color = Chart.defaults.color; if (sc.grid) sc.grid.color = grid; if (sc.title) sc.title.color = Chart.defaults.color; });
          if (c.options.plugins && c.options.plugins.legend) { c.options.plugins.legend.labels = c.options.plugins.legend.labels || {}; c.options.plugins.legend.labels.color = Chart.defaults.color; }
          c.update("none");
        });
      }
      w.addEventListener("beforeprint", function () { theme(true); });
      w.addEventListener("afterprint", function () { theme(false); });
    },
    dictTable: function (tbodyId, cols) {
      K.$(tbodyId).innerHTML = cols.map(function (c) { return "<tr><td><code>" + c[0] + "</code></td><td>" + (c[1] ? "Yes" : "Optional") + "</td><td>" + c[2] + "</td></tr>"; }).join("");
    },
    heatColor: function (t) { // 0..1 -> navy to amber to red
      t = Math.max(0, Math.min(1, t));
      var stops = [[22, 41, 74], [138, 154, 91], [227, 179, 76], [224, 100, 92]], s = t * (stops.length - 1), i = Math.min(Math.floor(s), stops.length - 2), f = s - i;
      var c = stops[i].map(function (v, j) { return Math.round(v + (stops[i + 1][j] - v) * f); });
      return "rgb(" + c.join(",") + ")";
    }
  };
  w.DashKit = K;
})(window);
