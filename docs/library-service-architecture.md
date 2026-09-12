# Library service architecture

The local library service is the private backend for the MabelTV portal and
installed iOS PWA. Its HTTP URLs, cookies, JSON shapes, local data files, and
systemd entry point are compatibility contracts. Structural work must not
change those contracts unless a separate feature explicitly requires it.

## Stable entry point

`scripts/pi/mabeltv-library.py` is the executable compatibility shell. It owns
process startup, the live-picture helper, construction of shared runtime state,
and the public names used by existing tests and maintenance tools. It composes
focused mixins from `scripts/pi/mabeltv_backend` into the public `Library`
class; callers do not need to know which module implements a method.

## Backend ownership

- `auth.py`: first-time setup, owner identity, PIN verification, login limits,
  and session lifetime.
- `media.py`: channel and Adult media catalogues, saved state, recycle-bin and
  management actions, settings, and safe media paths.
- `uploads.py`: the shared durable transfer queue, resumable records,
  publication, playback inspection, and conversion/optimisation workers.
- `viewing.py`: private viewing samples, session compaction, retention, and
  MabelTV playback-session insights.
- `viewing_queue.py`: validation and atomic persistence of the ordered Adult TV
  Up Next queue.
- `adult_insights.py`: timeless Adult TV watched-history and personal-rating
  aggregates. It progressively caches TMDB genres and credits on the Pi, never
  calls Watchmode, and deliberately does not treat backfilled watched marks as
  viewing dates. Its response includes the cached per-title genres, countries,
  languages and credited-person IDs used for instant client-side drill-downs.
- `providers.py`: TMDB, Watchmode, OpenSubtitles, artwork, title and person
  search, and provider-backed viewing metadata. Multi-search returns people as
  identity-only results; local and viewing state remains exclusive to titles.
  Explicit film matches retain TMDB genre names in `metadata.genres` for the
  local film filter; films without a match remain visible in All genres.
- `discovery.py`: curated, paginated TMDB Explore lists. It enriches catalogue
  results with current local/viewing state but never performs Watchmode calls.
  The Adult TV home can additionally require a supported UK flatrate, free or
  ad-supported provider; rent and purchase offers never qualify that feed.
- `usb.py`: removable-volume discovery, browsing, power state, playback, and
  imports. USB imports feed the shared upload queue so they retain progress,
  survive restarts, and use the same validation and publication path.
- `remote.py`: phone playback, external streams/downloads, live TV control,
  and the separate LG TV remote.
- `system.py`: service/device status, temperature, support and admin actions.
- `lg.py`: the small WebOS socket protocol client and LG command catalogues.
- `http.py`: security headers, transport helpers, bounded server threads, and
  explicit GET/POST route tables.
- `portal.py`: server-side portal assembly and preserved emergency fallback
  documents.
- `constants.py`: policy limits and shared provider/runtime constants.
- `database.py`: the authoritative relational SQLite schema and the adapters
  that preserve established backend dictionary/API shapes. Production reads
  and writes do not fall back to the retained migration-source JSON files.

`mabeltv-state-migrate.py` is the separate, one-time migration and validation
command. It is the only production tool that reads the superseded JSON state
after cutover. It also creates consistent SQLite online-backup snapshots.
The authority boundary, cutover proof, rollback route, and future schema rules
are defined in `docs/state-database.md`.

Modules may call another responsibility through `self` on the composed
`Library`; they should not import the executable or another mixin class. This
keeps the dependency direction one-way and avoids circular imports.

## Routing contract

Simple JSON endpoints live in the named route tables in `http.py`. Routes that
need query parsing, range streaming, authentication setup, cookies, or a custom
response remain small named handler methods. Every request still passes through
the same origin, authentication, security-header, and error boundaries as the
original single-file service.

## Installation and rollback

The executable and the complete `mabeltv_backend` package must be installed
together in the same release directory. `install.sh` stages and syntax-checks
both before switching `/opt/mabeltv/current`; the Windows developer deploy also
recognises backend-module changes and restarts only `mabeltv-library.service`.
Backend or portal changes do not require rebuilding the native QML/C++ player.

The Adult viewing store owns the durable Up Next rank. The portal persists a
complete reordered queue in one authenticated `POST /api/adult/viewing/reorder`
request so a drag cannot leave a partially moved queue behind. Personal
recommendations are built from positively rated watched-title seeds and cached
Adult-insights genre metadata; the separate broad shelf supplies deliberate
variety. Availability checks remain TMDB-only and limited to included, free or
ad-supported UK providers.

Rollback is release-level: point `/opt/mabeltv/current` back to the previous
complete release and restart the library service. Never combine an executable
from one revision with backend modules from another.

## Change rules

### External-player transport

VLC receives a temporary bearer URL from the authenticated
`POST /api/external/start` route. It does not inherit the browser's Cloudflare
Access cookie. On the live `mabeltv.dancoakes.uk` deployment, the Cloudflare
application **MabelTV VLC token streams** applies a path-specific Bypass policy
only to `/api/external/media`; MabelTV still validates the stream token before
serving bytes. Keep the portal and `/api/external/start` behind the normal
Access policy. Do not broaden this exception to `/api/external/*`.

Verify changes with a fresh token and cookie-free HTTPS range requests,
including a middle-file range and suffix range. Missing and invalid tokens
must return the backend's rejection, while protected portal routes must still
require Cloudflare sign-in. A sign-in HTML response to a media request is a
transport failure, even if following the redirect produces HTTP 200.

### Source changes

- Preserve route paths, status codes, cookie attributes, response fields, and
  on-disk schemas during a refactor.
- Keep standard-library-only operation unless a deliberate packaging decision
  adds and validates a runtime dependency.
- Put new behaviour in the module that owns it; do not grow the compatibility
  shell or add a second route ladder.
- Preserve the patchable public names in `mabeltv-library.py` while existing
  tests and maintenance scripts depend on them.
- Run the complete Python, JavaScript, browser, and Pi service checks before a
  live checkpoint.
