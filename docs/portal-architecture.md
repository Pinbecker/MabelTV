# Portal architecture

The installed iOS PWA is MabelTV's primary portal. Its frozen visual and
behavioural contract is documented in [ios-pwa-baseline.md](ios-pwa-baseline.md).
This map describes where portal work belongs without changing that contract.

## Runtime assembly

`scripts/pi/mabeltv-library.py` serves the portal and recursively expands
`portal-include` comments before returning HTML. The entry documents are:

- `scripts/pi/mabeltv-library.html` for the current Experience design.
- `scripts/pi/mabeltv-library-classic.html` for the preserved Classic design.

Both entry documents deliberately contain only document metadata, ordered CSS
and JavaScript assets, and top-level includes. Page markup lives under
`scripts/pi/portal/html`:

- `auth.html` owns setup and PIN-gate markup shared by both designs.
- `app-shell.html` owns the Experience header, navigation, and view includes.
- `classic/app-shell.html` owns the Classic shell and its view includes.
- `views/` contains one Experience file per top-level route.
- `classic/views/` contains one Classic file per top-level route.
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
  canonical `.portal-search` contract.
- `experience-shell.css`: fixed header, page frame, and bottom navigation.
- `experience-home.css`, `experience-remote.css`, `experience-watch.css`,
  `experience-library.css`, and `experience-viewing.css`: route ownership.
- `experience-settings.css`: settings, device, and activity surfaces.
- `experience-insights.css`: viewing-insight dashboards and detail surfaces.
- `experience-responsive.css`: Experience phone/tablet adaptations.
- `experience-overlays.css`: common Experience dialog and management shells.
- `experience-playback-overlays.css`: playback-specific dialog presentation.
- `lg-tv-remote.css`: the separate LG TV remote surface.
- `experience-light.css`: light-theme overrides, intentionally last.

### Classic design

The Classic entry point loads `classic-foundation.css`, `classic-shell.css`,
`classic-library.css`, and `classic-responsive.css` after the shared base. Keep
Classic overrides isolated in those files rather than adding Classic branches
to Experience modules.

`portal-design-switch.css` is shared by both entry points and follows their
design-specific styles.

## JavaScript ownership and execution order

The portal uses ordered classic scripts, not JavaScript modules. Top-level state
is deliberately shared between the files, so changing script order can break
initialisation even when each file is syntactically valid.

1. `mabeltv-offline.js`: service-worker registration and offline storage.
2. `portal/js/ui-components.js`: dependency-free shared DOM components.
3. `portal/js/core/foundation.js`: shared state, API, escaping, auth, and base
   helpers.
4. `portal/js/core/navigation.js`: routes, views, history, and navigation.
5. `portal/js/core/live.js`: live-picture and live-channel behaviour.
6. `portal/js/core/load.js`: initial portal boot and data loading.
7. `portal/js/channel-page.js`: reusable channel detail renderer.
8. `portal/js/library/adult-library.js`: Adult film catalogue management.
9. `portal/js/library/usb-browser.js`: USB browsing, selection, and import.
10. `portal/js/library/viewing-insights.js`: viewing dashboards and history.
11. `portal/js/library/device-status.js`: device, storage, and job status.
12. `portal/js/library/channels.js`: channel-management rendering.
13. `portal/js/playback/players.js`: local player primitives and state.
14. `portal/js/playback/film-library.js`: film catalogue and film sheets.
15. `portal/js/playback/adult-series.js`: Adult series catalogue and tools.
16. `portal/js/playback/programmes.js`: programme sheets and actions.
17. `portal/js/playback/downloads.js`: device-download rendering and actions.
18. `portal/js/playback/view.js`: Watch view composition and dialog wiring.
19. `portal/js/adult-viewing/catalogue.js`: Adult viewing catalogue.
20. `portal/js/adult-viewing/seasons.js`: series and season navigation.
21. `portal/js/adult-viewing/details.js`: Adult viewing details and startup.
22. `portal/js/actions.js`: application event bindings and remote commands.
23. `portal/js/lg-tv-remote.js`: the separate LG webOS remote.

Classic intentionally omits Experience-only Adult-viewing and LG-remote scripts.

## Shared UI contracts

`window.MabelPortalUI` is the dependency-free shared component boundary:

- `icon(name, className)` creates sprite-backed SVG icons.
- `button(options)` creates safe `type="button"` controls and supports a sprite
  icon, label, class, accessible name, disabled state, and click handler.
- `emptyState(options)` creates the canonical empty-state structure without
  interpolating untrusted text into HTML.
- `dialogs.open`, `dialogs.close`, `dialogs.dismiss`, and `dialogs.wire` own the
  common modal lifecycle, optional document scroll lock, backdrop/cancel
  behaviour, and focus restoration. `wire` accepts one close button or a list.

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
QML/C++ television application.
