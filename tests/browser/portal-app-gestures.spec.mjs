import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

test('App gestures block zoom without swallowing scrolling, clicks or input', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  const events = await page.evaluate(() => {
    const fire = (name, options = {}) => {
      const event = name === 'wheel' ? new WheelEvent(name, { bubbles: true, cancelable: true, ...options })
        : name === 'keydown' ? new KeyboardEvent(name, { bubbles: true, cancelable: true, ...options })
          : new Event(name, { bubbles: true, cancelable: true })
      document.body.dispatchEvent(event)
      return event.defaultPrevented
    }
    return { pinch: fire('gesturestart'), zoomWheel: fire('wheel', { ctrlKey: true }),
      scrollWheel: fire('wheel', { deltaY: 100 }), zoomKey: fire('keydown', { ctrlKey: true, key: '+' }),
      typing: fire('keydown', { key: 'a' }), touch: fire('touchmove'),
      scrollbar: getComputedStyle(document.documentElement).scrollbarWidth,
      touchAction: getComputedStyle(document.documentElement).touchAction }
  })
  expect(events).toMatchObject({ pinch: true, zoomWheel: true, scrollWheel: false,
    zoomKey: true, typing: false, touch: false, scrollbar: 'none', touchAction: 'pan-x pan-y' })
  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#view-watch')).toBeVisible()
  await page.locator('#watchMabelSearch').fill('Zog')
  await expect(page.locator('#watchMabelSearch')).toHaveValue('Zog')
})
