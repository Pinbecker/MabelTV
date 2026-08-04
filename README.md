# Mabel TV

Mabel TV is a native, child-friendly recreation of watching television in the 1990s. It is being developed on Windows and will ultimately run as a dedicated appliance on a Raspberry Pi 4 with Raspberry Pi OS Lite 64-bit.

## What is implemented

- C++20 and Qt 6/QML application shell
- libmpv video rendered into the Qt Quick scene through its OpenGL Render API
- central 4:3 picture with a subtle glass/scanline treatment
- JSON-configured channels backed by ordinary media folders
- shuffled episodes with no immediate repeats
- continuous-broadcast simulation while changing channel or using standby
- number entry, channel recall, volume/mute, a 60% default volume cap, and standby
- tuning static, channel/volume OSDs, and an intentional no-signal channel
- persistent channel and volume state
- corrupt-episode exclusion and automatic recovery
- synthetic, non-copyrighted development channels and automated core tests
- rounded/curved CRT shader, warm-up/standby transitions, scanlines, vignette, subtle RGB separation, and procedural tuning/click sounds
- hidden hold-and-confirm parent panel for playback, picture, CRT, display, volume and lifecycle choices
- portable Windows packaging with dependency discovery and clean-environment smoke tests
- Raspberry Pi OS Lite installer using Qt EGLFS/KMS, safe libmpv hardware decoding, systemd restart/recovery and a 1 GB memory budget
- KY-022 `gpio-ir` integration with an interactive EZClicker keymap utility
- safe long-hold shutdown, HDMI-CEC suppression, config backup, atomic updates, rollback, diagnostics and soak-test tooling

The software is complete for Windows validation. Pi-only behaviour is scripted and must be commissioned against the actual Raspberry Pi, display, audio path, KY-022 and media library using the acceptance checklist.

## Windows development

The supported Windows toolchain is MSYS2 UCRT64 with GCC, CMake, Ninja, Qt 6, libmpv, and FFmpeg. Set `MABELTV_MSYS2_ROOT` if MSYS2 is not located at either of these defaults:

- `%USERPROFILE%\Tools\msys64-mabeltv`
- `C:\msys64`

Build and test:

```powershell
.\scripts\windows\build.ps1
```

Build, dependency-check, smoke-test, and zip a portable Windows release:

```powershell
.\scripts\windows\package.ps1
```

The resulting package is written to `out/package/MabelTV-windows-x64.zip`.

Build, generate a small synthetic multi-channel library when necessary, and launch:

```powershell
.\scripts\windows\run-dev.ps1
```

Launch with a particular local video:

```powershell
.\scripts\windows\run-dev.ps1 -MediaFile 'C:\path\to\episode.mp4'
```

Add `-Fullscreen` to start full-screen. Generated test media and build output live under ignored `dev-data` and `out` directories.

Keyboard controls:

| Key | Action |
| --- | --- |
| Number keys, then Enter | Go directly to a channel (or wait briefly after typing) |
| Up / Page Up | Next channel |
| Down / Page Down | Previous channel |
| Right / `+` | Volume up |
| Left / `-` | Volume down |
| `M` | Mute |
| `B` | Return to the previous channel |
| `R` | Pick another episode on the current channel |
| `P` | Standby / wake |
| Hold `P` for 5 seconds | Safe Raspberry Pi shutdown |
| F11 | Toggle full-screen |

Hold `B` for 3.5 seconds, then press Enter three times, to reveal parent access.

## Adding your media

The default real-media root on Windows is:

```text
C:\Users\danco\Videos\MabelTV
```

Create one folder per channel directly beneath it. The example configuration expects this layout:

```text
MabelTV\
  postman-pat\
  fireman-sam\
  thomas\
  films\
  family\
  empty-channel\
```

Put episode files directly in their channel folder. Supported extensions are MP4, M4V, MKV, MOV, WebM, AVI, MPG, and MPEG. Mabel TV reads channel numbers, names, folders, and per-channel crop/fit/stretch behaviour from `config/examples/channels.json`; media files themselves remain outside Git.

An optional `Intro\MabelTV.mp4` (or another supported extension with the same base name) plays once when Mabel TV starts, before it tunes the first channel.

The development runner explicitly uses `dev-data/media` so it will not touch the real library. To launch against the real library, run `mabeltv.exe` without `--media-root`, or supply an explicit folder using `--media-root`.

Validate a media library without launching the television UI:

```powershell
.\scripts\windows\validate-media.ps1 -MediaRoot 'C:\Users\danco\Videos\MabelTV'
```

Diagnostic logs rotate automatically under the application data directory. Development runs place them in `dev-data/logs`.

## Raspberry Pi appliance

Start with [the Raspberry Pi installation runbook](docs/raspberry-pi-setup.md), then follow the [KY-022 and remote guide](docs/remote-setup.md). Pi media belongs under:

```text
/srv/mabeltv/media/<channel-folder>/
```

Useful operational documents:

- [Architecture and data layout](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Acceptance checklist](docs/acceptance-checklist.md)

## Licence

Mabel TV is licensed under GPL-3.0-or-later. Its media library is user-supplied and is not part of this repository.
