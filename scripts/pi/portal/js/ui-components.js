'use strict'

;(() => {
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
  const ICON_SPRITE = '/portal/icons.svg'
  const dialogParents = new WeakMap()
  const dialogScrollLocks = new WeakMap()
  const dialogPositions = new WeakMap()
  const dialogUnderlays = new WeakMap()
  const cardBackTimers = new WeakMap()
  const CARD_HISTORY_STATE = 'mabelCardJourney'
  let returningToDialog = false
  let pendingCardSnapshot = null
  let pendingCardHistory = null
  let cardHistoryJourney = null
  let cardHistorySerial = 0
  let dismissedCardHistory = false

  function cardPanel(dialog) {
    return dialog?.querySelector(':scope > .library-sheet-panel, :scope > .watch-film-panel, :scope > article') || null
  }

  function dialogScrollers(dialog) {
    return [dialog, ...dialog.querySelectorAll(
      '.library-sheet-panel,.watch-film-panel,.portal-sheet-panel,.library-sheet-body,.watch-film-body')]
  }

  function restoreDialogPosition(dialog) {
    for (const saved of dialogPositions.get(dialog) || []) {
      saved.element.scrollTop = saved.top
      saved.element.scrollLeft = saved.left
    }
  }
  const powerStatusDefinitions = Object.freeze({
    on: Object.freeze({ label: 'On', sentence: 'on', className: 'is-on' }),
    standby: Object.freeze({ label: 'Standby', sentence: 'in standby', className: 'is-standby' }),
    'turning-on': Object.freeze({ label: 'Turning on', sentence: 'turning on', className: 'is-changing' }),
    'going-standby': Object.freeze({ label: 'Going to standby', sentence: 'going to standby', className: 'is-changing' }),
    unavailable: Object.freeze({ label: 'Unavailable', sentence: 'unavailable', className: 'is-unknown' }),
    unknown: Object.freeze({ label: 'Checking…', sentence: 'being checked', className: 'is-unknown' }),
  })
  const powerStatusClasses = Object.freeze([
    'is-on', 'is-standby', 'is-changing', 'is-unknown',
  ])

  function syncDialogScrollLock() {
    const lockedDialogOpen = [...document.querySelectorAll('dialog[open]')]
      .some(dialog => dialogScrollLocks.get(dialog) === true)
    document.documentElement.style.overflow = lockedDialogOpen ? 'hidden' : ''
  }

  function icon(name, className = 'icon') {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg')
    const use = document.createElementNS(SVG_NAMESPACE, 'use')
    svg.classList.add(...className.split(' ').filter(Boolean))
    svg.setAttribute('aria-hidden', 'true')
    use.setAttribute('href', `${ICON_SPRITE}#${name}`)
    svg.append(use)
    return svg
  }

  function decorateExperienceCloseButtons() {
    if (!document.body.classList.contains('portal-experience')) return
    document.querySelectorAll('.portal-sheet-close').forEach(control => {
      control.replaceChildren(icon('signal-x'))
    })
  }

  function cardBackControl(dialog) {
    if (!dialog?.hasAttribute('data-card-sheet')) return null
    const panel = cardPanel(dialog)
    let control = panel?.querySelector('.portal-card-back')
    if (control) return control
    control = button({
      className: 'portal-card-back hidden',
      iconName: 'signal-arrow-left',
      ariaLabel: 'Back to previous card',
      onClick: () => animateCardBack(dialog),
    })
    const host = panel?.querySelector(':scope > .dialog-close-bar, :scope > header') || panel
    host?.append(control)
    return control
  }

  function syncCardNavigation(dialog, hasParent = dialogParents.has(dialog)) {
    const control = cardBackControl(dialog)
    if (!control) return
    const hasUnderlay = dialogUnderlays.has(dialog)
    control.classList.toggle('hidden', !hasParent)
    dialog.classList.toggle('has-card-parent', hasParent)
    dialog.classList.toggle('has-card-underlay', hasUnderlay)
  }

  function captureCardSnapshot(dialog) {
    const source = cardPanel(dialog)
    if (!source) return null
    const panel = source.cloneNode(true)
    panel.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'))
    const sourceScrollers = [source, ...source.querySelectorAll(
      '.library-sheet-body,.watch-film-body')]
    const scrollOffsets = sourceScrollers.map(element => ({
      top: element.scrollTop, left: element.scrollLeft,
    }))
    return { panel, scrollOffsets }
  }

  function removeCardUnderlay(dialog) {
    const underlay = dialogUnderlays.get(dialog)
    underlay?.remove()
    dialogUnderlays.delete(dialog)
    dialog.classList.remove('has-card-underlay')
  }

  function attachCardUnderlay(dialog, snapshot) {
    removeCardUnderlay(dialog)
    if (!snapshot?.panel) return
    const underlay = document.createElement('div')
    underlay.className = 'portal-card-swipe-underlay'
    underlay.setAttribute('aria-hidden', 'true')
    underlay.inert = true
    underlay.append(snapshot.panel)
    dialog.append(underlay)
    dialogUnderlays.set(dialog, underlay)
    requestAnimationFrame(() => {
      const scrollers = [snapshot.panel, ...snapshot.panel.querySelectorAll(
        '.library-sheet-body,.watch-film-body')]
      scrollers.forEach((element, index) => {
        element.scrollTop = snapshot.scrollOffsets[index]?.top || 0
        element.scrollLeft = snapshot.scrollOffsets[index]?.left || 0
      })
    })
  }

  function setCardBackPosition(dialog, distance) {
    const panel = cardPanel(dialog)
    const underlay = dialogUnderlays.get(dialog)
    if (!panel || !underlay) return
    const width = Math.max(1, window.innerWidth)
    const offset = Math.max(0, Math.min(distance, width + 40))
    const progress = Math.min(1, offset / width)
    panel.style.setProperty('--portal-card-swipe-x', `${offset}px`)
    underlay.style.setProperty('--portal-card-underlay-x', `${-18 * (1 - progress)}px`)
    underlay.style.setProperty('--portal-card-underlay-scale', String(.985 + (.015 * progress)))
    underlay.style.setProperty('--portal-card-underlay-opacity', String(.76 + (.24 * progress)))
  }

  function resetCardBack(dialog) {
    clearTimeout(cardBackTimers.get(dialog))
    cardBackTimers.delete(dialog)
    const panel = cardPanel(dialog)
    panel?.style.removeProperty('--portal-card-swipe-x')
    const underlay = dialogUnderlays.get(dialog)
    underlay?.style.removeProperty('--portal-card-underlay-x')
    underlay?.style.removeProperty('--portal-card-underlay-scale')
    underlay?.style.removeProperty('--portal-card-underlay-opacity')
    dialog.classList.remove('is-card-back-settling')
  }

  function cardHistoryMarker(state = history.state) {
    const marker = state?.[CARD_HISTORY_STATE]
    const depth = Number(marker?.depth || 0)
    return marker?.id && depth > 0 ? { id: String(marker.id), depth } : null
  }

  function cardHistoryState(id, depth) {
    const state = history.state && typeof history.state === 'object'
      ? { ...history.state } : {}
    delete state[CARD_HISTORY_STATE]
    if (id && depth > 0) state[CARD_HISTORY_STATE] = { id, depth }
    return state
  }

  function pushCardHistory(id, depth) {
    history.pushState(cardHistoryState(id, depth), '', location.href)
  }

  function beginCardHistory(dialog, returnTo) {
    const id = `${Date.now().toString(36)}-${++cardHistorySerial}`
    cardHistoryJourney = { id, depth: 1, entries: [{ dialog, returnTo }] }
    pushCardHistory(id, 1)
  }

  function prepareCardHistory(dialog) {
    if (!dialog?.hasAttribute('data-card-sheet')) return
    const marker = cardHistoryMarker()
    const journey = cardHistoryJourney
    if (!journey || marker?.id !== journey.id || marker.depth !== journey.depth) return
    journey.entries.length = journey.depth
    const depth = journey.depth + 1
    pushCardHistory(journey.id, depth)
    journey.depth = depth
    pendingCardHistory = { id: journey.id, depth }
  }

  function registerCardHistory(dialog, returnTo) {
    if (!dialog?.hasAttribute('data-card-sheet') || returningToDialog) return
    const marker = cardHistoryMarker()
    const journey = cardHistoryJourney
    if (pendingCardHistory && journey
        && pendingCardHistory.id === journey.id
        && pendingCardHistory.depth === journey.depth
        && marker?.id === journey.id && marker.depth === journey.depth) {
      journey.entries[journey.depth - 1] = { dialog, returnTo }
      pendingCardHistory = null
      return
    }
    pendingCardHistory = null
    const current = journey?.entries[journey.depth - 1]
    if (journey && marker?.id === journey.id && marker.depth === journey.depth
        && current?.dialog === dialog) {
      current.returnTo = returnTo
      return
    }
    if (journey && marker?.id === journey.id && marker.depth === journey.depth
        && typeof returnTo === 'function') {
      journey.entries.length = journey.depth
      const depth = journey.depth + 1
      pushCardHistory(journey.id, depth)
      journey.depth = depth
      journey.entries[depth - 1] = { dialog, returnTo }
      return
    }
    beginCardHistory(dialog, returnTo)
  }

  function showCardHistoryEntry(entry) {
    if (!entry?.dialog) return
    returningToDialog = true
    try {
      openDialog(entry.dialog, { returnTo: entry.returnTo })
      restoreDialogPosition(entry.dialog)
    } finally { returningToDialog = false }
  }

  function restorePreviousCard(entry, targetDepth) {
    document.querySelectorAll('dialog[open]:not([data-card-sheet])')
      .forEach(dialog => dismissDialog(dialog))
    if (entry?.dialog?.open) {
      closeDialog(entry.dialog, { restore: targetDepth > 0 })
      return
    }
    if (targetDepth > 0 && typeof entry?.returnTo === 'function') {
      returningToDialog = true
      try {
        entry.returnTo()
        document.querySelectorAll('dialog[open]').forEach(restoreDialogPosition)
      } finally { returningToDialog = false }
    }
  }

  function restoreForwardCard(journey, targetDepth) {
    const current = journey.entries[journey.depth - 1]
    if (current?.dialog?.open) suspendDialog(current.dialog)
    journey.depth = targetDepth
    showCardHistoryEntry(journey.entries[targetDepth - 1])
  }

  function handleCardHistoryPop(event) {
    if (dismissedCardHistory) {
      dismissedCardHistory = false
      event.stopImmediatePropagation()
      return
    }
    const journey = cardHistoryJourney
    if (!journey) return
    const marker = cardHistoryMarker(event.state)
    const targetDepth = marker?.id === journey.id ? marker.depth : 0
    if (targetDepth === journey.depth) return
    if (targetDepth < journey.depth) {
      event.stopImmediatePropagation()
      const entry = journey.entries[journey.depth - 1]
      journey.depth = targetDepth
      pendingCardHistory = null
      restorePreviousCard(entry, targetDepth)
      return
    }
    if (marker?.id === journey.id && targetDepth <= journey.entries.length) {
      event.stopImmediatePropagation()
      restoreForwardCard(journey, targetDepth)
    }
  }

  function animateCardBack(dialog) {
    if (cardBackTimers.has(dialog)) return
    const marker = cardHistoryMarker()
    const journey = cardHistoryJourney
    if (!journey || marker?.id !== journey.id || marker.depth !== journey.depth) {
      closeDialog(dialog)
      return
    }
    if (!dialogUnderlays.has(dialog)) { history.back(); return }
    dialog.classList.add('is-card-back-settling')
    setCardBackPosition(dialog, window.innerWidth + 40)
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 260
    cardBackTimers.set(dialog, setTimeout(() => history.back(), duration))
  }

  const viewingIntentDefinitions = [
    ['watchlist', 'signal-plus', 'Add to Watchlist', 'Keep this title in your manual Watchlist'],
    ['up_next', 'signal-list-filter', 'Add to Up Next', 'Place it in your ordered queue'],
    ['watching', 'signal-eye', 'Add to Watching', 'Keep this show in your manual Watching list'],
    ['watched', 'signal-check', 'Mark watched', 'Move it into your watched history'],
  ]

  function decorateViewingIntentActions() {
    document.querySelectorAll('[data-viewing-intents]').forEach(root => {
      const includeSeries = root.dataset.viewingIntents === 'series'
      root.replaceChildren()
      viewingIntentDefinitions.forEach(([action, iconName, title, description]) => {
        if (action === 'watching' && !includeSeries) return
        const control = button({ iconName })
        control.dataset.viewingAction = action
        const copy = document.createElement('span')
        const heading = document.createElement('strong')
        heading.textContent = title
        const detail = document.createElement('small')
        detail.textContent = description
        copy.append(heading, detail)
        control.append(copy)
        root.append(control)
      })
    })
  }

  function emptyState({ className = 'empty', title = '', message = '', messageTag = '' } = {}) {
    const root = document.createElement('div')
    root.className = className
    if (title) {
      const heading = document.createElement('strong')
      heading.textContent = title
      root.append(heading)
    }
    if (message) {
      if (messageTag) {
        const copy = document.createElement(messageTag)
        copy.textContent = message
        root.append(copy)
      } else {
        root.append(document.createTextNode(message))
      }
    }
    return root
  }

  function artworkStatus(kind, title = '') {
    if (!['watched', 'part-watched'].includes(kind)) return null
    const complete = kind === 'watched'
    const badge = document.createElement('span')
    badge.className = `adult-artwork-status is-${kind}`
    badge.setAttribute('aria-label', title || (complete ? 'Watched' : 'Part watched'))
    badge.title = title || (complete ? 'Watched' : 'Part watched')
    badge.append(icon(complete ? 'signal-check' : 'signal-minus'))
    return badge
  }

  function button({
    text = '',
    className = '',
    iconName = '',
    iconClass = 'icon',
    ariaLabel = '',
    disabled = false,
    onClick = null,
  } = {}) {
    const control = document.createElement('button')
    control.type = 'button'
    if (className) control.className = className
    if (ariaLabel) control.setAttribute('aria-label', ariaLabel)
    if (iconName) control.append(icon(iconName, iconClass))
    if (text) control.append(document.createTextNode(text))
    control.disabled = disabled
    if (onClick) control.onclick = onClick
    return control
  }

  function powerStatus(kind = 'unknown', overrides = {}) {
    return { ...(powerStatusDefinitions[kind] || powerStatusDefinitions.unknown), ...overrides }
  }

  function setPowerStatus(indicator, label, status) {
    const resolved = typeof status === 'string' ? powerStatus(status) : status
    if (label) label.textContent = resolved.label
    if (indicator) {
      indicator.classList.add('portal-power-status-dot')
      indicator.classList.remove(...powerStatusClasses)
      indicator.classList.add(resolved.className)
    }
    return resolved
  }

  function openDialog(dialog, { returnTo = null, focus = null, lockScroll = true } = {}) {
    if (!dialog) return
    const position = capturePortalPosition()
    const snapshot = pendingCardSnapshot
    pendingCardSnapshot = null
    if (typeof returnTo === 'function') dialogParents.set(dialog, returnTo)
    else dialogParents.delete(dialog)
    if (snapshot && dialog.hasAttribute('data-card-sheet') && returnTo) {
      attachCardUnderlay(dialog, snapshot)
    } else if (!returnTo) removeCardUnderlay(dialog)
    syncCardNavigation(dialog)
    dialogScrollLocks.set(dialog, lockScroll)
    registerCardHistory(dialog, returnTo)
    if (!dialog.open) dialog.showModal()
    syncDialogScrollLock()
    restorePortalPosition(position)
    if (returningToDialog) restoreDialogPosition(dialog)
    if (focus) requestAnimationFrame(() => focus.focus({ preventScroll: true }))
  }

  function closeDialog(dialog, { restore = true } = {}) {
    if (!dialog) return
    const position = capturePortalPosition()
    if (dialog.open) dialogPositions.set(dialog, dialogScrollers(dialog)
      .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft })))
    const returnTo = dialogParents.get(dialog)
    dialogParents.delete(dialog)
    syncCardNavigation(dialog, false)
    if (dialog.open) dialog.close()
    resetCardBack(dialog)
    removeCardUnderlay(dialog)
    dialogScrollLocks.delete(dialog)
    syncDialogScrollLock()
    restorePortalPosition(position)
    if (restore && typeof returnTo === 'function') queueMicrotask(() => {
      returningToDialog = true
      try {
        returnTo()
        // Some parents rebuild their contents after opening the dialog.
        document.querySelectorAll('dialog[open]').forEach(restoreDialogPosition)
      } finally { returningToDialog = false }
    })
  }

  function dismissDialog(dialog) {
    closeDialog(dialog, { restore: false })
  }

  function suspendDialog(dialog, { card = false } = {}) {
    if (!dialog?.open) return
    pendingCardSnapshot = dialog.hasAttribute('data-card-sheet')
      ? captureCardSnapshot(dialog) : null
    if (card) prepareCardHistory(dialog)
    dialogPositions.set(dialog, dialogScrollers(dialog)
      .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft })))
    dialog.close()
    dialogScrollLocks.delete(dialog)
    syncDialogScrollLock()
  }

  function dismissCardJourney() {
    const marker = cardHistoryMarker()
    const depth = cardHistoryJourney && marker?.id === cardHistoryJourney.id
      ? marker.depth : 0
    pendingCardSnapshot = null
    pendingCardHistory = null
    document.querySelectorAll('dialog[data-card-sheet]').forEach(dialog => {
      if (dialog.open) dialog.close()
      resetCardBack(dialog)
      removeCardUnderlay(dialog)
      dialogParents.delete(dialog)
      dialogScrollLocks.delete(dialog)
      syncCardNavigation(dialog, false)
    })
    syncDialogScrollLock()
    cardHistoryJourney = null
    if (depth > 0) {
      dismissedCardHistory = true
      history.go(-depth)
    }
  }

  function dialogReturnTo(dialog) {
    return dialogParents.get(dialog) || null
  }

  function wireDialog(dialog, {
    closeButton = null,
    close = () => closeDialog(dialog),
    cancel = close,
    backdropClose = close,
    onClose = null,
  } = {}) {
    if (!dialog) return
    const closeButtons = Array.isArray(closeButton) ? closeButton : [closeButton]
    closeButtons.filter(Boolean).forEach(button => { button.onclick = close })
    dialog.onclick = event => {
      if (event.target === dialog) backdropClose()
    }
    dialog.oncancel = event => {
      event.preventDefault()
      cancel()
    }
    dialog.onclose = () => {
      dialogScrollLocks.delete(dialog)
      syncDialogScrollLock()
      if (typeof onClose === 'function') onClose()
    }
  }

  window.MabelPortalUI = Object.freeze({
    icon,
    button,
    emptyState,
    artworkStatus,
    powerStatus,
    setPowerStatus,
    dialogs: Object.freeze({
      open: openDialog,
      close: closeDialog,
      dismiss: dismissDialog,
      suspend: suspendDialog,
      dismissJourney: dismissCardJourney,
      returnTo: dialogReturnTo,
      wire: wireDialog,
    }),
  })

  if (cardHistoryMarker()) history.replaceState(cardHistoryState('', 0), '', location.href)
  window.addEventListener('popstate', handleCardHistoryPop, true)
  decorateExperienceCloseButtons()
  decorateViewingIntentActions()
})()
