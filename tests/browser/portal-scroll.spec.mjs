import { test, expect } from '@playwright/test'


async function openPortal(page, theme = 'dark') {
  await page.addInitScript(value => localStorage.setItem('mabeltv-experience-theme', value), theme)
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await settled(page)
}

async function longFilms(page) {
  await page.evaluate(() => {
    library.adult_folders = ['Collection']
    library.adult_library = Array.from({ length: 120 }, (_, i) => ({
      path: `film-${i}.mp4`, display_name: `Film ${String(i).padStart(2, '0')}`,
      folder: 'Collection', browser_ready: true,
      metadata: { title: `Film ${String(i).padStart(2, '0')}`, genres: ['Adventure'] },
    }))
    remoteKind = 'adult'
    renderRemoteViewing()
    openView('watch', { instantScroll: true })
  })
  await settled(page)
}

const scrollY = page => page.evaluate(() => window.scrollY)
const settled = page => page.evaluate(async () => {
  await Promise.allSettled(document.querySelector('.view.active')?.getAnimations().map(animation => animation.finished) || [])
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
})

test('film dropdowns retain their viewport and native option nodes', async ({ page }) => {
  await openPortal(page, 'light')
  await longFilms(page)
  await page.locator('#watchGenreFilter').evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 200))
  await page.evaluate(() => { window.savedGenreOption = document.querySelector('#watchGenreFilter option') })
  const before = await scrollY(page)
  expect(before).toBeGreaterThan(100)
  await page.locator('#watchGenreFilter').selectOption('Adventure')
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(before, 0)
  expect(await page.evaluate(() => window.savedGenreOption === document.querySelector('#watchGenreFilter option'))).toBe(true)
  await page.locator('#watchCollectionFilter').selectOption('Collection')
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(before, 0)
})

test('bottom navigation returns to the same Adult TV tab and film position', async ({ page }) => {
  await openPortal(page)
  await longFilms(page)
  await page.evaluate(() => window.scrollTo(0, 1800))
  const before = await scrollY(page)
  await page.locator('[data-view-button="system"]').click()
  await expect(page.locator('#view-system')).toBeVisible()
  await page.locator('[data-view-button="watch"]').click()
  await expect(page.locator('#watchAdultLayout')).toBeVisible()
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(before, 0)
  await page.locator('[data-view-button="watch"]').click()
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(before, 0)
})

async function usbFixture(page) {
  await page.evaluate(() => {
    const originalApi = api
    api = async (url, options) => {
      if (url === '/api/usb') return { volumes: [{ id: 'test-drive', label: 'Test drive', mounted: true, filesystem: 'exfat', free: 100000 }], imports: [] }
      if (url.startsWith('/api/usb/browse?')) {
        const path = new URL(url, location.origin).searchParams.get('path') || ''
        return { path, entries: Array.from({ length: 60 }, (_, i) => ({
          name: `Item ${String(i).padStart(2, '0')}`, path: `${path ? path + '/' : ''}item-${i}`,
          type: i === 20 ? 'folder' : 'video', size: 1000, browser_ready: true,
        })) }
      }
      return originalApi(url, options)
    }
  })
  await page.locator('[data-view-button="usb"]').click()
  await page.locator('#usbDriveList button').click()
  await expect(page.locator('#usbFileList .usb-file')).toHaveCount(60)
}

test('USB returns to the parent folder position and selection does not scroll', async ({ page }) => {
  await openPortal(page, 'light')
  await usbFixture(page)
  await expect(page.locator('.usb-intro')).toHaveCount(0)
  await expect(page.locator('#usbSelectAll')).toHaveCount(0)
  await expect(page.locator('#usbBreadcrumb')).toHaveCount(0)
  await expect(page.locator('#usbFileList .usb-file-more')).toHaveCount(0)
  await expect(page.locator('#usbFolderTitle')).toHaveText('Drive root')
  expect(await page.locator('.usb-browser-head').evaluate(element => getComputedStyle(element).position)).toBe('sticky')
  const folder = page.locator('#usbFileList .usb-file').nth(20).locator('.usb-file-main')
  await folder.scrollIntoViewIfNeeded()
  const before = await scrollY(page)
  await folder.click()
  await expect(page.locator('#usbFolderTitle')).toHaveText('item-20')
  // Invoke Up without Playwright scrolling the document to reach the toolbar.
  await page.locator('#usbUp').dispatchEvent('click')
  await expect(page.locator('#usbFolderTitle')).toHaveText('Drive root')
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(before, 0)
  const select = page.locator('#usbFileList .usb-file').nth(20).locator('.usb-item-toggle')
  await select.click()
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(before, 0)
  await page.locator('[data-view-button="system"]').click()
  await page.locator('[data-view-button="usb"]').click()
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(before, 0)
})

