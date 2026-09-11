'use strict'

const adultInsightsCache = readPortalDataCache('adult-insights-v1')
let adultInsightsData = adultInsightsCache?.data || null
let adultInsightsLoadedAt = Number(adultInsightsCache?.saved_at || 0)
let adultInsightsRendered = false
let adultInsightsRequest = null
let myInsightsMode = 'adult'
let adultInsightsPoll = null
let adultInsightBrowseRoute = null
let adultInsightBrowseSearch = ''
let adultInsightBrowseSort = 'az'

function adultInsightDestroyChart(root) {
  if (!root) return
  const chart = viewingCharts.get(root)
  if (chart) chart.destroy()
  viewingCharts.delete(root)
  root.replaceChildren()
}

function adultInsightChart(root, values, type = 'bar', options = {}) {
  if (!root) return
  adultInsightDestroyChart(root)
  const allValues = values || []
  const usable = options.keepZeros
    ? allValues : allValues.filter(value => Number(value.count || 0) > 0)
  if (!usable.some(value => Number(value.count || 0) > 0) || typeof Chart === 'undefined') {
    const empty = document.createElement('p')
    empty.className = 'viewing-empty viewing-chart-empty'
    empty.textContent = options.empty || 'This will take shape as your profile grows.'
    root.append(empty)
    return
  }
  const canvas = document.createElement('canvas')
  root.append(canvas)
  const css = getComputedStyle(document.body)
  const accent = css.getPropertyValue('--experience-orange').trim() || '#18c7b5'
  const hot = css.getPropertyValue('--experience-accent-hot').trim() || '#7c4dff'
  const muted = css.getPropertyValue('--experience-dim').trim() || '#8f8d98'
  const line = css.getPropertyValue('--experience-line').trim() || 'rgba(255,255,255,.1)'
  const doughnut = type === 'doughnut'
  const chart = new Chart(canvas, {
    type,
    data: {
      labels: usable.map(value => value.label),
      datasets: [{
        data: usable.map(value => Number(value.count || 0)),
        borderColor: accent,
        backgroundColor: doughnut
          ? [accent, hot, '#45b8ff', '#ffca68']
          : usable.map((_, index) => index === usable.length - 1 && options.highlightLast
            ? hot : accent),
        borderWidth: doughnut ? 0 : 1,
        borderRadius: doughnut ? 0 : 7,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 340 },
      onClick: options.onSelect ? (_, elements) => {
        const selected = elements?.[0]
        if (selected) options.onSelect(usable[selected.index])
      } : undefined,
      onHover: options.onSelect ? (event, elements) => {
        if (event.native?.target) event.native.target.style.cursor = elements.length ? 'pointer' : ''
      } : undefined,
      plugins: {
        legend: { display: doughnut, position: 'bottom', labels: {
          color: muted, boxWidth: 9, boxHeight: 9, usePointStyle: true,
          padding: 14, font: { size: 10 },
        } },
        tooltip: { callbacks: { label: context =>
          `${context.label}: ${context.raw} ${Number(context.raw) === 1 ? 'title' : 'titles'}` } },
      },
      scales: doughnut ? {} : {
        x: { grid: { display: false }, ticks: {
          color: muted, maxRotation: 0, autoSkip: true,
          maxTicksLimit: options.maxTicks || 10, font: { size: 9 },
        }, border: { display: false } },
        y: { beginAtZero: true, grid: { color: line }, ticks: {
          color: muted, precision: 0, maxTicksLimit: 5, font: { size: 9 },
        }, border: { display: false } },
      },
      cutout: doughnut ? '66%' : undefined,
    },
  })
  viewingCharts.set(root, chart)
  root.setAttribute('aria-label', usable.map(value =>
    `${value.label}: ${value.count} titles`).join(', '))
}

function adultInsightPosterMosaic(titles) {
  const root = $('#adultInsightPosterMosaic')
  root.replaceChildren()
  ;(titles || []).filter(title => title.poster_path).slice(0, 5).forEach(title => {
    const image = document.createElement('i')
    image.style.backgroundImage = `url("${adultPosterUrl(title.poster_path, 'w185')}")`
    root.append(image)
  })
}

function adultInsightBars(values) {
  const root = $('#adultInsightGenres')
  root.replaceChildren()
  const maximum = Math.max(1, ...(values || []).map(value => Number(value.count || 0)))
  ;(values || []).slice(0, 10).forEach(value => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'adult-insight-bar'
    const label = document.createElement('span')
    label.textContent = value.label
    const track = document.createElement('i')
    track.style.setProperty('--insight-share', `${Math.round(value.count / maximum * 100)}%`)
    const count = document.createElement('b')
    count.textContent = String(value.count)
    row.append(label, track, count)
    row.append(portalIcon('signal-chevron-right'))
    row.onclick = () => openAdultInsightBrowse('genre', value.label)
    root.append(row)
  })
  if (!root.children.length) {
    root.innerHTML = '<p class="viewing-empty">Genres will appear as TMDB finishes analysing your watched history.</p>'
  }
}

