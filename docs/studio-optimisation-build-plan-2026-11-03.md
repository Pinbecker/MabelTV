# Studio and portal optimisation upgrade — agreed build specification

Recorded: 3 November 2026. Updated: 4 November 2026. Owner: Dan.
Status: full build specification ready; Dan has selected Intel Quick Sync after
viewing the Compact output. The current readiness review records decisions and
requirements only; it does not execute application changes or deployment.

This is the permanent application build plan. It supersedes the earlier combined
checklist that also described film experiments, comparison-file cleanup and
OneDrive migration operations. Those one-off operations are outside this build.

## Timing and boundaries

- Portal/backend and installed Windows Studio work can proceed while the media
  migration runs. Migration completion is NOT a prerequisite for this build.
- Encoder decision confirmed on 4 November: use Intel Quick Sync. Dan accepted
  the viewed Compact picture; the live Pi check showed steady playback. Retain
  the completed comparison report and use the accepted Intel Compact settings
  as the production baseline, with the source-aware safeguards below.
- The full existing-iCloud-library conversion remains a separate, explicitly
  started operation, AFTER verified migration completion and Dan's exclusions
  and per-title profile selections. Finishing the build or migration must not
  automatically start it.
- This document authorises no build, deployment, deletion or bulk processing by
  itself. Start implementation when Dan gives the instruction.
- Preserve the approved portal design outside Studio. The scoped Studio UX and
  styling corrections in the [live-UI audit](studio-portal-ux-audit-2026-11-03.md)
  are now explicitly included in this build. Do not reapply the rejected styling
  pass or turn this into an unrelated site-wide redesign.
- Support one hardware encoder at a time. Simultaneous Intel/NVIDIA processing
  is outside the agreed scope.
- Reconcile the current live Studio UI with this checkout before implementation.
  The audit captured shell 327 / release `0.2.5-20261103181119`; 29 of 187
  normalised portal/shell assets differ from the local baseline. Preserve the
  newer collection/menu work and unrelated playback fixes rather than deploying
  the older local UI over them. Recheck this baseline when the build starts.
- The newer approved UI source is in the separate
  `design/studio-library-20261103` worktree at
  `C:\Users\danco\.codex\worktrees\studio-library-design-20261103\MabelTV`.
  Its changes are uncommitted; do not mistake main's clean application files
  for the complete deployed implementation. Recheck and preserve that work.

## 1. One shared Windows processing implementation

Use the installed MabelTV Studio application as the processing worker. The portal
queues work; the desktop interface queues work; a later bulk feeder queues work.
All use the same media analysis, profiles, encoder implementation, validation,
archive receipts and cleanup rules.

Cover these entry points explicitly:

| Entry point | Required behaviour |
| --- | --- |
| Desktop drag/drop or file picker | Shared recommendations, profiles, estimates, destination and retention rules |
| Desktop iPlayer/download flows | Same preparation and archive options as portal workflows |
| Portal iPlayer downloads | Download, prepare for destination, publish and retain selected cloud variant(s) |
| Portal torrent downloads | Same, preserving selected file/episode and existing managed torrent lifecycle |
| Send existing iCloud media to the Pi | Analyse/reuse/prepare through the same worker |
| Optimise iCloud version | Guarded space-saving replacement using the shared policy |
| Optimise an existing Pi file | Fetch through an authenticated Pi transfer route, process on Windows and return safely |
| Re-download original | Restore source, then follow the destination-specific rules below |
| Future bulk iCloud jobs | Same job contract and policy, with per-item overrides and bounded admission |

Do not create a second permanent encoder in the bulk scripts or leave the desktop
drag/drop implementation on older behaviour.

## 2. All video optimisation happens on the laptop

- Retire the Pi's existing explicit video optimisation execution path. Its action
  becomes a queued request for the Windows Studio worker.
- Audit implicit preparation during upload/import/publication as well as the
  explicit button. No route may silently fall back to encoding the video on Pi.
