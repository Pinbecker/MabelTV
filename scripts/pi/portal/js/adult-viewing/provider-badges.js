// Shared streaming-service badges for every Adult TV title-card surface.

const ADULT_PROVIDER_SUMMARY_TTL = 6 * 60 * 60 * 1000
const ADULT_PROVIDER_BADGE_PRIORITY = new Map([
  ['mabeltv', 0], ['netflix', 1], ['prime-video', 2], ['bbc-iplayer', 3],
  ['channel-4', 4], ['itvx', 5], ['sky-go', 6],
  ['now', 1000], ['hbo-max', 1001],
])
let adultProviderSummaries = {}
let adultProviderSummariesRestore = null
const adultProviderSummaryPending = new Map()
let adultProviderSummaryFlushQueued = false
let adultProviderSummaryFlushRunning = false
let adultProviderSummaryRetryAfter = 0

function adultProviderBadgesEnabled() {
  return library?.adult_settings?.provider_badges_enabled !== false
}

function adultProviderSummaryKey(title = {}) {
  const mediaType = String(title.media_type || '')
  const tmdbId = Number(title.tmdb_id || 0)
  return ['movie', 'tv'].includes(mediaType) && tmdbId > 0
    ? `${mediaType}:${tmdbId}` : ''
}

function applyAdultProviderSummary(title) {
  const saved = adultProviderSummaries[adultProviderSummaryKey(title)]
  if (!saved || Date.now() - Number(saved.checked || 0) > ADULT_PROVIDER_SUMMARY_TTL) return
  title.providers = saved.providers || []
  title.provider_result = {
    ...(title.provider_result || {}), sources: saved.sources || [],
  }
}

async function restoreAdultProviderSummaries() {
  if (adultProviderSummariesRestore) return adultProviderSummariesRestore
  adultProviderSummariesRestore = (async () => {
    const cached = await readPortalDataCache('adult-provider-summaries-v1')
    if (cached && !cached.stale
        && Date.now() - Number(cached.saved_at || 0) <= ADULT_PROVIDER_SUMMARY_TTL) {
      adultProviderSummaries = Object.fromEntries(Object.entries(
        cached.data.summaries || {}).filter(([, saved]) =>
        Date.now() - Number(saved?.checked || 0) <= ADULT_PROVIDER_SUMMARY_TTL))
    }
    refreshAdultProviderBadges()
  })()
  return adultProviderSummariesRestore
}

async function persistAdultProviderSummaries() {
  adultProviderSummaries = Object.fromEntries(Object.entries(adultProviderSummaries)
    .sort((left, right) => Number(right[1]?.checked || 0) - Number(left[1]?.checked || 0))
    .slice(0, 1200))
  await writePortalDataCache('adult-provider-summaries-v1', {
    summaries: adultProviderSummaries,
  })
}

async function flushAdultProviderSummaries() {
  adultProviderSummaryFlushQueued = false
  if (adultProviderSummaryFlushRunning || !adultProviderBadgesEnabled()
      || Date.now() < adultProviderSummaryRetryAfter) return
  adultProviderSummaryFlushRunning = true
  try {
    while (adultProviderSummaryPending.size && adultProviderBadgesEnabled()) {
      const titles = [...adultProviderSummaryPending.values()].slice(0, 48)
      titles.forEach(title => adultProviderSummaryPending.delete(adultProviderSummaryKey(title)))
      const result = await api('/api/adult/home/availability', {
        method: 'POST', body: JSON.stringify({ titles: titles.map(title => ({
          media_type: title.media_type, tmdb_id: title.tmdb_id,
        })) }),
      })
      ;(result.items || []).forEach(item => {
        if (item.available === false) return
        adultProviderSummaries[item.key] = {
          providers: item.providers || [], sources: item.sources || [], checked: Date.now(),
        }
      })
      await persistAdultProviderSummaries()
      refreshAdultProviderBadges()
    }
  } catch (_) {
    adultProviderSummaryRetryAfter = Date.now() + 60 * 1000
  } finally {
    adultProviderSummaryFlushRunning = false
  }
}

