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
  const watchlist = $('#adultTitleWatchlist')
  const upNext = $('#adultTitleUpNext')
  const watched = $('#adultTitleWatched')
  const sync = (button, active, title, description) => {
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
    button.querySelector('strong').textContent = title
    button.querySelector('small').textContent = description
  }
  sync(watchlist, state.watchlisted === true,
    state.watchlisted ? 'In your Watchlist' : 'Add to Watchlist',
    state.watchlisted ? 'Stays here until you remove it' : 'Keep it saved, even after watching')
  sync(upNext, state.up_next === true,
    state.up_next ? 'In Up Next' : 'Add to Up Next',
    state.up_next ? 'Queued as a priority' : 'Place it in your ordered queue')
  const titleWatched = state.manual_state === 'watched'
  sync(watched, titleWatched,
    titleWatched ? `Mark ${detail.media_type === 'tv' ? 'show ' : ''}unwatched`
      : `Mark ${detail.media_type === 'tv' ? 'show ' : ''}watched`,
    detail.media_type === 'tv'
      ? 'Show history and episode marks are tracked separately'
      : titleWatched ? 'Watchlist and history are kept' : 'Removes it from Up Next, not Watchlist')
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
}

function adultStreamingEpisodeRow(detail, season, result, episode, card) {
  const row = document.createElement('article')
  row.className = `adult-series-episode adult-streaming-episode${episode.watched ? ' is-watched' : ''}`
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
    const facts = [episode.watched ? 'Watched' : '', episode.air_date?.slice(0, 4),
      episode.runtime ? `${episode.runtime} min` : ''].filter(Boolean)
    meta.textContent = facts.join(' · ') || (episode.watched ? 'Watched' : 'Not watched')
    row.classList.toggle('is-watched', episode.watched)
    toggle.classList.toggle('active', episode.watched)
    toggle.setAttribute('aria-pressed', String(episode.watched))
    toggle.setAttribute('aria-label', `${episode.watched ? 'Mark unwatched' : 'Mark watched'}: ${episode.name}`)
    toggle.textContent = episode.watched ? 'Watched' : 'Mark watched'
  }
  sync()
  toggle.onclick = async () => {
    const next = !episode.watched
    toggle.disabled = true
    try {
      detail.viewing = await updateAdultViewing(detail, 'episode_watched', {
        season: season.number, episode: episode.number, watched: next,
      })
      episode.watched = next
      season.watched_count = result.episodes.filter(value => value.watched).length
      sync()
      syncAdultStreamingSeasonCard(card, season)
      $('#adultTitleSeasonMeta').textContent = `${result.episodes.length} episode${result.episodes.length === 1 ? '' : 's'} · ${season.watched_count} watched`
      notice(next ? 'Episode marked watched.' : 'Episode marked unwatched.')
    } catch (error) {
      showError(error)
    } finally {
      toggle.disabled = false
    }
  }
  row.append(artwork, copy, toggle)
  return row
}

async function openAdultTitleSeason(detail, season, card) {
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
    season.watched_count = result.episodes.filter(episode => episode.watched).length
    $('#adultTitleSeasonMeta').textContent = `${result.episodes.length} episode${result.episodes.length === 1 ? '' : 's'} · ${season.watched_count} watched`
    $('#adultTitleSeasonEpisodeCount').textContent = `${result.episodes.length} total`
    const overview = $('#adultTitleSeasonOverview')
    overview.textContent = result.overview || season.overview || ''
    overview.classList.toggle('hidden', !overview.textContent)
    $('#adultTitleSeasonArtwork').replaceChildren(adultStreamingArtwork(
      detail, season, result, 'adult-season-sheet-artwork'))
    root.replaceChildren(...result.episodes.map(episode =>
      adultStreamingEpisodeRow(detail, season, result, episode, card)))
    if (!result.episodes.length) root.innerHTML = '<div class="adult-series-empty"><strong>No episodes found</strong><span>TMDB has no episode details for this series yet.</span></div>'
    syncAdultStreamingSeasonCard(card, season)
  } catch (error) {
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
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'adult-season-card adult-streaming-season-card'
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
    card.append(art, shade, copy, progress,
      librarySignalIcon('signal-chevron-right', 'icon adult-season-card-chevron'))
    syncAdultStreamingSeasonCard(card, season)
    card.onclick = () => openAdultTitleSeason(detail, season, card)
    seasons.append(card)
  })
}

function adultTitleIntentAction(detail, button, request) {
  return async () => {
    if (button.disabled) return
    button.disabled = true
    try {
      const { action, extra = {} } = request()
      detail.viewing = await updateAdultViewing(detail, action, extra)
      syncAdultTitleButtons(detail)
      if (action === 'watchlist') notice(detail.viewing.watchlisted
        ? 'Added to Watchlist. It stays there until you remove it.' : 'Removed from Watchlist.')
      else if (action === 'up_next') notice(detail.viewing.up_next
        ? 'Added to Up Next.' : 'Removed from Up Next.')
      else if (action === 'watched') notice('Marked watched. It was removed from Up Next but kept in your Watchlist.')
      else if (action === 'not_watched') notice('Marked unwatched. Watchlist and viewing history were kept.')
    } catch (error) {
      showError(error)
    } finally {
      button.disabled = false
    }
  }
}