function adultInsightPeople(root, values) {
  root.replaceChildren()
  ;(values || []).forEach(person => {
    const creative = root.id === 'adultInsightCreative'
    const identityField = creative ? 'creative_ids' : 'cast_ids'
    const personId = Number(person.tmdb_id || 0)
    const watched = (adultInsightsData?.titles || []).filter(title =>
      (title[identityField] || []).map(Number).includes(personId))
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'adult-insight-person'
    const image = document.createElement('span')
    image.className = 'adult-insight-person-image'
    if (person.profile_path) {
      const portrait = document.createElement('img')
      portrait.src = adultPosterUrl(person.profile_path, 'w342')
      portrait.alt = ''
      portrait.loading = 'lazy'
      image.append(portrait)
    } else {
      const initials = document.createElement('span')
      initials.textContent = adultPersonInitials(person.name)
      image.append(initials)
    }
    const name = document.createElement('strong')
    name.textContent = person.name
    const detail = document.createElement('small')
    detail.textContent = `${person.titles} ${person.titles === 1 ? 'title' : 'titles'}`
    card.append(image, name, detail)
    card.setAttribute('aria-label', `Open ${person.name}`)
    card.onclick = () => openAdultPerson({
      ...person,
      context: creative ? 'Among your most-watched directors and creators'
        : 'Among your most-watched actors',
      insight_watched: watched,
      insight_watched_pool: adultInsightsData?.titles || [],
    }, 'My Insights')
    root.append(card)
  })
  if (!root.children.length) {
    root.innerHTML = '<p class="viewing-empty">People will appear as the catalogue analysis progresses.</p>'
  }
}

function adultInsightWorldGroup(label, values, kind) {
  const group = document.createElement('div')
  group.className = 'adult-insight-world-group'
  const heading = document.createElement('strong')
  heading.textContent = label
  const chips = document.createElement('div')
  chips.className = 'adult-insight-chips'
  ;(values || []).slice(0, 6).forEach(value => {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.append(document.createTextNode(`${value.label} `))
    const count = document.createElement('b')
    count.textContent = String(value.count)
    chip.append(count)
    chip.onclick = () => openAdultInsightBrowse(kind, value.label)
    chips.append(chip)
  })
  if (!chips.children.length) chips.textContent = 'Still analysing'
  group.append(heading, chips)
  return group
}

function adultInsightRatedTitles(values) {
  const section = $('#adultInsightRatedSection')
  const root = $('#adultInsightRatedTitles')
  root.replaceChildren()
  ;(values || []).forEach(title => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'adult-insight-title'
    const poster = document.createElement('span')
    poster.className = 'adult-insight-title-poster'
    if (title.poster_path) {
      poster.style.backgroundImage = `url("${adultPosterUrl(title.poster_path, 'w342')}")`
    }
    const score = document.createElement('b')
    score.textContent = `${title.rating}/10`
    poster.append(score)
    const name = document.createElement('strong')
    name.textContent = title.title
    const detail = document.createElement('small')
    detail.textContent = [title.year, title.media_type === 'tv' ? 'Series' : 'Film']
      .filter(Boolean).join(' · ')
    button.append(poster, name, detail)
    button.onclick = () => openAdultTitle({ ...title, catalogue_only: true }, button)
    root.append(button)
  })
  section.classList.toggle('hidden', !root.children.length)
}

