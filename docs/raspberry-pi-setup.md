# Raspberry Pi installation

This runbook targets a Raspberry Pi 4 Model B with 1 GB RAM and Raspberry Pi OS Lite 64-bit. Complete the Windows acceptance checks first, then use a fresh microSD card for the appliance.

## 1. Prepare the Pi

1. In Raspberry Pi Imager, select **Raspberry Pi OS Lite (64-bit)**.
2. In the Imager customisation screen, set a hostname, username, password, Wi-Fi and locale; enable SSH while commissioning the unit.
3. Write and verify the card, insert it, connect the Pi's HDMI 0 port (the micro-HDMI socket nearest USB-C power), then boot.
4. Connect over SSH and bring the base system current:

   ```bash
   sudo apt update
   sudo apt full-upgrade -y
   sudo reboot
   ```

5. Copy this complete repository to the Pi, for example to `~/MabelTV`. Do not copy `out`, `dev-data`, or any Windows package.

## 2. Install Mabel TV

From the repository root on the Pi:

```bash
sudo bash scripts/pi/install.sh --configure-boot
```

The installer confirms that it is running on an aarch64 Raspberry Pi, installs Debian/Raspberry Pi OS packages, compiles the native ARM64 release, runs its tests, and atomically selects the new release. It does not enable the television service yet.

`--configure-boot` makes timestamped backups of `/boot/firmware/config.txt` and `cmdline.txt`, then:

- enables the KY-022 receiver on BCM GPIO 18;
- disables HDMI-CEC, including active-source messages;
- selects quiet 1280×720 output for the initial 1 GB Pi setup.

Review the reported backup paths. If the television is connected to the Pi's other HDMI socket, change `HDMI-A-1` to `HDMI-A-2` in `/boot/firmware/cmdline.txt`; Mabel TV is designed and tested around HDMI 0.

Reboot before attempting remote setup:

```bash
sudo reboot
```

## 3. Add media

The Pi media root is:

```text
/srv/mabeltv/media
```

The supplied channel configuration expects:

```text
/srv/mabeltv/media/
├── postman-pat/
├── fireman-sam/
├── thomas/
├── Waffle Dog/
├── films/
├── family/
└── empty-channel/
```

Copy your episodes and films into the corresponding folders. Leave `empty-channel` empty to retain the no-signal test on channel 99. Media never belongs inside the Git repository.

One convenient transfer method from Windows PowerShell is:

```powershell
scp -r 'C:\Users\danco\Videos\MabelTV\*' pi-user@mabeltv.local:/tmp/mabeltv-media/
```

Then, on the Pi:

```bash
sudo mkdir -p /srv/mabeltv/media
sudo cp -a /tmp/mabeltv-media/. /srv/mabeltv/media/
sudo chown -R mabeltv:mabeltv /srv/mabeltv/media
sudo -u mabeltv /opt/mabeltv/current/mabeltv_media_check \
  --channels /var/lib/mabeltv/channels.json \
  --media-root /srv/mabeltv/media \
  --cache /var/lib/mabeltv/media-index.json
```

An existing installation keeps its live `channels.json` during updates. Add the new Waffle Dog channel once with:

```bash
sudo mabeltv-add-channel --number 4 --name "Waffle Dog" --folder "Waffle Dog" --aspect crop
```

The command is safe to repeat and will not overwrite another channel using number 4 or the same folder.

Supported containers are MP4, M4V, MKV, MOV, WebM, AVI, MPG, and MPEG. H.264 video with AAC audio at SD or 720p is the safest starting format for the 2 GB Pi 4. The validator rejects unreadable files before the child-facing player sees them.

## 4. Wire and map the remote

Follow [remote-setup.md](remote-setup.md). The system can be tested with a USB keyboard before the remote is ready.

## 5. First appliance boot

Validate the service manually while SSH remains available:

```bash
sudo systemctl start mabeltv.service
systemctl status mabeltv.service --no-pager
journalctl -u mabeltv.service -f
```

On the TV, confirm picture, HDMI audio, channel changes, volume cap and standby. Stop it with `sudo systemctl stop mabeltv` if adjustments are needed.

When those checks pass:

```bash
sudo systemctl enable mabeltv.service
sudo reboot
```

Mabel TV then owns tty1 and launches directly through Qt EGLFS/KMS without a desktop or login prompt. Keep SSH enabled until the soak test and acceptance checklist are complete; it can be disabled afterwards with `sudo raspi-config` if desired.

## 6. Parent mode and daily operation

- Tap Power (`P` on a keyboard) for standby; tap it again to wake through the welcome intro.
- Hold Power for five seconds for an orderly Pi shutdown. Wait until activity has stopped before removing power.
- Hold Previous (`B`) for 3.5 seconds, then press OK three times, for parent controls.
- Display output changes take effect after selecting **Restart Mabel TV**.

The parent panel can select continuous/resume/restart playback, per-channel/crop/fit/stretch picture handling, CRT strength, 720p/1080p/native display output, volume-limit policy, TV sounds, library reload, restart, exit, or shutdown.

## 7. Back up and update

Before changing media configuration or deploying a new build:

```bash
sudo mabeltv-backup
```

To deploy a newer checkout, run its installer again. The build is tested in a temporary directory, installed as a new timestamped release, and only then switches `/opt/mabeltv/current`. It does not overwrite channels or settings.

To return to the previous installed release:

```bash
sudo mabeltv-rollback
```

Never interrupt an `apt` operation or the final release switch. Do not delete old releases until the new one has passed the soak test.

## Maintenance console

SSH is the normal maintenance path. If local keyboard maintenance is needed, stop the appliance from SSH first:

```bash
sudo systemctl stop mabeltv.service
sudo systemctl start getty@tty1.service
```

Log in on tty1, perform the maintenance, then restore appliance mode:

```bash
sudo systemctl stop getty@tty1.service
sudo systemctl start mabeltv.service
```

Do not leave the login prompt enabled on a child-facing finished unit.
