'use strict'

let adultHomePage = 1
let adultHomeLoading = false
let adultHomeLoadedAt = 0
let adultHomePersonal = []
let adultHomeDifferent = []
let adultHomeReleased = []
let adultHomeCacheRestored = false

async function restoreAdultHomeCache() {
  if (adultHomeCacheRestored) return
  adultHomeCacheRestored = true
  const cached = await readPortalDataCache('adult-home-v2', 'adult_viewing')
  if (!cached) return
  adultHomeLoadedAt = cached.stale ? 0 : Number(cached.saved_at) || 0
  adultHomePage = Number(cached.data.page) || 1
  adultHomePersonal = cached.data.personal || []
  adultHomeDifferent = cached.data.different || []
  adultHomeReleased = cached.data.released || []
}

function adultHomeIsWatched(title) {
  return adultArtworkStatusKind(title, {
    media_type: title.media_type, local: title.local_progress || title.local,
  }) === 'watched'
}

function adultHomeUnique(values, excluded = new Set(), limit = 8,
  { includeWatched = false } = {}) {
  const result = []
  for (const title of values || []) {
    if (!title?.key || excluded.has(title.key)
        || (!includeWatched && adultHomeIsWatched(title))) continue
    excluded.add(title.key)
    result.push(title)
    if (result.length >= limit) break
  }
  return result
}

function renderAdultHomeGrid(root, values, context = 'adult-home') {
  const signature = values.map(title => title.key).join('|')
  if (root.dataset.homeTitles === signature && root.children.length) return
  root.dataset.homeTitles = signature
  root.replaceChildren(...values.map(title => adultExploreCard(title, {
    context,
  })))
  if (!values.length) {
    const quiet = document.createElement('span')
    quiet.className = 'adult-home-quiet'
    quiet.textContent = '•••'
    root.append(quiet)
  }
}

function renderAdultHomeContinue() {
  const resumableFilms = (library?.adult_library || [])
    .filter(film => film.browser_ready !== false && watchFilmResumable(film))
    .map(film => ({ ...adultFilmEntry(film),
      lastWatched: Number(film.remote_last_watched || 0) }))
  const resumable = [...resumableFilms, ...adultSeriesContinueEntries()]
    .sort((left, right) => Number(right.lastWatched || 0) - Number(left.lastWatched || 0))
    .slice(0, 10)
  $('#adultHomeContinueSection').classList.toggle('hidden', !resumable.length)
  $('#adultHomeContinueCount').textContent = resumable.length
    ? `${resumable.length} in progress` : ''
  const root = $('#adultHomeContinueRail')
  const signature = resumable.map(value => {
    const media = value.kind === 'adult-series' ? value.episode : value.film || value
    return [value.key || media.path || value.title, Number(media.remote_position || 0),
      Number(value.lastWatched || media.remote_last_watched || 0)].join(':')
  }).join('|')
  if (root.dataset.homeTitles !== signature || !root.children.length) {
    root.dataset.homeTitles = signature
    root.replaceChildren(...resumable.map(value => continueWatchCard(value)))
  }
}

function adultHomeUpNext(excluded) {
  return adultHomeUnique([...(adultViewingData.items || [])]
    .filter(item => item.up_next === true)
    .sort((left, right) => Number(left.up_next_rank || 999999)
      - Number(right.up_next_rank || 999999)), excluded, 8)
}

function renderAdultHomeSection(section, root, values, context = 'adult-home') {
  $(section).classList.toggle('hidden', !values.length)
  renderAdultHomeGrid($(root), values, context)
}

function renderAdultHomeLoading() {
  for (const [selector, count] of [['#adultHomeForYou', 8],
    ['#adultHomeReleased', 8], ['#adultHomeDifferent', 8]]) {
    const root = $(selector)
    delete root.dataset.homeTitles
    root.replaceChildren(...Array.from({ length: count }, () => {
      const card = document.createElement('span')
      card.className = 'adult-explore-loading'
      card.append(document.createElement('i'), document.createElement('b'),
        document.createElement('small'))
      return card
    }))
  }
}