- If the laptop is offline, asleep, signed out or otherwise unavailable, keep
  the request durable and show "Waiting for laptop" or equivalent clear status.
- The Pi remains the authority for library state and publication. It may probe
  and validate media; this restriction concerns video conversion, not ordinary
  playback, metadata or artwork operations.
- Do not perform Windows work by directly editing Pi files or its database.
  Existing-Pi-media retrieval/return needs narrow authenticated API contracts,
  safe file identities, version checks, restart recovery and atomic publication.
- Preserve the existing file until its replacement is verified. Handle a file
  currently playing without interrupting the active player.
- An updated companion capability/policy version must prevent an older Studio
  installation from claiming work it cannot perform correctly.

## 3. Hardware encoder selection stays internal

- No NVIDIA/Intel/CPU, passes, presets or bitrate controls in ordinary UI.
- Use Intel Quick Sync (`h264_qsv`) automatically. The accepted Compact reference
  uses the slow preset and lookahead; retain its settings/provenance as the
  calibration baseline rather than forcing a fixed reduction on every source.
- Detect actual runtime availability and retain the selected method and settings
  in the job journal. Do not silently substitute NVIDIA or a much slower CPU
  encode. Report an actionable waiting/error state when the supported Intel
  route is unavailable; enable any fallback only after its policy is validated.
- Select the decode, resize, colour handling and encode pipeline coherently.
  End-to-end hardware acceleration is an implementation candidate to validate,
  not an assumed performance gain or a reason to change picture quality.
- Record enough diagnostic information to explain failures and performance
  without putting technical configuration into the normal user journey.

## 4. Balanced / Compact / Smallest policy

- Retain exactly these three normal space-saving choices. Compact is normally
  preselected; Dan expects to use it most often.
- Preserve approximately the established saving bands as goals: Balanced around
  40% smaller, Compact around 60% smaller, Smallest around 75% smaller.
- These are approximate goals, not a command to cut every already compressed
  source by that percentage regardless of quality. Final rate-control settings,
  safeguards and recommendation thresholds require the agreed evaluation result.
- Preserve as much quality as practical within the chosen size budget. Do not
  promise an exact reduction or guaranteed perceptual quality from metadata.
- Read duration, resolution, codec, bitrate and prior optimisation provenance.
  Reuse compatible copies already meeting the requested policy.
- Store original size basis, profile and policy version so another send does not
  repeatedly multiply the reduction on an already prepared copy.
- Further-compression risk depends on the actual source and destination, not
  whether content is categorised as kids or adult.
- Do not publish a space-saving replacement that is invalid or not smaller.
  Explain when keeping the existing copy is the appropriate outcome.

## 5. Analysis and estimates must remain quick

- Use cached catalogue facts for the initial preview. Do not hydrate an entire
  cloud file merely to make a recommendation.
- Once a file must be downloaded for processing, perform one quick probe, with
  bounded timeouts and cached results keyed to the meaningful file version.
- No routine sample conversion before every file. Uncertainty must not make
  sample encoding the default or add a substantial repeated delay.
- No full-film VMAF or similar heavy quality comparison in normal production
  jobs. Those are evaluation tools, separate from routine structural validation.
- Use calibrated, deterministic rules and conservative handling of unclear
  files; no per-file AI decision is required for this optimisation policy.
- Estimates use known size/duration and the chosen policy. Where information is
  unavailable, say so without inventing a number. Do not display an apparent
  space-saving recommendation that predicts a larger replacement.

## 6. Destination and terminology rules

"Original" means the unchanged acquired source, retained in iCloud. Never label
the Pi delivery choice "Original": it is a **Pi-compatible copy**.

