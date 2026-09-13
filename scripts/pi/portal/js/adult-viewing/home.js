'use strict'

let adultHomePage = 1
let adultHomeLoading = false
let adultHomeLoadedAt = 0
let adultHomePersonal = []
let adultHomeDifferent = []
let adultHomeCacheRestored = false

async function restoreAdultHomeCache() {
  if (adultHomeCacheRestored) return
  adultHomeCacheRestored = true
  const cached = await readPortalDataCache('adult-home-v1', 'adult_viewing')
  if (!cached) return
  adultHomeLoadedAt = cached.stale ? 0 : Number(cached.saved_at) || 0
  adultHomePage = Number(cached.data.page) || 1
  adultHomePersonal = cached.data.personal || []
  adultHomeDifferent = cached.data.different || []
}

function adultHomeIsWatched(title) {
  return adultArtworkStatusKind(title, {
    media_type: title.media_type, local: title.local_progress || title.local,
  }) === 'watched'
}

function adultHomeUnique(values, excluded = new Set(), limit = 8) {
  const result = []
  for (const title of values || []) {
    if (!title?.key || excluded.has(title.key) || adultHomeIsWatched(title)) continue
    excluded.add(title.key)
    result.push(title)
    if (result.length >= limit) break
  }
  return result
}

function renderAdultHomeGrid(root, values) {
  const signature = values.map(title => title.key).join('|')
  if (root.dataset.homeTitles === signature && root.children.length) return
  root.dataset.homeTitles = signature
  root.replaceChildren(...values.map(title => adultExploreCard(title, {
    context: 'adult-home',
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

function renderAdultHomeSection(section, root, values) {
  $(section).classList.toggle('hidden', !values.length)
  renderAdultHomeGrid($(root), values)
}

function renderAdultHomeLoading() {
  for (const selector of ['#adultHomeForYou', '#adultHomeDifferent']) {
    const root = $(selector)
    delete root.dataset.homeTitles
    root.replaceChildren(...Array.from({ length: 8 }, () => {
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
      adultHomeUnique(adultHomePersonal, excluded, 8))
  }
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
    const [personal, different] = await Promise.all([
      api(`/api/adult/explore?list=for-you&media_type=all&page=${adultHomePage}&available=1&limit=12`),
      api(`/api/adult/explore?list=${encodeURIComponent(broad)}&media_type=all&page=${adultHomePage}&available=1&limit=12`),
    ])
    adultHomePersonal = personal.results || []
    adultHomeDifferent = different.results || []
    adultHomeLoadedAt = Date.now()
    await writePortalDataCache('adult-home-v1', {
      page: adultHomePage, personal: adultHomePersonal, different: adultHomeDifferent,
    }, 'adult_viewing')
    renderAdultHomeKnownContent()
  } catch (error) {
    renderAdultHomeKnownContent()
    if (!adultHomePersonal.length) renderAdultHomeGrid($('#adultHomeForYou'), [])
    if (!adultHomeDifferent.length) renderAdultHomeGrid($('#adultHomeDifferent'), [])
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
