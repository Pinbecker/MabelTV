# Raspberry Pi installation and lifecycle

This document is for installers, support staff, and owners who want the detail behind the one-command release bundle. Most owners should use [Quick start](quick-start.md).

## Supported release target

| Component | Supported baseline |
| --- | --- |
| Board | Raspberry Pi 4 Model B |
| Memory | 2 GB or more |
| OS | Raspberry Pi OS Lite 64-bit; `ID` and `VERSION_ID` must match the bundle's `SUPPORTED-OS.txt` and build manifest |
| Display | either Pi 4 micro-HDMI connector; detected at launch |
| Audio | matching HDMI ALSA device, selected at launch |
| Storage | at least 4 GB free for installation, plus media capacity |
| Cooling | ventilated case; a fan is strongly recommended behind a TV |
| Input | USB keyboard/keyboard-style remote, or optional GPIO IR receiver |

Pi 3, Pi Zero, 32-bit OS images, and machines with less than 2 GB RAM are refused because pretending to support them produces an unstable product. Pi 5 requires a separately qualified build and is not accepted by this release’s preflight.

## Prepare Raspberry Pi OS

Read the `SUPPORTED-OS.txt` published beside the chosen release before flashing. In Raspberry Pi Imager select **Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)** whose Debian version/codename matches it exactly. Do not use a Bookworm bundle on Trixie, a Trixie bundle on Bookworm, or a Pi 4 bundle on another board. The product installer verifies OS ID/version and stops before activation on a mismatch.

In Imager customisation:

- set hostname, Wi-Fi, locale, username, and a strong password;
- enable SSH for installation and support;
- do not expose SSH or port 8080 to the internet.

