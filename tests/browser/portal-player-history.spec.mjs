import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('inline iOS player Back consumes its history layer and restores the launching card', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    library.adult_library = [{
      path: 'Fixture film.mp4', display_name: 'Fixture film', browser_ready: true,
      metadata: { title: 'Fixture film', year: '2024' },
    }]
    history.replaceState({ consolidatedWatch: true }, '', '#watch')
    openWatchFilmSheet(library.adult_library[0])
    closeWatchFilmSheet(false)
    iosPlayerReturnTo = () => openWatchFilmSheet(library.adult_library[0])
    openIosPlayerHistoryLayer()
    $('#iosWatchPlayer').classList.remove('hidden')
  })
  await expect(page.locator('#watchFilmSheet')).not.toHaveJSProperty('open', true)
  await expect(page.locator('#iosWatchPlayer')).toBeVisible()
  expect(await page.evaluate(() => history.state?.mabelIosPlayer)).toBe(true)
  await page.locator('#iosWatchBack').click()
  await expect(page.locator('#iosWatchPlayer')).toBeHidden()
  await expect(page.locator('#watchFilmSheet')).toBeVisible()
  expect(await page.evaluate(() => history.state?.mabelIosPlayer || false)).toBe(false)
})
