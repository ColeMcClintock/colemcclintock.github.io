#!/usr/bin/env python3
"""Fictional demo data + blank templates for the Aviation Dashboard (dashboards/command). FICTIONAL DATA ONLY.

Writes:
  dashboards/command/data/command_demo.js     built-in demo for the hosted copy (window.COMMAND_DEMO: 4 PR files + 3 fuel trackers,
                                              each as the cell grid of its first sheet). Status of Funds demo reuses
                                              dashboards/finance/data/funds_demo.js.
  dashboards/command/data/demo/*.xlsx         the same demo files as Excel (L1..L4.xlsx, <AASF>.xlsx) to try the upload
  dashboards/command/pr_template.xlsx         blank PR layout (5 columns the dashboard reads)
  dashboards/command/fuel_tracker_template.xlsx  blank AASF fuel tracker (budget in B1, header on row 13)
  dashboards/command/<finance templates>      copies of the Status of Funds templates so they are offered in the page
  downloads/command-pr-template.xlsx, downloads/command-fuel-tracker-template.xlsx
The PR files carry many extra columns (ignored), multi-line PRs (most with per-line values, some repeating the PR total on every
line), a few PRs still listed in a lower level after moving up, and a total row. Fuel trackers mix Excel dates with text dates
and end with a blank row and a TOTAL row.
Usage: python3 data-generation/generate_command_data.py      (needs openpyxl)
"""
import datetime as dt, json, os, random, shutil
import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "dashboards", "command")
FIN = os.path.join(ROOT, "dashboards", "finance")
DL = os.path.join(ROOT, "downloads")
DEMO = os.path.join(DIR, "data", "demo")
rng = random.Random(4127)

# ---------------- PR files (L1..L4) ----------------
PR_HEADERS = ["Purchase requisition", "Item of requisition", "Document Type", "Requisition Date", "Cardholder Name", "Requisitioner",
              "Purchasing Group", "Plant", "Material Group", "Merchant / Description", "Short Text", "Quantity", "Unit of Measure",
              "Valuation Price", "Total Value", "Currency", "Release Indicator", "Processing status", "Delivery Date", "Created By",
              "Fund", "Funds Center", "Functional Area", "GL Account", "Tracking Number"]
FIRST = ["james", "maria", "robert", "ashley", "michael", "jennifer", "david", "sarah", "chris", "amanda", "kevin", "nicole", "brian", "megan", "tyler"]
MIDDLE = ["a", "b", "c", "d", "e", "j", "l", "m", "r", "t", "w"]
LAST = ["anderson", "baker", "carlson", "dvorak", "erickson", "fischer", "grady", "hansen", "iverson", "jorgensen", "kowalski", "lindqvist", "mccoy", "o'neil", "smith-ruiz"]
CARDHOLDERS = []
for i in range(12):
    f, m, l = FIRST[i], MIDDLE[i % len(MIDDLE)], LAST[i]
    s = f"{f}.{m}.{l}" if i % 4 else f"{f}.{l}"                          # some have no middle initial
    if i % 3 == 0: s += ".mil@army.mil"                                   # some carry the .mil suffix + domain
    elif i % 5 == 1: s += "@army.mil"
    CARDHOLDERS.append(s.upper() if i == 7 else s)
MERCHANTS = [("Hawkeye Office Supply", ["Toner cartridges", "Copy paper 10 case", "Office chairs", "Desk organizers"]),
             ("Prairie Tool & Hardware", ["Torque wrench set", "Shop rags", "Safety glasses", "Extension cords"]),
             ("Midwest Aviation Parts", ["Rotor blade tape", "Hydraulic fittings", "Aviation sealant", "Cockpit lighting kit"]),
             ("Cornbelt Catering", ["Drill weekend meals", "Water and ice", "Annual training meals"]),
             ("Riverbend IT Solutions", ["Docking stations", "USB-C cables", "Monitors 27 in", "Label printer"]),
             ("Heartland Uniform Co", ["Name tapes", "Reflective belts", "Cold weather gloves"]),
             ("Linn County Lumber", ["Plywood sheets", "2x4 studs", "Range target frames"]),
             ("Cedar Medical Supply", ["First aid kits", "CLS bag restock", "AED pads"]),
             ("Great Plains Signs", ["Range safety signs", "Building placards"]),
             ("Northstar Training Aids", ["Land nav compasses", "Training mannequins", "Classroom easels"])]
