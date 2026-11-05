# Studio optimisation build - 4 November 2026

The approved build is implemented on `main`, after checkpointing and merging the
approved Studio library worktree. Superseded experimental worktrees are preserved
on the pushed `archive/optimise-copy-checkpoint-20261104` and
`archive/portal-downloads-checkpoint-20261104` branches. Their older UI was not
restored. The implementation follows the saved
[build plan](studio-optimisation-build-plan-2026-11-03.md) and
[12-point UX audit](studio-portal-ux-audit-2026-11-03.md).

## Processing and destinations

- Windows Studio 1.7.2 owns video preparation for desktop, portal, existing Pi
  optimisation actions and incompatible phone/USB uploads. The Pi stages and
  publishes files. Its retired CPU encoder refuses to run.
- Intel H.264 Quick Sync, slow preset and look-ahead are shared by Balanced,
  Compact and Smallest. No silent CPU or NVIDIA fallback. Encoder failure is
  actionable. Compatibility-only input can be remuxed without encoding.
- Size bands are estimates, about 40%, 60% and 75% smaller. Quality floors,
  existing compression evidence and destination caps take precedence. A known
  prepared version is reused for the same or a less aggressive choice. Further
  reductions use its recorded original size basis rather than multiplying cuts.
- Metadata inspection is cached by file identity, with a 15-second upper bound.
  Normal jobs do not run sample conversions or quality-scoring passes.
- Heavily compressed inputs require explicit confirmation when further encoding
  is necessary. Cloud-only optimisation keeps an unchanged source if a new
  conversion would not save space.
- Mabel TV is capped at 720p and My TV/iCloud at 1080p, without upscaling ordinary
  sources. Output is fast-start H.264/AAC stereo MP4; policy v3 preserves source
  frame rate up to 60 fps. HDR is
  tone-mapped to SDR; anamorphic geometry and interlaced input are normalised.
  BBC identity tags survive conversion.
- Original / Optimised / Both remain independent retention choices. Compact and
  Optimised are the usual defaults. Original in iCloud means the downloaded
  original. A recovered TV version is a high-quality Pi-compatible copy, with
  no forced Compact reduction. It may be larger than the original.

## Recovery, concurrency and notifications

Durable SQLite acquisition/delivery records retain BBC PID/URL, torrent magnet
and exact selected pack files, imported file/worker identity, source facts,
encoding evidence, physical variants and confirmed destination receipts.
Activity pruning does not remove those relationships. Surviving historical
evidence is backfilled; missing historical sources are not invented.

Download original works from cloud titles/selected episodes and Pi film/episode
actions. A retained original is preferred; otherwise the recorded source is
reacquired. Alongside and Replace existing are explicit choices. Replacements
freeze the previous identity and preserve library/viewing state. Pi replacement
uses a retained hard link and durable candidate/receipt so a process interruption
between filesystem publication and SQLite updates can be reconciled.

The existing five-download, one-conversion and one-Pi-transfer resource gates
remain separate. Apple upload confirmation holds none of these foreground
slots and has no file-count cap. HTTP progress batches remain bounded. Admission
respects the real free space and 20 GiB reserve. Provider confirmation shows an
indeterminate uploading state, with no percentage or ineffective controls.
Verified receipt reuse, owned scratch cleanup and cloud-cache eviction preserve
imported originals and explicit keep-downloaded pins.

Notifications are for a verified Pi destination, or verified iCloud completion
for cloud-only work, plus one attention notice for a failed job. Intermediate
steps do not generate phone alerts. Durable receipts prevent historical replay.

## Portal and desktop UX

Cloud cards open Actions; Send to TV opens the destination sheet. Child
management sheets return to Actions. Option sheets distinguish cancel and Done,
keep focus on their originating control and bound expanded content to the
visible viewport. Target TV collections and iCloud collections stay separate,
can be created in the relevant picker and filter by category. Repeated episode
edits preserve valid quality, destination, collection and retention choices.

Optimisation preview loading and errors live inside the preview, clear stale
size/savings data, reject late responses and disable submission until current.
Completed Activity receipts remain available. Existing search/inspection
spinners and file-size/release/title sorting are retained. The desktop exposes
the same shared iCloud/recovery and Find anything pages in a sandboxed app
window, alongside native drag/drop and BBC workflows. User wording is plain.

Remote status polling has one in-flight request, suspends on backgrounding,
refreshes on return and discards stale responses. A transient failure keeps the
last TV state and shows Reconnecting. Reads have bounded retries; writes do not
retry automatically. Protected diagnostics retain only bounded, redacted route
and timing breadcrumbs, not source URLs, credentials or request bodies.

## Backup and later bulk contract

All acquisition, delivery, variant, collection, source and notification receipts
are inside the authoritative SQLite database and its existing online-backup
path. Studio checkpoints its allowlisted recovery profile to that database every
five minutes; device-bound credentials require sign-in after a different-device
restore. Missing media is reacquired or requires reattachment, not resumed from
an imaginary byte offset. The explicit offline recovery utility is
`tools/studio/scripts/restore-profile.cjs`; it refuses a non-empty destination.

Full scheduled disaster archives are handed to the authenticated companion,
copied to `iCloudDrive/Backups/MabelTV/snapshots/YYYY/MM/`, and independently read
back from iCloud for SHA-256 verification. Connections exposes the last verified
offsite backup time. Existing OneDrive delivery is retained. Retention matches
the existing 7 recent, 35 daily, 12 weekly and 24 monthly policy and only prunes
known, verified, unchanged remote archive identities. Local export copies keep
seven verified recent archives. Media and disposable caches remain excluded.

Archive bytes, recovery-profile reads/writes and backup confirmation additionally
require a dedicated paired backup key, even when the normal portal PIN is off.
The Windows copy uses Electron/Windows private storage; the Pi copy is a private
secret file. A one-time pairing token is consumed after encryption. Different-
device recovery requires pairing again. The key is absent from profile snapshots
and ordinary portal responses, and no backup credential is embedded in URLs.

