# Portal architecture

The Remote transport row offers Scrub for both Mabel TV and My TV playback.
Dragging upward away from the slider arms cancellation; releasing there sends
no command, and returning to the slider resumes the gesture. Pointer loss,
Escape and the close control also discard an unfinished scrub. Pointer release
owns the commit so a later native range change event cannot duplicate the seek.
`core/remote-scrub.js` owns the fixed 70-pixel timeline, combined elapsed/total
readout and finish time, without a repeated start time or current clock. Dragging previews locally; release sends one generation-bound
seek with no automatic retry. A programme change closes the timeline. The native
capability flag keeps the control disabled until the matching player is active.
`core/remote-preview.js` preloads the playing programme while Remote is visible,
before Scrub opens. Two background requests fill a 12-MB in-memory cache, retained
when the timeline closes and cleared when playback identity changes. Moving the
thumb keeps background work running; an independent foreground slot requests
the pointed-to strip immediately, replacing only an obsolete foreground request.
At most three requests are outstanding. Cached pictures paint synchronously. Each
request has a real 18-second abort deadline and a bounded retry. Background
prefetch uses the paced warmup queue, not the foreground decoder priority.
Preview failures never block seeking or create a global banner. Pictures sample
ten-second points; release still seeks to the selected second.
The subtitle control shows On/Off explicitly and None when no track is available.
System and help links to the existing Pi bin sheet, with sizes and a confirmed
snapshot-based empty action; deleting bin contents never refreshes playback.

The Mabel TV remote's **Open My TV** shortcut opens the native library directly.
Its picture control cycles Standard, Widescreen and Full screen, labels the
next mode, and exposes the current mode in its accessible description. Full
screen stays in Mabel TV and shares the native playback controls, including
subtitles, without transferring playback ownership or navigating into My TV.

The installed iOS PWA is MabelTV's primary portal. Its frozen visual and
behavioural contract is documented in [ios-pwa-baseline.md](ios-pwa-baseline.md).
This map describes where portal work belongs without changing that contract.

## Runtime assembly

`scripts/pi/mabeltv_backend/portal.py` assembles the portal and recursively
expands `portal-include` comments before the HTTP layer returns HTML. The
installed `mabeltv-library` executable remains the stable entry point.
`scripts/pi/mabeltv-library.html` is the single Experience entry document. It
deliberately contains only document metadata, ordered CSS and JavaScript
assets, and top-level includes. `portal/html/experience-styles.html` owns the
ordered Experience stylesheet links so that entry document stays within its
strict size ceiling. Page markup lives under
`scripts/pi/portal/html`:

- `auth.html` owns setup and PIN-gate markup.
- `app-shell.html` owns the Experience header, navigation, and view includes.
- `views/` contains one Experience file per top-level route.
- `overlays.html` is an ordered dispatcher for the focused overlay partials in
  `overlays/`. The IDs in those partials are public JavaScript contracts.

Include order is functional. Shared nodes and dialogs must exist before the
ordered scripts initialise.

`playback/progress.js` owns durable My TV progress and retry acknowledgements;
`playback/ios-presentation.js` owns the native fullscreen handoff for streamed
and downloaded video. `playback/stream-recovery.js` renews an expired media
source at the current position with bounded retries. `players.js` coordinates
these owners and retains the separate Mabel TV device-player presentation.

Opening a specific local film copy keeps that file selected when cached or
fresh title metadata arrives. The title-wide metadata cache does not decide
which version the TV and device playback buttons use; an explicit library
selection takes precedence over another copy with the same TMDB identity.

Phone playback begins the local resume lookup alongside the stream request;
an explicit start position does not need that lookup. Bounded startup phase
timings distinguish session creation, resume lookup, metadata and first playback.
They contain no filenames or stream tokens, and are sent only after playback
starts or a wait/error so diagnostics do not compete with initial video loading.

Mabel TV Up Next retains the playing entry at position one with an artwork
overlay. Programme sheets carry its queue identity to the chosen player;
ordinary library playback remains separate. `playback/mabel-queue.js` owns the
queue display and browser completion handoff. Only the confirmed current owner
may advance it. Browser-incompatible files remain available on TV; external
players do not expose reliable completion events and cannot consume a queue.

## CSS ownership and cascade

Stylesheets are intentionally loaded in the following layers. Preserve this
order unless a change explicitly redefines the cascade.

### Shared portal base

- `tokens.css`: cross-design colour, spacing, and typography tokens.
- `base.css`: reset, document defaults, accessibility, and common form rules.
- `components.css`: genuinely shared controls and small component families.
- `shell.css`: common application shell and navigation structure.
- `home.css`, `live.css`, `usb.css`, `settings.css`, and `channel-page.css`:
  route-specific base styles.
