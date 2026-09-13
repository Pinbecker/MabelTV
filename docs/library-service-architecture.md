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
- `auth.py`: first-time setup, owner identity, PIN verification, login limits
  and session lifetime.
- `media.py`: read models for channels, programmes, Adult media and safe media
  paths. Structured state goes through the database; its `read_json` and
  `write_json` helpers are only for operational filesystem journals.
- `management.py`: serialized administrative mutations for channel/settings
  changes, media organization and the recoverable recycle-bin workflow.
- `uploads.py`: resumable upload records, queueing, publication and worker
  lifecycle. `.incoming` manifests are operational journals.
- `transcoding.py`: probing and media conversion/optimization policy used by
  uploads and USB preparation.
- `viewing.py`: viewing samples, session compaction, retention and MabelTV
  viewing insights.
- `viewing_queue.py`: validation and atomic persistence of Adult Up Next order.
- `provider_transport.py`: API-key reads, bounded HTTP transport, response
  caching and OpenSubtitles transport.
- `adult_metadata.py`: Adult TMDB titles, series, people, collections,
  Watchmode availability and the merge with local/viewing state.
- `providers.py`: children's channel and local-film metadata matching and
  application.
- `adult_insights.py`: Adult watched/rating aggregates and progressive TMDB
  enrichment.
- `discovery.py`: curated paginated Explore results enriched with local state.
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
portal cannot erase one another's unrelated keys. Adult title relationships
have one owner each: watchlist, Up Next and ratings live in their dedicated
relational tables.

The remaining JSON manifests under `.incoming` (including
`.incoming/.usb-imports`) and `.recycle-bin` describe recoverable filesystem
operations. They are deliberately file-backed, atomically replaced, and do not
duplicate application state. The durable manifest is their only owner; there is
no parallel in-memory USB job model.

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
`window`; application routing, live TV and Adult viewing do not use global
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
