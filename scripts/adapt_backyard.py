"""One-time, reviewable adaptation of Pista v1 to the user's actual reference.
Executed and committed on GitHub only after all browser checks pass.
"""
from pathlib import Path
p=Path(__file__).resolve().parents[1]
s=(p/'app.js').read_text()
if s.startswith("import {trackerView"):
    print('Backyard adaptation already applied.'); raise SystemExit(0)
s="import {trackerView} from './tracker-view.js';\n"+s
s=s.replace("const modeLabels=", "let expandedWorkouts=new Set();\nconst modeLabels=")
start=s.index('function overview() {')
end=s.index('function progressView()',start)
s=s[:start]+"""function overview() {return trackerView(state,{today,selected,expanded:expandedWorkouts,view:'overview',planMode},icon);}
function planView() {return trackerView(state,{today,selected,expanded:expandedWorkouts,view:'plan',planMode},icon);}
"""+s[end:]
s=s.replace("function render() {", "function render() {\n  const weekScroll=$('.by-weeks')?.scrollLeft||0;")
s=s.replace("$('#main').innerHTML=view==='plan'?planView():view==='progress'?progressView():overview();", "$('#main').innerHTML=view==='plan'?planView():view==='progress'?progressView():overview();\n  if($('.by-weeks'))$('.by-weeks').scrollLeft=weekScroll;")
s=s.replace("case 'open':openWorkout(id);break;", """case 'open':openWorkout(id);break;
    case 'expand':if(expandedWorkouts.has(id))expandedWorkouts.delete(id);else expandedWorkouts.add(id);render();break;
    case 'tracker-week':selected=b.dataset.date;planMode='week';render();$('.by-week.active')?.scrollIntoView({block:'nearest',inline:'nearest'});break;
    case 'export-paper':openExport();break;""")
s=s.replace("if(el.matches('[data-step]')) {", """if(el.matches('[data-inline-step]')) {mutate(s=>setStep(s,el.dataset.workout,el.dataset.inlineStep,el.checked));render();}
  if(el.matches('[data-step]')) {""")
