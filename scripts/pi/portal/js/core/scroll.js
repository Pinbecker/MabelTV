'use strict'

// Scroll belongs to the visible screen, not to the request that refreshes it.
// Capture immediately before changing DOM and restore synchronously: a delayed
// restoration must never override a subsequent gesture or navigation.
const portalViewPositions = new Map()
const portalRailSelector = '.watch-channel-rail,.watch-continue-rail,.home-poster-rail,.adult-series-rail'
const portalAnchorAttributes = ['data-adult-path', 'data-watch-channel-folder', 'data-usb-path', 'data-viewing-key']
let portalScrollSettlement = 0

function cancelPortalScrollSettlement() { portalScrollSettlement += 1 }
for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown', 'click', 'change']) {
  document.addEventListener(event, cancelPortalScrollSettlement, { passive: true, capture: true })
}

function settlePortalPosition(position) {
  // WebKit can apply a final scroll correction after a large library repaint.
  // A newer refresh, navigation or user gesture always cancels this correction.
  const revision = ++portalScrollSettlement
  const animations = position.view?.getAnimations() || []
  return Promise.allSettled(animations.map(animation => animation.finished)).then(() =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (revision === portalScrollSettlement) restorePortalPosition(position)
    resolve()
  }))))
}

function portalScrollTop() {
  return Math.max(0, Number((document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0))
}

function setPortalScrollTop(value) {
  const top = Math.max(0, Number(value) || 0)
  const scroller = document.scrollingElement || document.documentElement
  scroller.scrollTop = top
  document.body.scrollTop = top
  window.scrollTo(window.scrollX, top)
}

function resetViewScroll() { setPortalScrollTop(0) }

function portalAnchorTop(element) {
  return element.getBoundingClientRect().top
}

function portalElementKey(element) {
  if (element.id) return `id:${element.id}`
  const owner = element.closest('[data-watch-channel-folder],[id]')
  return `${owner?.dataset.watchChannelFolder || owner?.id || ''}:${element.getAttribute('aria-label') || element.className}`
}

function capturePortalPosition({ anchor = true } = {}) {
  const view = document.querySelector('.view.active')
  const candidates = anchor && view ? [...view.querySelectorAll(portalAnchorAttributes.map(name => `[${name}]`).join(','))]
    .filter(element => { const r = element.getBoundingClientRect(); return r.width && r.height && r.bottom > 70 && r.top < window.innerHeight }) : []
  const nearest = candidates.sort((a, b) => Math.abs(a.getBoundingClientRect().top - 70) - Math.abs(b.getBoundingClientRect().top - 70))[0]
  const attribute = nearest && portalAnchorAttributes.find(name => nearest.hasAttribute(name))
  return {
    view, scrollY: portalScrollTop(),
    anchor: nearest ? { attribute, value: nearest.getAttribute(attribute), top: portalAnchorTop(nearest) } : null,
    rails: [...(view?.querySelectorAll(portalRailSelector) || [])].map(element => ({ key: portalElementKey(element), left: element.scrollLeft })),
    locked: document.body.classList.contains('portal-player-open'),
    panels: [...document.querySelectorAll('dialog[open] .library-sheet-panel,dialog[open] .watch-film-panel')]
      .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft })),
  }
}

function restorePortalPosition(position) {
  if (!position || position.locked || position.view !== document.querySelector('.view.active')) return
  for (const rail of position.view?.querySelectorAll(portalRailSelector) || []) {
    const saved = position.rails.find(value => value.key === portalElementKey(rail))
    if (saved) rail.scrollLeft = saved.left
  }
  setPortalScrollTop(position.scrollY)
  const saved = position.anchor
  const anchor = saved && [...position.view.querySelectorAll(`[${saved.attribute}]`)]
    .find(element => element.getAttribute(saved.attribute) === saved.value && element.getBoundingClientRect().width)
  if (anchor) setPortalScrollTop(portalScrollTop() + portalAnchorTop(anchor) - saved.top)
  for (const panel of position.panels) {
    if (panel.element.closest('dialog')?.open) {
      panel.element.scrollTop = panel.top
      panel.element.scrollLeft = panel.left
    }
  }
}

function preservePortalPosition(render, options) {
  const position = capturePortalPosition(options)
  try { return render() } finally { restorePortalPosition(position) }
}

function rememberPortalView() {
  const position = capturePortalPosition({ anchor: false })
  if (position.view && !position.locked) portalViewPositions.set(position.view.id, position)
}
