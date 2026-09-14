'use strict'

let myTvInsightsData = null
let myTvInsightsLoadedAt = 0
let myTvInsightsCacheRestored = false
let myTvInsightsRendered = false
let myTvInsightsRequest = null
let myInsightsMode = 'my_tv'
let myTvInsightsPoll = null
let myTvInsightBrowseRoute = null
let myTvInsightBrowseSearch = ''
let myTvInsightBrowseSort = 'az'

function myTvInsightDestroyChart(root) {
  if (!root) return
  const chart = viewingCharts.get(root)
  if (chart) chart.destroy()
  viewingCharts.delete(root)
  root.replaceChildren()
}

function myTvInsightChart(root, values, type = 'bar', options = {}) {
  if (!root) return
  myTvInsightDestroyChart(root)
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

function myTvInsightPosterMosaic(titles) {
  const root = $('#myTvInsightPosterMosaic')
  root.replaceChildren()
  ;(titles || []).filter(title => title.poster_path).slice(0, 5).forEach(title => {
    const image = document.createElement('i')
    image.style.backgroundImage = `url("${myTvPosterUrl(title.poster_path, 'w185')}")`
    root.append(image)
  })
}

function myTvInsightBars(values) {
  const root = $('#myTvInsightGenres')
  root.replaceChildren()
  const maximum = Math.max(1, ...(values || []).map(value => Number(value.count || 0)))
  ;(values || []).slice(0, 10).forEach(value => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'my-tv-insight-bar'
    const label = document.createElement('span')
    label.textContent = value.label
    const track = document.createElement('i')
    track.style.setProperty('--insight-share', `${Math.round(value.count / maximum * 100)}%`)
    const count = document.createElement('b')
    count.textContent = String(value.count)
    row.append(label, track, count)
    row.append(portalIcon('signal-chevron-right'))
    row.onclick = () => openMyTvInsightBrowse('genre', value.label)
    root.append(row)
  })
  if (!root.children.length) {
    root.innerHTML = '<p class="viewing-empty">Genres will appear as TMDB finishes analysing your watched history.</p>'
  }
}

function myTvInsightPeople(root, values) {
  root.replaceChildren()
  ;(values || []).forEach(person => {
    const creative = root.id === 'myTvInsightCreative'
    const identityField = creative ? 'creative_ids' : 'cast_ids'
    const personId = Number(person.tmdb_id || 0)
    const watched = (myTvInsightsData?.titles || []).filter(title =>
      (title[identityField] || []).map(Number).includes(personId))
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'my-tv-insight-person'
    const image = document.createElement('span')
    image.className = 'my-tv-insight-person-image'
    if (person.profile_path) {
      const portrait = document.createElement('img')
      portrait.decoding = 'async'
      portrait.src = myTvPosterUrl(person.profile_path, 'w342')
      portrait.alt = ''
      portrait.loading = 'lazy'
      image.append(portrait)
    } else {
      const initials = document.createElement('span')
      initials.textContent = myTvPersonInitials(person.name)
      image.append(initials)
    }
    const name = document.createElement('strong')
    name.textContent = person.name
    const detail = document.createElement('small')
    detail.textContent = `${person.titles} ${person.titles === 1 ? 'title' : 'titles'}`
    card.append(image, name, detail)
    card.setAttribute('aria-label', `Open ${person.name}`)
    card.onclick = () => openMyTvPerson({
      ...person,
      context: creative ? 'Among your most-watched directors and creators'
        : 'Among your most-watched actors',
      insight_watched: watched,
      insight_watched_pool: myTvInsightsData?.titles || [],
    }, 'My Insights')
    root.append(card)
  })
  if (!root.children.length) {
    root.innerHTML = '<p class="viewing-empty">People will appear as the catalogue analysis progresses.</p>'
  }
}

