# Appliance acceptance checklist

Use this shorter checklist after every installation. The full release gate is [Commercial release readiness](release-readiness.md).

- [ ] For an SD-image install, Imager accepts the manifest, customisation is applied, first-boot provisioning succeeds, and the one automatic reboot reaches Mabel TV.
- [ ] `sudo mabeltv-doctor` has no failures.
- [ ] TV welcome screen shows QR, `.local` URL, IP fallback, and the installer’s setup code.
- [ ] Wrong setup code is rejected at step one; correct code completes setup.
- [ ] New PIN works; repeated wrong PINs are throttled; Lock revokes the session.
- [ ] Generic channels appear and add/edit/renumber/delete-empty flows remain in sync.
- [ ] USB/IR control works for channel, programme, volume, mute, pause, and explicit MabelTV/TV standby and wake; Power never shuts down the Pi.
- [ ] With the TV in standby, remote and portal Turn On wake it and select the Pi HDMI input; Turn Off puts the TV in standby while SSH stays reachable.
- [ ] Missing/failed CEC leaves MabelTV's internal standby/wake usable and records a useful journal warning.
- [ ] Adult shortcut opens the on-TV panel and the CRT appearance matches the accepted reference/settings.
- [ ] Both crop and fit channels render correctly at 720p.
- [ ] HDMI audio uses the connector currently attached.
- [ ] Ordinary MP4 upload publishes unchanged and appears without blocking playback.
- [ ] High-frame-rate/MOV uploads queue one at a time, survive a Library restart, stop at the heat threshold, and finish at 30 fps.
- [ ] Interrupted upload resumes at the durable offset.
- [ ] Rename, hide/show, recycle, restore, and permanent delete behave as labelled.
- [ ] Each episode inactivity option resets an eligible partly watched show only after the configured current-uptime interval; film/long-video channels retain the exact resume position at every option.
- [ ] Browser health, restart, support download, reboot, and shutdown work with confirmations.
- [ ] Main-loop, Loading, and rendered-frame failure tests produce controlled service recovery and evidence.
- [ ] Update changes both player and Library PIDs/version without reflashing or changing media/owner configuration; rollback restores matching release assets.
- [ ] Retained-data uninstall leaves media/settings; boot settings are restored or a changed-cmdline warning is explicit.
- [ ] A 24-hour installation soak has stable memory, file descriptors, temperature, and restart count before handoff.
