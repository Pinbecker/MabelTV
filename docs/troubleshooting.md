# Troubleshooting

## Start with the friendly check

From SSH, run:

```bash
sudo mabeltv-doctor
```

It is read-only and translates the common service, storage, setup, heat, power, and restart states into plain-language pass/warning/fail results. The browser dashboard shows the same first-line health information under **Help & system**.

## Gather one support bundle

Run:

```bash
sudo mabeltv-diagnostics
```

The command prints a `.tar.gz` path containing OS/model, memory and disk status, display connectors, IR state, process limits, health-monitor status, media compatibility summary, up to 1,000 recent player/Library journal lines, 500 kernel warnings, 1,000 lines from the previous boot, and ten recent recovery entries. It does not include video contents or the parent PIN. Hostname, local network details, and media filenames can appear in logs/reports, so review the archive before sharing it.

## Freeze, reboot, or crash evidence

Mabel TV keeps system logs on disk for up to eight weeks (within a 100 MB cap),
so they remain available after a reboot. The player notifies systemd from the
Qt event loop every 15 seconds. If it stops responding, systemd's native
90-second watchdog restarts it and `ExecStopPost` saves a snapshot under
`/var/lib/mabeltv/recovery/`. Separately, the player checks loading progress and
rendered frames every 15 seconds. Four stagnant checks (60 seconds) cause a
controlled restart with a saved reason. The stalled programme is quarantined
across that restart while its filename and modification time remain unchanged,
so a permanently bad file cannot create an endless restart loop. Replacing or
re-encoding that filename changes its modification time and makes it eligible
again.

A boot audit also records whether the preceding boot ended orderly. The
separate health timer records high temperatures and power/throttle-state
changes; it never restarts the television.

From SSH, inspect the most useful evidence with:

```bash
journalctl --list-boots --no-pager
journalctl -b -1 -p warning..alert --no-pager
journalctl -t mabeltv-health -t mabeltv-boot-audit --no-pager
sudo find /var/lib/mabeltv/recovery -maxdepth 2 -type f | sort
sudo mabeltv-diagnostics
```

For an abrupt power loss or a whole-Pi crash, there may be no final log line.
In that case, the boot audit marks the previous boot as lacking an orderly
shutdown and the previous boot's kernel journal is retained for inspection.

## Black screen or application restart loop

From SSH:

```bash
systemctl status mabeltv.service --no-pager
journalctl -u mabeltv.service -b --no-pager -n 200
cat /var/lib/mabeltv/recovery/last-failure.log
```

The launcher normally detects either Pi 4 micro-HDMI socket and creates a matching Qt KMS configuration at each start. Common causes are a TV disconnected during boot, a loose cable, a display mode the TV rejects, a missing EGLFS plugin, or an unusual connector name. Check the detected state first:

```bash
cat /sys/class/drm/card*-HDMI-A-*/status
cat /run/mabeltv/kms.json
```

For an unusual connector name, add this service override and retry with the name shown in the Qt KMS log:

```bash
sudo systemctl edit mabeltv.service
```

```ini
[Service]
Environment=MABELTV_DRM_OUTPUT=HDMI1
Environment=QT_LOGGING_RULES=qt.qpa.eglfs.kms=true
```

Run `sudo systemctl daemon-reload && sudo systemctl restart mabeltv` after an override. Try `HDMI2` when the second socket is the connected one. Remove verbose logging once fixed. Do not permanently force a connector until its name is confirmed from the log.

## Picture but no HDMI sound

The launcher selects the HDMI ALSA card matching the detected display socket. Verify the TV is not muted, inspect both HDMI devices, and confirm Raspberry Pi audio is not disabled:

```bash
aplay -l
grep -E '^(dtoverlay=vc4-kms-v3d|dtparam=audio|noaudio)' /boot/firmware/config.txt
journalctl -u mabeltv.service -b | grep -i audio
```

The normal full-KMS line is `dtoverlay=vc4-kms-v3d` without `noaudio`. The player journal records its selected device. Test a known file using `ffplay` or `mpv` from an SSH session only after stopping Mabel TV.

## Upload or preparation appears stuck

