import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

const liveState = {
  available: false, standby: false, my_tv_mode: false, paused: false, muted: false,
  volume: 42, remote_locked: false, subtitles_available: true,
  subtitles_visible: false, widescreen_available: true, widescreen_enabled: false,
  my_tv_handoff_available: false, connected_tv_available: true,
  connected_tv_power: 'standby', channel_number: 1,
  channel_name: 'Family Films', programme: 'Snowy Adventure',
}

async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
}

async function installLiveFixture(page, state = liveState, delayLgStatus = 0) {
  await page.evaluate(async ({ state, delay }) => {
    const originalFetch = window.fetch.bind(window)
    window.__liveRequests = 0
    window.fetch = async (input, init) => {
      const url = new URL(String(input), location.href)
      if (url.pathname === '/api/live') {
        window.__liveRequests += 1
        return new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.pathname === '/api/live/control') {
        window.__liveCommand = JSON.parse(String(init?.body || '{}')).command
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.pathname === '/api/lg-tv/status') {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        return new Response(JSON.stringify({
          configured: true, connected: false, power: 'off', muted: false, available_apps: [],
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      return originalFetch(input, init)
    }
    renderLiveTv(state)
  }, { state, delay: delayLgStatus })
}

test('the global power control replaces Home actions but yields to either remote', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone header contract')
  await openPortal(page)
  await installLiveFixture(page)
  await expect(page.locator('#openHeaderMyTvTv')).toHaveCount(0)
  await expect(page.locator('#openPortalPower')).toBeVisible()
  await expect(page.locator('.home-spotlight-actions')).toHaveCount(0)
  await page.locator('#openPortalPower').click()
  await expect(page.locator('#remotePowerSheet')).toBeVisible()
  await page.locator('#cancelRemotePower').click()
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await expect(page.locator('#openPortalPower')).toBeHidden()
  await expect(page.locator('#openRemotePower')).toBeVisible()
  await page.locator('[data-remote-switch="lg-tv"]').first().click()
  await expect(page.locator('#openPortalPower')).toBeHidden()
  await expect(page.locator('#lgCardPower')).toBeVisible()
})

test('LG indicators immediately reuse the Mabel remote status without another live request', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone remote state contract')
  await openPortal(page)
  await installLiveFixture(page, liveState, 250)
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await expect(page.locator('#remoteMabelTvText')).toHaveText('On')
  await expect(page.locator('#remoteConnectedTvText')).toHaveText('Standby')
  const beforeSwitch = await page.evaluate(() => window.__liveRequests)
  await page.locator('[data-remote-switch="lg-tv"]').first().click()
  await expect(page.locator('#lgMabelTvText')).toHaveText('On')
  await expect(page.locator('#lgTvConnectionText')).toHaveText('Standby')
  expect(await page.evaluate(() => window.__liveRequests)).toBe(beforeSwitch)
})

test('power actions use local button feedback without a global status banner', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine owns the feedback contract')
  await openPortal(page)
  await installLiveFixture(page)
  await page.locator('#openPortalPower').click()
  await page.locator('#mabelOnlyRemotePower').click()
  await expect.poll(() => page.evaluate(() => window.__liveCommand)).toBe('turn-off-mabel-only')
  await expect(page.locator('#notice')).toHaveText('')
})

test('both phone remotes fit above the bottom navigation without vertical scrolling', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone remote layout contract')
  await openPortal(page)
  await installLiveFixture(page, { ...liveState, available: true, standby: false })
  await page.getByRole('button', { name: 'Remote', exact: true }).click()

  const layout = async (view, lastControl) => page.evaluate(({ view, lastControl }) => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect()
    const status = rect(`${view} .tv-remote-status-card`)
    const chassis = rect(`${view} .tv-remote-chassis`)
    const transport = rect(`${view} .tv-remote-transport-row`)
    const last = rect(lastControl)
    const nav = rect('#mainNav')
    return {
      upperGap: chassis.top - status.bottom,
      lowerGap: transport.top - chassis.bottom,
      lastBottom: last.bottom,
      navTop: nav.top,
      transportHeight: transport.height,
    }
  }, { view, lastControl })

  const mabel = await layout('#view-live', '#view-live .remote-transport-context')
  expect(mabel.upperGap).toBeCloseTo(12, 0)
  expect(mabel.lowerGap).toBeCloseTo(5, 0)
  expect(mabel.lastBottom).toBeLessThanOrEqual(mabel.navTop)
  const actionHeights = await page.locator('#view-live .remote-transport-context button').evaluateAll(
    buttons => buttons.map(button => button.getBoundingClientRect().height))
  actionHeights.forEach(height => expect(height).toBeCloseTo(mabel.transportHeight, 0))
  await expect(page.locator('#view-live .tv-remote-utility-row button')).toHaveCount(4)
  await expect(page.locator('#view-live .tv-remote-utility-row button').first()).toHaveAttribute('id', 'remoteBack')
  await expect(page.locator('#view-live .tv-remote-utility-row button').last()).toHaveAttribute('id', 'remoteMabelAction')
  await expect(page.locator('#view-live #remoteBack')).toHaveAttribute('data-live-command', 'close-overlay')
  await expect(page.locator('#remoteMyTvHandoff')).toHaveAttribute('data-live-command', 'continue-in-my-tv-mode')
  await page.screenshot({ path: testInfo.outputPath('mabel-remote.png') })

  await page.locator('[data-remote-switch="lg-tv"]').first().click()
  const lg = await layout('#view-lg-tv', '#view-lg-tv .lg-apps-card')
  expect(lg.upperGap).toBeCloseTo(12, 0)
  expect(lg.lowerGap).toBeCloseTo(5, 0)
  expect(lg.lastBottom).toBeLessThanOrEqual(lg.navTop)
  await expect(page.locator('#view-lg-tv [data-lg-action="back"]')).toHaveCount(1)
  await expect(page.locator('#view-lg-tv .tv-remote-utility-row button').first()).toHaveAttribute('data-lg-action', 'back')
  await expect(page.locator('#view-lg-tv .tv-remote-utility-row button').last()).toHaveAttribute('data-lg-action', 'home')
  await expect(page.locator('#view-lg-tv [data-lg-action="info"]')).toHaveCount(0)
  await expect(page.locator('#view-lg-tv #lgTrackpad')).toHaveCount(0)
  await expect(page.locator('#view-lg-tv .lg-apps-card header button')).toHaveCount(0)
  const lgShortcuts = await page.locator('#view-lg-tv .tv-remote-utility-row button').evaluateAll(buttons =>
    buttons.map(button => ({
      direction: getComputedStyle(button).flexDirection,
      iconBottom: button.querySelector('svg').getBoundingClientRect().bottom,
      labelTop: button.querySelector('span').getBoundingClientRect().top,
    })))
  expect(lgShortcuts).toHaveLength(4)
  lgShortcuts.forEach(({ direction, iconBottom, labelTop }) => {
    expect(direction).toBe('column')
    expect(iconBottom).toBeLessThanOrEqual(labelTop)
  })
  await page.screenshot({ path: testInfo.outputPath('lg-remote.png') })
})

