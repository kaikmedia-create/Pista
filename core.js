// Pure plan, date and validation logic. All dates are local calendar dates.
export const STORAGE_KEY = 'pista.state.v1';
export const BACKUP_KEY = 'pista.previous.v1';
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const TYPES = {run:'Laufen',strength:'Kraft',mobility:'Mobilität',cycle:'Rad',recovery:'Erholung',other:'Training',longrun:'Long Run',tempo:'Tempo',race:'Wettkampf'};
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
export const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Datum muss YYYY-MM-DD entsprechen.');
  const d = new Date(value + 'T12:00:00');
  if (!Number.isFinite(d.getTime()) || iso(d) !== value) throw new Error(`Ungültiges Datum: ${value}`);
  return d;
}
export const addDays = (value,n) => { const d = date(value); d.setDate(d.getDate()+n); return iso(d); };
export function monday(value) { const d = date(value); return addDays(value,-((d.getDay()+6)%7)); }
export function range(mode,anchor) {
  const d = date(anchor);
  if (mode === 'month') return {start:iso(new Date(d.getFullYear(),d.getMonth(),1,12)),end:iso(new Date(d.getFullYear(),d.getMonth()+1,0,12))};
  const start = monday(anchor);
  return {start,end:addDays(start,mode === 'fortnight' ? 13 : 6)};
}
export function days(start,end) { const out=[]; for(let d=start;d<=end;d=addDays(d,1)) {out.push(d); if(out.length>400) throw new Error('Zeitraum zu groß.');} return out; }
export const formatDate = (value,options = {day:'numeric',month:'short'}) => date(value).toLocaleDateString('de-DE',options);
export const shortRange = r => `${formatDate(r.start)} – ${formatDate(r.end,{day:'numeric',month:'short',year:'numeric'})}`;
function text(value,label,max=2000,required=false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new Error(`${label} muss Text sein.`);
  const v=value.trim();
  if(required && !v) throw new Error(`${label} fehlt.`);
  if(v.length>max) throw new Error(`${label}: höchstens ${max} Zeichen.`);
  return v;
}
function hash(s) {let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(36);}
function id(value,fallback,label) {
  const v=value == null ? fallback : value;
  if(typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v) || ['__proto__','constructor','prototype'].includes(v)) throw new Error(`${label}: ungültige ID (nur Buchstaben, Zahlen, - und _).`);
  return v;
}
export function normalizePlan(input) {
  if(!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Erwartet wird ein Plan als JSON-Objekt.');
  if(input.schemaVersion != null && input.schemaVersion !== 1) throw new Error('Diese Planversion wird noch nicht unterstützt. Erwartet: schemaVersion 1.');
  if(!Array.isArray(input.workouts) || input.workouts.length>2000) throw new Error('Der Plan benötigt workouts als Liste mit höchstens 2.000 Einträgen.');
  const title=text(input.title,'Plantitel',120,true), seen=new Set();
  const workouts=input.workouts.map((w,i)=>{
    const prefix=`Training ${i+1}`;
    if(!w || typeof w !== 'object' || Array.isArray(w)) throw new Error(`${prefix}: ungültiger Eintrag.`);
    date(w.date);
    const title=text(w.title,`${prefix}: Titel`,120,true);
    const wid=id(w.id,`w-${hash(w.date+'|'+title+'|'+i)}`,prefix);
    if(seen.has(wid)) throw new Error(`Doppelte Trainings-ID: ${wid}`);
    seen.add(wid);
    const duration=w.durationMinutes ?? 0;
    if(typeof duration !== 'number' || !Number.isFinite(duration) || duration<0 || duration>1440) throw new Error(`${prefix}: durationMinutes muss eine Zahl von 0 bis 1.440 sein.`);
    const steps=w.steps ?? [];
    if(!Array.isArray(steps) || steps.length>80) throw new Error(`${prefix}: höchstens 80 Übungsblöcke.`);
    const seenSteps=new Set();
    return {id:wid,date:w.date,title,type:own(TYPES,w.type)?w.type:'other',focus:text(w.focus,`${prefix}: Fokus`,500),zone:text(w.zone,`${prefix}: Zone`,80),durationLabel:text(w.durationLabel,`${prefix}: Dauer`,80),weekGoal:text(w.weekGoal,`${prefix}: Wochenziel`,500),weekNumber:Number.isInteger(w.weekNumber)&&w.weekNumber>0&&w.weekNumber<=10000?w.weekNumber:null,durationMinutes:Math.round(duration),description:text(w.description,`${prefix}: Beschreibung`),steps:steps.map((step,j)=>{
      if(typeof step === 'string') step={title:step};
      if(!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`${prefix}: ungültiger Übungsblock.`);
      const sid=id(step.id,`s-${j+1}`,`${prefix}, Block ${j+1}`);
      if(seenSteps.has(sid)) throw new Error(`${prefix}: doppelte Block-ID ${sid}`);
      seenSteps.add(sid);
      return {id:sid,title:text(step.title,`${prefix}, Block ${j+1}: Titel`,120,true),details:text(step.details,`${prefix}, Block ${j+1}: Details`,1000)};
    })};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const targetDate=input.targetDate?iso(date(input.targetDate)):null;
  return {targetDate,targetLabel:text(input.targetLabel,'Zielbezeichnung',80),schemaVersion:1,id:id(input.id,`plan-${hash(title)}`,'Plan'),title,description:text(input.description,'Planbeschreibung',2000),demo:input.demo === true,workouts};
}
export function demoPlan(today=iso()) {
  return normalizePlan({schemaVersion:1,id:'pista-demo',title:'Dein erster Schritt',description:'Ein Probe-Workout zum Ausprobieren der App. Kein individueller Trainingsplan.',demo:true,workouts:[{id:'demo-move',date:today,title:'Ankommen & bewegen',type:'mobility',durationMinutes:25,description:'Lerne Pista kennen: Öffne die Blöcke, hake sie ab und ergänze eine Notiz. Dieser Eintrag dient nur als Funktionsdemo.',steps:[{id:'warmup',title:'In Ruhe ankommen',details:'5 Min. · Demo: lockeres Gehen und sanfte Bewegungen.'},{id:'move',title:'Locker bewegen',details:'15 Min. · Demo: Bewegung in angenehmem, selbst gewähltem Tempo.'},{id:'finish',title:'Ruhig ausklingen',details:'5 Min. · Demo: locker auslaufen und eine kurze Notiz festhalten.'}]}]});
}
export function normalizeState(input) {
  if(!input || input.version !== 1) throw new Error('Unbekannte Speicherversion. Bitte eine Pista-v1-Sicherung verwenden.');
  const plan=normalizePlan(input.plan), progress=Object.create(null), raw=input.progress;
  if(raw != null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('Fortschritt ist ungültig.');
  for(const w of plan.workouts) {
    const p=raw && own(raw,w.id) ? raw[w.id] : null;
    if(!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const steps=Object.create(null);
    for(const s of w.steps) steps[s.id]=p.steps?.[s.id] === true;
    const done=p.done === true;
    if(done) for(const s of w.steps) steps[s.id]=true;
    progress[w.id]={done,steps,note:typeof p.note==='string'?p.note.slice(0,2000):'',completedAt:done && typeof p.completedAt==='string' && Number.isFinite(Date.parse(p.completedAt))?p.completedAt:null};
  }
  return {version:1,plan,progress,updatedAt:typeof input.updatedAt==='string'?input.updatedAt:null};
}
export function initialState(today=iso()) {return {version:1,plan:demoPlan(today),progress:{},updatedAt:null};}
export const progressFor = (state,id) => state.progress[id] || {done:false,steps:{},note:'',completedAt:null};
export function setDone(state,id,done,now=new Date().toISOString()) {
  const w=state.plan.workouts.find(w=>w.id===id); if(!w)return;
  const old=progressFor(state,id),p={...old,steps:{...old.steps},done,completedAt:done?now:null};
  for(const s of w.steps)p.steps[s.id]=done;
  state.progress[id]=p;
}
export function setStep(state,id,sid,checked,now=new Date().toISOString()) {
  const w=state.plan.workouts.find(w=>w.id===id);if(!w || !w.steps.some(s=>s.id===sid))return;
  const old=progressFor(state,id), p={...old,steps:{...old.steps,[sid]:checked}};
  p.done=w.steps.length>0 && w.steps.every(s=>p.steps[s.id]);
  p.completedAt=p.done?(old.completedAt||now):null;
  state.progress[id]=p;
}
export function stats(state,start='0000-00-00',end='9999-99-99') {
  const workouts=state.plan.workouts.filter(w=>w.date>=start&&w.date<=end), completed=workouts.filter(w=>progressFor(state,w.id).done);
  return {total:workouts.length,done:completed.length,percent:workouts.length?Math.round(completed.length/workouts.length*100):0,minutes:completed.reduce((n,w)=>n+w.durationMinutes,0),plannedMinutes:workouts.reduce((n,w)=>n+w.durationMinutes,0)};
}
export function parseCSV(source) {
  const raw=source.replace(/^\uFEFF/,'');
  const delimiter=raw.split(/\r?\n/,1)[0].includes(';')?';':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<raw.length;i++) {const c=raw[i];if(c==='"') {if(quoted&&raw[i+1]==='"'){cell+='"';i++;}else if(!quoted && cell.trim())throw new Error('CSV: unerwartetes Anführungszeichen.');else quoted=!quoted;} else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&raw[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quoted)throw new Error('CSV: ein Anführungszeichen wurde nicht geschlossen.');
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  if(rows.length<2)throw new Error('CSV benötigt eine Kopfzeile und mindestens ein Training.');
  const aliases={datum:'date',titel:'title',typ:'type',dauer:'durationMinutes',beschreibung:'description',schritte:'steps',durationminutes:'durationMinutes'};
  const headers=rows.shift().map(v=>{const h=v.trim();return aliases[h.toLowerCase()]||h.toLowerCase();});
  if(new Set(headers).size!==headers.length)throw new Error('CSV enthält doppelte Spaltennamen.');
  if(!headers.includes('date')||!headers.includes('title'))throw new Error('CSV braucht die Spalten date und title (oder Datum und Titel).');
  const workouts=rows.map((r,i)=>{if(r.length!==headers.length)throw new Error(`CSV-Zeile ${i+2}: falsche Spaltenanzahl.`);const o=Object.fromEntries(headers.map((h,j)=>[h,r[j].trim()]));const type=Object.entries(TYPES).find(([k,v])=>k===o.type||v.toLowerCase()===o.type?.toLowerCase())?.[0]||'other';return {...o,type,durationMinutes:o.durationMinutes?Number(o.durationMinutes.replace(',','.')):0,steps:o.steps?o.steps.split('|').map(v=>v.trim()).filter(Boolean):[]};});
  return normalizePlan({schemaVersion:1,title:'Importierter Trainingsplan',workouts});
}
export function parseImport(source,filename='plan.json') {
  if(new TextEncoder().encode(source).length>MAX_FILE_BYTES)throw new Error('Datei zu groß. Höchstens 2 MB.');
  if(filename.toLowerCase().endsWith('.csv'))return {kind:'plan',plan:parseCSV(source)};
  let data;try {data=JSON.parse(source.replace(/^\uFEFF/,''));}catch{throw new Error('Ungültiges JSON. Bitte eine JSON- oder CSV-Datei nach der Pista-Vorlage verwenden.');}
  if(data?.kind==='pista-backup')return {kind:'backup',state:normalizeState(data.state)};
  if(Array.isArray(data)||Array.isArray(data?.weeks)||Array.isArray(data?.PLAN))return {kind:'plan',plan:fromBackyard(data)};
  return {kind:'plan',plan:normalizePlan(data)};
}
export function mergePlan(current,incoming) {
  const map=new Map(current.plan.workouts.map(w=>[w.id,w]));
  for(const w of incoming.workouts)map.set(w.id,w);
  return normalizeState({...current,plan:{...incoming,demo:false,workouts:[...map.values()]}});
}
export const escapeHTML = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The weekly schema of the user's reference. Never evaluates uploaded code.
export function fromBackyard(input) {
  const weeks=Array.isArray(input)?input:input.weeks||input.PLAN;
  if(!Array.isArray(weeks)||weeks.length>520)throw new Error('Ungültiger Wochenplan: höchstens 520 Wochen.');
  const workouts=[];
  const aliases={gym:'strength',rest:'recovery',bike:'cycle'};
  function duration(label) {
    const s=String(label||'').trim();
    let m=s.match(/^(\d+(?:[.,]\d+)?)\s*min$/i);
    if(m)return Number(m[1].replace(',','.'));
    m=s.match(/^(\d+):(\d{2})\s*h$/i);
    if(m&&Number(m[2])<60)return Number(m[1])*60+Number(m[2]);
    m=s.match(/^(\d+(?:[.,]\d+)?)\s*(?:h|stunden?)$/i);
    return m?Number(m[1].replace(',','.'))*60:0;
  }
  weeks.forEach((week,i)=>{
    if(!week||!Array.isArray(week.days)||week.days.length>100)throw new Error(`Woche ${i+1}: days muss eine Liste mit höchstens 100 Einträgen sein.`);
    week.days.forEach((d,j)=>{
      if(!d||typeof d!=='object')throw new Error(`Woche ${i+1}: ungültiger Tag.`);
      const title=d.unit??d.title;
      workouts.push({...d,id:d.id||`by-${hash(d.date+'|'+title)}`,title,type:aliases[d.type]||d.type,durationMinutes:d.durationMinutes??duration(d.dauer),durationLabel:d.dauer==='–'?'':d.dauer||'',focus:d.fokus||'',description:d.detail||d.description||'',zone:d.zone==='–'?'':d.zone||'',weekGoal:week.goal||'',weekNumber:Number(week.week)||i+1});
    });
  });
  return normalizePlan({schemaVersion:1,title:input.title||'Mein Trainingsplan',description:input.description||'Importierter Wochenplan',targetDate:input.targetDate,targetLabel:input.targetLabel,workouts});
}