- `watch.css`: family and My TV player foundations.
- `watch-overlays.css`: shared playback dialog structures.
- `watch-library.css`: shared Watch catalogue structures.
- `management.css`: library-management surfaces.
- `player-shell.css`: full-screen player layout and controls.
- `responsive.css`: shared viewport adaptations after all shared page styles.

### Experience design

- `experience-foundation.css`: Experience tokens and element-level defaults.
- `experience-components.css`: reusable Experience controls, including the
  canonical `.portal-search` contract, viewing-state artwork marks and shared
  MabelTV/LG remote chassis.
- `experience-shell.css`: fixed header, page frame, and bottom navigation.
- `experience-home.css`, `experience-remote.css`, `experience-watch.css`,
  `experience-library.css`, and `experience-viewing.css`: route ownership.
- `experience-downloads.css`: the shared device download library, progress
  cards, filters and download-options/removal sheets. It follows theme layers
  and uses their tokens for light, dark and true-black presentation.
- `experience-explore.css`: the continuous My TV suggestion catalogue,
  its compact quick actions and catalogue-only title route.
- `experience-personal-rating.css`: the thin reusable ten-star control and the
  watched-but-unrated queue entered from My Viewing.
- `experience-filmography.css`: the actor/director identity strip, compact
  filmography controls and year-by-year four-card timeline.
- `experience-appearance.css`: the device-local colour page, its live preview,
  appearance slider, accent presets and semantic-colour reference.
- `experience-settings.css`: settings, device, and activity surfaces.
- `experience-insights.css`: viewing-insight dashboards and detail surfaces.
- `experience-my-tv-insights.css`: the My TV taste profile, rating charts,
  release-era breakdowns and people/title insight grids.
- `experience-responsive.css`: Experience phone/tablet adaptations.
- `experience-overlays.css`: common Experience dialog and management shells.
- `experience-card-navigation.css`: stacked full-height card presentation and
  the animated Back-button transition. Native iOS edge Back is owned by browser
  history rather than a competing page-level touch target.
- `experience-playback-overlays.css`: playback-specific dialog presentation.
- `lg-tv-remote.css`: the separate LG TV remote surface.
- `experience-light.css`: the complete light-theme token and component
  adaptation layer, intentionally last.

Experience is the only portal presentation. Theme and accent are device-local
preferences owned by `experience-theme.js`; Light, Dark and True black map to
shared neutral tokens, while accent hue and strength feed derived colour roles
so route modules do not own fixed accent colours. Favourite, success, warning
and danger remain semantic tokens rather than user-selected accent colours.

## JavaScript ownership and execution order

`portal.py` owns the explicit `PORTAL_APP_SOURCES` order and serves their
concatenated application as `/portal-app.js`. The sources execute inside one
strict IIFE: they can share the established ordered application scope without
publishing dozens of mutable globals on `window`. Theme, offline-storage and
response-cache owners load separately because they have independent lifecycle
contracts. Changing the source order is a functional change and must be tested.
Internal route, viewing, live-TV and LG-remote functions call one another in the
private scope; do not restore `window.*` compatibility bridges. The only global
names owned by first-party portal code are the separately loaded
`MabelOfflineSchema`, `MabelOffline`, `MabelAppCache`, `MabelAssets`,
`MabelExperienceTheme` and `MabelPortalUI` APIs.

The Playwright fixture is the sole exception to the wrapper, for test
instrumentation only. It injects `load_portal_app_script(private_scope=False)`
into its loopback-only `LibraryServer`, which leaves the same ordered source in
the page's lexical scope for established white-box browser tests. Production
servers always use the default private bundle. Do not add production globals or
ship the fixture form to preserve a test shortcut.

1. `mabeltv-offline-schema.js` owns the shared Downloads IndexedDB schema;
   `mabeltv-offline.js` owns registration and durable media operations.
   `core/app-cache.js` owns disposable authorised response snapshots in a
   separate database. `core/assets.js` owns deferred third-party loading.
2. `portal/js/ui-components.js`: shared DOM components and dialog lifecycle.
   It also decorates uncovered search fields with the existing Home clear-cross
   control, retaining existing domain-specific clear handlers. Enter submits
   Studio searches; their clear controls remain available while loading.
3. `portal/js/core/foundation.js`: shared state, API, escaping, auth, and base
   helpers. `core/confirmation.js` follows it and owns asynchronous playback
   confirmation with large touch controls; cancellation sends no command.
   Upload source identities use the shared UUID helper: HTTPS can use
   `crypto.randomUUID`, while LAN HTTP uses `crypto.getRandomValues` with the
   same UUID format. A missing secure-context API must not prevent portal boot.
4. `portal/js/core/scroll.js`: viewport snapshots, shared render preservation,
   horizontal rail restoration and screen positions. It precedes
   `portal/js/core/navigation.js`, which owns routes, views and history.
