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

function adultSeasonSummary(season, watched = Number(season.watched_count || 0)) {
  const total = Number(season.episodes || 0)
  return watched ? `${watched} of ${total} watched` : `${total} episode${total === 1 ? '' : 's'}`
}

function adultStreamingArtwork(detail, season, result = null, className = 'adult-season-card-art') {
  const art = document.createElement('span')
  art.className = className
  const still = (result?.episodes || []).find(episode => episode.still_path)?.still_path
  const path = still || season.poster_path || result?.poster_path
    || detail.backdrop_path || detail.poster_path
  if (path) {
    const image = document.createElement('img')
    image.src = adultPosterUrl(path, still || path === detail.backdrop_path ? 'w780' : 'w500')
    image.alt = ''
    image.loading = 'lazy'
    art.append(image)
  } else {
    const placeholder = document.createElement('span')
    placeholder.className = 'watch-card-placeholder'
    placeholder.textContent = String(season.number || 1)
    art.append(placeholder)
  }
  return art
}

function syncAdultStreamingSeasonCard(card, season) {
  const total = Number(season.episodes || 0)
  const watched = Number(season.watched_count || 0)
  card.querySelector('.adult-season-card-copy small').textContent = watched
    ? `${watched} watched · Open series` : 'Open series'
  card.querySelector('.adult-season-card-progress').style.setProperty(
    '--season-progress', `${total ? watched / total * 100 : 0}%`)
  card.querySelector('.adult-season-status')?.syncSeasonStatus(watched, total)
}

function deriveAdultTitleNextEpisode(detail) {
  if (detail.media_type !== 'tv') return null
  const rewatching = detail.viewing?.series_watching === true
    && detail.viewing?.series_watching_mode === 'rewatch'
  const states = rewatching
    ? detail.viewing?.rewatch_episodes || {} : detail.viewing?.episodes || {}
  const localSeries = !rewatching && detail.local?.kind === 'series'
    ? (library?.adult_series || []).find(value => value.id === detail.local.series) : null
  const available = []
  ;[...(detail.seasons || [])].sort((a, b) => a.number - b.number).forEach(season => {
    for (let episode = 1; episode <= Number(season.episodes || 0); episode += 1) {
      const local = (localSeries?.episodes || []).find(value =>
        Number(value.season) === Number(season.number)
          && Number(value.episode) === episode)
      available.push({
        season: season.number, episode, title: '', rewatch: rewatching,
        watched: states[`${season.number}:${episode}`]?.watched === true
          || local?.watched === true,
      })
    }
  })
  let lastWatched = -1
  available.forEach((episode, index) => {
    if (episode.watched) lastWatched = index
  })
  return available[lastWatched + 1] || null
}

function adultEpisodeAirDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`
}

function findLocalAdultEpisode(detail, seasonNumber, episodeNumber) {
  if (detail.local?.kind !== 'series') return null
  const series = (library?.adult_series || []).find(value => value.id === detail.local.series)
  if (!series) return null
  const episode = (series.episodes || []).find(value =>
    Number(value.season) === Number(seasonNumber)
      && Number(value.episode) === Number(episodeNumber))
  return episode ? { series, episode } : null
}

function restoreAdultTitleSheet(detail) {
  const sheet = $('#adultTitleSheet')
  portalSheets.open(sheet, { focus: sheet.querySelector('.watch-film-panel') })
  renderAdultTitleDetail(detail, false)
}

async function openAdultEpisodeDestination(detail, season, episode, seasonCard = null) {
  const local = findLocalAdultEpisode(detail, season.number, episode.number)
  if (local) {
    portalSheets.dismiss($('#adultEpisodeLaunchSheet'))
    portalSheets.dismiss($('#adultTitleSeasonSheet'))
    portalSheets.dismiss($('#adultTitleSheet'))
    openAdultEpisodeSheet(local.series, local.episode, () => {
      if (seasonCard) openAdultTitleSeason(detail, season, seasonCard, episode.number)
      else restoreAdultTitleSheet(detail)
    })
    return
  }
  const sheet = $('#adultEpisodeLaunchSheet')
  const root = $('#adultEpisodeProviderList')
  $('#adultEpisodeLaunchEyebrow').textContent = `${detail.title} · Series ${season.number}, Episode ${episode.number}`
  $('#adultEpisodeLaunchTitle').textContent = episode.name || `Episode ${episode.number}`
  $('#adultEpisodeLaunchCopy').textContent = 'Choose a service. It may open the series page rather than this exact episode.'
  root.innerHTML = '<p>Checking streaming destinations…</p>'
  portalSheets.open(sheet)
  const closeBeforeLaunch = () => portalSheets.dismiss(sheet)
  if (detail.provider_result) {
    renderAdultProviderLinksInto(root, detail, detail.provider_result, {
      localAction: null, beforeLaunch: closeBeforeLaunch,
    })
    return
  }
  try {
    const result = await api(`/api/adult/providers?media_type=${detail.media_type}&tmdb_id=${detail.tmdb_id}`)
    detail.provider_result = result
    if (!sheet.open) return
    renderAdultProviderLinksInto(root, detail, result, {
      localAction: null, beforeLaunch: closeBeforeLaunch,
    })
  } catch (error) {
    if (!sheet.open) return
    renderAdultProviderLinksInto(root, detail, { sources: [] }, { localAction: null })
    const message = document.createElement('p')
    message.textContent = error.message || 'Streaming destinations are unavailable right now.'
    root.append(message)
  }
}

function syncAdultTitleNextEpisode(detail) {
  const button = $('#adultTitleNextEpisode')
  const next = deriveAdultTitleNextEpisode(detail)
  detail.next_episode = next
  button.classList.toggle('hidden', !next)
  if (!next) return
  button.querySelector('small').textContent = next.rewatch
    ? 'Next episode in this rewatch' : 'Next episode'
  button.querySelector('strong').textContent = `Series ${next.season}, Episode ${next.episode}${next.title ? ` · ${next.title}` : ''}`
  button.onclick = () => {
    const season = (detail.seasons || []).find(value => value.number === next.season)
      || { number: next.season, episodes: 0 }
    void openAdultEpisodeDestination(detail, season, {
      number: next.episode, name: next.title || `Episode ${next.episode}`,
    })
  }
}

function adultTitleAllEpisodesWatched(detail) {
  const seasons = detail.seasons || []
  if (detail.viewing?.series_watching === true
      && detail.viewing?.series_watching_mode === 'rewatch') {
    const states = detail.viewing?.rewatch_episodes || {}
    return seasons.length > 0 && seasons.every(season => Number(season.episodes || 0) > 0
      && Array.from({ length: Number(season.episodes || 0) }, (_, index) => index + 1)
        .every(episode => states[`${season.number}:${episode}`]?.watched === true))
  }
  return seasons.length > 0 && seasons.every(season => Number(season.episodes || 0) > 0
    && Number(season.watched_count || 0) >= Number(season.episodes || 0))
}

async function finishAdultTitleIfComplete(detail) {
  const rewatching = detail.viewing?.series_watching === true
    && detail.viewing?.series_watching_mode === 'rewatch'
  if (!adultTitleAllEpisodesWatched(detail)
      || (!rewatching && detail.viewing?.manual_state === 'watched')) return
  detail.viewing = await updateAdultViewing(detail, 'watched')
  syncAdultTitleButtons(detail)
}

function adultStreamingEpisodeRow(detail, season, result, episode, card) {
  const rewatching = detail.viewing?.series_watching === true
    && detail.viewing?.series_watching_mode === 'rewatch'
  const isComplete = () => rewatching ? episode.rewatch_watched : episode.watched
  const row = document.createElement('article')
  row.className = `adult-series-episode adult-streaming-episode${isComplete() ? ' is-watched' : ''}`
  row.dataset.episode = String(episode.number)
  row.tabIndex = 0
  row.setAttribute('role', 'button')
  row.setAttribute('aria-label', `Open ${episode.name || `episode ${episode.number}`}`)
  row.onclick = () => { void openAdultEpisodeDestination(detail, season, episode, card) }
  row.onkeydown = event => {
    if (event.target !== row) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    void openAdultEpisodeDestination(detail, season, episode, card)
  }
  const artwork = document.createElement('span')
  artwork.className = 'adult-series-episode-art'
  if (episode.still_path) {
    const image = document.createElement('img')
    image.src = adultPosterUrl(episode.still_path, 'w500')
    image.alt = ''
    image.loading = 'lazy'
    artwork.append(image)
  }
  const number = document.createElement('span')
  number.className = 'adult-series-episode-number'
  number.textContent = `E${String(episode.number).padStart(2, '0')}`
  artwork.append(number)
  const copy = document.createElement('span')
  copy.className = 'adult-series-episode-copy'
  const title = document.createElement('strong')
  title.textContent = episode.name
  const meta = document.createElement('small')
  copy.append(title, meta)
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'adult-streaming-episode-toggle'
  const sync = () => {
    const complete = isComplete()
    const facts = [complete ? rewatching ? 'Watched again' : 'Watched' : '', adultEpisodeAirDate(episode.air_date),
      episode.runtime ? `${episode.runtime} min` : ''].filter(Boolean)
    meta.textContent = facts.join(' · ') || (complete
      ? rewatching ? 'Watched again' : 'Watched' : 'Not watched')
    row.classList.toggle('is-watched', complete)
    toggle.classList.toggle('active', complete)
    toggle.setAttribute('aria-pressed', String(complete))
    toggle.setAttribute('aria-label', `${complete ? rewatching ? 'Mark not watched again' : 'Mark unwatched'
      : rewatching ? 'Mark watched again' : 'Mark watched'}: ${episode.name}`)
    toggle.textContent = complete ? rewatching ? 'Watched again' : 'Watched'
      : rewatching ? 'Mark watched again' : 'Mark watched'
  }
  sync()
  toggle.onclick = async event => {
    event.stopPropagation()
    const next = !isComplete()
    toggle.disabled = true
    try {
      detail.viewing = await updateAdultViewing(detail, 'episode_watched', {
        season: season.number, episode: episode.number, watched: next, rewatch: rewatching,
      })
      const local = findLocalAdultEpisode(detail, season.number, episode.number)
      if (!rewatching && local) local.episode.watched = next
      if (rewatching) episode.rewatch_watched = next
      else episode.watched = next
      const statusCount = result.episodes.filter(value => rewatching
        ? value.rewatch_watched : value.watched).length
      if (!rewatching) season.watched_count = statusCount
      sync()
      syncAdultStreamingSeasonCard(card, season)
      $('#adultTitleSeasonWatched').syncSeasonStatus(statusCount, result.episodes.length)
      $('#adultTitleSeasonMeta').textContent = `${result.episodes.length} episode${result.episodes.length === 1 ? '' : 's'} · ${statusCount} ${rewatching ? 'watched again' : 'watched'}`
      if (next) await finishAdultTitleIfComplete(detail)
      syncAdultTitleNextEpisode(detail)
      notice(next ? rewatching ? 'Episode marked watched again.' : 'Episode marked watched.'
        : rewatching ? 'Removed from this rewatch.' : 'Episode marked unwatched.')
    } catch (error) {
      showError(error)
    } finally {
      toggle.disabled = false
    }
  }
  row.append(artwork, copy, toggle)
  return row
}

async function openAdultTitleSeason(detail, season, card, targetEpisode = 0) {
  const revision = ++adultSeasonOpenRevision
  const titleSheet = $('#adultTitleSheet')
  const seasonSheet = $('#adultTitleSeasonSheet')
  portalSheets.dismiss(titleSheet)
  $('#adultTitleSeasonEyebrow').textContent = detail.title
  $('#adultTitleSeasonName').textContent = `Series ${season.number}`
  $('#adultTitleSeasonMeta').textContent = adultSeasonSummary(season)
  $('#adultTitleSeasonEpisodeHeading').textContent = `Series ${season.number} episodes`
  $('#adultTitleSeasonEpisodeCount').textContent = `${Number(season.episodes || 0)} total`
  $('#adultTitleSeasonOverview').classList.add('hidden')
  $('#adultTitleSeasonArtwork').replaceChildren(adultStreamingArtwork(
    detail, season, null, 'adult-season-sheet-artwork'))
  const bulk = $('#adultTitleSeasonWatched')
  bulk.disabled = true
  bulk.replaceChildren(librarySignalIcon('signal-check'),
    Object.assign(document.createElement('span'), { textContent: 'Loading series status…' }))
  const root = $('#adultTitleSeasonEpisodes')
  root.innerHTML = '<div class="adult-series-empty"><strong>Loading episodes…</strong><span>Fetching episode details and artwork.</span></div>'
  portalSheets.open(seasonSheet, {
    returnTo: () => {
      portalSheets.open(titleSheet, { focus: titleSheet.querySelector('.watch-film-panel') })
      renderAdultTitleDetail(detail, false)
    },
  })
  try {
    const result = await api(`/api/adult/season?tmdb_id=${detail.tmdb_id}&season=${season.number}`)
    if (revision !== adultSeasonOpenRevision) return
    const rewatching = detail.viewing?.series_watching === true
      && detail.viewing?.series_watching_mode === 'rewatch'
    season.watched_count = result.episodes.filter(episode => episode.watched).length
    const statusCount = result.episodes.filter(episode => rewatching
      ? episode.rewatch_watched : episode.watched).length
    $('#adultTitleSeasonMeta').textContent = `${result.episodes.length} episode${result.episodes.length === 1 ? '' : 's'} · ${statusCount} ${rewatching ? 'watched again' : 'watched'}`
    $('#adultTitleSeasonEpisodeCount').textContent = `${result.episodes.length} total`
    const overview = $('#adultTitleSeasonOverview')
    overview.textContent = result.overview || season.overview || ''
    overview.classList.toggle('hidden', !overview.textContent)
    $('#adultTitleSeasonArtwork').replaceChildren(adultStreamingArtwork(
      detail, season, result, 'adult-season-sheet-artwork'))
    root.replaceChildren(...result.episodes.map(episode =>
      adultStreamingEpisodeRow(detail, season, result, episode, card)))
    if (!result.episodes.length) root.innerHTML = '<div class="adult-series-empty"><strong>No episodes found</strong><span>TMDB has no episode details for this series yet.</span></div>'
    wireAdultSeasonBulkButton($('#adultTitleSeasonWatched'), rewatching
      ? `Series ${season.number} rewatch` : `Series ${season.number}`,
      statusCount, result.episodes.length, async targetWatched => {
        detail.viewing = await updateAdultViewing(detail, 'season_watched', {
          season: season.number, episode_count: result.episodes.length,
          watched: targetWatched, rewatch: rewatching,
        })
        result.episodes.forEach(episode => {
          if (rewatching) episode.rewatch_watched = targetWatched
          else episode.watched = targetWatched
        })
        if (!rewatching && detail.local?.kind === 'series') {
          const localSeries = (library?.adult_series || []).find(value =>
            value.id === detail.local.series)
          ;(localSeries?.episodes || []).filter(episode =>
            Number(episode.season) === Number(season.number))
            .forEach(episode => { episode.watched = targetWatched })
        }
        if (!rewatching) season.watched_count = targetWatched ? result.episodes.length : 0
        if (targetWatched) await finishAdultTitleIfComplete(detail)
        syncAdultStreamingSeasonCard(card, season)
        syncAdultTitleNextEpisode(detail)
        portalSheets.close(seasonSheet, { restore: false })
        openAdultTitleSeason(detail, season, card, targetEpisode)
        notice(targetWatched ? rewatching ? `Series ${season.number} marked watched again.`
          : `Series ${season.number} marked watched.` : rewatching
          ? `Series ${season.number} removed from this rewatch.`
          : `Series ${season.number} marked unwatched.`)
        return targetWatched ? result.episodes.length : 0
      })
    bulk.disabled = false
    syncAdultStreamingSeasonCard(card, season)
    if (targetEpisode) {
      const target = root.querySelector(`[data-episode="${targetEpisode}"]`)
      target?.classList.add('is-next')
      requestAnimationFrame(() => target?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    }
  } catch (error) {
    if (revision !== adultSeasonOpenRevision) return
    root.innerHTML = `<div class="adult-series-empty"><strong>Episodes unavailable</strong><span>${escapeHtml(error.message)}</span></div>`
  }
}

function renderAdultTitleSeasons(detail) {
  const wrapper = $('#adultTitleSeriesLibrary')
  const seasons = $('#adultTitleSeasons')
  seasons.replaceChildren()
  const visible = detail.media_type === 'tv' && (detail.seasons || []).length
  wrapper.classList.toggle('hidden', !visible)
  if (!visible) return
  $('#adultTitleSeasonCount').textContent = `${detail.seasons.length} series`
  ;(detail.seasons || []).forEach(season => {
    const card = document.createElement('article')
    card.className = 'adult-season-card adult-streaming-season-card'
    card.dataset.season = String(season.number)
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    const art = adultStreamingArtwork(detail, season)
    const shade = document.createElement('span')
    shade.className = 'adult-season-card-shade'
    const copy = document.createElement('span')
    copy.className = 'adult-season-card-copy'
    const kicker = document.createElement('span')
    kicker.textContent = `${detail.title} · ${Number(season.episodes || 0)} episode${Number(season.episodes || 0) === 1 ? '' : 's'}`
    const heading = document.createElement('strong')
    heading.textContent = `Series ${season.number}`
    const summary = document.createElement('small')
    copy.append(kicker, heading, summary)
    const progress = document.createElement('span')
    progress.className = 'adult-season-card-progress'
    const openSeason = () => openAdultTitleSeason(detail, season, card)
    card.onclick = openSeason
    card.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSeason() }
    }
    const status = document.createElement('button')
    status.type = 'button'
    wireAdultSeasonBulkButton(status, `Series ${season.number}`,
      season.watched_count, season.episodes, async targetWatched => {
        detail.viewing = await updateAdultViewing(detail, 'season_watched', {
          season: season.number, episode_count: season.episodes, watched: targetWatched,
        })
        season.watched_count = targetWatched ? Number(season.episodes || 0) : 0
        if (targetWatched) await finishAdultTitleIfComplete(detail)
        syncAdultStreamingSeasonCard(card, season)
        syncAdultTitleNextEpisode(detail)
        renderAdultTitleDetail(detail, false)
        notice(targetWatched ? `Series ${season.number} marked watched.`
          : `Series ${season.number} marked unwatched.`)
        return season.watched_count
      }, true)
    card.append(art, shade, copy, progress,
      librarySignalIcon('signal-chevron-right', 'icon adult-season-card-chevron'), status)
    syncAdultStreamingSeasonCard(card, season)
    seasons.append(card)
  })
  syncAdultTitleNextEpisode(detail)
}

function adultTitleIntentAction(detail, button, request) {
  return async () => {
    if (button.disabled) return
    button.disabled = true
    try {
      const { action, extra = {} } = request()
      detail.viewing = await updateAdultViewing(detail, action, extra)
      syncAdultTitleButtons(detail)
      syncAdultTitleNextEpisode(detail)
      if (action === 'watchlist') notice(detail.viewing.watchlisted
        ? 'Added to Watchlist.' : 'Removed from Watchlist.')
      else if (action === 'rewatch') notice(detail.viewing.rewatch
        ? 'Added to Rewatch.' : 'Removed from Rewatch.')
      else if (action === 'up_next') notice(detail.viewing.up_next
        ? 'Added to Up Next.' : 'Removed from Up Next.')
      else if (action === 'watching') notice(detail.viewing.series_watching
        ? 'Series added to Watching and Up Next.' : 'Series removed from Watching.')
      else if (action === 'watched') notice('Marked watched and removed from Watchlist and Up Next.')
      else if (action === 'not_watched') notice('Corrected. Its watched-history record is retained.')
    } catch (error) {
      showError(error)
    } finally {
      button.disabled = false
    }
  }
}

function renderAdultTitleDetail(detail, refreshProviders = true,
                                revision = adultTitleOpenRevision) {
  selectedAdultTitle = detail
  const sheet = $('#adultTitleSheet')
  sheet.classList.remove('is-loading-title')
  const isSeries = detail.media_type === 'tv'
  sheet.classList.toggle('is-series', isSeries)
  $('#adultTitleName').textContent = detail.title
  $('#adultTitleEyebrow').textContent = detail.on_mabeltv
    ? 'On MabelTV' : isSeries ? 'Streaming TV series' : 'Film'
  $('#adultTitleOverview').textContent = detail.overview || 'No description is available.'
  renderAdultTitleSeasons(detail)
  const metadata = $('#adultTitleMeta')
  metadata.replaceChildren()
  const values = isSeries ? [
    `${(detail.seasons || []).length} series`,
    `${(detail.seasons || []).reduce((total, season) => total + Number(season.episodes || 0), 0)} episodes`,
    `${(detail.seasons || []).reduce((total, season) => total + Number(season.watched_count || 0), 0)} watched`,
  ] : [detail.year, detail.runtime ? `${detail.runtime} min` : '', ...(detail.genres || []).slice(0, 2)]
  values.filter(Boolean).forEach(value => {
    const span = document.createElement('span')
    span.textContent = value
    metadata.append(span)
  })
  const poster = $('#adultTitlePoster')
  poster.replaceChildren()
  if (detail.poster_path) {
    const image = document.createElement('img')
    image.src = adultPosterUrl(detail.poster_path, 'w500')
    image.alt = `Poster for ${detail.title}`
    poster.append(image)
  }
  $('#adultTitleBackdrop').style.setProperty('--watch-film-art', detail.backdrop_path
    ? `url("${adultPosterUrl(detail.backdrop_path, 'w1280')}")`
    : 'linear-gradient(135deg,#2e3a34,#101513)')
  $('#adultTitleLocal').classList.toggle('hidden', !detail.on_mabeltv)
  $('#adultTitleLocalCopy').textContent = detail.on_mabeltv
    ? detail.media_type === 'tv'
      ? 'Available locally on MabelTV. Stored episodes offer Play on TV and Watch on this device.'
      : 'Available locally on MabelTV — this option is always shown first.'
    : ''
  const manageLocal = $('#adultTitleManageLocal')
  manageLocal.classList.toggle('hidden', detail.local?.kind !== 'series')
  manageLocal.onclick = detail.local?.kind === 'series'
    ? () => manageLocalAdultSeries(detail) : null
  syncAdultTitleButtons(detail)
  const watchlist = $('#adultTitleWatchlist')
  const rewatch = $('#adultTitleRewatch')
  const upNext = $('#adultTitleUpNext')
  const watching = $('#adultTitleWatching')
  const watched = $('#adultTitleWatched')
  watchlist.onclick = () => {
    const status = adultTitleViewingStatus(detail.viewing, detail)
    if (status.inProgress && !detail.viewing?.watchlisted) {
      notice('This series is already in progress. Continue it from Watching or Up Next.', true)
      return
    }
    if (status.completed && !detail.viewing?.watchlisted) {
      notice('You have already seen this. Add it to Rewatch instead.', true)
      return
    }
    adultTitleIntentAction(detail, watchlist, () => ({
      action: 'watchlist', extra: { enabled: !detail.viewing?.watchlisted },
    }))()
  }
  rewatch.onclick = () => {
    if (!adultTitleViewingStatus(detail.viewing, detail).completed && !detail.viewing?.rewatch) {
      notice('Mark this watched before adding it to Rewatch.', true)
      return
    }
    adultTitleIntentAction(detail, rewatch, () => ({
      action: 'rewatch', extra: { enabled: !detail.viewing?.rewatch },
    }))()
  }
  upNext.onclick = adultTitleIntentAction(detail, upNext, () => ({
    action: 'up_next', extra: { enabled: !detail.viewing?.up_next },
  }))
  watching.onclick = adultTitleIntentAction(detail, watching, () => ({
    action: 'watching', extra: {
      enabled: !detail.viewing?.series_watching,
      mode: (detail.viewing?.rewatch === true
        || ((detail.seasons || []).length > 0 && (detail.seasons || []).every(season =>
          Number(season.watched_count || 0) >= Number(season.episodes || 0))))
        ? 'rewatch' : 'first_watch',
    },
  }))
  watched.onclick = adultTitleIntentAction(detail, watched, () => ({
    action: detail.viewing?.manual_state === 'watched' ? 'not_watched' : 'watched',
  }))
  $('#adultProviderRefresh').onclick = () => loadAdultProviders(detail, true, revision)
  if (refreshProviders) {
    $('#adultProviderList').innerHTML = '<p>Checking streaming destinations…</p>'
    loadAdultProviders(detail, false, revision)
  }
}

function prepareAdultTitleSheet(title) {
  const sheet = $('#adultTitleSheet')
  const panel = sheet.querySelector('.watch-film-panel')
  selectedAdultTitle = title
  sheet.classList.add('is-loading-title')
  panel.scrollTop = 0
  panel.scrollLeft = 0
  sheet.classList.toggle('is-series', title.media_type === 'tv')
  $('#adultTitleName').textContent = title.title || 'Loading title…'
  $('#adultTitleEyebrow').textContent = title.media_type === 'tv'
    ? 'Streaming TV series' : 'Film'
  $('#adultTitleOverview').textContent = 'Loading title details…'
  $('#adultTitleMeta').replaceChildren()
  $('#adultTitlePoster').replaceChildren()
  $('#adultTitleBackdrop').style.setProperty('--watch-film-art',
    'linear-gradient(135deg,#27252c,#101014)')
  $('#adultTitleSeriesLibrary').classList.add('hidden')
  $('#adultTitleSeasons').replaceChildren()
  $('#adultTitleNextEpisode').classList.add('hidden')
  $('#adultTitleLocal').classList.add('hidden')
  $('#adultTitleLocalCopy').textContent = ''
  $('#adultTitleManageLocal').classList.add('hidden')
  $('#adultProviderList').innerHTML = '<p>Loading…</p>'
  ;['#adultTitleWatchlist', '#adultTitleRewatch', '#adultTitleUpNext',
    '#adultTitleWatching', '#adultTitleWatched'].forEach(selector => {
    const button = $(selector)
    button.classList.remove('active', 'is-unavailable', 'is-progress')
    button.setAttribute('aria-pressed', 'false')
  })
  return sheet
}

async function openAdultTitle(title) {
  const revision = ++adultTitleOpenRevision
  const sheet = prepareAdultTitleSheet(title)
  portalSheets.open(sheet, { focus: sheet.querySelector('.watch-film-panel') })
  try {
    const detail = await api(`/api/adult/title?media_type=${title.media_type}&tmdb_id=${title.tmdb_id}`)
    if (revision !== adultTitleOpenRevision) return
    renderAdultTitleDetail(detail, true, revision)
  } catch (error) {
    if (revision !== adultTitleOpenRevision) return
    $('#adultTitleOverview').textContent = error.message
  }
}

function adultViewingItems() {
  const items = adultViewingData.items || []
  return items.filter(item => {
    const watchedEpisodes = Object.values(item.episodes || {})
      .filter(episode => episode?.watched === true).length
    if (adultViewingTab === 'up-next' && !item.up_next) return false
    if (adultViewingTab === 'watchlist' && !item.watchlisted) return false
    if (adultViewingTab === 'rewatch' && !item.rewatch) return false
    if (adultViewingTab === 'watching') {
      if (item.media_type === 'tv' && item.series_watching !== true) return false
      if (item.media_type === 'movie' && Number(item.local_progress?.position || 0) <= 0) return false
    }
    if (adultViewingTab === 'history' && item.manual_state !== 'watched'
        && !(item.history || []).length && !watchedEpisodes) return false
    if (adultViewingFilter === 'movie' || adultViewingFilter === 'tv') return item.media_type === adultViewingFilter
    if (adultViewingFilter === 'local') return item.on_mabeltv
    return true
  }).sort((a, b) => adultViewingTab === 'up-next'
    ? Number(a.up_next_rank || 999999) - Number(b.up_next_rank || 999999)
    : Number(b.viewing_updated || b.updated || 0) - Number(a.viewing_updated || a.updated || 0))
}

function renderAdultViewing() {
  const labels = {
    'up-next': ['Your chosen order', 'Up Next'],
    watchlist: ['Unseen and saved for later', 'Watchlist'],
    rewatch: ['Worth enjoying again', 'Rewatch'],
    watching: ['In progress', 'Watching'],
    history: ['Everything you have seen', 'Watched'],
  }
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
    const watchedEpisodes = Object.values(item.episodes || {})
      .filter(episode => episode?.watched === true).length
    const localNext = item.local?.next_episode
    const filmProgress = item.media_type === 'movie'
      ? Number(item.local_progress?.position || 0) : 0
    const seriesStatus = item.media_type === 'tv' && item.series_watching && localNext
      ? `Next · S${String(localNext.season).padStart(2, '0')} E${String(localNext.episode).padStart(2, '0')}`
      : item.media_type === 'tv' ? watchedEpisodes
        ? `${watchedEpisodes} episode${watchedEpisodes === 1 ? '' : 's'} watched` : 'TV series'
        : filmProgress > 0 ? `Continue · ${watchTimeLabel(filmProgress)}` : 'Film'
    const meta = document.createElement('span'); meta.textContent = [item.year,
      seriesStatus,
      item.on_mabeltv ? 'On MabelTV' : 'Streaming'].filter(Boolean).join(' · ')
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

async function loadAdultViewing() {
  adultViewingData = await api('/api/adult/viewing')
  renderAdultViewing()
}

$('#watchSearch')?.addEventListener('input', scheduleAdultDiscovery)
$('#watchSearch')?.addEventListener('focus', () => { syncAdultSearchMode(true); scheduleAdultDiscovery() })
$('#watchSearch')?.addEventListener('blur', () => setTimeout(() => syncAdultSearchMode(), 0))
$('#watchSearch')?.addEventListener('change', () => setTimeout(syncAdultSearchKeyboard, 60))
$('#watchSearch')?.addEventListener('search', () => setTimeout(syncAdultSearchKeyboard, 60))
$('#watchSearch')?.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  event.currentTarget.value = ''
  event.currentTarget.dispatchEvent(new Event('input', { bubbles: true }))
  event.currentTarget.blur()
})
$('#watchSearchClear')?.addEventListener('click', () => setTimeout(() => { searchAdultDiscovery(''); syncAdultSearchMode(true) }, 0))
window.visualViewport?.addEventListener('resize', () =>
  setTimeout(syncAdultSearchKeyboard, 60))
window.addEventListener('orientationchange', () => setTimeout(() => {
  adultSearchViewportBaseline = window.visualViewport?.height || window.innerHeight
  adultSearchKeyboardWasOpen = false
}, 400))
$('#adultMyViewing')?.addEventListener('click', () => { history.pushState({ adultViewing: true }, '', '#adult-viewing'); openView('adult-viewing'); loadAdultViewing().catch(showError) })
$('#adultViewingBack')?.addEventListener('click', () => {
  remoteKind = 'adult'
  renderRemoteViewing()
  history.replaceState({ consolidatedWatch: true }, '', '#watch')
  openView('watch', { instantScroll: true })
})
function closeAdultTitleSheet() {
  adultTitleOpenRevision += 1
  selectedAdultTitle = null
  portalSheets.dismiss($('#adultTitleSheet'))
}
$('#adultTitleClose')?.addEventListener('click', closeAdultTitleSheet)
$('#adultTitleSheet')?.addEventListener('click', event => { if (event.target === $('#adultTitleSheet')) closeAdultTitleSheet() })
function closeAdultTitleSeasonSheet() {
  adultSeasonOpenRevision += 1
  portalSheets.close($('#adultTitleSeasonSheet'))
}
$('#adultTitleSeasonClose')?.addEventListener('click', closeAdultTitleSeasonSheet)
$('#adultTitleSeasonSheet')?.addEventListener('click', event => { if (event.target === $('#adultTitleSeasonSheet')) closeAdultTitleSeasonSheet() })
$('#adultTitleSeasonSheet')?.addEventListener('cancel', event => { event.preventDefault(); closeAdultTitleSeasonSheet() })
$('#adultNetflixLaunchClose')?.addEventListener('click', closeNetflixLaunchChoice)
$('#adultNetflixLaunchSheet')?.addEventListener('click', event => { if (event.target === $('#adultNetflixLaunchSheet')) closeNetflixLaunchChoice() })
$('#adultNetflixLaunchDevice')?.addEventListener('click', launchNetflixOnDevice)
$('#adultNetflixLaunchTv')?.addEventListener('click', () => { void launchNetflixOnTv() })
function closeAdultEpisodeLaunchSheet() {
  portalSheets.dismiss($('#adultEpisodeLaunchSheet'))
}
$('#adultEpisodeLaunchClose')?.addEventListener('click', closeAdultEpisodeLaunchSheet)
$('#adultEpisodeLaunchSheet')?.addEventListener('click', event => {
  if (event.target === $('#adultEpisodeLaunchSheet')) closeAdultEpisodeLaunchSheet()
})
$$('[data-viewing-tab]').forEach(button => button.onclick = () => { adultViewingTab = button.dataset.viewingTab; $$('[data-viewing-tab]').forEach(value => value.classList.toggle('active', value === button)); renderAdultViewing() })
$$('[data-viewing-filter]').forEach(button => button.onclick = () => { adultViewingFilter = button.dataset.viewingFilter; $$('[data-viewing-filter]').forEach(value => value.classList.toggle('active', value === button)); renderAdultViewing() })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash === '#adult-viewing') loadAdultViewing().catch(() => {})
})