| Destination / intent | Processing rule |
| --- | --- |
| Mabel TV channel, everyday copy | Pi-compatible, up to 720p, selected space-saving profile |
| My TV, everyday copy | Pi-compatible, up to 1080p, selected space-saving profile |
| Optimised iCloud archive | Selected space-saving profile, up to 1080p |
| Original iCloud archive | Preserve the actual source unchanged |
| High-quality Pi copy restored from source | Compatibility-first preparation, without the forced space-saving target; retain the destination's current resolution/format limits |

- Preserve lower source resolution; do not upscale to reach these ceilings.
- Retain the tested H.264/AAC MP4 and fast-start playback baseline unless a
  separately validated change is agreed. This build does not introduce 4K Pi
  or browser playback support.
- Every Pi-bound file must pass compatibility checks. Convert when necessary;
  avoid needless lossy re-encoding if the source is already fully compatible.
- Compatibility-first preparation is distinct from Balanced/Compact/Smallest.
  It can produce a larger file than the everyday Compact copy; preview this
  honestly and check destination space.
- When a 720p channel copy and an up-to-1080p cloud copy are requested, derive
  both from the source rather than treating the lower-quality channel copy as
  the new source for the archive.
- Preserve the existing automatic film title/year and series/season/episode
  naming, destination filing, metadata/artwork enrichment and Pi subtitle
  retrieval/publication when changing the processing route. Keep sidecars and
  variant names aligned with the final file; conversions must not strip the
  identity needed for these steps or overwrite a separately retained version.

## 7. Portal UI — concise, consistent, existing design

Retain the current artwork-led confirmation and before/after size presentation.
Use plain personal-app language, without advertising copy or "we'll check" text.

- Show current size, estimated finished size and estimated space saving.
- Offer Balanced / Compact / Smallest and a small Recommended marker, usually
  on Compact. Surface only short, relevant exception text.
- Keep Original / Optimised / Both archive retention choices; Optimised should
  be the normal default for Dan's ongoing download workflows.
- Preserve existing destination selection: My TV, Mabel TV channel, iCloud.
- Existing iCloud items retain "Optimise iCloud version".
- Before a risky manual recompression, show a concise warning explaining likely
  **picture-quality loss**, not file corruption. Allow keeping the existing copy,
  selecting a safer profile, or explicitly proceeding where permitted by policy.
- For unattended bulk jobs, skip uncertain/risky cases and report them rather
  than blocking on individual pop-ups. An override is a deliberate later action.
- Require clear confirmation of destructive replacement and show which copies
  are affected. A separate Pi copy is not implicitly replaced by a cloud action.
- Preserve usable phone/tablet layouts, touch targets, scrolling and reachable
  confirmation actions. No additional encoder-selection interface is needed.

## 7A. Studio UX and styling corrections — audited build requirements

The [live Studio UX audit](studio-portal-ux-audit-2026-11-03.md) is part of this
specification, including its reproductions, screenshots, priorities and limits.
It covers library controls, every reviewed menu/submenu and button journey,
destination settings, collections, episodes, downloads, optimisation, connections
and Activity. These are scoped corrections to the current Studio experience;
do not restore the rejected styling pass.

- **Panel bounds and layout (STU-UX-01, 05):** correct the shared mobile-dialog /
  Studio-panel height conflict. Bound the actual panel to the available viewport
  and safe areas; keep its header, close control and primary actions reachable,
  with one scrolling content region. Short destination forms must not reserve
  nearly a full screen of empty space. Include long collection lists, collection
  creation, nested options and expanded optimisation details.
- **Episode draft continuity (02):** changing the episode subset must preserve
  compression, destination, collection, retention and replacement intent where
  valid. Never silently reset Balanced / MCU to Compact / Unfiled. Keep the
  selected subset/count editable after Continue, including repeated edits.
- **Collection scope and coherence (03, 04):** distinguish the Pi destination's
  collection from the existing iCloud copy's collection. Populate/current-select
  from the correct authority, retain independent destination drafts, and make
  creation update the picker for the destination actually being edited. Define
  category/filter combinations and empty states. Do not blindly mirror Pi and
  cloud collections or treat intentionally shared Pi film/series collection
  names as corruption.
