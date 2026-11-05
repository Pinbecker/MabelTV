'use strict'

studioState.torrentRequest = null
studioState.torrentSearch = null
studioState.torrentInspection = null
studioState.torrentSelected = new Map()
let studioTorrentSearching = false, studioTorrentInspecting = null
let studioTorrentGeneration = 0
$('#studioTorrentSearch').addEventListener('input', () => {
  if ($('#studioTorrentSearch').value.trim()) return
  studioTorrentGeneration++; studioState.torrentRequest = null
  studioState.torrentSearch = null; studioState.torrentInspection = null; studioState.torrentSelected.clear()
  studioTorrentInspectionLoading(null); studioTorrentSearchLoading(false)
  $('#studioTorrentStatus').textContent = ''
  $('#studioTorrentResults').classList.remove('has-results')
  $('#studioTorrentResults').replaceChildren(studioEmpty('Find a film or series', 'Search by title, then choose your files.'))
})

function studioTorrentSearchLoading(busy) {
  studioTorrentSearching = busy
  const root = $('#studioTorrentResults')
  root.setAttribute('aria-busy', String(busy))
  root.querySelector('.studio-search-loading')?.remove()
  if (busy) root.classList.remove('has-results')
  if (busy) {
    root.replaceChildren()
    const loading = studioEmpty('Finding results…', '', 'signal-search', true); loading.classList.add('studio-search-loading')
    root.append(loading)
  }
}
function studioTorrentInspectionLoading(hash) {
  studioTorrentInspecting = hash
  for (const row of $$('#studioTorrentResults .studio-torrent-result')) {
    const busy = row.dataset.torrentHash === hash
    row.disabled = Boolean(hash); row.classList.toggle('is-loading', busy)
    row.setAttribute('aria-busy', String(busy))
    row.querySelector('.studio-torrent-trailing').innerHTML = busy
      ? '<span class="studio-spinner" aria-label="Loading file details"></span>'
      : '<svg class="icon"><use href="/portal/icons.svg#signal-chevron-right"/></svg>'
  }
}