LEVEL_N = {1: 34, 2: 26, 3: 18, 4: 12}
used_pr = set()
def new_pr():
    while True:
        p = rng.randrange(10_000_000, 99_999_999)
        if p not in used_pr: used_pr.add(p); return p
def pr_lines(pr, level, mode):
    """mode: 'sum' (each line carries its own value) or 'repeat' (each line repeats the PR total)."""
    card = rng.choice(CARDHOLDERS); merch, items = rng.choice(MERCHANTS)
    nl = rng.choice([1, 1, 1, 2, 2, 3]) if mode == "sum" else rng.choice([2, 3])
    vals = [round(rng.lognormvariate(6.3, 0.9), 2) for _ in range(nl)]
    total = round(sum(vals), 2)
    d0 = dt.date(2026, 10, 1) + dt.timedelta(days=rng.randrange(0, 35))
    out = []
    for i in range(nl):
        q = rng.randrange(1, 20)
        v = total if mode == "repeat" else vals[i]
        out.append({"Purchase requisition": pr, "Item of requisition": (i + 1) * 10, "Document Type": "NB", "Requisition Date": d0,
                    "Cardholder Name": card, "Requisitioner": "XXXXX", "Purchasing Group": "G" + str(rng.randrange(10, 99)), "Plant": "IA01",
                    "Material Group": rng.choice(["SUPPLY", "SERVICE", "EQUIP"]), "Merchant / Description": merch,
                    "Short Text": rng.choice(items), "Quantity": q, "Unit of Measure": "EA", "Valuation Price": round(v / q, 2),
                    "Total Value": v, "Currency": "USD", "Release Indicator": str(level), "Processing status": "N",
                    "Delivery Date": d0 + dt.timedelta(days=21), "Created By": "XXXXXXX", "Fund": "2065", "Funds Center": "IA" + str(rng.randrange(100, 999)),
                    "Functional Area": "XXXXXXXXXX", "GL Account": "6100.26RB", "Tracking Number": ""})
    return out, total
pr_files, pr_expect = {}, {"levels": {}, "repeat": 0, "moved": []}
gen_prs = []                                                # (level, pr, cardholder, total, mode) as generated
moved = []                                                  # (pr, from_level, to_level): still listed in the lower file
for level in (1, 2, 3, 4):
    rows, cnt, val = [], 0, 0.0
    for k in range(LEVEL_N[level]):
        mode = "repeat" if k % 9 == 4 else "sum"
        pr = new_pr(); lines, total = pr_lines(pr, level, mode)
        total = round(sum(l["Total Value"] for l in lines), 2)   # every line is its own item: the PR value is always the sum of its lines
        rows += lines; cnt += 1; val += total
        gen_prs.append((level, str(pr), lines[0]["Cardholder Name"], total, mode))
        if mode == "repeat": pr_expect["repeat"] += 1          # PRs whose lines happen to carry equal values (still summed)
        if level >= 2 and k < 2: moved.append((pr, level - 1, level, lines))
    pr_files[level] = rows; pr_expect["levels"][level] = {"count": cnt, "value": round(val, 2)}
for pr, lo, hi, lines in moved:                             # stale copy in the lower level file (dashboard shows it at the higher level)
    pr_files[lo] += [dict(l, **{"Release Indicator": str(lo)}) for l in lines]
    pr_expect["moved"].append(str(pr))
for level in pr_files: rng.shuffle(pr_files[level])
# expected Description per PR: Short Text of the highest-value line, first such line (file order) on a tie
pr_desc = {}
for level, pr, card, total, mode in gen_prs:
    best = None
    for l in pr_files[level]:
        if str(l["Purchase requisition"]) == pr and (best is None or l["Total Value"] > best["Total Value"]): best = l
    pr_desc[pr] = best["Short Text"]
pr_expect["desc"] = pr_desc

