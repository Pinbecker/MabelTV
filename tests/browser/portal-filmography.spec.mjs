import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('full filmography provides a four-wide timeline, search and A-Z mode', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine owns this visual contract')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
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
  expect(topGeometry.modeHeight).toBeLessThan(topGeometry.searchHeight)
  expect(topGeometry.modeHeight).toBeLessThanOrEqual(32)

  await page.locator('#adultFilmographySearch').fill('Prestige')
  await expect(page.locator('#adultFilmographyTimeline .adult-explore-card')).toHaveCount(1)
  await expect(page.locator('#adultFilmographyTimeline .adult-explore-open-copy strong'))
    .toHaveText('The Prestige')
  await page.locator('#adultFilmographySearchClear').click()
  await page.locator('#adultFilmographyMode').selectOption('az')
  await expect(page.locator('#adultFilmographyTimeline .adult-filmography-year h2').first()).toHaveText('A')
  await expect(page.locator('#adultFilmographyTimeline .adult-filmography-year h2')).toContainText(['A', 'F', 'P'])
  await page.screenshot({ path: testInfo.outputPath('actor-filmography-az.png'), animations: 'disabled' })
})
