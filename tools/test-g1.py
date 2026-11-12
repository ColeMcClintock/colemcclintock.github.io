#!/usr/bin/env python3
"""G1 dashboard browser regression suite. All fixtures are fictional; file:// only, no network.
Run with /workspace/.venv/bin/python tools/test-g1.py after tools/build-standalone.py.
SHOTS=/workspace writes g1-{home,sof,spend,fh,pr,esgr}.png.
"""
import datetime as dt, json, os, re, tempfile
from pathlib import Path
import openpyxl
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];TMP=Path(tempfile.mkdtemp(prefix='g1-test-'));SHOTS=os.environ.get('SHOTS','')
FAIL=[];PASS=[]
def check(ok,msg):
 print(('PASS ' if ok else 'FAIL ')+msg,flush=True)
 (PASS if ok else FAIL).append(msg)
def xlsx(name,grid):
 wb=openpyxl.Workbook();ws=wb.active
 for r in grid:ws.append(r)
 p=TMP/name;wb.save(p);return str(p)
def amount(s):return float(s.replace('$','').replace(',',''))
FY=str(dt.date.today().year+(dt.date.today().month>=10));Y=int(FY)-1
ACCTS=['Funeral Honors','Funeral Honors Stipends','ESGR','Retention','Personnel Ops']
H=['contract_doc_no','commitment_item_fipex','functional_area_farea','appropriation_type','fiscal_year','fiscal_month','commitment_amt_cum','disbursement_amt_cum','obligation_amt_cum','ssn']
RECS=[['FAKE-1','CI-A','FAKE-FH','OMNG',FY,1,-300,-200,-999999,'999-00-1111'],['FAKE-2','CI-B','FAKE-FHS','OMNG',FY,2,-200,-150,-999999,'999-00-1111'],['FAKE-3','CI-B','FAKE-ESGR','OMNG',FY,1,-400,-300,-999999,'999-00-1111'],['FAKE-4','CI-A','FAKE-RET','OMNG',FY,2,-100,-120,-999999,'999-00-1111'],['FAKE-5','ALLOBJ','FAKE-FH','OMNG',FY,1,-999999,-999999,-999999,'999-00-1111']]
sof=xlsx('G1 Funds.xlsx',[H]+RECS)
fund=xlsx('G1 Funding.xlsx',[['Fiscal Year','Account','TDP','AFP','Reservations']]+[[FY,a,1000,900,999] for a in ACCTS])
key=xlsx('G1 Account Key.xlsx',[['Functional Area','Account','Sag','MDEP']]+[[fa,a,'FAKE','G1XX'] for fa,a in zip(['FAKE-FH','FAKE-FHS','FAKE-ESGR','FAKE-RET','FAKE-OPS'],ACCTS)])
ci=xlsx('G1 CI Key.xlsx',[['Commitment Item','Description'],['CI-A','Program support'],['CI-B','Program support']])
months=['October','Nov','December','Jan','February','Mar','April','May','June','Jul','Aug','Sept']
plan=xlsx('G1 Spend Plan.xlsx',[['G1 plan (fictional)'],[],['Account']+months,[' funeral HONORS ','$290.00',0,0,0,0,0,0,0,0,0,0,0],['ESGR',400,0,0,0,0,0,0,0,0,0,0,0],['FAKE Unmatched',100,0,0,0,0,0,0,0,0,0,0,0],['Total',790,0,0,0,0,0,0,0,0,0,0,0]])
PRH=['Cardholder Name','Purchase requisition','Merchant / Description','Short Text','Total Value']
prs=[]
for level in range(1,5):
 rows=[['avery.m.alpha@example.invalid',f'FAKE-PR-{level}','Fictional Seller','Low item',10],['avery.m.alpha@example.invalid',f'FAKE-PR-{level}','Fictional Seller','High item',20],['blake.bravo',f'FAKE-TIE-{level}','Fictional Seller','First equal item',15],['blake.bravo',f'FAKE-TIE-{level}','Fictional Seller','Second equal item',15],['not.in.key',f'FAKE-EXCLUDED-{level}','Fictional Seller','Must be excluded',200]]
 prs.append(xlsx(f'L{level}.xlsx',[PRH]+rows))
