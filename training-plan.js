// The approved November-January training block. No private calendar feed or personal profile data.
// Stable workout and step IDs keep completion and notes intact across app updates.
import {days,monday} from './core.js';

const PLAN_ID='tp-ab-2026-2027';
const PLAN_START='2026-11-02',PLAN_END='2027-01-31';

const WEEKS = [
  {number:1, monday:'2026-11-09', first:'U', aDate:'2026-11-11', aStart:'09:30', aEnd:'10:40', bDate:'2026-11-14', runA:20, runB:25, sets:2, tempoReps:0, tempoMinutes:0, goal:'Passende Übungen finden und ruhig starten.'},
  {number:2, monday:'2026-11-16', first:'U', aDate:'2026-11-18', aStart:'09:30', aEnd:'10:40', bDate:'2026-11-21', runA:22, runB:27, sets:2, tempoReps:0, tempoMinutes:0, goal:'Die Routine halten und sauber üben.'},
  {number:3, monday:'2026-11-23', first:'C', aDate:'2026-11-25', aStart:'09:30', aEnd:'10:40', bDate:'2026-11-28', runA:24, runB:29, sets:3, tempoReps:0, tempoMinutes:0, goal:'Nur bei guter Erholung einen dritten Kraftsatz ergänzen.'},
  {number:4, monday:'2026-11-30', first:'U', aDate:'2026-12-02', aStart:'09:30', aEnd:'10:40', bDate:'2026-12-05', runA:20, runB:23, sets:2, tempoReps:0, tempoMinutes:0, goal:'Leichtere Woche: weniger Umfang, saubere Bewegungen.'},
  {number:5, monday:'2026-12-07', first:'U', aDate:'2026-12-09', aStart:'09:30', aEnd:'10:40', bDate:'2026-12-12', runA:25, runB:29, sets:3, tempoReps:4, tempoMinutes:1, goal:'Bei guter Verträglichkeit erste kurze Tempoabschnitte üben.'},
  {number:6, monday:'2026-12-14', first:'U', aDate:'2026-12-16', aStart:'09:30', aEnd:'10:40', bDate:'2026-12-19', runA:25, runB:31, sets:3, tempoReps:5, tempoMinutes:1, goal:'Kontrolliert weiter aufbauen, ohne ans Limit zu gehen.'},
  {number:7, monday:'2026-12-21', first:'U', aDate:'2026-12-23', aStart:'09:30', aEnd:'10:40', bDate:'2026-12-27', runA:22, runB:25, sets:2, tempoReps:0, tempoMinutes:0, goal:'Weihnachtswoche: weniger Umfang; B findet am Sonntag statt.'},
  {number:8, monday:'2026-12-28', first:'C', aDate:'2026-12-30', aStart:'09:30', aEnd:'10:40', bDate:'2027-01-02', runA:24, runB:27, sets:2, tempoReps:0, tempoMinutes:0, goal:'Über den Jahreswechsel locker in der Routine bleiben.'},
  {number:9, monday:'2027-01-04', first:'U', aDate:'2027-01-06', aStart:'09:30', aEnd:'10:40', bDate:'2027-01-09', runA:25, runB:30, sets:3, tempoReps:4, tempoMinutes:2, goal:'Bei guter Erholung etwas längere Tempoabschnitte üben.'},
  {number:10, monday:'2027-01-11', first:'C', aDate:'2027-01-13', aStart:'15:00', aEnd:'16:10', bDate:'2027-01-16', runA:27, runB:32, sets:3, tempoReps:4, tempoMinutes:2, goal:'Tempo kontrollieren und die Laufzeit leicht erhöhen.'},
  {number:11, monday:'2027-01-18', first:'U', aDate:'2027-01-20', aStart:'13:15', aEnd:'14:25', bDate:'2027-01-23', runA:28, runB:35, sets:3, tempoReps:5, tempoMinutes:2, goal:'Die Fortschritte festigen. Noch keine Maximaltests.'},
  {number:12, monday:'2027-01-25', first:'U', aDate:'2027-01-27', aStart:'14:15', aEnd:'15:25', bDate:'2027-01-30', runA:22, runB:35, sets:2, tempoReps:0, tempoMinutes:0, goal:'Etwas weniger trainieren und den aktuellen Stand festhalten.'},
];