def pr_grid(level):
    g = [PR_HEADERS] + [[r[h] for h in PR_HEADERS] for r in pr_files[level]]
    g.append([None] * len(PR_HEADERS)); tot = [None] * len(PR_HEADERS); tot[13] = "Total"; tot[14] = round(sum(r["Total Value"] for r in pr_files[level]), 2)
    g.append(tot)                                           # a total row (no PR number): ignored
    return g

# ---------------- Fuel trackers (one per AASF) ----------------
AASF = [("Cedar Valley", 420_000, 1.00), ("Prairie Point", 360_000, 0.82), ("River Bend", 300_000, 1.18)]
FUEL_HEADERS = ["Date", "Milstrip Number", "Gallons", "Total Cost", "Aircraft", "Fuel Type", "Issued By", "Remarks"]
TODAY = dt.date(2026, 11, 5)
def fiscal_month(d): return (d.month + 2) % 12 + 1
def price_on(d):                                            # $/gal drifts over the year
    base = 3.62 + 0.18 * __import__("math").sin((d.toordinal() - 739000) / 58.0)
    return round(base + rng.uniform(-0.06, 0.06), 4)
fuel_files, fuel_expect = {}, {}
for name, budget, pace in AASF:
    rows = []
    d = dt.date(2025, 10, 1)
    while d < TODAY - dt.timedelta(days=1):
        fm = fiscal_month(d)
        if rng.random() < 0.34 * pace * (1.25 if fm in (8, 9, 10, 11) else 1.0):
            gal = round(rng.uniform(180, 1450), 1); ppg = price_on(d)
            ms = f"W81{rng.choice('ABCDEFGH')}{rng.randrange(10, 99)}{d.strftime('%y')}{d.timetuple().tm_yday:03d}{rng.randrange(1000, 9999)}"
            rows.append([d, ms, gal, round(gal * ppg, 2), rng.choice(["UH-60M", "UH-60L", "CH-47F", "UH-72A"]), "JP-8", "XXXX", ""])
        d += dt.timedelta(days=1)
    for i, r in enumerate(rows):                            # some dates typed as text, like a hand-kept tracker
        if i % 11 == 3: r[0] = r[0].strftime("%m/%d/%Y")
        elif i % 17 == 5: r[0] = r[0].strftime("%d%b%y").upper()
    fuel_files[name] = (budget, rows)
    def fy_of(x):
        x = x if isinstance(x, dt.date) else None
        return None if x is None else x.year + (1 if x.month >= 10 else 0)
    by = {}
    for r in rows:
        dd = r[0] if isinstance(r[0], dt.date) else (dt.datetime.strptime(r[0], "%m/%d/%Y").date() if "/" in r[0] else dt.datetime.strptime(r[0], "%d%b%y").date())
        fy = dd.year + (1 if dd.month >= 10 else 0)
        g = by.setdefault(fy, [0.0, 0.0, 0]); g[0] += r[3]; g[1] += r[2]; g[2] += 1
    fuel_expect[name] = {"budget": budget, "byFy": {str(k): {"cost": round(v[0], 2), "gallons": round(v[1], 1), "rows": v[2]} for k, v in by.items()}}

def fuel_grid(name):
    budget, rows = fuel_files[name]
    g = [["Total Fuel Budget", budget, None, None, "FY27 annual (fictional)"],
         ["AASF", name], ["Tracker", "Fuel issues (JP-8)"], ["POC", "XXXXX"], ["Phone", "XXX-XXX-XXXX"],
         ["Q1 allocation", round(budget * 0.25, 2)], ["Q2 allocation", round(budget * 0.25, 2)], ["Q3 allocation", round(budget * 0.25, 2)],
         ["Q4 allocation", round(budget * 0.25, 2)], [], ["Notes", "Enter one line per fuel issue below the header row."], [],
         FUEL_HEADERS]
    for r in rows: g.append(list(r))
    g.append([]); g.append(["TOTAL", None, round(sum(r[2] for r in rows), 1), round(sum(r[3] for r in rows), 2)])
    return g

def js_val(v):
    if isinstance(v, dt.date): return (v - dt.date(1899, 12, 30)).days       # Excel serial, like a date cell read with cellDates off
    return v
