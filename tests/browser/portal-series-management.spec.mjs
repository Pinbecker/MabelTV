import { test, expect } from '@playwright/test'


async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nothing playing' })).toBeVisible()
  await page.evaluate(() => document.fonts?.ready)
}


test('local and global series entries open one management sheet', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone series-card contract')
  await openPortal(page)
  await page.evaluate(() => {
    library.adult_series = [{
      id: 'fixture-series', title: 'Fixture Series', favourite: true,
      metadata: {
        tmdb_id: 6001, title: 'Fixture Series',
        overview: 'A stable series-card regression fixture.',
      },
      seasons: [1], season_count: 1, episode_count: 1, watched_count: 0,
      episodes: [{ season: 1, episode: 1, path: 'Series 1/Episode 1.mp4',
        display_name: 'Episode 1', watched: false, browser_ready: true }],
    }]
    renderHomeLibrary()
  })

  await page.getByRole('button', { name: 'Open favourite series Fixture Series' }).click()
  await expect(page.locator('#adultSeriesSheet')).toBeVisible()
  await expect(page.locator('#adultTitleSheet')).toBeHidden()
  await expect(page.locator('#adultSeriesSheetTitle')).toHaveText('Fixture Series')
  const seriesIntents = page.locator('#adultSeriesIntents')
  await expect(seriesIntents).toBeVisible()
  await expect(seriesIntents).toHaveClass(/compact-series-intents/)
  await expect(seriesIntents.locator('[data-viewing-action]:not(.hidden)')).toHaveCount(4)
  await expect(seriesIntents.locator('[data-viewing-action]:not(.hidden) strong'))
    .toHaveText(['Watchlist', 'Up Next', 'Watching', 'Watched'])
  await page.evaluate(() => {
    const detail = localSeriesViewingDetail(library.adult_series[0])
    detail.viewing = { manual_state: 'watched' }
    syncAdultTitleButtons(detail, document.querySelector('#adultSeriesIntents'))
  })
  await expect(seriesIntents.locator('[data-viewing-action]:not(.hidden) strong'))
    .toHaveText(['Rewatch', 'Up Next', 'Watching', 'Watched'])

  await page.locator('#adultSeriesMore').click()
  await expect(page.locator('#adultSeriesMoreSheet')).toBeVisible()
  await expect(page.locator('#adultSeriesRestart')).toBeVisible()
  await expect(page.locator('#adultSeriesMetadata')).toBeVisible()
  await expect(page.locator('#adultSeriesDelete')).toBeVisible()
  await page.locator('#adultSeriesMoreClose').click()
  await expect(page.locator('#adultSeriesSheet')).toBeVisible()

  await page.locator('#adultSeriesEpisodes .adult-season-card').click()
  await expect(page.locator('#adultSeasonSheet')).toBeVisible()
  await expect(page.locator('#adultSeasonManagementTitle')).toHaveText('Series settings')
  await expect(page.locator('#adultSeasonDelete')).toBeVisible()

  await page.evaluate(() => portalSheets.dismiss(document.querySelector('#adultSeasonSheet')))
  await page.getByRole('button', { name: 'Watch', exact: true }).click()
  await page.locator('#watchAdultTab').click()
  await page.evaluate(() => {
    document.querySelector('#watchAdultLayout').classList.remove('hidden')
    document.querySelector('#view-watch').classList.add('adult-search-mode')
    document.querySelector('#adultDiscoverySection').classList.remove('hidden')
    document.querySelector('#adultDiscoveryGrid').replaceChildren(adultDiscoveryCard({
      media_type: 'tv', tmdb_id: 6001, title: 'Fixture Series', year: '2026',
      overview: 'A global-search result regression fixture.',
    }))
  })
  await page.locator('#adultDiscoveryGrid .watch-card').click()
  await expect(page.locator('#adultSeriesSheet')).toBeVisible()
  await expect(page.locator('#adultTitleSheet')).toBeHidden()
  await expect(page.locator('#adultSeriesSheetTitle')).toHaveText('Fixture Series')
})
