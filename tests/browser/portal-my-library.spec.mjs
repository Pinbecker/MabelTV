import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

const films = [
  { path: 'Harry Potter 1.mp4', library_id: 'potter-1', added_at: 20,
    metadata: { tmdb_id: 671, title: 'Harry Potter and the Philosopher’s Stone', year: '2001' } },
  { path: 'Harry Potter 2.mp4', library_id: 'potter-2', added_at: 30,
    metadata: { tmdb_id: 672, title: 'Harry Potter and the Chamber of Secrets', year: '2002' } },
  { path: 'Alien.mp4', library_id: 'alien', added_at: 10,
    metadata: { tmdb_id: 348, title: 'Alien', year: '1979', genres: ['Horror'] } },
  { path: 'My holiday.mp4', library_id: 'unmatched', display_name: 'My holiday', added_at: 40,
    browser_ready: false, metadata: {} },
]
const series = [{ id: 'local-show', title: 'Local Show', metadata: {}, added_at: 50,
  seasons: [1], season_count: 1, episode_count: 1,
  episodes: [{ path: 'Season 1/Episode 1.mp4', season: 1, episode: 1, display_name: 'Pilot', browser_ready: true }] },
{ id: 'empty-show', title: 'An empty folder', episode_count: 0, episodes: [], metadata: {} }]

async function openLibrary(page, { fail = false, many = false } = {}) {
  await page.route('**/api/my-tv/library/metadata?*', route => {
    if (fail) return route.fulfill({ status: 503, json: { error: 'Metadata offline' } })
    const id = Number(new URL(route.request().url()).searchParams.get('tmdb_id'))
    return route.fulfill({ json: { genres: id === 348 ? ['Horror'] : ['Fantasy'],
      collection: [671, 672].includes(id) ? { tmdb_id: 1241, name: 'Harry Potter Collection' } : null } })
  })
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(({ films, series, many }) => {
    library.my_tv_library = many ? [...films, ...Array.from({ length: 40 }, (_, i) => ({
      path: `Extra ${i}.mp4`, display_name: `Extra ${i}`, library_id: `extra-${i}`, metadata: {},
    }))] : films
    library.my_tv_series = series
  }, { films, series, many })
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#myTvMyLibrary').click()
  await expect(page.locator('#view-my-tv-library')).toHaveClass(/active/)
  await expect(page.locator('#myLibraryMetadataStatus')).not.toContainText('Finding')
}

