import { test, expect } from '@playwright/test'


async function openExplore(page) {
  await page.route('https://image.tmdb.org/**', async route => {
    const match = route.request().url().match(/explore-(\d+)/)
    const value = Number(match?.[1] || 1)
    const hue = value * 47 % 360
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450">
      <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 54% 42%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 48% 14%)"/></linearGradient></defs>
      <rect width="300" height="450" fill="url(#g)"/><circle cx="235" cy="90" r="76" fill="rgba(255,255,255,.12)"/><path d="M0 330L128 190l172 190v70H0z" fill="rgba(0,0,0,.3)"/><text x="24" y="395" fill="white" font-family="Arial" font-size="24" font-weight="700">TITLE ${value}</text>
    </svg>`
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body })
  })
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    history.replaceState({ adultViewing: true }, '', '#adult-viewing')
    openView('adult-viewing')
  })
  await expect(page.locator('#view-adult-viewing')).toBeVisible()
  await page.locator('#adultViewingExplore').click()
  await expect(page.locator('#view-adult-explore')).toBeVisible()
  await expect(page.locator('.adult-explore-card').first()).toBeVisible()
}


test('Explore is a polished four-wide continuous catalogue with direct actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine owns the Explore reference')
  await openExplore(page)

  const layout = await page.locator('.adult-explore-card').evaluateAll(cards => ({
    firstRow: cards.filter(card => Math.round(card.getBoundingClientRect().top)
      === Math.round(cards[0].getBoundingClientRect().top)).length,
    right: Math.max(...cards.map(card => card.getBoundingClientRect().right)),
    viewport: document.documentElement.clientWidth,
  }))
  expect(layout.firstRow).toBe(4)
  expect(layout.right).toBeLessThanOrEqual(layout.viewport)
  await expect(page.locator('#adultExploreHeading')).toHaveText('Best guesses for you')
  await expect(page).toHaveScreenshot('explore-for-you.png')

  const first = page.locator('.adult-explore-card[data-media-type="movie"]').first()
  const actionSize = await first.locator('[data-explore-action="watched"]')
    .evaluate(button => button.getBoundingClientRect().width)
  expect(actionSize).toBeGreaterThanOrEqual(29)
  const iconStable = await first.evaluate(card => {
    const button = card.querySelector('[data-explore-action="watchlist"]')
    window.__exploreActionIcon = button.querySelector('svg')
    refreshAdultArtworkStatuses()
    return window.__exploreActionIcon === button.querySelector('svg')
  })
  expect(iconStable).toBe(true)
  await first.locator('[data-explore-action="watchlist"]').click()
  await expect(first.locator('[data-explore-action="watchlist"]')).toHaveClass(/active/)
  await first.locator('[data-explore-action="watchlist"]').click()
  await expect(first.locator('[data-explore-action="watchlist"]')).not.toHaveClass(/active/)
  await first.locator('[data-explore-action="watched"]').click()
  await expect(first.locator('[data-explore-action="watched"]')).toHaveAttribute('data-status', 'watched')
  await first.locator('[data-explore-action="watched"]').click()
  await expect(first.locator('[data-explore-action="watched"]')).toHaveAttribute('data-status', '')
  await first.locator('[data-explore-action="watched"]').click()
  await expect(first.locator('[data-explore-action="watched"]')).toHaveAttribute('data-status', 'watched')
  await expect(first).toBeVisible()
  await expect(page.locator('#notice')).toHaveText('')
})


test('Explore updates a film card instantly when its detail state changes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine covers optimistic detail state')
  await openExplore(page)
  await page.route('**/api/adult/viewing', async route => {
    if (route.request().method() === 'POST') {
      await new Promise(resolve => setTimeout(resolve, 600))
    }
    await route.continue()
  })

  const first = page.locator('.adult-explore-card[data-media-type="movie"]').first()
  await first.locator('.adult-explore-open-art').click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  const watched = page.locator('#adultTitleIntents [data-viewing-action="watched"]')
  await watched.click()
  await expect(watched).toHaveClass(/active/, { timeout: 150 })
  await page.locator('#adultTitleClose').click()
  await expect(first.locator('[data-explore-action="watched"]'))
    .toHaveAttribute('data-status', 'watched', { timeout: 150 })
  await expect(page.locator('#notice')).toHaveText('')
})


test('Explore series opens a catalogue-only season checklist', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine covers the catalogue-only title route')
  await openExplore(page)

  const series = page.locator('.adult-explore-card[data-media-type="tv"]').first()
  await series.locator('[data-explore-action="watched"]').click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(page.locator('#adultTitleSeriesLibrary')).toBeVisible()
  await expect(page.locator('#adultTitleSheet .adult-provider-section')).toBeHidden()
  await expect(page.locator('#adultTitleFilmActions')).toBeHidden()
  await page.locator('#adultTitleSeasons .adult-season-card').first().click()
  await expect(page.locator('#adultTitleSeasonSheet')).toBeVisible()
  await expect(page.locator('#adultTitleSeasonSettings')).toBeHidden()
  const episode = page.locator('#adultTitleSeasonEpisodes .adult-streaming-episode-toggle').first()
  await expect(page.locator('#adultTitleSeasonEpisodes .adult-streaming-episode-toggle')).toHaveCount(3)
  await episode.click()
  await expect(episode).toHaveAttribute('aria-pressed', 'true')
  await episode.click()
  await expect(episode).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('#adultTitleSeasonEpisodes article[role="button"]')).toHaveCount(0)
})

test('viewing actions update before their background refresh completes', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const originalApi = window.api
    const originalLoad = window.loadAdultViewing
    let refreshStarted = false
    let releaseRefresh
    window.api = async () => ({ viewing: { manual_state: 'watched' } })
    window.loadAdultViewing = () => {
      refreshStarted = true
      return new Promise(resolve => { releaseRefresh = resolve })
    }
    try {
      const detail = { media_type: 'movie', tmdb_id: 123, title: 'Fast update', viewing: {} }
      const viewing = await updateAdultViewing(detail, 'watched')
      return { refreshStarted, returned: viewing.manual_state, detail: detail.viewing.manual_state }
    } finally {
      releaseRefresh?.()
      window.api = originalApi
      window.loadAdultViewing = originalLoad
    }
  })
  expect(result).toEqual({ refreshStarted: true, returned: 'watched', detail: 'watched' })
})


test('Explore refreshes from the top after a minute and then removes watched titles', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine covers freshness behaviour')
  await openExplore(page)

  const first = page.locator('.adult-explore-card[data-media-type="movie"]').first()
  const key = await first.getAttribute('data-explore-key')
  await first.locator('[data-explore-action="watched"]').click()
  await page.evaluate(() => setPortalScrollTop(520))
  expect(await page.evaluate(() => portalScrollTop())).toBeGreaterThan(100)
  await page.locator('#adultExploreBack').click()
  await expect(page.locator('#view-adult-viewing')).toBeVisible()
  await page.evaluate(() => { adultExploreLeftAt = Date.now() - 61000 })
  await page.locator('#adultViewingExplore').click()
  await expect(page.locator('#view-adult-explore')).toBeVisible()
  await expect(page.locator('.adult-explore-card').first()).toBeVisible()
  expect(await page.evaluate(() => portalScrollTop())).toBeLessThanOrEqual(5)
  await expect(page.locator(`[data-explore-key="${key}"]`)).toHaveCount(0)
})
