'use strict'

;(() => {
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
  const ICON_SPRITE = '/portal/icons.svg'
  const dialogParents = new WeakMap()
  const dialogScrollLocks = new WeakMap()
  const dialogPositions = new WeakMap()
  let returningToDialog = false

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
    let control = dialog.querySelector('.portal-card-back')
    if (control) return control
    control = button({
      className: 'portal-card-back hidden',
      iconName: 'signal-arrow-left',
      ariaLabel: 'Back to previous card',
      onClick: () => closeDialog(dialog),
    })
    const panel = dialog.firstElementChild
    const host = panel?.querySelector(':scope > .dialog-close-bar, :scope > header') || panel
    host?.append(control)
    return control
  }

  function syncCardNavigation(dialog, hasParent = dialogParents.has(dialog)) {
    const control = cardBackControl(dialog)
    if (!control) return
    control.classList.toggle('hidden', !hasParent)
    dialog.classList.toggle('has-card-parent', hasParent)
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
    if (typeof returnTo === 'function') dialogParents.set(dialog, returnTo)
    else dialogParents.delete(dialog)
    syncCardNavigation(dialog)
    dialogScrollLocks.set(dialog, lockScroll)
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

  function suspendDialog(dialog) {
    if (!dialog?.open) return
    dialogPositions.set(dialog, dialogScrollers(dialog)
      .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft })))
    dialog.close()
    dialogScrollLocks.delete(dialog)
    syncDialogScrollLock()
  }

  function dismissCardJourney() {
    document.querySelectorAll('dialog[data-card-sheet]').forEach(dialog => {
      if (dialog.open) dialog.close()
      dialogParents.delete(dialog)
      dialogScrollLocks.delete(dialog)
      syncCardNavigation(dialog, false)
    })
    syncDialogScrollLock()
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

  decorateExperienceCloseButtons()
  decorateViewingIntentActions()
})()
