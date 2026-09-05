(() => {
  'use strict'

  const DB_NAME = 'mabeltv-offline-v1'
  const DB_VERSION = 2
  const CHUNK_SIZE = 4 * 1024 * 1024
  const PIN_ITERATIONS = 260000
  const SECURITY_ID = 'portal'
  const PIN_PATTERN = /^\d{4,8}$/
  const activeDownloads = new Map()

  function offlineSupportError() {
    if (!window.isSecureContext) {
      return new Error('Offline downloads are available in the MabelTV Home Screen app installed from its secure HTTPS address.')
    }
    if (!('serviceWorker' in navigator)) {
      return new Error('This browser cannot run the MabelTV offline player.')
    }
    return null
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Device storage failed'))
    })
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error || new Error('Device storage failed'))
      transaction.onabort = () => reject(transaction.error || new Error('Device storage was interrupted'))
    })
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains('downloads')) {
          database.createObjectStore('downloads', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('chunks')) {
          const chunks = database.createObjectStore('chunks', { keyPath: 'key' })
          chunks.createIndex('downloadId', 'downloadId', { unique: false })
        }
        if (!database.objectStoreNames.contains('security')) {
          database.createObjectStore('security', { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Private device storage is unavailable'))
    })
  }

  async function getDownload(id) {
    const database = await openDatabase()
    try {
      return await requestResult(database.transaction('downloads').objectStore('downloads').get(id))
    } finally { database.close() }
  }

  async function listDownloads() {
    const database = await openDatabase()
    try {
      const values = await requestResult(database.transaction('downloads').objectStore('downloads').getAll())
      return values.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    } finally { database.close() }
  }

  function protectedDownload(manifest) {
    return manifest?.protected === true
      || ['adult', 'adult-series'].includes(manifest?.source?.kind)
  }

  async function getSecurity() {
    const database = await openDatabase()
    try {
      return await requestResult(database.transaction('security').objectStore('security').get(SECURITY_ID))
    } finally { database.close() }
  }

  async function putSecurity(value) {
    const database = await openDatabase()
    try {
      const transaction = database.transaction('security', 'readwrite')
      transaction.objectStore('security').put({ id: SECURITY_ID, ...value })
      await transactionDone(transaction)
    } finally { database.close() }
  }

  async function pinDigest(pin, salt, iterations = PIN_ITERATIONS) {
    const material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
    const digest = await crypto.subtle.deriveBits({
      name: 'PBKDF2', salt: Uint8Array.from(salt), iterations, hash: 'SHA-256',
    }, material, 256)
    return [...new Uint8Array(digest)]
  }

  function equalBytes(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    let difference = 0
    for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
    return difference === 0
  }

  function setMediaAccess(unlocked) {
    navigator.serviceWorker?.controller?.postMessage({
      type: 'mabeltv-offline-access', unlocked: Boolean(unlocked),
    })
  }

  async function rememberSecurity(required, pin = '') {
    const previous = await getSecurity()
    const value = {
      required: required !== false,
      salt: previous?.salt || null,
      digest: previous?.digest || null,
      iterations: Number(previous?.iterations || PIN_ITERATIONS),
      failedAttempts: 0,
      lockedUntil: 0,
      updatedAt: Date.now(),
    }
    if (pin) {
      if (!PIN_PATTERN.test(pin)) throw new Error('The parent PIN must be 4 to 8 digits')
      const salt = [...crypto.getRandomValues(new Uint8Array(16))]
      value.salt = salt
      value.iterations = PIN_ITERATIONS
      value.digest = await pinDigest(pin, salt, value.iterations)
    }
    await putSecurity(value)
    return { required: value.required, configured: Boolean(value.salt && value.digest) }
  }

  async function securityStatus() {
    const value = await getSecurity()
    return {
      required: value?.required !== false,
      configured: Boolean(value?.salt && value?.digest),
      lockedUntil: Number(value?.lockedUntil || 0),
    }
  }

  async function verifyPin(pin) {
    const value = await getSecurity()
    if (value?.required === false) {
      setMediaAccess(true)
      return true
    }
    if (!value?.salt || !value?.digest) {
      throw new Error('Reconnect to MabelTV and sign in once to prepare secure offline access.')
    }
    const now = Date.now()
    const lockedUntil = Number(value.lockedUntil || 0)
    if (lockedUntil > now) {
      const seconds = Math.max(1, Math.ceil((lockedUntil - now) / 1000))
      throw new Error(`Too many attempts. Try again in ${seconds} seconds.`)
    }
    const candidate = PIN_PATTERN.test(pin)
      ? await pinDigest(pin, value.salt, Number(value.iterations || PIN_ITERATIONS))
      : []
    if (!equalBytes(candidate, value.digest)) {
      const attempts = Number(value.failedAttempts || 0) + 1
      await putSecurity({
        ...value,
        failedAttempts: attempts >= 5 ? 0 : attempts,
        lockedUntil: attempts >= 5 ? now + 30000 : 0,
      })
      throw new Error(attempts >= 5
        ? 'Too many attempts. Try again in 30 seconds.'
        : 'That PIN is not correct')
    }
    await putSecurity({ ...value, failedAttempts: 0, lockedUntil: 0 })
    setMediaAccess(true)
    return true
  }

  async function putDownload(manifest, chunkIndex = null, chunkData = null) {
    const database = await openDatabase()
    try {
      const stores = chunkIndex === null ? ['downloads'] : ['downloads', 'chunks']
      const transaction = database.transaction(stores, 'readwrite')
      transaction.objectStore('downloads').put(manifest)
      if (chunkIndex !== null) {
        transaction.objectStore('chunks').put({
          key: `${manifest.id}:${chunkIndex}`,
          downloadId: manifest.id,
          index: chunkIndex,
          data: chunkData,
        })
      }
      await transactionDone(transaction)
    } finally { database.close() }
  }

  async function removeDownload(id) {
    const active = activeDownloads.get(id)
    if (active) active.abort()
    const database = await openDatabase()
    try {
      const transaction = database.transaction(['downloads', 'chunks'], 'readwrite')
      transaction.objectStore('downloads').delete(id)
      const index = transaction.objectStore('chunks').index('downloadId')
      const request = index.openKeyCursor(IDBKeyRange.only(id))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        transaction.objectStore('chunks').delete(cursor.primaryKey)
        cursor.continue()
      }
      await transactionDone(transaction)
    } finally { database.close() }
    changed()
  }

  async function jsonRequest(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || 'MabelTV could not prepare that download')
    return body
  }

  async function prepare(payload, onUpdate) {
    let result = await jsonRequest('/api/offline/start', {
      method: 'POST', body: JSON.stringify(payload),
    })
    while (result.status === 'queued' || result.status === 'preparing') {
      onUpdate?.({ phase: 'preparing', message: result.message || 'Preparing for offline playback…' })
      await new Promise(resolve => setTimeout(resolve, 2500))
      result = await jsonRequest(`/api/offline/preparations/${encodeURIComponent(result.id)}`)
    }
    if (result.status !== 'ready') throw new Error(result.message || 'Offline preparation stopped')
    return result
  }

  async function ensureCapacity(size) {
    if (navigator.storage?.persist) {
      try { await navigator.storage.persist() } catch (_) { /* best effort */ }
    }
    if (!navigator.storage?.estimate) return
    const estimate = await navigator.storage.estimate()
    const available = Number(estimate.quota || 0) - Number(estimate.usage || 0)
    if (estimate.quota && available < size + Math.min(256 * 1024 * 1024, size * 0.08)) {
      throw new Error(`This device needs ${formatBytes(size)} free in MabelTV storage for that download.`)
    }
  }

  async function startDownload(payload, fallbackTitle, onUpdate) {
    if (!navigator.onLine) throw new Error('Reconnect to MabelTV to start or resume this download.')
    const prepared = await prepare(payload, onUpdate)
    const id = prepared.content_id
    const existing = await getDownload(id)
    if (existing?.status === 'complete') {
      onUpdate?.({ phase: 'complete', manifest: existing })
      return existing
    }
    await ensureCapacity(Number(prepared.size || 0) - Number(existing?.downloadedBytes || 0))
    const controller = new AbortController()
    activeDownloads.set(id, controller)
    let manifest = {
      id,
      title: prepared.title || fallbackTitle || prepared.file_name,
      fileName: prepared.file_name,
      mimeType: prepared.mime_type || 'video/mp4',
      size: Number(prepared.size),
      chunkSize: CHUNK_SIZE,
      totalChunks: Math.ceil(Number(prepared.size) / CHUNK_SIZE),
      downloadedBytes: Number(existing?.downloadedBytes || 0),
      status: 'downloading',
      source: payload,
      subtitles: prepared.subtitles || existing?.subtitles || null,
      createdAt: Number(existing?.createdAt || Date.now()),
      updatedAt: Date.now(),
      error: '',
      protected: ['adult', 'adult-series'].includes(payload?.kind),
    }
    await putDownload(manifest)
    changed()
    try {
      let index = Math.floor(manifest.downloadedBytes / CHUNK_SIZE)
      while (manifest.downloadedBytes < manifest.size) {
        const start = index * CHUNK_SIZE
        const end = Math.min(manifest.size - 1, start + CHUNK_SIZE - 1)
        const response = await fetch(prepared.stream_url, {
          credentials: 'same-origin',
          headers: { Range: `bytes=${start}-${end}` },
          signal: controller.signal,
        })
        if (!(response.status === 206 || (response.status === 200 && start === 0))) {
          throw new Error('The Pi did not provide the next part of this download')
        }
        // Store each part as a Blob. WebKit can keep these file-backed and the
        // service worker can compose byte-range responses without copying a
        // whole film into memory. Legacy ArrayBuffer chunks remain readable.
        const data = await response.blob()
        const expected = end - start + 1
        if (data.size !== expected) throw new Error('The download stopped before this part was complete')
        manifest = {
          ...manifest,
          downloadedBytes: start + data.size,
          updatedAt: Date.now(),
        }
        await putDownload(manifest, index, data)
        onUpdate?.({ phase: 'downloading', manifest })
        changed()
        index++
      }
      manifest = { ...manifest, status: 'complete', downloadedBytes: manifest.size, updatedAt: Date.now() }
      await putDownload(manifest)
      onUpdate?.({ phase: 'complete', manifest })
      changed()
      return manifest
    } catch (error) {
      manifest = {
        ...manifest, status: 'paused', updatedAt: Date.now(),
        error: error.name === 'AbortError' ? 'Download paused' : error.message,
      }
      await putDownload(manifest)
      changed()
      throw error
    } finally {
      activeDownloads.delete(id)
      jsonRequest('/api/external/release', {
        method: 'POST', body: JSON.stringify({ stream: prepared.stream }),
      }).catch(() => {})
    }
  }

  function pauseDownload(id) {
    activeDownloads.get(id)?.abort()
  }

  function playbackUrl(id) {
    return `/offline-media/${encodeURIComponent(id)}`
  }

  function subtitleUrl(id) {
    return `/offline-subtitles/${encodeURIComponent(id)}.vtt`
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0)
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`
    return `${Math.ceil(bytes / 1024)} KB`
  }

  function changed() {
    window.dispatchEvent(new CustomEvent('mabeltv-downloads-changed'))
  }

  async function initialise() {
    const unsupported = offlineSupportError()
    if (unsupported) throw unsupported
    if (!('indexedDB' in window)) throw new Error('Private device storage is not supported here')
    await openDatabase().then(database => database.close())

    let registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) {
      registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
    } else {
      registration.update().catch(() => {})
    }
    await navigator.serviceWorker.ready

    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', controlled)
          reject(new Error('The offline app is finishing setup. Close and reopen MabelTV, then try again.'))
        }, 6000)
        function controlled() {
          if (!navigator.serviceWorker.controller) return
          clearTimeout(timeout)
          navigator.serviceWorker.removeEventListener('controllerchange', controlled)
          resolve()
        }
        navigator.serviceWorker.addEventListener('controllerchange', controlled)
      })
    }

    const check = await fetch('/offline-ready', { cache: 'no-store' })
    if (!check.ok) {
      throw new Error('The MabelTV offline player did not finish starting. Close and reopen the app, then try again.')
    }
  }

  window.MabelOffline = {
    initialise,
    getDownload,
    listDownloads,
    removeDownload,
    startDownload,
    pauseDownload,
    playbackUrl,
    subtitleUrl,
    formatBytes,
    protectedDownload,
    rememberSecurity,
    securityStatus,
    verifyPin,
    setMediaAccess,
    activeDownloads,
  }
})()
