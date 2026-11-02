/* Incident Trends & Prevention dashboard. Reads incident and headcount files locally with SheetJS; nothing is uploaded.
   Personal identifier columns (names, SSN, DoD ID / EDIPI, date of birth) are skipped by header and never read.
   Any group with fewer than MIN_N incidents is shown as "<5" and left out of rankings and the GenAI pack. */
(function () {
  "use strict";
  var K = window.DashKit, $ = K.$, esc = K.esc;
  var MIN_N = 5, BLANK = "(blank)", PAGE = 100, MAXROWS = 5000, TOPN = 12;
  var MON = K.MON, FY_MON = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  var C1 = "#5aa6e6", C2 = "#e3b34c", C3 = "#e0645c", C4 = "#a9c16a", CL = "#f0d595";
  var FY_COLORS = ["#7d8ea6", "#a9c16a", "#c9a27e", "#e3b34c", "#5aa6e6", "#e0645c"];

  // ---------- header + cell helpers ----------
  function decodeX(h) { return String(h == null ? "" : h).replace(/_x([0-9a-fA-F]{4})_/g, function (m, x) { return String.fromCharCode(parseInt(x, 16)); }); }
  function norm(h) { return decodeX(h).replace(/\u00a0/g, " ").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  function txt(v) { return v == null ? "" : String(v).replace(/\u00a0/g, " ").trim(); }
  function blankish(v) {
    if (v == null) return true;
    if (typeof v === "number") return !isFinite(v);
    var s = txt(v);
    return !s || /^#(ref!|n\/a|value!|div\/0!|name\?|null!|num!|spill!|calc!)$/i.test(s) || /^\(?\s*blank\s*\)?$/i.test(s) || /^(n\/a|null|none|-)$/i.test(s);
  }
  function val(v) { return blankish(v) ? "" : typeof v === "number" ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : txt(v); }
  function num(v) { if (blankish(v)) return null; if (typeof v === "number") return v; var x = parseFloat(txt(v).replace(/,/g, "")); return isFinite(x) ? x : NaN; }
  function plural(x, w) { return K.fmt(x) + " " + w + (x === 1 ? "" : "s"); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : null; }
  function pctS(a, b) { var p = pct(a, b); return p == null ? "\u2014" : p + "%"; }
  function cnt(n) { return n > 0 && n < MIN_N ? "<" + MIN_N : K.fmt(n); }
  function cmpVal(a, b) { var na = +a, nb = +b; if (a !== "" && b !== "" && isFinite(na) && isFinite(nb)) return na - nb; return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" }); }

  // Personal identifiers: skipped by header alone; their cells are never read.
  var PII_EXACT = /^(name|names|fullname|firstname|lastname|middlename|middleinitial|mi|fname|lname|first|last|surname|givenname|soldiername|membername|personname|servicemembername|employeename|lastfirst|namelastfirst|rankname|ssn|ssan|social|dob|edipi|edipn|dodid)$/;
  function isPii(h) {
    var s = decodeX(h).toLowerCase(), n = norm(h);
    if (PII_EXACT.test(n)) return true;
    if (/social\s*_?security|ssn|ssan|dod\s*_?id|dodid|edipi|edipn|birth|e-?mail|phone|street|address/.test(s)) return true;
    return s.split(/[^a-z0-9]+/).some(function (t) { return t === "dob" || t === "name" || t === "names" || t === "ssn"; }) && !/^(unit|armory|location|program|course|company)/.test(n);
  }

  // ---------- columns ----------
  // [key, shown as, aliases (normalized), used for]
  var COLS = [
    ["ty", "TY", ["ty", "year", "calendaryear", "cy", "incidentyear"], "Detail table (the federal fiscal year is worked out from the DTG)"],
    ["grade", "Grade", ["grade", "paygrade", "rank", "rankgrade"], "Chart, filter, heat maps, rates"],
    ["date", "DTG of Incident", ["dtgofincident", "dtg", "incidentdtg", "dtgincident", "datetimegroup", "dtgofevent", "incidentdate", "date", "dateofincident", "eventdate", "offensedate", "incidentdatetime"], "Required: date, weekday and hour; fiscal year, month, quarter; holiday / payday windows"],
    ["loc", "Location", ["location", "armory", "locationarmory", "readinesscenter", "station", "city"], "Chart, filter, heat maps, rates"],
    ["duty", "Duty Status", ["dutystatus", "dutystays", "dutystaus", "dutystat", "duty", "onoffduty"], "Chart, filter, heat map"],
    ["age", "Age", ["age", "ageatincident", "ageattimeofincident"], "Age band chart, filter, heat map"],
    ["gender", "Gender", ["gender", "sex"], "Chart, filter, rates"],
    ["unit", "Unit", ["unit", "unitname", "company", "organization", "org"], "Chart, filter, heat map, rates (matches the headcount)"],
    ["pid", "Person ID", ["personid", "pid", "pseudoid", "pseudonymousid", "memberid", "recordid", "participantid", "caseid", "id"], "Optional: unique people, repeat rate (pseudonymous ID only)"],
    ["status", "Status", ["status", "dutytype", "membershipstatus", "component", "category", "personnelcategory", "tsagrtech"], "Optional: chart, filter (Traditional, AGR, Technician)"],
    ["mos", "MOS", ["mos", "pmos", "primarymos", "dmos", "aoc", "specialty"], "Optional: detail table, search"],
    ["tis", "Time in Service (yrs)", ["timeinservice", "timeinserviceyrs", "timeinserviceyears", "yearsofservice", "yos", "tis"], "Optional: correlations (service band)"],
    ["marital", "Marital Status", ["maritalstatus", "marital"], "Optional: chart, filter, heat map"],
    ["deps", "Dependents", ["dependents", "numberofdependents", "numdependents", "dependentcount"], "Optional: correlations"],
    ["type", "Incident Type", ["incidenttype", "type", "offensetype", "incidentcategory"], "Optional: chart, filter"],
    ["msd", "Months Since Deployment", ["monthssincedeployment", "monthssincelastdeployment", "monthssinceredeployment", "monthssincedeploy", "monthspostdeployment"], "Optional: chart, filter (blank = never deployed)"],
    ["prior", "Prior Incidents", ["priorincidents", "previousincidents", "priorincidentcount", "prior"], "Optional: correlations"],
    ["ref", "Referred to Treatment", ["referredtotreatment", "referred", "referral", "referredtoprogram", "referredtoasap"], "Optional: % referred, repeat by treatment"],
    ["comp", "Completed Program", ["completedprogram", "completed", "programcompleted", "completedtreatment"], "Optional: % completed, repeat by treatment"],
    ["rep", "Repeat Incident", ["repeatincident", "repeat", "repeatoffense", "recidivism", "reoffended"], "Optional: repeat rate"],
    ["out", "Outcome", ["outcome", "disposition", "result", "action"], "Optional: detail table"]
  ];
  var LABEL = {}; COLS.forEach(function (c) { LABEL[c[0]] = c[1]; });
  var RCOLS = [["unit", "Unit", ["unit", "unitname", "company"]], ["loc", "Location", ["location", "armory", "readinesscenter", "city"]], ["grade", "Grade", ["grade", "paygrade", "rank"]],
    ["gender", "Gender", ["gender", "sex"]], ["ageBand", "Age Band", ["ageband", "agegroup", "agerange"]], ["count", "Count", ["count", "headcount", "assigned", "strength", "personnel", "number", "n", "total"]]];
  function aliasMap(cols) { var m = {}; cols.forEach(function (c) { m[norm(c[1])] = c[0]; c[2].forEach(function (a) { if (!m[a]) m[a] = c[0]; }); }); return m; }
  var ALIAS = aliasMap(COLS), RALIAS = aliasMap(RCOLS);

  // ---------- value normalizers ----------
  var RANKS = { PVT: "E-1", PV1: "E-1", PV2: "E-2", PFC: "E-3", SPC: "E-4", CPL: "E-4", SGT: "E-5", SSG: "E-6", SFC: "E-7", MSG: "E-8", "1SG": "E-8", SGM: "E-9", CSM: "E-9",
    WO1: "W-1", CW2: "W-2", CW3: "W-3", CW4: "W-4", CW5: "W-5", "2LT": "O-1", "1LT": "O-2", CPT: "O-3", MAJ: "O-4", LTC: "O-5", COL: "O-6", BG: "O-7", MG: "O-8" };
  function normGrade(v) {
    var s = val(v).toUpperCase().replace(/\s+/g, ""); if (!s) return "";
    var m = s.match(/^([EWO])-?0?(\d{1,2})$/); if (m) return m[1] + "-" + (+m[2]);
    return RANKS[s.replace(/\./g, "")] || val(v);
  }
  function gradeKey(g) { var m = /^([EWO])-(\d+)$/.exec(g); return m ? ({ E: 0, W: 100, O: 200 })[m[1]] + +m[2] : 999; }
  function normStatus(v) {
    var s = val(v), l = s.toLowerCase().replace(/[^a-z]/g, ""); if (!s) return "";
    if (/^(ts|traditional|mday|m|drilling|drillstatus|traditionalmday|dsg|tradmday)/.test(l)) return "Traditional (M-Day)";
    if (/^agr|activeguard/.test(l)) return "AGR";
    if (/^(tech|mil|dualstatus|dst)/.test(l)) return "Technician";
    return s;
  }
  function normGender(v) { var s = val(v).toLowerCase(); return !s ? "" : /^m(ale)?$/.test(s) ? "Male" : /^f(emale)?$/.test(s) ? "Female" : val(v); }
  function yn(v) {
    if (typeof v === "boolean") return v ? "Y" : "N";
    var s = val(v).toLowerCase(); if (!s) return "";
    if (/^(y|yes|true|1|x|completed|complete)$/.test(s)) return "Y";
    if (/^(n|no|false|0|not completed|incomplete)$/.test(s)) return "N";
    return "";
  }
  function normDuty(v) {
    var s = val(v), l = s.toLowerCase(); if (!s) return "";
    if (/^at$|annual/.test(l)) return "AT"; if (/drill|idt|uta|mut/.test(l)) return "Drill";
    if (/off/.test(l)) return "Off Duty"; if (/on/.test(l)) return "On Duty"; return s;
  }
  function normType(v) {
    var s = val(v), l = s.toLowerCase(); if (!s) return "";
    if (/dui|dwi|owi|impaired driv/.test(l)) return "DUI"; if (/underage|minor/.test(l)) return "Underage Drinking";
    if (/public|drunk|intox/.test(l)) return "Public Intoxication"; if (/duty/.test(l)) return "Duty-Related";
    if (/self/.test(l)) return "Self-Referral"; return /^other/.test(l) ? "Other" : s;
  }
  function normBand(v) { return val(v).replace(/\s*(?:to|[\u2013\u2014-])\s*/g, "-").replace(/\s+/g, ""); }
  function utc(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
  // Date + time from a military DTG (021430ZNOV26, 021430Z NOV 26, 021430NOV2026), an Excel serial (fraction = time),
  // ISO (2026-11-02 or 2026-11-02T14:30) or m/d/y with optional time. Returns {d, h, mi}, null for blank, false for unreadable.
  var MON_UP = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function okDate(y, m, d) { var x = utc(y, m, d); return m >= 1 && m <= 12 && x.getUTCDate() === d && x.getUTCMonth() === m - 1 ? x : null; }
  function when(y, m, d, h, mi) { var x = okDate(y, m, d); if (!x) return false; if (h != null && (h > 23 || mi > 59)) return false; return { d: x, h: h == null ? null : h, mi: h == null ? null : mi || 0 }; }
  function hm12(h, ap) { h = +h; if (ap) { ap = ap.toUpperCase(); if (ap === "PM" && h < 12) h += 12; if (ap === "AM" && h === 12) h = 0; } return h; }
  function parseWhen(v) {
    if (blankish(v)) return null;
    if (v instanceof Date) return isNaN(v) ? false : when(v.getFullYear(), v.getMonth() + 1, v.getDate(), v.getHours() || v.getMinutes() ? v.getHours() : null, v.getMinutes());
    if (typeof v === "number") {
      if (v < 1 || v > 80000) return false;
      var day = Math.floor(v), fr = v - day, d0 = new Date(Math.round((day - 25569) * 864e5)), mins = Math.round(fr * 1440);
      return when(d0.getUTCFullYear(), d0.getUTCMonth() + 1, d0.getUTCDate(), fr > 1e-9 && mins < 1440 ? Math.floor(mins / 60) : null, mins % 60);
    }
    var s = txt(v), c = s.toUpperCase().replace(/[\s.]+/g, ""), m;
    if ((m = c.match(/^(\d{2})(\d{2})(\d{2})([A-Z])?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})$/))) {
      var y = +m[6]; if (y < 100) y += 2000; return when(y, MON_UP.indexOf(m[5]) + 1, +m[1], +m[2], +m[3]);
    }
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/))) return when(+m[1], +m[2], +m[3], m[4] == null ? null : +m[4], +m[5]);
    if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?\s*$/i))) {
      var yy = +m[3]; if (yy < 100) yy += 2000; return when(yy, +m[1], +m[2], m[4] == null ? null : hm12(m[4], m[6]), +m[5]);
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) return parseWhen(+s);
    var t = new Date(s); if (isNaN(t)) return false;
    var tm = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    return when(t.getFullYear(), t.getMonth() + 1, t.getDate(), tm ? hm12(tm[1], tm[3]) : null, tm ? +tm[2] : 0);
  }
  function iso(d) { return d.toISOString().slice(0, 10); }

  // ---------- calendar: holidays and paydays ----------
  function nthWd(y, m, wd, n) { var d = utc(y, m, 1), off = (wd - d.getUTCDay() + 7) % 7; return utc(y, m, 1 + off + 7 * (n - 1)); }
  function lastWd(y, m, wd) { var d = utc(y, m + 1, 0), off = (d.getUTCDay() - wd + 7) % 7; return utc(y, m, d.getUTCDate() - off); }
  var HOLS = {};
  function holidays(y) {
    if (HOLS[y]) return HOLS[y];
    return (HOLS[y] = [["New Year", utc(y, 1, 1)], ["MLK Day", nthWd(y, 1, 1, 3)], ["Presidents Day", nthWd(y, 2, 1, 3)], ["St. Patrick's Day", utc(y, 3, 17)],
      ["Memorial Day", lastWd(y, 5, 1)], ["Juneteenth", utc(y, 6, 19)], ["July 4th", utc(y, 7, 4)], ["Labor Day", nthWd(y, 9, 1, 1)], ["Columbus Day", nthWd(y, 10, 1, 2)],
      ["Veterans Day", utc(y, 11, 11)], ["Thanksgiving", nthWd(y, 11, 4, 4)], ["Christmas", utc(y, 12, 25)]]);
  }
  var DAYMS = 864e5;
  function nearHoliday(d) {
    var y = d.getUTCFullYear(), best = null;
    [y - 1, y, y + 1].forEach(function (yy) { holidays(yy).forEach(function (h) { var dd = Math.abs(d - h[1]) / DAYMS; if (dd <= 3 && (!best || dd < best.dd)) best = { name: h[0], dd: dd }; }); });
    return best ? best.name : "";
  }
  function isPayday(d) { var x = d.getUTCDate(); return (x >= 1 && x <= 4) || (x >= 15 && x <= 18); }
  var WIN = ["Holiday + payday", "Holiday (\u00b13 days)", "Payday (0\u20133 days after)", "Neither"];
  function winOf(d) { var h = !!nearHoliday(d), p = isPayday(d); return h && p ? WIN[0] : h ? WIN[1] : p ? WIN[2] : WIN[3]; }

  // ---------- bands ----------
  var AGE_B = ["17-20", "21-24", "25-29", "30-39", "40+"];
  function ageBand(a) { return a == null || isNaN(a) ? "" : a <= 20 ? "17-20" : a <= 24 ? "21-24" : a <= 29 ? "25-29" : a <= 39 ? "30-39" : "40+"; }
  var MSD_B = ["0\u20136 months", "7\u201312 months", "13\u201324 months", "25+ months", "Never deployed"];
  function msdBand(m) { return m == null ? MSD_B[4] : isNaN(m) ? "" : m <= 6 ? MSD_B[0] : m <= 12 ? MSD_B[1] : m <= 24 ? MSD_B[2] : MSD_B[3]; }
  var TIS_B = ["Under 2 yrs", "2\u20135 yrs", "6\u201310 yrs", "11\u201320 yrs", "Over 20 yrs"];
  function tisBand(t) { return t == null || isNaN(t) ? "" : t < 2 ? TIS_B[0] : t <= 5 ? TIS_B[1] : t <= 10 ? TIS_B[2] : t <= 20 ? TIS_B[3] : TIS_B[4]; }
  var Q_L = ["Q1 (Oct\u2013Dec)", "Q2 (Jan\u2013Mar)", "Q3 (Apr\u2013Jun)", "Q4 (Jul\u2013Sep)"];
  var DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var TOD = ["0000\u20130259", "0300\u20130559", "0600\u20130859", "0900\u20131159", "1200\u20131459", "1500\u20131759", "1800\u20132059", "2100\u20132359"];
  var TREAT = ["Completed program", "Referred, not completed", "Not referred"];
  function gradeGroup(g) { var k = gradeKey(g); return k <= 4 ? "E-1 to E-4" : k <= 6 ? "E-5 to E-6" : k <= 9 ? "E-7 to E-9" : k < 999 ? "Officer / Warrant" : ""; }

  // ---------- sources ----------
  function aoaSource(aoa) { var wd = 0; aoa.forEach(function (r) { if (r && r.length > wd) wd = r.length; }); return { rows: aoa.length, cols: wd, get: function (r, c) { var row = aoa[r]; return row ? row[c] : null; } }; }
  function sheetSource(ws) {
    if (!ws || !ws["!ref"]) return { rows: 0, cols: 0, get: function () { return null; } };
    var rg = XLSX.utils.decode_range(ws["!ref"]), r0 = rg.s.r, c0 = rg.s.c;
    return { rows: rg.e.r - r0 + 1, cols: rg.e.c - c0 + 1, get: function (r, c) { var cell = ws[XLSX.utils.encode_cell({ r: r + r0, c: c + c0 })]; return !cell || cell.t === "e" ? null : cell.v; } }; // error cells = blank
  }
  function mapHeaders(src, alias) {
    var hi = 0, best = -1;
    for (var r = 0; r < Math.min(src.rows, 20); r++) {
      var sc = 0; for (var c = 0; c < src.cols; c++) { var h = src.get(r, c); if (h != null && h !== "" && !isPii(h) && alias[norm(h)]) sc++; }
      if (sc > best) { best = sc; hi = r; }
    }
    var map = {}, extra = [], dupes = [], pii = [];
    for (var ci = 0; ci < src.cols; ci++) {
      var hv = src.get(hi, ci); if (hv == null || txt(hv) === "") continue;
      if (isPii(hv)) { pii.push(txt(decodeX(hv))); continue; }               // header only; no cell in this column is read
      var k = alias[norm(hv)];
      if (!k) { extra.push(txt(decodeX(hv))); continue; }
      if (map[k] != null) { dupes.push(txt(decodeX(hv))); continue; }
      map[k] = ci;
    }
    return { hi: hi, map: map, extra: extra, dupes: dupes, pii: pii, score: Math.max(best, 0) };
  }
  function classify(src) {
    var a = mapHeaders(src, ALIAS), b = mapHeaders(src, RALIAS);
    if (b.map.count != null && (b.map.unit != null || b.map.grade != null) && a.map.date == null) return { kind: "roster", score: b.score };
    if (a.map.date != null && a.score >= 3) return { kind: "incidents", score: a.score };
    return { kind: null, score: 0 };
  }

  // ---------- parsing ----------
  function parseIncidents(src) {
    var hm = mapHeaders(src, ALIAS), map = hm.map;
    var rep = { kind: "incidents", headerRow: hm.hi + 1, matched: COLS.filter(function (c) { return map[c[0]] != null; }).map(function (c) { return c[1]; }),
      missing: COLS.filter(function (c) { return map[c[0]] == null; }).map(function (c) { return c[1]; }), extra: hm.extra, dupes: hm.dupes, pii: hm.pii,
      rowsRead: 0, rowsLoaded: 0, blankRows: 0, withTime: 0, badDate: 0, badDateEx: [], badNum: 0, fatal: null };
    if (map.date == null) { rep.fatal = "No DTG of Incident (or Incident Date) column was found, so trends cannot be built. The file was not loaded."; return { records: [], report: rep }; }
    var keys = Object.keys(map), out = [];
    for (var rr = hm.hi + 1; rr < src.rows; rr++) {
      var raw = {}, empty = true;
      keys.forEach(function (k) { var v = src.get(rr, map[k]); raw[k] = v; if (!blankish(v)) empty = false; });
      if (empty) { rep.blankRows++; continue; }
      rep.rowsRead++;
      var w = parseWhen(raw.date);
      if (!w) { rep.badDate++; if (rep.badDateEx.length < 5) rep.badDateEx.push({ row: rr + 1, value: txt(raw.date) }); continue; }
      var d = w.d;
      if (w.h != null) rep.withTime++;
      var rec = { _row: rr + 1, d: d, date: iso(d), hour: w.h, min: w.mi, ty: val(raw.ty), pid: val(raw.pid), gender: normGender(raw.gender), loc: val(raw.loc), unit: val(raw.unit), status: normStatus(raw.status),
        grade: normGrade(raw.grade), mos: val(raw.mos), marital: val(raw.marital), type: normType(raw.type), duty: normDuty(raw.duty),
        ref: yn(raw.ref), comp: yn(raw.comp), rep: yn(raw.rep), out: val(raw.out) };
      ["age", "tis", "deps", "msd", "prior"].forEach(function (k) { var x = k in raw ? num(raw[k]) : null; if (x !== null && isNaN(x)) { rep.badNum++; x = k === "msd" ? NaN : null; } rec[k] = x; });
      if (!("msd" in raw)) rec.msd = undefined;
      derive(rec); out.push(rec);
    }
    rep.rowsLoaded = out.length;
    return { records: out, report: rep };
  }
  function derive(r) {
    var d = r.d, y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    r.fyN = m >= 10 ? y + 1 : y; r.fy = "FY" + String(r.fyN).slice(2); r.fmN = (m + 2) % 12 + 1; r.fm = FY_MON[r.fmN - 1];
    r.q = Q_L[Math.floor((r.fmN - 1) / 3)]; r.ym = y * 12 + m - 1;
    r.ageBand = ageBand(r.age); r.msdBand = r.msd === undefined ? "" : msdBand(r.msd); r.tisBand = tisBand(r.tis);
    r.win = winOf(d); r.hol = nearHoliday(d); r.gg = gradeGroup(r.grade);
    r.depsBand = r.deps == null ? "" : r.deps === 0 ? "No dependents" : r.deps <= 2 ? "1\u20132 dependents" : "3+ dependents";
    r.priorBand = r.prior == null ? "" : r.prior === 0 ? "No prior incidents" : r.prior === 1 ? "1 prior incident" : "2+ prior incidents";
    r.dow = DOW[(d.getUTCDay() + 6) % 7]; r.tod = r.hour == null ? "" : TOD[Math.floor(r.hour / 3)];
    r.time = r.hour == null ? "" : ("0" + r.hour).slice(-2) + ("0" + r.min).slice(-2);
    r.when = r.date + (r.hour == null ? "" : "T" + ("0" + r.hour).slice(-2) + ":" + ("0" + r.min).slice(-2));
    r.treat = r.ref === "Y" ? (r.comp === "Y" ? TREAT[0] : TREAT[1]) : r.ref === "N" ? TREAT[2] : "";
  }
  function parseRoster(src) {
    var hm = mapHeaders(src, RALIAS), map = hm.map, rows = [];
    var rep = { kind: "roster", headerRow: hm.hi + 1, matched: RCOLS.filter(function (c) { return map[c[0]] != null; }).map(function (c) { return c[1]; }),
      missing: RCOLS.filter(function (c) { return map[c[0]] == null; }).map(function (c) { return c[1]; }), extra: hm.extra, dupes: hm.dupes, pii: hm.pii, rowsRead: 0, badCount: 0, fatal: null };
    if (map.count == null) { rep.fatal = "No Count column was found."; return { rows: [], report: rep }; }
    for (var r = hm.hi + 1; r < src.rows; r++) {
      var c = num(src.get(r, map.count)); if (c == null) continue;
      rep.rowsRead++; if (isNaN(c) || c < 0) { rep.badCount++; continue; }
      var o = { count: c };
      ["unit", "loc", "grade", "gender", "ageBand"].forEach(function (k) { if (map[k] != null) { var v = src.get(r, map[k]); o[k] = k === "grade" ? normGrade(v) : k === "gender" ? normGender(v) : k === "ageBand" ? normBand(v) : val(v); } });
      rows.push(o);
    }
    rep.dims = ["unit", "loc", "grade", "gender", "ageBand"].filter(function (k) { return map[k] != null; });
    rep.total = K.sum(rows, function (o) { return o.count; });
    return { rows: rows, report: rep };
  }

  // ---------- state ----------
  var S = { files: [], failed: null, recs: [], roster: null, source: "demo", sort: { k: "date", dir: -1 }, showAll: false, shown: [], dupRemoved: 0,
    hc: { mode: "simple", gender: false, remember: false, unit: {}, grade: {}, grid: {} } };

  function readFile(file, cb) {
    var reader = new FileReader(), isCsv = /\.csv$/i.test(file.name);
    reader.onload = function (e) {
      try {
        var wb = isCsv ? XLSX.read(e.target.result, { type: "string", raw: true }) : XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: false });
        var best = {};
        wb.SheetNames.forEach(function (nm) { var src = sheetSource(wb.Sheets[nm]), c = classify(src); if (c.kind && (!best[c.kind] || c.score > best[c.kind].score)) best[c.kind] = { score: c.score, name: nm, src: src }; });
        var out = Object.keys(best).map(function (k) { var b = best[k]; return { kind: k, sheet: isCsv ? file.name : b.name, res: k === "roster" ? parseRoster(b.src) : parseIncidents(b.src) }; });
        if (!out.length) throw new Error("No incident header row (Incident Date plus at least two other columns) or headcount header row (Unit / Grade plus Count) was found.");
        cb(null, out);
      } catch (err) { cb(err); }
    };
    reader.onerror = function () { cb(new Error("Could not read the file.")); };
    if (isCsv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  }
  function readFiles(list, cb) {
    var files = Array.prototype.slice.call(list), out = [], i = 0;
    (function next() {
      if (i >= files.length) return cb(out);
      var f = files[i++]; setBar("busy", "Reading " + i + " of " + files.length + ": " + f.name + "\u2026", 0);
      readFile(f, function (err, parts) {
        if (err) out.push({ name: f.name, kind: "unknown", error: err.message || String(err) });
        else parts.forEach(function (p) { out.push({ name: f.name + (parts.length > 1 ? " \u00b7 " + p.sheet : ""), kind: p.kind, rep: p.res.report, records: p.res.records, rows: p.res.rows }); });
        setTimeout(next, 0);
      });
    })();
  }
  function usable(e) { return !e.error && !e.rep.fatal && (e.kind === "roster" ? e.rows.length > 0 : e.records.length > 0); }
  function loadFiles(list, append) {
    if (!list || !list.length) return;
    readFiles(list, function (entries) {
      var prev = S.source === "demo" ? [] : S.files, kinds = entries.filter(function (e) { return !e.error; }).map(function (e) { return e.kind; });
      var all = (append ? prev : prev.filter(function (e) { return kinds.indexOf(e.kind) < 0; })).concat(entries);
      if (!all.some(usable)) { S.failed = entries; renderReport(); setExpanded(true, false); return; }
      S.failed = null; S.files = all; combine(); setExpanded(false);
    });
  }
  function recSig(r) { return [r.pid, r.date, r.type, r.unit, r.grade, r.age, r.duty, r.out].join("|"); }
  function combine() {
    var ok = S.files.filter(usable), inc = ok.filter(function (e) { return e.kind === "incidents"; }), ros = ok.filter(function (e) { return e.kind === "roster"; });
    var recs, seen = Object.create(null), dup = 0;
    if (inc.length) {
      recs = [];
      inc.forEach(function (e) { e.records.forEach(function (r) { r._src = e.name; var s = recSig(r); if (seen[s]) { dup++; return; } seen[s] = 1; recs.push(r); }); });
    } else recs = demoRecords();                                    // headcount only: keep showing the demo incidents
    var roster = null;
    if (ros.length) {
      roster = { files: ros.map(function (e) { return e.name; }), rows: [].concat.apply([], ros.map(function (e) { return e.rows; })) };
      roster.dims = ["unit", "loc", "grade", "gender", "ageBand"].filter(function (k) { return ros.every(function (e) { return e.rep.dims.indexOf(k) >= 0; }); });
    }
    S.dupRemoved = dup;
    applyData(recs, roster, inc.length ? (S.files.some(function (e) { return e.embedded; }) ? "saved" : "file") : "demo-roster");
    renderReport();
  }
  function demoRecords() { var D = window.PREV_DEMO; return parseIncidents(aoaSource([D.headers].concat(D.rows))).records; }
  function loadDemo() {
    var D = window.PREV_DEMO, p = parseIncidents(aoaSource([D.headers].concat(D.rows))), rp = parseRoster(aoaSource([D.roster.headers].concat(D.roster.rows)));
    S.files = []; S.failed = null; S.dupRemoved = 0;
    applyData(p.records, { files: ["Demo headcount"], rows: rp.rows, dims: rp.report.dims }, "demo"); renderReport();
  }
  function applyData(recs, roster, source) {
    recs.forEach(function (r, i) { r._i = i; });
    S.recs = recs; S.roster = roster; S.source = source; S.showAll = false; setDisclaimer(source === "file" || source === "saved");
    S.unitLoc = {}; var ul = {}; recs.forEach(function (r) { if (r.unit && r.loc) { var m = ul[r.unit] = ul[r.unit] || {}; m[r.loc] = (m[r.loc] || 0) + 1; } });
    Object.keys(ul).forEach(function (u) { var m = ul[u]; S.unitLoc[u] = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })[0]; });
    if (roster) roster.rows.forEach(function (o) { if (!o.loc && o.unit && S.unitLoc[o.unit]) o.locD = S.unitLoc[o.unit]; });
    var own = source === "file" || source === "saved";
    $("btnAdd").hidden = $("btnClear").hidden = source === "demo";
    $("btnSave").disabled = !own; $("btnSave").title = own ? "Download one offline HTML file with the " + K.fmt(recs.length) + " loaded incidents" + (roster ? " and the headcount" : "") + " built in (real data: handle per policy)" : "Load your files first";
    document.querySelectorAll("[data-req]").forEach(function (el) { el.hidden = !el.getAttribute("data-req").split(",").every(function (k) { return recs.some(function (r) { return r[k] != null && r[k] !== ""; }); }); });
    buildFilters(true); hcRender(); render();
  }
  function setDisclaimer(own) { $("dataDisclaimer").textContent = own ? "Showing data loaded from your files on this device. Nothing is uploaded." : "Data shown is fictional for demonstration. Not an official Iowa National Guard product."; }
  function resetInputs() { ["fileInput", "addInput"].forEach(function (id) { $(id).value = ""; }); }
  function clearFiles() { S.files = []; S.failed = null; resetInputs(); if (!(SAVED && loadSaved())) loadDemo(); setExpanded(false); }
  function showDemo() { S.files = []; S.failed = null; resetInputs(); loadDemo(); setExpanded(false); }

  // ---------- headcount (typed in the page) ----------
  var HC_KEY = "preventionDash.headcount";
  function hcLoadLocal() { try { var o = JSON.parse(localStorage.getItem(HC_KEY) || "null"); if (o && o.v === 1) { S.hc = o.hc; S.hc.remember = true; return true; } } catch (e) { /* storage unavailable */ } return false; }
  function hcPersist() { try { if (S.hc.remember) localStorage.setItem(HC_KEY, JSON.stringify({ v: 1, hc: S.hc })); else localStorage.removeItem(HC_KEY); } catch (e) { /* storage unavailable */ } }
  function hcNum(x) { var n = parseFloat(x); return isFinite(n) && n >= 0 ? n : null; }
  function hcUnits() { return K.uniq(S.recs.map(function (r) { return r.unit; }).filter(Boolean).concat(Object.keys(S.hc.unit), Object.keys(S.hc.grid))).sort(cmpVal); }
  function hcGrades() { return K.uniq(S.recs.map(function (r) { return r.grade; }).filter(Boolean).concat(Object.keys(S.hc.grade))).sort(function (a, b) { return gradeKey(a) - gradeKey(b) || cmpVal(a, b); }); }
  function inp(kind, a, b, v) { return '<input type="number" min="0" step="1" inputmode="numeric" data-hc="' + kind + '" data-a="' + esc(a) + '" data-b="' + esc(b) + '" value="' + (v == null ? "" : esc(v)) + '" aria-label="' + esc(a + " " + b) + '">'; }
  function hcRender() {
    var hc = S.hc, units = hcUnits(), grades = hcGrades(), h = [];
    document.querySelectorAll('input[name="hcMode"]').forEach(function (x) { x.checked = x.value === hc.mode; });
    $("hcGender").checked = !!hc.gender; $("hcGender").disabled = hc.mode === "grid"; $("hcRemember").checked = !!hc.remember;
    if (!units.length && !grades.length) { $("hcBody").innerHTML = '<p class="muted">Load an incident file first; its units and grades are listed here.</p>'; hcSummary(); return; }
    function part(title, kind, list) {
      var cols = hc.gender ? ["Male", "Female"] : ["Total"];
      return '<div><h3 class="sub">' + title + '</h3><div class="hcwrap"><table><thead><tr><th>' + (kind === "unit" ? "Unit" : "Grade") + "</th>" + cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
        list.map(function (k) { var o = hc[kind][k] || {}; return "<tr><td>" + esc(k) + "</td>" + (hc.gender ? "<td>" + inp(kind, k, "m", o.m) + "</td><td>" + inp(kind, k, "f", o.f) + "</td>" : "<td>" + inp(kind, k, "t", o.t) + "</td>") + "</tr>"; }).join("") + "</tbody></table></div></div>";
    }
    if (hc.mode === "simple") h.push('<div class="hcgrid">' + part("Assigned per unit", "unit", units) + part("Assigned per grade (whole force in the file)", "grade", grades) + "</div>");
    else {
      h.push('<div class="hcwrap"><table><thead><tr><th>Unit</th>' + grades.map(function (g) { return "<th>" + esc(g) + "</th>"; }).join("") + "<th>Total</th></tr></thead><tbody>" +
        units.map(function (u) { var o = hc.grid[u] || {}; return "<tr><td>" + esc(u) + "</td>" + grades.map(function (g) { return "<td>" + inp("grid", u, g, o[g]) + "</td>"; }).join("") + '<td class="tot">' + K.fmt(K.sum(Object.keys(o), function (g) { return hcNum(o[g]) || 0; })) + "</td></tr>"; }).join("") + "</tbody></table></div>");
      h.push('<p class="muted small">Gender split is not available in the grid; use the totals mode or a headcount file for that.</p>');
    }
    $("hcBody").innerHTML = h.join(""); hcSummary();
  }
  function hcTables() { // typed headcount as tables of {dims..., count}
    var hc = S.hc, out = [];
    function t(kind, dim) {
      var rows = [];
      Object.keys(hc[kind]).forEach(function (k) {
        var o = hc[kind][k];
        if (hc.gender) [["m", "Male"], ["f", "Female"]].forEach(function (g) { var n = hcNum(o[g[0]]); if (n != null) { var r = { count: n, gender: g[1] }; r[dim] = k; rows.push(r); } });
        else { var n = hcNum(o.t); if (n != null) { var r = { count: n }; r[dim] = k; rows.push(r); } }
      });
      if (rows.length) out.push({ name: "typed headcount per " + dim, rows: rows, dims: hc.gender ? [dim, "gender"] : [dim], typed: true });
    }
    if (hc.mode === "grid") {
      var rows = []; Object.keys(hc.grid).forEach(function (u) { Object.keys(hc.grid[u]).forEach(function (g) { var n = hcNum(hc.grid[u][g]); if (n != null) rows.push({ unit: u, grade: g, count: n }); }); });
      if (rows.length) out.push({ name: "typed headcount (unit \u00d7 grade)", rows: rows, dims: ["unit", "grade"], typed: true });
    } else { t("unit", "unit"); t("grade", "grade"); }
    out.forEach(function (tb) { if (tb.dims.indexOf("unit") >= 0) { tb.dims.push("loc"); tb.rows.forEach(function (o) { o.locD = S.unitLoc[o.unit] || ""; }); } });
    return out;
  }
  function hcSummary() { var t = hcTables(); $("hcSummary").textContent = t.length ? t.map(function (x) { return x.name + ": " + K.fmt(K.sum(x.rows, function (o) { return o.count; })); }).join(" \u00b7 ") : S.roster ? "Using the headcount file (" + S.roster.files.join(", ") + ")" : "None entered"; }
  var hcT;
  function hcInput(e) {
    var el = e.target; if (!el.getAttribute || !el.getAttribute("data-hc")) return;
    var kind = el.getAttribute("data-hc"), a = el.getAttribute("data-a"), b = el.getAttribute("data-b"), o = S.hc[kind][a] = S.hc[kind][a] || {};
    if (el.value === "") delete o[b]; else o[b] = el.value;
    if (!Object.keys(o).length) delete S.hc[kind][a];
    hcPersist(); hcSummary(); clearTimeout(hcT);
    hcT = setTimeout(function () { if (kind === "grid") { var tot = el.closest("tr").querySelector("td.tot"); if (tot) tot.textContent = K.fmt(K.sum(Object.keys(o), function (g) { return hcNum(o[g]) || 0; })); } render(); }, 250);
  }

  // ---------- denominators (headcount file first, then typed) ----------
  var POP = ["unit", "loc", "grade", "gender", "ageBand"];
  function denomTables() { var t = []; if (S.roster) t.push({ name: "headcount file", rows: S.roster.rows, dims: S.roster.dims.concat(S.roster.dims.indexOf("unit") >= 0 && S.roster.dims.indexOf("loc") < 0 ? ["loc"] : []) }); return t.concat(hcTables()); }
  function rv(o, k) { return k === "loc" ? (o.loc || o.locD || "") : (o[k] || ""); }
  // Assigned per value of dim (or the total when dim is null) under the population filters in f; null when no table covers them.
  function assigned(dim, f) {
    if (f.status || f.marital || f.msdBand) return null;                        // no headcount for these
    var need = POP.filter(function (k) { return f[k]; }); if (dim) need.push(dim);
    var tb = denomTables().filter(function (t) { return need.every(function (k) { return t.dims.indexOf(k) >= 0; }); })[0];
    if (!tb) return null;
    var m = Object.create(null), tot = 0;
    tb.rows.forEach(function (o) { for (var i = 0; i < POP.length; i++) { var k = POP[i]; if (f[k] && rv(o, k) !== f[k]) return; } tot += o.count; if (dim) { var v = rv(o, dim) || BLANK; m[v] = (m[v] || 0) + o.count; } });
    return { by: m, total: tot, src: tb.name };
  }
  function spanMonths(f) { // months covered by the time filters (for annualized rates)
    if (!S.recs.length) return 1;
    var lo = Infinity, hi = -Infinity; S.recs.forEach(function (r) { if (r.ym < lo) lo = r.ym; if (r.ym > hi) hi = r.ym; });
    var n = 0;
    for (var ym = lo; ym <= hi; ym++) {
      var y = Math.floor(ym / 12), m = ym % 12 + 1, fyN = m >= 10 ? y + 1 : y, fmN = (m + 2) % 12 + 1;
      if (f.fy && "FY" + String(fyN).slice(2) !== f.fy) continue; if (f.fm && FY_MON[fmN - 1] !== f.fm) continue; if (f.q && Q_L[Math.floor((fmN - 1) / 3)] !== f.q) continue; n++;
    }
    return Math.max(1, n);
  }
  function rate(n, a, months) { return a > 0 ? n / a * 1000 * 12 / months : null; }

  // ---------- filters ----------
  var DIMS = [["fy", "fFy", "All years"], ["q", "fQ", "All quarters"], ["fm", "fFm", "All months"], ["loc", "fLoc", "All"], ["unit", "fUnit", "All"], ["grade", "fGrade", "All"],
    ["ageBand", "fAge", "All"], ["gender", "fGender", "All"], ["status", "fStatus", "All"], ["marital", "fMarital", "All"], ["type", "fType", "All"], ["duty", "fDuty", "All"], ["msdBand", "fMsd", "All"], ["win", "fWin", "All"], ["dow", "fDow", "All days"], ["tod", "fTod", "All times"]];
  var DLABEL = { fy: "Fiscal year", q: "Quarter", fm: "Month", loc: "Location", unit: "Unit", grade: "Grade", ageBand: "Age", gender: "Gender", status: "Status", marital: "Marital status",
    type: "Incident type", duty: "Duty status", msdBand: "Since deployment", win: "Holiday / payday", hol: "Holiday", treat: "Treatment", dow: "Day of week", tod: "Time of day", ref: "Referred", comp: "Completed program", rep: "Repeat incident", tisBand: "Time in service", depsBand: "Dependents", priorBand: "Prior incidents", gg: "Grade group" };
  var ORDER = { dow: DOW, tod: TOD, fm: FY_MON, q: Q_L, ageBand: AGE_B, msdBand: MSD_B, win: WIN, tisBand: TIS_B, treat: TREAT, depsBand: ["No dependents", "1\u20132 dependents", "3+ dependents"], priorBand: ["No prior incidents", "1 prior incident", "2+ prior incidents"] };
  function sortVals(k, vals) {
    if (k === "grade") return vals.sort(function (a, b) { return gradeKey(a) - gradeKey(b) || cmpVal(a, b); });
    if (ORDER[k]) return vals.sort(function (a, b) { var x = ORDER[k].indexOf(a), y = ORDER[k].indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || cmpVal(a, b); });
    return vals.sort(cmpVal);
  }
  function dv(r, k) { var v = r[k]; return v == null || v === "" ? BLANK : v; }
  function buildFilters(reset) { DIMS.forEach(function (d) { var vals = sortVals(d[0], K.uniq(S.recs.map(function (r) { return dv(r, d[0]); })).filter(function (v) { return v !== BLANK; })); K.fillSelect($(d[1]), vals, d[2], !reset); }); }
  function F() { var f = {}; DIMS.forEach(function (d) { f[d[0]] = $(d[1]).value; }); return f; }
  function pass(r, f, skip) { for (var k in f) if (f[k] && k !== skip && dv(r, k) !== f[k]) return false; return true; }
  function rowsFor(f, skip) { return S.recs.filter(function (r) { return pass(r, f, skip); }); }

  // ---------- grouping ----------
  function group(rows, k) { var m = Object.create(null); rows.forEach(function (r) { var v = dv(r, k); m[v] = (m[v] || 0) + 1; }); return m; }
  function repeatPeople(rows) {
    var by = Object.create(null); rows.forEach(function (r) { if (!r.pid) return; var o = by[r.pid] = by[r.pid] || { n: 0, y: false }; o.n++; if (r.rep === "Y") o.y = true; });
    var p = 0, rp = 0; Object.keys(by).forEach(function (k) { p++; if (by[k].n > 1 || by[k].y) rp++; }); return { people: p, repeat: rp };
  }
  function repRate(rows) { var k = rows.filter(function (r) { return r.rep; }); return k.length ? { n: k.length, y: k.filter(function (r) { return r.rep === "Y"; }).length } : null; }

  // ---------- render ----------
  function render() {
    var f = F(), rows = rowsFor(f);
    var scope = DIMS.filter(function (d) { return f[d[0]]; }).map(function (d) { return DLABEL[d[0]] + " " + f[d[0]]; });
    $("asofLabel").textContent = cnt(rows.length) + " incident" + (rows.length === 1 ? "" : "s") + " \u00b7 " + dateRange(rows);
    $("scopeLabel").textContent = scope.length ? scope.join(" \u00b7 ") : "All incidents";
    $("sourceLabel").textContent = S.source === "file" ? " \u00b7 Your files" : S.source === "saved" ? " \u00b7 Saved data" : S.source === "demo-roster" ? " \u00b7 Demo incidents + your headcount" : " \u00b7 Demo data";
    S.an = analyze(rows, f);
    kpis(rows, f); insights();
    monthChart(f); fyChart(f);
    [["cGrade", "grade", false], ["cAge", "ageBand", false], ["cType", "type", true], ["cGender", "gender", false], ["cStatus", "status", true], ["cMarital", "marital", true],
     ["cLoc", "loc", true], ["cUnit", "unit", true], ["cDuty", "duty", false], ["cMsd", "msdBand", false], ["cWin", "win", false], ["cHol", "hol", true]].forEach(function (c) { barChart(c[0], c[1], c[2], rows, f); });
    repeatChart(rows); heatAll(rows); S.corr = correlations(rows, f); renderCorr(S.corr); commander(rows, f); S.base = rows; table();
  }
  function dateRange(rows) {
    if (!rows.length) return "no dates";
    var lo = rows[0].ym, hi = lo; rows.forEach(function (r) { if (r.ym < lo) lo = r.ym; if (r.ym > hi) hi = r.ym; });
    function l(ym) { return MON[ym % 12] + " " + Math.floor(ym / 12); } return l(lo) + (hi !== lo ? " \u2013 " + l(hi) : "");
  }
  function kpi(lbl, v, sub, cls) { v = /^<span/.test(v) || v === "&lt;5" ? v : esc(v); return '<div class="kpi ' + cls + '"><div class="lbl">' + lbl + '</div><div class="val">' + v + '</div><div class="sub">' + (sub ? esc(sub) : "&nbsp;") + "</div></div>"; }
  function trendInfo(f) {
    var base = rowsFor(f, "fy"); if (!base.length) return null;
    var fys = K.uniq(base.map(function (r) { return r.fyN; })).sort(), cur = f.fy ? 2000 + +f.fy.slice(2) : fys[fys.length - 1];
    var curR = base.filter(function (r) { return r.fyN === cur; }); if (!curR.length) return null;
    var inCur = S.recs.filter(function (r) { return r.fyN === cur; }), maxFm = Math.max.apply(null, inCur.map(function (r) { return r.fmN; }));
    var prev = base.filter(function (r) { return r.fyN === cur - 1 && r.fmN <= maxFm; });
    return { cur: cur, n: curR.length, prev: prev.length, maxFm: maxFm, hasPrev: S.recs.some(function (r) { return r.fyN === cur - 1; }), part: maxFm < 12 };
  }
  function kpis(rows, f) {
    var h = [], small = rows.length > 0 && rows.length < MIN_N, rp = repeatPeople(rows);
    var a = assigned(null, f), rt = a && a.total ? rate(rows.length, a.total, spanMonths(f)) : null;
    h.push(kpi("Total incidents", cnt(rows.length), rt != null && !small ? K.fmt(rt, 1) + " per 1,000 assigned / yr" : a ? "Headcount " + K.fmt(a.total) : "Add a headcount for rates", "inc"));
    h.push(kpi("Unique people", rp.people ? cnt(rp.people) : "\u2014", rp.people && !small ? (rows.length / rp.people).toFixed(2) + " incidents per person" : "Needs Person ID", "ppl"));
    h.push(kpi("Repeat rate", small || !rp.people ? "\u2014" : pctS(rp.repeat, rp.people), rp.people && !small ? cnt(rp.repeat) + " of " + cnt(rp.people) + " people repeated" : "", "rep"));
    var refK = rows.filter(function (r) { return r.ref; }), refY = refK.filter(function (r) { return r.ref === "Y"; }), compY = refY.filter(function (r) { return r.comp === "Y"; });
    h.push(kpi("% referred", small || !refK.length ? "\u2014" : pctS(refY.length, refK.length), refK.length && !small ? cnt(refY.length) + " of " + cnt(refK.length) + " incidents" : "", "ref"));
    h.push(kpi("% completed", small || !refY.length ? "\u2014" : pctS(compY.length, refY.length), refY.length && !small ? cnt(compY.length) + " of " + cnt(refY.length) + " referred" : "", "comp"));
    var t = trendInfo(f), tv = "\u2014", ts = "Needs two fiscal years";
    if (t && t.hasPrev) {
      if (t.n < MIN_N || t.prev < MIN_N) { tv = "&lt;5"; ts = "Too few incidents to compare"; }
      else { var d = Math.round((t.n - t.prev) / t.prev * 100); tv = '<span class="delta ' + (d > 0 ? "down" : d < 0 ? "up" : "flat") + '">' + (d > 0 ? "\u25b2 +" : d < 0 ? "\u25bc " : "") + d + "%</span>"; ts = "FY" + String(t.cur).slice(2) + " " + K.fmt(t.n) + " vs FY" + String(t.cur - 1).slice(2) + " " + K.fmt(t.prev) + (t.part ? " (Oct\u2013" + FY_MON[t.maxFm - 1] + ")" : ""); }
    }
    h.push(kpi("Trend vs prior FY", tv, ts, "trend"));
    $("kpis").innerHTML = h.join("");
  }

  // ---------- analysis: weak spots, commonalities, correlations ----------
  var RISK_DIMS = ["grade", "ageBand", "gender", "loc", "unit", "status", "marital", "msdBand", "duty", "tisBand", "depsBand", "priorBand", "type"];
  var RATE_DIMS = ["grade", "ageBand", "gender", "loc", "unit"];
  function dayCounts(f) { // calendar days per holiday/payday window within the time filters
    var lo = Infinity, hi = -Infinity; S.recs.forEach(function (r) { if (+r.d < lo) lo = +r.d; if (+r.d > hi) hi = +r.d; });
    var m = Object.create(null), tot = 0;
    for (var t = lo; t <= hi; t += DAYMS) {
      var d = new Date(t), y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, fyN = mo >= 10 ? y + 1 : y, fmN = (mo + 2) % 12 + 1;
      if (f.fy && "FY" + String(fyN).slice(2) !== f.fy) continue; if (f.fm && FY_MON[fmN - 1] !== f.fm) continue; if (f.q && Q_L[Math.floor((fmN - 1) / 3)] !== f.q) continue;
      var w = winOf(d); m[w] = (m[w] || 0) + 1; tot++;
    }
    return { by: m, total: tot };
  }
  function analyze(rows, f) {
    var N = rows.length, out = { N: N, rate: [], share: [], repeat: [], timing: [], combos: [], corr: [], hols: [], months: spanMonths(f), base: null, hasRates: false };
    if (N < MIN_N) return out;
    var all = assigned(null, f); if (all && all.total) out.base = rate(N, all.total, out.months);
    RATE_DIMS.forEach(function (k) {
      if (f[k]) return; var a = assigned(k, f); if (!a || !a.total) return;
      var g = group(rows, k), nIn = 0; Object.keys(a.by).forEach(function (v) { nIn += g[v] || 0; });
      var base = rate(nIn, a.total, out.months); if (!base) return; out.hasRates = true;
      Object.keys(g).forEach(function (v) {
        var n = g[v], as = a.by[v]; if (v === BLANK || n < MIN_N || !as || as < MIN_N) return;
        var r = rate(n, as, out.months); out.rate.push({ dim: k, v: v, n: n, assigned: as, rate: r, rr: r / base, base: base });
      });
    });
    out.rate.sort(function (a, b) { return b.rr - a.rr; });
    RISK_DIMS.forEach(function (k) {
      if (f[k]) return; var g = group(rows, k), known = N - (g[BLANK] || 0); if (known < MIN_N) return;
      Object.keys(g).forEach(function (v) { if (v !== BLANK && g[v] >= MIN_N) out.share.push({ dim: k, v: v, n: g[v], share: g[v] / known }); });
    });
    out.share.sort(function (a, b) { return b.share - a.share; });
    var R = repRate(rows);
    if (R && R.n >= MIN_N && R.y >= 1) {
      out.repBase = R.y / R.n;
      RISK_DIMS.concat(["treat"]).forEach(function (k) {
        if (f[k] || k === "type") return;
        var by = Object.create(null); rows.forEach(function (r) { if (!r.rep) return; var v = dv(r, k), o = by[v] = by[v] || { n: 0, y: 0 }; o.n++; if (r.rep === "Y") o.y++; });
        Object.keys(by).forEach(function (v) { var o = by[v]; if (v === BLANK || o.n < MIN_N || (o.y > 0 && o.y < MIN_N)) return; out.repeat.push({ dim: k, v: v, n: o.n, y: o.y, rate: o.y / o.n, rr: o.y / o.n / out.repBase }); });
      });
      out.repeat.sort(function (a, b) { return b.rr - a.rr; });
    }
    if (!f.win) {
      var dc = dayCounts(f), gw = group(rows, "win");
      var tm = function (label, n, days) { if (n >= MIN_N && days > 0 && dc.total - days > 0 && N - n > 0) out.timing.push({ v: label, n: n, days: days, share: n / N, dayShare: days / dc.total, rr: (n / days) / ((N - n) / (dc.total - days)) }); };
      tm("Holiday window (\u00b13 days)", (gw[WIN[0]] || 0) + (gw[WIN[1]] || 0), (dc.by[WIN[0]] || 0) + (dc.by[WIN[1]] || 0));
      tm("Payday window (0\u20133 days after the 1st / 15th)", (gw[WIN[0]] || 0) + (gw[WIN[2]] || 0), (dc.by[WIN[0]] || 0) + (dc.by[WIN[2]] || 0));
      tm("Fri\u2013Sun", rows.filter(function (r) { var x = r.d.getUTCDay(); return x === 0 || x >= 5; }).length, Math.round(dc.total * 3 / 7));
    }
    var tg = group(rows, "tod"), withT = N - (tg[BLANK] || 0);
    if (withT >= MIN_N * 4) {
      var night = ["1800\u20132059", "2100\u20132359", "0000\u20130259"], ns = K.sum(night, function (t) { return tg[t] || 0; });
      var dg = group(rows, "dow"), we = (dg.Fri || 0) + (dg.Sat || 0) + (dg.Sun || 0);
      if (ns / withT >= 0.4) out.peak = { tod: "1800\u20130259", share: ns / withT, days: "Fri\u2013Sun", dshare: we / N };
    }
    var hg = group(rows, "hol"); out.hols = Object.keys(hg).filter(function (v) { return v !== BLANK && hg[v] >= MIN_N; }).map(function (v) { return { v: v, n: hg[v] }; }).sort(function (a, b) { return b.n - a.n; });
    var cm = Object.create(null);
    rows.forEach(function (r) { if (!r.ageBand || !r.gg || !r.marital) return; var k = [r.gender || "", r.ageBand, r.gg, r.marital].join("|"); cm[k] = (cm[k] || 0) + 1; });
    out.combos = Object.keys(cm).filter(function (k) { return cm[k] >= MIN_N; }).map(function (k) { var p = k.split("|"); return { g: p[0], age: p[1], gg: p[2], mar: p[3], n: cm[k], share: cm[k] / N }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
    var tr = out.repeat.filter(function (x) { return x.dim === "treat"; }), comp = tr.filter(function (x) { return x.v === TREAT[0]; })[0], non = tr.filter(function (x) { return x.v !== TREAT[0]; }).sort(function (a, b) { return b.rate - a.rate; })[0];
    if (comp && non && comp.rate > 0) out.corr.push({ kind: "treat", comp: comp, non: non, ratio: non.rate / comp.rate });
    var dep = out.share.filter(function (x) { return x.dim === "msdBand" && (x.v === MSD_B[0] || x.v === MSD_B[1]); });
    if (dep.length) out.dep12 = { n: K.sum(dep, function (x) { return x.n; }), share: K.sum(dep, function (x) { return x.share; }) };
    var refK = rows.filter(function (r) { return r.ref; }); out.notRef = refK.length >= MIN_N ? refK.filter(function (r) { return r.ref === "N"; }).length / refK.length : null;
    var u21 = rows.filter(function (r) { return r.age != null && r.age < 21; }); out.u21 = u21.length >= MIN_N ? { n: u21.length, share: u21.length / N } : null;
    var off = rows.filter(function (r) { return r.duty === "Off Duty"; }).length, dk = rows.filter(function (r) { return r.duty; }).length; out.off = dk >= MIN_N && off >= MIN_N ? off / dk : null;
    var dui = rows.filter(function (r) { return r.type === "DUI"; }).length, tk = rows.filter(function (r) { return r.type; }).length; out.dui = tk >= MIN_N && dui >= MIN_N ? dui / tk : null;
    return out;
  }
  function seg(x) { return x.dim === "ageBand" ? "Soldiers aged " + x.v : x.dim === "gender" ? x.v.toLowerCase() + " Soldiers" : x.dim === "grade" ? x.v + "s" : x.v; }
  function pillRR(rr) { return '<span class="rr' + (rr >= 1.5 ? "" : rr >= 1.2 ? " mid" : " info") + '">' + rr.toFixed(1) + "\u00d7</span>"; }
  function ev(s) { return '<span class="why"><strong>Evidence:</strong> ' + s + "</span>"; }
  function why(s) { return '<span class="why">' + s + "</span>"; }
  function profile(c) { return [c.g, c.mar.toLowerCase(), c.gg, "age " + c.age].filter(Boolean).join(", "); }
  function insights() {
    var A = S.an, w = [], fo = [];
    if (A.N < MIN_N) { $("weak").innerHTML = "<li>" + (A.N ? "Fewer than 5 incidents in this selection: nothing is ranked." : "No incidents match the current filters.") + "</li>"; $("focus").innerHTML = ""; $("wsNote").textContent = ""; return; }
    $("wsNote").textContent = A.hasRates ? "Ranked by incidents per 1,000 assigned (annualized) against the overall rate" + (A.base ? " of " + K.fmt(A.base, 1) : "") + ". Groups under 5 are left out."
      : "No headcount covers this selection, so rankings use shares of incidents and repeat rates. Add a headcount (file or the Headcount panel) for true rates.";
    if (A.hasRates) A.rate.filter(function (x) { return x.rr >= 1.2; }).slice(0, 6).forEach(function (x) {
      w.push("<li>" + pillRR(x.rr) + "<strong>" + esc(DLABEL[x.dim] + " " + x.v) + "</strong>: " + K.fmt(x.rate, 1) + " incidents per 1,000 a year vs " + K.fmt(x.base, 1) + " overall" + why(K.fmt(x.n) + " incidents, " + K.fmt(x.assigned) + " assigned") + "</li>");
    });
    else A.share.filter(function (x) { return ["grade", "ageBand", "marital", "unit", "loc", "gender"].indexOf(x.dim) >= 0 && x.share >= 0.2 && x.share < 0.95; }).slice(0, 5).forEach(function (x) {
      w.push('<li><span class="rr info">' + Math.round(x.share * 100) + "%</span><strong>" + esc(DLABEL[x.dim] + " " + x.v) + "</strong> accounts for " + Math.round(x.share * 100) + "% of incidents" + why(K.fmt(x.n) + " incidents (a share, not a rate)") + "</li>");
    });
    A.timing.filter(function (x) { return x.rr >= 1.15; }).forEach(function (x) { w.push("<li>" + pillRR(x.rr) + "<strong>" + esc(x.v) + "</strong>: " + Math.round(x.share * 100) + "% of incidents on " + Math.round(x.dayShare * 100) + "% of calendar days" + why(K.fmt(x.n) + " incidents; incidents per day compared with other days") + "</li>"); });
    A.repeat.filter(function (x) { return x.dim !== "treat" && x.rr >= 1.3; }).slice(0, 3).forEach(function (x) { w.push("<li>" + pillRR(x.rr) + "<strong>Repeat risk, " + esc(DLABEL[x.dim] + " " + x.v) + "</strong>: " + Math.round(x.rate * 100) + "% of incidents followed by another vs " + Math.round(A.repBase * 100) + "% overall" + why(K.fmt(x.y) + " of " + K.fmt(x.n) + " incidents") + "</li>"); });
    A.corr.forEach(function (c) { w.push("<li>" + pillRR(c.ratio) + "<strong>Treatment</strong>: " + esc(c.non.v.toLowerCase()) + " repeat " + Math.round(c.non.rate * 100) + "% of the time vs " + Math.round(c.comp.rate * 100) + "% for those who completed the program</li>"); });
    if (A.dep12 && A.dep12.share >= 0.15) w.push('<li><span class="rr mid">' + Math.round(A.dep12.share * 100) + "%</span><strong>Post-deployment</strong>: " + Math.round(A.dep12.share * 100) + "% of incidents happen within 12 months of returning from deployment" + why(K.fmt(A.dep12.n) + " incidents") + "</li>");
    A.combos.forEach(function (c, i) { w.push('<li><span class="rr info">' + Math.round(c.share * 100) + "%</span><strong>" + (i ? "Next most common profile" : "Most common profile") + "</strong>: " + esc(profile(c)) + why(K.fmt(c.n) + " incidents") + "</li>"); });
    $("weak").innerHTML = w.length ? w.join("") : "<li>No group stands out from the baseline in this selection.</li>";
    var topR = A.hasRates ? A.rate.filter(function (x) { return x.rr >= 1.3; }) : [];
    var person = topR.filter(function (x) { return ["grade", "ageBand", "gender"].indexOf(x.dim) >= 0; }).slice(0, 2), place = topR.filter(function (x) { return x.dim === "unit" || x.dim === "loc"; }).slice(0, 2);
    var target = person.length ? person.map(seg).join(" and ") : A.combos[0] ? profile(A.combos[0]) + " Soldiers" : "the highest-count groups";
    var hol = A.timing.filter(function (x) { return /Holiday/.test(x.v); })[0], pay = A.timing.filter(function (x) { return /Payday/.test(x.v); })[0];
    if (hol && hol.rr >= 1.15) fo.push("<li><strong>Before the holidays:</strong> run safe-ride, designated-driver and leader check-in messaging in the 2 weeks before " + esc(A.hols.slice(0, 3).map(function (h) { return h.v; }).join(", ") || "major holidays") + ", aimed at " + esc(target) + "." + ev("Holiday windows carry " + hol.rr.toFixed(1) + "\u00d7 the daily incident rate.") + "</li>");
    if (place.length) fo.push("<li><strong>Unit-level focus:</strong> schedule prevention training and a command climate check at " + esc(place.map(function (x) { return x.v; }).join(" and ")) + "." + ev(place.map(function (x) { return esc(x.v) + " " + x.rr.toFixed(1) + "\u00d7 the overall rate"; }).join("; ") + ".") + "</li>");
    if (person.length) fo.push("<li><strong>Target the highest-rate groups:</strong> peer-to-peer and first-line-leader engagement for " + esc(target) + ", for example at drill in-processing and before long weekends." + ev(person.map(function (x) { return esc(DLABEL[x.dim] + " " + x.v) + " " + x.rr.toFixed(1) + "\u00d7"; }).join("; ") + ".") + "</li>");
    else if (A.combos[0]) fo.push("<li><strong>Target the most common profile:</strong> " + esc(profile(A.combos[0])) + " make up the largest group. Add a headcount to confirm whether that is a higher rate or just a larger group." + ev(Math.round(A.combos[0].share * 100) + "% of incidents (" + K.fmt(A.combos[0].n) + ") share this profile.") + "</li>");
    if (A.dep12 && A.dep12.share >= 0.15) fo.push("<li><strong>Reintegration:</strong> add alcohol screening and a leader touchpoint at 30, 90 and 180 days after redeployment." + ev(Math.round(A.dep12.share * 100) + "% of incidents are within 12 months of return.") + "</li>");
    if (A.corr[0] && A.corr[0].ratio >= 1.3) fo.push("<li><strong>Drive program completion:</strong> track every referral to completion with command follow-up at 30, 60 and 90 days." + ev("Those who did not complete repeat " + A.corr[0].ratio.toFixed(1) + "\u00d7 as often.") + "</li>");
    if (A.notRef != null && A.notRef >= 0.1) fo.push("<li><strong>Close the referral gap:</strong> make referral to the prevention / treatment program automatic after any incident." + ev(Math.round(A.notRef * 100) + "% of incidents were not referred.") + "</li>");
    if (A.peak) fo.push("<li><strong>Peak hours:</strong> put leader check-ins, safe-ride and duty-NCO coverage on " + esc(A.peak.days) + " " + esc(A.peak.tod) + "." + ev(Math.round(A.peak.share * 100) + "% of incidents with a time fall in " + esc(A.peak.tod) + "; " + esc(A.peak.days) + " carry " + Math.round(A.peak.dshare * 100) + "% of incidents.") + "</li>");
    if (pay && pay.rr >= 1.15) fo.push("<li><strong>Payday weekends:</strong> time reminders and safe-ride information with the 1st and 15th." + ev("Payday windows carry " + pay.rr.toFixed(1) + "\u00d7 the daily rate.") + "</li>");
    if (A.dui != null && A.dui >= 0.3) fo.push("<li><strong>DUI prevention:</strong> promote the safe-ride program and a no-questions-asked ride home policy." + ev("DUI is " + Math.round(A.dui * 100) + "% of incidents.") + "</li>");
    if (A.u21 && A.u21.share >= 0.1) fo.push("<li><strong>Under 21:</strong> include alcohol education in new-Soldier / RSP training and first-drill sponsorship." + ev(Math.round(A.u21.share * 100) + "% of incidents involve Soldiers under 21.") + "</li>");
    if (A.off != null && A.off >= 0.6) fo.push("<li><strong>Off-duty time:</strong> most incidents (" + Math.round(A.off * 100) + "%) are off duty, so pre-weekend safety briefs and family / peer outreach matter more than duty-time rules." + ev(Math.round(A.off * 100) + "% of incidents with a duty status were off duty.") + "</li>");
    $("focus").innerHTML = fo.length ? fo.join("") : "<li>No clear focus areas in this selection.</li>";
    S.focusTop = fo.slice(0, 3).map(function (h) { var d = document.createElement("div"); d.innerHTML = h.replace(/<span class="why">.*?<\/span>/g, ""); return d.textContent; });
  }
  function commander(rows, f) {
    var A = S.an, scope = DIMS.filter(function (d) { return f[d[0]]; }).map(function (d) { return DLABEL[d[0]] + " " + f[d[0]]; });
    $("cmdScope").textContent = (scope.length ? scope.join(" \u00b7 ") : "All incidents") + " \u00b7 " + dateRange(rows) + " \u00b7 " + (S.source === "file" || S.source === "saved" ? "loaded data" : "fictional demo data") + " \u00b7 generated " + fmtStamp(new Date());
    summary(rows, f);
    var b = [];
    if (A.N >= MIN_N) {
      var rp = repeatPeople(rows), refK = rows.filter(function (r) { return r.ref; }), refY = refK.filter(function (r) { return r.ref === "Y"; }), compY = refY.filter(function (r) { return r.comp === "Y"; });
      var top = A.hasRates ? A.rate.filter(function (x) { return x.rr >= 1.3; }).slice(0, 3).map(function (x) { return DLABEL[x.dim] + " " + x.v + " (" + x.rr.toFixed(1) + "\u00d7 the rate)"; })
        : A.share.filter(function (x) { return ["grade", "ageBand", "marital", "unit", "loc"].indexOf(x.dim) >= 0 && x.share < 0.95; }).slice(0, 3).map(function (x) { return DLABEL[x.dim] + " " + x.v + " (" + Math.round(x.share * 100) + "% of incidents)"; });
      if (top.length) b.push("<li><strong>Where:</strong> " + esc(top.join("; ")) + (A.hasRates ? "." : ". Shares only; add a headcount for rates.") + "</li>");
      var hol = A.timing.filter(function (x) { return /Holiday/.test(x.v); })[0], pay = A.timing.filter(function (x) { return /Payday/.test(x.v); })[0], w = [];
      if (A.peak) w.push(Math.round(A.peak.share * 100) + "% between 1800 and 0259");
      if (hol && hol.rr >= 1.15) w.push("holiday windows " + hol.rr.toFixed(1) + "\u00d7 the daily rate" + (A.hols[0] ? " (most around " + A.hols.slice(0, 2).map(function (h) { return h.v; }).join(" and ") + ")" : ""));
      if (pay && pay.rr >= 1.15) w.push("payday windows " + pay.rr.toFixed(1) + "\u00d7");
      if (A.off != null) w.push(Math.round(A.off * 100) + "% off duty");
      if (w.length) b.push("<li><strong>When:</strong> " + esc(w.join("; ")) + ".</li>");
      var ft = []; if (refK.length) ft.push(pctS(refY.length, refK.length) + " referred"); if (refY.length) ft.push(pctS(compY.length, refY.length) + " of those completed the program"); if (rp.people) ft.push(pctS(rp.repeat, rp.people) + " of people had a repeat");
      if (A.corr[0]) ft.push("non-completers repeat " + A.corr[0].ratio.toFixed(1) + "\u00d7 as often");
      if (ft.length) b.push("<li><strong>Follow-through:</strong> " + esc(ft.join("; ")) + ".</li>");
      var cs = (S.corr && S.corr.list || []).filter(function (c) { return !c.expected && c.v >= 0.15; })[0];
      if (cs) b.push("<li><strong>Strongest link in the data:</strong> " + esc(corrSentence(cs)) + "</li>");
      if (S.focusTop && S.focusTop.length) b.push("<li><strong>Recommended next steps:</strong><ol>" + S.focusTop.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ol></li>");
    }
    $("cmdBullets").innerHTML = b.join("");
  }
  function printSummary() {
    document.body.classList.add("print-cs");
    var done = function () { document.body.classList.remove("print-cs"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done); window.print(); setTimeout(done, 1500);
  }
  function summary(rows, f) {
    var A = S.an, s = [];
    if (rows.length < MIN_N) { $("summary").textContent = rows.length ? "Fewer than 5 incidents match the current filters; details are suppressed." : "No incidents match the current filters."; return; }
    var rp = repeatPeople(rows), t = trendInfo(f);
    s.push(K.fmt(rows.length) + " incidents (" + dateRange(rows) + ")" + (rp.people ? " involving " + K.fmt(rp.people) + " people; " + pctS(rp.repeat, rp.people) + " had more than one" : "") + ".");
    if (t && t.hasPrev && t.n >= MIN_N && t.prev >= MIN_N) s.push("FY" + String(t.cur).slice(2) + " is " + (t.n > t.prev ? "up" : t.n < t.prev ? "down" : "flat") + " " + Math.abs(Math.round((t.n - t.prev) / t.prev * 100)) + "% on FY" + String(t.cur - 1).slice(2) + " over the same months.");
    if (A.base) s.push("Overall rate " + K.fmt(A.base, 1) + " incidents per 1,000 assigned per year.");
    if (A.hasRates && A.rate[0]) s.push("Highest rate: " + DLABEL[A.rate[0].dim] + " " + A.rate[0].v + " at " + A.rate[0].rr.toFixed(1) + "\u00d7 the overall rate.");
    else if (A.combos[0]) s.push("Most common profile: " + profile(A.combos[0]) + " (" + Math.round(A.combos[0].share * 100) + "%).");
    var hol = A.timing.filter(function (x) { return /Holiday/.test(x.v); })[0]; if (hol && hol.rr >= 1.15) s.push("Holiday windows run " + hol.rr.toFixed(1) + "\u00d7 the daily rate.");
    if (A.corr[0]) s.push("Completing the program is linked with fewer repeats (" + Math.round(A.corr[0].comp.rate * 100) + "% vs " + Math.round(A.corr[0].non.rate * 100) + "%).");
    $("summary").textContent = s.join(" ");
  }

  // ---------- charts ----------
  function filterTo(k, v) { var d = DIMS.filter(function (x) { return x[0] === k; })[0]; if (!d || v == null) return; $(d[1]).value = v; S.showAll = false; render(); }
  function hover(ok) { return function (e, els) { e.native.target.style.cursor = els.length && ok(els[0].index) ? "pointer" : "default"; }; }
  function barChart(id, k, horiz, rows, f) {
    if (!$(id)) return;
    var g = group(rows, k), vals = Object.keys(g).filter(function (v) { return v !== BLANK; });
    if (horiz && !ORDER[k]) vals.sort(function (a, b) { return g[b] - g[a] || cmpVal(a, b); }); else vals = sortVals(k, vals);
    if (vals.length > TOPN + 1) vals = vals.slice(0, TOPN);
    var sup = vals.map(function (v) { return g[v] < MIN_N; }), canFilter = DIMS.some(function (d) { return d[0] === k; });
    var labels = vals.map(function (v, i) { return sup[i] ? v + " (<5)" : v; });
    var o = K.chartBase(); if (horiz) o.indexAxis = "y"; o.plugins.legend.display = false;
    o.scales[horiz ? "x" : "y"].beginAtZero = true;
    var ds = [{ label: "Incidents", data: vals.map(function (v, i) { return sup[i] ? null : g[v]; }), backgroundColor: C1, order: 2 }];
    if (RATE_DIMS.indexOf(k) >= 0) {
      var a = assigned(k, f), months = spanMonths(f);
      if (a && a.total) {
        ds.push({ label: "Per 1,000 assigned / yr", type: horiz ? "bar" : "line", data: vals.map(function (v, i) { return sup[i] || !a.by[v] ? null : +rate(g[v], a.by[v], months).toFixed(1); }),
          backgroundColor: horiz ? C2 : CL, borderColor: CL, pointRadius: 4, order: 1, yAxisID: horiz ? "y" : "y2", xAxisID: horiz ? "x2" : "x" });
        o.plugins.legend.display = true;
        if (horiz) o.scales.x2 = { position: "top", beginAtZero: true, grid: { display: false }, title: { display: true, text: "per 1,000 / yr" } };
        else o.scales.y2 = { position: "right", beginAtZero: true, grid: { display: false }, title: { display: true, text: "per 1,000 / yr" } };
      }
    }
    o.plugins.tooltip.callbacks = { label: function (c) { return c.raw == null ? (c.datasetIndex === 0 ? "Fewer than 5 (hidden)" : "") : c.dataset.label + ": " + K.fmt(c.raw, c.datasetIndex ? 1 : 0); } };
    o.onClick = function (e, els) { if (els.length && !sup[els[0].index] && canFilter) filterTo(k, vals[els[0].index]); };
    o.onHover = hover(function (i) { return !sup[i] && canFilter; });
    K.upsert(id, { type: "bar", data: { labels: labels, datasets: ds }, options: o });
    if (k === "win") { var t = S.an.timing.filter(function (x) { return /Holiday|Payday/.test(x.v); }); $("winNote").textContent = t.length ? t.map(function (x) { return x.v.split(" (")[0] + ": " + x.rr.toFixed(1) + "\u00d7 the daily rate of other days"; }).join(" \u00b7 ") : ""; }
  }
  function monthChart(f) {
    var rows = rowsFor(f, "fy"), fys = K.uniq(rows.map(function (r) { return r.fy; })).sort().slice(-6), small = false;
    var ds = fys.map(function (fy, i) {
      var c = new Array(12).fill(0); rows.forEach(function (r) { if (r.fy === fy) c[r.fmN - 1]++; });
      var cur = f.fy ? f.fy === fy : i === fys.length - 1, col = FY_COLORS[(i + FY_COLORS.length - fys.length) % FY_COLORS.length];
      return { label: fy, data: c.map(function (x) { if (x > 0 && x < MIN_N) { small = true; return null; } return x; }), borderColor: col, backgroundColor: col, borderWidth: cur ? 3 : 1.5, pointRadius: cur ? 3 : 1.5, tension: .25 };
    });
    var o = K.chartBase(); o.scales.y.beginAtZero = true;
    o.onClick = function (e, els) { if (!els.length) return; $("fFy").value = fys[els[0].datasetIndex]; filterTo("fm", FY_MON[els[0].index]); };
    o.onHover = hover(function () { return true; });
    K.upsert("cMonth", { type: "line", data: { labels: FY_MON, datasets: ds }, options: o });
    $("monthNote").textContent = "Click a point to filter to that fiscal year and month." + (small ? " Gaps are months with fewer than 5 incidents (hidden)." : "");
  }
  function fyChart(f) {
    var rows = rowsFor(f, "fy"), g = group(rows, "fy"), fys = Object.keys(g).filter(function (v) { return v !== BLANK; }).sort(), t = trendInfo(f);
    var o = K.chartBase(); o.plugins.legend.display = false; o.scales.y.beginAtZero = true;
    o.onClick = function (e, els) { if (els.length && g[fys[els[0].index]] >= MIN_N) filterTo("fy", fys[els[0].index]); }; o.onHover = hover(function () { return true; });
    o.plugins.tooltip.callbacks = { label: function (c) { return c.raw == null ? "Fewer than 5 (hidden)" : "Incidents: " + K.fmt(c.raw); } };
    K.upsert("cFy", { type: "bar", data: { labels: fys.map(function (v) { return g[v] < MIN_N ? v + " (<5)" : v; }), datasets: [{ label: "Incidents", data: fys.map(function (v) { return g[v] < MIN_N ? null : g[v]; }), backgroundColor: fys.map(function (v) { return f.fy === v ? C2 : C1; }) }] }, options: o });
    $("fyNote").textContent = (t && t.part ? "FY" + String(t.cur).slice(2) + " is a part year (Oct\u2013" + FY_MON[t.maxFm - 1] + "). " : "") + "Click a bar to filter.";
  }
  function repeatChart(rows) {
    var by = {}; TREAT.forEach(function (t) { by[t] = { n: 0, y: 0 }; });
    rows.forEach(function (r) { if (!r.treat || !r.rep) return; by[r.treat].n++; if (r.rep === "Y") by[r.treat].y++; });
    var sup = TREAT.map(function (t) { return by[t].n < MIN_N || (by[t].y > 0 && by[t].y < MIN_N); });
    var o = K.chartBase(); o.plugins.legend.display = false; o.scales.y.beginAtZero = true; o.scales.y.max = 100; o.scales.y.ticks = { callback: function (v) { return v + "%"; } };
    o.plugins.tooltip.callbacks = { label: function (c) { var b = by[TREAT[c.dataIndex]]; return c.raw == null ? "Fewer than 5 (hidden)" : c.raw + "% repeated (" + K.fmt(b.y) + " of " + K.fmt(b.n) + ")"; } };
    K.upsert("cRepeat", { type: "bar", data: { labels: TREAT.map(function (t, i) { return sup[i] ? t + " (<5)" : t; }), datasets: [{ label: "Repeat rate", data: TREAT.map(function (t, i) { return sup[i] ? null : Math.round(by[t].y / by[t].n * 100); }), backgroundColor: [C4, C2, C3] }] }, options: o });
    $("repNote").textContent = "Share of incidents followed by another incident by the same person, by what happened after the incident.";
  }
  function heatCells(rows) {
    var m = {}; rows.forEach(function (r) { if (!r.grade || !r.ageBand) return; var k = r.grade + "|" + r.ageBand; m[k] = (m[k] || 0) + 1; });
    var hot = Object.keys(m).filter(function (k) { return m[k] >= MIN_N; }).map(function (k) { var p = k.split("|"); return { grade: p[0], age: p[1], n: m[k] }; }).sort(function (a, b) { return b.n - a.n; });
    return { m: m, hot: hot };
  }
  // generic heat map: rows x columns of incident counts; cells under 5 show <5; click a cell to filter by both
  var HEATS = [["tHeat", "grade", "ageBand"], ["tHeatDH", "dow", "tod"], ["tHeatLM", "loc", "fm"], ["tHeatUD", "unit", "duty"], ["tHeatGM", "grade", "marital"]];
  function heatData(rows, rk, ck, maxRows) {
    var m = Object.create(null), rc = Object.create(null), mx = 0;
    rows.forEach(function (r) { var a = r[rk], b = r[ck]; if (!a || !b) return; var k = a + "|" + b; m[k] = (m[k] || 0) + 1; rc[a] = (rc[a] || 0) + 1; if (m[k] > mx) mx = m[k]; });
    var rvals = Object.keys(rc); rvals = ORDER[rk] || rk === "grade" ? sortVals(rk, rvals) : rvals.sort(function (a, b) { return rc[b] - rc[a] || cmpVal(a, b); });
    if (maxRows && rvals.length > maxRows) rvals = rvals.slice(0, maxRows);
    var cvals = sortVals(ck, K.uniq(rows.map(function (r) { return r[ck]; }).filter(Boolean)));
    var hot = Object.keys(m).filter(function (k) { return m[k] >= MIN_N; }).map(function (k) { var p = k.split("|"); return { a: p[0], b: p[1], n: m[k] }; }).sort(function (a, b) { return b.n - a.n; });
    return { m: m, rows: rvals, cols: cvals, mx: mx, hot: hot, more: Object.keys(rc).length - rvals.length };
  }
  function heatAll(rows) {
    HEATS.forEach(function (h) {
      var el = $(h[0]); if (!el) return;
      var H = heatData(rows, h[1], h[2], 14), ok = H.rows.length && H.cols.length;
      el.innerHTML = !ok ? "<tbody><tr><td class=\"sup\">No data in this selection</td></tr></tbody>" : "<thead><tr><th></th>" + H.cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>" + H.rows.map(function (a) {
        return '<tr><th class="rowh">' + esc(a) + "</th>" + H.cols.map(function (b) {
          var n = H.m[a + "|" + b] || 0;
          return n === 0 ? '<td class="sup">0</td>' : n < MIN_N ? '<td class="sup">&lt;5</td>' : '<td class="hot" data-r="' + esc(a) + '" data-c="' + esc(b) + '" style="background:' + K.heatColor(n / H.mx) + '" title="' + esc(a + " \u00b7 " + b + ": " + n + " (click to filter)") + '">' + n + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody>" + (H.more > 0 ? '<caption class="muted small">Top ' + H.rows.length + " by incidents; " + H.more + " more not shown.</caption>" : "");
      el.setAttribute("data-rk", h[1]); el.setAttribute("data-ck", h[2]);
    });
  }
  function heatClick(e) {
    var td = e.target.closest && e.target.closest("td.hot"); if (!td) return;
    var t = td.closest("table"), rk = t.getAttribute("data-rk"), ck = t.getAttribute("data-ck");
    [[rk, td.getAttribute("data-r")], [ck, td.getAttribute("data-c")]].forEach(function (x) { var d = DIMS.filter(function (y) { return y[0] === x[0]; })[0]; if (d) $(d[1]).value = x[1]; });
    S.showAll = false; render();
  }
  function heatCells(rows) { var H = heatData(rows, "grade", "ageBand"); return { hot: H.hot.map(function (x) { return { grade: x.a, age: x.b, n: x.n }; }) }; }

  // ---------- correlations: bias-corrected Cramer's V between categorical / binned fields ----------
  var CF = ["grade", "ageBand", "gender", "status", "marital", "loc", "unit", "type", "duty", "msdBand", "win", "dow", "tod", "fy", "tisBand", "depsBand", "priorBand", "ref", "comp", "rep"];
  var CSHORT = { grade: "Grade", ageBand: "Age", gender: "Gender", status: "Status", marital: "Marital", loc: "Location", unit: "Unit", type: "Type", duty: "Duty", msdBand: "Since dep.", win: "Hol/pay",
    dow: "Day", tod: "Time", fy: "FY", tisBand: "Service", depsBand: "Deps", priorBand: "Prior", ref: "Referred", comp: "Completed", rep: "Repeat" };
  var EXPECTED = { "unit|loc": "units sit at a location", "ref|comp": "only referred people can complete", "grade|tisBand": "grade follows time in service", "ageBand|tisBand": "service grows with age",
    "grade|ageBand": "grade follows age", "depsBand|marital": "dependents go with marriage", "marital|depsBand": "dependents go with marriage", "type|duty": "duty-related incidents happen on duty", "duty|type": "duty-related incidents happen on duty", "tisBand|fy": "the same people gain service each year", "fy|tisBand": "the same people gain service each year", "priorBand|rep": "both count repeat incidents", "comp|ref": "only referred people can complete" };
  function levels(rows, k) { // levels with 5+ incidents; smaller ones pooled as Other (dropped if the pool is still under 5)
    var g = group(rows, k), big = Object.keys(g).filter(function (v) { return v !== BLANK && g[v] >= MIN_N; }), small = Object.keys(g).filter(function (v) { return v !== BLANK && g[v] < MIN_N; });
    var other = K.sum(small, function (v) { return g[v]; }), map = {};
    big.forEach(function (v) { map[v] = v; }); if (other >= MIN_N) small.forEach(function (v) { map[v] = "Other"; });
    return map;
  }
  function cramer(rows, a, b, la, lb) {
    var t = Object.create(null), ra = Object.create(null), cb = Object.create(null), n = 0;
    rows.forEach(function (r) { var x = la[dv(r, a)], y = lb[dv(r, b)]; if (!x || !y) return; var k = x + "|" + y; t[k] = (t[k] || 0) + 1; ra[x] = (ra[x] || 0) + 1; cb[y] = (cb[y] || 0) + 1; n++; });
    var R = Object.keys(ra), C = Object.keys(cb); if (n < 30 || R.length < 2 || C.length < 2) return null;
    var chi = 0; R.forEach(function (x) { C.forEach(function (y) { var e = ra[x] * cb[y] / n, o = t[x + "|" + y] || 0; chi += (o - e) * (o - e) / e; }); });
    var phi2 = chi / n, r = R.length, k = C.length, p2 = Math.max(0, phi2 - (k - 1) * (r - 1) / (n - 1)), rc = r - (r - 1) * (r - 1) / (n - 1), kc = k - (k - 1) * (k - 1) / (n - 1);
    var den = Math.min(kc - 1, rc - 1), v = den > 0 ? Math.sqrt(p2 / den) : 0;
    var best = null; // most over-represented combination (5+ incidents)
    R.forEach(function (x) { C.forEach(function (y) { var o = t[x + "|" + y] || 0; if (o < MIN_N || x === "Other" || y === "Other") return; var lift = (o / ra[x]) / (cb[y] / n);
      if (!best || lift > best.lift) best = { x: x, y: y, o: o, lift: lift, pIn: o / ra[x], pAll: cb[y] / n }; }); });
    return { v: v, n: n, best: best };
  }
  function correlations(rows, f) {
    var flds = CF.filter(function (k) { return !f[k]; }), L = {}, use = [];
    if (rows.length < 30) return { fields: [], m: {}, list: [] };
    flds.forEach(function (k) { var l = levels(rows, k), u = K.uniq(Object.keys(l).map(function (x) { return l[x]; })); if (u.length >= 2) { L[k] = l; use.push(k); } });
    var m = {}, list = [];
    for (var i = 0; i < use.length; i++) for (var j = 0; j < i; j++) {
      var a = use[i], b = use[j], c = cramer(rows, a, b, L[a], L[b]); if (!c) continue;
      m[a + "|" + b] = m[b + "|" + a] = c.v;
      var exp = EXPECTED[a + "|" + b] || EXPECTED[b + "|" + a];
      list.push({ a: a, b: b, v: c.v, n: c.n, best: c.best, expected: exp });
    }
    list.sort(function (x, y) { return y.v - x.v; });
    return { fields: use, m: m, list: list };
  }
  function strength(v) { return v >= 0.3 ? "strong" : v >= 0.2 ? "moderate" : v >= 0.1 ? "weak" : "negligible"; }
  function corrSentence(c) {
    var s = DLABEL[c.a] + " and " + DLABEL[c.b].toLowerCase() + ": " + strength(c.v) + " association (V = " + c.v.toFixed(2) + ")";
    if (c.best && c.best.lift >= 1.2) s += ". Among incidents with " + DLABEL[c.a].toLowerCase() + " " + c.best.x + ", " + Math.round(c.best.pIn * 100) + "% have " + DLABEL[c.b].toLowerCase() + " " + c.best.y + " (vs " + Math.round(c.best.pAll * 100) + "% overall)";
    return s + ".";
  }
  function renderCorr(C) {
    if (!$("tCorr")) return;
    if (!C.fields.length) { $("tCorr").innerHTML = '<tbody><tr><td class="sup">Needs at least 30 incidents in the selection.</td></tr></tbody>'; $("corrList").innerHTML = ""; $("corrExp").textContent = ""; return; }
    var F_ = C.fields;
    $("tCorr").innerHTML = "<thead><tr><th></th>" + F_.map(function (k) { return '<th title="' + esc(DLABEL[k]) + '">' + esc(CSHORT[k]) + "</th>"; }).join("") + "</tr></thead><tbody>" + F_.map(function (a, i) {
      return '<tr><th class="rowh">' + esc(CSHORT[a]) + "</th>" + F_.map(function (b, j) {
        if (i === j) return '<td class="sup diag"></td>';
        var v = C.m[a + "|" + b]; if (v == null) return '<td class="sup">\u2014</td>';
        return '<td style="background:' + K.heatColor(Math.min(1, v / 0.5)) + '" title="' + esc(DLABEL[a] + " \u00d7 " + DLABEL[b] + ": V = " + v.toFixed(2) + " (" + strength(v) + ")") + '">' + v.toFixed(2).replace(/^0/, "") + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</tbody>";
    var top = C.list.filter(function (c) { return !c.expected && c.v >= 0.1; }).slice(0, 10), exp = C.list.filter(function (c) { return c.expected && c.v >= 0.1; }).slice(0, 4);
    $("corrList").innerHTML = (top.length ? top.map(function (c) { return "<li>" + pillV(c.v) + esc(corrSentence(c)) + '<span class="why">' + K.fmt(c.n) + " incidents with both fields</span></li>"; }).join("") : "<li>No association of 0.10 or more in this selection.</li>");
    $("corrExp").textContent = exp.length ? "Expected by design (not ranked): " + exp.map(function (c) { return DLABEL[c.a] + " \u00d7 " + DLABEL[c.b].toLowerCase() + " (V = " + c.v.toFixed(2) + ", " + c.expected + ")"; }).join("; ") + "." : "";
  }
  function pillV(v) { return '<span class="rr' + (v >= 0.3 ? "" : v >= 0.2 ? " mid" : " info") + '">V ' + v.toFixed(2) + "</span>"; }

  // ---------- detail table ----------
  var TCOLS = [["date", "Date"], ["time", "Time"], ["dow", "Day"], ["ty", "TY"], ["fy", "FY"], ["pid", "Person ID"], ["age", "Age", 1], ["gender", "Gender"], ["grade", "Grade"], ["status", "Status"], ["loc", "Location"], ["unit", "Unit"],
    ["mos", "MOS"], ["tis", "TIS (yrs)", 1], ["marital", "Marital"], ["deps", "Deps", 1], ["type", "Incident Type"], ["duty", "Duty Status"], ["msd", "Mo. Since Dep.", 1], ["prior", "Prior", 1],
    ["ref", "Referred"], ["comp", "Completed"], ["rep", "Repeat"], ["out", "Outcome"]];
  var SEARCH = ["pid", "unit", "loc", "mos", "type", "grade", "status", "out", "duty", "marital", "gender"];
  function cellv(r, k) { var v = r[k]; return v == null || (typeof v === "number" && isNaN(v)) ? "" : v; }
  function table() {
    var on = $("showRows").checked;
    ["rowsWrap", "fSearch", "btnCsv", "searchNote"].forEach(function (id) { $(id).hidden = !on; });
    $("rowsNote").hidden = on;
    if (!on) { $("btnAll").style.display = "none"; $("tDetail").tBodies[0].innerHTML = ""; S.shown = []; return; }
    var q = ($("fSearch").value || "").trim().toLowerCase(), rows = S.base || [];
    if (q) rows = rows.filter(function (r) { return SEARCH.some(function (k) { return r[k] && String(r[k]).toLowerCase().indexOf(q) >= 0; }); });
    var k = S.sort.k, dir = S.sort.dir, isN = TCOLS.some(function (c) { return c[0] === k && c[2]; });
    rows = rows.slice().sort(function (a, b) {
      var x = k === "date" ? (a.d - b.d) || ((a.hour || 0) * 60 + (a.min || 0)) - ((b.hour || 0) * 60 + (b.min || 0)) : k === "grade" ? gradeKey(a.grade) - gradeKey(b.grade) : isN ? (cellv(a, k) === "" ? -1e9 : a[k]) - (cellv(b, k) === "" ? -1e9 : b[k]) : cmpVal(cellv(a, k), cellv(b, k));
      return x * dir || b.d - a.d;
    });
    S.shown = rows;
    $("searchNote").textContent = q ? K.fmt(rows.length) + " of " + K.fmt(S.base.length) + " incidents match \u201c" + $("fSearch").value.trim() + "\u201d" : "";
    $("tDetail").tHead.innerHTML = "<tr>" + TCOLS.map(function (c) { var on = S.sort.k === c[0]; return '<th data-k="' + c[0] + '" class="' + (c[2] ? "num" : "") + (on ? " sorted" + (S.sort.dir > 0 ? " asc" : "") : "") + '" aria-sort="' + (on ? (S.sort.dir > 0 ? "ascending" : "descending") : "none") + '">' + esc(c[1]) + "</th>"; }).join("") + "</tr>";
    var show = rows.slice(0, S.showAll ? MAXROWS : PAGE), dash = '<span class="muted">\u2014</span>';
    $("tDetail").tBodies[0].innerHTML = show.length ? show.map(function (r) { return "<tr>" + TCOLS.map(function (c) { var v = cellv(r, c[0]); if (c[0] === "msd" && r.msd === null) v = "Never"; return "<td" + (c[2] ? ' class="num"' : "") + ">" + (v === "" ? dash : esc(v)) + "</td>"; }).join("") + "</tr>"; }).join("")
      : '<tr><td colspan="' + TCOLS.length + '" class="muted">' + (q ? "No incidents match the search in the current selection." : "No incidents match the current filters.") + "</td></tr>";
    var btn = $("btnAll"); btn.style.display = rows.length > PAGE ? "" : "none";
    btn.textContent = S.showAll ? "Show " + PAGE : rows.length > MAXROWS ? "Show first " + K.fmt(MAXROWS) : "Show all " + K.fmt(rows.length);
  }
  function stamp() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function exportCsv() { if (!$("showRows").checked) return; K.downloadCsv("incidents_" + stamp() + ".csv", TCOLS.map(function (c) { return c[1]; }), (S.shown || []).map(function (r) { return TCOLS.map(function (c) { return c[0] === "msd" && r.msd === null ? "" : cellv(r, c[0]); }); })); }

  // ---------- GenAI pack (aggregated only: no names, IDs, records or exact dates; groups under 5 suppressed) ----------
  var PROMPT = [
    "You are an analyst supporting a commander and the unit prevention team. Below is an AGGREGATED summary of alcohol-related incidents.",
    "It contains no names, IDs, individual records or exact dates; any group with fewer than 5 incidents is shown as <5.",
    "Using only this data, write a commander-level analysis with:",
    "1. A 3-5 sentence bottom line up front.",
    "2. Key trends over time (fiscal years run October to September).",
    "3. The highest-risk groups and timing, using rates and relative risk where given (say when only shares are available), and what they have in common.",
    "4. Likely contributing factors, stated as hypotheses to check, not conclusions.",
    "5. Five to eight prioritized, specific prevention actions: who, when (for example before which holidays), and how to measure success.",
    "6. Data gaps and what to collect next.",
    "Do not try to identify any individual. Use plain language and keep it to about one page.",
    ""];
  function packText() {
    var f = F(), rows = rowsFor(f), A = analyze(rows, f), L = PROMPT.slice(), months = spanMonths(f);
    var scope = DIMS.filter(function (d) { return f[d[0]]; }).map(function (d) { return DLABEL[d[0]] + " = " + f[d[0]]; });
    L.push("=== AGGREGATED DATA (" + (S.source === "file" || S.source === "saved" ? "loaded from local files" : "FICTIONAL demo data") + ") ===");
    L.push("Selection: " + (scope.length ? scope.join("; ") : "all incidents") + ". Period: " + dateRange(rows) + " (months only).");
    if (rows.length < MIN_N) { L.push("Fewer than 5 incidents in this selection; nothing else is reported."); return L.join("\n"); }
    var rp = repeatPeople(rows), refK = rows.filter(function (r) { return r.ref; }), refY = refK.filter(function (r) { return r.ref === "Y"; }), compY = refY.filter(function (r) { return r.comp === "Y"; });
    L.push("Total incidents: " + rows.length + (rp.people ? "; people involved: " + rp.people + "; people with more than one incident: " + cnt(rp.repeat) + " (" + pctS(rp.repeat, rp.people) + ")" : "") + ".");
    if (refK.length) L.push("Referred to treatment: " + pctS(refY.length, refK.length) + " of incidents; completed program: " + pctS(compY.length, refY.length) + " of referred.");
    if (A.base) L.push("Overall rate: " + A.base.toFixed(1) + " incidents per 1,000 assigned per year (headcount " + assigned(null, f).total + ").");
    var t = trendInfo(f); if (t && t.hasPrev && t.n >= MIN_N && t.prev >= MIN_N) L.push("Trend: FY" + String(t.cur).slice(2) + " " + t.n + " vs FY" + String(t.cur - 1).slice(2) + " " + t.prev + " over the same months (Oct-" + FY_MON[t.maxFm - 1] + ").");
    var all = rowsFor(f, "fy"), gfy = group(all, "fy");
    L.push("", "-- Incidents by fiscal year --"); Object.keys(gfy).sort().forEach(function (k) { L.push(k + ": " + cnt(gfy[k])); });
    L.push("", "-- Incidents by fiscal month (Oct..Sep), per fiscal year --");
    K.uniq(all.map(function (r) { return r.fy; })).sort().forEach(function (fy) { var c = new Array(12).fill(0); all.forEach(function (r) { if (r.fy === fy) c[r.fmN - 1]++; }); L.push(fy + ": " + c.map(function (x, i) { return FY_MON[i] + " " + cnt(x); }).join(", ")); });
    L.push("", "-- Counts by segment (with rate per 1,000/yr and relative risk where a headcount covers it) --");
    ["grade", "ageBand", "gender", "status", "marital", "loc", "unit", "type", "duty", "msdBand", "win", "hol", "tisBand", "depsBand", "priorBand"].forEach(function (k) {
      if (f[k]) return; var g = group(rows, k), a = RATE_DIMS.indexOf(k) >= 0 ? assigned(k, f) : null, vals = sortVals(k, Object.keys(g).filter(function (v) { return v !== BLANK; }));
      if (!vals.length) return;
      L.push(DLABEL[k] + ": " + vals.map(function (v) {
        var n = g[v]; if (n < MIN_N) return v + " <5";
        var s = v + " " + n + " (" + Math.round(n / rows.length * 100) + "%)";
        if (a && a.by[v] >= MIN_N) { var r = rate(n, a.by[v], months); s += ", " + r.toFixed(1) + "/1,000" + (A.base ? ", RR " + (r / A.base).toFixed(2) : ""); }
        return s;
      }).join("; "));
    });
    L.push("", "-- Top correlations / risk signals --");
    A.rate.slice(0, 6).forEach(function (x) { L.push("Rate: " + DLABEL[x.dim] + " " + x.v + " = " + x.rate.toFixed(1) + " per 1,000/yr, " + x.rr.toFixed(2) + "x overall"); });
    A.timing.forEach(function (x) { L.push("Timing: " + x.v + " = " + Math.round(x.share * 100) + "% of incidents on " + Math.round(x.dayShare * 100) + "% of days (" + x.rr.toFixed(2) + "x daily rate)"); });
    A.repeat.slice(0, 6).forEach(function (x) { L.push("Repeat: " + DLABEL[x.dim] + " " + x.v + " = " + Math.round(x.rate * 100) + "% of incidents followed by another (" + x.rr.toFixed(2) + "x overall " + Math.round(A.repBase * 100) + "%)"); });
    if (A.dep12) L.push("Post-deployment: " + Math.round(A.dep12.share * 100) + "% of incidents within 12 months of returning");
    if (A.notRef != null) L.push("Not referred: " + Math.round(A.notRef * 100) + "% of incidents");
    A.combos.forEach(function (c) { L.push("Common profile: " + profile(c) + " = " + Math.round(c.share * 100) + "% of incidents"); });
    L.push("", "-- Heat-map hot spots (pay grade x age band, cells of 5 or more) --");
    heatCells(rows).hot.slice(0, 8).forEach(function (h) { L.push(h.grade + ", age " + h.age + ": " + h.n + " incidents"); });
    L.push("", "-- Hot spots: day of week x time of day (cells of 5 or more) --");
    heatData(rows, "dow", "tod").hot.slice(0, 8).forEach(function (h) { L.push(h.a + " " + h.b + ": " + h.n + " incidents"); });
    L.push("", "-- Hot spots: location x fiscal month, unit x duty status (cells of 5 or more) --");
    heatData(rows, "loc", "fm").hot.slice(0, 5).forEach(function (h) { L.push(h.a + ", " + h.b + " (all years): " + h.n + " incidents"); });
    heatData(rows, "unit", "duty").hot.slice(0, 5).forEach(function (h) { L.push(h.a + ", " + h.b + ": " + h.n + " incidents"); });
    var CC = correlations(rows, f);
    L.push("", "-- Strongest associations between fields (bias-corrected Cramer's V; association, not cause) --");
    CC.list.filter(function (c) { return !c.expected && c.v >= 0.1; }).slice(0, 10).forEach(function (c) { L.push(corrSentence(c)); });
    L.push("", "Notes: groups under 5 are suppressed. RR = relative risk (group rate / overall rate). Holiday window = within 3 days of a federal holiday, New Year's Eve or St. Patrick's Day; payday window = 0-3 days after the 1st or 15th.");
    return L.join("\n");
  }
  function genaiStatus(m) { $("genaiStatus").textContent = m; clearTimeout(genaiStatus.t); genaiStatus.t = setTimeout(function () { $("genaiStatus").textContent = ""; }, 6000); }
  function copyPack() {
    var t = packText();
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; } ta.remove();
      genaiStatus(ok ? "Copied (" + K.fmt(t.length) + " characters)." : "The browser blocked copying; use the .txt download.");
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(function () { genaiStatus("Copied (" + K.fmt(t.length) + " characters)."); }, fallback); else fallback();
  }
  function downloadPack() {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([packText()], { type: "text/plain;charset=utf-8" })); a.download = "prevention-genai-pack-" + stamp() + ".txt";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); genaiStatus("Downloaded the .txt pack.");
  }

  // ---------- save with data (incident rows in the listed columns only, headcount file rows, typed headcounts) ----------
  var SAVED_ID = "prevention" + "Saved", SAVED = null, SCOLS = COLS.map(function (c) { return c[0]; });
  function readSaved() { var el = document.getElementById(SAVED_ID); if (!el) return null; try { var o = JSON.parse(el.textContent); return o && o.v === 1 && o.rows ? o : null; } catch (e) { return null; } }
  function loadSaved() {
    var D = SAVED, p = parseIncidents(aoaSource([D.headers].concat(D.rows)));
    S.files = [{ name: "Saved incident data (" + plural(D.files.length, "source file") + ")", kind: "incidents", rep: p.report, records: p.records, embedded: true }];
    if (D.roster) { var rp = parseRoster(aoaSource([D.roster.headers].concat(D.roster.rows))); S.files.push({ name: "Saved headcount (" + D.roster.files.join(", ") + ")", kind: "roster", rep: rp.report, rows: rp.rows, embedded: true }); }
    if (D.hc && !S.hcLocal) S.hc = D.hc;
    S.failed = null; combine(); return true;
  }
  function safeJson(o) { return JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
  function snapshot() {
    var files = []; S.files.filter(function (e) { return usable(e) && e.kind === "incidents"; }).forEach(function (e) { (e.embedded && SAVED ? SAVED.files : [e.name]).forEach(function (n) { if (files.indexOf(n) < 0) files.push(n); }); });
    var o = { v: 1, savedAt: new Date().toISOString(), files: files, headers: COLS.map(function (c) { return c[1]; }),
      rows: S.recs.map(function (r) { return SCOLS.map(function (k) { var v = r[k]; return k === "date" ? r.when : v == null || (typeof v === "number" && isNaN(v)) ? "" : v; }); }),
      hc: { mode: S.hc.mode, gender: S.hc.gender, remember: false, unit: S.hc.unit, grade: S.hc.grade, grid: S.hc.grid } };
    if (S.roster) o.roster = { files: S.roster.files, headers: ["Unit", "Location", "Grade", "Gender", "Age Band", "Count"], rows: S.roster.rows.map(function (x) { return [x.unit || "", x.loc || "", x.grade || "", x.gender || "", x.ageBand || "", x.count]; }) };
    return o;
  }
  function pageSource(cb) {
    var cap = window.__dashSrc, scripts = [], seen = false, external = false;
    Array.prototype.forEach.call(document.scripts, function (sc) { if (sc.id === SAVED_ID) return; if (seen) { scripts.push(sc.outerHTML); if (sc.src) external = true; } else if (sc.textContent.indexOf("__dashSrc") >= 0) seen = true; });
    if (cap && seen && !external) return cb(null, "<!doctype html>\n" + cap.replace(/<\/body>\s*<\/html>\s*$/i, "") + "\n" + scripts.join("\n") + "\n</body>\n</html>\n");
    if (/^https?:$/.test(location.protocol)) {
      var url = new URL("../../downloads/prevention-dashboard.html", location.href).href;
      return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }).then(function (t) { cb(null, t); }, function (e) { cb(e); });
    }
    cb(new Error("This copy loads its scripts from separate files. Open the single-file prevention-dashboard.html to save with data."));
  }
  function saveWithData() {
    if (S.source !== "file" && S.source !== "saved") return;
    var btn = $("btnSave"), label = btn.innerHTML; btn.disabled = true; btn.textContent = "Saving\u2026";
    pageSource(function (err, html) {
      btn.innerHTML = label; btn.disabled = false;
      if (err) { alert("Could not build the saved file: " + (err.message || err)); return; }
      var snap = snapshot(), tag = "<script id=\"" + SAVED_ID + "\" type=\"application/json\">" + safeJson(snap) + "</scr" + "ipt>\n";
      var m, i = -1, re = /<\/body\s*>/gi; while ((m = re.exec(html))) i = m.index;
      if (i < 0) { alert("Could not build the saved file."); return; }
      html = html.slice(0, i) + tag + html.slice(i);
      var d = new Date(snap.savedAt), name = "PREVENTION-REAL-DATA-" + ("0" + d.getDate()).slice(-2) + MON[d.getMonth()] + String(d.getFullYear()).slice(2) + ".html";
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    });
  }
  function fmtStamp(d) { return ("0" + d.getDate()).slice(-2) + "-" + MON[d.getMonth()] + "-" + String(d.getFullYear()).slice(2) + " " + ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2); }
  function showBanner() {
    $("realBanner").hidden = false;
    $("realBannerMeta").textContent = "Data as of " + fmtStamp(new Date(SAVED.savedAt)) + " \u00b7 " + K.fmt(SAVED.rows.length) + " incidents" + (SAVED.roster ? " + headcount" : "") + " from " + plural(SAVED.files.length, "source file") + ": " + SAVED.files.join(", ");
  }

  // ---------- load report ----------
  function codes(list) { return list.map(function (m) { return "<code>" + esc(m) + "</code>"; }).join(", "); }
  function fileLines(e) {
    var h = [], w = 0, rep = e.rep;
    if (e.error) return { html: '<p class="err">Could not read this file: ' + esc(e.error) + "</p>", warns: 1 };
    if (rep.fatal) return { html: '<p class="err">' + esc(rep.fatal) + "</p>" + (rep.pii.length ? '<p class="ok">Personal identifier columns skipped without reading: ' + codes(rep.pii) + "</p>" : ""), warns: 1 };
    if (e.kind === "roster") {
      h.push('<p class="ok">Headcount: ' + plural(e.rows.length, "group row") + ", " + K.fmt(rep.total) + " assigned. Columns: " + codes(rep.matched) + ".</p>");
      if (rep.badCount) { w++; h.push('<p class="warn">' + rep.badCount + " Count value(s) could not be read and were skipped.</p>"); }
    } else {
      h.push('<p class="' + (rep.rowsLoaded ? "ok" : "err") + '">Incidents: loaded ' + plural(rep.rowsLoaded, "row") + " of " + K.fmt(rep.rowsRead) + " read (header row " + rep.headerRow + ")." + (rep.blankRows ? ' <span class="muted">' + K.fmt(rep.blankRows) + " blank row(s) ignored.</span>" : "") + "</p>");
      var ok = rep.matched.length === COLS.length; h.push('<p class="' + (ok ? "ok" : "warn") + '">' + rep.matched.length + " of " + COLS.length + " columns matched.</p>");
      if (!ok) { w++; h.push('<p class="warn">Missing (charts that need them are hidden): ' + codes(rep.missing) + "</p>"); }
      if (rep.badDate) { w++; h.push('<p class="warn">' + rep.badDate + " row(s) skipped because the Incident Date could not be read. Examples: " + rep.badDateEx.map(function (x) { return "row " + x.row + " = &ldquo;" + esc(x.value) + "&rdquo;"; }).join("; ") + ".</p>"); }
      if (rep.badNum) { w++; h.push('<p class="warn">' + rep.badNum + " number cell(s) (age, time in service, dependents, months, prior incidents) could not be read and count as blank.</p>"); }
    }
    h.push(rep.pii.length ? '<p class="ok"><strong>Personal identifier columns skipped without reading:</strong> ' + codes(rep.pii) + ". Their values are never read, shown, exported or saved.</p>" : '<p class="muted">No name, SSN, DoD ID or date of birth columns found.</p>');
    if (rep.extra.length) h.push('<details class="muted"><summary>' + plural(rep.extra.length, "other column") + " ignored</summary><p class=\"muted\">" + codes(rep.extra) + "</p></details>");
    if (rep.dupes.length) h.push('<p class="muted">Repeated columns ignored (first one used): ' + codes(rep.dupes) + "</p>");
    return { html: h.join(""), warns: w };
  }
  function renderReport() {
    var el = $("loadReport"), h = [], warns = 0;
    if (S.failed) {
      S.failed.forEach(function (e) { h.push('<div class="filerep"><h4>' + esc(e.name) + "</h4>" + fileLines(e).html + "</div>"); });
      h.push('<p class="muted">Nothing was loaded; the dashboard still shows the previous data.</p>'); el.innerHTML = h.join("");
      setBar("err", "Could not load " + (S.failed.length === 1 ? S.failed[0].name : S.failed.length + " files") + " \u00b7 still showing the previous data", 1); return;
    }
    if (S.source === "demo") {
      el.innerHTML = '<p class="muted">Showing the built-in FICTIONAL demo: ' + plural(S.recs.length, "incident") + " across " + plural(K.uniq(S.recs.map(function (r) { return r.unit; })).length, "unit") + " and a fictional headcount of " + K.fmt(K.sum(S.roster.rows, function (o) { return o.count; })) + ". No real people; Person IDs are random. Choose your files, or drop them here.</p>";
      setBar("ok", "Demo data (fictional) \u00b7 " + plural(S.recs.length, "incident") + " \u00b7 demo headcount", 0); return;
    }
    S.files.forEach(function (e) {
      var fl = fileLines(e); warns += fl.warns;
      h.push('<details class="filerep"' + (fl.warns || S.files.length <= 2 ? " open" : "") + "><summary>" + esc(e.name) + " \u00b7 " + (e.kind === "roster" ? "headcount" : e.kind === "incidents" ? "incidents" : "not recognized") + (fl.warns ? ' \u00b7 <span class="warn">' + fl.warns + " warning" + (fl.warns === 1 ? "" : "s") + "</span>" : "") + "</summary>" + fl.html + "</details>");
    });
    var inc = S.files.filter(function (e) { return usable(e) && e.kind === "incidents"; });
    h.push('<div class="combined"><p class="ok"><strong>Combined: ' + plural(S.recs.length, "incident") + (inc.length ? " from " + plural(inc.length, "file") : " (fictional demo incidents)") + "</strong>" + (S.dupRemoved ? " \u00b7 " + plural(S.dupRemoved, "duplicate row") + " removed" : "") + ".</p>" +
      (S.roster ? '<p class="ok">Headcount: ' + esc(S.roster.files.join(", ")) + " (by " + esc(S.roster.dims.join(", ")) + ").</p>" : '<p class="muted">No headcount file (optional). Type headcounts in the Headcount panel, or load a roster, for rates per 1,000.</p>') + "</div>");
    el.innerHTML = h.join("");
    setBar(warns ? "warn" : "ok", (inc.length === 1 ? inc[0].name : inc.length ? plural(inc.length, "incident file") : "Demo incidents") + " \u00b7 " + plural(S.recs.length, "incident") + (S.roster ? " \u00b7 headcount: " + S.roster.files.join(", ") : ""), warns);
  }
  function setBar(state, line, warns) {
    $("loadBar").className = "loadbar no-print chrome" + (state === "ok" ? "" : " " + state);
    $("lbIcon").innerHTML = state === "ok" ? "&#10003;" : state === "warn" ? "&#9888;" : state === "busy" ? "&#8987;" : "&#10005;";
    $("lbText").textContent = line; var bd = $("lbBadge"); bd.hidden = !warns || state === "err"; bd.textContent = warns + " warning" + (warns === 1 ? "" : "s");
  }
  var LS_KEY = "preventionDash.loadPanelExpanded";
  function setExpanded(open, persist) {
    $("loadPanel").hidden = !open; $("btnDetails").textContent = open ? "Hide details" : "Show details"; $("btnDetails").setAttribute("aria-expanded", String(open));
    if (persist !== false) { try { localStorage.setItem(LS_KEY, open ? "1" : "0"); } catch (e) { /* storage unavailable */ } }
  }
  function setPresent(on) {
    document.body.classList.toggle("present", on); $("btnPresent").setAttribute("aria-pressed", String(on)); $("btnPresent").textContent = on ? "Exit presentation" : "Presentation mode";
    setTimeout(function () { Object.keys(K.charts).forEach(function (k) { K.charts[k].resize(); }); }, 50);
  }

  // ---------- wiring ----------
  function init() {
    K.initCharts();
    $("dictBody").innerHTML = COLS.map(function (c, i) { return "<tr><td>" + (i + 1) + "</td><td><code>" + esc(c[1]) + "</code></td><td>" + esc(c[2].slice(0, 4).join(", ")) + "</td><td>" + esc(c[3]) + "</td></tr>"; }).join("") +
      '<tr><td></td><td colspan="3"><strong>Skipped, never read:</strong> any column named like Name, First / Last Name, SSN, Social Security, DoD ID, EDIPI, DOB, Date of Birth, email, phone or address.</td></tr>' +
      '<tr><td></td><td colspan="3"><strong>Headcount file:</strong> Unit, Grade, Gender, Count (optional Location, Age Band: 17-20, 21-24, 25-29, 30-39, 40+).</td></tr>';
    $("btnLoad").addEventListener("click", function () { $("fileInput").click(); });
    $("fileInput").addEventListener("change", function (e) { loadFiles(e.target.files, false); });
    $("addInput").addEventListener("change", function (e) { loadFiles(e.target.files, true); this.value = ""; });
    $("btnAdd").addEventListener("click", function () { $("addInput").click(); });
    $("btnClear").addEventListener("click", clearFiles);
    $("btnDemo").addEventListener("click", showDemo);
    $("btnSave").addEventListener("click", saveWithData);
    $("btnDetails").addEventListener("click", function () { setExpanded($("loadPanel").hidden); });
    $("btnPresent").addEventListener("click", function () { setPresent(!document.body.classList.contains("present")); });
    $("btnPrint").addEventListener("click", function () { window.print(); });
    $("btnGenAI").addEventListener("click", copyPack);
    $("btnPrintCs").addEventListener("click", printSummary);
    $("showRows").addEventListener("change", function () { S.showAll = false; table(); });
    document.querySelector("main").addEventListener("click", heatClick);
    $("btnGenAITxt").addEventListener("click", downloadPack);
    try { setExpanded(localStorage.getItem(LS_KEY) === "1", false); } catch (e) { setExpanded(false, false); }
    ["dragover", "drop"].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }); });
    ["loadBar", "loadPanel"].forEach(function (id) {
      var el = $(id);
      el.addEventListener("dragover", function (e) { e.preventDefault(); el.classList.add("dragging"); });
      el.addEventListener("dragleave", function () { el.classList.remove("dragging"); });
      el.addEventListener("drop", function (e) { e.preventDefault(); el.classList.remove("dragging"); if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files, e.shiftKey); });
    });
    DIMS.forEach(function (d) { $(d[1]).addEventListener("change", function () { S.showAll = false; render(); }); });
    $("btnReset").addEventListener("click", function () { DIMS.forEach(function (d) { $(d[1]).value = ""; }); $("fSearch").value = ""; S.showAll = false; render(); });
    $("btnCsv").addEventListener("click", exportCsv);
    var st; $("fSearch").addEventListener("input", function () { clearTimeout(st); st = setTimeout(table, 120); });
    $("fSearch").addEventListener("keydown", function (e) { if (e.key === "Escape" && this.value) { e.stopPropagation(); this.value = ""; table(); } });
    $("btnAll").addEventListener("click", function () { S.showAll = !S.showAll; table(); });
    $("tDetail").tHead.addEventListener("click", function (e) { var th = e.target.closest("th[data-k]"); if (!th) return; var k = th.getAttribute("data-k"); S.sort = S.sort.k === k ? { k: k, dir: -S.sort.dir } : { k: k, dir: k === "date" ? -1 : 1 }; table(); });
    $("hcBody").addEventListener("input", hcInput);
    document.querySelectorAll('input[name="hcMode"]').forEach(function (x) { x.addEventListener("change", function () { S.hc.mode = this.value; hcPersist(); hcRender(); render(); }); });
    $("hcGender").addEventListener("change", function () { S.hc.gender = this.checked; hcPersist(); hcRender(); render(); });
    $("hcRemember").addEventListener("change", function () { S.hc.remember = this.checked; hcPersist(); });
    $("hcClear").addEventListener("click", function () { S.hc.unit = {}; S.hc.grade = {}; S.hc.grid = {}; hcPersist(); hcRender(); render(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("present")) setPresent(false); });
    S.hcLocal = hcLoadLocal();
    SAVED = readSaved();
    if (SAVED) { showBanner(); document.title = "REAL DATA \u00b7 " + document.title; loadSaved(); } else loadDemo();
  }
  window.PreventionDash = { packText: packText, analysis: function () { return S.an; }, correlations: function () { return S.corr; }, state: S, parseWhen: function (v) { var w = parseWhen(v); return w ? { date: iso(w.d), h: w.h, mi: w.mi, dow: DOW[(w.d.getUTCDay() + 6) % 7] } : w; }, mapHeader: function (h) { return isPii(h) ? "SKIP" : ALIAS[norm(h)] || null; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
