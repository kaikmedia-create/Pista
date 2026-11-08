import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlan,normalizeState,setDone,stats,parseImport,addDays,escapeHTML} from '../core.js';
import {TRAINING_PLAN,updateClientPlanState} from '../training-plan.js';
import {createTrainingPDF} from '../pdf.js';
let seed=0x13ef77;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const make=()=>normalizeState({version:1,plan:TRAINING_PLAN,progress:{},updatedAt:null});
test('10000 deterministic completion operations retain the exact canonical truth',()=>{
 let s=make();const truth=new Map();
 for(let i=0;i<10000;i++){
  const w=s.plan.workouts[Math.floor(random()*s.plan.workouts.length)],done=random()>.5;
  setDone(s,w.id,done,'2026-11-08T10:00:00Z');truth.set(w.id,done);
  if(i%25===0)s=normalizeState(JSON.parse(JSON.stringify(s)));
 }
 for(const [id,done]of truth)assert.equal(s.progress[id].done,done);
 assert.equal(stats(s).done,[...truth.values()].filter(Boolean).length);
 const unchanged=JSON.stringify(s);for(let i=0;i<100;i++)s=updateClientPlanState(s);
 assert.equal(JSON.stringify(s),unchanged);
});
test('maximum 2000-entry import retains every flag and survives backup and PDF overview',()=>{
 const workouts=Array.from({length:2000},(_,i)=>({id:'qa-'+i,date:addDays('2026-11-02',i%91),title:'QA '+i,type:i%3?'strength':'rest',durationMinutes:i%3?30:0,steps:[]}));
 const state=normalizeState({version:1,plan:{id:'qa-large',title:'Synthetic maximum import',workouts},progress:{}});
 for(let i=0;i<workouts.length;i+=2)setDone(state,workouts[i].id,true);
 const result=parseImport(JSON.stringify({kind:'pista-backup',state}));
 assert.equal(result.state.plan.workouts.length,2000);assert.equal(stats(result.state).done,1000);
 const pdf=createTrainingPDF(result.state,'all','2026-11-02',{layout:'overview'});
 assert.ok(pdf.bytes.byteLength>10000);assert.ok(pdf.pageCount>1);
});
test('hostile imports rejected without mutation; text is escaped',()=>{
 const state=make(),original=JSON.stringify(state);
 for(const id of ['__proto__','constructor','prototype','\"><script>','../x'])assert.throws(()=>normalizePlan({title:'QA',id,workouts:[]}));
 for(const raw of ['', 'null','{"kind":"pista-backup","state":{"version":999}}','{"schemaVersion":2,"title":"QA","workouts":[]}'])assert.throws(()=>parseImport(raw));
 assert.equal(JSON.stringify(state),original);
 assert.ok(!escapeHTML('<img src=x onerror=alert(1)>').includes('<img'));
});
