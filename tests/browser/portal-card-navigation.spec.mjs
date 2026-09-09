import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
}

test('content cards share compact Back and journey-closing X controls', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(() => portalSheets.open($('#adultTitleSheet')))
  await expect(page.locator('#adultTitleSheet .portal-card-back')).toBeHidden()

  await page.evaluate(() => {
    const title = $('#adultTitleSheet')
    portalSheets.suspend(title)
    portalSheets.open($('#adultPersonSheet'), { returnTo: () => portalSheets.open(title) })
  })
  const person = page.locator('#adultPersonSheet')
  await expect(person).toBeVisible()
  await expect(person.locator('.portal-card-back')).toBeVisible()
  const geometry = await person.evaluate(sheet => {
    const panel = sheet.querySelector('.library-sheet-panel').getBoundingClientRect()
    const close = sheet.querySelector('.portal-sheet-close').getBoundingClientRect()
    const back = sheet.querySelector('.portal-card-back')
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

  const personHeight = await person.locator('.library-sheet-panel').evaluate(panel =>
    panel.getBoundingClientRect().height)
  await page.evaluate(() => {
    portalSheets.suspend($('#adultPersonSheet'))
    portalSheets.open($('#adultTitleSeasonSheet'), {
      returnTo: () => portalSheets.open($('#adultPersonSheet')),
    })
  })
  const seasonHeight = await page.locator('#adultTitleSeasonSheet .library-sheet-panel')
    .evaluate(panel => panel.getBoundingClientRect().height)
  expect(Math.abs(personHeight - seasonHeight)).toBeLessThanOrEqual(1)
  expect(personHeight).toBeGreaterThan(650)
  await page.evaluate(() => {
    portalSheets.dismiss($('#adultTitleSeasonSheet'))
    portalSheets.open($('#adultPersonSheet'), {
      returnTo: () => portalSheets.open($('#adultTitleSheet')),
    })
  })

  await person.locator('.portal-card-back').click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()
  await expect(person).toBeHidden()

  await page.evaluate(() => {
    const title = $('#adultTitleSheet')
    portalSheets.suspend(title)
    portalSheets.open($('#adultPersonSheet'), { returnTo: () => portalSheets.open(title) })
    portalSheets.suspend($('#adultPersonSheet'))
    portalSheets.open($('#adultTitleSeasonSheet'), {
      returnTo: () => portalSheets.open($('#adultPersonSheet'), {
        returnTo: () => portalSheets.open(title),
      }),
    })
  })
  const season = page.locator('#adultTitleSeasonSheet')
  await season.locator('.portal-card-back').click()
  await expect(person).toBeVisible()
  await person.locator('.portal-card-back').click()
  await expect(page.locator('#adultTitleSheet')).toBeVisible()

  await page.evaluate(() => {
    const title = $('#adultTitleSheet')
    portalSheets.suspend(title)
    portalSheets.open($('#adultPersonSheet'), { returnTo: () => portalSheets.open(title) })
  })
  await page.locator('#adultPersonClose').click()
  await expect(person).toBeHidden()
  await expect(page.locator('#adultTitleSheet')).toBeHidden()

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
