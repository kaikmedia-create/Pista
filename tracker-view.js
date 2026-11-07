// Weekly training view. Cards stay compact; the explicit button opens each workout.
import {TYPES,iso,date,addDays,monday,days,formatDate,shortRange,progressFor,stats,escapeHTML as e} from './core.js';

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
export function trackerView(state,{today=iso(),selected=today}={},icon) {
  const plan=state.plan,all=plan.workouts,summary=stats(state),groups=groupedWeeks(plan),active=chosenWeek(groups,selected);
  const remaining=summary.total-summary.done,hasRest=summary.restTotal>0;
  const countLabel=hasRest?(new Set(all.map(w=>w.date)).size===all.length?'Tage':'Einträge'):'Einheiten';
  const countdown=plan.targetDate?Math.max(0,Math.round((date(plan.targetDate)-date(today))/86400000)):null;
  const typeKeys=[...new Set(all.map(w=>w.type))];
  const summaryHTML=`<section class="by-summary plan-intro" aria-label="Trainingsfortschritt"><div class="by-heading"><div><h1>TRAININGSPLAN</h1><h2>${e(plan.title)}</h2><p>${plan.demo?'Probe-Workout · Bereit zum Ausprobieren':e(plan.description||'Ein Schritt nach dem anderen.')}</p>${plan.goalSummary?`<p class="by-goals">${e(plan.goalSummary)}</p>`:''}</div><div class="by-count"><strong>${countdown??remaining}</strong><span>${countdown!==null?e(plan.targetLabel||'Tage bis zum Ziel'):hasRest?countLabel+' offen':'noch offen'}</span>${countdown!==null?`<small>${e(formatDate(plan.targetDate,{day:'numeric',month:'short',year:'numeric'}))}</small>`:''}</div></div><div class="by-progress"><div class="ring by-ring" style="--progress:${summary.percent}" role="progressbar" aria-label="Trainingsplan erledigt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${summary.percent}"><div class="ring-label"><strong>${summary.percent}<small>%</small></strong></div></div><div class="by-progress-info"><div class="by-progress-caption"><span>${hasRest?countLabel+' abgehakt':'Training'}</span><strong>${summary.done}<span> / ${summary.total}</span></strong></div><div class="by-progress-track"><div style="width:${summary.percent}%"></div></div><div class="by-progress-breakdown">${hasRest?`Training ${summary.trainingDone}/${summary.trainingTotal} · Ruhetage ${summary.restDone}/${summary.restTotal}`:''}</div><div class="by-legend">${typeKeys.map(k=>`<span class="by-type-${k}"><i></i>${e(TYPES[k])}</span>`).join('')||'<span>Noch kein Training geplant</span>'}</div></div></div></section>`;
  const dateLabel=value=>`<span class="by-date"><b>${date(value).getDate()}</b><span>${e(formatDate(value,{month:'short'}).replace('.',''))}</span><small>${value===today?'HEUTE':e(formatDate(value,{weekday:'short'}).replace('.',''))}</small></span>`;
  function card(w) {
    const p=progressFor(state,w.id),current=w.date===today,rest=w.type==='rest';
    return `<article class="by-day-card workout-row by-type-${w.type} ${p.done?'is-done':''} ${current?'is-today':''}" data-workout-id="${w.id}" data-date="${w.date}"><div class="by-card-row"><div class="by-card-summary">${dateLabel(w.date)}<div class="by-card-content"><span class="by-card-label"><span>${rest?icon('moon')+'Erholung':e(w.sessionCode==='U'?'Uni-Sport':TYPES[w.type])}</span>${w.optional?'<span class="by-optional">Freiwillig</span>':''}${w.zone?`<span class="by-zone">· ${e(w.zone)}</span>`:''}${p.done?'<span class="by-done-label">Erledigt</span>':''}</span><strong>${e(w.title)}</strong>${w.startTime?`<span class="by-time">${e(w.startTime)}–${e(w.endTime)} Uhr</span>`:''}${rest?'':`<span class="by-duration">${e(w.durationLabel||(w.durationMinutes?w.durationMinutes+' Min.':'Dauer offen'))}</span>`}${w.focus?`<span class="by-focus">${e(w.focus)}</span>`:''}</div></div><button class="check-button ${p.done?'checked':''}" data-action="done" data-id="${w.id}" aria-label="${e(w.title)} ${p.done?'wieder öffnen':'abhaken'}" aria-pressed="${p.done}">${icon('check')}</button></div><div class="by-card-foot"><button class="text-button" data-action="open" data-id="${w.id}">${rest?'Ruhetag anzeigen':'Workout anzeigen'}${icon('arrow')}</button>${p.note?`<span>Notiz gespeichert</span>`:''}</div></article>`;
  }
  const missingDay=value=>`<article class="by-empty-day ${value===today?'is-today':''}" data-date="${value}">${dateLabel(value)}<p>Kein Eintrag im Plan</p></article>`;
  let content='';
  if(groups.length) {
    content+=`<section class="by-section by-week-section" aria-label="Trainingswochen"><div class="by-section-heading"><h2 class="by-section-title">Wochen</h2><button class="text-button" data-action="today">Zur aktuellen Woche</button></div><div class="by-weeks" role="group" aria-label="Woche auswählen">${groups.map(g=>{const s=stats(state,g.start,g.end);return `<button class="by-week ${g.start===active?.start?'active':''}" data-action="tracker-week" data-date="${g.start}" aria-label="${g.number===0?'Einstiegswoche':'Woche '+g.number}, ${e(shortRange(g))}" aria-pressed="${g.start===active?.start}"><b>${g.number===0?'Start':'W'+g.number}</b><span>${s.done}/${s.total}</span><small>${e(formatDate(g.start,{day:'2-digit',month:'2-digit'}))}</small></button>`;}).join('')}</div></section>`;
  }
  if(active) {
    const index=groups.indexOf(active);
    content+=`<section aria-label="Aktive Trainingswoche"><div class="by-active-week"><div class="by-week-heading"><h2>${active.number===0?'Einstiegswoche':'Woche '+active.number}</h2><span>${e(shortRange(active))}</span></div><div class="calendar-controls"><button class="icon-btn" data-action="previous" aria-label="Vorherige Woche" ${index===0?'disabled':''}>${icon('left')}</button><button class="icon-btn" data-action="next" aria-label="Nächste Woche" ${index===groups.length-1?'disabled':''}>${icon('right')}</button></div></div>${active.goal?`<p class="by-week-goal">${e(active.goal)}</p>`:''}${days(active.start,active.end).map(value=>{const entries=active.workouts.filter(w=>w.date===value);return entries.length?entries.map(card).join(''):missingDay(value);}).join('')}</section>`;
  } else content+='<div class="empty">Noch keine Einheiten. Importiere deinen Trainingsplan, um zu starten.</div>';
  return summaryHTML+content;
}
