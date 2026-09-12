# Contributing to MabelTV

MabelTV is maintained as a small appliance rather than a collection of loose
experiments. Preserve the behaviour owners already depend on and put each
change in the component that owns it.

AI agents must also follow the repository-specific, non-negotiable workflow in
[`AGENTS.md`](AGENTS.md). It deliberately forbids weakening these checks merely
to complete a task.

## Architecture rules

- Keep the installed iOS PWA contract stable unless a visual change is
  explicitly intended and reviewed against its screenshots.
- Reuse the shared portal tokens, controls, icons and dialog lifecycle when the
  structure and behaviour are genuinely the same. Keep intentional variants
  separate when their interaction contracts differ.
- Put route-specific HTML, CSS and JavaScript in that route's existing module.
  Do not add inline styles, `!important`, copied SVG markup or a second global
  implementation of an existing component.
- Keep `mabeltv-library.py` as a compatibility/composition shell. Backend
  mixins communicate through the composed `Library` object and must not import
  one another.
- Keep `Main.qml` as the application coordinator and `TvController.h` as the
  stable native interface. Extract an owned view or implementation
  responsibility before either becomes a monolith again.
- Register every new QML/C++ file in `CMakeLists.txt`, every portal partial in
  the include graph, and every browser asset in the relevant entry/offline
  manifests.

`config/architecture-guardrails.json` records the maximum size of each owned
area. These are upper safety limits, not targets. If a file reaches its limit,
split a coherent responsibility and update the architecture document; do not
raise the limit merely to make the check pass. The frozen legacy Library test
suite must be split before another test is added to it.

## Proportionate checks

Run focused owner tests while developing. Before handing over application
behaviour, run the portable core gate:

```powershell
.\scripts\windows\build.ps1
```

Portal, PWA, API-shape or shared-component changes also run `npm run test:core`
from `tests/browser`. The complete three-project screenshot suite is reserved
for broad visual changes and release qualification. QML, C++, launcher,
hardware and packaging changes require the Raspberry Pi acceptance gate before
deployment. Exact focused commands, CI tiers and the customer-release boundary
are documented in [Quality gates](docs/quality-gates.md).

A passing command belongs to the tested tree. Do not rerun it solely because
the same unchanged work is about to be deployed, committed or pushed.

Do not update snapshots, weaken an assertion, increase a size budget or add a
test exception as part of an unrelated change. Explain any intentional change
to a public contract in the commit or pull request.
