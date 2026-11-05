#!/usr/bin/env python3
"""Headless-Chrome checks for the Aviation Dashboard with FICTIONAL data (writes only to a temp folder).
Hosted page: demo data loads, PR levels / fuel / funds totals match the generator, screenshots (SHOTS=dir).
Single file (downloads/command-dashboard.html): opens empty; one upload routes a funds export (negative amounts, ALLOBJ,
a filled-in test ssn column), funding file, Account Key, CI Key, PR files L1..L4 (+ a duplicate copy and a file without a level),
and two fuel trackers (budget in B1, header on row 13, text dates, total row) to the right pages. Checks cardholder names,
PR de-dup and value rule, highest-level rule, fuel budget / pace, the details drawer stays closed, no markings on screen,
Save with data (no banner, Data-as-of kept, sign never flipped twice), hash routing, zero network requests, no console errors.
Run from the repo root after tools/build-standalone.py:  python3 tools/test-command.py   (needs openpyxl + playwright)"""
import datetime as dt, json, os, re, sys, tempfile
import openpyxl
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSTED = os.path.join(ROOT, "dashboards", "command", "index.html")
SINGLE = os.path.join(ROOT, "downloads", "command-dashboard.html")
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
SHOTS = os.environ.get("SHOTS", "")
SSN = "999-00-4321"
FAILS = []
def check(ok, label):
    print(("  PASS " if ok else "  FAIL ") + label)
    if not ok: FAILS.append(label)
def money(v): return f"${v:,.2f}"

tmp = tempfile.mkdtemp(prefix="cmd-test-")
def xlsx(path, rows, sheet="Sheet1"):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = sheet
    for r in rows: ws.append(r)
    wb.save(path); return path

# ---- Status of Funds (same schema as the finance dashboard) ----
H = ["fund", "contract_doc_no", "commitment_item_fipex", "functional_area_farea", "appropriation_type", "fiscal_year", "fiscal_month", "ssn",
     "obligation_amt_cum", "commitment_amt_cum", "disbursement_amt_cum", "sag", "mdep"]
ex_rows, OBL, DISB = [], 0.0, 0.0
for i in range(60):
    allobj = i % 10 == 0
    o, d = round(1000 + i * 37.5, 2), round(400 + i * 11.25, 2)
    ex_rows.append(["2065", f"W91ZZZ26P{i:04d}", "ALLOBJ" if allobj else ["21T0", "26FF", "252G"][i % 3], ["121G11ABCD", "131G21TRNG"][i % 2], "OMNG", 2026, (i % 12) + 1, SSN, -o, -o, -d, "ZZ", "ZZZZ"])
    if not allobj: OBL += o; DISB += d
sof_x = xlsx(os.path.join(tmp, "funds export.xlsx"), [["Funds report (fictional)"], [], H] + ex_rows)
TDP, RES = 500000.0, 2500.0
fund_x = xlsx(os.path.join(tmp, "Funding.xlsx"), [["Fiscal Year", "Account", "TDP", "AFP", "Reservations"], ["FY26", "Course Supplies", TDP, 400000.0, RES]])
key_x = xlsx(os.path.join(tmp, "Account Key.xlsx"), [["Functional Area", "Account", "Sag", "MDEP"], ["121G11ABCD", "Course Supplies", "1N", "TATM"], ["131G21TRNG", "Course Supplies", "1N", "TATM"]])
ci_x = xlsx(os.path.join(tmp, "CI Key.xlsx"), [["Commitment Item", "Description"], ["21T0", "Travel"], ["26FF", "Fuel"], ["252G", "Contract Services"]])
BAL = round(TDP - RES - OBL - DISB, 2)

# ---- PR files ----
PRH = ["Purchase requisition", "Item", "Cardholder Name", "Plant", "Merchant / Description", "Short Text", "Qty", "Total Value", "SSN", "Created By"]
def prrow(pr, card, merch, desc, val): return [pr, 10, card, "IA01", merch, desc, 1, val, SSN, "XXXX"]
L1 = [prrow(11111111, "john.q.public.mil@army.mil", "Hawk Supply", "Paper", 100.0), prrow(11111111, "john.q.public.mil@army.mil", "Hawk Supply", "Toner", 50.5),  # summed: 150.50
      prrow(22222222, "MARY.ANN.SMITH-JONES", "Tool Co", "Wrench", 80.0),
      prrow(33333333, "pat.oneil@army.mil", "Parts Inc", "Seal", 300.0),                     # also in L3 -> shown at L3
      [None, None, None, None, None, None, None, 530.5, None, None]]                        # total row
