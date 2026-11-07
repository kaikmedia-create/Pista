// Dependency-free, text-searchable PDF 1.4 writer. A4 portrait, WinAnsi/Helvetica.
// Paper checklists deliberately ignore digital completion and draw empty boxes.
import {range,days,monday,addDays,date,formatDate,shortRange,stats,progressFor,TYPES,iso} from './core.js';
const W=595.28,H=841.89,M=42,BOTTOM=H-56;
const GRAY=[.38,.43,.49],INK=[.11,.14,.19],BLUE=[.09,.36,.69],RULE=[.84,.88,.92];
const number=n=>Number(n).toFixed(2);

/**
 * options: {layout:'overview'|'checklist', details:false, notes:false}.
 * A boolean fourth argument keeps the original week/month PDF behaviour.
 */
export function createTrainingPDF(state,mode,anchor,options=false) {
  if(!['week','fortnight','month','all'].includes(mode))throw new Error('Unbekannter PDF-Zeitraum.');
  const legacy=typeof options==='boolean';
  if(!legacy&&(!options||typeof options!=='object'||Array.isArray(options)))throw new Error('Ungültige PDF-Einstellungen.');
  const settings=legacy?{layout:'overview',details:options,notes:options}:{layout:'overview',details:false,notes:false,...options};
  if(!['overview','checklist'].includes(settings.layout))throw new Error('Unbekannte PDF-Ansicht.');
  const paper=settings.layout==='checklist',details=settings.details===true,notes=settings.notes===true;
  const all=[...state.plan.workouts].sort((a,b)=>a.date.localeCompare(b.date)||((a.startTime||'').localeCompare(b.startTime||''))||a.id.localeCompare(b.id));
  const period=mode==='all'?{start:all[0]?.date||iso(date(anchor||iso())),end:all.at(-1)?.date||iso(date(anchor||iso()))}:range(mode,anchor);
  const selected=all.filter(w=>w.date>=period.start&&w.date<=period.end),pages=[];
  const instructionGroups=[],instructionIds=new Map();
  if(details&&!legacy)for(const w of selected){
    if(w.instructions&&!instructionIds.has(w.instructions)){
      instructionIds.set(w.instructions,instructionGroups.length+1);
      instructionGroups.push({workout:w,instructions:w.instructions});
    }
  }
  let page,y=0,unsupported=0,label='',continuation=null;
  let ctx=null;
  if(typeof document!=='undefined')ctx=document.createElement('canvas').getContext('2d');
  function safe(value) {
    return String(value??'').replace(/\t/g,' ').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').replace(/[^\x20-\x7e\xa0-\xff\n]/gu,()=>{unsupported++;return '?';});
  }
  function escaped(s) {return [...s].map(c=>{const n=c.charCodeAt(0);return n>=128?'\\'+n.toString(8).padStart(3,'0'):'()\\'.includes(c)?'\\'+c:c;}).join('');}
  function text(s,x,top,size=10,bold=false,color=INK) {
    page.push(`${color.join(' ')} rg BT /F${bold?2:1} ${size} Tf 1 0 0 1 ${number(x)} ${number(H-top)} Tm (${escaped(safe(s).replace(/\n/g,' '))}) Tj ET`);
  }
  function line(x1,y1,x2,y2,color=RULE) {page.push(`${color.join(' ')} RG 0.6 w ${number(x1)} ${number(H-y1)} m ${number(x2)} ${number(H-y2)} l S`);}
  function rect(x,top,width,height,color=[.96,.97,.98]) {page.push(`${color.join(' ')} rg ${number(x)} ${number(H-top-height)} ${number(width)} ${number(height)} re f`);}
  function checkbox(x,top,checked=false,size=11) {
    page.push(`% checkbox ${checked?'checked':'empty'}`);
    page.push(`${GRAY.join(' ')} RG 0.8 w ${number(x)} ${number(H-top-size)} ${number(size)} ${number(size)} re S`);
    if(checked)page.push(`${BLUE.join(' ')} RG 1.2 w ${number(x+2)} ${number(H-top-size*.53)} m ${number(x+size*.43)} ${number(H-top-size+2)} l ${number(x+size-2)} ${number(H-top-2)} l S`);
  }
  function width(s,size,bold=false) {
    if(ctx){ctx.font=`${bold?'bold ':''}${size}px Arial`;return ctx.measureText(s).width*1.045;}
    return [...s].reduce((n,c)=>n+(/[MW@%]/.test(c)?.95:/[ilI.,' :;!]/.test(c)?.30:.63)*size,0);
  }
  function wrap(value,maxWidth,size,bold=false) {
    const out=[];
    for(const paragraph of safe(value).split('\n')) {
      let current='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)) {
        if(width((current?current+' ':'')+word,size,bold)<=maxWidth){current+=(current?' ':'')+word;continue;}
        if(current){out.push(current);current='';}
        for(const char of word){if(width(current+char,size,bold)>maxWidth&&current){out.push(current);current='';}current+=char;}
      }
      out.push(current);
    }
    return out;
  }
  function newPage(nextLabel=label) {
    label=nextLabel;page=[];pages.push(page);
    text('pista.',M,47,26,true,BLUE);text('DEIN TRAINING. DEIN TEMPO.',M+100,43,8,false,GRAY);
    line(M,61,W-M,61);
    y=87;
    for(const t of wrap(label,W-2*M,18,true)){text(t,M,y,18,true);y+=23;}
    text(shortRange(period),M,y,9.5,false,GRAY);y+=22;
    for(const t of wrap(state.plan.title,W-2*M,10,true)){text(t,M,y,10,true);y+=14;}
    if(pages.length===1&&state.plan.goalSummary){
      for(const t of wrap(state.plan.goalSummary,W-2*M,8.5)){text(t,M,y,8.5,false,GRAY);y+=12;}
    }
    if(state.plan.demo){text('DEMO - kein individueller Trainingsplan',M,y,8,false,GRAY);y+=14;}
    y+=10;
    if(continuation){
      const caption=`Fortsetzung: ${formatDate(continuation.date,{day:'2-digit',month:'2-digit'})} - ${continuation.title}`;
      for(const t of wrap(caption,W-2*M,9,true)){text(t,M,y,9,true,BLUE);y+=13;}
      y+=7;
    }
  }
  function ensure(height) {if(y+height>BOTTOM)newPage();}
  function paragraph(value,{x=M,size=9,bold=false,color=INK,maxWidth=W-2*M,gap=4,leading=size*1.4}={}) {
    for(const item of wrap(value,maxWidth,size,bold)){ensure(leading);text(item,x,y,size,bold,color);y+=leading;}
    y+=gap;
  }
  function timeSummary(w) {
    if(w.type==='rest')return '';
    const out=[];
    if(w.startTime&&w.endTime)out.push(`${w.startTime}-${w.endTime} Uhr`);
    else if(w.startTime)out.push(`${w.startTime} Uhr`);
    if(w.durationMinutes)out.push(`${w.durationMinutes} Min. ${w.startTime?'Zeitfenster':'geplant'}`);
    else if(w.durationLabel)out.push(w.durationLabel);
    if(w.optional)out.push('freiwillig');
    return out.join('  |  ');
  }
  function shortFocus(w) {
    const value=String(w.focus||w.description||'').replace(/\s+/g,' ').trim();
    if(value.length<=140)return value;
    const cut=value.slice(0,137);return cut.slice(0,Math.max(cut.lastIndexOf(' '),105))+'...';
  }
  function noteLines() {
    ensure(29);text('Notiz:',M+21,y+3,8,false,GRAY);
    line(M+53,y+5,W-M,y+5);y+=25;
  }
  function summaryText(items,summary,{paper=false,minutes=false}={}) {
    const hasRest=items.some(w=>w.type==='rest'),onePerDay=new Set(items.map(w=>w.date)).size===items.length;
    const noun=hasRest?(onePerDay?'Tage':'Einträge'):'Einheiten';
    const afterVon=hasRest?(onePerDay?'Tagen':'Einträgen'):'Einheiten';
    const optional=items.filter(w=>w.optional).length;
    let value=paper
      ?`${summary.total} ${noun}${!hasRest&&optional?` (${optional} freiwillig)`:''} - leere Kästchen für deine Papierliste.`
      :`${summary.done} von ${summary.total} ${afterVon} ${hasRest?'abgehakt':'erledigt'}${!hasRest&&optional?` (${optional} freiwillig geplant)`:''}.`;
    if(minutes)value+=`  |  ${summary.plannedMinutes} Min. Training geplant`;
    return value;
  }
  function restDay(w,{dated=true}={}) {
    const p=progressFor(state,w.id),left=M+21;
    const title=(dated?formatDate(w.date,{weekday:'short',day:'2-digit',month:'2-digit'})+'  -  ':'')+w.title;
    const sideX=paper?W-M-165:W-M-57;
    const titleLines=wrap(title,sideX-left-12,9.5);
    const description=details?(w.description||w.focus):'';
    continuation=null;ensure(titleLines.length*13+(description?30:0)+10);continuation=w;
    checkbox(M,y-8,!paper&&p.done,11);
    if(paper){text('Notiz:',sideX,y,7.5,false,GRAY);line(sideX+27,y+2,W-M,y+2);}
    else text(p.done?'abgehakt':'offen',sideX,y,8.3,false,GRAY);
    for(const item of titleLines){text(item,left,y,9.5,false,GRAY);y+=13;}
    if(description)paragraph(description,{x:left,maxWidth:W-M-left,size:8.5,color:GRAY,gap:3});
    if(details&&w.instructions){
      if(legacy)paragraph(w.instructions,{x:left,maxWidth:W-M-left,size:8.5,color:GRAY,gap:3});
      else paragraph(`Bitte Hinweise ${instructionIds.get(w.instructions)} am Ende dieses PDFs beachten.`,{x:left,maxWidth:W-M-left,size:8.5,color:GRAY,gap:3});
    }
    if(notes&&p.note)paragraph('Gespeicherte Notiz: '+p.note,{x:left,maxWidth:W-M-left,size:8.8,color:GRAY});
    y+=8;continuation=null;
  }
  function workout(w,{dated=true,compact=false}={}) {
    if(w.type==='rest'&&!w.steps.length){restDay(w,{dated});return;}
    const p=progressFor(state,w.id),left=M+21,maxWidth=W-M-left;
    const title=(dated?formatDate(w.date,{weekday:'short',day:'2-digit',month:'2-digit'})+'  -  ':'')+w.title;
    const titleSize=compact?10:10.5,titleLeading=compact?13:14.5;
    const titleLines=wrap(title,maxWidth,titleSize,true);
    continuation=null;
    const focus=shortFocus(w);
    const firstHeight=titleLines.length*titleLeading+15+(focus?13:0)+(paper&&!details?25:0)+8;
    ensure(firstHeight);
    continuation=w;
    checkbox(M,y-9,!paper&&p.done,11);
    for(const item of titleLines){text(item,left,y,titleSize,true);y+=titleLeading;}
    const meta=[timeSummary(w),paper?'':(p.done?'erledigt':'offen')].filter(Boolean).join('  |  ');
    if(meta)paragraph(meta,{x:left,maxWidth,size:8.3,color:GRAY,leading:11.2,gap:2});
    if(!details) {
      if(focus)paragraph(focus,{x:left,maxWidth,size:8.4,color:GRAY,leading:11.5,gap:2});
    } else {
      if(w.focus)paragraph(w.focus,{x:left,maxWidth,size:9,color:GRAY});
      if(w.description&&w.description!==w.focus)paragraph(w.description,{x:left,maxWidth,size:9});
      if(w.instructions&&legacy){
        ensure(39);
        paragraph('Vor dem Training beachten',{x:left,maxWidth,size:9,bold:true,gap:1});
        paragraph(w.instructions,{x:left,maxWidth,size:8.7,color:GRAY});
      }
      for(const s of w.steps) {
        const sx=M+34,sw=W-M-sx,titleRows=wrap(s.title,sw,9.3,true),detailRows=s.details?wrap(s.details,W-M-(M+34),8.8):[];
        const fullHeight=titleRows.length*13+detailRows.length*12.3+7;
        ensure(Math.min(fullHeight,240));
        checkbox(M+20,y-8,!paper&&p.steps?.[s.id],9.5);
        paragraph(s.title,{x:sx,maxWidth:sw,size:9.3,bold:true,leading:13,gap:1});
        if(s.details)paragraph(s.details,{x:sx,maxWidth:sw,size:8.8,leading:12.3,color:GRAY,gap:6});
      }
      if(w.instructions&&!legacy)paragraph(`Bitte Hinweise ${instructionIds.get(w.instructions)} am Ende dieses PDFs beachten.`,{x:left,maxWidth,size:8.5,color:GRAY,gap:5});
    }
    if(notes&&p.note){ensure(30);paragraph('Gespeicherte Notiz: '+p.note,{x:left,maxWidth,size:8.8,color:GRAY});}
    if(paper)noteLines();
    y+=compact?5:8;
    continuation=null;
  }
  function day(d) {
    continuation=null;ensure(79);line(M,y-4,W-M,y-4);y+=14;
    paragraph(formatDate(d,{weekday:'long',day:'numeric',month:'long'}),{size:10,bold:true,color:BLUE,gap:5});
    const list=selected.filter(w=>w.date===d);
    if(list.length)for(const w of list)workout(w,{dated:false});
    else paragraph('Kein Training geplant',{size:9,color:GRAY,gap:7});
  }
  function listView() {
    newPage(paper?'Checkliste zum Abhaken':'Trainingsübersicht');
    const summary=stats(state,period.start,period.end),rest=selected.filter(w=>w.type==='rest'),optional=selected.filter(w=>w.optional).length;
    paragraph(summaryText(selected,summary,{paper}),{size:9,color:GRAY,gap:rest.length?4:8});
    if(rest.length){
      const onePerDay=new Set(selected.map(w=>w.date)).size===selected.length;
      paragraph(`${selected.length-rest.length} ${onePerDay?'Trainingstage':'Trainingseinheiten'}${optional?` (${optional} freiwillig)`:''} und ${rest.length} Ruhetage.`,{size:8.5,color:GRAY,gap:8});
    }
    if(paper)paragraph(rest.length?'Hake jeden Tag ab, auch die Ruhetage. Alle Papierkästchen bleiben unabhängig von den Haken in der App leer.':'Hake Training und Übungen nach dem Erledigen ab. Die Kästchen sind unabhängig von den Haken in der App.',{size:8.5,color:GRAY,gap:10});
    if(!selected.length){paragraph('In diesem Zeitraum ist kein Training geplant.',{size:10});return;}
    const groups=new Map();
    for(const w of selected){const key=monday(w.date);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(w);}
    for(const [start,list] of groups) {
      // Keep the week heading together with its first dated entry.
      continuation=null;ensure(details?125:115);
      const num=list.find(w=>w.weekNumber!==null&&w.weekNumber!==undefined)?.weekNumber;
      const name=num===0?'Einstieg':num?'Woche '+num:'Trainingswoche';
      const first=start<period.start?period.start:start,last=addDays(start,6)>period.end?period.end:addDays(start,6);
      rect(M,y-12,W-2*M,23,[.94,.96,.98]);
      text(`${name}  |  ${formatDate(first)} - ${formatDate(last,{day:'numeric',month:'short',year:'numeric'})}`,M+8,y+3,9.3,true,BLUE);
      y+=28;
      if(details&&list[0].weekGoal)paragraph(list[0].weekGoal,{size:8.7,color:GRAY,gap:8});
      for(const w of list)workout(w,{compact:!details});
      y+=4;
    }
  }
  const summary=stats(state,period.start,period.end);
  if(!legacy||mode==='all')listView();
  else if(mode==='month') {
    newPage('Monatsübersicht');
    paragraph(summaryText(selected,summary,{minutes:true}),{size:10,color:GRAY});
    y+=12;const top=y,col=(W-2*M)/7,rowHeight=68,start=monday(period.start);
    const cells=days(start,addDays(monday(period.end),6));
    ['MO','DI','MI','DO','FR','SA','SO'].forEach((d,i)=>text(d,M+i*col+7,top,8,true,GRAY));
    cells.forEach((d,i)=>{
      const x=M+(i%7)*col,t=top+12+Math.floor(i/7)*rowHeight,active=d>=period.start&&d<=period.end;
      rect(x+1,t,col-2,rowHeight-2,active?[.96,.97,.99]:[.99,.99,.99]);
      text(String(date(d).getDate()),x+8,t+16,10,true,active?INK:[.72,.75,.80]);
      if(active){const s=stats(state,d,d),items=selected.filter(w=>w.date===d);if(s.total){const resting=items.every(w=>w.type==='rest');text(resting?'Ruhetag':`${s.total} Einheit${s.total===1?'':'en'}`,x+8,t+35,7,false,BLUE);text(resting?(s.done?'abgehakt':'offen'):`${s.done} erledigt`,x+8,t+49,7,false,GRAY);}}
    });
    y=top+12+Math.ceil(cells.length/7)*rowHeight+20;
    paragraph(selected.some(w=>w.type==='rest')?'Kalender: Training und Ruhetage mit deinem gespeicherten Fortschritt.':'Kalender: Anzahl geplanter und erledigter Einheiten pro Tag.',{size:9,color:GRAY});
    paragraph('Die vollständigen Trainingstitel stehen auf den Folgeseiten.',{size:9,color:GRAY});
    if(summary.total){newPage('Monat - Trainingsübersicht');for(const d of days(period.start,period.end))if(selected.some(w=>w.date===d))day(d);}
  } else {
    const count=mode==='fortnight'?2:1;
    for(let i=0;i<count;i++) {
      newPage(count===1?'Wochenübersicht':`Zweiwochenübersicht - Woche ${i+1}`);
      const start=addDays(period.start,i*7),weekStats=stats(state,start,addDays(start,6));
      paragraph(summaryText(selected.filter(w=>w.date>=start&&w.date<=addDays(start,6)),weekStats,{minutes:true}),{size:9,color:GRAY});
      y+=7;
      for(const d of days(start,addDays(start,6)))day(d);
    }
  }
  if(instructionGroups.length){
    continuation=null;newPage('Hinweise für dein Training');
    paragraph('Diese Hinweise ergänzen die Übungen. Gleiche Hinweise sind nur einmal aufgeführt; die passende Nummer steht bei jeder Einheit.',{size:9,color:GRAY,gap:14});
    for(let i=0;i<instructionGroups.length;i++){
      const {workout:w,instructions}=instructionGroups[i];
      continuation=null;ensure(70);
      const title=`Hinweise ${i+1} - ${w.title}`;
      paragraph(title,{size:10.5,bold:true,color:BLUE,gap:6});
      continuation={...w,title};
      paragraph(instructions,{size:9,color:INK,leading:13,gap:16});
      continuation=null;
    }
  }
  for(let i=0;i<pages.length;i++){page=pages[i];line(M,H-42,W-M,H-42);text('Pista - '+(paper?'Papier-Checkliste':'Trainingsübersicht')+' - DIN A4',M,H-25,8,false,GRAY);text(`Seite ${i+1} / ${pages.length}`,W-M-65,H-25,8,false,GRAY);}
  const objects=[];
  objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
  objects[2]=`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${6+i*2} 0 R`).join(' ')}] >>`;
  objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((commands,i)=>{const stream=commands.join('\n')+'\n';objects[5+i*2]=`<< /Length ${stream.length} >>\nstream\n${stream}endstream`;objects[6+i*2]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${5+i*2} 0 R >>`;});
  let pdf='%PDF-1.4\n',offsets=[0];
  for(let i=1;i<objects.length;i++){offsets[i]=pdf.length;pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=pdf.length;pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const modeName={week:'Woche',fortnight:'2-Wochen',month:'Monat',all:'Gesamtplan'}[mode];
  const filename=legacy?`Pista-${mode}-${period.start}.pdf`:`Pista-${paper?'Checkliste':'Uebersicht'}-${modeName}${details?'-mit-Uebungen':''}-${period.start}.pdf`;
  return {bytes:new TextEncoder().encode(pdf),filename,pageCount:pages.length,unsupportedCharacters:unsupported,period};
}
