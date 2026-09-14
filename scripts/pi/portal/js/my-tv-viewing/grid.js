'use strict'

const myTvViewingRows = new Map()
const MY_TV_VIEWING_ROW_LIMIT = 500
const MY_TV_VIEWING_BATCH_SIZE = 48
const myTvViewingPanes = new Map()
const myTvViewingPaneStates = new WeakMap()
let myTvViewingLoadObserver = null

function activeMyTvViewingPane() {
  const pane = $('#myTvViewingGrid')
  if (!pane) return null
  if (!pane.dataset.viewingPane) pane.dataset.viewingPane = myTvViewingTab
  myTvViewingPanes.set(pane.dataset.viewingPane, pane)
  return pane
}

function activateMyTvViewingPane(tab) {
  const current = activeMyTvViewingPane()
  if (!current || current.dataset.viewingPane === tab) return current
  let pane = myTvViewingPanes.get(tab)
  if (!pane) {
    pane = document.createElement('div')
    pane.className = 'my-tv-viewing-grid is-grid'
    pane.dataset.viewingPane = tab
    myTvViewingPanes.set(tab, pane)
  }
  current.removeAttribute('id')
  pane.id = 'myTvViewingGrid'
  current.replaceWith(pane)
  return pane
}

function myTvViewingItems() {
  const items = myTvViewingData.items || []
  const query = myTvViewingSearch.trim().toLocaleLowerCase()
  const values = items.filter(item => {
    const status = myTvTitleViewingStatus(item, {
      media_type: item.media_type, local: item.local_progress || item.local,
    })
    if (myTvViewingTab === 'up-next' && !item.up_next) return false
    if (myTvViewingTab === 'watchlist' && !item.watchlisted) return false
    if (myTvViewingTab === 'watching') {
      if (item.media_type === 'tv' && item.series_watching !== true) return false
      if (item.media_type === 'movie' && Number(item.local_progress?.position || 0) <= 0) return false
    }
    if (myTvViewingTab === 'part-watched' && !status.partWatched) return false
    if (myTvViewingTab === 'history' && !status.completed) return false
    if (myTvViewingFilter === 'movie' || myTvViewingFilter === 'tv') {
      if (item.media_type !== myTvViewingFilter) return false
    } else if (myTvViewingFilter === 'local' && !item.on_mabeltv) return false
    if (!query) return true
    return [item.title, item.year].some(value =>
      String(value || '').toLocaleLowerCase().includes(query))
  })
  const titleCompare = (a, b) => String(a.title || '').localeCompare(
    String(b.title || ''), undefined, { sensitivity: 'base' })
  const year = item => Number.parseInt(item.year, 10) || 0
  const recent = item => Number(myTvViewingTab === 'watchlist'
    ? item.watchlist_updated || item.viewing_updated || item.updated || 0
    : myTvViewingTab === 'watching'
      ? item.series_watching_updated || item.viewing_updated || item.updated || 0
      : item.viewing_updated || item.updated || 0)
  return values.sort((a, b) => {
    if (myTvViewingSort === 'az') return titleCompare(a, b)
    if (myTvViewingSort === 'za') return titleCompare(b, a)
    if (myTvViewingSort === 'newest') return year(b) - year(a) || titleCompare(a, b)
    if (myTvViewingSort === 'oldest') return year(a) - year(b) || titleCompare(a, b)
    if (myTvViewingTab === 'up-next') {
      return Number(a.up_next_rank || 999999) - Number(b.up_next_rank || 999999)
    }
    return recent(b) - recent(a)
  })
}

function cacheMyTvViewingRow(key, row) {
  myTvViewingRows.delete(key)
  myTvViewingRows.set(key, row)
  while (myTvViewingRows.size > MY_TV_VIEWING_ROW_LIMIT) {
    const disposable = [...myTvViewingRows].find(([, value]) => !value.isConnected)
    if (!disposable) break
    myTvViewingRows.delete(disposable[0])
  }
}

