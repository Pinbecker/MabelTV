import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' })

async function searchUnmatchedFilm(page, present = true) {
  await page.route('**/api/my-tv/discovery?*', route => route.fulfill({ json: {
    results: [{ key: 'local:shrek-file', media_type: 'movie', tmdb_id: 0,
      title: 'Shrek', poster_path: '', on_mabeltv: true,
      local: { kind: 'film', path: 'Shrek.mp4' } }],
  } }))
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(present => {
    library.my_tv_library = present ? [{ path: 'Shrek.mp4', display_name: 'Shrek',
      library_id: 'shrek-file', metadata: {}, browser_ready: true }] : []
    library.remote_viewing = { tv_running: false, allow_simultaneous: true }
  }, present)
  await page.locator('[data-view-button="my-tv-home"]').click()
  await page.getByRole('searchbox', { name: 'Search films, series, actors and directors' }).fill('Shrek')
  await expect(page.locator('#myTvDiscoveryGrid button')).toHaveCount(1)
  await page.locator('#myTvDiscoveryGrid button').click()
}

for (const destination of ['device', 'TV']) {
  test(`unmatched local search films open and send the real file to the ${destination}`, async ({ page }) => {
    const routePath = destination === 'TV' ? '/api/play-on-tv' : '/api/remote/start'
    await page.route('**/api/remote/**', route => route.fulfill({ status: 204 }))
    await page.route('**' + routePath, route => route.fulfill({ json: {
      ok: true, title: 'Shrek', stream_url: '/api/remote/media?stream=fixture',
    } }))
    await searchUnmatchedFilm(page)
    await expect(page.locator('#watchFilmSheet')).toBeVisible()
    await expect(page.locator('#watchFilmTitle')).toHaveText('Shrek')
    await expect(page.locator('#watchFilmManage')).toBeVisible()
    await expect(page.locator('#notice')).not.toContainText('Match this local film')
    const request = page.waitForRequest(request => new URL(request.url()).pathname === routePath)
    if (destination === 'TV') page.once('dialog', dialog => dialog.accept())
    await page.locator(destination === 'TV' ? '#watchFilmTv' : '#watchFilmHere').click()
    expect((await request).postDataJSON()).toEqual({ kind: 'my_tv', file: 'Shrek.mp4' })
    if (destination === 'device') {
      await expect(page.locator('#iosWatchPlayer')).toBeVisible()
      const released = page.waitForResponse(response => new URL(response.url()).pathname === '/api/remote/release')
      await page.locator('#iosWatchBack').click()
      await released
      await expect(page.locator('#watchFilmSheet')).toBeVisible()
    }
  })
}

test('a stale unmatched search result reports a missing file without opening playback', async ({ page }) => {
  await searchUnmatchedFilm(page, false)
  await expect(page.locator('#watchFilmSheet')).toBeHidden()
  await expect(page.locator('#notice')).toContainText('That local film is no longer available')
})
