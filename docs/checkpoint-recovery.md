# Recovery checkpoint - 31 October 2026

This repository contains the Pi application, portal/backend, deployment and
fresh-card tooling, MabelTV Studio (`tools/studio`), and retained surround designs.
Studio belongs in this repository; its dependencies and generated installers
are rebuilt rather than stored in Git.

## Source checkpoint

GitHub repository: https://github.com/Pinbecker/MabelTV (branch `main`).
After pushing a checkpoint, verify the same full commit ID locally and on GitHub.
An exact source export is retained on the development Pi under
`/home/pinbecker/mabeltv-source-checkpoints/<full-commit-id>/`, beside its
`.tar.gz`, checksum and recovery receipt. This is a source copy, not a live
installation. Do not replace `/opt/mabeltv/current` with a source export.

The development Pi is `pinbecker@mabeltv-512.local`. The owner's public portal
is https://mabeltv.dancoakes.uk through Cloudflare Access and its tunnel to the
Pi's Library service. Domain/tunnel/Access recovery also requires the owner's
Cloudflare account and fresh tunnel authorization where necessary.

At this checkpoint the installed release is
`/opt/mabeltv/releases/0.2.5-20261028183329`; the previous release is
`/opt/mabeltv/releases/0.2.5-20261025200302`. Source changes for fresh-card/build
work can exist beyond an installed release. Saving or pushing source does not
install those changes. The running native binary SHA-256 is
`149bfed2be9d028758bcaa6a465293af480ee02014c661c9630d23e978e3ec1f`.

## Personal state backup

The scheduled Pi backup uploads database and device/settings snapshots to the
owner's private OneDrive: `Documents/MabelTV Backups/snapshots`.
The confirmed 31 October recovery point is
`2026/10/MabelTV-Backup-2026-10-31T031650Z.tar.gz`, SHA-256
`f823b2a9d87f15b73dd2256a4ebabd7c0f604ff56631a8ed408c5249ea9d2cfc`.
It contains the SQLite online-backup snapshot plus the secrets, pairing data
and configuration described in [OneDrive backups](onedrive-backups.md).
Credentials and mutable personal state must stay out of GitHub.

## Rebuild and restore

1. Obtain this repository from GitHub at the intended checkpoint. Use
   [Pi setup](raspberry-pi-setup.md) or [SD-card installer](sd-card-installer.md)
   to build/install a compatible release; follow [quality gates](quality-gates.md).
2. Download the chosen private OneDrive snapshot and checksum. Verify both
   archive and internal checksums, rehearse the restore in isolation, then
   restore using [OneDrive recovery](onedrive-backups.md#recovery) and
   [database recovery](state-database.md#backup-restore-and-rollback).
   Never copy a live SQLite main file alone. Match the restored schema to the
   application version and preserve a rollback point.
3. Restore media separately at its original relative paths. Verify service,
   database, portal, playback, pairing and public-domain access after recovery.
4. On a replacement Windows PC, follow [Studio development/build instructions](../tools/studio/README.md#development).
   Install Node 22.12+ and the documented media tools, run `npm ci`,
   `npm run bundle:tools`, then `npm run package`. Install the resulting
   Windows installer and sign in to the portal again.

## Recovery limits

GitHub protects project source, not a complete disk image. The scheduled Pi
backup excludes `/srv/mabeltv/media` (including artwork), caches, binaries,
Cloudflare tunnel credentials, and installed-PWA device storage. Media needs
its own off-device copy. PWA downloads must be downloaded again.

Studio settings/queue and browser sign-in live in its Windows user profile;
prepared videos live under `C:/Users/danco/Videos/MabelTV Studio` on this PC.
Those are not stored in Git or in the Pi backup. Studio can be rebuilt from
source, but recovery of its existing jobs and local videos requires a separate
private backup. The source checkpoint alone does not prove total-device-loss
recovery of media, local Studio history, or public-domain credentials.

Ignored `work/` and `out/` contain local evidence, temporary snapshots and
build output. They are retained locally and are not required for a normal
source build. They are not included in the Git checkpoint.
