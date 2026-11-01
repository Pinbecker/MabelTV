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
  const subtitle = document.createElement('span'); subtitle.textContent = [title.year, title.media_type === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(' · ')
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
  $('#studioCloudStatus').textContent = !cloud.configured ? 'Connect iCloud in Connections.'
    : cloud.scanning ? 'Refreshing iCloud…' : cloud.error || `${cloud.total} titles · ${studioLastChecked(cloud.checked)}`
  const grid = $('#studioCloudGrid'), existing = new Map([...grid.querySelectorAll('[data-cloud-id]')].map(row => [row.dataset.cloudId, row]))
  for (const [index, item] of studioState.items.entries()) {
    const version = JSON.stringify([item.metadata, item.title, item.year, studioState.selecting, studioState.selected.has(item.id)])
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
  if (!studioState.items.length) grid.append(portalEmptyState({ className: 'studio-cloud-empty', title: 'Your iCloud library',
    message: cloud.configured ? 'No matching films or TV programmes.' : 'Connect iCloud to see your films and TV.' }))
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
      files.push(file)
      sources.push({ type: 'cloud', id: file.id, title: title.title || title.name, kind: 'video',
        seriesTitle: title.media_type === 'tv' || title.kind === 'series' ? title.title || title.name : '',
        series: file.series, match: title.metadata || null })
    }
  }
  openStudioDestination(sources, null, { titles, files, selectedEpisodes: Boolean(selectedEpisodes) })
}
