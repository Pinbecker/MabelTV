import { test, expect } from './test-fixtures.mjs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { familyFixture, tapInContent } from './family-fixture.mjs'

test.use({ serviceWorkers: 'block' })

async function openPlaylistLibrary(page) {
  const state = await familyFixture(page)
  state.playlists = [{ id: 'afternoon', name: 'A favourite afternoon', repeat: false, duration: 2700,
    items: ['Snowy Adventure', 'Ocean Friends', 'The Gruffalo Trail'].map((title, index) => ({
      id: `item${index}`, title, channel_number: 1, channel_name: 'Family Films', file_name: `${title}.mp4`,
      available: true, artwork: 'fixture.jpg', duration: 900 })) }]
  await page.locator('#mabelChannelPlaylistsTab').click()
  await expect(page.locator('.family-playlist-card')).toHaveCount(1)
  return state
}

test('Playlist arrows move retained rows immediately and save rapid moves in order', async ({ page }) => {
  const state = await openPlaylistLibrary(page)
  await tapInContent(page.locator('.family-playlist-card'))
  const rows = page.locator('.family-playlist-row')
  const first = await rows.first().elementHandle()
  const image = await rows.first().locator('img').elementHandle()
  const title = await page.locator('#familyPlaylistFixedHead h1').elementHandle()
  let releaseSave
  const gate = new Promise(resolve => { releaseSave = resolve })
  const requests = []
  await page.route('**/api/mabel-playlists', async route => {
    if (route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON())
      await gate
    }
    await route.fallback()
  })
  await tapInContent(rows.nth(1).getByRole('button', { name: 'Move up', exact: true }))
  await expect(rows.first()).toContainText('Ocean Friends')
  expect(await first.evaluate(row => row.isConnected && row.getAnimations().length > 0)).toBe(true)
  expect(await image.evaluate(image => image.isConnected)).toBe(true)
  await tapInContent(rows.nth(2).getByRole('button', { name: 'Move up', exact: true }))
  await tapInContent(rows.nth(1).getByRole('button', { name: 'Move up', exact: true }))
  await expect(rows.first()).toContainText('The Gruffalo Trail')
  await expect.poll(() => requests.length).toBe(1)
  expect(state.calls).toHaveLength(0)
  releaseSave()
  await page.evaluate(() => playlistOrderWrites)
  expect(requests.map(value => value.item_id)).toEqual(['item1', 'item2', 'item2'])
  expect(state.playlists[0].items.map(value => value.id)).toEqual(['item2', 'item1', 'item0'])
  expect(await first.evaluate(row => row.isConnected)).toBe(true)
  expect(await image.evaluate(image => image.isConnected)).toBe(true)
  expect(await title.evaluate(title => title.isConnected)).toBe(true)
  const cached = await page.evaluate(async () => (await MabelAppCache.read('mabel-playlists-v1')).data)
  expect(cached.playlists[0].items.map(value => value.id)).toEqual(['item2', 'item1', 'item0'])
  await expect(rows.first().getByRole('button', { name: 'Move up', exact: true })).toBeDisabled()
  await expect(rows.last().getByRole('button', { name: 'Move down', exact: true })).toBeDisabled()
})

test('A rejected playlist move restores the saved order and cancels later queued moves', async ({ page }) => {
  await openPlaylistLibrary(page)
  await tapInContent(page.locator('.family-playlist-card'))
  const rows = page.locator('.family-playlist-row')
  let releaseSave
  const gate = new Promise(resolve => { releaseSave = resolve })
  let requests = 0
  await page.route('**/api/mabel-playlists', async route => {
    if (route.request().method() === 'POST') {
      requests += 1; await gate
      await route.fulfill({ status: 409, json: { error: 'Order could not be saved' } })
    } else await route.fallback()
  })
  await tapInContent(rows.nth(1).getByRole('button', { name: 'Move up', exact: true }))
  await tapInContent(rows.nth(2).getByRole('button', { name: 'Move up', exact: true }))
  releaseSave()
  await page.evaluate(() => playlistOrderWrites.catch(() => {}))
  await expect(rows.first()).toContainText('Snowy Adventure')
  await expect(rows.last()).toContainText('The Gruffalo Trail')
  await expect(page.locator('#notice')).toContainText('Order could not be saved')
  expect(requests).toBe(1)
})

