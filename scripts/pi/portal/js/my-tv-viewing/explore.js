'use strict'

let myTvExploreList = 'for-you'
let myTvExploreType = 'all'
let myTvExplorePage = 0
let myTvExploreItems = []
let myTvExploreHasMore = true
let myTvExploreLoading = false
let myTvExploreRevision = 0
let myTvExploreLeftAt = 0
let myTvExploreHiddenAt = 0
const myTvExploreImpressionStarts = new Map()
const myTvExploreFeedback = new Map()
let myTvExploreFeedbackTimer = null

function beginMyTvExploreVisit() {
  const stale = !myTvExploreLeftAt || Date.now() - myTvExploreLeftAt >= 60000
  myTvExploreLeftAt = 0
  return stale
}

function myTvExploreFeedbackValue(card) {
  const title = myTvExploreItems.find(item => item.key === card.dataset.exploreKey)
  return title ? { media_type: title.media_type, tmdb_id: title.tmdb_id } : null
}

function queueMyTvExploreFeedback(card) {
  if (card.dataset.exploreActed === 'true') return
  const value = myTvExploreFeedbackValue(card)
  if (!value) return
  myTvExploreFeedback.set(card.dataset.exploreKey, value)
  clearTimeout(myTvExploreFeedbackTimer)
  myTvExploreFeedbackTimer = setTimeout(() => { void flushMyTvExploreFeedback() }, 2200)
}

async function flushMyTvExploreFeedback() {
  clearTimeout(myTvExploreFeedbackTimer)
  if (!myTvExploreFeedback.size) return
  const pending = [...myTvExploreFeedback.entries()]
  myTvExploreFeedback.clear()
  try {
    await api('/api/my-tv/explore/feedback', {
      method: 'POST', body: JSON.stringify({ items: pending.map(([, value]) => value) }),
    })
  } catch (_) {
    pending.forEach(([key, value]) => myTvExploreFeedback.set(key, value))
  }
}

function captureMyTvExploreImpressions() {
  const now = performance.now()
  myTvExploreImpressionStarts.forEach((started, card) => {
    if (now - started >= 1200) queueMyTvExploreFeedback(card)
  })
  myTvExploreImpressionStarts.clear()
}

function endMyTvExploreVisit() {
  captureMyTvExploreImpressions()
  myTvExploreLeftAt = Date.now()
  void flushMyTvExploreFeedback()
}

const myTvExploreImpressionObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => entries.forEach(entry => {
    const card = entry.target
    if (entry.isIntersecting && entry.intersectionRatio >= .65) {
      if (!myTvExploreImpressionStarts.has(card)) {
        myTvExploreImpressionStarts.set(card, performance.now())
      }
      return
    }
    const started = myTvExploreImpressionStarts.get(card)
    if (started !== undefined && performance.now() - started >= 1200) {
      queueMyTvExploreFeedback(card)
    }
    myTvExploreImpressionStarts.delete(card)
  }), { threshold: [0, .65] }) : null

function myTvExploreTitle(title, context = 'explore') {
  return {
    ...title,
    local_context: context,
    catalogue_only: context !== 'my-tv-home',
  }
}

function syncMyTvExploreActions(card, title) {
  const state = myTvViewingRecord(title)
  const status = myTvArtworkStatusKind(title)
  const watchlist = card.querySelector('[data-explore-action="watchlist"]')
  if (watchlist) {
    watchlist.classList.toggle('active', state.watchlisted === true)
    watchlist.setAttribute('aria-pressed', String(state.watchlisted === true))
    watchlist.setAttribute('aria-label', `${state.watchlisted ? 'Remove from' : 'Add to'} Watchlist: ${title.title}`)
    const watchlistIcon = state.watchlisted ? 'signal-minus' : 'signal-plus'
    if (watchlist.querySelector('use')?.getAttribute('href') !== `/portal/icons.svg#${watchlistIcon}`) {
      watchlist.replaceChildren(librarySignalIcon(watchlistIcon))
    }
  }
  const watched = card.querySelector('[data-explore-action="watched"]')
  if (watched) {
    watched.classList.toggle('active', Boolean(status))
    watched.dataset.status = status
    watched.setAttribute('aria-pressed', String(status === 'watched'))
    watched.setAttribute('aria-label', title.media_type === 'tv'
      ? `Choose the watched series for ${title.title}`
      : `${status === 'watched' ? 'Mark unwatched' : 'Mark watched'}: ${title.title}`)
    const watchedIcon = status === 'part-watched' ? 'signal-minus'
      : status === 'watched' ? 'signal-check' : ''
    if (watched.querySelector('use')?.getAttribute('href') !==
        (watchedIcon ? `/portal/icons.svg#${watchedIcon}` : undefined)) {
      watched.replaceChildren(...(watchedIcon ? [librarySignalIcon(watchedIcon)] : []))
    }
  }
}

