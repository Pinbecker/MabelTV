'use strict'

function studioCloudTitle(item) {
  const metadata = item.metadata || {}
  return { ...metadata, title: metadata.title || item.title || item.name,
    year: metadata.year || item.year || '', media_type: metadata.media_type || item.media_type || (item.kind === 'series' ? 'tv' : 'movie'),
    key: metadata.tmdb_id ? `${metadata.media_type}:${metadata.tmdb_id}` : '' }
}
function studioCloudCard(item) {
  const title = studioCloudTitle(item)
  const row = document.createElement('article'); row.className = 'my-tv-viewing-row studio-cloud-card'; row.dataset.cloudId = item.id; row._studioItem = item
  const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'my-tv-viewing-card-open studio-file'
  opener.setAttribute('aria-label', title.title)
  opener.setAttribute('aria-pressed', String(studioState.selected.has(item.id)))
  const art = document.createElement('span'); art.className = 'my-tv-viewing-art studio-file-art'
  const poster = myTvViewingPosterUrl(title)
  if (poster) art.append(myTvArtworkImage(poster))
  else { const placeholder = document.createElement('span'); placeholder.className = 'my-tv-viewing-placeholder'; placeholder.append(librarySignalIcon(title.media_type === 'tv' ? 'signal-tv' : 'signal-film')); art.append(placeholder) }
  {
    const selected = document.createElement('span'); selected.className = 'studio-file-tick'; selected.setAttribute('aria-hidden', 'true')
    if (studioState.selected.has(item.id)) { selected.classList.add('is-selected'); selected.append(librarySignalIcon('signal-check')) }
    art.append(selected)
  }
  const copy = document.createElement('span'); copy.className = 'my-tv-viewing-copy'
  const heading = document.createElement('strong'); heading.textContent = title.title
  const subtitle = document.createElement('span'); subtitle.textContent = [title.year, studioBytes((item.versions || [item]).reduce((bytes, file) => bytes + file.bytes, 0))].filter(Boolean).join(' · ')
  copy.append(heading, subtitle); opener.append(art, copy)
  opener.onclick = () => {
    const item = row._studioItem
    if (studioState.selecting) {
      if (studioState.selected.has(item.id)) studioState.selected.delete(item.id)
      else studioState.selected.set(item.id, item)
      renderStudioCloud()
    } else void studioOpenCloudTitles([item]).catch(studioFailure)
  }
  row.append(opener)
  if (title.tmdb_id) {
    appendMyTvArtworkStatus(art, title)
    renderMyTvProviderBadges(art, title)
    {
      const actions = myTvExploreActions(title, row, 'studio')
      actions.classList.add('my-tv-viewing-quick-actions'); row.append(actions)
      syncMyTvExploreActions(row, title)
    }
  }
  return row
}
function renderStudioCloud() {
  const cloud = studioState.cloud
  if (!cloud) return
  $('#studioCloudStatus').textContent = !cloud.configured ? 'Connect iCloud in Connections.'
    : cloud.scanning ? 'Refreshing iCloud…' : cloud.error || `${cloud.total} titles · ${studioLastChecked(cloud.checked)}`
  const grid = $('#studioCloudGrid'), existing = new Map([...grid.querySelectorAll('[data-cloud-id]')].map(row => [row.dataset.cloudId, row]))
  for (const [index, item] of studioState.items.entries()) {
    const version = JSON.stringify([item.metadata, item.title, item.year, item.bytes, item.versions])
    let row = existing.get(item.id)
    if (!row || row.dataset.studioVersion !== version) {
      const replacement = studioCloudCard(item); replacement.dataset.studioVersion = version
      if (row) { retainMyTvArtwork([...row.querySelectorAll('img')], replacement); row.replaceWith(replacement) }
      row = replacement
    }
    row._studioItem = item
    row.querySelector('.studio-file').setAttribute('aria-pressed', String(studioState.selected.has(item.id)))
    let tick = row.querySelector('.studio-file-tick')
    if (!studioState.selecting) tick?.remove()
    else {
      if (!tick) { tick=document.createElement('span'); tick.className='studio-file-tick'; tick.setAttribute('aria-hidden','true'); row.querySelector('.studio-file-art').append(tick) }
      const selected = studioState.selected.has(item.id)
      if (tick.classList.contains('is-selected') !== selected) {
        tick.classList.toggle('is-selected', selected)
        tick.replaceChildren(...(selected ? [librarySignalIcon('signal-check')] : []))
      }
    }
    const actions = row.querySelector('.my-tv-viewing-quick-actions')
    if (studioState.selecting && actions) { row._studioActions=actions; actions.remove() }
    else if (!studioState.selecting && !actions && row._studioActions) row.append(row._studioActions)
    row.querySelectorAll('.my-tv-artwork-status').forEach(control => control.classList.toggle('hidden', studioState.selecting))
    if (grid.children[index] !== row) grid.insertBefore(row, grid.children[index] || null)
    existing.delete(item.id)
  }
  for (const row of existing.values()) row.remove()
  grid.querySelector('.studio-cloud-empty')?.remove()
  if (!studioState.items.length) { const empty = studioEmpty('Your iCloud library', cloud.configured ? 'No matching films or TV programmes.' : 'Connect iCloud to see your films and TV.', 'signal-folder'); empty.classList.add('studio-cloud-empty'); grid.append(empty) }
  $('#studioCloudMore').classList.toggle('hidden', studioState.items.length >= cloud.total)
  $('#studioCloudSelection').classList.toggle('hidden', !studioState.selected.size)
  $('#studioCloudSelectionCount').textContent = `${studioState.selected.size} selected`
  $('#studioCloudSelect').textContent = studioState.selecting ? 'Done' : 'Select'
}
async function studioOpenCloudTitles(titles, selectedEpisodes = null) {
  const files = [], sources = [], groups = []
  for (const title of titles) {
    const episodes = selectedEpisodes || (title.kind === 'series' ? (await api('/api/studio/cloud?series=' + encodeURIComponent(title.id))).items : [title])
    for (const file of episodes) {
      groups.push(file)
      files.push(...(file.versions || [file]))
      sources.push({ type: 'cloud', id: file.id, title: title.title || title.name, kind: 'video',
        bytes: file.bytes, modified: file.modified || '', remoteId: file.remoteId || '',
        seriesTitle: title.media_type === 'tv' || title.kind === 'series' ? title.title || title.name : '',
        series: file.series, match: title.metadata || null })
    }
  }
  const context = { titles, files, groups, selectedEpisodes: Boolean(selectedEpisodes) }
  if (selectedEpisodes && studioState.episodeDraft) {
    studioDraft = studioState.episodeDraft; studioState.episodeDraft = null
    const previousSeasons = new Set(studioDraft.sources.map(source => source.series))
    const selectedSeasons = [...new Set(sources.map(source => source.series).filter(Number.isInteger))]
    if (previousSeasons.size > 1 && selectedSeasons.length === 1) $('#studioSeason').value = selectedSeasons[0]
    studioDraft.sources = sources; studioDraft.cloudContext = context
    studioSyncDestination(); studioDestinationMetadata()
    openLibrarySheet($('#studioDestinationSheet'))
    void studioLoadVersions(studioDraft)
    return
  }
  openStudioDestination(sources, null, context)
}

function studioOpenReplaceWarning() {
  $('#studioReplaceNames').textContent = studioDraft.sources.map(source => source.title).join(', ')
  closeLibrarySheet($('#studioDestinationSheet'), false)
  openLibrarySheet($('#studioReplaceSheet'))
}
function studioCloseReplaceWarning() {
  closeLibrarySheet($('#studioReplaceSheet'), false)
  openLibrarySheet($('#studioDestinationSheet'))
}
$('#studioReplaceBoth').onclick = () => {
  $('#studioDestinationForm input[name="studioCloudCopies"][value="both"]').checked = true
  studioDraft.replaceCloudOriginal = false
  studioCloseReplaceWarning(); studioSyncDestination()
  void studioSubmitDestination({ preventDefault() {} })
}
$('#studioReplaceConfirm').onclick = () => {
  studioDraft.replaceCloudOriginal = true
  studioCloseReplaceWarning()
  void studioSubmitDestination({ preventDefault() {} })
}
portalSheets.wire($('#studioReplaceSheet'), { closeButton: $('#studioReplaceClose'), close: studioCloseReplaceWarning })