const EASY = 'Locker heißt: Anstrengung 3–4 von 10; du kannst ganze Sätze sprechen. Bei Bedarf 3 Min. joggen und 1 Min. gehen, bis die Blockzeit erreicht ist.';
const TEMPO_GATE = 'Tempo nur, wenn die letzten zwei Wochen gut vertragen wurden, 20 Min. lockeres Joggen am Stück beschwerdefrei gelingen und der Uni-Sport diese Woche nicht intensiv war.';

function step(id,title,details) { return {id,title,details}; }
function common(week,sessionCode,date,startTime,endTime,durationMinutes) {
  return {
    id:`tpab-${date}-${sessionCode.toLowerCase()}`,
    date,startTime,endTime,sessionCode,durationMinutes,
    optional:false,weekNumber:week.number,weekGoal:week.goal,
  };
}

function easyRun(minutes) {
  return step('run',`Locker laufen · ${minutes} Min.`,
    `5 Min. zügig gehen + ${minutes-8} Min. locker joggen + 3 Min. locker ausgehen. ${EASY} Aufwärmen, Gehpausen und Ausgehen sind in den ${minutes} Min. enthalten.`);
}

function runBlock(week,code) {
  if(code==='A') return easyRun(week.runA);
  if(week.number===12) {
    return step('run','Lauf-Check: 2 km kontrolliert oder 30 Min. locker',
      'Den 2-km-Check nur machen, wenn die letzten zwei Wochen gut vertragen wurden, 20 Min. Joggen am Stück beschwerdefrei gelingen, kein Infekt besteht und der Uni-Sport diese Woche nicht intensiv war. Dann: 5 Min. gehen + 5 Min. locker joggen + 2 km gleichmäßig bei Anstrengung 7/10 + 5 Min. gehen. Für die 2 km höchstens 20 Min., insgesamt höchstens 35 Min.; kein Endspurt und keine Zielzeit erzwingen. Bei Problemen abbrechen. Sonst: 30 Min. locker (5 gehen + 22 joggen + 3 gehen), Gehpausen erlaubt. Zeit, Strecke und Anstrengung notieren; der kontrollierte Lauf ist kein maximaler Prüfungstest.');
  }
  if(!week.tempoReps) return easyRun(week.runB);
  const before=week.runB-8-week.tempoReps*(week.tempoMinutes+2);
  return step('run',`Laufen · ${week.runB} Min., Tempo optional`,
    `${TEMPO_GATE} Dann: 5 Min. gehen + ${before} Min. locker joggen + ${week.tempoReps} Runden aus ${week.tempoMinutes} Min. zügig und 2 Min. sehr locker joggen oder gehen + 3 Min. ausgehen. Zügig heißt Anstrengung 6/10, kein Sprint und keine feste Pace. Alles zusammen ${week.runB} Min. Wenn eine Voraussetzung fehlt: ${week.runB} Min. komplett locker (5 gehen + ${week.runB-8} joggen + 3 gehen), Gehpausen erlaubt.`);
}

