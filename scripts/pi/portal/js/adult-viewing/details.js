'use strict'

function adultExactDateLabel(value) {
  const source = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return ''
  const date = new Date(`${source}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date)
}

function renderAdultTitleMetadata(root, detail, {
  facts = [], creditLabel = '', credits = [], seriesLayout = false,
} = {}) {
  root.replaceChildren()
  root.classList.add('is-title-facts')
  root.classList.toggle('is-series-title-facts', seriesLayout)
  let ratingFact = null
  facts.filter(fact => fact?.value).forEach(fact => {
    const span = document.createElement('span')
    span.className = 'adult-title-fact'
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
    fact.className = 'adult-title-fact adult-title-rating'
    const mark = document.createElement('small')
    const logo = document.createElement('i')
    logo.className = 'adult-title-rating-mark'
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
    credit.className = 'adult-title-fact adult-title-credit'
    const label = document.createElement('small')
    label.textContent = creditLabel
    const names = document.createElement('strong')
    names.textContent = credits.map(name => String(name).trim().replace(/\s+/g, '\u00a0')).join(', ')
    credit.append(label, names)
    root.append(credit)
  }
  if (ratingFact) root.append(ratingFact)
}

function clearAdultTitleEnrichment(prefix) {
  for (const suffix of ['Franchise', 'Cast']) {
    const section = $(`#${prefix}${suffix}`)
    section?.classList.add('hidden')
    section?.classList.remove('is-loading-placeholder')
    $(`#${prefix}${suffix}Rail`)?.replaceChildren()
  }
}

