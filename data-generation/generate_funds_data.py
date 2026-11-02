#!/usr/bin/env python3
"""Fictional GFEBS-style funds export + side files for the Status of Funds dashboard (demo + test files). FICTIONAL DATA ONLY.

Writes:
  dashboards/finance/data/funds_demo.js        built-in demo (window.FUNDS_DEMO: export rows + funding + plan + both keys)
  dashboards/finance/data/*_sample.xlsx        the same data as Excel files (export, funding, spend plan, Account Key, Commitment Item Key)
  dashboards/finance/*_template.xlsx/.csv      blank templates (also copied to downloads/ as funding-template.xlsx etc.)
The demo export has extra ignored columns (including sag / mdep, which now come from the Account Key), an always-blank ssn
column, ALLOBJ lines (removed by the dashboard), and amounts NEGATIVE like the real export (the dashboard flips the sign).
Usage: python3 data-generation/generate_funds_data.py      (needs openpyxl)
"""
import csv, json, os, random
import openpyxl
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "dashboards", "finance")
DL = os.path.join(ROOT, "downloads")
rng = random.Random(2026)

USED = ["contract_doc_no", "commitment_item_fipex", "functional_area_farea", "appropriation_type", "fiscal_year", "fiscal_month",
        "obligation_amt_cum", "commitment_amt_cum", "disbursement_amt_cum"]
FUND_HEADERS = ["Fiscal Year", "Account", "TDP", "AFP", "Reservations"]
KEY_HEADERS = ["Functional Area", "Account", "Sag", "MDEP"]
CIKEY_HEADERS = ["Commitment Item", "Description"]
PLAN_HEADERS = ["Fiscal Year", "Account", "Fiscal Month", "Planned Amount"]
HEADERS = ["fund", "fund_center", "contract_doc_no", "document_type", "commitment_item_fipex", "functional_area_farea",
           "appropriation_type", "fiscal_year", "ssn", "obligation_amt_cum", "commitment_amt_cum", "disbursement_amt_cum",
           "sag", "mdep", "fiscal_month", "afp_amt_cum", "allotment_amt_cum"]

APPN = {"OMNG": "2065", "NGPA": "2060", "MCNG": "2085"}
# Accounts: (appropriation, name, Sag, MDEP, number of Functional Areas that roll up to it)
ACCOUNTS = [("OMNG", "Course Supplies", "1N", "TATM", 3), ("OMNG", "Lawyers", "131", "QLPR", 2), ("OMNG", "Doctor Support", "131", "QDPC", 3),
            ("OMNG", "Range Operations", "121", "TADS", 2), ("OMNG", "Vehicle Maintenance", "121", "FCMA", 3), ("OMNG", "Facility Utilities", "132", "QDPW", 2),
            ("OMNG", "Recruiting Travel", "133", "VRCT", 2), ("OMNG", "IT Equipment", "133", "QNMG", 2), ("OMNG", "Family Programs", "1N", "VCND", 1),
            ("NGPA", "Drill Pay", "1N", "VNGP", 3), ("NGPA", "Annual Training Pay", "1N", "VNGP", 2), ("NGPA", "Bonuses & Incentives", "111", "VRCT", 2),
            ("MCNG", "Readiness Center Repair", "131", "FCMC", 2), ("MCNG", "Range Construction", "131", "QDPW", 1)]
CI = {"OMNG": ["21T0", "21T1", "22NL", "26RB", "252G", "26FF", "2571", "23U1"], "NGPA": ["1198", "1199", "1250", "21T0"], "MCNG": ["252G", "32B1", "26RB"]}
CI_DESC = {"21T0": "Travel (example)", "22NL": "Transportation (example)", "26RB": "Supplies (example)", "252G": "Contract Services (example)",
           "26FF": "Fuel (example)", "2571": "Equipment Maintenance (example)", "32B1": "Construction (example)",
           "1198": "Military Pay - Drill (example)", "1199": "Military Pay - Annual Training (example)", "1250": "Bonuses & Allowances (example)",
           "21T1": "  travel  (EXAMPLE) "}          # second code with the SAME description (other case/spacing): combined with 21T0
