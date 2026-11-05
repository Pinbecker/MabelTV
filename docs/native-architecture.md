# Native television architecture

The native television remains one Qt 6 application. This document describes
the internal boundaries used to keep that application maintainable without
changing its appearance or remote-control behaviour.

My TV hides its library surface for the entire playback lifetime. Selection
resolves fresh resume state through the native Library endpoint. Pause, seek
completion and periodic checkpoints use targeted `my_tv_resume` writes; zero
positions retain timestamps so completed titles cannot revive an older bookmark.
The libmpv renderer services every update notification, renders only new frames
or a resized target, and coalesces queued GUI updates. Thirty-second diagnostic
samples report render rate, decoder/display drops and audio/video timing without
blocking the decoder; display geometry and refresh are logged at startup.
The Pi decoder uses three software threads, retaining the safe H.264 handoff
without the unstable MMAL hardware path. The renderer retains mpv's normal
intermediate precision.
Qt's completed frame swaps are reported to libmpv on the render thread, so
its timing follows actual presentation rather than an estimated swap time.
Qt's OpenGL state is reset before as well as after every libmpv render. The
render API requires standard defaults on entry; leaving Qt's state active can
corrupt picture pixels. The texture test uses a multi-frame two-colour video
and checks solid regions for corruption before validating the shader adapter.
Mesa CPU renderers (`llvmpipe`/`softpipe`) use mpv's simple scaling path: older
mpv versions leave scaler-table padding uninitialised, and the software sampler
can propagate those invalid values into black frames. Graphics-trace inspection
confirmed valid input textures becoming NaNs in the scaler. The fallback is
queued before loading media; hardware renderers, including the Pi, keep their
normal settings. Pixel assertions run unchanged on both paths.

My TV opts into `MpvSubtitles`, a child of its existing video surface. Ordinary
SRT cues are decoded/timed by mpv and rasterised into a small cached Qt image
only when the cue or display geometry changes. The owner's subtitle style is
plain white sans-serif text with a thin black outline, centred near the bottom.
BBC speaker colours and inline styling are discarded in both cached and native
text rendering; source files, cue timing and subtitle controls are retained.
Observed text/start
changes trigger asynchronous formatted-cue reads, including on mpv 0.35; no
GUI callback waits synchronously for the decoder. The cached image becomes
visible only after mpv confirms it has hidden its own subtitle composition.
ASS, bitmap tracks, unsupported positioning/style tags and oversized cues keep
the native renderer. A rejected SRT track stays native until the track changes.
`SubtitleText` owns the conservative, escaped inline-format conversion;
`MpvVideoSubtitles` keeps the existing QML controls independent of rendering.
Children's/CRT players use the same text style without enabling the cached path.
Tests cover real white cue pixels, removal of colour/style, pause/seek/toggle,
native fallback, source changes and reuse of
the same caption texture across advancing video frames. Pi frame-rate acceptance
must still be measured on hardware before calling this a verified speed fix.

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
| `ParentDashboardView.qml` and `ParentChannelSettings.qml` | Light/teal settings categories, focused setting controls and channel/programme visibility management. |
| `TvGuideOverlay.qml` and `MabelChannelArtwork.qml` | Floating child-friendly channel picker inside the actual picture bounds; optional cached artwork never blocks tuning. |
| `MyTvLibraryView.qml` | Transient browse/search state, bounded cancellable requests and exact playback selection. |
| `MyTvMabelBrowse.qml` | Prefetched family-channel directory, short-lived channel payloads, cancellable transitions and saved browse focus. Episode detail returns directly to the directory. |
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
series. The display-resolution setting starts 1080p menus at 60 Hz. During video,
`hardware/DisplayRefresh` selects an advertised progressive mode at the same
resolution whose refresh best matches the source cadence (50 Hz for 25/50 fps,
and 23.976/24 Hz for films when advertised by the display). It uses the application's existing DRM master
at a Qt render boundary, validates an atomic MODE_ID-only change before applying
it, and leaves the previous mode intact on failure. Stale playback requests are
discarded, an inactive player cannot override the current owner, and menus
return to their supported refresh after playback. Explicit DRM mode overrides
disable matching. Neither media timestamps nor the CRT composition change.

