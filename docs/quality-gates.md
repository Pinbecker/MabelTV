# Quality gates

MabelTV uses risk-based validation. A check is run because it covers the code
or appliance boundary that changed, not merely because work is being handed
over, deployed, committed, pushed and deployed, and deployed in succession.

The maintainer normally reviews work on the installed iOS PWA from a phone.
For requested implementation work, a successful live-Pi deployment is therefore
the normal handover boundary unless the request says to investigate only, not
deploy, or stop. Use `pinbecker@mabeltv-512.local` and
`http://mabeltv-512.local:8080` exactly. A historical numeric IP is not a stable
target; if mDNS fails, resolve or discover the current address for that hostname
and pass it with `-PiHost`.

Record the command, result and tested Git tree. A successful result remains
valid while those inputs are unchanged. Commit and push do not require another
identical local run. During development, one relevant test is usually more
useful than rerunning a large suite after an understood failure.

## Tier 1: fast development checks

Run these while editing:

```powershell
git diff --check
python -m unittest tests.python.test_architecture_guardrails
node --test tests/js/test-source-syntax.mjs
```

Add the smallest owner test that exercises the behaviour being changed. Common
choices are:

| Changed responsibility | Focused checks |
| --- | --- |
| SQLite schema, adapters, migration or state writes | `python -m unittest tests.python.test_state_database tests.python.test_viewing_intents` plus the affected Library/native test |
| Authentication, owner setup or API security | `test_library_auth_settings`, `test_library_http` and the PIN browser contract |
| Downloads, service worker or offline security | `node --test tests/js/test-offline-service-worker.mjs` and `npm run test:offline` from `tests/browser` |
| Portal route or component | its browser spec on `--project=iphone-webkit`; add Chromium when worker, cache or browser compatibility is involved |
| Adult cards, cache revisions or warm rendering | `portal-explore.spec.mjs`, `portal-domain-navigation.spec.mjs` or the closest owned spec |
| Native controller or playback | `mabeltv_core_tests`, the relevant Python safety test and the native self-test |
| Documentation or workflow only | architecture/quality contract tests; no browser or native build unless executable behaviour changed |

SQLite and migration tests use temporary databases, and browser tests use
isolated media roots, caches and transfer directories. Library suites share `tests/python/library_test_support.py`, whose fixture owns
an isolated temporary SQLite database, media root, caches and transfer paths.
Test cases are split by backend owner so failures do not drag unrelated domains
through one monolithic module. Add persistence assertions to the owning domain
suite rather than rebuilding a broad integration test file.
The shared Playwright fixture calls `/__fixture/reset` before every case so PIN,
session and viewing mutations cannot contaminate another test. Do not solve a
failure by relying on test order, increasing arbitrary sleeps or retrying the
whole suite before reading the first causal failure.

## Tier 2: core regression gate

Run this before handing over an application behaviour change:

```powershell
.\scripts\windows\build.ps1
```

It compiles the native application and runs the portable controller, complete
Python Library/SQLite, JavaScript syntax, service-worker, Matter socket and
libmpv smoke groups. Python and JavaScript-only edits may use their complete
owner suites instead when a native build provides no additional signal; state
which commands were run.

For portal/PWA behaviour also run:

```powershell
Set-Location tests\browser
npm run test:core
```

The core browser gate runs the security, offline, warm-cache, navigation,
content-card, Adult viewing, artwork, playback and optimistic-action contracts
on iPhone WebKit and Chromium. Tests tagged `@visual` are excluded, avoiding
brittle screenshot failures during ordinary functional work.

## Tier 3: focused visual and device checks

An intentional UI change runs only its affected browser spec and visual cases,
for example:

```powershell
Set-Location tests\browser
npx playwright test portal-light.spec.mjs --project=iphone-webkit --grep @visual
```

Use `npm run test:update` only after the new appearance has been reviewed. It
updates visual tests across the configured matrix; inspect every changed PNG
before staging it. A screenshot mismatch caused by an intended design change is
a review task, not evidence that unrelated application logic failed.

Real installed-PWA acceptance is required for safe-area, edge navigation,
standalone launch, storage quota and iOS media behaviour that Playwright cannot
faithfully reproduce. Real-TV checks remain required for HDMI/CEC, audio,
remote input and playback timing.

## Tier 4: comprehensive qualification

Reserve maximum validation for broad portal architecture changes, dependency or
toolchain upgrades, release candidates, and explicit requests:

