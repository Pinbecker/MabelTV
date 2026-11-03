import { test, expect } from './test-fixtures.mjs'


async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
}

function localSeries() {
  return {
    id: 'fixture-series', title: 'Fixture Series', metadata: {},
    episode_count: 3, episodes: [
      { season: 1, episode: 1, path: 'Season 1/Episode 1.mp4',
        display_name: 'A very long episode title that needs its own space',
        browser_ready: true, watched: false },
      { season: 1, episode: 2, path: 'Season 1/Episode 2.mp4',
        display_name: 'The second episode', browser_ready: true, watched: false },
      { season: 2, episode: 1, path: 'Season 2/Episode 1.mp4',
        display_name: 'A new series begins', browser_ready: true, watched: false },
    ],
  }
}

async function openDeviceEpisode(page) {
  await openPortal(page)
  await page.evaluate(async series => {
    library.my_tv_series = [series]
    setOfflineProtectedAccess(true)
    library.remote_viewing = { allow_simultaneous: true }
    window.__episodeRequests = []
    const networkApi = window.api
    window.api = async (path, options) => {
      if (path.startsWith('/api/remote/') || path === '/api/my-tv/progress') {
        const body = JSON.parse(options?.body || '{}')
        window.__episodeRequests.push({ path, body })
        if (path === '/api/remote/start') {
          const index = series.episodes.findIndex(value => value.path === body.file)
          return { kind: 'my-tv-series', title: series.episodes[index].display_name,
            stream_url: `/api/remote/media?stream=episode-${index + 1}`, resume_position: 0 }
        }
        return { ok: true }
      }
      return networkApi(path, options)
    }
    const video = document.querySelector('#iosWatchVideo')
    video.load = () => { if (video._myTvProgress) video.onloadedmetadata?.() }
    video.play = () => Promise.resolve()
    video.pause = () => {}
    video.webkitEnterFullscreen = () => {}
    video.webkitExitFullscreen = () => {}
    Object.defineProperty(video, 'src', { configurable: true, get: () => '', set: () => {} })
    Object.defineProperty(video, 'duration', { configurable: true, value: 1800 })
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 })
    await startIosRemotePlayer({ kind: 'my-tv-series', series: series.id,
      file: series.episodes[0].path, position: 0 })
  }, localSeries())
}

test('My TV Continue watching offers the following episode after completion', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(series => {
    library.my_tv_library = []
    library.my_tv_series = [series]
    openView('my-tv-home')
    series.episodes[0].watched = true
    series.episodes[0].remote_last_watched = 2_000_000_000
    renderMyTvHomeContinue()
  }, localSeries())
  const rail = page.locator('#myTvHomeContinueRail')
  await expect(rail.locator('.watch-continue-card')).toHaveCount(1)
  await expect(rail).toContainText('Next episode · Fixture Series')
  await expect(rail).toContainText('The second episode')
  await rail.locator('.watch-continue-card').click()
  await expect(page.locator('#myTvEpisodeTitle')).toHaveText('The second episode')
  await page.evaluate(() => {
    closeMyTvEpisodeSheet(false)
    const series = library.my_tv_series[0]
    series.episodes[2].watched = true
    renderMyTvHomeContinue()
  })
  await expect(page.locator('#myTvHomeContinueSection')).toBeHidden()
})

test('My TV series continuation prioritises a live bookmark over completed episodes', async ({ page }) => {
  await openPortal(page)
  const result = await page.evaluate(series => {
    library.my_tv_series = [series]
    series.episodes[0].watched = true
    Object.assign(series.episodes[1], { remote_position: 420,
      remote_duration: 1800, remote_last_watched: 2_000_000_000 })
    return myTvSeriesContinueEntries()
  }, localSeries())
  expect(result).toHaveLength(1)
  expect(result[0].nextEpisode).toBe(false)
  expect(result[0].episode.path).toBe('Season 1/Episode 2.mp4')
  const replay = await page.evaluate(() => {
    const episode = library.my_tv_series[0].episodes[1]
    episode.watched = true
    episode.watched_updated = 1_900_000_000
    return myTvSeriesContinueEntries()
  })
  expect(replay[0].nextEpisode).toBe(false)
  expect(replay[0].episode.path).toBe('Season 1/Episode 2.mp4')
})

