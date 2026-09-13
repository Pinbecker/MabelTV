# PWA offline and device-cache architecture

The installed HTTPS iOS PWA is the primary MabelTV portal. Its device storage
has three distinct jobs: keep the application shell launchable, make previously
loaded data and artwork fast, and retain explicitly downloaded media for
offline playback. These stores have different security and lifetime rules and
must not be merged.

## Storage ownership

| Store | Contents | Authority and lifetime |
| --- | --- | --- |
| Cache Storage `mabeltv-shell-v<release>` | HTML, CSS, first-party JavaScript, icons and other shell assets | Immutable, rebuildable shell generation. The current and immediately previous generations are retained. |
| IndexedDB `mabeltv-app-cache-v1`, store `snapshots` | Successful authenticated API response snapshots and their SQLite revision | Disposable speed cache. SQLite remains authoritative. |
| Cache Storage `mabeltv-artwork-family-v1` | Same-origin MabelTV channel artwork | Rebuildable cache, bounded to 1,000 responses. |
| Cache Storage `mabeltv-artwork-protected-v1` | Same-origin Adult posters, backdrops, people and related TMDB artwork | Rebuildable and PIN-protected, bounded to 1,000 responses. |
| IndexedDB `mabeltv-offline-v1`, stores `downloads`, `chunks`, `security` | Download manifests, 4 MiB media chunks, subtitles and the salted local PIN verifier | Durable per-device user content. Never clear it as part of a shell or response-cache upgrade. |

The browser controls the physical quota and can evict site data. MabelTV asks
for persistent storage when the platform supports it and checks estimated free
space before downloading, but the Downloads screen remains the user-visible
record of what is actually available on that device.

## Fast online startup

`portal/js/core/app-cache.js` owns response snapshots. A warm launch performs
the public setup/authentication check first, then `/api/bootstrap` returns the
current SQLite schema and revision counters. Only an authorised snapshot with a
matching domain revision may paint. Changed or stale domains refresh in the
background and replace their snapshot after a successful response.

The revision ledger lives in SQLite and is incremented in the same transaction
as the authoritative state change. This prevents a response snapshot from
appearing current when the data it represents has changed. Rendering code must
preserve mounted views and update only the changed content; a background refresh
must not blank, flash, or rebuild an already-correct screen.

Snapshots may contain private response data, including Adult metadata, so they
must never be read before authentication. Sign-out, lock and PIN transitions
must remove or hide protected rendered state immediately. A cache failure is a
performance loss only: online reads still come from the Pi and all writes go to
the authenticated API and SQLite.

## Artwork caching

The service worker caches successful same-origin artwork proxy responses by URL.
The same actor, title, episode or collection URL is therefore reused across
cards and screens. Provider URLs are normalised by the portal asset helper so
equivalent images share a cache key.

Opened title and season details also have disposable IndexedDB snapshots. A
season snapshot paints its complete episode list immediately on later opens,
including after a cold app launch, while current SQLite viewing state is
overlaid separately. Metadata older than one day refreshes in the background;
the refreshed metadata appears on the next opening rather than rebuilding or
flashing the sheet currently being viewed.

Family artwork can be served directly from its cache. Adult artwork is returned
from the protected cache only when the requesting service-worker client has
been unlocked. If a locked client is offline it receives 401 rather than cached
private artwork. The Pi also keeps a separate rebuildable upstream TMDB artwork
cache at `/var/cache/mabeltv/tmdb-artwork`; neither artwork cache is application
state or part of the SQLite authority boundary.

## Shell and offline behaviour

`service-worker.js` owns shell installation and fetch routing:

- `SHELL_URLS` are required for a complete offline shell. Installation fails
  and removes the candidate cache if any required asset cannot be cached.
- `LAZY_SHELL_URLS` are optional features cached on first use.
- app navigation requests use the cached root document, so every bottom section
  can open while disconnected and show its reconnect state;
- `/watch/player` navigation is network-only and returns a clear 503 offline,
  because its stream token and media source belong to a live session;
- ordinary API responses are not put in Cache Storage;
- online artwork is cache-first through the appropriate family/protected cache;
- `/offline-media/<id>` and `/offline-subtitles/<id>.vtt` read the Downloads
  IndexedDB and enforce Adult access before returning bytes.

A newly installed worker waits while an existing app session is open. The app
explicitly activates the ready generation, avoiding mixed HTML/JavaScript
versions during a session. Activation keeps the current and previous shell and
removes older shell generations only. Every delivered shell-asset change must
increment `SHELL_RELEASE`, update `PREVIOUS_SHELL_CACHE`, and keep the prior
complete shell available for rollback.

## Downloads and Adult protection

`mabeltv-offline-schema.js` is the single IndexedDB name/version/upgrade owner
shared by the page and worker. `mabeltv-offline.js` owns download creation and
device storage. Downloads are
written incrementally as Blob chunks so iOS does not need a complete film in
memory. Partial downloads can resume, completed media supports HTTP byte ranges,
and subtitles are stored with the manifest.

Adult manifests are marked `protected` and are also recognised by their source
kind for compatibility. The device stores a PBKDF2 digest and salt, never the
PIN. Successful verification unlocks only the current in-memory service-worker
client. A cold launch, worker restart, lock or loss of that client requires
verification again. Closed client IDs are pruned from the worker's in-memory
unlock set. Never persist an `unlocked` flag or move protected artwork
or media into a generally readable cache.

## Change rules

- Keep SQLite authoritative; never treat a device snapshot as writable state.
- Preserve the separate database/cache names unless an explicit, tested
  migration retains existing downloads and security records.
- Add a required runtime asset to `SHELL_URLS`; add a genuinely optional asset
  to `LAZY_SHELL_URLS`.
- Increment `SHELL_RELEASE` once per delivered shell generation and update the
  previous-generation name. Do not churn it for documentation, tests or backend
  changes that do not alter served shell bytes.
- Test worker routing and storage upgrades with
  `tests/js/test-offline-service-worker.mjs`; test real registration, offline
  navigation, download survival and Adult locking with `pwa.spec.mjs` in both
  iPhone WebKit and Chromium.
- Validate warm rendering and revision behaviour without arbitrary sleeps.
  Gate on requests, DOM state or a controlled response promise so timing
  failures identify a real contract break.

The visual and navigation contract remains in
[iOS PWA compatibility baseline](ios-pwa-baseline.md), and module ownership is
listed in [Portal architecture](portal-architecture.md).
