#!/usr/bin/env python3
"""
Synthetic ASMIS-style accident export for the Safety & Mishaps Dashboard.

Data shown is fictional for demonstration. Not an official Iowa National Guard product.
Every record, number, UIC, CCIR/ASMIS number and narrative is invented. Units come from the
shared fictional roster (data/units.json). No names of people are generated.

Columns match the ASMIS-style Excel export layout exactly (45 columns, same order).
FY25 (Oct 2024) through FY27 to date (export date 29-Oct-26).

Usage:
    python3 data-generation/generate_asmis_data.py [--seed 2026]
Outputs (dashboards/safety/data/ and dashboards/safety/):
    asmis_sample.csv     dates as text DD-Mon-YY, costs as numbers (like a CSV export)
    asmis_sample.xlsx    real Excel dates formatted dd-mmm-yy, currency-formatted costs (needs openpyxl)
    data.js              same rows for the public page (window.ASMIS_DATA)
    asmis_template.csv / asmis_template.xlsx   blank templates with the exact headers
    strength_by_battalion.csv                   fictional assigned strength for rates
"""
import argparse, csv, json, os, random, sys
from datetime import date, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from units_roster import main as build_roster

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dashboards", "safety", "data")
PAGE = os.path.join(ROOT, "dashboards", "safety")
EXPORT_DATE = date(2026, 10, 29)
START = date(2024, 10, 1)

HEADERS = ["Accident #", "CCIR #", "ASMIS #", "ASMIS Investigation Created By", "Unit UIC", "Tech", "Battalion", "Accident Class",
           "Status", "Accident Age", "Accident Date", "Due Date", "Days Overdue", "Compl. Date", "Day of Week", "Time of Day", "On Duty",
           "Duty Status", "Gender", "Years of Service", "Rank", "Age", "Reported Via", "Injury Y/N", "No Lost Time Injury",
           "Days Away from Work", "Days Hospitalized", "Days Restricted", "Days Lost", "Days Away from Work Cost", "Days Hospitalized Cost",
           "Perm. Partial Disability Cost", "Perm. Total Disability Cost", "Fatality Cost", "Injury Cost", "Property Damage Y/N",
           "Material ECOD", "Total Accident Cost", "Accident Subtype", "Cause Subtype", "Mistake Type", "HFACS Category", "HFACS Failure",
           "HFACS Subfailure", "Summary"]
OPTIONAL_HEADERS = ["SUB DATE REPORTED", "Documentation", "Comments", "Assigned To"]  # optional trailing columns
ALL_HEADERS = HEADERS + OPTIONAL_HEADERS
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
CREATORS = ["State Safety Office", "State Safety Specialist", "Brigade Safety Officer", "Battalion Additional Duty Safety Officer",
            "Aviation Safety Officer", "Unit Safety NCO", "Occupational Health Technician"]
