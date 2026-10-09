'use strict'

let familyDeviceMemories = null

function stopFamilyMemoriesDevice() {
  const playback = familyDeviceMemories
  familyDeviceMemories = null
  const video = $('#familyDeviceVideo')
  if (video) { $('#familyDevicePlayer').append(video); video.controls = true }
  if (playback) {
    clearInterval(playback.timer)
    cancelAnimationFrame(playback.fade)
    document.removeEventListener('visibilitychange', playback.visibility)
    playback.presentation?.destroy()
  }
  $('#familyDeviceMemoryStage').replaceChildren()
  $('#familyDeviceMemoryControls').classList.add('hidden')
  $('#familyDeviceMemoryStage').classList.add('hidden')
  $('#familyDevicePlayer').classList.remove('is-memories')
}

async function playFamilyMemoriesOnDevice(channel, item = null) {
  resetFamilyDevicePlayer(); familyDeviceStory = null
  const generation = familyDeviceGeneration
  const dialog = $('#familyDevicePlayer'), stage = $('#familyDeviceMemoryStage')
  const video = $('#familyDeviceVideo'), music = $('#familyDeviceAudio')
  const message = $('#familyDeviceMessage'), toggle = $('#familyDeviceMemoryToggle')
  const playback = { generation, session: null, index: 0, scene: 0, elapsed: 0, paused: false, timer: 0, fade: 0 }
  familyDeviceMemories = playback
  const current = () => familyDeviceMemories === playback && generation === familyDeviceGeneration && dialog.open
  const showMessage = text => { message.textContent = text; message.classList.toggle('hidden', !text) }
  playback.presentation = createFamilyMemoryPresentation(stage, () => showMessage('This photo could not load. You can skip to the next memory.'))
  const musicLevel = () => Math.max(0, Math.min(1, Number(playback.session?.settings?.music_volume ?? 25) / 100))
  const photos = () => playback.session?.scenes[playback.index]?.kind === 'photo'
  const caption = () => {
    const scene = playback.session.scenes[playback.index]
    $('#familyDeviceMemoryCount').textContent = `${playback.index + 1} of ${playback.session.scenes.length}`
    $('#familyDeviceMemoryCaption').textContent = scene.kind === 'video' ? 'A little moment in motion' : scene.caption || channel.name
    toggle.querySelector('span').textContent = playback.paused ? 'Play' : 'Pause'
    toggle.querySelector('use').setAttribute('href', '/portal/icons.svg#signal-' + (playback.paused ? 'play' : 'pause'))
    toggle.setAttribute('aria-label', playback.paused ? 'Play memories' : 'Pause memories')
    for (const id of ['familyDeviceMemoryToggle', 'familyDeviceMemoryPrevious', 'familyDeviceMemoryNext'])
      $('#' + id).disabled = Boolean(playback.transitioning)
  }
  const fadeMusic = (level, done = () => {}) => {
    cancelAnimationFrame(playback.fade)
    const start = performance.now(), from = music.volume
    const frame = now => {
      if (!current()) return
      const progress = Math.min(1, (now - start) / 240)
      music.volume = from + (level - from) * progress
      if (progress < 1) playback.fade = requestAnimationFrame(frame)
      else done()
    }
    playback.fade = requestAnimationFrame(frame)
  }
  const pause = paused => {
    if (!current() || !playback.session) return
    playback.paused = paused; playback.lastTick = performance.now()
    playback.presentation.pause(paused)
    if (paused) { video.pause(); music.pause(); cancelAnimationFrame(playback.fade) }
    else {
      showMessage('')
      if (!photos()) video.play().catch(() => { if (current()) { playback.paused = true; caption(); showMessage('Tap Play to continue this video.') } })
      else if (playback.session.settings.music) music.play().then(() => { if (current() && photos() && !playback.paused) fadeMusic(musicLevel()) }).catch(() => {
        if (current()) { pause(true); showMessage('Tap Play to start the background music.') }
      })
    }
    caption()
  }
  const requestSession = async extra => {
    const session = await api('/api/family-media/start', { method: 'POST', body: JSON.stringify({
      kind: 'memories', channel: channel.number, target: 'device', ...extra,
    }) })
    if (!current()) return false
    if (!session.scenes?.length) throw new Error('There are no ready memories to play yet.')
    playback.session = session
    const soundtrack = session.settings.music?.source || ''
    if (music.getAttribute('src') !== soundtrack) {
      if (soundtrack) { music.src = soundtrack; music.loop = true; music.volume = 0 }
      else { music.pause(); music.removeAttribute('src'); music.load() }
    }
    return true
  }
  const startScene = async index => {
    if (!current() || playback.transitioning) return
    const serial = ++playback.scene
    if (index >= playback.session.scenes.length) {
      playback.transitioning = true
      caption()
      const last = playback.session.scenes.at(-1).items.at(-1).id
      showMessage('Preparing more memories…')
      try { if (!await requestSession({ avoid_id: last })) return }
      catch (error) { if (current()) { playback.paused = true; showMessage(error.message); caption() }; return }
      finally { playback.transitioning = false; if (current()) caption() }
      if (serial !== playback.scene) return
      index = 0
    }
    playback.index = Math.max(0, index); playback.elapsed = 0; playback.lastTick = performance.now()
    playback.paused = false; showMessage('')
    playback.presentation.pause(false)
    const scene = playback.session.scenes[playback.index]
    const liveScene = () => current() && serial === playback.scene
    video.onpause = video.onplaying = video.onended = video.onerror = video.onloadedmetadata = video.ontimeupdate = null
    video.pause(); video.classList.add('hidden'); video.removeAttribute('src'); video.load()
    dialog.append(video)
    stage.classList.remove('hidden')
    playback.presentation.show(scene, scene.kind === 'video' ? video : null)
    if (scene.kind === 'photo') {
      if (playback.session.settings.music) {
        music.volume = 0
        music.play().then(() => { if (liveScene() && !playback.paused) fadeMusic(musicLevel()) }).catch(() => {
          if (liveScene()) { pause(true); showMessage('Tap Play to start the background music.') }
        })
      }
    } else {
      fadeMusic(0, () => { if (liveScene()) music.pause() })
      const asset = scene.items[Number(scene.video_index || 0)]
      video.onloadedmetadata = () => {
        if (liveScene()) video.currentTime = Math.min(Number(scene.clip_start || 0), Math.max(0, video.duration - .1))
      }
      video.ontimeupdate = () => {
        if (liveScene() && !playback.paused && video.currentTime >= Number(scene.clip_start || 0) + Number(scene.seconds || 10))
          startScene(playback.index + 1)
      }
      video.src = asset.source; video.poster = asset.artwork || ''; video.classList.remove('hidden')
      video.onended = () => { if (liveScene()) startScene(playback.index + 1) }
      video.onpause = () => { if (liveScene() && !video.ended) { playback.paused = true; caption() } }
      video.onplaying = () => { if (liveScene()) { playback.paused = false; showMessage(''); caption() } }
      video.onerror = () => { if (liveScene()) { playback.paused = true; showMessage('This video could not load. You can skip to the next memory.'); caption() } }
      video.play().catch(() => { if (liveScene()) { playback.paused = true; showMessage('Tap Play to start this video.'); caption() } })
    }
    caption()
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: scene.title || channel.name, artist: channel.name })
    }
  }
  $('#familyDeviceTitle').textContent = channel.name
  dialog.classList.add('is-memories')
  for (const id of ['familyMemorySheet', 'familyMemoryPlaybackSheet']) if ($('#' + id).open) portalSheets.close($('#' + id))
  portalSheets.open(dialog)
  showMessage('Preparing your memories…')
  toggle.onclick = () => pause(!playback.paused)
  $('#familyDeviceMemoryPrevious').onclick = () => startScene(playback.index > 0 ? playback.index - 1 : playback.session.scenes.length - 1)
  $('#familyDeviceMemoryNext').onclick = () => startScene(playback.index + 1)
  playback.visibility = () => { if (document.hidden) pause(true) }
  document.addEventListener('visibilitychange', playback.visibility)
  try {
    if (!await requestSession(item ? { id: item.id } : {})) return
    $('#familyDeviceMemoryControls').classList.remove('hidden')
    await startScene(0)
    if (!current()) return
    playback.timer = setInterval(() => {
      if (!current() || playback.paused || !photos()) return
      const now = performance.now()
      playback.elapsed += (now - playback.lastTick) / 1000; playback.lastTick = now
      if (playback.elapsed >= playback.session.scenes[playback.index].seconds) startScene(playback.index + 1)
    }, 200)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => pause(false))
      navigator.mediaSession.setActionHandler('pause', () => pause(true))
      navigator.mediaSession.setActionHandler('previoustrack', () => startScene(Math.max(0, playback.index - 1)))
      navigator.mediaSession.setActionHandler('nexttrack', () => startScene(playback.index + 1))
    }
  } catch (error) { if (current()) showMessage(error.message) }
}
