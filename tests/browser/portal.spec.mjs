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
  const localIntents = page.locator('#watchProgrammeViewingActions')
  await expect(localIntents).toBeVisible()
  await expect(localIntents.locator('[data-viewing-action]')).toHaveCount(4)
  const watchlistIntent = localIntents.locator('[data-viewing-action="watchlist"]')
  const wasWatchlisted = await watchlistIntent.getAttribute('aria-pressed') === 'true'
  await watchlistIntent.click()
  await expect(watchlistIntent).toHaveAttribute('aria-pressed', String(!wasWatchlisted))
  await expect(watchlistIntent.locator('strong'))
    .toHaveText(wasWatchlisted ? 'Add to Watchlist' : 'In your Watchlist')
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


test('shared portal component contracts stay canonical', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-webkit', 'One engine is enough for DOM contracts')
  await openPortal(page)

  const contract = await page.evaluate(() => {
    const searches = [...document.querySelectorAll('.portal-search')]
    const searchStyles = searches.map(element => {
      const style = getComputedStyle(element)
      return {
        display: style.display,
        minHeight: style.minHeight,
        radius: style.borderRadius,
      }
    })
    const icon = window.MabelPortalUI.icon('signal-play')
    const empty = window.MabelPortalUI.emptyState({
      className: 'watch-empty',
      title: 'Empty title',
      message: 'Empty message',
      messageTag: 'span',
    })
    const button = window.MabelPortalUI.button({ text: 'Action' })
    const dialog = document.createElement('dialog')
    document.body.append(dialog)
    window.MabelPortalUI.dialogs.open(dialog, { lockScroll: false })
    const unlockedOverflow = document.documentElement.style.overflow
    window.MabelPortalUI.dialogs.dismiss(dialog)
    window.MabelPortalUI.dialogs.open(dialog)
    const lockedOverflow = document.documentElement.style.overflow
    window.MabelPortalUI.dialogs.dismiss(dialog)
    const restoredOverflow = document.documentElement.style.overflow
    dialog.remove()
    return {
      searchCount: searches.length,
      searchStyles,
      iconClass: icon.getAttribute('class'),
      iconHref: icon.querySelector('use')?.getAttribute('href'),
      emptyMarkup: empty.innerHTML,
      buttonType: button.type,
      buttonHasClass: button.hasAttribute('class'),
      unlockedOverflow,
      lockedOverflow,
      restoredOverflow,
    }
  })

  expect(contract.searchCount).toBe(4)
  contract.searchStyles.forEach(style => expect(style).toMatchObject({
      display: 'grid',
      minHeight: '48px',
      radius: '8px',
    }))
  expect(contract.iconClass).toBe('icon')
  expect(contract.iconHref).toBe('/portal/icons.svg#signal-play')
  expect(contract.emptyMarkup).toBe('<strong>Empty title</strong><span>Empty message</span>')
  expect(contract.buttonType).toBe('button')
  expect(contract.buttonHasClass).toBe(false)
  expect(contract.unlockedOverflow).toBe('')
  expect(contract.lockedOverflow).toBe('hidden')
  expect(contract.restoredOverflow).toBe('')
})


test('Experience icon controls and sheet headers keep their mobile contracts', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-webkit', 'Primary installed-PWA contract')
  await openPortal(page)

  const activityRows = page.locator('#settingsActivityGroup + .settings-stack .settings-link-row')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(activityRows).toHaveCount(2)
  const rowRadii = await activityRows.evaluateAll(rows => rows.map(row => getComputedStyle(row).borderRadius))
  expect(rowRadii).toEqual(['0px', '0px'])

  const headerRemote = await geometry(page, '#openLgTvRemote')
  expect(headerRemote.width).toBeGreaterThanOrEqual(43.9)
  expect(headerRemote.height).toBeGreaterThanOrEqual(43.9)
  await page.locator('#openLgTvRemote').click()
  const cardPower = await geometry(page, '#lgCardPower')
  const quickRefresh = await geometry(page, '.lg-apps-card header button')
  expect(cardPower.width).toBeGreaterThanOrEqual(43.9)
  expect(cardPower.height).toBeGreaterThanOrEqual(43.9)
  expect(quickRefresh.width).toBeGreaterThanOrEqual(43.9)
  expect(quickRefresh.height).toBeGreaterThanOrEqual(43.9)

  const stickyClose = await page.evaluate(() => {
    const dialog = document.querySelector('#adultSeasonSheet')
    const panel = dialog.querySelector('.library-sheet-panel')
    const close = dialog.querySelector('.portal-sheet-close')
    dialog.showModal()
    const before = close.getBoundingClientRect().top
    panel.scrollTop = 400
    const after = close.getBoundingClientRect().top
    const icon = close.querySelector('use')?.getAttribute('href')
    dialog.close()
    return { before, after, icon }
  })
  expect(stickyClose.after).toBeCloseTo(stickyClose.before, 0)
  expect(stickyClose.icon).toBe('/portal/icons.svg#signal-x')
})


test('MabelTV remote offers a contextual borderless Adult TV handoff', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone remote contract')
  await openPortal(page)
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await page.evaluate(() => {
    clearInterval(liveRefreshTimer)
    liveRefreshTimer = null
    window.__sentLiveCommands = []
    window.fetch = async (input, init = {}) => {
      if (String(input).includes('/api/live/control')) {
        window.__sentLiveCommands.push(JSON.parse(init.body).command)
        return new Response('{"ok":true}', {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{"ok":true}', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    renderLiveTv({
      available: true, standby: false, adult_mode: false, paused: false,
      muted: false, volume: 42, remote_locked: false,
      subtitles_available: false, subtitles_visible: false,
      widescreen_available: false, widescreen_enabled: false,
      adult_handoff_available: true, connected_tv_available: true,
      connected_tv_power: 'on', channel_number: 1,
      channel_name: 'Family Films', programme: 'Snowy Adventure',
    })
  })
  const handoff = page.locator('#remoteAdultHandoff')
  await expect(handoff).toBeVisible()
  await expect(handoff).toHaveAttribute(
    'aria-label', 'Continue Snowy Adventure in Adult TV without the television frame')
  await handoff.click()
  await expect.poll(() => page.evaluate(() => window.__sentLiveCommands.at(-1)))
    .toBe('continue-in-adult-mode')
})


test('preserved Classic presentation still boots with the shared scripts', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'Compatibility smoke test')
  await context.addCookies([{
    name: 'mabeltv_portal_design',
    value: 'classic',
    domain: '127.0.0.1',
    path: '/',
  }])
  await page.goto('/')
  await expect(page.locator('body.portal-classic')).toBeVisible()
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByRole('button', { name: /Home/ }).first()).toBeVisible()
})
