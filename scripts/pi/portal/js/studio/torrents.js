'use strict'

studioState.torrentRequest = null
studioState.torrentSearch = null
studioState.torrentInspection = null
studioState.torrentSelected = new Map()

async function studioSearchTorrents() {
  const query = $('#studioTorrentSearch').value.trim()
  if (query.length < 2) return
  $('#studioTorrentResults').replaceChildren()
  studioState.torrentRequest = await api('/api/studio/torrents/search', { method: 'POST', body: JSON.stringify({ query }) })
  await studioApplyTorrents(studioState.torrentRequest)
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
  if (request.status === 'failed') { status.textContent = request.error || 'The search could not finish. Try again.'; return }
  if (request.status !== 'complete') {
    status.textContent = request.kind === 'torrent-inspect' ? 'Getting the file list. This can take a few minutes while peers connect.'
      : studioState.status?.workers.some(worker => worker.online && worker.capabilities?.includes('torrent')) ? 'Searching The Pirate Bay…' : 'Search queued. Results will appear when Studio connects.'
    return
  }
  if (request.kind === 'torrent-inspect') { studioOpenTorrentReview(request); status.textContent = 'File details ready. Choose what to keep.'; return }
  studioState.torrentSearch = request
  const items = request.result?.items || [], root = $('#studioTorrentResults'); root.replaceChildren()
  status.textContent = items.length ? `${items.length} results · Most seeders first` : 'No results found. Try another title.'
  for (const item of items) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'studio-torrent-result'
    row.innerHTML = `<span class="studio-torrent-icon"><svg class="icon"><use href="/portal/icons.svg#signal-film"/></svg></span><span><strong>${escapeHtml(item.title)}</strong><small>${studioBytes(item.bytes)} · ${Number(item.seeders) || 0} seeders</small></span><svg class="icon"><use href="/portal/icons.svg#signal-chevron-right"/></svg>`
    row.onclick = async () => {
      row.disabled = true
      try {
        studioState.torrentRequest = await api('/api/studio/torrents/inspect', { method: 'POST', body: JSON.stringify({ request: request.id, hash: item.hash }) })
        await studioApplyTorrents(studioState.torrentRequest)
      } catch (error) { studioFailure(error) }
      finally { row.disabled = false }
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
  $('#studioTorrentTitle').textContent = request.result.title
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
    label.innerHTML = `<input type="checkbox" aria-label="Select ${escapeHtml(title)}"><span><strong>${escapeHtml(title)}</strong><small>${file.series === 0 ? 'Specials · ' : Number.isInteger(file.series) ? `Season ${file.series} · ` : ''}${file.episodeNumber ? `Episode ${file.episodeNumber} · ` : ''}${studioBytes(file.bytes)}</small></span>`
    const input = label.querySelector('input'); input.checked = studioState.torrentSelected.has(file.index)
    input.onchange = () => { if (input.checked) studioState.torrentSelected.set(file.index, file); else studioState.torrentSelected.delete(file.index); studioTorrentCount() }
    label.dataset.fileIndex = file.index; root.append(label)
  }
  if (!studioState.torrentVideos.length) root.append(portalEmptyState({ title: 'No supported videos', message: 'Choose another result containing film or TV video files.' }))
  studioTorrentCount()
}
function studioTorrentCount() {
  const files = [...studioState.torrentSelected.values()]
  $('#studioTorrentSelected').textContent = `${files.length} selected · ${studioBytes(files.reduce((sum, file) => sum + file.bytes, 0))}`
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
  const title = episode ? episode.path.split('/').pop().split(/\bS\d{1,2}E\d{1,3}\b|\b\d{1,2}x\d{1,3}\b/i)[0].replace(/[._]/g, ' ').trim().replace(/[- ]+$/, '') : request.result.title
  closeLibrarySheet($('#studioTorrentSheet'), false)
  openStudioDestination([{ type: 'torrent', request: request.id, files: files.map(file => file.index), title,
    kind: 'video', ...(episode ? { seriesTitle: title, series: episode.series, seasons: [...new Set(files.map(file => file.series).filter(Number.isInteger))] } : {}) }])
}
portalSheets.wire($('#studioTorrentSheet'), { closeButton: $('#studioTorrentClose'), close: () => closeLibrarySheet($('#studioTorrentSheet')) })
