# Acceptance checklist

Do not treat the Pi as a finished child appliance until every applicable item passes.

## Windows release

- [ ] `scripts/windows/build.ps1` passes all CTest tests.
- [ ] `scripts/windows/package.ps1` produces and clean-PATH tests the portable ZIP.
- [ ] Five configured channels tune correctly; channel 99 shows no signal.
- [ ] Corrupt media is skipped and a runtime decoder failure selects a replacement.
- [ ] Continuous broadcast advances while away; resume and restart modes work.
- [ ] Crop, fit, stretch and low/high/off CRT choices work.
- [ ] Volume begins low and cannot exceed 60 until a parent changes policy.
- [ ] Holding Back and pressing OK three times opens parent mode.

## Pi commissioning

- [ ] Pi reports `aarch64` and the expected Pi 4 model.
- [ ] EGLFS/KMS starts without a desktop or visible login prompt.
- [ ] The central screen stays 4:3 at 720p, 1080p and native output settings.
- [ ] HDMI picture and audio survive ten channel changes.
- [ ] `Active hardware decoder` is logged for at least the primary H.264 test media, or software fallback is measured as smooth and cool enough.
- [ ] Remote buttons perform only their mapped actions; none unexpectedly controls the LG TV.
- [ ] HDMI-CEC is disabled and booting the Pi does not wake/switch/control the TV.
- [ ] Short Power cleanly enters/wakes standby; long Power causes an orderly Pi shutdown.
- [ ] Parent access requires a Back hold followed by three deliberate OK presses.
- [ ] Removing one media folder leaves a stable no-signal channel rather than crashing.
- [ ] Killing the process once makes systemd restart it.
- [ ] Five rapid forced failures create a recovery log instead of an unbounded restart storm.
- [ ] A config backup is created and a previous release rollback succeeds.

## Soak and handover

- [ ] `sudo mabeltv-soak-test 8` completes with zero inactive samples.
- [ ] Temperature and `get_throttled` remain healthy through the soak.
- [ ] RSS remains below the service memory high-water mark and does not grow continually.
- [ ] Reboot with the TV on, TV off, and HDMI temporarily disconnected all recover sensibly.
- [ ] A real power interruption causes no config/state corruption on the next boot.
- [ ] Caregiver knows media paths, parent gesture, long-power shutdown, backup, rollback, and diagnostic commands.