The My TV section shortcut also opens a separate family-channel directory,
ordered by channel number within episode and film sections. Selected channels
load their own programmes on demand; borrowed media uses the same full-screen
player and detail controls without the cabinet. Family-film bookmarks retain
their existing channel owner. Borrowed episodes have separate native bookmarks
and may advance within their channel without writing private-series watched
state. Open My TV always returns to the library, including from active playback.

## Native channel picker and settings

The channel picker uses the actual TelevisionScreen picture surface, outside its
CRT shader, with an inset floating panel in standard, widescreen and full-screen
presentation. It never replaces the cabinet or covers the whole display. The
virtualised grid has two columns for 4:3 and three for wide pictures; arrows select
channels, OK tunes the current programme and Back closes. Schedule refresh retains
the channel number. Artwork uses the existing read-only native directory, a short
cache and a bounded download queue; missing artwork cannot delay selection.

Modern parent settings have one horizontal category bar: Playback, Picture, Sound,
Channels and System. Down enters the selected category; Back returns to categories
and then closes. Setting values retain the controller's existing persistence and
parent-access gate. Channel visibility keeps separate channel/programme focus.
Display quality is available under System. The confirmation screen retains the
three-press access gate, My TV shortcut and restart sequence. Native menu tests use
a mock controller and never connect to live state, CEC or playback.

## Storytime and family memories

`FamilyMediaCoordinator.qml` owns the family media session and remote controls,
with `Storybook.qml` for the personalised opening cover. `StorytimeStage.qml`
owns the catalogue lift/open and reverse closing/docking transitions, and `StorytimeLibrary.qml` with
`StorytimeBookCard.qml` owns the two-row paged catalogue and interruptible book
previews. `StorytimeCatalogue.qml` loads the loopback-only SQLite projection
independently of session requests, retaining the current book during a refresh.
The backend catalogue is alphabetical without leading The/A, independent of
listening timestamps. The selected identity survives refreshed arrays. Eight
bundled cover materials cycle by catalogue slot; reading uses that same slot's
material. The lift, opening and return can be skipped or interrupted safely.
`MemoryStage.qml`
coordinates two bounded scene slots; `MemoryScene.qml` fits whole photos into
the shared solo, duet, triptych, feature and gallery compositions. Entrances
are staggered, motion pauses with playback, and the outgoing scene keeps its
last position during the transition. Main only routes
commands, startup and the child-player exclusion. `finishTune` emits
`familyMemoryRequested` for a memory channel instead of the ordinary episode
loop; Storytime is started only through the portal and has no channel number.

The family player keeps a tiny nonzero Qt render surface while playing audio
or preparing video: libmpv must initialise its render context before loading
either media type. Its visible video card still follows the memory composition.

Only one family libmpv audio output is active. Background music continues across
photo transitions, fades out before home-video audio, and resumes at its saved
position after video. Opening or closing waits for the prior decoder/audio
output to release. Storytime Back saves listening progress, stops narration,
closes the book and docks it into its catalogue position. Repeated Back only
closes the selected preview; the labelled MabelTV action explicitly returns to
ordinary television. Memories retain their existing MabelTV return behaviour.
Preview paper sounds share the family decoder, respect mute/volume and stop
on navigation or playback handoff. No family return enters the My TV workflow.
Storytime playback controls stay visible while paused or finished and for eight
seconds after Play or a seek. The timeline shows elapsed, total and remaining
time for the combined book audio, with its stored duration as a startup fallback.
Opening, closing and catalogue browsing keep those controls hidden.
While playback controls are visible, remote arrows select their highlighted
button and OK activates it. With controls hidden, left/right seek the story;
dedicated play/pause and skip commands retain their direct playback actions.
Power commands retain existing CEC policy; a startup in standby does not launch
family playback or wake HDMI. The storybook font is Cinzel Decorative, bundled
with its SIL Open Font License.

