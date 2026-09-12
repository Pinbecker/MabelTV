# OneDrive disaster-recovery backups

MabelTV creates one immutable, dated archive per run and uploads it directly
from the Raspberry Pi to the owner's private OneDrive folder at
`Documents/MabelTV Backups/snapshots`. The Windows PC is needed only to complete
the initial browser-based Microsoft authorization.

## Backup boundary

Every archive contains a validated SQLite online-backup snapshot of
`/var/lib/mabeltv/mabeltv.db`, `/var/lib/mabeltv/secrets`,
`/var/lib/mabeltv/matter`, `/etc/mabeltv`, and
`/etc/rc_keymaps/mabeltv.toml` when present. It also contains a manifest and
relative-path SHA-256 checksums. The Matter service is paused only while its
multi-file fabric is copied; the player and Library continue running.

Media under `/srv/mabeltv/media`, caches, artwork, logs, support bundles,
release binaries, the live SQLite WAL/SHM files, and PWA device storage are not
included. The rclone configuration is also excluded because it contains the
OAuth token used to reach the backup itself. A replacement Pi must be
authorized before recovery.

The archives contain authentication, API, LG pairing, and Matter credentials.
They are deliberately not additionally encrypted, so the local staging folder,
rclone configuration, and OneDrive folder must remain private.

## Setup and operation

Install rclone, then run `sudo mabeltv-configure-onedrive-backup`. Create a
Microsoft OneDrive remote named exactly `onedrive`. On a headless Pi, answer no
to automatic browser authentication and run the displayed `rclone authorize`
command on the Windows PC. Complete Microsoft sign-in in the browser and paste
the returned authorization result into the Pi prompt.

The configuration is stored at `/etc/rclone/mabeltv.conf` with mode `0600`.
After configuration, verify a test create/read/delete from the Pi. The setup
helper enables `mabeltv-onedrive-backup.timer`; it runs daily at approximately
03:15 Europe/London, catches up after downtime, and prevents overlapping runs.
Run an immediate backup with:

```bash
sudo systemctl start mabeltv-onedrive-backup.service
sudo journalctl -u mabeltv-onedrive-backup.service -n 100 --no-pager
```

The job uploads through a unique partial name, reads the remote archive back
through SHA-256, publishes the archive and sidecar without overwriting an
existing recovery point, and only then applies retention. It keeps the newest
seven local archives, 35 daily remote points, 12 weekly points, and 24 monthly
points. A failed upload or verification never prunes a previous backup.

## Recovery

On a replacement Pi, install Raspberry Pi OS and a MabelTV release compatible
with the schema recorded in the archive manifest. Configure fresh OneDrive
authorization, download the chosen archive and sidecar into a root-only staging
directory, verify the archive SHA-256, extract it in staging, and verify
`SHA256SUMS` before touching the installation.

Stop the player, Library and Matter services. Preserve the fresh installation
as a rollback point, then restore the database, secrets, Matter data,
configuration and IR keymap with their archived ownership and modes. Restore
media separately at the same relative paths beneath `/srv/mabeltv/media`.
Start the services and verify SQLite integrity and foreign keys, service restart
counters, authentication, channels and settings, viewing state, Adult state,
LG/Matter control and playback. PWA caches rebuild automatically; device-local
Downloads must be downloaded again.

Perform an isolated restore rehearsal after initial setup and every three to
six months. Retain the original pre-SQLite migration archive separately while
JSON rollback remains a supported emergency operation.
