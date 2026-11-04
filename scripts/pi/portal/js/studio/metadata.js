'use strict'

const studioMetadata = { candidate: null, queue: [], attempted: new Set(), active: 0, matching: null, revision: 0 }
function studioQueueMetadata(ids, retry = false) {
  for (const id of ids) {
    if (!retry && studioMetadata.attempted.has(id)) continue
    if (studioMetadata.queue.some(item => item.id === id)) continue
    studioMetadata.attempted.add(id); studioMetadata.queue.push({ id, retry })
  }
  while (studioMetadata.active < 2 && studioMetadata.queue.length) {
    const request = studioMetadata.queue.shift(); studioMetadata.active++
    void api('/api/studio/cloud/match', { method: 'POST', body: JSON.stringify({ ...request, automatic: true }) })
      .then(result => studioRememberCloudMetadata(result.item)).catch(() => {})
      .finally(() => { studioMetadata.active--; studioQueueMetadata([]) })
  }
}
function studioRememberCloudMetadata(item) {
  if (!item) return
  const index = studioState.items.findIndex(value => value.id === item.id)
  if (index >= 0 && item.collection === undefined) item = { ...item, collection: studioState.items[index].collection }
  if (index >= 0) studioState.items[index] = item
  if (studioState.selected.has(item.id)) studioState.selected.set(item.id, item)
  if (studioDraft?.cloudContext) {
    const titles = studioDraft.cloudContext.titles
    const current = titles.findIndex(value => value.id === item.id)
    if (current >= 0) {
      titles[current] = item
      if (titles.length === 1) {
        studioDraft.match = item.metadata
        for (const source of studioDraft.sources) { source.match = item.metadata; source.title = item.title }
      }
      studioDestinationMetadata()
    }
  }
  renderStudioCloud()
}
function studioDestinationMetadata() {
  const context = studioDraft?.cloudContext, first = studioDraft?.sources[0]
  $('#studioDestinationMore').classList.toggle('hidden', !context)
  const title = context?.titles.length === 1 ? studioCloudTitle(context.titles[0]) : studioDraft?.match
  const name = context?.titles.length > 1 ? context.titles.length + ' titles selected'
    : title?.title || studioDraft?.matchingJob?.title || first?.title || 'Selected videos'
  $('#studioDestinationTitle').textContent = name
  studioMediaArt($('#studioDestinationArt'), title)
  const series = context?.titles.length === 1 && context.titles[0].kind === 'series'
  const choose = $('#studioChooseEpisodes')
  choose.classList.toggle('hidden', !series || context.selectedEpisodes)
  choose.replaceChildren(document.createTextNode(studioDraft.sources.length + ' episodes '), librarySignalIcon('signal-chevron-down'))
  const bytes = studioDraft?.sources.reduce((total, source) => total + (Number(source.bytes) || 0), 0)
  $('#studioDestinationSummary').textContent = [title?.year, series ? 'iCloud' : bytes ? studioBytes(bytes) : first?.type === 'iplayer' ? 'BBC iPlayer' : ''].filter(Boolean).join(' · ')
  if (!context) return
  $('#studioActionsTitle').textContent = name
  studioMediaArt($('#studioActionsArt'), title)
  $('#studioCloudTitleSummary').textContent = [title?.year, bytes ? studioBytes(bytes) : context.files.length + ' files'].filter(Boolean).join(' · ')
  $('#studioCloudEditMetadata').disabled = context.titles.length !== 1
}
function studioOpenActions() {
  studioDestinationMetadata()
  closeLibrarySheet($('#studioDestinationSheet'), false)
  openLibrarySheet($('#studioActionsSheet'))
}
function studioCloseActions() {
  closeLibrarySheet($('#studioActionsSheet'), false)
  openLibrarySheet($('#studioDestinationSheet'))
}
$('#studioDestinationMore').onclick = studioOpenActions
$('#studioSendToTv').onclick = studioCloseActions
portalSheets.wire($('#studioActionsSheet'), { closeButton: $('#studioActionsClose'), close: studioCloseActions })
$('#studioConnectionsDone').onclick = () => closeLibrarySheet($('#studioConnectionSheet'))
async function studioOpenMetadataMatch(item) {
  studioMetadata.matching = item
  $('#studioCloudMatchSearch').value = item.title || item.name.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ')
  closeLibrarySheet($('#studioDestinationSheet'), false)
  closeLibrarySheet($('#studioActionsSheet'), false)
  openLibrarySheet($('#studioCloudMatchSheet'))
  await studioSearchCloudMetadata()
}
async function studioSearchCloudMetadata() {
  const query = $('#studioCloudMatchSearch').value.trim(), item = studioMetadata.matching
  if (!item || query.length < 2) return
  const revision = ++studioMetadata.revision
  studioMetadata.candidate = null
  $('#studioCloudMatchUse').disabled = true
  $('#studioCloudMatchStatus').textContent = 'Searching…'
  const response = await api('/api/my-tv/discovery?q=' + encodeURIComponent(query))
  if (revision !== studioMetadata.revision || item !== studioMetadata.matching) return
  const candidates = (response.results || []).filter(result => result.tmdb_id && ['movie', 'tv'].includes(result.media_type) && (item.kind !== 'series' || result.media_type === 'tv'))
  const root = $('#studioCloudMatchResults'); root.replaceChildren()
  $('#studioCloudMatchStatus').textContent = candidates.length ? 'Choose the correct title.' : 'No matches. Try another name or add the release year.'
  for (const candidate of candidates.slice(0, 12)) {
    const button = document.createElement('label'); button.className = 'studio-choice'
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'studioTitleMatch'
    input.onchange = () => { studioMetadata.candidate = candidate; $('#studioCloudMatchUse').disabled = false }
    button.append(input)
    const poster = myTvViewingPosterUrl(candidate)
    if (poster) button.append(myTvArtworkImage(poster))
    const copy = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small')
    name.textContent = candidate.title; detail.textContent = [candidate.year, candidate.media_type === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(' · ')
    copy.append(name, detail); button.append(copy)
    root.append(button)
  }
}
$('#studioCloudMatchUse').onclick = async () => {
  const item = studioMetadata.matching, candidate = studioMetadata.candidate, button = $('#studioCloudMatchUse')
  if (!item || !candidate || button.disabled) return
  button.disabled = true
  try {
    const result = await api('/api/studio/cloud/match', { method: 'POST', body: JSON.stringify({ id: item.id, match: candidate }) })
    studioRememberCloudMetadata(result.item); studioCloseCloudMatch()
  } catch (error) { $('#studioCloudMatchStatus').textContent = error.message; button.disabled = false }
}
function studioCloseCloudMatch() {
  studioMetadata.revision++; studioMetadata.matching = null
  closeLibrarySheet($('#studioCloudMatchSheet'), false)
  openLibrarySheet($('#studioDestinationSheet'))
}
$('#studioCloudEditMetadata').onclick = () => void studioOpenMetadataMatch(studioDraft.cloudContext.titles[0]).catch(studioFailure)
$('#studioCloudMatchForm').onsubmit = event => { event.preventDefault(); void studioSearchCloudMetadata().catch(error => { $('#studioCloudMatchStatus').textContent = error.message }) }
portalSheets.wire($('#studioCloudMatchSheet'), { closeButton: $('#studioCloudMatchClose'), close: studioCloseCloudMatch })
$('#studioChooseEpisodes').onclick = () => { const title = studioDraft.cloudContext.titles[0]; closeLibrarySheet($('#studioDestinationSheet'), false); void openStudioCloudSeries(title).catch(studioFailure) }
