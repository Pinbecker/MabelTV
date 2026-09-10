'use strict'

let adultDiscoveryTimer = null
let adultDiscoveryRevision = 0
let adultViewingData = { items: [] }
let adultViewingLoaded = false
let adultViewingTab = 'watchlist'
let adultViewingFilter = 'all'
let adultViewingSearch = ''
let adultViewingSort = 'recent'
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
  if (!localPoster) return ''
  return item.local?.kind === 'channel-film'
    ? `/api/channel/artwork/${encodeURIComponent(localPoster)}`
    : `/api/adult/artwork/${encodeURIComponent(localPoster)}`
}

function adultViewingRecord(title = {}) {
  const key = title.key || (title.media_type && title.tmdb_id
    ? `${title.media_type}:${Number(title.tmdb_id)}` : '')
  const stored = (adultViewingData.items || []).find(item => item.key === key)
  return stored || (title.viewing && Object.keys(title.viewing).length ? title.viewing : {})
}

function cacheAdultViewingRecord(viewing = {}) {
  if (!viewing.key) return
  const items = adultViewingData.items || (adultViewingData.items = [])
  const index = items.findIndex(item => item.key === viewing.key)
  if (index < 0) items.push(viewing)
  else items[index] = { ...items[index], ...viewing }
}

function optimisticAdultViewingRecord(title, action, extra = {}) {
  const current = adultViewingRecord(title)
  const key = title.key || `${title.media_type}:${Number(title.tmdb_id)}`
  const next = {
    ...current, key, media_type: title.media_type, tmdb_id: Number(title.tmdb_id),
    title: title.title || current.title || '', year: title.year || current.year || '',
    poster_path: title.poster_path || current.poster_path || '',
    overview: title.overview || current.overview || '',
    runtime: Number(title.runtime || current.runtime || 0), updated: Date.now() / 1000,
    episodes: { ...(current.episodes || {}) },
    history: [...(current.history || [])],
  }
  if (action === 'watchlist') next.watchlisted = extra.enabled === true
  else if (action === 'up_next') next.up_next = extra.enabled === true
  else if (action === 'watching') next.series_watching = extra.enabled === true
  else if (['part_watched', 'watched', 'not_watched', 'dropped'].includes(action)) {
    if (action === 'watched') next.history.push(next.updated)
    else if (next.manual_state === 'watched' && next.history.length) next.history.pop()
    next.manual_state = action
  } else if (action === 'episode_watched') {
    next.episodes[`${Number(extra.season)}:${Number(extra.episode)}`] = {
      watched: extra.watched === true, updated: next.updated,
    }
  } else if (action === 'season_watched') {
    for (let episode = 1; episode <= Number(extra.episode_count || 0); episode += 1) {
      next.episodes[`${Number(extra.season)}:${episode}`] = {
        watched: extra.watched === true, updated: next.updated,
      }
    }
  } else if (action === 'remove') {
    next.watchlisted = false
    next.up_next = false
    next.series_watching = false
    next.manual_state = 'not_watched'
  }
  if (['episode_watched', 'season_watched'].includes(action)) {
    const total = (title.seasons || []).reduce(
      (sum, season) => sum + Number(season.episodes || 0), 0)
    const watched = Object.values(next.episodes).filter(value => value?.watched === true).length
    if (total) next.manual_state = watched >= total ? 'watched'
      : watched ? 'part_watched' : 'not_watched'
  }
  return next
}

function adultArtworkStatusKind(title = {}, detail = title) {
  const state = adultViewingRecord(title)
  const status = adultTitleViewingStatus(state, {
    ...detail, media_type: title.media_type || detail.media_type,
    local: detail.local_progress || detail.local,
  })
  if (status.completed) return 'watched'
  if (status.partWatched) return 'part-watched'
  return ''
}