The later bulk feeder can submit the shared `/api/studio/jobs` contract with
frozen cloud source fields, per-item compression and `destination.unattended`.
Risky items return `QUALITY_SKIPPED` for review, without unattended pop-ups or
one notification per skipped item. It must freeze its manifest/exclusions,
avoid discovering its own outputs and resume from durable receipts.
**This build never arms or starts the full-library conversion.**

## Verification

Source checks completed before live delivery:

| Boundary | Result |
| --- | --- |
| Complete Python Library/SQLite suite | 505 tests: 499 passed, 6 existing platform skips |
| Studio Node suite | 85 passed, including required real Intel encoding |
| Latest stage/backup boundary tests | 13 passed |
| Complete JavaScript owner groups | 22 passed |
| Core iPhone WebKit/Chromium portal gate | 219 passed, 19 existing conditional skips |
| Focused iPhone/iPad layout and visual cases | 8 passed; captures inspected |
| Final recovery/recommendation journeys on iPhone and iPad | 14 passed |
| Latest recovery/architecture owners | 24 passed |
| Final shell/syntax owners | 19 passed |
| Real Electron desktop and lost-upload-ack workflow | 2 passed |

Tests include generated full-frame/profile comparisons, HDR, high frame rate,
interlace/SAR, decoder validation, original preservation, missing Intel,
recompression reuse, recovery after failed identity writes, Activity pruning,
isolated SQLite restore, backup checksum corruption, partial-media restore and
temporary/permanent Windows journal locks. The earlier accepted full-film
quality experiments were not rerun. Physical installed-iPhone acceptance remains
with Dan; emulated WebKit is not a substitute for that device review.

## Verified live delivery

- Installed Windows Studio **1.7.2**, using the existing profile. All 21 previous
  job IDs and the worker identity survived. The worker is online and advertises
  Intel policy v2, independent stages, collections, cloud optimisation and
  torrent support. The installed Intel encoder completed a synthetic hardware
  check. All 49 shipped source/policy files match the reviewed tree; installed
  ASAR SHA-256 is
  `c07531f1edbf61cfdfc66970f8a56b84f04115648ef7ced1f6734ebf7650db8a`.
- Pi release `/opt/mabeltv/releases/0.2.5-20261104084607`, with portal shell
  **331**. The guarded atomic installer and portal deployer passed. The TV player
  stayed PID 193988; Matter stayed PIDs 300351 and 300353. All remain active with
  zero restart counters. Final temperature was 49.1 C and throttle flags 0x0.
  The Library alone restarted for the application updates.
- Live SQLite is schema 12, integrity `ok`, with zero foreign-key errors. It
  retains 13 channels and 223 viewing sessions. Current Studio recovery data
  includes 12 acquisition records, 6 delivery records and the worker snapshot.
- The full coherent disaster archive
  `Backups/MabelTV/snapshots/2026/11/MabelTV-Backup-2026-11-04T032447Z.tar.gz`
  was uploaded by the companion and read back independently through iCloud.
  Its SHA-256 is
  `6833ae0baadea400793c2ae70e95015ead9310adc3adafb81e9548585577b9ec`.
  An isolated restore verified every archived checksum, SQLite integrity and
  foreign keys, plus the presence of secrets and coherent Matter state. The
  original OneDrive archive and its scheduled delivery remain in place.
- A separate current online SQLite/Studio checkpoint, created after this
  build's provenance backfill and profile capture, is at
  `Backups/MabelTV/checkpoints/2026-11-04/Studio-Recovery-2026-11-04.tar.gz`.
  Its independently downloaded iCloud checksum matches
  `f6a1fafcfda4c0ba665ea00ccfa8c59fa3b7c2a34b827ae1e52757707a3143a6`.
  This checkpoint also passed an isolated restore. It supplements the full
  disaster archive with the new Studio records; it is not a second full Matter
  snapshot. Future scheduled full archives include the current SQLite records.
- Backup archive/profile endpoints reject unpaired clients with HTTP 403 even
  with the ordinary portal PIN disabled. The one-time pairing token was consumed
  into Windows private storage, and the temporary provisioning copy was removed.
- The existing film/kids migration remains complete. At the 08:56 check, TV
  migration was on batch 16 of 16: all ten files copied and verified, with iCloud
  upload confirmation pending. The controller remained running with 46.2 GiB
  free. The later bulk optimiser was still `waiting_for_start`, unfrozen, at
  index zero. No source deletion or full-library optimisation was started.

Evidence logs and inspected captures are under `out/studio-upgrade-*` in the
development checkout. The private pre-upgrade Studio checkpoint is under
`%LOCALAPPDATA%/MabelTV-Upgrade-20261104/before-1.7.0`; application rollback points
were retained by the Pi installers and portal deployer.

## Studio corrections after phone review, 4 November

The follow-up phone review rejected the extra title-action landing page, varying
sheet sizes, clipped collection options, verbose expandable optimisation copy and
tall Activity cards. iCloud titles now open Send to TV directly. More and all its
child pages share a fixed near-full-height frame; only the body scrolls. Collection
forms use non-shrinking children, retaining the last option and creation controls.
My TV and iCloud collection names remain independent and explicitly labelled.
The delete action is a quiet red-text row, with its named confirmation retained.
Optimisation keeps artwork, the three quality choices and before/after estimates,
without expandable technical paragraphs. Activity uses compact rows and a single
failure message. BBC's separate refresh icon and the torrent information dropdown
were removed. Compression review has a confirmation action instead of Retry.

The Matrix failure was a retained torrent journal owned by a cancelled request.
Studio now checks the authoritative portal status before releasing such an owner,
verifies the qBittorrent tag and directory, removes only the torrent, and keeps its
files. Paused, unknown and foreign owners remain protected. A per-hash in-flight
lock prevents overlapping handoffs. Lost removal acknowledgements are recoverable.
The live Matrix retry finished downloading and reached QUALITY_REVIEW; further
lossy compression was not automatically approved.

Windows Studio 1.7.4 was installed with the normal installer. Its shipped companion
and torrent downloader match the source. All 21 pre-existing job IDs and the worker
identity survived; the current profile has 22 jobs including Matrix.

