import { test, expect } from '@playwright/test'


async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nothing playing' })).toBeVisible()
  await page.evaluate(() => document.fonts?.ready)
}

function titleDetail(identifier, local = false) {
  return {
    key: `tv:${identifier}`, media_type: 'tv', tmdb_id: identifier,
    title: identifier === 6001 ? 'Fixture Series' : 'Foundation', year: '2026',
    overview: 'A complete metadata-first series catalogue.',
    poster_path: '', backdrop_path: '', providers: [{
      provider_id: 8, name: 'Netflix', type: 'flatrate', label: 'Stream', logo_path: '',
    }],
    seasons: [
      { number: 1, name: 'Series 1', episodes: 3, watched_count: 0, poster_path: '' },
      { number: 2, name: 'Series 2', episodes: 2, watched_count: 0, poster_path: '' },
    ],
    on_mabeltv: local, viewing: {},
    local: local ? { kind: 'series', series: 'fixture-series' } : null,
  }
}

function seasonDetail(identifier, season) {
  const count = season === 1 ? 3 : 2
  return {
    key: `tv:${identifier}`, season, name: `Series ${season}`,
    overview: `The official Series ${season} episode catalogue.`, poster_path: '',
    episodes: Array.from({ length: count }, (_, index) => ({
      number: index + 1, name: `Official episode ${index + 1}`,
      air_date: `2026-01-0${index + 1}`, runtime: 48,
      overview: '', still_path: '', watched: false,
    })),
  }
}