L2 = [prrow("44444444", "jane.doe", "Cater Co", "Meals", 999.99), prrow("44444444", "jane.doe", "Cater Co", "Meals day 2", 999.99), prrow(44444444.0, "jane.doe", "Cater Co", "Water", 999.99),  # repeated total -> 999.99 once
      prrow(55555555, "Smith, Robert A", "Sign Shop", "Signs", 45.0)]
L3 = [prrow(33333333, "pat.oneil@army.mil", "Parts Inc", "Seal", 300.0), prrow(66666666, "o'brien.k.mcdonald", "Lumber", "Plywood", 1200.0)]
L4 = [prrow(77777777, "amy.b.lee", "IT Shop", "Monitor", 400.0)]
L4b = [prrow(77777777, "amy.b.lee", "IT Shop", "Monitor", 400.0), prrow(88888888, "amy.b.lee", "IT Shop", "Dock", 250.0)]
p1 = xlsx(os.path.join(tmp, "L1.xlsx"), [PRH] + L1); p2 = xlsx(os.path.join(tmp, "L2.xlsx"), [PRH] + L2)
p2dup = xlsx(os.path.join(tmp, "L2 (1).xlsx"), [PRH] + L2); p3 = xlsx(os.path.join(tmp, "PR L3 Nov.xlsx"), [["PR export (fictional)"], PRH] + L3)
p4 = xlsx(os.path.join(tmp, "L4.xlsx"), [PRH] + L4); p4b = os.path.join(tmp, "upd"); os.makedirs(p4b); p4b = xlsx(os.path.join(p4b, "L4.xlsx"), [PRH] + L4b)
pnolvl = xlsx(os.path.join(tmp, "PR export.xlsx"), [PRH] + L4)
# Cardholder Key: email style (no domain, with middle) and First Last both match; Display Name used; Type any case; blank Type = Unassigned
ckey = xlsx(os.path.join(tmp, "My Cardholders.xlsx"), [["Cardholder", "Display Name", "Type"], ["john.q.public", "", "WHST"], ["Mary Smith-Jones", "M. Smith-Jones", "Safety"],
                                                       ["jane.doe@army.mil", "", "whst"], ["Amy Lee", "", "SAFETY"], ["Robert Smith", "", ""], ["Zed Zulu", "", "WHST"]], "CardholderKey")
PR_EXP = {1: (2, 150.5 + 80.0), 2: (2, 999.99 + 45.0), 3: (2, 1500.0), 4: (1, 400.0)}

# ---- fuel trackers ----
def tracker(name, budget, rows):
    grid = [["Total Fuel Budget", budget], ["AASF", name]] + [["note", i] for i in range(10)] + [["Date", "Milstrip Number", "Gallons", "Total Cost", "Remarks"]]
    grid += rows + [[], ["TOTAL", None, sum(r[2] for r in rows), sum(r[3] for r in rows)]]
    return xlsx(os.path.join(tmp, name + ".xlsx"), grid, "Tracker")
