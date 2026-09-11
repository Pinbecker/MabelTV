import { test, expect } from '@playwright/test'


async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

async function longAdultHome(page) {
  await page.evaluate(() => {
    const titles = Array.from({ length: 80 }, (_, index) => ({
      key: `movie:${index + 1}`, media_type: 'movie', tmdb_id: index + 1,
      title: `Film ${index + 1}`, year: '2020', viewing: {},
    }))
    adultHomeLoadedAt = Date.now()
    document.querySelector('#adultHomeForYou')
      .replaceChildren(...titles.map(title => adultExploreCard(title)))
  })
  await page.locator('[data-view-button="adult-home"]').click()
  await page.evaluate(async () => {
    for (let frame = 0; frame < 6; frame += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
  })
}

const scrollY = page => page.evaluate(() => window.scrollY)

test('re-tapping primary navigation returns its section home to the top', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'Primary navigation contract')
  await openPortal(page)
  await longAdultHome(page)

  await page.evaluate(() => window.scrollTo(0, 1200))
  await page.locator('[data-view-button="system"]').click()
  await page.locator('[data-view-button="adult-home"]').click()
  expect(await scrollY(page)).toBeGreaterThan(100)
  await page.locator('#adultHomeInsightsTab').click()
  await page.locator('[data-view-button="adult-home"]').click()
  await expect(page.locator('#view-adult-home')).toBeVisible()
  await expect(page.locator('#adultHomeWatchTab')).toHaveAttribute('aria-selected', 'true')
  expect(await scrollY(page)).toBeLessThanOrEqual(1)

  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#watchMabelInsightsTab').click()
  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#view-watch')).toBeVisible()
  await expect(page.locator('#watchMabelTab')).toHaveAttribute('aria-selected', 'true')
  expect(await scrollY(page)).toBeLessThanOrEqual(1)

  for (const destination of ['overview', 'system']) {
    await page.locator(`[data-view-button="${destination}"]`).click()
    await page.locator(`#view-${destination}`).evaluate(view => { view.style.minHeight = '1800px' })
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    expect(await scrollY(page)).toBeGreaterThan(0)
    await page.locator(`[data-view-button="${destination}"]`).click()
    expect(await scrollY(page)).toBeLessThanOrEqual(1)
    await page.locator(`#view-${destination}`).evaluate(view => { view.style.removeProperty('min-height') })
  }
})

test('bottom navigation preserves independent section histories', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Adult navigation journey contract')
  await openPortal(page)
  await page.locator('[data-view-button="adult-home"]').click()
  await page.locator('#adultMyViewing').click()
  await page.locator('#adultViewingExplore').click()
  await expect(page.locator('#view-adult-explore')).toBeVisible()

  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-system')).toBeVisible()
  await page.locator('[data-view-button="adult-home"]').click()
  await expect(page.locator('#view-adult-explore')).toBeVisible()
  await page.goBack()
  await expect(page.locator('#view-adult-viewing')).toBeVisible()
  await page.goBack()
  await expect(page.locator('#view-adult-home')).toBeVisible()

  await page.locator('[data-view-button="system"]').click()
  await page.locator('#openAppearanceSettings').click()
  await expect(page.locator('#view-appearance')).toBeVisible()
  await page.locator('[data-view-button="adult-home"]').click()
  await expect(page.locator('#view-adult-home')).toBeVisible()
  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-appearance')).toBeVisible()
  await page.goBack()
  await expect(page.locator('#view-system')).toBeVisible()
})

test('remote omits the redundant home-network footer', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Remote copy contract')
  await openPortal(page)
  await page.locator('[data-view-button="live"]').click()
  await expect(page.locator('#view-live')).toBeVisible()
  await expect(page.locator('#view-live')).not.toContainText('Live preview stays on your home network')
})

test('subpage back controls sit tightly beneath the app header', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone subpage spacing contract')
  await openPortal(page)
  const expectCompactBack = async (button, following) => {
    const gaps = await page.evaluate(({ button, following }) => {
      const header = document.querySelector('.mobile-head').getBoundingClientRect()
      const back = document.querySelector(button).getBoundingClientRect()
      const next = document.querySelector(following).getBoundingClientRect()
      return { above: back.top - header.bottom, below: next.top - back.bottom }
    }, { button, following })
    expect(gaps.above).toBeGreaterThanOrEqual(0)
    expect(gaps.above).toBeLessThanOrEqual(10)
    expect(gaps.below).toBeGreaterThanOrEqual(0)
    expect(gaps.below).toBeLessThanOrEqual(8)
  }

  await page.locator('[data-view-button="adult-home"]').click()
  await page.locator('#adultMyViewing').click()
  await expectCompactBack('#adultViewingBack', '.adult-viewing-title .eyebrow')
  await page.locator('#adultViewingExplore').click()
  await expectCompactBack('#adultExploreBack', '#view-adult-explore .adult-explore-title .eyebrow')
  await page.goBack()
  await page.locator('#adultViewingRatings').click()
  await expectCompactBack('#adultRatingsBack', '#view-adult-ratings .adult-explore-title .eyebrow')

  await page.locator('[data-view-button="watch"]').click()
  await page.evaluate(() => { openView('channels'); showChannelHub() })
  await page.locator('[data-open-channel]').first().click()
  await expectCompactBack('.channel-page-back', '.channel-page-hero')
})
