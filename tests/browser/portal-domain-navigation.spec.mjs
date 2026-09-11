import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

async function openPortal(page) {
  await page.route('https://image.tmdb.org/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#217f76"/><stop offset="1" stop-color="#17263b"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="210" cy="110" r="76" fill="rgba(255,255,255,.16)"/><path d="M0 360L300 180v270H0z" fill="rgba(0,0,0,.28)"/></svg>',
  }))
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts?.ready)
}

test('MabelTV and Adult TV each keep the same three-section structure', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone navigation contract')
  await openPortal(page)

  await expect(page.locator('#mainNav [data-view-button] span')).toHaveText([
    'Home', 'MabelTV', 'Remote', 'Adult TV', 'Settings',
  ])

  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#watchDomainTitle')).toHaveText('MabelTV')
  await expect(page.locator('#view-watch .watch-tabs button span')).toHaveText([
    'Watch', 'Insights', 'Downloads',
  ])
  await expect(page.locator('#watchMabelLayout')).toBeVisible()
  const mabelWatchTitle = await page.locator('#view-watch .watch-title').boundingBox()
  await page.locator('#watchMabelInsightsTab').click()
  await expect(page.locator('#insightsDomainTitle')).toHaveText('MabelTV')
  await expect(page.locator('#mabelInsightsDashboard')).toBeVisible()
  const mabelInsightsTitle = await page.locator('#view-insights .watch-title').boundingBox()
  expect(Math.abs(mabelInsightsTitle.height - mabelWatchTitle.height)).toBeLessThan(1)
  await page.locator('#insightsDownloadsTab').click()
  await expect(page.locator('#watchDomainTitle')).toHaveText('MabelTV')
  await expect(page.locator('#watchDownloadsLayout')).toBeVisible()

  await page.locator('[data-view-button="adult-home"]').click()
  await expect(page.locator('#view-adult-home h1')).toHaveText('Adult TV')
  await expect(page.locator('#view-adult-home .watch-tabs button span')).toHaveText([
    'Watch', 'Insights', 'Downloads',
  ])
  await expect(page.locator('#watchSearch')).toHaveAttribute('placeholder', 'Search anything')
  await expect(page.locator('#adultMyViewing')).toBeVisible()
  await expect(page.locator('#openHeaderAdultTv')).toHaveCount(0)
  const adultWatchTitle = await page.locator('#view-adult-home .watch-title').boundingBox()
  expect(Math.abs(adultWatchTitle.height - mabelWatchTitle.height)).toBeLessThan(1)
  const sectionOrder = await page.locator('#view-adult-home').evaluate(view => [
    'adultHomeContinueSection', 'adultHomeUpNextSection',
    'adultHomeForYouSection', 'adultHomeDifferentSection',
  ].map(id => [...view.querySelectorAll('section')].indexOf(view.querySelector(`#${id}`))))
  expect(sectionOrder).toEqual([...sectionOrder].sort((left, right) => left - right))
  await expect(page.locator('#adultHomeForYou .adult-explore-card')).toHaveCount(8)
  await expect(page.locator('#adultHomeDifferent .adult-explore-card')).toHaveCount(8)
  await expect(page.locator('#view-adult-home')).not.toContainText('Tonight')
  await expect(page.locator('#view-adult-home')).not.toContainText('Ready on MabelTV')
  await expect(page.locator('#view-adult-home')).not.toContainText('Your history balanced')
  await page.waitForTimeout(250)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page).toHaveScreenshot('adult-tv-watch.png')

  await page.locator('#adultHomeInsightsTab').click()
  await expect(page.locator('#insightsDomainTitle')).toHaveText('Adult TV')
  await expect(page.locator('#adultInsightsDashboard')).toBeVisible()
  const adultInsightsTitle = await page.locator('#view-insights .watch-title').boundingBox()
  expect(Math.abs(adultInsightsTitle.height - adultWatchTitle.height)).toBeLessThan(1)
  await page.locator('#insightsDownloadsTab').click()
  await expect(page.locator('#watchDomainTitle')).toHaveText('Adult TV')
  await expect(page.locator('#watchDownloadsLayout')).toBeVisible()
})

test('Up Next cards reorder with a deliberate press and drag', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'Pointer interaction contract')
  const items = [
    { key: 'movie:701', media_type: 'movie', tmdb_id: 701, title: 'First film', year: '2020', poster_path: '/first.jpg', up_next: true, up_next_rank: 1 },
    { key: 'movie:702', media_type: 'movie', tmdb_id: 702, title: 'Second film', year: '2021', poster_path: '/second.jpg', up_next: true, up_next_rank: 2 },
    { key: 'movie:703', media_type: 'movie', tmdb_id: 703, title: 'Third film', year: '2022', poster_path: '/third.jpg', up_next: true, up_next_rank: 3 },
  ]
  let savedOrder = []
  await page.route('**/api/adult/viewing', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ items, region: 'GB' }),
  }))
  await page.route('**/api/adult/viewing/reorder', async route => {
    savedOrder = (await route.request().postDataJSON()).keys
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, keys: savedOrder }) })
  })
  await openPortal(page)
  await page.locator('[data-view-button="adult-home"]').click()
  await page.locator('#adultMyViewing').click()
  await page.locator('[data-viewing-tab="up-next"]').click()
  const cards = page.locator('#adultViewingGrid > .adult-viewing-row')
  await expect(cards).toHaveCount(3)
  const first = await cards.nth(0).boundingBox()
  const third = await cards.nth(2).boundingBox()
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(390)
  await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => savedOrder).toEqual(['movie:702', 'movie:703', 'movie:701'])
  expect(await cards.evaluateAll(values => values.map(value => value.dataset.viewingKey)))
    .toEqual(savedOrder)

  await page.waitForTimeout(180)
  const moved = await cards.nth(2).boundingBox()
  const newFirst = await cards.nth(0).boundingBox()
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(320)
  await page.mouse.move(newFirst.x + newFirst.width / 2,
    newFirst.y + newFirst.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => savedOrder).toEqual(['movie:701', 'movie:702', 'movie:703'])
})