def write_grid(path, grid, sheet, date_cols=(), money_cols=(), widths=None, header_row=1):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = sheet
    for r in grid: ws.append([c for c in r] if r else [])
    for row in ws.iter_rows(min_row=header_row + 1):
        for c in row:
            if c.column - 1 in date_cols and isinstance(c.value, (dt.date, dt.datetime)): c.number_format = "mm/dd/yyyy"
            if c.column - 1 in money_cols and isinstance(c.value, (int, float)): c.number_format = "#,##0.00"
    for c in ws[header_row]: c.font = Font(bold=True)
    for i, w in enumerate(widths or [], 1): ws.column_dimensions[get_column_letter(i)].width = w
    wb.save(path)

os.makedirs(DEMO, exist_ok=True)
demo = {"pr": [], "fuel": [], "asOf": TODAY.isoformat()}
for level in (1, 2, 3, 4):
    g = pr_grid(level); name = f"L{level}.xlsx"
    demo["pr"].append({"name": name, "grid": [[js_val(c) for c in r] for r in g]})
    write_grid(os.path.join(DEMO, name), g, "Sheet1", date_cols=(3, 18), money_cols=(13, 14), widths=[16] * len(PR_HEADERS))
for name, _b, _p in AASF:
    g = fuel_grid(name); fn = name + ".xlsx"
    demo["fuel"].append({"name": fn, "grid": [[js_val(c) for c in r] for r in g]})
    write_grid(os.path.join(DEMO, fn), g, "Tracker", date_cols=(0,), money_cols=(1, 3), widths=[16, 26, 12, 14, 12, 10, 10, 20], header_row=13)
# ---------------- Cardholder Key (demo): 9 of the 12 cardholders, entered in different ways; the other 3 are left out ----------------
def first_last(s):
    p = s.split("@")[0].lower().split(".")
    if len(p) > 2 and p[-1] == "mil": p = p[:-1]
    return p[0], p[-1]
def nice(x): return "-".join("'".join(w[:1].upper() + w[1:] for w in y.split("'")) for y in x.split("-"))
KEY_ROWS = []                                               # Cardholder, Display Name, Type
for i in range(9):
    raw = CARDHOLDERS[i]; f, l = first_last(raw)
    entry = raw.split("@")[0].lower() if i % 3 == 0 else (f"{f}.{l}@army.mil" if i % 3 == 1 else f"{nice(f)} {nice(l)}".upper() if i == 5 else f"{nice(f)} {nice(l)}")
    disp = f"{nice(f)} {nice(l)} (Ops)" if i == 4 else ""
    typ = ("WHST", "Safety")[i % 2] if i != 6 else "safety"   # lower-case on purpose: types match case-insensitively
    KEY_ROWS.append([entry, disp, typ])
key_cards = {CARDHOLDERS[i] for i in range(9)}
types_by_card = {CARDHOLDERS[i]: ("WHST", "Safety")[i % 2] if i != 6 else "Safety" for i in range(9)}
kexp = {"levels": {}, "types": {"WHST": {"count": 0, "value": 0.0}, "Safety": {"count": 0, "value": 0.0}}, "repeat": 0, "moved": [], "names": len(KEY_ROWS)}
for level, pr, card, total, mode in gen_prs:
    if card not in key_cards: continue
    g = kexp["levels"].setdefault(level, {"count": 0, "value": 0.0}); g["count"] += 1; g["value"] = round(g["value"] + total, 2)
    t = kexp["types"][types_by_card[card]]; t["count"] += 1; t["value"] = round(t["value"] + total, 2)
    if mode == "repeat": kexp["repeat"] += 1
