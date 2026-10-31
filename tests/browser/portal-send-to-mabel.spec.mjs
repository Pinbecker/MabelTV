import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

for (const create of [false, true]) {
  test(`local Shrek sends an independent copy to ${create ? 'a new' : 'an existing'} channel`, async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.app-shell')).toBeVisible()
    await page.evaluate(() => {
      library.my_tv_library = [{ path: 'Shrek.mp4', display_name: 'Shrek', browser_ready: true, metadata: {} }]
      library.channels = [{ number: 11, name: 'Films', content_type: 'films' }, { number: 2, name: 'Shows', content_type: 'shows' }]
      window.__originalShrek = library.my_tv_library[0]; openWatchFilmSheet(window.__originalShrek)
    })
    await page.locator('#watchFilmSheet [data-send-to-mabel]').click()
    await expect(page.locator('#myTvSendSheet')).toBeVisible()
    if (!create && test.info().project.name === 'iphone-webkit') await page.screenshot({ path: '../../work/independent-mabel-send-iphone.png' })
    await expect(page.locator('#myTvSendChannel option')).toHaveCount(2)
    if (create) {
      await page.locator('#myTvSendChannel').selectOption('new')
      await page.locator('#myTvSendName').fill('Family films')
    }
    await page.route('**/api/my-tv/send-to-mabel', route => route.fulfill({ status: 202, json: {
      ok: true, jobs: ['copy'], count: 1, channel: 11, channel_name: 'Films',
    } }))
    const sent = page.waitForRequest('**/api/my-tv/send-to-mabel')
    await page.locator('#myTvSendSubmit').click()
    expect((await sent).postDataJSON()).toEqual({ kind: 'my_tv', file: 'Shrek.mp4',
      ...(create ? { new_channel: 'Family films' } : { channel: 11 }) })
    await expect(page.locator('#myTvSendSheet')).not.toBeVisible()
    await expect(page.locator('#watchFilmSheet')).toBeVisible()
    await expect(page.locator('#myTvPlayerChoiceSheet')).toHaveCount(0)
    expect(await page.evaluate(() => window.__originalShrek.path)).toBe('Shrek.mp4')
  })
}

test('copy errors keep the destination sheet open and leave ordinary playback unchanged', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    library.my_tv_library = [{ path: 'Shrek.mp4', display_name: 'Shrek', browser_ready: true, metadata: {} }]
    window.__originalShrek = library.my_tv_library[0]; openWatchFilmSheet(window.__originalShrek)
  })
  await page.route('**/api/my-tv/send-to-mabel', route => route.fulfill({ status: 400, json: { error: 'Not enough space' } }))
  await page.locator('#watchFilmSheet [data-send-to-mabel]').click()
  await page.locator('#myTvSendSubmit').click()
  await expect(page.locator('#myTvSendError')).toContainText('Not enough space')
  await page.locator('#myTvSendClose').click()
  await expect(page.locator('#watchFilmSheet')).toBeVisible()
})


test('background copies use the native activity presentation', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  const result = await page.evaluate(() => activityJobMarkup({ id:'copy', file_name:'Shrek.mp4',
    source_kind:'my-tv-copy', status:'copying', channel_name:'Films', size:100, offset:25,
    source_available:true, transfer_state:'complete' }, 'upload'))
  expect(result).toContain('Copying from My TV')
  expect(result).toContain('25%')
  expect(result).not.toContain('Waiting for source file')
})
