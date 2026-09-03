'use strict'

let adultDiscoveryTimer = null
let adultDiscoveryRevision = 0
let adultViewingData = { items: [] }
let adultViewingTab = 'watchlist'
let adultViewingFilter = 'all'
let selectedAdultTitle = null
let pendingNetflixLaunch = null

function adultPosterUrl(path, size = 'w342') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : ''
}

function adultViewingPosterUrl(item) {
  if (item.poster_path) return adultPosterUrl(item.poster_path)
  const localPoster = item.local?.poster
  return localPoster ? `/api/adult/artwork/${encodeURIComponent(localPoster)}` : ''
}

const adultProviderBrands = [
  {
    id: 'netflix', label: 'Netflix', asset: 'netflix-app.jpg', match: /netflix/i,
    tmdbIds: [8, 1796], watchmodeIds: [203],
    hosts: ['netflix.com'], fallback: title => `https://www.netflix.com/search?q=${encodeURIComponent(title)}`,
  },
  {
    id: 'prime-video', label: 'Prime Video', asset: 'prime-video-app.jpg',
    match: /(?:prime\s*video|amazon\s*prime|via\s*amazon\s*prime)/i,
    tmdbIds: [9], watchmodeIds: [25, 26],
    hosts: ['amazon.co.uk', 'primevideo.com'],
    fallback: title => `https://www.amazon.co.uk/gp/video/search?phrase=${encodeURIComponent(title)}`,
  },
  {
    id: 'disney-plus', label: 'Disney+', asset: 'disney-plus-app.jpg', match: /disney\s*(?:\+|plus)/i,
    tmdbIds: [337], watchmodeIds: [372],
    hosts: ['disneyplus.com'], fallback: () => 'https://www.disneyplus.com/en-gb/home',
  },
  {
    id: 'sky-go', label: 'Sky Go', asset: 'sky-go-app.jpg', match: /sky\s*go/i,
    tmdbIds: [29], watchmodeIds: [408],
    hosts: ['sky.com'], fallback: () => 'https://www.sky.com/watch/sky-go/',
  },
  {
    id: 'bbc-iplayer', label: 'BBC iPlayer', asset: 'bbc-iplayer-app.jpg', match: /(?:bbc(?:\s*iplayer)?|iplayer)/i,
    tmdbIds: [38], watchmodeIds: [409],
    hosts: ['bbc.co.uk'], fallback: title => `https://www.bbc.co.uk/iplayer/search?q=${encodeURIComponent(title)}`,
  },
  {
    id: 'channel-4', label: 'Channel 4', asset: 'channel-4-app.jpg', match: /(?:channel\s*4|all\s*4)/i,
    tmdbIds: [103], watchmodeIds: [407],
    hosts: ['channel4.com'], fallback: () => 'https://www.channel4.com/',
  },
  {
    id: 'itvx', label: 'ITVX', asset: 'itvx-app.jpg', match: /(?:itvx|itv\s*(?:hub|player)?)/i,
    tmdbIds: [41, 2300], watchmodeIds: [413, 543],
    hosts: ['itv.com'], fallback: () => 'https://www.itv.com/watch',
  },
  {
    id: 'paramount-plus', label: 'Paramount+', asset: 'paramount-plus-app.jpg', match: /paramount\s*(?:\+|plus)/i,
    tmdbIds: [531], watchmodeIds: [444],
    hosts: ['paramountplus.com'], fallback: title => `https://www.paramountplus.com/gb/search/?q=${encodeURIComponent(title)}`,
  },
  {
    id: 'apple-tv', label: 'Apple TV', asset: 'apple-tv-app.jpg', match: /apple\s*tv/i,
    tmdbIds: [350], watchmodeIds: [371],
    hosts: ['tv.apple.com'], fallback: title => `https://tv.apple.com/gb/search?term=${encodeURIComponent(title)}`,
  },
]

function adultProviderBrandFor(record, idField, brandIds) {
  const identifier = Number(record?.[idField] || 0)
  return adultProviderBrands.find(brand =>
    (identifier && brand[brandIds].includes(identifier)) || brand.match.test(String(record?.name || '')))
}

