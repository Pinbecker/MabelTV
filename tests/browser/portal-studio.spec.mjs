import { test, expect } from './test-fixtures.mjs'

test.use({ serviceWorkers: 'block' })

async function openStudio(page, { online = false, series = false, organiser = null } = {}) {
  const writes = [], jobs = []
  const items = Array.from({ length: 9 }, (_, index) => ({ id: String(index).padStart(24, '0'),
    name: ['The Grand Budapest Hotel.mkv', 'Ludwig S01E01.mp4', 'A Family Holiday.mp4', 'The Secret Garden.mkv', 'Arrival.mp4', 'The Night Manager.mp4', 'Paddington 2.mp4', 'The Imitation Game.mkv', 'The Hobbit.mkv'][index],
    path: `Films/${index}.mkv`, folder: 'Films', bytes: (index + 1) * 1024 ** 3, extension: '.mkv', kind: 'video' }))
  const cloud = { configured: true, checked: 1793530000, count: items.length, scanning: false, error: '', root: 'Media' }
  if (series) items[1] = { ...items[1], id: 'series:ludwig', name: 'Ludwig', path: 'TV/Ludwig', kind: 'series', extension: '.series', episode_count: 3, season_count: 2 }
  for (const [index, item] of items.entries()) {
    item.title = item.name.replace(/\.[^.]+$/, '').replace(/ S\d+E\d+$/, ''); item.year = '2016'; item.category = item.kind === 'series' ? 'tv' : 'films'; item.media_type = item.kind === 'series' ? 'tv' : 'movie'
    item.metadata = {tmdb_id: 100 + index, media_type:item.media_type, title:item.title, year:item.year, poster_path:`/explore-${100+index}.jpg`}
  }
  items.push({id:'kids', title:'Paddington', name:'Paddington.mp4', kind:'video', category:'kids', media_type:'movie', year:'2014', bytes:100, path:'Kids/Paddington.mp4'})
  let request = null, step = 0
  const episodes = [1, 2, 3].map(number => ({ pid: 'm000000' + number, title: 'Ludwig', episode: `Episode ${number}`,
    series: 1, episodeNumber: number, channel: 'BBC One', duration: 3500,
    synopsis: 'A puzzle setter takes his missing twin’s place and finds himself solving a very different kind of mystery.',
    artwork: 'https://ichef.bbci.co.uk/images/ic/640xn/p0ludwig.jpg' }))
  await page.route('**/api/studio/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    const payload = route.request().method() === 'POST' ? route.request().postDataJSON() : null
    if (payload) writes.push({ path, ...payload })
    let json = {}
    if (path === '/api/studio/status') json = { workers: online ? [{ id: 'a'.repeat(32), name: 'Your laptop', online: true }] : [], jobs, cloud, organiser }
    else if (path === '/api/studio/cloud') {
      if (url.searchParams.has('series')) return route.fulfill({ json: { items: episodes.map((item, index) => ({ ...item, id: 'episode-' + index, series_title: 'Ludwig', name: item.episode + '.mp4', kind: 'video', series: index === 2 ? 2 : 1 })) } })
      const q = url.searchParams.get('q')?.toLowerCase() || ''
      const filtered = items.filter(i => i.name.toLowerCase().includes(q) && (!url.searchParams.get('category') || i.category === url.searchParams.get('category')))
      json = { ...cloud, items: filtered, total: filtered.length, folders: ['Films', 'Family Videos', 'Audiobooks'] }
    } else if (path === '/api/studio/cloud/match') {
      const item = items.find(i => i.id === payload.id); item.metadata = {...item.metadata, ...payload.match}; json = {item}
    } else if (path === '/api/studio/jobs') {
      for (const source of payload.sources) jobs.unshift({ id: 'job-' + jobs.length, title: source.title, source,
        destination: { ...payload.destination, label: payload.destination.kind === 'local' ? 'Download' : 'My TV films' },
        status: 'queued', stage: 'queued', percent: 0, displayStatus: 'Queued' })
      json = { ok: true }
    } else if (path === '/api/studio/iplayer') {
      request = { id: 'search', status: online ? 'complete' : 'queued', updated: cloud.checked, result: { items: episodes } }
      json = request
    } else if (path === '/api/studio/request') json = request
    else if (path === '/api/studio/action') { jobs.find(j => j.id === payload.id).status = payload.action === 'pause' ? 'paused' : 'queued'; json = { ok: true } }
    else if (path === '/api/studio/cloud/auth') {
      step = payload.action === 'start' ? 0 : step + 1
      json = step > 1 ? { id: 'auth', complete: true } : { id: 'auth', field: step ? 'password' : 'apple_id', password: Boolean(step), help: step ? 'Apple Account password' : 'Apple Account email' }
    } else if (path === '/api/studio/artwork') {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g"><stop stop-color="#263f45"/><stop offset="1" stop-color="#b87942"/></linearGradient></defs><path fill="url(#g)" d="M0 0h640v360H0z"/><circle fill="#e3c28c" cx="460" cy="120" r="70"/><path fill="#173136" d="m0 360 220-210 230 210zm250 0 230-160 160 160z"/></svg>' })
    }
    await route.fulfill({ json })
  })
  await page.route('**/api/my-tv/discovery?**', route => route.fulfill({json:{results:[{title:'Arrival',year:'2016',media_type:'movie',tmdb_id:329865,poster_path:'/arrival.jpg'}]}}))
  await page.goto('/#my-tv-studio')
  await expect(page.locator('#view-my-tv-studio')).toBeVisible()
  await expect(page.locator('.studio-file')).toHaveCount(series ? 8 : 9)
  await expect(page.locator('#studioCloudSelection')).toBeHidden()
  return { writes, jobs }
}

