#!/usr/bin/env python3
"""Fictional alcohol-incident data for the Incident Trends & Prevention dashboard. FICTIONAL DATA ONLY.

No real people: Person IDs are random pseudonyms (P-0001 ...), units come from the shared fictional roster
(data/units.json). Built-in patterns so the dashboard has trends to find: young E-3/E-4, male, (internally: single; marital status is not written out),
0-12 months after redeployment, holiday and payday windows, two higher-rate units; finishing the program cuts repeats.

Writes:
  dashboards/prevention/data/prevention_demo.js   built-in demo (window.PREV_DEMO: incidents + roster)
  dashboards/prevention/prevention_demo.xlsx      same incidents as Excel (sheet Incidents; blank Last Name/SSN/DOB
                                                  columns show the dashboard skipping personal identifiers)
  dashboards/prevention/prevention_roster_demo.xlsx  fictional headcount (Unit, Location, Grade, Gender, Age Band, Count)
  dashboards/prevention/prevention_template.xlsx  blank incident template (headers only) + Read me
  dashboards/prevention/roster_template.xlsx      blank headcount template (headers only)
  downloads/prevention-*.xlsx                     copies for the home page download buttons
Usage: python3 data-generation/generate_prevention_data.py   (needs openpyxl)
"""
import datetime as dt, json, os, random, shutil
import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "dashboards", "prevention")
DL = os.path.join(ROOT, "downloads")
rng = random.Random(4242)

# Core columns = the real tracker's headers (Last / First are left out: the dashboard skips name columns unread), then optional ones
CORE = ["TY", "Grade", "DTG of Incident", "Location", "Duty Status", "Age", "Gender", "Unit"]
OPTIONAL = ["Person ID", "Status", "MOS", "Time in Service (yrs)", "Dependents", "Incident Type",
            "Months Since Deployment", "Prior Incidents", "Referred to Treatment", "Completed Program", "Repeat Incident", "Outcome"]
HEADERS = CORE + OPTIONAL
ROSTER_HEADERS = ["Unit", "Location", "Grade", "Gender", "Age Band", "Count"]
PII_DEMO = ["Last", "First"]                    # always blank in the demo file; the dashboard skips them by header

units = json.load(open(os.path.join(ROOT, "data", "units.json")))["units"]
START, END = dt.date(2022, 10, 1), dt.date(2026, 9, 30)     # FY23 .. FY26
DAYS = (END - START).days + 1
# battalions that came home from a (fictional) deployment, and when
REDEPLOY = {"829th Engineer Bn": dt.date(2024, 6, 15), "2-512th Infantry Bn": dt.date(2023, 2, 10), "572nd Transportation Bn": dt.date(2025, 8, 20)}
HOT_UNITS = {"572nd TC": 1.7, "445th CAV": 1.45}           # higher-rate battalions (by short name)
MOS = {"INF": ["11B", "11C", "11B", "11B"], "CAV": ["19D", "19K", "19D"], "FA": ["13B", "13F", "13J"], "BSB": ["88M", "92A", "91B", "68W"],
       "EN": ["12B", "12N", "12W"], "TC": ["88M", "88M", "88N"], "AV": ["15T", "15U", "15P"], "SC": ["25U", "25B", "25Q"]}
GRADES = [("E-1", 2), ("E-2", 4), ("E-3", 9), ("E-4", 22), ("E-5", 17), ("E-6", 12), ("E-7", 7), ("E-8", 2), ("E-9", .6),
          ("W-2", 1.2), ("O-1", 2), ("O-2", 2.4), ("O-3", 2.4), ("O-4", 1.2), ("O-5", .5)]
G_AGE = {"E-1": (18, 20), "E-2": (18, 21), "E-3": (18, 23), "E-4": (20, 28), "E-5": (23, 33), "E-6": (27, 38), "E-7": (31, 43), "E-8": (36, 48),
         "E-9": (40, 52), "W-2": (28, 44), "O-1": (22, 26), "O-2": (24, 29), "O-3": (27, 36), "O-4": (33, 44), "O-5": (38, 50)}
