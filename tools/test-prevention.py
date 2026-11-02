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
ws.append(["TY", "Grade", "Last", "First", "DTG of Incident", "Location", "Duty Stays", "Age", "Gender", "Unit", "SSN", "DoD ID", "DOB", "person_id", "Status", "Incident_x0020_Type", "Referred", "Completed", "Repeat Incident", "Notes", "Marital Status"])
DTGS = ["02OCT25", "03 OCT 25", "04OCT2025", dt.datetime(2025, 10, 5), "10/6/2025", "07-Oct-25",   # date only, like Cole's tracker
        "08 OCT 2025", "09OCT25", dt.date(2025, 10, 10), "11OCT25", "12oct25", "13OCT25"]
rows = []
for i in range(12):
    rows.append([2025, ["SPC", "E4", "PFC", "SGT"][i % 4], "Zzmarkername", "Zzmarkername", DTGS[i], "Camp Dodge Armory" if i < 9 else "Testville", "Off Duty", 20 + i % 5, "M" if i % 4 else "F", "Test Co" if i < 9 else "Tiny Co",
                 "999-00-4321", "1234567890", dt.date(1999, 1, 2), "T-%03d" % (i % 9), ["TS", "AGR", "Tech"][i % 3], "dui" if i % 2 else "Public Intox", "Y", "N" if i % 3 else "Y", "N", "#REF!", "Married" if i % 2 else "Single"])
