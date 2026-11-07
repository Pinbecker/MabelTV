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
  await expect.poll(() => page.evaluate(() => window.samples.some(sample => sample.source.library_id === 'film-identity'))).toBe(true)
})

test('resume lookup runs alongside the stream request and explicit restart skips that lookup', async ({ page }) => {
  await player(page)
  await page.evaluate(() => {
    const previousApi = window.api
    window.checkpointReads = 0
    myTvProgress.read = async () => { window.checkpointReads++; return null }
    window.api = (path, options) => path === '/api/remote/start'
      ? new Promise(resolve => { window.finishStreamStart = () => resolve(previousApi(path, options)) })
      : previousApi(path, options)
    window.pendingStart = startIosRemotePlayer({ kind: 'my_tv', file: 'Resume.mp4' })
  })
  expect(await page.evaluate(() => window.checkpointReads)).toBe(1)
  await page.evaluate(async () => { window.finishStreamStart(); await window.pendingStart })
  await page.evaluate(() => {
    window.pendingStart = startIosRemotePlayer({ kind: 'my_tv', file: 'Resume.mp4' }, 0)
  })
  expect(await page.evaluate(() => window.checkpointReads)).toBe(1)
  await page.evaluate(async () => { window.finishStreamStart(); await window.pendingStart })
  expect(await page.locator('#iosWatchVideo').evaluate(video => video.currentTime)).toBe(0)
})

test('startup timings identify a media wait without sending filenames or competing with initial loading', async ({ page }) => {
  await page.clock.install()
  const reports = []
  await page.route('**/api/studio/diagnostics', route => {
    reports.push(route.request().postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  await player(page)
  expect(reports).toEqual([])
  await page.clock.fastForward(15000)
  await expect.poll(() => reports.length).toBe(1)
  const first = reports[0].events
  expect(first.map(event => event.code.replace(/-r\d-n\d$/, ''))).toEqual([
    'session-ready', 'resume-ready', 'source-set', 'metadata', 'waiting',
  ])
  expect(first.at(-1).duration).toBeGreaterThanOrEqual(15000)
  expect(first.every(event => event.path === '/api/remote/media' && event.method === 'MEDIA')).toBe(true)
  expect(new Set(first.map(event => event.requestId)).size).toBe(1)
  expect(JSON.stringify(first)).not.toMatch(/Resume\.mp4|film-identity|stream=test/)
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo')
    video.oncanplay(); video.onplaying(); video.onplaying()
  })
  await expect.poll(() => reports.length).toBe(2)
  expect(reports[1].events.map(event => event.code.replace(/-r\d-n\d$/, ''))).toEqual(['can-play', 'playing'])
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
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo')
    const present = bindIosPresentation(video, iosPlayerGeneration)
    video.onwebkitbeginfullscreen(); video.onwebkitendfullscreen()
    present(new Event('play'))
  })
  expect(await page.evaluate(() => window.fullscreenRequests)).toBe(1)
})

test('slow media startup keeps retry visible until playback actually starts', async ({ page }) => {
  await page.clock.install()
  await player(page)
  await page.clock.fastForward(15000)
  await expect(page.locator('#iosWatchRetry')).toBeVisible()
  await expect(page.locator('#iosWatchError')).toContainText('taking longer than expected')
  await page.evaluate(() => document.querySelector('#iosWatchVideo').oncanplay())
  await expect(page.locator('#iosWatchRetry')).toBeVisible()
  await page.evaluate(() => document.querySelector('#iosWatchVideo').onplaying())
  await expect(page.locator('#iosWatchRetry')).toBeHidden()
  await expect(page.locator('#iosWatchError')).toBeHidden()
})

