'use strict'

    const primarySectionRoots = {
      overview: { view: 'overview', route: '#home', state: { primaryView: 'overview' } },
      watch: { view: 'watch', route: '#watch', state: { primaryView: 'watch', watchDomain: 'mabel' } },
      live: { view: 'live', route: '#live', state: { primaryView: 'live' } },
      'my-tv-home': { view: 'my-tv-home', route: '#my-tv', state: { primaryView: 'my-tv-home', myTvHome: true } },
      system: { view: 'system', route: '#system', state: { primaryView: 'system', settings: true } },
    }
    const primarySectionLocations = new Map()
    let portalReconnectPromise = null
    let portalAppCacheStartup = Promise.resolve(false)

    function offlineSectionName(name, activeNavigation) {
      if (activeNavigation === 'my-tv-home') return 'My TV'
      if (activeNavigation === 'watch') return tvName()
      if (activeNavigation === 'live') return 'Remote'
      if (activeNavigation === 'system') return 'Settings'
      if (name === 'overview') return 'Home'
      return 'This section'
    }

    function showOfflineUnavailable(name, activeNavigation) {
      const downloads = name === 'watch' && remoteKind === 'downloads'
      const root = $('#offlineUnavailable')
      root.classList.toggle('hidden', !offlineMode || downloads)
      document.body.classList.toggle('offline-section-unavailable',
        offlineMode && !downloads)
      if (!offlineMode || downloads) return false
      const section = offlineSectionName(name, activeNavigation)
      const disconnected = portalConnectionState === 'offline'
      $('#offlineUnavailableEyebrow').textContent = disconnected
        ? 'This iPhone is offline' : `${tvName()} cannot be reached`
      $('#offlineUnavailableTitle').textContent = `${section} needs a connection`
      $('#offlineUnavailableMessage').textContent = disconnected
        ? `Reconnect this iPhone to the network that can reach ${tvName()}, then try again.`
        : `${tvName()} may be starting up or this iPhone may be on another network. Your saved Downloads still work here.`
      const my_tv = activeNavigation === 'my-tv-home'
      $('#offlineOpenDownloads').dataset.domain = my_tv ? 'my_tv' : 'mabel'
      $('#offlineOpenDownloads span').textContent = my_tv
        ? 'Open My TV Downloads' : 'Open Downloads'
      return true
    }

    async function attemptPortalReconnect() {
      if (portalReconnectPromise) return portalReconnectPromise
      portalReconnectPromise = (async () => {
        try {
          const setup = await api('/api/setup')
          configuredTvName = typeof setup.tv_name === 'string' && setup.tv_name.trim()
            ? setup.tv_name.trim() : configuredTvName
          applyTvName()
          if (!setup.configured) {
            location.reload()
            return
          }
          await window.MabelAppCache?.initialise()
          const bootstrap = await api('/api/bootstrap')
          const startup = await loadInitialPortalData(bootstrap)
          portalConnectionState = 'connected'
          offlineMode = false
          document.body.classList.remove('offline-mode', 'offline-section-unavailable')
          showOnly('app')
          openRequestedView()
          startup.refresh?.catch(error => console.warn('Background portal refresh failed', error))
        } catch (error) {
          if (error.status === 401) {
            offlineMode = false
            document.body.classList.remove('offline-mode', 'offline-section-unavailable')
            return
          }
          portalConnectionState = navigator.onLine ? 'unreachable' : 'offline'
          offlineMode = true
          document.body.classList.add('offline-mode')
          const active = document.querySelector('.view.active')?.id.replace(/^view-/, '') || 'overview'
          openView(active)
        } finally {
          portalReconnectPromise = null
        }
      })()
      return portalReconnectPromise
    }
    function rememberPrimarySectionLocation(name, section) {
      if (!primarySectionRoots[section]) return
      primarySectionLocations.set(section, {
        view: name,
        route: location.hash || primarySectionRoots[section].route,
        state: history.state && typeof history.state === 'object' ? { ...history.state } : {},
        watchDomain,
        downloadDomain,
        remoteKind,
        myInsightsMode,
      })
    }

    function openPrimarySection(section, { reset = false } = {}) {
      const root = primarySectionRoots[section]
      if (!root) return false
      const saved = !reset && primarySectionLocations.get(section)
      const destination = saved || { ...root, watchDomain: root.state.watchDomain }
      if (destination.watchDomain) watchDomain = destination.watchDomain
      if (destination.downloadDomain) downloadDomain = destination.downloadDomain
      if (destination.remoteKind) remoteKind = destination.remoteKind
      if (destination.myInsightsMode) myInsightsMode = destination.myInsightsMode
      if (reset && section === 'watch') {
        watchDomain = 'mabel'
        remoteKind = 'channel'
      }
      history.replaceState(destination.state, '', destination.route)
      if (destination.view === 'insights') {
        openInsightsRoute(destination.route.replace(/^#/, ''), null, { reset })
      } else {
        if (destination.view === 'watch' && !offlineMode) renderRemoteViewing()
        openView(destination.view, { resetScroll: reset })
      }
      return true
    }
    function escapeHtml(value) {
      const span = document.createElement('span')
      span.textContent = String(value)
      return span.innerHTML
    }

    function openRequestedView(event = null) {
      const requested = location.hash.replace(/^#/, '')
      if (requested === 'insights' || requested.startsWith('insights/')) {
        openInsightsRoute(requested, event)
        return
      }
      const channelRoute = requested.match(/^channel\/(\d+)\/(watch|library)$/)
      if (channelRoute) {
        if (offlineMode) {
          openView('watch')
          return
        }
        openChannel(Number(channelRoute[1]), channelRoute[2] === 'watch', {
          updateHistory: false,
          returnPosition: history.state?.mabelWatchReturn || null,
        })
        return
      }
      if (requested === 'mabel-downloads' || requested === 'my-tv-downloads') {
        watchDomain = requested === 'my-tv-downloads' ? 'my_tv' : 'mabel'
        downloadDomain = watchDomain
        remoteKind = 'downloads'
        renderRemoteViewing()
        openView('watch')
        return
      }
      if (requested === 'watch') {
        watchDomain = 'mabel'
        remoteKind = 'channel'
      }
      const view = requested === 'home' ? 'overview'
        : requested === 'my-tv' ? 'my-tv-home' : requested
      const allowed = new Set(['overview', 'live', 'lg-tv', 'channels', 'watch', 'my-tv-home', 'my-tv-viewing', 'my-tv-explore', 'my-tv-ratings', 'my-tv-filmography', 'usb', 'system', 'appearance', 'insights'])
      if (allowed.has(view)) {
        if (view === 'channels') {
          watchDomain = 'mabel'
          remoteKind = 'channel'
          renderRemoteViewing()
          history.replaceState({ primaryView: 'watch' }, '', '#watch')
          openView('watch')
          return
        }
        if (view === 'watch' && !offlineMode) {
          renderRemoteViewing()
        }
        if (view === 'channels') showChannelHub()
        if (view === 'watch' && selectedManageChannel !== null) {
          channelNavigationRevision += 1
          selectedManageChannel = null
          selectedManageChannelFolder = ''
          channelWorkspaceReturnToWatch = false
          remoteKind = 'channel'
          renderRemoteViewing()
        }
        const historyReturn = event?.type === 'popstate' && view === 'watch'
          ? history.state?.mabelWatchReturn : null
        openView(view, historyReturn ? { restoreScroll: historyReturn } : {})
      }
      else if (new URLSearchParams(location.search).has('watch')) openView('watch')
      else openView('overview')
    }

    function navigateDomainRoute(domain, section, { replace = false, resetScroll = true } = {}) {
      const my_tv = domain === 'my_tv'
      let route = my_tv ? 'my-tv' : 'watch'
      let view = my_tv ? 'my-tv-home' : 'watch'
      if (section === 'insights') {
        route = my_tv ? 'insights' : 'insights/mabeltv'
        const method = replace ? 'replaceState' : 'pushState'
        history[method]({ insights: true, myInsightsMode: my_tv ? 'my_tv' : 'mabel' }, '', `#${route}`)
        openInsightsRoute(route, null, { reset: resetScroll })
        return
      }
      if (section === 'downloads') {
        watchDomain = my_tv ? 'my_tv' : 'mabel'
        downloadDomain = watchDomain
        remoteKind = 'downloads'
        route = my_tv ? 'my-tv-downloads' : 'mabel-downloads'
        view = 'watch'
      } else if (!my_tv) {
        watchDomain = 'mabel'
        remoteKind = 'channel'
      }
      const method = replace ? 'replaceState' : 'pushState'
      history[method]({ primaryView: view, watchDomain }, '', `#${route}`)
      if (view === 'watch') renderRemoteViewing()
      openView(view, { resetScroll })
    }
    window.addEventListener('popstate', event => openRequestedView(event))

    function startOfflineStorage() {
      return Promise.resolve(window.MabelOffline?.initialise())
        .then(() => {
          offlineStorageReady = Boolean(window.MabelOffline)
          return offlineStorageReady
        })
        .catch(error => {
          offlineStorageError = error?.message || 'Offline storage could not start'
          console.warn('Offline storage could not start', error)
          return false
        })
    }

    async function initialise() {
      const offlineStartup = startOfflineStorage()
      portalAppCacheStartup = Promise.resolve(window.MabelAppCache?.initialise())
        .catch(error => {
          console.warn('App snapshots could not start', error)
          return false
        })
      let offlineRequired = true
      const syncOfflineState = () => offlineStartup.then(ready => {
        if (!ready) return false
        return syncOfflineSecurity(offlineRequired).then(() => true)
      })
      try {
        const state = await api('/api/setup')
        configuredTvName = typeof state.tv_name === 'string' && state.tv_name.trim()
          ? state.tv_name.trim() : configuredTvName
        applyTvName()
        offlineRequired = state.portal_pin_required !== false
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
          await portalAppCacheStartup
          const bootstrap = await api('/api/bootstrap')
          const startup = await loadInitialPortalData(bootstrap)
          portalConnectionState = 'connected'
          setOfflineProtectedAccess(true)
          showOnly('app')
          openRequestedView()
          startup.refresh?.catch(error => console.warn('Background portal refresh failed', error))
        } else {
          // A valid HttpOnly session cookie survives an iPad page reload.  Ask
          // the protected library before showing the PIN screen so closing a
          // native player never looks like a logout.
          try {
            await portalAppCacheStartup
            const bootstrap = await api('/api/bootstrap')
            const startup = await loadInitialPortalData(bootstrap)
            portalConnectionState = 'connected'
            setOfflineProtectedAccess(true)
            showOnly('app')
            openRequestedView()
            startup.refresh?.catch(error => console.warn('Background portal refresh failed', error))
          } catch (error) {
            showOnly('login')
            if (error.status !== 401) {
              $('#loginError').classList.add('bad')
              $('#loginError').textContent = `The portal connection was interrupted. ${tvName()} is still running — try again in a moment.`
            }
          }
        }
        void syncOfflineState()
      } catch (error) {
        await offlineStartup
        if (offlineStorageReady) {
          offlineMode = true
          portalConnectionState = navigator.onLine ? 'unreachable' : 'offline'
          setOfflineProtectedAccess(false)
          document.body.classList.add('offline-mode')
          try { configuredTvName = localStorage.getItem('mabeltv-tv-name') || configuredTvName } catch (_) { /* optional */ }
          applyTvName()
          showOnly('app')
          openRequestedView()
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
        await syncOfflineSecurity(true, setupPayload.pin)
        setOfflineProtectedAccess(false)
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
          const pin = $('#pin').value
          await api('/api/login', { method: 'POST', body: JSON.stringify({ pin }) })
          await syncOfflineSecurity(true, pin)
          setOfflineProtectedAccess(true)
          $('#pin').value = ''
          await portalAppCacheStartup
          const bootstrap = await api('/api/bootstrap')
          const startup = await loadInitialPortalData(bootstrap)
          portalConnectionState = 'connected'
          showOnly('app')
          openRequestedView()
          startup.refresh?.catch(error => console.warn('Background portal refresh failed', error))
      } catch (error) {
        $('#loginError').classList.add('bad')
        $('#loginError').textContent = error.message
      } finally { button.disabled = false }
    }
    $('#logout').onclick = async () => {
      setOfflineProtectedAccess(false)
      await api('/api/logout', { method: 'POST' })
      location.reload()
    }

    function channelReturnSnapshot(channel) {
      const folder = String(channel?.folder || '')
      const anchor = [...document.querySelectorAll('[data-watch-channel-folder]')]
        .find(element => element.dataset.watchChannelFolder === folder)
      return {
        scrollY: portalScrollTop(),
        folder,
        anchorTop: anchor ? anchor.getBoundingClientRect().top : null,
      }
    }

    function restoreViewScroll(snapshot) {
      if (!snapshot || !Number.isFinite(Number(snapshot.scrollY))) return false
      setPortalScrollTop(snapshot.scrollY)
      const view = document.querySelector('.view.active')
      const alignAnchor = () => {
        if (view !== document.querySelector('.view.active')) return
        if (!snapshot.folder || !Number.isFinite(Number(snapshot.anchorTop))) return
        const anchor = [...document.querySelectorAll('[data-watch-channel-folder]')]
          .find(element => element.dataset.watchChannelFolder === snapshot.folder)
        if (!anchor) return
        const delta = anchor.getBoundingClientRect().top - Number(snapshot.anchorTop)
        if (Math.abs(delta) >= 1) setPortalScrollTop(portalScrollTop() + delta)
      }
      requestAnimationFrame(() => requestAnimationFrame(alignAnchor))
      return true
    }

    function openView(name, options = {}) {
      cancelPortalScrollSettlement()
      // A status belongs to the action that created it, not every page the
      // parent subsequently visits. Clear it whenever navigation begins.
      notice('')
      const leavingExplore = $('#view-my-tv-explore')?.classList.contains('active')
        && name !== 'my-tv-explore'
      if (leavingExplore && typeof endMyTvExploreVisit === 'function') endMyTvExploreVisit()
      const resetExplore = name === 'my-tv-explore'
        && typeof beginMyTvExploreVisit === 'function' && beginMyTvExploreVisit()
      rememberPortalView()
      const channelFromWatch = name === 'channels' && selectedManageChannel !== null && channelWorkspaceReturnToWatch
      const consolidatedWatchView = name === 'channels'
      const myTvNavigation = name === 'my-tv-home' || name === 'my-tv-viewing'
        || name === 'my-tv-explore' || name === 'my-tv-ratings'
        || name === 'my-tv-filmography'
        || (name === 'insights' && myInsightsMode === 'my_tv')
        || (name === 'watch' && watchDomain === 'my_tv')
      const activeNavigation = myTvNavigation ? 'my-tv-home'
        : channelFromWatch || consolidatedWatchView
        || (name === 'insights' && myInsightsMode === 'mabel') ? 'watch'
        : name === 'lg-tv' ? 'live'
          : (name === 'usb' || name === 'activity' || name === 'appearance') ? 'system' : name
      rememberPrimarySectionLocation(name, activeNavigation)
      $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`))
      document.body.classList.toggle('watch-mode', name === 'watch' || name === 'my-tv-home' || name === 'my-tv-viewing'
        || name === 'my-tv-explore' || name === 'my-tv-ratings' || name === 'my-tv-filmography'
        || channelFromWatch || consolidatedWatchView)
      document.body.classList.toggle('tv-remote-mode', name === 'live' || name === 'lg-tv')
      document.body.classList.toggle('lg-tv-mode', name === 'lg-tv')
      $$('[data-remote-switch]').forEach(button => {
        const active = button.dataset.remoteSwitch === name
        button.classList.toggle('active', active)
        if (active) button.setAttribute('aria-current', 'page')
        else button.removeAttribute('aria-current')
      })
      $$('[data-view-button]').forEach(button => {
        const active = button.dataset.viewButton === activeNavigation
        button.classList.toggle('active', active)
        if (active) button.setAttribute('aria-current', 'page')
        else button.removeAttribute('aria-current')
      })
      const unavailableOffline = showOfflineUnavailable(name, activeNavigation)
      if (unavailableOffline) {
        stopLiveTv()
        lgTvRemote.stop()
        stopHomeStatusRefresh()
        resetViewScroll()
        return
      }
      renderLibraryView(name)
      const restoredScroll = options.restoreScroll
        ? restoreViewScroll(options.restoreScroll) : false
      if (!restoredScroll) {
        const saved = portalViewPositions.get(`view-${name}`)
        if (saved && !options.resetScroll && !resetExplore) restorePortalPosition(saved)
        else {
          resetViewScroll()
          if (options.resetScroll) settlePortalReset()
        }
      }
      if (name === 'live') startLiveTv()
      else stopLiveTv()
      if (name === 'lg-tv') lgTvRemote.start()
      else lgTvRemote.stop()
      if (name === 'overview') startHomeStatusRefresh()
      else stopHomeStatusRefresh()
      if (name === 'usb') refreshUsb().catch(error => notice(error.message, true))
      if (name === 'watch' && remoteKind === 'downloads') renderDownloads().catch(showError)
      if (name === 'insights') loadMyInsights().catch(() => {})
      if (name === 'my-tv-home') loadMyTvHome().catch(showError)
      if (name === 'activity') loadActivity().catch(error => notice(error.message, true))
      if (name === 'my-tv-viewing') loadMyTvViewing().catch(showError)
      if (name === 'my-tv-explore') {
        if (resetExplore || myTvExplorePage === 0) loadMyTvExplore({ reset: true }).catch(showError)
        else renderMyTvExploreGrid()
      }
      if (name === 'my-tv-ratings') loadMyTvRatings().catch(showError)
      if (name === 'my-tv-filmography') renderMyTvFilmography()
      const savedPosition = portalViewPositions.get(`view-${name}`)
      if (!options.restoreScroll && !options.resetScroll && savedPosition) settlePortalPosition(savedPosition)
    }

    $('#offlineOpenDownloads').onclick = () => {
      navigateDomainRoute($('#offlineOpenDownloads').dataset.domain || 'mabel', 'downloads', {
        replace: true,
      })
    }
    $('#offlineRetry').onclick = () => { void attemptPortalReconnect() }
