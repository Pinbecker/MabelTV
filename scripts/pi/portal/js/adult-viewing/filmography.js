'use strict'

let adultFilmographyPerson = null
let adultFilmographyContext = ''
let adultFilmographyReturnTo = null
let adultFilmographySearch = ''
let adultFilmographyMode = 'timeline'
let adultFilmographyOpen = false

function adultFilmographySortTitle(title) {
  return String(title || '').replace(/^(?:the|an?)\s+/i, '').trim()
}

function adultFilmographyYear(title) {
  const year = String(title.year || title.release_date || title.first_air_date || '').slice(0, 4)
  return /^\d{4}$/.test(year) ? year : 'Date unknown'
}

function renderAdultFilmographyPerson(person) {
  $('#adultFilmographyName').textContent = person?.name || 'Filmography'
  const photo = $('#adultFilmographyPhoto')
  photo.replaceChildren()
  if (person?.profile_path) {
    const image = document.createElement('img')
    image.src = adultPosterUrl(person.profile_path, 'w342')
    image.alt = `Portrait of ${person.name}`
    photo.append(image)
  } else {
    const initials = document.createElement('b')
    initials.textContent = adultPersonInitials(person?.name)
    photo.append(initials)
  }
  const titles = person?.filmography || []
  const years = titles.map(adultFilmographyYear).filter(year => year !== 'Date unknown')
  const first = years.length ? Math.min(...years.map(Number)) : 0
  $('#adultFilmographyMeta').textContent = [
    first ? `Screen credits from ${first}` : '',
    `${titles.length} title${titles.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ')
}

function adultFilmographyGroup(label, titles) {
  const section = document.createElement('section')
  section.className = 'adult-filmography-year'
  const header = document.createElement('header')
  const heading = document.createElement('h2')
  heading.textContent = label
  const count = document.createElement('span')
  count.textContent = `${titles.length} title${titles.length === 1 ? '' : 's'}`
  header.append(heading, count)
  const grid = document.createElement('div')
  grid.className = 'adult-explore-grid adult-filmography-grid'
  titles.forEach(title => grid.append(adultExploreCard(title, {
    directActions: true, context: 'filmography',
  })))
  section.append(header, grid)
  return section
}

function renderAdultFilmography() {
  const root = $('#adultFilmographyTimeline')
  if (!root) return
  renderAdultFilmographyPerson(adultFilmographyPerson)
  const query = adultFilmographySearch.trim().toLocaleLowerCase()
  const titles = (adultFilmographyPerson?.filmography || []).filter(title => !query || [
    title.title, title.character, title.year,
  ].join(' ').toLocaleLowerCase().includes(query))
  root.replaceChildren()
  if (!titles.length) {
    root.append(portalEmptyState({
      className: 'watch-empty', title: query ? 'No matching credits' : 'No filmography available',
      message: query ? 'Try another title, role or year.' : 'TMDB has no screen credits for this person.',
    }))
    return
  }
  const groups = new Map()
  if (adultFilmographyMode === 'az') {
    titles.sort((left, right) => adultFilmographySortTitle(left.title).localeCompare(
      adultFilmographySortTitle(right.title), undefined, { sensitivity: 'base' }))
    titles.forEach(title => {
      const initial = adultFilmographySortTitle(title.title).slice(0, 1).toLocaleUpperCase()
      const label = /[A-Z]/.test(initial) ? initial : '#'
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(title)
    })
  } else {
    titles.sort((left, right) => {
      const leftYear = adultFilmographyYear(left)
      const rightYear = adultFilmographyYear(right)
      if (leftYear === 'Date unknown') return rightYear === 'Date unknown' ? 0 : 1
      if (rightYear === 'Date unknown') return -1
      return Number(rightYear) - Number(leftYear)
        || adultFilmographySortTitle(left.title).localeCompare(adultFilmographySortTitle(right.title))
    })
    titles.forEach(title => {
      const label = adultFilmographyYear(title)
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(title)
    })
  }
  groups.forEach((values, label) => root.append(adultFilmographyGroup(label, values)))
}

function openAdultFilmography(person, context = '', returnTo = null) {
  adultFilmographyPerson = person
  adultFilmographyContext = context
  adultFilmographyReturnTo = returnTo
  adultFilmographySearch = ''
  $('#adultFilmographySearch').value = ''
  $('#adultFilmographySearchClear').classList.add('hidden')
  portalSheets.suspend($('#adultPersonSheet'))
  history.pushState({ ...(history.state || {}), adultFilmography: true }, '', '#adult-filmography')
  adultFilmographyOpen = true
  openView('adult-filmography', { resetScroll: true })
  renderAdultFilmography()
}

function restoreAdultPersonAfterFilmography() {
  if (!adultFilmographyPerson) return
  restoreAdultPersonSheet(adultFilmographyPerson, adultFilmographyContext, adultFilmographyReturnTo)
}

$('#adultFilmographyBack')?.addEventListener('click', () => {
  if (history.state?.adultFilmography) history.back()
  else restoreAdultPersonAfterFilmography()
})
$('#adultFilmographySearch')?.addEventListener('input', event => {
  adultFilmographySearch = event.currentTarget.value
  $('#adultFilmographySearchClear').classList.toggle('hidden', !adultFilmographySearch)
  renderAdultFilmography()
})
$('#adultFilmographySearchClear')?.addEventListener('click', () => {
  adultFilmographySearch = ''
  $('#adultFilmographySearch').value = ''
  $('#adultFilmographySearchClear').classList.add('hidden')
  renderAdultFilmography()
  $('#adultFilmographySearch').focus()
})
$('#adultFilmographyMode')?.addEventListener('change', event => {
  adultFilmographyMode = event.currentTarget.value
  renderAdultFilmography()
  resetViewScroll()
})
window.addEventListener('popstate', event => {
  if (!adultFilmographyOpen || event.state?.adultFilmography) return
  adultFilmographyOpen = false
  restoreAdultPersonAfterFilmography()
})
