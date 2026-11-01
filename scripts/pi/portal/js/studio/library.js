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
  $('#studioError').textContent = error.message || 'Studio could not connect. Try again.'
  $('#studioError').classList.remove('hidden')
}
function studioLastChecked(time) {
  return time ? `Checked ${new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not checked yet'
}
function studioSetTab(tab, { historyEntry = false } = {}) {
  studioState.tab = ['cloud', 'iplayer', 'activity'].includes(tab) ? tab : 'cloud'
  for (const [key, id] of [['cloud', 'studioCloudPane'], ['iplayer', 'studioIplayerPane'], ['activity', 'studioActivityPane']]) {
    $('#' + id).classList.toggle('hidden', studioState.tab !== key)
  }
  $$('[data-studio-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.studioTab === studioState.tab)
    button.setAttribute('aria-pressed', String(button.dataset.studioTab === studioState.tab))
  })
  if (historyEntry) history.pushState({ primaryView: 'my-tv-studio' }, '', '#my-tv-studio/' + studioState.tab)
  if (studioState.tab === 'cloud' && !studioState.cloud) void studioLoadCloud().catch(studioFailure)
  if (studioState.tab === 'activity') renderStudioJobs()
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
    $('#studioWorkerState').textContent = online ? `${online.name} is connected` : 'Waiting for your laptop'
    $('#studioActiveCount').textContent = status.jobs.filter(job => ['queued', 'active'].includes(job.status)).length || ''
    renderStudioConnections()
    studioCloudOperationsStatus(status.cloudOperations)
    if (studioState.tab === 'activity') renderStudioJobs()
    if (studioState.tab === 'cloud' && (status.cloud.checked !== studioLastCloudScan || status.cloud.metadataRevision !== studioState.cloud?.metadataRevision)) await studioLoadCloud()
    if (studioState.request && ['queued', 'active'].includes(studioState.request.status)) await studioPollSearch()
    $('#studioError').classList.add('hidden')
  } finally { studioLoading = false }
}
async function studioLoadCloud({ more = false } = {}) {
  const query = new URLSearchParams({ q: $('#studioCloudSearch').value, category: $('#studioCloudCategory').value,
    offset: more ? studioState.items.length : 0 })
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
  studioState.request = await api('/api/studio/iplayer', { method: 'POST', body: JSON.stringify({ query, refresh }) })
  await studioApplySearch(studioState.request)
  void api('/api/iplayer/library').then(inventory => {
    studioState.presence = new Set((inventory.items || []).map(item => item.pid).filter(Boolean))
  }).catch(() => {})
}
async function studioPollSearch() {
  const request = await api('/api/studio/request?id=' + encodeURIComponent(studioState.request.id))
  studioState.request = request
  await studioApplySearch(request)
}
async function studioApplySearch(request) {
  if (request.status === 'failed') {
    $('#studioIplayerStatus').textContent = request.error || 'BBC search could not finish. Try again.'
    return
  }
  if (request.status !== 'complete') {
    const online = studioState.status?.workers.some(w => w.online)
    $('#studioIplayerStatus').textContent = online ? 'Searching BBC iPlayer…' : 'Search queued. Results will appear here.'
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
  $('#studioIplayerStatus').textContent = `${studioState.programmes.length} episodes · ${studioLastChecked(request.updated)}${request.result?.truncated ? ' · Refine your search for more results' : ''}`
  const root = $('#studioIplayerGrid'); root.replaceChildren()
  if (!groups.size) root.append(portalEmptyState({ title: 'No programmes found', message: 'Try another name or paste a BBC episode link.' }))
  for (const episodes of groups.values()) {
    const item = episodes[0], button = document.createElement('button')
    button.type = 'button'; button.className = 'studio-programme'
    button.innerHTML = `<span class="studio-programme-art">${studioArtwork(item)}</span><strong>${escapeHtml(item.title)}</strong><small>${item.series ? `Series ${item.series} · ` : ''}${episodes.length} episode${episodes.length === 1 ? '' : 's'} · ${escapeHtml(item.channel)}</small><p>${escapeHtml(item.synopsis)}</p>`
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
  const first = episodes[0]
  $('#studioEpisodesTitle').textContent = first.title
  $('#studioEpisodeHero').innerHTML = studioArtwork(first) + `<p>${escapeHtml(first.synopsis)}</p>`
  $('#studioEpisodeCount').textContent = `${episodes.length} episodes${first.series ? ` · Series ${first.series}` : ''}`
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
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(identity)}"><span><strong>${escapeHtml(item.episode || item.title)}</strong><small>${item.episodeNumber ? `Episode ${item.episodeNumber} · ` : ''}${item.duration ? `${Math.round(item.duration / 60)} min` : item.bytes ? studioBytes(item.bytes) : escapeHtml(item.channel)}${studioState.presence.has(item.pid) ? ' · Already on your TV' : ''}</small><p>${escapeHtml(item.synopsis || '')}</p></span>`
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
}
function renderStudioConnections() {
  const state = studioState.status
  if (!state) return
  $('#studioCloudConnectionState').textContent = state.cloud.error || (state.cloud.configured ? 'Connected' : 'Not connected yet')
  $('#studioCloudConnectionChecked').textContent = studioLastChecked(state.cloud.checked)
  $('#studioCloudConnect').textContent = state.cloud.configured ? 'Reconnect' : 'Connect'
}

$$('[data-studio-tab]').forEach(button => button.onclick = () => studioSetTab(button.dataset.studioTab, { historyEntry: true }))
$('#studioCloudSearch').oninput = () => { clearTimeout(studioCloudTimer); studioCloudTimer = setTimeout(() => void studioLoadCloud().catch(studioFailure), 250) }
$('#studioCloudCategory').onchange = () => { studioState.selected.clear(); void studioLoadCloud().catch(studioFailure) }
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
$('#studioIplayerRefresh').onclick = () => void studioSearchIplayer(true).catch(studioFailure)
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
  portalSheets.wire($('#' + sheet), { closeButton: $('#' + close), close: () => closeLibrarySheet($('#' + sheet)) })
}
