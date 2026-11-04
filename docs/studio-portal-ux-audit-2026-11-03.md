# Studio portal UX and styling audit — 3 November 2026

Status: audit and build requirements only. No application files, production
queues, media, services, Pi network settings or deployed UI were changed.

This audit supplements the [agreed application build plan](studio-optimisation-build-plan-2026-11-03.md).
The owner specifically requested every menu, submenu and button be checked,
including menus expanding beyond the screen and mismatched collection controls.

## Baseline and method

- Audited UI: Pi release `/opt/mabeltv/releases/0.2.5-20261103181119`, shell 327.
- Local checkout at capture: `6bfea6321386f86be70a324a577f62fae8a8a988`.
- These are different UI trees. Normalised comparison found differences in 29
  of 187 portal/shell assets, including Studio controls, markup, CSS and shared
  dialog styles. The live UI includes `studio/controls.js` and
  `html/overlays/studio-library.html`, which are not in that local baseline.
- Captured the live portal assets and portal assembly owner read-only. Replayed
  those exact UI files in an isolated local browser fixture. Live API reads
  confirmed the separate Pi and cloud collection lists; all simulated writes
  were intercepted locally. No deletion, move, authentication or queue action
  was performed against the real library.
- WebKit review: 393×852 in light and dark; 320×568 in light; 1024×768 in dark.
  The narrow layout is also relevant to reduced available height, but this was
  not a physical iPhone keyboard test.
- Ten completed audit scenarios produced 94 named screenshots and geometry /
  control-state records. Successful capture does not mean the UX is acceptable:
  the observed defects below are the purpose of these runs.
- Selected evidence is retained under
  `docs/assets/studio-ux-audit-2026-11-03/`. Complete capture scripts, snapshots,
  measurements and logs are under `out/studio-ux-audit-20261103/`.
- Original owner tests target the older checkout's direct-action layout, so
  their hidden-button failures against the live More menu were not classified
  as product defects. A narrow torrent capture initially targeted a hidden
  radio input; clicking its visible label corrected that audit-script issue.

Before implementation, reconcile the live UI with the working tree. Do not
overwrite newer collection/menu work by deploying the older local assets.

## Coverage

| Area | Reviewed states |
| --- | --- |
| Library | Films/TV/Kids controls, sort, collections filter, grid text/actions, Select/Done, multiple selections and selection tray |
| Destination | My TV / Mabel TV / iCloud, Films / TV series, show/new show, season, target collection, compression, Original / Optimised / Both, outcome card and queue footer |
| More actions | Send to TV, move to collection, new collection, title matching, optimise iCloud copy and delete confirmation |
| Nested settings | Library/show/collection/quality option sheets, option selection, X/Done behaviour and parent restoration |
| Optimisation | Normal preview, profile submenu, expanded file details, multiple titles, loading and failed initial/refreshed previews, Cancel and confirmation state |
| Episodes | Cloud series and iPlayer episodes, season filtering, Select/Deselect all, selected count, Continue, returning to destination and lost draft values |
| Downloads | Search/result entry, torrent file review, season/specials selection, file information, destination and original/both cloud retention |
| Connections | Connection summary, refresh/connect controls, sign-in sheet and return path; synthetic credentials only |
| Activity | Queued, failed, awaiting cloud confirmation, details/actions and completed job visibility |

Native select pop-up presentation, real keyboard behaviour and installed-iPhone
gestures still require physical-device acceptance. No actual video playback or
destructive action was triggered for this audit.

## Findings and required corrections

### STU-UX-01 — P1: mobile panels exceed the viewport and lose their headers

**Observed:** on a 320×568 viewport, Move to collection renders an 824 px panel
at y=-265. Selecting New collection grows it to 920 px at y=-361. The title,
close action and beginning of the list are above the screen. On 393×852, the
new-collection panel still reaches y=-77. The optimisation panel reaches y=-38
on the narrow phone, and expanding File details makes it 784 px at y=-226.
Tablet collection panels remained bounded in the reviewed state.

**Cause:** live `experience-studio.css:79-80` gives the panel
`max-height: inherit`. The shared mobile rule in
`experience-playback-overlays.css:621-629` makes the containing dialog a full
viewport overlay with `max-height: none`. The panel therefore inherits no height
limit, overriding the shared bounded-panel contract. This is a concrete cascade
conflict, not just an aesthetic preference.

**Build requirement:** apply a viewport/safe-area limit to the actual panel,
with a fixed/reachable header and footer and one scrollable content region.
Test long collections, New collection, expanded optimisation details and nested
options. Growing content must not push the panel above the viewport or clip its
close control. Resolve this within the shared dialog contract without breaking
other portal sheets.

Evidence: [collection overflow](assets/studio-ux-audit-2026-11-03/collection-overflow-320.png),
[new collection](assets/studio-ux-audit-2026-11-03/collection-create-overflow-393.png),
[expanded optimisation](assets/studio-ux-audit-2026-11-03/optimise-details-overflow-320.png).

### STU-UX-02 — P1: choosing episodes discards settings and removes the edit route

