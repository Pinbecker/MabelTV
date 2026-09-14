'use strict'

function myTvExactDateLabel(value) {
  const source = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return ''
  const date = new Date(`${source}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date)
}

function renderMyTvTitleMetadata(root, detail, {
  facts = [], creditLabel = '', credits = [], seriesLayout = false,
} = {}) {
  root.replaceChildren()
  root.classList.add('is-title-facts')
  root.classList.toggle('is-series-title-facts', seriesLayout)
  let ratingFact = null
  facts.filter(fact => fact?.value).forEach(fact => {
    const span = document.createElement('span')
    span.className = 'my-tv-title-fact'
    const label = document.createElement('small')
    label.textContent = fact.label
    const value = document.createElement('strong')
    value.textContent = fact.value
    span.append(label, value)
    root.append(span)
  })
  const rating = Number(detail.rating || 0)
  if (rating > 0) {
    const fact = document.createElement('span')
    fact.className = 'my-tv-title-fact my-tv-title-rating'
    const mark = document.createElement('small')
    const logo = document.createElement('i')
    logo.className = 'my-tv-title-rating-mark'
    logo.textContent = 'TMDB'
    mark.append(logo)
    const score = document.createElement('strong')
    score.textContent = rating.toFixed(1)
    fact.title = detail.rating_count
      ? `${Number(detail.rating_count).toLocaleString('en-GB')} TMDB ratings` : 'TMDB user score'
    fact.append(mark, score)
    if (!seriesLayout) root.append(fact)
    else ratingFact = fact
  }
  if (creditLabel && credits.length) {
    const credit = document.createElement('span')
    credit.className = 'my-tv-title-fact my-tv-title-credit'
    const label = document.createElement('small')
    label.textContent = creditLabel
    const names = document.createElement('strong')
    names.textContent = credits.map(name => String(name).trim().replace(/\s+/g, '\u00a0')).join(', ')
    credit.append(label, names)
    root.append(credit)
  }
  if (ratingFact) root.append(ratingFact)
}

function clearMyTvTitleEnrichment(prefix) {
  for (const suffix of ['Franchise', 'Cast']) {
    const section = $(`#${prefix}${suffix}`)
    section?.classList.add('hidden')
    section?.classList.remove('is-loading-placeholder')
    $(`#${prefix}${suffix}Rail`)?.replaceChildren()
  }
}

function myTvCreditCard(person, detail, openPerson, fallbackRole) {
  const interactive = Number(person.tmdb_id || 0) > 0
  const card = document.createElement(interactive ? 'button' : 'article')
  if (interactive) card.type = 'button'
  card.className = 'my-tv-cast-card'
  const portrait = document.createElement('span')
  portrait.className = 'my-tv-cast-photo'
  if (person.profile_path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = myTvPosterUrl(person.profile_path, 'w185')
    image.alt = ''
    portrait.append(image)
  } else {
    const initials = document.createElement('b')
    initials.textContent = String(person.name || '?').split(/\s+/).slice(0, 2)
      .map(part => part.slice(0, 1)).join('').toUpperCase()
    portrait.append(initials)
  }
  const name = document.createElement('strong')
  name.textContent = person.name
  const role = document.createElement('small')
  role.textContent = person.character || person.role || fallbackRole
  card.append(portrait, name, role)
  if (interactive) {
    card.setAttribute('aria-label', `Open details for ${person.name}`)
    card.onclick = () => openPerson(person, detail.title)
  }
  return card
}

function appendMyTvCreditGroup(rail, label, people, detail, openPerson, role) {
  if (!people.length) return
  const group = document.createElement('div')
  group.className = 'my-tv-credit-group'
  const heading = document.createElement('span')
  heading.className = 'my-tv-credit-group-label'
  heading.textContent = label
  const cards = document.createElement('div')
  cards.className = 'my-tv-credit-group-cards'
  people.forEach(person => cards.append(myTvCreditCard(
    person, detail, openPerson, role)))
  group.append(heading, cards)
  rail.append(group)
}

