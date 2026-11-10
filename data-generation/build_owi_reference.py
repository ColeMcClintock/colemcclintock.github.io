#!/usr/bin/env python3
"""Vendor public 2020 Census Iowa city populations/centers + 2023 Census county boundaries.
Usage: python build_owi_reference.py /tmp/owi-source
Input places.html: https://tigerweb.geo.census.gov/tigerwebmain/Files/bas26/tigerweb_bas26_incplace_2020_tab20_ia.html
Input county.zip: https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_20m.zip
No downloads occur in the dashboard. Boundaries are Census public-domain cartographic 1:20m.
"""
import sys,json,re,math,zipfile
from pathlib import Path
import shapefile
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1];src=Path(sys.argv[1]);out=ROOT/'dashboards/owi/data';out.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(src/'county.zip') as z:z.extractall(src/'counties')
r=shapefile.Reader(str(src/'counties/cb_2023_us_county_20m.shp'));cs=[s for s in r.iterShapeRecords() if s.record['STATEFP']=='19']
x0=min(c.shape.bbox[0] for c in cs);y0=min(c.shape.bbox[1] for c in cs);x1=max(c.shape.bbox[2] for c in cs);y1=max(c.shape.bbox[3] for c in cs)
scale=936/((x1-x0)*math.cos(math.radians(42)));h=round((y1-y0)*scale+24)
def xy(lon,lat):return [round(12+(lon-x0)*math.cos(math.radians(42))*scale,2),round(12+(y1-lat)*scale,2)]
def rings(shape):
 p=list(shape.parts)+[len(shape.points)];return [list(shape.points[a:b]) for a,b in zip(p[:-1],p[1:])]
def inside(pt,ring):
 x,y=pt;odd=False;j=len(ring)-1
 for i in range(len(ring)):
  a,b=ring[i],ring[j]
  if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:odd=not odd
  j=i
 return odd
counties=[]
for c in cs:
 d=''.join('M'+' '.join(','.join(map(str,xy(*pt))) for pt in ring)+'Z' for ring in rings(c.shape));counties.append({'name':c.record['NAME'],'path':d,'fips':c.record['GEOID']})
t=BeautifulSoup((src/'places.html').read_text(),'html.parser').find('table').find_all('tr');hdr=[c.get_text(strip=True) for c in t[0].find_all(['th','td'])];towns={}
for row in t[1:]:
 v=[c.get_text(strip=True) for c in row.find_all(['td','th'])]
 if len(v)!=len(hdr):continue
 d=dict(zip(hdr,v));name=d['BASENAME'];pop=int(d['POP100']);lat,lon=float(d['INTPTLAT']),float(d['INTPTLON']);county=None
 for c in cs:
  if c.shape.bbox[0]<=lon<=c.shape.bbox[2] and c.shape.bbox[1]<=lat<=c.shape.bbox[3] and sum(inside((lon,lat),ring) for ring in rings(c.shape))%2:county=c.record['NAME'];break
 k=re.sub(r'[^a-z0-9]','',name.lower());towns[k]={'name':name,'pop':pop,'xy':xy(lon,lat),'county':county}
geo={'w':960,'h':h,'counties':counties,'towns':towns,'sources':{'places':'https://tigerweb.geo.census.gov/tigerwebmain/Files/bas26/tigerweb_bas26_incplace_2020_tab20_ia.html','counties':'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_20m.zip'},'populationYear':2020,'note':'County assignment uses the Census town internal point, not incident location. Incorporated places only; unincorporated HORs remain Unmatched.'}
(out/'iowa_reference.js').write_text('/* Public-domain US Census reference data, no soldier records. */\nwindow.OWI_GEO='+json.dumps(geo,separators=(',',':'))+';\n')
print(len(towns),'cities;',len(counties),'counties;',sum(t['county'] is None for t in towns.values()),'town centers without county match')
