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
def K_money(v):                                              # DashKit.money
    a, s = abs(v), "-" if v < 0 else ""
    return s + (f"${a/1e9:.2f}B" if a >= 1e9 else f"${a/1e6:.2f}M" if a >= 1e6 else f"${a/1e3:.0f}K" if a >= 1e3 else f"${a:.0f}")

tmp = tempfile.mkdtemp(prefix="cmd-test-")
def xlsx(path, rows, sheet="Sheet1"):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = sheet
    for r in rows: ws.append(r)
    wb.save(path); return path

# ---- Status of Funds (same schema as the finance dashboard) ----
H = ["fund", "contract_doc_no", "commitment_item_fipex", "functional_area_farea", "appropriation_type", "fiscal_year", "fiscal_month", "ssn",
     "obligation_amt_cum", "commitment_amt_cum", "disbursement_amt_cum", "sag", "mdep"]
ex_rows, OBL, DISB, TE = [], 0.0, 0.0, 0.0
for i in range(60):
    allobj = i % 10 == 0
    o, d = round(1000 + i * 37.5, 2), round(400 + i * 11.25, 2)
    te = round(o + d, 2) if i != 1 else round(d - 50.0, 2)      # Total Expenditure (commitment_amt_cum); line 1: disbursement > commitment -> obligation -50
    # obligation_amt_cum carries a junk value: Aviation calculates Obligation = Total Expenditure - Disbursement and never reads it
    ex_rows.append(["2065", f"W91ZZZ26P{i:04d}", "ALLOBJ" if allobj else ["21T0", "26FF", "252G"][i % 3], ["121G11ABCD", "131G21TRNG"][i % 2], "OMNG", 2026, (i % 12) + 1, SSN, -999999.0, -te, -d, "ZZ", "ZZZZ"])
    if not allobj: OBL += round(te - d, 2); DISB += d; TE += te
bad_x = xlsx(os.path.join(tmp, "funds no commitment.xlsx"), [[h for h in H if h != "commitment_amt_cum"]] + [[v for k, v in zip(H, r) if k != "commitment_amt_cum"] for r in ex_rows[:5]])
sof_x = xlsx(os.path.join(tmp, "funds export.xlsx"), [["Funds report (fictional)"], [], H] + ex_rows)
TDP, RES = 500000.0, 2500.0
fund_x = xlsx(os.path.join(tmp, "Funding.xlsx"), [["Fiscal Year", "Account", "TDP", "AFP", "Reservations"], ["FY26", "Aviation", TDP, 400000.0, RES]])
key_x = xlsx(os.path.join(tmp, "Account Key.xlsx"), [["Functional Area", "Account", "Sag", "MDEP"], ["121G11ABCD", "Aviation", "1N", "TATM"], ["131G21TRNG", "Aviation", "1N", "TATM"]])
ci_x = xlsx(os.path.join(tmp, "CI Key.xlsx"), [["Commitment Item", "Description"], ["21T0", "Travel"], ["26FF", "Fuel"], ["252G", "Contract Services"]])
BAL = round(TDP - OBL - DISB, 2)
# Spend Plans: actual Total Expenditure per fiscal month of the fixture (Aviation only), and a monthly plan that puts each month
# at a chosen variance: 4.9% green, 7% yellow, 12% red, both signs
ACT = [0.0] * 12
for i, r in enumerate(ex_rows):
    if r[2] != "ALLOBJ": ACT[r[6] - 1] += -r[9]
ACT = [round(a, 2) for a in ACT]
VAR = [0.049, -0.049, 0.07, -0.07, 0.12, -0.12, 0.0, 0.03, -0.09, 0.2, 0.0, 0.01]
VCLS = ["g", "g", "y", "y", "r", "r", "g", "g", "y", "r", "g", "g"]
PLAN = [round(a / (1 + v), 2) for a, v in zip(ACT, VAR)]
# Cole's spend plan: Account, then October .. September; no Fiscal Year column (always the current fiscal year)
SPM = ["October", "Nov", "Dec", "January", "Feb", "Mar", "Apr", "May", "June", "Jul", "Aug", "Sept"]
plan_x = xlsx(os.path.join(tmp, "Spend Plan.xlsx"), [["Aviation spend plan"], [], ["Account"] + SPM,
    ["  aviation ", "$1,234.50", 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000], [],
    ["Fuel", 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200], ["Total", 1334.5, 2200, 3300, 4400, 5500, 6600, 7700, 8800, 9900, 11000, 12100, 13200]])
plan_dates_x = xlsx(os.path.join(tmp, "Spend Plan dates.xlsx"), [["Account"] + [dt.datetime(2026 + (m < 10 and 1 or 0), m, 1) for m in [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]], ["Aviation"] + list(range(1, 13))])
plan12_x = xlsx(os.path.join(tmp, "Monthly Spend Plan.xlsx"), [["Account", "Fiscal Year"] + [f"Month {m}" for m in range(1, 13)], ["Aviation", "FY26"] + PLAN])                            # Aviation dashboard: no Reservations (the column in the test file is ignored)

# ---- PR files ----
PRH = ["Purchase requisition", "Item", "Cardholder Name", "Plant", "Merchant / Description", "Short Text", "Qty", "Total Value", "SSN", "Created By"]
def prrow(pr, card, merch, desc, val): return [pr, 10, card, "IA01", merch, desc, 1, val, SSN, "XXXX"]
L1 = [prrow(11111111, "john.q.public.mil@army.mil", "Hawk Supply", "Paper", 50.5), prrow(11111111, "john.q.public.mil@army.mil", "Hawk Supply", "Toner", 100.0),  # summed: 150.50; description = Toner (highest line)
      prrow(22222222, "MARY.ANN.SMITH-JONES", "Tool Co", "Wrench", 80.0),
      prrow(33333333, "pat.oneil@army.mil", "Parts Inc", "Seal", 300.0),                     # also in L3 -> shown at L3
      [None, None, None, None, None, None, None, 530.5, None, None]]                        # total row
