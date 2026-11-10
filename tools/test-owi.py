#!/usr/bin/env python3
"""OWI dashboard local regression tests. Fictional fixtures only. No network requests.
Run: /workspace/.venv/bin/python tools/test-owi.py. SHOTS=/workspace saves demo screenshots.
"""
import datetime as dt,json,os,re,tempfile,subprocess,zipfile
from pathlib import Path
import openpyxl
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];TMP=Path(tempfile.mkdtemp(prefix='owi-test-'));SHOTS=os.environ.get('SHOTS','');PASS=[];FAIL=[]
def check(ok,msg):
 print(('PASS ' if ok else 'FAIL ')+msg,flush=True);(PASS if ok else FAIL).append(msg)
def xlsx(name,grid):
 wb=openpyxl.Workbook();ws=wb.active
 for r in grid:ws.append(r)
 p=TMP/name;wb.save(p);return str(p)
FY=str(dt.date.today().year+(dt.date.today().month>=10));Y=int(FY)-1
H=[' SOLDIER NAME ','Rank (grade)','Age','Duty Status','Battalion','MSC','DY','Home of Record','State','PEBP','DOB','Incident Date','SSN','Unneeded field']
# Fictional names only, including sentinels that MUST NOT survive selective parsing.
R=[['Fictional Alpha','SPC',23,'M-Day','Demo BN A','Demo MSC A','TY'+FY,'Adel, IA','',f'{Y-4}-01-01','DO-NOT-READ-DOB',f'{Y}-10-03','999-00-1111','IGNORE-THIS-CELL'],
   ['Fictional Bravo','CPL','', 'AGR','Demo BN A','Demo MSC A',FY,'Ames','IA',f'{Y-6}-01-01',f'{Y-22}-01-01',dt.datetime(Y,10,4),'999-00-1111','IGNORE-THIS-CELL'],
   ['Fictional Charlie','SGT',28,'M-Day','Demo BN B','Demo MSC A',int(FY),'Boone, Iowa','',f'{Y-8}-01-01','DO-NOT-READ-DOB',f'{Y}-10-05','999-00-1111','IGNORE-THIS-CELL'],
   ['Fictional Delta','CW2',35,'ADOS','Demo BN C','Demo MSC B',FY,'Des Moines','WA',f'{Y-10}-01-01','',f'{Y}-10-06','999-00-1111','IGNORE-THIS-CELL'],
   ['Fictional Echo','E-4',24,'M-Day','Demo BN C','Demo MSC B',FY,'Demo Unlisted Town','IA',f'{Y-3}-01-01','',f'{Y}-10-07','999-00-1111','IGNORE-THIS-CELL'],
   ['Fictional Foxtrot','1LT',27,'AGR','Demo BN C','Demo MSC B',str(int(FY)-1),'Carroll','IA',f'{Y-5}-01-01','',f'{Y}-09-30','999-00-1111','IGNORE-THIS-CELL']]
incident=xlsx('OWI fictional.xlsx',[['Fictional OWI export'],[],[],H]+R+[['Total',None,None,None,None,None,None,None,None,None,None,None,None,None]])
strength=xlsx('Strength.xlsx',[['Fictional key'],[],['MSC','Battalion','Strength'],[' demo msc a ','',100],['Demo MSC A','Demo BN A',40],['Demo MSC A','Demo BN B',60],['Demo MSC B','',200],['Demo MSC B','Demo BN C',200]])
for name,head in [('owi_template.xlsx',H[:0]+['Soldier Name','Rank (grade)','Age','Duty Status','Battalion','MSC','DY','Home of Record','State','Address','City','ZIP Code','County','PEBD','DOB','Incident Date']),('owi_strength_template.xlsx',['MSC','Battalion','Strength'])]:
 ws=openpyxl.load_workbook(ROOT/'dashboards/owi'/name).active
 check([c.value for c in ws[1]]==head and ws.max_row==1,'blank template schema '+name)