# 23U1 is deliberately missing from the Commitment Item Key so the demo shows an Unmapped code
LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
used_fa = set()
def new_fa():
    while True:
        fa = f"{rng.randrange(100, 1000)}G{rng.randrange(10, 100)}" + "".join(rng.choice(LETTERS) for _ in range(4))
        if fa not in used_fa: used_fa.add(fa); return fa
FAS = []
for ap, nm, sag, mdep, k in ACCOUNTS:
    for _ in range(k): FAS.append({"fa": new_fa(), "appn": ap, "acct": nm, "sag": sag, "mdep": mdep, "w": {"NGPA": 2.0, "MCNG": 0.5}.get(ap, 1.0)})
UNMAPPED_FA = {"fa": new_fa(), "appn": "OMNG", "acct": None, "sag": "113", "mdep": "QAAF", "w": 0.4}   # not in the Account Key
FY_W = [(2025, 0.38), (2026, 0.52), (2027, 0.10)]

def wpick(items):
    r, a = rng.random() * sum(i[1] for i in items), 0.0
    for it in items:
        a += it[1]
        if r <= a: return it
    return items[-1]
def doc_no(fy, appn):
    if appn == "NGPA": return f"T{fy % 100:02d}{rng.randrange(1000000, 9999999)}"
    if rng.random() < 0.45: return f"00{rng.randrange(10000000, 99999999)}"
    return f"W91ZZZ{fy % 100:02d}P{rng.randrange(1, 9999):04d}"
MONTH_W = [6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 12]          # fiscal months 1 (Oct) .. 12 (Sep); year-end spending heavier
def fmonth(fy):
    if fy == 2027: return 1                               # FY27 has just started (demo date 30 Oct 2026)
    if rng.random() < 0.01: return None
    return wpick([(m + 1, w) for m, w in enumerate(MONTH_W)])[0]

rows, n_allobj = [], 0
for i in range(320):                                  # documents
    acc = wpick([(f, f["w"]) for f in FAS + [UNMAPPED_FA]])[0]
    appn, fund = acc["appn"], APPN[acc["appn"]]
    fy = wpick(FY_W)[0]; doc = doc_no(fy, appn)
    for ci in rng.sample(CI[appn], min(rng.choice([1, 1, 1, 2, 2, 3]), len(CI[appn]))):
        scale = {"NGPA": 22000, "OMNG": 24000, "MCNG": 60000}[appn] * (0.15 if fy == 2027 else 1)
        com = round(rng.lognormvariate(0, 1.0) * scale, 2)
        obl = round(com * rng.choice([1, 1, 1, rng.uniform(0.4, 1.0), 0]), 2)
        if rng.random() < 0.04: obl = -round(rng.uniform(200, 6000), 2); com = obl     # de-obligation
        disb = round(max(obl, 0) * (rng.uniform(0.5, 1) if fy == 2025 else rng.uniform(0, 0.8)), 2)
        # the export carries amounts NEGATIVE (a de-obligation comes through positive)
        rows.append({"fund": fund + str(fy % 100), "fund_center": f"IA{rng.randrange(100, 999)}", "contract_doc_no": doc,
                     "document_type": rng.choice(["CO", "PO", "TR", "MI"]), "commitment_item_fipex": ci, "functional_area_farea": acc["fa"],
                     "appropriation_type": appn, "fiscal_year": fy, "ssn": "", "obligation_amt_cum": -obl, "commitment_amt_cum": -com,
                     "disbursement_amt_cum": -disb, "sag": "XX", "mdep": "XXXX",          # ignored: Sag / MDEP come from the Account Key
                     "fiscal_month": fmonth(fy), "afp_amt_cum": 9999999, "allotment_amt_cum": 8888888, "_acct": acc["acct"]})
