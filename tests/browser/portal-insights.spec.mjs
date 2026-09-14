import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })


async function openPortal(page, { extraTitles = [] } = {}) {
  await page.route('**/api/my-tv/insights', async route => {
    const response = await route.fetch()
    const data = await response.json()
    data.actors.forEach((person, index) => { person.profile_path = `/insight-person-${index + 1}.jpg` })
    data.creative.forEach((person, index) => { person.profile_path = `/insight-creative-${index + 1}.jpg` })
    data.titles.push(...extraTitles)
    data.titles.forEach(title => { title.poster_path = `/insight-${title.tmdb_id}.jpg` })
    data.highest_rated.forEach(title => { title.poster_path = `/insight-${title.tmdb_id}.jpg` })
    data.recent_posters = data.titles.slice(0, 5)
    await route.fulfill({ response, json: data })
  })
  await page.route('**/api/my-tv/tmdb-artwork/**', route => {
    const requestUrl = new URL(route.request().url())
    const [, size, name] = requestUrl.pathname.match(/tmdb-artwork\/([^/]+)\/([^/]+)$/) || []
    const sourceUrl = `https://image.tmdb.org/t/p/${size}/${name}`
    const value = [...sourceUrl].reduce((total, letter) => total + letter.charCodeAt(0), 0)
    const hue = value % 360
    const portrait = sourceUrl.includes('person') || sourceUrl.includes('creative')
    const body = portrait
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 34% 68%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 28% 22%)"/></linearGradient></defs><rect width="320" height="400" fill="url(#g)"/><circle cx="160" cy="126" r="72" fill="hsl(${(hue + 24) % 360} 32% 80%)"/><path d="M42 400c7-105 52-162 118-162s112 57 118 162" fill="hsl(${(hue + 180) % 360} 32% 23%)"/><circle cx="135" cy="120" r="5"/><circle cx="185" cy="120" r="5"/><path d="M137 158q23 17 46 0" fill="none" stroke="#38292d" stroke-width="5" stroke-linecap="round"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 54% 42%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 48% 14%)"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="214" cy="105" r="80" fill="rgba(255,255,255,.15)"/><path d="M0 350L300 190v260H0z" fill="rgba(0,0,0,.28)"/></svg>`
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body })
  })
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts?.ready)
}


test('@visual Insights is a top-level My TV profile with Mabel TV activity alongside it', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone navigation contract')
  await openPortal(page)

  await expect(page.locator('[data-view-button="usb"]')).toHaveCount(0)
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#myTvHomeInsightsTab').click()
  await expect(page.locator('#view-insights')).toBeVisible()
  await expect(page.locator('[data-view-button="my-tv-home"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#insightsDomainTitle')).toHaveText('My TV')
  await expect(page.locator('#myTvInsightWatched')).toHaveText('146')
  await expect(page.locator('#myTvInsightActors .my-tv-insight-person')).toHaveCount(8)
  await expect(page.locator('#myTvInsightActors .my-tv-insight-person-image img').first()).toBeVisible()
  await expect(page.locator('#myTvInsightRatedTitles')).toHaveCSS('overflow-x', 'auto')
  await expect(page.locator('#myTvInsightRatedTitles .my-tv-insight-title')).toHaveCount(9)
  expect(await page.locator('#myTvInsightRatedTitles').evaluate(element =>
    element.scrollWidth > element.clientWidth)).toBe(true)
  const posterSizes = await page.locator('#myTvInsightRatedTitles .my-tv-insight-title-poster')
    .evaluateAll(posters => posters.map(poster => {
      const box = poster.getBoundingClientRect()
      return [Math.round(box.width), Math.round(box.height)]
    }))
  expect(new Set(posterSizes.map(([width]) => width)).size,
    `poster geometry: ${JSON.stringify(posterSizes)}`).toBe(1)
  expect(new Set(posterSizes.map(([, height]) => height)).size,
    `poster heights: ${posterSizes.map(([, height]) => height).join(', ')}`).toBe(1)
  expect(posterSizes[0][0]).toBeGreaterThan(60)
  await expect(page.locator('.my-tv-insight-stats > button svg')).toHaveCount(0)
  await expect(page.locator('#myTvInsightsDashboard')).toBeVisible()
  await expect(page.locator('#mabelInsightsDashboard')).toBeHidden()
  await page.waitForTimeout(250)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page).toHaveScreenshot('my-insights.png')
  await page.locator('#myTvInsightActors').scrollIntoViewIfNeeded()
  await expect.poll(() => page.locator('#myTvInsightCreative img').evaluateAll(images =>
    images.every(image => image.complete))).toBe(true)
  await expect(page).toHaveScreenshot('my-insights-people.png')
  await page.locator('#myTvInsightRatedSection').scrollIntoViewIfNeeded()
  await expect(page).toHaveScreenshot('my-insights-rated.png')

  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#watchMabelInsightsTab').click()
  await expect(page.locator('#mabelInsightsDashboard')).toBeVisible()
  await expect(page.locator('#myTvInsightsDashboard')).toBeHidden()
  await expect(page.locator('#insightsDomainTitle')).toHaveText('Mabel TV')
  await expect(page.locator('#viewingRangeControls')).toBeVisible()
  const range = await page.locator('#viewingRangeControls').evaluate(root => ({
    height: root.getBoundingClientRect().height,
    buttons: [...root.querySelectorAll('button')].map(button =>
      button.getBoundingClientRect().height),
  }))
  expect(range.height).toBeLessThanOrEqual(41)
  expect(Math.max(...range.buttons)).toBeLessThanOrEqual(35)
})