test('iOS recovery keeps Resume visible after metadata and uses its tap without fetching another stream', async ({ page }) => {
  await player(page)
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 1400; video.onplaying()
    window.resumePlays = []
    const retry = document.querySelector('#iosWatchRetry'), onRetry = retry.onclick
    retry.onclick = event => {
      window.insideResumeTap = true
      try { return onRetry(event) } finally { window.insideResumeTap = false }
    }
    video.play = () => {
      window.resumePlays.push({ insideTap: !!window.insideResumeTap, position: video.currentTime })
      if (!window.insideResumeTap) return Promise.reject(new DOMException('A tap is required', 'NotAllowedError'))
      video.onplay(); video.onplaying(); return Promise.resolve()
    }
    video.onerror()
  })
  await expect(page.locator('#iosWatchRetry')).toHaveText('Resume playback')
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo')
    video.onloadedmetadata(); video.oncanplay()
  })
  await expect(page.locator('#iosWatchRetry')).toBeVisible()
  await expect(page.locator('#iosWatchError')).toHaveText('Ready to continue.')
  await page.locator('#iosWatchRetry').click()
  await expect(page.locator('#iosWatchRetry')).toBeHidden()
  expect(await page.evaluate(() => window.starts.length)).toBe(2)
  expect(await page.evaluate(() => window.resumePlays.at(-1))).toEqual({ insideTap: true, position: 1400 })
})

test('resuming after a long pause renews the stream and retains the new play intent', async ({ page }) => {
  await page.clock.install()
  await player(page)
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 1680; video.onplaying(); video.onpause()
    clearInterval(iosRemoteHeartbeatTimer)
    window.resumePlays = 0
    video.play = () => { window.resumePlays++; video.onplaying(); return Promise.resolve() }
  })
  await page.clock.fastForward(180000)
  await page.evaluate(() => document.querySelector('#iosWatchVideo').onplay())
  await expect.poll(() => page.evaluate(() => window.starts.length)).toBe(2)
  await expect.poll(() => page.evaluate(() => window.resumePlays)).toBe(1)
  expect(await page.evaluate(() => window.starts.at(-1).position)).toBe(1680)
  await expect(page.locator('#iosWatchError')).toBeHidden()
})

test('returning to an expired paused stream prepares the same position without autoplay', async ({ page }) => {
  await page.clock.install()
  await player(page)
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 1725; video.onplaying(); video.onpause()
    clearInterval(iosRemoteHeartbeatTimer)
    const previousApi = window.api
    window.api = (path, options) => path === '/api/remote/heartbeat'
      ? Promise.reject(Object.assign(new Error('Session expired'), { status: 400 })) : previousApi(path, options)
    window.resumePlays = 0
    video.play = () => { window.resumePlays++; return Promise.resolve() }
  })
  await page.clock.fastForward(180000)
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
  await expect.poll(() => page.evaluate(() => window.starts.length)).toBe(2)
  expect(await page.evaluate(() => window.starts.at(-1).position)).toBe(1725)
  expect(await page.locator('#iosWatchVideo').evaluate(video => video.currentTime)).toBe(1725)
  expect(await page.evaluate(() => window.resumePlays)).toBe(0)
})

test('a failed iOS resource resetting currentTime cannot replace the bookmark with zero', async ({ page }) => {
  await player(page)
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 1900; video.onplaying(); video.dispatchEvent(new Event('timeupdate'))
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 2 } })
    video.currentTime = 0; video.onerror()
  })
  await expect.poll(() => page.evaluate(() => window.starts.length)).toBe(2)
  expect(await page.evaluate(() => window.starts.at(-1).position)).toBe(1900)
  expect(await page.evaluate(() => window.samples.some(sample => sample.position === 0))).toBe(false)
})

test('a stalled resume reconnects once even without a media error event', async ({ page }) => {
  await page.clock.install()
  await player(page)
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 2100; video.onplaying(); video.onpause(); video.onplay()
    video.dispatchEvent(new Event('waiting'))
  })
  await page.clock.fastForward(8000)
  await expect.poll(() => page.evaluate(() => window.starts.length)).toBe(2)
  expect(await page.evaluate(() => window.starts.at(-1).position)).toBe(2100)
  await page.clock.fastForward(16000)
  await expect(page.locator('#iosWatchRetry')).toBeEnabled()
  expect(await page.evaluate(() => window.starts.length)).toBe(2)
})