G_RISK = {"E-1": 1.3, "E-2": 1.4, "E-3": 1.9, "E-4": 1.8, "E-5": .95, "E-6": .55, "E-7": .4, "E-8": .3, "E-9": .25, "W-2": .35,
          "O-1": .6, "O-2": .5, "O-3": .35, "O-4": .25, "O-5": .2}

def age_band(a):
    return "17-20" if a <= 20 else "21-24" if a <= 24 else "25-29" if a <= 29 else "30-39" if a <= 39 else "40+"

# ---------- fictional population ----------
people = []
for u in units:
    for _ in range(u["authorized"]):
        g = rng.choices([x[0] for x in GRADES], [x[1] for x in GRADES])[0]
        lo, hi = G_AGE[g]; age0 = rng.randint(lo, hi)                     # age on 1 Oct 2022
        tis = max(0.2, round(min(age0 - 17.5, rng.uniform(0.3, 1.0) * (age0 - 17)), 1))
        married = rng.random() < (0.12 if age0 < 22 else 0.38 if age0 < 26 else 0.62 if age0 < 35 else 0.74)
        marital = "Married" if married else rng.choices(["Single", "Divorced"], [9, 1 if age0 < 30 else 3])[0]
        deps = (rng.choice([0, 1, 1, 2, 2, 3, 4]) if married else rng.choice([0, 0, 0, 0, 1])) if age0 > 19 else 0
        st = rng.choices(["Traditional (M-Day)", "AGR", "Technician"], [82, 9, 9])[0]
        r = G_RISK[g] * (1.3 if marital == "Single" else 1.05 if marital == "Divorced" else .62) * HOT_UNITS.get(u["battalion_short"], 1.0)
        r *= 1.6 if age0 <= 20 else 1.45 if age0 <= 24 else 1.0 if age0 <= 29 else .65 if age0 <= 39 else .45
        r *= .82 if st != "Traditional (M-Day)" else 1.0
        gen = "Female" if rng.random() < .16 else "Male"
        r *= .62 if gen == "Female" else 1.0
        prev_dep = rng.random() < (0.45 if tis > 8 else 0.12)
        people.append(dict(u=u, grade=g, age0=age0, tis=tis, marital=marital, deps=deps, status=st, gender=gen, risk=r,
                           mos=rng.choice(MOS[u["branch"]]) if g[0] == "E" else ("Officer " + u["branch"]) if g[0] == "O" else "Warrant",
                           old_dep=START - dt.timedelta(days=rng.randint(400, 3000)) if prev_dep else None, n=0))

# ---------- calendar effects ----------
def nth_wd(y, m, wd, n):
    d = dt.date(y, m, 1); d += dt.timedelta(days=(wd - d.weekday()) % 7); return d + dt.timedelta(weeks=n - 1)
def last_wd(y, m, wd):
    d = dt.date(y, m + 1, 1) - dt.timedelta(days=1); return d - dt.timedelta(days=(d.weekday() - wd) % 7)
def holidays(y):
    return [dt.date(y, 1, 1), nth_wd(y, 1, 0, 3), nth_wd(y, 2, 0, 3), dt.date(y, 3, 17), last_wd(y, 5, 0), dt.date(y, 6, 19), dt.date(y, 7, 4),
            nth_wd(y, 9, 0, 1), nth_wd(y, 10, 0, 2), dt.date(y, 11, 11), nth_wd(y, 11, 3, 4), dt.date(y, 12, 25)]
HOL = [h for y in range(2021, 2028) for h in holidays(y)]
BIG = {(1, 1), (7, 4), (3, 17), (12, 25)}
def day_weight(d):
    w = 1.0
    near = min(abs((d - h).days) for h in HOL)
    if near <= 3: w *= 2.1 if any(abs((d - h).days) <= 3 and (h.month, h.day) in BIG for h in HOL) else 1.6
    if d.day in (1, 2, 3, 4, 15, 16, 17, 18): w *= 1.9                      # 0-3 days after the 1st / 15th payday
    if d.weekday() >= 4: w *= 1.6                                           # Fri-Sun
    if d.month in (6, 7, 12): w *= 1.15
    w *= 1 + 0.08 * ((d - START).days / DAYS)                              # gentle upward trend
    return w