for acc in FAS[:8] + FAS[22:24]:                       # ALLOBJ budget lines (must disappear from every total)
    for fy, _w in FY_W:
        n_allobj += 1; amt = round(rng.uniform(0.5, 4) * 1e6, 2)
        rows.append({"fund": APPN[acc["appn"]] + str(fy % 100), "fund_center": "IA000", "contract_doc_no": "", "document_type": "BD",
                     "commitment_item_fipex": rng.choice(["ALLOBJ", "allobj ", " ALLOBJ"]), "functional_area_farea": acc["fa"],
                     "appropriation_type": acc["appn"], "fiscal_year": fy, "ssn": "", "obligation_amt_cum": -amt, "commitment_amt_cum": -amt,
                     "disbursement_amt_cum": -round(amt * 0.3, 2), "sag": "XX", "mdep": "XXXX", "fiscal_month": 1,
                     "afp_amt_cum": amt, "allotment_amt_cum": amt, "_acct": acc["acct"]})
rng.shuffle(rows)
kept = [r for r in rows if r["commitment_item_fipex"].strip().upper() != "ALLOBJ"]

key = [{"Functional Area": f["fa"], "Account": f["acct"], "Sag": f["sag"], "MDEP": f["mdep"]} for f in FAS]
cikey = [{"Commitment Item": c, "Description": d} for c, d in CI_DESC.items()]
# funding: one row per Fiscal Year + Account (FY written as FY25 to exercise normalization)
grp = {}
for r in kept:
    if not r["_acct"]: continue
    g = grp.setdefault((r["fiscal_year"], r["_acct"]), [0.0, 0.0]); g[0] -= r["obligation_amt_cum"]; g[1] -= r["disbursement_amt_cum"]
AFP_SHARE = {2025: (1.0, 1.0), 2026: (0.9, 1.0), 2027: (0.1, 0.25)}
funding = []
for (fy, ac), (o, d) in sorted(grp.items()):
    tdp = round(max(o + d, 0) * (rng.uniform(1.0, 1.08) if fy == 2025 else rng.uniform(0.95, 1.4) if fy == 2026 else rng.uniform(4, 7)) + 5000, -2)
    lo, hi = AFP_SHARE[fy]
    funding.append({"Fiscal Year": f"FY{fy % 100:02d}", "Account": ac, "TDP": tdp, "AFP": round(tdp * rng.uniform(lo, hi), -2),
                    "Reservations": 0.0 if fy == 2025 else round(tdp * rng.uniform(0, 0.08), 2)})
for ap, nm, *_ in ACCOUNTS[-4:]:                      # funded, no lines yet
    if not any(x["Account"] == nm and x["Fiscal Year"] == "FY27" for x in funding):
        funding.append({"Fiscal Year": "FY27", "Account": nm, "TDP": 120000.0, "AFP": 15000.0, "Reservations": 2500.0})
PROFILE = [7, 7, 8, 8, 8, 8, 8, 9, 9, 9, 9, 10]
plan = []
for f in funding:
    shares = [p * rng.uniform(0.85, 1.15) for p in PROFILE]; tot = sum(shares)
    for m in range(12):
        plan.append({"Fiscal Year": f["Fiscal Year"], "Account": f["Account"], "Fiscal Month": m + 1, "Planned Amount": round(f["TDP"] * shares[m] / tot, 2)})

summary = {"lines": len(rows), "allobj": n_allobj, "kept": len(kept),
           "obligation": round(-sum(r["obligation_amt_cum"] for r in kept), 2), "commitments": round(-sum(r["commitment_amt_cum"] for r in kept), 2),
           "disbursement": round(-sum(r["disbursement_amt_cum"] for r in kept), 2),
           "tdp": round(sum(f["TDP"] for f in funding), 2), "afp": round(sum(f["AFP"] for f in funding), 2),
           "reservations": round(sum(f["Reservations"] for f in funding), 2), "fundingRows": len(funding), "planRows": len(plan),
           "planTotal": round(sum(x["Planned Amount"] for x in plan), 2), "accounts": len(ACCOUNTS), "functionalAreas": len(FAS),
           "unmappedFa": UNMAPPED_FA["fa"], "unmappedLines": sum(1 for r in kept if not r["_acct"]),
           "documents": len({r["contract_doc_no"] for r in kept if r["contract_doc_no"]}),
           "sharedDesc": {"codes": ["21T0", "21T1"], "label": CI_DESC["21T0"],
                          "obligation": round(-sum(r["obligation_amt_cum"] for r in kept if r["commitment_item_fipex"] in ("21T0", "21T1")), 2),
                          "lines": sum(1 for r in kept if r["commitment_item_fipex"] in ("21T0", "21T1")),
                          "linesSecond": sum(1 for r in kept if r["commitment_item_fipex"] == "21T1")}}

