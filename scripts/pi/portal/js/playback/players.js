'use strict'

let iosInlineControlTimer = null
let mabelFilmArtCycleTimer = null

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
      const base = `/api/adult/artwork/${encodeURIComponent(name)}`
      return retry ? `${base}?retry=${encodeURIComponent(retry)}` : base
    }

    function posterImage(name, fallback) {
      const image = document.createElement('img')
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

    function playerUrl(payload, position = 0) {
      const query = new URLSearchParams({ ...payload, position: String(Math.max(0, Number(position) || 0)) })
      return `/watch/player?${query}`
    }

    function saveIosRemotePosition(finished = false, force = false) {
      const video = $('#iosWatchVideo')
      if (!iosRemoteSession || !Number.isFinite(video.currentTime) || (!finished && !force && Math.abs(video.currentTime - iosRemoteLastSaved) < 10)) return Promise.resolve(false)
      const session = iosRemoteSession
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const position = finished && duration > 0 ? duration : video.currentTime
      iosRemoteLastSaved = position
      return api('/api/remote/position', { method: 'POST', body: JSON.stringify({ stream: session, position, duration }) })
        .then(() => true).catch(() => false)
    }

    function beaconIosRemotePosition() {
      const video = $('#iosWatchVideo')
      if (!iosRemoteSession || !Number.isFinite(video.currentTime) || !navigator.sendBeacon) return
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      navigator.sendBeacon('/api/remote/position', new Blob([
        JSON.stringify({ stream: iosRemoteSession, position: video.currentTime, duration }),
      ], { type: 'application/json' }))
    }

    function closeIosRemotePlayer() {
      const video = $('#iosWatchVideo')
      const session = iosRemoteSession
      const saved = saveIosRemotePosition(false, true)
      clearTimeout(iosInlineControlTimer); iosInlineControlTimer = null
      clearInterval(iosRemotePositionTimer); clearInterval(iosRemoteHeartbeatTimer)
      iosRemotePositionTimer = null; iosRemoteHeartbeatTimer = null; iosRemoteSession = null
      iosOfflineDownloadId = null
      video.style.pointerEvents = ''; video.controls = true
      video.pause(); video.removeAttribute('src'); video.replaceChildren(); video.load()
        $('#iosWatchPlayer').classList.add('hidden')
        document.documentElement.classList.remove('native-video-fullscreen')
        unlockPortalPlayerScroll()
      saved.finally(() => {
        if (session) return api('/api/remote/release', { method: 'POST', body: JSON.stringify({ stream: session }) }).catch(() => {})
      }).finally(() => load().catch(() => {}))
    }

    function setNativeVideoBackdrop(active) {
      document.documentElement.classList.toggle('native-video-fullscreen', active)
    }

    function restoreIosInlineVideoControls(video) {
      setNativeVideoBackdrop(false)
      clearTimeout(iosInlineControlTimer)
      // AVKit can hand the visible page back before its composited control
      // layer has stopped receiving touches. Briefly removing the inline
      // controls retires that layer; rebuilding them after the transition
      // gives WebKit a fresh, correctly positioned interaction surface.
      video.controls = false
      video.style.pointerEvents = 'none'
      iosInlineControlTimer = setTimeout(() => {
        video.controls = true
        video.style.pointerEvents = ''
        iosInlineControlTimer = null
      }, 80)
    }

    async function startIosRemotePlayer(payload, position = 0) {
      const shell = $('#iosWatchPlayer'); const video = $('#iosWatchVideo'); const error = $('#iosWatchError')
      shell.classList.remove('hidden'); error.classList.add('hidden'); video.classList.remove('hidden')
      // The fixed-body scroll lock causes incorrect touch coordinates in
      // installed iOS web apps after AVKit changes the viewport. The player
      // shell is already fixed, so overflow locking is sufficient here.
      lockPortalPlayerScroll(false)
      try {
        let result
        result = await startRemoteStream(payload)
        iosRemoteSession = new URL(result.stream_url, location.origin).searchParams.get('stream')
        $('#iosWatchTitle').textContent = result.title
        $('#iosWatchContext').textContent = result.kind === 'usb' ? 'Playing directly from USB' : 'MabelTV remote viewing'
        video.pause(); video.removeAttribute('src'); video.replaceChildren()
        let captionsAttached = false
        const attachNativeCaptions = () => {
          if (!result.subtitle_url || captionsAttached) return
          captionsAttached = true
          const track = document.createElement('track')
          // Register the choice with AVPlayer but leave it off initially. The
          // previous forced `mode = showing` displayed captions while Apple's
          // own selector still reported Off.
          track.kind = 'subtitles'; track.srclang = 'en'; track.label = 'English'; track.src = result.subtitle_url; track.default = false
          video.append(track)
        }
        const resume = Number(position || result.resume_position || 0)
        let nativeFullscreen = false
        const requestNativeFullscreen = () => {
          if (nativeFullscreen || video.webkitDisplayingFullscreen || video.webkitPresentationMode === 'fullscreen' || typeof video.webkitEnterFullscreen !== 'function') return
          try { video.webkitEnterFullscreen() } catch (_) { /* wait for play */ }
        }
        video.onloadedmetadata = () => {
          if (resume > 10 && resume < video.duration - 5) video.currentTime = resume
          requestNativeFullscreen()
        }
        // Do not involve the external VTT in initial source negotiation. Adult
        // MP4s previously failed with MEDIA_ERR_SRC_NOT_SUPPORTED when iPadOS
        // received the video and text track together. Once canplay fires, the
        // movie is already accepted and the native AVPlayer can safely add CC.
        video.oncanplay = attachNativeCaptions
        video.onerror = () => { setNativeVideoBackdrop(false); error.textContent = `This video could not be played (media error ${video.error?.code || 'unknown'}).`; error.classList.remove('hidden'); video.classList.add('hidden') }
        video.onwebkitendfullscreen = () => {
          nativeFullscreen = false
          restoreIosInlineVideoControls(video)
          saveIosRemotePosition(false, true)
        }
        video.onwebkitpresentationmodechanged = () => {
          const active = video.webkitPresentationMode === 'fullscreen' || Boolean(video.webkitDisplayingFullscreen)
          nativeFullscreen = active
          if (active) setNativeVideoBackdrop(true)
          else restoreIosInlineVideoControls(video)
        }
        video.onwebkitbeginfullscreen = () => { nativeFullscreen = true; setNativeVideoBackdrop(true) }
        // Ask for the true native player immediately from the library tap and
        // retry only once the media becomes ready. This avoids the old inline
        // hand-off before the Liquid Glass player opens.
        video.onplay = requestNativeFullscreen
        video.onpause = () => saveIosRemotePosition(false, true)
        video.onseeked = () => saveIosRemotePosition(false, true)
        video.onended = () => saveIosRemotePosition(true)
        $('#iosWatchStartOver').classList.toggle('hidden', resume <= 10)
        iosRemoteLastSaved = 0
        clearInterval(iosRemotePositionTimer); iosRemotePositionTimer = setInterval(saveIosRemotePosition, 15000)
        clearInterval(iosRemoteHeartbeatTimer); iosRemoteHeartbeatTimer = setInterval(() => api('/api/remote/heartbeat', { method: 'POST', body: JSON.stringify({ stream: iosRemoteSession }) }).catch(() => {}), 30000)
        video.src = result.stream_url
        video.load()
        const playAttempt = video.play()
        requestNativeFullscreen()
        await playAttempt.catch(() => {})
      } catch (startError) {
        error.textContent = startError.message; error.classList.remove('hidden'); video.classList.add('hidden')
      }
    }

    async function startOfflinePlayer(manifest) {
      if (!await authoriseOfflineDownload(manifest)) return
      const shell = $('#iosWatchPlayer'); const video = $('#iosWatchVideo'); const error = $('#iosWatchError')
      iosRemoteSession = null
      iosOfflineDownloadId = manifest.id
      shell.classList.remove('hidden'); error.classList.add('hidden'); video.classList.remove('hidden')
      lockPortalPlayerScroll(false)
      $('#iosWatchTitle').textContent = manifest.title
      $('#iosWatchContext').textContent = 'Downloaded · ready offline'
      $('#iosWatchStartOver').classList.add('hidden')
      video.pause(); video.removeAttribute('src'); video.replaceChildren()
      if (manifest.subtitles) {
        const track = document.createElement('track')
        track.kind = 'subtitles'; track.srclang = 'en'; track.label = 'English'
        track.src = MabelOffline.subtitleUrl(manifest.id)
        video.append(track)
      }
      let nativeFullscreen = false
      const requestNativeFullscreen = () => {
        if (nativeFullscreen || video.webkitDisplayingFullscreen || video.webkitPresentationMode === 'fullscreen' || typeof video.webkitEnterFullscreen !== 'function') return
        try { video.webkitEnterFullscreen() } catch (_) { /* retry when playback starts */ }
      }
      video.onloadedmetadata = requestNativeFullscreen
      video.oncanplay = requestNativeFullscreen
      video.onplay = requestNativeFullscreen
      video.onwebkitbeginfullscreen = () => { nativeFullscreen = true; setNativeVideoBackdrop(true) }
      video.onwebkitendfullscreen = () => { nativeFullscreen = false; restoreIosInlineVideoControls(video) }
      video.onwebkitpresentationmodechanged = () => {
        const active = video.webkitPresentationMode === 'fullscreen' || Boolean(video.webkitDisplayingFullscreen)
        nativeFullscreen = active
        if (active) setNativeVideoBackdrop(true)
        else restoreIosInlineVideoControls(video)
      }
      video.onerror = () => {
        setNativeVideoBackdrop(false)
        error.textContent = 'This downloaded copy could not be opened. Try removing it and downloading it again.'
        error.classList.remove('hidden'); video.classList.add('hidden')
      }
      video.src = MabelOffline.playbackUrl(manifest.id)
      video.load()
      await video.play().catch(() => {})
      requestNativeFullscreen()
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
      const saved = saveMabelRemotePosition(false, true)
      clearInterval(mabelRemoteHeartbeatTimer)
      clearInterval(mabelRemotePositionTimer)
      clearTimeout(mabelControlsTimer)
      mabelRemoteHeartbeatTimer = null
      mabelRemotePositionTimer = null
      mabelControlsTimer = null
      mabelRemoteSession = null
      mabelRemoteTracksPosition = false
      video.pause(); video.removeAttribute('src'); video.load()
      $('#mabelWatchPlayer').classList.add('hidden')
      $('#mabelWatchPlayer').classList.remove('controls-visible')
      unlockPortalPlayerScroll()
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

    async function startMabelWatchPlayer(payload) {
      const shell = $('#mabelWatchPlayer'); const video = $('#mabelWatchVideo'); const error = $('#mabelWatchError')
      shell.classList.remove('hidden'); error.classList.add('hidden')
      lockPortalPlayerScroll()
      showMabelWatchControls(true)
      try {
        let result
        result = await startRemoteStream(payload)
        mabelRemoteSession = new URL(result.stream_url, location.origin).searchParams.get('stream')
        mabelRemoteTracksPosition = result.resume_enabled === true
        mabelRemoteLastSaved = 0
        $('#mabelWatchTitle').textContent = result.title
        const channel = (library?.channels || []).find(value => Number(value.number) === Number(payload.channel))
        $('#mabelWatchChannel').textContent = channel ? `CH ${channel.number} · ${channel.name}` : 'Remote Mabel TV'
        const settings = library?.tv_settings || {}
        const cabinet = $('#mabelWatchCabinet')
        const cabinetStyle = settings.tv_border || 'slim-black'
        cabinet.className = `mabel-watch-cabinet ${cabinetStyle}`
        $('#mabelWatchShell').className = `mabel-watch-shell ${cabinetStyle}`
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
        video.onpause = () => {
          $('[data-mabel-watch-action="play"]').classList.remove('playing')
          showMabelWatchControls(true)
          saveMabelRemotePosition(false, true)
        }
        video.onseeked = () => saveMabelRemotePosition(false, true)
        video.onended = () => saveMabelRemotePosition(true, true)
        video.onerror = () => { error.textContent = `This programme could not be played (media error ${video.error?.code || 'unknown'}).`; error.classList.remove('hidden') }
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
      renderRemoteViewing()
    }

    async function startRemoteStream(payload) {
      await allowIndependentViewing()
      return api('/api/remote/start', { method: 'POST', body: JSON.stringify(payload) })
    }

    async function openInVlc(payload, title) {
      try {
        notice(`Opening ${title} in VLC…`)
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
        notice(offlineStorageError || 'Set up the secure MabelTV app from the Downloads tab first.', true)
        remoteKind = 'downloads'
        renderRemoteViewing()
        openView('watch')
        return
      }
      const pendingId = JSON.stringify(payload)
      pendingDownloads.set(pendingId, { title, phase: 'preparing', message: 'Preparing download…' })
      remoteKind = 'downloads'
      renderRemoteViewing()
      openView('watch')
      await renderDownloads()
      try {
        const manifest = await window.MabelOffline.startDownload(payload, title, update => {
          pendingDownloads.set(pendingId, { title, ...update })
          renderDownloads().catch(() => {})
        })
        pendingDownloads.delete(pendingId)
        await renderDownloads()
        notice(`${manifest.title} is ready offline.`)
      } catch (error) {
        const current = pendingDownloads.get(pendingId)
        pendingDownloads.set(pendingId, { ...current, phase: 'error', message: error.message })
        await renderDownloads()
        notice(error.name === 'AbortError' ? 'Download paused.' : error.message, error.name !== 'AbortError')
      }
    }

    async function openRemotePlayer(payload, position = 0) {
      const desktopAdult = ['adult', 'adult-series'].includes(payload.kind) && !isAppleMobilePlayer()
      // Reserve the tab during the direct user gesture. Waiting for the
      // portal-only concurrency setting first would let some browsers mistake
      // the eventual player window for an unsolicited popup.
      const playerWindow = desktopAdult ? window.open('about:blank', '_blank') : null
      try {
        await allowIndependentViewing()
        if (payload.kind === 'channel') {
          await startMabelWatchPlayer({ ...payload, position: Math.max(0, Number(position) || 0) })
          return
        }
        if (payload.kind === 'usb') { await startIosRemotePlayer(payload, 0); return }
        const url = playerUrl(payload, position)
        if (isAppleMobilePlayer()) await startIosRemotePlayer(payload, position)
        else if (playerWindow) {
          playerWindow.opener = null
          playerWindow.location.replace(url)
        } else throw new Error('Allow pop-ups for MabelTV, then choose Watch on this device again.')
      } catch (error) {
        if (playerWindow) playerWindow.close()
        showError(error)
      }
    }

    $('#iosWatchBack').onclick = closeIosRemotePlayer
    $('#iosWatchStartOver').onclick = () => { const video = $('#iosWatchVideo'); video.currentTime = 0; iosRemoteLastSaved = 0; video.play().catch(() => {}); $('#iosWatchStartOver').classList.add('hidden') }
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
      if (button.dataset.mabelWatchAction === 'mute') { video.muted = !video.muted; button.classList.toggle('muted', video.muted); button.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute') }
    })
    $('#mabelWatchSeek').oninput = event => { const video = $('#mabelWatchVideo'); showMabelWatchControls(true); if (video.duration) video.currentTime = Number(event.target.value) / 1000 * video.duration }
    $('#mabelWatchSeek').onchange = () => showMabelWatchControls()
    $('#mabelWatchScreen').onpointermove = () => showMabelWatchControls()
    $('#mabelWatchScreen').onpointerdown = event => {
      if (event.target === $('#mabelWatchVideo')) showMabelWatchControls()
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

