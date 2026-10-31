#!/usr/bin/env python3
"""Headless-Chrome checks for the Status of Funds dashboard with FICTIONAL data (writes only to a temp folder).
Builds a wide test export in the real lowercase layout (extra columns, a filled-in test ssn column, ALLOBJ lines, text
amounts with $ , () and trailing minus, #REF! cells), then checks: ALLOBJ removed, ssn never in the page or the saved file,
totals, multi-file + duplicate-file handling, _xHHHH_ headers, Save with data round trip, Power Automate template fill,
CSV export, zero network requests and no console errors.
Run from the repo root after tools/build-standalone.py:  python3 tools/test-finance.py   (needs openpyxl + playwright)"""
import json, os, random, re, sys, tempfile
import openpyxl
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SINGLE = os.path.join(ROOT, "downloads", "finance-dashboard.html")
TEMPLATE = os.path.join(ROOT, "downloads", "finance-dashboard-template.html")
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
SHOT = os.environ.get("SHOT", "")
SSN = "999-00-4321"            # fictional marker; must never reach the page
FAILS = []
def check(ok, label):
    print(("  PASS " if ok else "  FAIL ") + label)
    if not ok: FAILS.append(label)

rng = random.Random(11)
H = ["fund", "contract_doc_no", "commitment_item_fipex", "functional_area_farea", "appropriation_type", "fiscal_year", "fiscal_month", "ssn",
     "obligation_amt_cum", "commitment_amt_cum", "disbursement_amt_cum", "vendor_city", "sag", "mdep"] + [f"extra_col_{i}" for i in range(60)]
FAS = ["121G11ABCD", "131G21TRNG", "113G05LGLS", "1N0G44MEDS", "999G99NOFD"]     # last one has no funding row
ACCTS = {"121G11ABCD": "Course Supplies", "131G21TRNG": "Range Operations", "113G05LGLS": "Lawyers", "1N0G44MEDS": "Doctor Support"}
MON = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"]
def make(n, seed):
    r = random.Random(seed); rows = []; exp = {"obl": 0.0, "com": 0.0, "disb": 0.0, "fy_fa": {}, "fy_m": {}, "badm": 0, "kept": 0, "allobj": 0, "docs": set()}
    for i in range(n):
        allobj = r.random() < 0.08
        ci = r.choice(["ALLOBJ", " allobj", "Allobj "]) if allobj else r.choice(["21T100", "26FF00", "252G00", "31EQ00"])
        obl, com = round(r.uniform(-500, 90000), 2), round(r.uniform(0, 120000), 2)
        disb = round(max(obl, 0) * r.uniform(0, 1), 2)
        fa, fy = FAS[i % len(FAS)], r.choice([2025, 2026])
        doc = f"00{r.randrange(10**7, 10**8)}"
        mm = r.randrange(1, 13)
        fmv = [mm, f"{mm:02d}", f"{mm}.0", f"P{mm:02d}", MON[mm - 1], f"{mm} - {MON[mm - 1]}", float(mm)][i % 7]
        if i % 41 == 0: fmv, mm = None, None                  # blank month
        elif i % 97 == 5: fmv, mm = "13", None                # unreadable month: warned, treated as blank
        style = i % 5
        so = {0: obl, 1: f"${obl:,.2f}", 2: (f"({abs(obl):,.2f})" if obl < 0 else f"{obl:,.2f}"), 3: (f"{abs(obl):,.2f}-" if obl < 0 else str(obl)), 4: obl}[style]
        sc = "#REF!" if i % 37 == 0 else com
        if i % 37 == 0: com_v = 0.0
        else: com_v = com
        row = {"fund": "2065", "contract_doc_no": doc, "commitment_item_fipex": ci, "functional_area_farea": fa, "disbursement_amt_cum": disb,
               "appropriation_type": r.choice(["OMNG", "NGPA"]), "fiscal_year": fy, "fiscal_month": fmv, "ssn": SSN,
               "obligation_amt_cum": so, "commitment_amt_cum": sc, "vendor_city": "Anytown", "sag": r.choice(["111", "121", "131"]), "mdep": r.choice(["QDPC", "TATM"])}
        for k in range(60): row[f"extra_col_{k}"] = f"x{k}"
        rows.append(row)
        if allobj: exp["allobj"] += 1
        else:
            exp["obl"] += obl; exp["com"] += com_v; exp["disb"] += disb; exp["kept"] += 1; exp["docs"].add(doc)
            g = exp["fy_fa"].setdefault((fy, fa), [0.0, 0.0]); g[0] += obl; g[1] += disb
            if mm: g = exp["fy_m"].setdefault((fy, mm), [0.0, 0.0]); g[0] += obl; g[1] += disb
            if fmv == "13": exp["badm"] += 1
    return rows, exp