function adultInsightFacts(summary) {
  const values = [
    { value: summary.rated ? `${summary.average_rating}/10` : '—', label: 'Average score', kind: 'rated' },
    { value: summary.rated ? `${summary.median_rating}/10` : '—', label: 'Middle score', kind: 'rated' },
    { value: String(summary.loved || 0), label: 'Rated 8 or higher', kind: 'loved' },
    { value: `${Math.round(Number(summary.rating_coverage || 0) * 100)}%`, label: 'Watched titles rated', kind: 'rated' },
  ]
  const root = $('#adultInsightPersonality')
  root.replaceChildren()
  values.forEach(value => {
    const fact = document.createElement('button')
    fact.type = 'button'
    fact.className = 'adult-insight-fact'
    const strong = document.createElement('strong')
    strong.textContent = value.value
    const label = document.createElement('span')
    label.textContent = value.label
    fact.append(strong, label)
    fact.onclick = () => openAdultInsightBrowse(value.kind, value.filter)
    root.append(fact)
  })
}

function renderAdultInsights() {
  if (!adultInsightsData) return
  const data = adultInsightsData
  const summary = data.summary || {}
  $('#adultInsightHeadline').textContent = `${Number(summary.watched || 0).toLocaleString()} stories remembered`
  $('#adultInsightIntro').textContent = summary.rated
    ? `Your ratings average ${summary.average_rating}/10 across ${summary.rated} scored titles.`
    : 'Your watched history is ready. Ratings will reveal the shape of your taste.'
  $('#adultInsightWatched').textContent = Number(summary.watched || 0).toLocaleString()
  $('#adultInsightFilms').textContent = Number(summary.films || 0).toLocaleString()
  $('#adultInsightSeries').textContent = Number(summary.series || 0).toLocaleString()
  $('#adultInsightAverage').textContent = summary.rated ? `${summary.average_rating}/10` : '—'
  $('#adultInsightRatingSummary').textContent = summary.rated
    ? `${summary.rated} rated · ${summary.unrated} still to score` : 'No ratings yet'
  $('#adultInsightMixSummary').textContent = summary.watched
    ? `${Math.round(Number(summary.films || 0) / summary.watched * 100)}% films` : '—'
  $('#adultInsightGenreSummary').textContent = data.genres?.[0]?.label || 'Analysing'
  const peakDecade = [...(data.decades || [])].sort((a, b) => b.count - a.count)[0]
  $('#adultInsightDecadeSummary').textContent = peakDecade?.label || '—'
  adultInsightPosterMosaic(data.recent_posters)
  adultInsightChart($('#adultInsightRatingChart'), data.ratings, 'bar', {
    empty: 'Add personal ratings to reveal your scoring curve.', highlightLast: true,
    keepZeros: true, onSelect: value => openAdultInsightBrowse('rating', value.label),
  })
  adultInsightChart($('#adultInsightMixChart'), data.media_types, 'doughnut', {
    onSelect: value => openAdultInsightBrowse('type', value.label === 'Films' ? 'movie' : 'tv'),
  })
  adultInsightChart($('#adultInsightDecadeChart'), data.decades, 'bar', {
    maxTicks: 8, onSelect: value => openAdultInsightBrowse('decade', value.label),
  })
  adultInsightBars(data.genres)
  adultInsightPeople($('#adultInsightActors'), data.actors)
  adultInsightPeople($('#adultInsightCreative'), data.creative)
  adultInsightFacts(summary)
  const world = $('#adultInsightWorld')
  world.replaceChildren(
    adultInsightWorldGroup('Original languages', data.languages, 'language'),
    adultInsightWorldGroup('Production countries', data.countries, 'country'),
  )
  adultInsightRatedTitles(data.highest_rated)
  const enrichment = data.enrichment || {}
  const progress = $('#adultInsightEnrichment')
  progress.classList.toggle('complete', enrichment.complete)
  progress.querySelector('span').textContent = enrichment.tmdb_configured
    ? `Building richer insights from TMDB · ${enrichment.enriched} of ${enrichment.total} titles analysed`
    : 'Add a TMDB key to build genre, actor and director insights.'
  $('#adultInsightsDashboard').classList.toggle('hidden', Boolean(adultInsightBrowseRoute))
  if (adultInsightBrowseRoute) renderAdultInsightBrowse()
  adultInsightsRendered = true
}