check('OWI-Dashboard-*.html' in (ROOT/'.gitignore').read_text() and '|owi' in (ROOT/'tools/pre-commit-guard.sh').read_text(),'saved-copy ignore and embedded-data guard include OWI')
check('id="owi"' in (ROOT/'index.html').read_text(),'portfolio OWI card')
public=(ROOT/'downloads/owi-dashboard.html').read_text()
check('Demo Soldier 001' not in public and 'data-demo src=' not in public,'public standalone strips fictional soldier identities and demo fixture')
check('fetch(' not in (ROOT/'dashboards/owi/core.js').read_text() and 'localStorage' not in (ROOT/'dashboards/owi/owi.js').read_text(),'no runtime fetch or persistent incident storage')
# Guard is exercised in an isolated temporary repo, never staging any private data here.
guard=TMP/'guard';guard.mkdir();subprocess.run(['git','init','-q',str(guard)],check=True)
for fn,body in [('OWI-Dashboard-10Nov26.html','fictional test only'),('renamed.html','<script id="owi'+'Saved" type="application/json">{"v":1}</script>')]:
 (guard/fn).write_text(body);subprocess.run(['git','-C',str(guard),'add',fn],check=True)
 out=subprocess.run(['sh',str(ROOT/'tools/pre-commit-guard.sh')],cwd=guard,capture_output=True,text=True)
 check(out.returncode!=0 and 'BLOCKED' in out.stderr,'pre-commit guard rejects '+fn)
 subprocess.run(['git','-C',str(guard),'rm','--cached',fn],check=True,capture_output=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox']);ctx=b.new_context(viewport={'width':1440,'height':1000},accept_downloads=True);errors=[];net=[]
 def new(context=None):
  pg=(context or ctx).new_page();pg.on('pageerror',lambda e:errors.append(e.stack));pg.on('console',lambda m:errors.append(m.text) if m.type=='error' else None);pg.on('request',lambda r:net.append(r.url) if not r.url.startswith(('file:','data:','blob:')) else None);return pg
 def load(pg,paths):pg.set_input_files('#fileInput',paths);pg.wait_for_timeout(550)
 def ev(s):return pg.evaluate(s)
 pg=new();pg.goto((ROOT/'dashboards/owi/index.html').as_uri());pg.wait_for_timeout(800)
 check(pg.title()=='OWI Dashboard' and pg.is_visible('#demoTag'),'hosted preview labels fictional Demo data')
 check(pg.is_hidden('#strengthPanel') and pg.is_hidden('#drawer'),'Strength and info drawer hidden by default')
 check(ev('OWI.mods.owi._state.rows.every(r=>r.name.startsWith("Demo Soldier"))'),'all baked-in demo names are explicitly fictional')
 check(pg.locator('#map path').count()==99 and pg.locator('#map circle').count()>0,'99 vendored Iowa county boundaries plus town bubbles')
 check(ev('[9999,10000,49999,50000].map(OWI.api.sizeOf)')==['Small','Medium','Medium','Large'],'town population class boundaries 10,000 and 50,000')
 check(pg.input_value('#fTy')==FY,'current training year selected when present')
 check(abs(ev('OWI.api.peerRate')-13786/2402129*1000)<1e-10,'verified statewide DOT administrative numerator and denominator')
 check('NOT age-adjusted' in pg.inner_text('#rateNote') and ev('OWI_PEER.ageAdjusted') is False,'no fabricated age-standardization claim')
 check(ev('OWI_GEO.counts.incorporated')==942 and ev('OWI_GEO.counts.CDP')==86 and ev('Object.keys(OWI_GEO.zips).length')==1055 and ev('OWI_GEO.towns.desmoines.pop')==214133,'real 2020 Census town population table')
 if SHOTS:
  pg.screenshot(path=str(Path(SHOTS)/'owi-home.png'),full_page=True)
  for anchor,shot in [('geography','map'),('demographics','patterns'),('seasonPanel','timing'),('unitPanel','units')]:
   pg.locator('#'+anchor).scroll_into_view_if_needed();pg.screenshot(path=str(Path(SHOTS)/('owi-'+shot+'.png')))
  pg.locator('#btnStrength').click();pg.locator('#strengthPanel').scroll_into_view_if_needed();pg.screenshot(path=str(Path(SHOTS)/'owi-strength.png'));pg.click('#closeStrength')
  pg.locator('#tSoldiers tbody tr').first.click();pg.screenshot(path=str(Path(SHOTS)/'owi-detail.png'));pg.click('#detailClose')
  pg.evaluate('scrollTo(0,0)');pg.screenshot(path=str(ROOT/'assets/img/owi-thumb.png'))
 # Hosted Save uses the static shell, not fetch. New incidents replace demo and identities are not in the saved shell.
 load(pg,[incident,strength]);check(pg.is_hidden('#demoTag') and ev('OWI.source')=='file','real upload replaces demo and hides tag')
 check(ev('OWI.failed.length')==0 and ev('OWI.mods.owi.entries().map(e=>e.kind).sort()')==['incident','strength'],'multi-file routing recognizes incident workbook and Strength Key independently')
 check(ev('OWI.mods.owi._state.rows.length')==6,'find header row 4 and skip Total')
 check(ev('OWI.mods.owi._state.rows[0].grade')=='E4' and ev('OWI.mods.owi._state.rows[1].grade')=='E4','SPC / CPL map to E4')
 check(ev('OWI.mods.owi._state.rows[1].age')==22 and ev('OWI.mods.owi._state.rows[1].ageSource')=='DOB fallback','blank Age falls back to age at incident from DOB')
 check(ev('OWI.mods.owi._state.rows[0].age')==23 and ev('OWI.mods.owi._state.rows[0].yos')==4,'Age takes precedence; PEBP accepted for years service at incident')
 check(ev('OWI.mods.owi._state.rows.slice(0,5).every(r=>r.ty===OWI.currentFy())'),'TY-prefixed / numeric DY handled as training year')
 check(ev('OWI.mods.owi._state.rows[1].incident')==f'{Y}-10-04','Excel date serial parsed locally')
 check(ev('OWI.mods.owi._state.rows.map(r=>r.size)')==['Small','Large','Medium','Out of state','Unmatched','Medium'],'HOR size categories use Census values; explicit Washington state excluded')
 check(pg.locator('#map circle').count()==3,'map excludes non-Iowa, unmatched and filtered prior TY')
 check('Des Moines' not in pg.inner_text('#townList') and 'Demo Unlisted Town' in pg.inner_text('#loadReport'),'out-of-state same-named city not plotted; unmatched list drawer-only')
 check(ev('Array.from(document.querySelectorAll("#matrix tbody tr")).reduce((n,r)=>n+Number(r.lastElementChild.textContent),0)')==5,'age-grade matrix reconciles to filtered incident count')
 check(ev('Object.values(DashKit.charts).every(c=>c.data.datasets[0].data.reduce((a,b)=>a+b,0)===5)'),'HOR, TY and duty charts reconcile to filtered incidents')
 check('999-00-1111' not in pg.content() and ev('!JSON.stringify(OWI.mods.owi.snapshot()).includes("999-00-1111")'),'SSN values neither displayed nor saved')
 check(ev('!["DO-NOT-READ-DOB","IGNORE-THIS-CELL"].some(x=>JSON.stringify(OWI.mods.owi.snapshot()).includes(x))'),'selective parser never retains unused cells or age-prioritized DOB')
 check(ev('OWI.mods.owi._state.rows.every(r=>!("dob" in r)&&!("ssn" in r))'),'DOB not retained in parsed data model')
 check(pg.inner_text('#scopeCount')=='5' and '16.7' in pg.inner_text('#kpis'),'5 TY incidents / 300 assigned strength = 16.7 per 1,000')
 check(ev('OWI.api.denominator({})')==300,'MSC totals override battalion sums without double-counting')
 check('50.0' in pg.inner_text('#tBn') and 'Above' in pg.inner_text('#tBn'),'battalion per-1,000 rates and proxy comparison')
 check('Demo BN A' in pg.inner_text('#steps') and 'exceed' in pg.inner_text('#steps'),'commander steps identify battalions over proxy with valid strength')
 check(pg.is_hidden('#strengthPanel'),'no always-visible strength field in header')
 pg.click('#btnStrength');check(pg.is_visible('#strengthPanel') and pg.locator('#strengthRows input').count()==5,'Strength rows auto-populated and grouped by MSC')
 # Input changes must update denominators and saved settings.
 inp=pg.locator('#strengthRows input[data-msc="Demo MSC A"][data-bn=""]');inp.fill('150');inp.dispatch_event('change');check(ev('OWI.api.denominator({})')==350,'editable MSC strength updates overall denominator')
 inp=pg.locator('#strengthRows input[data-msc="Demo MSC A"][data-bn=""]');inp.fill('');inp.dispatch_event('change');check(ev('OWI.api.denominator({})')==300,'blank MSC strength falls back to complete battalion sum')
 inp=pg.locator('#strengthRows input[data-msc="Demo MSC A"][data-bn="Demo BN A"]');inp.fill('');inp.dispatch_event('change');check(ev('OWI.api.denominator({})') is None and 'add strength' in pg.inner_text('#tBn'),'incomplete battalion denominator gives counts only, add strength hint')
 inp=pg.locator('#strengthRows input[data-msc="Demo MSC A"][data-bn="Demo BN A"]');inp.fill('50');inp.dispatch_event('change');check(ev('OWI.api.denominator({})')==310,'complete battalion sum fallback restored')
 pg.click('#closeStrength')
 # Every filter affects every analytical panel.
 pg.select_option('#fMsc','Demo MSC A');check(pg.inner_text('#scopeCount')=='3' and pg.locator('#map circle').count()==3 and 'Demo MSC B' not in pg.inner_text('#tMsc'),'MSC filter updates KPIs, map and units')
 pg.select_option('#fBn','Demo BN A');check(pg.inner_text('#scopeCount')=='2' and 'Demo BN B' not in pg.inner_text('#tBn') and pg.locator('#map circle').count()==2,'Battalion filter applies throughout')
 check('40.0' in pg.inner_text('#kpis') and ev('OWI.api.denominator({msc:"Demo MSC A",bn:"Demo BN A"})')==50,'battalion-selected overall rate uses battalion strength, not MSC strength')
 pg.select_option('#fDuty','AGR');check(pg.inner_text('#scopeCount')=='1' and 'No duty denominator' in pg.inner_text('#kpis') and 'no duty denominator' in pg.inner_text('#tBn'),'Duty Status filter applies and suppresses unsupported rates')
 check(pg.locator('#map circle').count()==1 and '22' in pg.inner_text('#tSoldiers'),'duty filter also updates map and soldier table')
 pg.click('#reset');check(pg.inner_text('#scopeCount')=='6' and 'Select one TY' in pg.inner_text('#kpis'),'All TY totals are counts only, no multi-year annual rate')
 pg.select_option('#fTy',str(int(FY)-1));check(pg.inner_text('#scopeCount')=='1' and pg.locator('#map circle').count()==1 and 'Carroll' in pg.inner_text('#townList'),'TY filter affects map, KPIs, table and profile')
 pg.click('#reset');pg.fill('#search','Alpha');check(pg.locator('#tSoldiers tbody tr[data-i]').count()==1,'searchable soldier table')
 pg.locator('#tSoldiers tbody tr').first.click();check(pg.is_visible('#detail') and pg.inner_text('#detailName')=='Fictional Alpha' and 'Age source' in pg.inner_text('#detailBody'),'soldier drill-in contains record details and no prediction')
 pg.click('#detailClose');pg.fill('#search','');pg.locator('#tSoldiers th[data-k="name"]').click();check(ev('OWI.mods.owi._state.shown[0].name')=='Fictional Alpha','sortable soldier table')
 # Save from hosted folder works without runtime fetch.
 asof=ev('OWI.mods.owi.asOf.toISOString()');pg.click('#btnInfo')
 with pg.expect_download() as dl:pg.click('#btnSave')
 download=dl.value;saved=TMP/download.suggested_filename;download.save_as(saved)
 check(re.fullmatch(r'OWI-Dashboard-\d{2}[A-Z][a-z]{2}\d{2}\.html',download.suggested_filename) is not None,'Save with data uses OWI-Dashboard-DDMonYY.html')
 text=saved.read_text();check('<script id="owiSaved"' in text and '999-00-1111' not in text and 'IGNORE-THIS-CELL' not in text,'saved HTML contains isolated OWI snapshot, no SSN or ignored fields')
 check('DO-NOT-READ-DOB' not in text and 'Demo Soldier 001' not in text,'saved HTML includes neither raw DOB cells nor built-in demo soldier names')
 q=new();q.goto(saved.as_uri());q.wait_for_timeout(650)
 check(q.evaluate('OWI.mods.owi._state.rows.length')==6 and q.is_hidden('#demoTag'),'saved file reopens offline with uploaded incidents, demo hidden')
 check(q.evaluate('OWI.api.denominator({})')==310,'Save with data keeps edited strength fields')
 check(q.evaluate('OWI.mods.owi.asOf.toISOString()')==asof and 'Data as of' in q.inner_text('#asOf'),'saved Data-as-of survives reopen')
 # Save again: exactly one embedded state block.
 q.click('#btnInfo')
 with q.expect_download() as dl:q.click('#btnSave')
 twice=TMP/'second-saved.html';dl.value.save_as(twice);check(twice.read_text().count('<script id="owiSaved"')==1,'saving a saved file replaces, never duplicates embedded state')
 q.close();pg.close()
 pg=new();pg.goto((ROOT/'downloads/owi-dashboard.html').as_uri());pg.wait_for_timeout(500)
 check(pg.is_visible('#empty') and pg.is_hidden('#dashboard') and ev('!window.OWI_DEMO'),'standalone opens empty with no baked-in names')
 load(pg,incident);check('Add strength' in pg.inner_text('#kpis') and 'add strength' in pg.inner_text('#tBn'),'no strength file means counts only, not invented rate denominators')
 # Missing Incident Date must not turn DY year into an Excel serial date.
 no_date=xlsx('No date.xlsx',[['name','grade','age','duty status','battalion','MSC','DY','HOR','PEBD'],['Fictional Undated','SGT',26,'M-Day','Demo BN','Demo MSC',2027,'Adel, IA','2020-01-01']])
 load(pg,no_date);check('Add an Incident Date column' in pg.inner_text('#season') and ev('OWI.mods.owi._state.rows[0].incident')=='','missing date friendly empty state; DY 2027 stays a training year')
 # Aliases, junk first 29 rows, dates and out-of-state handling.
 edge=xlsx('Aliases.xlsx',[[f'Fictional junk {i}'] for i in range(29)]+[['Soldier','Grade','Age','Duty Status','Bn','MSC','TY','HOR','PEBD','OWI Date','DOB'],['Fictional Boundary','E-4',24,'M-Day','Demo Edge','Demo MSC',FY,'Des Moines, IA','2020-01-01',f'{Y}-10-01','DO-NOT-READ-DOB']])
 load(pg,edge);check(ev('OWI.mods.owi._state.rows.length')==1 and ev('OWI.mods.owi.entries()[0].headerRow')==30,'flexible headers found on row 30')
 check(ev('OWI.mods.owi._state.rows[0].grade')=='E4' and ev('OWI.mods.owi._state.rows[0].ty')==FY,'grade hyphens and OWI Date alias; Oct 1 training-year boundary')
 check(ev('["PV2","PFC","SPC","CPL","SGT","SSG","SFC","MSG","1SG","SGM","CSM","WO1","CW2","CW3","CW4","CW5","2LT","1LT","CPT","MAJ","LTC","COL"].map(OWI.api.grade)')==['E2','E3','E4','E4','E5','E6','E7','E8','E8','E9','E9','W1','W2','W3','W4','W5','O1','O2','O3','O4','O5','O6'],'Army rank-to-grade mapping across enlisted, warrant and officer ranks')
 check(ev('[17,20,21,24,25,29,30,34,35,39,40,null].map(OWI.api.ageBand)')==['17–20','17–20','21–24','21–24','25–29','25–29','30–34','30–34','35–39','35–39','40+','Unknown'],'age-bracket boundary handling')
 # Raw-column getter instrumentation proves DOB/SSN/extra cell values are not accessed.
 check(ev('''(()=>{let grid=[['Name','Grade','Age','Duty Status','MSC','Battalion','DOB','SSN','Extra'],['Fictional Read Audit','SPC',23,'M-Day','Demo MSC','Demo BN','PRIVATE-DOB','PRIVATE-SSN','PRIVATE-EXTRA']],reads=[];let src={rows:2,cols:9,get:(r,c)=>{if(r===1)reads.push(c);return grid[r][c]}};OWI.mods.owi.parse('incident',src,'audit',null,'audit');return ![6,7,8].some(c=>reads.includes(c))})()'''),'parser never reads SSN, ignored data or DOB values when Age present')
 legacy=xlsx('Legacy.xlsx',[['Soldier Name','Rank','Age','Duty Status','DY','HOR'],['Fictional Legacy','SGT',28,'M-Day',dt.datetime(Y,10,2),'Adel, IA']])
 load(pg,legacy);check(ev('OWI.mods.owi._state.rows[0].incident')==f'{Y}-10-02' and ev('OWI.mods.owi._state.rows[0].ty')==FY,'legacy full-date DY is incident-date fallback only')
 # Standalone template links remain downloadable without any external assets.
 check(pg.locator('a[download][href^="data:"]').count()>=2,'blank templates embedded in offline single-file dashboard')
 blankmsc=xlsx('Blank MSC.xlsx',[['Soldier Name','Rank','Age','Duty Status','Battalion','MSC','DY','HOR','Incident Date'],['Fictional No MSC','SPC',23,'M-Day','Demo Orphan','',FY,'Adel, IA',f'{Y}-10-03']])
 blankkey=xlsx('Blank MSC Strength.xlsx',[['MSC','Battalion','Strength'],['','Demo Orphan',100]])
 load(pg,[blankmsc,blankkey]);check(ev('OWI.api.denominator({})')==100 and '10.0' in pg.inner_text('#kpis'),'blank MSC uses battalion strength fallback')
 # Unknown schema rejected, previous valid data untouched.
 unknown=xlsx('Unknown.xlsx',[['Not','An','Incident','Schema'],['Fake','Fake','Fake','Fake']]);load(pg,unknown);check(ev('OWI.failed.length')==1 and ev('OWI.mods.owi._state.rows[0].name')=='Fictional No MSC','unknown workbook rejected without losing loaded data')
 # Excludes out-of-state even when the town has an Iowa namesake; sources don't fetch.
 check(ev('OWI.api.hor("Ames, NE","").size')=='Out of state' and ev('OWI.api.hor("Ames","Nebraska").ref') is None,'explicit non-IA town/state combinations excluded from map lookup')
 # Messy, FICTIONAL sample: every supported format, split fields and deliberate failures.
 messy_h=['Soldier Name','Grade','Age','Duty Status','Battalion','MSC','DY','HOR Address','Address','City','State','ZIP Code','County','PEBD','DOB','Incident Date','SSN']
 addrs=[{'hor':'123 Main St, Ankeny, IA 50023'},{'hor':'ANKENY IA'},{'hor':'Ankeny, Iowa'},{'hor':'Des Moines IA 50310-1234'},{'hor':'50023'},{'hor':'W Des Moines'},{'hor':'St. Charles'},{'hor':'Mt Pleasant'},{'hor':'Ft Dodge'},{'hor':'123 Demo Main St Ankeny IA 50023 USA'},{'hor':'  aNkEnY    iA   '},{'hor':'Ankney IA'},{'hor':'Des Moinse IA'},{'hor':'N Liberty'},{'hor':'E Peru'},{'hor':'S English'},{'hor':'Amana, Iowa'},{'hor':'W. Des-Moines'},{'hor':'Saint Charles'},{'hor':'Mount Pleasant'},{'hor':'Fort Dodge'},{'zip':'50023'},{'address':'123 Demo Main St','city':'Ankeny','state':'Iowa','zip':'50023','county':'Polk'},{'city':'Boone','zip':'50023'},{'zip':'50117'},{'hor':'12345 Demo Rd Ankeny IA'},{'hor':'123 Demo St Ankeny'},{'hor':'W Des Moines IA 50266'},{'city':'Ankeny'},{'zip':'52809'},
 {'hor':'123 Demo St, Omaha, NE 68102'},{'hor':'Des Moines, WA'},{'city':'Ankeny','zip':'68102'},
 {'hor':'Demo Unlisted Town IA'},{'zip':'50100'}, {'hor':'Ankeny IA'}]
 dvariants=[dt.datetime(2025,1,5),45662,45662.75,'1/5/2025','01/05/25','2025-01-05','5-Jan-25','05JAN2025','5 Jan 2025','January 5, 2025','20250105',20250105,'2025-01-05T23:30:00-06:00','1/5/2025 12:30 PM',dt.datetime(2025,1,5,23,30),'2025-01-05 00:00:00']
 messy_rows=[]
 for i,a in enumerate(addrs):
  age='' if i%3==0 else 23;pebd=['1/1/2020','01JAN2020','20200101',dt.datetime(2020,1,1)][i%4];dob=['05JAN2002','5-Jan-02',dt.datetime(2002,1,5),20020105][i%4] if age=='' else 'DO-NOT-READ-DOB'
  if i==1:pebd='PEBD-UNREADABLE'
  if i==3:dob='BIRTH-UNREADABLE'
  inc='DATE-UNREADABLE' if i==len(addrs)-1 else dvariants[i%len(dvariants)]
  messy_rows.append([f'Fictional Messy Soldier {i+1:02d}','SPC',age,'M-Day','Demo Messy BN','Demo Messy MSC',2025,a.get('hor',''),a.get('address',''),a.get('city',''),a.get('state',''),a.get('zip',''),a.get('county',''),pebd,dob,inc,'999-00-1111'])
 messy=xlsx('Fictional messy OWI.xlsx',[['FICTIONAL TEST SAMPLE ONLY'],[],messy_h]+messy_rows)
 load(pg,messy);rs=ev('OWI.mods.owi._state.rows');tally={k:sum(r['matchMethod']==k for r in rs) for k in ['ZIP','city','fuzzy','out of state','unmatched']}
 print('MESSY SAMPLE MATCH REPORT',json.dumps(tally),flush=True)
 check(len(rs)==36 and sum(r['ref'] is not None for r in rs)==31,'messy sample maps all 31 usable Iowa records; 3 non-Iowa and 2 deliberate unmatched stay off map')
 check(tally['fuzzy']==2 and tally['out of state']==3 and tally['unmatched']==2,'fuzzy typo matching plus precise out-of-state and unmatched reporting')
 check(all(r['ref'] for r in rs[:30]),'all requested free-text, ZIP-only, abbreviation, typo, CDP and split-column examples match')
 check(rs[23]['town']=='Ankeny' and rs[23]['matchMethod']=='ZIP','ZIP wins over inconsistent city in split columns')
 check(rs[24]['size']=='Unknown size' and rs[24]['ref']=='zip:50117','unincorporated postal locality plots without fabricating population')
 check(rs[16]['town']=='Amana' and rs[16]['size']=='Small','Census CDP maps with real 2020 population')
 check(rs[25]['town']=='Ankeny' and rs[25]['matchMethod']=='city','five-digit house number not mistaken for a ZIP')
 check(all(r['incident']=='2025-01-05' for r in rs[:-1]) and rs[-1]['incident']=='','35/36 messy incident dates parsed; intentional malformed value stays unknown')
 check(rs[0]['age']==23 and rs[0]['yos']==5 and rs[2]['yos']==5,'same robust date parser applies to DOB fallback and PEBD')
 check('DATE-UNREADABLE' in pg.inner_text('#loadReport') and 'PEBD-UNREADABLE' in pg.inner_text('#loadReport'),'unparsed incident/PEBD raw values and row numbers reported in drawer')
 check('BIRTH-UNREADABLE' not in pg.content() and 'DOB not retained' in pg.inner_text('#loadReport'),'invalid DOB noted by row, but private DOB value still discarded')
 check(all(x in pg.inner_text('#horMatchCounts') for x in ['Matched by ZIP:','by city:','fuzzy: 2','out of state: 3','unmatched: 2']),'drawer match report lists all five outcomes')
 check('Demo Unlisted Town IA' in pg.inner_text('#loadReport') and '50100' in pg.inner_text('#loadReport'),'unmatched raw HOR text available in drawer')
 plotted=ev(r'Array.from(document.querySelectorAll("#map circle title")).reduce((n,t)=>n+Number(t.textContent.match(/· (\d+) incidents/)[1]),0)')
 check(plotted==31 and pg.locator('#map circle').count()>10,'all matched messy records actually plot as offline Iowa bubbles')
 if SHOTS:
  pg.locator('#geography').scroll_into_view_if_needed();pg.evaluate('document.getElementById("toast").hidden=true');pg.screenshot(path=str(Path(SHOTS)/'owi-map-messy.png'))
 # Saved copies must retain reports, postal references and dates without DOB or SSN values.
 pg.click('#btnInfo')
 with pg.expect_download() as dl:pg.click('#btnSave')
 msaved=TMP/'messy-saved.html';dl.value.save_as(msaved);mq=new();mq.goto(msaved.as_uri());mq.wait_for_timeout(500)
 check(mq.evaluate('OWI.mods.owi._state.rows.filter(r=>r.ref).length')==31 and mq.evaluate('OWI.mods.owi._state.rows.filter(r=>r.incident).length')==35,'messy matches and parsed incident dates survive offline Save/reopen')
 check('DATE-UNREADABLE' in mq.inner_text('#loadReport') and 'BIRTH-UNREADABLE' not in msaved.read_text(),'saved diagnostic report survives without retaining raw DOB')
 mq.close();pg.click('#btnClose')
 # Every date alias works; US ordering unless first component >12; strict invalid days.
 for alias in ['Incident Date','Date of Incident','OWI Date','Arrest Date','Date','Event Date','Incident Date (MM/DD/YYYY)']:
  afile=xlsx('Alias '+alias.replace('/','-')+'.xlsx',[["Name","Rank","Age","Duty Status","HOR",alias],["Fictional Date Alias","SPC",23,"M-Day","50023","05JAN2025"]])
  load(pg,afile);check(ev('OWI.mods.owi._state.rows[0].incident')=='2025-01-05','incident date column alias '+alias)
 check(ev('["31/1/25","1/5/25","01/05/49","01/05/50","01/05/99","2025-02-30","32/1/25"].map(x=>OWI_PARSE.iso(OWI.api.date(x)))')==['2025-01-31','2025-01-05','2049-01-05','1950-01-05','1999-01-05','',''],'US date order, unambiguous D/M fallback, 1950 cutoff and invalid-date rejection')
 check(ev('["St Charles","Saint Charles","Mt Pleasant","Mount Pleasant","Ft Dodge","Fort Dodge","W Des Moines","West Des Moines","E Peru","East Peru","N Liberty","North Liberty","S English","South English"].map(x=>OWI_PARSE.normCity(x)).every((x,i,a)=>i%2===0||x===a[i-1])'),'all St/Mt/Ft/N/S/E/W abbreviation expansions normalize identically')
 check(ev('OWI.api.hor({city:"Ankeny",state:"Nebraska",zip:"50023"}).ref') is None,'explicit non-Iowa state/ZIP conflict stays off map')
 check(ev('OWI.api.hor({city:"Ankeny",state:"N/A"}).town')=='Ankeny','blank-like State cells do not prevent Iowa city matching')
 check(ev('OWI.api.hor("52808").state')=='IA','any ZIP inside 50001–52809 is recognized as Iowa even when no point exists')
 # Direct JS Date / SheetJS Date objects and timezone-sensitive date-time cells.
 for tz in ['America/Chicago','America/Los_Angeles','Asia/Tokyo']:
  tc=b.new_context(timezone_id=tz,viewport={'width':1280,'height':900});tp=new(tc);tp.goto((ROOT/'downloads/owi-dashboard.html').as_uri());tp.wait_for_timeout(200);load(tp,messy)
  check(tp.evaluate('OWI.mods.owi._state.rows.slice(0,-1).every(r=>r.incident==="2025-01-05")'),'SheetJS UTC calendar dates do not shift in '+tz)
  check(tp.evaluate('OWI.api.date(new Date("2025-01-05T00:00:00Z")).getDate()===5 && OWI.api.date(new Date(2025,0,5)).getHours()===12'),'Date objects normalized to calendar day/local noon in '+tz)
  tc.close()
 # Packaged folder version also works from file:// and saves without fetching.
 zdir=TMP/'zip';zipfile.ZipFile(ROOT/'downloads/owi-dashboard.zip').extractall(zdir)
 z=new();z.goto((zdir/'owi-dashboard/folder-version/index.html').as_uri());z.wait_for_timeout(500)
 check(z.is_visible('#empty'),'packaged folder-version opens empty offline')
 load(z,[incident,strength]);z.click('#btnInfo')
 with z.expect_download() as dl:z.click('#btnSave')
 zsave=TMP/'folder-saved.html';dl.value.save_as(zsave);check('<script id="owiSaved"' in zsave.read_text(),'packaged folder-version Save works without runtime fetch')
 z.close()
 check(len(net)==0,'zero network requests on file://, including upload, save and saved reopen')
 check(len(errors)==0,'no browser errors: '+str(errors))
 b.close()
print(f'\n{len(PASS)} passed; {len(FAIL)} failed. Fixtures kept in {TMP}')
if FAIL:raise SystemExit(1)
