'use strict'

// Title acquisition has its own iPlayer request; it never paints the iPlayer tab.
let studioAcquisition = null
let studioJobOpenRevision = 0
const studioTitleNormal = value => String(value || '').toLowerCase().replace(/&/g, ' and ')
  .normalize('NFKD').replace(/[^a-z0-9]/g, '')

async function studioTitleGetAction(title, owned, revision) {
  const button = $('#myTvTitleGet')
  button.classList.add('hidden')
  if (owned || !title.tmdb_id || offlineMode) return
  const query = new URLSearchParams({tmdb_id: title.tmdb_id, media_type: title.media_type,
    title: title.title, year: title.year || ''})
  try {
    const cloud = await api('/api/studio/cloud?' + query)
    if (revision !== myTvTitleOpenRevision || selectedMyTvTitle?.tmdb_id !== title.tmdb_id
      || !$('#myTvTitleSheet').open || cloud.total) return
    button.classList.remove('hidden')
    button.onclick = () => void studioGetTitle(title).catch(studioFailure)
  } catch { /* Unknown ownership must not offer another acquisition. */ }
}

function studioAcquisitionCurrent(context) {
  return studioAcquisition === context && studioVisible() && studioState.tab === 'torrents'
    && $('#studioTorrentSearch').value.trim() === context.title.title
}
function studioCancelAcquisition() {
  studioJobOpenRevision++
  studioAcquisition = null
  if ($('#studioIplayerOffer').open) closeLibrarySheet($('#studioIplayerOffer'), false)
}
async function studioGetTitle(title) {
  studioCancelAcquisition()
  const context = studioAcquisition = {title, started: Date.now()}
  portalSheets.dismiss($('#myTvTitleSheet'))
  studioState.tab = 'torrents'
  openView('my-tv-studio')
  studioSetTab('torrents', {historyEntry: true})
  $('#studioTorrentSearch').value = title.title
  MabelPortalUI.syncSearchFields()
  void studioSearchTorrents(true).catch(studioFailure)
  if (title.media_type === 'movie' && !(title.runtime > 0)) {
    void api(`/api/my-tv/title?media_type=movie&tmdb_id=${title.tmdb_id}`).then(detail => {
      if (studioAcquisition !== context) return
      context.title = {...title, runtime:detail.runtime, year:detail.year || title.year}
      studioApplyIplayerOffer(context)
    }).catch(() => {})
  }
  try {
    context.request = await api('/api/studio/iplayer', {method: 'POST', body: JSON.stringify({query: title.title})})
    studioApplyIplayerOffer(context)
  } catch { /* A background lookup cannot interrupt the chosen torrent route. */ }
}
async function studioPollIplayerOffer() {
  const context = studioAcquisition
  if (!context?.request || !studioAcquisitionCurrent(context) || context.polling
    || !['active', 'queued'].includes(context.request.status) || Date.now() - context.started > 120000) return
  context.polling = true
  try {
    context.request = await api('/api/studio/request?id=' + encodeURIComponent(context.request.id))
    studioApplyIplayerOffer(context)
  } catch { /* Keep the torrent search usable. */ }
  finally { context.polling = false }
}
function studioConfidentIplayerItems(title, items) {
  const exact = items.filter(item => /^[bmp][a-z0-9]{7}$/.test(item.pid)
    && studioTitleNormal(item.title) === studioTitleNormal(title.title))
  if (title.media_type === 'tv') {
    // Episode/series numbering is positive evidence of the same programme,
    // rather than a similarly named film or an isolated related clip.
    return exact.filter(item => Number.isInteger(item.series) && item.episodeNumber > 0)
  }
  // A unique exact film title and complete runtime corroborate its identity.
  // Release years in structured data or an explicit film description must agree;
  // BBC's short synopsis often contains no production year at all.
  const year = String(title.year || title.release_date?.slice(0, 4) || '')
  const films = exact.filter(item => {
    const described = String(item.synopsis || '').match(/(?:film|comedy|drama|thriller|released|production)\s*(?:from\s*)?\(?((?:19|20)\d{2})\b/i)
      || String(item.synopsis || '').match(/\b((?:19|20)\d{2})\s+(?:film|comedy|drama|thriller)\b/i)
    const productionYear = String(item.year || item.releaseYear || described?.[1] || '')
    return !item.episodeNumber && item.series == null && (!productionYear || productionYear === year)
      && title.runtime > 0 && Math.abs(item.duration / 60 - title.runtime) <= Math.max(8, title.runtime * .1)
  })
  return films.length === 1 ? films : []
}
function studioApplyIplayerOffer(context) {
  if (!studioAcquisitionCurrent(context) || context.offered || context.request?.status !== 'complete'
    || studioTorrentInspecting || document.querySelector('.studio-title-sheet[open]')) return
  if (context.title.media_type === 'movie' && !(context.title.runtime > 0)) return
  const items = studioConfidentIplayerItems(context.title, context.request.result?.items || [])
  context.offered = true
  if (!items.length) return
  $('#studioIplayerOfferTitle').textContent = context.title.title
  studioMediaArt($('#studioIplayerOfferArt'), context.title)
  $('#studioIplayerOfferDownload').onclick = () => {
    if (!studioAcquisitionCurrent(context)) return
    studioCancelAcquisition()
    if (context.title.media_type === 'tv') openStudioEpisodes(items, 'iplayer')
    else openStudioDestination(items.map(item => ({type: 'iplayer', pid: item.pid, title: item.title})))
  }
  openLibrarySheet($('#studioIplayerOffer'))
}
portalSheets.wire($('#studioIplayerOffer'), {closeButton: $('#studioIplayerOfferClose'),
  close: () => closeLibrarySheet($('#studioIplayerOffer'))})
$('#studioIplayerOfferDismiss').onclick = () => closeLibrarySheet($('#studioIplayerOffer'))
$('#studioTorrentSearch').addEventListener('input', studioCancelAcquisition)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) studioCancelAcquisition()
})

async function studioOpenJobTitle(job, known) {
  const revision = ++studioJobOpenRevision
  const title = await studioResolveJobTitle(job, known)
  if (revision !== studioJobOpenRevision || !studioVisible() || studioState.tab !== 'activity') return
  if (!title?.tmdb_id) { notice('No title match is available yet.', true); return }
  // Open the card immediately; verify just this title's current Pi membership
  // independently of metadata, the full library, bootstrap and IndexedDB writes.
  await openMyTvTitle(title, null, {verifyLocal: true})
}
