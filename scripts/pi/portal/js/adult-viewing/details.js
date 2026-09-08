'use strict'

function adultTitleIntentAction(detail, button, request, root = $('#adultTitleIntents'), onUpdate = null) {
  return async () => {
    if (button.disabled) return
    button.disabled = true
    try {
      const { action, extra = {} } = request()
      detail.viewing = await updateAdultViewing(detail, action, extra)
      syncAdultTitleButtons(detail, root)
      if (onUpdate) onUpdate(detail.viewing)
      if (root?.id === 'adultTitleIntents') syncAdultTitleNextEpisode(detail)
      if (action === 'watchlist') notice(detail.viewing.watchlisted
        ? 'Added to Watchlist.' : 'Removed from Watchlist.')
      else if (action === 'up_next') notice(detail.viewing.up_next
        ? 'Added to Up Next.' : 'Removed from Up Next.')
      else if (action === 'watching') notice(detail.viewing.series_watching
        ? 'Series added to Watching.' : 'Series removed from Watching.')
      else if (action === 'watched') notice('Marked watched and removed from Watchlist and Up Next.')
      else if (action === 'not_watched') notice('Corrected. Its watched-history record is retained.')
    } catch (error) {
      showError(error)
    } finally {
      button.disabled = false
    }
  }
}

function wireAdultTitleIntentActions(detail, root = $('#adultTitleIntents'), onUpdate = null) {
  const { watchlist, up_next: upNext, watching, watched } = adultViewingActionButtons(root)
  if (!watchlist || !upNext || !watched) return
  syncAdultTitleButtons(detail, root)
  watchlist.onclick = adultTitleIntentAction(detail, watchlist, () => ({
    action: 'watchlist', extra: { enabled: !detail.viewing?.watchlisted },
  }), root, onUpdate)
  upNext.onclick = adultTitleIntentAction(detail, upNext, () => ({
    action: 'up_next', extra: { enabled: !detail.viewing?.up_next },
  }), root, onUpdate)
  if (watching) watching.onclick = adultTitleIntentAction(detail, watching, () => ({
    action: 'watching', extra: { enabled: !detail.viewing?.series_watching },
  }), root, onUpdate)
  watched.onclick = detail.media_type === 'tv' ? null
    : adultTitleIntentAction(detail, watched, () => ({
      action: detail.viewing?.manual_state === 'watched' ? 'not_watched' : 'watched',
    }), root, onUpdate)
}

function localFilmViewingDetail(film) {
  const metadata = film?.metadata || {}
  const tmdbId = Number(metadata.tmdb_id || 0)
  if (!tmdbId) return null
  const key = `movie:${tmdbId}`
  const stored = (adultViewingData.items || []).find(item => item.key === key) || {}
  return {
    media_type: 'movie', tmdb_id: tmdbId, key,
    title: metadata.title || film.display_name || 'Untitled film',
    year: metadata.year || stored.year || '',
    overview: metadata.overview || stored.overview || '',
    runtime: Number(metadata.runtime || stored.runtime || 0),
    poster_path: stored.poster_path || '',
    viewing: stored,
  }
}

let localFilmProviderRevision = 0

