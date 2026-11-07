'use strict'

const scrubPreview = { token: '', duration: 0, position: 0, focus: 0, revision: 0, timer: null,
  cache: new Map(), pending: new Map(), failures: new Map(), bytes: 0, retryAt: 0 }
function remotePreviewReset() {
  clearTimeout(scrubPreview.timer)
  for (const controller of scrubPreview.pending.values()) controller.abort()
  scrubPreview.revision++; scrubPreview.token = ''; scrubPreview.cache.clear()
  scrubPreview.pending.clear(); scrubPreview.failures.clear(); scrubPreview.bytes = 0; scrubPreview.retryAt = 0
  $('#remoteScrubPreview').classList.add('hidden')
}
function remotePreviewBucket(position) {
  return Math.floor(Math.min(position, Math.max(0, scrubPreview.duration - 1)) / 80)
}
function remotePreviewPrepare(token, position, duration) {
  if (scrubPreview.token !== token) { remotePreviewReset(); scrubPreview.token = token }
  if (!token) return
  scrubPreview.duration = duration
  if (!remoteScrub.dragging) scrubPreview.focus = remotePreviewBucket(position)
  remotePreviewPump()
}
function remotePreviewPump() {
  clearTimeout(scrubPreview.timer)
  if (!scrubPreview.token || document.hidden || !$('#view-live').classList.contains('active')) return
  if (Date.now() < scrubPreview.retryAt) {
    scrubPreview.timer = setTimeout(remotePreviewPump, scrubPreview.retryAt - Date.now()); return
  }
  const count = Math.min(360, Math.ceil(scrubPreview.duration / 80)), focus = scrubPreview.focus
  const order = Array.from({ length: count }, (_, bucket) => bucket).sort((a, b) => Math.abs(a - focus) - Math.abs(b - focus))
  for (const bucket of order) {
    if (scrubPreview.pending.size >= 2) break
    if (scrubPreview.cache.has(bucket) || scrubPreview.pending.has(bucket) || Date.now() < (scrubPreview.failures.get(bucket) || 0)) continue
    if (scrubPreview.bytes >= 10 * 1024 * 1024 && Math.abs(bucket - focus) > 2) continue
    const controller = new AbortController()
    scrubPreview.pending.set(bucket, controller)
    void remotePreviewLoad(bucket, scrubPreview.revision, controller)
  }
}
function remotePreviewPaint(position) {
  const box = $('#remoteScrubPreview')
  if (!remoteScrub.open || !remoteScrub.dragging) { box.classList.add('hidden'); return }
  box.classList.remove('hidden'); scrubPreview.position = position
  box.classList.toggle('is-cancelling', remoteScrub.cancelArmed)
  $('#remoteScrubCancelHint').classList.toggle('hidden', !remoteScrub.cancelArmed)
  const width = box.parentElement.clientWidth, previewWidth = box.offsetWidth
  box.style.left = Math.max(0, Math.min(width - previewWidth, width * position / Math.max(1, remoteScrub.duration) - previewWidth / 2)) + 'px'
  $('#remoteScrubPreviewTime').textContent = remoteScrubTime(position)
  if (remoteScrub.cancelArmed) return
  const bucket = remotePreviewBucket(position), url = scrubPreview.cache.get(bucket)
  scrubPreview.focus = bucket
  const picture = $('#remoteScrubPreviewImage'), message = $('#remoteScrubPreviewMessage')
  if (url) {
    picture.style.backgroundImage = 'url("' + url + '")'
    picture.style.backgroundPosition = (Math.min(7, Math.floor((position - bucket * 80) / 10)) / 7 * 100) + '% 50%'
    picture.classList.remove('hidden'); message.classList.add('hidden')
  } else {
    picture.classList.add('hidden'); message.classList.remove('hidden')
    const failed = Date.now() < (scrubPreview.failures.get(bucket) || 0)
    message.textContent = failed ? 'Preview unavailable' : 'Preparing preview…'
    message.classList.toggle('loading', !failed)
  }
  remotePreviewPump()
}
async function remotePreviewLoad(bucket, revision, controller) {
  const deadline = Date.now() + 18000, token = scrubPreview.token
  const timeout = setTimeout(() => controller.abort(), 18000)
  try {
    while (revision === scrubPreview.revision && Date.now() < deadline) {
      const warm = !(remoteScrub.dragging && scrubPreview.focus === bucket)
      const response = await fetch('/api/live/seek-preview?token=' + encodeURIComponent(token) + '&position=' + bucket * 80 + (warm ? '&warm=1' : ''),
        { credentials: 'same-origin', signal: controller.signal, cache: 'no-store' })
      if (response.status === 202) { await new Promise(resolve => setTimeout(resolve, 400)); continue }
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Preview unavailable')
      const blob = await response.blob()
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob)
      })
      if (revision !== scrubPreview.revision) return
      scrubPreview.cache.set(bucket, url); scrubPreview.bytes += url.length
      scrubPreview.failures.delete(bucket)
      while (scrubPreview.bytes > 12 * 1024 * 1024 && scrubPreview.cache.size > 6) {
        const farthest = [...scrubPreview.cache.keys()].sort((a, b) => Math.abs(b - scrubPreview.focus) - Math.abs(a - scrubPreview.focus))[0]
        scrubPreview.bytes -= scrubPreview.cache.get(farthest).length; scrubPreview.cache.delete(farthest)
      }
      remotePreviewPaint(scrubPreview.position); return
    }
    throw new Error('Preview unavailable')
  } catch (error) {
    if (revision !== scrubPreview.revision) return
    scrubPreview.failures.set(bucket, Date.now() + 5000); scrubPreview.retryAt = Date.now() + 1500
    remotePreviewPaint(scrubPreview.position)
  } finally {
    clearTimeout(timeout)
    if (revision === scrubPreview.revision) {
      scrubPreview.pending.delete(bucket)
      scrubPreview.timer = setTimeout(remotePreviewPump, 100)
    }
  }
}
