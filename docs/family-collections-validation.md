# Family collections validation

## Local evidence, 4 October 2026

- Windows incremental native build succeeded. CTest: 8/8 groups passed,
  including 333 database/backend tests, native controller/UI tests, the new
  family UI fixture, JavaScript syntax, service worker, Matter and libmpv smoke.
- Core browser gate: 89 passed, 19 existing conditional cases skipped, on
  iPhone WebKit and Chromium.
- Family browser suite: 12/12 passed on iPhone WebKit, iPad WebKit and iPhone
  Chromium. It covers Add to Playlist/create, arrow ordering, confirmation,
  copied queues, separate Audio, normal memory-channel navigation and settings.
- Focused screenshots cover light/dark playlists, Audio, story actions,
  confirmation, memory gallery and memory settings. The four Watch tabs occupy
  one row, Back to playlists aligns with its container, rows are under 120 px,
  and no horizontal page overflow is present.
- Offscreen native checks exercise progress, pause, seeking, restart, Back,
  and cancellation on standby before delayed audio starts. Memory checks cover
  paired portrait photos, a paused photo clock, skipping into a video with its
  own sound, and music resuming at its previous position after that video.
  The cover, open book and memory spread use test illustrations; these checks
  do not open HDMI or wake the TV.
- Actual generated WAV/PNG/JPEG fixtures pass media preparation. JPEG EXIF
  rotation produces a portrait prepared image while retaining the exact source.
  Retry/cancel, private paths and authenticated native manifests are covered.
- An online backup of the live schema-11 database was migrated separately to
  schema 12. Integrity and foreign keys passed. Every pre-existing row and
  column value remained unchanged, including 11 channels, 795 My TV titles,
  3,665 episode states, 49 viewing items and 108 viewing sessions.

The isolated Pi production build and its complete CTest passed all eight groups
in 360 seconds. Its migration rehearsal remains separate from the live database.
The final memory test extension and image-binding guards are validated separately
before activation; unchanged backend/browser gates are not repeated.

HEIC support (`libheif-examples` and its four decoder dependencies) was installed
without upgrading or removing other packages. The live native PID and TV standby
state were unchanged throughout preparation.

Full logs, source/binary manifests and screenshot artifacts are retained in
`work/family-features-baseline/` locally and the task's isolated Pi source/build
directory. Activation results are recorded separately when completed; build and
test evidence alone does not prove a live deployment.

## Live activation, 4 October 2026

The owner approved the brief native restart. The guarded prebuilt installer
completed successfully and activated `0.2.5-20261004085918`; the previous release
remains `0.2.5-20261003103910`. The source digest is
`dc3d36f7e3ce32cc0ab63096cdd4ff343478f34f4527e41c38d66d3a8d68c1b1`.
Both native binary hashes and 467 installed source paths match the tested tree.
The final QML changes passed the affected four native test groups on Windows
and the Pi before activation; unchanged successful browser/backend checks were
not repeated.

- Live shell 278 and the four private family modules are served successfully.
  Playlists and family-media catalogue endpoints return HTTP 200 with empty
  collections, ready for real uploads; no sample content was installed.
- Schema 12 passes SQLite integrity and foreign-key checks. The installer’s
  validated pre-migration online-backup archive contains healthy schema 11.
  Existing catalogue, queue, favourites and viewing-history counts match it.
  Normal native startup/standby writes changed the runtime projections:
  programme-position rows 42 to 43 and runtime-entry rows 12 to 3. The separate
  migration rehearsal had proved all original row values survive migration.
- Native, Library and both Matter services are active with zero restarts.
  The native status socket responds, watchdog timestamps advance and the health
  timer has a future trigger. No warning-priority service journal entries were
  found after activation.
- The new player and connected TV were returned to standby promptly and remained
  there throughout verification. Temperature was 47.7 C with no throttling.

Machine-readable live evidence is retained in
`work/family-features-baseline/live-verified-release.json`. The rollback archive
is `/var/backups/mabeltv/MabelTV-Backup-2026-10-04T080006Z.tar.gz` on the Pi.

## Acceptance boundary

The connected TV stayed in standby during source builds, offscreen UI tests and
the migration rehearsal. Real TV playback, HDMI/CEC, physical remote timing,
installed iOS audio/background controls and uploads from the owner's phone are
not established by these automated checks. Real family photos/audio must be
added through the portal; no sample content is inserted into the live library.
