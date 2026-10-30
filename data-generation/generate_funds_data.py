#!/usr/bin/env python3
"""Fictional GFEBS-style funds export for the Status of Funds dashboard (demo + test files). FICTIONAL DATA ONLY.

Writes, in the lowercase snake_case layout of the real export (only a handful of its ~100 columns):
  dashboards/finance/data/funds_demo.js     built-in demo (window.FUNDS_DEMO: headers + rows, read by the same parser)
  dashboards/finance/data/funds_sample.xlsx the same rows as an Excel file, formatted as a Table named FundsData
  dashboards/finance/funds_template.csv     blank template with the 9 columns the dashboard uses
  dashboards/finance/funds_template.xlsx    blank template formatted as a Table named FundsData (for Power Automate)
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
        "obligation_amt_cum", "commitment_amt_cum", "sag", "mdep"]
# demo header order mimics a wide export: used columns mixed with ignored ones (and the blank ssn column)
HEADERS = ["fund", "fund_center", "contract_doc_no", "document_type", "commitment_item_fipex", "functional_area_farea",
           "appropriation_type", "fiscal_year", "ssn", "obligation_amt_cum", "commitment_amt_cum", "disbursement_amt_cum",
           "sag", "mdep", "posting_period"]

APPN = [("OMNG", 0.68, "2065"), ("NGPA", 0.24, "2060"), ("MCNG", 0.08, "2085")]
SAGS = {"OMNG": ["111", "112", "113", "115", "116", "121", "122", "131", "132", "133"], "NGPA": ["211", "212", "213"], "MCNG": ["311"]}
MDEP = {"OMNG": ["QDPC", "FCMA", "TATM", "QNMG", "VCND", "MS4X", "QAAF", "RJ4S", "QDPW", "VRCT", "MU1M", "QLPR"],
        "NGPA": ["VNGP", "TATM", "QAAF", "VRCT"], "MCNG": ["FCMC", "QDPW"]}
CI = {"OMNG": ["21T100", "21T200", "22F100", "23R100", "252G00", "257M00", "25ZZ00", "26FF00", "26SS00", "31EQ00", "23U100", "25C100"],
      "NGPA": ["11M100", "11M200", "12M100", "21T100"], "MCNG": ["32B100", "25ZZ00"]}
FY_W = [(2025, 0.38), (2026, 0.52), (2027, 0.10)]

def wpick(items):
    r, a = rng.random(), 0.0
    for it in items:
        a += it[1]
        if r <= a: return it
    return items[-1]

def doc_no(fy, appn, i):
    k = rng.random()
    if appn == "NGPA": return f"T{fy % 100:02d}{rng.randrange(1000000, 9999999)}"          # travel / pay style
    if k < 0.45: return f"00{rng.randrange(10000000, 99999999)}"                             # 10-digit commitment doc
    return f"W91ZZZ{fy % 100:02d}P{rng.randrange(1, 9999):04d}"                               # fictional contract number

rows, n_allobj = [], 0
for i in range(260):                                  # documents
    appn, _, fund = wpick(APPN)
    fy = wpick(FY_W)[0]
    doc = doc_no(fy, appn, i)
    sag, mdep = rng.choice(SAGS[appn]), rng.choice(MDEP[appn])
    farea = f"{sag}{rng.choice(['011', '012', '021'])}{rng.choice(['0000', '1000', '2000'])}"
    nlines = rng.choice([1, 1, 1, 2, 2, 3, 4])
    for ci in rng.sample(CI[appn], min(nlines, len(CI[appn]))):
        scale = {"NGPA": 18000, "OMNG": 26000, "MCNG": 70000}[appn] * (0.25 if fy == 2027 else 1)
        com = round(rng.lognormvariate(0, 1.0) * scale, 2)
        obl = round(com * rng.choice([1, 1, 1, rng.uniform(0.4, 1.0), 0]), 2)
        if rng.random() < 0.04: obl = -round(rng.uniform(200, 6000), 2); com = obl     # de-obligation
        rows.append({"fund": fund + str(fy % 100), "fund_center": f"IA{rng.randrange(100, 999)}", "contract_doc_no": doc,
                     "document_type": rng.choice(["CO", "PO", "TR", "MI"]), "commitment_item_fipex": ci, "functional_area_farea": farea,
                     "appropriation_type": appn, "fiscal_year": fy, "ssn": "", "obligation_amt_cum": obl, "commitment_amt_cum": com,
                     "disbursement_amt_cum": round(max(obl, 0) * rng.uniform(0, 1), 2), "sag": sag, "mdep": mdep,
                     "posting_period": rng.randrange(1, 13)})
# ALLOBJ budget lines (large, must disappear from every total)
for appn, _, fund in APPN:
    for fy, _w in FY_W:
        for sag in SAGS[appn][:3]:
            n_allobj += 1
            amt = round(rng.uniform(0.5, 4) * 1e6, 2)
            rows.append({"fund": fund + str(fy % 100), "fund_center": "IA000", "contract_doc_no": "", "document_type": "BD",
                         "commitment_item_fipex": rng.choice(["ALLOBJ", "allobj ", " ALLOBJ"]), "functional_area_farea": f"{sag}0110000",
                         "appropriation_type": appn, "fiscal_year": fy, "ssn": "", "obligation_amt_cum": amt, "commitment_amt_cum": amt,
                         "disbursement_amt_cum": 0, "sag": sag, "mdep": rng.choice(MDEP[appn]), "posting_period": 1})
rng.shuffle(rows)

kept = [r for r in rows if r["commitment_item_fipex"].strip().upper() != "ALLOBJ"]
summary = {"lines": len(rows), "allobj": n_allobj, "kept": len(kept),
           "obligation": round(sum(r["obligation_amt_cum"] for r in kept), 2),
           "commitments": round(sum(r["commitment_amt_cum"] for r in kept), 2),
           "documents": len({r["contract_doc_no"] for r in kept if r["contract_doc_no"]})}

os.makedirs(os.path.join(DIR, "data"), exist_ok=True)
with open(os.path.join(DIR, "data", "funds_demo.js"), "w", encoding="utf-8") as f:
    f.write("// AUTO-GENERATED by data-generation/generate_funds_data.py - fictional data\n")
    f.write("window.FUNDS_DEMO = " + json.dumps({"asOf": "2026-10-30", "headers": HEADERS, "rows": [[r[h] for h in HEADERS] for r in rows],
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
print(json.dumps(summary))
