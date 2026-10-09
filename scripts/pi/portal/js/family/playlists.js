'use strict'

let mabelPlaylists = []
let selectedPlaylistId = ''
let playlistPickerTarget = null
let playlistOrderWrites = Promise.resolve()
let playlistOrderPending = 0
let playlistOrderFailed = false
let playlistOrderConfirmed = null

async function loadInitialMabelPlaylists() {
  const cached = await readPortalDataCache('mabel-playlists-v1', 'mabel_playlists')
  if (cached && !cached.stale) {
    mabelPlaylists = cached.data.playlists || []
    loadMabelPlaylists().catch(showError)
    return
  }
  try { await loadMabelPlaylists() }
  catch (error) {
    if (error.status === 401) throw error
    console.warn('Playlist startup refresh failed', error)
  }
}

function openFamilyForm(dialog, input = null) {
  // Safari moves the visual viewport for its keyboard without resizing the
  // layout viewport used by modal dialogs. Keep this small form inside the
  // visible area throughout the keyboard's resize and pan animation.
  const viewport = window.visualViewport
  let frame = 0
  const update = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      dialog.style.setProperty('--family-form-top', `${viewport?.offsetTop || 0}px`)
      dialog.style.setProperty('--family-form-height', `${viewport?.height || innerHeight}px`)
      const focused = document.activeElement
      if (dialog.contains(focused) && focused.matches('input'))
        (focused.closest('.family-create') || focused).scrollIntoView({ block: 'nearest' })
    })
  }
  const cleanup = () => {
    cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', update)
    viewport?.removeEventListener('scroll', update)
    window.removeEventListener('resize', update)
    dialog.style.removeProperty('--family-form-top')
    dialog.style.removeProperty('--family-form-height')
    dialog.removeEventListener('close', cleanup)
  }
  viewport?.addEventListener('resize', update)
  viewport?.addEventListener('scroll', update)
  window.addEventListener('resize', update)
  dialog.addEventListener('close', cleanup)
  update()
  portalSheets.open(dialog)
  input?.focus({ preventScroll: true })
}

function familyConfirm(title, message, label, callback) {
  const dialog = $('#familyConfirm')
  $('#familyConfirmTitle').textContent = title
  $('#familyConfirmText').textContent = message
  const accept = $('#familyConfirmAccept')
  accept.textContent = label
  accept.classList.toggle('is-destructive', /^(remove|delete)/i.test(label))
  accept.onclick = async () => {
    accept.disabled = true
    try { await callback(); portalSheets.close(dialog) }
    catch (error) { showError(error) }
    finally { accept.disabled = false }
  }
  portalSheets.open(dialog)
}

function familyPrompt(title, value, callback, maximum = 160) {
  const dialog = $('#familyPrompt')
  $('#familyPromptTitle').textContent = title
  const input = $('#familyPromptInput')
  input.value = value; input.maxLength = maximum
  const save = $('#familyPromptSave')
  save.textContent = !value ? title === 'New playlist' ? 'Create playlist' : 'Create story' : 'Save changes'
  save.onclick = async () => {
    if (!input.value.trim()) { input.focus(); return }
    save.disabled = true
    try { await callback(input.value.trim()); portalSheets.close(dialog) }
    catch (error) { showError(error) }
    finally { save.disabled = false }
  }
  input.onkeydown = event => { if (event.key === 'Enter') save.click() }
  openFamilyForm(dialog, input)
}

function familyButton(label, callback, className = 'secondary') {
  const button = document.createElement('button')
  button.type = 'button'; button.className = className
  button.textContent = label
  button.onclick = () => Promise.resolve().then(callback).catch(showError)
  return button
}

async function loadMabelPlaylists() {
  if (offlineMode) return
  if (playlistOrderPending) await playlistOrderWrites.catch(() => {})
  const result = await api('/api/mabel-playlists')
  if (playlistOrderPending) return result
  mabelPlaylists = result.playlists || []
  renderMabelPlaylists()
  await writePortalDataCache('mabel-playlists-v1', result, 'mabel_playlists')
  return result
}

