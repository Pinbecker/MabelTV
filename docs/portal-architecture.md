# Portal architecture

The installed iOS PWA is MabelTV's primary portal. Its frozen visual and
behavioural contract is documented in [ios-pwa-baseline.md](ios-pwa-baseline.md).
This map describes where portal work belongs without changing that contract.

## Runtime assembly

`scripts/pi/mabeltv_backend/portal.py` assembles the portal and recursively
expands `portal-include` comments before the HTTP layer returns HTML. The
installed `mabeltv-library` executable remains the stable entry point.
`scripts/pi/mabeltv-library.html` is the single Experience entry document. It
deliberately contains only document metadata, ordered CSS and JavaScript
assets, and top-level includes. Page markup lives under
`scripts/pi/portal/html`:

- `auth.html` owns setup and PIN-gate markup.
- `app-shell.html` owns the Experience header, navigation, and view includes.
- `views/` contains one Experience file per top-level route.
- `overlays.html` is an ordered dispatcher for the focused overlay partials in
  `overlays/`. The IDs in those partials are public JavaScript contracts.

Include order is functional. Shared nodes and dialogs must exist before the
ordered scripts initialise.

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
- `watch.css`: family and Adult player foundations.
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
- `experience-explore.css`: the continuous Adult TV suggestion catalogue,
  its compact quick actions and catalogue-only title route.
- `experience-appearance.css`: the device-local colour page, its live preview,
  appearance slider, accent presets and semantic-colour reference.
- `experience-settings.css`: settings, device, and activity surfaces.
- `experience-insights.css`: viewing-insight dashboards and detail surfaces.
- `experience-responsive.css`: Experience phone/tablet adaptations.
- `experience-overlays.css`: common Experience dialog and management shells.
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

The portal uses ordered classic scripts, not JavaScript modules. Top-level state
is deliberately shared between the files, so changing script order can break
initialisation even when each file is syntactically valid.

1. `mabeltv-offline.js`: service-worker registration and offline storage.
2. `portal/js/ui-components.js`: shared DOM components and dialog lifecycle.
3. `portal/js/core/foundation.js`: shared state, API, escaping, auth, and base
   helpers.
4. `portal/js/core/scroll.js`: viewport snapshots, shared render preservation,
   horizontal rail restoration and screen positions. It precedes
   `portal/js/core/navigation.js`, which owns routes, views and history.
5. `portal/js/core/live.js`: live-picture and live-channel behaviour.
6. `portal/js/core/load.js`: initial portal boot and data loading.
7. `portal/js/channel-page.js`: reusable channel detail renderer.
8. `portal/js/library/adult-library.js`: Adult film catalogue management.
9. `portal/js/library/usb-browser.js`: USB browsing, selection, and import.
10. `portal/js/library/viewing-insights.js`: viewing dashboards and history.
11. `portal/js/library/device-status.js`: device, storage, and job status.
12. `portal/js/library/channels.js`: channel-management rendering.
13. `portal/js/playback/players.js`: local player primitives and state.
14. `portal/js/playback/film-library.js`: film cards and film sheets.
15. `portal/js/playback/adult-series.js`: Adult series catalogue and tools.
    `portal/js/playback/film-catalogue.js` follows it and owns the Adult Watch
    film catalogue, collection and metadata-genre filters, and combined search.
    Filters apply to films; series and Continue watching keep their own scope.
16. `portal/js/playback/programmes.js`: programme sheets and actions.
17. `portal/js/playback/downloads.js`: device-download rendering and actions.
18. `portal/js/playback/view.js`: Watch view composition and dialog wiring.
19. `portal/js/adult-viewing/catalogue.js`: Adult viewing catalogue.
20. `portal/js/adult-viewing/seasons.js`: series and season navigation.
21. `portal/js/adult-viewing/details.js`: Adult viewing details and startup.
22. `portal/js/adult-viewing/person.js`: cast detail cards and filmography
    navigation.
23. `portal/js/adult-viewing/explore.js`: continuous TMDB discovery, quick
    viewing actions, weak impression feedback and visit freshness.
24. `portal/js/actions.js`: application event bindings and remote commands.
25. `portal/js/lg-tv-remote.js`: the separate LG webOS remote.

Classic intentionally omits Experience-only Adult-viewing and LG-remote scripts.

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
  a parent card while a child opens, `dialogs.returnTo` carries a deeper chain,
  and `dialogs.dismissJourney` makes the close control exit the complete chain.
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
- Add every new offline-shell asset to `SHELL_URLS` in `service-worker.js` and
  increment `SHELL_CACHE` when the delivered shell changes.
- Treat screenshot updates as visual changes requiring explicit review. A pure
  refactor must pass against the existing references.

## Verification

Run JavaScript syntax checks for every portal script, then:

```powershell
python -m unittest tests.python.test_library_service tests.python.test_imaging_tools tests.python.test_player_safety
node --test tests/js/test-offline-service-worker.mjs
node --test integrations/matter/mabeltv-power-socket.test.mjs
cd tests/browser
npm test
```

The browser suite covers the 393 x 852 installed-iPhone contract first, with
iPad WebKit and iPhone Chromium providing additional layout and compatibility
coverage. A portal-only checkpoint is deployed without rebuilding the native
QML/C++ television application. After explicit deployment approval, use
`scripts/windows/deploy-portal-to-pi.ps1`; it selects only saved portal changes,
requires a PWA cache revision, runs the architecture and browser gates, backs
up the live targets, verifies hashes and Pi health, and rolls back a failed
handoff. It never builds or restarts the native player and never commits or
pushes.

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
Explore deliberately keeps its feed and position for returns within one minute;
after that it rebuilds from the latest viewing history and starts at the top.
`playback/view.js` separately remembers Watch tabs. My Viewing and channel
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