test('cloud library is in My TV, filters independently and queues while laptop is offline', async ({ page }) => {
  const { writes } = await openStudio(page)
  await expect(page.locator('[data-view-button="my-tv-home"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#studioWorkerState')).toHaveText('Waiting for your laptop')
  await page.locator('#studioCloudSearch').fill('Arrival')
  await expect(page.locator('.studio-file')).toHaveCount(1)
  await page.locator('.studio-file').click()
  await expect(page.locator('#studioDestinationSheet')).toBeVisible()
  await expect(page.locator('input[name="studioDestination"][value="icloud"]')).toBeDisabled()
  await expect(page.locator('input[name="studioDestination"][value="icloud"]').locator('..')).toBeHidden()
  await page.locator('#studioDestinationSubmit').click()
  await expect(page.locator('#studioActivityPane')).toBeVisible()
  await expect(page.locator('#studioJobs')).toContainText('Queued')
  const write = writes.find(write => write.path === '/api/studio/jobs')
  expect(write.destination).toMatchObject({ kind: 'film', prepare: true, keepOptimised: false })
  expect(write.sources).toHaveLength(1)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
})

test('organiser progress uses Activity and disappears when complete', async ({ page }, testInfo) => {
  const organiser = {id:'current', title:'Organising iCloud', status:'active', message:'Filing Arrival', percent:60, created:1793530000}
  await openStudio(page, {online:true, organiser})
  await page.getByRole('button', {name:'Activity', exact:true}).click()
  const row = page.locator('[data-studio-job="organiser"]')
  await expect(row).toContainText('Filing Arrival')
  await expect(row.locator('progress')).toHaveAttribute('value','60')
  await expect(row.locator('.studio-job-actions button')).toHaveCount(0)
  await page.screenshot({path:testInfo.outputPath('studio-organiser.png'), fullPage:true})
  organiser.status = 'complete'
  await expect(row).toHaveCount(0, {timeout:10000})
  await expect(page.locator('#studioJobs')).toContainText('All caught up')
})

test('iCloud items offer two TV destinations and all three cloud retention choices', async ({page},testInfo) => {
  await openStudio(page)
  await page.locator('.studio-file').first().click()
  await expect(page.locator('#studioDestinationSheet')).toBeVisible()
  await expect(page.locator('.studio-destination-choices label:visible')).toHaveCount(2)
  await expect(page.locator('#studioCloudCopiesField label')).toHaveCount(3)
  await expect(page.locator('input[name="studioDestination"][value="local"]')).toHaveCount(0)
  await expect(page.locator('#studioPrepare')).toHaveCount(0)
  await expect(page.locator('input[name="studioDestination"][value="icloud"]')).toBeDisabled()
  await page.screenshot({path:testInfo.outputPath('cloud-destinations.png'),fullPage:true})
})

