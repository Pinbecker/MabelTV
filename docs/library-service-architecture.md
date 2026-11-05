# Library service architecture

The local Library service is the private backend for the MabelTV portal and its
installed iOS PWA. Public routes, cookies, JSON response shapes, local socket
commands and the systemd entry point are compatibility contracts.

## Composition and dependency direction

`scripts/pi/mabeltv-library.py` is the stable executable and composition root.
It creates shared locks, queues, workers and paths, composes the focused mixins
into `Library`, and starts the bounded HTTP service. It must not contain route
implementations, provider algorithms, persistence adapters or live-stream
protocol code.

Backend mixins communicate through `self` on the composed `Library`. They must
not import another mixin or the executable. Small protocol/value helpers may be
imported by more than one owner when they do not carry application state. This
keeps dependencies directed toward the composition root and avoids hidden
secondary service objects.

## Backend owners

- `database_schema.py`: immutable schema definitions and the ordered migration
  ledger.
- `database.py`: SQLite connections, transactions, relational adapters,
  revision counters and supported backup/integrity operations.
- `repositories/viewing.py`: the targeted relational repository for stable MabelTV
  viewing identities and session CRUD; it composes into `StateDatabase`.
- `repositories/mabel_queue.py`: the independent ordered Mabel TV playback queue.
- `playback_progress.py` and `repositories/playback.py`: authenticated My TV
  checkpoints independent of expiring stream tokens, with ordered, targeted
  SQLite updates and completion/clear tombstones.
- `auth.py`: first-time setup, owner identity, PIN verification, login limits
  and session lifetime.
- `media.py`: read models for channels, programmes, My TV media and safe media
  paths. Structured state goes through the database; its `read_json` and
  `write_json` helpers are only for operational filesystem journals.
- `management.py`: serialized administrative mutations for channel/settings
  changes, media organization and the recoverable recycle-bin workflow.
- `iplayer.py`: bounded MP4 BBC identity reads and the authenticated current-file
  inventory used by Studio. Parsed tags are disposable, fingerprinted cache
  entries; live file presence is checked again on every request. Upload history,
  the recycle bin and staging files never establish availability.
- `uploads.py`: resumable upload records, queueing, publication and worker
  lifecycle. `.incoming` manifests are operational journals.
- `studio_publication.py`: canonical film naming after a confirmed Studio title
  match. A completed upload receipt binds the file; its rename journal recovers
  interrupted video/sidecar moves and keeps the existing library identity and
  original-recovery receipts. Existing targets are never overwritten. Ordinary
  manual TMDB matching does not rename files.
- `upload_notifications.py`: source-independent phone alerts after verified Pi
  publication, private ntfy configuration and bounded delivery retries. SQLite
  owns delivery receipts; notification work never holds the media queue.
- `studio_cloud_optimisation.py`: frozen cloud-video replacement previews and
  selected size-target estimates from the shared encoding profiles.
- `studio_originals.py` and `studio_recovery.py`: authenticated original-source
  recovery and verified retirement of a frozen previous variant.
- `studio_desktop.py`: desktop imports and iPlayer requests enter the same queue;
  imported paths remain bound to the worker that owns them.
- `studio_pi.py`: frozen Pi inputs and resumable prepared returns from Windows;
  the Pi validates and publishes without video encoding.
- `studio_backups.py`: protected Studio recovery snapshots and checksummed iCloud
  disaster-archive delivery, retaining the existing OneDrive backup.
- `portal_diagnostics.py`: bounded, protected request failure breadcrumbs without
  source URLs, request bodies, credentials or query values.
- `repositories/studio_provenance.py`: durable acquisition and variant delivery
  receipts in SQLite, independent of bounded Activity history.
- `compression.py` and `compression-profiles.json`: immutable Balanced, Compact
  and Smallest policies shared by Windows encoding and Pi previews.
- `size_encoding.py`: explicit refusal boundary for retired Pi video encoding.
- `transcoding.py`: lightweight probing and delegation of video preparation to
  the Windows Studio queue, including existing My TV actions.
- `viewing.py`: viewing sample/session lifecycle, stable catalogue identities,
  targeted session persistence, retention and the four scoped Insights APIs.