- **Actions and menu navigation (06, 07):** make routine iCloud actions directly
  discoverable without an unrelated send task. Specify a consistent parent /
  child return tree, option commit rules and Back / X / Cancel / Done behaviour.
  Remove redundant dismissal steps where appropriate. Preserve focus, selection
  and the invoking draft through every nested chooser.
- **Async feedback and preview validity (09, 10):** show moving loading feedback,
  failures and retry in the active menu/dialog that owns the request. Do not
  write errors behind an open sheet. Invalidate estimated size, savings and file
  details together when source/profile changes; reject late obsolete responses.
  Only confirm a preview matching the current source and choices.
- **Controls, title context and Activity (08, 11, 12):** use consistent existing
  portal tokens and reliably tappable setting rows. Keep essential title/size
  information readable while preserving the four-column compact library. Review
  normal, selected, focused, disabled, busy and destructive states. Retain useful
  artwork/title/summary/version context in replacement confirmation. Keep a
  bounded recent-completion view with final Pi/cloud outcomes, and distinguish
  failed, queued, waiting and measurable progress without misleading bars or
  unnecessarily tall cards.

Review the complete connected journey, not isolated screens: phone and tablet,
light/dark/true-black, the chosen accent, long names/lists, multiple items,
empty/loading/error states, original/both retention and expanded details. Use
393×852, 320×568, 1024×768 and a constrained-height keyboard scenario; finish with
actual iPhone/Safari checks for native menus, focus, Back and dismissal gestures.
The audit's browser captures do not substitute for physical-device acceptance.

These fixes can be built alongside the migration and the shared optimisation
upgrade. They do not arm or start the later bulk library conversion.

## 7B. Shared portal reliability — Remote resume and request failures

Include the nonvisual corrections from the [4 November Remote investigation](portal-load-failure-investigation-2026-11-04.md).
A failed status poll was reproduced changing Remote to offline/unavailable and
disabling Play/Pause until the next successful response. The owner's precise
foreground-resume transport failure/global notice is not yet attributable from
the current logs; do not treat the reproduced UI state as proof of every symptom.

- Preserve last known TV state while reconnecting; do not infer TV-off from one
  failed read. Define control availability and reliable loading/disabled cleanup.
- Own Remote status/preview requests across background and foreground transitions.
  Refresh on resume, bound in-flight work and reject obsolete responses without
  replaying playback or power commands.
- Add bounded, protected request/error breadcrumbs with route/action, time,
  duration, endpoint/method, request ID and visibility/online context. Redact
  secrets and private source/query data. Display useful personal-app errors.
- Use defined timeouts and bounded recovery for appropriate reads, retain current
  content/navigation, and distinguish session/auth failures. Do not add blind
  retries for state-changing operations.
- Validate suspension/resume, one failed poll, stale replies, slow networking and
  reconnect, including actual iPhone behaviour and the separate global-notice /
  UI-stall report. Preserve the approved design outside Studio.

## 8. Desktop Studio UI parity and installation

- Bring drag/drop, file picker, iPlayer, other download and send flows up to the
  same choices, recommendations, estimates, warning and retention behaviour.
- Share policy/validation rather than duplicating it in UI code.
- Continue to preserve user-owned imported files. Temporary-work cleanup applies
  only to the app-owned files covered by verified delivery receipts.
- Package the policy and required supported media tools in the Windows build.
- Build and install the updated app; verify the installed executable/resources,
  not just repository code or a development Electron window.
- Preserve sign-in, settings, queued jobs, workspace and restart recovery through
  the installation. Update documentation to distinguish delivered behaviour
  from this planned specification.

## 9. Durable source provenance and version relationships

Persist source information alongside stable library/archive identities in the
Pi's authoritative SQLite state. It must survive Activity-history pruning,
renaming, filing, cloud replacement, transfer and application restart.

