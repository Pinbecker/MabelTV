'use strict'

function myTvPersonalRating(title = {}) {
  const state = myTvViewingRecord(title)
  const value = Number(state.personal_rating || title.viewing?.personal_rating || 0)
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : 0
}

function myTvRatingAvailable(title = {}) {
  return myTvTitleViewingStatus(myTvViewingRecord(title), title).completed
}

function setMyTvRatingVisual(root, rating) {
  const value = Math.max(0, Math.min(10, Number(rating) || 0))
  root.dataset.rating = String(value)
  root.setAttribute('aria-valuenow', String(value))
  root.setAttribute('aria-valuetext', value ? `${value} out of 10 stars` : 'Not rated')
  root.querySelectorAll('.my-tv-rating-star').forEach((star, index) => {
    star.classList.toggle('is-filled', index < value)
  })
  const output = root.querySelector('.my-tv-rating-value')
  if (output) output.textContent = value ? `${value}/10` : '—'
  const label = root.querySelector('.my-tv-rating-label')
  if (label) {
    label.classList.toggle('is-clearable', value > 0)
    label.toggleAttribute('disabled', value === 0)
    label.setAttribute('aria-label', value > 0 ? 'Clear your rating' : 'Your rating')
  }
}

function myTvRatingFromPointer(track, clientX) {
  const bounds = track.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
  return Math.max(1, Math.min(10, Math.ceil(ratio * 10)))
}

function renderMyTvPersonalRating(host, title = {}) {
  if (!host) return
  host.replaceChildren()
  const tmdbId = Number(title.tmdb_id || 0)
  if (!tmdbId || !['movie', 'tv'].includes(title.media_type)) {
    host.classList.add('hidden')
    return
  }
  host.classList.remove('hidden')
  const control = document.createElement('div')
  control.className = 'my-tv-personal-rating'
  control.dataset.ratingKey = title.key || `${title.media_type}:${tmdbId}`
  const label = document.createElement('button')
  label.type = 'button'
  label.className = 'my-tv-rating-label'
  label.textContent = 'Your rating'
  if (!myTvRatingAvailable(title)) {
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
  track.className = 'my-tv-rating-track'
  for (let index = 0; index < 10; index += 1) {
    const star = librarySignalIcon('signal-star', 'icon my-tv-rating-star')
    star.setAttribute('aria-hidden', 'true')
    track.append(star)
  }
  const output = document.createElement('span')
  output.className = 'my-tv-rating-value'
  let savedRating = myTvPersonalRating(title)
  let pointerActive = false
  let saveRevision = 0
  const save = async rating => {
    const revision = ++saveRevision
    const previous = savedRating
    savedRating = rating
    setMyTvRatingVisual(control, rating)
    try {
      title.viewing = await updateMyTvViewing(title, 'rating', { rating }, () => {
        if (revision === saveRevision) setMyTvRatingVisual(control, myTvPersonalRating(title))
        if ($('#view-my-tv-ratings')?.classList.contains('active')) renderMyTvRatingsQueue()
      })
      savedRating = myTvPersonalRating(title)
    } catch (error) {
      if (revision === saveRevision) {
        savedRating = previous
        setMyTvRatingVisual(control, previous)
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
    setMyTvRatingVisual(control, myTvRatingFromPointer(track, event.clientX))
  })
  track.addEventListener('pointermove', event => {
    if (pointerActive) setMyTvRatingVisual(control, myTvRatingFromPointer(track, event.clientX))
  })
  track.addEventListener('pointerup', event => {
    if (!pointerActive) return
    pointerActive = false
    track.releasePointerCapture?.(event.pointerId)
    void save(myTvRatingFromPointer(track, event.clientX))
  })
  track.addEventListener('pointercancel', () => {
    pointerActive = false
    setMyTvRatingVisual(control, savedRating)
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
  setMyTvRatingVisual(control, savedRating)
}

function syncMyTvPersonalRatingForIntentRoot(root, title) {
  const host = root?.id === 'myTvTitleIntents' ? $('#myTvTitlePersonalRating')
    : root?.id === 'watchFilmViewingActions' ? $('#watchFilmPersonalRating')
      : root?.id === 'myTvSeriesIntents' ? $('#myTvSeriesPersonalRating') : null
  if (host) renderMyTvPersonalRating(host, title)
}

function myTvUnratedWatchedTitles() {
  return (myTvViewingData.items || []).filter(title =>
    myTvTitleViewingStatus(title, title).completed && !myTvPersonalRating(title))
    .sort((left, right) => String(left.title || '').localeCompare(
      String(right.title || ''), undefined, { sensitivity: 'base' }))
}

function renderMyTvRatingsQueue() {
  const root = $('#myTvRatingsGrid')
  if (!root) return
  const titles = myTvUnratedWatchedTitles()
  root.replaceChildren()
  titles.forEach(title => root.append(myTvExploreCard(title, {
    directActions: false, context: 'ratings',
  })))
  if (!titles.length) root.append(portalEmptyState({
    className: 'watch-empty', title: 'Everything watched is rated',
    message: 'Newly watched titles will appear here automatically.',
  }))
  $('#myTvRatingsCount').textContent = `${titles.length} title${titles.length === 1 ? '' : 's'}`
}

async function loadMyTvRatings() {
  await loadMyTvViewing()
  renderMyTvRatingsQueue()
}

$('#myTvViewingRatings')?.addEventListener('click', () => {
  history.pushState({ myTvRatings: true }, '', '#my-tv-ratings')
  openView('my-tv-ratings')
})
$('#myTvRatingsBack')?.addEventListener('click', () => {
  if (history.state?.myTvRatings) history.back()
  else {
    history.replaceState({ myTvViewing: true }, '', '#my-tv-viewing')
    openView('my-tv-viewing')
  }
})
