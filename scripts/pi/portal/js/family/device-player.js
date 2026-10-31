'use strict'

let familyDeviceStory = null
let familyDeviceLastSaved = 0
let familyDeviceGeneration = 0
let familyListeningStarted = false

function familyStoryResumePosition(story) {
  return Date.now() / 1000 - Number(story.updated || 0) < 3600 ? Number(story.position_seconds || 0) : 0
}

function resetFamilyDevicePlayer() {
  familyDeviceGeneration++
  stopFamilyMemoriesDevice()
  stopFamilyStoryBrowser()
  familyListeningStarted = false
  stopFamilyBook()
  for (const id of ['familyDeviceAudio', 'familyDeviceVideo']) {
    const media = $(`#${id}`)
    media.onpause = media.onended = media.ontimeupdate = media.onplaying = media.onloadedmetadata = media.onerror = null
    media.pause(); media.removeAttribute('src'); media.load(); media.muted = false; media.loop = false; media.volume = 1
    media.classList.add('hidden')
  }
  for (const id of ['familyDevicePhoto', 'familyDeviceBook', 'familyDeviceSkip', 'familyDeviceStart', 'familyDeviceMessage', 'familyStoryStage', 'familyStoryFullscreen', 'familyStoryRestart'])
    $(`#${id}`).classList.add('hidden')
  $('#familyDevicePlayer').classList.remove('is-storytime')
  $('#familyDeviceClose span').textContent = 'Back'
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null
    for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack']) navigator.mediaSession.setActionHandler(action, null)
  }
}

async function playFamilyStoryOnDevice(story) {
  resetFamilyDevicePlayer()
  const generation = familyDeviceGeneration
  familyDeviceStory = story; familyDeviceLastSaved = 0
  renderFamilyStoryCatalogue(story, true)
  familyStoryBrowser.phase = 'reading'
  $('#familyStoryCatalogue').classList.add('hidden')
  $('#familyDevicePlayer').classList.remove('is-story-library')
  $('#familyDeviceClose span').textContent = 'Back'
  $('#familyDeviceTitle').textContent = story.title
  $('#familyDevicePlayer').classList.add('is-storytime')
  const audio = $('#familyDeviceAudio')
  const current = () => generation === familyDeviceGeneration && $('#familyDevicePlayer').open
  const resume = () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(familyStoryResumePosition(story), Math.max(0, audio.duration - 1))
  }
  audio.src = story.audio.media_url
  audio.onloadedmetadata = () => { if (current() && !familyListeningStarted) resume() }
  audio.ontimeupdate = () => {
    if (!current() || !familyListeningStarted || Date.now() - familyDeviceLastSaved < 10000) return
    familyDeviceLastSaved = Date.now(); saveFamilyListeningPosition().catch(() => {})
  }
  audio.onended = () => { if (current()) { saveFamilyListeningPosition(true).catch(showError); backFromFamilyDevicePlayer() } }
  audio.onpause = () => { if (current()) { showFamilyStoryControls(); saveFamilyListeningPosition().catch(() => {}) } }
  audio.onplaying = () => { if (current() && familyListeningStarted) showFamilyStoryControls() }
  audio.onerror = () => {
    if (!current()) return
    $('#familyDeviceMessage').textContent = 'This audio could not be opened. Go back and choose the audio file again.'
    $('#familyDeviceMessage').classList.remove('hidden')
  }
  portalSheets.close($('#familyStorySheet')); portalSheets.open($('#familyDevicePlayer'))
  updateFamilyStoryFullscreen()
  // Prime this exact media element in the original tap. No story audio plays
  // during the opening. Safari can still require a final tap; show it clearly.
  audio.muted = true
  audio.play().then(() => {
    if (!current() || familyListeningStarted) return
    audio.pause(); resume(); audio.muted = false
  }).catch(() => { if (current()) audio.muted = false })
  const start = async () => {
    if (!current()) return
    $('#familyDeviceStart').classList.add('hidden'); $('#familyDeviceMessage').classList.add('hidden')
    audio.classList.remove('hidden'); audio.muted = false; resume(); familyListeningStarted = true
    $('#familyStoryRestart').classList.remove('hidden')
    try {
      await audio.play()
      if (!current()) return
      showFamilyStoryControls()
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: story.title,
          artist: `${tvName()} Storytime`, artwork: [{ src: new URL(story.image.artwork_url, location.href).href }] })
        navigator.mediaSession.setActionHandler('play', () => audio.play())
        navigator.mediaSession.setActionHandler('pause', () => audio.pause())
        navigator.mediaSession.setActionHandler('seekbackward', details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 15)) })
        navigator.mediaSession.setActionHandler('seekforward', details => { audio.currentTime = Math.min(audio.duration, audio.currentTime + (details.seekOffset || 15)) })
      }
    } catch (error) {
      if (!current()) return
      familyListeningStarted = false
      $('#familyDeviceStart').classList.remove('hidden')
      $('#familyDeviceMessage').textContent = 'Your story is ready. Tap Start story to listen.'
      $('#familyDeviceMessage').classList.remove('hidden')
    }
  }
  $('#familyDeviceStart').onclick = start
  openFamilyBook(story, start)
}