**Reproduced:** open a cloud series, choose Balanced and the MCU target
collection, then choose episodes and Continue. Before: `balanced / MCU`.
After: `compact / Unfiled`. The Choose episodes control is no longer visible.

**Cause:** the episode continuation calls `studioOpenCloudTitles`, which creates
a new `studioDraft`, empties `targetCollections` and resets the destination form
in `studio/queue.js:5-9`. `studio/metadata.js` hides Choose episodes when
`context.selectedEpisodes` is true.

**Build requirement:** editing the file/episode subset must preserve the chosen
destination, compression, collection, archive retention and replacement intent
where still valid. Keep a visible way to edit the selected subset and its count.
Explicitly explain any necessary invalidation; never silently return to defaults.

Reproduction record:
`out/studio-ux-audit-20261103/followup-captures/` →
`episode-draft-state.json`, `30-episodes-before-edit`, `31-episodes-after-edit`.

### STU-UX-03 — P1 UX ambiguity: unrelated collection destinations share one name

**Confirmed:** the send dialog's Collection means the selected destination's
Pi collection (or cloud collection for an iCloud destination). The More → Move
to collection action always means the existing iCloud item's collection. The
dialog title does not identify that storage scope.

Live API reads showed four Pi collections (`Compression tests`, `Harry Potter`,
`MCU`, `Other Films`) versus nineteen cloud collections. A reproduced item could
show Other Films in the send form while Move to collection selected MCU. Those
are intentionally separate properties, but the presentation makes them look like
conflicting values for the same property. This is not evidence of a corrupt move.

Creation is also inconsistent: the send-target picker offers existing names
only, while the cloud Move dialog offers New collection. Creating one through
that menu cannot be expected to add it to the independent Pi picker.

**Build requirement:** use one coherent collection interaction with explicit
destination context, such as TV collection / iCloud collection. Populate and
select values from the correct authoritative scope. If creation is offered,
create in that destination and refresh its picker. Do not silently synchronise
unrelated Pi/cloud collections. Preserve each destination's draft on switching.

Evidence: [Pi destination collection](assets/studio-ux-audit-2026-11-03/pi-collection.png),
[existing cloud collection](assets/studio-ux-audit-2026-11-03/cloud-collection.png).

### STU-UX-04 — P2: the cloud collection filter offers irrelevant category choices

The live Films catalogue returned collection names including Bluey, Black Books
and Succession. The category-filtered catalogue exposes a global collection
list, while the UI offers Films/TV/Kids and Collection side by side without
explaining the combination. Some combinations therefore yield an empty view
that can look like a missing/misfiled collection.

**Build requirement:** define filter semantics deliberately: either offer
collections applicable to the active category, or make the broader scope and
empty-result state clear. Preserve/reset selection predictably when changing
category. Verify against real collection data, not only an empty fixture.

### STU-UX-05 — P2: the destination sheet is much taller than its contents

The destination panel is forced to 760 px on a 393×852 phone and 732 px on the
reviewed tablet. Short forms leave a large empty region between choices and the
outcome/primary action. Nested pickers then appear over this already very tall
panel. The cause is the fixed destination height and outcome `margin-top:auto`
in the live Studio CSS, not a need to make every control larger.

**Build requirement:** size short forms to useful content within the shared
bounded sheet. Keep a clear relationship among choices, outcome and primary
action; use scrolling for genuinely long content. Preserve a usable, intentional
layout on both phone and tablet.

Evidence: [destination layout](assets/studio-ux-audit-2026-11-03/destination-empty-space-393.png).

### STU-UX-06 — P2: routine cloud actions are hidden behind a send workflow

Tapping an iCloud item immediately opens Choose destination with My TV selected.
Optimise, move and title-match actions require More first. The More menu then
contains Send to TV, which simply returns to the same destination form rather
than sending anything. Cancel from optimisation, move, matching and deletion
returns to the destination form, not the action menu that opened them.

**Build requirement:** make the cloud item's available actions discoverable
without requiring the user to begin an unrelated send task. Use consistent
labels, return destinations and retained drafts for all actions. Specify and
verify the navigation tree, including browser Back, X, Escape and Cancel.

### STU-UX-07 — P2: option sheets have ambiguous commit and dismissal behaviour

Selecting a radio option applies it to the parent immediately. X and Done both
close the sheet and retain the change. The parent sheet remains open underneath,
so every small setting introduces another modal layer and another dismissal.
The same data is otherwise selected through native library dropdowns, custom
option sheets and the separate collection-move form.

**Build requirement:** pick one intentional interaction contract for comparable
controls. Make selection/commit/cancel behaviour clear, avoid unnecessary Done
steps, and preserve focus and the calling draft when a child closes. Nested
menus must use the same bounded scrolling and navigation rules as other sheets.

Evidence: [quality submenu](assets/studio-ux-audit-2026-11-03/quality-submenu-393.png).

### STU-UX-08 — P2: typography, button targets and control styling are inconsistent

Measured library titles use 9 px text and year/size metadata 8 px in the phone
fixture. The four-column cards truncate identifying titles. The three library
filters are 10 px native-looking controls, visually unlike the custom destination
pickers. Their inner native borders/arrows produce a different control treatment.

