import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts?.ready)
}

test('MabelTV film More offers removal from Continue Watching', async ({ page }, testInfo) => {
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
    openWatchProgrammeSheet(channel, channel.programmes[0], 'continue')
  })
  await page.locator('#watchProgrammeMore').click()
  await expect(page.locator('#watchProgrammeRemoveProgress')).toBeVisible()
  await page.locator('#watchProgrammeRemoveProgress').click()
  await expect.poll(() => page.evaluate(() => window.__clearRequests.length)).toBe(1)
  expect(await page.evaluate(() => ({
    request: window.__clearRequests[0],
    position: library.channels[0].programmes[0].remote_position,
  }))).toEqual({
    request: { kind: 'channel', channel: 1, file: 'Snowy Adventure.mp4' },
    position: 0,
  })
})

test('multi-line MabelTV film titles keep the heart beside their first line', async ({ page }, testInfo) => {
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
    library.adult_series = [series]
    window.__viewedSeries = ''
    window.__clearRequests = []
    window.openAdultSeriesViewing = value => { window.__viewedSeries = value.id }
    window.api = async (path, options = {}) => {
      if (path !== '/api/remote/clear-position') throw new Error(`Unexpected request: ${path}`)
      window.__clearRequests.push(JSON.parse(options.body))
      return { ok: true, kind: 'adult-series' }
    }
    openAdultEpisodeSheet(series, episode)
  })

  await expect(page.locator('#adultEpisodeViewSeries')).toBeVisible()
  await expect(page.locator('#adultEpisodeWatched')).toHaveCount(0)
  await page.locator('#adultEpisodeViewSeries').click()
  await expect.poll(() => page.evaluate(() => window.__viewedSeries)).toBe('ludwig')
  await page.evaluate(() => openAdultEpisodeSheet(library.adult_series[0],
    library.adult_series[0].episodes[0]))
  await expect(page.locator('#adultEpisodeRemoveProgress')).toBeVisible()
  await page.locator('#adultEpisodeRemoveProgress').click()
  await expect.poll(() => page.evaluate(() => window.__clearRequests.length)).toBe(1)
  expect(await page.evaluate(() => ({
    request: window.__clearRequests[0],
    position: library.adult_series[0].episodes[0].remote_position,
    episodeOpen: document.querySelector('#adultEpisodeSheet').open,
  }))).toEqual({
    request: { kind: 'adult-series', series: 'ludwig',
      file: 'Season 1/Ludwig S01E03.mp4', position: 420 },
    position: 0,
    episodeOpen: false,
  })
})
