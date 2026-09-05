# Native television architecture

The native television remains one Qt 6 application. This document describes
the internal boundaries used to keep that application maintainable without
changing its appearance or remote-control behaviour.

## QML composition

`Main.qml` is the application coordinator. It owns cross-cutting state such as
power transitions, the film countdown, portal requests, and the hand-off
between children's television and Adult Mode. Its visual and input-heavy
sections are composed from focused components:

| Component | Responsibility |
| --- | --- |
| `TelevisionScreen.qml` | Cabinet, screen, player, CRT treatment, picture geometry and television OSDs. |
| `RemoteInputHandler.qml` | Physical key routing, holds, repeat throttling and overlay precedence. |
| `ParentConfirmationView.qml` | Modern parent-access confirmation screen. |
| `ParentDashboardView.qml` | Modern parent settings and channel-management screen. |
| `AdultLibraryView.qml` | Adult collection navigation and film grid. |
| `AdultPlaybackControls.qml` | Adult playback scrubber, subtitles and control hints. |

The existing Classic and Modern parent designs intentionally remain separate.
Shared coordination belongs in their host overlay or controller; the distinct
visual compositions should not be flattened into a generic design.

Component inputs are explicit properties. The host remains responsible for
state transitions and passes only the objects needed by each child. Moving a
visual block must preserve its coordinates, sizes, colours, text, timing,
animation, z-order and focus position unless a separately approved design
change says otherwise.

## Controller implementation

`TvController.h` is the stable public interface supplied to QML. Its
implementation is divided by responsibility while keeping the same object,
signals, properties and callable methods:

| File | Responsibility |
| --- | --- |
| `TvController.cpp` | Lifecycle, library application, read-only models and guide data. |
| `TvControllerActions.cpp` | Remote actions, parent settings, volume/power commands and reload requests. |
| `TvControllerPortal.cpp` | Authenticated portal playback, Adult progress and library enable/disable operations. |
| `TvControllerPersistence.cpp` | Loading and atomically saving settings and runtime state. |
| `TvControllerPlayback.cpp` | Tuning, timeline selection, episode reuse, playback position and low-level state setters. |
| `TvControllerFormatting.h` | Small shared formatting helpers used by more than one implementation unit. |

This is an implementation split, not a collection of independent controllers.
That is deliberate: QML and the portal keep one authoritative state machine,
so a refactor cannot create competing channel, playback or standby state.

## Native invariants

- Children's playback and Adult playback keep their serialised decoder hand-off.
- Portal commands continue to bypass only the physical child-remote lock.
- Power and standby remain explicit operations and continue to use the shared
  connected-TV control layer.
- Existing settings, state and media-index formats remain compatible.
- New QML and controller implementation files must be listed in
  `CMakeLists.txt` and remain covered by the native safety tests.
- Large files must be decomposed by behaviour or view ownership, not merely
  renamed or split at arbitrary line counts.
