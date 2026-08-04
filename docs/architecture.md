# Architecture and data layout

Mabel TV is one native Qt 6 process. QML owns the television presentation and input handling; C++ owns channel policy, state, validation, logging, synthetic sounds, and the libmpv OpenGL render bridge. libmpv decodes only the current programme, while Qt ShaderTools supplies the lightweight CRT post-process.

```text
Linux rc-core / USB keyboard
             │ evdev keys
             ▼
        QML input layer ─────► hidden parent panel
             │
             ▼
        TvController ────────► settings + timeline state
             │ playback URL / offset
             ▼
       MpvVideo/libmpv ──────► Qt OpenGL texture ─► CRT shader ─► KMS/HDMI
```

Persistent Pi paths:

| Path | Purpose | Mutability |
| --- | --- | --- |
| `/opt/mabeltv/releases/*` | immutable timestamped binaries | installer only |
| `/opt/mabeltv/current` | atomically selected release link | installer/rollback |
| `/var/lib/mabeltv/channels.json` | channel numbers, names, folders, aspect | parent/operator |
| `/var/lib/mabeltv/settings.json` | parent choices and PIN | application |
| `/var/lib/mabeltv/state.json` | volume, channel and broadcast timeline | application |
| `/var/lib/mabeltv/media-index.json` | ffprobe result cache | application/tools |
| `/var/log/mabeltv` | rotating application and soak logs | application/tools |
| `/srv/mabeltv/media` | user-supplied programmes | operator |
| `/etc/rc_keymaps/mabeltv.toml` | learned IR scan-code map | remote mapper |

There is no network playback, cloud service, database, web server, desktop session, or CEC control path. Network access is only an operating-system/SSH concern during setup and updates.
