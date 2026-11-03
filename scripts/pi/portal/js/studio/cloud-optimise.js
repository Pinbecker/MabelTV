'use strict'

let studioOptimisePreview = null, studioOptimiseDraft = null, studioOptimiseGeneration = 0
function studioRenderOptimiseHero(preview) {
  const context = studioOptimiseDraft.cloudContext, single = context.titles.length === 1
  const title = single ? studioCloudTitle(context.titles[0]) : { title: `${context.titles.length} selected titles` }
  const hero = $('#studioOptimiseHero'); hero.replaceChildren()
  const poster = single && myTvViewingPosterUrl(title)
  if (poster) { const image = myTvArtworkImage(poster); image.alt = ''; hero.append(image) }
  else { const placeholder = document.createElement('span'); placeholder.className = 'studio-optimise-poster'; placeholder.append(librarySignalIcon('signal-film')); hero.append(placeholder) }
  const copy = document.createElement('div'), heading = document.createElement('h3'), meta = document.createElement('p')
  heading.textContent = title.title
  const runtime = preview.files.length === 1 && (preview.files[0].runtimeMinutes || title.runtime)
  meta.className = 'studio-optimise-meta'; meta.textContent = [title.year,
    runtime ? `${Math.floor(runtime / 60)}h ${Math.round(runtime % 60)}m` : '',
    preview.files.length > 1 ? `${preview.files.length} files` : ''].filter(Boolean).join(' · ')
  copy.append(heading, meta)
  if (title.overview) { const overview = document.createElement('p'); overview.className = 'studio-optimise-overview'; overview.textContent = title.overview; copy.append(overview) }
  hero.append(copy)
  const current = preview.files.reduce((total, file) => total + file.bytes, 0)
  $('#studioOptimiseCurrentSize').textContent = studioBytes(current)
  $('#studioOptimiseCurrentFormat').textContent = [...new Set(preview.files.map(file => file.type))].join(' + ')
  const estimated = preview.files.every(file => Number.isFinite(file.estimatedBytes) && file.estimatedBytes <= file.bytes)
    ? preview.files.reduce((total, file) => total + file.estimatedBytes, 0) : null
  $('#studioOptimiseNewSize').textContent = estimated === null ? 'Not calculated' : `≈ ${studioBytes(estimated)}`
  $('#studioOptimiseNewSize').classList.toggle('is-unknown', estimated === null)
  const savings = $('#studioOptimiseSavings'); savings.replaceChildren()
  const label = document.createElement('span'), value = document.createElement('strong')
  label.textContent = 'Estimated space saving'
  value.textContent = estimated === null ? 'Known after conversion' : `${studioBytes(current-estimated)} · ${Math.round((current-estimated)/current*100)}%`
  savings.append(label, value)
}
async function studioOpenCloudOptimise() {
  const button = $('#studioCloudOptimise'); button.disabled = true
  button.setAttribute('aria-busy', 'true'); button.innerHTML = '<span class="studio-spinner studio-inline-spinner" aria-hidden="true"></span> Preparing preview…'
  try {
    studioOptimiseDraft = studioDraft
    $('#studioOptimiseCompression').value = $('#studioCompression').value
    await studioRefreshOptimisePreview()
    if (studioDraft !== studioOptimiseDraft) return
    $('#studioOptimiseSheet details').open = false
    $('#studioOptimiseError').classList.add('hidden')
    closeLibrarySheet($('#studioDestinationSheet'), false)
    openLibrarySheet($('#studioOptimiseSheet'))
  } catch (error) { studioFailure(error) }
  finally { button.disabled = false; button.setAttribute('aria-busy', 'false'); button.textContent = 'Optimise iCloud version' }
}
async function studioRefreshOptimisePreview() {
  const generation = ++studioOptimiseGeneration, draft = studioOptimiseDraft
  studioOptimisePreview = null
  $('#studioOptimiseConfirm').disabled = true
  $('#studioOptimiseNewSize').textContent = 'Calculating…'
  const preview = await api('/api/studio/cloud/optimise-preview', { method: 'POST', body: JSON.stringify({
    ids: draft.sources.map(source => source.id), compression: $('#studioOptimiseCompression').value }) })
  if (generation !== studioOptimiseGeneration || studioDraft !== draft) return
  studioOptimisePreview = preview
  studioRenderOptimiseHero(preview)
  const files = $('#studioOptimiseFiles'); files.replaceChildren()
  for (const file of preview.files) {
      const row = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('span')
      name.textContent = file.name
      detail.textContent = `${file.type} · ${studioBytes(file.bytes)} → MP4 · up to 1080p · ` +
        (file.estimatedBytes ? `estimated size: ${studioBytes(file.estimatedBytes)}` : 'size estimate unavailable')
      row.append(name, detail); files.append(row)
    }
    $('#studioOptimiseOutput').textContent = preview.output
    $('#studioOptimiseEstimate').textContent = preview.estimateNote || 'Estimated size from the selected size target. The measured result can vary. The original is kept if the result does not meet the target.'
    $('#studioOptimiseError').classList.add('hidden')
  $('#studioOptimiseConfirm').disabled = false
}
$('#studioOptimiseCompression').onchange = () => void studioRefreshOptimisePreview().catch(error => {
  $('#studioOptimiseError').textContent = error.message; $('#studioOptimiseError').classList.remove('hidden')
})
function studioCancelCloudOptimise() {
  closeLibrarySheet($('#studioOptimiseSheet'), false)
  openLibrarySheet($('#studioDestinationSheet'))
}
$('#studioCloudOptimise').onclick = studioOpenCloudOptimise
$('#studioOptimiseConfirm').onclick = async () => {
  const button = $('#studioOptimiseConfirm'); button.disabled = true
  try {
    if (!studioOptimisePreview || studioDraft !== studioOptimiseDraft) throw new Error('Open this file again before confirming.')
    const sources = studioOptimisePreview.files.map(file => ({ type: 'cloud', id: file.id,
      bytes: file.bytes, modified: file.modified, remoteId: file.remoteId }))
    await api('/api/studio/jobs', { method: 'POST', body: JSON.stringify({ sources,
      destination: { kind: 'icloud', optimiseCloud: true, cloudCopies: 'optimised', saveCloud: true, compression: $('#studioOptimiseCompression').value },
      replaceCloudOriginal: true }) })
    closeLibrarySheet($('#studioOptimiseSheet'))
    studioState.selected.clear(); studioState.selecting = false
    studioSetTab('activity', { historyEntry: true }); await studioTick()
  } catch (error) { $('#studioOptimiseError').textContent = error.message; $('#studioOptimiseError').classList.remove('hidden') }
  finally { button.disabled = false }
}
$('#studioOptimiseCancel').onclick = studioCancelCloudOptimise
portalSheets.wire($('#studioOptimiseSheet'), { closeButton: $('#studioOptimiseClose'), close: studioCancelCloudOptimise })
