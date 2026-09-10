'use strict'

let adultExploreList = 'for-you'
let adultExploreType = 'all'
let adultExplorePage = 0
let adultExploreItems = []
let adultExploreHasMore = true
let adultExploreLoading = false
let adultExploreRevision = 0
let adultExploreLeftAt = 0
let adultExploreHiddenAt = 0
const adultExploreImpressionStarts = new Map()
const adultExploreFeedback = new Map()
let adultExploreFeedbackTimer = null

function beginAdultExploreVisit() {
  const stale = !adultExploreLeftAt || Date.now() - adultExploreLeftAt >= 60000
  adultExploreLeftAt = 0
  return stale
}

function adultExploreFeedbackValue(card) {
  const title = adultExploreItems.find(item => item.key === card.dataset.exploreKey)
  return title ? { media_type: title.media_type, tmdb_id: title.tmdb_id } : null
}

function queueAdultExploreFeedback(card) {
  if (card.dataset.exploreActed === 'true') return
  const value = adultExploreFeedbackValue(card)
  if (!value) return
  adultExploreFeedback.set(card.dataset.exploreKey, value)
  clearTimeout(adultExploreFeedbackTimer)
  adultExploreFeedbackTimer = setTimeout(() => { void flushAdultExploreFeedback() }, 2200)
}

async function flushAdultExploreFeedback() {
  clearTimeout(adultExploreFeedbackTimer)
  if (!adultExploreFeedback.size) return
  const pending = [...adultExploreFeedback.entries()]
  adultExploreFeedback.clear()
  try {
    await api('/api/adult/explore/feedback', {
      method: 'POST', body: JSON.stringify({ items: pending.map(([, value]) => value) }),
    })
  } catch (_) {
    pending.forEach(([key, value]) => adultExploreFeedback.set(key, value))
  }
}

function captureAdultExploreImpressions() {
  const now = performance.now()
  adultExploreImpressionStarts.forEach((started, card) => {
    if (now - started >= 1200) queueAdultExploreFeedback(card)
  })
  adultExploreImpressionStarts.clear()
}

function endAdultExploreVisit() {
  captureAdultExploreImpressions()
  adultExploreLeftAt = Date.now()
  void flushAdultExploreFeedback()
}

const adultExploreImpressionObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => entries.forEach(entry => {
    const card = entry.target
    if (entry.isIntersecting && entry.intersectionRatio >= .65) {
      if (!adultExploreImpressionStarts.has(card)) {
        adultExploreImpressionStarts.set(card, performance.now())
      }
      return
    }
    const started = adultExploreImpressionStarts.get(card)
    if (started !== undefined && performance.now() - started >= 1200) {
      queueAdultExploreFeedback(card)
    }
    adultExploreImpressionStarts.delete(card)
  }), { threshold: [0, .65] }) : null

function adultExploreTitle(title) {
  return { ...title, local_context: 'explore', catalogue_only: true }
}

