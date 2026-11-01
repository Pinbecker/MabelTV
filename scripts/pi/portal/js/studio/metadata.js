'use strict'

const studioMetadata = { queue: [], attempted: new Set(), active: 0, matching: null, revision: 0 }
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
  const context = studioDraft?.cloudContext
  $('#studioCloudTitleMetadata').classList.toggle('hidden', !context)
  $('#studioDestinationDelete').classList.toggle('hidden', !context)
  $('#studioChooseEpisodes').classList.toggle('hidden', !context || context.selectedEpisodes || context.titles.length !== 1 || context.titles[0].kind !== 'series')
  if (!context) return
  const title = studioCloudTitle(context.titles[0])
  const root = $('#studioCloudTitleSummary'); root.replaceChildren()
  if (context.titles.length === 1) {
    const poster = myTvViewingPosterUrl(title)
    if (poster) root.append(myTvArtworkImage(poster))
    const copy = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small')
    name.textContent = title.title
    detail.textContent = [title.year, title.media_type === 'tv' ? 'Series' : 'Film', context.files.length > 1 ? `${context.files.length} ${title.media_type === 'tv' ? 'files' : 'versions'}` : ''].filter(Boolean).join(' · ')
    copy.append(name, detail); root.append(copy)
    $('#studioCloudEditMetadata span').textContent = title.tmdb_id ? 'Change metadata' : 'Match title'
    $('#studioCloudEditMetadata').disabled = false
  } else {
    root.textContent = `${context.titles.length} titles selected`
    $('#studioCloudEditMetadata').disabled = true
  }
}
async function studioOpenMetadataMatch(item) {
  studioMetadata.matching = item
  $('#studioCloudMatchSearch').value = item.title || item.name.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ')
  closeLibrarySheet($('#studioDestinationSheet'), false)
  openLibrarySheet($('#studioCloudMatchSheet'))
  await studioSearchCloudMetadata()
}
async function studioSearchCloudMetadata() {
  const query = $('#studioCloudMatchSearch').value.trim(), item = studioMetadata.matching
  if (!item || query.length < 2) return
  const revision = ++studioMetadata.revision
  $('#studioCloudMatchStatus').textContent = 'Searching title details…'
  const response = await api('/api/my-tv/discovery?q=' + encodeURIComponent(query))
  if (revision !== studioMetadata.revision || item !== studioMetadata.matching) return
  const candidates = (response.results || []).filter(result => result.tmdb_id && ['movie', 'tv'].includes(result.media_type) && (item.kind !== 'series' || result.media_type === 'tv'))
  const root = $('#studioCloudMatchResults'); root.replaceChildren()
  $('#studioCloudMatchStatus').textContent = candidates.length ? 'Choose the correct title.' : 'No matches. Try another name or add the release year.'
  for (const candidate of candidates.slice(0, 12)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'studio-match-result'
    const poster = myTvViewingPosterUrl(candidate)
    if (poster) button.append(myTvArtworkImage(poster))
    const copy = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small')
    name.textContent = candidate.title; detail.textContent = [candidate.year, candidate.media_type === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(' · ')
    copy.append(name, detail); button.append(copy)
    button.onclick = async () => {
      button.disabled = true
      try {
        const result = await api('/api/studio/cloud/match', { method: 'POST', body: JSON.stringify({ id: item.id, match: candidate }) })
        studioRememberCloudMetadata(result.item)
        studioCloseCloudMatch()
      } catch (error) { $('#studioCloudMatchStatus').textContent = error.message; button.disabled = false }
    }
    root.append(button)
  }
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
