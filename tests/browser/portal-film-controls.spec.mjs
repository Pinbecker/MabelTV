import { test, expect } from '@playwright/test'

async function openPortal(page, theme) {
  await page.addInitScript(theme => {
    localStorage.setItem('mabeltv-experience-theme', theme)
    localStorage.setItem('mabeltv-experience-accent-hue', '184')
  }, theme)
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

async function filmFixture(page) {
  await page.evaluate(() => {
    library.adult_folders = ['Marvel', 'The Lord of the Rings extended editions', 'Empty']
    library.adult_library = [
      ['Captain America', 'Marvel', ['Action', 'Adventure']],
      ['Thor', 'Marvel', ['Action', 'Fantasy']],
      ['The Fellowship of the Ring', 'The Lord of the Rings extended editions', ['Adventure', 'Fantasy']],
      ['A Quiet Place', '', ['Horror']],
      ['Unmatched film', '', undefined],
    ].map(([title, folder, genres]) => ({ path: title + '.mkv', display_name: title, folder,
      browser_ready: false, size: 1000, metadata: { title, genres, year: '2014' } }))
    renderAdultLibrary()
    remoteKind = 'adult'
    openView('watch')
    renderRemoteViewing()
  })
}

for (const theme of ['light', 'dark']) {
  test(`${theme} remote context and player back controls stay legible`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await page.locator('[data-view-button="live"]').click()
    const context = page.locator('.remote-transport-context')
    await context.scrollIntoViewIfNeeded()
    for (const button of await context.locator('button').all()) {
      await expect(button).toBeVisible()
      const style = await button.evaluate(element => {
        const s = getComputedStyle(element)
        return { color: s.color, background: s.backgroundColor, opacity: s.opacity, disabled: element.disabled }
      })
      expect(style.opacity).toBe('1')
      expect(style.background).not.toBe('rgba(0, 0, 0, 0)')
      if (style.disabled) expect(style.color).toBe(theme === 'light' ? 'rgb(83, 91, 104)' : 'rgb(167, 167, 176)')
    }
    await expect(page.locator('#remoteSubtitles')).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('remote.png') })
    await page.evaluate(() => {
      $('#iosWatchTitle').textContent = 'Captain America: The Winter Soldier'
      $('#iosWatchStartOver').classList.remove('hidden')
      $('#iosWatchPlayer').classList.remove('hidden')
    })
    await expect(page.locator('#iosWatchBack')).toHaveCSS('color', 'rgb(247, 247, 248)')
    await expect(page.locator('#iosWatchTitle')).toHaveCSS('color', 'rgb(247, 247, 248)')
    const back = await page.locator('#iosWatchBack').boundingBox()
    expect(back.width).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: testInfo.outputPath('player.png') })
    await page.locator('#iosWatchBack').click()
    await expect(page.locator('#iosWatchPlayer')).toBeHidden()
  })

  test(`${theme} collections reuse full width action rows`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await filmFixture(page)
    await page.locator('#watchManageAdult').click()
    await expect(page.locator('#adultCollectionSheet')).toBeVisible()
    const collection = page.locator('#adultFolderTabs button').filter({ hasText: 'The Lord of the Rings extended editions' })
    await collection.click()
    await expect(collection).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#adultRenameFolder')).toBeEnabled()
    await expect(page.locator('#adultDeleteFolder')).toBeDisabled()
    const rows = await page.locator('#adultFolderTabs button').evaluateAll(buttons => buttons.map(button => {
      const label = button.querySelector('strong')
      return { width: button.getBoundingClientRect().width, parent: button.parentElement.clientWidth,
        labelWidth: label.clientWidth, labelScroll: label.scrollWidth,
        icon: button.querySelector('use').getAttribute('href') }
    }))
    for (const row of rows) {
      expect(row.width).toBeGreaterThanOrEqual(row.parent - 1)
      expect(row.labelScroll).toBeLessThanOrEqual(row.labelWidth + 1)
      expect(row.icon).toBe('/portal/icons.svg#folder')
    }
    await page.screenshot({ path: testInfo.outputPath('collections.png') })
    await page.locator('#adultFolderTabs button').filter({ hasText: /^Empty/ }).click()
    await expect(page.locator('#adultDeleteFolder')).toBeEnabled()
    await page.locator('#adultFolderTabs button').filter({ hasText: 'All films' }).click()
    await expect(page.locator('#adultFolderSelectionActions')).toBeHidden()
    const input = await page.locator('#adultFolderName').boundingBox()
    const create = await page.locator('#adultCreateFolder').boundingBox()
    expect(input.y).toBeCloseTo(create.y, 0)
    expect(input.x + input.width).toBeLessThan(create.x)
    await page.locator('#adultCollectionClose').click()
    await expect(page.locator('#adultCollectionSheet')).toBeHidden()
  })

  test(`${theme} compact film filters combine metadata genres and collections`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await filmFixture(page)
    const collection = page.locator('#watchCollectionFilter')
    const genre = page.locator('#watchGenreFilter')
    await collection.scrollIntoViewIfNeeded()
    const filters = await page.locator('.watch-film-filters').boundingBox()
    expect(filters.height).toBeLessThanOrEqual(48)
    expect(filters.height).toBeGreaterThanOrEqual(44)
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(5)
    await collection.selectOption('Marvel')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(2)
    await genre.selectOption('Adventure')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(1)
    await expect(page.locator('#remoteAdult')).toContainText('Captain America')
    await page.screenshot({ path: testInfo.outputPath('filters.png') })
    await genre.selectOption('Horror')
    await expect(page.locator('#remoteAdult')).toContainText('No matching films')
    await collection.selectOption('')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(1)
    await genre.selectOption('')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(2)
    await expect(page.locator('#remoteAdult')).toContainText('Unmatched film')
    await collection.selectOption('*')
    await genre.selectOption('Fantasy')
    await page.locator('#watchSearch').fill('Thor')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(1)
    await expect(genre).toHaveValue('Fantasy')
    await page.locator('#watchSearchClear').click()
    // On phones, search remains open while the empty search field has focus.
    await page.locator('#watchSearch').press('Tab')
    await genre.selectOption('')
    await collection.selectOption('Empty')
    await page.evaluate(() => { library.adult_folders = library.adult_folders.filter(value => value !== 'Empty'); renderAdultWatch() })
    await expect(collection).toHaveValue('*')
    await expect(page.locator('#remoteAdult .watch-card')).toHaveCount(5)
  })
}
