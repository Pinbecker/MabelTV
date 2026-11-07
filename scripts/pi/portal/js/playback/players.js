'use strict'

let mabelFilmArtCycleTimer = null
let iosPlayerHistoryActive = false
let iosPlayerReturnTo = null
let mabelPlayerReturnTo = null
let iosPlayerGeneration = 0
let iosNextEpisodeTimer = null
let mabelWatchPresentation = 'standard'

function clearIosNextEpisode() {
  clearInterval(iosNextEpisodeTimer)
  iosNextEpisodeTimer = null
  $('#iosWatchVideo')._myTvEpisode = null
  $('#iosWatchNext').classList.add('hidden')
  $('#iosWatchNextCancel').classList.add('hidden')
}

function prepareIosNextEpisode(payload) {
  if (payload.kind !== 'my-tv-series') return null
  const series = library?.my_tv_series?.find(value => value.id === payload.series)
  const ordered = [...(series?.episodes || [])].sort((a, b) =>
    Number(a.season) - Number(b.season) || Number(a.episode) - Number(b.episode))
  const index = ordered.findIndex(value => value.path === payload.file)
  if (index < 0) return null
  const state = { series, episode: ordered[index], next: ordered[index + 1],
    generation: iosPlayerGeneration, ended: false, busy: false }
  $('#iosWatchVideo')._myTvEpisode = state
  $('#iosWatchContext').textContent = `${series.title} · Series ${state.episode.season}, Episode ${state.episode.episode}`
  if (state.next) {
    $('#iosWatchNextTitle').textContent = state.next.display_name
    $('#iosWatchNextContext').textContent = `Series ${state.next.season}, Episode ${state.next.episode}`
    $('#iosWatchNextHint').textContent = 'Up next'
    $('#iosWatchNextPlay span').textContent = state.next.browser_ready === false
      ? 'Play in VLC' : 'Next episode'
    $('#iosWatchNextPlay').disabled = false
    $('#iosWatchNext').classList.remove('hidden')
  }
  return state
}

async function playNextIosEpisode() {
  const video = $('#iosWatchVideo'); const state = video._myTvEpisode
  if (!state?.next || state.busy || state.generation !== iosPlayerGeneration) return
  clearInterval(iosNextEpisodeTimer); iosNextEpisodeTimer = null
  state.busy = true
  $('#iosWatchNextPlay').disabled = true
  $('#iosWatchNextHint').textContent = 'Preparing next episode…'
  const saved = await saveIosRemotePosition(state.ended, true)
  if (video._myTvEpisode !== state || state.generation !== iosPlayerGeneration) return
  if (!saved) {
    state.busy = false
    $('#iosWatchNextPlay').disabled = false
    $('#iosWatchNextHint').textContent = 'Could not save your progress. Tap to try again.'
    return
  }
  const payload = { kind: 'my-tv-series', series: state.series.id,
    file: state.next.path, position: 0 }
  if (state.next.browser_ready === false) {
    state.busy = false
    $('#iosWatchNextPlay').disabled = false
    $('#iosWatchNextHint').textContent = 'This episode opens in VLC'
    void openInVlc(payload, state.next.display_name)
    return
  }
  const returnTo = selectedMyTvEpisode?.returnTo || null
  iosPlayerReturnTo = () => openMyTvEpisodeSheet(state.series, state.next, returnTo)
  await startIosRemotePlayer(payload, 0)
}

async function finishIosSeriesEpisode(state) {
  const video = $('#iosWatchVideo')
  if (video._myTvEpisode !== state || state.ended) return
  state.ended = true
  const saved = await saveIosRemotePosition(true, true)
  if (video._myTvEpisode !== state || state.generation !== iosPlayerGeneration) return
  if (saved) {
    Object.assign(state.episode, { watched: true, remote_position: 0,
      remote_duration: Number(video.duration) || 0, remote_last_watched: Date.now() / 1000 })
  }
  // Apple's fullscreen controls cannot host our Next episode action. Return
  // to the portal player at the end, where the countdown can be cancelled.
  try { video.webkitExitFullscreen?.() } catch (_) { /* already inline */ }
  setNativeVideoBackdrop(false)
  if (!state.next) {
    $('#iosWatchContext').textContent = `${state.series.title} · Last episode finished`
    return
  }
  if (!saved || state.next.browser_ready === false) {
    $('#iosWatchNextHint').textContent = saved
      ? 'Next episode is ready in VLC' : 'Could not save your progress. Tap to try again.'
    return
  }
  let remaining = 8
  const deadline = Date.now() + remaining * 1000
  const hint = $('#iosWatchNextHint')
  hint.textContent = `Next episode starts in ${remaining}s`
  $('#iosWatchNextCancel').classList.remove('hidden')
  clearInterval(iosNextEpisodeTimer)
  iosNextEpisodeTimer = setInterval(() => {
    if (video._myTvEpisode !== state || state.generation !== iosPlayerGeneration) {
      clearInterval(iosNextEpisodeTimer); iosNextEpisodeTimer = null
      return
    }
    remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    hint.textContent = `Next episode starts in ${remaining}s`
    if (remaining <= 0) void playNextIosEpisode()
  }, 1000)
}

