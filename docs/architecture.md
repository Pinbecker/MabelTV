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
| `/var/lib/mabeltv/channels.json` | channel numbers, names, folders, aspect, show/film type | browser dashboard/operator |
| `/var/lib/mabeltv/owner.json` | first-run state and salted parent-PIN verifier | browser dashboard |
| `/var/lib/mabeltv/settings.json` | parent choices | application |
| `/var/lib/mabeltv/state.json` | volume, channel, broadcast timeline, and current-uptime episode inactivity markers | application |
| `/var/lib/mabeltv/media-index.json` | ffprobe result cache | application/tools |
| `/var/lib/mabeltv/secrets/tmdb-api-key` | optional root-controlled TMDB key | operator |
| `/var/log/mabeltv` | rotating application and soak logs | application/tools |
| `/srv/mabeltv/media` | user-supplied programmes | operator |
| `/media/mabeltv-usb/*` | transient read-only removable-media mounts | appliance helper |
| `/etc/rc_keymaps/mabeltv.toml` | learned IR scan-code map | remote mapper |

There is no cloud service, account database, or desktop session. A bounded standard-library HTTP service provides the LAN-only grown-up dashboard on port 8080. It writes uploads into a staging inbox, publishes only complete media, owns channel/browser-library mutations, and sends the player a coalesced live-reload signal. Authenticated portal power POSTs and the IR power key both reach the same `TvController` operations through the private player socket. `CecTvControl` asynchronously invokes `cec-client`; failures are journalled but never block MabelTV standby or wake. Avahi advertises the local address; nothing is intentionally exposed beyond the home network.

Media discovery has two phases. Startup admits unchanged cached files immediately and provisionally admits new readable video paths so systemd readiness is never held behind hundreds of probes. A QtConcurrent worker validates uncached/changed files, writes the media index atomically, and publishes the result on the main thread. Live reload keeps the last-known-good library playing until the worker completes.