test('Watch and Insights retain their completed screens without rebuilding them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'Phone persistence contract')
  const requests = { adult: 0, mabel: 0 }
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/adult/insights') requests.adult += 1
    if (url.pathname === '/api/viewing-insights') requests.mabel += 1
  })
  await openPortal(page)

  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#remoteMabel')).not.toBeEmpty()
  await page.locator('#remoteMabel > *').first().evaluate(node => { node.dataset.persistenceProbe = 'mabel-watch' })
  await page.locator('#watchMabelInsightsTab').click()
  await expect(page.locator('#viewingInsights')).toBeVisible()
  await page.locator('#viewingTimelineChart > *').first().evaluate(node => { node.dataset.persistenceProbe = 'mabel-insights' })
  const firstMabelRequests = requests.mabel

  await page.locator('[data-view-button="adult-home"]').click()
  await expect(page.locator('#adultHomeForYou .adult-explore-card')).toHaveCount(8)
  await page.locator('#adultHomeForYou .adult-explore-card').first()
    .evaluate(node => { node.dataset.persistenceProbe = 'adult-watch' })
  await page.locator('#adultHomeInsightsTab').click()
  await expect(page.locator('#adultInsightWatched')).not.toHaveText('0')
  await page.locator('#adultInsightRatingChart > *').first()
    .evaluate(node => { node.dataset.persistenceProbe = 'adult-insights' })
  const firstAdultRequests = requests.adult

  await page.locator('#insightsWatchTab').click()
  await expect(page.locator('[data-persistence-probe="adult-watch"]')).toBeVisible()
  await page.locator('#adultHomeInsightsTab').click()
  await expect(page.locator('[data-persistence-probe="adult-insights"]')).toBeVisible()
  expect(requests.adult).toBe(firstAdultRequests)

  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('[data-persistence-probe="mabel-insights"]')).toBeVisible()
  expect(requests.mabel).toBe(firstMabelRequests)
  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('[data-persistence-probe="mabel-watch"]')).toBeVisible()
  expect(requests.mabel).toBe(firstMabelRequests)
})

test('stored Insights paint immediately while an old view refreshes behind them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'Phone persistence contract')
  await openPortal(page)
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#watchMabelInsightsTab').click()
  await expect.poll(() => page.evaluate(() => viewingInsightsLoadedRange)).toBe(1)
  const mabelTotal = await page.locator('#viewingRangeTotal').textContent()
  await page.locator('[data-view-button="adult-home"]').click()
  await page.locator('#adultHomeInsightsTab').click()
  await expect(page.locator('#adultInsightWatched')).not.toHaveText('0')
  const adultTotal = await page.locator('#adultInsightWatched').textContent()
  await page.evaluate(() => {
    for (const key of ['mabeltv-data-mabel-insights-v1-1', 'mabeltv-data-adult-insights-v1']) {
      const cached = JSON.parse(localStorage.getItem(key))
      cached.saved_at = 1
      localStorage.setItem(key, JSON.stringify(cached))
    }
  })
  await page.route('**/api/viewing-insights?*', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    await route.continue()
  })
  await page.route('**/api/adult/insights', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    await route.continue()
  })
  await page.reload()
  await expect(page.locator('.app-shell')).toBeVisible()

  await page.locator('[data-view-button="adult-home"]').click()
  await page.locator('#adultHomeInsightsTab').click()
  await expect(page.locator('#adultInsightWatched')).toHaveText(adultTotal, { timeout: 400 })
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#watchMabelInsightsTab').click()
  await expect(page.locator('#viewingRangeTotal')).toHaveText(mabelTotal, { timeout: 400 })
})

test('Search anything includes people and opens their reusable card', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone search contract')
  await page.route('**/api/adult/discovery?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ query: 'Jane', results: [{
      key: 'person:1892', media_type: 'person', tmdb_id: 1892,
      title: 'Jane Director', name: 'Jane Director', profile_path: '/jane.jpg',
      known_for_department: 'Directing',
    }] }),
  }))
  await page.route('**/api/adult/person?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tmdb_id: 1892, name: 'Jane Director', profile_path: '/jane.jpg',
      known_for_department: 'Directing', biography: '', known_for: [], filmography: [],
    }),
  }))
  await openPortal(page)

  await page.locator('[data-view-button="adult-home"]').click()
  await page.locator('#watchSearch').fill('Jane')
  const result = page.locator('#adultDiscoveryGrid .watch-card')
  await expect(result).toHaveCount(1)
  await expect(result).toContainText('Jane Director')
  await expect(result).toContainText('Directing')
  await result.click()
  await expect(page.locator('#adultPersonSheet')).toBeVisible()
  await expect(page.locator('#adultPersonName')).toHaveText('Jane Director')
})