Validation: 89 Studio Node tests passed; 11 architecture checks and 19 JavaScript/
worker checks passed. The core browser run passed 210 tests with 19 conditional
skips and one Chromium browser-start failure before the test could execute. The
isolated rerun and final iPhone WebKit/Chromium/iPad review passed 33 tests with
three phone-only skips. An earlier 34-test Studio owner run and six Find anything
journeys passed. Light/dark phone and tablet captures were inspected. Physical
installed-iPhone acceptance remains with the owner.

Evidence: `out/studio-corrections-*`. No full-library optimisation was armed and
no OneDrive source media was deleted. This follow-up is left as local source
changes; no new commit or push was requested.

Live delivery: portal shell 332 is confirmed over HTTP; the removed refresh and
expandable optimisation markup are absent. The deploy smoke passed 12 tests with
two conditional skips. Rollback is
`/var/backups/mabeltv/portal-quick-20261104114403-5d0bb63c`.
The native player PID remained 193988; Matter PIDs remained 300351 and 300353,
all active with zero restarts. The Library is active at PID 392748. Temperature
was 49.1C with no throttle flags.


## Second phone review: existing film components and native controls

The owner rejected the custom Studio option pages and joined settings rows.
This supersedes the collection and equal-height settings decisions above.
iCloud collection filtering and assignment are removed from the portal; My TV
collections remain. Stored media and historical associations are untouched.

Send to TV now uses the existing film header and its existing cog beneath Close.
The cog opens the existing content-sized film-settings layout with separate
shared action cards. Library, My TV collection, show and quality are visible
native controls, without hidden duplicate selects or intermediate option pages.
New My TV collections are created inline with the Pi scope. The submit action
names its destination instead of saying Add to queue.

The owner also caught shared CSS overriding the intended spacing. The Studio
body layout now has sufficient selector specificity to retain its gaps. The
optimisation comparison is plain current/estimated size and saving, without
format tags or percentage badges. The replacement note is separate and brief.
The main Send to TV page no longer has a size-reduction box. Close, Escape and
outside taps are checked through the shared dialog lifecycle. Named deletion,
original replacement confirmation and quality-risk confirmation remain.

Evidence for this revision is in out/studio-native-*. Focused light/dark iPhone
and iPad screenshots were reviewed. The initial focused run had 39 passes and
three assertions for deliberately removed copy/controls; those expectations
were corrected and the targeted phone/tablet rerun passed all eight tests.
JavaScript/worker checks passed 19 tests and architecture checks passed 11.

## Delivery compatibility and truthful Activity stages

Normal delivery no longer stops for permission to recompress an already small
file. It falls back to the compatible profile, which still inspects the media:
ready files are reused, container-only incompatibilities are remuxed, and other
incompatibilities are converted and validated. Dedicated iCloud space-saving
requests retain their quality-risk confirmation. The actual prepared profile
is recorded, rather than labelling an unchanged copy Compact.

Activity uses compact rows and actual stages, including downloaded/preparing,
sending to My TV and on My TV/uploading to iCloud. Old quality-blocked delivery
jobs offer Continue to My TV without authorising further compression. Only an
explicit iCloud optimisation offers Compress anyway.

TV-folder membership now groups unnumbered extras and specials with their show.
The live Office UK catalogue has 21 entries in one TV series: six in each season
and nine extras/specials. No media files needed moving.

Validation: core browser gate 211 passed, 19 conditional skips; Studio Node suite
92 passed; four targeted delivery-policy tests passed, including a real Intel
HEVC-to-H.264 conversion and a lossless MKV remux, both validated with originals
unchanged. Studio Python suite 117 passed; architecture 11 and JS/worker 19
passed. Focused Activity review passed eight tests. Desktop workflow tests and
the updated common-worker metadata retry journey passed. Screenshots are under
out/studio-delivery-review; other evidence is out/studio-delivery-*.

Windows Studio 1.7.5 was installed normally; packaged media/queue/destination
files match source, all 22 job IDs and the worker identity were retained, and
the worker reconnected. Atomic preserve-player release
0.2.5-20261104124014 serves shell 334. Its pre-install backup is
/var/backups/mabeltv/preinstall-20261104-124013.tar.gz. Player PID 193988 and
Matter PIDs 300351/300353 remained unchanged with zero restarts. Library PID
403918 is active, the health timer and watchdog are healthy, schema 12 passes
quick_check and foreign_key_check, and the control socket is present.

Matrix job 063841b230d74478a4589d64af2db66e resumed through the normal API without
allowRisk. Its existing 1,992,052,865-byte download passed compatibility checks,
was reused unchanged with preparedCompression=compatible, and progressed into
the real Pi upload. Upload progress was observed; iCloud completion is not yet
claimed. Migration and bulk-optimisation processes were not changed.

## Matrix title publication follow-up

Live evidence showed Matrix did finish its Pi delivery and iCloud upload. The
initial exact-title lookup ignored the release year, so several distinct films
called The Matrix prevented a match. The iCloud organiser later selected TMDB
603 and the companion applied the artwork, metadata and English subtitles to
the Pi, but kept its torrent filename. The cloud organiser independently filed
the archive as Films/The Matrix (1999).mp4.

Studio now uses the release year when selecting a unique exact match. A later
successful film match also canonicalises the completed upload name. Its receipt
journals the video and subtitle moves, retains the library identity, updates
recovery receipts and supports retries after interruption or a lost response.
Existing destinations are never overwritten. Explicit test/variant names and
Pi replacement jobs retain their labels. The companion persists the returned
publication name and forwards the canonical title through torrent progress;
Activity rerenders when that identity arrives.

Metadata-only torrent retries use their published local job records, without
re-downloading cleared sources or re-running cloud archival/cleanup. No migration
or full-library compression settings are changed by this repair.

Validation: Studio Node suite 96 passed; final affected matching tests 9 passed;
Studio Python suite 121 passed, metadata owner 17 passed, architecture 11 passed,
and JavaScript/service-worker 19 passed. Both desktop metadata-review journeys
passed. The focused Activity identity update passed. Core browser run had 210
passes, 19 conditional skips and one Chromium process closing before a context
could be created; that unchanged test passed its isolated rerun. No assertion
was weakened. Evidence is under out/studio-title-*.