function appendAdultArtworkStatus(root, title = {}, detail = title) {
  root.classList.add('adult-artwork-status-host')
  root._adultArtworkTitle = title
  root._adultArtworkDetail = detail
  root.querySelector(':scope > .adult-artwork-status')?.remove()
  const kind = adultArtworkStatusKind(title, detail)
  const badge = MabelPortalUI.artworkStatus(kind,
    kind === 'watched' ? `${title.title || 'Title'} watched` : `${title.title || 'Series'} part watched`)
  if (badge) root.append(badge)
  return badge
}

function refreshAdultArtworkStatuses() {
  $$('.adult-artwork-status-host').forEach(root => appendAdultArtworkStatus(
    root, root._adultArtworkTitle || {}, root._adultArtworkDetail || {}))
  if (typeof refreshAdultExploreCards === 'function') refreshAdultExploreCards()
}

function appendAdultLocalArtworkStatus(root, mediaType, value = {}) {
  const metadata = value?.metadata || {}
  const tmdbId = Number(metadata.tmdb_id || value?.tmdb_id || 0)
  if (!root || !tmdbId) return null
  const title = metadata.title || value.title || value.display_name || value.name || 'Untitled'
  return appendAdultArtworkStatus(root, {
    key: `${mediaType}:${tmdbId}`, media_type: mediaType, tmdb_id: tmdbId, title,
  }, { media_type: mediaType, local: value })
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
    id: 'now', label: 'NOW', asset: 'now-app.jpg',
    match: /(?:now\s*tv|^now$)/i, tmdbIds: [39, 591], watchmodeIds: [406],
    hosts: ['nowtv.com'], fallback: title => `https://www.nowtv.com/search?q=${encodeURIComponent(title)}`,
  },
  {
    id: 'my5', label: 'My5', asset: 'https://cdn.watchmode.com/provider_logos/418_generic_v4.png',
    match: /my\s*5/i, tmdbIds: [], watchmodeIds: [418],
    hosts: ['channel5.com'], fallback: () => 'https://www.channel5.com/',
  },
  {
    id: 'hbo-max', label: 'HBO Max', asset: 'https://cdn.watchmode.com/provider_logos/max_100px.png',
    match: /(?:hbo\s*)?max/i, tmdbIds: [1825, 1899], watchmodeIds: [387, 490],
    hosts: ['hbomax.com', 'max.com', 'amazon.co.uk'], fallback: () => 'https://www.hbomax.com/gb/en',
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
  return (identifier && adultProviderBrands.find(brand => brand[brandIds].includes(identifier)))
    || adultProviderBrands.find(brand => brand.match.test(String(record?.name || '')))
}

