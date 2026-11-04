'use strict'

function studioCloudTitle(item) {
  const metadata = item.metadata || {}
  return { ...metadata, title: metadata.title || item.title || item.name,
    year: metadata.year || item.year || '', media_type: metadata.media_type || item.media_type || (item.kind === 'series' ? 'tv' : 'movie'),
    key: metadata.tmdb_id ? `${metadata.media_type}:${metadata.tmdb_id}` : '' }
}
function studioCloudCard(item) {
  const title = studioCloudTitle(item)
  const row = document.createElement('article'); row.className = 'my-tv-viewing-row studio-cloud-card'; row.dataset.cloudId = item.id
  const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'my-tv-viewing-card-open studio-file'
  opener.setAttribute('aria-label', title.title)
  opener.setAttribute('aria-pressed', String(studioState.selected.has(item.id)))
  const art = document.createElement('span'); art.className = 'my-tv-viewing-art studio-file-art'
  const poster = myTvViewingPosterUrl(title)
  if (poster) art.append(myTvArtworkImage(poster))
  else { const placeholder = document.createElement('span'); placeholder.className = 'my-tv-viewing-placeholder'; placeholder.append(librarySignalIcon(title.media_type === 'tv' ? 'signal-tv' : 'signal-film')); art.append(placeholder) }
  if (studioState.selecting) {
    const selected = document.createElement('span'); selected.className = 'studio-file-tick'; selected.setAttribute('aria-hidden', 'true')
    if (studioState.selected.has(item.id)) { selected.classList.add('is-selected'); selected.append(librarySignalIcon('signal-check')) }
    art.append(selected)
  }
  const copy = document.createElement('span'); copy.className = 'my-tv-viewing-copy'
  const heading = document.createElement('strong'); heading.textContent = title.title
  const subtitle = document.createElement('span'); subtitle.textContent = [title.year, studioBytes((item.versions || [item]).reduce((bytes, file) => bytes + file.bytes, 0))].filter(Boolean).join(' · ')
  copy.append(heading, subtitle); opener.append(art, copy)
  opener.onclick = () => {
    if (studioState.selecting) {
      if (studioState.selected.has(item.id)) studioState.selected.delete(item.id)
      else studioState.selected.set(item.id, item)
      renderStudioCloud()
    } else void studioOpenCloudTitles([item]).catch(studioFailure)
  }
  row.append(opener)
  if (title.tmdb_id) {
    if (!studioState.selecting) appendMyTvArtworkStatus(art, title)
    renderMyTvProviderBadges(art, title)
    if (!studioState.selecting) {
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
  const collectionSelect = $('#studioCloudCollection'), collection = collectionSelect.value
  collectionSelect.replaceChildren(new Option('All collections', '*'), new Option('Unfiled', ''),
    ...(cloud.collections || []).map(name => new Option(name, name)))
  collectionSelect.value = collection === '*' || !collection || (cloud.collections || []).includes(collection) ? collection : '*'
  $('#studioCloudStatus').textContent = !cloud.configured ? 'Connect iCloud in Connections.'
    : cloud.scanning ? 'Refreshing iCloud…' : cloud.error || `${cloud.total} titles · ${studioLastChecked(cloud.checked)}`
  const grid = $('#studioCloudGrid'), existing = new Map([...grid.querySelectorAll('[data-cloud-id]')].map(row => [row.dataset.cloudId, row]))
  for (const [index, item] of studioState.items.entries()) {
    const version = JSON.stringify([item.metadata, item.title, item.year, item.bytes, item.versions, studioState.selecting, studioState.selected.has(item.id)])
    let row = existing.get(item.id)
    if (!row || row.dataset.studioVersion !== version) {
      const replacement = studioCloudCard(item); replacement.dataset.studioVersion = version
      if (row) row.replaceWith(replacement)
      row = replacement
    }
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
  const files = [], sources = []
  for (const title of titles) {
    const episodes = selectedEpisodes || (title.kind === 'series' ? (await api('/api/studio/cloud?series=' + encodeURIComponent(title.id))).items : [title])
    for (const file of episodes) {
      files.push(...(file.versions || [file]))
      sources.push({ type: 'cloud', id: file.id, title: title.title || title.name, kind: 'video',
        bytes: file.bytes, modified: file.modified || '', remoteId: file.remoteId || '',
        seriesTitle: title.media_type === 'tv' || title.kind === 'series' ? title.title || title.name : '',
        series: file.series, match: title.metadata || null })
    }
  }
  openStudioDestination(sources, null, { titles, files, selectedEpisodes: Boolean(selectedEpisodes) })
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

function studioCloseCollection() {
  closeLibrarySheet($('#studioCloudCollectionSheet'), false)
  openLibrarySheet($('#studioDestinationSheet'))
}
$('#studioCloudMoveCollection').onclick = () => {
  const titles = studioDraft?.cloudContext?.titles
  if (!titles?.length) return
  const select = $('#studioCloudMoveSelect')
  select.replaceChildren(new Option('Unfiled', ''),
    ...(studioState.cloud?.collections || []).map(name => new Option(name, name)),
    new Option('New collection…', '__new__'))
  select.value = titles.length === 1 ? titles[0].collection || '' : ''
  $('#studioCloudCollectionName').value = ''
  $('#studioCloudNewCollection').classList.add('hidden')
  $('#studioCloudCollectionError').textContent = ''
  studioCollectionChoices()
  $('#studioCloudCollectionSave').textContent = 'Move'
  closeLibrarySheet($('#studioDestinationSheet'), false)
  closeLibrarySheet($('#studioActionsSheet'), false)
  openLibrarySheet($('#studioCloudCollectionSheet'))
}
function studioCollectionChoices() {
  const select = $('#studioCloudMoveSelect'), root = $('#studioCloudCollectionOptions'); root.replaceChildren()
  for (const option of select.options) {
    const label = document.createElement('label'); label.className = 'studio-choice'
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'studioMoveCollection'; radio.checked = option.selected
    const text = document.createElement('span'); text.textContent = option.textContent
    radio.onchange = () => { select.value = option.value; select.dispatchEvent(new Event('change')) }
    label.append(radio, text); root.append(label)
  }
}
$('#studioCloudCollectionCancel').onclick = studioCloseCollection
$('#studioCloudMoveSelect').onchange = event => {
  const creating = event.target.value === '__new__'
  $('#studioCloudNewCollection').classList.toggle('hidden', !creating)
  $('#studioCloudCollectionSave').textContent = creating ? 'Create & move' : 'Move'
  studioCollectionChoices()
  if (creating) $('#studioCloudCollectionName').focus()
}
$('#studioCloudCollectionForm').onsubmit = async event => {
  event.preventDefault()
  const button = $('#studioCloudCollectionSave'); button.disabled = true
  const create = $('#studioCloudMoveSelect').value === '__new__'
  const collection = create ? $('#studioCloudCollectionName').value.trim() : $('#studioCloudMoveSelect').value
  try {
    if (create && !collection) throw new Error('Enter a collection name')
    await api('/api/studio/cloud/collection', { method: 'POST', body: JSON.stringify({
      ids: studioDraft.cloudContext.titles.map(title => title.id), collection, create }) })
    await studioLoadCloud()
    for (const title of studioDraft.cloudContext.titles) title.collection = collection
    studioCloseCollection()
  } catch (error) { $('#studioCloudCollectionError').textContent = error.message }
  finally { button.disabled = false }
}
portalSheets.wire($('#studioCloudCollectionSheet'), { closeButton: $('#studioCloudCollectionClose'), close: studioCloseCollection })