- `viewing_analytics.py`: pure timezone-aware calendar allocation and aggregate
  builders. It has no database, HTTP or runtime-state ownership.
- `viewing_queue.py`: validation and atomic persistence of My TV Up Next order.
- `mabel_queue.py`: authenticated Mabel TV queue actions and validated programme selection.
- `provider_transport.py`: API-key reads, bounded HTTP transport, response
  caching and OpenSubtitles transport.
- `my_tv_metadata.py`: My TV TMDB titles, series, people, collections,
  Watchmode availability and the merge with local/viewing state.
- `providers.py`: children's channel and local-film metadata matching and
  application.
- `my_tv_insights.py`: My TV watched/rating aggregates and progressive TMDB
  enrichment.
- `discovery.py`: curated paginated Explore results enriched with local state,
  the familiar/popular What to watch mix, popularity-ranked weekly film,
  series-debut and season-premiere discovery, and the bounded batch lookup used
  to decorate My TV cards with streaming availability. That batch merges
  TMDB providers with existing SQLite-cached Watchmode summaries; it must not
  spend one Watchmode request per card.
- `artwork.py`: authenticated same-origin artwork proxy and the bounded,
  rebuildable Pi cache at `/var/cache/mabeltv/tmdb-artwork`.
- `remote.py`: browser playback sessions, external media tokens/downloads and
  native MabelTV live/player commands.
- `lg_control.py`: LG webOS status, pointer session and command orchestration.
- `lg.py`: low-level webOS socket protocol and command catalogues.
- `live_stream.py`: live-picture ffmpeg process ownership and stream lifecycle.
- `usb.py`: removable-volume discovery, power, browsing, playback and imports.
- `system.py`: service/device status, temperature, support and admin actions.
- `http.py`: security headers, transport helpers, bounded request threads and
  explicit GET/POST route tables.
- `portal.py`: fail-fast assembly of the installed HTML and the ordered private
  `/portal-app.js` application bundle.
- `constants.py`: shared runtime limits and policy constants.

`mabeltv-state-migrate.py` is the separate migration, validation, owner-recovery
and online-backup command. It is the only production tool allowed to read the
retired JSON state snapshots.

## Persistence and mutation contracts

`/var/lib/mabeltv/mabeltv.db` is the sole structured state authority. A mutation
that changes related records and its cache revision commits them in one
`BEGIN IMMEDIATE` transaction. Channel add/update/delete uses targeted database
operations; renumbering moves metadata, favourites and disabled-programme
settings atomically. Settings use field-level merges so the native player and
portal cannot erase one another's unrelated keys. My TV title relationships
have one owner each: watchlist, Up Next and ratings live in their dedicated
relational tables.

The remaining JSON manifests under `.incoming` (including
`.incoming/.usb-imports`) and `.recycle-bin` describe recoverable filesystem
operations. They are deliberately file-backed, atomically replaced, and do not
duplicate application state. The durable manifest is their only owner; there is
no parallel in-memory USB job model.

MabelTV viewing history is append/update/delete state, not a document. Each
channel and local film resolves to a stable `viewing_items.id`; sessions retain
that ID plus the exact programme title and filename seen at playback time.
Supported channel renumbers/renames and film moves update the current catalogue
link without rewriting the historical programme snapshot. The Library writes
only the active session row and deletes selected rows directly. Do not restore
the former whole-history read/modify/write path.

Insights has four read contracts with separate scopes:

- `/api/viewing-insights/overview` is the range-controlled dashboard and
  defaults in the portal to seven calendar days;
- `/api/viewing-insights/catalogue` is the lifetime channel/film catalogue and
  is never filtered by the dashboard control;
- `/api/viewing-insights/item` owns an independent item range and defaults to
  all history;
- `/api/viewing-insights/diary` represents one local calendar date, split into
  morning, afternoon, evening and night while retaining viewing order.

Calendar boundaries use the browser's IANA timezone when available, with the
numeric offset only as a compatibility fallback. Cross-midnight sessions are
allocated by overlap, so a day and its periods receive only the seconds watched
inside their actual local boundaries, including 23/25-hour DST days.

## Portal and HTTP contracts

