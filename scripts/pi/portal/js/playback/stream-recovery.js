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

function bindIosStreamRecovery(video, payload, generation, error, startup = null) {
  let recovering = false; let attempts = 0; let wasPlaying = !video.paused
  let readyReported = false; let playingReported = false
  let recoveryPosition = null
  const current = () => generation === iosPlayerGeneration && !$('#iosWatchPlayer').classList.contains('hidden')
  function waiting() {
    clearTimeout(video._iosStartupTimer)
    video._iosStartupTimer = setTimeout(() => {
      if (!current()) return
      recovering = false
      startup?.mark('waiting', video); startup?.flush()
      error.textContent = 'The video is taking longer than expected. You can retry playback.'
      error.classList.remove('hidden'); $('#iosWatchRetry').classList.remove('hidden')
    }, 15000)
  }
  function ready() {
    if (!current()) return
    if (!readyReported) { readyReported = true; startup?.mark('can-play', video) }
    clearTimeout(video._iosStartupTimer)
    error.classList.add('hidden'); $('#iosWatchRetry').classList.add('hidden')
  }
  waiting()
  async function recover() {
    if (!current() || recovering) return
    recovering = true
    waiting()
    const state = video._myTvProgress
    const position = state?.ready ? Number(video.currentTime) || 0
      : recoveryPosition ?? state?.latest?.position ?? (Number(video.currentTime) || 0)
    recoveryPosition = position
    const paused = !wasPlaying
    void saveIosRemotePosition(false, true)
    if (video._myTvProgress) video._myTvProgress.ready = false
    error.textContent = 'Reconnecting video…'; error.classList.remove('hidden')
    try {
      const result = await startRemoteStream({ ...payload, position })
      if (!current()) {
        void playbackRequest('/api/remote/release', { stream: new URL(result.stream_url, location.origin).searchParams.get('stream') }).catch(() => {})
        return
      }
      iosRemoteSession = new URL(result.stream_url, location.origin).searchParams.get('stream')
      video.onloadedmetadata = () => {
        if (!current()) return
        if (position > 0 && position < video.duration - 5) video.currentTime = position
        if (video._myTvProgress) video._myTvProgress.ready = true
        recovering = false
        error.classList.add('hidden'); $('#iosWatchRetry').classList.add('hidden')
        if (!paused) void video.play().catch(() => {})
      }
      video.querySelectorAll('track').forEach(track => { if (result.subtitle_url) track.src = result.subtitle_url })
      video.classList.remove('hidden'); video.src = result.stream_url; video.load()
      if (!paused) void video.play().catch(() => {})
    } catch (failure) {
      if (!current()) return
      recovering = false
      error.textContent = failure.message; $('#iosWatchRetry').classList.remove('hidden')
    }
  }
  video.onplaying = () => {
    wasPlaying = true; attempts = 0; ready()
    if (!playingReported) { playingReported = true; startup?.mark('playing', video); startup?.flush() }
  }
  $('#iosWatchRetry').onclick = () => { attempts = 0; wasPlaying = true; void recover() }
  return {
    onReady: ready,
    onPause: () => { if (!recovering && !video.error) wasPlaying = false },
    onError: () => {
      if (!current()) return
      startup?.mark('media-error', video); startup?.flush()
      recovering = false
      if (['my_tv', 'my-tv-series'].includes(payload.kind) && attempts++ < 1) { void recover(); return }
      setNativeVideoBackdrop(false)
      error.textContent = `This video could not be played (media error ${video.error?.code || 'unknown'}).`
      error.classList.remove('hidden'); $('#iosWatchRetry').classList.remove('hidden')
      failMabelQueueDevice(video, error.textContent)
    },
    heartbeat: async () => {
      if (!current() || !iosRemoteSession || recovering) return
      try { await playbackRequest('/api/remote/heartbeat', { stream: iosRemoteSession }) }
      catch (failure) {
        // A server restart/expired token needs a fresh source, while a brief
        // network outage should leave already-buffered playback undisturbed.
        if (failure.status === 400 && attempts++ < 1) await recover()
      }
    },
  }
}