s=s.replace('Importiere einen Trainingsplan als JSON oder CSV oder stelle eine Pista-Sicherung wieder her.', 'Importiere einen Trainingsplan als JSON oder CSV, einen Backyard-Wochenplan als JSON oder eine Pista-Sicherung.')
s=s.replace("const plan=demoPlan(today);plan.id='mein-plan';plan.title='Mein Trainingsplan';", "const plan=demoPlan(today);plan.id='mein-plan';plan.title='Mein Trainingsplan';plan.demo=false;")
(p/'app.js').write_text(s)
s=(p/'index.html').read_text().replace('Dein Training. Dein Tempo.</title>','Dein Trainingsplan.</title>').replace('<script type="module"', '<link rel="stylesheet" href="./tracker.css"><script type="module"')
s=s.replace('<meta name="theme-color"','<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Pista"><meta name="apple-mobile-web-app-status-bar-style" content="default">\n<meta name="theme-color"')
(p/'index.html').write_text(s)
s=(p/'sw.js').read_text().replace('pista-shell-v1.1','pista-shell-v2.0').replace("'./refinements.css'", "'./refinements.css','./tracker.css','./tracker-view.js'")
(p/'sw.js').write_text(s)
s=(p/'core.js').read_text().replace("other:'Training'", "other:'Training',longrun:'Long Run',tempo:'Tempo',race:'Wettkampf'")
s=s.replace("type:own(TYPES,w.type)?w.type:'other',durationMinutes:","type:own(TYPES,w.type)?w.type:'other',focus:text(w.focus,`${prefix}: Fokus`,500),zone:text(w.zone,`${prefix}: Zone`,80),durationLabel:text(w.durationLabel,`${prefix}: Dauer`,80),weekGoal:text(w.weekGoal,`${prefix}: Wochenziel`,500),weekNumber:Number.isInteger(w.weekNumber)&&w.weekNumber>0&&w.weekNumber<=10000?w.weekNumber:null,durationMinutes:")
s=s.replace('  return {schemaVersion:1,id:id(input.id', "  const targetDate=input.targetDate?iso(date(input.targetDate)):null;\n  return {targetDate,targetLabel:text(input.targetLabel,'Zielbezeichnung',80),schemaVersion:1,id:id(input.id")
s=s.replace("  return {kind:'plan',plan:normalizePlan(data)};", "  if(Array.isArray(data)||Array.isArray(data?.weeks)||Array.isArray(data?.PLAN))return {kind:'plan',plan:fromBackyard(data)};\n  return {kind:'plan',plan:normalizePlan(data)};")
s += '''\n// The weekly schema of the user's reference. Never evaluates uploaded code.
export function fromBackyard(input) {
  const weeks=Array.isArray(input)?input:input.weeks||input.PLAN;
  if(!Array.isArray(weeks)||weeks.length>520)throw new Error('Ungültiger Wochenplan: höchstens 520 Wochen.');
  const workouts=[];
  const aliases={gym:'strength',rest:'recovery',bike:'cycle'};
  function duration(label) {
    const s=String(label||'').trim();
    let m=s.match(/^(\\d+(?:[.,]\\d+)?)\\s*min$/i);
    if(m)return Number(m[1].replace(',','.'));
    m=s.match(/^(\\d+):(\\d{2})\\s*h$/i);
    if(m&&Number(m[2])<60)return Number(m[1])*60+Number(m[2]);
    m=s.match(/^(\\d+(?:[.,]\\d+)?)\\s*(?:h|stunden?)$/i);
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
'''
(p/'core.js').write_text(s)
s=(p/'pdf.js').read_text().replace('${w.durationMinutes} Min. geplant', "${w.durationLabel||(w.durationMinutes+' Min.')} geplant")
s=s.replace('if(w.description)paragraph(w.description', 'if(w.focus)paragraph(w.focus,{x:M+19,maxWidth:W-2*M-19,size:9,color:GRAY});\n      if(w.description)paragraph(w.description')
(p/'pdf.js').write_text(s)
s=(p/'tests/browser_test.py').read_text()
s=s.replace("get_by_role('button', name='Workout öffnen', exact=True)","get_by_role('button', name='Workout öffnen', exact=True).first").replace("get_by_role('button', name='Workout ansehen', exact=True)","get_by_role('button', name='Workout ansehen', exact=True).first")
# The reference intentionally shows the same workout in Today and its week.
extra='''
    def reference_interactions():
        reset()
        select_nav('overview')
        expect(page.locator('.by-summary [role="progressbar"]')).to_have_attribute('aria-valuenow', '0')
        assert page.locator('input[type="password"]').count() == 0
        page.locator('[data-action="expand"]').first.click()
        expect(page.locator('[data-action="expand"]').first).to_have_attribute('aria-expanded', 'true')
        page.locator('[data-inline-step="warmup"]').first.check()
        page.reload()
        page.locator('[data-action="expand"]').first.click()
        expect(page.locator('[data-inline-step="warmup"]').first).to_be_checked()
        next_week=page.evaluate("async (d) => (await import('./core.js')).addDays(d,7)",today)
        legacy={'title':'Referenz-Wochenplan','weeks':[{'week':1,'goal':'Technik und Rhythmus','days':[{'date':today,'unit':'Testeinheit','dauer':'25 min','zone':'Locker','type':'gym','fokus':'Saubere Ausführung','detail':'Eine ausführliche Anleitung.'}]},{'week':2,'goal':'Konstanz','days':[{'date':next_week,'unit':'Nächste Woche','dauer':'30–40 min','type':'run','fokus':'Gleichmäßig','detail':'Testeintrag.'}]}]}
        upload(legacy)
        page.locator('[data-action="import-confirm"]').click()
        expect(page.locator('.by-week-goal')).to_have_text('Technik und Rhythmus')
        assert page.locator('.by-week').count() == 2
        page.locator('.by-week').nth(1).click()
        expect(page.locator('.workout-open strong')).to_have_text('Nächste Woche')
        page.locator('[data-action="done"]').click()
        expect(page.locator('[data-action="expand"]')).to_have_attribute('aria-expanded','false')
        page.reload()
        page.locator('.by-week').nth(1).click()
        expect(page.locator('[data-action="done"]')).to_have_attribute('aria-pressed','true')
        select_nav('overview')
        expect(page.get_by_role('heading', name='Nächste Einheiten', exact=True)).to_be_visible()
        page.screenshot(path=str(OUT / f'{engine}-reference-layout.png'),full_page=True)
        reset()
        select_nav('overview')
    check(engine + ': reference layout, inline steps, original weekly schema, week navigation and independent checkbox', reference_interactions)
'''
needle="    check(engine + ': six viewport widths, three views, no horizontal overflow, light-only theme', responsive)"
assert needle in s
s=s.replace(needle,needle+'\n'+extra)
(p/'tests/browser_test.py').write_text(s)
s=(p/'tests/wait_for_pages.py').read_text().replace("'styles.css',", "'styles.css', 'tracker.css', 'tracker-view.js',")
(p/'tests/wait_for_pages.py').write_text(s)
s=(p/'package.json').read_text().replace('node --check sw.js','node --check sw.js && node --check tracker-view.js').replace('tests/core.test.js','tests/*.test.js').replace('"version":"1.0.0"','"version":"2.0.0"')
(p/'package.json').write_text(s)
