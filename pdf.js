// Dependency-free, text-searchable PDF 1.4 writer. A4 portrait, WinAnsi/Helvetica.
// No HTML, external services, remote fonts or user-provided PDF commands.
import {range,days,monday,addDays,date,formatDate,shortRange,stats,progressFor,TYPES} from './core.js';
const W=595.28,H=841.89,M=42,BOTTOM=H-56;
const GRAY=[.40,.45,.52],INK=[.11,.14,.19],BLUE=[.09,.41,.93];
const number=n=>Number(n).toFixed(2);
export function createTrainingPDF(state,mode,anchor,details=false) {
  if(!['week','fortnight','month'].includes(mode))throw new Error('Unbekannter PDF-Zeitraum.');
  const period=range(mode,anchor), pages=[];
  let page,y=0,unsupported=0,label='';
  let ctx=null;
  if(typeof document!=='undefined')ctx=document.createElement('canvas').getContext('2d');
  function safe(value) {return String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').replace(/[^\x20-\x7e\xa0-\xff\n]/gu,()=>{unsupported++;return '?';});}
  function escaped(s) {return [...s].map(c=>{const n=c.charCodeAt(0);return n>=128?'\\'+n.toString(8).padStart(3,'0'):'()\\'.includes(c)?'\\'+c:c;}).join('');}
  function text(s,x,top,size=10,bold=false,color=INK) {
    page.push(`${color.join(' ')} rg BT /F${bold?2:1} ${size} Tf 1 0 0 1 ${number(x)} ${number(H-top)} Tm (${escaped(safe(s).replace(/\n/g,' '))}) Tj ET`);
  }
  function line(x1,y1,x2,y2,color=[.87,.89,.92]) {page.push(`${color.join(' ')} RG 0.6 w ${number(x1)} ${number(H-y1)} m ${number(x2)} ${number(H-y2)} l S`);}
  function rect(x,top,width,height,color=[.96,.97,.98]) {page.push(`${color.join(' ')} rg ${number(x)} ${number(H-top-height)} ${number(width)} ${number(height)} re f`);}
  function width(s,size,bold=false) {if(ctx){ctx.font=`${bold?'bold ':''}${size}px Arial`;return ctx.measureText(s).width*1.045;}return [...s].reduce((n,c)=>n+(/[MW@%]/.test(c)?.95:/[ilI.,' :;!]/.test(c)?.30:.63)*size,0);}
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
    text(label,M,88,19,true);
    text(shortRange(period),M,108,10,false,GRAY);
    y=130;
    for(const t of wrap(state.plan.title,W-2*M,10,true)){text(t,M,y,10,true);y+=14;}
    if(state.plan.demo){text('DEMO - kein individueller Trainingsplan',M,y,8,false,GRAY);y+=14;}
    y+=10;
  }
  function ensure(height) {if(y+height>BOTTOM)newPage();}
  function paragraph(value,{x=M,size=10,bold=false,color=INK,maxWidth=W-2*M,gap=4}={}) {
    const lines=wrap(value,maxWidth,size,bold);
    for(const item of lines){ensure(size*1.5);text(item,x,y,size,bold,color);y+=size*1.5;}
    y+=gap;
  }
  function workout(w) {
    const p=progressFor(state,w.id);ensure(44);
    paragraph(`${p.done?'[x]':'[ ]'}  ${w.title}`,{size:11,bold:true});
    paragraph(`${TYPES[w.type]}  |  ${w.durationLabel||(w.durationMinutes+' Min.')} geplant  |  ${p.done?'Erledigt':'Offen'}`,{x:M+19,maxWidth:W-2*M-19,size:9,color:GRAY});
    if(details) {
      if(w.focus)paragraph(w.focus,{x:M+19,maxWidth:W-2*M-19,size:9,color:GRAY});
      if(w.description)paragraph(w.description,{x:M+19,maxWidth:W-2*M-19,size:9,color:GRAY});
      for(const s of w.steps){paragraph(`${p.steps[s.id]?'[x]':'[ ]'} ${s.title}`,{x:M+19,maxWidth:W-2*M-19,size:9,bold:true,gap:1});if(s.details)paragraph(s.details,{x:M+36,maxWidth:W-2*M-36,size:9,color:GRAY});}
      if(p.note)paragraph('Notiz: '+p.note,{x:M+19,maxWidth:W-2*M-19,size:9,color:GRAY});
    }
    y+=6;
  }
  function day(d) {
    ensure(52);line(M,y-4,W-M,y-4);y+=14;
    paragraph(formatDate(d,{weekday:'long',day:'numeric',month:'long'}),{size:10,bold:true,color:BLUE,gap:5});
    const list=state.plan.workouts.filter(w=>w.date===d);
    if(list.length)for(const w of list)workout(w);
    else paragraph('Kein Training geplant',{size:9,color:GRAY,gap:7});
  }
  const summary=stats(state,period.start,period.end);
  if(mode==='month') {
    newPage('Monatsübersicht');
    paragraph(`${summary.done} von ${summary.total} Einheiten erledigt  |  ${summary.plannedMinutes} Min. geplant`,{size:10,color:GRAY});
    y+=12;const top=y,col=(W-2*M)/7,rowHeight=68,start=monday(period.start);
    const cells=days(start,addDays(monday(period.end),6));
    ['MO','DI','MI','DO','FR','SA','SO'].forEach((d,i)=>text(d,M+i*col+7,top,8,true,GRAY));
    cells.forEach((d,i)=>{
      const x=M+(i%7)*col,t=top+12+Math.floor(i/7)*rowHeight,active=d>=period.start&&d<=period.end;
      rect(x+1,t,col-2,rowHeight-2,active?[.96,.97,.99]:[.99,.99,.99]);
      text(String(date(d).getDate()),x+8,t+16,10,true,active?INK:[.72,.75,.80]);
      if(active){const s=stats(state,d,d);if(s.total){text(`${s.total} Einheit${s.total===1?'':'en'}`,x+8,t+35,7,false,BLUE);text(`${s.done} erledigt`,x+8,t+49,7,false,GRAY);}}
    });
    y=top+12+Math.ceil(cells.length/7)*rowHeight+20;
    paragraph('Kalender: Anzahl geplanter und erledigter Einheiten pro Tag.',{size:9,color:GRAY});
    paragraph('Die vollständigen Trainingstitel stehen auf den Folgeseiten.',{size:9,color:GRAY});
    if(summary.total){newPage('Monat · Trainingsübersicht');for(const d of days(period.start,period.end))if(state.plan.workouts.some(w=>w.date===d))day(d);}
  } else {
    const count=mode==='fortnight'?2:1;
    for(let i=0;i<count;i++) {
      newPage(count===1?'Wochenübersicht':`Zweiwochenübersicht · Woche ${i+1}`);
      const start=addDays(period.start,i*7),weekStats=stats(state,start,addDays(start,6));
      paragraph(`${weekStats.done} von ${weekStats.total} Einheiten erledigt  |  ${weekStats.plannedMinutes} Min. geplant`,{size:9,color:GRAY});
      y+=7;
      for(const d of days(start,addDays(start,6)))day(d);
    }
  }
  for(let i=0;i<pages.length;i++){page=pages[i];line(M,H-42,W-M,H-42);text('Pista · Lokal erstellt · DIN A4',M,H-25,8,false,GRAY);text(`Seite ${i+1} / ${pages.length}`,W-M-57,H-25,8,false,GRAY);}
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
  return {bytes:new TextEncoder().encode(pdf),filename:`Pista-${mode}-${period.start}.pdf`,pageCount:pages.length,unsupportedCharacters:unsupported};
}
