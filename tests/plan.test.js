import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAINING_PLAN} from '../training-plan.js';
import {normalizePlan} from '../core.js';

const workouts=TRAINING_PLAN.workouts;
const byId=id=>workouts.find(w=>w.id===id);

test('the client starts with the complete approved block, without a fake exam date',()=>{
  const plan=normalizePlan(TRAINING_PLAN);
  assert.equal(plan.id,'tp-ab-2026-2027');
  assert.equal(plan.demo,false);
  assert.equal(plan.targetDate,null);
  assert.equal(plan.workouts.length,37);
  assert.equal(workouts[0].date,'2026-11-08');
  assert.equal(workouts.at(-1).date,'2027-01-30');
  assert.equal(workouts.filter(w=>w.optional).length,1);
  assert.equal(workouts[0].weekNumber,0);
  assert.equal(workouts.filter(w=>w.sessionCode==='U').length,9);
  assert.equal(workouts.filter(w=>w.sessionCode==='C').length,3);
  assert.equal(new Set(workouts.map(w=>w.id)).size,37);
  assert.doesNotMatch(JSON.stringify(TRAINING_PLAN),/ical-export|token=|api[_-]?key/i);
});

test('each regular week has exactly three training days including university sport',()=>{
  for(let number=1;number<=12;number++){
    const week=workouts.filter(w=>w.weekNumber===number);
    assert.equal(week.length,3,`Week ${number}: session count`);
    assert.equal(new Set(week.map(w=>w.date)).size,3,`Week ${number}: distinct days`);
    assert.deepEqual(week.map(w=>w.sessionCode).sort(),[3,8,10].includes(number)?['A','B','C']:['A','B','U']);
  }
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
  assert.equal(workouts.filter(w=>w.date==='2026-12-26').length,0);
  for(const w of workouts){
    assert.ok(w.endTime>w.startTime,w.id);
    const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
    assert.equal(minutes(w.endTime)-minutes(w.startTime),w.durationMinutes,w.id);
  }
});

test('instructions remain complete, bounded and separate from checkable exercises',()=>{
  for(const w of workouts){
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