Simple JSON endpoints are registered in the named route tables in `http.py`.
Routes requiring query parsing, range streaming, setup authentication, cookies
or custom responses remain named handler methods. Every route passes through
one origin/authentication/security-header boundary.

Portal startup is atomic with the backend release. Missing HTML, partials,
application sources or the watch page is a startup failure; there is no embedded
stale fallback UI. The portal source list has one owner in `portal.py` and is
assembled into an IIFE so module-to-module calls stay inside one private scope.
Only separately loaded lifecycle owners (`MabelOffline`, `MabelAppCache`,
`MabelAssets`, `MabelExperienceTheme` and `MabelPortalUI`) publish names on
`window`; application routing, live TV and My TV viewing do not use global
compatibility bridges.

VLC receives a short-lived bearer URL from authenticated
`POST /api/external/start`. Cloudflare bypass is scoped only to
`/api/external/media`, and MabelTV validates that stream token before serving
range requests. Never broaden that exception to `/api/external/*`.

## Concurrency and lifecycle

`config_lock` serializes compound administrative and state read/modify/write
operations. Provider calls should happen outside that lock; merge the result
into freshly read state while holding the lock so a slow upstream response
cannot restore stale data. Dedicated locks own upload, viewing, remote-stream,
LG, artwork and USB mutable runtime state. Worker shutdown and `Library.close()`
must remain idempotent.

The SQLite layer provides cross-process serialization. In-memory Python locks do
not protect the native process, so all cross-process consistency must be encoded
as targeted SQL, constraints and transactions.

## Tests, installation and rollback

Every Library test owns a temporary database, media root, cache and transfer
area through `tests/python/library_test_support.py`. Domain suites live in
separate modules; do not recreate a single broad test file or import fixtures
from a test case module.

The executable and complete `mabeltv_backend` package ship as one release.
Backend/schema changes use the atomic installer, including a verified SQLite
online backup before upgrade. A rollback must restore a release compatible with
the restored database snapshot; never point old code at a newer unsupported
schema. Portal-only work may use the scoped portal deploy after explicit
authorization. See `quality-gates.md` and `state-database.md`.

## Native My TV projections

The authenticated portal `GET /api/my-tv/local-title` returns the current film
or series records for one canonical identity. It uses the local catalogue only,
with no TMDB/provider lookup, and does not imply membership from a Studio job.
Activity can therefore show a title before metadata finishes while checking its
actual playback actions. Full-library enumeration, bootstrap and device-cache
writes do not gate the card opening.

The HTTP worker ceiling remains 24. Saturation returns a bounded 503 JSON
response with Retry-After instead of resetting the upstream connection; bounded
request-header/body consumption avoids discarding that response with a TCP
reset. Upload/stream capacity and ordinary authentication remain unchanged.

`native_my_tv.py` owns the loopback-only TV card, title, season and app-launch
contract. Home and search return compact cards; episodes and cast are loaded
only for a selected title. Local artwork URLs retain the filenames already
stored in SQLite, while playback carries the exact film or episode library ID.
Native resume uses the same TV/browser bookmark reconciliation as the portal.
The series projection keeps current, last-watched and next episode identities
separate. A completed episode with a following episode remains in Continue
watching even without a resume bookmark. The loopback-only episode-complete
action validates the series and library ID, then delegates to the existing
episode watched-state owner; it accepts no client-supplied filesystem path.
Family browsing uses the shared `channel_library()` projection without scanning
the private catalogue, recycle bin or uploads. Its native directory and selected
channel routes return enabled channels and programmes with exact local playback
identity. Private artwork remains loopback scoped.
Availability is loaded for the selected title through the existing provider TTL,
independently of its basic details. The native artwork routes remain loopback
only; JSON requests also require the native header. They do not change parent
PIN protection on the portal's private routes.

The native family-channel directory omits resume hydration. A selected channel
projects only that channel through `channel_library(channel_number)`; the portal
keeps the complete projection and shared bookmark semantics.

## Playlists, listening and family memories

- `playlists.py` validates MabelTV programme membership and projects saved
  playlists. Its repository owns ordering and transactional queue snapshots.
- `family_media.py` owns the family-only catalogue, content projection, story
  listening position and bounded native/device playback sessions.
