import { test, expect } from './test-fixtures.mjs'

test('Activity progress and tab changes retain each list position', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(async () => {
    const activity = { active: true,
      uploads: Array.from({ length: 45 }, (_, i) => ({ id: `upload-${i}`, title: `Transfer ${i}`,
        status: 'uploading', transfer_state: 'active', size: 1000, offset: 100, source_available: true })),
      optimisations: Array.from({ length: 40 }, (_, i) => ({ path: `film-${i}.mp4`, title: `Film ${i}`,
        state: 'queued', progress: 20 })),
    }
    const originalApi = api
    api = async (url, options) => url === '/api/activity' ? activity : originalApi(url, options)
    openView('activity')
    await loadActivity()
    await Promise.allSettled(document.querySelector('.view.active').getAnimations().map(animation => animation.finished))
    window.scrollTo(0, 1500)
  })
  await page.evaluate(() => loadActivity())
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(1500, 0)
  await page.locator('[data-activity-tab="optimising"]').dispatchEvent('click')
  await page.evaluate(() => window.scrollTo(0, 1100))
  await page.locator('[data-activity-tab="uploads"]').dispatchEvent('click')
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(1500, 0)
  await page.locator('[data-activity-tab="optimising"]').dispatchEvent('click')
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(1100, 0)
})