kexp["moved"] = [str(pr) for pr, lo, hi, lines in moved if lines[0]["Cardholder Name"] in key_cards]
kexp["excludedRows"] = sum(1 for lv in pr_files for r in pr_files[lv] if r["Cardholder Name"] not in key_cards)
KEY_GRID = [["Cardholder", "Display Name", "Type"]] + KEY_ROWS
demo["prKey"] = {"name": "Cardholder Key.xlsx", "grid": KEY_GRID}
write_grid(os.path.join(DEMO, "Cardholder Key.xlsx"), KEY_GRID, "CardholderKey", widths=[34, 26, 12])
# ---------------- AFTPs (layout preview): 25 obviously fictional soldiers, AFTP days across FY2026 ----------------
# Per-AFTP pay is about 1/30 of a month's basic pay for the rank (approximate, demo only). Paid AFTPs settle 12-45 days later;
# a few soldiers have AFTPs that were never paid (the page highlights those), and late-September AFTPs may still be pending.
AFTP_PAY = {"PV2": 85.53, "SPC": 104.87, "SGT": 125.31, "SSG": 146.40, "SFC": 172.94, "WO1": 150.76, "CW2": 182.18, "CW3": 215.25,
            "1LT": 190.37, "CPT": 236.18, "MAJ": 279.94}
AFTP_RANKS = ["PV2", "PV2", "SPC", "SPC", "SPC", "SPC", "SGT", "SGT", "SGT", "SSG", "SSG", "SSG", "SFC", "SFC", "WO1", "WO1", "CW2", "CW2",
              "CW2", "CW3", "CW3", "1LT", "CPT", "CPT", "MAJ"]
AFTP_FIRST = ["Alex", "Jordan", "Casey", "Riley", "Taylor", "Morgan", "Jamie", "Avery", "Quinn", "Drew", "Rowan", "Skyler", "Parker",
              "Reese", "Emerson", "Hayden", "Logan", "Peyton", "Sawyer", "Cameron", "Dakota", "Finley", "Harper", "Kendall", "Blake"]
AFTP_LAST = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike",
             "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "Yankee", "Zulu"]
def aftp_demo():
    ar = random.Random(2026)
    first = AFTP_FIRST[:]; ar.shuffle(first)
    problem = set(ar.sample(range(25), 7))
    start, end = dt.date(2025, 10, 1), dt.date(2026, 9, 30)
    soldiers, aftps = [], []
    for i, rank in enumerate(AFTP_RANKS):
        sid = f"S{i + 1:02d}"; soldiers.append({"id": sid, "rank": rank, "name": f"{first[i]} {AFTP_LAST[i]}"})
        flyer = rank[0] in "WCM1"
        k = ar.randint(8, 18) if flyer else ar.randint(3, 10)
        days = set()
        while len(days) < k:
            d = start + dt.timedelta(days=ar.randrange((end - start).days + 1))
            if d.weekday() < 5: days.add(d)
        for d in sorted(days):
            lag = ar.randint(12, 45); paid_on = d + dt.timedelta(days=lag)
            stuck = i in problem and ar.random() < 0.4
            paid = paid_on <= TODAY and not stuck
            aftps.append({"sid": sid, "date": d.isoformat(), "amount": AFTP_PAY[rank], "paid": paid, "paidDate": paid_on.isoformat() if paid else None})
    unpaid = [a for a in aftps if not a["paid"]]
    exp = {"soldiers": len(soldiers), "used": len(aftps), "paid": len(aftps) - len(unpaid), "unpaid": len(unpaid),
           "outstanding": round(sum(a["amount"] for a in unpaid), 2), "soldiersUnpaid": len({a["sid"] for a in unpaid})}
    return {"soldiers": soldiers, "aftps": aftps}, exp
demo["aftp"], aftp_expect = aftp_demo()
demo["expect"] = {"pr": pr_expect, "prKey": kexp, "fuel": fuel_expect, "aftp": aftp_expect}
with open(os.path.join(DIR, "data", "command_demo.js"), "w", encoding="utf-8") as f:
    f.write("// AUTO-GENERATED by data-generation/generate_command_data.py - fictional data\n")
    f.write("window.COMMAND_DEMO = " + json.dumps(demo, separators=(",", ":")) + ";\n")

