import { test, expect } from './test-fixtures.mjs'

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

test('MabelTV device player keeps taps and Back above the inline video layer', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone player interaction contract')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    document.body.style.minHeight = '300vh'
    window.scrollTo(0, 900)
    $('#mabelWatchPlayer').classList.remove('hidden', 'controls-visible')
    lockPortalPlayerScroll(false)
  })

  await expect(page.locator('body')).not.toHaveClass(/portal-player-fixed/)
  expect(await page.evaluate(() => document.body.style.top)).toBe('')
  await expect(page.locator('#mabelWatchVideo')).toHaveCSS('pointer-events', 'none')
  const screen = await page.locator('#mabelWatchScreen').boundingBox()
  await page.mouse.click(screen.x + screen.width / 2, screen.y + screen.height / 2)
  await expect(page.locator('#mabelWatchPlayer')).toHaveClass(/controls-visible/)

  const backReceivesTap = await page.locator('#mabelWatchBack').evaluate(button => {
    const box = button.getBoundingClientRect()
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('button') === button
  })
  expect(backReceivesTap).toBe(true)
  await page.locator('#mabelWatchBack').click()
  await expect(page.locator('#mabelWatchPlayer')).toBeHidden()
})

test('MabelTV film playback closes its native dialog and restores it after Back', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone player interaction contract')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    library.remote_viewing = { allow_simultaneous: true, tv_running: false }
    const channel = library.channels.find(value => value.content_type === 'films')
    const programme = channel.programmes[0]
    programme.remote_position = 0
    openWatchProgrammeSheet(channel, programme)
    window.api = async path => {
      if (path === '/api/remote/start') return new Promise(() => {})
      return {}
    }
  })

  await expect(page.locator('#watchProgrammeSheet')).toHaveJSProperty('open', true)
  await page.locator('#watchProgrammeHere').click()
  await expect(page.locator('#mabelWatchPlayer')).toBeVisible()
  await expect(page.locator('#watchProgrammeSheet')).not.toHaveJSProperty('open', true)
  expect(await page.locator('dialog[open]').count()).toBe(0)

  await page.locator('#mabelWatchBack').click()
  await expect(page.locator('#mabelWatchPlayer')).toBeHidden()
  await expect(page.locator('#watchProgrammeSheet')).toHaveJSProperty('open', true)
})
