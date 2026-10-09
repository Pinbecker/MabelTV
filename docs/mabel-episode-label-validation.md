# Compact episode-count labels

Source verified on 4 October 2026 at
`13ac0da7c3a1e472658310610c2e8f56fb92c2b4` plus the uncommitted task files.

## Change and checks

Episode channel cards now use `CH 1 · 26 EP` instead of spelling out
`episode` / `episodes`. The current count and hidden-channel behaviour are
unchanged. Runtime scope was verified against live SHA-256 hashes: exactly
one label-expression replacement in `portal/js/playback/view.js`, plus the
immutable worker release increment from 276 to 277, retaining 276 as previous.

- `git diff --check` passed.
- Architecture and portal owner suites: 25 tests passed.
- JavaScript source syntax and offline worker suites: 19 passed.
- The core browser run passed 87 cases and skipped 19 platform cases. Two
  cases failed solely because their exact-text assertions still required the
  old wording. Those assertions were changed to require the requested `EP`
  label; both affected cases then passed in iPhone WebKit and Chromium.
  Unchanged successful cases were not rerun.
- The artwork-based browser helper checked every displayed episode label
  against `CH <number> · <count> EP` and verified that its scroll width did not
  exceed its displayed width. It passed at 393px in light/dark themes, at 320px
  and at 1024px. No page errors or horizontal overflow were found.
- Final 393px and 320px episode screenshots were visually reviewed. No frozen
  reference screenshots were changed. A physical iOS PWA was not tested.

The existing managed portal checkpoint was reconciled with all 128 current
live portal assets. Only the two runtime task files differed; unrelated
backend/native work was excluded. Source checks apply to the exact runtime
hashes in `work/mabel-channel-mockup/ep-label-deployment-baseline.json`.

Detailed browser, JavaScript, baseline and deployment logs are retained under
`work/mabel-channel-mockup/ep-label-*`. No commit or push is authorised.

## Deployment proof

The guarded portal deployer completed against `pinbecker@mabeltv-512.local`,
including its architecture and browser smoke gates. Rollback backup:
`/var/backups/mabeltv/portal-quick-20261004052613-d8c79fdc`.

All 128 final live portal assets were verified against the prepared manifest.
Only the label owner and worker changed; both match the tested source tree.
All 22 backup assets match the preceding live baseline, including both task
files. Shell release 277 and previous release 276 were confirmed on the Pi.

Final health at 05:27:38 BST on 4 October:

- Release remains `/opt/mabeltv/releases/0.2.5-20261003103910`.
- Player PID remains `2494757`; library PID is now `2661746` after its restart.
- Both services active/running, successful results, zero automatic restarts.
- Player watchdog updated to 05:27:33 BST.
- Health timer active/waiting, triggered 05:27:18; health service successful.
- Portal HTTP 200; temperature 45.7 C; throttling `0x0`.
- No native build, player restart, commit or push occurred.
