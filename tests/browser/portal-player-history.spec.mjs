import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

test('remote subtitles work for kids in every picture mode and disable without a track', async ({ page }) => {
  const state = {available:true,standby:false,my_tv_mode:false,presentation_mode:'standard',
    subtitles_available:true,subtitles_visible:false}
  // Keep polling and the command acknowledgement on the same simulated TV.
  // The generic fixture has no native subtitle controller.
  await page.route('**/api/live', route => route.fulfill({json:state}))
  await page.route('**/api/live/control', route => {
    if (route.request().postDataJSON().command === 'toggle-subtitles') state.subtitles_visible = !state.subtitles_visible
    return route.fulfill({json:{ok:true}})
  })
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => openView('live'))
  const subtitles = page.locator('#remoteSubtitles')
  for (const mode of ['standard', 'widescreen', 'fullscreen']) {
    state.presentation_mode = mode
    await page.evaluate(value => renderRemoteState(value), state)
    await expect(subtitles).toBeEnabled()
    await expect(subtitles).toHaveAttribute('aria-pressed', 'false')
  }
  const sent = page.waitForRequest(request => request.url().endsWith('/api/live/control')
    && request.method() === 'POST')
  await subtitles.click()
  expect((await sent).postDataJSON()).toMatchObject({ command: 'toggle-subtitles' })
  await expect(subtitles).toHaveAttribute('aria-pressed', 'true')
  state.subtitles_available = false; state.subtitles_visible = false
  await page.evaluate(value => renderRemoteState(value), state)
  await expect(subtitles).toBeDisabled()
})

test('inline iOS player Back consumes its history layer and restores the launching card', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    library.my_tv_library = [{
      path: 'Fixture film.mp4', display_name: 'Fixture film', browser_ready: true,
      metadata: { title: 'Fixture film', year: '2024' },
    }]
    history.replaceState({ consolidatedWatch: true }, '', '#watch')
    openWatchFilmSheet(library.my_tv_library[0])
    closeWatchFilmSheet(false)
    iosPlayerReturnTo = () => openWatchFilmSheet(library.my_tv_library[0])
    openIosPlayerHistoryLayer()
    $('#iosWatchPlayer').classList.remove('hidden')
  })
  await expect(page.locator('#watchFilmSheet')).not.toHaveJSProperty('open', true)
  await expect(page.locator('#iosWatchPlayer')).toBeVisible()
  expect(await page.evaluate(() => history.state?.mabelIosPlayer)).toBe(true)
  await page.locator('#iosWatchBack').click()
  await expect(page.locator('#iosWatchPlayer')).toBeHidden()
  await expect(page.locator('#watchFilmSheet')).toBeVisible()
  expect(await page.evaluate(() => history.state?.mabelIosPlayer || false)).toBe(false)
})

test('Mabel TV device player keeps taps and Back above the inline video layer', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone player interaction contract')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    document.body.style.minHeight = '300vh'
    window.scrollTo(0, 900)
    $('#mabelWatchPlayer').classList.remove('hidden', 'controls-visible')
    lockPortalPlayerScroll(false)
  })

  await expect(page.locator('body')).not.toHaveClass(/portal-player-fixed/)
  expect(await page.evaluate(() => document.body.style.top)).toBe('')
  await expect(page.locator('#mabelWatchVideo')).toHaveCSS('pointer-events', 'none')
  const screen = await page.locator('#mabelWatchScreen').boundingBox()
  await page.mouse.click(screen.x + screen.width / 2, screen.y + screen.height / 2)
  await expect(page.locator('#mabelWatchPlayer')).toHaveClass(/controls-visible/)

  const backReceivesTap = await page.locator('#mabelWatchBack').evaluate(button => {
    const box = button.getBoundingClientRect()
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('button') === button
  })
  expect(backReceivesTap).toBe(true)
  await page.locator('#mabelWatchBack').click()
  await expect(page.locator('#mabelWatchPlayer')).toBeHidden()
})

test('Mabel TV film playback closes its native dialog and restores it after Back', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('iphone-'), 'Phone player interaction contract')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => {
    library.remote_viewing = { allow_simultaneous: true, tv_running: false }
    const channel = library.channels.find(value => value.content_type === 'films')
    const programme = channel.programmes[0]
    programme.remote_position = 0
    openWatchProgrammeSheet(channel, programme)
    window.api = async path => {
      if (path === '/api/remote/start') return new Promise(() => {})
      return {}
    }
  })

  await expect(page.locator('#watchProgrammeSheet')).toHaveJSProperty('open', true)
  await page.locator('#watchProgrammeHere').click()
  await expect(page.locator('#mabelWatchPlayer')).toBeVisible()
  await expect(page.locator('#watchProgrammeSheet')).not.toHaveJSProperty('open', true)
  expect(await page.locator('dialog[open]').count()).toBe(0)

  await page.locator('#mabelWatchBack').click()
  await expect(page.locator('#mabelWatchPlayer')).toBeHidden()
  await expect(page.locator('#watchProgrammeSheet')).toHaveJSProperty('open', true)
})

