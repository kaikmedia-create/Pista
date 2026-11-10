import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TRAINING_PLAN,exerciseHelpFor} from '../training-plan.js';
import {normalizePlan} from '../core.js';

const plan=normalizePlan(TRAINING_PLAN);
const previous=normalizePlan(JSON.parse(readFileSync(new URL('./fixtures/plan-v35.json',import.meta.url),'utf8')));
const datesFor=id=>plan.workouts.filter(w=>w.steps.some(s=>s.id===id)).map(w=>w.date);
const techniqueDates=['2026-11-14','2026-11-28','2026-12-12','2027-01-02','2027-01-16','2027-01-30'];
const bodyDates=['2026-11-11','2026-11-25','2026-12-16','2027-01-06'];
const paceDates=['2026-12-09','2026-12-30','2027-01-20'];

test('the added exercises are limited to six technique, four body-check and three time-guess sessions',()=>{
  assert.deepEqual(datesFor('knee-march'),techniqueDates);
  assert.deepEqual(datesFor('quick-feet'),techniqueDates);
  assert.deepEqual(datesFor('body-check'),bodyDates);
  assert.deepEqual(datesFor('pace-guess'),paceDates);
  assert.equal(plan.workouts.filter(w=>w.steps.some(s=>exerciseHelpFor(s))).length,6);
});

test('drills keep every date, training window, kilometre, intensity and strength exercise from v3.5',()=>{
  assert.equal(plan.workouts.length,previous.workouts.length);
  for(const workout of plan.workouts){
    const old=previous.workouts.find(w=>w.id===workout.id);
    assert.ok(old,workout.id);
    const {steps,...metadata}=workout;
    const {steps:oldSteps,...oldMetadata}=old;
    assert.deepEqual(metadata,oldMetadata,workout.id);
    if(workout.runKind==='interval'){
      assert.deepEqual(steps.filter(s=>!['run-warmup','knee-march','quick-feet','run'].includes(s.id)),oldSteps.filter(s=>s.id!=='run'),workout.id);
      const main=steps.find(s=>s.id==='run'),oldMain=oldSteps.find(s=>s.id==='run');
      assert.equal(main.title,oldMain.title,workout.id);
      assert.equal(main.details.match(/\d+ × \d+ m kontrolliert zügig/)[0],oldMain.details.match(/\d+ × \d+ m kontrolliert zügig/)[0],workout.id);
      assert.match(main.details,/kein Sprint/);
    }
  }
});

test('technique comes after one warm-up and before intervals with no extra running distance',()=>{
  for(const date of techniqueDates){
    const workout=plan.workouts.find(w=>w.date===date);
    assert.equal(workout.runKind,'interval');
    assert.deepEqual(workout.steps.slice(0,4).map(s=>s.id),['run-warmup','knee-march','quick-feet','run']);
    assert.match(workout.steps[0].details,/2–3 Min/);
    assert.match(workout.steps[0].details,/Restmüdigkeit, Schmerzen/);
    assert.match(workout.steps[0].details,/wenn die Intervalle heute entfallen/);
    assert.match(workout.steps[1].title,/2 × 15 m/);
    assert.match(workout.steps[2].title,/am Platz.*2 × 10 Sek/);
    assert.match(workout.steps[2].details,/20 Sek\. Pause/);
    assert.match(workout.steps[3].details,/Mit dem Einlaufen insgesamt/);
    assert.equal(workout.steps.map(s=>s.details).join(' ').match(/1,4 km/g)?.length,1,workout.id);
  }
});

test('easy-run tasks stay within the easy run and never appear together',()=>{
  for(const workout of plan.workouts){
    const tasks=workout.steps.filter(s=>['body-check','pace-guess'].includes(s.id));
    assert.ok(tasks.length<=1,workout.id);
    if(!tasks.length)continue;
    assert.equal(workout.runKind,'easy');
    assert.equal(workout.steps.length,2);
    assert.match(tasks[0].title,/Beim Laufen/);
    assert.match(tasks[0].details,/Sprechtempo/);
    assert.equal(exerciseHelpFor(tasks[0]),'');
    assert.deepEqual(workout.steps[0],previous.workouts.find(w=>w.id===workout.id).steps[0]);
  }
});

test('the 78 unselected entries remain exactly as shipped in v3.5',()=>{
  const selected=new Set([...techniqueDates,...bodyDates,...paceDates]);
  const unchanged=plan.workouts.filter(w=>!selected.has(w.date));
  assert.equal(unchanged.length,78);
  for(const workout of unchanged)assert.deepEqual(workout,previous.workouts.find(w=>w.id===workout.id),workout.id);
});

test('only the two exact technique exercises receive release-owned help after storage round trips',()=>{
  const restored=normalizePlan(JSON.parse(JSON.stringify(plan)));
  const helped=restored.workouts.flatMap(w=>w.steps).filter(s=>exerciseHelpFor(s));
  assert.equal(helped.length,12);
  assert.deepEqual([...new Set(helped.map(s=>s.id))].sort(),['knee-march','quick-feet']);
  for(const exercise of helped){
    assert.deepEqual(Object.keys(exercise),['id','title','details']);
    assert.ok(exerciseHelpFor(exercise).length<1000);
    assert.equal(exerciseHelpFor({...exercise,title:exercise.title+' angepasst'}),'');
    assert.equal(exerciseHelpFor({...exercise,details:'Meine eigene Übung'}),'');
  }
  for(const value of [null,undefined,{},'knee-march',{id:'__proto__'}])assert.equal(exerciseHelpFor(value),'');
});
