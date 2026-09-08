import { test, expect } from '@playwright/test'

// Visual and interaction fixtures use request interception; keep the real PWA
// worker isolated to pwa.spec.mjs so it cannot claim this page mid-test.
test.use({ serviceWorkers: 'block' })

async function openPortal(page, theme) {
  await page.addInitScript(theme => {
    localStorage.setItem('mabeltv-experience-theme', theme)
    localStorage.setItem('mabeltv-experience-accent-hue', '184')
  }, theme)
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

async function filmFixture(page) {
  await page.evaluate(() => {
    library.adult_folders = ['Marvel', 'The Lord of the Rings extended editions', 'Empty']
    library.adult_library = [
      ['Captain America', 'Marvel', ['Action', 'Adventure']],
      ['Thor', 'Marvel', ['Action', 'Fantasy']],
      ['The Fellowship of the Ring', 'The Lord of the Rings extended editions', ['Adventure', 'Fantasy']],
      ['A Quiet Place', '', ['Horror']],
      ['Unmatched film', '', undefined],
    ].map(([title, folder, genres]) => ({ path: title + '.mkv', display_name: title, folder,
      browser_ready: false, size: 1000, metadata: { title, genres, year: '2014' } }))
    renderAdultLibrary()
    remoteKind = 'adult'
    openView('watch')
    renderRemoteViewing()
  })
}

for (const theme of ['light', 'dark']) {
  test(`${theme} remote context and player back controls stay legible`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await page.locator('[data-view-button="live"]').click()
    const context = page.locator('.remote-transport-context')
    await context.scrollIntoViewIfNeeded()
    for (const button of await context.locator('button').all()) {
      await expect(button).toBeVisible()
      const style = await button.evaluate(element => {
        const s = getComputedStyle(element)
        return { color: s.color, background: s.backgroundColor, opacity: s.opacity, disabled: element.disabled }
      })
      expect(style.opacity).toBe('1')
      expect(style.background).not.toBe('rgba(0, 0, 0, 0)')
      if (style.disabled) expect(style.color).toBe(theme === 'light' ? 'rgb(83, 91, 104)' : 'rgb(167, 167, 176)')
    }
    await expect(page.locator('#remoteSubtitles')).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('remote.png') })
    await page.evaluate(() => {
      $('#iosWatchTitle').textContent = 'Captain America: The Winter Soldier'
      $('#iosWatchStartOver').classList.remove('hidden')
      $('#iosWatchPlayer').classList.remove('hidden')
    })
    await expect(page.locator('#iosWatchBack')).toHaveCSS('color', 'rgb(247, 247, 248)')
    await expect(page.locator('#iosWatchTitle')).toHaveCSS('color', 'rgb(247, 247, 248)')
    const back = await page.locator('#iosWatchBack').boundingBox()
    expect(back.width).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: testInfo.outputPath('player.png') })
    await page.locator('#iosWatchBack').click()
    await expect(page.locator('#iosWatchPlayer')).toBeHidden()
  })

  test(`${theme} collections reuse full width action rows`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await filmFixture(page)
    await page.locator('#watchManageAdult').click()
    await expect(page.locator('#adultCollectionSheet')).toBeVisible()
    const collection = page.locator('#adultFolderTabs button').filter({ hasText: 'The Lord of the Rings extended editions' })
    await collection.click()
    await expect(collection).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#adultRenameFolder')).toBeEnabled()
    await expect(page.locator('#adultDeleteFolder')).toBeDisabled()
    const rows = await page.locator('#adultFolderTabs button').evaluateAll(buttons => buttons.map(button => {
      const label = button.querySelector('strong')
      return { width: button.getBoundingClientRect().width, parent: button.parentElement.clientWidth,
        labelWidth: label.clientWidth, labelScroll: label.scrollWidth,
        icon: button.querySelector('use').getAttribute('href') }
    }))
    for (const row of rows) {
      expect(row.width).toBeGreaterThanOrEqual(row.parent - 1)
      expect(row.labelScroll).toBeLessThanOrEqual(row.labelWidth + 1)
      expect(row.icon).toBe('/portal/icons.svg#folder')
    }
    await page.screenshot({ path: testInfo.outputPath('collections.png') })
    await page.locator('#adultFolderTabs button').filter({ hasText: /^Empty/ }).click()
    await expect(page.locator('#adultDeleteFolder')).toBeEnabled()
    await page.locator('#adultFolderTabs button').filter({ hasText: 'All films' }).click()
    await expect(page.locator('#adultFolderSelectionActions')).toBeHidden()
    const input = await page.locator('#adultFolderName').boundingBox()
    const create = await page.locator('#adultCreateFolder').boundingBox()
    expect(input.y).toBeCloseTo(create.y, 0)
    expect(input.x + input.width).toBeLessThan(create.x)
    await page.locator('#adultCollectionClose').click()
    await expect(page.locator('#adultCollectionSheet')).toBeHidden()
  })

  test(`${theme} compact film filters combine metadata genres and collections`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await filmFixture(page)
    const collection = page.locator('#watchCollectionFilter')
    const genre = page.locator('#watchGenreFilter')
    await collection.scrollIntoViewIfNeeded()
    const filters = await page.locator('.watch-film-filters').boundingBox()
    expect(filters.height).toBeLessThanOrEqual(48)
    expect(filters.height).toBeGreaterThanOrEqual(44)
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(5)
    await collection.selectOption('Marvel')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(2)
    await genre.selectOption('Adventure')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(1)
    await expect(page.locator('#remoteAdult')).toContainText('Captain America')
    await page.screenshot({ path: testInfo.outputPath('filters.png') })
    await genre.selectOption('Horror')
    await expect(page.locator('#remoteAdult')).toContainText('No matching films')
    await collection.selectOption('')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(1)
    await genre.selectOption('')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(2)
    await expect(page.locator('#remoteAdult')).toContainText('Unmatched film')
    await collection.selectOption('*')
    await genre.selectOption('Fantasy')
    await page.locator('#watchSearch').fill('Thor')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(1)
    await expect(genre).toHaveValue('Fantasy')
    await page.locator('#watchSearchClear').click()
    // On phones, search remains open while the empty search field has focus.
    await page.locator('#watchSearch').press('Tab')
    await genre.selectOption('')
    await collection.selectOption('Empty')
    await page.evaluate(() => { library.adult_folders = library.adult_folders.filter(value => value !== 'Empty'); renderAdultWatch() })
    await expect(collection).toHaveValue('*')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(5)
  })

  test(`${theme} film title card keeps its divider over scrolling detail content`, async ({ page }) => {
    await openPortal(page, theme)
    await filmFixture(page)
    await page.evaluate(() => {
      openWatchFilmSheet(library.adult_library[0])
      const filler = $('#watchFilmViewingActions')
      filler.classList.remove('hidden')
      filler.textContent = 'Extra detail '.repeat(300)
    })
    await expect(page.locator('#watchFilmSheet')).toBeVisible()
    await page.locator('#watchFilmViewingActions').scrollIntoViewIfNeeded()
    const result = await page.locator('#watchFilmSheet').evaluate(sheet => {
      const panel = sheet.querySelector('.watch-film-panel')
      const summary = sheet.querySelector('.watch-film-summary')
      panel.scrollTop = 480
      const panelBox = panel.getBoundingClientRect()
      const summaryBox = summary.getBoundingClientRect()
      const visibleElement = document.elementFromPoint(
        summaryBox.x + summaryBox.width / 2,
        summaryBox.y + summaryBox.height - 12,
      )
      return {
        border: getComputedStyle(summary).borderBottomWidth,
        fullBleed: Math.abs(summaryBox.left - panelBox.left) <= 1
          && Math.abs(summaryBox.right - panelBox.right) <= 1,
        dividerGap: Number.parseFloat(getComputedStyle(summary).paddingBottom),
        position: getComputedStyle(summary).position,
        surface: getComputedStyle(summary).backgroundColor,
        pinned: Math.abs(summaryBox.top - panelBox.top) <= 1,
        covered: summary.contains(visibleElement),
      }
    })
    expect(result).toEqual({
      border: '1px',
      fullBleed: true,
      dividerGap: 16,
      position: 'sticky',
      surface: theme === 'light' ? 'rgb(255, 255, 255)' : 'rgba(10, 10, 14, 0.96)',
      pinned: true,
      covered: true,
    })
  })

  test(`${theme} local film sheets reuse the Great Britain availability footer`, async ({ page }) => {
    await page.route(url => new URL(url).pathname === '/api/adult/title', route => route.fulfill({ json: {
      key: 'movie:123', media_type: 'movie', tmdb_id: 123, title: 'Captain America',
      providers: [{ provider_id: 8, name: 'Netflix', type: 'flatrate' }],
    } }))
    await page.route(url => new URL(url).pathname === '/api/adult/providers', route => route.fulfill({ json: {
      key: 'movie:123', sources: [{ source_id: 203, name: 'Netflix', type: 'sub' }],
    } }))
    await openPortal(page, theme)
    await filmFixture(page)
    await page.evaluate(() => {
      library.adult_library[0].metadata.tmdb_id = 123
      openWatchFilmSheet(library.adult_library[0])
    })
    await expect(page.locator('#watchFilmProviders')).toBeVisible()
    await expect(page.locator('#watchFilmProvidersHeading')).toHaveText('Where to watch')
    await expect(page.locator('#watchFilmProviderList .provider-mabeltv')).toHaveCount(1)
    await page.evaluate(() => openWatchFilmSheet(library.adult_library[4]))
    await expect(page.locator('#watchFilmProviders')).toBeVisible()
    await expect(page.locator('#watchFilmProviderRefresh')).toBeHidden()
    await expect(page.locator('#watchFilmProviderList')).toContainText('Match this film’s metadata')
  })

  test(`${theme} film details show franchise cast services and priced offers without clipping`, async ({ page }, testInfo) => {
    const titleDetail = {
      key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Finding Nemo',
      release_date: '2003-05-30', year: '2003', runtime: 100, rating: 7.8,
      rating_count: 19000, directors: ['Andrew Stanton', 'Lee Unkrich'], genres: ['Animation', 'Family'],
      overview: 'A clownfish crosses the ocean to find his son.', providers: [],
      on_mabeltv: false, viewing: {}, cast: [
        { tmdb_id: 1, name: 'Albert Brooks', character: 'Marlin', profile_path: '' },
        { tmdb_id: 2, name: 'Ellen DeGeneres', character: 'Dory', profile_path: '' },
      ],
      collection: {
        name: 'Finding Nemo Collection',
        parts: Array.from({ length: 8 }, (_, index) => ({
          key: `movie:${12 + index}`, media_type: 'movie', tmdb_id: 12 + index,
          title: index ? `Franchise film ${index + 1}` : 'Finding Nemo',
          year: String(2003 + index), release_date: `${2003 + index}-05-30`,
          poster_path: '', on_mabeltv: index === 1,
        })),
      },
    }
    await page.route(url => new URL(url).pathname === '/api/adult/title', route =>
      route.fulfill({ json: titleDetail }))
    await page.route(url => new URL(url).pathname === '/api/adult/person', route =>
      route.fulfill({ json: {
        tmdb_id: 1, name: 'Albert Brooks', known_for_department: 'Acting',
        birthday: '1947-07-22', place_of_birth: 'Beverly Hills, California',
        profile_path: '', biography: 'Albert Brooks is an actor, writer and filmmaker.',
        known_for: [
          { key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Finding Nemo',
            year: '2003', character: 'Marlin', poster_path: '' },
          { key: 'movie:99', media_type: 'movie', tmdb_id: 99, title: 'Broadcast News',
            year: '1987', character: 'Aaron Altman', poster_path: '' },
        ],
      } }))
    await page.route(url => new URL(url).pathname === '/api/adult/providers', route =>
      route.fulfill({ json: { key: 'movie:12', sources: [
        { source_id: 406, name: 'Now TV', type: 'sub', web_url: 'https://www.nowtv.com/watch/12' },
        { source_id: 418, name: 'My5', type: 'free', web_url: 'https://www.channel5.com/show/12' },
        { source_id: 387, name: 'HBO Max', type: 'sub', web_url: 'https://www.hbomax.com/gb/en/movies/12' },
        { source_id: 349, name: 'AppleTV', type: 'rent', format: 'SD', price: 3.49,
          web_url: 'https://tv.apple.com/gb/movie/12' },
        { source_id: 349, name: 'AppleTV', type: 'rent', format: '4K', price: 4.99,
          web_url: 'https://tv.apple.com/gb/movie/12' },
        { source_id: 349, name: 'AppleTV', type: 'buy', format: '4K', price: 9.99,
          web_url: 'https://tv.apple.com/gb/movie/12' },
        { source_id: 26, name: 'Amazon Prime Video', type: 'rent', format: 'HD', price: 3.99,
          web_url: 'https://www.amazon.co.uk/gp/video/detail/12' },
        { source_id: 26, name: 'Amazon Prime Video', type: 'buy', format: '4K', price: 8.99,
          web_url: 'https://www.amazon.co.uk/gp/video/detail/12' },
        { source_id: 35, name: 'Rakuten TV', type: 'buy', price: 7.99,
          web_url: 'https://www.rakuten.tv/uk/movies/12' },
        { source_id: 40, name: 'Google Play Movies', type: 'buy', price: 7.99,
          web_url: 'https://play.google.com/store/movies/details/12' },
        { source_id: 41, name: 'YouTube', type: 'rent', price: 2.99,
          web_url: 'https://www.youtube.com/watch?v=12' },
      ] } }))
    await openPortal(page, theme)
    await page.evaluate(() => openAdultTitle({
      key: 'movie:12', media_type: 'movie', tmdb_id: 12, title: 'Finding Nemo',
    }))
    await expect(page.locator('#adultTitleMeta')).toContainText('30 May 2003')
    await expect(page.locator('#adultTitleMeta')).toContainText('Andrew Stanton, Lee Unkrich')
    await expect(page.locator('#adultTitleMeta')).toContainText('Animation')
    await expect(page.locator('#adultTitleMeta')).not.toContainText('Family')
    await expect(page.locator('#adultTitleMeta .adult-title-rating-mark')).toHaveText('TMDB')
    await expect(page.locator('#adultTitleMeta .adult-title-rating > strong')).toHaveText('7.8')
    await expect(page.locator('#adultTitleFranchise')).toBeVisible()
    await expect(page.locator('#adultTitleFranchiseHeading')).toHaveText('Finding Nemo Collection')
    await expect(page.locator('#adultTitleCastHeading')).toHaveText('Principal Cast')
    await expect(page.locator('#adultTitleFranchiseRail .adult-franchise-card')).toHaveCount(8)
    await expect(page.locator('#adultTitleFranchiseRail .adult-franchise-card').first()).toBeDisabled()
    await expect(page.locator('#adultTitleCastRail .adult-cast-card')).toHaveCount(2)
    for (const provider of ['now', 'my5', 'hbo-max']) {
      await expect(page.locator(`#adultProviderList .provider-${provider}`)).toBeVisible()
    }
    await expect(page.locator('#adultTitleRentBuyList .adult-purchase-row')).toHaveCount(2)
    await expect(page.locator('#adultTitleRentBuyList .adult-purchase-kind')).toHaveText(['Rent', 'Buy'])
    await expect(page.locator('#adultTitleRentBuyList [data-provider="appletv"]')).toHaveCount(2)
    await expect(page.locator('#adultTitleRentBuyList [data-provider="amazon"]')).toHaveCount(2)
    await expect(page.locator('#adultTitleRentBuyList [data-provider="rakutentv"]')).toHaveCount(0)
    await expect(page.locator('#adultTitleRentBuyList [data-provider="googleplaymovies"]')).toHaveCount(0)
    await expect(page.locator('#adultTitleRentBuyList [data-provider="youtube"]')).toHaveCount(0)
    await expect(page.locator('#adultTitleRentBuyList')).not.toContainText('4K')
    await page.locator('#adultTitleCastRail .adult-cast-card').first().click()
    await expect(page.locator('#adultPersonSheet')).toBeVisible()
    await expect(page.locator('#adultPersonName')).toHaveText('Albert Brooks')
    await expect(page.locator('#adultPersonContext')).toHaveText('As Marlin in Finding Nemo')
    await expect(page.locator('#adultPersonBiography')).toContainText('actor, writer and filmmaker')
    await expect(page.locator('#adultPersonCredits .adult-franchise-card')).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('cast-detail.png') })
    await page.locator('#adultPersonClose').click()
    await expect(page.locator('#adultTitleSheet')).toBeVisible()
    const geometry = await page.locator('#adultTitleSheet').evaluate(sheet => {
      const panel = sheet.querySelector('.watch-film-panel')
      const rail = sheet.querySelector('#adultTitleFranchiseRail')
      const cards = [...rail.querySelectorAll('.adult-franchise-card')]
      const first = cards[0].getBoundingClientRect()
      const last = cards.at(-1).getBoundingClientRect()
      const railBox = rail.getBoundingClientRect()
      return {
        pageContained: panel.scrollWidth <= panel.clientWidth + 1,
        fiveAcross: first.width <= (railBox.width - 28) / 5 + 1,
        horizontalOverflow: last.right > railBox.right,
      }
    })
    expect(geometry).toEqual({ pageContained: true, fiveAcross: true, horizontalOverflow: true })
    await page.screenshot({ path: testInfo.outputPath('film-enrichment.png') })

    await page.locator('#adultTitleClose').click()
    await filmFixture(page)
    await page.evaluate(() => {
      library.adult_library[0].metadata.tmdb_id = 12
      openWatchFilmSheet(library.adult_library[0])
    })
    await expect(page.locator('#watchFilmFranchise')).toBeVisible()
    await expect(page.locator('#watchFilmCast')).toBeVisible()
    await expect(page.locator('#watchFilmFranchiseHeading')).toHaveText('Finding Nemo Collection')
    await expect(page.locator('#watchFilmCastHeading')).toHaveText('Principal Cast')
    await expect(page.locator('#watchFilmRentBuy')).toBeVisible()
  })

  test(`${theme} film actions condense into a three-button state row`, async ({ page }) => {
    await openPortal(page, theme)
    const initial = await page.evaluate(() => {
      const root = $('#watchFilmViewingActions')
      const detail = { media_type: 'movie', viewing: { manual_state: 'watched' } }
      root.classList.remove('hidden')
      wireAdultTitleIntentActions(detail, root)
      const visible = [...root.querySelectorAll('button')]
        .filter(button => getComputedStyle(button).display !== 'none')
        .map(button => ({ action: button.dataset.viewingAction, label: button.querySelector('strong').textContent,
          active: button.classList.contains('active') }))
      $('#watchFilmOverview').textContent = 'Long synopsis '.repeat(120)
      return {
        compact: root.classList.contains('compact-film-intents'),
        visible,
        beforePlayback: Boolean(root.compareDocumentPosition(document.querySelector('.watch-film-actions'))
          & Node.DOCUMENT_POSITION_FOLLOWING),
        clamp: getComputedStyle($('#watchFilmOverview')).webkitLineClamp,
        compactHeight: Number.parseFloat(getComputedStyle(root.querySelector('button')).minHeight),
        actionFits: Number.parseFloat(getComputedStyle(root.querySelector('button')).minHeight)
          <= Number.parseFloat(getComputedStyle($('#watchFilmTv')).minHeight),
        compactControls: [...root.querySelectorAll('button:not(.hidden)')].map(button => {
          const style = getComputedStyle(button)
          const icon = button.querySelector('.icon').getBoundingClientRect()
          const label = button.querySelector('strong').getBoundingClientRect()
          return {
            display: style.display,
            alignItems: style.alignItems,
            justifyContent: style.justifyContent,
            weight: getComputedStyle(button.querySelector('strong')).fontWeight,
            verticallyAligned: Math.abs(icon.top + icon.height / 2
              - (label.top + label.height / 2)) <= 1,
          }
        }),
        firstDivider: {
          margin: Number.parseFloat(getComputedStyle(document.querySelector('.watch-film-actions')).marginTop),
          padding: Number.parseFloat(getComputedStyle(document.querySelector('.watch-film-actions')).paddingTop),
        },
        moreDivider: {
          column: getComputedStyle($('#watchFilmManage')).gridColumn,
          margin: Number.parseFloat(getComputedStyle($('#watchFilmManage')).marginTop),
          offset: Number.parseFloat(getComputedStyle($('#watchFilmManage'), '::before').top),
        },
        providersDivider: {
          margin: Number.parseFloat(getComputedStyle($('#watchFilmProviders')).marginTop),
          padding: Number.parseFloat(getComputedStyle($('#watchFilmProviders')).paddingTop),
        },
      }
    })
    expect(initial).toEqual({
      compact: true,
      visible: [
        { action: 'watchlist', label: 'Watchlist', active: false },
        { action: 'up_next', label: 'Up Next', active: false },
        { action: 'watched', label: 'Watched', active: true },
      ],
      beforePlayback: true,
      clamp: '6',
      compactHeight: 44,
      actionFits: true,
      compactControls: [
        { display: 'flex', alignItems: 'center', justifyContent: 'center', weight: '400', verticallyAligned: true },
        { display: 'flex', alignItems: 'center', justifyContent: 'center', weight: '400', verticallyAligned: true },
        { display: 'flex', alignItems: 'center', justifyContent: 'center', weight: '400', verticallyAligned: true },
      ],
      firstDivider: { margin: 16, padding: 16 },
      moreDivider: { column: '1 / -1', margin: 24, offset: -17 },
      providersDivider: { margin: 12, padding: 10 },
    })
    const unwatched = await page.evaluate(() => {
      const root = $('#watchFilmViewingActions')
      syncAdultTitleButtons({ media_type: 'movie', viewing: {} }, root)
      return [...root.querySelectorAll('button')]
        .filter(button => !button.classList.contains('hidden'))
        .map(button => button.dataset.viewingAction)
    })
    expect(unwatched).toEqual(['watchlist', 'up_next', 'watched'])
  })

  test(`${theme} truncated film titles and synopses offer an expansion control`, async ({ page }) => {
    await openPortal(page, theme)
    await filmFixture(page)
    await page.evaluate(() => {
      const film = {
        ...library.adult_library[0],
        metadata: {
          ...library.adult_library[0].metadata,
          title: 'Captain America and the extremely long title that needs more room on an iPhone screen',
          overview: 'This deliberately long synopsis needs to remain compact until someone asks to read it. '.repeat(16),
        },
      }
      openWatchFilmSheet(film)
    })
    const titleControl = page.locator('#watchFilmTitleExpand')
    const overviewControl = page.locator('#watchFilmOverviewExpand')
    await expect(titleControl).toBeVisible()
    await expect(overviewControl).toBeVisible()
    await titleControl.click()
    await expect(page.locator('#watchFilmTitle')).toHaveClass(/is-expanded/)
    await expect(titleControl).toHaveAttribute('aria-expanded', 'true')
    await expect(titleControl).toHaveText('Less')
    const headerAlignment = await page.evaluate(() => {
      const poster = $('#watchFilmPoster').getBoundingClientRect()
      const heading = document.querySelector('.watch-film-heading').getBoundingClientRect()
      return Math.abs(poster.top - heading.top) <= 1
    })
    expect(headerAlignment).toBe(true)
    await overviewControl.click()
    await expect(page.locator('#watchFilmOverview')).toHaveClass(/is-expanded/)
    await expect(overviewControl).toHaveAttribute('aria-expanded', 'true')
    await expect(overviewControl).toHaveText('Less')
    await overviewControl.click()
    await expect(page.locator('#watchFilmOverview')).not.toHaveClass(/is-expanded/)
    await expect(overviewControl).toHaveText('More')
  })

  test(`${theme} viewing actions update before their background refresh completes`, async ({ page }) => {
    await openPortal(page, theme)
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
}
