# Remote resume error and Intel playback check — 4 November 2026

Status: read-only investigation and future build requirements. No application
changes, deployment, service restart or playback/control command was performed.

## Owner's report

Dan returned to the installed portal while already on Remote, watching the TV
preview. He saw "Load failed" near the top and briefly could not interact as
expected. This was a foreground/resume report, not a report of the film pausing.
He also asked for a live frame-drop check of the Intel Compact Infinity War copy.

## Native playback result

- Confirmed the exact playing file is `Compression tests/Avengers - Infinity
  War (2018) - Compact - Intel Quick Sync - 1080p.mp4`.
- Recorded fifteen thirty-second diagnostic samples from 05:56 to 06:03 UTC.
  The first interval overlaps playback startup and is not a steady-state FPS
  measurement. Subsequent rates were 23.83–24.00 fps for the 23.976 fps source.
- Decoder frame-drop count stayed at zero. Display frame drops rose from zero
  to five in the interval ending 05:57:14, then stayed at five through 06:03:14.
  That interval overlaps the screen-preview capture running 05:56:46–05:57:19.
  This is a correlation, not proof that preview capture caused the five drops.
- No accumulating audio/video drift was reported. Temperature was around
  55–58 C with `throttled=0x0`. A short sample measured native-player CPU at
  86% of one core and overall system CPU busy at 25.5%.
- Native, backend and tunnel services remained active without restarts; native
  PID stayed 193988. The test did not inspect the physical HDMI picture.

Conclusion: steady playback with a small isolated display-drop event, no decoder
drops and no ongoing drop accumulation during the observed interval. Do not
describe this as zero dropped frames or a full-film smoothness guarantee.

Follow-up: the counter reached six display drops at 06:03:44 and remained six
through 06:04:44, with decoder drops still zero and render rate near 24 fps.
The TV subsequently reported standby. Services retained their original PIDs
and zero restarts. The combined observation covers roughly nine minutes;
five drops were clustered, with one later isolated drop.

## Portal evidence and limits

The deployed release remained `0.2.5-20261103181119`. Normalised hashes of the
investigated foundation, navigation, load, title, home, gesture and HTTP owners
matched the local source. Studio assets elsewhere still require the live/local
reconciliation already recorded in the main build plan.

- Around 05:58:57–05:59:11, Cloudflare tunnel logs recorded aborted My TV home,
  explore and title requests: `Incoming request ended abruptly: context canceled`.
  These are contemporaneous cancellations; they do **not** identify a failed
  Remote status request or prove which request produced Dan's message. Switching
  away from the app to report an incident can itself cancel outstanding work.
- The backend had no unexpected-error entries in the inspected window. Direct
  origin reads measured about 119 ms for `/api/status` and 17 ms for bootstrap.
  No backend restart or sustained resource exhaustion coincided with this check.
- Yesterday's logs also include origin connection refusals at 18:12:32–34,
  immediately before the backend's 18:12:36 release start. That explains one
  separate brief deployment window, not all reported incidents or today's one.
- The common `api()` in `portal/js/core/foundation.js` awaits raw fetch without
  request-context logging, a defined timeout or bounded transport retry.
  `showError()` displays an exception's message directly. No retained per-phone
  breadcrumb identifies the request/action behind a particular top notice.
  Backend normal access logging is disabled in `http.py`.

The exact transport trigger for this phone's incident and the extent of the
reported UI stall remain unproven. Do not label this a general Pi outage, a
confirmed Wi-Fi fault, or a video-encoding problem.

## Confirmed Remote handling defect

`core/live.js` polls `/api/live` every 2.5 seconds. A single rejected poll calls
`renderLiveTv({ available: false, reason: error.message })`, discarding the last
known playing state. This can put raw "Load failed" into the preview error,
show TV offline/unavailable and disable Play/Pause until a later poll succeeds.
There is no Remote-specific foreground lifecycle that replaces stale requests
and explicitly reconnects when the app becomes visible again.

A WebKit browser reproduction replayed the captured live UI in the isolated
local fixture, failed one GET `/api/live`, then restored successful responses:

- Preview message became `Load failed`, feedback became `TV offline`, and the
  visible Play and Pause buttons became disabled.
- State recovered on the next successful poll. Other navigation/control buttons
  stayed enabled; this did not reproduce an entire-browser/main-thread freeze.
- The global `#notice` remained empty. This reproduction therefore confirms a
  Remote failure-handling problem, not the precise source of a separate global
  notice if that was what Dan saw.
- One focused iPhone WebKit scenario passed. An unrelated fixture warning about
  its missing playlists stub was not classified as a production defect.

Test source: `out/studio-ux-audit-20261103/cases/remote-load-failure.spec.mjs`.
Sanitised live evidence and reproduction state/screenshot:
`out/live-playback-portal-check-20261104/`.

## Requirements added to the application build

1. Preserve the last known TV state during a transient poll failure and show a
   concise reconnecting state. A failed request does not establish that the TV
   is off. Define which controls remain usable and ensure recovery clears stale
   loading/disabled state.
2. Give Remote preview/status work an explicit foreground/background lifecycle,
   bounded in-flight ownership and a fresh read on resume. Ignore obsolete
   responses and expected cancellation; do not replay power/playback commands.
3. Add bounded, protected diagnostics that correlate time, visible route, action,
   endpoint/method, duration, error type, visibility/online state and request ID.
   Redact tokens, PINs, credentials, source magnets and private query payloads.
4. Define timeout and bounded retry rules for appropriate read requests. Preserve
   displayed content and navigation through transient failures; keep auth errors
   distinct and never blindly retry a state-changing command.
5. Validate warm resume, suspension, stale requests, one failed poll, slow network,
   offline/reconnect and stale-session cases in isolation, then on the actual
   installed iPhone PWA. Check the reported global notice and temporary UI stall
   separately from the reproduced Remote offline state.

These are nonvisual shared reliability corrections alongside the saved Studio
build, not authorization to deploy them during the current film playback.
