import { test, expect } from './test-fixtures.mjs'

async function player(page, position = null) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(async explicit => {
    setOfflineProtectedAccess(true)
    library.remote_viewing = { allow_simultaneous: true }
    window.samples = []; window.starts = []; window.failSaves = false
    const networkApi = window.api
    window.api = async (path, options) => {
      const value = JSON.parse(options?.body || '{}')
      if (path === '/api/remote/start') {
        window.starts.push(value)
        return { kind: 'my_tv', library_id: 'film-identity', title: 'Resume film',
          server_time: Date.now() / 1000, resume_position: 900, resume_updated: 100,
          stream_url: `/api/remote/media?stream=test-${window.starts.length}` }
      }
      if (path === '/api/my-tv/progress') {
        window.samples.push(value)
        if (window.failSaves) throw new Error('Network unavailable')
        return { ok: true, applied: true }
      }
      if (path.startsWith('/api/remote/')) return { ok: true }
      return networkApi(path, options)
    }
    const video = document.querySelector('#iosWatchVideo')
    video.load = () => video.onloadedmetadata?.()
    video.play = () => Promise.resolve(); video.pause = () => {}
    video.webkitEnterFullscreen = () => { window.fullscreenRequests = (window.fullscreenRequests || 0) + 1 }
    Object.defineProperty(video, 'src', { configurable: true, get: () => '', set: () => { video.currentTime = 0 } })
    Object.defineProperty(video, 'duration', { configurable: true, value: 7200 })
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 })
    await startIosRemotePlayer({ kind: 'my_tv', file: 'Resume.mp4' }, explicit)
  }, position)
}

test('fresh resume and explicit zero are distinct playback intents', async ({ page }) => {
  await player(page)
  expect(await page.locator('#iosWatchVideo').evaluate(video => video.currentTime)).toBe(900)
  await page.evaluate(async () => { await startIosRemotePlayer({ kind: 'my_tv', file: 'Resume.mp4' }, 0) })
  expect(await page.evaluate(() => window.starts.at(-1).position)).toBe(0)
  expect(await page.locator('#iosWatchVideo').evaluate(video => video.currentTime)).toBe(0)
  expect(await page.evaluate(() => window.samples.some(sample => sample.source.library_id === 'film-identity'))).toBe(true)
})

test('failed saves remain durable and retry without further playback movement', async ({ page }) => {
  await player(page)
  await page.evaluate(async () => {
    window.failSaves = true
    const video = document.querySelector('#iosWatchVideo'); video.currentTime = 1200
    await saveIosRemotePosition(false, true)
  })
  await expect(page.locator('#iosWatchProgressStatus')).toContainText('saved on this device')
  expect(await page.evaluate(async () => (await myTvProgress.read({ kind: 'my_tv', file: 'Resume.mp4' })).pending)).toBe(true)
  await page.evaluate(async () => { window.failSaves = false; await saveIosRemotePosition() })
  expect(await page.evaluate(async () => (await myTvProgress.read({ kind: 'my_tv', file: 'Resume.mp4' })).pending)).toBe(false)
  expect(await page.evaluate(() => window.samples.at(-1).position)).toBe(1200)
  await expect(page.locator('#iosWatchProgressStatus')).toBeHidden()
})

test('a removed title cannot block progress for other films', async ({ page }) => {
  await player(page)
  await page.evaluate(async () => {
    window.failSaves = true
    const video = document.querySelector('#iosWatchVideo'); video.currentTime = 1200
    await saveIosRemotePosition(false, true)
    const previousApi = window.api
    window.failSaves = false
    window.api = (path, options) => {
      const sample = JSON.parse(options?.body || '{}')
      if (path === '/api/my-tv/progress' && sample.source.file === 'Resume.mp4')
        return Promise.reject(Object.assign(new Error('That video is no longer in My TV'), { status: 400 }))
      return previousApi(path, options)
    }
    myTvProgress.begin(video, { kind: 'my_tv', file: 'Another.mp4' })
    video._myTvProgress.ready = true; video.currentTime = 800
    await saveIosRemotePosition(false, true)
  })
  expect(await page.evaluate(async () => (await myTvProgress.read({ kind: 'my_tv', file: 'Another.mp4' })).pending)).toBe(false)
  expect(await page.evaluate(async () => (await myTvProgress.read({ kind: 'my_tv', file: 'Resume.mp4' })).position)).toBe(1200)
})

