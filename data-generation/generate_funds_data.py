#!/usr/bin/env python3
"""Fictional GFEBS-style funds export for the Status of Funds dashboard (demo + test files). FICTIONAL DATA ONLY.

Writes, in the lowercase snake_case layout of the real export (only a handful of its ~100 columns):
  dashboards/finance/data/funds_demo.js     built-in demo (window.FUNDS_DEMO: headers + rows, read by the same parser)
  dashboards/finance/data/funds_sample.xlsx the same rows as an Excel file, formatted as a Table named FundsData
  dashboards/finance/funds_template.csv     blank template with the 9 columns the dashboard uses
  dashboards/finance/funds_template.xlsx    blank template formatted as a Table named FundsData (for Power Automate)
  dashboards/finance/data/funding_sample.xlsx  fictional funding file (Fiscal Year, Functional Area, Account, TDP, AFP, Reservations)
  dashboards/finance/funding_template.xlsx  blank funding file formatted as a Table named FundingData
The demo includes extra ignored columns, an always-blank ssn column, and ALLOBJ lines (removed by the dashboard).
Usage: python3 data-generation/generate_funds_data.py      (needs openpyxl)
"""
import csv, json, os, random
import openpyxl
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "dashboards", "finance")
rng = random.Random(2026)

USED = ["contract_doc_no", "commitment_item_fipex", "functional_area_farea", "appropriation_type", "fiscal_year",
        "obligation_amt_cum", "commitment_amt_cum", "disbursement_amt_cum", "sag", "mdep"]
FUND_HEADERS = ["Fiscal Year", "Functional Area", "Account", "TDP", "AFP", "Reservations"]
# demo header order mimics a wide export: used columns mixed with ignored ones (and the blank ssn column)
HEADERS = ["fund", "fund_center", "contract_doc_no", "document_type", "commitment_item_fipex", "functional_area_farea",
           "appropriation_type", "fiscal_year", "ssn", "obligation_amt_cum", "commitment_amt_cum", "disbursement_amt_cum",
           "sag", "mdep", "posting_period", "afp_amt_cum", "allotment_amt_cum"]

APPN = {"OMNG": "2065", "NGPA": "2060", "MCNG": "2085"}
# Functional Areas look like 111G11AAAA (digits, G, digits, letters); each one is an account with a fixed Appropriation, Sag and MDEP
ACCOUNTS = [("OMNG", "Course Supplies"), ("OMNG", "Lawyers"), ("OMNG", "Doctor Support"), ("OMNG", "Range Operations"),
            ("OMNG", "Vehicle Maintenance"), ("OMNG", "Facility Utilities"), ("OMNG", "Recruiting Travel"), ("OMNG", "IT Equipment"),
            ("OMNG", "Schools Travel"), ("OMNG", "Armory Custodial"), ("OMNG", "Family Programs"), ("OMNG", "Safety Training"),
            ("OMNG", "Environmental Compliance"), ("OMNG", "Office Supplies"), ("OMNG", "Aviation Fuel"), ("OMNG", "Medical Readiness"),
            ("NGPA", "Drill Pay"), ("NGPA", "Annual Training Pay"), ("NGPA", "School Pay"), ("NGPA", "Bonuses & Incentives"),
            ("MCNG", "Readiness Center Repair"), ("MCNG", "Range Construction")]
SAGS = {"OMNG": ["1N", "131", "132", "133", "121", "113"], "NGPA": ["1N", "111"], "MCNG": ["131"]}
MDEP = {"OMNG": ["QDPC", "FCMA", "TATM", "QNMG", "VCND", "QAAF", "QDPW", "VRCT", "QLPR", "TADS"], "NGPA": ["VNGP", "TATM", "QAAF", "VRCT"], "MCNG": ["FCMC", "QDPW"]}
CI = {"OMNG": ["21T0", "22NL", "26RB", "252G", "26FF", "2571", "25ZZ", "31EQ", "23U1"], "NGPA": ["1198", "1199", "1250", "21T0"], "MCNG": ["252G", "32B1", "26RB"]}
LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
used_fa = set()
def new_fa():
    while True:
        fa = f"{rng.randrange(100, 1000)}G{rng.randrange(10, 100)}" + "".join(rng.choice(LETTERS) for _ in range(4))
        if fa not in used_fa: used_fa.add(fa); return fa
