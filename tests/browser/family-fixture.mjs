import { expect } from './test-fixtures.mjs'
import { readFile } from 'node:fs/promises'

async function tapInContent(locator) {
  // Scroll like a parent browsing the list, clear of the fixed phone nav.
  await locator.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await locator.click()
}

async function familyFixture(page, legacyProgrammeCount = 0) {
  const state = { playlists: [], calls: [], assets: [], stories: [], memory_settings: [] }
  let itemSequence = 0
  const illustration = await readFile(new URL('../qml/story-illustration.svg', import.meta.url), 'utf8')
  const poster = process.env.FAMILY_PREVIEW_POSTER ? await readFile(process.env.FAMILY_PREVIEW_POSTER) : illustration
  const picture = process.env.FAMILY_PREVIEW_ARTWORK ? await readFile(process.env.FAMILY_PREVIEW_ARTWORK) : illustration
  await page.route('**/api/channel/artwork/fixture*.jpg', route => route.fulfill({ contentType: process.env.FAMILY_PREVIEW_POSTER ? 'image/jpeg' : 'image/svg+xml', body: poster }))
  const catalogue = await (await page.request.get('/api/library')).json()
  const legacyProgrammes = Array.from({ length: legacyProgrammeCount }, (_, index) => ({
    ...catalogue.channels[0].programmes[0], name: `old-${index}.mov`, display_name: `Old video ${index}`,
  }))
  if (legacyProgrammeCount) Object.assign(catalogue.channels[0], { programmes: legacyProgrammes, content_type: 'shows' })
  catalogue.channels.push({ number: 10, name: 'Family Videos', folder: 'Family', aspect: 'fit',
    content_type: 'memories', enabled: true, programmes: legacyProgrammes, metadata: {} })
  await page.route('**/api/library', route => route.fulfill({ json: catalogue }))
  await page.route('**/api/mabel-playlists', async route => {
    let id = ''
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      state.calls.push(body)
      id = body.id || `playlist${state.playlists.length}`
      const saved = state.playlists.find(item => item.id === id)
      if (body.action === 'create') state.playlists.push({ id, name: body.name, repeat: false, items: [], duration: 0 })
      if (body.action === 'rename') saved.name = body.name
      if (body.action === 'repeat') saved.repeat = body.repeat
      if (body.action === 'add') {
        const channel = catalogue.channels.find(value => value.number === body.channel)
        const programme = channel.programmes.find(value => value.name === body.file)
        saved.items.push({ id: `item${itemSequence++}`, channel_number: channel.number, channel_name: channel.name,
          file_name: body.file, title: programme.display_name, artwork: 'fixture.jpg', available: true, duration: 1200 })
      }
      if (['up', 'down'].includes(body.action)) {
        const index = saved.items.findIndex(value => value.id === body.item_id)
        const target = index + (body.action === 'up' ? -1 : 1)
        ;[saved.items[index], saved.items[target]] = [saved.items[target], saved.items[index]]
      }
      if (body.action === 'remove') saved.items = saved.items.filter(item => item.id !== body.item_id)
    }
    await route.fulfill({ json: { ok: true, id, playlists: state.playlists } })
  })
  await page.route('**/api/family-media', async route => {
    let id = ''
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); state.calls.push(body)
      if (body.action === 'story-create') {
        id = `story${state.stories.length}`
        state.stories.push({ id, title: body.title, ready: false, position_seconds: 0, audio: null, image: null })
      }
      if (body.action === 'memory-settings') state.memory_settings = [{ channel_number: body.channel, ...body }]
      if (body.action === 'remove') state.assets = state.assets.filter(item => item.id !== body.id)
      if (body.action === 'retry') Object.assign(state.assets.find(item => item.id === body.id), { status: 'uploading', can_retry: false })
    }
    await route.fulfill({ json: { ...state, ok: true, id } })
  })
  await page.route('**/api/family-media/start', async route => {
    state.calls.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true, id: 'session' } })
  })
  await page.route('**/api/family-media/control', async route => {
    state.calls.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/family-media/content?*', route => route.fulfill({ contentType: process.env.FAMILY_PREVIEW_ARTWORK ? 'image/jpeg' : 'image/svg+xml', body: picture }))
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.locator('[data-view-button="watch"]').click()
  return state
}

export { familyFixture, tapInContent }