function renderMyTvTitleEnrichment(detail, prefix, openTitle, openPerson = openMyTvPerson) {
  clearMyTvTitleEnrichment(prefix)
  const franchise = $(`#${prefix}Franchise`)
  const franchiseName = $(`#${prefix}FranchiseName`)
  const franchiseRail = $(`#${prefix}FranchiseRail`)
  const parts = detail.media_type === 'movie' ? detail.collection?.parts || [] : []
  if (franchise && franchiseRail && parts.length > 1) {
    franchiseName.textContent = detail.collection.name || 'Film collection'
    parts.forEach(part => {
      const current = part.key === detail.key
      const card = document.createElement('button')
      card.type = 'button'
      card.className = `my-tv-franchise-card${current ? ' is-current' : ''}`
      card.disabled = current
      if (current) card.setAttribute('aria-current', 'true')
      card.setAttribute('aria-label', current ? `${part.title}, current film` : `Open ${part.title}`)
      const art = document.createElement('span')
      art.className = 'my-tv-franchise-art'
      if (part.poster_path) {
        const image = document.createElement('img')
        image.loading = 'lazy'
        image.decoding = 'async'
        image.src = myTvPosterUrl(part.poster_path, 'w185')
        image.alt = ''
        art.append(image)
      } else {
        const placeholder = document.createElement('b')
        placeholder.textContent = String(part.title || '?').slice(0, 1).toUpperCase()
        art.append(placeholder)
      }
      appendMyTvArtworkStatus(art, part)
      renderMyTvProviderBadges(art, part)
      const title = document.createElement('strong')
      title.textContent = part.title
      const year = document.createElement('small')
      year.textContent = part.year || 'Date unknown'
      card.append(art, title, year)
      if (!current) card.onclick = () => openTitle(part)
      franchiseRail.append(card)
    })
    franchise.classList.remove('hidden')
  }
  const castSection = $(`#${prefix}Cast`)
  const castRail = $(`#${prefix}CastRail`)
  const leads = Array.isArray(detail.creative_leads) ? detail.creative_leads : []
  const cast = Array.isArray(detail.cast) ? detail.cast.slice(0, 15) : []
  if (castSection && castRail && (leads.length || cast.length)) {
    const leadLabel = detail.media_type === 'tv'
      ? leads.length > 1 ? 'Creators' : 'Creator'
      : leads.length > 1 ? 'Directors' : 'Director'
    appendMyTvCreditGroup(castRail, leadLabel, leads, detail, openPerson,
      detail.media_type === 'tv' ? 'Creator' : 'Director')
    if (leads.length && cast.length) {
      const divider = document.createElement('span')
      divider.className = 'my-tv-credit-divider'
      divider.setAttribute('aria-hidden', 'true')
      castRail.append(divider)
    }
    appendMyTvCreditGroup(castRail, 'Cast', cast, detail, openPerson, 'Cast')
    castSection.classList.remove('hidden')
  }
}

function myTvTitleIntentAction(detail, button, request, root = $('#myTvTitleIntents'), onUpdate = null) {
  return async () => {
    if (button.disabled || button.dataset.saving === 'true') return
    button.dataset.saving = 'true'
    try {
      const { action, extra = {} } = request()
      detail.viewing = await updateMyTvViewing(detail, action, extra, viewing => {
        detail.viewing = viewing
        syncMyTvTitleButtons(detail, root)
        if (typeof syncMyTvPersonalRatingForIntentRoot === 'function') {
          syncMyTvPersonalRatingForIntentRoot(root, detail)
        }
        if (onUpdate) onUpdate(viewing)
        if (root?.id === 'myTvTitleIntents') syncMyTvTitleNextEpisode(detail)
      })
    } catch (error) {
      showError(error)
    } finally {
      delete button.dataset.saving
    }
  }
}