- iPlayer: programme/episode PID, canonical page URL, acquired version/quality
  and useful original technical details. Do not rely on an expiring stream URL.
- Torrent: magnet, info hash and exact selected file/episode identifiers, names
  and sizes, including selections within multi-file packs.
- All acquisitions: original filename/size, useful fingerprint/checksum where
  available, acquisition source and relationships among original, compressed
  variants and Pi copies.
- Record profile, policy version, encoder and settings for produced variants.
- Do not infer a recoverable source for imported legacy files when none is known.
- Keep source records private under existing authentication/security boundaries;
  do not expose account secrets or send provenance to notification services.
- Source identifiers describe how to try again, not guaranteed future access.
  Programmes can expire and torrents can lose available peers. A future iPlayer
  rendition may also differ from the exact bytes acquired previously.

## 9A. Back up and restore all new file and recovery data

Dan explicitly added this requirement on 4 November: the new Download original
feature and the richer records about individual files must be covered by backups.
This is part of the full build and its acceptance, not optional documentation.

Current boundary: the Pi disaster archive contains a validated whole-database
SQLite online snapshot, secrets and device configuration. It excludes media,
partial-transfer journals and the Windows Studio profile. The enabled offsite
job still targets OneDrive; its last run on 4 November completed successfully.
Do not assume that this already protects Windows-only recovery records.

- Include all new SQLite tables/columns and schema migrations in the validated
  online snapshot: acquisition PIDs/URLs/magnets and exact selected torrent
  files, original facts, stable file/library IDs, variant relationships, profile
  and policy versions, source fingerprints, retained-original locations and
  completed publication/archive/notification receipts.
- Back up the necessary Windows Studio profile, worker/settings identity and
  durable job intent/recovery records consistently with the Pi snapshot. Include
  what is needed to reconstruct a request and reconcile confirmed work, rather
  than relying on Activity history or one machine's unprotected JSON file.
- Preserve private access controls around archives and source information.
  Retain documented re-authorisation for credentials intentionally excluded or
  tied to a device; do not promise that copying a profile makes those portable.
- Preserve the existing media/cache exclusion boundary. Partial media and scratch
  bytes are not required to become disaster-backup payloads. On restore, validate
  what actually exists and restart missing stages from the recorded source;
  never claim a missing partial can resume at its old byte offset.
- Verify a restore into isolated storage using seeded examples of original,
  optimised-only and both variants, iPlayer/torrent provenance, an organised or
  renamed file, a pruned Activity history and an interrupted job. Download
  original must retain its source relationship; completed delivery must not be
  repeated or trigger historical phone alerts. Run integrity/foreign-key checks.
- Back up the current release/state before schema or application replacement.
  Keep a compatible rollback point, backup manifest/version and checksums;
  preserve existing authentication, viewing state, jobs and device pairing.
- Include the offsite-backup handover in the work: OneDrive retirement must not
  leave backups pointing only at OneDrive. Prepare and verify a suitable iCloud
  delivery route, retaining the working OneDrive backup until the replacement
  has an independently verified archive and restore proof. If it uses the
  Windows companion, queue locally while that laptop is unavailable and make
  its last verified offsite backup time/status visible. Preserve immutable
  recovery points and retention; no remote pruning before verified delivery.

## 10. "Download original" / re-download workflow

- Offer the action for items with a retained original or recorded recoverable
  source. Handle absent/unavailable sources clearly without repeated retries
  that block unrelated work.
- Prefer the retained original if one exists; otherwise obtain the recorded
  source, including only the intended file/episodes from a torrent pack.
- Reuse the destination chooser. For iCloud, retain the original unchanged. For
  the Pi, make a high-quality Pi-compatible copy under section 6; this route
  does not automatically apply Compact's size-reduction target.
- Offer Keep alongside existing / Replace existing, with unambiguous scope.
  Keeping a separate high-quality copy supports a one-off viewing without
  removing the normal Compact copy.
