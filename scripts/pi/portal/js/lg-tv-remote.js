'use strict'

;(() => {
  const STATUS_INTERVAL_MS = 8000
  const POINTER_INTERVAL_MS = 36
  let statusTimer = null
  let refreshPromise = null
  let state = { configured: false, connected: false, power: 'off', muted: false }
  let mabelState = { standby: true }
  const pointerContacts = new Map()
  let pointerQueue = { action: '', dx: 0, dy: 0 }
  let pointerTimer = null
  let pointerSending = false

  const send = (action, extra = {}) => api('/api/lg-tv/action', {
    method: 'POST',
    body: JSON.stringify({ action, ...extra }),
  })

  function commandMessage(action, label = '') {
    const messages = {
      'power-on': 'Turning on connected TV…',
      'power-off': 'Turning off connected TV…',
      input: 'Opening TV inputs…',
      apps: 'Opening TV apps…',
      home: 'Opening TV home…',
      back: 'Going back on connected TV…',
      play: 'Sending play…',
      pause: 'Sending pause…',
      mute: state.muted ? 'Restoring TV sound…' : 'Muting connected TV…',
    }
    return messages[action] || (label ? `Opening ${label} on TV…` : 'Sending command to connected TV…')
  }

  function setInteractiveState(on) {
    $$('[data-lg-requires-tv]').forEach(control => {
      if (control.id === 'lgTrackpad') {
        control.setAttribute('aria-disabled', String(!on))
        control.tabIndex = on ? 0 : -1
      } else {
        control.disabled = !on
      }
    })
  }

  function renderStatus(value, liveValue = mabelState) {
    state = { ...state, ...value }
    mabelState = { ...mabelState, ...liveValue }
    const on = value.connected === true && value.power === 'on'
    const mabelOn = mabelState.standby === true
      ? false : mabelState.standby === false || mabelState.available === true
    const heading = $('#lgTvHeading')
    const detail = $('#lgTvDetail')
    const mabelText = $('#lgMabelTvText')
    const mabelLed = $('#lgMabelTvLed')
    const connectionText = $('#lgTvConnectionText')
    const connectionLed = $('#lgTvConnectionLed')
    const headerButton = $('#openLgTvRemote')
    const mute = $('#lgMute')

    if (!value.configured) {
      heading.textContent = 'LG TV not configured'
      detail.textContent = 'Connected-TV control needs setting up on MabelTV'
    } else if (!on) {
      heading.textContent = 'TV is off or unavailable'
      detail.textContent = 'Tap Power to wake the connected television'
    } else {
      const volume = value.volume == null ? '' : `Volume ${value.volume}`
      heading.textContent = value.input || value.app || 'LG TV ready'
      detail.textContent = [value.input ? 'Input active' : 'LG TV ready', value.muted ? 'Muted' : volume]
        .filter(Boolean).join(' · ')
    }

    MabelPortalUI.setPowerStatus(mabelLed, mabelText, mabelOn ? 'on' : 'standby')
    MabelPortalUI.setPowerStatus(connectionLed, connectionText, on ? 'on' : 'standby')
    headerButton?.classList.toggle('is-online', on)
    setInteractiveState(on)

    const powerLabel = on ? 'Turn connected TV off' : 'Turn connected TV on'
    $('#lgCardPower')?.setAttribute('aria-label', powerLabel)
    $('#lgPower')?.setAttribute('aria-label', powerLabel)
    mute?.setAttribute('aria-pressed', String(Boolean(value.muted)))

    const availableApps = new Set(value.available_apps || [])
    $$('[data-lg-launch]').forEach(button => {
      const systemShortcut = ['live-tv', 'mabeltv'].includes(button.dataset.lgLaunch)
      const unavailable = on && value.catalog_known === true && !systemShortcut &&
        !availableApps.has(button.dataset.lgLaunch)
      button.classList.toggle('is-unavailable', unavailable)
      button.disabled = !on || unavailable
      if (unavailable) button.title = `${button.textContent.trim()} is not installed on this TV`
      else button.removeAttribute('title')
    })
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise
    refreshPromise = Promise.all([
      api('/api/lg-tv/status').catch(() => ({
        configured: state.configured,
        connected: false,
        power: 'off',
        available_apps: [],
      })),
      api('/api/live').catch(() => mabelState),
    ]).then(([value, liveValue]) => renderStatus(value, liveValue))
      .finally(() => { refreshPromise = null })
    return refreshPromise
  }

  async function runAction(name, button) {
    if (button?.classList.contains('is-sending')) return
    if (name === 'refresh') {
      button?.classList.add('is-sending')
      try { await refresh() } finally { button?.classList.remove('is-sending') }
      return
    }
    if (name === 'power') name = state.connected ? 'power-off' : 'power-on'
    button?.classList.add('is-sending')
    notice(commandMessage(name))
    try {
      const result = await send(name, name === 'mute' ? { mute: !state.muted } : {})
      notice(result.message || 'Command sent to connected TV')
      if (name === 'mute') renderStatus({ ...state, muted: !state.muted })
      window.setTimeout(() => refresh(), name === 'power-on' ? 2500 : 450)
      if (name === 'power-on') window.setTimeout(() => refresh(), 6500)
    } catch (error) {
      notice(error.message || 'Connected TV unavailable', true)
    } finally {
      button?.classList.remove('is-sending')
    }
  }

  async function launchApp(button) {
    if (button.classList.contains('is-sending') || button.disabled) return
    const label = button.textContent.trim()
    button.classList.add('is-sending')
    notice(commandMessage('launch', label))
    try {
      const result = await send('launch', { app: button.dataset.lgLaunch })
      notice(result.message || `Opening ${label} on TV…`)
      window.setTimeout(() => refresh(), 650)
    } catch (error) {
      notice(error.message || `${label} could not open on the TV`, true)
    } finally {
      button.classList.remove('is-sending')
    }
  }

  function queuePointer(action, dx = 0, dy = 0) {
    if (!state.connected) return
    if (pointerQueue.action && pointerQueue.action !== action) {
      pointerQueue = { action, dx, dy }
    } else {
      pointerQueue.action = action
      pointerQueue.dx += dx
      pointerQueue.dy += dy
    }
    if (!pointerTimer && !pointerSending) {
      pointerTimer = window.setTimeout(flushPointer, POINTER_INTERVAL_MS)
    }
  }

  async function flushPointer() {
    pointerTimer = null
    if (pointerSending || !pointerQueue.action) return
    const command = pointerQueue
    pointerQueue = { action: '', dx: 0, dy: 0 }
    pointerSending = true
    try {
      await send(command.action, { dx: Math.round(command.dx), dy: Math.round(command.dy) })
    } catch (error) {
      notice(error.message || 'TV pointer unavailable', true)
    } finally {
      pointerSending = false
      if (pointerQueue.action && !pointerTimer) {
        pointerTimer = window.setTimeout(flushPointer, POINTER_INTERVAL_MS)
      }
    }
  }

  function pointerDown(event) {
    if (!state.connected || $('#lgTrackpad')?.getAttribute('aria-disabled') === 'true') return
    pointerContacts.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      moved: false,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('is-active')
  }

  function pointerMove(event) {
    const previous = pointerContacts.get(event.pointerId)
    if (!previous) return
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    if (Math.abs(dx) + Math.abs(dy) < 2) return
    const scrolling = pointerContacts.size > 1
    pointerContacts.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: true })
    if (scrolling) {
      pointerContacts.forEach(contact => { contact.moved = true })
      queuePointer('pointer-scroll', 0, dy * 1.2)
    } else {
      queuePointer('pointer-move', dx * 1.55, dy * 1.55)
    }
  }

  function pointerEnd(event) {
    const contact = pointerContacts.get(event.pointerId)
    const wasOnlyPointer = pointerContacts.size === 1
    pointerContacts.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (wasOnlyPointer && contact && !contact.moved && state.connected) {
      send('pointer-click').catch(error => notice(error.message || 'TV pointer unavailable', true))
    }
    if (!pointerContacts.size) event.currentTarget.classList.remove('is-active')
  }

  document.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-lg-action]')
    if (actionButton) void runAction(actionButton.dataset.lgAction, actionButton)
  })

  document.addEventListener('click', event => {
    const appButton = event.target.closest('[data-lg-launch]')
    if (appButton) void launchApp(appButton)
  })

  const trackpad = $('#lgTrackpad')
  if (trackpad) {
    trackpad.addEventListener('pointerdown', pointerDown)
    trackpad.addEventListener('pointermove', pointerMove)
    trackpad.addEventListener('pointerup', pointerEnd)
    trackpad.addEventListener('pointercancel', pointerEnd)
    trackpad.addEventListener('wheel', event => {
      if (!state.connected) return
      event.preventDefault()
      queuePointer('pointer-scroll', event.deltaX, event.deltaY)
    }, { passive: false })
    trackpad.addEventListener('keydown', event => {
      if (!state.connected || !['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      send('pointer-click').catch(error => notice(error.message || 'TV pointer unavailable', true))
    })
  }

  window.startLgTvRemote = () => {
    $('#openLgTvRemote')?.classList.add('is-open')
    refresh()
    if (!statusTimer) statusTimer = window.setInterval(refresh, STATUS_INTERVAL_MS)
  }

  window.stopLgTvRemote = () => {
    $('#openLgTvRemote')?.classList.remove('is-open')
    if (statusTimer) window.clearInterval(statusTimer)
    statusTimer = null
    pointerContacts.clear()
    trackpad?.classList.remove('is-active')
  }
})()