function renderAdultHomeKnownContent() {
  const excluded = new Set()
  renderAdultHomeContinue()
  renderAdultHomeSection('#adultHomeUpNextSection', '#adultHomeUpNext',
    adultHomeUpNext(excluded))
  if (adultHomePersonal.length) {
    renderAdultHomeGrid($('#adultHomeForYou'),
      adultHomeUnique(adultHomePersonal, excluded, 8, { includeWatched: true }))
  }
  renderAdultHomeSection('#adultHomeReleasedSection', '#adultHomeReleased',
    adultHomeUnique(adultHomeReleased, new Set(), 16, { includeWatched: true }),
    'adult-home-release')
  if (adultHomeDifferent.length) {
    renderAdultHomeGrid($('#adultHomeDifferent'),
      adultHomeUnique(adultHomeDifferent, excluded, 8))
  }
  refreshAdultExploreCards()
}

async function loadAdultHome({ refresh = false } = {}) {
  await restoreAdultHomeCache()
  renderAdultHomeKnownContent()
  if (adultHomeLoading) return
  const fresh = adultHomeLoadedAt && Date.now() - adultHomeLoadedAt < 60000
  if (!refresh && fresh) return
  adultHomeLoading = true
  if (!adultHomePersonal.length && !adultHomeDifferent.length) renderAdultHomeLoading()
  try {
    if (!adultViewingLoaded) {
      await loadAdultViewing({ render: false })
      renderAdultHomeKnownContent()
    }
    const broadLists = ['documentary', 'animation', 'british', 'science-fiction',
      'comedy', 'crime', 'drama', 'popular']
    const broad = broadLists[(new Date().getDate() + adultHomePage) % broadLists.length]
    const releasedRequest = api('/api/adult/home/released-this-week?limit=16')
      .catch(() => null)
    const [personal, different] = await Promise.all([
      api(`/api/adult/home/what-to-watch?page=${adultHomePage}&limit=8`),
      api(`/api/adult/explore?list=${encodeURIComponent(broad)}&media_type=all&page=${adultHomePage}&available=1&limit=12`),
    ])
    adultHomePersonal = personal.results || []
    adultHomeDifferent = different.results || []
    adultHomeLoadedAt = Date.now()
    renderAdultHomeKnownContent()
    const released = await releasedRequest
    if (released) adultHomeReleased = released.results || []
    await writePortalDataCache('adult-home-v2', {
      page: adultHomePage, personal: adultHomePersonal, different: adultHomeDifferent,
      released: adultHomeReleased,
    }, 'adult_viewing')
    renderAdultHomeKnownContent()
  } catch (error) {
    renderAdultHomeKnownContent()
    if (!adultHomePersonal.length) renderAdultHomeGrid($('#adultHomeForYou'), [])
    if (!adultHomeDifferent.length) renderAdultHomeGrid($('#adultHomeDifferent'), [])
    if (!adultHomeReleased.length) renderAdultHomeSection(
      '#adultHomeReleasedSection', '#adultHomeReleased', [])
  } finally {
    adultHomeLoading = false
  }
}

$('#adultHomeRefresh')?.addEventListener('click', () => {
  adultHomePage = adultHomePage % 3 + 1
  adultHomeLoadedAt = 0
  void loadAdultHome({ refresh: true })
})
$('#adultHomeOpenExplore')?.addEventListener('click', () => {
  history.pushState({ adultExplore: true }, '', '#adult-explore')
  openView('adult-explore')
})
$('#adultHomeUpNextSection [data-viewing-target]')?.addEventListener('click', () => {
  const tab = $('[data-viewing-tab="up-next"]')
  tab?.click()
  history.pushState({ adultViewing: true }, '', '#adult-viewing')
  openView('adult-viewing')
})
