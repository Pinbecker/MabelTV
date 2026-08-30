'use strict'

const $ = selector => document.querySelector(selector)
    const $$ = selector => [...document.querySelectorAll(selector)]
    let library = null
    let selectedManageChannel = null
    let channelWorkspaceReturnToWatch = false
    let programmeSearch = ''
    let programmeVisibility = 'all'
    let programmePage = 1
    let selectedProgrammeAction = null
    let adultOptimisationRefresh = null
    let adultFolderFilter = '*'
    let adultSearchText = ''
    let selectedAdultFilm = null
    const PROGRAMMES_PER_PAGE = 12
    let setupStep = 1
    let setupChannels = []
    let recoveringOwner = false
    let configuredTvName = 'Your TV'
    let noticeTimer = null
    let homeStatusRefreshTimer = null
    let liveRefreshTimer = null
    let liveFallbackTimer = null
    let liveFrameTimer = null
    let livePictureVisible = false
    let liveTvState = {}
    let remoteFeedbackTimer = null
    let usbState = { volumes: [], imports: [] }
    let usbVolume = ''
    let usbPath = ''
    let usbEntries = []
    let usbSelection = new Set()
    let usbJobTimer = null
    let tmdbConfigured = false
    // Watch is an adult-library-first surface.  Mabel TV remains one tap away
    // but is never restored as the accidental default from an earlier visit.
    let remoteKind = 'adult'
    let watchFolder = '*'
    let watchSearchText = ''
    let watchReadyOnly = false
    let selectedWatchFilm = null
    let selectedWatchProgramme = null
    let iosRemoteSession = null
    let iosRemotePositionTimer = null
    let iosRemoteHeartbeatTimer = null
    let iosRemoteLastSaved = 0
    let mabelRemoteSession = null
    let mabelRemoteHeartbeatTimer = null
    let mabelControlsTimer = null
    let iosOfflineDownloadId = null
    let offlineStorageReady = false
    let offlineMode = false
    const pendingDownloads = new Map()

    async function api(path, options = {}) {
      const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
      })
      const body = await response.json().catch(() => ({}))
      if (response.status === 401) {
        showOnly('login')
        $('#loginError').classList.add('bad')
        $('#loginError').textContent = 'Your session was locked. Enter the parent PIN to continue.'
        $('#pin').focus()
        throw new Error('Your session was locked')
      }
      if (!response.ok) {
        const error = new Error(body.error || `${tvName()} could not complete that request`)
        error.status = response.status
        error.code = body.code
        throw error
      }
      return body
    }

    function showOnly(id) {
      for (const name of ['setup', 'login', 'app']) $('#' + name).classList.toggle('hidden', name !== id)
    }

    function tvName() {
      const value = library?.owner?.tv_name
      return typeof value === 'string' && value.trim() ? value.trim() : configuredTvName
    }

    function applyTvName() {
      const name = tvName()
      try { localStorage.setItem('mabeltv-tv-name', name) } catch (_) { /* optional */ }
      document.title = name
      $('#topTvName').textContent = name
      $('#mainNav').setAttribute('aria-label', `${name} sections`)
      $$('[data-tv-name]').forEach(element => { element.textContent = name })
      $('#tvNameChild').value = library?.owner?.child_name || ''
    }

    function notice(message = '', bad = false) {
      if (noticeTimer !== null) {
        clearTimeout(noticeTimer)
        noticeTimer = null
      }
      $('#notice').textContent = message
      $('#notice').classList.toggle('bad', bad)
      if (message && !message.endsWith('…')) {
        noticeTimer = setTimeout(() => {
          $('#notice').textContent = ''
          $('#notice').classList.remove('bad')
          noticeTimer = null
        }, bad ? 7000 : 5000)
      }
    }

    function showError(error) {
      notice(error?.message || String(error || 'Something went wrong'), true)
    }

    function slug(value) {
      return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'channel'
    }

    function setupMarker() {
      const finalStep = recoveringOwner ? 2 : 3
      $$('.setup-step').forEach(section => section.classList.toggle('hidden', Number(section.dataset.step) !== setupStep))
      $$('[data-step-marker]').forEach(marker => {
        marker.classList.toggle('active', Number(marker.dataset.stepMarker) <= setupStep)
        if (Number(marker.dataset.stepMarker) === setupStep) marker.setAttribute('aria-current', 'step')
        else marker.removeAttribute('aria-current')
      })
      $('#setupBack').classList.toggle('hidden', setupStep === 1)
      $('#setupNext').classList.toggle('hidden', setupStep === finalStep)
      $('#setupFinish').classList.toggle('hidden', setupStep !== finalStep)
      $('#setupError').textContent = ''
      const heading = document.querySelector(`.setup-step[data-step="${setupStep}"] h2`)
      if (heading) { heading.tabIndex = -1; heading.focus() }
    }

    function renderSetupChannels() {
      const root = $('#setupChannels')
      root.innerHTML = ''
      setupChannels.forEach((channel, index) => {
        const box = document.createElement('div')
        box.className = 'channel-setup'
        box.innerHTML = `<div class="channel-setup-fields" role="group" aria-label="Channel ${channel.number} ${escapeHtml(channel.name)}">
          <label>Number<input type="number" min="1" max="999" data-setup-field="number" value="${channel.number}" required></label>
          <label>Name<input maxlength="60" data-setup-field="name" value="${escapeHtml(channel.name)}" required></label>
          <label>Picture<select data-setup-field="aspect"><option value="crop">Fill screen</option><option value="fit">Whole picture</option><option value="stretch">Stretch</option></select></label>
          <label>Content<select data-setup-field="content_type"><option value="shows">Shows / episodes</option><option value="films">Films / long videos</option></select></label>
          <button type="button" class="secondary" data-remove-channel="${index}" aria-label="Remove channel ${channel.number} ${escapeHtml(channel.name)}">Remove</button>
        </div>`
        box.querySelector('[data-setup-field="aspect"]').value = channel.aspect || 'crop'
        box.querySelector('[data-setup-field="content_type"]').value = channel.content_type || 'shows'
        box.querySelectorAll('[data-setup-field]').forEach(input => input.addEventListener('change', event => {
          const field = event.target.dataset.setupField
          setupChannels[index][field] = field === 'number' ? Number(event.target.value) : event.target.value
          if (field === 'name') setupChannels[index].folder = slug(event.target.value)
        }))
        root.append(box)
      })
      $$('[data-remove-channel]').forEach(button => button.onclick = () => {
        if (setupChannels.length === 1) { $('#setupError').textContent = 'Keep at least one channel.'; return }
        setupChannels.splice(Number(button.dataset.removeChannel), 1)
        renderSetupChannels()
      })
    }

    function escapeHtml(value) {
      const span = document.createElement('span')
      span.textContent = String(value)
      return span.innerHTML
    }

    function openRequestedView() {
      const requested = location.hash.replace(/^#/, '')
      const view = requested === 'home' ? 'overview' : requested
      const allowed = new Set(['overview', 'live', 'channels', 'adult', 'watch', 'usb', 'system'])
      if (allowed.has(view)) openView(view)
      else if (new URLSearchParams(location.search).has('watch')) openView('watch')
      else openView('overview')
    }

    async function initialise() {
      try {
        await window.MabelOffline?.initialise()
        offlineStorageReady = Boolean(window.MabelOffline)
      } catch (error) {
        console.warn('Offline storage could not start', error)
      }
      try {
        const state = await api('/api/setup')
        configuredTvName = typeof state.tv_name === 'string' && state.tv_name.trim()
          ? state.tv_name.trim() : configuredTvName
        applyTvName()
        if (!state.configured) {
          recoveringOwner = Boolean(state.recovering_owner)
          setupChannels = state.default_channels.map(channel => ({ ...channel }))
          if (recoveringOwner) {
            $('#setupEyebrow').textContent = 'Parent PIN recovery'
            $('#setupTitle').textContent = 'Reset your parent PIN'
            $('#setupIntro').textContent = 'Your existing channels and videos will stay exactly as they are. Confirm the setup code, then choose a new parent PIN.'
            $('[data-step-marker="3"]').classList.add('hidden')
            $('#setupFinish').textContent = 'Reset parent PIN'
            $('#childNameSetupLabel').classList.add('hidden')
            $('#childName').required = false
          } else {
            $('#childNameSetupLabel').classList.remove('hidden')
            $('#childName').required = true
            renderSetupChannels()
          }
          setupMarker()
          showOnly('setup')
        } else if (state.portal_pin_required === false) {
          await load()
          showOnly('app')
          openRequestedView()
        } else {
          // A valid HttpOnly session cookie survives an iPad page reload.  Ask
          // the protected library before showing the PIN screen so closing a
          // native player never looks like a logout.
          try {
            await load()
            showOnly('app')
            openRequestedView()
          } catch (error) {
            showOnly('login')
            if (error.status !== 401) {
              $('#loginError').classList.add('bad')
              $('#loginError').textContent = `The portal connection was interrupted. ${tvName()} is still running — try again in a moment.`
            }
          }
        }
      } catch (error) {
        if (offlineStorageReady) {
          offlineMode = true
          document.body.classList.add('offline-mode')
          try { configuredTvName = localStorage.getItem('mabeltv-tv-name') || configuredTvName } catch (_) { /* optional */ }
          applyTvName()
          showOnly('app')
          remoteKind = 'downloads'
          renderRemoteViewing()
          openView('watch')
          await renderDownloads()
          return
        }
        showOnly('login')
        $('#loginError').classList.add('bad')
        $('#loginError').textContent = `The portal connection was interrupted. ${tvName()} is still running — refresh in a moment.`
      }
    }

    $('#setupNext').onclick = async () => {
      if (setupStep === 1 && !$('#setupCode').checkValidity()) { $('#setupCode').reportValidity(); return }
      if (setupStep === 1) {
        const button = $('#setupNext')
        button.disabled = true
        try {
          await api('/api/setup/check', { method: 'POST', body: JSON.stringify({ setup_code: $('#setupCode').value }) })
        } catch (error) {
          $('#setupError').textContent = error.message
          $('#setupCode').focus()
          button.disabled = false
          return
        }
        button.disabled = false
      }
      if (setupStep === 2) {
        if (!recoveringOwner && !$('#childName').checkValidity()) { $('#childName').reportValidity(); return }
        if (!$('#setupPin').checkValidity()) { $('#setupPin').reportValidity(); return }
        if ($('#setupPin').value !== $('#setupPinAgain').value) { $('#setupError').textContent = 'The two PINs do not match.'; return }
      }
      setupStep++
      setupMarker()
    }
    $('#setupBack').onclick = () => { setupStep--; setupMarker() }
    $('#addSetupChannel').onclick = () => {
      const used = new Set(setupChannels.map(channel => Number(channel.number)))
      let number = 1
      while (used.has(number)) number++
      setupChannels.push({ number, name: 'New channel', folder: `channel-${number}`, aspect: 'crop', content_type: 'shows' })
      renderSetupChannels()
    }
    $('#setupForm').onsubmit = async event => {
      event.preventDefault()
      if ($('#setupPin').value !== $('#setupPinAgain').value) { setupStep = 2; setupMarker(); $('#setupError').textContent = 'The two PINs do not match.'; return }
      const button = $('#setupFinish')
      button.disabled = true
      button.textContent = 'Setting up…'
      try {
        const setupPayload = { setup_code: $('#setupCode').value, owner_name: $('#ownerName').value, pin: $('#setupPin').value }
        if (!recoveringOwner) setupPayload.child_name = $('#childName').value
        if (!recoveringOwner) setupPayload.channels = setupChannels
        await api('/api/setup', { method: 'POST', body: JSON.stringify(setupPayload) })
        showOnly('login')
        $('#loginError').classList.remove('bad')
        $('#loginError').textContent = recoveringOwner
          ? 'Your parent PIN was reset. Your channels and videos were not changed.'
          : `Setup complete. Enter your new parent PIN to open ${tvName()}.`
        $('#pin').focus()
      } catch (error) {
        if (error.message.toLowerCase().includes('setup code')) { setupStep = 1; setupMarker() }
        $('#setupError').textContent = error.message
      } finally {
        button.disabled = false
        button.textContent = recoveringOwner ? 'Reset parent PIN' : 'Finish setup'
      }
    }

    $('#loginForm').onsubmit = async event => {
      event.preventDefault()
      const button = event.submitter
      button.disabled = true
      try {
        await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) })
        $('#pin').value = ''
        await load()
        showOnly('app')
        openRequestedView()
      } catch (error) {
        $('#loginError').classList.add('bad')
        $('#loginError').textContent = error.message
      } finally { button.disabled = false }
    }
    $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload() }

    function openView(name) {
      if (offlineMode && name !== 'watch') name = 'watch'
      $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`))
      document.body.classList.toggle('watch-mode', name === 'watch')
      $$('[data-view-button]').forEach(button => {
        const active = button.dataset.viewButton === name
        button.classList.toggle('active', active)
        if (active) button.setAttribute('aria-current', 'page')
        else button.removeAttribute('aria-current')
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      if (name === 'live') startLiveTv()
      else stopLiveTv()
      if (name === 'overview') startHomeStatusRefresh()
      else stopHomeStatusRefresh()
      if (name === 'usb') refreshUsb().catch(error => notice(error.message, true))
      if (name === 'watch' && remoteKind === 'downloads') renderDownloads().catch(showError)
    }

    function showLivePicture() {
      livePictureVisible = true
      clearTimeout(liveFallbackTimer)
      $('#liveOff').classList.add('hidden')
    }

    function showLiveFallback() {
      if (!liveRefreshTimer || $('#liveMjpeg').getAttribute('src')) return
      clearTimeout(liveFallbackTimer)
      clearTimeout(liveFrameTimer)
      const video = $('#liveVideo')
      if (window.liveHls) {
        window.liveHls.destroy()
        window.liveHls = null
      }
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.classList.add('hidden')
      const image = $('#liveMjpeg')
      const nextFrame = () => {
        if (!liveRefreshTimer) return
        image.src = `/api/live/frame.jpg?frame=${Date.now()}`
      }
      image.onload = () => {
        showLivePicture()
        clearTimeout(liveFrameTimer)
        liveFrameTimer = setTimeout(nextFrame, 100)
      }
      image.onerror = () => {
        clearTimeout(liveFrameTimer)
        liveFrameTimer = setTimeout(nextFrame, 500)
      }
      image.classList.remove('hidden')
      // Each request is made only after the previous JPEG has painted.
      nextFrame()
    }

    function setLiveSource() {
      const video = $('#liveVideo')
      const image = $('#liveMjpeg')
      livePictureVisible = false
      clearTimeout(liveFallbackTimer)
      image.removeAttribute('src')
      image.classList.add('hidden')
      if (window.liveHls) {
        window.liveHls.destroy()
        window.liveHls = null
      }
      video.pause()
      video.classList.remove('hidden')
      video.removeAttribute('src')
      video.load()
      // Use the Pi-owned live-picture feed directly. It is shared by every
      // portal and avoids each browser opening its own decoder.
      showLiveFallback()
    }

    function setRemoteFeedback(message, tone = '', hold = 1100) {
      clearTimeout(remoteFeedbackTimer)
      const feedback = $('#remoteFeedback')
      const container = feedback.closest('.remote-feedback')
      feedback.textContent = message
      container.classList.toggle('success', tone === 'success')
      container.classList.toggle('error', tone === 'error')
      if (hold > 0) remoteFeedbackTimer = setTimeout(() => {
        remoteFeedbackTimer = null
        renderRemoteState(liveTvState)
      }, hold)
    }

    function renderLiveChannelOptions() {
      const root = $('#liveChannelOptions')
      if (!root) return
      const channels = (library?.channels || []).filter(channel => channel.enabled)
      if (!channels.length) {
        root.innerHTML = '<div class="watch-empty">No active channels are available.</div>'
        return
      }
      root.innerHTML = channels.map(channel => `<button type="button" class="remote-channel-option" data-live-channel="${channel.number}"><span class="remote-channel-number">CH ${channel.number}</span><span><strong>${escapeHtml(channel.name)}</strong><small>${channel.programmes.length} programme${channel.programmes.length === 1 ? '' : 's'}</small></span></button>`).join('')
      $$('[data-live-channel]').forEach(button => button.onclick = () => tuneLiveChannel(Number(button.dataset.liveChannel), button))
      updateLiveChannelSelection(liveTvState)
    }

    function updateLiveChannelSelection(state) {
      $$('[data-live-channel]').forEach(button => {
        const current = !state.adult_mode && Number(button.dataset.liveChannel) === Number(state.channel_number)
        button.classList.toggle('active', current)
        button.setAttribute('aria-current', current ? 'true' : 'false')
      })
    }

    function renderRemoteState(state) {
      const available = state.available === true
      const locked = state.remote_locked === true
      const adult = state.adult_mode === true
      const paused = state.paused === true
      const muted = state.muted === true
      const volume = Number.isFinite(Number(state.volume)) ? Math.max(0, Math.min(100, Number(state.volume))) : null
      $('#remoteConnectionDot').classList.toggle('off', !available)
      if (remoteFeedbackTimer === null) {
        const feedback = $('#remoteFeedback').closest('.remote-feedback')
        feedback.classList.toggle('success', available)
        feedback.classList.remove('error')
        $('#remoteFeedback').textContent = locked ? 'Kids’ remote locked' : (available ? 'Ready' : 'TV offline')
      }
      $('#remoteMabelAction').classList.toggle('active', available && !adult)
      $('#remoteAdultAction').classList.toggle('active', available && adult)
      $('#remoteVolumeValue').textContent = muted ? 'Muted' : (volume === null ? '—' : `${Math.round(volume)}%`)
      $('#remoteMute').classList.toggle('muted', muted)
      $('#remoteMute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute')
      $('#remotePlaybackState').textContent = paused ? 'Paused' : (available ? 'Playing' : 'Offline')
      $('#remotePlaybackState').classList.toggle('paused', paused)
      $('#remotePlayPause').classList.toggle('paused', paused)
      $('#remotePlayPauseLabel').textContent = paused ? 'Play' : 'Pause'
      $('#remoteSubtitles').classList.toggle('active', state.subtitles_visible === true)
      $('#remoteSubtitles').setAttribute('aria-pressed', String(state.subtitles_visible === true))
      $('#remoteSubtitles').querySelector('span').textContent = adult
        ? (state.subtitles_available === false ? 'No subtitles' : 'Subtitles') : 'Adult only'
      $('#remoteChannelPickerLabel').textContent = adult
        ? 'Adult TV is open' : (available ? `CH ${state.channel_number} · ${state.channel_name}` : 'Choose a channel')
      $('#remoteLock').classList.toggle('active', locked)
      $('#remoteLock').querySelector('span').textContent = locked ? 'Unlock kids' : 'Lock kids'
      $('#remoteLock').setAttribute('aria-label', locked ? 'Unlock kids’ physical remote' : 'Lock kids’ physical remote')
      $$('[data-live-command]').forEach(button => {
        const adultSubtitles = button.dataset.liveCommand !== 'toggle-subtitles'
          || (adult && state.subtitles_available !== false)
        button.disabled = !adultSubtitles
      })
      $('#openLiveChannels').disabled = false
      $('#openRemotePower').disabled = false
      updateLiveChannelSelection(state)
      const waking = state.standby === true
      $('#remotePowerTitle').textContent = waking ? 'Wake MabelTV?' : 'Put MabelTV in standby?'
      $('#remotePowerDescription').textContent = waking
        ? 'The television will start and return to the last channel.'
        : 'The portal stays available. Use the physical remote or this page to wake the television again.'
      $('#remotePowerActionTitle').textContent = waking ? 'Wake the television' : 'Put TV in standby'
      $('#remotePowerActionHint').textContent = waking ? 'Return to the last channel' : 'The screen will switch off safely'
      $('#cancelRemotePower').textContent = waking ? 'Not now' : 'Keep watching'
    }

    function renderLiveTv(state) {
      liveTvState = state || {}
      const available = state.available === true
      $('#liveOff').classList.toggle('hidden', available && livePictureVisible)
      $('#liveLed').classList.toggle('off', !available)
      $('#liveOffTitle').textContent = available ? 'Starting live picture…' : (state.reason || 'The TV is off')
      $('#liveOffText').textContent = available ? 'Connecting to MabelTV' : 'Turn on the television to start the live preview.'
      $('#liveProgramme').textContent = available ? state.programme : 'Waiting for MabelTV'
      $('#liveChannel').textContent = available
        ? (state.adult_mode ? 'ADULT TV · PRIVATE LIBRARY' : `CH ${state.channel_number} · ${state.channel_name}`)
        : 'Live preview'
      $('#liveState').textContent = available ? (state.paused ? 'Paused' : 'Live') : 'Offline'
      renderRemoteState(state)
    }

    async function refreshLiveTv(restartStream = false) {
      try {
        const state = await api('/api/live')
        renderLiveTv(state)
        // The video element deliberately has no source when using the reliable
        // JPEG feed. Checking it here restarted the picture every 2.5 seconds.
        if (state.available && (restartStream || !$('#liveMjpeg').getAttribute('src'))) setLiveSource()
      } catch (error) {
        renderLiveTv({ available: false, reason: error.message })
      }
    }

    async function refreshHomePowerState() {
      const state = await api('/api/live')
      liveTvState = state || {}
      const standby = state.standby === true
      $('#homePowerState').textContent = standby ? 'Standby' : 'On'
      $('#homePowerToggle').textContent = standby ? 'Turn On' : 'Turn Off'
      if (standby) {
        $('#homeNowPlayingTitle').textContent = 'Nothing playing'
        $('#homeNowPlayingMeta').textContent = 'MabelTV is in standby'
      } else if (state.adult_mode === true) {
        const playing = state.adult_playing === true
        $('#homeNowPlayingTitle').textContent = playing ? (state.programme || 'Adult film') : 'Adult library'
        $('#homeNowPlayingMeta').textContent = playing
          ? `Adult Mode · ${state.paused === true ? 'Paused' : 'Playing'}`
          : 'Adult Mode · Ready'
      } else if (state.available === true) {
        $('#homeNowPlayingTitle').textContent = state.programme || 'Current programme'
        $('#homeNowPlayingMeta').textContent = `CH ${state.channel_number} · ${state.channel_name} · ${state.paused === true ? 'Paused' : 'Playing'}`
      } else {
        $('#homeNowPlayingTitle').textContent = 'Getting ready…'
        $('#homeNowPlayingMeta').textContent = state.reason || 'Waiting for the current programme'
      }
      return state
    }

    function startHomeStatusRefresh() {
      refreshHomePowerState().catch(() => {})
      if (!homeStatusRefreshTimer)
        homeStatusRefreshTimer = setInterval(() => refreshHomePowerState().catch(() => {}), 5000)
    }

    function stopHomeStatusRefresh() {
      if (!homeStatusRefreshTimer) return
      clearInterval(homeStatusRefreshTimer)
      homeStatusRefreshTimer = null
    }

    function startLiveTv() {
      if (liveRefreshTimer) return
      refreshLiveTv(true)
      liveRefreshTimer = setInterval(() => refreshLiveTv(), 2500)
    }

    function stopLiveTv() {
      if (!liveRefreshTimer) return
      clearInterval(liveRefreshTimer)
      liveRefreshTimer = null
      const video = $('#liveVideo')
      clearTimeout(liveFallbackTimer)
      clearTimeout(liveFrameTimer)
      livePictureVisible = false
      video.pause()
      video.removeAttribute('src')
      video.load()
      const image = $('#liveMjpeg')
      image.removeAttribute('src')
      image.classList.add('hidden')
      if (window.liveHls) {
        window.liveHls.destroy()
        window.liveHls = null
      }
      api('/api/live/stop', { method: 'POST', body: '{}' }).catch(() => {})
    }
    $$('[data-view-button]').forEach(button => button.onclick = () => {
      if (button.dataset.viewButton === 'channels') showChannelHub()
      openView(button.dataset.viewButton)
      if (button.dataset.viewButton === 'adult') refreshTmdbStatus().catch(() => {})
    })
    $$('[data-go]').forEach(button => button.onclick = () => {
      if (button.dataset.go === 'channels') showChannelHub()
      openView(button.dataset.go)
    })

    function duration(seconds) {
      if (!seconds) return 'Just started'
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      return days ? `${days}d ${hours}h` : `${hours}h ${Math.floor((seconds % 3600) / 60)}m`
    }

    async function load(preferredUploadChannel = null) {
      library = await api('/api/library')
      offlineMode = false
      document.body.classList.remove('offline-mode')
      applyTvName()
      const channels = library.channels || []
      const upload = $('#channel')
      let uploadChoice = String(preferredUploadChannel ?? upload.value ?? '')
      upload.innerHTML = ''
      channels.forEach(channel => {
        const option = document.createElement('option')
        option.value = channel.number
        option.textContent = `CH ${channel.number} — ${channel.name}`
        upload.append(option)
      })
      const usbChannel = $('#usbChannel')
      const usbChannelChoice = usbChannel.value
      usbChannel.innerHTML = ''
      channels.forEach(channel => {
        const option = document.createElement('option')
        option.value = channel.number
        option.textContent = `CH ${channel.number} — ${channel.name}`
        usbChannel.append(option)
      })
      if (channels.some(channel => String(channel.number) === usbChannelChoice)) usbChannel.value = usbChannelChoice
      if (!channels.some(channel => String(channel.number) === uploadChoice)) uploadChoice = String(channels[0]?.number ?? '')
      upload.value = uploadChoice
      if (selectedManageChannel !== null && !channels.some(channel => channel.number === selectedManageChannel)) selectedManageChannel = null
      renderStatus()
      renderUploads()
      renderAdultLibrary()
      renderChannels()
      renderLiveChannelOptions()
      renderTvSettings()
      renderParentOverlayStyle()
      renderTvGuideSetting()
      renderRemoteViewing()
      renderPortalPinSetting()
      renderPortalTheme()
      refreshHomePowerState().catch(() => {})
      refreshTmdbStatus().catch(() => {})
    }

    async function refreshTmdbStatus() {
      const status = await api('/api/tmdb/status')
      tmdbConfigured = status.configured === true
      $('#tmdbState').textContent = tmdbConfigured
        ? 'TMDB is connected. Metadata scans are manual and cached locally.'
        : 'TMDB enrichment is installed and ready. Add the API key when you are ready to connect it.'
      $('#tmdbState').classList.toggle('bad', false)
      renderAdultLibrary()
    }
