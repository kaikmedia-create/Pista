from pathlib import Path
p=Path('app.js');s=p.read_text()
if 'function queueStateChange' not in s:
    s=s.replace("let githubClient=null,githubSnapshot=null,githubBusy=false;", """let githubClient=null,githubSnapshot=null,githubBusy=false;
// Serialize read-modify-write operations across tabs. A saved indicator is only
// shown after the storage transaction has completed, never while it is queued.
let writeQueue=Promise.resolve(),pendingWrites=0;
function storageTransaction(fn) {
  return navigator.locks?.request?navigator.locks.request(STORAGE_KEY,fn):Promise.resolve().then(fn);
}
function queueStateChange(fn) {
  pendingWrites++;setSaveStatus(!memoryOnly&&corruptRaw===null);
  const task=writeQueue.then(()=>storageTransaction(fn)).catch(()=>{
    memoryOnly=true;storageWarning('Speichern konnte nicht abgeschlossen werden. Bitte den aktuellen Stand sichern und erneut versuchen.');return false;
  });
  writeQueue=task.finally(()=>{pendingWrites--;setSaveStatus(!memoryOnly&&corruptRaw===null);});
  return writeQueue;
}""")
    old="function setSaveStatus(ok=true) {const el=$('#save-status');el.textContent=ok?'Lokal gespeichert':'Nicht gespeichert';el.classList.toggle('failed',!ok);el.title=ok?'Automatisch in diesem Browser gespeichert. Kein Cloud-Sync.':'Bitte eine Sicherung herunterladen.';}"
    new="function setSaveStatus(ok=true) {const el=$('#save-status');el.textContent=ok?(pendingWrites?'Wird gespeichert …':'Lokal gespeichert'):'Nicht gespeichert';el.classList.toggle('failed',!ok);el.title=ok?(pendingWrites?'Änderungen werden gespeichert.':'Automatisch in diesem Browser gespeichert. Kein Cloud-Sync.'):'Bitte eine Sicherung herunterladen.';}"
    assert old in s;s=s.replace(old,new)
    s=s.replace("try {\n  const raw=localStorage.getItem(STORAGE_KEY);", "await storageTransaction(()=>{\ntry {\n  const raw=localStorage.getItem(STORAGE_KEY);")
    s=s.replace("} catch {memoryOnly=true;storageWarning('Der Browser blockiert das Speichern. Änderungen bleiben nur in dieser Sitzung.');}\nfunction latest", "} catch {memoryOnly=true;storageWarning('Der Browser blockiert das Speichern. Änderungen bleiben nur in dieser Sitzung.');}\n});\nfunction latest")
    s=s.replace("  const next=structuredClone(latest());fn(next);return save(next);", "  return queueStateChange(()=>{const next=structuredClone(latest());fn(next);return save(next);});")
    s=s.replace("function backup() {download(","async function backup() {await writeQueue;state=latest();download(")
    s=s.replace("function applyAppUpdate() {\n  if(memoryOnly", "async function applyAppUpdate() {\n  await writeQueue;\n  if(memoryOnly")
    s=s.replace("    const result=await client.save(structuredClone(latest()),", "    await writeQueue;\n    const result=await client.save(structuredClone(latest()),")
    s=s.replace("document.addEventListener('click',event=>{", "document.addEventListener('click',async event=>{")
    s=s.replace("case 'done': {const ok=mutate(","case 'done': {const ok=await mutate(")
    s=s.replace("case 'detail-done': {const ok=mutate(","case 'detail-done': {const ok=await mutate(")
    old="      const next=pending.kind==='backup'?pending.state:action==='merge-confirm'?mergePlan(latest(),pending.plan):{version:1,plan:pending.plan,progress:{},updatedAt:null};\n      if(backupAndApply(next))"
    new="      const importValue=pending;\n      const ok=await queueStateChange(()=>backupAndApply(importValue.kind==='backup'?importValue.state:action==='merge-confirm'?mergePlan(latest(),importValue.plan):{version:1,plan:importValue.plan,progress:{},updatedAt:null}));\n      if(ok)"
    assert old in s;s=s.replace(old,new)
    s=s.replace("case 'reset-confirm':if(backupAndApply({...state,progress:{}}))", "case 'reset-confirm':if(await queueStateChange(()=>backupAndApply({...latest(),progress:{}})))")
    s=s.replace("    case 'export-pdf': {\n      try{", "    case 'export-pdf': {\n      await writeQueue;state=latest();\n      try{")
    old="document.addEventListener('input',event=>{const el=event.target;if(el.id==='workout-note')mutate(s=>{if(s.plan.workouts.some(w=>w.id===el.dataset.workout))s.progress[el.dataset.workout]={...progressFor(s,el.dataset.workout),note:el.value.slice(0,2000)};});});"
    new="document.addEventListener('input',event=>{const el=event.target;if(el.id==='workout-note'){const id=el.dataset.workout,note=el.value.slice(0,2000);void mutate(s=>{if(s.plan.workouts.some(w=>w.id===id))s.progress[id]={...progressFor(s,id),note};});}});"
    assert old in s;s=s.replace(old,new)
    s=s.replace("state=updateClientPlanState(normalizeState(JSON.parse(event.newValue)));render();", "state=latest();render();")
    s=s.replace("document.addEventListener('visibilitychange',", "window.addEventListener('beforeunload',event=>{if(pendingWrites){event.preventDefault();event.returnValue='';}});\ndocument.addEventListener('visibilitychange',")
    p.write_text(s)
p=Path('tests/final_stress_test.py');s=p.read_text()
if "timeout=60000)\n        after=flags" not in s:
    s=s.replace("        after=flags(page)\n", "        expect(page.locator('#save-status')).to_have_text('Lokal gespeichert',timeout=60000)\n        after=flags(page)\n")
s=s.replace("p.evaluate('Storage.prototype.setItem=window.qaSet')", "p.evaluate('()=>{Storage.prototype.setItem=window.qaSet;}')")
p.write_text(s)
print('Added browser-tab write serialization, pending-save guards and precise stress assertions.')