- `memory_composition.py` is a pure planner for
  bounded, orientation-aware photo layouts and transitions shared by both
  renderers; it does not read files, change state or control playback.
- `family_uploads.py` admits resumable audio/photo/video uploads and runs media
  preparation on the existing single conversion worker. Original files remain
  untouched after receipt. HEIC uses `heif-convert`; phone videos are rotated,
  capped at 720p/30fps and converted to H.264/AAC, with HDR tone mapping.
- `story_audio.py` validates the uncompressed chapter package and prepares its
  ordered recordings as one AAC story through that same worker. It keeps the
  untouched original archive, uses bounded temporary files, and honours worker
  cancellation and thermal pauses. The existing audio asset, duration, session
  and whole-story listening position remain the playback contract.

These mixins communicate only through the composed Library object. Family
content is separate from My TV and never bypasses My TV PIN boundaries. The
normal authenticated family content endpoint supports HTTP byte ranges. Native
family session/start/progress endpoints require loopback and the native header.
The native `family-media/stories` projection reads SQLite and exposes prepared
illustration URLs only to the loopback player. `open-storytime` on the existing
authenticated family-control route opens the TV catalogue without making a
listening session or changing saved progress.
A catalogue revision change is a `library` revision; no global Insights rewrite
is introduced and listening/memories do not record stale child-video sessions.

`my_tv_transfer.py` owns independent local My TV copies into typed Mabel TV channels. It queues recoverable copy journals through the existing upload worker and publishes ordinary channel files with separately copied descriptive metadata/artwork. My TV originals, identities and personal state never move or share mutable progress. Streaming-only titles cannot be copied.

## Studio companion and iCloud

- `studio.py` validates portal jobs, stable channel destinations and iPlayer requests.
- `studio_cloud.py` owns the independent iCloud catalogue cache and refresh thread.
- `studio_cloud_auth.py` runs the private rclone question protocol over a protected Unix socket; credentials never enter command arguments or logs. Pending credentials are proved before atomic promotion.
- `studio_http.py` dispatches only after the shared origin/session gates.
- `repositories/studio.py` owns independent `studio.job.*`, `studio.request.*` and `studio.worker.*` checked fields in the existing SQLite application field store. Ordinary settings reads exclude this reserved namespace, and aggregate settings writes preserve it. Native writers merge only their explicit fields. Jobs and claims update inside BEGIN IMMEDIATE; request results and finished history are bounded. Each record has its own updated timestamp; Studio uses no-store independent polling, not whole-library refreshes. No schema/native compatibility change is required.

The Pi owns queued intent, claims, progress and cloud catalogue availability. Windows owns operational transfer journals, hydration, conversion and upload. A lease prevents two workers from publishing the same item. Paused/cancelled jobs reject late progress. A worker restart reuses the existing transfer and final publication result. Processing preserves cloud originals; a separate confirmed action can delete selected films/episodes and their subtitles. iCloud credentials remain under the private secrets directory; catalogue snapshots alone are disposable. Series publication supports season 0 for specials and preserves source seasons in a mixed-season batch.

Workers advertising `parallel-stages` exchange bounded `activeJobs` and
`acknowledgedJobs` arrays and may hold twelve foreground job leases, with
background iCloud saves excluded from that window and no total background count
limit. Progress messages contain at most 64 records; a fresh matching worker
session retains unchanged background claims between updates. A new session or
stale worker allows ordinary lease recovery. The
repository claims only remaining capacity within the same transaction, renews
each claim separately and keeps cancellation commands scoped to their job.
Legacy workers keep the single-active-job protocol. Windows `stage-resources.cjs`
owns five download slots shared across sources, one conversion slot, one Pi
transfer slot and aggregate disk reservations with a 20 GiB free-space floor.
The local queue and companion release each stage independently; iCloud archive
confirmation retains a job journal but never a download/conversion/Pi slot.

`studio_cloud_metadata.py` projects only films and TV, groups series, categorises Films/TV/Kids, and matches cloud titles through the shared TMDB transport. Durable identity/fingerprint links are reserved `studio.cloudmetadata.*` fields; descriptive title/year/poster/overview data remains in canonical `external_titles`. Automatic matching requires one exact result and cannot overwrite an explicit correction. No Pi library membership or player command is created by matching.

