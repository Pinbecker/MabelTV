'use strict'

const lgTvRemote = (() => {
  const STATUS_INTERVAL_MS = 8000
  let statusTimer = null
  let refreshPromise = null
  let state = { configured: false, connected: false, power: 'off', muted: false }

  const send = (action, extra = {}) => api('/api/lg-tv/action', {
    method: 'POST',
    body: JSON.stringify({ action, ...extra }),
  })

  function setInteractiveState(on) {
    $$('[data-lg-requires-tv]').forEach(control => {
      control.disabled = !on
    })
  }

  function renderSharedPowerState(liveValue = liveTvState) {
    const mabelTv = mabelTvDisplayState(liveValue)
    const connectedTv = connectedTvDisplayState(liveValue)
    MabelPortalUI.setPowerStatus($('#lgMabelTvLed'), $('#lgMabelTvText'), mabelTv)
    MabelPortalUI.setPowerStatus($('#lgTvConnectionLed'), $('#lgTvConnectionText'), connectedTv)
  }

  function renderStatus(value) {
    state = { ...state, ...value }
    const on = value.connected === true && value.power === 'on'
    const heading = $('#lgTvHeading')
    const detail = $('#lgTvDetail')
    const mute = $('#lgMute')

    if (!value.configured) {
      heading.textContent = 'LG TV not configured'
      detail.textContent = `Connected-TV control needs setting up on ${tvName()}`
    } else if (!on) {
      heading.textContent = 'TV is off or unavailable'
      detail.textContent = 'Tap Power to wake the connected television'
    } else {
      const volume = value.volume == null ? '' : `Volume ${value.volume}`
      heading.textContent = value.input || value.app || 'LG TV ready'
      detail.textContent = [value.input ? 'Input active' : 'LG TV ready', value.muted ? 'Muted' : volume]
        .filter(Boolean).join(' · ')
    }

    renderSharedPowerState()
    setInteractiveState(on)

    const powerLabel = on ? 'Turn connected TV off' : 'Turn connected TV on'
    $('#lgCardPower')?.setAttribute('aria-label', powerLabel)
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
    refreshPromise = api('/api/lg-tv/status').catch(() => ({
        configured: state.configured,
        connected: false,
        power: 'off',
        available_apps: [],
      })).then(value => renderStatus(value))
      .finally(() => { refreshPromise = null })
    return refreshPromise
  }

  async function runAction(name, button) {
    if (button?.classList.contains('is-sending')) return
    if (name === 'power') name = state.connected ? 'power-off' : 'power-on'
    button?.classList.add('is-sending')
    try {
      await send(name, name === 'mute' ? { mute: !state.muted } : {})
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
    try {
      await send('launch', { app: button.dataset.lgLaunch })
      window.setTimeout(() => refresh(), 650)
    } catch (error) {
      notice(error.message || `${label} could not open on the TV`, true)
    } finally {
      button.classList.remove('is-sending')
    }
  }

  document.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-lg-action]')
    if (actionButton) void runAction(actionButton.dataset.lgAction, actionButton)
  })

  document.addEventListener('click', event => {
    const appButton = event.target.closest('[data-lg-launch]')
    if (appButton) void launchApp(appButton)
  })

  function start() {
    renderSharedPowerState()
    refresh()
    if (!statusTimer) statusTimer = window.setInterval(refresh, STATUS_INTERVAL_MS)
  }

  function stop() {
    if (statusTimer) window.clearInterval(statusTimer)
    statusTimer = null
  }

  return Object.freeze({ renderPowerState: renderSharedPowerState, start, stop })
})()
