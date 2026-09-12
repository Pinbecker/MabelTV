import { test, expect } from '@playwright/test'


async function openExplore(page) {
  await page.route('**/api/adult/tmdb-artwork/**', async route => {
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


test('all five My Viewing grids retain the watched and Watchlist quick actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine owns the My Viewing action contract')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    const items = [
      { key: 'movie:8101', media_type: 'movie', tmdb_id: 8101,
        title: 'Saved film', year: '2021', watchlisted: true },
      { key: 'movie:8102', media_type: 'movie', tmdb_id: 8102,
        title: 'Queued film', year: '2022', up_next: true, up_next_rank: 1 },
      { key: 'movie:8103', media_type: 'movie', tmdb_id: 8103,
        title: 'Watching film', year: '2023', local_progress: { position: 120 } },
      { key: 'tv:8104', media_type: 'tv', tmdb_id: 8104,
        title: 'Part watched series', year: '2024', manual_state: 'part_watched',
        series_watching: true, episodes: { '1:1': { watched: true } } },
      { key: 'movie:8105', media_type: 'movie', tmdb_id: 8105,
        title: 'Watched film', year: '2025', manual_state: 'watched' },
    ]
    adultViewingData = { items }
    adultViewingLoaded = true
    const originalApi = window.api
    window.api = async (path, options = {}) => {
      if (path === '/api/adult/viewing' && options.method === 'POST') {
        const payload = JSON.parse(options.body)
        const key = `${payload.media_type}:${Number(payload.tmdb_id)}`
        return { key, viewing: { ...adultViewingRecord({ key }), key,
          watchlisted: payload.action === 'watchlist' ? payload.enabled : undefined,
          manual_state: payload.action === 'not_watched' ? 'not_watched'
            : payload.action === 'watched' ? 'watched' : adultViewingRecord({ key }).manual_state } }
      }
      if (path === '/api/adult/viewing') return adultViewingData
      return originalApi(path, options)
    }
    history.replaceState({ adultViewing: true }, '', '#adult-viewing')
    openView('adult-viewing')
  })

  for (const tab of ['watchlist', 'up-next', 'watching', 'part-watched', 'history']) {
    await page.locator(`[data-viewing-tab="${tab}"]`).click()
    const card = page.locator('#adultViewingGrid > .adult-viewing-row').first()
    await expect(card).toBeVisible()
    if (tab === 'watching') {
      await page.locator('[data-viewing-key="tv:8104"]')
        .evaluate(row => { window.__retainedViewingRow = row })
    }
    await expect(card.locator('[data-explore-action="watched"]')).toBeVisible()
    await expect(card.locator('[data-explore-action="watchlist"]')).toBeVisible()
  }

  await page.locator('[data-viewing-tab="watching"]').click()
  expect(await page.locator('[data-viewing-key="tv:8104"]')
    .evaluate(row => window.__retainedViewingRow === row)).toBe(true)

  await page.locator('[data-viewing-tab="watchlist"]').click()
  const saved = page.locator('#adultViewingGrid > .adult-viewing-row').first()
  await expect(saved.locator('[data-explore-action="watchlist"]')).toHaveClass(/active/)
  await expect(saved.locator('[data-explore-action="watchlist"] use'))
    .toHaveAttribute('href', '/portal/icons.svg#signal-minus')
  const placement = await saved.evaluate(card => {
    const art = card.querySelector('.adult-viewing-art').getBoundingClientRect()
    const watched = card.querySelector('[data-explore-action="watched"]').getBoundingClientRect()
    const watchlist = card.querySelector('[data-explore-action="watchlist"]').getBoundingClientRect()
    return {
      watchedTop: watched.top - art.top,
      watchlistBottom: art.bottom - watchlist.bottom,
      watchedRight: art.right - watched.right,
      watchlistRight: art.right - watchlist.right,
    }
  })
  expect(Math.abs(placement.watchedTop)).toBeLessThanOrEqual(3)
  expect(Math.abs(placement.watchlistBottom)).toBeLessThanOrEqual(3)
  expect(Math.abs(placement.watchedRight)).toBeLessThanOrEqual(3)
  expect(Math.abs(placement.watchlistRight)).toBeLessThanOrEqual(3)
  await saved.locator('[data-explore-action="watchlist"]').click()
  await expect(page.locator('#adultViewingGrid > .adult-viewing-row')).toHaveCount(0)

  await page.locator('[data-viewing-tab="history"]').click()
  const watched = page.locator('#adultViewingGrid > .adult-viewing-row').first()
  await watched.locator('[data-explore-action="watched"]').click()
  await expect(page.locator('#adultViewingGrid > .adult-viewing-row')).toHaveCount(0)
})


