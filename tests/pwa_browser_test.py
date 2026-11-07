"""Real, isolated service-worker updates; no changes to the public site or user data.

Both releases use the production release builder and worker. The previous release
only changes its version and two visible markers, so the update must replace the
actual cached document and stylesheet as well as its version metadata.
"""
from __future__ import annotations

import http.server
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time

from playwright.sync_api import expect


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
