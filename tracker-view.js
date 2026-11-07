// The user's Backyard Tracker interaction model: progress, today, upcoming, weeks,
// dated cards, a separate completion control and inline expandable instructions.
import {TYPES,iso,date,addDays,monday,range,formatDate,shortRange,progressFor,stats,escapeHTML as e} from './core.js';

export function groupedWeeks(plan) {
  const groups=new Map();
  for(const w of plan.workouts) {
    const start=monday(w.date);
    if(!groups.has(start)) groups.set(start,{start,end:addDays(start,6),workouts:[],goal:w.weekGoal||'',number:w.weekNumber??null});
    const group=groups.get(start);group.workouts.push(w);
    if(!group.goal&&w.weekGoal)group.goal=w.weekGoal;
  }
  return [...groups.values()].sort((a,b)=>a.start.localeCompare(b.start)).map((g,i)=>({...g,number:g.number??i+1}));
}
function chosenWeek(groups,selected) {
  return groups.find(g=>selected>=g.start&&selected<=g.end)||groups.find(g=>g.start>=selected)||groups.at(-1);
}
export function trackerView(state,{today=iso(),selected=today,expanded=new Set(),view='overview',planMode='week'}={},icon) {
  const plan=state.plan,all=plan.workouts,summary=stats(state),groups=groupedWeeks(plan),active=chosenWeek(groups,selected);
  const remaining=summary.total-summary.done;
  const countdown=plan.targetDate?Math.max(0,Math.round((date(plan.targetDate)-date(today))/86400000)):null;
  const typeKeys=[...new Set(all.map(w=>w.type))];
  const summaryHTML=`<section class="by-summary plan-intro" aria-label="Trainingsfortschritt"><div class="by-heading"><div><h1>${view==='plan'?'TRAININGSPLAN':'DEIN TRAINING'}</h1><h2>${e(plan.title)}</h2><p>${plan.demo?'Probe-Workout · Bereit zum Ausprobieren':e(plan.description||'Ein Schritt nach dem anderen.')}</p>${plan.goalSummary?`<p class="by-goals">${e(plan.goalSummary)}</p>`:''}</div><div class="by-count"><strong>${countdown??remaining}</strong><span>${countdown!==null?e(plan.targetLabel||'Tage bis zum Ziel'):'noch offen'}</span>${countdown!==null?`<small>${e(formatDate(plan.targetDate,{day:'numeric',month:'short',year:'numeric'}))}</small>`:''}</div></div><div class="by-progress"><div class="ring by-ring" style="--progress:${summary.percent}" role="progressbar" aria-label="Trainingsplan erledigt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${summary.percent}"><div class="ring-label"><strong>${summary.percent}<small>%</small></strong></div></div><div class="by-progress-info"><div class="by-progress-caption"><span>Training</span><strong>${summary.done}<span> / ${summary.total}</span></strong></div><div class="by-progress-track"><div style="width:${summary.percent}%"></div></div><div class="by-legend">${typeKeys.map(k=>`<span class="by-type-${k}"><i></i>${e(TYPES[k])}</span>`).join('')||'<span>Noch kein Training geplant</span>'}</div></div></div></section><div class="by-actions"><button class="primary" data-action="export">${icon('download')}PDF-Übersicht</button><button class="secondary" data-action="export-paper">${icon('file')}Papier-Checkliste</button></div>`;
  function card(w,region) {
    const p=progressFor(state,w.id),open=expanded.has(w.id),current=w.date===today;
    const detailId=`details-${region}-${w.id}`;
    return `<article class="by-day-card workout-row by-type-${w.type} ${p.done?'is-done':''} ${current?'is-today':''}" data-workout-id="${w.id}"><div class="by-card-row"><button class="by-card-open workout-open" data-action="expand" data-id="${w.id}" aria-expanded="${open}" aria-controls="${detailId}" aria-label="${e(w.title)}: Details ${open?'schließen':'anzeigen'}"><span class="by-date"><b>${date(w.date).getDate()}</b><span>${e(formatDate(w.date,{month:'short'}).replace('.',''))}</span><small>${current?'HEUTE':e(formatDate(w.date,{weekday:'short'}).replace('.',''))}</small></span><span class="by-card-content"><span class="by-card-label"><span>${e(w.sessionCode==='U'?'Uni-Sport':TYPES[w.type])}</span>${w.optional?'<span class="by-optional">Freiwillig</span>':''}${w.zone?`<span class="by-zone">· ${e(w.zone)}</span>`:''}${p.done?'<span class="by-done-label">Erledigt</span>':''}</span><strong>${e(w.title)}</strong>${w.startTime?`<span class="by-time">${e(w.startTime)}–${e(w.endTime)} Uhr</span>`:''}<span class="by-duration">${e(w.durationLabel||(w.durationMinutes?w.durationMinutes+' Min.':'Dauer offen'))}</span>${w.focus?`<span class="by-focus">${e(w.focus)}</span>`:''}<span class="by-expand-hint">${open?'Weniger anzeigen':'Details anzeigen'} ${icon(open?'left':'right')}</span></span></button><button class="check-button ${p.done?'checked':''}" data-action="done" data-id="${w.id}" aria-label="${e(w.title)} ${p.done?'wieder öffnen':'abhaken'}" aria-pressed="${p.done}">${icon('check')}</button></div><div id="${detailId}" class="by-expanded" ${open?'':'hidden'}>${w.description?`<p>${e(w.description)}</p>`:''}${w.steps.length?`<div class="by-steps">${w.steps.map(s=>`<label class="by-step"><input type="checkbox" data-inline-step="${s.id}" data-workout="${w.id}" ${p.steps[s.id]?'checked':''}><span><b>${e(s.title)}</b>${s.details?`<small>${e(s.details)}</small>`:''}</span></label>`).join('')}</div>`:''}${w.instructions?`<details class="training-hints"><summary>Hinweise & Alternativen</summary><p>${e(w.instructions)}</p></details>`:''}${p.note?`<p class="by-saved-note"><b>Deine Notiz</b><br>${e(p.note)}</p>`:''}${!w.description&&!w.steps.length?'<p>Hier kannst du das Training abhaken und eine Notiz ergänzen.</p>':''}</div><div class="by-card-foot"><button class="text-button" data-action="open" data-id="${w.id}">${p.done?'Workout ansehen':'Workout öffnen'}${icon('arrow')}</button>${w.steps.length?`<span>${w.steps.filter(s=>p.steps[s.id]).length}/${w.steps.length} Blöcke</span>`:''}</div></article>`;
  }
  const section=(title,list,region)=>`<section class="by-section" aria-label="${e(title)}"><h2 class="by-section-title">${e(title)}</h2>${list.map(w=>card(w,region)).join('')}</section>`;
  let content='';
  if(view==='overview') {
    const todayList=all.filter(w=>w.date===today),upcoming=all.filter(w=>w.date>today).slice(0,3);
    content+=todayList.length?section('Heute · '+formatDate(today,{weekday:'long',day:'numeric',month:'long'}),todayList,'today'):`<section class="by-section by-rest"><div>${icon('moon')}</div><p><strong>Heute ist kein Training geplant.</strong><span>Dein nächster Schritt steht im Wochenplan.</span></p></section>`;
    if(upcoming.length)content+=section('Nächste Einheiten',upcoming,'upcoming');
  }
  const selector=`<section class="by-section by-week-section" aria-label="Trainingswochen"><div class="by-section-heading"><h2 class="by-section-title">Wochen</h2><button class="text-button" data-action="today">Zur aktuellen Woche</button></div><div class="by-weeks" role="group" aria-label="Woche auswählen">${groups.map(g=>{const s=stats(state,g.start,g.end);return `<button class="by-week ${g.start===active?.start?'active':''}" data-action="tracker-week" data-date="${g.start}" aria-label="${g.number===0?'Einstieg':'Woche '+g.number}, ${e(shortRange(g))}" aria-pressed="${g.start===active?.start}"><b>${g.number===0?'Start':'W'+g.number}</b><span>${s.done}/${s.total}</span><small>${e(formatDate(g.number===0?g.workouts[0].date:g.start,{day:'2-digit',month:'2-digit'}))}</small></button>`;}).join('')}</div></section>`;
  content+=groups.length?selector:'';
  if(view==='plan') {
    content+=`<div class="by-period-bar"><div class="segmented" role="group" aria-label="Zeitraum">${[['week','Woche'],['fortnight','2 Wochen'],['month','Monat']].map(([key,label])=>`<button class="segment ${planMode===key?'active':''}" data-action="mode" data-mode="${key}" aria-pressed="${planMode===key}">${label}</button>`).join('')}</div><div class="calendar-controls"><button class="icon-btn" data-action="previous" aria-label="Vorheriger Zeitraum">${icon('left')}</button><button class="icon-btn" data-action="next" aria-label="Nächster Zeitraum">${icon('right')}</button></div></div>`;
  }
  if(active) {
    if(view==='plan'&&planMode!=='week') {
      const r=range(planMode,selected),list=all.filter(w=>w.date>=r.start&&w.date<=r.end);
      content+=`<div class="by-week-heading"><h2>${planMode==='month'?'Monat':'Zwei Wochen'}</h2><span>${e(shortRange(r))}</span></div>`;
      content+=list.length?list.map(w=>card(w,'period')).join(''):'<div class="empty">In diesem Zeitraum ist kein Training geplant.</div>';
    } else {
      content+=`<section aria-label="Aktive Trainingswoche"><div class="by-week-heading"><h2>${active.number===0?'Freiwilliger Einstieg':'Woche '+active.number}</h2><span>${active.number===0?e(formatDate(active.workouts[0].date)):e(shortRange(active))}</span></div>${active.goal?`<p class="by-week-goal">${e(active.goal)}</p>`:''}${active.workouts.map(w=>card(w,'week')).join('')}</section>`;
    }
  } else content+='<div class="empty">Noch keine Einheiten. Importiere deinen Trainingsplan, um zu starten.</div>';
  return summaryHTML+content+`<section class="by-paper"><div class="by-paper-icon">${icon('file')}</div><div><h2>Dein Plan. Auch auf Papier.</h2><p>Dein ganzer Plan oder einzelne Wochen. Mit leeren Kästchen zum Abhaken.</p></div><button class="text-button" data-action="export-paper">Checkliste herunterladen ${icon('arrow')}</button></section><p class="notice by-storage-note">${plan.demo?'Probe-Workout · Funktionsdemo, kein individueller Trainingsplan. ':''}Haken und Notizen werden automatisch in diesem Browser gespeichert. <button class="text-button" data-action="backup">Sicherung herunterladen</button></p>`;
}