function adultInsightLanguageName(code) {
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' }).of(String(code).toLowerCase())
      || String(code)
  } catch (_) { return String(code) }
}

function adultInsightBrowseConfig(kind, value) {
  const text = String(value || '')
  const configurations = {
    all: {
      kicker: 'Your complete watched history', title: 'Everything you have watched',
      intro: 'Every film and series currently remembered in Adult TV.',
      matches: () => true,
    },
    type: {
      kicker: text === 'tv' ? 'Watched series' : 'Watched films',
      title: text === 'tv' ? 'Every series' : 'Every film',
      intro: `All the ${text === 'tv' ? 'series' : 'films'} in your watched history.`,
      matches: title => title.media_type === text,
    },
    genre: {
      kicker: 'Genre', title: text,
      intro: `Everything you have watched in ${text}.`,
      matches: title => (title.genres || []).includes(text),
    },
    decade: {
      kicker: 'Release era', title: text,
      intro: `The films and series you have seen from the ${text}.`,
      matches: title => `${String(title.year || '').slice(0, 3)}0s` === text,
    },
    language: {
      kicker: 'Original language', title: adultInsightLanguageName(text),
      intro: `Titles originally made in ${adultInsightLanguageName(text)}.`,
      matches: title => title.language === text,
    },
    country: {
      kicker: 'Production country', title: text,
      intro: `Films and series in your history produced in ${text}.`,
      matches: title => (title.countries || []).includes(text),
    },
    rating: {
      kicker: 'Your rating', title: `${text}/10`,
      intro: `Everything you have personally rated ${text} out of 10.`,
      matches: title => Number(title.rating) === Number(text),
    },
    rated: {
      kicker: 'Your scores', title: 'Everything you have rated',
      intro: 'Your watched titles with a personal score.',
      matches: title => Number(title.rating) > 0,
    },
    loved: {
      kicker: 'Your favourites', title: 'Rated 8 or higher',
      intro: 'The films and series that received your strongest scores.',
      matches: title => Number(title.rating) >= 8,
    },
  }
  return configurations[kind] || configurations.all
}

function adultInsightBrowseTitles() {
  if (!adultInsightBrowseRoute) return []
  const config = adultInsightBrowseConfig(
    adultInsightBrowseRoute.kind, adultInsightBrowseRoute.value)
  const query = adultInsightBrowseSearch.trim().toLocaleLowerCase()
  const titles = (adultInsightsData?.titles || []).filter(title => config.matches(title))
    .filter(title => !query || [title.title, title.year].some(value =>
      String(value || '').toLocaleLowerCase().includes(query)))
    .map(title => ({ ...title, viewing: {
      ...title, manual_state: 'watched', history: [],
    } }))
  const name = (a, b) => String(a.title || '').localeCompare(
    String(b.title || ''), undefined, { sensitivity: 'base' })
  const year = title => Number.parseInt(title.year, 10) || 0
  titles.sort((a, b) => {
    if (adultInsightBrowseSort === 'newest') return year(b) - year(a) || name(a, b)
    if (adultInsightBrowseSort === 'oldest') return year(a) - year(b) || name(a, b)
    if (adultInsightBrowseSort === 'rating') {
      return Number(b.rating || 0) - Number(a.rating || 0) || name(a, b)
    }
    return name(a, b)
  })
  return titles
}