async function changeMabelPlaylist(action, extra = {}) {
  do { await playlistOrderWrites.catch(() => {}) } while (playlistOrderPending)
  const result = await api('/api/mabel-playlists', {
    method: 'POST', body: JSON.stringify({ action, ...extra }),
  })
  mabelPlaylists = result.playlists || []
  if (result.queue) { mabelQueue = result.queue; renderMabelQueue() }
  renderMabelPlaylists()
  applyPortalBootstrap(await api('/api/bootstrap'))
  await writePortalDataCache('mabel-playlists-v1', result, 'mabel_playlists')
  return result
}

function bindPlaylistAction(queueButton, channel, programme, close) {
  if (!queueButton.parentElement.classList.contains('family-save-actions')) {
    const group = document.createElement('div'); group.className = 'family-save-actions'
    queueButton.before(group); group.append(queueButton)
  }
  let button = queueButton.nextElementSibling
  if (!button?.classList.contains('mabel-playlist-add')) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'watch-film-play mabel-playlist-add'
    button.innerHTML = '<span class="watch-action-icon"><svg class="icon"><use href="/portal/icons.svg#signal-plus"/></svg></span><span><strong>Add to playlist</strong><small>Save a selection to play again</small></span>'
    queueButton.after(button)
  }
  button.disabled = queueButton.disabled || !programme
  button.onclick = () => {
    if (!programme) return
    playlistPickerTarget = { channel, programme }
    close()
    openPlaylistPicker().catch(showError)
  }
}

async function openPlaylistPicker() {
  await loadMabelPlaylists()
  const target = playlistPickerTarget
  $('#playlistPickerProgramme').textContent = target.programme.metadata?.title || target.programme.display_name
  const choices = $('#playlistPickerChoices')
  choices.replaceChildren()
  for (const playlist of mabelPlaylists) {
    const button = familyButton('', () => addProgrammeToPlaylist(playlist.id), 'watch-film-play family-choice')
    const copy = document.createElement('span')
    const title = document.createElement('strong'); title.textContent = playlist.name
    const small = document.createElement('small'); small.textContent = playlistSummary(playlist)
    copy.append(title, small)
    button.append(playlistArtwork(playlist), copy, portalIcon('signal-chevron-right')); choices.append(button)
  }
  if (!mabelPlaylists.length) choices.append(familyEmpty('Your first playlist', 'Give it a name below. This programme will be added straight away.'))
  $('#playlistPickerName').value = ''
  $('#playlistPickerCreate').onclick = async () => {
    const input = $('#playlistPickerName')
    if (!input.value.trim()) { input.focus(); return }
    const button = $('#playlistPickerCreate'); button.disabled = true
    try {
      const result = await changeMabelPlaylist('create', { name: input.value.trim() })
      await addProgrammeToPlaylist(result.id)
    } catch (error) { showError(error) }
    finally { button.disabled = false }
  }
  openFamilyForm($('#playlistPicker'))
}

async function addProgrammeToPlaylist(id) {
  if (!playlistPickerTarget) return
  await changeMabelPlaylist('add', { id, channel: playlistPickerTarget.channel.number,
    file: playlistPickerTarget.programme.name })
  portalSheets.close($('#playlistPicker'))
  playlistPickerTarget = null
  notice('Added to playlist')
}

function renderMabelPlaylists({ updatePage = true } = {}) {
  if (selectedPlaylistId && updatePage) renderPlaylistPage()
  const panel = $('#mabelChannelPlaylists')
  if (!panel) return
  const renderKey = JSON.stringify(mabelPlaylists)
  if (panel.dataset.playlistsRenderKey === renderKey) return
  panel.dataset.playlistsRenderKey = renderKey
  panel.replaceChildren()
  const head = document.createElement('header')
  head.className = 'family-section-head'
  head.innerHTML = '<div><p class="watch-section-kicker">Favourite afternoons, ready again</p><h2>Playlists</h2></div>'
  head.append(familyButton('New playlist', () => familyPrompt('New playlist', '', async name => {
    const result = await changeMabelPlaylist('create', { name })
    openMabelPlaylist(result.id)
  }, 80), 'family-text-button'))
  panel.append(head)
  const grid = document.createElement('div'); grid.className = 'family-playlist-grid'
  for (const value of mabelPlaylists) {
    const card = familyButton('', () => openMabelPlaylist(value.id), 'family-playlist-card')
    const title = document.createElement('strong'); title.textContent = value.name
    const detail = document.createElement('small')
    detail.textContent = playlistSummary(value)
    card.append(playlistArtwork(value, true), title, detail); grid.append(card)
  }
  panel.append(grid)
  if (!mabelPlaylists.length) panel.append(familyEmpty('Make a favourite afternoon', 'Add films and episodes from their play menus, then play your whole selection whenever you like.'))
}

