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
- Installable web app with PNG and maskable icons, Apple home-screen support, installation help and an explicit update button. Updates keep saved training data.

## Your data

App code and hosting are on GitHub. The supplied training schedule is part of the public app. Imported personal plans, completion and notes stay in localStorage under `pista.state.v1`. Version 1 data remains compatible. No automatic cross-device sync is provided. Export a JSON backup before clearing browser data or changing devices. Do not store a GitHub token in this public frontend.

## Web app and updates

Open **Einstellungen → Web-App installieren**. On supported browsers, the button opens the native installation prompt. Other browsers receive a short installation guide; on iPhone use Safari's Share menu and add Pista to the home screen. The existing app identity and start URL stay unchanged.

Pista checks for updates when opened, after reconnecting and when returning to the app (throttled). **Einstellungen → Nach Updates suchen** checks immediately. A ready release shows **Jetzt aktualisieren** in settings and a visible banner. Applying it reloads the app after activation. Other open tabs receive a prompt instead of an unsolicited reload. Training checks, rest-day checks and notes stay in localStorage; updates change only the application files. If local saving has actually failed, the interface blocks the reload so session-only data can be backed up first.

The service worker installs a complete release whose files match the release hashes before offering activation. `version.json` is fetched from the network for update checks; a failed or offline check is not reported as current. The cached app can still be used offline after its first successful installation. App updates do not provide cross-device data synchronization.

### Publishing a new version

After changing app files or icons, run:

```sh
npm run release:build
npm run check
npm test
```

Commit the generated `version.js` and `version.json` with the source changes. The release identifier follows asset content, so changed files are detected even if the visible version number stays the same. CI rejects stale release metadata. PNG icons can be regenerated from `logo.svg` with `python3 scripts/export_icons.py`; Inkscape is only a build-time tool.

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