Live delivery: Windows Studio 1.7.6 retains all 22 jobs and the worker identity;
packaged changed files match source. Pi atomic release 0.2.5-20261104131151 serves
shell 335. Backup: /var/backups/mabeltv/preinstall-20261104-131149.tar.gz. Native
player PID 193988 and Matter PIDs 300351/300353 remained active with zero
restarts; Library PID 411923, watchdog, control socket and health timer are
healthy. Schema 12, quick_check and foreign_key_check passed; no throttling.

Matrix was repaired via the metadata action on its existing job. It completed
without warning, and its local/remote publication receipt now names
The Matrix (1999).mp4. The Pi's video is the same inode 258131, 1,992,052,865 bytes
and unchanged modification time. Its English sidecar is the same inode 257781,
93,403 bytes, now The Matrix (1999).en.srt. Library identity
8dbc8e981bef415487c529a18a12ae9f is unchanged; TMDB 603 metadata, artwork and
browser readiness are present. No download, conversion or replacement copy was
needed for the repair.

## New collection keyboard behaviour

The owner's installed-iPhone screenshot showed the film card shrinking to the
keyboard-reduced visual viewport, leaving its fixed artwork header and footer
around an unusably small form. Studio title-card height no longer uses the
keyboard-reduced viewport. While editing, the whole card can scroll inside its
normal frame, with trailing space for the occluded region. Visual-viewport pan
and resize events reveal the focused field and inline Create action above the
keyboard. Keyboard dismissal restores normal body scrolling. Native focus uses
preventScroll so the document does not jump; the collection field disables
contact autocomplete.

Focused WebKit/Chromium phone and WebKit tablet tests passed all six journeys,
covering unchanged card geometry, keyboard pan, visible typing/Create action,
collection creation, dismissal, and existing sheet controls. Inspected captures
are under out/studio-keyboard-final. These tests simulate visualViewport changes
and mark the occluded region; they do not emulate the physical iOS keyboard.
JavaScript/service-worker checks passed 19 tests and architecture passed 11.

Keyboard follow-up delivery: core browser gate passed 211 tests with 19
conditional skips. The existing uncommitted backend changes were already live,
so the guarded atomic preserve-player route was used rather than bypassing the
portal deployer's mixed-source check. Release 0.2.5-20261104140722 serves shell
336; rollback snapshot is /var/backups/mabeltv/preinstall-20261104-140721.tar.gz.
The live bundle contains the keyboard handler. Native player PID 193988 and
Matter PIDs 300351/300353 are unchanged, active, with zero restarts. Library PID
422662 is active; health timer, watchdog and control socket are healthy. Schema
12 and SQLite integrity/foreign-key checks passed; temperature 52.5C, no throttle
flags. Installed-iPhone keyboard-animation acceptance remains with the owner.


### Activity download speed, stable artwork and loaded build

- Restored the existing worker-reported download rate alongside percentage.
  Numeric/rate changes update existing nodes; artwork and action buttons stay
  mounted. Compact poster thumbnails use recorded film/TV matches or a cached
  background title lookup. Ambiguous lookup results retain the icon and cannot
  block, approve or otherwise change a download.
- System and help now shows the build embedded in its loaded portal bundle,
  generated from `SHELL_RELEASE` rather than live server version data. Build 337
  identifies this pass; an old cached interface will not claim a newer build.
- Focused phone WebKit/Chromium: 8 passed on the final source, including retained
  DOM nodes during percentage and speed-only updates, zero rate, preparing-stage
  rate removal, film/TV posters, ambiguous fallback and server-version drift.
  Existing compact Activity/quality-flow checks also passed (8 cases).
- Portal owner/architecture: 25 passed; JS/worker: 19 passed. Final architecture
  and syntax rechecks after the artwork race guard passed (11 + 1). Phone visual
  capture inspected in `out/studio-progress-browser/`.

- Core browser gate: 211 passed, 19 conditional skips (8.6 minutes).
- Deployed with the atomic preserve-player installer to
  `/opt/mabeltv/releases/0.2.5-20261104161332`; backup:
  `/var/backups/mabeltv/preinstall-20261104-161331.tar.gz`.
  Live bundle and service worker both identify build 337; the served bundle
  contains the new rate rendering, stable progress and artwork helper.
- Player PID 193988 and Matter PIDs 300351/300353 stayed unchanged, active,
  NRestarts=0. Library active, health timer/socket/watchdog healthy; SQLite
  schema 12, quick_check ok, foreign-key check empty; 52.1 C, no throttling.
- The optional fresh-browser LAN-HTTP visual probe could not boot because the
  existing app requires crypto.randomUUID in a secure context. No production
  security or startup behaviour was changed for this probe. Focused rendering
  evidence is from the isolated browser fixture; the owner's HTTPS PWA remains
  the final real-device check.


### Automatic iCloud lock recovery and missing Activity posters

The Indiana Jones archive copy was complete (1,051,716,058 bytes) but Windows
returned EBUSY during final `.part` rename. A normal job resume completed the
archive without download/conversion and all original receipts were retained.
Studio 1.7.7 replaces the short synchronous rename retry with an asynchronous,
cancellable wait for EBUSY/EPERM/EACCES. It rechecks source identity and partial
size before attempts, preserves journal/media on cancellation, and does not
claim a successful archive before rename and cloud confirmation. Other file
errors still fail. The cloud wait occupies no foreground stage slot.

Build 338 displays the automatic file-lock wait and recognises `and`/`&` and
explicit franchise-prefix subtitles in artwork-only matching. Recorded TMDB
identities win; ambiguous matches keep their icon. Live search evidence covers
Deadpool & Wolverine and all four Wallace & Gromit shorts. The four shorts were
verified present in Pi `other-films` and iCloud `Kids/Films/Wallace & Gromit`.
The cancelled Curse of the Were-Rabbit iPlayer failure was not restarted.

Validation: Studio full Node suite 100 passed, focused phone WebKit/Chromium
20 passed, architecture 11 passed, JavaScript/worker 19 passed. Lock tests cover
recovery beyond the old retry window, event-loop responsiveness, cancellation
and resume without recopy, real I/O failures, and changed source rejection.
Studio 1.7.7 installed normally with exit 0; installed cloud-files and
companion-jobs match tested source, 23 jobs retained and companion online.
Profile snapshot path is recorded in `out/studio-lock-profile-backup.txt`.

