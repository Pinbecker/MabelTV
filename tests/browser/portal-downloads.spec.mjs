import { test, expect } from './test-fixtures.mjs'

async function openDownloads(page, theme = 'dark') {
  await page.addInitScript(value => localStorage.setItem('mabeltv-experience-theme', value), theme)
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(async () => { let stage = 'initialise'; try {
    await window.MabelOffline.initialise()
    stage = 'open database'
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mabeltv-offline-v1', window.MabelOfflineSchema.version)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    stage = 'write sample media'
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['downloads', 'chunks'], 'readwrite')
      const samples = [
        ['banana', 'Yakka Dee! · Banana', 'channel', 'complete'],
        ['dog', 'Yakka Dee! · Dog', 'channel', 'downloading'],
        ['book', 'Yakka Dee! · Book', 'channel', 'downloading'],
        ['shrek', 'Shrek', 'my_tv', 'complete'],
        ['series', 'Blue Lights · Series 1, Episode 2', 'my-tv-series', 'complete'],
      ]
      for (const [id, title, kind, status] of samples) {
        transaction.objectStore('downloads').put({ id, title, status, size: 1048576,
          downloadedBytes: status === 'complete' ? 1048576 : 524288, createdAt: 100,
          source: { kind, channel: 1, file: id + '.mp4' }, protected: kind !== 'channel',
          error: id === 'book' ? 'Connection interrupted. Your saved progress is safe.' : id === 'dog' ? 'Download paused' : '' })
        // Windows Playwright WebKit cannot persist Blob data. These UI fixtures
        // use binary chunks; pwa.spec covers real Blob media with Chromium.
        transaction.objectStore('chunks').put({ key: id + ':0', downloadId: id, index: 0, data: new TextEncoder().encode('test-media').buffer })
      }
      transaction.oncomplete = resolve; transaction.onerror = event => reject(transaction.error || event.target.error)
    })
    db.close()
    } catch (error) { throw new Error('Download fixture ' + stage + ': ' + (error?.name || '') + ' ' + (error?.message || String(error))) }
  })
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#watchDownloadsTab').click()
  await expect(page.locator('.download-card')).toHaveCount(3)
}

