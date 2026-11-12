/* G1 program adapters. Only recognized columns are read. All state is document-local; no network/storage.
   Change these constants to change which Account Key-mapped SOF accounts belong to each program. */
(function(w){
 "use strict";
 var C=w.G1,K=w.DashKit,L=w.FundsLib,$=K.$,esc=K.esc,full=L.full;
 // PRSA: one fund spread across several SOF accounts; drives the PRSA Planner on the SOF page.
 var ACCOUNT_MATCH={fh:/Funeral Honors/i,esgr:/ESGR/i,prsa:/PRSA/i};
 C.PROGRAM_ACCOUNT_MATCH=ACCOUNT_MATCH;
 var FM=['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'];
 var STATUS={'not started':{label:'Not started',color:'#dc2626',cls:'red'},'calendar submitted':{label:'Calendar submitted',color:'#f59e0b',cls:'amber'},'pay submitted':{label:'Pay submitted',color:'#16a34a',cls:'green'}};
 var SCHEMAS={
  stip:{page:'fh',title:'Stipends',cols:[['name','Retiree',['retiree']],['date','Date of service',['dateofservice']],['cage','CAGE code',['cagecode','cage']],['status','Status',['status']]]},
  duty:{page:'fh',title:'MFH Duty',cols:[['name','Name',['name']],['date','Date performed',['dateperformed']],['uic','UIC',['uic']],['status','Status',['status']]]},
  dts:{page:'esgr',title:'DTS report',cols:[['approved','Approved date',['approveddate','dateapproved']],['last','Last name',['lastname']],['first','First name',['firstname']],['tanum','TANUM',['tanum']],['depart','Departure Date',['departuredate']],['location','Location',['locationdestination','location','destination']],['amount','Total Obligation ($)',['totalobligation','totalobligationdollars']]]}
 };
 var STATES={fh:{files:[],fy:'',acct:'',mode:'month'},esgr:{files:[],fy:'',acct:'',mode:'month'}};
 var VIEW={};
 function r2(x){return Math.round(x*100)/100;}
 function title(s){return L.txt(s).toLowerCase().replace(/(^|[\s\-'’])([a-z])/g,function(_,a,b){return a+b.toUpperCase();}).replace(/\bMc([a-z])/g,function(_,a){return 'Mc'+a.toUpperCase();});}
 function person(first,last){first=L.txt(first);last=L.txt(last);if(!first && /,/.test(last)){var p=last.split(',');return title(p.slice(1).join(' ')+' '+p[0]);}if(!last && /,/.test(first)){var p=first.split(',');return title(p.slice(1).join(' ')+' '+p[0]);}return title([first,last].filter(Boolean).join(' '));}
 function mk(y,m,d){var x=new Date(y,m-1,d);return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d?x:null;}
 function date(v){
  if(v instanceof Date)return new Date(v.getFullYear(),v.getMonth(),v.getDate());
  if(typeof v==='number'){var d=XLSX.SSF.parse_date_code(v);return d?mk(d.y,d.m,d.d):null;}
  var s=L.txt(v),m;if(!s)return null;
  if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/)))return mk(+m[1],+m[2],+m[3]);
  if((m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/)))return mk(+m[3]<100?2000+(+m[3]):+m[3],+m[1],+m[2]);
  if((m=s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s,-]+(\d{4})$/i))){var z=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase());return z>=0?mk(+m[3],z+1,+m[1]):null;}
  if((m=s.match(/^([a-z]{3})[a-z]*[\s-]+(\d{1,2})[\s,-]+(\d{4})$/i))){var z=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase());return z>=0?mk(+m[3],z+1,+m[2]):null;}
  return null;
 }
 function iso(d){return d?d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2):'';}
 function head(src,kind){var cols=SCHEMAS[kind].cols,alias={};cols.forEach(function(c){c[2].forEach(function(a){alias[a]=c[0];});});for(var r=0;r<Math.min(60,src.rows);r++){var map={};for(var c=0;c<src.cols;c++){var k=alias[L.norm(src.get(r,c)||'')];if(k&&map[k]==null)map[k]=c;}if(cols.every(function(c){return map[c[0]]!=null;}))return {row:r,map:map};}return null;}
 function classify(page,src){return Object.keys(SCHEMAS).filter(function(k){return SCHEMAS[k].page===page;}).map(function(k){return head(src,k)?{kind:k,score:60+SCHEMAS[k].cols.length}:null;}).filter(Boolean);}
 function parse(kind,src,fname,ws,name){
  var sch=SCHEMAS[kind],h=head(src,kind),e={name:name,kind:kind,kindLabel:sch.title,rows:[],count:0,badDate:0,badMoney:0,blank:0,total:0,status:'Loaded'};
  if(!h){e.fatal='Missing required '+sch.title+' headers.';return e;}e.headerRow=h.row+1;
  for(var r=h.row+1;r<src.rows;r++){
   var raw={};sch.cols.forEach(function(c){raw[c[0]]=src.get(r,h.map[c[0]]);}); // all other cells are never read
   if(Object.keys(raw).every(function(k){return L.blankish(raw[k]);})){e.blank++;continue;}
   var nm=L.txt(kind==='dts'?raw.last||raw.first:raw.name);if(/^(grand\s*)?totals?$/i.test(nm)){e.total++;continue;}
   var row={};
   if(kind==='dts'){
    row.name=person(raw.first,raw.last);row.tanum=L.idText(raw.tanum);row.approved=iso(date(raw.approved));row.depart=iso(date(raw.depart));row.location=L.txt(raw.location);
    var amt=L.parseAmt(raw.amount);if(amt!=null&&isNaN(amt)){e.badMoney++;amt=null;}row.amount=amt;
    if((!L.blankish(raw.approved)&&!row.approved)||(!L.blankish(raw.depart)&&!row.depart))e.badDate++;
   }else{
    row.name=L.txt(raw.name);row.date=iso(date(raw.date));row.status=L.txt(raw.status);
    if(kind==='duty'){var st=STATUS[row.status.toLowerCase()];if(st)row.status=st.label;row.uic=L.idText(raw.uic);}else row.cage=L.idText(raw.cage);
    if(!L.blankish(raw.date)&&!row.date)e.badDate++;
   }
   e.rows.push(row);
  }
  e.count=e.rows.length;e.warns=e.badDate||e.badMoney?1:0;e.status=e.count+' rows · header row '+e.headerRow;
  return e;
 }
 function ingest(page,entries){var S=STATES[page];entries.forEach(function(e){if(!e.fatal)S.files=S.files.filter(function(x){return x.kind!==e.kind;});S.files.push(e);});}
 function data(kind){var s=STATES[SCHEMAS[kind].page];return [].concat.apply([],s.files.filter(function(e){return e.kind===kind&&!e.fatal;}).map(function(e){return e.rows;}));}
 function snapshot(page){return {files:STATES[page].files.filter(function(e){return !e.fatal;}).map(function(e){return {name:e.name,kind:e.kind,rows:e.rows,headerRow:e.headerRow};})};}
 function restore(page,o){STATES[page].files=(o.files||[]).map(function(e){return {name:e.name,kind:e.kind,kindLabel:SCHEMAS[e.kind].title,rows:e.rows,count:e.rows.length,status:'Saved',headerRow:e.headerRow};});}
 function demo(page){var d=w.G1_DEMO;if(!d)return;STATES[page].files=[];Object.keys(SCHEMAS).filter(function(k){return SCHEMAS[k].page===page;}).forEach(function(k){var o=d[k];if(o)STATES[page].files.push(parse(k,L.aoaSource(o.grid),o.name,null,o.name));});}
 // ----- SOF accounts for this program -----
 function accountData(page,fy){
  var s=C.mods.sof._state,acc={},last=0;
  function get(a){return acc[a]||(acc[a]={name:a,te:0,obl:0,disb:0,tdp:0,afp:0,funded:false,mon:Array(12).fill(0)});}
  s.recs.forEach(function(r){if(r.fy!==fy)return;if(r.fmn)last=Math.max(last,r.fmn);if(!ACCOUNT_MATCH[page].test(r.acctL||''))return;var a=get(r.acctL);a.te+=L.n(r.com);a.obl+=L.n(r.obl);a.disb+=L.n(r.disb);if(r.fmn)a.mon[r.fmn-1]+=L.n(r.com);});
  if(s.fund)s.fund.rows.forEach(function(r){if(s.fund.useFy&&r.fy!==fy||!ACCOUNT_MATCH[page].test(r.acct||''))return;var a=get(r.acct);a.tdp+=L.n(r.tdp);a.afp+=L.n(r.afp);a.funded=true;});
  return {last:last,list:Object.keys(acc).map(function(k){var a=acc[k];a.te=r2(a.te);a.obl=r2(a.obl);a.disb=r2(a.disb);a.mon=a.mon.map(r2);return a;}).sort(function(a,b){return b.te-a.te;})};
 }
 function getYears(){var f=C.mods.sof.feed(),ys=f.actual.map(function(r){return r.fy;}).concat(f.plan.map(function(r){return r.fy;}));var fund=C.mods.sof._state.fund;if(fund)fund.rows.forEach(function(r){ys.push(r.fy);});Object.keys(SCHEMAS).forEach(function(k){data(k).forEach(function(r){var d=date(k==='dts'?r.approved:r.date);if(d)ys.push(C.fyOf(d));});});return K.uniq(ys.filter(Boolean)).sort();}
 function defaultFy(ys){return ys.indexOf(C.currentFy())>=0?C.currentFy():ys[ys.length-1]||C.currentFy();}
 function kpi(l,v,sub,c){return '<div class="kpi" style="--st:'+(c||'#2563eb')+'"><div class="lbl">'+l+'</div><div class="val">'+v+'</div><div class="sub">'+(sub||'&nbsp;')+'</div></div>';}
 function sum(rows,k){return r2(rows.reduce(function(s,r){return s+L.n(r[k]);},0));}
 function options(id,vals,all,value){$(id).innerHTML=(all!=null?'<option value="">'+esc(all)+'</option>':'')+vals.map(function(v){return '<option value="'+esc(v)+'">'+esc(v)+'</option>';}).join('');if(vals.indexOf(value)>=0)$(id).value=value;}
 function renderAccounts(page){
  var S=STATES[page],ys=getYears();if(!S.fy||ys.indexOf(S.fy)<0)S.fy=defaultFy(ys);if(!ys.length)ys=[S.fy];options(page+'Fy',ys,null,S.fy);
  var d=accountData(page,S.fy);options(page+'Acct',d.list.map(function(a){return a.name;}),'All matching accounts',S.acct);if(!d.list.some(function(a){return a.name===S.acct;}))S.acct='';
  var list=d.list.filter(function(a){return !S.acct||a.name===S.acct;});S.accounts=list;
  $(page+'Scope').textContent='FY'+S.fy+' · '+list.length+' matching account'+(list.length===1?'':'s');
  var te=sum(list,'te'),tdp=sum(list,'tdp'),afp=sum(list,'afp');
  $(page+'Kpis').innerHTML=kpi('Total Expenditure',full(te),'From Status of Funds')+kpi('TDP',full(tdp),'G1 funding file','#64748b')+kpi('AFP',full(afp),'G1 funding file','#a16207')+kpi('Balance',full(tdp-te),'TDP − Total Expenditure',tdp-te<0?'#dc2626':'#16a34a');
  var o=K.chartBase();o.indexAxis='y';o.scales.x.ticks={callback:function(v){return K.money(v);}};o.plugins.tooltip.callbacks={label:function(c){return c.dataset.label+': '+full(c.raw);}};
  K.upsert('c'+page+'Acct',{type:'bar',data:{labels:list.map(function(a){return a.name;}),datasets:[{label:'TDP',data:list.map(function(a){return a.tdp;}),backgroundColor:'#e2e8f0'},{label:'Total Expenditure',data:list.map(function(a){return a.te;}),backgroundColor:page==='fh'?'#be123c':'#ea580c'},{label:'AFP',data:list.map(function(a){return a.afp;}),backgroundColor:'#d4a745'}]},options:o});
  var mon=K.chartBase();mon.scales.y.ticks={callback:function(v){return K.money(v);}};mon.plugins.tooltip.callbacks={label:function(c){return c.dataset.label+': '+full(c.raw);}};
  var colors=page==='fh'?['#be123c','#f43f5e','#9f1239','#fb7185','#64748b']:['#ea580c','#fb923c','#c2410c','#fdba74','#64748b'];
  K.upsert('c'+page+'Mon',{type:S.mode==='cum'?'line':'bar',data:{labels:FM,datasets:list.map(function(a,i){var t=0;return {label:a.name,data:a.mon.map(function(v,j){t+=v;return j>=d.last?null:S.mode==='cum'?r2(t):v;}),backgroundColor:colors[i%colors.length],borderColor:colors[i%colors.length],tension:0,spanGaps:false};})},options:mon});
  var tbl=$('t'+page+'Acct');tbl.tHead.innerHTML='<tr><th>Account</th><th class="num">TDP</th><th class="num">AFP</th><th class="num">Total Expenditure</th><th class="num">Balance</th><th class="num">% expended</th></tr>';
  tbl.tBodies[0].innerHTML=list.map(function(a){return '<tr><td>'+esc(a.name)+'</td><td class="num">'+(a.funded?full(a.tdp):'—')+'</td><td class="num">'+(a.funded?full(a.afp):'—')+'</td><td class="num">'+full(a.te)+'</td><td class="num">'+(a.funded?full(a.tdp-a.te):'—')+'</td><td class="num">'+(a.tdp?C.pct(a.te/a.tdp,1):'—')+'</td></tr>';}).join('')||'<tr><td colspan="6" class="muted">No matching SOF accounts.</td></tr>';
 }
 // ----- report tables and charts -----
 var TABLE_COLS={stip:[['name','Retiree'],['date','Date of service'],['cage','CAGE code'],['status','Status']],duty:[['name','Name'],['date','Date performed'],['uic','UIC'],['status','Status']],dts:[['approved','Approved date'],['name','Name'],['tanum','TANUM'],['depart','Departure date'],['location','Location'],['amount','Total Obligation ($)']]};
 function color(st){var k=STATUS[L.txt(st).toLowerCase()];return k?k.color:'#64748b';}
 function rowsFor(kind){var page=SCHEMAS[kind].page,fy=STATES[page].fy;return data(kind).filter(function(r){var dt=date(kind==='dts'?r.approved:r.date);return !dt||C.fyOf(dt)===fy;});}
 function table(kind,rows){var V=VIEW[kind]||(VIEW[kind]={sort:kind==='dts'?'approved':'date',dir:-1}),q=$(kind+'Search').value.trim().toLowerCase(),status=$(kind+'Status').value;
  rows=rows.filter(function(r){return (!status||r.status===status)&&(!q||TABLE_COLS[kind].map(function(c){return r[c[0]];}).join(' ').toLowerCase().indexOf(q)>=0);}).slice();
  rows.sort(function(a,b){return V.dir*L.cmpVal(a[V.sort]==null?'':a[V.sort],b[V.sort]==null?'':b[V.sort]);});
  var t=$('t'+kind);t.tHead.innerHTML='<tr>'+TABLE_COLS[kind].map(function(c){return '<th data-k="'+c[0]+'"'+(V.sort===c[0]?' class="sorted'+(V.dir>0?' asc':'')+'"':'')+'>'+c[1]+'</th>';}).join('')+'</tr>';
  t.tBodies[0].innerHTML=rows.map(function(r){return '<tr>'+TABLE_COLS[kind].map(function(c){var key=c[0],v=r[key];if(key==='amount')return '<td class="num">'+(v==null?'—':full(v))+'</td>';if(key==='date'||key==='approved'||key==='depart')return '<td>'+esc(C.dateText(date(v))||'—')+'</td>';if(key==='status')return '<td><span class="statuspill" style="--sc:'+color(v)+'">'+esc(v||'(blank)')+'</span></td>';return '<td>'+esc(v||'—')+'</td>';}).join('')+'</tr>';}).join('')||'<tr><td colspan="'+TABLE_COLS[kind].length+'" class="muted">No rows.</td></tr>';
  $(kind+'Note').textContent=rows.length+' rows'+(kind==='dts'?' · obligation by approved month; every TANUM row is kept.':' · click a column heading to sort.');
 }
 function countChart(id,labels,sets,money,horizontal){var o=K.chartBase();if(horizontal)o.indexAxis='y';o.scales[horizontal?'x':'y'].beginAtZero=true;if(money)o.scales[horizontal?'x':'y'].ticks={callback:function(v){return K.money(v);}};else o.scales[horizontal?'x':'y'].ticks={precision:0};K.upsert(id,{type:'bar',data:{labels:labels,datasets:sets},options:o});}
 function renderReport(kind){var rows=rowsFor(kind),st=K.uniq(rows.map(function(r){return r.status||'';})).sort(),sel=$(kind+'Status').value;
  if(kind==='dts'){$(kind+'Status').hidden=true;$(kind+'Counts').innerHTML='';}
  else{options(kind+'Status',st,'All statuses',sel);var sts=kind==='duty'?['Not started','Calendar submitted','Pay submitted'].concat(st.filter(function(s){return !STATUS[s.toLowerCase()];})):st;
   $(kind+'Counts').innerHTML=sts.map(function(s){return '<div class="statuscount" style="--sc:'+color(s)+'"><strong>'+rows.filter(function(r){return r.status===s;}).length+'</strong><span>'+esc(s||'(blank)')+'</span></div>';}).join('');}
  var selected=rows.filter(function(r){return !$(kind+'Status').value||r.status===$(kind+'Status').value;}),mon=Array(12).fill(0);
  if(kind==='dts'){
   selected.forEach(function(r){var d=date(r.approved);if(d)mon[C.fmOf(d)-1]+=L.n(r.amount);});
   $('dtsKpis').innerHTML=kpi('Trips',K.fmt(rows.length),'All report rows')+kpi('Total obligation',full(sum(rows,'amount')),'DTS obligation, not SOF TE','#ea580c');
   countChart('cDtsMon',FM,[{label:'Obligation by approved month',data:mon.map(r2),backgroundColor:'#ea580c'}],true);
   var loc={};rows.forEach(function(r){loc[r.location||'(blank)']=(loc[r.location||'(blank)']||0)+L.n(r.amount);});var ls=Object.keys(loc).sort(function(a,b){return loc[b]-loc[a];}).slice(0,8);countChart('cLoc',ls,[{label:'Top locations · obligation',data:ls.map(function(l){return r2(loc[l]);}),backgroundColor:'#a78bfa'}],true,true);
  }else{
   var statuses=K.uniq(selected.map(function(r){return r.status||'';}));countChart(kind==='stip'?'cStip':'cDuty',FM,statuses.map(function(s,i){var m=Array(12).fill(0);selected.forEach(function(r){var d=date(r.date);if(r.status===s&&d)m[C.fmOf(d)-1]++;});return {label:s||'(blank)',data:m,backgroundColor:kind==='duty'?color(s):['#2563eb','#0d9488','#7c3aed','#ea580c'][i%4]};}),false);
   if(kind==='duty'){var u={};selected.forEach(function(r){u[r.uic||'(blank)']=(u[r.uic||'(blank)']||0)+1;});var us=Object.keys(u).sort();countChart('cUic',us,[{label:'Duties by UIC',data:us.map(function(k){return u[k];}),backgroundColor:'#0d9488'}],false,true);}
  }
  table(kind,rows);
 }
 function render(page){renderAccounts(page);Object.keys(SCHEMAS).filter(function(k){return SCHEMAS[k].page===page;}).forEach(renderReport);}
 function report(page){var h=[],warns=0;STATES[page].files.forEach(function(e){h.push('<p class="'+(e.fatal?'err':'ok')+'"><strong>'+esc(e.name)+'</strong>: '+esc(e.fatal||e.count+' rows, header row '+e.headerRow)+'.</p>');if(e.badDate||e.badMoney){warns++;h.push('<p class="warn">'+(e.badDate||0)+' unreadable dates and '+(e.badMoney||0)+' unreadable amounts kept as blanks.</p>');}});
  if(page==='esgr'){var seen={},rep=0;data('dts').forEach(function(r){if(r.tanum){if(seen[r.tanum])rep++;seen[r.tanum]=true;}});if(rep){warns++;h.push('<p class="warn">'+rep+' repeat TANUM rows retained (nothing deduplicated).</p>');}}
  h.push('<p class="muted">Accounts: name contains “'+(page==='fh'?'Funeral Honors':'ESGR')+'”, ignoring case, via the G1 Account Key. Rule: PROGRAM_ACCOUNT_MATCH in programs.js. Report uploads replace the previous file of the same kind; no other columns are read.</p>');
  return {html:h.join(''),warns:warns};
 }
 function summary(page){var fy=defaultFy(getYears()),a=accountData(page,fy).list;return {fy:fy,te:sum(a,'te'),tdp:sum(a,'tdp'),afp:sum(a,'afp'),accounts:a.length,stip:data('stip').length,duty:data('duty').length,trips:data('dts').length,obligation:sum(data('dts'),'amount')};}
 ['fh','esgr'].forEach(function(page){var mod={classify:function(src){return classify(page,src);},parse:parse,ingest:function(es){ingest(page,es);},clear:function(){STATES[page].files=[];STATES[page].fy='';STATES[page].acct='';},demo:function(){demo(page);},snapshot:function(){return snapshot(page);},restore:function(o){restore(page,o);},render:function(){render(page);},report:function(){return report(page);},summary:function(){return summary(page);},entries:function(){return STATES[page].files;},hasData:function(){return STATES[page].files.length>0||accountData(page,defaultFy(getYears())).list.length>0;},_state:STATES[page],init:function(){
  ['Fy','Acct','Mode'].forEach(function(suffix){$(page+suffix).addEventListener('change',function(){STATES[page][suffix.toLowerCase()]=this.value;render(page);});});
  Object.keys(SCHEMAS).filter(function(k){return SCHEMAS[k].page===page;}).forEach(function(k){$(k+'Search').addEventListener('input',function(){table(k,rowsFor(k));});$(k+'Status').addEventListener('change',function(){renderReport(k);});$('t'+k).tHead.addEventListener('click',function(e){var h=e.target.closest('th[data-k]');if(!h)return;var v=VIEW[k]||(VIEW[k]={}),key=h.getAttribute('data-k');v.dir=v.sort===key?-v.dir:1;v.sort=key;table(k,rowsFor(k));});});
 }};var own=null;Object.defineProperty(mod,'asOf',{get:function(){var s=C.mods.sof.asOf;return own&&(!s||own>s)?own:s;},set:function(v){own=v;},enumerable:true});C.register(page,mod);});
 C.programs={data:data,accountData:accountData,getYears:getYears,defaultFy:defaultFy,date:date,person:person};
})(window);
