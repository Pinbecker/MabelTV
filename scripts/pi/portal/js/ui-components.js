'use strict'

;(() => {
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
  const ICON_SPRITE = '/portal/icons.svg'
  const dialogParents = new WeakMap()
  const dialogScrollLocks = new WeakMap()

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

  const viewingIntentDefinitions = [
    ['watchlist', 'signal-plus', 'Add to Watchlist', 'Keep unseen titles saved for later'],
    ['rewatch', 'signal-restart', 'Add to Rewatch', 'Save a favourite you have already seen'],
    ['up_next', 'signal-list-filter', 'Add to Up Next', 'Place it in your ordered queue'],
    ['watching', 'signal-eye', 'Start watching series', 'Keep its next episode in Up Next'],
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

  function openDialog(dialog, { returnTo = null, focus = null, lockScroll = true } = {}) {
    if (!dialog) return
    if (typeof returnTo === 'function') dialogParents.set(dialog, returnTo)
    else dialogParents.delete(dialog)
    dialogScrollLocks.set(dialog, lockScroll)
    if (!dialog.open) dialog.showModal()
    syncDialogScrollLock()
    if (focus) requestAnimationFrame(() => focus.focus({ preventScroll: true }))
  }

  function closeDialog(dialog, { restore = true } = {}) {
    if (!dialog) return
    const returnTo = dialogParents.get(dialog)
    dialogParents.delete(dialog)
    if (dialog.open) dialog.close()
    dialogScrollLocks.delete(dialog)
    syncDialogScrollLock()
    if (restore && typeof returnTo === 'function') queueMicrotask(returnTo)
  }

  function dismissDialog(dialog) {
    closeDialog(dialog, { restore: false })
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
    dialogs: Object.freeze({
      open: openDialog,
      close: closeDialog,
      dismiss: dismissDialog,
      wire: wireDialog,
    }),
  })

  decorateExperienceCloseButtons()
  decorateViewingIntentActions()
})()
