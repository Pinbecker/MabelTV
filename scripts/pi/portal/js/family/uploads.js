'use strict'

let familyUploadRunning = false

async function uploadFamilyFiles(files, target) {
  if (!files.length) return
  if (familyUploadRunning) throw new Error('Let the current family upload finish first.')
  familyUploadRunning = true
  const panel = $('#familyUploadProgress')
  panel.classList.remove('hidden')
  let total = files.reduce((sum, file) => sum + file.size, 0)
  let received = 0
  try {
    if (target.media_kind === 'audio' && files.length > 1) {
      panel.querySelector('strong').textContent = 'Preparing your story chapters'
      panel.querySelector('span').textContent = 'Putting the chapter files in order…'
      panel.querySelector('progress').removeAttribute('value')
      files = [await packageStoryAudio(files, target.title)]
      total = files[0].size; panel.querySelector('progress').value = 0
    }
    for (const [index, file] of files.entries()) {
      const kind = target.media_kind || (file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name) ? 'photo' : 'video')
      panel.querySelector('strong').textContent = `Uploading ${index + 1} of ${files.length}`
      panel.querySelector('span').textContent = file.name
      let saved = await api('/api/family-media/uploads', { method: 'POST', body: JSON.stringify({
        ...target, media_kind: kind, file_name: file.name, size: file.size,
        title: target.title || file.name.replace(/\.[^.]+$/, ''), source_id: familyUploadSourceId(),
      }) })
      let offset = Number(saved.offset || 0)
      if (saved.status === 'error') {
        await api(`/api/uploads/${saved.id}`, { method: 'POST', body: JSON.stringify({ action: 'retry' }) })
        saved = await api(`/api/uploads/${saved.id}`)
      }
      while (offset < file.size && !saved.complete && !saved.processing) {
        if (saved.transfer_state && saved.transfer_state !== 'active') {
          panel.querySelector('span').textContent = `${file.name} · waiting for the current upload`
          await new Promise(resolve => setTimeout(resolve, 1200))
          saved = await api(`/api/uploads/${saved.id}`)
          if (saved.status === 'error') throw new Error(saved.error || 'Upload failed')
          continue
        }
        const end = Math.min(file.size, offset + 8 * 1024 * 1024)
        const identity = saved.id
        try { saved = { id: identity, ...await uploadChunk(identity, offset, file.slice(offset, end), end === file.size) } }
        catch (error) {
          const actual = await api(`/api/uploads/${identity}`)
          if (Number(actual.offset) <= offset && !actual.complete && !actual.processing) throw error
          saved = actual
        }
        offset = Number(saved.offset || 0)
        panel.querySelector('progress').value = Math.round((received + offset) * 100 / total)
      }
      received += file.size
      await loadFamilyLibrary()
    }
    panel.querySelector('strong').textContent = 'Uploaded · preparing on the Pi'
    panel.querySelector('span').textContent = 'Your files will appear as they finish. You can carry on using the portal.'
    panel.querySelector('progress').value = 100
    setTimeout(() => { if (!familyUploadRunning) panel.classList.add('hidden') }, 5000)
  } catch (error) {
    panel.querySelector('strong').textContent = 'Upload interrupted'
    panel.querySelector('span').textContent = `${error.message}. Choose the same files to resume.`
    throw error
  } finally { familyUploadRunning = false }
}

function familyUploadSourceId() {
  let value = sessionStorage.getItem('mabel-family-upload-source')
  if (!value) {
    value = portalRandomUuid(); sessionStorage.setItem('mabel-family-upload-source', value)
  }
  return value
}
