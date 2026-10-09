'use strict'

let familyLibrary = { assets: [], stories: [], memory_settings: [] }
let selectedFamilyStory = null
let familyRefreshTimer = null
let familyLibraryRequest = null

async function loadInitialFamilyLibrary() {
  const cached = await readPortalDataCache('family-media-v1', 'family_media')
  if (cached && !cached.stale) {
    familyLibrary = cached.data
    loadFamilyLibrary().catch(showError)
    return
  }
  try { await loadFamilyLibrary() }
  catch (error) {
    if (error.status === 401) throw error
    console.warn('Family library startup refresh failed', error)
  }
}

async function loadFamilyLibrary() {
  if (offlineMode) return
  if (familyLibraryRequest) return familyLibraryRequest
  familyLibraryRequest = (async () => {
    try { familyLibrary = await api('/api/family-media') }
    catch (error) {
      if (!(error instanceof TypeError) && !(error.status >= 500)) throw error
      await new Promise(resolve => setTimeout(resolve, 350))
      familyLibrary = await api('/api/family-media')
    }
    renderStorytimeLibrary(); renderMemoryLibrary()
    await writePortalDataCache('family-media-v1', familyLibrary, 'family_media')
    clearTimeout(familyRefreshTimer)
    if (familyLibrary.assets.some(item => ['uploading', 'processing'].includes(item.status))) {
      familyRefreshTimer = setTimeout(() => {
        if (($('#view-watch').classList.contains('active') && ['storytime', 'episodes'].includes(mabelChannelKind)) || ($('#view-channels').classList.contains('active') && selectedChannelFromLibrary()?.content_type === 'memories')) loadFamilyLibrary().catch(showError)
      }, 3000)
    }
    return familyLibrary
  })().finally(() => { familyLibraryRequest = null })
  return familyLibraryRequest
}

async function changeFamilyLibrary(action, extra = {}) {
  const result = await api('/api/family-media', { method: 'POST', body: JSON.stringify({ action, ...extra }) })
  familyLibrary = result; renderStorytimeLibrary(); renderMemoryLibrary()
  applyPortalBootstrap(await api('/api/bootstrap'))
  await writePortalDataCache('family-media-v1', result, 'family_media')
  return result
}

function familySectionHead(kicker, title) {
  const head = document.createElement('header'); head.className = 'family-section-head'
  const copy = document.createElement('div')
  const label = document.createElement('p'); label.className = 'watch-section-kicker'; label.textContent = kicker
  const heading = document.createElement('h2'); heading.textContent = title
  copy.append(label, heading); head.append(copy); return head
}

function familyOrderedStories(stories) {
  const key = story => story.title.trim().replace(/^(the|a)\s+/i, '').toLowerCase()
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0
  return stories.slice().sort((left, right) => compare(key(left), key(right))
    || compare(left.title.toLowerCase(), right.title.toLowerCase()) || compare(left.id, right.id))
}

function renderStorytimeLibrary() {
  const panel = $('#mabelChannelAudio')
  if (!panel) return
  familyLibrary.stories = familyOrderedStories(familyLibrary.stories)
  panel.replaceChildren()
  const head = familySectionHead('Little stories, big imaginations', 'Storytime')
  head.append(familyButton('Add a story', () => familyPrompt('New story', '', async title => {
    const result = await changeFamilyLibrary('story-create', { title })
    openFamilyStory(result.stories.find(story => story.id === result.id))
  }), 'family-text-button'))
  panel.append(head)
  const open = familyButton('Open Storytime', openFamilyStorytimeChoices, 'family-storytime-open-tv')
  open.prepend(window.MabelPortalUI.icon('signal-play'))
  panel.append(open)
  const grid = document.createElement('div'); grid.className = 'family-story-grid'
  for (const story of familyLibrary.stories) {
    const card = familyButton('', () => openFamilyStory(story), 'family-story-card')
    const art = document.createElement('span'); art.className = 'family-story-art'
    if (story.image?.status === 'ready') {
      const image = document.createElement('img'); image.src = story.image.artwork_url
      image.alt = ''; image.loading = 'lazy'; art.append(image)
    } else art.innerHTML = '<span aria-hidden="true">✦</span>'
    const title = document.createElement('strong'); title.textContent = story.title
    const detail = document.createElement('small')
    detail.textContent = story.ready ? `${story.position_seconds > 10 ? 'Continue · ' : ''}${watchTimeLabel(story.audio.duration)}`
      : story.audio?.status === 'processing' || story.image?.status === 'processing' ? 'Preparing your story…'
        : story.audio?.status === 'error' || story.image?.status === 'error' ? 'A file needs attention' : 'Add audio and an illustration'
    card.append(art, title, detail); grid.append(card)
  }
  panel.append(grid)
  if (!familyLibrary.stories.length) panel.append(familyEmpty('Open a little adventure', 'Give a story a name, add its audio and one illustration. A grand storybook opens on the TV while you listen.'))
}

