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
      const allowed = new Set(['overview', 'live', 'lg-tv', 'channels', 'adult', 'watch', 'adult-viewing', 'usb', 'system', 'insights'])
      if (allowed.has(view)) {
        if (currentPortalDesign === 'experience' && (view === 'channels' || view === 'adult')) {
          remoteKind = view === 'channels' ? 'channel' : 'adult'
          renderRemoteViewing()
          history.replaceState({ consolidatedWatch: true }, '', '#watch')
          openView('watch')
          return
        }
        if (view === 'watch' && !offlineMode) {
          remoteKind = 'channel'
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

    window.addEventListener('popstate', event => openRequestedView(event))

    async function initialise() {
      try {
        await window.MabelOffline?.initialise()
        offlineStorageReady = Boolean(window.MabelOffline)
        setOfflineProtectedAccess(false)
      } catch (error) {
        offlineStorageError = error?.message || 'Offline storage could not start'
        console.warn('Offline storage could not start', error)
      }
      try {
        const state = await api('/api/setup')
        configuredTvName = typeof state.tv_name === 'string' && state.tv_name.trim()
          ? state.tv_name.trim() : configuredTvName
        applyTvName()
        await syncOfflineSecurity(state.portal_pin_required !== false)
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
      } catch (error) {
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

    const currentPortalDesign = document.body.classList.contains('portal-classic') ? 'classic' : 'experience'
    $$('[data-portal-design]').forEach(button => {
      const selected = button.dataset.portalDesign === currentPortalDesign
      button.setAttribute('aria-pressed', selected ? 'true' : 'false')
      button.onclick = () => {
        const design = button.dataset.portalDesign === 'classic' ? 'classic' : 'experience'
        if (design === currentPortalDesign) return
        document.cookie = `mabeltv_portal_design=${design}; Path=/; Max-Age=31536000; SameSite=Strict`
        $$('[data-portal-design]').forEach(choice => { choice.disabled = true })
        location.reload()
      }
    })

    function resetViewScroll() {
      const scroller = document.scrollingElement || document.documentElement
      scroller.scrollTop = 0
      document.body.scrollTop = 0
      window.scrollTo(0, 0)
    }

    function portalScrollTop() {
      const scroller = document.scrollingElement || document.documentElement
      return Math.max(0, Number(scroller.scrollTop || window.scrollY || 0))
    }

    function setPortalScrollTop(value) {
      const top = Math.max(0, Number(value) || 0)
      const scroller = document.scrollingElement || document.documentElement
      scroller.scrollTop = top
      document.body.scrollTop = top
      window.scrollTo(0, top)
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
      const alignAnchor = () => {
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
      if (offlineMode && name !== 'watch') name = 'watch'
      // A status belongs to the action that created it, not every page the
      // parent subsequently visits. Clear it whenever navigation begins.
      notice('')
      const channelFromWatch = name === 'channels' && selectedManageChannel !== null && channelWorkspaceReturnToWatch
      const consolidatedWatchView = currentPortalDesign === 'experience' && (name === 'channels' || name === 'adult')
      const activeNavigation = channelFromWatch || consolidatedWatchView || name === 'adult-viewing' ? 'watch'
        : name === 'lg-tv' ? 'live'
          : (name === 'insights' || name === 'activity') ? 'system' : name
      $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`))
      document.body.classList.toggle('watch-mode', name === 'watch' || name === 'adult-viewing' || channelFromWatch || consolidatedWatchView)
      document.body.classList.toggle('lg-tv-mode', name === 'lg-tv')
      $$('[data-view-button]').forEach(button => {
        const active = button.dataset.viewButton === activeNavigation
        button.classList.toggle('active', active)
        if (active) button.setAttribute('aria-current', 'page')
        else button.removeAttribute('aria-current')
      })
      const restoredScroll = options.restoreScroll
        ? restoreViewScroll(options.restoreScroll) : false
      if (!restoredScroll) {
        if (options.instantScroll) resetViewScroll()
        else window.scrollTo({ top: 0, behavior: 'smooth' })
      }
      if (name === 'live') startLiveTv()
      else stopLiveTv()
      if (name === 'lg-tv') window.startLgTvRemote?.()
      else window.stopLgTvRemote?.()
      if (name === 'overview') startHomeStatusRefresh()
      else stopHomeStatusRefresh()
      if (name === 'usb') refreshUsb().catch(error => notice(error.message, true))
      if (name === 'watch' && remoteKind === 'downloads') renderDownloads().catch(showError)
      if (name === 'insights') loadViewingInsights().catch(() => {})
      if (name === 'activity') loadActivity().catch(error => notice(error.message, true))
      if (name === 'adult-viewing') loadAdultViewing().catch(showError)
    }

