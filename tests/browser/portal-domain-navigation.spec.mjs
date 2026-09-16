import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

async function openPortal(page) {
  await page.route('**/api/my-tv/tmdb-artwork/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#217f76"/><stop offset="1" stop-color="#17263b"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="210" cy="110" r="76" fill="rgba(255,255,255,.16)"/><path d="M0 360L300 180v270H0z" fill="rgba(0,0,0,.28)"/></svg>',
  }))
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts?.ready)
}

async function expectCompactDomainTabs(page, viewSelector) {
  const controls = await page.locator(viewSelector).evaluate(view => {
    const tabs = [...view.querySelectorAll('.watch-tabs button')]
    return {
      icons: tabs.map(tab => tab.querySelector('use')?.getAttribute('href')),
      tabFonts: tabs.map(tab => getComputedStyle(tab).fontSize),
      iconSizes: tabs.map(tab => {
        const box = tab.querySelector('svg').getBoundingClientRect()
        return [Math.round(box.width), Math.round(box.height)]
      }),
    }
  })
  expect(controls).toEqual({
    icons: [
      '/portal/icons.svg#signal-play',
      '/portal/icons.svg#signal-chart-column',
      '/portal/icons.svg#signal-download',
    ],
    tabFonts: ['14px', '14px', '14px'],
    iconSizes: [[15, 15], [15, 15], [15, 15]],
  })
}

async function expectCompactSearch(page, inputSelector) {
  const search = await page.locator(inputSelector).evaluate(input => ({
    searchHeight: Math.round(input.closest('.watch-search').getBoundingClientRect().height),
    inputHeight: Math.round(input.getBoundingClientRect().height),
    placeholderFont: getComputedStyle(input, '::placeholder').fontSize,
  }))
  expect(search).toEqual({
    searchHeight: 42,
    inputHeight: 40,
    placeholderFont: '15px',
  })
}

test('Mabel TV and My TV keep compact icon tabs across every section', async ({ page }) => {
  await openPortal(page)

  await page.locator('[data-view-button="watch"]').click()
  await expectCompactDomainTabs(page, '#view-watch')
  await expectCompactSearch(page, '#watchMabelSearch')
  await page.locator('#watchMabelInsightsTab').click()
  await expect(page.locator('#mabelInsightsDashboard')).toBeVisible()
  await expectCompactDomainTabs(page, '#view-insights')
  await page.locator('#insightsDownloadsTab').click()
  await expect(page.locator('#watchDownloadsLayout')).toBeVisible()
  await expectCompactDomainTabs(page, '#view-watch')

  await page.locator('[data-view-button="my-tv-home"]').click()
  await expectCompactDomainTabs(page, '#view-my-tv-home')
  await expectCompactSearch(page, '#watchSearch')
  await expect(page.locator('#myTvHomeReleased .my-tv-release-cinema-tag'))
    .toHaveText('Cinema')
  await expect(page.locator('#myTvHomeReleased .my-tv-explore-card').first()
    .locator('.my-tv-provider-strip')).toHaveCount(0)
  const releaseMeta = await page.locator(
    '#myTvHomeReleased .my-tv-explore-open-copy small',
  ).allTextContents()
  expect(releaseMeta.every(value => value && !value.includes(' · '))).toBe(true)
  await expect(page.locator(
    '#myTvHomeForYou .my-tv-release-cinema-tag, #myTvHomeDifferent .my-tv-release-cinema-tag',
  )).toHaveCount(0)
  await page.locator('#myTvHomeInsightsTab').click()
  await expect(page.locator('#myTvInsightsDashboard')).toBeVisible()
  await expectCompactDomainTabs(page, '#view-insights')
  await page.locator('#insightsDownloadsTab').click()
  await expect(page.locator('#watchDownloadsLayout')).toBeVisible()
  await expectCompactDomainTabs(page, '#view-watch')
})

