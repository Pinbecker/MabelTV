import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })


async function openPortal(page, { extraTitles = [] } = {}) {
  await page.route('**/api/adult/insights', async route => {
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
  await page.route('https://image.tmdb.org/**', route => {
    const value = [...route.request().url()].reduce((total, letter) => total + letter.charCodeAt(0), 0)
    const hue = value % 360
    const portrait = route.request().url().includes('person') || route.request().url().includes('creative')
    const body = portrait
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 34% 68%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 28% 22%)"/></linearGradient></defs><rect width="320" height="400" fill="url(#g)"/><circle cx="160" cy="126" r="72" fill="hsl(${(hue + 24) % 360} 32% 80%)"/><path d="M42 400c7-105 52-162 118-162s112 57 118 162" fill="hsl(${(hue + 180) % 360} 32% 23%)"/><circle cx="135" cy="120" r="5"/><circle cx="185" cy="120" r="5"/><path d="M137 158q23 17 46 0" fill="none" stroke="#38292d" stroke-width="5" stroke-linecap="round"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 54% 42%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 48% 14%)"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="214" cy="105" r="80" fill="rgba(255,255,255,.15)"/><path d="M0 350L300 190v260H0z" fill="rgba(0,0,0,.28)"/></svg>`
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body })
  })
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts?.ready)
}


test('Insights is a top-level Adult TV profile with MabelTV activity alongside it', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone navigation contract')
  await openPortal(page)

  await expect(page.locator('[data-view-button="usb"]')).toHaveCount(0)
  await page.locator('[data-view-button="insights"]').click()
  await expect(page.locator('#view-insights')).toBeVisible()
  await expect(page.locator('[data-view-button="insights"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#adultInsightWatched')).toHaveText('146')
  await expect(page.locator('#adultInsightActors .adult-insight-person')).toHaveCount(8)
  await expect(page.locator('#adultInsightActors .adult-insight-person-image img').first()).toBeVisible()
  await expect(page.locator('#adultInsightRatedTitles')).toHaveCSS('overflow-x', 'auto')
  await expect(page.locator('#adultInsightRatedTitles .adult-insight-title')).toHaveCount(9)
  expect(await page.locator('#adultInsightRatedTitles').evaluate(element =>
    element.scrollWidth > element.clientWidth)).toBe(true)
  const posterSizes = await page.locator('#adultInsightRatedTitles .adult-insight-title-poster')
    .evaluateAll(posters => posters.map(poster => {
      const box = poster.getBoundingClientRect()
      return [Math.round(box.width), Math.round(box.height)]
    }))
  expect(new Set(posterSizes.map(([width]) => width)).size,
    `poster geometry: ${JSON.stringify(posterSizes)}`).toBe(1)
  expect(new Set(posterSizes.map(([, height]) => height)).size,
    `poster heights: ${posterSizes.map(([, height]) => height).join(', ')}`).toBe(1)
  expect(posterSizes[0][0]).toBeGreaterThan(60)
  await expect(page.locator('.adult-insight-stats > button svg')).toHaveCount(0)
  await expect(page.locator('#adultInsightsDashboard')).toBeVisible()
  await expect(page.locator('#mabelInsightsDashboard')).toBeHidden()
  await expect(page).toHaveScreenshot('my-insights.png')
  await page.locator('#adultInsightActors').scrollIntoViewIfNeeded()
  await expect(page).toHaveScreenshot('my-insights-people.png')
  await page.locator('#adultInsightRatedSection').scrollIntoViewIfNeeded()
  await expect(page).toHaveScreenshot('my-insights-rated.png')

  await page.locator('[data-insights-mode="mabel"]').click()
  await expect(page.locator('#mabelInsightsDashboard')).toBeVisible()
  await expect(page.locator('#adultInsightsDashboard')).toBeHidden()
  await expect(page.locator('#viewingRangeControls')).toBeVisible()
  const range = await page.locator('#viewingRangeControls').evaluate(root => ({
    height: root.getBoundingClientRect().height,
    buttons: [...root.querySelectorAll('button')].map(button =>
      button.getBoundingClientRect().height),
  }))
  expect(range.height).toBeLessThanOrEqual(41)
  expect(Math.max(...range.buttons)).toBeLessThanOrEqual(35)
})


test('Adult TV insight facets and people open their useful next level', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone navigation contract')
  const filmography = Array.from({ length: 30 }, (_, index) => ({
    key: `${index === 2 || index === 5 || index === 7 || index === 10 ? 'tv' : 'movie'}:${1001 + index}`,
    media_type: index === 2 || index === 5 || index === 7 || index === 10 ? 'tv' : 'movie',
    tmdb_id: 1001 + index, title: `Credit ${index + 1}`,
    year: String(2026 - index), poster_path: `/insight-${1001 + index}.jpg`,
    character: `Character ${index + 1}`,
  }))
  await page.route('**/api/adult/person?*', route => route.fulfill({
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
  await page.locator('[data-view-button="insights"]').click()

  await page.locator('#adultInsightActors .adult-insight-person').first().click()
  await expect(page.locator('#adultPersonSheet')).toBeVisible()
  await expect(page.locator('#adultPersonName')).toHaveText('Michael Caine')
  await expect(page.locator('#adultPersonContext')).toContainText('most-watched actors')
  await expect(page.locator('#adultPersonKnownForHeading')).toHaveText('You Have Watched')
  await expect(page.locator('#adultPersonCredits .adult-franchise-card')).toHaveCount(30)
  await expect(page.locator('#adultPersonCredits')).toHaveCSS('overflow-x', 'hidden')
  const watchedGrid = await page.locator('#adultPersonCredits .adult-franchise-card').evaluateAll(cards => {
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
  const stickyHeader = page.locator('#adultPersonKnownFor > header')
  const body = page.locator('#adultPersonSheet .library-sheet-body')
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
  await expect(page.locator('#adultPersonCredits .adult-franchise-card').first())
    .toContainText('Character 1')
  await expect(page.locator('#adultPersonFilmography')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('insight-person-watched.png'),
    animations: 'disabled' })
  await page.locator('#adultPersonClose').click()

  await page.locator('#adultInsightGenres .adult-insight-bar').first().click()
  await expect(page.locator('#adultInsightBrowse')).toBeVisible()
  await expect(page.locator('#adultInsightBrowseTitle')).toHaveText('Drama')
  await expect(page.locator('#adultInsightBrowseGrid .adult-explore-card')).toHaveCount(5)
  const tools = await page.locator('.adult-insight-browse-tools').evaluate(root => {
    const search = root.querySelector('.viewing-search').getBoundingClientRect()
    const select = root.querySelector('.adult-viewing-select').getBoundingClientRect()
    return { search: search.height, select: select.height }
  })
  expect(tools.search).toBeLessThanOrEqual(36)
  expect(Math.abs(tools.search - tools.select)).toBeLessThanOrEqual(1)
  await expect(page).toHaveURL(/#insights\/adult\/genre\/Drama$/)
  await page.locator('#adultInsightBrowseBack').click()

  await page.locator('#adultInsightWorld .adult-insight-world-group').nth(1).locator('button').filter({ hasText: 'Canada' }).click()
  await expect(page.locator('#adultInsightBrowseTitle')).toHaveText('Canada')
  await expect(page.locator('#adultInsightBrowseGrid .adult-explore-card')).toHaveCount(3)
  await page.locator('#adultInsightBrowseGrid .adult-explore-open-art').first().click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
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
