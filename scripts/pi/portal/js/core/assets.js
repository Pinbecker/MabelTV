'use strict';

(() => {
  const pending = new Map()

  function loadScript(path, available) {
    if (available()) return Promise.resolve()
    if (pending.has(path)) return pending.get(path)
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = path
      script.async = true
      script.onload = () => available()
        ? resolve()
        : reject(new Error(`MabelTV loaded ${path}, but it did not start`))
      script.onerror = () => reject(new Error(`MabelTV could not load ${path}`))
      document.head.append(script)
    }).catch(error => {
      pending.delete(path)
      throw error
    })
    pending.set(path, promise)
    return promise
  }

  window.MabelAssets = Object.freeze({
    chart: () => loadScript('/portal/vendor/chart.umd.min.js',
      () => typeof window.Chart === 'function'),
    hls: () => loadScript('/hls.min.js',
      () => typeof window.Hls === 'function'),
  })
})()
