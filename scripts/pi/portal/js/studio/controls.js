'use strict'

function studioViewportBounds() { document.documentElement.style.setProperty('--studio-viewport-height', (window.visualViewport?.height || window.innerHeight) + 'px') }
window.visualViewport?.addEventListener('resize', studioViewportBounds)
window.addEventListener('resize', studioViewportBounds)
studioViewportBounds()

// The keyboard overlays a film sheet; it must not resize the whole card.
// During typing, scroll the card (including its large header) within its normal
// frame, with enough trailing space to reveal the focused field above the keys.
let studioEditingSheet = null, studioKeyboardFrame = 0
function studioKeepFieldVisible() {
  cancelAnimationFrame(studioKeyboardFrame)
  studioKeyboardFrame = requestAnimationFrame(() => {
    const focused = document.activeElement
    const editable = focused?.matches('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]),textarea')
    const sheet = editable && focused.closest('.studio-title-sheet[open]')
    if (sheet) studioEditingSheet = sheet
    const viewport = window.visualViewport
    const keyboardOpen = viewport && viewport.scale === 1 && document.documentElement.clientHeight - viewport.height > 120
    const active = studioEditingSheet
    if (!active) return
    const panel = active.querySelector('.watch-film-panel')
    if (!active.open || !keyboardOpen) {
      if (active.classList.contains('studio-keyboard-open')) {
        active.classList.remove('studio-keyboard-open')
        panel.scrollTop = 0
        active.style.removeProperty('--studio-keyboard-cover')
      }
      if (active.open && sheet === active) {
        const body = focused.closest('.watch-film-body'), field = focused.getBoundingClientRect()
        if (body) {
          const bounds = body.getBoundingClientRect()
          if (field.bottom > bounds.bottom - 12) body.scrollTop += field.bottom - bounds.bottom + 12
          else if (field.top < bounds.top + 12) body.scrollTop -= bounds.top + 12 - field.top
        }
      }
      if (!active.open || !sheet) studioEditingSheet = null
      return
    }
    active.classList.add('studio-keyboard-open')
    const bottom = viewport.offsetTop + viewport.height
    const bounds = panel.getBoundingClientRect()
    active.style.setProperty('--studio-keyboard-cover', Math.max(0, bounds.bottom - bottom + 24) + 'px')
    if (sheet !== active) return
    const field = focused.closest('.my-tv-film-collection-controls') || focused
    const rect = field.getBoundingClientRect()
    const top = Math.max(bounds.top, viewport.offsetTop) + 16
    const limit = Math.min(bounds.bottom, bottom) - 24
    if (rect.bottom > limit) panel.scrollTop += rect.bottom - limit
    else if (rect.top < top) panel.scrollTop -= top - rect.top
  })
}
document.addEventListener('focusin', studioKeepFieldVisible)
document.addEventListener('focusout', studioKeepFieldVisible)
document.addEventListener('close', studioKeepFieldVisible, true)
window.visualViewport?.addEventListener('resize', studioKeepFieldVisible)
window.visualViewport?.addEventListener('scroll', studioKeepFieldVisible)
window.addEventListener('resize', studioKeepFieldVisible)