function pushups(week,code) {
  if(week.number===12 && code==='A') {
    return step('pushups','Liegestütz-Check + 1 leichter Satz',
      'Nur mit normal erholten, schmerzfreien Schultern, Armen und Rumpf testen. Wenn bereits mindestens 5 saubere Bodenwiederholungen gelingen und die Prüfungsform bestätigt ist: einmal 40 Sek. gültige Wiederholungen zählen, bei Technikverlust stoppen. Sonst: ein Satz an der Auflage aus Woche 1, höchstens 15 Wiederholungen, mit etwa 2 Wiederholungen Reserve. Danach 90 Sek. Pause und 1 leichter Satz mit 5–8 erhöhten Liegestützen. Bei Restmüdigkeit den Check ganz auslassen und stattdessen 2 leichte erhöhte Sätze mit 5–8 Wiederholungen und 90 Sek. Pause machen. Auflage, Wiederholungen und Variante notieren.');
  }
  const setRule=week.sets===3?'Den dritten Satz nur nach zwei gut vertragenen Einheiten ergänzen; sonst 2 Sätze. ':'';
  const technique=code==='A'?' Sobald einzelne Wiederholungen in bestätigter Prüfungsform leicht gelingen: einen erhöhten Satz durch 3 einzelne Bodenwiederholungen ersetzen, jeweils 45–60 Sek. Pause; nicht zusätzlich machen.':'';
  return step('pushups',`Erhöhte Liegestütze · ${week.sets} × 5–8`,
    `${setRule}90 Sek. Pause zwischen Sätzen. Hände auf eine stabile Wand oder Arbeitsfläche, Körper gerade, kontrolliert absenken und hochdrücken. Die Auflage so wählen, dass noch 2–3 saubere Wiederholungen möglich wären. Wenn zweimal alle Sätze mit 8 Wiederholungen leicht gelingen: Auflage etwas tiefer, wieder mit 5–6 beginnen. Nicht gleichzeitig tiefer gehen und einen Satz ergänzen.${technique}`);
}

function rowing(week) {
  const setRule=week.sets===3?'Den dritten Satz nur nach zwei gut vertragenen Einheiten ergänzen; sonst 2 Sätze. ':'';
  return step('row',`Kettlebell-Rudern · ${week.sets} × 8–12 je Seite`,
    `${setRule}15–30 Sek. zum Seitenwechsel, danach 90 Sek. Pause. Freie Hand stabil abstützen, Rücken ruhig halten und das Gewicht ohne Ruck ziehen und senken. Es sollten noch 2–3 saubere Wiederholungen möglich sein. Ist die Kettlebell für 8 saubere Wiederholungen zu schwer, Rudern auslassen und eine passende Last klären; nicht mit Schwung erzwingen. Als leichte Bewegungsübung sind 2 × 8 kleine W-Hebungen in Bauchlage mit 45 Sek. Pause möglich: Arme wie ein W anwinkeln und vorsichtig anheben. Das ersetzt kein Zugkrafttraining.`);
}

function extraStrength(week,code) {
  const n=[4,7,12].includes(week.number)?1:2;
  if(code==='A') return [
    step('squat',`Aufstehen vom Stuhl · ${n} × 8–10`,
      '60–90 Sek. Pause zwischen Sätzen. Einen stabilen Stuhl nutzen, Füße fest aufstellen. Langsam hinsetzen und ohne Schwung aufstehen; die Knie folgen den Fußspitzen. Alternativ kontrollierte Kniebeugen. Körpergewicht genügt.'),
    step('dead-bug',`Dead Bug · ${n} × 5 je Seite`,
      '45–60 Sek. Pause zwischen Sätzen. In Rückenlage Hüfte und Knie beugen. Gegenüberliegenden Arm und ein Bein langsam ausstrecken, dann wechseln. Nur so weit bewegen, dass der Rumpf ruhig bleibt.'),
  ];
  return [
    step('bridge',`Glute Bridge · ${n} × 10–12`,
      '60 Sek. Pause zwischen Sätzen. In Rückenlage die Füße aufstellen und das Becken kontrolliert heben und senken. Nicht ins Hohlkreuz ausweichen. Ohne Zusatzgewicht beginnen.'),
    step('calves',`Wadenheben · ${n} × 10–12`,
      '60 Sek. Pause zwischen Sätzen. Auf ebener Fläche stehen und an etwas Festem halten. Beide Fersen kontrolliert heben und langsam senken. Nicht federn.'),
  ];
}

