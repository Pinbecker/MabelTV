'use strict'

const SHELL_CACHE = 'mabeltv-shell-v7'
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/mabeltv-offline.js',
  '/portal/css/tokens.css',
  '/portal/css/base.css',
  '/portal/css/components.css',
  '/portal/css/shell.css',
  '/portal/css/home.css',
  '/portal/css/live.css',
  '/portal/css/watch.css',
  '/portal/css/management.css',
  '/portal/css/usb.css',
  '/portal/css/settings.css',
  '/portal/css/responsive.css',
  '/portal/icons.svg',
  '/portal/js/core.js',
  '/portal/js/library.js',
  '/portal/js/playback.js',
  '/portal/js/actions.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png',
]
const DB_NAME = 'mabeltv-offline-v1'
const DB_VERSION = 1

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Offline storage failed'))
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
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Offline storage failed'))
  })
}

async function storedDownload(id) {
  const database = await openDatabase()
  try {
    return await requestResult(database.transaction('downloads').objectStore('downloads').get(id))
  } finally { database.close() }
}

async function storedChunk(id, index) {
  const database = await openDatabase()
  try {
    return await requestResult(database.transaction('chunks').objectStore('chunks').get(`${id}:${index}`))
  } finally { database.close() }
}

function parseRange(value, size) {
  if (!value) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match) return null
  let start
  let end
  if (!match[1] && match[2]) {
    const suffix = Number(match[2])
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = match[1] ? Number(match[1]) : 0
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end < start) return null
  return { start, end: Math.min(end, size - 1), partial: true }
}

async function offlineMediaResponse(request, id) {
  const manifest = await storedDownload(id)
  if (!manifest || manifest.status !== 'complete') {
    return new Response('That download is not complete', { status: 404 })
  }
  const range = parseRange(request.headers.get('Range'), Number(manifest.size))
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${manifest.size}`, 'Accept-Ranges': 'bytes' },
    })
  }
  const length = range.end - range.start + 1
  const headers = new Headers({
    'Content-Type': manifest.mimeType || 'video/mp4',
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
    'Content-Disposition': 'inline',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (range.partial) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${manifest.size}`)
  if (request.method === 'HEAD') {
    return new Response(null, { status: range.partial ? 206 : 200, headers })
  }
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let position = range.start
        while (position <= range.end) {
          const index = Math.floor(position / manifest.chunkSize)
          const chunk = await storedChunk(id, index)
          if (!chunk?.data) throw new Error(`Offline video part ${index + 1} is missing`)
          const bytes = new Uint8Array(chunk.data)
          const chunkStart = index * manifest.chunkSize
          const from = Math.max(0, position - chunkStart)
          const to = Math.min(bytes.byteLength, range.end - chunkStart + 1)
          controller.enqueue(bytes.slice(from, to))
          position = chunkStart + to
        }
        controller.close()
      } catch (error) { controller.error(error) }
    },
  })
  return new Response(stream, { status: range.partial ? 206 : 200, headers })
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== SHELL_CACHE).map(key => caches.delete(key)))),
    self.clients.claim(),
  ]))
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/offline-media/')) {
    const id = decodeURIComponent(url.pathname.slice('/offline-media/'.length))
    event.respondWith(offlineMediaResponse(event.request, id).catch(() => new Response('Offline video unavailable', { status: 500 })))
    return
  }
  if (url.pathname.startsWith('/offline-subtitles/')) {
    const id = decodeURIComponent(url.pathname.slice('/offline-subtitles/'.length).replace(/\.vtt$/, ''))
    event.respondWith(storedDownload(id).then(manifest => manifest?.subtitles
      ? new Response(manifest.subtitles, { headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' } })
      : new Response('No offline subtitles', { status: 404 })))
    return
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put('/', response.clone()))
      return response
    }).catch(() => caches.match('/')))
    return
  }
  if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(event.request, response.clone()))
      return response
    }).catch(() => caches.match(event.request)))
  }
})
