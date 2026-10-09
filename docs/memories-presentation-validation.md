# Memories presentation refinement, 4 October 2026

## Delivered behaviour

- One shared, pure composition planner creates solo, duet, panoramic, triptych,
  feature and four-photo gallery scenes. It preserves each asset once per pass,
  never groups across a video, and gives larger compositions more viewing time.
- Both renderers fit the whole photograph, with staggered entrances, slow
  movement, sliding transitions and dissolves. The outgoing composition keeps
  its last position. Device layouts adapt to portrait screens; pausing freezes
  animations as well as the photo clock.
- Videos retain their own sound. Background music fades around videos, resumes
  at its previous position and also resumes when moving from a paused photo.
- Channel Play Memories opens the usual TV/device destination sheet. Playback
  Settings lives in that sheet. The separate gallery play toolbar is removed.
- Native family playback owns both OK press and release and cancels child hold
  timers. Delayed My TV return cannot resume the previous film during memories.
  An explicit new programme waits for decoder release and transfers once.
  Native presentation controls are hidden during playback and appear on pause.

## Evidence

The source manifest in the deployment work directory records the complete
uncommitted tree and file hashes. This pass did not change the database schema,
original/prepared media, playback encoding or stored library membership.

- Architecture checks and whitespace checks passed.
- Core browser gate: 89 passed, 19 existing conditional skips, iPhone WebKit
  and Chromium. Nine affected device/visual cases passed across iPhone WebKit,
  iPad WebKit and Chromium. Actual family photos were used for compositor review.
- The Pi core controller, native UI, JavaScript syntax, worker, Matter socket
  and libmpv smoke groups passed. The complete Library/Python group passed
  after its source-location assertions followed the extracted resume owner.
- Family native tests exercise paused music/video transitions, standby, Back,
  OK release ownership, background-resume exclusion and explicit handoff.
  OpenGL tests run on a virtual X display without opening HDMI. Four-photo
  compositions preserve whole photos and remain inside the 1080p display.
- Review captures are in `work/memories-presentation` and browser
  `test-results/family-layout`. Real physical TV acceptance remains with the
  owner: no live presentation was started because the TV must remain off.

## Deployment

Use the coordinated prebuilt atomic release, with an isolated CEC standby
guard. That guard is tested without a CEC device before use. The activation
helper checks actual TV power through the real CEC client before and after the
switch. The read-only verifier checks source/binary hashes, previous release,
online-backup integrity, existing viewing history, service restart counters,
watchdogs, HTTP, temperature and throttling. The shell release is 282.
