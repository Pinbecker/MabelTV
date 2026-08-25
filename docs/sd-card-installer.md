# KidsTV SD-card installer

The first delivery step uses the trusted Raspberry Pi Imager application with a KidsTV image already selected. It is a fresh-install route, not a replacement for product updates.

## What a new owner does

1. Install Raspberry Pi Imager from the Raspberry Pi website.
2. Open the supplied `KidsTV.rpi-imager-manifest` file, or follow the seller's **Open in Raspberry Pi Imager** link.
3. Select Raspberry Pi 4 and the KidsTV image that is already shown.
4. Choose the microSD card. In Imager customisation, enter the home's Wi-Fi, country, timezone, a username and strong password, and enable SSH for support.
5. Write the card, put it in the Pi, connect HDMI and the remote/receiver, then turn it on.
6. Wait through the automatic setup and one automatic reboot. The TV then shows KidsTV's QR code and setup code. During setup, enter the child’s name: the TV becomes, for example, MabelTV or JohnTV.

There is no SSH copy command, package installation, compilation, or Linux command in this new-owner journey. The owner still chooses their own Wi-Fi and login details; the distributed image contains no shared password or personal media.

For a GPIO infrared receiver, connect data to BCM 18, power to 3.3 V, and ground before first boot. The image enables the receiver automatically. A keyboard-style USB remote needs no IR mapping. An unfamiliar IR handset still needs the mapping flow in [Remote setup](remote-setup.md).

## How updates remain separate

The SD image embeds one normal, qualified KidsTV release bundle. On first boot it verifies that bundle and runs its `install-mabeltv` entry point. After that, the embedded bootstrap deletes itself and is never the updater.

Both an image owner and an existing KidsTV owner update from the same newer, OS-matched release bundle:

```bash
sudo ./install-mabeltv
```

That installer preserves `/var/lib/mabeltv/channels.json`, `/var/lib/mabeltv/settings.json`, `/var/lib/mabeltv/owner.json`, and `/srv/mabeltv/media`. It validates the new services and records the exact previous release for `sudo mabeltv-rollback`. Updating never requires reflashing the SD card.

For each release, the release owner therefore produces one qualified bundle first and derives both delivery outputs from it:

```text
qualified KidsTV release bundle
          |                    |
          |                    +--> existing Pi update download
          |
          +--> fresh-install Raspberry Pi image --> Imager manifest
```

This shared input is the bridge to a later custom desktop installer: the custom app can write the same image and use the same manifest metadata without changing the Pi-side install or update format.

## Build a preview image

From the repository on a Windows laptop with WSL2 and Docker Desktop, run one command:

```powershell
.\scripts\imaging\build-local-pi-image.ps1
```

It builds the ARM64 release bundle inside an emulated Debian Trixie Docker
container, runs the automated ARM tests, then gives that local bundle to
`pi-gen` to make the final image. The Pi is not contacted. It needs at least
40 GB free Linux storage and writes the final `.img.xz` to `out/pi-image/`.

For a Linux/WSL terminal instead, use:

```bash
bash scripts/imaging/build-local-pi-image.sh
```

The lower-level `build-pi-image.sh --bundle …` command remains available when
you already have a qualified bundle.

The recipe pins the official `pi-gen` commit, builds Raspberry Pi OS Lite 64-bit with Imager's `cloudinit-rpi` customisation support, preinstalls runtime packages, embeds the exact checked release bundle, and exports one `.img.xz`. It refuses an unpublished dirty bundle or a bundle built for a different OS.

Create a local, double-clickable Imager manifest:

```bash
python3 scripts/imaging/generate-imager-manifest.py \
  --image out/pi-image/KidsTV-0.2.2-trixie-arm64-mabeltv-pi4.img.xz \
  --version 0.2.2 \
  --output out/pi-image/KidsTV.rpi-imager-manifest
```

The generator hashes both the compressed download and the fully extracted image. For a hosted release, also supply HTTPS `--image-url` and `--icon-url` values. The public manifest, image, checksums, signatures, matching update bundle, and corresponding source must be kept together as one release set.

On Windows, with Raspberry Pi Imager installed, a maintainer can open a local manifest explicitly:

```powershell
.\scripts\imaging\open-mabeltv-imager.ps1 -Manifest .\out\pi-image\KidsTV.rpi-imager-manifest
```

## Qualification boundary

An image is only a preview until it passes [Commercial release readiness](release-readiness.md). At minimum, test Imager customisation, first boot without a network, first boot with Wi-Fi, the automatic reboot, TV setup, IR and USB input, a fresh upload, power interruption during provisioning, an in-place update from the same release family, rollback, and retained-data uninstall on real Pi 4 hardware.
