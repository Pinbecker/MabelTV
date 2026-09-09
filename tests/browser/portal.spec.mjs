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
  const nowPlayingMarker = await page.locator('.home-now-playing').evaluate(element => ({
    border: parseFloat(getComputedStyle(element).borderLeftWidth),
    padding: parseFloat(getComputedStyle(element).paddingLeft),
  }))
  expect(nowPlayingMarker.border).toBe(2)
  expect(nowPlayingMarker.padding).toBeGreaterThanOrEqual(14)
  await expect(page.locator('#homeContinueRail .watch-continue-card')).toHaveCount(8)
})

test('primary screens stay full-width and match their visual references', async ({ page }) => {
  await openPortal(page)
  const screens = [
    { trigger: '[data-view-button="overview"]', selector: '#view-overview', snapshot: 'home.png' },
    { trigger: '[data-view-button="watch"]', selector: '#view-watch', snapshot: 'watch.png' },
    { trigger: '[data-view-button="live"]', selector: '#view-live', snapshot: 'remote.png' },
    { trigger: '.tv-remote-switcher [data-go="lg-tv"]:visible', selector: '#view-lg-tv', snapshot: 'lg-tv-remote.png' },
    { trigger: '[data-view-button="system"]', selector: '#view-system', snapshot: 'settings.png' },
  ]

  for (const screen of screens) {
    await page.locator(screen.trigger).click()
    await expect(page.locator(screen.selector)).toBeVisible()
    await expectInsideViewport(page, screen.selector)
    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(widths.scroll).toBe(widths.client)
    await expect(page.locator(screen.selector)).toHaveCSS('opacity', '1')
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


test('representative film menu fits the phone viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone overlay contract')
  await openPortal(page)

  await page.locator('#homeContinueRail .watch-continue-card').first().click()
  await expect(page.locator('#watchProgrammeSheet')).toBeVisible()
  const filmMenu = page.locator('#watchProgrammeSheet > article')
  await expectInsideViewport(page, '#watchProgrammeSheet > article')
  await expect(filmMenu).toHaveScreenshot('film-menu.png')
  const localIntents = page.locator('#watchProgrammeViewingActions')
  await expect(localIntents).toBeHidden()
  await page.getByRole('button', { name: 'Close programme details' }).click()
})

test('Home Continue contains MabelTV films only', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(() => {
    library.adult_library = [{
      path: 'adult-progress.mp4', display_name: 'Adult progress', browser_ready: true,
      remote_position: 180, remote_duration: 1800, remote_last_watched: Date.now() / 1000,
      metadata: { title: 'Adult progress' },
    }]
    renderHomeLibrary()
  })
  await expect(page.locator('#homeContinueRail [data-adult-path]')).toHaveCount(0)
  await expect(page.locator('#homeContinueRail .watch-continue-card')).toHaveCount(8)
  await expect(page.locator('#homeContinueRail')).not.toContainText('Adult progress')
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
    const powerIndicator = document.createElement('i')
    const powerLabel = document.createElement('strong')
    const standbyStatus = window.MabelPortalUI.setPowerStatus(
      powerIndicator, powerLabel, 'standby')
    const unavailableStatus = window.MabelPortalUI.powerStatus(
      'unavailable', { sentence: 'status unavailable' })
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
      powerClass: powerIndicator.className,
      powerLabel: powerLabel.textContent,
      standbySentence: standbyStatus.sentence,
      unavailableSentence: unavailableStatus.sentence,
      unlockedOverflow,
      lockedOverflow,
      restoredOverflow,
    }
  })

  expect(contract.searchCount).toBe(5)
  contract.searchStyles.slice(0, 4).forEach(style => expect(style).toMatchObject({
      display: 'grid',
      minHeight: '48px',
      radius: '8px',
    }))
  expect(contract.searchStyles[4]).toMatchObject({
    display: 'grid',
    minHeight: '42px',
    radius: '8px',
  })
  expect(contract.iconClass).toBe('icon')
  expect(contract.iconHref).toBe('/portal/icons.svg#signal-play')
  expect(contract.emptyMarkup).toBe('<strong>Empty title</strong><span>Empty message</span>')
  expect(contract.buttonType).toBe('button')
  expect(contract.buttonHasClass).toBe(false)
  expect(contract.powerClass).toBe('portal-power-status-dot is-standby')
  expect(contract.powerLabel).toBe('Standby')
  expect(contract.standbySentence).toBe('in standby')
  expect(contract.unavailableSentence).toBe('status unavailable')
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

  await expect(page.locator('#mobileActivityStatus')).toHaveCount(0)
  await expect(page.locator('#openLgTvRemote')).toHaveCount(0)
  await expect(page.locator('.mobile-remote-switcher')).toBeHidden()
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await expect(page.locator('.mobile-remote-switcher')).toBeVisible()
  await expect(page.locator('[data-remote-switch="live"]')).toHaveClass(/active/)
  const remoteSwitcher = await geometry(page, '.mobile-remote-switcher')
  expect(remoteSwitcher.width).toBeLessThanOrEqual(180.1)
  expect(remoteSwitcher.height).toBeLessThanOrEqual(40.1)
  await expect(page.locator('#remoteMabelTvText')).toHaveText('Standby')
  await expect(page.locator('#remoteMabelTvLed')).toHaveClass(/is-standby/)
  await expect(page.locator('#remoteConnectedTvText')).toHaveText('Standby')
  await expect(page.locator('#remoteConnectedTvLed')).toHaveClass(/is-standby/)
  const mabelStructure = await page.evaluate(() => {
    const rect = selector => {
      const value = document.querySelector(selector).getBoundingClientRect()
      return { top: value.top, right: value.right, bottom: value.bottom, left: value.left }
    }
    return {
      status: rect('#view-live .tv-remote-status-card'),
      chassis: rect('#view-live .tv-remote-chassis'),
      utility: rect('#view-live .tv-remote-utility-row'),
      transport: rect('#view-live .tv-remote-transport-row'),
    }
  })
  await page.locator('[data-remote-switch="lg-tv"]').click()
  await expect(page.locator('[data-remote-switch="lg-tv"]')).toHaveClass(/active/)
  await expect(page.locator('#lgMabelTvText')).toHaveText('Standby')
  await expect(page.locator('#lgMabelTvLed')).toHaveClass(/is-standby/)
  await expect(page.locator('#lgTvConnectionText')).toHaveText('Standby')
  await expect(page.locator('#lgTvConnectionLed')).toHaveClass(/is-standby/)
  await expect(page.locator('#lgMute')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('#lgMute .tv-remote-volume-on')).toBeVisible()
  await expect(page.locator('#lgMute .tv-remote-volume-off')).toBeHidden()
  await expect(page.locator('#lgMute strong')).toHaveCount(0)
  expect(await page.locator('#lgMabelTvLed').evaluate(node => getComputedStyle(node).backgroundColor))
    .toBe('rgb(255, 90, 110)')
  expect(await page.locator('#lgTvConnectionLed').evaluate(node => getComputedStyle(node).backgroundColor))
    .toBe('rgb(255, 90, 110)')
  const cardPower = await geometry(page, '#lgCardPower')
  const quickRefresh = await geometry(page, '.lg-apps-card header button')
  expect(cardPower.width).toBeGreaterThanOrEqual(43.9)
  expect(cardPower.height).toBeGreaterThanOrEqual(43.9)
  expect(quickRefresh.width).toBeGreaterThanOrEqual(43.9)
  expect(quickRefresh.height).toBeGreaterThanOrEqual(43.9)
  const sharedControls = await page.evaluate(() => {
    const rect = selector => {
      const value = document.querySelector(selector).getBoundingClientRect()
      return { top: value.top, right: value.right, bottom: value.bottom, left: value.left }
    }
    return {
      status: rect('#view-lg-tv .tv-remote-status-card'),
      chassis: rect('#view-lg-tv .tv-remote-chassis'),
      utility: rect('#view-lg-tv .tv-remote-utility-row'),
      transport: rect('#view-lg-tv .tv-remote-transport-row'),
      channel: rect('#view-lg-tv .tv-remote-channel-rocker'),
      dpad: rect('#view-lg-tv .tv-remote-dpad'),
      volume: rect('#view-lg-tv .tv-remote-volume-rocker'),
      back: rect('#view-lg-tv .tv-remote-back'),
    }
  })
  expect(sharedControls.channel.right).toBeLessThan(sharedControls.dpad.left)
  expect(sharedControls.dpad.right).toBeLessThan(sharedControls.volume.left)
  expect(sharedControls.back.top).toBeGreaterThan(sharedControls.dpad.bottom)
  for (const key of ['status', 'chassis', 'utility', 'transport']) {
    expect(sharedControls[key].left).toBeCloseTo(mabelStructure[key].left, 0)
    expect(sharedControls[key].right).toBeCloseTo(mabelStructure[key].right, 0)
    expect(sharedControls[key].bottom - sharedControls[key].top)
      .toBeCloseTo(mabelStructure[key].bottom - mabelStructure[key].top, 0)
  }
  expect(sharedControls.chassis.top - sharedControls.status.bottom)
    .toBeCloseTo(mabelStructure.chassis.top - mabelStructure.status.bottom, 0)

  const stickyClose = await page.evaluate(() => {
    const dialog = document.querySelector('#adultSeasonSheet')
    const panel = dialog.querySelector('.library-sheet-body')
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
  const liveFixture = {
    available: true, standby: false, adult_mode: false, paused: false,
    muted: false, volume: 42, remote_locked: false,
    subtitles_available: false, subtitles_visible: false,
    widescreen_available: true, widescreen_enabled: false,
    adult_handoff_available: true, connected_tv_available: true,
    connected_tv_power: 'on', channel_number: 1,
    channel_name: 'Family Films', programme: 'Snowy Adventure',
  }
  await page.evaluate((fixture) => {
    stopHomeStatusRefresh()
    window.__sentLiveCommands = []
    window.fetch = async (input, init = {}) => {
      if (String(input).includes('/api/live/control')) {
        window.__sentLiveCommands.push(JSON.parse(init.body).command)
        return new Response('{"ok":true}', {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      if (String(input).includes('/api/live')) {
        return new Response(JSON.stringify(fixture), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{"ok":true}', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
  }, liveFixture)
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await page.evaluate((fixture) => renderLiveTv(fixture), liveFixture)
  await expect(page.locator('#view-live .tv-remote-transport-row button')).toHaveCount(4)
  await expect(page.locator('#view-live .remote-transport-context button')).toHaveCount(4)
  await expect(page.locator('#view-live #openLiveChannels')).toHaveCount(0)
  await expect(page.locator('#remoteAdultAction')).toHaveText('Open Adult TV')
  await expect(page.locator('#remoteSubtitles')).toHaveText('Subtitles')
  await expect(page.locator('#remoteAdultHandoff')).toHaveText('Open in Adult TV')
  await expect(page.locator('#remoteWidescreen')).toBeVisible()
  await expect(page.locator('#remoteLock')).toHaveText('')
  await expect(page.locator('#remoteLock')).toHaveAttribute('aria-label', 'Lock kids’ physical remote')
  await expect(page.locator('#remoteMute strong')).toHaveCount(0)
  await expect(page.locator('#remoteMute .tv-remote-volume-on')).toBeVisible()
  await expect(page.locator('#remoteMute .tv-remote-volume-off')).toBeHidden()
  await expect(page.locator('#remoteMabelTvText')).toHaveText('On')
  await expect(page.locator('#remoteConnectedTvText')).toHaveText('On')
  await expect(page.locator('#remotePlay')).toBeDisabled()
  await expect(page.locator('#remotePause')).toBeEnabled()
  const transportAppearance = await page.locator('#view-live .tv-remote-transport-row button').evaluateAll(buttons =>
    buttons.map(button => ({ color: getComputedStyle(button).color, opacity: getComputedStyle(button).opacity })))
  transportAppearance.forEach(style => expect(style).toEqual({ color: 'rgb(244, 244, 247)', opacity: '1' }))
  const shortcutIcon = await geometry(page, '#remoteAdultAction svg')
  expect(shortcutIcon.width).toBeLessThanOrEqual(13.1)
  const mabelControls = await page.evaluate(() => {
    const rect = selector => {
      const value = document.querySelector(selector).getBoundingClientRect()
      return { top: value.top, right: value.right, bottom: value.bottom, left: value.left }
    }
    return {
      channel: rect('#view-live .tv-remote-channel-rocker'),
      dpad: rect('#view-live .tv-remote-dpad'),
      volume: rect('#view-live .tv-remote-volume-rocker'),
      back: rect('#view-live .tv-remote-back'),
    }
  })
  expect(mabelControls.channel.right).toBeLessThan(mabelControls.dpad.left)
  expect(mabelControls.dpad.right).toBeLessThan(mabelControls.volume.left)
  expect(mabelControls.back.top).toBeGreaterThan(mabelControls.dpad.bottom)
  await expect(page).toHaveScreenshot('remote-live-controls.png', { fullPage: false })
  const preview = page.locator('#toggleLivePreview')
  const collapsedWidth = (await preview.boundingBox()).width
  await preview.click()
  await expect(preview).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.mabel-status-card')).toHaveClass(/is-preview-expanded/)
  const expanded = await page.evaluate(() => {
    const card = document.querySelector('.mabel-status-card').getBoundingClientRect()
    const preview = document.querySelector('.mabel-live-visual').getBoundingClientRect()
    const remote = document.querySelector('#view-live .tv-remote-chassis').getBoundingClientRect()
    return { cardBottom: card.bottom, previewWidth: preview.width, remoteTop: remote.top }
  })
  expect(expanded.previewWidth).toBeGreaterThan(collapsedWidth * 2.5)
  expect(expanded.remoteTop).toBeGreaterThan(expanded.cardBottom)
  await expect(page).toHaveScreenshot('remote-preview-expanded.png', { fullPage: false })
  await preview.click()
  await expect(preview).toHaveAttribute('aria-expanded', 'false')
  await page.evaluate((fixture) => renderLiveTv({ ...fixture, muted: true }), liveFixture)
  await expect(page.locator('#remoteMute')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#remoteMute .tv-remote-volume-on')).toBeHidden()
  await expect(page.locator('#remoteMute .tv-remote-volume-off')).toBeVisible()
  const handoff = page.locator('#remoteAdultHandoff')
  await expect(handoff).toBeVisible()
  await expect(handoff).toHaveAttribute(
    'aria-label', 'Continue Snowy Adventure in Adult TV without the television frame')
  await handoff.click()
  await expect.poll(() => page.evaluate(() => window.__sentLiveCommands.at(-1)))
    .toBe('continue-in-adult-mode')
  await page.evaluate((fixture) => renderLiveTv({ ...fixture,
    widescreen_available: false, adult_handoff_available: false }), liveFixture)
  await expect(page.locator('#remoteWidescreen')).toBeVisible()
  await expect(page.locator('#remoteWidescreen')).toBeDisabled()
  await expect(handoff).toBeVisible()
  await expect(handoff).toBeDisabled()
})
