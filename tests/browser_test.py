"""End-to-end checks in isolated Chromium and WebKit contexts, under /Pista/."""
from __future__ import annotations
import functools
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
import traceback
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader
import fitz

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
results = []

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(name, fn):
    fn()
    results.append(name)
    print('PASS:', name, flush=True)


def run_browser(browser, engine, url):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', timezone_id='Europe/Berlin', reduced_motion='reduce', accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.goto(url)
    expect(page.get_by_role('button', name='Workout öffnen', exact=True).first).to_be_visible()
    today = page.evaluate("async () => (await import('./core.js')).iso()")

    def reset():
        page.evaluate('localStorage.clear()')
        page.reload()
        expect(page.get_by_role('button', name='Workout öffnen', exact=True).first).to_be_visible()

    def close():
        page.locator('#modal [data-action="close"]').click()

    def select_nav(view):
        page.locator(f'nav:visible [data-view="{view}"]').click()

    def upload(data, filename='plan.json'):
        page.locator('main [data-action="import"]').first.click()
        raw = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
        page.locator('#file-input').set_input_files({'name': filename, 'mimeType': 'text/csv' if filename.endswith('.csv') else 'application/json', 'buffer': raw.encode('utf-8')})

    def fixture():
        return {'schemaVersion': 1, 'id': 'test-plan', 'title': 'Testplan für Pista', 'workouts': [{'id': 'test-a', 'date': today, 'title': 'Kraft & Mobilität', 'type': 'strength', 'durationMinutes': 30, 'description': 'Nur Testdaten.', 'steps': [{'id': 'a', 'title': 'Erster Block', 'details': 'Ruhige Durchführung'}, {'id': 'b', 'title': 'Zweiter Block', 'details': 'Individuell anpassen'}]}]}

    def responsive():
        for width in [320, 375, 390, 430, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            for view in ['overview', 'plan', 'progress']:
                select_nav(view)
                extent = page.evaluate('({w:innerWidth, s:document.documentElement.scrollWidth})')
                assert extent['s'] <= extent['w'], (width, view, extent)
                assert page.locator('h1').is_visible()
            select_nav('overview')
            page.screenshot(path=str(OUT / f'{engine}-{width}.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.emulate_media(color_scheme='dark')
        assert page.evaluate('getComputedStyle(document.body).backgroundColor') == 'rgb(245, 246, 248)'
        page.emulate_media(color_scheme='light')
    check(engine + ': six viewport widths, three views, no horizontal overflow, light-only theme', responsive)

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


    def completion():
        page.get_by_role('button', name='Workout öffnen', exact=True).first.click()
        page.locator('[data-step="warmup"]').check()
        page.locator('#workout-note').fill('Gut angekommen.\nNotiz bleibt erhalten: äöü ß.')
        close()
        page.reload()
        page.get_by_role('button', name='Workout öffnen', exact=True).first.click()
        expect(page.locator('[data-step="warmup"]')).to_be_checked()
        expect(page.locator('#workout-note')).to_have_value('Gut angekommen.\nNotiz bleibt erhalten: äöü ß.')
        page.locator('[data-step="move"]').check()
        page.locator('[data-step="finish"]').check()
        expect(page.locator('#detail-done')).to_contain_text('Wieder als offen markieren')
        close()
        page.reload()
        page.get_by_role('button', name='Workout ansehen', exact=True).first.click()
        expect(page.locator('[data-step="finish"]')).to_be_checked()
        page.locator('[data-step="warmup"]').uncheck()
        expect(page.locator('#detail-done')).to_contain_text('Workout abhaken')
        close()
    check(engine + ': exercise completion, notes and reopening survive reloads', completion)

    def backup_restore():
        page.locator('#data-button').click()
        with page.expect_download() as dl:
            page.locator('#modal [data-action="backup"]').click()
        path = OUT / f'{engine}-backup.json'
        dl.value.save_as(str(path))
        data = json.loads(path.read_text())
        assert data['state']['progress']['demo-move']['note'].startswith('Gut angekommen')
        close()
        reset()
        upload(data)
        expect(page.locator('#modal-title')).to_contain_text('Sicherung wiederherstellen')
        page.locator('[data-action="import-confirm"]').click()
        page.locator('main [data-action="open"]').first.click()
        expect(page.locator('#workout-note')).to_have_value('Gut angekommen.\nNotiz bleibt erhalten: äöü ß.')
        close()
    check(engine + ': backup download and actual restore retain notes and checks', backup_restore)

    def invalid_import():
        before = page.evaluate('localStorage.getItem("pista.state.v1")')
        upload('{this is invalid JSON}')
        expect(page.locator('#modal-error')).to_contain_text('Ungültiges JSON')
        assert page.evaluate('localStorage.getItem("pista.state.v1")') == before
        close()
        bad = fixture()
        bad['workouts'][0]['date'] = '2026-02-30'
        upload(bad)
        expect(page.locator('#modal-error')).to_contain_text('Ungültiges Datum')
        assert page.evaluate('localStorage.getItem("pista.state.v1")') == before
        close()
    check(engine + ': invalid JSON and invalid dates never overwrite saved state', invalid_import)

    def import_merge_undo():
        plan = fixture()
        before = page.evaluate('localStorage.getItem("pista.state.v1")')
        upload(plan)
        expect(page.locator('#modal-title')).to_contain_text('Dein Plan ist bereit')
        assert page.evaluate('localStorage.getItem("pista.state.v1")') == before
        page.locator('[data-action="import-confirm"]').click()
        expect(page.locator('.plan-intro h2')).to_have_text(plan['title'])
        page.locator('[data-action="done"]').first.click()
        plan['workouts'].append({'id': 'test-b', 'date': today, 'title': 'Zweite Einheit', 'type': 'mobility', 'durationMinutes': 20})
        upload(plan)
        page.locator('[data-action="merge-confirm"]').click()
        assert page.locator('.workout-row').count() == 2
        expect(page.locator('[data-action="done"][data-id="test-a"]')).to_have_attribute('aria-pressed', 'true')
        page.locator('#data-button').click()
        page.locator('[data-action="restore-previous"]').click()
        page.locator('[data-action="import-confirm"]').click()
        assert page.locator('.workout-row').count() == 1
        expect(page.locator('[data-action="done"][data-id="test-a"]')).to_have_attribute('aria-pressed', 'true')
    check(engine + ': preview, JSON replacement, merge and last-import undo', import_merge_undo)

    def csv_and_injection():
        upload(f'date,title,type,durationMinutes,description,steps\n{today},"Laufen, locker",run,20,"Nur Testdaten","Aufwärmen | Ausklang"\n', 'plan.csv')
        page.locator('[data-action="import-confirm"]').click()
        expect(page.locator('.workout-open strong')).to_have_text('Laufen, locker')
        plan = fixture()
        plan['title'] = '<img src=x onerror="window.pistaInjected=true">'
        plan['workouts'][0]['title'] = '<svg onload="window.pistaInjected=true">Test</svg>'
        upload(plan)
        page.locator('[data-action="import-confirm"]').click()
        assert page.evaluate('window.pistaInjected === undefined')
        assert page.locator('img[src="x"]').count() == 0
        expect(page.locator('.plan-intro h2')).to_have_text(plan['title'])
        for view in ['overview', 'progress', 'plan']:
            select_nav(view)
            assert page.evaluate('window.pistaInjected === undefined')
    check(engine + ': quoted CSV import and HTML/script-injection resistance', csv_and_injection)

    def pdf_exports():
        upload(fixture())
        page.locator('[data-action="import-confirm"]').click()
        page.locator('main [data-action="export"]').click()
        for mode in ['week', 'fortnight', 'month']:
            page.locator(f'input[name="pdf-mode"][value="{mode}"]').check()
            page.locator('#pdf-date').fill(today)
            page.locator('#pdf-details').check()
            with page.expect_download() as dl:
                page.locator('[data-action="export-pdf"]').click()
            path = OUT / f'{engine}-{mode}.pdf'
            dl.value.save_as(str(path))
            reader = PdfReader(path)
            assert len(reader.pages) >= 1
            content = '\n'.join(p.extract_text() for p in reader.pages)
            assert 'Kraft & Mobilität' in content
            assert 'Erster Block' in content
            for p in reader.pages:
                assert abs(float(p.mediabox.width) - 595.28) < .01
                assert abs(float(p.mediabox.height) - 841.89) < .01
            with fitz.open(path) as doc:
                for p in doc:
                    for word in p.get_text('words'):
                        assert word[0] >= 30 and word[2] <= 566, (mode, 'horizontal clipping', word)
                        assert word[1] >= 15 and word[3] <= 830, (mode, 'vertical clipping', word)
                doc[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(OUT / f'{engine}-{mode}-preview.png')
        close()
    check(engine + ': real downloaded week/two-week/month PDFs, A4 dimensions and text bounds', pdf_exports)

    def cross_tab():
        second = ctx.new_page()
        second.goto(url)
        second.get_by_role('button', name='Workout öffnen', exact=True).first.click()
        second.locator('#detail-done').click()
        page.wait_for_function('JSON.parse(localStorage.getItem("pista.state.v1")).progress["test-a"].done === true')
        select_nav('plan')
        expect(page.locator('[data-action="done"][data-id="test-a"]')).to_have_attribute('aria-pressed', 'true')
        second.close()
    check(engine + ': changes propagate between tabs', cross_tab)

    def offline():
        page.evaluate('async () => { await navigator.serviceWorker.ready; }')
        page.reload()
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        ctx.set_offline(True)
        page.reload()
        expect(page.locator('h1')).to_be_visible()
        select_nav('plan')
        expect(page.locator('.plan-intro h2')).to_have_text('Testplan für Pista')
        page.locator('[data-action="done"]').first.click()
        expect(page.locator('#save-status')).to_have_text('Lokal gespeichert')
        ctx.set_offline(False)
    check(engine + ': offline reload and autosave under project subpath', offline)

    def corrupted_storage():
        page.evaluate('localStorage.setItem("pista.state.v1", "{broken")')
        page.reload()
        expect(page.locator('#storage-warning')).to_contain_text('nicht lesbar')
        assert page.evaluate('localStorage.getItem("pista.state.v1")') == '{broken'
        page.locator('main [data-action="open"]').first.click()
        page.locator('#detail-done').click()
        assert page.evaluate('localStorage.getItem("pista.state.v1")') == '{broken'
        close()
    check(engine + ': corrupt saved data is preserved rather than silently reset', corrupted_storage)

    def no_js_errors():
        assert not errors, errors
    check(engine + ': no unhandled JavaScript errors', no_js_errors)
    ctx.close()

    denied = browser.new_context(viewport={'width': 390, 'height': 844})
    denied.add_init_script("Storage.prototype.setItem = function(){throw new DOMException('Storage blocked','QuotaExceededError')};")
    p = denied.new_page()
    p.goto(url)
    expect(p.locator('#save-status')).to_have_text('Nicht gespeichert')
    p.get_by_role('button', name='Workout öffnen', exact=True).first.click()
    p.locator('#detail-done').click()
    expect(p.locator('#storage-warning')).to_be_visible()
    denied.close()
    results.append(engine + ': blocked storage is visibly reported')
    print('PASS:', results[-1], flush=True)


def persistent_browser(p, url):
    with tempfile.TemporaryDirectory() as directory:
        ctx = p.chromium.launch_persistent_context(directory, headless=True, viewport={'width': 390, 'height': 844})
        page = ctx.pages[0]
        page.goto(url)
        page.get_by_role('button', name='Workout öffnen', exact=True).first.click()
        page.locator('#workout-note').fill('Browser wurde vollständig geschlossen.')
        page.locator('#detail-done').click()
        ctx.close()
        ctx = p.chromium.launch_persistent_context(directory, headless=True, viewport={'width': 390, 'height': 844})
        page = ctx.pages[0]
        page.goto(url)
        page.get_by_role('button', name='Workout ansehen', exact=True).first.click()
        expect(page.locator('#workout-note')).to_have_value('Browser wurde vollständig geschlossen.')
        expect(page.locator('[data-step="finish"]')).to_be_checked()
        ctx.close()
    results.append('Chromium: survives complete browser close and relaunch')
    print('PASS:', results[-1], flush=True)


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as served:
        Path(served, 'Pista').symlink_to(ROOT, target_is_directory=True)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=served))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = os.environ.get('PISTA_URL', f'http://127.0.0.1:{server.server_port}/Pista/')
        try:
            with sync_playwright() as p:
                for engine in ['chromium', 'webkit']:
                    browser = getattr(p, engine).launch(headless=True)
                    try:
                        run_browser(browser, engine, url)
                    except Exception:
                        for i, context in enumerate(browser.contexts):
                            for j, page in enumerate(context.pages):
                                try:
                                    page.screenshot(path=str(OUT / f'FAIL-{engine}-{i}-{j}.png'), full_page=True)
                                except Exception:
                                    pass
                        raise
                    finally:
                        browser.close()
                persistent_browser(p, url)
        except Exception:
            (OUT / 'failure.txt').write_text(traceback.format_exc())
            raise
        finally:
            server.shutdown()
            (OUT / 'browser-results.json').write_text(json.dumps({'passed': len(results), 'checks': results}, indent=2, ensure_ascii=False))
    print(f'ALL {len(results)} BROWSER CHECKS PASSED', flush=True)