test('downloaded My TV resumes locally and saves progress while offline', async ({ page }) => {
  await player(page)
  await page.evaluate(async () => {
    const video = document.querySelector('#iosWatchVideo'); video.currentTime = 1350
    await saveIosRemotePosition(false, true)
    window.authoriseOfflineDownload = async () => true
    window.MabelOffline = { ...window.MabelOffline, playbackUrl: () => '/offline-media/fixture' }
    await startOfflinePlayer({ id: 'fixture', title: 'Resume film', protected: true,
      source: { kind: 'my_tv', file: 'Resume.mp4' } })
  })
  expect(await page.locator('#iosWatchVideo').evaluate(video => video.currentTime)).toBe(1350)
  await page.context().setOffline(true)
  await page.evaluate(async () => {
    const video = document.querySelector('#iosWatchVideo'); video.currentTime = 1600
    await saveIosRemotePosition(false, true)
  })
  expect(await page.evaluate(async () => (await myTvProgress.read({ kind: 'my_tv', file: 'Resume.mp4' })).position)).toBe(1600)
  await page.evaluate(() => setOfflineProtectedAccess(false))
  expect(await page.evaluate(async () => await myTvProgress.read({ kind: 'my_tv', file: 'Resume.mp4' }))).toBeNull()
})

test('media reconnection preserves position and native fullscreen has one owner', async ({ page }) => {
  await player(page)
  await page.evaluate(async () => {
    const video = document.querySelector('#iosWatchVideo'); video.currentTime = 1400
    video.onwebkitbeginfullscreen(); video.onplay(); video.onloadedmetadata()
  })
  expect(await page.evaluate(() => window.fullscreenRequests)).toBe(1)
  expect(await page.locator('#iosWatchVideo').evaluate(video => video.controls)).toBe(false)
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo'); video.currentTime = 1400; video.onerror()
  })
  await expect.poll(() => page.evaluate(() => window.starts.length)).toBe(2)
  expect(await page.evaluate(() => window.starts.at(-1).position)).toBe(1400)
  await page.evaluate(() => document.querySelector('#iosWatchVideo').onwebkitendfullscreen())
  expect(await page.locator('#iosWatchVideo').evaluate(video => video.controls)).toBe(true)
  await page.evaluate(() => document.querySelector('#iosWatchVideo').onplay())
  expect(await page.evaluate(() => window.fullscreenRequests)).toBe(1)
})

test('slow media startup offers a retry and clears it once the video is ready', async ({ page }) => {
  await page.clock.install()
  await player(page)
  await page.clock.fastForward(15000)
  await expect(page.locator('#iosWatchRetry')).toBeVisible()
  await expect(page.locator('#iosWatchError')).toContainText('taking longer than expected')
  await page.evaluate(() => document.querySelector('#iosWatchVideo').oncanplay())
  await expect(page.locator('#iosWatchRetry')).toBeHidden()
  await expect(page.locator('#iosWatchError')).toBeHidden()
})

test('playback retry and pending-sync messages remain readable @visual', async ({ page }, testInfo) => {
  await player(page)
  await page.evaluate(async () => {
    window.failSaves = true
    document.querySelector('#iosWatchVideo').currentTime = 1500
    await saveIosRemotePosition(false, true)
  })
  await expect(page.locator('#iosWatchProgressStatus')).toBeVisible()
  await testInfo.attach('pending-progress', { body: await page.screenshot(), contentType: 'image/png' })
  await page.screenshot({ path: '../../work/playback-pending-progress.png' })
  await page.evaluate(() => {
    const message = document.querySelector('#iosWatchError')
    message.textContent = 'The connection took too long. Please try again.'
    message.classList.remove('hidden'); document.querySelector('#iosWatchRetry').classList.remove('hidden')
  })
  await expect(page.locator('#iosWatchRetry')).toBeVisible()
  const error = await page.locator('#iosWatchError').boundingBox()
  const retry = await page.locator('#iosWatchRetry').boundingBox()
  expect(error.y + error.height).toBeLessThan(retry.y)
  await page.screenshot({ path: '../../work/playback-retry.png' })
})