function myTvInsightWorldGroup(label, values, kind) {
  const group = document.createElement('div')
  group.className = 'my-tv-insight-world-group'
  const heading = document.createElement('strong')
  heading.textContent = label
  const chips = document.createElement('div')
  chips.className = 'my-tv-insight-chips'
  ;(values || []).slice(0, 6).forEach(value => {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.append(document.createTextNode(`${value.label} `))
    const count = document.createElement('b')
    count.textContent = String(value.count)
    chip.append(count)
    chip.onclick = () => openMyTvInsightBrowse(kind, value.label)
    chips.append(chip)
  })
  if (!chips.children.length) chips.textContent = 'Still analysing'
  group.append(heading, chips)
  return group
}

function myTvInsightRatedTitles(values) {
  const section = $('#myTvInsightRatedSection')
  const root = $('#myTvInsightRatedTitles')
  root.replaceChildren()
  ;(values || []).forEach(title => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'my-tv-insight-title'
    const poster = document.createElement('span')
    poster.className = 'my-tv-insight-title-poster'
    if (title.poster_path) {
      poster.style.backgroundImage = `url("${myTvPosterUrl(title.poster_path, 'w342')}")`
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
    button.onclick = () => openMyTvTitle({ ...title, catalogue_only: true }, button)
    root.append(button)
  })
  section.classList.toggle('hidden', !root.children.length)
}

function myTvInsightFacts(summary) {
  const values = [
    { value: summary.rated ? `${summary.average_rating}/10` : '—', label: 'Average score', kind: 'rated' },
    { value: summary.rated ? `${summary.median_rating}/10` : '—', label: 'Middle score', kind: 'rated' },
    { value: String(summary.loved || 0), label: 'Rated 8 or higher', kind: 'loved' },
    { value: `${Math.round(Number(summary.rating_coverage || 0) * 100)}%`, label: 'Watched titles rated', kind: 'rated' },
  ]
  const root = $('#myTvInsightPersonality')
  root.replaceChildren()
  values.forEach(value => {
    const fact = document.createElement('button')
    fact.type = 'button'
    fact.className = 'my-tv-insight-fact'
    const strong = document.createElement('strong')
    strong.textContent = value.value
    const label = document.createElement('span')
    label.textContent = value.label
    fact.append(strong, label)
    fact.onclick = () => openMyTvInsightBrowse(value.kind, value.filter)
    root.append(fact)
  })
}

