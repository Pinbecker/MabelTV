'use strict'

function myTvPosterUrl(path, size = 'w342') {
  if (!path) return ''
  const name = String(path).replace(/^\/+/, '')
  return `/api/my-tv/tmdb-artwork/${encodeURIComponent(size)}/${encodeURIComponent(name)}`
}

const MY_TV_ARTWORK_RETRY_DELAYS = [700, 2400, 7000]

function myTvArtworkIdentity(source) {
  try {
    const url = new URL(source, location.href)
    const tmdb = url.pathname.match(/^\/api\/my-tv\/tmdb-artwork\/[^/]+\/(.+)$/)
    if (tmdb) return `tmdb:${decodeURIComponent(tmdb[1])}`
    if (url.pathname.startsWith('/api/my-tv/artwork/')
        || url.pathname.startsWith('/api/my-tv/series/artwork/')) {
      return url.pathname
    }
  } catch (_) { /* An invalid URL is not managed artwork. */ }
  return ''
}

function retryMyTvArtworkImage(image, immediate = false) {
  if (!(image instanceof HTMLImageElement) || !image.dataset.myTvArtworkFailed) return
  const attempt = Number(image.dataset.myTvArtworkAttempt || 0)
  if (attempt >= MY_TV_ARTWORK_RETRY_DELAYS.length) return
  clearTimeout(image._myTvArtworkRetryTimer)
  image._myTvArtworkRetryTimer = setTimeout(() => {
    if (!image.isConnected || !image.dataset.myTvArtworkFailed) return
    const source = image.dataset.myTvArtworkSource
    if (!source) return
    image.dataset.myTvArtworkAttempt = String(attempt + 1)
    const url = new URL(source, location.href)
    url.searchParams.set('retry', `${attempt + 1}-${Date.now()}`)
    image.src = url.href
  }, immediate ? 0 : MY_TV_ARTWORK_RETRY_DELAYS[attempt])
}

function retryFailedMyTvArtwork(identity = '') {
  document.querySelectorAll('img[data-my-tv-artwork-failed="true"]').forEach(image => {
    if (!identity || image.dataset.myTvArtworkIdentity === identity) {
      retryMyTvArtworkImage(image, true)
    }
  })
}

document.addEventListener('error', event => {
  const image = event.target
  if (!(image instanceof HTMLImageElement)) return
  const source = image.dataset.myTvArtworkSource || image.currentSrc || image.src
  const identity = myTvArtworkIdentity(source)
  if (!identity) return
  image.dataset.myTvArtworkSource = source.split('?')[0]
  image.dataset.myTvArtworkIdentity = identity
  image.dataset.myTvArtworkFailed = 'true'
  retryMyTvArtworkImage(image)
}, true)

document.addEventListener('load', event => {
  const image = event.target
  if (!(image instanceof HTMLImageElement)) return
  const identity = myTvArtworkIdentity(
    image.dataset.myTvArtworkSource || image.currentSrc || image.src)
  if (!identity) return
  clearTimeout(image._myTvArtworkRetryTimer)
  delete image.dataset.myTvArtworkFailed
  delete image.dataset.myTvArtworkAttempt
  retryFailedMyTvArtwork(identity)
}, true)

window.addEventListener('mabeltv:my-tv-artwork-access', () => retryFailedMyTvArtwork())

function myTvArtworkImage(source, alt = '') {
  const image = document.createElement('img')
  image.loading = 'lazy'
  image.decoding = 'async'
  image.dataset.myTvArtworkSource = source
  image.src = source
  image.alt = alt
  return image
}

function myTvViewingPosterUrl(item) {
  if (item.poster_path) return myTvPosterUrl(item.poster_path)
  const localPoster = item.local?.poster
  if (!localPoster) return ''
  return item.local?.kind === 'channel-film'
    ? `/api/channel/artwork/${encodeURIComponent(localPoster)}`
    : `/api/my-tv/artwork/${encodeURIComponent(localPoster)}`
}

function rememberMyTvTitleMetadata(detail, original = null) {
  const key = detail?.key || (detail?.media_type && detail?.tmdb_id
    ? `${detail.media_type}:${Number(detail.tmdb_id)}` : '')
  if (!key) return
  const metadata = {}
  ;['title', 'year', 'poster_path', 'backdrop_path', 'overview', 'providers',
    'provider_result'].forEach(field => {
    if (detail[field] || (field === 'provider_result'
      && Object.prototype.hasOwnProperty.call(detail, field))) metadata[field] = detail[field]
  })
  const targets = [original, ...(myTvViewingData.items || [])]
  if (typeof myTvExploreItems !== 'undefined') targets.push(...myTvExploreItems)
  if (typeof myTvHomePersonal !== 'undefined') targets.push(...myTvHomePersonal)
  if (typeof myTvHomeDifferent !== 'undefined') targets.push(...myTvHomeDifferent)
  if (typeof myTvHomeReleased !== 'undefined') targets.push(...myTvHomeReleased)
  targets.filter(value => value && (value.key || `${value.media_type}:${Number(value.tmdb_id)}`) === key)
    .forEach(value => Object.assign(value, metadata))
  rememberMyTvProviderSummary(detail)
  refreshMyTvExploreCards()
  if (typeof refreshMyTvViewingRowArtwork === 'function') {
    document.querySelectorAll(`[data-viewing-key="${key}"]`).forEach(row => {
      const item = (myTvViewingData.items || []).find(value => value.key === key)
      if (item) refreshMyTvViewingRowArtwork(row, item)
    })
  }
}