- Core browser gate: 211 passed, 19 conditional skips (6.6 minutes). Build 338
  deployed to `/opt/mabeltv/releases/0.2.5-20261104174650`; backup
  `/var/backups/mabeltv/preinstall-20261104-174648.tar.gz`. Live bundle confirms
  build and both fixes; five actual poster endpoints return JPEG HTTP 200.
  Studio companion online, SQLite schema 12 / quick_check ok / no FK failures,
  health timer and control socket healthy. Player PID 193988 and Matter PIDs
  300351/300353 unchanged, active, NRestarts=0.

#### Playback report during this deployment - unresolved read-only finding

At about 17:48 the owner reported jumpy TV playback. Deployment load peaked
around 6 on the Pi, with temperature 68 C and no power/thermal throttling; it may
have contributed. Install finished, but drops continued with roughly 75% CPU
idle. Player log shows The Gruffalo's Child original started at 17:46:04;
ffprobe confirms H264 1280x720, 50 fps, and log reports no hardware decoder.
Render samples during/after install were approximately 20-24 fps. Display-drop
count rose 5350 -> 6141 between 17:49:14 and 17:49:44 (791/30 seconds), decoder
count remained zero. This is not resolved or proved to be solely deployment
load. No playback commands, source substitutions, conversion, player restart
or native changes were performed. Further playback diagnosis should begin
from these observations; avoid another heavy Pi operation during viewing.

#### Build 339 - acquisition, Activity and compatibility-only preparation

Added the Get action in the existing title-card settings position, only after
Pi and complete cloud-catalogue ownership checks. It opens Find anything with
the title and independently requests BBC search. Conservative matches offer
the existing episode/destination route; uncertain, stale or dismissed matches
do not replace torrent results or change the iPlayer tab's search state.
Activity artwork/title opens the shared title card after actual Pi ownership
refresh, preserving playback only for a present local copy.

Cloud-to-Pi quality now offers Compatibility only. The submitted preparation
intent reaches the Windows worker unchanged; it bypasses the size target and
reuses/remuxes/converts according to playback compatibility. It remains
separate from the three space-saving profiles. Existing original-recovery
routes are unchanged.

Validation: 104 backend/architecture checks plus 44 remaining Studio owner
checks passed; the Unicode ownership refinement passed all 11 metadata cases.
JavaScript syntax and offline-worker checks: 19 passed. Focused phone WebKit
and Chromium: 38 passed; final acquisition/Activity guards: 16 passed. Core
browser gate: 209 passed, 19 conditional skips, with two failures from its old
three-option assertion. The assertion now names all four requested options;
both affected WebKit/Chromium tests passed after correction. No acceptance
threshold or budget was raised. Live build constant is 339, companion online,
and an actual Iron Man cloud-ownership query returned one matching title.

The CRT work below is separately qualified by native tests and live playback;
portal feature completion does not establish a frame-rate fix.

#### Native CRT rendering follow-up

The original whole-picture ShaderEffectSource was the dominant rendering cost:
50 fps Stick Man fell to about 24 fps with the widescreen CRT enabled, while
effects-off/fullscreen reached its source rate. Decoder drops stayed zero.
The rejected fast candidate's separate unwarped OSD and exposed picture corners
are not retained.

The replacement reads the existing libmpv video texture directly, combines its
original foreground before the shared curvature/mask, and retains the original
cabinet vectors. Unchanged foreground and cabinet artwork are cached. Overlay
animations remain live and their final faded frame is captured. Fullscreen and
effects-off restore ordinary video presentation. No media is re-encoded, and no
decoder timing override, overclock or lower HDMI resolution is introduced.

Native coverage includes real libmpv texture orientation, removal/restoration of
the unwarped quad, frozen original CRT shader comparisons, foreground cache
invalidation/final alpha, and four cached-versus-original cabinet styles. The
final cache/effect group passed in 16.72 seconds; the preceding native UI,
texture, controller, libmpv smoke and complete owner checks are recorded in the
task evidence. The final architecture recheck passed all 11 checks. Nineteen
native build inputs matched the isolated Pi source by SHA-256.

Release `/opt/mabeltv/releases/0.2.5-20261104231156` was installed through the
guarded atomic installer, with backup
`/var/backups/mabeltv/preinstall-20261104-231149.tar.gz`. Portal Build 339 is
unchanged. Full 1920x1080 render captures were inspected for cabinet, curved
corners, channel label and paused tape treatment. Evidence and sustained
playback logs are under
`Media-Inventory-2026-10-31/playback-observations/crt-optimisation-20261104`.

The two-minute physical-TV Stick Man test produced steady samples of 49.10,
48.87 and 49.23 fps, with zero decoder drops and audio/video sync at zero.
There are still occasional display drops; this is a substantial improvement,
not proof of perfect 50 fps playback. Temporary capture/timing service overrides
were removed without changing the playback service during measurement.

Room on the Broom held 49.54 and 49.43 fps in its steady samples. Tabby McTat
held 30.00 fps and Up held 25.00 fps, both with zero decoder/display drops.
All four files were observed loading by exact filename; audio/video sync stayed
at approximately zero and no thermal/power limiting occurred. These measurements
use the owner's current widescreen, Glass 90 and Distortion 15 settings, not
every possible effect setting. Final playback test exited successfully and
restored Kids mode, widescreen, volume 35, unmuted, with Pi and TV in standby.

Final health: player/Library active with NRestarts=0, Matter and Alexa bridge
active, thermal monitor timer waiting, systemd watchdog last ping 2.46 seconds
old. SQLite remains schema 12, quick_check ok and no foreign-key errors. Portal
serves Build 339, one Studio companion is online and all 15 remote jobs remain.
Temperature was 55 C with throttled=0x0. Health is recorded in final-health.json;
the retired heartbeat-file path is not used by this watchdog-based release.

#### Build 340 - 5 November Activity latency and request failures

