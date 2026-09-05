import { test, expect } from '@playwright/test'


async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nothing playing' })).toBeVisible()
  await page.evaluate(() => document.fonts?.ready)
}


async function geometry(page, selector) {
  return page.locator(selector).evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      position: style.position,
      display: style.display,
    }
  })
}


async function expectInsideViewport(page, selector) {
  const result = await page.locator(selector).evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return {
      left: bounds.left,
      right: bounds.right,
      viewport: document.documentElement.clientWidth,
    }
  })
  expect(result.left).toBeGreaterThanOrEqual(-1)
  expect(result.right).toBeLessThanOrEqual(result.viewport + 1)
}


test('phone shell keeps the frozen header, rail, gutters and Continue layout', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone contract')
  await openPortal(page)

  const pageSize = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(pageSize.viewportWidth).toBe(393)
  expect(pageSize.viewportHeight).toBe(852)
  expect(pageSize.scrollWidth).toBe(pageSize.clientWidth)

  const head = await geometry(page, '.mobile-head')
  const rail = await geometry(page, '.rail')
  const library = await geometry(page, '.home-library')
  const continuing = await geometry(page, '#homeContinueSection')
  expect(head.position).toBe('fixed')
  expect(head.y).toBeCloseTo(0, 0)
  expect(head.height).toBeCloseTo(54, 0)
  expect(rail.position).toBe('fixed')
  expect(rail.y + rail.height).toBeCloseTo(852, 0)
  expect(rail.height).toBeCloseTo(72, 0)
  expect(library.x).toBeCloseTo(18, 0)
  expect(library.width).toBeCloseTo(pageSize.clientWidth - 36, 0)
  expect(continuing.x).toBeCloseTo(18, 0)
  expect(continuing.width).toBeCloseTo(pageSize.clientWidth - 36, 0)
  expect(continuing.height).toBeGreaterThanOrEqual(180)
  expect(continuing.height).toBeLessThanOrEqual(183)
  await expect(page.locator('#homeContinueRail .watch-continue-card')).toHaveCount(8)
})


test('primary screens stay full-width and match their visual references', async ({ page }) => {
  await openPortal(page)
  const screens = [
    { button: 'Home', selector: '#view-overview', snapshot: 'home.png' },
    { button: 'Watch', selector: '#view-watch', snapshot: 'watch.png' },
    { button: 'Remote', selector: '#view-live', snapshot: 'remote.png' },
    { button: 'Settings', selector: '#view-system', snapshot: 'settings.png' },
  ]

  for (const screen of screens) {
    await page.getByRole('button', { name: screen.button, exact: true }).click()
    await expect(page.locator(screen.selector)).toBeVisible()
    await expectInsideViewport(page, screen.selector)
    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(widths.scroll).toBe(widths.client)
    await expect(page).toHaveScreenshot(screen.snapshot, { fullPage: false })
  }
})


test('iPad Remote view has no page-level horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad-webkit', 'iPad contract')
  await openPortal(page)
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBe(widths.client)
})


test('representative film and remote menus fit the phone viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone overlay contract')
  await openPortal(page)

  await page.locator('#homeContinueRail .watch-continue-card').first().click()
  await expect(page.locator('#watchProgrammeSheet')).toBeVisible()
  const filmMenu = page.locator('#watchProgrammeSheet > article')
  await expectInsideViewport(page, '#watchProgrammeSheet > article')
  await expect(filmMenu).toHaveScreenshot('film-menu.png')
  await page.getByRole('button', { name: 'Close programme details' }).click()

  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await page.locator('#openLiveChannels').click()
  await expect(page.locator('#liveChannelSheet')).toBeVisible()
  const channelMenu = page.locator('#liveChannelSheet .remote-sheet-panel')
  await expectInsideViewport(page, '#liveChannelSheet .remote-sheet-panel')
  await expect(channelMenu).toHaveScreenshot('channel-menu.png')
})


test('PIN gate never reveals the application shell before authentication', async ({ page }) => {
  await page.request.get('/__fixture/pin-required?value=1')
  await page.goto('/')
  await expect(page.locator('#login')).toBeVisible()
  await expect(page.locator('.app-shell')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Nothing playing' })).toBeHidden()
  await page.locator('#pin').fill('2468')
  await page.locator('#loginForm button[type="submit"]').click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nothing playing' })).toBeVisible()
  await page.request.get('/__fixture/pin-required?value=0')
})
