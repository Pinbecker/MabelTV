import { test, expect } from './test-fixtures.mjs'

async function openPortal(page, theme) {
  await page.addInitScript(theme => {
    localStorage.setItem('mabeltv-experience-theme', theme)
    localStorage.setItem('mabeltv-experience-accent-hue', '184')
  }, theme)
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

async function expectHeaderClear(page, sheet, closeId) {
  const header = page.locator(`${sheet} header`).first()
  const close = page.locator(closeId)
  const copy = await header.locator(':scope > div').first().boundingBox()
  const button = await close.boundingBox()
  expect(copy.x + copy.width).toBeLessThanOrEqual(button.x - 4)
  expect(await close.evaluate(element => {
    const r = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  })).toBe(true)
}

test('Watchmode can be disabled while TMDB title exploration remains available', async ({ page }) => {
  let providerRequests = 0
  await page.route(url => new URL(url).pathname === '/api/my-tv/providers', route => {
    providerRequests += 1
    return route.abort()
  })
  await openPortal(page, 'dark')
  await page.evaluate(() => {
    library.my_tv_settings.watchmode_availability_enabled = false
    renderWatchmodeAvailabilitySetting()
    openMyTvTitle({ key: 'movie:12', media_type: 'movie', tmdb_id: 12,
      title: 'Finding Nemo' })
  })
  await expect(page.locator('#watchmodeAvailabilityToggle')).toHaveText('Off')
  await expect(page.locator('#watchmodeAvailabilityState')).toContainText('TMDB details still available')
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await expect(page.locator('#myTvProviderList')).toContainText('turned off in Settings')
  expect(providerRequests).toBe(0)
})

test('exact provider identifiers beat marketplace wording', async ({ page }) => {
  await openPortal(page, 'dark')
  expect(await page.evaluate(() => myTvProviderBrandFor(
    { source_id: 490, name: 'MAX (Via Amazon Prime)' }, 'source_id', 'watchmodeIds')?.id
  )).toBe('hbo-max')
  expect(await page.evaluate(() => myTvProviderBrandFor(
    { source_id: 533, name: 'Lionsgate+ (Via Amazon Prime)' }, 'source_id', 'watchmodeIds')?.id || ''
  )).toBe('')
})

test('title cards show saved summary and controls while richer details load', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone covers the loading-state contract')
  await openPortal(page, 'dark')
  await page.evaluate(() => {
    library.my_tv_library = [{
      path: 'Films/Die Hard.mp4', display_name: 'Die Hard', browser_ready: true,
      metadata: { tmdb_id: 12, title: 'Die Hard' },
    }]
    window.__finishTitleLoad = null
    window.api = () => new Promise(resolve => { window.__finishTitleLoad = resolve })
    openMyTvTitle({ key: 'movie:12', media_type: 'movie', tmdb_id: 12,
      title: 'Die Hard', year: '1988', overview: 'Saved title summary.',
      poster_path: '/die-hard.jpg', viewing: { watchlisted: true },
      local: { kind: 'film', path: 'Films/Die Hard.mp4' } })
  })

  const sheet = page.locator('#myTvTitleSheet')
  await expect(sheet).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('#myTvTitleName')).toHaveText('Die Hard')
  await expect(page.locator('#myTvTitleOverview')).toHaveText('Saved title summary.')
  await expect(page.locator('#myTvTitlePoster img')).toHaveAttribute('src', /die-hard/)
  await expect(page.locator('#myTvTitleIntents [data-viewing-action="watchlist"]'))
    .toHaveClass(/active/)
  await expect(page.locator('#myTvTitleFilmActions')).toBeVisible()
  await expect(page.locator('#myTvProviderList .my-tv-title-loading-provider')).toHaveCount(5)

  await page.evaluate(() => window.__finishTitleLoad({
    key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Die Hard',
    release_date: '1988-07-15', runtime: 132, rating: 7.8,
    genres: ['Action'], directors: ['John McTiernan'],
    overview: 'A New York police officer faces a hostage crisis.',
    viewing: {}, providers: [], cast: [], collection: null,
  }))
  await expect(sheet).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('#myTvTitleMeta')).toContainText('15 Jul 1988')
  await expect(page.locator('#myTvTitleOverview')).toContainText('hostage crisis')
  await expect(page.locator('#myTvTitlePoster .my-tv-title-loading-cover')).toHaveCount(0)
})