function wireMyTvTitleIntentActions(detail, root = $('#myTvTitleIntents'), onUpdate = null) {
  const { watchlist, up_next: upNext, watching, watched } = myTvViewingActionButtons(root)
  if (!watchlist || !upNext || !watched) return
  syncMyTvTitleButtons(detail, root)
  watchlist.onclick = myTvTitleIntentAction(detail, watchlist, () => ({
    action: 'watchlist', extra: { enabled: !detail.viewing?.watchlisted },
  }), root, onUpdate)
  upNext.onclick = myTvTitleIntentAction(detail, upNext, () => ({
    action: 'up_next', extra: { enabled: !detail.viewing?.up_next },
  }), root, onUpdate)
  if (watching) watching.onclick = myTvTitleIntentAction(detail, watching, () => ({
    action: 'watching', extra: { enabled: !detail.viewing?.series_watching },
  }), root, onUpdate)
  watched.onclick = detail.media_type === 'tv' ? null
    : myTvTitleIntentAction(detail, watched, () => ({
      action: detail.viewing?.manual_state === 'watched' ? 'not_watched' : 'watched',
    }), root, onUpdate)
}

function localFilmViewingDetail(film) {
  const metadata = film?.metadata || {}
  const tmdbId = Number(metadata.tmdb_id || 0)
  if (!tmdbId) return null
  const key = `movie:${tmdbId}`
  const stored = (myTvViewingData.items || []).find(item => item.key === key) || {}
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
  clearMyTvTitleEnrichment('watchFilm')
  $('#watchFilmRentBuy')?.classList.add('hidden')
  $('#watchFilmRentBuyList')?.replaceChildren()
  section.classList.remove('hidden')
  const refreshButton = $('#watchFilmProviderRefresh')
  const availabilityEnabled = myTvAvailabilityEnabled()
  refreshButton.classList.toggle('hidden', !detail || !availabilityEnabled)
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
      api(`/api/my-tv/title?media_type=movie&tmdb_id=${detail.tmdb_id}`),
      availabilityEnabled
        ? api(`/api/my-tv/providers?media_type=movie&tmdb_id=${detail.tmdb_id}${refresh ? '&refresh=1' : ''}`)
        : Promise.resolve({ sources: [], disabled: true }),
    ])
    if (revision !== localFilmProviderRevision || root.dataset.providerKey !== detail.key) return
    const fullDetail = {
      ...title,
      on_mabeltv: true,
      local: { kind: 'film', path: film.path },
    }
    const directors = fullDetail.directors || []
    renderMyTvTitleMetadata($('#watchFilmMeta'), fullDetail, {
      facts: [
        { label: 'Release', value: myTvExactDateLabel(fullDetail.release_date) || fullDetail.year },
        { label: 'Runtime', value: fullDetail.runtime ? `${fullDetail.runtime} min` : '' },
        { label: 'Genre', value: (fullDetail.genres || [])[0] || '' },
      ],
      creditLabel: directors.length > 1 ? 'Directors' : 'Director',
      credits: directors,
    })
    const filmSheet = $('#watchFilmSheet')
    const filmReturnTo = portalSheets.returnTo(filmSheet) || selectedWatchFilmReturnTo
    const restoreFilm = () => openWatchFilmSheet(film, selectedWatchFilmContext, filmReturnTo)
    renderMyTvTitleEnrichment(fullDetail, 'watchFilm', part => {
      portalSheets.suspend(filmSheet, { card: true })
      void openMyTvTitle(part, restoreFilm)
    }, (person, title) => {
      portalSheets.suspend(filmSheet, { card: true })
      void openMyTvPerson(person, title, restoreFilm)
    })
    const options = { localAction: null, purchaseSection: $('#watchFilmRentBuy'),
      purchaseRoot: $('#watchFilmRentBuyList') }
    if (availabilityEnabled) renderMyTvProviderLinksInto(root, fullDetail, sources, options)
    else renderMyTvAvailabilityDisabled(root, fullDetail, options)
  } catch (error) {
    if (revision !== localFilmProviderRevision || root.dataset.providerKey !== detail.key) return
    renderMyTvProviderLinksInto(root, { ...detail, on_mabeltv: true }, { sources: [] }, {
      localAction: null, purchaseSection: $('#watchFilmRentBuy'),
      purchaseRoot: $('#watchFilmRentBuyList'),
    })
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
  if (!myTvViewingLoaded) await loadMyTvViewing()
  if (root.dataset.viewingKey !== detail.key) return
  detail.viewing = (myTvViewingData.items || []).find(item => item.key === detail.key) || {}
  root.querySelectorAll('button').forEach(button => { button.disabled = false })
  wireMyTvTitleIntentActions(detail, root)
}