5. `portal/js/core/live.js`: live-picture and live-channel behaviour.
6. `portal/js/core/load.js`: initial portal boot and data loading.
7. `portal/js/channel-page.js`: reusable channel detail renderer.
8. `portal/js/library/my-tv-library.js`: My TV film catalogue management.
   `library/my-tv-collections.js` owns the series collection controls and inline
   creation using the existing local collection names.
9. `portal/js/library/usb-browser.js`: USB browsing, selection, and import.
10. `portal/js/library/viewing-insights.js`: MabelTV viewing dashboard,
    lifetime catalogue, independently ranged item detail and one-day diary.
    This module owns its route, range and disposable resource-cache state;
    `my-tv-library.js` must not regain those globals.
11. `portal/js/library/my-tv-insights.js`: the My TV and MabelTV insight
    dashboards, progressive TMDB enrichment state, rating shortcuts and local
    facet drill-downs. My TV routes under `#insights/my-tv/...` reuse the
    four-wide My TV title cards; people open the existing person-card journey.
12. `portal/js/library/device-status.js`: device, storage, job status and Settings
    preferences. The Settings hub links to `#settings/mabel`, `#settings/my-tv`,
    `#settings/media`, `#settings/security`, `#settings/help` and the existing
    device-local `#appearance` page. `core/navigation.js` retains these routes
    under the Settings primary section; `core/live.js` wires their navigation
    and parent returns. `html/views/system.html` includes the dedicated settings
    view fragments. TV form edits remain local until Apply and survive background
    library refreshes; Discard restores saved values. The independent guide,
    simultaneous-playback, availability and provider-icon switches save immediately.
13. `portal/js/library/channels.js`: channel-management rendering.
14. `portal/js/playback/players.js`: local player primitives and state.
    Mabel TV's device player cycles Standard (4:3 surround), Widescreen
    (16:9 surround) and Full screen (borderless) through its own controls.
    This is a device-local layout change: it retains the video, playback
    position and queue ownership, stays selected across programmes, and sends
    no native TV command. Full screen keeps the inline controls rather than
    transferring into Apple's native fullscreen player.
    My TV's iPhone/iPad player keeps native fullscreen controls, with the next
    local episode in its inline shell. Completion saves progress before an
    eight-second cancellable handoff; Back, replay and a failed save cancel it.
    A stream that finishes starting after Back cannot reopen the player.
15. `portal/js/playback/film-library.js`: film cards and film sheets.
    My TV Continue watching prioritises unfinished episode bookmarks, then
    offers the episode after the furthest completed one in series order.
    Mabel TV's playback queue is independent of this series progression.
16. `portal/js/playback/my-tv-series.js`: My TV series catalogue and tools.
    `portal/js/playback/film-catalogue.js` follows it and owns the My TV Watch
    film catalogue, collection and metadata-genre filters, and combined search.
    Filters apply to films; series and Continue watching keep their own scope.
17. `portal/js/playback/programmes.js`: programme sheets and actions.
18. `portal/js/playback/downloads.js`: device-download rendering and actions.
19. `portal/js/playback/view.js`: Watch view composition and dialog wiring.
20. `portal/js/my-tv-viewing/catalogue.js`: My TV viewing catalogue and provider
    identity/link helpers.
21. `portal/js/my-tv-viewing/provider-badges.js`: the shared provider-summary
    cache, lookup batching and badge renderer used by every My TV title-card
    surface.
22. `portal/js/my-tv-viewing/artwork.js`: canonical My TV artwork URLs, bounded
    image recovery, and propagation of newly loaded title metadata to prepared
    cards.
23. `portal/js/my-tv-viewing/seasons.js`: series and season navigation. Add is
    always available; metadata refresh and removal require real local episodes,
    while Restart is also available for manually tracked streaming progress.
24. `portal/js/my-tv-viewing/details.js`: My TV viewing details and startup.
25. `portal/js/my-tv-viewing/up-next-order.js`: native-feeling long-press queue
    reordering, optimistic movement and atomic order persistence.
26. `portal/js/my-tv-viewing/person.js`: cast detail cards and filmography
    navigation.
27. `portal/js/my-tv-viewing/explore.js`: continuous TMDB discovery, quick
    viewing actions, weak impression feedback and visit freshness.
28. `portal/js/my-tv-viewing/grid.js`: the retained, keyed My Viewing card
    renderer, filters and saved-state refresh. Each tab keeps its prepared pane,
    while long collections render in bounded batches as the user approaches the
    end. Switching tabs therefore avoids rebuilding hundreds of hidden cards.
29. `portal/js/my-tv-viewing/home.js`: the My TV Watch landing composition:
    local progress, Up Next, and a twelve-card What to watch mix of familiar
    watched/watchlisted choices and popular unseen titles. A separate
    horizontal Released this week rail contains films, new shows and returning
    season premieres in popularity order. Watch-page artwork cards reuse the
    provider-brand catalogue to show the two highest-priority included streaming
    services, with MabelTV first for locally available titles. Broad,
    unwatched discovery remains a separate Something Different shelf.