ck=xlsx('G1 Cardholders.xlsx',[['Cardholder','Display Name','Type'],['Avery Alpha','A. Alpha',''],['blake.x.bravo@example.invalid','','WHST']])
stip=xlsx('Stipends.xlsx',[['Fictional G1 stipends'],[],[],['Retiree','Date of service','Cage code','Status','Ignored'],['Jordan Alpha',dt.datetime(Y,10,4),'FAKE-CAGE-A','Review pending','DO-NOT-READ-STIP'],['Taylor Bravo',f'10/05/{Y}','FAKE-CAGE-B','PAID','DO-NOT-READ-STIP'],['Grand Total',None,None,None,None]])
duty=xlsx('MFH Duty.xlsx',[['MFH fictional'],[],['Name','Date performed','UIC','Status'],['SGT Alex Alpha',dt.datetime(Y,10,7),'FAKE-UIC-A','CALENDAR SUBMITTED'],['CPT Blake Bravo',f'{Y}-10-08','FAKE-UIC-A','not started'],['SPC Casey Charlie',f'{Y}-11-03','FAKE-UIC-B','Pay submitted'],['SPC Drew Delta',f'{Y}-11-04','FAKE-UIC-B','Other']])
DTSH=['Approved date','Last name','First name','TANUM','Departure Date','Location/Destination','Total Obligation ($)','Ignore this','SSN']
dts=xlsx('DTS.xlsx',[[f'Junk line {i}'] for i in range(1,10)]+[DTSH,[dt.datetime(Y,10,1),'SMITH','JOHN','FAKE-TANUM-001',dt.datetime(Y,10,10),'Fictional City A','$1,250.50','DO-NOT-READ-DTS','999-00-1111'],[f'10/02/{Y}',"O'BRIEN",'ANNE-MARIE','FAKE-TANUM-002',f'10/15/{Y}','Fictional City B',200,'DO-NOT-READ-DTS','999-00-1111'],[f'{Y}-11-01','DEMO, SAM','','FAKE-TANUM-001',f'{Y}-11-10','Fictional City A',50,'DO-NOT-READ-DTS','999-00-1111']])
files=[sof,fund,key,ci,plan]+prs+[ck,stip,duty,dts]
# Templates are G1-only and appropriately blank
for name,headers in [('g1_accountkey_template.xlsx',['Functional Area','Account','Sag','MDEP']),('g1_cikey_template.xlsx',['Commitment Item','Description']),('g1_funding_template.xlsx',['Fiscal Year','Account','TDP','AFP']),('g1_cardholder_key_template.xlsx',['Cardholder','Display Name']),('g1_stipends_template.xlsx',['Retiree','Date of service','Cage code','Status']),('g1_mfh_duty_template.xlsx',['Name','Date performed','UIC','Status'])]:
 ws=openpyxl.load_workbook(ROOT/'dashboards/g1'/name).active
 check([ws.cell(1,i+1).value for i in range(len(headers))]==headers and not any(ws.cell(2,i+1).value is not None for i in range(len(headers))),name+': separate G1 blank schema')
