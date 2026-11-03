import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

async function studio(page, { offline = false, series = false, fail = false, pending = false } = {}) {
  const writes = [], requests = new Map(), jobs = []
  const hash = 'a'.repeat(40), title = series ? 'Ludwig Complete Series' : 'Big Buck Bunny 2008 1080p'
  const cloud = { configured: true, checked: 1793530000, count: 0, scanning: false, error: '', root: 'Media' }
  await page.route('**/api/studio/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null
    if (body) writes.push({ path, ...body })
    let json = {}
    if (path === '/api/studio/status') json = { workers: offline ? [] : [{ id: '1'.repeat(32), name: 'XPS', online: true, capabilities: ['torrent'] }], jobs, cloud, cloudOperations: [] }
    else if (path === '/api/studio/cloud') json = { ...cloud, items: [], total: 0 }
    else if (path === '/api/studio/torrents/search') {
      json = { id: 'search', kind: 'torrent-search', status: offline || pending ? 'queued' : fail ? 'failed' : 'complete', error: fail ? 'Search is temporarily unavailable. Try again.' : '', result: { items: [{ hash, title, bytes: 1024 ** 3, seeders: 120 }] } }
      requests.set(json.id, json)
    } else if (path === '/api/studio/torrents/inspect') {
      const files = series ? [{ index: 0, path: 'Ludwig/Ludwig.S00E01.mkv', series: 0, episodeNumber: 1, bytes: 123456 }, { index: 1, path: 'Ludwig/Ludwig.S02E01.mkv', series: 2, episodeNumber: 1, bytes: 123456 }]
        : [{ index: 0, path: 'Big.Buck.Bunny.2008.mkv', bytes: 1024 ** 3 }]
      files.push({ index: 9, path: 'Unwanted.exe', bytes: 20 })
      json = { id: 'inspection', kind: 'torrent-inspect', status: pending ? 'queued' : 'complete', result: { hash, title, files } }; requests.set(json.id, json)
    } else if (path === '/api/studio/request') json = requests.get(url.searchParams.get('id'))
    else if (path === '/api/studio/jobs') {
      jobs.push({ id: 'job', title, source: { type: 'torrent' }, destination: { ...body.destination, label: 'iCloud' }, status: 'queued', stage: 'queued', percent: 0, created: 1793530000 })
      json = { ok: true, ids: ['job'] }
    }
    await route.fulfill({ json })
  })
  await page.goto('/#my-tv-studio/torrents')
  await expect(page.locator('#studioTorrentPane')).toBeVisible()
  await page.locator('#studioTorrentSearch').fill(series ? 'Ludwig' : 'Big Buck Bunny')
  await page.locator('#studioTorrentSearchForm').evaluate(form => form.requestSubmit())
  return { writes, requests, hash }
}

test('search and file inspection keep animated loading feedback until their results arrive', async ({ page }, info) => {
  const { requests, writes } = await studio(page, { pending: true })
  await expect(page.locator('#studioTorrentResults')).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.studio-search-loading .studio-spinner')).toBeVisible()
  await page.screenshot({ path: info.outputPath('studio-search-loading.png'), animations: 'disabled' })
  requests.get('search').status = 'complete'
  await expect(page.locator('.studio-torrent-result')).toBeVisible()
  await page.locator('.studio-torrent-result').click()
  await expect(page.locator('.studio-torrent-result')).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.studio-torrent-result .studio-spinner')).toBeVisible()
  await expect(page.locator('.studio-torrent-result')).toBeDisabled()
  await page.screenshot({ path: info.outputPath('studio-inspection-loading.png'), animations: 'disabled' })
  requests.get('inspection').status = 'complete'
  await expect(page.locator('#studioTorrentSheet')).toBeVisible()
  expect(writes.filter(write => write.path === '/api/studio/torrents/inspect')).toHaveLength(1)
})