CAL = [START + dt.timedelta(days=i) for i in range(DAYS)]
CW = [day_weight(d) for d in CAL]
def drill_weekend(d):      # second full weekend of the month
    s = nth_wd(d.year, d.month, 5, 2); return s <= d <= s + dt.timedelta(days=1)
def at_window(p, d):       # two weeks of annual training in June or July, by unit
    m = 6 if sum(map(ord, p["u"]["battalion"])) % 2 else 7; return d.month == m and 8 <= d.day <= 22

def months_since_dep(p, d):
    ret = REDEPLOY.get(p["u"]["battalion"])
    cands = [x for x in (ret, p["old_dep"]) if x and x <= d]
    if not cands: return None
    last = max(cands); return (d.year - last.year) * 12 + d.month - last.month - (1 if d.day < last.day else 0)

# ---------- incidents ----------
TYPES_YOUNG = (["Underage Drinking", "DUI", "Public Intoxication", "Duty-Related", "Self-Referral", "Other"], [44, 24, 15, 6, 6, 5])
TYPES = (["DUI", "Public Intoxication", "Duty-Related", "Self-Referral", "Other"], [46, 20, 12, 13, 9])
incidents = []
def incident(p, d, prior):
    age = p["age0"] + (d - START).days // 365
    msd = months_since_dep(p, d)
    young = age < 21
    t = rng.choices(*(TYPES_YOUNG if young else TYPES))[0]
    if drill_weekend(d) and rng.random() < .35: duty = "Drill"
    elif at_window(p, d) and rng.random() < .5: duty = "AT"
    elif p["status"] != "Traditional (M-Day)" and d.weekday() < 5 and rng.random() < .25: duty = "On Duty"
    else: duty = "Off Duty"
    if t == "Duty-Related" and duty == "Off Duty": duty = rng.choice(["Drill", "On Duty", "AT"])
    ref = "Y" if (t == "Self-Referral" or rng.random() < (.78 if prior == 0 else .9)) else "N"
    comp = ("Y" if rng.random() < (.66 if p["marital"] == "Married" else .55) else "N") if ref == "Y" else "N"
    rec = dict(p=p, d=d, age=age, msd=msd, t=t, duty=duty, ref=ref, comp=comp, prior=prior, rep="N")
    incidents.append(rec); return rec

for p in people:
    base = 0.0150 * p["risk"]                                               # chance per year of a first incident
    for fy in range(4):
        if p["n"]: break
        lam = base
        ret = REDEPLOY.get(p["u"]["battalion"])
        if rng.random() < lam:
            # pick the day: redeployed units concentrate in the 12 months after return
            if ret and START + dt.timedelta(days=365 * fy) <= ret + dt.timedelta(days=365) and rng.random() < .55:
                lo = max((ret - START).days + 20, 365 * fy); hi = min(lo + 330, DAYS - 1)
                idx = rng.choices(range(lo, hi), CW[lo:hi])[0] if hi > lo else rng.choices(range(DAYS), CW)[0]
            else:
                lo, hi = 365 * fy, min(365 * (fy + 1), DAYS)
                idx = rng.choices(range(lo, hi), CW[lo:hi])[0]
            prior = rng.choices([0, 1, 2], [86, 11, 3])[0]
            r = incident(p, CAL[idx], prior); p["n"] = 1
            # repeats: finishing the program cuts the chance of another incident
            while True:
                pr = .11 if r["comp"] == "Y" else .36 if r["ref"] == "Y" else .42
                if r["msd"] is not None and r["msd"] <= 12: pr *= 1.25
                if rng.random() >= pr: break
                lo = (r["d"] - START).days + 30; hi = min(lo + 540, DAYS)
                if hi - lo < 15: break
                nxt = CAL[rng.choices(range(lo, hi), CW[lo:hi])[0]]
                r["rep"] = "Y"; p["n"] += 1
                r = incident(p, nxt, r["prior"] + 1)
