# Studio in the My TV portal

Planned upgrade: [agreed portal and Windows Studio optimisation build](studio-optimisation-build-plan-2026-11-03.md).
The [live Studio UX and styling audit](studio-portal-ux-audit-2026-11-03.md)
records the menu, collection, layout and interaction corrections included in it.
That specification describes future work; the behaviour below documents the current implementation.

Open **My TV → Studio** at the normal HTTPS portal. The iCloud library groups
recognisable series into one title, with seasons and episode selection inside.
The phone and tablet library use four-column My Viewing poster cards and a
single Films/TV/Kids filter. Audio, podcasts and family file folders are excluded.
Title matching fills artwork and metadata independently of Pi copies. Exact,
unambiguous matches can be automatic; open a title and choose **Change metadata**
or **Match title** to correct it using the portal's film/TV catalogue.

The connected title organiser checks the library quietly, one title at a time.
It uses a small OpenAI model to interpret unclear filenames, then verifies the
identity and all descriptive facts against TMDB. Corrections made in the portal
remain authoritative. Opaque filenames or uncertain episode numbers stay intact
for a manual match rather than receiving invented metadata.

AI decisions are saved per title and meaningful source version in SQLite.
Refreshes, restarts, watchlist/settings changes and changes to other titles do
not rerun those decisions. Uncertain answers are cached too, until their source
changes or a manual metadata match is supplied. A new episode uses its show's
existing identity. A persistent, versioned request cache also avoids repeating
successful AI calls after an interrupted catalogue lookup or filing operation.
Transient API failures back off; monthly request/input/output-token counters
are available in Studio status. The dedicated project's enforced monthly limit
is $15; auto-reload remains off.

Standalone films are loose in `Media/Films/` or `Media/Kids/Films/`.
The iCloud section has separate section and sort controls: title, total stored
file size and release year. Size includes all owned versions of a film and all
episodes of a series, and sorting applies before pagination. File size is also
visible below each title. Activity displays numeric percentages for measured
work. During iCloud upload confirmation it instead shows a live upload status,
with no misleading full progress bar or Pause/Cancel controls: stopping Studio's
wait would not stop the Windows iCloud provider's upload.

Finished Activity entries support a left swipe and Remove (or keyboard Delete).
This hides only the history entry; media and original-source recovery records
remain. Queued, active and paused work must finish or be cancelled first.
Existing local posters appear without a fresh title search. Cloud selection and
sorting, card updates and streaming-service badges keep matching images mounted.
Real franchises have a folder only when at least two different owned films
belong to that series; multiple copies of one film count once. Single-film
series stay loose, and adding/removing a second film rechecks only that series
using its saved metadata. The owner's Disney and Julia Donaldson folders
contain their films directly. MCU stays together in `Media/Films/MCU/`, using
the original numbered release order rather than individual Marvel franchise
folders. No DreamWorks, Christmas or individual-film folders are created.
Series keep their existing show/season hierarchy and episode names.
Imported existing filenames stay intact, with a suffix only when needed to keep
multiple versions separate. New Studio film copies are filed under the matched
title and year; retained optimised alternatives are labelled when both versions
exist. Subtitles are kept on the Pi, outside iCloud.
New Studio film uploads use the matched title and year on the Pi. Cloud-only
optimisation and other cloud-only saves notify at their final completed state;
Pi destinations notify at publication, without an extra alert for the archive.
Cloud-side moves do not download videos through the Pi. Interrupted moves
resume from checked receipts; conflicts preserve both files. Empty old folders
are removed during the approved layout repair only when empty. Matching and
filing progress appears in Activity while working; stopped work is hidden.
New Studio cloud copies receive metadata while their queue job finishes. Filing
waits until the transfer releases them. The verified identity is reused for My
TV metadata without another upload or another AI decision.

**Title → More → Delete from iCloud** names the selected films or episodes
and asks for confirmation. It deletes those videos and matching subtitle files
from iCloud and synced devices; separate Pi copies remain. There is no general
folder browser or rename/move interface. Frozen file versions are checked again
before deletion; changed files require a fresh confirmation.

## What runs where

