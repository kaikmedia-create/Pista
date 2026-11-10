"""Real-browser checks for running progression and migration, using synthetic progress."""
from pathlib import Path
from datetime import datetime, timezone
import functools, http.server, tempfile, threading, json, os
from playwright.sync_api import sync_playwright, expect
from browser_test import QuietHandler
from pwa_browser_test import wait_for_page_condition
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'
OUT.mkdir(exist_ok=True)
results=[]
with tempfile.TemporaryDirectory() as served:
    Path(served,'Pista').symlink_to(ROOT,target_is_directory=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=served))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url=os.environ.get('PISTA_URL',f'http://127.0.0.1:{server.server_port}/Pista/')
    try:
        with sync_playwright() as p:
            for engine in ('chromium','webkit'):
                browser=getattr(p,engine).launch(headless=True)
                ctx=browser.new_context(viewport={'width':390,'height':844},locale='de-DE',timezone_id='Europe/Berlin',reduced_motion='reduce')
                page=ctx.new_page();errors=[]
                # Migration preserves past dates. Keep this fixture at the release date
                # so later CI runs exercise the same future workouts reproducibly.
                page.clock.set_fixed_time(datetime(2026,11,10,12,tzinfo=timezone.utc))
                page.on('pageerror',lambda error:errors.append(str(error)))
                try:
                    page.goto(url)
                    page.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
                    expect(page.locator('.by-week-volume')).to_contain_text('1 Intervalltraining')
                    expect(page.locator('.by-week-volume')).to_contain_text('8,0 km')
                    page.locator('[data-action="open"][data-id="tpab-2026-11-14-b"]').click()
                    expect(page.locator('#modal')).to_contain_text('4 × 200 m')
                    expect(page.locator('#modal')).to_contain_text('1,4 km locker einlaufen')
                    assert page.locator('#modal input[type="checkbox"],#modal [data-step]').count()==0
                    page.locator('#modal [data-action="close"]').click()
                    page.screenshot(path=str(OUT/f'{engine}-v35-first-week.png'),full_page=True)
                    page.locator('[data-action="tracker-week"][data-date="2027-01-25"]').click()
                    expect(page.locator('.by-week-volume')).to_contain_text('10,0 km')
                    page.locator('[data-action="open"][data-id="tpab-2027-01-30-b"]').click()
                    expect(page.locator('#modal')).to_contain_text('5 × 400 m')
                    expect(page.locator('#modal-title')).to_contain_text('5,0 km')
                    page.locator('#modal [data-action="close"]').click()
                    saved=page.evaluate('JSON.parse(localStorage.getItem("pista.state.v1"))')
                    assert sum(w['runKind']=='interval' for w in saved['plan']['workouts'])==12
                    assert not errors,errors
                    results.append(engine+': first and last week display genuine 4-to-5 km progression and weekly intervals')
                    old=json.loads((ROOT/'tests/fixtures/plan-v34.json').read_text())
                    progress={'tpab-2026-11-11-a':{'done':True,'steps':{},'note':'Migrationstest, kein echter Fortschritt','completedAt':'2026-11-11T10:00:00Z'},'tpab-2026-11-10-rest':{'done':True,'steps':{},'note':'Test','completedAt':'2026-11-10T10:00:00Z'}}
                    # Storage normalization materializes false legacy step flags.
                    # Seed the canonical v3.4 form so this assertion measures the
                    # migration itself rather than optional-key normalization.
                    expected_progress=page.evaluate('''async value => {
                        const {normalizeState}=await import('./core.js');
                        const canonical=normalizeState(value);
                        localStorage.setItem('pista.state.v1',JSON.stringify(canonical));
                        return canonical.progress;
                    }''',{'version':1,'plan':old,'progress':progress,'updatedAt':None})
                    for workout_id,original in progress.items():
                        for field in ('done','note','completedAt'):
                            assert expected_progress[workout_id][field]==original[field]
                    page.reload()
                    wait_for_page_condition(page,'()=>JSON.parse(localStorage.getItem("pista.state.v1")).plan.revision===4')
                    upgraded=page.evaluate('JSON.parse(localStorage.getItem("pista.state.v1"))')
                    assert upgraded['progress']==expected_progress
                    byid={w['id']:w for w in upgraded['plan']['workouts']}
                    assert byid['tpab-2026-11-11-a']['runDistanceKm']==3,'Completed history must not be inflated'
                    assert byid['tpab-2026-11-14-b']['runKind']=='interval'
                    assert byid['tpab-2026-11-14-b']['runDistanceKm']==4
                    assert byid['tpab-2027-01-13-a']['date']=='2027-01-15'
                    assert page.evaluate('localStorage.getItem("pista.plan-review.previous.r4")')
                    assert not errors,errors
                    results.append(engine+': real v3.4 browser storage upgrades without losing checks or rewriting completed distances')
                finally:
                    ctx.close();browser.close()
    finally:
        server.shutdown()
        (OUT/'running-v35-results.json').write_text(json.dumps({'passed':len(results),'checks':results},ensure_ascii=False,indent=2))
for result in results:print('PASS:',result)