function localMyTvSeriesForTitle(title = {}) {
  const localId = title.local?.kind === 'series' ? title.local.series : ''
  const tmdbId = Number(title.tmdb_id || 0)
  return (library?.my_tv_series || []).find(series => series.id === localId)
    || (tmdbId ? (library?.my_tv_series || []).find(series =>
      Number(series.metadata?.tmdb_id || 0) === tmdbId) : null)
}

function localMyTvFilmForTitle(title = {}) {
  if (title.media_type !== 'movie') return null
  const localPath = title.local?.kind === 'film' ? title.local.path : ''
  const tmdbId = Number(title.tmdb_id || 0)
  return (library?.my_tv_library || []).find(film => film.path === localPath)
    || (tmdbId ? (library?.my_tv_library || []).find(film =>
      Number(film.metadata?.tmdb_id || 0) === tmdbId) : null)
}

function localSeriesViewingDetail(series) {
  const metadata = series?.metadata || {}
  const tmdbId = Number(metadata.tmdb_id || 0)
  if (!tmdbId) return null
  const key = `tv:${tmdbId}`
  const stored = (myTvViewingData.items || []).find(item => item.key === key) || {}
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
  if (!myTvViewingLoaded) await loadMyTvViewing()
  if (root.dataset.viewingKey !== detail.key) return
  detail.viewing = (myTvViewingData.items || []).find(item => item.key === detail.key) || {}
  root.querySelectorAll('button').forEach(button => { button.disabled = false })
  wireMyTvTitleIntentActions(detail, root, onUpdate)
  onUpdate(detail.viewing)
}

