import assert from 'node:assert/strict'
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