test('mobile global search stays directly below the fixed app header', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone search layout contract')
  await openPortal(page, 'dark')
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#watchSearch').focus()
  await expect(page.locator('#view-my-tv-home')).toHaveClass(/my-tv-search-mode/)
  await page.evaluate(async () => Promise.allSettled(
    document.querySelector('#view-my-tv-home').getAnimations()
      .map(animation => animation.finished)))
  const layout = await page.evaluate(() => {
    const header = document.querySelector('.mobile-head').getBoundingClientRect()
    const searchSurface = document.querySelector('#view-my-tv-home .watch-discovery').getBoundingClientRect()
    const search = document.querySelector('#watchSearch').getBoundingClientRect()
    return {
      headerVisible: header.top === 0 && header.bottom > 0,
      attached: Math.abs(searchSurface.top - header.bottom) <= 1,
      fieldBelowHeader: search.top >= header.bottom,
      fullWidth: searchSurface.left <= header.left + 1
        && searchSurface.right >= header.right - 1,
    }
  })
  expect(layout).toEqual({
    headerVisible: true,
    attached: true,
    fieldBelowHeader: true,
    fullWidth: true,
  })
  await page.evaluate(() => {
    document.querySelector('#myTvDiscoverySection').classList.remove('hidden')
    document.querySelector('#myTvDiscoveryGrid').replaceChildren(portalEmptyState({
      className: 'watch-empty', title: 'Searching My TV…',
      message: 'Checking your library and streaming catalogue.',
    }))
  })
  const emptyState = await page.locator('#myTvDiscoveryGrid > .watch-empty').evaluate(element => {
    const card = element.getBoundingClientRect()
    const grid = element.parentElement.getBoundingClientRect()
    return {
      contained: card.left >= grid.left - 1 && card.right <= grid.right + 1,
      fullWidth: Math.abs(card.width - grid.width) <= 1,
    }
  })
  expect(emptyState).toEqual({ contained: true, fullWidth: true })
})

