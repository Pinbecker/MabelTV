# Commercial release readiness

A successful build is not permission to call a release customer-ready. Every published Raspberry Pi bundle must satisfy this gate and retain its evidence.

**Current 0.2.0 status:** productisation release candidate, not yet approved for paid or general-availability distribution. A passing Ubuntu CI job, a successful Windows development build, or one working existing Pi does not satisfy the clean-image ARM64 matrix, endurance, dependency-licence, or commercial/legal gates below.

Create a release evidence folder keyed by version and full Git commit. Record the tester, date, exact Raspberry Pi Imager image/checksum, Pi revision/RAM, storage/power/cooling/display hardware, bundle/source checksums, command outputs, failures, fixes, and final sign-offs. No unchecked item can be treated as implicitly passed.

## Product and legal

- Version, Git commit, qualified OS, build time, target, binary sizes, and SHA-256 values are present in `BUILD-MANIFEST.json`.
- Git tree is clean and the release comes from a signed/tagged commit.
- Archive checksum is published through the release channel; production releases have a detached signature.
- GPL corresponding source for the exact build is archived and offered with the binary.
- The source archive is regenerated from the recorded clean commit, both published checksums verify from a fresh download, and an independent rebuild on the recorded image is compared with any binary differences understood and documented.
- Dependency licences and third-party notices are reviewed for the exact OS package set.
- Product name, branding, warranty wording, returns, privacy statement, and media-rights wording have received appropriate commercial/legal review.
- A named release owner has signed the technical gate and a qualified adviser has signed the applicable consumer, privacy, open-source, trademark, tax, warranty, and returns obligations for every sales territory.
- No copyrighted programmes, owner media, personal paths, credentials, IP addresses, or personal channel names are in the artifact.

## Automated gates

- C++ compiles with warnings enabled on Windows and the qualified ARM64 release system.
- Core controller, Library service, concurrent conversion queue, and libmpv null-output tests pass.
- Every shell entry point passes `bash -n`; Python passes bytecode/AST compilation.
- `visudo` and `systemd-analyze verify` pass against staged assets.
- Fresh install, update of a running system, rollback, retained-data uninstall, and purge uninstall pass in disposable test images.
- The fresh-install test starts from the exact advertised Raspberry Pi Imager image with no Mabel TV files, users, packages, or configuration preloaded.
- Failure injection after staging, asset install, symlink switch, Library restart, and player restart restores the exact previous release/assets.
- Concurrent/retried upload tests prove offsets, `fsync`, one conversion worker, duplicate-final protection, and power-loss recovery.
- Disk-full tests cover upload, JSON state, media-index cache, logging, support bundle, conversion, and update.

## Real Pi 4 matrix

Test both supported RAM/storage/display arrangements that will be advertised:

- microSD and USB SSD;
- both micro-HDMI sockets;
- cold boot with TV on, TV off, and TV connected after boot;
- HDMI audio, mute/volume, and missing-audio fallback;
- USB keyboard-style remote and the documented GPIO IR option;
- fresh library, hundreds of cached files, hundreds of uncached files, corrupt files, and deliberately hung probes;
- Wi-Fi loss during upload and browser session expiry;
- official power supply plus a deliberate low-voltage warning test;
- ambient/behind-TV heat test that reaches conversion pause and recovery thresholds without crashing.

## Endurance

- Run randomized channel, programme, volume, pause, standby, library reload, and upload activity for at least 72 hours on every release candidate.
- Run the final candidate for seven days before the first paid/general-availability release.
- Confirm no unbounded file-descriptor, thread, memory, log, recovery, backup, release, inbox, or recycle-bin growth.
- Force a render stall and a permanent Loading state; confirm a controlled restart, correct exit reason, saved evidence, and recovery.
- Reboot/power-cut at each safe transaction boundary and confirm config/media integrity on return.

## Owner journey

A person unfamiliar with Linux must complete these without help beyond the supplied guide:

1. identify compatible hardware;
2. verify/extract the bundle and run `sudo ./install-mabeltv`;
3. find the TV welcome screen and open either URL;
4. pair, choose a PIN, and configure channels;
5. upload and watch one ordinary MP4 and one video requiring preparation;
6. understand the remote/adult shortcut;
7. respond to a heat/storage warning;
8. restart the player and download a support bundle;
9. recover a forgotten PIN using the boot-partition marker;
10. update, rollback, and remove software without losing media.

Any unexplained crash, restart loop, corrupted file, black-screen configuration, lost upload, or undocumented terminal step fails the release.

## Release decision

The 72-hour run is required for every release candidate and restarts from zero after any code, package, unit, boot, or build-image change that could affect runtime behaviour. The seven-day run is an additional first-paid/general-availability gate, not time that may overlap an earlier failed candidate. Publication requires retained evidence for the clean-image journeys, full real-Pi matrix, endurance runs, source/checksum reproduction, security review, dependency/SBOM review, and legal/commercial sign-off. Until then, describe the build only as a development or release-candidate preview.