test('series sheets use the full metadata catalogue with local availability overlaid', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone series-card contract')
  await page.route(url => new URL(url).pathname === '/api/adult/title', route => {
    const identifier = Number(new URL(route.request().url()).searchParams.get('tmdb_id'))
    return route.fulfill({ json: titleDetail(identifier, identifier === 6001) })
  })
  await page.route(url => new URL(url).pathname === '/api/adult/season', route => {
    const url = new URL(route.request().url())
    return route.fulfill({ json: seasonDetail(
      Number(url.searchParams.get('tmdb_id')), Number(url.searchParams.get('season'))) })
  })
  await openPortal(page)
  await page.evaluate(() => {
    library.adult_series = [{
      id: 'fixture-series', title: 'Fixture Series', favourite: true,
      metadata: { tmdb_id: 6001, title: 'Fixture Series',
        overview: 'A stable series-card regression fixture.' },
      seasons: [1], season_count: 1, episode_count: 1, watched_count: 0,
      episodes: [{ season: 1, episode: 1, path: 'Season 1/Episode 1.mp4',
        display_name: 'Official episode 1', watched: false, browser_ready: true }],
    }]
    renderHomeLibrary()
  })

  await page.getByRole('button', { name: 'Open favourite series Fixture Series' }).click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(page.locator('#adultTitleSheet .watch-film-summary')).toHaveCSS('box-shadow', 'none')
  await expect(page.locator('#adultTitleSheet .watch-film-summary')).toHaveCSS('border-bottom-width', '1px')
  await expect(page.locator('#adultSeriesSheet')).toBeHidden()
  await expect(page.locator('#adultTitleName')).toHaveText('Fixture Series')
  await expect(page.locator('#adultTitleOverview + #adultTitleIntents')).toBeVisible()
  await expect(page.locator('#adultTitleSeasons .adult-season-card')).toHaveCount(2)
  await expect(page.locator('#adultTitleSeasons [data-season="1"] .adult-season-card-copy small'))
    .toContainText('1 of 3 on MabelTV')
  await expect(page.locator('#adultTitleSeasons [data-season="2"] .adult-season-card-copy small'))
    .toContainText('Not on MabelTV')
  await expect(page.locator('#adultTitleSeasons .adult-season-add-card')).toHaveCount(0)
  const mabelProvider = page.locator('#adultProviderList .provider-mabeltv')
  await expect(mabelProvider).toBeVisible()
  await expect(mabelProvider).toHaveJSProperty('tagName', 'SPAN')
  await expect(page.locator('#adultProviderList .provider-netflix')).toHaveJSProperty('tagName', 'BUTTON')
  await expect(page.locator('#adultTitleMore')).toBeVisible()

  await page.locator('#adultTitleSeasons [data-season="1"]').click()
  await expect(page.locator('#adultTitleSeasonSheet')).toBeVisible()
  await expect(page.locator('#adultTitleSeasonEpisodes .adult-series-episode')).toHaveCount(3)
  await expect(page.locator('#adultTitleSeasonEpisodes [data-episode="1"] .adult-episode-availability'))
    .toHaveText('On MabelTV')
  await expect(page.locator('#adultTitleSeasonEpisodes [data-episode="2"] .adult-episode-availability'))
    .toBeHidden()
  await expect(page.locator('#adultTitleSeasonManagementTitle')).toHaveText('Series settings')
  await expect(page.locator('#adultTitleSeasonUpload')).toBeVisible()
  await expect(page.locator('#adultTitleSeasonDelete')).toHaveText(/Remove series from MabelTV/)

  await page.locator('#adultTitleSeasonClose').click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await page.locator('#adultTitleClose').click()
  await expect(page.locator('#adultTitleSheet')).toBeHidden()
  await page.getByRole('button', { name: 'Watch', exact: true }).click()
  await page.locator('#watchAdultTab').click()
  await page.evaluate(() => {
    library.adult_series = []
    document.querySelector('#watchAdultLayout').classList.remove('hidden')
    document.querySelector('#view-watch').classList.add('adult-search-mode')
    document.querySelector('#adultDiscoverySection').classList.remove('hidden')
    document.querySelector('#adultDiscoveryGrid').replaceChildren(adultDiscoveryCard({
      media_type: 'tv', tmdb_id: 6002, title: 'Foundation', year: '2026',
      overview: 'A global-search result regression fixture.',
    }))
  })
  await page.evaluate(() => openAdultTitle({
    media_type: 'tv', tmdb_id: 6002, title: 'Foundation', year: '2026',
  }))
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(page.locator('#adultTitleName')).toHaveText('Foundation')
  await expect(page.locator('#adultTitleSeasons .adult-season-card')).toHaveCount(2)
  const mabelTvFact = page.locator('#adultTitleMeta .adult-title-fact')
    .filter({ has: page.locator('small', { hasText: /^MabelTV$/ }) })
  await expect(mabelTvFact).toHaveCount(1)
  await expect(mabelTvFact.locator('strong')).toHaveText('Not available')
  await expect(page.locator('#adultProviderList .provider-mabeltv')).toHaveCount(0)
  await expect(page.locator('#adultTitleMore')).toBeHidden()
  await page.locator('#adultTitleSeasons [data-season="1"]').click()
  await expect(page.locator('#adultTitleSeasonEpisodes .adult-series-episode')).toHaveCount(3)
  await expect(page.locator('#adultTitleSeasonUpload')).toBeVisible()
  await expect(page.locator('#adultTitleSeasonMetadata')).toBeHidden()
  await expect(page.locator('#adultTitleSeasonRestart')).toBeHidden()
  await expect(page.locator('#adultTitleSeasonDelete')).toBeHidden()
})

