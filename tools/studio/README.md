# MabelTV Studio

Planned upgrade: [agreed portal and Windows Studio optimisation build](../../docs/studio-optimisation-build-plan-2026-11-03.md).
The build specification is planned work, separate from the current implementation described below.

Installed Windows companion for finding, preparing and sending media to Mabel TV and My TV.

## Architecture

The desktop app owns only local preferences, metadata caches and operational transfer journals. The Pi's existing authenticated HTTP API remains the sole owner of library destinations, structured application state, upload admission, validation and publication. Studio never writes directly to the Pi filesystem or its database.

- `main.cjs` owns Electron windows, validated IPC, file dialogs and sign-in.
- `preload.cjs` exposes a narrow API to the sandboxed local interface.
- `lib/store.cjs` atomically persists local preferences and transfer journals.
- `lib/process.cjs` runs bounded, cancellable subprocesses without a shell.
- `lib/tools.cjs` discovers packaged or installed media tools.
- `lib/iplayer.cjs` adapts get_iplayer search, metadata and downloads using BBC PIDs.
- `lib/media.cjs` probes and prepares media without modifying source files.
- `lib/media-policy.cjs` owns geometry, source frame rate, quality floors and
  size estimates shared with the Pi policy. All four preparation choices retain
  progressive source cadence through 60 fps; interlaced 25 fps retains both
  fields as 50 progressive frames. Unsupported rates keep the source intact.
- `lib/portal.cjs` owns endpoint selection, authentication and resumable uploads.
- `lib/desktop-library.cjs` owns the bounded desktop iCloud/torrent IPC actions.
  It calls the existing authenticated Pi APIs; it does not load portal pages or
  admit renderer-supplied URLs, magnets or filesystem paths.
- `ui/cloud-library.js` and `ui/torrents.js` own the desktop library and search
  screens. `library-send.js` reuses Studio's destination form; `cloud-tools.js`
  owns native cloud settings, preview, matching, deletion and original recovery.
  `ui/activity.js` joins queued server work with local conversion journals so
  downloads are visible before a local file exists. Matching artwork nodes are
  retained as progress and selections change.
- `lib/queue.cjs` coordinates durable jobs and recovery.
- `lib/library-presence.cjs` matches current Pi file identities to BBC results.
- `lib/title-match.cjs` validates explicitly confirmed TMDB identities, separate
  from BBC download metadata; `ui/title-review.js` owns the pre-upload review.
- `lib/download-progress.cjs` labels audio, video and assembly stages.
- `lib/workspace.cjs` journals the move to the media folder outside OneDrive.
- `lib/media-cleanup.cjs` validates retained conversions before deleting only
  app-owned iPlayer originals.
- `lib/cloud-archive.cjs` owns Original/Optimised/Both cloud receipts, safe
  replacement of confirmed originals, and reuse of canonical archive metadata.
- `lib/working-cleanup.cjs` removes verified temporary portal-job media only
  from Studio-owned working directories after cloud and TV delivery.
- `lib/torrent-client.cjs` owns authenticated, bounded loopback Web API calls.
- `lib/torrent-runtime.cjs` owns the private qBittorrent profile, Windows private
  credentials, bundled Python/search plugin and bounded film/TV searches.
- `lib/torrent-media.cjs` checks Windows-safe relative paths and episode names.
- `lib/torrent-downloads.cjs` owns metadata inspection, selected-file priorities,
  space admission, durable completion/removal receipts and working-pack cleanup.
- `lib/companion-torrents.cjs` feeds selected files sequentially through existing
  Studio jobs under one durable portal job, retaining pack data until all files
  have confirmed delivery.
- `ui/` owns the desktop design and interaction, with no Node privileges.

Cookies are stored by Electron's isolated persistent portal session. PINs are never saved. Remote sign-in opens a separate sandboxed window without the Studio bridge. IPC accepts only the bundled Studio page. Download subprocess arguments never pass through cmd.exe or PowerShell.

Portal jobs archive the selected Original, Optimised or Both versions in
iCloud and clean temporary media after confirmed delivery. Imported user files
are never deleted. Closing Studio pauses work; reopening restores the queue.
Upload jobs stay bound to their selected device and use server-confirmed
offsets. A successful byte transfer is not publication: Studio waits for the
server's final completion state.

## Phases and acceptance

1. Application shell, persistent store and secure process/tool adapters.
2. Rich iPlayer search, metadata, artwork and selected downloads.
3. Preparation, live destinations, local/remote authentication and resumable uploads.
4. Desktop visual and interaction checks, failure/recovery tests and live smoke.
5. Windows installer, installation and installed-app verification.

Each phase is checked before handover. No Pi source changes are required when its existing API provides the needed contracts.

## Development

Run `npm ci`, then `npm start`. `npm test` exercises desktop owners; `npm run test:ui` exercises the actual Electron window. `npm run package` creates a per-user Windows installer under `dist/`.

`node scripts/verify-frame-rates.cjs <output-folder>` exercises the installed
Intel hardware with generated motion, retaining proofs for optional browser
and isolated Pi decoder checks. It compares decoded source/output frame counts,
checks all preparation choices, fractional rates and interlacing, and never
touches a library or cloud copy. `verify-frame-rate-browser.cjs` checks actual
moving video and seeking in WebKit/Chromium; Windows WebKit does not expose
decoded-frame counters, so canvas samples verify moving pictures independently.

