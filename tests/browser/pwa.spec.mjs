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
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) location.reload()
  })
  await page.waitForLoadState('load')
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))

  await page.evaluate(async () => {
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
    window.MabelOffline.setMediaAccess(false)
  })

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
