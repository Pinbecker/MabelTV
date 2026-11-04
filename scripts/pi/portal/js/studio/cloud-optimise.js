'use strict'

let studioOptimisePreview = null, studioOptimiseDraft = null, studioOptimiseGeneration = 0
function studioRenderOptimiseHero(preview) {
  const context = studioOptimiseDraft.cloudContext, single = context.titles.length === 1
  const title = single ? studioCloudTitle(context.titles[0]) : { title: `${context.titles.length} selected titles` }
  const hero = $('#studioOptimiseHero'); hero.replaceChildren()
  const art = document.createElement('span'); art.className = 'studio-media-art'; studioMediaArt(art, single ? title : null)
  const copy = document.createElement('div'); copy.className = 'studio-media-copy'
  const overline = document.createElement('p'); overline.className = 'section-kicker'; overline.textContent = 'Optimise iCloud copy'
  const heading = document.createElement('h2'); heading.id = 'studioOptimiseTitle'; heading.textContent = title.title
  const meta = document.createElement('p')
  const runtime = preview.files.length === 1 && (preview.files[0].runtimeMinutes || title.runtime)
  meta.textContent = [title.year, runtime ? Math.floor(runtime / 60) + 'h ' + Math.round(runtime % 60) + 'm' : '', preview.files.length > 1 ? preview.files.length + ' files' : ''].filter(Boolean).join(' · ')
  copy.append(overline, heading, meta)
  if (title.overview) { const summary = document.createElement('p'); summary.className = 'studio-optimise-overview'; summary.textContent = title.overview; copy.append(summary) }
  hero.append(art, copy)
  const current = preview.files.reduce((total, file) => total + file.bytes, 0)
  $('#studioOptimiseCurrentSize').textContent = studioBytes(current)
  $('#studioOptimiseCurrentFormat').textContent = [...new Set(preview.files.map(file => file.type))].join(' + ')
  const estimated = preview.files.every(file => Number.isFinite(file.estimatedBytes) && file.estimatedBytes <= file.bytes)
    ? preview.files.reduce((total, file) => total + file.estimatedBytes, 0) : null
  $('#studioOptimiseNewSize').textContent = estimated === null ? 'Not calculated' : `≈ ${studioBytes(estimated)}`
  $('#studioOptimiseNewSize').classList.toggle('is-unknown', estimated === null)
  const savings = $('#studioOptimiseSavings'); savings.replaceChildren()
  const label = document.createElement('span'), value = document.createElement('strong')
  label.textContent = 'Space saved'
  value.textContent = estimated === null ? 'Pending' : studioBytes(current-estimated)
  savings.append(label, value)
  if (estimated !== null) { const percent = document.createElement('span'); percent.className = 'studio-chip'; percent.textContent = Math.round((current-estimated)/current*100) + '%'; savings.append(percent) }
}
async function studioOpenCloudOptimise() {
  const button = $('#studioCloudOptimise'); button.disabled = true
  button.setAttribute('aria-busy', 'true')
  try {
    studioOptimiseDraft = studioDraft
    $('#studioOptimiseCompression').value = $('#studioCompression').value
    $('#studioOptimiseSheet details').open = false
    $('#studioOptimiseError').classList.add('hidden')
    closeLibrarySheet($('#studioDestinationSheet'), false)
    closeLibrarySheet($('#studioActionsSheet'), false)
    openLibrarySheet($('#studioOptimiseSheet'))
    await studioRefreshOptimisePreview()
  } catch (error) { $('#studioOptimiseError').textContent = error.message; $('#studioOptimiseError').classList.remove('hidden') }
  finally { button.disabled = false; button.setAttribute('aria-busy', 'false'); studioSyncSelects() }
}
async function studioRefreshOptimisePreview() {
  const generation = ++studioOptimiseGeneration, draft = studioOptimiseDraft
  studioOptimisePreview = null
  $('#studioOptimiseConfirm').disabled = true
  $('#studioOptimiseNewSize').replaceChildren()
  const spinner = document.createElement('span'); spinner.className = 'studio-spinner studio-inline-spinner'; spinner.setAttribute('aria-label', 'Calculating size')
  $('#studioOptimiseNewSize').append(spinner, document.createTextNode(' Calculating…'))
  $('#studioOptimiseSavings').replaceChildren()
  $('#studioOptimiseFiles').replaceChildren()
  $('#studioOptimiseOutput').textContent = ''
  $('#studioOptimiseEstimate').textContent = ''
  $('#studioOptimiseError').classList.add('hidden')
  let preview
  try {
    preview = await api('/api/studio/cloud/optimise-preview', { method: 'POST', body: JSON.stringify({
      ids: draft.sources.map(source => source.id), compression: $('#studioOptimiseCompression').value }) })
  } catch (error) {
    if (generation !== studioOptimiseGeneration || studioDraft !== draft) return
    $('#studioOptimiseNewSize').textContent = 'Unavailable'
    $('#studioOptimiseError').textContent = error.message; $('#studioOptimiseError').classList.remove('hidden')
    return
  }
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
  studioSyncSelects()
}
$('#studioOptimiseCompression').onchange = () => void studioRefreshOptimisePreview().catch(error => {
  $('#studioOptimiseError').textContent = error.message; $('#studioOptimiseError').classList.remove('hidden')
})
function studioCancelCloudOptimise() {
  studioOptimiseGeneration++; studioOptimisePreview = null
  closeLibrarySheet($('#studioOptimiseSheet'), false)
  openLibrarySheet($('#studioActionsSheet'))
}
$('#studioCloudOptimise').onclick = studioOpenCloudOptimise
$('#studioOptimiseConfirm').onclick = async () => {
  const button = $('#studioOptimiseConfirm'); button.disabled = true
  try {
    if (!studioOptimisePreview || studioDraft !== studioOptimiseDraft) throw new Error('Open this file again before confirming.')
    const risky = studioOptimisePreview.files.some(file => file.risky)
    if (risky && !await portalConfirm({ title: 'Compress this copy again?', message: 'This file is already heavily compressed. Further compression may reduce picture quality.', confirmLabel: 'Compress anyway' })) return
    const sources = studioOptimisePreview.files.map(file => ({ type: 'cloud', id: file.id,
      bytes: file.bytes, modified: file.modified, remoteId: file.remoteId }))
    await api('/api/studio/jobs', { method: 'POST', body: JSON.stringify({ sources,
      destination: { kind: 'icloud', optimiseCloud: true, cloudCopies: 'optimised', saveCloud: true, allowRisk: risky, compression: $('#studioOptimiseCompression').value },
      replaceCloudOriginal: true }) })
    closeLibrarySheet($('#studioOptimiseSheet'))
    studioState.selected.clear(); studioState.selecting = false
    studioSetTab('activity', { historyEntry: true }); await studioTick()
  } catch (error) { $('#studioOptimiseError').textContent = error.message; $('#studioOptimiseError').classList.remove('hidden') }
  finally { button.disabled = !studioOptimisePreview }
}
$('#studioOptimiseCancel').onclick = studioCancelCloudOptimise
portalSheets.wire($('#studioOptimiseSheet'), { closeButton: $('#studioOptimiseClose'), close: studioCancelCloudOptimise })
