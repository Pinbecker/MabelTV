import { test, expect } from './test-fixtures.mjs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { familyFixture, tapInContent } from './family-fixture.mjs'

test.use({ serviceWorkers: 'block' })

test('A book uploads all selected chapters as one ordered, resumable story', async ({ page }) => {
  const state = await familyFixture(page)
  state.stories = [{ id: 'zog', title: 'Zog', ready: false, audio: null, image: null }]
  const uploads = [], chunks = []
  // WebKit's intercepted XHR does not expose Blob postData. Inspect the actual
  // send argument without replacing the browser's transport.
  await page.evaluate(() => {
    window.chapterPackets = []
    const send = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.send = function(body) {
      if (body instanceof Blob) body.arrayBuffer().then(bytes => window.chapterPackets.push([...new Uint8Array(bytes)]))
      return send.call(this, body)
    }
  })
  await page.route('**/api/family-media/uploads', async route => {
    const upload = route.request().postDataJSON(); uploads.push(upload)
    await route.fulfill({ json: { id: 'chapters', offset: 0, transfer_state: 'active' } })
  })
  await page.route('**/api/uploads/chapters', async route => {
    expect(route.request().method()).toBe('PATCH')
    chunks.push(route.request().headers()['upload-offset'])
    await route.fulfill({ json: { id: 'chapters', offset: uploads[0].size, processing: true } })
  })
  await page.locator('#mabelChannelAudioTab').click()
  await tapInContent(page.locator('.family-story-card'))
  await expect(page.locator('#familyStoryAudio')).toHaveAttribute('multiple', '')
  await page.locator('#familyStoryAudio').setInputFiles([10, 2, 1].map(index => ({
    name: `Zog - ${index} - Chapter ${index}.mp3`, mimeType: 'audio/mpeg', buffer: Buffer.from(`Chapter ${index}`),
  })))
  await expect(page.locator('#familyUploadProgress strong')).toHaveText('Uploaded · preparing on the Pi')
  expect(uploads).toHaveLength(1); expect(chunks).toHaveLength(1)
  expect(uploads[0]).toMatchObject({ media_kind: 'audio', story_id: 'zog', title: 'Zog', file_name: 'Zog.story.zip' })
  await expect.poll(() => page.evaluate(() => window.chapterPackets.length)).toBe(1)
  const zip = Buffer.from(await page.evaluate(() => window.chapterPackets[0]))
  expect(zip.length).toBe(uploads[0].size)
  expect(zip.readUInt32LE(0)).toBe(0x04034b50)
  expect(zip.indexOf(Buffer.from('001-Zog - 1 - Chapter 1.mp3'))).toBeLessThan(zip.indexOf(Buffer.from('002-Zog - 2 - Chapter 2.mp3')))
  expect(zip.indexOf(Buffer.from('002-Zog - 2 - Chapter 2.mp3'))).toBeLessThan(zip.indexOf(Buffer.from('003-Zog - 10 - Chapter 10.mp3')))
})

