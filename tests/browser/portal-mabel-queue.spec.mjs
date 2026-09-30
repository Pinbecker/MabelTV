import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

test('Mabel TV Up Next appears on Home and reorders through arrow controls', async ({ page }) => {
  await page.request.post('/api/mabel-queue', {
    data: { action: 'add', channel: 1, file: 'Snowy Adventure.mp4' },
  })
  await page.request.post('/api/mabel-queue', {
    data: { action: 'add', channel: 1, file: 'Ocean Friends.mp4' },
  })
  await page.goto('/')
  await expect(page.locator('#homeMabelQueueSection')).toBeVisible()
  await expect(page.locator('#homeMabelQueueRail .mabel-queue-rail-card')).toHaveCount(3)
  await page.locator('#homeMabelQueueOpen').click()
  await expect(page.locator('#view-mabel-queue')).toBeVisible()
  const rows = page.locator('#mabelQueueList .mabel-queue-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Snowy Adventure')
  await page.getByRole('button', { name: 'Move Ocean Friends up' }).click()
  await expect(rows.first()).toContainText('Ocean Friends')
  await page.locator('#mabelQueueKeepPlaying').click()
  await expect(page.locator('#mabelQueueKeepPlaying')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#mabelQueueEndingHint')).toContainText('carries on naturally')
  await page.reload()
  await expect(page.locator('#view-mabel-queue')).toBeVisible()
  await expect(rows.first()).toContainText('Ocean Friends')
  await expect(page.locator('#mabelQueueKeepPlaying')).toHaveAttribute('aria-pressed', 'true')
})

test('Empty queue stays discoverable and queued cards open the usual programme sheet', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#homeMabelQueueSection')).toBeVisible()
  await expect(page.locator('#homeMabelQueueEmpty')).toBeVisible()
  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#watchMabelQueueEmpty')).toBeVisible()
  await page.locator('#watchMabelQueueEmpty').click()
  await expect(page.locator('#view-mabel-queue')).toBeVisible()
  await expect(page.locator('#mabelQueueList')).toContainText('Open an episode or film')

  await page.request.post('/api/mabel-queue', {
    data: { action: 'add', channel: 1, file: 'Snowy Adventure.mp4' },
  })
  await page.reload()
  await page.locator('#mabelQueueBack').click()
  await page.locator('#watchMabelQueueRail .mabel-queue-rail-card').first().click()
  await expect(page.locator('#watchProgrammeSheet')).toBeVisible()
  await expect(page.locator('#watchProgrammeSheet')).toContainText('Snowy Adventure')
})

test('Removing a programme and clearing the queue both require confirmation', async ({ page }) => {
  for (const file of ['Snowy Adventure.mp4', 'Ocean Friends.mp4']) {
    await page.request.post('/api/mabel-queue', { data: { action: 'add', channel: 1, file } })
  }
  await page.goto('/#mabel-queue')
  const rows = page.locator('#mabelQueueList .mabel-queue-row')
  await expect(rows).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove Snowy Adventure from Up Next' }).click()
  await expect(page.locator('#mabelQueueConfirm')).toBeVisible()
  await expect(page.locator('#mabelQueueConfirmTitle')).toHaveText('Remove “Snowy Adventure”?')
  await page.locator('#mabelQueueConfirmCancel').click()
  await expect(rows).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove Snowy Adventure from Up Next' }).click()
  await page.locator('#mabelQueueConfirmAccept').click()
  await expect(rows).toHaveCount(1)
  await page.locator('#mabelQueueClear').click()
  await expect(page.locator('#mabelQueueConfirmTitle')).toHaveText('Clear the whole queue?')
  await page.locator('#mabelQueueConfirmCancel').click()
  await expect(rows).toHaveCount(1)
  await page.locator('#mabelQueueClear').click()
  await page.locator('#mabelQueueConfirmAccept').click()
  await expect(rows).toHaveCount(0)
  await expect(page.locator('#mabelQueueConfirm')).toBeHidden()
})
