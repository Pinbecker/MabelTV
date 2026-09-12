import { test, expect } from '@playwright/test'


function seedVersionOneDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mabeltv-offline-v1', 1)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore('downloads', { keyPath: 'id' })
      const chunks = database.createObjectStore('chunks', { keyPath: 'key' })
      chunks.createIndex('downloadId', 'downloadId', { unique: false })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(['downloads', 'chunks'], 'readwrite')
      transaction.objectStore('downloads').put({
        id: 'legacy-family', title: 'Legacy Family Film', status: 'complete',
        size: 4, chunks: 1, source: { kind: 'channel' },
      })
      transaction.objectStore('chunks').put({
        key: 'legacy-family:0', downloadId: 'legacy-family', index: 0,
        data: new Blob(['safe']),
      })
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => reject(transaction.error)
    }
  })
}

async function ensureControlledOfflinePage(page) {
  await page.waitForFunction(() => Boolean(window.MabelOffline))
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'load' })
  }
  await page.waitForFunction(() => (
    Boolean(navigator.serviceWorker.controller)
      && typeof window.MabelOffline?.setMediaAccess === 'function'
  ))
}

test.afterEach(async ({ request }) => {
  await request.get('/__fixture/pin-required?value=0')
})


test('version-one downloads survive the PWA database and worker upgrade', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One authoritative service-worker run')
  await page.goto('/portal/icons.svg')
  await page.evaluate(seedVersionOneDatabase)
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()

  const result = await page.evaluate(async () => {
    await window.MabelOffline.initialise()
    const downloads = await window.MabelOffline.listDownloads()
    const databaseState = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mabeltv-offline-v1')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        resolve({
          version: database.version,
          stores: [...database.objectStoreNames],
        })
        database.close()
      }
    })
    return { ids: downloads.map(item => item.id), databaseState }
  })

  expect(result.ids).toContain('legacy-family')
  expect(result.databaseState.version).toBe(2)
  expect(result.databaseState.stores).toContain('security')
})


test('the real worker serves family media and PIN-locks Adult media', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One authoritative service-worker run')
  await page.request.get('/__fixture/pin-required?value=1')
  await page.goto('/')
  await ensureControlledOfflinePage(page)

  const locked = await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('mabeltv-offline-v1', 2)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction(['downloads', 'chunks'], 'readwrite')
        for (const [id, kind, data] of [
          ['family-film', 'channel', 'safe'],
          ['adult-film', 'adult', 'grown'],
        ]) {
          transaction.objectStore('downloads').put({
            id, title: id, status: 'complete', size: data.length, chunks: 1,
            chunkSize: 4 * 1024 * 1024, mimeType: 'video/mp4',
            protected: kind === 'adult', source: { kind },
          })
          transaction.objectStore('chunks').put({
            key: `${id}:0`, downloadId: id, index: 0, data: new Blob([data]),
          })
        }
        transaction.oncomplete = () => { database.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
    })
    return window.MabelOffline.setMediaAccess(false)
  })
  expect(locked).toBe(true)

  await expect.poll(() => page.evaluate(async () => (await fetch('/offline-media/family-film')).status)).toBe(200)
  await expect.poll(() => page.evaluate(async () => (await fetch('/offline-media/adult-film')).status)).toBe(401)

  const unlocked = await page.evaluate(async () => {
    await window.MabelOffline.rememberSecurity(true, '2468')
    await window.MabelOffline.verifyPin('2468')
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mabeltv-offline-v1')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const stored = await new Promise((resolve, reject) => {
      const request = database.transaction('security').objectStore('security').get('portal')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    database.close()
    return { stored, serialised: JSON.stringify(stored) }
  })
  expect(unlocked.serialised).not.toContain('2468')
  expect(unlocked.stored.digest).toHaveLength(32)
  await expect.poll(() => page.evaluate(async () => (await fetch('/offline-media/adult-film')).status)).toBe(200)
})


test('warm startup uses the authorised snapshot and loads charts only on demand', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad-webkit', 'Phone startup contract')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.waitForFunction(async () => Boolean(
    (await window.MabelAppCache?.read('library-v1'))?.data,
  ))
  let libraryRequests = 0
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/library') libraryRequests += 1
  })
  await page.reload({ waitUntil: 'load' })
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.waitForTimeout(300)
  expect(libraryRequests).toBe(0)
  expect(await page.evaluate(() => typeof window.Chart)).toBe('undefined')

  if (testInfo.project.name === 'iphone-chromium') {
    let releaseRefresh
    const refreshGate = new Promise(resolve => { releaseRefresh = resolve })
    await page.route('**/api/bootstrap', async route => {
      const response = await route.fetch()
      const body = await response.json()
      body.revisions.library += 1
      await route.fulfill({ response, json: body })
    })
    await page.route('**/api/library', async route => {
      await refreshGate
      await route.continue()
    })
    await page.reload({ waitUntil: 'load' })
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.locator('#homeContinueRail')).toContainText('Snowy Adventure')
    await expect.poll(() => libraryRequests).toBe(1)
    const refreshResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/library')
    releaseRefresh()
    await refreshResponse
    await page.unroute('**/api/library')
    await page.unroute('**/api/bootstrap')
  }

  await page.locator('[data-view-button="adult-home"]').click()
  await page.locator('#adultHomeInsightsTab').click()
  await expect.poll(() => page.evaluate(() => typeof window.Chart)).toBe('function')
})


test('cached shell keeps every section reachable offline and Downloads functional', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad-webkit', 'Phone offline-shell contract')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await ensureControlledOfflinePage(page)

  await context.setOffline(true)
  if (testInfo.project.name === 'iphone-webkit') {
    // Playwright WebKit cannot reload an emulated offline page, but it can
    // verify the installed-iOS UI transition against the same worker-backed
    // storage. Chromium additionally proves the cold cached navigation.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.locator('#offlineUnavailable')).toBeVisible()
  await expect(page.locator('#offlineUnavailableTitle')).toContainText('Home')

  await page.locator('[data-view-button="adult-home"]').click()
  await expect(page.locator('#offlineUnavailableTitle')).toContainText('Adult TV')
  await expect(page.locator('#offlineOpenDownloads span')).toHaveText('Open Adult Downloads')
  await page.locator('#offlineOpenDownloads').click()
  await expect(page.locator('#offlineUnavailable')).toBeHidden()
  await expect(page.locator('#watchDownloadsLayout')).toBeVisible()
  await expect(page).toHaveURL(/#adult-downloads$/)

  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#offlineUnavailableTitle')).toContainText('Settings')
})
