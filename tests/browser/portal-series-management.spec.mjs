import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })


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
    first_air_date: '2026-01-02', last_air_date: '2026-09-08',
    overview: 'A complete metadata-first series catalogue.',
    genres: ['Drama'], directors: ['Jane Creator'], rating: 8.2,
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
  await page.route(url => new URL(url).pathname === '/api/my-tv/title', route => {
    const identifier = Number(new URL(route.request().url()).searchParams.get('tmdb_id'))
    return route.fulfill({ json: titleDetail(identifier, identifier === 6001) })
  })
  await page.route(url => new URL(url).pathname === '/api/my-tv/season', route => {
    const url = new URL(route.request().url())
    return route.fulfill({ json: seasonDetail(
      Number(url.searchParams.get('tmdb_id')), Number(url.searchParams.get('season'))) })
  })
  await openPortal(page)
  await page.evaluate(() => {
    library.my_tv_series = [{
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
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await expect(page.locator('#myTvTitleSheet .watch-film-summary')).toHaveCSS('box-shadow', 'none')
  await expect(page.locator('#myTvTitleSheet .watch-film-summary')).toHaveCSS('border-bottom-width', '1px')
  await expect(page.locator('#myTvSeriesSheet')).toBeHidden()
  await expect(page.locator('#myTvTitleName')).toHaveText('Fixture Series')
  await expect(page.locator('#myTvTitleSeasons .my-tv-season-card')).toHaveCount(2)
  await expect(page.locator('#myTvTitleMeta .my-tv-title-fact').first().locator('small'))
    .toHaveText('Aired from')
  await expect(page.locator('#myTvTitleMeta .my-tv-title-fact').first().locator('strong'))
    .toHaveText('2 Jan 2026')
  await expect(page.locator('#myTvTitleMeta')).not.toContainText('8 Sep 2026')
  await expect(page.locator('#myTvTitleMeta .my-tv-title-fact small'))
    .toHaveText(['Aired from', 'Series', 'Episodes', 'Genre', 'Created by', 'TMDB'])
  await expect(page.locator('#myTvTitleMeta')).not.toContainText('Watched')
  await expect(page.locator('#myTvTitleMeta')).not.toContainText('Mabel TV')
  await expect(page.locator('#myTvTitleOverview + #myTvTitleIntents')).toBeVisible()
  await expect(page.locator('#myTvTitleSeasons [data-season="1"] .my-tv-season-card-copy small'))
    .toContainText('1 of 3 on Mabel TV')
  await expect(page.locator('#myTvTitleSeasons [data-season="2"] .my-tv-season-card-copy small'))
    .toContainText('Not on Mabel TV')
  await expect(page.locator('#myTvTitleSeasons .my-tv-season-add-card')).toHaveCount(0)
  const mabelProvider = page.locator('#myTvProviderList .provider-mabeltv')
  await expect(mabelProvider).toBeVisible()
  await expect(mabelProvider).toHaveJSProperty('tagName', 'SPAN')
  await expect(page.locator('#myTvProviderList .provider-netflix')).toHaveJSProperty('tagName', 'BUTTON')
  await expect(page.locator('#myTvTitleMore')).toBeVisible()
  await expect(page.locator('#myTvTitleMore use')).toHaveAttribute('href', '/portal/icons.svg#signal-cog')
  await page.screenshot({ path: testInfo.outputPath('series-card-header-gear.png') })

  await page.locator('#myTvTitleSeasons [data-season="1"]').click()
  await expect(page.locator('#myTvTitleSeasonSheet')).toBeVisible()
  await expect(page.locator('#myTvTitleSeasonSheet > .library-sheet-panel .portal-card-back')).toBeVisible()
  await expect(page.locator('#myTvTitleSeasonEpisodes .my-tv-series-episode')).toHaveCount(3)
  await expect(page.locator('#myTvTitleSeasonMeta .my-tv-title-fact small'))
    .toHaveText(['Episodes', 'On Mabel TV', 'Watched'])
  await expect(page.locator('#myTvTitleSeasonMeta .my-tv-title-fact strong'))
    .toHaveText(['3', '1', '0'])
  await expect(page.locator('#myTvTitleSeasonEpisodes [data-episode="1"] .my-tv-episode-availability'))
    .toHaveText('On Mabel TV')
  await expect(page.locator('#myTvTitleSeasonEpisodes [data-episode="1"] .my-tv-series-episode-copy small'))
    .toHaveText('1 Jan 2026 · 48 min')
  await expect(page.locator('#myTvTitleSeasonEpisodes [data-episode="1"] .my-tv-series-episode-copy small'))
    .not.toContainText('Watched')
  await page.locator('#myTvTitleSeasonEpisodes [data-episode="1"] .my-tv-streaming-episode-toggle')
    .evaluate(element => element.classList.add('active'))
  const episodeColours = await page.locator('#myTvTitleSeasonEpisodes [data-episode="1"]').evaluate(row => ({
    availability: getComputedStyle(row.querySelector('.my-tv-episode-availability')).color,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--experience-orange').trim(),
    metadata: getComputedStyle(row.querySelector('.my-tv-series-episode-copy small')).color,
    watched: getComputedStyle(row.querySelector('.my-tv-streaming-episode-toggle')).color,
  }))
  expect(episodeColours.availability).toBe(episodeColours.accent)
  expect(episodeColours.metadata).not.toBe(episodeColours.watched)
  const episodeAlignment = await page.locator('#myTvTitleSeasonSheet').evaluate(sheet => ({
    artwork: sheet.querySelector('.my-tv-streaming-episode .my-tv-series-episode-art')
      .getBoundingClientRect().left,
    bulk: sheet.querySelector('.my-tv-season-bulk-action').getBoundingClientRect().left,
    copy: sheet.querySelector('.my-tv-streaming-episode .my-tv-series-episode-copy')
      .getBoundingClientRect().left,
  }))
  expect(Math.abs(episodeAlignment.artwork - episodeAlignment.bulk)).toBeLessThanOrEqual(1)
  expect(episodeAlignment.copy - episodeAlignment.artwork).toBeGreaterThanOrEqual(84)
  await expect(page.locator('#myTvTitleSeasonEpisodes [data-episode="2"] .my-tv-episode-availability'))
    .toBeHidden()
  await expect(page.locator('#myTvTitleSeasonSettings')).toBeVisible()
  await expect(page.locator('#myTvTitleSeasonSettings use'))
    .toHaveAttribute('href', '/portal/icons.svg#signal-cog')
  const gearTreatment = await page.locator('#myTvTitleSeasonSettings').evaluate(control => {
    control.focus()
    const style = getComputedStyle(control)
    return { border: style.borderTopWidth, background: style.backgroundColor,
      outline: style.outlineStyle }
  })
  expect(gearTreatment).toEqual({ border: '0px', background: 'rgba(0, 0, 0, 0)',
    outline: 'none' })
  await page.locator('#myTvTitleSeasonSettings').click()
  const settings = page.locator('#myTvTitleSeasonSettingsSheet')
  await expect(settings).toBeVisible()
  await expect(page.locator('#myTvTitleSeasonUpload')).toBeVisible()
  await expect(page.locator('#myTvTitleSeasonDelete')).toHaveText(/Remove series from Mabel TV/)
  const settingsHeight = await settings.locator('article').evaluate(panel =>
    panel.getBoundingClientRect().height)
  const cardHeight = await page.evaluate(() => window.innerHeight)
  expect(settingsHeight).toBeLessThan(cardHeight * 0.8)
  await page.screenshot({ path: testInfo.outputPath('streaming-series-settings.png') })
  await page.locator('#myTvTitleSeasonSettingsClose').click()
  await expect(page.locator('#myTvTitleSeasonSheet')).toBeVisible()

  await page.locator('#myTvTitleSeasonSheet > .library-sheet-panel .portal-card-back').click()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await page.locator('#myTvTitleClose').click()
  await expect(page.locator('#myTvTitleSheet')).toBeHidden()
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.evaluate(() => {
    library.my_tv_series = []
    document.querySelector('#view-my-tv-home').classList.add('my-tv-search-mode')
    document.querySelector('#myTvDiscoverySection').classList.remove('hidden')
    document.querySelector('#myTvDiscoveryGrid').replaceChildren(myTvDiscoveryCard({
      media_type: 'tv', tmdb_id: 6002, title: 'Foundation', year: '2026',
      overview: 'A global-search result regression fixture.',
    }))
  })
  await page.evaluate(() => openMyTvTitle({
    media_type: 'tv', tmdb_id: 6002, title: 'Foundation', year: '2026',
  }))
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await expect(page.locator('#myTvTitleName')).toHaveText('Foundation')
  await expect(page.locator('#myTvTitleSeasons .my-tv-season-card')).toHaveCount(2)
  await expect(page.locator('#myTvTitleMeta')).not.toContainText('Mabel TV')
  await expect(page.locator('#myTvProviderList .provider-mabeltv')).toHaveCount(0)
  await expect(page.locator('#myTvTitleMore')).toBeHidden()
  await page.locator('#myTvTitleSeasons [data-season="1"]').click()
  await expect(page.locator('#myTvTitleSeasonEpisodes .my-tv-series-episode')).toHaveCount(3)
  await expect(page.locator('#myTvTitleSeasonMeta .my-tv-title-fact strong'))
    .toHaveText(['3', '0', '0'])
  await expect(page.locator('#myTvTitleSeasonSettings')).toBeVisible()
  await page.locator('#myTvTitleSeasonSettings').click()
  await expect(page.locator('#myTvTitleSeasonSettingsSheet')).toBeVisible()
  await expect(page.locator('#myTvTitleSeasonUpload')).toBeVisible()
  await expect(page.locator('#myTvTitleSeasonMetadata')).toBeHidden()
  await expect(page.locator('#myTvTitleSeasonRestart')).toBeHidden()
  await expect(page.locator('#myTvTitleSeasonDelete')).toBeHidden()
  await page.locator('#myTvTitleSeasonSettingsClose').click()
  await page.locator('#myTvTitleSeasonEpisodes [data-episode="1"] .my-tv-streaming-episode-toggle').click()
  await page.locator('#myTvTitleSeasonSettings').click()
  await expect(page.locator('#myTvTitleSeasonRestart')).toBeVisible()
  await expect(page.locator('#myTvTitleSeasonMetadata')).toBeHidden()
  await expect(page.locator('#myTvTitleSeasonDelete')).toBeHidden()
})

test('adding a catalogue season prepares its local destination without a create-series card', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers the provisioning contract')
  await openPortal(page)
  const result = await page.evaluate(async () => {
    const calls = []
    library.my_tv_series = []
    window.reloadLibraryWithoutLosingPlace = async () => {}
    window.api = async (path, options = {}) => {
      const payload = options.body ? JSON.parse(options.body) : {}
      calls.push({ path, action: payload.action || '', tmdb_id: payload.tmdb_id || 0 })
      if (payload.action === 'create-my-tv-series') {
        library.my_tv_series = [{
          id: 'prepared-series', title: 'Foundation', stored_title: 'Foundation',
          metadata: {}, seasons: [], episodes: [], season_count: 0,
          episode_count: 0, watched_count: 0,
        }]
      } else if (path === '/api/tmdb/my-tv-series/apply') {
        library.my_tv_series[0].metadata = { tmdb_id: payload.tmdb_id, title: 'Foundation' }
      } else if (payload.action === 'create-my-tv-season') {
        library.my_tv_series[0].seasons = [2]
        library.my_tv_series[0].season_count = 1
      }
      return { ok: true }
    }
    const detail = { media_type: 'tv', tmdb_id: 6002, title: 'Foundation', local: null }
    const series = await ensureMyTvTitleSeasonStorage(detail, { number: 2, episodes: 10 })
    return { calls, series, detail }
  })
  expect(result.calls.map(call => call.action || call.path)).toEqual([
    'create-my-tv-series', '/api/tmdb/my-tv-series/apply', 'create-my-tv-season',
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
  await page.route(url => new URL(url).pathname === '/api/my-tv/title', route => {
    const identifier = Number(new URL(route.request().url()).searchParams.get('tmdb_id'))
    const detail = titleDetail(identifier)
    if (identifier === 7002) {
      detail.seasons = [
        { number: 1, episodes: 6, watched_count: 1 },
        { number: 2, episodes: 8, watched_count: 0 },
      ]
    } else if (identifier === 7003) {
      detail.seasons = [{ number: 1, episodes: 10, watched_count: 0 }]
    }
    return route.fulfill({ json: detail })
  })
  await openPortal(page)
  const state = await page.evaluate(() => {
    library.my_tv_series = [{
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
    myTvViewingData = { items: [ludwig, {
      key: 'tv:7002', media_type: 'tv', tmdb_id: 7002, title: 'Queued Show', up_next: true,
    }, {
      key: 'tv:7003', media_type: 'tv', tmdb_id: 7003, title: 'Streaming Show', up_next: true,
    }] }
    myTvViewingLoaded = true
    renderMyTvSeries()
    wireMyTvTitleIntentActions({ media_type: 'tv', viewing: ludwig })
    const watchlist = document.querySelector('#myTvTitleIntents [data-viewing-action="watchlist"]')
    const watched = document.querySelector('#myTvTitleIntents [data-viewing-action="watched"]')
    const probe = document.querySelector('#myTvTitleIntents').cloneNode(true)
    probe.id = 'myTvTitleIntentWidthProbe'
    probe.style.cssText = 'position:fixed;left:0;top:0;width:337px;z-index:-1'
    document.body.append(probe)
    const probeButton = probe.querySelector('[data-viewing-action="watched"]')
    const probeLabel = probeButton.querySelector('strong')
    const buttonBox = probeButton.getBoundingClientRect()
    const labelBox = probeLabel.getBoundingClientRect()
    const statusFits = labelBox.left >= buttonBox.left && labelBox.right <= buttonBox.right
      && labelBox.top >= buttonBox.top && labelBox.bottom <= buttonBox.bottom
    probe.remove()
    myTvViewingTab = 'part-watched'
    renderMyTvViewing()
    return {
      titles: [...document.querySelectorAll('#myTvSeriesRail .my-tv-series-card > span:last-child > strong')]
        .map(node => node.textContent),
      localFacts: [...document.querySelectorAll('#myTvSeriesRail .my-tv-series-card:first-child .my-tv-title-fact')]
        .map(node => [node.querySelector('small').textContent, node.querySelector('strong').textContent]),
      watchlistPressed: watchlist.getAttribute('aria-pressed'),
      watchlistClasses: [...watchlist.classList],
      watchedLabel: watched.querySelector('strong').textContent,
      watchedPressed: watched.getAttribute('aria-pressed'),
      watchedDisabled: watched.disabled,
      watchedOnClick: watched.onclick,
      watchedWhiteSpace: getComputedStyle(watched.querySelector('strong')).whiteSpace,
      statusFits,
      partWatchedTitles: [...document.querySelectorAll('#myTvViewingGrid .my-tv-viewing-copy strong')]
        .map(node => node.textContent),
    }
  })
  expect(state.titles).toEqual(['Local Show', 'Queued Show', 'Streaming Show'])
  expect(state.localFacts).toEqual([['Series', '1'], ['Episodes', '1'], ['Watched', '0']])
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
  await page.evaluate(() => {
    const section = document.querySelector('#myTvSeriesSection')
    document.body.append(section)
    section.classList.remove('hidden')
    renderMyTvSeries()
  })
  const longTitle = page.locator('#myTvSeriesRail .my-tv-series-card:first-child > span:last-child > strong')
  await expect(longTitle).toBeVisible()
  await longTitle.evaluate(element => {
    element.textContent = 'The Lord of the Rings: The Rings of Power and the Longest Possible Subtitle'
  })
  const titleTreatment = await longTitle.evaluate(element => ({
    clamp: getComputedStyle(element).webkitLineClamp,
    lines: Math.round(element.getBoundingClientRect().height
      / Number.parseFloat(getComputedStyle(element).lineHeight)),
  }))
  expect(titleTreatment).toEqual({ clamp: '2', lines: 2 })
  const queuedFacts = page.locator('#myTvSeriesRail .my-tv-series-card')
    .filter({ hasText: 'Queued Show' }).locator('.my-tv-title-fact')
  await expect(queuedFacts).toHaveText(['Series2', 'Episodes14', 'Watched1'])
  const streamingFacts = page.locator('#myTvSeriesRail .my-tv-series-card')
    .filter({ hasText: 'Streaming Show' }).locator('.my-tv-title-fact')
  await expect(streamingFacts).toHaveText(['Series1', 'Episodes10', 'Watched0'])
  const factLayout = await page.locator('#myTvSeriesRail .my-tv-series-card:first-child .my-tv-title-fact')
    .evaluateAll(facts => {
      const [series, episodes, watched] = facts.map(fact => fact.getBoundingClientRect())
      return {
        columnGap: Math.round(episodes.left - series.right),
        watchedAligned: Math.round(watched.left - series.left),
        watchedBelow: watched.top > series.top,
      }
    })
  expect(factLayout.columnGap).toBeGreaterThanOrEqual(20)
  expect(factLayout.columnGap).toBeLessThanOrEqual(28)
  expect(Math.abs(factLayout.watchedAligned)).toBeLessThanOrEqual(1)
  expect(factLayout.watchedBelow).toBe(true)
})

test('series progress automatically moves between the read-only Part Watched and Watched states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers automatic series status')
  await openPortal(page)
  const actions = await page.evaluate(async () => {
    const recorded = []
    window.updateMyTvViewing = async (detail, action) => {
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
    await syncMyTvTitleEpisodeStatus(detail)
    detail.seasons[0].watched_count = 2
    detail.seasons[1].watched_count = 1
    await syncMyTvTitleEpisodeStatus(detail)
    detail.viewing = { ...detail.viewing, series_watching: true }
    await syncMyTvTitleEpisodeStatus(detail)
    return recorded
  })
  expect(actions).toEqual(['part_watched', 'watched'])
})

test('episode actions stay compact and long streaming titles clear the close control', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine covers compact menu geometry')
  await openPortal(page)
  await page.evaluate(() => {
    $('#myTvEpisodeLaunchEyebrow').textContent = 'The Miniature Wife · Series 1, Episode 1'
    $('#myTvEpisodeLaunchTitle').textContent = 'Lady Tomato and Mr F. Tomato Have Extremely Long Names'
    portalSheets.open($('#myTvEpisodeLaunchSheet'))
  })
  const launchGeometry = await page.locator('#myTvEpisodeLaunchSheet').evaluate(sheet => {
    const titleNode = sheet.querySelector('h2')
    const title = titleNode.getBoundingClientRect()
    const close = sheet.querySelector('.portal-sheet-close').getBoundingClientRect()
    return { titleRight: title.right, closeLeft: close.left, titleLines: Math.round(
      title.height / Number.parseFloat(getComputedStyle(titleNode).lineHeight)) }
  })
  expect(launchGeometry.titleRight).toBeLessThanOrEqual(launchGeometry.closeLeft)
  expect(launchGeometry.titleLines).toBeGreaterThan(1)
  await page.locator('#myTvEpisodeLaunchClose').click()
  await page.evaluate(() => {
    const episode = { season: 1, episode: 1, path: 'Series 1/Episode 1.mp4',
      display_name: 'Lady Tomato and Mr F. Tomato Have Extremely Long Names', browser_ready: true }
    const series = { id: 'miniature-wife', title: 'The Miniature Wife', episodes: [episode],
      season_count: 1, episode_count: 1, watched_count: 0, metadata: {} }
    library.my_tv_series = [series]
    openMyTvEpisodeSheet(series, episode)
  })
  const episodeSheet = page.locator('#myTvEpisodeSheet')
  await expect(episodeSheet).toBeVisible()
  await expect(episodeSheet.locator('.portal-card-back')).toHaveCount(0)
  await expect(episodeSheet.locator('#myTvEpisodeMore')).toHaveCount(0)
  await expect(episodeSheet.locator('#myTvEpisodeDownload')).toBeVisible()
  await expect(episodeSheet.locator('#myTvEpisodeDownload')).toHaveClass(/sheet-download-trigger/)
  await expect(episodeSheet.locator('#myTvEpisodeDelete')).toBeVisible()
  const panelHeight = await episodeSheet.locator('article').evaluate(panel =>
    panel.getBoundingClientRect().height)
  expect(panelHeight).toBeLessThan(await page.evaluate(() => window.innerHeight * 0.9))
  await page.screenshot({ path: testInfo.outputPath('compact-episode-actions.png') })
})

test('Restart Watching clears the show once and returns past the settings menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers the restart sheet flow')
  await openPortal(page)
  await page.evaluate(() => {
    const series = {
      id: 'restart-series', title: 'Ludwig', favourite: false,
      metadata: { tmdb_id: 243360, title: 'Ludwig' },
      seasons: [1, 2], season_count: 2, episode_count: 12, watched_count: 7,
      episodes: [],
    }
    library.my_tv_series = [series]
    window.__restartRequests = []
    window.__restartReturned = false
    window.api = async (path, options = {}) => {
      if (path !== '/api/my-tv/series/restart') throw new Error(`Unexpected request: ${path}`)
      window.__restartRequests.push(JSON.parse(options.body))
      return { ok: true, episodes_reset: 7 }
    }
    window.reloadLibraryWithoutLosingPlace = async () => {}
    window.updateMyTvViewing = async () => { throw new Error('Restart must not change a manual list') }
    openMyTvSeriesMoreSheet(series, null, () => { window.__restartReturned = true })
  })

  await page.locator('#myTvSeriesRestart').click()
  await expect(page.locator('#myTvSeriesRestartSheet')).toHaveAttribute('open', '')
  await page.locator('#myTvSeriesRestartConfirm').click()
  await expect.poll(() => page.evaluate(() => window.__restartReturned)).toBe(true)

  const result = await page.evaluate(() => ({
    requests: window.__restartRequests,
    restartOpen: document.querySelector('#myTvSeriesRestartSheet').open,
    moreOpen: document.querySelector('#myTvSeriesMoreSheet').open,
  }))
  expect(result.requests).toEqual([{
    series: 'restart-series', scope: 'series', season: null,
  }])
  expect(result.restartOpen).toBe(false)
  expect(result.moreOpen).toBe(false)
})
