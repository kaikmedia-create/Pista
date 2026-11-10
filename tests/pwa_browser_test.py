"""Real, isolated service-worker updates; no changes to the public site or user data.

The synthetic release pair exercises cache replacement; the archived published
v3.5 release also exercises a real old app and plan migration. All browser data is
synthetic and isolated from customer profiles.
"""
from __future__ import annotations

import http.server
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import tarfile
import threading
import time

from playwright.sync_api import expect


PUBLISHED_V35_ARCHIVE_SHA256 = '0afb8db74f2f2fc1e22a1f3509d675c46d897face686be4990763aa04e412ee0'
PUBLISHED_V35_RELEASE = 'ce9fc764a93267a974b6f1f0a0d959ba4636729327c081f6c5162c5bc7609bbb'
# Keep the plan migration's date gate deterministic when CI runs after this block.
MIGRATION_CLOCK = """(() => {
    const OriginalDate=Date, now=OriginalDate.parse('2026-11-10T12:00:00+01:00');
    globalThis.Date=class extends OriginalDate {
        constructor(...args){super(...(args.length?args:[now]));}
        static now(){return now;}
    };
})();"""


WORKER_VERSION = """async () => {
    const worker=navigator.serviceWorker.controller;
    if(!worker)return null;
    return await new Promise(resolve => {
        const channel=new MessageChannel();
        const timer=setTimeout(()=>{channel.port1.close();resolve(null);},3000);
        channel.port1.onmessage=event=>{
            clearTimeout(timer);channel.port1.close();resolve(event.data);
        };
        worker.postMessage({type:'GET_VERSION'},[channel.port2]);
    });
}"""

# The previously published v3.1 lifecycle: eager activation and a network-first
# app shell, with no version-message protocol. Keep this fixture independent of
# the new worker so the first real customer upgrade is exercised as well.
LEGACY_WORKER = """
const CACHE='pista-shell-v3.1-daily';
const ASSETS=['./','./index.html','./styles.css','./refinements.css','./tracker.css','./tracker-view.js','./app.js','./core.js','./training-plan.js','./pdf.js','./logo.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pista-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  event.respondWith((async()=>{
    try{const response=await fetch(event.request,{cache:'no-cache'});if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone()).catch(()=>{});}return response;}
    catch{const cached=await caches.match(event.request);if(cached)return cached;if(event.request.mode==='navigate'){const shell=await caches.match(new URL('./index.html',self.registration.scope).href);if(shell)return shell;}return new Response('Offline nicht verfügbar',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
  })());
});
"""


class ReleaseHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        self.directory = str(self.server.release_directory)
        return super().translate_path(path)

    def end_headers(self):
        # Real SW CacheStorage still applies. HTTP caching cannot disguise the
        # server's release switch or turn this into a test of the browser cache.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


