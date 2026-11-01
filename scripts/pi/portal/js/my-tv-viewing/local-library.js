'use strict'

const myLibraryState = { query: '', type: 'all', sort: 'title', genre: '', mode: 'titles' }
const myLibraryMetadata = new Map()
const myLibraryMetadataAttempted = new Set()
let myLibraryMetadataLoading = false
let myLibraryMetadataErrors = false
let myLibrarySelectedCollection = null

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
  return [...films, ...series].map(entry => {
    const local = entry.source.metadata || {}
    const key = `${entry.type}:${Number(local.tmdb_id || 0)}`
    const extra = myLibraryMetadata.get(key) || {}
    const genres = extra.genres || local.genres || []
    return { ...entry, key, year: String(local.year || extra.year || ''),
      genres: genres.map(value => typeof value === 'string' ? value : value.name).filter(Boolean),
      collection: entry.type === 'movie' ? extra.collection || local.collection || null : null }
  })
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
    if (myLibraryState.genre && !entry.genres.includes(myLibraryState.genre)) return false
    return !query || [entry.title, entry.source.display_name, entry.source.name,
      entry.year, entry.collection?.name].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)
  }).sort(myLibraryCompare)
}

function myLibraryDisplayEntries(entries) {
  if (myLibraryState.mode !== 'collections') return entries
  const groups = new Map()
  for (const entry of entries) {
    const id = Number(entry.collection?.tmdb_id || entry.collection?.id || 0)
    if (!id) continue
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(entry)
  }
  const grouped = new Set(), stacks = []
  for (const [id, members] of groups) {
    // Different encodes of one film do not form a film collection.
    if (new Set(members.map(entry => entry.key)).size < 2) continue
    members.forEach(entry => grouped.add(entry.id))
    stacks.push({ id: `collection:${id}`, type: 'collection', members,
      title: members[0].collection.name || 'Film collection',
      added: Math.max(...members.map(entry => entry.added)),
      year: members.map(entry => entry.year).filter(Boolean).sort()[0] || '' })
  }
  return [...entries.filter(entry => !grouped.has(entry.id)), ...stacks].sort(myLibraryCompare)
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

function myLibraryCollectionCard(entry) {
  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'watch-card my-library-stack'
  card.dataset.libraryId = entry.id
  card.setAttribute('aria-label', `${entry.title}, ${entry.members.length} films in My Library`)
  const art = document.createElement('span')
  art.className = 'my-library-stack-art'
  const members = [...entry.members].sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999))
  members.slice(0, 3).reverse().forEach(member => {
    const poster = document.createElement('span')
    poster.className = 'my-library-stack-poster'
    poster.append(filmPoster(member.source))
    art.append(poster)
  })
  const copy = document.createElement('span')
  copy.className = 'watch-card-copy'
  const title = document.createElement('strong'), count = document.createElement('small')
  title.textContent = entry.title.replace(/ Collection$/i, '')
  count.textContent = `${entry.members.length} films on your Pi`
  copy.append(title, count)
  card.append(art, copy)
  card.onclick = () => openMyLibraryCollection(entry)
  return card
}

function openMyLibraryCollection(entry) {
  // Reconcile membership on every opening; a removed file cannot linger in a stack.
  const ids = new Set(entry.members.map(member => member.id))
  const members = myLibraryEntries().filter(member => ids.has(member.id))
    .sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999)
      || a.title.localeCompare(b.title))
  if (!members.length) { portalSheets.dismissJourney(); return }
  myLibrarySelectedCollection = { ...entry, members }
  $('#myLibraryCollectionName').textContent = entry.title.replace(/ Collection$/i, '')
  $('#myLibraryCollectionCount').textContent = `${members.length} film${members.length === 1 ? '' : 's'} in My Library`
  const sheet = $('#myLibraryCollectionSheet')
  $('#myLibraryCollectionGrid').replaceChildren(...members.map(member => {
    const card = myLibraryTitleCard(member)
    card.onclick = () => {
      portalSheets.suspend(sheet)
      openMyLibraryEntry(member, () => openMyLibraryCollection(entry))
    }
    return card
  }))
  portalSheets.open(sheet, { focus: $('#myLibraryCollectionClose') })
}