function openMabelPlaylist(id, { updateHistory = true, resetScroll = true } = {}) {
  selectedPlaylistId = String(id)
  watchDomain = 'mabel'; remoteKind = 'channel'
  selectMabelChannelKind('playlists')
  if (updateHistory) history.pushState({ mabelPlaylist: true, playlistId: selectedPlaylistId }, '', `#mabel-playlist/${encodeURIComponent(selectedPlaylistId)}`)
  renderPlaylistPage()
  openView('mabel-playlist', { resetScroll })
  if (!mabelPlaylists.some(playlist => playlist.id === selectedPlaylistId)) loadMabelPlaylists().catch(showError)
}

function returnToMabelPlaylists({ replace = false } = {}) {
  if (!replace && history.state?.mabelPlaylist) { history.back(); return }
  selectedPlaylistId = ''
  watchDomain = 'mabel'; remoteKind = 'channel'
  selectMabelChannelKind('playlists')
  history.replaceState({ primaryView: 'watch', watchDomain }, '', '#watch')
  openView('watch')
}

function renderPlaylistPage() {
  const body = $('#familyPlaylistBody'), head = $('#familyPlaylistFixedHead')
  if (!body || !head) return
  body.replaceChildren(); head.replaceChildren()
  const back = familyButton('Back to playlists', () => returnToMabelPlaylists(), 'workspace-back channel-page-back family-back')
  back.prepend(portalIcon('signal-arrow-left'))
  const navigation = document.createElement('nav'); navigation.className = 'channel-page-nav'
  navigation.setAttribute('aria-label', 'Playlist navigation'); navigation.append(back); head.append(navigation)
  const playlist = mabelPlaylists.find(value => value.id === selectedPlaylistId)
  if (playlist) renderPlaylistDetail(body, playlist)
  else body.append(familyEmpty('Playlist unavailable', 'Return to your playlists to choose another afternoon.'))
}

const playlistHeaderObserver = new ResizeObserver(entries => {
  const height = entries[0].target.getBoundingClientRect().height
  if (height > 0) $('#familyPlaylistPage').style.setProperty('--family-playlist-header-height', `${height}px`)
})
playlistHeaderObserver.observe($('#familyPlaylistFixedHead'))

function playlistSummary(playlist) {
  return `${playlist.items.length} ${playlist.items.length === 1 ? 'programme' : 'programmes'}${playlist.duration ? ` · ${watchTimeLabel(playlist.duration)}` : ''}`
}

function playlistArtwork(playlist, stacked = false) {
  const art = document.createElement('span'); art.className = 'family-playlist-art'
  const items = playlist.items.filter(item => item.artwork).slice(0, stacked ? 3 : 1)
  if (!items.length) {
    art.classList.add('is-empty'); art.append(portalIcon('signal-film'))
  } else {
    art.classList.toggle('is-stack', stacked)
    items.forEach((item, index) => {
      const image = document.createElement('img'); image.alt = ''; image.loading = 'lazy'
      image.style.setProperty('--stack-index', index)
      image.src = `/api/channel/artwork/${encodeURIComponent(item.artwork)}`
      art.append(image)
    })
  }
  return art
}

function familyEmpty(title, text) {
  const empty = document.createElement('div'); empty.className = 'family-empty'
  const strong = document.createElement('strong'); strong.textContent = title
  const detail = document.createElement('p'); detail.textContent = text
  empty.append(strong, detail); return empty
}