30. `portal/js/my-tv-viewing/filmography.js`: TMDB-only full filmography search,
    timeline and A-Z modes.
31. `portal/js/my-tv-viewing/rating.js`: personal ten-star ratings and the
    watched-but-unrated completion queue.
32. `portal/js/actions.js`: application event bindings and remote commands.
33. `portal/js/lg-tv-remote.js`: the separate LG webOS remote.

The shared My TV provider renderer in `provider-badges.js` applies the same icons to
homepage, My Viewing, Ratings, Explore, search, filmography, person and film
collection title artwork. Its device cache merges TMDB provider summaries with
Watchmode records already present in SQLite; card rendering never spends a
Watchmode request. `my_tv_provider_badges_enabled` is the SQLite-backed display
preference and does not disable title-sheet availability lookups.


Studio presentation helpers live in `studio/controls.js`; source browsing,
destination/queue, cloud metadata, deletion and optimisation retain their
separate owners. Studio sheets scroll within a stable frame and anchored action
footer. `experience-studio.css` owns this layout without changing shared title-card
typography. Playback confirmation has its own theme-aware stylesheet.

## Startup, caching, and offline ownership

`service-worker.js` owns immutable shell generations. App navigations and shell assets are cache-first inside the current generation;
`/watch/player` remains network-only because it requires a live per-session
stream token. Installation must finish
the complete critical shell before activation. A new worker waits for a safe
client boundary, and activation retains the immediately previous shell as the
rollback generation. Cache cleanup is scoped to older `mabeltv-shell-v*`
entries and must never delete downloaded media, response snapshots, artwork,
or caches belonging to another application.

MabelTV Insights caches overview ranges, the lifetime catalogue, item/range
pairs and diary dates as distinct `mabel-insights-v2-*` snapshots. A cached
resource paints before network refresh and before the optional Chart.js bundle;
charts attach after that bundle loads without blanking or rebuilding the page.
Changing the dashboard range must not alter catalogue, item or diary scope.
Back navigation retains the correct parent route, search and scroll position.

Large optional libraries are not part of initial execution. `core/assets.js`
loads Chart.js when an Insights route first needs it. Provider artwork is also
outside the critical shell.
Dynamic catalogue artwork uses native lazy loading and asynchronous decoding.
TMDB posters, backdrops and people images use the authenticated same-origin
artwork route rather than a cross-origin opaque response. The Pi keeps a
bounded rebuildable copy, and the worker keeps up to 1,000 recently displayed
family and protected My TV images in its runtime artwork caches. A cache-write
failure never replaces a successful network response. Protected artwork is returned from the worker cache only to a client whose
local My TV access has been unlocked. The worker prunes closed client IDs on
activation, messages and periodically during fetches, so an unlock cannot live
past its browser client.
Failed My TV artwork elements hide the browser's broken-image marker and retry
after short bounded delays. A successful poster load in a title card wakes any
failed tile using the same TMDB asset, even when the card requested a different
image size. Retry query strings map to the canonical cache URL so retries do not
consume duplicate cache entries. Fresh title metadata is merged into matching
prepared Explore, home and My Viewing cards without rebuilding their screens.

`core/app-cache.js` owns `mabeltv-app-cache-v1`. It contains only disposable
API snapshots and can be rebuilt from SQLite. It never contains downloaded
video chunks or the local PIN verifier. Startup always performs `/api/setup`
and then the authenticated `/api/bootstrap` before reading a snapshot. The
bootstrap exposes SQLite-backed domain revisions, letting the portal render an
unchanged snapshot immediately and refresh only changed domains in the
background. Legacy `mabeltv-data-*` localStorage snapshots are deleted during
initialisation and are not a compatibility persistence path.

My TV viewing state is loaded once, reused when My Viewing opens, and updated
optimistically after an action. A late refresh that began before a newer action
cannot replace that action, and an action never triggers a second full-catalogue
fetch or DOM rebuild. Per-title detail snapshots provide an immediate card on a
repeat visit; current viewing state always overrides the cached detail copy.
Per-person snapshots do the same for biographies and complete filmographies.

When the network or Pi is unavailable, the full bottom navigation remains
operable. Non-download routes show the shared reconnect surface instead of
stale protected content. MabelTV and My TV Downloads continue through the
existing `mabeltv-offline-v1` store; My TV playback retains its local PIN check.
Offline mutations are not queued.

The store names, request strategies, update lifecycle and My TV security
boundary are specified in
[PWA offline and device-cache architecture](pwa-offline-cache.md).

## Shared UI contracts

`window.MabelPortalUI` is the shared component boundary. Its dialog lifecycle
uses the scroll owner at runtime, after the ordered core scripts initialise:

