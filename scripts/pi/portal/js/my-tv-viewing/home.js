'use strict'

let myTvHomePage = 1
let myTvHomeLoading = false
let myTvHomeLoadedAt = 0
let myTvHomePersonal = []
let myTvHomeDifferent = []
let myTvHomeReleased = []
let myTvHomeCacheRestored = false

async function restoreMyTvHomeCache() {
  if (myTvHomeCacheRestored) return
  myTvHomeCacheRestored = true
  const cached = await readPortalDataCache('my-tv-home-v2', 'my_tv_viewing')
  if (!cached) return
  myTvHomeLoadedAt = cached.stale ? 0 : Number(cached.saved_at) || 0
  myTvHomePage = Number(cached.data.page) || 1
  myTvHomePersonal = cached.data.personal || []
  myTvHomeDifferent = cached.data.different || []
  myTvHomeReleased = cached.data.released || []
}

function myTvHomeIsWatched(title) {
  return myTvArtworkStatusKind(title, {
    media_type: title.media_type, local: title.local_progress || title.local,
  }) === 'watched'
}

function myTvHomeUnique(values, excluded = new Set(), limit = 8,
  { includeWatched = false } = {}) {
  const result = []
  for (const title of values || []) {
    if (!title?.key || excluded.has(title.key)
        || (!includeWatched && myTvHomeIsWatched(title))) continue
    excluded.add(title.key)
    result.push(title)
    if (result.length >= limit) break
  }
  return result
}

function renderMyTvHomeGrid(root, values, context = 'my-tv-home') {
  const signature = values.map(title => title.key).join('|')
  if (root.dataset.homeTitles === signature && root.children.length) return
  root.dataset.homeTitles = signature
  root.replaceChildren(...values.map(title => myTvExploreCard(title, {
    context,
  })))
  if (!values.length) {
    const quiet = document.createElement('span')
    quiet.className = 'my-tv-home-quiet'
    quiet.textContent = '•••'
    root.append(quiet)
  }
}

function renderMyTvHomeContinue() {
  const resumableFilms = (library?.my_tv_library || [])
    .filter(film => film.browser_ready !== false && watchFilmResumable(film))
    .map(film => ({ ...myTvFilmEntry(film),
      lastWatched: Number(film.remote_last_watched || 0) }))
  const resumable = [...resumableFilms, ...myTvSeriesContinueEntries()]
    .sort((left, right) => Number(right.lastWatched || 0) - Number(left.lastWatched || 0))
    .slice(0, 10)
  $('#myTvHomeContinueSection').classList.toggle('hidden', !resumable.length)
  $('#myTvHomeContinueCount').textContent = resumable.length
    ? `${resumable.length} in progress` : ''
  const root = $('#myTvHomeContinueRail')
  const signature = resumable.map(value => {
    const media = value.kind === 'my-tv-series' ? value.episode : value.film || value
    return [value.key || media.path || value.title, Number(media.remote_position || 0),
      Number(value.lastWatched || media.remote_last_watched || 0)].join(':')
  }).join('|')
  if (root.dataset.homeTitles !== signature || !root.children.length) {
    root.dataset.homeTitles = signature
    root.replaceChildren(...resumable.map(value => continueWatchCard(value)))
  }
}

function myTvHomeUpNext(excluded) {
  return myTvHomeUnique([...(myTvViewingData.items || [])]
    .filter(item => item.up_next === true)
    .sort((left, right) => Number(left.up_next_rank || 999999)
      - Number(right.up_next_rank || 999999)), excluded, 8)
}

function renderMyTvHomeSection(section, root, values, context = 'my-tv-home') {
  $(section).classList.toggle('hidden', !values.length)
  renderMyTvHomeGrid($(root), values, context)
}

function renderMyTvHomeLoading() {
  for (const [selector, count] of [['#myTvHomeForYou', 8],
    ['#myTvHomeReleased', 8], ['#myTvHomeDifferent', 8]]) {
    const root = $(selector)
    delete root.dataset.homeTitles
    root.replaceChildren(...Array.from({ length: count }, () => {
      const card = document.createElement('span')
      card.className = 'my-tv-explore-loading'
      card.append(document.createElement('i'), document.createElement('b'),
        document.createElement('small'))
      return card
    }))
  }
}