function syncMyTvExploreCard(card, title) {
  const art = card.querySelector('.my-tv-explore-art')
  appendMyTvArtworkStatus(art, title)
  renderMyTvProviderBadges(art, title)
  syncMyTvExploreActions(card, title)
}

function myTvExploreActions(title, card, context = 'explore', onChange = null) {
  const actions = document.createElement('span')
  actions.className = 'my-tv-explore-actions'
  const apply = viewing => {
    syncMyTvExploreActions(card, title)
    onChange?.(viewing)
  }
  const watchlist = MabelPortalUI.button({ iconName: 'signal-plus' })
  watchlist.dataset.exploreAction = 'watchlist'
  watchlist.onclick = async () => {
    card.dataset.exploreActed = 'true'
    if (watchlist.dataset.saving === 'true') return
    watchlist.dataset.saving = 'true'
    try {
      const state = myTvViewingRecord(title)
      title.viewing = await updateMyTvViewing(title, 'watchlist', {
        enabled: state.watchlisted !== true,
      }, apply)
    } catch (error) { showError(error) } finally { delete watchlist.dataset.saving }
  }
  const watched = MabelPortalUI.button({ iconName: 'signal-check' })
  watched.dataset.exploreAction = 'watched'
  watched.onclick = async () => {
    card.dataset.exploreActed = 'true'
    if (title.media_type === 'tv') {
      openMyTvTitle(myTvExploreTitle(title, context))
      return
    }
    if (watched.dataset.saving === 'true') return
    watched.dataset.saving = 'true'
    try {
      const complete = myTvArtworkStatusKind(title) === 'watched'
      title.viewing = await updateMyTvViewing(title,
        complete ? 'not_watched' : 'watched', {}, apply)
    } catch (error) { showError(error) } finally { delete watched.dataset.saving }
  }
  actions.append(watchlist, watched)
  syncMyTvExploreActions(actions, title)
  return actions
}

function refreshMyTvExploreCards() {
  document.querySelectorAll('.my-tv-explore-card').forEach(card => {
    const title = card._myTvExploreTitle
      || myTvExploreItems.find(item => item.key === card.dataset.exploreKey)
    if (title) {
      syncMyTvExploreArtwork(card, title)
      syncMyTvExploreCard(card, title)
    }
  })
}

function syncMyTvExploreArtwork(card, title) {
  const art = card.querySelector('.my-tv-explore-art')
  if (!art) return
  const source = myTvViewingPosterUrl(title)
  const current = art.querySelector(':scope > img')
  if (source) {
    const currentSource = current?.dataset.myTvArtworkSource || current?.getAttribute('src') || ''
    if (!current || currentSource !== source) {
      const image = myTvArtworkImage(source)
      if (current) current.replaceWith(image)
      else art.prepend(image)
    }
    art.querySelector(':scope > svg.icon')?.remove()
  } else if (!current && !art.querySelector(':scope > svg.icon')) {
    art.prepend(librarySignalIcon(title.media_type === 'tv' ? 'signal-tv' : 'signal-film'))
  }
}

