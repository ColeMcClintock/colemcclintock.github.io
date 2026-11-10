#!/usr/bin/env python3
"""Vendor public 2020 Census Iowa city populations/centers + 2023 Census county boundaries.
Usage: python build_owi_reference.py /tmp/owi-source
Also requires cdp.html (same Census directory, cdp instead of incplace) and US.zip
from https://download.geonames.org/export/zip/US.zip (GeoNames CC BY 4.0).
Input places.html: https://tigerweb.geo.census.gov/tigerwebmain/Files/bas26/tigerweb_bas26_incplace_2020_tab20_ia.html
Input county.zip: https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_20m.zip
No downloads occur in the dashboard. Boundaries are Census public-domain cartographic 1:20m.
"""
import sys,json,re,math,zipfile,hashlib
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
def canon(s):
 words=re.sub(r'[^a-z0-9]+',' ',s.lower()).split();ab={'st':'saint','mt':'mount','ft':'fort','w':'west','e':'east','n':'north','s':'south'}
 return ''.join(ab.get(w,w) for w in words)
def county_for(lon,lat):
 for c in cs:
  if c.shape.bbox[0]<=lon<=c.shape.bbox[2] and c.shape.bbox[1]<=lat<=c.shape.bbox[3] and sum(inside((lon,lat),ring) for ring in rings(c.shape))%2:return c.record['NAME']
 return None
towns={};counts={}
for file,kind in [('places.html','incorporated'),('cdp.html','CDP')]:
 t=BeautifulSoup((src/file).read_text(),'html.parser').find('table').find_all('tr');hdr=[c.get_text(strip=True) for c in t[0].find_all(['th','td'])];counts[kind]=0
 for row in t[1:]:
  v=[c.get_text(strip=True) for c in row.find_all(['td','th'])]
  if len(v)!=len(hdr):continue
  d=dict(zip(hdr,v));name=d['BASENAME'];pop=int(d['POP100']);lat,lon=float(d['INTPTLAT']),float(d['INTPTLON']);county=county_for(lon,lat)
  k=re.sub(r'[^a-z0-9]','',name.lower());towns[k]={'name':name,'pop':pop,'xy':xy(lon,lat),'county':county,'lat':lat,'lon':lon,'kind':kind};counts[kind]+=1
# All Iowa entries from the public GeoNames US postal extract (CC BY 4.0).
# Postal labels are not population areas. Match their primary city to Census cities/CDPs;
# never invent a city population for an unmatched/unincorporated postal locality.
bycanon={canon(v['name']):v for v in towns.values()};zips={}
with zipfile.ZipFile(src/'US.zip') as z:lines=z.read('US.txt').decode('utf-8').splitlines()
for line in lines:
 v=line.split('\t')
 if len(v)<12 or v[4]!='IA':continue
 code,name,county=v[1],v[2],v[5];lat,lon=float(v[9]),float(v[10]);city=bycanon.get(canon(name))
 zips[code]={'name':city['name'] if city else name,'county':county or county_for(lon,lat),'pop':city['pop'] if city else None,'lat':lat,'lon':lon,'xy':xy(lon,lat),'cityRef':next((k for k,t in towns.items() if t is city),None),'kind':'ZIP centroid'}
 if not city:
  k=re.sub(r'[^a-z0-9]','',name.lower())
  if k not in towns:towns[k]={'name':name,'pop':None,'xy':xy(lon,lat),'county':county,'lat':lat,'lon':lon,'kind':'postal locality'}
geo={'w':960,'h':h,'counties':counties,'towns':towns,'zips':zips,'counts':counts,'sources':{'places':'https://tigerweb.geo.census.gov/tigerwebmain/Files/bas26/tigerweb_bas26_incplace_2020_tab20_ia.html','cdp':'https://tigerweb.geo.census.gov/tigerwebmain/Files/bas26/tigerweb_bas26_cdp_2020_tab20_ia.html','counties':'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_20m.zip','postal':'https://download.geonames.org/export/zip/US.zip','postalLicense':'https://creativecommons.org/licenses/by/4.0/'},'populationYear':2020,'postalAttribution':'GeoNames postal data, CC BY 4.0 (www.geonames.org). Complete Iowa subset of US.zip; source may omit retired/new ZIPs. ZIP centers are approximate, not street geocoding.','sourceHashes':{f:hashlib.sha256((src/f).read_bytes()).hexdigest() for f in ['places.html','cdp.html','US.zip','county.zip']},'note':'County assignment uses Census place internal points or GeoNames ZIP counties, not incident location. Census cities/CDPs have 2020 population; other postal localities plot with Unknown size rather than invented populations.'}
(out/'iowa_reference.js').write_text('/* Public Census reference data + GeoNames postal data CC BY 4.0; attribution in dashboard drawer. No soldier records. */\nwindow.OWI_GEO='+json.dumps(geo,separators=(',',':'))+';\n')
print(counts,len(towns),'places;',len(zips),'Iowa ZIPs;',len(counties),'counties')
