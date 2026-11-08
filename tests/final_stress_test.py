"""Release-acceptance stress tests. Synthetic profiles only; never writes to production.

Historical releases are served on localhost. No cloud backup credentials are used.
"""
from __future__ import annotations
import http.server, io, json, os, shutil, subprocess, tempfile, threading, time, traceback, zipfile
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
from pwa_browser_test import WORKER_VERSION, wait_for_page_condition
import fitz
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'/'final-audit';OUT.mkdir(parents=True,exist_ok=True)
RESULTS=[]; FAILURES=[]; LIMITS=[]; VERSIONS={}

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self,path):
        self.directory=str(self.server.release_directory)
        return super().translate_path(path)
    def do_GET(self):
        if self.server.broken and urlparse(self.path).path.endswith('/training-plan.js'):
            self.send_response(503);self.end_headers();self.wfile.write(b'Intentional test failure');return
        try: super().do_GET()
        except (BrokenPipeError,ConnectionResetError): pass
    def end_headers(self):
        self.send_header('Cache-Control','no-store');super().end_headers()
    def log_message(self,*args):pass

def check(engine,name,fn):
    started=time.monotonic()
    try:
        detail=fn()
        RESULTS.append({'browser':engine,'test':name,'seconds':round(time.monotonic()-started,3),'result':'PASS','detail':detail})
        print('PASS',engine,name,flush=True)
    except Exception:
        error=traceback.format_exc()
        FAILURES.append({'browser':engine,'test':name,'error':error})
        print('FAIL',engine,name,error,flush=True)
    write_report()

def write_report():
    (OUT/'final-stress-results.json').write_text(json.dumps({'passed':len(RESULTS),'failed':len(FAILURES),'browser_versions':VERSIONS,'checks':RESULTS,'failures':FAILURES,'limitations':LIMITS},ensure_ascii=False,indent=2))

def stored(page):return page.evaluate('JSON.parse(localStorage.getItem("pista.state.v1"))')
def flags(page):return {k:(v.get('done',False),v.get('note',''),v.get('completedAt')) for k,v in stored(page)['progress'].items()}
def select(page,week='2026-11-09'):
    if page.locator('#modal').get_attribute('open') is not None:page.locator('#modal [data-action="close"]').click()
    page.locator('nav:visible [data-view="plan"]').click()
    page.locator(f'[data-action="tracker-week"][data-date="{week}"]').click()
def settings(page):
    if page.locator('#modal').get_attribute('open') is not None:page.locator('#modal [data-action="close"]').click()
    page.locator('#data-button').click()
def refresh_check(page):
    settings(page)
    expect(page.locator('#app-check-button')).to_be_enabled(timeout=30000)
    page.locator('#app-check-button').click()
    wait_for_page_condition(page,'()=>document.querySelector("#app-update-status")?.dataset.status!=="checking"',40000)
    return page.locator('#app-update-status').get_attribute('data-status')

def archive(ref,target):
    cache=os.environ.get('QA_ARCHIVES')
    if cache:
        data=(Path(cache)/f'v{ref}.zip').read_bytes()
    else:
        sha={'3.3':'36abfdfec3e432e7a7ac7b41e425387cf00971fe','3.4':'8c6d09c8616f8f5633fe382137a573feff9f0237','3.5':'97225a681ca47f1df3dd7e5e8250f5987312d974'}[ref]
        data=subprocess.check_output(['git','archive','--format=zip',sha],cwd=ROOT)
    zipfile.ZipFile(io.BytesIO(data)).extractall(target)