FAS = [{"fa": new_fa(), "appn": ap, "acct": nm, "sag": rng.choice(SAGS[ap]), "mdep": rng.choice(MDEP[ap]),
        "w": {"NGPA": 3.0, "MCNG": 0.5}.get(ap, 1.0)} for ap, nm in ACCOUNTS]
FY_W = [(2025, 0.38), (2026, 0.52), (2027, 0.10)]

def wpick(items):
    r, a = rng.random() * sum(i[1] for i in items), 0.0
    for it in items:
        a += it[1]
        if r <= a: return it
    return items[-1]

def doc_no(fy, appn):
    if appn == "NGPA": return f"T{fy % 100:02d}{rng.randrange(1000000, 9999999)}"          # travel / pay style
    if rng.random() < 0.45: return f"00{rng.randrange(10000000, 99999999)}"                  # 10-digit commitment doc
    return f"W91ZZZ{fy % 100:02d}P{rng.randrange(1, 9999):04d}"                               # fictional contract number

rows, n_allobj = [], 0
for i in range(300):                                  # documents
    acc = wpick([(f, f["w"]) for f in FAS])[0]
    appn, fund = acc["appn"], APPN[acc["appn"]]
    fy = wpick(FY_W)[0]
    doc = doc_no(fy, appn)
    nlines = rng.choice([1, 1, 1, 2, 2, 3])
    for ci in rng.sample(CI[appn], min(nlines, len(CI[appn]))):
        scale = {"NGPA": 22000, "OMNG": 24000, "MCNG": 60000}[appn] * (0.15 if fy == 2027 else 1)
        com = round(rng.lognormvariate(0, 1.0) * scale, 2)
        obl = round(com * rng.choice([1, 1, 1, rng.uniform(0.4, 1.0), 0]), 2)
        if rng.random() < 0.04: obl = -round(rng.uniform(200, 6000), 2); com = obl     # de-obligation
        disb = round(max(obl, 0) * (rng.uniform(0.5, 1) if fy == 2025 else rng.uniform(0, 0.8)), 2)
        rows.append({"fund": fund + str(fy % 100), "fund_center": f"IA{rng.randrange(100, 999)}", "contract_doc_no": doc,
                     "document_type": rng.choice(["CO", "PO", "TR", "MI"]), "commitment_item_fipex": ci, "functional_area_farea": acc["fa"],
                     "appropriation_type": appn, "fiscal_year": fy, "ssn": "", "obligation_amt_cum": obl, "commitment_amt_cum": com,
                     "disbursement_amt_cum": disb, "sag": acc["sag"], "mdep": acc["mdep"],
                     "posting_period": rng.randrange(1, 13), "afp_amt_cum": 9999999, "allotment_amt_cum": 8888888})
# ALLOBJ budget lines (large, must disappear from every total)
for acc in FAS[:8] + FAS[16:18]:
    for fy, _w in FY_W:
        n_allobj += 1
        amt = round(rng.uniform(0.5, 4) * 1e6, 2)
        rows.append({"fund": APPN[acc["appn"]] + str(fy % 100), "fund_center": "IA000", "contract_doc_no": "", "document_type": "BD",
                     "commitment_item_fipex": rng.choice(["ALLOBJ", "allobj ", " ALLOBJ"]), "functional_area_farea": acc["fa"],
                     "appropriation_type": acc["appn"], "fiscal_year": fy, "ssn": "", "obligation_amt_cum": amt, "commitment_amt_cum": amt,
                     "disbursement_amt_cum": round(amt * 0.3, 2), "sag": acc["sag"], "mdep": acc["mdep"], "posting_period": 1,
                     "afp_amt_cum": amt, "allotment_amt_cum": amt})
rng.shuffle(rows)

kept = [r for r in rows if r["commitment_item_fipex"].strip().upper() != "ALLOBJ"]
# funding file: one row per Fiscal Year + Functional Area with its account name (FY written as FY25 to exercise normalization)
ACCT = {f["fa"]: f["acct"] for f in FAS}
grp = {}
for r in kept:
    k = (r["fiscal_year"], r["functional_area_farea"]); g = grp.setdefault(k, [0.0, 0.0]); g[0] += r["obligation_amt_cum"]; g[1] += r["disbursement_amt_cum"]