function adultCreditCard(person, detail, openPerson, fallbackRole) {
  const interactive = Number(person.tmdb_id || 0) > 0
  const card = document.createElement(interactive ? 'button' : 'article')
  if (interactive) card.type = 'button'
  card.className = 'adult-cast-card'
  const portrait = document.createElement('span')
  portrait.className = 'adult-cast-photo'
  if (person.profile_path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = adultPosterUrl(person.profile_path, 'w185')
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

function appendAdultCreditGroup(rail, label, people, detail, openPerson, role) {
  if (!people.length) return
  const group = document.createElement('div')
  group.className = 'adult-credit-group'
  const heading = document.createElement('span')
  heading.className = 'adult-credit-group-label'
  heading.textContent = label
  const cards = document.createElement('div')
  cards.className = 'adult-credit-group-cards'
  people.forEach(person => cards.append(adultCreditCard(
    person, detail, openPerson, role)))
  group.append(heading, cards)
  rail.append(group)
}

function renderAdultTitleEnrichment(detail, prefix, openTitle, openPerson = openAdultPerson) {
  clearAdultTitleEnrichment(prefix)
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
      card.className = `adult-franchise-card${current ? ' is-current' : ''}`
      card.disabled = current
      if (current) card.setAttribute('aria-current', 'true')
      card.setAttribute('aria-label', current ? `${part.title}, current film` : `Open ${part.title}`)
      const art = document.createElement('span')
      art.className = 'adult-franchise-art'
      if (part.poster_path) {
        const image = document.createElement('img')
        image.loading = 'lazy'
        image.decoding = 'async'
        image.src = adultPosterUrl(part.poster_path, 'w185')
        image.alt = ''
        art.append(image)
      } else {
        const placeholder = document.createElement('b')
        placeholder.textContent = String(part.title || '?').slice(0, 1).toUpperCase()
        art.append(placeholder)
      }
      if (part.on_mabeltv) {
        const local = document.createElement('i')
        local.textContent = 'MabelTV'
        art.append(local)
      }
      appendAdultArtworkStatus(art, part)
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
    appendAdultCreditGroup(castRail, leadLabel, leads, detail, openPerson,
      detail.media_type === 'tv' ? 'Creator' : 'Director')
    if (leads.length && cast.length) {
      const divider = document.createElement('span')
      divider.className = 'adult-credit-divider'
      divider.setAttribute('aria-hidden', 'true')
      castRail.append(divider)
    }
    appendAdultCreditGroup(castRail, 'Cast', cast, detail, openPerson, 'Cast')
    castSection.classList.remove('hidden')
  }
}

function adultTitleIntentAction(detail, button, request, root = $('#adultTitleIntents'), onUpdate = null) {
  return async () => {
    if (button.disabled || button.dataset.saving === 'true') return
    button.dataset.saving = 'true'
    try {
      const { action, extra = {} } = request()
      detail.viewing = await updateAdultViewing(detail, action, extra, viewing => {
        detail.viewing = viewing
        syncAdultTitleButtons(detail, root)
        if (typeof syncAdultPersonalRatingForIntentRoot === 'function') {
          syncAdultPersonalRatingForIntentRoot(root, detail)
        }
        if (onUpdate) onUpdate(viewing)
        if (root?.id === 'adultTitleIntents') syncAdultTitleNextEpisode(detail)
      })
    } catch (error) {
      showError(error)
    } finally {
      delete button.dataset.saving
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
  clearAdultTitleEnrichment('watchFilm')
  $('#watchFilmRentBuy')?.classList.add('hidden')
  $('#watchFilmRentBuyList')?.replaceChildren()
  section.classList.remove('hidden')
  const refreshButton = $('#watchFilmProviderRefresh')
  const availabilityEnabled = adultAvailabilityEnabled()
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
      api(`/api/adult/title?media_type=movie&tmdb_id=${detail.tmdb_id}`),
      availabilityEnabled
        ? api(`/api/adult/providers?media_type=movie&tmdb_id=${detail.tmdb_id}${refresh ? '&refresh=1' : ''}`)
        : Promise.resolve({ sources: [], disabled: true }),
    ])
    if (revision !== localFilmProviderRevision || root.dataset.providerKey !== detail.key) return
    const fullDetail = {
      ...title,
      on_mabeltv: true,
      local: { kind: 'film', path: film.path },
    }
    const directors = fullDetail.directors || []
    renderAdultTitleMetadata($('#watchFilmMeta'), fullDetail, {
      facts: [
        { label: 'Release', value: adultExactDateLabel(fullDetail.release_date) || fullDetail.year },
        { label: 'Runtime', value: fullDetail.runtime ? `${fullDetail.runtime} min` : '' },
        { label: 'Genre', value: (fullDetail.genres || [])[0] || '' },
      ],
      creditLabel: directors.length > 1 ? 'Directors' : 'Director',
      credits: directors,
    })
    const filmSheet = $('#watchFilmSheet')
    const filmReturnTo = portalSheets.returnTo(filmSheet) || selectedWatchFilmReturnTo
    const restoreFilm = () => openWatchFilmSheet(film, selectedWatchFilmContext, filmReturnTo)
    renderAdultTitleEnrichment(fullDetail, 'watchFilm', part => {
      portalSheets.suspend(filmSheet, { card: true })
      void openAdultTitle(part, restoreFilm)
    }, (person, title) => {
      portalSheets.suspend(filmSheet, { card: true })
      void openAdultPerson(person, title, restoreFilm)
    })
    const options = { localAction: null, purchaseSection: $('#watchFilmRentBuy'),
      purchaseRoot: $('#watchFilmRentBuyList') }
    if (availabilityEnabled) renderAdultProviderLinksInto(root, fullDetail, sources, options)
    else renderAdultAvailabilityDisabled(root, fullDetail, options)
  } catch (error) {
    if (revision !== localFilmProviderRevision || root.dataset.providerKey !== detail.key) return
    renderAdultProviderLinksInto(root, { ...detail, on_mabeltv: true }, { sources: [] }, {
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

function localAdultFilmForTitle(title = {}) {
  if (title.media_type !== 'movie') return null
  const localPath = title.local?.kind === 'film' ? title.local.path : ''
  const tmdbId = Number(title.tmdb_id || 0)
  return (library?.adult_library || []).find(film => film.path === localPath)
    || (tmdbId ? (library?.adult_library || []).find(film =>
      Number(film.metadata?.tmdb_id || 0) === tmdbId) : null)
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
                                revision = adultTitleOpenRevision, syncProgress = true) {
  const sheet = $('#adultTitleSheet')
  const localSeries = detail.media_type === 'tv' ? localAdultSeriesForTitle(detail) : null
  const localFilm = localAdultFilmForTitle(detail)
  if (localSeries) {
    detail.local = { kind: 'series', series: localSeries.id,
      watched_count: Number(localSeries.watched_count || 0) }
  }
  if (detail.media_type === 'tv') detail.on_mabeltv = Boolean((localSeries?.episodes || []).length)
  selectedAdultTitle = detail
  sheet.classList.remove('is-loading-title')
  sheet.removeAttribute('aria-busy')
  $('#adultTitleMeta').classList.remove('is-loading-placeholder')
  $('#adultTitleIntents').classList.remove('is-loading-placeholder')
  const isSeries = detail.media_type === 'tv'
  sheet.classList.toggle('is-series', isSeries)
  $('#adultTitleName').textContent = detail.title
  const eyebrow = $('#adultTitleEyebrow')
  eyebrow.textContent = detail.on_mabeltv
    ? 'On MabelTV' : isSeries ? 'Streaming TV series' : 'Film'
  eyebrow.classList.toggle('is-mabeltv', detail.on_mabeltv === true)
  $('#adultTitleOverview').textContent = detail.overview || 'No description is available.'
  renderAdultTitleSeasons(detail)
  const date = isSeries
    ? adultExactDateLabel(detail.first_air_date)
    : adultExactDateLabel(detail.release_date)
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
  renderAdultTitleMetadata($('#adultTitleMeta'), detail, {
    facts,
    creditLabel: isSeries ? 'Created by' : credits.length > 1 ? 'Directors' : 'Director',
    credits,
    seriesLayout: isSeries,
  })
  renderAdultPersonalRating($('#adultTitlePersonalRating'), detail)
  const poster = $('#adultTitlePoster')
  poster.replaceChildren()
  if (detail.poster_path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = adultPosterUrl(detail.poster_path, 'w500')
    image.alt = `Poster for ${detail.title}`
    poster.append(image)
  }
  $('#adultTitleBackdrop').style.setProperty('--watch-film-art', detail.backdrop_path
    ? `url("${adultPosterUrl(detail.backdrop_path, 'w1280')}")`
    : 'linear-gradient(135deg,#2e3a34,#101513)')
  $('#adultTitleLocal').classList.toggle('hidden', !detail.on_mabeltv || Boolean(localFilm))
  $('#adultTitleLocalCopy').textContent = detail.on_mabeltv && !localFilm
    ? 'Available locally on MabelTV. Stored episodes offer Play on TV and Watch on this device.' : ''
  const filmActions = $('#adultTitleFilmActions')
  filmActions.classList.remove('is-loading-placeholder')
  filmActions.classList.toggle('hidden', !localFilm)
  filmActions.querySelectorAll('button').forEach(button => { button.disabled = false })
  if (localFilm) configureFilmPlaybackActions(localFilm, detail.local_context || 'library', {
    tvPlay: $('#adultTitleFilmTv'), herePlay: $('#adultTitleFilmHere'),
    close: closeAdultTitleSheet,
    reopen: () => restoreAdultTitleSheet(detail),
  })
  wireAdultTitleIntentActions(detail)
  if (isSeries && syncProgress) void syncAdultTitleEpisodeStatus(detail).catch(showError)
  const settings = $('#adultTitleMore')
  const localSeriesActions = localSeries && (localSeries.episodes || []).length
  settings.classList.toggle('hidden', !localFilm && !localSeriesActions)
  settings.setAttribute('aria-label', localFilm ? 'Film settings' : 'Series settings')
  settings.title = localFilm ? 'Film settings' : 'Series settings'
  settings.onclick = localFilm ? () => {
    portalSheets.dismiss(sheet)
    openAdultFilmSheet(localFilm, () => restoreAdultTitleSheet(detail))
  } : localSeriesActions ? () => {
    portalSheets.dismiss(sheet)
    openAdultSeriesMoreSheet(localSeries, null, () => restoreAdultTitleSheet(detail))
  } : null
  const returnTo = portalSheets.returnTo(sheet)
  const restoreTitle = () => restoreAdultTitleSheet(detail, returnTo)
  renderAdultTitleEnrichment(detail, 'adultTitle', part => {
    portalSheets.suspend(sheet, { card: true })
    void openAdultTitle({
      ...part, catalogue_only: detail.catalogue_only === true,
    }, restoreTitle)
  }, (person, title) => {
    portalSheets.suspend(sheet, { card: true })
    void openAdultPerson(person, title, restoreTitle)
  })
  $('#adultProviderRefresh').classList.toggle('hidden', !adultAvailabilityEnabled()
    || detail.catalogue_only === true)
  $('#adultProviderRefresh').onclick = () => loadAdultProviders(detail, true, revision)
  if (detail.catalogue_only) {
    if (adultAvailabilityEnabled()) renderAdultProviderLinks(detail, { sources: [] })
    else renderAdultAvailabilityDisabled($('#adultProviderList'), detail, {
      localAction: null,
      purchaseSection: $('#adultTitleRentBuy'), purchaseRoot: $('#adultTitleRentBuyList'),
    })
  } else {
    if (detail.provider_result || (detail.providers || []).length) {
      renderAdultProviderLinks(detail, detail.provider_result || { sources: [] })
    }
    if (refreshProviders) loadAdultProviders(detail, false, revision)
  }
}

function adultTitleLoadingBlock(className = '') {
  const block = document.createElement('span')
  block.className = `adult-title-loading-block${className ? ` ${className}` : ''}`
  block.setAttribute('aria-hidden', 'true')
  return block
}

function renderAdultTitleLoadingRail(root, kind, count) {
  root.replaceChildren()
  for (let index = 0; index < count; index += 1) {
    root.append(adultTitleLoadingBlock(`adult-title-loading-${kind}`))
  }
}

function renderAdultTitleLoadingMetadata(root, isSeries) {
  root.replaceChildren()
  root.classList.add('is-title-facts', 'is-loading-placeholder')
  root.classList.toggle('is-series-title-facts', isSeries)
  const labels = isSeries
    ? ['Aired from', 'Series', 'Episodes', 'Genre', 'Created by', 'TMDB']
    : ['Release', 'Runtime', 'Genre', 'TMDB', 'Director']
  labels.forEach((text, index) => {
    const fact = document.createElement('span')
    fact.className = `adult-title-fact${index === labels.length - (isSeries ? 2 : 1)
      ? ' adult-title-credit' : ''}`
    const label = document.createElement('small')
    label.textContent = text
    fact.append(label, adultTitleLoadingBlock('adult-title-loading-value'))
    root.append(fact)
  })
}

function renderAdultTitleLoadingShell(title) {
  const isSeries = title.media_type === 'tv'
  renderAdultTitleLoadingMetadata($('#adultTitleMeta'), isSeries)
  $('#adultTitlePoster').replaceChildren(
    adultTitleLoadingBlock('adult-title-loading-cover'))

  const overview = $('#adultTitleOverview')
  overview.replaceChildren()
  ;['wide', 'wide', 'medium', 'short'].forEach(width =>
    overview.append(adultTitleLoadingBlock(`adult-title-loading-copy is-${width}`)))

  $('#adultTitleIntents').classList.add('is-loading-placeholder')

  const seriesLibrary = $('#adultTitleSeriesLibrary')
  seriesLibrary.classList.toggle('hidden', !isSeries)
  seriesLibrary.classList.toggle('is-loading-placeholder', isSeries)
  $('#adultTitleNextEpisode').classList.add('hidden')
  $('#adultTitleSeasonCount').textContent = isSeries ? 'Loading…' : ''
  renderAdultTitleLoadingRail($('#adultTitleSeasons'), 'season', 2)

  const franchise = $('#adultTitleFranchise')
  franchise.classList.toggle('hidden', isSeries)
  franchise.classList.toggle('is-loading-placeholder', !isSeries)
  $('#adultTitleFranchiseName').textContent = 'Film collection'
  renderAdultTitleLoadingRail($('#adultTitleFranchiseRail'), 'poster', 5)

  const cast = $('#adultTitleCast')
  cast.classList.remove('hidden')
  cast.classList.add('is-loading-placeholder')
  renderAdultTitleLoadingRail($('#adultTitleCastRail'), 'person', 6)

  const providers = $('#adultProviderList')
  providers.replaceChildren()
  const providerRow = document.createElement('div')
  providerRow.className = 'adult-title-loading-providers'
  for (let index = 0; index < 5; index += 1) {
    providerRow.append(adultTitleLoadingBlock('adult-title-loading-provider'))
  }
  providers.append(providerRow)
}

function prepareAdultTitleSheet(title) {
  const sheet = $('#adultTitleSheet')
  const panel = sheet.querySelector('.watch-film-panel')
  const body = sheet.querySelector('.watch-film-body')
  selectedAdultTitle = title
  sheet.classList.add('is-loading-title')
  sheet.classList.toggle('is-catalogue-only', title.catalogue_only === true)
  sheet.setAttribute('aria-busy', 'true')
  panel.scrollTop = 0
  panel.scrollLeft = 0
  body.scrollTop = 0
  body.scrollLeft = 0
  sheet.classList.toggle('is-series', title.media_type === 'tv')
  $('#adultTitleName').textContent = title.title || 'Loading title…'
  const localFilm = localAdultFilmForTitle(title)
  const eyebrow = $('#adultTitleEyebrow')
  eyebrow.textContent = localFilm ? 'On MabelTV' : title.media_type === 'tv'
    ? 'Streaming TV series' : 'Film'
  eyebrow.classList.toggle('is-mabeltv', Boolean(localFilm || title.on_mabeltv))
  renderAdultTitleLoadingShell(title)
  renderAdultPersonalRating($('#adultTitlePersonalRating'), title)
  $('#adultTitleBackdrop').style.setProperty('--watch-film-art',
    'linear-gradient(135deg,#27252c,#101014)')
  $('#adultTitleLocal').classList.add('hidden')
  $('#adultTitleLocalCopy').textContent = ''
  const filmActions = $('#adultTitleFilmActions')
  filmActions.classList.toggle('hidden', !localFilm)
  filmActions.classList.toggle('is-loading-placeholder', Boolean(localFilm))
  filmActions.querySelectorAll('button').forEach(button => { button.disabled = true })
  $('#adultTitleFilmTv').onclick = null
  $('#adultTitleFilmHere').onclick = null
  $('#adultTitleMore').classList.add('hidden')
  $('#adultTitleMore').onclick = null
  $('#adultTitleRentBuy').classList.add('hidden')
  $('#adultTitleRentBuyList').replaceChildren()
  $('#adultTitleIntents').querySelectorAll('[data-viewing-action]').forEach(button => {
    button.classList.remove('active', 'is-unavailable')
    button.setAttribute('aria-pressed', 'false')
  })
  return sheet
}

async function openAdultTitle(title, returnTo = null) {
  const revision = ++adultTitleOpenRevision
  const localContext = title.local_context || 'library'
  const sheet = prepareAdultTitleSheet(title)
  portalSheets.open(sheet, { returnTo, focus: sheet.querySelector('.watch-film-panel') })
  const cacheKey = `adult-title-v1:${title.media_type}:${Number(title.tmdb_id)}`
  const preview = {
    ...title, key: title.key || `${title.media_type}:${Number(title.tmdb_id)}`,
    viewing: adultViewingRecord(title), seasons: title.seasons || [],
    providers: title.providers || [], local_context: localContext,
    catalogue_only: title.catalogue_only === true,
  }
  renderAdultTitleDetail(preview, false, revision, false)
  try {
    const cached = await readPortalDataCache(cacheKey)
    let displayed = preview
    if (cached && revision === adultTitleOpenRevision) {
      displayed = {
        ...cached.data, viewing: adultViewingRecord(title),
        local_context: localContext, catalogue_only: title.catalogue_only === true,
      }
      renderAdultTitleDetail(displayed, false, revision, false)
    }
    const detail = await api(
      `/api/adult/title?media_type=${title.media_type}&tmdb_id=${title.tmdb_id}`)
    if (revision !== adultTitleOpenRevision) return
    const fresh = { ...detail, viewing: adultViewingRecord(title),
      local_context: localContext,
      catalogue_only: title.catalogue_only === true }
    if (cached) {
      const providerResult = displayed.provider_result
      Object.assign(displayed, fresh)
      if (providerResult) displayed.provider_result = providerResult
      selectedAdultTitle = displayed
      if (displayed.media_type === 'tv') {
        void syncAdultTitleEpisodeStatus(displayed).catch(() => {})
      }
      void writePortalDataCache(cacheKey, { ...detail, provider_result: providerResult })
      void loadAdultProviders(displayed, false, revision)
    } else {
      renderAdultTitleDetail(fresh, true, revision)
      void writePortalDataCache(cacheKey, detail)
    }
  } catch (error) {
    if (revision !== adultTitleOpenRevision) return
    sheet.classList.remove('is-loading-title')
    sheet.removeAttribute('aria-busy')
    $('#adultTitleMeta').classList.remove('is-loading-placeholder')
    $('#adultTitleIntents').classList.remove('is-loading-placeholder')
    $('#adultProviderList').innerHTML = '<p>Latest title details could not be loaded.</p>'
  }
}

$('#watchSearch')?.addEventListener('input', scheduleAdultDiscovery)
$('#watchSearch')?.addEventListener('focus', () => {
  syncAdultSearchMode(); scheduleAdultDiscovery()
})
$('#watchSearch')?.addEventListener('blur', () => setTimeout(() => syncAdultSearchMode(), 0))
$('#watchSearch')?.addEventListener('change', () => setTimeout(syncAdultSearchKeyboard, 60))
$('#watchSearch')?.addEventListener('search', () => setTimeout(syncAdultSearchKeyboard, 60))
$('#watchSearch')?.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  event.currentTarget.value = ''
  event.currentTarget.dispatchEvent(new Event('input', { bubbles: true }))
  event.currentTarget.blur()
})
$('#watchSearchClear')?.addEventListener('click', () => setTimeout(() => {
  searchAdultDiscovery(''); syncAdultSearchMode()
}, 0))
window.visualViewport?.addEventListener('resize', () =>
  setTimeout(syncAdultSearchKeyboard, 60))
window.addEventListener('orientationchange', () => setTimeout(() => {
  adultSearchViewportBaseline = window.visualViewport?.height || window.innerHeight
  adultSearchKeyboardWasOpen = false
}, 400))
$('#adultMyViewing')?.addEventListener('click', () => {
  history.replaceState({ adultHome: true }, '', '#adult-tv')
  history.pushState({ adultViewing: true }, '', '#adult-viewing')
  openView('adult-viewing')
})
$('#adultViewingBack')?.addEventListener('click', () => {
  if (history.state?.adultViewing) { history.back(); return }
  history.replaceState({ adultHome: true }, '', '#adult-tv')
  openView('adult-home', { instantScroll: true })
})

function closeAdultTitleSheet() {
  adultTitleOpenRevision += 1
  selectedAdultTitle = null
  portalSheets.dismissJourney()
}
$('#adultTitleClose')?.addEventListener('click', closeAdultTitleSheet)
$('#adultTitleSheet')?.addEventListener('click', event => { if (event.target === $('#adultTitleSheet')) closeAdultTitleSheet() })
$('#adultTitleSheet')?.addEventListener('cancel', event => {
  event.preventDefault()
  closeAdultTitleSheet()
})
function closeAdultTitleSeasonSheet() {
  adultSeasonOpenRevision += 1
  portalSheets.dismissJourney()
}
$('#adultTitleSeasonClose')?.addEventListener('click', closeAdultTitleSeasonSheet)
$('#adultTitleSeasonSheet')?.addEventListener('click', event => { if (event.target === $('#adultTitleSeasonSheet')) closeAdultTitleSeasonSheet() })
$('#adultTitleSeasonSheet')?.addEventListener('cancel', event => { event.preventDefault(); closeAdultTitleSeasonSheet() })
portalSheets.wire($('#adultTitleSeasonSettingsSheet'), {
  closeButton: $('#adultTitleSeasonSettingsClose'),
})
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
