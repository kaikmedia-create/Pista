import {trackerView} from './tracker-view.js';
import {STORAGE_KEY,BACKUP_KEY,MAX_FILE_BYTES,TYPES,iso,date,addDays,monday,range,days,formatDate,shortRange,initialState,demoPlan,normalizeState,parseImport,mergePlan,progressFor,setDone,setStep,stats,escapeHTML as e} from './core.js';
import {createTrainingPDF} from './pdf.js';
const $=s=>document.querySelector(s);
const icons={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M7 15h2m6 0h2m-10 3h2"/>',chart:'<path d="M4 20h16M6 16v-5m6 5V4m6 12V8"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',check:'<path d="m5 12 4 4 10-10"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',file:'<path d="M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8zM14 2v6h6M8 13h8m-8 4h6"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="8" cy="18" r="2" fill="white"/>',refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.spark}</svg>`;
let expandedWorkouts=new Set();
const modeLabels={week:'Woche',fortnight:'2 Wochen',month:'Monat'};
let today=iso(),selected=today,planMode='week',view=['overview','plan','progress'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';
let state=initialState(today),pending=null,corruptRaw=null,memoryOnly=false,toastTimer,lastFocus=null,modalWorkout=null;
const modal=$('#modal');
function setSaveStatus(ok=true) {const el=$('#save-status');el.textContent=ok?'Lokal gespeichert':'Nicht gespeichert';el.classList.toggle('failed',!ok);el.title=ok?'Automatisch in diesem Browser gespeichert. Kein Cloud-Sync.':'Bitte eine Sicherung herunterladen.';}
function storageWarning(message) {const el=$('#storage-warning');el.hidden=!message;el.innerHTML=message?`${e(message)} <button data-action="backup">Sicherung herunterladen</button>${corruptRaw!==null?' <button data-action="corrupt-export">Originaldaten retten</button>':''}`:'';setSaveStatus(!message);}
try {
  const raw=localStorage.getItem(STORAGE_KEY);
  if(raw){try{state=normalizeState(JSON.parse(raw));}catch{corruptRaw=raw;storageWarning('Der vorhandene Speicher ist nicht lesbar. Er wurde nicht überschrieben. Bitte Originaldaten sichern und einen Plan oder ein Backup importieren.');}}
  else {state.updatedAt=new Date().toISOString();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
  if(corruptRaw===null)setSaveStatus(true);
} catch {memoryOnly=true;storageWarning('Der Browser blockiert das Speichern. Änderungen bleiben nur in dieser Sitzung.');}
function latest() {if(memoryOnly||corruptRaw!==null)return state;try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)return normalizeState(JSON.parse(raw));}catch{/* Keep the last valid in-memory state. */}return state;}
function save(next) {
  next.updatedAt=new Date().toISOString();state=next;
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));memoryOnly=false;storageWarning('');return true;}
  catch{memoryOnly=true;storageWarning('Automatisches Speichern ist fehlgeschlagen. Diese Änderungen sind nur in der Sitzung vorhanden; bitte eine Sicherung herunterladen.');return false;}
}
function mutate(fn) {
  if(corruptRaw!==null){toast('Bitte zuerst die Originaldaten sichern und einen gültigen Plan importieren.');return false;}
  const next=structuredClone(latest());fn(next);return save(next);
}
function backupAndApply(next) {
  try {
    const previous=localStorage.getItem(STORAGE_KEY);
    if(previous)localStorage.setItem(BACKUP_KEY,previous);
    next.updatedAt=new Date().toISOString();localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
    state=next;corruptRaw=null;memoryOnly=false;storageWarning('');return true;
  }catch{showModalError('Nicht übernommen: Der Browser konnte die Daten nicht sicher speichern. Bestehende Trainingsdaten bleiben erhalten. Bitte eine Sicherung herunterladen und freien Browserspeicher prüfen.');return false;}
}
function toast(message) {clearTimeout(toastTimer);const el=$('#toast');el.textContent=message;el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,3600);}
function download(data,name,type='application/json') {const blob=data instanceof Blob?data:new Blob([data],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function backup() {download(JSON.stringify({kind:'pista-backup',schemaVersion:1,exportedAt:new Date().toISOString(),state},null,2),`Pista-Sicherung-${iso()}.json`);toast('Sicherung heruntergeladen. Bitte sicher aufbewahren.');}
function head(title,subtitle,kicker='DEIN TRAINING') {return `<header class="page-head"><div><div class="eyebrow">${e(kicker)}</div><h1>${title}</h1><p>${e(subtitle)}</p></div><div class="head-actions"><button class="secondary" data-action="export">${icon('download')}PDF exportieren</button><button class="primary" data-action="import">${icon('upload')}Plan importieren</button></div></header>`;}
function meta(w,withDate=false) {return `<div class="workout-meta"><span>${icon('spark')}${e(TYPES[w.type])}</span><span>${icon('clock')}${w.durationMinutes} Min.</span>${withDate?`<span>${icon('calendar')}${e(formatDate(w.date))}</span>`:''}</div>`;}
function row(w) {const p=progressFor(state,w.id);return `<div class="workout-row"><button class="check-button ${p.done?'checked':''}" data-action="done" data-id="${w.id}" aria-label="${e(w.title)} ${p.done?'wieder öffnen':'abhaken'}" aria-pressed="${p.done}">${icon('check')}</button><button class="workout-open" data-action="open" data-id="${w.id}"><strong>${e(w.title)}</strong>${meta(w,true)}</button><span class="row-chevron">${icon('right')}</span></div>`;}
function statCards(s) {return `<div class="stats-row"><div class="card stat"><div class="stat-icon">${icon('check')}</div><div><strong>${s.done}<small class="muted"> / ${s.total}</small></strong><span>Einheiten erledigt</span></div></div><div class="card stat"><div class="stat-icon">${icon('clock')}</div><div><strong>${s.minutes}<small class="muted"> min</small></strong><span>Planzeit erledigt</span></div></div><div class="card stat"><div class="stat-icon">${icon('chart')}</div><div><strong>${s.percent}<small class="muted"> %</small></strong><span>Plan erfüllt</span></div></div></div>`;}
function navControls() {return `<div class="calendar-controls"><button class="icon-btn" data-action="previous" aria-label="Vorheriger Zeitraum">${icon('left')}</button><button class="text-button" data-action="today">Heute</button><button class="icon-btn" data-action="next" aria-label="Nächster Zeitraum">${icon('right')}</button></div>`;}
function overview() {return trackerView(state,{today,selected,expanded:expandedWorkouts,view:'overview',planMode},icon);}
function planView() {return trackerView(state,{today,selected,expanded:expandedWorkouts,view:'plan',planMode},icon);}
function progressView() {
  const all=stats(state),thisMonday=monday(today),weeks=Array.from({length:8},(_,i)=>{const start=addDays(thisMonday,(i-7)*7);return {start,...stats(state,start,addDays(start,6))};});
  const completed=state.plan.workouts.filter(w=>progressFor(state,w.id).done).sort((a,b)=>(progressFor(state,b.id).completedAt||b.date).localeCompare(progressFor(state,a.id).completedAt||a.date));
  return `${head('Schritt für Schritt.','Deine erledigten Einheiten machen den Unterschied.','FORTSCHRITT')}${statCards(all)}<div class="grid"><section class="card"><div class="section-heading"><h2>Dein Trainingsrhythmus</h2><span class="tag neutral">8 Wochen</span></div><p class="small muted">Erledigte Einheiten im Verhältnis zum jeweiligen Wochenplan.</p><div class="chart" role="img" aria-label="${e(weeks.map(w=>`${formatDate(w.start)}: ${w.done} von ${w.total}`).join('; '))}">${weeks.map(w=>`<div class="chart-col"><small>${w.done}/${w.total}</small><div class="chart-track"><div class="chart-bar" style="height:${w.percent}%"></div></div><span>${formatDate(w.start,{day:'2-digit',month:'2-digit'})}</span></div>`).join('')}</div></section><section class="card"><div class="section-heading"><h2>Deine Disziplinen</h2>${icon('spark')}</div>${Object.entries(TYPES).filter(([k])=>state.plan.workouts.some(w=>w.type===k)).map(([k,v])=>{const list=state.plan.workouts.filter(w=>w.type===k),done=list.filter(w=>progressFor(state,w.id).done).length;return `<div class="type-line"><span>${v}</span><div class="mini-track"><i style="width:${Math.round(done/list.length*100)}%"></i></div><span class="muted">${done}/${list.length}</span></div>`;}).join('')||'<p class="small muted">Importiere einen Plan, um deine Disziplinen zu sehen.</p>'}</section></div><section class="card history-list"><div class="section-heading"><h2>Zuletzt erledigt</h2><span class="tag green">${completed.length} Einheiten</span></div>${completed.length?completed.slice(0,20).map(row).join(''):`<div class="empty">${icon('check')}Dein erster Haken wartet auf dich.<br>Erledigte Trainings erscheinen hier automatisch.</div>`}</section><p class="notice">Fortschritt bedeutet hier: erledigte Einheiten, nicht gemessene Fitness. Die Minuten entsprechen der geplanten Dauer, nicht einer Stoppuhrmessung.</p>`;
}
function render() {
  const weekScroll=$('.by-weeks')?.scrollLeft||0;
  const links=[['overview','home','Übersicht'],['plan','calendar','Trainingsplan'],['progress','chart','Fortschritt']];
  for(const nav of document.querySelectorAll('.desktop-nav,.bottom-nav'))nav.innerHTML=links.map(([v,i,label])=>`<button class="nav-button ${view===v?'active':''}" data-action="nav" data-view="${v}" ${view===v?'aria-current="page"':''}>${icon(i)}${label}</button>`).join('');
  $('#main').innerHTML=view==='plan'?planView():view==='progress'?progressView():overview();
  if($('.by-weeks'))$('.by-weeks').scrollLeft=weekScroll;
}
function openModal(title,body,kicker='PISTA') {
  if(!modal.open)lastFocus=document.activeElement;
  modalWorkout=null;
  $('#modal-content').innerHTML=`<div class="modal-head"><div><div class="eyebrow">${e(kicker)}</div><h2 id="modal-title">${e(title)}</h2></div><button class="icon-btn" data-action="close" aria-label="Schließen">${icon('close')}</button></div><div class="modal-body">${body}<div id="modal-error" class="error" role="alert" hidden></div></div>`;
  if(!modal.open)modal.showModal();
}
function closeModal() {modal.close();modalWorkout=null;if(lastFocus?.isConnected)lastFocus.focus();}
function showModalError(message) {const el=$('#modal-error');if(el){el.textContent=message;el.hidden=false;}else toast(message);}
function openWorkout(id) {
  const w=state.plan.workouts.find(w=>w.id===id);if(!w){toast('Diese Einheit ist nicht mehr im aktuellen Plan.');return;}
  const p=progressFor(state,id);
  openModal(w.title,`${meta(w,true)}<p>${e(w.description)}</p>${state.plan.demo?'<p class="notice">Probe-Workout · Nur zum Kennenlernen der App.</p>':''}<div>${w.steps.map(s=>`<label class="step"><input type="checkbox" data-step="${s.id}" data-workout="${w.id}" ${p.steps[s.id]?'checked':''}><span><strong>${e(s.title)}</strong>${s.details?`<small>${e(s.details)}</small>`:''}</span></label>`).join('')}</div><label class="field"><span>Deine Notiz</span><textarea id="workout-note" data-workout="${w.id}" maxlength="2000" placeholder="Wie hat es sich angefühlt?">${e(p.note)}</textarea><small>Jede Änderung wird automatisch auf diesem Gerät gespeichert.</small></label><div class="modal-actions"><button class="primary full" id="detail-done" data-action="detail-done" data-id="${w.id}">${icon(p.done?'refresh':'check')}${p.done?'Wieder als offen markieren':'Workout abhaken'}</button></div>`,p.done?'ERLEDIGT':'DEIN WORKOUT');
  modalWorkout=id;
}
function openImport(error='') {
  pending=null;
  openModal('Platz für deinen Plan.',`<p>Importiere einen Trainingsplan als JSON oder CSV, einen Backyard-Wochenplan als JSON oder eine Pista-Sicherung. Du prüfst den Inhalt, bevor etwas geändert wird.</p><button class="file-drop" data-action="choose-file" id="drop-zone">${icon('upload')}<strong>Datei auswählen oder hier ablegen</strong><small>JSON oder CSV · maximal 2 MB</small></button><div class="modal-actions"><button class="secondary" data-action="template">JSON-Vorlage</button><button class="secondary" data-action="template-csv">CSV-Vorlage</button></div><p class="notice">Ein normales PDF lässt sich nicht zuverlässig als strukturierter Trainingsplan importieren. Nutze die Vorlage; PDFs sind hier für den Export vorgesehen.</p>`,'IMPORT');
  const drop=$('#drop-zone');drop.addEventListener('dragover',ev=>ev.preventDefault());drop.addEventListener('drop',ev=>{ev.preventDefault();if(ev.dataTransfer.files.length)loadFile(ev.dataTransfer.files[0]);});
  if(error)showModalError(error);
}
async function loadFile(file) {
  try {
    if(file.size>MAX_FILE_BYTES)throw new Error('Datei zu groß. Höchstens 2 MB.');
    pending=parseImport(await file.text(),file.name);
    const plan=pending.kind==='backup'?pending.state.plan:pending.plan;
    openModal(pending.kind==='backup'?'Sicherung wiederherstellen?':'Dein Plan ist bereit.',`<p>${pending.kind==='backup'?'Die Sicherung enthält den Plan samt Abhakungen und Notizen.':'Prüfe die Übersicht. Noch wurde nichts überschrieben.'}</p><div class="preview-list"><p><strong>${e(plan.title)}</strong></p><p>${plan.workouts.length} Trainingseinheiten</p><p>${plan.workouts.length?e(shortRange({start:plan.workouts[0].date,end:plan.workouts.at(-1).date})):'Noch keine Einheiten'}</p>${plan.workouts.slice(0,3).map(w=>`<p>${e(formatDate(w.date))} · ${e(w.title)}</p>`).join('')}</div><p class="notice">${pending.kind==='backup'?'Der aktuelle Stand wird durch diese Sicherung ersetzt.':'Beim Ersetzen beginnt der Fortschritt neu.'} Der bisherige Stand bleibt als letzte lokale Sicherung erhalten. Lade wichtige Daten zusätzlich als Datei herunter.</p><div class="modal-actions"><button class="secondary" data-action="backup">Bisherigen Stand sichern</button><button class="primary" data-action="import-confirm">${pending.kind==='backup'?'Wiederherstellen':'Plan ersetzen'}</button>${pending.kind==='plan'&&!state.plan.demo?'<button class="secondary full" data-action="merge-confirm">Mit bestehendem Plan zusammenführen</button>':''}</div>${pending.kind==='plan'&&!state.plan.demo?'<p class="small muted" style="margin-top:12px">Beim Zusammenführen werden gleiche Trainings-IDs aktualisiert. Passende Abhakungen und Notizen bleiben erhalten.</p>':''}`,'IMPORT-VORSCHAU');
  }catch(error){openImport(error.message);}
}
function openExport() {
  openModal('Dein Plan. Auch auf Papier.',`<p>Ein aufgeräumtes PDF im DIN-A4-Hochformat. Wähle deinen Zeitraum; umfangreiche Pläne werden auf mehrere Seiten verteilt.</p><div class="export-options">${Object.entries(modeLabels).map(([k,label])=>`<label class="export-option"><input type="radio" name="pdf-mode" value="${k}" ${k===planMode?'checked':''}>${icon(k==='month'?'calendar':'file')}<strong>${label}</strong></label>`).join('')}</div><label class="field"><span>Datum im gewünschten Zeitraum</span><input id="pdf-date" type="date" value="${selected}" required><small id="pdf-range"></small></label><label class="inline-check"><input id="pdf-details" type="checkbox">Übungsblöcke und persönliche Notizen einschließen</label><p class="notice">Wochen beginnen montags. „2 Wochen“ umfasst die gewählte Kalenderwoche und die folgende; „Monat“ den vollständigen Kalendermonat.</p><div class="modal-actions"><button class="primary full" data-action="export-pdf">${icon('download')}A4-PDF herunterladen</button></div>`,'PDF-EXPORT');
  updateExportRange();
}
function updateExportRange() {try{const mode=$('input[name="pdf-mode"]:checked')?.value;$('#pdf-range').textContent=shortRange(range(mode,$('#pdf-date').value));}catch{$('#pdf-range').textContent='Bitte ein gültiges Datum auswählen.';}}
function openData() {
  openModal('Dein Training bleibt deins.',`<p>Pista speichert deinen Plan, alle Haken und deine Notizen automatisch in diesem Browser. Die App liegt auf GitHub Pages; deine Trainingsdaten werden nicht ins öffentliche Repository hochgeladen.</p><button class="data-item" data-action="backup">${icon('download')}<div><strong>Sicherung herunterladen</strong><span>Plan, Fortschritt und Notizen als JSON</span></div></button><button class="data-item" data-action="plan-export">${icon('file')}<div><strong>Nur Trainingsplan exportieren</strong><span>Ohne Haken und persönliche Notizen</span></div></button><button class="data-item" data-action="import">${icon('upload')}<div><strong>Plan oder Sicherung importieren</strong><span>Auch zum Übertragen auf ein anderes Gerät</span></div></button><button class="data-item" data-action="restore-previous">${icon('refresh')}<div><strong>Letzten Import rückgängig machen</strong><span>Den vorherigen lokalen Stand wiederherstellen</span></div></button><button class="data-item" data-action="reset-dialog">${icon('spark')}<div><strong>Mit der Demo neu starten</strong><span>Nur nach zusätzlicher Bestätigung</span></div></button><p class="notice">Kein automatischer Geräteabgleich. Gelöschte Browserdaten, Privatmodus oder ein Gerätewechsel können lokale Daten entfernen. Sichere deinen Fortschritt regelmäßig als Datei. Pista verwendet keine Analyse- oder Trackingdienste; für das Hosting gelten die Datenschutzbedingungen von GitHub.</p>`,'DATEN & SICHERUNG');
}
function navigate(v) {view=v;location.hash=v;render();window.scrollTo({top:0,behavior:'instant'});}
function changePeriod(delta) {const mode=view==='plan'?planMode:'week';if(mode==='month'){const d=date(selected);selected=iso(new Date(d.getFullYear(),d.getMonth()+delta,1,12));}else selected=addDays(selected,delta*(mode==='fortnight'?14:7));render();}
function template(csv=false) {
  if(csv)download('date,title,type,durationMinutes,description,steps\n'+today+',Beispiel-Workout,mobility,25,Nur eine Vorlage - individuell anpassen,Aufwärmen | Hauptteil | Ausklang\n','Pista-Planvorlage.csv','text/csv;charset=utf-8');
  else {const plan=demoPlan(today);plan.id='mein-plan';plan.title='Mein Trainingsplan';plan.demo=false;download(JSON.stringify(plan,null,2),'Pista-Planvorlage.json');}
}
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-action]');if(!b)return;
  const {action,id}=b.dataset;
  switch(action) {
    case 'nav':navigate(b.dataset.view);break;
    case 'open':openWorkout(id);break;
    case 'expand':if(expandedWorkouts.has(id))expandedWorkouts.delete(id);else expandedWorkouts.add(id);render();break;
    case 'tracker-week':selected=b.dataset.date;planMode='week';render();$('.by-week.active')?.scrollIntoView({block:'nearest',inline:'nearest'});break;
    case 'export-paper':openExport();break;
    case 'done': {const ok=mutate(s=>setDone(s,id,!progressFor(s,id).done));render();if(ok)toast(progressFor(state,id).done?'Training erledigt. Fortschritt gespeichert.':'Training wieder geöffnet.');break;}
    case 'detail-done': {const ok=mutate(s=>setDone(s,id,!progressFor(s,id).done));render();openWorkout(id);if(ok)toast('Fortschritt gespeichert.');break;}
    case 'close':closeModal();break;
    case 'day':selected=b.dataset.date;render();break;
    case 'previous':changePeriod(-1);break;
    case 'next':changePeriod(1);break;
    case 'today':selected=today;render();break;
    case 'mode':planMode=b.dataset.mode;render();break;
    case 'first-training':if(state.plan.workouts.length){selected=state.plan.workouts[0].date;render();}else openImport();break;
    case 'import':openImport();break;
    case 'export':openExport();break;
    case 'data':openData();break;
    case 'backup':backup();break;
    case 'plan-export':download(JSON.stringify(state.plan,null,2),`Pista-Trainingsplan-${iso()}.json`);break;
    case 'template':template();break;
    case 'template-csv':template(true);break;
    case 'choose-file':$('#file-input').value='';$('#file-input').click();break;
    case 'corrupt-export':if(corruptRaw!==null)download(corruptRaw,'Pista-Originaldaten.txt','text/plain');break;
    case 'import-confirm':case 'merge-confirm': {
      if(!pending)break;
      const next=pending.kind==='backup'?pending.state:action==='merge-confirm'?mergePlan(latest(),pending.plan):{version:1,plan:pending.plan,progress:{},updatedAt:null};
      if(backupAndApply(next)){selected=state.plan.workouts[0]?.date||today;pending=null;closeModal();navigate('plan');toast('Plan übernommen und gespeichert.');}break;
    }
    case 'restore-previous': {
      try{const raw=localStorage.getItem(BACKUP_KEY);if(!raw){showModalError('Noch kein vorheriger Import vorhanden.');break;}const previous=normalizeState(JSON.parse(raw));pending={kind:'backup',state:previous};openModal('Vorherigen Stand wiederherstellen?',`<p>Du stellst „${e(previous.plan.title)}“ mit ${previous.plan.workouts.length} Einheiten samt Fortschritt wieder her. Der aktuelle Stand wird zuvor lokal gesichert.</p><div class="modal-actions"><button class="secondary" data-action="close">Abbrechen</button><button class="primary" data-action="import-confirm">Wiederherstellen</button></div>`,'SICHERUNG');}catch{showModalError('Der vorherige Stand ist nicht lesbar. Die aktuellen Daten wurden nicht verändert.');}break;
    }
    case 'reset-dialog':openModal('Wirklich neu beginnen?',`<p>Der aktuelle Plan und Fortschritt werden durch die Demo ersetzt. Lade vorher eine Sicherung herunter. Der letzte Stand wird zusätzlich lokal gesichert.</p><div class="modal-actions"><button class="secondary" data-action="backup">Sicherung laden</button><button class="primary" data-action="reset-confirm">Demo neu starten</button></div>`,'NEUSTART');break;
    case 'reset-confirm':if(backupAndApply(initialState(today))){selected=today;closeModal();navigate('overview');toast('Demo geladen.');}break;
    case 'export-pdf': {
      try{const result=createTrainingPDF(state,$('input[name="pdf-mode"]:checked').value,$('#pdf-date').value,$('#pdf-details').checked);download(result.bytes,result.filename,'application/pdf');toast(result.unsupportedCharacters?'PDF erstellt. Nicht-lateinische Zeichen wurden durch ? ersetzt.':`PDF erstellt · ${result.pageCount} ${result.pageCount===1?'Seite':'Seiten'} · DIN A4`);}catch(error){showModalError(error.message);}break;
    }
  }
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.matches('[data-inline-step]')) {mutate(s=>setStep(s,el.dataset.workout,el.dataset.inlineStep,el.checked));render();}
  if(el.matches('[data-step]')) {
    mutate(s=>setStep(s,el.dataset.workout,el.dataset.step,el.checked));render();
    const p=progressFor(state,el.dataset.workout),button=$('#detail-done');if(button)button.innerHTML=icon(p.done?'refresh':'check')+(p.done?'Wieder als offen markieren':'Workout abhaken');
  }
  if(el.matches('#pdf-date,input[name="pdf-mode"]'))updateExportRange();
});
document.addEventListener('input',event=>{const el=event.target;if(el.id==='workout-note')mutate(s=>{if(s.plan.workouts.some(w=>w.id===el.dataset.workout))s.progress[el.dataset.workout]={...progressFor(s,el.dataset.workout),note:el.value.slice(0,2000)};});});
$('#file-input').addEventListener('change',event=>{if(event.target.files[0])loadFile(event.target.files[0]);});
$('#data-button').innerHTML=icon('settings');$('#data-button').addEventListener('click',openData);$('#privacy-button').addEventListener('click',openData);
modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}});
modal.addEventListener('close',()=>{modalWorkout=null;});
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(['overview','plan','progress'].includes(v)&&view!==v){view=v;render();}});
window.addEventListener('storage',event=>{if(event.key!==STORAGE_KEY||memoryOnly||corruptRaw!==null)return;try{if(event.newValue){state=normalizeState(JSON.parse(event.newValue));render();if(modalWorkout&&document.activeElement?.id!=='workout-note')openWorkout(modalWorkout);setSaveStatus(true);}else storageWarning('Der lokale Speicher wurde in einem anderen Tab gelöscht. Bitte sichere diesen Stand.');}catch{storageWarning('Der Speicher wurde in einem anderen Tab ungültig geändert. Bitte sichere diesen Stand.');}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&iso()!==today){today=iso();selected=today;render();}});
render();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{/* Offline cache is optional; training storage is independent. */});
