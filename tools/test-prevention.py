#!/usr/bin/env python3
"""Offline browser regression checks for the Iowa alcohol-incident prevention dashboard.
Uses fictional markers only; temporary workbook and saved download are written outside the repo.
Run: python3 tools/build-standalone.py && python3 tools/test-prevention.py
"""
import datetime as dt
import os
import re
import sys
import tempfile
import openpyxl
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SINGLE = os.path.join(ROOT, "downloads", "prevention-dashboard.html")
MARKERS = ["Zzmarkername", "999-00-4321", "1234567890", "1999-01-02"]
FAILS = []
def check(ok, label):
    print(("  PASS " if ok else "  FAIL ") + label)
    if not ok: FAILS.append(label)

tmp = tempfile.mkdtemp(prefix="prevention-test-")
headers = ["TY", "ID", "GRADE", "Last", "First", "DTG of Incident", "Location", "Duty status", "Age", "Gender", "Unit of assignment", "PEBD", "DOB", "Mailing address", "Marital status"]
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Fictional"
ws.append(headers)
for i in range(10):
    ws.append([2026, "1234567890", "E-4", "Zzmarkername", "Zzmarkername", "2026-11-%02d" % (i+1), "Camp Dodge", "M-Day - NOT ON DUTY" if i % 2 else "M-Day NOT ON DUTY", 25 if i < 8 else None, "M", "Alpha Co, 1-113 CAV" if i < 8 else "Bravo Co, 2-168 INF", "2020-11-01", "1999-01-02", "123 Main St, Des Moines, IA 50309", "Married" if i % 2 else "Single"])
TESTX = os.path.join(tmp, "fictional-test.xlsx"); wb.save(TESTX)

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/chromium"), args=["--no-sandbox"])
        ctx = browser.new_context(accept_downloads=True, viewport={"width": 390, "height": 844})
        errors, requests = [], []
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("request", lambda r: requests.append(r.url) if not r.url.startswith(("file:", "data:", "blob:")) else None)
        page.goto("file://" + SINGLE); page.wait_for_timeout(900)
        check(not errors, "fictional demo starts without JavaScript errors")
        check("fictional" in page.inner_text("#dataDisclaimer").lower(), "demo clearly marked fictional")
        demo = page.evaluate("window.PREV_DEMO")
        check(demo["headers"][:14] == ["TY", "ID", "GRADE", "Last", "First", "DTG of Incident", "Location", "Duty status", "Age", "Gender", "Unit of assignment", "PEBD", "Mailing address", "Marital status"], "demo workbook schema matches requested fields")
        check(page.locator("#incMap .m-dot").count() > 0 and page.locator("#homeMap .m-dot").count() > 0, "incident and home-of-record maps render separately")
        check(page.evaluate("[...document.querySelectorAll('#incMap .m-dot')].every(g => g.dataset.n !== '<5')"), "small location counts remain visible as bubbles by default")
        check(page.locator("#cBenchmark").count() == 1 and page.locator("#benchmarkSummary").inner_text().count("4.25") >= 1 and "no age or sex adjustment" in page.inner_text("#benchmarkPanel") and "13,786" in page.inner_text("#benchmarkPanel"), "DOT estimate shown with explicit non-adjusted caveat")
        check(page.locator("#fHomeTown").count() == 1 and page.locator("#cMarital").count() == 1, "home-town filter and marital-status chart available")
        api = page.evaluate("({d:PreventionDash.normalizeDuty('M-Day NOT ON DUTY'), town:PreventionDash.townOnly('123 Main St, Des Moines, IA 50309'), skip:PreventionDash.mapHeader('ID')})")
        check(api == {"d":"M-Day - NOT ON DUTY", "town":"Des Moines", "skip":"SKIP"}, "duty variants merge; town extraction removes address; ID header is skipped")
        page.set_input_files("#fileInput", TESTX); page.wait_for_timeout(900)
        st = page.evaluate("window.PreventionDash.state")
        check(len(st["recs"]) == 10, "fictional test workbook loads")
        check(all(r["duty"] == "M-Day - NOT ON DUTY" for r in st["recs"]), "hyphenated and unhyphenated not-on-duty values normalize together")
        check(all(r["unit"] in ["Alpha Co", "Bravo Co"] and r["unitBroad"] == ("1-113 CAV" if r["unit"] == "Alpha Co" else "2-168 INF") for r in st["recs"]), "company and broad unit split from assignment")
        check(all(r["homeTown"] == "Des Moines" for r in st["recs"]), "only home town is retained from mailing address")
        check(st["recs"][8]["age"] == 27 and all(r["tis"] == 6 for r in st["recs"]), "DOB fallback derives age; PEBD yields whole service years")
        page.check("#showRows"); page.wait_for_timeout(150)
        html = page.content()
        check(not any(x in html for x in MARKERS), "name, ID, SSN, DoD ID and DOB markers never appear in dashboard")
        with page.expect_download() as d: page.click("#btnCsv")
        csv = open(d.value.path(), encoding="utf-8").read()
        check(not any(x in csv for x in MARKERS) and "Mailing address" not in csv and "DOB" not in csv, "CSV export contains no identifiers, DOB, or street address")
        page.locator("#lowerTools").evaluate("e => e.open = true")
        with page.expect_download() as saved_dl: page.click("#btnSave")
        saved_html = open(saved_dl.value.path(), encoding="utf-8").read()
        check(not any(x in saved_html for x in MARKERS) and "123 Main St" not in saved_html and "1999-01-02" not in saved_html and "Des Moines" in saved_html, "saved offline snapshot keeps town only, omits PII and DOB")
        home_count = page.locator("#homeMap .m-dot").count()
        check(home_count >= 1, "home-of-record map updates from loaded data")
        page.locator("#homeMap .m-dot").first.hover(); page.wait_for_timeout(100)
        check(page.is_visible("#homeMapTip"), "home-map hover tooltip stays with the home map")
        page.fill('#unitRates input[data-strength="1-113 CAV"]', "40")
        page.locator('#unitRates input[data-strength="1-113 CAV"]').dispatch_event("change")
        page.fill('#unitRates input[data-strength="2-168 INF"]', "100")
        page.locator('#unitRates input[data-strength="2-168 INF"]').dispatch_event("change"); page.wait_for_timeout(250)
        check("At least 1.5× overall" in page.inner_text("#unitRates"), "units at 1.5x or more of entered-strength average are flagged")
        check(not requests, "no external network requests")
        check(not errors, "no console or page errors " + str(errors[:5]))
        browser.close()

run()
print("\n" + ("ALL PASSED" if not FAILS else f"{len(FAILS)} FAILED: " + "; ".join(FAILS)))
sys.exit(1 if FAILS else 0)
