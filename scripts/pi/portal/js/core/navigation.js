'use strict'

    function escapeHtml(value) {
      const span = document.createElement('span')
      span.textContent = String(value)
      return span.innerHTML
    }

    function openRequestedView(event = null) {
      const requested = location.hash.replace(/^#/, '')
      if ((requested === 'insights' || requested.startsWith('insights/'))
          && window.openInsightsRoute) {
        window.openInsightsRoute(requested, event)
        return
      }
      const channelRoute = requested.match(/^channel\/(\d+)\/(watch|library)$/)
      if (channelRoute) {
        openChannel(Number(channelRoute[1]), channelRoute[2] === 'watch', {
          updateHistory: false,
          returnPosition: history.state?.mabelWatchReturn || null,
        })
        return
      }
      const view = requested === 'home' ? 'overview' : requested
      const allowed = new Set(['overview', 'live', 'lg-tv', 'channels', 'adult', 'watch', 'adult-viewing', 'adult-explore', 'adult-ratings', 'adult-filmography', 'usb', 'system', 'appearance', 'insights'])
      if (allowed.has(view)) {
        if (view === 'channels' || view === 'adult') {
          remoteKind = view === 'channels' ? 'channel' : 'adult'
          renderRemoteViewing()
          history.replaceState({ consolidatedWatch: true }, '', '#watch')
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

    function replacePrimaryViewHistory(name) {
      const view = offlineMode && name !== 'watch' ? 'watch' : name
      const route = view === 'overview' ? 'home' : view
      history.replaceState({ primaryView: view }, '', `#${route}`)
      return view
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
          await load()
          setOfflineProtectedAccess(true)
          showOnly('app')
          openRequestedView()
        } else {
          // A valid HttpOnly session cookie survives an iPad page reload.  Ask
          // the protected library before showing the PIN screen so closing a
          // native player never looks like a logout.
          try {
            await load()
            setOfflineProtectedAccess(true)
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
        void syncOfflineState()
      } catch (error) {
        await offlineStartup
        if (offlineStorageReady) {
          offlineMode = true
          setOfflineProtectedAccess(false)
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
        await load()
        showOnly('app')
        openRequestedView()
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
      if (offlineMode && name !== 'watch') name = 'watch'
      const leavingExplore = $('#view-adult-explore')?.classList.contains('active')
        && name !== 'adult-explore'
      if (leavingExplore && typeof endAdultExploreVisit === 'function') endAdultExploreVisit()
      const resetExplore = name === 'adult-explore'
        && typeof beginAdultExploreVisit === 'function' && beginAdultExploreVisit()
      rememberPortalView()
      const channelFromWatch = name === 'channels' && selectedManageChannel !== null && channelWorkspaceReturnToWatch
      const consolidatedWatchView = name === 'channels' || name === 'adult'
      const activeNavigation = channelFromWatch || consolidatedWatchView
        || name === 'adult-viewing' || name === 'adult-explore'
        || name === 'adult-ratings' || name === 'adult-filmography' ? 'watch'
        : name === 'lg-tv' ? 'live'
          : (name === 'usb' || name === 'activity' || name === 'appearance') ? 'system' : name
      $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`))
      document.body.classList.toggle('watch-mode', name === 'watch' || name === 'adult-viewing'
        || name === 'adult-explore' || name === 'adult-ratings' || name === 'adult-filmography'
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
      const restoredScroll = options.restoreScroll
        ? restoreViewScroll(options.restoreScroll) : false
      if (!restoredScroll) {
        const saved = portalViewPositions.get(`view-${name}`)
        if (saved && !options.resetScroll && !resetExplore) restorePortalPosition(saved)
        else resetViewScroll()
      }
      if (name === 'live') startLiveTv()
      else stopLiveTv()
      if (name === 'lg-tv') window.startLgTvRemote?.()
      else window.stopLgTvRemote?.()
      if (name === 'overview') startHomeStatusRefresh()
      else stopHomeStatusRefresh()
      if (name === 'usb') refreshUsb().catch(error => notice(error.message, true))
      if (name === 'watch' && remoteKind === 'downloads') renderDownloads().catch(showError)
      if (name === 'insights') (window.loadMyInsights || loadViewingInsights)().catch?.(() => {})
      if (name === 'activity') loadActivity().catch(error => notice(error.message, true))
      if (name === 'adult-viewing') loadAdultViewing().catch(showError)
      if (name === 'adult-explore') {
        if (resetExplore || adultExplorePage === 0) loadAdultExplore({ reset: true }).catch(showError)
        else renderAdultExploreGrid()
      }
      if (name === 'adult-ratings') loadAdultRatings().catch(showError)
      if (name === 'adult-filmography') renderAdultFilmography()
      const savedPosition = portalViewPositions.get(`view-${name}`)
      if (!options.restoreScroll && !options.resetScroll && savedPosition) settlePortalPosition(savedPosition)
    }