async function loadLocalFilmProviders(film, refresh = false) {
  const revision = ++localFilmProviderRevision
  const section = $('#watchFilmProviders')
  const root = $('#watchFilmProviderList')
  const detail = localFilmViewingDetail(film)
  section.classList.remove('hidden')
  const refreshButton = $('#watchFilmProviderRefresh')
  refreshButton.classList.toggle('hidden', !detail)
  if (!detail) {
    root.innerHTML = '<p>Match this film’s metadata to see where it is available in Great Britain.</p>'
    return
  }
  refreshButton.onclick = () => {
    void loadLocalFilmProviders(film, true).catch(showError)
  }
  root.dataset.providerKey = detail.key
  root.innerHTML = '<p>Checking streaming destinations…</p>'
  try {
    const [title, sources] = await Promise.all([
      api(`/api/adult/title?media_type=movie&tmdb_id=${detail.tmdb_id}`),
      api(`/api/adult/providers?media_type=movie&tmdb_id=${detail.tmdb_id}${refresh ? '&refresh=1' : ''}`),
    ])
    if (revision !== localFilmProviderRevision || root.dataset.providerKey !== detail.key) return
    renderAdultProviderLinksInto(root, {
      ...title,
      on_mabeltv: true,
      local: { kind: 'film', path: film.path },
    }, sources, { localAction: null })
  } catch (error) {
    if (revision !== localFilmProviderRevision || root.dataset.providerKey !== detail.key) return
    renderAdultProviderLinksInto(root, { ...detail, on_mabeltv: true }, { sources: [] },
      { localAction: null })
    const message = document.createElement('p')
    message.textContent = error.message || 'Streaming destinations are unavailable right now.'
    root.append(message)
  }
}

async function wireLocalFilmViewingActions(root, film) {
  const detail = localFilmViewingDetail(film)
  root.classList.toggle('hidden', !detail)
  if (!detail) return
  root.dataset.viewingKey = detail.key
  root.querySelectorAll('button').forEach(button => { button.disabled = true })
  if (!adultViewingLoaded) await loadAdultViewing()
  if (root.dataset.viewingKey !== detail.key) return
  detail.viewing = (adultViewingData.items || []).find(item => item.key === detail.key) || {}
  root.querySelectorAll('button').forEach(button => { button.disabled = false })
  wireAdultTitleIntentActions(detail, root)
}

function localAdultSeriesForTitle(title = {}) {
  const localId = title.local?.kind === 'series' ? title.local.series : ''
  const tmdbId = Number(title.tmdb_id || 0)
  return (library?.adult_series || []).find(series => series.id === localId)
    || (tmdbId ? (library?.adult_series || []).find(series =>
      Number(series.metadata?.tmdb_id || 0) === tmdbId) : null)
}

function localSeriesViewingDetail(series) {
  const metadata = series?.metadata || {}
  const tmdbId = Number(metadata.tmdb_id || 0)
  if (!tmdbId) return null
  const key = `tv:${tmdbId}`
  const stored = (adultViewingData.items || []).find(item => item.key === key) || {}
  const seasonNumbers = new Set((series.seasons || []).map(Number))
  ;(series.episodes || []).forEach(episode => seasonNumbers.add(Number(episode.season)))
  return {
    media_type: 'tv', tmdb_id: tmdbId, key,
    title: metadata.title || series.title || 'Untitled series',
    year: metadata.year || stored.year || '',
    overview: metadata.overview || stored.overview || '',
    local: {
      kind: 'series', series: series.id,
      watched_count: Number(series.watched_count || 0),
    },
    seasons: [...seasonNumbers].filter(Number.isFinite).map(number => {
      const episodes = (series.episodes || []).filter(episode => Number(episode.season) === number)
      return {
        number, episodes: episodes.length,
        watched_count: episodes.filter(episode => episode.watched).length,
      }
    }),
    viewing: stored,
  }
}

async function wireLocalSeriesViewingActions(root, series, onUpdate) {
  const detail = localSeriesViewingDetail(series)
  root.classList.toggle('hidden', !detail)
  if (!detail) return
  root.dataset.viewingKey = detail.key
  root.querySelectorAll('button').forEach(button => { button.disabled = true })
  if (!adultViewingLoaded) await loadAdultViewing()
  if (root.dataset.viewingKey !== detail.key) return
  detail.viewing = (adultViewingData.items || []).find(item => item.key === detail.key) || {}
  root.querySelectorAll('button').forEach(button => { button.disabled = false })
  wireAdultTitleIntentActions(detail, root, onUpdate)
  onUpdate(detail.viewing)
}

