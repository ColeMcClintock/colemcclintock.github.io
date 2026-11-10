#!/usr/bin/env python3
"""Generate ONLY fictional OWI demonstration records and genuinely blank templates."""
import datetime as dt,json,random,shutil
from pathlib import Path
import openpyxl
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.comments import Comment
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'dashboards/owi';rng=random.Random(734)
FY=dt.date.today().year+(dt.date.today().month>=10)
HEAD=['Soldier Name','Rank (grade)','Age','Duty Status','Battalion','MSC','DY','Home of Record','State','PEBD','DOB','Incident Date']
towns=[('Des Moines','IA'),('Ames','IA'),('Cedar Rapids','IA'),('Boone','IA'),('Carroll','IA'),('Adel','IA'),('Perry','IA'),('Winterset','IA'),('Omaha','NE'),('Des Moines','WA'),('Demo Unlisted Town','IA')]
ranks=[('SPC',23),('SPC',22),('CPL',24),('SGT',28),('SSG',33),('SFC',38),('PV2',19),('PFC',20),('WO1',30),('CW2',36),('1LT',27),('CPT',34),('MAJ',43)]
rows=[]
for i in range(96):
 fy=FY-1 if i<72 else FY
 start=dt.date(fy-1,10,1);end=min(dt.date(fy,9,30),dt.date.today()-dt.timedelta(days=1));span=max(1,(end-start).days)
 d=start+dt.timedelta(days=rng.randrange(span));rank,age=ranks[i%len(ranks)];town,state=towns[i%len(towns)]
 msc='Demo MSC '+('Alpha' if i%3<2 else 'Bravo');bn='Demo Battalion '+('A' if i%3==0 else 'B' if i%3==1 else 'C')
 rows.append([f'Demo Soldier {i+1:03d} — Fictional',rank,age,['M-Day / drilling','AGR','M-Day / drilling','ADOS','Title 10'][i%5],bn,msc,str(fy),town,state,f'{d.year-max(1,age-20)}-01-15','',d.isoformat()])
strength=[['MSC','Battalion','Strength'],['Demo MSC Alpha','',1200],['Demo MSC Alpha','Demo Battalion A',600],['Demo MSC Alpha','Demo Battalion B',600],['Demo MSC Bravo','',800],['Demo MSC Bravo','Demo Battalion C',800]]
(OUT/'data/demo.js').write_text('/* ALL NAMES, UNITS AND STRENGTHS ARE FICTIONAL DEMONSTRATION DATA. Stripped from standalone downloads. */\nwindow.OWI_DEMO='+json.dumps({'incidents':[HEAD]+rows,'strength':strength},separators=(',',':'))+';\n')
def template(file,head,notes):
 wb=openpyxl.Workbook();ws=wb.active;ws.title='OWI '+('Strength Key' if 'strength' in file else 'Incidents');ws.append(head);ws.freeze_panes='A2';ws.auto_filter.ref=f'A1:{openpyxl.utils.get_column_letter(len(head))}1'
 for c in ws[1]:
  c.font=Font(name='Calibri',bold=True,color='FFFFFF');c.fill=PatternFill('solid',fgColor='2563EB');c.alignment=Alignment(wrap_text=True);ws.column_dimensions[c.column_letter].width=max(18,len(c.value)+3)
  if c.value in notes:c.comment=Comment(notes[c.value],'Template guidance')
 ws.row_dimensions[1].height=32;wb.save(OUT/file);shutil.copyfile(OUT/file,ROOT/'downloads'/file.replace('_','-'))
notes={'Soldier Name':'One row per incident. Keep the completed workbook and saved HTML only in approved, access-controlled storage. Do not include SSNs.','DY':'Training year: Oct–Sep. For example TY2027 is Oct 2026 through Sep 2027.','Incident Date':'Expected: actual incident date (Excel date or YYYY-MM-DD). Timing panels stay empty when dates are unavailable.','DOB':'Optional. Used ONLY if Age is blank, then discarded; never saved or displayed.','Age':'Age as entered takes priority over DOB.','PEBD':'Date entered military service; PEBP is accepted as an alias. Years of service are calculated to Incident Date.','State':'Optional separate state field. Explicit non-Iowa HORs are never mapped. Town, IA is also accepted in Home of Record.'}
template('owi_template.xlsx',HEAD,notes)
template('owi_strength_template.xlsx',['MSC','Battalion','Strength'],{'MSC':'Exact MSC label from incident workbook (case-insensitive, trimmed). Blank allowed for units with no MSC.','Battalion':'Blank = MSC total. Otherwise a battalion within that MSC. MSC totals override battalion sums, never double counted.','Strength':'Positive whole-number assigned strength for the selected reporting period. No age/grade/duty roster denominator is inferred.'})
print('Generated 96 clearly fictional incidents; blank OWI and Strength Key templates.')
