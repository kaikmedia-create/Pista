# Pista

Public app: **https://kaikmedia-create.github.io/Pista/index.html**

A light, mobile-first adaptation of the user's Backyard Tracker reference: a compact progress header, today's training, upcoming sessions, horizontally selectable weeks and dated, expandable training cards with independent completion buttons. The reference is https://lil-koi-afk.github.io/backyard-tracker/index.html (source blob `5feef4fd8aa65316fcaa20af1365e97b816b5b63`, inspected 7 November 2026). The public reference was inspected through GitHub and rendered in an isolated browser without reading or writing its shared Firebase database.

## Features

- Public GitHub Pages. No PIN, login, subscription, runtime CDN or external backend.
- Light system typography, restrained colors and the Pista vector monogram.
- Ready-to-use November 2026–January 2027 plan on first visit: all 85 calendar days, with 36 regular sessions, one optional start and 48 rest days. University sport is included in the three weekly training days.
- New visitors start immediately; former demo visitors receive the plan with their demo saved as a local backup. Existing versions of this client plan receive missing rest days automatically while preserving workouts, checks and notes. Other personal plans are kept. No exam day is invented.
- Check every day, including rest days; complete workouts or individual blocks; reopen them; save notes automatically. Rest days count toward daily progress without adding training minutes.
- Today, upcoming training, week tabs, weekly goals and progress overview.
- JSON and CSV import with validation, preview, replace/merge and undo.
- Compatibility with the actual Backyard JSON structure: an array of `{week, goal, days}` objects or an object containing `weeks` or `PLAN`. Day fields `date`, `unit`, `dauer`, `zone`, `type`, `fokus`, `detail` are preserved and normalized. JavaScript files or `const PLAN = ...` are never executed.
- Direct text-searchable DIN A4 PDFs: entire plan, one week, two weeks or a month. Training and rest days are included. Choose a compact overview or a paper checklist with empty drawn boxes and writing space; include exercises and personal notes independently. Automatic pagination.
- Backup download and restore; offline app-shell cache.

## Your data

App code and hosting are on GitHub. The supplied training schedule is part of the public app. Imported personal plans, completion and notes stay in localStorage under `pista.state.v1`. Version 1 data remains compatible. No automatic cross-device sync is provided. Export a JSON backup before clearing browser data or changing devices. Do not store a GitHub token in this public frontend.

## Native JSON plan format

```json
{
  "schemaVersion": 1,
  "id": "my-plan",
  "title": "Mein Trainingsplan",
  "description": "Individuell erstellter Trainingsplan",
  "workouts": [{
    "id": "session-01",
    "date": "2026-11-09",
    "title": "Probe-Workout",
    "type": "mobility",
    "durationMinutes": 25,
    "weekGoal": "Die App kennenlernen",
    "focus": "Funktionsdemo",
    "description": "Keine individuelle Trainingsempfehlung.",
    "steps": [{"id":"warmup","title":"Aufwärmen","details":"Individuell anpassen."}]
  }]
}
```

The supplied plan is defined in `training-plan.js`. It contains only the training schedule and exercise instructions, no private university calendar feed or personal health profile. Workouts support validated `startTime`/`endTime` (`HH:MM`), `optional`, `sessionCode` and non-checkable `instructions`; `weekNumber: 0` labels the optional start. Plan-level `goalSummary` displays the July goals.

Optional `targetDate` (`YYYY-MM-DD`) and `targetLabel` add a target countdown; no date is assumed. Workout types: `run`, `strength`, `mobility`, `cycle`, `rest`, `recovery`, `other`, `longrun`, `tempo`, `race`. CSV fields: `date,title,type,durationMinutes,description,steps`; separate step titles with `|`. German column names Datum, Titel, Typ, Dauer, Beschreibung and Schritte are accepted. JSON/CSV files are limited to 2 MB and 2,000 workouts. Templates are available in the import dialog.

Backyard duration ranges are displayed verbatim; Pista does not invent a numeric duration for ranges. Set `durationMinutes` explicitly when time totals are needed. PDF standard fonts support German and Western European characters; unsupported characters are reported and replaced.

## Tests and deployment

`npm run check` validates JavaScript. `npm test` runs pure logic and reference-schema tests. `python tests/browser_test.py` uses Chromium and WebKit to check real interactions, mobile widths, persistence, import and downloaded PDFs. Artifacts contain screenshots and PDF previews.

The reference adaptation is applied by `scripts/adapt_backyard.py` on a GitHub Actions runner. The workflow commits the resulting application files to `main` only after all checks pass. The tested commit is then promoted to `gh-pages`; the release workflow checks SHA-256 digests of the public files and exercises the actual public URL. No local development server is required to use Pista.
