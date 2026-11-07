import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {TRAINING_PLAN,updateClientPlanState} from '../training-plan.js';
import {days,normalizePlan,normalizeState,progressFor,setDone,stats,parseImport} from '../core.js';

const workouts=TRAINING_PLAN.workouts;
const training=workouts.filter(w=>w.type!=='rest');
const rest=workouts.filter(w=>w.type==='rest');
const byId=id=>workouts.find(w=>w.id===id);
const clientState=()=>normalizeState({version:1,plan:TRAINING_PLAN,progress:{},updatedAt:null});

test('the client starts with the complete approved block, without a fake exam date',()=>{
  const plan=normalizePlan(TRAINING_PLAN);
  assert.equal(plan.id,'tp-ab-2026-2027');
  assert.equal(plan.demo,false);
  assert.equal(plan.targetDate,null);
  assert.equal(plan.workouts.length,85);
  assert.equal(training.length,37);
  assert.equal(rest.length,48);
  assert.equal(workouts[0].date,'2026-11-08');
  assert.equal(workouts.at(-1).date,'2027-01-31');
  assert.equal(workouts.filter(w=>w.optional).length,1);
  assert.equal(workouts[0].weekNumber,0);
  assert.equal(workouts.filter(w=>w.sessionCode==='U').length,9);
  assert.equal(workouts.filter(w=>w.sessionCode==='C').length,3);
  assert.equal(new Set(workouts.map(w=>w.id)).size,85);
  assert.doesNotMatch(JSON.stringify(TRAINING_PLAN),/ical-export|token=|api[_-]?key/i);
});

test('each regular week has exactly three training days including university sport',()=>{
  for(let number=1;number<=12;number++){
    const week=training.filter(w=>w.weekNumber===number);
    assert.equal(week.length,3,`Week ${number}: session count`);
    assert.equal(new Set(week.map(w=>w.date)).size,3,`Week ${number}: distinct days`);
    assert.deepEqual(week.map(w=>w.sessionCode).sort(),[3,8,10].includes(number)?['A','B','C']:['A','B','U']);
  }
});

test('every date has exactly one entry and every normal week has four genuine rest days',()=>{
  assert.deepEqual(workouts.map(w=>w.date),days('2026-11-08','2027-01-31'));
  for(let number=1;number<=12;number++){
    const week=workouts.filter(w=>w.weekNumber===number);
    assert.equal(week.length,7,`Week ${number}: every day`);
    assert.equal(week.filter(w=>w.type==='rest').length,4,`Week ${number}: rest days`);
    assert.equal(new Set(week.map(w=>w.weekGoal)).size,1,`Week ${number}: consistent goal`);
  }
  for(const w of rest){
    assert.equal(w.id,`tpab-${w.date}-rest`);
    assert.equal(w.title,'Ruhetag');
    assert.equal(w.sessionCode,'REST');
    assert.equal(w.durationMinutes,0);
    assert.equal(w.durationLabel,'Trainingsfrei');
    assert.equal(w.startTime,'');
    assert.equal(w.endTime,'');
    assert.equal(w.instructions,'');
    assert.deepEqual(w.steps,[]);
    assert.match(w.description,/Wenn du magst/);
    assert.equal(w.optional,false);
  }
});

test('all previously approved training contents, IDs and time windows remain unchanged',()=>{
  // Fingerprint of the 37 training entries in the approved, published v3.0 plan.
  assert.equal(createHash('sha256').update(JSON.stringify(training)).digest('hex'),'544fc0e0065f93c9d8759fc1a6ba4bb8db24ee21d997e1c0f84583d08c0e64f8');
});

test('calendar exceptions preserve the approved daylight and holiday slots',()=>{
  const exceptions=[
    ['tpab-2027-01-13-a','15:00','16:10'],
    ['tpab-2027-01-20-a','13:15','14:25'],
    ['tpab-2027-01-27-a','14:15','15:25'],
    ['tpab-2026-12-27-b','10:30','11:40'],
    ['tpab-2026-11-23-c','17:00','17:35'],
    ['tpab-2026-12-28-c','17:00','17:35'],
    ['tpab-2027-01-11-c','17:00','17:35'],
  ];
  for(const [id,start,end] of exceptions){
    const w=byId(id);
    assert.ok(w,id);
    assert.equal(w.startTime,start,id);
    assert.equal(w.endTime,end,id);
  }
  assert.equal(workouts.find(w=>w.date==='2026-12-26').type,'rest');
  for(const w of training){
    assert.ok(w.endTime>w.startTime,w.id);
    const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
    assert.equal(minutes(w.endTime)-minutes(w.startTime),w.durationMinutes,w.id);
  }
});

test('instructions remain complete, bounded and separate from checkable exercises',()=>{
  for(const w of training){
    assert.ok(w.instructions.length>0 && w.instructions.length<=2000,w.id);
    assert.ok(w.description.length<=2000,w.id);
    assert.equal(new Set(w.steps.map(s=>s.id)).size,w.steps.length,w.id);
    for(const s of w.steps){
      assert.ok(s.title.length>0 && s.title.length<=120,`${w.id}/${s.id}`);
      assert.ok(s.details.length>0 && s.details.length<=1000,`${w.id}/${s.id}`);
    }
    if(['A','B'].includes(w.sessionCode)){
      assert.equal(w.steps.length,6,w.id);
      assert.match(w.instructions,/Klimmzugoption/);
      assert.match(w.instructions,/Glätte/);
      assert.match(w.instructions,/Viertel/);
    }
  }
  for(const number of [5,6,9,10,11]){
    const run=workouts.find(w=>w.weekNumber===number&&w.sessionCode==='B').steps[0];
    assert.match(run.details,/zwei Wochen/);
    assert.match(run.details,/20 Min\./);
    assert.match(run.details,/Uni-Sport/);
    assert.match(run.details,/komplett locker/);
  }
  assert.match(byId('tpab-2027-01-27-a').steps.find(s=>s.id==='pushups').details,/Restmüdigkeit/);
  assert.match(byId('tpab-2027-01-30-b').steps[0].details,/kein Infekt/);
});

