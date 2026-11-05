# Studio validation — 3 October 2026

## Studio 1.8.0 native desktop library — 5 November 2026

Studio 1.8.0 is installed. The owner completed installation after automatic
approval review blocked the original installer launch. The installed archive
exactly matches the tested package. All 25 existing queue IDs and the worker
identity are preserved. A fresh installed-executable check against the real Pi
opens 100 cloud cards, its episode selector and Find anything inside one Studio
window at studio://app/index.html, with no page errors.

iCloud library and Find anything now use the bundled desktop interface at
`studio://app/index.html`, with Studio's sidebar, typography, cards, dialogs
and destination forms. The old portal-window owner and openLibrary IPC were
removed. These sections contain no iframe, webview or external page.
The bounded desktop-library adapter calls existing authenticated Pi APIs;
renderer code cannot supply arbitrary endpoint URLs, magnets or local paths.
No Pi runtime or PWA changes are required; the portal remains Build 344.

Coverage includes cloud filters/sort/selection, retained decoded artwork,
episode/season choices, original/optimised/both retention, compatibility-only
delivery, torrent search/inspection/file selection, moving loading indicators,
clear/stale-search handling, optimisation preview and profile selection,
original recovery, explicit deletion/replacement confirmation and visible
changed-file errors. Server jobs appear in the native Activity before local
conversion journals exist. Active download speed and percentage are retained,
and queue artwork survives progress updates. Cloud operation completion and
catalogue revisions update the existing native library without clearing an
active selection. Conversion, notification, provenance and backup pipelines
are reused unchanged.

Validation on the final desktop source:

- `MABEL_STUDIO_REQUIRE_INTEL=1 npm test`: 110 passed, no skips or failures.
- `npm run test:ui`: all 11 actual Electron workflows passed, including the
  existing iPlayer, presence, title-review, interrupted-upload and restart flows.
- Architecture: 11 passed. Changed source syntax and diff checks passed.
- Native light layouts reviewed at 1360 x 900 and 1040 x 720.
- Development and packaged executables read the real Pi catalogue in isolated
  profiles: 100 film cards, an episode selector, one Studio window, no page
  errors. No live media job, download, deletion or conversion was queued.
- All 58 packaged runtime source files match the tested tree; bundled policy
  matches the Pi policy. The obsolete portal-window module is absent.
- Pi player and Library service PIDs/restart counts match before/after.

Installer: `dist/native-library-20261105/MabelTV Studio Setup 1.8.0.exe`
(231,627,494 bytes), SHA-256
`4461693cd5041e6675342678ced160a26ba7c1715cf0a326c3ebd3984905a0b3`.
Application archive SHA-256:
`fba945fc958dd4f2be421494d6512d1a7e16fd10e2af082c345c8c3caf91e8e9`.

Logs, source/archive hashes, real/synthetic screenshots, the previous installed
archive and pre-upgrade journal are in ignored
`out/studio-native-library-20261105`. Installed-archive equality, preserved
state and the two native screens were verified during source synchronisation.
The desktop update did not restart either Pi service.

## Studio 1.2.0 title matching

My TV films now receive an explicit title/year/artwork review before entering
the queue. A selected TV show is reviewed once for the batch. Imported videos,
iPlayer selections and locally prepared videos sent later share that owner.
Search correction, optional year filtering, cancellation and explicit skip are
supported. Confirmation does not rename or delete the source video.

The confirmed `(media_type, tmdb_id)` and device identity are persisted in the
transfer journal separately from BBC metadata. Publication is saved before
enrichment. The existing Pi API applies the identity using its returned filename
or selected series ID. Metadata failure leaves a successful, playable upload in
Completed with a separate retry; retries and interrupted enrichment do not
reconvert or resend the video, even after local cleanup. There is no backend,
database, native or PWA shell change in this update.

Validation for the Studio tree based on `13ac0da7c3a1e472658310610c2e8f56fb92c2b4`:

- Complete desktop owner gate, `node --test tests/*.test.cjs`: **27 passed**.
  Covers typed identities, device binding, published filenames, separate film
  and show APIs, unavailable metadata, restart and cleanup recovery.
- Complete actual Electron gate, `playwright test`: **5 passed**, including
  BBC search/artwork, current-file presence, real conversion, transfer recovery,
  confirmation/correction/cancellation and one review per episode batch.
- After the focused compact-dialog layout refinement,
  `playwright test tests/title-review.spec.cjs`: **2 passed**. Confirm and Skip
  stay visible at the supported 1040 x 720 minimum; results scroll separately.