test('closing during reconnection discards the late response and does not revive the player', async ({ page }) => {
  await player(page)
  await page.evaluate(() => {
    const previousApi = window.api
    window.api = (path, options) => path === '/api/remote/start'
      ? new Promise(resolve => { window.finishRecovery = () => resolve(previousApi(path, options)) }) : previousApi(path, options)
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 2000; video.onplaying(); video.onerror()
  })
  await expect.poll(() => page.evaluate(() => typeof window.finishRecovery)).toBe('function')
  await page.evaluate(() => closeIosRemotePlayer({ fromHistory: true }))
  await page.evaluate(async () => { window.finishRecovery(); await Promise.resolve() })
  await expect(page.locator('#iosWatchPlayer')).toBeHidden()
  expect(await page.evaluate(() => iosRemoteSession)).toBeNull()
})

test('a timed-out reconnect cannot replace a newer retry when its response arrives late', async ({ page }) => {
  await page.clock.install()
  await player(page)
  await page.evaluate(() => {
    const previousApi = window.api
    window.pendingRecoveryResponses = []
    window.api = (path, options) => path === '/api/remote/start'
      ? previousApi(path, options).then(result => new Promise(resolve => {
        window.pendingRecoveryResponses.push(() => resolve(result))
      })) : previousApi(path, options)
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 2050; video.onplaying(); video.onerror()
  })
  await page.clock.fastForward(16000)
  await page.locator('#iosWatchRetry').click()
  await expect.poll(() => page.evaluate(() => window.pendingRecoveryResponses.length)).toBe(2)
  await page.evaluate(() => window.pendingRecoveryResponses[1]())
  await expect.poll(() => page.evaluate(() => iosRemoteSession)).toBe('test-3')
  await page.evaluate(() => window.pendingRecoveryResponses[0]())
  expect(await page.evaluate(() => iosRemoteSession)).toBe('test-3')
  expect(await page.locator('#iosWatchVideo').evaluate(video => video.currentTime)).toBe(2050)
})

test('reconnection renews subtitle URLs and retains the selected subtitle state', async ({ page }) => {
  await player(page)
  await page.evaluate(() => {
    const previousApi = window.api
    window.api = async (path, options) => {
      const result = await previousApi(path, options)
      return path === '/api/remote/start' ? { ...result, subtitle_url: '/renewed-subtitles.vtt' } : result
    }
    const video = document.querySelector('#iosWatchVideo'), track = document.createElement('track')
    track.kind = 'subtitles'; track.src = '/expired-subtitles.vtt'
    video.append(track); track.track.mode = 'showing'
    video.currentTime = 1600; video.onplaying(); video.onerror()
  })
  await expect.poll(() => page.evaluate(() => window.starts.length)).toBe(2)
  await page.evaluate(() => document.querySelector('#iosWatchVideo').oncanplay())
  expect(await page.locator('#iosWatchVideo track').count()).toBe(1)
  await expect(page.locator('#iosWatchVideo track')).toHaveAttribute('src', '/renewed-subtitles.vtt')
  expect(await page.locator('#iosWatchVideo track').evaluate(track => track.track.mode)).toBe('showing')
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
  await page.evaluate(() => {
    const video = document.querySelector('#iosWatchVideo')
    video.onplaying()
    video.play = () => Promise.reject(new DOMException('A tap is required', 'NotAllowedError'))
    video.onerror()
  })
  await expect(page.locator('#iosWatchRetry')).toHaveText('Resume playback')
  await expect(page.locator('#iosWatchError')).toHaveText('Ready to continue.')
  await page.screenshot({ path: '../../work/playback-resume-tap.png' })
})
