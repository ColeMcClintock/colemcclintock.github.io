#!/usr/bin/env python3
"""Headless-Chrome checks for the Incident Trends & Prevention dashboard with FICTIONAL data (writes only to a temp folder).
Checks: demo loads with no console errors and zero network requests; filters and click-to-filter; loading the demo xlsx
plus a test file whose Name / SSN / DoD ID / DOB columns hold fictional marker values (they must never reach the page,
the CSV export, the GenAI pack or the saved file); headcount file and typed headcounts give rates per 1,000;
small cells show <5; the GenAI pack is aggregated only; Save with data writes a REAL-DATA snapshot with the red banner.
Run from the repo root after tools/build-standalone.py:  python3 tools/test-prevention.py   (needs openpyxl + playwright)"""
import datetime as dt, json, os, re, sys, tempfile
import openpyxl
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SINGLE = os.path.join(ROOT, "downloads", "prevention-dashboard.html")
DIR = os.path.join(ROOT, "dashboards", "prevention")
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
SHOT = os.environ.get("SHOT", "")
MARKERS = ["Zzmarkername", "999-00-4321", "1234567890", "1999-01-02"]   # fictional; must never appear
FAILS = []
def check(ok, label):
    print(("  PASS " if ok else "  FAIL ") + label)
    if not ok: FAILS.append(label)

tmp = tempfile.mkdtemp(prefix="prev-test-")
# a test incident file in Cole's column layout: title rows above the header, Last / First / SSN / DoD ID / DOB with marker values,
# 'Duty Stays' typo, an Excel-escaped header, a #REF! cell, DTGs in several military formats plus Excel date-times and text dates
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Export"
ws.append(["Incident report (fictional)"]); ws.append([])
ws.append(["TY", "Grade", "Last", "First", "DTG of Incident", "Location", "Duty Stays", "Age", "Gender", "Unit", "SSN", "DoD ID", "DOB", "person_id", "Status", "Incident_x0020_Type", "Referred", "Completed", "Repeat Incident", "Notes"])
DTGS = ["021430ZOCT25", "031415Z OCT 25", "042300OCT2025", dt.datetime(2025, 10, 5, 22, 15), "10/6/2025 21:30", "071930ZOCT25",
        "082245Z OCT 2025", "092100ZOCT25", dt.datetime(2025, 10, 10, 23, 0), "111800ZOCT25", "120130ZOCT25", "130200ZOCT25"]
rows = []
for i in range(12):
    rows.append([2025, ["SPC", "E4", "PFC", "SGT"][i % 4], "Zzmarkername", "Zzmarkername", DTGS[i], "Testville", "Off Duty", 20 + i % 5, "M" if i % 4 else "F", "Test Co" if i < 9 else "Tiny Co",
                 "999-00-4321", "1234567890", dt.date(1999, 1, 2), "T-%03d" % (i % 9), ["TS", "AGR", "Tech"][i % 3], "dui" if i % 2 else "Public Intox", "Y", "N" if i % 3 else "Y", "N", "#REF!"])
for r in rows: ws.append(r)
ws.cell(row=5, column=20).value = "#REF!"
testx = os.path.join(tmp, "test-incidents.xlsx"); wb.save(testx)