function adjustments(week) {
  const barProgress=week.sets===3
    ?'Nach zwei gut vertragenen Einheiten sind höchstens 3 Sätze möglich.'
    :'Diese Woche bei 2 Sätzen bleiben.';
  return [
    'Anpassen: War der Uni-Sport lauf- oder sprungintensiv oder etwa 7/10 anstrengend, bleiben beide privaten Läufe locker; Tempo und 2-km-Check entfallen. Bei deutlicher Restmüdigkeit Laufzeit um etwa ein Viertel kürzen, höchstens 2 leichte Oberkörpersätze und je 1 Zusatzsatz machen. Bei zunehmenden Schmerzen stoppen; bei Infekt oder Fieber pausieren. Wiederkehrende punktuelle Knochen-, Gelenk- oder Sehnenschmerzen abklären lassen.',
    'Wetter und Zeit: Bei Glätte oder fehlendem Tageslicht den Lauf durch gleich viele Minuten lockere Rolle ersetzen (erste und letzte 3 Min. sehr leicht, Rest 3/10). Bei Zeitmangel: 15 Min. Lauf (5 gehen + 7 joggen + 3 gehen) und je 2 leichte Sätze Liegestütze/Rudern mit normalen Pausen; etwa 35–45 Min. insgesamt. Ausfälle nicht an einem vierten Tag nachholen.',
    `Klimmzugoption: Erst mit sicherer Stange und geeigneter Hilfe das Rudern durch 2 × 3–5 unterstützte Klimmzüge ersetzen; 2 Min. Pause und etwa 2 Wiederholungen Reserve. ${barProgress} Erst nach wiederholt sauberen 5ern weniger Hilfe nutzen. Griff und Prüfungsform bestätigen lassen; keine täglichen Negativserien. Ist die Stange nur beim Uni-Sport verfügbar, die Verteilung erst neu abstimmen.`,
    'Fortschritt: Nur steigern, wenn die letzte Belastung gut vertragen wurde; sonst die letzte angenehme Woche wiederholen oder reduzieren. Notiere Laufzeit, Anstrengung, Auflagehöhe, Wiederholungen und Kettlebell-Gewicht sowie Beschwerden am Folgetag. Lauf und Kraft sollen in das Zeitfenster passen; lieber in Wohnungsnähe laufen als Satzpausen kürzen.',
    'Prüfungs-Liegestütze: Nach dem vollständigen Ablegen die Hände hinter dem Rücken zusammenführen. Lass dir die genaue Ausführung und Zählweise von der Sportlehrkraft bestätigen. Erhöhte Liegestütze bauen zunächst die nötige Kraft auf.',
  ].join('\n\n');
}

function combined(week,code) {
  const isA=code==='A', d=isA?week.aDate:week.bDate;
  const start=isA?week.aStart:'10:30',end=isA?week.aEnd:'11:40';
  const runMinutes=isA?week.runA:week.runB;
  const test=week.number===12;
  const title=test?(isA?'A · Laufen & Liegestütz-Check':'B · Lauf-Check & Kraft'):`${code} · Laufen & Kraft`;
  let description='Zuerst bei Tageslicht laufen, danach Kraft zu Hause. 70 Minuten sind reserviert; am Anfang bist du oft früher fertig.';
  if(week.number===7 && !isA) description+=' Diese Einheit liegt am Sonntag statt am Samstag.';
  if(week.number===10 && isA) description+=' Um 15:00 direkt mit dem Lauf starten, danach drinnen weitermachen.';
  if(test) description+=' Die Checks sind freiwillig und nur bei guter Erholung vorgesehen.';
  return {
    ...common(week,code,d,start,end,70),title,type:'run',
    durationLabel:'70 Min. Zeitfenster',
    zone:!isA&&week.tempoReps?'Locker · Tempo optional':'Locker',
    focus:test&&!isA?'30 Min. locker oder 2-km-Check, danach Kraft':`${runMinutes} Min. Lauf + Kraft`,
    description,instructions:adjustments(week),
    steps:[
      runBlock(week,code),
      step('transition','Wechsel & Kraft vorbereiten · ca. 5 Min.',
        'Nach Hause wechseln, Schultern locker bewegen, 5 sehr leichte Wandliegestütze und 5 unbelastete Hüftbeugen machen. Bei längerem Weg früher zurückkehren. Danach die Kraftübungen in dieser Reihenfolge ausführen.'),
      pushups(week,code),rowing(week),...extraStrength(week,code),
    ],
  };
}

