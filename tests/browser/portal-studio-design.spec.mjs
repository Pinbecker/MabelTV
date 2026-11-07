import { test, expect } from './test-fixtures.mjs'
import { openStudio } from './studio-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

test('destination sheet fits its content and keeps controls reachable across choices', async ({ page }, info) => {
  await page.addInitScript(() => { localStorage.setItem('mabeltv-experience-theme', 'light'); localStorage.setItem('mabeltv-experience-accent-hue', '190') })
  const { writes } = await openStudio(page, { online: true })
  await page.getByRole('button', { name: 'BBC iPlayer', exact: true }).click()
  await page.locator('#studioIplayerSearch').fill('Ludwig')
  await page.locator('#studioIplayerSearch').press('Enter')
  await page.locator('.studio-programme').click()
  await page.locator('#studioEpisodesAll').click()
  await page.locator('#studioEpisodesContinue').click()
  const sheet = page.locator('#studioDestinationSheet > article')
  const before = await sheet.boundingBox(), footer = await page.locator('#studioDestinationSubmit').boundingBox()
  for (const destination of ['mabel', 'icloud', 'film']) {
    await page.locator(`input[name="studioDestination"][value="${destination}"]`).locator('..').click()
    for (const version of ['original', 'optimised', 'both']) {
      await page.locator(`input[name="studioCloudCopies"][value="${version}"]`).locator('..').click()
      const after = await sheet.boundingBox(), button = await page.locator('#studioDestinationSubmit').boundingBox()
      expect(after.y).toBeGreaterThanOrEqual(0)
      expect(after.y + after.height).toBeLessThanOrEqual(page.viewportSize().height)
      expect(button.y + button.height).toBeLessThanOrEqual(page.viewportSize().height)
      expect(button.height).toBeGreaterThanOrEqual(44)
      await expect(page.locator('#studioCloudCopiesLabel')).toHaveText(destination === 'icloud' ? 'Version' : 'iCloud copy')
    }
  }
  await page.locator('#studioCompression').selectOption('balanced')
  await expect(page.locator('#studioCompression')).toHaveValue('balanced')
  expect(writes.some(write => write.path === '/api/studio/jobs')).toBe(false)
  expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('approved-destination.png') })
  await page.locator('#studioDestinationClose').click()
  await page.getByRole('button', { name: 'iCloud library', exact: true }).click()
  const tabs = await page.locator('.studio-tabs').boundingBox(), search = await page.locator('.studio-cloud-search').boundingBox()
  expect(search.y - tabs.y - tabs.height).toBeLessThanOrEqual(10)
  await page.locator('.studio-title .view-back').click()
  const viewing = await page.locator('#myTvMyViewing').boundingBox(), library = await page.locator('#myTvMyLibrary').boundingBox(), studio = await page.locator('.studio-home-entry').boundingBox()
  expect(Math.abs(viewing.height - studio.height)).toBeLessThan(1)
  expect(Math.abs(library.height - studio.height)).toBeLessThan(1)
  await page.screenshot({ path: info.outputPath('aligned-shortcuts.png') })
})

test('large playback confirmation cancels without a command and plays only after explicit acceptance', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('mabeltv-experience-theme', 'light'))
  const writes = [], native = []
  page.on('dialog', dialog => { native.push(dialog.type()); void dialog.dismiss() })
  await page.route('**/api/play-on-tv', route => { writes.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }) })
  await page.goto('/')
  await page.waitForFunction(() => library?.channels?.length)
  await page.evaluate(() => openWatchProgrammeSheet(library.channels[0], library.channels[0].programmes[0]))
  await page.locator('#watchProgrammeTv').click()
  const sheet = page.locator('#portalConfirmationSheet')
  await expect(sheet).toBeVisible()
  await expect(page.locator('#portalConfirmationTitle')).toContainText('Snowy Adventure')
  for (const id of ['portalConfirmationAccept', 'portalConfirmationCancel']) {
    const box = await page.locator('#' + id).boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(52)
    expect(box.width).toBeGreaterThan(250)
  }
  await page.screenshot({ path: info.outputPath('large-playback-confirmation.png') })
  await page.locator('#portalConfirmationCancel').click()
  expect(writes).toHaveLength(0)
  await expect(page.locator('#watchProgrammeSheet')).toBeVisible()
  await page.locator('#watchProgrammeTv').click()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  expect(writes).toHaveLength(0)
  await page.locator('#watchProgrammeTv').click()
  await page.locator('#portalConfirmationAccept').click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ kind: 'channel', channel: 1, file: 'Snowy Adventure.mp4' })
  expect(native).toEqual([])
})