function renderAdultInsightBrowse() {
  if (!adultInsightBrowseRoute) return
  const config = adultInsightBrowseConfig(
    adultInsightBrowseRoute.kind, adultInsightBrowseRoute.value)
  $('#adultInsightBrowseKicker').textContent = config.kicker
  $('#adultInsightBrowseTitle').textContent = config.title
  $('#adultInsightBrowseIntro').textContent = config.intro
  const titles = adultInsightBrowseTitles()
  $('#adultInsightBrowseCount').textContent = Number(titles.length).toLocaleString()
  const root = $('#adultInsightBrowseGrid')
  root.replaceChildren()
  titles.forEach(title => root.append(adultExploreCard(title, {
    directActions: false, context: 'insights',
  })))
  if (!titles.length) root.append(portalEmptyState({
    className: 'watch-empty', title: adultInsightBrowseSearch
      ? 'No matching titles' : 'Nothing here yet',
    message: adultInsightBrowseSearch
      ? 'Try a different search.' : 'This insight will fill out as TMDB analysis completes.',
  }))
  $('#adultInsightBrowse').classList.remove('hidden')
  $('#adultInsightsDashboard').classList.add('hidden')
}

function openAdultInsightBrowse(kind, value = '') {
  const path = `insights/adult/${encodeURIComponent(kind)}`
    + (value === '' || value === undefined ? '' : `/${encodeURIComponent(value)}`)
  if (location.hash !== '#insights') {
    history.replaceState({ ...(history.state || {}), insights: true }, '', '#insights')
  }
  history.pushState({ insightsChild: true, insightsParent: 'insights' }, '', `#${path}`)
  window.openInsightsRoute?.(path)
}

function openAdultInsightsRoute(requested) {
  const match = requested.match(/^insights\/adult\/([^/]+)(?:\/(.+))?$/)
  if (!match) return false
  const next = {
    kind: decodeURIComponent(match[1]),
    value: match[2] ? decodeURIComponent(match[2]) : '',
  }
  const changed = !adultInsightBrowseRoute
    || adultInsightBrowseRoute.kind !== next.kind
    || adultInsightBrowseRoute.value !== next.value
  adultInsightBrowseRoute = next
  if (changed) {
    adultInsightBrowseSearch = ''
    adultInsightBrowseSort = 'az'
    if ($('#adultInsightBrowseSearch')) $('#adultInsightBrowseSearch').value = ''
    if ($('#adultInsightBrowseSort')) $('#adultInsightBrowseSort').value = 'az'
  }
  $('#adultInsightBrowse').classList.remove('hidden')
  $('#adultInsightsDashboard').classList.add('hidden')
  if (adultInsightsData) renderAdultInsightBrowse()
  return true
}

function closeAdultInsightsRoute() {
  adultInsightBrowseRoute = null
  $('#adultInsightBrowse')?.classList.add('hidden')
  if (myInsightsMode === 'adult') $('#adultInsightsDashboard')?.classList.remove('hidden')
}

window.openAdultInsightsRoute = openAdultInsightsRoute
window.closeAdultInsightsRoute = closeAdultInsightsRoute

function scheduleAdultInsightsPoll() {
  clearTimeout(adultInsightsPoll)
  if (adultInsightsData?.enrichment?.complete) return
  adultInsightsPoll = setTimeout(() => {
    if (myInsightsMode === 'adult' && $('#view-insights')?.classList.contains('active')) {
      loadAdultInsights(true).catch(() => {})
    }
  }, 3500)
}

