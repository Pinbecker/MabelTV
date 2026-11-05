'use strict'

const studioState = { tab: 'cloud', cloud: null, items: [], selected: new Map(), selecting: false,
  status: null, request: null, programmes: [], episodes: [], episodeSource: 'iplayer', episodeSelection: new Map(), presence: new Set() }
let studioTimer = null, studioLoading = false, studioCloudTimer = null, studioLastCloudScan = 0

function studioVisible() { return $('#view-my-tv-studio')?.classList.contains('active') && !offlineMode }
function studioBytes(bytes) {
  if (!bytes) return '0 B'
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`
}
function studioFailure(error) {
  if (error?.expectedAbort) return
  $('#studioError').textContent = error.message || 'Studio could not connect. Try again.'
  $('#studioError').classList.remove('hidden')
}
function studioLastChecked(time) {
  return time ? `Checked ${new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not checked yet'
}
function studioSetTab(tab, { historyEntry = false } = {}) {
  if (tab !== 'torrents') studioCancelAcquisition()
  else if (studioState.tab !== 'torrents') studioJobOpenRevision++
  studioState.tab = ['cloud', 'iplayer', 'torrents', 'activity'].includes(tab) ? tab : 'cloud'
  for (const [key, id] of [['cloud', 'studioCloudPane'], ['iplayer', 'studioIplayerPane'], ['torrents', 'studioTorrentPane'], ['activity', 'studioActivityPane']]) {
    $('#' + id).classList.toggle('hidden', studioState.tab !== key)
  }
  $$('[data-studio-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.studioTab === studioState.tab)
    button.setAttribute('aria-pressed', String(button.dataset.studioTab === studioState.tab))
  })
  if (historyEntry) history.pushState({ primaryView: 'my-tv-studio' }, '', '#my-tv-studio/' + studioState.tab)
  if (studioState.tab === 'cloud' && !studioState.cloud) void studioLoadCloud().catch(studioFailure)
  if (studioState.tab === 'activity') renderStudioJobs()
  if (studioState.tab === 'iplayer' && !$('#studioIplayerGrid').children.length) $('#studioIplayerGrid').append(studioEmpty('Search BBC iPlayer', 'Find a programme or paste an episode link.'))
  if (studioState.tab === 'torrents' && !$('#studioTorrentResults').children.length) $('#studioTorrentResults').append(studioEmpty('Find a film or series', 'Search by title, then choose your files.'))
}
async function loadStudio() {
  studioSetTab(studioState.tab)
  if (!studioTimer) studioTimer = setInterval(() => { if (studioVisible()) void studioTick().catch(studioFailure) }, 3000)
  await studioTick()
}
async function studioTick() {
  if (studioLoading || !studioVisible()) return
  studioLoading = true
  try {
    const status = await api('/api/studio/status')
    studioState.status = status
    const online = status.workers.find(worker => worker.online)
    $('#studioWorkerDot').classList.toggle('online', Boolean(online))
    $('#studioWorkerState').textContent = online ? 'Connected' : 'Studio offline'
    $('#studioWorkerState').parentElement.classList.toggle('is-online', Boolean(online))
    $('#studioActiveCount').textContent = status.jobs.filter(job => ['queued', 'active'].includes(job.status)).length || ''
    renderStudioConnections()
    studioCloudOperationsStatus(status.cloudOperations)
    if (studioState.tab === 'activity') renderStudioJobs()
    if (studioState.tab === 'cloud' && (status.cloud.checked !== studioLastCloudScan || status.cloud.metadataRevision !== studioState.cloud?.metadataRevision || status.cloud.collectionRevision !== studioState.cloud?.collectionRevision)) await studioLoadCloud()
    if (studioState.request && ['queued', 'active'].includes(studioState.request.status)) await studioPollSearch()
    if (studioState.torrentRequest && ['queued', 'active'].includes(studioState.torrentRequest.status)) await studioPollTorrents()
    void studioPollIplayerOffer()
    $('#studioError').classList.add('hidden')
  } finally { studioLoading = false }
}
async function studioLoadCloud({ more = false } = {}) {
  const query = new URLSearchParams({ q: $('#studioCloudSearch').value, category: $('#studioCloudCategory').value,
    sort: $('#studioCloudSort').value, offset: more ? studioState.items.length : 0 })
  const response = await api('/api/studio/cloud?' + query)
  studioState.cloud = response
  studioLastCloudScan = response.checked
  studioState.items = more ? [...studioState.items, ...response.items] : response.items
  renderStudioCloud()
  studioQueueMetadata(response.needsMetadata || [])
}
function studioArtwork(item) {
  return /^https:\/\/ichef\.(?:bbci|bbc)\.co\.uk\//.test(item.artwork || '')
    ? `<img src="/api/studio/artwork?url=${encodeURIComponent(item.artwork)}" alt="" loading="lazy">`
    : '<svg class="icon"><use href="/portal/icons.svg#signal-film"/></svg>'
}
async function studioSearchIplayer(refresh = false) {
  const query = $('#studioIplayerSearch').value.trim()
  if (!query) return
  let request
  try { request = await api('/api/studio/iplayer', { method: 'POST', body: JSON.stringify({ query, refresh }) }) }
  catch (error) {
    if ($('#studioIplayerSearch').value.trim() !== query) return
    throw error
  }
  if ($('#studioIplayerSearch').value.trim() !== query) return
  studioState.request = request
  await studioApplySearch(studioState.request)
  void api('/api/iplayer/library').then(inventory => {
    studioState.presence = new Set((inventory.items || []).map(item => item.pid).filter(Boolean))
  }).catch(() => {})
}
async function studioPollSearch() {
  const pending = studioState.request
  const request = await api('/api/studio/request?id=' + encodeURIComponent(pending.id))
  if (studioState.request?.id !== pending.id) return
  studioState.request = request
  await studioApplySearch(request)
}
async function studioApplySearch(request) {
  if (request.status === 'failed') {
    $('#studioIplayerStatus').textContent = ''
    $('#studioIplayerGrid').replaceChildren(studioEmpty('Search unavailable', request.error || 'Try again.'))
    return
  }
  if (request.status !== 'complete') {
    const online = studioState.status?.workers.some(w => w.online)
    $('#studioIplayerStatus').textContent = ''
    $('#studioIplayerGrid').replaceChildren(studioEmpty(online ? 'Finding programmes…' : 'Search queued', online ? '' : 'Waiting for Studio to connect.', 'signal-search', online))
    return
  }
  studioState.programmes = request.result?.items || []
  $('#studioIplayerPane .studio-iplayer-intro').classList.toggle('has-results', studioState.programmes.length > 0)
  const groups = new Map()
  for (const item of studioState.programmes) {
    const key = item.title
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  $('#studioIplayerStatus').textContent = `${groups.size} programme${groups.size === 1 ? '' : 's'}${request.result?.truncated ? ' — refine your search for more' : ''}`
  const root = $('#studioIplayerGrid'); root.replaceChildren()
  if (!groups.size) root.append(studioEmpty('No programmes found', 'Try another name or paste an episode link.'))
  for (const episodes of groups.values()) {
    const item = episodes[0], button = document.createElement('button')
    button.type = 'button'; button.className = 'studio-programme'
    button.innerHTML = `<span class="studio-programme-art">${studioArtwork(item)}<span class="studio-chip">${episodes.length} episode${episodes.length === 1 ? '' : 's'}</span></span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.channel)}${item.series ? ` · Series ${item.series}` : ''}</small>`
    button.onclick = () => openStudioEpisodes(episodes)
    root.append(button)
  }
}
async function openStudioCloudSeries(item) {
  const result = await api('/api/studio/cloud?series=' + encodeURIComponent(item.id))
  studioState.cloudEpisodeTitle = item
  openStudioEpisodes(result.items.map(i => ({ ...i, title: i.series_title, episode: i.name.replace(/\.[^.]+$/, ''), channel: 'iCloud' })), 'cloud')
}
function openStudioEpisodes(episodes, source = 'iplayer') {
  studioState.episodeSource = source
  studioState.episodes = [...episodes].sort((a, b) => ((a.series || 0) - (b.series || 0)) || (a.episodeNumber || 0) - (b.episodeNumber || 0))
  studioState.episodeSelection.clear()
  if (studioState.episodeDraft && source === 'cloud') {
    const selected = new Set(studioState.episodeDraft.sources.map(item => item.id))
    for (const item of episodes) if (selected.has(item.id)) studioState.episodeSelection.set(item.id, item)
  }
  const first = episodes[0]
  $('#studioEpisodesTitle').textContent = first.title
  $('#studioEpisodeHero').innerHTML = studioArtwork(first)
  $('#studioEpisodeCount').textContent = `${episodes.length} episodes`
  $('#studioEpisodeSource').textContent = source === 'cloud' ? 'iCloud library' : 'BBC iPlayer'
  const select = $('#studioEpisodeSeason'); select.replaceChildren()
  const seasons = [...new Set(episodes.map(i => i.series ?? 1))].sort((a,b) => a-b)
  if (seasons.length > 1) select.add(new Option('All seasons', 'all'))
  for (const season of seasons) select.add(new Option(season === 0 ? 'Specials' : `Season ${season}`, String(season)))
  select.value = seasons.length > 1 ? 'all' : String(seasons[0])
  renderStudioEpisodes()
  openLibrarySheet($('#studioEpisodesSheet'))
}
function renderStudioEpisodes() {
  const selectedSeason = $('#studioEpisodeSeason').value
  const root = $('#studioEpisodes'); root.replaceChildren()
  for (const item of studioState.episodes.filter(i => selectedSeason === 'all' || String(i.series ?? 1) === selectedSeason)) {
    const identity = item.id || item.pid
    const label = document.createElement('label'); label.className = 'studio-episode'
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(identity)}" aria-label="Select ${escapeHtml(item.episode || item.title)}"><span><strong>${escapeHtml(item.episode || item.title)}</strong>${studioState.presence.has(item.pid) ? '<small><span class="studio-chip good">Already on your TV</span></small>' : ''}</span><small>${item.duration ? `${Math.round(item.duration / 60)} min` : item.bytes ? studioBytes(item.bytes) : escapeHtml(item.channel || '')}</small>`
    label.querySelector('input').checked = studioState.episodeSelection.has(identity)
    label.querySelector('input').onchange = event => {
      if (event.target.checked) studioState.episodeSelection.set(identity, item)
      else studioState.episodeSelection.delete(identity)
      studioEpisodeCount()
    }
    root.append(label)
  }
  studioEpisodeCount()
}
function studioEpisodeCount() {
  $('#studioEpisodeSelected').textContent = `${studioState.episodeSelection.size} selected`
  $('#studioEpisodesContinue').disabled = !studioState.episodeSelection.size
  const inputs = [...$('#studioEpisodes').querySelectorAll('input')]
  $('#studioEpisodesAll').textContent = inputs.length && inputs.every(input => input.checked) ? 'Deselect all' : 'Select all'
}
function renderStudioConnections() {
  const state = studioState.status
  if (!state) return
  const online = state.workers.find(worker => worker.online)
  $('#studioLaptopName').textContent = online?.name || 'No connected device'
  $('#studioLaptopConnection').textContent = online ? 'Connected' : 'Offline'
  $('#studioLaptopConnection').classList.toggle('good', Boolean(online))
  $('#studioCloudConnectionState').textContent = state.cloud.error ? 'Needs attention' : state.cloud.configured ? 'Connected' : 'Not connected'
  $('#studioCloudConnectionState').classList.toggle('good', state.cloud.configured && !state.cloud.error)
  $('#studioCloudConnectionChecked').textContent = state.cloud.error || studioLastChecked(state.cloud.checked)
  $('#studioCloudConnect').textContent = state.cloud.configured ? 'Reconnect' : 'Connect'
  const backup = state.backup, verified = backup?.verified?.[0]
  $('#studioBackupState').textContent = verified ? 'Verified' : 'Waiting'
  $('#studioBackupState').classList.toggle('good', Boolean(verified))
  $('#studioBackupChecked').textContent = verified ? new Date(verified.verified * 1000).toLocaleString() : backup?.state || 'Waiting for Studio and scheduled Pi backup'
}

