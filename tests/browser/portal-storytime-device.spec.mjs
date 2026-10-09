import { test, expect } from './test-fixtures.mjs'
import { familyFixture, tapInContent } from './family-fixture.mjs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// These device UI cases use page-level API fixtures. The real worker has its
// own PWA contracts; blocking it here keeps requests inside those fixtures.
test.use({ serviceWorkers: 'block' })

async function stories(page, count = 10) {
  const state = await familyFixture(page)
  state.stories = Array.from({ length: count }, (_, index) => ({
    id: `story${index}`, title: `A little adventure ${String(index + 1).padStart(2, '0')}`, ready: true, position_seconds: 30, updated: Date.now() / 1000,
    audio: { id: `audio${index}`, status: 'ready', duration: 1200, media_url: '/__fixture/story.wav' },
    image: { id: `image${index}`, status: 'ready', media_url: '/api/family-media/content?id=picture', artwork_url: '/api/family-media/content?id=picture&artwork=1' },
  }))
  await page.evaluate(() => {
    window.storyAudioCalls = []
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return !this.storyPlaying } })
    HTMLMediaElement.prototype.play = function() {
      this.storyPlaying = true; window.storyAudioCalls.push({ id: this.id, muted: this.muted, src: this.src })
      this.dispatchEvent(new Event('playing')); return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function() { this.storyPlaying = false; this.dispatchEvent(new Event('pause')) }
  })
  await page.locator('#mabelChannelAudioTab').click()
  await expect(page.locator('.family-story-card')).toHaveCount(count)
  return state
}

async function openCatalogue(page) {
  await page.getByRole('button', { name: 'Open Storytime', exact: true }).click()
  await expect(page.locator('#familyStorytimeSheet')).toBeVisible()
  await page.locator('#familyStorytimeDevice').click()
  await expect(page.locator('#familyStorytimeSheet')).not.toBeVisible()
}

async function reviewLandedPrint(page, book, name) {
  await expect(book).toHaveClass(/opening/)
  await book.evaluate(async book => {
    await book.querySelector('.story-leaf-back img').decode()
    for (const animation of book.getAnimations({ subtree: true })) {
      animation.pause(); animation.currentTime = 7955
    }
  })
  const output = join('test-results', 'storytime-device'); await mkdir(output, { recursive: true })
  await book.screenshot({ path: join(output, `${name}-landing.png`), animations: 'allow' })
  const bounds = await book.boundingBox()
  const clip = { x: Math.round(bounds.x + bounds.width * .42), y: Math.round(bounds.y + bounds.height * .43), width: 8, height: 8 }
  let landedPixels
  // Sample actual rendered left-page pixels at landing, afterwards, and after
  // animation cleanup. Computed opacity alone missed the physical iOS failure.
  for (const time of [8084, 8085, 8200, 8599]) {
    await book.evaluate((book, time) => {
      for (const animation of book.getAnimations({ subtree: true })) animation.currentTime = time
    }, time)
    const pixels = await page.screenshot({ clip, animations: 'allow' })
    if (!landedPixels) landedPixels = pixels
    else expect(pixels.equals(landedPixels), `Left-page pixels changed at ${time}ms`).toBe(true)
  }
  await book.screenshot({ path: join(output, `${name}-landed.png`), animations: 'allow' })
  const continuous = await book.evaluate(async book => {
    const surface = book.querySelector('.story-leaf-back')
    const image = surface.querySelector('img')
    const samples = []
    const sample = () => samples.push({ mounted: book.querySelector('.story-leaf-back') === surface,
      visible: getComputedStyle(surface).visibility, loaded: image.complete && image.naturalWidth > 0 })
    sample()
    book.getAnimations({ subtree: true }).forEach(animation => animation.finish())
    for (let frame = 0; frame < 8; frame++) {
      await new Promise(requestAnimationFrame); sample()
    }
    return samples
  })
  for (const sample of continuous) expect(sample).toEqual({ mounted: true, visible: 'visible', loaded: true })
  await expect(book).toHaveClass(/opened/)
  expect((await page.screenshot({ clip, animations: 'allow' })).equals(landedPixels), 'Left-page pixels changed during cleanup').toBe(true)
  await book.screenshot({ path: join(output, `${name}-settled.png`), animations: 'allow' })
}

