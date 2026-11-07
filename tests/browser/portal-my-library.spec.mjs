import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

const films = [
  { path: 'Harry Potter 1.mp4', library_id: 'potter-1', added_at: 20, folder: 'Harry Potter',
    metadata: { tmdb_id: 671, title: 'Harry Potter and the Philosopher’s Stone', year: '2001' } },
  { path: 'Harry Potter 2.mp4', library_id: 'potter-2', added_at: 30, folder: 'Harry Potter',
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
    library.my_tv_folders = ['Harry Potter']
  }, { films, series, many })
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#myTvMyLibrary').click()
  await expect(page.locator('#view-my-tv-library')).toHaveClass(/active/)
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
  await page.locator('#myLibraryGenre').selectOption('Harry Potter')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(2)
  const requests = []
  page.on('request', request => requests.push(request.url()))
  await page.getByRole('searchbox', { name: 'Search My Library' }).fill('Chamber')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(1)
  expect(requests.filter(url => /discovery|search/.test(url))).toEqual([])
  await page.locator('#myLibrarySearchClear').click()
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(2)
  await page.locator('#myLibraryGenre').selectOption('*')
  await page.locator('#myLibraryType').selectOption('tv')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(1)
  await page.locator('#myLibraryGrid > button').click()
  await expect(page.locator('#myTvSeriesSheet')).toBeVisible()
  await expect(page.locator('#myTvSeriesSheet')).toContainText('Local Show')
})

test('the collection dropdown shows its titles directly and title Back keeps that filter', async ({ page }) => {
  await openLibrary(page)
  await page.locator('#myLibraryGenre').selectOption('Harry Potter')
  await expect(page.locator('#myLibraryGrid > .watch-card')).toHaveCount(2)
  await expect(page.locator('#myLibraryHeading')).toHaveText('Harry Potter')
  await expect(page.locator('#myLibraryGrid .my-library-stack')).toHaveCount(0)
  await expect(page.locator('[data-library-mode]')).toHaveCount(0)
  await page.locator('#myLibraryGrid > button').first().click()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await page.locator('#myTvTitleClose').click()
  await expect(page.locator('#view-my-tv-library')).toHaveClass(/active/)
  await expect(page.locator('#myLibraryGenre')).toHaveValue('Harry Potter')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(2)
  await page.locator('#myLibrarySearch').fill('Chamber')
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(1)
  await expect(page.locator('#myLibraryGrid')).toContainText('Chamber')
})

test('saved collections work without metadata requests and the phone grid is four across', async ({ page }, info) => {
  const requests = []
  page.on('request', request => { if (request.url().includes('/api/my-tv/library/metadata')) requests.push(request.url()) })
  await openLibrary(page, { fail: true })
  await expect(page.getByRole('combobox', { name: 'Library collection', exact: true })).toContainText('Harry Potter')
  await expect(page.getByRole('button', { name: 'Manage library folders' })).toHaveCount(0)
  const columns = await page.locator('#myLibraryGrid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(info.project.name === 'ipad-webkit' ? 6 : 4)
  const titles = await page.locator('#myLibraryGrid .watch-card-copy strong').evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node), box = node.getBoundingClientRect()
    return { height: box.height, top: box.top, line: parseFloat(style.lineHeight),
      overflow: style.textOverflow, nowrap: style.whiteSpace, width: node.clientWidth, textWidth: node.scrollWidth }
  }))
  for (const title of titles) {
    expect(title.height).toBeLessThanOrEqual(title.line + 1)
    expect(title.overflow).toBe('ellipsis')
    expect(title.nowrap).toBe('nowrap')
  }
  expect(titles.some(title => title.textWidth > title.width)).toBe(true)
  expect(Math.max(...titles.slice(0, 4).map(title => title.top)) - Math.min(...titles.slice(0, 4).map(title => title.top))).toBeLessThan(1)
  await page.locator('#myLibraryGenre').selectOption('Harry Potter')
  await expect(page.locator('#myLibraryGrid > .watch-card')).toHaveCount(2)
  expect(requests).toEqual([])
})