$$('[data-studio-tab]').forEach(button => button.onclick = () => studioSetTab(button.dataset.studioTab, { historyEntry: true }))
$('#studioCloudSearch').oninput = () => { clearTimeout(studioCloudTimer); studioCloudTimer = setTimeout(() => void studioLoadCloud().catch(studioFailure), 250) }
$('#studioCloudCategory').onchange = () => { studioState.selected.clear(); void studioLoadCloud().catch(studioFailure) }
$('#studioCloudSort').onchange = () => { studioState.selected.clear(); void studioLoadCloud().catch(studioFailure) }
$('#studioCloudMore').onclick = () => void studioLoadCloud({ more: true }).catch(studioFailure)
$('#studioCloudSelect').onclick = () => { studioState.selecting = !studioState.selecting; if (!studioState.selecting) studioState.selected.clear(); renderStudioCloud() }
$('#studioCloudContinue').onclick = () => void studioOpenCloudTitles([...studioState.selected.values()]).catch(studioFailure)
$('#studioCloudRefresh').onclick = async () => {
  const button = $('#studioCloudRefresh'); button.disabled = true
  try {
    await api('/api/studio/cloud/refresh', { method: 'POST', body: '{}' })
    studioQueueMetadata(studioState.cloud?.needsMetadata || [], true)
    $('#studioCloudStatus').textContent = 'Refreshing iCloud…'
    await studioTick()
  } catch (error) { studioFailure(error) }
  finally { button.disabled = false }
}
$('#studioIplayerSearchForm').onsubmit = event => { event.preventDefault(); void studioSearchIplayer().catch(studioFailure) }
$('#studioIplayerSearch').addEventListener('input', () => {
  if ($('#studioIplayerSearch').value.trim()) return
  studioState.request = null; studioState.programmes = []
  $('#studioIplayerStatus').textContent = ''
  $('#studioIplayerPane .studio-iplayer-intro').classList.remove('has-results')
  $('#studioIplayerGrid').replaceChildren(studioEmpty('Search BBC iPlayer', 'Find a programme or paste an episode link.'))
})
$('#studioEpisodeSeason').onchange = renderStudioEpisodes
$('#studioEpisodesAll').onclick = () => { const inputs = [...$('#studioEpisodes').querySelectorAll('input')]; const all = inputs.some(i => !i.checked); inputs.forEach(input => { input.checked = all; const item = studioState.episodes.find(i => (i.id || i.pid) === input.value); if (all) studioState.episodeSelection.set(input.value, item); else studioState.episodeSelection.delete(input.value) }); studioEpisodeCount() }
$('#studioEpisodesContinue').onclick = () => {
  const selected = [...studioState.episodeSelection.values()]
  closeLibrarySheet($('#studioEpisodesSheet'), false)
  if (studioState.episodeSource === 'cloud') { void studioOpenCloudTitles([studioState.cloudEpisodeTitle], selected).catch(studioFailure); return }
  openStudioDestination(selected.map(i => studioState.episodeSource === 'cloud' ? { type: 'cloud', id: i.id, title: i.title, seriesTitle: i.series_title, series: i.series, kind: 'video' } : { type: 'iplayer', pid: i.pid, title: i.title, series: i.series }))
}
$('#studioConnection').onclick = () => { renderStudioConnections(); openLibrarySheet($('#studioConnectionSheet')) }
for (const [sheet, close] of [['studioEpisodesSheet', 'studioEpisodesClose'], ['studioConnectionSheet', 'studioConnectionClose']]) {
  portalSheets.wire($('#' + sheet), { closeButton: $('#' + close), close: () => {
    closeLibrarySheet($('#' + sheet), !studioState.episodeDraft)
    if (sheet === 'studioEpisodesSheet' && studioState.episodeDraft) {
      studioDraft = studioState.episodeDraft; studioState.episodeDraft = null
      openLibrarySheet($('#studioDestinationSheet'))
    }
  } })
}
