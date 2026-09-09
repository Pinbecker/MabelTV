import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

const localFilm = {
  path: 'Harry Potter and the Chamber of Secrets.mkv',
  display_name: 'Harry Potter and the Chamber of Secrets',
  browser_ready: true,
  metadata: { tmdb_id: 672, title: 'Harry Potter and the Chamber of Secrets', year: '2002' },
}

const titleDetail = {
  key: 'movie:672', media_type: 'movie', tmdb_id: 672,
  title: 'Harry Potter and the Chamber of Secrets', release_date: '2002-11-15',
  year: '2002', runtime: 161, rating: 7.7, directors: ['Chris Columbus'],
  genres: ['Adventure'], overview: 'Cars fly, trees fight back, and danger awaits at Hogwarts.',
  providers: [], cast: [], collection: null, on_mabeltv: true,
  local: { kind: 'film', path: localFilm.path }, viewing: {},
}

test('portal search clear controls stay compact with a full touch target', async ({ page }) => {
  await page.goto('/')
  const sizes = await page.locator('.portal-search button').evaluateAll(buttons => buttons.map(button => {
    const visual = getComputedStyle(button)
    const hit = getComputedStyle(button, '::before')
    return { width: Number.parseFloat(visual.width), height: Number.parseFloat(visual.height),
      hitWidth: Number.parseFloat(visual.width) - Number.parseFloat(hit.left) - Number.parseFloat(hit.right),
      hitHeight: Number.parseFloat(visual.height) - Number.parseFloat(hit.top) - Number.parseFloat(hit.bottom) }
  }))
  expect(sizes.length).toBeGreaterThan(1)
  for (const size of sizes) {
    expect(size.width).toBeLessThanOrEqual(30)
    expect(size.height).toBeLessThanOrEqual(30)
    expect(size.hitWidth).toBeGreaterThanOrEqual(44)
    expect(size.hitHeight).toBeGreaterThanOrEqual(44)
  }
})

test('a local global-search film opens one rich card with playback controls', async ({ page }, testInfo) => {
  await page.route(url => new URL(url).pathname === '/api/adult/discovery', route =>
    route.fulfill({ json: { query: 'Harry Potter', results: Array.from(
      { length: 8 }, (_, index) => index ? { ...titleDetail, key: `movie:${672 + index}`,
        tmdb_id: 672 + index, title: `Harry Potter film ${index + 1}`,
        on_mabeltv: false, local: null } : titleDetail) } }))
  await page.route(url => new URL(url).pathname === '/api/adult/title', route =>
    route.fulfill({ json: titleDetail }))
  await page.route(url => new URL(url).pathname === '/api/adult/providers', route =>
    route.fulfill({ json: { key: titleDetail.key, sources: [] } }))
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => Boolean(library))).toBe(true)
  await page.evaluate(film => { library.adult_library = [film] }, localFilm)
  await page.getByRole('button', { name: 'Watch', exact: true }).click()
  await page.locator('#watchAdultTab').click()
  await page.locator('#watchSearch').fill('Harry Potter')
  await expect(page.locator('#adultDiscoveryGrid .watch-card')).toHaveCount(8)
  const grid = await page.locator('#adultDiscoveryGrid').evaluate(element => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
    contained: element.scrollWidth <= element.clientWidth + 1,
  }))
  expect(grid).toEqual({
    columns: testInfo.project.name.startsWith('ipad-') ? 5 : 4,
    contained: true,
  })
  await page.screenshot({ path: testInfo.outputPath('global-search-grid.png') })
  await page.locator('#adultDiscoveryGrid .watch-card').first().click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(page.locator('#watchFilmSheet')).toBeHidden()
  await expect(page.locator('#adultTitleFilmActions')).toBeVisible()
  await expect(page.locator('#adultTitleFilmTv')).toContainText('Play on TV')
  await expect(page.locator('#adultTitleFilmHere')).toContainText('Play on this device')
  await expect(page.locator('#adultTitleLocal')).toBeHidden()
  await expect(page.locator('#adultTitleMore')).toBeVisible()
  await expect(page.locator('#adultProviderList .provider-mabeltv')).toHaveCount(1)
  await expect(page.locator('#adultProviderList .provider-mabeltv')).toHaveJSProperty('tagName', 'SPAN')
})

test('a matched local-library film uses the same rich card', async ({ page }) => {
  await page.route(url => new URL(url).pathname === '/api/adult/title', route =>
    route.fulfill({ json: titleDetail }))
  await page.route(url => new URL(url).pathname === '/api/adult/providers', route =>
    route.fulfill({ json: { key: titleDetail.key, sources: [] } }))
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => Boolean(library))).toBe(true)
  await page.evaluate(film => {
    library.adult_library = [film]
    openAdultFilmDetail(film)
  }, localFilm)
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(page.locator('#watchFilmSheet')).toBeHidden()
  await expect(page.locator('#adultTitleFilmActions')).toBeVisible()
})

test('each actor filmography opens at its beginning', async ({ page }) => {
  await page.route(url => new URL(url).pathname === '/api/adult/person', route => {
    const id = Number(new URL(route.request().url()).searchParams.get('tmdb_id'))
    route.fulfill({ json: { tmdb_id: id, name: id === 1 ? 'First actor' : 'Second actor',
      known_for_department: 'Acting', biography: '', known_for: Array.from(
        { length: 12 }, (_, index) => ({ key: `movie:${100 + index}`, media_type: 'movie',
          tmdb_id: 100 + index, title: `Film ${index + 1}`, year: '2000', poster_path: '' })) } })
  })
  await page.goto('/')
  await page.evaluate(() => openAdultPerson({ tmdb_id: 1, name: 'First actor' }, 'First film'))
  await expect(page.locator('#adultPersonCredits .adult-franchise-card')).toHaveCount(12)
  await page.locator('#adultPersonCredits').evaluate(element => { element.scrollLeft = element.scrollWidth })
  expect(await page.locator('#adultPersonCredits').evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await page.evaluate(() => openAdultPerson({ tmdb_id: 2, name: 'Second actor' }, 'Second film'))
  await expect(page.locator('#adultPersonName')).toHaveText('Second actor')
  expect(await page.locator('#adultPersonCredits').evaluate(element => element.scrollLeft)).toBe(0)
})