test('Playlists create inline, reorder with arrows, confirm removal and remain reusable', async ({ page }) => {
  const state = await familyFixture(page)
  await page.locator('#mabelChannelPlaylistsTab').click()
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  await page.locator('#familyPromptInput').fill('Favourite afternoon')
  await page.locator('#familyPromptSave').click()
  await expect(page.locator('#view-mabel-playlist h1')).toHaveText('Favourite afternoon')
  for (let index = 0; index < 2; index++) {
    await page.evaluate(value => openWatchProgrammeSheet(library.channels[0], library.channels[0].programmes[value]), index)
    await page.locator('#watchProgrammeSheet .mabel-playlist-add').click()
    await page.locator('#playlistPickerChoices button').click()
    await expect(page.locator('#playlistPicker')).not.toBeVisible()
  }
  const rows = page.locator('.family-playlist-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.first().getByRole('button', { name: 'Move up', exact: true })).toBeDisabled()
  await tapInContent(rows.first().getByRole('button', { name: 'Move down', exact: true }))
  await expect(rows.first()).toContainText('Ocean Friends')
  await page.getByRole('checkbox', { name: 'Repeat playlist' }).evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.getByRole('checkbox', { name: 'Repeat playlist' }).check()
  await expect.poll(() => state.playlists[0].repeat).toBe(true)
  await page.getByRole('button', { name: 'Add to Up Next', exact: true }).click()
  await expect.poll(() => state.calls.some(value => value.action === 'append')).toBe(true)
  await expect(rows).toHaveCount(2)
  await tapInContent(rows.first().getByRole('button', { name: 'Remove Ocean Friends', exact: true }))
  await expect(page.locator('#familyConfirm')).toBeVisible()
  await expect(rows).toHaveCount(2)
  await page.locator('#familyConfirmAccept').click()
  await expect(rows).toHaveCount(1)
  await expect(page.locator('#mabelChannelPlaylists button button')).toHaveCount(0)
})

test('Creation forms remain above the keyboard and play-menu actions have a real gap', async ({ page }, info) => {
  await familyFixture(page)
  await page.evaluate(() => { MabelExperienceTheme.set('light'); MabelExperienceTheme.setAccentHue(169) })
  await page.locator('#mabelChannelPlaylistsTab').click()
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 360 })
    Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 58 })
    visualViewport.dispatchEvent(new Event('resize')); visualViewport.dispatchEvent(new Event('scroll'))
  })
  await expect.poll(() => page.locator('#familyPrompt').evaluate(dialog => dialog.style.getPropertyValue('--family-form-height'))).toBe('360px')
  const form = await page.locator('#familyPrompt').boundingBox()
  const formStyle = await page.locator('#familyPrompt').evaluate(dialog => {
    const style = getComputedStyle(dialog)
    return { top: style.top, height: style.height, minHeight: style.minHeight, inset: style.inset, transform: style.transform, position: style.position, inline: dialog.getAttribute('style') }
  })
  expect(form.y, JSON.stringify(formStyle)).toBeGreaterThanOrEqual(58); expect(form.y + form.height).toBeLessThanOrEqual(418)
  for (const id of ['familyPromptTitle', 'familyPromptInput', 'familyPromptSave']) {
    const bounds = await page.locator(`#${id}`).boundingBox()
    expect(bounds.y).toBeGreaterThanOrEqual(58); expect(bounds.y + bounds.height).toBeLessThanOrEqual(418)
  }
  const path = join('test-results', 'family-layout'); await mkdir(path, { recursive: true })
  await page.screenshot({ path: join(path, `${info.project.name}-keyboard-form.png`) })
  await page.locator('#familyPrompt [data-family-close]').click()
  await page.evaluate(() => { delete visualViewport.height; delete visualViewport.offsetTop })
  await page.evaluate(() => openWatchProgrammeSheet(library.channels[0], library.channels[0].programmes[0]))
  const gap = await page.locator('#watchProgrammeSheet .family-save-actions').evaluate(group => {
    const [first, second] = group.children
    return second.getBoundingClientRect().top - first.getBoundingClientRect().bottom
  })
  expect(gap).toBeGreaterThanOrEqual(8)
  await page.screenshot({ path: join(path, `${info.project.name}-programme-actions.png`), animations: 'disabled' })
  await page.locator('#watchProgrammeSheet .mabel-playlist-add').click()
  await expect(page.locator('#playlistPicker')).toBeVisible()
  await page.screenshot({ path: join(path, `${info.project.name}-playlist-picker.png`), animations: 'disabled' })
})