function openFamilyStorytimeChoices() {
  const sheet = $('#familyStorytimeSheet'), tv = $('#familyStorytimeTv')
  tv.onclick = async () => {
    tv.disabled = true
    try {
      await api('/api/family-media/control', { method: 'POST', body: JSON.stringify({ action: 'open-storytime' }) })
      portalSheets.close(sheet)
      notice('Opening Storytime on TV')
    } catch (error) { showError(error) }
    finally { tv.disabled = false }
  }
  $('#familyStorytimeDevice').onclick = () => {
    portalSheets.close(sheet); openFamilyStorytimeOnDevice()
  }
  portalSheets.open(sheet)
}

function openFamilyStory(story) {
  selectedFamilyStory = story
  $('#familyStoryTitle').textContent = story.title
  $('#familyStoryStatus').textContent = story.ready ? `${watchTimeLabel(story.audio.duration)} · Ready to listen`
    : story.audio?.status === 'error' || story.image?.status === 'error' ? 'A file could not be prepared. Choose those audio files or that illustration again below.' : 'Choose an audio recording or chapter files and a story illustration.'
  $('#familyStoryTv').disabled = $('#familyStoryDevice').disabled = !story.ready
  $('#familyStoryTv').onclick = () => startFamilyMedia({ kind: 'storytime', id: story.id }).catch(showError)
  $('#familyStoryDevice').onclick = () => playFamilyStoryOnDevice(story).catch(showError)
  $('#familyStoryRename').onclick = () => {
    portalSheets.close($('#familyStorySheet'))
    familyPrompt('Rename story', story.title, title => changeFamilyLibrary('story-rename', { id: story.id, title }))
  }
  $('#familyStoryDelete').onclick = () => {
    portalSheets.close($('#familyStorySheet'))
    familyConfirm('Remove this story?', 'The original uploaded files are retained on the Pi.', 'Remove story',
      () => changeFamilyLibrary('story-delete', { id: story.id }))
  }
  for (const [selector, kind] of [['#familyStoryAudio', 'audio'], ['#familyStoryImage', 'illustration']]) {
    const input = $(selector); input.value = ''
    input.onchange = async () => {
      if (!input.files.length) return
      portalSheets.close($('#familyStorySheet'))
      await uploadFamilyFiles([...input.files], { media_kind: kind, story_id: story.id, title: story.title }).catch(showError)
    }
  }
  portalSheets.open($('#familyStorySheet'))
}

async function startFamilyMedia(payload) {
  const result = await api('/api/family-media/start', { method: 'POST', body: JSON.stringify(payload) })
  for (const id of ['familyStorySheet', 'familyMemorySheet', 'familyMemoryPlaybackSheet']) if ($(`#${id}`).open) portalSheets.close($(`#${id}`))
  notice(payload.kind === 'storytime' ? 'Opening your storybook on TV' : 'Playing family memories on TV')
  return result
}

function memoryChannels() { return (library?.channels || []).filter(channel => channel.content_type === 'memories') }

