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
  sources. Output is fast-start H.264/AAC stereo MP4, at most 30 fps. HDR is
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
