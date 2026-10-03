import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts?.ready)
}

test('Home retains Continue watching cards when returning from Mabel TV', async ({ page }) => {
  await openPortal(page)
  await expect(page.locator('#homeContinueTitle')).toHaveText('Continue watching')
  await page.locator('#homeContinueRail .watch-continue-card').first().waitFor()
  await page.evaluate(() => {
    window.__homeContinueCard = document.querySelector('#homeContinueRail .watch-continue-card')
  })
  const home = await page.locator('#homeMabelQueueOpen').evaluate(button => ({
    rect: button.getBoundingClientRect().toJSON(), font: getComputedStyle(button).fontSize,
    countFont: getComputedStyle(document.querySelector('#homeContinueCount')).fontSize,
  }))
  await page.locator('[data-view-button="watch"]').click()
  const watch = await page.locator('#watchMabelQueueOpen').evaluate(button => ({
    rect: button.getBoundingClientRect().toJSON(), font: getComputedStyle(button).fontSize,
    countFont: getComputedStyle(document.querySelector('#watchMabelContinueCount')).fontSize,
  }))
  expect(watch).toEqual(home)
  await page.locator('[data-view-button="overview"]').click()
  expect(await page.evaluate(() => window.__homeContinueCard ===
    document.querySelector('#homeContinueRail .watch-continue-card'))).toBe(true)
  await page.evaluate(() => {
    library.channels[0].programmes[0].remote_position = 900
    renderHomeLibrary()
  })
  await expect(page.locator('#homeContinueRail').getByRole('button', { name: 'Resume Snowy Adventure at 15m' })).toBeVisible()
})

test('Mabel TV film metadata works without opening Settings first', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone covers the metadata action')
  await page.route('**/api/tmdb/status', route =>
    route.fulfill({ json: { configured: true, provider: 'TMDB' } }))
  let searchedFilm = null
  await page.route('**/api/tmdb/programme', async route => {
    searchedFilm = route.request().postDataJSON()
    await route.fulfill({ json: { ok: true, query: 'Snowy Adventure', results: [] } })
  })
  await openPortal(page)
  await page.evaluate(() => {
    const channel = library.channels.find(value => value.content_type === 'films')
    openWatchProgrammeSheet(channel, channel.programmes[0])
  })
  await page.locator('#watchProgrammeMore').click()
  await expect(page.locator('#watchProgrammeMetadata')).toBeEnabled()
  await page.locator('#watchProgrammeMetadata').click()
  await expect(page.locator('#tmdbDialogTitle')).toHaveText('Match “Snowy Adventure”')
  expect(searchedFilm).toEqual({ channel: 1, file: 'Snowy Adventure.mp4' })
})

test('Mabel TV film More offers removal from Continue Watching', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers the shared menu action')
  await openPortal(page)
  await page.evaluate(() => {
    window.__clearRequests = []
    window.api = async (path, options = {}) => {
      if (path !== '/api/remote/clear-position') throw new Error(`Unexpected request: ${path}`)
      window.__clearRequests.push(JSON.parse(options.body))
      return { ok: true, kind: 'channel' }
    }
    const channel = library.channels.find(value => value.content_type === 'films')
    renderMabelDiscovery(mabelFilmEntries())
    openWatchProgrammeSheet(channel, channel.programmes[0], 'continue')
  })
  const beforeRemoval = await page.locator('#watchMabelContinueRail .watch-continue-item').count()
  expect(beforeRemoval).toBeGreaterThan(0)
  await page.locator('#watchProgrammeMore').click()
  await expect(page.locator('#watchProgrammeRemoveProgress')).toBeVisible()
  await page.locator('#watchProgrammeRemoveProgress').click()
  await expect.poll(() => page.evaluate(() => window.__clearRequests.length)).toBe(1)
  await expect(page.locator('#watchMabelContinueRail .watch-continue-item'))
    .toHaveCount(beforeRemoval - 1)
  expect(await page.evaluate(() => ({
    request: window.__clearRequests[0],
    position: library.channels[0].programmes[0].remote_position,
  }))).toEqual({
    request: { kind: 'channel', channel: 1, file: 'Snowy Adventure.mp4' },
    position: 0,
  })
})