function adultProviderPlatform(client = navigator) {
  const agent = String(client?.userAgent || '')
  const ipad = String(client?.platform || '') === 'MacIntel' && Number(client?.maxTouchPoints || 0) > 1
  if (/iPad|iPhone|iPod/i.test(agent) || ipad) return 'ios'
  if (/Android/i.test(agent)) return 'android'
  return 'web'
}

function adultProviderDestination(brand, source, title, platform = adultProviderPlatform()) {
  const fields = platform === 'ios'
    ? ['ios_url', 'web_url', 'url', 'android_url']
    : platform === 'android'
      ? ['android_url', 'web_url', 'url', 'ios_url']
      : ['web_url', 'url', 'ios_url', 'android_url']
  for (const field of fields) {
    const direct = String(source?.[field] || '').trim()
    if (!direct) continue
    try {
      const url = new URL(direct)
      if (!['http:', 'https:'].includes(url.protocol)) {
        if ((field === 'ios_url' || field === 'android_url') &&
            !['javascript:', 'data:', 'file:', 'blob:'].includes(url.protocol)) return direct
        continue
      }
      const host = url.hostname.toLowerCase()
      const official = brand.hosts.some(domain => host === domain || host.endsWith(`.${domain}`))
      if (official) {
        if (url.protocol === 'http:') url.protocol = 'https:'
        return url.href
      }
    } catch (_) {
      // An invalid or third-party destination falls through to the official provider route.
    }
  }
  return brand.fallback(String(title || '').trim())
}

function openNetflixLaunchChoice(detail, provider, brand, source) {
  const deviceDestination = adultProviderDestination(brand, source, detail.title)
  const tvDestination = adultProviderDestination(brand, source, detail.title, 'web')
  const tvAvailable = /^https:\/\/(?:www\.)?netflix\.com\/(?:watch|title)\/\d+/i.test(tvDestination)
  pendingNetflixLaunch = { detail, provider, deviceDestination, tvDestination, tvAvailable }
  $('#adultNetflixLaunchTitle').textContent = `Play ${detail.title} where?`
  $('#adultNetflixLaunchCopy').textContent = 'Open Netflix here, or send this title to the connected TV.'
  $('#adultNetflixLaunchStatus').textContent = tvAvailable ? '' : 'Netflix did not provide a direct TV destination for this title.'
  $('#adultNetflixLaunchTv').disabled = !tvAvailable
  portalSheets.open($('#adultNetflixLaunchSheet'))
}

function closeNetflixLaunchChoice() {
  pendingNetflixLaunch = null
  portalSheets.dismiss($('#adultNetflixLaunchSheet'))
}

function launchNetflixOnDevice() {
  const pending = pendingNetflixLaunch
  if (!pending) return
  // Keep navigation in the original tap so iOS can honour the Netflix Universal Link.
  void updateAdultViewing(pending.detail, 'launched', { provider: pending.provider.name }).catch(() => {})
  window.location.assign(pending.deviceDestination)
}

async function launchNetflixOnTv() {
  const pending = pendingNetflixLaunch
  if (!pending?.tvAvailable) return
  const buttons = [$('#adultNetflixLaunchDevice'), $('#adultNetflixLaunchTv')]
  buttons.forEach(button => { button.disabled = true })
  $('#adultNetflixLaunchStatus').textContent = 'Opening Netflix on the connected TV…'
  try {
    const result = await api('/api/adult/netflix/play-tv', {
      method: 'POST', body: JSON.stringify({
        media_type: pending.detail.media_type, tmdb_id: pending.detail.tmdb_id,
        title: pending.detail.title, destination: pending.tvDestination,
      }),
    })
    void updateAdultViewing(pending.detail, 'launched', { provider: pending.provider.name }).catch(() => {})
    notice(result.message || 'Opening Netflix on the connected TV')
    closeNetflixLaunchChoice()
  } catch (error) {
    $('#adultNetflixLaunchStatus').textContent = error.message || 'Netflix could not open on the TV.'
  } finally {
    buttons.forEach(button => { button.disabled = !pending.tvAvailable })
  }
}