function createMyTvViewingRow(item, index, total) {
  const row = document.createElement('article')
  row.className = 'my-tv-viewing-row'
  row.dataset.viewingKey = `${item.media_type}:${item.tmdb_id}`
  const posterUrl = myTvViewingPosterUrl(item)
  const art = posterUrl ? document.createElement('img') : document.createElement('span')
  if (posterUrl) {
    art.loading = 'lazy'; art.decoding = 'async'; art.src = posterUrl; art.alt = ''
  } else {
    art.className = 'my-tv-viewing-placeholder'
    art.append(librarySignalIcon(item.media_type === 'tv' ? 'signal-tv' : 'signal-film'))
  }
  const copy = document.createElement('span'); copy.className = 'my-tv-viewing-copy'
  const title = document.createElement('strong'); title.textContent = item.title || 'Untitled'
  const meta = document.createElement('span'); meta.textContent = [item.year,
    item.media_type === 'tv' ? 'TV series' : 'Film'].filter(Boolean).join(' · ')
  copy.append(title, meta)
  const actions = document.createElement('span'); actions.className = 'my-tv-viewing-row-actions'
  if (myTvViewingTab === 'up-next') {
    ;[['move_up', 'signal-chevron-up', 'Move earlier'],
      ['move_down', 'signal-chevron-down', 'Move later']].forEach(([action, icon, label]) => {
      const move = document.createElement('button'); move.type = 'button'
      move.dataset.viewingMove = action
      move.setAttribute('aria-label', `${label}: ${item.title}`)
      move.append(librarySignalIcon(icon))
      move.disabled = action === 'move_up' ? index === 0 : index === total - 1
      move.onclick = async event => {
        event.stopPropagation(); await updateMyTvViewing(item, action)
      }
      actions.append(move)
    })
  } else {
    const open = document.createElement('button'); open.type = 'button'
    open.className = 'my-tv-viewing-row-open'
    open.setAttribute('aria-label', `Open ${item.title}`)
    open.append(librarySignalIcon('signal-chevron-right'))
    open.onclick = () => openMyTvTitle(item); actions.append(open)
  }
  const artWrap = document.createElement('span'); artWrap.className = 'my-tv-viewing-art'
  artWrap.append(art)
  appendMyTvArtworkStatus(artWrap, item, {
    media_type: item.media_type, local: item.local_progress || item.local,
  })
  renderMyTvProviderBadges(artWrap, item)
  const opener = document.createElement('button'); opener.type = 'button'
  opener.className = 'my-tv-viewing-card-open'
  opener.setAttribute('aria-label', `Open ${item.title}`)
  opener.append(artWrap, copy); opener.onclick = () => openMyTvTitle(item)
  const quickActions = myTvExploreActions(item, row, 'my-tv-viewing', () => {
    if (!row.isConnected) return
    const key = row.dataset.viewingKey
    if (!myTvViewingItems().some(value =>
      `${value.media_type}:${value.tmdb_id}` === key)) renderMyTvViewing({ anchor: false })
  })
  quickActions.classList.add('my-tv-viewing-quick-actions')
  row.append(opener, quickActions, actions)
  return row
}

function myTvViewingRow(item, index, total) {
  const mode = myTvViewingTab === 'up-next' ? 'up-next' : 'standard'
  const cacheKey = `${myTvViewingTab}:${mode}:${item.media_type}:${item.tmdb_id}`
  let row = myTvViewingRows.get(cacheKey)
  if (!row) row = createMyTvViewingRow(item, index, total)
  cacheMyTvViewingRow(cacheKey, row)
  syncMyTvExploreActions(row, item)
  refreshMyTvViewingRowArtwork(row, item)
  appendMyTvArtworkStatus(row.querySelector('.my-tv-viewing-art'), item, {
    media_type: item.media_type, local: item.local_progress || item.local,
  })
  renderMyTvProviderBadges(row.querySelector('.my-tv-viewing-art'), item)
  row.querySelector('[data-viewing-move="move_up"]')?.toggleAttribute('disabled', index === 0)
  row.querySelector('[data-viewing-move="move_down"]')
    ?.toggleAttribute('disabled', index === total - 1)
  return row
}