Connect the display and a keyboard, boot, then update the base OS. Installation needs internet access for package downloads:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo reboot
```

## Install a customer release bundle

Release bundles are named for the qualified OS, for example:

```text
MabelTV-0.2.0-pi4-trixie-arm64.tar.gz
MabelTV-0.2.0-pi4-trixie-arm64.tar.gz.sha256
```

Copy both files to the Pi. [Quick start](quick-start.md#2-copy-the-two-installation-files) gives complete Windows, macOS, and Linux `scp` examples. Verify the checksum supplied through the release channel, extract the archive, read its supported target, then run its only customer entry point:

```bash
sha256sum -c MabelTV-0.2.0-pi4-trixie-arm64.tar.gz.sha256
tar -xzf MabelTV-0.2.0-pi4-trixie-arm64.tar.gz
cd MabelTV-0.2.0-pi4-trixie-arm64
less SUPPORTED-OS.txt
sudo ./install-mabeltv
```

Those are example Trixie names; substitute the one exact binary filename supplied for the chosen supported image. Do not use a wildcard when a corresponding-source archive is in the same directory.

The product installer:

1. checks Pi model, RAM, architecture, OS, storage, and recorded heat/power state;
2. verifies the build manifest and both binary SHA-256 values;
3. installs runtime dependencies and Avahi network discovery;
4. runs the native libmpv self-test;
5. stages a complete immutable release, including matching units/helpers/docs;
6. preserves channels, settings, owner record, media, and a pre-install backup;
7. validates Python, sudoers, and staged systemd units;
8. activates the release last, starts or restarts the Library and player, waits for stable process identities, and restores the previous release and matching global assets if readiness fails;
9. enables bounded logs, crash/boot evidence, retention, physical PIN recovery, and appliance mode.

Reboot after the installer finishes. First-run instructions appear on the TV and in [Quick start](quick-start.md).

## Source-tree installation for development

A maintainer can still build on a Pi from a clean source checkout:

```bash
sudo bash scripts/pi/install.sh --product-install
```

This installs the compiler/toolchain, builds with `MABELTV_PI_APPLIANCE=ON`, requires libsystemd, and runs every C++ and Python test before staging the release. It takes longer and can make the Pi warm, so it is not the customer distribution path.

Use `--enable-ir` only when a GPIO IR receiver is already wired to BCM 18:

```bash
sudo bash scripts/pi/install.sh --product-install --enable-ir
```

Then follow [Remote setup](remote-setup.md).

## Updates

An update uses the same command from a newer, OS-matched release bundle:

```bash
sudo ./install-mabeltv
```

The installer never replaces `/var/lib/mabeltv/channels.json`, `/var/lib/mabeltv/settings.json`, `/var/lib/mabeltv/owner.json`, or `/srv/mabeltv/media`. A running installation is restarted and checked. The exact previous release is recorded at `/opt/mabeltv/previous`.

Rollback both binaries and their matching system assets:

```bash
sudo mabeltv-rollback
```

A release that failed activation is marked and cannot accidentally become the default rollback target.

## Backups and retention

Create an on-demand configuration backup:

```bash
sudo mabeltv-backup
```

Automatic retention keeps:

- current and previous releases plus two additional recent releases;
- eight recent pre-install backups;
- twenty recent recovery snapshots, with a 30-day maximum;
- recycle-bin programmes for 30 days;
- incomplete uploads for seven days;
- generated support bundles for seven days.

Live programmes are never removed by retention.

## Health and support

Run the friendly read-only check:

```bash
sudo mabeltv-doctor
```

Create a support archive from the dashboard, or in a terminal:

```bash
sudo mabeltv-diagnostics
```

The bundle includes recent service/kernel evidence, model, OS, memory, storage, HDMI/IR state, temperature/throttle state, process limits, and media compatibility summary. It excludes the parent PIN and video contents. Filenames can appear in media/error reports, so an owner should review that before sending it to support.

## Forgotten parent PIN

This recovery requires physical access to the boot microSD card or USB drive. It preserves media, channels, settings, and a recovery copy of the previous owner record.

1. Hold the remote's `P` key for five seconds, or run `sudo poweroff` over SSH. Wait for shutdown, then remove the boot microSD card/USB drive.
2. Insert it into another computer and open the small FAT boot partition (usually labelled `bootfs`).
3. Create an empty file named exactly `mabeltv-reset-pin` (no `.txt` suffix).
4. Return the card and boot the Pi.
5. The TV shows a new one-time setup code. Complete setup and choose a new PIN.

On Windows PowerShell, replace `E:` with the boot partition's drive letter:

```powershell
New-Item -ItemType File -Path 'E:\mabeltv-reset-pin'
```

In Windows File Explorer, the equivalent is to show filename extensions, create a new text document, and rename the whole file to `mabeltv-reset-pin` with no `.txt`. On macOS, when the partition is mounted as `bootfs`:

```bash
touch /Volumes/bootfs/mabeltv-reset-pin
```

On Linux, use the boot partition's actual mount path, for example:

```bash
touch "/media/$USER/bootfs/mabeltv-reset-pin"
```

The marker is consumed once. The previous owner record is retained in `/var/lib/mabeltv/recovery/` for support recovery.

## Uninstall

Read the choices first:

```bash
sudo mabeltv-uninstall --help
```

Remove software while retaining videos, settings, and backups:

```bash
sudo mabeltv-uninstall --yes
```

Only the explicit destructive option removes owner data:

```bash
sudo mabeltv-uninstall --yes --purge-data
```

The uninstaller removes the marked Mabel TV `config.txt` block and only the exact command-line tokens recorded as Mabel TV additions. Unrelated tokens added later stay in place. If Mabel TV removed a pre-existing forced HDMI mode, that mode is restored only when the owner has not since chosen another one. Older hash-only installations retain a changed command line rather than risk discarding owner edits. Timestamped boot backups remain beside the originals.

## Build a release bundle

On the exact clean Pi/OS image used for qualification:

```bash
bash scripts/pi/make-release-bundle.sh
```

The production builder refuses dirty product source, verifies the recorded commit contains no known owner-specific maintenance helper, compiles an immutable export of that commit, runs all tests, records version/commit/build OS/binary checksums, and writes `SUPPORTED-OS.txt`. It produces the binary archive and an exact `git archive` source tarball from the same clean commit, each with its own checksum. `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`, privacy information, and a corresponding-source notice are included. Set `MABELTV_SIGNING_KEY` to add an ASCII-armoured detached GPG signature to both archives.

`MABELTV_ALLOW_DIRTY_RELEASE=true` exists only to exercise the builder during development. Its filenames and manifest say `UNPUBLISHED-DIRTY`, and it must never be supplied to a customer.

Do not publish a bundle until it passes [Release readiness](release-readiness.md) on real hardware.