def write(path, rows, headers):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Export"
    ws.append(["Funds Management Report (fictional)"]); ws.append([])          # title block above the header row
    ws.append(headers)
    for r in rows: ws.append([r[h] for h in H])
    wb.save(path)

tmp = tempfile.mkdtemp(prefix="fin-test-")
rows1, e1 = make(400, 1); rows2, e2 = make(150, 2)
f1 = os.path.join(tmp, "export_fy.xlsx"); write(f1, rows1, H)
# second file: Excel Online style escapes and odd case/spacing in headers
H2 = [{"contract_doc_no": "Contract_x0020_Doc_x0020_No", "commitment_item_fipex": "COMMITMENT_ITEM_FIPEX", "obligation_amt_cum": "Obligation Amt Cum",
       "ssn": "SSN", "fiscal_year": "Fiscal_x0020_Year", "fiscal_month": "Fiscal_x0020_Month"}.get(h, h) for h in H]
f2 = os.path.join(tmp, "export_2.xlsx"); write(f2, rows2, H2)
f1copy = os.path.join(tmp, "export_fy (copy).xlsx"); write(f1copy, rows1, H)
# funding file: Fiscal Year (as FY25), Functional Area, Account, TDP, AFP, Reservations; a title row above the headers; one row with no lines
fund_rows = []
for fy in (2025, 2026):
    for fa in FAS[:4]:
        tdp = round(rng.uniform(2e6, 6e6), 2)
        fund_rows.append([f"FY{fy % 100}", fa, ACCTS[fa], tdp, round(tdp * 0.8, 2), round(rng.uniform(0, 50000), 2)])
fund_rows.append(["FY27", "121G11ABCD", "Course Supplies", 100000.0, 10000.0, 500.0])
FT = {"tdp": round(sum(r[3] for r in fund_rows), 2), "afp": round(sum(r[4] for r in fund_rows), 2), "res": round(sum(r[5] for r in fund_rows), 2)}
fundp = os.path.join(tmp, "Funding FY25-26.xlsx")
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Funding"; ws.append(["Iowa ARNG funding (fictional)"])
ws.append(["Fiscal Year", "Functional Area", "Account", "TDP", "AFP", "Reservations"])
for r in fund_rows: ws.append([r[0], r[1], r[2], f"${r[3]:,.2f}" if r[3] > 3e6 else r[3], r[4], r[5]])
wb.save(fundp)
# spend plan: month names for FY26, numbers for FY25; Functional Area + Account
plan_rows = []
for fy in (2025, 2026):
    for fa in FAS[:4]:
        for m in range(1, 13):
            plan_rows.append([f"FY{fy % 100}", fa, ACCTS[fa], MON[m - 1] if fy == 2026 else m, round(rng.uniform(50000, 400000), 2)])
planp = os.path.join(tmp, "Spend plan.xlsx")
wb = openpyxl.Workbook(); ws = wb.active; ws.append(["Fiscal Year", "Functional Area", "Account", "Fiscal Month", "Planned Amount"])
for r in plan_rows: ws.append(r)
wb.save(planp)
def plan_cum(fy, fas=None):
    m = [0.0] * 12
    for r in plan_rows:
        if r[0] == f"FY{fy % 100}" and (fas is None or r[1] in fas): m[(MON.index(r[3]) + 1 if isinstance(r[3], str) else r[3]) - 1] += r[4]
    return [round(sum(m[:i + 1]), 2) for i in range(12)]
