import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })


async function openLightPortal(page) {
  await page.route('**/api/adult/tmdb-artwork/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#b5d9d3"/><stop offset="1" stop-color="#537a86"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="210" cy="110" r="76" fill="rgba(255,255,255,.2)"/><path d="M0 360L300 180v270H0z" fill="rgba(0,0,0,.24)"/></svg>',
  }))
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


test('@visual light Home and Watch use the dark design language on neutral surfaces', async ({ page }, testInfo) => {
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
  const activeTab = page.locator('#view-watch .watch-tabs button.active')
  await expect(activeTab).toHaveCSS('box-shadow', 'none')
  await expect(activeTab).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page).toHaveScreenshot('light-watch-mabeltv.png')

  await page.locator('[data-view-button="adult-home"]').click()
  await expect(page.locator('#view-adult-home')).toBeVisible()
  await expect(page).toHaveScreenshot('light-watch-adult.png')

  await page.locator('#adultHomeDownloadsTab').click()
  await expect(page.locator('#watchDownloadsLayout')).toBeVisible()
  await expect(page).toHaveScreenshot('light-watch-downloads.png')
})


test('light programme sheet keeps its global close icon visible', async ({ page }, testInfo) => {
  phoneOnly(testInfo)
  await openLightPortal(page)

  await page.locator('#homeContinueRail .watch-continue-card').first().click()
  const programmeClose = page.getByRole('button', { name: 'Close programme details' })
  await expect(programmeClose).toBeVisible()
  const closeColour = await programmeClose.evaluate(element => getComputedStyle(element).color)
  expect(closeColour).not.toBe('rgb(255, 255, 255)')
})


test('@visual USB browser keeps compact controls and reviews the real transfer', async ({ page }, testInfo) => {
  phoneOnly(testInfo)
  await openLightPortal(page)
  await page.locator('[data-view-button="system"]').click()
  await page.locator('#view-system [data-go="usb"]').click()
  await expect(page.locator('#usbDriveList')).toContainText('No USB drive found')
  await page.evaluate(() => {
    usbState = { volumes: [{
      id: 'FAMILY-USB', device: '/dev/sda1', label: 'Family Videos',
      filesystem: 'ntfs', size: 2_000_000_000_000, free: 800_000_000_000,
      mounted: true, sleeping: false,
    }], imports: [] }
    usbVolume = 'FAMILY-USB'
    usbPath = 'Films'
    usbEntries = [
      { name: 'X-Men', path: 'Films/X-Men', type: 'folder' },
      { name: 'Finding Nemo.mp4', path: 'Films/Finding Nemo.mp4', type: 'video', size: 734_000_000, browser_ready: true },
    ]
    library.adult_series = [{
      id: 'b'.repeat(32), title: 'Silicon Valley', stored_title: 'Silicon Valley',
      seasons: [1, 7], episodes: [], season_count: 2, episode_count: 0,
    }]
    renderUsbSeriesDestinations()
    renderUsbDrives()
    renderUsbFiles()
    const originalApi = api
    api = async (path, options = {}) => {
      if (path === '/api/usb' && JSON.parse(options.body || '{}').action === 'plan') {
        const payload = JSON.parse(options.body)
        const destination = payload.target === 'series'
          ? `Adult TV series · Silicon Valley · Series ${payload.season}`
          : payload.target === 'channel' ? 'CH 1 — CBeebies'
            : 'Adult TV films · All films (no collection)'
        return {
          files_total: 3, bytes_total: 1_468_000_000, free_bytes: 800_000_000_000,
          enough_space: true, destination_label: destination, rename_count: 1,
          renames: [{ from: 'Finding Nemo.mp4', to: 'Finding Nemo (2).mp4' }],
          truncated_renames: false,
        }
      }
      return originalApi(path, options)
    }
  })
  const folderToggle = page.getByRole('button', { name: 'Select X-Men for copying' })
  const videoToggle = page.getByRole('button', { name: 'Select Finding Nemo.mp4 for copying' })
  for (const control of [folderToggle, videoToggle]) {
    const box = await control.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(37.9)
    expect(box.width).toBeLessThan(40)
    expect(box.height).toBeGreaterThanOrEqual(37.9)
    expect(box.height).toBeLessThan(40)
  }
  await folderToggle.click()
  await expect(page).toHaveScreenshot('light-usb-connected.png')
  await page.getByRole('button', { name: 'Review copy' }).click()
  await expect(page.locator('#usbImportSheet')).toBeVisible()
  await expect(page.locator('#usbPlanFiles')).toHaveText('3')
  await expect(page.locator('#usbRenameSummary')).toContainText('Finding Nemo (2).mp4')
  await expect(page.locator('#confirmUsbImport')).toBeEnabled()
  await expect(page.locator('#usbAdultFolderLabel')).toBeVisible()
  await expect(page.locator('#usbAdultFolder')).toContainText('All films — no collection')
  await expect(page.locator('#usbSeriesLabel')).toBeHidden()
  await expect(page.locator('#usbSeasonLabel')).toBeHidden()
  await expect(page.locator('#usbChannelLabel')).toBeHidden()
  await expect(page).toHaveScreenshot('light-usb-transfer-destination.png')
  await page.locator('#usbTarget').selectOption('series')
  await expect(page.locator('#usbAdultFolderLabel')).toBeHidden()
  await expect(page.locator('#usbSeriesLabel')).toBeVisible()
  await expect(page.locator('#usbSeasonLabel')).toBeVisible()
  await expect(page.locator('#usbChannelLabel')).toBeHidden()
  await expect(page.locator('#usbSeries')).toHaveValue('b'.repeat(32))
  await expect(page.locator('#usbSeries')).toContainText('Silicon Valley')
  await page.locator('#usbSeason').selectOption('7')
  await expect(page.locator('#usbPlanStatus')).toContainText('Silicon Valley · Series 7')
  await expect(page).toHaveScreenshot('light-usb-transfer-series.png')
  await page.locator('#usbTarget').selectOption('channel')
  await expect(page.locator('#usbAdultFolderLabel')).toBeHidden()
  await expect(page.locator('#usbSeriesLabel')).toBeHidden()
  await expect(page.locator('#usbSeasonLabel')).toBeHidden()
  await expect(page.locator('#usbChannelLabel')).toBeVisible()
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBe(widths.client)
  await page.locator('#closeUsbImport').click()
  await page.evaluate(async () => {
    openView('activity')
    await new Promise(resolve => setTimeout(resolve, 100))
    renderActivity({
      active: true, temperature_warning: false, uploads: [{
        id: 'a'.repeat(32), file_name: 'Finding Nemo.mp4', source_kind: 'usb',
        source_label: 'Family Videos', channel_name: 'Adult TV · All films', size: 100,
        offset: 35, status: 'uploading', transfer_state: 'active',
        source_available: true, cancelable: true,
      }], optimisations: [],
    })
  })
  await expect(page.locator('#activityUploadList')).toContainText('Copying from Family Videos')
  await expect(page.locator('#activityUploadList')).toContainText('Family Videos → Adult TV · All films')
  await expect(page.getByRole('button', { name: 'Cancel transfer' })).toBeVisible()
})