function renderMyLibrary() {
  const entries = myLibraryEntries()
  const genres = [...new Set(entries.flatMap(entry => entry.genres))].sort()
  const genreSelect = $('#myLibraryGenre')
  const genreSignature = JSON.stringify(genres)
  if (genreSelect.dataset.genres !== genreSignature) {
    genreSelect.dataset.genres = genreSignature
    genreSelect.replaceChildren(new Option('All genres', ''), ...genres.map(genre => new Option(genre, genre)))
    if (!genres.includes(myLibraryState.genre)) myLibraryState.genre = ''
  }
  genreSelect.value = myLibraryState.genre
  const visible = myLibraryVisibleEntries(entries), display = myLibraryDisplayEntries(visible)
  $('#myLibraryHeading').textContent = myLibraryState.query.trim() ? 'Search results'
    : myLibraryState.mode === 'collections' ? 'Collections'
      : myLibraryState.type === 'movie' ? 'Films' : myLibraryState.type === 'tv' ? 'Series' : 'All titles'
  const filmCount = visible.filter(entry => entry.type === 'movie').length
  const seriesCount = visible.length - filmCount
  $('#myLibraryCount').textContent = `${filmCount} film${filmCount === 1 ? '' : 's'} · ${seriesCount} series${visible.length !== entries.length ? ` · ${entries.length} titles total` : ''}`
  $('#myLibrarySearchClear').classList.toggle('hidden', !myLibraryState.query)
  $$('[data-library-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.libraryMode === myLibraryState.mode)))
  const grid = $('#myLibraryGrid')
  const signature = JSON.stringify([myLibraryState, display.map(entry => [entry.id, entry.title,
    entry.year, entry.source, entry.members?.map(member => [member.id, member.source.metadata])])])
  if (grid.dataset.contents !== signature) {
    grid.dataset.contents = signature
    grid.replaceChildren(...display.map(entry => entry.type === 'collection'
      ? myLibraryCollectionCard(entry) : myLibraryTitleCard(entry)))
    if (!display.length) grid.append(portalEmptyState({ className: 'watch-empty',
      title: entries.length ? 'No matching titles' : 'Your library is empty',
      message: entries.length ? 'Try another search or clear your filters.' : 'Add films or series using Studio, Add or USB.' }))
  }
  const status = $('#myLibraryMetadataStatus')
  status.classList.toggle('hidden', !myLibraryMetadataLoading && !myLibraryMetadataErrors)
  status.textContent = myLibraryMetadataLoading ? 'Finding genres and film collections…'
    : myLibraryMetadataErrors ? 'Some collection details are unavailable. Your local titles are all shown.' : ''
  $('#myLibraryMetadataRetry').classList.toggle('hidden', !myLibraryMetadataErrors || myLibraryMetadataLoading)
  if ($('#myLibraryCollectionSheet').open && myLibrarySelectedCollection) {
    openMyLibraryCollection(myLibrarySelectedCollection)
  }
}

async function loadMyLibraryMetadata({ retry = false } = {}) {
  if (myLibraryMetadataLoading || offlineMode || !library) return
  if (retry) myLibraryMetadataAttempted.clear()
  const unique = new Map(myLibraryEntries().filter(entry => Number(entry.source.metadata?.tmdb_id))
    .map(entry => [entry.key, entry]))
  const queue = [...unique.values()].filter(entry => !myLibraryMetadataAttempted.has(entry.key))
  if (!queue.length) return
  myLibraryMetadataLoading = true
  myLibraryMetadataErrors = false
  renderMyLibrary()
  async function worker() {
    while (queue.length && $('#view-my-tv-library').classList.contains('active') && !offlineMode) {
      const entry = queue.shift(), cacheKey = `my-library-metadata-v1:${entry.key}`
      myLibraryMetadataAttempted.add(entry.key)
      try {
        const cached = await readPortalDataCache(cacheKey)
        if (cached) myLibraryMetadata.set(entry.key, cached.data)
        if (cached && Date.now() - cached.saved_at < 86400000) continue
        const value = await api(`/api/my-tv/library/metadata?media_type=${entry.type}&tmdb_id=${Number(entry.source.metadata.tmdb_id)}`)
        myLibraryMetadata.set(entry.key, value)
        await writePortalDataCache(cacheKey, value)
      } catch (_) { myLibraryMetadataErrors = true }
    }
  }
  try { await Promise.all([worker(), worker()]) }
  finally {
    myLibraryMetadataLoading = false
    if ($('#view-my-tv-library').classList.contains('active') && !offlineMode) {
      preservePortalPosition(renderMyLibrary, { anchor: false })
    }
  }
}

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
for (const [selector, field] of [['#myLibraryType', 'type'], ['#myLibrarySort', 'sort'], ['#myLibraryGenre', 'genre']]) {
  $(selector).onchange = event => { myLibraryState[field] = event.target.value; renderMyLibrary() }
}
$$('[data-library-mode]').forEach(button => {
  button.onclick = () => { myLibraryState.mode = button.dataset.libraryMode; renderMyLibrary() }
})
$('#watchManageMyTv').onclick = () => {
  renderMyTvLibraryControls()
  openLibrarySheet($('#myTvCollectionSheet'))
}
$('#myLibraryMetadataRetry').onclick = () => { void loadMyLibraryMetadata({ retry: true }) }
portalSheets.wire($('#myLibraryCollectionSheet'), {
  closeButton: $('#myLibraryCollectionClose'),
  close: () => { myLibrarySelectedCollection = null; portalSheets.dismissJourney() },
})
