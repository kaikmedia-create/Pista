import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TRAINING_PLAN,RUN_SCHEDULE,updateClientPlanState} from '../training-plan.js';
import {normalizeState,setDone} from '../core.js';
const workouts=TRAINING_PLAN.workouts;
const byId=id=>workouts.find(w=>w.id===id);

test('the shipped v3.4 plan migrates to weekly intervals and 4–5 km while retaining personal data',()=>{
  const previous=normalizeState({version:1,plan:JSON.parse(readFileSync(new URL('./fixtures/plan-v34.json',import.meta.url),'utf8')),progress:{}});
  previous.progress['tpab-2026-11-11-a']={done:false,steps:{},note:'Keine Daten verlieren',completedAt:null};
  const before=JSON.stringify(previous),next=updateClientPlanState(previous);
  assert.equal(JSON.stringify(previous),before);
  assert.equal(next.plan.revision,3);assert.equal(next.plan.workouts.length,91);
  assert.equal(next.plan.workouts.filter(w=>w.runKind==='interval').length,12);
  assert.equal(next.plan.workouts.find(w=>w.id==='tpab-2026-11-11-a').runDistanceKm,4);
  assert.equal(next.plan.workouts.find(w=>w.id==='tpab-2027-01-13-a').date,'2027-01-15');
  assert.equal(next.plan.workouts.find(w=>w.date==='2027-01-13').type,'rest');
  assert.equal(next.progress['tpab-2026-11-11-a'].note,'Keine Daten verlieren');
  assert.equal(next.plan.description,TRAINING_PLAN.description);
  assert.strictEqual(updateClientPlanState(next),next);
});

test('v3.4 completed or personally edited workouts are not rewritten into longer workouts',()=>{
  const previous=normalizeState({version:1,plan:JSON.parse(readFileSync(new URL('./fixtures/plan-v34.json',import.meta.url),'utf8')),progress:{}});
  setDone(previous,'tpab-2026-11-11-a',true);
  const edit=previous.plan.workouts.find(w=>w.id==='tpab-2026-11-14-b');edit.description='Persönlich angepasst';
  const next=updateClientPlanState(previous);
  assert.deepEqual(next.plan.workouts.find(w=>w.id==='tpab-2026-11-11-a'),previous.plan.workouts.find(w=>w.id==='tpab-2026-11-11-a'));
  assert.deepEqual(next.plan.workouts.find(w=>w.id===edit.id),edit);
  assert.deepEqual(next.progress,{...previous.progress});
  assert.equal(next.plan.workouts.find(w=>w.id==='tpab-2026-11-18-a').runDistanceKm,4);
});

test('weekly intervals start controlled, remain visible in recovery weeks and are not fake 2-km tests',()=>{
  for(const w of RUN_SCHEDULE){
    const week=workouts.filter(x=>x.weekNumber===w.number);
    assert.equal(week.filter(x=>x.runKind==='easy').length,1);
    assert.equal(week.filter(x=>x.runKind==='interval').length,1);
    assert.ok(w.a>=4&&w.a<=5&&w.b>=4&&w.b<=5);
    assert.ok(w.coolM>=800);
    assert.equal(1400+w.reps*w.repM+(w.reps-1)*w.recoveryM+w.coolM,w.b*1000);
    assert.equal(week.filter(x=>x.runKind==='check').length,0);
  }
  assert.equal(RUN_SCHEDULE[0].effort,6);
  for(const i of [3,6])assert.ok(RUN_SCHEDULE[i].reps*RUN_SCHEDULE[i].repM<RUN_SCHEDULE[i-1].reps*RUN_SCHEDULE[i-1].repM);
  assert.equal(RUN_SCHEDULE.at(-1).a,5);
  assert.match(byId('tpab-2027-01-30-b').steps[0].details,/5 × 400 m/);
});