test('My TV device episode completes, offers a cancellable handoff and advances across series', async ({ page }) => {
  await openDeviceEpisode(page)
  await page.evaluate(async () => {
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 1800
    await video.onended()
  })
  await expect(page.locator('#iosWatchNextHint')).toHaveText('Next episode starts in 8s')
  await page.locator('#iosWatchNextCancel').click()
  await expect(page.locator('#iosWatchNextHint')).toHaveText('Next episode is ready when you are')
  await page.locator('#iosWatchNextPlay').click()
  await expect(page.locator('#iosWatchTitle')).toHaveText('The second episode')
  await expect(page.locator('#iosWatchNextContext')).toHaveText('Series 2, Episode 1')
  const requests = await page.evaluate(() => window.__episodeRequests)
  expect(requests.filter(value => value.path === '/api/remote/start').map(value => value.body.file))
    .toEqual(['Season 1/Episode 1.mp4', 'Season 1/Episode 2.mp4'])
  expect(requests.find(value => value.path === '/api/my-tv/progress' && value.body.finished).body)
    .toMatchObject({ source: { kind: 'my-tv-series', file: 'Season 1/Episode 1.mp4' }, position: 1800, duration: 1800, finished: true })
})

test('My TV device handoff saves an unfinished episode and Back cancels pending autoplay', async ({ page }) => {
  await openDeviceEpisode(page)
  await page.clock.install()
  await page.evaluate(() => { document.querySelector('#iosWatchVideo').currentTime = 600 })
  await page.locator('#iosWatchNextPlay').click()
  await expect(page.locator('#iosWatchTitle')).toHaveText('The second episode')
  expect(await page.evaluate(() => window.__episodeRequests.find(value =>
    value.path === '/api/my-tv/progress' && value.body.position === 600).body.position)).toBe(600)
  await page.evaluate(async () => {
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 1800
    await video.onended()
    closeIosRemotePlayer({ fromHistory: true })
  })
  await page.clock.fastForward(10_000)
  await expect(page.locator('#iosWatchPlayer')).toBeHidden()
  expect(await page.evaluate(() => window.__episodeRequests.filter(value =>
    value.path === '/api/remote/start').length)).toBe(2)
})

test('My TV device automatically advances once and stops at the last episode', async ({ page }) => {
  await openDeviceEpisode(page)
  await page.clock.install()
  await page.evaluate(async () => {
    const video = document.querySelector('#iosWatchVideo')
    video.currentTime = 1800
    await video.onended()
    await video.onended()
  })
  await page.clock.fastForward(8_000)
  await expect(page.locator('#iosWatchTitle')).toHaveText('The second episode')
  expect(await page.evaluate(() => window.__episodeRequests.filter(value =>
    value.path === '/api/remote/start').length)).toBe(2)
  await page.locator('#iosWatchNextPlay').click()
  await expect(page.locator('#iosWatchTitle')).toHaveText('A new series begins')
  await expect(page.locator('#iosWatchNext')).toBeHidden()
  await page.evaluate(async () => { await document.querySelector('#iosWatchVideo').onended() })
  await page.clock.fastForward(10_000)
  await expect(page.locator('#iosWatchContext')).toHaveText('Fixture Series · Last episode finished')
  expect(await page.evaluate(() => window.__episodeRequests.filter(value =>
    value.path === '/api/remote/start').length)).toBe(3)
})

test('My TV does not advance when saving completion fails or the next file needs VLC', async ({ page }) => {
  await openDeviceEpisode(page)
  await page.clock.install()
  await page.evaluate(async () => {
    const video = document.querySelector('#iosWatchVideo')
    const apiBeforeFailure = window.api
    window.__openPlaybackDb = indexedDB.open.bind(indexedDB)
    indexedDB.open = () => { throw new Error('Storage unavailable') }
    window.api = (path, options) => path === '/api/my-tv/progress'
      ? Promise.reject(new Error('Progress could not be saved')) : apiBeforeFailure(path, options)
    video.currentTime = 1800
    await video.onended()
  })
  await expect(page.locator('#iosWatchNextHint')).toContainText('Could not save your progress')
  await page.clock.fastForward(10_000)
  expect(await page.evaluate(() => window.__episodeRequests.filter(value =>
    value.path === '/api/remote/start').length)).toBe(1)
  await page.evaluate(async () => {
    const video = document.querySelector('#iosWatchVideo')
    indexedDB.open = window.__openPlaybackDb
    window.api = async path => path === '/api/my-tv/progress' ? { ok: true } : {}
    video._myTvEpisode.ended = false
    video._myTvEpisode.next.browser_ready = false
    await video.onended()
  })
  await expect(page.locator('#iosWatchNextHint')).toHaveText('Next episode is ready in VLC')
  await expect(page.locator('#iosWatchNextCancel')).toBeHidden()
})