test('downloads filter by domain and state, search locally and remove only the device copy', async ({ page }) => {
  await openDownloads(page)
  await expect(page.locator('#downloadsSummary')).toHaveText('1 ready offline · 2 in progress')
  await expect(page.locator('#downloadsStorage')).toContainText('2 MB saved on this device')
  await expect(page.locator('[data-download-id="dog"] .download-status')).toHaveText('Paused')
  await expect(page.locator('[data-download-id="dog"] button.download-primary')).toHaveText('Resume')
  await page.getByRole('button', { name: 'Ready 1', exact: true }).click()
  await expect(page.locator('.download-card')).toHaveCount(1)
  await expect(page.locator('.download-card')).toContainText('Banana')
  await page.getByRole('button', { name: 'All 3', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search downloads' }).fill('Book')
  await expect(page.locator('.download-card')).toHaveCount(1)
  await expect(page.locator('.download-card')).toContainText('Needs attention')
  await page.getByRole('searchbox', { name: 'Search downloads' }).fill('missing')
  await expect(page.locator('.downloads-empty')).toContainText('No matching downloads')
  await page.getByRole('button', { name: 'Show all downloads' }).click()
  await page.getByRole('button', { name: 'Download options for Yakka Dee! · Banana' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from this device' }).click()
  await expect(page.locator('#downloadOptionsTitle')).toHaveText('Remove this download?')
  await page.getByRole('button', { name: 'Keep download' }).click()
  await expect(page.locator('#downloadOptionsTitle')).toHaveText('Yakka Dee! · Banana')
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from this device' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from this device' }).click()
  await expect(page.locator('.download-card')).toHaveCount(2)
  expect(await page.evaluate(async () => (await window.MabelOffline.listDownloads()).map(item => item.id))).not.toContain('banana')
  const library = await page.request.get('/api/library'); expect(library.ok()).toBe(true)
  expect((await library.json()).channels.length).toBeGreaterThan(0)
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#myTvHomeDownloadsTab').click()
  await expect(page.locator('.download-card')).toHaveCount(2)
  await expect(page.locator('#downloadsDomainLabel')).toHaveText('My TV downloads')
  await expect(page.locator('#downloadsGrid')).toContainText('Shrek')
  await expect(page.locator('#downloadsGrid')).not.toContainText('Yakka Dee')
  await expect(page.locator('#downloadsSearch')).toHaveValue('')
})

for (const theme of ['dark', 'light']) {
  test(`downloads and action sheets fit the ${theme} phone/tablet layout`, async ({ page }, testInfo) => {
    await openDownloads(page, theme)
    await page.evaluate(() => {
      pendingDownloads.set('preparing', { title: 'Getting your next episode ready', source: { kind: 'channel' }, phase: 'preparing' })
      pendingDownloads.set('failed', { title: 'A title that needs another try', source: { kind: 'channel' }, phase: 'error', message: 'The TV connection was interrupted.' })
      return renderDownloads()
    })
    await expect(page.locator('.download-pending')).toHaveCount(2)
    await expect(page.locator('.download-pending progress')).not.toHaveAttribute('value')
    await page.getByRole('button', { name: 'Ready 1', exact: true }).click()
    await expect(page.locator('.download-card')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath(`downloads-${theme}.png`) })
    const layout = await page.locator('#watchDownloadsLayout').evaluate(element => ({
      fits: element.scrollWidth <= element.clientWidth,
      buttons: [...element.querySelectorAll('.download-card button')].map(button => button.getBoundingClientRect().height),
    }))
    expect(layout.fits).toBe(true); expect(layout.buttons.every(height => height >= 44)).toBe(true)
    await page.getByRole('button', { name: 'Download options for Yakka Dee! · Banana' }).click()
    await page.screenshot({ path: testInfo.outputPath(`download-options-${theme}.png`) })
    await page.getByRole('dialog').getByRole('button', { name: 'Remove from this device' }).click()
    await page.screenshot({ path: testInfo.outputPath(`download-remove-${theme}.png`) })
    const bounds = await page.locator('#downloadOptionsSheet').evaluate(element => {
      const box = element.getBoundingClientRect(); return { fits: box.left >= 0 && box.right <= innerWidth, height: box.height, viewport: innerHeight }
    })
    expect(bounds.fits).toBe(true); expect(bounds.height).toBeLessThanOrEqual(bounds.viewport)
    await page.getByRole('button', { name: 'Close download options' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  })
}

test('private download menus use the local PIN, handle cancellation and close when the portal locks', async ({ page }, testInfo) => {
  await openDownloads(page)
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.locator('#myTvHomeDownloadsTab').click()
  await page.evaluate(async () => {
    await window.MabelOffline.rememberSecurity(true, '2468')
    setOfflineProtectedAccess(false)
    await renderDownloads()
  })
  await expect(page.locator('#downloadsGrid')).not.toContainText('Shrek')
  await expect(page.locator('#downloadsTools')).toBeHidden()
  await page.getByRole('button', { name: 'Unlock downloads', exact: true }).click()
  await expect(page.locator('#downloadUnlockSheet')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('download-pin.png') })
  await page.getByRole('button', { name: 'Close download unlock' }).click()
  await expect(page.locator('#downloadUnlockSheet')).toBeHidden()
  await expect(page.locator('.download-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Unlock downloads', exact: true }).click()
  await page.locator('#downloadUnlockSheet').getByLabel('Parent PIN', { exact: true }).fill('0000')
  await page.locator('#downloadUnlockSubmit').click()
  await expect(page.locator('#downloadUnlockError')).toContainText('That PIN is not correct')
  await expect(page.locator('.download-card')).toHaveCount(0)
  await page.locator('#downloadUnlockSheet').getByLabel('Parent PIN', { exact: true }).fill('2468')
  await page.locator('#downloadUnlockSubmit').click()
  await expect(page.locator('#downloadUnlockSheet')).toBeHidden()
  await expect(page.locator('.download-card')).toHaveCount(2)
  await expect(page.locator('#downloadsGrid')).toContainText('Shrek')
  await page.getByRole('button', { name: 'Download options for Shrek' }).click()
  await page.evaluate(() => { setOfflineProtectedAccess(false); showOnly('login') })
  await expect(page.locator('#downloadOptionsSheet')).toBeHidden()
})
