import { test, expect } from '@playwright/test'


async function openPortal(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

test('bottom navigation recalls a section location and a second tap resets its root', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Native iOS history contract')
  await openPortal(page)
  const initialLength = await page.evaluate(() => history.length)
  await page.locator('[data-view-button="adult-home"]').click()
  expect(await page.evaluate(() => history.length)).toBe(initialLength)
  await page.locator('#adultMyViewing').click()
  await page.locator('#adultViewingExplore').click()
  await expect(page.locator('#view-adult-explore')).toBeVisible()
  await page.locator('#view-adult-explore').evaluate(view => { view.style.minHeight = '1800px' })
  await page.evaluate(() => window.scrollTo(0, 700))
  const adultScroll = await page.evaluate(() => window.scrollY)
  const journeyLength = await page.evaluate(() => history.length)

  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-system')).toBeVisible()
  expect(await page.evaluate(() => history.length)).toBe(journeyLength)
  await page.locator('[data-view-button="adult-home"]').click()
  await expect(page.locator('#view-adult-explore')).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(adultScroll, 0)
  expect(await page.evaluate(() => history.length)).toBe(journeyLength)

  await page.locator('[data-view-button="adult-home"]').click()
  await expect(page.locator('#view-adult-home')).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => history.length)).toBe(journeyLength)
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