function renderMyTvTitleDetail(detail, refreshProviders = true,
                                revision = myTvTitleOpenRevision, syncProgress = true) {
  const sheet = $('#myTvTitleSheet')
  const localSeries = detail.media_type === 'tv' ? localMyTvSeriesForTitle(detail) : null
  const localFilm = localMyTvFilmForTitle(detail)
  if (localSeries) {
    detail.local = { kind: 'series', series: localSeries.id,
      watched_count: Number(localSeries.watched_count || 0) }
  }
  if (detail.media_type === 'tv') detail.on_mabeltv = Boolean((localSeries?.episodes || []).length)
  selectedMyTvTitle = detail
  sheet.classList.remove('is-loading-title')
  sheet.removeAttribute('aria-busy')
  $('#myTvTitleMeta').classList.remove('is-loading-placeholder')
  $('#myTvTitleIntents').classList.remove('is-loading-placeholder')
  const isSeries = detail.media_type === 'tv'
  sheet.classList.toggle('is-series', isSeries)
  $('#myTvTitleName').textContent = detail.title
  const eyebrow = $('#myTvTitleEyebrow')
  eyebrow.textContent = detail.on_mabeltv
    ? `On ${tvName()}` : isSeries ? 'Streaming TV series' : 'Film'
  eyebrow.classList.toggle('is-mabeltv', detail.on_mabeltv === true)
  $('#myTvTitleOverview').textContent = detail.overview || 'No description is available.'
  renderMyTvTitleSeasons(detail)
  const date = isSeries
    ? myTvExactDateLabel(detail.first_air_date)
    : myTvExactDateLabel(detail.release_date)
  const seasons = detail.seasons || []
  const episodeCount = seasons.reduce((total, season) =>
    total + Number(season.episodes || 0), 0)
  const credits = detail.directors || []
  const facts = isSeries ? [
    { label: 'Aired from', value: date || detail.year },
    { label: 'Series', value: String(seasons.length) },
    { label: 'Episodes', value: String(episodeCount) },
    { label: 'Genre', value: (detail.genres || [])[0] || '' },
  ] : [
    { label: 'Release', value: date || detail.year },
    { label: 'Runtime', value: detail.runtime ? `${detail.runtime} min` : '' },
    { label: 'Genre', value: (detail.genres || [])[0] || '' },
  ]
  renderMyTvTitleMetadata($('#myTvTitleMeta'), detail, {
    facts,
    creditLabel: isSeries ? 'Created by' : credits.length > 1 ? 'Directors' : 'Director',
    credits,
    seriesLayout: isSeries,
  })
  renderMyTvPersonalRating($('#myTvTitlePersonalRating'), detail)
  const poster = $('#myTvTitlePoster')
  poster.replaceChildren()
  if (detail.poster_path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = myTvPosterUrl(detail.poster_path, 'w500')
    image.alt = `Poster for ${detail.title}`
    poster.append(image)
  }
  $('#myTvTitleBackdrop').style.setProperty('--watch-film-art', detail.backdrop_path
    ? `url("${myTvPosterUrl(detail.backdrop_path, 'w1280')}")`
    : 'linear-gradient(135deg,#2e3a34,#101513)')
  $('#myTvTitleLocal').classList.toggle('hidden', !detail.on_mabeltv || Boolean(localFilm))
  $('#myTvTitleLocalCopy').textContent = detail.on_mabeltv && !localFilm
    ? `Available locally on ${tvName()}. Stored episodes offer Play on TV and Watch on this device.` : ''
  const filmActions = $('#myTvTitleFilmActions')
  filmActions.classList.remove('is-loading-placeholder')
  filmActions.classList.toggle('hidden', !localFilm)
  filmActions.querySelectorAll('button').forEach(button => { button.disabled = false })
  if (localFilm) configureFilmPlaybackActions(localFilm, detail.local_context || 'library', {
    tvPlay: $('#myTvTitleFilmTv'), herePlay: $('#myTvTitleFilmHere'),
    close: closeMyTvTitleSheet,
    reopen: () => restoreMyTvTitleSheet(detail),
  })
  wireMyTvTitleIntentActions(detail)
  if (isSeries && syncProgress) void syncMyTvTitleEpisodeStatus(detail).catch(showError)
  const settings = $('#myTvTitleMore')
  const localSeriesActions = localSeries && (localSeries.episodes || []).length
  settings.classList.toggle('hidden', !localFilm && !localSeriesActions)
  settings.setAttribute('aria-label', localFilm ? 'Film settings' : 'Series settings')
  settings.title = localFilm ? 'Film settings' : 'Series settings'
  settings.onclick = localFilm ? () => {
    portalSheets.dismiss(sheet)
    openMyTvFilmSheet(localFilm, () => restoreMyTvTitleSheet(detail))
  } : localSeriesActions ? () => {
    portalSheets.dismiss(sheet)
    openMyTvSeriesMoreSheet(localSeries, null, () => restoreMyTvTitleSheet(detail))
  } : null
  const returnTo = portalSheets.returnTo(sheet)
  const restoreTitle = () => restoreMyTvTitleSheet(detail, returnTo)
  renderMyTvTitleEnrichment(detail, 'myTvTitle', part => {
    portalSheets.suspend(sheet, { card: true })
    void openMyTvTitle({
      ...part, catalogue_only: detail.catalogue_only === true,
    }, restoreTitle)
  }, (person, title) => {
    portalSheets.suspend(sheet, { card: true })
    void openMyTvPerson(person, title, restoreTitle)
  })
  $('#myTvProviderRefresh').classList.toggle('hidden', !myTvAvailabilityEnabled()
    || detail.catalogue_only === true)
  $('#myTvProviderRefresh').onclick = () => loadMyTvProviders(detail, true, revision)
  if (detail.catalogue_only) {
    if (myTvAvailabilityEnabled()) renderMyTvProviderLinks(detail, { sources: [] })
    else renderMyTvAvailabilityDisabled($('#myTvProviderList'), detail, {
      localAction: null,
      purchaseSection: $('#myTvTitleRentBuy'), purchaseRoot: $('#myTvTitleRentBuyList'),
    })
  } else {
    if (detail.provider_result || (detail.providers || []).length) {
      renderMyTvProviderLinks(detail, detail.provider_result || { sources: [] })
    }
    if (refreshProviders) loadMyTvProviders(detail, false, revision)
  }
}

