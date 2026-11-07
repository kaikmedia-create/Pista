import test from 'node:test';
import assert from 'node:assert/strict';
import {parseImport,normalizePlan,normalizeState,setDone,mergePlan} from '../core.js';
import {groupedWeeks,trackerView} from '../tracker-view.js';
import {TRAINING_PLAN} from '../training-plan.js';
const originalSchema={title:'Vorbereitung',targetDate:'2027-07-01',targetLabel:'Tage bis zum Ziel',weeks:[{week:1,goal:'Technik und Rhythmus',days:[{date:'2026-11-09',unit:'Technik',dauer:'30–40 min',zone:'Locker',type:'gym',fokus:'Saubere Ausführung',detail:'Individuell dosieren.'}]},{week:2,goal:'Konstanz',days:[{date:'2026-11-16',unit:'Dauerlauf',dauer:'1:15 h',zone:'Zone 2',type:'longrun',fokus:'Gleichmäßig',detail:'Testdaten, keine Trainingsempfehlung.'}]}]};
test('imports the actual Backyard weeks/days schema with goals, focus, zone and duration labels',()=>{
 const p=parseImport(JSON.stringify(originalSchema)).plan;
 assert.equal(p.workouts.length,2);assert.equal(p.workouts[0].type,'strength');assert.equal(p.workouts[1].type,'longrun');assert.equal(p.workouts[0].weekGoal,'Technik und Rhythmus');assert.equal(p.workouts[0].focus,'Saubere Ausführung');assert.equal(p.workouts[0].zone,'Locker');assert.equal(p.workouts[0].durationLabel,'30–40 min');assert.equal(p.workouts[0].durationMinutes,0);assert.equal(p.workouts[1].durationMinutes,75);assert.equal(p.targetDate,'2027-07-01');
});
test('Backyard arrays and PLAN wrappers work, IDs survive week reordering',()=>{
 const a=parseImport(JSON.stringify(originalSchema.weeks)).plan;
 const b=parseImport(JSON.stringify({PLAN:[...originalSchema.weeks].reverse()})).plan;
 assert.deepEqual(a.workouts.map(w=>w.id),b.workouts.map(w=>w.id));
});
test('existing Pista v1 progress survives extended metadata and re-import',()=>{
 const p=parseImport(JSON.stringify(originalSchema)).plan;
 const s=normalizeState({version:1,plan:p,progress:{}});setDone(s,p.workouts[0].id,true);
 const restored=mergePlan(s,p);assert.equal(restored.progress[p.workouts[0].id].done,true);assert.equal(restored.plan.workouts[0].weekGoal,p.workouts[0].weekGoal);
});
test('weeks stay chronological and retain the source goals',()=>{
 const groups=groupedWeeks(parseImport(JSON.stringify(originalSchema)).plan);
 assert.deepEqual(groups.map(g=>g.start),['2026-11-09','2026-11-16']);assert.equal(groups[0].goal,'Technik und Rhythmus');assert.equal(groups[1].number,2);
});
test('weekly UI has one whole-workout control and one explicit open action, with no inline or export controls',()=>{
 const plan=parseImport(JSON.stringify(originalSchema)).plan;
 const html=trackerView({plan,progress:{}},{today:'2026-11-09',selected:'2026-11-09'},()=>'<svg></svg>');
 for(const marker of ['role="progressbar"','Woche auswählen','data-action="done"','data-action="open"','Workout anzeigen'])assert.ok(html.includes(marker),marker);
 for(const marker of ['data-action="expand"','data-inline-step','data-step=','data-action="export"','data-action="export-paper"','data-action="mode"','Details anzeigen','Heute ·','Nächste Einheiten','by-expanded'])assert.ok(!html.includes(marker),marker);
 assert.equal((html.match(/data-action="done"/g)||[]).length,1);
 assert.equal((html.match(/data-action="open"/g)||[]).length,1);
 assert.ok(!html.includes('Falscher Code'));assert.ok(!html.includes('firebasedatabase'));
});
test('first week includes all seven calendar days and checkable rest days before the optional Sunday start',()=>{
 const plan=normalizePlan(TRAINING_PLAN);
 const html=trackerView({plan,progress:{}},{today:'2026-11-07',selected:'2026-11-07',view:'plan'},()=>'<svg></svg>');
 assert.equal((html.match(/data-workout-id=/g)||[]).length,7);
 assert.equal((html.match(/data-action="done"/g)||[]).length,7);
 assert.equal((html.match(/data-action="open"/g)||[]).length,7);
 for(let day=2;day<=7;day++)assert.ok(html.includes(`data-workout-id="tpab-2026-11-0${day}-rest"`));
 assert.ok(html.includes('data-workout-id="tpab-2026-11-08-start"'));
 assert.ok(html.includes('Ruhetag anzeigen'));
});
test('saved month or fortnight view arguments cannot expand the regular display beyond one week',()=>{
 const plan=parseImport(JSON.stringify(originalSchema)).plan;
 for(const planMode of ['month','fortnight']){
  const html=trackerView({plan,progress:{}},{today:'2026-11-09',selected:'2026-11-09',view:'plan',planMode},()=>'<svg></svg>');
  assert.equal((html.match(/data-workout-id=/g)||[]).length,1);
  assert.ok(html.includes('Technik'));
  assert.ok(!html.includes('Dauerlauf'));
  assert.ok(!html.includes('data-action="mode"'));
 }
});
test('rejects invalid target dates, malformed weekly plans and executable input',()=>{
 assert.throws(()=>parseImport(JSON.stringify({...originalSchema,targetDate:'2027-02-30'})),/Ungültiges Datum/);
 assert.throws(()=>parseImport(JSON.stringify([{days:null}])),/days/);
 assert.throws(()=>parseImport('const PLAN = [];'),/Ungültiges JSON/);
});