def run():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        errors, net = [], []
        def page_new():
            pg = ctx.new_page()
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("request", lambda r: net.append(r.url) if not r.url.startswith(("file:", "data:", "blob:")) else None)
            return pg
        # template + demo workbook headers follow Cole's layout
        COLE = ["TY", "Grade", "Last", "First", "DTG of Incident", "Location", "Duty Status", "Age", "Gender", "Unit"]
        th = [c.value for c in next(openpyxl.load_workbook(os.path.join(ROOT, "downloads", "prevention-template.xlsx")).worksheets[0].iter_rows(max_row=1))]
        check(th[:8] == [c for c in COLE if c not in ("Last", "First")] and "Last" not in th and "First" not in th, "template core columns = Cole's columns minus Last/First: " + ", ".join(th[:8]))
        dh = [c.value for c in next(openpyxl.load_workbook(os.path.join(ROOT, "downloads", "prevention-demo-data.xlsx")).worksheets[0].iter_rows(max_row=1))]
        check(dh[:10] == COLE, "demo workbook uses Cole's headers")
        pg = page_new(); pg.goto("file://" + SINGLE); pg.wait_for_timeout(1500)
        # DTG parsing + header mapping
        P = lambda v: pg.evaluate("v => window.PreventionDash.parseWhen(v)", v)
        for v, d, h, mi in [("021430ZNOV26", "2026-11-02", 14, 30), ("021430Z NOV 26", "2026-11-02", 14, 30), ("021430NOV2026", "2026-11-02", 14, 30), ("021430z nov 26", "2026-11-02", 14, 30),
                            ("312359ROCT25", "2025-10-31", 23, 59), (46328.6041667, "2026-11-02", 14, 30), ("11/2/2026 14:30", "2026-11-02", 14, 30), ("11/2/2026 2:30 PM", "2026-11-02", 14, 30),
                            ("2026-11-02T14:30", "2026-11-02", 14, 30)]:
            r = P(v); check(bool(r) and r["date"] == d and r["h"] == h and r["mi"] == mi, f"DTG/date parse {v!r} -> {d} {h:02d}{mi:02d} (got {r})")
        r = P("11/2/2026"); check(bool(r) and r["date"] == "2026-11-02" and r["h"] is None, "date without time parses with no hour")
        check(P("not a date") is False and P("") is None, "unreadable DTG flagged, blank ignored")
        M = lambda h: pg.evaluate("h => window.PreventionDash.mapHeader(h)", h)
        for h, k in [("TY", "ty"), ("Grade", "grade"), ("DTG of Incident", "date"), ("DTG", "date"), ("Location", "loc"), ("Duty Status", "duty"), ("Duty Stays", "duty"), ("Age", "age"), ("Gender", "gender"), ("Unit", "unit"), ("Last", "SKIP"), ("First", "SKIP")]:
            check(M(h) == k, f"header {h!r} -> {k} (got {M(h)})")
        E = pg.evaluate("window.PREV_DEMO.expect"); kp = pg.inner_text("#kpis")
        check(f"{E['incidents']:,}" in kp and f"{E['people']:,}" in kp, "demo: total incidents + unique people match the generator")
        check("per 1,000 assigned" in kp, "demo: rate per 1,000 from the demo headcount")
        check("fictional" in pg.inner_text("#dataDisclaimer").lower(), "demo: fictional disclaimer in footer")
        check(pg.locator("#weak li").count() >= 5 and "per 1,000" in pg.inner_text("#weak"), "demo: weak spots ranked by rate")
        check(pg.locator("#focus li").count() >= 4, "demo: recommendation items")
        check("Automated recommendations (generated on this device)" in pg.inner_text("main"), "recommendations panel renamed")
        check(pg.locator("#focus li").count() == pg.locator("#focus li .why", has_text="Evidence:").count(), "every recommendation shows its evidence")
        cs = pg.inner_text("#cmdSummary")
        check(pg.locator("#cmdBullets > li").count() >= 4 and "Commander summary" in cs and "Recommended next steps" in cs, "commander summary at top with bullets + next steps")
        check(pg.evaluate("document.getElementById('cmdSummary').getBoundingClientRect().top < document.getElementById('kpis').getBoundingClientRect().top"), "commander summary above the KPIs")
        pg.emulate_media(media="print"); pg.evaluate("document.body.classList.add('print-cs')")
        check(pg.is_visible("#cmdSummary") and not pg.is_visible("#kpis") and not pg.is_visible("#tDetail") and not pg.is_visible("#filters"), "print summary shows only the commander summary")
        pg.evaluate("document.body.classList.remove('print-cs')"); pg.emulate_media(media="screen")
        check(pg.locator("#corrList > li").count() >= 3 and "V = " in pg.inner_text("#corrList") and pg.locator("#tCorr td").count() > 100, "correlation matrix + ranked plain-English list")
        for t in ["tHeat", "tHeatDH", "tHeatLM", "tHeatUD", "tHeatGM"]:
            check(pg.locator(f"#{t} td.hot").count() > 0, f"heat map {t} rendered with clickable cells")
        check("<5" in pg.inner_text("#tHeatLM"), "heat map suppresses cells under 5")
        cell = pg.locator("#tHeatDH td.hot").first; cell.click(); pg.wait_for_timeout(400)
        check(pg.input_value("#fDow") != "" and pg.input_value("#fTod") != "", f"heat-map click filters day + time ({pg.input_value('#fDow')} {pg.input_value('#fTod')})")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        cell = pg.locator("#tHeatUD td.hot").first; cell.click(); pg.wait_for_timeout(400)
        check(pg.input_value("#fUnit") != "" and pg.input_value("#fDuty") != "", "heat-map click filters unit + duty status")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        check(not pg.is_checked("#showRows") and not pg.is_visible("#tDetail") and pg.is_visible("#rowsNote") and pg.locator("#tDetail tbody tr").count() == 0, "detail rows hidden by default (commander view) with a note")
        fil = pg.locator("#filters"); check(pg.evaluate("getComputedStyle(document.getElementById('filters')).position") == "static", "filters are not sticky")
        # filters
        pg.select_option("#fFy", "FY26"); pg.wait_for_timeout(400)
        n26 = E["fy26"]
        check(f"{n26:,}" in pg.inner_text("#kpis .kpi.inc"), f"filter FY26 -> {n26} incidents")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        # click a bar on the pay grade chart
        box = pg.locator("#cGrade").bounding_box()
        pg.evaluate("""() => { const c = Chart.getChart('cGrade'); const m = c.getDatasetMeta(0); const i = c.data.labels.indexOf('E-4'); const el = m.data[i];
            c.options.onClick({ native: { target: c.canvas } }, [{ index: i, datasetIndex: 0, element: el }]); }""")
        pg.wait_for_timeout(300)
        check(pg.input_value("#fGrade") == "E-4", "click a bar filters (pay grade E-4)")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        # small cells
        pg.select_option("#fGrade", "E-9") if "E-9" in pg.inner_text("#fGrade") else None
        pg.wait_for_timeout(300)
        if pg.input_value("#fGrade") == "E-9":
            check("<5" in pg.inner_text("#kpis") or "Fewer than 5" in pg.inner_text("#weak"), "small selection shows <5 / suppressed")
        pg.click("#btnReset"); pg.wait_for_timeout(200)
        # GenAI pack
        pg.click("#btnGenAI"); pg.wait_for_timeout(500)
        clip = pg.evaluate("navigator.clipboard.readText()")
        check("commander" in clip and "AGGREGATED DATA" in clip and "Incidents by fiscal month" in clip and "hot spots" in clip.lower(), "GenAI pack copied with prompt + aggregates")
        check(not re.search(r"\d{6}\s?[A-Z]?\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)", clip) and "Strongest associations" in clip and "day of week x time of day" in clip, "GenAI pack: no DTGs; has day x time + associations")
        check(not re.search(r"P-\d{4}", clip) and not re.search(r"\d{4}-\d{2}-\d{2}", clip) and not re.search(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", clip), "GenAI pack has no IDs or exact dates")
        check(not re.search(r"\b[1-4] \(", clip) and ": 1 " not in clip, "GenAI pack: no counts under 5 shown")
        with pg.expect_download() as dl: pg.click("#btnGenAITxt")
        check(dl.value.suggested_filename.endswith(".txt"), "GenAI pack .txt download")
        check("agency-approved GenAI tool" in pg.inner_text("#genaiNote"), "on-page GenAI note")
        if SHOT: pg.screenshot(path=SHOT, full_page=True)
        # load the demo xlsx + the PII test file
        pg.set_input_files("#fileInput", [os.path.join(DIR, "prevention_demo.xlsx"), testx]); pg.wait_for_timeout(2500)
        body = pg.inner_text("body"); rep = pg.inner_text("#loadReport")
        check(f"{E['incidents'] + 12:,} incidents" in pg.inner_text("#loadBar"), "file load: demo xlsx + test file combined")
        check("Showing data loaded from your files" in pg.inner_text("#dataDisclaimer"), "footer switches to own-data text")
        for h in ["Last", "First", "SSN", "DoD ID", "DOB"]: check(re.search(r"\b" + h + r"\b", rep), f"load report lists skipped column {h}")
        pg.select_option("#fUnit", "Test Co"); pg.wait_for_timeout(400)
        check(pg.evaluate("window.PreventionDash.state.base.filter(r => r.hour != null).length") == 9 and pg.evaluate("window.PreventionDash.state.base.every(r => r.fy === 'FY26' && String(r.ty) === '2025' && r.duty === 'Off Duty')"), "test file: DTG hours, TY, FY26 and 'Duty Stays' column read")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        html = pg.content()
        check(not any(m in html for m in MARKERS), "no PII marker value anywhere in the page")
        check("Add a headcount" in pg.inner_text("#kpis .kpi.inc"), "no headcount: rate asks for one")
        check("shares" in pg.inner_text("#wsNote"), "no headcount: rankings fall back to shares")
        pg.check("#showRows"); pg.wait_for_timeout(300)
        check(pg.locator("#tDetail tbody tr").count() > 0 and not pg.is_visible("#rowsNote"), "ticking 'Show row-level records' shows the table")
        with pg.expect_download() as dl: pg.click("#btnCsv")
        csvt = open(dl.value.path(), encoding="utf-8").read()
        check(not any(m in csvt for m in MARKERS) and "Person ID" in csvt, "CSV export has no PII markers")
        # typed headcount
        pg.click("#hcPanel summary"); pg.wait_for_timeout(200)
        pg.fill('input[data-hc="unit"][data-a="Test Co"]', "60"); pg.wait_for_timeout(700)
        pg.select_option("#fUnit", "Test Co"); pg.wait_for_timeout(500)
        check("per 1,000 assigned" in pg.inner_text("#kpis .kpi.inc"), "typed headcount gives a rate per 1,000")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        pg.select_option("#fUnit", "Tiny Co"); pg.wait_for_timeout(300)
        check("<5" in pg.inner_text("#kpis .kpi.inc"), "unit with 3 incidents shows <5")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        # headcount file
        pg.set_input_files("#addInput", [os.path.join(DIR, "prevention_roster_demo.xlsx")]); pg.wait_for_timeout(1500)
        check("headcount" in pg.inner_text("#loadBar").lower() and "per 1,000" in pg.inner_text("#weak"), "headcount file auto-detected; rankings use rates")
        # save with data
        with pg.expect_download() as dl: pg.click("#btnSave")
        name = dl.value.suggested_filename; saved = os.path.join(tmp, name); dl.value.save_as(saved)
        check(re.match(r"PREVENTION-REAL-DATA-\d{2}[A-Z][a-z]{2}\d{2}\.html$", name) is not None, "saved file name " + name)
        st = open(saved, encoding="utf-8").read()
        check(not any(m in st for m in MARKERS), "saved file has no PII markers")
        pg2 = page_new(); pg2.goto("file://" + saved); pg2.wait_for_timeout(1800)
        check(pg2.is_visible("#realBanner") and "Contains real data" in pg2.inner_text("#realBanner"), "saved file shows the red real-data banner")
        check(f"{E['incidents'] + 12:,}" in pg2.inner_text("#kpis"), "saved file reloads the same incidents")
        check("per 1,000" in pg2.inner_text("#kpis"), "saved file keeps the headcount")
        check(pg2.evaluate("window.PreventionDash.state.hc.unit['Test Co'] && window.PreventionDash.state.hc.unit['Test Co'].t") == "60", "saved file keeps typed headcounts")
        check(not net, "no network requests " + str(net[:3]))
        check(not errors, "no console errors " + str(errors[:3]))
        b.close()

run()
print("\n" + ("ALL PASSED" if not FAILS else f"{len(FAILS)} FAILED: " + "; ".join(FAILS)))
sys.exit(1 if FAILS else 0)