function myTvTitleLoadingBlock(className = '') {
  const block = document.createElement('span')
  block.className = `my-tv-title-loading-block${className ? ` ${className}` : ''}`
  block.setAttribute('aria-hidden', 'true')
  return block
}

function renderMyTvTitleLoadingRail(root, kind, count) {
  root.replaceChildren()
  for (let index = 0; index < count; index += 1) {
    root.append(myTvTitleLoadingBlock(`my-tv-title-loading-${kind}`))
  }
}

function renderMyTvTitleLoadingMetadata(root, isSeries) {
  root.replaceChildren()
  root.classList.add('is-title-facts', 'is-loading-placeholder')
  root.classList.toggle('is-series-title-facts', isSeries)
  const labels = isSeries
    ? ['Aired from', 'Series', 'Episodes', 'Genre', 'Created by', 'TMDB']
    : ['Release', 'Runtime', 'Genre', 'TMDB', 'Director']
  labels.forEach((text, index) => {
    const fact = document.createElement('span')
    fact.className = `my-tv-title-fact${index === labels.length - (isSeries ? 2 : 1)
      ? ' my-tv-title-credit' : ''}`
    const label = document.createElement('small')
    label.textContent = text
    fact.append(label, myTvTitleLoadingBlock('my-tv-title-loading-value'))
    root.append(fact)
  })
}

function renderMyTvTitleLoadingShell(title) {
  const isSeries = title.media_type === 'tv'
  renderMyTvTitleLoadingMetadata($('#myTvTitleMeta'), isSeries)
  $('#myTvTitlePoster').replaceChildren(
    myTvTitleLoadingBlock('my-tv-title-loading-cover'))

  const overview = $('#myTvTitleOverview')
  overview.replaceChildren()
  ;['wide', 'wide', 'medium', 'short'].forEach(width =>
    overview.append(myTvTitleLoadingBlock(`my-tv-title-loading-copy is-${width}`)))

  $('#myTvTitleIntents').classList.add('is-loading-placeholder')

  const seriesLibrary = $('#myTvTitleSeriesLibrary')
  seriesLibrary.classList.toggle('hidden', !isSeries)
  seriesLibrary.classList.toggle('is-loading-placeholder', isSeries)
  $('#myTvTitleNextEpisode').classList.add('hidden')
  $('#myTvTitleSeasonCount').textContent = isSeries ? 'Loading…' : ''
  renderMyTvTitleLoadingRail($('#myTvTitleSeasons'), 'season', 2)

  const franchise = $('#myTvTitleFranchise')
  franchise.classList.toggle('hidden', isSeries)
  franchise.classList.toggle('is-loading-placeholder', !isSeries)
  $('#myTvTitleFranchiseName').textContent = 'Film collection'
  renderMyTvTitleLoadingRail($('#myTvTitleFranchiseRail'), 'poster', 5)

  const cast = $('#myTvTitleCast')
  cast.classList.remove('hidden')
  cast.classList.add('is-loading-placeholder')
  renderMyTvTitleLoadingRail($('#myTvTitleCastRail'), 'person', 6)

  const providers = $('#myTvProviderList')
  providers.replaceChildren()
  const providerRow = document.createElement('div')
  providerRow.className = 'my-tv-title-loading-providers'
  for (let index = 0; index < 5; index += 1) {
    providerRow.append(myTvTitleLoadingBlock('my-tv-title-loading-provider'))
  }
  providers.append(providerRow)
}