Several custom setting triggers are only 22 px high; footer Done buttons are
36 px, and episode-edit links are 22 px. Row-label behaviour needs to provide a
reliable equivalent hit area, rather than requiring precise taps on the small
right-hand value. The 32 px close circle already has an expanded pseudo-element
hit area; its visual size alone was not counted as a touch-target defect.

**Build requirement:** use the approved portal's control and typography tokens
consistently, keep essential title/size information readable at normal phone
scale, and make setting rows reliably tappable. Preserve the agreed four-column
library and compact intent; do not repeat the rejected blanket font/spacing pass.
Check selected, disabled, focused, loading and destructive button states.

Evidence: [library controls](assets/studio-ux-audit-2026-11-03/library-controls-393.png).

### STU-UX-09 — P1: preview failures appear behind the active menu

**Reproduced:** open More → Optimise with a failed preview response. The action
menu remains open but the error is written to the page-level `studioError`
behind it. The active dialog contains no failure explanation. The initial busy
state changes `aria-busy` and disables the action without visible animated row
feedback, so a slow or failed request can appear to do nothing.

**Cause:** `studioOpenCloudOptimise` routes its catch to `studioFailure` while
the More sheet is active. This differs from refreshed-preview errors, which do
have an inline error within the optimisation sheet.

**Build requirement:** show loading, error and retry feedback in the active
surface that owns the operation. Keep the user's selection and make recovery
obvious. Apply the same principle to every async menu/button action.

Evidence: [error behind menu](assets/studio-ux-audit-2026-11-03/preview-error-behind-menu.png).

### STU-UX-10 — P2: refreshed previews leave stale savings beside new choices

Changing profile starts a new request and replaces the estimated output with
Calculating, but retains the previous savings and file details. When that
request fails, the new profile remains selected while the old savings continue
to be presented positively. Confirmation is correctly disabled; the displayed
comparison is nevertheless internally inconsistent.

**Build requirement:** treat profile, output estimate, savings and file details
as one versioned preview. Invalidate all dependent numbers together while
refreshing; show a consistent unavailable/error state and a clear retry path.
Only enable confirmation for the current matching source/profile result.

Evidence: [stale estimate after error](assets/studio-ux-audit-2026-11-03/preview-error-stale-estimate.png).

### STU-UX-11 — P2: Activity hides completion and obscures useful state

Completed/cancelled jobs vanish from the rendered list unless there is a metadata
warning. A synthetic completed, cloud-saved job produced the empty "All caught
up" view with no final destination/receipt to inspect. A missed phone alert
therefore leaves no visible completion explanation in Activity.

Failed cards also show a progress percentage such as Needs attention / 0%.
Queued work shows a determinate zero bar. Cards have multiple separated message,
details and action regions; the phone review showed a failed row occupying about
268 px, pushing the next useful work state below the initial view.

**Build requirement:** retain a bounded recent-completion view with clear final
Pi/cloud outcomes and any pending archive/cache work. Distinguish failed,
waiting, queued and measurable active progress. Keep cards readable and concise
without restoring tiny text or showing percentages that imply work is advancing.

Evidence: [Activity](assets/studio-ux-audit-2026-11-03/activity-393.png).

### STU-UX-12 — P2: optimisation confirmation lost useful title context

The new header reduces the film to a small poster, title and year/runtime.
The available synopsis is not rendered, unlike the earlier confirmation.
Specific filenames and output details are available only inside the expandable
File details area. This is particularly important when multiple versions or
selected episodes are involved.

**Build requirement:** retain enough concise artwork/title/version context to
identify what is being replaced. Restore the agreed useful summary where it
helps, without a wall of technical copy. Make file/version scope unmistakable
for multi-selection and destructive actions.

## Required build and acceptance order

1. Reconcile the captured live UI and local checkout without losing existing
   collection or playback changes.
2. Fix panel bounds/scroll ownership, lost episode drafts and in-dialog async
   errors first (STU-UX-01, 02, 09).
3. Resolve collection scope, creation and filtering as a coherent journey
   (STU-UX-03, 04), not separate visual patches.
4. Specify the action/menu return tree and option commit contract (05–07).
5. Apply a scoped, consistent Studio control/typography/layout pass based on
   these real states, covering previews and Activity as well (08, 10–12).
6. Review the full journey at 393×852, 320×568, a constrained-height keyboard
   scenario and 1024×768. Include long collections, long names, empty/error/
   loading states, multiple files, original/both retention and expanded details.
7. Verify on actual iPhone/Safari, light/dark/true-black themes and the chosen
   accent, including native menus, keyboard, focus, Back and dismissal gestures.

Acceptance requires **no off-screen modal header/action, no lost draft choices,
correctly scoped collection values, visible async feedback and consistent menu
navigation**. A green interaction test alone is not a visual acceptance result.

All of this is part of the permanent portal/Studio build. It can be developed
alongside migration. It does not start the one-off bulk conversion or repeat
the rejected styling implementation.