function renderAdultTitleDetail(detail, refreshProviders = true,
                                revision = adultTitleOpenRevision) {
  const sheet = $('#adultTitleSheet')
  const localSeries = detail.media_type === 'tv' ? localAdultSeriesForTitle(detail) : null
  if (localSeries) {
    detail.local = { kind: 'series', series: localSeries.id,
      watched_count: Number(localSeries.watched_count || 0) }
  }
  if (detail.media_type === 'tv') detail.on_mabeltv = Boolean((localSeries?.episodes || []).length)
  selectedAdultTitle = detail
  sheet.classList.remove('is-loading-title')
  const isSeries = detail.media_type === 'tv'
  sheet.classList.toggle('is-series', isSeries)
  $('#adultTitleName').textContent = detail.title
  $('#adultTitleEyebrow').textContent = detail.on_mabeltv
    ? 'On MabelTV' : isSeries ? 'Streaming TV series' : 'Film'
  $('#adultTitleOverview').textContent = detail.overview || 'No description is available.'
  renderAdultTitleSeasons(detail)
  const metadata = $('#adultTitleMeta')
  metadata.replaceChildren()
  const values = isSeries ? [
    `${(detail.seasons || []).length} series`,
    `${(detail.seasons || []).reduce((total, season) => total + Number(season.episodes || 0), 0)} episodes`,
    detail.on_mabeltv ? `${(localSeries?.episodes || []).length} on MabelTV` : 'Not on MabelTV',
    `${(detail.seasons || []).reduce((total, season) => total + Number(season.watched_count || 0), 0)} watched`,
  ] : [detail.year, detail.runtime ? `${detail.runtime} min` : '', ...(detail.genres || []).slice(0, 2)]
  values.filter(Boolean).forEach(value => {
    const span = document.createElement('span')
    span.textContent = value
    metadata.append(span)
  })
  const poster = $('#adultTitlePoster')
  poster.replaceChildren()
  if (detail.poster_path) {
    const image = document.createElement('img')
    image.src = adultPosterUrl(detail.poster_path, 'w500')
    image.alt = `Poster for ${detail.title}`
    poster.append(image)
  }
  $('#adultTitleBackdrop').style.setProperty('--watch-film-art', detail.backdrop_path
    ? `url("${adultPosterUrl(detail.backdrop_path, 'w1280')}")`
    : 'linear-gradient(135deg,#2e3a34,#101513)')
  $('#adultTitleLocal').classList.toggle('hidden', !detail.on_mabeltv)
  $('#adultTitleLocalCopy').textContent = detail.on_mabeltv
    ? detail.media_type === 'tv'
      ? 'Available locally on MabelTV. Stored episodes offer Play on TV and Watch on this device.'
      : 'Available locally on MabelTV — this option is always shown first.'
    : ''
  wireAdultTitleIntentActions(detail)
  if (isSeries) void syncAdultTitleEpisodeStatus(detail).catch(showError)
  const more = $('#adultTitleMore')
  more.classList.toggle('hidden', !localSeries || !(localSeries.episodes || []).length)
  more.onclick = localSeries && (localSeries.episodes || []).length ? () => {
    portalSheets.dismiss(sheet)
    openAdultSeriesMoreSheet(localSeries, null, () => restoreAdultTitleSheet(detail))
  } : null
  $('#adultProviderRefresh').onclick = () => loadAdultProviders(detail, true, revision)
  if (refreshProviders) {
    $('#adultProviderList').innerHTML = '<p>Checking streaming destinations…</p>'
    loadAdultProviders(detail, false, revision)
  }
}

