'use strict'

let adultDiscoveryTimer = null
let adultDiscoveryRevision = 0
let adultViewingData = { items: [] }
let adultViewingTab = 'watchlist'
let adultViewingFilter = 'all'
let selectedAdultTitle = null
let pendingNetflixLaunch = null
let adultTitleOpenRevision = 0
let adultSeasonOpenRevision = 0
let adultSearchViewportBaseline = Math.max(
  window.innerHeight, window.visualViewport?.height || 0)
let adultSearchKeyboardWasOpen = false

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
  await loadAdultViewing()
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

function syncAdultSearchMode(scrollToSearch = false) {
  const input = $('#watchSearch')
  const view = $('#view-watch')
  if (!input || !view) return
  const focused = document.activeElement === input
  const query = input.value.trim()
  const active = focused || Boolean(query)
  view.classList.toggle('adult-search-mode', active)
  if (active && query.length < 2) {
    $('#adultDiscoverySection').classList.remove('hidden')
    $('#adultDiscoveryCount').textContent = ''
    $('#adultDiscoveryGrid').innerHTML = '<div class="watch-empty adult-search-prompt"><strong>Search Adult TV</strong><br>Type at least two letters to search your library and streaming catalogue.</div>'
  } else if (!active) {
    $('#adultDiscoverySection').classList.add('hidden')
  }
  if (scrollToSearch) setTimeout(() => input.scrollIntoView({ block: 'start' }), 80)
}

function syncAdultSearchKeyboard() {
  const viewport = window.visualViewport
  if (!viewport) return
  adultSearchViewportBaseline = Math.max(adultSearchViewportBaseline, viewport.height)
  const keyboardOpen = adultSearchViewportBaseline - viewport.height > 120
  if (keyboardOpen) {
    adultSearchKeyboardWasOpen = true
    return
  }
  if (!adultSearchKeyboardWasOpen) return
  adultSearchKeyboardWasOpen = false
  const input = $('#watchSearch')
  if (input && document.activeElement === input && !input.value.trim()) {
    input.blur()
    syncAdultSearchMode()
  }
}

async function searchAdultDiscovery(query) {
  const revision = ++adultDiscoveryRevision
  const section = $('#adultDiscoverySection')
  const root = $('#adultDiscoveryGrid')
  if (query.trim().length < 2) {
    syncAdultSearchMode()
    return
  }
  syncAdultSearchMode()
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
  syncAdultSearchMode()
  if (query.trim().length < 2) searchAdultDiscovery('')
  else adultDiscoveryTimer = setTimeout(() => searchAdultDiscovery(query), 320)
}

function localAdultAction(detail) {
  if (!detail.local) return null
  if (detail.local.kind === 'film') {
    const film = (library?.adult_library || []).find(item => item.path === detail.local.path)
    return film ? () => { portalSheets.dismiss($('#adultTitleSheet')); openWatchFilmSheet(film) } : null
  }
  return null
}

function manageLocalAdultSeries(detail) {
  const series = (library?.adult_series || []).find(item => item.id === detail.local?.series)
  if (!series) return
  portalSheets.dismiss($('#adultTitleSheet'))
  openAdultSeriesSheet(series, () => restoreAdultTitleSheet(detail))
}