- `python -m unittest tests.python.test_architecture_guardrails`: **11 passed**.
  `node --test tests/js/test-source-syntax.mjs` and `git diff --check`: passed.
  These complete desktop suites are this change's core gate; a native build
  or the unchanged PWA browser suite adds no signal to an isolated Studio edit.
- Focused full-size, minimum-size and retry-state screenshots were reviewed.

A generated one-second test clip passed the real Studio queue against the live
Pi: publication, explicit Big Buck Bunny movie identity 10378, artwork and a
single canonical search/detail result exposing the local playable file. It was
then moved to the recoverable recycle bin through the supported API, and absence
was verified. Original film count, Shrek's library identity and its complete
metadata remained unchanged. Live test upload ID:
`79044870dcd14a4198f35134d4656c62`.

The installed executable was checked with the existing owner profile and
Cloudflare session: real title search through `https://mabeltv.dancoakes.uk`,
Shrek 2001 artwork loaded, correction/selection rendered correctly, and cancel
performed no upload. All 12 existing job IDs/statuses/local paths and settings
were preserved. Evidence lives in ignored `out/studio-metadata/`.

Final silent installer exited zero. Installed and packaged application archive
SHA-256 both equal
`82b25fbaeb029c1ec2e6156a84498e8fde6639cff15ac4f0e5612d349f5222db`.
Installer SHA-256:
`51f3ca17a743f2e0cbdc436c7174caad6c8b3c6adbdd13695b143578d3bacc42`.
The previous 1.1 installer and pre-upgrade journal/archive remain available for
rollback. The final packaged executable was checked again after installation.

Pi runtime stayed on `/opt/mabeltv/releases/0.2.5-20261003103910`. Native PID
2494757 and Library PID 2520532 were unchanged; both active, restart counters
zero, fresh native systemd watchdog, active health timer, temperature 46.7 C,
throttling `0x0`. No Pi source release, native restart, commit or push was needed.

## Previous Studio 1.1.0 installed update

Current-file iPlayer presence, explicit download stages and consolidated local
media storage are installed and verified. No commit or push was performed.

- `node --test tests/*.test.cjs`: 21 passed, including safe duplicate cleanup,
  interrupted folder migration, retry without a removed original, precise
  episode matching and transient Windows journal replacement locks.
- `playwright test`: all three Electron specs passed. Real media workflow,
  rich live BBC search/artwork, sandboxing and layout remain covered; controlled
  inventory removal and offline checks remove stale positive presence badges.
- `python -m unittest tests.python.test_iplayer_library
  tests.python.test_architecture_guardrails tests.python.test_library_service_structure`:
  20 passed. Inventory is authenticated, bounded, current-file-based and excludes
  recycled/staged media; embedded IDs survive renamed files.
- `python -m unittest tests.python.test_library_http
  tests.python.test_library_auth_settings tests.python.test_library_sqlite_runtime
  tests.python.test_upload_management`: 32 passed.
- Global JavaScript syntax and `git diff --check`: passed. The backend files
  did not change after these successful Python owner checks.
- Final wording for previously prepared iPlayer items: `node --check ui/jobs.js`
  and the real Electron workflow spec both passed after that focused edit.

The backend was released with the guarded atomic installer, existing Pi
prebuilt and `--preserve-player`, overlaying only the three owned Python files
onto the previously installed appliance source. Active release:
`/opt/mabeltv/releases/0.2.5-20261003092036`; previous release:
`/opt/mabeltv/releases/0.2.5-20261003071250`. Installer backups:
`/var/backups/mabeltv/preinstall-20261003-092035.tar.gz` and online SQLite
`/var/backups/mabeltv/MabelTV-Backup-2026-10-03T082035Z.tar.gz`.

Final read-only SQLite checks: schema 11, integrity `ok`, no foreign-key
violations, 11 channels and five My TV shows. Both services are active with
restart counts zero; native PID 2457726 was preserved, library PID 2478092.
Native control socket exists, systemd watchdog is current and reports success,
thermal monitor is active, temperature 46.7 C and throttling `0x0`.
`sudo mabeltv-doctor` reports zero failures and zero warnings.

The installed Studio displayed real artwork and **Already on MabelTV** for
Banana, Dog, Book and Boots, using their embedded BBC episode IDs. The same
four markers were verified through the public portal with the existing
Cloudflare session. The current Pi inventory also confirms Shrek in My TV
films. Evidence is in ignored `out/studio-live-smoke/live-presence-evidence.json`.

