# Mabel TV channel layout validation

Validated and deployed on 3 October 2026. Source checkpoint:
`13ac0da7c3a1e472658310610c2e8f56fb92c2b4` plus the uncommitted task files.
No commit or push was made.

## Delivered layout

- Home and Mabel TV Up Next rails fit four complete cards.
- Mabel TV has a local Episodes / Films switch below Up Next. Both channel
  panels remain mounted. Switching preserves the page position and each film
  shelf's horizontal position, including a shorter panel at the document end.
  Any temporary space needed to prevent scroll clamping disappears as the
  parent scrolls upwards. A library refresh preserves the chosen panel.
- Episodes displays every channel in four columns, with no View all control.
- Films displays every film channel as a compact, clickable heading and a
  scrolling poster shelf. Four posters fit completely, with 12px of the fifth
  visible. The final spacing between channel shelves is 12px, reduced from
  the initial 22px following the owner's feedback.
- Header markup, the three primary Watch / Insights / Downloads tabs, global
  navigation, playback actions, search scope, downloads storage and API
  contracts remain unchanged.

Runtime changes belong to `portal/js/playback/view.js`,
`portal/css/experience-watch-channels.css`,
`portal/css/experience-mabel-queue.css` and `service-worker.js`.

## Source verification

- `git diff --check`: passed.
- `python -m unittest tests.python.test_architecture_guardrails`: 11 passed.
- `node --test tests/js/test-source-syntax.mjs tests/js/test-offline-service-worker.mjs`:
  19 passed, including the final shell revision.
- `npm run test:core`: 89 passed, 19 existing platform skips. This qualified
  the implemented behavior before the final CSS-only shelf-spacing adjustment.
- `playwright test portal-mabel-channel-browser.spec.mjs --project=iphone-webkit
  --project=iphone-chromium --project=ipad-webkit`: all nine passed again after
  the final 12px spacing adjustment. These cover every channel, four-column
  widths, the fifth-poster glimpse, unchanged header/tabs, opening and returning
  from a channel, full-library film search, keyboard tabs, refreshes, horizontal
  position and document scroll clamping.
- `playwright test portal-scroll.spec.mjs --project=iphone-webkit
  --project=iphone-chromium --grep "horizontal programme rails"`: both passed.
- The portal deployer's final architecture and smoke gates passed: 11
  architecture tests and 12 browser smoke cases, with two platform skips.

Focused screenshots were reviewed at 393px phone width in light and dark
themes, 320px narrow-phone width and 1024px iPad width. Real channel artwork
from the earlier read-only catalogue snapshot was used for visual review.
No frozen screenshots were replaced. There was no horizontal page overflow.

An initial PowerShell invocation accidentally included an existing `@visual`
cross-domain title-height test, which failed on an 18px Watch/Insights height
difference. Its markup and styles were outside this change and already matched
the live baseline. The normal core gate excludes `@visual`; the task-specific
header/tabs assertions and focused layout review passed without changing that
existing assertion or its snapshots.

## Deployment and live evidence

Used the existing managed portal checkpoint at
`C:\Users\danco\.codex\worktrees\portal-downloads\MabelTV`. All 128 portal
baseline asset hashes were reconciled with the live release before each handoff.
The deploy plan included 19 assets: only this task's runtime assets differed
from the live files; the other selected files were byte-identical to the live
baseline. Concurrent backend/native work was not copied.

Both handoffs used `scripts/windows/deploy-portal-to-pi.ps1` against
`pinbecker@mabeltv-512.local`, with exact-file backups and hash verification.
Shell 274 delivered the layout; immutable shell 275 delivered the requested
tighter spacing. Final rollback backup:
`/var/backups/mabeltv/portal-quick-20261003213818-d8f4d629`.

Final active release: `/opt/mabeltv/releases/0.2.5-20261003103910`.

- Portal HTTP: 200.
- Native and Library services: active, successful, `NRestarts=0`.
- Native PID: `2494757`, unchanged from the initial baseline.
- Library PID: `2597492`; only the Library service was restarted.
- Native watchdog heartbeat: current at 21:39:18 BST.
- Health timer: active.
- Temperature: 54.5 C. Throttling: `0x0`.
- Service worker: shell 275, retaining shell 274 as the previous shell.

Final SHA256 values:

| Asset | SHA256 |
| --- | --- |
| `view.js` | `c1dd937c9090f1ecb0226474e925022744936afdbeb16cf57ab5fa45cbd91db1` |
| `experience-watch-channels.css` | `220e0fa54e5a77ae7a61ee189346981ffb1823bd47127340a94e17473deaa5d0` |
| `experience-mabel-queue.css` | `1d013c5330130c6ca0981c3dd5575006023de7788bafb0de7f5ca24542a16edd` |
| `service-worker.js` | `8c1ce2528717c74aae2cec0d251a271721e1800e4e4394ab7f71761675986a68` |

A fresh live WebKit context reached the portal but was stopped by its expected
PIN sign-in screen. It therefore did not establish a signed-in live user
journey. Installed-iOS acceptance remains the owner's review; the verified
handoff establishes the deployed source, HTTP availability and device health.
