# Privacy

Mabel TV is designed to work locally.

- No Mabel TV account is required.
- No telemetry, analytics, advertising identifier, tracking pixel, or cloud media upload is built in.
- Programme files, viewing state, channel configuration, and the parent verifier stay on the Raspberry Pi.
- The browser dashboard communicates directly with the Pi on the home network.
- Avahi advertises the device name and dashboard port only on the local network.
- The software contacts normal Raspberry Pi OS package/release infrastructure during installation and OS updates; those services have their own policies.

Support bundles are created only when a grown-up requests one. They contain technical diagnostics and may expose the device hostname, local IP details, OS/hardware information, recent process/service logs, and filenames mentioned by errors. They do not intentionally contain video contents or a plaintext PIN. Review a bundle before sending it to another person.

Uninstall without `--purge-data` retains media and owner settings. The separate `--purge-data` option permanently removes them and is deliberately explicit.