function prepareMyTvTitleSheet(title) {
  const sheet = $('#myTvTitleSheet')
  const panel = sheet.querySelector('.watch-film-panel')
  const body = sheet.querySelector('.watch-film-body')
  selectedMyTvTitle = title
  sheet.classList.add('is-loading-title')
  sheet.classList.toggle('is-catalogue-only', title.catalogue_only === true)
  sheet.setAttribute('aria-busy', 'true')
  panel.scrollTop = 0
  panel.scrollLeft = 0
  body.scrollTop = 0
  body.scrollLeft = 0
  sheet.classList.toggle('is-series', title.media_type === 'tv')
  $('#myTvTitleName').textContent = title.title || 'Loading title…'
  const localFilm = localMyTvFilmForTitle(title)
  const eyebrow = $('#myTvTitleEyebrow')
  eyebrow.textContent = localFilm ? `On ${tvName()}` : title.media_type === 'tv'
    ? 'Streaming TV series' : 'Film'
  eyebrow.classList.toggle('is-mabeltv', Boolean(localFilm || title.on_mabeltv))
  renderMyTvTitleLoadingShell(title)
  renderMyTvPersonalRating($('#myTvTitlePersonalRating'), title)
  $('#myTvTitleBackdrop').style.setProperty('--watch-film-art',
    'linear-gradient(135deg,#27252c,#101014)')
  $('#myTvTitleLocal').classList.add('hidden')
  $('#myTvTitleLocalCopy').textContent = ''
  const filmActions = $('#myTvTitleFilmActions')
  filmActions.classList.toggle('hidden', !localFilm)
  filmActions.classList.toggle('is-loading-placeholder', Boolean(localFilm))
  filmActions.querySelectorAll('button').forEach(button => { button.disabled = true })
  $('#myTvTitleFilmTv').onclick = null
  $('#myTvTitleFilmHere').onclick = null
  $('#myTvTitleMore').classList.add('hidden')
  $('#myTvTitleMore').onclick = null
  $('#myTvTitleRentBuy').classList.add('hidden')
  $('#myTvTitleRentBuyList').replaceChildren()
  $('#myTvTitleIntents').querySelectorAll('[data-viewing-action]').forEach(button => {
    button.classList.remove('active', 'is-unavailable')
    button.setAttribute('aria-pressed', 'false')
  })
  return sheet
}

async function openMyTvTitle(title, returnTo = null) {
  const revision = ++myTvTitleOpenRevision
  const localContext = title.local_context || 'library'
  const sheet = prepareMyTvTitleSheet(title)
  portalSheets.open(sheet, { returnTo, focus: sheet.querySelector('.watch-film-panel') })
  const cacheKey = `my-tv-title-v1:${title.media_type}:${Number(title.tmdb_id)}`
  const preview = {
    ...title, key: title.key || `${title.media_type}:${Number(title.tmdb_id)}`,
    viewing: myTvViewingRecord(title), seasons: title.seasons || [],
    providers: title.providers || [], local_context: localContext,
    catalogue_only: title.catalogue_only === true,
  }
  renderMyTvTitleDetail(preview, false, revision, false)
  try {
    const cached = await readPortalDataCache(cacheKey)
    let displayed = preview
    if (cached && revision === myTvTitleOpenRevision) {
      displayed = {
        ...cached.data, viewing: myTvViewingRecord(title),
        local_context: localContext, catalogue_only: title.catalogue_only === true,
      }
      renderMyTvTitleDetail(displayed, false, revision, false)
      rememberMyTvTitleMetadata(displayed, title)
    }
    const detail = await api(
      `/api/my-tv/title?media_type=${title.media_type}&tmdb_id=${title.tmdb_id}`)
    if (revision !== myTvTitleOpenRevision) return
    const fresh = { ...detail, viewing: myTvViewingRecord(title),
      local_context: localContext,
      catalogue_only: title.catalogue_only === true }
    rememberMyTvTitleMetadata(fresh, title)
    if (cached) {
      const providerResult = displayed.provider_result
      Object.assign(displayed, fresh)
      if (providerResult) displayed.provider_result = providerResult
      selectedMyTvTitle = displayed
      if (displayed.media_type === 'tv') {
        void syncMyTvTitleEpisodeStatus(displayed).catch(() => {})
      }
      void writePortalDataCache(cacheKey, { ...detail, provider_result: providerResult })
      void loadMyTvProviders(displayed, false, revision)
    } else {
      renderMyTvTitleDetail(fresh, true, revision)
      void writePortalDataCache(cacheKey, detail)
    }
  } catch (error) {
    if (revision !== myTvTitleOpenRevision) return
    sheet.classList.remove('is-loading-title')
    sheet.removeAttribute('aria-busy')
    $('#myTvTitleMeta').classList.remove('is-loading-placeholder')
    $('#myTvTitleIntents').classList.remove('is-loading-placeholder')
    $('#myTvProviderList').innerHTML = '<p>Latest title details could not be loaded.</p>'
  }
}