test('library refresh keeps current position even if the user moves while it loads', async ({ page }) => {
  await openPortal(page)
  await longFilms(page)
  await page.evaluate(() => {
    const data = JSON.parse(JSON.stringify(library))
    const originalApi = api
    api = async (url, options) => {
      if (url === '/api/library') { await new Promise(resolve => { window.releaseRefresh = resolve }); return data }
      return originalApi(url, options)
    }
    window.scrollTo(0, 1500)
    window.refreshFinished = false
    reloadLibraryWithoutLosingPlace().then(() => { window.refreshFinished = true })
  })
  const moved = await page.evaluate(() => { window.scrollTo(0, 2300); const top = window.scrollY; window.releaseRefresh(); return top })
  expect(moved).toBeGreaterThan(1500)
  await expect.poll(() => page.evaluate(() => window.refreshFinished)).toBe(true)
  expect(await scrollY(page)).toBeCloseTo(moved, 0)
})

test('returning from a numbered series restores the show sheet position', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(() => {
    const series = { id: 'long-show', title: 'Long show', seasons: Array.from({ length: 20 }, (_, i) => i + 1),
      season_count: 20, episode_count: 20, episodes: Array.from({ length: 20 }, (_, i) => ({
        path: `show/${i + 1}/episode.mp4`, season: i + 1, episode: 1, display_name: 'Episode', browser_ready: true,
      })) }
    library.adult_series = [series]
    openAdultSeriesSheet(series)
  })
  const panel = page.locator('#adultSeriesSheet .library-sheet-panel')
  const season = page.locator('#adultSeriesEpisodes .adult-season-card').nth(12)
  await season.scrollIntoViewIfNeeded()
  const before = await panel.evaluate(element => element.scrollTop)
  expect(before).toBeGreaterThan(500)
  await season.click()
  await page.locator('#adultSeasonClose').click()
  await expect(page.locator('#adultSeriesSheet')).toBeVisible()
  await settled(page)
  expect(await panel.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0)
})

test('Watch library buttons return to the top while My Viewing Back retains position', async ({ page }) => {
  await openPortal(page)
  await longFilms(page)
  await page.evaluate(() => window.scrollTo(0, 1600))
  await page.locator('#watchMabelTab').dispatchEvent('click')
  await expect.poll(() => scrollY(page)).toBeLessThanOrEqual(1)
  await page.evaluate(() => window.scrollTo(0, 350))
  await page.getByRole('button', { name: 'Scroll Watch to top' }).dispatchEvent('click')
  await expect.poll(() => scrollY(page)).toBeLessThanOrEqual(1)
  await page.evaluate(() => window.scrollTo(0, 350))
  await page.locator('#watchAdultTab').dispatchEvent('click')
  await expect.poll(() => scrollY(page)).toBeLessThanOrEqual(1)
  await page.evaluate(() => window.scrollTo(0, 1600))
  await page.locator('#adultMyViewing').dispatchEvent('click')
  await expect(page.locator('#view-adult-viewing')).toBeVisible()
  await page.locator('#adultViewingBack').click()
  await expect(page.locator('#watchAdultLayout')).toBeVisible()
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(1600, 0)
  await page.locator('#adultMyViewing').dispatchEvent('click')
  await page.goBack()
  await expect(page.locator('#watchAdultLayout')).toBeVisible()
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(1600, 0)
})

test('USB remembers child folders and ignores an obsolete browse response', async ({ page }) => {
  await openPortal(page)
  await usbFixture(page)
  await page.locator('#usbFileList .usb-file').nth(20).locator('.usb-file-main').dispatchEvent('click')
  await expect(page.locator('#usbFolderTitle')).toHaveText('item-20')
  await page.evaluate(() => window.scrollTo(0, 1900))
  await page.locator('#usbUp').dispatchEvent('click')
  await expect(page.locator('#usbFolderTitle')).toHaveText('Drive root')
  await page.locator('#usbFileList .usb-file').nth(20).locator('.usb-file-main').dispatchEvent('click')
  await expect(page.locator('#usbFolderTitle')).toHaveText('item-20')
  expect(await scrollY(page)).toBeCloseTo(1900, 0)
  await page.evaluate(() => {
    const originalApi = api
    api = async (url, options) => {
      if (url.includes('path=slow')) await new Promise(resolve => { window.releaseUsb = resolve })
      return originalApi(url, options)
    }
    window.slowBrowse = browseUsb('slow')
  })
  await page.locator('#usbUp').dispatchEvent('click')
  await expect(page.locator('#usbFolderTitle')).toHaveText('Drive root')
  await page.evaluate(async () => { window.releaseUsb(); await window.slowBrowse })
  await expect(page.locator('#usbFolderTitle')).toHaveText('Drive root')
})

