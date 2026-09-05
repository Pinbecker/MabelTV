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
- `uploads.py`: resumable upload records, queueing, publication, playback
  inspection, and conversion/optimisation workers.
- `viewing.py`: private viewing samples, session compaction, retention, and
  insights.
- `providers.py`: TMDB, Watchmode, OpenSubtitles, artwork, Adult discovery, and
  provider-backed viewing metadata.
- `usb.py`: removable-volume discovery, browsing, power state, playback, and
  imports.
- `remote.py`: phone playback, external streams/downloads, live TV control,
  and the separate LG TV remote.
- `system.py`: service/device status, temperature, support and admin actions.
- `lg.py`: the small WebOS socket protocol client and LG command catalogues.
- `http.py`: security headers, transport helpers, bounded server threads, and
  explicit GET/POST route tables.
- `portal.py`: server-side portal assembly and preserved emergency fallback
  documents.
- `constants.py`: policy limits and shared provider/runtime constants.

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

Rollback is release-level: point `/opt/mabeltv/current` back to the previous
complete release and restart the library service. Never combine an executable
from one revision with backend modules from another.

## Change rules

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
