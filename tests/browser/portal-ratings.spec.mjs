import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('Ratings is a four-wide watched-only queue and saves from the lightweight title card', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine owns the Ratings reference')
  const records = [{
    key: 'movie:101', media_type: 'movie', tmdb_id: 101,
    title: 'Already Seen', year: '2001', poster_path: '/rated-101.jpg',
    manual_state: 'watched', history: [100],
  }, {
    key: 'tv:102', media_type: 'tv', tmdb_id: 102,
    title: 'Finished Series', year: '2020', poster_path: '/rated-102.jpg',
    manual_state: 'watched', history: [200],
  }, {
    key: 'movie:103', media_type: 'movie', tmdb_id: 103,
    title: 'Already Rated', year: '1999', poster_path: '/rated-103.jpg',
    manual_state: 'watched', history: [300], personal_rating: 8,
  }, {
    key: 'movie:104', media_type: 'movie', tmdb_id: 104,
    title: 'Not Watched', year: '2024', poster_path: '/rated-104.jpg',
    watchlisted: true,
  }, ...[105, 106, 107].map(identifier => ({
    key: `movie:${identifier}`, media_type: 'movie', tmdb_id: identifier,
    title: `Seen Film ${identifier}`, year: '2018', poster_path: `/rated-${identifier}.jpg`,
    manual_state: 'watched', history: [identifier],
  }))]
  await page.route('https://image.tmdb.org/**', route => route.fulfill({
    status: 200, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#193b45"/></svg>',
  }))
  await page.route('**/api/adult/viewing', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: records, region: 'GB', watchmode_configured: true } })
      return
    }
    const payload = route.request().postDataJSON()
    const record = records.find(item => item.key === `${payload.media_type}:${payload.tmdb_id}`)
    if (payload.action === 'watched') {
      record.manual_state = 'watched'
      record.history = [...(record.history || []), Date.now() / 1000]
    } else if (payload.action === 'not_watched') {
      record.manual_state = 'not_watched'
      record.history = []
    } else if (payload.action === 'rating') {
      if (payload.rating && record.manual_state !== 'watched') {
        await route.fulfill({ status: 400, json: {
          error: 'Mark this title as watched before rating it',
        } })
        return
      }
      if (payload.rating) record.personal_rating = payload.rating
      else delete record.personal_rating
    }
    await route.fulfill({ json: { ok: true, key: record.key, viewing: record } })
  })
  await page.route(url => new URL(url).pathname === '/api/adult/title', async route => {
    const identifier = Number(new URL(route.request().url()).searchParams.get('tmdb_id'))
    const record = records.find(item => item.tmdb_id === identifier)
    await route.fulfill({ json: {
      ...record, release_date: `${record.year}-01-01`, runtime: 100,
      genres: ['Drama'], directors: ['Example Director'], providers: [],
      cast: [], seasons: record.media_type === 'tv'
        ? [{ number: 1, name: 'Series 1', episodes: 2, watched_count: 2 }] : [],
      viewing: record,
    } })
  })
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    history.replaceState({ adultViewing: true }, '', '#adult-viewing')
    openView('adult-viewing')
  })
  await page.locator('#adultViewingRatings').click()
  await expect(page.locator('#view-adult-ratings')).toBeVisible()
  await expect(page.locator('#adultRatingsGrid .adult-explore-card')).toHaveCount(5)
  await expect(page.locator('#adultRatingsGrid [data-explore-action]')).toHaveCount(0)
  const firstRow = await page.locator('#adultRatingsGrid .adult-explore-card').evaluateAll(cards =>
    cards.filter(card => Math.round(card.getBoundingClientRect().top)
      === Math.round(cards[0].getBoundingClientRect().top)).length)
  expect(firstRow).toBe(4)

  await page.locator('#adultRatingsGrid .adult-explore-card').first()
    .locator('.adult-explore-open-art').click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(page.locator('#adultTitleSheet .adult-provider-section')).toBeHidden()
  const rating = page.locator('#adultTitlePersonalRating .adult-personal-rating')
  await expect(rating.locator('.adult-rating-star')).toHaveCount(10)
  const track = rating.locator('.adult-rating-track')
  const box = await track.boundingBox()
  await page.mouse.click(box.x + box.width * .66, box.y + box.height / 2)
  await expect(rating).toHaveAttribute('aria-valuenow', '7')
  await expect(page.locator('#adultRatingsGrid .adult-explore-card')).toHaveCount(4)
  const geometry = await rating.evaluate(control => {
    const host = control.closest('.adult-personal-rating-host').getBoundingClientRect()
    const summary = control.closest('.watch-film-summary').getBoundingClientRect()
    const track = control.querySelector('.adult-rating-track').getBoundingClientRect()
    return {
      height: host.height,
      bottomGap: summary.bottom - host.bottom,
      hostWidth: host.width,
      trackWidth: track.width,
    }
  })
  expect(geometry.height).toBeLessThanOrEqual(26)
  expect(geometry.bottomGap).toBeLessThanOrEqual(12)
  expect(geometry.trackWidth).toBeGreaterThan(geometry.hostWidth * .65)
  await page.screenshot({ path: testInfo.outputPath('ratings-title-card.png'), animations: 'disabled' })

  await expect.poll(() => records[0].personal_rating).toBe(7)
  const clearRating = rating.locator('.adult-rating-label')
  await expect(clearRating).toBeEnabled()
  await clearRating.click()
  await expect(rating).toHaveAttribute('aria-valuenow', '0')
  await expect(page.locator('#adultRatingsGrid .adult-explore-card')).toHaveCount(5)

  await page.evaluate(() => openAdultTitle({
    key: 'movie:104', media_type: 'movie', tmdb_id: 104,
    title: 'Not Watched', catalogue_only: true,
  }))
  const locked = page.locator('#adultTitlePersonalRating .adult-personal-rating')
  await expect(locked).toHaveClass(/is-locked/)
  await expect(locked).toContainText('Mark watched to add a rating')
  await expect(locked.locator('.adult-rating-track')).toHaveCount(0)
  await page.locator('#adultTitleIntents [data-viewing-action="watched"]').click()
  await expect(page.locator('#adultTitlePersonalRating .adult-rating-star')).toHaveCount(10)
})