fy = dt.date.today().year + (1 if dt.date.today().month >= 10 else 0)
d0 = dt.date(fy - 1, 10, 2)
fa_rows = [[d0, "W81A0001", 100.0, 362.0], [d0.strftime("%m/%d/%Y"), "W81A0002", 200.0, 730.0], [d0.strftime("%d%b%y").upper(), "W81A0003", 50.0, 180.0]]
fb_rows = [[d0, "W81B0001", 1000.0, 3600.0]]
fa = tracker("North Field", 12000.0, fa_rows); fb = tracker("South Field", 3000.0, fb_rows)
FA_SPENT, FB_SPENT = 362.0 + 730.0 + 180.0, 3600.0

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
        def go(pg, h): pg.evaluate(f"location.hash = '#/{h}'"); pg.wait_for_timeout(700)

        # ---------- hosted copy: demo data ----------
        pg = page_new(); pg.goto("file://" + HOSTED); pg.wait_for_timeout(1500)
        E = pg.evaluate("window.COMMAND_DEMO.expect"); FD = pg.evaluate("window.FUNDS_DEMO.expect")
        check(pg.is_visible("#tiles") and pg.is_visible("#homeOverview") and pg.is_hidden("#homeEmpty"), "hosted: home with tiles + overview (demo loaded)")
        check(all(t in pg.inner_text("#tiles") for t in ["Status of Funds", "PR Tracker", "Fuel", "Spend Plans", "AFTPs"]), "hosted: five tiles")
        check(pg.locator("#tiles svg").count() == 5, "hosted: tile icons")
        check(pg.is_hidden("#drawer"), "hosted: details drawer closed by default")
        st = pg.evaluate("CMD.mods.pr._state.items.reduce(function(m,i){m[i.level]=m[i.level]||[0,0];m[i.level][0]++;m[i.level][1]+=i.val;return m;},{})")
        check(all(st[str(k)][0] == v["count"] and abs(st[str(k)][1] - v["value"]) < 0.02 for k, v in E["prKey"]["levels"].items()), "hosted: PR count + value per level match the generator (demo cardholder key applied)")
        check(pg.evaluate("CMD.mods.pr._state.cross.length") == len(E["prKey"]["moved"]), "hosted: PRs in two levels flagged")
        check(pg.evaluate("CMD.mods.pr._state.items.filter(function(i){return i.repeated}).length") == E["prKey"]["repeat"], "hosted: repeated-total PRs counted once")
        ty = pg.evaluate("CMD.mods.pr.summary().types.map(function(t){return [t.type,t.count,t.value]})")
        check(all(abs(c - E["prKey"]["types"][t]["count"]) == 0 and abs(v - E["prKey"]["types"][t]["value"]) < 0.02 for t, c, v in ty) and len(ty) == 2, "hosted: WHST / Safety split matches the generator " + str(ty))
        check(pg.evaluate("CMD.mods.pr._state.ks.notInKey") == E["prKey"]["excludedRows"], "hosted: demo key leaves out the other cardholders' rows")
        check(pg.evaluate("CMD.mods.pr._state.items.some(function(i){return i.card==='Michael Erickson (Ops)'})"), "hosted: demo key display name used")
        oprt = pg.inner_text("#oPr")
        check("WHST" in oprt and "Safety" in oprt and "WHST" in pg.inner_text("#tsPr"), "hosted home: PR overview shows WHST and Safety separately")
        cur = str(fy)
        for name, x in E["fuel"].items():
            got = pg.evaluate(f"CMD.mods.fuel._state.recs.filter(function(r){{return r.aasf==={json.dumps(name)} && r.fy==={json.dumps(cur)}}}).reduce(function(t,r){{return t+r.cost}},0)")
            check(abs(got - x["byFy"].get(cur, {"cost": 0})["cost"]) < 0.02, f"hosted: fuel {name} FY{cur} cost")
        check(pg.evaluate("CMD.mods.fuel._state.aasfs.map(function(a){return a.budget})") == [x["budget"] for x in E["fuel"].values()], "hosted: budgets from B1")
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "command-home.png"), full_page=True)
        go(pg, "sof")
        check(money(FD["obligation"]) in pg.inner_text("#kpis") or money(FD["obligation"]) in (pg.get_attribute("#kpis .kpi.obl", "title") or ""), "hosted SOF: obligation matches the finance demo (sign-flipped)")
        check("Travel (example)" in pg.inner_text("#fCi"), "hosted SOF: commitment item descriptions")
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "command-sof.png"), full_page=True)
        go(pg, "pr")
        check(pg.is_visible("#prType") and pg.is_visible("#prTypes") and "TYPE" in pg.inner_text("#tPr thead").upper(), "hosted PR: type filter, WHST/Safety panel, Type column")
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "command-pr.png"), full_page=True)
        go(pg, "fuel")
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "command-fuel.png"), full_page=True)
        pg.go_back(); pg.wait_for_timeout(500)
        check(pg.is_visible("#page-pr") and pg.is_hidden("#page-fuel"), "routing: Back returns to the previous page")
        body = pg.inner_text("body")
        check(not re.search(r"fictional|REAL DATA|nothing is uploaded|github|mcclintock", body, re.I), "hosted: no markings or names on screen")
        pg.close()

        # ---------- single file: opens empty, one upload for everything ----------
        pg = page_new(); pg.goto("file://" + SINGLE); pg.wait_for_timeout(1200)
        check(pg.is_visible("#homeEmpty") and pg.is_hidden("#homeOverview"), "single: opens empty with the upload prompt")
        check(pg.evaluate("!window.FUNDS_DEMO && !window.COMMAND_DEMO") and pg.is_hidden("#btnDemo"), "single: no demo data inside")
        pg.set_input_files("#fileInput", [sof_x, fund_x, key_x, ci_x, p1, p2, p2dup, p3, p4, pnolvl, fa, fb]); pg.wait_for_timeout(3500)
        check(pg.is_hidden("#drawer") and pg.is_visible("#homeOverview"), "single: data loaded, drawer stays closed")
        body = pg.inner_text("body")
        check(SSN not in body and "ALLOBJ" not in body and not re.search(r"rows dropped|fictional|REAL DATA", body, re.I), "single: no breakdown, ssn or markings on the main view")
        today = pg.evaluate("CMD.dateText(new Date())")
        check(("Data as of " + today) in pg.inner_text("#hLead"), "data as of on home")
        go(pg, "sof")
        kt = lambda c: pg.get_attribute(f"#kpis .kpi.{c}", "title") or ""
        check(money(round(OBL, 2)) in kt("obl") and money(round(DISB, 2)) in kt("disb"), f"SOF: sign-flipped obligation {OBL:,.2f} / disbursement, ALLOBJ removed")
        check(money(abs(BAL)) in kt("bal") and money(TDP) in kt("tdp"), "SOF: Balance = TDP - Res - Obl - Disb")
        check("Travel" in pg.inner_text("#fCi") and "1N" in pg.inner_text("#fSag") and "ZZ" not in pg.inner_text("#fSag"), "SOF: keys applied, export sag ignored")
        check(("Data as of " + today) in pg.inner_text("#asof-sof"), "SOF: data as of in the page header")
        go(pg, "pr")
        S = pg.evaluate("CMD.mods.pr._state.items.map(function(i){return [i.pr,i.level,i.card,i.val,i.lines,i.alsoIn]})")
        by = {x[0]: x for x in S}
        got = {}
        for x in S: g = got.setdefault(x[1], [0, 0.0]); g[0] += 1; g[1] += x[3]
        check(all(got.get(k, [0, 0])[0] == v[0] and abs(got.get(k, [0, 0])[1] - v[1]) < 0.01 for k, v in PR_EXP.items()), "PR: count + value per level " + str(got))
        check(by["11111111"][3] == 150.5 and by["11111111"][4] == 2, "PR: lines of one PR summed")
        check(abs(by["44444444"][3] - 999.99) < 0.001 and by["44444444"][4] == 3, "PR: same total repeated on every line counted once (number and text PRs grouped)")
        check(by["33333333"][1] == 3 and by["33333333"][5] == [1], "PR: PR in L1 and L3 shown at Level 3")
        check(by["11111111"][2] == "John Public" and by["22222222"][2] == "Mary Smith-Jones" and by["33333333"][2] == "Pat Oneil", "PR: cardholder first + last (drops middle, .mil, domain)")
        check(by["55555555"][2] == "Robert Smith" and by["66666666"][2] == "O'Brien McDonald" and by["44444444"][2] == "Jane Doe", "PR: other name layouts")
        check("LEVEL 3" in pg.inner_text("#prPipe").upper() and "L3" in pg.inner_text("#tPr"), "PR: pipeline + level column")
        pg.select_option("#prLevel", "2"); pg.wait_for_timeout(300)
        check(pg.locator("#tPr tbody tr").count() == 2, "PR: level filter")
        pg.click("#prReset"); pg.wait_for_timeout(200)
        pg.fill("#prSearch", "plywood"); pg.wait_for_timeout(500)
        check(pg.locator("#tPr tbody tr").count() == 1, "PR: search by description")
        pg.click("#prReset"); pg.wait_for_timeout(200)
        check(pg.evaluate("CMD.mods.pr._state.items.length") == 7 and pg.is_hidden("#prTypeWrap") and pg.is_hidden("#prTypes") and "TYPE" not in pg.inner_text("#tPr thead").upper(), "no key: every cardholder shown, no type split")
        go(pg, "fuel")
        F = pg.evaluate("CMD.mods.fuel._state.aasfs.map(function(a){return [a.name,a.budget]})")
        check(F == [["North Field", 12000.0], ["South Field", 3000.0]], "fuel: AASF from file name, budget from B1")
        n = pg.evaluate("CMD.mods.fuel._state.recs.length")
        check(n == 4, f"fuel: 4 transactions (text dates read, total row ignored) got {n}")
        check(money(FA_SPENT + FB_SPENT) in pg.inner_text("#fuKpis"), "fuel: total spent")
        prog = pg.evaluate(f"CMD.fyProgress('{fy}').pct")
        exp_pace = "Over pace" if FB_SPENT / 3000.0 / prog > 1.1 else "On pace"
        check(exp_pace in pg.inner_text("#fuCards"), "fuel: South Field pace " + exp_pace)
        # drawer: breakdown is there when opened
        pg.click("#btnInfo"); pg.wait_for_timeout(300)
        dr = pg.text_content("#drawer")
        check(pg.is_visible("#drawer") and "ALLOBJ" not in pg.inner_text("body") and "Same content as" in dr and "Could not tell the level" in dr, "drawer: file breakdown (no ALLOBJ note), duplicate copy, file without level")
        check("appear in more than one level" in pg.text_content("#prReport") and "repeated the same Total Value" in pg.text_content("#prReport"), "drawer: PR notes")
        check(SSN not in pg.content(), "ssn never read")
        pg.click("#btnClose"); pg.wait_for_timeout(300)
        # ---------- Cardholder Key ----------
        go(pg, "pr")
        pg.set_input_files("#fileInput", [ckey]); pg.wait_for_timeout(1500)
        K2 = pg.evaluate("CMD.mods.pr._state.items.map(function(i){return [i.pr,i.level,i.card,i.val,i.type]})")
        kb = {x[0]: x for x in K2}
        check(sorted(kb) == ["11111111", "22222222", "44444444", "77777777"], "key: only key cardholders kept " + str(sorted(kb)))
        check(kb.get("11111111", [0, 0, ""])[2] == "John Public" and kb.get("44444444", [0, 0, ""])[2] == "Jane Doe", "key: email-style entries match (middle name, domain, .mil ignored)")
        check(kb.get("77777777", [0, 0, ""])[2] == "Amy Lee" and kb.get("22222222", [0, 0, ""])[2] == "M. Smith-Jones", "key: First Last entries match; Display Name used")
        check([kb[k][4] for k in ["11111111", "22222222", "44444444", "77777777"]] == ["WHST", "Safety", "WHST", "Safety"], "key: Type read case-insensitively")
        ks = pg.evaluate("CMD.mods.pr._state.ks")
        check(ks["notInKey"] == 3 and ks["untyped"] == 1 and ks["names"] == 6, "key: 3 rows not in key + 1 Unassigned row left out " + json.dumps({k: ks[k] for k in ("notInKey", "untyped", "names")}))
        body = pg.inner_text("body")
        check(not re.search(r"Oneil|McDonald|Robert Smith|left out|not in the key|Unassigned|Cardholder Key", body), "key: nothing about the key or excluded names on the main view")
        sm = pg.evaluate("CMD.mods.pr.summary().types.map(function(t){return [t.type,t.count,Math.round(t.value*100)/100,t.levels.map(function(g){return [g.level,g.count]})]})")
        check(sm == [["WHST", 2, 1150.49, [[1, 1], [2, 1]]], ["Safety", 2, 480.0, [[1, 1], [4, 1]]]], "type split: count, value and levels per type " + str(sm))
        tp = pg.inner_text("#prTypes")
        check("WHST" in tp and "Safety" in tp and "$1,150.49" in tp and "$480.00" in tp, "type split: WHST and Safety cards on the PR page")
        pg.select_option("#prType", "Safety"); pg.wait_for_timeout(300)
        check(pg.locator("#tPr tbody tr").count() == 2 and "Safety" in pg.inner_text("#tPr tbody") and "WHST" not in pg.inner_text("#tPr tbody"), "type filter: Safety only")
        check("$480.00" in pg.inner_text("#prKpis"), "type filter: KPIs follow the type")
        ds = pg.evaluate("Chart.getChart('cPrCard').data.datasets.map(function(d){return d.label})")
        check(ds == ["WHST", "Safety"], "charts: bars split by type " + str(ds))
        pg.click("#prReset"); pg.wait_for_timeout(200)
        go(pg, "home")
        check("WHST" in pg.inner_text("#oPr") and "Safety" in pg.inner_text("#oPr") and "2 PRs \u00b7 L1 1 \u00b7 L2 1" in pg.inner_text("#oPr"), "home: PR overview split WHST / Safety")
        pg.click("#btnInfo"); pg.wait_for_timeout(300)
        pt = pg.text_content("#prReport")
        check("6 rows read" in pt and "3 PR rows left out because the cardholder is not in the key" in pt and "1 key row Unassigned" in pt and "1 PR row from them left out" in pt, "drawer: key row count and left-out counts")
        check(not re.search(r"Oneil|McDonald|Robert Smith|o'brien|pat\.", pt, re.I), "drawer: no names of left-out cardholders")
        check("Cardholder Key" in pg.text_content("#tFiles"), "drawer: key file routed to the PR Tracker")
        with pg.expect_download() as dl: pg.click("#btnSave")
        saved = os.path.join(tmp, dl.value.suggested_filename); dl.value.save_as(saved)
        check(re.match(r"Aviation-Dashboard-\d\d[A-Z][a-z]{2}\d\d\.html$", dl.value.suggested_filename) is not None, "save: dated file name " + dl.value.suggested_filename)
        pg.close()
        # tamper the PR "as of" date to prove saved dates are kept
        t = open(saved, encoding="utf-8").read()
        check(SSN not in t and '<script id="commandSaved"' in t, "save: data block, no ssn")
        blk0 = t.split('<script id="commandSaved" type="application/json">')[1].split("</script>")[0]
        prblk = json.dumps(json.loads(blk0)["pr"]["files"])
        check(not re.search(r"oneil|mcdonald|smith, robert|Robert Smith", prblk, re.I) and json.loads(blk0)["pr"]["key"]["name"] == "My Cardholders.xlsx", "save: left-out cardholders are not written into the saved copy; key kept")
        blk = json.loads(t.split('<script id="commandSaved" type="application/json">')[1].split("</script>")[0])
        blk["pr"]["asOf"] = "2026-10-01T17:00:00.000Z"
        t = t.split('<script id="commandSaved" type="application/json">')[0] + '<script id="commandSaved" type="application/json">' + json.dumps(blk).replace("<", "\\u003c") + "</script>" + t.split('<script id="commandSaved" type="application/json">')[1].split("</script>", 1)[1]
        open(saved, "w", encoding="utf-8").write(t)
        pg = page_new(); pg.goto("file://" + saved); pg.wait_for_timeout(1500)
        body = pg.inner_text("body")
        check(pg.is_visible("#homeOverview") and not re.search(r"REAL DATA|contains real|restricted|fictional", body, re.I), "saved: opens with data, no banner")
        check("01 Oct 2026" in pg.inner_text("#oPr") and today in pg.inner_text("#oSof"), "saved: original data-as-of dates kept per section")
        go(pg, "sof")
        check(money(round(OBL, 2)) in kt("obl") and money(abs(BAL)) in kt("bal") and "-$" not in kt("obl"), "saved: amounts not flipped twice")
        go(pg, "pr")
        check("01 Oct 2026" in pg.inner_text("#asof-pr"), "saved: PR page keeps its date")
        ks = pg.evaluate("CMD.mods.pr._state.ks")
        check(pg.evaluate("CMD.mods.pr._state.items.length") == 4 and pg.evaluate("CMD.mods.pr._state.typed") and ks["notInKey"] == 3 and ks["untyped"] == 1, "saved: key, type split and left-out counts survive Save with data")
        check(pg.is_visible("#prTypes") and "M. Smith-Jones" in pg.inner_text("#tPr"), "saved: display names and WHST/Safety shown")
        # a viewer updates L4 in the saved copy, then saves again
        pg.set_input_files("#fileInput", [p4b]); pg.wait_for_timeout(1500)
        L4n = pg.evaluate("CMD.mods.pr._state.items.filter(function(i){return i.level===4}).length")
        check(pg.evaluate("CMD.mods.pr._state.ks.notInKey") == 3, "saved + new L4: left-out count kept")
        check(L4n == 2 and today in pg.inner_text("#asof-pr"), "saved: new L4 replaces the old one; PR date updated")
        check(pg.evaluate("CMD.mods.fuel._state.aasfs.length") == 2, "saved: other pages kept after an upload")
        with pg.expect_download() as dl: pg.click("#btnInfo"); pg.click("#btnSave")
        saved2 = os.path.join(tmp, "second.html"); dl.value.save_as(saved2)
        pg.close()
        pg = page_new(); pg.goto("file://" + saved2); pg.wait_for_timeout(1500); go(pg, "sof")
        check(money(round(OBL, 2)) in kt("obl") and pg.evaluate("document.querySelectorAll('#commandSaved').length") == 1, "saved twice: still not flipped twice, one data block")
        pg.close()
        check(not net, "no network requests " + str(net[:3]))
        check(not errors, "no console errors " + str(errors[:3]))
        b.close()

run()
print("FAILED: %d" % len(FAILS) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
