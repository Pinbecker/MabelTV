'use strict'

const adultViewingRows = new Map()
const ADULT_VIEWING_ROW_LIMIT = 500
const ADULT_VIEWING_BATCH_SIZE = 48
const adultViewingPanes = new Map()
const adultViewingPaneStates = new WeakMap()
let adultViewingLoadObserver = null

function activeAdultViewingPane() {
  const pane = $('#adultViewingGrid')
  if (!pane) return null
  if (!pane.dataset.viewingPane) pane.dataset.viewingPane = adultViewingTab
  adultViewingPanes.set(pane.dataset.viewingPane, pane)
  return pane
}

function activateAdultViewingPane(tab) {
  const current = activeAdultViewingPane()
  if (!current || current.dataset.viewingPane === tab) return current
  let pane = adultViewingPanes.get(tab)
  if (!pane) {
    pane = document.createElement('div')
    pane.className = 'adult-viewing-grid is-grid'
    pane.dataset.viewingPane = tab
    adultViewingPanes.set(tab, pane)
  }
  current.removeAttribute('id')
  pane.id = 'adultViewingGrid'
  current.replaceWith(pane)
  return pane
}

function adultViewingItems() {
  const items = adultViewingData.items || []
  const query = adultViewingSearch.trim().toLocaleLowerCase()
  const values = items.filter(item => {
    const status = adultTitleViewingStatus(item, {
      media_type: item.media_type, local: item.local_progress || item.local,
    })
    if (adultViewingTab === 'up-next' && !item.up_next) return false
    if (adultViewingTab === 'watchlist' && !item.watchlisted) return false
    if (adultViewingTab === 'watching') {
      if (item.media_type === 'tv' && item.series_watching !== true) return false
      if (item.media_type === 'movie' && Number(item.local_progress?.position || 0) <= 0) return false
    }
    if (adultViewingTab === 'part-watched' && !status.partWatched) return false
    if (adultViewingTab === 'history' && !status.completed) return false
    if (adultViewingFilter === 'movie' || adultViewingFilter === 'tv') {
      if (item.media_type !== adultViewingFilter) return false
    } else if (adultViewingFilter === 'local' && !item.on_mabeltv) return false
    if (!query) return true
    return [item.title, item.year].some(value =>
      String(value || '').toLocaleLowerCase().includes(query))
  })
  const titleCompare = (a, b) => String(a.title || '').localeCompare(
    String(b.title || ''), undefined, { sensitivity: 'base' })
  const year = item => Number.parseInt(item.year, 10) || 0
  const recent = item => Number(adultViewingTab === 'watchlist'
    ? item.watchlist_updated || item.viewing_updated || item.updated || 0
    : adultViewingTab === 'watching'
      ? item.series_watching_updated || item.viewing_updated || item.updated || 0
      : item.viewing_updated || item.updated || 0)
  return values.sort((a, b) => {
    if (adultViewingSort === 'az') return titleCompare(a, b)
    if (adultViewingSort === 'za') return titleCompare(b, a)
    if (adultViewingSort === 'newest') return year(b) - year(a) || titleCompare(a, b)
    if (adultViewingSort === 'oldest') return year(a) - year(b) || titleCompare(a, b)
    if (adultViewingTab === 'up-next') {
      return Number(a.up_next_rank || 999999) - Number(b.up_next_rank || 999999)
    }
    return recent(b) - recent(a)
  })
}

function cacheAdultViewingRow(key, row) {
  adultViewingRows.delete(key)
  adultViewingRows.set(key, row)
  while (adultViewingRows.size > ADULT_VIEWING_ROW_LIMIT) {
    const disposable = [...adultViewingRows].find(([, value]) => !value.isConnected)
    if (!disposable) break
    adultViewingRows.delete(disposable[0])
  }
}