Collections reuse the `.library-actions` row list, `.library-action-icon`,
`.count-badge`, sprite icons and the shared dialog lifecycle. Collection
management selection is separate from the Watch film filters.

- `icon(name, className)` creates sprite-backed SVG icons.
- `button(options)` creates safe `type="button"` controls and supports a sprite
  icon, label, class, accessible name, disabled state, and click handler.
- `emptyState(options)` creates the canonical empty-state structure without
  interpolating untrusted text into HTML.
- `artworkStatus(kind, title)` creates the shared watched or part-watched mark
  reused by every film and series artwork catalogue.
- `powerStatus(kind, overrides)` owns the canonical power labels, explanatory
  wording and state classes for On, Standby, transitions and unavailable state.
- `setPowerStatus(indicator, label, status)` applies that contract to an
  existing status dot and label without replacing their public IDs.
- `dialogs.open`, `dialogs.close`, `dialogs.dismiss`, and `dialogs.wire` own the
  common modal lifecycle, optional document scroll lock, backdrop/cancel
  behaviour, and focus restoration. `wire` accepts one close button or a list.
- Content dialogs marked with `data-card-sheet` receive the shared compact Back
  control whenever `open` has a `returnTo` callback. `dialogs.suspend` preserves
  a parent card while a child opens; `{ card: true }` creates a browser-history
  entry before hiding that parent so native iOS edge Back traverses the same
  hierarchy. `dialogs.returnTo` carries a deeper chain, and
  `dialogs.dismissJourney` makes the close control exit the complete chain.
  These content cards share one full-height canvas. Playback choices, More
  menus and settings dialogs are deliberately not card sheets: they remain
  content-sized and close directly. Every portal sheet uses the same compact
  close-control size and corner inset.

Use a shared component only when behaviour and structure are truly the same.
Cards, rows, and menus with different information or interaction contracts stay
as explicit variants; visual resemblance alone is not a reason to merge them.

## Change rules

- Preserve existing IDs, `data-*` attributes, accessible names, and script order
  unless the same change updates every consumer and its regression coverage.
- Put a repeated token or control rule in the shared owner. Keep page geometry
  and intentional variants in their route stylesheet.
- Do not use inline styles or `!important` to bypass the cascade.
- Add icons to `portal/icons.svg` and render them through the shared icon helper
  instead of embedding one-off SVG markup in JavaScript.
- Add every critical offline-shell asset to `SHELL_URLS` in
  `service-worker.js` and increment `SHELL_RELEASE` when the delivered shell
  changes. Optional on-demand assets belong in `LAZY_SHELL_URLS`.
- Treat screenshot updates as visual changes requiring explicit review. A pure
  refactor must pass against the existing references.

## Verification

While developing, run JavaScript syntax and the focused browser spec for the
owned route. Before handover of a portal behaviour change, run:

```powershell
python -m unittest tests.python.test_architecture_guardrails tests.python.test_quality_gates
node --test tests/js/test-offline-service-worker.mjs
cd tests/browser
npm run test:core
```

Add the Python owner tests when a backend or API response changed. `test:core`
uses phone WebKit and Chromium and excludes screenshot-only assertions. Run a
focused visual spec with `--grep @visual` when appearance intentionally changes;
run `npm run test:full` for broad visual/navigation refactors or release
qualification. Exact tiers are in [Quality gates](quality-gates.md).

A portal-only checkpoint is deployed without rebuilding the native QML/C++
television application. Phone review on the installed iOS PWA is the normal
handover, so use `scripts/windows/deploy-portal-to-pi.ps1` after proportionate
checks unless the task says not to deploy. It targets
`pinbecker@mabeltv-512.local`, selects only saved portal changes, requires a PWA
cache revision, runs a small deployment smoke gate, backs up the live targets,
verifies hashes and Pi health, and rolls back a failed handoff. It never builds
or restarts the native player and never commits or pushes.

The server-side boundary behind these assets is documented separately in
[library-service-architecture.md](library-service-architecture.md).

## Scroll and return navigation

`core/scroll.js` captures the visible page immediately before a synchronous DOM
update and restores it before yielding. Network readers capture after awaiting
the response, so a slow refresh cannot undo a later scroll gesture. Snapshots
include stable content anchors, open sheet panels and horizontal rails matched
by owner identity, even when a render replaces the rail element. Large library
refreshes and returning views also settle after the existing screen animation
and two rendering frames. A newer restoration, navigation or user input cancels
that final correction; browser scrolling and entrance animations remain intact.