function renderMemoryLibrary() {
  const panel = $('#mabelMemoryChannels')
  if (panel) {
    const renderKey = JSON.stringify([memoryChannels(), familyLibrary.assets])
    if (panel.dataset.familyRenderKey !== renderKey) {
    panel.dataset.familyRenderKey = renderKey
    panel.replaceChildren()
    const channels = memoryChannels()
    if (channels.length) {
      panel.append(familySectionHead('Photos and videos, together', 'Family memories'))
      const grid = document.createElement('div'); grid.className = 'family-channel-grid'
      for (const channel of channels) {
        const assets = familyLibrary.assets.filter(item => item.channel_number === channel.number && ['photo', 'video'].includes(item.kind))
        const card = familyButton('', () => openChannel(channel, true), 'watch-card watch-mabel-series-channel-card')
        card.setAttribute('aria-label', `Open channel ${channel.number}, ${channel.name}`)
        const art = document.createElement('span'); art.className = 'watch-card-art'
        const cover = assets.find(item => item.artwork_url)?.artwork_url
          || (channel.metadata?.artwork ? `/api/channel/artwork/${encodeURIComponent(channel.metadata.artwork)}` : '')
        familyArtwork(art, cover)
        const copy = document.createElement('span'); copy.className = 'watch-card-copy watch-mabel-channel-copy'
        const title = document.createElement('strong'); title.textContent = channel.name
        const detail = document.createElement('small'); detail.textContent = `CH ${channel.number} · Photos & videos`
        copy.append(detail, title); card.append(art, copy); grid.append(card)
      }
      panel.append(grid)
    }
    }
  }
  const selected = selectedChannelFromLibrary()
  if ($('#view-channels').classList.contains('active') && selected?.content_type === 'memories')
    preservePortalPosition(() => renderMemoryGallery(selected))
}

function uploadMemoryFiles(channel) {
  const input = $('#familyMemoryUploadInput'); input.value = ''
  input.onchange = () => uploadFamilyFiles([...input.files], { channel: channel.number }).catch(showError)
  input.click()
}

function renderMemoryGallery(channel) {
  const panel = $('#channels')
  const assets = familyLibrary.assets.filter(item => item.channel_number === channel.number && ['photo', 'video'].includes(item.kind))
  const filtered = assets.filter(item => !programmeSearch || item.title.toLowerCase().includes(programmeSearch.toLowerCase()))
  if (!channel.metadata?.artwork) {
    const artwork = assets.find(item => item.status === 'ready' && item.artwork_url)?.artwork_url
    $('#channelPageHero').style.setProperty('--channel-page-art', artwork ? `url("${artwork}")` : 'none')
    $('#channelPageHero').classList.toggle('has-artwork', Boolean(artwork))
  }
  $('#workspaceEyebrow').textContent = `CH ${channel.number} · Photos & videos`
  $('#workspaceProgrammeCount').textContent = assets.length
  $('#workspaceProgrammeLabel').textContent = assets.length === 1 ? 'memory' : 'memories'
  $('#workspaceVisibleCount').textContent = channel.enabled ? assets.filter(item => item.status === 'ready').length : 0
  $('#channelLibraryTitle').textContent = 'Photos & videos'
  $('#channelSummary').textContent = 'Your family, ready to enjoy together.'
  $('#channelResultCount').textContent = `${filtered.length} memories`
  $('#programmeSearch').placeholder = 'Search memories'
  $('#programmePager').replaceChildren()
  $('#programmePager').classList.add('hidden')
  const renderKey = JSON.stringify([channel.number, programmeSearch, assets])
  if (panel.classList.contains('family-memory-library') && panel.dataset.familyRenderKey === renderKey) return
  panel.dataset.familyRenderKey = renderKey
  panel.replaceChildren(); panel.className = 'channel-page-programmes family-memory-library'
  const grid = document.createElement('div'); grid.className = 'family-memory-grid'
  for (const item of filtered) {
    const card = familyButton('', () => openFamilyMemory(channel, item), 'family-memory-card')
    card.classList.toggle('is-error', item.status === 'error')
    familyArtwork(card, item.artwork_url, item.title, item.kind === 'video' ? 'signal-film' : 'signal-image')
    const caption = document.createElement('span'); caption.textContent = item.status === 'ready'
      ? item.kind === 'video' ? watchTimeLabel(item.duration) : 'Photo' : item.status === 'error' ? 'Needs attention' : 'Preparing…'
    card.setAttribute('aria-label', `${item.title}${item.status === 'error' ? ', needs attention' : ''}`)
    card.append(caption); grid.append(card)
  }
  panel.append(grid)
  if (!assets.length) panel.append(familyEmpty('A little window into your family', 'Use the + button above to upload photos and videos from your phone. Originals are kept while playable copies are prepared in the background.'))
}