function renderMyTvHomeKnownContent() {
  const excluded = new Set()
  renderMyTvHomeContinue()
  renderMyTvHomeSection('#myTvHomeUpNextSection', '#myTvHomeUpNext',
    myTvHomeUpNext(excluded))
  if (myTvHomePersonal.length) {
    renderMyTvHomeGrid($('#myTvHomeForYou'),
      myTvHomeUnique(myTvHomePersonal, excluded, 8, { includeWatched: true }))
  }
  renderMyTvHomeSection('#myTvHomeReleasedSection', '#myTvHomeReleased',
    myTvHomeUnique(myTvHomeReleased, new Set(), 16, { includeWatched: true }),
    'my-tv-home-release')
  if (myTvHomeDifferent.length) {
    renderMyTvHomeGrid($('#myTvHomeDifferent'),
      myTvHomeUnique(myTvHomeDifferent, excluded, 8))
  }
  refreshMyTvExploreCards()
}

async function loadMyTvHome({ refresh = false } = {}) {
  await restoreMyTvHomeCache()
  renderMyTvHomeKnownContent()
  if (myTvHomeLoading) return
  const fresh = myTvHomeLoadedAt && Date.now() - myTvHomeLoadedAt < 60000
  if (!refresh && fresh) return
  myTvHomeLoading = true
  if (!myTvHomePersonal.length && !myTvHomeDifferent.length) renderMyTvHomeLoading()
  try {
    if (!myTvViewingLoaded) {
      await loadMyTvViewing({ render: false })
      renderMyTvHomeKnownContent()
    }
    const broadLists = ['documentary', 'animation', 'british', 'science-fiction',
      'comedy', 'crime', 'drama', 'popular']
    const broad = broadLists[(new Date().getDate() + myTvHomePage) % broadLists.length]
    const releasedRequest = api('/api/my-tv/home/released-this-week?limit=16')
      .catch(() => null)
    const [personal, different] = await Promise.all([
      api(`/api/my-tv/home/what-to-watch?page=${myTvHomePage}&limit=8`),
      api(`/api/my-tv/explore?list=${encodeURIComponent(broad)}&media_type=all&page=${myTvHomePage}&available=1&limit=12`),
    ])
    myTvHomePersonal = personal.results || []
    myTvHomeDifferent = different.results || []
    myTvHomeLoadedAt = Date.now()
    renderMyTvHomeKnownContent()
    const released = await releasedRequest
    if (released) myTvHomeReleased = released.results || []
    await writePortalDataCache('my-tv-home-v2', {
      page: myTvHomePage, personal: myTvHomePersonal, different: myTvHomeDifferent,
      released: myTvHomeReleased,
    }, 'my_tv_viewing')
    renderMyTvHomeKnownContent()
  } catch (error) {
    renderMyTvHomeKnownContent()
    if (!myTvHomePersonal.length) renderMyTvHomeGrid($('#myTvHomeForYou'), [])
    if (!myTvHomeDifferent.length) renderMyTvHomeGrid($('#myTvHomeDifferent'), [])
    if (!myTvHomeReleased.length) renderMyTvHomeSection(
      '#myTvHomeReleasedSection', '#myTvHomeReleased', [])
  } finally {
    myTvHomeLoading = false
  }
}

$('#myTvHomeRefresh')?.addEventListener('click', () => {
  myTvHomePage = myTvHomePage % 3 + 1
  myTvHomeLoadedAt = 0
  void loadMyTvHome({ refresh: true })
})
$('#myTvHomeOpenExplore')?.addEventListener('click', () => {
  history.pushState({ myTvExplore: true }, '', '#my-tv-explore')
  openView('my-tv-explore')
})
$('#myTvHomeUpNextSection [data-viewing-target]')?.addEventListener('click', () => {
  const tab = $('[data-viewing-tab="up-next"]')
  tab?.click()
  history.pushState({ myTvViewing: true }, '', '#my-tv-viewing')
  openView('my-tv-viewing')
})
