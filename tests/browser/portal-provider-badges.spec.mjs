import { test, expect } from './test-fixtures.mjs'

test('provider badges share one solid style, show two preferred services, and obey their setting', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-chromium', 'One browser covers the shared card renderer')
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  const result = await page.evaluate(() => {
    const title = {
      key: 'movie:8120', media_type: 'movie', tmdb_id: 8120,
      title: 'Provider fixture', year: '2025', providers: [
        { provider_id: 337, name: 'Disney+', type: 'flatrate' },
        { provider_id: 29, name: 'Sky Go', type: 'flatrate' },
        { provider_id: 103, name: 'Channel 4', type: 'ads' },
        { provider_id: 38, name: 'BBC iPlayer', type: 'flatrate' },
        { provider_id: 9, name: 'Prime Video', type: 'flatrate' },
        { provider_id: 8, name: 'Netflix', type: 'flatrate' },
      ],
    }
    myTvProviderSummaries[title.key] = {
      providers: title.providers, sources: [], checked: Date.now(),
    }
    const host = document.createElement('div')
    const explore = myTvExploreCard({ ...title })
    myTvViewingData = { items: [{ ...title, watchlisted: true }] }
    myTvViewingTab = 'watchlist'
    const viewing = createMyTvViewingRow(myTvViewingData.items[0], 0, 1)
    host.append(explore, myTvDiscoveryCard({ ...title }), viewing)
    document.body.append(host)
    const strips = [...host.querySelectorAll('.my-tv-provider-strip')]
    const shapes = strips.flatMap(strip => [...strip.children].map(child => {
      const box = child.getBoundingClientRect()
      return { width: box.width, height: box.height,
        radius: getComputedStyle(child).borderRadius,
        border: getComputedStyle(child).borderColor }
    }))
    const primeSources = strips.map(strip => strip.querySelector('img[title="Prime Video"]')?.src)
    const lowerPriorityHost = document.createElement('span')
    renderMyTvProviderBadges(lowerPriorityHost, {
      key: 'movie:8121', media_type: 'movie', tmdb_id: 8121,
      title: 'Priority fixture', providers: [
        { provider_id: 39, name: 'NOW', type: 'flatrate' },
        { provider_id: 1825, name: 'HBO Max', type: 'flatrate' },
        { provider_id: 41, name: 'ITVX', type: 'ads' },
        { provider_id: 337, name: 'Disney+', type: 'flatrate' },
      ],
    })
    const visible = {
      strips: strips.length,
      images: host.querySelectorAll('.my-tv-provider-icon').length,
      titles: strips.map(strip => [...strip.querySelectorAll('img')].map(image => image.title)),
      shapes, primeSources,
      priorityTitles: [...lowerPriorityHost.querySelectorAll('.my-tv-provider-strip img')]
        .map(image => image.title),
      captions: [...host.querySelectorAll('.my-tv-explore-open-copy, .watch-card-copy, .my-tv-viewing-copy')]
        .map(copy => {
          const titleNode = copy.querySelector('strong')
          const metaNode = copy.querySelector('small, span')
          const style = getComputedStyle(titleNode)
          return {
            leftOffset: Math.round(titleNode.getBoundingClientRect().left
              - copy.getBoundingClientRect().left),
            verticalGap: Math.round(metaNode.getBoundingClientRect().top
              - titleNode.getBoundingClientRect().bottom),
            textAlign: style.textAlign,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          }
        }),
    }
    library.my_tv_settings.provider_badges_enabled = false
    renderMyTvProviderBadgesSetting()
    refreshMyTvProviderBadges()
    const hidden = host.querySelectorAll('.my-tv-provider-strip').length
    library.my_tv_settings.provider_badges_enabled = true
    renderMyTvProviderBadgesSetting()
    refreshMyTvProviderBadges()
    return { visible, hidden, restored: host.querySelectorAll('.my-tv-provider-strip').length }
  })
  expect(result.visible).toMatchObject({ strips: 3, images: 6 })
  expect(result.visible.shapes.every(shape => shape.width === 17 && shape.height === 17)).toBe(true)
  expect(result.visible.shapes.every(shape => shape.radius === '7px')).toBe(true)
  expect(result.visible.shapes.every(shape => shape.border === 'rgb(255, 255, 255)')).toBe(true)
  expect(result.visible.titles.every(titles => titles.join('|') === 'Netflix|Prime Video')).toBe(true)
  expect(result.visible.priorityTitles).toEqual(['ITVX', 'Disney+'])
  expect(result.visible.captions.every(caption => Math.abs(caption.leftOffset) <= 2
    && caption.verticalGap <= 3
    && caption.textAlign === 'left' && caption.textOverflow === 'ellipsis'
    && caption.whiteSpace === 'nowrap'), JSON.stringify(result.visible.captions)).toBe(true)
  expect(new Set(result.visible.primeSources).size).toBe(1)
  expect(result.hidden).toBe(0)
  expect(result.restored).toBe(3)
  await expect(page.locator('#myTvProviderBadgesToggle')).toHaveText('On')
})