$('#iosWatchNextPlay').onclick = () => { void playNextIosEpisode() }
$('#iosWatchNextCancel').onclick = () => {
  clearInterval(iosNextEpisodeTimer); iosNextEpisodeTimer = null
  $('#iosWatchNextHint').textContent = 'Next episode is ready when you are'
  $('#iosWatchNextCancel').classList.add('hidden')
}

function openIosPlayerHistoryLayer() {
  if (iosPlayerHistoryActive) return
  const state = { ...(history.state || {}), mabelIosPlayer: true }
  history.pushState(state, '', location.href)
  iosPlayerHistoryActive = true
}

function startMabelFilmArtCycle() {
      clearInterval(mabelFilmArtCycleTimer)
      const headers = Array.from(document.querySelectorAll('.mabel-film-head[data-film-art]'))
      if (!headers.some(header => header._mabelFilmArtworks?.length > 1)) {
        mabelFilmArtCycleTimer = null
        return
      }
      mabelFilmArtCycleTimer = setInterval(() => {
        headers.forEach(header => {
          const artworks = header._mabelFilmArtworks || []
          if (!header.isConnected || artworks.length < 2) return
          header._mabelFilmArtIndex = (Number(header._mabelFilmArtIndex) + 1) % artworks.length
          const layers = header.querySelectorAll('.mabel-film-head-art-layer')
          const current = header._mabelFilmArtLayer === 1 ? 1 : 0
          const next = current === 0 ? 1 : 0
          layers[next].style.backgroundImage = `url('/api/channel/artwork/${encodeURIComponent(artworks[header._mabelFilmArtIndex])}')`
          layers[next].classList.add('is-visible')
          layers[current].classList.remove('is-visible')
          header._mabelFilmArtLayer = next
        })
      }, 12000)
    }