function adultTitlePayload(title, action, extra = {}) {
  return {
    action, media_type: title.media_type, tmdb_id: title.tmdb_id,
    title: title.title, year: title.year || '', poster_path: title.poster_path || '',
    overview: title.overview || '', runtime: Number(title.runtime || 0), ...extra,
  }
}

async function updateAdultViewing(title, action, extra = {}) {
  const result = await api('/api/adult/viewing', {
    method: 'POST', body: JSON.stringify(adultTitlePayload(title, action, extra)),
  })
  title.viewing = result.viewing
  await loadAdultViewing(false)
  return result.viewing
}

function adultDiscoveryCard(title) {
  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'watch-card'
  const art = document.createElement('span')
  art.className = 'watch-card-art'
  if (title.poster_path) {
    const image = document.createElement('img')
    image.src = adultPosterUrl(title.poster_path)
    image.alt = ''
    art.append(image)
  } else art.append(librarySignalIcon(title.media_type === 'tv' ? 'signal-tv' : 'signal-film'))
  if (title.on_mabeltv) {
    const badge = document.createElement('span')
    badge.className = 'watch-format adult-local-badge'
    badge.textContent = 'On MabelTV'
    art.append(badge)
  }
  const copy = document.createElement('span')
  copy.className = 'watch-card-copy'
  const name = document.createElement('strong')
  name.textContent = title.title
  const meta = document.createElement('small')
  meta.textContent = [title.year, title.media_type === 'tv' ? 'TV series' : 'Film'].filter(Boolean).join(' · ')
  copy.append(name, meta)
  card.append(art, copy)
  card.onclick = () => title.tmdb_id ? openAdultTitle(title) : notice('Match this local film to TMDB from Library settings first.', true)
  return card
}

async function searchAdultDiscovery(query) {
  const revision = ++adultDiscoveryRevision
  const section = $('#adultDiscoverySection')
  const root = $('#adultDiscoveryGrid')
  if (query.trim().length < 2) {
    section.classList.add('hidden')
    root.replaceChildren()
    return
  }
  section.classList.remove('hidden')
  root.innerHTML = '<div class="watch-empty"><strong>Searching Adult TV…</strong><br>Checking your library and streaming catalogue.</div>'
  try {
    const result = await api(`/api/adult/discovery?q=${encodeURIComponent(query.trim())}`)
    if (revision !== adultDiscoveryRevision) return
    root.replaceChildren()
    result.results.forEach(title => root.append(adultDiscoveryCard(title)))
    $('#adultDiscoveryCount').textContent = `${result.results.length} result${result.results.length === 1 ? '' : 's'}`
    if (!result.results.length) root.innerHTML = '<div class="watch-empty"><strong>No matches</strong><br>Try a different title.</div>'
  } catch (error) {
    if (revision !== adultDiscoveryRevision) return
    root.innerHTML = `<div class="watch-empty"><strong>Search unavailable</strong><br>${escapeHtml(error.message)}</div>`
  }
}

function scheduleAdultDiscovery() {
  clearTimeout(adultDiscoveryTimer)
  const query = $('#watchSearch')?.value || ''
  if (query.trim().length < 2) searchAdultDiscovery('')
  else adultDiscoveryTimer = setTimeout(() => searchAdultDiscovery(query), 320)
}

function localAdultAction(detail) {
  if (!detail.local) return null
  if (detail.local.kind === 'film') {
    const film = (library?.adult_library || []).find(item => item.path === detail.local.path)
    return film ? () => { portalSheets.dismiss($('#adultTitleSheet')); openWatchFilmSheet(film) } : null
  }
  const series = (library?.adult_series || []).find(item => item.id === detail.local.series)
  return series ? () => { portalSheets.dismiss($('#adultTitleSheet')); openAdultSeriesSheet(series) } : null
}