test('Find anything reviews a video and offers Original Optimised and Both without a Download destination', async ({ page }, info) => {
  const { writes } = await studio(page)
  await expect(page.locator('.studio-torrent-result')).toHaveCount(1)
  await expect(page.locator('.studio-torrent-result')).toContainText('120 seeders')
  await page.screenshot({ path: info.outputPath('studio-find-anything.png'), fullPage: true })
  await page.locator('.studio-torrent-result').click()
  await expect(page.locator('#studioTorrentSheet')).toBeVisible()
  await expect(page.locator('#studioTorrentFiles label')).toHaveCount(1)
  await expect(page.locator('#studioTorrentFiles')).not.toContainText('Unwanted')
  expect(writes.some(write => write.path === '/api/studio/jobs')).toBe(false)
  await page.locator('#studioTorrentContinue').click()
  await expect(page.locator('#studioDestinationSheet')).toBeVisible()
  await expect(page.locator('.studio-destination-choices')).not.toContainText('Download')
  await expect(page.locator('input[name="studioCloudCopies"]')).toHaveCount(3)
  await page.locator('input[name="studioDestination"][value="icloud"]').locator('..').click()
  await page.locator('input[name="studioCloudCopies"][value="both"]').locator('..').click()
  await expect(page.locator('#studioCloudReplaceWarning')).toBeHidden()
  await page.screenshot({ path: info.outputPath('studio-download-cloud-choices.png'), fullPage: true })
  await page.locator('#studioDestinationSubmit').click()
  const submitted = writes.find(write => write.path === '/api/studio/jobs')
  expect(submitted.sources).toMatchObject([{ type: 'torrent', request: 'inspection', files: [0] }])
  expect(submitted.destination).toMatchObject({ kind: 'icloud', cloudCopies: 'both', prepare: true, saveCloud: true, keepOptimised: false })
  expect(submitted.replaceCloudOriginal).toBe(false)
  await expect(page.locator('#studioActivityPane')).toBeVisible()
})

test('season packs stay grouped and selection preserves specials and selected seasons', async ({ page }, info) => {
  const { writes } = await studio(page, { series: true })
  await expect(page.locator('.studio-torrent-result')).toHaveCount(1)
  await page.locator('.studio-torrent-result').click()
  await page.locator('#studioTorrentSeason').selectOption('0')
  await page.locator('#studioTorrentAll').click()
  await page.locator('#studioTorrentSeason').selectOption('2')
  await page.locator('#studioTorrentAll').click()
  await expect(page.locator('#studioTorrentSelected')).toContainText('2 selected')
  await page.screenshot({ path: info.outputPath('studio-download-seasons.png'), fullPage: true })
  await page.locator('#studioTorrentContinue').click()
  await expect(page.locator('#studioLibraryType')).toHaveValue('series')
  await expect(page.locator('#studioSeason')).toHaveValue('0')
  await page.locator('#studioDestinationSubmit').click()
  const submitted = writes.find(write => write.path === '/api/studio/jobs')
  expect(submitted.sources[0].files).toEqual([0, 1])
  expect(submitted.destination).toMatchObject({ kind: 'series', preserveSeasons: true, season: 0 })
})

test('a search waits safely offline and produces results after Studio reconnects', async ({ page }) => {
  const { requests } = await studio(page, { offline: true })
  await expect(page.locator('#studioTorrentStatus')).toContainText('Search queued')
  await expect(page.locator('.studio-torrent-result')).toHaveCount(0)
  requests.get('search').status = 'complete'
  await expect(page.locator('.studio-torrent-result')).toHaveCount(1)
})

test('failed searches keep the search usable and never queue a download', async ({ page }) => {
  const { writes } = await studio(page, { fail: true })
  await expect(page.locator('#studioTorrentStatus')).toContainText('temporarily unavailable')
  await expect(page.locator('#studioTorrentSearch')).toBeEnabled()
  expect(writes.some(write => write.path === '/api/studio/jobs')).toBe(false)
})