test('Adult management reloads keep the exact list position', async ({ page }, testInfo) => {
  phoneOnly(testInfo)
  await openLightPortal(page)
  await page.evaluate(() => {
    const fixture = structuredClone(library)
    fixture.adult_library = Array.from({ length: 80 }, (_, index) => ({
      path: `Film ${String(index).padStart(2, '0')}.mp4`,
      display_name: `Film ${String(index).padStart(2, '0')}`,
      size: 500_000_000, folder: '', playback_state: 'original', metadata: {},
    }))
    library = fixture
    renderAdultLibrary()
    openView('adult')
    const originalApi = api
    api = async (path, options = {}) => {
      if (path === '/api/manage') return { ok: true, message: 'Renamed' }
      if (path === '/api/library') return structuredClone(fixture)
      return originalApi(path, options)
    }
  })
  await page.evaluate(() => setPortalScrollTop(document.documentElement.scrollHeight))
  const before = await page.evaluate(() => portalScrollTop())
  expect(before).toBeGreaterThan(1000)
  await page.evaluate(() => manage('rename-adult', {
    file: 'Film 79.mp4', name: 'X-Men 79',
  }))
  await page.waitForTimeout(80)
  const afterRename = await page.evaluate(() => portalScrollTop())
  expect(Math.abs(afterRename - before)).toBeLessThan(6)
  await page.evaluate(() => reloadLibraryWithoutLosingPlace())
  await page.waitForTimeout(80)
  const afterMetadata = await page.evaluate(() => portalScrollTop())
  expect(Math.abs(afterMetadata - before)).toBeLessThan(6)
})


test('@visual light remote pages keep one cohesive dark control surface', async ({ page }, testInfo) => {
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


test('@visual light utility, Settings and insight routes stay neutral and legible', async ({ page }, testInfo) => {
  phoneOnly(testInfo)
  await openLightPortal(page)

  await page.locator('[data-view-button="system"]').click()
  await page.locator('#view-system [data-go="usb"]').click()
  await expect(page.locator('#view-usb')).toBeVisible()
  await expect(page).toHaveScreenshot('light-usb.png')

  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-system')).toBeVisible()
  const settingsOrder = await page.locator('#tvSettingsForm').evaluate(form =>
    [...form.children].slice(0, 2).map(element => element.className))
  expect(settingsOrder[0]).toContain('settings-appearance-row')
  expect(settingsOrder[1]).toContain('settings-disclosure')
  await expect(page.locator('[data-portal-design]')).toHaveCount(0)
  await page.waitForTimeout(250)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page).toHaveScreenshot('light-settings.png')

  await page.locator('[data-view-button="adult-home"]').click()
  await page.locator('#adultHomeInsightsTab').click()
  await expect(page.locator('#adultInsightsDashboard')).toBeVisible()
  await expect(page).toHaveScreenshot('light-my-insights.png')
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#watchMabelInsightsTab').click()
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


test('@visual portal accent slider recolours and persists the whole Experience', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One engine covers saved accent state')
  await openLightPortal(page)
  await page.locator('[data-view-button="system"]').click()
  await page.locator('[data-go="appearance"]').click()
  const slider = page.locator('#experienceAccentHue')
  const before = await page.locator('.portal-nav button.active').evaluate(element => getComputedStyle(element).color)
  await slider.fill('255')
  await expect(page.locator('#experienceAccentName')).toHaveText('Blue')
  const after = await page.locator('.portal-nav button.active').evaluate(element => getComputedStyle(element).color)
  expect(after).not.toBe(before)
  expect(await page.evaluate(() => localStorage.getItem('mabeltv-experience-accent-hue'))).toBe('255')
  await expect(page).toHaveScreenshot('light-settings-blue-accent.png')

  await page.reload()
  await expect(page.locator('#view-appearance')).toBeVisible()
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


test('@visual light Settings stays contained on iPad', async ({ page }, testInfo) => {
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