Open the dashboard's **Add media** page and read **Uploads and preparation**. Uploading, validating, queued, processing, publishing, finalising, complete, refresh error, and error are durable states. Once upload reaches 100%, the browser may be closed; the one background worker continues and recovers unfinished work after a Library-service/Pi restart.

If a transfer was interrupted, select the same channel and source file to resume from its saved offset. Use the job's **Retry**, **Cancel**, or **Dismiss** button when offered. A **Retry TV refresh** button means the video is already safe in the library and only the television's view needs refreshing. Check the worker, disk, and heat state with:

```bash
sudo mabeltv-doctor
systemctl status mabeltv-library.service --no-pager
journalctl -u mabeltv-library.service -b --no-pager -n 200
df -h / /srv/mabeltv/media
vcgencmd measure_temp
```

Preparation intentionally pauses at 78C and resumes at 72C. Do not restart it repeatedly while the Pi is hot; improve airflow and let it cool.

## Stuttering or overheating

Mabel TV requests the Pi's V4L2 M2M copy-back hardware decoder and automatically
falls back to software for unsupported files. It logs the active decoder. Check:

```bash
grep -R "Active hardware decoder" /var/log/mabeltv
vcgencmd measure_temp
vcgencmd get_throttled
```

Use H.264/AAC content at 720p and 30fps, use the official-quality power supply,
and ensure the Pi has airflow. HDMI output follows the connected display's
preferred mode automatically. Upload conversions
pause at 78C and resume at 72C. The CRT shader is skipped only when both CRT
controls are fully off; otherwise the complete visual treatment remains active.
Software fallback is intentional when a codec cannot be decoded safely in
hardware.

Produce a read-only compatibility report at any time with:

```bash
sudo mabeltv-media-report
```

It flags invalid files, formats likely to software-decode, resolutions above
720p, frame rates above 30fps, and pixel formats that may require conversion.

If playback works briefly and then freezes while the service stays active, check
the descriptor columns recorded by `sudo mabeltv-soak-test`. Debian 13's
libmpv OpenGL render API has an upstream fence leak (mpv issue 17217): embedded
rendering creates one `sync_file` per frame but never runs the swap-chain cleanup
that releases it. The Pi service selects the supported OpenGL ES 2 compatibility
path and masks Mesa's `GL_ARB_sync`/`GL_APPLE_sync` extensions until Debian ships
upstream fix `f74adc4`; this leaves hardware video decoding enabled while making
the affected fence call unavailable to libmpv. Run
`sudo mabeltv-fence-check` after an update to verify in one minute that the
descriptor count remains bounded.

## A channel shows NO SIGNAL

Validate the complete library:

```bash
sudo -u mabeltv /opt/mabeltv/current/mabeltv_media_check \
  --channels /var/lib/mabeltv/channels.json \
  --media-root /srv/mabeltv/media \
  --cache /var/lib/mabeltv/media-index.json
```

Check that the folder spelling exactly matches `channels.json`, that the channel contains at least one supported video, and that user `mabeltv` can read every parent directory and programme. The starter channels are generic and none is intentionally reserved as an empty channel.

If the previous programme stalled, its unchanged file may be deliberately quarantined. The journal and support bundle record the reason. Replace/re-encode the file (which changes its modification time), or remove it through the dashboard recycle-bin flow.

## Remote absent or unreliable

Use `ir-keytable` to find the rc device whose Name and Driver are `gpio_ir_recv`, then run `sudo ir-keytable -s rcN -t` with that number to observe raw presses. Do not assume it is always `rc0`: HDMI CEC receivers can be enumerated first. Recheck the module labels rather than relying on its physical pin order. Keep signal wiring short, keep it away from noisy power wiring, and shield the receiver from direct sunlight. Re-run `sudo mabeltv-map-remote` after changing remotes.

## Recover after a bad update

```bash
sudo mabeltv-rollback
```

If the service still fails, stop it, restore channels/settings from the latest `/var/backups/mabeltv` archive, validate media, and start it again. Boot-file backups created by `configure-boot.sh` sit beside the originals with a `.mabeltv-TIMESTAMP.bak` suffix.

## Forgotten parent PIN

Do not reinstall or delete `owner.json`. Use the one-time physical boot-drive marker described in [Raspberry Pi installation](raspberry-pi-setup.md#forgotten-parent-pin). It keeps videos, channels, and settings while rotating the setup code.