test('Mabel TV remote confirms before restarting the programme', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone remote action contract')
  await openPortal(page)
  await installLiveFixture(page, { ...liveState, available: true, standby: false })
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  const restart = page.locator('#view-live [data-live-command="restart-programme"]')
  page.once('dialog', dialog => dialog.dismiss())
  await restart.click()
  expect(await page.evaluate(() => window.__liveCommand)).toBeUndefined()
  page.once('dialog', dialog => dialog.accept())
  await restart.click()
  await expect.poll(() => page.evaluate(() => window.__liveCommand)).toBe('restart-programme')
})

test('fitted remotes do not scroll, but expanded previews and short screens can', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone remote scroll contract')
  await openPortal(page)
  await installLiveFixture(page, { ...liveState, available: true, standby: false })
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  const remoteScroll = view => page.locator(view).evaluate(element => ({
    top: element.scrollTop,
    height: element.clientHeight,
    content: element.scrollHeight,
    documentTop: window.scrollY,
  }))
  await page.locator('#view-live').evaluate(element => { element.scrollTop = 500 })
  expect((await remoteScroll('#view-live')).top).toBe(0)
  expect((await remoteScroll('#view-live')).documentTop).toBe(0)
  const preview = page.locator('#toggleLivePreview')
  await preview.click()
  await expect(preview).toHaveAttribute('aria-expanded', 'true')
  await page.locator('#view-live').evaluate(element => { element.scrollTop = 500 })
  await expect.poll(() => page.locator('#view-live').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await preview.click()
  await expect(preview).toHaveAttribute('aria-expanded', 'false')
  expect((await remoteScroll('#view-live')).top).toBe(0)
  await page.locator('[data-remote-switch="lg-tv"]').first().click()
  await page.locator('#view-lg-tv').evaluate(element => { element.scrollTop = 500 })
  expect((await remoteScroll('#view-lg-tv')).top).toBe(0)
  expect((await remoteScroll('#view-lg-tv')).documentTop).toBe(0)

  await page.setViewportSize({ width: 393, height: 600 })
  const shortLg = await remoteScroll('#view-lg-tv')
  expect(shortLg.content).toBeGreaterThan(shortLg.height)
  await page.locator('#view-lg-tv').evaluate(element => { element.scrollTop = 500 })
  expect((await remoteScroll('#view-lg-tv')).top).toBeGreaterThan(0)
  await page.locator('[data-remote-switch="live"]').first().click()
  const shortMabel = await remoteScroll('#view-live')
  expect(shortMabel.content).toBeGreaterThan(shortMabel.height)
  await page.locator('#view-live').evaluate(element => { element.scrollTop = 500 })
  expect((await remoteScroll('#view-live')).top).toBeGreaterThan(0)
})
