// Shared streaming-service badges for every My TV title-card surface.

const MY_TV_PROVIDER_SUMMARY_TTL = 6 * 60 * 60 * 1000
const MY_TV_PROVIDER_BADGE_PRIORITY = new Map([
  ['mabeltv', 0], ['netflix', 1], ['prime-video', 2], ['bbc-iplayer', 3],
  ['channel-4', 4], ['itvx', 5], ['sky-go', 6],
  ['now', 1000], ['hbo-max', 1001],
])
let myTvProviderSummaries = {}
let myTvProviderSummariesRestore = null
const myTvProviderSummaryPending = new Map()
let myTvProviderSummaryFlushQueued = false
let myTvProviderSummaryFlushRunning = false
let myTvProviderSummaryRetryAfter = 0

function myTvProviderBadgesEnabled() {
  return library?.my_tv_settings?.provider_badges_enabled !== false
}

function myTvProviderSummaryKey(title = {}) {
  const mediaType = String(title.media_type || '')
  const tmdbId = Number(title.tmdb_id || 0)
  return ['movie', 'tv'].includes(mediaType) && tmdbId > 0
    ? `${mediaType}:${tmdbId}` : ''
}

function applyMyTvProviderSummary(title) {
  const saved = myTvProviderSummaries[myTvProviderSummaryKey(title)]
  if (!saved || Date.now() - Number(saved.checked || 0) > MY_TV_PROVIDER_SUMMARY_TTL) return
  title.providers = saved.providers || []
  title.provider_result = {
    ...(title.provider_result || {}), sources: saved.sources || [],
  }
}

async function restoreMyTvProviderSummaries() {
  if (myTvProviderSummariesRestore) return myTvProviderSummariesRestore
  myTvProviderSummariesRestore = (async () => {
    const cached = await readPortalDataCache('my-tv-provider-summaries-v1')
    if (cached && !cached.stale
        && Date.now() - Number(cached.saved_at || 0) <= MY_TV_PROVIDER_SUMMARY_TTL) {
      myTvProviderSummaries = Object.fromEntries(Object.entries(
        cached.data.summaries || {}).filter(([, saved]) =>
        Date.now() - Number(saved?.checked || 0) <= MY_TV_PROVIDER_SUMMARY_TTL))
    }
    refreshMyTvProviderBadges()
  })()
  return myTvProviderSummariesRestore
}

async function persistMyTvProviderSummaries() {
  myTvProviderSummaries = Object.fromEntries(Object.entries(myTvProviderSummaries)
    .sort((left, right) => Number(right[1]?.checked || 0) - Number(left[1]?.checked || 0))
    .slice(0, 1200))
  await writePortalDataCache('my-tv-provider-summaries-v1', {
    summaries: myTvProviderSummaries,
  })
}

async function flushMyTvProviderSummaries() {
  myTvProviderSummaryFlushQueued = false
  if (myTvProviderSummaryFlushRunning || !myTvProviderBadgesEnabled()
      || Date.now() < myTvProviderSummaryRetryAfter) return
  myTvProviderSummaryFlushRunning = true
  try {
    while (myTvProviderSummaryPending.size && myTvProviderBadgesEnabled()) {
      const titles = [...myTvProviderSummaryPending.values()].slice(0, 48)
      titles.forEach(title => myTvProviderSummaryPending.delete(myTvProviderSummaryKey(title)))
      const result = await api('/api/my-tv/home/availability', {
        method: 'POST', body: JSON.stringify({ titles: titles.map(title => ({
          media_type: title.media_type, tmdb_id: title.tmdb_id,
        })) }),
      })
      ;(result.items || []).forEach(item => {
        if (item.available === false) return
        myTvProviderSummaries[item.key] = {
          providers: item.providers || [], sources: item.sources || [], checked: Date.now(),
        }
      })
      await persistMyTvProviderSummaries()
      refreshMyTvProviderBadges()
    }
  } catch (_) {
    myTvProviderSummaryRetryAfter = Date.now() + 60 * 1000
  } finally {
    myTvProviderSummaryFlushRunning = false
  }
}