test('Mabel TV groups compact episode channels ahead of unchanged film channels', async ({ page }) => {
  await openPortal(page)
  await page.locator('[data-view-button="watch"]').click()
  await page.evaluate(() => {
    const episode = number => ({
      number, name: `Series ${number}`, enabled: true, content_type: 'shows',
      folder: `series-${number}`, metadata: { title: `Series ${number}` },
      programmes: Array.from({ length: number }, (_, index) => ({
        name: `episode-${index + 1}.mp4`, display_name: `Episode ${index + 1}`,
        enabled: true, browser_ready: true, metadata: {},
      })),
    })
    library.channels = [episode(6), {
      number: 2, name: 'Film channel 2', enabled: true, content_type: 'films',
      folder: 'films-2', metadata: {}, programmes: [{
        name: 'film.mp4', display_name: 'Fixture Film', enabled: true,
        browser_ready: true, metadata: { title: 'Fixture Film', year: '2024' },
      }],
    }, episode(1), episode(3), {
      ...episode(10), name: 'Family Videos', programmes: episode(3).programmes,
    }]
    renderRemoteViewing({ force: true })
  })

  await expect(page.locator('.mabel-episode-channel-section h2')).toHaveText('Episode channels')
  await expect(page.locator('.watch-mabel-series-channel-card')).toHaveCount(4)
  await expect(page.locator('.watch-mabel-series-channel-card .watch-mabel-channel-copy small'))
    .toHaveText(['CH 1 · 1 episode', 'CH 3 · 3 episodes', 'CH 6 · 6 episodes', 'CH 10 · 3 episodes'])
  await expect(page.locator('.watch-mabel-episode')).toHaveCount(0)
  await expect(page.locator('.mabel-film-channels-heading h2')).toHaveText('Film channels')
  await expect(page.locator('.mabel-film-channel .watch-mabel-film-card')).toHaveCount(1)
  const channelDivider = await page.evaluate(() => {
    const episodes = document.querySelector('.mabel-episode-channel-section').getBoundingClientRect()
    const films = document.querySelector('.mabel-film-channels-heading')
    const filmBounds = films.getBoundingClientRect()
    const style = getComputedStyle(films)
    return {
      gap: Math.round(filmBounds.top - episodes.bottom),
      borderWidth: style.borderTopWidth,
      borderStyle: style.borderTopStyle,
    }
  })
  expect(channelDivider.gap).toBeGreaterThanOrEqual(18)
  expect(channelDivider).toMatchObject({ borderWidth: '1px', borderStyle: 'solid' })
  await expect(page.locator('.watch-mabel-series-channel-card').last().locator('img'))
    .toHaveAttribute('src', /mabel-show-10-0\.jpg$/)
  const columns = await page.locator('.mabel-episode-channel-grid').evaluate(grid =>
    getComputedStyle(grid).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(3)
  const titleStyle = await page.locator('.watch-mabel-channel-copy strong').first().evaluate(title => ({
    overflow: getComputedStyle(title).overflow,
    textOverflow: getComputedStyle(title).textOverflow,
    whiteSpace: getComputedStyle(title).whiteSpace,
  }))
  expect(titleStyle).toEqual({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
})

test('@visual Mabel TV and My TV each keep the same three-section structure', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone navigation contract')
  await openPortal(page)

  await expect(page.locator('#mainNav [data-view-button] span')).toHaveText([
    'Home', 'Mabel TV', 'Remote', 'My TV', 'Settings',
  ])

  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#watchDomainTitle')).toHaveText('Mabel TV')
  await expect(page.locator('#view-watch .watch-tabs button span')).toHaveText([
    'Watch', 'Insights', 'Downloads',
  ])
  await expect(page.locator('#watchMabelLayout')).toBeVisible()
  const mabelWatchTitle = await page.locator('#view-watch .watch-title').boundingBox()
  await page.locator('#watchMabelInsightsTab').click()
  await expect(page.locator('#insightsDomainTitle')).toHaveText('Mabel TV')
  await expect(page.locator('#mabelInsightsDashboard')).toBeVisible()
  const mabelInsightsTitle = await page.locator('#view-insights .watch-title').boundingBox()
  expect(Math.abs(mabelInsightsTitle.height - mabelWatchTitle.height)).toBeLessThan(1)
  await page.locator('#insightsDownloadsTab').click()
  await expect(page.locator('#watchDomainTitle')).toHaveText('Mabel TV')
  await expect(page.locator('#watchDownloadsLayout')).toBeVisible()

  await page.locator('[data-view-button="my-tv-home"]').click()
  await expect(page.locator('#view-my-tv-home h1')).toHaveText('My TV')
  await expect(page.locator('#view-my-tv-home .watch-tabs button span')).toHaveText([
    'Watch', 'Insights', 'Downloads',
  ])
  await expect(page.locator('#watchSearch')).toHaveAttribute('placeholder', 'Search anything')
  await expect(page.locator('#myTvMyViewing')).toBeVisible()
  await expect(page.locator('#openHeaderMyTvTv')).toHaveCount(0)
  const myTvWatchTitle = await page.locator('#view-my-tv-home .watch-title').boundingBox()
  expect(Math.abs(myTvWatchTitle.height - mabelWatchTitle.height)).toBeLessThan(1)
  const sectionOrder = await page.locator('#view-my-tv-home').evaluate(view => [
    'myTvHomeContinueSection', 'myTvHomeUpNextSection',
    'myTvHomeReleasedSection', 'myTvHomeForYouSection', 'myTvHomeDifferentSection',
  ].map(id => [...view.querySelectorAll('section')].indexOf(view.querySelector(`#${id}`))))
  expect(sectionOrder).toEqual([...sectionOrder].sort((left, right) => left - right))
  await expect(page.locator('#myTvHomeForYou .my-tv-explore-card')).toHaveCount(8)
  await expect(page.locator('#myTvHomeReleased .my-tv-explore-card')).toHaveCount(16)
  await expect(page.locator('#myTvHomeReleasedSection')).toHaveClass(/my-tv-home-release-card/)
  await expect(page.locator('#myTvHomeReleasedSection .my-tv-home-swipe-cue')).toBeVisible()
  await expect(page.locator('#myTvHomeReleased')).toHaveCSS('overflow-x', 'auto')
  const releasedWidths = await page.locator('#myTvHomeReleased .my-tv-explore-card')
    .evaluateAll(cards => cards.slice(0, 5).map(card => card.getBoundingClientRect().width))
  expect(releasedWidths.every(width => width > 70)).toBe(true)
  await expect(page.locator('#myTvHomeDifferent .my-tv-explore-card')).toHaveCount(8)
  const caption = await page.locator('#myTvHomeForYou .my-tv-explore-open-copy').first()
    .evaluate(copy => {
      const title = copy.querySelector('strong')
      const copyBox = copy.getBoundingClientRect()
      const titleBox = title.getBoundingClientRect()
      const style = getComputedStyle(title)
      return {
        leftOffset: Math.round(titleBox.left - copyBox.left),
        textAlign: style.textAlign,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      }
    })
  expect(caption).toEqual({ leftOffset: 0, textAlign: 'left', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
  const continueCard = page.locator('#myTvHomeContinueRail .watch-continue-card').first()
  if (await continueCard.count()) {
    expect((await continueCard.boundingBox()).width).toBeLessThanOrEqual(225)
    await expect(continueCard.locator('.watch-continue-copy i')).toHaveCount(0)
  }
  await expect(page.locator('#myTvHomeForYou .my-tv-provider-strip').first()).toBeVisible()
  await expect(page.locator('#myTvHomeForYou .my-tv-provider-strip img').first())
    .toHaveAttribute('src', /apple-touch-icon|providers/)
  await expect(page.locator('#myTvHomeForYou .my-tv-provider-strip img').first())
    .toHaveCSS('width', '17px')
  await expect(page.locator('#view-my-tv-home')).not.toContainText('Tonight')
  await expect(page.locator('#view-my-tv-home')).not.toContainText('Ready on Mabel TV')
  await expect(page.locator('#view-my-tv-home')).not.toContainText('Your history balanced')
  await page.waitForTimeout(250)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page).toHaveScreenshot('my-tv-watch.png')

  await page.locator('#myTvHomeInsightsTab').click()
  await expect(page.locator('#insightsDomainTitle')).toHaveText('My TV')
  await expect(page.locator('#myTvInsightsDashboard')).toBeVisible()
  const myTvInsightsTitle = await page.locator('#view-insights .watch-title').boundingBox()
  expect(Math.abs(myTvInsightsTitle.height - myTvWatchTitle.height)).toBeLessThan(1)
  await page.locator('#insightsDownloadsTab').click()
  await expect(page.locator('#watchDomainTitle')).toHaveText('My TV')
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
  await page.route('**/api/my-tv/viewing', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ items, region: 'GB' }),
  }))
  await page.route('**/api/my-tv/viewing/reorder', async route => {
    savedOrder = (await route.request().postDataJSON()).keys
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, keys: savedOrder }) })
  })
  await openPortal(page)
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#myTvMyViewing').click()
  await page.locator('[data-viewing-tab="up-next"]').click()
  const cards = page.locator('#myTvViewingGrid > .my-tv-viewing-row')
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
  const requests = { my_tv: 0, mabel: 0 }
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/my-tv/insights') requests.my_tv += 1
    if (url.pathname === '/api/viewing-insights/overview') requests.mabel += 1
  })
  await openPortal(page)

  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#remoteMabel')).not.toBeEmpty()
  await page.locator('#remoteMabel > *').first().evaluate(node => { node.dataset.persistenceProbe = 'mabel-watch' })
  await page.locator('#watchMabelInsightsTab').click()
  await expect(page.locator('#viewingInsights')).toBeVisible()
  await page.locator('#viewingTimelineChart > *').first().evaluate(node => { node.dataset.persistenceProbe = 'mabel-insights' })
  const firstMabelRequests = requests.mabel

  await page.locator('[data-view-button="my-tv-home"]').click()
  await expect(page.locator('#myTvHomeForYou .my-tv-explore-card')).toHaveCount(8)
  await page.locator('#myTvHomeForYou .my-tv-explore-card').first()
    .evaluate(node => { node.dataset.persistenceProbe = 'my-tv-watch' })
  await page.locator('#myTvHomeInsightsTab').click()
  await expect(page.locator('#myTvInsightWatched')).not.toHaveText('0')
  await page.locator('#myTvInsightRatingChart > *').first()
    .evaluate(node => { node.dataset.persistenceProbe = 'my-tv-insights' })
  const firstMyTvRequests = requests.my_tv

  await page.locator('#insightsWatchTab').click()
  await expect(page.locator('[data-persistence-probe="my-tv-watch"]')).toBeVisible()
  await page.locator('#myTvHomeInsightsTab').click()
  await expect(page.locator('[data-persistence-probe="my-tv-insights"]')).toBeVisible()
  expect(requests.my_tv).toBe(firstMyTvRequests)

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
  await expect.poll(() => page.evaluate(() => Boolean(
    viewingResource('overview', '7')))).toBe(true)
  const mabelTotal = await page.locator('#viewingRangeTotal').textContent()
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#myTvHomeInsightsTab').click()
  await expect(page.locator('#myTvInsightWatched')).not.toHaveText('0')
  const myTvTotal = await page.locator('#myTvInsightWatched').textContent()
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(window.MabelAppCache.databaseName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('snapshots', 'readwrite')
    const store = transaction.objectStore('snapshots')
    for (const key of ['mabel-insights-v2-overview-7', 'my-tv-insights-v1']) {
      const cached = await new Promise((resolve, reject) => {
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      cached.savedAt = 1
      store.put(cached)
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  })
  await page.route('**/api/viewing-insights/overview?*', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    await route.continue()
  })
  await page.route('**/api/my-tv/insights', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    await route.continue()
  })
  await page.reload()
  await expect(page.locator('.app-shell')).toBeVisible()

  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#myTvHomeInsightsTab').click()
  await expect(page.locator('#myTvInsightWatched')).toHaveText(myTvTotal, { timeout: 400 })
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#watchMabelInsightsTab').click()
  await expect(page.locator('#viewingRangeTotal')).toHaveText(mabelTotal, { timeout: 400 })
})

test('Search anything includes people and opens their reusable card', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone search contract')
  await page.route('**/api/my-tv/discovery?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ query: 'Jane', results: [{
      key: 'person:1892', media_type: 'person', tmdb_id: 1892,
      title: 'Jane Director', name: 'Jane Director', profile_path: '/jane.jpg',
      known_for_department: 'Directing',
    }] }),
  }))
  await page.route('**/api/my-tv/person?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tmdb_id: 1892, name: 'Jane Director', profile_path: '/jane.jpg',
      known_for_department: 'Directing', biography: '', known_for: [], filmography: [],
    }),
  }))
  await openPortal(page)

  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#watchSearch').fill('Jane')
  const result = page.locator('#myTvDiscoveryGrid .watch-card')
  await expect(result).toHaveCount(1)
  await expect(result).toContainText('Jane Director')
  await expect(result).toContainText('Directing')
  await result.click()
  await expect(page.locator('#myTvPersonSheet')).toBeVisible()
  await expect(page.locator('#myTvPersonName')).toHaveText('Jane Director')
})