`core/navigation.js` remembers each top-level view; first entry begins at the
top, returning restores its position, and revisiting the active view stays put.
Bottom-rail destinations replace the current browser-history entry. They do not
create, collapse or reconstruct independent section trails. Child routes and
content cards create ordinary browser-history entries, leaving native iOS
WebKit responsible for the interactive edge-Back gesture and its preview. Each
bottom-rail section separately remembers its last open view, internal tab and
scroll position. The first tap after leaving restores that location; tapping
the already-selected destination resets its root view to the top.
The bottom rail exposes MabelTV and My TV as separate destinations. Each
domain owns the same Watch, Insights and Downloads tab contract while retaining
separate content and download filters. USB remains a complete view but is
entered through Settings and therefore keeps Settings selected in the rail.
Explore deliberately keeps its feed and position for returns within one minute;
after that it rebuilds from the latest viewing history and starts at the top.
`playback/view.js` separately remembers each domain tab. My Viewing and channel
history return through the same navigation boundary. Insights retains a position
and search per subroute. USB retains positions per drive and folder and discards
obsolete browse responses. New folders begin at the file browser; Up and
breadcrumbs restore visited folders. Same-folder selection and refresh retain
the viewport. Activity keeps a separate position for each of its job tabs.

Shared dialogs save their scroll containers on close and restore them when a
child invokes its parent callback. Explicit next-episode navigation still brings
the requested episode into view; ordinary Back preserves the earlier position.
Film filters retain native option nodes when their choices have not changed.
`tests/browser/portal-scroll.spec.mjs` exercises these contracts with long lists
on iPhone WebKit, iPad WebKit and Chromium; screenshots remain unchanged.

## Family collections

The `family/playlists.js` owner renders saved collections, Add to Playlist
selection, repeat controls and animated arrow ordering. `family/library.js`
owns Storytime and memory-channel browsing/settings. `family/story-audio.js`
packages multiple chapter Files in natural filename order as a deterministic,
uncompressed ZIP without copying the whole book into memory. `family/uploads.js`
uses the existing resumable chunk transport, and `family/device-player.js` owns
inline audio listening and single-memory preview. `family/storybook.js` owns
the device Storytime catalogue, interruptible book previews and reverse/docking
transition. Their HTML/CSS owners are `overlays/family.html`,
`experience-family.css` and `experience-storytime.css`. They are registered in
the private ordered bundle; the immutable delivered shell is release 294.
Stories exposes one Open Storytime action with the normal TV/device destination
sheet. Both catalogues use the alphabetical SQLite projection without leading
The/A, retain book identity during refreshes, and share eight cover materials.

Playlist browsing remains inside the Watch Playlists tab. Each playlist opens
its own `#mabel-playlist/<id>` page with channel-style Back navigation and a
measured fixed phone header. Its catalogue card previews up to three programme
posters in a fan. Playlist ordering, repeat and queue actions keep their owners
and API contracts. A second tap on the selected MabelTV navigation resets Watch
to Episodes; switching between primary sections still restores their location.
Create Channel shares Edit Channel's compact identity fields and radio choices.

`family/memories-player.js` plays whole memory sequences on the device using
the same `target: device` session plans as the native player. The bounded
`family/memories-composition.js` renderer fits whole photos into varied solo,
two-, three- and four-photo layouts, adapts to portrait screens and pauses its
movement with playback. Scene transitions retain the outgoing photo positions.
Videos keep their own audio. Background
music fades around videos. Device playback never sends a TV command; closing
the player cancels timers, animations, resize observers, fades and late session
responses. The normal channel Play Memories button opens the existing-styled
TV/device destination sheet, with Playback Settings alongside those actions;
there is no separate play toolbar inserted into the gallery.

The Watch switcher is one row: Episodes, Films, Playlists and Stories. Memories
are Photos & Videos channels reached through their channel cards and normal
channel page, never a fifth switcher tab. Up Next remains the
active queue on Home. Saved playlist edits never alter a playing copy; Play
Playlist confirms replacement and Add to Up Next appends without restarting.
Storytime uploads one recording or a group of chapter files and one illustration.
The prepared recording retains progress across the whole book and
uses audio Media Session controls where the device supports them. Device Back
saves listening progress and reverses the opening into the responsive catalogue,
with generation guards preventing cancelled openings from restarting narration.
The device catalogue never sends native playback commands. Its optional DOM
full-screen action keeps the illustrated scene together; reading controls hide
during playback and remain available on pause or tap. Memories
provide direct phone uploads, capture-date ordering, shuffle, music settings
and start-from-selected playback. Device downloads and My TV controls are
unchanged.

Local My TV films, episodes and whole shows expose Send to Mabel TV through `playback/send-to-mabel.js`. Its destination sheet chooses an existing matching channel or creates one. Playback retains the original My TV player; there is no player-choice/framed My TV route. Completed device stories close into their existing catalogue animation.

The story destination sheet includes Listen on TV - audio only. It sends a strictly boolean `audio_only` option through the existing authenticated family start route; normal TV/device choices are unchanged. This is a black HDMI picture with sound, not a hardware-panel power setting.