test('My TV insight facets and people open their useful next level', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone navigation contract')
  const filmography = Array.from({ length: 30 }, (_, index) => ({
    key: `${index === 2 || index === 5 || index === 7 || index === 10 ? 'tv' : 'movie'}:${1001 + index}`,
    media_type: index === 2 || index === 5 || index === 7 || index === 10 ? 'tv' : 'movie',
    tmdb_id: 1001 + index, title: `Credit ${index + 1}`,
    year: String(2026 - index), poster_path: `/insight-${1001 + index}.jpg`,
    character: `Character ${index + 1}`,
  }))
  await page.route('**/api/my-tv/person?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      tmdb_id: 1, name: 'Michael Caine', profile_path: '/insight-person-1.jpg',
      known_for_department: 'Acting', birthday: '1933-03-14', place_of_birth: 'London',
      biography: 'A fixture biography for the insight person journey.',
      known_for: [], filmography,
    }),
  }))
  await openPortal(page, { extraTitles: filmography.slice(12).map(title => ({
    ...title, rating: 0, genres: [], countries: [], language: 'EN', cast_ids: [1],
    creative_ids: [], on_mabeltv: false, watchlisted: false,
  })) })
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#myTvHomeInsightsTab').click()

  await page.locator('#myTvInsightActors .my-tv-insight-person').first().click()
  await expect(page.locator('#myTvPersonSheet')).toBeVisible()
  await expect(page.locator('#myTvPersonName')).toHaveText('Michael Caine')
  await expect(page.locator('#myTvPersonContext')).toContainText('most-watched actors')
  await expect(page.locator('#myTvPersonKnownForHeading')).toHaveText('You Have Watched')
  await expect(page.locator('#myTvPersonCredits .my-tv-franchise-card')).toHaveCount(30)
  await expect(page.locator('#myTvPersonCredits')).toHaveCSS('overflow-x', 'hidden')
  const watchedGrid = await page.locator('#myTvPersonCredits .my-tv-franchise-card').evaluateAll(cards => {
    const positions = cards.map(card => card.getBoundingClientRect())
    return {
      columns: new Set(positions.slice(0, 5).map(position => Math.round(position.left))).size,
      firstRowTop: Math.round(positions[0].top),
      secondRowTop: Math.round(positions[5].top),
      thirdRowTop: Math.round(positions[10].top),
      fitsWidth: cards[0].parentElement.scrollWidth <= cards[0].parentElement.clientWidth,
    }
  })
  expect(watchedGrid.columns).toBe(5)
  expect(watchedGrid.secondRowTop).toBeGreaterThan(watchedGrid.firstRowTop)
  expect(watchedGrid.thirdRowTop).toBeGreaterThan(watchedGrid.secondRowTop)
  expect(watchedGrid.fitsWidth).toBe(true)
  const stickyHeader = page.locator('#myTvPersonKnownFor > header')
  const body = page.locator('#myTvPersonSheet .library-sheet-body')
  await body.evaluate(element => { element.scrollTop = element.scrollHeight })
  const stickyPosition = await stickyHeader.evaluate((header) => {
    const body = header.closest('.library-sheet-body')
    const bodyRect = body.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    return {
      headerTop: Math.round(headerRect.top),
      expectedTop: Math.round(bodyRect.top),
    }
  })
  expect(Math.abs(stickyPosition.headerTop - stickyPosition.expectedTop)).toBeLessThanOrEqual(3)
  await expect(page.locator('#myTvPersonCredits .my-tv-franchise-card').first())
    .toContainText('Character 1')
  await expect(page.locator('#myTvPersonFilmography')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('insight-person-watched.png'),
    animations: 'disabled' })
  await page.locator('#myTvPersonClose').click()

  await page.locator('#myTvInsightGenres .my-tv-insight-bar').first().click()
  await expect(page.locator('#myTvInsightBrowse')).toBeVisible()
  await expect(page.locator('#myTvInsightBrowseTitle')).toHaveText('Drama')
  await expect(page.locator('#myTvInsightBrowseGrid .my-tv-explore-card')).toHaveCount(5)
  const tools = await page.locator('.my-tv-insight-browse-tools').evaluate(root => {
    const search = root.querySelector('.viewing-search').getBoundingClientRect()
    const select = root.querySelector('.my-tv-viewing-select').getBoundingClientRect()
    return { search: search.height, select: select.height }
  })
  expect(tools.search).toBeLessThanOrEqual(36)
  expect(Math.abs(tools.search - tools.select)).toBeLessThanOrEqual(1)
  await expect(page).toHaveURL(/#insights\/my_tv\/genre\/Drama$/)
  await page.locator('#myTvInsightBrowseBack').click()

  await page.locator('#myTvInsightWorld .my-tv-insight-world-group').nth(1).locator('button').filter({ hasText: 'Canada' }).click()
  await expect(page.locator('#myTvInsightBrowseTitle')).toHaveText('Canada')
  await expect(page.locator('#myTvInsightBrowseGrid .my-tv-explore-card')).toHaveCount(3)
  await page.locator('#myTvInsightBrowseGrid .my-tv-explore-open-art').first().click()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
})