function prepareAdultTitleSheet(title) {
  const sheet = $('#adultTitleSheet')
  const panel = sheet.querySelector('.watch-film-panel')
  selectedAdultTitle = title
  sheet.classList.add('is-loading-title')
  panel.scrollTop = 0
  panel.scrollLeft = 0
  sheet.classList.toggle('is-series', title.media_type === 'tv')
  $('#adultTitleName').textContent = title.title || 'Loading title…'
  $('#adultTitleEyebrow').textContent = title.media_type === 'tv'
    ? 'Streaming TV series' : 'Film'
  $('#adultTitleOverview').textContent = 'Loading title details…'
  $('#adultTitleMeta').replaceChildren()
  $('#adultTitlePoster').replaceChildren()
  $('#adultTitleBackdrop').style.setProperty('--watch-film-art',
    'linear-gradient(135deg,#27252c,#101014)')
  $('#adultTitleSeriesLibrary').classList.add('hidden')
  $('#adultTitleSeasons').replaceChildren()
  $('#adultTitleNextEpisode').classList.add('hidden')
  $('#adultTitleLocal').classList.add('hidden')
  $('#adultTitleLocalCopy').textContent = ''
  $('#adultTitleMore').classList.add('hidden')
  $('#adultTitleMore').onclick = null
  $('#adultProviderList').innerHTML = '<p>Loading…</p>'
  $('#adultTitleIntents').querySelectorAll('[data-viewing-action]').forEach(button => {
    button.classList.remove('active', 'is-unavailable')
    button.setAttribute('aria-pressed', 'false')
  })
  return sheet
}

async function openAdultTitle(title) {
  const revision = ++adultTitleOpenRevision
  const sheet = prepareAdultTitleSheet(title)
  portalSheets.open(sheet, { focus: sheet.querySelector('.watch-film-panel') })
  try {
    const detail = await api(`/api/adult/title?media_type=${title.media_type}&tmdb_id=${title.tmdb_id}`)
    if (revision !== adultTitleOpenRevision) return
    renderAdultTitleDetail(detail, true, revision)
  } catch (error) {
    if (revision !== adultTitleOpenRevision) return
    $('#adultTitleOverview').textContent = error.message
  }
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
    return [item.title, item.year].some(value => String(value || '').toLocaleLowerCase().includes(query))
  })
  const titleCompare = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })
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
    if (adultViewingTab === 'up-next') return Number(a.up_next_rank || 999999) - Number(b.up_next_rank || 999999)
    return recent(b) - recent(a)
  })
}

function renderAdultViewing() {
  return preservePortalPosition(renderAdultViewingList)
}