test('Device catalogue pages books and cancels stale previews without controlling the Pi', async ({ page }, info) => {
  const state = await stories(page)
  await openCatalogue(page)
  await expect(page.locator('#familyStoryCatalogue')).toBeVisible()
  const size = info.project.name === 'ipad-webkit' ? 8 : 4
  await expect(page.locator('.family-story-book-card')).toHaveCount(size)
  const covers = await page.locator('.story-preview').evaluateAll(books => books.map(book => book.style.getPropertyValue('--story-cover-image')))
  expect(new Set(covers).size).toBe(size)
  await expect(page.locator('#familyDeviceTitle')).toContainText('Storytime')
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
  await expect(page.locator('.family-story-book-card.is-selected')).toHaveAttribute('data-story-id', 'story2')
  await expect(page.locator('.family-story-book-card.is-selected .story-preview')).toHaveClass(/opening|opened/)
  await expect(page.locator('.family-story-book-card:not(.is-selected) .opening')).toHaveCount(0)
  await page.locator('#familyStoryNext').click()
  await expect(page.locator('#familyStoryPage')).toHaveText(`2 of ${size === 8 ? 2 : 3}`)
  await page.locator('#familyDeviceClose').click()
  await expect(page.locator('#familyDevicePlayer')).not.toBeVisible()
  expect(await page.evaluate(() => familyStoryBrowser)).toBe(null)
  expect(state.calls).toEqual([])
})

test('Direct device story returns through closing and docking, then plays a different book', async ({ page }) => {
  const state = await stories(page, 3)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await tapInContent(page.locator('.family-story-card').first())
  await page.locator('#familyStoryDevice').click()
  await expect(page.locator('#familyDeviceBook')).toHaveClass(/opening/)
  await page.locator('#familyDeviceSkip').click()
  await expect.poll(() => page.evaluate(() => familyListeningStarted)).toBe(true)
  await page.locator('#familyDeviceClose').click()
  await expect(page.locator('#familyDeviceBook')).toHaveClass(/closing/)
  await expect(page.locator('#familyStoryCatalogue')).toBeVisible()
  await expect(page.locator('#familyDeviceBook')).not.toBeVisible()
  await expect(page.locator('#familyDevicePlayer')).toBeVisible()
  expect(await page.locator('#familyDeviceAudio').evaluate(audio => audio.paused)).toBe(true)
  expect(await page.evaluate(() => familyDeviceStory)).toBe(null)
  await expect.poll(() => state.calls.some(call => call.action === 'story-progress' && call.id === 'story0')).toBe(true)
  await page.locator('.family-story-book-card[data-story-id="story1"]').click()
  await expect(page.locator('.family-story-book-card[data-story-id="story1"] .story-preview')).toHaveClass(/opened/)
  await page.locator('.family-story-book-card[data-story-id="story1"]').click()
  await expect(page.locator('#familyDeviceTitle')).toHaveText('A little adventure 02')
  await page.locator('#familyDeviceSkip').click()
  await expect.poll(() => page.evaluate(() => familyDeviceStory?.id)).toBe('story1')
  expect(state.calls.every(call => call.action === 'story-progress')).toBe(true)
})