function openMemoryPlayback(channel) {
  const ready = familyLibrary.assets.some(item => item.channel_number === channel.number && ['photo', 'video'].includes(item.kind) && item.status === 'ready')
  $('#familyMemoryPlaybackTitle').textContent = channel.name
  $('#familyMemoryPlaybackTv').disabled = $('#familyMemoryPlaybackDevice').disabled = !ready
  $('#familyMemoryPlaybackTv').onclick = () => startFamilyMedia({ kind: 'memories', channel: channel.number }).catch(showError)
  $('#familyMemoryPlaybackDevice').onclick = () => playFamilyMemoriesOnDevice(channel)
  $('#familyMemoryPlaybackSettings').onclick = () => {
    portalSheets.close($('#familyMemoryPlaybackSheet')); openMemorySettings(channel)
  }
  portalSheets.open($('#familyMemoryPlaybackSheet'))
}

function openFamilyMemory(channel, item) {
  $('#familyMemoryTitle').textContent = item.title
  const ready = item.status === 'ready'
  $('#familyMemoryPlay').disabled = $('#familyMemoryDevice').disabled = $('#familyMemorySequenceDevice').disabled = !ready
  const status = $('#familyMemoryStatus')
  status.classList.toggle('hidden', ready)
  status.textContent = item.status === 'error' ? item.can_retry
    ? 'This file could not be prepared. Your original is safe on the Pi. Retry preparation, or remove it from this channel.'
    : 'This file is unavailable. Remove it from this channel and upload the original again.'
    : 'This file is being prepared. Removing it also stops its preparation.'
  $('#familyMemoryRemove').disabled = false
  $('#familyMemoryRetry').classList.toggle('hidden', !item.can_retry)
  $('#familyMemoryRetry').onclick = async () => {
    const button = $('#familyMemoryRetry'); button.disabled = true
    try {
      await changeFamilyLibrary('retry', { id: item.id }); portalSheets.close($('#familyMemorySheet'))
      notice('Preparing your original file again'); await loadFamilyLibrary()
    } catch (error) { showError(error) }
    finally { button.disabled = false }
  }
  $('#familyMemoryPlay').onclick = () => startFamilyMedia({ kind: 'memories', channel: channel.number, id: item.id }).catch(showError)
  $('#familyMemorySequenceDevice').onclick = () => playFamilyMemoriesOnDevice(channel, item)
  $('#familyMemoryDevice').onclick = () => viewFamilyMemoryOnDevice(item)
  $('#familyMemoryRemove').onclick = () => {
    portalSheets.close($('#familyMemorySheet'))
    familyConfirm('Remove this memory?', 'It will leave this channel. The original uploaded file is kept on the Pi.', 'Remove',
      () => changeFamilyLibrary('remove', { id: item.id }))
  }
  portalSheets.open($('#familyMemorySheet'))
}

function openMemorySettings(channel) {
  const saved = familyLibrary.memory_settings.find(item => item.channel_number === channel.number) || {}
  $('#memoryOrder').value = saved.ordering || 'shuffle'
  $('#memorySeconds').value = saved.photo_seconds || 10
  $('#memorySecondsValue').textContent = `${$('#memorySeconds').value} seconds`
  $('#memorySeconds').oninput = () => { $('#memorySecondsValue').textContent = `${$('#memorySeconds').value} seconds` }
  $('#memoryMusicVolume').value = saved.music_volume ?? 25
  const music = $('#memoryMusic'); music.replaceChildren(new Option('No background music', ''))
  familyLibrary.assets.filter(item => item.kind === 'music' && item.status === 'ready')
    .forEach(item => music.add(new Option(item.title, item.id)))
  music.value = saved.music_id || ''
  const upload = $('#memoryMusicUpload'); upload.value = ''
  upload.onchange = () => {
    if (!upload.files.length) return
    portalSheets.close($('#familyMemorySettings'))
    uploadFamilyFiles([...upload.files], { media_kind: 'music' }).catch(showError)
  }
  $('#memorySettingsSave').onclick = async () => {
    try {
      await changeFamilyLibrary('memory-settings', { channel: channel.number, ordering: $('#memoryOrder').value,
        photo_seconds: Number($('#memorySeconds').value), music_id: music.value, music_volume: Number($('#memoryMusicVolume').value) })
      portalSheets.close($('#familyMemorySettings')); notice('Memory settings saved')
    } catch (error) { showError(error) }
  }
  portalSheets.open($('#familyMemorySettings'))
}
