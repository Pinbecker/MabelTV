'use strict'

const remoteScrub = { open: false, dragging: false, token: '', position: 0, duration: 0, paused: true, at: 0, pending: null, busy: false }
function remoteScrubTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0)), hours = Math.floor(total / 3600)
  return (hours ? hours + ':' : '') + String(Math.floor(total / 60) % 60).padStart(hours ? 2 : 1, '0') + ':' + String(total % 60).padStart(2, '0')
}
function remoteScrubPaint() {
  if (!remoteScrub.open) return
  const slider = $('#remoteScrubRange')
  let position = remoteScrub.position
  if (remoteScrub.dragging) position = Number(slider.value)
  else if (remoteScrub.pending) position = remoteScrub.pending.position
  else if (!remoteScrub.paused) position += Math.max(0, performance.now() - remoteScrub.at) / 1000
  position = Math.min(remoteScrub.duration, Math.max(0, position))
  if (!remoteScrub.dragging) slider.value = String(Math.round(position))
  slider.style.setProperty('--scrub-progress', `${Math.min(100, position / Math.max(1, remoteScrub.duration) * 100)}%`)
  slider.setAttribute('aria-valuetext', `${remoteScrubTime(position)} of ${remoteScrubTime(remoteScrub.duration)}`)
  $('#remoteScrubPosition').textContent = remoteScrubTime(position)
  $('#remoteScrubDuration').textContent = remoteScrubTime(remoteScrub.duration)
  const clock = date => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const now = new Date(), ends = new Date(now.getTime() + (remoteScrub.duration - position) * 1000)
  $('#remoteScrubClock').textContent = remoteScrub.busy ? 'Seeking…' : `${clock(now)} · ${remoteScrub.paused ? 'Paused' : 'Ends ' + clock(ends)}`
  remotePreviewPaint(position)
}
function remoteScrubClose(focus = false) {
  remotePreviewReset()
  remoteScrub.open = false; remoteScrub.dragging = false
  $('#remoteTransportButtons').classList.remove('hidden'); $('#remoteScrubPanel').classList.add('hidden')
  $('#remoteScrubOpen').setAttribute('aria-expanded', 'false')
  if (focus) $('#remoteScrubOpen').focus({ preventScroll: true })
}
function renderRemoteScrub(state) {
  const available = state.available === true && state.standby !== true && state.seek_available === true && Number(state.playback_duration) > 0
  const button = $('#remoteScrubOpen')
  button.disabled = !available
  button.title = available ? 'Scrub through this programme' : state.seek_supported !== true ? 'Available after the TV player update' : 'No seekable programme playing'
  if (!available || remoteScrub.token && remoteScrub.token !== state.seek_token) {
    remoteScrubClose(); remoteScrub.pending = null
  }
  remoteScrub.token = available ? state.seek_token : ''
  remoteScrub.position = Math.max(0, Number(state.playback_position) || 0)
  remoteScrub.duration = Math.max(0, Number(state.playback_duration) || 0)
  remoteScrub.paused = state.paused === true; remoteScrub.at = performance.now()
  if (remoteScrub.pending && (Math.abs(remoteScrub.position - remoteScrub.pending.position) < 3 || Date.now() > remoteScrub.pending.until)) remoteScrub.pending = null
  $('#remoteScrubRange').max = String(Math.floor(remoteScrub.duration))
  $('#remoteScrubRange').disabled = !available || remoteScrub.busy
  remoteScrubPaint()
}
$('#remoteScrubOpen').onclick = () => {
  if (!remoteScrub.token) return
  remoteScrub.open = true
  $('#remoteTransportButtons').classList.add('hidden'); $('#remoteScrubPanel').classList.remove('hidden')
  $('#remoteScrubOpen').setAttribute('aria-expanded', 'true')
  remoteScrubPaint(); $('#remoteScrubRange').focus({ preventScroll: true })
}
$('#remoteScrubClose').onclick = () => remoteScrubClose(true)
const remoteScrubSlider = $('#remoteScrubRange')
remoteScrubSlider.oninput = () => { remoteScrub.dragging = true; remoteScrubPaint() }
remoteScrubSlider.onpointerdown = () => { if (!remoteScrubSlider.disabled) { remoteScrub.dragging = true; remoteScrubPaint() } }
remoteScrubSlider.onpointerup = () => { remoteScrub.dragging = false; setTimeout(remoteScrubPaint, 0) }
remoteScrubSlider.onpointercancel = () => { remoteScrub.dragging = false; remoteScrubPaint() }
remoteScrubSlider.onkeydown = event => {
  if (event.key === 'Escape') { event.preventDefault(); remoteScrubClose(true) }
}
remoteScrubSlider.onchange = async () => {
  if (!remoteScrub.open || !remoteScrub.token || remoteScrub.busy) return
  const token = remoteScrub.token, position = Number(remoteScrubSlider.value)
  remoteScrub.dragging = false; remoteScrub.busy = true; remoteScrubSlider.disabled = true
  remoteScrub.pending = { position, until: Date.now() + 8000 }; remoteScrubPaint()
  const success = await sendLiveCommand('seek', null, { position, token })
  remoteScrub.busy = false
  if (!success || remoteScrub.token !== token) remoteScrub.pending = null
  remoteScrubSlider.disabled = !remoteScrub.token; remoteScrubPaint()
}
setInterval(() => {
  if (!remoteScrub.open || document.hidden) return
  if (!$('#view-live').classList.contains('active')) { remoteScrubClose(); return }
  remoteScrubPaint()
}, 1000)