The book rests on the raster stone-floor material. The page paper uses the
parchment material on both faces. The right illustration is uncovered beneath
the turning leaf; its left half is printed on the leaf's back and transfers to
the stationary left page only at the fully flat landing. All three views use
one spread geometry so the illustration cannot jump onto the inside cover.
Cover and leaf transforms keep perspective in screen space with no 3D depth;
Qt Quick's 2D OpenGL renderer otherwise clips the turning surfaces. The native
family test verifies the moving cover, illustration and flat landing under
both software rendering and OpenGL on a virtual display, without opening HDMI.
Materials and generation prompts are recorded in `docs/storybook-materials.md`.

Family playback owns both press and release of its remote keys. Child guide
and parent hold timers are cancelled when it opens. `MyTvResumeCoordinator.qml`
owns the delayed decoder return and cannot resume the old programme while a
family session is active. Explicit channel/film/queue requests close family
playback before transferring ownership; a stale child-channel refresh does
not close a portal-started memory session.
An explicitly chosen child programme is held until the family decoder has
released its output, then passed through the ordinary countdown/playback path.
Unrequested background resumes during an active presentation are discarded.

`MyTvPortalPlayback.qml` resolves exact local series playback and serialises the decoder handoff without embedding My TV in a surround. Storytime EOF returns through the same book-closing/shelf transition as Back and never resumes the previous child film.

Audio-only stories use `FamilyAudioOnly.qml`: two rendered black frames precede CEC wake/Active Source, then playback waits for HDMI readiness. This mask covers the complete Pi UI throughout listening and EOF. Back intentionally opens Storytime; explicit normal playback or power-off cancels a pending quiet wake. The controller exposes the connected TV power state without a second QML state machine.

## CRT rendering cost

`TelevisionScreen.qml` retains the original tube geometry and foreground child
order. `CrtCabinet.qml` caches the original cabinet/bezel vectors at display
resolution and refreshes when their settings or geometry change. Four cabinet
styles are compared against uncached drawing. `CrtReflection.qml` retains the two original glass reflections in
the independent foreground texture; `CrtGrain.qml` supplies a
bounded 256-pixel lookup.

`MpvVideoTexture.cpp` owns the opt-in texture-only adapter. Qt's framebuffer
renderer/provider stays alive while its unwarped presentation quad is empty.
The CRT shader reads that existing video texture directly and composites the
complete original foreground (including OSD, pause, countdown and reflections)
BEFORE the common curvature and mask. CrtForegroundSource holds unchanged
foreground pixels, enables live updates during overlay animations, and
invalidates for geometry/settings/status changes. Its final fade is captured
before freezing so it cannot retain a stale label. There is no unmasked picture underneath,
no separate OSD above the curved effect, and no intermediate full-tube copy of
every video frame. Fullscreen/effects-off uses ordinary video presentation.

The video framebuffer uses a smaller source's native detail before scaling
into the original tube. Dimensions come from mpv. The 64 by 36 shader mesh
computes curvature and shading; low distortion during playback uses the faster
shader, while high distortion and paused tape retain their detailed path.

`MpvTextureTests` verifies real libmpv pixels, orientation, absence of the
unwarped quad, ShaderEffect consumption and restoration of normal presentation.
`CrtEffectTests` compares the original combined picture with the separate video
and translucent foreground composition, including live glass/distortion/size
changes and OSD text. The original reference shader is frozen from HEAD. Real
full-window captures and sustained playback telemetry remain separate release
checks; a shader benchmark alone does not establish actual playback speed.

Completed-frame diagnostics are opt-in via MABELTV_FRAME_CAPTURE=1. The native
window responds to a local request file in its private /run/mabeltv/frame-capture
folder, reads at most three final OpenGL render passes into private PNGs, and expires after ten
minutes. There is no HTTP endpoint and the feature has no timer or file writes
when disabled. Runtime overrides used for acceptance are removed afterwards.