test('A cold document restores saved playlists before a delayed network refresh', async ({ page }) => {
  const state = await openPlaylistLibrary(page)
  await page.waitForFunction(async () => (await MabelAppCache.read('mabel-playlists-v1'))?.data?.playlists?.length === 1)
  let releaseRefresh
  const gate = new Promise(resolve => { releaseRefresh = resolve })
  await page.route('**/api/mabel-playlists', async route => {
    await gate
    await route.fulfill({ json: { playlists: state.playlists } })
  })
  await page.reload()
  await expect(page.locator('#app')).toBeVisible()
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#mabelChannelPlaylistsTab').click()
  await expect(page.locator('.family-playlist-card > strong')).toHaveText('A favourite afternoon')
  const original = await page.locator('.family-playlist-card img').first().elementHandle()
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/mabel-playlists'))
  releaseRefresh()
  await refreshed
  await page.evaluate(() => loadMabelPlaylists())
  expect(await original.evaluate(image => image.isConnected)).toBe(true)
})

test('A changed library revision fetches current playlists before showing the tab', async ({ page }) => {
  const state = await openPlaylistLibrary(page)
  await page.waitForFunction(async () => (await MabelAppCache.read('mabel-playlists-v1'))?.data?.playlists?.length === 1)
  state.playlists[0].name = 'Changed on another phone'
  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch(), body = await response.json()
    body.revisions.library += 1
    await route.fulfill({ json: body })
  })
  await page.reload()
  await expect(page.locator('#app')).toBeVisible()
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#mabelChannelPlaylistsTab').click()
  await expect(page.locator('.family-playlist-card > strong')).toHaveText('Changed on another phone')
})

test('Locked cold startup never restores saved playlists before authentication', async ({ page }) => {
  await openPlaylistLibrary(page)
  await page.waitForFunction(async () => (await MabelAppCache.read('mabel-playlists-v1'))?.data?.playlists?.length === 1)
  await page.route('**/api/bootstrap', route => route.fulfill({ status: 401, json: { error: 'Locked' } }))
  await page.reload()
  await expect(page.locator('#app')).toBeHidden()
  await expect(page.locator('.family-playlist-card')).toHaveCount(0)
})

test('Returning to Playlists retains decoded artwork while unchanged data refreshes', async ({ page }) => {
  const state = await openPlaylistLibrary(page)
  const artwork = page.locator('.family-playlist-card img').first()
  await artwork.evaluate(image => image.decode())
  const original = await artwork.elementHandle()
  for (const tab of ['Films', 'Episodes', 'Audio']) {
    await page.locator(`#mabelChannel${tab}Tab`).click()
    await page.locator('#mabelChannelPlaylistsTab').click()
    await page.evaluate(() => loadMabelPlaylists())
    expect(await original.evaluate(image => image.isConnected && image.complete && image.naturalWidth > 0)).toBe(true)
  }
  state.playlists[0].name = 'A new afternoon'
  await page.evaluate(() => loadMabelPlaylists())
  await expect(page.locator('.family-playlist-card > strong')).toHaveText('A new afternoon')
  state.playlists = []
  await page.evaluate(() => loadMabelPlaylists())
  await expect(page.locator('.family-playlist-card')).toHaveCount(0)
  await expect(page.locator('#mabelChannelPlaylists')).toContainText('Make a favourite afternoon')
})

