'use strict'

let myTvPersonOpenRevision = 0

function myTvPersonInitials(name) {
  return String(name || '?').split(/\s+/).slice(0, 2)
    .map(part => part.slice(0, 1)).join('').toUpperCase()
}

function renderMyTvPersonPhoto(person) {
  const root = $('#myTvPersonPhoto')
  root.replaceChildren()
  if (person.profile_path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = myTvPosterUrl(person.profile_path, 'w342')
    image.alt = `Portrait of ${person.name}`
    root.append(image)
    return
  }
  const initials = document.createElement('b')
  initials.textContent = myTvPersonInitials(person.name)
  root.append(initials)
}

function myTvPersonWatchedCredits(source, detail) {
  if (!Array.isArray(source.insight_watched)) return null
  const watchedByKey = new Map((source.insight_watched_pool || [])
    .filter(title => title?.key).map(title => [title.key, title]))
  const matches = new Map()
  ;(detail.filmography || []).forEach(credit => {
    const watched = watchedByKey.get(credit.key)
    if (watched) matches.set(credit.key, { ...watched, ...credit })
  })
  source.insight_watched.forEach(title => {
    if (!title?.key || matches.has(title.key)) return
    matches.set(title.key, { ...title })
  })
  return [...matches.values()].map(title => ({ ...title, viewing: {
    ...title, manual_state: 'watched', history: [],
  } })).sort((left, right) => Number(right.year || 0) - Number(left.year || 0)
    || String(left.title || '').localeCompare(String(right.title || ''), undefined,
      { sensitivity: 'base' }))
}

function myTvPersonInsightDetail(source, detail) {
  const watched = myTvPersonWatchedCredits(source, detail)
  if (!watched) return detail
  return {
    ...detail,
    insight_watched: watched,
    insight_watched_pool: source.insight_watched_pool || [],
  }
}

function renderMyTvPersonDetail(person, context = '', returnTo = null) {
  $('#myTvPersonName').textContent = person.name
  if (context) $('#myTvPersonContext').textContent = context
  renderMyTvPersonPhoto(person)
  const facts = $('#myTvPersonFacts')
  facts.replaceChildren()
  const addFact = (label, value) => {
    if (!value) return
    const row = document.createElement('div')
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value
    row.append(term, description)
    facts.append(row)
  }
  addFact('Known for', person.known_for_department)
  addFact('Born', myTvExactDateLabel(person.birthday))
  addFact('Died', myTvExactDateLabel(person.deathday))
  addFact('From', person.place_of_birth)
  configureMyTvPersonBiography(person.biography || 'No biography is available for this cast member.')
  const section = $('#myTvPersonKnownFor')
  const credits = $('#myTvPersonCredits')
  const filmography = $('#myTvPersonFilmography')
  const completeHistory = Array.isArray(person.insight_watched)
  $('#myTvPersonKnownForHeading').textContent = completeHistory ? 'You Have Watched' : 'Known for'
  section.classList.toggle('is-complete-history', completeHistory)
  credits.classList.toggle('is-complete-history', completeHistory)
  filmography.classList.toggle('hidden', !(person.filmography || []).length)
  filmography.onclick = () => openMyTvFilmography(person, context, returnTo)
  credits.replaceChildren()
  const knownFor = completeHistory ? person.insight_watched : (person.known_for || []).slice(0, 10)
  const pages = []
  knownFor.forEach((title, index) => {
    if (!pages.length || (!completeHistory && index % 10 === 0)) {
      const page = document.createElement('div')
      page.className = 'my-tv-person-credit-page'
      credits.append(page)
      pages.push(page)
    }
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'my-tv-franchise-card'
    card.setAttribute('aria-label', `Open ${title.title}`)
    const art = document.createElement('span')
    art.className = 'my-tv-franchise-art'
    if (title.poster_path) {
      const image = document.createElement('img')
      image.loading = 'lazy'
      image.decoding = 'async'
      image.src = myTvPosterUrl(title.poster_path, 'w185')
      image.alt = ''
      art.append(image)
    } else {
      const placeholder = document.createElement('b')
      placeholder.textContent = String(title.title || '?').slice(0, 1).toUpperCase()
      art.append(placeholder)
    }
    appendMyTvArtworkStatus(art, title)
    renderMyTvProviderBadges(art, title)
    const name = document.createElement('strong')
    name.textContent = title.title
    const role = document.createElement('small')
    role.textContent = [title.year, title.character].filter(Boolean).join(' · ') || 'Title'
    card.append(art, name, role)
    card.onclick = () => {
      portalSheets.suspend($('#myTvPersonSheet'), { card: true })
      void openMyTvTitle(title, () => restoreMyTvPersonSheet(person, context, returnTo))
    }
    pages[pages.length - 1].append(card)
  })
  section.classList.toggle('hidden', !credits.children.length)
}