os.makedirs(os.path.join(DIR, "data"), exist_ok=True)
def tbl(H, recs): return {"headers": H, "rows": [[x[h] for h in H] for x in recs]}
with open(os.path.join(DIR, "data", "funds_demo.js"), "w", encoding="utf-8") as f:
    f.write("// AUTO-GENERATED by data-generation/generate_funds_data.py - fictional data\n")
    f.write("window.FUNDS_DEMO = " + json.dumps({"asOf": "2026-10-30", "headers": HEADERS, "rows": [[r[h] for h in HEADERS] for r in rows],
                                              "funding": tbl(FUND_HEADERS, funding), "plan": tbl(PLAN_HEADERS, plan),
                                              "key": tbl(KEY_HEADERS, key), "cikey": tbl(CIKEY_HEADERS, cikey),
                                              "expect": summary}, separators=(",", ":")) + ";\n")

def save(path, sheet, H, recs, name, widths=None, text_cols=()):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = sheet; ws.append(H)
    if recs: 
        for r in recs: ws.append([r.get(h) if isinstance(r, dict) else r[i] for i, h in enumerate(H)])
    else:
        ws.append([None] * len(H))
        for c in range(1, len(H) + 1): ws.cell(2, c).number_format = "@" if H[c - 1] in text_cols else "#,##0.00"
    for i in range(1, len(H) + 1): ws.column_dimensions[get_column_letter(i)].width = (widths or [20] * len(H))[i - 1]
    t = Table(displayName=name, ref=f"A1:{get_column_letter(len(H))}{max(ws.max_row, 2)}"); t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    ws.add_table(t); ws.freeze_panes = "A2"; wb.save(path)

save(os.path.join(DIR, "data", "funds_sample.xlsx"), "Export", HEADERS, [{h: (None if h == "ssn" else r[h]) for h in HEADERS} for r in rows], "FundsData")
save(os.path.join(DIR, "data", "funding_sample.xlsx"), "Funding", FUND_HEADERS, funding, "FundingData")
save(os.path.join(DIR, "data", "spendplan_sample.xlsx"), "SpendPlan", PLAN_HEADERS, plan, "SpendPlanData")
save(os.path.join(DIR, "data", "accountkey_sample.xlsx"), "AccountKey", KEY_HEADERS, key, "AccountKey")
save(os.path.join(DIR, "data", "cikey_sample.xlsx"), "CommitmentItemKey", CIKEY_HEADERS, cikey, "CommitmentItemKey")
with open(os.path.join(DIR, "funds_template.csv"), "w", newline="", encoding="utf-8") as f: csv.writer(f).writerow(USED)
TXT = ("Fiscal Year", "Account", "Functional Area", "Sag", "MDEP", "Commitment Item", "Description", "Fiscal Month")
for path in (os.path.join(DIR, "funds_template.xlsx"),):
    save(path, "Export", USED, None, "FundsData", [22] * len(USED), text_cols=("contract_doc_no", "commitment_item_fipex", "functional_area_farea", "appropriation_type", "fiscal_year", "fiscal_month"))
for d, names in ((DIR, ("funding_template.xlsx", "spendplan_template.xlsx", "accountkey_template.xlsx", "cikey_template.xlsx")),
                 (DL, ("funding-template.xlsx", "spend-plan-template.xlsx", "account-key-template.xlsx", "commitment-item-key-template.xlsx"))):
    save(os.path.join(d, names[0]), "Funding", FUND_HEADERS, None, "FundingData", [14, 34, 18, 18, 18], TXT)
    save(os.path.join(d, names[1]), "SpendPlan", PLAN_HEADERS, None, "SpendPlanData", [14, 34, 14, 18], TXT)
    save(os.path.join(d, names[2]), "AccountKey", KEY_HEADERS, None, "AccountKey", [20, 36, 10, 10], TXT)
    save(os.path.join(d, names[3]), "CommitmentItemKey", CIKEY_HEADERS, None, "CommitmentItemKey", [18, 40], TXT)
print(json.dumps(summary))