function queueMyTvProviderSummary(title) {
  if (!myTvProviderBadgesEnabled()) return
  const key = myTvProviderSummaryKey(title)
  if (!key) return
  void restoreMyTvProviderSummaries().then(() => {
    applyMyTvProviderSummary(title)
    if ((myTvProviderSummaries[key]
        && Date.now() - Number(myTvProviderSummaries[key].checked || 0)
        <= MY_TV_PROVIDER_SUMMARY_TTL) || Date.now() < myTvProviderSummaryRetryAfter) return
    myTvProviderSummaryPending.set(key, title)
    if (myTvProviderSummaryFlushQueued || myTvProviderSummaryFlushRunning) return
    myTvProviderSummaryFlushQueued = true
    queueMicrotask(() => void flushMyTvProviderSummaries())
  })
}

function rememberMyTvProviderSummary(detail) {
  const key = myTvProviderSummaryKey(detail)
  if (!key || !detail.provider_result) return
  void restoreMyTvProviderSummaries().then(() => {
    myTvProviderSummaries[key] = {
      providers: detail.providers || [], sources: detail.provider_result.sources || [],
      checked: Date.now(),
    }
    void persistMyTvProviderSummaries()
    refreshMyTvProviderBadges()
  })
}

function refreshMyTvProviderBadges() {
  document.querySelectorAll('.my-tv-provider-badge-host').forEach(root => {
    renderMyTvProviderBadges(root, root._myTvProviderTitle || {})
  })
}

function renderMyTvProviderBadges(root, title) {
  root.classList.add('my-tv-provider-badge-host')
  root._myTvProviderTitle = title
  root.querySelector(':scope > .my-tv-provider-strip')?.remove()
  applyMyTvProviderSummary(title)
  if (!myTvProviderBadgesEnabled() || title.cinema_only === true) return
  queueMyTvProviderSummary(title)
  const available = []
  if (title.on_mabeltv) {
    available.push({ id: 'mabeltv', label: tvName(), asset: '/apple-touch-icon.png' })
  }
  const seen = new Set(available.map(value => value.id))
  if (myTvAvailabilityEnabled()) {
    const add = (provider, idField, brandIds) => {
      if (!['flatrate', 'free', 'ads'].includes(String(provider?.type || '').toLowerCase())) return
      const brand = myTvProviderBrandFor(provider, idField, brandIds)
      if (!brand || seen.has(brand.id)) return
      seen.add(brand.id)
      available.push({ id: brand.id, label: brand.label, asset: myTvProviderAssetUrl(brand) })
    }
    ;(title.providers || []).forEach(provider => add(provider, 'provider_id', 'tmdbIds'))
    ;(title.provider_result?.sources || []).forEach(source => {
      if (!['sub', 'free', 'tve', 'ads'].includes(String(source?.type || '').toLowerCase())) return
      const brand = myTvProviderBrandFor(source, 'source_id', 'watchmodeIds')
      if (!brand || seen.has(brand.id)) return
      seen.add(brand.id)
      available.push({ id: brand.id, label: brand.label, asset: myTvProviderAssetUrl(brand) })
    })
  }
  if (!available.length) return
  available.sort((left, right) =>
    (MY_TV_PROVIDER_BADGE_PRIORITY.get(left.id) ?? 100)
    - (MY_TV_PROVIDER_BADGE_PRIORITY.get(right.id) ?? 100))
  const strip = document.createElement('span')
  strip.className = 'my-tv-provider-strip'
  strip.setAttribute('aria-label', `Available on ${available.map(value => value.label).join(', ')}`)
  available.slice(0, 2).forEach(provider => {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.className = 'my-tv-provider-icon'
    image.src = provider.asset
    image.alt = ''
    image.title = provider.label
    strip.append(image)
  })
  root.append(strip)
}
