"""Intervals.icu bridge: browser workflows in Chromium and WebKit with mock API responses."""
from __future__ import annotations

from datetime import datetime, timezone
import functools
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
import traceback

from playwright.sync_api import expect, sync_playwright
from browser_test import QuietHandler

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
results = []


def check(label, fn):
    fn()
    results.append(label)
    print('PASS:', label, flush=True)


def run_browser(browser, engine, url):
    ctx = browser.new_context(
        viewport={'width': 390, 'height': 844},
        locale='de-DE', timezone_id='Europe/Berlin',
        reduced_motion='reduce'
    )
    page = ctx.new_page()
    page.clock.set_fixed_time(datetime(2026, 11, 15, 12, tzinfo=timezone.utc))
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    calls = []
    uploads = []
    unauthorized = [False]

    def respond(route):
        req = route.request
        headers = {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'authorization, content-type',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
        }
        if req.method == 'OPTIONS':
            return route.fulfill(status=204, headers=headers)
        calls.append((req.method, req.url, req.headers.get('authorization')))
        if unauthorized[0]:
            return route.fulfill(status=401, content_type='application/json',
                                 headers=headers, body='{"message":"Unauthorised"}')
        if req.method == 'GET':
            return route.fulfill(status=200, content_type='application/json',
                                 headers=headers, body='[]')
        events = req.post_data_json
        uploads.append(events)
        returned = [
            {**event, 'id': 100000 + i,
             'workout_doc': {'steps': [{'distance': 4000, 'intensity': 'active'}]}}
            for i, event in enumerate(events)
        ]
        return route.fulfill(status=200, content_type='application/json',
                             headers=headers, body=json.dumps(returned))

    page.route('https://intervals.icu/api/v1/**', respond)

    def open_run():
        page.locator('[data-action="tracker-week"][data-date="2026-11-16"]').click()
        page.locator('[data-action="open"][data-id="tpab-2026-11-21-b"]').click()

    def browser_flow():
        page.goto(url)
        expect(page.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
        open_run()
        page.locator('#workout-note').fill('PRIVATE WATCH TEST NOTE')
        before = page.evaluate("() => localStorage.getItem('pista.state.v1')")
        page.locator('#modal [data-action="intervals-panel"]').click()
        expect(page.locator('#intervals-key')).to_be_visible()
        assert page.locator('#intervals-key').get_attribute('type') == 'password'
        assert page.locator('[data-action="intervals-sync-one"]').count() == 0

        page.locator('#intervals-key').fill('abcdefghijk')
        page.locator('[data-action="intervals-connect"]').click()
        expect(page.locator('[data-action="intervals-sync-one"]')).to_be_visible()
        assert calls[0][0] == 'GET'
        assert 'Basic' in calls[0][2]

        for index in range(2):
            page.locator('[data-action="intervals-sync-one"]').click()
            expect(page.locator('#intervals-message')).to_contain_text('1 Lauftraining in Intervals.icu gespeichert')
        assert len(uploads) == 2
        assert len(uploads[0]) == 1
        assert uploads[0] == uploads[1], 'Duplicate prevention requires stable upsert payload'
        item = uploads[0][0]
        assert item['external_id'] == 'pista:v1:tp-ab-2026-2027:tpab-2026-11-21-b'
        assert item['start_date_local'] == '2026-11-21T00:00:00'
        assert item['category'] == 'WORKOUT' and item['type'] == 'Run'
        assert item['description'].count('intensity=active') == 5
        assert item['description'].count('intensity=recovery') == 4
        assert item['description'].count('intensity=warmup') == 1
        assert item['description'].count('intensity=cooldown') == 1
        assert calls[-1][1].endswith('/events/bulk?upsert=true')
        assert page.evaluate("() => localStorage.getItem('pista.state.v1')") == before
        assert page.evaluate("() => JSON.stringify(localStorage)") .find('abcdefghijk') == -1
        assert page.evaluate("() => JSON.stringify(sessionStorage)").find('abcdefghijk') == -1

        page.locator('[data-action="intervals-disconnect"]').click()
        expect(page.locator('#intervals-key')).to_be_visible()
        page.reload()
        open_run()
        page.locator('#modal [data-action="intervals-panel"]').click()
        expect(page.locator('#intervals-key')).to_be_visible()
        assert page.locator('#intervals-key').input_value() == ''
        assert page.evaluate("() => localStorage.getItem('pista.state.v1')") == before
        page.locator('#modal [data-action="close"]').click()
        open_run()
        expect(page.locator('#workout-note')).to_have_value('PRIVATE WATCH TEST NOTE')
        page.locator('#modal [data-action="close"]').click()

    def bulk_and_errors():
        page.locator('#data-button').click()
        page.locator('[data-action="intervals-panel"]').last.click()
        page.locator('#intervals-key').fill('abcdefghijk')
        page.locator('[data-action="intervals-connect"]').click()
        expect(page.locator('[data-action="intervals-sync-upcoming"]')).to_be_visible()
        page.locator('[data-action="intervals-sync-upcoming"]').click()
        expect(page.locator('#intervals-message')).to_contain_text('in Intervals.icu gespeichert')
        assert 2 <= len(uploads[-1]) <= 5
        ids = [event['external_id'] for event in uploads[-1]]
        assert len(ids) == len(set(ids))
        assert any(event['type'] == 'Run' for event in uploads[-1])
        page.locator('[data-action="intervals-disconnect"]').click()
        unauthorized[0] = True
        page.locator('#intervals-key').fill('abcdefghijk')
        page.locator('[data-action="intervals-connect"]').click()
        expect(page.locator('#intervals-message')).to_contain_text('abgelehnt')
        expect(page.locator('#intervals-key')).to_be_visible()
        assert not errors, errors

    def mobile_layout():
        for width in (320, 390, 1440):
            page.set_viewport_size({'width': width, 'height': 844 if width != 1440 else 900})
            assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth+1"), width
            assert page.locator('#modal').evaluate("(el) => el.scrollWidth <= el.clientWidth+1"), width
            page.screenshot(path=str(OUT / f'{engine}-intervals-{width}.png'))

    try:
        check(engine + ': native watch button, exact distance steps, idempotent upload, storage protection', browser_flow)
        check(engine + ': settings multi-run sync and unauthorized errors', bulk_and_errors)
        check(engine + ': responsive settings on 320, 390, 1440px', mobile_layout)
    finally:
        ctx.close()


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as served:
        Path(served, 'Pista').symlink_to(ROOT, target_is_directory=True)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=served))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = os.environ.get('PISTA_URL', f'http://127.0.0.1:{server.server_port}/Pista/')
        try:
            with sync_playwright() as p:
                for engine in ('chromium', 'webkit'):
                    browser = getattr(p, engine).launch(headless=True)
                    try:
                        run_browser(browser, engine, url)
                    finally:
                        browser.close()
        except Exception:
            (OUT / 'intervals-failure.txt').write_text(traceback.format_exc())
            raise
        finally:
            server.shutdown()
            server.server_close()
            (OUT / 'intervals-results.json').write_text(json.dumps({'passed': len(results), 'checks': results}, ensure_ascii=False, indent=2))
    print(f'ALL {len(results)} INTERVALS BROWSER CHECKS PASSED', flush=True)
