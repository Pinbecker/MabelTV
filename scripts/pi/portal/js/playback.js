'use strict'

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

    function saveIosRemotePosition(finished = false) {
      const video = $('#iosWatchVideo')
      if (!iosRemoteSession || !Number.isFinite(video.currentTime) || (!finished && video.currentTime - iosRemoteLastSaved < 10)) return
      iosRemoteLastSaved = video.currentTime
      api('/api/remote/position', { method: 'POST', body: JSON.stringify({ stream: iosRemoteSession, position: finished ? video.duration : video.currentTime, duration: video.duration }) }).catch(() => {})
    }

    function closeIosRemotePlayer() {
      const video = $('#iosWatchVideo')
      saveIosRemotePosition()
      if (iosRemoteSession) api('/api/remote/release', { method: 'POST', body: JSON.stringify({ stream: iosRemoteSession }) }).catch(() => {})
      clearInterval(iosRemotePositionTimer); clearInterval(iosRemoteHeartbeatTimer)
      iosRemotePositionTimer = null; iosRemoteHeartbeatTimer = null; iosRemoteSession = null
      iosOfflineDownloadId = null
      video.pause(); video.removeAttribute('src'); video.replaceChildren(); video.load()
        $('#iosWatchPlayer').classList.add('hidden')
        document.documentElement.classList.remove('native-video-fullscreen')
        unlockPortalPlayerScroll()
    }

    function setNativeVideoBackdrop(active) {
      document.documentElement.classList.toggle('native-video-fullscreen', active)
    }

    async function startIosRemotePlayer(payload, position = 0) {
      const shell = $('#iosWatchPlayer'); const video = $('#iosWatchVideo'); const error = $('#iosWatchError')
      shell.classList.remove('hidden'); error.classList.add('hidden'); video.classList.remove('hidden')
      lockPortalPlayerScroll()
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
          if (nativeFullscreen || typeof video.webkitEnterFullscreen !== 'function') return
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
        video.onwebkitendfullscreen = () => setNativeVideoBackdrop(false)
        video.onwebkitpresentationmodechanged = () => {
          setNativeVideoBackdrop(video.webkitPresentationMode === 'fullscreen' || Boolean(video.webkitDisplayingFullscreen))
        }
        video.onwebkitbeginfullscreen = () => { nativeFullscreen = true; setNativeVideoBackdrop(true) }
        // Ask for the true native player immediately from the library tap and
        // retry only once the media becomes ready. This avoids the old inline
        // hand-off before the Liquid Glass player opens.
        video.onplay = requestNativeFullscreen
        video.onpause = () => saveIosRemotePosition()
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
      lockPortalPlayerScroll()
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
        if (nativeFullscreen || typeof video.webkitEnterFullscreen !== 'function') return
        try { video.webkitEnterFullscreen() } catch (_) { /* retry when playback starts */ }
      }
      video.onloadedmetadata = requestNativeFullscreen
      video.oncanplay = requestNativeFullscreen
      video.onplay = requestNativeFullscreen
      video.onwebkitbeginfullscreen = () => { nativeFullscreen = true; setNativeVideoBackdrop(true) }
      video.onwebkitendfullscreen = () => setNativeVideoBackdrop(false)
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

    function closeMabelWatchPlayer() {
      const video = $('#mabelWatchVideo')
      if (mabelRemoteSession) api('/api/remote/release', { method: 'POST', body: JSON.stringify({ stream: mabelRemoteSession }) }).catch(() => {})
      clearInterval(mabelRemoteHeartbeatTimer)
      clearTimeout(mabelControlsTimer)
      mabelRemoteHeartbeatTimer = null
      mabelControlsTimer = null
      mabelRemoteSession = null
      video.pause(); video.removeAttribute('src'); video.load()
      $('#mabelWatchPlayer').classList.add('hidden')
      $('#mabelWatchPlayer').classList.remove('controls-visible')
      unlockPortalPlayerScroll()
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
        video.onloadedmetadata = () => { $('#mabelWatchDuration').textContent = mabelWatchTime(video.duration); $('#mabelWatchSeek').value = '0' }
        video.ontimeupdate = () => {
          $('#mabelWatchCurrent').textContent = mabelWatchTime(video.currentTime)
          $('#mabelWatchSeek').value = String(video.duration ? Math.round(video.currentTime / video.duration * 1000) : 0)
        }
        video.onplay = () => { $('[data-mabel-watch-action="play"]').classList.add('playing'); showMabelWatchControls() }
        video.onpause = () => { $('[data-mabel-watch-action="play"]').classList.remove('playing'); showMabelWatchControls(true) }
        video.onerror = () => { error.textContent = `This programme could not be played (media error ${video.error?.code || 'unknown'}).`; error.classList.remove('hidden') }
        video.src = result.stream_url
        video.load()
        clearInterval(mabelRemoteHeartbeatTimer)
        mabelRemoteHeartbeatTimer = setInterval(() => api('/api/remote/heartbeat', { method: 'POST', body: JSON.stringify({ stream: mabelRemoteSession }) }).catch(() => {}), 30000)
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
        if (payload.kind === 'channel') { await startMabelWatchPlayer(payload); return }
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
    $('#mabelWatchPlayer').onpointerdown = event => {
      if (!event.target.closest('button, input')) showMabelWatchControls()
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
    window.addEventListener('pagehide', () => { if (mabelRemoteSession) navigator.sendBeacon('/api/remote/release', JSON.stringify({ stream: mabelRemoteSession })) })

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
      const play = document.createElement('span')
      play.className = 'watch-play'
      play.textContent = '▶'
      art.append(play)
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

    function continueWatchCard(film) {
      const item = document.createElement('div')
      item.className = 'watch-continue-item'
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'watch-continue-card'
      card.setAttribute('aria-label', `Resume ${watchFilmTitle(film)} at ${watchTimeLabel(film.remote_position)}`)
      const art = document.createElement('span')
      art.className = 'watch-continue-art'
      art.style.setProperty('--watch-progress', `${watchFilmProgress(film)}%`)
      art.append(filmPoster(film))
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
      card.onclick = () => openWatchFilmSheet(film)
      const more = document.createElement('button')
      more.type = 'button'
      more.className = 'watch-continue-more'
      more.textContent = '⋯'
      more.setAttribute('aria-label', `More actions for ${watchFilmTitle(film)}`)
      more.onclick = event => {
        event.stopPropagation()
        openWatchFilmSheet(film)
      }
      item.append(card, more)
      return item
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
      playOnTv({ kind: 'adult', file: film.path }, watchFilmTitle(film))
    }

    async function clearWatchFilmProgress(film, playAfter = false) {
      const source = { kind: 'adult', file: film.path }
      await api('/api/remote/clear-position', {
        method: 'POST', body: JSON.stringify(source),
      })
      const startFilm = { ...film, remote_position: 0, remote_last_watched: 0 }
      if (playAfter) {
        playWatchFilm(startFilm, 0)
        return
      }
      closeWatchFilmSheet()
      await load()
      setNotice(`${watchFilmTitle(film)} was removed from Continue Watching.`)
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
      const metadataButton = $('#watchFilmMetadata')
      metadataButton.disabled = !tmdbConfigured
      metadataButton.querySelector('span').textContent = metadata.tmdb_id ? 'Refresh metadata & subtitles' : 'Find metadata & subtitles'
      metadataButton.onclick = tmdbConfigured ? () => {
        closeWatchFilmSheet()
        scanTmdb(film)
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
      const options = $('#watchCollectionOptions')
      options.innerHTML = ''
      folders.forEach(folder => {
        const count = folder === '*' ? allFilms.length : allFilms.filter(film => film.folder === folder).length
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `watch-collection-option${watchFolder === folder ? ' active' : ''}`
        const label = document.createElement('span')
        label.textContent = folder === '*' ? 'All films' : folder
        const total = document.createElement('small')
        total.textContent = `${count} film${count === 1 ? '' : 's'}`
        button.append(label, total)
        button.onclick = () => {
          watchFolder = folder
          $('#watchCollectionSheet').close()
          document.documentElement.style.overflow = ''
          renderAdultWatch()
        }
        options.append(button)
      })
    }

    function renderAdultWatch() {
      const adult = $('#remoteAdult')
      adult.innerHTML = ''
      const allFilms = [...(library?.adult_library || [])].sort((left, right) => watchFilmTitle(left).localeCompare(watchFilmTitle(right), undefined, { sensitivity: 'base' }))
      const folders = ['*', ...(library?.adult_folders || [])]
      if (!folders.includes(watchFolder)) watchFolder = '*'
      renderWatchCollections(allFilms, folders)
      const collectionName = watchFolder === '*' ? 'All films' : watchFolder
      $('#watchCollectionName').textContent = collectionName
      const readyCount = allFilms.filter(film => film.browser_ready !== false).length
      $('#watchReadyCount').textContent = readyCount
      $('#watchReadyToggle').setAttribute('aria-pressed', String(watchReadyOnly))
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
        if (watchReadyOnly && film.browser_ready === false) return false
        if (!query) return true
        const metadata = film.metadata || {}
        return [watchFilmTitle(film), film.display_name, film.folder, metadata.year].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)
      })
      $('#watchLibraryKicker').textContent = query ? 'Search all films' : watchReadyOnly ? 'Ready to stream' : 'Your library'
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

    function openWatchProgrammeSheet(channel, programme) {
      selectedWatchProgramme = { channel, programme }
      const metadata = programme.metadata || {}
      const title = metadata.title || programme.display_name
      $('#watchProgrammeEyebrow').textContent = `CH ${channel.number} · ${channel.name}`
      $('#watchProgrammeTitle').textContent = title
      $('#watchProgrammeMeta').textContent = [metadata.year, channel.content_type === 'films' ? 'Film' : 'MabelTV programme'].filter(Boolean).join(' · ')
      $('#watchProgrammeTv').onclick = () => {
        closeWatchProgrammeSheet()
        playOnTv({ kind: 'channel', channel: channel.number, file: programme.name }, title)
      }
      const here = $('#watchProgrammeHere')
      here.disabled = false
      here.querySelector('strong').textContent = programme.browser_ready === false ? 'Play in VLC' : 'Watch on this device'
      here.querySelector('small').textContent = programme.browser_ready === false ? 'Opens the original without conversion' : 'Starts an independent stream'
      const source = { kind: 'channel', channel: channel.number, file: programme.name }
      here.onclick = () => {
        closeWatchProgrammeSheet()
        if (programme.browser_ready === false) openInVlc(source, title)
        else openRemotePlayer(source)
      }
      $('#watchProgrammeDownload').onclick = () => {
        closeWatchProgrammeSheet()
        downloadToDevice(source, title)
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

    function renderRemoteViewing() {
      const remote = library?.remote_viewing || {}; const simultaneous = remote.allow_simultaneous === true
      $('#remotePolicy span').textContent = simultaneous ? 'TV + this device ready' : 'Choose TV or this device'
      $('#remoteConcurrentState').textContent = simultaneous ? 'TV and one remote stream can run together' : 'One player at a time'
      $('#remoteConcurrentToggle').textContent = simultaneous ? 'Use one player' : 'Allow both'
      $('#remoteConcurrentToggle').setAttribute('aria-pressed', String(simultaneous))
      $('#watchMabelTab').classList.toggle('active', remoteKind === 'channel'); $('#watchMabelTab').setAttribute('aria-selected', String(remoteKind === 'channel'))
      $('#watchAdultTab').classList.toggle('active', remoteKind === 'adult'); $('#watchAdultTab').setAttribute('aria-selected', String(remoteKind === 'adult'))
      $('#watchDownloadsTab').classList.toggle('active', remoteKind === 'downloads'); $('#watchDownloadsTab').setAttribute('aria-selected', String(remoteKind === 'downloads'))
      $('#remoteMabel').classList.toggle('hidden', remoteKind !== 'channel'); $('#watchAdultLayout').classList.toggle('hidden', remoteKind !== 'adult')
      $('#watchDownloadsLayout').classList.toggle('hidden', remoteKind !== 'downloads')
      $('#watchMabelUtilities').classList.toggle('hidden', remoteKind !== 'channel')
      $('#watchLibraryAdmin').classList.toggle('hidden', remoteKind !== 'adult')
      $('#watchAddAdult').classList.toggle('hidden', remoteKind !== 'adult')
      $('#watchManageAdult').classList.toggle('hidden', remoteKind !== 'adult')
      if (remoteKind === 'downloads') {
        renderDownloads().catch(showError)
        return
      }
      const mabel = $('#remoteMabel'); mabel.innerHTML = ''
      ;(library?.channels || []).forEach(channel => {
        const programmes = channel.enabled
          ? (channel.programmes || []).filter(programme => programme.enabled)
          : []
        const isFilms = channel.content_type === 'films'
        const section = document.createElement('section'); section.className = `watch-section mabel-channel-section ${isFilms ? 'mabel-film-channel' : 'mabel-show-channel'}`
        const metadata = channel.metadata || {}
        const manageCue = '<span class="watch-channel-manage-cue"><span>Manage channel</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></span>'
        if (!isFilms) {
          const identity = document.createElement('button'); identity.type = 'button'; identity.className = 'mabel-show-identity watch-channel-manage'
          if (metadata.artwork) identity.style.backgroundImage = `linear-gradient(90deg,rgba(7,12,10,.92) 0%,rgba(7,12,10,.62) 52%,rgba(7,12,10,.2) 100%),url('/api/channel/artwork/${encodeURIComponent(metadata.artwork)}')`
          identity.innerHTML = `<div><span>CH ${channel.number} · ${channel.enabled ? `${programmes.length} episodes` : 'Hidden from TV'}</span><h2>${escapeHtml(metadata.title || channel.name)}</h2><p>${escapeHtml(metadata.overview || `Open ${channel.name} to manage its programmes.`)}</p></div>${manageCue}`
          identity.setAttribute('aria-label', `Manage channel ${channel.number}, ${channel.name}`)
          identity.onclick = () => openChannel(channel.number, true)
          section.append(identity)
        } else {
          const head = document.createElement('button'); head.type = 'button'; head.className = 'watch-section-head mabel-film-head watch-channel-manage'; head.innerHTML = `<div><span>CH ${channel.number}${channel.enabled ? '' : ' · Hidden from TV'}</span><h2>${escapeHtml(channel.name)}</h2></div>${manageCue}`; head.setAttribute('aria-label', `Manage channel ${channel.number}, ${channel.name}`); head.onclick = () => openChannel(channel.number, true); section.append(head)
        }
        if (programmes.length) {
          const rail = document.createElement('div'); rail.className = 'watch-channel-rail'
          programmes.forEach(programme => {
            const card = document.createElement('button'); card.type = 'button'; card.className = `watch-programme ${isFilms ? 'watch-mabel-film' : 'watch-mabel-episode'}`
            const programmeMetadata = programme.metadata || {}
            if (isFilms) {
              const art = document.createElement(programmeMetadata.poster ? 'img' : 'span'); art.className = 'watch-mabel-film-art'
              if (programmeMetadata.poster) { art.src = `/api/channel/artwork/${encodeURIComponent(programmeMetadata.poster)}`; art.alt = '' }
              card.append(art)
            }
            const copy = document.createElement('span'); copy.className = 'watch-mabel-copy'
            const title = document.createElement('strong'); title.textContent = programmeMetadata.title || programme.display_name
            const play = document.createElement('small'); play.textContent = programme.browser_ready === false ? 'TV or VLC · choose where to play' : `${programmeMetadata.year ? `${programmeMetadata.year} · ` : ''}Choose where to watch  ›`
            copy.append(title, play); card.append(copy)
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
      renderAdultWatch()
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
    $('#watchReadyToggle').onclick = () => { watchReadyOnly = !watchReadyOnly; renderAdultWatch() }
    $('#watchCollectionTrigger').onclick = () => { $('#watchCollectionSheet').showModal(); document.documentElement.style.overflow = 'hidden' }
    $('#watchCollectionClose').onclick = () => $('#watchCollectionSheet').close()
    $('#watchCollectionSheet').onclick = event => { if (event.target === $('#watchCollectionSheet')) $('#watchCollectionSheet').close() }
    $('#watchCollectionSheet').onclose = () => { document.documentElement.style.overflow = '' }
    $('#watchFilmClose').onclick = closeWatchFilmSheet
    $('#watchFilmSheet').onclick = event => { if (event.target === $('#watchFilmSheet')) closeWatchFilmSheet() }
    $('#watchFilmSheet').onclose = () => { selectedWatchFilm = null; document.documentElement.style.overflow = '' }
    $('#watchProgrammeClose').onclick = closeWatchProgrammeSheet
    $('#watchProgrammeSheet').onclick = event => { if (event.target === $('#watchProgrammeSheet')) closeWatchProgrammeSheet() }
    $('#watchProgrammeSheet').onclose = () => { selectedWatchProgramme = null; document.documentElement.style.overflow = '' }
    $('#watchAddAdult').onclick = () => $('#adultAddFilms').click()
    $('#watchManageAdult').onclick = () => { openView('adult'); refreshTmdbStatus().catch(() => {}) }
    $('#remoteConcurrentToggle').onclick = () => manage('set-remote-simultaneous', { enabled: library?.remote_viewing?.allow_simultaneous !== true })