L2 = [prrow("44444444", "jane.doe", "Cater Co", "Meals", 999.99), prrow("44444444", "jane.doe", "Cater Co", "Meals day 2", 999.99), prrow(44444444.0, "jane.doe", "Cater Co", "Water", 999.99),  # each line is an item: 2,999.97; tie -> first line "Meals" # repeated total -> 999.99 once
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
PR_EXP = {1: (2, 150.5 + 80.0), 2: (2, 2999.97 + 45.0), 3: (2, 1500.0), 4: (1, 400.0)}

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

check([c.value for c in openpyxl.load_workbook(os.path.join(ROOT, "dashboards", "command", "funding_template.xlsx")).active[1]] == ["Fiscal Year", "Account", "TDP", "AFP"], "aviation funding template: Fiscal Year, Account, TDP, AFP")
check("Reservations" in [c.value for c in openpyxl.load_workbook(os.path.join(ROOT, "dashboards", "finance", "funding_template.xlsx")).active[1]], "finance funding template keeps Reservations")
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
        D = pg.evaluate("CMD.mods.pr._state.items.map(function(i){return [i.pr,i.desc]})")
        check(all(E["pr"]["desc"][p_] == d_ for p_, d_ in D) and not any("more)" in d_ for p_, d_ in D), "hosted: description = Short Text of the highest-value line (no '+N more')")
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
        check(pg.input_value("#fFy") == pg.evaluate("CMD.mods.sof.summary().fy") != "", "hosted SOF: opens on one fiscal year " + pg.input_value("#fFy"))
        pg.select_option("#fFy", ""); pg.wait_for_timeout(500)
        tot = lambda k: pg.evaluate(f"Math.round(CMD.mods.sof._state.view.acc.reduce(function(s,a){{return s+a.{k}}},0)*100)/100")
        check(money(FD["totalExpenditure"]) in (pg.get_attribute("#kpis .kpi.te", "title") or "") and abs(tot("obl") - FD["obligation"]) < 0.05 and abs(tot("disb") - FD["disbursement"]) < 0.05, "hosted SOF: Total Expenditure KPI; calculated obligation / disbursement (secondary) match the Aviation demo")
        check(abs(FD["obligation"] + FD["disbursement"] - FD["totalExpenditure"]) < 0.05 and FD["obligation"] != FD["obligationAmtCumIgnored"], "hosted SOF: Spent = Obligation + Disbursement = Total Expenditure")
        check("Total Expenditure" in pg.inner_text("#kpis") and not re.search(r"Commitments", pg.inner_text("#page-sof")), "hosted SOF: Total Expenditure label, no Commitments")
        pg.select_option("#fFy", pg.evaluate("CMD.mods.sof.summary().fy")); pg.wait_for_timeout(500)
        check("Travel (example)" in pg.inner_text("#fCi"), "hosted SOF: commitment item descriptions")
        check(sorted(pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#fAcct option'),function(o){return o.value}).filter(Boolean)").__iter__()) == sorted(["Aviation", "Fuel", "Parts", "Safety", pg.evaluate("FundsLib.UNMAPPED")]) and FD["accountNames"] == ["Aviation", "Fuel", "Parts", "Safety"], "hosted SOF: demo accounts are Aviation, Fuel, Parts and Safety")
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "command-sof.png"), full_page=True)
        # ---------- Spend Plans (hosted demo) ----------
        go(pg, "spend")
        check(pg.is_visible("#page-spend") and pg.locator("#spKpis .kpi").count() == 4 and all(t in pg.inner_text("#spKpis").upper() for t in ["PLANNED TO DATE", "ACTUAL TO DATE", "VARIANCE TO DATE", "ACCOUNTS OFF PLAN"]), "hosted spend: four KPIs")
        cls = pg.evaluate("[0.049,-0.049,0.07,-0.07,0.12,-0.12,0.05,-0.05,0.1,-0.1,0.1001,0,null].map(CMD.varClass)")
        check(cls == ["g", "g", "y", "y", "r", "r", "g", "g", "y", "y", "r", "g", "na"], "spend: variance colors 4.9% green, 7% yellow, 12% red (both signs; 5% and 10% boundaries) " + str(cls))
        check(pg.evaluate("CMD.varPct(107,100)") == 0.07 and pg.evaluate("CMD.varText(-0.12)") == "\u221212.0%", "spend: variance % = (actual - planned) / planned")
        sfy = pg.evaluate("CMD.mods.sof.summary().fy"); curfy = str(fy)
        check(sfy == curfy and pg.input_value("#spFy") == curfy, "hosted: SOF and Spend Plans open on the current fiscal year (FY" + curfy + ") when it has data")
        def spend_model(): return pg.evaluate("(function(){var m=CMD.mods.spend.model();return {last:m.last,list:m.list.map(function(x){return [x.label,x.planned,x.a.reduce(function(s,v){return s+v},0),x.p]}),nm:m.noMonth}})()")
        def sof_by_acct(y): return pg.evaluate(f"(function(){{var S=CMD.mods.sof._state,o={{}};S.recs.forEach(function(r){{if(r.fy==={json.dumps(y)}&&r.fmn){{o[r.acctL]=(o[r.acctL]||0)+(+r.com||0)}}}});return o}})()")
        def sof_te(y): return pg.evaluate(f"CMD.mods.sof._state.recs.filter(function(r){{return r.fy==={json.dumps(y)}}}).reduce(function(t,r){{return t+(+r.com||0)}},0)")
        M = spend_model()
        check([x[0] for x in M["list"] if x[1]] == ["Aviation", "Fuel", "Parts", "Safety"], "hosted spend: planned accounts Aviation, Fuel, Parts, Safety")
        act = sum(x[2] for x in M["list"]); nm = (M["nm"] or {"te": 0})["te"]
        check(abs(act + nm - pg.evaluate("CMD.mods.sof.summary().te")) < 0.05, f"spend: FY{curfy} actuals reconcile to SOF Total Expenditure ({act:,.2f} by month + {nm:,.2f} without a month)")
        dA = pg.evaluate("DashKit.charts.cSpend.data.datasets[1].data")
        check(M["last"] < 12 and all(v is None for v in dA[M["last"]:]) and pg.locator("#tSpend tbody td.vc.fut").count() > 0, f"hosted spend: FY{curfy} shows actuals only through month {M['last']}")
        sfy = str(int(curfy) - 1)                                  # a full year for the color / toggle checks
        pg.select_option("#spFy", sfy); pg.wait_for_timeout(400)
        M = spend_model(); act = sum(x[2] for x in M["list"]); nm = (M["nm"] or {"te": 0})["te"]
        check(abs(act + nm - sof_te(sfy)) < 0.05, f"spend: FY{sfy} actuals reconcile to SOF Total Expenditure ({act:,.2f} by month + {nm:,.2f} without a month)")
        sofacc = sof_by_acct(sfy)
        check(all(abs(sofacc.get(x[0], 0) - x[2]) < 0.05 for x in M["list"]), "spend: each account's actuals = its SOF Total Expenditure")
        # an uploaded plan without a Fiscal Year belongs to the current fiscal year
        fyA = pg.evaluate("""(function(){function src(g){return {rows:g.length,cols:g[0].length,get:function(r,c){return g[r][c]}}}
          var a=CMD.mods.spend.parse('plan12',src([['Account','Month 1','Month 2','Month 3','Month 4','Month 5','Month 6'],['Aviation',1,2,3,4,5,6]]),'x','','x.xlsx');
          var b=CMD.mods.spend.parse('plan12',src([['Account','Fiscal Year','Month 1','Month 2','Month 3','Month 4','Month 5','Month 6'],['Aviation','FY25',1,2,3,4,5,6]]),'x','','y.xlsx');
          var c=CMD.mods.sof.parse('plan',src([['Account','Fiscal Month','Planned Amount'],['Aviation',1,100]]),'z','','z.xlsx');
          var d=CMD.mods.sof.parse('plan',src([['Fiscal Year','Account','Fiscal Month','Planned Amount'],['FY25','Aviation',1,100]]),'w','','w.xlsx');
          return [a.rows[0].fy,b.rows[0].fy,c.rows[0].fy,d.rows[0].fy,!!a.fatal]})()""")
        check(fyA == [curfy, "2025", curfy, "2025", False], "spend plan without a Fiscal Year -> current FY (monthly template and SOF spend plan); an explicit year is kept " + str(fyA))
        chips = pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#tSpend tbody td.vc .vchip'),function(c){return [c.className.split(' ')[1],c.textContent]})")
        def cls_of(t):
            v = abs(float(t.replace("\u2212", "-").replace("+", "").rstrip("%"))) / 100
            return "g" if v <= 0.05 else "y" if v <= 0.10 else "r"
        okc = [c for c in chips if c[0] in "gyr"]
        check(len(okc) > 20 and all(cls_of(t) == c for c, t in okc) and {c for c, t in okc} >= {"g", "y", "r"}, "hosted spend: grid chips colored by |variance| (green, yellow and red all present)")
        kv = pg.inner_text("#spKpis .kpi:nth-child(3) .val"); kc = pg.get_attribute("#spKpis .kpi:nth-child(3) .vtxt", "class")
        check(kc.split()[-1] == cls_of(kv), "hosted spend: variance KPI colored " + kv)
        bars = pg.evaluate("DashKit.charts.cSpend.data.datasets[1].backgroundColor")
        check(len(bars) == 12 and set(bars) <= {"#16a34a", "#eab308", "#dc2626", "#94a3b8"}, "hosted spend: chart actual bars colored by variance")
        pg.click("#spMode button[data-m=cum]"); pg.wait_for_timeout(400)
        cumA = pg.evaluate("DashKit.charts.cSpend.data.datasets[1].data")
        check(pg.evaluate("DashKit.charts.cSpend.config.type") == "line" and abs(cumA[M["last"] - 1] - act) < 0.05, "hosted spend: Cumulative toggle (last month = year to date)")
        pg.click("#spMode button[data-m=month]"); pg.wait_for_timeout(300)
        pg.click('#tSpend [data-acct="Fuel"]'); pg.wait_for_timeout(400)
        fuelP = [x for x in M["list"] if x[0] == "Fuel"][0][3]
        check(pg.input_value("#spAcct") == "Fuel" and pg.locator("#tSpend tbody tr").count() == 1 and K_money(sum(fuelP[:M["last"]])) in pg.inner_text("#spKpis .kpi:nth-child(1)"), "hosted spend: clicking an account filters the page")
        pg.click("#spReset"); pg.wait_for_timeout(500)
        check(pg.input_value("#spFy") == curfy, "hosted spend: Reset returns to the current fiscal year")
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "command-spend.png"), full_page=True)

        check(pg.is_visible("#spDemo") and "DEMO DATA" in pg.inner_text("#page-spend h1").upper(), "hosted spend: 'Demo data' tag while no real spend plan is loaded")
        mt = pg.evaluate("""(function(){function src(g){return {rows:g.length,cols:Math.max.apply(null,g.map(function(r){return r.length})),get:function(r,c){var v=g[r][c];return v===undefined?null:v}}}
          var m=CMD.mods.spend, e=m.parse('plan12',src([['Plan'],['Account','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'],[' aviation ',1,1,1,1,1,1,1,1,1,1,1,1],['FUEL ',2,2,2,2,2,2,2,2,2,2,2,2],['Parts',3,3,3,3,3,3,3,3,3,3,3,3],['Training Ammo',4,4,4,4,4,4,4,4,4,4,4,4],['Grand Total',10,10,10,10,10,10,10,10,10,10,10,10]]),'p','','Plan.xlsx');
          m.ingest([e]); m.asOf=new Date(); CMD.refresh(); CMD.go('spend');
          var M=m.model(), r={fy:M.fy, rows:M.list.map(function(x){return [x.label,x.planned]}), um:m.unmatched(), tag:document.getElementById('spDemo').hidden, totals:e.totals,
            safety:(document.querySelector('#tSpend tbody tr:has([data-acct=Safety])')||{}).textContent||''};
          m._state.own=null; m._state.files=[]; m.asOf=null; CMD.refresh();
          r.tagBack=!document.getElementById('spDemo').hidden; return r})()""")
        check(mt["fy"] == curfy and [x for x in mt["rows"] if x[1]] == [["Aviation", True], ["Fuel", True], ["Parts", True], ["Training Ammo", True]] and mt["totals"] == 1, "spend plan accounts match SOF accounts trimmed, ignoring case (Grand Total row skipped) " + str(mt["rows"]))
        check(mt["um"] == ["Training Ammo"] and "no plan" in mt["safety"], "spend: unmatched plan accounts listed for the drawer; SOF account without a plan shows 'no plan'")
        check(mt["tag"] is True and mt["tagBack"] is True, "spend: 'Demo data' tag hides once a real plan loads (and returns without one)")
        # ---------- AFTPs (hosted demo) ----------
        go(pg, "aftp")
        A = E["aftp"]; kt_ = pg.inner_text("#afKpis")
        check(pg.is_visible("#afDemo") and "DEMO DATA" in pg.inner_text("#page-aftp h1").upper(), "hosted AFTP: 'Demo data' label on the page")
        check(pg.locator("#afKpis .kpi").count() == 5 and f"{A['used']}" in kt_ and money(A["outstanding"]) in kt_, "hosted AFTP: KPIs used / paid / unpaid / outstanding / soldiers with unpaid")
        tot_ = pg.evaluate("CMD.mods.aftp._state.total"); who = pg.evaluate("CMD.mods.aftp._state.who")
        check(tot_["used"] == A["used"] and tot_["paid"] == A["paid"] and tot_["unpaid"] == A["unpaid"] and abs(tot_["out"] - A["outstanding"]) < 0.01 and who == A["soldiersUnpaid"], "hosted AFTP: totals match the generator " + json.dumps(A))
        check(pg.locator("#tAftp tbody tr").count() == A["soldiers"] and A["soldiers"] >= 24, "hosted AFTP: one row per soldier")
        ranks = set(pg.evaluate("CMD.mods.aftp._state.soldiers.map(function(s){return s.rank})"))
        check(ranks == {"PV2", "SPC", "SGT", "SSG", "SFC", "WO1", "CW2", "CW3", "1LT", "CPT", "MAJ"}, "hosted AFTP: ranks PV2 .. MAJ")
        check(pg.locator("#tAftp tbody tr.amber, #tAftp tbody tr.red").count() == A["soldiersUnpaid"] and pg.locator("#tAftp .upill").count() == A["soldiersUnpaid"], "hosted AFTP: soldiers with unpaid AFTPs highlighted")
        outs = [float(t.replace("$", "").replace(",", "")) if t.startswith("$") else 0 for t in pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#tAftp tbody tr'),function(r){return r.cells[5].textContent})")]
        check(outs == sorted(outs, reverse=True) and outs[0] > 0, "hosted AFTP: default sort puts the most outstanding first")
        pg.click("#tAftp th[data-k=used]"); pg.wait_for_timeout(200)
        used = pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#tAftp tbody tr'),function(r){return +r.cells[2].textContent})")
        check(used == sorted(used, reverse=True), "hosted AFTP: sortable (AFTPs used)")
        pg.fill("#afSearch", "tango"); pg.wait_for_timeout(300)
        check(pg.locator("#tAftp tbody tr").count() == 1 and "Tango" in pg.inner_text("#tAftp tbody"), "hosted AFTP: searchable")
        pg.fill("#afSearch", ""); pg.wait_for_timeout(300)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "command-aftp.png"), full_page=True)
        sid = pg.get_attribute("#tAftp tbody tr.red, #tAftp tbody tr.amber", "data-sid")
        mine = pg.evaluate(f"CMD.mods.aftp._state.aftps.filter(function(a){{return a.sid==={json.dumps(sid)}}}).map(function(a){{return [a.paid,a.amount]}})")
        pg.click(f'#tAftp tbody tr[data-sid="{sid}"]'); pg.wait_for_timeout(600)
        dt_ = pg.inner_text("#tAfDetail tbody"); nun = sum(1 for x in mine if not x[0])
        check(pg.evaluate("location.hash") == "#/aftp/" + sid and pg.is_visible("#afDetail") and pg.is_hidden("#afList"), "AFTP drill-down: clicking a soldier opens the detail view (#/aftp/" + sid + ")")
        check(pg.locator("#tAfDetail tbody tr").count() == len(mine) and dt_.count("Unpaid") == nun and dt_.count("Paid") == len(mine) - nun and dt_.count("days outstanding") == nun, f"AFTP drill-down: every AFTP date with Paid/Unpaid ({len(mine)} AFTPs, {nun} unpaid) and days outstanding")
        check(money(round(sum(a for p_, a in mine if not p_), 2)) in pg.inner_text("#afDKpis") and re.search(r"\d\d [A-Z][a-z]{2} 20\d\d", dt_), "AFTP drill-down: outstanding $, amounts and paid dates")
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "command-aftp-detail.png"), full_page=True)
        pg.click("#afBack"); pg.wait_for_timeout(500)
        check(pg.evaluate("location.hash") == "#/aftp" and pg.is_visible("#afList") and pg.is_hidden("#afDetail"), "AFTP drill-down: back button returns to the soldier list")
        pg.go_back(); pg.wait_for_timeout(500); check(pg.is_visible("#afDetail"), "AFTP drill-down: browser Back reopens the soldier")
        go(pg, "aftp")
        snap = pg.evaluate("(function(){var m=CMD.mods.aftp,s=m.snapshot();m.clear();m.restore(JSON.parse(JSON.stringify(s)));m.dirty=true;return [m._state.aftps.length,m.summary().out]})()")
        check(snap[0] == A["used"] and abs(snap[1] - A["outstanding"]) < 0.01, "AFTP: save/restore keeps the data")
        go(pg, "home")
        check(pg.is_visible("#tagAftp") and "DEMO DATA" in pg.inner_text("#oAftp").upper() and "DEMO DATA" in pg.inner_text("#oSpend").upper(), "hosted home: 'Demo data' label on the AFTP tile and overview card (and the demo spend plan card)")
        check("Variance" in pg.inner_text("#tsSpend") and f"{A['unpaid']} unpaid" in pg.inner_text("#tsAftp") and "PLANNED TO DATE" in pg.inner_text("#oSpend").upper() and "MOST OUTSTANDING" in pg.inner_text("#oAftp").upper(), "hosted home: Spend Plans and AFTPs tiles and overview cards")
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "command-home.png"), full_page=True)
        go(pg, "sof")
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
        hs = pg.inner_text("#oSof")
        check("TOTAL EXPENDITURE" in hs.upper() and "BALANCE" in hs.upper() and "ACCOUNTS BY % EXPENDED" in hs.upper() and "Aviation" in hs and "OBLIGATED" not in hs.upper(), "home: SOF card shows TDP, Total Expenditure, Balance and top accounts by % expended")
        go(pg, "sof")
        kt = lambda c: pg.get_attribute(f"#kpis .kpi.{c}", "title") or ""
        tot = lambda k: pg.evaluate(f"Math.round(CMD.mods.sof._state.view.acc.reduce(function(s,a){{return s+a.{k}}},0)*100)/100")
        check(abs(tot("obl") - OBL) < 0.01 and abs(tot("disb") - DISB) < 0.01, f"SOF: Obligation = Total Expenditure - Disbursement {OBL:,.2f} (obligation_amt_cum ignored), ALLOBJ removed")
        check(money(round(TE, 2)) in kt("te") and abs(OBL + DISB - TE) < 0.01, "SOF: Total Expenditure KPI = Obligation + Disbursement")
        kp = pg.inner_text("#kpis").upper()
        check([x in kp for x in ["TDP", "AFP", "TOTAL EXPENDITURE", "BALANCE", "% OF TDP EXPENDED"]] == [True] * 5 and "OBLIGATION" not in kp and "DISBURSEMENT" not in kp, "SOF: headline KPIs TDP, AFP, TE, Balance, % expended (no Obligation / Disbursement)")
        prog = 1.0 if dt.date.today() >= dt.date(2026, 10, 1) else None
        pct = TE / TDP; pace = "Over pace" if pct / prog > 1.1 else "Under pace" if pct / prog < 0.9 else "On pace"
        check(f"{round(pct * 100)}%" in pg.inner_text("#kpis .kpi.pct") and "100% of FY2026 elapsed" in pg.inner_text("#kpis .kpi.pct") and pace in pg.inner_text("#kpis .kpi.pct"), "SOF: % of TDP expended vs % of FY elapsed with pace " + pace)
        labs = pg.evaluate("[].concat.apply([], ['cAcctTe','cCiAcct','cCi'].map(function(id){return Chart.getChart(id).data.datasets.map(function(d){return d.label})}))")
        check(not any(re.search(r"Obligation|Disbursement", x) for x in labs) and "Total Expenditure" in labs and "AFP" in labs, "SOF: charts measured by Total Expenditure (no Obligation / Disbursement series) " + str(labs[:4]))
        check(pg.evaluate("Chart.getChart('cAcctTe').data.labels.some(function(l){return l.indexOf('Aviation')===0})") and pg.evaluate("Chart.getChart('cCum').data.datasets[0].label") == "Cumulative Total Expenditure", "SOF: account chart and cumulative Total Expenditure trend")
        ar = pg.inner_text('#tAcct tbody tr.arow:has([data-f="Aviation"])')
        check(all(x in ar for x in ["1N", "TATM", money(TDP), money(round(TE, 2)), money(round(BAL, 2)), pace]), "SOF: account table row (Sag, MDEP, TDP, TE, Balance, pace) " + re.sub(r"\s+", " ", ar))
        pg.click('#tAcct [data-x="Aviation"]'); pg.wait_for_timeout(300)
        ci = pg.inner_text("#tAcct tbody")
        check(pg.locator("#tAcct tbody tr.cirow").count() == 3 and "Travel" in ci and "Contract Services" in ci, "SOF: account expands to its commitment items")
        pg.click('#tAcct th[data-k="pct"]'); pg.wait_for_timeout(200)
        check(pg.locator('#tAcct th[data-k="pct"].sorted').count() == 1, "SOF: account table sortable")
        with pg.expect_download() as dla: pg.click("#btnAcctCsv")
        hd = open(dla.value.path(), encoding="utf-8-sig").readline()
        check(all(x in hd for x in ["Account", "Commitment Item", "TDP", "Total Expenditure", "Balance", "% expended", "Pace", "Obligation", "Disbursement"]) and "Reservations" not in hd, "SOF: account CSV with Obligation / Disbursement as secondary columns")
        check("TOTAL EXPENDITURE" in pg.inner_text("#tDocs thead").upper() and "OBLIGATION" in pg.inner_text("#tDocs thead").upper(), "SOF: line table keeps Obligation / Disbursement columns")
        pg.click('#tAcct [data-f="Aviation"]'); pg.wait_for_timeout(500)
        check(pg.input_value("#fAcct") == "Aviation" and "Aviation" in pg.inner_text("#ciSelTitle"), "SOF: clicking an account filters the page; commitment-item breakdown for that account")
        pg.click("#btnReset"); pg.wait_for_timeout(400)
        check("TOTAL EXPENDITURE" in pg.inner_text("#tDocs thead").upper() and "COMMITMENTS" not in pg.inner_text("#page-sof").upper(), "SOF: line table column renamed to Total Expenditure")
        check("1 line where Disbursement is larger than Total Expenditure" in pg.text_content("#loadReport") and "line where Disbursement" not in pg.inner_text("body"), "SOF: negative calculated obligation counted in the drawer only")
        pg.select_option("#fFy", "2026"); pg.wait_for_timeout(300)
        check(money(abs(BAL)) in kt("bal") and money(TDP) in kt("tdp") and abs(BAL - (TDP - TE)) < 0.01, "SOF: Balance = TDP - Total Expenditure (= TDP - Obl - Disb; Reservations column ignored)")
        check(not re.search(r"reserv", pg.inner_text("#page-sof") + pg.text_content("#drawer"), re.I) and pg.locator("#kpis .kpi").count() == 5 and pg.locator('#tAcct th[data-k="res"]').count() == 0, "SOF: no Reservations anywhere (KPIs, charts, account table, drawer)")
        check("Travel" in pg.inner_text("#fCi") and "1N" in pg.inner_text("#fSag") and "ZZ" not in pg.inner_text("#fSag"), "SOF: keys applied, export sag ignored")
        check(("Data as of " + today) in pg.inner_text("#asof-sof"), "SOF: data as of in the page header")
        go(pg, "pr")
        S = pg.evaluate("CMD.mods.pr._state.items.map(function(i){return [i.pr,i.level,i.card,i.val,i.lines,i.alsoIn]})")
        by = {x[0]: x for x in S}
        got = {}
        for x in S: g = got.setdefault(x[1], [0, 0.0]); g[0] += 1; g[1] += x[3]
        check(all(got.get(k, [0, 0])[0] == v[0] and abs(got.get(k, [0, 0])[1] - v[1]) < 0.01 for k, v in PR_EXP.items()), "PR: count + value per level " + str(got))
        check(by["11111111"][3] == 150.5 and by["11111111"][4] == 2, "PR: lines of one PR summed")
        check(abs(by["44444444"][3] - 2999.97) < 0.001 and by["44444444"][4] == 3, "PR: every line summed even when lines repeat the same value (number and text PRs grouped)")
        DS = dict(pg.evaluate("CMD.mods.pr._state.items.map(function(i){return [i.pr,i.desc]})"))
        check(DS["11111111"] == "Toner" and DS["44444444"] == "Meals" and "more)" not in pg.inner_text("#tPr"), "PR: description from the highest-value line, first line on a tie " + str([DS["11111111"], DS["44444444"]]))
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
        check("appear in more than one level" in pg.text_content("#prReport") and "sum of its lines" in pg.text_content("#prReport") and "counted once" not in pg.text_content("#prReport"), "drawer: PR notes")
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
        check(sm == [["WHST", 2, 3150.47, [[1, 1], [2, 1]]], ["Safety", 2, 480.0, [[1, 1], [4, 1]]]], "type split: count, value and levels per type " + str(sm))
        tp = pg.inner_text("#prTypes")
        check("WHST" in tp and "Safety" in tp and "$3,150.47" in tp and "$480.00" in tp, "type split: WHST and Safety cards on the PR page")
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
        # ---------- Spend Plans (single file): optional monthly plan; variance colors in grid, KPI and chart ----------
        dopen = pg.is_visible("#drawer")
        if dopen: pg.click("#btnClose"); pg.wait_for_timeout(200)
        go(pg, "spend")
        check(pg.is_visible("#page-spend") and "No spend plan loaded" in pg.text_content("#spReport"), "single spend: actuals from SOF, no plan yet")
        pg.set_input_files("#fileInput", [plan12_x]); pg.wait_for_timeout(1500)
        check("Spend plan" in pg.text_content("#tFiles") and pg.evaluate("CMD.mods.spend._state.own.rows.length") == 12, "single spend: monthly plan template (Account, Fiscal Year, Month 1..12) read")
        m_ = pg.evaluate("(function(){var m=CMD.mods.spend.model();return m.list.map(function(x){return [x.label,x.a,x.p]})})()")
        check(len(m_) == 1 and m_[0][0] == "Aviation" and all(abs(a - b) < 0.01 for a, b in zip(m_[0][1], ACT)) and abs(sum(ACT) - TE) < 0.05, "single spend: monthly actuals reconcile to SOF Total Expenditure")
        cells = pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#tSpend tbody tr:first-child td.vc'),function(td){return td.className.replace('vc','').trim()})")
        check(cells[:12] == VCLS, "single spend: grid cells 4.9% green, 7% yellow, 12% red, also negative " + str(cells[:12]))
        chipsT = pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#tSpend tbody tr:first-child td.vc .vchip'),function(c){return c.textContent})")[:6]
        check(chipsT == ["+4.9%", "\u22124.9%", "+7.0%", "\u22127.0%", "+12.0%", "\u221212.0%"], "single spend: chips show the variance " + str(chipsT))
        bars = pg.evaluate("DashKit.charts.cSpend.data.datasets[1].backgroundColor")
        col = {"g": "#16a34a", "y": "#eab308", "r": "#dc2626"}
        check(bars == [col[c] for c in VCLS], "single spend: chart markers colored by variance")
        tdv = (sum(ACT) - sum(PLAN)) / sum(PLAN); want = "g" if abs(tdv) <= 0.05 else "y" if abs(tdv) <= 0.1 else "r"
        check(want in pg.get_attribute("#spKpis .kpi:nth-child(3) .vtxt", "class") and pg.inner_text("#spKpis .kpi:nth-child(4) .val").startswith("1" if want != "g" else "0"), "single spend: variance KPI and accounts off plan")
        pg.click("#spMode button[data-m=cum]"); pg.wait_for_timeout(300)
        cumc = pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#tSpend tbody tr:first-child td.vc'),function(td){return td.className.replace('vc','').trim()})")[0:2]
        check(cumc[0] == "g" and pg.evaluate("DashKit.charts.cSpend.data.datasets[1].data[11]") == round(sum(ACT), 2), "single spend: cumulative view")
        pg.click("#spMode button[data-m=month]"); pg.wait_for_timeout(200)
        check(pg.is_hidden("#spDemo"), "single spend: no 'Demo data' tag on uploaded data")
        pg.set_input_files("#fileInput", [plan_dates_x]); pg.wait_for_timeout(1200)
        ownD = pg.evaluate("CMD.mods.spend._state.own.rows.map(function(r){return [r.fm,r.amt]})")
        check(ownD == [[m, m] for m in range(1, 13)], "spend plan: Excel date month headers (Oct .. Sep) read")
        pg.set_input_files("#fileInput", [plan_x, fund_x, key_x]); pg.wait_for_timeout(1800)
        kinds = pg.evaluate("CMD.mods.sof.entries().filter(function(e){return !e.dupOf}).map(function(e){return [e.name,e.kind]}).concat(CMD.mods.spend.entries().map(function(e){return [e.name,e.kind]}))")
        check(["Funding.xlsx", "funding"] in kinds and ["Account Key.xlsx", "key"] in kinds and ["Spend Plan.xlsx", "plan12"] in kinds and not any(k[0] == "Spend Plan.xlsx" and k[1] != "plan12" for k in kinds), "spend plan detected by its headers in a multi-file upload, next to the funding file and Account Key")
        own = pg.evaluate("CMD.mods.spend._state.own")
        check(own["files"] == ["Spend Plan.xlsx"] and len(own["rows"]) == 24, "spend plan: a new upload replaces the plan; header found below row 1; blank and Total rows skipped")
        check(all(r["fy"] == str(fy) for r in own["rows"]) and pg.input_value("#spFy") == str(fy), f"spend plan: no Fiscal Year column -> current FY{fy}; page opens on it")
        av = sorted([r for r in own["rows"] if r["acct"].strip().lower() == "aviation"], key=lambda r: r["fm"])
        check(av[0]["amt"] == 1234.5 and av[11]["amt"] == 12000 and [r["fm"] for r in av] == list(range(1, 13)), "spend plan: full and abbreviated month names (Sept too), currency strings, values as entered")
        lab = pg.evaluate("CMD.mods.spend.model().list.map(function(x){return x.label})")
        check("Aviation" in lab and pg.evaluate("CMD.mods.spend.unmatched()") == ["Fuel"] and "Fuel" in pg.text_content("#spReport") and "not found in Status of Funds" in pg.text_content("#spReport"), "spend plan: ' aviation ' matches SOF 'Aviation'; unmatched 'Fuel' listed in the drawer")
        check(pg.is_hidden("#spDemo"), "single spend: real plan, no demo tag")
        go(pg, "aftp")
        check(pg.is_visible('[data-nodata="aftp"]') and pg.evaluate("CMD.mods.aftp.hasData()") is False and "coming soon" in pg.text_content("#afReport"), "single AFTP: no data and no upload yet (quiet drawer note)")
        go(pg, "home")
        if dopen: pg.click("#btnInfo"); pg.wait_for_timeout(300)
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
        blk["pr"]["asOf"] = "2026-10-01T17:00:00.000Z"; blk["spend"]["asOf"] = "2026-10-15T17:00:00.000Z"
        t = t.split('<script id="commandSaved" type="application/json">')[0] + '<script id="commandSaved" type="application/json">' + json.dumps(blk).replace("<", "\\u003c") + "</script>" + t.split('<script id="commandSaved" type="application/json">')[1].split("</script>", 1)[1]
        open(saved, "w", encoding="utf-8").write(t)
        # saved Obligation is used as stored, never recalculated: bump one stored Obligation and it shows up as is
        blk2 = json.loads(json.dumps(blk)); oi = blk2["sof"]["headers"].index("Obligation"); blk2["sof"]["rows"][0][oi] = blk2["sof"]["rows"][0][oi] + 1000
        check(blk2["sof"].get("oblCalculated") is True and blk2["sof"]["headers"][-2:] == ["Total Expenditure", "Disbursement"], "save: marks Obligation as already calculated")
        st = t.split('<script id="commandSaved" type="application/json">'); savedT = os.path.join(tmp, "tamper.html")
        open(savedT, "w", encoding="utf-8").write(st[0] + '<script id="commandSaved" type="application/json">' + json.dumps(blk2).replace("<", "\\u003c") + "</script>" + st[1].split("</script>", 1)[1])
        pg = page_new(); pg.goto("file://" + savedT); pg.wait_for_timeout(1500); go(pg, "sof")
        check(abs(tot("obl") - round(OBL + 1000, 2)) < 0.01, "saved: stored Obligation used as is (not recalculated)")
        pg.close()
        pg = page_new(); pg.goto("file://" + saved); pg.wait_for_timeout(1500)
        body = pg.inner_text("body")
        check(pg.is_visible("#homeOverview") and not re.search(r"REAL DATA|contains real|restricted|fictional", body, re.I), "saved: opens with data, no banner")
        check("01 Oct 2026" in pg.inner_text("#oPr") and today in pg.inner_text("#oSof"), "saved: original data-as-of dates kept per section")
        go(pg, "sof")
        check(abs(tot("obl") - OBL) < 0.01 and money(abs(BAL)) in kt("bal") and money(round(TE, 2)) in kt("te") and "-$" not in kt("te"), "saved: amounts not flipped twice")
        go(pg, "pr")
        check("01 Oct 2026" in pg.inner_text("#asof-pr"), "saved: PR page keeps its date")
        ks = pg.evaluate("CMD.mods.pr._state.ks")
        check(pg.evaluate("CMD.mods.pr._state.items.length") == 4 and pg.evaluate("CMD.mods.pr._state.typed") and ks["notInKey"] == 3 and ks["untyped"] == 1, "saved: key, type split and left-out counts survive Save with data")
        check(pg.is_visible("#prTypes") and "M. Smith-Jones" in pg.inner_text("#tPr"), "saved: display names and WHST/Safety shown")
        go(pg, "spend"); check("15 Oct 2026" in pg.inner_text("#asof-spend") and pg.evaluate("CMD.mods.spend._state.own.rows.length") == 24 and pg.is_hidden("#spDemo"), "saved: spend plan kept with its Data-as-of date")
        go(pg, "pr")
        # a viewer updates L4 in the saved copy, then saves again
        pg.set_input_files("#fileInput", [p4b]); pg.wait_for_timeout(1500)
        L4n = pg.evaluate("CMD.mods.pr._state.items.filter(function(i){return i.level===4}).length")
        check(pg.evaluate("CMD.mods.pr._state.ks.notInKey") == 3, "saved + new L4: left-out count kept")
        check(L4n == 2 and today in pg.inner_text("#asof-pr"), "saved: new L4 replaces the old one; PR date updated")
        check(pg.evaluate("CMD.mods.fuel._state.aasfs.length") == 2, "saved: other pages kept after an upload")
        check(pg.evaluate("CMD.mods.spend._state.own && CMD.mods.spend._state.own.rows.length") == 24 and pg.evaluate("CMD.mods.spend._state.own.files[0]") == "Spend Plan.xlsx", "saved: spend plan kept")
        with pg.expect_download() as dl: pg.click("#btnInfo"); pg.click("#btnSave")
        saved2 = os.path.join(tmp, "second.html"); dl.value.save_as(saved2)
        pg.close()
        pg = page_new(); pg.goto("file://" + saved2); pg.wait_for_timeout(1500); go(pg, "sof")
        check(abs(tot("obl") - OBL) < 0.01 and money(round(TE, 2)) in kt("te") and pg.evaluate("document.querySelectorAll('#commandSaved').length") == 1, "saved twice: still not flipped twice, one data block")
        pg.close()
        # a funds export without commitment_amt_cum is rejected with a clear message
        pg = page_new(); pg.goto("file://" + SINGLE); pg.wait_for_timeout(1000)
        pg.set_input_files("#fileInput", [bad_x]); pg.wait_for_timeout(1500)
        pg.click("#btnInfo"); pg.wait_for_timeout(300)
        check("Missing commitment_amt_cum (Total Expenditure)" in pg.text_content("#drawer") and pg.evaluate("CMD.mods.sof.hasData()") is False, "SOF: export without commitment_amt_cum rejected with a clear message")
        pg.close()
        check(not net, "no network requests " + str(net[:3]))
        check(not errors, "no console errors " + str(errors[:3]))
        b.close()

run()
print("FAILED: %d" % len(FAILS) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