The Pi reads iCloud directly, keeps the catalogue available and owns queued
requests. Cloud title deletion does not require the laptop. The catalogue
refreshes every five minutes, with a manual Refresh action; an initial full scan
of the current library takes about a minute. The last successful catalogue stays
available during a connection problem.

Installed Windows Studio starts at Windows sign-in, stays in the notification
area when its window closes and processes queued work when connected. Its tray
menu has an explicit quit/pause action. Processing requires the laptop to be
awake, signed in and connected. The portal reports offline waiting and progress.
It does not wake a powered-off laptop.

Studio uses separate stage limits: up to five downloads across torrents,
iPlayer and iCloud, one conversion, and one transfer to the Pi. These stages
can run simultaneously. Waiting for iCloud archive confirmation occupies none
of those stage slots or the twelve-job foreground window. There is no application
count limit on pending iCloud files. Progress messages use batches of up to 64
records, and worker-session heartbeats retain background claims between batches.
Only confirmation HTTP requests are bounded; that does not limit Apple's file
uploads. Foreground work can be paused or cancelled
without stopping other jobs. Disk admission accounts for other jobs' working
reservations and retains a 20 GiB free-space allowance; insufficient space
keeps new downloads waiting. qBittorrent's secondary queue is disabled because
Studio owns payload concurrency and metadata lookups must remain available.
Studio uses iCloud for Windows to fetch selected files. Its
selected download waits, with cancellable progress, while iCloud makes a new
or renamed file and its subtitles available. Each retry checks the frozen
version again; an actual replacement requires a fresh selection. Its
default cloud root is `%USERPROFILE%\iCloudDrive`; its working media folder on
this installation is `%USERPROFILE%\Videos\MabelTV Studio`. Windows can update a
file's change timestamp while hydrating it, so copy receipts use its size,
modification time and file identity instead. Interrupted copies resume only
against the same source version. A Windows provider lock at final rename keeps
the completed partial and retries asynchronously until released or paused/cancelled.
Source identity and partial size are rechecked before each attempt. Activity
explains the automatic retry; other downloads, conversions and cloud saves
continue. Non-lock filesystem errors still preserve the files and report failure.

Choose My TV films/series, a Mabel TV channel, or iCloud. TV uploads are always
prepared for their destination: Mabel TV uses 720p, My TV uses up to 1080p.
Compatibility only is the default for new TV deliveries in the portal and Windows Studio, including iPlayer, torrents, local files and iCloud. Balanced, Compact and Smallest remain explicit space-saving choices. Existing queued choices are retained. Compatibility converts 50 fps motion (including 25 fps interlaced material) to 25 progressive frames for either TV destination; other supported rates are unchanged. This requires a high-quality video encode, not a fixed size reduction. iCloud-only space-saving actions still use their chosen compression profile.
Compatibility-only delivery copies suitable H.264 picture packets unchanged
when only the container, fast-start layout, audio codec or stereo mix needs
correction. Audio can become AAC stereo without another picture encode. Output
geometry, signalled cadence, available frame counts and duration are validated;
other video incompatibilities still require destination preparation.
There is no Download destination or optimisation checkbox. A multi-season selection preserves source seasons, including season
0 for specials. New series saved into iCloud use a show/season hierarchy so the
cloud catalogue groups them again.

