import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const projectRoot = new URL('../../', import.meta.url)
const workerSource = fs.readFileSync(new URL('scripts/pi/service-worker.js', projectRoot), 'utf8')
const offlineSource = fs.readFileSync(new URL('scripts/pi/mabeltv-offline.js', projectRoot), 'utf8')

function request(value) {
  const result = {}
  queueMicrotask(() => {
    result.result = value
    result.onsuccess?.()
  })
  return result
}

function workerContext(manifest, chunks, cacheOverrides = {}) {
  const listeners = {}
  let skipWaitingCalls = 0
  const stores = {
    downloads: { get: key => request(key === manifest.id ? manifest : undefined) },
    chunks: { get: key => request(chunks.get(key)) },
  }
  const database = {
    objectStoreNames: { contains: () => true },
    transaction: name => ({ objectStore: () => stores[name] }),
    close() {},
  }
  const context = vm.createContext({
    Blob, Headers, Request, Response, URL, Uint8Array,
    console,
    indexedDB: { open: () => request(database) },
    caches: {
      open: async () => ({ add: async () => {} }),
      delete: async () => true,
      keys: async () => [],
      match: async () => undefined,
      ...cacheOverrides,
    },
    self: {
      location: { origin: 'https://tv.example.test' },
      addEventListener: (name, listener) => { listeners[name] = listener },
      skipWaiting: async () => { skipWaitingCalls += 1 },
      clients: { claim: async () => {} },
    },
  })
  vm.runInContext(workerSource, context, { filename: 'service-worker.js' })
  return { context, listeners, skipWaitingCalls: () => skipWaitingCalls }
}

test('service worker precaches the shell without concurrent request fan-out', async () => {
  const added = []
  let active = 0
  let maximumActive = 0
  const { listeners } = workerContext({ id: 'unused' }, new Map(), {
    open: async () => ({
      add: async url => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise(resolve => setImmediate(resolve))
        added.push(url)
        active -= 1
      },
    }),
  })
  let installation
  listeners.install({ waitUntil: promise => { installation = promise } })
  await installation

  assert.equal(maximumActive, 1)
  assert.equal(added[0], '/')
  assert.ok(added.includes('/portal/js/core/app-cache.js'))
  assert.ok(!added.includes('/portal/vendor/chart.umd.min.js'))
  assert.ok(!added.includes('/hls.min.js'))
  assert.ok(added.length > 50)
})

test('service worker keeps the current rollback shell and unrelated persistent caches', async () => {
  const deleted = []
  const worker = workerContext({ id: 'unused' }, new Map(), {
    keys: async () => [
      'mabeltv-shell-v211', 'mabeltv-shell-v212', 'mabeltv-shell-v213',
      'mabeltv-shell-v214', 'mabeltv-shell-v215',
      'mabeltv-offline-v1', 'mabeltv-artwork-family-v1', 'another-app-cache',
    ],
    delete: async key => { deleted.push(key); return true },
  })
  let activation
  worker.listeners.activate({ waitUntil: promise => { activation = promise } })
  await activation

  assert.deepEqual(deleted, [
    'mabeltv-shell-v211', 'mabeltv-shell-v212', 'mabeltv-shell-v213',
  ])
})

test('a complete shell update waits for a safe activation boundary', async () => {
  const worker = workerContext({ id: 'unused' }, new Map())
  let installation
  worker.listeners.install({ waitUntil: promise => { installation = promise } })
  await installation
  assert.equal(worker.skipWaitingCalls(), 0)

  let activation
  worker.listeners.message({
    data: { type: 'mabeltv-activate-update' },
    waitUntil: promise => { activation = promise },
  })
  await activation
  assert.equal(worker.skipWaitingCalls(), 1)
})

