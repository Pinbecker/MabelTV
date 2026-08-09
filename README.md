# Mabel TV

Mabel TV is a native, child-friendly recreation of watching television in the 1990s. It is being developed on Windows and will ultimately run as a dedicated appliance on a Raspberry Pi 4 with Raspberry Pi OS Lite 64-bit.

## What is implemented

- C++20 and Qt 6/QML application shell
- libmpv video rendered into the Qt Quick scene through its OpenGL Render API
- central 4:3 picture with smoothly masked rounded corners and four selectable TV borders
- JSON-configured channels backed by ordinary media folders
- shuffled episodes with no immediate repeats
- continuous-broadcast simulation while changing channel or using standby
- number entry, channel recall, volume/mute, a 60% default volume cap, and standby
- tuning static, channel/volume OSDs, and an intentional no-signal channel
- persistent channel, volume, and remote-lock state
- corrupt-episode exclusion and automatic recovery
- synthetic, non-copyrighted development channels and automated core tests
- thick selectable CRT cabinets, warm-up/standby transitions, and independent 0–100 curved-glass and analogue-distortion controls
- hidden hold-and-confirm parent panel with complete channel/programme switches plus playback, picture, border, CRT, distortion, display, volume and lifecycle choices
- portable Windows packaging with dependency discovery and clean-environment smoke tests
- Raspberry Pi OS Lite installer using Qt EGLFS/KMS, safe libmpv hardware decoding, systemd restart/recovery and a 1 GB memory budget
- KY-022 `gpio-ir` integration with an interactive EZClicker keymap utility
- safe long-hold shutdown, HDMI-CEC suppression, config backup, atomic updates, rollback, diagnostics and soak-test tooling
- a parent-protected local Mabel TV Library page for resumable computer/phone uploads, channel management and recoverable deletion

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
| Right | Next episode or film |
| Left | Previous episode or film |
| `+` / `=` | Volume up |
| `-` | Volume down |
| `M` | Mute; hold for 3 seconds to lock or unlock every other remote button |
| `B` | Return to the previous channel |
| `R` | Pick another episode on the current channel and resume its saved position |
| Enter | Pause/play; confirm in parent controls |
| `P` | Standby / wake through the welcome intro |
| Hold `P` for 5 seconds | Safe Raspberry Pi shutdown |
| F11 | Toggle full-screen |

Hold `B` for 3.5 seconds, then press Enter three times, to reveal parent access. Open
**Channels & Programmes** there to switch entire channels or individual episodes and films on or off.
Every programme keeps its own position when navigating with Left/Right. To deliberately restart the current item, hold `B` for parent confirmation, then press Left, Right, Enter.
`TV Border` cycles between the original Slim Black surround and three reference-inspired CRT cabinets: Silver 90s with a full control strip, Charcoal 90s with twin speaker grilles, and Vintage Black with vents and physical dials.
`CRT Glass` is a 0–100 slider for picture curvature, corner depth and reflective sheen.
`90s Distortion` is a separate 0–100 haze, grain, softness, scanline and colour-bleed slider. It remains steady below 95 and adds only a tiny wobble at the very top. Use Left/Right to adjust either slider in five-point steps.

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
  Waffle Dog\
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
- [Mabel TV Library](docs/media-library.md)

## Licence

Mabel TV is licensed under GPL-3.0-or-later. Its media library is user-supplied and is not part of this repository.