test('My Library is local-only, includes unmatched files, and filters and sorts without discovery', async ({ page }) => {
  await openLibrary(page)
  await expect(page).toHaveURL(/#my-tv-library$/)
  await expect(page.locator('#view-my-tv-library h1')).toHaveText('My Library')
  await expect(page.locator('#view-my-tv-library .watch-tabs')).toHaveCount(0)
  await expect(page.locator('#myLibraryGrid > .watch-card')).toHaveCount(5)
  await expect(page.locator('#myLibraryCount')).toHaveText('4 films · 1 series')
  await expect(page.locator('#myLibraryGrid')).not.toContainText('An empty folder')
  await expect(page.locator('#myLibraryGrid')).not.toContainText('Snowy Adventure')
  await expect(page.locator('#myLibraryGrid')).toContainText('My holiday')
  await page.locator('#myLibrarySort').selectOption('recent')
  await expect(page.locator('#myLibraryGrid > button').first()).toHaveAttribute('data-library-id', 'series:local-show')
  await page.locator('#myLibraryType').selectOption('movie')
  await page.locator('#myLibrarySort').selectOption('oldest')
  await expect(page.locator('#myLibraryGrid > button').first()).toHaveAttribute('data-library-id', 'film:alien')
  await page.locator('#myLibraryGenre').selectOption('Fantasy')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(2)
  const requests = []
  page.on('request', request => requests.push(request.url()))
  await page.getByRole('searchbox', { name: 'Search My Library' }).fill('Chamber')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(1)
  expect(requests.filter(url => /discovery|search/.test(url))).toEqual([])
  await page.locator('#myLibrarySearchClear').click()
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(2)
  await page.locator('#myLibraryGenre').selectOption('')
  await page.locator('#myLibraryType').selectOption('tv')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(1)
  await page.locator('#myLibraryGrid > button').click()
  await expect(page.locator('#myTvSeriesSheet')).toBeVisible()
  await expect(page.locator('#myTvSeriesSheet')).toContainText('Local Show')
})

test('metadata collections contain only owned films and restore the overlay after title Back', async ({ page }) => {
  await openLibrary(page)
  await page.locator('[data-library-mode="collections"]').click()
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(4)
  const stack = page.locator('.my-library-stack')
  await expect(stack).toContainText('2 films on your Pi')
  await stack.click()
  await expect(page.locator('#myLibraryCollectionName')).toHaveText('Harry Potter')
  await expect(page.locator('#myLibraryCollectionGrid > button')).toHaveCount(2)
  await expect(page.locator('#myLibraryCollectionSheet')).not.toContainText('Prisoner')
  await page.locator('#myLibraryCollectionGrid > button').first().click()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await expect(page.locator('#myLibraryCollectionSheet')).not.toBeVisible()
  await page.locator('#myTvTitleSheet > .watch-film-panel .portal-card-back').click()
  await expect(page.locator('#myLibraryCollectionSheet')).toBeVisible()
  await page.locator('#myLibraryCollectionClose').click()
  await expect(page.locator('#myLibraryGrid .my-library-stack')).toBeVisible()
  await page.locator('#myLibrarySearch').fill('Chamber')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(1)
  await expect(page.locator('#myLibraryGrid .my-library-stack')).toHaveCount(0)
})

test('failed enrichment leaves all titles usable and Retry restores collections', async ({ page }) => {
  await openLibrary(page, { fail: true })
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(5)
  await expect(page.locator('#myLibraryMetadataRetry')).toBeVisible()
  await page.locator('[data-library-mode="collections"]').click()
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(5)
  await page.route('**/api/my-tv/library/metadata?*', route => route.fulfill({ json: {
    genres: ['Fantasy'], collection: { tmdb_id: 1241, name: 'Harry Potter Collection' },
  } }))
  await page.locator('#myLibraryMetadataRetry').click()
  await expect(page.locator('#myLibraryMetadataRetry')).toBeHidden()
  await expect(page.locator('.my-library-stack')).toHaveCount(1)
})

test('library state and scroll survive title journeys, browser Back and primary navigation', async ({ page }) => {
  await openLibrary(page, { many: true })
  await page.locator('#myLibrarySort').selectOption('recent')
  await page.locator('#myLibrarySearch').fill('Extra')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(40)
  await page.locator('#myLibraryGrid > button').nth(28).scrollIntoViewIfNeeded()
  const scroll = await page.evaluate(() => scrollY)
  await page.locator('#myLibraryGrid > button').nth(28).click()
  await expect(page.locator('#watchFilmSheet')).toBeVisible()
  await page.locator('#watchFilmClose').click()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0)
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('[data-view-button="my-tv-home"]').click()
  await expect(page.locator('#view-my-tv-library')).toHaveClass(/active/)
  await expect(page.locator('#myLibrarySearch')).toHaveValue('Extra')
  await expect(page.locator('#myLibrarySort')).toHaveValue('recent')
  await page.locator('#myLibraryBack').click()
  await expect(page.locator('#view-my-tv-home')).toHaveClass(/active/)
})

test('library updates remove deleted films from an already open collection', async ({ page }) => {
  await openLibrary(page)
  await page.locator('[data-library-mode="collections"]').click()
  await page.locator('.my-library-stack').click()
  await page.evaluate(() => {
    library.my_tv_library = library.my_tv_library.filter(film => film.library_id !== 'potter-2')
    renderMyLibrary()
  })
  await expect(page.locator('#myLibraryCollectionGrid > button')).toHaveCount(1)
  await expect(page.locator('#myLibraryCollectionGrid')).not.toContainText('Chamber')
})

test('My Library phone and tablet layout, collections and light theme @visual', async ({ page }, testInfo) => {
  await openLibrary(page)
  await page.locator('#myLibraryBack').click()
  const buttons = await page.locator('.my-tv-home-shortcuts > button').evaluateAll(buttons =>
    buttons.map(button => button.getBoundingClientRect().width))
  expect(buttons[0]).toBeGreaterThan(100)
  expect(Math.abs(buttons[0] - buttons[1])).toBeLessThan(1)
  await page.screenshot({ path: testInfo.outputPath('my-library-home.png') })
  await page.locator('#myTvMyViewing').click()
  const viewingBack = await page.locator('#myTvViewingBack').boundingBox()
  await page.screenshot({ path: testInfo.outputPath('my-viewing-reference.png') })
  await page.locator('#myTvViewingBack').click()
  await page.locator('#myTvMyLibrary').click()
  const libraryBack = await page.locator('#myLibraryBack').boundingBox()
  expect(Math.abs(libraryBack.y - viewingBack.y)).toBeLessThan(1)
  expect(Math.abs(libraryBack.x - viewingBack.x)).toBeLessThan(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('my-library-titles.png'), fullPage: true })
  await page.locator('[data-library-mode="collections"]').click()
  await page.screenshot({ path: testInfo.outputPath('my-library-collections.png'), fullPage: true })
  await page.locator('.my-library-stack').click()
  await page.screenshot({ path: testInfo.outputPath('my-library-overlay.png') })
  await page.locator('#myLibraryCollectionClose').click()
  await page.evaluate(() => window.MabelExperienceTheme.set('light'))
  await page.screenshot({ path: testInfo.outputPath('my-library-light.png'), fullPage: true })
})