test('adding a catalogue season prepares its local destination without a create-series card', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers the provisioning contract')
  await openPortal(page)
  const result = await page.evaluate(async () => {
    const calls = []
    library.adult_series = []
    window.reloadLibraryWithoutLosingPlace = async () => {}
    window.api = async (path, options = {}) => {
      const payload = options.body ? JSON.parse(options.body) : {}
      calls.push({ path, action: payload.action || '', tmdb_id: payload.tmdb_id || 0 })
      if (payload.action === 'create-adult-series') {
        library.adult_series = [{
          id: 'prepared-series', title: 'Foundation', stored_title: 'Foundation',
          metadata: {}, seasons: [], episodes: [], season_count: 0,
          episode_count: 0, watched_count: 0,
        }]
      } else if (path === '/api/tmdb/adult-series/apply') {
        library.adult_series[0].metadata = { tmdb_id: payload.tmdb_id, title: 'Foundation' }
      } else if (payload.action === 'create-adult-season') {
        library.adult_series[0].seasons = [2]
        library.adult_series[0].season_count = 1
      }
      return { ok: true }
    }
    const detail = { media_type: 'tv', tmdb_id: 6002, title: 'Foundation', local: null }
    const series = await ensureAdultTitleSeasonStorage(detail, { number: 2, episodes: 10 })
    return { calls, series, detail }
  })
  expect(result.calls.map(call => call.action || call.path)).toEqual([
    'create-adult-series', '/api/tmdb/adult-series/apply', 'create-adult-season',
  ])
  expect(result.calls[1].tmdb_id).toBe(6002)
  expect(result.series.seasons).toEqual([2])
  expect(result.detail.local).toEqual({
    kind: 'series', series: 'prepared-series', watched_count: 0,
  })
  expect(result.detail.on_mabeltv).toBe(false)
})

test('TV series rail includes local episodes and Up Next, without tinting a false Watchlist state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers the rail state contract')
  await openPortal(page)
  const state = await page.evaluate(() => {
    library.adult_series = [{
      id: 'ludwig', title: 'Ludwig', metadata: { tmdb_id: 243360 },
      seasons: [], episodes: [], season_count: 0, episode_count: 0, watched_count: 0,
    }, {
      id: 'local-show', title: 'Local Show', metadata: { tmdb_id: 7001 },
      seasons: [1], season_count: 1, episode_count: 1, watched_count: 0,
      episodes: [{ season: 1, episode: 1, display_name: 'Pilot' }],
    }, {
      id: 'queued-show', title: 'Queued Show', metadata: { tmdb_id: 7002 },
      seasons: [], episodes: [], season_count: 0, episode_count: 0, watched_count: 0,
    }]
    const ludwig = {
      key: 'tv:243360', media_type: 'tv', tmdb_id: 243360, title: 'Ludwig',
      watchlisted: false, up_next: false, manual_state: 'not_watched',
      episodes: Object.fromEntries(Array.from({ length: 7 }, (_, index) =>
        [`1:${index + 1}`, { watched: true }])),
    }
    adultViewingData = { items: [ludwig, {
      key: 'tv:7002', media_type: 'tv', tmdb_id: 7002, title: 'Queued Show', up_next: true,
    }, {
      key: 'tv:7003', media_type: 'tv', tmdb_id: 7003, title: 'Streaming Show', up_next: true,
    }] }
    adultViewingLoaded = true
    renderAdultSeries()
    wireAdultTitleIntentActions({ media_type: 'tv', viewing: ludwig })
    const watchlist = document.querySelector('#adultTitleIntents [data-viewing-action="watchlist"]')
    const watched = document.querySelector('#adultTitleIntents [data-viewing-action="watched"]')
    const probe = document.querySelector('#adultTitleIntents').cloneNode(true)
    probe.id = 'adultTitleIntentWidthProbe'
    probe.style.cssText = 'position:fixed;left:0;top:0;width:337px;z-index:-1'
    document.body.append(probe)
    const probeButton = probe.querySelector('[data-viewing-action="watched"]')
    const probeLabel = probeButton.querySelector('strong')
    const buttonBox = probeButton.getBoundingClientRect()
    const labelBox = probeLabel.getBoundingClientRect()
    const statusFits = labelBox.left >= buttonBox.left && labelBox.right <= buttonBox.right
      && labelBox.top >= buttonBox.top && labelBox.bottom <= buttonBox.bottom
    probe.remove()
    adultViewingTab = 'part-watched'
    renderAdultViewing()
    return {
      titles: [...document.querySelectorAll('#adultSeriesRail .adult-series-card strong')]
        .map(node => node.textContent),
      watchlistPressed: watchlist.getAttribute('aria-pressed'),
      watchlistClasses: [...watchlist.classList],
      watchedLabel: watched.querySelector('strong').textContent,
      watchedPressed: watched.getAttribute('aria-pressed'),
      watchedDisabled: watched.disabled,
      watchedOnClick: watched.onclick,
      watchedWhiteSpace: getComputedStyle(watched.querySelector('strong')).whiteSpace,
      statusFits,
      partWatchedTitles: [...document.querySelectorAll('#adultViewingGrid .adult-viewing-copy strong')]
        .map(node => node.textContent),
    }
  })
  expect(state.titles).toEqual(['Local Show', 'Queued Show', 'Streaming Show'])
  expect(state.watchlistPressed).toBe('false')
  expect(state.watchlistClasses).not.toContain('active')
  expect(state.watchlistClasses).not.toContain('is-progress')
  expect(state.watchedLabel).toBe('Part Watched')
  expect(state.watchedPressed).toBe('true')
  expect(state.watchedDisabled).toBe(true)
  expect(state.watchedOnClick).toBeNull()
  expect(state.watchedWhiteSpace).toBe('normal')
  expect(state.statusFits).toBe(true)
  expect(state.partWatchedTitles).toEqual(['Ludwig'])
  await expect(page.getByText('Up Next · No episodes on MabelTV')).toHaveCount(2)
})

