# Pista testing

The current UI uses two pages, complete weekly lists, a single whole-workout completion state and one PDF entry point on the progress page. The original Backyard reference is retained only as historical design context.

## Automated checks

- The supplied client plan covers all 91 calendar days through 31 January: 37 unchanged training sessions and 54 rest days, including nine university sport sessions and the January time changes.
- First-visit setup, demo migration with exact backup, rest-day migration preserving existing training data and notes, preservation of personal plans, full-plan PDF overview and blank daily paper checklists.
- Rest-day checks and notes survive reload, and rest days do not add training minutes. Exercises, alternative instructions and notes export independently; paper boxes stay empty even for digitally completed sessions.

- Node: dates, schema validation, completion and reopening, backup/restore, CSV, merge, escaping, size limits, A4 PDF structure and pagination; plus the actual Backyard weeks/days schema, stable IDs, weekly goals, target-date validation and reference-view structure.
- Chromium and WebKit: six widths (320, 375, 390, 430, 768 and 1440), both pages, no page overflow, light theme even when dark mode is preferred.
- No overview page, inline card expansion, block checkboxes or period switcher. Exactly one PDF entry point on progress and none on the training page. Tapping card text does nothing; only the explicit button opens the workout.
- Backyard week import, week switching, focus/goal preservation and all seven days in the first/current week. Legacy partial block state stays inert; existing whole-workout checks remain intact.
- Progress and notes after reload; a separate persistent-profile test fully closes and reopens Chromium.
- Downloaded backups and real restores; invalid imports must not overwrite valid data; merge and undo; hostile HTML remains plain text.
- Downloaded A4 PDFs in every export period, extractable workout text, all page dimensions, text bounds and rendered previews. Exactly one empty checkbox per day/workout; no checkbox in an exercise appendix.
- Cross-tab propagation, offline reload, corrupt-storage preservation and visible storage-failure warnings.

The tests use pinned Playwright 1.64.1, pypdf and PyMuPDF on Ubuntu 24.04. These are browser-engine tests, not physical iPhone/Safari hardware certification. A green workflow is evidence only for its recorded commit and environment. Screenshots, result JSON, PDFs and previews are retained in GitHub Actions artifacts.

## Private GitHub backup coverage

The isolated module tests private-repository enforcement before reading/writing, exact SHA conflict handling, invalid/oversized files, credential hygiene, non-mutating state validation, disconnects and timeouts. The browser suite intercepts every GitHub API request locally and uses an invalid fixture token to test the actual form, explicit upload, reload without retained credentials, and restore preview/confirmation. It never uploads a real client's data or claims a live customer backup is configured. A real user's private repository and token must be connected by that user.

## Web-app update coverage

Install metadata and PNG sizes are checked, along with the installation button and fallback guide. Browser tests use a real service worker and a separate local server to install one release, publish a second and apply the update while retaining training checks, rest-day checks and notes. They cover the offline case and a second open tab. A simulated install-prompt event checks the app's integration without claiming an actual operating-system installation. Browser-engine checks are not physical-device certification.

The release generator hashes app files and icons. `npm run check` also runs its `--check` mode to catch stale metadata before publication. The production release check includes the generated version files, update module and install icons.

## Live verification

The `gh-pages` quality run compares public file SHA-256 digests against the publication commit before running the browser suite on https://kaikmedia-create.github.io/Pista/. This prevents reporting a stale cached release as the new version. Personal data is confined to isolated test profiles; no existing user's saved state is touched.