$('#watchSearch')?.addEventListener('input', scheduleMyTvDiscovery)
$('#watchSearch')?.addEventListener('focus', () => {
  syncMyTvSearchMode(); scheduleMyTvDiscovery()
})
$('#watchSearch')?.addEventListener('blur', () => setTimeout(() => syncMyTvSearchMode(), 0))
$('#watchSearch')?.addEventListener('change', () => setTimeout(syncMyTvSearchKeyboard, 60))
$('#watchSearch')?.addEventListener('search', () => setTimeout(syncMyTvSearchKeyboard, 60))
$('#watchSearch')?.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  event.currentTarget.value = ''
  event.currentTarget.dispatchEvent(new Event('input', { bubbles: true }))
  event.currentTarget.blur()
})
$('#watchSearchClear')?.addEventListener('click', () => setTimeout(() => {
  searchMyTvDiscovery(''); syncMyTvSearchMode()
}, 0))
window.visualViewport?.addEventListener('resize', () =>
  setTimeout(syncMyTvSearchKeyboard, 60))
window.addEventListener('orientationchange', () => setTimeout(() => {
  myTvSearchViewportBaseline = window.visualViewport?.height || window.innerHeight
  myTvSearchKeyboardWasOpen = false
}, 400))
$('#myTvMyViewing')?.addEventListener('click', () => {
  history.replaceState({ myTvHome: true }, '', '#my-tv')
  history.pushState({ myTvViewing: true }, '', '#my-tv-viewing')
  openView('my-tv-viewing')
})
$('#myTvViewingBack')?.addEventListener('click', () => {
  if (history.state?.myTvViewing) { history.back(); return }
  history.replaceState({ myTvHome: true }, '', '#my-tv')
  openView('my-tv-home', { instantScroll: true })
})

function closeMyTvTitleSheet() {
  myTvTitleOpenRevision += 1
  selectedMyTvTitle = null
  portalSheets.dismissJourney()
}
$('#myTvTitleClose')?.addEventListener('click', closeMyTvTitleSheet)
$('#myTvTitleSheet')?.addEventListener('click', event => { if (event.target === $('#myTvTitleSheet')) closeMyTvTitleSheet() })
$('#myTvTitleSheet')?.addEventListener('cancel', event => {
  event.preventDefault()
  closeMyTvTitleSheet()
})
function closeMyTvTitleSeasonSheet() {
  myTvSeasonOpenRevision += 1
  portalSheets.dismissJourney()
}
$('#myTvTitleSeasonClose')?.addEventListener('click', closeMyTvTitleSeasonSheet)
$('#myTvTitleSeasonSheet')?.addEventListener('click', event => { if (event.target === $('#myTvTitleSeasonSheet')) closeMyTvTitleSeasonSheet() })
$('#myTvTitleSeasonSheet')?.addEventListener('cancel', event => { event.preventDefault(); closeMyTvTitleSeasonSheet() })
portalSheets.wire($('#myTvTitleSeasonSettingsSheet'), {
  closeButton: $('#myTvTitleSeasonSettingsClose'),
})
$('#myTvNetflixLaunchClose')?.addEventListener('click', closeNetflixLaunchChoice)
$('#myTvNetflixLaunchSheet')?.addEventListener('click', event => { if (event.target === $('#myTvNetflixLaunchSheet')) closeNetflixLaunchChoice() })
$('#myTvNetflixLaunchDevice')?.addEventListener('click', launchNetflixOnDevice)
$('#myTvNetflixLaunchTv')?.addEventListener('click', () => { void launchNetflixOnTv() })
function closeMyTvEpisodeLaunchSheet() {
  portalSheets.dismiss($('#myTvEpisodeLaunchSheet'))
}
$('#myTvEpisodeLaunchClose')?.addEventListener('click', closeMyTvEpisodeLaunchSheet)
$('#myTvEpisodeLaunchSheet')?.addEventListener('click', event => {
  if (event.target === $('#myTvEpisodeLaunchSheet')) closeMyTvEpisodeLaunchSheet()
})