check(openpyxl.load_workbook(ROOT/'dashboards/g1/g1_dts_sample.xlsx').active.cell(10,1).value=='Approved date','fake DTS sample has 9 junk rows')
check('G1-Dashboard-*.html' in (ROOT/'.gitignore').read_text() and '|g1' in (ROOT/'tools/pre-commit-guard.sh').read_text(),'G1 saved-copy ignore and guard')
check('id="g1"' in (ROOT/'index.html').read_text() and 'downloads/g1-dashboard.html' in (ROOT/'index.html').read_text(),'portfolio G1 card and standalone download')
for f in ['accountkey','cardholder-key','cikey','funding','spendplan','stipends','mfh-duty']:
 check((ROOT/'downloads'/('g1-'+f+'-template.xlsx')).exists(),'G1 public template download '+f)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
 errors=[];net=[]
 def new():
  pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(e.stack));pg.on('console',lambda m:errors.append(m.text) if m.type=='error' else None);pg.on('request',lambda r:net.append(r.url) if not r.url.startswith(('file:','data:','blob:')) else None);return pg
 def go(pg,route):pg.evaluate('(h)=>{location.hash="#/"+h}',route);pg.wait_for_timeout(300)
 pg=new();pg.goto((ROOT/'dashboards/g1/index.html').as_uri());pg.wait_for_timeout(900)
 check(pg.title()=='G1 Dashboard' and pg.locator('#tiles .tile').count()==5,'hosted home and five icon tiles')
 check(all(x in pg.inner_text('#tiles') for x in ['Status of Funds','Spend Plans','Funeral Honors','PR Tracker','ESGR']),'home tab titles')
 check(pg.is_visible('#g1Intro') and pg.is_hidden('#drawer'),'big overview and discreet closed drawer')
 for route in ['home','sof','spend','fh','pr','esgr']:
  go(pg,route);check(pg.is_visible('#page-'+route),'hosted '+route+' tab renders')
  if SHOTS:pg.screenshot(path=str(Path(SHOTS)/('g1-'+route+'.png')),full_page=True)
 check(pg.evaluate('G1.mods.sof.summary().fy')==FY,'SOF defaults current FY')
 check(pg.evaluate('G1.mods.pr._state.typed') is False and pg.locator('#prType').count()==0 and 'TYPE' not in pg.inner_text('#tPr thead').upper(),'PR has no Type split')
 check(pg.evaluate('G1.programs.accountData("fh",G1.currentFy()).list.map(x=>x.name).sort()')==['Funeral Honors','Funeral Honors Stipends'],'FH selects all and only Funeral Honors accounts')
 check(pg.evaluate('G1.programs.accountData("esgr",G1.currentFy()).list.map(x=>x.name)')==['ESGR'],'ESGR selects only ESGR accounts')
 check(pg.evaluate('G1.PROGRAM_ACCOUNT_MATCH.fh.test("FUNERAL HONORS STIPENDS") && G1.PROGRAM_ACCOUNT_MATCH.esgr.test("Other ESGR Account")'),'program matching constants case-insensitive and changeable')
 check(pg.evaluate('G1.programs.data("dts").length')==24,'demo DTS junk-line header parse')
 # standalone empty, full routing
 pg.close();pg=new();pg.goto((ROOT/'downloads/g1-dashboard.html').as_uri());pg.wait_for_timeout(600)
 check(pg.is_visible('#homeEmpty') and pg.evaluate('!window.G1_FUNDS_DEMO && !window.G1_DEMO'),'single-file opens empty; no demo in public standalone')
 pg.set_input_files('#fileInput',files);pg.wait_for_timeout(2000)
 check(pg.evaluate('G1.failed.length')==0,'all 13 uploaded workbooks recognized')
 kinds=pg.evaluate('Object.values(G1.mods).flatMap(m=>m.entries().map(e=>[m.id,e.kind]))')
 expected=[['sof','export'],['sof','funding'],['sof','key'],['sof','cikey'],['spend','plan12'],['pr','key'],['fh','stip'],['fh','duty'],['esgr','dts']]
 check(all(k in kinds for k in expected) and kinds.count(['pr','pr'])==4,'routing: SOF/funding/keys/plan/L1-L4/cardholder key/stipends/duty/DTS without collision')
 check(pg.is_hidden('#drawer') and pg.is_visible('#homeOverview'),'multi-upload opens overview, drawer stays closed')
 check('999-00-1111' not in pg.content() and pg.evaluate('typeof window.CMD')=='undefined','no SSNs in DOM and independent G1 global')
 go(pg,'sof')
 got=pg.evaluate('({te:G1.mods.sof.summary().te,tdp:G1.mods.sof.summary().tdp,bal:G1.mods.sof.summary().bal,obl:G1.mods.sof._state.recs.reduce((t,r)=>t+r.obl,0),disb:G1.mods.sof._state.recs.reduce((t,r)=>t+r.disb,0)})')
 check(got=={'te':1000,'tdp':5000,'bal':4000,'obl':230,'disb':770},'SOF TE/disbursement sign flip; obligation calculated; no Reservations; ALLOBJ removed')
 check(pg.input_value('#fFy')==FY,'uploaded SOF defaults current FY')
 check('ALLOBJ' not in pg.inner_text('body') and 'Reservations' not in pg.inner_text('body'),'no ALLOBJ or Reservations mentions on screen')
 check('Obligation' not in pg.inner_text('#kpis') and 'Total Expenditure' in pg.inner_text('#kpis'),'account-centric headline KPIs')
 check(pg.evaluate('G1.mods.sof._state.recs.every(r=>r.ciL==="Program support")'),'CI descriptions combined')
 check(pg.evaluate('G1.mods.sof._state.recs.some(r=>r.obl<0)'),'negative calculated obligation kept')
 go(pg,'spend')
 check(pg.is_hidden('#spDemo') and pg.input_value('#spFy')==FY,'real plan hides Demo data and assigned current FY')
 check(pg.evaluate('G1.mods.spend._state.own.rows.length')==36,'plan header row 3 found; Total skipped; values retained')
 m=pg.evaluate('G1.mods.spend.model().list.map(x=>[x.label,x.planned,x.a.reduce((a,b)=>a+b,0)])')
 check(['Funeral Honors',True,300] in m and ['Funeral Honors Stipends',False,200] in m,'plan account trimmed/case-insensitive; no-plan SOF accounts retained')
 check(pg.evaluate('G1.mods.spend.unmatched()')==['FAKE Unmatched'],'unmatched plan account drawer list')
 check(abs(sum(x[2] for x in m)-got['te'])<.001,'Spend Plans actuals reconcile to SOF TE')
 check(pg.evaluate('[.049,-.049,.07,-.07,.12,-.12].map(G1.varClass)')==['g','g','y','y','r','r'],'variance colors both signs')
 pg.click('#spMode [data-m=cum]');pg.wait_for_timeout(200)
 check(pg.evaluate('DashKit.charts.cSpend.data.datasets[1].data[1]')==1000,'cumulative actuals')
 go(pg,'fh')
 check(pg.evaluate('G1.mods.fh._state.accounts.map(x=>x.name).sort()')==['Funeral Honors','Funeral Honors Stipends'],'uploaded FH account filter')
 check('$500.00' in pg.inner_text('#fhKpis') and '$2,000.00' in pg.inner_text('#fhKpis'),'FH account TE and funding context')
 check(pg.locator('#tstip tbody tr').count()==2 and 'PAID' in pg.inner_text('#tstip') and 'Review pending' in pg.inner_text('#stipCounts'),'stipends header row 4 found; statuses preserved')
 check(pg.evaluate('G1.programs.data("stip")[0].date')==f'{Y}-10-04','stipends Excel date parsed')
 check(pg.evaluate('G1.programs.data("duty").map(r=>r.status)')==['Calendar submitted','Not started','Pay submitted','Other'],'MFH known status matching case-insensitive; unknown retained')
 check(all(s in pg.inner_text('#dutyCounts') for s in ['Not started','Calendar submitted','Pay submitted']),'MFH status counts shown')
 check(pg.evaluate('DashKit.charts.cUic.data.labels')==['FAKE-UIC-A','FAKE-UIC-B'],'duties by UIC')
 pg.fill('#dutySearch','Casey');check(pg.locator('#tduty tbody tr').count()==1 and 'Casey' in pg.inner_text('#tduty tbody'),'MFH searchable table')
 pg.fill('#dutySearch','');pg.click('#tstip th[data-k=name]');check(pg.inner_text('#tstip tbody tr:first-child td:first-child')=='Jordan Alpha','stipends sortable table')
 pg.select_option('#fhMode','cum');pg.wait_for_timeout(200)
 check(pg.evaluate('DashKit.charts.cfhMon.config.type')=='line','Funeral Honors Monthly/Cumulative toggle')
 go(pg,'pr')
 items=pg.evaluate('G1.mods.pr._state.items.map(x=>[x.pr,x.val,x.desc,x.card])')
 check(len(items)==8 and all(x[1]==30 for x in items),'PR lines always summed, including equal-dollar lines')
 check(all(x[2]=='High item' for x in items if x[0].startswith('FAKE-PR')) and all(x[2]=='First equal item' for x in items if x[0].startswith('FAKE-TIE')),'PR description highest-value line, first tie')
 check(set(x[3] for x in items)=={'A. Alpha','Blake Bravo'},'Cardholder Key matching email formats and Display Name')
 check(pg.evaluate('G1.mods.pr._state.ks.notInKey')==4,'PR key excludes outsiders')
 check(pg.evaluate('G1.mods.pr._state.typed') is False and pg.locator('#prTypes').count()==0 and 'TYPE' not in pg.inner_text('#tPr thead').upper(),'Type column ignored; no split UI even with WHST in key')
 go(pg,'esgr')
 check(pg.evaluate('G1.mods.esgr._state.accounts.map(x=>x.name)')==['ESGR'] and '$400.00' in pg.inner_text('#esgrKpis'),'ESGR only account TE')
 D=pg.evaluate('G1.programs.data("dts")')
 check(len(D)==3 and pg.evaluate('G1.mods.esgr.entries()[0].headerRow')==10,'DTS reads header row 10 after 9 junk lines')
 check([r['name'] for r in D]==['John Smith',"Anne-Marie O'Brien",'Sam Demo'],'DTS name combining/proper case with apostrophe, hyphen, Last First comma layout')
 check(sum(r['amount'] for r in D)==1500.5 and '$1,500.50' in pg.inner_text('#dtsKpis'),'DTS currency amounts and total obligation KPI')
 check(pg.evaluate('DashKit.charts.cDtsMon.data.datasets[0].data.slice(0,2)')==[1450.5,50],'DTS obligation by approved month (not departure)')
 check(pg.locator('#tdts th').count()==6 and all(s in pg.inner_text('#tdts thead').upper() for s in ['NAME','TANUM','LOCATION']),'DTS keeps only approved/name/TANUM/departure/location/obligation')
 check('DO-NOT-READ' not in pg.content() and '999-00-1111' not in pg.content(),'other report columns ignored')
 check('repeat TANUM' in pg.text_content('#esgrReport') and pg.locator('#tdts tbody tr').count()==3,'duplicate TANUM rows kept and mentioned only in drawer')
 pg.fill('#dtsSearch','O\'Brien');check(pg.locator('#tdts tbody tr').count()==1 and "O'Brien" in pg.inner_text('#tdts tbody'),'DTS searchable');pg.fill('#dtsSearch','')
 # save and reopen (distinct G1 id, all keys and report records preserved)
 pg.click('#btnInfo')
 with pg.expect_download() as dl:pg.click('#btnSave')
 saved=TMP/dl.value.suggested_filename;dl.value.save_as(saved)
 check(re.match(r'G1-Dashboard-\d\d[A-Z][a-z]{2}\d\d\.html$',saved.name) is not None,'G1 save filename')
 text=saved.read_text();block=json.loads(text.split('<script id="g1Saved" type="application/json">')[1].split('</script>')[0])
 check('sof' in block and 'spend' in block and 'fh' in block and 'esgr' in block and '<script id="commandSaved"' not in text,'separate G1 saved block holds all modules')
 check('DO-NOT-READ' not in text and '999-00-1111' not in text and 'Not Key' not in text,'saved HTML contains no ignored/private columns')
 check(len(block['pr']['key']['rows'][0])==2,'saved G1 Cardholder Key has no Type')
 block['spend']['asOf']='2026-10-15T17:00:00.000Z';text=text.replace(re.search(r'<script id="g1Saved" type="application/json">(.*?)</script>',text,re.S).group(1),json.dumps(block));saved.write_text(text)
 pg.close();pg=new();pg.goto(saved.as_uri());pg.wait_for_timeout(800)
 check(pg.is_visible('#homeOverview') and pg.is_hidden('#drawer'),'G1 saved file opens populated without banner')
 check(pg.evaluate('G1.mods.sof.summary().te')==1000,'saved SOF not double-flipped/recalculated')
 go(pg,'spend');check(pg.evaluate('G1.mods.spend._state.own.rows.length')==36 and '15 Oct 2026' in pg.inner_text('#asof-spend'),'saved plan and Data-as-of preserved')
 go(pg,'fh');check(pg.locator('#tstip tbody tr').count()==2 and pg.locator('#tduty tbody tr').count()==4,'saved stipends and duties restored')
 go(pg,'esgr');check(pg.locator('#tdts tbody tr').count()==3 and 'John Smith' in pg.inner_text('#tdts'),'saved DTS restored')
 # same browser context, separate Aviation document: no key/funding leakage or saved-state restoration
 av=new();av.goto((ROOT/'dashboards/command/index.html').as_uri());av.wait_for_timeout(600)
 avbefore=av.evaluate('JSON.stringify(CMD.mods.sof.snapshot().key)')
 check(av.evaluate('typeof G1')=='undefined' and av.evaluate('CMD.source')=='demo','Aviation opens its own data, never G1 state')
 pg.set_input_files('#fileInput',[key]);pg.wait_for_timeout(800)
 check(av.evaluate('JSON.stringify(CMD.mods.sof.snapshot().key)')==avbefore and pg.evaluate('typeof CMD')=='undefined','loading G1 keys cannot change Aviation keys in another tab')
 check(set(pg.evaluate('Object.keys(localStorage)'))<={'g1-prsa-plan'} and 'g1-prsa-plan' not in pg.evaluate('JSON.stringify(Object.keys(localStorage))').replace('g1-prsa-plan','',1) and av.evaluate('typeof G1')=='undefined','only the G1 PRSA plan key may use localStorage; report data never stored')
 # malformed SOF rejection
 bad=xlsx('Bad Funds.xlsx',[[h for h in H if h!='commitment_amt_cum']]+[[v for h,v in zip(H,RECS[0]) if h!='commitment_amt_cum']])
 pg.set_input_files('#fileInput',[bad]);pg.wait_for_timeout(600)
 check('commitment_amt_cum' in pg.text_content('#loadReport') or 'Total Expenditure' in pg.text_content('#tFiles'),'missing TE column rejected with drawer explanation')

 # ---------------- Home accent colors + PRSA Planner ----------------
 c2=b.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
 def new2():
  q=c2.new_page();q.on('pageerror',lambda e:errors.append(e.stack));q.on('console',lambda m:errors.append(m.text) if m.type=='error' else None);q.on('request',lambda r:net.append(r.url) if not r.url.startswith(('file:','data:','blob:')) else None);return q
 hp=new2();hp.goto((ROOT/'dashboards/g1/index.html').as_uri());hp.wait_for_timeout(900)
 tc=hp.evaluate("Array.from(document.querySelectorAll('#tiles .tile')).map(t=>[t.dataset.go,getComputedStyle(t).getPropertyValue('--c').trim()])")
 check(len(tc)==5 and len({c for _,c in tc})==5,'five home tiles each have a distinct accent: '+str(tc))
 check(dict(tc)=={'sof':'#2563eb','pr':'#7c3aed','spend':'#0d9488','fh':'#be123c','esgr':'#ea580c'},'G1 accents follow Aviation style: SOF blue, PR purple, Spend teal, Funeral Honors rose, ESGR orange')
 same=hp.evaluate("['sof','pr','spend','fh','esgr'].every(p=>{const t=getComputedStyle(document.querySelector('#tiles [data-go='+p+']')).getPropertyValue('--c').trim();const pic=document.querySelector('#page-'+p+' .pagehead .pic');const card=document.querySelector('#homeOverview [class*=t-] , #homeOverview');return pic&&getComputedStyle(pic).getPropertyValue('--c').trim()===t;})")
 check(same,'each page header icon uses the same accent as its home tile')
 ov=hp.evaluate("Array.from(document.querySelectorAll('#homeOverview .pic')).map(e=>getComputedStyle(e).getPropertyValue('--c').trim())")
 check(len(ov)>=5 and len(set(ov))==len(ov),'overview card icons use distinct page accents: '+str(ov))
 if SHOTS:hp.screenshot(path=str(Path(SHOTS)/'g1-home-colors.png'),full_page=False)
 go(hp,'sof')
 check(hp.locator('#prsaPanel').count()==1 and not hp.evaluate('document.getElementById("prsaPanel").open'),'PRSA Planner is a collapsible section on SOF, closed by default')
 check(hp.evaluate('G1.prsa.accounts().map(a=>a.name)')==['PRSA Operations','PRSA Supplies','PRSA Travel'],'demo PRSA accounts auto-detected')
 check(hp.evaluate('G1.prsa.state().demo') and hp.evaluate('G1.prsa.state().rows.length')==5 and 'Demo plan' in hp.inner_text('#prsaSaved'),'fictional demo plan rows shown, not autosaved')
 check(hp.evaluate('G1.PROGRAM_ACCOUNT_MATCH.prsa.test("prsa ops") && !G1.PROGRAM_ACCOUNT_MATCH.prsa.test("Retention")'),'PRSA rule in program-account config, case-insensitive')
 hp.evaluate('document.getElementById("prsaPanel").open=true');hp.wait_for_timeout(300)
 if SHOTS:hp.set_viewport_size({'width':1440,'height':1250});hp.evaluate('scrollTo(0,document.getElementById("prsaPanel").getBoundingClientRect().top+scrollY-70)');hp.wait_for_timeout(400);hp.screenshot(path=str(Path(SHOTS)/'g1-prsa.png'))
 check(hp.evaluate('localStorage.getItem("g1-prsa-plan")') is None,'demo plan never written to browser storage')
 hp.close()
 PH=['contract_doc_no','commitment_item_fipex','functional_area_farea','appropriation_type','fiscal_year','fiscal_month','commitment_amt_cum','disbursement_amt_cum']
 psof=xlsx('PRSA Funds.xlsx',[PH,['FAKE-P1','CI-A','FAKE-PO','OMNG',FY,1,-300,-200],['FAKE-P2','CI-A','FAKE-PT','OMNG',FY,1,-100,-50],['FAKE-P3','CI-A','FAKE-PS','OMNG',FY,2,-50,-50],['FAKE-P4','CI-A','FAKE-RT','OMNG',FY,1,-75,-75]])
 pfund=xlsx('PRSA Funding.xlsx',[['Fiscal Year','Account','TDP','AFP'],[FY,'PRSA Operations',1000,900],[FY,'PRSA Travel',500,450],[FY,'prsa Supplies',300,250],[FY,'Retention',999,999]])
 pkey=xlsx('PRSA Key.xlsx',[['Functional Area','Account','Sag','MDEP'],['FAKE-PO','PRSA Operations','FAKE','G1XX'],['FAKE-PT','PRSA Travel','FAKE','G1XX'],['FAKE-PS','prsa Supplies','FAKE','G1XX'],['FAKE-RT','Retention','FAKE','G1XX']])
 DLG=[False];DLGN=[0]
 def ondlg(d):
  DLGN[0]+=1;d.accept() if DLG[0] else d.dismiss()
 sp=new2();sp.on('dialog',ondlg);sp.goto((ROOT/'downloads/g1-dashboard.html').as_uri());sp.wait_for_timeout(600)
 sp.set_input_files('#fileInput',[psof,pfund,pkey]);sp.wait_for_timeout(1500);go(sp,'sof');sp.evaluate('document.getElementById("prsaPanel").open=true');sp.wait_for_timeout(200)
 acc=sp.evaluate('G1.prsa.accounts().map(a=>[a.name,a.tdp,a.te,a.obl,a.disb,a.bal])')
 check(acc==[['PRSA Operations',1000,300,100,200,700],['prsa Supplies',300,50,0,50,250],['PRSA Travel',500,100,50,50,400]],'PRSA TDP, TE, Obligation, Disbursement, Balance per account; non-PRSA excluded: '+str(acc))
 check(sp.evaluate('G1.prsa.calc().available')==1350 and '$1,350.00' in sp.inner_text('#prsaKpis'),'pooled Available Balance = sum of PRSA TDP - TE')
 check(sp.evaluate('G1.prsa.state().rows.length')==0,'standalone starts with an empty plan (no demo rows)')
 sp.locator('#tPrsaAcct input[data-acct="prsa Supplies"]').uncheck();sp.wait_for_timeout(100)
 check(sp.evaluate('G1.prsa.calc().available')==1100 and sp.evaluate('G1.prsa.state().excluded')==['prsa Supplies'],'unticking an account removes it from the pool')
 sp.locator('#tPrsaAcct input[data-acct="prsa Supplies"]').check()
 def addrow(desc,amt,month='',status='Idea',acct='Pooled',cat=''):
  sp.click('#prsaAdd');r=sp.locator('#tPrsaPlan tbody tr').last
  r.locator('[data-f=desc]').fill(desc);r.locator('[data-f=amount]').fill(str(amt))
  if month:r.locator('[data-f=month]').select_option(str(month))
  r.locator('[data-f=status]').select_option(status);r.locator('[data-f=account]').select_option(acct)
  if cat:r.locator('[data-f=category]').select_option(cat)
 addrow('Fictional travel factor',400,3,'Planned','PRSA Travel','Travel');addrow('Fictional supplies',200,5,'Committed','Pooled','Supplies');addrow('Fictional contract what-if',900,'', 'Idea','Pooled','Contracts')
 m=sp.evaluate('G1.prsa.calc()')
 check(m['planned']==1500 and m['remaining']==-150,'running total: available - included projections = projected remaining')
 check(sp.locator('#prsaKpis .kpi.neg').count()==1 and 'neg' in sp.get_attribute('#prsaRemain','class'),'negative projected remaining turns red')
 check(m['status']['Planned']['inc']==400 and m['status']['Committed']['inc']==200 and m['status']['Idea']['inc']==900,'per-status subtotals')
 check(m['months'][0]==450 and m['months'][2]==50 and m['months'][4]==-150 and m['months'][11]==-150,'by-month projection (unscheduled deducted up front)')
 check(sp.evaluate('DashKit.charts.cPrsaMonth.data.datasets[0].backgroundColor[4]')=='#dc2626','negative months shown red on chart')
 sp.locator('#tPrsaPlan tbody tr').nth(2).locator('[data-f=include]').uncheck();sp.fill('#prsaAdjust','250');sp.wait_for_timeout(100)
 m=sp.evaluate('G1.prsa.calc()');check(m['planned']==600 and m['adjust']==250 and m['remaining']==1000,'Include toggle and Adjust available what-ifs')
 check(sp.locator('#prsaKpis .kpi.neg').count()==0,'positive remaining no longer red')
 sp.locator('#tPrsaPlan tbody tr').nth(1).locator('[data-act=up]').click()
 check(sp.evaluate('G1.prsa.state().rows.map(r=>r.desc)')==['Fictional supplies','Fictional travel factor','Fictional contract what-if'],'rows reorder')
 check(sp.evaluate('G1.prsa.state().rows[1].category')=='Travel' and sp.evaluate('G1.prsa.state().rows[1].month')==3 and sp.evaluate('G1.prsa.state().rows[1].account')=='PRSA Travel','row fields saved (account, category, month)')
 sp.evaluate('document.getElementById("prsaCats").closest("details").open=true');sp.fill('#prsaCats','Travel, Supplies, Contracts, Training, Other, Fictional Cat');sp.locator('#prsaCats').dispatch_event('change');sp.wait_for_timeout(100)
 check('Fictional Cat' in sp.inner_text('#tPrsaPlan tbody tr:first-child [data-f=category]'),'category dropdown options are editable')
 sp.wait_for_timeout(500);ls=json.loads(sp.evaluate('localStorage.getItem("g1-prsa-plan")') or '{}')
 check(len(ls.get('rows',[]))==3 and ls.get('adjust')==250 and 'Saved' in sp.inner_text('#prsaSaved'),'plan autosaves to localStorage g1-prsa-plan with Saved indicator')
 check('commitment' not in json.dumps(ls).lower() and 'FAKE-P1' not in json.dumps(ls),'only planning rows/settings stored, never SOF records')
 # delete (confirm) and cancel paths
 DLG[0]=False;sp.locator('#tPrsaPlan tbody tr').last.locator('[data-act=del]').click();check(DLGN[0]==1 and sp.evaluate('G1.prsa.state().rows.length')==3,'delete cancelled by confirm keeps row '+str(DLGN)+str(sp.evaluate('G1.prsa.state().rows.length')))
 DLG[0]=True;sp.locator('#tPrsaPlan tbody tr').last.locator('[data-act=del]').click();check(sp.evaluate('G1.prsa.state().rows.length')==2,'delete row')
 # reload: restored from localStorage, survives new SOF uploads
 sp.reload();sp.wait_for_timeout(700);check(sp.evaluate('G1.prsa.state().rows.length')==2 and sp.evaluate('G1.prsa.state().adjust')==250,'plan restored from localStorage after reload')
 sp.set_input_files('#fileInput',[psof,pfund,pkey]);sp.wait_for_timeout(1500);go(sp,'sof')
 check(sp.evaluate('G1.prsa.state().rows.length')==2,'loading SOF files never wipes the plan')
 # export -> clear -> import
 sp.evaluate('document.getElementById("prsaPanel").open=true')
 with sp.expect_download() as dl:sp.click('#prsaExport')
 xp=TMP/dl.value.suggested_filename;dl.value.save_as(xp);wbx=openpyxl.load_workbook(xp)
 check(re.match(r'G1-PRSA-Plan-\d\d[A-Z][a-z]{2}\d\d\.xlsx$',xp.name) and [c.value for c in wbx['PRSA Plan'][1]][:9]==['Order','Description / Planning factor','Account','Category','Amount','Target month','Status','Include','Notes'] and wbx['PRSA Plan'].max_row==3,'Export plan writes xlsx (plan + settings sheets)')
 DLG[0]=False;sp.click('#prsaClear');check(sp.evaluate('G1.prsa.state().rows.length')==2,'Clear plan requires confirmation')
 DLG[0]=True;sp.click('#prsaClear');sp.wait_for_timeout(400)
 check(sp.evaluate('G1.prsa.state().rows.length')==0 and json.loads(sp.evaluate('localStorage.getItem("g1-prsa-plan")'))['rows']==[],'Clear plan empties page and browser copy')
 sp.set_input_files('#prsaFile',str(xp));sp.wait_for_timeout(600)
 check(sp.evaluate('G1.prsa.state().rows.map(r=>[r.desc,r.amount,r.month,r.status,r.include])')==[['Fictional supplies',200,5,'Committed',True],['Fictional travel factor',400,3,'Planned',True]] and sp.evaluate('G1.prsa.state().adjust')==250,'Import plan restores rows and settings')
 # Save with data embeds plan; fresh browser restores it
 sp.click('#btnInfo')
 with sp.expect_download() as dl:sp.click('#btnSave')
 ps=TMP/('prsa-'+dl.value.suggested_filename);dl.value.save_as(ps);ptext=ps.read_text()
 pblock=json.loads(ptext.split('<script id="g1Saved" type="application/json">')[1].split('</script>')[0])
 check(len(pblock.get('prsa',{}).get('rows',[]))==2,'Save with data embeds the PRSA plan in g1Saved')
 sp.close()
 c3=b.new_context(viewport={'width':1440,'height':1000});q=c3.new_page();q.on('request',lambda r:net.append(r.url) if not r.url.startswith(('file:','data:','blob:')) else None);q.goto(ps.as_uri());q.wait_for_timeout(800)
 check(q.evaluate('G1.prsa.state().rows.length')==2 and json.loads(q.evaluate('localStorage.getItem("g1-prsa-plan")'))['adjust']==250,'saved file restores the plan in a fresh browser and seeds autosave')
 # local newer than embedded: local wins; embedded newer: embedded wins
 newer=dict(pblock['prsa']);newer['rows']=newer['rows'][:1];newer['updatedAt']='2999-01-01T00:00:00.000Z';q.evaluate('(p)=>localStorage.setItem("g1-prsa-plan",JSON.stringify(p))',newer);q.reload();q.wait_for_timeout(700)
 check(q.evaluate('G1.prsa.state().rows.length')==1,'newer browser autosave wins over older embedded plan')
 older=dict(newer);older['updatedAt']='2000-01-01T00:00:00.000Z';q.evaluate('(p)=>localStorage.setItem("g1-prsa-plan",JSON.stringify(p))',older);q.reload();q.wait_for_timeout(700)
 check(q.evaluate('G1.prsa.state().rows.length')==2,'newer embedded plan wins over older browser autosave')
 c3.close();c2.close()
 check(not net,'zero network requests: '+str(net))
 check(not errors,'zero console errors: '+str(errors))
 b.close()
print(f'\n{len(PASS)} passed, {len(FAIL)} failed')
if FAIL:raise SystemExit(1)
