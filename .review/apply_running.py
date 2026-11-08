from pathlib import Path
import json, subprocess
root=Path.cwd()
p=root/'training-plan.js'
old=p.read_text()
assert 'export const PLAN_REVISION=2;' in old, 'Expected revision 2; stop rather than overwrite newer work.'
previous=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {TRAINING_PLAN} from './training-plan.js'; import {normalizePlan} from './core.js'; console.log(JSON.stringify(normalizePlan(TRAINING_PLAN)));"],text=True))
(root/'tests/fixtures/plan-v34.json').write_text(json.dumps(previous,ensure_ascii=False,indent=2)+'\n')
hashes=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {TRAINING_PLAN} from './training-plan.js'; import {normalizePlan} from './core.js'; const hash=w=>{let h=2166136261;for(const c of JSON.stringify(w))h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0).toString(36)};console.log(JSON.stringify(Object.fromEntries(normalizePlan(TRAINING_PLAN).workouts.map(w=>[w.id,hash(w)]))));"],text=True))
s=old.replace('// Revised coaching block, 07 November 2026.', '// Running progression review, 08 November 2026.').replace('export const PLAN_REVISION=2;','export const PLAN_REVISION=3;')
a=s.index('export const RUN_SCHEDULE=['); b=s.index('\nconst EASY=',a)
s=s[:a]+'''export const RUN_SCHEDULE=[
  {number:1,monday:'2026-11-09',first:'U',a:4,b:4,reps:4,repM:200,recoveryM:200,coolM:1200,effort:6,sets:2,extra:false,goal:'4,0 km locker + 4 × 200 m kontrolliert. Die erste Vergleichswoche, keine Sprints.'},
  {number:2,monday:'2026-11-16',first:'U',a:4,b:4,reps:5,repM:200,recoveryM:200,coolM:800,effort:6,sets:2,extra:false,goal:'8,0 km gesamt. Ein 200-m-Intervall mehr, gleiches kontrolliertes Tempo.'},
  {number:3,monday:'2026-11-23',first:'C',a:4.2,b:4,reps:5,repM:200,recoveryM:200,coolM:800,effort:6,sets:2,extra:true,goal:'4,2 km locker. Die Intervalle bleiben gleich; der dritte Krafttermin startet sehr leicht.'},
  {number:4,monday:'2026-11-30',first:'U',a:4,b:4,reps:4,repM:200,recoveryM:200,coolM:1200,effort:6,sets:2,extra:false,goal:'Entlastung: 4,0 km locker und nur 4 × 200 m. Mit Woche 1 vergleichen, nicht schneller erzwingen.'},
  {number:5,monday:'2026-12-07',first:'U',a:4.2,b:4.2,reps:4,repM:300,recoveryM:200,coolM:1000,effort:7,sets:2,extra:true,goal:'4,2 km locker + 4 × 300 m. Längere Abschnitte, kein zusätzlicher Temposprung.'},
  {number:6,monday:'2026-12-14',first:'U',a:4.4,b:4.2,reps:4,repM:300,recoveryM:200,coolM:1000,effort:7,sets:3,extra:true,goal:'4,4 km locker. Intervalle festigen; den dritten Kraftsatz nur gut erholt ergänzen.'},
  {number:7,monday:'2026-12-21',first:'U',a:4,b:4,reps:4,repM:200,recoveryM:200,coolM:1200,effort:6,sets:2,extra:false,goal:'Weihnachts-Entlastung: 4,0 km locker + kurze Intervalle am Sonntag, 27. Dezember.'},
  {number:8,monday:'2026-12-28',first:'C',a:4.4,b:4.2,reps:4,repM:300,recoveryM:200,coolM:1000,effort:7,sets:2,extra:false,goal:'Den Stand vor Weihnachten wiederholen: 4,4 km locker und 4 × 300 m.'},
  {number:9,monday:'2027-01-04',first:'U',a:4.6,b:4.5,reps:4,repM:400,recoveryM:200,coolM:900,effort:7,sets:3,extra:true,goal:'4,6 km locker + 4 × 400 m. Alle Intervalle möglichst gleichmäßig, nicht maximal.'},
  {number:10,monday:'2027-01-11',first:'C',a:4.8,b:4.5,reps:4,repM:400,recoveryM:200,coolM:900,effort:7,sets:3,extra:true,goal:'4,8 km locker am Freitagvormittag statt Mittwochabend. Samstag dieselben 4 × 400 m.'},
  {number:11,monday:'2027-01-18',first:'U',a:5,b:5,reps:5,repM:400,recoveryM:200,coolM:800,effort:7,sets:3,extra:true,goal:'5,0 km locker + 5 × 400 m: 10,0 Wochenkilometer. Bei Klausurstress nicht steigern.'},
  {number:12,monday:'2027-01-25',first:'U',a:5,b:5,reps:5,repM:400,recoveryM:200,coolM:800,effort:7,sets:2,extra:false,goal:'5,0 km locker und 5 × 400 m festigen. Kraft reduziert; Fortschritt vergleichen, kein zusätzlicher Maximaltest.'},
];''' +s[b:]
a=s.index("const QUALITY="); b=s.index('\nconst SAFETY=',a)
s=s[:a]+"const QUALITY='Ein Intervalltermin pro Woche ab Woche 1. Einstiegsvoraussetzung: Die gemeldeten 5 km sind aktuell beschwerdefrei möglich. Zu Beginn nur kontrolliert zügig, keine Sprints. Bei starker Restmüdigkeit oder wenn Uni-Sport bereits den harten Laufreiz liefert: denselben Lauf locker absolvieren. Eine Intervalleinheit ist geplant, aber keine Pflicht trotz Schmerzen, Infekt oder Erschöpfung.';"+s[b:]
s=s.replace('Kalenderstand 07.11.2026, keine laufende Kalender-Synchronisierung.','Geprüft am 08.11.2026 gegen Kalenderstand 07.11.2026, keine laufende Kalender-Synchronisierung.')
a=s.index('function runStep('); b=s.index('\nfunction pushups(',a)
s=s[:a]+'''function runStep(w,kind){
  const dist=kind==='A'?w.a:w.b;
  if(kind==='B')return step('run',`Intervalle · ${w.reps} × ${w.repM} m · ${km(dist)} km gesamt`,
    `1,4 km locker einlaufen; danach kurz Sprunggelenke und Hüfte mobilisieren. Dann ${w.reps} × ${w.repM} m kontrolliert zügig, dazwischen jeweils ${w.recoveryM} m sehr locker traben (${w.reps-1} Trabpausen); zuletzt ${km(w.coolM/1000)} km locker auslaufen. Alles zusammen ${km(dist)} km. Zügig: Anstrengung ${w.effort}/10, maximal 8/10; kein Sprint und noch nicht das Zieltempo 4:00 min/km erzwingen. Bei längeren Wiederholungen kann der Puls gegen Ende in die persönliche Zone 4 steigen. Bei kurzen Intervallen reagiert der Puls verzögert: keine Pulszahl erzwingen. Einlaufen, Trabpausen und Auslaufen in Zone 1–2 / Sprechtempo. Die Wiederholungen gleichmäßig laufen; bei deutlichem Tempo- oder Technikverlust den schnellen Teil beenden. Bei Müdigkeit dieselbe Strecke locker oder kürzer, bei Beschwerden stoppen.`);
  return step('run',`Dauerlauf · ${km(dist)} km · locker / Zone 2`,
    `Die ${km(dist)} km am Stück locker laufen, ohne geplante Gehpausen. Erste und letzte 0,5 km besonders ruhig; sie sind enthalten. Persönliche Zone 2 als Orientierung, ganze Sätze sprechen können, Anstrengung 3–4/10. Die 5-km-Bestpace ist kein Dauerlauftempo. Zum Vergleich möglichst dieselbe flache Strecke nutzen: Zeit und Durchschnittspuls der ersten 4 km in der Uhr ansehen. Ein schnelleres Tempo bei ähnlichem Puls oder dieselbe Pace mit weniger Anstrengung kann Fortschritt zeigen; Wetter und Tagesform berücksichtigen. Kein wöchentlicher Bestzeitversuch und keine Extrarunde.`);
}''' +s[b:]
a=s.index('function running('); b=s.index('\nfunction strength(',a)
s=s[:a]+'''function running(w,code){
  const a=code==='A',sourceDate=a?addDays(w.monday,2):addDays(w.monday,w.number===7?6:5);
  // Stable ID preserves existing flags; the tight January 13 run moves to daylight on Friday.
  const d=a&&w.number===10?'2027-01-15':sourceDate;
  const exceptions={'2027-01-20':['13:15','14:15'],'2027-01-27':['14:15','15:15']};
  const [start,end]=a?(exceptions[d]||['09:30','10:30']):['10:30','12:05'];
  const kind=a?'easy':'interval',dist=a?w.a:w.b;
  return {...common(w,code,sourceDate,start,end),date:d,type:a?'run':'other',runDistanceKm:dist,runKind:kind,
    title:a?`Dauerlauf · ${km(dist)} km`:`Intervalle & Kraft · ${km(dist)} km`,
    durationLabel:`${km(dist)} km${a?'':' + Kraft'}`,zone:a?'Locker / Zone 2':`Intervalle · ${w.effort}/10, Puls nachrangig`,
    focus:a?'Grundlagenausdauer: von 4,0 auf 5,0 km':`${w.reps} × ${w.repM} m; danach Kraft mit Reserve`,
    description:`${km(dist)} km insgesamt, einschließlich Ein- und Auslaufen${a?'.':'; danach das Kraftprogramm.'} Das Zeitfenster ist ein Puffer, keine Laufzeitvorgabe.${d==='2027-01-15'?' Wegen der Uni am Mittwoch auf Freitagvormittag verschoben. Heute wirklich locker bleiben; bis zu den Samstagsintervallen sind ab Trainingsende 24 Stunden frei.':''}`,
    instructions:a?RUN_RULES:COMBINED_RULES,steps:a?[runStep(w,code)]:[runStep(w,code),...strengthSteps(w,'B')]};
}''' +s[b:]
s=s.replace("description:'Zwei feste Läufe, zwei bis drei Krafteinheiten. Zunächst vier, später bis zu fünf Sporttage einschließlich Uni-Sport. Wochenweise bis 31. Januar 2027.'", "description:'Jede Woche ein lockerer Lauf von 4 auf 5 km und ein Intervalltraining; zwei feste Krafteinheiten, teilweise ein leichter Zusatztermin. Höchstens fünf Sporttage einschließlich Uni-Sport.'")
s=s.replace('function fingerprint(w)', 'const LEGACY_V34='+json.dumps(hashes,ensure_ascii=False,separators=(',',':'))+';\nfunction fingerprint(w)')
s=s.replace('const REVISED=normalizePlan(TRAINING_PLAN);',"const REVISED=normalizePlan(TRAINING_PLAN);\nconst isShipped=w=>[LEGACY[w.id],LEGACY_V34[w.id]].includes(fingerprint(w));")
s=s.replace('!LEGACY[w.id]||fingerprint(w)!==LEGACY[w.id]', '!isShipped(w)')
s=s.replace('o.date===w.date&&LEGACY[o.id]', 'o.date===w.date&&isShipped(o)')
s=s.replace("state.plan.description?.startsWith('Drei Trainingstage')?TRAINING_PLAN.description:state.plan.description", "(state.plan.description?.startsWith('Drei Trainingstage')||state.plan.description==="+json.dumps(previous['description'],ensure_ascii=False)+")?TRAINING_PLAN.description:state.plan.description")
p.write_text(s)
p=root/'package.json';pkg=json.loads(p.read_text());pkg['version']='3.5.0';p.write_text(json.dumps(pkg,indent=2)+'\n')
p=root/'tracker-view.js';s=p.read_text();s=s.replace("${runs.length} Läufe · ${runTotal.toFixed(1).replace('.',',')} km gesamt", "${runs.length} Läufe · ${runs.filter(w=>w.runKind==='interval').length} Intervalltraining · ${runTotal.toFixed(1).replace('.',',')} km gesamt");p.write_text(s)
p=root/'app.js';s=p.read_text();needle="state=updated;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));"
s=s.replace(needle,"const revisionBackup='pista.plan-review.previous.r'+updated.plan.revision;if(!localStorage.getItem(revisionBackup))localStorage.setItem(revisionBackup,JSON.stringify(state));"+needle);p.write_text(s)
p=root/'tests/plan.test.js';s=p.read_text().replace('revision 2 is complete','revision 3 is complete')
s=s.replace('const totals=[6,6.4,7,6,6.9,7.4,6.4,7,7.9,8.2,9,7];','const totals=[8,8,8.2,8,8.4,8.6,8,8.6,9.1,9.3,10,10];')
s=s.replace("w.number===12?1:0",'0').replace('run.runDistanceKm>=3','run.runDistanceKm>=4').replace('1200+w.reps','1400+w.reps')
s=s.replace("assert.equal(1.2+2+0.8,4);", "assert.equal(RUN_SCHEDULE[0].a,4);assert.equal(RUN_SCHEDULE.at(-1).a,5);")
s=s.replace("workouts.filter(w=>w.runKind==='interval').length,5", "workouts.filter(w=>w.runKind==='interval').length,12")
s=s.replace("['tpab-2027-01-13-a','15:15','16:00']", "['tpab-2027-01-13-a','09:30','10:30']").replace("'13:15','14:05'","'13:15','14:15'").replace("'14:15','15:05'","'14:15','15:15'").replace("'10:30','11:55'","'10:30','12:05'")
s=s.replace("assert.equal(minutes(byId('tpab-2027-01-13-a').startTime)-14*60,75);", "assert.equal(byId('tpab-2027-01-13-a').date,'2027-01-15');assert.equal(14*60-minutes(byId('tpab-2027-01-13-a').endTime),210);")
s=s.replace('.runDistanceKm,3)', '.runDistanceKm,4)').replace('next.plan.revision,2)', 'next.plan.revision,3)').replace(".startTime,'15:15')", ".startTime,'09:30')")
p.write_text(s)
p=root/'tests/browser_test.py';s=p.read_text().replace("expect(january).to_contain_text('15:15')", "expect(january).to_have_attribute('data-date', '2027-01-15')\n        expect(january).to_contain_text('09:30')").replace("expect(january).to_contain_text('16:00')", "expect(january).to_contain_text('10:30')")
s=s.replace("('15:15', '16:00', 'Uni-Sport'", "('09:30', '10:30', 'Uni-Sport'").replace('plan.revision === 2','plan.revision === 3').replace("plan.revision') == 2", "plan.revision') == 3")
p.write_text(s)
print('Applied running progression revision 3 and preserved exact v3.4 migration fixture.')