def run(engine,browser):
  with tempfile.TemporaryDirectory(prefix='pista-final-qa-') as tmp:
    tmp=Path(tmp);roots={}
    for old in ['3.3','3.4','3.5']:
        dest=tmp/old/'Pista';archive(old,dest);roots[old]=dest.parent
    current=tmp/'current'/'Pista'
    shutil.copytree(ROOT,current,ignore=shutil.ignore_patterns('.git','test-results','node_modules','__pycache__'))
    roots['current']=current.parent
    release=json.loads((current/'version.json').read_text())
    future=tmp/'future'/'Pista';shutil.copytree(current,future)
    package=json.loads((future/'package.json').read_text());package['version']='3.5.99-qa'
    (future/'package.json').write_text(json.dumps(package))
    with (future/'styles.css').open('a') as f:f.write('\n/* isolated release-switch test */\n:root{--qa-release:future}\n')
    subprocess.run(['node','scripts/build-release.mjs'],cwd=future,check=True,capture_output=True)
    roots['future']=future.parent
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);server.release_directory=roots['current'];server.broken=False
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}/Pista/index.html#plan'
    def context():return browser.new_context(viewport={'width':390,'height':844},locale='de-DE',timezone_id='Europe/Berlin',reduced_motion='reduce',accept_downloads=True)
    ctx=context();page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(url);expect(page.locator('main [data-action="open"]').first).to_be_visible()
    wait_for_page_condition(page,'()=>navigator.serviceWorker.controller!==null')

    def rapid_actions():
        select(page)
        ids=page.locator('main [data-action="done"]').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.id)')
        before=flags(page)
        start=time.monotonic()
        for batch in range(10):
            page.evaluate('''() => {for(let i=0;i<100;i++){
                const buttons=document.querySelectorAll('main [data-action="done"]');buttons[i%buttons.length].click();
            }}''')
        after=flags(page)
        for i,k in enumerate(ids):
            assert after[k][0]==before.get(k,(False,'',None))[0],(k,after[k])
        preserved=flags(page)
        page.reload();select(page);assert flags(page)==preserved
        return {'toggle_events':1000,'wall_seconds':round(time.monotonic()-start,2),'survived_reload':True}
    check(engine,'1000 rapid whole-day toggles, rest days included, and reload',rapid_actions)

    def navigation_stress():
        select(page)
        page.evaluate('''()=>{for(let i=0;i<300;i++){
          const weeks=document.querySelectorAll('[data-action="tracker-week"]');weeks[i%weeks.length].click();
          if(document.querySelectorAll('main [data-workout-id]').length!==7)throw Error('Missing day');
        }}''')
        for batch in range(5):
            page.evaluate('''()=>{for(let i=0;i<20;i++){
              document.querySelector('main [data-action="open"]').click();
              if(document.querySelectorAll('#modal [data-step],#modal input[type="checkbox"]').length)throw Error('Exercise checkbox');
              document.querySelector('#modal [data-action="close"]').click();
            }}''')
        assert not errors,errors
        return {'week_switches':300,'workout_open_close_cycles':100}
    check(engine,'Repeated week navigation and workout dialogs',navigation_stress)

    def viewports():
        select(page)
        for width in [320,360,390,768,1024,1920]:
            page.set_viewport_size({'width':width,'height':844})
            for view in ['plan','progress']:
                page.locator(f'nav:visible [data-view="{view}"]').click()
                assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),(width,view)
        page.set_viewport_size({'width':390,'height':844});select(page)
        page.screenshot(path=str(OUT/f'{engine}-mobile.png'),full_page=True)
        page.get_by_role('button',name='Workout anzeigen',exact=True).first.click()
        page.keyboard.press('Escape');expect(page.locator('#modal')).not_to_be_visible()
        assert page.evaluate('document.activeElement?.dataset.action')=='open'
        page.set_viewport_size({'width':1920,'height':1080});page.screenshot(path=str(OUT/f'{engine}-desktop.png'),full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        return {'viewport_widths':[320,360,390,768,1024,1920],'views':2,'escape_focus':True}
    check(engine,'Mobile/tablet/desktop overflow, keyboard escape and focus',viewports)

    def multi_tab():
        select(page);other=ctx.new_page();other.goto(url);select(other)
        a='tpab-2026-11-11-a';b='tpab-2026-11-14-b'
        for roundno in range(30):
            at=page.evaluate('Date.now()')+100
            for target,k in [(page,a),(other,b)]:
                target.evaluate('''({id,at})=>{setTimeout(()=>{
                  document.querySelector(`[data-action="done"][data-id="${id}"]`).click();
                },Math.max(0,at-Date.now()));}''',{'id':k,'at':at})
            time.sleep(.15)
            expected=(roundno%2==0)
            current=flags(page)
            assert current[a][0]==expected and current[b][0]==expected,{'round':roundno,'state':current}
        other.close();return {'simultaneous_pairs':30,'lost_changes':0}
    check(engine,'Concurrent edits in two tabs',multi_tab)

    def offline_cycles():
        select(page);k='tpab-2026-11-11-a'
        for _ in range(5):
            ctx.set_offline(True);page.reload();select(page)
            page.locator(f'[data-action="done"][data-id="{k}"]').click();expected=flags(page)
            page.reload();select(page);assert flags(page)==expected
            ctx.set_offline(False);assert refresh_check(page)=='current'
        ctx.set_offline(False)
        return {'offline_reload_edit_reconnect_cycles':5}
    check(engine,'Five offline editing/reload/reconnect cycles',offline_cycles)
    ctx.set_offline(False)

    def pdf_matrix():
        select(page);before=flags(page)
        docs=page.evaluate('''async()=>{
          const {createTrainingPDF}=await import('./pdf.js');const s=JSON.parse(localStorage.getItem('pista.state.v1'));
          s.progress[s.plan.workouts[0].id]={done:true,note:'PRIVATE_QA_NOTE_MUST_NOT_EXPORT',steps:{}};
          const out=[];
          for(const mode of ['week','fortnight','month','all'])for(const layout of ['overview','checklist'])for(const details of [false,true]){
            const r=createTrainingPDF(s,mode,'2026-11-09',{layout,details,notes:true});
            out.push({mode,layout,details,pages:r.pageCount,bytes:Array.from(r.bytes)});
          }return out;
        }''')
        for i,item in enumerate(docs):
            data=bytes(item.pop('bytes'));path=OUT/f'{engine}-{item["mode"]}-{item["layout"]}-{item["details"]}.pdf';path.write_bytes(data)
            doc=fitz.open(stream=data,filetype='pdf');assert doc.page_count==item['pages']
            text=''.join(p.get_text() for p in doc);assert 'PRIVATE_QA_NOTE' not in text
            assert all(abs(p.rect.width-595.28)<1 and abs(p.rect.height-841.89)<1 for p in doc)
            for p in doc:
                for w in p.get_text('words'):
                    assert w[0]>=0 and w[1]>=0 and w[2]<=p.rect.width+.5 and w[3]<=p.rect.height+.5,(path,w)
            if item['layout']=='checklist':assert b'% checkbox checked' not in data
            if i in [2,3]:doc[0].get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(OUT/f'{engine}-pdf-{i}.png')
        assert flags(page)==before
        page.locator('nav:visible [data-view="progress"]').click();page.locator('[data-action="export"]').click()
        with page.expect_download() as download:page.locator('[data-action="export-pdf"]').click()
        download.value.save_as(OUT/f'{engine}-actual-download.pdf')
        assert (OUT/f'{engine}-actual-download.pdf').stat().st_size>1000
        return {'export_variations':16,'real_download':True,'all_A4':True,'no_personal_notes':True}
    check(engine,'All 16 PDF combinations, bounds, blank day boxes and actual download',pdf_matrix)

    def separate_devices():
        select(page);k='tpab-2026-11-11-a'
        if not flags(page).get(k,(False,))[0]:page.locator(f'[data-action="done"][data-id="{k}"]').click()
        second=context();p2=second.new_page();p2.goto(url);select(p2)
        present=flags(p2).get(k,(False,))[0];second.close()
        assert present is False,'New behavior: investigate live cloud implementation'
        limitation={'browser':engine,'requirement':'Automatic cross-device progress sync','status':'NOT IMPLEMENTED','observation':'A second isolated browser profile does not receive the first profile\'s checkmarks. No login/backend is deployed.'}
        LIMITS.append(limitation);return limitation
    check(engine,'Separate device profiles: explicitly verify the existing storage boundary',separate_devices)
    ctx.close()

    def release_cycles():
        server.release_directory=roots['3.3'];c=context();p=c.new_page();p.goto(url)
        wait_for_page_condition(p,'()=>navigator.serviceWorker.controller!==null')
        select(p);a='tpab-2026-11-11-a';b='tpab-2026-11-10-rest'
        p.locator(f'[data-action="done"][data-id="{a}"]').click();p.locator(f'[data-action="done"][data-id="{b}"]').click()
        expected=flags(p);progress_history={k:v for k,v in expected.items() if v[0]}
        p.evaluate('localStorage.setItem("qa-unrelated-data","KEEP")')
        done_dist=next(w for w in stored(p)['plan']['workouts'] if w['id']==a)
        results=[]
        for version in ['current','3.4','current','3.3','current']:
            server.release_directory=roots[version]
            assert refresh_check(p)=='available',(version,p.locator('#app-update-status').inner_text())
            with p.expect_navigation(wait_until='domcontentloaded'):p.locator('#app-apply-button').click()
            expect(p.locator('main [data-action="open"]').first).to_be_visible()
            assert p.evaluate(WORKER_VERSION)['id']==json.loads((roots[version]/'Pista'/'version.json').read_text())['id']
            current_flags=flags(p)
            for k,v in progress_history.items():assert current_flags.get(k)==v,(version,k,current_flags.get(k),v)
            assert p.evaluate('localStorage.getItem("qa-unrelated-data")')=='KEEP'
            assert next(w for w in stored(p)['plan']['workouts'] if w['id']==a)['title']==done_dist['title']
            select(p);p.locator(f'[data-action="done"][data-id="{b}"]').click();p.locator(f'[data-action="done"][data-id="{b}"]').click()
            progress_history=flags(p)
            p.reload();select(p)
            c.set_offline(True);p.reload();select(p);c.set_offline(False)
            for k,v in progress_history.items():assert flags(p).get(k)==v,(version,'reload',k)
            results.append(version)
        c.close();server.release_directory=roots['current'];return {'historical_releases':['3.3','3.4','3.5'],'switches':results,'offline_checks':5,'data_preserved':True}
    check(engine,'Actual 3.3 / 3.4 / current upgrade and downgrade cycles with writes',release_cycles)
    server.release_directory=roots['current'];server.broken=False

    def partial_deploy():
        c=context();p=c.new_page();p.goto(url);wait_for_page_condition(p,'()=>navigator.serviceWorker.controller!==null');select(p)
        p.locator('[data-action="done"][data-id="tpab-2026-11-11-a"]').click();expected=flags(p)
        server.release_directory=roots['future'];server.broken=True
        status=refresh_check(p);assert status=='error',status
        assert p.evaluate(WORKER_VERSION)['id']==release['id']
        p.reload();select(p);assert flags(p)==expected
        server.broken=False
        assert refresh_check(p)=='available'
        c.set_offline(True)
        with p.expect_navigation(wait_until='domcontentloaded'):p.locator('#app-apply-button').click()
        expect(p.locator('main [data-action="open"]').first).to_be_visible();select(p)
        assert flags(p)==expected
        assert p.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--qa-release").trim()')=='future'
        c.set_offline(False);c.close();server.release_directory=roots['current']
        return {'503_during_install':'old_release_retained','retry':'success','offline_apply':'success'}
    check(engine,'Interrupted deployment, retry and applying a downloaded update offline',partial_deploy)
    server.release_directory=roots['current'];server.broken=False

    def quota_recovery():
        c=context();p=c.new_page();p.goto(url);select(p)
        p.evaluate('''()=>{window.qaSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='pista.state.v1')throw new DOMException('test quota','QuotaExceededError');return window.qaSet.call(this,k,v)}}''')
        p.locator('[data-action="done"][data-id="tpab-2026-11-11-a"]').click()
        expect(p.locator('#save-status')).to_have_text('Nicht gespeichert');expect(p.locator('#storage-warning')).to_be_visible()
        with p.expect_download() as d:p.locator('#storage-warning [data-action="backup"]').click()
        path=OUT/f'{engine}-quota-rescue.json';d.value.save_as(path)
        rescued=json.loads(path.read_text());assert rescued['state']['progress']['tpab-2026-11-11-a']['done']
        p.evaluate('Storage.prototype.setItem=window.qaSet')
        p.locator('[data-action="done"][data-id="tpab-2026-11-14-b"]').click()
        expect(p.locator('#save-status')).to_have_text('Lokal gespeichert');p.reload();select(p)
        assert flags(p)['tpab-2026-11-11-a'][0] and flags(p)['tpab-2026-11-14-b'][0]
        c.close();return {'visible_warning':True,'rescue_download':True,'storage_recovery':True}
    check(engine,'Storage-full failure, rescue download and retry without losing session edits',quota_recovery)
    server.shutdown()

if __name__=='__main__':
    with sync_playwright() as p:
        for engine in os.environ.get('QA_ENGINES','chromium,webkit,firefox').split(','):
            browser=getattr(p,engine).launch(headless=True);VERSIONS[engine]=browser.version
            try:run(engine,browser)
            finally:browser.close();write_report()
    print(json.dumps({'passed':len(RESULTS),'failed':len(FAILURES),'known_limits':len(LIMITS)}),flush=True)
    raise SystemExit(bool(FAILURES))