HFACS = {
    "Unsafe Acts": {"Errors - Skill-based": ["Inattention", "Poor technique", "Omitted step in procedure"],
                    "Errors - Decision": ["Inadequate risk assessment", "Exceeded ability", "Wrong response to emergency"],
                    "Errors - Perception": ["Misjudged distance/speed", "Visual illusion"],
                    "Violations - Routine": ["Failed to use PPE", "Speeding", "Seat belt not worn"],
                    "Violations - Exceptional": ["Willful disregard of procedure"]},
    "Preconditions for Unsafe Acts": {"Environmental Factors": ["Weather/visibility", "Ice/snow on surface", "Heat stress", "Uneven terrain"],
                                      "Condition of Individuals": ["Fatigue", "Physical conditioning", "Complacency", "Distraction"],
                                      "Personnel Factors": ["Crew coordination", "Inadequate rest"]},
    "Unsafe Supervision": {"Inadequate Supervision": ["Failed to provide oversight", "Failed to provide training"],
                           "Planned Inappropriate Operations": ["Inadequate work/rest cycle", "Rushed timeline"],
                           "Failed to Correct Known Problem": ["Known hazard not corrected"]},
    "Organizational Influences": {"Resource Management": ["Equipment design/maintenance", "Inadequate staffing"],
                                  "Organizational Process": ["Inadequate SOP", "Risk management process not followed"]},
}
MISTAKE = ["Individual", "Leader", "Training", "Standards", "Support"]
# subtype -> (weight, causes, typical classes)
SUBTYPES = {
    "POV":    (22, ["Off Duty", "Vehicle Ops"], "CD"),
    "AMV":    (16, ["Vehicle Ops", "Training", "Maintenance"], "CD"),
    "ACV":    (6,  ["Vehicle Ops", "Training", "Maintenance"], "BCD"),
    "GSA":    (6,  ["Vehicle Ops", "Work-General"], "D"),
    "Air":    (5,  ["Maintenance", "Training"], "BCD"),
    "Injury": (40, ["PT", "Slip/Trip/Fall", "Training", "Work-General", "Maintenance"], "CD"),
    "Other":  (8,  ["Work-General", "Slip/Trip/Fall", "Maintenance"], "D"),
}
SUMMARIES = {
    ("POV", True): ["While traveling home after battle assembly, SM's privately owned vehicle left the roadway on a wet county road and struck a culvert. SM was transported to a local hospital and released.",
                    "SM's POV was rear-ended at a stoplight while driving to drill. SM reported neck pain and missed work for several days."],
    ("POV", False): ["During winter weather, SM lost control of a POV on an icy overpass and struck the guardrail. Vehicle damage only; SM uninjured.",
                     "SM's POV struck a deer on a rural highway at dusk while returning from drill. No injuries; front-end damage."],
    ("AMV", True): ["During convoy movement to the training area, a cargo truck slid on gravel at a turn and entered the ditch. Minor injuries to the assistant driver.",
                    "Driver's hand was caught between the tailgate and bed while securing a load on a light tactical vehicle."],
    ("AMV", False): ["While backing a light tactical vehicle into the motor pool without a ground guide, the driver struck a parked trailer, damaging the rear bumper and trailer tongue.",
                     "Driver misjudged clearance while entering the wash rack and struck the overhead door frame."],
    ("ACV", True): ["During gunnery preparation, a track tensioning procedure was performed without the required tool and the crew member's hand was pinched."],
    ("ACV", False): ["Combat vehicle struck an embankment during night driver training; vehicle damaged, crew uninjured."],
    ("GSA", None): ["GSA vehicle was struck in a parking lot while unattended at a readiness center. No injuries.",
                    "Employee in a GSA vehicle clipped a mirror on a fuel island bollard."],
    ("Air", None): ["During scheduled maintenance, a tool left in an access panel caused minor damage on engine run-up. No injuries.",
                    "Ground handling of an aircraft into the hangar resulted in a rotor blade tip contacting a hangar door."],
    ("Injury", "PT"): ["SM rolled an ankle on uneven ground during the two-mile run portion of a fitness test and was placed on profile.",
                       "During organized PT, SM strained the lower back while performing deadlifts without a proper warm-up."],
    ("Injury", "Slip/Trip/Fall"): ["SM slipped on an icy sidewalk outside the readiness center before first formation and fractured a wrist.",
                                   "SM tripped over an extension cord in the supply cage and struck a knee on a shelf."],
    ("Injury", "Training"): ["During annual training, SM showed signs of heat exhaustion during a ruck march and was evaluated by medics.",
                             "SM sustained a laceration while clearing brush during field training; treated and returned to duty.",
                             "During the range day, SM received a minor burn from a hot casing; eye and skin protection reinforced."],
    ("Injury", "Work-General"): ["SM strained a shoulder while lifting equipment cases into a trailer without assistance.",
                                 "Full-time employee cut a finger on sheet metal while repairing a storage rack."],
    ("Injury", "Maintenance"): ["Mechanic's finger was pinched between a hood and fender while closing the engine compartment.",
                                "During a services weekend, a jack stand shifted and a mechanic sustained a bruised forearm."],
    ("Other", None): ["Weather damage to a storage container door when a strong wind gust caught it during inventory.",
                      "Equipment fell from a pallet during forklift operations; property damage only."],
}

