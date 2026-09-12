import { test, expect } from './test-fixtures.mjs'


async function openAppearance(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.locator('[data-view-button="system"]').click()
  await page.locator('[data-go="appearance"]').click()
  await expect(page.locator('#view-appearance')).toBeVisible()
}


test('@visual Colour page previews and persists all three appearance depths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One phone engine covers device-local appearance')
  await openAppearance(page)

  const root = page.locator('html')
  const slider = page.locator('#experienceThemeLevel')
  await expect(root).toHaveAttribute('data-experience-theme', 'dark')
  await expect(slider).toHaveValue('2')
  await expect(page.locator('#experienceThemeName')).toHaveText('True black')
  await expect(page).toHaveScreenshot('appearance-true-black.png')

  await slider.fill('1')
  await expect(root).toHaveAttribute('data-experience-theme', 'dim')
  await expect(page.locator('#experienceThemeName')).toHaveText('Dark')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#151820')
  expect(await page.evaluate(() => localStorage.getItem('mabeltv-experience-theme'))).toBe('dim')
  await expect(page).toHaveScreenshot('appearance-dark.png')

  await slider.fill('0')
  await expect(root).toHaveAttribute('data-experience-theme', 'light')
  await expect(page.locator('#experienceThemeName')).toHaveText('Light')
  await expect(page).toHaveScreenshot('appearance-light.png')

  await page.reload()
  await expect(page.locator('#view-appearance')).toBeVisible()
  await expect(root).toHaveAttribute('data-experience-theme', 'light')
  await expect(slider).toHaveValue('0')
})


test('Accent presets, strength and semantic colours remain clear and editable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One engine covers saved accent controls')
  await openAppearance(page)

  const presetColours = await page.locator('[data-accent-preset]').evaluateAll(elements =>
    elements.map(element => getComputedStyle(element).backgroundColor))
  expect(new Set(presetColours).size).toBe(8)

  await page.getByRole('button', { name: 'Blue accent' }).click()
  await expect(page.locator('#experienceAccentHue')).toHaveValue('255')
  await expect(page.locator('#experienceAccentName')).toHaveText('Blue')
  expect(await page.evaluate(() => localStorage.getItem('mabeltv-experience-accent-hue'))).toBe('255')

  await page.getByRole('button', { name: 'Vivid' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-experience-accent-strength', 'vivid')
  expect(await page.evaluate(() => localStorage.getItem('mabeltv-experience-accent-strength'))).toBe('vivid')
  await expect(page.locator('#appearanceSettingsSummary')).toHaveText('True black · Blue · Vivid')

  const semanticColours = await page.locator('[data-semantic-colour]').evaluateAll(elements =>
    elements.map(element => element.value))
  expect(semanticColours).toHaveLength(4)
  expect(new Set(semanticColours).size).toBe(4)
  const semanticSwatches = await page.locator('[data-semantic-colour]').evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }))
  for (const swatch of semanticSwatches) {
    expect(Math.abs(swatch.width - swatch.height)).toBeLessThanOrEqual(1)
    expect(swatch.width).toBeLessThanOrEqual(34)
  }

  const watchedColour = page.locator('#experienceGoodColour')
  await watchedColour.fill('#245f42')
  await expect(page.locator('[data-semantic-value="good"]')).toHaveText('#245F42')
  expect(await page.evaluate(() => localStorage.getItem('mabeltv-experience-good-colour')))
    .toBe('#245f42')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--experience-good-base').trim())).toBe('#245f42')

  await page.reload()
  await expect(page.locator('#experienceGoodColour')).toHaveValue('#245f42')

  await page.locator('#appearanceBack').click()
  await expect(page.locator('#view-system')).toBeVisible()
  await expect(page.locator('#appearanceSettingsSummary')).toHaveText('True black · Blue · Vivid')
})


test('Meaningful colour controls stay circular and compact on phones', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone control geometry')
  await openAppearance(page)

  const semanticSwatches = await page.locator('[data-semantic-colour]').evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }))
  expect(semanticSwatches).toHaveLength(4)
  for (const swatch of semanticSwatches) {
    expect(Math.abs(swatch.width - swatch.height)).toBeLessThanOrEqual(1)
    expect(swatch.width).toBeLessThanOrEqual(34)
  }
})
