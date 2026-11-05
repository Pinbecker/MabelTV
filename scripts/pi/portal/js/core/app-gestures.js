'use strict';

// A standalone shell entry: no private application state or storage access.
(() => {
  const inApp = () => document.body?.classList.contains('portal-v2')
  const preventZoom = event => {
    if (inApp() && event.cancelable) event.preventDefault()
  }
  // WebKit exposes page pinch as gesture events. Do not swallow ordinary
  // touchmove: vertical scrolling, rails and the LG pointer must still work.
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, preventZoom, { passive: false })
  }
  document.addEventListener('touchmove', event => {
    if (event.touches?.length > 1) {
      preventZoom(event)
    }
  }, { passive: false })
  document.addEventListener('wheel', event => {
    if (event.ctrlKey) preventZoom(event)
  }, { passive: false })
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) {
      preventZoom(event)
    }
  })
})()
