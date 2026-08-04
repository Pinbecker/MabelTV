# Troubleshooting

## Gather one support bundle

Run:

```bash
sudo mabeltv-diagnostics
```

The command prints a `.tar.gz` path containing OS/model, memory and disk status, display connectors, IR state, service status, the last 500 journal lines, temperature/throttling state, and any startup-recovery record. It does not include media files.

## Black screen or application restart loop

From SSH:

```bash
systemctl status mabeltv.service --no-pager
journalctl -u mabeltv.service -b --no-pager -n 200
cat /var/lib/mabeltv/recovery/last-failure.log
```

Common causes are a TV disconnected during boot, use of HDMI 1 instead of HDMI 0, a missing EGLFS plugin, or a connector name different from Qt's usual `HDMI1`. For the latter, add this service override and retry with the name shown in the Qt KMS log:

```bash
sudo systemctl edit mabeltv.service
```

```ini
[Service]
Environment=MABELTV_DRM_OUTPUT=HDMI1
Environment=QT_LOGGING_RULES=qt.qpa.eglfs.kms=true
```

Run `sudo systemctl daemon-reload && sudo systemctl restart mabeltv` after an override. Remove verbose logging once fixed.

## Picture but no HDMI sound

Verify HDMI 0 is being used, the TV is not muted, and Raspberry Pi audio is not disabled:

```bash
aplay -l
grep -E '^(dtoverlay=vc4-kms-v3d|dtparam=audio|noaudio)' /boot/firmware/config.txt
journalctl -u mabeltv.service -b | grep -i audio
```

The normal full-KMS line is `dtoverlay=vc4-kms-v3d` without `noaudio`. Test a known file using `ffplay` or `mpv` from an SSH session only after stopping Mabel TV.

## Stuttering or overheating

Mabel TV requests libmpv's safe hardware decoder and logs the active decoder. Check:

```bash
grep -R "Active hardware decoder" /var/log/mabeltv
vcgencmd measure_temp
vcgencmd get_throttled
```

Use H.264/AAC content at 720p, select low/off CRT effects, select 720p display output, use the official-quality power supply, and ensure the Pi has airflow. Software fallback is intentional when a codec cannot be decoded safely in hardware.

## A channel shows NO SIGNAL

Validate the complete library:

```bash
sudo -u mabeltv /opt/mabeltv/current/mabeltv_media_check \
  --channels /var/lib/mabeltv/channels.json \
  --media-root /srv/mabeltv/media \
  --cache /var/lib/mabeltv/media-index.json
```

Check that the folder spelling exactly matches `channels.json` and that user `mabeltv` can read every parent directory and episode. Channel 99 is intentionally empty in the supplied configuration.

## Remote absent or unreliable

Use `ir-keytable` to confirm `rc0`, then `sudo ir-keytable -s rc0 -t` to observe raw presses. Recheck the module labels rather than relying on its physical pin order. Keep signal wiring short, keep it away from noisy power wiring, and shield the receiver from direct sunlight. Re-run `sudo mabeltv-map-remote` after changing remotes.

## Recover after a bad update

```bash
sudo mabeltv-rollback
```

If the service still fails, stop it, restore channels/settings from the latest `/var/backups/mabeltv` archive, validate media, and start it again. Boot-file backups created by `configure-boot.sh` sit beside the originals with a `.mabeltv-TIMESTAMP.bak` suffix.
