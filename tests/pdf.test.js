import test from 'node:test';
import assert from 'node:assert/strict';
import {addDays,days,setDone} from '../core.js';
import {createTrainingPDF} from '../pdf.js';

function fixture() {
  const workouts=[{id:'start',date:'2026-11-08',title:'Freiwilliger Einstieg',type:'mobility',weekNumber:0,optional:true,startTime:'10:30',endTime:'10:50',durationMinutes:20,focus:'Leicht bewegen und ankommen.',steps:[]}];
  for(let week=1;week<=12;week++) {
    const start=addDays('2026-11-09',(week-1)*7);
    for(const [kind,offset] of [['u',0],['a',2],['b',5]]) {
      const shifted=week===7&&kind==='b'?6:offset;
      const times=kind==='u'?['13:30','15:00']:kind==='a'?(week===10?['15:00','16:10']:week===11?['13:15','14:25']:week===12?['14:15','15:25']:['09:30','10:40']):['10:30','11:40'];
      workouts.push({id:`w${week}-${kind}`,date:addDays(start,shifted),title:kind==='u'?'Uni-Sport':`${kind.toUpperCase()}: Laufen und Kraft ${week}`,type:kind==='u'?'other':'run',weekNumber:week,startTime:times[0],endTime:times[1],durationMinutes:kind==='u'?90:70,focus:'Locker trainieren und sauber bewegen.',description:'Dein Training mit ausreichend Reserve.',instructions:'GATE: Bei intensivem Uni-Sport bleiben beide privaten Laeufe locker.',steps:kind==='u'?[]:[{id:'push',title:'Liegestuetze',details:'2 x 5-8 Wiederholungen, 90 Sekunden Pause.'},{id:'row',title:'Rudern',details:'2 x 8-12 je Seite, 90 Sekunden Pause.'}]});
    }
  }
  return {version:1,plan:{schemaVersion:1,id:'test-plan',title:'Trainingsplan November bis Januar',goalSummary:'Juli 2027: 8 Klimmzuege | 28 Liegestuetze | 2 km in 8:00.',workouts},progress:{}};
}
const pdfText=result=>new TextDecoder().decode(result.bytes);

function dailyFixture() {
  const state=fixture(),byDate=new Map(state.plan.workouts.map(w=>[w.date,w]));
  state.plan.workouts=days('2026-11-02','2027-01-31').map((date,i)=>byDate.get(date)||{
    id:'rest-'+date,date,title:'Ruhetag',type:'rest',weekNumber:Math.floor(i/7),durationMinutes:0,durationLabel:'0 Min.',
    description:'Heute ist Erholung eingeplant. Ein Spaziergang ist freiwillig.',steps:[],
  });
  return state;
}

test('whole-plan overview preserves every session, the year boundary and exact time windows',()=>{
  const state=fixture(),out=createTrainingPDF(state,'all','2026-11-09',{layout:'overview'}),text=pdfText(out);
  assert.deepEqual(out.period,{start:'2026-11-08',end:'2027-01-30'});
  assert.match(text,/Freiwilliger Einstieg/);
  assert.match(text,/B: Laufen und Kraft 12/);
  assert.match(text,/Uni-Sport/);
  for(const time of ['15:00-16:10','13:15-14:25','14:15-15:25'])assert.ok(text.includes(time),time);
  assert.match(text,/70 Min\. Zeitfenster/);
  assert.match(text,/2027/);
  assert.equal((text.match(/% checkbox empty/g)||[]).length,37);
  assert.ok(out.pageCount<=8,'The compact overview should stay concise.');
});

