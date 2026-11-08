import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TRAINING_PLAN,PLAN_REVISION,RUN_SCHEDULE,updateClientPlanState} from '../training-plan.js';
import {days,normalizePlan,normalizeState,progressFor,setDone,stats,parseImport} from '../core.js';
const workouts=TRAINING_PLAN.workouts;
const training=workouts.filter(w=>w.type!=='rest'), rest=workouts.filter(w=>w.type==='rest');
const byId=id=>workouts.find(w=>w.id===id);
const clientState=()=>normalizeState({version:1,plan:TRAINING_PLAN,progress:{},updatedAt:null});
const oldPlan=JSON.parse(readFileSync(new URL('./fixtures/plan-v33.json',import.meta.url),'utf8'));
const legacyState=()=>normalizeState({version:1,plan:oldPlan,progress:{},updatedAt:'2026-11-07T20:00:00Z'});

test('revision 3 is complete, private-feed-free and does not invent an exam date',()=>{
  const plan=normalizePlan(TRAINING_PLAN);
  assert.equal(plan.id,'tp-ab-2026-2027');assert.equal(plan.revision,PLAN_REVISION);
  assert.equal(plan.demo,false);assert.equal(plan.targetDate,null);
  assert.equal(training.length,55);assert.equal(rest.length,36);
  assert.equal(workouts.length,91);assert.equal(new Set(workouts.map(w=>w.id)).size,91);
  assert.deepEqual(workouts.map(w=>w.date),days('2026-11-02','2027-01-31'));
  assert.equal(workouts.filter(w=>w.optional).length,4);
  assert.equal(workouts.filter(w=>w.sessionCode==='U').length,9);
  assert.equal(workouts.filter(w=>w.sessionCode==='C').length,3);
  assert.doesNotMatch(JSON.stringify(TRAINING_PLAN),/ical-export|token=|api[_-]?key/i);
});

test('every week has seven entries, two runs, two or three strength sessions and at most five sport days',()=>{
  for(const schedule of RUN_SCHEDULE){
    const week=workouts.filter(w=>w.weekNumber===schedule.number);
    const active=week.filter(w=>w.type!=='rest');
    assert.equal(week.length,7);assert.equal(new Set(week.map(w=>w.date)).size,7);
    assert.equal(active.length,schedule.extra?5:4);
    assert.equal(week.filter(w=>w.type==='rest').length,schedule.extra?2:3);
    assert.equal(week.filter(w=>w.runDistanceKm>0).length,2);
    assert.equal(week.filter(w=>w.steps.some(s=>s.id==='pushups')).length,schedule.extra?3:2);
    assert.equal(new Set(week.map(w=>w.weekGoal)).size,1);
    assert.equal(week.filter(w=>w.sessionCode==='U').length,schedule.first==='U'?1:0);
  }
  for(const w of rest){
    assert.equal(w.durationMinutes,0);assert.equal(w.startTime,'');assert.equal(w.endTime,'');
    assert.equal(w.sessionCode,'REST');assert.deepEqual(w.steps,[]);
  }
});

test('running progression includes recovery weeks and all warmup/recovery/cooldown distance, never more than 5 km',()=>{
  const totals=[8,8,8.2,8,8.4,8.6,8,8.6,9.1,9.3,10,10];
  for(const w of RUN_SCHEDULE){
    const runs=workouts.filter(x=>x.weekNumber===w.number&&x.runDistanceKm>0);
    assert.equal(Math.round(runs.reduce((s,x)=>s+x.runDistanceKm,0)*10)/10,totals[w.number-1]);
    assert.equal(runs.filter(x=>x.runKind==='interval').length,w.reps?1:0);
    assert.equal(runs.filter(x=>x.runKind==='check').length,0);
    for(const run of runs){
      assert.ok(run.runDistanceKm<=5&&run.runDistanceKm>=4);
      assert.match(run.steps[0].title,/km/);
      assert.doesNotMatch(run.steps[0].details,/\d+\s*Min\.\s*(gehen|ausgehen)|joggen oder gehen|Gehpausen erlaubt/);
      assert.match(run.instructions,/Zone 2/);
      assert.match(run.instructions,/Uni-Sport/);
      assert.match(run.instructions,/Glätte/);
    }
    if(w.reps){
      assert.equal(1400+w.reps*w.repM+(w.reps-1)*w.recoveryM+w.coolM,w.b*1000);
      assert.match(runs[1].steps[0].details,/Puls.*verzögert/);
      assert.match(runs[1].steps[0].details,/kein Sprint/);
    }
  }
  assert.equal(RUN_SCHEDULE[0].a,4);assert.equal(RUN_SCHEDULE.at(-1).a,5);
  assert.equal(workouts.filter(w=>w.runKind==='interval').length,12);
  assert.ok(RUN_SCHEDULE[3].a+RUN_SCHEDULE[3].b<RUN_SCHEDULE[2].a+RUN_SCHEDULE[2].b);
});