test('native playback revision invalidates a saved MabelTV library snapshot', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers the cache contract')
  await openPortal(page)
  const result = await page.evaluate(async () => {
    const oldRevision = portalRevision('library')
    await window.MabelAppCache.write('library-v1', oldRevision, library)
    portalBootstrapState.revisions.player = Number(
      portalBootstrapState.revisions.player || 0) + 1
    const cached = await readPortalDataCache('library-v1', 'library')
    return { oldRevision, newRevision: portalRevision('library'), stale: cached.stale }
  })
  expect(result.newRevision).toBe(result.oldRevision + 1)
  expect(result.stale).toBe(true)
})

test('multi-line Mabel TV film titles keep the heart beside their first line', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone covers title wrapping geometry')
  await openPortal(page)
  await page.evaluate(() => {
    const channel = library.channels.find(value => value.content_type === 'films')
    channel.programmes[0].metadata.title = "The Scarecrows' Wedding"
    openWatchProgrammeSheet(channel, channel.programmes[0])
  })
  await page.waitForTimeout(50)
  const geometry = await page.locator('#watchProgrammeSheet .portal-sheet-title-row')
    .evaluate(row => {
      const title = row.querySelector('#watchProgrammeTitle')
      const range = document.createRange()
      range.selectNodeContents(title)
      const firstLine = range.getClientRects()[0]
      const icon = row.querySelector('#watchProgrammeFavourite .icon').getBoundingClientRect()
      return {
        lines: range.getClientRects().length,
        gap: icon.left - firstLine.right,
        centreOffset: Math.abs((icon.top + icon.height / 2)
          - (firstLine.top + firstLine.height / 2)),
      }
    })
  expect(geometry.lines).toBe(2)
  expect(geometry.gap).toBeGreaterThanOrEqual(6)
  expect(geometry.gap).toBeLessThanOrEqual(12)
  expect(geometry.centreOffset).toBeLessThanOrEqual(1)
})

test('continued episodes offer View Series and direct progress removal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers the continue menu flow')
  await openPortal(page)
  await page.evaluate(() => {
    const episode = {
      season: 1, episode: 3, path: 'Season 1/Ludwig S01E03.mp4',
      display_name: 'Episode 3', watched: false, browser_ready: true,
      remote_position: 420, remote_duration: 3600, remote_last_watched: 12345,
    }
    const series = {
      id: 'ludwig', title: 'Ludwig', metadata: { tmdb_id: 243360 },
      episodes: [episode], season_count: 1, episode_count: 1, watched_count: 0,
    }
    library.my_tv_series = [series]
    window.__viewedSeries = ''
    window.__clearRequests = []
    window.openMyTvSeriesViewing = value => { window.__viewedSeries = value.id }
    window.api = async (path, options = {}) => {
      if (path !== '/api/remote/clear-position') throw new Error(`Unexpected request: ${path}`)
      window.__clearRequests.push(JSON.parse(options.body))
      return { ok: true, kind: 'my-tv-series' }
    }
    openMyTvEpisodeSheet(series, episode)
  })

  await expect(page.locator('#myTvEpisodeViewSeries')).toBeVisible()
  await expect(page.locator('#myTvEpisodeWatched')).toHaveCount(0)
  await page.locator('#myTvEpisodeViewSeries').click()
  await expect.poll(() => page.evaluate(() => window.__viewedSeries)).toBe('ludwig')
  await page.evaluate(() => openMyTvEpisodeSheet(library.my_tv_series[0],
    library.my_tv_series[0].episodes[0]))
  await expect(page.locator('#myTvEpisodeRemoveProgress')).toBeVisible()
  await page.locator('#myTvEpisodeRemoveProgress').click()
  await expect.poll(() => page.evaluate(() => window.__clearRequests.length)).toBe(1)
  expect(await page.evaluate(() => ({
    request: window.__clearRequests[0],
    position: library.my_tv_series[0].episodes[0].remote_position,
    episodeOpen: document.querySelector('#myTvEpisodeSheet').open,
  }))).toEqual({
    request: { kind: 'my-tv-series', series: 'ludwig',
      file: 'Season 1/Ludwig S01E03.mp4', position: 420 },
    position: 0,
    episodeOpen: false,
  })
})
