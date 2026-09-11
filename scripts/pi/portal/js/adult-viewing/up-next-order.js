'use strict'

function upNextOrderKeys(root) {
  return [...root.querySelectorAll(':scope > .adult-viewing-row')]
    .map(row => row.dataset.viewingKey).filter(Boolean)
}

function upNextLayoutRect(item) {
  const rect = item.getBoundingClientRect()
  const transform = getComputedStyle(item).transform
  if (!transform || transform === 'none' || typeof DOMMatrixReadOnly === 'undefined') return rect
  const matrix = new DOMMatrixReadOnly(transform)
  const left = rect.left - matrix.m41
  const top = rect.top - matrix.m42
  return { left, top, right: left + rect.width, bottom: top + rect.height,
    width: rect.width, height: rect.height }
}

function animateUpNextNeighbours(root, before) {
  for (const row of root.querySelectorAll(':scope > .adult-viewing-row')) {
    const previous = before.get(row)
    const current = row.getBoundingClientRect()
    if (!previous) continue
    const x = previous.left - current.left
    const y = previous.top - current.top
    if ((Math.abs(x) < 1 && Math.abs(y) < 1) || !row.animate) continue
    row.getAnimations().forEach(animation => animation.cancel())
    row.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], {
      duration: 145, easing: 'cubic-bezier(.2,.75,.25,1)',
    })
  }
}

async function saveUpNextOrder(keys, previous) {
  keys.forEach((key, index) => {
    const item = adultViewingData.items?.find(value => value.key === key
      || `${value.media_type}:${value.tmdb_id}` === key)
    if (item) item.up_next_rank = index + 1
  })
  adultHomeLoadedAt = 0
  try {
    await api('/api/adult/viewing/reorder', {
      method: 'POST', body: JSON.stringify({ keys }),
    })
  } catch (error) {
    previous.forEach((key, index) => {
      const item = adultViewingData.items?.find(value => value.key === key
        || `${value.media_type}:${value.tmdb_id}` === key)
      if (item) item.up_next_rank = index + 1
    })
    renderAdultViewing({ anchor: false })
  }
}

function bindUpNextReorder(root) {
  const rows = [...root.querySelectorAll(':scope > .adult-viewing-row')]
  if (rows.length < 2) return
  root.classList.add('is-reorderable')
  rows.forEach(row => {
    const surface = row.querySelector('.adult-viewing-card-open')
    const image = row.querySelector('img')
    if (!surface) return
    if (image) image.draggable = false
    surface.setAttribute('aria-description', 'Press and hold, then drag to change its Up Next position')
    surface.addEventListener('contextmenu', event => event.preventDefault())
    let pointerId = null
    let startX = 0
    let startY = 0
    let latestX = 0
    let latestY = 0
    let grabX = 0
    let grabY = 0
    let floating = null
    let active = false
    let timer = null
    let frame = null
    let previousOrder = []

    const releasePointerListeners = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    const moveFloating = () => {
      if (!floating) return
      floating.style.setProperty('--queue-drag-x', `${latestX - grabX}px`)
      floating.style.setProperty('--queue-drag-y', `${latestY - grabY}px`)
    }
    const reorderAtPointer = () => {
      const candidates = [...root.querySelectorAll(':scope > .adult-viewing-row')]
        .filter(item => item !== row)
      const target = candidates.reduce((closest, item) => {
        const rect = upNextLayoutRect(item)
        const distance = Math.hypot(latestX - (rect.left + rect.width / 2),
          latestY - (rect.top + rect.height / 2))
        return !closest || distance < closest.distance ? { item, rect, distance } : closest
      }, null)
      if (!target) return
      const targetX = target.rect.left + target.rect.width / 2
      const targetY = target.rect.top + target.rect.height / 2
      const centred = Math.abs(latestY - targetY) <= target.rect.height * .32
      const currentRows = [...root.children]
      const crossingForward = currentRows.indexOf(row) < currentRows.indexOf(target.item)
      const after = latestY > target.rect.bottom - target.rect.height * .28
        || (centred && (latestX > targetX
          || (Math.abs(latestX - targetX) < 3 && crossingForward)))
      if ((!after && row.nextElementSibling === target.item)
          || (after && target.item.nextElementSibling === row)) return
      const before = new Map([...root.children].map(item => [item, item.getBoundingClientRect()]))
      if (after) target.item.after(row)
      else target.item.before(row)
      animateUpNextNeighbours(root, before)
    }
    const updateDragFrame = () => {
      frame = null
      if (!active) return
      moveFloating()
      const topEdge = 92
      const bottomEdge = window.innerHeight - 108
      const scroll = latestY < topEdge
        ? -Math.min(13, (topEdge - latestY) * .18)
        : latestY > bottomEdge ? Math.min(13, (latestY - bottomEdge) * .18) : 0
      if (scroll) window.scrollBy(0, scroll)
      reorderAtPointer()
      if (scroll) frame = requestAnimationFrame(updateDragFrame)
    }
    const scheduleDragFrame = () => {
      if (frame === null) frame = requestAnimationFrame(updateDragFrame)
    }
    const activate = () => {
      if (pointerId === null) return
      active = true
      previousOrder = upNextOrderKeys(root)
      const rect = row.getBoundingClientRect()
      grabX = latestX - rect.left
      grabY = latestY - rect.top
      floating = row.cloneNode(true)
      floating.classList.add('adult-viewing-drag-proxy')
      floating.style.width = `${rect.width}px`
      floating.style.height = `${rect.height}px`
      floating.style.left = `${rect.left}px`
      floating.style.top = `${rect.top}px`
      document.body.append(floating)
      row.classList.add('is-dragging')
      root.classList.add('is-actively-reordering')
      document.body.classList.add('up-next-reordering')
      try { surface.setPointerCapture?.(pointerId) } catch (_) { /* Window listeners retain the gesture. */ }
      moveFloating()
      navigator.vibrate?.(8)
    }
    const cancelTimer = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
    const finish = event => {
      if (pointerId !== event.pointerId) return
      cancelTimer()
      releasePointerListeners()
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      pointerId = null
      if (!active) return
      active = false
      floating?.remove()
      floating = null
      row.classList.remove('is-dragging')
      root.classList.remove('is-actively-reordering')
      document.body.classList.remove('up-next-reordering')
      row.dataset.reorderSuppressClick = 'true'
      setTimeout(() => { delete row.dataset.reorderSuppressClick }, 420)
      const keys = upNextOrderKeys(root)
      if (keys.join('|') !== previousOrder.join('|')) {
        navigator.vibrate?.(5)
        void saveUpNextOrder(keys, previousOrder)
      }
    }

    const handleMove = event => {
      if (pointerId !== event.pointerId) return
      latestX = event.clientX
      latestY = event.clientY
      if (!active) {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 14) {
          cancelTimer()
          pointerId = null
          releasePointerListeners()
        }
        return
      }
      if (event.cancelable) event.preventDefault()
      scheduleDragFrame()
    }
    surface.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return
      pointerId = event.pointerId
      startX = event.clientX
      startY = event.clientY
      latestX = event.clientX
      latestY = event.clientY
      window.addEventListener('pointermove', handleMove, { passive: false })
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
      timer = setTimeout(activate, 280)
    })
    row.addEventListener('click', event => {
      if (row.dataset.reorderSuppressClick !== 'true') return
      event.preventDefault()
      event.stopImmediatePropagation()
    }, true)
  })
}

window.bindUpNextReorder = bindUpNextReorder