function university(week) {
  return {
    ...common(week,'U',week.monday,'13:30','15:00',90),
    title:'Uni-Sport',type:'other',durationLabel:'90 Min.',zone:'Nach Unterricht',
    focus:'Erster Trainingstag dieser Woche',
    description:'Dein regulärer Uni-Sport zählt als einer von drei Trainingstagen.',
    instructions:'Notiere kurz Inhalt und Anstrengung des Uni-Sports. Bei vielen Lauf- oder Sprungbelastungen oder etwa 7/10 Anstrengung bleiben die privaten Läufe dieser Woche locker; Tempo und 2-km-Check entfallen. Wenn du am Mittwoch noch deutlich müde bist, die Einheit entsprechend verkürzen. Bei geänderten Uni-Terminen den Wochenplan anpassen.',
    steps:[step('university','Am Uni-Sport teilnehmen · 90 Min.',
      'Inhalte und Belastung gibt die Sportlehrkraft vor. Keine zusätzlichen harten Kraft- oder Laufeinheiten anhängen. Danach kannst du diese Einheit abhaken und eine kurze Notiz zur Belastung ergänzen.')],
  };
}

function cycling(week) {
  return {
    ...common(week,'C',week.monday,'17:00','17:35',35),
    title:'C · Lockere Rolle & Beweglichkeit',type:'cycle',durationLabel:'35 Min.',zone:'Sehr locker',
    focus:'Dritter Trainingstag ohne Uni-Sport',
    description:'Eine ruhige Einheit zu Hause. Sie ersetzt den nicht eingetragenen Uni-Sport.'+(week.number===8?' Nach dem Sonntagstraining besonders leicht halten.':''),
    instructions:'Falls an diesem Tag doch Uni-Sport stattfindet, C streichen. Keine Intervalle oder zusätzlichen Kraftsätze. Bei Schmerzen die betroffene Bewegung stoppen, bei Infekt oder Fieber pausieren. Ausfälle nicht nachholen.',
    steps:[
      step('cycle','Locker auf der Rolle · 30 Min.',
        '5 Min. sehr locker einrollen + 20 Min. locker bei Anstrengung 2–3/10 + 5 Min. ausrollen. Du solltest entspannt in ganzen Sätzen sprechen können.'),
      step('mobility','Sanft bewegen · 5 Min.',
        'Schultern, Hüfte und Sprunggelenke ruhig und schmerzfrei bewegen. Kein kräftiges Dehnen erzwingen; die Einheit soll sich leicht anfühlen.'),
    ],
  };
}