function renderAdultViewingList() {
  const labels = {
    'up-next': ['Your chosen order', 'Up Next'],
    watchlist: ['Unseen and saved for later', 'Watchlist'],
    watching: ['In progress', 'Watching'],
    'part-watched': ['Some episodes seen', 'Part Watched'],
    history: ['Everything you have seen', 'Watched'],
  }
  const [kicker, heading] = labels[adultViewingTab]
  $('#adultViewingKicker').textContent = kicker
  $('#adultViewingHeading').textContent = heading
  const recentOption = $('#adultViewingSort')?.querySelector('option[value="recent"]')
  if (recentOption) recentOption.textContent = adultViewingTab === 'up-next' ? 'Queue order' : 'Recently added'
  const values = adultViewingItems()
  $('#adultViewingCount').textContent = `${values.length} title${values.length === 1 ? '' : 's'}`
  const target = $('#adultViewingGrid')
  target.classList.toggle('is-grid', adultViewingLayout === 'grid')
  target.classList.toggle('is-list', adultViewingLayout === 'list')
  $$('[data-viewing-layout]').forEach(button => {
    const active = button.dataset.viewingLayout === adultViewingLayout
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  const root = document.createElement('div')
  values.forEach((item, index) => {
    const row = document.createElement('article'); row.className = 'adult-viewing-row'
    row.dataset.viewingKey = `${item.media_type}:${item.tmdb_id}`
    const posterUrl = adultViewingPosterUrl(item)
    const art = posterUrl ? document.createElement('img') : document.createElement('span')
    if (posterUrl) { art.src = posterUrl; art.alt = '' } else {
      art.className = 'adult-viewing-placeholder'
      art.append(librarySignalIcon(item.media_type === 'tv' ? 'signal-tv' : 'signal-film'))
    }
    const copy = document.createElement('span'); copy.className = 'adult-viewing-copy'
    const title = document.createElement('strong'); title.textContent = item.title || 'Untitled'
    const watchedEpisodes = Object.values(item.episodes || {})
      .filter(episode => episode?.watched === true).length
    const localNext = item.local?.next_episode
    const filmProgress = item.media_type === 'movie'
      ? Number(item.local_progress?.position || 0) : 0
    const seriesStatus = item.media_type === 'tv' && item.series_watching && localNext
      ? `Next · S${String(localNext.season).padStart(2, '0')} E${String(localNext.episode).padStart(2, '0')}`
      : item.media_type === 'tv' ? watchedEpisodes
        ? `${watchedEpisodes} episode${watchedEpisodes === 1 ? '' : 's'} watched` : 'TV series'
        : filmProgress > 0 ? `Continue · ${watchTimeLabel(filmProgress)}` : 'Film'
    const meta = document.createElement('span'); meta.textContent = [item.year,
      seriesStatus,
      item.on_mabeltv ? 'On MabelTV' : 'Streaming'].filter(Boolean).join(' · ')
    copy.append(title, meta)
    const actions = document.createElement('span'); actions.className = 'adult-viewing-row-actions'
    if (adultViewingTab === 'up-next') {
      ;[['move_up', 'signal-chevron-up', 'Move earlier'], ['move_down', 'signal-chevron-down', 'Move later']].forEach(([action, icon, label]) => {
        const move = document.createElement('button'); move.type = 'button'; move.setAttribute('aria-label', `${label}: ${item.title}`); move.append(librarySignalIcon(icon)); move.disabled = action === 'move_up' ? index === 0 : index === values.length - 1
        move.onclick = async event => { event.stopPropagation(); await updateAdultViewing(item, action) }
        actions.append(move)
      })
    } else {
      const open = document.createElement('button'); open.type = 'button'; open.className = 'adult-viewing-row-open'; open.setAttribute('aria-label', `Open ${item.title}`); open.append(librarySignalIcon('signal-chevron-right')); open.onclick = () => openAdultTitle(item); actions.append(open)
    }
    const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'adult-viewing-card-open'; opener.setAttribute('aria-label', `Open ${item.title}`); opener.append(art, copy); opener.onclick = () => openAdultTitle(item)
    row.append(opener, actions); root.append(row)
  })
  if (!values.length) root.innerHTML = `<div class="watch-empty"><strong>Nothing in ${heading} yet</strong><br>Add titles from search and they will appear here.</div>`
  target.replaceChildren(...root.childNodes)
}

async function loadAdultViewing() {
  adultViewingData = await api('/api/adult/viewing')
  adultViewingLoaded = true
  renderAdultViewing()
  renderAdultSeries(watchSearchText)
}

$('#watchSearch')?.addEventListener('input', scheduleAdultDiscovery)
$('#watchSearch')?.addEventListener('focus', () => { syncAdultSearchMode(true); scheduleAdultDiscovery() })
$('#watchSearch')?.addEventListener('blur', () => setTimeout(() => syncAdultSearchMode(), 0))
$('#watchSearch')?.addEventListener('change', () => setTimeout(syncAdultSearchKeyboard, 60))
$('#watchSearch')?.addEventListener('search', () => setTimeout(syncAdultSearchKeyboard, 60))
$('#watchSearch')?.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  event.currentTarget.value = ''
  event.currentTarget.dispatchEvent(new Event('input', { bubbles: true }))
  event.currentTarget.blur()
})
$('#watchSearchClear')?.addEventListener('click', () => setTimeout(() => { searchAdultDiscovery(''); syncAdultSearchMode(true) }, 0))
window.visualViewport?.addEventListener('resize', () =>
  setTimeout(syncAdultSearchKeyboard, 60))
