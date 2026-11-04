# Studio and library interface

Implemented on `design/studio-library-20261103`, based on `6bfea63`.
The separate main checkout has not been edited. No commit or push is part of this work.

## Studio presentation

The approved reference is `work/studio-review/v2/index.html`. The production
implementation retains the portal header, bottom navigation, rounded Studio
tabs and device theme/accent. Search uses labelled buttons; results, loading,
file review, episode selection, connections and Activity have their own compact
structures. Secondary cloud-title actions are in More.

Destination sheets retain their frame and footer across destination, version
and quality changes. The body scrolls independently on short displays. Show
creation lives in the Show picker; compression uses the shared three profiles.
Known sizes appear in a two-value outcome panel. Unknown recording sizes remain
Pending. Cloud-only delivery labels the archive selector Version.
Optimisation uses one comparison panel and a separate saving strip; actual
output verification and replacement consent remain required.

Tabs, search and filters follow the My TV/library spacing. My Viewing, My Library
and Studio shortcuts share a 48-pixel height. Existing four-column card type,
single-line ellipsis and aligned rows are retained.

## Collections

The former genre filter lists saved local collections directly. Selecting one
shows its titles in the normal grid. There is no collection-tile tab or separate
Folders management screen. Film and series settings offer Move to collection
and inline creation.

Local films retain their existing folder owner. Series retain their episode
roots and store collection membership in their existing SQLite extra data,
updated through a targeted transaction and library revision.

iCloud collection definitions and membership are independent reserved Studio
fields in SQLite. Existing cloud folders seed names. Logical collection changes
do not move iCloud files or override automatic filing. Canonical title and stable
file identities keep versions and episodes together through renames.

Studio destinations can select an existing collection. Confirmed cloud copies
inherit cloud-only choices. Studio 1.6.1 carries local film collection choices
into resumable upload admission and assigns series without moving episodes.
Older companions wait on nonempty local collection jobs until they advertise
the library-collections capability.

## Playback confirmation

`core/confirmation.js` owns an asynchronous portal dialog for Play on TV,
USB playback and programme restart. Its Play/Cancel controls are at least
52 pixels high. Escape, backdrop dismissal and browser Back cancel without
sending a playback command. No native confirmation is removed from other
administrative actions.

## Verification and release

Current evidence is under `work/studio-implementation/`; the original design
and library checkpoint is under `work/studio-review/`. Focused renders cover
phone/tablet layout, dark/light themes, fixed sheet geometry, real collection
filtering and large playback confirmations. No golden screenshots are replaced
to hide a mismatch.

Backend changes use the guarded atomic installer with --preserve-player and
the current native binaries. Windows companion updates preserve the existing
profile, worker identity and transfer history. Live installed-PWA acceptance
remains the owner's device review.

