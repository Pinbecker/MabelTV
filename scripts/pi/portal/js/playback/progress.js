'use strict'

// Durable checkpoints belong beside Downloads, never in disposable API caches.
// They contain private media identities and are read only after the PIN gate.
const myTvProgress = (() => {
  let flushing = null
  const pendingMemory = new Map()
  const acknowledgements = new Map()
  const rejected = new Map()
  const key = source => JSON.stringify([source.kind, source.series || '', source.file])
  const allowed = () => offlineProtectedAccess === true
  function database() {
    return new Promise((resolve, reject) => {
      const schema = window.MabelOfflineSchema
      const request = indexedDB.open(schema.databaseName, schema.version)
      request.onupgradeneeded = () => schema.upgrade(request.result)
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Playback storage is waiting for another app window'))
    })
  }
  async function read(source = null) {
    if (!allowed()) return source ? null : []
    const db = await database()
    try {
      return await new Promise((resolve, reject) => {
        const store = db.transaction('playback').objectStore('playback')
        const request = source ? store.get(key(source)) : store.getAll()
        request.onsuccess = () => resolve(allowed() ? request.result : source ? null : [])
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  }
  async function put(value, acknowledged = false) {
    if (!allowed()) throw new Error('Unlock My TV to save playback progress')
    const db = await database()
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('playback', 'readwrite'); const store = tx.objectStore('playback')
        const request = store.get(value.id)
        request.onsuccess = () => {
          const current = request.result
          // A response to an older request cannot acknowledge a newer sample.
          if (current && (current.observed_at > value.observed_at
            || (current.writer === value.writer && current.sequence > value.sequence))) return
          store.put({ ...value, pending: !acknowledged })
        }
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error || new Error('Playback save interrupted'))
      })
    } finally { db.close() }
  }
  async function flush() {
    if (!allowed() || navigator.onLine === false) return false
    if (flushing) return flushing
    flushing = (async () => {
      let stored = []
      try { stored = await read() } catch (_) { /* memory checkpoints still retry */ }
      const values = new Map(stored.filter(row => row.pending).map(row => [row.id, row]))
      pendingMemory.forEach((row, id) => {
        if (!values.has(id) || values.get(id).observed_at <= row.observed_at) values.set(id, row)
      })
      for (const row of values.values()) {
        if (!allowed()) return false
        try {
          await playbackRequest('/api/my-tv/progress', row)
          acknowledgements.set(row.id, { writer: row.writer, sequence: row.sequence })
          rejected.delete(row.id)
          try { await put(row, true) } catch (_) { /* the server has acknowledged this checkpoint */ }
          if (pendingMemory.get(row.id)?.sequence === row.sequence
            && pendingMemory.get(row.id)?.writer === row.writer) pendingMemory.delete(row.id)
        } catch (failure) {
          if (failure.status !== 400) return false
          // A removed title must not block all other titles in the outbox.
          // Keep its local bookmark for its downloaded copy, but retire this
          // rejected upload until there is a new playback checkpoint.
          rejected.set(row.id, failure.message)
          try { await put({ ...row, error: failure.message }, true) } catch (_) { return false }
          if (pendingMemory.get(row.id)?.writer === row.writer
            && pendingMemory.get(row.id)?.sequence === row.sequence) pendingMemory.delete(row.id)
        }
      }
      return true
    })().then(sent => {
      flushing = null
      if (sent && pendingMemory.size && allowed()) queueMicrotask(() => { void flush() })
      return sent
    }, () => { flushing = null; return false })
    return flushing
  }
  function begin(video, source, serverTime = null) {
    const identity = { kind: source.kind, file: source.file,
      ...(source.library_id ? { library_id: source.library_id } : {}),
      ...(source.series ? { series: source.series } : {}) }
    const writer = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
    video._myTvProgress = { source: identity, writer,
      sequence: 0, offset: serverTime ? serverTime - Date.now() / 1000 : 0,
      lastPosition: -1, ready: false, latest: null }
  }
  async function checkpoint(video, finished = false, force = false) {
    const state = video._myTvProgress
    if (!state?.ready || !allowed() || !Number.isFinite(video.currentTime)) return false
    const position = Math.max(0, video.currentTime)
    const id = key(state.source)
    const report = durable => {
      const ack = acknowledgements.get(id)
      const sent = ack?.writer === state.writer && ack.sequence >= state.latest.sequence
      if (video._myTvProgress === state) {
        const hint = $('#iosWatchProgressStatus')
        if (hint) {
          hint.textContent = sent ? '' : durable ? `Progress saved on this device · ${rejected.get(id) || 'waiting to sync'}`
            : 'Progress could not be saved yet · keep this player open and reconnect'
          hint.classList.toggle('hidden', sent)
        }
      }
      return sent || durable
    }
    if (!force && !finished && state.latest && Math.abs(position - state.lastPosition) < 5) {
      await flush()
      return report(true)
    }
    const row = { id: key(state.source), source: state.source, writer: state.writer,
      sequence: ++state.sequence, observed_at: Date.now() / 1000 + state.offset,
      position, duration: Number.isFinite(video.duration) ? video.duration : 0, finished, pending: true,
      stream: iosRemoteSession || undefined }
    state.latest = row
    pendingMemory.set(row.id, row)
    let durable = false
    try { await put(row); durable = true; state.lastPosition = position } catch (_) { /* try the server */ }
    await flush()
    return report(durable)
  }
  function beacon(video) {
    const state = video._myTvProgress
    if (!state?.ready || !allowed() || !Number.isFinite(video.currentTime)) return
    // Start the durable write as well: sendBeacon is best effort, not an acknowledgement.
    void checkpoint(video, video.ended, true)
    const row = state.latest
    if (row) navigator.sendBeacon?.('/api/my-tv/progress', new Blob([JSON.stringify(row)], { type: 'application/json' }))
  }
  window.addEventListener('online', () => { void flush() })
  window.addEventListener('mabel-playback-access', () => {
    if (allowed()) void flush()
    else { pendingMemory.clear(); acknowledgements.clear(); rejected.clear() }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush()
  })
  return { begin, checkpoint, beacon, read, flush }
})()

async function playbackRequest(path, payload, timeout = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try { return await api(path, { method: 'POST', body: JSON.stringify(payload), signal: controller.signal }) }
  catch (error) {
    if (error.name === 'AbortError') throw new Error('The connection took too long. Please try again.')
    throw error
  } finally { clearTimeout(timer) }
}