The owner reported intermittent banners and slow/non-opening Activity cards.
Protected diagnostics contain a 05:32 UTC library timeout; cloudflared records
interrupted library requests and origin EOFs at 05:31-05:32. The Library/player
had not restarted and no thermal/power limiting was present. Historical POST
failures were not captured by the previous client diagnostics, so the evidence
does not identify every banner.

Activity unnecessarily awaited full library/bootstrap refresh and device-cache
writes before opening a card. It now opens immediately; the selected title's
fresh Pi membership is checked through a local-only endpoint, independently of
metadata/cache reads. Playback stays hidden until confirmed. Closing/replacing
the card aborts its pending reads, and late cache results cannot replace fresh
network metadata. Failed artwork searches no longer remain cached permanently.

HTTP worker saturation previously closed the connection without a response,
which can become a generic gateway error. It now returns bounded retryable JSON
503 without increasing the worker ceiling. GET retries back off; actions are
not replayed. All failed methods and invalid JSON responses enter the existing
bounded, redacted diagnostics with no bodies or query values.

Validation: complete Python owner suite 516 tests, 6 conditional skips, no failures;
Pi HTTP suite 16 passed, JavaScript/worker checks 19 passed. New browser cases
hold metadata, membership and device cache unresolved while proving the card
opens, then verify fresh playback; they also cover stale cloud-only membership,
artwork retry, action diagnostics without replay/body capture, and busy recovery.
The deployment source archive contains 11 exact files, hash-verified against the
isolated Pi source before the player-preserving release.

Core browser gate with the new Activity/acquisition/upgrade cases: 251 passed,
19 existing conditional skips (7.3 minutes). The stalled-response card was
visually reviewed at iPhone size. No existing acceptance threshold or budget
was raised. The controlled test cache now replaces the test fixture's lexical
cache reader; the exported cache API is frozen and was not a valid mock target.

Build 340 is live in `/opt/mabeltv/releases/0.2.5-20261105055512`, installed with
the guarded `--preserve-player` route and backup
`/var/backups/mabeltv/preinstall-20261105-055511.tar.gz`. All 10 runtime source
hashes match the tested archive. The new live local-membership checks took
89.7, 45.6 and 45.5 ms on loopback, each finding its actual film. This is backend
timing, not an iPhone network/interaction measurement.

Player PID 565284 and Matter PIDs 606766/606768 remained unchanged; services
active, NRestarts=0. Library PID 632616 is active. TV/Pi standby, Kids mode,
widescreen, volume 90 and unmuted state match the pre-deployment snapshot.
SQLite schema 12, quick_check ok and no foreign-key errors; 49.1 C,
throttled=0x0. No native player change or media operation was performed.
Studio companion remains online with all 15 remote jobs. The separate validated
SQLite online snapshot is `MabelTV-Backup-2026-11-05T055511Z.tar.gz` (1,008,454
bytes); its archive checksum and database entry were verified. The smaller
preinstall tar contains service/configuration files, not the live database.

#### Build 341 - shared search clearing and read-only iPlayer/bulk review

Uncovered search fields use the existing Home signal-x button and shared CSS;
existing clear controls/handlers remain in place. Studio iPlayer, torrent and
title-correction searches submit with Enter, without separate Search buttons.
Clearing iPlayer/torrent searches invalidates pending results. The clear button
stays usable during loading. Enter in the embedded title-match field performs
metadata lookup and cannot submit a media job.

The iPlayer investigation did not change matching rules or the worker. Stored
requests and a fresh search through installed tools reproduced Ludwig with
zero results and Office Christmas Party with one exact result, PID m0033ttb,
6000 seconds. TMDB gives 2016 / 105 minutes. The existing confidence function
rejects the real BBC synopsis because it omits 2016; adding the year alone makes
it accept. It should corroborate exact/unique title, content kind, runtime and
metadata without requiring a release year in a short synopsis. Ludwig is absent
from the freshly updated schedule cache; get_iplayer's documented index is not
the full BBC catalogue. A broader verified BBC programme/PID fallback is needed.
Multiple episodes are already permitted by the series matcher.

All 20 film/kids and 16 TV migration receipts are verified, including cache
release. The bulk watcher remains waiting_for_start, index 0, unfrozen, with no
START-COMPACT.txt. Installed Studio 1.7.7 media policy/companion modules match
the reviewed source. The old feeder predates the current unattended skip
contract: it omits destination.unattended, treats failed/skipped work as a stop,
and lacks the requested per-title scope/profile exclusions. It must be updated
before an unattended library run, not merely armed. Current output caps at
30 fps; existing 50 fps BBC material should be excluded from an initial pilot
until its preservation policy is agreed and validated. Approximately 54 GiB
local free space suits small pilots, but the old 3x-source-plus-20-GiB check
would block the 17.5-GiB Avengers original by itself. Pilot originals should
remain available for the owner's visual comparison before replacement.

No bulk job, video download/conversion, cloud replacement or deletion was started.

Build 341 validation: the full core browser gate plus the search/acquisition cases
passed before the final obsolete-error guards. The final focused search suite
passed 14/14 across iPhone WebKit and Chromium, including late success/failure
after clearing, completed-result reset, Enter submission and no accidental job
submission. JavaScript syntax/service-worker checks passed 19/19; architecture
checks passed 11/11. Phone-sized visual proof uses the existing Home clear style.

The guarded player-preserving release is live at
`/opt/mabeltv/releases/0.2.5-20261105062947`. All 11 runtime hashes match the
reviewed archive; other portal/backend files and native binaries match Build
340. Player PID 565284 and Matter PIDs 606766/606768 remained unchanged, with
NRestarts=0. Library PID 641223 is active. SQLite schema 12, quick_check ok,
zero foreign-key errors; Studio online with 15 jobs. TV/Pi standby, Kids mode,
widescreen, unmuted and volume 90. Temperature 49.1 C, throttled=0x0.

Backups: `preinstall-20261105-062944.tar.gz` (configuration) and
`MabelTV-Backup-2026-11-05T062944Z.tar.gz` (validated SQLite online snapshot).
The tested archive, hash manifest, screenshots and live verification are stored
under `playback-observations/search-controls-20261105` in the migration inventory.
An unauthenticated automated HTTPS check received 403 from the public gateway;
local Pi HTTP serves Build 341. Installed-PWA adoption must be checked using
Settings / System and help / Version; no phone-cache clearing was performed.