## My Library

`my-tv-viewing/local-library.js` owns `#my-tv-library`, its local search,
type/collection/sort filters and the normal title grid. The My TV
homepage has equal My Viewing and My Library shortcuts. The library uses the My Viewing subpage layout: top Back control, My Library
heading, shared search and compact filters. The My TV
domain Watch/Insights/Downloads tabs remain on the parent homepage. Title and
season playback use the existing sheets.
Membership comes only from `library.my_tv_library` and series with local episodes.
Unmatched and non-browser-ready files remain visible; family channels and
streaming-only viewing records never contribute membership. The Collections
dropdown lists the existing My TV folders. Selecting a name filters titles
directly in the same grid; there is no collection-tile view or extra picker.
New collections are created
inside Film settings' Move to collection control; there is no separate Folders
management sheet. Phone title and collection-content grids are four across.

The authenticated `/api/my-tv/library/metadata` endpoint validates the title
against the current local catalogue, then returns cached TMDB genres and the
film collection identity without provider requests or viewing mutations. This
endpoint remains available, but My Library's saved collections need no metadata
enrichment requests. Title Back restores the same collection filter and grid.

`experience-my-library.css` owns the grid, including compact single-line titles
with an ellipsis. Existing four-column surfaces retain their approved typography.
`added_at` is an optional local-media state extension, set on first discovery
for new files. Existing files use their filesystem modification dates when no
recorded arrival exists. Series recency follows its newest local episode.
No schema or Downloads storage change is required.

## Channel numbering settings

`library/channels.js` owns the `#settings/channels` directory reached from
Mabel TV Settings. All channels, including hidden and empty ones, have up/down
arrows. Each tap sends the complete folder/number snapshot in its desired order
to authenticated `reorder-channels`; the backend rejects stale snapshots and
renumbers consecutively from one in a single SQLite transaction. Controls lock
while saving. Failed writes retain the confirmed order; successful writes with
failed refreshes are reported as saved. Opening the page does not change state.

`repositories/channel_order.py` reuses the transactional single-channel mapping
so stable identities, metadata, favourites, programme visibility, history,
queue entries and runtime references travel with each channel. Upload admission
and affected-channel checks share the management lock. No schema change occurs.

The shared creation sheet displays a read-only next number (channel count plus
one). New portal requests omit the number; the backend closes old numbering gaps
and appends the new channel atomically. Explicit-number API clients remain
supported. Channel detail numbers are read-only too. Failed creation preserves
the form. Initial setup assigns consecutive numbers rather than editable fields.

## Portal Studio

`studio/torrents.js` owns Find Anything searches and release/file review. It
keeps season-pack selections grouped, then uses the existing destination sheet
and its Original / Optimised / Both cloud archive controls. Search/inspection
requests use the shared Studio polling lifecycle; provider text is escaped and
only hash-bound server selections reach the queue. The four compact tabs share
the normal Studio route and Back behaviour, including `/torrents` deep links.

`studio/library.js` owns the My TV Studio route, independent iCloud catalogue and BBC iPlayer programme/episode browser. `studio/queue.js` owns shared destination, metadata matching, activity and private connection sheets. `experience-studio.css` uses shared theme tokens with compact segmented tabs, quiet headings and the shared film header, settings cog and action cards. Destination choices use visible native selects; there are no duplicate option-page triggers. The destination and optimisation sheets retain bounded scrollable bodies; file settings size to their content like My TV film settings. Destructive confirmation keeps the named selection, one full-width action and a separate cancel control. My TV Home and My Library link to Studio; primary navigation, Back and offline handling remain shared.

The laptop's durable worker reports independent stage progress without refreshing the library or losing form focus. iCloud refresh keeps the previous catalogue on failure. Search requests wait on the Pi while the laptop is offline. Cloud sign-in runs only through the owner-authenticated HTTPS portal and never browser storage. A private Unix socket carries rclone's configuration protocol.

`studio/cloud-library.js` owns four-column My Viewing poster cards, grouped cloud series. iCloud collections are no longer exposed in the portal. `studio/metadata.js` owns background exact matching and explicit rich metadata correction before publishing. `studio/cloud-delete.js` owns per-file deletion confirmation: grouped versions are unchecked until individually selected. `studio/versions.js` checks canonical title/episode identity against current Pi files and offers Keep, Replace or Both with a frozen version check. `library/subtitles.js` provides the shared subtitle selection/search sheet for My TV, Mabel TV and iCloud files; changes apply on the next playback and never issue a TV command. The library exposes Films/TV/Kids and sorting. My TV collections remain destination choices for Pi filing; cloud collection assignment and filtering are removed. Historical cloud associations remain stored without moving or deleting media. Activity keeps keyed rows with a Studio-specific version marker, compact status/actions with one visible failure message; the portal system-version marker is reserved for actual version labels.