function renderAdultProviderLinksInto(root, detail, result, options = {}) {
  root.replaceChildren()
  const localAction = Object.prototype.hasOwnProperty.call(options, 'localAction')
    ? options.localAction : localAdultAction(detail)
  const beforeLaunch = options.beforeLaunch || (() => {})
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
  if (detail.on_mabeltv) {
    const local = document.createElement(localAction ? 'button' : 'span')
    if (localAction) local.type = 'button'
    local.className = `adult-provider-logo provider-mabeltv${localAction ? '' : ' is-availability'}`
    local.setAttribute('aria-label', localAction ? 'Open on MabelTV' : 'Available on MabelTV')
    local.title = localAction ? 'Open on MabelTV' : 'Available on MabelTV'
    const image = document.createElement('img')
    image.src = '/apple-touch-icon.png'; image.alt = 'MabelTV'
    local.append(image)
    if (localAction) local.onclick = () => { beforeLaunch(); localAction() }
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
      beforeLaunch()
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

function renderAdultProviderLinks(detail, result) {
  renderAdultProviderLinksInto($('#adultProviderList'), detail, result)
}

async function loadAdultProviders(detail, refresh = false, revision = adultTitleOpenRevision) {
  const root = $('#adultProviderList')
  root.innerHTML = '<p>Checking streaming destinations…</p>'
  try {
    const result = await api(`/api/adult/providers?media_type=${detail.media_type}&tmdb_id=${detail.tmdb_id}${refresh ? '&refresh=1' : ''}`)
    if (revision !== adultTitleOpenRevision || selectedAdultTitle?.key !== detail.key) return
    detail.provider_result = result
    renderAdultProviderLinks(detail, result)
  } catch (error) {
    if (revision !== adultTitleOpenRevision || selectedAdultTitle?.key !== detail.key) return
    renderAdultProviderLinks(detail, { sources: [] })
    const message = document.createElement('p')
    message.textContent = error.message
    root.append(message)
  }
}

function adultTitleViewingStatus(state = {}, detail = {}) {
  const completed = state.manual_state === 'watched' || Boolean((state.history || []).length)
  const watchedEpisodes = Object.values(state.episodes || {})
    .filter(episode => episode?.watched === true).length
  const progress = Math.max(watchedEpisodes, Number(detail.local?.watched_count || 0))
  return { completed, inProgress: !completed && progress > 0, progress }
}

function syncAdultTitleButtons(detail) {
  const state = detail.viewing || {}
  const watchlist = $('#adultTitleWatchlist')
  const rewatch = $('#adultTitleRewatch')
  const upNext = $('#adultTitleUpNext')
  const watching = $('#adultTitleWatching')
  const watched = $('#adultTitleWatched')
  const sync = (button, active, title, description) => {
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
    button.querySelector('strong').textContent = title
    button.querySelector('small').textContent = description
  }
  const status = adultTitleViewingStatus(state, detail)
  sync(watchlist, state.watchlisted === true,
    state.watchlisted ? 'In your Watchlist' : status.inProgress ? 'Series in progress'
      : status.completed ? 'Already watched' : 'Add to Watchlist',
    state.watchlisted ? 'Unseen and saved for later'
      : status.inProgress ? 'Continue it from Watching or Up Next'
        : status.completed ? 'Use Rewatch for something you have seen' : 'Keep this unseen title saved for later')
  watchlist.classList.toggle('is-unavailable', (status.completed || status.inProgress) && !state.watchlisted)
  watchlist.classList.toggle('is-progress', status.inProgress && !state.watchlisted)
  sync(rewatch, state.rewatch === true,
    state.rewatch ? 'In your Rewatch list' : 'Add to Rewatch',
    state.rewatch ? 'Saved to enjoy again' : status.completed
      ? 'Remember this for another watch' : 'Available once you mark it watched')
  rewatch.classList.toggle('is-unavailable', !status.completed && !state.rewatch)
  sync(upNext, state.up_next === true,
    state.up_next ? 'In Up Next' : 'Add to Up Next',
    state.up_next ? 'Queued as a priority' : 'Place it in your ordered queue')
  const titleWatched = state.manual_state === 'watched'
  watching.classList.toggle('hidden', detail.media_type !== 'tv')
  if (detail.media_type === 'tv') {
    const rewatching = state.series_watching === true
      && state.series_watching_mode === 'rewatch'
    sync(watching, state.series_watching === true,
      state.series_watching ? rewatching ? 'Rewatching this series' : 'Watching this series'
        : state.rewatch ? 'Start rewatching series' : 'Start watching series',
      state.series_watching ? 'Its next episode stays in Up Next' : 'Keep the show and its next episode in Up Next')
  }
  watched.classList.toggle('hidden', detail.media_type === 'tv')
  sync(watched, titleWatched,
    titleWatched ? 'Watched' : 'Mark watched',
    titleWatched ? 'In your watched history' : 'Moves it out of Watchlist and Up Next')
}