`studio_cloud_manager.py` owns only confirmed deletion of selected videos and matching subtitle sidecars. It accepts catalogue identities and frozen versions, derives paths on the server, rechecks each cloud file before fixed rclone `deletefile` commands, and never admits folders, arbitrary paths or rename/move/mkdir. Legacy queued folder operations fail without mutation. Separate Pi copies are untouched.

`studio_torrents.py` owns checked torrent search and metadata-inspection intents.
It freezes only selected video files from a completed, hash-bound inspection;
arbitrary paths/magnets are not accepted as queue sources. Provider replies are
bounded and canonicalised before storage/rendering. Requests and jobs retain
the existing Studio leases in SQLite, with capability-aware claims so older
companions cannot consume torrent work. Search, peer transfer and media work
remain on Windows; no torrent client or video payload is run on the Pi.

`studio_cloud.py` groups videos beneath an explicit TV/show directory with that
show even when the filename lacks an episode number. Unnumbered extras and
specials are retained as distinct season-zero entries; they are not film titles.

`studio_organiser.py` quietly resolves one film/series per catalogue-loop step.
`studio_organiser_model.py` uses bounded, non-stored Responses requests to
GPT-6 Luna for search hints and selection among actual TMDB candidates. It
cannot generate metadata facts, filesystem destinations or commands. Descriptive
metadata remains in `external_titles` and the shared TMDB cache, including the
normal credits/director path. Owner corrections take priority. The private API
key lives outside source and SQLite at `secrets/openai/api-key` beside the
database, readable only by the service account. Provider errors are redacted.

`studio_filing_policy.py` owns deterministic destinations: standalone films are
loose in Films or Kids/Films; real franchises need at least two distinct owned
films, deduplicated by canonical movie identity. Per-title collection links
and targeted membership stamps recheck only that collection when its films
are added or removed, using cached matches without new AI calls. The owner's Disney,
Julia Donaldson and MCU groups get folders. MCU remains one folder with its
original numbered film order, overriding individual Marvel subcollections.
DreamWorks, Christmas and per-film folders are not created. Series keep their
existing show, season and episode names.

`studio_cloud_filing.py` applies that policy to verified metadata. Existing
filenames are retained; stable-ID suffixes resolve collisions only. Existing
same-stem subtitle sidecars move with their videos, but Studio never uploads
new subtitles to iCloud. Checked file versions
carry canonical title links through cloud-side renames, including series-group
identity changes. Reserved `studio.filing.*` SQLite journals checkpoint each
move and recover an unacknowledged move by checking both endpoints. Existing
targets are never overwritten, unmatched episodes are not renumbered, and no
duplicate/original is automatically deleted. The rclone Move capability is
required and a one-byte transfer ceiling blocks fallback video hydration on the
Pi. Active or paused Studio sources and pending deletions are not relocated.
New archive metadata may resolve during publication; its verified identity is
reused by Studio before filing resumes after the transfer completes. This
lightweight cloud/API coordination does not run video conversion or invoke the
native player. Activity shows only current work or an actionable failure.

Organiser memos are durable per-input state, separate from the 200-item completed
job history. A memo includes the relevant film/episode versions and canonical
match identity; unrelated catalogue, settings and viewing changes are excluded.
Successful and uncertain decisions have no scan/restart expiry. Filing-policy
changes reapply destinations using the saved match without rerunning AI;
unchanged uncertain decisions stay cached. A new episode
invalidates only its series filing memo and reuses existing series metadata.
Prompt/model-versioned AI response memos protect retries after interruption;
they contain search hints or catalogue IDs, never canonical descriptions or
credentials. The bounded request cache and monthly aggregate request/token
receipts use independent reserved fields through `repositories/studio.py`.
Local series collection changes update only `my_tv_series.extra_json` through
`set_my_tv_series_collection`, within a transaction with the library revision.
Episode roots, identities and metadata remain independently owned. Cloud
collection definitions/memberships use reserved `studio.cloudcollection.*` and
`studio.cloudmembership.*` fields; their catalogue revision is independent of
local My TV collections. Confirmed Studio cloud archives inherit only their
explicit cloud destination collection.
