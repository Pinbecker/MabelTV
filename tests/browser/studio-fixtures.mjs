import { test, expect } from './test-fixtures.mjs'
export async function openStudio(page, { online = false, series = false, organiser = null, profileSize, originals = false } = {}) {
  const writes = [], jobs = [], collections = []
  const items = Array.from({ length: 9 }, (_, index) => ({ id: String(index).padStart(24, '0'),
    name: ['The Grand Budapest Hotel.mkv', 'Ludwig S01E01.mp4', 'A Family Holiday.mp4', 'The Secret Garden.mkv', 'Arrival.mp4', 'The Night Manager.mp4', 'Paddington 2.mp4', 'The Imitation Game.mkv', 'The Hobbit.mkv'][index],
    path: `Films/${index}.mkv`, folder: 'Films', bytes: (index + 1) * 1024 ** 3, extension: '.mkv', kind: 'video' }))
  const cloud = { configured: true, checked: 1793530000, count: items.length, scanning: false, error: '', root: 'Media' }
  if (series) items[1] = { ...items[1], id: 'series:ludwig', name: 'Ludwig', path: 'TV/Ludwig', kind: 'series', extension: '.series', episode_count: 3, season_count: 2 }
  for (const [index, item] of items.entries()) {
    item.title = item.name.replace(/\.[^.]+$/, '').replace(/ S\d+E\d+$/, ''); item.year = '2016'; item.category = item.kind === 'series' ? 'tv' : 'films'; item.media_type = item.kind === 'series' ? 'tv' : 'movie'
    item.metadata = {tmdb_id: 100 + index, media_type:item.media_type, title:item.title, year:item.year, poster_path:`/explore-${100+index}.jpg`}
    if (index === 4) item.metadata.overview = 'A linguist is recruited to communicate with mysterious visitors after spacecraft arrive around the world.'
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
      const filtered = items.filter(i => i.name.toLowerCase().includes(q) && (!url.searchParams.get('category') || i.category === url.searchParams.get('category')) && (!url.searchParams.has('collection') || (i.collection || '') === url.searchParams.get('collection')))
      if (url.searchParams.get('sort') === 'size-desc') filtered.sort((a, b) => b.bytes - a.bytes)
      if (url.searchParams.get('sort') === 'size-asc') filtered.sort((a, b) => a.bytes - b.bytes)
      json = { ...cloud, collections, items: filtered, total: filtered.length, folders: ['Films', 'Family Videos', 'Audiobooks'] }
    } else if (path === '/api/studio/cloud/collection') {
      if (payload.create) collections.push(payload.collection)
      items.filter(item => payload.ids.includes(item.id)).forEach(item => { item.collection = payload.collection })
      json = { ok: true, collection: payload.collection }
    } else if (path === '/api/studio/cloud/optimise-preview') {
      json = { files: payload.ids.map(id => ({ ...items.find(item => item.id === id), type: 'MKV',
        modified: 'same-version', remoteId: 'remote-' + id, estimatedBytes: profileSize === undefined ?
          Math.floor(items.find(item => item.id === id).bytes * ({balanced:.6,compact:.4,smallest:.25}[payload.compression || 'compact']) * .98) : profileSize })),
        output: 'MP4 · H.264 video · AAC stereo · up to 1080p / 30 fps',
        compression: payload.compression || 'compact', estimateNote: 'Estimated size from the selected compression target; measured size can vary.' }
    } else if (path === '/api/studio/originals') {
      json = { available: originals, title: 'Ludwig', items: payload.ids.map((id, index) => ({ available: originals, title: 'Ludwig', deliveryId: 'delivery-' + index })) }
    } else if (path === '/api/studio/download-originals') json = { ok: true, ids: [] }
    else if (path === '/api/studio/cloud/match') {
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