test('Closing My TV while its stream is starting prevents a late player reopening', async ({ page }) => {
  await openDeviceEpisode(page)
  await page.evaluate(() => {
    const before = window.api
    window.api = (path, options) => path === '/api/remote/start'
      ? new Promise(resolve => { window.__finishStarting = resolve }) : before(path, options)
    window.__pendingStart = startIosRemotePlayer({ kind: 'my-tv-series', series: 'fixture-series',
      file: 'Season 1/Episode 2.mp4', position: 0 })
  })
  await page.locator('#iosWatchBack').click()
  await expect(page.locator('#iosWatchPlayer')).toBeHidden()
  await page.evaluate(async () => {
    window.__finishStarting({ kind: 'my-tv-series', title: 'A late episode',
      stream_url: '/api/remote/media?stream=late-episode' })
    await window.__pendingStart
  })
  await expect(page.locator('#iosWatchPlayer')).toBeHidden()
  await expect(page.locator('#iosWatchTitle')).not.toHaveText('A late episode')
})

test('My TV player header separates Back and the episode title @visual', async ({ page }, testInfo) => {
  await openDeviceEpisode(page)
  const back = await page.locator('#iosWatchBack').boundingBox()
  const title = await page.locator('#iosWatchTitle').boundingBox()
  expect(title.x - (back.x + back.width)).toBeGreaterThanOrEqual(16)
  await testInfo.attach('my-tv-device-player', {
    body: await page.screenshot({ path: `../../work/my-tv-device-player-${testInfo.project.name}.png` }),
    contentType: 'image/png',
  })
})

function titleDetail() {
  return {
    key: 'tv:6001', media_type: 'tv', tmdb_id: 6001,
    title: 'Fixture Series', year: '2026', first_air_date: '2026-01-02',
    overview: 'A complete metadata-first series catalogue.', genres: ['Drama'],
    directors: ['Jane Creator'], poster_path: '', backdrop_path: '',
    providers: [{ provider_id: 8, name: 'Netflix', type: 'flatrate', label: 'Stream' }],
    seasons: [{ number: 1, name: 'Series 1', episodes: 3, watched_count: 0, poster_path: '' }],
    on_mabeltv: true, viewing: {}, local: { kind: 'series', series: 'fixture-series' },
  }
}

function seasonDetail() {
  return {
    key: 'tv:6001', season: 1, name: 'Series 1', overview: 'Official episodes.',
    poster_path: '', episodes: Array.from({ length: 3 }, (_, index) => ({
      number: index + 1, name: `Official episode ${index + 1}`,
      air_date: `2026-01-0${index + 1}`, runtime: 48,
      overview: '', still_path: '', watched: false,
    })),
  }
}