function renderAdultProviderLinks(detail, result) {
  const root = $('#adultProviderList')
  root.replaceChildren()
  const localAction = localAdultAction(detail)
  const sourcesByBrand = new Map()
  ;(result.sources || []).forEach(source => {
    const brand = adultProviderBrandFor(source, 'source_id', 'watchmodeIds')
    if (brand && ['sub', 'free', 'tve', 'ads'].includes(String(source.type || '').toLowerCase()) && !sourcesByBrand.has(brand.id)) sourcesByBrand.set(brand.id, source)
  })
  const includedByBrand = new Map()
  ;(detail.providers || []).forEach(provider => {
    if (!['flatrate', 'free', 'ads'].includes(String(provider.type || '').toLowerCase())) return
    const brand = adultProviderBrandFor(provider, 'provider_id', 'tmdbIds')
    if (brand && !includedByBrand.has(brand.id)) includedByBrand.set(brand.id, { brand, provider })
  })
  const streaming = document.createElement('div')
  streaming.className = 'adult-provider-logos'
  if (localAction) {
    const local = document.createElement('button')
    local.type = 'button'; local.className = 'adult-provider-logo provider-mabeltv'
    local.setAttribute('aria-label', 'Open on MabelTV'); local.title = 'MabelTV'
    const image = document.createElement('img')
    image.src = '/apple-touch-icon.png'; image.alt = 'MabelTV'
    local.append(image); local.onclick = localAction
    streaming.append(local)
  }
  adultProviderBrands.forEach(brand => {
    const included = includedByBrand.get(brand.id)
    if (!included) return
    const { provider } = included
    const button = document.createElement('button')
    button.type = 'button'; button.className = `adult-provider-logo provider-${brand.id}`
    button.setAttribute('aria-label', `Open ${brand.label}`)
    button.title = brand.label
    const image = document.createElement('img')
    image.src = `/portal/assets/providers/${brand.asset}`
    image.alt = brand.label
    button.append(image)
    button.onclick = () => {
      const source = sourcesByBrand.get(brand.id)
      if (brand.id === 'netflix') {
        openNetflixLaunchChoice(detail, provider, brand, source)
        return
      }
      const destination = adultProviderDestination(brand, source, detail.title)
      // Keep navigation in the original tap. iOS may refuse a Universal Link
      // or app scheme if an awaited request consumes the user gesture first.
      void updateAdultViewing(detail, 'launched', { provider: provider.name }).catch(() => {})
      window.location.assign(destination)
    }
    streaming.append(button)
  })
  if (streaming.children.length) root.append(streaming)
  if (!root.children.length) root.innerHTML = '<p>No direct streaming destinations were found in Great Britain.</p>'
}

async function loadAdultProviders(detail, refresh = false) {
  const root = $('#adultProviderList')
  root.innerHTML = '<p>Checking streaming destinations…</p>'
  try {
    const result = await api(`/api/adult/providers?media_type=${detail.media_type}&tmdb_id=${detail.tmdb_id}${refresh ? '&refresh=1' : ''}`)
    renderAdultProviderLinks(detail, result)
  } catch (error) {
    renderAdultProviderLinks(detail, { sources: [] })
    const message = document.createElement('p')
    message.textContent = error.message
    root.append(message)
  }
}

function syncAdultTitleButtons(detail) {
  const state = detail.viewing || {}
  const actions = [
    ['#adultTitleWatchlist', 'watchlisted'], ['#adultTitleUpNext', 'up_next'],
    ['#adultTitleWatched', 'manual_state', 'watched'],
  ]
  actions.forEach(([selector, field, value = true]) => $(selector).classList.toggle('active', state[field] === value))
}

function adultSeasonSummary(season, watched = 0) {
  const total = Number(season.episodes || 0)
  return watched ? `${watched} of ${total} watched` : `${total} episode${total === 1 ? '' : 's'}`
}