def ddmonyy(d):
    return f"{d.day:02d}-{MON[d.month - 1]}-{str(d.year)[2:]}"

def fy2(d):
    return (d.year + (1 if d.month >= 10 else 0)) % 100

def pick_summary(rng, sub, cause, inj):
    for k in ((sub, inj), (sub, cause), (sub, None)):
        if k in SUMMARIES: return rng.choice(SUMMARIES[k])
    return rng.choice(SUMMARIES[("Other", None)])

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seed", type=int, default=2026); a = ap.parse_args()
    rng = random.Random(a.seed)
    units = build_roster()
    # fictional UICs: W7X + 2 letters + A (pattern only; not real)
    letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    used = set()
    for u in units:
        while True:
            uic = "W7X" + rng.choice(letters) + rng.choice(letters) + "A"
            if uic not in used: used.add(uic); u["uic"] = uic; break
    weights = [u["authorized"] * (1.4 if u["branch"] in ("TC", "EN", "BSB") else 1.0) for u in units]
    rows, ccir_used = [], set()
    days_total = (EXPORT_DATE - START).days
    n = 150
    for i in range(n):
        # seasonality: more events in Jun-Aug (AT) and Dec-Feb (winter)
        while True:
            d = START + timedelta(days=rng.randrange(days_total))
            w = {6: 1.8, 7: 1.9, 8: 1.3, 12: 1.4, 1: 1.6, 2: 1.3}.get(d.month, 1.0)
            if rng.random() < w / 1.9: break
        u = rng.choices(units, weights)[0]
        sub = rng.choices(list(SUBTYPES), [v[0] for v in SUBTYPES.values()])[0]
        if sub == "Air" and u["branch"] != "AV": u = rng.choice([x for x in units if x["branch"] == "AV"])
        _, causes, classes = SUBTYPES[sub]
        cause = rng.choice(causes)
        on_duty = not (sub == "POV" and rng.random() < 0.75) and cause != "Off Duty"
        if sub == "POV" and not on_duty: cause = "Off Duty"
        duty_status = ("AT" if d.month in (6, 7) and rng.random() < 0.7 else rng.choices(["MDAY", "AGR", "ADOS"], [0.6, 0.3, 0.1])[0]) if on_duty else rng.choices(["MDAY", "AGR", "ADOS"], [0.75, 0.2, 0.05])[0]
        cls = rng.choice(classes)
        if rng.random() < 0.025: cls = "B"
        injury = sub in ("Injury",) or (sub in ("POV", "AMV", "ACV") and rng.random() < 0.45)
        prop = sub != "Injury" and (rng.random() < 0.85)
        # injury days & costs
        away = hosp = restr = 0
        c_away = c_hosp = c_ppd = c_ptd = c_fat = 0
        if injury:
            if cls in "AB": away, hosp, restr = rng.randint(30, 120), rng.randint(2, 12), rng.randint(20, 90)
            elif cls == "C": away, hosp, restr = rng.randint(1, 12), rng.choice([0, 0, 0, 1, 2]), rng.randint(0, 20)
            else: away, hosp, restr = 0, 0, rng.randint(0, 6)
            c_away = away * rng.randint(420, 520)
            c_hosp = hosp * rng.randint(2600, 3400)
            if cls == "B" and rng.random() < 0.5: c_ppd = rng.randint(650_000, 1_100_000)
        ecod = None
        if prop:
            ecod = {"A": rng.randint(2_600_000, 3_200_000), "B": rng.randint(620_000, 1_400_000), "C": rng.randint(60_000, 240_000)}.get(cls, rng.randint(25_000, 59_000))
            if injury and cls in "CD" and rng.random() < 0.5: ecod = rng.randint(3_000, 24_000)
        if cls == "D" and not prop and injury:
            pass
        rows.append(dict(_d=d, _u=u, _sub=sub, _cause=cause, _on=on_duty, _ds=duty_status, _cls=cls, _inj=injury, _prop=prop,
                         away=away, hosp=hosp, restr=restr, c_away=c_away, c_hosp=c_hosp, c_ppd=c_ppd, c_ptd=c_ptd, c_fat=c_fat, ecod=ecod))
    # exactly one Class A: off-duty POV in winter FY25 with PTD cost (no fatality)
    pov = [r for r in rows if r["_sub"] == "POV" and not r["_on"] and r["_d"].month in (12, 1, 2)]
    if pov:
        r = pov[0]; r.update(_cls="A", _inj=True, away=240, hosp=21, restr=0, c_away=240 * 480, c_hosp=21 * 3100, c_ptd=2_450_000, ecod=rng.randint(18_000, 32_000))
    rows.sort(key=lambda r: r["_d"])
    out = []
    for i, r in enumerate(rows, 1):
        d, u = r["_d"], r["_u"]
        while True:
            ccir = f"{fy2(d):02d}-{rng.randint(1000, 9999)}"
            if ccir not in ccir_used: ccir_used.add(ccir); break
        age_days = (EXPORT_DATE - d).days
        due = d + timedelta(days=90)
        # investigation status by age
        if age_days > 365: status = "Final" if rng.random() < 0.98 else "In Review NGB"
        elif age_days > 180: status = "Final" if rng.random() < 0.90 else rng.choice(["In Review NGB", "Investigation Ongoing"])
        elif age_days > 90: status = rng.choices(["Final", "In Review NGB", "Investigation Ongoing"], [0.6, 0.25, 0.15])[0]
        elif age_days > 30: status = rng.choices(["Final", "In Review NGB", "Investigation Ongoing"], [0.2, 0.35, 0.45])[0]
        else: status = "Investigation Ongoing"
        compl = None
        if status == "Final":
            compl = d + timedelta(days=min(age_days, rng.randint(25, 140)))
        overdue = "" if status == "Final" else max(0, (EXPORT_DATE - due).days)
        injury_cost = r["c_away"] + r["c_hosp"] + r["c_ppd"] + r["c_ptd"] + r["c_fat"]
        total = injury_cost + (r["ecod"] or 0)
        rank_pool = [("PV2", 1, 19), ("PFC", 1, 20), ("SPC", 2, 22), ("SGT", 4, 26), ("SSG", 7, 30), ("SFC", 11, 35), ("1SG", 15, 40),
                     ("WO1", 6, 29), ("CW2", 9, 33), ("2LT", 1, 23), ("1LT", 3, 26), ("CPT", 6, 30), ("MAJ", 12, 37)]
        rk, yos0, age0 = rng.choices(rank_pool, [5, 7, 14, 11, 8, 4, 1, 1, 1, 2, 2, 2, 1])[0]
        yos = max(0, yos0 + rng.randint(-1, 3)); age = max(18, age0 + rng.randint(-1, 5))
        if r["_ds"] == "AGR": yos += 4; age += 4
        hf_cat = rng.choices(list(HFACS), [0.5, 0.25, 0.17, 0.08])[0]
        hf_fail = rng.choice(list(HFACS[hf_cat])); hf_sub = rng.choice(HFACS[hf_cat][hf_fail])
        if r["_sub"] == "POV" and d.month in (12, 1, 2): hf_cat, hf_fail, hf_sub = "Preconditions for Unsafe Acts", "Environmental Factors", "Ice/snow on surface"
        hour = rng.choices(range(24), [1, 1, 1, 1, 1, 2, 5, 7, 9, 9, 8, 6, 5, 7, 8, 8, 7, 6, 5, 4, 3, 3, 2, 1])[0]
        tod = f"{hour:02d}{rng.choice(['00', '15', '30', '45'])}"
        summary = pick_summary(rng, r["_sub"], r["_cause"], r["_inj"])
        out.append({
            "Accident #": f"{fy2(d):02d}{i:05d}",
            "CCIR #": ccir,
            # newest open cases often have no ASMIS # yet (entered once the investigation is created);
            # the draw is always made so the rest of the seeded data is unchanged
            "ASMIS #": (lambda n: "" if status == "Investigation Ongoing" and age_days <= 45 and i % 2 == 0 else n)(f"{d.year}{rng.randint(100000, 999999)}"),
            "ASMIS Investigation Created By": rng.choice(CREATORS),
            "Unit UIC": u["uic"], "Tech": u["brigade"], "Battalion": u["battalion"],
            "Accident Class": r["_cls"], "Status": status, "Accident Age": age_days,
            "Accident Date": d, "Due Date": due, "Days Overdue": overdue, "Compl. Date": compl,
            "Day of Week": DOW[d.weekday()], "Time of Day": tod,
            "On Duty": "Yes" if r["_on"] else "No", "Duty Status": r["_ds"],
            "Gender": rng.choices(["M", "F"], [0.82, 0.18])[0], "Years of Service": yos, "Rank": rk, "Age": age,
            "Reported Via": "CCIR",
            "Injury Y/N": "Y" if r["_inj"] else "N",
            "No Lost Time Injury": "Y" if r["_inj"] and r["away"] == 0 and r["hosp"] == 0 else "N",
            "Days Away from Work": r["away"], "Days Hospitalized": r["hosp"], "Days Restricted": r["restr"],
            "Days Lost": r["away"] + r["hosp"],
            "Days Away from Work Cost": r["c_away"], "Days Hospitalized Cost": r["c_hosp"],
            "Perm. Partial Disability Cost": r["c_ppd"], "Perm. Total Disability Cost": r["c_ptd"], "Fatality Cost": r["c_fat"],
            "Injury Cost": injury_cost, "Property Damage Y/N": "Y" if r["ecod"] else "N",
            "Material ECOD": r["ecod"], "Total Accident Cost": total,
            "Accident Subtype": r["_sub"], "Cause Subtype": r["_cause"], "Mistake Type": rng.choice(MISTAKE),
            "HFACS Category": hf_cat, "HFACS Failure": hf_fail, "HFACS Subfailure": hf_sub,
            "Summary": summary + " (Fictional record for demonstration.)",
        })
    # ---- extra class codes seen in real exports: E - grnd, R - NG, blank (not yet classified) ----
    r2 = random.Random(a.seed + 1)
    d_final = [r for r in out if r["Accident Class"] == "D" and r["Status"] == "Final"]
    for r in r2.sample(d_final, 10):
        r["Accident Class"] = "E - grnd"
        if r["Material ECOD"]: r["Material ECOD"] = r2.randint(1_500, 22_000)
        r["Total Accident Cost"] = r["Injury Cost"] + (r["Material ECOD"] or 0)
    d_left = [r for r in out if r["Accident Class"] == "D"]
    for r in r2.sample(d_left, 5): r["Accident Class"] = "R - NG"
    recent_open = [r for r in out if r["Status"] != "Final" and r["Accident Age"] <= 75]
    for r in r2.sample(recent_open, min(7, len(recent_open))): r["Accident Class"] = ""
    # ---- optional trailing columns present in some exports ----
    for r in out:
        d = r["Accident Date"]; is_open = r["Status"] != "Final"
        r["SUB DATE REPORTED"] = d + timedelta(days=r2.choice([0, 0, 1, 1, 2, 3, 5]))
        r["Documentation"] = r2.choice(["Witness statements pending", "Draft report in progress", "Awaiting command endorsement", ""]) if is_open else r2.choice(["Final report on file", "Abbreviated report on file", "Final report on file"])
        r["Comments"] = r2.choice(["Unit requested extension", "Pending medical update", "Returned for corrections", "Awaiting cost data", "", ""]) if is_open else ""
        r["Assigned To"] = r2.choice(["Unit Safety Officer", "Battalion Safety NCO", "State Safety Specialist", "Occupational Health Technician"]) if is_open else r2.choice(["State Safety Specialist", "Battalion Safety NCO"])
    HEADERS = ALL_HEADERS
    os.makedirs(OUT, exist_ok=True)
    def textrow(r):
        o = {}
        for h in HEADERS:
            v = r[h]
            if isinstance(v, date): v = ddmonyy(v)
            o[h] = "" if v is None else v
        return o
    text_rows = [textrow(r) for r in out]
    with open(os.path.join(OUT, "asmis_sample.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADERS); w.writeheader(); w.writerows(text_rows)
    with open(os.path.join(PAGE, "asmis_template.csv"), "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(HEADERS)
    # strength for rates (fictional): assigned ~ 92% of authorized
    bn = {}
    for u in units:
        k = (u["brigade"], u["battalion"]); bn[k] = bn.get(k, 0) + u["authorized"]
    strength = [{"MSC": k[0], "Battalion": k[1], "Assigned": int(v * 0.92)} for k, v in bn.items()]
    with open(os.path.join(OUT, "strength_by_battalion.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["MSC", "Battalion", "Assigned"]); w.writeheader(); w.writerows(strength)
    with open(os.path.join(OUT, "data.js"), "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED by data-generation/generate_asmis_data.py - fictional data in ASMIS export layout\n")
        f.write("window.ASMIS_DATA = " + json.dumps(dict(exportDate=EXPORT_DATE.isoformat(), headers=HEADERS, rows=text_rows, strength=strength,
                                                    note="Data shown is fictional for demonstration."), separators=(",", ":")) + ";\n")
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font
        from datetime import datetime
        cur = '"$"#,##0.00'
        money_cols = {h for h in HEADERS if h.endswith("Cost") or h == "Material ECOD"}
        date_cols = {"Accident Date", "Due Date", "Compl. Date", "SUB DATE REPORTED"}
        wb = Workbook(); ws = wb.active; ws.title = "ASMIS Export"
        ws.append(HEADERS)
        for c in ws[1]: c.font = Font(bold=True)
        for r in out:
            ws.append([datetime(r[h].year, r[h].month, r[h].day) if isinstance(r[h], date) else (None if r[h] in ("", None) else r[h]) for h in HEADERS])
        for col_idx, h in enumerate(HEADERS, 1):
            for row in ws.iter_rows(min_row=2, min_col=col_idx, max_col=col_idx):
                for c in row:
                    if h in date_cols and c.value is not None: c.number_format = "dd-mmm-yy"
                    elif h in money_cols and c.value is not None: c.number_format = cur
        ws2 = wb.create_sheet("Strength"); ws2.append(["MSC", "Battalion", "Assigned"])
        for s in strength: ws2.append([s["MSC"], s["Battalion"], s["Assigned"]])
        wb.save(os.path.join(OUT, "asmis_sample.xlsx"))
        wt = Workbook(); wst = wt.active; wst.title = "ASMIS Export"; wst.append(HEADERS)
        for c in wst[1]: c.font = Font(bold=True)
        wt.save(os.path.join(PAGE, "asmis_template.xlsx"))
        print("xlsx written")
    except ImportError:
        print("openpyxl not installed: skipped .xlsx outputs (pip install openpyxl)")
    from collections import Counter
    print(len(out), "records;", Counter(r["Accident Class"] for r in out), Counter(r["Status"] for r in out))
    print("overdue open:", sum(1 for r in out if r["Status"] != "Final" and r["Days Overdue"] not in ("", 0)))

if __name__ == "__main__":
    main()