test('calendar exceptions reserve commute plus change time and retain holiday/exam recovery',()=>{
  const exceptions=[
    ['tpab-2027-01-13-a','09:30','10:30'],['tpab-2027-01-20-a','13:15','14:15'],
    ['tpab-2027-01-27-a','14:15','15:15'],['tpab-2026-12-27-b','10:30','12:05'],
    ['tpab-2026-11-12-s','19:15','20:00'],['tpab-2026-12-17-s','07:00','07:40'],
    ['tpab-2026-12-24-s','10:00','10:40'],['tpab-2026-12-31-s','10:00','10:40'],
    ['tpab-2026-11-23-c','17:00','17:25'],['tpab-2026-12-28-c','17:00','17:25'],
    ['tpab-2027-01-11-c','17:00','17:25'],
  ];
  for(const [id,start,end] of exceptions){assert.equal(byId(id)?.startTime,start,id);assert.equal(byId(id)?.endTime,end,id);}
  for(const d of ['2026-12-25','2026-12-26','2027-01-01','2027-01-22','2027-01-26','2027-01-29'])assert.equal(workouts.find(w=>w.date===d).type,'rest',d);
  const minutes=t=>+t.slice(0,2)*60 + +t.slice(3);
  for(const w of training){assert.ok(w.endTime>w.startTime,w.id);assert.equal(minutes(w.endTime)-minutes(w.startTime),w.durationMinutes,w.id);}
  assert.equal(byId('tpab-2027-01-13-a').date,'2027-01-15');assert.equal(14*60-minutes(byId('tpab-2027-01-13-a').endTime),210);
  assert.equal(9*60-minutes(byId('tpab-2026-12-17-s').endTime),80);
});

test('instructions are bounded and strength progresses by successful reps, not daily failure',()=>{
  for(const w of training){
    assert.ok(w.instructions.length>0&&w.instructions.length<=2000,w.id);
    assert.ok(w.description.length<=2000,w.id);
    assert.equal(new Set(w.steps.map(s=>s.id)).size,w.steps.length);
    for(const s of w.steps){assert.ok(s.title.length>0&&s.title.length<=120,w.id);assert.ok(s.details.length>0&&s.details.length<=1000,w.id);}
    if(w.sessionCode==='T')assert.match(w.steps.find(s=>s.id==='pushups').details,/3–4/);
    if(['S','B'].includes(w.sessionCode)){
      assert.match(w.instructions,/Klimmz/);assert.match(w.instructions,/Reserve/);assert.match(w.instructions,/zweimal/);
    }
  }
  assert.match(byId('tpab-2026-11-24-t').steps.find(s=>s.id==='pushups').title,/1 ×/);
  assert.match(byId('tpab-2027-01-21-s').steps.find(s=>s.id==='pushups').title,/3 ×/);
  assert.match(byId('tpab-2027-01-28-s').steps.find(s=>s.id==='pushups').details,/40 Sek/);
  assert.equal(byId('tpab-2027-01-27-a').steps.length,1);
});

test('plain v3.3 client is fully revised and its whole-workout checks and notes survive',()=>{
  const previous=legacyState();
  const id='tpab-2026-11-11-a';previous.progress[id]={done:false,steps:{},note:'Meine Laufnotiz',completedAt:null};
  const snapshot=JSON.stringify(previous);const next=updateClientPlanState(previous);
  assert.equal(JSON.stringify(previous),snapshot);assert.equal(next.plan.revision,PLAN_REVISION);
  assert.equal(next.plan.workouts.length,91);
  assert.equal(next.plan.workouts.find(w=>w.id===id).runDistanceKm,4);
  assert.equal(next.progress[id].note,'Meine Laufnotiz');assert.equal(next.progress[id].done,false);
  assert.equal(next.plan.workouts.filter(w=>w.type==='rest').length,36);
  assert.strictEqual(updateClientPlanState(next),next);
  assert.doesNotThrow(()=>normalizeState(next));
});

