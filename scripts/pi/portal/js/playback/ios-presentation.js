'use strict'

// One presentation owner per video. Native fullscreen owns its own controls;
// old inline-control timers must never recreate a second layer over AVKit.
function bindIosPresentation(video, generation) {
  let requested = false; let entered = false; let returned = false
  const current = () => generation === iosPlayerGeneration && !$('#iosWatchPlayer').classList.contains('hidden')
  const active = () => Boolean(video.webkitDisplayingFullscreen || video.webkitPresentationMode === 'fullscreen')
  const transition = () => {
    if (!current()) return
    const fullscreen = active()
    setNativeVideoBackdrop(fullscreen)
    if (fullscreen) {
      entered = true; requested = true
      video.controls = false; video.style.pointerEvents = 'none'
    } else if (entered) {
      returned = true; video.controls = true; video.style.pointerEvents = ''
      void saveIosRemotePosition(false, true)
    }
  }
  video.controls = true; video.style.pointerEvents = ''
  video.onwebkitbeginfullscreen = () => {
    if (!current()) return
    entered = true; requested = true
    setNativeVideoBackdrop(true); video.controls = false; video.style.pointerEvents = 'none'
  }
  video.onwebkitendfullscreen = () => {
    if (!current()) return
    entered = true; returned = true
    setNativeVideoBackdrop(false); video.controls = true; video.style.pointerEvents = ''
    void saveIosRemotePosition(false, true)
  }
  video.onwebkitpresentationmodechanged = transition
  return () => {
    if (!current() || returned || requested || active() || typeof video.webkitEnterFullscreen !== 'function') return
    try { video.webkitEnterFullscreen(); requested = true }
    catch (_) { /* Retry from metadata/play when WebKit accepts the same media. */ }
  }
}
