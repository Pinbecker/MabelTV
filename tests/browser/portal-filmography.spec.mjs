import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

test('full filmography provides a four-wide timeline, search and A-Z mode', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine owns this visual contract')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    history.replaceState({ staleRoute: true }, '', '#insights')
    openView('insights')
  })
  await page.locator('[data-view-button="watch"]').click()
  await expect(page).toHaveURL(/#watch$/)
  await page.evaluate(() => {
    const filmography = Array.from({ length: 13 }, (_, index) => ({
      key: `movie:${index + 1}`, media_type: 'movie', tmdb_id: index + 1,
      title: index === 0 ? 'The Prestige' : index === 1 ? 'Alfie' : `Film ${index + 1}`,
      year: index === 12 ? '' : String(2024 - Math.floor(index / 5)),
      release_date: index === 12 ? '' : `${2024 - Math.floor(index / 5)}-01-01`,
      poster_path: index % 2 ? 'dark.svg' : 'bright.svg', character: 'Actor',
    }))
    renderAdultPersonDetail({
      tmdb_id: 1, name: 'Michael Caine', known_for_department: 'Acting',
      profile_path: 'bright.svg', biography: 'An actor.', known_for: filmography.slice(0, 10),
      filmography,
    })
    portalSheets.open($('#adultPersonSheet'))
  })

  await page.locator('#adultPersonFilmography').click()
  await expect(page.locator('#view-adult-filmography')).toBeVisible()
  await expect(page.locator('#adultFilmographyName')).toHaveText('Michael Caine')
  await expect(page.locator('#adultFilmographyTimeline .adult-explore-card')).toHaveCount(13)
  await expect(page.locator('#adultFilmographyTimeline .adult-filmography-year h2').first()).toHaveText('2024')
  const firstRow = await page.locator('#adultFilmographyTimeline .adult-explore-card').evaluateAll(cards =>
    cards.filter(card => Math.round(card.getBoundingClientRect().top)
      === Math.round(cards[0].getBoundingClientRect().top)).length)
  expect(firstRow).toBe(4)
  const topGeometry = await page.locator('.adult-filmography-head').evaluate(head => {
    const back = head.querySelector('.view-back').getBoundingClientRect()
    const person = head.querySelector('.adult-filmography-person').getBoundingClientRect()
    const search = document.querySelector('#adultFilmographySearch').closest('.portal-search').getBoundingClientRect()
    const mode = document.querySelector('#adultFilmographyMode').closest('.adult-viewing-select').getBoundingClientRect()
    return {
      backLeft: back.left,
      personLeft: person.left,
      personGap: person.top - back.bottom,
      searchHeight: search.height,
      modeHeight: mode.height,
    }
  })
  expect(Math.abs(topGeometry.backLeft - topGeometry.personLeft)).toBeLessThanOrEqual(1)
  expect(topGeometry.personGap).toBeLessThanOrEqual(6)
  expect(Math.abs(topGeometry.modeHeight - topGeometry.searchHeight)).toBeLessThanOrEqual(1)
  expect(topGeometry.searchHeight).toBeLessThanOrEqual(36)
  await expect(page.locator('#adultFilmographyMeta')).toContainText('Screen credits')
  await expect(page.locator('#adultFilmographyMeta')).toContainText('From 2022')
  await expect(page.locator('#adultFilmographyMeta')).toContainText('Titles')
  await expect(page.locator('#adultFilmographyMeta')).toContainText('13')
  await expect(page.locator('#adultFilmographyMeta')).toContainText('Films')
  await expect(page.locator('#adultFilmographyTimeline .adult-explore-role').first())
    .toHaveText('Actor')

  await page.locator('#adultFilmographySearch').fill('Prestige')
  await expect(page.locator('#adultFilmographyTimeline .adult-explore-card')).toHaveCount(1)
  await expect(page.locator('#adultFilmographyTimeline .adult-explore-open-copy strong'))
    .toHaveText('The Prestige')
  await page.locator('#adultFilmographySearchClear').click()
  await page.locator('#adultFilmographyMode').selectOption('az')
  await expect(page.locator('#adultFilmographyTimeline .adult-filmography-year h2').first()).toHaveText('A')
  await expect(page.locator('#adultFilmographyTimeline .adult-filmography-year h2')).toContainText(['A', 'F', 'P'])
  await page.screenshot({ path: testInfo.outputPath('actor-filmography-az.png'), animations: 'disabled' })

  const started = Date.now()
  await page.goBack({ waitUntil: 'commit' })
  await expect(page.locator('#adultPersonSheet')).toBeVisible()
  expect(Date.now() - started).toBeLessThan(1000)
  await expect(page.locator('#view-watch')).toBeVisible()
  await expect(page.locator('#view-insights')).toBeHidden()
  await expect(page).toHaveURL(/#watch$/)
  await page.goBack({ waitUntil: 'commit' })
  await expect(page.locator('#adultPersonSheet')).toBeHidden()
  await expect(page.locator('#view-watch')).toBeVisible()
  await expect(page.locator('#view-insights')).toBeHidden()
  await expect(page).toHaveURL(/#watch$/)
})
