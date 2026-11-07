import { test, expect } from './test-fixtures.mjs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const destinations = ['settings-mabel', 'settings-my-tv', 'appearance', 'settings-security', 'settings-media', 'settings-help']
test.use({ serviceWorkers: 'block' })

test('interrupted health responses preserve the last valid Pi readings', async ({ page }) => {
  // Keep the displayed clock stable while comparing the retained readings.
  await page.clock.setFixedTime(new Date('2026-11-07T12:00:00Z'))
  await page.goto('/#settings/help')
  const details = page.locator('#systemDetails')
  await expect(details).toContainText('Storage')
  const original = await details.textContent()
  await page.route('**/api/status', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"system":',
  }))
  await page.locator('#checkAgain').click()
  await expect(page.getByText('The Pi response was incomplete. Try again.', { exact: true })).toBeVisible()
  await expect(details).toHaveText(original)
  await page.route('**/api/status', route => route.fulfill({ json: {} }))
  await page.locator('#checkAgain').click()
  await expect(page.getByText('The Pi status response was incomplete. Try again.', { exact: true })).toBeVisible()
  await expect(details).toHaveText(original)
})

test('an empty library snapshot is replaced by the real library on startup', async ({ page }) => {
  await page.goto('/#settings/help')
  await expect(page.locator('#systemDetails')).toContainText('Storage')
  await page.evaluate(async () => {
    const saved = await MabelAppCache.read('library-v1')
    await MabelAppCache.write('library-v1', saved.revision, {})
  })
  let requests = 0
  await page.route('**/api/library', async route => { requests++; await route.continue() })
  await page.reload()
  await expect(page.locator('#view-settings-help')).toBeVisible()
  await expect.poll(() => requests).toBe(1)
  await expect.poll(() => page.evaluate(async () =>
    Boolean((await MabelAppCache.read('library-v1'))?.data?.system?.player))).toBe(true)
  await expect(page.locator('#systemDetails')).not.toContainText('0.0 GB free of 0.0 GB')
})

test('settings surround and icon refinements @visual', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'iphone-chromium', 'Review phone and tablet WebKit')
  await page.addInitScript(() => localStorage.setItem('mabeltv-experience-theme', 'light'))
  await page.goto('/#system')
  await expect(page.locator('#view-system')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: testInfo.outputPath('hub-light.png'), fullPage: true })
  await page.evaluate(() => { document.documentElement.dataset.experienceTheme = 'true-black' })
  await page.screenshot({ path: testInfo.outputPath('hub-dark.png'), fullPage: true })
  await page.evaluate(() => { document.documentElement.dataset.experienceTheme = 'light' })
  await page.locator('#view-system [data-go="settings-mabel"]').click()
  await page.locator('#tvBorder').selectOption('finding-nemo')
  await expect.poll(() => page.locator('#tvSurroundPreview').evaluate(image => image.complete && image.naturalWidth)).toBe(1072)
  await page.screenshot({ path: testInfo.outputPath('surround-preview.png'), fullPage: true })
})

test('surround previews load the native designs without applying TV settings', async ({ page }) => {
  const writes = []
  await page.route('**/api/manage', async route => {
    writes.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true } })
  })
  await page.goto('/#settings/mabel')
  const preview = page.locator('#tvSurroundPreview')
  for (const style of ['slim-black', 'silver-90s', 'charcoal-90s', 'vintage-black', 'dinosaur-den', 'ocean-club', 'finding-nemo']) {
    await page.locator('#tvBorder').selectOption(style)
    await expect(preview).toHaveAttribute('src', `/portal/assets/surrounds/${style}.png`)
    await expect.poll(() => preview.evaluate(image => image.complete && image.naturalWidth)).toBe(1072)
  }
  expect(writes).toHaveLength(0)
  await page.locator('#view-settings-mabel [data-go="system"]').click()
  const colours = await page.locator('#view-system .settings-row-icon').evaluateAll(icons => icons.map(icon => getComputedStyle(icon).color))
  expect(new Set(colours).size).toBe(6)
})

