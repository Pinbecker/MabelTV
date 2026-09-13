'use strict'

function adultPosterUrl(path, size = 'w342') {
  if (!path) return ''
  const name = String(path).replace(/^\/+/, '')
  return `/api/adult/tmdb-artwork/${encodeURIComponent(size)}/${encodeURIComponent(name)}`
}

const ADULT_ARTWORK_RETRY_DELAYS = [700, 2400, 7000]

function adultArtworkIdentity(source) {
  try {
    const url = new URL(source, location.href)
    const tmdb = url.pathname.match(/^\/api\/adult\/tmdb-artwork\/[^/]+\/(.+)$/)
    if (tmdb) return `tmdb:${decodeURIComponent(tmdb[1])}`
    if (url.pathname.startsWith('/api/adult/artwork/')
        || url.pathname.startsWith('/api/adult/series/artwork/')) {
      return url.pathname
    }
  } catch (_) { /* An invalid URL is not managed artwork. */ }
  return ''
}

function retryAdultArtworkImage(image, immediate = false) {
  if (!(image instanceof HTMLImageElement) || !image.dataset.adultArtworkFailed) return
  const attempt = Number(image.dataset.adultArtworkAttempt || 0)
  if (attempt >= ADULT_ARTWORK_RETRY_DELAYS.length) return
  clearTimeout(image._adultArtworkRetryTimer)
  image._adultArtworkRetryTimer = setTimeout(() => {
    if (!image.isConnected || !image.dataset.adultArtworkFailed) return
    const source = image.dataset.adultArtworkSource
    if (!source) return
    image.dataset.adultArtworkAttempt = String(attempt + 1)
    const url = new URL(source, location.href)
    url.searchParams.set('retry', `${attempt + 1}-${Date.now()}`)
    image.src = url.href
  }, immediate ? 0 : ADULT_ARTWORK_RETRY_DELAYS[attempt])
}

function retryFailedAdultArtwork(identity = '') {
  document.querySelectorAll('img[data-adult-artwork-failed="true"]').forEach(image => {
    if (!identity || image.dataset.adultArtworkIdentity === identity) {
      retryAdultArtworkImage(image, true)
    }
  })
}

document.addEventListener('error', event => {
  const image = event.target
  if (!(image instanceof HTMLImageElement)) return
  const source = image.dataset.adultArtworkSource || image.currentSrc || image.src
  const identity = adultArtworkIdentity(source)
  if (!identity) return
  image.dataset.adultArtworkSource = source.split('?')[0]
  image.dataset.adultArtworkIdentity = identity
  image.dataset.adultArtworkFailed = 'true'
  retryAdultArtworkImage(image)
}, true)

document.addEventListener('load', event => {
  const image = event.target
  if (!(image instanceof HTMLImageElement)) return
  const identity = adultArtworkIdentity(
    image.dataset.adultArtworkSource || image.currentSrc || image.src)
  if (!identity) return
  clearTimeout(image._adultArtworkRetryTimer)
  delete image.dataset.adultArtworkFailed
  delete image.dataset.adultArtworkAttempt
  retryFailedAdultArtwork(identity)
}, true)

window.addEventListener('mabeltv:adult-artwork-access', () => retryFailedAdultArtwork())

function adultArtworkImage(source, alt = '') {
  const image = document.createElement('img')
  image.loading = 'lazy'
  image.decoding = 'async'
  image.dataset.adultArtworkSource = source
  image.src = source
  image.alt = alt
  return image
}

function adultViewingPosterUrl(item) {
  if (item.poster_path) return adultPosterUrl(item.poster_path)
  const localPoster = item.local?.poster
  if (!localPoster) return ''
  return item.local?.kind === 'channel-film'
    ? `/api/channel/artwork/${encodeURIComponent(localPoster)}`
    : `/api/adult/artwork/${encodeURIComponent(localPoster)}`
}

function rememberAdultTitleMetadata(detail, original = null) {
  const key = detail?.key || (detail?.media_type && detail?.tmdb_id
    ? `${detail.media_type}:${Number(detail.tmdb_id)}` : '')
  if (!key) return
  const metadata = {}
  ;['title', 'year', 'poster_path', 'backdrop_path', 'overview', 'providers',
    'provider_result'].forEach(field => {
    if (detail[field] || (field === 'provider_result'
      && Object.prototype.hasOwnProperty.call(detail, field))) metadata[field] = detail[field]
  })
  const targets = [original, ...(adultViewingData.items || [])]
  if (typeof adultExploreItems !== 'undefined') targets.push(...adultExploreItems)
  if (typeof adultHomePersonal !== 'undefined') targets.push(...adultHomePersonal)
  if (typeof adultHomeDifferent !== 'undefined') targets.push(...adultHomeDifferent)
  if (typeof adultHomeReleased !== 'undefined') targets.push(...adultHomeReleased)
  targets.filter(value => value && (value.key || `${value.media_type}:${Number(value.tmdb_id)}`) === key)
    .forEach(value => Object.assign(value, metadata))
  rememberAdultProviderSummary(detail)
  refreshAdultExploreCards()
  if (typeof refreshAdultViewingRowArtwork === 'function') {
    document.querySelectorAll(`[data-viewing-key="${key}"]`).forEach(row => {
      const item = (adultViewingData.items || []).find(value => value.key === key)
      if (item) refreshAdultViewingRowArtwork(row, item)
    })
  }
}