function createAdultViewingRow(item, index, total) {
  const row = document.createElement('article')
  row.className = 'adult-viewing-row'
  row.dataset.viewingKey = `${item.media_type}:${item.tmdb_id}`
  const posterUrl = adultViewingPosterUrl(item)
  const art = posterUrl ? document.createElement('img') : document.createElement('span')
  if (posterUrl) {
    art.loading = 'lazy'; art.decoding = 'async'; art.src = posterUrl; art.alt = ''
  } else {
    art.className = 'adult-viewing-placeholder'
    art.append(librarySignalIcon(item.media_type === 'tv' ? 'signal-tv' : 'signal-film'))
  }
  const copy = document.createElement('span'); copy.className = 'adult-viewing-copy'
  const title = document.createElement('strong'); title.textContent = item.title || 'Untitled'
  const meta = document.createElement('span'); meta.textContent = [item.year,
    item.media_type === 'tv' ? 'TV series' : 'Film'].filter(Boolean).join(' · ')
  copy.append(title, meta)
  const actions = document.createElement('span'); actions.className = 'adult-viewing-row-actions'
  if (adultViewingTab === 'up-next') {
    ;[['move_up', 'signal-chevron-up', 'Move earlier'],
      ['move_down', 'signal-chevron-down', 'Move later']].forEach(([action, icon, label]) => {
      const move = document.createElement('button'); move.type = 'button'
      move.dataset.viewingMove = action
      move.setAttribute('aria-label', `${label}: ${item.title}`)
      move.append(librarySignalIcon(icon))
      move.disabled = action === 'move_up' ? index === 0 : index === total - 1
      move.onclick = async event => {
        event.stopPropagation(); await updateAdultViewing(item, action)
      }
      actions.append(move)
    })
  } else {
    const open = document.createElement('button'); open.type = 'button'
    open.className = 'adult-viewing-row-open'
    open.setAttribute('aria-label', `Open ${item.title}`)
    open.append(librarySignalIcon('signal-chevron-right'))
    open.onclick = () => openAdultTitle(item); actions.append(open)
  }
  const artWrap = document.createElement('span'); artWrap.className = 'adult-viewing-art'
  artWrap.append(art)
  appendAdultArtworkStatus(artWrap, item, {
    media_type: item.media_type, local: item.local_progress || item.local,
  })
  const opener = document.createElement('button'); opener.type = 'button'
  opener.className = 'adult-viewing-card-open'
  opener.setAttribute('aria-label', `Open ${item.title}`)
  opener.append(artWrap, copy); opener.onclick = () => openAdultTitle(item)
  const quickActions = adultExploreActions(item, row, 'adult-viewing', () => {
    if (!row.isConnected) return
    const key = row.dataset.viewingKey
    if (!adultViewingItems().some(value =>
      `${value.media_type}:${value.tmdb_id}` === key)) renderAdultViewing({ anchor: false })
  })
  quickActions.classList.add('adult-viewing-quick-actions')
  row.append(opener, quickActions, actions)
  return row
}

function adultViewingRow(item, index, total) {
  const mode = adultViewingTab === 'up-next' ? 'up-next' : 'standard'
  const cacheKey = `${adultViewingTab}:${mode}:${item.media_type}:${item.tmdb_id}`
  let row = adultViewingRows.get(cacheKey)
  if (!row) row = createAdultViewingRow(item, index, total)
  cacheAdultViewingRow(cacheKey, row)
  syncAdultExploreActions(row, item)
  appendAdultArtworkStatus(row.querySelector('.adult-viewing-art'), item, {
    media_type: item.media_type, local: item.local_progress || item.local,
  })
  row.querySelector('[data-viewing-move="move_up"]')?.toggleAttribute('disabled', index === 0)
  row.querySelector('[data-viewing-move="move_down"]')
    ?.toggleAttribute('disabled', index === total - 1)
  return row
}

