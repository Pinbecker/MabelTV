import { test, expect } from './test-fixtures.mjs'


async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
}

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
