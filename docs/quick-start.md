# Quick start for owners

This is the shortest supported path from a new Raspberry Pi to the first programme. The prepared SD image contains its runtime packages. The manual bundle route needs an internet connection to download Raspberry Pi OS packages; normal television playback is local and can work without the internet afterwards.

## The no-command SD-card route

When a qualified KidsTV image is supplied, install the official Raspberry Pi Imager, open `KidsTV.rpi-imager-manifest`, choose Wi-Fi/login details and the microSD card, then write it and boot the Pi. KidsTV completes setup and reboots once; during setup, enter the child’s name to make the TV MabelTV, JohnTV, or another chosen name. Continue at [Complete the three setup steps](#4-complete-the-three-setup-steps). See [SD-card installer](sd-card-installer.md) for the six-step owner journey.

The numbered instructions below are the supported manual route for a release bundle. They also remain useful for support and existing-Pi updates.

## 1. Check the hardware and release

You need:

- Raspberry Pi 4 Model B with at least 2 GB RAM;
- good microSD card or USB SSD;
- official-quality USB-C power supply;
- HDMI cable and television;
- ventilated case, with a fan when the Pi sits behind a warm TV;
- USB keyboard or keyboard-style USB remote for first use;
- phone or computer on the same home network;
- videos you are entitled to use.

Do not tape an unventilated Pi flat against the back of a television. Heat from the display and video decoding can combine and force the Pi to slow down or restart.

The seller supplies a Pi 4 binary archive and its `.sha256` file, plus the exact corresponding-source archive and source checksum for anyone who wants them. Only the two binary-installation files need to be copied to the Pi. The binary filename names the Debian base, for example `bookworm` or `trixie`, and the archive contains `SUPPORTED-OS.txt`. The seller should also show that file beside the download. Use Raspberry Pi Imager to select **Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)** with exactly that Debian version/codename. Never mix a Bookworm bundle and Trixie image. The installer stops on an OS ID/version mismatch.

In Imager customisation, set a hostname, username, strong password, Wi-Fi, locale, and enable SSH. The examples below use username `mabel`, hostname `raspberrypi`, and a Trixie bundle; replace all three with the values and bundle name you actually chose.

## 2. Copy the two installation files

On Windows, open PowerShell:

```powershell
Set-Location "$HOME\Downloads"
scp .\KidsTV-0.2.2-pi4-trixie-arm64.tar.gz .\KidsTV-0.2.2-pi4-trixie-arm64.tar.gz.sha256 mabel@raspberrypi.local:/home/mabel/
ssh mabel@raspberrypi.local
```

On macOS or Linux, open Terminal:

```bash
cd "$HOME/Downloads"
scp KidsTV-0.2.2-pi4-trixie-arm64.tar.gz KidsTV-0.2.2-pi4-trixie-arm64.tar.gz.sha256 mabel@raspberrypi.local:/home/mabel/
ssh mabel@raspberrypi.local
```

Accept the new-host prompt if this is the first connection, then enter the Raspberry Pi password chosen in Imager. If `.local` is unavailable, use the Pi's numeric IP address in place of `raspberrypi.local`.

## 3. Verify and install on the Pi

The following commands run in the Pi SSH session. Use the exact filename you downloaded:

```bash
cd /home/mabel
sha256sum -c KidsTV-0.2.2-pi4-trixie-arm64.tar.gz.sha256
tar -xzf KidsTV-0.2.2-pi4-trixie-arm64.tar.gz
cd KidsTV-0.2.2-pi4-trixie-arm64
less SUPPORTED-OS.txt
sudo ./install-mabeltv
sudo reboot
```

The checksum must say `OK`. Stop if it says `FAILED`. The installer checks the Pi model, RAM, OS, storage, power/heat history, build manifest, binary checksums, Python, systemd units, self-test, and service readiness. It never overwrites an existing media library or owner configuration. Package download and installation can take several minutes.

## 4. Complete the three setup steps

The TV shows:

- a QR code;
- a `.local` browser address;
- a numeric IP-address fallback;
- a six-digit one-time setup code.

Scan the QR code or enter either address on a phone/computer connected to the same home network.

1. Enter the setup code.
2. Choose a 4–8 digit parent PIN for the browser dashboard.
3. Keep, rename, remove, or add starter channels.

KidsTV restarts the player once, returns the browser to sign-in, and asks you to enter the new PIN once to open the grown-up dashboard. At this point the TV carries the child’s chosen name, such as MabelTV.

## 5. Add the first programme

Open **Add media**, choose a channel, then add one or several videos to the visible selection list. You can reopen the picker to add more before selecting **Upload selected**, which also supports phones whose picker offers only one video at a time. A group is uploaded one file at a time so the Pi and home Wi-Fi are not overloaded; completed transfers move into the persistent preparation queue automatically.

- Wi-Fi interruptions resume from the last durable 8 MiB block.
- Ordinary prepared MP4 files publish unchanged.
- High-frame-rate and large iPhone MOV files enter a single background queue and become Pi-friendly 720p/30 fps MP4 files.
- Once upload reaches 100%, you can close the page while background preparation runs. Reopen **Add media** to see the persistent queue. Use **Retry**, **Cancel**, or **Dismiss** when offered; if the file is safely published but the television could not refresh, use **Retry TV refresh**.
- KidsTV pauses conversion if the Pi becomes hot and resumes after it cools.

Use names such as `S01E02 - The Picnic.mp4` for tidy series labels.

When creating or editing a channel, choose **Shows / episodes** or **Films / long videos**. This keeps films permanently exempt from the optional episode-reset timer.

## Everyday controls

- Page Up / Page Down: channel up/down
- `+` / `-`: volume
- Enter: pause/play
- `P`: put MabelTV and the television in standby, or wake them and select the Pi HDMI input; the Pi stays running
- `B`: hold for 3.5 seconds to open the parent menu; a short press does nothing
- Up / Down: previous/next programme
- Left / Right: seek only when Playback scrubbing is enabled
- `0`–`9`: channel number
- `M`: mute; hold three seconds to lock/unlock other buttons

For adult settings on the TV, hold `B` for 3.5 seconds, then press Enter three times. The browser PIN protects the dashboard; the physical adult shortcut is separate.

## If something does not look right

Open the dashboard and go to **Help & system**.

- Read any plain-language warning.
- Select **Restart TV player** for a frozen picture.
- Select **Download support bundle** immediately after a recurring problem.
- Run `sudo mabeltv-doctor` over SSH for the same first-line checks in a terminal.

Always use the dashboard's **Shut down Raspberry Pi** action or `sudo poweroff` over SSH before removing power. The remote Power button controls MabelTV and the physical television only; it deliberately leaves the Pi running. Pulling power can corrupt the SD card.

If the parent PIN is forgotten, do not reinstall. Shut down the Pi, connect its boot microSD/USB drive to another computer, create an empty file named exactly `mabeltv-reset-pin` on the visible boot partition, and boot again. The TV supplies a new one-time setup code while keeping videos, channels, and settings. Platform-specific steps are in [Forgotten parent PIN](raspberry-pi-setup.md#forgotten-parent-pin).
