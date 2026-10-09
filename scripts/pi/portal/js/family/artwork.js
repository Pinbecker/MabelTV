'use strict'

// Leave request capacity for catalogue and remote controls, including through
// Cloudflare where one page can otherwise fan out many image requests at once.
const familyArtworkQueue = []
const familyArtworkObserved = new Set()
let familyArtworkActive = 0
const familyArtworkObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    familyArtworkObserver.unobserve(entry.target)
    familyArtworkObserved.delete(entry.target)
    entry.target.familyArtworkStart?.()
  }
}, { rootMargin: '240px' })

function familyArtwork(parent, source, alt = '', icon = 'signal-image') {
  const fallback = portalIcon(icon)
  parent.append(fallback)
  if (!source) return
  const image = document.createElement('img')
  image.alt = alt; image.decoding = 'async'; image.className = 'family-artwork-image'; image.style.opacity = '0'
  parent.append(image)
  let started = false
  parent.familyArtworkStart = () => {
    if (started) return
    started = true
    familyArtworkQueue.push({ parent, image, fallback, source })
    pumpFamilyArtwork()
  }
  familyArtworkObserver.observe(parent)
  familyArtworkObserved.add(parent)
}

function pumpFamilyArtwork() {
  for (const parent of familyArtworkObserved) if (!parent.isConnected) {
    familyArtworkObserver.unobserve(parent); familyArtworkObserved.delete(parent)
  }
  while (familyArtworkActive < 4 && familyArtworkQueue.length) {
    const job = familyArtworkQueue.shift()
    if (!job.parent.isConnected) continue
    familyArtworkActive += 1
    let retry = false
    const finish = success => {
      job.image.onload = job.image.onerror = null
      if (success) { job.fallback.remove(); job.image.style.opacity = '' }
      else job.image.remove()
      familyArtworkActive -= 1; pumpFamilyArtwork()
    }
    job.image.onload = () => finish(true)
    job.image.onerror = () => {
      if (!retry && job.parent.isConnected) {
        retry = true
        setTimeout(() => {
          if (!job.parent.isConnected) { finish(false); return }
          const url = new URL(job.source, location.href); url.searchParams.set('retry', '1')
          job.image.src = url.href
        }, 350)
      } else finish(false)
    }
    job.image.src = job.source
  }
}