test('completed workouts and completed old rest days are not relabeled as new training',()=>{
  const previous=legacyState();
  for(const id of ['tpab-2026-11-11-a','tpab-2026-11-12-rest']){setDone(previous,id,true,'2026-11-07T21:00:00Z');previous.progress[id].note='Bestehender Eintrag';}
  const next=updateClientPlanState(previous);
  for(const id of ['tpab-2026-11-11-a','tpab-2026-11-12-rest']){
    assert.deepEqual(next.plan.workouts.find(w=>w.id===id),previous.plan.workouts.find(w=>w.id===id));
    assert.deepEqual(next.progress[id],previous.progress[id]);
  }
  assert.equal(next.plan.workouts.some(w=>w.id==='tpab-2026-11-12-s'),false);
  assert.equal(next.plan.workouts.length,91);
  assert.equal(JSON.stringify(normalizeState(next).progress['tpab-2026-11-12-rest']),JSON.stringify(previous.progress['tpab-2026-11-12-rest']));
});

test('notes on a replaced open rest day move to the new day without inheriting completion',()=>{
  const previous=legacyState();previous.progress['tpab-2026-11-12-rest']={done:false,steps:{},note:'Termin beachten',completedAt:null};
  const next=normalizeState(updateClientPlanState(previous));
  assert.equal(next.progress['tpab-2026-11-12-s'].note,'Termin beachten');
  assert.equal(next.progress['tpab-2026-11-12-s'].done,false);
  assert.equal(next.progress['tpab-2026-11-12-s'].completedAt,null);
});

test('personal edits, moved sessions and unrelated plans are preserved without duplicates',()=>{
  const previous=legacyState();
  previous.plan.title='Mein Titel';
  const moved=previous.plan.workouts.find(w=>w.id==='tpab-2026-11-11-a');moved.date='2026-11-12';moved.description='Eigene Ergänzung';
  previous.plan.workouts=previous.plan.workouts.filter(w=>w.id!=='tpab-2026-11-12-rest');
  const next=updateClientPlanState(previous);
  assert.equal(next.plan.title,'Mein Titel');assert.deepEqual(next.plan.workouts.find(w=>w.id===moved.id),moved);
  assert.equal(next.plan.workouts.find(w=>w.date==='2026-11-11').type,'rest');
  assert.equal(next.plan.workouts.filter(w=>w.date==='2026-11-12').length,1);
  assert.equal(next.plan.workouts.length,91);assert.doesNotThrow(()=>normalizeState(next));
  const other={...previous,plan:{...previous.plan,id:'someone-else'}};assert.strictEqual(updateClientPlanState(other),other);
});

test('old training-only and 85-day versions gain all days and revised sessions',()=>{
  for(const kind of ['37','85']){
    const previous=legacyState();previous.plan.workouts=previous.plan.workouts.filter(w=>kind==='37'?w.type!=='rest':w.date>='2026-11-08');
    assert.equal(previous.plan.workouts.length,+kind);
    const next=normalizeState(updateClientPlanState(previous));assert.equal(next.plan.workouts.length,91);assert.equal(next.plan.revision,3);
    assert.equal(next.plan.workouts.find(w=>w.id==='tpab-2027-01-13-a').startTime,'09:30');
  }
});

test('rest checks survive backup/restore and do not invent training minutes',()=>{
  const state=clientState(),id='tpab-2026-11-10-rest';
  setDone(state,id,true,'2026-11-10T18:00:00Z');state.progress[id].note='Gut erholt';
  const next=parseImport(JSON.stringify({kind:'pista-backup',state})).state;
  assert.strictEqual(updateClientPlanState(next),next);assert.equal(progressFor(next,id).done,true);assert.equal(progressFor(next,id).note,'Gut erholt');
  assert.equal(stats(next).minutes,0);assert.equal(stats(next).restDone,1);assert.equal(stats(next).trainingTotal,55);
  setDone(next,'tpab-2026-11-09-u',true);assert.equal(stats(next).minutes,90);
  setDone(next,id,false);assert.equal(progressFor(next,id).completedAt,null);assert.equal(progressFor(next,id).note,'Gut erholt');
});


test('migration sorts preserved history and replacement workouts chronologically, including the first partial week',()=>{
  const state=legacyState();
  state.plan.workouts=state.plan.workouts.filter(w=>w.date>='2026-11-08');
  setDone(state,'tpab-2026-11-11-a',true);
  setDone(state,'tpab-2026-11-10-rest',true);
  state.progress['tpab-2026-11-11-a'].note='Keep the completed workout.';
  const next=updateClientPlanState(state);
  assert.deepEqual(next.plan.workouts.map(w=>w.date),days('2026-11-02','2027-01-31'));
  assert.deepEqual(next.progress,{...state.progress});
  assert.equal(next.plan.workouts[0].date,'2026-11-02');
  assert.equal(next.plan.workouts.at(-1).date,'2027-01-31');
  assert.strictEqual(updateClientPlanState(next),next);
});