test('large Watched libraries paint one bounded batch and extend as the user approaches the end', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine owns long-list rendering')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    adultViewingData = { items: Array.from({ length: 654 }, (_, index) => ({
      key: `movie:${9000 + index}`, media_type: 'movie', tmdb_id: 9000 + index,
      title: `Watched film ${index + 1}`, year: '2025', manual_state: 'watched',
    })) }
    adultViewingLoaded = true
    adultViewingDataRevision += 1
    history.replaceState({ adultViewing: true }, '', '#adult-viewing')
    openView('adult-viewing')
  })

  const initialPaintMs = await page.evaluate(() => new Promise(resolve => {
    const started = performance.now()
    document.querySelector('[data-viewing-tab="history"]').click()
    requestAnimationFrame(() => resolve(performance.now() - started))
  }))
  expect(initialPaintMs).toBeLessThan(250)
  await expect(page.locator('#adultViewingCount')).toHaveText('654 titles')
  await expect(page.locator('#adultViewingGrid > .adult-viewing-row')).toHaveCount(48)
  const first = page.locator('#adultViewingGrid > .adult-viewing-row').first()
  await first.evaluate(row => { window.__firstLongViewingRow = row })
  await page.locator('#adultViewingGrid > .adult-viewing-load-more')
    .evaluate(button => button.click())
  await expect(page.locator('#adultViewingGrid > .adult-viewing-row')).toHaveCount(96)
  await page.locator('[data-viewing-tab="watchlist"]').click()
  await page.locator('[data-viewing-tab="history"]').click()
  await expect(page.locator('#adultViewingGrid > .adult-viewing-row')).toHaveCount(96)
  expect(await first.evaluate(row => window.__firstLongViewingRow === row)).toBe(true)
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
  let watchmodeRequests = 0
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/adult/providers') watchmodeRequests += 1
  })
  await page.route('**/api/adult/title?*', async route => {
    const response = await route.fetch()
    const detail = await response.json()
    detail.providers = [
      { provider_id: 8, name: 'Netflix', type: 'flatrate', label: 'Stream', logo_path: '/netflix.jpg' },
      { provider_id: 350, name: 'Apple TV', type: 'rent', label: 'Rent', logo_path: '/apple.jpg' },
    ]
    await route.fulfill({ response, json: detail })
  })
  await openExplore(page)

  const series = page.locator('.adult-explore-card[data-media-type="tv"]').first()
  await series.locator('[data-explore-action="watched"]').click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(page.locator('#adultTitleSeriesLibrary')).toBeVisible()
  await expect(page.locator('#adultTitleSheet .adult-provider-section')).toBeVisible()
  await expect(page.locator('#adultProviderList .provider-netflix')).toBeVisible()
  await expect(page.locator('#adultTitleRentBuy')).toBeVisible()
  await expect(page.locator('#adultTitleRentBuyToggle')).toContainText('1 service')
  await page.locator('#adultTitleRentBuyToggle').click()
  await expect(page.locator('#adultTitleRentBuyList')).toContainText('Check price')
  expect(watchmodeRequests).toBe(0)
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

test('viewing actions stay local and do not start a full background rebuild', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  const result = await page.evaluate(async () => {
    const originalApi = window.api
    const originalLoad = window.loadAdultViewing
    let refreshStarted = false
    const requests = []
    window.api = async (path, options = {}) => {
      requests.push([path, options.method || 'GET'])
      if (path === '/api/bootstrap') return { revisions: { adult_viewing: 2 } }
      return { key: 'movie:123', viewing: { manual_state: 'watched' } }
    }
    window.loadAdultViewing = () => {
      refreshStarted = true
    }
    try {
      const detail = { media_type: 'movie', tmdb_id: 123, title: 'Fast update', viewing: {} }
      const viewing = await updateAdultViewing(detail, 'watched')
      await new Promise(resolve => setTimeout(resolve, 0))
      return { refreshStarted, requests, returned: viewing.manual_state,
        detail: detail.viewing.manual_state }
    } finally {
      window.api = originalApi
      window.loadAdultViewing = originalLoad
    }
  })
  expect(result.refreshStarted).toBe(false)
  expect(result.requests.filter(([path]) => path === '/api/adult/viewing'))
    .toEqual([['/api/adult/viewing', 'POST']])
  expect(result.requests).toContainEqual(['/api/bootstrap', 'GET'])
  expect(result.returned).toBe('watched')
  expect(result.detail).toBe('watched')
})

test('Adult title controls paint from saved state while title enrichment is delayed', async ({ page }) => {
  await page.route('**/api/adult/title?*', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    await route.continue()
  })
  await page.goto('/')
  await page.evaluate(() => {
    adultViewingData = { items: [{
      key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Finding Nemo',
      overview: 'A saved summary.', watchlisted: true,
    }] }
    adultViewingLoaded = true
    openAdultTitle(adultViewingData.items[0])
  })

  await expect(page.locator('#adultTitleName')).toHaveText('Finding Nemo', { timeout: 300 })
  await expect(page.locator('#adultTitleOverview')).toHaveText('A saved summary.', { timeout: 300 })
  await expect(page.locator('#adultTitleIntents [data-viewing-action="watchlist"]'))
    .toHaveClass(/active/, { timeout: 300 })
  await expect(page.locator('#adultTitleOverview')).toHaveText(
    'Series details opened successfully.', { timeout: 2500 })
})