test('Back during opening and rapid arrows during return cannot restart narration', async ({ page }) => {
  await stories(page, 6)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openCatalogue(page)
  await expect(page.locator('.family-story-book-card.is-selected .story-preview')).toHaveClass(/opened/)
  await page.locator('.family-story-book-card').first().click()
  await page.locator('#familyDeviceClose').click()
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
  await expect(page.locator('#familyStoryCatalogue')).toBeVisible()
  await expect(page.locator('.family-story-book-card.is-selected')).toHaveAttribute('data-story-id', 'story2')
  expect(await page.locator('#familyDeviceAudio').evaluate(audio => audio.paused)).toBe(true)
  expect(await page.evaluate(() => familyListeningStarted)).toBe(false)
  expect(await page.evaluate(() => window.storyAudioCalls.filter(call => call.id === 'familyDeviceAudio' && !call.muted))).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.locator('#familyDevicePlayer')).not.toBeVisible()
  expect(await page.evaluate(() => familyBookCleanup)).toBe(null)
})

test('Blocked autoplay offers Start story, and Escape still returns to the books', async ({ page }) => {
  await stories(page, 2)
  await page.evaluate(() => { HTMLMediaElement.prototype.play = function() { return Promise.reject(new DOMException('Tap required', 'NotAllowedError')) } })
  await openCatalogue(page)
  await expect(page.locator('.family-story-book-card.is-selected .story-preview')).toHaveClass(/opened/)
  await page.locator('.family-story-book-card').first().click()
  await page.locator('#familyDeviceSkip').click()
  await expect(page.locator('#familyDeviceStart')).toBeVisible()
  await expect(page.locator('#familyDeviceMessage')).toContainText('Tap Start story')
  await page.keyboard.press('Escape')
  await expect(page.locator('#familyStoryCatalogue')).toBeVisible()
  await expect(page.locator('#familyDevicePlayer')).toBeVisible()
})

test('Full screen belongs to the Storytime scene and exits when its catalogue closes', async ({ page }) => {
  await stories(page, 1)
  await page.evaluate(() => {
    let owner = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => owner })
    document.querySelector('#familyDevicePlayer').requestFullscreen = function() { owner = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve() }
    document.exitFullscreen = () => { owner = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve() }
  })
  await openCatalogue(page)
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  await expect(page.locator('#familyStoryFullscreen')).toHaveAttribute('aria-label', 'Exit full screen')
  expect(await page.evaluate(() => document.fullscreenElement.id)).toBe('familyDevicePlayer')
  await page.locator('#familyDeviceClose').click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null)
})

test('Touch previews a different book first, then a second tap starts it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mabeltv-experience-theme', 'light'))
  await stories(page, 3)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openCatalogue(page)
  const card = page.locator('.family-story-book-card[data-story-id="story1"]')
  await card.tap()
  await expect(card).toHaveClass(/is-selected/)
  await reviewLandedPrint(page, card.locator('.story-preview'), 'preview')
  expect(await page.evaluate(() => familyDeviceStory)).toBe(null)
  expect(await page.evaluate(() => window.storyAudioCalls.filter(call => call.id === 'familyDeviceAudio'))).toEqual([])
  await expect(card.locator(':scope > strong')).toHaveCSS('color', 'rgb(234, 210, 148)')
  await expect(card.locator('.story-cover-front strong')).toHaveCSS('color', 'rgb(242, 215, 151)')
  await card.tap()
  await expect.poll(() => page.evaluate(() => familyDeviceStory?.id)).toBe('story1')
  await expect(page.locator('#familyDeviceBook')).toHaveClass(/opening/)
  await expect(page.locator('#familyBookName')).toHaveText('A little adventure 02')
  await page.locator('#familyDeviceSkip').click()
  await expect.poll(() => page.evaluate(() => familyListeningStarted)).toBe(true)
})

