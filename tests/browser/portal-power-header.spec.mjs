import { test, expect } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

const liveState = {
  available: false, standby: false, adult_mode: false, paused: false, muted: false,
  volume: 42, remote_locked: false, subtitles_available: true,
  subtitles_visible: false, widescreen_available: true, widescreen_enabled: false,
  adult_handoff_available: false, connected_tv_available: true,
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