function myTvExploreCard(title, { directActions = true, context = 'explore' } = {}) {
  const card = document.createElement('article')
  card.className = 'my-tv-explore-card'
  card._myTvExploreTitle = title
  card.dataset.exploreKey = title.key
  card.dataset.mediaType = title.media_type
  card.dataset.exploreContext = context
  const visual = document.createElement('div')
  visual.className = 'my-tv-explore-visual'
  const openArt = document.createElement('button')
  openArt.type = 'button'
  openArt.className = 'my-tv-explore-open-art'
  openArt.setAttribute('aria-label', `Open details for ${title.title}`)
  const art = document.createElement('span')
  art.className = 'my-tv-explore-art'
  const source = myTvViewingPosterUrl(title)
  if (source) art.append(myTvArtworkImage(source))
  else art.append(librarySignalIcon(title.media_type === 'tv' ? 'signal-tv' : 'signal-film'))
  openArt.append(art)
  openArt.onclick = () => {
    card.dataset.exploreActed = 'true'
    openMyTvTitle(myTvExploreTitle(title, context))
  }

  const actions = myTvExploreActions(title, card, context)
  visual.append(openArt)
  if (context === 'my-tv-home-release' && title.cinema_only === true) {
    const cinema = document.createElement('span')
    cinema.className = 'my-tv-release-cinema-tag'
    cinema.textContent = 'Cinema'
    visual.append(cinema)
  }
  if (directActions) visual.append(actions)

  const openCopy = document.createElement('button')
  openCopy.type = 'button'
  openCopy.className = 'my-tv-explore-open-copy'
  const name = document.createElement('strong')
  name.textContent = title.title
  const meta = document.createElement('small')
  meta.textContent = context === 'my-tv-home-release'
    ? String(title.release_label || '')
    : [title.year, title.media_type === 'tv' ? 'Series' : 'Film']
      .filter(Boolean).join(' · ')
  openCopy.append(name, meta)
  if (context === 'filmography' && title.character) {
    const role = document.createElement('small')
    role.className = 'my-tv-explore-role'
    role.textContent = title.character
    openCopy.append(role)
  }
  openCopy.setAttribute('aria-label', `Open details for ${title.title}`)
  openCopy.onclick = () => {
    card.dataset.exploreActed = 'true'
    openMyTvTitle(myTvExploreTitle(title, context))
  }
  card.append(visual, openCopy)
  syncMyTvExploreCard(card, title)
  return card
}

function renderMyTvExploreGrid({ loading = false } = {}) {
  const root = $('#myTvExploreGrid')
  if (!root) return
  if (loading && !myTvExploreItems.length) {
    root.querySelectorAll('.my-tv-explore-card').forEach(card => {
      myTvExploreImpressionObserver?.unobserve(card)
      myTvExploreImpressionStarts.delete(card)
    })
    root.replaceChildren(...Array.from({ length: 12 }, () => {
      const card = document.createElement('span')
      card.className = 'my-tv-explore-loading'
      card.append(document.createElement('i'), document.createElement('b'), document.createElement('small'))
      return card
    }))
  } else if (myTvExploreItems.length) {
    root.querySelectorAll('.my-tv-explore-loading,.watch-empty').forEach(value => value.remove())
    const rendered = new Map([...root.querySelectorAll('.my-tv-explore-card')]
      .map(card => [card.dataset.exploreKey, card]))
    myTvExploreItems.forEach(title => {
      const current = rendered.get(title.key)
      if (current) syncMyTvExploreCard(current, title)
      else {
        const card = myTvExploreCard(title)
        root.append(card)
        myTvExploreImpressionObserver?.observe(card)
      }
    })
  } else if (!loading) {
    root.replaceChildren(portalEmptyState({
      className: 'watch-empty', title: 'No new suggestions in this list',
      message: 'Try another list, or come back after your viewing history changes.',
    }))
  }
  $('#myTvExploreCount').textContent = myTvExploreItems.length
    ? `${myTvExploreItems.length} suggestion${myTvExploreItems.length === 1 ? '' : 's'}` : ''
  const more = $('#myTvExploreMore')
  more.classList.toggle('hidden', !myTvExploreHasMore || !myTvExploreItems.length)
  more.disabled = myTvExploreLoading
  more.textContent = myTvExploreLoading ? 'Finding more…' : 'Show me more'
}

