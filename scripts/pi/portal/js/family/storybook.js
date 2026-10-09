'use strict'

let familyBookCleanup = null
const familyStoryCoverFiles = ['cover-v2.png', 'cover-sapphire.png', 'cover-ruby.png', 'cover-amethyst.png',
  'cover-teal.png', 'cover-amber.png', 'cover-rose.png', 'cover-brown.png']

function familyBookCover(book, index) {
  book.style.setProperty('--story-cover-image', `url('/portal/assets/storytime/${familyStoryCoverFiles[Math.max(0, index) % 8]}')`)
}

function stopFamilyBook() {
  familyBookCleanup?.()
  familyBookCleanup = null
  const book = $('#familyDeviceBook')
  book.getAnimations({ subtree: true }).forEach(animation => animation.cancel())
  book.classList.remove('opening', 'opened', 'closing', 'docking')
  $('#familyBookName').style.fontSize = ''
}

function openFamilyBook(story, finished) {
  stopFamilyBook()
  const book = $('#familyDeviceBook')
  familyBookCover(book, familyLibrary.stories.findIndex(value => value.id === story.id))
  const name = tvName().replace(/\s*TV$/i, '').trim()
  $('#familyBookName').textContent = story.title
  $('#familyBookByline').textContent = `${name}’s Storytime`
  $('#familyBookLeafTitle').textContent = $('#familyBookStoryTitle').textContent = story.title
  $('#familyDeviceIllustration').src = story.image.media_url
  // The print belongs to the back of the leaf, not the inside of the cover.
  // This same printed leaf stays visible after landing; there is no layer swap.
  const print = book.querySelector('.story-volume > .story-spread').cloneNode(true)
  for (const element of print.querySelectorAll('[id]')) element.removeAttribute('id')
  for (const image of print.querySelectorAll('img')) image.loading = 'eager'
  book.querySelector('.story-leaf-illustration').replaceChildren(print)
  const dust = book.querySelector('.story-dust')
  dust.replaceChildren(...Array.from({ length: 14 }, (_, index) => {
    const particle = document.createElement('i')
    particle.style.setProperty('--dust-x', `${12 + (index * 37 % 80)}%`)
    particle.style.setProperty('--dust-delay', `${index * 95}ms`)
    return particle
  }))
  book.classList.remove('hidden')
  const volume = book.querySelector('.story-volume')
  let done = false
  let fallback = 0
  function finish(event) {
    if (event && (event.target !== volume || event.animationName !== 'storybook-volume')) return
    if (done) return
    done = true
    familyBookCleanup?.(); familyBookCleanup = null
    book.classList.remove('opening'); book.classList.add('opened')
    $('#familyDeviceSkip').classList.add('hidden')
    finished()
  }
  familyBookCleanup = () => {
    clearTimeout(fallback)
    volume.removeEventListener('animationend', finish)
    $('#familyDeviceSkip').onclick = null
  }
  volume.addEventListener('animationend', finish)
  $('#familyDeviceSkip').classList.remove('hidden')
  $('#familyDeviceSkip').onclick = () => finish()
  // Layout before adding the class makes repeated stories restart cleanly.
  void book.offsetWidth
  book.classList.add('opening')
  fallback = setTimeout(() => finish(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 9100)
}

let familyStoryBrowser = null

function stopFamilyStoryBrowser() {
  const browser = familyStoryBrowser
  familyStoryBrowser = null
  if (browser) {
    clearTimeout(browser.previewTimer); clearTimeout(browser.controlsTimer)
    browser.sound.pause(); browser.sound.removeAttribute('src'); browser.sound.load()
    browser.transition?.cancel()
  }
  $('#familyStoryBooks').replaceChildren()
  $('#familyStoryCatalogue').classList.add('hidden')
  $('#familyDevicePlayer').classList.remove('is-story-library', 'story-controls-hidden')
}

function familyStoryPreview(story, index) {
  const book = $('#familyDeviceBook').cloneNode(true)
  book.removeAttribute('id'); book.removeAttribute('aria-label')
  for (const node of book.querySelectorAll('[id]')) node.removeAttribute('id')
  book.className = 'story-book story-preview'
  familyBookCover(book, index)
  book.querySelector('.story-dust').remove()
  book.querySelector('.story-cover-front strong').textContent = story.title
  book.querySelector('.story-byline').textContent = `${tvName().replace(/\s*TV$/i, '').trim()}’s Storytime`
  book.querySelector('.story-spread h3').textContent = story.title
  book.querySelector('.story-leaf-front strong').textContent = story.title
  const image = book.querySelector('.story-spread img')
  image.removeAttribute('src')
  if (story.image?.artwork_url) image.src = story.image.artwork_url
  image.alt = ''; image.loading = 'lazy'
  const print = book.querySelector('.story-volume > .story-spread').cloneNode(true)
  for (const image of print.querySelectorAll('img')) image.loading = 'eager'
  book.querySelector('.story-leaf-illustration').replaceChildren(print)
  return book
}

function familyStoryPageSize() {
  return matchMedia('(min-width: 768px) and (min-height: 500px), (orientation: landscape) and (min-height: 500px)').matches ? 8 : 4
}

function renderFamilyStoryCatalogue(story = null, docking = false) {
  const dialog = $('#familyDevicePlayer')
  if (!familyStoryBrowser) familyStoryBrowser = {
    stories: [], selected: 0, page: 0, phase: 'catalogue',
    sound: new Audio('/portal/assets/storytime/page-turn.ogg'), previewTimer: 0,
  }
  const browser = familyStoryBrowser
  browser.sound.volume = .22
  const selectedId = story?.id || browser.stories[browser.selected]?.id
  browser.stories = familyLibrary.stories.slice()
  if (story && !browser.stories.some(item => item.id === story.id)) browser.stories = familyOrderedStories([...browser.stories, story])
  if (selectedId) browser.selected = Math.max(0, browser.stories.findIndex(item => item.id === selectedId))
  browser.selected = Math.min(browser.selected, Math.max(0, browser.stories.length - 1))
  browser.size = familyStoryPageSize(); browser.page = Math.floor(browser.selected / browser.size)
  browser.phase = docking ? 'returning' : 'catalogue'
  dialog.classList.add('is-storytime', 'is-story-library'); dialog.classList.remove('story-controls-hidden')
  $('#familyDeviceTitle').textContent = `${tvName().replace(/\s*TV$/i, '').trim()}’s Storytime`
  $('#familyDeviceClose span').textContent = docking ? 'Back' : 'Close'
  $('#familyStoryStage').classList.remove('hidden'); $('#familyStoryCatalogue').classList.remove('hidden')
  const grid = $('#familyStoryBooks'), restoreFocus = grid.contains(document.activeElement)
  grid.replaceChildren()
  for (const [offset, item] of browser.stories.slice(browser.page * browser.size, (browser.page + 1) * browser.size).entries()) {
    const index = browser.page * browser.size + offset
    let selectedBeforeTap = false
    const card = familyButton('', () => {
      if (!item.ready) return
      if (selectedBeforeTap && card.querySelector('.story-preview.opened')) {
        playFamilyStoryOnDevice(item).catch(showError)
      } else {
        selectFamilyStoryBook(index)
        selectedBeforeTap = true
      }
    }, 'family-story-book-card')
    card.onpointerdown = () => { selectedBeforeTap = browser.selected === index }
    card.dataset.storyId = item.id
    card.setAttribute('aria-label', `${item.title}${item.ready ? ', listen to story' : ', not ready yet'}`)
    card.setAttribute('aria-disabled', String(!item.ready))
    card.tabIndex = index === browser.selected ? 0 : -1
    const art = document.createElement('span'); art.className = 'family-story-book-art'
    art.append(familyStoryPreview(item, index))
    const title = document.createElement('strong'); title.textContent = item.title
    const detail = document.createElement('small')
    detail.textContent = item.ready ? item.position_seconds > 10 ? 'Continue your story' : 'A little adventure awaits' : 'Add audio and an illustration'
    card.append(art, title, detail); card.onfocus = () => selectFamilyStoryBook(index)
    grid.append(card)
  }
  if (!browser.stories.length) {
    const empty = document.createElement('p'); empty.className = 'family-story-catalogue-empty'
    empty.textContent = 'Your little adventures will appear here. Add a story in the Stories tab.'
    grid.append(empty)
  }
  const pages = Math.max(1, Math.ceil(browser.stories.length / browser.size))
  $('#familyStoryPage').textContent = browser.stories.length ? `${browser.page + 1} of ${pages}` : 'Your storybook collection'
  $('#familyStoryPrevious').disabled = browser.page === 0
  $('#familyStoryNext').disabled = browser.page + 1 >= pages
  selectFamilyStoryBook(browser.selected, docking)
  if (restoreFocus && !docking) $('#familyStoryBooks .is-selected')?.focus({ preventScroll: true })
}

function selectFamilyStoryBook(index, hold = false) {
  const browser = familyStoryBrowser
  if (!browser || !browser.stories.length || index < 0 || index >= browser.stories.length) return
  if (!hold && browser.selected === index && $('#familyStoryBooks .is-selected .story-preview')?.matches('.opening, .opened')) return
  clearTimeout(browser.previewTimer); browser.sound.pause()
  browser.selected = index
  for (const [offset, card] of [...$('#familyStoryBooks').children].entries()) {
    const selected = browser.page * browser.size + offset === index
    card.classList.toggle('is-selected', selected); card.tabIndex = selected ? 0 : -1
    const book = card.querySelector('.story-preview')
    if (!book) continue
    book.getAnimations({ subtree: true }).forEach(animation => animation.cancel())
    book.classList.remove('opening', 'opened')
  }
  if (hold || !browser.stories[index].ready) return
  browser.previewTimer = setTimeout(() => {
    if (familyStoryBrowser !== browser || browser.phase !== 'catalogue' || browser.selected !== index) return
    const book = $('#familyStoryBooks .is-selected .story-preview')
    if (!book) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) book.classList.add('opened')
    else {
      book.classList.add('opening'); void book.offsetWidth
      for (const animation of book.getAnimations({ subtree: true })) {
        animation.playbackRate = 7.5
        if (animation.animationName === 'storybook-volume') animation.finished.then(() => {
          if (familyStoryBrowser === browser && browser.phase === 'catalogue' && browser.selected === index && book.isConnected) {
            book.classList.remove('opening'); book.classList.add('opened')
          }
        }).catch(() => {})
      }
    }
    browser.sound.currentTime = 0; browser.sound.play().catch(() => {})
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220)
}

function moveFamilyStoryBook(step, page = false) {
  const browser = familyStoryBrowser
  if (!browser) return
  browser.finishReturn?.()
  const target = Math.max(0, Math.min(browser.stories.length - 1, browser.selected + step * (page ? browser.size : 1)))
  if (Math.floor(target / browser.size) !== browser.page) {
    browser.selected = target; renderFamilyStoryCatalogue()
  } else selectFamilyStoryBook(target)
  $('#familyStoryBooks .is-selected')?.focus({ preventScroll: true })
}

function closeFamilyStoryBookIntoCatalogue(story) {
  const book = $('#familyDeviceBook')
  const time = book.classList.contains('opened') ? 8600
    : Number(book.getAnimations({ subtree: true }).find(animation => animation.animationName === 'storybook-volume')?.currentTime || 0)
  stopFamilyBook()
  $('#familyBookName').textContent = story.title
  book.classList.add('opening', 'closing'); void book.offsetWidth
  const browser = familyStoryBrowser
  browser.phase = 'closing'
  let cancelled = false
  const finish = () => {
    if (cancelled || familyStoryBrowser !== browser) return
    cancelled = true; familyBookCleanup = null; browser.finishReturn = null
    browser.transition?.cancel(); stopFamilyBook(); book.classList.add('hidden')
    renderFamilyStoryCatalogue(story)
    $('#familyStoryBooks .is-selected')?.focus({ preventScroll: true })
  }
  browser.finishReturn = finish
  familyBookCleanup = () => { cancelled = true; browser.finishReturn = null; browser.transition?.cancel() }
  const dock = () => {
    if (cancelled || familyStoryBrowser !== browser) return
    book.classList.remove('opening'); book.classList.add('docking')
    const source = book.querySelector('.story-cover-front').getBoundingClientRect()
    renderFamilyStoryCatalogue(story, true)
    const card = $('#familyStoryBooks .is-selected')
    if (!card) { finish(); return }
    card.classList.add('is-docking')
    const anchor = book.querySelector('.story-cover-front').getBoundingClientRect()
    const target = card.querySelector('.story-cover-front').getBoundingClientRect()
    const scale = target.height / Math.max(1, anchor.height)
    const x = target.x + target.width / 2 - anchor.x - anchor.width / 2
    const y = target.y + target.height / 2 - anchor.y - anchor.height / 2
    const fromX = source.x + source.width / 2 - anchor.x - anchor.width / 2
    const fromY = source.y + source.height / 2 - anchor.y - anchor.height / 2
    browser.transition = book.animate([
      { transform: `translate(calc(-50% + ${fromX}px), calc(-50% + ${fromY}px)) scale(${source.height / Math.max(1, anchor.height)})`, opacity: 1 },
      { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`, opacity: 1 },
    ], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 780, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'forwards' })
    const font = getComputedStyle(card.querySelector('.story-cover-front strong')).fontSize
    $('#familyBookName').animate([{ fontSize: getComputedStyle($('#familyBookName')).fontSize },
      { fontSize: `${parseFloat(font) / scale}px` }], { duration: 780, fill: 'forwards' })
    browser.transition.finished.then(finish).catch(() => {})
  }
  const animations = book.getAnimations({ subtree: true })
  const volume = animations.find(animation => animation.animationName === 'storybook-volume')
  if (!volume || time < 50 || matchMedia('(prefers-reduced-motion: reduce)').matches) { dock(); return }
  for (const animation of animations) {
    animation.pause(); animation.currentTime = Math.min(time, Number(animation.effect.getTiming().duration))
    animation.playbackRate = -5.9; animation.play()
  }
  volume.finished.then(dock).catch(() => {})
}

$('#familyStoryPrevious').onclick = () => moveFamilyStoryBook(-1, true)
$('#familyStoryNext').onclick = () => moveFamilyStoryBook(1, true)
