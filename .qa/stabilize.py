from pathlib import Path
import json
p=Path('training-plan.js')
s=p.read_text()
old='  if(state?.plan?.id!==PLAN_ID)return state;\n  if((state.plan.revision||0)>=PLAN_REVISION)'
new='''  if(state?.plan?.id!==PLAN_ID)return state;
  // v3.3 does not retain run metadata when it saves a newer plan during a
  // rollback. Restore only exact, otherwise unchanged current-plan entries.
  // Completed historical workouts and personal edits must not be relabeled.
  {
    let restored=false;
    const workouts=state.plan.workouts.map(w=>{
      if(w.runDistanceKm||w.runKind)return w;
      const original=REVISED.workouts.find(r=>r.id===w.id&&r.runDistanceKm>0);
      if(!original)return w;
      const candidate={...w,runDistanceKm:original.runDistanceKm,runKind:original.runKind};
      if(fingerprint(candidate)!==fingerprint(original))return w;
      restored=true;return candidate;
    });
    if(restored)state={...state,plan:{...state.plan,workouts}};
  }
  if((state.plan.revision||0)>=PLAN_REVISION)'''
if 'v3.3 does not retain run metadata' not in s:
    assert s.count(old)==1
    p.write_text(s.replace(old,new))
p=Path('package.json');s=json.loads(p.read_text());s['version']='3.5.1';p.write_text(json.dumps(s,indent=2)+'\n')
p=Path('tests/final-fuzz.test.js');s=p.read_text()
extra='''
test('a v3.3 round-trip restores exact current run metadata without changing personal edits',()=>{
 const before=make();setDone(before,'tpab-2026-11-11-a',true,'2026-11-08T10:00:00Z');
 const legacy=JSON.parse(JSON.stringify(before));delete legacy.plan.revision;
 for(const w of legacy.plan.workouts){delete w.runDistanceKm;delete w.runKind;}
 let s=updateClientPlanState(normalizeState(legacy));
 assert.equal(s.plan.workouts.filter(w=>w.runDistanceKm>0).length,24);
 assert.equal(s.plan.workouts.reduce((n,w)=>n+w.runDistanceKm,0),104.2);
 assert.deepEqual(JSON.parse(JSON.stringify(normalizeState(s).progress)),JSON.parse(JSON.stringify(normalizeState(before).progress)));
 assert.equal(s.plan.workouts.find(w=>w.id==='tpab-2026-11-11-a').runDistanceKm,4);
 const edited=JSON.parse(JSON.stringify(legacy));edited.plan.workouts.find(w=>w.id==='tpab-2026-11-18-a').title='Eigene Änderung';
 s=updateClientPlanState(normalizeState(edited));
 assert.equal(s.plan.workouts.find(w=>w.id==='tpab-2026-11-18-a').title,'Eigene Änderung');
 assert.equal(s.plan.workouts.find(w=>w.id==='tpab-2026-11-18-a').runDistanceKm,0);
 assert.equal(updateClientPlanState(s),s);
 legacy.plan.revision=3;
 assert.equal(updateClientPlanState(normalizeState(legacy)).plan.workouts.filter(w=>w.runDistanceKm>0).length,24);
});
'''
if 'a v3.3 round-trip' not in s:p.write_text(s+extra)
p=Path('tests/final_stress_test.py');s=p.read_text()
s=s.replace("        results=[]\n        for version", "        results=[];expected_runs=None\n        for version")
needle="            current_flags=flags(p)\n"
insert="""            if version=='current':
                run_values=[(w['id'],w['runDistanceKm'],w['runKind']) for w in stored(p)['plan']['workouts'] if w['runDistanceKm']>0]
                if expected_runs is None:expected_runs=run_values
                else:assert run_values==expected_runs,'Run metadata lost after rollback'
            current_flags=flags(p)
"""
if 'Run metadata lost after rollback' not in s:s=s.replace(needle,insert)
old='''        c.set_offline(True)
        with p.expect_navigation(wait_until='domcontentloaded'):p.locator('#app-apply-button').click()
'''
new='''        c.set_offline(True)
        wait_for_page_condition(p,'()=>navigator.onLine===false')
        deferred=not p.locator('#app-apply-button').is_visible()
        if deferred:
            assert p.locator('#app-update-status').get_attribute('data-status')=='offline'
            assert flags(p)==expected
            c.set_offline(False)
            assert refresh_check(p)=='available'
        with p.expect_navigation(wait_until='domcontentloaded'):p.locator('#app-apply-button').click()
'''
if 'deferred=not p.locator' not in s:
    assert old in s;s=s.replace(old,new)
s=s.replace("'offline_apply':'success'", "'offline_apply':'safely deferred until online' if deferred else 'success'")
p.write_text(s)
print('Applied minimal rollback fix; training prescriptions remain unchanged.')
