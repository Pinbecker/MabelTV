# MabelTV agent rules

These rules apply to every coding session in this repository. Read the
architecture document for the area being changed before editing it. User
instructions take precedence when they explicitly request a different action.

## Product and data safety

- The current development Pi SSH target is `pinbecker@mabeltv-512.local`
  (`192.168.0.27` is the last-known LAN fallback). Use the hostname first.

- The installed iOS PWA is the primary portal. Preserve its approved iPhone
  and iPad behaviour unless the user requests a change.
- `/var/lib/mabeltv/mabeltv.db` is the sole authority for structured mutable
  application state. Production code must not fall back to, dual-write, or
  silently recreate the retired JSON stores. Read `docs/state-database.md`.
- Treat schema changes as migrations. Back up with SQLite's online backup API,
  validate integrity and foreign keys, and keep rollback possible. Never copy
  a live database file by itself or edit live state directly.
- Device downloads live in the PWA's `mabeltv-offline-v1` IndexedDB database.
  Keep them separate from disposable response snapshots and Cache Storage.
  Adult downloads and artwork must remain locked until local PIN verification.
- Service-worker shell releases are immutable. Add required assets to the
  correct shell manifest and increment `SHELL_RELEASE` for every delivered
  shell change. Never clear download storage during a shell/cache upgrade.
- Preserve real-TV geometry, timing, focus, z-order, playback and remote
  behaviour during native work.

## Ownership and boundaries

Read the relevant document before editing:

- Portal/PWA: `docs/ios-pwa-baseline.md`, `docs/portal-architecture.md`, and
  `docs/pwa-offline-cache.md`
- Library backend: `docs/library-service-architecture.md`
- SQLite state: `docs/state-database.md`
- Native QML/C++: `docs/native-architecture.md`
- Tests and deployment: `docs/quality-gates.md`

Keep `mabeltv-library.py` a thin composition shell, `Main.qml` an application
coordinator, and `TvController.h` the single QML-facing state machine. Put new
behaviour in its documented owner. Backend mixins may communicate through the
composed `Library` object but must not import one another.

Treat `config/architecture-guardrails.json` limits as ceilings. Do not raise a
limit, add an exception, weaken an assertion, hide a failure, or update a
screenshot merely to pass a gate. Preserve public routes, JSON response shapes,
IDs, cookies, service entry points, and security boundaries unless the requested
change deliberately revises that contract.

## Proportionate workflow

1. Inspect `git status` and preserve unrelated work.
2. Establish the current behaviour and identify the owning component.
3. Make the smallest coherent change. Isolate tests from production paths and
   reset mutable fixtures between tests.
4. Run `git diff --check`, syntax/architecture checks, and the tests that cover
   the changed responsibility while working.
5. Before handover, run the **core** gate described in `docs/quality-gates.md`
   when application behaviour changed. Run the comprehensive browser/screenshot
   gate only for broad refactors, release qualification, or explicit maximum
   validation. Intentional visual changes require focused screenshot review.
6. Do not repeat an unchanged successful gate solely before deployment, commit,
   or push. Record the command and commit/tree it validated; rerun only when the
   tested inputs changed or evidence is stale.
7. Portal-only deployment uses `scripts/windows/deploy-portal-to-pi.ps1` after
   explicit deployment authorization. Native changes require Pi build/test and
   the short atomic install. Capture and verify release, service, restart,
   watchdog, HTTP, and thermal state at the applicable boundary.
8. Do not commit or push unless asked. Stage only task files and verify the
   remote head after pushing.

Stop and report if a guardrail can pass only by weakening it, unrelated user
changes overlap the edit, a Pi build fails before installation, or the live
release/rollback/health state cannot be proved. Never claim a check, deployment,
commit, push, or live result that was not verified in the current task.
