"""End-to-end checks in isolated Chromium and WebKit contexts, under /Pista/."""
from __future__ import annotations
import base64
import functools
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import traceback
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader
import fitz
from pwa_browser_test import run_pwa_checks, wait_for_current_update, wait_for_page_condition

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
results = []
active_check = 'startup'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(name, fn):
    global active_check
    active_check = name
    fn()
    results.append(name)
    print('PASS:', name, flush=True)


def seed_demo_fixture(page):
    """Exercise generic import/backup behavior without relying on the shipped plan.

    An actual old demo is deliberately upgraded by the application. This explicit
    test plan therefore keeps the familiar exercise IDs but is not a demo.
    """
    page.evaluate("""async () => {
        const {initialState,STORAGE_KEY}=await import('./core.js');
        const state=initialState();
        state.plan.demo=false;
        state.plan.id='test-demo-fixture';
        localStorage.clear();
        localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
        history.replaceState(null,'',location.pathname+location.search+'#plan');
    }""")
    page.reload()
    expect(page.locator('main [data-action="open"]').first).to_be_visible()


def verify_pdf(path, required=()):
    reader = PdfReader(path)
    assert reader.pages, 'Downloaded PDF has no pages'
    content = '\n'.join(p.extract_text() for p in reader.pages)
    for value in required:
        assert value in content, (str(path), 'missing PDF content', value)
    for page in reader.pages:
        assert abs(float(page.mediabox.width) - 595.28) < .01
        assert abs(float(page.mediabox.height) - 841.89) < .01
    with fitz.open(path) as document:
        for page in document:
            for word in page.get_text('words'):
                assert word[0] >= 30 and word[2] <= 566, (str(path), 'horizontal clipping', word)
                assert word[1] >= 15 and word[3] <= 830, (str(path), 'vertical clipping', word)
        document[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(path.with_suffix('.png'))
    return content


def run_browser(browser, engine, url):
    global active_check
    active_check = engine + ': initial navigation'
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', timezone_id='Europe/Berlin', reduced_motion='reduce', accept_downloads=True)
    page = ctx.new_page()
    page.clock.set_fixed_time('2026-11-10T12:00:00+01:00')
    errors = []
    started = time.monotonic()

    def record_error(error):
        errors.append({
            'phase': active_check,
            'elapsed_ms': round((time.monotonic() - started) * 1000),
            'name': error.name, 'message': error.message, 'stack': error.stack,
        })

    page.on('pageerror', record_error)
    page.goto(url)
    expect(page.get_by_role('button', name='Workout anzeigen', exact=True).first).to_be_visible()
    today = page.evaluate("async () => (await import('./core.js')).iso()")

    def reset():
        seed_demo_fixture(page)

    def close():
        page.locator('#modal [data-action="close"]').click()
        expect(page.locator('.skip-link')).not_to_be_focused()

    def select_nav(view):
        page.locator(f'nav:visible [data-view="{view}"]').click()

    def upload(data, filename='plan.json'):
        page.locator('#data-button').click()
        page.locator('#modal [data-action="import"]').click()
        raw = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
        page.locator('#file-input').set_input_files({'name': filename, 'mimeType': 'text/csv' if filename.endswith('.csv') else 'application/json', 'buffer': raw.encode('utf-8')})

    def fixture():
        return {'schemaVersion': 1, 'id': 'test-plan', 'title': 'Testplan für Pista', 'workouts': [{'id': 'test-a', 'date': today, 'title': 'Kraft & Mobilität', 'type': 'strength', 'durationMinutes': 30, 'description': 'Nur Testdaten.', 'steps': [{'id': 'a', 'title': 'Erster Block', 'details': 'Ruhige Durchführung'}, {'id': 'b', 'title': 'Zweiter Block', 'details': 'Individuell anpassen'}]}]}

    def ready_client_plan():
        saved = page.evaluate('JSON.parse(localStorage.getItem("pista.state.v1"))')
        assert saved['plan']['id'] == 'tp-ab-2026-2027'
        assert len(saved['plan']['workouts']) == 91
        assert len({w['id'] for w in saved['plan']['workouts']}) == 91
        assert len({w['date'] for w in saved['plan']['workouts']}) == 91
        assert sum(w['type'] == 'rest' for w in saved['plan']['workouts']) == 36
        assert sum(w['type'] != 'rest' for w in saved['plan']['workouts']) == 55
        assert sum(w['sessionCode'] == 'U' for w in saved['plan']['workouts']) == 9
        assert sum(w['optional'] for w in saved['plan']['workouts']) == 4
        assert saved['plan']['workouts'][0]['date'] == '2026-11-02'
        assert saved['plan']['workouts'][-1]['date'] == '2027-01-31'
        assert not saved['progress']
        assert not saved['plan']['demo']
        select_nav('plan')
        assert page.locator('.by-week').count() == 13
        assert page.locator('[data-view="overview"]').count() == 0
        assert page.locator('main [data-action="mode"]').count() == 0
        assert page.locator('main [data-action="export"], main [data-action="export-paper"]').count() == 0
        page.locator('[data-action="tracker-week"][data-date="2026-11-02"]').click()
        cards = page.locator('main [data-workout-id]')
        assert cards.count() == 7, 'The first/current week must show Monday through Sunday'
        assert [cards.nth(i).get_attribute('data-workout-id') for i in range(7)] == [
            f'tpab-2026-11-{day:02d}-rest' for day in range(2, 8)
        ] + ['tpab-2026-11-08-start']
        for card in cards.all():
            assert card.locator('[data-action="done"]').count() == 1
            assert card.locator('[data-action="open"]').count() == 1
        expect(page.locator('[data-action="done"][data-id="tpab-2026-11-07-rest"]')).to_have_attribute('aria-pressed', 'false')
        page.locator('[data-action="next"]').click()
        expect(page.locator('.by-week.active')).to_have_attribute('data-date', '2026-11-09')
        assert page.locator('main [data-workout-id]').count() == 7
        page.locator('[data-action="previous"]').click()
        expect(page.locator('.by-week.active')).to_have_attribute('data-date', '2026-11-02')
        assert page.locator('main [data-workout-id]').count() == 7
        page.locator('[data-action="tracker-week"][data-date="2027-01-11"]').click()
        january = page.locator('[data-workout-id="tpab-2027-01-13-a"]')
        expect(january).to_have_attribute('data-date', '2027-01-15')
        expect(january).to_contain_text('09:30')
        expect(january).to_contain_text('10:30')
        page.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
        assert page.locator('[data-workout-id]').count() == 7
        page.locator('[data-action="open"][data-id="tpab-2026-11-11-a"]').click()
        assert page.locator('#modal input[type="checkbox"], #modal [data-step]').count() == 0
        expect(page.locator('#modal')).to_contain_text('Zone 2')
        expect(page.locator('#modal .training-hints')).to_be_visible()
        assert page.locator('#modal details').count() == 0
        page.locator('#workout-note').fill('TESTNOTIZ NUR MIT AUSWAHL')
        close()
        page.reload()
        page.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
        page.locator('[data-action="open"][data-id="tpab-2026-11-11-a"]').click()
        expect(page.locator('#workout-note')).to_have_value('TESTNOTIZ NUR MIT AUSWAHL')
        expect(page.locator('#detail-done')).to_contain_text('Workout abhaken')
        page.locator('#detail-done').click()
        close()
        expect(page.locator('[data-action="done"][data-id="tpab-2026-11-11-a"]')).to_have_attribute('aria-pressed', 'true')
        page.screenshot(path=str(OUT / f'{engine}-client-plan.png'), full_page=True)
    check(engine + ': 91-day plan, every first-week day, 55 training/36 rest days and saved whole-workout checks', ready_client_plan)

    def rest_day_completion():
        rest_id = 'tpab-2026-11-10-rest'
        rest_card = page.locator(f'[data-workout-id="{rest_id}"]')
        expect(rest_card).to_contain_text('Ruhetag')
        expect(rest_card).not_to_contain_text('Dauer offen')
        expect(rest_card).not_to_contain_text('0 Min.')
        before = page.evaluate('async () => (await import("./core.js")).stats(JSON.parse(localStorage.getItem("pista.state.v1")))')
        page.locator(f'[data-action="open"][data-id="{rest_id}"]').click()
        expect(page.locator('#modal-title')).to_have_text('Ruhetag')
        assert page.locator('#modal [data-step]').count() == 0
        expect(page.locator('#detail-done')).to_contain_text('Ruhetag abhaken')
        page.locator('#workout-note').fill('RUHETAG NOTIZ MIT AUSWAHL')
        page.locator('#detail-done').click()
        close()
        page.reload()
        page.locator('[data-action="tracker-week"][data-date="2026-11-09"]').click()
        expect(page.locator(f'[data-action="done"][data-id="{rest_id}"]')).to_have_attribute('aria-pressed', 'true')
        after = page.evaluate('async () => (await import("./core.js")).stats(JSON.parse(localStorage.getItem("pista.state.v1")))')
        assert after['done'] == before['done'] + 1
        assert after['minutes'] == before['minutes'], 'A rest day must not add training minutes'
        page.locator(f'[data-action="open"][data-id="{rest_id}"]').click()
        expect(page.locator('#workout-note')).to_have_value('RUHETAG NOTIZ MIT AUSWAHL')
        expect(page.locator('#detail-done')).to_contain_text('Wieder als offen markieren')
        page.locator('#detail-done').click()
        close()
        expect(page.locator(f'[data-action="done"][data-id="{rest_id}"]')).to_have_attribute('aria-pressed', 'false')
        page.locator(f'[data-action="done"][data-id="{rest_id}"]').click()
        expect(page.locator(f'[data-action="done"][data-id="{rest_id}"]')).to_have_attribute('aria-pressed', 'true')
        page.screenshot(path=str(OUT / f'{engine}-rest-day-checklist.png'), full_page=True)
    check(engine + ': rest-day checkbox, details, notes, reload and reopening without invented training minutes', rest_day_completion)

    def client_pdfs():
        select_nav('progress')
        assert page.locator('main [data-action="export"]').count() == 1
        assert page.locator('[data-action="export-paper"]').count() == 0
        page.locator('main [data-action="export"]').first.click()
        page.locator('input[name="pdf-mode"][value="all"]').check()
        page.locator('input[name="pdf-layout"][value="overview"]').check()
        page.locator('#pdf-details').uncheck()
        assert page.locator('#pdf-notes').count() == 0
        with page.expect_download() as dl:
            page.locator('[data-action="export-pdf"]').click()
        overview_path = OUT / f'{engine}-client-all-overview.pdf'
        dl.value.save_as(str(overview_path))
        overview = verify_pdf(overview_path, ('09:30', '10:30', 'Uni-Sport', 'Ruhetag', '91 Tage'))
        assert 'TESTNOTIZ NUR MIT AUSWAHL' not in overview
        assert 'RUHETAG NOTIZ MIT AUSWAHL' not in overview
        page.locator('input[name="pdf-layout"][value="checklist"]').check()
        with page.expect_download() as dl:
            page.locator('[data-action="export-pdf"]').click()
        checklist_path = OUT / f'{engine}-client-all-checklist.pdf'
        dl.value.save_as(str(checklist_path))
        checklist = verify_pdf(checklist_path, ('09:30', '10:30', 'Uni-Sport', 'Ruhetag', '91 Tage'))
        assert '[x]' not in checklist
        assert 'TESTNOTIZ NUR MIT AUSWAHL' not in checklist
        assert 'RUHETAG NOTIZ MIT AUSWAHL' not in checklist
        with fitz.open(checklist_path) as document:
            boxes = [item[1] for p in document for drawing in p.get_drawings()
                     for item in drawing['items'] if item[0] == 're'
                     and 7 <= item[1].width <= 18 and 7 <= item[1].height <= 18]
            assert len(boxes) == 91, ('exactly one printable checkbox per day, including rest days', len(boxes))
        page.locator('input[name="pdf-mode"][value="week"]').check()
        page.locator('#pdf-date').fill('2026-11-11')
        page.locator('#pdf-details').check()
        assert page.locator('#pdf-notes').count() == 0
        with page.expect_download() as dl:
            page.locator('[data-action="export-pdf"]').click()
        detailed_path = OUT / f'{engine}-client-week-checklist-details.pdf'
        dl.value.save_as(str(detailed_path))
        detailed = verify_pdf(detailed_path, ('Liegestütze', '90', 'Rudern', 'Ruhetag', 'Zone 2'))
        assert '[x]' not in detailed
        assert 'TESTNOTIZ NUR MIT AUSWAHL' not in detailed
        assert 'RUHETAG NOTIZ MIT AUSWAHL' not in detailed
        with fitz.open(detailed_path) as document:
            boxes = [item[1] for p in document for drawing in p.get_drawings()
                     for item in drawing['items'] if item[0] == 're'
                     and 7 <= item[1].width <= 18 and 7 <= item[1].height <= 18]
            assert len(boxes) == 7, ('detailed exports must not add exercise checkboxes', len(boxes))
        close()
    check(engine + ': one export entry on progress; PDFs have one day box, readable details and no saved notes', client_pdfs)

    def responsive():
        for width in [320, 375, 390, 430, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            for view in ['plan', 'progress']:
                select_nav(view)
                extent = page.evaluate('({w:innerWidth, s:document.documentElement.scrollWidth})')
                assert extent['s'] <= extent['w'], (width, view, extent)
                assert page.locator('h1').is_visible()
            select_nav('plan')
            page.screenshot(path=str(OUT / f'{engine}-{width}.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.emulate_media(color_scheme='dark')
        assert page.evaluate('getComputedStyle(document.body).backgroundColor') == 'rgb(245, 246, 248)'
        page.emulate_media(color_scheme='light')
    check(engine + ': six viewport widths, two views, no horizontal overflow, light-only theme', responsive)

    def startup_migration():
        old_demo = page.evaluate("""async () => {
            const {initialState,setDone,STORAGE_KEY}=await import('./core.js');
            const old=initialState();
            setDone(old,'demo-move',true);
            old.progress['demo-move'].note='Vorherige Demo bleibt gesichert.';
            localStorage.clear();
            localStorage.setItem(STORAGE_KEY,JSON.stringify(old));
            return old;
        }""")
        page.reload()
        wait_for_page_condition(page, '() => JSON.parse(localStorage.getItem("pista.state.v1")).plan.id === "tp-ab-2026-2027"')
        backup = page.evaluate('JSON.parse(localStorage.getItem("pista.previous.v1"))')
        assert backup == old_demo
        assert len(page.evaluate('JSON.parse(localStorage.getItem("pista.state.v1")).plan.workouts')) == 91
        legacy_plan = json.loads((ROOT / 'tests/fixtures/plan-v33.json').read_text())
        old_client = {'version': 1, 'plan': legacy_plan, 'progress': {
            'tpab-2026-11-11-a': {'done': True, 'steps': {}, 'note': 'Bestehender Trainingsfortschritt bleibt erhalten.', 'completedAt': '2026-11-11T10:00:00Z'},
            'tpab-2026-11-10-rest': {'done': True, 'steps': {}, 'note': 'Vorhandener Ruhetag bleibt erhalten.', 'completedAt': '2026-11-10T18:00:00Z'},
        }, 'updatedAt': None}
        old_client['plan']['workouts'] = [w for w in legacy_plan['workouts'] if w['date'] >= '2026-11-08']
        page.evaluate('(value) => localStorage.setItem("pista.state.v1", JSON.stringify(value))', old_client)
        page.reload()
        wait_for_page_condition(page, '() => JSON.parse(localStorage.getItem("pista.state.v1")).plan.revision === 4')
        upgraded = page.evaluate('JSON.parse(localStorage.getItem("pista.state.v1"))')
        assert len(upgraded['plan']['workouts']) == 91
        for workout_id in ('tpab-2026-11-11-a', 'tpab-2026-11-10-rest'):
            for key in ('done', 'note', 'completedAt'):
                assert upgraded['progress'][workout_id][key] == old_client['progress'][workout_id][key]
        assert upgraded['plan']['workouts'][0]['date'] == '2026-11-02'
        assert any(w['id'] == 'tpab-2026-11-12-s' for w in upgraded['plan']['workouts'])
        assert page.evaluate('localStorage.getItem("pista.plan-review.previous.v1")')
        page.reload()
        assert page.evaluate('JSON.parse(localStorage.getItem("pista.state.v1")).plan.revision') == 4
        custom = {'version': 1, 'plan': fixture(), 'progress': {'test-a': {'done': True, 'steps': {'a': True, 'b': True}, 'note': 'Eigenen Plan unverändert behalten.'}}, 'updatedAt': None}
        page.evaluate('(value) => localStorage.setItem("pista.state.v1", JSON.stringify(value))', custom)
        page.reload()
        expect(page.locator('.plan-intro h2')).to_have_text(custom['plan']['title'])
        saved = page.evaluate('JSON.parse(localStorage.getItem("pista.state.v1"))')
        assert saved['plan']['id'] == 'test-plan'
        assert len(saved['plan']['workouts']) == 1
        assert saved['progress']['test-a']['done']
        assert saved['progress']['test-a']['note'] == 'Eigenen Plan unverändert behalten.'
        reset()
    check(engine + ': demo backup, old-to-revised 91-day migration retains training/rest checks, notes and personal plans', startup_migration)

    def reference_interactions():
        reset()
        select_nav('plan')
        expect(page.locator('.by-summary [role="progressbar"]')).to_have_attribute('aria-valuenow', '0')
        assert page.locator('input[type="password"]').count() == 0
        assert page.locator('[data-action="expand"], [data-inline-step], [data-step], .by-expand-hint').count() == 0
        assert page.get_by_text('Details anzeigen', exact=True).count() == 0
        assert page.get_by_text('Papier-Checkliste', exact=True).count() == 0
        assert page.locator('main [data-action="export"], main [data-action="export-paper"]').count() == 0
        card = page.locator('[data-workout-id="demo-move"]')
        height_before = card.bounding_box()['height']
        card.locator('.by-card-content strong').click()
        expect(page.locator('#modal')).not_to_be_visible()
        assert abs(card.bounding_box()['height'] - height_before) < .1, 'Card content must not expand on tap'
        card.locator('[data-action="done"]').click()
        expect(page.locator('#modal')).not_to_be_visible()
        expect(card.locator('[data-action="done"]')).to_have_attribute('aria-pressed', 'true')
        card.locator('[data-action="open"]').click()
        expect(page.locator('#modal-title')).to_have_text('Ankommen & bewegen')
        expect(page.locator('#modal')).to_contain_text('In Ruhe ankommen')
        expect(page.locator('#modal')).to_contain_text('Locker bewegen')
        expect(page.locator('#modal')).to_contain_text('Ruhig ausklingen')
        assert page.locator('#modal input[type="checkbox"], #modal [data-step]').count() == 0
        close()
        # Saved links to the deleted overview resolve to the weekly plan.
        page.goto(url.split('#', 1)[0] + '#overview')
        expect(page.locator('nav:visible [data-view="plan"]')).to_have_attribute('aria-current', 'page')
        assert page.locator('[data-view="overview"]').count() == 0
        assert page.locator('main [data-action="mode"]').count() == 0
        next_week=page.evaluate("async (d) => (await import('./core.js')).addDays(d,7)",today)
        legacy={'title':'Referenz-Wochenplan','weeks':[{'week':1,'goal':'Technik und Rhythmus','days':[{'date':today,'unit':'Testeinheit','dauer':'25 min','zone':'Locker','type':'gym','fokus':'Saubere Ausführung','detail':'Eine ausführliche Anleitung.'}]},{'week':2,'goal':'Konstanz','days':[{'date':next_week,'unit':'Nächste Woche','dauer':'30–40 min','type':'run','fokus':'Gleichmäßig','detail':'Testeintrag.'}]}]}
        upload(legacy)
        page.locator('[data-action="import-confirm"]').click()
        expect(page.locator('.by-week-goal')).to_have_text('Technik und Rhythmus')
        assert page.locator('.by-week').count() == 2
        page.locator('.by-week').nth(1).click()
        expect(page.locator('.by-card-content strong')).to_have_text('Nächste Woche')
        page.locator('[data-action="done"]').click()
        expect(page.locator('#modal')).not_to_be_visible()
        page.reload()
        page.locator('.by-week').nth(1).click()
        expect(page.locator('[data-action="done"]')).to_have_attribute('aria-pressed','true')
        select_nav('progress')
        assert page.locator('main [data-action="export"]').count() == 1
        page.screenshot(path=str(OUT / f'{engine}-reference-layout.png'),full_page=True)
        reset()
        select_nav('plan')
    check(engine + ': weekly-only plan, removed overview, inert cards, explicit workout dialog and one PDF entry', reference_interactions)


    def completion():
        # Historical block checks remain inert; only a whole-workout flag counts.
        page.evaluate("""() => {
            const state=JSON.parse(localStorage.getItem('pista.state.v1'));
            state.progress['demo-move']={done:false,steps:{warmup:true,move:true,finish:true},note:'',completedAt:null};
            localStorage.setItem('pista.state.v1',JSON.stringify(state));
        }""")
        page.reload()
        expect(page.locator('[data-action="done"][data-id="demo-move"]')).to_have_attribute('aria-pressed', 'false')
        page.get_by_role('button', name='Workout anzeigen', exact=True).first.click()
        assert page.locator('#modal [data-step], #modal input[type="checkbox"]').count() == 0
        expect(page.locator('#detail-done')).to_contain_text('Workout abhaken')
        page.locator('#workout-note').fill('Gut angekommen.\nNotiz bleibt erhalten: äöü ß.')
        close()
        page.reload()
        page.get_by_role('button', name='Workout anzeigen', exact=True).first.click()
        expect(page.locator('#workout-note')).to_have_value('Gut angekommen.\nNotiz bleibt erhalten: äöü ß.')
        expect(page.locator('#detail-done')).to_contain_text('Workout abhaken')
        page.locator('#detail-done').click()
        expect(page.locator('#detail-done')).to_contain_text('Wieder als offen markieren')
        close()
        page.reload()
        expect(page.locator('[data-action="done"][data-id="demo-move"]')).to_have_attribute('aria-pressed', 'true')
        page.get_by_role('button', name='Workout anzeigen', exact=True).first.click()
        expect(page.locator('#detail-done')).to_contain_text('Wieder als offen markieren')
        page.locator('#detail-done').click()
        expect(page.locator('#detail-done')).to_contain_text('Workout abhaken')
        expect(page.locator('#workout-note')).to_have_value('Gut angekommen.\nNotiz bleibt erhalten: äöü ß.')
        close()
        expect(page.locator('[data-action="done"][data-id="demo-move"]')).to_have_attribute('aria-pressed', 'false')
        page.locator('[data-action="done"][data-id="demo-move"]').click()
    check(engine + ': one whole-workout flag controls completion; legacy block checks are inert and notes persist', completion)

    def backup_restore():
        page.locator('#data-button').click()
        with page.expect_download() as dl:
            page.locator('#modal [data-action="backup"]').click()
        path = OUT / f'{engine}-backup.json'
        dl.value.save_as(str(path))
        data = json.loads(path.read_text())
        assert data['state']['progress']['demo-move']['note'].startswith('Gut angekommen')
        assert data['state']['progress']['demo-move']['done']
        close()
        reset()
        upload(data)
        expect(page.locator('#modal-title')).to_contain_text('Sicherung wiederherstellen')
        page.locator('[data-action="import-confirm"]').click()
        page.locator('main [data-action="open"]').first.click()
        expect(page.locator('#workout-note')).to_have_value('Gut angekommen.\nNotiz bleibt erhalten: äöü ß.')
        expect(page.locator('#detail-done')).to_contain_text('Wieder als offen markieren')
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
        page.locator('#modal .data-more > summary').click()
        page.locator('[data-action="restore-previous"]').click()
        page.locator('[data-action="import-confirm"]').click()
        assert page.locator('.workout-row').count() == 1
        expect(page.locator('[data-action="done"][data-id="test-a"]')).to_have_attribute('aria-pressed', 'true')
    check(engine + ': preview, JSON replacement, merge and last-import undo', import_merge_undo)

    def csv_and_injection():
        upload(f'date,title,type,durationMinutes,description,steps\n{today},"Laufen, locker",run,20,"Nur Testdaten","Aufwärmen | Ausklang"\n', 'plan.csv')
        page.locator('[data-action="import-confirm"]').click()
        expect(page.locator('.by-card-content strong')).to_have_text('Laufen, locker')
        plan = fixture()
        plan['title'] = '<img src=x onerror="window.pistaInjected=true">'
        plan['workouts'][0]['title'] = '<svg onload="window.pistaInjected=true">Test</svg>'
        upload(plan)
        page.locator('[data-action="import-confirm"]').click()
        assert page.evaluate('window.pistaInjected === undefined')
        assert page.locator('img[src="x"]').count() == 0
        expect(page.locator('.plan-intro h2')).to_have_text(plan['title'])
        for view in ['progress', 'plan']:
            select_nav(view)
            assert page.evaluate('window.pistaInjected === undefined')
    check(engine + ': quoted CSV import and HTML/script-injection resistance', csv_and_injection)

    def pdf_exports():
        upload(fixture())
        page.locator('[data-action="import-confirm"]').click()
        select_nav('progress')
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
        second.get_by_role('button', name='Workout anzeigen', exact=True).first.click()
        second.locator('#detail-done').click()
        wait_for_page_condition(page, '() => JSON.parse(localStorage.getItem("pista.state.v1")).progress["test-a"].done === true')
        select_nav('plan')
        expect(page.locator('[data-action="done"][data-id="test-a"]')).to_have_attribute('aria-pressed', 'true')
        second.close()
    check(engine + ': changes propagate between tabs', cross_tab)

    def offline():
        page.evaluate('async () => { await navigator.serviceWorker.ready; }')
        page.reload()
        wait_for_page_condition(page, '() => navigator.serviceWorker.controller !== null')
        wait_for_current_update(page)
        ctx.set_offline(True)
        wait_for_page_condition(page, '() => navigator.onLine === false')
        page.reload()
        expect(page.locator('h1')).to_be_visible()
        select_nav('plan')
        expect(page.locator('.plan-intro h2')).to_have_text('Testplan für Pista')
        page.locator('[data-action="done"]').first.click()
        expect(page.locator('#save-status')).to_have_text('Lokal gespeichert')
        ctx.set_offline(False)
        wait_for_current_update(page)
    check(engine + ': offline reload and autosave under project subpath', offline)

    def web_app_controls():
        manifest = page.evaluate("""async () => {
            const response=await fetch(document.querySelector('link[rel="manifest"]').href);
            const value=await response.json();
            return {...value,resolvedScope:new URL(value.scope,response.url).pathname};
        }""")
        assert manifest['display'] == 'standalone'
        assert manifest['resolvedScope'] == '/Pista/'
        png_sizes = {icon['sizes'] for icon in manifest['icons'] if icon['type'] == 'image/png'}
        assert {'192x192', '512x512'} <= png_sizes
        assert any('maskable' in icon.get('purpose', '') for icon in manifest['icons'])
        assert page.locator('link[rel="apple-touch-icon"]').count() == 1
        page.locator('#data-button').click()
        expect(page.locator('#app-install-button')).to_be_visible()
        expect(page.locator('#app-check-button')).to_be_enabled(timeout=30000)
        before = page.evaluate('localStorage.getItem("pista.state.v1")')
        page.locator('#app-check-button').click()
        expect(page.locator('#app-update-status')).to_have_attribute('data-status', 'current', timeout=30000)
        assert page.evaluate('localStorage.getItem("pista.state.v1")') == before
        extent = page.evaluate('({w:innerWidth, s:document.documentElement.scrollWidth})')
        assert extent['s'] <= extent['w'], ('settings dialog horizontal overflow', extent)
        page.screenshot(path=str(OUT / f'{engine}-app-install-and-update.png'), full_page=True)
        close()
    check(engine + ': installable manifest/icons and live update controls preserve stored data', web_app_controls)

    def github_backup_flow():
        """Exercise the real form/fetch/import flow without sending private data.

        Use a fresh context without service workers: WebKit may bypass Playwright
        request routing for fetches owned by an existing worker. The API route is
        registered on the context before navigation, so every GitHub response is
        local. Real service-worker/offline behavior is covered separately above
        and by run_pwa_checks; the production CSP remains unchanged here.
        """
        backup_ctx = browser.new_context(
            viewport={'width': 390, 'height': 844}, locale='de-DE',
            timezone_id='Europe/Berlin', reduced_motion='reduce',
            service_workers='block',
        )
        page = backup_ctx.new_page()
        page.on('pageerror', record_error)
        repository = 'pista-browser-fixture/private-backup'
        token = 'github_pat_pista_browser_fixture_not_real_12345'
        backup_path = 'backups/pista-backup.json'
        remote = {'content': None, 'sha': 'b' * 40}
        requests = []

        def github_route(route):
            request = route.request
            headers = {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GitHub-Api-Version, Accept',
            }
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=headers)
                return
            assert request.headers.get('authorization') == 'Bearer ' + token
            assert token not in request.url
            requests.append(request.method)
            path = urlsplit(request.url).path
            if path == f'/repos/{repository}' and request.method == 'GET':
                route.fulfill(status=200, headers=headers, body=json.dumps({
                    'full_name': repository, 'private': True, 'visibility': 'private',
                    'default_branch': 'main', 'permissions': {'push': True},
                }))
            elif path == f'/repos/{repository}/contents/{backup_path}' and request.method == 'GET':
                if remote['content'] is None:
                    route.fulfill(status=404, headers=headers, body='{"message":"Not Found"}')
                else:
                    route.fulfill(status=200, headers=headers, body=json.dumps({
                        'type': 'file', 'path': backup_path, 'sha': remote['sha'],
                        'encoding': 'base64', 'size': len(base64.b64decode(remote['content'])),
                        'content': remote['content'],
                    }))
            elif path == f'/repos/{repository}/contents/{backup_path}' and request.method == 'PUT':
                uploaded = json.loads(request.post_data)
                assert uploaded['branch'] == 'main'
                assert 'sha' not in uploaded, 'The first backup must create a new file'
                remote['content'] = uploaded['content']
                route.fulfill(status=201, headers=headers, body=json.dumps({
                    'content': {'path': backup_path, 'sha': remote['sha']},
                }))
            else:
                route.abort()
                raise AssertionError(('Unexpected GitHub endpoint in backup test', request.method, path))

        def open_github():
            page.locator('#data-button').click()
            page.locator('#modal [data-action="github-backup"]').click()

        def close():
            page.locator('#modal [data-action="close"]').click()

        def connect():
            page.locator('#github-repository').fill(repository)
            page.locator('#github-token').fill(token)
            page.locator('#github-connect').click()
            expect(page.locator('#github-save')).to_be_enabled()

        backup_ctx.route('https://api.github.com/**', github_route)
        try:
            page.goto(url.split('#', 1)[0] + '#plan')
            page.evaluate(
                '(value) => localStorage.setItem("pista.state.v1", JSON.stringify(value))',
                {'version': 1, 'plan': fixture(), 'progress': {}, 'updatedAt': None},
            )
            page.reload()
            expect(page.locator('.plan-intro h2')).to_have_text('Testplan für Pista')
            page.locator('[data-action="open"][data-id="test-a"]').click()
            page.locator('#workout-note').fill('Sicherung außerhalb des Geräts: Grüße, äöü und ß.')
            if page.locator('#detail-done').get_attribute('aria-pressed') != 'true':
                page.locator('#detail-done').click()
            close()
            open_github()
            page.locator('#github-repository').fill(repository)
            page.locator('#github-token').fill('invalid-test-key')
            page.locator('#github-connect').click()
            expect(page.locator('#modal-error')).to_contain_text('feingranularen GitHub-Token')
            assert not requests, 'Invalid configuration must not send a request'
            connect()
            assert 'PUT' not in requests, 'Connecting must only read, not upload'
            expect(page.locator('#github-panel')).to_contain_text('Noch keine Sicherung vorhanden')
            page.locator('#github-save').click()
            expect(page.locator('#github-message')).to_contain_text('Auf GitHub gesichert')
            assert requests.count('PUT') == 1
            saved = json.loads(base64.b64decode(remote['content']).decode('utf-8'))
            assert saved['state']['progress']['test-a']['done'] is True
            assert saved['state']['progress']['test-a']['note'] == 'Sicherung außerhalb des Geräts: Grüße, äöü und ß.'
            assert token not in json.dumps(saved)
            assert token not in page.evaluate('() => JSON.stringify(localStorage)')
            assert token not in page.evaluate('() => JSON.stringify(sessionStorage)')
            close()
            page.locator('[data-action="open"][data-id="test-a"]').click()
            page.locator('#workout-note').fill('Neuere lokale Notiz bleibt bis zur ausdrücklichen Wiederherstellung.')
            page.locator('#detail-done').click()
            close()
            local_before_restore = page.evaluate('() => localStorage.getItem("pista.state.v1")')
            page.reload()
            open_github()
            expect(page.locator('#github-token')).to_have_value('')
            expect(page.locator('#github-connect')).to_be_visible()
            connect()
            assert page.evaluate('() => localStorage.getItem("pista.state.v1")') == local_before_restore
            page.locator('#github-restore').click()
            expect(page.locator('#modal-title')).to_contain_text('Sicherung wiederherstellen')
            assert page.evaluate('() => localStorage.getItem("pista.state.v1")') == local_before_restore, 'Preview must not restore by itself'
            assert requests.count('PUT') == 1, 'Reading or restoring must not write a remote file'
            page.locator('[data-action="import-confirm"]').click()
            page.locator('[data-action="open"][data-id="test-a"]').click()
            expect(page.locator('#workout-note')).to_have_value('Sicherung außerhalb des Geräts: Grüße, äöü und ß.')
            expect(page.locator('#detail-done')).to_contain_text('Wieder als offen markieren')
            close()
            assert token not in page.evaluate('() => JSON.stringify(localStorage)')
            assert token not in page.evaluate('() => JSON.stringify(sessionStorage)')
            open_github()
            page.locator('#github-disconnect').click()
            expect(page.locator('#github-token')).to_have_value('')
            close()
        except Exception:
            try:
                page.screenshot(path=str(OUT / f'FAIL-{engine}-github-backup.png'), full_page=True)
            except Exception:
                pass
            raise
        finally:
            backup_ctx.close()
    check(engine + ': mocked private GitHub backup uploads explicitly, forgets credentials and restores only after preview', github_backup_flow)

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
    p.get_by_role('button', name='Workout anzeigen', exact=True).first.click()
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
        seed_demo_fixture(page)
        page.get_by_role('button', name='Workout anzeigen', exact=True).first.click()
        page.locator('#workout-note').fill('Browser wurde vollständig geschlossen.')
        page.locator('#detail-done').click()
        ctx.close()
        ctx = p.chromium.launch_persistent_context(directory, headless=True, viewport={'width': 390, 'height': 844})
        page = ctx.pages[0]
        page.goto(url)
        page.get_by_role('button', name='Workout anzeigen', exact=True).first.click()
        expect(page.locator('#workout-note')).to_have_value('Browser wurde vollständig geschlossen.')
        expect(page.locator('#detail-done')).to_contain_text('Wieder als offen markieren')
        assert page.locator('#modal [data-step], #modal input[type="checkbox"]').count() == 0
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
                        run_pwa_checks(browser, engine, ROOT, OUT, check)
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
