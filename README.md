# Pista

Public app: **https://kaikmedia-create.github.io/Pista/index.html**

A compact, mobile-first training planner. The app has two pages: **Trainingsplan** and **Fortschritt**. The visual starting point was the user's Backyard Tracker; the current interaction is deliberately reduced to a complete week, one completion control per day/workout, and an explicit **Workout anzeigen** button.

## Features

- Public GitHub Pages with no subscription, runtime CDN or required login.
- Complete Monday–Sunday view only. The prepared plan covers all 91 dates from 2 November 2026 to 31 January 2027: 37 unchanged training sessions and 54 rest days. The six days before the optional 8 November start are explicitly marked as before training starts.
- Current and future weeks are shown in full. Switching weeks never changes the layout to a month or two-week display.
- Each whole workout or rest day has one completion state. Cards do not expand; **Workout anzeigen** or **Ruhetag anzeigen** opens all instructions and notes together. Exercise blocks are read-only descriptions, with no individual checkboxes.
- Older plans and backups gain the missing days without losing completed workouts, notes or personal session edits. Legacy block flags are retained inertly for compatibility and never determine completion.
- A single **PDF-Übersicht** entry point on **Fortschritt**. The dialog keeps compact overview and paper checklist layouts, with whole-plan, week, two-week and month export ranges.
- Redesigned A4 paper checklists: one weekly sheet with Monday–Sunday rows, date, activity, time/duration, one empty box per day/workout and writing space. Optional exercise details use a separate readable appendix without extra checkboxes. Saved notes are opt-in.
- JSON/CSV import with validation, preview, replace/merge and undo. Local JSON backups and optional private GitHub backups.
- Installable web app with PNG/maskable icons, Apple home-screen help, offline shell and verified in-place updates that preserve saved progress.

## Your data and backups

App code, release history and the supplied generic training schedule are stored in this GitHub repository. Personal imported plans, completion and notes are stored locally under `pista.state.v1`; they are never written to the public app repository by the app.

**Einstellungen → GitHub-Sicherung** (also on **Fortschritt**) provides an optional manual external backup. Connect your own separate **private** GitHub repository using a fine-grained personal access token limited to that repository with **Contents: Read and write**. The app checks repository privacy before reading or writing and blocks public repositories. The fixed file is `backups/pista-backup.json` (maximum 1 MiB); GitHub retains its commit history.

The token exists only in memory until disconnect/reload and is excluded from training state, local/session storage, exported files and application code. Only the non-secret repository name and last confirmed upload time are remembered locally. The app talks directly to `https://api.github.com`; redirects, cookies and credential caching are disabled. Each upload uses the file SHA that was read and shown first. Conflicting or interrupted changes require a fresh read instead of silently overwriting the newer backup. Restoring opens a preview and requires a separate confirmation, with the previous local state preserved for undo.

**This is manual backup, not automatic cross-device synchronization.** A GitHub account, a private repository and a restricted token must be supplied by the person using the app. No remote personal backup is active just because the application was deployed. A JSON file can also be downloaded and placed in iCloud Drive, Google Drive or OneDrive; the download alone does not mean it was uploaded to those services.

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

The supplied plan is defined in `training-plan.js`. It contains only the training schedule and exercise instructions, no private university calendar feed or personal health profile. Workouts support validated `startTime`/`endTime` (`HH:MM`), `optional`, `sessionCode` and read-only `instructions`; `weekNumber: 0` labels the complete introductory week. Plan-level `goalSummary` displays the July goals.

Optional `targetDate` (`YYYY-MM-DD`) and `targetLabel` add a target countdown; no date is assumed. Workout types: `run`, `strength`, `mobility`, `cycle`, `rest`, `recovery`, `other`, `longrun`, `tempo`, `race`. CSV fields: `date,title,type,durationMinutes,description,steps`; separate step titles with `|`. German column names Datum, Titel, Typ, Dauer, Beschreibung and Schritte are accepted. JSON/CSV files are limited to 2 MB and 2,000 workouts. Templates are available in the import dialog.

Backyard duration ranges are displayed verbatim; Pista does not invent a numeric duration for ranges. Set `durationMinutes` explicitly when time totals are needed. PDF standard fonts support German and Western European characters; unsupported characters are reported and replaced.

## Tests and deployment

`npm run check` validates JavaScript. `npm test` runs pure logic and reference-schema tests. `python tests/browser_test.py` uses Chromium and WebKit to check real interactions, mobile widths, persistence, import and downloaded PDFs. Artifacts contain screenshots and PDF previews.

The historical reference adaptation workflow is manual-only; it does not rewrite the current UI when source changes are pushed. The normal quality workflow tests `main` first. A verified commit is then promoted to `gh-pages`, where all public asset digests and the browser suite are checked against that exact commit.

## Design and API references

The paper layout follows the clear date/activity/time/duration and notes structure used in the [CDC physical activity diary](https://www.cdc.gov/healthy-weight-growth/media/pdfs/physical_activity_diary_cdc.pdf), adapted to the requested weekly workout checklist. Training content itself is unchanged by this interface release.

GitHub integration follows the official [Contents API](https://docs.github.com/en/rest/repos/contents), [fine-grained token guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), and [CORS support](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests).