test('iPlayer groups episodes and saves the selected cloud versions with automatic preparation', async ({ page }) => {
  const { writes } = await openStudio(page, { online: true })
  await page.getByRole('button', { name: 'BBC iPlayer', exact: true }).click()
  await page.locator('#studioIplayerSearch').fill('Ludwig')
  await page.locator('#studioIplayerSearchForm').evaluate(form => form.requestSubmit())
  await expect(page.locator('.studio-programme')).toHaveCount(1)
  await page.locator('.studio-programme').click()
  await expect(page.locator('.studio-episode')).toHaveCount(3)
  await page.locator('#studioEpisodesAll').click()
  await expect(page.locator('#studioEpisodeSelected')).toHaveText('3 selected')
  await page.locator('#studioEpisodesContinue').click()
  await page.locator('.studio-destination-choices label').filter({has:page.locator('input[value="icloud"]')}).click()
  await page.locator('#studioCloudCopiesField label').filter({has:page.locator('input[value="both"]')}).click()
  await expect(page.locator('input[name="studioDestination"][value="icloud"]')).toBeChecked()
  await page.locator('#studioDestinationSubmit').click()
  const write = writes.find(write => write.path === '/api/studio/jobs')
  expect(write.sources.map(source => source.pid)).toEqual(['m0000001', 'm0000002', 'm0000003'])
  expect(write.destination).toMatchObject({ kind: 'icloud', prepare: true, keepOptimised: false, cloudCopies: 'both', saveCloud: true })
})

test('optimised-only cloud retention warns about deleting the original and offers Keep Both', async ({page},testInfo) => {
  const {writes} = await openStudio(page)
  await page.locator('.studio-file').first().click()
  await page.locator('#studioCloudCopiesField label').filter({has:page.locator('input[value="optimised"]')}).click()
  await expect(page.locator('#studioCloudReplaceWarning')).toContainText('Choose Both')
  await page.locator('#studioDestinationSubmit').click()
  await expect(page.locator('#studioReplaceSheet')).toBeVisible()
  expect(writes.filter(write=>write.path==='/api/studio/jobs')).toHaveLength(0)
  await page.screenshot({path:testInfo.outputPath('cloud-replace-original-warning.png'),fullPage:true})
  await page.locator('#studioReplaceBoth').click()
  await expect(page.locator('#studioActivityPane')).toBeVisible()
  const request = writes.find(write=>write.path==='/api/studio/jobs')
  expect(request.destination.cloudCopies).toBe('both')
  expect(request.replaceCloudOriginal).toBe(false)
})

test('replacing a cloud original requires the explicit final confirmation and freezes its displayed version', async ({page}) => {
  const {writes} = await openStudio(page)
  await page.locator('.studio-file').first().click()
  await page.locator('#studioCloudCopiesField label').filter({has:page.locator('input[value="optimised"]')}).click()
  await page.locator('#studioDestinationSubmit').click()
  await page.locator('#studioReplaceClose').click()
  expect(writes.filter(write=>write.path==='/api/studio/jobs')).toHaveLength(0)
  await page.locator('#studioDestinationSubmit').click()
  await page.locator('#studioReplaceConfirm').click()
  await expect(page.locator('#studioActivityPane')).toBeVisible()
  const request = writes.find(write=>write.path==='/api/studio/jobs')
  expect(request.destination.cloudCopies).toBe('optimised')
  expect(request.replaceCloudOriginal).toBe(true)
  expect(request.sources[0]).toHaveProperty('bytes')
  expect(request.sources[0]).toHaveProperty('modified')
  expect(request.sources[0]).toHaveProperty('remoteId')
})

test('cloud multi-selection keeps its choices and posts one batch', async ({ page }) => {
  const { writes } = await openStudio(page)
  await page.locator('#studioCloudSelect').click()
  await page.locator('.studio-file').nth(0).click()
  await page.locator('.studio-file').nth(2).click()
  await expect(page.locator('#studioCloudSelectionCount')).toHaveText('2 selected')
  await page.locator('#studioCloudContinue').click()
  await page.locator('#studioDestinationSubmit').click()
  expect(writes.find(write => write.path === '/api/studio/jobs').sources).toHaveLength(2)
})