test('Failed memories still open Retry and confirmed Remove actions', async ({ page }) => {
  const state = await familyFixture(page)
  state.assets = [{ id: 'broken', title: 'Phone video', channel_number: 10, kind: 'video', status: 'error', can_retry: true, error: 'Decoder failed' }]
  await page.locator('#mabelChannelEpisodesTab').click()
  await tapInContent(page.getByRole('button', { name: 'Open channel 10, Family Videos', exact: true }))
  await tapInContent(page.locator('.family-memory-card'))
  await expect(page.locator('#familyMemoryPlay')).toBeDisabled()
  await expect(page.locator('#familyMemoryRetry')).toBeEnabled()
  await expect(page.locator('#familyMemoryStatus')).toContainText('original is safe')
  await page.locator('#familyMemoryRemove').click()
  await expect(page.locator('#familyConfirm')).toBeVisible()
  expect(state.assets).toHaveLength(1)
  await page.locator('#familyConfirmAccept').click()
  await expect(page.locator('.family-memory-card')).toHaveCount(0)
  await expect(page.locator('#familyConfirm')).not.toBeVisible()
})

test('Memories ignore old programme pagination and pending items can be removed', async ({ page }, info) => {
  const state = await familyFixture(page, 26)
  state.assets = Array.from({ length: 9 }, (_, index) => ({ id: `photo${index}`, title: `Photo ${index}`,
    channel_number: 10, kind: 'photo', status: index === 0 ? 'processing' : 'ready',
    artwork_url: index === 0 ? '' : `/api/family-media/content?id=photo${index}&artwork=1` }))
  await page.evaluate(() => openChannel(library.channels[0], true))
  await expect(page.locator('#programmePager')).toContainText('Showing 12 of 26')
  await page.evaluate(() => openChannel(library.channels.find(channel => channel.number === 10), true))
  await expect(page.locator('.family-memory-card')).toHaveCount(9)
  await expect(page.locator('#channelResultCount')).toHaveText('9 memories')
  await expect(page.locator('#workspaceProgrammeCount')).toHaveText('9')
  await expect(page.locator('#programmePager')).toBeHidden()
  await expect(page.locator('#programmePager')).toBeEmpty()
  await expect(page.getByRole('button', { name: 'Bring in existing channel files' })).toHaveCount(0)
  await page.locator('#programmeSearch').fill('Photo 0')
  await expect(page.locator('.family-memory-card')).toHaveCount(1)
  await tapInContent(page.locator('.family-memory-card'))
  await expect(page.locator('#familyMemoryRemove')).toBeEnabled()
  await page.locator('#familyMemoryRemove').click()
  await expect(page.locator('#familyConfirm')).toBeVisible()
  expect(state.assets).toHaveLength(9)
  await page.locator('#familyConfirmAccept').click()
  await expect(page.locator('.family-memory-card')).toHaveCount(0)
  await page.locator('#programmeSearch').fill('')
  await expect(page.locator('.family-memory-card')).toHaveCount(8)
  await expect(page.locator('#programmePager')).toBeHidden()
  const path = join('test-results', 'family-layout'); await mkdir(path, { recursive: true })
  await page.screenshot({ path: join(path, `${info.project.name}-memories-gallery-counter.png`), animations: 'disabled' })
})

