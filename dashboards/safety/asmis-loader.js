/* ASMIS export loader: header normalization, type parsing, load report.
   Runs entirely in the browser. No data leaves the device. */
(function (w) {
  "use strict";
  var MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  // [key, export header, type, aliases (normalized), used for]
  var COLUMNS = [
    ["accident_no", "Accident #", "text", ["accident no", "accident number", "accident id", "accident"], "Record ID (detail view)"],
    ["ccir", "CCIR #", "text", ["ccir no", "ccir", "ccir number"], "Tracker, tables, detail"],
    ["asmis", "ASMIS #", "text", ["asmis no", "asmis", "asmis number", "asmis id"], "Tracker, detail"],
    ["created_by", "ASMIS Investigation Created By", "text", ["asmis investigation created by", "investigation created by", "created by"], "Detail view only"],
    ["uic", "Unit UIC", "text", ["unit uic", "uic", "unit"], "Unit UIC filter"],
    ["msc", "Tech", "text", ["tech", "msc", "major subordinate command"], "Shown as MSC: filter, MSC chart, tracker"],
    ["battalion", "Battalion", "text", ["battalion", "bn", "battalion name"], "Battalion filter and chart"],
    ["cls", "Accident Class", "class", ["accident class", "class"], "Class KPIs, charts, filter"],
    ["status", "Status", "status", ["status", "investigation status", "accident status"], "Open/overdue KPIs, pipeline, tracker"],
    ["acc_age", "Accident Age", "int", ["accident age", "accident age days"], "Aging buckets (computed from date if blank)"],
    ["date", "Accident Date", "date", ["accident date", "date of accident", "mishap date", "date"], "All date filters and trends (required)"],
    ["due", "Due Date", "date", ["due date", "investigation due date"], "Tracker (computed as date + 90 if blank)"],
    ["overdue", "Days Overdue", "int", ["days overdue", "overdue days"], "Overdue KPI and tracker (computed if blank)"],
    ["compl", "Compl. Date", "date", ["compl date", "completion date", "completed date", "complete date", "date completed"], "Detail view"],
    ["dow", "Day of Week", "text", ["day of week", "day", "weekday"], "Day-of-week chart, heat map"],
    ["tod", "Time of Day", "time", ["time of day", "time", "accident time"], "Heat map"],
    ["on_duty", "On Duty", "yn", ["on duty", "on duty y n", "onduty"], "On/off duty chart, filter"],
    ["duty_status", "Duty Status", "text", ["duty status", "status of duty"], "Duty status chart, filter"],
    ["gender", "Gender", "text", ["gender", "sex"], "Aggregated demographics only (suppressed under 3)"],
    ["yos", "Years of Service", "num", ["years of service", "yos", "years service"], "Aggregated demographics only"],
    ["rank", "Rank", "text", ["rank", "grade", "rank grade", "pay grade"], "Aggregated demographics only"],
    ["age_years", "Age", "num", ["age", "age years"], "Aggregated demographics only"],
    ["reported_via", "Reported Via", "text", ["reported via", "reported by", "report method"], "Not charted (always CCIR)"],
    ["injury", "Injury Y/N", "yn", ["injury y n", "injury yn", "injury"], "Injury counts"],
    ["nlti", "No Lost Time Injury", "yn", ["no lost time injury", "nlti"], "Detail view"],
    ["days_away", "Days Away from Work", "num", ["days away from work", "days away"], "Detail view"],
    ["days_hosp", "Days Hospitalized", "num", ["days hospitalized", "days hospital"], "Detail view"],
    ["days_restr", "Days Restricted", "num", ["days restricted", "days restricted duty"], "Detail view"],
    ["days_lost", "Days Lost", "num", ["days lost", "total days lost"], "Days lost KPI"],
    ["c_away", "Days Away from Work Cost", "money", ["days away from work cost", "days away cost"], "Cost composition"],
    ["c_hosp", "Days Hospitalized Cost", "money", ["days hospitalized cost", "hospitalized cost"], "Cost composition"],
    ["c_ppd", "Perm. Partial Disability Cost", "money", ["perm partial disability cost", "permanent partial disability cost", "ppd cost"], "Cost composition"],
    ["c_ptd", "Perm. Total Disability Cost", "money", ["perm total disability cost", "permanent total disability cost", "ptd cost"], "Cost composition"],
    ["c_fat", "Fatality Cost", "money", ["fatality cost", "fatal cost"], "Cost composition"],
    ["c_injury", "Injury Cost", "money", ["injury cost", "total injury cost"], "Injury cost KPI"],
    ["prop", "Property Damage Y/N", "yn", ["property damage y n", "property damage yn", "property damage"], "Material damage counts"],
    ["ecod", "Material ECOD", "money", ["material ecod", "ecod", "material ecod cost", "material cost", "material damage cost"], "Material ECOD KPI and cost (blank = $0)"],
    ["c_total", "Total Accident Cost", "money", ["total accident cost", "total cost", "accident cost"], "Total cost KPI, cost chart"],
    ["subtype", "Accident Subtype", "text", ["accident subtype", "accident sub type", "subtype"], "Subtype chart, filter"],
    ["cause", "Cause Subtype", "text", ["cause subtype", "cause sub type", "cause"], "Cause chart, filter"],
    ["mistake", "Mistake Type", "text", ["mistake type", "mistake"], "Not charted (detail view)"],
    ["hf_cat", "HFACS Category", "text", ["hfacs category", "hfacs cat"], "HFACS drill-down"],
    ["hf_fail", "HFACS Failure", "text", ["hfacs failure"], "HFACS drill-down"],
    ["hf_sub", "HFACS Subfailure", "text", ["hfacs subfailure", "hfacs sub failure", "hfacs sub-failure"], "HFACS drill-down"],
    ["summary", "Summary", "text", ["summary", "narrative", "accident summary"], "Detail view (never in the auto summary)"],
    // optional trailing columns (not counted in the 45)
    ["sub_date", "SUB DATE REPORTED", "date", ["sub date reported", "submitted date reported", "date reported", "sub date"], "Optional: detail view", true],
    ["documentation", "Documentation", "text", ["documentation", "docs", "documents"], "Optional: detail view", true],
    ["comments", "Comments", "text", ["comments", "comment", "remarks", "notes"], "Optional: tracker and detail view", true],
    ["assigned_to", "Assigned To", "text", ["assigned to", "assignee", "assigned"], "Optional: tracker and detail view", true]
  ];
  var REQUIRED = COLUMNS.filter(function (c) { return !c[5]; });
  var CLASS_LABELS = { A: "Class A", B: "Class B", C: "Class C", D: "Class D", E: "Class E (Ground)", R: "Class R (NG)", Unclassified: "Unclassified" };
  var CLASS_ORDER = ["A", "B", "C", "D", "E", "R", "Unclassified"];
  function classLabel(c) { return CLASS_LABELS[c] || (c == null ? "" : String(c)); }
  // blank-like cell values: empty, dashes (incl. accounting "$ -"), (blank), N/A
  function blankish(v) {
    if (v == null) return true;
    if (typeof v === "number") return false;
    var s = String(v).replace(/\u00a0/g, " ").trim();
    if (!s) return true;
    if (/^\(?\s*blank\s*\)?$/i.test(s) || /^(n\/?a|#n\/a|none|null)$/i.test(s)) return true;
    return /^\$?\s*[-\u2013\u2014]+\s*\$?$/.test(s);
  }
  function dashZero(v) { return typeof v === "string" && /^\$?\s*[-\u2013\u2014]+\s*\$?$/.test(v.replace(/\u00a0/g, " ").trim()); }
  var BYKEY = {}; COLUMNS.forEach(function (c) { BYKEY[c[0]] = c; });

  function norm(h) {
    return String(h == null ? "" : h).replace(/\u00a0/g, " ").replace(/\*/g, "").replace(/#/g, " no ")
      .replace(/\(.*?\)/g, " ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  var ALIAS = {};
  COLUMNS.forEach(function (c) { ALIAS[norm(c[1])] = c[0]; c[3].forEach(function (a) { if (!ALIAS[a]) ALIAS[a] = c[0]; }); });

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function mk(y, m, d) { var dt = new Date(y, m, d, 12); return (dt.getMonth() === m && dt.getDate() === d) ? dt : null; }
  function fromSerial(n) { var ms = Math.round((n - 25569) * 864e5), u = new Date(ms); return mk(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); }
  function yr(y) { y = +y; return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y; }

  function parseDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) ? null : mk(v.getFullYear(), v.getMonth(), v.getDate());
    if (typeof v === "number") return v > 20000 && v < 80000 ? fromSerial(v) : null;
    var s = String(v).trim(), m;
    if (!s) return null;
    if ((m = s.match(/^(\d{1,2})[-\s\/]([A-Za-z]{3,9})[-\s\/,]*(\d{2,4})(?:\s.*)?$/))) { var mi = MON.indexOf(m[2].slice(0, 3).toLowerCase()); return mi < 0 ? null : mk(yr(m[3]), mi, +m[1]); }
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s.*)?$/))) return mk(yr(m[3]), +m[1] - 1, +m[2]);
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/))) { var mj = MON.indexOf(m[1].slice(0, 3).toLowerCase()); return mj < 0 ? null : mk(+m[3], mj, +m[2]); }
    if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(+s);
    return null;
  }
  function parseNum(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (dashZero(v)) return 0;                                  // accounting zero: "-", "$ -", "$-"
    if (blankish(v)) return null;
    var s = String(v).replace(/[\u00a0\s$,]/g, "");
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /^\(-/.test(s);
    s = s.replace(/[()]/g, "").replace(/^-/, "");
    if (!/^\d*\.?\d+$/.test(s)) return NaN;
    return (neg ? -1 : 1) * parseFloat(s);
  }
  function parseYN(v) {
    if (v == null || v === "") return null;
    if (typeof v === "boolean") return v;
    var s = String(v).trim().toLowerCase();
    if (/^(y|yes|true|1|x)$/.test(s)) return true;
    if (/^(n|no|false|0)$/.test(s)) return false;
    return null;
  }
  function parseClass(v) { // A-D, E (Ground), R (NG), Unclassified (blank), else raw value
    if (blankish(v)) return "Unclassified";
    var raw = String(v).replace(/\u00a0/g, " ").trim(), t = raw.toUpperCase().replace(/^CLASS\s*/, "").replace(/\s+/g, " ").trim();
    if (/^[ABCD]$/.test(t) || /^[ABCD]\s*[-(]/.test(t)) return t[0];
    if (/^E(\s*-?\s*(GRND|GROUND|GRD)|\s*\(\s*GROUND\s*\))?$/.test(t)) return "E";
    if (/^R(\s*-?\s*NG|\s*\(\s*NG\s*\))?$/.test(t)) return "R";
    if (/^UNCLASSIFIED$/.test(t)) return "Unclassified";
    return raw;
  }
  function parseStatus(v) {
    var s = String(v == null ? "" : v).trim(); if (!s) return null;
    var l = s.toLowerCase();
    if (/^final|closed|complete/.test(l)) return "Final";
    if (/review/.test(l) && /ngb/.test(l)) return "In Review NGB";
    if (/ongoing|open|in progress|investigat/.test(l)) return "Investigation Ongoing";
    return s;
  }
  function parseTime(v) { // returns hour 0-23 or null
    if (v == null || v === "") return null;
    if (typeof v === "number") { if (v >= 0 && v < 1) return Math.floor(v * 24 + 1e-6); if (v >= 0 && v <= 2359 && Number.isInteger(v)) return Math.floor(v / 100) <= 23 ? Math.floor(v / 100) : null; if (v > 1) return Math.floor((v % 1) * 24 + 1e-6); return null; }
    if (v instanceof Date) return v.getHours();
    var s = String(v).trim(), m;
    if ((m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i))) { var h = +m[1]; if (m[3]) { var pm = /p/i.test(m[3]); h = h % 12 + (pm ? 12 : 0); } return h <= 23 ? h : null; }
    if ((m = s.match(/^(\d{3,4})(?:\s*hrs?)?$/i))) { var hh = Math.floor(+m[1] / 100); return hh <= 23 ? hh : null; }
    if ((m = s.match(/^(\d{1,2})\s*([ap])\.?m\.?$/i))) { var h2 = +m[1] % 12 + (/p/i.test(m[2]) ? 12 : 0); return h2; }
    return null;
  }
  function fmtDate(d) { if (!d) return ""; return pad(d.getDate()) + "-" + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + "-" + String(d.getFullYear()).slice(2); }
  function iso(d) { return d ? d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) : ""; }
  function text(v) {
    if (v == null) return "";
    if (v instanceof Date) return fmtDate(v);
    return String(v).replace(/\u00a0/g, " ").trim();
  }

  // Map a header row to keys. Returns {map: [colIndex -> key|null], matched, missing, extra, dupes}
  function mapHeaders(headers) {
    var map = [], seen = {}, extra = [], dupes = [];
    var hasMsc = headers.some(function (h) { return norm(h) === "msc"; });
    headers.forEach(function (h, i) {
      var n = norm(h), k = ALIAS[n] || null;
      if (k === "msc" && hasMsc && n === "tech") { dupes.push(String(h).trim() + " (MSC column used instead)"); k = null; }
      else if (k && seen[k] != null) { dupes.push(String(h).trim()); k = null; }
      else if (!k && String(h).trim() !== "" && !/^__empty/i.test(String(h))) extra.push(String(h).trim());
      if (k) seen[k] = i;
      map.push(k);
    });
    var matched = COLUMNS.filter(function (c) { return seen[c[0]] != null; }).map(function (c) { return c[0]; });
    var optional = COLUMNS.filter(function (c) { return c[5] && seen[c[0]] != null; }).map(function (c) { return c[1]; });
    var missing = REQUIRED.filter(function (c) { return seen[c[0]] == null; }).map(function (c) { return c[1] + (c[0] === "msc" ? " / MSC" : ""); });
    return { map: map, matched: matched, requiredMatched: matched.filter(function (k) { return !BYKEY[k][5]; }).length, optional: optional, missing: missing, extra: extra, dupes: dupes };
  }
  var KEY_FIELDS = ["accident_no", "ccir", "asmis", "uic", "msc", "battalion", "date", "status", "summary", "subtype", "cause"];
  function scoreRow(r) { return (r || []).reduce(function (n, h) { return n + (ALIAS[norm(h)] ? 1 : 0); }, 0); }

  // aoa: array of arrays (first rows may be a title block). asOf: Date used for computed ages.
  function parseTable(aoa, asOf) {
    var hi = 0, best = -1;
    for (var i = 0; i < Math.min(aoa.length, 20); i++) { var s = scoreRow(aoa[i]); if (s > best) { best = s; hi = i; } }
    var headers = (aoa[hi] || []).map(function (h) { return h == null ? "" : h; });
    var hm = mapHeaders(headers);
    var rep = { headerRow: hi + 1, totalColumns: REQUIRED.length, requiredMatched: hm.requiredMatched, optional: hm.optional, matched: hm.matched, missing: hm.missing, extra: hm.extra, dupes: hm.dupes,
      rowsRead: 0, rowsLoaded: 0, blankRows: 0, badDate: [], badNumber: 0, badNumberExamples: [], otherClass: 0, otherClassValues: [], unclassified: 0, computedOverdue: 0, computedDue: 0, fatal: null };
    if (hm.matched.indexOf("date") < 0) { rep.fatal = "No Accident Date column was found, so the file cannot be charted. Check that the first sheet is the ASMIS export and that its header row is intact."; return { records: [], report: rep }; }
    var records = [], today = asOf || new Date();
    for (var r = hi + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      var raw = {}, rec = { _row: r + 1 };
      hm.map.forEach(function (k, ci) { if (!k) return; raw[k] = row[ci]; });
      // silently skip blank rows and rows where every key field is empty (e.g. formula rows below the data)
      if (KEY_FIELDS.every(function (k) { return blankish(raw[k]); })) { rep.blankRows++; continue; }
      rep.rowsRead++;
      COLUMNS.forEach(function (c) {
        var k = c[0], t = c[2], v = raw[k], out;
        if (!(k in raw)) { rec[k] = null; return; }
        if (t === "date") out = parseDate(v);
        else if (t === "int" || t === "num" || t === "money") {
          out = parseNum(v);
          if (out !== null && isNaN(out)) { rep.badNumber++; if (rep.badNumberExamples.length < 5) rep.badNumberExamples.push({ row: r + 1, column: headers[hm.map.indexOf(k)], value: text(v) }); out = null; }
        }
        else if (t === "yn") out = parseYN(v);
        else if (t === "class") out = parseClass(v);
        else if (t === "status") out = parseStatus(v);
        else if (t === "time") out = parseTime(v);
        else out = blankish(v) ? null : (text(v) || null);
        rec[k] = out;
        rec["_t_" + k] = (t === "date" && out) ? fmtDate(out) : (t === "money" && out != null) ? "$" + out.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : text(v);
      });
      if (!rec.date) { rep.badDate.push({ row: r + 1, value: blankish(raw.date) ? "" : text(raw.date) }); continue; }
      if (rec.cls === "Unclassified") rep.unclassified++;
      else if (rec.cls != null && CLASS_ORDER.indexOf(rec.cls) < 0) { rep.otherClass++; if (rep.otherClassValues.indexOf(rec.cls) < 0) rep.otherClassValues.push(rec.cls); }
      rec.clsLabel = classLabel(rec.cls);
      if (!rec.due) { rec.due = new Date(rec.date.getTime() + 90 * 864e5); rec._dueComputed = true; rep.computedDue++; }
      rec.open = rec.status ? rec.status !== "Final" : !rec.compl;
      var endRef = rec.open ? today : (rec.compl || today);
      if (rec.acc_age == null) rec.acc_age = Math.max(0, Math.round((today - rec.date) / 864e5));
      if (rec.overdue == null) {
        rec.overdue = rec.open ? Math.max(0, Math.round((today - rec.due) / 864e5)) : 0;
        if (rec.open) rep.computedOverdue++;
      }
      rec.isOverdue = rec.open && rec.overdue > 0;
      rec.daysToDue = Math.round((rec.due - today) / 864e5);
      if (rec.c_injury == null && ["c_away", "c_hosp", "c_ppd", "c_ptd", "c_fat"].some(function (k) { return rec[k] != null; }))
        rec.c_injury = ["c_away", "c_hosp", "c_ppd", "c_ptd", "c_fat"].reduce(function (s, k) { return s + (rec[k] || 0); }, 0);
      rec.hasEcod = rec.ecod != null && rec.ecod > 0;
      if (rec.c_total == null && (rec.c_injury != null || rec.ecod != null)) rec.c_total = (rec.c_injury || 0) + (rec.ecod || 0);
      if (!rec.dow && rec.date) rec.dow = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][rec.date.getDay()];
      var dm = String(rec.dow || "").slice(0, 3).toLowerCase(); rec.dowIdx = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(dm);
      var y = rec.date.getFullYear(), mo = rec.date.getMonth(); rec.fy = mo >= 9 ? y + 1 : y; rec.fyMonth = (mo + 3) % 12; rec.month = y + "-" + pad(mo + 1);
      records.push(rec);
    }
    rep.rowsLoaded = records.length;
    return { records: records, report: rep };
  }

  function objectsToAoa(headers, rows) { return [headers].concat(rows.map(function (o) { return headers.map(function (h) { return o[h]; }); })); }

  function sheetAoa(ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: true }); }

  // Reads a File. cb(err, {aoa, sheetName, strength})
  function readFile(file, cb) {
    var reader = new FileReader(), isCsv = /\.csv$/i.test(file.name);
    reader.onload = function (e) {
      try {
        var wb = isCsv ? XLSX.read(e.target.result, { type: "string", raw: true }) : XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: false });
        var names = wb.SheetNames, pick = names[0], bestScore = -1;
        names.forEach(function (n) { if (/^strength$/i.test(n.trim())) return; var a = sheetAoa(wb.Sheets[n]).slice(0, 20), s = Math.max.apply(null, [0].concat(a.map(scoreRow))); if (s > bestScore) { bestScore = s; pick = n; } });
        var strength = null, sn = names.filter(function (n) { return /^strength$/i.test(n.trim()); })[0];
        if (sn) {
          var srows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "", raw: true });
          strength = srows.map(function (o) { var l = {}; Object.keys(o).forEach(function (k) { l[norm(k)] = o[k]; });
            return { msc: text(l.msc || l.tech || ""), battalion: text(l.battalion || l.bn || ""), assigned: parseNum(l.assigned || l.strength || l["assigned strength"]) }; })
            .filter(function (s) { return s.battalion && s.assigned > 0; });
          if (!strength.length) strength = null;
        }
        cb(null, { aoa: sheetAoa(wb.Sheets[pick]), sheetName: isCsv ? file.name : pick, sheetCount: names.length, strength: strength });
      } catch (err) { cb(err); }
    };
    reader.onerror = function () { cb(new Error("Could not read the file.")); };
    if (isCsv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  }

  w.ASMIS = { COLUMNS: COLUMNS, REQUIRED: REQUIRED, CLASS_ORDER: CLASS_ORDER, classLabel: classLabel, blankish: blankish, BYKEY: BYKEY, norm: norm, mapHeaders: mapHeaders, parseTable: parseTable, objectsToAoa: objectsToAoa, readFile: readFile,
    parseDate: parseDate, parseNum: parseNum, parseYN: parseYN, parseClass: parseClass, parseStatus: parseStatus, parseTime: parseTime, fmtDate: fmtDate, iso: iso };
})(window);
