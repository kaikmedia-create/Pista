import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAINING_PLAN} from '../training-plan.js';
import {buildIntervalsEvent,canSyncRunningWorkout,structuredRun,createIntervalsClient} from '../intervals-sync.js';

const workout = id => TRAINING_PLAN.workouts.find(w => w.id === id);
const run = workout('tpab-2026-11-14-b');
const easy = workout('tpab-2026-11-11-a');

test('combined intervals are recognised despite strength type other', () => {
  assert.equal(run.type, 'other');
  assert.equal(canSyncRunningWorkout(run), true);
  assert.equal(canSyncRunningWorkout(workout('tpab-2026-11-12-rest')), false);
});
test('easy run preserves distance and qualitative effort without invented heart rate or pace', () => {
  const event = buildIntervalsEvent(easy, TRAINING_PLAN.id);
  assert.equal(event.type, 'Run');
  assert.equal(event.category, 'WORKOUT');
  assert.equal(event.start_date_local, easy.date + 'T00:00:00');
  assert.match(event.description, /4km intensity=active/);
  assert.match(event.description, /Zone 2/);
  assert.doesNotMatch(event.description, /\b\d{2,3}bpm\b|\b\d+:\d{2}\/km\b/);
});
test('warmup, fast reps, exactly n-1 jog recoveries and cooldown sum to declared distance', () => {
  for (const w of TRAINING_PLAN.workouts.filter(canSyncRunningWorkout)) {
    const model = structuredRun(w);
    const event = buildIntervalsEvent(w, TRAINING_PLAN.id);
    assert.equal(model.total, Math.round(w.runDistanceKm * 1000));
    if (model.kind === 'interval') {
      assert.equal((event.description.match(/intensity=active/g) || []).length, model.reps, w.id);
      assert.equal((event.description.match(/intensity=recovery/g) || []).length, model.reps - 1, w.id);
      assert.equal((event.description.match(/intensity=warmup/g) || []).length, 1, w.id);
      assert.equal((event.description.match(/intensity=cooldown/g) || []).length, 1, w.id);
      assert.equal(model.warmMeters + model.fast * model.reps +
        model.recover * (model.reps - 1) + model.coolMeters, model.total, w.id);
    }
    assert.equal(event.external_id, 'pista:v1:' + TRAINING_PLAN.id + ':' + w.id);
  }
});
test('5 x 400 metre plan uses four, not five, recovery intervals', () => {
  const model = structuredRun(workout('tpab-2027-01-23-b'));
  assert.deepEqual({...model},{kind:'interval',total:5000,reps:5,fast:400,recover:200,warmMeters:1400,coolMeters:800,effort:7});
});
test('movement drills do not create fake metres or minutes on the watch', () => {
  const a = workout('tpab-2026-11-14-b'), b = structuredClone(a);
  b.steps=b.steps.filter(step => !['knee-march','quick-feet'].includes(step.id));
  assert.equal(a.steps.some(s => s.id === 'knee-march'), true);
  assert.equal(b.steps.some(s => s.id === 'knee-march'), false);
  assert.equal(structuredRun(a).total, structuredRun(b).total);
  assert.equal(buildIntervalsEvent(a, TRAINING_PLAN.id).description,buildIntervalsEvent(b, TRAINING_PLAN.id).description);
});
test('rejects personal edits with inconsistent distances instead of overwriting the wrong run', () => {
  const w = structuredClone(run);
  w.runDistanceKm += 0.1;
  assert.throws(() => buildIntervalsEvent(w, TRAINING_PLAN.id), /widersprechen|stimmen/);
  w.runDistanceKm = run.runDistanceKm;
  w.steps.find(s => s.id === 'run').details = 'anderes Intervalltraining';
  assert.throws(() => buildIntervalsEvent(w, TRAINING_PLAN.id), /zuverlässig/);
});
test('does not mutate the athlete plan or progress', () => {
  const before = JSON.stringify(TRAINING_PLAN);
  buildIntervalsEvent(easy, TRAINING_PLAN.id);
  buildIntervalsEvent(run, TRAINING_PLAN.id);
  assert.equal(JSON.stringify(TRAINING_PLAN), before);
});
test('validates IDs and rejects strength or unspecified runs', () => {
  assert.throws(() => buildIntervalsEvent(workout('tpab-2026-11-13-rest'),TRAINING_PLAN.id), /Laufabschnitte/);
  assert.throws(() => buildIntervalsEvent(run,'bad/id'), /Trainings-ID/);
});
const success = (value) => ({ok: true, json: async () => value});
test('connect, upsert twice with stable IDs, and disconnect without any saved key', async () => {
  const calls = [], payloads = [];
  const fakeFetch = async (url, options) => {
    calls.push({url,options});
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers.Authorization, 'Basic ' + btoa('API_KEY:abcdefghijk'));
    if(options.method === 'GET') return success([]);
    const events = JSON.parse(options.body);
    payloads.push(events);
    return success(events.map(event=>({...event,workout_doc:{steps:[{distance:4000}]}})));
  };
  const client = createIntervalsClient({fetchImpl:fakeFetch});
  assert.equal(client.connected, false);
  await client.connect('abcdefghijk','2026-11-15');
  assert.equal(client.connected, true);
  assert.equal((await client.sync(TRAINING_PLAN.id, [easy,run])).count,2);
  assert.equal((await client.sync(TRAINING_PLAN.id, [easy,run])).count,2);
  assert.deepEqual(payloads[0],payloads[1]);
  assert.ok(calls.every(call=>!call.url.includes('abcdefghijk')));
  assert.ok(payloads.every(p=>!JSON.stringify(p).includes('abcdefghijk')));
  assert.match(calls[2].url, /bulk\?upsert=true$/);
  client.disconnect();
  assert.equal(client.connected,false);
  await assert.rejects(client.sync(TRAINING_PLAN.id,[easy]),/verbinden/);
});
test('authentication fails closed and never retains an invalid key', async () => {
  const client = createIntervalsClient({fetchImpl:async()=>({ok:false,status:401})});
  await assert.rejects(client.connect('abcdefghijk','2026-11-15'),/abgelehnt/);
  assert.equal(client.connected,false);
  await assert.rejects(client.connect('too short','2026-11-15'),/gültigen API-Schlüssel/);
});
test('no partial writes if any workout cannot be represented', async () => {
  const calls = [];
  const client = createIntervalsClient({fetchImpl:async(url,options)=>{
    calls.push(options.method);
    return success([]);
  }});
  await client.connect('abcdefghijk','2026-11-15');
  await assert.rejects(client.sync(TRAINING_PLAN.id,[easy,{...run,runDistanceKm:100}]),/widersprechen/);
  assert.deepEqual(calls,['GET']);
});
test('unparsed server response is not reported as successful watch synchronization', async () => {
  const client = createIntervalsClient({fetchImpl:async(url,options)=>{
    if(options.method === 'GET') return success([]);
    return success(JSON.parse(options.body).map(event=>({...event,workout_doc:null})));
  }});
  await client.connect('abcdefghijk','2026-11-15');
  await assert.rejects(client.sync(TRAINING_PLAN.id,[easy]),/Trainingsstruktur nicht bestätigen/);
});
test('handles rate limits and network failures with safe messages', async () => {
  const limited = createIntervalsClient({fetchImpl:async()=>({ok:false,status:429})});
  await assert.rejects(limited.connect('abcdefghijk','2026-11-15'),/begrenzt/);
  const offline = createIntervalsClient({fetchImpl:async()=>{throw new Error('hidden sensitive data');}});
  await assert.rejects(offline.connect('abcdefghijk','2026-11-15'),/nicht erreichbar/);
});