# a few extra recent incidents with a redeployment spike
incidents.sort(key=lambda r: r["d"])
ids = list(range(1, 10000)); rng.shuffle(ids); pid = {}
def outcome(r):
    if r["rep"] == "Y" or r["prior"] >= 2:
        return rng.choices(["Separated", "Flagged / Pending", "Retained (counseling)"], [45, 35, 20])[0]
    if r["t"] == "DUI" and r["duty"] != "Off Duty": return rng.choice(["Separated", "Flagged / Pending"])
    if r["d"] > END - dt.timedelta(days=90): return "Flagged / Pending"
    return rng.choices(["Retained", "Retained (counseling)", "Flagged / Pending", "Separated"], [48, 30, 14, 8])[0]
MONS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
HOUR_W = [14, 12, 9, 5, 2, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 4, 5, 6, 8, 10, 12, 14]   # evenings and late nights
def hour_for(r):
    if r["duty"] in ("On Duty", "Drill", "AT") and rng.random() < .7: return rng.randint(7, 17)
    w = HOUR_W if r["d"].weekday() >= 4 else [x if i < 18 and i > 3 else x * .7 for i, x in enumerate(HOUR_W)]
    return rng.choices(range(24), w)[0]
def dtg(d, h=None, m=None): return "%02d%s%02d" % (d.day, MONS[d.month - 1], d.year % 100)   # date only, like the real tracker
rows = []
for r in incidents:
    p = r["p"]
    if id(p) not in pid: pid[id(p)] = "P-%04d" % ids.pop()
    h, mi = hour_for(r), rng.choice([0, 5, 10, 15, 20, 30, 40, 45, 50])
    r["sort"] = (r["d"], h, mi)
    core = [r["d"].year, p["grade"], dtg(r["d"], h, mi), p["u"]["location"], r["duty"], r["age"], p["gender"], p["u"]["unit_name"]]
    opt = [pid[id(p)], p["status"], p["mos"], round(p["tis"] + (r["d"] - START).days / 365.25, 1), p["deps"], r["t"],
           "" if r["msd"] is None else r["msd"], r["prior"], r["ref"], "" if r["ref"] == "N" else r["comp"], r["rep"], outcome(r)]
    rows.append((r["sort"], core + opt))
rows = [x[1] for x in sorted(rows, key=lambda x: x[0])]
I = {h: i for i, h in enumerate(HEADERS)}

# ---------- roster (headcount per group; age at mid-period) ----------
cnt = {}
for p in people:
    k = (p["u"]["unit_name"], p["u"]["location"], p["grade"], p["gender"], age_band(p["age0"] + 2))
    cnt[k] = cnt.get(k, 0) + 1
roster = [list(k) + [v] for k, v in sorted(cnt.items())]

# ---------- write ----------
def fy_of(r):
    d = r[I["DTG of Incident"]]; mo = MONS.index(d[2:5]) + 1; y = 2000 + int(d[5:7]); return y + 1 if mo >= 10 else y
expect = dict(incidents=len(rows), people=len(set(r[I["Person ID"]] for r in rows)), assigned=len(people),
              repeatRows=sum(1 for r in rows if r[I["Repeat Incident"]] == "Y"), referred=sum(1 for r in rows if r[I["Referred to Treatment"]] == "Y"),
              completed=sum(1 for r in rows if r[I["Completed Program"]] == "Y"), fy26=sum(1 for r in rows if fy_of(r) == 2026))
with open(os.path.join(DIR, "data", "prevention_demo.js"), "w") as f:
    f.write("/* FICTIONAL demo data for the Incident Trends & Prevention dashboard. Generated by data-generation/generate_prevention_data.py.\n"
            "   No real people: Person IDs are random pseudonyms. Data shown is fictional for demonstration. */\n")
    f.write("window.PREV_DEMO = " + json.dumps(dict(headers=HEADERS, rows=rows, roster=dict(headers=ROSTER_HEADERS, rows=roster), expect=expect), separators=(",", ":")) + ";\n")

HEAD = Font(bold=True, color="FFFFFF"); FILL = PatternFill("solid", fgColor="24406A")
def sheet(ws, headers, data, dates=()):
    ws.append(headers)
    for c in ws[1]: c.font, c.fill = HEAD, FILL
    for r in data: ws.append(r)
    for i, h in enumerate(headers, 1):
        ws.column_dimensions[get_column_letter(i)].width = max(11, len(h) + 3)
        if h in dates:
            for row in ws.iter_rows(min_row=2, min_col=i, max_col=i):
                for c in row: c.number_format = "m/d/yyyy"
    ws.freeze_panes = "A2"