All six retained iPlayer prepared files (Bluey minisode, four Yakka Dee episodes
and Shrek) were migrated to `C:\Users\danco\Videos\MabelTV Studio`. Each retained
file exists; all six validated duplicate originals are absent and cleanup
warnings are clear. The old default Media directory is empty. External source
files, including the earlier no-conversion smoke clip, remain untouched.
New jobs use readable item folders and separate destination profile folders.

Final installer SHA-256:
`f7adcf1e50b5feaee2fe787e9168d2cecc38b497a5c49ff8ed8faa70523a49fa`.
Packaged and installed application archive SHA-256:
`bd7f5fe6eafaf51e987f55831bb5dac0e573b1679fd9ba35b3e3b6713706fe22`.
Silent upgrade returned zero, the archive hashes match, and the app reopened
with its existing history, settings and remote-authentication session.

## Previous Studio 1.0.0 validation

The desktop application is isolated from the existing native, portal and backend work in this checkout. No commit, push or Pi source deployment was performed for Studio.

## Automated checks

- Desktop complete owner gate: `node --test tests/*.test.cjs` — 14 passed. Covers journal recovery, literal shell-free search, cancellation, real media conversion with preserved originals, interrupted transfers, server-confirmed offsets, publication, pinned upload origin and device mismatch.
- Actual Electron interface: `playwright test tests/desktop.spec.cjs` — passed. Covers sandboxing, navigation, live rich BBC search with loaded artwork, episode selection, settings and the minimum window size. Focused screenshots reviewed.
- Electron workflow: `playwright test tests/workflow.spec.cjs` — passed. Real preparation, send later, lost chunk acknowledgement, resume without repeated bytes, final publication and completed history after restart.
- `python -m unittest tests.python.test_architecture_guardrails` — 11 passed. Generated/third-party Studio resources are excluded consistently from both discovery and source budgets; existing limits remain unchanged.
- `node --test tests/js/test-source-syntax.mjs` — passed.
- `git diff --check` — passed.
- `npm audit --json` — zero reported vulnerabilities.

Node 24 was used for desktop development and packaging. Native/PWA builds add no signal to this isolated desktop change; the complete desktop owner suites and actual Electron checks are its core gate.

## Real service checks

- BBC: live Ludwig and Bluey search, episode metadata and artwork; actual Bluey minisode download (PID `m002yqvk`) completed with MP4, metadata and artwork.
- Local Pi: generated two-second clips were published to a Mabel TV channel, My TV films and an existing My TV show/season. Each was independently found in the library and moved to the recoverable recycle bin through supported APIs.
- Public portal: owner completed Cloudflare Access sign-in inside installed Studio. With **Remote portal only** selected, Studio published a generated clip through `https://mabeltv.dancoakes.uk`; independent library inspection confirmed it. Test upload ID `eac7641d0f4b4244a41486ca2ceaeebf`. Clip then recycled and absence from the library verified.
- Detailed local and remote smoke evidence lives in ignored `out/studio-live-smoke/`.

## Installed release

Per-user Windows installer includes Electron, get_iplayer/Perl and FFmpeg/FFprobe with their license notices. Desktop and Start-menu shortcuts launch the executable directly. The installer preserves local preferences, queue history and the isolated remote-authentication session.

Installer SHA-256: `1eb55b439861a23f52d4e6e732ea5f26ab0d9e7769190c29ec4a38b59d4353e6`.

Packaged application archive SHA-256: `09fb2160c25cbdad40c6b01b35019907ffc15152a8f86de56d674212c7bc6cd4`.

Silent upgrade exited successfully; the installed archive hash exactly matched the packaged archive. The app reopened normally, retained completed history, and immediately connected to the remote portal without a second sign-in. Both the Studio and previous Media Prep desktop shortcuts now target its executable directly; the old shortcut is backed up in the ignored smoke directory.

The final installed app fetched real metadata/artwork for Bluey PID `m002yqvk`, downloaded its 48,902,004-byte original with metadata and artwork, and prepared a validated 6,003,476-byte MP4 through its own queue. The original and prepared copy are retained in the app's working folder. Pi service health at the end of the live checks: both services active, restart counts zero, temperature 52.5 C and throttling `0x0`.

The installer is not backed by a commercial code-signing certificate. BBC availability and remote sign-in expiry remain external constraints; Studio retains local files and exposes retry/sign-in rather than reporting a failed transfer as complete.
