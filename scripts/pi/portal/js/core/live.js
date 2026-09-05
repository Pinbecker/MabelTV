'use strict'

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
        root.replaceChildren(portalEmptyState({
          className: 'watch-empty',
          message: 'No active channels are available.',
        }))
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

    function connectedTvDisplayState(state) {
      if (state?.connected_tv_available === false) {
        return MabelPortalUI.powerStatus('unavailable', { sentence: 'status unavailable' })
      }
      const power = String(state?.connected_tv_power || '').trim().toLocaleLowerCase()
      if (power === 'on') return MabelPortalUI.powerStatus('on')
      if (power === 'standby') return MabelPortalUI.powerStatus('standby')
      if (power.includes('standby to on')) {
        return MabelPortalUI.powerStatus('turning-on')
      }
      if (power.includes('on to standby')) {
        return MabelPortalUI.powerStatus('going-standby')
      }
      return MabelPortalUI.powerStatus('unknown')
    }

    function mabelTvDisplayState(state) {
      if (state?.standby === true) {
        return MabelPortalUI.powerStatus('standby')
      }
      if (state?.standby === false || state?.available === true) {
        return MabelPortalUI.powerStatus('on')
      }
      return MabelPortalUI.powerStatus('unavailable')
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
      const widescreenAvailable = !adult && state.widescreen_available === true
      const widescreenEnabled = widescreenAvailable && state.widescreen_enabled === true
      $('#remoteWidescreen').classList.toggle('hidden', !widescreenAvailable)
      $('#remoteWidescreen').classList.toggle('active', widescreenEnabled)
      $('#remoteWidescreen').setAttribute('aria-pressed', String(widescreenEnabled))
      $('#remoteWidescreen').setAttribute('aria-label', widescreenEnabled
        ? 'Turn widescreen mode off' : 'Turn widescreen mode on')
      const adultHandoffAvailable = available && !adult
        && state.adult_handoff_available === true
      $('#remoteAdultHandoff').classList.toggle('hidden', !adultHandoffAvailable)
      $('#remoteAdultHandoff').setAttribute('aria-label', `Continue ${state.programme || 'this programme'} in Adult TV without the television frame`)
      $('#remoteChannelPickerLabel').textContent = adult
        ? 'Adult TV is open' : (available ? `CH ${state.channel_number} · ${state.channel_name}` : 'Choose a channel')
      $('#remoteLock').classList.toggle('active', locked)
      $('#remoteLock').querySelector('.remote-dock-action-label').textContent = locked ? 'Unlock kids' : 'Lock kids'
      $('#remoteLock').setAttribute('aria-label', locked ? 'Unlock kids’ physical remote' : 'Lock kids’ physical remote')
      $$('[data-live-command]').forEach(button => {
        const adultSubtitles = button.dataset.liveCommand !== 'toggle-subtitles'
          || (adult && state.subtitles_available !== false)
        const widescreenControl = button.dataset.liveCommand !== 'toggle-widescreen-mode'
          || widescreenAvailable
        const adultHandoffControl = button.dataset.liveCommand !== 'continue-in-adult-mode'
          || adultHandoffAvailable
        button.disabled = !adultSubtitles || !widescreenControl || !adultHandoffControl
      })
      $('#openLiveChannels').disabled = false
      $('#openRemotePower').disabled = false
      updateLiveChannelSelection(state)
      const waking = state.standby === true
      const connectedTv = connectedTvDisplayState(state)
      $('#remotePowerTitle').textContent = waking ? 'Turn on MabelTV?' : 'Put MabelTV in standby?'
      $('#remotePowerDescription').textContent = waking
        ? `The connected television is ${connectedTv.sentence}. Would you like to turn it on too?`
        : `The connected television is ${connectedTv.sentence}. Would you like to put it in standby too?`
      $('#remotePowerActionTitle').textContent = waking ? 'Yes, turn both on' : 'Yes, put both in standby'
      $('#remotePowerActionHint').textContent = waking
        ? 'Wake MabelTV and select its HDMI input'
        : 'Put MabelTV and the connected television in standby'
      $('#mabelOnlyPowerActionTitle').textContent = waking ? 'No, MabelTV only' : 'No, MabelTV only'
      $('#mabelOnlyPowerActionHint').textContent = waking
        ? 'Leave the connected television as it is'
        : 'Keep the connected television on'
      $('#cancelRemotePower').textContent = 'Cancel'
      $('#confirmRemotePower').classList.toggle('is-wake', waking)
      $('#mabelOnlyRemotePower').classList.toggle('is-wake', waking)
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
      setHomeSpotlightArtwork(state)
      setHomeSpotlightProgress(state)
      const mabelTv = mabelTvDisplayState(state)
      const standby = mabelTv.className === 'is-standby'
      const connectedTv = connectedTvDisplayState(state)
      $('#homePowerState').textContent = mabelTv.label
      const mabelState = $('#homeMabelTvState')
      const mabelDot = $('#homeMabelTvDot')
      MabelPortalUI.setPowerStatus(mabelDot, mabelState, mabelTv)
      const connectedState = $('#homeConnectedTvState')
      const connectedDot = $('#homeConnectedTvDot')
      MabelPortalUI.setPowerStatus(connectedDot, connectedState, connectedTv)
      $('#homePowerToggle').textContent = standby ? 'Turn On' : 'Turn Off'
      const nowPlayingMeta = $('#homeNowPlayingMeta')
      if (standby) {
        $('#homeNowPlayingTitle').textContent = 'Nothing playing'
        nowPlayingMeta.textContent = ''
      } else if (state.adult_mode === true) {
        const playing = state.adult_playing === true
        $('#homeNowPlayingTitle').textContent = playing ? (state.programme || 'Adult film') : 'Adult library'
        nowPlayingMeta.textContent = playing
          ? `Adult Mode · ${state.paused === true ? 'Paused' : 'Playing'}`
          : 'Adult Mode · Ready'
      } else if (state.available === true) {
        $('#homeNowPlayingTitle').textContent = state.programme || 'Current programme'
        nowPlayingMeta.textContent = `CH ${state.channel_number} · ${state.channel_name} · ${state.paused === true ? 'Paused' : 'Playing'}`
      } else {
        $('#homeNowPlayingTitle').textContent = 'Getting ready…'
        nowPlayingMeta.textContent = state.reason || 'Waiting for the current programme'
      }
      nowPlayingMeta.classList.toggle('hidden', !nowPlayingMeta.textContent)
      return state
    }

    function homeMediaKey(value) {
      return String(value || '').trim().toLocaleLowerCase()
    }

    function homeArtworkUrl(kind, name) {
      if (!name) return ''
      const endpoint = kind === 'adult' ? '/api/adult/artwork/' : '/api/channel/artwork/'
      return `${endpoint}${encodeURIComponent(name)}`
    }

    function homeMediaForState(state) {
      const currentTitle = homeMediaKey(state?.programme)
      if (!currentTitle) return null
      if (state?.adult_mode === true) {
        return (library?.adult_library || []).find(item => [
          item.metadata?.title,
          item.display_name,
          item.name,
        ].some(value => homeMediaKey(value) === currentTitle))
      }
      const channel = (library?.channels || []).find(item => Number(item.number) === Number(state?.channel_number))
      return channel?.programmes?.find(item => [
        item.metadata?.title,
        item.display_name,
        item.name,
      ].some(value => homeMediaKey(value) === currentTitle)) || null
    }

    function homeArtworkForState(state) {
      const media = homeMediaForState(state)
      if (media?.metadata?.poster)
        return homeArtworkUrl(state?.adult_mode === true ? 'adult' : 'channel', media.metadata.poster)
      if (state?.adult_mode !== true) {
        const channel = (library?.channels || []).find(item => Number(item.number) === Number(state?.channel_number))
        if (channel?.metadata?.artwork) return homeArtworkUrl('channel', channel.metadata.artwork)
        const channelPoster = channel?.programmes?.find(item => item.metadata?.poster)?.metadata?.poster
        if (channelPoster) return homeArtworkUrl('channel', channelPoster)
      }
      return ''
    }

    function setHomeSpotlightArtwork(state) {
      const artwork = $('#homeSpotlightArt') || $('.home-spotlight-art')
      if (!artwork) return
      const source = homeArtworkForState(state)
      artwork.style.backgroundImage = source ? `url("${source}")` : ''
      artwork.classList.toggle('has-artwork', Boolean(source))
      artwork.classList.toggle('is-empty', !source)
    }

    function homeTimeLeftLabel(seconds) {
      const value = Math.max(0, Math.round(Number(seconds) || 0))
      if (value < 60) return '<1m left'
      const minutes = Math.ceil(value / 60)
      if (minutes < 60) return `${minutes}m left`
      const hours = Math.floor(minutes / 60)
      const remainingMinutes = minutes % 60
      return remainingMinutes ? `${hours}h ${remainingMinutes}m left` : `${hours}h left`
    }

    function setHomeSpotlightProgress(state) {
      const progress = $('#homeSpotlightProgress')
      if (!progress) return
      const media = homeMediaForState(state)
      const key = [state?.adult_mode === true ? 'adult' : state?.channel_number,
        homeMediaKey(state?.programme)].join(':')
      const livePosition = Number(state?.playback_position)
      const liveDuration = Number(state?.playback_duration)
      const hasLiveTiming = Number.isFinite(liveDuration) && liveDuration > 0
      const fallbackPosition = Math.max(0, Number(media?.remote_position || 0))
      const fallbackDuration = Math.max(0, Number(media?.remote_duration || 0))
      const now = Date.now()
      if (state?.standby === true) homeProgressAnchor = null
      else if (hasLiveTiming || !homeProgressAnchor || homeProgressAnchor.key !== key) {
        homeProgressAnchor = {
          key,
          position: Math.max(0, hasLiveTiming && Number.isFinite(livePosition)
            ? livePosition : fallbackPosition),
          duration: hasLiveTiming ? liveDuration : fallbackDuration,
          updated: now,
        }
      }
      const anchor = homeProgressAnchor?.key === key ? homeProgressAnchor : null
      const elapsed = anchor && state?.paused !== true ? Math.max(0, (now - anchor.updated) / 1000) : 0
      const position = Math.min(Number(anchor?.duration || 0), Number(anchor?.position || 0) + elapsed)
      const duration = Math.max(0, Number(anchor?.duration || fallbackDuration))
      const visible = state?.standby !== true && duration > 0
      progress.classList.toggle('hidden', !visible)
      if (!visible) {
        progress.style.removeProperty('--home-progress')
        $('#homeSpotlightLeft').textContent = ''
        return
      }
      const percent = Math.max(0, Math.min(100, position / duration * 100))
      progress.style.setProperty('--home-progress', `${percent}%`)
      $('#homeSpotlightLeft').textContent = homeTimeLeftLabel(duration - position)
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
      if (button.dataset.viewButton === 'watch' && !offlineMode) {
        remoteKind = 'channel'
        renderRemoteViewing()
      }
      if (button.dataset.viewButton === 'channels') showChannelHub()
      openView(button.dataset.viewButton)
      if (button.dataset.viewButton === 'adult') refreshTmdbStatus().catch(() => {})
    })
    $$('[data-go]').forEach(button => button.onclick = () => {
      if (button.dataset.go === 'insights') {
        history.replaceState({ settings: true }, '', '#system')
        history.pushState({ viewingInsights: true }, '', '#insights')
        openView('insights', { instantScroll: true })
        return
      }
      if (button.id === 'insightsBack' && location.hash === '#insights') {
        history.back()
        return
      }
      if (button.dataset.go === 'watch' && !offlineMode) {
        remoteKind = 'channel'
        renderRemoteViewing()
      }
      if (button.dataset.go === 'channels') showChannelHub()
      openView(button.dataset.go)
      if (button.classList.contains('home-device-summary')) {
        const status = $('#systemStatusDisclosure') || $('#systemDetails')?.closest('details')
        if (status) {
          status.open = true
          requestAnimationFrame(() => status.scrollIntoView({ behavior: 'smooth', block: 'start' }))
        }
      }
    })