function syncAdultExploreCard(card, title) {
  const state = adultViewingRecord(title)
  const status = adultArtworkStatusKind(title)
  appendAdultArtworkStatus(card.querySelector('.adult-explore-art'), title)
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

function refreshAdultExploreCards() {
  document.querySelectorAll('.adult-explore-card').forEach(card => {
    const title = card._adultExploreTitle
      || adultExploreItems.find(item => item.key === card.dataset.exploreKey)
    if (title) syncAdultExploreCard(card, title)
  })
}

function adultExploreCard(title, { directActions = true, context = 'explore' } = {}) {
  const card = document.createElement('article')
  card.className = 'adult-explore-card'
  card._adultExploreTitle = title
  card.dataset.exploreKey = title.key
  card.dataset.mediaType = title.media_type
  const visual = document.createElement('div')
  visual.className = 'adult-explore-visual'
  const openArt = document.createElement('button')
  openArt.type = 'button'
  openArt.className = 'adult-explore-open-art'
  openArt.setAttribute('aria-label', `Open details for ${title.title}`)
  const art = document.createElement('span')
  art.className = 'adult-explore-art'
  if (title.poster_path) {
    const image = document.createElement('img')
    image.src = adultPosterUrl(title.poster_path)
    image.alt = ''
    image.loading = 'lazy'
    art.append(image)
  } else art.append(librarySignalIcon(title.media_type === 'tv' ? 'signal-tv' : 'signal-film'))
  if (title.on_mabeltv) {
    const local = document.createElement('span')
    local.className = 'watch-format adult-local-badge'
    local.textContent = 'MabelTV'
    art.append(local)
  }
  openArt.append(art)
  openArt.onclick = () => {
    card.dataset.exploreActed = 'true'
    openAdultTitle({ ...adultExploreTitle(title), local_context: context })
  }

  const actions = document.createElement('span')
  actions.className = 'adult-explore-actions'
  const watchlist = MabelPortalUI.button({ iconName: 'signal-plus' })
  watchlist.dataset.exploreAction = 'watchlist'
  watchlist.onclick = async () => {
    card.dataset.exploreActed = 'true'
    if (watchlist.dataset.saving === 'true') return
    watchlist.dataset.saving = 'true'
    try {
      const state = adultViewingRecord(title)
      title.viewing = await updateAdultViewing(title, 'watchlist', {
        enabled: state.watchlisted !== true,
      }, () => syncAdultExploreCard(card, title))
    } catch (error) { showError(error) } finally { delete watchlist.dataset.saving }
  }
  const watched = MabelPortalUI.button({ iconName: 'signal-check' })
  watched.dataset.exploreAction = 'watched'
  watched.onclick = async () => {
    card.dataset.exploreActed = 'true'
    if (title.media_type === 'tv') {
      openAdultTitle(adultExploreTitle(title))
      return
    }
    if (watched.dataset.saving === 'true') return
    watched.dataset.saving = 'true'
    try {
      const complete = adultArtworkStatusKind(title) === 'watched'
      title.viewing = await updateAdultViewing(title,
        complete ? 'not_watched' : 'watched', {},
        () => syncAdultExploreCard(card, title))
    } catch (error) { showError(error) } finally { delete watched.dataset.saving }
  }
  actions.append(watchlist, watched)
  visual.append(openArt)
  if (directActions) visual.append(actions)

  const openCopy = document.createElement('button')
  openCopy.type = 'button'
  openCopy.className = 'adult-explore-open-copy'
  const name = document.createElement('strong')
  name.textContent = title.title
  const meta = document.createElement('small')
  meta.textContent = [title.year, title.media_type === 'tv' ? 'Series' : 'Film']
    .filter(Boolean).join(' · ')
  openCopy.append(name, meta)
  if (context === 'filmography' && title.character) {
    const role = document.createElement('small')
    role.className = 'adult-explore-role'
    role.textContent = title.character
    openCopy.append(role)
  }
  openCopy.setAttribute('aria-label', `Open details for ${title.title}`)
  openCopy.onclick = () => {
    card.dataset.exploreActed = 'true'
    openAdultTitle({ ...adultExploreTitle(title), local_context: context })
  }
  card.append(visual, openCopy)
  syncAdultExploreCard(card, title)
  return card
}

function renderAdultExploreGrid({ loading = false } = {}) {
  const root = $('#adultExploreGrid')
  if (!root) return
  if (loading && !adultExploreItems.length) {
    root.querySelectorAll('.adult-explore-card').forEach(card => {
      adultExploreImpressionObserver?.unobserve(card)
      adultExploreImpressionStarts.delete(card)
    })
    root.replaceChildren(...Array.from({ length: 12 }, () => {
      const card = document.createElement('span')
      card.className = 'adult-explore-loading'
      card.append(document.createElement('i'), document.createElement('b'), document.createElement('small'))
      return card
    }))
  } else if (adultExploreItems.length) {
    root.querySelectorAll('.adult-explore-loading,.watch-empty').forEach(value => value.remove())
    const rendered = new Map([...root.querySelectorAll('.adult-explore-card')]
      .map(card => [card.dataset.exploreKey, card]))
    adultExploreItems.forEach(title => {
      const current = rendered.get(title.key)
      if (current) syncAdultExploreCard(current, title)
      else {
        const card = adultExploreCard(title)
        root.append(card)
        adultExploreImpressionObserver?.observe(card)
      }
    })
  } else if (!loading) {
    root.replaceChildren(portalEmptyState({
      className: 'watch-empty', title: 'No new suggestions in this list',
      message: 'Try another list, or come back after your viewing history changes.',
    }))
  }
  $('#adultExploreCount').textContent = adultExploreItems.length
    ? `${adultExploreItems.length} suggestion${adultExploreItems.length === 1 ? '' : 's'}` : ''
  const more = $('#adultExploreMore')
  more.classList.toggle('hidden', !adultExploreHasMore || !adultExploreItems.length)
  more.disabled = adultExploreLoading
  more.textContent = adultExploreLoading ? 'Finding more…' : 'Show me more'
}

function syncAdultExploreLists(lists) {
  const select = $('#adultExploreList')
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
  select.value = adultExploreList
}

async function loadAdultExplore({ reset = false } = {}) {
  if (adultExploreLoading) return
  if (reset) {
    adultExploreRevision += 1
    adultExplorePage = 0
    adultExploreItems = []
    adultExploreHasMore = true
  }
  if (!adultExploreHasMore) return
  const revision = adultExploreRevision
  if (!reset && adultExplorePage > 0) await flushAdultExploreFeedback()
  adultExploreLoading = true
  renderAdultExploreGrid({ loading: true })
  try {
    const page = adultExplorePage + 1
    const result = await api(`/api/adult/explore?list=${encodeURIComponent(adultExploreList)}&media_type=${encodeURIComponent(adultExploreType)}&page=${page}`)
    if (revision !== adultExploreRevision) return
    syncAdultExploreLists(result.lists)
    const existing = new Set(adultExploreItems.map(item => item.key))
    adultExploreItems.push(...(result.results || []).filter(item => !existing.has(item.key)))
    adultExplorePage = page
    adultExploreHasMore = result.has_more === true
    $('#adultExploreHeading').textContent = result.list?.label || 'Explore'
    $('#adultExploreKicker').textContent = result.list?.kicker || 'More things you may remember'
  } catch (error) {
    if (revision !== adultExploreRevision) return
    if (!adultExploreItems.length) $('#adultExploreGrid').replaceChildren(portalEmptyState({
      className: 'watch-empty', title: 'Explore is unavailable', message: error.message,
    }))
    adultExploreHasMore = false
  } finally {
    if (revision === adultExploreRevision) {
      adultExploreLoading = false
      renderAdultExploreGrid()
    }
  }
}

$('#adultViewingExplore')?.addEventListener('click', () => {
  history.pushState({ adultExplore: true }, '', '#adult-explore')
  openView('adult-explore')
})
$('#adultExploreBack')?.addEventListener('click', () => {
  if (history.state?.adultExplore) history.back()
  else {
    history.replaceState({ adultViewing: true }, '', '#adult-viewing')
    openView('adult-viewing')
  }
})
$('#adultExploreType')?.addEventListener('change', event => {
  adultExploreType = event.currentTarget.value
  void loadAdultExplore({ reset: true })
})
$('#adultExploreList')?.addEventListener('change', event => {
  adultExploreList = event.currentTarget.value
  void loadAdultExplore({ reset: true })
})
$('#adultExploreMore')?.addEventListener('click', () => { void loadAdultExplore() })

const adultExploreObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)
        && $('#view-adult-explore')?.classList.contains('active')) void loadAdultExplore()
  }, { rootMargin: '320px 0px' }) : null
if (adultExploreObserver && $('#adultExploreMore')) adultExploreObserver.observe($('#adultExploreMore'))

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if ($('#view-adult-explore')?.classList.contains('active')) {
      captureAdultExploreImpressions()
      adultExploreHiddenAt = Date.now()
      void flushAdultExploreFeedback()
    }
    return
  }
  if ($('#view-adult-explore')?.classList.contains('active') && adultExploreHiddenAt
      && Date.now() - adultExploreHiddenAt >= 60000) {
    resetViewScroll()
    void loadAdultExplore({ reset: true })
  }
  adultExploreHiddenAt = 0
})