window.addEventListener('orientationchange', () => setTimeout(() => {
  adultSearchViewportBaseline = window.visualViewport?.height || window.innerHeight
  adultSearchKeyboardWasOpen = false
}, 400))
$('#adultMyViewing')?.addEventListener('click', () => {
  history.replaceState({ consolidatedWatch: true }, '', '#watch')
  history.pushState({ adultViewing: true }, '', '#adult-viewing')
  openView('adult-viewing')
})
$('#adultViewingBack')?.addEventListener('click', () => {
  if (history.state?.adultViewing) { history.back(); return }
  remoteKind = 'adult'
  renderRemoteViewing()
  history.replaceState({ consolidatedWatch: true }, '', '#watch')
  openView('watch', { instantScroll: true })
})
function closeAdultTitleSheet() {
  adultTitleOpenRevision += 1
  selectedAdultTitle = null
  portalSheets.dismiss($('#adultTitleSheet'))
}
$('#adultTitleClose')?.addEventListener('click', closeAdultTitleSheet)
$('#adultTitleSheet')?.addEventListener('click', event => { if (event.target === $('#adultTitleSheet')) closeAdultTitleSheet() })
function closeAdultTitleSeasonSheet() {
  adultSeasonOpenRevision += 1
  portalSheets.close($('#adultTitleSeasonSheet'))
}
$('#adultTitleSeasonClose')?.addEventListener('click', closeAdultTitleSeasonSheet)
$('#adultTitleSeasonSheet')?.addEventListener('click', event => { if (event.target === $('#adultTitleSeasonSheet')) closeAdultTitleSeasonSheet() })
$('#adultTitleSeasonSheet')?.addEventListener('cancel', event => { event.preventDefault(); closeAdultTitleSeasonSheet() })
$('#adultNetflixLaunchClose')?.addEventListener('click', closeNetflixLaunchChoice)
$('#adultNetflixLaunchSheet')?.addEventListener('click', event => { if (event.target === $('#adultNetflixLaunchSheet')) closeNetflixLaunchChoice() })
$('#adultNetflixLaunchDevice')?.addEventListener('click', launchNetflixOnDevice)
$('#adultNetflixLaunchTv')?.addEventListener('click', () => { void launchNetflixOnTv() })
function closeAdultEpisodeLaunchSheet() {
  portalSheets.dismiss($('#adultEpisodeLaunchSheet'))
}
$('#adultEpisodeLaunchClose')?.addEventListener('click', closeAdultEpisodeLaunchSheet)
$('#adultEpisodeLaunchSheet')?.addEventListener('click', event => {
  if (event.target === $('#adultEpisodeLaunchSheet')) closeAdultEpisodeLaunchSheet()
})
$$('[data-viewing-tab]').forEach(button => button.onclick = () => { adultViewingTab = button.dataset.viewingTab; $$('[data-viewing-tab]').forEach(value => value.classList.toggle('active', value === button)); renderAdultViewing() })
$('#adultViewingFilter')?.addEventListener('change', event => { adultViewingFilter = event.currentTarget.value; renderAdultViewing() })
$('#adultViewingSort')?.addEventListener('change', event => { adultViewingSort = event.currentTarget.value; renderAdultViewing() })
$('#adultViewingSearch')?.addEventListener('input', event => {
  adultViewingSearch = event.currentTarget.value
  $('#adultViewingSearchClear')?.classList.toggle('hidden', !adultViewingSearch)
  renderAdultViewing()
})
$('#adultViewingSearchClear')?.addEventListener('click', () => {
  const search = $('#adultViewingSearch')
  search.value = ''
  search.dispatchEvent(new Event('input', { bubbles: true }))
  search.focus()
})
$$('[data-viewing-layout]').forEach(button => button.onclick = () => {
  adultViewingLayout = button.dataset.viewingLayout
  try { localStorage.setItem('mabeltv-adult-viewing-layout', adultViewingLayout) } catch (_) {}
  renderAdultViewing()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash === '#adult-viewing') loadAdultViewing().catch(() => {})
})