test('library controls keep refresh by the connection and leave a wide category selector', async ({ page }) => {
  const { writes } = await openStudio(page, {online:true})
  await expect(page.locator('.studio-worker-strip #studioCloudRefresh')).toBeVisible()
  await expect(page.locator('#studioCloudMatchAll, #studioMetadataStatus')).toHaveCount(0)
  await expect(page.locator('.studio-cloud-tools button')).toHaveText(['Select'])
  expect((await page.locator('.studio-cloud-tools > label').boundingBox()).width).toBeGreaterThan(180)
  await page.locator('#studioCloudRefresh').click()
  expect(writes.filter(write=>write.path === '/api/studio/cloud/refresh')).toHaveLength(1)
  await expect(page.locator('#studioCloudRefresh')).toBeEnabled()
})

test('selection shows empty circles and fills only selected cards with a tick', async ({ page }, info) => {
  await openStudio(page)
  await expect(page.locator('.studio-file-tick')).toHaveCount(0)
  await page.locator('#studioCloudSelect').click()
  await expect(page.locator('.studio-file-tick')).toHaveCount(9)
  await expect(page.locator('.studio-file-tick .icon')).toHaveCount(0)
  await expect(page.locator('.my-tv-viewing-quick-actions')).toHaveCount(0)
  await page.locator('.studio-file').first().click()
  await expect(page.locator('.studio-file').first()).toHaveAttribute('aria-pressed','true')
  await expect(page.locator('.studio-file-tick.is-selected')).toHaveCount(1)
  await expect(page.locator('.studio-file-tick .icon use')).toHaveAttribute('href','/portal/icons.svg#signal-check')
  await page.evaluate(()=>window.MabelExperienceTheme.set('light'))
  await page.screenshot({path:info.outputPath('studio-selection-light.png'),animations:'disabled'})
  await page.locator('.studio-file').first().click()
  await expect(page.locator('.studio-file').first()).toHaveAttribute('aria-pressed','false')
  await expect(page.locator('.studio-file-tick.is-selected')).toHaveCount(0)
  await page.locator('#studioCloudSelect').click()
  await expect(page.locator('.studio-file-tick')).toHaveCount(0)
})

test('Activity clears finished and cancelled work while keeping actionable items', async ({ page }) => {
  const { jobs } = await openStudio(page)
  jobs.push({id:'working',title:'A Grand Day Out',status:'active',destination:{kind:'film',label:'My TV'},percent:70},
    {id:'finished',title:'Finished film',status:'complete',destination:{kind:'film',label:'My TV'}},
    {id:'cancelled',title:'Cancelled film',status:'cancelled',destination:{kind:'film',label:'My TV'}},
    {id:'metadata',title:'Choose details',status:'complete',metadataWarning:'Choose the right title.',destination:{kind:'film',label:'My TV'}})
  await page.locator('[data-studio-tab="activity"]').click()
  await expect(page.locator('.studio-job')).toHaveCount(2)
  await expect(page.locator('#studioJobs')).not.toContainText('Finished film')
  await expect(page.locator('#studioJobs')).not.toContainText('Cancelled film')
  await expect(page.getByRole('button',{name:'Match title',exact:true})).toBeVisible()
  jobs[0].status = 'complete'
  await expect(page.locator('.studio-job')).toHaveCount(1)
  await expect(page.locator('.studio-job')).toContainText('Needs attention')
  await expect(page.locator('#studioActiveCount')).toBeEmpty()
  jobs[3].metadataWarning = ''
  await expect(page.locator('.studio-job')).toHaveCount(0)
  await expect(page.locator('#studioJobs')).toContainText('All caught up')
  await expect(page.locator('#studioJobCount')).toHaveText('0 items')
})

