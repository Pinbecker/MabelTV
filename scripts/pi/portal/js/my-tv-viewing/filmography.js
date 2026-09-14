'use strict'

let myTvFilmographyPerson = null
let myTvFilmographyContext = ''
let myTvFilmographyReturnTo = null
let myTvFilmographySearch = ''
let myTvFilmographyMode = 'timeline'
let myTvFilmographyOpen = false
let myTvFilmographySourceView = 'my-tv-viewing'
let myTvFilmographySourcePosition = null

function myTvFilmographySortTitle(title) {
  return String(title || '').replace(/^(?:the|an?)\s+/i, '').trim()
}

function myTvFilmographyYear(title) {
  const year = String(title.year || title.release_date || title.first_air_date || '').slice(0, 4)
  return /^\d{4}$/.test(year) ? year : 'Date unknown'
}

function renderMyTvFilmographyPerson(person) {
  $('#myTvFilmographyName').textContent = person?.name || 'Filmography'
  const photo = $('#myTvFilmographyPhoto')
  photo.replaceChildren()
  if (person?.profile_path) {
    const image = document.createElement('img')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.src = myTvPosterUrl(person.profile_path, 'w342')
    image.alt = `Portrait of ${person.name}`
    photo.append(image)
  } else {
    const initials = document.createElement('b')
    initials.textContent = myTvPersonInitials(person?.name)
    photo.append(initials)
  }
  const titles = person?.filmography || []
  const years = titles.map(myTvFilmographyYear).filter(year => year !== 'Date unknown')
  const first = years.length ? Math.min(...years.map(Number)) : 0
  const facts = [
    ['Screen credits', first ? `From ${first}` : 'Date unknown'],
    ['Titles', titles.length],
    ['Films', titles.filter(title => title.media_type === 'movie').length],
    ['Series', titles.filter(title => title.media_type === 'tv').length],
  ]
  const meta = $('#myTvFilmographyMeta')
  meta.replaceChildren()
  facts.forEach(([label, value]) => {
    const fact = document.createElement('div')
    const term = document.createElement('dt')
    term.textContent = label
    const description = document.createElement('dd')
    description.textContent = String(value)
    fact.append(term, description)
    meta.append(fact)
  })
}

function myTvFilmographyGroup(label, titles) {
  const section = document.createElement('section')
  section.className = 'my-tv-filmography-year'
  const header = document.createElement('header')
  const heading = document.createElement('h2')
  heading.textContent = label
  const count = document.createElement('span')
  count.textContent = `${titles.length} title${titles.length === 1 ? '' : 's'}`
  header.append(heading, count)
  const grid = document.createElement('div')
  grid.className = 'my-tv-explore-grid my-tv-filmography-grid'
  titles.forEach(title => grid.append(myTvExploreCard(title, {
    directActions: true, context: 'filmography',
  })))
  section.append(header, grid)
  return section
}

function renderMyTvFilmography() {
  const root = $('#myTvFilmographyTimeline')
  if (!root) return
  renderMyTvFilmographyPerson(myTvFilmographyPerson)
  const query = myTvFilmographySearch.trim().toLocaleLowerCase()
  const titles = (myTvFilmographyPerson?.filmography || []).filter(title => !query || [
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
  if (myTvFilmographyMode === 'az') {
    titles.sort((left, right) => myTvFilmographySortTitle(left.title).localeCompare(
      myTvFilmographySortTitle(right.title), undefined, { sensitivity: 'base' }))
    titles.forEach(title => {
      const initial = myTvFilmographySortTitle(title.title).slice(0, 1).toLocaleUpperCase()
      const label = /[A-Z]/.test(initial) ? initial : '#'
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(title)
    })
  } else {
    titles.sort((left, right) => {
      const leftYear = myTvFilmographyYear(left)
      const rightYear = myTvFilmographyYear(right)
      if (leftYear === 'Date unknown') return rightYear === 'Date unknown' ? 0 : 1
      if (rightYear === 'Date unknown') return -1
      return Number(rightYear) - Number(leftYear)
        || myTvFilmographySortTitle(left.title).localeCompare(myTvFilmographySortTitle(right.title))
    })
    titles.forEach(title => {
      const label = myTvFilmographyYear(title)
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(title)
    })
  }
  groups.forEach((values, label) => root.append(myTvFilmographyGroup(label, values)))
}

function openMyTvFilmography(person, context = '', returnTo = null) {
  myTvFilmographyPerson = person
  myTvFilmographyContext = context
  myTvFilmographyReturnTo = returnTo
  const sourceView = document.querySelector('.view.active')
  myTvFilmographySourceView = sourceView?.id.replace(/^view-/, '') || 'my-tv-viewing'
  myTvFilmographySourcePosition = capturePortalPosition()
  myTvFilmographySearch = ''
  $('#myTvFilmographySearch').value = ''
  $('#myTvFilmographySearchClear').classList.add('hidden')
  portalSheets.suspend($('#myTvPersonSheet'))
  history.pushState({ ...(history.state || {}), myTvFilmography: true }, '', location.href)
  myTvFilmographyOpen = true
  openView('my-tv-filmography', { resetScroll: true })
  renderMyTvFilmography()
}

function restoreMyTvPersonAfterFilmography() {
  if (!myTvFilmographyPerson) return
  openView(myTvFilmographySourceView)
  restorePortalPosition(myTvFilmographySourcePosition)
  restoreMyTvPersonSheet(myTvFilmographyPerson, myTvFilmographyContext, myTvFilmographyReturnTo)
}

$('#myTvFilmographyBack')?.addEventListener('click', () => {
  if (history.state?.myTvFilmography) history.back()
  else restoreMyTvPersonAfterFilmography()
})
$('#myTvFilmographySearch')?.addEventListener('input', event => {
  myTvFilmographySearch = event.currentTarget.value
  $('#myTvFilmographySearchClear').classList.toggle('hidden', !myTvFilmographySearch)
  renderMyTvFilmography()
})
$('#myTvFilmographySearchClear')?.addEventListener('click', () => {
  myTvFilmographySearch = ''
  $('#myTvFilmographySearch').value = ''
  $('#myTvFilmographySearchClear').classList.add('hidden')
  renderMyTvFilmography()
  $('#myTvFilmographySearch').focus()
})
$('#myTvFilmographyMode')?.addEventListener('change', event => {
  myTvFilmographyMode = event.currentTarget.value
  renderMyTvFilmography()
  resetViewScroll()
})
window.addEventListener('popstate', event => {
  if (!myTvFilmographyOpen || event.state?.myTvFilmography) return
  event.stopImmediatePropagation()
  myTvFilmographyOpen = false
  restoreMyTvPersonAfterFilmography()
}, true)