test('Storybook opens in distinct stages, fills its spread and cancels cleanly @visual', async ({ page }, info) => {
  await familyFixture(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = function() { return Promise.resolve() }
    playFamilyStoryOnDevice({ id: 'preview', title: 'A little adventure', position_seconds: 50,
      audio: { media_url: '/__fixture/story.wav' },
      image: { media_url: '/api/family-media/content?id=illustration', artwork_url: '/api/family-media/content?id=illustration' } })
  })
  await expect(page.locator('#familyDevicePlayer')).toBeVisible()
  await expect(page.locator('#familyDeviceStart')).not.toBeVisible()
  await expect.poll(() => page.locator('#familyDeviceAudio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(1)
  await expect(page.locator('#familyDeviceMessage')).not.toBeVisible()
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.querySelectorAll('#familyDeviceBook img')].map(image => image.decode())]))
  const path = join('test-results', 'family-layout'); await mkdir(path, { recursive: true })
  await expect(page.locator('#familyDeviceBook .story-cover img')).toHaveCount(0)
  await expect(page.locator('#familyDeviceBook .story-leaf-back img')).toHaveCount(1)
  expect(await page.locator('#familyDeviceBook [id]').evaluateAll(elements => new Set(elements.map(element => element.id)).size)).toBe(5)
  for (const [name, time] of [['cover', 500], ['cover-opening', 3200], ['page-turn', 6500], ['leaf-back', 7200], ['landing', 8083], ['landed', 8084], ['spread', 8500]]) {
    await page.evaluate(time => {
      for (const animation of document.querySelector('#familyDeviceBook').getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = time }
    }, time)
    const surfaces = await page.evaluate(() => {
      const volume = document.querySelector('#familyDeviceBook .story-volume')
      return { clip: getComputedStyle(volume.querySelector(':scope > .story-spread')).clipPath,
        leaf: getComputedStyle(volume.querySelector('.story-leaf')).visibility,
        back: getComputedStyle(volume.querySelector('.story-leaf-back')).visibility,
        cover: getComputedStyle(volume.querySelector('.story-cover')).opacity,
        coverLayer: getComputedStyle(volume.querySelector('.story-cover')).zIndex,
        inside: getComputedStyle(volume.querySelector('.story-cover-inside')).visibility }
    })
    if (time < 8084) expect(surfaces.clip).toBe('inset(0px 0px 0px 50%)')
    else expect(surfaces.clip).toBe('inset(0px)')
    if (time === 7200) expect(surfaces.back).toBe('visible')
    expect(surfaces.cover).toBe('1')
    if (time >= 7200) { expect(surfaces.coverLayer).toBe('1'); expect(surfaces.inside).toBe('visible') }
    if (time >= 8084) expect(surfaces.leaf).toBe('hidden')
    await page.screenshot({ path: join(path, `${info.project.name}-storybook-${name}.png`) })
  }
  await expect(page.locator('#familyDeviceSkip')).toBeVisible()
  await page.locator('#familyDeviceSkip').click()
  await expect(page.locator('#familyDeviceBook')).toHaveClass(/opened/)
  await expect(page.locator('#familyDeviceBook .story-cover-inside')).toBeVisible()
  expect(await page.locator('#familyDeviceBook .story-cover').evaluate(cover => getComputedStyle(cover).opacity)).toBe('1')
  await expect(page.locator('#familyDeviceAudio')).toBeVisible()
  await page.locator('#familyDeviceClose').click()
  await expect(page.locator('#familyStoryCatalogue')).toBeVisible()
  await expect(page.locator('#familyDeviceBook')).not.toBeVisible()
  await page.locator('#familyDeviceClose').click()
  await expect(page.locator('#familyDevicePlayer')).not.toBeVisible()
  expect(await page.evaluate(() => familyBookCleanup)).toBe(null)
})

