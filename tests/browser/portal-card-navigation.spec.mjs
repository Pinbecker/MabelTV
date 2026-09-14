import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
}

test('@visual content cards share compact Back and journey-closing X controls', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(() => portalSheets.open($('#myTvTitleSheet')))
  await expect(page.locator('#myTvTitleSheet > .watch-film-panel .portal-card-back')).toBeHidden()

  await page.evaluate(() => {
    const title = $('#myTvTitleSheet')
    portalSheets.suspend(title, { card: true })
    portalSheets.open($('#myTvPersonSheet'), { returnTo: () => portalSheets.open(title) })
  })
  const person = page.locator('#myTvPersonSheet')
  await expect(person).toBeVisible()
  const personBack = person.locator(':scope > .library-sheet-panel .portal-card-back')
  await expect(personBack).toBeVisible()
  const geometry = await person.evaluate(sheet => {
    const panel = sheet.querySelector('.library-sheet-panel').getBoundingClientRect()
    const close = sheet.querySelector('.portal-sheet-close').getBoundingClientRect()
    const back = sheet.querySelector(':scope > .library-sheet-panel .portal-card-back')
    return {
      closeWidth: close.width,
      closeHeight: close.height,
      closeTop: close.top - panel.top,
      closeRight: panel.right - close.right,
      backHitWidth: back.getBoundingClientRect().width,
      backIconHeight: back.querySelector('svg').getBoundingClientRect().height,
      backIcon: back.querySelector('use').getAttribute('href'),
    }
  })
  expect(geometry).toEqual({
    closeWidth: 40,
    closeHeight: 40,
    closeTop: 13,
    closeRight: 13,
    backHitWidth: 44,
    backIconHeight: 19,
    backIcon: '/portal/icons.svg#signal-arrow-left',
  })

  const personHeight = await person.locator(':scope > .library-sheet-panel').evaluate(panel =>
    panel.getBoundingClientRect().height)
  await page.evaluate(() => {
    portalSheets.suspend($('#myTvPersonSheet'), { card: true })
    portalSheets.open($('#myTvTitleSeasonSheet'), {
      returnTo: () => portalSheets.open($('#myTvPersonSheet')),
    })
  })
  const seasonHeight = await page.locator('#myTvTitleSeasonSheet > .library-sheet-panel')
    .evaluate(panel => panel.getBoundingClientRect().height)
  expect(Math.abs(personHeight - seasonHeight)).toBeLessThanOrEqual(1)
  expect(personHeight).toBeGreaterThan(650)
  await page.evaluate(() => {
    portalSheets.dismiss($('#myTvTitleSeasonSheet'))
    portalSheets.open($('#myTvPersonSheet'), {
      returnTo: () => portalSheets.open($('#myTvTitleSheet')),
    })
  })

  await personBack.click()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await expect(person).toBeHidden()

  await page.evaluate(() => {
    const title = $('#myTvTitleSheet')
    portalSheets.suspend(title, { card: true })
    portalSheets.open($('#myTvPersonSheet'), { returnTo: () => portalSheets.open(title) })
    portalSheets.suspend($('#myTvPersonSheet'), { card: true })
    portalSheets.open($('#myTvTitleSeasonSheet'), {
      returnTo: () => portalSheets.open($('#myTvPersonSheet'), {
        returnTo: () => portalSheets.open(title),
      }),
    })
  })
  const season = page.locator('#myTvTitleSeasonSheet')
  await season.locator(':scope > .library-sheet-panel .portal-card-back').click()
  await expect(person).toBeVisible()
  await person.locator(':scope > .library-sheet-panel .portal-card-back').click()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()

  await page.evaluate(() => {
    const title = $('#myTvTitleSheet')
    portalSheets.suspend(title, { card: true })
    portalSheets.open($('#myTvPersonSheet'), { returnTo: () => portalSheets.open(title) })
  })
  await page.locator('#myTvPersonClose').click()
  await expect(person).toBeHidden()
  await expect(page.locator('#myTvTitleSheet')).toBeHidden()
  await expect.poll(() => page.evaluate(() =>
    history.state?.mabelCardJourney?.depth || 0)).toBe(0)

  await page.evaluate(() => portalSheets.open($('#myTvCollectionSheet')))
  const utilityClose = await page.locator('#myTvCollectionSheet').evaluate(sheet => {
    const panel = sheet.querySelector('.library-sheet-panel').getBoundingClientRect()
    const close = sheet.querySelector('.portal-sheet-close').getBoundingClientRect()
    return {
      width: close.width,
      height: close.height,
      top: close.top - panel.top,
      right: panel.right - close.right,
    }
  })
  expect(utilityClose).toEqual({
    width: geometry.closeWidth,
    height: geometry.closeHeight,
    top: geometry.closeTop,
    right: geometry.closeRight,
  })
  await page.evaluate(() => portalSheets.dismiss($('#myTvCollectionSheet')))

  await page.evaluate(() => portalSheets.open($('#watchProgrammeSheet')))
  const programmeMenu = page.locator('#watchProgrammeSheet')
  const programmeGeometry = await programmeMenu.evaluate(sheet => {
    const panel = sheet.querySelector('article').getBoundingClientRect()
    const close = sheet.querySelector('.portal-sheet-close').getBoundingClientRect()
    return {
      isCard: sheet.hasAttribute('data-card-sheet'),
      height: panel.height,
      closeTop: close.top - panel.top,
      closeRight: panel.right - close.right,
    }
  })
  expect(programmeGeometry.isCard).toBe(false)
  expect(programmeGeometry.height).toBeLessThan(personHeight)
  expect(programmeGeometry.closeTop).toBeCloseTo(geometry.closeTop, 0)
  expect(programmeGeometry.closeRight).toBeCloseTo(geometry.closeRight, 0)
  await page.evaluate(() => portalSheets.dismiss($('#watchProgrammeSheet')))

  await page.evaluate(() => portalSheets.open($('#myTvFilmSheet')))
  const filmSettings = page.locator('#myTvFilmSheet')
  await expect(filmSettings.locator('.watch-film-poster')).toBeHidden()
  await expect(filmSettings.locator('.watch-film-overview')).toBeHidden()
  const settingsGeometry = await filmSettings.evaluate(sheet => {
    const panel = sheet.querySelector('.watch-film-panel').getBoundingClientRect()
    const close = sheet.querySelector('.portal-sheet-close').getBoundingClientRect()
    return {
      height: panel.height,
      closeTop: close.top - panel.top,
      closeRight: panel.right - close.right,
    }
  })
  expect(settingsGeometry.height).toBeLessThan(personHeight - 20)
  expect(settingsGeometry.closeTop).toBeCloseTo(geometry.closeTop, 0)
  expect(settingsGeometry.closeRight).toBeCloseTo(geometry.closeRight, 0)
  const downloadSpacing = await filmSettings.evaluate(sheet => {
    const download = sheet.querySelector('#myTvFilmDownload').getBoundingClientRect()
    const divider = sheet.querySelector('.watch-film-summary').getBoundingClientRect()
    return divider.bottom - download.bottom
  })
  expect(downloadSpacing).toBeGreaterThanOrEqual(10)
  await expect(filmSettings.locator('.watch-film-panel')).toHaveScreenshot('film-settings-menu.png')
})

