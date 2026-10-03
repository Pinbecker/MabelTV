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
- `auth.py`: first-time setup, owner identity, PIN verification, login limits
  and session lifetime.
- `media.py`: read models for channels, programmes, My TV media and safe media
  paths. Structured state goes through the database; its `read_json` and
  `write_json` helpers are only for operational filesystem journals.
- `management.py`: serialized administrative mutations for channel/settings
  changes, media organization and the recoverable recycle-bin workflow.
- `uploads.py`: resumable upload records, queueing, publication and worker
  lifecycle. `.incoming` manifests are operational journals.
- `transcoding.py`: probing and media conversion/optimization policy used by
  uploads and USB preparation.
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
