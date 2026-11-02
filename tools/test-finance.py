#!/usr/bin/env python3
"""Headless-Chrome checks for the Status of Funds dashboard with FICTIONAL data (writes only to a temp folder).
Test export in the real lowercase layout: extra columns, a filled-in test ssn column, sag/mdep columns with junk (must be ignored),
ALLOBJ lines, NEGATIVE amounts as text with $ , () and trailing minus, #REF! cells, fiscal months in several formats.
Side files: Account Key (FA -> Account, Sag, MDEP; one FA unmapped, one conflicting Sag), funding per Fiscal Year + Account
(plus an older Functional Area format), Commitment Item Key (one code unmapped), spend plan by Account.
Checks totals, sign flip, account roll-up and Balance, keyed Sag/MDEP, descriptions, Save with data, Power Automate fill (5 tables),
CSV export, zero network requests and no console errors.
Run from the repo root after tools/build-standalone.py:  python3 tools/test-finance.py   (needs openpyxl + playwright)"""
import csv, json, os, random, re, sys, tempfile
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
MON = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"]
H = ["fund", "contract_doc_no", "commitment_item_fipex", "functional_area_farea", "appropriation_type", "fiscal_year", "fiscal_month", "ssn",
     "obligation_amt_cum", "commitment_amt_cum", "disbursement_amt_cum", "vendor_city", "sag", "mdep"] + [f"extra_col_{i}" for i in range(60)]
FAS = ["121G11ABCD", "131G21TRNG", "113G05LGLS", "1N0G44MEDS", "999G99NOFD"]          # last one is not in the Account Key
ACCT = {"121G11ABCD": "Course Supplies", "131G21TRNG": "Course Supplies", "113G05LGLS": "Lawyers", "1N0G44MEDS": "Lawyers"}
SAGM = {"Course Supplies": ("1N", "TATM"), "Lawyers": ("131", "QLPR")}
CIS = ["21T100", "26FF00", "252G00", "31EQ00"]
CIDESC = {"21T100": "Travel (example)", "26FF00": "Fuel (example)", "252G00": "Contract Services (example)"}   # 31EQ00 unmapped
def styled(v, style):   # v is the export value (negative for obligations)
    return {0: v, 1: (f"-${abs(v):,.2f}" if v < 0 else f"${v:,.2f}"), 2: (f"({abs(v):,.2f})" if v < 0 else f"{v:,.2f}"), 3: (f"{abs(v):,.2f}-" if v < 0 else str(v)), 4: v}[style]
def make(n, seed):
    r = random.Random(seed); rows = []
    exp = {"obl": 0.0, "com": 0.0, "disb": 0.0, "fy_acct": {}, "fy_m": {}, "badm": 0, "kept": 0, "allobj": 0, "docs": set(), "unm": 0}
    for i in range(n):
        allobj = r.random() < 0.08
        ci = r.choice(["ALLOBJ", " allobj", "Allobj "]) if allobj else r.choice(CIS)
        obl, com = round(r.uniform(-500, 90000), 2), round(r.uniform(0, 120000), 2)
        disb = round(max(obl, 0) * r.uniform(0, 1), 2)
        fa, fy = FAS[i % len(FAS)], r.choice([2025, 2026])
        doc = f"00{r.randrange(10**7, 10**8)}"
        mm = r.randrange(1, 13)
        fmv = [mm, f"{mm:02d}", f"{mm}.0", f"P{mm:02d}", MON[mm - 1], f"{mm} - {MON[mm - 1]}", float(mm)][i % 7]
        if i % 41 == 0: fmv, mm = None, None
        elif i % 97 == 5: fmv, mm = "13", None
        com_v = 0.0 if i % 37 == 0 else com
        row = {"fund": "2065", "contract_doc_no": doc, "commitment_item_fipex": ci, "functional_area_farea": fa, "fiscal_month": fmv,
               "appropriation_type": r.choice(["OMNG", "NGPA"]), "fiscal_year": fy, "ssn": SSN,
               "obligation_amt_cum": styled(-obl, i % 5), "commitment_amt_cum": "#REF!" if i % 37 == 0 else -com, "disbursement_amt_cum": -disb,
               "vendor_city": "Anytown", "sag": "ZZ", "mdep": "ZZZZ"}
        for k in range(60): row[f"extra_col_{k}"] = f"x{k}"
        rows.append(row)
        if allobj: exp["allobj"] += 1; continue
        exp["obl"] += obl; exp["com"] += com_v; exp["disb"] += disb; exp["kept"] += 1; exp["docs"].add(doc)
        a = ACCT.get(fa)
        if not a: exp["unm"] += 1
        g = exp["fy_acct"].setdefault((fy, a or fa), [0.0, 0.0]); g[0] += obl; g[1] += disb
        if mm: g = exp["fy_m"].setdefault((fy, mm), [0.0, 0.0]); g[0] += obl; g[1] += disb
        if fmv == "13": exp["badm"] += 1
    return rows, exp