test('settings destinations support cold routes, back and primary navigation', async ({ page }) => {
  await page.goto('/#system')
  await expect(page.locator('#view-system')).toBeVisible()
  await expect(page.locator('#view-system .settings-link-row')).toHaveCount(6)
  for (const destination of destinations) {
    await page.locator(`#view-system [data-go="${destination}"]`).click()
    await expect(page.locator(`#view-${destination}`)).toBeVisible()
    await expect(page.locator('[data-view-button="system"]')).toHaveAttribute('aria-current', 'page')
    await page.reload()
    await expect(page.locator(`#view-${destination}`)).toBeVisible()
    await page.locator(`#view-${destination} [data-go="system"]`).click()
    await expect(page.locator('#view-system')).toBeVisible()
  }
  await page.locator('#view-system [data-go="settings-media"]').click()
  await page.locator('#view-settings-media [data-go="activity"]').click()
  await expect(page.locator('#view-activity')).toBeVisible()
  await page.goBack()
  await expect(page.locator('#view-settings-media')).toBeVisible()
  await page.locator('[data-view-button="overview"]').click()
  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-settings-media')).toBeVisible()
  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-system')).toBeVisible()
})

test('TV settings keep drafts through refresh, discard safely and apply the existing payload', async ({ page }) => {
  let tvSettings = {
    playback_mode: 'resume', episode_reset_minutes: 20, picture_mode: 'fit', tv_border: 'silver-90s',
    crt_glass: 35, video_distortion: 20, display_resolution: '1080p', volume_limit_enabled: true,
    maximum_volume: 60, sound_effects_enabled: true, scrubbing_enabled: false,
  }
  const writes = []
  await page.route('**/api/library', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), tv_settings: tvSettings } })
  })
  await page.route('**/api/manage', async route => {
    const payload = route.request().postDataJSON()
    writes.push(payload)
    if (payload.action === 'set-tv-settings') tvSettings = payload.settings
    await route.fulfill({ json: { ok: true, refreshed: true } })
  })
  await page.goto('/#settings/mabel')
  await expect(page.locator('#tvPlaybackMode')).toHaveValue('resume')
  await expect(page.locator('#tvSettingsApply')).toBeDisabled()
  await page.locator('#tvBorder').selectOption('vintage-black')
  await page.locator('#tvScrubbing').click()
  await expect(page.locator('#tvScrubbing')).toHaveAttribute('aria-checked', 'true')
  await page.evaluate(() => renderLibraryView('settings-mabel', { force: true }))
  await expect(page.locator('#tvBorder')).toHaveValue('vintage-black')
  expect(writes).toHaveLength(0)
  await page.locator('#tvSettingsDiscard').click()
  await expect(page.locator('#tvBorder')).toHaveValue('silver-90s')
  await expect(page.locator('#tvScrubbing')).toHaveAttribute('aria-checked', 'false')
  await page.locator('#tvBorder').selectOption('ocean-club')
  await page.locator('#tvScrubbing').click()
  await page.locator('#tvSettingsApply').click()
  await expect(page.locator('#tvSettingsFeedback')).toHaveText('TV settings saved.')
  expect(writes).toEqual([{ action: 'set-tv-settings', settings: { ...tvSettings, tv_border: 'ocean-club', scrubbing_enabled: true } }])
  await expect(page.locator('#tvSettingsApply')).toBeDisabled()
  await page.reload()
  await expect(page.locator('#tvBorder')).toHaveValue('ocean-club')
  await expect(page.locator('#tvScrubbing')).toHaveAttribute('aria-checked', 'true')
})

test('Pi power actions remain confirmed and fill the phone content width', async ({ page }) => {
  const systemCalls = []
  await page.route('**/api/system', async route => {
    systemCalls.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true } })
  })
  page.on('dialog', dialog => dialog.dismiss())
  await page.goto('/#settings/help')
  for (const id of ['restartPlayer', 'rebootPi', 'poweroffPi']) {
    const button = page.locator(`#${id}`)
    await button.scrollIntoViewIfNeeded()
    const sizes = await button.evaluate(element => ({ button: element.getBoundingClientRect().width, parent: element.parentElement.getBoundingClientRect().width }))
    expect(sizes.button).toBeCloseTo(sizes.parent, 0)
    await button.click()
  }
  expect(systemCalls).toHaveLength(0)
  await expect(page.locator('#systemDetails')).not.toBeEmpty()
})

