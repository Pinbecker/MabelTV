'use strict'

function adultSeasonSummary(season, watched = Number(season.watched_count || 0)) {
  const total = Number(season.episodes || 0)
  return watched ? `${watched} of ${total} watched` : `${total} episode${total === 1 ? '' : 's'}`
}

function adultStreamingArtwork(detail, season, result = null, className = 'adult-season-card-art') {
  const art = document.createElement('span')
  art.className = className
  const still = (result?.episodes || []).find(episode => episode.still_path)?.still_path
  const path = still || season.poster_path || result?.poster_path
    || detail.backdrop_path || detail.poster_path
  if (path) {
    const image = document.createElement('img')
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

function syncAdultStreamingSeasonCard(card, season) {
  const total = Number(season.episodes || 0)
  const watched = Number(season.watched_count || 0)
  card.querySelector('.adult-season-card-copy small').textContent = watched
    ? `${watched} watched · Open series` : 'Open series'
  card.querySelector('.adult-season-card-progress').style.setProperty(
    '--season-progress', `${total ? watched / total * 100 : 0}%`)
  card.querySelector('.adult-season-status')?.syncSeasonStatus(watched, total)
}

function deriveAdultTitleNextEpisode(detail) {
  if (detail.media_type !== 'tv') return null
  const rewatching = detail.viewing?.series_watching === true
    && detail.viewing?.series_watching_mode === 'rewatch'
  const states = rewatching
    ? detail.viewing?.rewatch_episodes || {} : detail.viewing?.episodes || {}
  const localSeries = !rewatching && detail.local?.kind === 'series'
    ? (library?.adult_series || []).find(value => value.id === detail.local.series) : null
  const available = []
  ;[...(detail.seasons || [])].sort((a, b) => a.number - b.number).forEach(season => {
    for (let episode = 1; episode <= Number(season.episodes || 0); episode += 1) {
      const local = (localSeries?.episodes || []).find(value =>
        Number(value.season) === Number(season.number)
          && Number(value.episode) === episode)
      available.push({
        season: season.number, episode, title: '', rewatch: rewatching,
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

function restoreAdultTitleSheet(detail) {
  const sheet = $('#adultTitleSheet')
  portalSheets.open(sheet, { focus: sheet.querySelector('.watch-film-panel') })
  renderAdultTitleDetail(detail, false)
}

async function openAdultEpisodeDestination(detail, season, episode, seasonCard = null) {
  const local = findLocalAdultEpisode(detail, season.number, episode.number)
  if (local) {
    portalSheets.dismiss($('#adultEpisodeLaunchSheet'))
    portalSheets.dismiss($('#adultTitleSeasonSheet'))
    portalSheets.dismiss($('#adultTitleSheet'))
    openAdultEpisodeSheet(local.series, local.episode, () => {
      if (seasonCard) openAdultTitleSeason(detail, season, seasonCard, episode.number)
      else restoreAdultTitleSheet(detail)
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
  button.querySelector('small').textContent = next.rewatch
    ? 'Next episode in this rewatch' : 'Next episode'
  button.querySelector('strong').textContent = `Series ${next.season}, Episode ${next.episode}${next.title ? ` · ${next.title}` : ''}`
  button.onclick = () => {
    const season = (detail.seasons || []).find(value => value.number === next.season)
      || { number: next.season, episodes: 0 }
    void openAdultEpisodeDestination(detail, season, {
      number: next.episode, name: next.title || `Episode ${next.episode}`,
    })
  }
}

function adultTitleAllEpisodesWatched(detail) {
  const seasons = detail.seasons || []
  if (detail.viewing?.series_watching === true
      && detail.viewing?.series_watching_mode === 'rewatch') {
    const states = detail.viewing?.rewatch_episodes || {}
    return seasons.length > 0 && seasons.every(season => Number(season.episodes || 0) > 0
      && Array.from({ length: Number(season.episodes || 0) }, (_, index) => index + 1)
        .every(episode => states[`${season.number}:${episode}`]?.watched === true))
  }
  return seasons.length > 0 && seasons.every(season => Number(season.episodes || 0) > 0
    && Number(season.watched_count || 0) >= Number(season.episodes || 0))
}

async function finishAdultTitleIfComplete(detail) {
  const rewatching = detail.viewing?.series_watching === true
    && detail.viewing?.series_watching_mode === 'rewatch'
  if (!adultTitleAllEpisodesWatched(detail)
      || (!rewatching && detail.viewing?.manual_state === 'watched')) return
  detail.viewing = await updateAdultViewing(detail, 'watched')
  syncAdultTitleButtons(detail)
}

function adultStreamingEpisodeRow(detail, season, result, episode, card) {
  const rewatching = detail.viewing?.series_watching === true
    && detail.viewing?.series_watching_mode === 'rewatch'
  const isComplete = () => rewatching ? episode.rewatch_watched : episode.watched
  const row = document.createElement('article')
  row.className = `adult-series-episode adult-streaming-episode${isComplete() ? ' is-watched' : ''}`
  row.dataset.episode = String(episode.number)
  row.tabIndex = 0
  row.setAttribute('role', 'button')
  row.setAttribute('aria-label', `Open ${episode.name || `episode ${episode.number}`}`)
  row.onclick = () => { void openAdultEpisodeDestination(detail, season, episode, card) }
  row.onkeydown = event => {
    if (event.target !== row) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    void openAdultEpisodeDestination(detail, season, episode, card)
  }
  const artwork = document.createElement('span')
  artwork.className = 'adult-series-episode-art'
  if (episode.still_path) {
    const image = document.createElement('img')
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
  const meta = document.createElement('small')
  copy.append(title, meta)
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'adult-streaming-episode-toggle'
  const sync = () => {
    const complete = isComplete()
    const facts = [complete ? rewatching ? 'Watched again' : 'Watched' : '', adultEpisodeAirDate(episode.air_date),
      episode.runtime ? `${episode.runtime} min` : ''].filter(Boolean)
    meta.textContent = facts.join(' · ') || (complete
      ? rewatching ? 'Watched again' : 'Watched' : 'Not watched')
    row.classList.toggle('is-watched', complete)
    toggle.classList.toggle('active', complete)
    toggle.setAttribute('aria-pressed', String(complete))
    toggle.setAttribute('aria-label', `${complete ? rewatching ? 'Mark not watched again' : 'Mark unwatched'
      : rewatching ? 'Mark watched again' : 'Mark watched'}: ${episode.name}`)
    toggle.textContent = complete ? rewatching ? 'Watched again' : 'Watched'
      : rewatching ? 'Mark watched again' : 'Mark watched'
  }
  sync()
  toggle.onclick = async event => {
    event.stopPropagation()
    const next = !isComplete()
    toggle.disabled = true
    try {
      detail.viewing = await updateAdultViewing(detail, 'episode_watched', {
        season: season.number, episode: episode.number, watched: next, rewatch: rewatching,
      })
      const local = findLocalAdultEpisode(detail, season.number, episode.number)
      if (!rewatching && local) local.episode.watched = next
      if (rewatching) episode.rewatch_watched = next
      else episode.watched = next
      const statusCount = result.episodes.filter(value => rewatching
        ? value.rewatch_watched : value.watched).length
      if (!rewatching) season.watched_count = statusCount
      sync()
      syncAdultStreamingSeasonCard(card, season)
      $('#adultTitleSeasonWatched').syncSeasonStatus(statusCount, result.episodes.length)
      $('#adultTitleSeasonMeta').textContent = `${result.episodes.length} episode${result.episodes.length === 1 ? '' : 's'} · ${statusCount} ${rewatching ? 'watched again' : 'watched'}`
      if (next) await finishAdultTitleIfComplete(detail)
      syncAdultTitleNextEpisode(detail)
      notice(next ? rewatching ? 'Episode marked watched again.' : 'Episode marked watched.'
        : rewatching ? 'Removed from this rewatch.' : 'Episode marked unwatched.')
    } catch (error) {
      showError(error)
    } finally {
      toggle.disabled = false
    }
  }
  row.append(artwork, copy, toggle)
  return row
}

async function openAdultTitleSeason(detail, season, card, targetEpisode = 0) {
  const revision = ++adultSeasonOpenRevision
  const titleSheet = $('#adultTitleSheet')
  const seasonSheet = $('#adultTitleSeasonSheet')
  portalSheets.dismiss(titleSheet)
  $('#adultTitleSeasonEyebrow').textContent = detail.title
  $('#adultTitleSeasonName').textContent = `Series ${season.number}`
  $('#adultTitleSeasonMeta').textContent = adultSeasonSummary(season)
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
      portalSheets.open(titleSheet, { focus: titleSheet.querySelector('.watch-film-panel') })
      renderAdultTitleDetail(detail, false)
    },
  })
  try {
    const result = await api(`/api/adult/season?tmdb_id=${detail.tmdb_id}&season=${season.number}`)
    if (revision !== adultSeasonOpenRevision) return
    const rewatching = detail.viewing?.series_watching === true
      && detail.viewing?.series_watching_mode === 'rewatch'
    season.watched_count = result.episodes.filter(episode => episode.watched).length
    const statusCount = result.episodes.filter(episode => rewatching
      ? episode.rewatch_watched : episode.watched).length
    $('#adultTitleSeasonMeta').textContent = `${result.episodes.length} episode${result.episodes.length === 1 ? '' : 's'} · ${statusCount} ${rewatching ? 'watched again' : 'watched'}`
    $('#adultTitleSeasonEpisodeCount').textContent = `${result.episodes.length} total`
    const overview = $('#adultTitleSeasonOverview')
    overview.textContent = result.overview || season.overview || ''
    overview.classList.toggle('hidden', !overview.textContent)
    $('#adultTitleSeasonArtwork').replaceChildren(adultStreamingArtwork(
      detail, season, result, 'adult-season-sheet-artwork'))
    root.replaceChildren(...result.episodes.map(episode =>
      adultStreamingEpisodeRow(detail, season, result, episode, card)))
    if (!result.episodes.length) root.replaceChildren(portalEmptyState({
      className: 'adult-series-empty',
      title: 'No episodes found',
      message: 'TMDB has no episode details for this series yet.',
      messageTag: 'span',
    }))
    wireAdultSeasonBulkButton($('#adultTitleSeasonWatched'), rewatching
      ? `Series ${season.number} rewatch` : `Series ${season.number}`,
      statusCount, result.episodes.length, async targetWatched => {
        detail.viewing = await updateAdultViewing(detail, 'season_watched', {
          season: season.number, episode_count: result.episodes.length,
          watched: targetWatched, rewatch: rewatching,
        })
        result.episodes.forEach(episode => {
          if (rewatching) episode.rewatch_watched = targetWatched
          else episode.watched = targetWatched
        })
        if (!rewatching && detail.local?.kind === 'series') {
          const localSeries = (library?.adult_series || []).find(value =>
            value.id === detail.local.series)
          ;(localSeries?.episodes || []).filter(episode =>
            Number(episode.season) === Number(season.number))
            .forEach(episode => { episode.watched = targetWatched })
        }
        if (!rewatching) season.watched_count = targetWatched ? result.episodes.length : 0
        if (targetWatched) await finishAdultTitleIfComplete(detail)
        syncAdultStreamingSeasonCard(card, season)
        syncAdultTitleNextEpisode(detail)
        portalSheets.close(seasonSheet, { restore: false })
        openAdultTitleSeason(detail, season, card, targetEpisode)
        notice(targetWatched ? rewatching ? `Series ${season.number} marked watched again.`
          : `Series ${season.number} marked watched.` : rewatching
          ? `Series ${season.number} removed from this rewatch.`
          : `Series ${season.number} marked unwatched.`)
        return targetWatched ? result.episodes.length : 0
      })
    bulk.disabled = false
    syncAdultStreamingSeasonCard(card, season)
    if (targetEpisode) {
      const target = root.querySelector(`[data-episode="${targetEpisode}"]`)
      target?.classList.add('is-next')
      requestAnimationFrame(() => target?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    }
  } catch (error) {
    if (revision !== adultSeasonOpenRevision) return
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
        detail.viewing = await updateAdultViewing(detail, 'season_watched', {
          season: season.number, episode_count: season.episodes, watched: targetWatched,
        })
        season.watched_count = targetWatched ? Number(season.episodes || 0) : 0
        if (targetWatched) await finishAdultTitleIfComplete(detail)
        syncAdultStreamingSeasonCard(card, season)
        syncAdultTitleNextEpisode(detail)
        renderAdultTitleDetail(detail, false)
        notice(targetWatched ? `Series ${season.number} marked watched.`
          : `Series ${season.number} marked unwatched.`)
        return season.watched_count
      }, true)
    card.append(art, shade, copy, progress,
      librarySignalIcon('signal-chevron-right', 'icon adult-season-card-chevron'), status)
    syncAdultStreamingSeasonCard(card, season)
    seasons.append(card)
  })
  syncAdultTitleNextEpisode(detail)
}