test('Mabel TV Insights libraries keep every card aligned inside the page gutter', async ({ page }) => {
  await openPortal(page)
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#watchMabelInsightsTab').click()

  const renderLibrary = async kind => {
    await page.evaluate(selectedKind => {
      const items = Array.from({ length: 8 }, (_, index) => ({
        item_id: `${selectedKind}:${index}`,
        kind: selectedKind,
        title: index % 2 ? `A deliberately much longer title ${index}` : `Title ${index}`,
        source: selectedKind === 'film' ? 'Family Films' : 'Mabel TV series channel',
        channel_number: index + 1,
        artwork: '', seconds: index * 60, sessions: index % 3,
      }))
      viewingResources.set('catalogue:', {
        data: { items }, savedAt: Date.now(), stale: false, restored: true,
      })
      viewingInsightsRoute = { screen: selectedKind === 'film' ? 'films' : 'channels' }
      renderInsightsRoute(true)
    }, kind)
    await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return page.locator('#viewingBrowseGrid').evaluate(root => ({
      group: (() => {
        const group = root.querySelector('.viewing-catalog-group')
        const box = group.getBoundingClientRect()
        const style = getComputedStyle(group)
        return {
          left: Math.round(box.left), right: Math.round(innerWidth - box.right),
          borderWidth: style.borderTopWidth, radius: parseFloat(style.borderRadius),
          background: style.backgroundColor,
        }
      })(),
      cards: [...root.querySelectorAll('.viewing-catalog-card')].map(card => {
        const cardBox = card.getBoundingClientRect()
        const artBox = card.querySelector('.viewing-catalog-art').getBoundingClientRect()
        const title = card.querySelector('.viewing-catalog-copy strong')
        return {
          cardWidth: Math.round(cardBox.width), cardHeight: Math.round(cardBox.height),
          artWidth: Math.round(artBox.width), artHeight: Math.round(artBox.height),
          titleWhiteSpace: getComputedStyle(title).whiteSpace,
        }
      }),
    }))
  }

  for (const kind of ['film', 'channel']) {
    const layout = await renderLibrary(kind)
    const boxes = layout.cards
    expect(new Set(boxes.map(box => box.cardWidth)).size, JSON.stringify(boxes)).toBe(1)
    expect(new Set(boxes.map(box => box.cardHeight)).size, JSON.stringify(boxes)).toBe(1)
    expect(new Set(boxes.map(box => box.artWidth)).size, JSON.stringify(boxes)).toBe(1)
    expect(new Set(boxes.map(box => box.artHeight)).size, JSON.stringify(boxes)).toBe(1)
    expect(boxes.every(box => box.titleWhiteSpace === 'nowrap')).toBe(true)
    expect(Math.abs((boxes[0].artWidth / boxes[0].artHeight) - (2 / 3))).toBeLessThan(.02)
    expect(layout.group.left).toBeGreaterThanOrEqual(15)
    expect(layout.group.right).toBeGreaterThanOrEqual(15)
    expect(layout.group.borderWidth).toBe('1px')
    expect(layout.group.radius).toBeGreaterThanOrEqual(10)
    expect(layout.group.background).not.toBe('rgba(0, 0, 0, 0)')
  }
  await expect(page.locator('#viewingBrowseCount')).toHaveCount(0)

  await page.evaluate(() => {
    const periods = ['Overnight', 'Morning', 'Afternoon', 'Evening'].map(name => ({
      name, seconds: 0, sessions: 0, entries: [],
    }))
    viewingResources.set('diary:2026-09-11', {
      data: {
        date: '2026-09-11', label: 'Friday 11 September', is_today: false,
        previous_date: '2026-09-10', next_date: '2026-09-12', periods,
      },
      savedAt: Date.now(), stale: false, restored: true,
    })
    viewingInsightsRoute = { screen: 'diary', date: '2026-09-11' }
    renderInsightsRoute(true)
  })
  const gutters = await page.locator('#viewingDiary .viewing-period-hero').evaluate(hero => {
    const box = hero.getBoundingClientRect()
    return [Math.round(box.left), Math.round(document.documentElement.clientWidth - box.right)]
  })
  expect(gutters[0]).toBeGreaterThanOrEqual(15)
  expect(gutters[1]).toBeGreaterThanOrEqual(15)
  const diaryHeader = await page.locator('#viewingDiary').evaluate(root => {
    const back = root.querySelector(':scope > .viewing-page-back').getBoundingClientRect()
    const hero = root.querySelector('.viewing-day-hero')
    const heroBox = hero.getBoundingClientRect()
    return {
      gap: Math.round(heroBox.top - back.bottom),
      position: getComputedStyle(hero).position,
      lines: [...hero.querySelectorAll('h2 > span')].map(line => line.textContent),
    }
  })
  expect(diaryHeader.gap).toBeLessThanOrEqual(2)
  expect(diaryHeader.position).toBe('static')
  expect(diaryHeader.lines).toEqual(['Friday 11', 'September'])
  const diarySurface = await page.locator('#viewingDiary .viewing-diary-period').first()
    .evaluate(period => {
      const style = getComputedStyle(period)
      return {
        borderWidth: style.borderTopWidth,
        radius: parseFloat(style.borderRadius),
        background: style.backgroundColor,
      }
    })
  expect(diarySurface.borderWidth).toBe('1px')
  expect(diarySurface.radius).toBeGreaterThanOrEqual(10)
  expect(diarySurface.background).not.toBe('rgba(0, 0, 0, 0)')

  await page.evaluate(() => {
    document.querySelectorAll('.viewing-screen').forEach(screen => screen.classList.add('hidden'))
    document.querySelector('#viewingItemDetail').classList.remove('hidden')
    document.querySelector('#viewingItemSummary').classList.remove('hidden')
  })
  const detailStats = await page.locator('#viewingItemSummary .viewing-stat-grid article')
    .evaluateAll(cards => cards.map(card => {
      const style = getComputedStyle(card)
      return {
        borderWidth: style.borderTopWidth,
        radius: parseFloat(style.borderRadius),
        background: style.backgroundColor,
      }
    }))
  expect(detailStats).toHaveLength(8)
  expect(detailStats.every(card => card.borderWidth === '1px')).toBe(true)
  expect(detailStats.every(card => card.radius >= 10)).toBe(true)
  expect(detailStats.every(card => card.background !== 'rgba(0, 0, 0, 0)')).toBe(true)
})

test('USB remains available from Settings and keeps Settings selected', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone navigation contract')
  await openPortal(page)

  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-system [data-go="usb"]')).toContainText('USB drives')
  await page.locator('#view-system [data-go="usb"]').click()
  await expect(page.locator('#view-usb')).toBeVisible()
  await expect(page.locator('[data-view-button="system"]')).toHaveAttribute('aria-current', 'page')
})