function refreshMyTvViewingRowArtwork(row, item) {
  const art = row.querySelector('.my-tv-viewing-art > :first-child')
  if (!art) return
  const source = myTvViewingPosterUrl(item)
  const current = art.matches('img') ? art : art.querySelector(':scope > img')
  if (!source || (current?.dataset.myTvArtworkSource || current?.getAttribute('src')) === source) return
  const image = myTvArtworkImage(source)
  if (current) current.replaceWith(image)
  else art.prepend(image)
}

function reconcileMyTvViewingRows(target, rows) {
  let cursor = target.firstChild
  rows.forEach(row => {
    if (row === cursor) cursor = cursor.nextSibling
    else target.insertBefore(row, cursor)
  })
  while (cursor) {
    const next = cursor.nextSibling
    cursor.remove(); cursor = next
  }
}

function renderMyTvViewing({ anchor = true, loadMore = false } = {}) {
  return preservePortalPosition(() => renderMyTvViewingList({ loadMore }), { anchor })
}

function observeMyTvViewingMore(button) {
  myTvViewingLoadObserver?.disconnect()
  if (!button || typeof IntersectionObserver === 'undefined') return
  if (!myTvViewingLoadObserver) {
    myTvViewingLoadObserver = new IntersectionObserver(entries => {
      const entry = entries.find(value => value.isIntersecting)
      if (!entry || entry.target.disabled || !entry.target.closest('#myTvViewingGrid')) return
      entry.target.click()
    }, { rootMargin: '500px 0px' })
  }
  myTvViewingLoadObserver.observe(button)
}

function myTvViewingMoreButton(state, shown, total) {
  const button = state.more || document.createElement('button')
  state.more = button
  button.type = 'button'
  button.className = 'my-tv-viewing-load-more'
  button.disabled = false
  button.textContent = `Show more titles · ${shown} of ${total}`
  button.onclick = () => {
    button.disabled = true
    renderMyTvViewing({ anchor: false, loadMore: true })
  }
  return button
}

function renderMyTvViewingList({ loadMore = false } = {}) {
  const labels = {
    'up-next': ['Your chosen order', 'Up Next'],
    watchlist: ['Unseen and saved for later', 'Watchlist'],
    watching: ['In progress', 'Watching'],
    'part-watched': ['Some episodes seen', 'Part Watched'],
    history: ['Everything you have seen', 'Watched'],
  }
  const [kicker, heading] = labels[myTvViewingTab]
  const reorderable = myTvViewingTab === 'up-next' && myTvViewingSort === 'recent'
    && myTvViewingFilter === 'all' && !myTvViewingSearch.trim()
  $('#myTvViewingKicker').textContent = reorderable ? 'Hold and drag to reorder' : kicker
  $('#myTvViewingHeading').textContent = heading
  const recentOption = $('#myTvViewingSort')?.querySelector('option[value="recent"]')
  if (recentOption) {
    recentOption.textContent = myTvViewingTab === 'up-next' ? 'Queue order' : 'Recently added'
  }
  const values = myTvViewingItems()
  $('#myTvViewingCount').textContent = `${values.length} title${values.length === 1 ? '' : 's'}`
  const target = activateMyTvViewingPane(myTvViewingTab)
  const signature = [myTvViewingDataRevision, myTvViewingFilter,
    myTvViewingSort, myTvViewingSearch].join('|')
  let state = myTvViewingPaneStates.get(target)
  if (!state) {
    state = { signature: '', limit: 0, rendered: false, more: null }
    myTvViewingPaneStates.set(target, state)
  }
  if (state.signature !== signature) {
    state.signature = signature
    state.limit = myTvViewingTab === 'up-next'
      ? values.length : Math.min(values.length, MY_TV_VIEWING_BATCH_SIZE)
    state.rendered = false
  } else if (loadMore) {
    state.limit = Math.min(values.length, state.limit + MY_TV_VIEWING_BATCH_SIZE)
    state.rendered = false
  }
  if (state.rendered) {
    observeMyTvViewingMore(state.more?.isConnected ? state.more : null)
    return
  }
  const visible = values.slice(0, state.limit)
  let rows = visible.map((item, index) => myTvViewingRow(item, index, values.length))
  if (!rows.length) {
    const empty = document.createElement('div'); empty.className = 'watch-empty'
    empty.append(Object.assign(document.createElement('strong'), {
      textContent: `Nothing in ${heading} yet`,
    }), document.createElement('br'), 'Add titles from search and they will appear here.')
    rows = [empty]
  }
  const more = state.limit < values.length
    ? myTvViewingMoreButton(state, visible.length, values.length) : null
  if (more) rows.push(more)
  reconcileMyTvViewingRows(target, rows)
  state.rendered = true
  observeMyTvViewingMore(more)
  if (reorderable) bindUpNextReorder(target)
}

