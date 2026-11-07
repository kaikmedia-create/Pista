# Pista quality and release checks

## Reproducible checks

`npm run check` validates the syntax of the four JavaScript modules. `npm test` executes 18 Node tests covering dates, leap years, daylight-saving boundaries, plan validation, CSV, backups, checking/reopening workouts, merging, HTML escaping, input limits and PDF structure/pagination.

`python tests/browser_test.py` runs the application under `/Pista/` in isolated Chromium and WebKit profiles. It checks six viewport widths (320, 375, 390, 430, 768 and 1440 pixels), all three main views, the light theme, absence of horizontal page overflow, exercise and workout completion, notes after reload, backup download and restore, invalid imports, import previews, merging, undo, quoted CSV, malicious HTML text, actual PDF downloads, cross-tab updates, offline reload, corrupt storage preservation and blocked-storage warnings. A separate persistent-profile test closes Chromium completely and reopens it to verify saved notes and completion.

The three exported PDF modes are parsed with pypdf. All pages must have A4 dimensions; expected workout/step text must be extractable. PyMuPDF verifies text stays within page bounds and renders PDF previews. UI screenshots, PDF files, previews and result JSON are retained as the `pista-test-evidence` workflow artifact for 14 days.

## Browser test runtime

The suite uses pinned Playwright 1.64.1 with its matching browser builds. The older 1.56 runtime failed a WebKit offline-emulation navigation with an internal engine error. This matches upstream microsoft/playwright issue 42775, addressed for 1.64. The offline test has not been deleted or weakened to conceal the failure; the test runtime was upgraded instead. Ubuntu 24.04 is explicitly selected for reproducible browser dependencies.

Upstream references:
- https://github.com/microsoft/playwright/issues/42775
- https://github.com/microsoft/playwright-python/releases/tag/v1.64.1

## Live release verification

Pushes to `main` test the checked-out app on an isolated local HTTP server within GitHub Actions. Pushes to the publication branch `gh-pages` first compare SHA-256 digests of all nine public app files against the release commit, then run the same browser suite against the real `https://kaikmedia-create.github.io/Pista/` URL. The test profiles contain only synthetic data and do not access another user's saved workouts.

A green workflow run is evidence of that specific commit and test environment, not a guarantee for every physical phone or browser. The current release result is available in the repository's Actions tab. Native Safari on an actual iPhone is not part of this automated suite. WebKit is browser-engine coverage, not a claim of testing physical Apple hardware.

## Data boundaries

Autosave is local to the browser profile and origin. It is not GitHub-backed cloud synchronization. Backups must be exported for migration or protection against clearing site data. The ZIP supplied in the conversation could not be read; compatibility with its unknown data format has not been tested or claimed.
