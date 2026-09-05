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

## Required checks

Run the portable build/test gate for every source change:

```powershell
.\scripts\windows\build.ps1
```

Run the installed iPhone/iPad browser contract for portal, PWA, API-shape or
shared-component changes. QML, C++, launcher, hardware and packaging changes
also require the Raspberry Pi acceptance gate before deployment. Exact commands
and the customer-release boundary are documented in
[Quality gates](docs/quality-gates.md).

Do not update snapshots, weaken an assertion, increase a size budget or add a
test exception as part of an unrelated change. Explain any intentional change
to a public contract in the commit or pull request.