Every source offers **Original**, **Optimised**, or **Both** for its iCloud
archive. An iCloud-only original needs no conversion. Both keeps two versions
when conversion changes the file; an already compatible file can satisfy both
roles without duplicate bytes. Versions share one title card and metadata.
Existing iCloud sources are not offered iCloud as a destination, but still have
the three archive choices. Optimised only warns that it replaces the existing
original, recommends Both to retain it, and requires separate confirmation.
Deletion waits for verified cloud and TV receipts and rechecks the frozen
original version. A changed original is kept for a fresh confirmation.
Studio-owned temporary media is removed only after retained cloud copies and
TV publication are confirmed. Imported user files remain untouched. Interrupted
work keeps its journals and resumes from confirmed per-version receipts.
When phone notifications are configured, each successfully published film or
episode sends a "Ready on your TV" alert with its destination. This is based on
the Pi's completed publication receipt and actual file presence, independently
of the source and of any later iCloud archiving. Failed notifications retry
without blocking transfers; successful deliveries survive restarts in SQLite.
The private ntfy configuration also specifies when notifications were enabled,
so earlier upload history is not announced as a backlog.
Each pending cloud copy reserves its path under the current queue claim before
copying. Catalogue arrival binds that reservation to the stable cloud identity;
the organiser cannot relocate a copy ahead of its confirmation receipt.
Available disk space limits large jobs; Studio does not hydrate the whole Drive.
**Optimise iCloud version** in a cloud item's action sheet queues a cloud-only
replacement using the same up-to-1080p H.264/AAC MP4 profile as My TV. Its
confirmation lists the frozen selected files, containers and existing sizes,
plus a duration/maxrate size guide in the expandable file details when catalogue
duration is available. This guide is not an output-size prediction: the main
comparison labels the output size and space saving as unknown until conversion.
Studio uses compact grouped settings and fixed destination sheets. The body
scrolls inside the sheet while its queue action stays in place. Secondary cloud
actions are under More. Collection filters list saved names and filter the
normal title grid; local and iCloud collections are separate. Create a local
collection inside film/series settings or a cloud collection inside Move to
collection. Studio 1.6.1 is required for local collection choices on new jobs.
The existing version-consent, verified-output
and deletion guards apply; no TV upload is required for this action. A larger
replacement cannot delete the original. Completion produces one phone alert.

Text subtitle sidecars and supported embedded text subtitles are converted to
SRT and attached to confirmed Pi publications. iCloud saves contain the video
only; subtitles stay on the Pi. Image-based
subtitles need a text equivalent; a warning leaves the original safe.

Cloud title matches are reused when queuing. My TV metadata is applied after publication through the existing Pi APIs.
An unambiguous exact match can be applied automatically; other matches can be
chosen in the portal. Metadata retry reuses the confirmed publication and does
not upload the video again.

## Connections and recovery

### Find anything

The fourth Studio section searches The Pirate Bay's video category through
qBittorrent's reviewed search plugin, covering films and TV. Search results are
deduplicated and ranked by seed count, with the best ten shown. Searching does
not invoke AI or download media. Search and file-inspection intents wait in
SQLite when Studio is offline and use capability-aware worker leases; older
companions cannot claim this work.

Review obtains torrent metadata with the native MetadataReceived stop
condition. Only video files can be chosen. Season packs stay under one release;
the review can select specials, seasons and individual episodes. The server
freezes the hash and selected file paths/sizes before queuing. Relative paths
are checked for Windows traversal, collisions and unsupported names. Matching
text subtitle sidecars can accompany the selected videos; installers and other
unselected files are never executed or imported.

My TV, Mabel TV and iCloud use the same Original / Optimised / Both archive
choice as BBC iPlayer. TV preparation is automatic. A pack downloads once,
then processes selected videos sequentially with one Activity row. Searches,
downloads and conversion run through Windows Studio. The Pi coordinates the
queue, publishes completed uploads and keeps catalogue metadata.

The bundled qBittorrent uses a dedicated profile and authenticated API bound
to `127.0.0.1`. Its random password is protected by Windows private storage;
neither credentials nor user profiles are bundled or committed. It starts
when requested and does not replace another torrent client's magnet handling.
Per-torrent limits stop completed seeding even when Studio is disconnected.
Uploads to peers can still occur during downloading. The completion journal is
saved before stopping/removing the torrent with data retained. An interrupted
handoff reuses that journal, verifies the retained files and never republishes
already confirmed Studio children. Shared pack data is removed after all
selected files have confirmed cloud/TV delivery. Paused or failed work keeps
its recovery data. Torrent operations are scoped to the exact managed hash,
tag and working directory, never to all torrents.

Results depend on the external search service and peers; availability and seed
counts do not guarantee a working download. A metadata timeout leaves the
selection intact for retry or another result. Disk admission reserves room for
selected originals and preparation. No torrent client, peer video download or
video conversion is installed on the Pi.

