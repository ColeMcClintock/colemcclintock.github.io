/* G1 Home. Each card derives from the G1-only page models. No state shared with Aviation. */
(function(w){'use strict';var C=w.G1,K=w.DashKit,L=w.FundsLib,$=K.$,esc=K.esc;
 function pic(cls,icon){return '<span class="pic '+cls+'"><svg class="ic"><use href="#'+icon+'"/></svg></span>';}
 function head(id,title,icon,cls){return '<h3>'+pic(cls,icon)+title+'<span class="more">Open ›</span></h3>'+(C.mods[id].asOf?'<div class="muted small">'+C.asOfText(C.mods[id].asOf)+'</div>':'');}
 function stat(l,v,s){return '<div class="stat"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="s">'+(s||'&nbsp;')+'</div></div>';}
 C.renderHome=function(){
  var sof=C.mods.sof.summary(),pr=C.mods.pr.summary(),sp=C.mods.spend.summary(),fh=C.mods.fh.summary(),eg=C.mods.esgr.summary();
  var any=Object.keys(C.mods).some(function(k){return C.mods[k].hasData();}),fy=C.currentFy(),progress=C.fyProgress(fy);
  $('hEyebrow').textContent='FY'+fy+' · G1';$('hLead').textContent=C.asOfText(C.latestAsOf())||'Funds, spend plans, Funeral Honors, purchase requests and ESGR in one place.';
  $('fyRing').innerHTML='<div><div class="rv">'+C.pct(progress.pct)+'</div><div class="rl">of FY'+fy+' elapsed</div></div>';
  $('homeEmpty').hidden=any;$('homeOverview').hidden=!any;$('g1Intro').hidden=!any;
  $('introTitle').textContent='FY'+(sof?sof.fy:fy)+' · Funds & program execution';$('introTe').textContent=sof?K.money(sof.te):'—';$('introNote').textContent=sof?'TDP '+K.money(sof.tdp)+' · Balance '+K.money(sof.bal)+' · '+C.pct(sof.pct,1)+' expended':'Upload G1 files to see the overview.';
  $('tsSof').textContent=sof?C.pct(sof.pct,1)+' of TDP · FY'+sof.fy:'No data loaded';$('tsSpend').textContent=sp?'Variance '+C.varText(sp.v)+' · FY'+sp.fy:'No plan loaded';$('tsPr').textContent=pr?pr.count+' PRs · '+K.money(pr.value):'No data loaded';$('tsFh').textContent=fh.accounts+' accounts · '+K.money(fh.te)+' TE';$('tsEsgr').textContent=eg.accounts+' accounts · '+eg.trips+' DTS trips';
  var h=head('sof','Status of Funds','i-sof','t-sof');
  h+=sof?'<div class="big3">'+stat('TDP',K.money(sof.tdp),'AFP '+K.money(sof.afp))+stat('Total Expenditure',K.money(sof.te),C.pct(sof.pct,1)+' expended')+stat('Balance',K.money(sof.bal),'TDP − Total Expenditure')+'</div>':'<p class="muted">No SOF files loaded.</p>';
  if(sof&&sof.top)h+='<div class="hacc"><h4>Accounts by % expended</h4>'+sof.top.map(function(a){return '<div class="ha"><span class="nm">'+esc(a.label)+'</span><div class="tr"><div class="fi" style="width:'+Math.min(100,Math.max(0,a.pct*100))+'%"></div></div><span class="nv">'+C.pct(a.pct,1)+' · '+K.money(a.te)+'</span></div>';}).join('')+'</div>';$('oSof').innerHTML=h;
  h=head('spend','Spend Plans','i-plan','t-plan');h+=sp?'<div class="big3">'+stat('Planned to date',K.money(sp.p),sp.month)+stat('Actual to date',K.money(sp.a),'Total Expenditure')+stat('Variance','<span class="vtxt '+sp.k+'">'+C.varText(sp.v)+'</span>',sp.off+' accounts off plan')+'</div>':'<p class="muted">No plan loaded.</p>';if(sp&&sp.demo)h+='<span class="demotag">Demo data</span>';$('oSpend').innerHTML=h;
  h=head('pr','PR Tracker','i-card','t-pr');h+=pr?'<div class="big3">'+stat('PRs',K.fmt(pr.count),'Across '+pr.levels.length+' levels')+stat('Value',K.money(pr.value),L.full(pr.value))+stat('Highest level',pr.levels.length?'L'+pr.levels[pr.levels.length-1].level:'—')+'</div>':'<p class="muted">No PR files loaded.</p>';
  if(pr)h+='<div class="lvlbars">'+pr.levels.map(function(l){return '<div class="lvlbar"><span class="lvl" style="--lc:'+C.levelColor(l.level)+'">L'+l.level+'</span><span>'+l.count+' PRs</span><span class="nv">'+L.full(l.value)+'</span></div>';}).join('')+'</div>';$('oPr').innerHTML=h;
  $('oFh').innerHTML=head('fh','Funeral Honors','i-flag','t-fh')+'<div class="big3">'+stat('Total Expenditure',K.money(fh.te),fh.accounts+' accounts')+stat('Stipends',K.fmt(fh.stip),'Service records')+stat('MFH duties',K.fmt(fh.duty),'Duty records')+'</div><p class="muted small">Account spend by fiscal month, stipends and duty status.</p>';
  $('oEsgr').innerHTML=head('esgr','ESGR','i-case','t-esgr')+'<div class="big3">'+stat('Total Expenditure',K.money(eg.te),eg.accounts+' accounts')+stat('DTS trips',K.fmt(eg.trips),'All report rows')+stat('DTS obligation',K.money(eg.obligation),'Approved-month trend')+'</div><p class="muted small">Account spend and travel obligation, with top locations.</p>';
 };
})(window);
