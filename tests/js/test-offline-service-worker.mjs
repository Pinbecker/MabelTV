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

function workerContext(manifest, chunks) {
  const listeners = {}
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
    caches: {},
    self: {
      location: { origin: 'https://tv.example.test' },
      addEventListener: (name, listener) => { listeners[name] = listener },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
  })
  vm.runInContext(workerSource, context, { filename: 'service-worker.js' })
  return { context, listeners }
}

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