- Name and identify distinct versions clearly. Filing/import automation must
  not accidentally merge them, overwrite them or strip necessary variant labels.
- Preserve metadata, episode identity, library membership and viewing progress
  appropriately when replacing an existing item. Duplicate versions require
  separate physical identities linked to the same title/source.
- Apply existing safe publication/archive checks before retiring any prior copy.

## 11. Jobs, concurrency, progress and notifications

- Preserve separate download, conversion, Pi transfer and cloud-confirmation
  stages. Waiting for an iCloud upload must not hold a foreground conversion,
  download or Pi-transfer slot.
- Retain up to five managed downloads, one conversion and one Pi transfer at a
  time, subject to real disk admission. Do not impose an application count limit
  on files already handed to Apple's uploader; bound only the HTTP/control work.
- Keep jobs resumable across shutdown, sleep, lost internet and reconnection.
  Completed work and receipts are reused; interrupted encodes can restart their
  current operation without repeating already delivered files.
- Show meaningful stage percentages in Activity. During provider confirmation,
  show an honest "Uploading to iCloud / waiting for confirmation" state without
  a false percentage or a stuck determinate bar.
- Hide or disable controls that cannot perform a meaningful action at that stage.
- Preserve active search and row-inspection loading feedback.
- Notify when the requested destination is actually ready: Pi publication, or
  verified iCloud completion for cloud-only work. Do not send an alert for every
  intermediate stage or duplicate Pi-ready and later archive alerts unnecessarily.
- Notify once when work needs attention, with enough context to identify it.
- Retain existing stopped-seeding/retained-data torrent completion handling.
  Do not alter unrelated torrents or imported originals.
- Existing catalogue sorting, including file size, remains available so large
  candidates for optimisation are easy to find. Retain A–Z, file-size and known
  release-date ordering, together with search and result/detail loading feedback.

## 12. Replacement, storage and cleanup safeguards

- Recheck frozen source identity/version before replacement. Changed or removed
  inputs require review rather than silently selecting another version.
- Validate output format, duration, usable tracks and relevant size/quality
  policy requirements. Compatibility-only jobs have a different size rule from
  space-saving replacements.
- Reserve cloud archive identity before copying. Keep filing from relocating an
  unconfirmed copy out from under its transfer/confirmation owner.
- Verify destination completion before removing an original, previous Pi version
  or app-owned working media. Make operations idempotent across lost responses.
- Free local cloud caches only after confirmed delivery and respect explicit
  keep-downloaded pins. Free up space must not be implemented as cloud deletion.
- Clean up app-owned encoding scratch/pass files, obsolete partials and duplicate
  working copies automatically once all requested destinations are verified.
  Release eligible hydrated source caches at that point, while preserving
  user-owned inputs, explicit pins, retained variants and small recovery receipts.
- Atomic job/status/receipt writers must tolerate temporary Windows reader or
  scanner sharing locks with bounded retries. Persistent errors must surface
  while preserving the previous valid journal; verify restart after that failure.
  Do not repeat the transient file-lock failures from the film test controllers.
- Keep a 20 GiB Windows free-space reserve plus actual job working requirements.
  Account for other running work, Pi capacity and temporary cloud coexistence
  of original and replacement. Pause admission rather than deleting unrelated
  files or lowering safety allowances.
- Keep bounded, useful audit/diagnostic receipts and recovery information.

## 13. Integration contract for the later one-off bulk operation

This build must expose a reusable safe job/policy contract so the later bulk
feeder can use the installed Studio worker. Building a large new bulk-management
UI, executing the one-off library conversion and editing its final manifest are
not part of this application build.

The later run needs exclusions, per-film/episode/series profile overrides,
Compact as its normal default, frozen source versions, restart-safe receipts,
bounded disk-aware batches and skip/review handling. It must not discover and
recompress its own outputs or automatically include newly added files mid-run.