test('episode back and collection selection keep the sheet position', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(() => {
    const series = { id: 'episodes', title: 'Many episodes', seasons: [1], season_count: 1, episode_count: 50,
      episodes: Array.from({ length: 50 }, (_, i) => ({ path: `show/${i}.mp4`, season: 1, episode: i + 1,
        display_name: `Episode ${i + 1}`, browser_ready: true })) }
    library.adult_series = [series]
    openAdultSeasonSheet(series, 1)
  })
  const panel = page.locator('#adultSeasonSheet .library-sheet-panel')
  const episode = page.locator('#adultSeasonEpisodes button').nth(25)
  await episode.scrollIntoViewIfNeeded()
  const before = await panel.evaluate(element => element.scrollTop)
  expect(before).toBeGreaterThan(1000)
  await episode.click()
  await page.locator('#adultEpisodeClose').click()
  await expect(page.locator('#adultSeasonSheet')).toBeVisible()
  await settled(page)
  expect(await panel.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0)
  await page.locator('#adultSeasonClose').click()
  await page.evaluate(() => {
    library.adult_folders = Array.from({ length: 35 }, (_, i) => `Collection ${i}`)
    renderAdultLibrary()
    $('#watchManageAdult').click()
  })
  const collection = page.locator('#adultFolderTabs button').nth(22)
  await collection.scrollIntoViewIfNeeded()
  const collectionPanel = page.locator('#adultCollectionSheet .library-sheet-panel')
  const collectionTop = await collectionPanel.evaluate(element => element.scrollTop)
  await collection.click()
  await settled(page)
  expect(await collectionPanel.evaluate(element => element.scrollTop)).toBeCloseTo(collectionTop, 0)
})

test('viewing insights returns to the dashboard position', async ({ page }) => {
  await openPortal(page)
  await page.locator('[data-view-button="system"]').click()
  await page.locator('[data-go="insights"]').click()
  await expect(page.locator('#viewingInsights')).toBeVisible()
  await settled(page)
  await page.evaluate(() => window.scrollTo(0, 200))
  const before = await scrollY(page)
  expect(before).toBeGreaterThan(100)
  await page.evaluate(() => pushInsightsRoute('insights/channels'))
  await expect(page.locator('#viewingBrowse')).toBeVisible()
  await page.evaluate(() => navigateInsightsBack())
  await expect(page.locator('#viewingDashboard')).toBeVisible()
  await settled(page)
  expect(await scrollY(page)).toBeCloseTo(before, 0)
})

test('a library refresh preserves replaced horizontal programme rails', async ({ page }) => {
  await openPortal(page)
  await page.locator('[data-view-button="watch"]').click()
  const saved = await page.evaluate(() => {
    const rail = [...document.querySelectorAll('#remoteMabel .watch-channel-rail')]
      .find(element => element.scrollWidth > element.clientWidth + 100)
    if (!rail) throw new Error('Fixture needs a scrolling programme rail')
    rail.scrollLeft = 120
    return { key: portalElementKey(rail), left: rail.scrollLeft }
  })
  await page.evaluate(() => load())
  const after = await page.evaluate(key => [...document.querySelectorAll('#remoteMabel .watch-channel-rail')]
    .find(element => portalElementKey(element) === key).scrollLeft, saved.key)
  expect(after).toBeCloseTo(saved.left, 0)
})

test('download progress refresh and My Viewing filters retain position', async ({ page }) => {
  await openPortal(page)
  await page.evaluate(async () => {
    window.MabelOffline = { ...window.MabelOffline,
      listDownloads: async () => Array.from({ length: 40 }, (_, i) => ({ id: `download-${i}`,
        title: `Saved film ${i}`, status: 'paused', size: 1000, downloadedBytes: 500 })),
    }
    remoteKind = 'downloads'
    renderRemoteViewing()
    openView('watch')
    await renderDownloads()
  })
  await settled(page)
  await page.evaluate(() => window.scrollTo(0, 1500))
  const before = await scrollY(page)
  await page.evaluate(() => renderDownloads())
  expect(await scrollY(page)).toBeCloseTo(before, 0)
  await page.evaluate(async () => {
    openView('adult-viewing')
    await loadAdultViewing()
    adultViewingData = { items: Array.from({ length: 50 }, (_, i) => ({
      tmdb_id: 1000 + i, media_type: 'movie', title: `Film ${i}`, watchlisted: true,
    })) }
    adultViewingTab = 'watchlist'
    adultViewingFilter = 'all'
    renderAdultViewing()
  })
  await settled(page)
  await page.evaluate(() => window.scrollTo(0, 1200))
  const viewing = await scrollY(page)
  await page.locator('#adultViewingFilter').selectOption('movie')
  expect(await scrollY(page)).toBeCloseTo(viewing, 0)
})

test('returning from the player keeps the film catalogue position', async ({ page }) => {
  await openPortal(page, 'light')
  await longFilms(page)
  await page.evaluate(() => window.scrollTo(0, 1600))
  await page.evaluate(() => {
    const data = JSON.parse(JSON.stringify(library))
    const originalApi = api
    api = async (url, options) => url === '/api/library' ? data : originalApi(url, options)
    lockPortalPlayerScroll(false)
    $('#iosWatchPlayer').classList.remove('hidden')
    renderRemoteViewing()
  })
  await page.locator('#iosWatchBack').click()
  await expect(page.locator('#iosWatchPlayer')).toBeHidden()
  expect(await scrollY(page)).toBeCloseTo(1600, 0)
})