Run `npm run bundle:tools` before packaging to copy the installed get_iplayer runtime and FFmpeg tools, together with license notices, into ignored build resources. No user get_iplayer settings, history or recordings are packaged.
It also runs `scripts/bundle-torrents.cjs`, which downloads checksum-pinned
qBittorrent 5.3.0, Python 3.14.10 and the reviewed Pirate Bay plugin, extracts
them without installing a public API or changing magnet associations, and
includes their license notices. A developer build needs 7-Zip installed.
End-user installations include these tools and need no separate Python setup.

After bundling, `npx electron scripts/verify-torrents.cjs` runs a separate
loopback-only transfer proof using generated video, a fresh encrypted profile,
restart recovery, actual optimisation and an isolated cloud/publication fixture.
It never contacts the Pi or downloads external media. Evidence stays under
`out/studio-torrent-proof/`; ordinary unit tests use fake API boundaries.

The development toolchain requires Node 22.12 or newer. On this computer use the bundled Node 24 runtime; the system npm launcher still invokes Node 20. Invoke npm's `npm-cli.js` with the newer Node executable when installing dependencies.

## Using Studio

Launch **MabelTV Studio** from the desktop or Start menu. It opens directly as a Windows app. The installer includes its media tools.

- **Add media:** choose or drop videos, select Mabel TV and a channel, or My TV and its film/series destination, then prepare and send. You can also prepare locally and send later from Completed.
- **BBC iPlayer:** search a programme name or paste an episode link/PID, review artwork and programme details, select episodes, and add them to the queue. The search catalogue mainly covers recent broadcasts; an episode link can find programmes outside it.
- **Queue:** follow downloading, preparation, sending and publication. Pause, resume or retry individual items. Closing the installed window keeps Studio in the notification area; **Quit Studio and pause work** pauses it explicitly.
- **iCloud library:** browse poster cards, filter Films/TV/Kids, search, sort
  by title, stored size or release year, select episodes or multiple titles and
  send them through the normal destination form. The gear opens Studio's own
  matching, original recovery, optimisation and deletion actions. Replacement
  previews retain frozen file identities; destructive choices need explicit
  confirmation. Separate TV copies are preserved by cloud deletion.
- **Find anything:** Enter starts a search. Choose a result, wait for its file
  list, select the required videos/seasons and choose My TV, Mabel TV or iCloud.
  Search and inspection show moving indicators; the clear cross discards stale
  results. No media downloads until the destination is confirmed.
- These desktop sections use the same Studio window, sidebar, typography,
  cards and forms as Add media/iPlayer. They contain no portal window, iframe
  or webview. Search/queue state stays in Studio when switching sections.
- **My TV title check:** before sending a film, choose and confirm its title,
  year and poster. Edit the search or optional year to correct the match. For
  TV series, confirm the show once for the selected episodes; your chosen
  destination and series number are retained. This works for iPlayer, imported
  files and videos prepared locally then sent later. Cancel keeps the selection
  without queuing it; **Skip matching** allows uploading and playing normally.
- A confirmed match is applied through the Pi's existing metadata API after
  publication, using the server's published filename and the same device.
  The queue distinguishes **Adding metadata** from sending the video. If
  metadata is unavailable, Completed shows **Retry metadata**. It retries only
  enrichment, including after restarting Studio or deleting the laptop copy.
  Existing completed items remain unchanged; their portal matches are retained.
- **Settings:** automatic connection prefers the local portal, then the public portal. Remote sign-in uses the usual Cloudflare Access email/code window. Sign in again when that session expires. A portal PIN is entered separately if required.

Studio-created media lives in `C:\Users\danco\Videos\MabelTV Studio` on this computer, outside OneDrive. New item folders use a readable title and short unique ID, with `Original` download metadata and `Prepared/Mabel TV` or `Prepared/My TV` outputs. Existing app-owned media is migrated from the original AppData location with recoverable journal updates.

For iPlayer items, a downloaded original is removed only after its separate prepared copy passes compatibility validation. A download that needs no conversion remains as the single retained copy. Imported source files are never moved or deleted. **Completed → Open media folder** opens the folder for periodic manual cleanup; no retained media is automatically removed after publication.

Search results are checked against authenticated `GET /api/iplayer/library`. The Pi reads the BBC ID and show/episode tags from files currently in its libraries, using bounded MP4 atom reads that skip video data. Deleted files, staging files and recycle-bin contents never establish presence. A conservative show/series/episode match supports different BBC broadcast IDs and untagged legacy names. Unknown/offline presence is labelled explicitly. Studio rechecks on search, entering the view, returning focus, completed uploads and every 30 seconds while visible; **Check TV library** forces a fresh check. Completed queue history does not prevent downloading an episode again after it was removed.

The previous PowerShell preparation tool remains available in `tools/media-prep` as a fallback. Studio 1.1 adds a current-file inventory endpoint to the Pi; its backend release uses the guarded atomic installer with `--preserve-player`. See `VALIDATION.md` for the tested release boundary.

## Portal companion (1.3)

`lib/companion.cjs` owns heartbeat, claims and iPlayer requests. `lib/companion-jobs.cjs` adapts remote jobs to the existing durable queue; `lib/cloud-files.cjs` hydrates a single selected original through iCloud for Windows and confirms cloud writes through the Pi. `lib/subtitles.cjs` transfers text subtitles to confirmed publications and removes only app-owned optimised copies when requested.

Installed Studio starts at Windows sign-in and continues in the notification area after closing its window. Quit explicitly pauses work. Test profiles never register login items; companion tests opt in explicitly. Remote jobs retain the original, reuse saved upload IDs, and report stage progress through the same desktop queue. Imported originals and iCloud originals are never removed by the retention choice. iCloud root defaults to the user's iCloudDrive folder; processing stays outside the sync folder until a cloud copy is explicitly requested.
