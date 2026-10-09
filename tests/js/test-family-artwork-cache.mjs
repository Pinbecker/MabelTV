import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

test('Family thumbnail cache distinguishes assets and versions while collapsing retry queries', async () => {
  const stored = new Map(), listeners = {}
  const context = vm.createContext({ URL, Request, Response, Headers, Date, console, importScripts() {},
    self: { location: { origin: 'https://tv.test' }, addEventListener: (name, fn) => { listeners[name] = fn },
      clients: { matchAll: async () => [] } },
    caches: { open: async () => ({ match: async key => stored.get(key)?.clone(),
      put: async (key, value) => stored.set(key, value.clone()), keys: async () => [...stored.keys()], delete: async () => {} }) },
    fetch: async request => new Response(new URL(request.url).searchParams.get('id')),
  })
  vm.runInContext(fs.readFileSync(new URL('../../scripts/pi/mabeltv-offline-schema.js', import.meta.url), 'utf8'), context)
  context.self.MabelOfflineSchema = context.MabelOfflineSchema
  vm.runInContext(fs.readFileSync(new URL('../../scripts/pi/service-worker.js', import.meta.url), 'utf8'), context)
  const get = async query => {
    let result
    listeners.fetch({ request: new Request(`https://tv.test/api/family-media/content?${query}`),
      respondWith: promise => { result = promise }, waitUntil() {} })
    return (await result).text()
  }
  assert.equal(await get('id=one&artwork=1&v=1'), 'one')
  assert.equal(await get('id=two&artwork=1&v=1'), 'two')
  assert.equal(await get('id=one&artwork=1&v=2'), 'one')
  context.fetch = () => { throw new Error('Pi offline') }
  assert.equal(await get('id=one&artwork=1&v=1&retry=1'), 'one')
  assert.equal(stored.size, 3)
  let intercepted = false
  listeners.fetch({ request: new Request('https://tv.test/api/family-media/content?id=one'),
    respondWith: () => { intercepted = true }, waitUntil() {} })
  assert.equal(intercepted, false, 'Full media must not enter thumbnail Cache Storage')
})
