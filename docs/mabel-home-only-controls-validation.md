# Mabel TV Home controls and shorter header

Validated and deployed on 3 October 2026. Source checkpoint:
`13ac0da7c3a1e472658310610c2e8f56fb92c2b4` plus the uncommitted task files.
No commit or push was made.

## Delivered behaviour

- Mabel TV Watch now goes from film search directly to the Episodes / Films
  switch and the channel browser. Continue watching and Up Next are absent.
- Home retains both sections, including resume, remove progress, queue detail,
  reordering, removal and playback. Programme menus in Mabel TV still offer
  Add to Up Next, and the result appears on Home.
- The phone header's earlier spacing is restored. The matching-to-Home
  overrides introduced by `bcfb417a97ce14621a1052f1d200fb47d76a5e44` were removed.
  `experience-responsive.css` was verified against that commit's parent,
  normalising only line endings for the comparison.
- The Watch / Insights / Downloads tabs, four-column episode grid, all
  channels, compact film shelves, four full film posters plus a 12px glimpse
  of the next card, 12px shelf gaps and stable toggle/scroll behaviour remain.
- Home markup, global navigation, playback, PIN boundaries and downloads
  persistence were not changed by this follow-up.

Runtime owners changed: `portal/html/views/watch.html`,
`portal/js/playback/downloads.js`, `portal/js/playback/mabel-queue.js`,
`portal/css/experience-home.css`, `portal/css/experience-responsive.css`,
`portal/css/experience-mabel-queue.css` and `service-worker.js`.
Unused Watch-only rendering and styling were removed with the two sections.

## Verification

- `git diff --check`: passed.
- Architecture guardrails: 11 tests passed.
- Portal experience owner tests: 14 passed. Obsolete assertions for the
  previous film banners and generic film heading were aligned with the
  already approved compact shelves and Episodes / Films panels.
- JavaScript source syntax and offline worker checks: 19 passed.
- Focused channel-browser, queue and Continue watching browser tests on
  iPhone WebKit, iPhone Chromium and iPad WebKit: 32 passed, 10 platform skips.
- Core browser gate, `npm run test:core`: 89 passed, 19 platform skips.
- The deployment checkpoint's architecture and smoke gates: 11 architecture
  tests and 12 browser smoke tests passed, with two platform skips.

Final screenshots were regenerated and reviewed with real channel artwork at
393px phone width, 320px narrow-phone width and 1024px iPad width. Light and
dark phone rendering also passed the layout helper. No horizontal page
overflow or page errors were recorded. Frozen screenshots were not replaced.

Browser checks use isolated repository fixtures. A physical installed iOS PWA
session was not tested during this task.

## Deployment and live evidence

Used the existing managed portal checkpoint at
`C:\Users\danco\.codex\worktrees\portal-downloads\MabelTV`, preserving unrelated
local and live work. A fresh comparison of all 128 live portal assets preceded
deployment. The deployer selected 22 assets: seven approved task files differed
from the live baseline; the remaining selected assets were byte-identical.

`scripts/windows/deploy-portal-to-pi.ps1` deployed to
`pinbecker@mabeltv-512.local`. Immutable shell release 276 retains shell 275 as
its previous shell. Rollback backup:
`/var/backups/mabeltv/portal-quick-20261003220524-b17fd762`.

Final live SHA-256 verification covered all 128 portal assets and all 22 backup
assets. Only the seven approved runtime files changed, each matching the
tested main tree. Every backup file matched the preceding live baseline.

Final health capture at 22:06 BST:

- Active release: `/opt/mabeltv/releases/0.2.5-20261003103910`.
- Native player PID stayed `2494757`; library PID changed from `2597492` to
  `2603312` following the portal-only library restart.
- Both services active/running, `Result=success`, `NRestarts=0`.
- Native watchdog advanced from 22:04:48 to 22:06:18 BST.
- `mabeltv-health.timer` active/waiting, latest trigger 22:06:12;
  `mabeltv-health.service` completed with `Result=success`.
- Portal HTTP 200, temperature 51.1 C, throttling `0x0`.
- No native build or player restart occurred.

Detailed logs, manifests and reviewed screenshots are retained in
`work/mabel-channel-mockup/home-only-*` and
`work/mabel-channel-mockup/implemented-*.png`.
