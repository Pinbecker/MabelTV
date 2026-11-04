'use strict'

const myLibraryState = { query: '', type: 'all', sort: 'title', collection: '*' }

function myLibraryEntries() {
  const films = (library?.my_tv_library || []).map(film => ({
    id: `film:${film.library_id || film.path}`, type: 'movie', source: film,
    title: watchFilmTitle(film), added: Number(film.added_at || 0),
  }))
  const series = (library?.my_tv_series || [])
    .filter(value => Number(value.episode_count || value.episodes?.length || 0) > 0)
    .map(value => ({ id: `series:${value.id}`, type: 'tv', source: value,
      title: value.metadata?.title || value.title || 'Untitled series',
      added: Number(value.added_at || 0) }))
  return [...films, ...series].map(entry => ({ ...entry,
    key: `${entry.type}:${Number(entry.source.metadata?.tmdb_id || 0)}`,
    year: String(entry.source.metadata?.year || ''), folder: entry.source.folder || '',
  }))
}

function myLibraryCompare(left, right) {
  const byTitle = left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true })
  if (myLibraryState.sort === 'recent') return right.added - left.added || byTitle
  if (myLibraryState.sort === 'newest' || myLibraryState.sort === 'oldest') {
    const a = Number(left.year) || 0, b = Number(right.year) || 0
    if (!a || !b) return a ? -1 : b ? 1 : byTitle
    return (myLibraryState.sort === 'newest' ? b - a : a - b) || byTitle
  }
  return byTitle
}

function myLibraryVisibleEntries(entries) {
  const query = myLibraryState.query.trim().toLocaleLowerCase()
  return entries.filter(entry => {
    if (myLibraryState.type !== 'all' && entry.type !== myLibraryState.type) return false
    if (myLibraryState.collection !== '*' && entry.folder !== myLibraryState.collection) return false
    return !query || [entry.title, entry.source.display_name, entry.source.name,
      entry.year, entry.folder].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)
  }).sort(myLibraryCompare)
}

function openMyLibraryEntry(entry, returnTo = null) {
  if (Number(entry.source.metadata?.tmdb_id || 0)) {
    const title = { key: entry.key, media_type: entry.type,
      tmdb_id: Number(entry.source.metadata.tmdb_id), title: entry.title, year: entry.year,
      on_mabeltv: true, local_context: 'my-library',
      local: entry.type === 'movie' ? { kind: 'film', path: entry.source.path }
        : { kind: 'series', series: entry.source.id } }
    void openMyTvTitle(title, returnTo)
  } else if (entry.type === 'movie') openWatchFilmSheet(entry.source, 'my-library', returnTo)
  else openMyTvSeriesSheet(entry.source, returnTo)
}

function myLibraryTitleCard(entry, returnTo = null) {
  let card
  if (entry.type === 'movie') card = myTvWatchCard(entry.source)
  else {
    card = document.createElement('button')
    card.type = 'button'
    card.className = 'watch-card'
    card.setAttribute('aria-label', entry.title)
    const art = myTvSeriesArtwork(entry.source, 'watch-card-art')
    const copy = document.createElement('span')
    copy.className = 'watch-card-copy'
    const title = document.createElement('strong'), facts = document.createElement('small')
    title.textContent = entry.title
    const count = Number(entry.source.episode_count || entry.source.episodes?.length || 0)
    facts.textContent = [entry.year, `${count} episode${count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
    copy.append(title, facts)
    card.append(art, copy)
  }
  card.dataset.libraryId = entry.id
  card.onclick = () => openMyLibraryEntry(entry, returnTo)
  return card
}

function renderMyLibrary() {
  const entries = myLibraryEntries()
  const folders = library?.my_tv_folders || []
  const select = $('#myLibraryGenre')
  const collectionSignature = JSON.stringify(folders)
  if (select.dataset.collections !== collectionSignature) {
    select.dataset.collections = collectionSignature
    select.replaceChildren(new Option('All collections', '*'), new Option('Unfiled', ''),
      ...folders.map(folder => new Option(folder, folder)))
    if (myLibraryState.collection !== '*' && myLibraryState.collection && !folders.includes(myLibraryState.collection)) myLibraryState.collection = '*'
  }
  select.value = myLibraryState.collection
  const visible = myLibraryVisibleEntries(entries)
  $('#myLibraryHeading').textContent = myLibraryState.query.trim() ? 'Search results'
    : myLibraryState.collection !== '*' ? myLibraryState.collection || 'Unfiled'
      : myLibraryState.type === 'movie' ? 'Films' : myLibraryState.type === 'tv' ? 'Series' : 'All titles'
  const filmCount = visible.filter(entry => entry.type === 'movie').length
  const seriesCount = visible.length - filmCount
  $('#myLibraryCount').textContent = `${filmCount} film${filmCount === 1 ? '' : 's'} · ${seriesCount} series${visible.length !== entries.length ? ` · ${entries.length} titles total` : ''}`
  $('#myLibrarySearchClear').classList.toggle('hidden', !myLibraryState.query)
  const grid = $('#myLibraryGrid')
  const signature = JSON.stringify([myLibraryState, visible.map(entry => [entry.id, entry.title,
    entry.year, entry.source])])
  if (grid.dataset.contents !== signature) {
    grid.dataset.contents = signature
    grid.replaceChildren(...visible.map(entry => myLibraryTitleCard(entry)))
    if (!visible.length) grid.append(portalEmptyState({ className: 'watch-empty',
      title: entries.length ? 'No matching titles' : 'Your library is empty',
      message: entries.length ? 'Try another search or clear your filters.' : 'Add films or series using Studio, Add or USB.' }))
  }

}

// Retained route hook: saved collections need no external metadata requests.
async function loadMyLibraryMetadata() {}

function openMyLibrary() {
  history.pushState({ myLibrary: true }, '', '#my-tv-library')
  openView('my-tv-library')
}

$('#myTvMyLibrary').onclick = openMyLibrary
$('#myLibraryBack').onclick = () => {
  if (history.state?.myLibrary) history.back()
  else navigateDomainRoute('my_tv', 'watch', { replace: true, resetScroll: false })
}
$('#myLibrarySearch').oninput = event => {
  myLibraryState.query = event.target.value
  renderMyLibrary()
}
$('#myLibrarySearchClear').onclick = event => {
  event.preventDefault()
  myLibraryState.query = ''
  $('#myLibrarySearch').value = ''
  renderMyLibrary()
  $('#myLibrarySearch').focus()
}
for (const [selector, field] of [['#myLibraryType', 'type'], ['#myLibrarySort', 'sort'], ['#myLibraryGenre', 'collection']]) {
  $(selector).onchange = event => { myLibraryState[field] = event.target.value; renderMyLibrary() }
}