AFP_SHARE = {2025: (1.0, 1.0), 2026: (0.9, 1.0), 2027: (0.1, 0.25)}     # FY27 has just started: only part of TDP released
funding = []
for (fy, fa), (o, d) in sorted(grp.items()):
    tdp = round(max(o + d, 0) * (rng.uniform(1.0, 1.08) if fy == 2025 else rng.uniform(0.95, 1.4) if fy == 2026 else rng.uniform(4, 7)) + 5000, -2)
    lo, hi = AFP_SHARE[fy]
    funding.append({"Fiscal Year": f"FY{fy % 100:02d}", "Functional Area": fa, "Account": ACCT[fa], "TDP": tdp,
                    "AFP": round(tdp * rng.uniform(lo, hi), -2), "Reservations": 0.0 if fy == 2025 else round(tdp * rng.uniform(0, 0.08), 2)})
for f in FAS[-6:]:   # funded, no lines yet
    if not any(x["Functional Area"] == f["fa"] and x["Fiscal Year"] == "FY27" for x in funding):
        funding.append({"Fiscal Year": "FY27", "Functional Area": f["fa"], "Account": f["acct"], "TDP": 120000.0, "AFP": 15000.0, "Reservations": 2500.0})
summary = {"lines": len(rows), "allobj": n_allobj, "kept": len(kept),
           "disbursement": round(sum(r["disbursement_amt_cum"] for r in kept), 2),
           "tdp": round(sum(f["TDP"] for f in funding), 2), "afp": round(sum(f["AFP"] for f in funding), 2),
           "reservations": round(sum(f["Reservations"] for f in funding), 2), "fundingRows": len(funding),
           "obligation": round(sum(r["obligation_amt_cum"] for r in kept), 2),
           "commitments": round(sum(r["commitment_amt_cum"] for r in kept), 2),
           "documents": len({r["contract_doc_no"] for r in kept if r["contract_doc_no"]})}

os.makedirs(os.path.join(DIR, "data"), exist_ok=True)
with open(os.path.join(DIR, "data", "funds_demo.js"), "w", encoding="utf-8") as f:
    f.write("// AUTO-GENERATED by data-generation/generate_funds_data.py - fictional data\n")
    f.write("window.FUNDS_DEMO = " + json.dumps({"asOf": "2026-10-30", "headers": HEADERS, "rows": [[r[h] for h in HEADERS] for r in rows],
                                              "funding": {"headers": FUND_HEADERS, "rows": [[f[h] for h in FUND_HEADERS] for f in funding]},
                                              "expect": summary}, separators=(",", ":")) + ";\n")

def table(ws, name):
    ref = f"A1:{get_column_letter(ws.max_column)}{max(ws.max_row, 2)}"
    t = Table(displayName=name, ref=ref); t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True); ws.add_table(t)

wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Export"; ws.append(HEADERS)
for r in rows: ws.append([r[h] if not (h == "ssn") else None for h in HEADERS])
table(ws, "FundsData"); wb.save(os.path.join(DIR, "data", "funds_sample.xlsx"))

with open(os.path.join(DIR, "funds_template.csv"), "w", newline="", encoding="utf-8") as f: csv.writer(f).writerow(USED)
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Export"; ws.append(USED); ws.append([None] * len(USED))
for i in range(1, len(USED) + 1): ws.column_dimensions[get_column_letter(i)].width = 22
table(ws, "FundsData"); wb.save(os.path.join(DIR, "funds_template.xlsx"))
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Funding"; ws.append(FUND_HEADERS)
for f in funding: ws.append([f[h] for h in FUND_HEADERS])
table(ws, "FundingData"); wb.save(os.path.join(DIR, "data", "funding_sample.xlsx"))
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Funding"; ws.append(FUND_HEADERS); ws.append([None] * len(FUND_HEADERS))
for i in range(1, len(FUND_HEADERS) + 1): ws.column_dimensions[get_column_letter(i)].width = 20
table(ws, "FundingData"); wb.save(os.path.join(DIR, "funding_template.xlsx"))
print(json.dumps(summary))