# ---------------- Status of Funds demo: Aviation's own copy of the finance demo ----------------
# Same fictional export, keys and plan as dashboards/finance (that file is not changed). Aviation differences:
# Obligation is calculated (Total Expenditure - Disbursement, obligation_amt_cum is ignored), so every line keeps
# |commitment_amt_cum| >= |disbursement_amt_cum|; the funding file has no Reservations column.
def aviation_funds_demo():
    src = open(os.path.join(FIN, "data", "funds_demo.js"), encoding="utf-8").read()
    d = json.loads(src[src.index("{"):src.rindex("}") + 1])
    h = d["headers"]; ic, idb, ici = h.index("commitment_amt_cum"), h.index("disbursement_amt_cum"), h.index("commitment_item_fipex")
    io = h.index("obligation_amt_cum")
    tot = {"before_obligation": 0.0, "obligation": 0.0, "te": 0.0, "disb": 0.0, "kept": 0}
    for r in d["rows"]:
        if abs(r[ic] or 0) < abs(r[idb] or 0): r[ic] = -abs(r[idb])           # |commitment| >= |disbursement|
        if isinstance(r[ici], str) and r[ici].strip().upper() == "ALLOBJ": continue
        com, disb = -(r[ic] or 0), -(r[idb] or 0)
        tot["kept"] += 1; tot["te"] += com; tot["disb"] += disb; tot["obligation"] += round(com - disb, 2); tot["before_obligation"] += -(r[io] or 0)
    fh = d["funding"]["headers"]; keep = [i for i, x in enumerate(fh) if x != "Reservations"]
    d["funding"] = {"headers": [fh[i] for i in keep], "rows": [[r[i] for i in keep] for r in d["funding"]["rows"]]}
    # Aviation demo accounts: Aviation, Fuel, Parts and Safety (the finance demo's 14 accounts are folded into these four)
    AMAP = {"Drill Pay": "Aviation", "Annual Training Pay": "Aviation", "Bonuses & Incentives": "Aviation", "Recruiting Travel": "Aviation", "Course Supplies": "Aviation",
            "Vehicle Maintenance": "Fuel", "Facility Utilities": "Fuel", "Range Operations": "Fuel",
            "Readiness Center Repair": "Parts", "IT Equipment": "Parts", "Range Construction": "Parts",
            "Doctor Support": "Safety", "Lawyers": "Safety", "Family Programs": "Safety"}
    AINFO = {"Aviation": ("1N", "VAVN"), "Fuel": ("121", "VFUL"), "Parts": ("121", "VPRT"), "Safety": ("131", "VSAF")}
    def fold(tbl, key_idx, sum_idx):
        h2, out, at = tbl["headers"], [], {}
        ia = h2.index("Account")
        for r in tbl["rows"]:
            r = list(r); r[ia] = AMAP[r[ia]]
            k = tuple(r[i] for i in key_idx)
            if k in at:
                for i in sum_idx: at[k][i] = round((at[k][i] or 0) + (r[i] or 0), 2)
            else: at[k] = r; out.append(r)
        return {"headers": h2, "rows": out}
    fh2 = d["funding"]["headers"]
    d["funding"] = fold(d["funding"], [fh2.index("Fiscal Year"), fh2.index("Account")], [fh2.index("TDP"), fh2.index("AFP")])
    ph = d["plan"]["headers"]
    d["plan"] = fold(d["plan"], [ph.index("Fiscal Year"), ph.index("Account"), ph.index("Fiscal Month")], [ph.index("Planned Amount")])
    d["key"] = {"headers": d["key"]["headers"], "rows": [[fa, AMAP[ac], AINFO[AMAP[ac]][0], AINFO[AMAP[ac]][1]] for fa, ac, _s, _m in d["key"]["rows"]]}
    # Spend plan demo: planned amounts set around each account's actual monthly Total Expenditure so the Spend Plans page shows
    # a mix of green / yellow / red months (to-date targets: Aviation ~-2%, Fuel ~+7%, Parts ~-13%, Safety ~+3%).
    ifa, ify, ifm = h.index("functional_area_farea"), h.index("fiscal_year"), h.index("fiscal_month")
    fa_acct = {str(r[0]).strip().upper(): r[1] for r in d["key"]["rows"]}
    act = {}
    for r in d["rows"]:
        if isinstance(r[ici], str) and r[ici].strip().upper() == "ALLOBJ": continue
        ac = fa_acct.get(str(r[ifa]).strip().upper()); fm = r[ifm]
        if not ac or not fm: continue
        k = (int(r[ify]), ac, int(fm)); act[k] = act.get(k, 0.0) - (r[ic] or 0)
    prng = random.Random(77)
    TARGET = {"Aviation": -0.02, "Fuel": 0.07, "Parts": -0.13, "Safety": 0.03}
    ph = d["plan"]["headers"]; jf, ja, jm, jp = ph.index("Fiscal Year"), ph.index("Account"), ph.index("Fiscal Month"), ph.index("Planned Amount")
    for r in d["plan"]["rows"]:
        fy = 2000 + int(str(r[jf])[-2:]); ac, fm = r[ja], int(r[jm])
        base = act.get((fy, ac, fm)) or act.get((2026, ac, fm)) or 0
        if base < 1000:                                         # a month with little or negative spend: plan a modest amount
            pos = [v for (y, a2, _m), v in act.items() if y == 2026 and a2 == ac and v > 0]
            r[jp] = round(sum(pos) / max(1, len(pos)) * 0.3, -2); continue
        v = TARGET[ac] + prng.uniform(-0.09, 0.09)               # month-level variance around the account target
        r[jp] = round(base / (1 + v), -2)
    e = d["expect"]; e.pop("reservations", None)
    e.update({"obligation": round(tot["obligation"], 2), "totalExpenditure": round(tot["te"], 2), "disbursement": round(tot["disb"], 2),
              "obligationAmtCumIgnored": round(tot["before_obligation"], 2), "kept": tot["kept"]})
    e.pop("sharedDesc", None); e.pop("commitments", None)
    e["fundingRows"] = len(d["funding"]["rows"]); e["planRows"] = len(d["plan"]["rows"])
    e["accounts"] = len({r[1] for r in d["funding"]["rows"]}); e["accountNames"] = sorted({r[1] for r in d["funding"]["rows"]})
    with open(os.path.join(DIR, "data", "funds_demo.js"), "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED by data-generation/generate_command_data.py from the finance demo - fictional data\n")
        f.write("window.FUNDS_DEMO = " + json.dumps(d, separators=(",", ":")) + ";\n")
    return e