function renderMyTvInsights() {
  if (!myTvInsightsData) return
  const data = myTvInsightsData
  const summary = data.summary || {}
  $('#myTvInsightHeadline').textContent = `${Number(summary.watched || 0).toLocaleString()} stories remembered`
  $('#myTvInsightIntro').textContent = summary.rated
    ? `Your ratings average ${summary.average_rating}/10 across ${summary.rated} scored titles.`
    : 'Your watched history is ready. Ratings will reveal the shape of your taste.'
  $('#myTvInsightWatched').textContent = Number(summary.watched || 0).toLocaleString()
  $('#myTvInsightFilms').textContent = Number(summary.films || 0).toLocaleString()
  $('#myTvInsightSeries').textContent = Number(summary.series || 0).toLocaleString()
  $('#myTvInsightAverage').textContent = summary.rated ? `${summary.average_rating}/10` : '—'
  $('#myTvInsightRatingSummary').textContent = summary.rated
    ? `${summary.rated} rated · ${summary.unrated} still to score` : 'No ratings yet'
  $('#myTvInsightMixSummary').textContent = summary.watched
    ? `${Math.round(Number(summary.films || 0) / summary.watched * 100)}% films` : '—'
  $('#myTvInsightGenreSummary').textContent = data.genres?.[0]?.label || 'Analysing'
  const peakDecade = [...(data.decades || [])].sort((a, b) => b.count - a.count)[0]
  $('#myTvInsightDecadeSummary').textContent = peakDecade?.label || '—'
  myTvInsightPosterMosaic(data.recent_posters)
  myTvInsightChart($('#myTvInsightRatingChart'), data.ratings, 'bar', {
    empty: 'Add personal ratings to reveal your scoring curve.', highlightLast: true,
    keepZeros: true, onSelect: value => openMyTvInsightBrowse('rating', value.label),
  })
  myTvInsightChart($('#myTvInsightMixChart'), data.media_types, 'doughnut', {
    onSelect: value => openMyTvInsightBrowse('type', value.label === 'Films' ? 'movie' : 'tv'),
  })
  myTvInsightChart($('#myTvInsightDecadeChart'), data.decades, 'bar', {
    maxTicks: 8, onSelect: value => openMyTvInsightBrowse('decade', value.label),
  })
  myTvInsightBars(data.genres)
  myTvInsightPeople($('#myTvInsightActors'), data.actors)
  myTvInsightPeople($('#myTvInsightCreative'), data.creative)
  myTvInsightFacts(summary)
  const world = $('#myTvInsightWorld')
  world.replaceChildren(
    myTvInsightWorldGroup('Original languages', data.languages, 'language'),
    myTvInsightWorldGroup('Production countries', data.countries, 'country'),
  )
  myTvInsightRatedTitles(data.highest_rated)
  const enrichment = data.enrichment || {}
  const progress = $('#myTvInsightEnrichment')
  progress.classList.toggle('complete', enrichment.complete)
  progress.querySelector('span').textContent = enrichment.tmdb_configured
    ? `Building richer insights from TMDB · ${enrichment.enriched} of ${enrichment.total} titles analysed`
    : 'Add a TMDB key to build genre, actor and director insights.'
  $('#myTvInsightsDashboard').classList.toggle('hidden', Boolean(myTvInsightBrowseRoute))
  if (myTvInsightBrowseRoute) renderMyTvInsightBrowse()
  myTvInsightsRendered = true
}

function myTvInsightLanguageName(code) {
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' }).of(String(code).toLowerCase())
      || String(code)
  } catch (_) { return String(code) }
}

