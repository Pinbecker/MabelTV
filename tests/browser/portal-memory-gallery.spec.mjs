import { test, expect } from './test-fixtures.mjs'
import { familyFixture, tapInContent } from './family-fixture.mjs'

test.use({ serviceWorkers: 'block' })

test('Memory gallery limits thumbnail requests, retries transient failure and retains decoded artwork', async ({ page }) => {
  const state = await familyFixture(page)
  state.assets = Array.from({ length: 20 }, (_, index) => ({ id: `photo${index}`, kind: 'photo', title: `Photo ${index}`,
    channel_number: 10, status: 'ready', artwork_url: `/api/family-media/content?id=photo${index}&artwork=1` }))
  let release
  const gate = new Promise(resolve => { release = resolve })
  let active = 0, maximum = 0, failures = 0
  await page.route('**/api/family-media/content?*', async route => {
    active++; maximum = Math.max(maximum, active)
    await gate
    active--
    if (new URL(route.request().url()).searchParams.get('id') === 'photo1' && failures++ === 0)
      await route.fulfill({ status: 502, body: 'Gateway unavailable' })
    else await route.fallback()
  })
  let requests = 0
  await page.route('**/api/family-media', async route => {
    requests++
    if (requests === 1) await route.fulfill({ status: 502, body: 'Gateway unavailable' })
    else await route.fallback()
  })
  await page.locator('#mabelChannelEpisodesTab').click()
  await tapInContent(page.getByRole('button', { name: 'Open channel 10, Family Videos', exact: true }))
  await expect(page.locator('.family-memory-card')).toHaveCount(20)
  await expect.poll(() => active).toBe(4)
  expect(maximum).toBe(4)
  release()
  await expect.poll(() => page.locator('.family-memory-card img').first().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  const original = await page.locator('.family-memory-card img').first().elementHandle()
  await page.evaluate(() => loadFamilyLibrary())
  expect(await original.evaluate(image => image.isConnected)).toBe(true)
  await expect(page.locator('#notice')).not.toContainText('could not complete')
  await expect.poll(() => failures).toBeGreaterThanOrEqual(2)
  await expect.poll(() => page.locator('.family-memory-card img').nth(1).evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  expect(maximum).toBeLessThanOrEqual(4)
})

test('A cached family channel opens before a delayed catalogue refresh after cold reload', async ({ page }) => {
  const state = await familyFixture(page)
  state.assets = [{ id: 'photo', kind: 'photo', title: 'Together', channel_number: 10, status: 'ready',
    artwork_url: '/api/family-media/content?id=photo&artwork=1' }]
  await page.evaluate(() => loadFamilyLibrary())
  await page.waitForFunction(async () => (await MabelAppCache.read('family-media-v1'))?.data?.assets?.length === 1)
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/api/family-media', async route => { await gate; await route.fallback() })
  await page.reload()
  await expect(page.locator('#app')).toBeVisible()
  await page.locator('[data-view-button="watch"]').click()
  await tapInContent(page.getByRole('button', { name: 'Open channel 10, Family Videos', exact: true }))
  await expect(page.locator('.family-memory-card')).toHaveCount(1)
  release()
})

test('A short device video clip plays inside its composition with another photo and ends before the file', async ({ page }) => {
  const state = await familyFixture(page)
  state.assets = [{ id: 'photo', kind: 'photo', title: 'Together', channel_number: 10, status: 'ready',
    artwork_url: '/api/family-media/content?id=photo&artwork=1' }]
  await page.route('**/api/family-media/start', route => route.fulfill({ json: {
    id: 'clips', kind: 'memories', settings: {}, scenes: [
      { kind: 'video', video_index: 1, seconds: 8, clip_start: 5, items: [
        { id: 'photo', kind: 'photo', width: 600, height: 900, source: '/api/family-media/content?id=photo' },
        { id: 'video', kind: 'video', width: 1280, height: 720, source: '/__fixture/story.wav', artwork: '/api/family-media/content?id=poster' }],
        frames: [{ x: .02, y: .025, width: .465, height: .95 }, { x: .515, y: .025, width: .465, height: .95 }] },
      { kind: 'photo', seconds: 30, items: [{ id: 'next', source: '/api/family-media/content?id=next' }] },
    ],
  } }))
  await page.locator('#mabelChannelEpisodesTab').click()
  await tapInContent(page.getByRole('button', { name: 'Open channel 10, Family Videos', exact: true }))
  await page.locator('#channelWatchTv').click()
  await page.locator('#familyMemoryPlaybackDevice').click()
  await expect(page.locator('.is-current .family-memory-photo img')).toHaveCount(2)
  await expect(page.locator('.is-current .family-memory-photo #familyDeviceVideo')).toBeVisible()
  expect(await page.locator('#familyDeviceVideo').evaluate(video => video.controls)).toBe(false)
  await page.locator('#familyDeviceVideo').evaluate(video => {
    familyDeviceMemories.paused = false
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 13.1 })
    video.dispatchEvent(new Event('timeupdate'))
  })
  await expect(page.locator('#familyDeviceMemoryCount')).toHaveText('2 of 2')
  await page.locator('#familyDeviceClose').click()
  await expect(page.locator('#familyDevicePlayer > #familyDeviceVideo')).toHaveCount(1)
})
