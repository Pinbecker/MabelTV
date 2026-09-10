'use strict'

let adultPersonOpenRevision = 0

function adultPersonInitials(name) {
  return String(name || '?').split(/\s+/).slice(0, 2)
    .map(part => part.slice(0, 1)).join('').toUpperCase()
}

function renderAdultPersonPhoto(person) {
  const root = $('#adultPersonPhoto')
  root.replaceChildren()
  if (person.profile_path) {
    const image = document.createElement('img')
    image.src = adultPosterUrl(person.profile_path, 'w342')
    image.alt = `Portrait of ${person.name}`
    root.append(image)
    return
  }
  const initials = document.createElement('b')
  initials.textContent = adultPersonInitials(person.name)
  root.append(initials)
}

function adultPersonWatchedCredits(source, detail) {
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

function adultPersonInsightDetail(source, detail) {
  const watched = adultPersonWatchedCredits(source, detail)
  if (!watched) return detail
  return {
    ...detail,
    insight_watched: watched,
    insight_watched_pool: source.insight_watched_pool || [],
  }
}

function renderAdultPersonDetail(person, context = '', returnTo = null) {
  $('#adultPersonName').textContent = person.name
  if (context) $('#adultPersonContext').textContent = context
  renderAdultPersonPhoto(person)
  const facts = $('#adultPersonFacts')
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
  addFact('Born', adultExactDateLabel(person.birthday))
  addFact('Died', adultExactDateLabel(person.deathday))
  addFact('From', person.place_of_birth)
  configureAdultPersonBiography(person.biography || 'No biography is available for this cast member.')
  const section = $('#adultPersonKnownFor')
  const credits = $('#adultPersonCredits')
  const filmography = $('#adultPersonFilmography')
  const completeHistory = Array.isArray(person.insight_watched)
  $('#adultPersonKnownForHeading').textContent = completeHistory ? 'You Have Watched' : 'Known for'
  section.classList.toggle('is-complete-history', completeHistory)
  credits.classList.toggle('is-complete-history', completeHistory)
  filmography.classList.toggle('hidden', !(person.filmography || []).length)
  filmography.onclick = () => openAdultFilmography(person, context, returnTo)
  credits.replaceChildren()
  const knownFor = completeHistory ? person.insight_watched : (person.known_for || []).slice(0, 10)
  const pages = []
  knownFor.forEach((title, index) => {
    if (!pages.length || (!completeHistory && index % 10 === 0)) {
      const page = document.createElement('div')
      page.className = 'adult-person-credit-page'
      credits.append(page)
      pages.push(page)
    }
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'adult-franchise-card'
    card.setAttribute('aria-label', `Open ${title.title}`)
    const art = document.createElement('span')
    art.className = 'adult-franchise-art'
    if (title.poster_path) {
      const image = document.createElement('img')
      image.src = adultPosterUrl(title.poster_path, 'w185')
      image.alt = ''
      art.append(image)
    } else {
      const placeholder = document.createElement('b')
      placeholder.textContent = String(title.title || '?').slice(0, 1).toUpperCase()
      art.append(placeholder)
    }
    appendAdultArtworkStatus(art, title)
    const name = document.createElement('strong')
    name.textContent = title.title
    const role = document.createElement('small')
    role.textContent = [title.year, title.character].filter(Boolean).join(' · ') || 'Title'
    card.append(art, name, role)
    card.onclick = () => {
      portalSheets.suspend($('#adultPersonSheet'), { card: true })
      void openAdultTitle(title, () => restoreAdultPersonSheet(person, context, returnTo))
    }
    pages[pages.length - 1].append(card)
  })
  section.classList.toggle('hidden', !credits.children.length)
}

function configureAdultPersonBiography(value) {
  const biography = $('#adultPersonBiography')
  const control = $('#adultPersonBiographyExpand')
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

function restoreAdultPersonSheet(person, context, returnTo = null) {
  const sheet = $('#adultPersonSheet')
  portalSheets.open(sheet, { returnTo, focus: sheet.querySelector('.library-sheet-panel') })
  renderAdultPersonDetail(person, context, returnTo)
}

async function openAdultPerson(person, title, returnTo = null) {
  const personId = Number(person.tmdb_id || 0)
  if (!personId) return
  const revision = ++adultPersonOpenRevision
  const sheet = $('#adultPersonSheet')
  $('#adultPersonName').textContent = person.name
  const context = person.context || (person.character
    ? `As ${person.character} in ${title}`
    : person.role ? `${person.role} of ${title}` : `Principal cast in ${title}`)
  $('#adultPersonContext').textContent = context
  $('#adultPersonFacts').replaceChildren()
  $('#adultPersonBiography').textContent = 'Loading biography…'
  $('#adultPersonBiography').classList.remove('is-expanded')
  $('#adultPersonBiographyExpand').classList.add('hidden')
  $('#adultPersonBiographyExpand').setAttribute('aria-expanded', 'false')
  $('#adultPersonKnownFor').classList.add('hidden')
  const credits = $('#adultPersonCredits')
  credits.replaceChildren()
  renderAdultPersonPhoto(person)
  portalSheets.open(sheet, { returnTo, focus: sheet.querySelector('.library-sheet-panel') })
  try {
    const detail = await api(`/api/adult/person?tmdb_id=${personId}`)
    if (revision !== adultPersonOpenRevision || !sheet.open) return
    renderAdultPersonDetail(adultPersonInsightDetail(person, detail), context, returnTo)
  } catch (error) {
    if (revision !== adultPersonOpenRevision || !sheet.open) return
    $('#adultPersonBiography').textContent = error.message || 'Cast details are unavailable right now.'
    $('#adultPersonBiographyExpand').classList.add('hidden')
  }
}

function closeAdultPersonSheet() {
  adultPersonOpenRevision += 1
  portalSheets.dismissJourney()
}

$('#adultPersonClose')?.addEventListener('click', closeAdultPersonSheet)
$('#adultPersonSheet')?.addEventListener('click', event => {
  if (event.target === $('#adultPersonSheet')) closeAdultPersonSheet()
})
$('#adultPersonSheet')?.addEventListener('cancel', event => {
  event.preventDefault()
  closeAdultPersonSheet()
})