test('Playlist pages preserve their route and Back returns to the catalogue; a second MabelTV tap resets Episodes', async ({ page }) => {
  await openPlaylistLibrary(page)
  await expect(page.locator('.family-playlist-card img')).toHaveCount(3)
  await tapInContent(page.locator('.family-playlist-card'))
  await expect(page).toHaveURL(/#mabel-playlist\/afternoon$/)
  await expect(page.locator('#view-mabel-playlist h1')).toHaveText('A favourite afternoon')
  await expect(page.locator('#view-watch')).toBeHidden()
  await expect(page.locator('[data-view-button="watch"]')).toHaveAttribute('aria-current', 'page')
  await page.locator('[data-view-button="system"]').click()
  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#view-mabel-playlist')).toBeVisible()
  await page.reload()
  await expect(page.locator('#view-mabel-playlist h1')).toHaveText('A favourite afternoon')
  await page.locator('#familyPlaylistFixedHead .family-back').click()
  await expect(page.locator('#view-watch')).toBeVisible()
  await expect(page.locator('#mabelChannelPlaylistsTab')).toHaveAttribute('aria-selected', 'true')
  await tapInContent(page.locator('.family-playlist-card'))
  await page.locator('[data-view-button="watch"]').click()
  await expect(page).toHaveURL(/#watch$/)
  await expect(page.locator('#mabelChannelEpisodesTab')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#mabelChannelPlaylists')).toBeHidden()
})

test('Playlist catalogue and dedicated header follow phone and tablet geometry @visual', async ({ page }, info) => {
  await openPlaylistLibrary(page)
  await page.evaluate(() => { MabelExperienceTheme.set('light'); MabelExperienceTheme.setAccentHue(169) })
  const folder = join('test-results', 'playlist-pages'); await mkdir(folder, { recursive: true })
  await page.locator('.family-playlist-card').evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: join(folder, `${info.project.name}-playlist-library.png`), animations: 'disabled' })
  await page.locator('.family-playlist-card').click()
  await expect(page.locator('.family-playlist-row')).toHaveCount(3)
  const header = page.locator('#familyPlaylistFixedHead')
  const before = await header.boundingBox()
  const firstRow = await page.locator('.family-repeat').boundingBox()
  expect(firstRow.y).toBeGreaterThanOrEqual(before.y + before.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
  if (page.viewportSize().width < 861) {
    await page.evaluate(() => setPortalScrollTop(80))
    await expect.poll(async () => (await header.boundingBox()).y).toBeCloseTo(before.y, 0)
    await page.evaluate(() => setPortalScrollTop(0))
  }
  await page.screenshot({ path: join(folder, `${info.project.name}-playlist-page.png`), animations: 'disabled' })
})

test('Create Channel shares compact Edit choices without opening the keyboard and submits their values @visual', async ({ page }, info) => {
  await familyFixture(page)
  await page.evaluate(() => { MabelExperienceTheme.set('light'); MabelExperienceTheme.setAccentHue(169) })
  let submitted
  await page.route('**/api/manage', async route => {
    submitted = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } })
  })
  await page.locator('#watchNewChannel').click()
  await expect(page.locator('#addChannelPanel')).toBeVisible()
  expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT')
  await expect(page.locator('#addChannelForm input[name="newChannelContent"][value="shows"]')).toBeChecked()
  await page.getByRole('radio', { name: 'Photos & videos', exact: true }).check()
  await page.getByRole('radio', { name: 'Whole picture', exact: true }).check()
  const folder = join('test-results', 'playlist-pages'); await mkdir(folder, { recursive: true })
  await page.screenshot({ path: join(folder, `${info.project.name}-create-channel.png`), animations: 'disabled' })
  await page.locator('#newChannelNumber').fill('42')
  await page.locator('#newChannelName').fill('Our memories')
  await page.locator('#addChannelForm button[type="submit"]').click()
  await expect.poll(() => submitted).toMatchObject({ action: 'add-channel', number: 42, name: 'Our memories', content_type: 'memories', aspect: 'fit' })
  await expect(page.locator('#addChannelPanel')).not.toBeVisible()
})
