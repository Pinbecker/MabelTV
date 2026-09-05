'use strict'

function adultTitleIntentAction(detail, button, request) {
  return async () => {
    if (button.disabled) return
    button.disabled = true
    try {
      const { action, extra = {} } = request()
      detail.viewing = await updateAdultViewing(detail, action, extra)
      syncAdultTitleButtons(detail)
      syncAdultTitleNextEpisode(detail)
      if (action === 'watchlist') notice(detail.viewing.watchlisted
        ? 'Added to Watchlist.' : 'Removed from Watchlist.')
      else if (action === 'rewatch') notice(detail.viewing.rewatch
        ? 'Added to Rewatch.' : 'Removed from Rewatch.')
      else if (action === 'up_next') notice(detail.viewing.up_next
        ? 'Added to Up Next.' : 'Removed from Up Next.')
      else if (action === 'watching') notice(detail.viewing.series_watching
        ? 'Series added to Watching and Up Next.' : 'Series removed from Watching.')
      else if (action === 'watched') notice('Marked watched and removed from Watchlist and Up Next.')
      else if (action === 'not_watched') notice('Corrected. Its watched-history record is retained.')
    } catch (error) {
      showError(error)
    } finally {
      button.disabled = false
    }
  }
}

function renderAdultTitleDetail(detail, refreshProviders = true,
                                revision = adultTitleOpenRevision) {
  selectedAdultTitle = detail
  const sheet = $('#adultTitleSheet')
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
  const manageLocal = $('#adultTitleManageLocal')
  manageLocal.classList.toggle('hidden', detail.local?.kind !== 'series')
  manageLocal.onclick = detail.local?.kind === 'series'
    ? () => manageLocalAdultSeries(detail) : null
  syncAdultTitleButtons(detail)
  const watchlist = $('#adultTitleWatchlist')
  const rewatch = $('#adultTitleRewatch')
  const upNext = $('#adultTitleUpNext')
  const watching = $('#adultTitleWatching')
  const watched = $('#adultTitleWatched')
  watchlist.onclick = () => {
    const status = adultTitleViewingStatus(detail.viewing, detail)
    if (status.inProgress && !detail.viewing?.watchlisted) {
      notice('This series is already in progress. Continue it from Watching or Up Next.', true)
      return
    }
    if (status.completed && !detail.viewing?.watchlisted) {
      notice('You have already seen this. Add it to Rewatch instead.', true)
      return
    }
    adultTitleIntentAction(detail, watchlist, () => ({
      action: 'watchlist', extra: { enabled: !detail.viewing?.watchlisted },
    }))()
  }
  rewatch.onclick = () => {
    if (!adultTitleViewingStatus(detail.viewing, detail).completed && !detail.viewing?.rewatch) {
      notice('Mark this watched before adding it to Rewatch.', true)
      return
    }
    adultTitleIntentAction(detail, rewatch, () => ({
      action: 'rewatch', extra: { enabled: !detail.viewing?.rewatch },
    }))()
  }
  upNext.onclick = adultTitleIntentAction(detail, upNext, () => ({
    action: 'up_next', extra: { enabled: !detail.viewing?.up_next },
  }))
  watching.onclick = adultTitleIntentAction(detail, watching, () => ({
    action: 'watching', extra: {
      enabled: !detail.viewing?.series_watching,
      mode: (detail.viewing?.rewatch === true
        || ((detail.seasons || []).length > 0 && (detail.seasons || []).every(season =>
          Number(season.watched_count || 0) >= Number(season.episodes || 0))))
        ? 'rewatch' : 'first_watch',
    },
  }))
  watched.onclick = adultTitleIntentAction(detail, watched, () => ({
    action: detail.viewing?.manual_state === 'watched' ? 'not_watched' : 'watched',
  }))
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
  $('#adultTitleManageLocal').classList.add('hidden')
  $('#adultProviderList').innerHTML = '<p>Loading…</p>'
  ;['#adultTitleWatchlist', '#adultTitleRewatch', '#adultTitleUpNext',
    '#adultTitleWatching', '#adultTitleWatched'].forEach(selector => {
    const button = $(selector)
    button.classList.remove('active', 'is-unavailable', 'is-progress')
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
  return items.filter(item => {
    const watchedEpisodes = Object.values(item.episodes || {})
      .filter(episode => episode?.watched === true).length
    if (adultViewingTab === 'up-next' && !item.up_next) return false
    if (adultViewingTab === 'watchlist' && !item.watchlisted) return false
    if (adultViewingTab === 'rewatch' && !item.rewatch) return false
    if (adultViewingTab === 'watching') {
      if (item.media_type === 'tv' && item.series_watching !== true) return false
      if (item.media_type === 'movie' && Number(item.local_progress?.position || 0) <= 0) return false
    }
    if (adultViewingTab === 'history' && item.manual_state !== 'watched'
        && !(item.history || []).length && !watchedEpisodes) return false
    if (adultViewingFilter === 'movie' || adultViewingFilter === 'tv') return item.media_type === adultViewingFilter
    if (adultViewingFilter === 'local') return item.on_mabeltv
    return true
  }).sort((a, b) => adultViewingTab === 'up-next'
    ? Number(a.up_next_rank || 999999) - Number(b.up_next_rank || 999999)
    : Number(b.viewing_updated || b.updated || 0) - Number(a.viewing_updated || a.updated || 0))
}

function renderAdultViewing() {
  const labels = {
    'up-next': ['Your chosen order', 'Up Next'],
    watchlist: ['Unseen and saved for later', 'Watchlist'],
    rewatch: ['Worth enjoying again', 'Rewatch'],
    watching: ['In progress', 'Watching'],
    history: ['Everything you have seen', 'Watched'],
  }
  const [kicker, heading] = labels[adultViewingTab]
  $('#adultViewingKicker').textContent = kicker
  $('#adultViewingHeading').textContent = heading
  const values = adultViewingItems()
  $('#adultViewingCount').textContent = `${values.length} title${values.length === 1 ? '' : 's'}`
  const root = $('#adultViewingGrid'); root.replaceChildren()
  values.forEach((item, index) => {
    const row = document.createElement('article'); row.className = 'adult-viewing-row'
    const posterUrl = adultViewingPosterUrl(item)
    const art = posterUrl ? document.createElement('img') : document.createElement('span')
    if (posterUrl) { art.src = posterUrl; art.alt = '' } else art.className = 'adult-viewing-placeholder'
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
    const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'adult-viewing-copy-button'; opener.append(copy); opener.onclick = () => openAdultTitle(item)
    row.append(art, opener, actions); root.append(row)
  })
  if (!values.length) root.innerHTML = `<div class="watch-empty"><strong>Nothing in ${heading} yet</strong><br>Add titles from search and they will appear here.</div>`
}

async function loadAdultViewing() {
  adultViewingData = await api('/api/adult/viewing')
  renderAdultViewing()
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
$('#adultMyViewing')?.addEventListener('click', () => { history.pushState({ adultViewing: true }, '', '#adult-viewing'); openView('adult-viewing'); loadAdultViewing().catch(showError) })
$('#adultViewingBack')?.addEventListener('click', () => {
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
$$('[data-viewing-filter]').forEach(button => button.onclick = () => { adultViewingFilter = button.dataset.viewingFilter; $$('[data-viewing-filter]').forEach(value => value.classList.toggle('active', value === button)); renderAdultViewing() })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash === '#adult-viewing') loadAdultViewing().catch(() => {})
})