function configureMyTvPersonBiography(value) {
  const biography = $('#myTvPersonBiography')
  const control = $('#myTvPersonBiographyExpand')
  const label = control.querySelector('span')
  biography.textContent = value
  biography.classList.remove('is-expanded')
  control.classList.add('hidden')
  control.setAttribute('aria-expanded', 'false')
  label.textContent = 'More'
  control.onclick = () => {
    const expanded = !biography.classList.contains('is-expanded')
    biography.classList.toggle('is-expanded', expanded)
    control.setAttribute('aria-expanded', String(expanded))
    label.textContent = expanded ? 'Less' : 'More'
  }
  requestAnimationFrame(() => {
    control.classList.toggle('hidden', biography.scrollHeight <= biography.clientHeight + 1)
  })
}

function restoreMyTvPersonSheet(person, context, returnTo = null) {
  const sheet = $('#myTvPersonSheet')
  portalSheets.open(sheet, { returnTo, focus: sheet.querySelector('.library-sheet-panel') })
  renderMyTvPersonDetail(person, context, returnTo)
}

async function openMyTvPerson(person, title, returnTo = null) {
  const personId = Number(person.tmdb_id || 0)
  if (!personId) return
  const revision = ++myTvPersonOpenRevision
  const sheet = $('#myTvPersonSheet')
  $('#myTvPersonName').textContent = person.name
  const context = person.context || (person.character
    ? `As ${person.character} in ${title}`
    : person.role ? `${person.role} of ${title}` : `Principal cast in ${title}`)
  $('#myTvPersonContext').textContent = context
  $('#myTvPersonFacts').replaceChildren()
  $('#myTvPersonBiography').textContent = 'Loading biography…'
  $('#myTvPersonBiography').classList.remove('is-expanded')
  $('#myTvPersonBiographyExpand').classList.add('hidden')
  $('#myTvPersonBiographyExpand').setAttribute('aria-expanded', 'false')
  $('#myTvPersonKnownFor').classList.add('hidden')
  const credits = $('#myTvPersonCredits')
  credits.replaceChildren()
  renderMyTvPersonPhoto(person)
  portalSheets.open(sheet, { returnTo, focus: sheet.querySelector('.library-sheet-panel') })
  const cacheKey = `my-tv-person-v1:${personId}`
  try {
    const cached = await readPortalDataCache(cacheKey)
    if (cached && revision === myTvPersonOpenRevision && sheet.open) {
      renderMyTvPersonDetail(myTvPersonInsightDetail(person, cached.data), context, returnTo)
    }
    const detail = await api(`/api/my-tv/person?tmdb_id=${personId}`)
    if (revision !== myTvPersonOpenRevision || !sheet.open) return
    if (!cached) {
      renderMyTvPersonDetail(myTvPersonInsightDetail(person, detail), context, returnTo)
    }
    void writePortalDataCache(cacheKey, detail)
  } catch (error) {
    if (revision !== myTvPersonOpenRevision || !sheet.open) return
    $('#myTvPersonBiography').textContent = error.message || 'Cast details are unavailable right now.'
    $('#myTvPersonBiographyExpand').classList.add('hidden')
  }
}

function closeMyTvPersonSheet() {
  myTvPersonOpenRevision += 1
  portalSheets.dismissJourney()
}

$('#myTvPersonClose')?.addEventListener('click', closeMyTvPersonSheet)
$('#myTvPersonSheet')?.addEventListener('click', event => {
  if (event.target === $('#myTvPersonSheet')) closeMyTvPersonSheet()
})
$('#myTvPersonSheet')?.addEventListener('cancel', event => {
  event.preventDefault()
  closeMyTvPersonSheet()
})
