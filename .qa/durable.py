from pathlib import Path
p=Path('app.js');s=p.read_text()
if 'function pendingEdits' in s: raise SystemExit('Durable edit journal is already applied.')
s=s.replace("let writeQueue=Promise.resolve(),pendingWrites=0;", "let writeQueue=Promise.resolve(),pendingWrites=0,flushScheduled=false,editClock=0;\nconst PENDING_PREFIX='pista.pending.v1.';")
start=s.index('function latest()');end=s.index('function save(next)',start)
s=s[:start]+'''// Each edit is durably journaled before the click handler returns. The shared
// lock then compacts edits into the normal v1 snapshot. Reloading or closing a
// tab between these steps is safe: startup replays the idempotent field patches.
function pendingEdits(planId) {
  const entries=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!key?.startsWith(PENDING_PREFIX))continue;
    const raw=localStorage.getItem(key);if(!raw||raw.length>200000)continue;
    try{
      const edit=JSON.parse(raw);
      if(edit.version===1&&edit.planId===planId&&Number.isSafeInteger(edit.clock)&&Array.isArray(edit.changes)&&edit.changes.length<=2000)entries.push({...edit,key});
    }catch{/* Never execute or import arbitrary content from an invalid journal. */}
  }
  return entries.sort((a,b)=>a.clock-b.clock||a.key.localeCompare(b.key));
}
function applyEdits(base,entries) {
  const next=structuredClone(base),ids=new Set(next.plan.workouts.map(w=>w.id));
  for(const edit of entries)for(const patch of edit.changes){
    if(!patch||!ids.has(patch.id))continue;
    const value={...progressFor(next,patch.id)};
    if(typeof patch.done==='boolean'){
      value.done=patch.done;
      value.completedAt=patch.done&&typeof patch.completedAt==='string'&&Number.isFinite(Date.parse(patch.completedAt))?patch.completedAt:null;
    }
    if(typeof patch.note==='string')value.note=patch.note.slice(0,2000);
    next.progress[patch.id]=value;
  }
  return next;
}
function latest() {
  if(corruptRaw!==null)return state;
  let base=state;
  try{
    if(!memoryOnly){const raw=localStorage.getItem(STORAGE_KEY);if(raw)base=updateClientPlanState(normalizeState(JSON.parse(raw)));}
    const edits=pendingEdits(base.plan.id);return edits.length?applyEdits(base,edits):base;
  }catch{return state;}
}
function flushPending() {
  if(corruptRaw!==null)return false;
  let base=state;
  if(!memoryOnly){const raw=localStorage.getItem(STORAGE_KEY);if(raw)base=updateClientPlanState(normalizeState(JSON.parse(raw)));}
  const edits=pendingEdits(base.plan.id);
  if(!edits.length)return true;
  const next=applyEdits(base,edits);
  if(!save(next))return false;
  // Keys are unique and immutable. Remove oldest first: an interrupted cleanup
  // leaves only idempotent later patches; a concurrent new edit is never erased.
  for(const edit of edits)localStorage.removeItem(edit.key);
  state=latest();return true;
}
function scheduleProgressFlush() {
  if(flushScheduled)return writeQueue;
  flushScheduled=true;
  return queueStateChange(()=>{flushScheduled=false;const ok=flushPending();render();return ok;});
}
''' + s[end:]
start=s.index('function mutate(fn)');end=s.index('function backupAndApply(next)',start)
s=s[:start]+'''function mutate(fn) {
  if(corruptRaw!==null){toast('Bitte zuerst die Originaldaten sichern und einen gültigen Plan importieren.');return false;}
  const before=latest(),next=structuredClone(before);fn(next);const changes=[];
  for(const w of next.plan.workouts){
    const old=progressFor(before,w.id),value=progressFor(next,w.id),patch={id:w.id};
    if(value.done!==old.done||value.completedAt!==old.completedAt){patch.done=value.done;patch.completedAt=value.completedAt;}
    if(value.note!==old.note)patch.note=value.note;
    if(Object.keys(patch).length>1)changes.push(patch);
  }
  state=next;if(!changes.length)return true;
  try{
    const existing=pendingEdits(next.plan.id);
    editClock=Math.max(Date.now(),editClock+1,...existing.map(edit=>edit.clock+1));
    const key=PENDING_PREFIX+crypto.randomUUID();
    localStorage.setItem(key,JSON.stringify({version:1,planId:next.plan.id,clock:editClock,changes}));
    void scheduleProgressFlush();return true;
  }catch{memoryOnly=true;storageWarning('Die Änderung konnte nicht gespeichert werden. Bitte eine Sicherung herunterladen, bevor du die App schließt.');return false;}
}
''' + s[end:]
s=s.replace("  if(corruptRaw===null)setSaveStatus(true);", "  if(corruptRaw===null){flushPending();setSaveStatus(!memoryOnly);}")
s=s.replace("case 'done': {const ok=await mutate(", "case 'done': {const ok=mutate(")
s=s.replace("case 'detail-done': {const ok=await mutate(", "case 'detail-done': {const ok=mutate(")
s=s.replace("if(ok)toast(progressFor(state,id).done?'Abgehakt und gespeichert.':'Wieder als offen markiert.');", "if(ok)toast(progressFor(state,id).done?'Abgehakt.':'Wieder als offen markiert.');")
s=s.replace("if(ok)toast('Fortschritt gespeichert.');", "if(ok)toast('Fortschritt übernommen.');")
s=s.replace("queueStateChange(()=>backupAndApply(importValue.kind", "queueStateChange(()=>{if(!flushPending())return false;return backupAndApply(importValue.kind")
s=s.replace("plan:importValue.plan,progress:{},updatedAt:null}));", "plan:importValue.plan,progress:{},updatedAt:null});});")
s=s.replace("queueStateChange(()=>backupAndApply({...latest(),progress:{}}))", "queueStateChange(()=>{if(!flushPending())return false;return backupAndApply({...latest(),progress:{}});})")
start=s.index("window.addEventListener('storage',");end=s.index("document.addEventListener('visibilitychange',",start)
s=s[:start]+'''window.addEventListener('storage',event=>{
  const journal=event.key?.startsWith(PENDING_PREFIX);
  if((event.key!==STORAGE_KEY&&!journal)||memoryOnly||corruptRaw!==null)return;
  try{
    if(journal||event.newValue){
      const raw=localStorage.getItem(STORAGE_KEY);if(raw)normalizeState(JSON.parse(raw));
      state=latest();render();
      if(modalWorkout&&document.activeElement?.id!=='workout-note')openWorkout(modalWorkout);
      if(journal&&event.newValue)void scheduleProgressFlush();
      setSaveStatus(true);
    }else storageWarning('Der lokale Speicher wurde in einem anderen Tab gelöscht. Bitte sichere diesen Stand.');
  }catch{storageWarning('Der Speicher wurde in einem anderen Tab ungültig geändert. Bitte sichere diesen Stand.');}
});
''' + s[end:]
p.write_text(s)
p=Path('tests/final_stress_test.py');s=p.read_text()
s=s.replace("def flags(page):return {k:", "def flags(page):\n    expect(page.locator('#save-status')).not_to_have_text('Wird gespeichert …',timeout=60000)\n    return {k:")
s=s.replace("for version in ['current','3.4','current','3.3','current']:", "for version in ['current','3.4','current','3.3','current','3.5','current']:")
s=s.replace("'offline_checks':5", "'offline_checks':7")
s=s.replace("'''({id,at})=>{setTimeout(()=>{", "'''({id,at,roundno})=>{setTimeout(()=>{")
s=s.replace('[data-id="${id}"]`).click();\n                },Math.max', '[data-id="${id}"]`).click();\n                  window.qaPairCompleted=roundno;\n                },Math.max')
s=s.replace("{'id':k,'at':at})\n            time.sleep(.15)", "{'id':k,'at':at,'roundno':roundno})\n            for target in (page,other):\n                target.wait_for_function('(n)=>window.qaPairCompleted===n',arg=roundno,timeout=10000)\n                expect(target.locator('#save-status')).to_have_text('Lokal gespeichert',timeout=10000)")
needle="    def navigation_stress():\n"
new='''    def immediate_reload():
        select(page);k='tpab-2026-11-11-a';original=flags(page).get(k,(False,))[0]
        for index in range(6):
            with page.expect_navigation(wait_until='domcontentloaded'):
                page.evaluate("""id=>{document.querySelector(`[data-action="done"][data-id="${id}"]`).click();location.reload();}""",k)
            select(page)
            expected=(not original) if index%2==0 else original
            expect(page.locator(f'[data-action="done"][data-id="{k}"]')).to_have_attribute('aria-pressed',str(expected).lower())
            assert flags(page)[k][0]==expected
        return {'reload_in_same_javascript_task':6,'lost_changes':0}
    check(engine,'Immediate reload in the same task as a checkmark',immediate_reload)

'''
assert needle in s;s=s.replace(needle,new+needle)
p.write_text(s)
print('Durable immediate-edit journal and serialized compaction applied.')