test('cached shell navigation remains available when the Pi cannot be reached', async () => {
  const cached = new Response('<main>MabelTV shell</main>', {
    headers: { 'Content-Type': 'text/html' },
  })
  const worker = workerContext({ id: 'unused' }, new Map(), {
    open: async () => ({
      add: async () => {},
      match: async value => value === '/' ? cached.clone() : undefined,
      put: async () => {},
      keys: async () => [],
      delete: async () => true,
    }),
  })
  const response = await dispatchedResponse(worker.listeners.fetch, {
    url: 'https://tv.example.test/adult-tv', mode: 'navigate',
  }, 'phone')
  assert.equal(response.status, 200)
  assert.match(await response.text(), /MabelTV shell/)
})

test('protected artwork cache is never exposed to a locked client', async () => {
  const protectedArtwork = new Response('private-poster', { status: 200 })
  const worker = workerContext({ id: 'unused' }, new Map(), {
    open: async () => ({
      add: async () => {},
      match: async () => protectedArtwork.clone(),
      put: async () => {},
      keys: async () => [],
      delete: async () => true,
    }),
  })
  worker.context.fetch = async () => { throw new Error('Pi offline') }
  const artwork = new Request('https://tv.example.test/api/adult/artwork/private.jpg')

  let response = await dispatchedResponse(worker.listeners.fetch, artwork, 'phone')
  assert.equal(response.status, 401)
  worker.listeners.message({
    data: { type: 'mabeltv-offline-access', unlocked: true },
    source: { id: 'phone' },
  })
  response = await dispatchedResponse(worker.listeners.fetch, artwork, 'phone')
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'private-poster')
})

test('same-origin TMDB artwork is retained for an unlocked offline client', async () => {
  const stored = new Map()
  const worker = workerContext({ id: 'unused' }, new Map(), {
    open: async () => ({
      add: async () => {},
      match: async request => stored.get(request.url)?.clone(),
      put: async (request, response) => { stored.set(request.url, response.clone()) },
      keys: async () => [...stored.keys()].map(url => new Request(url)),
      delete: async request => stored.delete(request.url),
    }),
  })
  worker.context.fetch = async () => new Response('tmdb-poster', { status: 200 })
  worker.listeners.message({
    data: { type: 'mabeltv-offline-access', unlocked: true },
    source: { id: 'phone' },
  })
  const artwork = new Request(
    'https://tv.example.test/api/adult/tmdb-artwork/w342/example.jpg')

  let response = await dispatchedResponse(worker.listeners.fetch, artwork, 'phone')
  assert.equal(await response.text(), 'tmdb-poster')
  assert.equal(stored.size, 1)
  worker.context.fetch = async () => { throw new Error('Pi offline') }
  response = await dispatchedResponse(worker.listeners.fetch, artwork, 'phone')
  assert.equal(await response.text(), 'tmdb-poster')
})

test('an artwork cache failure never hides a successful network image', async () => {
  const worker = workerContext({ id: 'unused' }, new Map(), {
    open: async () => ({
      add: async () => {}, match: async () => undefined,
      put: async () => { throw new Error('device storage full') },
      keys: async () => [], delete: async () => true,
    }),
  })
  worker.context.fetch = async () => new Response('visible-poster', { status: 200 })
  worker.listeners.message({
    data: { type: 'mabeltv-offline-access', unlocked: true },
    source: { id: 'phone' },
  })
  const response = await dispatchedResponse(worker.listeners.fetch, new Request(
    'https://tv.example.test/api/adult/tmdb-artwork/w500/example.jpg'), 'phone')
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'visible-poster')
})

test('cross-origin artwork falls through to the browser network stack', async () => {
  const worker = workerContext({ id: 'unused' }, new Map())
  const artwork = new Request('https://image.tmdb.org/t/p/w342/example.jpg')
  assert.equal(dispatchedResponse(worker.listeners.fetch, artwork, 'phone'), undefined)
})

function dispatchedResponse(listener, request, clientId = '') {
  let response
  listener({
    request,
    clientId,
    respondWith: value => { response = Promise.resolve(value) },
  })
  return response
}