No build completion, migration completion, app restart or deployment may arm it.
Dan chooses its scope and explicitly starts it after migration is finished.

## Implementation workstreams and likely owners

Recheck the current tree before implementation; preserve unrelated work. These
are ownership pointers, not instructions to enlarge an existing oversized file.

| Workstream | Existing owners / boundaries |
| --- | --- |
| Shared encoding and quick analysis | `tools/studio/lib/media.cjs`, `compression.cjs`, packaged shared policy; introduce focused owners if needed |
| Windows scheduling and archive lifecycle | `queue.cjs`, `stage-resources.cjs`, `companion-jobs.cjs`, `cloud-compression.cjs`, `cloud-archive.cjs`, `cloud-cache.cjs`, `working-cleanup.cjs` |
| Portal job/provenance/API contracts | `scripts/pi/mabeltv_backend/studio.py`, `studio_http.py`, focused cloud owners and repository adapters |
| Retire Pi encoding / existing-Pi requests | `transcoding.py`, `size_encoding.py`, management/upload owners; audit implicit call sites |
| Durable provenance / variant identities | SQLite repository owners and `database_schema.py` if a migration is needed; no retired JSON state fallback |
| Backup and restore coverage | `scripts/pi/backup-config.sh`, `onedrive-backup.sh`, state-migration/validation tools and a focused Studio profile/job snapshot owner; verified offsite handover |
| Portal controls and Studio UX | `portal/js/studio/cloud-optimise.js`, `controls.js`, queue/metadata/library owners, `portal/js/library/compression.js`, send flows, `portal/html/overlays/studio-library.html` and owned HTML partials; reconcile newer live owners first |
| Dialog bounds and scoped styling | Studio CSS plus the shared dialog contract in `experience-playback-overlays.css`; correct the cascade without changing unrelated portal sheets |
| Shared request and Remote recovery | Focused transport/diagnostic owner integrated with `portal/js/core/foundation.js`, `core/live.js`, lifecycle/navigation and bounded backend diagnostic logging |
| Desktop controls and IPC | `tools/studio/ui/destination.js`, `app.js`, focused UI owners, validated `main.cjs` / `preload.cjs` interfaces |
| Notifications and publication | Existing completion-notification owners and durable final-state receipts |
| Packaging / documentation | Windows Studio packaging, installed-app verification, `docs/studio-portal.md`, `tools/studio/README.md` |

Suggested delivery order:

1. Reconcile live/local Studio sources and retain a verified baseline; confirm
   encoder/profile policy and enumerate all live encoding entry points.
2. Correct off-screen panels, episode draft loss and hidden async failures
   (STU-UX-01, 02, 09), then resolve collection scope/creation/filtering (03, 04).
3. Implement shared Windows processing, versioned provenance and job contracts,
   together with their backup/restore coverage.
4. Route existing-Pi optimisation through Windows and remove Pi encoding fallback.
5. Add durable original-recovery and variant replacement/keep-both handling.
6. Bring portal and desktop interfaces into parity. Integrate the remaining
   audited navigation, control, preview and Activity corrections into those
   journeys, then review their styling together using the established design.
7. Verify failure/restart/storage/notification behaviour and the complete visual
   journey, including actual iPhone acceptance; package and deploy safely.

## Acceptance checklist

- [ ] Same selected policy produces consistent behaviour from portal and desktop.
- [ ] Drag/drop in the installed app uses the new shared implementation.
- [ ] Laptop unavailable means queued/waiting; no video encoding occurs on Pi.
- [ ] Encoder choice remains internal; no unannounced long CPU fallback.
- [ ] Quick probes/cache reuse; no routine sample encodes or heavy quality scans.
- [ ] Three profiles, Compact default, honest estimates and concise exceptions.
- [ ] Already prepared files do not suffer repeated percentage reductions.
- [ ] 720p/1080p destination caps, lower-resolution preservation and format checks.
- [ ] Actual original is an iCloud concept; Pi choices say Pi-compatible copy.
- [ ] Optimised-only, Original and Both retention behave correctly in both UIs.
- [ ] Warning/skip handling for risky recompression, without unattended pop-ups.
- [ ] Durable PID/magnet/exact-file provenance survives job-history pruning.
- [ ] Re-download original supports correct destination and alongside/replace.
- [ ] Source unavailable, no known source and changed source cases are handled.
- [ ] Safe preservation of metadata, variants and viewing progress.
- [ ] Automatic naming/filing, artwork/metadata and Pi subtitles remain correct
      across newly downloaded, restored-original and replacement variants.
