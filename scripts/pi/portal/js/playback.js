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
      if (!mabelRemoteSession || !mabelRemoteTracksPosition || !Number.isFinite(video.currentTime) ||
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
      if (!mabelRemoteSession || !mabelRemoteTracksPosition ||
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
        mabelRemotePositionTimer = mabelRemoteTracksPosition
          ? setInterval(saveMabelRemotePosition, 15000) : null
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
        let deepLink = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(mediaUrl)}`
        if (result.subtitle_url) {
          deepLink += `&sub=${encodeURIComponent(new URL(result.subtitle_url, location.origin).href)}`
        }
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
        notice('Offline storage is not available in this browser. Open the installed MabelTV app over HTTPS.', true)
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
      const desktopAdult = payload.kind === 'adult' && !isAppleMobilePlayer()
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

    function openFilmEntry(entry) {
      if (entry.kind === 'adult') openWatchFilmSheet(entry.film)
      else openWatchProgrammeSheet(entry.channel, entry.film)
    }

    function closeHomeResumeSheet() {
      const dialog = $('#homeResumeSheet')
      if (dialog?.open) dialog.close()
      selectedHomeFilmEntry = null
      document.documentElement.style.overflow = ''
    }

    function openHomeFilmEntry(entry) {
      if (!watchFilmResumable(entry.film)) {
        openFilmEntry(entry)
        return
      }
      selectedHomeFilmEntry = entry
      $('#homeResumeTitle').textContent = watchFilmTitle(entry.film)
      $('#homeResumeMeta').textContent = `${filmEntrySourceLabel(entry)} · ${watchTimeLabel(entry.film.remote_position)} watched`
      $('#homeResumeContinueHint').textContent = `Continue from ${watchTimeLabel(entry.film.remote_position)}`
      const dialog = $('#homeResumeSheet')
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
      card.setAttribute('aria-label', `${watchFilmTitle(film)}${resumable ? `, resume at ${watchTimeLabel(film.remote_position)}` : ''}`)
      const art = document.createElement('span')
      art.className = 'watch-card-art'
      art.append(filmPoster(film))
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
      card.onclick = () => openFilmEntry(entry)
      item.append(card)
      return item
    }

    function homePosterTile(entry) {
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
      card.onclick = () => openHomeFilmEntry(entry)
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

      const favourites = entries.filter(entry => entry.film.favourite)
      $('#homeFavouritesCount').textContent = favourites.length
        ? `${favourites.length} film${favourites.length === 1 ? '' : 's'}` : ''
      const favouriteRail = $('#homeFavouritesRail')
      favouriteRail.innerHTML = ''
      favourites.forEach(entry => favouriteRail.append(homePosterTile(entry)))
      $('#homeFavouritesEmpty').classList.toggle('hidden', Boolean(favourites.length))

      const continuing = entries
        .filter(entry => watchFilmResumable(entry.film))
        .sort((left, right) => Number(right.film.remote_last_watched || 0) - Number(left.film.remote_last_watched || 0))
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

    function playWatchFilmOnTv(film) {
      closeWatchFilmSheet()
      playOnTv({
        kind: 'adult',
        file: film.path,
        position: Number(film.remote_position || 0),
      }, watchFilmTitle(film))
    }

    async function clearWatchFilmProgress(film, playAfter = false) {
      const source = { kind: 'adult', file: film.path }
      const action = playAfter ? $('#watchFilmStartOver') : $('#watchFilmRemoveProgress')
      const actionLabel = action.querySelector('span')
      const originalLabel = actionLabel.textContent
      action.disabled = true
      action.setAttribute('aria-busy', 'true')
      actionLabel.textContent = playAfter ? 'Starting from beginning…' : 'Removing…'
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
        notice(`${watchFilmTitle(film)} was removed from Continue Watching.`)
      } finally {
        action.disabled = false
        action.removeAttribute('aria-busy')
        actionLabel.textContent = originalLabel
      }
    }

    function openWatchFilmSheet(film) {
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
      const tvPlay = $('#watchFilmTv')
      tvPlay.querySelector('strong').textContent = resumable ? 'Resume on TV' : 'Play on TV'
      tvPlay.querySelector('small').textContent = resumable ? `Continue from ${watchTimeLabel(film.remote_position)}` : 'Replaces what is playing there'
      tvPlay.onclick = () => playWatchFilmOnTv(film)
      const herePlay = $('#watchFilmHere')
      herePlay.disabled = false
      herePlay.querySelector('strong').textContent = streamable ? resumable ? 'Resume on this device' : 'Watch on this device' : 'Play in VLC'
      herePlay.querySelector('small').textContent = streamable ? resumable ? `Continue from ${watchTimeLabel(film.remote_position)}` : 'Starts an independent stream' : 'Opens the original without conversion'
      herePlay.onclick = streamable
        ? () => playWatchFilm(film, resumable ? Number(film.remote_position || 0) : 0)
        : () => { closeWatchFilmSheet(); openInVlc({ kind: 'adult', file: film.path }, title) }
      $('#watchFilmDownload').onclick = () => {
        closeWatchFilmSheet()
        downloadToDevice({ kind: 'adult', file: film.path }, title)
      }
      const favouriteButton = $('#watchFilmFavourite')
      favouriteButton.classList.toggle('active', film.favourite === true)
      favouriteButton.querySelector('span').textContent = film.favourite
        ? 'Remove from favourites' : 'Add to favourites'
      favouriteButton.onclick = () => setFilmFavourite(
        adultFilmEntry(film), film.favourite !== true).then(() => {
          favouriteButton.classList.toggle('active', film.favourite === true)
          favouriteButton.querySelector('span').textContent = film.favourite
            ? 'Remove from favourites' : 'Add to favourites'
        }).catch(showError)
      const metadataButton = $('#watchFilmMetadata')
      metadataButton.disabled = !tmdbConfigured
      metadataButton.querySelector('span').textContent = metadata.tmdb_id ? 'Refresh metadata & subtitles' : 'Find metadata & subtitles'
      metadataButton.onclick = tmdbConfigured ? () => {
        closeWatchFilmSheet()
        scanTmdb(film)
      } : null
      const manageFilm = $('#watchFilmManage')
      const managementAvailable = currentPortalDesign === 'experience'
      manageFilm.classList.toggle('hidden', !managementAvailable)
      manageFilm.onclick = managementAvailable ? () => {
        closeWatchFilmSheet()
        openAdultFilmSheet(film)
      } : null
      const startOver = $('#watchFilmStartOver')
      startOver.classList.toggle('hidden', !streamable || !resumable)
      startOver.onclick = streamable && resumable ? () => clearWatchFilmProgress(film, true).catch(showError) : null
      const removeProgress = $('#watchFilmRemoveProgress')
      removeProgress.classList.toggle('hidden', !resumable)
      removeProgress.onclick = resumable ? () => clearWatchFilmProgress(film).catch(showError) : null
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
      const resumable = allFilms
        .filter(film => film.browser_ready !== false && watchFilmResumable(film))
        .sort((left, right) => Number(right.remote_last_watched || 0) - Number(left.remote_last_watched || 0))
        .slice(0, 10)
      const continueSection = $('#watchContinueSection')
      continueSection.classList.toggle('hidden', !resumable.length || Boolean(query))
      $('#watchContinueCount').textContent = resumable.length ? `${resumable.length} in progress` : ''
      const continueRail = $('#watchContinueRail')
      continueRail.innerHTML = ''
      resumable.forEach(film => continueRail.append(continueWatchCard(film)))

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

    function closeWatchProgrammeMoreSheet() {
      const dialog = $('#watchProgrammeMoreSheet')
      if (dialog.open) dialog.close()
      document.documentElement.style.overflow = ''
    }

    function openWatchProgrammeSheet(channel, programme) {
      selectedWatchProgramme = { channel, programme }
      const metadata = programme.metadata || {}
      const title = metadata.title || programme.display_name
      const filmChannel = channel.content_type === 'films'
      const resumable = filmChannel && watchFilmResumable(programme)
      $('#watchProgrammeEyebrow').textContent = `CH ${channel.number} · ${channel.name}`
      $('#watchProgrammeTitle').textContent = title
      $('#watchProgrammeMeta').textContent = [metadata.year, resumable ? `Resume at ${watchTimeLabel(programme.remote_position)}` : filmChannel ? 'Film' : 'MabelTV programme'].filter(Boolean).join(' · ')
      $('#watchProgrammeTv').querySelector('small').textContent = resumable
        ? `Continue from ${watchTimeLabel(programme.remote_position)}`
        : 'Replaces what is playing there'
      $('#watchProgrammeTv').onclick = () => {
        closeWatchProgrammeSheet()
        playOnTv({ kind: 'channel', channel: channel.number, file: programme.name,
          position: filmChannel ? Number(programme.remote_position || 0) : undefined }, title)
      }
      const here = $('#watchProgrammeHere')
      here.disabled = false
      here.querySelector('strong').textContent = programme.browser_ready === false ? 'Play in VLC' : 'Watch on this device'
      here.querySelector('small').textContent = programme.browser_ready === false
        ? 'Opens the original without conversion'
        : resumable ? `Continue from ${watchTimeLabel(programme.remote_position)}` : 'Starts an independent stream'
      const source = { kind: 'channel', channel: channel.number, file: programme.name }
      if (filmChannel) source.position = Number(programme.remote_position || 0)
      here.onclick = () => {
        closeWatchProgrammeSheet()
        if (programme.browser_ready === false) openInVlc(source, title)
        else openRemotePlayer(source, filmChannel ? Number(programme.remote_position || 0) : 0)
      }
      $('#watchProgrammeDownload').onclick = () => {
        closeWatchProgrammeSheet()
        downloadToDevice(source, title)
      }
      const filmTools = $('#watchProgrammeFilmTools')
      filmTools.classList.toggle('hidden', !filmChannel)
      if (filmChannel) filmTools.style.removeProperty('display')
      else filmTools.style.setProperty('display', 'none', 'important')

      const moreButton = $('#watchProgrammeMore')
      moreButton.onclick = filmChannel ? () => {
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
        closeWatchProgrammeMoreSheet()
        scanProgrammeTmdb(channel, programme)
      } : null

      const favouriteButton = $('#watchProgrammeFavourite')
      favouriteButton.classList.toggle('active', programme.favourite === true)
      favouriteButton.querySelector('strong').textContent = programme.favourite
        ? 'Remove from favourites' : 'Add to favourites'
      favouriteButton.querySelector('small').textContent = programme.favourite
        ? 'Remove this film from Home' : 'Show this film on Home'
      favouriteButton.onclick = filmChannel ? () => setFilmFavourite(
        { kind: 'channel', channel, film: programme }, programme.favourite !== true
      ).then(() => {
        favouriteButton.classList.toggle('active', programme.favourite === true)
        favouriteButton.querySelector('strong').textContent = programme.favourite
          ? 'Remove from favourites' : 'Add to favourites'
        favouriteButton.querySelector('small').textContent = programme.favourite
          ? 'Remove this film from Home' : 'Show this film on Home'
      }).catch(showError) : null

      const toggleButton = $('#watchProgrammeToggle')
      toggleButton.querySelector('strong').textContent = programme.enabled ? 'Hide from TV' : 'Show on TV'
      toggleButton.querySelector('small').textContent = programme.enabled
        ? 'Keep the film without showing it on this channel'
        : 'Return the film to this TV channel'
      toggleButton.onclick = filmChannel ? () => {
        closeWatchProgrammeMoreSheet()
        manage('toggle-programme', { channel: channel.number, file: programme.name })
      } : null

      const renameButton = $('#watchProgrammeRename')
      renameButton.onclick = filmChannel ? () => {
        closeWatchProgrammeMoreSheet()
        renameProgramme(channel, programme)
      } : null

      const binButton = $('#watchProgrammeBin')
      binButton.onclick = filmChannel ? () => {
        closeWatchProgrammeSheet()
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
          closeWatchProgrammeMoreSheet()
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
        root.innerHTML = '<div class="downloads-empty"><strong>Offline storage unavailable</strong>Install MabelTV from an HTTPS address to keep private downloads on this device.</div>'
        $('#downloadsStorage').textContent = 'Unavailable'
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

    function renderRemoteViewing() {
      const remote = library?.remote_viewing || {}; const simultaneous = remote.allow_simultaneous === true
      $('#remoteConcurrentState').textContent = simultaneous ? 'TV and one remote stream can run together' : 'One player at a time'
      $('#remoteConcurrentToggle').textContent = simultaneous ? 'Use one player' : 'Allow both'
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
        const metadata = channel.metadata || {}
        if (!isFilms) {
          const identity = document.createElement('button'); identity.type = 'button'; identity.className = 'mabel-show-identity'
          if (metadata.artwork) identity.style.backgroundImage = `linear-gradient(90deg,rgba(7,12,10,.92) 0%,rgba(7,12,10,.62) 52%,rgba(7,12,10,.2) 100%),url('/api/channel/artwork/${encodeURIComponent(metadata.artwork)}')`
          identity.innerHTML = `<div><span>CH ${channel.number} · ${channel.enabled ? `${programmes.length} episodes` : 'Hidden from TV'}</span><h2>${escapeHtml(metadata.title || channel.name)}</h2><p>${escapeHtml(metadata.overview || `${channel.name} on MabelTV.`)}</p></div>`
          identity.setAttribute('aria-label', `Open channel ${channel.number}, ${channel.name}`)
          identity.onclick = () => openChannel(channel.number, true)
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
          head.setAttribute('aria-label', `Open channel ${channel.number}, ${channel.name}`); head.onclick = () => openChannel(channel.number, true); section.append(head)
        }
        if (programmes.length) {
          const rail = document.createElement('div')
          rail.className = `watch-channel-rail${isFilms ? ' watch-film-channel-rail' : ''}`
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
    const homeFilmSearch = $('#homeFilmSearch')
    const homeFilmSearchClear = $('#homeFilmSearchClear')
    if (homeFilmSearch) homeFilmSearch.oninput = event => { homeSearchText = event.target.value; renderHomeLibrary() }
    if (homeFilmSearchClear) homeFilmSearchClear.onclick = event => { event.preventDefault(); homeSearchText = ''; renderHomeLibrary(); homeFilmSearch.focus() }
    $('#homeResumeClose').onclick = closeHomeResumeSheet
    $('#homeResumeSheet').onclick = event => { if (event.target === $('#homeResumeSheet')) closeHomeResumeSheet() }
    $('#homeResumeSheet').onclose = () => { selectedHomeFilmEntry = null; document.documentElement.style.overflow = '' }
    $('#homeResumeContinue').onclick = () => {
      const entry = selectedHomeFilmEntry
      closeHomeResumeSheet()
      if (entry) openFilmEntry(entry)
    }
    $('#homeResumeStart').onclick = () => {
      const entry = selectedHomeFilmEntry
      closeHomeResumeSheet()
      if (entry) openFilmEntry({ ...entry, film: {
        ...entry.film, remote_position: 0, remote_last_watched: 0,
      } })
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
    $('#watchAddAdult').onclick = () => $('#adultAddFilms').click()
    $('#watchManageAdult').onclick = () => openLibrarySheet($('#adultCollectionSheet'))
    $('#remoteConcurrentToggle').onclick = () => manage('set-remote-simultaneous', { enabled: library?.remote_viewing?.allow_simultaneous !== true })