test('Storytime and Memories stay separate from numbered episode channels', async ({ page }, info) => {
  const state = await familyFixture(page)
  const audio = { id: 'audio', status: 'ready', duration: 1200, media_url: '/api/family-media/content?id=audio' }
  const image = { id: 'image', status: 'ready', artwork_url: '/api/family-media/content?id=image&artwork=1', media_url: '/api/family-media/content?id=image' }
  state.stories = [{ id: 'story', title: 'A little adventure', ready: true, audio, image, position_seconds: 50 }]
  state.assets = [{ ...image, id: 'photo', title: 'A family afternoon', channel_number: 10, kind: 'photo' }]
  await page.locator('#mabelChannelAudioTab').click()
  await expect(page.locator('.family-story-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Open Storytime', exact: true }).click()
  expect(state.calls).toEqual([])
  const path = join('test-results', 'storytime-device'); await mkdir(path, { recursive: true })
  await page.screenshot({ path: join(path, `${info.project.name}-destinations.png`), animations: 'disabled' })
  await page.locator('#familyStorytimeTv').click()
  await expect(page.locator('#familyStorytimeSheet')).not.toBeVisible()
  await expect.poll(() => state.calls.some(value => value.action === 'open-storytime')).toBe(true)
  await tapInContent(page.locator('.family-story-card'))
  await expect(page.locator('#familyStoryTv')).toBeEnabled()
  await page.locator('#familyStoryTv').click()
  await expect.poll(() => state.calls.some(value => value.kind === 'storytime' && value.id === 'story')).toBe(true)
  await page.locator('#mabelChannelEpisodesTab').click()
  await tapInContent(page.getByRole('button', { name: 'Open channel 10, Family Videos', exact: true }))
  await expect(page.locator('.family-memory-card')).toHaveCount(1)
  await page.locator('#channelWatchTv').click()
  await page.locator('#familyMemoryPlaybackSettings').click()
  await page.locator('#memoryOrder').selectOption('ordered')
  await page.locator('#memorySettingsSave').click()
  await expect.poll(() => state.memory_settings[0]?.ordering).toBe('ordered')
  await tapInContent(page.locator('.family-memory-card'))
  await page.locator('#familyMemoryPlay').click()
  await expect.poll(() => state.calls.some(value => value.kind === 'memories' && value.id === 'photo')).toBe(true)
  await page.locator('#backToChannels').click()
  await expect(page.locator('.mabel-channel-toggle button')).toHaveText(['Episodes', 'Films', 'Playlists', 'Stories'])
  await expect(page.locator('.mabel-episode-channel-grid')).not.toContainText('Family Videos')
})

