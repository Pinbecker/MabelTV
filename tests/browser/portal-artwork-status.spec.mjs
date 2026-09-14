import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

test('watched and part-watched marks follow titles across every artwork catalogue', async ({ page }) => {
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => Boolean(library))).toBe(true)
  await page.evaluate(() => {
    myTvViewingData = { items: [
      { key: 'movie:1000', media_type: 'movie', tmdb_id: 1000,
        title: 'Snowy Adventure', manual_state: 'watched', history: [1] },
      { key: 'tv:2000', media_type: 'tv', tmdb_id: 2000,
        title: 'Fixture Drama', manual_state: 'part_watched',
        episodes: { '1:1': { watched: true } } },
    ] }
    const film = { ...library.channels[0].programmes[0], path: 'Snowy Adventure.mp4',
      folder: '', metadata: { ...library.channels[0].programmes[0].metadata } }
    library.my_tv_library = [film]
    library.my_tv_series = [{
      id: 'fixture-drama', title: 'Fixture Drama', stored_title: 'Fixture Drama',
      favourite: true, episode_count: 2, watched_count: 1,
      seasons: [1], episodes: [], metadata: { tmdb_id: 2000, title: 'Fixture Drama' },
    }]
    renderHomeLibrary()
    remoteKind = 'channel'
    renderRemoteViewing()
    renderMyTvSeries('')
    renderViewingBrowse('films')
  })

  const myTvFavourite = page.locator('#homeFavouritesRail .home-poster-card[aria-label*="from My TV"]')
  await expect(myTvFavourite.locator('.my-tv-artwork-status.is-watched')).toHaveCount(1)
  await expect(myTvFavourite.locator('.home-favourite-mark')).toHaveCount(1)
  const marks = await myTvFavourite.evaluate(card => ({
    heart: card.querySelector('.home-favourite-mark').getBoundingClientRect().bottom,
    watched: card.querySelector('.my-tv-artwork-status').getBoundingClientRect().top,
  }))
  expect(marks.watched).toBeGreaterThan(marks.heart)
  await expect(page.locator('#homeFavouritesRail .my-tv-artwork-status.is-part-watched')).toHaveCount(1)
  await expect(page.locator('#homeFavouritesRail .home-poster-card[aria-label*="from Family Films"] .my-tv-artwork-status')).toHaveCount(0)
  await expect(page.locator('#remoteMabel .my-tv-artwork-status')).toHaveCount(0)
  await expect(page.locator('#myTvSeriesRail .my-tv-artwork-status.is-part-watched')).toHaveCount(1)
  await expect(page.locator('#viewingBrowseGrid .my-tv-artwork-status')).toHaveCount(0)

  await page.evaluate(() => openChannel(1, false))
  await expect(page.locator('#channels .my-tv-artwork-status')).toHaveCount(0)

  await page.evaluate(() => {
    renderMyTvTitleEnrichment({
      key: 'movie:1000', media_type: 'movie', title: 'Snowy Adventure',
      collection: { name: 'Fixture Collection', parts: [
        { key: 'movie:1000', media_type: 'movie', tmdb_id: 1000,
          title: 'Snowy Adventure', year: '2026' },
        { key: 'movie:1001', media_type: 'movie', tmdb_id: 1001,
          title: 'Sunny Adventure', year: '2027' },
      ] },
    }, 'myTvTitle', () => {})
    renderMyTvPersonDetail({
      name: 'Fixture Actor', biography: '', known_for: [
        { key: 'movie:1000', media_type: 'movie', tmdb_id: 1000,
          title: 'Snowy Adventure', year: '2026' },
        { key: 'tv:2000', media_type: 'tv', tmdb_id: 2000,
          title: 'Fixture Drama', year: '2025' },
      ],
    })
  })
  await expect(page.locator('#myTvTitleFranchiseRail .my-tv-artwork-status.is-watched')).toHaveCount(1)
  await expect(page.locator('#myTvPersonCredits .my-tv-artwork-status.is-watched')).toHaveCount(1)
  await expect(page.locator('#myTvPersonCredits .my-tv-artwork-status.is-part-watched')).toHaveCount(1)
})
