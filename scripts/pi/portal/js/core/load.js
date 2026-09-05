'use strict'

    function duration(seconds) {
      if (!seconds) return 'Just started'
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      return days ? `${days}d ${hours}h` : `${hours}h ${Math.floor((seconds % 3600) / 60)}m`
    }

    async function load(preferredUploadChannel = null) {
      library = await api('/api/library')
      window.MabelPortalLibrary = library
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
      renderRemoteViewing()
      renderPortalPinSetting()
      loadViewingInsights().catch(() => {})
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
