# Pista

A minimal, light, mobile-first training planner. Static HTML, CSS and JavaScript. No application backend, no account, no tracking, no runtime dependencies or external font/CDN requests.

**GitHub Pages:** https://kaikmedia-create.github.io/Pista/

## Features

- A clearly marked sample workout on the date of first use; no fabricated workout history.
- Individual exercise blocks and entire workouts can be checked and reopened.
- Immediate local autosave of the active plan, completion and notes. Storage failures are shown, not silently ignored.
- Overview, weekly/fortnightly/monthly plan views, completion statistics and an eight-week consistency chart.
- JSON/CSV plan import with validation, preview and explicit replace/merge confirmation.
- Full JSON backups and restore; the previous import is retained locally as a rollback slot.
- Searchable, downloadable A4 PDFs: week, two weeks, month, optionally including exercise blocks and notes. Automatic pagination; monthly calendar plus full training list.
- Responsive navigation, semantic controls, keyboard access, reduced-motion support and a scoped offline app-shell cache.

## Data and privacy

Training data is stored in `localStorage` under `pista.state.v1`, with the previous imported state under `pista.previous.v1`. It is **not committed to GitHub** and is not synced across devices. Closing/reopening the same normal browser preserves it; clearing browser/site data, private browsing or storage eviction can remove it. Export backups regularly. A corrupted saved value is preserved instead of silently overwritten. The public repository contains only app source and generic demonstration data. GitHub Pages handles web hosting and its own hosting logs.

## Training-plan format

Import UTF-8 JSON (maximum 2 MB, maximum 2,000 workouts, 80 exercise blocks per workout):

```json
{
  "schemaVersion": 1,
  "id": "my-plan",
  "title": "Mein Trainingsplan",
  "description": "Persönlicher Plan",
  "workouts": [
    {
      "id": "week-1-a",
      "date": "2026-11-09",
      "title": "Beispiel-Training",
      "type": "mobility",
      "durationMinutes": 25,
      "description": "Individuell anpassen; nur Formatbeispiel.",
      "steps": [
        {"id": "warmup", "title": "Aufwärmen", "details": "Anleitung hier eintragen"}
      ]
    }
  ]
}
```

Allowed types: `run`, `strength`, `mobility`, `cycle`, `recovery`, `other`. IDs are stable ASCII letters/numbers/hyphens/underscores and must be unique. Dates must be real local calendar dates in `YYYY-MM-DD` format. Keep IDs stable when updating a plan: merging matches workouts and exercise blocks by ID. Replacing a plan starts progress afresh; importing a full Pista backup restores progress too. Invalid files never partially replace a valid plan.

CSV supports comma or semicolon delimiters, quoted fields, escaped quotes and multiline descriptions. Header fields: `date,title,type,durationMinutes,description,steps` (German aliases: `Datum,Titel,Typ,Dauer,Beschreibung,Schritte`). `date` and `title` are required; separate exercise titles with `|`. Download fresh templates from the app. Ordinary PDFs are **not** training-plan imports.

## PDF behavior

Every page is 210 × 297 mm (A4 portrait). Weeks start Monday; two weeks means the containing calendar week plus the following week. Month means the full calendar month. Large content flows onto additional pages. The offline PDF writer uses standard Helvetica/WinAnsi, supports German umlauts and Latin-1 text, and reports replacement of unsupported non-Latin characters. PDF text is escaped; imported content is never executed.

## Development and tests

Serve the folder over HTTP, e.g. `python3 -m http.server 8000`, then visit `http://localhost:8000`. No build is necessary.

```
npm run check
npm test
```

GitHub Actions runs syntax and unit checks. The `gh-pages` branch is the publication branch; keep it at the tested release commit when updating. `.nojekyll` prevents unwanted processing. All URLs are relative, including the service worker, so project-site hosting under `/Pista/` works.

## Source provenance

This release is a new implementation of the requested Pista functionality. The supplied `backyard-tracker-v5.3.zip` was listed by the conversation file service but its bytes were not accessible in the build environment, despite materialization attempts. It has **not** been reviewed, migrated or represented as preserved source. No compatibility with its unknown storage/import format is claimed. The original archive has not been modified.

The icon is an original SVG P/running-track monogram. Apple-inspired here means a light, restrained interface, not Apple branding or affiliation.