test('native browser history returns through the full card journey', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(() => {
    const title = $('#myTvTitleSheet')
    $('#myTvTitleName').textContent = 'Previous film'
    portalSheets.open(title)
    portalSheets.suspend(title, { card: true })
    portalSheets.open($('#myTvPersonSheet'), { returnTo: () => portalSheets.open(title) })
  })

  const person = page.locator('#myTvPersonSheet')
  await expect(person.locator('.portal-card-swipe-underlay')).toContainText('Previous film')
  await expect(person.locator('.portal-card-swipe-edge')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() =>
    history.state?.mabelCardJourney?.depth || 0)).toBe(2)

  await page.goBack()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await expect(person).toBeHidden()
  await expect.poll(() => page.evaluate(() =>
    history.state?.mabelCardJourney?.depth || 0)).toBe(1)

  await page.goBack()
  await expect(page.locator('#myTvTitleSheet')).toBeHidden()
  await expect.poll(() => page.evaluate(() =>
    history.state?.mabelCardJourney?.depth || 0)).toBe(0)

  await page.goForward()
  await expect(page.locator('#myTvTitleSheet')).toBeVisible()
  await expect(page.locator('#myTvTitleName')).toHaveText('Previous film')
})

test('title credits lead with directors or creators and actor cards use two rows', async ({ page }, testInfo) => {
  await openPortal(page)
  await page.evaluate(() => {
    portalSheets.open($('#myTvTitleSheet'))
    renderMyTvTitleEnrichment({
      media_type: 'movie', title: 'Finding Nemo', collection: null,
      creative_leads: [{ tmdb_id: 3, name: 'Andrew Stanton', role: 'Director',
        profile_path: 'bright.svg' }],
      cast: Array.from({ length: 6 }, (_, index) => ({
        tmdb_id: 20 + index, name: `Cast ${index + 1}`, character: `Role ${index + 1}`,
        profile_path: index % 2 ? 'dark.svg' : 'bright.svg',
      })),
    }, 'myTvTitle', () => {}, () => {})
  })
  const creditRail = page.locator('#myTvTitleCastRail')
  await expect(creditRail.locator('.my-tv-credit-group-label')).toHaveText(['Director', 'Cast'])
  await expect(creditRail.locator('.my-tv-credit-divider')).toHaveCount(1)
  await creditRail.screenshot({ path: testInfo.outputPath('director-cast-rail.png') })

  await page.evaluate(() => {
    renderMyTvTitleEnrichment({
      media_type: 'tv', title: 'Fixture series', collection: null,
      creative_leads: [{ tmdb_id: 8, name: 'Example Creator', role: 'Creator' }],
      cast: [{ tmdb_id: 9, name: 'Example Actor', character: 'Lead' }],
    }, 'myTvTitle', () => {}, () => {})
  })
  await expect(creditRail.locator('.my-tv-credit-group-label')).toHaveText(['Creator', 'Cast'])

  await page.evaluate(() => {
    portalSheets.dismiss($('#myTvTitleSheet'))
    const knownFor = Array.from({ length: 15 }, (_, index) => ({
      key: `movie:${index + 1}`, media_type: 'movie', tmdb_id: index + 1,
      title: `Film ${index + 1}`, year: String(2000 + index),
      poster_path: index % 2 ? 'dark.svg' : 'bright.svg', character: `Role ${index + 1}`,
    }))
    renderMyTvPersonDetail({
      tmdb_id: 1, name: 'Example Actor', known_for_department: 'Acting',
      biography: 'A concise biography.', birthday: '1970-01-01',
      place_of_birth: 'London, England', known_for: knownFor,
    })
    portalSheets.open($('#myTvPersonSheet'))
  })
  const knownFor = page.locator('#myTvPersonCredits')
  await expect(knownFor.locator('.my-tv-person-credit-page')).toHaveCount(1)
  await expect(knownFor.locator('.my-tv-person-credit-page').first()
    .locator('.my-tv-franchise-card')).toHaveCount(10)
  const rows = await knownFor.locator('.my-tv-person-credit-page').first()
    .locator('.my-tv-franchise-card').evaluateAll(cards =>
      new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size)
  expect(rows).toBe(2)
  await page.locator('#myTvPersonKnownFor').screenshot({
    path: testInfo.outputPath('actor-known-for-two-rows.png'),
  })
})