function renderPlaylistDetail(panel, playlist) {
  const fixed = $('#familyPlaylistFixedHead')
  const head = document.createElement('header'); head.className = 'family-section-head family-playlist-head'
  const copy = document.createElement('div')
  const kicker = document.createElement('p'); kicker.className = 'watch-section-kicker'; kicker.textContent = 'Saved for another day'
  const title = document.createElement('h1'); title.textContent = playlist.name
  const summary = document.createElement('p'); summary.className = 'muted'
  summary.textContent = playlistSummary(playlist)
  copy.append(kicker, title, summary); head.append(playlistArtwork(playlist, true), copy)
  const rename = familyButton('', () => familyPrompt('Rename playlist', playlist.name,
    name => changeMabelPlaylist('rename', { id: playlist.id, name }), 80), 'family-icon-button')
  rename.setAttribute('aria-label', 'Rename playlist'); rename.append(portalIcon('signal-pencil')); head.append(rename)
  fixed.append(head)
  const actions = document.createElement('div'); actions.className = 'family-playlist-actions'
  const play = familyButton('Play playlist on TV', async () => {
    await loadMabelQueue()
    const start = () => changeMabelPlaylist('play', { id: playlist.id, confirmed: true })
    if (mabelQueue?.items?.length) familyConfirm('Replace Up Next?', 'Your saved playlist will start on TV and replace the current queue. The playlist itself stays saved.', 'Play playlist', start)
    else await start()
  }, 'primary')
  const append = familyButton('Add to Up Next', async () => {
    await changeMabelPlaylist('append', { id: playlist.id }); notice('Playlist added to Up Next')
  })
  play.prepend(portalIcon('signal-monitor-play')); append.prepend(portalIcon('signal-plus'))
  play.disabled = append.disabled = !playlist.items.length || playlist.items.some(item => !item.available)
  actions.append(play, append); fixed.append(actions)
  const repeat = document.createElement('label'); repeat.className = 'family-repeat'
  repeat.innerHTML = '<span><strong>Repeat playlist</strong><small>Keep this afternoon going until you stop it</small></span>'
  const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = playlist.repeat
  toggle.onchange = () => changeMabelPlaylist('repeat', { id: playlist.id, repeat: toggle.checked }).catch(showError)
  repeat.append(toggle); panel.append(repeat)
  const rows = document.createElement('div'); rows.className = 'family-playlist-rows'
  playlist.items.forEach((item, index) => {
    const row = document.createElement('article'); row.className = 'family-playlist-row'; row.dataset.playlistItem = item.id
    const open = familyButton('', () => {
      const { channel, programme } = mabelQueueProgramme(item)
      if (programme) openWatchProgrammeSheet(channel, programme)
    }, 'family-row-open')
    open.append(mabelQueueArtwork(item))
    const copy = document.createElement('span'); copy.className = 'family-row-copy'
    const title = document.createElement('strong'); title.textContent = item.title
    const detail = document.createElement('small')
    detail.textContent = item.available ? `CH ${item.channel_number} · ${item.channel_name}` : 'Unavailable · remove or restore this programme'
    copy.append(title, detail); open.append(copy)
    const move = document.createElement('div'); move.className = 'family-row-move'
    for (const [direction, label, disabled] of [['up', 'Move up', index === 0], ['down', 'Move down', index === playlist.items.length - 1]]) {
      const button = familyButton('', () => movePlaylistItem(playlist.id, item.id, direction), 'family-icon-button')
      button.setAttribute('aria-label', label); button.disabled = disabled
      button.innerHTML = `<svg class="icon"><use href="/portal/icons.svg#signal-chevron-${direction}"/></svg>`; move.append(button)
    }
    row.append(move)
    const remove = familyButton('', () => familyConfirm('Remove from playlist?', `${item.title} will stay in your TV library.`, 'Remove',
      () => changeMabelPlaylist('remove', { id: playlist.id, item_id: item.id })), 'family-icon-button family-row-remove')
    remove.setAttribute('aria-label', `Remove ${item.title}`)
    remove.innerHTML = '<svg class="icon"><use href="/portal/icons.svg#signal-x"/></svg>'
    row.append(open, remove); rows.append(row)
  })
  panel.append(rows)
  if (!playlist.items.length) panel.append(familyEmpty('Your afternoon starts here', 'Open any film or episode and choose Add to playlist.'))
  const removePlaylist = familyButton('Delete playlist', () => familyConfirm('Delete playlist?', 'The films and episodes in your library will stay exactly as they are.', 'Delete playlist',
    async () => { await changeMabelPlaylist('delete', { id: playlist.id }); returnToMabelPlaylists({ replace: true }) }), 'watch-film-play watch-programme-danger family-delete-playlist')
  removePlaylist.prepend(portalIcon('signal-trash')); panel.append(removePlaylist)
}

