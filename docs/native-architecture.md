# Native television architecture

The native television remains one Qt 6 application. This document describes
the internal boundaries used to keep that application maintainable without
changing its appearance or remote-control behaviour.

## QML composition

`Main.qml` is the application coordinator. It owns cross-cutting state such as
power transitions, the film countdown, portal requests, and the hand-off
between children's television and My TV Mode. Its visual and input-heavy
sections are composed from focused components:

| Component | Responsibility |
| --- | --- |
| `TelevisionScreen.qml` | Cabinet, screen, player, CRT treatment, picture geometry and television OSDs. |
| `DinosaurDenSurround.qml` | Optional dinosaur cabinet artwork using the existing charcoal screen geometry. |
| `OceanClubSurround.qml` and `Ocean*Art.qml` | Optional aquatic cabinet artwork, with its reusable vector animals split into focused components, using the existing charcoal screen geometry. |
| `FindingNemo.qml` and `FindingNemoBubbles.qml` | Supplied Finding Nemo cabinet and embedded character artwork, with bubble decoration in a focused component; preserves charcoal screen geometry. |
| `RemoteInputHandler.qml` | Physical key routing, holds, repeat throttling and overlay precedence. |
| `ParentConfirmationView.qml` | Modern parent-access confirmation screen. |
| `ParentDashboardView.qml` | Modern parent settings and channel-management screen. |
| `MyTvLibraryView.qml` | Transient browse/search state, bounded cancellable requests and exact playback selection. |
| `MyTvBrowseRow.qml` and `MyTvCard.qml` | Virtualised shelves and six-column Films/Series grid rows, without provider badges. |
| `MyTvArtwork.qml` and `MyTvArtworkQueue.qml` | Size-bounded image decode, a maximum of four artwork downloads, placeholder and one retry. |
| `MyTvRoundedClip.qml` and `my-tv-rounded.frag` | One-pass GPU clipping for rounded artwork and circular cast portraits; focus rings stay outside the image layer to avoid resizing or re-decoding artwork. |
| `MyTvText.qml`, `MyTvControl.qml`, `MyTvIcon.qml` and `MyTvHint.qml` | Shared My TV typography, action surfaces, vector icons and remote key hints. The Inter font and its OFL licence are bundled locally; focus transitions animate only colour, preserving layout and artwork decode size. |
| `MyTvDetailView.qml` | Opaque title details, provider actions, seasons, full episode navigation and cast. |
| `MyTvPlaybackControls.qml` | My TV playback scrubber, subtitles and control hints. |
| `MabelPresentation.qml` | Standard, widescreen and full-screen presentation; shares the polished playback controls while retaining the Mabel TV player, queue and Back navigation. |
| `MyTvEpisodePlayback.qml` and `MyTvNextEpisode.qml` | Ordered local episode progression, end-of-episode action and guarded single-player handoff. |

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
| `TvControllerPortal.cpp` | Authenticated portal playback, My TV progress and library enable/disable operations. |
| `TvControllerPersistence.cpp` | Loading and atomically saving settings and runtime state. |
| `StateDatabase.cpp` | Focused SQLite projections, field-level settings merges and atomic player snapshots; SQLite remains the single persistent authority. |
| `MabelQueueState.cpp` | Atomic TV queue reservations, confirmation, completion, playback history and interruption state. |
| `TvControllerQueue.cpp` | Validated queue playback, failure handling and ownership transfer through the existing controller. |
| `ipc/PortalControlServer.cpp` | Buffered newline-framed local control socket and command dispatch into the controller. |
| `TvControllerPlayback.cpp` | Tuning, timeline selection, episode reuse, playback position and low-level state setters. |
| `TvControllerFormatting.h` | Small shared formatting helpers used by more than one implementation unit. |

This is an implementation split, not a collection of independent controllers.
That is deliberate: QML and the portal keep one authoritative state machine,
so a refactor cannot create competing channel, playback or standby state.

## Native invariants

- Children's playback and My TV playback keep their serialised decoder hand-off.
- Portal commands continue to bypass only the physical child-remote lock.
- Power and standby remain explicit operations and continue to use the shared
  connected-TV control layer.
- Settings and player state use the shared SQLite database. The rebuildable
  media index remains a separate cache file.
- New QML and controller implementation files must be listed in
  `CMakeLists.txt` and remain covered by the native safety tests.
- Large files must be decomposed by behaviour or view ownership, not merely
  renamed or split at arbitrary line counts.


## Local control protocol

`PortalControlServer` is the sole owner of
`/run/mabeltv/portal-control.sock`. Each Library request uses one short-lived
connection and one newline-delimited command. The server keeps a per-connection
buffer so a command split across socket reads is preserved until complete;
coalesced bytes after the first command are not treated as another request.
Inputs over 64 KiB are rejected. The router validates command arguments before
invoking `TvController`; `main.cpp` only wires the server to the application
lifecycle.

The native process merges only the settings keys it owns. Player state is a
single-writer coherent aggregate and is replaced atomically. Both operations
advance their SQLite revision in the same transaction. The native binary must
reject any schema version outside the exact version supported by that release.

## My TV browsing and artwork

The native light/teal Watch screen has Continue watching and Up next shelves,
then separate Films and Series grids. Only visible and nearby rows instantiate
artwork. Detail browsing has independent focus zones for playback, services,
seasons, every episode and cast. Back preserves the browse selection and scroll.
Search, detail and season generations reject responses for an obsolete request;
Films, Series and shelf shortcuts retain each section's last focused card.
Back from deeper browse rows focuses these shortcuts without losing selection.
Title and season context remain fixed while episode details scroll, and local
resume actions name their exact season and episode. Streaming actions contain
one entry per supported destination; unsupported services are informational.
requests have deadlines and failures remain visible on the current screen.
A failed GET connection gets one delayed retry; playback/app-launch POSTs are
never retried automatically. The image queue preserves the server worker cap
and leaves capacity for metadata and portal controls.
Continue watching backdrops are enriched one title at a time after home loads,
through the existing TMDB cache. They never delay the home response or populate
provider badges on browse cards.

`qt6-svg-plugins` supplies the decoder for the bundled scalable action icons.
`qt6-image-formats-plugins` is a runtime installation dependency: TMDB may send
WebP bytes even for a URL ending in `.jpg`. Native image responses identify that
format correctly, and `mabeltv_native_ui_tests` checks decoder support plus real
QML grid and episode navigation without opening a player or touching live state.
The existing My TV decoder hand-off and controller-owned bookmarks remain intact.

Local series playback retains the selected series and exact episode identity.
The next action appears during the final 45 seconds, counts down while playing,
and pauses with the episode. EOF completes the episode through the Library's
existing SQLite viewing owner before advancing, including across seasons. A
manual early skip retains its bookmark; Back, close, failure or a new external
request cancels a pending handoff. The final episode returns to the library.
Menus distinguish resuming an episode, starting the next episode and a completed
series. The existing display-resolution setting selects 1080p at 30 Hz without
changing the media encoding policy or creating another player.

The My TV section shortcut also opens a separate family-channel directory,
ordered by channel number within episode and film sections. Selected channels
load their own programmes on demand; borrowed media uses the same full-screen
player and detail controls without the cabinet. Family-film bookmarks retain
their existing channel owner. Borrowed episodes have separate native bookmarks
and may advance within their channel without writing private-series watched
state. Open My TV always returns to the library, including from active playback.
