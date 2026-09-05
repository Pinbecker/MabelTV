'use strict'

const $ = selector => document.querySelector(selector)
    const $$ = selector => [...document.querySelectorAll(selector)]
    const portalSheets = window.MabelPortalUI?.dialogs
    if (!portalSheets) throw new Error('MabelTV portal UI components are unavailable')
    const portalEmptyState = window.MabelPortalUI.emptyState
    const portalButton = window.MabelPortalUI.button
    let library = null
    let selectedManageChannel = null
    let selectedManageChannelFolder = ''
    let channelNavigationRevision = 0
    let channelWorkspaceReturnToWatch = false
    let channelReturnPosition = null
    let programmeSearch = ''
    let programmePage = 1
    let adultOptimisationRefresh = null
    let adultOptimisationWasActive = false
    let adultFolderFilter = '*'
    let adultSearchText = ''
    let selectedAdultFilm = null
    let selectedAdultFilmReturnTo = null
    let selectedAdultSeries = null
    let selectedAdultSeason = null
    let selectedAdultEpisode = null
    let adultSeriesUploadTarget = null
    let adultSeriesSourcePickerOpen = false
    let adultSeriesRestartTarget = null
    let selectedAdultSeriesFiles = []
    const PROGRAMMES_PER_PAGE = 12
    let setupStep = 1
    let setupChannels = []
    let recoveringOwner = false
    let configuredTvName = 'Your TV'
    let noticeTimer = null
    let homeStatusRefreshTimer = null
    let homeProgressAnchor = null
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
    // Watch opens on the family MabelTV library. Adult TV and downloads remain
    // explicit choices rather than carrying over from an earlier visit.
    let remoteKind = 'channel'
    let watchFolder = '*'
    let watchSearchText = ''
    let mabelSearchText = ''
    let homeSearchText = ''
    let selectedWatchFilm = null
    let selectedWatchProgramme = null
    let iosRemoteSession = null
    let iosRemotePositionTimer = null
    let iosRemoteHeartbeatTimer = null
    let iosRemoteLastSaved = 0
    let mabelRemoteSession = null
    let mabelRemoteHeartbeatTimer = null
    let mabelRemotePositionTimer = null
    let mabelRemoteLastSaved = 0
    let mabelRemoteTracksPosition = false
    let mabelControlsTimer = null
    let iosOfflineDownloadId = null
    let offlineStorageReady = false
    let offlineStorageError = ''
    let offlineMode = false
    let offlineProtectedAccess = false
    const pendingDownloads = new Map()
    let portalPlayerScrollY = 0
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

    function setOfflineProtectedAccess(unlocked) {
      offlineProtectedAccess = Boolean(unlocked)
      window.MabelOffline?.setMediaAccess(offlineProtectedAccess)
    }

    async function syncOfflineSecurity(required, pin = '') {
      if (!offlineStorageReady || !window.MabelOffline) return
      try {
        await window.MabelOffline.rememberSecurity(required, pin)
      } catch (error) {
        console.warn('Offline security could not be updated', error)
      }
    }

    async function authoriseOfflineDownload(manifest) {
      if (!window.MabelOffline?.protectedDownload(manifest)) return true
      if (offlineProtectedAccess) {
        window.MabelOffline.setMediaAccess(true)
        return true
      }
      const status = await window.MabelOffline.securityStatus()
      if (status.required === false) {
        setOfflineProtectedAccess(true)
        return true
      }
      const pin = window.prompt('Enter the parent PIN to watch this Adult download offline.')
      if (pin === null) return false
      await window.MabelOffline.verifyPin(pin)
      offlineProtectedAccess = true
      return true
    }

    function lockPortalPlayerScroll(fixBody = true) {
      if (document.documentElement.classList.contains('portal-player-open')) return
      portalPlayerScrollY = window.scrollY
      document.documentElement.classList.add('portal-player-open')
      document.body.classList.add('portal-player-open')
      document.body.classList.toggle('portal-player-fixed', fixBody)
      document.body.style.top = fixBody ? `-${portalPlayerScrollY}px` : ''
    }

    function unlockPortalPlayerScroll() {
      if (!document.documentElement.classList.contains('portal-player-open')) return
      document.documentElement.classList.remove('portal-player-open')
      document.body.classList.remove('portal-player-open')
      document.body.classList.remove('portal-player-fixed')
      document.body.style.top = ''
      window.scrollTo(0, portalPlayerScrollY)
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
      })
      const body = await response.json().catch(() => ({}))
      if (response.status === 401) {
        setOfflineProtectedAccess(false)
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
      if (message) {
        noticeTimer = setTimeout(() => {
          $('#notice').textContent = ''
          $('#notice').classList.remove('bad')
          noticeTimer = null
        }, bad ? 7000 : 3500)
      }
    }

    function showError(error) {
      notice(error?.message || String(error || 'Something went wrong'), true)
    }

    function offlineSetupMarkup() {
      const message = offlineStorageError || 'Offline downloads are not ready in this copy of MabelTV.'
      if (window.isSecureContext) {
        return `<div class="downloads-empty offline-setup"><strong>Finish offline setup</strong><p>${escapeHtml(message)}</p><p>Close MabelTV completely, reopen it while online, then return to Downloads.</p></div>`
      }
      return `<div class="downloads-empty offline-setup"><strong>Open the secure MabelTV app</strong><p>Offline downloads work in the Home Screen app installed from MabelTV's HTTPS address.</p><small>${escapeHtml(message)}</small></div>`
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
