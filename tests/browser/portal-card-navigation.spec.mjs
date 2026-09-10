import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
}

test('content cards share compact Back and journey-closing X controls', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(() => portalSheets.open($('#adultTitleSheet')))
  await expect(page.locator('#adultTitleSheet > .watch-film-panel .portal-card-back')).toBeHidden()

  await page.evaluate(() => {
    const title = $('#adultTitleSheet')
    portalSheets.suspend(title, { card: true })
    portalSheets.open($('#adultPersonSheet'), { returnTo: () => portalSheets.open(title) })
  })
  const person = page.locator('#adultPersonSheet')
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
    portalSheets.suspend($('#adultPersonSheet'), { card: true })
    portalSheets.open($('#adultTitleSeasonSheet'), {
      returnTo: () => portalSheets.open($('#adultPersonSheet')),
    })
  })
  const seasonHeight = await page.locator('#adultTitleSeasonSheet > .library-sheet-panel')
    .evaluate(panel => panel.getBoundingClientRect().height)
  expect(Math.abs(personHeight - seasonHeight)).toBeLessThanOrEqual(1)
  expect(personHeight).toBeGreaterThan(650)
  await page.evaluate(() => {
    portalSheets.dismiss($('#adultTitleSeasonSheet'))
    portalSheets.open($('#adultPersonSheet'), {
      returnTo: () => portalSheets.open($('#adultTitleSheet')),
    })
  })

  await personBack.click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(person).toBeHidden()

  await page.evaluate(() => {
    const title = $('#adultTitleSheet')
    portalSheets.suspend(title, { card: true })
    portalSheets.open($('#adultPersonSheet'), { returnTo: () => portalSheets.open(title) })
    portalSheets.suspend($('#adultPersonSheet'), { card: true })
    portalSheets.open($('#adultTitleSeasonSheet'), {
      returnTo: () => portalSheets.open($('#adultPersonSheet'), {
        returnTo: () => portalSheets.open(title),
      }),
    })
  })
  const season = page.locator('#adultTitleSeasonSheet')
  await season.locator(':scope > .library-sheet-panel .portal-card-back').click()
  await expect(person).toBeVisible()
  await person.locator(':scope > .library-sheet-panel .portal-card-back').click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()

  await page.evaluate(() => {
    const title = $('#adultTitleSheet')
    portalSheets.suspend(title, { card: true })
    portalSheets.open($('#adultPersonSheet'), { returnTo: () => portalSheets.open(title) })
  })
  await page.locator('#adultPersonClose').click()
  await expect(person).toBeHidden()
  await expect(page.locator('#adultTitleSheet')).toBeHidden()
  await expect.poll(() => page.evaluate(() =>
    history.state?.mabelCardJourney?.depth || 0)).toBe(0)

  await page.evaluate(() => portalSheets.open($('#adultCollectionSheet')))
  const utilityClose = await page.locator('#adultCollectionSheet').evaluate(sheet => {
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
  await page.evaluate(() => portalSheets.dismiss($('#adultCollectionSheet')))

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

  await page.evaluate(() => portalSheets.open($('#adultFilmSheet')))
  const filmSettings = page.locator('#adultFilmSheet')
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
  await expect(filmSettings.locator('.watch-film-panel')).toHaveScreenshot('film-settings-menu.png')
})

test('native browser history returns through the full card journey', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(() => {
    const title = $('#adultTitleSheet')
    $('#adultTitleName').textContent = 'Previous film'
    portalSheets.open(title)
    portalSheets.suspend(title, { card: true })
    portalSheets.open($('#adultPersonSheet'), { returnTo: () => portalSheets.open(title) })
  })

  const person = page.locator('#adultPersonSheet')
  await expect(person.locator('.portal-card-swipe-underlay')).toContainText('Previous film')
  await expect(person.locator('.portal-card-swipe-edge')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() =>
    history.state?.mabelCardJourney?.depth || 0)).toBe(2)

  await page.goBack()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(person).toBeHidden()
  await expect.poll(() => page.evaluate(() =>
    history.state?.mabelCardJourney?.depth || 0)).toBe(1)

  await page.goBack()
  await expect(page.locator('#adultTitleSheet')).toBeHidden()
  await expect.poll(() => page.evaluate(() =>
    history.state?.mabelCardJourney?.depth || 0)).toBe(0)

  await page.goForward()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(page.locator('#adultTitleName')).toHaveText('Previous film')
})

test('title credits lead with directors or creators and actor cards use two rows', async ({ page }, testInfo) => {
  await openPortal(page)
  await page.evaluate(() => {
    portalSheets.open($('#adultTitleSheet'))
    renderAdultTitleEnrichment({
      media_type: 'movie', title: 'Finding Nemo', collection: null,
      creative_leads: [{ tmdb_id: 3, name: 'Andrew Stanton', role: 'Director',
        profile_path: 'bright.svg' }],
      cast: Array.from({ length: 6 }, (_, index) => ({
        tmdb_id: 20 + index, name: `Cast ${index + 1}`, character: `Role ${index + 1}`,
        profile_path: index % 2 ? 'dark.svg' : 'bright.svg',
      })),
    }, 'adultTitle', () => {}, () => {})
  })
  const creditRail = page.locator('#adultTitleCastRail')
  await expect(creditRail.locator('.adult-credit-group-label')).toHaveText(['Director', 'Cast'])
  await expect(creditRail.locator('.adult-credit-divider')).toHaveCount(1)
  await creditRail.screenshot({ path: testInfo.outputPath('director-cast-rail.png') })

  await page.evaluate(() => {
    renderAdultTitleEnrichment({
      media_type: 'tv', title: 'Fixture series', collection: null,
      creative_leads: [{ tmdb_id: 8, name: 'Example Creator', role: 'Creator' }],
      cast: [{ tmdb_id: 9, name: 'Example Actor', character: 'Lead' }],
    }, 'adultTitle', () => {}, () => {})
  })
  await expect(creditRail.locator('.adult-credit-group-label')).toHaveText(['Creator', 'Cast'])

  await page.evaluate(() => {
    portalSheets.dismiss($('#adultTitleSheet'))
    const knownFor = Array.from({ length: 15 }, (_, index) => ({
      key: `movie:${index + 1}`, media_type: 'movie', tmdb_id: index + 1,
      title: `Film ${index + 1}`, year: String(2000 + index),
      poster_path: index % 2 ? 'dark.svg' : 'bright.svg', character: `Role ${index + 1}`,
    }))
    renderAdultPersonDetail({
      tmdb_id: 1, name: 'Example Actor', known_for_department: 'Acting',
      biography: 'A concise biography.', birthday: '1970-01-01',
      place_of_birth: 'London, England', known_for: knownFor,
    })
    portalSheets.open($('#adultPersonSheet'))
  })
  const knownFor = page.locator('#adultPersonCredits')
  await expect(knownFor.locator('.adult-person-credit-page')).toHaveCount(2)
  await expect(knownFor.locator('.adult-person-credit-page').first()
    .locator('.adult-franchise-card')).toHaveCount(10)
  const rows = await knownFor.locator('.adult-person-credit-page').first()
    .locator('.adult-franchise-card').evaluateAll(cards =>
      new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size)
  expect(rows).toBe(2)
  await page.locator('#adultPersonKnownFor').screenshot({
    path: testInfo.outputPath('actor-known-for-two-rows.png'),
  })
})
