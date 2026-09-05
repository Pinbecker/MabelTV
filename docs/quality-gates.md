# Quality gates

MabelTV uses several deliberately different checks. No single green command is
allowed to imply more confidence than it actually provides.

## Architecture ratchet

`config/architecture-guardrails.json` gives every owned source area a maximum
file size. The Python architecture suite also requires every QML/C++ source to
be registered, every portal partial and stylesheet/script to be reachable, and
Library mixins to preserve their dependency direction. New source files without
an applicable budget fail the gate.

The limits are deliberately above normal working size but below another
monolith. They are not style scores or permission to fill a file to its limit.
When a responsibility outgrows its owner, extract a cohesive component and
document it instead of increasing the budget. The matching change checklist is
in [Contributing to MabelTV](../CONTRIBUTING.md).

## Portable source gate

The normal CMake test suite covers the C++ controller, the complete Python
Library service, structural boundaries, every first-party JavaScript file,
offline PWA upgrades, the Matter control socket, and the native libmpv smoke
test. Node.js is required when tests are enabled so those checks cannot be
silently omitted.

On Windows, run:

```powershell
.\scripts\windows\build.ps1
```

GitHub repeats the appliance-capable build and complete portable suite on
Ubuntu. It also compiles every Python entry point, parses every Bash entry
point, and installs the exact locked Matter dependency tree.

## Installed iOS PWA contract

The portal is tested separately because its exact layout is a product contract,
not a native build concern. GitHub runs the pinned Chromium and WebKit versions
on Windows against the committed iPhone and iPad visual references. Failures
retain their screenshots and browser traces for diagnosis.

To run the same contract locally:

```powershell
Set-Location tests\browser
npm ci --ignore-scripts
npx playwright install chromium webkit
npm test
```

Screenshot changes are never updated as part of an unrelated change. Review an
intentional design change first, then update only the affected references.

## Raspberry Pi acceptance gate

QML, C++, launcher, hardware, or packaging changes still require a native Pi
build and test before the short atomic install. After installation, verify the
selected release, player and Library status, restart counters, watchdog,
temperature and throttling. Remote input, HDMI/CEC, audio and real playback are
confirmed on the physical television because a hosted runner cannot reproduce
that hardware.

Portal-only changes use the narrower portal checks and deployment path. They do
not justify rebuilding the native television application.

## Customer release qualification

Continuous integration proves source portability; it does not produce or
approve a customer release. `scripts/pi/make-release-bundle.sh` builds customer
artifacts only from a recorded clean commit unless an explicitly labelled
unpublished developer override is used. The bundle records its target, source
commit and binary hashes and includes matching corresponding source.

Publication additionally requires the clean-image, update, rollback, hardware,
endurance, licence and commercial evidence in
[Commercial release readiness](release-readiness.md). A working development Pi
or a green GitHub run is not a substitute for that gate.