async function saveFamilyListeningPosition(finished = false) {
  const story = familyDeviceStory
  if (!story || !familyListeningStarted) return
  const audio = $('#familyDeviceAudio')
  const position = finished || audio.ended ? 0 : audio.currentTime
  if (!Number.isFinite(position)) return
  await api('/api/family-media', { method: 'POST', body: JSON.stringify({ action: 'story-progress', id: story.id, position }) })
  if (position !== Number(story.position_seconds || 0)) story.updated = Date.now() / 1000
  story.position_seconds = position
}

function viewFamilyMemoryOnDevice(item) {
  resetFamilyDevicePlayer(); familyDeviceStory = null
  $('#familyDeviceTitle').textContent = item.title
  if (item.kind === 'video') {
    $('#familyDeviceVideo').src = item.media_url; $('#familyDeviceVideo').classList.remove('hidden')
  } else {
    $('#familyDevicePhoto').src = item.media_url; $('#familyDevicePhoto').classList.remove('hidden')
  }
  portalSheets.close($('#familyMemorySheet')); portalSheets.open($('#familyDevicePlayer'))
}

function openFamilyStorytimeOnDevice() {
  resetFamilyDevicePlayer(); familyDeviceStory = null
  renderFamilyStoryCatalogue()
  const browser = familyStoryBrowser
  portalSheets.open($('#familyDevicePlayer')); updateFamilyStoryFullscreen()
  $('#familyStoryBooks .is-selected')?.focus({ preventScroll: true })
  loadFamilyLibrary().then(() => {
    if (familyStoryBrowser !== browser || browser.phase !== 'catalogue'
      || JSON.stringify(browser.stories) === JSON.stringify(familyLibrary.stories)) return
    const selected = browser.stories[browser.selected]?.id
    browser.selected = Math.max(0, familyLibrary.stories.findIndex(story => story.id === selected))
    renderFamilyStoryCatalogue()
  }).catch(() => {})
}

function backFromFamilyDevicePlayer() {
  const browser = familyStoryBrowser
  if (!browser || browser.phase === 'catalogue') { portalSheets.close($('#familyDevicePlayer')); return }
  if (browser.finishReturn) { browser.finishReturn(); return }
  const story = familyDeviceStory
  if (!story) return
  saveFamilyListeningPosition().catch(showError)
  familyDeviceGeneration++; familyListeningStarted = false; familyDeviceStory = null
  clearTimeout(browser.controlsTimer); clearTimeout(browser.previewTimer); browser.sound.pause()
  const audio = $('#familyDeviceAudio')
  audio.onpause = audio.onended = audio.onplaying = audio.ontimeupdate = audio.onloadedmetadata = audio.onerror = null
  audio.pause(); audio.classList.add('hidden')
  for (const id of ['familyDeviceSkip', 'familyDeviceStart', 'familyDeviceMessage', 'familyStoryRestart']) $('#' + id).classList.add('hidden')
  $('#familyDevicePlayer').classList.remove('story-controls-hidden')
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null
    for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack']) navigator.mediaSession.setActionHandler(action, null)
  }
  closeFamilyStoryBookIntoCatalogue(story)
}

