'use strict'

const MY_TV_SEASON_CACHE_MAX_AGE = 24 * 60 * 60 * 1000

function myTvSeasonSummary(season, watched = Number(season.watched_count || 0)) {
  const total = Number(season.episodes || 0)
  return watched ? `${watched} of ${total} watched` : `${total} episode${total === 1 ? '' : 's'}`
}

function myTvTitleLocalSeries(detail) {
  return detail.local?.kind === 'series'
    ? (library?.my_tv_series || []).find(value => value.id === detail.local.series)
      || localMyTvSeriesForTitle(detail)
    : localMyTvSeriesForTitle(detail)
}

function myTvTitleLocalSeasonEpisodes(detail, seasonNumber) {
  const series = myTvTitleLocalSeries(detail)
  return (series?.episodes || []).filter(episode =>
    Number(episode.season) === Number(seasonNumber))
}

function myTvTitleSeasonAvailability(detail, season) {
  const local = myTvTitleLocalSeasonEpisodes(detail, season.number).length
  const total = Number(season.episodes || 0)
  return local ? `${local} of ${total} on ${tvName()}` : `Not on ${tvName()}`
}

function renderMyTvTitleSeasonHeader(detail, season, episodeCount = Number(season.episodes || 0),
  watchedCount = Number(season.watched_count || 0)) {
  const localCount = myTvTitleLocalSeasonEpisodes(detail, season.number).length
  renderMyTvSeriesHeaderFacts($('#myTvTitleSeasonMeta'), [
    { label: 'Episodes', value: String(episodeCount) },
    { label: `On ${tvName()}`, value: String(localCount) },
    { label: 'Watched', value: String(watchedCount) },
  ])
}

function myTvStreamingArtwork(detail, season, result = null, className = 'my-tv-season-card-art') {
  const art = document.createElement('span')
  art.className = className
  const still = (result?.episodes || []).find(episode => episode.still_path)?.still_path
  const path = still || season.poster_path || result?.poster_path
    || detail.backdrop_path || detail.poster_path
  if (path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = myTvPosterUrl(path, still || path === detail.backdrop_path ? 'w780' : 'w500')
    image.alt = ''
    image.loading = 'lazy'
    art.append(image)
  } else {
    const placeholder = document.createElement('span')
    placeholder.className = 'watch-card-placeholder'
    placeholder.textContent = String(season.number || 1)
    art.append(placeholder)
  }
  return art
}

function syncMyTvStreamingSeasonCard(card, season, detail) {
  const total = Number(season.episodes || 0)
  const watched = Number(season.watched_count || 0)
  card.querySelector('.my-tv-season-card-copy small').textContent =
    `${myTvTitleSeasonAvailability(detail, season)} · Open series`
  card.querySelector('.my-tv-season-card-progress').style.setProperty(
    '--season-progress', `${total ? watched / total * 100 : 0}%`)
  card.querySelector('.my-tv-season-status')?.syncSeasonStatus(watched, total)
}

function deriveMyTvTitleNextEpisode(detail) {
  if (detail.media_type !== 'tv') return null
  const states = detail.viewing?.episodes || {}
  const localSeries = detail.local?.kind === 'series'
    ? (library?.my_tv_series || []).find(value => value.id === detail.local.series) : null
  const available = []
  ;[...(detail.seasons || [])].sort((a, b) => a.number - b.number).forEach(season => {
    for (let episode = 1; episode <= Number(season.episodes || 0); episode += 1) {
      const local = (localSeries?.episodes || []).find(value =>
        Number(value.season) === Number(season.number)
          && Number(value.episode) === episode)
      available.push({
        season: season.number, episode, title: '',
        watched: states[`${season.number}:${episode}`]?.watched === true
          || local?.watched === true,
      })
    }
  })
  let lastWatched = -1
  available.forEach((episode, index) => {
    if (episode.watched) lastWatched = index
  })
  return available[lastWatched + 1] || null
}

function myTvEpisodeAirDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`
}

function findLocalMyTvEpisode(detail, seasonNumber, episodeNumber) {
  if (detail.local?.kind !== 'series') return null
  const series = (library?.my_tv_series || []).find(value => value.id === detail.local.series)
  if (!series) return null
  const episode = (series.episodes || []).find(value =>
    Number(value.season) === Number(seasonNumber)
      && Number(value.episode) === Number(episodeNumber))
  return episode ? { series, episode } : null
}

function restoreMyTvTitleSheet(detail, returnTo = null) {
  const sheet = $('#myTvTitleSheet')
  portalSheets.open(sheet, { returnTo, focus: sheet.querySelector('.watch-film-panel') })
  renderMyTvTitleDetail(detail, false)
}

function openMyTvTrackedSeasonRestartSheet(detail, season, returnTo) {
  myTvSeriesRestartTarget = {
    viewingTitle: detail,
    viewingSeason: season,
    scope: 'tracked-season',
    season: Number(season.number),
    episodeCount: Number(season.episodes || 0),
    returnTo,
  }
  $('#myTvSeriesRestartTitle').textContent = `Restart Series ${season.number}?`
  $('#myTvSeriesRestartDescription').textContent =
    'This clears every watched mark you have tracked for this series.'
  $('#myTvSeriesRestartTarget').textContent = `${detail.title} · Series ${season.number}`
  portalSheets.open($('#myTvSeriesRestartSheet'), { returnTo })
}

async function openMyTvEpisodeDestination(detail, season, episode, seasonCard = null) {
  const local = findLocalMyTvEpisode(detail, season.number, episode.number)
  if (local) {
    const titleSheet = $('#myTvTitleSheet')
    const titleReturnTo = portalSheets.returnTo(titleSheet)
    portalSheets.dismiss($('#myTvEpisodeLaunchSheet'))
    portalSheets.suspend(seasonCard ? $('#myTvTitleSeasonSheet') : titleSheet)
    openMyTvEpisodeSheet(local.series, local.episode, () => {
      if (seasonCard) openMyTvTitleSeason(detail, season, seasonCard, episode.number)
      else restoreMyTvTitleSheet(detail, titleReturnTo)
    })
    return
  }
  const sheet = $('#myTvEpisodeLaunchSheet')
  const root = $('#myTvEpisodeProviderList')
  $('#myTvEpisodeLaunchEyebrow').textContent = `${detail.title} · Series ${season.number}, Episode ${episode.number}`
  $('#myTvEpisodeLaunchTitle').textContent = episode.name || `Episode ${episode.number}`
  $('#myTvEpisodeLaunchCopy').textContent = 'Choose a service. It may open the series page rather than this exact episode.'
  root.innerHTML = '<p>Checking streaming destinations…</p>'
  portalSheets.open(sheet)
  const closeBeforeLaunch = () => portalSheets.dismiss(sheet)
  if (!myTvAvailabilityEnabled()) {
    renderMyTvAvailabilityDisabled(root, detail, { localAction: null })
    return
  }
  if (detail.provider_result) {
    renderMyTvProviderLinksInto(root, detail, detail.provider_result, {
      localAction: null, beforeLaunch: closeBeforeLaunch,
    })
    return
  }
  try {
    const result = await api(`/api/my-tv/providers?media_type=${detail.media_type}&tmdb_id=${detail.tmdb_id}`)
    detail.provider_result = result
    if (!sheet.open) return
    renderMyTvProviderLinksInto(root, detail, result, {
      localAction: null, beforeLaunch: closeBeforeLaunch,
    })
  } catch (error) {
    if (!sheet.open) return
    renderMyTvProviderLinksInto(root, detail, { sources: [] }, { localAction: null })
    const message = document.createElement('p')
    message.textContent = error.message || 'Streaming destinations are unavailable right now.'
    root.append(message)
  }
}

function syncMyTvTitleNextEpisode(detail) {
  const button = $('#myTvTitleNextEpisode')
  const next = deriveMyTvTitleNextEpisode(detail)
  detail.next_episode = next
  button.classList.toggle('hidden', !next)
  if (!next) return
  button.querySelector('small').textContent = 'Next episode'
  button.querySelector('strong').textContent = `Series ${next.season}, Episode ${next.episode}${next.title ? ` · ${next.title}` : ''}`
  button.onclick = () => {
    const season = (detail.seasons || []).find(value => value.number === next.season)
      || { number: next.season, episodes: 0 }
    void openMyTvEpisodeDestination(detail, season, {
      number: next.episode, name: next.title || `Episode ${next.episode}`,
    })
  }
}

async function syncMyTvTitleEpisodeStatus(detail) {
  const totals = (detail.seasons || []).reduce((result, season) => ({
    watched: result.watched + Number(season.watched_count || 0),
    episodes: result.episodes + Number(season.episodes || 0),
  }), { watched: 0, episodes: 0 })
  if (!totals.episodes) return
  const action = totals.watched >= totals.episodes ? 'watched'
    : totals.watched > 0 ? 'part_watched' : 'not_watched'
  if (detail.viewing?.manual_state === action) return
  if (action === 'not_watched' && !['watched', 'part_watched']
    .includes(detail.viewing?.manual_state)) return
  detail.viewing = await updateMyTvViewing(detail, action)
  syncMyTvTitleButtons(detail)
}

function myTvStreamingEpisodeRow(detail, season, result, episode, card) {
  const isComplete = () => episode.watched
  const row = document.createElement('article')
  row.className = `my-tv-series-episode my-tv-streaming-episode${isComplete() ? ' is-watched' : ''}`
  row.dataset.episode = String(episode.number)
  if (!detail.catalogue_only) {
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    row.setAttribute('aria-label', `Open ${episode.name || `episode ${episode.number}`}`)
    row.onclick = event => {
      if (event.detail > 0) row.blur()
      void openMyTvEpisodeDestination(detail, season, episode, card)
    }
    row.onkeydown = event => {
      if (event.target !== row || !['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      void openMyTvEpisodeDestination(detail, season, episode, card)
    }
  }
  const artwork = document.createElement('span')
  artwork.className = 'my-tv-series-episode-art'
  if (episode.still_path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = myTvPosterUrl(episode.still_path, 'w500')
    image.alt = ''
    image.loading = 'lazy'
    artwork.append(image)
  }
  const number = document.createElement('span')
  number.className = 'my-tv-series-episode-number'
  number.textContent = `E${String(episode.number).padStart(2, '0')}`
  artwork.append(number)
  const copy = document.createElement('span')
  copy.className = 'my-tv-series-episode-copy'
  const title = document.createElement('strong')
  title.textContent = episode.name
  const local = findLocalMyTvEpisode(detail, season.number, episode.number)
  const availability = document.createElement('span')
  availability.className = 'my-tv-episode-availability'
  availability.textContent = `On ${tvName()}`
  availability.classList.toggle('hidden', !local)
  const meta = document.createElement('small')
  copy.append(title, availability, meta)
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'my-tv-streaming-episode-toggle'
  const sync = () => {
    const complete = isComplete()
    const facts = [myTvEpisodeAirDate(episode.air_date),
      episode.runtime ? `${episode.runtime} min` : ''].filter(Boolean)
    meta.textContent = facts.join(' · ')
    row.classList.toggle('is-watched', complete)
    toggle.classList.toggle('active', complete)
    toggle.setAttribute('aria-pressed', String(complete))
    toggle.setAttribute('aria-label', `${complete ? 'Mark unwatched' : 'Mark watched'}: ${episode.name}`)
    toggle.textContent = complete ? 'Watched' : 'Mark watched'
  }
  sync()
  toggle.onclick = async event => {
    event.stopPropagation()
    const next = !isComplete()
    const previous = episode.watched
    const applyEpisodeState = watched => {
      episode.watched = watched
      const local = findLocalMyTvEpisode(detail, season.number, episode.number)
      if (local) local.episode.watched = watched
      const statusCount = result.episodes.filter(value => value.watched).length
      season.watched_count = statusCount
      sync()
      syncMyTvStreamingSeasonCard(card, season, detail)
      $('#myTvTitleSeasonWatched').syncSeasonStatus(statusCount, result.episodes.length)
      renderMyTvTitleSeasonHeader(detail, season, result.episodes.length, statusCount)
      syncMyTvTitleNextEpisode(detail)
    }
    applyEpisodeState(next)
    try {
      detail.viewing = await updateMyTvViewing(detail, 'episode_watched', {
        season: season.number, episode: episode.number, watched: next,
      })
      await syncMyTvTitleEpisodeStatus(detail)
    } catch (error) {
      applyEpisodeState(previous)
      showError(error)
    }
  }
  row.append(artwork, copy, toggle)
  return row
}

async function ensureMyTvTitleSeasonStorage(detail, season) {
  let series = myTvTitleLocalSeries(detail)
  if (!series) {
    await api('/api/manage', { method: 'POST', body: JSON.stringify({
      action: 'create-my-tv-series', name: detail.title,
    }) })
    await reloadLibraryWithoutLosingPlace()
    series = localMyTvSeriesForTitle(detail) || (library?.my_tv_series || []).find(value =>
      value.stored_title?.toLocaleLowerCase() === detail.title.toLocaleLowerCase()
      || value.title?.toLocaleLowerCase() === detail.title.toLocaleLowerCase())
    if (!series) throw new Error(`The ${tvName()} show could not be prepared for episodes`)
    await api('/api/tmdb/my-tv-series/apply', { method: 'POST', body: JSON.stringify({
      series: series.id, tmdb_id: detail.tmdb_id,
    }) })
    await reloadLibraryWithoutLosingPlace()
    series = (library?.my_tv_series || []).find(value => value.id === series.id) || series
  }
  if (!(series.seasons || []).map(Number).includes(Number(season.number))) {
    await api('/api/manage', { method: 'POST', body: JSON.stringify({
      action: 'create-my-tv-season', series: series.id, season: season.number,
    }) })
    await reloadLibraryWithoutLosingPlace()
    series = (library?.my_tv_series || []).find(value => value.id === series.id) || series
  }
  detail.local = { kind: 'series', series: series.id,
    watched_count: Number(series.watched_count || 0) }
  detail.on_mabeltv = (series.episodes || []).length > 0
  return series
}

function configureMyTvTitleSeasonManagement(detail, season, card) {
  const localSeries = myTvTitleLocalSeries(detail)
  const localEpisodes = myTvTitleLocalSeasonEpisodes(detail, season.number)
  // Empty folders can be prepared when an upload flow is opened and then
  // cancelled. They are storage scaffolding, not a local series to manage.
  const localSeason = Boolean(localSeries && localEpisodes.length)
  const trackedSeason = Number(season.watched_count || 0) > 0
    || Object.entries(detail.viewing?.episodes || {}).some(([key, value]) =>
      key.startsWith(`${Number(season.number)}:`) && value?.watched === true)
  const upload = $('#myTvTitleSeasonUpload')
  const settingsSheet = $('#myTvTitleSeasonSettingsSheet')
  $('#myTvTitleSeasonSettings').classList.toggle('hidden', detail.catalogue_only === true)
  $('#myTvTitleSeasonSettingsEyebrow').textContent = `${detail.title} · Series ${season.number}`
  $('#myTvTitleSeasonSettings').onclick = () => {
    configureMyTvTitleSeasonManagement(detail, season, card)
    portalSheets.suspend($('#myTvTitleSeasonSheet'))
    portalSheets.open(settingsSheet, {
      returnTo: () => openMyTvTitleSeason(detail, season, card),
    })
  }
  upload.disabled = false
  $('#myTvTitleSeasonUploadHint').textContent = localEpisodes.length
    ? `Add more episodes to Series ${season.number}` : `Add Series ${season.number} episodes to ${tvName()}`
  upload.onclick = async () => {
    if (upload.disabled) return
    upload.disabled = true
    try {
      portalSheets.dismiss(settingsSheet)
      const series = await ensureMyTvTitleSeasonStorage(detail, season)
      const returnTo = () => openMyTvTitleSeason(detail, season, card)
      openMyTvSeriesUpload(series, season.number,
        !myTvTitleLocalSeasonEpisodes(detail, season.number).length, {
          returnTo,
          successReturn: () => {
            const refreshed = (library?.my_tv_series || []).find(value => value.id === series.id) || series
            detail.local = { kind: 'series', series: refreshed.id,
              watched_count: Number(refreshed.watched_count || 0) }
            detail.on_mabeltv = (refreshed.episodes || []).length > 0
            openMyTvTitleSeason(detail, season, card)
          },
        })
    } catch (error) {
      showError(error)
      upload.disabled = false
    }
  }
  const metadata = $('#myTvTitleSeasonMetadata')
  const restart = $('#myTvTitleSeasonRestart')
  const remove = $('#myTvTitleSeasonDelete')
  ;[metadata, remove].forEach(button => button.classList.toggle('hidden', !localSeason))
  restart.classList.toggle('hidden', !localSeason && !trackedSeason)
  metadata.disabled = !tmdbConfigured
  metadata.onclick = localSeason && tmdbConfigured ? async () => {
    metadata.disabled = true
    try {
      portalSheets.dismiss(settingsSheet)
      await api('/api/tmdb/my-tv-series/apply', { method: 'POST', body: JSON.stringify({
        series: localSeries.id, tmdb_id: detail.tmdb_id,
      }) })
      await reloadLibraryWithoutLosingPlace()
      portalSheets.dismiss($('#myTvTitleSeasonSheet'))
      openMyTvTitleSeason(detail, season, card)
    } catch (error) { showError(error) } finally { metadata.disabled = false }
  } : null
  restart.onclick = localSeason || trackedSeason ? () => {
    portalSheets.dismiss(settingsSheet)
    portalSheets.dismiss($('#myTvTitleSeasonSheet'))
    const returnTo = () => openMyTvTitleSeason(detail, season, card)
    if (localSeason) openMyTvSeriesRestartSheet(localSeries, season.number, returnTo)
    else openMyTvTrackedSeasonRestartSheet(detail, season, returnTo)
  } : null
  remove.onclick = localSeason ? async () => {
    if (!confirm(`Remove every local episode in Series ${season.number} of “${detail.title}” from ${tvName()}?`)) return
    remove.disabled = true
    try {
      portalSheets.dismiss(settingsSheet)
      await api('/api/manage', { method: 'POST', body: JSON.stringify({
        action: 'trash-my-tv-series', series: localSeries.id,
        scope: 'season', season: season.number,
      }) })
      await reloadLibraryWithoutLosingPlace()
      const refreshed = (library?.my_tv_series || []).find(value => value.id === localSeries.id)
      detail.local = refreshed ? { kind: 'series', series: refreshed.id,
        watched_count: Number(refreshed.watched_count || 0) } : null
      detail.on_mabeltv = Boolean((refreshed?.episodes || []).length)
      portalSheets.dismiss($('#myTvTitleSeasonSheet'))
      openMyTvTitleSeason(detail, season, card)
    } catch (error) { showError(error) } finally { remove.disabled = false }
  } : null
}

function myTvTitleSeasonCacheKey(detail, season) {
  return `my-tv-season-v1:${Number(detail.tmdb_id)}:${Number(season.number)}`
}

function myTvTitleSeasonCurrentResult(detail, season, result) {
  const viewing = myTvViewingRecord(detail)
  const episodeStates = viewing?.episodes && typeof viewing.episodes === 'object'
    ? viewing.episodes : null
  const localEpisodes = new Map(myTvTitleLocalSeasonEpisodes(detail, season.number)
    .map(episode => [Number(episode.episode), episode]))
  return {
    ...result,
    episodes: (result?.episodes || []).map(episode => {
      const saved = episodeStates?.[`${season.number}:${episode.number}`]
      return {
        ...episode,
        watched: (episodeStates ? saved?.watched === true : episode.watched === true)
          || localEpisodes.get(Number(episode.number))?.watched === true,
      }
    }),
  }
}

function renderMyTvTitleSeasonResult(detail, season, card, result, targetEpisode = 0) {
  season.watched_count = result.episodes.filter(episode => episode.watched).length
  const statusCount = season.watched_count
  renderMyTvTitleSeasonHeader(detail, season, result.episodes.length, statusCount)
  $('#myTvTitleSeasonEpisodeCount').textContent = `${result.episodes.length} total`
  const overview = $('#myTvTitleSeasonOverview')
  overview.textContent = result.overview || season.overview || ''
  overview.classList.toggle('hidden', !overview.textContent)
  $('#myTvTitleSeasonArtwork').replaceChildren(myTvStreamingArtwork(
    detail, season, result, 'my-tv-season-sheet-artwork'))
  const root = $('#myTvTitleSeasonEpisodes')
  root.replaceChildren(...result.episodes.map(episode =>
    myTvStreamingEpisodeRow(detail, season, result, episode, card)))
  if (!result.episodes.length) root.replaceChildren(portalEmptyState({
    className: 'my-tv-series-empty',
    title: 'No episodes found',
    message: 'TMDB has no episode details for this series yet.',
    messageTag: 'span',
  }))
  wireMyTvSeasonBulkButton($('#myTvTitleSeasonWatched'), `Series ${season.number}`,
    statusCount, result.episodes.length, async targetWatched => {
      const previous = result.episodes.map(episode => episode.watched)
      result.episodes.forEach(episode => { episode.watched = targetWatched })
      season.watched_count = targetWatched ? result.episodes.length : 0
      syncMyTvStreamingSeasonCard(card, season, detail)
      syncMyTvTitleNextEpisode(detail)
      try {
        detail.viewing = await updateMyTvViewing(detail, 'season_watched', {
          season: season.number, episode_count: result.episodes.length,
          watched: targetWatched,
        })
        if (detail.local?.kind === 'series') {
          const localSeries = (library?.my_tv_series || []).find(value =>
            value.id === detail.local.series)
          ;(localSeries?.episodes || []).filter(episode =>
            Number(episode.season) === Number(season.number))
            .forEach(episode => { episode.watched = targetWatched })
        }
        await syncMyTvTitleEpisodeStatus(detail)
        portalSheets.close($('#myTvTitleSeasonSheet'), { restore: false })
        openMyTvTitleSeason(detail, season, card, targetEpisode)
        return targetWatched ? result.episodes.length : 0
      } catch (error) {
        result.episodes.forEach((episode, index) => { episode.watched = previous[index] })
        season.watched_count = previous.filter(Boolean).length
        syncMyTvStreamingSeasonCard(card, season, detail)
        syncMyTvTitleNextEpisode(detail)
        throw error
      }
    })
  $('#myTvTitleSeasonWatched').disabled = false
  syncMyTvStreamingSeasonCard(card, season, detail)
  if (targetEpisode) {
    const target = root.querySelector(`[data-episode="${targetEpisode}"]`)
    target?.classList.add('is-next')
    requestAnimationFrame(() => target?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }
}

async function openMyTvTitleSeason(detail, season, card, targetEpisode = 0) {
  const revision = ++myTvSeasonOpenRevision
  const titleSheet = $('#myTvTitleSheet')
  const seasonSheet = $('#myTvTitleSeasonSheet')
  const titleReturnTo = portalSheets.returnTo(titleSheet)
  seasonSheet.classList.toggle('is-catalogue-only', detail.catalogue_only === true)
  portalSheets.suspend(titleSheet, { card: true })
  $('#myTvTitleSeasonEyebrow').textContent = detail.title
  $('#myTvTitleSeasonName').textContent = `Series ${season.number}`
  renderMyTvTitleSeasonHeader(detail, season)
  $('#myTvTitleSeasonEpisodeHeading').textContent = `Series ${season.number} episodes`
  $('#myTvTitleSeasonEpisodeCount').textContent = `${Number(season.episodes || 0)} total`
  $('#myTvTitleSeasonOverview').classList.add('hidden')
  $('#myTvTitleSeasonArtwork').replaceChildren(myTvStreamingArtwork(
    detail, season, null, 'my-tv-season-sheet-artwork'))
  const bulk = $('#myTvTitleSeasonWatched')
  bulk.disabled = true
  bulk.replaceChildren(librarySignalIcon('signal-check'),
    Object.assign(document.createElement('span'), { textContent: 'Loading series status…' }))
  const root = $('#myTvTitleSeasonEpisodes')
  root.replaceChildren(portalEmptyState({
    className: 'my-tv-series-empty',
    title: 'Loading episodes…',
    message: 'Fetching episode details and artwork.',
    messageTag: 'span',
  }))
  portalSheets.open(seasonSheet, {
    returnTo: () => {
      restoreMyTvTitleSheet(detail, titleReturnTo)
    },
  })
  configureMyTvTitleSeasonManagement(detail, season, card)
  const cacheKey = myTvTitleSeasonCacheKey(detail, season)
  let displayed = null
  try {
    const cached = await readPortalDataCache(cacheKey)
    if (revision !== myTvSeasonOpenRevision) return
    if (cached) {
      displayed = myTvTitleSeasonCurrentResult(detail, season, cached.data)
      renderMyTvTitleSeasonResult(detail, season, card, displayed, targetEpisode)
      if (Date.now() - cached.saved_at < MY_TV_SEASON_CACHE_MAX_AGE) return
    }
    const result = await api(`/api/my-tv/season?tmdb_id=${detail.tmdb_id}&season=${season.number}`)
    if (revision !== myTvSeasonOpenRevision) return
    const fresh = myTvTitleSeasonCurrentResult(detail, season, result)
    if (!displayed) {
      renderMyTvTitleSeasonResult(detail, season, card, fresh, targetEpisode)
    }
    await writePortalDataCache(cacheKey, result)
  } catch (error) {
    if (revision !== myTvSeasonOpenRevision) return
    if (displayed) return
    root.replaceChildren(portalEmptyState({
      className: 'my-tv-series-empty',
      title: 'Episodes unavailable',
      message: error.message,
      messageTag: 'span',
    }))
  }
}

function renderMyTvTitleSeasons(detail) {
  const wrapper = $('#myTvTitleSeriesLibrary')
  wrapper.classList.remove('is-loading-placeholder')
  const seasons = $('#myTvTitleSeasons')
  seasons.replaceChildren()
  const visible = detail.media_type === 'tv' && (detail.seasons || []).length
  wrapper.classList.toggle('hidden', !visible)
  if (!visible) return
  $('#myTvTitleSeasonCount').textContent = `${detail.seasons.length} series`
  ;(detail.seasons || []).forEach(season => {
    const card = document.createElement('article')
    card.className = 'my-tv-season-card my-tv-streaming-season-card'
    card.dataset.season = String(season.number)
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    const art = myTvStreamingArtwork(detail, season)
    const shade = document.createElement('span')
    shade.className = 'my-tv-season-card-shade'
    const copy = document.createElement('span')
    copy.className = 'my-tv-season-card-copy'
    const kicker = document.createElement('span')
    kicker.textContent = `${detail.title} · ${Number(season.episodes || 0)} episode${Number(season.episodes || 0) === 1 ? '' : 's'}`
    const heading = document.createElement('strong')
    heading.textContent = `Series ${season.number}`
    const summary = document.createElement('small')
    copy.append(kicker, heading, summary)
    const progress = document.createElement('span')
    progress.className = 'my-tv-season-card-progress'
    const openSeason = () => openMyTvTitleSeason(detail, season, card)
    card.onclick = openSeason
    card.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSeason() }
    }
    const status = document.createElement('button')
    status.type = 'button'
    wireMyTvSeasonBulkButton(status, `Series ${season.number}`,
      season.watched_count, season.episodes, async targetWatched => {
        const previous = season.watched_count
        season.watched_count = targetWatched ? Number(season.episodes || 0) : 0
        syncMyTvStreamingSeasonCard(card, season, detail)
        syncMyTvTitleNextEpisode(detail)
        try {
          detail.viewing = await updateMyTvViewing(detail, 'season_watched', {
            season: season.number, episode_count: season.episodes, watched: targetWatched,
          })
          await syncMyTvTitleEpisodeStatus(detail)
          renderMyTvTitleDetail(detail, false)
          return season.watched_count
        } catch (error) {
          season.watched_count = previous
          syncMyTvStreamingSeasonCard(card, season, detail)
          syncMyTvTitleNextEpisode(detail)
          throw error
        }
      }, true)
    card.append(art, shade, copy, progress,
      librarySignalIcon('signal-chevron-right', 'icon my-tv-season-card-chevron'), status)
    syncMyTvStreamingSeasonCard(card, season, detail)
    seasons.append(card)
  })
  syncMyTvTitleNextEpisode(detail)
}