test('series progress automatically moves between the read-only Part Watched and Watched states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers automatic series status')
  await openPortal(page)
  const actions = await page.evaluate(async () => {
    const recorded = []
    window.updateAdultViewing = async (detail, action) => {
      recorded.push(action)
      return { ...detail.viewing, manual_state: action }
    }
    const detail = {
      media_type: 'tv', tmdb_id: 8001, title: 'Progress Series', viewing: {},
      seasons: [
        { number: 1, episodes: 2, watched_count: 1 },
        { number: 2, episodes: 1, watched_count: 0 },
      ],
    }
    await syncAdultTitleEpisodeStatus(detail)
    detail.seasons[0].watched_count = 2
    detail.seasons[1].watched_count = 1
    await syncAdultTitleEpisodeStatus(detail)
    detail.viewing = { ...detail.viewing, series_watching: true }
    await syncAdultTitleEpisodeStatus(detail)
    return recorded
  })
  expect(actions).toEqual(['part_watched', 'watched'])
})

test('Restart Watching clears the show once and returns past the More menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers the restart sheet flow')
  await openPortal(page)
  await page.evaluate(() => {
    const series = {
      id: 'restart-series', title: 'Ludwig', favourite: false,
      metadata: { tmdb_id: 243360, title: 'Ludwig' },
      seasons: [1, 2], season_count: 2, episode_count: 12, watched_count: 7,
      episodes: [],
    }
    library.adult_series = [series]
    window.__restartRequests = []
    window.__restartReturned = false
    window.api = async (path, options = {}) => {
      if (path !== '/api/adult/series/restart') throw new Error(`Unexpected request: ${path}`)
      window.__restartRequests.push(JSON.parse(options.body))
      return { ok: true, episodes_reset: 7 }
    }
    window.reloadLibraryWithoutLosingPlace = async () => {}
    window.updateAdultViewing = async () => { throw new Error('Restart must not change a manual list') }
    openAdultSeriesMoreSheet(series, null, () => { window.__restartReturned = true })
  })

  await page.locator('#adultSeriesRestart').click()
  await expect(page.locator('#adultSeriesRestartSheet')).toHaveAttribute('open', '')
  await page.locator('#adultSeriesRestartConfirm').click()
  await expect.poll(() => page.evaluate(() => window.__restartReturned)).toBe(true)

  const result = await page.evaluate(() => ({
    requests: window.__restartRequests,
    restartOpen: document.querySelector('#adultSeriesRestartSheet').open,
    moreOpen: document.querySelector('#adultSeriesMoreSheet').open,
  }))
  expect(result.requests).toEqual([{
    series: 'restart-series', scope: 'series', season: null,
  }])
  expect(result.restartOpen).toBe(false)
  expect(result.moreOpen).toBe(false)
})
