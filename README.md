# KidsTV

KidsTV turns a Raspberry Pi 4 into a calm, child-friendly television made from a family’s own video library. During first setup, the grown-up names it for the child — for example, `MabelTV` or `JohnTV` — while KidsTV remains the generic product name.

The product has two deliberately simple surfaces:

- the television experience, controlled with a keyboard-style remote or optional GPIO infrared receiver;
- a private browser dashboard for first setup, uploads, channels, health checks, recovery, and support.

No account, cloud service, subscription, advertising, analytics, or internet playback is required. KidsTV does not include programmes; owners supply media they are entitled to use.

## Start here

For a new owner, the intended delivery is a KidsTV image opened in the trusted Raspberry Pi Imager:

1. Open the supplied KidsTV Imager manifest or seller link.
2. Choose Wi-Fi, login details, and the microSD card in Raspberry Pi Imager.
3. Write the card and boot the Pi. KidsTV installs itself and reboots once.
4. Use the QR code and one-time setup code shown on the TV.

There are no terminal commands in that fresh-install journey. The implementation and release-owner build flow are in [KidsTV SD-card installer](docs/sd-card-installer.md).

The manual release-bundle route remains supported, and it is also how an existing KidsTV is updated:

1. Use a Raspberry Pi 4 with at least 2 GB RAM, a good-quality power supply, active airflow, and Raspberry Pi OS Lite 64-bit matching the bundle's `SUPPORTED-OS.txt` exactly.
2. Copy the binary archive and its `.sha256` file to the Pi, verify the checksum, and extract it.
3. Read `SUPPORTED-OS.txt`, then from that folder run:

   ```bash
   sudo ./install-mabeltv
   ```

4. Reboot. The TV shows a QR code, local address, IP fallback, and one-time six-digit setup code.
5. Open that address on a phone or computer, choose a parent PIN and channels, then upload the first programme.

The manual customer journey, including exact Windows/macOS/Linux copy commands, is covered in [Quick start](docs/quick-start.md). Source-tree installation, updates, rollback, uninstall, supported hardware, and release qualification are in [Raspberry Pi installation](docs/raspberry-pi-setup.md).

## Product behaviour

- Generic first-run channels; no owner-specific names or universal PIN.
- A one-time physical setup code and PBKDF2-hashed 4–8 digit browser PIN.
- Login throttling, strict same-origin mutations, expiring sessions, and LAN-only administration.
- Resumable multi-file uploads with durable 8 MiB offsets, sequential network transfer, and conservative free-space reservation.
- One persistent background conversion worker. High-frame-rate videos and large iPhone MOV files are prepared at 720p/30 fps; ordinary prepared MP4 programmes are left untouched.
- Atomic publication, live background library validation, and player refresh without blocking the TV event loop.
- Recycle-bin recovery for 30 days, bounded logs/backups/releases/recovery evidence, and abandoned-upload cleanup.
- Main-loop, loading-state, and rendered-frame watchdogs with controlled, evidence-preserving restarts.
- Temperature and voltage warnings, conversion heat pause/resume, memory/task/file-descriptor limits, and systemd restart limits.
- A dashboard health summary, support-bundle download, safe player restart, Pi reboot, and Pi shutdown.
- HDMI-CEC power control: MabelTV standby puts the television in standby, while wake selects the Pi input. The Raspberry Pi remains running.
- Optional personal [local Alexa control with Matter](docs/alexa-matter.md) reuses that exact power path without a cloud skill.
- An optional 5-minute, 20-minute, 1-hour, or 3-hour inactivity reset for partly watched show episodes; film and long-video channels always retain their resume positions.
- Late activation, new-release readiness checks, an explicit previous-release pointer, matching asset rollback, and a non-destructive uninstaller.
- Physical parent-PIN recovery from the SD card’s boot partition without deleting videos or settings.

The CRT appearance remains the same at its existing settings. Rendering work is bypassed only when both CRT controls are explicitly off.

## Controls

A USB keyboard or keyboard-style USB remote works without mapping. The essential keys are:

| Key | Action |
| --- | --- |
| Page Up / Page Down | next / previous channel |
| `+` / `-` | volume up / down |
| `M` | mute; hold three seconds to lock/unlock other controls |
| `B` | previous channel; hold 3.5 seconds, then OK three times, for adult controls |
| Enter | pause/play, direct-channel confirm, or adult-menu confirm |
| `P` | MabelTV + television standby / wake; the Pi stays running |
| Left / Right | previous / next programme |
| `0`–`9` | direct channel entry |
| `R` | another programme on the current channel |

The optional GPIO IR path is in [Remote setup](docs/remote-setup.md).

## Developer build

The Windows development toolchain uses MSYS2 UCRT64 with GCC, CMake, Ninja, Qt 6, libmpv, and FFmpeg. Set `MABELTV_MSYS2_ROOT` only when MSYS2 is outside the supported defaults.

Build and run all automated tests:

```powershell
.\scripts\windows\build.ps1
```

For your own Pi only, deploy saved local changes quickly (not a releasable install):

```powershell
.\scripts\windows\deploy-dev-to-pi.ps1
```

It needs the laptop and Pi on the same home network. C++/QML changes use an
incremental Pi build; Library page/Python changes restart only the Library
service. Use the qualified release bundle and SD-image processes for anything
you intend to keep, share, or sell.

Generate synthetic, non-copyrighted development media and launch:

```powershell
.\scripts\windows\run-dev.ps1
```

Run against an explicit local library without embedding any personal path in product configuration:

```powershell
.\scripts\windows\run-dev.ps1 -MediaRoot 'D:\Media\MabelTV' -Fullscreen
```

Build, dependency-check, smoke-test, and package the Windows development build:

```powershell
.\scripts\windows\package.ps1
```

## Architecture and operations

- [Project principles](docs/project-principles.md)
- [Architecture and data layout](docs/architecture.md)
- [SD-card installer and update model](docs/sd-card-installer.md)
- [KidsTV Library](docs/media-library.md)
- [Troubleshooting and recovery](docs/troubleshooting.md)
- [Acceptance checklist](docs/acceptance-checklist.md)
- [Release readiness](docs/release-readiness.md)
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)
- [Privacy](docs/privacy.md)

## Licence and media

KidsTV is licensed under GPL-3.0-or-later. Selling or redistributing it requires providing the corresponding source and licence notices for the exact distributed build. See [Third-party notices](THIRD_PARTY_NOTICES.md).

The KidsTV software and its synthetic test assets are separate from the owner’s media library. Do not distribute films or programmes with a product unless you hold the necessary rights.
