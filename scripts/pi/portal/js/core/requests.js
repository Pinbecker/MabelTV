'use strict'

const portalRequestEvents = []
let portalDiagnosticFlush = false
function portalRequestEvent(path, method, started, code, requestId) {
  const event = { path: String(path).split('?')[0].replace(/[a-f0-9]{24,}/gi, ':id').slice(0, 120), method,
    route: location.hash.split('?')[0].replace(/[a-f0-9]{24,}/gi, ':id').slice(0, 80),
    duration: Math.round(performance.now() - started), code: String(code).slice(0, 32), requestId,
    visible: document.visibilityState, online: navigator.onLine, time: Date.now() }
  portalRequestEvents.push(event); if (portalRequestEvents.length > 40) portalRequestEvents.shift()
  if (portalDiagnosticFlush || method !== 'GET' || code === 'aborted' || code === 401) return
  portalDiagnosticFlush = true
  const events = portalRequestEvents.slice(-10)
  void fetch('/api/studio/diagnostics', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }), signal: AbortSignal.timeout(5000) })
    .catch(() => {}).finally(() => { portalDiagnosticFlush = false })
}
async function portalReadResponse(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase(), attempts = method === 'GET' ? 2 : 1
  const started = performance.now(), requestId = crypto.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController(), abort = () => controller.abort(options.signal?.reason)
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), options.timeout || (method === 'GET' ? 10000 : 30000))
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    try {
      const response = await fetch(path, { ...options, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...options.headers, 'X-Mabel-Request-ID': requestId }, signal: controller.signal })
      if ([502, 503, 504].includes(response.status) && attempt + 1 < attempts) { await response.body?.cancel(); continue }
      let invalidResponse = false
      const body = await response.json().catch(error => { if (controller.signal.aborted) throw error; invalidResponse = true; return {} })
      if (!response.ok) portalRequestEvent(path, method, started, response.status, requestId)
      return { response, body, invalidResponse }
    } catch (error) {
      if (options.signal?.aborted) { error.expectedAbort = true; throw error }
      if (attempt + 1 < attempts) continue
      portalRequestEvent(path, method, started, controller.signal.aborted ? 'timeout' : 'network', requestId)
      const failure = new Error(navigator.onLine ? 'Connection interrupted. Try again.' : 'No internet connection.')
      failure.code = 'connection'; failure.requestId = requestId; throw failure
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort) }
  }
}