test('paper checklist remains identical after digital completion and leaves writing space',()=>{
  const state=fixture(),before=JSON.stringify(state);
  const fresh=createTrainingPDF(state,'all','2026-11-09',{layout:'checklist'});
  assert.equal(JSON.stringify(state),before,'Export must not mutate saved data.');
  for(const w of state.plan.workouts)setDone(state,w.id,true,'2026-11-07T12:00:00Z');
  const completed=createTrainingPDF(state,'all','2026-11-09',{layout:'checklist'});
  assert.deepEqual(completed.bytes,fresh.bytes,'Paper marks must ignore all digital progress.');
  const text=pdfText(completed);
  assert.equal((text.match(/14\.00 14\.00 re S/g)||[]).length,37);
  assert.equal((text.match(/\(DEINE NOTIZ\)/g)||[]).length,13);
  assert.equal(completed.pageCount,13,'Each week gets a separate writing sheet.');
  assert.doesNotMatch(text,/% checkbox checked|\[x\]/);
  const overview=pdfText(createTrainingPDF(state,'all','2026-11-09',{layout:'overview'}));
  assert.match(overview,/37 von 37/);
  assert.match(overview,/% checkbox checked/);
});

test('daily exports include all 91 dates and checkboxes, distinguish rest days and hide zero durations',()=>{
  const state=dailyFixture();
  for(const layout of ['overview','checklist']){
    const out=createTrainingPDF(state,'all','2026-11-09',{layout}),text=pdfText(out);
    assert.deepEqual(out.period,{start:'2026-11-02',end:'2027-01-31'});
    assert.equal((text.match(/% checkbox empty/g)||[]).length,91);
    assert.match(text,/91 Tage/);
    assert.match(text,/37 Trainingstage/);
    assert.match(text,/54 Ruhetage/);
    assert.match(text,/\(31\.01\.\) Tj ET[\s\S]*?\(Ruhetag\)/);
    assert.doesNotMatch(text,/\b0 Min\./);
    if(layout==='checklist')assert.equal(out.pageCount,13,'One printable sheet per Monday-Sunday week.');
    else assert.ok(out.pageCount<=8,'The overview should stay compact.');
    for(const d of days('2026-11-02','2027-01-31')){
      const stamp=d.slice(8,10)+'.'+d.slice(5,7)+'.';
      assert.ok(text.includes('('+stamp+')'),'Missing date '+d);
    }
  }
});

test('rest-day checks are exported without including any saved notes',()=>{
  const state=dailyFixture(),rest=state.plan.workouts.find(w=>w.type==='rest');
  const before=createTrainingPDF(state,'all','2026-11-09',{layout:'checklist'});
  setDone(state,rest.id,true);
  state.progress[rest.id].note='REST_NOTE_456';
  const paper=createTrainingPDF(state,'all','2026-11-09',{layout:'checklist'});
  assert.deepEqual(paper.bytes,before.bytes);
  const overview=pdfText(createTrainingPDF(state,'all','2026-11-09',{layout:'overview'}));
  assert.match(overview,/1 von 91 Tagen abgehakt/);
  assert.equal((overview.match(/% checkbox checked/g)||[]).length,1);
  assert.doesNotMatch(overview,/REST_NOTE_456/);
  const detailed=pdfText(createTrainingPDF(state,'week',rest.date,{layout:'checklist',details:true,notes:true}));
  assert.doesNotMatch(detailed,/REST_NOTE_456/);
  assert.match(detailed,/Heute ist Erholung eingeplant/);
  assert.doesNotMatch(detailed,/% checkbox checked|\b0 Min\./);
  const legacy=pdfText(createTrainingPDF(state,'month',rest.date,true));
  assert.match(legacy,/Ruhetag/);
  assert.doesNotMatch(legacy,/REST_NOTE_456/);
});

test('detailed export includes exercises, but saved notes are excluded even with legacy options',()=>{
  const state=fixture();
  state.progress['w1-a']={done:false,steps:{},note:'PRIVATE_NOTE_123'};
  const base={layout:'checklist',details:true};
  const plain=createTrainingPDF(state,'week','2026-11-11',base),text=pdfText(plain);
  for(const value of ['Liegestuetze','Rudern','90 Sekunden','GATE:'])assert.ok(text.includes(value),value);
  assert.doesNotMatch(text,/PRIVATE_NOTE_123/);
  assert.doesNotMatch(pdfText(createTrainingPDF(state,'week','2026-11-11',{...base,notes:true})),/PRIVATE_NOTE_123/);
  assert.doesNotMatch(pdfText(createTrainingPDF(state,'week','2026-11-11',true)),/PRIVATE_NOTE_123/,'Legacy true includes details but never saved notes.');
});

