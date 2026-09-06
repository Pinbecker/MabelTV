import { test, expect } from '@playwright/test'


async function openLightPortal(page) {
  await page.addInitScript(() => {
    localStorage.setItem('mabeltv-experience-theme', 'light')
    if (localStorage.getItem('mabeltv-experience-accent-hue') === null) {
      localStorage.setItem('mabeltv-experience-accent-hue', '48')
    }
  })
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-experience-theme', 'light')
  await expect(page.locator('body')).not.toHaveClass(/offline-mode/)
  await page.evaluate(() => document.fonts?.ready)
}


function phoneOnly(testInfo) {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Light phone contract')
}


test('light Home and Watch use the dark design language on neutral surfaces', async ({ page }, testInfo) => {
  phoneOnly(testInfo)
  await openLightPortal(page)

  const homeStyles = await page.evaluate(() => {
    const activeNav = document.querySelector('.portal-nav button.active')
    const emptyArt = document.querySelector('.home-spotlight-art.is-empty')
    const continueTitle = document.querySelector('.watch-continue-copy strong')
    return {
      activeBackground: getComputedStyle(activeNav).backgroundColor,
      emptyBackground: getComputedStyle(emptyArt).backgroundImage,
      continueTitle: getComputedStyle(continueTitle).color,
      nowPlayingPadding: parseFloat(getComputedStyle(document.querySelector('.home-now-playing')).paddingLeft),
    }
  })
  expect(homeStyles.activeBackground).toBe('rgba(0, 0, 0, 0)')
  expect(homeStyles.emptyBackground).not.toContain('rgb(17, 17, 22)')
  expect(homeStyles.continueTitle).toBe('rgb(255, 255, 255)')
  expect(homeStyles.nowPlayingPadding).toBeGreaterThanOrEqual(14)
  await expect(page).toHaveScreenshot('light-home.png')

  await page.locator('[data-view-button="watch"]').click()
  const activeTab = page.locator('.watch-tabs button.active')
  await expect(activeTab).toHaveCSS('box-shadow', 'none')
  await expect(activeTab).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page).toHaveScreenshot('light-watch-mabeltv.png')

  await page.locator('#watchAdultTab').click()
  await expect(page.locator('#watchAdultLayout')).toBeVisible()
  await expect(page).toHaveScreenshot('light-watch-adult.png')

  await page.locator('#watchDownloadsTab').click()
  await expect(page.locator('#watchDownloadsLayout')).toBeVisible()
  await expect(page).toHaveScreenshot('light-watch-downloads.png')
})


test('light remote pages keep one cohesive dark control surface', async ({ page }, testInfo) => {
  phoneOnly(testInfo)
  await openLightPortal(page)
  await page.locator('[data-view-button="live"]').click()
  await expect(page.locator('#view-live')).toBeVisible()

  const mabelColours = await page.evaluate(() => ({
    chassis: getComputedStyle(document.querySelector('#view-live .remote-app')).backgroundColor,
    utility: getComputedStyle(document.querySelector('#view-live .tv-remote-utility-row button')).backgroundColor,
    transport: getComputedStyle(document.querySelector('#view-live .tv-remote-transport-row')).backgroundColor,
  }))
  expect(mabelColours.chassis).not.toBe('rgb(255, 255, 255)')
  expect(mabelColours.utility).not.toBe('rgb(255, 255, 255)')
  expect(mabelColours.transport).not.toBe('rgb(255, 255, 255)')
  await expect(page).toHaveScreenshot('light-remote-mabeltv.png')

  await page.locator('[data-remote-switch="lg-tv"]').click()
  await expect(page.locator('#view-lg-tv')).toBeVisible()
  const lgColours = await page.evaluate(() => ({
    chassis: getComputedStyle(document.querySelector('#view-lg-tv .lg-control-card')).backgroundColor,
    utility: getComputedStyle(document.querySelector('#view-lg-tv .tv-remote-utility-row button')).backgroundColor,
    apps: getComputedStyle(document.querySelector('#view-lg-tv .lg-apps-card')).backgroundColor,
  }))
  expect(lgColours.chassis).not.toBe('rgb(255, 255, 255)')
  expect(lgColours.utility).not.toBe('rgb(255, 255, 255)')
  expect(lgColours.apps).not.toBe('rgb(255, 255, 255)')
  await expect(page).toHaveScreenshot('light-remote-lg-tv.png')
})


test('light utility, Settings and insight routes stay neutral and legible', async ({ page }, testInfo) => {
  phoneOnly(testInfo)
  await openLightPortal(page)

  await page.locator('[data-view-button="usb"]').click()
  await expect(page.locator('#view-usb')).toBeVisible()
  await expect(page).toHaveScreenshot('light-usb.png')

  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-system')).toBeVisible()
  const settingsOrder = await page.locator('#tvSettingsForm').evaluate(form =>
    [...form.children].slice(0, 3).map(element => element.className))
  expect(settingsOrder[0]).toContain('settings-theme-row')
  expect(settingsOrder[1]).toContain('settings-accent-row')
  expect(settingsOrder[2]).toContain('settings-disclosure')
  await expect(page.locator('[data-portal-design]')).toHaveCount(0)
  await expect(page).toHaveScreenshot('light-settings.png')

  await page.locator('[data-go="insights"]').click()
  await expect(page.locator('#view-insights')).toBeVisible()
  const rangeBackground = await page.locator('.insights-page .viewing-range')
    .evaluate(element => getComputedStyle(element).backgroundColor)
  expect(rangeBackground).not.toMatch(/^rgba?\((?:0|1[0-9]|2[0-9]),/)
  await expect(page).toHaveScreenshot('light-insights.png')

  await page.locator('[data-view-button="system"]').click()
  await page.locator('[data-go="activity"]').click()
  await expect(page.locator('#view-activity')).toBeVisible()
  await expect(page).toHaveScreenshot('light-activity.png')
})


test('portal accent slider recolours and persists the whole Experience', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One engine covers saved accent state')
  await openLightPortal(page)
  await page.locator('[data-view-button="system"]').click()
  const slider = page.locator('#experienceAccentHue')
  const before = await page.locator('.portal-nav button.active').evaluate(element => getComputedStyle(element).color)
  await slider.fill('255')
  await expect(page.locator('#experienceAccentName')).toHaveText('Blue')
  const after = await page.locator('.portal-nav button.active').evaluate(element => getComputedStyle(element).color)
  expect(after).not.toBe(before)
  expect(await page.evaluate(() => localStorage.getItem('mabeltv-experience-accent-hue'))).toBe('255')
  await expect(page).toHaveScreenshot('light-settings-blue-accent.png')

  await page.reload()
  await expect(page.locator('#experienceAccentHue')).toHaveValue('255')
  await expect(page.locator('#experienceAccentName')).toHaveText('Blue')
})


test('a stale Classic cookie cannot leave the Experience portal', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One compatibility check is enough')
  await context.addCookies([{
    name: 'mabeltv_portal_design', value: 'classic', domain: '127.0.0.1', path: '/',
  }])
  await openLightPortal(page)
  await expect(page.locator('body.portal-experience')).toBeVisible()
  await expect(page.locator('body.portal-classic')).toHaveCount(0)
})


test('light Settings stays contained on iPad', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad-webkit', 'Light tablet contract')
  await openLightPortal(page)
  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-system')).toBeVisible()
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBe(widths.client)
  await expect(page).toHaveScreenshot('light-settings-ipad.png')
})