const START = {
  id:'tpab-2026-11-08-start',date:'2026-11-08',startTime:'10:30',endTime:'10:50',
  sessionCode:'START',optional:true,weekNumber:0,weekGoal:'Freiwilliger Einstieg: locker bewegen und passende Varianten finden.',
  title:'Leichter Einstieg · freiwillig',type:'mobility',durationMinutes:20,durationLabel:'20 Min.',
  zone:'Sehr locker',focus:'Die Übungen kennenlernen',
  description:'Ein leichter Start vor dem regulären Plan. Kein Leistungstest; bei Müdigkeit vor dem Uni-Sport am Montag auslassen.',
  instructions:'Zwischen den Kraftübungen 45–60 Sek. Pause. Die übrige Zeit locker bewegen und die passende Liegestütz-Auflage sowie das Kettlebell-Gewicht notieren. Bei Beschwerden die betroffene Übung auslassen.',
  steps:[
    step('walk','Spazieren · 10 Min.','Entspannt bei Tageslicht gehen. Heute zählt ein leichter Einstieg.'),
    step('pushups','Erhöhte Liegestütze · 1 × 5','Hände an eine stabile Wand oder Arbeitsfläche, Körper gerade. Die Höhe so wählen, dass fünf Wiederholungen sehr leicht gelingen. Danach 45–60 Sek. Pause.'),
    step('squat','Aufstehen vom Stuhl · 1 × 5','Langsam auf einen stabilen Stuhl setzen und ohne Schwung aufstehen. Körpergewicht genügt. Danach 45–60 Sek. Pause.'),
    step('calves','Wadenheben · 1 × 8','An etwas Festem halten und beide Fersen langsam heben und senken. Ohne Federn.'),
  ],
};

function restDay(value) {
  const week=WEEKS.find(w=>w.monday===monday(value));
  return {
    id:`tpab-${value}-rest`,date:value,startTime:'',endTime:'',
    sessionCode:'REST',optional:false,weekNumber:week?.number??0,
    weekGoal:week?.goal??START.weekGoal,
    title:'Ruhetag',type:'rest',durationMinutes:0,durationLabel:'Trainingsfrei',
    zone:'',focus:value<'2026-11-08'?'Vor dem Trainingsstart am 8. November.':'Erholen und Kraft sammeln.',
    description:(value<'2026-11-08'?'Vor dem Trainingsstart ist kein zusätzliches Training vorgesehen.':'Heute ist trainingsfrei.')+' Wenn du magst, mach einen lockeren Spaziergang oder bewege dich sanft nach Gefühl.',
    instructions:'',steps:[],
  };
}

function includeRestDays(workouts) {
  const occupied=new Set(workouts.map(w=>w.date)),ids=new Set(workouts.map(w=>w.id));
  const additions=days(PLAN_START,PLAN_END).filter(d=>!occupied.has(d)).map(d=>{
    const w=restDay(d),base=w.id;
    // Keep existing, manually changed entries even if one has reused a rest-day ID.
    for(let suffix=2;ids.has(w.id);suffix++)w.id=`${base}-${suffix}`;
    ids.add(w.id);
    return w;
  });
  if(!additions.length)return workouts;
  return [...workouts,...additions].sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'').localeCompare(b.startTime||'')||a.id.localeCompare(b.id));
}

// Only add missing days to this prepared plan. Existing sessions, progress and notes
// remain untouched; repeated loads, restores and cross-tab updates are idempotent.
export function updateClientPlanState(state) {
  if(state?.plan?.id!==PLAN_ID)return state;
  const workouts=includeRestDays(state.plan.workouts);
  const description=state.plan.description==='Drei Trainingstage pro Woche. Uni-Sport zählt mit. 8. November 2026 bis 31. Januar 2027.'?TRAINING_PLAN.description:state.plan.description;
  return workouts===state.plan.workouts&&description===state.plan.description?state:{...state,plan:{...state.plan,description,workouts}};
}

export const TRAINING_PLAN = {
  schemaVersion:1,
  id:PLAN_ID,
  title:'Dein Plan bis Januar',
  description:'Drei Trainingstage pro Woche. Uni-Sport zählt mit. Wochenplan vom 2. November 2026 bis 31. Januar 2027; Training ab 8. November.',
  goalSummary:'Ziel Juli 2027: 8 Klimmzüge · 28 Liegestütze in 40 Sek. · 2 km in 8:00 Min.',
  demo:false,
  workouts:includeRestDays([START,...WEEKS.flatMap(week=>[
    week.first==='U'?university(week):cycling(week),combined(week,'A'),combined(week,'B'),
  ])]),
};