```powershell
.\scripts\windows\build.ps1
Set-Location tests\browser
npm run test:full
```

`test:full` runs every behaviour and screenshot on iPhone WebKit, iPhone
Chromium and iPad WebKit. It remains available locally and as the manual
**Source quality** GitHub Actions workflow option `comprehensive`. It is not an
ordinary pre-commit ritual.

## Continuous integration

Normal pull requests and pushes to `main` run:

- the appliance-capable Ubuntu build, complete portable CTest suite, Python and
  Bash syntax checks, and the locked Matter dependency tree;
- the core iPhone PWA browser gate on Windows.

Documentation-only changes skip these hosted jobs. A manual comprehensive run
replaces the core browser job with the complete iPhone/iPad visual matrix.
Failures retain Playwright screenshots/traces, and CTest emits its causal
`LastTest.log` as an annotation. Diagnose that first failure before changing
source or rerunning everything.

## Deployment gates

Deployment is a runtime safety boundary, not a second complete qualification
cycle. Use current successful evidence from the same tree, then let the deploy
tool run a small last-mile smoke check before it copies anything.

Choose the route from the files and responsibilities changed:

| Change | Normal live handoff | Validation before it |
| --- | --- | --- |
| Portal HTML/CSS/JavaScript, PWA shell or portal images only | `scripts/windows/deploy-portal-to-pi.ps1` | Architecture/syntax, the affected owner test and the script's smoke gate |
| Library backend/API with no schema, native or packaging change | Guarded atomic release; keep backend and portal modules from the same tree together | Complete Python owner suites plus affected browser/API checks |
| SQLite schema/migration, native QML/C++, launcher, Matter, systemd or packaging | Pi-native build and CTest followed by the guarded atomic installer | Relevant local core checks, Pi build/CTest and migration rehearsal when applicable |
| Broad cross-layer refactor or release qualification | Guarded atomic release | Comprehensive gate when its extra coverage is justified |

Most day-to-day portal changes belong in the first row. Do not run the full
browser screenshot matrix or rebuild the native player for those changes. Do
not force backend, database, native or packaging files through the portal-only
route to save time.

Portal-only changes use the default hostname automatically:

```powershell
.\scripts\windows\deploy-portal-to-pi.ps1
```

The script rejects mixed native/backend changes, deleted live assets,
unreviewed snapshots and shell changes without a worker revision. It runs
architecture plus `test:smoke`, backs up the exact live files, copies only the
selected portal assets, restarts only the Library service, verifies hashes,
HTTP, services, restart counters and Pi thermal state, and restores the backup
if the handoff fails.

`scripts/windows/deploy-dev-to-pi.ps1` is an older checkout-based developer
helper. It expects a usable Git source checkout on the Pi and updates files in
place, so it is not the normal phone-review deployment route. Use the guarded
portal script above or the atomic release route below.

Backend changes use the broader atomic release path because executable and
backend modules must stay together. SQLite schema upgrades require the
installer's validated online backup and rollback transaction. QML, C++,
launcher, hardware or packaging changes require a Pi-native build/test before
the short atomic install. Do not compile while swapping the live player.

For the atomic route, build in a fresh source directory while the installed
release continues running:

```bash
bash scripts/pi/preflight.sh
cmake -S . -B out/pi-production -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_TESTING=ON -DMABELTV_PI_APPLIANCE=ON
cmake --build out/pi-production --parallel 1
ctest --test-dir out/pi-production --output-on-failure
sudo bash scripts/pi/install.sh --prebuilt "$PWD/out/pi-production" \
  --skip-packages --enable-service
```

The installer owns the short service interruption, online SQLite backup,
schema transaction, atomic release link, health checks and rollback. After it
returns, verify `/opt/mabeltv/current`, the expected database schema and logical
counts, SQLite integrity and foreign keys, service state and restart counters,
native socket/watchdog health, portal HTTP and the affected live user journeys.
Do not substitute direct copies into `/opt/mabeltv/current` for this route.

## Architecture and release boundaries

`config/architecture-guardrails.json` limits are ceilings, not test targets.
Extract a cohesive owner rather than raising a budget. New source files must be
registered and reachable.

Continuous integration proves source portability; it does not qualify a
customer release. Clean-image installation, update/rollback, hardware,
endurance, licensing and commercial evidence remain in
[Commercial release readiness](release-readiness.md).