test('independent preferences save without applying or overwriting a TV draft', async ({ page }) => {
  const appearance = { tv_guide_enabled: false, parent_overlay_style: 'classic' }
  const myTvSettings = { watchmode_availability_enabled: true, provider_badges_enabled: true }
  const remoteViewing = { allow_simultaneous: false }
  const writes = []
  await page.route('**/api/library', async route => {
    const response = await route.fetch()
    const original = await response.json()
    await route.fulfill({ response, json: { ...original, appearance: { ...original.appearance, ...appearance }, my_tv_settings: myTvSettings, remote_viewing: { ...original.remote_viewing, ...remoteViewing } } })
  })
  await page.route('**/api/manage', async route => {
    const payload = route.request().postDataJSON()
    writes.push(payload)
    if (payload.action === 'set-tv-guide-enabled') appearance.tv_guide_enabled = payload.enabled
    if (payload.action === 'set-parent-overlay-style') appearance.parent_overlay_style = payload.style
    if (payload.action === 'set-remote-simultaneous') remoteViewing.allow_simultaneous = payload.enabled
    if (payload.action === 'set-watchmode-availability') myTvSettings.watchmode_availability_enabled = payload.enabled
    if (payload.action === 'set-my-tv-provider-badges') myTvSettings.provider_badges_enabled = payload.enabled
    await route.fulfill({ json: { ok: true, refreshed: true } })
  })
  await page.goto('/#settings/mabel')
  await page.locator('#tvBorder').selectOption('vintage-black')
  await page.locator('#tvGuideToggle').click()
  await expect(page.locator('#tvGuideToggle')).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('#tvBorder')).toHaveValue('vintage-black')
  await page.locator('#remoteConcurrentToggle').click()
  await expect(page.locator('#remoteConcurrentToggle')).toHaveAttribute('aria-checked', 'true')
  await page.locator('.settings-advanced summary').click()
  await page.locator('[data-parent-style="modern"]').click()
  await expect(page.locator('[data-parent-style="modern"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#view-settings-mabel [data-go="system"]').click()
  await page.locator('#view-system [data-go="settings-my-tv"]').click()
  await page.locator('#watchmodeAvailabilityToggle').click()
  await expect(page.locator('#watchmodeAvailabilityToggle')).toHaveAttribute('aria-checked', 'false')
  await page.locator('#myTvProviderBadgesToggle').click()
  await expect(page.locator('#myTvProviderBadgesToggle')).toHaveAttribute('aria-checked', 'false')
  expect(writes.map(value => value.action)).toEqual(['set-tv-guide-enabled', 'set-remote-simultaneous', 'set-parent-overlay-style', 'set-watchmode-availability', 'set-my-tv-provider-badges'])
})

test('focused settings layouts @visual', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'iphone-chromium', 'Review WebKit phone and tablet layouts')
  const output = path.resolve('../../work/settings-20261007')
  await mkdir(output, { recursive: true })
  await page.addInitScript(() => {
    localStorage.setItem('mabeltv-experience-theme', 'light')
    localStorage.setItem('mabeltv-experience-accent-hue', '172')
  })
  await page.goto('/#system')
  await expect(page.locator('#view-system')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(output, `${testInfo.project.name}-hub.png`), fullPage: true })
  for (const destination of destinations) {
    await page.locator(`#view-system [data-go="${destination}"]`).click()
    await expect(page.locator(`#view-${destination}`)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(testInfo.project.use.viewport.width)
    if (destination === 'settings-mabel') await page.locator('.settings-advanced').evaluate(details => { details.open = true })
    await page.screenshot({ path: path.join(output, `${testInfo.project.name}-${destination}.png`), fullPage: true })
    await page.locator(`#view-${destination} [data-go="system"]`).click()
  }
  await page.evaluate(() => { document.documentElement.dataset.experienceTheme = 'true-black' })
  await page.screenshot({ path: path.join(output, `${testInfo.project.name}-hub-dark.png`), fullPage: true })
})