def wait_for_page_condition(page, predicate, timeout_ms=30000):
    """Poll through the browser's Runtime API without page-side eval.

    Playwright's wait_for_function compiles its predicate inside the document,
    which the production CSP correctly rejects. Keep that CSP active and wait
    from Python instead; each predicate is an explicit arrow function.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        if page.evaluate(predicate):
            return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AssertionError(f'Page condition timed out: {predicate}')
        time.sleep(min(0.1, remaining))


def make_releases(root: Path, parent: Path):
    release = json.loads((root / 'version.json').read_text())
    paths = set(release['assets']) | {
        'version.js', 'version.json', 'sw.js', 'package.json',
        'scripts/build-release.mjs',
    }
    roots = {}
    for name in ('previous', 'current', 'legacy'):
        directory = parent / name / 'Pista'
        for relative in paths:
            target = directory / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / relative, target)
        roots[name] = directory

    previous = roots['previous']
    package = json.loads((previous / 'package.json').read_text())
    package['version'] = '0.0.1'
    (previous / 'package.json').write_text(json.dumps(package))
    index = (previous / 'index.html').read_text()
    assert '<html lang="de">' in index
    (previous / 'index.html').write_text(index.replace(
        '<html lang="de">', '<html lang="de" data-pwa-test-release="previous">', 1))
    with (previous / 'styles.css').open('a') as file:
        file.write('\n:root{--pwa-test-release:previous}\n')
    built = subprocess.run(
        ['node', 'scripts/build-release.mjs'], cwd=previous,
        text=True, capture_output=True, check=True,
    )
    previous_release = json.loads((previous / 'version.json').read_text())
    assert previous_release['id'] != release['id'], built.stdout
    (roots['legacy'] / 'sw.js').write_text(LEGACY_WORKER)
    return roots, previous_release, release


def restore_published_v35(root: Path, parent: Path):
    """Restore the actual shipped app, not a current app with an older label.

    This compressed fixture is the public release at commit 97225a681ca47f1df3dd7e5e8250f5987312d974.
    It contains app assets only and never contains a customer's browser state.
    Archive and release-asset hashes prevent fixture drift from weakening the test.
    """
    archive = root / 'tests/fixtures/pista-v35-release.tar.gz'
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == PUBLISHED_V35_ARCHIVE_SHA256
    target = parent / 'published-v35' / 'Pista'
    with tarfile.open(archive, 'r:gz') as source:
        for member in source.getmembers():
            relative = Path(member.name)
            assert member.isfile() and not relative.is_absolute() and '..' not in relative.parts
            path = target / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(source.extractfile(member).read())
    release = json.loads((target / 'version.json').read_text())
    assert release['version'] == '3.5.0' and release['id'] == PUBLISHED_V35_RELEASE
    for relative, digest in release['assets'].items():
        assert hashlib.sha256((target / relative).read_bytes()).hexdigest() == digest
    return target


def run_published_plan_upgrade(browser, engine, root, out, server, url, current_root, current_release):
    """Exercise the user's real R3 -> R4 path, including an old second tab."""
    previous = restore_published_v35(root, current_root.parent.parent)
    server.release_directory = previous.parent
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE',
                              timezone_id='Europe/Berlin', reduced_motion='reduce', accept_downloads=True)
    ctx.add_init_script(MIGRATION_CLOCK)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def raw(target=page):
        return target.evaluate('() => localStorage.getItem("pista.state.v1")')

    def close(target=page):
        target.locator('#modal [data-action="close"]').click()

    def open_week(target, week):
        target.locator(f'[data-action="tracker-week"][data-date="{week}"]').click()

    def assert_user_data(before, after, edited_note=None):
        for key in ('title', 'description', 'targetDate', 'targetLabel', 'goalSummary'):
            assert after['plan'][key] == before['plan'][key], ('plan metadata', key)
        for wid, progress in before['progress'].items():
            actual = after['progress'][wid]
            for key in ('done', 'note', 'completedAt'):
                expected = edited_note if wid == 'tpab-2026-11-10-rest' and key == 'note' and edited_note else progress[key]
                assert actual[key] == expected, (wid, key)
            for step_id, value in progress['steps'].items():
                if value:
                    assert actual['steps'].get(step_id) is True, ('legacy step flag', wid, step_id)
        old = {w['id']: w for w in before['plan']['workouts']}
        new = {w['id']: w for w in after['plan']['workouts']}
        for wid in ('tpab-2026-11-11-a', 'tpab-2026-11-10-rest',
                    'tpab-2026-11-18-a', 'tpab-2026-11-21-b', 'test-personal-session'):
            assert new[wid] == old[wid], ('protected workout changed', wid)
        assert 'tpab-2026-11-25-a' not in new, 'A deliberately removed session must not reappear'

    try:
        page.goto(url)
        wait_for_page_condition(page, '() => navigator.serviceWorker.controller !== null')
        assert page.evaluate(WORKER_VERSION)['id'] == PUBLISHED_V35_RELEASE
        assert json.loads(raw())['plan']['revision'] == 3
        open_week(page, '2026-11-09')
        for wid in ('tpab-2026-11-11-a', 'tpab-2026-11-10-rest'):
            page.locator(f'[data-action="done"][data-id="{wid}"]').click()
        page.locator('[data-action="open"][data-id="tpab-2026-11-11-a"]').click()
        page.locator('#workout-note').fill('Erledigter Lauf: Grüße, Ä/Ö/Ü und ß.\nZweite Zeile bleibt.')
        close()
        page.locator('[data-action="open"][data-id="tpab-2026-11-14-b"]').click()
        page.locator('#workout-note').fill('Offenes Training mit Notiz, vor dem Update geschrieben.')
        close()
        page.evaluate("""() => {
            const state=JSON.parse(localStorage.getItem('pista.state.v1'));
            state.plan.description='Meine persönlich angepasste Planbeschreibung.';
            state.plan.targetLabel='Persönliches Testziel';
            state.plan.targetDate='2027-07-15';
            state.plan.workouts.find(w=>w.id==='tpab-2026-11-18-a').date='2026-11-19';
            state.plan.workouts.find(w=>w.id==='tpab-2026-11-21-b').description='Diese Einheit wurde persönlich angepasst.';
            state.plan.workouts=state.plan.workouts.filter(w=>w.id!=='tpab-2026-11-25-a');
            const own=structuredClone(state.plan.workouts.find(w=>w.id==='tpab-2026-11-13-rest'));
            own.id='test-personal-session';own.title='Persönliche Zusatzeinheit';own.type='mobility';
            own.steps=[{id:'own-step',title:'Eigene Übung',details:'Persönliche Anleitung bleibt.'}];
            state.plan.workouts.push(own);
            state.progress[own.id]={done:false,steps:{'own-step':true},note:'Eigene Notiz',completedAt:null};
            localStorage.setItem('pista.state.v1',JSON.stringify(state));
        }""")
        page.reload()
        expect(page.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
        second = ctx.new_page()
        second.on('pageerror', lambda error: errors.append(str(error)))
        second.goto(url)
        wait_for_page_condition(second, '() => navigator.serviceWorker.controller !== null')
        open_week(second, '2026-11-09')
        second.locator('[data-action="open"][data-id="tpab-2026-11-10-rest"]').click()
        second.locator('#workout-note').fill('Notiz im alten zweiten Tab bleibt geöffnet.')
        second.evaluate("window.pistaOldTabMarker='still open'")
        page.evaluate("""() => {
            localStorage.setItem('pista.previous.v1','Vorherige Importsicherung bleibt unverändert');
            localStorage.setItem('unrelated-test-data','Fremde Daten bleiben');
        }""")
        before_raw = raw()
        before = json.loads(before_raw)
        server.release_directory = current_root.parent
        page.locator('#data-button').click()
        expect(page.locator('#app-check-button')).to_be_enabled(timeout=30000)
        page.locator('#app-check-button').click()
        expect(page.locator('#app-update-status')).to_have_attribute('data-status', 'available', timeout=30000)
        assert raw() == before_raw
        assert second.evaluate('window.pistaOldTabMarker') == 'still open'
        with page.expect_navigation(wait_until='domcontentloaded', timeout=30000):
            page.locator('#app-apply-button').click()
        expect(page.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
        assert page.evaluate(WORKER_VERSION)['id'] == current_release['id']
        upgraded = json.loads(raw())
        assert upgraded['plan']['revision'] >= 4
        assert_user_data(before, upgraded)
        assert page.evaluate('() => localStorage.getItem("pista.plan-review.previous.r4")') == before_raw
        assert page.evaluate('() => localStorage.getItem("pista.previous.v1")') == 'Vorherige Importsicherung bleibt unverändert'
        assert page.evaluate('() => localStorage.getItem("unrelated-test-data")') == 'Fremde Daten bleiben'
        old_open = next(w for w in before['plan']['workouts'] if w['id'] == 'tpab-2026-11-14-b')
        new_open = next(w for w in upgraded['plan']['workouts'] if w['id'] == 'tpab-2026-11-14-b')
        assert new_open != old_open, 'An eligible open session must receive the new exercises'
        expect(second.locator('#workout-note')).to_have_value('Notiz im alten zweiten Tab bleibt geöffnet.')
        assert second.evaluate('window.pistaOldTabMarker') == 'still open'
        edited_note = 'Nach dem Update noch im alten Tab ergänzt: nichts verlieren.'
        second.locator('#workout-note').fill(edited_note)
        assert_user_data(before, json.loads(raw()), edited_note)
        expect(second.locator('#app-update-banner')).to_be_visible(timeout=15000)
        close(second)
        with second.expect_navigation(wait_until='domcontentloaded', timeout=30000):
            second.locator('#app-update-banner-button').click()
        expect(second.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
        assert second.evaluate(WORKER_VERSION)['id'] == current_release['id']
        assert_user_data(before, json.loads(raw()), edited_note)
        preserved = raw()
        ctx.set_offline(True)
        page.reload()
        expect(page.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
        assert raw() == preserved, 'Reload after a completed migration must be idempotent'
        open_week(page, '2026-11-09')
        page.locator('[data-action="open"][data-id="tpab-2026-11-14-b"]').click()
        expect(page.locator('#workout-note')).to_have_value(before['progress']['tpab-2026-11-14-b']['note'])
        page.screenshot(path=str(out / f'{engine}-published-v35-upgrade.png'), full_page=True)
        assert not errors, errors
    finally:
        ctx.close()
        server.release_directory = current_root.parent


def run_migration_backup_failure(browser, engine, root, out, server, url, current_root, current_release):
    """A quota error must not overwrite the previous plan or discard progress."""
    previous = restore_published_v35(root, current_root.parent.parent)
    server.release_directory = previous.parent
    ctx = browser.new_context(locale='de-DE', timezone_id='Europe/Berlin', accept_downloads=True)
    ctx.add_init_script(MIGRATION_CLOCK)
    ctx.add_init_script("""(() => {
        const original=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){
            if(key==='pista.plan-review.previous.r4'&&sessionStorage.getItem('test-allow-migration')!=='yes')
                throw new DOMException('Test quota exhausted','QuotaExceededError');
            return original.call(this,key,value);
        };
    })();""")
    page = ctx.new_page()
    try:
        page.goto(url)
        wait_for_page_condition(page, '() => navigator.serviceWorker.controller !== null')
        page.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
        page.locator('[data-action="open"][data-id="tpab-2026-11-11-a"]').click()
        page.locator('#workout-note').fill('Diese Notiz bleibt bei vollem Speicher erhalten.')
        page.locator('#detail-done').click()
        page.locator('#modal [data-action="close"]').click()
        before = page.evaluate('() => localStorage.getItem("pista.state.v1")')
        server.release_directory = current_root.parent
        page.locator('#data-button').click()
        expect(page.locator('#app-check-button')).to_be_enabled(timeout=30000)
        page.locator('#app-check-button').click()
        expect(page.locator('#app-update-status')).to_have_attribute('data-status', 'available', timeout=30000)
        with page.expect_navigation(wait_until='domcontentloaded', timeout=30000):
            page.locator('#app-apply-button').click()
        expect(page.locator('#storage-warning')).to_be_visible()
        assert page.evaluate(WORKER_VERSION)['id'] == current_release['id']
        assert page.evaluate('() => localStorage.getItem("pista.state.v1")') == before
        with page.expect_download() as event:
            page.locator('#storage-warning [data-action="backup"]').click()
        backup = json.loads(Path(event.value.path()).read_text())['state']
        for wid, progress in json.loads(before)['progress'].items():
            assert backup['progress'][wid]['done'] == progress['done']
            assert backup['progress'][wid]['note'] == progress['note']
        page.evaluate("sessionStorage.setItem('test-allow-migration','yes')")
        page.reload()
        expect(page.locator('#storage-warning')).to_be_hidden()
        saved = json.loads(page.evaluate('() => localStorage.getItem("pista.state.v1")'))
        assert saved['plan']['revision'] >= 4
        assert saved['progress']['tpab-2026-11-11-a']['done']
        assert saved['progress']['tpab-2026-11-11-a']['note'] == 'Diese Notiz bleibt bei vollem Speicher erhalten.'
        assert page.evaluate('() => localStorage.getItem("pista.plan-review.previous.r4")') == before
    except Exception:
        page.screenshot(path=str(out / f'FAIL-{engine}-migration-storage.png'), full_page=True)
        raise
    finally:
        ctx.close()
        server.release_directory = current_root.parent


def run_storage_race_guards(browser, engine, out, server, url, roots, previous_release):
    """A stale session must never overwrite another tab after a failed write."""
    server.release_directory = roots['previous'].parent
    ctx = browser.new_context(locale='de-DE', timezone_id='Europe/Berlin', accept_downloads=True)
    ctx.add_init_script(MIGRATION_CLOCK)
    first = ctx.new_page()

    def select_workout(page, wid):
        page.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
        page.locator(f'[data-action="open"][data-id="{wid}"]').click()

    try:
        first.goto(url)
        wait_for_page_condition(first, '() => navigator.serviceWorker.controller !== null')
        assert first.evaluate(WORKER_VERSION)['id'] == previous_release['id']
        select_workout(first, 'tpab-2026-11-11-a')
        first.locator('#workout-note').fill('Vor dem Speicherfehler gesichert.')
        second = ctx.new_page()
        second.goto(url)
        select_workout(second, 'tpab-2026-11-14-b')
        first.evaluate("""() => {
            window.originalStorageWrite=Storage.prototype.setItem;
            Storage.prototype.setItem=function(key,value){
                if(key==='pista.state.v1')throw new DOMException('Test storage full','QuotaExceededError');
                return window.originalStorageWrite.call(this,key,value);
            };
            window.storageFailureDocument='must stay open';
        }""")
        first.locator('#workout-note').fill('Ungespeicherte Notiz bleibt für eine Sicherung in der Sitzung.')
        expect(first.locator('#save-status')).to_have_text('Nicht gespeichert')
        second.locator('#workout-note').fill('Neuer gespeicherter Stand aus dem zweiten Tab.')
        newer = second.evaluate('() => localStorage.getItem("pista.state.v1")')
        first.evaluate('Storage.prototype.setItem=window.originalStorageWrite')
        first.locator('#workout-note').fill('Nach Erholung weitergeschrieben: weiterhin nur in dieser Sitzung.')
        assert first.evaluate('() => localStorage.getItem("pista.state.v1")') == newer
        expect(first.locator('#save-status')).to_have_text('Nicht gespeichert')
        expect(second.locator('#workout-note')).to_have_value('Neuer gespeicherter Stand aus dem zweiten Tab.')
        first.locator('#modal [data-action="close"]').click()
        with first.expect_download() as event:
            first.locator('#storage-warning [data-action="backup"]').click()
        backup = json.loads(Path(event.value.path()).read_text())['state']
        assert backup['progress']['tpab-2026-11-11-a']['note'] == 'Nach Erholung weitergeschrieben: weiterhin nur in dieser Sitzung.'
        server.release_directory = roots['current'].parent
        first.locator('#data-button').click()
        expect(first.locator('#app-check-button')).to_be_enabled(timeout=30000)
        first.locator('#app-check-button').click()
        expect(first.locator('#app-update-status')).to_have_attribute('data-status', 'available', timeout=30000)
        first.locator('#app-apply-button').click()
        expect(first.locator('#toast')).to_contain_text('zuerst deine Daten sichern')
        assert first.evaluate('window.storageFailureDocument') == 'must stay open'
        assert first.evaluate(WORKER_VERSION)['id'] == previous_release['id']
        assert first.evaluate('() => localStorage.getItem("pista.state.v1")') == newer
        first.screenshot(path=str(out / f'{engine}-storage-race-protected.png'), full_page=True)
    finally:
        ctx.close()
        server.release_directory = roots['current'].parent

    # These writes deliberately happen in the same document so no storage event
    # announces them. latest() must detect the changed value immediately before
    # a user mutation, including empty data and a removed storage key.
    guarded = browser.new_context(locale='de-DE', timezone_id='Europe/Berlin')
    guarded.add_init_script(MIGRATION_CLOCK)
    page = guarded.new_page()
    try:
        page.goto(url)
        select_workout(page, 'tpab-2026-11-11-a')
        page.locator('#workout-note').fill('Letzte gültige Notiz bleibt verfügbar.')
        valid = page.evaluate('() => localStorage.getItem("pista.state.v1")')
        for broken in ('{broken', '', None):
            page.evaluate("""value => {
                if(value===null)localStorage.removeItem('pista.state.v1');
                else localStorage.setItem('pista.state.v1',value);
            }""", broken)
            page.locator('#workout-note').fill('Darf ungültige oder gelöschte Daten nicht überschreiben.')
            expect(page.locator('#storage-warning')).to_be_visible()
            assert page.evaluate('() => localStorage.getItem("pista.state.v1")') == broken
            page.locator('#detail-done').click()
            assert page.evaluate('() => localStorage.getItem("pista.state.v1")') == broken
            expect(page.locator('#workout-note')).to_have_value('Letzte gültige Notiz bleibt verfügbar.')
            page.evaluate("value => localStorage.setItem('pista.state.v1',value)", valid)
            page.reload()
            select_workout(page, 'tpab-2026-11-11-a')
    finally:
        guarded.close()


def run_pwa_checks(browser, engine, root, out, check):
    with tempfile.TemporaryDirectory(prefix='pista-update-') as directory:
        roots, previous_release, current_release = make_releases(root, Path(directory))
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ReleaseHandler)
        server.release_directory = roots['previous'].parent
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{server.server_port}/Pista/index.html#plan'
        ctx = browser.new_context(
            viewport={'width': 390, 'height': 844}, locale='de-DE',
            timezone_id='Europe/Berlin', reduced_motion='reduce',
        )
        # Native OS installation is outside headless browser automation. Keep
        # automatic browser prompts out of the fixture; exercise the documented
        # beforeinstallprompt callback explicitly below, without claiming an OS install.
        ctx.add_init_script("""window.addEventListener('beforeinstallprompt', event=>{
            if(event.isTrusted){event.preventDefault();event.stopImmediatePropagation();}
        },{capture:true});""")
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        second = None
        saved = {}

        def open_settings(target=page):
            target.locator('#data-button').click()
            expect(target.locator('#app-update-status')).to_be_visible()

        def close_modal(target=page):
            target.locator('#modal [data-action="close"]').click()

        def stored_data(target=page):
            return target.evaluate("""() => ({
                state:localStorage.getItem('pista.state.v1'),
                previous:localStorage.getItem('pista.previous.v1'),
                unrelated:localStorage.getItem('unrelated-test-data')
            })""")

        def ready():
            page.goto(url)
            expect(page.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
            wait_for_page_condition(page, '() => navigator.serviceWorker.controller !== null')
            assert page.evaluate(WORKER_VERSION)['id'] == previous_release['id']
            assert page.locator('html').get_attribute('data-pwa-test-release') == 'previous'
            assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--pwa-test-release').trim()") == 'previous'
            open_settings()
            expect(page.locator('#app-check-button')).to_be_enabled(timeout=30000)
            page.locator('#app-check-button').click()
            expect(page.locator('#app-update-status')).to_have_attribute('data-status', 'current', timeout=30000)
            expect(page.locator('#app-apply-button')).to_be_hidden()
            close_modal()

        def install_controls():
            open_settings()
            page.locator('#app-install-button').click()
            expect(page.locator('#modal-title')).to_have_text('Pista als Web-App nutzen')
            expect(page.locator('.app-install-steps')).to_contain_text('Safari')
            expect(page.locator('.app-install-steps')).to_contain_text('Home-Bildschirm')
            page.locator('#modal [data-action="data"]').click()
            assert page.evaluate("""() => {
                window.pistaTestPromptCalls=0;
                const event=new Event('beforeinstallprompt',{cancelable:true});
                Object.defineProperty(event,'prompt',{value:async()=>{
                    window.pistaTestPromptCalls++;
                    return {outcome:'accepted',platform:'web'};
                }});
                Object.defineProperty(event,'userChoice',{value:Promise.resolve({outcome:'accepted',platform:'web'})});
                window.dispatchEvent(event);
                return event.defaultPrevented;
            }""")
            page.locator('#app-install-button').click()
            wait_for_page_condition(page, '() => window.pistaTestPromptCalls === 1')
            page.evaluate("window.dispatchEvent(new Event('appinstalled'))")
            expect(page.locator('#app-install-button')).to_be_disabled()
            page.screenshot(path=str(out / f'{engine}-web-app-settings.png'), full_page=True)
            close_modal()

        def keep_data_before_update():
            nonlocal second
            page.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
            for workout in ('tpab-2026-11-11-a', 'tpab-2026-11-10-rest'):
                page.locator(f'[data-action="done"][data-id="{workout}"]').click()
                expect(page.locator(f'[data-action="done"][data-id="{workout}"]')).to_have_attribute('aria-pressed', 'true')
            page.locator('[data-action="open"][data-id="tpab-2026-11-11-a"]').click()
            page.locator('#workout-note').fill('Training bleibt nach dem App-Update erhalten.\nÄ, ö und ß.')
            close_modal()

            second = ctx.new_page()
            second.on('pageerror', lambda error: errors.append(str(error)))
            second.goto(url)
            wait_for_page_condition(second, '() => navigator.serviceWorker.controller !== null')
            open_settings(second)
            expect(second.locator('#app-update-status')).to_have_attribute('data-status', 'current', timeout=30000)
            close_modal(second)
            second.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
            second.locator('[data-action="open"][data-id="tpab-2026-11-10-rest"]').click()
            second.locator('#workout-note').fill('Auch die Ruhetagsnotiz bleibt im zweiten Tab.')
            second.evaluate("window.pistaTestDocumentMarker='second tab is still open'")
            page.evaluate("""async () => {
                localStorage.setItem('pista.previous.v1',localStorage.getItem('pista.state.v1'));
                localStorage.setItem('unrelated-test-data','keep this value');
                const cache=await caches.open('unrelated-test-cache');
                await cache.put(new Request(new URL('/unrelated-test-marker',location.origin)),new Response('keep this cache'));
            }""")
            saved.update(stored_data())
            data = json.loads(saved['state'])
            assert data['progress']['tpab-2026-11-11-a']['done']
            assert data['progress']['tpab-2026-11-10-rest']['done']
            assert data['progress']['tpab-2026-11-10-rest']['note'] == 'Auch die Ruhetagsnotiz bleibt im zweiten Tab.'

        def upgrade():
            server.release_directory = roots['current'].parent
            open_settings()
            expect(page.locator('#app-check-button')).to_be_enabled(timeout=30000)
            page.locator('#app-check-button').click()
            expect(page.locator('#app-update-status')).to_have_attribute('data-status', 'available', timeout=30000)
            expect(page.locator('#app-apply-button')).to_be_visible()
            # A discovered update must wait for the user; never activate/reload
            # another tab while its notes are open.
            assert page.evaluate(WORKER_VERSION)['id'] == previous_release['id']
            assert page.locator('html').get_attribute('data-pwa-test-release') == 'previous'
            assert second.evaluate('window.pistaTestDocumentMarker') == 'second tab is still open'
            assert stored_data() == saved
            page.screenshot(path=str(out / f'{engine}-update-ready.png'), full_page=True)
            with page.expect_navigation(wait_until='domcontentloaded', timeout=30000):
                page.locator('#app-apply-button').click()
            expect(page.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
            assert page.evaluate(WORKER_VERSION)['id'] == current_release['id']
            assert page.locator('html').get_attribute('data-pwa-test-release') is None
            assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--pwa-test-release').trim()") == ''
            assert stored_data() == saved
            # The update only replaces Pista's app files, not local plans,
            # backups, unrelated storage or another application's cache.
            assert page.evaluate("async () => (await caches.keys()).includes('unrelated-test-cache')")
            assert second.evaluate('window.pistaTestDocumentMarker') == 'second tab is still open'
            expect(second.locator('#workout-note')).to_have_value('Auch die Ruhetagsnotiz bleibt im zweiten Tab.')
            expect(second.locator('#app-update-banner')).to_be_visible(timeout=15000)
            close_modal(second)
            with second.expect_navigation(wait_until='domcontentloaded', timeout=30000):
                second.locator('#app-update-banner-button').click()
            expect(second.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
            assert second.locator('html').get_attribute('data-pwa-test-release') is None
            assert second.evaluate(WORKER_VERSION)['id'] == current_release['id']
            assert stored_data(second) == saved

        def offline_after_update():
            ctx.set_offline(True)
            page.reload()
            expect(page.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
            assert page.locator('html').get_attribute('data-pwa-test-release') is None
            assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--pwa-test-release').trim()") == ''
            page.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
            for workout in ('tpab-2026-11-11-a', 'tpab-2026-11-10-rest'):
                expect(page.locator(f'[data-action="done"][data-id="{workout}"]')).to_have_attribute('aria-pressed', 'true')
            open_settings()
            expect(page.locator('#app-check-button')).to_be_enabled(timeout=30000)
            page.locator('#app-check-button').click()
            expect(page.locator('#app-update-status')).to_have_attribute('data-status', 'offline', timeout=15000)
            expect(page.locator('#app-update-status')).to_contain_text('Internet')
            assert stored_data() == saved
            ctx.set_offline(False)
            expect(page.locator('#app-check-button')).to_be_enabled(timeout=30000)
            page.locator('#app-check-button').click()
            expect(page.locator('#app-update-status')).to_have_attribute('data-status', 'current', timeout=30000)
            close_modal()
            assert not errors, errors

        def legacy_upgrade():
            # Simulate the first online opening of the new UI while the actual
            # old v3.1 worker still controls the already installed application.
            legacy_ctx = browser.new_context(
                viewport={'width': 390, 'height': 844}, locale='de-DE',
                timezone_id='Europe/Berlin', reduced_motion='reduce',
            )
            legacy = legacy_ctx.new_page()
            server.release_directory = roots['legacy'].parent
            try:
                legacy.goto(url)
                expect(legacy.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
                wait_for_page_condition(legacy, '() => navigator.serviceWorker.controller !== null')
                assert legacy.evaluate("async () => (await caches.keys()).includes('pista-shell-v3.1-daily')")
                legacy.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
                for workout in ('tpab-2026-11-11-a', 'tpab-2026-11-10-rest'):
                    legacy.locator(f'[data-action="done"][data-id="{workout}"]').click()
                legacy.locator('[data-action="open"][data-id="tpab-2026-11-10-rest"]').click()
                legacy.locator('#workout-note').fill('Vorhandene Notiz aus der bisher installierten App.')
                close_modal(legacy)
                legacy.evaluate("""() => {
                    localStorage.setItem('pista.previous.v1',localStorage.getItem('pista.state.v1'));
                    localStorage.setItem('unrelated-test-data','legacy storage stays');
                    window.pistaTestLegacyMarker='not reloaded yet';
                }""")
                old = stored_data(legacy)
                open_settings(legacy)
                # The old worker does not know GET_VERSION. Its status is not
                # allowed to prevent a manual check from discovering the new one.
                expect(legacy.locator('#app-check-button')).to_be_enabled(timeout=30000)
                server.release_directory = roots['current'].parent
                legacy.locator('#app-check-button').click()
                expect(legacy.locator('#app-update-status')).to_have_attribute('data-status', 'available', timeout=30000)
                assert legacy.evaluate('window.pistaTestLegacyMarker') == 'not reloaded yet'
                assert stored_data(legacy) == old
                with legacy.expect_navigation(wait_until='domcontentloaded', timeout=30000):
                    legacy.locator('#app-apply-button').click()
                expect(legacy.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
                assert legacy.evaluate(WORKER_VERSION)['id'] == current_release['id']
                assert stored_data(legacy) == old
                legacy_ctx.set_offline(True)
                legacy.reload()
                expect(legacy.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
                assert stored_data(legacy) == old
            except Exception:
                try:
                    legacy.screenshot(path=str(out / f'FAIL-{engine}-legacy-upgrade.png'), full_page=True)
                except Exception:
                    pass
                raise
            finally:
                legacy_ctx.close()
                server.release_directory = roots['current'].parent

        try:
            check(engine + ': real cached predecessor release and current-version update check', ready)
            check(engine + ': installation guidance and beforeinstallprompt callback (no OS installation claimed)', install_controls)
            check(engine + ': training/rest checks, notes and backup prepared in two real tabs', keep_data_before_update)
            check(engine + ': explicit service-worker upgrade preserves all data and never force-reloads another tab', upgrade)
            check(engine + ': upgraded app works offline and reports offline/current update status honestly', offline_after_update)
            check(engine + ': installed v3.1 network-first worker upgrades in place with checks, notes and backups intact', legacy_upgrade)
            check(engine + ': real published v3.5 upgrades its plan while preserving notes, checks, personal edits and a live old tab',
                  lambda: run_published_plan_upgrade(browser, engine, root, out, server, url, roots['current'], current_release))
            check(engine + ': failed migration backup preserves original data, permits export and retries safely',
                  lambda: run_migration_backup_failure(browser, engine, root, out, server, url, roots['current'], current_release))
            check(engine + ': failed writes cannot overwrite another tab or apply an update; corrupt/removed storage stays protected',
                  lambda: run_storage_race_guards(browser, engine, out, server, url, roots, previous_release))
        except Exception:
            for index, tab in enumerate(ctx.pages):
                try:
                    tab.screenshot(path=str(out / f'FAIL-{engine}-pwa-{index}.png'), full_page=True)
                except Exception:
                    pass
            raise
        finally:
            ctx.close()
            server.shutdown()
            server.server_close()
