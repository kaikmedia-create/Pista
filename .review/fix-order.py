from pathlib import Path
path = Path('training-plan.js')
old = 'const workouts=includeRestDays([...protectedEntries,...additions.filter(w=>!movedSourceDates.has(w.date))]);'
new = "const workouts=includeRestDays([...protectedEntries,...additions.filter(w=>!movedSourceDates.has(w.date))]).sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'').localeCompare(b.startTime||'')||a.id.localeCompare(b.id));"
text=path.read_text()
assert text.count(old)==1
path.write_text(text.replace(old,new))
path=Path('tests/plan.test.js')
path.write_text(path.read_text()+'''

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
''')