print(json.dumps(aviation_funds_demo()))

# ---------------- blank templates ----------------
def pr_template(path):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "PRs"
    ws.append(["Cardholder Name", "Purchase requisition", "Merchant / Description", "Short Text", "Total Value"])
    for c in ws[1]: c.font = Font(bold=True); c.fill = PatternFill("solid", fgColor="DCE6F2")
    for i, w in enumerate([30, 22, 32, 40, 16], 1): ws.column_dimensions[get_column_letter(i)].width = w
    for r in range(2, 200): ws.cell(r, 2).number_format = "@"; ws.cell(r, 5).number_format = "#,##0.00"
    ws.freeze_panes = "A2"; wb.save(path)
def fuel_template(path):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Tracker"
    ws["A1"] = "Total Fuel Budget"; ws["A1"].font = Font(bold=True); ws["B1"].number_format = "#,##0.00"
    ws["B1"].fill = PatternFill("solid", fgColor="FFF2CC")
    ws["A2"] = "AASF"; ws["A3"] = "Notes"; ws["B3"] = "Budget goes in B1. Name this file after the AASF (e.g. Cedar Valley.xlsx). One line per fuel issue below row 13."
    for i, h in enumerate(["Date", "Milstrip Number", "Gallons", "Total Cost"], 1):
        c = ws.cell(13, i, h); c.font = Font(bold=True); c.fill = PatternFill("solid", fgColor="DCE6F2")
    for r in range(14, 400): ws.cell(r, 1).number_format = "mm/dd/yyyy"; ws.cell(r, 2).number_format = "@"; ws.cell(r, 3).number_format = "#,##0.0"; ws.cell(r, 4).number_format = "#,##0.00"
    for i, w in enumerate([18, 26, 12, 16], 1): ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A14"; wb.save(path)
