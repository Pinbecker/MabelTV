import { test, expect } from './test-fixtures.mjs'
import fs from 'node:fs/promises'

test.use({ serviceWorkers: 'block' })

async function openChannels(page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.locator('[data-view-button="watch"]').click()
  await page.evaluate(() => {
    const film = library.channels.find(channel => channel.content_type === 'films')
    const episodes = library.channels.find(channel => channel.content_type !== 'films')
    library.channels = [
      ...Array.from({ length: 9 }, (_, index) => ({
        ...episodes, number: index + 1, name: `Episode channel ${index + 1}`,
        folder: `episodes-${index}`, metadata: { title: `Episode channel ${index + 1}` },
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        ...film, number: index + 10, name: `Film channel ${index + 1}`, folder: `films-${index}`,
      })),
    ]
    renderRemoteViewing({ force: true })
  })
  await page.evaluate(() => document.fonts.ready)
}

async function settled(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => requestAnimationFrame(resolve))
  })
}

test('all channels stay mounted with four episode columns and four films plus a scroll glimpse', async ({ page }, testInfo) => {
  await openChannels(page)
  const header = await page.locator('#view-watch .watch-title').innerHTML()
  const primaryTabs = await page.locator('#view-watch .watch-tabs').innerHTML()
  await expect(page.locator('.watch-mabel-series-channel-card')).toHaveCount(9)
  await expect(page.locator('#mabelChannelEpisodes button')).toHaveCount(9)
  expect(await page.locator('.mabel-episode-channel-grid').evaluate(grid =>
    getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(4)
  await page.locator('#mabelChannelFilmsTab').click()
  await expect(page.locator('.mabel-film-channel')).toHaveCount(5)
  await expect(page.locator('.mabel-film-head h2')).toHaveText([
    'Film channel 1', 'Film channel 2', 'Film channel 3', 'Film channel 4', 'Film channel 5',
  ])
  expect(await page.locator('#mabelChannelFilms').evaluate(panel => getComputedStyle(panel).rowGap)).toBe('12px')
  const widths = await page.locator('.watch-film-channel-rail').first().evaluate(rail => {
    const bounds = rail.getBoundingClientRect()
    const cards = [...rail.children].map(card => card.getBoundingClientRect())
    return { fourth: bounds.right - cards[3].right, glimpse: bounds.right - cards[4].left,
      fifthWidth: cards[4].width, overflow: document.documentElement.scrollWidth - window.innerWidth }
  })
  expect(widths.fourth).toBeGreaterThan(11)
  expect(widths.glimpse).toBeGreaterThanOrEqual(10)
  expect(widths.glimpse).toBeLessThanOrEqual(14)
  expect(widths.glimpse).toBeLessThan(widths.fifthWidth)
  expect(widths.overflow).toBeLessThanOrEqual(1)
  expect(await page.locator('#view-watch .watch-title').innerHTML()).toBe(header)
  expect(await page.locator('#view-watch .watch-tabs').innerHTML()).toBe(primaryTabs)
  await page.locator('.mabel-film-head').first().click()
  await expect(page.locator('#channelWorkspace')).toBeVisible()
  await page.locator('#backToChannels').click()
  await expect(page.locator('#mabelChannelFilmsTab')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#mabelChannelFilms')).toBeVisible()
  await page.locator('#watchMabelSearch').fill('Ocean Friends')
  await expect(page.locator('#remoteMabel')).not.toBeVisible()
  await expect(page.locator('#watchMabelSearchGrid .watch-card')).toHaveCount(5)
  await page.locator('#watchMabelSearchClear').click()
  await expect(page.locator('#mabelChannelFilms')).toBeVisible()
  await fs.mkdir('test-results/channel-layout', { recursive: true })
  await page.screenshot({ path: `test-results/channel-layout/${testInfo.project.name}-films.png`, fullPage: true })
  await page.locator('#mabelChannelEpisodesTab').click()
  await page.screenshot({ path: `test-results/channel-layout/${testInfo.project.name}-episodes.png`, fullPage: true })
})

test('switching channels preserves screen and film row positions, including a shorter list at the bottom', async ({ page }) => {
  await openChannels(page)
  await page.locator('#mabelChannelFilmsTab').click()
  await page.evaluate(() => {
    const rail = document.querySelector('.watch-film-channel-rail')
    rail.style.scrollSnapType = 'none'
    rail.scrollLeft = 170
    rail.dataset.persistenceProbe = 'same-node'
    window.scrollTo(0, 180)
  })
  await settled(page)
  const before = await page.evaluate(() => ({ y: portalScrollTop(), left: document.querySelector('.watch-film-channel-rail').scrollLeft }))
  await page.locator('#mabelChannelEpisodesTab').evaluate(button => button.click())
  await settled(page)
  expect(await page.evaluate(() => portalScrollTop())).toBeCloseTo(before.y, 0)
  await page.locator('#mabelChannelFilmsTab').evaluate(button => button.click())
  await settled(page)
  expect(await page.evaluate(() => portalScrollTop())).toBeCloseTo(before.y, 0)
  expect(await page.locator('.watch-film-channel-rail').first().evaluate(rail => rail.scrollLeft)).toBeCloseTo(before.left, 0)
  await expect(page.locator('.watch-film-channel-rail').first()).toHaveAttribute('data-persistence-probe', 'same-node')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await settled(page)
  const bottom = await page.evaluate(() => portalScrollTop())
  await page.locator('#mabelChannelEpisodesTab').evaluate(button => button.click())
  await settled(page)
  expect(await page.evaluate(() => portalScrollTop())).toBeCloseTo(bottom, 0)
  await page.evaluate(() => renderRemoteViewing({ force: true }))
  await settled(page)
  expect(await page.evaluate(() => portalScrollTop())).toBeCloseTo(bottom, 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await settled(page)
  expect(await page.locator('#remoteMabel').evaluate(browser => browser.style.minHeight)).toBe('')
  await page.locator('#mabelChannelEpisodesTab').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#mabelChannelFilmsTab')).toBeFocused()
  await page.evaluate(() => renderRemoteViewing({ force: true }))
  await expect(page.locator('#mabelChannelFilms')).toBeVisible()
  await expect(page.locator('#mabelChannelFilmsTab')).toHaveAttribute('aria-selected', 'true')
})

test('Home keeps four Up Next cards while Mabel TV goes straight from search to channels', async ({ page }) => {
  for (const file of ['Snowy Adventure.mp4', 'Ocean Friends.mp4', 'The Gruffalo Trail.mp4', 'Woodland Story.mp4']) {
    const response = await page.request.post('/api/mabel-queue', { data: { action: 'add', channel: 1, file } })
    expect(response.ok()).toBe(true)
  }
  await page.goto('/')
  async function expectFour(selector) {
    await expect(page.locator(`${selector} > button`)).toHaveCount(5)
    const layout = await page.locator(selector).evaluate(rail => {
      const bounds = rail.getBoundingClientRect()
      const cards = [...rail.children].map(card => card.getBoundingClientRect())
      return { fourth: bounds.right - cards[3].right, fifth: cards[4].left - bounds.right }
    })
    expect(Math.abs(layout.fourth)).toBeLessThanOrEqual(1)
    expect(layout.fifth).toBeGreaterThanOrEqual(10)
  }
  await expectFour('#homeMabelQueueRail')
  await expect(page.locator('#homeContinueSection')).toBeVisible()
  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#watchMabelContinueSection, #watchMabelQueueSection')).toHaveCount(0)
  await expect(page.locator('#mabelChannelEpisodesTab')).toBeVisible()
  const layout = await page.locator('#watchMabelLayout').evaluate(view => {
    const search = view.querySelector('.watch-mabel-discovery').getBoundingClientRect()
    const toggle = view.querySelector('.mabel-channel-toggle').getBoundingClientRect()
    const title = document.querySelector('#view-watch .watch-title').getBoundingClientRect()
    return { gap: toggle.top - search.bottom, titleHeight: title.height,
      children: [...view.children].filter(child => child.offsetHeight).map(child => child.id || child.className) }
  })
  expect(layout.children).toEqual(['watch-discovery watch-mabel-discovery', 'remoteMabel', 'watchMabelUtilities'])
  expect(layout.gap).toBeGreaterThanOrEqual(10)
  expect(layout.gap).toBeLessThanOrEqual(18)
  if (page.viewportSize().width <= 620) expect(layout.titleHeight).toBeLessThan(64)
  await page.locator('#mabelChannelFilmsTab').click()
  await page.locator('.watch-mabel-film-card').nth(4).click()
  await page.locator('#watchProgrammeQueue').click()
  await expect(page.locator('#watchProgrammeSheet')).not.toBeVisible()
  await page.locator('[data-view-button="overview"]').click()
  await expect(page.locator('#homeMabelQueueRail > button')).toHaveCount(6)
  await expect(page.locator('#homeMabelQueueRail')).toContainText('Moonlight Express')
  await expect(page.locator('#homeContinueSection')).toBeVisible()
})