def write(path, rows, headers):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Export"
    ws.append(["Funds Management Report (fictional)"]); ws.append([])          # title block above the header row
    ws.append(headers)
    for r in rows: ws.append([r[h] for h in H])
    wb.save(path)
def xlsx(path, headers, rows, title=None):
    wb = openpyxl.Workbook(); ws = wb.active
    if title: ws.append([title])
    ws.append(headers)
    for r in rows: ws.append(list(r))
    wb.save(path)

tmp = tempfile.mkdtemp(prefix="fin-test-")
rows1, e1 = make(400, 1); rows2, e2 = make(150, 2)
f1 = os.path.join(tmp, "export_fy.xlsx"); write(f1, rows1, H)
H2 = [{"contract_doc_no": "Contract_x0020_Doc_x0020_No", "commitment_item_fipex": "COMMITMENT_ITEM_FIPEX", "obligation_amt_cum": "Obligation Amt Cum",
       "ssn": "SSN", "fiscal_year": "Fiscal_x0020_Year", "fiscal_month": "Fiscal_x0020_Month"}.get(h, h) for h in H]
f2 = os.path.join(tmp, "export_2.xlsx"); write(f2, rows2, H2)
f1copy = os.path.join(tmp, "export_fy (copy).xlsx"); write(f1copy, rows1, H)
# Account Key: 4 FAs -> 2 Accounts; an extra FA for Lawyers lists a different Sag (conflict, first one used)
key_rows = [[fa, ACCT[fa], *SAGM[ACCT[fa]]] for fa in FAS[:4]] + [["777G77CNFL", "lawyers ", "132", "QLPR"]]
keyp = os.path.join(tmp, "Account Key.xlsx"); xlsx(keyp, ["Functional Area", "Account", "Sag", "MDEP"], key_rows)
cikp = os.path.join(tmp, "CI Key.xlsx"); xlsx(cikp, ["Commitment Item", "Description"], [[c, d] for c, d in CIDESC.items()])
# funding per Fiscal Year + Account (title row, $ text, FY25 style); one row with no lines
fund_rows = []
for fy in (2025, 2026):
    for a in ("Course Supplies", "Lawyers"):
        tdp = round(rng.uniform(4e6, 9e6), 2)
        fund_rows.append([f"FY{fy % 100}", a, tdp, round(tdp * 0.8, 2), round(rng.uniform(0, 50000), 2)])
