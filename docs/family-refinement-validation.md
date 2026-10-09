# Family features refinement — 4 October 2026

## Delivered changes

The playlist, story and memory actions now use the existing Watch action-row
design, with real gaps, consistent icon treatment and proper destructive
buttons followed by confirmation. Playlist covers use a fan of actual programme
posters. The detail page has compact typography, aligned Back navigation and
independent reorder/remove controls. The four Episodes, Films, Playlists and
Audio selectors remain on one row.

New playlist/story forms follow `visualViewport` height and offset changes,
keep the focused field and submit action visible, and remove their event
listeners on close. This is scoped to the new family forms.

The native and portal storybooks now share a textured forest-green leather
cover, bundled Cinzel Decorative lettering, gilded details and warm paper.
An 8.6-second opening has separate cover and flyleaf movement, camera easing,
changing shadows and a final illustration spread. Personalised lettering is
rendered in code. Audio begins after the opening, Skip opening is available,
and Back/standby cancel delayed playback. Reduced motion settles immediately.
Safari has an explicit Start story fallback if its audio policy requires a tap.

Failed memories remain tappable. The action sheet explains their state, offers
Retry when the retained upload can be retried, and allows confirmed removal.
Missing prepared files are exposed as unavailable rather than playable cards.
Original uploads are retained when an item is removed.

`IMG_8497.mov` contained a normal stereo AAC track and an additional track with
no decodable codec. Preparation now selects one valid audio stream instead of
trying to decode every audio track. A one-second conversion of the actual
retained source succeeded. The Library's normal upload recovery subsequently
prepared the full 8.404-second video during release activation. Its H.264 video,
single stereo AAC track, thumbnail and range-capable HTTP playback were verified.
The original phone file remains present. No live memory was deleted for testing.

## Validation

- Local core CTest: all eight groups passed. The affected native family group
  was rerun after the final layout adjustment.
- Pi native build, serialized with `--parallel 1`, and all eight CTest groups
  passed. The final book geometry passed the affected Pi family UI group.
- Browser core contract: 89 passed, 19 existing skips. Family owner contract:
  21 passed across phone WebKit, tablet WebKit and phone Chromium. The final
  viewport/menu and range-served storybook checks also passed in all three.
- Architecture: 11 tests passed. JavaScript source syntax and `git diff --check`
  passed. No architecture ceiling or assertion was weakened.
- Phone/tablet menus, light/dark playlist details, confirmation, memory settings
  and the cover/opening/page-turn/spread frames were reviewed. Native frames
  were rendered offscreen at 1920 × 1080. WebKit native audio loading uses an
  isolated temporary WAV fixture, rather than relying on page interception.

Evidence is under `work/storytime-refinement/` and its `screenshots/` directory.
The automated keyboard check models the visual viewport; physical installed
iOS keyboard behaviour and audio autoplay still need the owner's device review.
The connected TV was not used for visual or playback acceptance.

## Live release and safety

Activated `/opt/mabeltv/releases/0.2.5-20261004141235`, retaining
`0.2.5-20261004085918` as the previous release. The prebuilt source digest is
`0a17e9f273593fe2a24d86d290db8577dcae5250f33a3000d7970c2a6b169362`.
Both installed native binary hashes and 477 installed source paths matched.
Portal shell release 279 serves the book texture, font and new CSS successfully.

SQLite remains schema 12 with successful integrity and foreign-key checks.
Catalogue, playlist, queue and viewing-history row counts match the installer's
online-backup snapshot. One additional native programme-position projection
was saved during normal startup/standby. The validated rollback archive is
`/var/backups/mabeltv/MabelTV-Backup-2026-10-04T131322Z.tar.gz`.

Native, Library and both Matter services are active with zero restarts; the
native status socket, watchdog and health timer are working. Temperature was
52.6 C and `throttled=0x0` at verification.

The TV remained in standby. Activation temporarily guarded the native CEC
client and sent `turn-off-mabel-only` to the new player. Independent queries
using the real CEC client confirmed physical TV standby before and after
activation. The runtime systemd override and blocking flag were removed; normal
CEC control is restored. A transparent pass-through wrapper remains under
`/run/mabeltv-storytime-polish-guard` for the running process's cached executable
path, and disappears on reboot. Future starts use the normal CEC client.

No commit or push was requested for this refinement pass.

## Generated cover texture provenance

Mode: built-in `image_gen`, not the CLI/API fallback. The generated material
was copied into `scripts/pi/portal/assets/storytime/cover-v2.png`; animation,
lettering, paper, lighting and controls are implemented in QML/CSS/JavaScript.
Original generated output:
`C:\Users\danco\.codex\generated_images\01a0909f-dd0f-7880-b44d-3da23f03cc81\exec-1b6e46ca-051e-4765-a5cc-cb9ac2619dbe.png`.

Final generation prompt:

> Use case: stylized-concept. Asset type: the flat front-cover material for a real animated family storybook in a television app. Create a sumptuous tactile forest-green leather fairy-tale book cover, with intricate restrained gold tooling: delicate vines and tiny stars woven into the four corners and a double gilded rectangular border. Antique luxury craftsmanship, finely pebbled leather grain, slightly burnished raised gold foil, warm subtle edge patina. Straight-on orthographic view of only the rectangular front cover, portrait 2:3, filling the entire image, absolutely no perspective, no spine, no pages, no table, no scene background, no shadows outside the cover. Leave the large central 55 percent of the face quiet and unadorned for live personalised typography added in code; no letters, no text, no logos, no badge, no characters. Realistic beautiful materials with an inviting old storybook feel, timeless and suitable for a child. The output is a production texture mapped to a moving 3D-style cover, not a UI mock-up.

This validation note was written after release activation; it is not part of
the prebuilt source digest above.
