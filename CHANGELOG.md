# Changelog

All notable Mabel TV product changes are recorded here.

## 0.2.0 - release candidate

This release turns the original family installation into a generic Raspberry Pi 4 appliance foundation. It is not cleared for paid or general-availability distribution until every item in `docs/release-readiness.md` has evidence and sign-off.

### Added

- Guided first-run pairing with a one-time physical setup code, owner-selected PIN, and editable starter channels.
- Private browser dashboard for media, channels, health, support, safe restart, reboot, shutdown, and PIN changes.
- Durable resumable uploads, one persistent preparation queue, heat-aware 720p/30 fps conversion, and atomic publication.
- Read-only doctor, support bundles, boot/crash evidence, health monitoring, retention, rollback, and non-destructive uninstall tools.
- Physical forgotten-PIN recovery from the Raspberry Pi boot drive without deleting channels or videos.
- Traceable prebuilt release bundles with exact-OS manifests, corresponding-source archives, checksums, and optional signatures.

### Changed

- Generic product channels replace installation-specific defaults.
- Media-library scanning and validation run away from the television event loop.
- Player, loading, and rendered-frame watchdogs now make controlled evidence-preserving restarts; an unchanged stalled programme remains quarantined until it is replaced.
- Release activation and rollback now keep binaries, services, helpers, and web assets together as one transaction.
- Boot configuration removal is token-aware and retains unrelated owner changes.

### Stability and safety

- Logs, backups, releases, recovery snapshots, uploads, recycle-bin items, memory, tasks, and file descriptors are bounded.
- Upload activity, final publication, TV refresh failures, and recycle-bin moves survive interrupted requests and service or power loss without silently losing media.
- Sound-effect commands now drain their dedicated playback event queue, preventing long-running remote-control use from exhausting it.
- Ordinary compatible MP4 programmes remain untouched; only media that needs preparation is converted.
- The CRT treatment retains its established appearance and is bypassed only when both CRT controls are switched off.
