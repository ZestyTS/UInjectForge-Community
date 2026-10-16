import { systems, labels, validateReport, validateRegistry, filterReports } from './registry.mjs';
import { intakeOrigin, intakeEnabled } from './config.mjs';
const $ = id => document.getElementById(id);
const names = { Works: 'Working', Issues: 'With issues', Broken: 'Not working' };
const checks = ['boot', 'controls', 'audio', 'video', 'save', 'manual'];
let entries = [], imported = null, generation = 0, sending = false;
if(!intakeEnabled){$('send').disabled=true;$('submission-status').textContent='Public submissions are not enabled yet. You can prepare and save a report here, or use the optional GitHub form.';}
const draftId = crypto.randomUUID().replaceAll('-', ''), draftTime = new Date().toISOString();
function text(tag, value) { const e = document.createElement(tag); e.textContent = value; return e; }
function option(value, label = value) { const e = text('option', label); e.value = value; return e; }
for (const s of systems) { $('system').append(option(s, labels[s])); $('report-system').append(option(s, labels[s])); }
for (const name of checks) {
  const label = text('label', name[0].toUpperCase() + name.slice(1)), select = document.createElement('select'); select.id = 'check-' + name;
  for (const value of ['Not tested', 'Pass', 'Issues', 'Fail']) select.append(option(value)); label.append(select); $('check-fields').append(label);
}
function route() {
  const submit = location.hash === '#submit';
  $('reports').hidden = submit; $('submit').hidden = !submit;
  $('nav-reports').setAttribute('aria-current', submit ? 'false' : 'page'); $('nav-submit').setAttribute('aria-current', submit ? 'page' : 'false');
  if (submit) $('submit-heading').scrollIntoView({block:'start'});
}
window.addEventListener('hashchange', route); route();
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  $('theme').title = label; $('theme').setAttribute('aria-label', label); $('theme').querySelector('img').src = 'assets/' + (theme === 'dark' ? 'sun' : 'moon') + '.svg';
}
try { setTheme(localStorage.getItem('uif-theme') === 'light' ? 'light' : 'dark'); } catch { setTheme('dark'); }
$('theme').addEventListener('click', () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; setTheme(theme); try { localStorage.setItem('uif-theme', theme); } catch {} });
function fact(list, key, value) { list.append(text('dt', key), text('dd', String(value))); }
function showDetail(entry) {
  const r = entry.report; $('detail-title').textContent = r.gameName; $('detail-scope').textContent = r.evidence.scope;
  const list = document.createElement('dl');
  for (const [k,v] of Object.entries({ System: labels[r.console], Result: names[r.outcome], 'UIF version':r.uifVersion, Environment:r.environment, Base:r.baseName, Runtime:r.evidence.runtime, Region:r.gameRegion || 'Unknown', Revision:r.gameRevision || 'Unknown', 'Game identifier':r.gameId || 'Unknown', 'Base title ID':r.baseTitleId || 'Unknown', Output:r.outputMode, 'Built at':r.builtAtUtc, 'Reported at':r.reportedAtUtc })) fact(list,k,v);
  $('detail-facts').replaceChildren(list); $('detail-checks').replaceChildren();
  for (const key of checks) fact($('detail-checks'), key, r.checks[key] || 'Not tested');
  $('detail-json').textContent = JSON.stringify(r.evidence,null,2); $('detail-notes').textContent = r.notes || 'No notes.';
  $('detail-review').textContent = 'Reviewed by ' + entry.review.reviewer + ' on ' + new Date(entry.review.reviewedAtUtc).toLocaleDateString() + '.';
  $('detail-source').hidden = !entry.review.issueUrl; if (entry.review.issueUrl) $('detail-source').href = entry.review.issueUrl;
  $('detail').showModal();
}
function render() {
  const filters = Object.fromEntries(['search','system','outcome','environment','version','runtime'].map(k => [k,$(k).value]));
  const results = filterReports(entries,filters);
  $('count').textContent = results.length + ' report' + (results.length === 1 ? '' : 's') + (results.length !== entries.length ? ' of ' + entries.length : '');
  $('rows').replaceChildren(...results.map(entry => {
    const r=entry.report, row=document.createElement('tr'), game=text('td',r.gameName); game.append(text('small',labels[r.console] + (r.gameRegion ? ' / ' + r.gameRegion : '')));
    const outcome=document.createElement('td'), badge=text('span',names[r.outcome]); badge.className='badge '+r.outcome.toLowerCase(); outcome.append(badge);
    const base=text('td',r.baseName); base.append(text('small',r.evidence.runtime)); const build=text('td',r.uifVersion); build.append(text('small',r.environment));
    const action=document.createElement('td'), button=text('button','Details'); button.type='button'; button.setAttribute('aria-label','View '+r.gameName+' report'); button.addEventListener('click',()=>showDetail(entry)); action.append(button); row.append(game,outcome,base,build,action); return row;
  }));
  $('empty').hidden = results.length !== 0;
  $('empty').querySelector('h2').textContent = entries.length ? 'No matching reports' : 'No reports yet';
  $('empty').querySelector('p').textContent = entries.length ? 'Try another system or clear your filters.' : 'Be the first to share a tested UIF build. Reports appear here after review.';
  $('total').textContent = entries.length;
  for (const [value,id] of [['Works','works-total'],['Issues','issues-total'],['Broken','broken-total']]) $(id).textContent=entries.filter(e=>e.report.outcome===value).length;
  $('system-nav').replaceChildren(...['',...systems].map(s=>{
    const b=text('button',s ? labels[s] : 'All systems'); b.type='button'; b.setAttribute('aria-pressed',String(filters.system===s)); b.append(text('small',String(entries.filter(e=>!s || e.report.console===s).length)));
    b.addEventListener('click',()=>{ $('system').value=s; if(location.hash==='#submit')location.hash='#reports'; render(); }); return b;
  }));
}
$('filters').addEventListener('submit',e=>e.preventDefault()); $('filters').addEventListener('input',render); $('filters').addEventListener('reset',()=>setTimeout(render,0));
$('close-detail').addEventListener('click',()=>$('detail').close());
function download(report,name) { const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
$('download').addEventListener('click',()=>download({schemaVersion:1,reports:entries},'uif-compatibility.json'));
async function jsonFetch(url, options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000),credentials:'omit',cache:'no-store'});
  const body=await response.text(); if(body.length>16000000)throw new Error('Response too large.');
  let data;try{data=JSON.parse(body);}catch{throw new Error('The report service returned an unreadable response.');}
  if(!response.ok)throw new Error(data.error || 'The report service is unavailable. Please try again later.');
  return data;
}
async function load() {
  const results=await Promise.allSettled([jsonFetch('data/reports.json'),intakeEnabled?loadPublicReports():Promise.resolve({schemaVersion:1,reports:[]})]);
  const combined=new Map(); let failed=0;
  for(const r of results){try{if(r.status!=='fulfilled')throw new Error(); for(const e of validateRegistry(r.value).reports)combined.set(e.report.reportId,e);}catch{failed++;}}
  if(failed){$('load-error').hidden=false;$('load-error').textContent=failed===2?'Reports could not be loaded. This is not a zero-report result.':'Some reports could not be loaded. Results below may be incomplete; please try again later.';}
  entries=[...combined.values()].sort((a,b)=>b.report.reportedAtUtc.localeCompare(a.report.reportedAtUtc));
  for(const key of ['version','runtime']) $(key).append(...[...new Set(entries.map(e=>key==='version'?e.report.uifVersion:e.report.evidence.runtime))].sort().map(x=>option(x)));
  render(); if(failed===2){$('count').textContent='Reports unavailable';$('empty').hidden=true;for(const id of ['total','works-total','issues-total','broken-total'])$(id).textContent='-';$('download').disabled=true;}
}
async function loadPublicReports() {
  let after='',size=0;const reports=[],seen=new Set();
  do{
    const page=await jsonFetch(intakeOrigin+'/api/reports'+(after?'?after='+after:''));
    size+=new TextEncoder().encode(JSON.stringify(page)).length;
    if(size>16000000)throw new Error('Registry exceeds browser limit.');
    reports.push(...validateRegistry({schemaVersion:page.schemaVersion,reports:page.reports}).reports);
    after=page.nextCursor||'';if(after&&(!/^[a-f0-9]{32}$/.test(after)||seen.has(after)))throw new Error('Invalid registry pagination.');seen.add(after);
    if(reports.length>20000)throw new Error('Registry exceeds report limit.');
  }while(after);
  return {schemaVersion:1,reports};
}
function buildReport() {
  const r=imported ? structuredClone(imported) : {schemaVersion:1,reportId:draftId,reportedAtUtc:draftTime,builtAtUtc:draftTime,gameId:'',baseTitleId:'',customBase:false,buildSucceeded:null,outputMode:'Installable',evidence:{runtime:'',settings:{},fingerprints:{},omittedOptions:0,scope:'Manually entered test report. Build time is the entry time; settings and runtime fingerprints were not captured by UIF.'}};
  Object.assign(r,{gameName:$('game-name').value.trim(),console:$('report-system').value,uifVersion:$('uif-version').value.trim(),environment:$('report-environment').value,baseName:$('base-name').value.trim(),gameRegion:$('region').value.trim(),gameRevision:$('revision').value.trim(),outcome:document.querySelector('[name=result]:checked')?.value || '',notes:$('notes').value,checks:Object.fromEntries(checks.map(k=>[k,$('check-'+k).value]))});
  const runtime=$('report-runtime').value.trim();
  if(imported && (runtime!==r.evidence.runtime || r.baseName!==imported.baseName || r.console!==imported.console || r.uifVersion!==imported.uifVersion || r.gameName!==imported.gameName))throw new Error('Imported build identity is locked to its captured evidence. Clear the imported file to enter a different build.');
  r.evidence.runtime=runtime;return validateReport(r);
}
function preview() { try{$('preview').textContent=JSON.stringify(buildReport(),null,2);}catch(error){$('preview').textContent=error.message;} }
$('submission').addEventListener('input',()=>{$('consent').checked=false;preview();});
$('consent').addEventListener('input',e=>e.stopPropagation());
$('report-file').addEventListener('change',async()=>{
  const current=++generation;imported=null;$('consent').checked=false;
  for(const id of ['game-name','report-system','uif-version','base-name','report-runtime'])$(id).disabled=false;
  const file=$('report-file').files[0];if(!file){$('import-status').textContent='Manual entry. No runtime fingerprint evidence will be claimed.';preview();return;}
  try{if(file.size>65536)throw new Error('Use a compatibility JSON report of 64 KiB or less, not a support bundle.');
    const r=validateReport(JSON.parse(await file.text()));if(current!==generation)return;imported=r;
    for(const [id,value]of Object.entries({'game-name':r.gameName,'report-system':r.console,'uif-version':r.uifVersion,'base-name':r.baseName,'report-runtime':r.evidence.runtime,'report-environment':r.environment,'region':r.gameRegion,'revision':r.gameRevision,'notes':r.notes}))$(id).value=value;
    for(const id of ['game-name','report-system','uif-version','base-name','report-runtime'])$(id).disabled=true;
    document.querySelector('[name=result][value="'+r.outcome+'"]').checked=true;for(const key of checks)$('check-'+key).value=r.checks[key]||'Not tested';
    $('import-status').textContent='Imported '+r.gameName+'. Build evidence preserved. Review your test results before submitting.';preview();
  }catch(error){if(current===generation){$('import-status').textContent='Import failed: '+error.message;$('report-file').value='';preview();}}
});
$('export').addEventListener('click',()=>{try{download(buildReport(),'uif-compatibility-report.json');$('submission-status').textContent='Saved on this device. Nothing was uploaded.';}catch(error){$('submission-status').textContent=error.message;}});
async function solve(challenge) {
  for(let i=0;i<2000000;i++){
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(challenge+'.'+i));
    const bytes=new Uint8Array(digest); if(bytes[0]===0 && bytes[1]<16)return i;
    if(i%200===0)await new Promise(r=>setTimeout(r,0));
  }throw new Error('Browser verification timed out. Please try again.');
}
$('submission').addEventListener('submit',async e=>{
  e.preventDefault();if(!intakeEnabled || sending || !$('consent').checked)return;
  let report;try{report=buildReport();}catch(error){$('submission-status').textContent=error.message;return;}
  sending=true;$('send').disabled=true;$('submission-status').textContent='Checking submission...';
  try{
    const {challenge}=await jsonFetch(intakeOrigin+'/api/challenge');
    const proof=await solve(challenge);$('submission-status').textContent='Sending for review...';
    const result=await jsonFetch(intakeOrigin+'/api/submissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report,consent:true,website:$('website').value,challenge,proof})});
    if(!/^[a-f0-9]{32}$/.test(result.receipt))throw new Error('The service did not return a valid receipt.');
    const receiptLink=text('a','View submission status');receiptLink.href=intakeOrigin+'/receipt/'+result.receipt;receiptLink.target='_blank';receiptLink.rel='noreferrer';
    const another=text('button','New report');another.type='button';another.className='quiet';another.addEventListener('click',()=>{if(confirm('Start another report? Keep your receipt link before clearing this form.'))location.reload();});
    $('submission-status').replaceChildren(text('strong',result.duplicate?'This exact report was already received.':'Received. Your report is awaiting review.'),text('br',''),text('span','Receipt: '+result.receipt+'. Keep this receipt for corrections or removal requests. Nothing is public until approved.'),text('br',''),receiptLink,text('br',''),another);
    $('consent').checked=false;
  }catch(error){$('submission-status').textContent='Not confirmed: '+error.message+' Your entries are still here. You can save the report or retry; identical retries do not create another submission.';}
  finally{sending=false;$('send').disabled=false;}
});
load();