function myTvInsightBrowseConfig(kind, value) {
  const text = String(value || '')
  const configurations = {
    all: {
      kicker: 'Your complete watched history', title: 'Everything you have watched',
      intro: 'Every film and series currently remembered in My TV.',
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
      kicker: 'Original language', title: myTvInsightLanguageName(text),
      intro: `Titles originally made in ${myTvInsightLanguageName(text)}.`,
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

function myTvInsightBrowseTitles() {
  if (!myTvInsightBrowseRoute) return []
  const config = myTvInsightBrowseConfig(
    myTvInsightBrowseRoute.kind, myTvInsightBrowseRoute.value)
  const query = myTvInsightBrowseSearch.trim().toLocaleLowerCase()
  const titles = (myTvInsightsData?.titles || []).filter(title => config.matches(title))
    .filter(title => !query || [title.title, title.year].some(value =>
      String(value || '').toLocaleLowerCase().includes(query)))
    .map(title => ({ ...title, viewing: {
      ...title, manual_state: 'watched', history: [],
    } }))
  const name = (a, b) => String(a.title || '').localeCompare(
    String(b.title || ''), undefined, { sensitivity: 'base' })
  const year = title => Number.parseInt(title.year, 10) || 0
  titles.sort((a, b) => {
    if (myTvInsightBrowseSort === 'newest') return year(b) - year(a) || name(a, b)
    if (myTvInsightBrowseSort === 'oldest') return year(a) - year(b) || name(a, b)
    if (myTvInsightBrowseSort === 'rating') {
      return Number(b.rating || 0) - Number(a.rating || 0) || name(a, b)
    }
    return name(a, b)
  })
  return titles
}

function renderMyTvInsightBrowse() {
  if (!myTvInsightBrowseRoute) return
  const config = myTvInsightBrowseConfig(
    myTvInsightBrowseRoute.kind, myTvInsightBrowseRoute.value)
  $('#myTvInsightBrowseKicker').textContent = config.kicker
  $('#myTvInsightBrowseTitle').textContent = config.title
  $('#myTvInsightBrowseIntro').textContent = config.intro
  const titles = myTvInsightBrowseTitles()
  $('#myTvInsightBrowseCount').textContent = Number(titles.length).toLocaleString()
  const root = $('#myTvInsightBrowseGrid')
  root.replaceChildren()
  titles.forEach(title => root.append(myTvExploreCard(title, {
    directActions: false, context: 'insights',
  })))
  if (!titles.length) root.append(portalEmptyState({
    className: 'watch-empty', title: myTvInsightBrowseSearch
      ? 'No matching titles' : 'Nothing here yet',
    message: myTvInsightBrowseSearch
      ? 'Try a different search.' : 'This insight will fill out as TMDB analysis completes.',
  }))
  $('#myTvInsightBrowse').classList.remove('hidden')
  $('#myTvInsightsDashboard').classList.add('hidden')
}

function openMyTvInsightBrowse(kind, value = '') {
  const path = `insights/my_tv/${encodeURIComponent(kind)}`
    + (value === '' || value === undefined ? '' : `/${encodeURIComponent(value)}`)
  if (location.hash !== '#insights') {
    history.replaceState({ ...(history.state || {}), insights: true }, '', '#insights')
  }
  history.pushState({ insightsChild: true, insightsParent: 'insights' }, '', `#${path}`)
  openInsightsRoute(path)
}

function openMyTvInsightsRoute(requested) {
  const match = requested.match(/^insights\/my_tv\/([^/]+)(?:\/(.+))?$/)
  if (!match) return false
  const next = {
    kind: decodeURIComponent(match[1]),
    value: match[2] ? decodeURIComponent(match[2]) : '',
  }
  const changed = !myTvInsightBrowseRoute
    || myTvInsightBrowseRoute.kind !== next.kind
    || myTvInsightBrowseRoute.value !== next.value
  myTvInsightBrowseRoute = next
  if (changed) {
    myTvInsightBrowseSearch = ''
    myTvInsightBrowseSort = 'az'
    if ($('#myTvInsightBrowseSearch')) $('#myTvInsightBrowseSearch').value = ''
    if ($('#myTvInsightBrowseSort')) $('#myTvInsightBrowseSort').value = 'az'
  }
  $('#myTvInsightBrowse').classList.remove('hidden')
  $('#myTvInsightsDashboard').classList.add('hidden')
  if (myTvInsightsData) renderMyTvInsightBrowse()
  return true
}

function closeMyTvInsightsRoute() {
  myTvInsightBrowseRoute = null
  $('#myTvInsightBrowse')?.classList.add('hidden')
  if (myInsightsMode === 'my_tv') $('#myTvInsightsDashboard')?.classList.remove('hidden')
}

function scheduleMyTvInsightsPoll() {
  clearTimeout(myTvInsightsPoll)
  if (myTvInsightsData?.enrichment?.complete) return
  myTvInsightsPoll = setTimeout(() => {
    if (myInsightsMode === 'my_tv' && $('#view-insights')?.classList.contains('active')) {
      loadMyTvInsights(true).catch(() => {})
    }
  }, 3500)
}

async function loadMyTvInsights(force = false) {
  const loading = $('#myTvInsightsLoading')
  if (!loading || offlineMode) return
  loading.classList.add('hidden')
  if (!myTvInsightsCacheRestored) {
    myTvInsightsCacheRestored = true
    const cached = await readPortalDataCache('my-tv-insights-v1', 'my_tv_insights')
    if (cached) {
      myTvInsightsData = cached.data
      myTvInsightsLoadedAt = cached.stale ? 0 : Number(cached.saved_at || 0)
    }
  }
  await window.MabelAssets?.chart().catch(() => {})
  if (myTvInsightsData) {
    if (!myTvInsightsRendered) renderMyTvInsights()
    scheduleMyTvInsightsPoll()
    const fresh = myTvInsightsLoadedAt
      && Date.now() - myTvInsightsLoadedAt < 5 * 60 * 1000
    if (!force && fresh) return
  }
  if (myTvInsightsRequest) return myTvInsightsRequest
  myTvInsightsRequest = (async () => {
    try {
      myTvInsightsData = await api('/api/my-tv/insights')
      myTvInsightsLoadedAt = Date.now()
      await writePortalDataCache('my-tv-insights-v1', myTvInsightsData, 'my_tv_insights')
      myTvInsightsRendered = false
      renderMyTvInsights()
      scheduleMyTvInsightsPoll()
    } catch (error) {
      if (!myTvInsightsData) $('#myTvInsightsDashboard')?.classList.remove('hidden')
    } finally {
      myTvInsightsRequest = null
    }
  })()
  return myTvInsightsRequest
}

function setMyInsightsMode(mode, options = {}) {
  myInsightsMode = mode === 'mabel' ? 'mabel' : 'my_tv'
  $('#insightsDomainTitle').textContent = myInsightsMode === 'mabel' ? tvName() : 'My TV'
  $$('[data-insights-mode]').forEach(button => {
    const active = button.dataset.insightsMode === myInsightsMode
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  $('#myTvInsightsDashboard').classList.toggle('hidden',
    myInsightsMode !== 'my_tv' || Boolean(myTvInsightBrowseRoute))
  $('#myTvInsightBrowse').classList.toggle('hidden',
    myInsightsMode !== 'my_tv' || !myTvInsightBrowseRoute)
  $('#myTvInsightsLoading').classList.add('hidden')
  $('#mabelInsightsDashboard').classList.toggle('hidden', myInsightsMode !== 'mabel')
  if (options.updateHistory) {
    const path = myInsightsMode === 'mabel' ? 'insights/mabeltv' : 'insights'
    history.replaceState({ ...history.state, myInsightsMode }, '', `#${path}`)
    currentInsightsPath = path
  }
  if (options.load === false) return Promise.resolve()
  if (myInsightsMode === 'mabel') return loadViewingInsights().catch(() => {})
  return loadMyTvInsights().catch(() => {})
}

function loadMyInsights() {
  return setMyInsightsMode(myInsightsMode)
}

$$('[data-insights-mode]').forEach(button => button.addEventListener('click', () =>
  setMyInsightsMode(button.dataset.insightsMode, { updateHistory: true })))

$('#insightsWatchTab')?.addEventListener('click', () =>
  navigateDomainRoute(myInsightsMode, 'watch'))
$('#insightsDownloadsTab')?.addEventListener('click', () =>
  navigateDomainRoute(myInsightsMode, 'downloads'))
$('#insightsDomainTitle')?.closest('[role="button"]')?.addEventListener('click', scrollPortalToTop)

$$('[data-my-tv-insight-kind]').forEach(button => button.addEventListener('click', () =>
  openMyTvInsightBrowse(button.dataset.myTvInsightKind, button.dataset.myTvInsightValue || '')))

$('#myTvInsightBrowseSearch')?.addEventListener('input', event => {
  myTvInsightBrowseSearch = event.currentTarget.value
  renderMyTvInsightBrowse()
})

$('#myTvInsightBrowseSort')?.addEventListener('change', event => {
  myTvInsightBrowseSort = event.currentTarget.value
  renderMyTvInsightBrowse()
})

$('#myTvInsightBrowseBack')?.addEventListener('click', () => {
  if (history.state?.insightsParent === 'insights') history.back()
  else {
    history.replaceState({ insights: true }, '', '#insights')
    openInsightsRoute('insights')
  }
})

$('#myTvInsightRateLink')?.addEventListener('click', () => {
  history.pushState({ myTvRatings: true, insightsReturn: true }, '', '#my-tv-ratings')
  openView('my-tv-ratings')
})

document.addEventListener('mabeltv:accent-change', () => {
  if (myTvInsightsData && myInsightsMode === 'my_tv') {
    myTvInsightsRendered = false
    renderMyTvInsights()
  }
})