function showFamilyStoryControls() {
  const browser = familyStoryBrowser, dialog = $('#familyDevicePlayer')
  if (!browser) return
  clearTimeout(browser.controlsTimer); dialog.classList.remove('story-controls-hidden')
  if (browser.phase !== 'reading' || !familyListeningStarted || $('#familyDeviceAudio').paused) return
  browser.controlsTimer = setTimeout(() => {
    if (familyStoryBrowser === browser && browser.phase === 'reading' && !$('#familyDeviceAudio').paused)
      dialog.classList.add('story-controls-hidden')
  }, 3000)
}

function updateFamilyStoryFullscreen() {
  const dialog = $('#familyDevicePlayer'), button = $('#familyStoryFullscreen')
  const supported = Boolean(dialog.requestFullscreen || dialog.webkitRequestFullscreen)
  button.classList.toggle('hidden', !supported || !dialog.classList.contains('is-storytime'))
  button.setAttribute('aria-label', document.fullscreenElement || document.webkitFullscreenElement ? 'Exit full screen' : 'Full screen')
}

$('#familyStoryFullscreen').onclick = () => {
  const dialog = $('#familyDevicePlayer')
  const owner = document.fullscreenElement || document.webkitFullscreenElement
  const request = owner ? document.exitFullscreen || document.webkitExitFullscreen : dialog.requestFullscreen || dialog.webkitRequestFullscreen
  try { Promise.resolve(request?.call(owner ? document : dialog)).catch(() => notice('Use landscape or your installed app for the largest Storytime view.')) }
  catch { notice('Use landscape or your installed app for the largest Storytime view.') }
}

$('#familyStoryRestart').onclick = () => {
  if (!familyDeviceStory || !familyListeningStarted) return
  const audio = $('#familyDeviceAudio')
  audio.currentTime = 0
  saveFamilyListeningPosition().catch(showError)
  audio.play().catch(showError)
  showFamilyStoryControls()
}
document.addEventListener('fullscreenchange', updateFamilyStoryFullscreen)
document.addEventListener('webkitfullscreenchange', updateFamilyStoryFullscreen)
$('#familyStoryStage').onclick = () => { if (familyStoryBrowser?.phase === 'reading') showFamilyStoryControls() }
$('#familyDeviceClose').onclick = backFromFamilyDevicePlayer
$('#familyDevicePlayer').addEventListener('cancel', event => {
  if (!familyStoryBrowser) return
  event.preventDefault(); event.stopImmediatePropagation(); backFromFamilyDevicePlayer()
}, true)
$('#familyDevicePlayer').addEventListener('keydown', event => {
  const browser = familyStoryBrowser
  if (!browser) return
  const library = browser.phase !== 'reading'
  const columns = matchMedia('(min-width: 768px), (orientation: landscape)').matches ? 4 : 2
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key]
  if (library && step) { event.preventDefault(); moveFamilyStoryBook(step) }
  else if (library && event.key === 'Enter' && !event.target.closest('header, footer')) {
    event.preventDefault()
    const story = browser.stories[browser.selected]
    if (story?.ready) playFamilyStoryOnDevice(story).catch(showError)
  } else if (event.key === 'Escape' || event.key === 'Backspace') {
    event.preventDefault(); backFromFamilyDevicePlayer()
  } else if (!library && event.code === 'Space' && familyListeningStarted) {
    event.preventDefault()
    const audio = $('#familyDeviceAudio')
    if (audio.paused) audio.play().catch(showError)
    else audio.pause()
  }
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { familyStoryBrowser?.sound.pause(); saveFamilyListeningPosition().catch(() => {}) }
})
window.addEventListener('resize', () => {
  if (familyStoryBrowser?.phase === 'catalogue' && familyStoryBrowser.size !== familyStoryPageSize()) renderFamilyStoryCatalogue()
  else familyStoryBrowser?.finishReturn?.()
})
$('#familyDevicePlayer').addEventListener('close', () => {
  saveFamilyListeningPosition().catch(() => {})
  familyDeviceStory = null; resetFamilyDevicePlayer(); loadFamilyLibrary().catch(() => {})
  if (document.fullscreenElement === $('#familyDevicePlayer')) document.exitFullscreen().catch(() => {})
})