function offlineClientContext() {
  const records = new Map()
  const messages = []
  const securityStore = {
    get: key => request(records.get(key)),
    put: value => {
      records.set(value.id, structuredClone(value))
      return request(value)
    },
  }
  const database = {
    objectStoreNames: { contains: name => name === 'security' },
    transaction: () => {
      const transaction = { objectStore: () => securityStore }
      queueMicrotask(() => transaction.oncomplete?.())
      return transaction
    },
    close() {},
  }
  const context = vm.createContext({
    Blob, CustomEvent: class {}, Error, Map, TextEncoder, Uint8Array, URL,
    console,
    crypto: webcrypto,
    indexedDB: { open: () => request(database) },
    navigator: {
      serviceWorker: { controller: { postMessage: message => messages.push(message) } },
    },
    window: {
      isSecureContext: true,
      dispatchEvent() {},
    },
  })
  vm.runInContext(offlineSource, context, { filename: 'mabeltv-offline.js' })
  return { context, messages }
}

test('offline media returns exact byte ranges from Blob and legacy ArrayBuffer chunks', async () => {
  const manifest = {
    id: 'film', status: 'complete', size: 12, chunkSize: 4, mimeType: 'video/mp4',
  }
  const legacy = Uint8Array.from([4, 5, 6, 7]).buffer
  const chunks = new Map([
    ['film:0', { data: new Blob([Uint8Array.from([0, 1, 2, 3])]) }],
    ['film:1', { data: legacy }],
    ['film:2', { data: new Blob([Uint8Array.from([8, 9, 10, 11])]) }],
  ])
  const { context } = workerContext(manifest, chunks)

  for (const [range, expected] of [
    ['bytes=0-1', [0, 1]],
    ['bytes=2-9', [2, 3, 4, 5, 6, 7, 8, 9]],
    ['bytes=-3', [9, 10, 11]],
  ]) {
    const response = await context.offlineMediaResponse(new Request(
      'https://tv.example.test/offline-media/film', { headers: { Range: range } },
    ), 'film')
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expected)
    assert.equal(Number(response.headers.get('Content-Length')), expected.length)
  }
})

test('offline media rejects unsatisfiable ranges and exposes worker readiness', async () => {
  const manifest = { id: 'film', status: 'complete', size: 4, chunkSize: 4, mimeType: 'video/mp4' }
  const { context, listeners } = workerContext(manifest, new Map([
    ['film:0', { data: new Blob([Uint8Array.from([0, 1, 2, 3])]) }],
  ]))
  const invalid = await context.offlineMediaResponse(new Request(
    'https://tv.example.test/offline-media/film', { headers: { Range: 'bytes=8-9' } },
  ), 'film')
  assert.equal(invalid.status, 416)
  assert.equal(invalid.headers.get('Content-Range'), 'bytes */4')

  let readiness
  listeners.fetch({
    request: new Request('https://tv.example.test/offline-ready'),
    respondWith: promise => { readiness = Promise.resolve(promise) },
  })
  const ready = await readiness
  assert.equal(ready.status, 200)
  assert.deepEqual(await ready.json(), { ready: true })
})

test('offline client refuses to claim readiness outside a secure context', async () => {
  const context = vm.createContext({
    Blob, CustomEvent: class {}, Error, Map, URL,
    console,
    indexedDB: {},
    navigator: {},
    window: {
      isSecureContext: false,
      dispatchEvent() {},
    },
  })
  vm.runInContext(offlineSource, context, { filename: 'mabeltv-offline.js' })
  await assert.rejects(
    context.window.MabelOffline.initialise(),
    /secure HTTPS address/,
  )
})