function reconcileAdultViewingRows(target, rows) {
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

function renderAdultViewing({ anchor = true, loadMore = false } = {}) {
  return preservePortalPosition(() => renderAdultViewingList({ loadMore }), { anchor })
}

function observeAdultViewingMore(button) {
  adultViewingLoadObserver?.disconnect()
  if (!button || typeof IntersectionObserver === 'undefined') return
  if (!adultViewingLoadObserver) {
    adultViewingLoadObserver = new IntersectionObserver(entries => {
      const entry = entries.find(value => value.isIntersecting)
      if (!entry || entry.target.disabled || !entry.target.closest('#adultViewingGrid')) return
      entry.target.click()
    }, { rootMargin: '500px 0px' })
  }
  adultViewingLoadObserver.observe(button)
}

function adultViewingMoreButton(state, shown, total) {
  const button = state.more || document.createElement('button')
  state.more = button
  button.type = 'button'
  button.className = 'adult-viewing-load-more'
  button.disabled = false
  button.textContent = `Show more titles · ${shown} of ${total}`
  button.onclick = () => {
    button.disabled = true
    renderAdultViewing({ anchor: false, loadMore: true })
  }
  return button
}

function renderAdultViewingList({ loadMore = false } = {}) {
  const labels = {
    'up-next': ['Your chosen order', 'Up Next'],
    watchlist: ['Unseen and saved for later', 'Watchlist'],
    watching: ['In progress', 'Watching'],
    'part-watched': ['Some episodes seen', 'Part Watched'],
    history: ['Everything you have seen', 'Watched'],
  }
  const [kicker, heading] = labels[adultViewingTab]
  const reorderable = adultViewingTab === 'up-next' && adultViewingSort === 'recent'
    && adultViewingFilter === 'all' && !adultViewingSearch.trim()
  $('#adultViewingKicker').textContent = reorderable ? 'Hold and drag to reorder' : kicker
  $('#adultViewingHeading').textContent = heading
  const recentOption = $('#adultViewingSort')?.querySelector('option[value="recent"]')
  if (recentOption) {
    recentOption.textContent = adultViewingTab === 'up-next' ? 'Queue order' : 'Recently added'
  }
  const values = adultViewingItems()
  $('#adultViewingCount').textContent = `${values.length} title${values.length === 1 ? '' : 's'}`
  const target = activateAdultViewingPane(adultViewingTab)
  const signature = [adultViewingDataRevision, adultViewingFilter,
    adultViewingSort, adultViewingSearch].join('|')
  let state = adultViewingPaneStates.get(target)
  if (!state) {
    state = { signature: '', limit: 0, rendered: false, more: null }
    adultViewingPaneStates.set(target, state)
  }
  if (state.signature !== signature) {
    state.signature = signature
    state.limit = adultViewingTab === 'up-next'
      ? values.length : Math.min(values.length, ADULT_VIEWING_BATCH_SIZE)
    state.rendered = false
  } else if (loadMore) {
    state.limit = Math.min(values.length, state.limit + ADULT_VIEWING_BATCH_SIZE)
    state.rendered = false
  }
  if (state.rendered) {
    observeAdultViewingMore(state.more?.isConnected ? state.more : null)
    return
  }
  const visible = values.slice(0, state.limit)
  let rows = visible.map((item, index) => adultViewingRow(item, index, values.length))
  if (!rows.length) {
    const empty = document.createElement('div'); empty.className = 'watch-empty'
    empty.append(Object.assign(document.createElement('strong'), {
      textContent: `Nothing in ${heading} yet`,
    }), document.createElement('br'), 'Add titles from search and they will appear here.')
    rows = [empty]
  }
  const more = state.limit < values.length
    ? adultViewingMoreButton(state, visible.length, values.length) : null
  if (more) rows.push(more)
  reconcileAdultViewingRows(target, rows)
  state.rendered = true
  observeAdultViewingMore(more)
  if (reorderable) bindUpNextReorder(target)
}

async function persistAdultViewingCache() {
  try { applyPortalBootstrap(await api('/api/bootstrap')) } catch (_) { /* Best effort. */ }
  await writePortalDataCache('adult-viewing-v1', adultViewingData, 'adult_viewing')
}

function mergeAdultViewingData(next) {
  const previous = new Map((adultViewingData.items || []).map(item => [item.key, item]))
  const items = (next.items || []).map(item => {
    const current = previous.get(item.key)
    if (!current) return item
    Object.keys(current).forEach(key => { if (!(key in item)) delete current[key] })
    Object.assign(current, item)
    return current
  })
  adultViewingDataRevision += 1
  return { ...adultViewingData, ...next, items }
}

async function loadAdultViewing({ render = true, data = null, refresh = false,
                                  expectedMutationRevision = null } = {}) {
  const alreadyLoaded = adultViewingLoaded
  if (render && alreadyLoaded && !data) {
    renderAdultViewing(); renderAdultSeries(watchSearchText)
  }
  let next = data
  let expected = expectedMutationRevision
  let fetched = false
  if (!next && (!adultViewingLoaded || refresh)) {
    expected = adultViewingMutationRevision
    next = await api('/api/adult/viewing')
    fetched = true
  }
  if (!next || (expected !== null && expected !== adultViewingMutationRevision)) return false
  adultViewingData = mergeAdultViewingData(next)
  adultViewingLoaded = true
  refreshAdultArtworkStatuses()
  if (render && (!alreadyLoaded || data || refresh)) {
    renderAdultViewing(); renderAdultSeries(watchSearchText)
  }
  if (fetched) void persistAdultViewingCache()
  return true
}

$$('[data-viewing-tab]').forEach(button => button.onclick = () => {
  adultViewingTab = button.dataset.viewingTab
  $$('[data-viewing-tab]').forEach(value => value.classList.toggle('active', value === button))
  activateAdultViewingPane(adultViewingTab)
  renderAdultViewing({ anchor: false })
})
$('#adultViewingFilter')?.addEventListener('change', event => {
  adultViewingFilter = event.currentTarget.value; renderAdultViewing()
})
$('#adultViewingSort')?.addEventListener('change', event => {
  adultViewingSort = event.currentTarget.value; renderAdultViewing()
})
$('#adultViewingSearch')?.addEventListener('input', event => {
  adultViewingSearch = event.currentTarget.value
  $('#adultViewingSearchClear')?.classList.toggle('hidden', !adultViewingSearch)
  renderAdultViewing()
})
$('#adultViewingSearchClear')?.addEventListener('click', () => {
  const search = $('#adultViewingSearch')
  search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); search.focus()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash === '#adult-viewing') {
    loadAdultViewing({ refresh: true }).catch(() => {})
  }
})