async function renderAdultSeasonEpisodes(detail, season, card, list) {
  if (list.dataset.loaded === 'true') {
    const expanded = card.getAttribute('aria-expanded') === 'true'
    card.setAttribute('aria-expanded', String(!expanded))
    list.classList.toggle('hidden', expanded)
    return
  }
  list.textContent = 'Loading episodes…'
  card.disabled = true
  try {
    const result = await api(`/api/adult/season?tmdb_id=${detail.tmdb_id}&season=${season.number}`)
    list.replaceChildren()
    result.episodes.forEach(episode => {
      const row = document.createElement('div'); row.className = 'adult-title-episode'
      const copy = document.createElement('span')
      const name = document.createElement('strong'); name.textContent = `${episode.number}. ${episode.name}`
      const meta = document.createElement('small'); meta.textContent = [episode.air_date?.slice(0, 4), episode.runtime ? `${episode.runtime} min` : ''].filter(Boolean).join(' · ')
      copy.append(name, meta)
      const toggle = document.createElement('button'); toggle.type = 'button'
      const sync = watched => { toggle.classList.toggle('active', watched); toggle.textContent = watched ? 'Watched' : 'Mark watched' }
      sync(episode.watched)
      toggle.onclick = async () => {
        toggle.disabled = true
        try {
          const viewing = await updateAdultViewing(detail, 'episode_watched', { season: season.number, episode: episode.number, watched: !episode.watched })
          detail.viewing = viewing; episode.watched = !episode.watched; sync(episode.watched)
          const count = result.episodes.filter(value => value.watched).length
          card.querySelector('small').textContent = adultSeasonSummary(season, count)
        } catch (error) { showError(error) } finally { toggle.disabled = false }
      }
      row.append(copy, toggle); list.append(row)
    })
    list.dataset.loaded = 'true'; card.setAttribute('aria-expanded', 'true')
  } catch (error) {
    list.textContent = error.message
  } finally { card.disabled = false }
}

function renderAdultTitleSeasons(detail) {
  const seasons = $('#adultTitleSeasons'); seasons.replaceChildren()
  seasons.classList.toggle('hidden', detail.media_type !== 'tv' || !(detail.seasons || []).length)
  ;(detail.seasons || []).forEach(season => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'adult-title-season'; card.setAttribute('aria-expanded', 'false')
    const name = document.createElement('strong'); name.textContent = season.name || `Season ${season.number}`
    const episodes = document.createElement('small'); episodes.textContent = adultSeasonSummary(season)
    card.append(name, episodes)
    const list = document.createElement('div'); list.className = 'adult-title-episode-list hidden'
    card.onclick = () => renderAdultSeasonEpisodes(detail, season, card, list)
    seasons.append(card, list)
  })
}

async function openAdultTitle(title) {
  const sheet = $('#adultTitleSheet')
  selectedAdultTitle = title
  portalSheets.open(sheet, { focus: sheet.querySelector('.watch-film-panel') })
  $('#adultTitleName').textContent = title.title
  $('#adultTitleOverview').textContent = 'Loading title details…'
  $('#adultProviderList').innerHTML = '<p>Loading…</p>'
  try {
    const detail = await api(`/api/adult/title?media_type=${title.media_type}&tmdb_id=${title.tmdb_id}`)
    selectedAdultTitle = detail
    $('#adultTitleName').textContent = detail.title
    $('#adultTitleEyebrow').textContent = detail.on_mabeltv ? 'On MabelTV' : detail.media_type === 'tv' ? 'TV series' : 'Film'
    $('#adultTitleOverview').textContent = detail.overview || 'No description is available.'
    renderAdultTitleSeasons(detail)
    $('#adultTitleMeta').replaceChildren()
    ;[detail.year, detail.runtime ? `${detail.runtime} min` : '', ...(detail.genres || []).slice(0, 2)].filter(Boolean).forEach(value => {
      const span = document.createElement('span'); span.textContent = value; $('#adultTitleMeta').append(span)
    })
    const poster = $('#adultTitlePoster'); poster.replaceChildren()
    if (detail.poster_path) { const image = document.createElement('img'); image.src = adultPosterUrl(detail.poster_path, 'w500'); image.alt = `Poster for ${detail.title}`; poster.append(image) }
    $('#adultTitleBackdrop').style.setProperty('--watch-film-art', detail.backdrop_path ? `url("${adultPosterUrl(detail.backdrop_path, 'w1280')}")` : 'linear-gradient(135deg,#2e3a34,#101513)')
    $('#adultTitleLocal').classList.toggle('hidden', !detail.on_mabeltv)
    $('#adultTitleLocal').textContent = detail.on_mabeltv ? 'Available locally on MabelTV — this option is always shown first.' : ''
    syncAdultTitleButtons(detail)
    $('#adultTitleWatchlist').onclick = async () => { detail.viewing = await updateAdultViewing(detail, 'watchlist', { enabled: !detail.viewing?.watchlisted }); syncAdultTitleButtons(detail) }
    $('#adultTitleUpNext').onclick = async () => { detail.viewing = await updateAdultViewing(detail, 'up_next', { enabled: !detail.viewing?.up_next }); syncAdultTitleButtons(detail) }
    $('#adultTitleWatched').onclick = async () => { detail.viewing = await updateAdultViewing(detail, detail.viewing?.manual_state === 'watched' ? 'not_watched' : 'watched'); syncAdultTitleButtons(detail) }
    $('#adultProviderRefresh').onclick = () => loadAdultProviders(detail, true)
    loadAdultProviders(detail)
  } catch (error) {
    $('#adultTitleOverview').textContent = error.message
  }
}