test('a collection can be created directly from film settings and selected for a move', async ({ page }) => {
  await openLibrary(page)
  const writes = []
  await page.route('**/api/manage', route => {
    writes.push(route.request().postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  await page.evaluate(() => {
    reloadLibraryWithoutLosingPlace = async () => {
      library.my_tv_folders.push('Weekend')
      renderMyLibrary()
    }
    openMyTvFilmSheet(library.my_tv_library[0])
  })
  await page.locator('#myTvFilmFolder').selectOption('__new__')
  await page.locator('#myTvFilmCollectionName').fill('Weekend')
  await page.locator('#myTvFilmCreateCollection').click()
  await expect(page.locator('#myTvFilmFolder')).toHaveValue('Weekend')
  await expect(page.locator('#myTvFilmNewCollection')).toBeHidden()
  await page.locator('#myTvFilmMove').click()
  expect(writes).toEqual([
    { action: 'create-my-tv-folder', name: 'Weekend' },
    { action: 'move-my-tv', file: 'Harry Potter 1.mp4', folder: 'Weekend' },
  ])
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

test('library updates remove deleted films from the selected collection grid', async ({ page }) => {
  await openLibrary(page)
  await page.locator('#myLibraryGenre').selectOption('Harry Potter')
  await page.evaluate(() => {
    library.my_tv_library = library.my_tv_library.filter(film => film.library_id !== 'potter-2')
    renderMyLibrary()
  })
  await expect(page.locator('#myLibraryGrid > button')).toHaveCount(1)
  await expect(page.locator('#myLibraryGrid')).not.toContainText('Chamber')
})

for (const cached of [false, true]) test(`chosen local copy survives ${cached ? 'cached and fresh' : 'fresh'} title metadata`, async ({ page }) => {
  const selectedPath = 'Compatibility tests/Harry Potter - Compatibility test.mp4'
  let release
  const ready = new Promise(resolve => { release = resolve })
  const detail = { key: 'movie:671', media_type: 'movie', tmdb_id: 671,
    title: 'Fresh film metadata', year: '2001', on_mabeltv: true, providers: [],
    local: { kind: 'film', path: 'Harry Potter 1.mp4' } }
  await page.route('**/api/my-tv/title?*', async route => {
    await ready
    await route.fulfill({ json: detail })
  })
  await openLibrary(page)
  await page.evaluate(async ({ selectedPath, cached, detail }) => {
    const original = library.my_tv_library[0]
    library.my_tv_library.push({ ...original, path: selectedPath, library_id: 'compatible-copy',
      folder: 'Compatibility tests', browser_ready: true })
    library.my_tv_folders.push('Compatibility tests')
    renderMyLibrary()
    window.copyPlayback = []
    window.playOnTv = source => window.copyPlayback.push({ destination: 'tv', ...source })
    window.openRemotePlayer = source => window.copyPlayback.push({ destination: 'device', ...source })
    if (cached) await writePortalDataCache('my-tv-title-v1:movie:671', { ...detail, title: 'Cached film metadata' })
  }, { selectedPath, cached, detail })
  await page.locator('#myLibraryGenre').selectOption('Compatibility tests')
  await page.locator('#myLibraryGrid > button').click()
  if (cached) {
    await expect(page.locator('#myTvTitleName')).toHaveText('Cached film metadata')
    await page.locator('#myTvTitleFilmTv').click()
    expect(await page.evaluate(() => window.copyPlayback.at(-1).file)).toBe(selectedPath)
  }
  release()
  await expect.poll(() => page.evaluate(() => selectedMyTvTitle.title)).toBe('Fresh film metadata')
  await page.locator('#myTvTitleFilmTv').click()
  await page.locator('#myTvTitleFilmHere').click()
  expect(await page.evaluate(() => window.copyPlayback.slice(-2))).toEqual([
    { destination: 'tv', kind: 'my_tv', file: selectedPath },
    { destination: 'device', kind: 'my_tv', file: selectedPath },
  ])
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
  await page.locator('#myLibraryGenre').selectOption('Harry Potter')
  await expect(page.locator('#myLibraryGrid > .watch-card')).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('my-library-collection-filter.png'), fullPage: true })
  await page.locator('#myLibraryGenre').selectOption('*')
  await page.evaluate(() => window.MabelExperienceTheme.set('light'))
  await page.screenshot({ path: testInfo.outputPath('my-library-light.png'), fullPage: true })
})