async function studioSearchTorrents(replace = false) {
  const query = $('#studioTorrentSearch').value.trim()
  if (replace) { studioState.torrentRequest = null; studioTorrentSearching = false; studioTorrentInspectionLoading(null) }
  if (query.length < 2 || studioTorrentSearching || studioTorrentInspecting) return
  const generation = ++studioTorrentGeneration
  studioTorrentSearchLoading(true)
  $('#studioTorrentStatus').textContent = ''
  try {
    const request = await api('/api/studio/torrents/search', { method: 'POST', body: JSON.stringify({ query }) })
    if (generation !== studioTorrentGeneration) return
    studioState.torrentRequest = request
    await studioApplyTorrents(studioState.torrentRequest)
  } catch (error) {
    if (generation !== studioTorrentGeneration) return
    studioTorrentSearchLoading(false); throw error
  }
}
async function studioPollTorrents() {
  const pending = studioState.torrentRequest
  const response = await api('/api/studio/request?id=' + encodeURIComponent(pending.id))
  if (studioState.torrentRequest?.id !== pending.id) return
  studioState.torrentRequest = response
  await studioApplyTorrents(response)
}
async function studioApplyTorrents(request) {
  const status = $('#studioTorrentStatus')
  if (request.status === 'failed') { studioTorrentSearchLoading(false); studioTorrentInspectionLoading(null); status.textContent = request.error || 'The search could not finish. Try again.'; return }
  if (request.status !== 'complete') {
    status.textContent = request.kind === 'torrent-inspect' ? 'Loading file details…' : ''
    if (request.kind !== 'torrent-inspect' && !studioState.status?.workers.some(worker => worker.online && worker.capabilities?.includes('torrent'))) $('#studioTorrentResults').replaceChildren(studioEmpty('Search queued', 'Waiting for Studio to connect.'))
    return
  }
  studioTorrentSearchLoading(false)
  if (request.kind === 'torrent-inspect') { studioTorrentInspectionLoading(null); studioOpenTorrentReview(request); status.textContent = 'File details ready'; return }
  studioState.torrentSearch = request
  const items = request.result?.items || [], root = $('#studioTorrentResults'); root.replaceChildren()
  root.classList.toggle('has-results', items.length > 0)
  status.textContent = items.length ? `${items.length} results` : ''
  if (!items.length) root.append(studioEmpty('No results found', 'Try another title.'))
  for (const item of items) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'studio-torrent-result'
    row.dataset.torrentHash = item.hash
    row.innerHTML = `<span class="studio-torrent-icon"><svg class="icon"><use href="/portal/icons.svg#signal-film"/></svg></span><span><strong>${escapeHtml(studioVideoLabel(item.title))}</strong><span class="studio-result-facts"><span class="studio-chip">${Number(item.seeders) || 0} seeders</span><span class="studio-result-size">${studioBytes(item.bytes)}</span></span></span><span class="studio-torrent-trailing"><svg class="icon"><use href="/portal/icons.svg#signal-chevron-right"/></svg></span>`
    row.onclick = async () => {
      const generation = studioTorrentGeneration
      studioCancelAcquisition()
      studioTorrentInspectionLoading(item.hash)
      status.textContent = 'Loading file details…'
      try {
        const inspection = await api('/api/studio/torrents/inspect', { method: 'POST', body: JSON.stringify({ request: request.id, hash: item.hash }) })
        if (generation !== studioTorrentGeneration) return
        studioState.torrentRequest = inspection
        await studioApplyTorrents(studioState.torrentRequest)
      } catch (error) {
        if (generation !== studioTorrentGeneration) return
        studioTorrentInspectionLoading(null); studioFailure(error)
      }
    }
    root.append(row)
  }
}
function studioOpenTorrentReview(request) {
  studioState.torrentInspection = request
  studioState.torrentSelected.clear()
  const files = (request.result?.files || []).filter(file => /\.(mp4|mkv|m4v|mov|avi|webm|mpg|mpeg|ts)$/i.test(file.path))
  studioState.torrentVideos = files
  if (files.length === 1) studioState.torrentSelected.set(files[0].index, files[0])
  $('#studioTorrentTitle').textContent = studioVideoLabel(request.result.title)
  $('#studioTorrentSheet').classList.toggle('is-single', files.length === 1)
  $('#studioTorrentFileInfo').textContent = [request.result.title, ...files.map(file => file.path)].join('\n')
  $('#studioTorrentFileCount').textContent = `${files.length} video${files.length === 1 ? '' : 's'}`
  $('#studioTorrentReviewError').classList.add('hidden')
  const seasons = [...new Set(files.map(file => file.series).filter(Number.isInteger))].sort((a,b) => a-b), select = $('#studioTorrentSeason')
  select.replaceChildren(); select.add(new Option('All seasons', 'all'))
  for (const season of seasons) select.add(new Option(season === 0 ? 'Specials' : 'Season ' + season, String(season)))
  select.hidden = seasons.length < 2
  studioRenderTorrentFiles()
  openLibrarySheet($('#studioTorrentSheet'))
}
function studioRenderTorrentFiles() {
  const root = $('#studioTorrentFiles'); root.replaceChildren()
  const season = $('#studioTorrentSeason').value
  for (const file of studioState.torrentVideos.filter(item => season === 'all' || String(item.series) === season)) {
    const label = document.createElement('label'); label.className = 'studio-episode'
    const title = file.path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[._]/g, ' ')
    label.innerHTML = `<input type="checkbox" aria-label="Select ${escapeHtml(title)}"><span><strong>${escapeHtml(studioVideoLabel(title))}</strong><small>${file.series === 0 ? 'Specials · ' : Number.isInteger(file.series) ? `Season ${file.series} · ` : ''}${file.episodeNumber ? `Episode ${file.episodeNumber} · ` : ''}${studioBytes(file.bytes)}</small></span>`
    const input = label.querySelector('input'); input.checked = studioState.torrentSelected.has(file.index)
    input.onchange = () => { if (input.checked) studioState.torrentSelected.set(file.index, file); else studioState.torrentSelected.delete(file.index); studioTorrentCount() }
    label.dataset.fileIndex = file.index; root.append(label)
  }
  if (!studioState.torrentVideos.length) root.append(portalEmptyState({ title: 'No supported videos', message: 'Choose another result containing film or TV video files.' }))
  studioTorrentCount()
}
function studioTorrentCount() {
  const files = [...studioState.torrentSelected.values()]
  $('#studioTorrentSelected').textContent = `${files.length} selected — ${studioBytes(files.reduce((sum, file) => sum + file.bytes, 0))}`
  $('#studioTorrentContinue').disabled = !files.length || files.length > 200
}
$('#studioTorrentSearchForm').onsubmit = event => { event.preventDefault(); void studioSearchTorrents().catch(studioFailure) }
$('#studioTorrentSeason').onchange = studioRenderTorrentFiles
$('#studioTorrentAll').onclick = () => {
  const labels = [...$('#studioTorrentFiles').querySelectorAll('[data-file-index]')], all = labels.some(label => !label.querySelector('input').checked)
  for (const label of labels) {
    const index = Number(label.dataset.fileIndex), file = studioState.torrentVideos.find(item => item.index === index)
    if (all) studioState.torrentSelected.set(index, file); else studioState.torrentSelected.delete(index)
  }
  studioRenderTorrentFiles()
}
$('#studioTorrentContinue').onclick = () => {
  const files = [...studioState.torrentSelected.values()], request = studioState.torrentInspection
  if (!files.length) return
  const episode = files.find(file => Number.isInteger(file.series))
  const title = episode ? episode.path.split('/').pop().split(/\bS\d{1,2}E\d{1,3}\b|\b\d{1,2}x\d{1,3}\b/i)[0].replace(/[._]/g, ' ').trim().replace(/[- ]+$/, '') : studioVideoLabel(request.result.title)
  closeLibrarySheet($('#studioTorrentSheet'), false)
  openStudioDestination([{ type: 'torrent', request: request.id, files: files.map(file => file.index), title,
    kind: 'video', bytes: files.reduce((sum, file) => sum + file.bytes, 0), ...(episode ? { seriesTitle: title, series: episode.series, seasons: [...new Set(files.map(file => file.series).filter(Number.isInteger))] } : {}) }])
}
portalSheets.wire($('#studioTorrentSheet'), { closeButton: $('#studioTorrentClose'), close: () => closeLibrarySheet($('#studioTorrentSheet')) })