fund_rows.append(["FY27", "Course Supplies", 100000.0, 10000.0, 500.0])
FT = {"tdp": round(sum(r[2] for r in fund_rows), 2), "afp": round(sum(r[3] for r in fund_rows), 2), "res": round(sum(r[4] for r in fund_rows), 2)}
fundp = os.path.join(tmp, "Funding FY25-26.xlsx")
xlsx(fundp, ["Fiscal Year", "Account", "TDP", "AFP", "Reservations"], [[r[0], r[1].upper() if r[1] == "Lawyers" else r[1], f"${r[2]:,.2f}" if r[2] > 6e6 else r[2], r[3], r[4]] for r in fund_rows], "Iowa ARNG funding (fictional)")
# older funding format by Functional Area: split each account's TDP over its two FAs -> must add up to the same per-Account totals
old_rows = []
for r in fund_rows:
    fas = [fa for fa in FAS[:4] if ACCT[fa] == r[1]]
    for i, fa in enumerate(fas): old_rows.append([r[0], fa, round(r[2] / 2, 2) if i == 0 else round(r[2] - round(r[2] / 2, 2), 2), round(r[3] / 2, 2) if i == 0 else round(r[3] - round(r[3] / 2, 2), 2), r[4] if i == 0 else 0])
oldp = os.path.join(tmp, "Funding by FA.xlsx"); xlsx(oldp, ["Fiscal Year", "Functional Area", "TDP", "AFP", "Reservations"], old_rows)
# spend plan by Account: month names for FY26, numbers for FY25
plan_rows = []
for fy in (2025, 2026):
    for a in ("Course Supplies", "Lawyers"):
        for m in range(1, 13): plan_rows.append([f"FY{fy % 100}", a, MON[m - 1] if fy == 2026 else m, round(rng.uniform(100000, 600000), 2)])
planp = os.path.join(tmp, "Spend plan.xlsx"); xlsx(planp, ["Fiscal Year", "Account", "Fiscal Month", "Planned Amount"], plan_rows)
def plan_cum(fy, accts=None):
    m = [0.0] * 12
    for r in plan_rows:
        if r[0] == f"FY{fy % 100}" and (accts is None or r[1] in accts): m[(MON.index(r[2]) + 1 if isinstance(r[2], str) else r[2]) - 1] += r[3]
    return [round(sum(m[:i + 1]), 2) for i in range(12)]
def act_cum(fy, which="od"):
    m = [0.0] * 12
    for e in (e1, e2):
        for (y, mm), (o, d) in e["fy_m"].items():
            if y == fy: m[mm - 1] += {"od": o + d, "o": o, "d": d}[which]
    return [round(sum(m[:i + 1]), 2) for i in range(12)]
def acct_sum(fy, a):
    return [sum(e["fy_acct"].get((fy, a), [0, 0])[i] for e in (e1, e2)) for i in (0, 1)]
DS = "DashKit.charts.cCum.data.datasets.map(function(d){return {label:d.label,data:d.data}})"
def ds(pg): return {d["label"].split(" (")[0]: d["data"] for d in pg.evaluate(DS)}
def close(a, b): return a is not None and b is not None and abs(a - b) < 0.02
csvp = os.path.join(tmp, "export.csv")
with open(csvp, "w", newline="") as f:
    w = csv.writer(f); w.writerow(H)
    for r in rows2: w.writerow([r[h] for h in H])
def money_text(v): return f"{v:,.2f}"
LINE_CSV = "Document Number,Commitment Item,CI Code,Functional Area,Account,Sag,MDEP,Appropriation,Fiscal Year,Fiscal Month,Obligation,Commitments,Disbursement"
EXPORT_SAVED = ["Document Number", "Commitment Item", "Functional Area", "Appropriation", "Fiscal Year", "Fiscal Month", "Obligation", "Commitments", "Disbursement"]

