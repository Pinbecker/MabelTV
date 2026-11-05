import { test, expect } from './test-fixtures.mjs'
import { openStudio } from './studio-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

for (const tab of ['cloud', 'torrents']) {
  test(`Studio ${tab} opens on a LAN connection without secure-context randomUUID`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }))
    await openStudio(page)
    await page.goto('/#my-tv-studio/' + tab)
    await expect(page.locator(tab === 'cloud' ? '#studioCloudPane' : '#studioTorrentPane')).toBeVisible()
    const identity = await page.evaluate(() => ({
      uuidAvailable: typeof crypto.randomUUID,
      source: uploadSourceId,
      family: familyUploadSourceId(),
      repeatedFamily: familyUploadSourceId(),
      fresh: [portalRandomUuid(), portalRandomUuid()],
    }))
    expect(identity.uuidAvailable).toBe('undefined')
    expect(identity.source).toMatch(/^[a-f0-9]{32}$/)
    expect(identity.family).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    expect(identity.repeatedFamily).toBe(identity.family)
    expect(identity.fresh[0]).not.toBe(identity.fresh[1])
    await page.reload()
    await expect(page.locator('#view-my-tv-studio')).toBeVisible()
    expect(await page.evaluate(() => uploadSourceId)).toBe(identity.source)
    expect(errors).toEqual([])
  })
}

test('existing upload identities survive the LAN startup correction', async ({ page }) => {
  const source = 'ab'.repeat(16), family = '12345678-1234-4234-9234-123456789abc'
  await page.addInitScript(({ source, family }) => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined })
    localStorage.setItem('mabeltv-upload-source-id', source)
    sessionStorage.setItem('mabel-family-upload-source', family)
  }, { source, family })
  await openStudio(page)
  expect(await page.evaluate(() => ({ source: uploadSourceId, family: familyUploadSourceId() }))).toEqual({ source, family })
})
