# Downloads interface validation — 3 October 2026

The portal Downloads sections for Mabel TV and My TV now share the Experience
design: device storage totals, local search, All/Ready/In progress filters,
separate progress and ready sections, accessible action buttons, options and
removal sheets, and an inline-error local PIN unlock sheet. My TV download
titles and counts remain hidden while locked. Closing the parent portal closes
the download sheets. Removing a device copy never removes the TV library item.

## Scope and tested inputs

Runtime ownership is limited to the downloads module, the shared offline
authorisation call, Downloads markup, its overlay and stylesheet, their two
include lists, and service-worker shell 267. No backend, native player, database
schema or downloads IndexedDB schema changed. Shell 266 remains the rollback
generation. Existing downloader, pause/resume, media range and PIN verifier
implementations are reused.

Tests began against HEAD `920944b933e22c90e29d4b651bac6aebf5c7956e`
with the task's working-tree changes. The concurrent native-menu task later
committed its own files; deployment used an isolated managed worktree at the
original HEAD containing only this task's portal files, test and architecture
documentation. The eight runtime SHA256 hashes are saved in
`out/portal-downloads-validation/runtime-hashes.json`.

## Checks

- `git diff --check`: passed.
- `python -m unittest tests.python.test_architecture_guardrails`: 11 passed.
- `node --test tests/js/test-source-syntax.mjs tests/js/test-offline-service-worker.mjs`:
  19 passed, including Blob/ArrayBuffer ranges, client access isolation,
  offline PIN verification and retained shell/download storage.
- `playwright test portal-downloads.spec.mjs` on iPhone WebKit, iPhone Chromium
  and iPad WebKit: nine filter/search/removal and theme/layout checks passed.
  The three new PIN tests initially had an ambiguous test locator, which was
  scoped to its dialog; the focused rerun passed all three. Cancellation,
  incorrect/correct PIN and closing private menus when locked are covered.
- `npm run test:core` on the final runtime inputs: 69 passed, 19 existing
  platform-specific skips. Covers navigation, media, real Chromium worker/PIN
  access, version-one download migration and cold offline shell navigation.
- Intentional Downloads screenshots were reviewed in light and dark themes on
  phone/tablet, including options, confirmation and PIN sheets. UI fixtures use
  supported legacy binary chunks because Windows WebKit cannot persist Blob
  fixtures; the existing Chromium PWA tests cover real Blob downloads.
- The older `portal-light.spec.mjs` Home/Watch visual case failed at its
  **Home** screenshot before reaching Downloads on both phone browsers.
  Those unrelated frozen baselines were left unchanged. The focused Downloads
  captures and layout checks above passed; no screenshot assertion was weakened.

## Live handoff

The first deployment stopped before copying because the other native-menu
task was switching releases and services were temporarily inactive. After
services recovered, the guarded portal-only deployer passed its architecture
check and smoke gate (12 passed, two existing WebKit worker skips), backed up
the live files and deployed the eight selected assets.

- Live release: `/opt/mabeltv/releases/0.2.5-20261003103910`.
- Rollback backup: `/var/backups/mabeltv/portal-quick-20261003104120-e5dc5764`.
- Native player PID remained `2494757`; Library PID after its required restart
  was `2496988`. Both services were active with zero automatic restarts.
- Worker shell 267, deployed-file hashes and HTTP responses were verified.
- Native systemd watchdog configured at 90 seconds with a fresh heartbeat and
  successful service result; health timer active. Temperature 58.4 C at
  deployment, 52.1 C on follow-up; throttled flags `0x0`.
- The live portal was opened through an SSH loopback forward to the exact
  development hostname, using a secure localhost context for the worker.
  Closing and reopening the browser tab activated the new shell; both TV
  Downloads routes visibly rendered the new interface. Live empty-library
  screenshot: `out/portal-downloads-validation/live-my-tv.png`.

Real installed iPhone/iPad PWA acceptance remains the owner's review step.
Browser tests do not establish physical-device media playback or storage quota
behaviour. No task files were committed or pushed by this Downloads task.