// Presentation helpers shared by Studio's source and destination owners.
function studioVideoLabel(value) {
  return String(value || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ')
    .replace(/\s+(?:2160p|1080p|720p|480p|BluRay|BRRip|WEBRip|WEB-DL|HDTV)\b.*$/i, '').replace(/[\s-]+$/, '').trim()
}
function studioEmpty(title, message = '', symbol = 'signal-search', loading = false) {
  const panel = document.createElement('div'); panel.className = 'studio-empty'
  const art = document.createElement('span'), heading = document.createElement('h3')
  if (loading) { const spinner = document.createElement('i'); spinner.className = 'studio-spinner'; art.append(spinner) }
  else art.append(librarySignalIcon(symbol))
  heading.textContent = title; panel.append(art, heading)
  if (message) { const copy = document.createElement('p'); copy.textContent = message; panel.append(copy) }
  return panel
}
function studioMediaArt(host, title = null, fallback = 'signal-film') {
  const poster = title && myTvViewingPosterUrl(title)
  replaceMyTvArtworkChildren(host, poster ? myTvArtworkImage(poster) : librarySignalIcon(fallback))
}
// Native selects are the single control; no hidden duplicate or option sheet.
function studioSyncSelects() {
  for (const select of $$('[data-studio-options]')) select.setAttribute('aria-label', select.dataset.studioOptions)
}
$('#studioCreateCollection').onclick = async () => {
  const button = $('#studioCreateCollection'); button.disabled = true
  $('#studioNewCollectionError').textContent = ''
  try {
    const result = await api('/api/studio/collections', { method: 'POST', body: JSON.stringify({ name: $('#studioNewCollectionName').value.trim(), scope: 'pi' }) })
    library.my_tv_folders = result.collections
    studioDraft.targetCollections.film = result.name
    studioSyncDestination(); $('#studioNewCollectionName').value = ''
  } catch (error) { $('#studioNewCollectionError').textContent = error.message }
  finally { button.disabled = false }
}

function studioJobPresentation(job, waitingCloud) {
  const tv = ['film','series','mabel'].includes(job.destination.kind)
  const place = job.destination.kind === 'mabel' ? 'Mabel TV' : tv ? 'My TV' : 'iCloud'
  if (job.status === 'cancelled') return {status:'Cancelled',message:''}
  if (job.cloudOperation) return {status:job.status === 'complete' ? 'Complete' : job.status === 'failed' ? 'Needs attention' : 'Working',message:job.error || job.message || ''}
  const review = job.status === 'failed' && job.errorCode === 'QUALITY_REVIEW'
  if (review && !job.destination.optimiseCloud) return { status: tv ? 'Downloaded · not yet on TV' : 'Downloaded · not yet in iCloud',
    message: 'Continue without further compression. TV format checks still apply.' }
  if (review) return { status: 'Compression not started', message: 'Already in iCloud. Further compression may reduce picture quality.' }
  if (waitingCloud) return { status: tv ? 'On ' + place + ' · uploading to iCloud' : 'Uploading to iCloud', message: 'Waiting for iCloud confirmation.' }
  if (job.stage === 'saving-cloud' && /file is busy/i.test(job.message || '')) return {status: tv ? 'On ' + place + ' · saving to iCloud' : 'Saving to iCloud', message:'iCloud file is busy. Retrying automatically.'}
  if (job.status === 'failed' || job.metadataWarning) return { status:'Needs attention', message:studioJobFailureMessage(job.error || job.metadataWarning) }
  if (job.status === 'complete') return { status: tv ? 'On ' + place + (job.destination.saveCloud ? ' · saved to iCloud' : '') : job.destination.kind === 'local' ? 'Downloaded' : 'Saved to iCloud', message:'' }
  if (job.status === 'paused') return {status:'Paused',message:''}
  if (job.status === 'queued') return {status:'Queued for ' + place,message:''}
  const stages = { downloading:'Downloading', preparing:'Downloaded · preparing for ' + place,
    'queued-conversion':'Downloaded · waiting to prepare', uploading:'Sending to ' + place,
    'queued-upload':'Ready · waiting to send to ' + place, 'saving-cloud':tv ? 'On ' + place + ' · saving to iCloud' : 'Saving to iCloud',
    matching:'Adding title details', 'freeing-space':'Freeing local space', 'queued-download':'Waiting to download' }
  return {status:stages[job.stage] || job.displayStatus || 'Working',message:job.cloudOperation ? job.message || '' : ''}
}

// Artwork lookup is presentation-only and never holds up a download or changes
// its metadata match. Cache successes and misses for this page session.
const studioJobArtCache = new Map()
function studioJobArtwork(host, job, known) {
  known = studioLocalJobTitle(job, known) || known
  const draw = title => {
    const poster = title && myTvViewingPosterUrl(title), key = poster || 'fallback'
    if (host.dataset.artKey === key) return
    host.dataset.artKey = key
    studioMediaArt(host, title, job.destination.kind === 'series' ? 'signal-tv' : 'signal-film')
    const image = host.querySelector('img'); if (image) image.loading = 'eager'
  }
  if (known && myTvViewingPosterUrl(known)) { host.dataset.artRequest = ''; draw(known); return }
  if (!host.dataset.artKey) draw(null)
  const requestKey = host.dataset.artRequest = JSON.stringify([job.id, known?.tmdb_id])
  void studioResolveJobTitle(job, known, true).then(title => { if (title && host.isConnected && host.dataset.artRequest === requestKey) draw(title) })
}
function studioResolveJobTitle(job, known, needsArtwork = false) {
  known = studioLocalJobTitle(job, known) || known
  if (known?.tmdb_id && known?.media_type && (!needsArtwork || myTvViewingPosterUrl(known))) return Promise.resolve(known)
  if (!['torrent', 'iplayer', 'cloud', 'pi'].includes(job.source?.type)) return Promise.resolve(null)
  const raw = studioVideoLabel(job.title).replace(/\bS\d{1,2}(?:E\d{1,3})?\b.*$/i, '').trim()
  const stamp = [...raw.matchAll(/\b(?:19|20)\d{2}\b/g)].filter(value => value.index > 0).at(-1)
  const year = known?.year || stamp?.[0] || ''
  const query = known?.title || (stamp ? raw.slice(0, stamp.index) : raw).replace(/[([\s-]+$/, '').trim()
  if (query.length < 2) return Promise.resolve(null)
  const type = known?.media_type || (job.destination.kind === 'series' ? 'tv' : 'movie'), key = type + ':' + query + ':' + year
  if (!studioJobArtCache.has(key)) studioJobArtCache.set(key, api('/api/my-tv/discovery?q=' + encodeURIComponent(query)).then(response => {
    const normal = value => String(value).toLowerCase().replace(/&/g, ' and ').normalize('NFKD').replace(/[^a-z0-9]/g, '')
    const candidates = (response.results || []).filter(item => item.media_type === type && (!year || String(item.year) === String(year)))
    const identified = candidates.find(item => known?.tmdb_id && String(item.tmdb_id) === String(known.tmdb_id))
    if (identified) return identified
    const exact = candidates.filter(item => normal(item.title) === normal(query))
    // Some release names prefix the canonical title with a franchise name.
    const subtitle = query.includes(':') ? query.slice(query.indexOf(':') + 1).trim() : ''
    const suffix = candidates.filter(item => (subtitle && normal(item.title) === normal(subtitle)) || (year && item.title.split(/\s+/).length >= 4 && normal(query).endsWith(normal(item.title))))
    return exact.length === 1 ? exact[0] : !exact.length && suffix.length === 1 ? suffix[0] : null
  }).catch(() => { studioJobArtCache.delete(key); return null }))
  return studioJobArtCache.get(key)
}

function studioLocalJobTitle(job, known) {
  const identity = Number(known?.tmdb_id || job.matchedTitle?.tmdb_id || job.match?.tmdb_id)
  const result = job.result || {}, path = result.file || [result.folder, result.file_name].filter(Boolean).join('/')
  const candidates = [
    ...(library?.my_tv_library || []).map(file => ({file, type:'movie', local:{kind:'film',path:file.path,poster:file.metadata?.poster}})),
    ...(library?.my_tv_series || []).map(file => ({file, type:'tv', local:{kind:'series',series:file.id,poster:file.metadata?.poster}})),
    ...(library?.channels || []).flatMap(channel => (channel.programmes || []).map(file =>
      ({file, type:'movie', local:{kind:'channel-film',channel:channel.number,file:file.name,poster:file.metadata?.poster}}))),
  ]
  const match = candidates.find(({file,type,local}) => identity ? Number(file.metadata?.tmdb_id) === identity
    && type === (known?.media_type || (job.destination.kind === 'series' ? 'tv' : 'movie'))
    : local.kind === 'channel-film' ? result.kind === 'channel' && file.name === result.file_name && (!result.channel || local.channel === result.channel)
      : Boolean(path) && file.path === path || Boolean(job.destination.series) && file.id === job.destination.series)
  if (!match?.file.metadata?.tmdb_id) return null
  const metadata = match.file.metadata
  return {...known,...metadata,key:match.type+':'+metadata.tmdb_id,media_type:match.type,local:match.local,on_mabeltv:true}
}
