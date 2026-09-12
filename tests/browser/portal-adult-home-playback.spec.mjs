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

test('Adult TV home cards load availability and open local episodes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine covers the Adult TV home route')
  await page.route(url => new URL(url).pathname === '/api/adult/title', route =>
    route.fulfill({ json: titleDetail() }))
  await page.route(url => new URL(url).pathname === '/api/adult/season', route =>
    route.fulfill({ json: seasonDetail() }))
  await page.route(url => new URL(url).pathname === '/api/adult/providers', route =>
    route.fulfill({ json: { key: 'tv:6001', sources: [
      { source_id: 8, name: 'Netflix', type: 'sub', web_url: 'https://www.netflix.com/title/6001' },
      { source_id: 349, name: 'AppleTV', type: 'rent', price: 3.49,
        web_url: 'https://tv.apple.com/gb/show/6001' },
    ] } }))
  await openPortal(page)
  await page.evaluate(() => openView('adult-home'))
  await expect(page.locator('#adultHomeForYou .adult-explore-card')).toHaveCount(8)
  await page.evaluate(() => {
    library.adult_series = [{
      id: 'fixture-series', title: 'Fixture Series',
      metadata: { tmdb_id: 6001, title: 'Fixture Series' },
      seasons: [1], season_count: 1, episode_count: 1, watched_count: 0,
      episodes: [{ season: 1, episode: 1, path: 'Season 1/Episode 1.mp4',
        display_name: 'Official episode 1', watched: false, browser_ready: true }],
    }]
    document.querySelector('#adultHomeForYouSection').classList.remove('hidden')
    document.querySelector('#adultHomeForYou').replaceChildren(adultExploreCard({
      key: 'tv:6001', media_type: 'tv', tmdb_id: 6001,
      title: 'Fixture Series', year: '2026', on_mabeltv: true,
    }, { context: 'adult-home' }))
  })

  await page.locator('#adultHomeForYou .adult-explore-open-art').click()
  await expect(page.locator('#adultProviderList .provider-netflix')).toBeVisible()
  await expect(page.locator('#adultTitleRentBuyToggle')).toContainText('From £3.49')
  await page.locator('#adultTitleSeasons [data-season="1"]').click()
  await page.locator('#adultTitleSeasonEpisodes [data-episode="1"]').click()
  await expect(page.locator('#adultEpisodeSheet')).toBeVisible()
  await expect(page.locator('#adultEpisodeTv')).toBeVisible()
  await expect(page.locator('#adultEpisodeHere')).toBeVisible()
  await expect(page.locator('#adultEpisodeWatched')).toHaveCount(0)
  await expect(page.locator('#adultEpisodeViewSeries')).toBeHidden()
  await expect(page.locator('#adultEpisodeDownload')).toHaveClass(/sheet-download-trigger/)
  await expect(page.locator('#adultEpisodeSheet .sheet-action-divider')).toBeVisible()
  await page.locator('#adultEpisodeClose').click()
  await expect(page.locator('#adultTitleSeasonSheet')).toBeVisible()
  expect(await page.locator('#adultTitleSeasonEpisodes [data-episode="1"]')
    .evaluate(row => row.matches(':focus-visible'))).toBe(false)
})
