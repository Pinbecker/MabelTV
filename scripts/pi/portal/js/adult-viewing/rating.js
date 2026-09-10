'use strict'

function adultPersonalRating(title = {}) {
  const state = adultViewingRecord(title)
  const value = Number(state.personal_rating || title.viewing?.personal_rating || 0)
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : 0
}

function adultRatingAvailable(title = {}) {
  return adultTitleViewingStatus(adultViewingRecord(title), title).completed
}

function setAdultRatingVisual(root, rating) {
  const value = Math.max(0, Math.min(10, Number(rating) || 0))
  root.dataset.rating = String(value)
  root.setAttribute('aria-valuenow', String(value))
  root.setAttribute('aria-valuetext', value ? `${value} out of 10 stars` : 'Not rated')
  root.querySelectorAll('.adult-rating-star').forEach((star, index) => {
    star.classList.toggle('is-filled', index < value)
  })
  const output = root.querySelector('.adult-rating-value')
  if (output) output.textContent = value ? `${value}/10` : '—'
  const label = root.querySelector('.adult-rating-label')
  if (label) {
    label.classList.toggle('is-clearable', value > 0)
    label.toggleAttribute('disabled', value === 0)
    label.setAttribute('aria-label', value > 0 ? 'Clear your rating' : 'Your rating')
  }
}

function adultRatingFromPointer(track, clientX) {
  const bounds = track.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
  return Math.max(1, Math.min(10, Math.ceil(ratio * 10)))
}

function renderAdultPersonalRating(host, title = {}) {
  if (!host) return
  host.replaceChildren()
  const tmdbId = Number(title.tmdb_id || 0)
  if (!tmdbId || !['movie', 'tv'].includes(title.media_type)) {
    host.classList.add('hidden')
    return
  }
  host.classList.remove('hidden')
  const control = document.createElement('div')
  control.className = 'adult-personal-rating'
  control.dataset.ratingKey = title.key || `${title.media_type}:${tmdbId}`
  const label = document.createElement('button')
  label.type = 'button'
  label.className = 'adult-rating-label'
  label.textContent = 'Your rating'
  if (!adultRatingAvailable(title)) {
    control.classList.add('is-locked')
    control.setAttribute('role', 'note')
    label.disabled = true
    label.textContent = 'Mark watched to add a rating'
    control.append(label)
    host.append(control)
    return
  }
  control.setAttribute('role', 'slider')
  control.setAttribute('tabindex', '0')
  control.setAttribute('aria-label', `Your rating for ${title.title || 'this title'}`)
  control.setAttribute('aria-valuemin', '0')
  control.setAttribute('aria-valuemax', '10')
  const track = document.createElement('span')
  track.className = 'adult-rating-track'
  for (let index = 0; index < 10; index += 1) {
    const star = librarySignalIcon('signal-star', 'icon adult-rating-star')
    star.setAttribute('aria-hidden', 'true')
    track.append(star)
  }
  const output = document.createElement('span')
  output.className = 'adult-rating-value'
  let savedRating = adultPersonalRating(title)
  let pointerActive = false
  let saveRevision = 0
  const save = async rating => {
    const revision = ++saveRevision
    const previous = savedRating
    savedRating = rating
    setAdultRatingVisual(control, rating)
    try {
      title.viewing = await updateAdultViewing(title, 'rating', { rating }, () => {
        if (revision === saveRevision) setAdultRatingVisual(control, adultPersonalRating(title))
        if ($('#view-adult-ratings')?.classList.contains('active')) renderAdultRatingsQueue()
      })
      savedRating = adultPersonalRating(title)
    } catch (error) {
      if (revision === saveRevision) {
        savedRating = previous
        setAdultRatingVisual(control, previous)
        showError(error)
      }
    }
  }
  label.addEventListener('click', event => {
    event.stopPropagation()
    if (Number(control.dataset.rating || 0) > 0) void save(0)
  })
  track.addEventListener('pointerdown', event => {
    pointerActive = true
    track.setPointerCapture?.(event.pointerId)
    setAdultRatingVisual(control, adultRatingFromPointer(track, event.clientX))
  })
  track.addEventListener('pointermove', event => {
    if (pointerActive) setAdultRatingVisual(control, adultRatingFromPointer(track, event.clientX))
  })
  track.addEventListener('pointerup', event => {
    if (!pointerActive) return
    pointerActive = false
    track.releasePointerCapture?.(event.pointerId)
    void save(adultRatingFromPointer(track, event.clientX))
  })
  track.addEventListener('pointercancel', () => {
    pointerActive = false
    setAdultRatingVisual(control, savedRating)
  })
  control.addEventListener('keydown', event => {
    let rating = Number(control.dataset.rating || 0)
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') rating = Math.min(10, rating + 1)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') rating = Math.max(0, rating - 1)
    else if (event.key === 'Home' || event.key === 'Backspace' || event.key === 'Delete') rating = 0
    else if (event.key === 'End') rating = 10
    else return
    event.preventDefault()
    void save(rating)
  })
  control.append(label, track, output)
  host.append(control)
  setAdultRatingVisual(control, savedRating)
}

function syncAdultPersonalRatingForIntentRoot(root, title) {
  const host = root?.id === 'adultTitleIntents' ? $('#adultTitlePersonalRating')
    : root?.id === 'watchFilmViewingActions' ? $('#watchFilmPersonalRating')
      : root?.id === 'adultSeriesIntents' ? $('#adultSeriesPersonalRating') : null
  if (host) renderAdultPersonalRating(host, title)
}

function adultUnratedWatchedTitles() {
  return (adultViewingData.items || []).filter(title =>
    adultTitleViewingStatus(title, title).completed && !adultPersonalRating(title))
    .sort((left, right) => String(left.title || '').localeCompare(
      String(right.title || ''), undefined, { sensitivity: 'base' }))
}

function renderAdultRatingsQueue() {
  const root = $('#adultRatingsGrid')
  if (!root) return
  const titles = adultUnratedWatchedTitles()
  root.replaceChildren()
  titles.forEach(title => root.append(adultExploreCard(title, {
    directActions: false, context: 'ratings',
  })))
  if (!titles.length) root.append(portalEmptyState({
    className: 'watch-empty', title: 'Everything watched is rated',
    message: 'Newly watched titles will appear here automatically.',
  }))
  $('#adultRatingsCount').textContent = `${titles.length} title${titles.length === 1 ? '' : 's'}`
}

async function loadAdultRatings() {
  await loadAdultViewing()
  renderAdultRatingsQueue()
}

$('#adultViewingRatings')?.addEventListener('click', () => {
  history.pushState({ adultRatings: true }, '', '#adult-ratings')
  openView('adult-ratings')
})
$('#adultRatingsBack')?.addEventListener('click', () => {
  if (history.state?.adultRatings) history.back()
  else {
    history.replaceState({ adultViewing: true }, '', '#adult-viewing')
    openView('adult-viewing')
  }
})