test('cloud series are one title with seasons and the library has four columns', async ({ page }) => {
  await openStudio(page, { series: true })
  const columns = await page.locator('#studioCloudGrid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(4)
  await page.locator('#studioCloudCategory').selectOption('tv')
  await page.getByRole('button', { name: 'Ludwig', exact: true }).click()
  await expect(page.locator('#studioDestinationSheet')).toBeVisible()
  await page.locator('#studioChooseEpisodes').click()
  await expect(page.locator('#studioEpisodesTitle')).toHaveText('Ludwig')
  await expect(page.locator('.studio-episode')).toHaveCount(3)
  await page.locator('#studioEpisodeSeason').selectOption('2')
  await expect(page.locator('.studio-episode')).toHaveCount(1)
  await page.locator('#studioEpisodesAll').click()
  await page.locator('#studioEpisodesContinue').click()
  await expect(page.locator('#studioLibraryType')).toHaveValue('series')
  await expect(page.locator('#studioSeason')).toHaveValue('2')
})

test('iCloud deletion requires a named confirmation and cancelling does not change files', async ({ page }) => {
  const { writes } = await openStudio(page)
  await page.getByRole('button', { name: 'Arrival', exact: true }).click()
  await page.locator('#studioDestinationDelete').click()
  await expect(page.locator('#studioCloudDeleteNames')).toContainText('Arrival')
  await page.locator('#studioCloudDeleteCancel').click()
  expect(writes.filter(w => w.path === '/api/studio/cloud/operation')).toHaveLength(0)
  await expect(page.locator('#studioDestinationSheet')).toBeVisible()
  await page.locator('#studioDestinationDelete').click()
  await page.locator('#studioCloudDeleteConfirm').click()
  await expect(page.locator('#studioCloudDeleteSheet')).toBeHidden()
  expect(writes.find(w => w.path === '/api/studio/cloud/operation')).toMatchObject({ action: 'delete', confirmed: true, items: [{ id: '000000000000000000000004', bytes: 5 * 1024 ** 3, modified: '', remoteId: '' }] })
})

test('cloud uses poster cards, one category filter and a metadata correction path', async ({ page }) => {
  const { writes } = await openStudio(page)
  await expect(page.locator('#studioCloudPane select')).toHaveCount(1)
  await expect(page.locator('#studioCloudCategory option')).toHaveText(['Films', 'TV', 'Kids'])
  await expect(page.locator('.studio-cloud-card.my-tv-viewing-row')).toHaveCount(9)
  await expect(page.locator('#studioCloudGrid')).not.toContainText('.mkv')
  await expect(page.locator('#studioBrowseFolders, .studio-cloud-manage')).toHaveCount(0)
  await page.getByRole('button', { name:'Arrival', exact:true }).click()
  await page.locator('#studioCloudEditMetadata').click()
  await expect(page.locator('#studioCloudMatchSheet')).toBeVisible()
  await page.locator('.studio-match-result').click()
  await expect(page.locator('#studioDestinationSheet')).toBeVisible()
  expect(writes.find(w=>w.path === '/api/studio/cloud/match')).toMatchObject({match:{tmdb_id:329865,media_type:'movie'}})
  await page.locator('#studioDestinationClose').click()
  await page.locator('#studioCloudCategory').selectOption('kids')
  await expect(page.locator('.studio-file')).toHaveCount(1)
  await expect(page.locator('#studioCloudGrid')).toContainText('Paddington')
})

test('Activity keeps title and status through device version updates and uses compact rows', async ({ page }, info) => {
  const { jobs } = await openStudio(page, {online:true})
  jobs.push({id:'bbc-failed',title:'Wallace & Gromit: The Curse of the Were-Rabbit', status:'failed', destination:{label:'Other Films'}, error:'WARNING: The programme may not be available.\nWARNING: If you use a VPN/VPS it may have been blocked.'})
  await page.getByRole('button', {name:'Activity',exact:true}).click()
  await expect(page.locator('#studioJobs')).toContainText('Wallace & Gromit')
  await expect(page.locator('#studioJobs')).toContainText('BBC could not provide this programme')
  await expect(page.locator('.studio-job-details')).not.toHaveAttribute('open')
  await expect(page.locator('#studioJobs [data-version]')).toHaveCount(0)
  await page.evaluate(()=>document.querySelectorAll('[data-version]').forEach(node=>node.textContent='development'))
  await expect(page.locator('#studioJobs')).toContainText('Wallace & Gromit')
  const box = await page.locator('.studio-job').boundingBox()
  expect(box.height).toBeLessThan(175)
  await page.evaluate(() => window.MabelExperienceTheme.set('light'))
  await page.screenshot({path:info.outputPath('studio-activity-light.png')})
  await expect(page.locator('#view-my-tv-studio')).not.toContainText('Downloads and preparation happen on your laptop')
})

test('iCloud reconnect stays inside portal and clears secret fields after submit', async ({ page }) => {
  const { writes } = await openStudio(page)
  await page.locator('#studioConnection').click()
  await page.locator('#studioCloudConnect').click()
  await expect(page.locator('#studioAuthAnswer')).toHaveAttribute('type', 'email')
  await page.locator('#studioAuthAnswer').fill('owner@example.invalid')
  await page.locator('#studioAuthContinue').click()
  await expect(page.locator('#studioAuthAnswer')).toHaveAttribute('type', 'password')
  await expect(page.locator('#studioAuthAnswer')).toHaveValue('')
  await page.locator('#studioAuthAnswer').fill('synthetic-only-password')
  await page.locator('#studioAuthContinue').click()
  await expect(page.locator('#studioAuthSheet')).toBeHidden()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('synthetic-only-password')
  expect(writes.filter(write => write.path === '/api/studio/cloud/auth')).toHaveLength(3)
})

test('connection status is the only hardware wording in Studio', async ({ page }) => {
  await openStudio(page)
  const withoutStatus = () => page.locator('#view-my-tv-studio').evaluate(node => {
    const copy = node.cloneNode(true); copy.querySelector('#studioWorkerState').remove(); return copy.textContent
  })
  expect(await withoutStatus()).not.toMatch(/laptop|Windows/i)
  await page.getByRole('button', {name:'Arrival',exact:true}).click()
  await expect(page.locator('#studioDestinationSheet')).not.toContainText(/laptop|Windows/i)
  await expect(page.locator('.studio-destination-choices')).not.toContainText('Download')
  await page.locator('#studioDestinationClose').click()
  await page.locator('#studioConnection').click()
  await expect(page.locator('#studioConnectionSheet')).not.toContainText(/laptop|Windows/i)
  await page.locator('#studioConnectionClose').click()
  await page.getByRole('button', {name:'BBC iPlayer',exact:true}).click()
  await page.locator('#studioIplayerSearch').fill('Ludwig')
  await page.locator('#studioIplayerSearchForm').evaluate(form=>form.requestSubmit())
  await expect(page.locator('#studioIplayerStatus')).toHaveText('Search queued. Results will appear here.')
  expect(await withoutStatus()).not.toMatch(/laptop|Windows/i)
})

test('Studio shortcuts and connection status sit close to their neighbouring controls', async ({ page }, info) => {
  await openStudio(page, {online:true})
  await page.locator('.studio-title .view-back').click()
  await expect(page.locator('#view-my-tv-home')).toBeVisible()
  const shortcuts = await page.locator('.my-tv-home-shortcuts').boundingBox()
  const studio = await page.locator('.studio-home-entry').boundingBox()
  expect(studio.y - shortcuts.y - shortcuts.height).toBeLessThanOrEqual(8)
  await page.screenshot({path:info.outputPath('my-tv-shortcuts.png')})
  await page.locator('.studio-home-entry').click()
  const strip = await page.locator('.studio-worker-strip').boundingBox()
  const tabs = await page.locator('.studio-tabs').boundingBox()
  expect(tabs.y - strip.y - strip.height).toBeLessThanOrEqual(12)
})

test('Studio cloud, iPlayer, episode and destination presentation @visual', async ({ page }, info) => {
  await openStudio(page, { online: true })
  const artWidths = await page.locator('.studio-file-art').evaluateAll(nodes => nodes.slice(0, 3).map(node => node.getBoundingClientRect().width))
  expect(Math.max(...artWidths) - Math.min(...artWidths)).toBeLessThan(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('studio-cloud.png'), fullPage: true })
  await page.getByRole('button', { name: 'BBC iPlayer', exact: true }).click()
  await page.locator('#studioIplayerSearch').fill('Ludwig')
  await page.locator('#studioIplayerSearchForm').evaluate(form => form.requestSubmit())
  await expect(page.locator('.studio-programme')).toBeVisible()
  await page.screenshot({ path: info.outputPath('studio-iplayer.png'), fullPage: true })
  await page.locator('.studio-programme').click()
  await page.screenshot({ path: info.outputPath('studio-episodes.png') })
  await page.locator('#studioEpisodesAll').click()
  await page.locator('#studioEpisodesContinue').click()
  await page.screenshot({ path: info.outputPath('studio-destination.png') })
  await page.locator('#studioDestinationClose').click()
  await page.getByRole('button', { name: 'iCloud library', exact: true }).click()
  await page.evaluate(() => window.MabelExperienceTheme.set('light'))
  await page.getByRole('button', {name:'Arrival',exact:true}).click()
  await page.locator('#studioDestinationDelete').click()
  await page.screenshot({ path: info.outputPath('studio-delete-light.png'), animations: 'disabled' })
  await page.locator('#studioCloudDeleteCancel').click()
  await page.locator('#studioDestinationClose').click()
  await page.screenshot({ path: info.outputPath('studio-cloud-light.png'), fullPage: true })
})
