# iOS PWA compatibility baseline

This document freezes the restored pre-audit portal at Git commit
`a886f14bba04efd5aff44a36dee99228d10680e0` as the visual and behavioural
reference for future portal work. The installed iOS PWA is the primary portal
experience; desktop adaptations must not regress it.

## Primary phone contract

The reference viewport is 393 x 852 CSS pixels. On the authenticated Home view:

- The document is 383 pixels wide with no horizontal overflow.
- The fixed mobile header is 383 x 54 at the top of the viewport.
- The fixed bottom rail is 383 x 72 and respects the bottom safe area.
- The main content gutter is 18 pixels on each side.
- The Home library is 347 pixels wide.
- Continue Playing is a horizontal 347-pixel region beginning below search.
- Cards remain inside their horizontal scrollers and do not narrow the page.
- No content may appear above or through the fixed header or bottom rail.
- Hidden application content must not appear behind setup or PIN screens.

Reference captures cover Home, Watch, Remote, and Settings at 393 x 852, plus
Home at 1024 x 768. The automated browser suite in `tests/browser` now protects
these screens with deterministic data in iPhone WebKit, iPad WebKit, and iPhone
Chromium. It also checks representative film and channel menus, the PIN gate,
offline database upgrades, and protected-download access.

Run it from `tests/browser` with:

```powershell
npm ci
npx playwright install webkit chromium
npm test
```

Screenshot updates are deliberate review actions. Use `npm run test:update`,
inspect every changed PNG, and only then commit the new references.

The ownership and loading rules for future portal changes are recorded in
[portal-architecture.md](portal-architecture.md).

## PWA behaviour contract

- Launch, resume, authentication, and locking must not flash protected content.
- Online family and Adult playback must retain their current controls and flow.
- Family downloads remain available when the Pi is offline.
- Adult downloads require a locally verified parent PIN after a cold offline
  launch; the PIN itself must never be stored.
- Service-worker upgrades must retain existing downloads.
- Safe-area padding, touch scrolling, fixed navigation, and video playback are
  checked on a real installed iOS PWA after each explicitly approved checkpoint.

## Deployment rule

Portal-only HTML, CSS, JavaScript, and Python changes use targeted validation and
a portal-only deployment. QML or C++ changes require a separate native build and
must never be bundled into a quick portal checkpoint.