Use **Connections → Reconnect** in the HTTPS portal for Apple sign-in and
verification. The rclone connector is experimental and Apple may require a
fresh verification: see the [rclone iCloud Drive documentation](https://rclone.org/iclouddrive/).
Private pending credentials use a protected Unix socket, expire and are removed
on cancellation. Working credentials are replaced only after successful account
verification. They live at `/var/lib/mabeltv/secrets/icloud/rclone.conf`, owned by
`mabeltv`, mode `0600`, outside the repository. A fresh Pi can reconnect through
the portal; Git contains neither these credentials nor the cloud media.

Windows uses Studio's existing portal session. If remote Cloudflare Access or
the owner PIN needs signing in again, use Studio Settings. Automatic connection
prefers the local Pi and then the public domain.

Pi jobs, search requests and file operations are independent reserved `studio.*`
fields in the authoritative SQLite database. They survive ordinary settings
writes and use independent polling without invalidating native TV settings.
Windows retains its existing durable journal at
`%APPDATA%\MabelTV Studio\transfers.json` and its backup. Keep that profile when
reinstalling Studio. A restarted worker reuses saved upload IDs and results.

BBC search uses get_iplayer's broadcast catalogue; an available episode link/PID
can reach content outside the recent search catalogue. Availability and network
conditions still apply. Torrent search and qBittorrent are a later source
integration, not part of this release.

## Compression choices

Every preparation/send flow offers Balanced, Compact (preselected), and Smallest.
The shared immutable `compression-profiles.json` is packaged with Windows Studio
and the Pi backend: targets are approximately 60%, 40%, and 25% of the source
size, with a small mux allowance. Known source sizes produce an estimate before
confirmation; BBC recordings without a known download size do not invent one.
The selected profile persists with the job and old companions cannot claim it.

Preparation uses single-pass Intel Quick Sync H.264/AAC MP4, fast-start playback, and up to 1080p for
My TV/iCloud. Mabel TV channel copies retain their 720p playback cap; an optimised
iCloud copy is prepared separately from the original when that cap would reduce
the cloud version. Lower-resolution originals are not upscaled. Each output is
validated and must be smaller before replacing an original. Embedded encoding
proof retains the original size basis so repeated sends do not repeatedly
multiply the reduction; an already smaller compatible prepared copy is reused.

Policy v3 preserves source frame rates up to 60 fps for every choice, including
Compatibility only. Progressive 50 fps stays 50; interlaced 25 fps becomes 50
progressive frames to retain field motion. Unsupported rates fail with the
original kept rather than silently losing frames. Source-frame-aware quality
floors drive both Windows encoding and metadata-only Pi estimates. 1080p50/60
uses H.264 level 4.2; 720p50/60 stays within level 4.1 limits. The Pi accepts prepared high
frame rates without queuing another conversion. Existing v1/v2 encoding records
remain recognised. Compatibility-only encoding uses the destination bitrate
ceiling without a source-size reduction target; already compatible files reuse
or remux their existing video.

## Validation for the November 2026 build

- Complete Python suite: 391 tests, six platform skips; subsequent Studio owner
  checks cover the directory-ID correction and independent settings revisions.
- Core iPhone WebKit/Chromium regression gate: 143 passed, 19 existing skips.
- Focused Studio phone/tablet/browser cases: 24 passed, plus final light/dark
  folder and deletion screenshot review. Source/worker checks: 19 passed.
- Windows Studio owner suite: 38 passed. Electron UI/workflow cases passed,
  including actual FFmpeg conversion and recovery from a lost acknowledgement.
- An isolated actual backend and Electron companion completed four real-video
  jobs, three library publications and a metadata retry after worker restart.
  Original hashes and the optional optimised-copy cleanup were verified.
- Real iCloud tests created, renamed, moved and deleted only temporary synthetic
  items, then removed their test root. Folder identity remains checked even
  though rclone directory `--stat` omits the ID.
- Live Pi/installed Studio search returned one grouped programme with 47
  episodes. A real 55,948-byte cloud source copied through the production
  hydration component with matching SHA-256 and no portal page errors. An
  additional small cloud-only sample was unavailable; full-sized film downloads
  and a Windows reboot were not performed for validation.
- The installed 1.3.0 source and startup registration were verified; all 13
  pre-existing local queue/history items and the worker identity were preserved.
- Deployment uses the guarded atomic installer with `--preserve-player`.
  No live publication, playback command, TV refresh, native restart or reboot is
  used for these checks. Final release/health receipts are retained under the
  ignored `out/studio-portal-build-20261101` evidence directory.