test('Compact playlists fit the phone and tablet with independent row controls @visual', async ({ page }, info) => {
  const state = await familyFixture(page)
  state.playlists = [{ id: 'afternoon', name: 'A favourite afternoon', repeat: true, duration: 2700,
    items: ['Snowy Adventure', 'Ocean Friends', 'The Gruffalo Trail'].map((title, index) => ({
      id: `item${index}`, title, channel_number: 1, channel_name: 'Family Films', file_name: `${title}.mp4`,
      available: true, artwork: 'fixture.jpg', duration: 900 })) }]
  await page.locator('#mabelChannelPlaylistsTab').click()
  await page.locator('#mabelChannelPlaylists .family-playlist-card').click()
  const rows = page.locator('.family-playlist-row')
  await expect(rows).toHaveCount(3)
  const geometry = await rows.first().evaluate(row => ({ height: row.offsetHeight,
    width: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(geometry.height).toBeLessThan(120)
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport)
  const backAlignment = await page.locator('.family-back').evaluate(button => Math.abs(button.getBoundingClientRect().left - button.parentElement.getBoundingClientRect().left))
  expect(backAlignment).toBeLessThan(1)
  const tabs = await page.locator('.mabel-channel-toggle button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top))
  expect(new Set(tabs).size).toBe(1)
  await expect(page.locator('#familyUploadProgress')).not.toBeVisible()
  const path = join('test-results', 'family-layout')
  await mkdir(path, { recursive: true })
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { MabelExperienceTheme.set(value); MabelExperienceTheme.setAccentHue(169) }, theme)
    await page.screenshot({ path: join(path, `${info.project.name}-${theme}-playlists.png`), fullPage: true, animations: 'disabled' })
  }
})

test('Playlist posters and Storytime illustrations fill their library cards @visual', async ({ page }, info) => {
  const state = await familyFixture(page)
  state.playlists = [{ id: 'afternoon', name: 'After School', repeat: false, duration: 1508,
    items: [{ id: 'first', title: 'Room on the Broom', channel_number: 6, channel_name: 'Julia Donaldson',
      file_name: 'Room on the Broom.mp4', available: true, artwork: 'fixture.jpg', duration: 1508 }] }]
  state.stories = [{ id: 'story', title: 'Gruffalo', ready: true, position_seconds: 15,
    audio: { status: 'ready', duration: 784 }, image: { status: 'ready', artwork_url: '/api/family-media/content?id=image' } }]
  await page.evaluate(() => { MabelExperienceTheme.set('light'); MabelExperienceTheme.setAccentHue(169) })
  const path = join('test-results', 'family-layout'); await mkdir(path, { recursive: true })
  for (const [tab, selector, name] of [['#mabelChannelPlaylistsTab', '.family-playlist-art', 'playlist-library'],
    ['#mabelChannelAudioTab', '.family-story-art', 'storytime-library']]) {
    await page.locator(tab).click()
    const art = page.locator(selector).first()
    await art.locator('img').evaluate(image => image.decode())
    const bounds = await art.evaluate(art => {
      const frame = art.getBoundingClientRect(), image = art.querySelector('img').getBoundingClientRect()
      return { frame: { width: frame.width, height: frame.height }, image: { width: image.width, height: image.height } }
    })
    if (tab === '#mabelChannelPlaylistsTab') {
      expect(bounds.image.width).toBeLessThanOrEqual(bounds.frame.width)
      expect(bounds.image.height).toBeLessThanOrEqual(bounds.frame.height)
      await expect(art).toHaveClass(/is-stack/)
    } else {
      expect(Math.abs(bounds.frame.width - bounds.image.width)).toBeLessThan(1)
      expect(Math.abs(bounds.frame.height - bounds.image.height)).toBeLessThan(1)
    }
    await page.screenshot({ path: join(path, `${info.project.name}-${name}.png`), animations: 'disabled' })
  }
})

test('Manage Channel uses compact choices and opens without forcing the keyboard @visual', async ({ page }, info) => {
  await familyFixture(page)
  await page.evaluate(() => { MabelExperienceTheme.set('light'); MabelExperienceTheme.setAccentHue(169) })
  await page.locator('#mabelChannelEpisodesTab').click()
  await tapInContent(page.getByRole('button', { name: 'Open channel 10, Family Videos', exact: true }))
  await page.locator('#workspaceSettings').click()
  await expect(page.locator('#channelSettingsSheet')).toBeVisible()
  expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT')
  await expect(page.locator('#editChannelForm input[name="channelContent"][value="memories"]')).toBeChecked()
  await page.getByRole('radio', { name: 'Whole picture', exact: true }).check()
  expect(await page.locator('#editChannelAspect').inputValue()).toBe('fit')
  const sheet = await page.locator('#channelSettingsSheet').boundingBox()
  expect(sheet.width).toBeLessThanOrEqual(page.viewportSize().width)
  const path = join('test-results', 'family-layout'); await mkdir(path, { recursive: true })
  await page.screenshot({ path: join(path, `${info.project.name}-manage-channel.png`), animations: 'disabled' })
})

test('Device memories advance as a complete sequence, pause photos and never control the TV', async ({ page }) => {
  const state = await familyFixture(page)
  state.assets = [1, 2, 3, 4].map(id => ({ id: `memory${id}`, title: `Memory ${id}`, kind: id === 3 ? 'video' : 'photo',
    channel_number: 10, status: 'ready', media_url: `/api/family-media/content?id=memory${id}`,
    artwork_url: `/api/family-media/content?id=memory${id}&artwork=1` }))
  const session = { id: 'device-session', kind: 'memories', settings: {}, scenes: [
    { kind: 'photo', seconds: 5, title: 'Together', items: state.assets.slice(0, 2).map(item => ({ ...item, source: item.media_url })) },
    { kind: 'video', title: 'Phone video', items: [{ id: 'memory3', source: '/__fixture/story.wav' }] },
    { kind: 'photo', seconds: 5, title: 'Afternoon', items: [{ id: 'memory4', source: '/api/family-media/content?id=memory4' }] },
  ] }
  const starts = [], tv = []
  await page.route('**/api/family-media/start', async route => {
    starts.push(route.request().postDataJSON()); await route.fulfill({ json: session })
  })
  await page.route('**/api/remote*', async route => { tv.push(route.request().url()); await route.fulfill({ json: { ok: true } }) })
  await page.locator('#mabelChannelEpisodesTab').click()
  await tapInContent(page.getByRole('button', { name: 'Open channel 10, Family Videos', exact: true }))
  await page.clock.install()
  await page.locator('#channelWatchTv').click()
  await page.locator('#familyMemoryPlaybackDevice').click()
  await expect(page.locator('#familyDeviceMemoryCount')).toHaveText('1 of 3')
  await expect(page.locator('.family-memory-device-frame.is-current .family-memory-photo img')).toHaveCount(2)
  expect(starts[0]).toEqual({ kind: 'memories', channel: 10, target: 'device' })
  await page.getByRole('button', { name: 'Pause memories', exact: true }).click()
  await page.clock.runFor(6000)
  await expect(page.locator('#familyDeviceMemoryCount')).toHaveText('1 of 3')
  await page.locator('#familyDeviceMemoryToggle').click()
  await page.clock.runFor(5200)
  await expect(page.locator('#familyDeviceMemoryCount')).toHaveText('2 of 3')
  await expect(page.locator('#familyDeviceVideo')).toBeVisible()
  await page.locator('#familyDeviceVideo').evaluate(video => video.dispatchEvent(new Event('ended')))
  await expect(page.locator('#familyDeviceMemoryCount')).toHaveText('3 of 3')
  await page.locator('#familyDeviceClose').click()
  await page.clock.runFor(15000)
  expect(starts).toHaveLength(1); expect(tv).toHaveLength(0)
  expect(await page.evaluate(() => familyDeviceMemories)).toBe(null)
})

test('Audio, confirmations and memory channels render as complete app screens @visual', async ({ page }, info) => {
  const state = await familyFixture(page)
  const audio = { id: 'audio', status: 'ready', duration: 1200, media_url: '/api/family-media/content?id=audio' }
  const image = { id: 'image', status: 'ready', artwork_url: '/api/family-media/content?id=image&artwork=1', media_url: '/api/family-media/content?id=image' }
  state.stories = [{ id: 'story', title: 'A little adventure', ready: true, audio, image, position_seconds: 50 }]
  state.assets = [1, 2, 3, 4].map(id => ({ ...image, id: `photo${id}`, title: `A family afternoon ${id}`, channel_number: 10, kind: 'photo' }))
  const path = join('test-results', 'family-layout'); await mkdir(path, { recursive: true })
  async function capture(name) {
    await page.evaluate(() => Promise.all([...document.querySelectorAll('.view.active img,dialog[open] img')]
      .filter(image => image.getBoundingClientRect().width > 0)
      .map(image => { image.loading = 'eager'; return image.decode().catch(() => {}) })))
    await page.screenshot({ path: join(path, `${info.project.name}-${name}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.evaluate(() => { MabelExperienceTheme.set('light'); MabelExperienceTheme.setAccentHue(169) })
  await page.locator('#mabelChannelAudioTab').click()
  await capture('audio')
  await tapInContent(page.locator('.family-story-card'))
  await capture('story-actions')
  await page.locator('#familyStoryDelete').click()
  await expect(page.locator('#familyConfirm')).toBeVisible()
  await capture('confirmation')
  await page.locator('#familyConfirm [data-family-close]').click()
  await page.locator('#mabelChannelEpisodesTab').click()
  await tapInContent(page.getByRole('button', { name: 'Open channel 10, Family Videos', exact: true }))
  await expect(page.locator('.family-memory-card')).toHaveCount(4)
  await capture('memory-gallery')
  await page.locator('#channelWatchTv').click()
  await capture('memory-destinations')
  await page.locator('#familyMemoryPlaybackSettings').click()
  await capture('memory-settings')
})

test('Memory compositions adapt, preserve whole photos and freeze their motion when paused @visual', async ({ page }, info) => {
  const state = await familyFixture(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  let catalogue = []
  if (process.env.MEMORY_PREVIEW_ASSETS) {
    catalogue = JSON.parse(await readFile(join(process.env.MEMORY_PREVIEW_ASSETS, 'catalogue.json'), 'utf8'))
    await page.route('**/api/family-media/content?*', async route => {
      const index = Number(new URL(route.request().url()).searchParams.get('id').replace('memory', '')) - 1
      await route.fulfill({ contentType: 'image/jpeg', body: await readFile(join(process.env.MEMORY_PREVIEW_ASSETS, catalogue[index % catalogue.length].preview_file)) })
    })
  }
  state.assets = [1, 2, 3].map((id, index) => ({ id: `memory${id}`, title: 'A family afternoon', kind: 'photo',
    channel_number: 10, status: 'ready', width: catalogue[index]?.width || 1200, height: catalogue[index]?.height || 800,
    media_url: `/api/family-media/content?id=memory${id}`, artwork_url: `/api/family-media/content?id=memory${id}` }))
  const items = state.assets.map(item => ({ ...item, source: item.media_url }))
  const boxes = [{ x: .02, y: .025, width: .60, height: .95 }, { x: .65, y: .025, width: .33, height: .455 },
    { x: .65, y: .52, width: .33, height: .455 }]
  const portraitBoxes = [{ x: .02, y: .02, width: .96, height: .57 }, { x: .02, y: .62, width: .465, height: .36 },
    { x: .515, y: .62, width: .465, height: .36 }]
  await page.route('**/api/family-media/start', route => route.fulfill({ json: {
    id: 'composition', kind: 'memories', settings: {}, scenes: [{ kind: 'photo', layout: 'feature', transition: 'rise',
      seconds: 30, items, frames: boxes, portrait_frames: portraitBoxes }],
  } }))
  await page.locator('#mabelChannelEpisodesTab').click()
  await tapInContent(page.getByRole('button', { name: 'Open channel 10, Family Videos', exact: true }))
  await expect(page.locator('.family-memory-toolbar')).toHaveCount(0)
  await page.locator('#channelWatchTv').click()
  await expect(page.locator('#familyMemoryPlaybackSheet')).toBeVisible()
  await page.locator('#familyMemoryPlaybackDevice').click()
  if (process.env.MEMORY_PREVIEW_TV) await page.setViewportSize({ width: 1920, height: 1080 })
  const photos = page.locator('.family-memory-device-frame.is-current .family-memory-photo img')
  await expect(photos).toHaveCount(3)
  await photos.evaluateAll(images => Promise.all(images.map(image => image.decode())))
  await expect.poll(() => page.locator('.family-memory-device-frame.is-current').evaluate(frame => frame.getAnimations()[0]?.currentTime || 0)).toBeGreaterThan(1150)
  await page.getByRole('button', { name: 'Pause memories', exact: true }).click()
  const inspect = () => page.locator('#familyDeviceMemoryStage').evaluate(stage => {
    const bound = stage.getBoundingClientRect()
    const images = [...stage.querySelectorAll('.is-current .family-memory-photo img')]
    return { times: stage.getAnimations({ subtree: true }).map(animation => animation.currentTime),
      fits: images.map(image => { const box = image.getBoundingClientRect(); return box.left >= bound.left && box.right <= bound.right && box.top >= bound.top && box.bottom <= bound.bottom && getComputedStyle(image).objectFit === 'contain' }) }
  })
  const before = await inspect()
  await page.waitForTimeout(250)
  const after = await inspect()
  expect(after.times).toEqual(before.times)
  expect(after.fits).toEqual([true, true, true])
  const path = join('test-results', 'family-layout'); await mkdir(path, { recursive: true })
  await page.screenshot({ path: join(path, `${info.project.name}${process.env.MEMORY_PREVIEW_TV ? '-tv' : ''}-memories-composition.png`) })
  await page.locator('#familyDeviceClose').click()
  expect(await page.locator('#familyDeviceMemoryStage').evaluate(stage => stage.getAnimations({ subtree: true }).length)).toBe(0)
})
