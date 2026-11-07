import {trackerView,groupedWeeks} from './tracker-view.js';
import {TRAINING_PLAN,updateClientPlanState} from './training-plan.js';
import {STORAGE_KEY,BACKUP_KEY,MAX_FILE_BYTES,TYPES,iso,addDays,monday,range,formatDate,shortRange,demoPlan,normalizePlan,normalizeState,parseImport,mergePlan,progressFor,setDone,stats,escapeHTML as e} from './core.js';
import {createTrainingPDF} from './pdf.js';
import {createPwaManager,APP_VERSION} from './pwa.js';
import {createGitHubBackup,parseGitHubRepository} from './github-backup.js';
const $=s=>document.querySelector(s);
const icons={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M7 15h2m6 0h2m-10 3h2"/>',chart:'<path d="M4 20h16M6 16v-5m6 5V4m6 12V8"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',check:'<path d="m5 12 4 4 10-10"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',file:'<path d="M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8zM14 2v6h6M8 13h8m-8 4h6"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="8" cy="18" r="2" fill="white"/>',refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.spark}</svg>`;
const modeLabels={all:'Ganzer Plan',week:'Woche',fortnight:'2 Wochen',month:'Monat'};
const clientState=()=>({version:1,plan:normalizePlan(TRAINING_PLAN),progress:{},updatedAt:null});
let today=iso(),selected=today,view=location.hash==='#progress'?'progress':'plan';
let state=clientState(),pending=null,corruptRaw=null,memoryOnly=false,toastTimer,lastFocus=null,modalWorkout=null;
let githubClient=null,githubSnapshot=null,githubBusy=false;
const GITHUB_PREF_KEY='pista.github.preferences.v1';
let githubPreferences={};
try{const value=JSON.parse(localStorage.getItem(GITHUB_PREF_KEY)||'{}');if(typeof value.repository==='string')githubPreferences.repository=parseGitHubRepository(value.repository);if(typeof value.exportedAt==='string'&&Number.isFinite(Date.parse(value.exportedAt)))githubPreferences.exportedAt=value.exportedAt;}catch{/* Optional non-secret preferences only. */}
const modal=$('#modal');
const pwa=createPwaManager({onChange:updatePwaUI});
function setSaveStatus(ok=true) {const el=$('#save-status');el.textContent=ok?'Lokal gespeichert':'Nicht gespeichert';el.classList.toggle('failed',!ok);el.title=ok?'Automatisch in diesem Browser gespeichert. Kein Cloud-Sync.':'Bitte eine Sicherung herunterladen.';}
function storageWarning(message) {const el=$('#storage-warning');el.hidden=!message;el.innerHTML=message?`${e(message)} <button data-action="backup">Sicherung herunterladen</button>${corruptRaw!==null?' <button data-action="corrupt-export">Originaldaten retten</button>':''}`:'';setSaveStatus(!message);}
try {
  const raw=localStorage.getItem(STORAGE_KEY);
  if(raw){
    try{state=normalizeState(JSON.parse(raw));}catch{corruptRaw=raw;storageWarning('Der vorhandene Speicher ist nicht lesbar. Er wurde nicht überschrieben. Bitte Originaldaten sichern und einen Plan oder ein Backup importieren.');}
    if(corruptRaw===null&&state.plan.demo){
      localStorage.setItem(BACKUP_KEY,raw);
      state=clientState();state.updatedAt=new Date().toISOString();
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    }
    else if(corruptRaw===null){
      const updated=updateClientPlanState(state);
      if(updated!==state){state=updated;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
    }
  }
  else {state.updatedAt=new Date().toISOString();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
  if(corruptRaw===null)setSaveStatus(true);
} catch {memoryOnly=true;storageWarning('Der Browser blockiert das Speichern. Änderungen bleiben nur in dieser Sitzung.');}
function latest() {if(memoryOnly||corruptRaw!==null)return state;try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)return updateClientPlanState(normalizeState(JSON.parse(raw)));}catch{/* Keep the last valid in-memory state. */}return state;}
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
    next=updateClientPlanState(next);
    const previous=localStorage.getItem(STORAGE_KEY);
    if(previous)localStorage.setItem(BACKUP_KEY,previous);
    next.updatedAt=new Date().toISOString();localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
    state=next;corruptRaw=null;memoryOnly=false;storageWarning('');return true;
  }catch{showModalError('Nicht übernommen: Der Browser konnte die Daten nicht sicher speichern. Bestehende Trainingsdaten bleiben erhalten. Bitte eine Sicherung herunterladen und freien Browserspeicher prüfen.');return false;}
}
function toast(message) {clearTimeout(toastTimer);const el=$('#toast');el.textContent=message;el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,3600);}
function download(data,name,type='application/json') {const blob=data instanceof Blob?data:new Blob([data],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function backup() {download(JSON.stringify({kind:'pista-backup',schemaVersion:1,exportedAt:new Date().toISOString(),state},null,2),`Pista-Sicherung-${iso()}.json`);toast('Sicherung heruntergeladen. Bitte sicher aufbewahren.');}
function head(title,subtitle,kicker='DEIN TRAINING') {return `<header class="page-head"><div><div class="eyebrow">${e(kicker)}</div><h1>${title}</h1><p>${e(subtitle)}</p></div><div class="head-actions"><button class="primary" data-action="export">${icon('download')}PDF-Übersicht</button></div></header>`;}
function meta(w,withDate=false) {return `<div class="workout-meta"><span>${icon(w.type==='rest'?'moon':'spark')}${e(w.sessionCode==='U'?'Uni-Sport':TYPES[w.type])}</span>${withDate?`<span>${icon('calendar')}${e(formatDate(w.date,{weekday:'long',day:'numeric',month:'long'}))}</span>`:''}${w.startTime?`<span>${icon('clock')}${e(w.startTime+'–'+w.endTime)} Uhr</span>`:''}${w.type==='rest'?'':`<span>${e(w.durationLabel||(w.durationMinutes?w.durationMinutes+' Min.':'Dauer offen'))}</span>`}${w.zone?`<span>${e(w.zone)}</span>`:''}${w.optional?'<span>Freiwillig</span>':''}</div>`;}
function entriesLabel(plan=state.plan) {return plan.workouts.some(w=>w.type==='rest')?(new Set(plan.workouts.map(w=>w.date)).size===plan.workouts.length?'Tage':'Einträge'):'Einheiten';}
function doneLabel(w,p) {return p.done?'Wieder als offen markieren':w.type==='rest'?'Ruhetag abhaken':'Workout abhaken';}
function workoutHints(w) {return w.instructions?`<section class="training-hints"><h3>Hinweise & Alternativen</h3><p>${e(w.instructions)}</p></section>`:'';}

function row(w) {const p=progressFor(state,w.id);return `<div class="workout-row history-row"><button class="check-button ${p.done?'checked':''}" data-action="done" data-id="${w.id}" aria-label="${e(w.title)} ${p.done?'wieder öffnen':'abhaken'}" aria-pressed="${p.done}">${icon('check')}</button><div class="history-summary"><strong>${e(w.title)}</strong>${meta(w,true)}<button class="text-button" data-action="open" data-id="${w.id}">${w.type==='rest'?'Ruhetag anzeigen':'Workout anzeigen'} ${icon('arrow')}</button></div></div>`;}
function statCards(s) {return `<div class="stats-row"><div class="card stat"><div class="stat-icon">${icon('check')}</div><div><strong>${s.done}<small class="muted"> / ${s.total}</small></strong><span>${entriesLabel()} abgehakt</span></div></div><div class="card stat"><div class="stat-icon">${icon('clock')}</div><div><strong>${s.minutes}<small class="muted"> min</small></strong><span>Trainingszeit erledigt</span></div></div><div class="card stat"><div class="stat-icon">${icon('chart')}</div><div><strong>${s.percent}<small class="muted"> %</small></strong><span>Plan erfüllt</span></div></div></div>`;}
function planView() {return trackerView(state,{today,selected},icon);}
function backupPanel() {return `<section class="card backup-panel" aria-label="Datensicherung"><div class="section-heading"><h2>Deinen Fortschritt sichern</h2>${icon('shield')}</div><p>Plan, Haken und Notizen aufbewahren oder auf ein anderes Gerät mitnehmen.</p><button class="data-item" data-action="github-backup">${icon('upload')}<div><strong>GitHub-Sicherung</strong><span>${githubPreferences.exportedAt?'Zuletzt von diesem Gerät gesichert: '+e(backupDate(githubPreferences.exportedAt)):'Optional in einem privaten Repository speichern'}</span></div></button><button class="data-item" data-action="backup">${icon('download')}<div><strong>Sicherungsdatei herunterladen</strong><span>Zum Beispiel in iCloud Drive, Google Drive oder OneDrive ablegen</span></div></button></section>`;}
function progressView() {
  const all=stats(state),thisMonday=monday(today),weeks=Array.from({length:8},(_,i)=>{const start=addDays(thisMonday,(i-7)*7);return {start,...stats(state,start,addDays(start,6))};});
  const completed=state.plan.workouts.filter(w=>progressFor(state,w.id).done).sort((a,b)=>(progressFor(state,b.id).completedAt||b.date).localeCompare(progressFor(state,a.id).completedAt||a.date));
  return `${head('Schritt für Schritt.',all.restTotal?'Training und Erholung gehören zusammen.':'Deine erledigten Einheiten machen den Unterschied.','FORTSCHRITT')}${statCards(all)}<div class="grid"><section class="card"><div class="section-heading"><h2>Dein Trainingsrhythmus</h2><span class="tag neutral">8 Wochen</span></div><p class="small muted">${entriesLabel()} abgehakt im jeweiligen Wochenplan.</p><div class="chart" role="img" aria-label="${e(weeks.map(w=>`${formatDate(w.start)}: ${w.done} von ${w.total}`).join('; '))}">${weeks.map(w=>`<div class="chart-col"><small>${w.done}/${w.total}</small><div class="chart-track"><div class="chart-bar" style="height:${w.percent}%"></div></div><span>${formatDate(w.start,{day:'2-digit',month:'2-digit'})}</span></div>`).join('')}</div></section><section class="card"><div class="section-heading"><h2>${all.restTotal?'Training & Erholung':'Deine Disziplinen'}</h2>${icon('spark')}</div>${Object.entries(TYPES).filter(([k])=>state.plan.workouts.some(w=>w.type===k)).map(([k,v])=>{const list=state.plan.workouts.filter(w=>w.type===k),done=list.filter(w=>progressFor(state,w.id).done).length;return `<div class="type-line"><span>${v}</span><div class="mini-track"><i style="width:${Math.round(done/list.length*100)}%"></i></div><span class="muted">${done}/${list.length}</span></div>`;}).join('')||'<p class="small muted">Importiere einen Plan, um deine Disziplinen zu sehen.</p>'}</section></div><section class="card history-list"><div class="section-heading"><h2>Zuletzt erledigt</h2><span class="tag green">${completed.length} ${entriesLabel()}</span></div>${completed.length?completed.slice(0,20).map(row).join(''):`<div class="empty">${icon('check')}Dein erster Haken wartet auf dich.<br>Abgehakte ${entriesLabel()} erscheinen hier automatisch.</div>`}</section><p class="notice">${all.restTotal?'Der Fortschritt zählt Training und Ruhetage. Ruhetage zählen ohne Trainingsminuten.':'Der Fortschritt zählt abgehakte Einheiten.'} Die Minuten entsprechen der geplanten Trainingsdauer.</p>${backupPanel()}`;
}
function render() {
  const weekScroll=$('.by-weeks')?.scrollLeft||0;
  const links=[['plan','calendar','Trainingsplan'],['progress','chart','Fortschritt']];
  for(const nav of document.querySelectorAll('.desktop-nav,.bottom-nav'))nav.innerHTML=links.map(([v,i,label])=>`<button class="nav-button ${view===v?'active':''}" data-action="nav" data-view="${v}" ${view===v?'aria-current="page"':''}>${icon(i)}${label}</button>`).join('');
  $('#main').innerHTML=view==='progress'?progressView():planView();
  if($('.by-weeks'))$('.by-weeks').scrollLeft=weekScroll;
}
function openModal(title,body,kicker='PISTA') {
  if(!modal.open)lastFocus=document.activeElement;
  modalWorkout=null;
  $('#modal-content').innerHTML=`<div class="modal-head"><div><div class="eyebrow">${e(kicker)}</div><h2 id="modal-title">${e(title)}</h2></div><button class="icon-btn" data-action="close" aria-label="Schließen">${icon('close')}</button></div><div class="modal-body">${body}<div id="modal-error" class="error" role="alert" hidden></div></div>`;
  if(!modal.open)modal.showModal();
}
function restoreModalFocus() {
  if(modal.open)return;
  const id=modalWorkout;modalWorkout=null;
  const target=lastFocus?.isConnected?lastFocus:(id?document.querySelector(`main [data-action="open"][data-id="${id}"]`):null)||$('#data-button');
  if(target){target.focus({preventScroll:true});lastFocus=target;}
}
function closeModal() {modal.close();restoreModalFocus();}
function showModalError(message) {const el=$('#modal-error');if(el){el.textContent=message;el.hidden=false;}else toast(message);}
function openWorkout(id) {
  const w=state.plan.workouts.find(w=>w.id===id);if(!w){toast('Diese Einheit ist nicht mehr im aktuellen Plan.');return;}
  const p=progressFor(state,id);
  openModal(w.title,`${meta(w,true)}${w.focus?`<p class="workout-focus">${e(w.focus)}</p>`:''}<p>${e(w.description)}</p>${state.plan.demo?'<p class="notice">Probe-Workout · Nur zum Kennenlernen der App.</p>':''}${w.steps.length?`<ol class="workout-sequence">${w.steps.map((s,i)=>`<li class="workout-block"><span class="workout-number" aria-hidden="true">${i+1}</span><div><h3>${e(s.title)}</h3>${s.details?`<p>${e(s.details)}</p>`:''}</div></li>`).join('')}</ol>`:''}${workoutHints(w)}<label class="field"><span>Deine Notiz</span><textarea id="workout-note" data-workout="${w.id}" maxlength="2000" placeholder="Wie hat es sich angefühlt?">${e(p.note)}</textarea><small>Jede Änderung wird automatisch auf diesem Gerät gespeichert.</small></label><div class="modal-actions"><button class="primary full" id="detail-done" data-action="detail-done" data-id="${w.id}" aria-pressed="${p.done}">${icon(p.done?'refresh':'check')}${doneLabel(w,p)}</button></div>`,p.done?'ERLEDIGT':w.type==='rest'?'DEIN RUHETAG':'DEIN WORKOUT');
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
    if(pending.kind==='backup')pending.state=updateClientPlanState(pending.state);
    else pending.plan=updateClientPlanState({plan:pending.plan}).plan;
    const plan=pending.kind==='backup'?pending.state.plan:pending.plan;
    openModal(pending.kind==='backup'?'Sicherung wiederherstellen?':'Dein Plan ist bereit.',`<p>${pending.kind==='backup'?'Die Sicherung enthält den Plan samt Abhakungen und Notizen.':'Prüfe die Übersicht. Noch wurde nichts überschrieben.'}</p><div class="preview-list"><p><strong>${e(plan.title)}</strong></p><p>${plan.workouts.length} ${entriesLabel(plan)}</p><p>${plan.workouts.length?e(shortRange({start:plan.workouts[0].date,end:plan.workouts.at(-1).date})):'Noch keine Einheiten'}</p>${plan.workouts.slice(0,3).map(w=>`<p>${e(formatDate(w.date))} · ${e(w.title)}</p>`).join('')}</div><p class="notice">${pending.kind==='backup'?'Der aktuelle Stand wird durch diese Sicherung ersetzt.':'Beim Ersetzen beginnt der Fortschritt neu.'} Der bisherige Stand bleibt als letzte lokale Sicherung erhalten. Lade wichtige Daten zusätzlich als Datei herunter.</p><div class="modal-actions"><button class="secondary" data-action="backup">Bisherigen Stand sichern</button><button class="primary" data-action="import-confirm">${pending.kind==='backup'?'Wiederherstellen':'Plan ersetzen'}</button>${pending.kind==='plan'&&!state.plan.demo?'<button class="secondary full" data-action="merge-confirm">Mit bestehendem Plan zusammenführen</button>':''}</div>${pending.kind==='plan'&&!state.plan.demo?'<p class="small muted" style="margin-top:12px">Beim Zusammenführen werden gleiche Trainings-IDs aktualisiert. Passende Abhakungen und Notizen bleiben erhalten.</p>':''}`,'IMPORT-VORSCHAU');
  }catch(error){openImport(error.message);}
}
function openExport(layout='overview') {
  openModal('Dein Plan als PDF',`<p>Zum Anschauen, Ausdrucken und Abhaken.</p><fieldset class="pdf-fieldset"><legend>Darstellung</legend><div class="pdf-layouts"><label class="pdf-choice"><input type="radio" name="pdf-layout" value="overview" ${layout==='overview'?'checked':''}><span><b>Übersicht</b><small>Termine und aktueller Fortschritt</small></span></label><label class="pdf-choice"><input type="radio" name="pdf-layout" value="checklist" ${layout==='checklist'?'checked':''}><span><b>Checkliste</b><small>Leere Kästchen und Platz für Notizen</small></span></label></div></fieldset><fieldset class="pdf-fieldset"><legend>Zeitraum</legend><div class="export-options">${Object.entries(modeLabels).map(([k,label])=>`<label class="export-option"><input type="radio" name="pdf-mode" value="${k}" ${k==='all'?'checked':''}><strong>${label}</strong></label>`).join('')}</div></fieldset><label class="field" id="pdf-date-field"><span>Datum im gewünschten Zeitraum</span><input id="pdf-date" type="date" value="${selected}" required></label><p id="pdf-range" class="pdf-range"></p><label class="inline-check"><input id="pdf-details" type="checkbox">Übungen, Pausen und Hinweise mit ausgeben</label><label class="inline-check"><input id="pdf-notes" type="checkbox">Meine gespeicherten Notizen mit ausgeben</label><p class="small muted">DIN A4 · Direkt herunterladen · Ohne Anmeldung</p><div class="modal-actions"><button class="primary full" data-action="export-pdf">${icon('download')}PDF herunterladen</button></div>`,'PDF-EXPORT');
  updateExportRange();
}
function updateExportRange() {
  try {
    const mode=$('input[name="pdf-mode"]:checked')?.value;
    $('#pdf-date-field').hidden=mode==='all';
    const ws=state.plan.workouts;
    $('#pdf-range').textContent=mode==='all'?(ws.length?shortRange({start:ws[0].date,end:ws.at(-1).date})+' · '+ws.length+' '+entriesLabel():'Noch keine Einheiten'):shortRange(range(mode,$('#pdf-date').value));
  }catch{$('#pdf-range').textContent='Bitte ein gültiges Datum auswählen.';}
}

function appSettings() {
  return `<section class="app-panel" aria-label="Web-App und Updates"><div class="app-panel-heading"><h3>Pista als App</h3><span class="app-version">Version ${e(APP_VERSION)}</span></div><p>Direkt vom Startbildschirm öffnen – auch ohne Internet, sobald die App einmal vollständig geladen wurde.</p><button class="secondary full" id="app-install-button" data-action="install-app">${icon('download')}Web-App installieren</button><div class="app-update-panel"><p id="app-update-status" role="status" aria-live="polite" data-status="idle">Updates werden beim Öffnen geprüft.</p><div class="app-update-actions"><button class="secondary" id="app-check-button" data-action="check-update">${icon('refresh')}Nach Updates suchen</button><button class="primary" id="app-apply-button" data-action="apply-update" hidden>${icon('refresh')}Jetzt aktualisieren</button></div><small>Updates behalten deine Haken und Notizen. Die App bleibt installiert.</small></div></section>`;
}
function updatePwaUI(snapshot) {
  const busy=snapshot.status==='checking'||snapshot.status==='updating';
  const available=snapshot.status==='available';
  const banner=$('#app-update-banner');
  if(banner){
    banner.hidden=!available&&snapshot.status!=='updating';
    $('#app-update-banner-text').textContent=snapshot.status==='updating'?'Update wird übernommen …':'Eine neue Version von Pista ist bereit.';
    const action=$('#app-update-banner-button');action.disabled=busy;action.textContent=busy?'Wird aktualisiert …':'Jetzt aktualisieren';
  }
  const status=$('#app-update-status');
  if(status){status.textContent=snapshot.message||'Updates werden beim Öffnen geprüft.';status.dataset.status=snapshot.status;}
  const check=$('#app-check-button');
  if(check){check.disabled=busy;check.innerHTML=icon('refresh')+(snapshot.status==='checking'?'Wird geprüft …':'Nach Updates suchen');}
  const apply=$('#app-apply-button');
  if(apply){apply.hidden=!available&&snapshot.status!=='updating';apply.disabled=busy;apply.innerHTML=icon('refresh')+(snapshot.status==='updating'?'Wird aktualisiert …':'Jetzt aktualisieren');}
  const install=$('#app-install-button');
  if(install){install.disabled=snapshot.installed;install.innerHTML=icon(snapshot.installed?'check':'download')+(snapshot.installed?'Als Web-App geöffnet':'Web-App installieren');}
}
function openInstallHelp() {
  const isApple=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const isAndroid=/Android/i.test(navigator.userAgent);
  const steps=isApple
    ?'<li>Öffne Pista in <strong>Safari</strong>.</li><li>Tippe auf <strong>Teilen</strong>, dann auf <strong>Zu Home-Bildschirm hinzufügen</strong>.</li><li>Lass <strong>Als Web-App öffnen</strong> eingeschaltet, falls angezeigt, und tippe auf <strong>Hinzufügen</strong>.</li>'
    :isAndroid
      ?'<li>Öffne Pista in <strong>Chrome</strong>.</li><li>Öffne das Menü <strong>⋮</strong> und wähle <strong>Installieren und Verknüpfung erstellen</strong> bzw. <strong>App installieren</strong>.</li><li>Bestätige <strong>Installieren</strong>. Danach öffnest du Pista über das App-Symbol.</li>'
      :'<li>Öffne Pista in <strong>Chrome oder Edge</strong>.</li><li>Nutze das Installationssymbol in der Adressleiste oder den Menüpunkt <strong>App installieren</strong>.</li><li>Auf dem iPhone: <strong>Safari → Teilen → Zu Home-Bildschirm hinzufügen</strong>.</li>';
  openModal('Pista als Web-App nutzen',`<p>Einmal installieren, danach über das Pista-Symbol öffnen.</p><ol class="app-install-steps">${steps}</ol><p class="notice">Neue Versionen über <strong>Einstellungen → Nach Updates suchen</strong> laden. Haken und Notizen bleiben beim Update erhalten.</p><div class="modal-actions"><button class="primary full" data-action="data">Zurück zu den Einstellungen</button></div>`,'WEB-APP');
}
async function installApp() {
  try {if(await pwa.install()==='unavailable')openInstallHelp();}
  catch {openInstallHelp();}
}
function applyAppUpdate() {
  if(memoryOnly||corruptRaw!==null){toast('Bitte zuerst deine Daten sichern. Solange das Speichern blockiert ist, wird die App nicht neu geladen.');return;}
  void pwa.applyUpdate();
}
function openData() {
  openModal('Einstellungen',`${appSettings()}<h3 class="data-section-heading">Daten & Sicherung</h3><p>Haken und Notizen werden auf diesem Gerät gespeichert. Eine GitHub-Sicherung bewahrt zusätzlich eine Kopie außerhalb des Geräts auf.</p><button class="data-item" data-action="github-backup">${icon('upload')}<div><strong>GitHub-Sicherung</strong><span>Privates Repository verbinden, sichern oder wiederherstellen</span></div></button><button class="data-item" data-action="backup">${icon('download')}<div><strong>Sicherung herunterladen</strong><span>Plan, Haken und Notizen</span></div></button><button class="data-item" data-action="import">${icon('upload')}<div><strong>Plan oder Sicherung importieren</strong><span>JSON oder CSV auswählen</span></div></button>${state.plan.id!==TRAINING_PLAN.id?`<button class="data-item" data-action="load-client-plan">${icon('calendar')}<div><strong>Trainingsplan bis Januar laden</strong><span>Den vorbereiteten Plan öffnen</span></div></button>`:''}<details class="data-more"><summary>Weitere Optionen</summary><button class="data-item" data-action="plan-export">${icon('file')}<div><strong>Nur den Plan herunterladen</strong><span>JSON ohne Haken und Notizen</span></div></button><button class="data-item" data-action="restore-previous">${icon('refresh')}<div><strong>Letzten Import rückgängig machen</strong><span>Vorherigen Stand wiederherstellen</span></div></button><button class="data-item" data-action="reset-dialog">${icon('refresh')}<div><strong>Fortschritt zurücksetzen</strong><span>Plan behalten und neu beginnen</span></div></button></details><p class="notice">Kein automatischer Geräteabgleich. Sichere den Stand vor einem Gerätewechsel auf GitHub oder als Datei.</p>`,'PISTA');
  updatePwaUI(pwa.getState());
}

function backupDate(value) {return new Date(value).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function rememberGitHub(values) {githubPreferences={...githubPreferences,...values};try{localStorage.setItem(GITHUB_PREF_KEY,JSON.stringify(githubPreferences));}catch{/* Remote backups do not depend on local preference saving. */}}
function githubPanelOpen() {return modal.open&&Boolean($('#github-panel'));}
function githubButtonsBusy(busy,message='') {
  githubBusy=busy;
  for(const button of document.querySelectorAll('#github-panel button'))button.disabled=busy;
  const status=$('#github-message');if(status)status.textContent=message;
}
function openGitHubBackup() {
  const connected=Boolean(githubClient),remote=githubSnapshot?.backup,ready=Boolean(githubSnapshot);
  const repository=githubSnapshot?.repository||githubPreferences.repository||'';
  const form=connected?`<div class="github-status"><strong>${e(repository)}</strong><br>Privates Repository${remote?`<br>Sicherung vom ${e(backupDate(remote.exportedAt))}<br>${e(remote.state.plan.title)} · ${remote.state.plan.workouts.length} ${entriesLabel(remote.state.plan)}`:ready?'<br>Noch keine Sicherung vorhanden.':'<br>Bitte zuerst den Stand von GitHub laden.'}</div><div class="modal-actions"><button class="primary full" id="github-save" data-action="github-save" ${!ready?'disabled':''}>${icon('upload')}${remote?'Sicherung aktualisieren':'Auf GitHub sichern'}</button>${remote?'<button class="secondary full" id="github-restore" data-action="github-restore">Sicherung wiederherstellen</button>':''}</div><div class="github-toolbar"><button class="secondary" id="github-refresh" data-action="github-refresh">Stand neu laden</button><button class="text-button" id="github-disconnect" data-action="github-disconnect">Verbindung trennen</button></div>`:`<label class="field"><span>Privates GitHub-Repository</span><input id="github-repository" type="text" placeholder="dein-name/pista-sicherung" value="${e(repository)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="260"></label><label class="field"><span>GitHub-Zugriffsschlüssel</span><input id="github-token" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="300"><small>Der Schlüssel gilt nur für diese Sitzung und wird nicht gespeichert.</small></label><div class="modal-actions"><button class="primary full" id="github-connect" data-action="github-connect">Mit GitHub verbinden</button></div><details class="github-help"><summary>Einmalig einrichten</summary><ol><li>Auf GitHub ein <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">separates privates Repository erstellen</a>, z. B. „pista-sicherung“. Eine README-Datei mit anlegen.</li><li>In den GitHub-Einstellungen einen <a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noopener noreferrer">feingranularen Zugriffsschlüssel</a> erstellen: nur dieses Repository auswählen, „Contents“ auf „Read and write“ setzen.</li><li>Repository und Schlüssel oben eintragen. Anschließend „Auf GitHub sichern“ wählen.</li></ol><p>Auf einem anderen Gerät mit demselben privaten Repository verbinden und die Sicherung wiederherstellen. Für eine neue Sitzung den Schlüssel erneut eingeben.</p></details>`;
  openModal('GitHub-Sicherung',`<div id="github-panel"><p>Hier sicherst du deinen Plan, Haken und Notizen in deinem privaten GitHub-Repository.</p>${form}<p id="github-message" class="github-status" role="status" aria-live="polite"></p><p class="notice">Manuelle Sicherung, kein automatischer Geräteabgleich. Öffentliche Repositorys sind für Trainingsdaten gesperrt. Maximal 1 MB pro Sicherung.</p></div>`,'DATENSICHERUNG');
  if(githubBusy)githubButtonsBusy(true,'Verbindung wird geprüft …');
}
async function connectGitHub() {
  if(githubBusy)return;
  let client=null;
  try {
    const repository=parseGitHubRepository($('#github-repository').value);
    let token=$('#github-token').value;
    client=createGitHubBackup({repository,token});token='';$('#github-token').value='';
    githubButtonsBusy(true,'Privates Repository und Sicherung werden geprüft …');
    const snapshot=await client.read();
    githubClient?.disconnect();githubClient=client;githubSnapshot=snapshot;
    // A previous repository's timestamp must never be shown for this destination.
    rememberGitHub({repository:snapshot.repository,exportedAt:githubPreferences.repository===snapshot.repository?githubPreferences.exportedAt:null});
    githubBusy=false;if(githubPanelOpen())openGitHubBackup();
  } catch(error) {client?.disconnect();githubButtonsBusy(false);if(githubPanelOpen())showModalError(error.message);else toast(error.message);}
  finally {githubBusy=false;}
}
async function refreshGitHub() {
  if(githubBusy||!githubClient)return;
  const client=githubClient;
  try {
    githubButtonsBusy(true,'Sicherung wird geladen …');
    const snapshot=await client.read();if(githubClient!==client)return;
    githubSnapshot=snapshot;githubBusy=false;if(githubPanelOpen())openGitHubBackup();
  } catch(error) {githubSnapshot=null;githubBusy=false;if(githubPanelOpen()){openGitHubBackup();showModalError(error.message);}else toast(error.message);}
  finally {githubBusy=false;}
}
async function saveGitHub() {
  if(githubBusy||!githubClient||!githubSnapshot)return;
  if(corruptRaw!==null){showModalError('Bitte zuerst die ungültigen Originaldaten sichern und einen gültigen Plan laden.');return;}
  const client=githubClient;
  try {
    githubButtonsBusy(true,'Plan, Haken und Notizen werden auf GitHub gesichert …');
    const result=await client.save(structuredClone(latest()),{expectedSha:githubSnapshot.sha});
    if(githubClient!==client)return;
    rememberGitHub({repository:result.repository,exportedAt:result.exportedAt});
    githubSnapshot=null;render();
    // After a confirmed write, a read grants the next explicit upload and also
    // gives the restore preview the actual remote contents. Never auto-retry PUT.
    try{githubSnapshot=await client.read();}catch{/* The successful upload remains valid; refresh is required before another operation. */}
    githubBusy=false;if(githubPanelOpen())openGitHubBackup();
    toast('Sicherung auf GitHub gespeichert.');
    if($('#github-message'))$('#github-message').textContent='Auf GitHub gesichert: '+backupDate(result.exportedAt)+'.';
  } catch(error) {githubSnapshot=null;githubBusy=false;if(githubPanelOpen()){openGitHubBackup();showModalError(error.message);}else toast(error.message);}
  finally {githubBusy=false;}
}
async function restoreGitHub() {
  if(githubBusy||!githubClient)return;
  const client=githubClient;
  try {
    githubButtonsBusy(true,'Sicherung wird für die Vorschau geladen …');
    const snapshot=await client.read();if(githubClient!==client)return;
    githubSnapshot=snapshot;githubBusy=false;
    if(!snapshot.backup){if(githubPanelOpen())openGitHubBackup();toast('Auf GitHub liegt noch keine Sicherung.');return;}
    // The ordinary import preview requires a separate confirmation and keeps the
    // previous local state as an undo backup before applying the remote data.
    if(githubPanelOpen())await loadFile(new File([JSON.stringify(snapshot.backup)],'Pista-GitHub-Sicherung.json',{type:'application/json'}));
  } catch(error) {githubSnapshot=null;githubBusy=false;if(githubPanelOpen()){openGitHubBackup();showModalError(error.message);}else toast(error.message);}
  finally {githubBusy=false;}
}
function disconnectGitHub() {if(githubBusy)return;githubClient?.disconnect();githubClient=null;githubSnapshot=null;openGitHubBackup();toast('GitHub-Verbindung getrennt.');}

function navigate(v) {view=v==='progress'?'progress':'plan';location.hash=view;render();window.scrollTo({top:0,behavior:'instant'});}
function changePeriod(delta) {
  const groups=groupedWeeks(state.plan);if(!groups.length)return;
  let index=groups.findIndex(g=>selected>=g.start&&selected<=g.end);
  if(index<0){index=groups.findIndex(g=>g.start>=selected);if(index<0)index=groups.length-1;}
  selected=groups[Math.max(0,Math.min(groups.length-1,index+delta))].start;
  render();$('.by-week.active')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
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
    case 'tracker-week':selected=b.dataset.date;render();$('.by-week.active')?.scrollIntoView({block:'nearest',inline:'nearest'});break;
    case 'load-client-plan':loadFile(new File([JSON.stringify(TRAINING_PLAN)],'Trainingsplan-bis-Januar.json',{type:'application/json'}));break;
    case 'done': {const ok=mutate(s=>setDone(s,id,!progressFor(s,id).done));render();if(ok)toast(progressFor(state,id).done?'Abgehakt und gespeichert.':'Wieder als offen markiert.');break;}
    case 'detail-done': {const ok=mutate(s=>setDone(s,id,!progressFor(s,id).done));render();openWorkout(id);if(ok)toast('Fortschritt gespeichert.');break;}
    case 'close':closeModal();break;
    case 'day':selected=b.dataset.date;render();break;
    case 'previous':changePeriod(-1);break;
    case 'next':changePeriod(1);break;
    case 'today':selected=today;render();break;
    case 'first-training':if(state.plan.workouts.length){selected=state.plan.workouts[0].date;render();}else openImport();break;
    case 'import':openImport();break;
    case 'export':openExport();break;
    case 'data':openData();break;
    case 'install-app':void installApp();break;
    case 'check-update':void pwa.checkForUpdates({manual:true});break;
    case 'apply-update':applyAppUpdate();break;
    case 'github-backup':openGitHubBackup();break;
    case 'github-connect':void connectGitHub();break;
    case 'github-refresh':void refreshGitHub();break;
    case 'github-save':void saveGitHub();break;
    case 'github-restore':void restoreGitHub();break;
    case 'github-disconnect':disconnectGitHub();break;
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
      try{const raw=localStorage.getItem(BACKUP_KEY);if(!raw){showModalError('Noch kein vorheriger Import vorhanden.');break;}const previous=updateClientPlanState(normalizeState(JSON.parse(raw)));pending={kind:'backup',state:previous};openModal('Vorherigen Stand wiederherstellen?',`<p>Du stellst „${e(previous.plan.title)}“ mit ${previous.plan.workouts.length} ${entriesLabel(previous.plan)} samt Fortschritt wieder her. Der aktuelle Stand wird zuvor lokal gesichert.</p><div class="modal-actions"><button class="secondary" data-action="close">Abbrechen</button><button class="primary" data-action="import-confirm">Wiederherstellen</button></div>`,'SICHERUNG');}catch{showModalError('Der vorherige Stand ist nicht lesbar. Die aktuellen Daten wurden nicht verändert.');}break;
    }
    case 'reset-dialog':openModal('Fortschritt zurücksetzen?',`<p>Dein Plan bleibt erhalten. Haken und Notizen werden entfernt. Lade vorher eine Sicherung herunter.</p><div class="modal-actions"><button class="secondary" data-action="backup">Sicherung herunterladen</button><button class="primary" data-action="reset-confirm">Fortschritt zurücksetzen</button></div>`,'NEUSTART');break;
    case 'reset-confirm':if(backupAndApply({...state,progress:{}})){selected=today;closeModal();navigate('plan');toast('Fortschritt zurückgesetzt.');}break;
    case 'export-pdf': {
      try{const result=createTrainingPDF(state,$('input[name="pdf-mode"]:checked').value,$('#pdf-date').value,{layout:$('input[name="pdf-layout"]:checked').value,details:$('#pdf-details').checked,notes:$('#pdf-notes').checked});download(result.bytes,result.filename,'application/pdf');toast(result.unsupportedCharacters?'PDF erstellt. Nicht-lateinische Zeichen wurden durch ? ersetzt.':`PDF erstellt · ${result.pageCount} ${result.pageCount===1?'Seite':'Seiten'} · DIN A4`);}catch(error){showModalError(error.message);}break;
    }
  }
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.matches('#pdf-date,input[name="pdf-mode"]'))updateExportRange();
});
document.addEventListener('input',event=>{const el=event.target;if(el.id==='workout-note')mutate(s=>{if(s.plan.workouts.some(w=>w.id===el.dataset.workout))s.progress[el.dataset.workout]={...progressFor(s,el.dataset.workout),note:el.value.slice(0,2000)};});});
$('#file-input').addEventListener('change',event=>{if(event.target.files[0])loadFile(event.target.files[0]);});
$('#data-button').innerHTML=icon('settings');$('#data-button').addEventListener('click',openData);$('#privacy-button').addEventListener('click',openData);
modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}});
modal.addEventListener('close',restoreModalFocus);
window.addEventListener('hashchange',()=>{if(location.hash==='#main')return;const v=location.hash==='#progress'?'progress':'plan';if(view!==v){view=v;render();}if(location.hash!=='#'+v)history.replaceState(null,'','#'+v);});
window.addEventListener('storage',event=>{if(event.key!==STORAGE_KEY||memoryOnly||corruptRaw!==null)return;try{if(event.newValue){state=updateClientPlanState(normalizeState(JSON.parse(event.newValue)));render();if(modalWorkout&&document.activeElement?.id!=='workout-note')openWorkout(modalWorkout);setSaveStatus(true);}else storageWarning('Der lokale Speicher wurde in einem anderen Tab gelöscht. Bitte sichere diesen Stand.');}catch{storageWarning('Der Speicher wurde in einem anderen Tab ungültig geändert. Bitte sichere diesen Stand.');}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&iso()!==today){today=iso();selected=today;render();}});
if(!['#plan','#progress','#main'].includes(location.hash))history.replaceState(null,'','#plan');
render();
void pwa.start();