def book(path, sheets, readme=None):
    wb = openpyxl.Workbook(); wb.remove(wb.active)
    for name, headers, data, dates in sheets: sheet(wb.create_sheet(name), headers, data, dates)
    if readme:
        ws = wb.create_sheet("Read me")
        for line in readme: ws.append([line])
        ws.column_dimensions["A"].width = 120
    wb.properties.creator = wb.properties.lastModifiedBy = "Prevention Program"
    wb.save(path)

# demo workbook in the real tracker's layout: TY, Grade, Last, First, DTG of Incident, Location, Duty Status, Age, Gender, Unit, then optional
XH = ["TY", "Grade", "Last", "First", "DTG of Incident", "Location", "Duty Status", "Age", "Gender", "Unit"] + OPTIONAL
demo_x = [[r[I[h]] if h in I else "" for h in XH] for r in rows]
book(os.path.join(DIR, "prevention_demo.xlsx"), [("Incidents", XH, demo_x, ())],
     ["FICTIONAL demo data. Not real people. Person IDs are random pseudonyms.",
      "Last and First are left blank on purpose: the dashboard skips name columns by header and never reads them.",
      "DTG of Incident is a date only, for example 02NOV26 (2 Nov 2026)."])
book(os.path.join(DIR, "prevention_roster_demo.xlsx"), [("Roster", ROSTER_HEADERS, roster, ())],
     ["FICTIONAL headcount. One row per group: Unit, Grade, Gender, Count (Location and Age Band optional)."])
GUIDE = ["INCIDENT TEMPLATE: one row per incident. Headers match regardless of case, spaces or underscores.",
         "Core columns (your tracker): TY, Grade, DTG of Incident, Location, Duty Status, Age, Gender, Unit. The rest are optional; add any you have.",
         "Last / First are left out on purpose. If your sheet has them, the dashboard skips them without reading them.",
         "DTG of Incident: a date such as 02NOV26, 02 NOV 26, 02NOV2026, an Excel date or 11/2/2026. A time is optional (021430ZNOV26); it is used only when present.",
         "Do NOT add names, SSN, DoD ID / EDIPI or date of birth. If your export has them, the dashboard skips those columns without reading them.",
         "Person ID: any pseudonymous ID (for example P-0001) so repeat incidents by the same person can be counted.",
         "Status: Traditional (M-Day) / TS, AGR, Technician.  Grade: E-1..E-9, W-1..W-5, O-1..O-10 (E4, SPC etc. accepted).",
         "Incident Type: DUI, Underage Drinking, Public Intoxication, Duty-Related, Self-Referral, Other.  Duty Status: On Duty, Drill, AT, Off Duty.",
         "Months Since Deployment: blank = never deployed.  Referred / Completed / Repeat: Y or N.",
         "Outcome: for example Retained, Retained (counseling), Flagged / Pending, Separated."]
book(os.path.join(DIR, "prevention_template.xlsx"), [("Incidents", HEADERS, [], ())], GUIDE)
book(os.path.join(DIR, "roster_template.xlsx"), [("Roster", ROSTER_HEADERS, [], ())],
     ["HEADCOUNT (ROSTER) TEMPLATE: one row per group with how many people are assigned. No names or IDs.",
      "Required: Unit, Grade, Gender, Count. Optional: Location, Age Band (17-20, 21-24, 25-29, 30-39, 40+).",
      "Unit names must match the Unit column in the incident file. Used to compute incidents per 1,000 assigned."])
for a, b in (("prevention_template.xlsx", "prevention-template.xlsx"), ("prevention_demo.xlsx", "prevention-demo-data.xlsx"),
             ("roster_template.xlsx", "prevention-roster-template.xlsx"), ("prevention_roster_demo.xlsx", "prevention-roster-demo.xlsx")):
    shutil.copyfile(os.path.join(DIR, a), os.path.join(DL, b))
print(expect, "roster rows", len(roster))