- [ ] New provenance/variant/policy/receipt data and necessary Windows recovery
      records are included in verified backups and survive an isolated restore.
- [ ] Download original still works after restore and Activity pruning; incomplete
      jobs reconcile real files without replaying completed delivery or alerts.
- [ ] Offsite backup handover is verified before OneDrive retirement; unavailable
      laptop handling and backup freshness/status are explicit.
- [ ] Restart, network loss, source mutation, low space, encoder failure and
      delayed cloud confirmation tested at the relevant boundaries.
- [ ] Pi-ready and cloud-only completion alerts reflect actual verified delivery.
- [ ] No new blockage of downloads/conversions behind pending iCloud confirmation.
- [ ] Completed scratch files and eligible working/source caches are reclaimed;
      temporary Windows file locks do not stop durable job progress.
- [ ] Live/local Studio sources reconciled; newer collection/menu and unrelated
      playback changes preserved.
- [ ] Every Studio menu/submenu and confirmation retains reachable header/close
      and footer actions with long content, expanded details and keyboard height.
- [ ] Repeated episode selection edits preserve valid draft choices and remain
      available after Continue.
- [ ] Pi/cloud collection scope and selected values are clear; collection creation
      updates the correct destination, and category filters have predictable results.
- [ ] Back, X, Cancel, Done, selection commit and focus restoration follow the
      agreed menu tree without losing the invoking draft.
- [ ] Async actions show active-surface loading/error/retry; changed or failed
      previews never retain stale positive savings or enable stale confirmation.
- [ ] Compact library titles/size, setting rows and button states are legible and
      tappable; before/after confirmation identifies the affected title/version.
- [ ] Recent completed jobs expose final Pi/cloud outcomes; failed/queued/provider
      confirmation states do not imply measurable progress.
- [ ] Remote foreground resume and transient read failures preserve coherent TV
      state and usable navigation; obsolete requests cannot regress the view.
- [ ] Redacted request breadcrumbs identify future phone errors; failure/retry
      checks cover Remote status separately from global notices and UI stalls.
- [ ] Relevant Python/Node, architecture/syntax, core browser and installed
      Electron checks pass; focused visual review covers phone/tablet themes.
- [ ] Representative outputs are checked on actual TV and iPhone/Safari before
      declaring playback/subjective acceptance, beyond automated format checks.
- [ ] Backend/portal deployed using the guarded repository release path; native
      player/Matter, application state and offline downloads preserved as required.
- [ ] Installed Studio build/version/resources and live portal release verified.
- [ ] Existing migration may continue; no automatic bulk-library start occurs.

## Technical tuning to validate during implementation

- Intel Quick Sync is selected. Validate runtime availability and the conservative
  no-silent-fallback behaviour; this is no longer an open encoder-choice decision.
- Exact profile tuning, size tolerances and conservative quality/risk rules.
- Validate Balanced/Compact/Smallest, 720p/1080p destinations, differing source
  frame rates/colour/interlace cases and output compatibility in the shared route.
  This is build verification, not a prerequisite for Dan to choose Intel again.
- Whether additional end-to-end hardware acceleration improves the accepted
  output without creating a different colour, scaling or compatibility result.

These technical decisions do not introduce new everyday encoder controls.
Do not treat provisional timing or invalidated quality scores as acceptance data.