#### Build 342 / Studio 1.7.8 - preserve source frame rate

Approved frame-rate correction only; the full-library optimiser remains idle.
Shared policy v3 removes the old 30 fps conversion/estimate/acceptance limits.
Progressive source cadence through 60 fps is retained using timestamp passthrough;
interlaced 25 fps is deinterlaced to 50 progressive frames, preserving field motion.
Unknown or unsupported actual source rates fail with originals kept. A metadata
preview without FPS can still estimate without probing/downloading a source.
Encoded outputs are checked against expected FPS and known source frame counts.
The H.264 level accounts for encoded canvas size and rate; 1080p50/60 uses 4.2.
Quality floors and risk estimates use the retained frames, not min(30, source).
Existing v1/v2 encoding proof is still recognised, avoiding repeated compression.

New uploads and existing-Pi optimisation returns accept supported 50/60 fps
H.264/AAC progressive output without re-queuing it. Old decoder-only helpers no
longer describe 50 fps as inherently unsupported. There is no native-player,
display, CRT-effect or real-media rewrite. Provenance records source interlacing,
audio presence, source/output FPS and policy v3 in the existing backed-up journals.

The Compatibility-only proof exposed LA_ICQ ignoring the supplied VBV ceiling.
It could make a complex 50 fps file that failed its own bitrate validation.
Compatibility encoding now uses the existing destination bitrate ceiling with
Intel look-ahead VBR, independently of source size; it applies no percentage
reduction target. Its disk check budgets that bounded output. Reuse/remux of
already-compatible video still avoids encoding. No playback limit was raised.

Validation:
- 18 actual Intel conversions: every choice at 720p50 and 1080p50; 23.976, 24,
  25, 29.97, 30, 59.94 and 60 fps; real interlaced 25-to-50; 1080p60 Compact
  and Compatibility. All independently decoded frame counts match their source
  (double for interlaced input); all output files fully decode.
- Actual moving pictures and seek passed in Windows WebKit and Chromium for
  six output files (12 cases), including 1080p50/60. These checks do not establish
  physical iPhone acceptance. Windows WebKit's absent frame counters are not
  represented as dropped frames; moving canvas samples prove actual rendering.
- Six isolated libmpv runs on the Pi completed at real time, with zero reported
  decoder drops and zero A/V offset: 720p50, 1080p50 Compact/Compatibility,
  540p60 and 1080p60 Compact/Compatibility. They used two software-decoder
  threads, null video/audio output and no live-player commands. They qualify
  decoding, not full CRT rendering or the physical TV display path.
- Complete Studio owner suite: 104 passed with Intel required; actual Electron
  prepare/send/restart workflow passed. Complete Python owner gate: 518 tests,
  six existing platform skips. Final changed-owner/Pi-return/architecture gate:
  48 passed. Core phone-browser regression: 211 passed, 19 existing conditional
  skips. Syntax/service-worker checks: 19 passed. No acceptance limit was raised.

The normal Studio 1.7.8 installer exited 0. Packaged/installed archives match;
all 52 shipped source/policy files match the reviewed tree. All 24 local job IDs
and statuses, worker identity and settings survived. Studio reopened in the tray
and the Pi confirms its connected worker with the existing 15 remote jobs.

Build 342 is live at `/opt/mabeltv/releases/0.2.5-20261105070205`, using the
guarded preserve-player atomic installer. Seven runtime hashes match the tested
archive; other backend/portal files and both native binaries match Build 341.
Player PID 565284 and Matter PIDs 606766/606768 remained running, NRestarts=0.
Library PID 649573 is active. SQLite schema 12, quick_check ok, no foreign-key
errors; 50.6 C and throttled=0x0. TV/Pi remain in standby, Kids/widescreen,
unmuted at volume 90. Backups: `preinstall-20261105-070203.tar.gz` plus the
validated online database archive `MabelTV-Backup-2026-11-05T070203Z.tar.gz`.

Exact archives, policy/results, browser and Pi proof receipts and the pre-upgrade
Studio archive/journal are under
`Media-Inventory-2026-10-31/playback-observations/frame-rate-policy-20261105`.
Synthetic clips are in ignored `out/studio-frame-rate-proof`; they were not
published into the real library. The bulk watcher's final check is still
waiting_for_start, index 0, with no START-COMPACT.txt. No real library conversions,
cloud replacements, deletions or migration operations were started.

#### Build 343 - artwork stability, Activity history and exact BBC film offers

Live read-only diagnosis found Severance and Silicon Valley's existing JPEGs
in the series metadata cache, but the endpoint rejected their older bounded
adult-series filenames. The read validator now accepts those legacy names
without permitting arbitrary paths or moving/rematching the files. Matrix
exists on the Pi with a valid poster and subtitles. Activity previously returned
early for a known TMDB identity with no poster, and therefore never used that
file's existing local metadata. All nine real completed entries resolve to
local posters with the new lookup, including Matrix, the four Wallace & Gromit
entries, Covenant, Deadpool & Wolverine and both Raiders receipts.

Decoded image nodes are retained across card refreshes, source metadata updates,
Home rails, film/series/season sheets, streaming and rental controls. Cloud
selection updates its small controls while keeping its poster/card nodes.
My Library reconciles cards during sorting. Unchanged provider badges stay
mounted, and unavailable availability summaries back off rather than requeuing
on every badge refresh. The existing bounded retry path remains for actual
failed images. Artwork lookup is presentation-only and never blocks a download.

Activity rendering is now in registered `studio/activity.js`. Completed/failed
entries reveal Remove with a left swipe; keyboard Delete is also available.
Active/queued/paused work cannot be dismissed. This marks historyHidden in the
existing durable job, preserves its status and media, and retains independent
acquisition/delivery/original-recovery records. No database migration or device
Downloads change is required. No real history entry was dismissed for testing.

The production BBC request still returns one exact Office Christmas Party film,
PID m0033ttb, 100 minutes, without a production year in its synopsis. The matcher
now accepts a unique exact movie title plus plausible complete runtime; explicit
structured/descriptive production years must agree. Wrong runtimes, remake
years, related titles and ambiguous exact films remain silent. An early Get tap
can fetch missing runtime separately without delaying or changing the torrent
search. The existing iPlayer tab query remains intact.