function adultViewingItems() {
  const items = adultViewingData.items || []
  return items.filter(item => {
    if (adultViewingTab === 'up-next' && !item.up_next) return false
    if (adultViewingTab === 'watchlist' && !item.watchlisted) return false
    if (adultViewingTab === 'watching' && item.manual_state !== 'part_watched' && !item.local_progress) return false
    if (adultViewingTab === 'history' && item.manual_state !== 'watched' && !(item.history || []).length) return false
    if (adultViewingFilter === 'movie' || adultViewingFilter === 'tv') return item.media_type === adultViewingFilter
    if (adultViewingFilter === 'local') return item.on_mabeltv
    if (adultViewingFilter === 'streaming') return !item.on_mabeltv
    if (adultViewingFilter === 'recent') return Date.now() / 1000 - Number(item.updated || 0) < 30 * 24 * 60 * 60
    if (adultViewingFilter === 'short') return item.media_type === 'movie' && Number(item.runtime || 0) > 0 && Number(item.runtime) < 120
    return true
  }).sort((a, b) => adultViewingTab === 'up-next'
    ? Number(a.up_next_rank || 999999) - Number(b.up_next_rank || 999999)
    : Number(b.viewing_updated || b.updated || 0) - Number(a.viewing_updated || a.updated || 0))
}

function renderAdultViewing() {
  const labels = { 'up-next': ['Your chosen order', 'Up Next'], watchlist: ['Saved for later', 'Watchlist'], watching: ['In progress', 'Watching'], history: ['Previously watched', 'History'] }
  const [kicker, heading] = labels[adultViewingTab]
  $('#adultViewingKicker').textContent = kicker
  $('#adultViewingHeading').textContent = heading
  const values = adultViewingItems()
  $('#adultViewingCount').textContent = `${values.length} title${values.length === 1 ? '' : 's'}`
  const root = $('#adultViewingGrid'); root.replaceChildren()
  values.forEach((item, index) => {
    const row = document.createElement('article'); row.className = 'adult-viewing-row'
    const posterUrl = adultViewingPosterUrl(item)
    const art = posterUrl ? document.createElement('img') : document.createElement('span')
    if (posterUrl) { art.src = posterUrl; art.alt = '' } else art.className = 'adult-viewing-placeholder'
    const copy = document.createElement('span'); copy.className = 'adult-viewing-copy'
    const title = document.createElement('strong'); title.textContent = item.title || 'Untitled'
    const meta = document.createElement('span'); meta.textContent = [item.year, item.media_type === 'tv' ? 'TV series' : 'Film', item.on_mabeltv ? 'On MabelTV' : 'Streaming'].filter(Boolean).join(' · ')
    copy.append(title, meta)
    const actions = document.createElement('span'); actions.className = 'adult-viewing-row-actions'
    if (adultViewingTab === 'up-next') {
      ;[['move_up', 'signal-chevron-up', 'Move earlier'], ['move_down', 'signal-chevron-down', 'Move later']].forEach(([action, icon, label]) => {
        const move = document.createElement('button'); move.type = 'button'; move.setAttribute('aria-label', `${label}: ${item.title}`); move.append(librarySignalIcon(icon)); move.disabled = action === 'move_up' ? index === 0 : index === values.length - 1
        move.onclick = async event => { event.stopPropagation(); await updateAdultViewing(item, action) }
        actions.append(move)
      })
    } else {
      const open = document.createElement('button'); open.type = 'button'; open.className = 'adult-viewing-row-open'; open.setAttribute('aria-label', `Open ${item.title}`); open.append(librarySignalIcon('signal-chevron-right')); open.onclick = () => openAdultTitle(item); actions.append(open)
    }
    const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'adult-viewing-copy-button'; opener.append(copy); opener.onclick = () => openAdultTitle(item)
    row.append(art, opener, actions); root.append(row)
  })
  if (!values.length) root.innerHTML = `<div class="watch-empty"><strong>Nothing in ${heading} yet</strong><br>Add titles from search and they will appear here.</div>`
}