def act_cum(fy, which="od"):
    m = [0.0] * 12
    for e in (e1, e2):
        for (y, mm), (o, d) in e["fy_m"].items():
            if y == fy: m[mm - 1] += {"od": o + d, "o": o, "d": d}[which]
    return [round(sum(m[:i + 1]), 2) for i in range(12)]
DS = "DashKit.charts.cCum.data.datasets.map(function(d){return {label:d.label,data:d.data}})"
def ds(pg): return {d["label"].split(" (")[0]: d["data"] for d in pg.evaluate(DS)}
def close(a, b): return a is not None and b is not None and abs(a - b) < 0.02
csvp = os.path.join(tmp, "export.csv")
import csv
with open(csvp, "w", newline="") as f:
    w = csv.writer(f); w.writerow(H)
    for r in rows2: w.writerow([r[h] for h in H])

def money_text(v): return f"{v:,.2f}"

def run():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        errors, net = [], []
        def page_new():
            pg = ctx.new_page()
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("request", lambda r: net.append(r.url) if not r.url.startswith(("file:", "data:", "blob:")) else None)
            return pg
        pg = page_new(); pg.goto("file://" + SINGLE); pg.wait_for_timeout(800)
        D = pg.evaluate("window.FUNDS_DEMO.expect")
        txt = pg.inner_text("body")
        check("ALLOBJ" not in pg.inner_text("#tDocs"), "demo: no ALLOBJ line in the table")
        check(f"{D['allobj']} ALLOBJ lines removed" in txt, f"demo: load bar says {D['allobj']} ALLOBJ lines removed")
        kp = pg.inner_text("#kpis")
        check(money_text(D["obligation"]) in (pg.get_attribute("#kpis .kpi.obl", "title") or "") and "$" + money_text(D["disbursement"]) in kp, "demo: Obligation + Disbursement KPIs match the generator")
        for k, lbl in (("tdp", "TDP"), ("afp", "AFP"), ("reservations", "Reservations")):
            check(money_text(D[k]) in pg.get_attribute(f"#kpis .kpi.{'res' if k == 'reservations' else k}", "title"), f"demo: {lbl} KPI = generator")
        bal = round(D["tdp"] - D["reservations"] - D["obligation"] - D["disbursement"], 2)
        check(money_text(abs(bal)) in pg.get_attribute("#kpis .kpi.bal", "title"), f"demo: Balance = TDP - Res - Obl - Disb ({bal:,.2f})")
        check("$" + money_text(D["commitments"]) in pg.inner_text("#tDocs tfoot"), "demo: Commitments total in line table footer")
        check(pg.is_visible("#tFund") and "ACCOUNT" in pg.inner_text("#tFund thead").upper(), "demo: funding vs execution table with Account")
        check(pg.is_visible("#cPos"), "demo: position chart")
        fm_opts = pg.eval_on_selector_all("#fFm option", "o => o.map(x => x.textContent)")
        check(fm_opts[1:13] == [f"{i} - {m}" for i, m in enumerate(MON, 1)], "demo: Fiscal Month filter in FY order, 1 - Oct .. 12 - Sep")
        check(re.search(r"\b\d{1,2} - (Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep)\b", pg.inner_text("#tDocs tbody")) is not None, "demo: line table shows month names")
        d0 = ds(pg); tfy = pg.inner_text("#tFy option:first-child")
        check(set(d0) == {"Cumulative spent", "Straight-line pace", "Spend plan"}, "demo: cumulative chart has actual, pace, plan " + str(list(d0)))
        check("FY2026" in tfy and "Showing FY2026:" in pg.inner_text("#trendNote"), "demo: trend auto year FY2026 (FY27 has 1 month) " + tfy)
        check("Spent = Obligation + Disbursement" in pg.inner_text("#trendNote"), "demo: states what counts as spent")
        check(pg.is_hidden("#planHint") and pg.is_hidden("#paceHint"), "demo: no hints")
        check("of year elapsed" in pg.inner_text("#pace") and "12/12" in pg.inner_text("#pace"), "demo: pace indicator (past year = 12/12)")
        check(str(D["documents"]) in kp and f"{D['kept']:,}" in kp, "demo: line and document counts")
        fa0 = pg.evaluate("window.FUNDS_DEMO.funding.rows[0][1]")
        check(re.match(r"^\d{3}G\d{2}[A-Z]{4}$", fa0) is not None, "demo: functional area looks like 111G11AAAA " + fa0)
        check("fictional" in pg.inner_text("#dataDisclaimer"), "demo: fictional footer")
        if SHOT: pg.screenshot(path=SHOT, full_page=True)
        # filter + chart + search + sort
        pg.select_option("#fAppn", "OMNG"); pg.wait_for_timeout(200)
        check("Appropriation OMNG" in pg.inner_text("#scopeLabel"), "filter: scope label")
        pg.fill("#fSearch", "W91ZZZ"); pg.wait_for_timeout(300)
        check("match" in pg.inner_text("#searchNote"), "search: note shown")
        pg.click("#tDocs thead th[data-k=doc]"); pg.wait_for_timeout(100)
        check("asc" in (pg.get_attribute("#tDocs thead th[data-k=doc]", "class") or ""), "sort: header toggles")
        pg.click("#btnReset"); pg.wait_for_timeout(200)
        # load two files + a duplicate copy
        pg.set_input_files("#fileInput", [f1, f2, f1copy]); pg.wait_for_timeout(2500)
        exp_obl, exp_com, exp_disb = e1["obl"] + e2["obl"], e1["com"] + e2["com"], e1["disb"] + e2["disb"]
        kp = pg.inner_text("#kpis"); body = pg.inner_text("body"); html = pg.content()
        check(money_text(round(exp_obl, 2)) in (pg.get_attribute("#kpis .kpi.obl", "title") or ""), f"files: obligation total {exp_obl:,.2f}")
        check("$" + money_text(round(exp_com, 2)) in pg.inner_text("#tDocs tfoot"), f"files: commitments total {exp_com:,.2f} (#REF! = blank)")
        check("$" + money_text(round(exp_disb, 2)) in kp, f"files: disbursement total {exp_disb:,.2f}")
        check(kp.count("Load funding file") == 4 and pg.is_visible("#fundNeed") and pg.is_hidden("#fundPanel"), "files, no funding: TDP/AFP/Reservations/Balance say Load funding file")
        check("No funding file loaded" in pg.inner_text("#loadReport"), "files, no funding: report says so")
        check(pg.is_visible("#paceHint") and pg.is_visible("#planHint"), "files, no funding/plan: pace + Load spend plan hints")
        check("Straight-line pace" not in ds(pg), "files, no funding: no pace line")
        check(f"{e1['badm']} fiscal month value(s)" in pg.inner_text("#loadReport") and e1['badm'] > 0, "files: unreadable fiscal month warned")
        check(f"{e1['kept'] + e2['kept']:,}" in kp, "files: line count")
        check(f"{e1['allobj'] + e2['allobj']} ALLOBJ lines removed" in body, "files: ALLOBJ count in load bar")
        rep = pg.inner_text("#loadReport")
        check("Same content as export_fy.xlsx" in rep, "files: duplicate file skipped")
        check("11 of 11 columns matched" in rep, "files: _xHHHH_ / case-insensitive headers matched")
        check(SSN not in html and SSN not in body, "files: ssn values never in the DOM")
        check(not re.search(r"\bssn\b", body, re.I), "files: no ssn column name in visible text")
        check("Nothing is uploaded" in pg.inner_text("#dataDisclaimer"), "files: footer switched")
        check("ALLOBJ" not in pg.inner_text("#tDocs") and "allobj" not in pg.inner_text("#tDocs").lower(), "files: no ALLOBJ rows in table")
        check(not pg.is_disabled("#btnSave"), "files: Save enabled")
        # funding file through its own button: keeps the exports
        pg.set_input_files("#fundInput", [fundp]); pg.wait_for_timeout(1500)
        def ktitle(c): return pg.get_attribute(f"#kpis .kpi.{c}", "title") or ""
        check(money_text(FT["tdp"]) in ktitle("tdp") and money_text(FT["afp"]) in ktitle("afp") and money_text(FT["res"]) in ktitle("res"), "funding: TDP/AFP/Reservations totals (title row, $ text, FY25 format)")
        check(money_text(round(exp_obl, 2)) in (pg.get_attribute("#kpis .kpi.obl", "title") or ""), "funding: export lines kept")
        bal = round(FT["tdp"] - FT["res"] - exp_obl - exp_disb, 2)
        check(money_text(abs(bal)) in ktitle("bal") and (bal >= 0) == ("-$" not in ktitle("bal")), f"funding: Balance = TDP - Reservations - Obligation - Disbursement ({bal:,.2f})")
        rep = pg.inner_text("#loadReport")
        check("Fiscal Year + Functional Area" in rep, "funding: matched on Fiscal Year + Functional Area")
        nofd = sum(v[0] for k, v in list(e1["fy_fa"].items()) + list(e2["fy_fa"].items()) if k[1] == "999G99NOFD")
        check("have no matching funding row" in rep and "no funding row" in pg.inner_text("#tFund"), "funding: unmatched lines flagged")
        check("Range Operations" in pg.inner_text("#tFund") and "Course Supplies" in pg.inner_text("#tFund"), "funding: account names in the table")
        pg.select_option("#fFa", "131G21TRNG"); pg.select_option("#fFy", "2026"); pg.wait_for_timeout(300)
        frow = [r for r in fund_rows if r[0] == "FY26" and r[1] == "131G21TRNG"][0]
        o, dd = (e1["fy_fa"].get((2026, "131G21TRNG"), [0, 0])[i] + e2["fy_fa"].get((2026, "131G21TRNG"), [0, 0])[i] for i in (0, 1))
        b1 = round(frow[3] - frow[5] - o - dd, 2)
        check(money_text(frow[3]) in ktitle("tdp") and money_text(abs(b1)) in ktitle("bal"), f"funding: filtered FY26 131G21TRNG balance {b1:,.2f}")
        pg.select_option("#fCi", "26FF00"); pg.wait_for_timeout(300)
        check("not split by Commitment Item" in pg.inner_text("#kpis"), "funding: CI filter notes funding is not split")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        # trend for FY2025 with funding
        pg.select_option("#tFy", "2025"); pg.wait_for_timeout(300)
        d1 = ds(pg); ac = act_cum(2025)
        check(all(close(a, b) for a, b in zip(d1["Cumulative spent"], ac)), "trend: cumulative Obligation + Disbursement by fiscal month (01, 1.0, P01, Oct, 1 - Oct formats)")
        tdp25 = round(sum(r[3] for r in fund_rows if r[0] == "FY25"), 2)
        check(close(d1["Straight-line pace"][0], tdp25 / 12) and close(d1["Straight-line pace"][11], tdp25), "trend: pace = TDP x m/12")
        mon = pg.evaluate("DashKit.charts.cMon.data.datasets[0].data")
        check(close(mon[2], ac[2] - ac[1]), "trend: monthly bars")
        pace_txt = pg.inner_text("#pace")
        tot25 = sum(v[0] + v[1] for e in (e1, e2) for k, v in e["fy_fa"].items() if k[0] == 2025)
        check(f"{round(tot25 / tdp25 * 100)}%" in pace_txt and "100%" in pace_txt, f"trend: % of TDP spent {tot25 / tdp25:.0%} vs 100% elapsed")
        pg.select_option("#tMetric", "o"); pg.wait_for_timeout(300)
        check(close(ds(pg)["Cumulative spent"][11], act_cum(2025, "o")[11]), "trend: Spent switch to Obligation only")
        pg.select_option("#tMetric", "od")
        pg.set_input_files("#planInput", [planp]); pg.wait_for_timeout(1500)
        pg.select_option("#tFy", "2026"); pg.wait_for_timeout(300)
        d2 = ds(pg)
        check("Spend plan" in d2 and all(close(a, b) for a, b in zip(d2["Spend plan"], plan_cum(2026))), "plan: cumulative plan line (month names)")
        check(pg.is_hidden("#planHint") and "$" + money_text(round(exp_obl, 2)) not in "" and money_text(FT["tdp"]) in ktitle("tdp"), "plan: export + funding kept, hint hidden")
        pg.select_option("#fFa", "131G21TRNG"); pg.wait_for_timeout(300)
        check(all(close(a, b) for a, b in zip(ds(pg)["Spend plan"], plan_cum(2026, ["131G21TRNG"]))), "plan: limited to the filtered Functional Area")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        with pg.expect_download() as dl: pg.click("#btnFundCsv")
        fcsv = open(dl.value.path(), encoding="utf-8").read().splitlines()
        check(fcsv[0] == "Fiscal Year,Functional Area,Account,TDP,AFP,Reservations,Obligation,Disbursement,Balance,% obligated", "funding csv: header " + fcsv[0])
        # CSV export
        with pg.expect_download() as dl: pg.click("#btnCsv")
        csvt = open(dl.value.path(), encoding="utf-8").read()
        check(csvt.splitlines()[0] == "Document Number,Commitment Item,Functional Area,Appropriation,Fiscal Year,Fiscal Month,Obligation,Commitments,Disbursement,Sag,MDEP", "csv: renamed header row")
        check(len(csvt.strip().splitlines()) == e1["kept"] + e2["kept"] + 1 and SSN not in csvt and "ALLOBJ" not in csvt.upper(), "csv: all filtered lines, no ssn/ALLOBJ")
        # save with data
        with pg.expect_download() as dl: pg.click("#btnSave")
        d = dl.value; saved = os.path.join(tmp, d.suggested_filename); d.save_as(saved)
        st = open(saved, encoding="utf-8").read()
        check(re.match(r"FUNDS-REAL-DATA-\d{2}[A-Z][a-z]{2}\d{2}\.html$", d.suggested_filename) is not None, "save: filename " + d.suggested_filename)
        snap = st.split('<script id="financeSaved" type="application/json">')[-1].split("</script>")[0]
        check(SSN not in st, "save: no ssn value anywhere in the saved file")
        so = json.loads(snap)
        check(so["headers"] == ["Document Number", "Commitment Item", "Functional Area", "Appropriation", "Fiscal Year", "Fiscal Month", "Obligation", "Commitments", "Disbursement", "Sag", "MDEP"]
              and all(str(r[1]).strip().upper() != "ALLOBJ" for r in so["rows"]) and len(so["rows"]) == e1["kept"] + e2["kept"], "save: snapshot = 10 renamed columns only, no ALLOBJ lines")
        check(so.get("funding") and so["funding"]["headers"] == ["Fiscal Year", "Functional Area", "Account", "TDP", "AFP", "Reservations"] and len(so["funding"]["rows"]) == len(fund_rows), "save: funding rows included")
        check(so.get("plan") and len(so["plan"]["rows"]) == len(plan_rows), "save: spend plan included")
        pg.close()
        pg = page_new(); pg.goto("file://" + saved); pg.wait_for_timeout(1000)
        check(pg.is_visible("#realBanner"), "saved: red real-data banner")
        check(money_text(round(exp_obl, 2)) in (pg.get_attribute("#kpis .kpi.obl", "title") or "") and money_text(abs(bal)) in (pg.get_attribute("#kpis .kpi.bal", "title") or ""), "saved: same totals incl. Balance")
        pg.select_option("#tFy", "2026"); pg.wait_for_timeout(300)
        check(all(close(a, b) for a, b in zip(ds(pg).get("Spend plan", []), plan_cum(2026))), "saved: spend plan line kept")
        check(f"{e1['allobj'] + e2['allobj']} ALLOBJ lines removed" in pg.inner_text("body"), "saved: ALLOBJ count kept")
        pg.close()
        # csv input
        pg = page_new(); pg.goto("file://" + SINGLE); pg.wait_for_timeout(500)
        pg.set_input_files("#fileInput", [csvp, fundp]); pg.wait_for_timeout(1500)
        check(money_text(round(e2["obl"], 2)) in (pg.get_attribute("#kpis .kpi.obl", "title") or ""), "csv input: obligation total")
        check(money_text(FT["tdp"]) in (pg.get_attribute("#kpis .kpi.tdp", "title") or ""), "one Load step: export + funding told apart by headers")
        pg.close()
        # Power Automate: fill the template like the flow's Compose (Excel Online rows: strings, @odata.etag, ItemInternalId)
        t = open(TEMPLATE, encoding="ascii").read()
        def online(rows, headers):
            out = []
            for r in rows:
                o = {"@odata.etag": "", "ItemInternalId": "x"}
                for h, hh in zip(H, headers): v = r[h]; o[hh] = "" if v is None else (str(v) if not isinstance(v, float) or not v.is_integer() else str(int(v)))
                out.append(o)
            return out
        payload = [{"file": "FundsExport.xlsx", "rows": online(rows1, [h.replace("_", "_x005f_") if h == "sag" else h for h in H])}, {"file": "Second.xlsx", "rows": online(rows2, H2)},
                   {"file": "Funding", "rows": [dict({"@odata.etag": "", "ItemInternalId": "y"}, **{"Fiscal Year": r[0], "Functional Area": r[1], "Account": r[2], "TDP": str(r[3]), "AFP": str(r[4]), "Reservations": str(r[5])}) for r in fund_rows]},
                   {"file": "Spend plan", "rows": [{"Fiscal Year": r[0], "Functional Area": r[1], "Account": r[2], "Fiscal Month": str(r[3]), "Planned Amount": str(r[4])} for r in plan_rows]}]
        filled = t.replace("__PA_REFRESHED__", "30-Oct-26 0600").replace("__PA_DATA__", json.dumps(payload).replace("</", "<\\/")) + "\n<div>appended by SharePoint</div>"
        pa = os.path.join(tmp, "Funds_Dashboard.html"); open(pa, "w").write(filled)
        pg = page_new(); pg.goto("file://" + pa); pg.wait_for_timeout(1500)
        check(pg.is_visible("#realBanner") and "30-Oct-26 0600" in pg.inner_text("#realBanner"), "PA: banner with refresh time")
        check(money_text(round(exp_obl, 2)) in (pg.get_attribute("#kpis .kpi.obl", "title") or ""), "PA: totals match")
        check(money_text(abs(bal)) in (pg.get_attribute("#kpis .kpi.bal", "title") or ""), "PA: funding table (2nd List rows) joined, Balance matches")
        pg.select_option("#tFy", "2026"); pg.wait_for_timeout(300)
        check(all(close(a, b) for a, b in zip(ds(pg).get("Spend plan", []), plan_cum(2026))), "PA: spend plan (3rd List rows) drawn")
        check(SSN not in pg.inner_text("body"), "PA: ssn not shown")
        with pg.expect_download() as dl: pg.click("#btnSave")
        st2 = open(dl.value.path(), encoding="utf-8").read()
        check(SSN not in st2 and "embedded-data" not in st2.split("</script>")[-1], "PA save: no ssn, no raw flow data carried over")
        pg.close()
        pg = page_new(); pg.goto("file://" + TEMPLATE); pg.wait_for_timeout(800)
        check(pg.is_hidden("#realBanner") and "fictional" in pg.inner_text("#dataDisclaimer"), "PA template untouched: demo data")
        pg.close()
        check(not net, "no network requests " + str(net[:3]))
        check(not errors, "no console errors " + str(errors[:3]))
        b.close()

run()
print("FAILED: %d" % len(FAILS) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