test('Reading uses landscape height for the book and illustration on phones and tablets', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await stories(page, 1)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await tapInContent(page.locator('.family-story-card').first())
  await page.locator('#familyStoryDevice').click()
  await reviewLandedPrint(page, page.locator('#familyDeviceBook'), 'reading')
  const portrait = await page.locator('#familyDeviceBook').boundingBox()
  const portraitImage = await page.locator('#familyDeviceBook .story-leaf-back img').boundingBox()
  const output = join('test-results', 'storytime-device'); await mkdir(output, { recursive: true })
  for (const [name, viewport] of [['phone-landscape', { width: 852, height: 393 }],
    ['tablet-landscape', { width: 1024, height: 768 }]]) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => {
      document.querySelector('#familyDevicePlayer').classList.add('story-controls-hidden')
      return document.fonts.ready
    })
    const book = await page.locator('#familyDeviceBook').boundingBox()
    const image = await page.locator('#familyDeviceBook .story-leaf-back img').boundingBox()
    expect(book.width).toBeGreaterThan(portrait.width * 1.2)
    expect(image.height).toBeGreaterThan(portraitImage.height * 1.2)
    expect(book.x).toBeGreaterThanOrEqual(0)
    expect(book.y).toBeGreaterThanOrEqual(0)
    expect(book.x + book.width).toBeLessThanOrEqual(viewport.width)
    expect(book.y + book.height).toBeLessThanOrEqual(viewport.height)
    await page.screenshot({ path: join(output, `${name}-reading.png`) })
  }
})

test('Device bookmarks expire even in an already open catalogue, and Restart clears the position', async ({ page }) => {
  await stories(page, 1)
  await page.evaluate(() => {
    familyLibrary.stories[0].updated = Date.now() / 1000 - 3601
    familyLibrary.stories[0].position_seconds = 300
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => 1200 })
  })
  await tapInContent(page.locator('.family-story-card').first())
  await page.locator('#familyStoryDevice').click()
  await page.locator('#familyDeviceSkip').click()
  await expect.poll(() => page.evaluate(() => familyListeningStarted)).toBe(true)
  expect(await page.locator('#familyDeviceAudio').evaluate(audio => audio.currentTime)).toBe(0)
  await page.locator('#familyDeviceAudio').evaluate(audio => { audio.currentTime = 84; audio.pause() })
  await page.getByRole('button', { name: 'Restart story', exact: true }).click()
  expect(await page.locator('#familyDeviceAudio').evaluate(audio => audio.currentTime)).toBe(0)
  expect(await page.locator('#familyDeviceAudio').evaluate(audio => audio.paused)).toBe(false)
})

test('Storytime fits portrait, landscape and tablet with readable book surfaces @visual', async ({ page }, info) => {
  await stories(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCatalogue(page)
  const path = join('test-results', 'storytime-device'); await mkdir(path, { recursive: true })
  for (const [name, viewport] of [['portrait', info.project.name === 'ipad-webkit' ? { width: 768, height: 1024 } : { width: 393, height: 852 }],
    ['landscape', info.project.name === 'ipad-webkit' ? { width: 1024, height: 768 } : { width: 852, height: 393 }]]) {
    await page.setViewportSize(viewport)
    await expect(page.locator('.family-story-book-card')).toHaveCount(info.project.name === 'ipad-webkit' && name === 'portrait' || viewport.height >= 500 && viewport.width >= 768 ? 8 : 4)
    await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.querySelectorAll('#familyStoryBooks img')].map(image => image.decode())]))
    await expect(page.locator('.is-selected .story-preview')).toHaveClass(/opened/)
    const bounds = await page.locator('.family-story-book-card').evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect(), art = card.querySelector('.family-story-book-art').getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, artHeight: art.height }
    }))
    for (const card of bounds) {
      expect(card.left).toBeGreaterThanOrEqual(0); expect(card.right).toBeLessThanOrEqual(viewport.width)
      expect(card.top).toBeGreaterThanOrEqual(0); expect(card.bottom).toBeLessThanOrEqual(viewport.height)
      expect(card.artHeight).toBeGreaterThan(45)
    }
    await page.screenshot({ path: join(path, `${info.project.name}-${name}.png`), animations: 'disabled' })
  }
})
