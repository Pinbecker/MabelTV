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

async function expectHeaderClear(page, sheet, closeId) {
  const header = page.locator(`${sheet} header`).first()
  const close = page.locator(closeId)
  const copy = await header.locator(':scope > div').boundingBox()
  const button = await close.boundingBox()
  expect(copy.x + copy.width).toBeLessThanOrEqual(button.x - 4)
  expect(await close.evaluate(element => {
    const r = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  })).toBe(true)
}

for (const theme of ['light', 'dark']) {
  test(`${theme} Finding Nemo remains selectable after changing cabinets`, async ({ page }) => {
    await openPortal(page, theme)
    await page.locator('[data-view-button="system"]').click()
    const cabinet = page.locator('#tvBorder')
    await page.locator('details').filter({ has: cabinet }).locator('summary').click()
    await expect(cabinet.locator('option[value="finding-nemo"]')).toHaveText('Finding Nemo')
    await cabinet.selectOption('finding-nemo')
    await cabinet.selectOption('charcoal-90s')
    await cabinet.selectOption('finding-nemo')
    await page.evaluate(() => {
      library.tv_settings.tv_border = 'finding-nemo'
      renderTvSettings()
    })
    await expect(cabinet).toHaveValue('finding-nemo')
  })

  test(`${theme} channel facts remain legible`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await page.evaluate(() => openChannel(3, true))
    await expect(page.locator('#workspaceProgrammeCount')).toHaveText('2')
    await page.screenshot({ path: testInfo.outputPath('channel.png'), animations: 'disabled' })
    if (theme === 'light') {
      await expect(page.locator('.channel-page-facts > span').first())
        .toHaveCSS('color', 'rgb(83, 91, 104)')
    }
  })

  test(`${theme} series headers reserve close space and cover scrolling ticks`, async ({ page }, testInfo) => {
    await openPortal(page, theme)
    await page.evaluate(() => {
      library.adult_series = [{
        id: 'layout-series', title: 'Severance', seasons: [1, 2, 3, 4, 5, 6, 7],
        season_count: 7, episode_count: 2, watched_count: 0, metadata: { poster: 'bright.svg' },
        episodes: [1, 2].map(season => ({ season, episode: 1,
          still: season === 1 ? 'bright.svg' : 'dark.svg',
          path: `Series ${season}/Episode 1.mp4`, display_name: 'Episode 1',
          watched: false, browser_ready: true,
        })),
      }]
      openAdultSeriesSheet(library.adult_series[0])
    })
    const titles = page.locator('#adultSeriesEpisodes .adult-season-card-copy strong')
    await expect.poll(() => page.locator('#adultSeriesEpisodes img').first()
      .evaluate(image => image.naturalWidth)).toBe(600)
    for (const index of [0, 1]) await expect(titles.nth(index)).toHaveCSS('color', 'rgb(255, 255, 255)')
    await page.screenshot({ path: testInfo.outputPath('series.png') })
    await expectHeaderClear(page, '#adultSeriesSheet', '#adultSeriesClose')
    await page.locator('#adultSeriesSheet').evaluate(dialog => {
      const panel = dialog.querySelector('.library-sheet-panel')
      const h = dialog.querySelector('header').getBoundingClientRect()
      const s = dialog.querySelector('.adult-season-status').getBoundingClientRect()
      panel.scrollTop += s.y - h.y - 30
    })
    await page.screenshot({ path: testInfo.outputPath('series-scrolled.png') })
    expect(await page.locator('#adultSeriesSheet').evaluate(dialog => {
      const header = dialog.querySelector('header')
      const r = dialog.querySelector('.adult-season-status').getBoundingClientRect()
      return header.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })).toBe(true)
    await page.locator('#adultSeriesClose').click()
    await expect(page.locator('#adultSeriesSheet')).not.toBeVisible()
    await page.evaluate(() => openAdultSeasonSheet(library.adult_series[0], 3))
    await page.screenshot({ path: testInfo.outputPath('season.png') })
    await expectHeaderClear(page, '#adultSeasonSheet', '#adultSeasonClose')
    await expect(page.locator('#adultSeasonMeta')).toHaveText('0 episodes · 0 watched')
    const rows = await page.locator('.adult-season-tools button').evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect()
      const icon = button.querySelector('.icon').getBoundingClientRect()
      const text = button.querySelector('span').getBoundingClientRect()
      return { width: box.width, height: box.height, parentWidth: button.parentElement.clientWidth,
        iconRight: icon.right, textLeft: text.left }
    }))
    for (const row of rows) {
      expect(row.width).toBeGreaterThanOrEqual(row.parentWidth - 1)
      expect(row.height).toBeLessThan(100)
      expect(row.height).toBeGreaterThanOrEqual(44)
      expect(row.iconRight).toBeLessThan(row.textLeft)
    }
    await page.locator('#adultSeasonClose').click()
    await expect(page.locator('#adultSeasonSheet')).not.toBeVisible()
    await page.evaluate(() => {
      const series = library.adult_series[0]
      series.metadata.poster = ''
      series.episodes.forEach(episode => { episode.still = '' })
      openAdultSeriesSheet(series)
    })
    await expect(titles.first()).toHaveCSS('color', theme === 'light'
      ? 'rgb(23, 27, 35)' : 'rgb(247, 247, 248)')
    await page.screenshot({ path: testInfo.outputPath('series-no-artwork.png') })
  })

  test(`${theme} streaming season sheets hide their scrollbar without blocking scrolling`, async ({ page }) => {
    await openPortal(page, theme)
    const panel = page.locator('#adultTitleSeasonSheet .library-sheet-panel')
    await page.evaluate(() => {
      const sheet = document.querySelector('#adultTitleSeasonSheet')
      const sheetPanel = sheet?.querySelector('.library-sheet-panel')
      if (!(sheet instanceof HTMLDialogElement) || !(sheetPanel instanceof HTMLElement)) {
        throw new Error('Streaming season sheet is unavailable')
      }
      const filler = document.createElement('div')
      filler.style.height = '1200px'
      filler.setAttribute('aria-hidden', 'true')
      sheetPanel.append(filler)
      portalSheets.open(sheet)
    })
    await expect(panel).toBeVisible()
    const state = await panel.evaluate(element => {
      element.scrollTop = 240
      return {
        scrollTop: element.scrollTop,
        scrollable: element.scrollHeight > element.clientHeight,
        scrollbarWidth: getComputedStyle(element).scrollbarWidth,
        webkitScrollbarDisplay: getComputedStyle(element, '::-webkit-scrollbar').display,
        supportsScrollbarWidth: CSS.supports('scrollbar-width: none'),
      }
    })
    expect(state.scrollable).toBe(true)
    expect(state.scrollTop).toBeGreaterThan(0)
    if (state.supportsScrollbarWidth) expect(state.scrollbarWidth).toBe('none')
    else expect(state.webkitScrollbarDisplay).toBe('none')
  })
}
