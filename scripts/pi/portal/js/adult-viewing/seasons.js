'use strict'

const ADULT_SEASON_CACHE_MAX_AGE = 24 * 60 * 60 * 1000

function adultSeasonSummary(season, watched = Number(season.watched_count || 0)) {
  const total = Number(season.episodes || 0)
  return watched ? `${watched} of ${total} watched` : `${total} episode${total === 1 ? '' : 's'}`
}

function adultTitleLocalSeries(detail) {
  return detail.local?.kind === 'series'
    ? (library?.adult_series || []).find(value => value.id === detail.local.series)
      || localAdultSeriesForTitle(detail)
    : localAdultSeriesForTitle(detail)
}

function adultTitleLocalSeasonEpisodes(detail, seasonNumber) {
  const series = adultTitleLocalSeries(detail)
  return (series?.episodes || []).filter(episode =>
    Number(episode.season) === Number(seasonNumber))
}

function adultTitleSeasonAvailability(detail, season) {
  const local = adultTitleLocalSeasonEpisodes(detail, season.number).length
  const total = Number(season.episodes || 0)
  return local ? `${local} of ${total} on MabelTV` : 'Not on MabelTV'
}

function renderAdultTitleSeasonHeader(detail, season, episodeCount = Number(season.episodes || 0),
  watchedCount = Number(season.watched_count || 0)) {
  const localCount = adultTitleLocalSeasonEpisodes(detail, season.number).length
  renderAdultSeriesHeaderFacts($('#adultTitleSeasonMeta'), [
    { label: 'Episodes', value: String(episodeCount) },
    { label: 'On MabelTV', value: String(localCount) },
    { label: 'Watched', value: String(watchedCount) },
  ])
}