test('device picture cycle preserves playback and queue identity without controlling the TV', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(async () => {
    library.tv_settings.tv_border = 'charcoal-90s'
    window.__pictureRequests = []
    window.api = async (path, options) => {
      window.__pictureRequests.push(path)
      return path === '/api/remote/start' ? {
        title: 'Fixture programme', stream_url: '/api/remote/media?stream=picture-test',
        resume_enabled: true,
      } : {}
    }
    const video = $('#mabelWatchVideo')
    video.load = () => {}
    video.play = () => Promise.resolve()
    video.pause = () => {}
    let source = ''
    Object.defineProperty(video, 'src', { configurable: true, get: () => source, set: value => { source = value } })
    Object.defineProperty(video, 'duration', { configurable: true, value: 600 })
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 125 })
    await startMabelWatchPlayer({ kind: 'channel', channel: 1, file: 'Fixture.mp4', queue_id: 'queued-fixture' })
    window.__pictureBinding = video._mabelQueue
    window.__pictureSource = video.src
  })
  const player = page.locator('#mabelWatchPlayer')
  const screen = page.locator('#mabelWatchScreen')
  const button = page.locator('[data-mabel-watch-action="presentation"]')
  for (const viewport of [{ width: 393, height: 852 }, { width: 852, height: 393 }]) {
    await page.setViewportSize(viewport)
    for (const [mode, label, ratio] of [['standard', 'Widescreen', 4 / 3], ['widescreen', 'Full screen', 16 / 9], ['fullscreen', 'Standard', viewport.width / viewport.height]]) {
      await expect(player).toHaveAttribute('data-presentation', mode)
      await expect(button).toHaveText(label)
      const bounds = await screen.boundingBox()
      const picture = await page.locator('#mabelWatchVideo').boundingBox()
      const geometry = await screen.evaluate(node => {
        const style = getComputedStyle(node)
        return { width: style.width, height: style.height, aspect: style.aspectRatio, box: style.boxSizing, border: style.borderWidth,
          video: { width: getComputedStyle(node.querySelector('video')).width, height: getComputedStyle(node.querySelector('video')).height } }
      })
      expect(Math.abs(picture.width / picture.height - ratio), `${mode}: ${JSON.stringify({ picture, geometry })}`).toBeLessThan(0.04)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
      if (mode !== 'fullscreen') {
        const brand = await page.locator('.mabel-watch-charcoal-logo').boundingBox()
        expect(brand.y).toBeGreaterThanOrEqual(bounds.y + bounds.height + 4)
      }
      await expect(page.locator('.mabel-watch-charcoal-control')).toBeHidden()
      if (process.env.MABEL_PICTURE_REVIEW && testInfo.project.name === 'iphone-webkit') {
        await page.screenshot({ path: `../../work/device-picture-20261007/${viewport.width}-${mode}.png` })
      }
      expect(await button.evaluate(node => {
        const box = node.getBoundingClientRect()
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === node
      }), `${mode} control at ${viewport.width}px`).toBe(true)
      await button.click()
      expect(await page.evaluate(() => $('#mabelWatchVideo').currentTime)).toBe(125)
      expect(await page.evaluate(() => $('#mabelWatchVideo').src === window.__pictureSource
        && $('#mabelWatchVideo')._mabelQueue === window.__pictureBinding)).toBe(true)
    }
  }
  await button.click()
  await page.evaluate(async () => {
    await startMabelWatchPlayer({ kind: 'channel', channel: 1, file: 'Next.mp4', queue_id: 'queued-next' })
  })
  await expect(player).toHaveAttribute('data-presentation', 'widescreen')
  expect(await page.evaluate(() => window.__pictureRequests.filter(path => path === '/api/remote/start').length)).toBe(2)
  expect(await page.evaluate(() => window.__pictureRequests.some(path => path.includes('/live/') || path === '/api/manage'))).toBe(false)
  await page.locator('#mabelWatchBack').click()
  await expect(player).toBeHidden()
})