for r in rows: ws.append(r)
ws.cell(row=5, column=20).value = "#REF!"
testx = os.path.join(tmp, "test-incidents.xlsx"); wb.save(testx)
# a second small file whose DTGs DO carry times: the time-of-day views must appear
wb2 = openpyxl.Workbook(); w2 = wb2.active; w2.append(["TY", "Grade", "DTG of Incident", "Location", "Duty Status", "Age", "Gender", "Unit"])
for i in range(12): w2.append([2025, "E-4", ["%02d1430ZOCT25", "%02d1415Z OCT 25", "%02d2300OCT2025", "10/%d/2025 21:30"][i % 4] % (i + 1), "Testville", "Off Duty", 22, "M", "Time Co"])
timex = os.path.join(tmp, "test-times.xlsx"); wb2.save(timex)

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
        check(not any("marital" in str(h).lower() for h in th + dh), "no Marital Status column in the template or demo workbook")
        pg = page_new(); pg.goto("file://" + SINGLE); pg.wait_for_timeout(1500)
        # DTG parsing + header mapping
        P = lambda v: pg.evaluate("v => window.PreventionDash.parseWhen(v)", v)
        for v, d, h, mi in [("021430ZNOV26", "2026-11-02", 14, 30), ("021430Z NOV 26", "2026-11-02", 14, 30), ("021430NOV2026", "2026-11-02", 14, 30), ("021430z nov 26", "2026-11-02", 14, 30),
                            ("312359ROCT25", "2025-10-31", 23, 59), (46328.6041667, "2026-11-02", 14, 30), ("11/2/2026 14:30", "2026-11-02", 14, 30), ("11/2/2026 2:30 PM", "2026-11-02", 14, 30),
                            ("2026-11-02T14:30", "2026-11-02", 14, 30)]:
            r = P(v); check(bool(r) and r["date"] == d and r["h"] == h and r["mi"] == mi, f"DTG/date parse {v!r} -> {d} {h:02d}{mi:02d} (got {r})")
        for v in ["02NOV26", "02 NOV 26", "02NOV2026", "2NOV26", "02-Nov-26", "02nov26", 46328, 46328.0, "11/2/2026", "2026-11-02", "46328"]:
            r = P(v); check(bool(r) and r["date"] == "2026-11-02" and r["h"] is None, f"date-only DTG {v!r} -> 2026-11-02, no hour (got {r})")
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
        check(pg.is_visible("#cmdSummary") and not pg.is_visible("#kpis") and not pg.is_visible("#tDetail") and not pg.is_visible("#filters") and pg.is_visible("#mapPanel"), "print summary (with map) shows only the commander summary")
        pg.evaluate("document.body.classList.remove('print-cs')"); pg.emulate_media(media="screen")
        check(pg.locator("#corrList > li").count() >= 3 and "V = " in pg.inner_text("#corrList") and pg.locator("#tCorr td").count() > 100, "correlation matrix + ranked plain-English list")
        check(not pg.is_visible("#fTod") and not pg.is_visible("#tHeatDH"), "date-only data: Time of day filter and day x time heat map hidden")
        foc = pg.inner_text("#focus")
        check("1800" not in cs and "0259" not in cs and "Peak hours" not in foc and "0000" not in pg.inner_text("main"), "date-only data: no hour text or midnight artifacts")
        check("Weekend vs weekday" in cs and "weekday daily rate" in cs, "commander summary has the weekend vs weekday line")
        check("Weekends:" in foc, "weekend recommendation replaces peak hours")
        check("Holiday" in pg.inner_text("#weak") + cs and "drill" in cs.lower() and "payday" in cs.lower(), "holiday, payday and drill analysis kept")
        mt = pg.inner_text("main").lower()
        check("marital" not in mt and "married" not in mt and pg.locator("#fMarital").count() == 0 and pg.locator("#tHeatGM, #cMarital").count() == 0, "no marital status anywhere on the page")
        # incident map
        nloc = pg.evaluate("new Set(window.PREV_DEMO.rows.map(r => r[window.PREV_DEMO.headers.indexOf('Location')])).size")
        dots = pg.locator("#incMap .m-dot")
        check(dots.count() == nloc and pg.locator("#incMap path.m-state").count() == 1 and pg.locator("#incMap path.m-county").count() == 1, f"map: Iowa outline + counties + one bubble per location ({dots.count()}/{nloc})")
        info = pg.evaluate("""[...document.querySelectorAll('#incMap .m-dot')].map(g => ({ n: +g.dataset.n, r: +g.querySelector('circle').getAttribute('r'), c: g.querySelector('circle').style.fill, loc: g.dataset.loc }))""")
        top = max(info, key=lambda d: d["n"]); low = min(info, key=lambda d: d["n"])
        check(top["r"] == max(d["r"] for d in info) and top["c"] == "rgb(153, 0, 13)" and low["r"] < top["r"], f"map: biggest + deepest red bubble = most incidents ({top['loc']} {top['n']})")
        check(abs(top["r"] / [d for d in info if d["n"] >= 5 and d["r"] > 5][-1]["r"] - (top["n"] / [d for d in info if d["n"] >= 5 and d["r"] > 5][-1]["n"]) ** .5) < 0.05, "map: radius scales with sqrt(count)")
        check(sum(d["n"] for d in info) == E["incidents"] and "placed" in pg.inner_text("#mapNote") and pg.inner_text("#mapLegend").strip() != "", "map: counts add up; legend shown")
        dots.filter(has=pg.locator("title", has_text=top["loc"])).first.hover(); pg.wait_for_timeout(150)
        check(pg.is_visible("#mapTip") and top["loc"] in pg.inner_text("#mapTip") and str(top["n"]) in pg.inner_text("#mapTip"), "map: hover shows location + count")
        pg.locator(f'#incMap .m-dot[data-loc="{top["loc"]}"]').click(); pg.wait_for_timeout(400)
        check(pg.input_value("#fLoc") == top["loc"] and f"{top['n']:,}" in pg.inner_text("#kpis .kpi.inc"), "map: click a bubble filters to that location")
        pg.click("#btnReset"); pg.wait_for_timeout(300)
        pg.select_option("#fFy", "FY26"); pg.wait_for_timeout(400)
        s26 = pg.evaluate("[...document.querySelectorAll('#incMap .m-dot')].reduce((a, g) => a + (+g.dataset.n || 0), 0)")
        check(s26 == E["fy26"], f"map respects filters (FY26 total {s26})")
        pg.select_option("#fGrade", "E-6"); pg.wait_for_timeout(400)
        smallDots = pg.locator("#incMap .m-dot").evaluate_all("gs => gs.filter(g => +g.dataset.n < 5).length")
        check(smallDots > 0 and pg.locator("#incMap .m-dot.small").count() == 0, "toggle off (default): real counts under 5 on the map")
        pg.check("#hideSmall"); pg.wait_for_timeout(400)
        sm = pg.locator("#incMap .m-dot.small")
        check(sm.count() > 0 and sm.evaluate_all("gs => gs.every(g => g.dataset.n === '<5' && parseFloat(g.querySelector('circle').getAttribute('r')) === 4)") and "<5" in pg.inner_text("#mapLegend"), "toggle on: small locations = uniform neutral <5 dot, legend explains")
        pg.uncheck("#hideSmall"); pg.click("#btnReset"); pg.wait_for_timeout(300)
        for v, k in [("Camp Dodge", "Johnston"), ("Camp Dodge, Johnston", "Johnston"), ("Sioux City Air Base", "Sioux City"), ("185th ARW", "Sioux City"), ("Des Moines Air Base", "Des Moines"),
                     ("Iowa City Readiness Center", "Iowa City"), ("Waterloo Armory", "Waterloo"), ("MUSCATINE, IA", "Muscatine"), ("Ft. Dodge RC", "Fort Dodge"), ("Mt Pleasant", "Mount Pleasant"),
                     ("Iowa Falls", "Iowa Falls"), ("IAARNG Johnston", "Johnston"), ("Testville", None)]:
            got = pg.evaluate("v => window.PreventionDash.placeOf(v)", v); check(got == k, f"place lookup {v!r} -> {k} (got {got})")
        for t in ["tHeat", "tHeatDM", "tHeatUD"]:
            check(pg.locator(f"#{t} td.hot").count() > 0, f"heat map {t} rendered with clickable cells")
        check("<5" not in pg.inner_text("#tHeatUD"), "toggle off (default): heat maps show real counts")
        pg.check("#hideSmall"); pg.wait_for_timeout(400)
        check("<5" in pg.inner_text("#tHeatUD"), "toggle on: heat map cells under 5 show <5")
        pg.uncheck("#hideSmall"); pg.wait_for_timeout(300)
        check("statistical stability" in pg.inner_text("#wsNote"), "note: rankings need 5+ incidents for stability")
        cell = pg.locator("#tHeatDM td.hot").first; cell.click(); pg.wait_for_timeout(400)
        check(pg.input_value("#fDow") != "" and pg.input_value("#fFm") != "", f"heat-map click filters day + fiscal month ({pg.input_value('#fDow')} {pg.input_value('#fFm')})")
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
            check("Fewer than 5" in pg.inner_text("#weak"), "small selection: nothing ranked under 5")
        pg.click("#btnReset"); pg.wait_for_timeout(200)
        # GenAI pack
        pg.click("#btnGenAI"); pg.wait_for_timeout(500)
        clip = pg.evaluate("navigator.clipboard.readText()")
        check("commander" in clip and "AGGREGATED DATA" in clip and "Incidents by fiscal month" in clip and "hot spots" in clip.lower(), "GenAI pack copied with prompt + aggregates")
        check(not re.search(r"\d{6}\s?[A-Z]?\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)", clip) and "Strongest associations" in clip and "day of week x fiscal month" in clip and "time of day" not in clip and "1800" not in clip and "Weekend vs weekday" in clip, "GenAI pack: no DTGs or hours; has day x month, weekend line + associations")
        check(not re.search(r"P-\d{4}", clip) and not re.search(r"\d{4}-\d{2}-\d{2}", clip) and not re.search(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", clip), "GenAI pack has no IDs or exact dates")
        check(not re.search(r"(?<![-\w.])[1-4] \(", clip) and ": 1 " not in clip, "GenAI pack: no counts under 5 shown")
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
        check(pg.evaluate("window.PreventionDash.state.base.length") == 9 and pg.evaluate("window.PreventionDash.state.base.every(r => r.hour == null)") and pg.evaluate("window.PreventionDash.state.base.every(r => r.fy === 'FY26' && String(r.ty) === '2025' && r.duty === 'Off Duty')"), "test file: date-only DTGs, TY, FY26 and 'Duty Stays' column read")
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
        check(pg.inner_text("#kpis .kpi.inc").split("\n")[1].strip() == "3", "toggle off: unit with 3 incidents shows 3")
        pg.check("#hideSmall"); pg.wait_for_timeout(300)
        check("<5" in pg.inner_text("#kpis .kpi.inc"), "toggle on: unit with 3 incidents shows <5")
        pg.click("#btnGenAI"); pg.wait_for_timeout(300); pg.uncheck("#hideSmall"); pg.wait_for_timeout(300)
        pg.click("#btnGenAI"); pg.wait_for_timeout(400); clip3 = pg.evaluate("navigator.clipboard.readText()")
        check("<5" in clip3 and not re.search(r"Tiny Co[^\n]*\b3\b", clip3), "GenAI pack suppresses under 5 even with the toggle off")
        check("Testville (3)" in pg.inner_text("#mapMiss") or "Not placed: Testville" in pg.inner_text("#mapMiss"), "unmatched location listed under the map")
        check("marital" not in clip3.lower(), "GenAI pack has no marital text")
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
        pg.set_input_files("#fileInput", [timex]); pg.wait_for_timeout(1500)
        check(pg.is_visible("#fTod") and pg.is_visible("#tHeatDH"), "DTGs with times: Time of day filter and day x time heat map appear")
        check(pg.evaluate("window.PreventionDash.state.recs.filter(r => r.hour != null).length") == 12, "DTGs with times: hours read")
        check(not net, "no network requests " + str(net[:3]))
        check(not errors, "no console errors " + str(errors[:3]))
        b.close()

run()
print("\n" + ("ALL PASSED" if not FAILS else f"{len(FAILS)} FAILED: " + "; ".join(FAILS)))
sys.exit(1 if FAILS else 0)