async function loadAdultViewing(showConfirmation = true) {
  adultViewingData = await api('/api/adult/viewing')
  renderAdultViewing()
  if (!showConfirmation) return
  const pending = (adultViewingData.items || []).filter(item => item.pending_confirmation)
    .sort((a, b) => Number(b.pending_confirmation.launched || 0) - Number(a.pending_confirmation.launched || 0))[0]
  if (pending) {
    $('#adultWatchConfirmTitle').textContent = `Did you watch ${pending.title || 'it'}?`
    $('#adultWatchConfirmProvider').textContent = `You opened ${pending.pending_confirmation.provider}. Update your private MabelTV history?`
    $('#adultWatchConfirmSheet').dataset.titleKey = pending.key
    portalSheets.open($('#adultWatchConfirmSheet'))
  }
}

$('#watchSearch')?.addEventListener('input', scheduleAdultDiscovery)
$('#watchSearchClear')?.addEventListener('click', () => searchAdultDiscovery(''))
$('#adultMyViewing')?.addEventListener('click', () => { history.pushState({ adultViewing: true }, '', '#adult-viewing'); openView('adult-viewing'); loadAdultViewing().catch(showError) })
$('#adultViewingBack')?.addEventListener('click', () => { history.back(); setTimeout(() => { if (location.hash === '#adult-viewing') openView('watch') }, 80) })
$('#adultTitleClose')?.addEventListener('click', () => portalSheets.dismiss($('#adultTitleSheet')))
$('#adultTitleSheet')?.addEventListener('click', event => { if (event.target === $('#adultTitleSheet')) portalSheets.dismiss($('#adultTitleSheet')) })
$('#adultNetflixLaunchClose')?.addEventListener('click', closeNetflixLaunchChoice)
$('#adultNetflixLaunchSheet')?.addEventListener('click', event => { if (event.target === $('#adultNetflixLaunchSheet')) closeNetflixLaunchChoice() })
$('#adultNetflixLaunchDevice')?.addEventListener('click', launchNetflixOnDevice)
$('#adultNetflixLaunchTv')?.addEventListener('click', () => { void launchNetflixOnTv() })
$('#adultWatchConfirmClose')?.addEventListener('click', () => portalSheets.dismiss($('#adultWatchConfirmSheet')))
$$('[data-viewing-tab]').forEach(button => button.onclick = () => { adultViewingTab = button.dataset.viewingTab; $$('[data-viewing-tab]').forEach(value => value.classList.toggle('active', value === button)); renderAdultViewing() })
$$('[data-viewing-filter]').forEach(button => button.onclick = () => { adultViewingFilter = button.dataset.viewingFilter; $$('[data-viewing-filter]').forEach(value => value.classList.toggle('active', value === button)); renderAdultViewing() })
$$('[data-watch-result]').forEach(button => button.onclick = async () => {
  const pending = (adultViewingData.items || []).find(item => item.key === $('#adultWatchConfirmSheet').dataset.titleKey)
  if (!pending) return
  await updateAdultViewing(pending, button.dataset.watchResult)
  portalSheets.dismiss($('#adultWatchConfirmSheet'))
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash === '#adult-viewing') loadAdultViewing().catch(() => {})
})
