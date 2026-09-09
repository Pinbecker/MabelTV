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

    async function load(preferredUploadChannel = null) {
      const data = await api('/api/library')
      const position = capturePortalPosition()
      library = data
      window.MabelPortalLibrary = library
      try { await loadAdultViewing({ render: false }) }
      catch (_) { adultViewingLoaded = false }
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
      renderStatus()
      renderUploads()
      renderAdultLibrary()
      renderChannels()
      renderLiveChannelOptions()
      renderTvSettings()
      renderParentOverlayStyle()
      renderTvGuideSetting()
      renderWatchmodeAvailabilitySetting()
      renderRemoteViewing()
      renderPortalPinSetting()
      restorePortalPosition(position)
      loadViewingInsights().catch(() => {})
      refreshHomePowerState().catch(() => {})
      refreshTmdbStatus().catch(() => {})
      await settlePortalPosition(position)
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
