# MabelTV agent rules

These instructions apply to every AI coding session in this repository. Read
them before inspecting or changing product code. User instructions override
this file only when the user explicitly requests the conflicting action.

## Non-negotiable product priorities

1. The installed iOS PWA is the primary interface. Preserve its approved
   iPhone and iPad appearance and behaviour unless the user explicitly requests
   a design change.
2. Preserve real-TV geometry, colours, timing, animation, focus, z-order and
   remote behaviour during native structural work.
3. Keep changes proportionate. Do not combine a refactor, redesign and feature
   change in one checkpoint.
4. Never claim that a build, deploy, commit, push or live check happened unless
   it was performed and verified in the current task.

## Required reading and ownership

Before editing an area, read its architecture document:

- Portal/PWA: `docs/ios-pwa-baseline.md` and `docs/portal-architecture.md`
- Library backend: `docs/library-service-architecture.md`
- Native QML/C++: `docs/native-architecture.md`
- Validation/release: `docs/quality-gates.md`
- Contribution rules and limits: `CONTRIBUTING.md` and
  `config/architecture-guardrails.json`

Put behaviour in its documented owner. If no owner exists, create one focused
owner and document it. Do not place new behaviour in a convenient large file
merely because that file already has access to the needed state.

## Architecture rules

- Treat every line limit in `config/architecture-guardrails.json` as a ceiling,
  not a target. Extract a cohesive responsibility before reaching it.
- Do not raise a size budget, add an exception, weaken an assertion, skip a
  test, add `continue-on-error`, or update a screenshot merely to make checks
  pass. Any such change requires explicit user approval after explaining why
  the architecture cannot be corrected instead.
- Keep `mabeltv-library.py` a thin compatibility/composition shell. Backend
  mixins may use the composed `Library` object but must not import one another.
- Keep `Main.qml` an application coordinator. Visual/input responsibilities
  belong in focused components with explicit inputs.
- Keep `TvController.h` as the one stable QML-facing state machine. Split its
  implementation by responsibility; do not create competing controller state.
- Register every QML/C++ file in `CMakeLists.txt`. Keep every portal partial
  reachable from an entry document and every CSS/JavaScript module loaded by an
  intended entry point.
- Reuse shared tokens, icons, buttons, empty states and dialog behaviour when
  semantics match. Do not force genuinely different controls into one generic
  component solely because they look similar.
- Do not introduce portal inline styles, `!important`, copied one-off SVGs,
  duplicate global helpers or a new monolithic bundle.
- Preserve public IDs, `data-*` attributes, API routes, JSON shapes, cookies,
  settings/state formats and service entry points during refactors.

## Mandatory workflow

1. Inspect `git status` and preserve unrelated/user changes.
2. Establish the relevant current baseline before editing. For portal visual
   work, run or inspect the frozen browser references first.
3. Make the smallest coherent change in the documented owner.
4. Run `git diff --check` and the focused tests while working.
5. Before handover, run `scripts/windows/build.ps1`. Run the complete browser
   suite for any portal, PWA, API-shape or shared-component change.
6. QML, C++, launcher, hardware or packaging work must be built and tested on
   the Pi before the short atomic install. Portal-only work uses the targeted
   portal deployment and must not trigger a native rebuild.
7. Deployment requires explicit user authorization. Capture the current release
   and service restart counts first; verify the selected release, services,
   restart counts, watchdog, HTTP and thermal/throttle state afterward.
8. Do not commit or push unless the user asks. Before either action, show that
   the intended checks passed and stage only files belonging to the task.

## Stop conditions

Stop and report instead of improvising when:

- a supposedly non-visual change alters a frozen screenshot;
- a guardrail can be passed only by weakening it;
- the correct owner or desired public behaviour is genuinely ambiguous;
- the Pi build/test fails before installation;
- the live release, rollback target or service health cannot be proved; or
- user changes overlap the required edit and cannot be preserved safely.

Never conceal a failure with a fallback implementation or unrequested visual
change. Keep the last approved Pi release available until the user accepts the
new checkpoint.

## Definition of done

A change is complete only when its ownership is clear, applicable guardrails
and tests pass, frozen visuals remain unchanged unless approved, runtime work is
verified at the proportionate deployment boundary, and the final report states
exactly what changed, what was tested, what was deployed, and what remains
uncommitted or unpushed.
