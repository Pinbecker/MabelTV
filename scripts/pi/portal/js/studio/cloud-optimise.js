'use strict'

let studioOptimisePreview = null, studioOptimiseDraft = null
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
  // estimatedBytes is a duration/maxrate guide, not a content-based prediction.
  // Keep it in file details rather than presenting it as the replacement size.
  $('#studioOptimiseNewSize').textContent = 'Not calculated'
  $('#studioOptimiseNewSize').classList.add('is-unknown')
  const savings = $('#studioOptimiseSavings'); savings.replaceChildren()
  const label = document.createElement('span'), value = document.createElement('strong')
  label.textContent = 'Space saving'
  value.textContent = 'Known after conversion'
  savings.append(label, value)
}
async function studioOpenCloudOptimise() {
  const button = $('#studioCloudOptimise'); button.disabled = true
  button.setAttribute('aria-busy', 'true'); button.innerHTML = '<span class="studio-spinner studio-inline-spinner" aria-hidden="true"></span> Preparing preview…'
  try {
    studioOptimiseDraft = studioDraft
    const preview = await api('/api/studio/cloud/optimise-preview', {
      method: 'POST', body: JSON.stringify({ ids: studioDraft.sources.map(source => source.id) }) })
    if (studioDraft !== studioOptimiseDraft) return
    studioOptimisePreview = preview
    studioRenderOptimiseHero(preview)
    $('#studioOptimiseSheet details').open = false
    const files = $('#studioOptimiseFiles'); files.replaceChildren()
    for (const file of preview.files) {
      const row = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('span')
      name.textContent = file.name
      detail.textContent = `${file.type} · ${studioBytes(file.bytes)} → MP4 · up to 1080p · ` +
        (file.estimatedBytes ? `profile size guide: ${studioBytes(file.estimatedBytes)}` : 'profile size guide unavailable')
      row.append(name, detail); files.append(row)
    }
    $('#studioOptimiseOutput').textContent = preview.output
    $('#studioOptimiseEstimate').textContent = 'The profile size guide uses the catalogue duration and maximum encoding bitrate. It is not a prediction of the output size. Conversion can produce a larger file; that result is discarded and the original is kept.'
    $('#studioOptimiseError').classList.add('hidden')
    closeLibrarySheet($('#studioDestinationSheet'), false)
    openLibrarySheet($('#studioOptimiseSheet'))
  } catch (error) { studioFailure(error) }
  finally { button.disabled = false; button.setAttribute('aria-busy', 'false'); button.textContent = 'Optimise iCloud version' }
}
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
      destination: { kind: 'icloud', optimiseCloud: true, cloudCopies: 'optimised', saveCloud: true },
      replaceCloudOriginal: true }) })
    closeLibrarySheet($('#studioOptimiseSheet'))
    studioState.selected.clear(); studioState.selecting = false
    studioSetTab('activity', { historyEntry: true }); await studioTick()
  } catch (error) { $('#studioOptimiseError').textContent = error.message; $('#studioOptimiseError').classList.remove('hidden') }
  finally { button.disabled = false }
}
$('#studioOptimiseCancel').onclick = studioCancelCloudOptimise
portalSheets.wire($('#studioOptimiseSheet'), { closeButton: $('#studioOptimiseClose'), close: studioCancelCloudOptimise })
