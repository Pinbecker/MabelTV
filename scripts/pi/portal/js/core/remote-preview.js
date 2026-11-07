'use strict'

const scrubPreview = { key: '', token: '', position: 0, revision: 0, controller: null, timer: null, cache: new Map() }
function remotePreviewReset() {
  clearTimeout(scrubPreview.timer); scrubPreview.controller?.abort()
  scrubPreview.revision++; scrubPreview.key = ''; scrubPreview.token = ''
  scrubPreview.cache.clear()
  $('#remoteScrubPreview').classList.add('hidden')
}
function remotePreviewPaint(position) {
  const box = $('#remoteScrubPreview')
  if (!remoteScrub.open || !remoteScrub.dragging) { box.classList.add('hidden'); return }
  box.classList.remove('hidden'); scrubPreview.position = position
  box.classList.toggle('is-cancelling', remoteScrub.cancelArmed)
  $('#remoteScrubCancelHint').classList.toggle('hidden', !remoteScrub.cancelArmed)
  const timeline = box.parentElement, width = timeline.clientWidth
  const previewWidth = box.offsetWidth
  box.style.left = Math.max(0, Math.min(width - previewWidth, width * position / Math.max(1, remoteScrub.duration) - previewWidth / 2)) + 'px'
  $('#remoteScrubPreviewTime').textContent = remoteScrubTime(position)
  if (remoteScrub.cancelArmed) return
  const bucket = Math.floor(Math.min(position, Math.max(0, remoteScrub.duration - 1)) / 80)
  const key = `${remoteScrub.token}:${bucket}`
  const url = scrubPreview.cache.get(key)
  const picture = $('#remoteScrubPreviewImage'), message = $('#remoteScrubPreviewMessage')
  if (url) {
    picture.style.backgroundImage = `url("${url}")`
    picture.style.backgroundPosition = `${Math.min(7, Math.floor((position - bucket * 80) / 10)) / 7 * 100}% 50%`
    picture.classList.remove('hidden'); message.classList.add('hidden')
  } else { picture.classList.add('hidden'); message.classList.remove('hidden') }
  if (scrubPreview.key === key) return
  clearTimeout(scrubPreview.timer); scrubPreview.controller?.abort()
  scrubPreview.key = key; scrubPreview.token = remoteScrub.token
  const revision = ++scrubPreview.revision
  if (url) return
  message.textContent = 'Preparing preview…'; message.classList.add('loading')
  scrubPreview.timer = setTimeout(() => void remotePreviewLoad(key, bucket * 80, revision), 120)
}
async function remotePreviewLoad(key, position, revision) {
  const controller = new AbortController(); scrubPreview.controller = controller
  const deadline = Date.now() + 18000, token = scrubPreview.token
  try {
    while (revision === scrubPreview.revision && Date.now() < deadline) {
      const response = await fetch(`/api/live/seek-preview?token=${encodeURIComponent(token)}&position=${position}`, { credentials: 'same-origin', signal: controller.signal, cache: 'no-store' })
      if (response.status === 202) {
        await new Promise(resolve => setTimeout(resolve, 400))
        continue
      }
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Preview unavailable')
      const blob = await response.blob()
      if (revision !== scrubPreview.revision) return
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob)
      })
      const image = new Image(); image.src = url; await image.decode()
      if (revision !== scrubPreview.revision) return
      scrubPreview.cache.set(key, url)
      if (scrubPreview.cache.size > 16) {
        const oldest = scrubPreview.cache.keys().next().value
        scrubPreview.cache.delete(oldest)
      }
      remotePreviewPaint(scrubPreview.position); return
    }
    throw new Error('Preview unavailable')
  } catch (error) {
    if (revision !== scrubPreview.revision || error.name === 'AbortError') return
    const message = $('#remoteScrubPreviewMessage'); message.textContent = 'Preview unavailable'; message.classList.remove('loading')
  }
}