test('detailed exports have one checkbox per full workout or rest day, never per exercise',()=>{
  const state=dailyFixture(),before=JSON.stringify(state);
  for(const layout of ['overview','checklist']){
    const settings={layout,details:true,notes:true};
    const out=createTrainingPDF(state,'week','2026-11-11',settings),text=pdfText(out);
    assert.equal((text.match(/% checkbox (?:empty|checked)/g)||[]).length,7);
    assert.doesNotMatch(text,/9\.50 9\.50 re S/,'No small per-exercise checkboxes.');
    assert.ok(text.includes('Liegestuetze')&&text.includes('Rudern'),'Exercise instructions remain readable.');
    const stepState=structuredClone(state);
    for(const w of stepState.plan.workouts)stepState.progress[w.id]={done:false,steps:Object.fromEntries(w.steps.map(s=>[s.id,true])),note:''};
    const legacySteps=createTrainingPDF(stepState,'week','2026-11-11',settings);
    assert.deepEqual(legacySteps.bytes,out.bytes,'Legacy block checks must not change the exported full-workout status.');
  }
  const legacy=pdfText(createTrainingPDF(state,'week','2026-11-11',true));
  assert.equal((legacy.match(/% checkbox (?:empty|checked)/g)||[]).length,7);
  assert.equal(JSON.stringify(state),before,'Export is read-only.');
});

test('the current week has seven dated paper rows on one A4 page; two-week overview stays concise',()=>{
  const state=dailyFixture();
  const current=createTrainingPDF(state,'week','2026-11-07',{layout:'checklist'}),text=pdfText(current);
  assert.equal(current.pageCount,1);
  assert.equal((text.match(/% checkbox empty/g)||[]).length,7);
  for(const d of ['02.11.','03.11.','04.11.','05.11.','06.11.','07.11.','08.11.'])assert.ok(text.includes('('+d+')'),d);
  const overview=createTrainingPDF(state,'fortnight','2026-12-31',{layout:'overview'});
  assert.equal(overview.pageCount,1,'Two ordinary weeks fit on a single overview page.');
  assert.equal((pdfText(overview).match(/% checkbox empty/g)||[]).length,14);
});

test('a selected month excludes sessions outside it; empty whole plans still export',()=>{
  const state=fixture(),text=pdfText(createTrainingPDF(state,'month','2026-12-02',{layout:'overview'}));
  assert.doesNotMatch(text,/Freiwilliger Einstieg|Laufen und Kraft 1\)|Laufen und Kraft 12/);
  assert.match(text,/Laufen und Kraft 5/);
  state.plan.workouts=[];
  const empty=createTrainingPDF(state,'all','2027-01-31',{layout:'checklist'});
  assert.equal(empty.pageCount,1);
  assert.match(pdfText(empty),/kein Training geplant/);
});

test('long exercise lists paginate with the workout identity on continuation pages',()=>{
  const state=fixture();state.plan.workouts=[state.plan.workouts[2]];
  state.plan.workouts[0].steps=Array.from({length:25},(_,i)=>({id:'step-'+i,title:'Exercise '+i,details:'Controlled movement and enough rest. '.repeat(15)}));
  const out=createTrainingPDF(state,'all','2026-11-11',{layout:'checklist',details:true}),text=pdfText(out);
  assert.ok(out.pageCount>2);
  assert.match(text,/Fortsetzung:.*Laufen und Kraft 1/);
  assert.match(text,/Exercise 24/);
  const offset=Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(offset).startsWith('xref'));
});

test('unknown PDF layouts and periods produce a usable error',()=>{
  assert.throws(()=>createTrainingPDF(fixture(),'quarter','2026-11-09',{}),/Zeitraum/);
  assert.throws(()=>createTrainingPDF(fixture(),'all','2026-11-09',{layout:'grid'}),/Ansicht/);
  assert.throws(()=>createTrainingPDF(fixture(),'all','2026-11-09',null),/Einstellungen/);
});