for (const theme of ['light', 'dark']) {
  test(`${theme} Finding Nemo remains selectable after changing cabinets`, async ({ page }) => {
    await openPortal(page, theme)
    await page.locator('[data-view-button="system"]').click()
    const cabinet = page.locator('#tvBorder')
    await page.locator('details').filter({ has: cabinet }).locator('summary').click()
    await expect(cabinet.locator('option[value="finding-nemo"]')).toHaveText('Finding Nemo')
    await cabinet.selectOption('finding-nemo')
    await cabinet.selectOption('charcoal-90s')
    await cabinet.selectOption('finding-nemo')
    await page.evaluate(() => {
      library.tv_settings.tv_border = 'finding-nemo'
      renderTvSettings()
    })
    await expect(cabinet).toHaveValue('finding-nemo')
  })

  test(`${theme} channel facts remain legible`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await page.evaluate(() => openChannel(3, true))
    await expect(page.locator('#workspaceProgrammeCount')).toHaveText('2')
    await page.screenshot({ path: testInfo.outputPath('channel.png'), animations: 'disabled' })
    if (theme === 'light') {
      await expect(page.locator('.channel-page-facts > span').first())
        .toHaveCSS('color', 'rgb(83, 91, 104)')
    }
  })

  test(`${theme} phone channel headers stay fixed above compact three-column film grids`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine covers channel geometry')
    await openPortal(page, theme)
    await page.evaluate(() => {
      library.channels.find(channel => channel.number === 1).metadata.title = 'Disney Films'
      openChannel(1, true)
    })

    const header = page.locator('.channel-page-fixed-head')
    const artwork = page.locator('.channel-page-hero-art')
    await expect(header).toHaveCSS('position', 'fixed')
    await expect(artwork).toHaveCSS('box-shadow', 'none')
    expect(await page.evaluate(() => {
      const art = document.querySelector('.channel-page-hero-art').getBoundingClientRect()
      const eyebrow = document.querySelector('.channel-page-eyebrow').getBoundingClientRect()
      const actions = document.querySelector('.channel-page-actions').getBoundingClientRect()
      return [Math.round(eyebrow.left - art.right), Math.round(actions.left - art.right)]
    })).toEqual([8, 8])

    const firstHeaderTop = await header.evaluate(element => element.getBoundingClientRect().top)
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect.poll(() => header.evaluate(element => element.getBoundingClientRect().top))
      .toBeCloseTo(firstHeaderTop, 0)

    const posters = await page.locator('.channel-page-film-card').evaluateAll(cards => cards.slice(0, 4).map(card => {
      const rect = card.getBoundingClientRect()
      return { left: rect.left, top: rect.top }
    }))
    expect(posters[0].top).toBeCloseTo(posters[1].top, 0)
    expect(posters[1].top).toBeCloseTo(posters[2].top, 0)
    expect(posters[3].top).toBeGreaterThan(posters[0].top)

    await page.evaluate(() => {
      library.channels.find(channel => channel.number === 3).metadata.title = 'Zog'
      openChannel(3, true)
    })
    const seriesGeometry = await page.evaluate(() => {
      const head = document.querySelector('.channel-page-fixed-head').getBoundingClientRect()
      const art = document.querySelector('.channel-page-hero-art').getBoundingClientRect()
      const copy = document.querySelector('.channel-page-hero-content').getBoundingClientRect()
      const eyebrow = document.querySelector('.channel-page-eyebrow').getBoundingClientRect()
      const actions = document.querySelector('.channel-page-actions').getBoundingClientRect()
      const library = document.querySelector('.channel-page-library').getBoundingClientRect()
      return {
        artworkGap: Math.round(copy.left - art.right),
        eyebrowGap: Math.round(eyebrow.left - art.right),
        actionsGap: Math.round(actions.left - art.right),
        libraryGap: Math.round(library.top - head.bottom),
      }
    })
    expect(seriesGeometry.artworkGap).toBe(8)
    expect(seriesGeometry.eyebrowGap).toBe(8)
    expect(seriesGeometry.actionsGap).toBe(8)
    expect(seriesGeometry.libraryGap).toBeGreaterThanOrEqual(4)
    expect(seriesGeometry.libraryGap).toBeLessThanOrEqual(20)
  })

  test(`${theme} series headers reserve close space and cover scrolling ticks`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await page.evaluate(() => {
      library.my_tv_series = [{
        id: 'layout-series', title: 'Severance', seasons: [1, 2, 3, 4, 5, 6, 7],
        season_count: 7, episode_count: 2, watched_count: 0,
        metadata: { tmdb_id: 6001, poster: 'bright.svg' },
        episodes: [1, 2].map(season => ({ season, episode: 1,
          still: season === 1 ? 'bright.svg' : 'dark.svg',
          path: `Series ${season}/Episode 1.mp4`, display_name: 'Episode 1',
          watched: false, browser_ready: true,
        })),
      }]
      openMyTvSeriesSheet(library.my_tv_series[0])
    })
    const titles = page.locator('#myTvSeriesEpisodes .my-tv-season-card-copy strong')
    await expect(page.locator('#myTvSeriesIntents')).toBeVisible()
    await expect(page.locator('#myTvSeriesIntents [data-viewing-action]:not(.hidden)')).toHaveCount(4)
    await expect.poll(() => page.locator('#myTvSeriesEpisodes img').first()
      .evaluate(image => image.naturalWidth)).toBe(600)
    for (const index of [0, 1]) await expect(titles.nth(index)).toHaveCSS('color', 'rgb(255, 255, 255)')
    await page.screenshot({ path: testInfo.outputPath('series.png') })
    await expectHeaderClear(page, '#myTvSeriesSheet', '#myTvSeriesClose')
    await page.locator('#myTvSeriesSheet').evaluate(dialog => {
      const panel = dialog.querySelector('.library-sheet-body')
      const h = dialog.querySelector('header').getBoundingClientRect()
      const s = dialog.querySelector('.my-tv-season-status').getBoundingClientRect()
      panel.scrollTop += s.y - h.y - 30
    })
    await page.screenshot({ path: testInfo.outputPath('series-scrolled.png') })
    expect(await page.locator('#myTvSeriesSheet').evaluate(dialog => {
      const header = dialog.querySelector('header')
      const r = dialog.querySelector('.my-tv-season-status').getBoundingClientRect()
      return header.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })).toBe(true)
    await page.locator('#myTvSeriesMore').click()
    await expect(page.locator('#myTvSeriesMoreSheet')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('series-more.png') })
    await page.locator('#myTvSeriesMoreClose').click()
    await page.locator('#myTvSeriesClose').click()
    await expect(page.locator('#myTvSeriesSheet')).not.toBeVisible()
    await page.evaluate(() => openMyTvSeasonSheet(library.my_tv_series[0], 3))
    await page.screenshot({ path: testInfo.outputPath('season.png') })
    await expectHeaderClear(page, '#myTvSeasonSheet', '#myTvSeasonClose')
    await expect(page.locator('#myTvSeasonMeta .my-tv-title-fact')).toHaveCount(3)
    await expect(page.locator('#myTvSeasonMeta')).toContainText('Episodes0')
    await expect(page.locator('#myTvSeasonMeta')).toContainText('On Mabel TV0')
    await expect(page.locator('#myTvSeasonMeta')).toContainText('Watched0')
    const rows = await page.locator('#myTvSeasonSheet .my-tv-season-tools button').evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect()
      const icon = button.querySelector('.icon').getBoundingClientRect()
      const text = button.querySelector('span').getBoundingClientRect()
      return { width: box.width, height: box.height, parentWidth: button.parentElement.clientWidth,
        iconRight: icon.right, textLeft: text.left }
    }))
    for (const row of rows) {
      expect(row.width).toBeGreaterThanOrEqual(row.parentWidth - 1)
      expect(row.height).toBeLessThan(100)
      expect(row.height).toBeGreaterThanOrEqual(44)
      expect(row.iconRight).toBeLessThan(row.textLeft)
    }
    await page.locator('#myTvSeasonClose').click()
    await expect(page.locator('#myTvSeasonSheet')).not.toBeVisible()
    await page.evaluate(() => {
      const series = library.my_tv_series[0]
      series.metadata.poster = ''
      series.episodes.forEach(episode => { episode.still = '' })
      openMyTvSeriesSheet(series)
    })
    await expect(titles.first()).toHaveCSS('color', theme === 'light'
      ? 'rgb(23, 27, 35)' : 'rgb(247, 247, 248)')
    await page.screenshot({ path: testInfo.outputPath('series-no-artwork.png') })
  })

  test(`${theme} streaming season sheets hide their scrollbar without blocking scrolling`, async ({ page }) => {
    await openPortal(page, theme)
    const panel = page.locator('#myTvTitleSeasonSheet .library-sheet-body')
    await page.evaluate(() => {
      const sheet = document.querySelector('#myTvTitleSeasonSheet')
      const sheetPanel = sheet?.querySelector('.library-sheet-body')
      if (!(sheet instanceof HTMLDialogElement) || !(sheetPanel instanceof HTMLElement)) {
        throw new Error('Streaming season sheet is unavailable')
      }
      const filler = document.createElement('div')
      filler.style.height = '1200px'
      filler.setAttribute('aria-hidden', 'true')
      sheetPanel.append(filler)
      portalSheets.open(sheet)
    })
    await expect(panel).toBeVisible()
    const state = await panel.evaluate(element => {
      element.scrollTop = 240
      return {
        scrollTop: element.scrollTop,
        scrollable: element.scrollHeight > element.clientHeight,
        scrollbarWidth: getComputedStyle(element).scrollbarWidth,
        webkitScrollbarDisplay: getComputedStyle(element, '::-webkit-scrollbar').display,
        supportsScrollbarWidth: CSS.supports('scrollbar-width: none'),
      }
    })
    expect(state.scrollable).toBe(true)
    expect(state.scrollTop).toBeGreaterThan(0)
    if (state.supportsScrollbarWidth) expect(state.scrollbarWidth).toBe('none')
    else expect(state.webkitScrollbarDisplay).toBe('none')
  })

  test(`${theme} My Viewing search, compact controls and responsive grid fit`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await page.evaluate(async () => {
      openView('my-tv-viewing')
      await new Promise(resolve => setTimeout(resolve, 100))
      myTvViewingData = { items: Array.from({ length: 11 }, (_, index) => ({
        key: `tv:${6001 + index}`, media_type: 'tv', tmdb_id: 6001 + index,
        title: `Series ${String(index + 1).padStart(2, '0')}`, year: String(2022 - index),
        series_watching: true, viewing_updated: 2_000_000_000 - index,
      })) }
      myTvViewingLoaded = true
      myTvViewingTab = 'watching'
      myTvViewingFilter = 'all'
      document.querySelectorAll('[data-viewing-tab]').forEach(button =>
        button.classList.toggle('active', button.dataset.viewingTab === 'watching'))
      renderMyTvViewing()
    })
    await expect(page.locator('#view-my-tv-viewing')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('my-viewing.png'), animations: 'disabled' })
    const layout = await page.evaluate(() => {
      const tabs = document.querySelector('#myTvViewingTabs')
      const search = document.querySelector('#myTvViewingSearch')
      const tools = document.querySelector('.my-tv-viewing-tools')
      const toolGroups = [...tools.children]
      const selects = [...tools.querySelectorAll('select')]
      const cards = [...document.querySelectorAll('.my-tv-viewing-row')]
      const mobileHead = document.querySelector('.mobile-head')
      const back = document.querySelector('#myTvViewingBack')
      const tabButtons = [...tabs.querySelectorAll('button')]
      return {
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        isPhone: document.documentElement.clientWidth <= 640,
        headerGap: back.getBoundingClientRect().top - mobileHead.getBoundingClientRect().bottom,
        tabRows: new Set(tabButtons.map(button => Math.round(button.getBoundingClientRect().top))).size,
        maxTabRadius: Math.max(...tabButtons.map(button =>
          parseFloat(getComputedStyle(button).borderRadius))),
        tabHeight: tabs.getBoundingClientRect().height,
        searchHeight: search.closest('label').getBoundingClientRect().height,
        toolRows: new Set(toolGroups.map(control =>
          Math.round(control.getBoundingClientRect().top))).size,
        minControlHeight: Math.min(...toolGroups.map(control =>
          control.getBoundingClientRect().height)),
        controlHeights: toolGroups.map(control => control.getBoundingClientRect().height),
        selectAppearances: selects.map(select => getComputedStyle(select).appearance),
        layoutSwitcherCount: tools.querySelectorAll('[data-viewing-layout]').length,
        firstRowCards: cards.filter(card =>
          Math.round(card.getBoundingClientRect().top) === Math.round(cards[0].getBoundingClientRect().top)).length,
        firstCardMeta: cards[0].querySelector('.my-tv-viewing-copy span').textContent,
        rightEdge: Math.max(...cards.map(card => card.getBoundingClientRect().right)),
        viewport: document.documentElement.clientWidth,
      }
    })
    expect(layout.pageOverflow).toBe(false)
    if (layout.isPhone) expect(layout.headerGap).toBeLessThanOrEqual(20)
    expect(layout.tabRows).toBe(1)
    expect(layout.maxTabRadius).toBe(0)
    expect(layout.tabHeight).toBeLessThanOrEqual(38)
    expect(layout.searchHeight).toBeGreaterThanOrEqual(40)
    expect(layout.searchHeight).toBeLessThanOrEqual(44)
    expect(layout.toolRows).toBe(1)
    expect(layout.minControlHeight).toBeGreaterThanOrEqual(34)
    expect(layout.minControlHeight).toBeLessThanOrEqual(38)
    expect(layout.selectAppearances).toEqual(['auto', 'auto'])
    expect(layout.layoutSwitcherCount).toBe(0)
    if (layout.isPhone) expect(layout.firstRowCards).toBe(4)
    else expect(layout.firstRowCards).toBeGreaterThanOrEqual(5)
    expect(layout.firstCardMeta).toBe('2022 · TV series')
    expect(layout.rightEdge).toBeLessThanOrEqual(layout.viewport)
    await page.locator('#myTvViewingSearch').fill('Series 10')
    await expect(page.locator('.my-tv-viewing-row')).toHaveCount(1)
    await page.locator('#myTvViewingSearchClear').click()
    await expect(page.locator('.my-tv-viewing-row')).toHaveCount(11)
    await page.locator('#myTvViewingSort').selectOption('za')
    await expect(page.locator('.my-tv-viewing-copy strong').first()).toHaveText('Series 11')
    await page.locator('#myTvViewingFilter').selectOption('movie')
    await expect(page.locator('.my-tv-viewing-row')).toHaveCount(0)
    await page.locator('#myTvViewingFilter').selectOption('tv')
    await expect(page.locator('.my-tv-viewing-row')).toHaveCount(11)
  })
}