async function openTvConfirmation(page) {
  await page.route('**/api/studio/diagnostics', route => route.fulfill({ json: { ok: true } }))
  await page.goto('/')
  await page.waitForFunction(() => library?.channels?.length)
  await page.evaluate(() => openWatchProgrammeSheet(library.channels[0], library.channels[0].programmes[0]))
  await page.locator('#watchProgrammeTv').click()
}

test('TV playback stays pending, blocks duplicate taps and closes the programme only after success', async ({ page }, info) => {
  let release, writes = 0
  await page.route('**/api/play-on-tv', async route => {
    writes++
    await new Promise(resolve => { release = resolve })
    await route.fulfill({ json: { ok: true, message: 'Playing Snowy Adventure on Mabel TV' } })
  })
  await openTvConfirmation(page)
  await page.locator('#portalConfirmationAccept').click()
  await expect(page.locator('#portalConfirmationAccept')).toHaveText('Starting on TV…')
  await expect(page.locator('#portalConfirmationAccept')).toBeDisabled()
  await expect(page.locator('#portalConfirmationCancel')).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.evaluate(() => { document.querySelector('#portalConfirmationAccept').click(); void playOnTv({kind:'channel'}, 'Duplicate') })
  await expect(page.locator('#portalConfirmationSheet')).toBeVisible()
  await expect.poll(() => writes).toBe(1)
  await page.screenshot({ path: info.outputPath('tv-starting.png') })
  release()
  await expect(page.locator('#portalConfirmationSheet')).toBeHidden()
  await expect(page.locator('#watchProgrammeSheet')).toBeHidden()
  await expect(page.locator('#notice')).toContainText('Playing Snowy Adventure')
})

test('TV playback failure stays in front with an explicit retry and cancel', async ({ page }, info) => {
  let writes = 0
  await page.route('**/api/play-on-tv', route => {
    writes++
    return route.fulfill(writes === 1
      ? { status: 400, json: { error: 'The TV player is not ready to start that video' } }
      : { json: { ok: true } })
  })
  await openTvConfirmation(page)
  await page.locator('#portalConfirmationAccept').click()
  await expect(page.locator('#portalConfirmationMessage')).toHaveText('The TV player is not ready to start that video')
  await expect(page.locator('#portalConfirmationAccept')).toHaveText('Try again')
  await expect(page.locator('#portalConfirmationCancel')).toBeEnabled()
  await page.screenshot({ path: info.outputPath('tv-failed.png') })
  expect(writes).toBe(1)
  await page.locator('#portalConfirmationAccept').click()
  await expect(page.locator('#watchProgrammeSheet')).toBeHidden()
  expect(writes).toBe(2)
})

test('TV playback lost response is visible and never retried automatically', async ({ page }) => {
  let writes = 0
  await page.route('**/api/play-on-tv', route => { writes++; return route.abort('failed') })
  await openTvConfirmation(page)
  await page.locator('#portalConfirmationAccept').click()
  await expect(page.locator('#portalConfirmationAccept')).toHaveText('Try again')
  await expect(page.locator('#portalConfirmationMessage')).toContainText('Connection interrupted')
  await page.locator('#portalConfirmationCancel').click()
  await expect(page.locator('#portalConfirmationSheet')).toBeHidden()
  await expect(page.locator('#watchProgrammeSheet')).toBeVisible()
  expect(writes).toBe(1)
})

test('TV playback expired session exposes the PIN screen instead of another play loop', async ({ page }) => {
  await page.route('**/api/play-on-tv', route => route.fulfill({ status: 401, json: { error: 'Session expired' } }))
  await openTvConfirmation(page)
  await page.locator('#portalConfirmationAccept').click()
  await expect(page.locator('#portalConfirmationSheet')).toBeHidden()
  await expect(page.locator('#watchProgrammeSheet')).toBeHidden()
  await expect(page.locator('#loginError')).toContainText('Your session was locked')
  await expect(page.locator('#pin')).toBeVisible()
})
