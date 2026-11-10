"""Exercise help, sparse scheduling and PDF checks in isolated browser profiles."""
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

from browser_test import QuietHandler, verify_pdf


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
TECHNIQUE_DATES = ['2026-11-14', '2026-11-28', '2026-12-12',
                   '2027-01-02', '2027-01-16', '2027-01-30']
results = []


def check(name, fn):
    fn()
    results.append(name)
    print('PASS:', name, flush=True)


def run_drills(browser, engine, url):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE',
                              timezone_id='Europe/Berlin', reduced_motion='reduce', accept_downloads=True)
    page = ctx.new_page()
    page.clock.set_fixed_time(datetime(2026, 11, 10, 12, tzinfo=timezone.utc))
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def close():
        page.locator('#modal [data-action="close"]').click()

    def week(value='2026-11-09'):
        page.locator(f'[data-action="tracker-week"][data-date="{value}"]').click()

    def open_workout(wid='tpab-2026-11-14-b'):
        page.locator(f'[data-action="open"][data-id="{wid}"]').click()

    def no_overflow():
        assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth + 1'), 'Page overflows horizontally'
        assert page.locator('#modal').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'), 'Dialog overflows horizontally'
        assert page.locator('#modal .modal-body').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'), 'Dialog body overflows horizontally'

    def sparse_help():
        page.goto(url)
        expect(page.locator('.plan-intro h2')).to_have_text('Dein Plan bis Januar')
        plan = page.evaluate('() => JSON.parse(localStorage.getItem("pista.state.v1")).plan')
        technique = [w for w in plan['workouts'] if any(s['id'] == 'knee-march' for s in w['steps'])]
        assert [w['date'] for w in technique] == TECHNIQUE_DATES
        assert sum(any(s['id'] == 'body-check' for s in w['steps']) for w in plan['workouts']) == 4
        assert sum(any(s['id'] == 'pace-guess' for s in w['steps']) for w in plan['workouts']) == 3
        grouped = page.evaluate("""async () => {
            const {monday}=await import('./core.js');
            const workouts=JSON.parse(localStorage.getItem('pista.state.v1')).plan.workouts;
            return workouts.map(w=>({id:w.id,date:w.date,week:monday(w.date)}));
        }""")
        active = None
        for item in grouped:
            if item['week'] != active:
                week(item['week'])
                active = item['week']
            open_workout(item['id'])
            expected = 2 if item['date'] in TECHNIQUE_DATES else 0
            assert page.locator('#modal [data-action="exercise-help"]').count() == expected, item
            assert page.locator('#modal input[type="checkbox"], #modal [data-step]').count() == 0
            assert page.locator('#detail-done').count() == 1
            for button in page.locator('#modal [data-action="exercise-help"]').all():
                expect(button).to_have_attribute('aria-expanded', 'false')
                expect(page.locator('#' + button.get_attribute('aria-controls'))).to_be_hidden()
                assert 'Erklärung' in button.get_attribute('aria-label')
            close()

    def responsive_help():
        for width in (320, 390, 1440):
            page.set_viewport_size({'width': width, 'height': 900 if width == 1440 else 844})
            week()
            no_page_overflow = page.evaluate('() => document.documentElement.scrollWidth <= innerWidth + 1')
            assert no_page_overflow, (engine, width, 'plan layout')
            open_workout()
            note = f'PRIVATE_DRILL_NOTE_{engine}_{width}: Diese Notiz bleibt. Äöü ß.'
            page.locator('#workout-note').fill(note)
            before = page.evaluate('() => localStorage.getItem("pista.state.v1")')
            buttons = page.locator('#modal [data-action="exercise-help"]')
            assert buttons.count() == 2
            for button in buttons.all():
                box = button.bounding_box()
                assert box['width'] >= 44 and box['height'] >= 44, 'Help must retain a usable touch target'
                panel = page.locator('#' + button.get_attribute('aria-controls'))
                button.click()
                expect(button).to_have_attribute('aria-expanded', 'true')
                expect(panel).to_be_visible()
                assert panel.inner_text().strip()
                no_overflow()
                button.click()
                expect(panel).to_be_hidden()
                button.focus()
                button.press('Enter')
                expect(panel).to_be_visible()
                expect(button).to_have_attribute('aria-expanded', 'true')
                button.press('Space')
                expect(panel).to_be_hidden()
                expect(button).to_have_attribute('aria-expanded', 'false')
                expect(button).to_be_focused()
            expect(page.locator('#workout-note')).to_have_value(note)
            assert page.evaluate('() => localStorage.getItem("pista.state.v1")') == before, 'Opening help must not mutate saved data'
            buttons.first.click()
            buttons.first.scroll_into_view_if_needed()
            no_overflow()
            page.screenshot(path=str(OUT / f'{engine}-drills-help-{width}.png'), full_page=True)
            close()
            open_workout()
            expect(page.locator('#workout-note')).to_have_value(note)
            assert page.locator('#modal .exercise-help-content:visible').count() == 0
            close()
            page.reload()
            week()
            open_workout()
            expect(page.locator('#workout-note')).to_have_value(note)
            assert page.locator('#modal [data-action="exercise-help"]').count() == 2
            close()

    def pdf_help():
        page.locator('nav:visible [data-view="progress"]').click()
        assert page.locator('main [data-action="export"]').count() == 1
        page.locator('main [data-action="export"]').click()
        page.locator('input[name="pdf-layout"][value="checklist"]').check()
        page.locator('input[name="pdf-mode"][value="week"]').check()
        page.locator('#pdf-date').fill('2026-11-09')
        page.locator('#pdf-details').check()
        with page.expect_download() as event:
            page.locator('[data-action="export-pdf"]').click()
        path = OUT / f'{engine}-drills-week-with-help.pdf'
        event.value.save_as(path)
        text = verify_pdf(path, required=('Kniehebegang', 'Tippelschritte'))
        normalized = ' '.join(text.split())
        assert 'Wie langsames Marschieren' in normalized, 'Printed details need the hidden explanation too'
        assert 'Die Knie bleiben niedrig' in normalized
        assert 'PRIVATE_DRILL_NOTE_' not in text, 'Personal notes must never be attached to a plan PDF'
        close()
        page.locator('nav:visible [data-view="plan"]').click()

    def personal_exercise_help():
        # A familiar ID alone must never attach the wrong instructions to an
        # imported or personally rewritten exercise.
        page.evaluate("""() => {
            const state=JSON.parse(localStorage.getItem('pista.state.v1'));
            const workout=state.plan.workouts.find(w=>w.id==='tpab-2026-11-14-b');
            const step=workout.steps.find(s=>s.id==='knee-march');
            step.title='Persönlich angepasste Übung';step.details='Meine eigene Anleitung.';
            localStorage.setItem('pista.state.v1',JSON.stringify(state));
        }""")
        page.reload()
        week()
        open_workout()
        block = page.locator('.workout-block').filter(has=page.get_by_role('heading', name='Persönlich angepasste Übung', exact=True))
        expect(block).to_contain_text('Meine eigene Anleitung.')
        assert block.locator('[data-action="exercise-help"]').count() == 0
        assert page.locator('#modal [data-action="exercise-help"]').count() == 1
        close()
        assert not errors, errors

    try:
        check(engine + ': help appears only on the two exercises in the six selected sessions', sparse_help)
        check(engine + ': 320/390/1440px help works with click, Enter and Space without data changes or overflow', responsive_help)
        check(engine + ': downloaded A4 details include exercise help and exclude personal notes', pdf_help)
        check(engine + ': personal exercise text never receives an unrelated built-in explanation', personal_exercise_help)
    except Exception:
        try:
            page.screenshot(path=str(OUT / f'FAIL-{engine}-drills.png'), full_page=True)
        except Exception:
            pass
        raise
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
                        run_drills(browser, engine, url)
                    finally:
                        browser.close()
        except Exception:
            (OUT / 'drills-failure.txt').write_text(traceback.format_exc())
            raise
        finally:
            server.shutdown()
            server.server_close()
            (OUT / 'drills-results.json').write_text(json.dumps({'passed': len(results), 'checks': results}, ensure_ascii=False, indent=2))
    print(f'ALL {len(results)} DRILL BROWSER CHECKS PASSED', flush=True)
