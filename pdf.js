// Dependency-free, text-searchable PDF 1.4 writer. A4 portrait, WinAnsi/Helvetica.
// A single checkbox belongs to a complete workout or rest day. Exercise details
// are reading material; they never add checkboxes. Paper boxes always start empty.
import {range,days,monday,addDays,date,formatDate,shortRange,stats,progressFor,iso} from './core.js';
import {exerciseHelpFor} from './training-plan.js';
const W=595.28,H=841.89,M=42,BOTTOM=H-58;
const INK=[.12,.16,.22],GRAY=[.39,.44,.50],BLUE=[.08,.32,.58],RULE=[.82,.86,.90],PALE=[.95,.97,.985];
const number=n=>Number(n).toFixed(2);
// Adobe Base 14 Helvetica metrics keep wrapping identical in the app and in tests.
const FONT_WIDTHS=[
  [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],
  [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556]
];

/**
 * options: {layout:'overview'|'checklist', details:false}. Saved notes never leave the app via PDF.
 * A boolean fourth argument remains compatible with earlier Pista exports.
 */
export function createTrainingPDF(state,mode,anchor,options=false) {
  if(!['week','fortnight','month','all'].includes(mode))throw new Error('Unbekannter PDF-Zeitraum.');
  const legacy=typeof options==='boolean';
  if(!legacy&&(!options||typeof options!=='object'||Array.isArray(options)))throw new Error('Ungültige PDF-Einstellungen.');
  const settings=legacy?{layout:'overview',details:options}:{layout:'overview',details:false,...options};
  if(!['overview','checklist'].includes(settings.layout))throw new Error('Unbekannte PDF-Ansicht.');
  const paper=settings.layout==='checklist',details=settings.details===true;
  const all=[...state.plan.workouts].sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'').localeCompare(b.startTime||'')||a.id.localeCompare(b.id));
  const period=mode==='all'?{start:all[0]?.date||iso(date(anchor||iso())),end:all.at(-1)?.date||iso(date(anchor||iso()))}:range(mode,anchor);
  const selected=all.filter(w=>w.date>=period.start&&w.date<=period.end),pages=[];
  const summary=stats(state,period.start,period.end),groups=new Map(),instructionGroups=[],instructionIds=new Map();
  for(const w of selected) {
    const start=monday(w.date);
    if(!groups.has(start))groups.set(start,[]);
    groups.get(start).push(w);
    if(details&&w.instructions&&!instructionIds.has(w.instructions)) {
      instructionIds.set(w.instructions,instructionGroups.length+1);
      instructionGroups.push({workout:w,instructions:w.instructions});
    }
  }
  let page,y=0,unsupported=0,label='',subtitle='',continuation=null;
  function safe(value) {
    return String(value??'').replace(/\t/g,' ').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').replace(/[^\x20-\x7e\xa0-\xff\n]/gu,()=>{unsupported++;return '?';});
  }
  function escaped(s) {return [...s].map(c=>{const n=c.charCodeAt(0);return n>=128?'\\'+n.toString(8).padStart(3,'0'):'()\\'.includes(c)?'\\'+c:c;}).join('');}
  function text(s,x,top,size=10,bold=false,color=INK) {
    page.push(`${color.join(' ')} rg BT /F${bold?2:1} ${size} Tf 1 0 0 1 ${number(x)} ${number(H-top)} Tm (${escaped(safe(s).replace(/\n/g,' '))}) Tj ET`);
  }
  function line(x1,y1,x2,y2,color=RULE) {page.push(`${color.join(' ')} RG 0.6 w ${number(x1)} ${number(H-y1)} m ${number(x2)} ${number(H-y2)} l S`);}
  function rect(x,top,width,height,color=PALE) {page.push(`${color.join(' ')} rg ${number(x)} ${number(H-top-height)} ${number(width)} ${number(height)} re f`);}
  function checkbox(x,top,checked=false,size=11) {
    page.push(`% checkbox ${checked?'checked':'empty'}`);
    page.push(`${GRAY.join(' ')} RG 0.85 w ${number(x)} ${number(H-top-size)} ${number(size)} ${number(size)} re S`);
    if(checked)page.push(`${BLUE.join(' ')} RG 1.3 w ${number(x+2)} ${number(H-top-size*.53)} m ${number(x+size*.43)} ${number(H-top-size+2)} l ${number(x+size-2)} ${number(H-top-2)} l S`);
  }
  function width(s,size,bold=false) {
    const metrics=FONT_WIDTHS[bold?1:0];
    return [...s].reduce((n,c)=>n+(metrics[c.charCodeAt(0)-32]??556),0)*size/1000*1.015;
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
  function right(value,rightEdge,top,size=9,bold=false,color=GRAY) {text(value,rightEdge-width(safe(value),size,bold),top,size,bold,color);}
  function newPage(nextLabel=label,nextSubtitle=subtitle) {
    label=nextLabel;subtitle=nextSubtitle;page=[];pages.push(page);
    text('pista.',M,46,24,true,BLUE);
    right(paper?'DEINE WOCHEN-CHECKLISTE':'DEIN TRAININGSPLAN',W-M,43,8,true,GRAY);
    line(M,61,W-M,61);
    y=91;
    for(const t of wrap(label,W-2*M,21,true)){text(t,M,y,21,true);y+=26;}
    for(const t of wrap(subtitle,W-2*M,10)){text(t,M,y,10,false,GRAY);y+=14;}
    for(const t of wrap(state.plan.title,W-2*M,9)){text(t,M,y,9,false,GRAY);y+=13;}
    if(pages.length===1&&state.plan.goalSummary)for(const t of wrap(state.plan.goalSummary,W-2*M,8)){text(t,M,y,8,false,GRAY);y+=12;}
    if(state.plan.demo){text('DEMO - kein individueller Trainingsplan',M,y,8,false,GRAY);y+=13;}
    y+=10;
    if(continuation) {
      const caption=`Fortsetzung: ${formatDate(continuation.date,{day:'2-digit',month:'2-digit'})} - ${continuation.title}`;
      for(const t of wrap(caption,W-2*M,9,true)){text(t,M,y,9,true,BLUE);y+=13;}
      y+=8;
    }
  }
  function ensure(height) {if(y+height>BOTTOM)newPage();}
  function paragraph(value,{x=M,size=9,bold=false,color=INK,maxWidth=W-2*M,gap=4,leading=size*1.4}={}) {
    for(const item of wrap(value,maxWidth,size,bold)){ensure(leading);text(item,x,y,size,bold,color);y+=leading;}
    y+=gap;
  }
  function clock(w) {
    if(w.type==='rest')return '';
    return w.startTime?(w.endTime?`${w.startTime}-${w.endTime} Uhr`:`${w.startTime} Uhr`):'';
  }
  function duration(w) {
    if(w.type==='rest')return '';
    if(w.durationLabel&&w.durationLabel!=='0 Min.')return w.durationLabel;
    return w.durationMinutes?`${w.durationMinutes} Min.${w.startTime?' Zeitfenster':''}`:'';
  }
  function timeSummary(w) {return [clock(w),duration(w),w.optional?'freiwillig':''].filter(Boolean).join('  |  ');}
  function shortFocus(w) {
    const value=[w.zone,w.focus||w.description||''].filter(Boolean).join(' · ').replace(/\s+/g,' ').trim();
    if(value.length<=140)return value;
    const cut=value.slice(0,137);return cut.slice(0,Math.max(cut.lastIndexOf(' '),105))+'...';
  }
  function summaryText(items,s,{empty=false}={}) {
    const hasRest=items.some(w=>w.type==='rest'),onePerDay=new Set(items.map(w=>w.date)).size===items.length;
    const noun=hasRest?(onePerDay?(s.total===1?'Tag':'Tage'):(s.total===1?'Eintrag':'Einträge')):(s.total===1?'Einheit':'Einheiten');
    const afterVon=hasRest?(onePerDay?(s.total===1?'Tag':'Tagen'):(s.total===1?'Eintrag':'Einträgen')):(s.total===1?'Einheit':'Einheiten');
    return empty?`${s.total} ${noun}`:`${s.done} von ${s.total} ${afterVon} ${hasRest?'abgehakt':'erledigt'}`;
  }
  function breakdown(items,s) {
    const onePerDay=new Set(items.map(w=>w.date)).size===items.length;
    const optional=items.filter(w=>w.optional).length;
    const training=onePerDay?(s.trainingTotal===1?'Trainingstag':'Trainingstage'):(s.trainingTotal===1?'Trainingseinheit':'Trainingseinheiten');
    return `${s.trainingTotal} ${training}${optional?` (${optional} freiwillig)`:''}${s.restTotal?`  |  ${s.restTotal} ${s.restTotal===1?'Ruhetag':'Ruhetage'}`:''}`;
  }
  function weekName(list) {
    const num=list.find(w=>w.weekNumber!==null&&w.weekNumber!==undefined)?.weekNumber;
    return num===0?'Einstiegswoche':num?'Woche '+num:'Trainingswoche';
  }
  function weekPeriod(start) {return {start:start<period.start?period.start:start,end:addDays(start,6)>period.end?period.end:addDays(start,6)};}
  function weekRows(start,list) {
    const byDate=new Map();
    for(const w of list){if(!byDate.has(w.date))byDate.set(w.date,[]);byDate.get(w.date).push(w);}
    const r=weekPeriod(start);
    return days(r.start,r.end).flatMap(d=>byDate.get(d)||[{date:d,empty:true}]);
  }
  const col={check:M+9,date:M+35,training:M+105,notes:W-M-112,time:W-M-105};
  function rowData(w) {
    const maxWidth=(paper?col.notes:col.time)-col.training-13;
    const title=wrap(w.empty?'Kein Eintrag':w.title,maxWidth,paper?10:9.3,!w.empty&&w.type!=='rest');
    const focus=!w.empty&&(paper||w.type!=='rest')?wrap(shortFocus(w),maxWidth,8.2):[];
    const meta=w.empty||!timeSummary(w)?[]:wrap(timeSummary(w),maxWidth,8);
    const times=w.empty?[]:[clock(w),duration(w),w.optional?'freiwillig':''].filter(Boolean).flatMap(t=>wrap(t,W-M-col.time-6,7.8));
    const height=paper?Math.max(66,14+title.length*13+meta.length*10.7+focus.length*10.7):Math.max(32,12+title.length*12+focus.length*10.5,12+times.length*10.5);
    return {w,title,focus,meta,times,height};
  }
  function tableHeader() {
    rect(M,y-12,W-2*M,24);
    text('OK',M+8,y+3,7.5,true,GRAY);
    text('TAG',col.date,y+3,7.5,true,GRAY);
    text('TRAINING / ERHOLUNG',col.training,y+3,7.5,true,GRAY);
    text(paper?'DEINE NOTIZ':'ZEIT / DAUER',paper?col.notes:col.time,y+3,7.5,true,GRAY);
    y+=12;
  }
  function drawRow(item) {
    const {w,title,focus,meta,times,height}=item,top=y;
    if(w.type==='rest'||w.empty)rect(M,top,W-2*M,height,[.98,.985,.99]);
    if(!w.empty)checkbox(col.check,top+(paper?25:11),!paper&&progressFor(state,w.id).done,paper?14:11);
    text(formatDate(w.date,{weekday:'short'}).replace('.','').toUpperCase(),col.date,top+15,8.2,true,GRAY);
    text(formatDate(w.date,{day:'2-digit',month:'2-digit'}),col.date,top+(paper?28:26),8.5,false,GRAY);
    let ty=top+17;
    for(const t of title){text(t,col.training,ty,paper?10:9.3,!w.empty&&w.type!=='rest',w.type==='rest'||w.empty?GRAY:INK);ty+=paper?13:12;}
    if(paper)for(const t of meta){text(t,col.training,ty,8,false,GRAY);ty+=10.7;}
    for(const t of focus){text(t,col.training,ty,8.2,false,GRAY);ty+=10.7;}
    if(paper) {
      line(col.notes,top+31,W-M-8,top+31);
      line(col.notes,top+51,W-M-8,top+51);
    } else {
      let mt=top+17;
      for(const t of times){text(t,col.time,mt,7.8,false,GRAY);mt+=10.5;}
    }
    y+=height;line(M,y,W-M,y);
  }
  function overview() {
    newPage('Trainingsübersicht',shortRange(period));
    paragraph(summaryText(selected,summary)+`  |  ${summaryText(selected,summary,{empty:true})} geplant`,{size:9.2,bold:true,color:BLUE,gap:2});
    paragraph(breakdown(selected,summary),{size:8.5,color:GRAY,gap:12});
    if(!selected.length){paragraph('In diesem Zeitraum ist kein Training geplant.',{size:10});return;}
    for(const [start,list] of groups) {
      const r=weekPeriod(start),rows=weekRows(start,list).map(rowData),height=rows.reduce((n,item)=>n+item.height,0)+48;
      continuation=null;
      if(y+height>BOTTOM&&height<BOTTOM-155)newPage();
      ensure(90);
      text(weekName(list),M,y,12,true,BLUE);
      right(shortRange(r),W-M,y,8.5,false,GRAY);
      y+=20;tableHeader();
      for(const item of rows) {
        if(y+item.height>BOTTOM){newPage();text(weekName(list)+' - Fortsetzung',M,y,11,true,BLUE);y+=22;tableHeader();}
        drawRow(item);
      }
      y+=16;
    }
  }
  function paperChecklist() {
    if(!selected.length) {
      newPage('Wochen-Checkliste',shortRange(period));
      paragraph('In diesem Zeitraum ist kein Training geplant.',{size:10});return;
    }
    for(const [start,list] of groups) {
      const r=weekPeriod(start),s=stats(state,r.start,r.end),rows=weekRows(start,list).map(rowData);
      continuation=null;newPage(weekName(list),shortRange(r));
      paragraph(breakdown(list,s),{size:9.2,bold:true,color:BLUE,gap:3});
      if(pages.length===1&&groups.size>1)paragraph(`Gesamter Export: ${summaryText(selected,summary,{empty:true})}  |  ${breakdown(selected,summary)}`,{size:8,color:GRAY,gap:3});
      else paragraph(`${summaryText(list,s,{empty:true})} - ein Haken pro ganzem Workout oder Ruhetag.`,{size:8,color:GRAY,gap:3});
      const goal=list.find(w=>w.weekGoal)?.weekGoal;
      if(goal)paragraph('Wochenziel: '+goal,{size:9,color:GRAY,gap:10});
      else y+=8;
      y+=8;tableHeader();
      for(const item of rows) {
        if(y+item.height>BOTTOM-55){newPage(weekName(list)+' - Fortsetzung',shortRange(r));tableHeader();}
        drawRow(item);
      }
      y+=24;ensure(40);
      text('Mein Wochenrückblick',M,y,9,true,BLUE);
      text('Was lief gut? Was möchte ich nächste Woche anpassen?',M+117,y,8,false,GRAY);
      line(M,y+20,W-M,y+20);
      y+=40;
    }
  }
  if(paper)paperChecklist();else overview();

  // Optional information follows the clean weekly sheets. No detailed section
  // repeats a day checkbox or renders the legacy per-exercise completion state.
  if(details&&selected.length) {
    continuation=null;newPage('Workouts im Detail',shortRange(period));
    paragraph('Ablauf, Wiederholungen und Pausen. Hake die ganze Einheit in der Wochenliste ab.',{size:9,color:GRAY,gap:16});
    for(const w of selected) {
      continuation=null;
      const title=`${formatDate(w.date,{weekday:'short',day:'2-digit',month:'2-digit'})} - ${w.title}`;
      ensure(85);line(M,y-10,W-M,y-10);
      continuation=w;
      paragraph(title,{size:11,bold:true,color:BLUE,leading:15.4,gap:3});
      if(timeSummary(w))paragraph(timeSummary(w),{size:8.3,color:GRAY,gap:6});
      if(w.zone)paragraph('Intensität: '+w.zone,{size:9,bold:true,gap:4});
      if(w.focus)paragraph(w.focus,{size:9,bold:true,gap:4});
      if(w.description&&w.description!==w.focus)paragraph(w.description,{size:9,gap:8});
      for(const [i,s] of w.steps.entries()) {
        const left=M+25,maxWidth=W-M-left,help=exerciseHelpFor(s);
        const blockHeight=wrap(s.title,maxWidth,9.4,true).length*13+wrap(s.details||'',maxWidth,9).length*13+(help?wrap(help,maxWidth,9).length*13+4:0)+9;
        ensure(Math.min(blockHeight,260));
        text(String(i+1).padStart(2,'0'),M,y,8.7,true,BLUE);
        paragraph(s.title,{x:left,maxWidth,size:9.4,bold:true,leading:13,gap:2});
        if(s.details)paragraph(s.details,{x:left,maxWidth,size:9,leading:13,color:INK,gap:help?4:9});
        if(help)paragraph(help,{x:left,maxWidth,size:9,leading:13,color:GRAY,gap:9});
      }
      if(w.instructions)paragraph(`Hinweise ${instructionIds.get(w.instructions)} am Ende dieses PDFs beachten.`,{size:8.5,color:BLUE,gap:6});
      y+=12;continuation=null;
    }
  }
  if(instructionGroups.length) {
    continuation=null;newPage('Anpassungen & Hinweise',shortRange(period));
    paragraph('Die passende Nummer steht bei jedem Workout. Gleiche Hinweise sind nur einmal aufgeführt.',{size:9,color:GRAY,gap:16});
    for(let i=0;i<instructionGroups.length;i++) {
      const {workout:w,instructions}=instructionGroups[i];
      continuation=null;ensure(75);
      const title=`Hinweise ${i+1} - ${w.title}`;
      paragraph(title,{size:11,bold:true,color:BLUE,gap:8});
      continuation={...w,title};
      paragraph(instructions,{size:9,leading:13,gap:18});
      continuation=null;
    }
  }
  for(let i=0;i<pages.length;i++) {
    page=pages[i];line(M,H-42,W-M,H-42);
    text(paper?'Pista - Zum Ausdrucken und Abhaken.':'Pista - Trainingsübersicht mit gespeichertem Fortschritt.',M,H-25,7.7,false,GRAY);
    right(`Seite ${i+1} / ${pages.length}`,W-M,H-25,7.7,false,GRAY);
  }
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
