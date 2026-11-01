import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

function channel(number, name, folder, extra = {}) {
  return { number, name, folder, aspect: 'crop', content_type: 'shows', enabled: true,
    programmes: [], enabled_programmes: 0, metadata: {}, ...extra }
}

async function openChannelSettings(page, { reject = false, slow = false } = {}) {
  const channels = [channel(8, 'Photo Memories', 'memories', { enabled: false, content_type: 'memories' }),
    channel(1, 'Little Explorers', 'explorers'), channel(3, 'Family Films', 'films', { content_type: 'films' })]
  const writes = []
  await page.route('**/api/library', async route => {
    const response = await route.fetch()
    const data = await response.json()
    await route.fulfill({ json: { ...data, channels } })
  })
  await page.route('**/api/manage', async route => {
    const payload = route.request().postDataJSON()
    writes.push(payload)
    if (slow) await new Promise(resolve => setTimeout(resolve, 350))
    if (reject) return route.fulfill({ status: 400, json: { error: 'Finish or cancel channel uploads before changing the order' } })
    if (payload.action === 'reorder-channels') {
      payload.channels.forEach((item, index) => { channels.find(value => value.folder === item.folder).number = index + 1 })
    } else if (payload.action === 'add-channel') {
      channels.sort((a, b) => a.number - b.number).forEach((value, index) => { value.number = index + 1 })
      channels.push(channel(channels.length + 1, payload.name, payload.folder))
    }
    await route.fulfill({ json: { ok: true, refreshed: true } })
  })
  await page.goto('/#settings/mabel')
  await expect(page.locator('#view-settings-mabel')).toBeVisible()
  await page.getByRole('button', { name: /Channels and numbers/ }).click()
  await expect(page.locator('#view-settings-channels')).toBeVisible()
  return { channels, writes }
}

test('arrows save consecutive channel order with no editable numbers', async ({ page }) => {
  const { writes } = await openChannelSettings(page)
  await expect(page.locator('#channelNumbersList strong')).toHaveText(['Little Explorers', 'Family Films', 'Photo Memories'])
  await expect(page.locator('#channelNumbersList input')).toHaveCount(0)
  await expect(page.locator('#channelNumbersList .channel-number-badge')).toHaveText(['1', '3', '8'])
  await expect(page.getByRole('button', { name: 'Move Little Explorers up', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Move Photo Memories down', exact: true })).toBeDisabled()
  await expect(page.locator('[data-channel-folder="memories"]')).toContainText('Hidden from TV')
  await page.getByRole('button', { name: 'Move Photo Memories up', exact: true }).click()
  await expect(page.locator('#channelNumbersFeedback')).toHaveText('Photo Memories is now channel 2.')
  expect(writes).toEqual([{ action: 'reorder-channels', channels: [
    { folder: 'explorers', number: 1 }, { folder: 'memories', number: 8 }, { folder: 'films', number: 3 },
  ] }])
  await expect(page.locator('#channelNumbersList strong')).toHaveText(['Little Explorers', 'Photo Memories', 'Family Films'])
  await expect(page.locator('#channelNumbersList .channel-number-badge')).toHaveText(['1', '2', '3'])
  await page.getByRole('button', { name: 'Move Photo Memories down', exact: true }).click()
  await expect(page.locator('#channelNumbersFeedback')).toHaveText('Photo Memories is now channel 3.')
  await page.reload()
  await expect(page.locator('#view-settings-channels')).toBeVisible()
  await expect(page.locator('#channelNumbersList strong')).toHaveText(['Little Explorers', 'Family Films', 'Photo Memories'])
  await page.locator('#view-settings-channels .settings-back').click()
  await expect(page.locator('#view-settings-mabel')).toBeVisible()
})

test('failed moves keep the confirmed order and can be retried', async ({ page }) => {
  const { writes } = await openChannelSettings(page, { reject: true })
  await page.getByRole('button', { name: 'Move Little Explorers down', exact: true }).click()
  await expect(page.locator('#channelNumbersFeedback')).toContainText('Finish or cancel')
  await expect(page.locator('#channelNumbersList strong')).toHaveText(['Little Explorers', 'Family Films', 'Photo Memories'])
  await expect(page.locator('#channelNumbersList .channel-number-badge')).toHaveText(['1', '3', '8'])
  await expect(page.getByRole('button', { name: 'Move Little Explorers down', exact: true })).toBeEnabled()
  expect(writes).toHaveLength(1)
})

test('all arrows lock during a save and prevent overlapping moves', async ({ page }) => {
  const { writes } = await openChannelSettings(page, { slow: true })
  await page.getByRole('button', { name: 'Move Little Explorers down', exact: true }).click()
  await expect(page.locator('#channelNumbersList button:enabled')).toHaveCount(0)
  await page.evaluate(() => moveChannelInOrder('films', 1))
  await expect(page.locator('#channelNumbersFeedback')).toHaveText('Little Explorers is now channel 2.')
  expect(writes).toHaveLength(1)
})

test('creation assigns the next number with no manual override and recomputes on reopening', async ({ page }) => {
  const { writes } = await openChannelSettings(page)
  await page.locator('#channelNumbersAdd').click()
  await expect(page.locator('#newChannelNumber')).toHaveValue('4')
  await expect(page.locator('#newChannelNumber')).not.toBeEditable()
  await page.locator('#newChannelName').fill('New Adventures')
  await page.locator('#addChannelForm button[type="submit"]').click()
  await expect(page.locator('#addChannelPanel')).toBeHidden()
  expect(writes[0]).toMatchObject({ action: 'add-channel', name: 'New Adventures' })
  expect(writes[0]).not.toHaveProperty('number')
  await expect(page.locator('#channelNumbersList .channel-number-badge')).toHaveText(['1', '2', '3', '4'])
  await page.locator('#channelNumbersAdd').click()
  await expect(page.locator('#newChannelNumber')).toHaveValue('5')
  await page.locator('#cancelAddChannel').click()
  await page.locator('[data-view-button="watch"]').click()
  await page.locator('#watchNewChannel').click()
  await expect(page.locator('#newChannelNumber')).toHaveValue('5')
  await expect(page.locator('#newChannelNumber')).not.toBeEditable()
})

test('creation failures retain the name and automatic number', async ({ page }) => {
  await openChannelSettings(page, { reject: true })
  await page.locator('#channelNumbersAdd').click()
  await page.locator('#newChannelName').fill('New Adventures')
  await page.locator('#addChannelForm button[type="submit"]').click()
  await expect(page.locator('#addChannelPanel')).toBeVisible()
  await expect(page.locator('#newChannelName')).toHaveValue('New Adventures')
  await expect(page.locator('#newChannelNumber')).toHaveValue('4')
  await expect(page.locator('#newChannelError')).toContainText('Finish or cancel')
})

test('channel arrows phone and tablet presentation @visual', async ({ page }, testInfo) => {
  await openChannelSettings(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('channel-order-dark.png'), fullPage: true })
  await page.evaluate(() => window.MabelExperienceTheme.set('light'))
  await page.screenshot({ path: testInfo.outputPath('channel-order-light.png'), fullPage: true })
  await page.locator('#channelNumbersAdd').click()
  await page.screenshot({ path: testInfo.outputPath('channel-number-automatic.png') })
})
