# Studio optimisation build - 4 November 2026

The approved build is implemented on `main`, after checkpointing and merging the
approved Studio library worktree. Superseded experimental worktrees are preserved
on the pushed `archive/optimise-copy-checkpoint-20261104` and
`archive/portal-downloads-checkpoint-20261104` branches. Their older UI was not
restored. The implementation follows the saved
[build plan](studio-optimisation-build-plan-2026-11-03.md) and
[12-point UX audit](studio-portal-ux-audit-2026-11-03.md).

## Processing and destinations

- Windows Studio 1.7.1 owns video preparation for desktop, portal, existing Pi
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
| Studio Node suite | 83 passed, including required real Intel encoding |
| Latest stage/backup boundary tests | 13 passed |
| Complete JavaScript owner groups | 22 passed |
| Core iPhone WebKit/Chromium portal gate | 219 passed, 19 existing conditional skips |
| Focused iPhone/iPad layout and visual cases | 8 passed; captures inspected |
| Real Electron desktop and lost-upload-ack workflow | 2 passed |

Tests include generated full-frame/profile comparisons, HDR, high frame rate,
interlace/SAR, decoder validation, original preservation, missing Intel,
recompression reuse, recovery after failed identity writes, Activity pruning,
isolated SQLite restore, backup checksum corruption, partial-media restore and
temporary/permanent Windows journal locks. The earlier accepted full-film
quality experiments were not rerun. Physical installed-iPhone acceptance remains
with Dan; emulated WebKit is not a substitute for that device review.

Runtime delivery evidence is recorded below after installation and deployment.