function remoteTime(value) {
      const seconds = Math.max(0, Math.floor(Number(value) || 0))
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    }

    function artworkUrl(name, retry = '') {
      const base = `/api/my-tv/artwork/${encodeURIComponent(name)}`
      return retry ? `${base}?retry=${encodeURIComponent(retry)}` : base
    }

    function posterImage(name, fallback) {
      const image = document.createElement('img')
      image.loading = 'lazy'
      image.decoding = 'async'
      let retried = false
      image.src = artworkUrl(name)
      image.alt = ''
      image.loading = 'lazy'
      image.decoding = 'async'
      image.onerror = () => {
        if (!retried) {
          retried = true
          image.src = artworkUrl(name, Date.now())
          return
        }
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = fallback
        image.replaceWith(placeholder)
      }
      return image
    }

    function playerUrl(payload, position = null) {
      const query = new URLSearchParams({ ...payload,
        ...(position == null ? {} : { position: String(Math.max(0, Number(position) || 0)) }) })
      return `/watch/player?${query}`
    }

    function saveIosRemotePosition(finished = false, force = false) {
      const video = $('#iosWatchVideo')
      if (video.error) return Promise.resolve(false)
      if (video._myTvProgress) return myTvProgress.checkpoint(video, finished || video.ended, force)
      if (!iosRemoteSession || !Number.isFinite(video.currentTime) || (!finished && !force && Math.abs(video.currentTime - iosRemoteLastSaved) < 10)) return Promise.resolve(false)
      const session = iosRemoteSession
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const position = finished && duration > 0 ? duration : video.currentTime
      return api('/api/remote/position', { method: 'POST', body: JSON.stringify({ stream: session, position, duration }) })
        .then(() => { if (session === iosRemoteSession) iosRemoteLastSaved = position; return true }).catch(() => false)
    }

    function beaconIosRemotePosition() {
      const video = $('#iosWatchVideo')
      if (video.error) return
      if (video._myTvProgress) { myTvProgress.beacon(video); return }
      if (!iosRemoteSession || !Number.isFinite(video.currentTime) || !navigator.sendBeacon) return
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      navigator.sendBeacon('/api/remote/position', new Blob([
        JSON.stringify({ stream: iosRemoteSession, position: video.currentTime, duration }),
      ], { type: 'application/json' }))
    }

    function closeIosRemotePlayer({ fromHistory = false } = {}) {
      if (!fromHistory && iosPlayerHistoryActive && history.state?.mabelIosPlayer) {
        history.back()
        return
      }
      iosPlayerHistoryActive = false
      const returnTo = iosPlayerReturnTo
      iosPlayerReturnTo = null
      const video = $('#iosWatchVideo')
      const session = iosRemoteSession
      const myTvPlayer = $('#iosWatchPlayer').classList.contains('is-my-tv')
      const saved = saveIosRemotePosition(false, true)
      video._iosStreamRecovery?.dispose(); video._iosStreamRecovery = null
      video._myTvProgress = null
      iosPlayerGeneration += 1
      clearTimeout(video._iosStartupTimer)
      clearIosNextEpisode()
      clearInterval(iosRemotePositionTimer); clearInterval(iosRemoteHeartbeatTimer)
      iosRemotePositionTimer = null; iosRemoteHeartbeatTimer = null; iosRemoteSession = null
      iosOfflineDownloadId = null
      video._mabelQueue = null
      video.style.pointerEvents = ''; video.controls = true
      video.pause(); video.removeAttribute('src'); video.replaceChildren(); video.load()
        $('#iosWatchPlayer').classList.add('hidden')
        document.documentElement.classList.remove('native-video-fullscreen')
        unlockPortalPlayerScroll()
        if (returnTo) queueMicrotask(returnTo)
      saved.finally(() => {
        if (session) return api('/api/remote/release', { method: 'POST', body: JSON.stringify({ stream: session }) }).catch(() => {})
      }).finally(() => load().then(() => {
        if (myTvPlayer) renderMyTvHomeContinue()
      }).catch(() => {}))
    }

    function setNativeVideoBackdrop(active) {
      document.documentElement.classList.toggle('native-video-fullscreen', active)
    }

    async function startIosRemotePlayer(payload, position = null) {
      const shell = $('#iosWatchPlayer'); const video = $('#iosWatchVideo'); const error = $('#iosWatchError')
      const startup = traceMediaStartup()
      void saveIosRemotePosition(false, true)
      video._iosStreamRecovery?.dispose(); video._iosStreamRecovery = null
      video._myTvProgress = null
      const previousSession = iosRemoteSession
      iosRemoteSession = null; iosOfflineDownloadId = null
      if (previousSession) void playbackRequest('/api/remote/release', { stream: previousSession }).catch(() => {})
      video.onpause = null; video.onseeked = null; video.onloadedmetadata = null
      video.oncanplay = null; video.onerror = null; video.onplay = null; video.onended = null
      video.pause()
      if (position != null && payload.position == null) payload = { ...payload, position }
      const localCheckpoint = ['my_tv', 'my-tv-series'].includes(payload.kind) && payload.position == null
        ? myTvProgress.read(payload).catch(() => null) : Promise.resolve(null)
      const generation = ++iosPlayerGeneration
      clearIosNextEpisode()
      shell.classList.toggle('is-my-tv', ['my_tv', 'my-tv-series'].includes(payload.kind))
      clearInterval(iosRemotePositionTimer); clearInterval(iosRemoteHeartbeatTimer)
      shell.classList.remove('hidden'); error.classList.add('hidden'); video.classList.remove('hidden')
      $('#iosWatchProgressStatus').classList.add('hidden')
      $('#iosWatchRetry').classList.add('hidden')
      $('#iosWatchContext').textContent = 'Opening video…'
      openIosPlayerHistoryLayer()
      // The fixed-body scroll lock causes incorrect touch coordinates in
      // installed iOS web apps after AVKit changes the viewport. The player
      // shell is already fixed, so overflow locking is sufficient here.
      lockPortalPlayerScroll(false)
      try {
        let result
        result = await startRemoteStream(payload)
        startup.mark('session-ready')
        if (generation !== iosPlayerGeneration) {
          const stream = new URL(result.stream_url, location.origin).searchParams.get('stream')
          void api('/api/remote/release', { method: 'POST', body: JSON.stringify({ stream }) }).catch(() => {})
          return
        }
        video.onpause = null; video.onplaying = null; video.onended = null
        video._mabelQueue = null
        iosRemoteSession = new URL(result.stream_url, location.origin).searchParams.get('stream')
        $('#iosWatchContext').textContent = result.kind === 'usb' ? 'Playing directly from USB' : `${tvName()} remote viewing`
        if (payload.kind === 'my_tv') $('#iosWatchContext').textContent = 'My TV · Playing on this device'
        video.pause(); video.removeAttribute('src'); video.replaceChildren()
        let captionsAttached = false, captionsVisible = false
        const attachNativeCaptions = () => {
          recovery.onReady()
          if (!result.subtitle_url || captionsAttached) return
          captionsAttached = true
          const track = document.createElement('track')
          // Register the choice with AVPlayer but leave it off initially. The
          // previous forced `mode = showing` displayed captions while Apple's
          // own selector still reported Off.
          track.kind = 'subtitles'; track.srclang = 'en'; track.label = 'English'; track.src = result.subtitle_url; track.default = false
          video.append(track)
          if (captionsVisible) track.track.mode = 'showing'
        }
        let resume = Number(payload.position ?? result.resume_position ?? 0)
        if (shell.classList.contains('is-my-tv')) {
          const local = await localCheckpoint
          startup.mark('resume-ready')
          if (generation !== iosPlayerGeneration) return
          if (payload.position == null && local?.pending && local.observed_at > (result.resume_updated || 0))
            resume = local.finished ? 0 : local.position
          myTvProgress.begin(video, { ...payload, library_id: result.library_id }, result.server_time)
        }
        const requestNativeFullscreen = bindIosPresentation(video, generation)
        $('#iosWatchTitle').textContent = result.title
        const episodeState = prepareIosNextEpisode(payload)
        video.onloadedmetadata = () => {
          if (generation !== iosPlayerGeneration) return
          startup.mark('metadata', video)
          if (resume > 0 && resume < video.duration - 5) video.currentTime = resume
          if (video._myTvProgress) video._myTvProgress.ready = true
          if (payload.position === 0) void saveIosRemotePosition(false, true)
          requestNativeFullscreen()
        }
        // Do not involve the external VTT in initial source negotiation. MyTv
        // MP4s previously failed with MEDIA_ERR_SRC_NOT_SUPPORTED when iPadOS
        // received the video and text track together. Once canplay fires, the
        // movie is already accepted and the native AVPlayer can safely add CC.
        video.oncanplay = attachNativeCaptions
        const recovery = bindIosStreamRecovery(video, payload, generation, error, startup, {
          position: resume, present: requestNativeFullscreen,
          renewed: next => {
            captionsVisible = [...video.textTracks].some(track => track.mode === 'showing')
            result = next; captionsAttached = false
          },
        })
        video._iosStreamRecovery = recovery
        video.onerror = recovery.onError
        // Ask for the true native player immediately from the library tap and
        // retry only once the media becomes ready. This avoids the old inline
        // hand-off before the Liquid Glass player opens.
        video.onplay = () => {
          if (!recovery.onPlay()) return
          if (episodeState?.ended && !video.ended) {
            episodeState.ended = false
            clearInterval(iosNextEpisodeTimer); iosNextEpisodeTimer = null
            $('#iosWatchNextCancel').classList.add('hidden')
            $('#iosWatchNextHint').textContent = 'Up next'
          }
          requestNativeFullscreen()
        }
        if (payload.kind === 'channel')
          bindMabelQueuePlayer(video, payload, result, next => startIosRemotePlayer(next, 0))
        video.onpause = () => { recovery.onPause(); return saveIosRemotePosition(false, true) }
        video.onseeked = () => saveIosRemotePosition(false, true)
        video.onended = () => episodeState ? finishIosSeriesEpisode(episodeState)
          : saveIosRemotePosition(true).then(() => finishMabelQueueDevice(video))
        $('#iosWatchStartOver').classList.toggle('hidden', resume <= 10)
        iosRemoteLastSaved = 0
        clearInterval(iosRemotePositionTimer); iosRemotePositionTimer = setInterval(saveIosRemotePosition, 5000)
        clearInterval(iosRemoteHeartbeatTimer); iosRemoteHeartbeatTimer = setInterval(recovery.heartbeat, 30000)
        video.src = result.stream_url
        startup.mark('source-set', video)
        video.load()
        const playAttempt = recovery.startPlayback()
        requestNativeFullscreen()
        await playAttempt
      } catch (startError) {
        if (generation !== iosPlayerGeneration) return
        startup.mark('open-error', video); startup.flush()
        error.textContent = startError.message; error.classList.remove('hidden'); video.classList.add('hidden')
        $('#iosWatchRetry').classList.remove('hidden')
        $('#iosWatchRetry').onclick = () => { void startIosRemotePlayer(payload, position) }
        if (video._myTvEpisode) {
          video._myTvEpisode.busy = false
          $('#iosWatchNextPlay').disabled = false
        }
      }
    }

    async function startOfflinePlayer(manifest) {
      if (!await authoriseOfflineDownload(manifest)) return
      const shell = $('#iosWatchPlayer'); const video = $('#iosWatchVideo'); const error = $('#iosWatchError')
      void saveIosRemotePosition(false, true)
      video._iosStreamRecovery?.dispose(); video._iosStreamRecovery = null
      video._myTvProgress = null
      const generation = ++iosPlayerGeneration
      clearIosNextEpisode()
      clearInterval(iosRemotePositionTimer); clearInterval(iosRemoteHeartbeatTimer)
      const session = iosRemoteSession
      if (session) void playbackRequest('/api/remote/release', { stream: session }).catch(() => {})
      iosRemoteSession = null; iosOfflineDownloadId = manifest.id
      video._mabelQueue = null
      video.onpause = null; video.onseeked = null; video.onplaying = null
      video.oncanplay = null; video.onended = null; video.onerror = null
      video.pause(); video.removeAttribute('src'); video.replaceChildren()
      const privateMedia = ['my_tv', 'my-tv-series'].includes(manifest.source?.kind)
      shell.classList.toggle('is-my-tv', privateMedia)
      shell.classList.remove('hidden'); error.classList.add('hidden'); video.classList.remove('hidden')
      $('#iosWatchProgressStatus').classList.add('hidden'); $('#iosWatchRetry').classList.add('hidden')
      openIosPlayerHistoryLayer(); lockPortalPlayerScroll(false)
      $('#iosWatchTitle').textContent = manifest.title
      $('#iosWatchContext').textContent = 'Downloaded · ready offline'
      const checkpoint = privateMedia ? await myTvProgress.read(manifest.source).catch(() => null) : null
      if (generation !== iosPlayerGeneration) return
      const resume = checkpoint ? checkpoint.finished ? 0 : checkpoint.position : Number(manifest.resume_position || 0)
      if (privateMedia) myTvProgress.begin(video, manifest.source)
      $('#iosWatchStartOver').classList.toggle('hidden', resume <= 10)
      if (manifest.subtitles) {
        const track = document.createElement('track')
        track.kind = 'subtitles'; track.srclang = 'en'; track.label = 'English'
        track.src = MabelOffline.subtitleUrl(manifest.id); video.append(track)
      }
      const requestNativeFullscreen = bindIosPresentation(video, generation)
      video.onloadedmetadata = () => {
        if (generation !== iosPlayerGeneration) return
        if (resume > 0 && resume < video.duration - 5) video.currentTime = resume
        if (video._myTvProgress) video._myTvProgress.ready = true
        requestNativeFullscreen()
      }
      video.onplay = requestNativeFullscreen
      video.onpause = () => saveIosRemotePosition(false, true)
      video.onseeked = () => saveIosRemotePosition(false, true)
      video.onended = () => saveIosRemotePosition(true, true)
      iosRemotePositionTimer = setInterval(saveIosRemotePosition, 5000)
      video.onerror = () => {
        setNativeVideoBackdrop(false)
        error.textContent = 'This downloaded copy could not be opened. Try removing it and downloading it again.'
        error.classList.remove('hidden'); video.classList.add('hidden')
      }
      video.src = MabelOffline.playbackUrl(manifest.id); video.load()
      const playing = video.play(); requestNativeFullscreen()
      await playing.catch(() => {})
    }

    function saveMabelRemotePosition(finished = false, force = false) {
      const video = $('#mabelWatchVideo')
      if (!mabelRemoteSession || !Number.isFinite(video.currentTime) ||
          (!finished && !force && Math.abs(video.currentTime - mabelRemoteLastSaved) < 10)) return Promise.resolve(false)
      const session = mabelRemoteSession
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const position = finished && duration > 0 ? duration : video.currentTime
      mabelRemoteLastSaved = position
      return api('/api/remote/position', {
        method: 'POST', body: JSON.stringify({ stream: session, position, duration }),
      }).then(() => true).catch(() => false)
    }

    function beaconMabelRemotePosition() {
      const video = $('#mabelWatchVideo')
      if (!mabelRemoteSession ||
          !Number.isFinite(video.currentTime) || !navigator.sendBeacon) return
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      navigator.sendBeacon('/api/remote/position', new Blob([
        JSON.stringify({ stream: mabelRemoteSession, position: video.currentTime, duration }),
      ], { type: 'application/json' }))
    }

    function closeMabelWatchPlayer() {
      const video = $('#mabelWatchVideo')
      const session = mabelRemoteSession
      const returnTo = mabelPlayerReturnTo
      mabelPlayerReturnTo = null
      const saved = saveMabelRemotePosition(false, true)
      clearInterval(mabelRemoteHeartbeatTimer)
      clearInterval(mabelRemotePositionTimer)
      clearTimeout(mabelControlsTimer)
      mabelRemoteHeartbeatTimer = null
      mabelRemotePositionTimer = null
      mabelControlsTimer = null
      mabelRemoteSession = null
      mabelRemoteTracksPosition = false
      video._mabelQueue = null
      video.pause(); video.removeAttribute('src'); video.load()
      $('#mabelWatchPlayer').classList.add('hidden')
      $('#mabelWatchPlayer').classList.remove('controls-visible')
      unlockPortalPlayerScroll()
      if (returnTo) queueMicrotask(returnTo)
      saved.finally(() => {
        if (session) return api('/api/remote/release', {
          method: 'POST', body: JSON.stringify({ stream: session }),
        }).catch(() => {})
      }).finally(() => load().catch(() => {}))
    }

    function mabelWatchTime(value) {
      const seconds = Math.max(0, Math.floor(Number(value) || 0))
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    }

    function showMabelWatchControls(keepVisible = false) {
      const shell = $('#mabelWatchPlayer'); const video = $('#mabelWatchVideo')
      shell.classList.add('controls-visible')
      clearTimeout(mabelControlsTimer)
      mabelControlsTimer = null
      if (!keepVisible && !video.paused) {
        mabelControlsTimer = setTimeout(() => shell.classList.remove('controls-visible'), 2800)
      }
    }

    function applyMabelWatchPresentation() {
      const next = mabelWatchPresentation === 'standard' ? 'Widescreen'
        : mabelWatchPresentation === 'widescreen' ? 'Full screen' : 'Standard'
      const current = mabelWatchPresentation === 'fullscreen' ? 'Full screen'
        : mabelWatchPresentation === 'widescreen' ? 'Widescreen' : 'Standard'
      $('#mabelWatchPlayer').dataset.presentation = mabelWatchPresentation
      const button = $('[data-mabel-watch-action="presentation"]')
      button.querySelector('span').textContent = next
      button.setAttribute('aria-label', `Picture mode: ${current}. Switch to ${next}. Cycles Standard, Widescreen, Full screen.`)
      button.setAttribute('aria-pressed', String(mabelWatchPresentation !== 'standard'))
    }

    async function startMabelWatchPlayer(payload) {
      const shell = $('#mabelWatchPlayer'); const video = $('#mabelWatchVideo'); const error = $('#mabelWatchError')
      shell.classList.remove('hidden'); error.classList.add('hidden')
      applyMabelWatchPresentation()
      // The player shell is already fixed to the viewport. Fixing the body as
      // well shifts iOS PWA touch coordinates whenever the launch page has a
      // retained scroll position, leaving visible controls impossible to tap.
      lockPortalPlayerScroll(false)
      showMabelWatchControls(true)
      try {
        let result
        result = await startRemoteStream(payload)
        video.onpause = null; video.onplaying = null; video.onended = null
        video._mabelQueue = null
        mabelRemoteSession = new URL(result.stream_url, location.origin).searchParams.get('stream')
        mabelRemoteTracksPosition = result.resume_enabled === true
        mabelRemoteLastSaved = 0
        $('#mabelWatchTitle').textContent = result.title
        const channel = (library?.channels || []).find(value => Number(value.number) === Number(payload.channel))
        $('#mabelWatchChannel').textContent = channel ? `CH ${channel.number} · ${channel.name}` : `Remote ${tvName()}`
        const settings = library?.tv_settings || {}
        const cabinet = $('#mabelWatchCabinet')
        const cabinetStyle = settings.tv_border || 'slim-black'
        const cabinetClasses = ['dinosaur-den', 'ocean-club', 'finding-nemo'].includes(cabinetStyle)
          ? `charcoal-90s ${cabinetStyle}` : cabinetStyle
        cabinet.className = `mabel-watch-cabinet ${cabinetClasses}`
        $('#mabelWatchShell').className = `mabel-watch-shell ${cabinetClasses}`
        cabinet.style.setProperty('--glass', String(Math.min(.5, Math.max(0, Number(settings.crt_glass || 35) / 100 * .65))))
        cabinet.style.setProperty('--distortion', String(Math.min(1, Math.max(0, Number(settings.video_distortion || 20) / 100))))
        video.pause(); video.removeAttribute('src')
        const resume = Number(result.resume_position || 0)
        video.onloadedmetadata = () => {
          $('#mabelWatchDuration').textContent = mabelWatchTime(video.duration)
          if (mabelRemoteTracksPosition && resume > 10 && resume < video.duration - 5) {
            video.currentTime = resume
          }
          $('#mabelWatchSeek').value = String(video.duration ? Math.round(video.currentTime / video.duration * 1000) : 0)
        }
        video.ontimeupdate = () => {
          $('#mabelWatchCurrent').textContent = mabelWatchTime(video.currentTime)
          $('#mabelWatchSeek').value = String(video.duration ? Math.round(video.currentTime / video.duration * 1000) : 0)
        }
        video.onplay = () => { $('[data-mabel-watch-action="play"]').classList.add('playing'); showMabelWatchControls() }
        bindMabelQueuePlayer(video, payload, result, startMabelWatchPlayer)
        video.onpause = () => {
          $('[data-mabel-watch-action="play"]').classList.remove('playing')
          showMabelWatchControls(true)
          saveMabelRemotePosition(false, true)
        }
        video.onseeked = () => saveMabelRemotePosition(false, true)
        video.onended = () => saveMabelRemotePosition(true, true).then(() => finishMabelQueueDevice(video))
        video.onerror = () => { error.textContent = `This programme could not be played (media error ${video.error?.code || 'unknown'}).`; error.classList.remove('hidden'); failMabelQueueDevice(video, error.textContent) }
        video.src = result.stream_url
        video.load()
        clearInterval(mabelRemoteHeartbeatTimer)
        mabelRemoteHeartbeatTimer = setInterval(() => api('/api/remote/heartbeat', { method: 'POST', body: JSON.stringify({ stream: mabelRemoteSession }) }).catch(() => {}), 30000)
        clearInterval(mabelRemotePositionTimer)
        mabelRemotePositionTimer = setInterval(saveMabelRemotePosition, 15000)
        await video.play().catch(() => {})
      } catch (startError) {
        error.textContent = startError.message; error.classList.remove('hidden')
      }
    }

    function isAppleMobilePlayer() {
      // iPadOS uses a desktop-class Macintosh user agent by default. Touch
      // capability distinguishes it from an actual Mac and ensures iPads use
      // the native iOS player path rather than the CRT-styled desktop page.
      return /iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    }

    async function allowIndependentViewing() {
      const remote = library?.remote_viewing || {}
      if (remote.allow_simultaneous === true || remote.tv_running !== true) return
      await api('/api/manage', {
        method: 'POST',
        body: JSON.stringify({ action: 'set-remote-simultaneous', enabled: true }),
      })
      remote.allow_simultaneous = true
      renderRemoteViewing({ force: true })
    }

    async function startRemoteStream(payload) {
      if (!payload.queue_id) await allowIndependentViewing()
      return playbackRequest('/api/remote/start', payload)
    }

    async function openInVlc(payload, title) {
      try {
        const result = await api('/api/external/start', {
          method: 'POST', body: JSON.stringify(payload),
        })
        const mediaUrl = new URL(result.stream_url, location.origin).href
        // VLC's x-callback stream action can open the app and then immediately
        // abandon playback. Its direct URL scheme hands the same tokenised HTTPS
        // source to VLC without that brittle callback lifecycle.
        const deepLink = `vlc://${mediaUrl}`
        location.href = deepLink
        setTimeout(() => {
          if (document.visibilityState === 'visible') {
            notice('VLC did not open. Install VLC for iPhone, then try again.', true)
          }
        }, 1800)
      } catch (error) { showError(error) }
    }

    async function downloadToDevice(payload, title) {
      if (!offlineStorageReady || !window.MabelOffline) {
        notice(offlineStorageError || `Set up the secure ${tvName()} app from the Downloads tab first.`, true)
        const domain = ['my_tv', 'my-tv-series'].includes(payload?.kind) ? 'my_tv' : 'mabel'
        navigateDomainRoute(domain, 'downloads')
        return
      }
      const pendingId = JSON.stringify(payload)
      pendingDownloads.set(pendingId, { title, source: payload,
        phase: 'preparing', message: 'Preparing download…' })
      downloadDomain = ['my_tv', 'my-tv-series'].includes(payload?.kind) ? 'my_tv' : 'mabel'
      watchDomain = downloadDomain
      navigateDomainRoute(downloadDomain, 'downloads')
      await renderDownloads()
      try {
        await window.MabelOffline.startDownload(payload, title, update => {
          pendingDownloads.set(pendingId, { title, source: payload, ...update })
          renderDownloads().catch(() => {})
        })
        pendingDownloads.delete(pendingId)
        await renderDownloads()
      } catch (error) {
        const current = pendingDownloads.get(pendingId)
        pendingDownloads.set(pendingId, { ...current, phase: 'error', message: error.message })
        await renderDownloads()
        if (error.name !== 'AbortError') notice(error.message, true)
      }
    }

    async function openRemotePlayer(payload, position = null, returnTo = null) {
      const desktopMyTv = ['my_tv', 'my-tv-series'].includes(payload.kind) && !isAppleMobilePlayer()
      // Reserve the tab during the direct user gesture. Waiting for the
      // portal-only concurrency setting first would let some browsers mistake
      // the eventual player window for an unsolicited popup.
      const playerWindow = desktopMyTv ? window.open('about:blank', '_blank') : null
      try {
        if (!payload.queue_id) await allowIndependentViewing()
        if (payload.kind === 'channel') {
          mabelPlayerReturnTo = returnTo
          await startMabelWatchPlayer({ ...payload, position: Math.max(0, Number(position) || 0) })
          return
        }
        if (payload.kind === 'usb') {
          iosPlayerReturnTo = returnTo
          await startIosRemotePlayer(payload, 0)
          return
        }
        const url = playerUrl(payload, position)
        if (isAppleMobilePlayer()) {
          iosPlayerReturnTo = returnTo
          await startIosRemotePlayer(payload, position)
        }
        else if (playerWindow) {
          playerWindow.opener = null
          playerWindow.location.replace(url)
        } else throw new Error(`Allow pop-ups for ${tvName()}, then choose Watch on this device again.`)
      } catch (error) {
        if (playerWindow) playerWindow.close()
        showError(error)
      }
    }

    $('#iosWatchBack').onclick = () => closeIosRemotePlayer()
    window.addEventListener('popstate', event => {
      const hasPlayerLayer = event.state?.mabelIosPlayer === true
      if (iosPlayerHistoryActive && !hasPlayerLayer) {
        closeIosRemotePlayer({ fromHistory: true })
        return
      }
      if (!iosPlayerHistoryActive && hasPlayerLayer
          && $('#iosWatchPlayer').classList.contains('hidden')) {
        const state = { ...(event.state || {}) }
        delete state.mabelIosPlayer
        history.replaceState(state, '', location.href)
      }
    })
    $('#iosWatchStartOver').onclick = () => {
      const video = $('#iosWatchVideo')
      clearInterval(iosNextEpisodeTimer); iosNextEpisodeTimer = null
      if (video._myTvEpisode) video._myTvEpisode.ended = false
      $('#iosWatchNextHint').textContent = 'Up next'
      $('#iosWatchNextCancel').classList.add('hidden')
      video.currentTime = 0; iosRemoteLastSaved = 0; video.play().catch(() => {})
      $('#iosWatchStartOver').classList.add('hidden')
    }
    window.addEventListener('pagehide', beaconIosRemotePosition)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') beaconIosRemotePosition()
    })
    $('#mabelWatchBack').onclick = closeMabelWatchPlayer
    $$('[data-mabel-watch-action]').forEach(button => button.onclick = () => {
      const video = $('#mabelWatchVideo')
      showMabelWatchControls(button.dataset.mabelWatchAction === 'play' && video.paused)
      if (button.dataset.mabelWatchAction === 'play') {
        if (video.paused) video.play().catch(() => {})
        else video.pause()
      }
      if (button.dataset.mabelWatchAction === 'back') video.currentTime = Math.max(0, video.currentTime - 15)
      if (button.dataset.mabelWatchAction === 'forward') video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 15)
      if (button.dataset.mabelWatchAction === 'presentation') {
        mabelWatchPresentation = mabelWatchPresentation === 'standard' ? 'widescreen'
          : mabelWatchPresentation === 'widescreen' ? 'fullscreen' : 'standard'
        applyMabelWatchPresentation()
        showMabelWatchControls()
      }
      if (button.dataset.mabelWatchAction === 'mute') { video.muted = !video.muted; button.classList.toggle('muted', video.muted); button.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute') }
    })
    $('#mabelWatchSeek').oninput = event => { const video = $('#mabelWatchVideo'); showMabelWatchControls(true); if (video.duration) video.currentTime = Number(event.target.value) / 1000 * video.duration }
    $('#mabelWatchSeek').onchange = () => showMabelWatchControls()
    $('#mabelWatchScreen').onpointermove = () => showMabelWatchControls()
    $('#mabelWatchScreen').onpointerdown = event => {
      if (!event.target.closest?.('button, input')) showMabelWatchControls()
    }
    document.addEventListener('keydown', event => {
      if ($('#mabelWatchPlayer').classList.contains('hidden')) return
      if (event.key === 'Escape') closeMabelWatchPlayer()
      if (event.key === ' ' && event.target.tagName !== 'INPUT') {
        event.preventDefault()
        const video = $('#mabelWatchVideo')
        if (video.paused) video.play().catch(() => {})
        else video.pause()
      }
    })
    window.addEventListener('pagehide', () => {
      beaconMabelRemotePosition()
      if (mabelRemoteSession) navigator.sendBeacon('/api/remote/release', JSON.stringify({ stream: mabelRemoteSession }))
    })