function renderAdultTitleDetail(detail, refreshProviders = true) {
  selectedAdultTitle = detail
  const sheet = $('#adultTitleSheet')
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
  $('#adultTitleLocal').textContent = detail.on_mabeltv
    ? 'Available locally on MabelTV — this option is always shown first.' : ''
  syncAdultTitleButtons(detail)
  const watchlist = $('#adultTitleWatchlist')
  const upNext = $('#adultTitleUpNext')
  const watched = $('#adultTitleWatched')
  watchlist.onclick = adultTitleIntentAction(detail, watchlist, () => ({
    action: 'watchlist', extra: { enabled: !detail.viewing?.watchlisted },
  }))
  upNext.onclick = adultTitleIntentAction(detail, upNext, () => ({
    action: 'up_next', extra: { enabled: !detail.viewing?.up_next },
  }))
  watched.onclick = adultTitleIntentAction(detail, watched, () => ({
    action: detail.viewing?.manual_state === 'watched' ? 'not_watched' : 'watched',
  }))
  $('#adultProviderRefresh').onclick = () => loadAdultProviders(detail, true)
  if (refreshProviders) {
    $('#adultProviderList').innerHTML = '<p>Checking streaming destinations…</p>'
    loadAdultProviders(detail)
  }
}

async function openAdultTitle(title) {
  const sheet = $('#adultTitleSheet')
  selectedAdultTitle = title
  sheet.classList.toggle('is-series', title.media_type === 'tv')
  portalSheets.open(sheet, { focus: sheet.querySelector('.watch-film-panel') })
  $('#adultTitleName').textContent = title.title
  $('#adultTitleOverview').textContent = 'Loading title details…'
  $('#adultTitleSeriesLibrary').classList.add('hidden')
  $('#adultProviderList').innerHTML = '<p>Loading…</p>'
  try {
    const detail = await api(`/api/adult/title?media_type=${title.media_type}&tmdb_id=${title.tmdb_id}`)
    renderAdultTitleDetail(detail)
  } catch (error) {
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
    if (adultViewingTab === 'watching' && item.manual_state !== 'part_watched'
        && !item.local_progress && !watchedEpisodes) return false
    if (adultViewingTab === 'history' && item.manual_state !== 'watched'
        && !(item.history || []).length && !watchedEpisodes) return false
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
    const watchedEpisodes = Object.values(item.episodes || {})
      .filter(episode => episode?.watched === true).length
    const meta = document.createElement('span'); meta.textContent = [item.year,
      item.media_type === 'tv' ? watchedEpisodes
        ? `${watchedEpisodes} episode${watchedEpisodes === 1 ? '' : 's'} watched` : 'TV series' : 'Film',
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
$('#watchSearch')?.addEventListener('focus', () => { syncAdultSearchMode(true); scheduleAdultDiscovery() })
$('#watchSearch')?.addEventListener('blur', () => setTimeout(() => syncAdultSearchMode(), 0))
$('#watchSearch')?.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  event.currentTarget.value = ''
  event.currentTarget.dispatchEvent(new Event('input', { bubbles: true }))
  event.currentTarget.blur()
})
$('#watchSearchClear')?.addEventListener('click', () => setTimeout(() => { searchAdultDiscovery(''); syncAdultSearchMode(true) }, 0))
$('#adultMyViewing')?.addEventListener('click', () => { history.pushState({ adultViewing: true }, '', '#adult-viewing'); openView('adult-viewing'); loadAdultViewing().catch(showError) })
$('#adultViewingBack')?.addEventListener('click', () => { history.back(); setTimeout(() => { if (location.hash === '#adult-viewing') openView('watch') }, 80) })
$('#adultTitleClose')?.addEventListener('click', () => portalSheets.dismiss($('#adultTitleSheet')))
$('#adultTitleSheet')?.addEventListener('click', event => { if (event.target === $('#adultTitleSheet')) portalSheets.dismiss($('#adultTitleSheet')) })
$('#adultTitleSeasonClose')?.addEventListener('click', () => portalSheets.close($('#adultTitleSeasonSheet')))
$('#adultTitleSeasonSheet')?.addEventListener('click', event => { if (event.target === $('#adultTitleSeasonSheet')) portalSheets.close($('#adultTitleSeasonSheet')) })
$('#adultTitleSeasonSheet')?.addEventListener('cancel', event => { event.preventDefault(); portalSheets.close($('#adultTitleSeasonSheet')) })
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
