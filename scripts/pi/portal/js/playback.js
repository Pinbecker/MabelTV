'use strict'

let iosInlineControlTimer = null
let mabelFilmArtCycleTimer = null
let watchProgrammeMoreReturn = null
let watchProgrammeEpisodeMoreReturn = null
let selectedWatchProgramme = null
let selectedAdultEpisode = null
let adultEpisodeMoreReturn = null

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

    function watchFilmTitle(film) {
      return film?.metadata?.title || film?.display_name || 'Untitled film'
    }

    function watchFilmResumable(film) {
      const position = Number(film?.remote_position || 0)
      const duration = Number(film?.remote_duration || 0)
      if (position < 30) return false
      if (!duration) return true
      const completionWindow = Math.min(Math.max(180, duration * .05), duration * .2)
      return position < duration - completionWindow
    }

    async function clearWatchFilmProgress(film, playAfter = false, actionOverride = null) {
      const source = { kind: 'adult', file: film.path }
      const action = actionOverride
      const actionLabel = action?.querySelector('strong') || action?.querySelector('span:last-child')
      const originalLabel = actionLabel?.textContent || ''
      if (action) {
        action.disabled = true
        action.setAttribute('aria-busy', 'true')
      }
      if (actionLabel) actionLabel.textContent = playAfter ? 'Starting from beginning…' : 'Removing…'
      try {
        await api('/api/remote/clear-position', {
          method: 'POST', body: JSON.stringify(source),
        })
        film.remote_position = 0
        film.remote_last_watched = 0
        const storedFilm = (library?.adult_library || []).find(item => item.path === film.path)
        if (storedFilm) {
          storedFilm.remote_position = 0
          storedFilm.remote_last_watched = 0
        }
        const startFilm = { ...film }
        if (playAfter) {
          playWatchFilm(startFilm, 0)
          return
        }
        closeWatchFilmSheet()
        renderAdultWatch()
        renderHomeLibrary()
        notice(`${watchFilmTitle(film)} was removed from Continue Watching.`)
      } finally {
        if (action) {
          action.disabled = false
          action.removeAttribute('aria-busy')
        }
        if (actionLabel) actionLabel.textContent = originalLabel
      }
    }

    function watchTimeLabel(value) {
      const seconds = Math.max(0, Math.floor(Number(value) || 0))
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      if (hours) return `${hours}h ${minutes}m`
      return `${Math.max(1, minutes)}m`
    }

    function filmSortTitle(value) {
      return watchFilmTitle(value).replace(/^the\s+/i, '').trim()
    }

    function adultFilmEntry(film) {
      return { kind: 'adult', film }
    }

    function mabelFilmEntries() {
      return (library?.channels || [])
        .filter(channel => channel.content_type === 'films')
        .flatMap(channel => (channel.programmes || []).map(film => ({
          kind: 'channel', channel, film,
        })))
    }

    function allFilmEntries() {
      return [
        ...(library?.adult_library || []).map(adultFilmEntry),
        ...mabelFilmEntries(),
      ].sort((left, right) => filmSortTitle(left.film).localeCompare(
        filmSortTitle(right.film), undefined, { sensitivity: 'base' }))
    }

    function favouriteSeriesChannels() {
      return (library?.channels || [])
        .filter(channel => channel.content_type !== 'films' && channel.favourite === true)
        .sort((left, right) => left.name.localeCompare(
          right.name, undefined, { sensitivity: 'base' }))
    }

    function favouriteAdultSeries() {
      return (library?.adult_series || [])
        .filter(series => series.favourite === true)
        .sort((left, right) => left.title.localeCompare(
          right.title, undefined, { sensitivity: 'base' }))
    }

    function filmEntryPoster(entry) {
      const film = entry.film
      const metadata = film.metadata || {}
      const fallback = watchFilmTitle(film).slice(0, 1).toUpperCase()
      if (entry.kind === 'adult') return filmPoster(film)
      if (metadata.poster) {
        const image = document.createElement('img')
        image.src = `/api/channel/artwork/${encodeURIComponent(metadata.poster)}`
        image.alt = ''
        image.loading = 'lazy'
        image.decoding = 'async'
        return image
      }
      const placeholder = document.createElement('span')
      placeholder.className = 'watch-card-placeholder'
      placeholder.textContent = fallback
      return placeholder
    }

    function filmEntrySourceLabel(entry) {
      return entry.kind === 'adult' ? 'Adult TV' : entry.channel.name
    }

    function filmEntrySearchText(entry) {
      const film = entry.film
      const metadata = film.metadata || {}
      return [watchFilmTitle(film), film.display_name, metadata.year,
        filmEntrySourceLabel(entry)].filter(Boolean).join(' ').toLocaleLowerCase()
    }

    function openFilmEntry(entry, context = 'library') {
      if (entry.kind === 'adult') openWatchFilmSheet(entry.film, context)
      else openWatchProgrammeSheet(entry.channel, entry.film, context)
    }

    function closeFilmResumeChoiceSheet() {
      const dialog = $('#filmResumeChoiceSheet')
      if (dialog?.open) dialog.close()
      document.documentElement.style.overflow = ''
    }

    function openFilmResumeChoice({ title, destination, position,
      continueAction, restartAction }) {
      $('#filmResumeChoiceEyebrow').textContent = destination
      $('#filmResumeChoiceTitle').textContent = title
      $('#filmResumeChoiceMeta').textContent = `Continue from ${watchTimeLabel(position)}, or start this film from the beginning?`
      $('#filmResumeContinue').querySelector('small').textContent = `Resume from ${watchTimeLabel(position)}`
      $('#filmResumeContinue').onclick = () => {
        closeFilmResumeChoiceSheet()
        continueAction()
      }
      $('#filmResumeRestart').onclick = () => {
        closeFilmResumeChoiceSheet()
        restartAction()
      }
      const dialog = $('#filmResumeChoiceSheet')
      if (!dialog.open) dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    }

    function watchFilmProgress(film) {
      const position = Number(film?.remote_position || 0)
      const duration = Number(film?.remote_duration || 0)
      return duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0
    }

    function filmPoster(film) {
      const metadata = film.metadata || {}
      const fallback = watchFilmTitle(film).slice(0, 1).toUpperCase()
      if (metadata.poster) return posterImage(metadata.poster, fallback)
      const placeholder = document.createElement('span')
      placeholder.className = 'watch-card-placeholder'
      placeholder.textContent = fallback
      return placeholder
    }

    function adultWatchCard(film) {
      const metadata = film.metadata || {}
      const resumable = watchFilmResumable(film)
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'watch-card'
      card.dataset.adultPath = film.path
      card.setAttribute('aria-label', `${watchFilmTitle(film)}${resumable ? `, resume at ${watchTimeLabel(film.remote_position)}` : ''}`)
      const art = document.createElement('span')
      art.className = 'watch-card-art'
      art.append(filmPoster(film))
      art.append(adultOptimisationBadge(film))
      if (film.browser_ready === false) {
        const format = document.createElement('span')
        format.className = 'watch-format'
        format.textContent = 'VLC READY'
        art.append(format)
      }
      const progressValue = watchFilmProgress(film)
      if (resumable && progressValue) {
        const progress = document.createElement('span')
        progress.className = 'watch-progress'
        const fill = document.createElement('span')
        fill.style.width = `${progressValue}%`
        progress.append(fill)
        art.append(progress)
      }
      const copy = document.createElement('span')
      copy.className = 'watch-card-copy'
      const title = document.createElement('strong')
      title.textContent = watchFilmTitle(film)
      const detail = document.createElement('small')
      detail.textContent = resumable ? `Resume · ${watchTimeLabel(film.remote_position)}` : [metadata.year, film.folder].filter(Boolean).join(' · ') || 'Film'
      copy.append(title, detail)
      card.append(art, copy)
      card.onclick = () => openWatchFilmSheet(film)
      return card
    }

    function continueWatchCard(value) {
      if (value?.kind === 'adult-series') return adultSeriesContinueCard(value)
      const entry = value?.film ? value : adultFilmEntry(value)
      const film = entry.film
      const item = document.createElement('div')
      item.className = 'watch-continue-item'
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'watch-continue-card'
      card.setAttribute('aria-label', `Resume ${watchFilmTitle(film)} at ${watchTimeLabel(film.remote_position)}`)
      const art = document.createElement('span')
      art.className = 'watch-continue-art'
      art.style.setProperty('--watch-progress', `${watchFilmProgress(film)}%`)
      art.append(filmEntryPoster(entry))
      if (entry.kind === 'adult') {
        card.dataset.adultPath = film.path
        art.append(adultOptimisationBadge(film))
      }
      const copy = document.createElement('span')
      copy.className = 'watch-continue-copy'
      const label = document.createElement('small')
      label.textContent = 'Continue'
      const title = document.createElement('strong')
      title.textContent = watchFilmTitle(film)
      const time = document.createElement('span')
      time.textContent = `${watchTimeLabel(film.remote_position)} watched`
      const play = document.createElement('i')
      play.textContent = '▶'
      copy.append(label, title, time, play)
      card.append(art, copy)
      card.onclick = () => openFilmEntry(entry, 'continue')
      item.append(card)
      return item
    }

    function adultSeriesContinueEntries() {
      return (library?.adult_series || []).map(series => {
        const episode = (series.episodes || [])
          .filter(value => value.watched !== true && watchFilmResumable(value))
          .sort((left, right) => Number(right.remote_last_watched || 0)
            - Number(left.remote_last_watched || 0))[0]
        return episode ? {
          kind: 'adult-series', series, episode,
          lastWatched: Number(episode.remote_last_watched || 0),
        } : null
      }).filter(Boolean)
    }

    function adultSeriesContinueCard(entry) {
      const { series, episode } = entry
      const item = document.createElement('div')
      item.className = 'watch-continue-item'
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'watch-continue-card'
      card.setAttribute('aria-label', `Resume ${series.title}, ${episode.display_name} at ${watchTimeLabel(episode.remote_position)}`)
      const art = document.createElement('span')
      art.className = 'watch-continue-art'
      art.style.setProperty('--watch-progress', `${watchFilmProgress(episode)}%`)
      const artworkName = episode.still || series.metadata?.poster
      if (artworkName) {
        const image = document.createElement('img')
        image.src = `/api/adult/series/artwork/${encodeURIComponent(artworkName)}`
        image.alt = ''
        image.loading = 'lazy'
        art.append(image)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = series.title.slice(0, 1).toUpperCase()
        art.append(placeholder)
      }
      const copy = document.createElement('span')
      copy.className = 'watch-continue-copy'
      const label = document.createElement('small')
      label.textContent = `Continue · ${series.title}`
      const title = document.createElement('strong')
      title.textContent = episode.display_name
      const time = document.createElement('span')
      time.textContent = `${watchTimeLabel(episode.remote_position)} watched`
      const play = document.createElement('i')
      play.textContent = '▶'
      copy.append(label, title, time, play)
      card.append(art, copy)
      // Continue Watching is a direct launch surface, not a drill-down into
      // series management. Its close action must return to Adult TV.
      card.onclick = () => openAdultEpisodeSheet(series, episode, () => {})
      item.append(card)
      return item
    }

    function homePosterTile(entry, context = 'library') {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'home-poster-card'
      card.setAttribute('aria-label', `Open ${watchFilmTitle(entry.film)} from ${filmEntrySourceLabel(entry)}`)
      const art = document.createElement('span')
      art.className = 'home-poster-art'
      art.append(filmEntryPoster(entry))
      if (entry.film.favourite) {
        const favourite = document.createElement('span')
        favourite.className = 'home-favourite-mark'
        favourite.textContent = '♥'
        art.append(favourite)
      }
      const copy = document.createElement('span')
      copy.className = 'home-poster-copy'
      const title = document.createElement('strong')
      title.textContent = watchFilmTitle(entry.film)
      const source = document.createElement('small')
      source.textContent = filmEntrySourceLabel(entry)
      copy.append(title, source)
      card.append(art, copy)
      card.onclick = () => openFilmEntry(entry, context)
      return card
    }

    function homeChannelTile(channel) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'home-poster-card home-channel-card'
      card.setAttribute('aria-label', `Open favourite channel ${channel.name}`)
      const art = document.createElement('span')
      art.className = 'home-poster-art home-channel-art'
      if (channel.metadata?.artwork) {
        const image = document.createElement('img')
        image.src = `/api/channel/artwork/${encodeURIComponent(channel.metadata.artwork)}`
        image.alt = ''
        image.loading = 'lazy'
        image.decoding = 'async'
        art.append(image)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = channel.name.slice(0, 1).toUpperCase()
        art.append(placeholder)
      }
      const favourite = document.createElement('span')
      favourite.className = 'home-favourite-mark'
      favourite.textContent = '♥'
      art.append(favourite)
      const badge = document.createElement('span')
      badge.className = 'home-channel-mark'
      badge.textContent = `CH ${channel.number}`
      art.append(badge)
      const copy = document.createElement('span')
      copy.className = 'home-poster-copy'
      const title = document.createElement('strong')
      title.textContent = channel.metadata?.title || channel.name
      const source = document.createElement('small')
      source.textContent = 'Series channel'
      copy.append(title, source)
      card.append(art, copy)
      card.onclick = () => openWatchChannelSheet(channel)
      return card
    }

    function homeAdultSeriesTile(series) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'home-poster-card home-channel-card'
      card.setAttribute('aria-label', `Open favourite series ${series.title}`)
      const art = document.createElement('span')
      art.className = 'home-poster-art home-channel-art'
      art.append(adultSeriesArtwork(series))
      const favourite = document.createElement('span')
      favourite.className = 'home-favourite-mark'
      favourite.textContent = '♥'
      art.append(favourite)
      const copy = document.createElement('span')
      copy.className = 'home-poster-copy'
      const title = document.createElement('strong')
      title.textContent = series.title
      const source = document.createElement('small')
      source.textContent = 'Adult TV series'
      copy.append(title, source)
      card.append(art, copy)
      card.onclick = () => openAdultSeriesSheet(series)
      return card
    }

    function renderHomeLibrary() {
      const search = $('#homeFilmSearch')
      if (!search) return
      const entries = allFilmEntries()
      const query = homeSearchText.trim().toLocaleLowerCase()
      search.value = homeSearchText
      $('#homeFilmSearchClear').classList.toggle('hidden', !homeSearchText)

      const results = query
        ? entries.filter(entry => filmEntrySearchText(entry).includes(query)).slice(0, 18)
        : []
      $('#homeSearchSection').classList.toggle('hidden', !query)
      $('#homeSearchCount').textContent = query ? `${results.length} found` : ''
      const searchRail = $('#homeSearchRail')
      searchRail.innerHTML = ''
      results.forEach(entry => searchRail.append(homePosterTile(entry)))
      if (query && !results.length) {
        const empty = document.createElement('p')
        empty.className = 'home-media-empty'
        empty.textContent = 'No films match that search.'
        searchRail.append(empty)
      }

      const favouriteFilms = entries.filter(entry => entry.film.favourite)
      const favouriteChannels = favouriteSeriesChannels()
      const favouriteSeries = favouriteAdultSeries()
      const favourites = [
        ...favouriteFilms.map(entry => ({ type: 'film', entry,
          title: watchFilmTitle(entry.film) })),
        ...favouriteChannels.map(channel => ({ type: 'channel', channel,
          title: channel.metadata?.title || channel.name })),
        ...favouriteSeries.map(series => ({ type: 'adult-series', series,
          title: series.title })),
      ].sort((left, right) => left.title.localeCompare(
        right.title, undefined, { sensitivity: 'base' }))
      $('#homeFavouritesCount').textContent = favourites.length
        ? `${favourites.length} item${favourites.length === 1 ? '' : 's'}` : ''
      const favouriteRail = $('#homeFavouritesRail')
      favouriteRail.innerHTML = ''
      favourites.forEach(value => favouriteRail.append(value.type === 'film'
        ? homePosterTile(value.entry, 'favourite')
        : value.type === 'adult-series' ? homeAdultSeriesTile(value.series)
          : homeChannelTile(value.channel)))
      $('#homeFavouritesEmpty').classList.toggle('hidden', Boolean(favourites.length))

      const continuing = entries
        .filter(entry => watchFilmResumable(entry.film))
        .sort((left, right) => Number(right.film.remote_last_watched || 0)
          - Number(left.film.remote_last_watched || 0))
        .slice(0, 10)
      $('#homeContinueSection').classList.toggle('hidden', !continuing.length)
      $('#homeContinueCount').textContent = continuing.length
        ? `${continuing.length} in progress` : ''
      const continueRail = $('#homeContinueRail')
      continueRail.innerHTML = ''
      continuing.forEach(entry => continueRail.append(continueWatchCard(entry)))
    }

    async function setFilmFavourite(entry, enabled) {
      const payload = entry.kind === 'adult'
        ? { kind: 'adult', file: entry.film.path, enabled }
        : { kind: 'channel', channel: entry.channel.number,
            file: entry.film.name, enabled }
      await api('/api/favourite', { method: 'POST', body: JSON.stringify(payload) })
      entry.film.favourite = enabled
      renderHomeLibrary()
      renderAdultWatch()
      notice(enabled ? `${watchFilmTitle(entry.film)} was added to Favourites.`
        : `${watchFilmTitle(entry.film)} was removed from Favourites.`)
    }

    async function setChannelFavourite(channel, enabled) {
      await api('/api/favourite', {
        method: 'POST', body: JSON.stringify({
          kind: 'series-channel', channel: channel.number, enabled,
        }),
      })
      channel.favourite = enabled
      renderHomeLibrary()
      notice(enabled ? `${channel.name} was added to Favourites.`
        : `${channel.name} was removed from Favourites.`)
    }

    async function setAdultSeriesFavourite(series, enabled) {
      await api('/api/favourite', { method: 'POST', body: JSON.stringify({
        kind: 'adult-series', series: series.id, enabled,
      }) })
      series.favourite = enabled
      renderHomeLibrary()
      renderAdultSeries(adultSearchText)
      notice(enabled ? `${series.title} was added to Favourites.`
        : `${series.title} was removed from Favourites.`)
    }

    function closeWatchFilmSheet() {
      const dialog = $('#watchFilmSheet')
      if (dialog.open) dialog.close()
      selectedWatchFilm = null
      document.documentElement.style.overflow = ''
    }

    function playWatchFilm(film, position) {
      closeWatchFilmSheet()
      openRemotePlayer({ kind: 'adult', file: film.path }, position)
    }

    function playWatchFilmOnTv(film, position = null) {
      closeWatchFilmSheet()
      playOnTv({
        kind: 'adult',
        file: film.path,
        position: position === null
          ? Number(film.remote_position || 0) : Math.max(0, Number(position) || 0),
      }, watchFilmTitle(film))
    }

    function openWatchFilmSheet(film, context = 'library') {
      selectedWatchFilm = film
      const metadata = film.metadata || {}
      const title = watchFilmTitle(film)
      const resumable = watchFilmResumable(film)
      const streamable = film.browser_ready !== false
      const progress = watchFilmProgress(film)
      const poster = metadata.poster ? artworkUrl(metadata.poster) : ''
      $('#watchFilmBackdrop').style.setProperty('--watch-film-art', poster ? `url("${poster}")` : 'linear-gradient(135deg,#2e3a34,#101513)')
      const posterRoot = $('#watchFilmPoster')
      posterRoot.replaceChildren(filmPoster(film))
      $('#watchFilmEyebrow').textContent = resumable ? 'Continue watching' : streamable ? 'Ready to watch' : 'VLC playback available'
      $('#watchFilmTitle').textContent = title
      const metaRoot = $('#watchFilmMeta')
      metaRoot.innerHTML = ''
      ;[metadata.year, film.folder || 'Adult library', Number(film.remote_duration || 0) > 0 ? watchTimeLabel(film.remote_duration) : 'Film'].filter(Boolean).forEach(value => {
        const span = document.createElement('span')
        span.textContent = value
        metaRoot.append(span)
      })
      $('#watchFilmOverview').textContent = metadata.overview || 'A film from your private MabelTV library.'
      const progressRoot = $('#watchFilmProgress')
      progressRoot.classList.toggle('hidden', !resumable)
      $('#watchFilmProgressLabel').textContent = resumable ? `${Math.round(progress)}% · ${watchTimeLabel(film.remote_position)} watched` : ''
      $('#watchFilmProgressFill').style.width = `${progress}%`
      const availability = $('#watchFilmAvailability')
      availability.classList.toggle('hidden', streamable)
      availability.textContent = streamable ? '' : 'This original can open directly in VLC. Downloading prepares a separate browser-compatible copy for offline MabelTV playback.'
      const favouriteResumeChoice = context === 'favourite' && resumable
      const tvPlay = $('#watchFilmTv')
      tvPlay.querySelector('strong').textContent = favouriteResumeChoice
        ? 'Play on TV' : resumable ? 'Continue on TV' : 'Play on TV'
      tvPlay.querySelector('small').textContent = favouriteResumeChoice
        ? 'Choose continue or start from beginning'
        : resumable ? `Continue from ${watchTimeLabel(film.remote_position)}`
          : 'Replaces what is playing there'
      tvPlay.onclick = favouriteResumeChoice ? () => {
        closeWatchFilmSheet()
        openFilmResumeChoice({
          title, destination: 'Play on TV', position: film.remote_position,
          continueAction: () => playWatchFilmOnTv(film),
          restartAction: () => playWatchFilmOnTv(film, 0),
        })
      } : () => playWatchFilmOnTv(film)
      const herePlay = $('#watchFilmHere')
      herePlay.disabled = false
      herePlay.querySelector('strong').textContent = streamable
        ? favouriteResumeChoice ? 'Play on this device'
          : resumable ? 'Continue on this device' : 'Play on this device'
        : 'Play in VLC'
      herePlay.querySelector('small').textContent = streamable
        ? favouriteResumeChoice ? 'Choose continue or start from beginning'
          : resumable ? `Continue from ${watchTimeLabel(film.remote_position)}`
            : 'Starts an independent stream'
        : 'Opens the original without conversion'
      herePlay.onclick = streamable ? favouriteResumeChoice ? () => {
        closeWatchFilmSheet()
        openFilmResumeChoice({
          title, destination: 'Play on this device', position: film.remote_position,
          continueAction: () => playWatchFilm(film, Number(film.remote_position || 0)),
          restartAction: () => playWatchFilm(film, 0),
        })
      } : () => playWatchFilm(film, resumable ? Number(film.remote_position || 0) : 0)
        : () => { closeWatchFilmSheet(); openInVlc({ kind: 'adult', file: film.path }, title) }
      const favouriteButton = $('#watchFilmFavourite')
      favouriteButton.classList.toggle('active', film.favourite === true)
      favouriteButton.setAttribute('aria-label', film.favourite
        ? 'Remove film from favourites' : 'Add film to favourites')
      favouriteButton.onclick = () => setFilmFavourite(
        adultFilmEntry(film), film.favourite !== true).then(() => {
          favouriteButton.classList.toggle('active', film.favourite === true)
          favouriteButton.setAttribute('aria-label', film.favourite
            ? 'Remove film from favourites' : 'Add film to favourites')
        }).catch(showError)
      const manageFilm = $('#watchFilmManage')
      const managementAvailable = currentPortalDesign === 'experience'
      manageFilm.classList.toggle('hidden', !managementAvailable)
      manageFilm.onclick = managementAvailable ? () => {
        closeWatchFilmSheet()
        openAdultFilmSheet(film)
      } : null
      const dialog = $('#watchFilmSheet')
      if (!dialog.open) dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    }

    function renderWatchCollections(allFilms, folders) {
      const select = $('#watchCollectionSelect')
      select.innerHTML = ''
      folders.forEach(folder => {
        const count = folder === '*' ? allFilms.length : allFilms.filter(film => film.folder === folder).length
        const option = document.createElement('option')
        option.value = folder
        option.textContent = `${folder === '*' ? 'All films' : folder} (${count})`
        select.append(option)
      })
      select.value = watchFolder
    }

    function adultSeriesArtwork(series, className = 'adult-series-card-art') {
      const art = document.createElement('span')
      art.className = className
      const name = series.metadata?.poster
      if (name) {
        const image = document.createElement('img')
        image.src = `/api/adult/series/artwork/${encodeURIComponent(name)}`
        image.alt = ''
        image.loading = 'lazy'
        art.append(image)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = series.title.slice(0, 1).toUpperCase()
        art.append(placeholder)
      }
      return art
    }

    function adultSeasonArtwork(series, episodes, className = 'adult-season-card-art') {
      const art = document.createElement('span')
      art.className = className
      const still = (episodes || []).find(episode => episode.still)?.still
      const name = still || series.metadata?.poster
      if (name) {
        const image = document.createElement('img')
        image.src = `/api/adult/series/artwork/${encodeURIComponent(name)}`
        image.alt = ''
        image.loading = 'lazy'
        art.append(image)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = String((episodes || [])[0]?.season || 1)
        art.append(placeholder)
      }
      return art
    }

    function openAdultSeriesUpload(series, season, isNew = false) {
      const number = Number(season)
      adultSeriesUploadTarget = {
        id: series.id, title: series.title, season: number, isNew,
      }
      $('#adultSeriesUploadEyebrow').textContent = `${series.title} · Series ${number}`
      $('#adultSeriesUploadTitle').textContent = isNew
        ? `Start Series ${number}` : `Add episodes to Series ${number}`
      $('#adultSeriesUploadDescription').textContent = isNew
        ? 'Choose the first episodes for this new series.'
        : 'Every selected episode will be added to this series.'
      $('#adultSeriesUploadDestination').textContent = `${series.title} · Series ${number}`
      $('#adultSeriesUploadDestinationMeta').textContent = isNew
        ? 'This series will appear as soon as its first episode is added.'
        : 'Existing episodes stay exactly where they are.'
      selectedAdultSeriesFiles = []
      renderSelectedAdultSeriesFiles()
      closeAdultSeasonSheet()
      closeAdultSeriesSheet()
      openLibrarySheet($('#adultSeriesUploadSheet'), $('#adultSeriesFile'))
    }

    function openAdultSeriesSourceSheet() {
      const upload = $('#adultSeriesUploadSheet')
      const source = $('#adultSeriesSourceSheet')
      if (!upload || !source || !adultSeriesUploadTarget) return
      adultSeriesSourcePickerOpen = true
      closeLibrarySheet(upload)
      if (!source.open) source.showModal()
      document.documentElement.style.overflow = 'hidden'
    }

    function returnToAdultSeriesUploadSheet() {
      const source = $('#adultSeriesSourceSheet')
      if (source?.open) source.close()
      adultSeriesSourcePickerOpen = false
      if (!adultSeriesUploadTarget) return
      setTimeout(() => openLibrarySheet($('#adultSeriesUploadSheet')), 0)
    }

    function chooseAdultSeriesFiles() {
      const source = $('#adultSeriesSourceSheet')
      if (source?.open) source.close()
      adultSeriesSourcePickerOpen = false
      if (!adultSeriesUploadTarget) return
      setTimeout(() => {
        openLibrarySheet($('#adultSeriesUploadSheet'))
        setTimeout(() => $('#adultSeriesFile')?.click(), 40)
      }, 0)
    }

    function chooseAdultSeriesUsb() {
      const target = adultSeriesUploadTarget
      const source = $('#adultSeriesSourceSheet')
      if (source?.open) source.close()
      adultSeriesSourcePickerOpen = false
      adultSeriesUploadTarget = null
      if (!target) return
      $('#usbTarget').value = 'series'
      $('#usbSeriesName').value = target.title
      $('#usbTarget').dispatchEvent(new Event('change'))
      openView('usb')
      refreshUsb().catch(showError)
    }

    function renderAdultSeries(query = '') {
      if (!$('#adultSeriesSection') || !$('#adultSeriesRail')) return
      const allSeries = library?.adult_series || []
      const search = query.trim().toLocaleLowerCase()
      const series = allSeries.filter(value => !search || [
        value.title, value.stored_title,
        ...(value.episodes || []).map(episode => episode.display_name),
      ].join(' ').toLocaleLowerCase().includes(search))
      $('#adultSeriesSection').classList.toggle('hidden', Boolean(search) && !series.length)
      const rail = $('#adultSeriesRail')
      rail.innerHTML = ''
      series.forEach(value => {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'adult-series-card'
        const art = adultSeriesArtwork(value)
        const progress = document.createElement('span')
        progress.className = 'adult-series-card-progress'
        progress.style.setProperty('--series-progress', `${value.episode_count
          ? value.watched_count / value.episode_count * 100 : 0}%`)
        art.append(progress)
        const copy = document.createElement('span')
        const title = document.createElement('strong')
        title.textContent = value.title
        const meta = document.createElement('small')
        meta.textContent = `${value.season_count} series · ${value.episode_count} episode${value.episode_count === 1 ? '' : 's'} · ${value.watched_count} watched`
        copy.append(title, meta)
        card.append(art, copy)
        card.onclick = () => openAdultSeriesSheet(value)
        rail.append(card)
      })
      if (!allSeries.length) {
        rail.innerHTML = '<div class="adult-series-empty"><strong>No TV series yet</strong><span>Create one here, then upload episodes directly from this device.</span></div>'
      }
    }

    function closeAdultSeriesSheet() {
      const dialog = $('#adultSeriesSheet')
      if (dialog.open) dialog.close()
      selectedAdultSeries = null
      document.documentElement.style.overflow = ''
    }

    function closeAdultSeasonSheet() {
      const dialog = $('#adultSeasonSheet')
      if (dialog?.open) dialog.close()
      selectedAdultSeason = null
      document.documentElement.style.overflow = ''
    }

    function returnToAdultSeriesSheet() {
      const series = selectedAdultSeason?.series
      closeAdultSeasonSheet()
      if (series) openAdultSeriesSheet(series)
    }

    function returnFromAdultSeriesRestartSheet() {
      const target = adultSeriesRestartTarget
      const dialog = $('#adultSeriesRestartSheet')
      if (dialog?.open) dialog.close()
      adultSeriesRestartTarget = null
      document.documentElement.style.overflow = ''
      if (!target) return
      const series = library?.adult_series?.find(value => value.id === target.seriesId)
      if (!series) return
      setTimeout(() => target.scope === 'season'
        ? openAdultSeasonSheet(series, target.season)
        : openAdultSeriesSheet(series), 0)
    }

    function openAdultSeriesRestartSheet(series, season = null) {
      const current = library?.adult_series?.find(value => value.id === series.id) || series
      const scope = season === null ? 'series' : 'season'
      const seasonNumber = season === null ? null : Number(season)
      adultSeriesRestartTarget = {
        seriesId: current.id,
        seriesTitle: current.title,
        scope,
        season: seasonNumber,
      }
      $('#adultSeriesRestartTitle').textContent = scope === 'season'
        ? `Restart Series ${seasonNumber}?` : `Restart all of ${current.title}?`
      $('#adultSeriesRestartDescription').textContent = scope === 'season'
        ? 'Every episode in this series will be marked unwatched and lose its resume point.'
        : 'Every episode in every series will be marked unwatched and lose its resume point.'
      $('#adultSeriesRestartTarget').textContent = scope === 'season'
        ? `${current.title} · Series ${seasonNumber}` : current.title
      closeAdultSeasonSheet()
      closeAdultSeriesSheet()
      const dialog = $('#adultSeriesRestartSheet')
      if (!dialog.open) dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    }

    async function confirmAdultSeriesRestart() {
      const target = adultSeriesRestartTarget
      const button = $('#adultSeriesRestartConfirm')
      if (!target || button.disabled) return
      button.disabled = true
      try {
        const result = await api('/api/adult/series/restart', {
          method: 'POST', body: JSON.stringify({
            series: target.seriesId,
            scope: target.scope,
            season: target.season,
          }),
        })
        const dialog = $('#adultSeriesRestartSheet')
        if (dialog.open) dialog.close()
        adultSeriesRestartTarget = null
        await reloadLibraryWithoutLosingPlace()
        const series = library?.adult_series?.find(value => value.id === target.seriesId)
        if (series) setTimeout(() => target.scope === 'season'
          ? openAdultSeasonSheet(series, target.season)
          : openAdultSeriesSheet(series), 0)
        notice(`${result.episodes_reset} episode${result.episodes_reset === 1 ? '' : 's'} ready to watch from the beginning.`)
      } catch (error) {
        showError(error)
      } finally {
        button.disabled = false
      }
    }

    function closeAdultEpisodeSheet() {
      const dialog = $('#adultEpisodeSheet')
      if (dialog.open) dialog.close()
      selectedAdultEpisode = null
      document.documentElement.style.overflow = ''
    }

    function closeAdultEpisodeMoreSheet(restoreParent = true) {
      const dialog = $('#adultEpisodeMoreSheet')
      if (dialog?.open) dialog.close()
      document.documentElement.style.overflow = ''
      if (!restoreParent) return
      const returnToParent = adultEpisodeMoreReturn
      adultEpisodeMoreReturn = null
      if (typeof returnToParent === 'function') returnToParent()
    }

    function returnToAdultSeasonSheet() {
      const selection = selectedAdultEpisode
      closeAdultEpisodeSheet()
      if (selection?.returnTo) selection.returnTo()
    }

    function openAdultEpisodeSheet(series, episode, returnTo = null) {
      const current = library?.adult_series?.find(value => value.id === series.id) || series
      const defaultReturn = () => {
        if (current?.id) openAdultSeasonSheet(current, episode.season)
      }
      selectedAdultEpisode = {
        series: current,
        season: episode.season,
        episode,
        returnTo: returnTo || defaultReturn,
      }
      $('#adultEpisodeEyebrow').textContent = `${series.title} · Series ${episode.season}`
      $('#adultEpisodeTitle').textContent = episode.display_name
      $('#adultEpisodeMeta').textContent = `S${String(episode.season).padStart(2, '0')} E${String(episode.episode).padStart(2, '0')}${episode.watched ? ' · Watched' : episode.remote_position > 0 ? ` · ${watchTimeLabel(episode.remote_position)} watched` : ''}`
      const source = { kind: 'adult-series', series: series.id,
        file: episode.path, position: Number(episode.remote_position || 0) }
      $('#adultEpisodeTv').onclick = () => {
        closeAdultEpisodeSheet()
        playOnTv(source, episode.display_name)
      }
      const here = $('#adultEpisodeHere')
      here.querySelector('strong').textContent = episode.browser_ready
        ? episode.remote_position > 10 ? 'Continue on this device' : 'Watch on this device'
        : 'Play in VLC'
      here.querySelector('small').textContent = episode.browser_ready
        ? episode.remote_position > 10 ? `Continue from ${watchTimeLabel(episode.remote_position)}` : 'Starts an independent stream'
        : 'Open the original file without conversion'
      here.onclick = () => {
        closeAdultEpisodeSheet()
        if (episode.browser_ready) openRemotePlayer(source, episode.remote_position)
        else openInVlc(source, episode.display_name)
      }
      const watched = $('#adultEpisodeWatched')
      watched.querySelector('strong').textContent = episode.watched
        ? 'Mark as unwatched' : 'Mark watched'
      watched.querySelector('small').textContent = episode.watched
        ? 'Put this episode back in your unwatched list'
        : 'Useful after watching this episode in VLC'
      watched.onclick = async () => {
        watched.disabled = true
        try {
          await api('/api/adult/series/watched', { method: 'POST', body: JSON.stringify({
            series: series.id, file: episode.path, watched: !episode.watched,
          }) })
          episode.watched = !episode.watched
          if (episode.watched) {
            episode.remote_position = 0
            episode.remote_last_watched = 0
          }
          series.watched_count += episode.watched ? 1 : -1
          closeAdultEpisodeSheet()
          openAdultSeasonSheet(series, episode.season)
          renderAdultWatch()
          renderHomeLibrary()
        } catch (error) { showError(error); watched.disabled = false }
      }
      $('#adultEpisodeMore').onclick = () => {
        $('#adultEpisodeMoreEyebrow').textContent = `${series.title} · Series ${episode.season}`
        $('#adultEpisodeMoreTitle').textContent = episode.display_name
        $('#adultEpisodeMoreMeta').textContent = `S${String(episode.season).padStart(2, '0')} E${String(episode.episode).padStart(2, '0')} · More episode options`
        adultEpisodeMoreReturn = () => openAdultEpisodeSheet(current, episode, returnTo)
        closeAdultEpisodeSheet()
        const dialog = $('#adultEpisodeMoreSheet')
        if (!dialog.open) dialog.showModal()
        document.documentElement.style.overflow = 'hidden'
      }
      $('#adultEpisodeDownload').onclick = () => {
        closeAdultEpisodeMoreSheet(false)
        downloadToDevice(source, `${series.title} - ${episode.display_name}`)
      }
      $('#adultEpisodeDelete').onclick = async () => {
        if (!confirm(`Move “${episode.display_name}” to the recycle bin?`)) return
        closeAdultEpisodeMoreSheet(false)
        try {
          await manage('trash-adult-series', {
            series: series.id, scope: 'episode', file: episode.path,
          })
          notice('Episode moved to the recycle bin.')
          const updated = library?.adult_series?.find(value => value.id === series.id)
          if (updated && updated.episodes.some(value => Number(value.season) === Number(episode.season))) {
            openAdultSeasonSheet(updated, episode.season)
          } else if (updated) {
            openAdultSeriesSheet(updated)
          }
        } catch (error) { showError(error) }
      }
      const dialog = $('#adultEpisodeSheet')
      if (!dialog.open) dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    }

    function openAdultSeasonSheet(series, season) {
      const current = library?.adult_series?.find(value => value.id === series.id) || series
      const number = Number(season)
      const episodes = (current.episodes || []).filter(episode => Number(episode.season) === number)
      selectedAdultSeason = { series: current, season: number }
      $('#adultSeasonEyebrow').textContent = current.title
      $('#adultSeasonTitle').textContent = `Series ${number}`
      const watched = episodes.filter(episode => episode.watched).length
      $('#adultSeasonMeta').textContent = `${episodes.length} episode${episodes.length === 1 ? '' : 's'} · ${watched} watched`
      $('#adultSeasonArtwork').replaceChildren(adultSeasonArtwork(
        current, episodes, 'adult-season-sheet-artwork'))
      $('#adultSeasonUploadHint').textContent = `Upload directly into Series ${number}`
      $('#adultSeasonEpisodeTitle').textContent = `Series ${number} episodes`
      $('#adultSeasonEpisodeCount').textContent = `${episodes.length} total`
      const root = $('#adultSeasonEpisodes')
      root.replaceChildren()
      episodes.forEach(episode => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `adult-series-episode${episode.watched ? ' is-watched' : ''}`
        const artwork = document.createElement('span')
        artwork.className = 'adult-series-episode-art'
        if (episode.still) {
          const image = document.createElement('img')
          image.src = `/api/adult/series/artwork/${encodeURIComponent(episode.still)}`
          image.alt = ''
          image.loading = 'lazy'
          artwork.append(image)
        }
        const numberBadge = document.createElement('span')
        numberBadge.className = 'adult-series-episode-number'
        numberBadge.textContent = `E${String(episode.episode).padStart(2, '0')}`
        artwork.append(numberBadge)
        const copy = document.createElement('span')
        copy.className = 'adult-series-episode-copy'
        const title = document.createElement('strong')
        title.textContent = episode.display_name
        const detail = document.createElement('small')
        detail.textContent = episode.watched ? 'Watched' : episode.remote_position > 10
          ? `Continue · ${watchTimeLabel(episode.remote_position)}`
          : episode.browser_ready ? 'Watch here or on TV' : 'VLC or TV'
        copy.append(title, detail)
        const progress = watchFilmProgress(episode)
        if (progress > 0 && !episode.watched) row.classList.add('has-progress')
        row.style.setProperty('--episode-progress', `${progress}%`)
        row.append(artwork, copy, librarySignalIcon('signal-chevron-right'))
        row.onclick = () => {
          closeAdultSeasonSheet()
          openAdultEpisodeSheet(current, episode)
        }
        root.append(row)
      })
      if (!episodes.length) {
        root.innerHTML = '<div class="adult-series-empty"><strong>No episodes in this series</strong><span>Add prepared videos directly from this phone or computer.</span></div>'
      }
      $('#adultSeasonUpload').onclick = () => openAdultSeriesUpload(current, number)
      $('#adultSeasonMetadata').disabled = !tmdbConfigured
      $('#adultSeasonMetadata').onclick = () => {
        closeAdultSeasonSheet()
        scanAdultSeriesTmdb(current)
      }
      $('#adultSeasonRestart').onclick = () => openAdultSeriesRestartSheet(current, number)
      $('#adultSeasonDelete').onclick = async () => {
        if (!confirm(`Move every episode in Series ${number} of “${current.title}” to the recycle bin?`)) return
        closeAdultSeasonSheet()
        try {
          await manage('trash-adult-series', {
            series: current.id, scope: 'season', season: number,
          })
          notice(`Series ${number} moved to the recycle bin.`)
          const updated = library?.adult_series?.find(value => value.id === current.id)
          if (updated) openAdultSeriesSheet(updated)
        } catch (error) { showError(error) }
      }
      const dialog = $('#adultSeasonSheet')
      if (!dialog.open) dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    }

    function openAdultSeriesSheet(series) {
      const current = library?.adult_series?.find(value => value.id === series.id) || series
      selectedAdultSeries = current
      $('#adultSeriesSheetTitle').textContent = current.title
      $('#adultSeriesSheetMeta').textContent = `${current.season_count} series · ${current.episode_count} episodes · ${current.watched_count} watched`
      $('#adultSeriesOverview').textContent = current.metadata?.overview
        || 'Choose an episode, or match this series with TMDB to add descriptions and artwork.'
      $('#adultSeriesSheetPoster').replaceChildren(adultSeriesArtwork(
        current, 'adult-series-sheet-art'))
      const favourite = $('#adultSeriesFavourite')
      favourite.classList.toggle('active', current.favourite === true)
      favourite.setAttribute('aria-label', current.favourite
        ? 'Remove series from favourites' : 'Add series to favourites')
      favourite.onclick = () => setAdultSeriesFavourite(current, current.favourite !== true)
        .then(() => {
          favourite.classList.toggle('active', current.favourite === true)
          favourite.setAttribute('aria-label', current.favourite
            ? 'Remove series from favourites' : 'Add series to favourites')
        }).catch(showError)
      const root = $('#adultSeriesEpisodes')
      root.innerHTML = ''
      const groups = new Map()
      ;(current.episodes || []).forEach(episode => {
        if (!groups.has(episode.season)) groups.set(episode.season, [])
        groups.get(episode.season).push(episode)
      })
      $('#adultSeriesSeasonCount').textContent = `${groups.size} series`
      ;[...groups.entries()].sort((left, right) => left[0] - right[0]).forEach(([season, episodes]) => {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'adult-season-card'
        const art = adultSeasonArtwork(current, episodes)
        const shade = document.createElement('span')
        shade.className = 'adult-season-card-shade'
        const copy = document.createElement('span')
        copy.className = 'adult-season-card-copy'
        const kicker = document.createElement('span')
        kicker.textContent = `${current.title} · ${episodes.length} episode${episodes.length === 1 ? '' : 's'}`
        const heading = document.createElement('strong')
        heading.textContent = `Series ${season}`
        const detail = document.createElement('small')
        const watched = episodes.filter(episode => episode.watched).length
        detail.textContent = watched ? `${watched} watched · Open series` : 'Open series'
        copy.append(kicker, heading, detail)
        const progress = document.createElement('span')
        progress.className = 'adult-season-card-progress'
        progress.style.setProperty('--season-progress', `${episodes.length ? watched / episodes.length * 100 : 0}%`)
        card.append(art, shade, copy, progress, librarySignalIcon('signal-chevron-right', 'icon adult-season-card-chevron'))
        card.onclick = () => {
          closeAdultSeriesSheet()
          openAdultSeasonSheet(current, season)
        }
        root.append(card)
      })
      const nextSeries = Math.max(0, ...[...groups.keys()].map(Number)) + 1
      const addCard = document.createElement('button')
      addCard.type = 'button'
      addCard.className = 'adult-season-add-card'
      addCard.append(librarySignalIcon('signal-plus'), document.createElement('span'))
      addCard.querySelector('span').innerHTML = `<strong>Start Series ${nextSeries}</strong><small>Upload its first episodes</small>`
      addCard.onclick = () => openAdultSeriesUpload(current, nextSeries, true)
      root.append(addCard)
      $('#adultSeriesMetadata').disabled = !tmdbConfigured
      $('#adultSeriesMetadata').onclick = () => {
        closeAdultSeriesSheet()
        scanAdultSeriesTmdb(current)
      }
      $('#adultSeriesRestart').onclick = () => openAdultSeriesRestartSheet(current)
      $('#adultSeriesDelete').onclick = async () => {
        if (!confirm(`Move the complete “${current.title}” show and every series and episode to the recycle bin?`)) return
        closeAdultSeriesSheet()
        try {
          await manage('trash-adult-series', { series: current.id, scope: 'series' })
          notice(`${current.title} moved to the recycle bin.`)
        } catch (error) { showError(error) }
      }
      const dialog = $('#adultSeriesSheet')
      if (!dialog.open) dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    }

    async function scanAdultSeriesTmdb(series) {
      try {
        notice(`Searching TMDB for ${series.title}…`)
        const result = await api('/api/tmdb/adult-series/search', {
          method: 'POST', body: JSON.stringify({ series: series.id })
        })
        $('#tmdbDialogTitle').textContent = `Match “${result.query}”`
        const root = $('#tmdbResults')
        root.innerHTML = ''
        if (!result.results.length) root.innerHTML = '<div class="empty"><strong>No matches found</strong>Try creating the series with its full name.</div>'
        result.results.forEach(match => {
          const row = document.createElement('article')
          row.className = 'tmdb-result'
          const poster = document.createElement('span')
          poster.className = 'tmdb-result-poster'
          poster.append(librarySignalIcon('signal-tv'))
          const copy = document.createElement('div')
          copy.innerHTML = `<strong>${escapeHtml(match.title)}${match.year ? ` (${escapeHtml(match.year)})` : ''}</strong><p>${escapeHtml(match.overview || 'No description supplied.')}</p>`
          const choose = document.createElement('button')
          choose.type = 'button'; choose.className = 'primary tmdb-result-choose'
          choose.textContent = 'Use this series'
          choose.onclick = async () => {
            choose.disabled = true
            try {
              notice('Matching seasons and episodes…')
              await api('/api/tmdb/adult-series/apply', { method: 'POST', body: JSON.stringify({
                series: series.id, tmdb_id: match.id,
              }) })
              $('#tmdbDialog').close()
              await reloadLibraryWithoutLosingPlace()
              notice('Series, season and episode metadata was saved locally.')
            } catch (error) { showError(error); choose.disabled = false }
          }
          row.append(poster, copy, choose)
          root.append(row)
        })
        $('#tmdbDialog').showModal()
        notice('')
      } catch (error) { showError(error) }
    }

    function renderAdultWatch() {
      const adult = $('#remoteAdult')
      adult.innerHTML = ''
      const allFilms = [...(library?.adult_library || [])].sort((left, right) => watchFilmTitle(left).localeCompare(watchFilmTitle(right), undefined, { sensitivity: 'base' }))
      const folders = ['*', ...(library?.adult_folders || [])]
      if (!folders.includes(watchFolder)) watchFolder = '*'
      renderWatchCollections(allFilms, folders)
      const collectionName = watchFolder === '*' ? 'All films' : watchFolder
      $('#watchSearch').value = watchSearchText
      $('#watchSearchClear').classList.toggle('hidden', !watchSearchText)

      const query = watchSearchText.trim().toLocaleLowerCase()
      renderAdultSeries(watchSearchText)
      const resumableFilms = allFilms
        .filter(film => film.browser_ready !== false && watchFilmResumable(film))
        .map(film => ({ ...adultFilmEntry(film),
          lastWatched: Number(film.remote_last_watched || 0) }))
      const resumable = [...resumableFilms, ...adultSeriesContinueEntries()]
        .sort((left, right) => Number(right.lastWatched || 0) - Number(left.lastWatched || 0))
        .slice(0, 10)
      const continueSection = $('#watchContinueSection')
      continueSection.classList.toggle('hidden', !resumable.length || Boolean(query))
      $('#watchContinueCount').textContent = resumable.length ? `${resumable.length} in progress` : ''
      const continueRail = $('#watchContinueRail')
      continueRail.innerHTML = ''
      resumable.forEach(entry => continueRail.append(continueWatchCard(entry)))

      const films = allFilms.filter(film => {
        // Search is always global. A film should never look missing merely
        // because someone last browsed a different collection.
        if (!query && watchFolder !== '*' && film.folder !== watchFolder) return false
        if (!query) return true
        const metadata = film.metadata || {}
        return [watchFilmTitle(film), film.display_name, film.folder, metadata.year].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)
      })
      $('#watchLibraryKicker').textContent = query ? 'Search all films' : 'Your library'
      $('#watchLibraryTitle').textContent = query ? `“${watchSearchText.trim()}”` : collectionName
      $('#watchLibraryCount').textContent = `${films.length} film${films.length === 1 ? '' : 's'}`
      const grid = document.createElement('div')
      grid.className = 'watch-poster-grid'
      films.forEach(film => grid.append(adultWatchCard(film)))
      if (!films.length) {
        const empty = document.createElement('div')
        empty.className = 'watch-empty'
        empty.innerHTML = query ? '<strong>No matches</strong><br>Try another title or clear your filters.' : '<strong>Nothing here yet</strong><br>This collection has no films matching the current filters.'
        grid.append(empty)
      }
      adult.append(grid)
    }

    function closeWatchProgrammeSheet() {
      const dialog = $('#watchProgrammeSheet')
      if (dialog.open) dialog.close()
      selectedWatchProgramme = null
      document.documentElement.style.overflow = ''
    }

    function closeWatchProgrammeMoreSheet(restoreParent = true) {
      const dialog = $('#watchProgrammeMoreSheet')
      if (dialog.open) dialog.close()
      document.documentElement.style.overflow = ''
      if (!restoreParent) {
        watchProgrammeMoreReturn = null
        return
      }
      const returnToParent = watchProgrammeMoreReturn
      watchProgrammeMoreReturn = null
      if (typeof returnToParent === 'function') returnToParent()
    }

    function closeWatchProgrammeEpisodeMoreSheet(restoreParent = true) {
      const dialog = $('#watchProgrammeEpisodeMoreSheet')
      if (dialog?.open) dialog.close()
      document.documentElement.style.overflow = ''
      if (!restoreParent) {
        watchProgrammeEpisodeMoreReturn = null
        return
      }
      const returnToParent = watchProgrammeEpisodeMoreReturn
      watchProgrammeEpisodeMoreReturn = null
      if (typeof returnToParent === 'function') returnToParent()
    }

    function closeWatchChannelSheet() {
      const dialog = $('#watchChannelSheet')
      if (dialog?.open) dialog.close()
      document.documentElement.style.overflow = ''
    }

    function openWatchChannelSheet(channel) {
      const programme = (channel.programmes || []).find(value =>
        value.name === channel.resume_file && value.enabled !== false)
        || (channel.programmes || []).find(value => value.enabled !== false)
      const title = channel.metadata?.title || channel.name
      const position = Math.max(0, Number(channel.resume_position) || 0)
      const episodeTitle = channel.resume_title || programme?.display_name || ''
      $('#watchChannelEyebrow').textContent = `CH ${channel.number} · Series channel`
      $('#watchChannelTitle').textContent = title
      $('#watchChannelMeta').textContent = [
        `${channel.programmes.length} episode${channel.programmes.length === 1 ? '' : 's'}`,
        episodeTitle && position > 0
          ? `${episodeTitle} · ${watchTimeLabel(position)} in`
          : episodeTitle,
      ].filter(Boolean).join(' · ')

      const tv = $('#watchChannelTv')
      tv.disabled = !programme || !channel.enabled
      tv.querySelector('strong').textContent = position > 10 ? 'Continue on TV' : 'Play on TV'
      tv.querySelector('small').textContent = !channel.enabled
        ? 'This channel is hidden from the television'
        : position > 10 ? `Continue ${episodeTitle} from ${watchTimeLabel(position)}`
          : episodeTitle ? `Start with ${episodeTitle}` : 'This channel has no available episodes'
      tv.onclick = programme && channel.enabled ? () => {
        closeWatchChannelSheet()
        playOnTv({ kind: 'channel', channel: channel.number,
          file: programme.name, position }, title)
      } : null

      const here = $('#watchChannelHere')
      here.disabled = !programme
      const browserReady = programme?.browser_ready !== false
      here.querySelector('strong').textContent = !browserReady
        ? 'Play current episode in VLC'
        : position > 10 ? 'Continue on this device' : 'Play on this device'
      here.querySelector('small').textContent = !programme
        ? 'This channel has no available episodes'
        : !browserReady ? `${episodeTitle} needs VLC on this device`
          : position > 10 ? `Continue ${episodeTitle} from ${watchTimeLabel(position)}`
            : `Start with ${episodeTitle}`
      here.onclick = programme ? () => {
        closeWatchChannelSheet()
        const source = { kind: 'channel', channel: channel.number,
          file: programme.name, position }
        if (browserReady) openRemotePlayer(source, position)
        else openInVlc(source, title)
      } : null

      const favourite = $('#watchChannelFavourite')
      favourite.classList.toggle('active', channel.favourite === true)
      favourite.setAttribute('aria-label', channel.favourite
        ? 'Remove channel from favourites' : 'Add channel to favourites')
      favourite.onclick = () => setChannelFavourite(
        channel, channel.favourite !== true).then(() => {
          favourite.classList.toggle('active', channel.favourite === true)
          favourite.setAttribute('aria-label', channel.favourite
            ? 'Remove channel from favourites' : 'Add channel to favourites')
        }).catch(showError)
      $('#watchChannelOpen').onclick = () => {
        closeWatchChannelSheet()
        openChannel(channel, false)
      }
      const dialog = $('#watchChannelSheet')
      if (!dialog.open) dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    }

    function openWatchProgrammeSheet(channel, programme, context = 'library', returnTo = null) {
      selectedWatchProgramme = { channel, programme, context, returnTo }
      const metadata = programme.metadata || {}
      const title = metadata.title || programme.display_name
      const filmChannel = channel.content_type === 'films'
      const resumable = filmChannel && watchFilmResumable(programme)
      const favouriteResumeChoice = context === 'favourite' && resumable
      $('#watchProgrammeEyebrow').textContent = `CH ${channel.number} · ${channel.name}`
      $('#watchProgrammeTitle').textContent = title
      $('#watchProgrammeMeta').textContent = [metadata.year, resumable ? `Resume at ${watchTimeLabel(programme.remote_position)}` : filmChannel ? 'Film' : 'MabelTV programme'].filter(Boolean).join(' · ')
      $('#watchProgrammeTv').querySelector('strong').textContent = favouriteResumeChoice
        ? 'Play on TV' : resumable ? 'Continue on TV' : 'Play on TV'
      $('#watchProgrammeTv').querySelector('small').textContent = favouriteResumeChoice
        ? 'Choose continue or start from beginning'
        : resumable ? `Continue from ${watchTimeLabel(programme.remote_position)}`
          : 'Replaces what is playing there'
      $('#watchProgrammeTv').onclick = favouriteResumeChoice ? () => {
        closeWatchProgrammeSheet()
        openFilmResumeChoice({
          title, destination: 'Play on TV', position: programme.remote_position,
          continueAction: () => playOnTv({ kind: 'channel', channel: channel.number,
            file: programme.name, position: Number(programme.remote_position || 0) }, title),
          restartAction: () => playOnTv({ kind: 'channel', channel: channel.number,
            file: programme.name, position: 0 }, title),
        })
      } : () => {
        closeWatchProgrammeSheet()
        playOnTv({ kind: 'channel', channel: channel.number, file: programme.name,
          position: filmChannel ? Number(programme.remote_position || 0) : undefined }, title)
      }
      const here = $('#watchProgrammeHere')
      here.disabled = false
      here.querySelector('strong').textContent = programme.browser_ready === false
        ? 'Play in VLC' : favouriteResumeChoice ? 'Play on this device'
          : resumable ? 'Continue on this device' : 'Play on this device'
      here.querySelector('small').textContent = programme.browser_ready === false
        ? 'Opens the original without conversion'
        : favouriteResumeChoice ? 'Choose continue or start from beginning'
          : resumable ? `Continue from ${watchTimeLabel(programme.remote_position)}`
            : 'Starts an independent stream'
      const source = { kind: 'channel', channel: channel.number, file: programme.name }
      if (filmChannel) source.position = Number(programme.remote_position || 0)
      here.onclick = favouriteResumeChoice && programme.browser_ready !== false ? () => {
        closeWatchProgrammeSheet()
        openFilmResumeChoice({
          title, destination: 'Play on this device', position: programme.remote_position,
          continueAction: () => openRemotePlayer({ kind: 'channel',
            channel: channel.number, file: programme.name,
            position: Number(programme.remote_position || 0) }, Number(programme.remote_position || 0)),
          restartAction: () => openRemotePlayer({ kind: 'channel',
            channel: channel.number, file: programme.name, position: 0 }, 0),
        })
      } : () => {
        closeWatchProgrammeSheet()
        if (programme.browser_ready === false) openInVlc(source, title)
        else openRemotePlayer(source, filmChannel ? Number(programme.remote_position || 0) : 0)
      }
      $('#watchProgrammeDownload').onclick = () => {
        closeWatchProgrammeMoreSheet(false)
        downloadToDevice(source, title)
      }
      const filmTools = $('#watchProgrammeFilmTools')
      filmTools.classList.toggle('hidden', !filmChannel)
      if (filmChannel) filmTools.style.removeProperty('display')
      else filmTools.style.setProperty('display', 'none', 'important')

      const episodeTools = $('#watchProgrammeEpisodeTools')
      episodeTools.classList.toggle('hidden', filmChannel)
      if (filmChannel) episodeTools.style.setProperty('display', 'none', 'important')
      else episodeTools.style.removeProperty('display')
      const progressNote = $('#watchProgrammeSheet .watch-programme-note')
      progressNote.classList.toggle('hidden', !filmChannel)
      if (!filmChannel) {
        $('#watchProgrammeEpisodeMore').onclick = () => {
          watchProgrammeEpisodeMoreReturn = () => openWatchProgrammeSheet(channel, programme, context, selectedWatchProgramme.returnTo)
          closeWatchProgrammeSheet()
          $('#watchProgrammeEpisodeMoreEyebrow').textContent = `CH ${channel.number} · ${channel.name}`
          $('#watchProgrammeEpisodeMoreTitle').textContent = title
          $('#watchProgrammeEpisodeMoreMeta').textContent = 'More episode options'
          const dialog = $('#watchProgrammeEpisodeMoreSheet')
          if (!dialog.open) dialog.showModal()
          document.documentElement.style.overflow = 'hidden'
        }
        $('#watchProgrammeEpisodeDownload').onclick = () => {
          closeWatchProgrammeEpisodeMoreSheet(false)
          downloadToDevice(source, title)
        }
        const toggleButton = $('#watchProgrammeEpisodeToggle')
        toggleButton.querySelector('strong').textContent = programme.enabled ? 'Hide from TV' : 'Show on TV'
        toggleButton.querySelector('small').textContent = programme.enabled
          ? 'Keep the episode without showing it on this channel'
          : 'Put this episode back on its channel'
        toggleButton.onclick = () => {
          closeWatchProgrammeEpisodeMoreSheet(false)
          manage('toggle-programme', { channel: channel.number, file: programme.name })
        }
        $('#watchProgrammeEpisodeRename').onclick = () => {
          closeWatchProgrammeEpisodeMoreSheet(false)
          renameProgramme(channel, programme)
        }
        $('#watchProgrammeEpisodeBin').onclick = () => {
          closeWatchProgrammeEpisodeMoreSheet(false)
          if (confirm(`Move “${title}” to the recycle bin?`)) {
            manage('trash', { channel: channel.number, file: programme.name })
          }
        }
      }

      const moreButton = $('#watchProgrammeMore')
      moreButton.onclick = filmChannel ? () => {
        watchProgrammeMoreReturn = () => openWatchProgrammeSheet(channel, programme, context, selectedWatchProgramme.returnTo)
        closeWatchProgrammeSheet()
        $('#watchProgrammeMoreEyebrow').textContent = `CH ${channel.number} · ${channel.name}`
        $('#watchProgrammeMoreTitle').textContent = title
        $('#watchProgrammeMoreMeta').textContent = [metadata.year, 'More film options'].filter(Boolean).join(' · ')
        const moreDialog = $('#watchProgrammeMoreSheet')
        if (!moreDialog.open) moreDialog.showModal()
        document.documentElement.style.overflow = 'hidden'
      } : null

      const metadataButton = $('#watchProgrammeMetadata')
      metadataButton.disabled = !tmdbConfigured
      metadataButton.onclick = filmChannel && tmdbConfigured ? () => {
        closeWatchProgrammeMoreSheet(false)
        scanProgrammeTmdb(channel, programme)
      } : null

      const favouriteButton = $('#watchProgrammeFavourite')
      favouriteButton.classList.toggle('hidden', !filmChannel)
      favouriteButton.classList.toggle('active', programme.favourite === true)
      favouriteButton.setAttribute('aria-label', programme.favourite
        ? 'Remove film from favourites' : 'Add film to favourites')
      favouriteButton.onclick = filmChannel ? () => setFilmFavourite(
        { kind: 'channel', channel, film: programme }, programme.favourite !== true
      ).then(() => {
        favouriteButton.classList.toggle('active', programme.favourite === true)
        favouriteButton.setAttribute('aria-label', programme.favourite
          ? 'Remove film from favourites' : 'Add film to favourites')
      }).catch(showError) : null

      const toggleButton = $('#watchProgrammeToggle')
      toggleButton.querySelector('strong').textContent = programme.enabled ? 'Hide from TV' : 'Show on TV'
      toggleButton.querySelector('small').textContent = programme.enabled
        ? 'Keep the film without showing it on this channel'
        : 'Return the film to this TV channel'
      toggleButton.onclick = filmChannel ? () => {
        closeWatchProgrammeMoreSheet(false)
        manage('toggle-programme', { channel: channel.number, file: programme.name })
      } : null

      const renameButton = $('#watchProgrammeRename')
      renameButton.onclick = filmChannel ? () => {
        closeWatchProgrammeMoreSheet(false)
        renameProgramme(channel, programme)
      } : null

      const binButton = $('#watchProgrammeBin')
      binButton.onclick = filmChannel ? () => {
        closeWatchProgrammeMoreSheet(false)
        if (confirm(`Move “${title}” to the recycle bin?`)) {
          manage('trash', { channel: channel.number, file: programme.name })
        }
      } : null

      const moveButton = $('#watchProgrammeMove')
      const otherFilmChannels = (library?.channels || [])
        .filter(value => value.content_type === 'films' && Number(value.number) !== Number(channel.number))
        .sort((left, right) => Number(left.number) - Number(right.number))
      if (filmChannel && otherFilmChannels.length) {
        moveButton.disabled = false
        moveButton.querySelector('small').textContent = otherFilmChannels.length === 1
          ? `Move to CH ${otherFilmChannels[0].number} · ${otherFilmChannels[0].name}`
          : `Choose from ${otherFilmChannels.length} other film channels`
        moveButton.onclick = () => {
          closeWatchProgrammeMoreSheet(false)
          $('#watchProgrammeMoveTitle').textContent = `Move “${title}”`
          const options = $('#watchProgrammeChannelOptions')
          options.innerHTML = ''
          otherFilmChannels.forEach(value => {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'watch-film-play'
            button.setAttribute('aria-label', `Move ${title} to CH ${value.number}, ${value.name}`)
            const icon = document.createElement('span')
            icon.className = 'watch-action-icon'
            icon.textContent = String(value.number)
            const copy = document.createElement('span')
            const heading = document.createElement('strong')
            heading.textContent = `CH ${value.number} · ${value.name}`
            const hint = document.createElement('small')
            hint.textContent = 'Move this film here'
            copy.append(heading, hint)
            button.append(icon, copy)
            button.onclick = () => {
              closeLibrarySheet($('#watchProgrammeMoveSheet'))
              manage('move-programme', {
                channel: channel.number,
                file: programme.name,
                target_channel: value.number
              }, value.number)
            }
            options.append(button)
          })
          openLibrarySheet($('#watchProgrammeMoveSheet'))
        }
      } else {
        moveButton.disabled = true
        moveButton.querySelector('small').textContent = 'Create another film channel to move this film'
        moveButton.onclick = null
      }
      const dialog = $('#watchProgrammeSheet')
      if (!dialog.open) dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    }

    async function renderDownloads() {
      const root = $('#downloadsGrid')
      $('#offlineModeBanner').classList.toggle('hidden', navigator.onLine && !offlineMode)
      if (!offlineStorageReady || !window.MabelOffline) {
        root.innerHTML = offlineSetupMarkup()
        $('#downloadsStorage').textContent = 'Setup needed'
        return
      }
      let downloads = []
      try { downloads = await window.MabelOffline.listDownloads() }
      catch (error) {
        root.innerHTML = `<div class="downloads-empty"><strong>Downloads could not be opened</strong>${escapeHtml(error.message)}</div>`
        return
      }
      if (navigator.storage?.estimate) {
        try {
          const estimate = await navigator.storage.estimate()
          $('#downloadsStorage').textContent = `${window.MabelOffline.formatBytes(estimate.usage || 0)} used on this device`
        } catch (_) { $('#downloadsStorage').textContent = `${downloads.length} saved` }
      } else $('#downloadsStorage').textContent = `${downloads.length} saved`
      root.innerHTML = ''
      const completedIds = new Set(downloads.map(item => item.id))
      pendingDownloads.forEach((pending, key) => {
        if (pending.manifest?.id && completedIds.has(pending.manifest.id)) return
        const card = document.createElement('article')
        card.className = 'download-card'
        const bad = pending.phase === 'error'
        card.innerHTML = `<div class="download-card-head"><span class="download-card-icon">↓</span><span class="download-card-copy"><strong>${escapeHtml(pending.title)}</strong><small class="${bad ? 'bad' : 'download-preparing'}">${escapeHtml(pending.message || 'Preparing download…')}</small></span></div>`
        if (!bad) {
          const progress = document.createElement('progress')
          progress.removeAttribute('value')
          card.append(progress)
        } else {
          const actions = document.createElement('div'); actions.className = 'download-card-actions'
          const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'secondary'; dismiss.textContent = 'Dismiss'
          dismiss.onclick = () => { pendingDownloads.delete(key); renderDownloads().catch(() => {}) }
          actions.append(dismiss); card.append(actions)
        }
        root.append(card)
      })
      downloads.forEach(manifest => {
        const card = document.createElement('article')
        card.className = 'download-card'
        const complete = manifest.status === 'complete'
        const active = window.MabelOffline.activeDownloads.has(manifest.id)
        const percent = manifest.size ? Math.min(100, Math.round(Number(manifest.downloadedBytes || 0) / manifest.size * 100)) : 0
        const status = complete ? `Ready offline · ${window.MabelOffline.formatBytes(manifest.size)}`
          : active ? `Downloading · ${percent}%`
            : `Paused · ${percent}%${manifest.error ? ` · ${manifest.error}` : ''}`
        card.innerHTML = `<div class="download-card-head"><span class="download-card-icon">${complete ? '▶' : '↓'}</span><span class="download-card-copy"><strong>${escapeHtml(manifest.title)}</strong><small>${escapeHtml(status)}</small></span></div>`
        if (!complete) {
          const progress = document.createElement('progress'); progress.max = 100; progress.value = percent; card.append(progress)
        }
        const actions = document.createElement('div'); actions.className = 'download-card-actions'
        if (complete) {
          const play = document.createElement('button'); play.type = 'button'; play.textContent = 'Watch offline'
          play.onclick = () => startOfflinePlayer(manifest).catch(showError)
          actions.append(play)
        } else if (active) {
          const pause = document.createElement('button'); pause.type = 'button'; pause.className = 'secondary'; pause.textContent = 'Pause'
          pause.onclick = () => window.MabelOffline.pauseDownload(manifest.id)
          actions.append(pause)
        } else {
          const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = navigator.onLine ? 'Resume' : 'Reconnect to resume'; resume.disabled = !navigator.onLine
          resume.onclick = () => downloadToDevice(manifest.source, manifest.title)
          actions.append(resume)
        }
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary download-remove'; remove.textContent = 'Remove'
        remove.onclick = async () => {
          if (!confirm(`Remove “${manifest.title}” from this device? The copy on the Pi or USB drive will not be changed.`)) return
          await window.MabelOffline.removeDownload(manifest.id)
          await renderDownloads()
        }
        actions.append(remove); card.append(actions); root.append(card)
      })
      if (!root.children.length) root.innerHTML = '<div class="downloads-empty"><strong>No downloads yet</strong>Choose Download to this device on a film, programme, or USB video.</div>'
    }

    function mabelSearchCard(entry) {
      const film = entry.film
      const metadata = film.metadata || {}
      const resumable = watchFilmResumable(film)
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'watch-card watch-mabel-film-card'
      card.setAttribute('aria-label', `${watchFilmTitle(film)} from ${entry.channel.name}${resumable ? `, resume at ${watchTimeLabel(film.remote_position)}` : ''}`)
      const art = document.createElement('span')
      art.className = 'watch-card-art'
      art.append(filmEntryPoster(entry))
      const progressValue = watchFilmProgress(film)
      if (resumable && progressValue) {
        const progress = document.createElement('span')
        progress.className = 'watch-progress'
        const fill = document.createElement('span')
        fill.style.width = `${progressValue}%`
        progress.append(fill)
        art.append(progress)
      }
      const copy = document.createElement('span')
      copy.className = 'watch-card-copy'
      const title = document.createElement('strong')
      title.textContent = watchFilmTitle(film)
      const detail = document.createElement('small')
      detail.textContent = resumable
        ? `Resume · ${watchTimeLabel(film.remote_position)}`
        : [metadata.year, entry.channel.name].filter(Boolean).join(' · ') || 'Film'
      copy.append(title, detail)
      card.append(art, copy)
      card.onclick = () => openFilmEntry(entry)
      return card
    }

    function renderMabelDiscovery(entries) {
      const input = $('#watchMabelSearch')
      if (!input) return
      const sorted = [...entries].sort((left, right) => filmSortTitle(left.film)
        .localeCompare(filmSortTitle(right.film), undefined, { sensitivity: 'base' }))
      const query = mabelSearchText.trim().toLocaleLowerCase()
      input.value = mabelSearchText
      $('#watchMabelSearchClear').classList.toggle('hidden', !mabelSearchText)

      const continuing = sorted
        .filter(entry => watchFilmResumable(entry.film))
        .sort((left, right) => Number(right.film.remote_last_watched || 0) - Number(left.film.remote_last_watched || 0))
        .slice(0, 10)
      $('#watchMabelContinueSection').classList.toggle(
        'hidden', !continuing.length || Boolean(query))
      $('#watchMabelContinueCount').textContent = continuing.length
        ? `${continuing.length} in progress` : ''
      const continueRail = $('#watchMabelContinueRail')
      continueRail.innerHTML = ''
      continuing.forEach(entry => continueRail.append(continueWatchCard(entry)))

      const matches = query
        ? sorted.filter(entry => filmEntrySearchText(entry).includes(query)) : []
      $('#watchMabelSearchSection').classList.toggle('hidden', !query)
      $('#watchMabelSearchTitle').textContent = query
        ? `“${mabelSearchText.trim()}”` : 'Search results'
      $('#watchMabelSearchCount').textContent = query
        ? `${matches.length} film${matches.length === 1 ? '' : 's'}` : ''
      const grid = $('#watchMabelSearchGrid')
      grid.innerHTML = ''
      matches.forEach(entry => grid.append(mabelSearchCard(entry)))
      if (query && !matches.length) {
        const empty = document.createElement('div')
        empty.className = 'watch-empty'
        empty.innerHTML = '<strong>No matching films</strong><br>Try another title.'
        grid.append(empty)
      }
      $('#remoteMabel').classList.toggle('hidden', Boolean(query))
    }

    function addMabelEpisodeRailCue(section, rail) {
      const cue = document.createElement('span')
      cue.className = 'watch-episode-scroll-cue'
      cue.setAttribute('aria-hidden', 'true')
      const thumb = document.createElement('span')
      cue.append(thumb)
      const update = () => {
        const viewport = Math.max(1, rail.clientWidth)
        const total = Math.max(viewport, rail.scrollWidth)
        const width = Math.max(18, viewport / total * 100)
        const available = 100 - width
        const travelled = Math.max(1, total - viewport)
        thumb.style.width = `${width}%`
        thumb.style.transform = `translateX(${available * rail.scrollLeft / travelled}%)`
        cue.classList.toggle('hidden', total <= viewport + 2)
      }
      rail.addEventListener('scroll', update, { passive: true })
      section.append(cue)
      requestAnimationFrame(update)
    }

    function renderRemoteViewing() {
      const remote = library?.remote_viewing || {}; const simultaneous = remote.allow_simultaneous === true
      $('#remoteConcurrentToggle').textContent = simultaneous ? 'On' : 'Off'
      $('#remoteConcurrentState').textContent = simultaneous
        ? 'On · TV and browser can play together' : 'Off · one player at a time'
      $('#remoteConcurrentToggle').setAttribute('aria-pressed', String(simultaneous))
      $('#watchMabelTab').classList.toggle('active', remoteKind === 'channel'); $('#watchMabelTab').setAttribute('aria-selected', String(remoteKind === 'channel'))
      $('#watchAdultTab').classList.toggle('active', remoteKind === 'adult'); $('#watchAdultTab').setAttribute('aria-selected', String(remoteKind === 'adult'))
      $('#watchDownloadsTab').classList.toggle('active', remoteKind === 'downloads'); $('#watchDownloadsTab').setAttribute('aria-selected', String(remoteKind === 'downloads'))
      $('#watchMabelLayout').classList.toggle('hidden', remoteKind !== 'channel'); $('#watchAdultLayout').classList.toggle('hidden', remoteKind !== 'adult')
      $('#watchDownloadsLayout').classList.toggle('hidden', remoteKind !== 'downloads')
      $('#watchLibraryAdmin').classList.toggle('hidden', remoteKind !== 'adult')
      const mabelAdmin = $('#watchMabelAdmin')
      if (mabelAdmin) mabelAdmin.classList.toggle('hidden', remoteKind !== 'channel')
      $('#watchAddAdult').classList.toggle('hidden', remoteKind !== 'adult')
      $('#watchManageAdult').classList.toggle('hidden', remoteKind !== 'adult')
      if (remoteKind === 'downloads') {
        renderDownloads().catch(showError)
        return
      }
      const mabel = $('#remoteMabel'); mabel.innerHTML = ''
      const mabelFilms = mabelFilmEntries()
      renderMabelDiscovery(mabelFilms)
      ;(library?.channels || []).forEach(channel => {
        const programmes = channel.enabled
          ? (channel.programmes || []).filter(programme => programme.enabled)
          : []
        const isFilms = channel.content_type === 'films'
        const section = document.createElement('section'); section.className = `watch-section mabel-channel-section ${isFilms ? 'mabel-film-channel' : 'mabel-show-channel'}`
        section.dataset.watchChannelFolder = String(channel.folder || '')
        const metadata = channel.metadata || {}
        if (!isFilms) {
          const identity = document.createElement('button'); identity.type = 'button'; identity.className = 'mabel-show-identity'
          if (metadata.artwork) identity.style.backgroundImage = `linear-gradient(90deg,rgba(7,12,10,.92) 0%,rgba(7,12,10,.62) 52%,rgba(7,12,10,.2) 100%),url('/api/channel/artwork/${encodeURIComponent(metadata.artwork)}')`
          identity.innerHTML = `<div><span>CH ${channel.number} · ${channel.enabled ? `${programmes.length} episodes` : 'Hidden from TV'}</span><h2>${escapeHtml(metadata.title || channel.name)}</h2><p>${escapeHtml(metadata.overview || `${channel.name} on MabelTV.`)}</p></div>`
          identity.setAttribute('aria-label', `Open channel ${channel.number}, ${channel.name}`)
          identity.onclick = () => openChannel(channel, true)
          section.append(identity)
        } else {
          const artworks = [...new Set((channel.programmes || [])
            .map(programme => programme.metadata?.poster)
            .filter(Boolean))]
          const firstArtwork = artworks.length ? Math.floor(Math.random() * artworks.length) : 0
          const head = document.createElement('button'); head.type = 'button'; head.className = 'watch-section-head mabel-film-head'
          head.innerHTML = `<span class="mabel-film-head-art" aria-hidden="true"><span class="mabel-film-head-art-layer is-visible"></span><span class="mabel-film-head-art-layer"></span></span><span class="mabel-film-head-copy"><span>CH ${channel.number} · Film channel${channel.enabled ? '' : ' · Hidden from TV'}</span><h2>${escapeHtml(channel.name)}</h2></span>`
          if (artworks.length) {
            head.dataset.filmArt = 'true'
            head._mabelFilmArtworks = artworks
            head._mabelFilmArtIndex = firstArtwork
            head._mabelFilmArtLayer = 0
            head.querySelector('.mabel-film-head-art-layer').style.backgroundImage = `url('/api/channel/artwork/${encodeURIComponent(artworks[firstArtwork])}')`
          }
          head.setAttribute('aria-label', `Open channel ${channel.number}, ${channel.name}`); head.onclick = () => openChannel(channel, true); section.append(head)
        }
        if (programmes.length) {
          const rail = document.createElement('div')
          rail.className = `watch-channel-rail${isFilms ? ' watch-film-channel-rail' : ' watch-episode-rail'}`
          rail.setAttribute('aria-label', `${channel.name} ${isFilms ? 'films' : 'episodes'}`)
          programmes.forEach(programme => {
            const card = document.createElement('button'); card.type = 'button'
            const programmeMetadata = programme.metadata || {}
            if (isFilms) {
              const resumable = watchFilmResumable(programme)
              const progressValue = watchFilmProgress(programme)
              card.className = 'watch-card watch-mabel-film-card'
              card.setAttribute('aria-label', `${watchFilmTitle(programme)}${resumable ? `, resume at ${watchTimeLabel(programme.remote_position)}` : ''}`)
              const art = document.createElement('span'); art.className = 'watch-card-art'
              if (programmeMetadata.poster) {
                const image = document.createElement('img')
                image.src = `/api/channel/artwork/${encodeURIComponent(programmeMetadata.poster)}`
                image.alt = ''
                image.loading = 'lazy'
                art.append(image)
              } else {
                const placeholder = document.createElement('span')
                placeholder.className = 'watch-card-placeholder'
                placeholder.textContent = watchFilmTitle(programme).slice(0, 1).toUpperCase()
                art.append(placeholder)
              }
              if (programme.browser_ready === false) {
                const format = document.createElement('span')
                format.className = 'watch-format'
                format.textContent = 'VLC READY'
                art.append(format)
              }
              if (resumable && progressValue) {
                const progress = document.createElement('span')
                progress.className = 'watch-progress'
                const fill = document.createElement('span')
                fill.style.width = `${progressValue}%`
                progress.append(fill)
                art.append(progress)
              }
              const copy = document.createElement('span'); copy.className = 'watch-card-copy'
              const title = document.createElement('strong'); title.textContent = watchFilmTitle(programme)
              const detail = document.createElement('small')
              detail.textContent = resumable
                ? `Resume · ${watchTimeLabel(programme.remote_position)}`
                : [programmeMetadata.year, channel.name].filter(Boolean).join(' · ') || 'Film'
              copy.append(title, detail)
              card.append(art, copy)
            } else {
              card.className = 'watch-programme watch-mabel-episode'
              const copy = document.createElement('span'); copy.className = 'watch-mabel-copy'
              const title = document.createElement('strong'); title.textContent = programmeMetadata.title || programme.display_name
              const play = document.createElement('small')
              play.textContent = programme.browser_ready === false ? 'TV or VLC · choose where to play' : 'Choose where to watch  ›'
              copy.append(title, play); card.append(copy)
            }
            card.onclick = () => openWatchProgrammeSheet(channel, programme)
            rail.append(card)
          })
          section.append(rail)
          if (!isFilms) addMabelEpisodeRailCue(section, rail)
        } else {
          const empty = document.createElement('p'); empty.className = 'watch-channel-empty'; empty.textContent = channel.enabled ? 'No programmes are currently shown. Open this channel to manage it.' : 'This channel is hidden from the television. Open it to make changes.'; section.append(empty)
        }
        mabel.append(section)
      })
      if (!mabel.children.length) mabel.innerHTML = '<div class="watch-empty">No MabelTV channels have been created yet.</div>'
      startMabelFilmArtCycle()
      renderAdultWatch()
      renderHomeLibrary()
    }

    $('#watchMabelTab').onclick = () => { remoteKind = 'channel'; renderRemoteViewing() }
    $('#watchAdultTab').onclick = () => { remoteKind = 'adult'; renderRemoteViewing() }
    $('#watchDownloadsTab').onclick = () => { remoteKind = 'downloads'; renderRemoteViewing() }
    window.addEventListener('mabeltv-downloads-changed', () => {
      if (remoteKind === 'downloads') renderDownloads().catch(() => {})
    })
    window.addEventListener('offline', () => {
      document.body.classList.add('offline-mode')
      offlineMode = true
      remoteKind = 'downloads'
      openView('watch')
      renderRemoteViewing()
    })
    window.addEventListener('online', () => {
      offlineMode = false
      document.body.classList.remove('offline-mode')
      if (remoteKind === 'downloads') renderDownloads().catch(() => {})
    })
    $('#watchSearch').oninput = event => { watchSearchText = event.target.value; renderAdultWatch() }
    $('#watchSearchClear').onclick = event => { event.preventDefault(); watchSearchText = ''; renderAdultWatch(); $('#watchSearch').focus() }
    $('#watchCollectionSelect').onchange = event => { watchFolder = event.target.value; renderAdultWatch() }
    $('#watchMabelSearch').oninput = event => { mabelSearchText = event.target.value; renderMabelDiscovery(mabelFilmEntries()) }
    $('#watchMabelSearchClear').onclick = event => { event.preventDefault(); mabelSearchText = ''; renderMabelDiscovery(mabelFilmEntries()); $('#watchMabelSearch').focus() }
    const adultSeriesCreate = $('#adultSeriesCreate')
    if (adultSeriesCreate) adultSeriesCreate.onclick = async () => {
      const name = prompt('Series name:')
      if (!name?.trim()) return
      try {
        await api('/api/manage', { method: 'POST', body: JSON.stringify({
          action: 'create-adult-series', name: name.trim(),
        }) })
        await reloadLibraryWithoutLosingPlace()
        const created = library?.adult_series?.find(series =>
          series.stored_title?.toLocaleLowerCase() === name.trim().toLocaleLowerCase()
          || series.title?.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
        if (!created) throw new Error('The series was created, but could not be reopened')
        openAdultSeriesSheet(created)
        notice(`${created.title} is ready. Start Series 1 when you are ready to add episodes.`)
      } catch (error) { showError(error) }
    }
    const adultSeriesClose = $('#adultSeriesClose')
    if (adultSeriesClose) adultSeriesClose.onclick = closeAdultSeriesSheet
    const adultSeriesSheet = $('#adultSeriesSheet')
    if (adultSeriesSheet) adultSeriesSheet.onclick = event => {
      if (event.target === $('#adultSeriesSheet')) closeAdultSeriesSheet()
    }
    if (adultSeriesSheet) adultSeriesSheet.onclose = () => {
      selectedAdultSeries = null
      document.documentElement.style.overflow = ''
    }
    const adultSeasonClose = $('#adultSeasonClose')
    if (adultSeasonClose) adultSeasonClose.onclick = returnToAdultSeriesSheet
    const adultSeasonSheet = $('#adultSeasonSheet')
    if (adultSeasonSheet) adultSeasonSheet.onclick = event => {
      if (event.target === adultSeasonSheet) returnToAdultSeriesSheet()
    }
    if (adultSeasonSheet) adultSeasonSheet.oncancel = event => {
      event.preventDefault()
      returnToAdultSeriesSheet()
    }
    if (adultSeasonSheet) adultSeasonSheet.onclose = () => {
      selectedAdultSeason = null
      document.documentElement.style.overflow = ''
    }
    const adultSeriesRestartClose = $('#adultSeriesRestartClose')
    if (adultSeriesRestartClose) adultSeriesRestartClose.onclick = returnFromAdultSeriesRestartSheet
    const adultSeriesRestartCancel = $('#adultSeriesRestartCancel')
    if (adultSeriesRestartCancel) adultSeriesRestartCancel.onclick = returnFromAdultSeriesRestartSheet
    const adultSeriesRestartConfirm = $('#adultSeriesRestartConfirm')
    if (adultSeriesRestartConfirm) adultSeriesRestartConfirm.onclick = confirmAdultSeriesRestart
    const adultSeriesRestartSheet = $('#adultSeriesRestartSheet')
    if (adultSeriesRestartSheet) adultSeriesRestartSheet.onclick = event => {
      if (event.target === adultSeriesRestartSheet) returnFromAdultSeriesRestartSheet()
    }
    if (adultSeriesRestartSheet) adultSeriesRestartSheet.oncancel = event => {
      event.preventDefault()
      returnFromAdultSeriesRestartSheet()
    }
    if (adultSeriesRestartSheet) adultSeriesRestartSheet.onclose = () => {
      document.documentElement.style.overflow = ''
    }
    const adultSeriesUploadClose = $('#adultSeriesUploadClose')
    if (adultSeriesUploadClose) adultSeriesUploadClose.onclick = () => {
      const target = adultSeriesUploadTarget
      closeLibrarySheet($('#adultSeriesUploadSheet'))
      adultSeriesUploadTarget = null
      if (target) {
        const series = library?.adult_series?.find(value => value.id === target.id)
        if (series) setTimeout(() => target.isNew
          ? openAdultSeriesSheet(series)
          : openAdultSeasonSheet(series, target.season), 0)
      }
    }
    const adultSeriesUploadSheet = $('#adultSeriesUploadSheet')
    if (adultSeriesUploadSheet) adultSeriesUploadSheet.onclick = event => {
      if (event.target === adultSeriesUploadSheet) {
        const target = adultSeriesUploadTarget
        closeLibrarySheet(adultSeriesUploadSheet)
        adultSeriesUploadTarget = null
        if (target) {
          const series = library?.adult_series?.find(value => value.id === target.id)
          if (series) setTimeout(() => target.isNew
            ? openAdultSeriesSheet(series)
            : openAdultSeasonSheet(series, target.season), 0)
        }
      }
    }
    if (adultSeriesUploadSheet) adultSeriesUploadSheet.onclose = () => {
      if (!adultSeriesSourcePickerOpen) adultSeriesUploadTarget = null
      document.documentElement.style.overflow = ''
    }
    const adultSeriesChooseSource = $('#adultSeriesChooseSource')
    if (adultSeriesChooseSource) adultSeriesChooseSource.onclick = openAdultSeriesSourceSheet
    const adultSeriesSourceClose = $('#adultSeriesSourceClose')
    if (adultSeriesSourceClose) adultSeriesSourceClose.onclick = returnToAdultSeriesUploadSheet
    const adultSeriesSourceFiles = $('#adultSeriesSourceFiles')
    if (adultSeriesSourceFiles) adultSeriesSourceFiles.onclick = chooseAdultSeriesFiles
    const adultSeriesSourceUsb = $('#adultSeriesSourceUsb')
    if (adultSeriesSourceUsb) adultSeriesSourceUsb.onclick = chooseAdultSeriesUsb
    const adultSeriesSourceSheet = $('#adultSeriesSourceSheet')
    if (adultSeriesSourceSheet) adultSeriesSourceSheet.onclick = event => {
      if (event.target === adultSeriesSourceSheet) returnToAdultSeriesUploadSheet()
    }
    if (adultSeriesSourceSheet) adultSeriesSourceSheet.onclose = () => {
      document.documentElement.style.overflow = ''
    }
    const adultEpisodeClose = $('#adultEpisodeClose')
    if (adultEpisodeClose) adultEpisodeClose.onclick = returnToAdultSeasonSheet
    const adultEpisodeSheet = $('#adultEpisodeSheet')
    if (adultEpisodeSheet) adultEpisodeSheet.onclick = event => {
      if (event.target === $('#adultEpisodeSheet')) returnToAdultSeasonSheet()
    }
    if (adultEpisodeSheet) adultEpisodeSheet.onclose = () => {
      selectedAdultEpisode = null
      document.documentElement.style.overflow = ''
    }
    const adultEpisodeMoreClose = $('#adultEpisodeMoreClose')
    if (adultEpisodeMoreClose) adultEpisodeMoreClose.onclick = closeAdultEpisodeMoreSheet
    const adultEpisodeMoreSheet = $('#adultEpisodeMoreSheet')
    if (adultEpisodeMoreSheet) adultEpisodeMoreSheet.onclick = event => {
      if (event.target === adultEpisodeMoreSheet) closeAdultEpisodeMoreSheet()
    }
    if (adultEpisodeMoreSheet) adultEpisodeMoreSheet.onclose = () => {
      document.documentElement.style.overflow = ''
    }
    const homeFilmSearch = $('#homeFilmSearch')
    const homeFilmSearchClear = $('#homeFilmSearchClear')
    if (homeFilmSearch) homeFilmSearch.oninput = event => { homeSearchText = event.target.value; renderHomeLibrary() }
    if (homeFilmSearchClear) homeFilmSearchClear.onclick = event => { event.preventDefault(); homeSearchText = ''; renderHomeLibrary(); homeFilmSearch.focus() }
    $('#watchChannelClose').onclick = closeWatchChannelSheet
    $('#watchChannelSheet').onclick = event => {
      if (event.target === $('#watchChannelSheet')) closeWatchChannelSheet()
    }
    $('#watchChannelSheet').onclose = () => { document.documentElement.style.overflow = '' }
    $('#filmResumeChoiceClose').onclick = closeFilmResumeChoiceSheet
    $('#filmResumeChoiceSheet').onclick = event => {
      if (event.target === $('#filmResumeChoiceSheet')) closeFilmResumeChoiceSheet()
    }
    $('#filmResumeChoiceSheet').onclose = () => {
      document.documentElement.style.overflow = ''
    }
    $('#watchFilmClose').onclick = closeWatchFilmSheet
    $('#watchFilmSheet').onclick = event => { if (event.target === $('#watchFilmSheet')) closeWatchFilmSheet() }
    $('#watchFilmSheet').onclose = () => { selectedWatchFilm = null; document.documentElement.style.overflow = '' }
    $('#watchProgrammeClose').onclick = closeWatchProgrammeSheet
    $('#watchProgrammeSheet').onclick = event => { if (event.target === $('#watchProgrammeSheet')) closeWatchProgrammeSheet() }
    $('#watchProgrammeSheet').onclose = () => { selectedWatchProgramme = null; document.documentElement.style.overflow = '' }
    $('#watchProgrammeMoreClose').onclick = closeWatchProgrammeMoreSheet
    $('#watchProgrammeMoreSheet').onclick = event => { if (event.target === $('#watchProgrammeMoreSheet')) closeWatchProgrammeMoreSheet() }
    $('#watchProgrammeMoreSheet').onclose = () => { document.documentElement.style.overflow = '' }
    $('#watchProgrammeEpisodeMoreClose').onclick = closeWatchProgrammeEpisodeMoreSheet
    $('#watchProgrammeEpisodeMoreSheet').onclick = event => {
      if (event.target === $('#watchProgrammeEpisodeMoreSheet')) closeWatchProgrammeEpisodeMoreSheet()
    }
    $('#watchProgrammeEpisodeMoreSheet').onclose = () => { document.documentElement.style.overflow = '' }
    $('#watchAddAdult').onclick = () => $('#adultAddFilms').click()
    $('#watchManageAdult').onclick = () => openLibrarySheet($('#adultCollectionSheet'))
    $('#remoteConcurrentToggle').onclick = () => manage('set-remote-simultaneous', { enabled: library?.remote_viewing?.allow_simultaneous !== true })