test('offline client shares one in-progress worker initialisation', async () => {
  let registrations = 0
  let readinessChecks = 0
  const database = { close() {} }
  const context = vm.createContext({
    Blob, CustomEvent: class {}, Error, Map, Promise, Response, TextEncoder, Uint8Array, URL,
    clearTimeout, console, crypto: webcrypto, setTimeout,
    fetch: async () => {
      readinessChecks += 1
      return new Response(JSON.stringify({ ready: true }), { status: 200 })
    },
    indexedDB: { open: () => request(database) },
    navigator: {
      serviceWorker: {
        controller: { postMessage() {} },
        getRegistration: async () => null,
        register: async () => { registrations += 1; return {} },
        ready: Promise.resolve({}),
      },
    },
    window: { isSecureContext: true, indexedDB: {}, dispatchEvent() {} },
  })
  vm.runInContext(offlineSource, context, { filename: 'mabeltv-offline.js' })

  const first = context.window.MabelOffline.initialise()
  const second = context.window.MabelOffline.initialise()
  assert.strictEqual(first, second)
  await first

  assert.equal(registrations, 1)
  assert.equal(readinessChecks, 1)
})

test('service worker protects adult downloads but leaves family downloads available', async () => {
  const adultManifest = {
    id: 'adult-film', status: 'complete', size: 4, chunkSize: 4,
    mimeType: 'video/mp4', source: { kind: 'adult', file: 'Private Film.mp4' },
  }
  const adultChunks = new Map([
    ['adult-film:0', { data: new Blob([Uint8Array.from([0, 1, 2, 3])]) }],
  ])
  const adultWorker = workerContext(adultManifest, adultChunks)
  const adultRequest = new Request('https://tv.example.test/offline-media/adult-film')

  let response = await dispatchedResponse(adultWorker.listeners.fetch, adultRequest, 'phone')
  assert.equal(response.status, 401)

  adultWorker.listeners.message({
    data: { type: 'mabeltv-offline-access', unlocked: true },
    source: { id: 'phone' },
  })
  response = await dispatchedResponse(adultWorker.listeners.fetch, adultRequest, 'phone')
  assert.equal(response.status, 200)

  adultWorker.listeners.message({
    data: { type: 'mabeltv-offline-access', unlocked: false },
    source: {},
  })
  response = await dispatchedResponse(adultWorker.listeners.fetch, adultRequest, 'phone')
  assert.equal(response.status, 401)

  const familyManifest = {
    id: 'family-film', status: 'complete', size: 4, chunkSize: 4,
    mimeType: 'video/mp4', source: { kind: 'channel', channel: 1, file: 'Film.mp4' },
  }
  const familyWorker = workerContext(familyManifest, new Map([
    ['family-film:0', { data: new Blob([Uint8Array.from([4, 5, 6, 7])]) }],
  ]))
  response = await dispatchedResponse(
    familyWorker.listeners.fetch,
    new Request('https://tv.example.test/offline-media/family-film'),
    'another-phone',
  )
  assert.equal(response.status, 200)
})

test('service worker acknowledges each client access state change', () => {
  const worker = workerContext({ id: 'unused' }, new Map())
  let acknowledgement = null
  worker.listeners.message({
    data: { type: 'mabeltv-offline-access', unlocked: false },
    source: {},
    ports: [{ postMessage: value => { acknowledgement = value } }],
  })
  assert.equal(acknowledgement.type, 'mabeltv-offline-access')
  assert.equal(acknowledgement.unlocked, false)
})

test('offline PIN verifier unlocks protected media without storing the PIN', async () => {
  const { context, messages } = offlineClientContext()

  await context.window.MabelOffline.rememberSecurity(true, '8642')
  const status = await context.window.MabelOffline.securityStatus()
  assert.equal(status.required, true)
  assert.equal(status.configured, true)
  await assert.rejects(
    context.window.MabelOffline.verifyPin('1111'),
    /not correct/,
  )
  await context.window.MabelOffline.verifyPin('8642')
  assert.equal(messages.at(-1)?.type, 'mabeltv-offline-access')
  assert.equal(messages.at(-1)?.unlocked, true)
})
