'use strict'

// A bounded, two-scene compositor. Whole photographs move inside fitted slots;
// the soundtrack/video lifecycle remains owned by memories-player.js.
function createFamilyMemoryPresentation(stage, onError) {
  const layers = []
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  let paused = false
  const animate = (layer, element, frames, options) => {
    if (reducedMotion) { Object.assign(element.style, frames.at(-1)); return null }
    const animation = element.animate(frames, { fill: 'both', ...options })
    layer.animations.push(animation)
    if (paused) animation.pause()
    return animation
  }
  const remove = layer => {
    layer.animations.forEach(animation => animation.cancel())
    layer.element.remove()
    const index = layers.indexOf(layer)
    if (index >= 0) layers.splice(index, 1)
  }
  const place = layer => {
    const width = stage.clientWidth, height = stage.clientHeight
    if (!width || !height) return
    const boxes = width < height ? layer.scene.portrait_frames : layer.scene.frames
    layer.photos.forEach(({ slot, picture, asset }, index) => {
      const count = layer.photos.length
      const box = boxes?.[index] || { x: .05 + index * .9 / count, y: .07, width: .9 / count - (count > 1 ? .025 : 0), height: .86 }
      Object.assign(slot.style, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` })
      const ratio = Number(asset.width || 1200) / Math.max(1, Number(asset.height || 800))
      const fitted = Math.min(width * box.width, height * box.height * ratio) * .988
      picture.style.width = `${fitted}px`; picture.style.height = `${fitted / ratio}px`
    })
  }
  const observer = new ResizeObserver(() => layers.forEach(place))
  observer.observe(stage)
  return {
    show(scene, video = null) {
      while (layers.length > 1) remove(layers[0])
      const previous = layers.at(-1)
      const element = document.createElement('div')
      element.className = 'family-memory-device-frame is-current'
      element.dataset.layout = scene.layout || (scene.items.length > 1 ? 'duet' : 'spotlight')
      const layer = { element, scene, photos: [], animations: [] }
      const ambient = document.createElement('img'); ambient.className = 'family-memory-ambient'
      ambient.alt = ''; ambient.src = scene.items[0].artwork || (scene.items[0].kind === 'video' ? '' : scene.items[0].source); element.append(ambient)
      for (const [index, asset] of scene.items.slice(0, 3).entries()) {
        const slot = document.createElement('div'); slot.className = 'family-memory-photo-slot'
        const picture = document.createElement('figure'); picture.className = 'family-memory-photo'
        const isVideo = scene.kind === 'video' && index === Number(scene.video_index || 0)
        const image = document.createElement('img'); image.src = isVideo ? asset.artwork || '' : asset.source; image.alt = asset.title || 'Family memory'
        image.onerror = () => { if (layers.at(-1) === layer) onError() }
        picture.append(image)
        if (isVideo && video) { picture.append(video); video.controls = false }
        slot.append(picture); element.append(slot)
        layer.photos.push({ slot, picture, asset })
        const box = scene.frames?.[index] || {}
        const tilt = Number(box.tilt || 0), direction = Number(box.direction || 1)
        animate(layer, picture, [
          { transform: `translate(${-3 * direction}px,${index % 2 ? 3 : -3}px) rotate(${tilt}deg) scale(.985)` },
          { transform: `translate(${3 * direction}px,${index % 2 ? -3 : 3}px) rotate(${tilt * .65}deg) scale(.997)` },
        ], { duration: Math.max(5000, Number(scene.seconds || 10) * 1000), easing: 'ease-in-out' })
        animate(layer, slot, [{ opacity: 0, transform: `translateY(${20 + index * 6}px)` },
          { opacity: 1, transform: 'translateY(0)' }], { duration: 900, delay: index * 130, easing: 'cubic-bezier(.2,.7,.25,1)' })
      }
      if (scene.caption) {
        const caption = document.createElement('span'); caption.className = 'family-memory-scene-date'
        caption.textContent = scene.caption; element.append(caption)
      }
      if (previous) {
        previous.element.classList.remove('is-current')
        previous.animations.forEach(animation => animation.pause())
        const end = scene.transition === 'glide' ? 'translateX(-40px)' : scene.transition === 'rise' ? 'translateY(-28px)' : 'translate(0)'
        const exit = animate(previous, previous.element, [{ opacity: 1, transform: 'translate(0)' },
          { opacity: 0, transform: end }], { duration: 1200, easing: 'ease-in-out' })
        if (exit) exit.finished.then(() => remove(previous)).catch(() => {})
        else remove(previous)
      }
      const from = scene.transition === 'glide' ? 'translateX(40px)' : scene.transition === 'rise' ? 'translateY(28px)' : 'translate(0)'
      animate(layer, element, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'translate(0)' }],
        { duration: 1200, easing: 'ease-in-out' })
      layers.push(layer); stage.append(element); place(layer)
    },
    pause(value) {
      paused = value
      layers.forEach(layer => layer.animations.forEach(animation => {
        if (value) {
          const position = animation.currentTime
          animation.pause()
          if (position !== null) animation.currentTime = position
        }
        else if (layer.element.classList.contains('is-current') || animation.effect.target === layer.element) animation.play()
      }))
    },
    clear() { while (layers.length) remove(layers[0]) },
    destroy() { observer.disconnect(); this.clear() },
  }
}
