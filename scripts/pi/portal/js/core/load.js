'use strict'

    function duration(seconds) {
      if (!seconds) return 'Just started'
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      return days ? `${days}d ${hours}h` : `${hours}h ${Math.floor((seconds % 3600) / 60)}m`
    }

    function renderUsbSeriesDestinations(preferredSeries = null, preferredSeason = null) {
      const seriesSelect = $('#usbSeries')
      const seasonSelect = $('#usbSeason')
      const seriesChoice = String(preferredSeries ?? seriesSelect.value ?? '')
      const seasonChoice = String(preferredSeason ?? seasonSelect.value ?? '')
      const seriesValues = library?.adult_series || []
      seriesSelect.replaceChildren()
      seriesValues.forEach(series => {
        const option = document.createElement('option')
        option.value = series.id
        option.textContent = series.title
        seriesSelect.append(option)
      })
      if (!seriesValues.length) {
        const option = document.createElement('option')
        option.value = ''
        option.textContent = 'Create a TV series in Adult TV first'
        seriesSelect.append(option)
      }
      seriesSelect.disabled = !seriesValues.length
      seriesSelect.value = seriesValues.some(series => series.id === seriesChoice)
        ? seriesChoice : String(seriesValues[0]?.id || '')

      const selected = seriesValues.find(series => series.id === seriesSelect.value)
      const seasons = [...new Set([
        ...(selected?.seasons || []),
        ...(selected?.episodes || []).map(episode => episode.season),
      ].map(Number).filter(number => number >= 1 && number <= 99))]
        .sort((left, right) => left - right)
      seasonSelect.replaceChildren()
      seasons.forEach(number => {
        const option = document.createElement('option')
        option.value = String(number)
        option.textContent = `Series ${number}`
        seasonSelect.append(option)
      })
      if (!seasons.length) {
        const option = document.createElement('option')
        option.value = ''
        option.textContent = 'Create a numbered series in Adult TV first'
        seasonSelect.append(option)
      }
      seasonSelect.disabled = !seasons.length
      seasonSelect.value = seasons.includes(Number(seasonChoice))
        ? seasonChoice : String(seasons[0] || '')
      $('#usbSeriesName').value = selected?.title || ''
    }

    function applyLibraryData(data, preferredUploadChannel = null) {
      library = data
      window.MabelPortalLibrary = library
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
      const usbAdultFolder = $('#usbAdultFolder')
      const usbAdultFolderChoice = usbAdultFolder.value
      const adultFolders = library.adult_folders || []
      usbAdultFolder.innerHTML = '<option value="">All films — no collection</option>'
      adultFolders.forEach(folder => {
        const option = document.createElement('option')
        option.value = folder
        option.textContent = folder
        usbAdultFolder.append(option)
      })
      if (adultFolders.includes(usbAdultFolderChoice)) usbAdultFolder.value = usbAdultFolderChoice
      renderUsbSeriesDestinations()
      if (!channels.some(channel => String(channel.number) === uploadChoice)) uploadChoice = String(channels[0]?.number ?? '')
      upload.value = uploadChoice
      if (selectedManageChannel !== null && !channels.some(channel =>
          (selectedManageChannelFolder && channel.folder === selectedManageChannelFolder)
          || channel.number === selectedManageChannel)) {
        selectedManageChannel = null
        selectedManageChannelFolder = ''
      }
    }

    function renderLibraryView(name, { force = false } = {}) {
      if (!library || offlineMode) return
      if (name === 'overview') {
        renderStatus()
        renderHomeLibrary()
      } else if (name === 'watch') {
        renderRemoteViewing({ force })
      } else if (name === 'live') {
        renderLiveChannelOptions()
      } else if (name === 'channels') {
        renderChannels()
      } else if (name === 'adult') {
        renderAdultLibrary()
      } else if (name === 'usb') {
        renderUsbSeriesDestinations()
      } else if (name === 'system') {
        renderStatus()
        renderTvSettings()
        renderParentOverlayStyle()
        renderTvGuideSetting()
        renderWatchmodeAvailabilitySetting()
        renderPortalPinSetting()
        refreshTmdbStatus().catch(() => {})
      }
    }

    async function refreshPortalDomains(options = {}) {
      const refreshLibrary = options.library !== false
      const refreshAdultViewing = options.adultViewing !== false
      const adultMutationRevision = adultViewingMutationRevision
      const position = capturePortalPosition()
      const interactionRevision = portalScrollSettlement
      const requests = []
      if (refreshLibrary) requests.push(api('/api/library'))
      if (refreshAdultViewing) requests.push(api('/api/adult/viewing'))
      const values = await Promise.all(requests)
      applyPortalBootstrap(await api('/api/bootstrap'))
      let index = 0
      if (refreshLibrary) {
        const data = values[index++]
        applyLibraryData(data, options.preferredUploadChannel)
        await writePortalDataCache('library-v1', data, 'library')
      }
      let adultViewingApplied = false
      if (refreshAdultViewing) {
        const data = values[index]
        adultViewingApplied = await loadAdultViewing({ render: false, data,
          expectedMutationRevision: adultMutationRevision })
        if (adultViewingApplied) {
          await writePortalDataCache('adult-viewing-v1', data, 'adult_viewing')
        }
      }
      const latestPosition = capturePortalPosition()
      if (!position.locked && latestPosition.view === position.view) {
        position.scrollY = latestPosition.scrollY
        position.anchor = latestPosition.anchor
        position.panels = latestPosition.panels
        if (interactionRevision !== portalScrollSettlement) position.rails = latestPosition.rails
      }
      const active = document.querySelector('.view.active')?.id.replace(/^view-/, '')
      if (active) renderLibraryView(active, { force: true })
      if (active === 'adult-viewing' && adultViewingApplied) {
        renderAdultViewing({ anchor: false })
        renderAdultSeries(watchSearchText)
      }
      restorePortalPosition(position)
      await settlePortalPosition(position)
    }

    async function load(preferredUploadChannel = null) {
      const bootstrap = applyPortalBootstrap(await api('/api/bootstrap'))
      portalConnectionState = 'connected'
      offlineMode = false
      document.body.classList.remove('offline-mode')
      await refreshPortalDomains({ preferredUploadChannel, bootstrap })
      refreshHomePowerState().catch(() => {})
    }

    async function loadInitialPortalData(bootstrap) {
      applyPortalBootstrap(bootstrap)
      const [cachedLibrary, cachedAdultViewing] = await Promise.all([
        readPortalDataCache('library-v1'),
        readPortalDataCache('adult-viewing-v1'),
      ])
      if (cachedLibrary) applyLibraryData(cachedLibrary.data)
      if (cachedAdultViewing) {
        await loadAdultViewing({ render: false, data: cachedAdultViewing.data })
      }
      const libraryChanged = !cachedLibrary
        || Number(cachedLibrary.revision) !== portalRevision('library')
      const adultChanged = !cachedAdultViewing
        || Number(cachedAdultViewing.revision) !== portalRevision('adult_viewing')
      if (!cachedLibrary) {
        await refreshPortalDomains()
        return { refresh: null, source: 'network' }
      }
      return {
        source: 'cache',
        refresh: libraryChanged || adultChanged
          ? refreshPortalDomains({ library: libraryChanged, adultViewing: adultChanged })
          : null,
      }
    }

    async function refreshTmdbStatus() {
      const status = await api('/api/tmdb/status')
      const previousConfigured = tmdbConfigured
      tmdbConfigured = status.configured === true
      $('#tmdbState').textContent = tmdbConfigured
        ? 'TMDB is connected. Metadata scans are manual and cached locally.'
        : 'TMDB enrichment is installed and ready. Add the API key when you are ready to connect it.'
      $('#tmdbState').classList.toggle('bad', false)
      if (tmdbConfigured !== previousConfigured) renderAdultLibrary()
    }