function adultAvailabilityEnabled() {
  return library?.adult_settings?.watchmode_availability_enabled !== false
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

function adultProviderAssetUrl(brand) {
  return /^https:\/\//i.test(brand.asset)
    ? brand.asset : `/portal/assets/providers/${brand.asset}`
}

function adultSourceDestination(source, platform = adultProviderPlatform()) {
  const fields = platform === 'ios'
    ? ['ios_url', 'web_url', 'android_url']
    : platform === 'android'
      ? ['android_url', 'web_url', 'ios_url']
      : ['web_url', 'ios_url', 'android_url']
  for (const field of fields) {
    const direct = String(source?.[field] || '').trim()
    if (!direct) continue
    try {
      const url = new URL(direct)
      if (['javascript:', 'data:', 'file:', 'blob:'].includes(url.protocol)) continue
      if (url.protocol === 'http:') url.protocol = 'https:'
      if (['http:', 'https:'].includes(url.protocol) && !url.hostname) continue
      return url.href
    } catch (_) {
      // Invalid destinations are ignored rather than exposed as navigation.
    }
  }
  return ''
}

function adultPurchaseProviderKey(name) {
  const compact = String(name || '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
  if (compact.includes('amazon')) return 'amazon'
  if (compact.includes('appletv')) return 'appletv'
  return compact
}

function adultPurchaseProviderAsset(group, detail) {
  const source = group.sources[0]
  const brand = adultProviderBrandFor(source, 'source_id', 'watchmodeIds')
  if (brand) return adultProviderAssetUrl(brand)
  const provider = (detail.providers || []).find(value =>
    adultPurchaseProviderKey(value.name) === adultPurchaseProviderKey(group.name)
    && value.logo_path)
  return provider?.logo_path ? adultPosterUrl(provider.logo_path, 'w92') : ''
}

function renderAdultPurchaseOffersInto(section, root, detail, result) {
  if (!section || !root) return
  root.replaceChildren()
  root.hidden = true
  section.classList.remove('is-expanded')
  const toggle = section.querySelector('.adult-rent-toggle')
  const summary = section.querySelector('.adult-rent-summary')
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false')
    toggle.onclick = null
  }
  if (summary) summary.textContent = ''
  const groups = new Map()
  const add = source => {
    const type = String(source?.type || '').toLowerCase()
    if (type !== 'rent') return
    const name = String(source?.name || 'Store').trim()
    if (/(?:rakuten|google\s*play|youtube|chili)/i.test(name)) return
    const marker = adultPurchaseProviderKey(name)
    const group = groups.get(marker) || {
      name, sources: [], prices: new Set(),
    }
    group.sources.push(source)
    const price = source?.price === null || source?.price === undefined || source?.price === ''
      ? Number.NaN : Number(source.price)
    if (Number.isFinite(price) && price >= 0) group.prices.add(price)
    groups.set(marker, group)
  }
  ;(result.sources || []).forEach(add)
  const offers = [...groups.values()].filter(group => group.prices.size)
    .sort((a, b) => a.name.localeCompare(b.name))
  if (offers.length) {
    const providers = document.createElement('div')
    providers.className = 'adult-purchase-providers'
    offers.forEach(group => {
      const destinationSource = group.sources.find(source => adultSourceDestination(source))
      const destination = adultSourceDestination(destinationSource)
      const offer = document.createElement(destination ? 'button' : 'div')
      if (destination) offer.type = 'button'
      offer.className = 'adult-purchase-provider'
      offer.dataset.provider = adultPurchaseProviderKey(group.name)
      const logo = document.createElement('span')
      logo.className = 'adult-purchase-logo'
      const asset = adultPurchaseProviderAsset(group, detail)
      if (asset) {
        const image = document.createElement('img')
        image.src = asset
        image.alt = group.name
        logo.append(image)
      } else {
        const initials = document.createElement('b')
        initials.textContent = group.name.split(/\s+/).slice(0, 2)
          .map(part => part.slice(0, 1)).join('').toUpperCase()
        logo.append(initials)
      }
      const prices = [...group.prices].sort((a, b) => a - b)
      const price = new Intl.NumberFormat('en-GB', {
        style: 'currency', currency: 'GBP', minimumFractionDigits: 2,
      }).format(prices[0])
      const priceLabel = document.createElement('strong')
      priceLabel.textContent = `${prices.length > 1 ? 'From ' : ''}${price}`
      offer.append(logo, priceLabel)
      offer.setAttribute('aria-label', `Rent ${group.name} for ${priceLabel.textContent}`)
      if (destination) offer.onclick = () => window.location.assign(destination)
      providers.append(offer)
    })
    root.append(providers)
    const lowest = Math.min(...offers.flatMap(group => [...group.prices]))
    if (summary && Number.isFinite(lowest)) {
      summary.textContent = `From ${new Intl.NumberFormat('en-GB', {
        style: 'currency', currency: 'GBP', minimumFractionDigits: 2,
      }).format(lowest)}`
    }
    if (toggle) {
      toggle.onclick = () => {
        const expanded = toggle.getAttribute('aria-expanded') !== 'true'
        toggle.setAttribute('aria-expanded', String(expanded))
        section.classList.toggle('is-expanded', expanded)
        root.hidden = !expanded
      }
    }
  }
  section.classList.toggle('hidden', !root.children.length)
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

async function updateAdultViewing(title, action, extra = {}, onChange = null) {
  const key = title.key || `${title.media_type}:${Number(title.tmdb_id)}`
  const items = adultViewingData.items || (adultViewingData.items = [])
  const storedIndex = items.findIndex(item => item.key === key)
  const previousStored = storedIndex >= 0 ? items[storedIndex] : null
  const previousTitle = title.viewing || null
  const apply = viewing => {
    title.viewing = viewing
    cacheAdultViewingRecord(viewing)
    refreshAdultArtworkStatuses()
    onChange?.(viewing)
  }
  apply(optimisticAdultViewingRecord(title, action, extra))
  try {
    const result = await api('/api/adult/viewing', {
      method: 'POST', body: JSON.stringify(adultTitlePayload(title, action, extra)),
    })
    apply({ ...result.viewing, key: result.key })
    void loadAdultViewing().catch(() => {})
    return title.viewing
  } catch (error) {
    title.viewing = previousTitle || {}
    if (previousStored) items[storedIndex] = previousStored
    else {
      const optimisticIndex = items.findIndex(item => item.key === key)
      if (optimisticIndex >= 0) items.splice(optimisticIndex, 1)
    }
    refreshAdultArtworkStatuses()
    onChange?.(title.viewing)
    throw error
  }
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
  appendAdultArtworkStatus(art, title)
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

function syncAdultSearchMode() {
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
  const titleSheet = $('#adultTitleSheet')
  const titleReturnTo = portalSheets.returnTo(titleSheet)
  const restoreTitle = () => restoreAdultTitleSheet(detail, titleReturnTo)
  if (detail.local.kind === 'film') {
    const film = (library?.adult_library || []).find(item => item.path === detail.local.path)
    return film ? () => {
      portalSheets.suspend(titleSheet, { card: true })
      openWatchFilmSheet(film, 'library', restoreTitle)
    } : null
  }
  if (detail.local.kind === 'channel-film') {
    const channel = (library?.channels || []).find(value =>
      Number(value.number) === Number(detail.local.channel))
    const programme = channel?.programmes?.find(value => value.name === detail.local.file)
    return channel && programme
      ? () => {
        portalSheets.suspend(titleSheet)
        openWatchProgrammeSheet(channel, programme, 'library', restoreTitle)
      }
      : null
  }
  return null
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
  sourcesByBrand.forEach((source, brandId) => {
    if (includedByBrand.has(brandId)) return
    const brand = adultProviderBrands.find(value => value.id === brandId)
    if (brand) includedByBrand.set(brandId, { brand, provider: source })
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
    image.src = adultProviderAssetUrl(brand)
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
  renderAdultPurchaseOffersInto(options.purchaseSection, options.purchaseRoot,
    detail, result)
}

function renderAdultProviderLinks(detail, result) {
  renderAdultProviderLinksInto($('#adultProviderList'), detail, result, {
    localAction: null,
    purchaseSection: $('#adultTitleRentBuy'), purchaseRoot: $('#adultTitleRentBuyList'),
  })
}

function renderAdultAvailabilityDisabled(root, detail, options = {}) {
  renderAdultProviderLinksInto(root, { ...detail, providers: [] }, { sources: [] }, options)
  const message = root.querySelector('p') || document.createElement('p')
  message.textContent = 'Where to watch and rent lookups are turned off in Settings.'
  if (!message.isConnected) root.append(message)
}

async function loadAdultProviders(detail, refresh = false, revision = adultTitleOpenRevision) {
  const root = $('#adultProviderList')
  if (!adultAvailabilityEnabled()) {
    renderAdultAvailabilityDisabled(root, detail, {
      localAction: null,
      purchaseSection: $('#adultTitleRentBuy'), purchaseRoot: $('#adultTitleRentBuyList'),
    })
    return
  }
  root.innerHTML = '<p>Checking streaming destinations…</p>'
  $('#adultTitleRentBuy')?.classList.add('hidden')
  $('#adultTitleRentBuyList')?.replaceChildren()
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
  const corrected = state.manual_state === 'not_watched' || state.manual_state === 'part_watched'
  const watchedEpisodes = Object.values(state.episodes || {})
    .filter(episode => episode?.watched === true).length
  const catalogueEpisodes = (detail.seasons || [])
    .reduce((total, season) => total + Number(season.episodes || 0), 0)
  const catalogueWatched = (detail.seasons || [])
    .reduce((total, season) => total + Number(season.watched_count || 0), 0)
  const progress = Math.max(watchedEpisodes, catalogueWatched,
    Number(detail.local?.watched_count || 0))
  const catalogueComplete = detail.media_type === 'tv' && catalogueEpisodes > 0
    && catalogueWatched >= catalogueEpisodes
  const completed = catalogueComplete || state.manual_state === 'watched'
    || (!corrected && Boolean((state.history || []).length))
  const inProgress = !completed && progress > 0
  return {
    completed, inProgress, progress,
    partWatched: detail.media_type === 'tv' && inProgress,
  }
}

function adultViewingActionButtons(root) {
  return Object.fromEntries(['watchlist', 'up_next', 'watching', 'watched']
    .map(action => [action, root?.querySelector(`[data-viewing-action="${action}"]`)]))
}

function syncAdultTitleButtons(detail, root = $('#adultTitleIntents')) {
  const state = detail.viewing || {}
  const { watchlist, up_next: upNext, watching, watched } = adultViewingActionButtons(root)
  if (!watchlist || !upNext || !watched) return
  const compactFilm = detail.media_type !== 'tv'
  const compactSeries = detail.media_type === 'tv'
  const sync = (button, active, title, description) => {
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
    button.querySelector('strong').textContent = title
    button.querySelector('small').textContent = description
  }
  const status = adultTitleViewingStatus(state, detail)
  root.classList.toggle('compact-film-intents', compactFilm)
  root.classList.toggle('compact-series-intents', compactSeries)
  sync(watchlist, state.watchlisted === true,
    compactFilm || compactSeries ? 'Watchlist'
      : state.watchlisted ? 'In your Watchlist' : 'Add to Watchlist',
    state.watchlisted ? 'Saved in your manual Watchlist'
      : 'Keep this title in your manual Watchlist')
  watchlist.classList.remove('hidden', 'is-unavailable')
  sync(upNext, state.up_next === true,
    compactFilm || compactSeries ? 'Up Next' : state.up_next ? 'In Up Next' : 'Add to Up Next',
    state.up_next ? 'Queued as a priority' : 'Place it in your ordered queue')
  const titleWatched = state.manual_state === 'watched'
  const titlePartWatched = compactSeries && status.partWatched
  watching?.classList.toggle('hidden', detail.media_type !== 'tv')
  if (detail.media_type === 'tv' && watching) {
    sync(watching, state.series_watching === true,
      compactSeries ? 'Watching' : state.series_watching
        ? 'In your Watching list' : 'Add to Watching',
      state.series_watching ? 'Saved in your manual Watching list'
        : 'Keep this show in your manual Watching list')
  }
  watched.classList.remove('hidden')
  watched.classList.toggle('is-status', compactSeries)
  watched.disabled = compactSeries
  watched.tabIndex = compactSeries ? -1 : 0
  sync(watched, titleWatched || titlePartWatched,
    titlePartWatched ? 'Part Watched'
      : compactFilm || compactSeries ? 'Watched' : titleWatched ? 'Watched' : 'Mark watched',
    titlePartWatched ? `${status.progress} episode${status.progress === 1 ? '' : 's'} watched`
      : titleWatched ? 'In your watched history' : 'Moves it out of Watchlist and Up Next')
  if (compactSeries) watched.setAttribute('aria-label', titlePartWatched
    ? `${status.progress} episodes watched; series is part watched`
    : titleWatched ? 'Every episode is watched' : 'No episodes are watched')
}