Studio keeps catalogue matching quiet and exposes corrections per title. The library toolbar contains the category selector and Select; refresh sits beside the connection status. Selection mode replaces personal artwork status with an empty circle on each card and a filled tick for chosen titles. Activity lists pending work, actionable failures and the twenty most recent completion receipts. Cancelled records remain visible with a Cancelled status and can be removed from history by the same swipe action as completed entries.

Activity presentation derives from the actual transfer stage, distinguishing a
downloaded source, Pi delivery and subsequent iCloud upload confirmation. Legacy
quality-blocked delivery jobs resume with compatibility checks and without
consenting to another size reduction. Compress anyway is limited to explicit
iCloud optimisation requests. A small source is never assumed Pi-compatible.

iCloud title taps open Send to TV directly. The shared film settings cog opens a content-sized sheet for original recovery, title matching, optimisation and deletion. Native dropdowns handle destination, My TV collection and quality without intermediate pages. Sheet bodies own scrolling. Optimisation shows current and estimated size with a plain saving and replacement note, without format tags, percentage badges or expandable technical copy. BBC search has no separate refresh control.

Studio title sheets keep their layout-viewport height when the iOS keyboard
overlays them. `studio/controls.js` responds to visual-viewport resize and pan
events by scrolling the whole card while typing, including the large artwork
header, with trailing space for the occluded area. It keeps the focused field
and its inline action above the keyboard without scrolling the document. Normal
body scrolling returns when the keyboard closes; other portal sheets retain
their existing behaviour.


Studio Activity keeps artwork, progress meters and action buttons mounted during
percentage/speed updates. Its rate comes from the worker's download message.
The controls owner performs cached, non-blocking artwork-only title lookups when
no poster is recorded; uncertain matches retain the generic icon. These lookups
never approve a metadata match or delay a transfer.

The portal assembler embeds `PORTAL_BUILD` from the immutable service-worker
`SHELL_RELEASE` in `/portal-app.js`. System and help displays this loaded bundle's
build, not the latest server version or worker-registration state, so an older
PWA accurately identifies its cached interface.

Studio artwork-only matching treats ampersands and "and" equivalently and can
match an explicit franchise-prefix subtitle when exactly one movie result fits.
Recorded TMDB identities take precedence; ambiguous results keep the icon.

### Studio title acquisition and Activity

`studio/acquire.js` owns the Get action on unowned title cards. Its own BBC
request never changes the iPlayer tab state. Exact numbered series or a film
with a unique exact title and plausible complete runtime may offer the existing BBC
download flow; uncertain matches stay silent. Navigation, a changed query,
inspection and hidden-document transitions invalidate the offer. Cloud
ownership uses canonical identity across the complete cached catalogue, with
an exact name/year fallback for unmatched files, rather than the visible page.
Activity opens the shared title card immediately, without a full-library or
bootstrap refresh. A targeted local-membership request runs independently of
metadata and device-cache reads; playback waits only for that Pi check.
Cloud-only copies do not acquire playback controls from a completed job label.
Closing or replacing a title aborts its outstanding title/membership requests.
Failed artwork searches are evicted so a later tap can retry.

The BBC's short film synopsis need not contain its production year. Explicit
structured/descriptive years must agree, and ambiguous exact films, related
titles and incompatible runtimes are rejected. An early Get tap can complete
its runtime metadata lookup independently of the torrent search.

`my-tv-viewing/artwork.js` retains decoded image nodes while a surface updates
its controls, metadata or ordering. Cloud and My Library grids reconcile stable
cards; selection changes only selection/action controls. Provider strips retain
unchanged nodes and back off temporarily unavailable availability summaries.
Film/series posters, streaming and rental logos, Home rails and season artwork
reuse matching images. Failed artwork still uses the bounded retry path.

`studio/activity.js` owns Activity rendering and swipe-to-remove for finished
entries. Active and paused work cannot be dismissed. The repository records
historyHidden while retaining job status, acquisition/delivery receipts, media
and recovery provenance; status omits those hidden rows. Activity uses existing
local film, series and channel metadata before a presentation-only search.
An identity without a poster is sufficient to open its card, but does not end
artwork lookup. Existing older adult-series artwork filenames remain bounded
read-only names within the series artwork cache.

Request diagnostics include failed reads and actions, with route/status/timing
only and no bodies or query values. Transient gateway/busy GETs have one bounded
delayed retry; actions are never automatically replayed. Invalid JSON is also
recorded. The loaded bundle still identifies its own immutable PWA build.

Cloud-to-Pi destinations offer Compatibility only alongside the three
compression profiles. This sets preparationIntent=compatible; it is not a
fourth size target. The Windows worker reuses a compatible input, otherwise
remuxes or performs the required destination conversion. The separate iCloud
space-saving action still requires a compression profile.