test('a saved title keeps its provider rows and DOM while background detail refreshes', async ({ page }) => {
  const providers = [
    { provider_id: 8, name: 'Netflix', type: 'flatrate', label: 'Stream',
      logo_path: '/netflix.jpg' },
    { provider_id: 350, name: 'Apple TV', type: 'rent', label: 'Rent',
      logo_path: '/apple.jpg' },
  ]
  const providerResult = { sources: [
    { source_id: 203, name: 'Netflix', type: 'sub',
      web_url: 'https://www.netflix.com/search?q=Finding%20Nemo' },
  ] }
  await page.route('**/api/adult/title?*', async route => {
    await new Promise(resolve => setTimeout(resolve, 900))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Finding Nemo',
      overview: 'Fresh detail for the next opening.', year: '2003',
      release_date: '2003-10-10', poster_path: '/explore-12.jpg', backdrop_path: '',
      providers, cast: [], collection: null, genres: ['Animation'], directors: [],
      seasons: [], viewing: {}, availability_enabled: true, on_mabeltv: false,
    }) })
  })
  await page.route('**/api/adult/providers?*', async route => {
    await new Promise(resolve => setTimeout(resolve, 900))
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(providerResult) })
  })
  await page.goto('/')
  await page.evaluate(async ({ providers, providerResult }) => {
    const cached = {
      key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Finding Nemo',
      overview: 'Saved detail shown immediately.', year: '2003',
      release_date: '2003-10-10', poster_path: '/explore-12.jpg', backdrop_path: '',
      providers, provider_result: providerResult, cast: [], collection: null,
      genres: ['Animation'], directors: [], seasons: [], viewing: {},
      availability_enabled: true, on_mabeltv: false,
    }
    await window.MabelAppCache.write('adult-title-v1:movie:12', 0, cached)
    adultViewingData = { items: [{
      key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Finding Nemo',
      poster_path: '/explore-12.jpg', watchlisted: true,
    }] }
    adultViewingLoaded = true
    void openAdultTitle(adultViewingData.items[0])
  }, { providers, providerResult })

  await expect(page.locator('#adultTitleOverview'))
    .toHaveText('Saved detail shown immediately.', { timeout: 300 })
  await expect(page.locator('#adultProviderList .provider-netflix'))
    .toBeVisible({ timeout: 300 })
  await expect(page.locator('#adultTitleRentBuy')).toBeVisible({ timeout: 300 })
  await page.evaluate(() => { window.__savedTitlePoster = $('#adultTitlePoster img') })
  await page.waitForTimeout(2100)
  expect(await page.evaluate(() => window.__savedTitlePoster === $('#adultTitlePoster img'))).toBe(true)
  await expect(page.locator('#adultTitleOverview')).toHaveText('Saved detail shown immediately.')
})

test('an actor card paints its saved biography and filmography while fresh details load', async ({ page }) => {
  let requests = 0
  const detail = {
    tmdb_id: 500, name: 'Saved Actor', biography: 'A saved actor biography.',
    known_for_department: 'Acting', filmography: [{
      key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Finding Nemo',
      year: '2003', poster_path: '/explore-12.jpg',
    }], known_for: [{
      key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Finding Nemo',
      year: '2003', poster_path: '/explore-12.jpg',
    }],
  }
  await page.route('**/api/adult/person?*', async route => {
    requests += 1
    if (requests > 1) await new Promise(resolve => setTimeout(resolve, 1200))
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(detail) })
  })
  await page.goto('/')
  await page.evaluate(() => openAdultPerson({ tmdb_id: 500, name: 'Saved Actor' }, ''))
  await expect(page.locator('#adultPersonBiography')).toHaveText('A saved actor biography.')
  await page.waitForFunction(async () => Boolean(
    (await window.MabelAppCache?.read('adult-person-v1:500'))?.data,
  ))
  await page.evaluate(() => {
    adultPersonOpenRevision += 1
    document.querySelector('#adultPersonSheet').close()
  })

  await page.evaluate(() => openAdultPerson({ tmdb_id: 500, name: 'Saved Actor' }, ''))
  await expect(page.locator('#adultPersonBiography'))
    .toHaveText('A saved actor biography.', { timeout: 300 })
  await expect(page.locator('#adultPersonFilmography')).toBeVisible({ timeout: 300 })
})

test('My Viewing paints loaded state without fetching the full catalogue again', async ({ page }) => {
  let viewingGets = 0
  await page.route('**/api/adult/viewing', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    viewingGets += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [{ key: 'movie:12', media_type: 'movie', tmdb_id: 12,
        title: 'Finding Nemo', watchlisted: true }],
    }) })
  })
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  const startupGets = viewingGets

  await page.locator('[data-view-button="adult-home"]').click()
  await page.locator('#adultMyViewing').click()
  await expect(page.locator('#adultViewingGrid > .adult-viewing-row')).toHaveCount(1, {
    timeout: 400,
  })
  await page.waitForTimeout(150)
  expect(viewingGets).toBe(startupGets)
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
