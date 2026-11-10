/* Document-local, allowlisted OWI parsers. No geocoding, remote services or runtime requests.
 * Calendar dates (not instants) are represented at LOCAL NOON. SheetJS UTC date cells are
 * normalized by core.js before arriving here. Raw HOR is kept only for the local match report.
 */
(function(w){'use strict';
 var G=w.OWI_GEO,L=w.FundsLib;
 var MON=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 function day(y,m,d){y=+y;m=+m;d=+d;if(y<1900||y>2199)return null;var x=new Date(y,m-1,d,12);return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d?x:null;}
 function iso(d){return d?d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2):'';}
 function year(v){var n=+v;return String(v).length<=2?(n<50?2000+n:1900+n):n;}
 function date(v){
  if(v instanceof Date){if(!isFinite(v.getTime()))return null;var utc=v.getUTCHours()===0&&v.getUTCMinutes()===0&&v.getUTCSeconds()===0;return day(utc?v.getUTCFullYear():v.getFullYear(),(utc?v.getUTCMonth():v.getMonth())+1,utc?v.getUTCDate():v.getDate());}
  var s=L.txt(v).replace(/\u00a0/g,' '),m;if(!s)return null;
  // YYYYMMDD can be a numeric or text cell; recognize it before Excel serials.
  if((m=s.match(/^((?:19|20|21)\d{2})(\d{2})(\d{2})$/)))return day(m[1],m[2],m[3]);
  if(typeof v==='number'||/^\d{5}(?:\.\d+)?$/.test(s)){var n=+v;if(n<1||n>109574)return null;var z=XLSX.SSF.parse_date_code(n);return z?day(z.y,z.m,z.d):null;}
  // Preserve the written calendar day even when a time/offset is supplied. No UTC shift.
  s=s.replace(/(?:T|\s+)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[AP]M)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}|UTC|GMT|CST|CDT|EST|EDT|PST|PDT|MST|MDT))?\s*$/i,'').trim();
  if((m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)))return day(m[1],m[2],m[3]);
  if((m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/))){var a=+m[1],b=+m[2];return a>12?day(year(m[3]),b,a):day(year(m[3]),a,b);}
  if((m=s.match(/^(\d{1,2})(?:[\s-]*)([a-z]{3,9})(?:[\s,-]*)(\d{2}|\d{4})$/i)))return day(year(m[3]),MON.indexOf(m[2].slice(0,3).toLowerCase())+1,m[1]);
  if((m=s.match(/^([a-z]{3,9})[\s-]+(\d{1,2})(?:st|nd|rd|th)?[\s,\/-]+(\d{2}|\d{4})$/i)))return day(year(m[3]),MON.indexOf(m[1].slice(0,3).toLowerCase())+1,m[2]);
  return null;
 }
 var STATE_NAMES={alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY','district of columbia':'DC'};
 var STATE_CODES=Object.keys(STATE_NAMES).map(function(k){return STATE_NAMES[k];});
 var ABBR={st:'saint',mt:'mount',ft:'fort',w:'west',e:'east',n:'north',s:'south'};
 function words(s){return L.txt(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean).map(function(x){return ABBR[x]||x;});}
 function norm(s){return words(s).join('');}
 function sizeOf(n){return n==null?'Unknown size':n<10000?'Small':n<50000?'Medium':'Large';}
 function point(ref){return ref&&ref.indexOf('zip:')===0?G.zips[ref.slice(4)]:G.towns[ref];}
 var INDEX=Object.create(null);Object.keys(G.towns).forEach(function(ref){var n=norm(G.towns[ref].name);(INDEX[n]||(INDEX[n]=[])).push(ref);});
 var NAMES=Object.keys(INDEX),FULL_STATES=Object.keys(STATE_NAMES).sort(function(a,b){return b.length-a.length;});
 function list(v){return (Array.isArray(v)?v:[v]).map(L.txt).filter(function(x){return !L.blankish(x);});}
 function stripCountry(v){return L.txt(v).replace(/[\s,]+(?:u\.?s\.?a\.?|united states(?: of america)?|us)\s*$/i,'').trim();}
 function stateCode(v){var s=stripCountry(v).replace(/\b\d{5}(?:-\d{4})?\b/g,'').replace(/[.,]/g,'').trim();return STATE_NAMES[s.toLowerCase()]||s.toUpperCase();}
 function suffixes(v){var a=words(v),out=[];for(var n=Math.min(6,a.length);n>0;n--)out.push(a.slice(-n).join(''));return out;}
 function uniqueRefs(refs,county){if(county){var exact=refs.filter(function(ref){return norm(G.towns[ref].county||'')===county;});if(exact.length)return exact;}return refs;}
 function exact(values,county){for(var i=0;i<values.length;i++){var a=suffixes(values[i]);for(var j=0;j<a.length;j++){var refs=uniqueRefs(INDEX[a[j]]||[],county);if(refs.length===1)return refs[0];}}return null;}
 // Bounded Damerau–Levenshtein (adjacent transpositions), not a forced nearest-town assignment. Tied best matches are rejected.
 function distance(a,b,limit){if(Math.abs(a.length-b.length)>limit)return limit+1;var prev2=null,prev=Array.from({length:b.length+1},function(_,i){return i;});for(var i=1;i<=a.length;i++){var row=[i],low=i;for(var j=1;j<=b.length;j++){row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])row[j]=Math.min(row[j],prev2[j-2]+1);low=Math.min(low,row[j]);}if(low>limit)return limit+1;prev2=prev;prev=row;}return prev[b.length];}
 function fuzzy(values,county){var best=3,winners=Object.create(null);values.forEach(function(v){suffixes(v).forEach(function(a){if(a.length<4)return;var limit=a.length<=4?1:2;NAMES.forEach(function(b){if(Math.abs(a.length-b.length)>limit)return;var d=distance(a,b,limit);if(d>limit||d>best)return;var refs=uniqueRefs(INDEX[b],county);if(refs.length!==1)return;if(d<best){best=d;winners=Object.create(null);}winners[refs[0]]=true;});});});var refs=Object.keys(winners);return refs.length===1?{ref:refs[0],distance:best}:null;}
 function hor(value,st,postal,county){
  var p=typeof value==='object'&&value!==null?value:{hor:value,state:st,zip:postal,county:county};
  var cities=list(p.city),free=list(p.hor).concat(list(p.address)),states=list(p.state),zips=list(p.zip),counties=list(p.county);
  var raw=[].concat(free,cities,states,zips,counties).join(' | ')||'(blank)',parts=cities.concat(free).map(stripCountry),state=states.length?stateCode(states[0]):'',zip='',reason='';
  states.map(stateCode).forEach(function(s){if(s&&s!=='IA')state=s;});
  var countyHint=norm((counties[0]||'').replace(/\s+county\s*$/i,''));
  // State at the address tail, before an optional ZIP. Bare Iowa city names such as
  // Washington/Nevada are not mistaken for states when no prefix exists.
  parts=parts.map(function(t){
   var re=new RegExp('(?:^|[ ,]+)('+FULL_STATES.join('|')+'|'+STATE_CODES.join('|')+')(?=[ ,]*(?:\\d{5}(?:-\\d{4})?)?[ ,]*$)','i'),m=t.match(re);
   if(m&&m.index>0){var prefix=t.slice(0,m.index).trim();var ambiguous=!!INDEX[norm(m[1])];var streetEnd=/\b(st|street|rd|road|ave|avenue|dr|drive|ln|lane|blvd|ct|way|hwy)\.?$/i.test(prefix);
    if(!(ambiguous&&streetEnd&&t[m.index]!==',')){var foundState=stateCode(m[1]);if(!state||foundState!=='IA')state=foundState;t=t.slice(0,m.index)+' '+t.slice(m.index+m[0].length);}}
   return t.trim();
  });
  zips.some(function(z){var m=z.match(/\b(\d{5})(?:-?\d{4})?\b/);if(m){zip=m[1];return true;}return false;});
  if(!zip)parts.some(function(t){var m=t.match(/(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$/);if(m){zip=m[1];return true;}return false;});
  parts=parts.map(function(t){return t.replace(/(?:^|[\s,])\d{5}(?:-\d{4})?\s*$/,'').replace(/[ ,]+$/,'').trim();});
  function result(ref,method,why){var t=ref?point(ref):null;return {town:t?t.name:(cities[0]||parts.filter(Boolean).pop()||zip||'(blank)'),state:method==='out of state'?(state&&state!=='IA'?state:'non-IA ZIP'):(state||((ref||zip&&+zip>=50001&&+zip<=52809)?'IA':'')),size:t?sizeOf(t.pop):method==='out of state'?'Out of state':'Unmatched',ref:ref||null,method:method,raw:raw,zip:zip,reason:why||'',population:t?t.pop:null};}
  if(state&&state!=='IA')return result(null,'out of state',zip&&G.zips[zip]?'State/ZIP conflict; explicit non-Iowa state kept off map':'Explicit non-Iowa state');
  if(zip){if(G.zips[zip])return result('zip:'+zip,'ZIP');if(+zip<50001||+zip>52809)return result(null,'out of state','ZIP outside Iowa range');state='IA';reason='Iowa-range ZIP not in the vendored source; attempted city fallback';}
  var ref=exact(parts,countyHint);if(ref)return result(ref,'city',reason);
  var f=fuzzy(parts,countyHint);if(f)return result(f.ref,'fuzzy','Edit distance '+f.distance+(reason?'; '+reason:''));
  return result(null,'unmatched',reason||'No unambiguous Iowa city/ZIP match');
 }
 w.OWI_PARSE={day:day,date:date,iso:iso,hor:hor,normCity:norm,sizeOf:sizeOf,point:point,distance:distance};
})(window);