async function movePlaylistItem(id, itemId, direction) {
  if (playlistOrderPending && playlistOrderFailed) return
  const playlist = mabelPlaylists.find(value => value.id === id)
  const index = playlist?.items.findIndex(item => item.id === itemId) ?? -1
  const target = index + (direction === 'up' ? -1 : 1)
  if (index < 0 || target < 0 || target >= playlist.items.length) return
  if (!playlistOrderPending) {
    playlistOrderFailed = false
    playlistOrderConfirmed = { playlists: structuredClone(mabelPlaylists) }
  }
  const container = $('#familyPlaylistBody .family-playlist-rows')
  const rows = [...container.querySelectorAll('[data-playlist-item]')]
  const positions = new Map([...document.querySelectorAll('[data-playlist-item]')]
    .map(row => [row.dataset.playlistItem, row.getBoundingClientRect().top]))
  rows.forEach(row => row.getAnimations().forEach(animation => animation.cancel()))
  ;[playlist.items[index], playlist.items[target]] = [playlist.items[target], playlist.items[index]]
  container.insertBefore(direction === 'up' ? rows[index] : rows[target], direction === 'up' ? rows[target] : rows[index])
  ;[...container.children].forEach((row, position) => {
    const buttons = row.querySelectorAll('.family-row-move button')
    buttons[0].disabled = position === 0
    buttons[1].disabled = position === playlist.items.length - 1
    const offset = positions.get(row.dataset.playlistItem) - row.getBoundingClientRect().top
    if (Math.abs(offset) > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches)
      row.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
        { duration: 290, easing: 'cubic-bezier(.2,.8,.2,1)' })
  })
  playlistOrderPending += 1
  const save = playlistOrderWrites.catch(() => {}).then(async () => {
    if (playlistOrderFailed) return
    try {
      playlistOrderConfirmed = await api('/api/mabel-playlists', { method: 'POST',
        body: JSON.stringify({ action: direction, id, item_id: itemId }) })
    } catch (error) { playlistOrderFailed = true; throw error }
  }).finally(async () => {
    playlistOrderPending -= 1
    if (playlistOrderPending) return
    const confirmed = playlistOrderConfirmed
    mabelPlaylists = structuredClone(confirmed.playlists || [])
    renderMabelPlaylists({ updatePage: playlistOrderFailed })
    if (playlistOrderFailed) { await loadMabelPlaylists().catch(() => {}); return }
    const current = mabelPlaylists.find(value => value.id === selectedPlaylistId)
    if (current) $('#familyPlaylistFixedHead .family-playlist-art')?.replaceWith(playlistArtwork(current, true))
    try {
      applyPortalBootstrap(await api('/api/bootstrap'))
      await writePortalDataCache('mabel-playlists-v1', confirmed, 'mabel_playlists')
    } catch (_) { /* The saved order remains authoritative if its cache refresh fails. */ }
  })
  playlistOrderWrites = save
  return save
}

document.querySelectorAll('[data-family-close]').forEach(button => {
  if (button.classList.contains('portal-sheet-close')) button.replaceChildren(portalIcon('signal-x'))
  button.onclick = () => portalSheets.close(button.closest('dialog'))
})