def run():
    exp_obl, exp_com, exp_disb = e1["obl"] + e2["obl"], e1["com"] + e2["com"], e1["disb"] + e2["disb"]
    bal = round(FT["tdp"] - FT["res"] - exp_obl - exp_disb, 2)
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
        def kt(pg, c): return pg.get_attribute(f"#kpis .kpi.{c}", "title") or ""
        pg = page_new(); pg.goto("file://" + SINGLE); pg.wait_for_timeout(900)
        D = pg.evaluate("window.FUNDS_DEMO.expect"); txt = pg.inner_text("body"); kp = pg.inner_text("#kpis")
        check("ALLOBJ" not in pg.inner_text("#tDocs"), "demo: no ALLOBJ line in the table")
        check(f"{D['allobj']} ALLOBJ lines removed" in txt, "demo: ALLOBJ count in load bar")
        check(pg.evaluate("window.FUNDS_DEMO.rows.filter(r => r[9] < 0).length") > D["kept"] * 0.8, "demo: export amounts are negative in the demo file")
        check(money_text(D["obligation"]) in kt(pg, "obl") and money_text(D["disbursement"]) in kt(pg, "disb") and "-$" not in kt(pg, "obl"), "demo: sign-flipped Obligation + Disbursement match the generator")
        for k, c in (("tdp", "tdp"), ("afp", "afp"), ("reservations", "res")): check(money_text(D[k]) in kt(pg, c), f"demo: {k} KPI")
        dbal = round(D["tdp"] - D["reservations"] - D["obligation"] - D["disbursement"], 2)
        check(money_text(abs(dbal)) in kt(pg, "bal"), f"demo: Balance {dbal:,.2f}")
        check("$" + money_text(D["commitments"]) in pg.inner_text("#tDocs tfoot"), "demo: Commitments total in line table")
        check(f"{D['functionalAreas']} Functional Areas" in pg.inner_text("#loadReport") and f"{D['accounts']} Accounts" in pg.inner_text("#loadReport"), "demo: several FAs per Account via the key")
        fu = pg.inner_text("#tFund")
        check("FUNCTIONAL AREAS" in pg.inner_text("#tFund thead").upper() and "Unmapped" in fu and D["unmappedFa"] in fu, "demo: funding table per Account with FAs, unmapped FA flagged")
        check("Travel (example)" in pg.inner_text("#tDocs tbody") and "Travel (example)" in pg.inner_text("#fCi"), "demo: commitment item descriptions in table and filter")
        check("23U1" in pg.inner_text("#fCi"), "demo: unmapped CI code shown raw")
        check("XX" not in pg.inner_text("#fSag") and "Unmapped" in pg.inner_text("#fSag"), "demo: Sag from the key (export sag ignored), Unmapped option")
        fm_opts = pg.eval_on_selector_all("#fFm option", "o => o.map(x => x.textContent)")
        check(fm_opts[1:13] == [f"{i} - {m}" for i, m in enumerate(MON, 1)], "demo: Fiscal Month filter in FY order")
        d0 = ds(pg)
        check(set(d0) == {"Cumulative spent", "Straight-line pace", "Spend plan"}, "demo: trend chart has actual, pace, plan")
        check("Showing FY2026:" in pg.inner_text("#trendNote"), "demo: trend auto year FY2026")
        key0 = pg.evaluate("window.FUNDS_DEMO.key.rows[0][0]")
        check(re.match(r"^\d{3}G\d{2}[A-Z]{4}$", key0) is not None, "demo: functional area looks like 111G11AAAA " + key0)
        check("fictional" in pg.inner_text("#dataDisclaimer"), "demo: fictional footer")
        if SHOT: pg.screenshot(path=SHOT, full_page=True)
        pg.select_option("#fAppn", "OMNG"); pg.wait_for_timeout(200)
        check("Appropriation OMNG" in pg.inner_text("#scopeLabel"), "filter: scope label")
        pg.fill("#fSearch", "Lawyers"); pg.wait_for_timeout(300)
        check("match" in pg.inner_text("#searchNote"), "search by account name")
        pg.click("#tDocs thead th[data-k=doc]"); pg.wait_for_timeout(100)
        check("asc" in (pg.get_attribute("#tDocs thead th[data-k=doc]", "class") or ""), "sort: header toggles")
        pg.click("#btnReset"); pg.wait_for_timeout(200)

        # exports only (two files + duplicate), no keys / funding
        pg.set_input_files("#fileInput", [f1, f2, f1copy]); pg.wait_for_timeout(2500)
        kp = pg.inner_text("#kpis"); body = pg.inner_text("body"); html = pg.content(); rep = pg.inner_text("#loadReport")
        check(money_text(round(exp_obl, 2)) in kt(pg, "obl") and "-$" not in kt(pg, "obl"), f"files: obligation sign-flipped to positive {exp_obl:,.2f}")
        check("$" + money_text(round(exp_com, 2)) in pg.inner_text("#tDocs tfoot"), "files: commitments total (#REF! = blank, flipped)")
        check(money_text(round(exp_disb, 2)) in kt(pg, "disb"), "files: disbursement total flipped")
        check("sign-flipped" in rep, "files: report says export amounts sign-flipped")
        check(kp.count("Load funding file") == 4 and pg.is_visible("#fundNeed"), "files, no funding: Load funding file")
        check("No Account Key loaded" in rep and pg.inner_text("#fSag").count("Unmapped") == 1, "files, no key: says so; Sag Unmapped")
        check(f"{e1['kept'] + e2['kept']:,}" in kp, "files: line count")
        check(f"{e1['allobj'] + e2['allobj']} ALLOBJ lines removed" in body, "files: ALLOBJ count")
        check("Same content as export_fy.xlsx" in rep, "files: duplicate file skipped")
        check("9 of 9 columns matched" in rep, "files: 9 export columns (no sag/mdep) matched, _xHHHH_ headers")
        check(f"{e1['badm']} fiscal month value(s)" in rep and e1["badm"] > 0, "files: unreadable fiscal month warned")
        check(SSN not in html and SSN not in body, "files: ssn values never in the DOM")
        check("ZZZZ" not in pg.inner_text("#tDocs") and "ZZZZ" not in pg.inner_text("#fMdep"), "files: export mdep column not read")
        # keys + funding together in one Load step (auto-detected)
        pg.set_input_files("#fileInput", [keyp, fundp, cikp]); pg.wait_for_timeout(1800)
        rep = pg.inner_text("#loadReport")
        check(money_text(FT["tdp"]) in kt(pg, "tdp") and money_text(FT["afp"]) in kt(pg, "afp") and money_text(FT["res"]) in kt(pg, "res"), "funding: TDP/AFP/Reservations per Account (case-insensitive names, $ text, title row)")
        check(money_text(round(exp_obl, 2)) in kt(pg, "obl"), "funding: export lines kept when side files load")
        check(money_text(abs(bal)) in kt(pg, "bal"), f"funding: Balance = TDP - Res - Obl - Disb ({bal:,.2f})")
        check("Fiscal Year + Account" in rep, "funding: matched per Fiscal Year + Account")
        check("unmapped Functional Area" in rep and "999G99NOFD" in rep, "key: unmapped FA flagged in report")
        check("different values for the same Account" in rep and "132" in rep, "key: conflicting Sag for one Account flagged")
        check("unmapped commitment item" in rep and "31EQ00" in rep, "CI key: unmapped code flagged")
        tf = pg.inner_text("#tFund")
        check("Course Supplies" in tf and "121G11ABCD, 131G21TRNG" in tf and "Unmapped" in tf, "funding table: one row per Account listing its FAs; unmapped row")
        check("Travel (example)" in pg.inner_text("#tDocs") and "21T100" in pg.inner_text("#tDocs"), "CI key: description shown, code kept in CI Code column")
        check("Course Supplies" in pg.inner_text("#fAcct") and pg.eval_on_selector_all("#fSag option", "o => o.map(x => x.textContent)")[1:] == ["1N", "131", "Unmapped"], "Sag filter uses keyed values")
        # per-account balance
        pg.select_option("#fAcct", "Course Supplies"); pg.select_option("#fFy", "2026"); pg.wait_for_timeout(300)
        fr = [r for r in fund_rows if r[0] == "FY26" and r[1] == "Course Supplies"][0]; o, d = acct_sum(2026, "Course Supplies")
        b1 = round(fr[2] - fr[4] - o - d, 2)
        check(money_text(fr[2]) in kt(pg, "tdp") and money_text(abs(b1)) in kt(pg, "bal"), f"Account FY26 Course Supplies: obligations of both FAs, Balance {b1:,.2f}")
        pg.click("#btnReset"); pg.select_option("#fSag", "131"); pg.wait_for_timeout(300)
        law = round(sum(r[2] for r in fund_rows if r[1] == "Lawyers"), 2)
        check(money_text(law) in kt(pg, "tdp"), "Sag filter 131 = Lawyers account TDP")
        pg.click("#btnReset"); pg.select_option("#fCi", "Fuel (example)"); pg.wait_for_timeout(300)
        check("not split by Commitment Item" in pg.inner_text("#kpis"), "CI filter: funding not split")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        # older funding format (by Functional Area) maps through the key to the same totals
        pg.set_input_files("#fundInput", [oldp]); pg.wait_for_timeout(1500)
        check(money_text(FT["tdp"]) in kt(pg, "tdp") and money_text(abs(bal)) in kt(pg, "bal") and "mapped to their Account through the key" in pg.inner_text("#loadReport"), "older funding by Functional Area -> mapped to Accounts, same Balance")
        pg.set_input_files("#fundInput", [fundp]); pg.wait_for_timeout(1500)
        # trend
        pg.select_option("#tFy", "2025"); pg.wait_for_timeout(300)
        d1 = ds(pg); ac = act_cum(2025)
        check(all(close(x, y) for x, y in zip(d1["Cumulative spent"], ac)), "trend: cumulative spent by fiscal month (flipped)")
        tdp25 = round(sum(r[2] for r in fund_rows if r[0] == "FY25"), 2)
        check(close(d1["Straight-line pace"][11], tdp25), "trend: pace = TDP x m/12")
        pg.set_input_files("#planInput", [planp]); pg.wait_for_timeout(1500)
        pg.select_option("#tFy", "2026"); pg.wait_for_timeout(300)
        check(all(close(x, y) for x, y in zip(ds(pg).get("Spend plan", []), plan_cum(2026))), "plan by Account: cumulative plan line")
        pg.select_option("#fFa", "113G05LGLS"); pg.wait_for_timeout(300)
        check(all(close(x, y) for x, y in zip(ds(pg).get("Spend plan", []), plan_cum(2026, ["Lawyers"]))), "plan limited to the filtered FA's Account")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        with pg.expect_download() as dl: pg.click("#btnFundCsv")
        fcsv = open(dl.value.path(), encoding="utf-8").read().splitlines()
        check(fcsv[0] == "Fiscal Year,Account,Functional Areas,TDP,AFP,Reservations,Obligation,Disbursement,Balance,% obligated,Mapped", "funding csv header " + fcsv[0])
        with pg.expect_download() as dl: pg.click("#btnCsv")
        csvt = open(dl.value.path(), encoding="utf-8").read()
        check(csvt.splitlines()[0] == LINE_CSV, "line csv header " + csvt.splitlines()[0])
        check("Travel (example)" in csvt and "31EQ00 (Unmapped)" in csvt and SSN not in csvt and "ALLOBJ" not in csvt.upper(), "line csv: descriptions, unmapped code, no ssn/ALLOBJ")
        check(len(csvt.strip().splitlines()) == e1["kept"] + e2["kept"] + 1, "line csv: all lines")
        # save with data
        with pg.expect_download() as dl: pg.click("#btnSave")
        d = dl.value; saved = os.path.join(tmp, d.suggested_filename); d.save_as(saved)
        st = open(saved, encoding="utf-8").read()
        check(re.match(r"FUNDS-REAL-DATA-\d{2}[A-Z][a-z]{2}\d{2}\.html$", d.suggested_filename) is not None, "save: filename")
        check(SSN not in st, "save: no ssn value in the saved file")
        so = json.loads(st.split('<script id="financeSaved" type="application/json">')[-1].split("</script>")[0])
        check(so["headers"] == EXPORT_SAVED and len(so["rows"]) == e1["kept"] + e2["kept"] and so.get("signFlipped") is True, "save: 9 export columns, no ALLOBJ, flagged as flipped")
        check(so.get("funding") and so.get("key") and so.get("cikey") and so.get("plan"), "save: funding, Account Key, CI Key and plan included")
        pg.close()
        pg = page_new(); pg.goto("file://" + saved); pg.wait_for_timeout(1200)
        check(pg.is_visible("#realBanner"), "saved: red real-data banner")
        check(money_text(round(exp_obl, 2)) in kt(pg, "obl") and "-$" not in kt(pg, "obl") and money_text(abs(bal)) in kt(pg, "bal"), "saved: not flipped twice; same Balance")
        check("Travel (example)" in pg.inner_text("#tDocs") and "Course Supplies" in pg.inner_text("#tFund"), "saved: keys kept")
        pg.close()
        # csv input + all side files in one step
        pg = page_new(); pg.goto("file://" + SINGLE); pg.wait_for_timeout(500)
        pg.set_input_files("#fileInput", [csvp, fundp, keyp]); pg.wait_for_timeout(1500)
        check(money_text(round(e2["obl"], 2)) in kt(pg, "obl") and money_text(FT["tdp"]) in kt(pg, "tdp"), "csv export + funding + key in one Load step")
        pg.close()
        # Power Automate: 5 tables, Excel Online style rows
        t = open(TEMPLATE, encoding="ascii").read()
        def online(rows, headers):
            out = []
            for r in rows:
                o = {"@odata.etag": "", "ItemInternalId": "x"}
                for h, hh in zip(H, headers): v = r[h]; o[hh] = "" if v is None else (str(v) if not isinstance(v, float) or not v.is_integer() else str(int(v)))
                out.append(o)
            return out
        def objs(hs, rows): return [dict({"@odata.etag": ""}, **{h: str(v) for h, v in zip(hs, r)}) for r in rows]
        payload = [{"file": "FundsExport.xlsx", "rows": online(rows1, H)}, {"file": "Second.xlsx", "rows": online(rows2, H2)},
                   {"file": "Funding", "rows": objs(["Fiscal Year", "Account", "TDP", "AFP", "Reservations"], fund_rows)},
                   {"file": "Account Key", "rows": objs(["Functional Area", "Account", "Sag", "MDEP"], key_rows)},
                   {"file": "Commitment Item Key", "rows": objs(["Commitment Item", "Description"], [[c, dd] for c, dd in CIDESC.items()])},
                   {"file": "Spend plan", "rows": objs(["Fiscal Year", "Account", "Fiscal Month", "Planned Amount"], plan_rows)}]
        filled = t.replace("__PA_REFRESHED__", "02-Nov-26 0600").replace("__PA_DATA__", json.dumps(payload).replace("</", "<\\/")) + "\n<div>appended by SharePoint</div>"
        pa = os.path.join(tmp, "Funds_Dashboard.html"); open(pa, "w").write(filled)
        pg = page_new(); pg.goto("file://" + pa); pg.wait_for_timeout(1500)
        check(pg.is_visible("#realBanner") and "02-Nov-26 0600" in pg.inner_text("#realBanner"), "PA: banner with refresh time")
        check(money_text(round(exp_obl, 2)) in kt(pg, "obl") and money_text(abs(bal)) in kt(pg, "bal"), "PA: export + funding + key joined, Balance matches")
        check("Travel (example)" in pg.inner_text("#tDocs"), "PA: Commitment Item Key applied")
        pg.select_option("#tFy", "2026"); pg.wait_for_timeout(300)
        check(all(close(x, y) for x, y in zip(ds(pg).get("Spend plan", []), plan_cum(2026))), "PA: spend plan drawn")
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