async function loadAdultInsights(force = false) {
  const loading = $('#adultInsightsLoading')
  if (!loading || offlineMode) return
  loading.classList.add('hidden')
  if (adultInsightsData) {
    if (!adultInsightsRendered) renderAdultInsights()
    scheduleAdultInsightsPoll()
    const fresh = adultInsightsLoadedAt
      && Date.now() - adultInsightsLoadedAt < 5 * 60 * 1000
    if (!force && fresh) return
  }
  if (adultInsightsRequest) return adultInsightsRequest
  adultInsightsRequest = (async () => {
    try {
      adultInsightsData = await api('/api/adult/insights')
      adultInsightsLoadedAt = Date.now()
      writePortalDataCache('adult-insights-v1', adultInsightsData)
      adultInsightsRendered = false
      renderAdultInsights()
      scheduleAdultInsightsPoll()
    } catch (error) {
      if (!adultInsightsData) $('#adultInsightsDashboard')?.classList.remove('hidden')
    } finally {
      adultInsightsRequest = null
    }
  })()
  return adultInsightsRequest
}

function setMyInsightsMode(mode, options = {}) {
  myInsightsMode = mode === 'mabel' ? 'mabel' : 'adult'
  $('#insightsDomainTitle').textContent = myInsightsMode === 'mabel' ? 'MabelTV' : 'Adult TV'
  $$('[data-insights-mode]').forEach(button => {
    const active = button.dataset.insightsMode === myInsightsMode
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  $('#adultInsightsDashboard').classList.toggle('hidden',
    myInsightsMode !== 'adult' || Boolean(adultInsightBrowseRoute))
  $('#adultInsightBrowse').classList.toggle('hidden',
    myInsightsMode !== 'adult' || !adultInsightBrowseRoute)
  $('#adultInsightsLoading').classList.add('hidden')
  $('#mabelInsightsDashboard').classList.toggle('hidden', myInsightsMode !== 'mabel')
  if (options.updateHistory) {
    const path = myInsightsMode === 'mabel' ? 'insights/mabeltv' : 'insights'
    history.replaceState({ ...history.state, myInsightsMode }, '', `#${path}`)
    currentInsightsPath = path
  }
  if (options.load === false) return Promise.resolve()
  if (myInsightsMode === 'mabel') return loadViewingInsights().catch(() => {})
  return loadAdultInsights().catch(() => {})
}

function loadMyInsights() {
  return setMyInsightsMode(myInsightsMode)
}

window.setMyInsightsMode = setMyInsightsMode
window.loadMyInsights = loadMyInsights

$$('[data-insights-mode]').forEach(button => button.addEventListener('click', () =>
  setMyInsightsMode(button.dataset.insightsMode, { updateHistory: true })))

$('#insightsWatchTab')?.addEventListener('click', () =>
  navigateDomainRoute(myInsightsMode, 'watch'))
$('#insightsDownloadsTab')?.addEventListener('click', () =>
  navigateDomainRoute(myInsightsMode, 'downloads'))
$('#insightsDomainTitle')?.closest('[role="button"]')?.addEventListener('click', scrollPortalToTop)

$$('[data-adult-insight-kind]').forEach(button => button.addEventListener('click', () =>
  openAdultInsightBrowse(button.dataset.adultInsightKind, button.dataset.adultInsightValue || '')))

$('#adultInsightBrowseSearch')?.addEventListener('input', event => {
  adultInsightBrowseSearch = event.currentTarget.value
  renderAdultInsightBrowse()
})

$('#adultInsightBrowseSort')?.addEventListener('change', event => {
  adultInsightBrowseSort = event.currentTarget.value
  renderAdultInsightBrowse()
})

$('#adultInsightBrowseBack')?.addEventListener('click', () => {
  if (history.state?.insightsParent === 'insights') history.back()
  else {
    history.replaceState({ insights: true }, '', '#insights')
    window.openInsightsRoute?.('insights')
  }
})

$('#adultInsightRateLink')?.addEventListener('click', () => {
  history.pushState({ adultRatings: true, insightsReturn: true }, '', '#adult-ratings')
  openView('adult-ratings')
})

document.addEventListener('mabeltv:accent-change', () => {
  if (adultInsightsData && myInsightsMode === 'adult') {
    adultInsightsRendered = false
    renderAdultInsights()
  }
})