test('My TV home cards load availability and open local episodes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine covers the My TV home route')
  await page.route(url => new URL(url).pathname === '/api/my-tv/home/availability', async route => {
    const payload = route.request().postDataJSON()
    await route.fulfill({ json: { region: 'GB', items: payload.titles.map(title => ({
      key: `${title.media_type}:${Number(title.tmdb_id)}`, providers: [], available: true,
      sources: [{ source_id: 407, name: 'All 4', type: 'free',
        web_url: 'https://www.channel4.com/programmes/title' }],
    })) } })
  })
  await page.route(url => new URL(url).pathname === '/api/my-tv/title', route =>
    route.fulfill({ json: titleDetail() }))
  await page.route(url => new URL(url).pathname === '/api/my-tv/season', route =>
    route.fulfill({ json: seasonDetail() }))
  await page.route(url => new URL(url).pathname === '/api/my-tv/providers', route =>
    route.fulfill({ json: { key: 'tv:6001', sources: [
      { source_id: 8, name: 'Netflix', type: 'sub', web_url: 'https://www.netflix.com/title/6001' },
      { source_id: 349, name: 'AppleTV', type: 'rent', price: 3.49,
        web_url: 'https://tv.apple.com/gb/show/6001' },
    ] } }))
  await openPortal(page)
  await page.evaluate(() => openView('my-tv-home'))
  await expect(page.locator('#myTvHomeForYou .my-tv-explore-card')).toHaveCount(8)
  await page.evaluate(() => {
    library.my_tv_library = [{
      path: 'Fixture Film/Fixture Film.mp4', title: 'A long fixture film title',
      browser_ready: true, remote_position: 600, remote_duration: 3600,
      remote_last_watched: 2_000_000_000, metadata: { title: 'A long fixture film title' },
    }]
    renderMyTvHomeContinue()
  })
  const continueCard = page.locator('#myTvHomeContinueRail .watch-continue-card')
  await expect(continueCard).toBeVisible()
  expect((await continueCard.boundingBox()).width).toBeLessThanOrEqual(225)
  await expect(continueCard.locator('.watch-continue-copy i')).toHaveCount(0)
  for (const root of ['#myTvHomeForYou', '#myTvHomeReleased', '#myTvHomeDifferent']) {
    await expect(page.locator(`${root} .my-tv-provider-strip img[title="Channel 4"]`).first())
      .toBeVisible()
  }
  await page.evaluate(() => {
    library.my_tv_series = [{
      id: 'fixture-series', title: 'Fixture Series',
      metadata: { tmdb_id: 6001, title: 'Fixture Series' },
      seasons: [1], season_count: 1, episode_count: 1, watched_count: 0,
      episodes: [{ season: 1, episode: 1, path: 'Season 1/Episode 1.mp4',
        display_name: 'Official episode 1', watched: false, browser_ready: true }],
    }]
    document.querySelector('#myTvHomeForYouSection').classList.remove('hidden')
    document.querySelector('#myTvHomeForYou').replaceChildren(myTvExploreCard({
      key: 'tv:6001', media_type: 'tv', tmdb_id: 6001,
      title: 'Fixture Series', year: '2026', on_mabeltv: true,
    }, { context: 'my-tv-home' }))
  })

  await page.locator('#myTvHomeForYou .my-tv-explore-open-art').click()
  await expect(page.locator('#myTvProviderList .provider-netflix')).toBeVisible()
  await expect(page.locator('#myTvTitleRentBuyToggle')).toContainText('From £3.49')
  await page.locator('#myTvTitleSeasons [data-season="1"]').click()
  await page.locator('#myTvTitleSeasonEpisodes [data-episode="1"]').click()
  await expect(page.locator('#myTvEpisodeSheet')).toBeVisible()
  await expect(page.locator('#myTvEpisodeTv')).toBeVisible()
  await expect(page.locator('#myTvEpisodeHere')).toBeVisible()
  await expect(page.locator('#myTvEpisodeWatched')).toHaveCount(0)
  await expect(page.locator('#myTvEpisodeViewSeries')).toBeHidden()
  await expect(page.locator('#myTvEpisodeDownload')).toHaveClass(/sheet-download-trigger/)
  await expect(page.locator('#myTvEpisodeSheet .sheet-action-divider')).toBeVisible()
  await page.locator('#myTvEpisodeClose').click()
  await expect(page.locator('#myTvTitleSeasonSheet')).toBeVisible()
  expect(await page.locator('#myTvTitleSeasonEpisodes [data-episode="1"]')
    .evaluate(row => row.matches(':focus-visible'))).toBe(false)
})

test('opened series seasons survive a cold portal reload in the device cache', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-webkit', 'iPhone WebKit owns the installed-PWA contract')
  const openSeason = async () => {
    await page.evaluate(() => openMyTvTitle({
      key: 'tv:6001', media_type: 'tv', tmdb_id: 6001,
      title: 'Fixture Series', year: '2026',
    }))
    await expect(page.locator('#myTvTitleSeasons [data-season="1"]')).toBeVisible()
    await page.locator('#myTvTitleSeasons [data-season="1"]').click()
  }

  await openPortal(page)
  await page.evaluate(() => window.MabelAppCache.remove('my-tv-season-v1:6001:1'))
  await openSeason()
  await expect(page.locator('#myTvTitleSeasonEpisodes .my-tv-series-episode')).toHaveCount(3)
  await expect.poll(() => page.evaluate(async () =>
    Boolean((await window.MabelAppCache.read('my-tv-season-v1:6001:1'))?.data)))
    .toBe(true)

  await page.reload()
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    const networkApi = window.api
    window.__seasonRequests = 0
    window.api = (path, options) => {
      if (path.startsWith('/api/my-tv/season?')) {
        window.__seasonRequests += 1
        return Promise.reject(new Error('The season network response is deliberately unavailable'))
      }
      return networkApi(path, options)
    }
  })
  await openSeason()
  await expect(page.locator('#myTvTitleSeasonEpisodes .my-tv-series-episode'))
    .toHaveCount(3, { timeout: 1000 })
  expect(await page.evaluate(() => window.__seasonRequests)).toBe(0)
})
