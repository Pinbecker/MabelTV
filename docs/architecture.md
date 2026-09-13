# Architecture and data layout

Mabel TV is one native Qt 6 process. QML owns the television presentation and input handling; C++ owns channel policy, state, validation, logging, synthetic sounds, and the libmpv OpenGL render bridge. libmpv decodes only the current programme, while Qt ShaderTools supplies the lightweight CRT post-process.

The internal QML composition and controller implementation boundaries are
documented in [Native television architecture](native-architecture.md).

```text
Linux rc-core / USB keyboard
             │ evdev keys
             ▼
        QML input layer ─────► hidden parent panel
             │
             ▼
        TvController ────────► settings + timeline state
             │ explicit on/off
             ├───────────────► CecTvControl ─► cec-client ─► HDMI TV
             │ playback URL / offset
             ▼
       MpvVideo/libmpv ──────► Qt OpenGL texture ─► CRT shader ─► KMS/HDMI
```

Persistent Pi paths:

| Path | Purpose | Mutability |
| --- | --- | --- |
| `/opt/mabeltv/releases/*` | immutable timestamped binaries | installer only |
| `/opt/mabeltv/current` | atomically selected release link | installer/rollback |
| `/var/lib/mabeltv/mabeltv.db` | authoritative channels, settings, owner/authentication fields, player state, viewing history, Adult catalogue/viewing/Insights state and portal revision counters | native player and Library service |
| `/var/lib/mabeltv/mabeltv.db-wal`, `mabeltv.db-shm` | live SQLite WAL coordination files; never back up independently | SQLite only |
| `/var/lib/mabeltv/secrets/` | provider credentials and other root-controlled integration secrets | operator |
| `/var/lib/mabeltv/matter/` | device-specific Matter fabric and commissioning state | Matter service |
| `/var/lib/mabeltv/media-index.json` | ffprobe result cache | application/tools |
| `/var/cache/mabeltv/tmdb-artwork` | bounded, rebuildable upstream artwork cache | Library service |
| `/var/log/mabeltv` | rotating application and soak logs | application/tools |
| `/srv/mabeltv/media` | user-supplied programmes, upload work files and rebuildable generated material | operator and Library service |
| `/media/mabeltv-usb/*` | transient read-only removable-media mounts | appliance helper |
| `/etc/rc_keymaps/mabeltv.toml` | learned IR scan-code map | remote mapper |

There is no external application database or desktop session. The native player
and bounded standard-library HTTP service share the local SQLite database in WAL
mode and use short transactions. The HTTP service provides the grown-up portal
on port 8080, writes uploads into a staging inbox, publishes only complete
media, owns channel/browser-library mutations, and sends the player a coalesced
live-reload signal. Authenticated portal power POSTs and the IR power key both
reach the same `TvController` operations through the private player socket.
`CecTvControl` asynchronously invokes `cec-client`; failures are journalled but
never block MabelTV standby or wake. Avahi advertises the local address.

The retained pre-migration JSON documents are recovery evidence, not live
stores. Only the explicit import/validation tool and test fixtures accept those
documents; runtime commands and production reads and writes use `mabeltv.db`
only.
See [MabelTV state database](state-database.md) for the authority, migration,
backup and rollback contracts. The installed HTTPS PWA has separate device-side
shell, response, artwork and Downloads stores described in
[PWA offline and device-cache architecture](pwa-offline-cache.md).

Media discovery has two phases. Startup admits unchanged cached files immediately and provisionally admits new readable video paths so systemd readiness is never held behind hundreds of probes. A QtConcurrent worker validates uncached/changed files, writes the media index atomically, and publishes the result on the main thread. Live reload keeps the last-known-good library playing until the worker completes.
