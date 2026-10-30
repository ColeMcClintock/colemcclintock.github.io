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
H = ["fund", "contract_doc_no", "commitment_item_fipex", "functional_area_farea", "appropriation_type", "fiscal_year", "ssn",
     "obligation_amt_cum", "commitment_amt_cum", "vendor_city", "sag", "mdep"] + [f"extra_col_{i}" for i in range(60)]
def make(n, seed):
    r = random.Random(seed); rows = []; exp = {"obl": 0.0, "com": 0.0, "kept": 0, "allobj": 0, "docs": set()}
    for i in range(n):
        allobj = r.random() < 0.08
        ci = r.choice(["ALLOBJ", " allobj", "Allobj "]) if allobj else r.choice(["21T100", "26FF00", "252G00", "31EQ00"])
        obl, com = round(r.uniform(-500, 90000), 2), round(r.uniform(0, 120000), 2)
        doc = f"00{r.randrange(10**7, 10**8)}"
        style = i % 5
        so = {0: obl, 1: f"${obl:,.2f}", 2: (f"({abs(obl):,.2f})" if obl < 0 else f"{obl:,.2f}"), 3: (f"{abs(obl):,.2f}-" if obl < 0 else str(obl)), 4: obl}[style]
        sc = "#REF!" if i % 37 == 0 else com
        if i % 37 == 0: com_v = 0.0
        else: com_v = com
        row = {"fund": "2065", "contract_doc_no": doc, "commitment_item_fipex": ci, "functional_area_farea": f"121011{i%4}000",
               "appropriation_type": r.choice(["OMNG", "NGPA"]), "fiscal_year": r.choice([2025, 2026]), "ssn": SSN,
               "obligation_amt_cum": so, "commitment_amt_cum": sc, "vendor_city": "Anytown", "sag": r.choice(["111", "121", "131"]), "mdep": r.choice(["QDPC", "TATM"])}
        for k in range(60): row[f"extra_col_{k}"] = f"x{k}"
        rows.append(row)
        if allobj: exp["allobj"] += 1
        else: exp["obl"] += obl; exp["com"] += com_v; exp["kept"] += 1; exp["docs"].add(doc)
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
       "ssn": "SSN", "fiscal_year": "Fiscal_x0020_Year"}.get(h, h) for h in H]
f2 = os.path.join(tmp, "export_2.xlsx"); write(f2, rows2, H2)
f1copy = os.path.join(tmp, "export_fy (copy).xlsx"); write(f1copy, rows1, H)
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
        check("$" + money_text(D["obligation"]) in kp and "$" + money_text(D["commitments"]) in kp, "demo: KPI totals match the generator")
        check(str(D["documents"]) in kp and f"{D['kept']:,}" in kp, "demo: line and document counts")
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
        exp_obl, exp_com = e1["obl"] + e2["obl"], e1["com"] + e2["com"]
        kp = pg.inner_text("#kpis"); body = pg.inner_text("body"); html = pg.content()
        check("$" + money_text(round(exp_obl, 2)) in kp, f"files: obligation total {exp_obl:,.2f}")
        check("$" + money_text(round(exp_com, 2)) in kp, f"files: commitments total {exp_com:,.2f} (#REF! = blank) " + kp.replace("\n", " "))
        check(f"{e1['kept'] + e2['kept']:,}" in kp, "files: line count")
        check(f"{e1['allobj'] + e2['allobj']} ALLOBJ lines removed" in body, "files: ALLOBJ count in load bar")
        rep = pg.inner_text("#loadReport")
        check("Same content as export_fy.xlsx" in rep, "files: duplicate file skipped")
        check("9 of 9 columns matched" in rep, "files: _xHHHH_ / case-insensitive headers matched")
        check(SSN not in html and SSN not in body, "files: ssn values never in the DOM")
        check(not re.search(r"\bssn\b", body, re.I), "files: no ssn column name in visible text")
        check("Nothing is uploaded" in pg.inner_text("#dataDisclaimer"), "files: footer switched")
        check("ALLOBJ" not in pg.inner_text("#tDocs") and "allobj" not in pg.inner_text("#tDocs").lower(), "files: no ALLOBJ rows in table")
        check(not pg.is_disabled("#btnSave"), "files: Save enabled")
        # CSV export
        with pg.expect_download() as dl: pg.click("#btnCsv")
        csvt = open(dl.value.path(), encoding="utf-8").read()
        check(csvt.splitlines()[0] == "Document Number,Commitment Item,Functional Area,Appropriation,Fiscal Year,Obligation,Commitments,Sag,MDEP", "csv: renamed header row")
        check(len(csvt.strip().splitlines()) == e1["kept"] + e2["kept"] + 1 and SSN not in csvt and "ALLOBJ" not in csvt.upper(), "csv: all filtered lines, no ssn/ALLOBJ")
        # save with data
        with pg.expect_download() as dl: pg.click("#btnSave")
        d = dl.value; saved = os.path.join(tmp, d.suggested_filename); d.save_as(saved)
        st = open(saved, encoding="utf-8").read()
        check(re.match(r"FUNDS-REAL-DATA-\d{2}[A-Z][a-z]{2}\d{2}\.html$", d.suggested_filename) is not None, "save: filename " + d.suggested_filename)
        snap = st.split('<script id="financeSaved" type="application/json">')[-1].split("</script>")[0]
        check(SSN not in st, "save: no ssn value anywhere in the saved file")
        so = json.loads(snap)
        check(so["headers"] == ["Document Number", "Commitment Item", "Functional Area", "Appropriation", "Fiscal Year", "Obligation", "Commitments", "Sag", "MDEP"]
              and all(str(r[1]).strip().upper() != "ALLOBJ" for r in so["rows"]) and len(so["rows"]) == e1["kept"] + e2["kept"], "save: snapshot = 9 renamed columns only, no ALLOBJ lines")
        pg.close()
        pg = page_new(); pg.goto("file://" + saved); pg.wait_for_timeout(1000)
        check(pg.is_visible("#realBanner"), "saved: red real-data banner")
        check("$" + money_text(round(exp_obl, 2)) in pg.inner_text("#kpis"), "saved: same totals")
        check(f"{e1['allobj'] + e2['allobj']} ALLOBJ lines removed" in pg.inner_text("body"), "saved: ALLOBJ count kept")
        pg.close()
        # csv input
        pg = page_new(); pg.goto("file://" + SINGLE); pg.wait_for_timeout(500)
        pg.set_input_files("#fileInput", [csvp]); pg.wait_for_timeout(1200)
        check("$" + money_text(round(e2["obl"], 2)) in pg.inner_text("#kpis"), "csv input: obligation total")
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
        payload = [{"file": "FundsExport.xlsx", "rows": online(rows1, [h.replace("_", "_x005f_") if h == "sag" else h for h in H])}, {"file": "Second.xlsx", "rows": online(rows2, H2)}]
        filled = t.replace("__PA_REFRESHED__", "30-Oct-26 0600").replace("__PA_DATA__", json.dumps(payload).replace("</", "<\\/")) + "\n<div>appended by SharePoint</div>"
        pa = os.path.join(tmp, "Funds_Dashboard.html"); open(pa, "w").write(filled)
        pg = page_new(); pg.goto("file://" + pa); pg.wait_for_timeout(1500)
        check(pg.is_visible("#realBanner") and "30-Oct-26 0600" in pg.inner_text("#realBanner"), "PA: banner with refresh time")
        check("$" + money_text(round(exp_obl, 2)) in pg.inner_text("#kpis"), "PA: totals match")
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
