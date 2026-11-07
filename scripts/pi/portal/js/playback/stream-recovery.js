'use strict'

function traceMediaStartup() {
  const started = performance.now()
  const requestId = crypto.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  let events = []
  return {
    mark(phase, video = null) {
      events.push({ path: '/api/remote/media', method: 'MEDIA', requestId,
        code: phase + (video ? `-r${video.readyState}-n${video.networkState}` : ''),
        duration: Math.round(performance.now() - started),
        route: location.hash.split('?')[0], visible: document.visibilityState, online: navigator.onLine })
      if (events.length > 10) events.shift()
    },
    flush() {
      if (!events.length) return
      const batch = events; events = []
      // No diagnostic request competes with initial video loading. Send the
      // bounded phase timings only after playback starts or a wait/error.
      void fetch('/api/studio/diagnostics', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(5000) }).catch(() => {})
    },
  }
}

function bindIosStreamRecovery(video, payload, generation, error, startup = null, options = {}) {
  const retry = $('#iosWatchRetry')
  let phase = 'starting', attempts = 0, wantsPlayback = true, disposed = false
  let operation = 0, playAttempt = 0, pausedAt = 0, lastContact = Date.now()
  let position = Number(options.position) || 0, sourceReady = false, heartbeatPending = false
  let readyReported = false, playingReported = false, waitKind = ''
  const current = () => !disposed && generation === iosPlayerGeneration && !$('#iosWatchPlayer').classList.contains('hidden')
  const loading = () => phase === 'renewing' || phase === 'loading'
  const clearWait = () => { clearTimeout(video._iosStartupTimer); video._iosStartupTimer = null; waitKind = '' }
  function capturePosition() {
    if (!loading() && !video.error && Number.isFinite(video.currentTime)
        && (sourceReady || video._myTvProgress?.ready)) position = Math.max(0, video.currentTime)
    return position
  }
  function hideMessage() { error.classList.add('hidden'); retry.classList.add('hidden'); retry.disabled = false }
  function showMessage(message, label = 'Retry playback', busy = false) {
    error.textContent = message; error.classList.remove('hidden')
    retry.textContent = label; retry.disabled = busy; retry.classList.remove('hidden')
  }
  function exposeControls() {
    setNativeVideoBackdrop(false)
    video.controls = true; video.style.pointerEvents = ''
    // A failed AVKit presentation can hide the portal's recovery control.
    if (video.webkitDisplayingFullscreen) { try { video.webkitExitFullscreen?.() } catch (_) {} }
  }
  function waiting(delay = 15000, reconnect = false) {
    if (reconnect && waitKind === 'stall') return
    clearWait()
    waitKind = reconnect ? 'stall' : 'startup'
    video._iosStartupTimer = setTimeout(() => {
      video._iosStartupTimer = null; waitKind = ''
      if (!current() || phase === 'paused' || phase === 'tap') return
      startup?.mark('waiting', video); startup?.flush()
      if (reconnect && !loading() && !payload.queue_id && attempts++ < 1) { void recover(); return }
      // A timeout retires this attempt. A late response cannot replace a retry.
      operation++; playAttempt++; phase = 'failed'
      exposeControls()
      showMessage('The video is taking longer than expected. You can retry playback.')
    }, delay)
  }
  function playFailed(failure, id = playAttempt) {
    if (!current() || id !== playAttempt || phase === 'playing') return
    if (failure?.name === 'AbortError' && loading()) return
    clearWait()
    startup?.mark(failure?.name === 'NotAllowedError' ? 'resume-tap-needed' : 'resume-failed', video); startup?.flush()
    exposeControls()
    if (failure?.name === 'NotAllowedError') {
      phase = 'tap'
      showMessage('Ready to continue.', 'Resume playback')
    } else {
      phase = 'failed'
      showMessage('Playback could not resume. Reconnect and try again.')
    }
  }
  function play(fromTap = false) {
    const id = ++playAttempt
    wantsPlayback = true
    if (fromTap) { phase = sourceReady ? 'resuming' : 'loading'; waiting() }
    // This call must stay synchronous with the Resume button's tap. No fetch,
    // metadata wait or promise is allowed to consume WebKit's user gesture.
    try {
      const attempt = video.play()
      if (fromTap) options.present?.(true)
      return Promise.resolve(attempt).then(() => true, failure => { playFailed(failure, id); return false })
    } catch (failure) { playFailed(failure, id); return Promise.resolve(false) }
  }
  async function recover() {
    if (!current() || loading()) return
    const savedPosition = capturePosition(), id = ++operation
    playAttempt++
    if (!video.error) void saveIosRemotePosition(false, true)
    if (video._myTvProgress) video._myTvProgress.ready = false
    phase = 'renewing'; sourceReady = false
    showMessage('Reconnecting video…', 'Reconnecting…', true)
    waiting()
    try {
      const result = await startRemoteStream({ ...payload, position: savedPosition })
      const session = new URL(result.stream_url, location.origin).searchParams.get('stream')
      if (!current() || id !== operation) {
        void playbackRequest('/api/remote/release', { stream: session }).catch(() => {})
        return
      }
      iosRemoteSession = session; lastContact = Date.now()
      options.renewed?.(result)
      if (video._mabelQueue) { video._mabelQueue.stream = session; video._mabelQueue.started = false }
      // Match the working close/reopen reset without losing the film, bookmark,
      // episode context or the player's navigation history.
      video.onloadedmetadata = null
      video.pause(); video.removeAttribute('src'); video.querySelectorAll('track').forEach(track => track.remove()); video.load()
      phase = 'loading'
      video.onloadedmetadata = () => {
        if (!current() || id !== operation) return
        if (savedPosition > 0 && savedPosition < video.duration - 0.1) video.currentTime = savedPosition
        position = savedPosition; sourceReady = true
        if (video._myTvProgress) video._myTvProgress.ready = true
        if (!wantsPlayback) { phase = 'paused'; pausedAt = Date.now(); clearWait(); hideMessage() }
        // Metadata is not playback. Keep the recovery control until playing or
        // an explicit Resume tap; never hide a rejected play() behind canplay.
      }
      video.classList.remove('hidden'); video.src = result.stream_url; video.load()
      if (wantsPlayback) play()
    } catch (failure) {
      if (!current() || id !== operation) return
      phase = 'failed'; clearWait(); exposeControls()
      showMessage(failure.message || 'Could not reconnect. Try again.')
    }
  }
  async function heartbeat() {
    if (!current() || !iosRemoteSession || loading() || heartbeatPending) return
    const session = iosRemoteSession
    heartbeatPending = true
    try { await playbackRequest('/api/remote/heartbeat', { stream: session }); lastContact = Date.now() }
    catch (failure) {
      if (!current() || session !== iosRemoteSession) return
      // A paused film may be prepared again, but must never start itself.
      if (failure.status === 400 && attempts++ < 1 && !payload.queue_id) {
        wantsPlayback = !video.paused && wantsPlayback
        await recover()
      }
    } finally { heartbeatPending = false }
  }
  const onReturn = () => {
    if (current() && document.visibilityState === 'visible' && Date.now() - lastContact > 60000) void heartbeat()
  }
  const onWait = () => { if (current() && wantsPlayback && !loading() && phase !== 'tap') waiting(8000, true) }
  const onTime = () => { if (current()) capturePosition() }
  video.addEventListener('waiting', onWait); video.addEventListener('stalled', onWait)
  video.addEventListener('timeupdate', onTime)
  document.addEventListener('visibilitychange', onReturn)
  window.addEventListener('pageshow', onReturn); window.addEventListener('online', onReturn)
  video.onplaying = () => {
    if (!current()) return
    phase = 'playing'; wantsPlayback = true; sourceReady = true; attempts = 0; pausedAt = 0
    capturePosition(); clearWait(); hideMessage()
    if (!playingReported) { playingReported = true; startup?.mark('playing', video); startup?.flush() }
  }
  retry.disabled = false; retry.textContent = 'Retry playback'
  retry.onclick = () => {
    if (!current() || loading()) return
    wantsPlayback = true; attempts = 0
    if (phase === 'tap' && !video.error) { play(true); return }
    void recover()
  }
  waiting()
  return {
    onReady: () => {
      if (!current()) return
      if (!readyReported) { readyReported = true; startup?.mark('can-play', video) }
      if (phase === 'starting') { sourceReady = true; clearWait(); hideMessage() }
    },
    onPlay: () => {
      if (!current()) return false
      wantsPlayback = true
      if (phase === 'paused' && Date.now() - pausedAt > 90000 && !payload.queue_id) { void recover(); return false }
      if (phase === 'paused' || phase === 'tap' || phase === 'failed') phase = 'resuming'
      if (!loading() && phase !== 'playing') waiting(8000, true)
      return true
    },
    onPause: () => {
      if (!current() || loading() || phase === 'tap' || video.error) return
      capturePosition(); wantsPlayback = false; phase = 'paused'; pausedAt = Date.now(); clearWait()
    },
    onError: () => {
      if (!current() || phase === 'renewing') return
      startup?.mark('media-error', video); startup?.flush()
      phase = 'failed'; clearWait()
      if (!payload.queue_id && attempts++ < 1) { void recover(); return }
      exposeControls()
      showMessage(`This video could not be played (media error ${video.error?.code || 'unknown'}).`)
    },
    startPlayback: play,
    heartbeat,
    dispose: () => {
      disposed = true; operation++; playAttempt++; clearWait()
      video.removeEventListener('waiting', onWait); video.removeEventListener('stalled', onWait)
      video.removeEventListener('timeupdate', onTime)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('pageshow', onReturn); window.removeEventListener('online', onReturn)
    },
  }
}