function adultStreamingArtwork(detail, season, result = null, className = 'adult-season-card-art') {
  const art = document.createElement('span')
  art.className = className
  const still = (result?.episodes || []).find(episode => episode.still_path)?.still_path
  const path = still || season.poster_path || result?.poster_path
    || detail.backdrop_path || detail.poster_path
  if (path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = adultPosterUrl(path, still || path === detail.backdrop_path ? 'w780' : 'w500')
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

function syncAdultStreamingSeasonCard(card, season, detail) {
  const total = Number(season.episodes || 0)
  const watched = Number(season.watched_count || 0)
  card.querySelector('.adult-season-card-copy small').textContent =
    `${adultTitleSeasonAvailability(detail, season)} · Open series`
  card.querySelector('.adult-season-card-progress').style.setProperty(
    '--season-progress', `${total ? watched / total * 100 : 0}%`)
  card.querySelector('.adult-season-status')?.syncSeasonStatus(watched, total)
}

function deriveAdultTitleNextEpisode(detail) {
  if (detail.media_type !== 'tv') return null
  const states = detail.viewing?.episodes || {}
  const localSeries = detail.local?.kind === 'series'
    ? (library?.adult_series || []).find(value => value.id === detail.local.series) : null
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

function adultEpisodeAirDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`
}

function findLocalAdultEpisode(detail, seasonNumber, episodeNumber) {
  if (detail.local?.kind !== 'series') return null
  const series = (library?.adult_series || []).find(value => value.id === detail.local.series)
  if (!series) return null
  const episode = (series.episodes || []).find(value =>
    Number(value.season) === Number(seasonNumber)
      && Number(value.episode) === Number(episodeNumber))
  return episode ? { series, episode } : null
}

function restoreAdultTitleSheet(detail, returnTo = null) {
  const sheet = $('#adultTitleSheet')
  portalSheets.open(sheet, { returnTo, focus: sheet.querySelector('.watch-film-panel') })
  renderAdultTitleDetail(detail, false)
}

async function openAdultEpisodeDestination(detail, season, episode, seasonCard = null) {
  const local = findLocalAdultEpisode(detail, season.number, episode.number)
  if (local) {
    const titleSheet = $('#adultTitleSheet')
    const titleReturnTo = portalSheets.returnTo(titleSheet)
    portalSheets.dismiss($('#adultEpisodeLaunchSheet'))
    portalSheets.suspend(seasonCard ? $('#adultTitleSeasonSheet') : titleSheet)
    openAdultEpisodeSheet(local.series, local.episode, () => {
      if (seasonCard) openAdultTitleSeason(detail, season, seasonCard, episode.number)
      else restoreAdultTitleSheet(detail, titleReturnTo)
    })
    return
  }
  const sheet = $('#adultEpisodeLaunchSheet')
  const root = $('#adultEpisodeProviderList')
  $('#adultEpisodeLaunchEyebrow').textContent = `${detail.title} · Series ${season.number}, Episode ${episode.number}`
  $('#adultEpisodeLaunchTitle').textContent = episode.name || `Episode ${episode.number}`
  $('#adultEpisodeLaunchCopy').textContent = 'Choose a service. It may open the series page rather than this exact episode.'
  root.innerHTML = '<p>Checking streaming destinations…</p>'
  portalSheets.open(sheet)
  const closeBeforeLaunch = () => portalSheets.dismiss(sheet)
  if (!adultAvailabilityEnabled()) {
    renderAdultAvailabilityDisabled(root, detail, { localAction: null })
    return
  }
  if (detail.provider_result) {
    renderAdultProviderLinksInto(root, detail, detail.provider_result, {
      localAction: null, beforeLaunch: closeBeforeLaunch,
    })
    return
  }
  try {
    const result = await api(`/api/adult/providers?media_type=${detail.media_type}&tmdb_id=${detail.tmdb_id}`)
    detail.provider_result = result
    if (!sheet.open) return
    renderAdultProviderLinksInto(root, detail, result, {
      localAction: null, beforeLaunch: closeBeforeLaunch,
    })
  } catch (error) {
    if (!sheet.open) return
    renderAdultProviderLinksInto(root, detail, { sources: [] }, { localAction: null })
    const message = document.createElement('p')
    message.textContent = error.message || 'Streaming destinations are unavailable right now.'
    root.append(message)
  }
}

function syncAdultTitleNextEpisode(detail) {
  const button = $('#adultTitleNextEpisode')
  const next = deriveAdultTitleNextEpisode(detail)
  detail.next_episode = next
  button.classList.toggle('hidden', !next)
  if (!next) return
  button.querySelector('small').textContent = 'Next episode'
  button.querySelector('strong').textContent = `Series ${next.season}, Episode ${next.episode}${next.title ? ` · ${next.title}` : ''}`
  button.onclick = () => {
    const season = (detail.seasons || []).find(value => value.number === next.season)
      || { number: next.season, episodes: 0 }
    void openAdultEpisodeDestination(detail, season, {
      number: next.episode, name: next.title || `Episode ${next.episode}`,
    })
  }
}

async function syncAdultTitleEpisodeStatus(detail) {
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
  detail.viewing = await updateAdultViewing(detail, action)
  syncAdultTitleButtons(detail)
}

function adultStreamingEpisodeRow(detail, season, result, episode, card) {
  const isComplete = () => episode.watched
  const row = document.createElement('article')
  row.className = `adult-series-episode adult-streaming-episode${isComplete() ? ' is-watched' : ''}`
  row.dataset.episode = String(episode.number)
  if (!detail.catalogue_only) {
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    row.setAttribute('aria-label', `Open ${episode.name || `episode ${episode.number}`}`)
    row.onclick = event => {
      if (event.detail > 0) row.blur()
      void openAdultEpisodeDestination(detail, season, episode, card)
    }
    row.onkeydown = event => {
      if (event.target !== row || !['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      void openAdultEpisodeDestination(detail, season, episode, card)
    }
  }
  const artwork = document.createElement('span')
  artwork.className = 'adult-series-episode-art'
  if (episode.still_path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = adultPosterUrl(episode.still_path, 'w500')
    image.alt = ''
    image.loading = 'lazy'
    artwork.append(image)
  }
  const number = document.createElement('span')
  number.className = 'adult-series-episode-number'
  number.textContent = `E${String(episode.number).padStart(2, '0')}`
  artwork.append(number)
  const copy = document.createElement('span')
  copy.className = 'adult-series-episode-copy'
  const title = document.createElement('strong')
  title.textContent = episode.name
  const local = findLocalAdultEpisode(detail, season.number, episode.number)
  const availability = document.createElement('span')
  availability.className = 'adult-episode-availability'
  availability.textContent = 'On MabelTV'
  availability.classList.toggle('hidden', !local)
  const meta = document.createElement('small')
  copy.append(title, availability, meta)
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'adult-streaming-episode-toggle'
  const sync = () => {
    const complete = isComplete()
    const facts = [adultEpisodeAirDate(episode.air_date),
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
      const local = findLocalAdultEpisode(detail, season.number, episode.number)
      if (local) local.episode.watched = watched
      const statusCount = result.episodes.filter(value => value.watched).length
      season.watched_count = statusCount
      sync()
      syncAdultStreamingSeasonCard(card, season, detail)
      $('#adultTitleSeasonWatched').syncSeasonStatus(statusCount, result.episodes.length)
      renderAdultTitleSeasonHeader(detail, season, result.episodes.length, statusCount)
      syncAdultTitleNextEpisode(detail)
    }
    applyEpisodeState(next)
    try {
      detail.viewing = await updateAdultViewing(detail, 'episode_watched', {
        season: season.number, episode: episode.number, watched: next,
      })
      await syncAdultTitleEpisodeStatus(detail)
    } catch (error) {
      applyEpisodeState(previous)
      showError(error)
    }
  }
  row.append(artwork, copy, toggle)
  return row
}

async function ensureAdultTitleSeasonStorage(detail, season) {
  let series = adultTitleLocalSeries(detail)
  if (!series) {
    await api('/api/manage', { method: 'POST', body: JSON.stringify({
      action: 'create-adult-series', name: detail.title,
    }) })
    await reloadLibraryWithoutLosingPlace()
    series = localAdultSeriesForTitle(detail) || (library?.adult_series || []).find(value =>
      value.stored_title?.toLocaleLowerCase() === detail.title.toLocaleLowerCase()
      || value.title?.toLocaleLowerCase() === detail.title.toLocaleLowerCase())
    if (!series) throw new Error('The MabelTV show could not be prepared for episodes')
    await api('/api/tmdb/adult-series/apply', { method: 'POST', body: JSON.stringify({
      series: series.id, tmdb_id: detail.tmdb_id,
    }) })
    await reloadLibraryWithoutLosingPlace()
    series = (library?.adult_series || []).find(value => value.id === series.id) || series
  }
  if (!(series.seasons || []).map(Number).includes(Number(season.number))) {
    await api('/api/manage', { method: 'POST', body: JSON.stringify({
      action: 'create-adult-season', series: series.id, season: season.number,
    }) })
    await reloadLibraryWithoutLosingPlace()
    series = (library?.adult_series || []).find(value => value.id === series.id) || series
  }
  detail.local = { kind: 'series', series: series.id,
    watched_count: Number(series.watched_count || 0) }
  detail.on_mabeltv = (series.episodes || []).length > 0
  return series
}

function configureAdultTitleSeasonManagement(detail, season, card) {
  const localSeries = adultTitleLocalSeries(detail)
  const localEpisodes = adultTitleLocalSeasonEpisodes(detail, season.number)
  const localSeason = Boolean(localSeries
    && (localSeries.seasons || []).map(Number).includes(Number(season.number)))
  const upload = $('#adultTitleSeasonUpload')
  const settingsSheet = $('#adultTitleSeasonSettingsSheet')
  $('#adultTitleSeasonSettings').classList.toggle('hidden', detail.catalogue_only === true)
  $('#adultTitleSeasonSettingsEyebrow').textContent = `${detail.title} · Series ${season.number}`
  $('#adultTitleSeasonSettings').onclick = () => {
    portalSheets.suspend($('#adultTitleSeasonSheet'))
    portalSheets.open(settingsSheet, {
      returnTo: () => openAdultTitleSeason(detail, season, card),
    })
  }
  upload.disabled = false
  $('#adultTitleSeasonUploadHint').textContent = localEpisodes.length
    ? `Add more episodes to Series ${season.number}` : `Add Series ${season.number} episodes to MabelTV`
  upload.onclick = async () => {
    if (upload.disabled) return
    upload.disabled = true
    try {
      portalSheets.dismiss(settingsSheet)
      const series = await ensureAdultTitleSeasonStorage(detail, season)
      const returnTo = () => openAdultTitleSeason(detail, season, card)
      openAdultSeriesUpload(series, season.number,
        !adultTitleLocalSeasonEpisodes(detail, season.number).length, {
          returnTo,
          successReturn: () => {
            const refreshed = (library?.adult_series || []).find(value => value.id === series.id) || series
            detail.local = { kind: 'series', series: refreshed.id,
              watched_count: Number(refreshed.watched_count || 0) }
            detail.on_mabeltv = (refreshed.episodes || []).length > 0
            openAdultTitleSeason(detail, season, card)
          },
        })
    } catch (error) {
      showError(error)
      upload.disabled = false
    }
  }
  const metadata = $('#adultTitleSeasonMetadata')
  const restart = $('#adultTitleSeasonRestart')
  const remove = $('#adultTitleSeasonDelete')
  ;[metadata, restart, remove].forEach(button => button.classList.toggle('hidden', !localSeason))
  metadata.disabled = !tmdbConfigured
  metadata.onclick = localSeason && tmdbConfigured ? async () => {
    metadata.disabled = true
    try {
      portalSheets.dismiss(settingsSheet)
      await api('/api/tmdb/adult-series/apply', { method: 'POST', body: JSON.stringify({
        series: localSeries.id, tmdb_id: detail.tmdb_id,
      }) })
      await reloadLibraryWithoutLosingPlace()
      portalSheets.dismiss($('#adultTitleSeasonSheet'))
      openAdultTitleSeason(detail, season, card)
    } catch (error) { showError(error) } finally { metadata.disabled = false }
  } : null
  restart.onclick = localSeason ? () => {
    portalSheets.dismiss(settingsSheet)
    portalSheets.dismiss($('#adultTitleSeasonSheet'))
    openAdultSeriesRestartSheet(localSeries, season.number,
      () => openAdultTitleSeason(detail, season, card))
  } : null
  remove.onclick = localSeason ? async () => {
    if (!confirm(`Remove every local episode in Series ${season.number} of “${detail.title}” from MabelTV?`)) return
    remove.disabled = true
    try {
      portalSheets.dismiss(settingsSheet)
      await api('/api/manage', { method: 'POST', body: JSON.stringify({
        action: 'trash-adult-series', series: localSeries.id,
        scope: 'season', season: season.number,
      }) })
      await reloadLibraryWithoutLosingPlace()
      const refreshed = (library?.adult_series || []).find(value => value.id === localSeries.id)
      detail.local = refreshed ? { kind: 'series', series: refreshed.id,
        watched_count: Number(refreshed.watched_count || 0) } : null
      detail.on_mabeltv = Boolean((refreshed?.episodes || []).length)
      portalSheets.dismiss($('#adultTitleSeasonSheet'))
      openAdultTitleSeason(detail, season, card)
    } catch (error) { showError(error) } finally { remove.disabled = false }
  } : null
}

function adultTitleSeasonCacheKey(detail, season) {
  return `adult-season-v1:${Number(detail.tmdb_id)}:${Number(season.number)}`
}

function adultTitleSeasonCurrentResult(detail, season, result) {
  const viewing = adultViewingRecord(detail)
  const episodeStates = viewing?.episodes && typeof viewing.episodes === 'object'
    ? viewing.episodes : null
  const localEpisodes = new Map(adultTitleLocalSeasonEpisodes(detail, season.number)
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

function renderAdultTitleSeasonResult(detail, season, card, result, targetEpisode = 0) {
  season.watched_count = result.episodes.filter(episode => episode.watched).length
  const statusCount = season.watched_count
  renderAdultTitleSeasonHeader(detail, season, result.episodes.length, statusCount)
  $('#adultTitleSeasonEpisodeCount').textContent = `${result.episodes.length} total`
  const overview = $('#adultTitleSeasonOverview')
  overview.textContent = result.overview || season.overview || ''
  overview.classList.toggle('hidden', !overview.textContent)
  $('#adultTitleSeasonArtwork').replaceChildren(adultStreamingArtwork(
    detail, season, result, 'adult-season-sheet-artwork'))
  const root = $('#adultTitleSeasonEpisodes')
  root.replaceChildren(...result.episodes.map(episode =>
    adultStreamingEpisodeRow(detail, season, result, episode, card)))
  if (!result.episodes.length) root.replaceChildren(portalEmptyState({
    className: 'adult-series-empty',
    title: 'No episodes found',
    message: 'TMDB has no episode details for this series yet.',
    messageTag: 'span',
  }))
  wireAdultSeasonBulkButton($('#adultTitleSeasonWatched'), `Series ${season.number}`,
    statusCount, result.episodes.length, async targetWatched => {
      const previous = result.episodes.map(episode => episode.watched)
      result.episodes.forEach(episode => { episode.watched = targetWatched })
      season.watched_count = targetWatched ? result.episodes.length : 0
      syncAdultStreamingSeasonCard(card, season, detail)
      syncAdultTitleNextEpisode(detail)
      try {
        detail.viewing = await updateAdultViewing(detail, 'season_watched', {
          season: season.number, episode_count: result.episodes.length,
          watched: targetWatched,
        })
        if (detail.local?.kind === 'series') {
          const localSeries = (library?.adult_series || []).find(value =>
            value.id === detail.local.series)
          ;(localSeries?.episodes || []).filter(episode =>
            Number(episode.season) === Number(season.number))
            .forEach(episode => { episode.watched = targetWatched })
        }
        await syncAdultTitleEpisodeStatus(detail)
        portalSheets.close($('#adultTitleSeasonSheet'), { restore: false })
        openAdultTitleSeason(detail, season, card, targetEpisode)
        return targetWatched ? result.episodes.length : 0
      } catch (error) {
        result.episodes.forEach((episode, index) => { episode.watched = previous[index] })
        season.watched_count = previous.filter(Boolean).length
        syncAdultStreamingSeasonCard(card, season, detail)
        syncAdultTitleNextEpisode(detail)
        throw error
      }
    })
  $('#adultTitleSeasonWatched').disabled = false
  syncAdultStreamingSeasonCard(card, season, detail)
  if (targetEpisode) {
    const target = root.querySelector(`[data-episode="${targetEpisode}"]`)
    target?.classList.add('is-next')
    requestAnimationFrame(() => target?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }
}

async function openAdultTitleSeason(detail, season, card, targetEpisode = 0) {
  const revision = ++adultSeasonOpenRevision
  const titleSheet = $('#adultTitleSheet')
  const seasonSheet = $('#adultTitleSeasonSheet')
  const titleReturnTo = portalSheets.returnTo(titleSheet)
  seasonSheet.classList.toggle('is-catalogue-only', detail.catalogue_only === true)
  portalSheets.suspend(titleSheet, { card: true })
  $('#adultTitleSeasonEyebrow').textContent = detail.title
  $('#adultTitleSeasonName').textContent = `Series ${season.number}`
  renderAdultTitleSeasonHeader(detail, season)
  $('#adultTitleSeasonEpisodeHeading').textContent = `Series ${season.number} episodes`
  $('#adultTitleSeasonEpisodeCount').textContent = `${Number(season.episodes || 0)} total`
  $('#adultTitleSeasonOverview').classList.add('hidden')
  $('#adultTitleSeasonArtwork').replaceChildren(adultStreamingArtwork(
    detail, season, null, 'adult-season-sheet-artwork'))
  const bulk = $('#adultTitleSeasonWatched')
  bulk.disabled = true
  bulk.replaceChildren(librarySignalIcon('signal-check'),
    Object.assign(document.createElement('span'), { textContent: 'Loading series status…' }))
  const root = $('#adultTitleSeasonEpisodes')
  root.replaceChildren(portalEmptyState({
    className: 'adult-series-empty',
    title: 'Loading episodes…',
    message: 'Fetching episode details and artwork.',
    messageTag: 'span',
  }))
  portalSheets.open(seasonSheet, {
    returnTo: () => {
      restoreAdultTitleSheet(detail, titleReturnTo)
    },
  })
  configureAdultTitleSeasonManagement(detail, season, card)
  const cacheKey = adultTitleSeasonCacheKey(detail, season)
  let displayed = null
  try {
    const cached = await readPortalDataCache(cacheKey)
    if (revision !== adultSeasonOpenRevision) return
    if (cached) {
      displayed = adultTitleSeasonCurrentResult(detail, season, cached.data)
      renderAdultTitleSeasonResult(detail, season, card, displayed, targetEpisode)
      if (Date.now() - cached.saved_at < ADULT_SEASON_CACHE_MAX_AGE) return
    }
    const result = await api(`/api/adult/season?tmdb_id=${detail.tmdb_id}&season=${season.number}`)
    if (revision !== adultSeasonOpenRevision) return
    const fresh = adultTitleSeasonCurrentResult(detail, season, result)
    if (!displayed) {
      renderAdultTitleSeasonResult(detail, season, card, fresh, targetEpisode)
    }
    await writePortalDataCache(cacheKey, result)
  } catch (error) {
    if (revision !== adultSeasonOpenRevision) return
    if (displayed) return
    root.replaceChildren(portalEmptyState({
      className: 'adult-series-empty',
      title: 'Episodes unavailable',
      message: error.message,
      messageTag: 'span',
    }))
  }
}

function renderAdultTitleSeasons(detail) {
  const wrapper = $('#adultTitleSeriesLibrary')
  wrapper.classList.remove('is-loading-placeholder')
  const seasons = $('#adultTitleSeasons')
  seasons.replaceChildren()
  const visible = detail.media_type === 'tv' && (detail.seasons || []).length
  wrapper.classList.toggle('hidden', !visible)
  if (!visible) return
  $('#adultTitleSeasonCount').textContent = `${detail.seasons.length} series`
  ;(detail.seasons || []).forEach(season => {
    const card = document.createElement('article')
    card.className = 'adult-season-card adult-streaming-season-card'
    card.dataset.season = String(season.number)
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    const art = adultStreamingArtwork(detail, season)
    const shade = document.createElement('span')
    shade.className = 'adult-season-card-shade'
    const copy = document.createElement('span')
    copy.className = 'adult-season-card-copy'
    const kicker = document.createElement('span')
    kicker.textContent = `${detail.title} · ${Number(season.episodes || 0)} episode${Number(season.episodes || 0) === 1 ? '' : 's'}`
    const heading = document.createElement('strong')
    heading.textContent = `Series ${season.number}`
    const summary = document.createElement('small')
    copy.append(kicker, heading, summary)
    const progress = document.createElement('span')
    progress.className = 'adult-season-card-progress'
    const openSeason = () => openAdultTitleSeason(detail, season, card)
    card.onclick = openSeason
    card.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSeason() }
    }
    const status = document.createElement('button')
    status.type = 'button'
    wireAdultSeasonBulkButton(status, `Series ${season.number}`,
      season.watched_count, season.episodes, async targetWatched => {
        const previous = season.watched_count
        season.watched_count = targetWatched ? Number(season.episodes || 0) : 0
        syncAdultStreamingSeasonCard(card, season, detail)
        syncAdultTitleNextEpisode(detail)
        try {
          detail.viewing = await updateAdultViewing(detail, 'season_watched', {
            season: season.number, episode_count: season.episodes, watched: targetWatched,
          })
          await syncAdultTitleEpisodeStatus(detail)
          renderAdultTitleDetail(detail, false)
          return season.watched_count
        } catch (error) {
          season.watched_count = previous
          syncAdultStreamingSeasonCard(card, season, detail)
          syncAdultTitleNextEpisode(detail)
          throw error
        }
      }, true)
    card.append(art, shade, copy, progress,
      librarySignalIcon('signal-chevron-right', 'icon adult-season-card-chevron'), status)
    syncAdultStreamingSeasonCard(card, season, detail)
    seasons.append(card)
  })
  syncAdultTitleNextEpisode(detail)
}