function queueAdultProviderSummary(title) {
  if (!adultProviderBadgesEnabled()) return
  const key = adultProviderSummaryKey(title)
  if (!key) return
  void restoreAdultProviderSummaries().then(() => {
    applyAdultProviderSummary(title)
    if ((adultProviderSummaries[key]
        && Date.now() - Number(adultProviderSummaries[key].checked || 0)
        <= ADULT_PROVIDER_SUMMARY_TTL) || Date.now() < adultProviderSummaryRetryAfter) return
    adultProviderSummaryPending.set(key, title)
    if (adultProviderSummaryFlushQueued || adultProviderSummaryFlushRunning) return
    adultProviderSummaryFlushQueued = true
    queueMicrotask(() => void flushAdultProviderSummaries())
  })
}

function rememberAdultProviderSummary(detail) {
  const key = adultProviderSummaryKey(detail)
  if (!key || !detail.provider_result) return
  void restoreAdultProviderSummaries().then(() => {
    adultProviderSummaries[key] = {
      providers: detail.providers || [], sources: detail.provider_result.sources || [],
      checked: Date.now(),
    }
    void persistAdultProviderSummaries()
    refreshAdultProviderBadges()
  })
}

function refreshAdultProviderBadges() {
  document.querySelectorAll('.adult-provider-badge-host').forEach(root => {
    renderAdultProviderBadges(root, root._adultProviderTitle || {})
  })
}

function renderAdultProviderBadges(root, title) {
  root.classList.add('adult-provider-badge-host')
  root._adultProviderTitle = title
  root.querySelector(':scope > .adult-provider-strip')?.remove()
  applyAdultProviderSummary(title)
  if (!adultProviderBadgesEnabled() || title.cinema_only === true) return
  queueAdultProviderSummary(title)
  const available = []
  if (title.on_mabeltv) {
    available.push({ id: 'mabeltv', label: 'MabelTV', asset: '/apple-touch-icon.png' })
  }
  const seen = new Set(available.map(value => value.id))
  if (adultAvailabilityEnabled()) {
    const add = (provider, idField, brandIds) => {
      if (!['flatrate', 'free', 'ads'].includes(String(provider?.type || '').toLowerCase())) return
      const brand = adultProviderBrandFor(provider, idField, brandIds)
      if (!brand || seen.has(brand.id)) return
      seen.add(brand.id)
      available.push({ id: brand.id, label: brand.label, asset: adultProviderAssetUrl(brand) })
    }
    ;(title.providers || []).forEach(provider => add(provider, 'provider_id', 'tmdbIds'))
    ;(title.provider_result?.sources || []).forEach(source => {
      if (!['sub', 'free', 'tve', 'ads'].includes(String(source?.type || '').toLowerCase())) return
      const brand = adultProviderBrandFor(source, 'source_id', 'watchmodeIds')
      if (!brand || seen.has(brand.id)) return
      seen.add(brand.id)
      available.push({ id: brand.id, label: brand.label, asset: adultProviderAssetUrl(brand) })
    })
  }
  if (!available.length) return
  available.sort((left, right) =>
    (ADULT_PROVIDER_BADGE_PRIORITY.get(left.id) ?? 100)
    - (ADULT_PROVIDER_BADGE_PRIORITY.get(right.id) ?? 100))
  const strip = document.createElement('span')
  strip.className = 'adult-provider-strip'
  strip.setAttribute('aria-label', `Available on ${available.map(value => value.label).join(', ')}`)
  available.slice(0, 2).forEach(provider => {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.className = 'adult-provider-icon'
    image.src = provider.asset
    image.alt = ''
    image.title = provider.label
    strip.append(image)
  })
  root.append(strip)
}