async function persistMyTvViewingCache() {
  try { applyPortalBootstrap(await api('/api/bootstrap')) } catch (_) { /* Best effort. */ }
  await writePortalDataCache('my-tv-viewing-v1', myTvViewingData, 'my_tv_viewing')
}

function mergeMyTvViewingData(next) {
  const previous = new Map((myTvViewingData.items || []).map(item => [item.key, item]))
  const items = (next.items || []).map(item => {
    const current = previous.get(item.key)
    if (!current) return item
    Object.keys(current).forEach(key => { if (!(key in item)) delete current[key] })
    Object.assign(current, item)
    return current
  })
  myTvViewingDataRevision += 1
  return { ...myTvViewingData, ...next, items }
}

async function loadMyTvViewing({ render = true, data = null, refresh = false,
                                  expectedMutationRevision = null } = {}) {
  const alreadyLoaded = myTvViewingLoaded
  if (render && alreadyLoaded && !data) {
    renderMyTvViewing(); renderMyTvSeries(watchSearchText)
  }
  let next = data
  let expected = expectedMutationRevision
  let fetched = false
  if (!next && (!myTvViewingLoaded || refresh)) {
    expected = myTvViewingMutationRevision
    next = await api('/api/my-tv/viewing')
    fetched = true
  }
  if (!next || (expected !== null && expected !== myTvViewingMutationRevision)) return false
  myTvViewingData = mergeMyTvViewingData(next)
  myTvViewingLoaded = true
  refreshMyTvArtworkStatuses()
  if (render && (!alreadyLoaded || data || refresh)) {
    renderMyTvViewing(); renderMyTvSeries(watchSearchText)
  }
  if (fetched) void persistMyTvViewingCache()
  return true
}

$$('[data-viewing-tab]').forEach(button => button.onclick = () => {
  myTvViewingTab = button.dataset.viewingTab
  $$('[data-viewing-tab]').forEach(value => value.classList.toggle('active', value === button))
  activateMyTvViewingPane(myTvViewingTab)
  renderMyTvViewing({ anchor: false })
})
$('#myTvViewingFilter')?.addEventListener('change', event => {
  myTvViewingFilter = event.currentTarget.value; renderMyTvViewing()
})
$('#myTvViewingSort')?.addEventListener('change', event => {
  myTvViewingSort = event.currentTarget.value; renderMyTvViewing()
})
$('#myTvViewingSearch')?.addEventListener('input', event => {
  myTvViewingSearch = event.currentTarget.value
  $('#myTvViewingSearchClear')?.classList.toggle('hidden', !myTvViewingSearch)
  renderMyTvViewing()
})
$('#myTvViewingSearchClear')?.addEventListener('click', () => {
  const search = $('#myTvViewingSearch')
  search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); search.focus()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash === '#my-tv-viewing') {
    loadMyTvViewing({ refresh: true }).catch(() => {})
  }
})