function syncMyTvExploreLists(lists) {
  const select = $('#myTvExploreList')
  if (!select || !Array.isArray(lists) || !lists.length) return
  const signature = lists.map(item => `${item.id}:${item.label}`).join('|')
  if (select.dataset.signature !== signature) {
    select.replaceChildren(...lists.map(item => {
      const option = document.createElement('option')
      option.value = item.id
      option.textContent = item.label
      return option
    }))
    select.dataset.signature = signature
  }
  select.value = myTvExploreList
}

async function loadMyTvExplore({ reset = false } = {}) {
  if (myTvExploreLoading) return
  if (reset) {
    myTvExploreRevision += 1
    myTvExplorePage = 0
    myTvExploreItems = []
    myTvExploreHasMore = true
  }
  if (!myTvExploreHasMore) return
  const revision = myTvExploreRevision
  if (!reset && myTvExplorePage > 0) await flushMyTvExploreFeedback()
  myTvExploreLoading = true
  renderMyTvExploreGrid({ loading: true })
  try {
    const page = myTvExplorePage + 1
    const result = await api(`/api/my-tv/explore?list=${encodeURIComponent(myTvExploreList)}&media_type=${encodeURIComponent(myTvExploreType)}&page=${page}`)
    if (revision !== myTvExploreRevision) return
    syncMyTvExploreLists(result.lists)
    const existing = new Set(myTvExploreItems.map(item => item.key))
    myTvExploreItems.push(...(result.results || []).filter(item => !existing.has(item.key)))
    myTvExplorePage = page
    myTvExploreHasMore = result.has_more === true
    $('#myTvExploreHeading').textContent = result.list?.label || 'Explore'
    $('#myTvExploreKicker').textContent = result.list?.kicker || 'More things you may remember'
  } catch (error) {
    if (revision !== myTvExploreRevision) return
    if (!myTvExploreItems.length) $('#myTvExploreGrid').replaceChildren(portalEmptyState({
      className: 'watch-empty', title: 'Explore is unavailable', message: error.message,
    }))
    myTvExploreHasMore = false
  } finally {
    if (revision === myTvExploreRevision) {
      myTvExploreLoading = false
      renderMyTvExploreGrid()
    }
  }
}

$('#myTvViewingExplore')?.addEventListener('click', () => {
  history.pushState({ myTvExplore: true }, '', '#my-tv-explore')
  openView('my-tv-explore')
})
$('#myTvExploreBack')?.addEventListener('click', () => {
  if (history.state?.myTvExplore) history.back()
  else {
    history.replaceState({ myTvViewing: true }, '', '#my-tv-viewing')
    openView('my-tv-viewing')
  }
})
$('#myTvExploreType')?.addEventListener('change', event => {
  myTvExploreType = event.currentTarget.value
  void loadMyTvExplore({ reset: true })
})
$('#myTvExploreList')?.addEventListener('change', event => {
  myTvExploreList = event.currentTarget.value
  void loadMyTvExplore({ reset: true })
})
$('#myTvExploreMore')?.addEventListener('click', () => { void loadMyTvExplore() })

const myTvExploreObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)
        && $('#view-my-tv-explore')?.classList.contains('active')) void loadMyTvExplore()
  }, { rootMargin: '320px 0px' }) : null
if (myTvExploreObserver && $('#myTvExploreMore')) myTvExploreObserver.observe($('#myTvExploreMore'))

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if ($('#view-my-tv-explore')?.classList.contains('active')) {
      captureMyTvExploreImpressions()
      myTvExploreHiddenAt = Date.now()
      void flushMyTvExploreFeedback()
    }
    return
  }
  if ($('#view-my-tv-explore')?.classList.contains('active') && myTvExploreHiddenAt
      && Date.now() - myTvExploreHiddenAt >= 60000) {
    resetViewScroll()
    void loadMyTvExplore({ reset: true })
  }
  myTvExploreHiddenAt = 0
})