def key_template(path):
    from openpyxl.worksheet.table import Table, TableStyleInfo
    from openpyxl.worksheet.datavalidation import DataValidation
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "CardholderKey"
    ws.append(["Cardholder", "Display Name", "Type"])
    for c in ws[1]: c.font = Font(bold=True)
    last = 201
    t = Table(displayName="CardholderKey", ref=f"A1:C{last}"); t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True); ws.add_table(t)
    dv = DataValidation(type="list", formula1='"WHST,Safety"', allow_blank=True); dv.add(f"C2:C{last}"); ws.add_data_validation(dv)
    for i, w in enumerate([36, 28, 12], 1): ws.column_dimensions[get_column_letter(i)].width = w
    ws["E1"] = "How to fill in"; ws["E1"].font = Font(bold=True)
    ws["E2"] = "Cardholder: as in the PR file (first.middle.last or first.last@domain) or First Last. One per row."
    ws["E3"] = "Display Name (optional): how the name is shown in the dashboard."
    ws["E4"] = "Type: WHST or Safety. Rows with a blank Type are left out when any Type is filled in."
    ws.column_dimensions["E"].width = 90
    ws.freeze_panes = "A2"; wb.save(path)
key_template(os.path.join(DIR, "cardholder_key_template.xlsx"))
shutil.copy(os.path.join(DIR, "cardholder_key_template.xlsx"), os.path.join(DL, "command-cardholder-key-template.xlsx"))
pr_template(os.path.join(DIR, "pr_template.xlsx")); fuel_template(os.path.join(DIR, "fuel_tracker_template.xlsx"))
shutil.copy(os.path.join(DIR, "pr_template.xlsx"), os.path.join(DL, "command-pr-template.xlsx"))
shutil.copy(os.path.join(DIR, "fuel_tracker_template.xlsx"), os.path.join(DL, "command-fuel-tracker-template.xlsx"))
def funding_template(path):                                 # Aviation funding file: no Reservations (Balance = TDP - Obligation - Disbursement)
    from openpyxl.worksheet.table import Table, TableStyleInfo
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Funding"
    ws.append(["Fiscal Year", "Account", "TDP", "AFP"]); ws.append([None] * 4)
    for c in ws[1]: c.font = Font(bold=True)
    t = Table(displayName="FundingData", ref="A1:D2"); t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True); ws.add_table(t)
    for i, w in enumerate([14, 34, 18, 18], 1): ws.column_dimensions[get_column_letter(i)].width = w
    for r in range(2, 200): ws.cell(r, 1).number_format = "@"; ws.cell(r, 2).number_format = "@"; ws.cell(r, 3).number_format = "#,##0.00"; ws.cell(r, 4).number_format = "#,##0.00"
    wb.save(path)
funding_template(os.path.join(DIR, "funding_template.xlsx"))
def spend_monthly_template(path):                          # optional Spend Plans upload: one row per Account and Fiscal Year
    from openpyxl.worksheet.table import Table, TableStyleInfo
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "SpendPlan"
    ws.append(["Account", "Fiscal Year"] + [f"Month {m}" for m in range(1, 13)]); ws.append([None] * 14)
    for c in ws[1]: c.font = Font(bold=True)
    t = Table(displayName="SpendPlanMonthly", ref="A1:N2"); t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True); ws.add_table(t)
    ws.column_dimensions["A"].width = 30; ws.column_dimensions["B"].width = 12
    for i in range(3, 15): ws.column_dimensions[get_column_letter(i)].width = 14
    for r in range(2, 200):
        ws.cell(r, 2).number_format = "@"
        for c in range(3, 15): ws.cell(r, c).number_format = "#,##0.00"
    ws["P1"] = "How to fill in"; ws["P1"].font = Font(bold=True)
    ws["P2"] = "One row per Account. Fiscal Year is optional: leave it blank for the current fiscal year (1 October starts the next), or enter e.g. 2027 / FY27. Month 1 = October ... Month 12 = September. Planned amounts in dollars."
    ws.column_dimensions["P"].width = 100
    ws.freeze_panes = "C2"; wb.save(path)
spend_monthly_template(os.path.join(DIR, "spendplan_monthly_template.xlsx"))
shutil.copy(os.path.join(DIR, "spendplan_monthly_template.xlsx"), os.path.join(DL, "command-spend-plan-monthly-template.xlsx"))
for t in ("funds_template.xlsx", "accountkey_template.xlsx", "cikey_template.xlsx", "spendplan_template.xlsx"):
    shutil.copy(os.path.join(FIN, t), os.path.join(DIR, t))
print(json.dumps(demo["expect"], default=str)[:600])