Validation: focused phone-browser coverage passed 49 cases with one existing
single-engine skip. The first broad regression exposed a selection-control DOM
contract; the implementation was corrected while preserving its original tests.
All six selection tests passed. The final 278-case core-plus-owners run had
257 passes, 19 existing conditional skips and two Chromium startup failures
before application code ran. Both failed cases passed on the focused three-case
rerun; no test assertion, timeout or acceptance budget was relaxed. The entire
522-test Python suite passed with six existing platform skips; all 19 syntax/
worker tests and 11 architecture checks passed. Light phone-sized closed/swiped
Activity proof was visually inspected. User's physical iPhone behaviour remains
the final device acceptance boundary.

The tested 20-file runtime archive, SHA-256 manifest, Activity screenshots,
filtered live artwork input and nine-title lookup proof are in
`Media-Inventory-2026-10-31/playback-observations/artwork-activity-20261105`.
Deployment uses the guarded atomic preserve-player route. Windows Studio 1.7.8,
the native player, conversion policies and existing media are unchanged.

Build 343 is live in `/opt/mabeltv/releases/0.2.5-20261105080431`. All 20
runtime hashes match; other backend/portal files and native binaries match
Build 342. Live poster endpoints return valid JPEG bodies for Severance
(58,673 bytes), Silicon Valley (48,221 bytes) and Matrix (139,642 bytes).
Player PID 565284 and Matter PIDs 606766/606768 remain unchanged, NRestarts=0;
Library PID 662072 is active. The native watchdog and health timer are active.
TV/Pi standby, Kids/widescreen, volume 90 and unmuted state match the deployment
snapshot. Studio is online with the same 15 remote jobs. SQLite schema 12,
quick_check ok, no foreign-key errors; 49.6 C and throttled=0x0.
Backups: `preinstall-20261105-080428.tar.gz` and checksum-verified online SQLite
`MabelTV-Backup-2026-11-05T080428Z.tar.gz`. Live verification/install logs are
stored beside the tested runtime archive. The owner can identify adoption in
System and help / Version / Build 343; no phone/download cache was cleared.

#### Build 344 - blank Windows Studio portal windows

Reproduced both desktop shortcuts using the installed Studio 1.7.8 executable
and an isolated empty profile. The local portal returned its document, but
startup threw `crypto.randomUUID is not a function` before revealing the app.
Chromium exposes randomUUID only in secure contexts; the supported LAN HTTP
address is not one. HTTPS/loopback browser tests had hidden this failure.

The shared foundation helper retains native randomUUID where available and
uses cryptographic getRandomValues with UUID v4 bits otherwise. Both the
startup upload identity and family upload identity use it. Existing stored
identities are retained; authentication, Electron isolation and local HTTP
permission rules are unchanged. Studio itself needs no replacement package.

The new LAN-startup browser owner reproduces the old blank page, checks both
routes without randomUUID, verifies new/persistent upload identities, and is
included in the normal core gate. Six focused cases passed across WebKit and
Chromium. Core regression: 217 passed, 19 existing skips, no failures. All 19
syntax/worker checks and 11 architecture checks passed. No native/backend code
changed and no native build was required.

An isolated detached checkout supplied exactly the four reviewed portal files
to the standard portal-only deployer. Its smoke gate passed 12 cases with two
existing skips. Build 344 is live in the existing release
`/opt/mabeltv/releases/0.2.5-20261105080431`; rollback files are in
`/var/backups/mabeltv/portal-quick-20261105110953-a64afc7e`. Complete before/after
runtime manifests confirm only foundation.js, actions.js, family/uploads.js
and service-worker.js changed. The separate remote atomic-deployment source
checkout was not updated by this portal-only deployment.

Post-deployment, the installed Studio executable opened both shortcuts on the
real non-secure LAN origin, with no page errors or Node/Studio bridge exposed.
iCloud rendered its first 100 title cards; Find anything rendered its search
page. Screenshots, exact file hashes, the installed executable verification and
gate/deployment logs are in ignored `out/studio-portal-window-proof`.
The running user Studio process stayed PID 93112, its worker/source identity
and all 25 queue item IDs were preserved; no downloads or transfers were
started. The Pi still has 15 remote jobs and one online worker. Native PID
565284, NRestarts=0 and all captured TV state remained unchanged (standby,
Kids/widescreen, volume 90, unmuted). Library PID 694763 is active, temperature
49.1 C, throttled=0x0. No commit or push was made.

#### Source reconciliation — 5 November 2026

Installed Studio 1.8.0 now exactly matches the qualified archive
`fba945fc958dd4f2be421494d6512d1a7e16fd10e2af082c345c8c3caf91e8e9`.
The installed-executable recheck loads the real cloud catalogue, its episode
selector and Find anything within one studio://app window, with no page errors.
All 25 prior local job IDs and the worker identity are retained.

The complete current Windows native build and all 11 CTest groups passed,
including the full Library/database owner suite, native controller/family UI,
JavaScript/worker, Matter socket and libmpv checks. The successful Studio owner
gate (110 tests), Electron gate (11 workflows) and Build 344 browser core gate
(217 passed, 19 existing skips) are reused because their runtime inputs have
not changed. The only native-source cleanup is one redundant final blank line.
Staged-source credential scans report no findings; generated builds, installers,
working journals and local credentials remain ignored. The grain PNG is a
required native runtime resource with its generator and regression coverage.

Before source sync, every active Pi portal/backend byte matched the Windows
working tree. The verified Pi native build matches both installed native
binaries, and its native source inputs match apart from the final blank-line
cleanup. No player or service restart is needed to reconcile source history.
Earlier detached insights/device-playback work was preserved on
archive/insights-deploy-checkpoint-20261105 as an archival checkpoint; it does
not replace the current approved main implementation.

Exact commit, source/archive hashes, installed-app checks, native/runtime
comparison and Windows gate logs are retained in ignored
out/source-sync-20261105. The Pi source snapshot receives the committed tree
and an independently verified SOURCE-COMMIT.json receipt after the push.
