# Local-film search fix — 3 October 2026

## Cause and repair

Studio successfully published `Shrek.mp4` (1,826,215,957 bytes), with stable
library ID `d84e7cc30b8f497b97633923c2488118` and `browser_ready: true`.
Its metadata was empty. Discovery therefore returned both the unmatched local
file and TMDB's Shrek (movie 808, 2001). The portal's unmatched-card branch
refused to open the local file until it had metadata, although the existing
local-film detail and playback actions support unmatched files.

The card now resolves its current local path and uses `openMyTvFilmDetail`,
which already falls back to the playable local-film sheet. A stale path reports
that the film is unavailable. Metadata matching remains an explicit operation;
search does not guess identities or mutate the database.

The existing Shrek file was linked to the verified movie 808 using the supported
authenticated `/api/tmdb/apply` endpoint. Artwork is `tmdb-808.jpg`. Discovery
now returns exactly one Shrek movie result, with its local file and streaming
availability on the same title. No original file or library ID changed.

Before that metadata operation, the installed migration tool made and validated
an online SQLite backup at
`/var/backups/mabeltv/shrek-metadata-20261003-before-match.db`.
Read-only comparisons with that snapshot confirmed Shrek's rows in the six
personal viewing/history/list/rating tables were unchanged. Live integrity and
foreign keys passed. The projection's descriptive `updated` timestamp changed
with metadata; its personal viewing facts did not.

## Validation and live evidence

- Main checkout base: `13ac0da7c3a1e472658310610c2e8f56fb92c2b4` plus task
  working-tree changes. Unrelated Studio/backend work was preserved.
- `git diff --check`: passed.
- Architecture and My TV viewing Library owner suites: 24 passed.
- JavaScript syntax and service-worker owner suites: 19 passed.
- New local-film search browser tests: six passed on iPhone WebKit/Chromium,
  covering unmatched cards, exact device/TV playback payloads, device-player
  Back navigation and stale files. An explicit iPhone user agent selects the
  real iOS player path in Windows browsers. Playback responses are mocked;
  Windows WebKit's native media request can bypass those mocks and reach the
  intentionally incomplete fixture media endpoint. These tests establish the
  card/action contract, not physical iPhone decoding.
- The new spec is registered in `npm run test:core`. Final core gate: 75 passed,
  19 existing platform-specific skips, across 94 cases.
- A separate live, short-lived external token served the Shrek MP4 header:
  HTTP 206, `bytes 0-65535/1826215957`, 65,536 bytes, MP4 `ftyp` signature.
  The token was released. This check does not replace a device playback stream,
  wake the TV or write viewing progress.
- Live search and title sheet visibly showed one Shrek with artwork, the Mabel
  TV availability badge, streaming providers and both local playback buttons.
  Captures and operation evidence are under `out/shrek-fix/`.

## Deployment

The existing isolated portal worktree was reused. Its prior Downloads assets
were reselected unchanged; the new runtime edits were only `catalogue.js` and
worker shell 268, retaining shell 267 for rollback. No backend/native/database
schema or downloads-storage change was deployed.

- Guarded portal deployment smoke gate: 12 passed, two existing WebKit worker
  skips; architecture gate passed.
- Live release: `/opt/mabeltv/releases/0.2.5-20261003103910`.
- Portal rollback backup:
  `/var/backups/mabeltv/portal-quick-20261003132047-7d33bbe5`.
- Live catalogue SHA256:
  `37b685699481f77e8b56e3cb8f7667000c230d8f750c21309e2d6dc874398e7a`.
- Live worker SHA256:
  `d252a3d589028afa7730ac24c9c19bd40f9913f6ebf6b4621a2a6821474c667d`.
- The assembled HTTP bundle returned 200, contained the playback fallback and
  no longer contained the metadata-required error.
- Native PID stayed `2494757`. Library PID after its restart was `2520532`.
  Both services active, zero automatic restarts, fresh 90-second watchdog
  heartbeat, health timer active; deployment temperature 47.2 C, throttled `0x0`.

No files were committed or pushed. Installed iPhone playback remains the
owner's acceptance check; browser/API evidence does not establish TV or iOS
decoder behaviour.