test('the existing client plan gains rest days without losing progress, notes or session edits',()=>{
  const previous=normalizeState({version:1,plan:{...TRAINING_PLAN,workouts:training},progress:{},updatedAt:'2026-11-12T09:00:00.000Z'});
  const id='tpab-2026-11-11-a';
  setDone(previous,id,true,'2026-11-11T10:00:00.000Z');
  previous.progress[id].note='Gut gelaufen.\nAuflage: Küchentisch.';
  previous.plan.workouts.find(w=>w.id===id).description='Meine ergänzte Erklärung.';
  previous.plan.title='Mein angepasster Titel';
  const snapshot=JSON.stringify(previous);
  const upgraded=updateClientPlanState(previous);
  assert.notStrictEqual(upgraded,previous);
  assert.equal(JSON.stringify(previous),snapshot,'migration must not mutate the old state');
  assert.equal(upgraded.plan.workouts.length,85);
  assert.strictEqual(upgraded.progress,previous.progress);
  assert.equal(upgraded.updatedAt,previous.updatedAt);
  assert.equal(upgraded.plan.title,previous.plan.title);
  for(const old of previous.plan.workouts)assert.strictEqual(upgraded.plan.workouts.find(w=>w.id===old.id),old);
  assert.equal(upgraded.progress[id].done,true);
  assert.equal(upgraded.progress[id].completedAt,'2026-11-11T10:00:00.000Z');
  assert.equal(upgraded.progress[id].note,'Gut gelaufen.\nAuflage: Küchentisch.');
  assert.strictEqual(updateClientPlanState(upgraded),upgraded,'the migration is idempotent');
});

test('migration respects manually moved and additional training dates and leaves other plans untouched',()=>{
  const previous=normalizeState({version:1,plan:{...TRAINING_PLAN,workouts:training},progress:{}});
  previous.plan.workouts.find(w=>w.id==='tpab-2026-11-11-a').date='2026-11-12';
  const extra={...previous.plan.workouts[0],id:'my-extra-session',date:'2026-11-10',title:'Eigener Termin'};
  previous.plan.workouts.push(extra);
  const upgraded=updateClientPlanState(previous);
  assert.strictEqual(upgraded.plan.workouts.find(w=>w.id===extra.id),extra);
  assert.equal(upgraded.plan.workouts.find(w=>w.date==='2026-11-11').type,'rest');
  assert.equal(upgraded.plan.workouts.filter(w=>w.date==='2026-11-10').length,1);
  assert.equal(upgraded.plan.workouts.filter(w=>w.date==='2026-11-12').length,1);
  assert.deepEqual(upgraded.plan.workouts.map(w=>w.date),days('2026-11-08','2027-01-31'));
  const personal={...previous,plan:{...previous.plan,id:'my-personal-plan'}};
  assert.strictEqual(updateClientPlanState(personal),personal);
});

test('rest-day checks and notes survive reloads and backup restores, and can be reopened',()=>{
  const state=clientState(),id='tpab-2026-11-10-rest';
  setDone(state,id,true,'2026-11-10T18:00:00.000Z');
  state.progress[id].note='Gut erholt.';
  const restored=parseImport(JSON.stringify({kind:'pista-backup',state})).state;
  assert.strictEqual(updateClientPlanState(restored),restored);
  assert.equal(progressFor(restored,id).done,true);
  assert.equal(progressFor(restored,id).note,'Gut erholt.');
  assert.equal(progressFor(restored,id).completedAt,'2026-11-10T18:00:00.000Z');
  assert.equal(Object.keys(progressFor(restored,id).steps).length,0);
  setDone(restored,id,false);
  assert.equal(progressFor(restored,id).done,false);
  assert.equal(progressFor(restored,id).completedAt,null);
  assert.equal(progressFor(restored,id).note,'Gut erholt.');
});

test('rest days count toward daily progress without adding training time or training completions',()=>{
  const state=clientState();
  assert.deepEqual(stats(state),{total:85,done:0,percent:0,minutes:0,plannedMinutes:2615,restTotal:48,restDone:0,trainingTotal:37,trainingDone:0});
  setDone(state,'tpab-2026-11-10-rest',true);
  let summary=stats(state,'2026-11-09','2026-11-15');
  assert.deepEqual(summary,{total:7,done:1,percent:14,minutes:0,plannedMinutes:230,restTotal:4,restDone:1,trainingTotal:3,trainingDone:0});
  setDone(state,'tpab-2026-11-09-u',true);
  summary=stats(state,'2026-11-09','2026-11-15');
  assert.equal(summary.done,2);
  assert.equal(summary.trainingDone,1);
  assert.equal(summary.restDone,1);
  assert.equal(summary.minutes,90);
});
