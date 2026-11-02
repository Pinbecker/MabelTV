'use strict'

let studioDraft = null, studioMatchTimer = null, studioAuth = null, studioAuthBusy = false

function openStudioDestination(sources, matchingJob = null, cloudContext = null) {
  studioDraft = { sources, match: cloudContext?.titles.length === 1 ? cloudContext.titles[0].metadata : null, matchingJob, cloudContext }
  $('#studioDestinationSummary').textContent = matchingJob ? matchingJob.title : sources.length === 1 ? sources[0].title : `${sources.length} items selected`
  $('#studioDestinationError').classList.add('hidden')
  $('#studioDestinationForm').reset()
  $('#studioMatchResults').replaceChildren()
  $('#studioMatchSelected').textContent = 'Studio will try an exact title match. Ambiguous matches can be chosen later.'
  $('#studioMatchQuery').value = matchingJob?.title || sources[0]?.title?.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ') || ''
  const channel = $('#studioChannel'); channel.replaceChildren()
  for (const item of library.channels || []) channel.add(new Option(`${item.number} · ${item.name}`, item.folder))
  const series = $('#studioSeries'); series.replaceChildren()
  for (const item of library.my_tv_series || []) series.add(new Option(item.title, item.id))
  series.add(new Option('Create a new show…', 'new'))
  if (sources[0]?.seriesTitle || sources[0]?.type === 'iplayer' && (sources.length > 1 || sources[0].series)) {
    $('#studioLibraryType').value = 'series'
    const existing = (library.my_tv_series || []).find(item => item.title.toLowerCase() === sources[0].title.toLowerCase())
    series.value = existing?.id || 'new'
    $('#studioNewSeries').value = sources[0].title
    $('#studioSeason').value = sources[0].series ?? 1
  }
  const nonVideo = sources.some(source => source.kind && source.kind !== 'video')
  if (nonVideo) throw new Error('Choose a film or TV video.')
  const fromCloud = sources.length > 0 && sources.every(source => source.type === 'cloud')
  $('#studioDestinationForm').classList.toggle('is-cloud-source', fromCloud)
  for (const input of $$('#studioDestinationForm input[name="studioDestination"]')) {
    input.disabled = fromCloud && input.value === 'icloud'
    if (input.value === 'icloud') input.closest('label').classList.toggle('hidden', fromCloud)
  }
  if (matchingJob) {
    $('#studioLibraryType').value = matchingJob.destination.kind === 'series' ? 'series' : 'film'
    $('#studioMatchQuery').value = matchingJob.title
  }
  studioSyncDestination()
  studioDestinationMetadata()
  openLibrarySheet($('#studioDestinationSheet'))
}
function studioSyncDestination() {
  const chosen = $('#studioDestinationForm input[name="studioDestination"]:checked').value
  const series = chosen === 'film' && $('#studioLibraryType').value === 'series'
  const multipleSeasons = new Set(studioDraft?.sources.map(source => source.series).filter(value => Number.isInteger(value))).size > 1
  $('#studioSeasonField').classList.toggle('hidden', multipleSeasons)
  $('#studioSeasonNotice').classList.toggle('hidden', !multipleSeasons)
  $('#studioLibraryTypeField').classList.toggle('hidden', chosen !== 'film')
  $('#studioChannelField').classList.toggle('hidden', chosen !== 'mabel')
  $('#studioSeriesFields').classList.toggle('hidden', !series)
  $('#studioNewSeriesField').classList.toggle('hidden', $('#studioSeries').value !== 'new')
  const fromCloud = studioDraft?.sources.length > 0 && studioDraft.sources.every(source => source.type === 'cloud')
  const cloudCopies = $('#studioDestinationForm input[name="studioCloudCopies"]:checked')?.value || 'original'
  $('#studioCloudCopiesField').classList.toggle('hidden', Boolean(studioDraft?.matchingJob))
  $('#studioCloudReplaceWarning').classList.toggle('hidden', !fromCloud || cloudCopies !== 'optimised' || Boolean(studioDraft?.matchingJob))
  $('#studioMatchSection').classList.toggle('hidden', !studioDraft?.matchingJob)
  $('#studioDestinationSubmit').textContent = studioDraft?.matchingJob ? 'Save match and retry metadata' : 'Add to queue'
}
async function studioFindMatch() {
  const query = $('#studioMatchQuery').value.trim()
  if (query.length < 2 || !studioDraft) return
  const draft = studioDraft
  const response = await api('/api/my-tv/discovery?q=' + encodeURIComponent(query))
  if (draft !== studioDraft || query !== $('#studioMatchQuery').value.trim()) return
  const type = $('#studioLibraryType').value === 'series' ? 'tv' : 'movie'
  const root = $('#studioMatchResults'); root.replaceChildren()
  for (const item of (response.results || []).filter(i => i.media_type === type).slice(0, 8)) {
    const button = document.createElement('button'); button.type = 'button'
    button.textContent = `${item.title}${item.year ? ` (${item.year})` : ''}`
    button.onclick = () => { studioDraft.match = item; $('#studioMatchSelected').textContent = `Selected: ${button.textContent}`; root.replaceChildren() }
    root.append(button)
  }
}
async function studioSubmitDestination(event) {
  event.preventDefault()
  const button = $('#studioDestinationSubmit'), draft = studioDraft
  button.disabled = true
  try {
    if (draft.matchingJob) {
      if (!draft.match) throw new Error('Choose the matching title first.')
      await api('/api/studio/action', { method: 'POST', body: JSON.stringify({ id: draft.matchingJob.id, action: 'metadata', match: draft.match }) })
    } else {
      const chosen = $('#studioDestinationForm input[name="studioDestination"]:checked').value
      const replaceOriginal = draft.sources.length > 0 && draft.sources.every(source => source.type === 'cloud') && $('#studioDestinationForm input[name="studioCloudCopies"]:checked').value === 'optimised'
      if (replaceOriginal && !draft.replaceCloudOriginal) { studioOpenReplaceWarning(); return }
      const destination = { kind: chosen === 'film' ? $('#studioLibraryType').value : chosen,
        prepare: chosen !== 'icloud' || $('#studioDestinationForm input[name="studioCloudCopies"]:checked').value !== 'original', keepOptimised: false,
        saveCloud: !$('#studioCloudCopiesField').classList.contains('hidden') }
      if (destination.saveCloud) destination.cloudCopies = $('#studioDestinationForm input[name="studioCloudCopies"]:checked').value
      if (chosen === 'mabel') destination.folder = $('#studioChannel').value
      if (destination.kind === 'series') {
        destination.series = $('#studioSeries').value === 'new' ? '' : $('#studioSeries').value
        destination.name = $('#studioNewSeries').value.trim()
        destination.season = Number($('#studioSeason').value)
        destination.preserveSeasons = new Set(draft.sources.flatMap(source => source.seasons || [source.series]).filter(value => Number.isInteger(value))).size > 1
      }
      await api('/api/studio/jobs', { method: 'POST', body: JSON.stringify({ sources: draft.sources, destination, replaceCloudOriginal: draft.replaceCloudOriginal === true, match: chosen === 'film' ? draft.match : null }) })
    }
    closeLibrarySheet($('#studioDestinationSheet'))
    studioState.selected.clear(); studioState.selecting = false
    studioSetTab('activity', { historyEntry: true })
    await studioTick()
  } catch (error) {
    $('#studioDestinationError').textContent = error.message
    $('#studioDestinationError').classList.remove('hidden')
  } finally { button.disabled = false }
}
function studioJobFailureMessage(error) {
  if (/programme may not be available|unsupported format|VPN\/VPS/i.test(error)) return 'BBC could not provide this programme. Check its current availability or retry another episode.'
  return String(error).split('\n')[0].replace(/^(?:ERROR|WARNING):\s*/i, '').slice(0, 220)
}
function renderStudioJobs() {
  const organiser = studioState.status?.organiser
  const cloud = (studioState.status?.cloudOperations || []).map(op => ({ ...op, id: 'cloud:' + op.id, cloudOperation: true, title: 'Delete from iCloud', destination: { label: 'iCloud Drive' }, percent: op.items?.length ? op.completed / op.items.length * 100 : 0, message: op.error || `${op.completed || 0} of ${op.items?.length || 1} items` }))
  if (organiser) cloud.push({ ...organiser, id: 'organiser', cloudOperation: true, destination: { label: 'iCloud' } })
  const jobs = [...(studioState.status?.jobs || []), ...cloud].filter(job => !['complete', 'cancelled'].includes(job.status) || job.status === 'complete' && job.metadataWarning).sort((a,b) => b.created-a.created), root = $('#studioJobs')
  const rows = new Map([...root.querySelectorAll('[data-studio-job]')].map(row => [row.dataset.studioJob, row]))
  $('#studioJobCount').textContent = `${jobs.length} item${jobs.length === 1 ? '' : 's'}`
  for (const [index, job] of jobs.entries()) {
    let row = rows.get(job.id)
    if (!row) { row = document.createElement('article'); row.className = 'studio-job'; row.dataset.studioJob = job.id }
    const version = JSON.stringify([job.status, job.percent, job.message, job.error, job.metadataWarning, job.displayStatus])
    if (row.dataset.studioVersion !== version) {
      row.dataset.studioVersion = version
      const status = job.status === 'complete' && job.metadataWarning ? 'Needs attention' : job.displayStatus || ({ queued: 'Queued', active: 'Working', complete: 'Complete', failed: 'Needs attention', paused: 'Paused', cancelled: 'Cancelled' }[job.status] || job.status)
      const warning = job.error || job.metadataWarning || ''
      const message = job.error ? studioJobFailureMessage(job.error) : job.message || 'Waiting for Studio'
      const destination = job.destination.kind === 'local' ? 'Download' : job.destination.label
      row.innerHTML = `<div class="studio-job-head"><strong>${escapeHtml(job.title)}</strong><small>${escapeHtml(status)}</small></div><p>${escapeHtml(destination)} · ${escapeHtml(message)}</p>${['active', 'queued'].includes(job.status) ? `<progress max="100" value="${Math.max(0, Math.min(100, Number(job.percent) || 0))}" aria-label="${escapeHtml(job.title)} progress"></progress>` : ''}${warning ? `<details class="studio-job-details"><summary>Details</summary><p>${escapeHtml(warning)}</p></details>` : ''}<div class="studio-job-actions"></div>`
      const actions = row.querySelector('.studio-job-actions')
      const add = (label, action) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'studio-text-button'; button.textContent = label
        button.onclick = async () => {
          button.disabled = true
          try { await api('/api/studio/action', { method: 'POST', body: JSON.stringify({ id: job.id, action }) }); await studioTick() }
          catch (error) { studioFailure(error) }
          finally { button.disabled = false }
        }
        actions.append(button)
      }
      if (!job.cloudOperation && ['queued', 'active'].includes(job.status)) add('Pause', 'pause')
      if (!job.cloudOperation && ['paused', 'failed'].includes(job.status)) add(job.status === 'failed' ? 'Retry' : 'Resume', 'resume')
      if (!job.cloudOperation && !['complete', 'cancelled'].includes(job.status)) add('Cancel', 'cancel')
      if (job.status === 'failed' && job.source?.type === 'iplayer' && /^[bmp][a-z0-9]{7}$/.test(job.source.pid)) {
        const link = document.createElement('a'); link.className = 'studio-text-button'; link.textContent = 'Check BBC iPlayer'
        link.href = 'https://www.bbc.co.uk/iplayer/episode/' + job.source.pid; link.target = '_blank'; link.rel = 'noopener noreferrer'
        actions.append(link)
      }
      if (job.status === 'complete' && job.metadataWarning && ['film', 'series'].includes(job.destination.kind)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'studio-text-button'; button.textContent = job.matchedTitle ? 'Retry details' : 'Match title'
        button.onclick = () => { if (job.matchedTitle) void api('/api/studio/action', { method: 'POST', body: JSON.stringify({ id: job.id, action: 'metadata', match: job.matchedTitle }) }).then(studioTick).catch(studioFailure); else openStudioDestination([], job) }; actions.append(button)
      }
    }
    if (root.children[index] !== row) root.insertBefore(row, root.children[index] || null)
    rows.delete(job.id)
  }
  for (const row of rows.values()) row.remove()
  if (!jobs.length && !root.querySelector('.studio-jobs-empty')) root.append(portalEmptyState({ className: 'studio-jobs-empty', title: 'All caught up', message: 'Choose something from iCloud or BBC iPlayer. Its progress will appear here.' }))
  if (jobs.length) root.querySelector('.studio-jobs-empty')?.remove()
}
async function studioStartAuth() {
  if (location.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(location.hostname)) {
    notice('Open your secure public portal address to connect iCloud.', true)
    return
  }
  closeLibrarySheet($('#studioConnectionSheet'), false)
  openLibrarySheet($('#studioAuthSheet'))
  $('#studioAuthAnswer').value = ''
  $('#studioAuthAnswer').disabled = true
  $('#studioAuthHelp').textContent = 'Preparing a private Apple sign-in…'
  $('#studioAuthContinue').disabled = true
  $('#studioAuthError').classList.add('hidden')
  try { studioApplyAuth(await api('/api/studio/cloud/auth', { method: 'POST', body: JSON.stringify({ action: 'start' }) })) }
  catch (error) { $('#studioAuthError').textContent = error.message; $('#studioAuthError').classList.remove('hidden') }
}
function studioApplyAuth(result) {
  studioAuth = result
  if (result.complete) {
    closeLibrarySheet($('#studioAuthSheet'))
    studioAuth = null
    void studioTick().catch(studioFailure)
    notice('iCloud is connected. Your catalogue is refreshing.')
    return
  }
  $('#studioAuthTitle').textContent = result.field === 'apple_id' ? 'Connect iCloud' : result.password ? 'Your Apple password' : 'Verify your account'
  $('#studioAuthHelp').textContent = result.help
  $('#studioAuthLabel').firstChild.textContent = result.help + ' '
  const input = $('#studioAuthAnswer')
  input.value = ''; input.disabled = false
  input.type = result.password || result.field !== 'apple_id' ? 'password' : 'email'
  input.inputMode = result.field === 'apple_id' ? 'email' : result.password ? 'text' : 'numeric'
  input.autocomplete = result.field === 'apple_id' ? 'username' : result.password ? 'current-password' : 'one-time-code'
  $('#studioAuthContinue').disabled = false
  $('#studioAuthError').textContent = result.error || ''
  $('#studioAuthError').classList.toggle('hidden', !result.error)
}
$('#studioDestinationForm').onsubmit = studioSubmitDestination
for (const input of $$('#studioDestinationForm input[name="studioDestination"]')) input.onchange = studioSyncDestination
for (const input of $$('#studioDestinationForm input[name="studioCloudCopies"]')) input.onchange = () => { if (studioDraft) studioDraft.replaceCloudOriginal = false; studioSyncDestination() }
for (const id of ['studioLibraryType', 'studioSeries']) $('#' + id).onchange = studioSyncDestination
$('#studioMatchQuery').oninput = () => { clearTimeout(studioMatchTimer); studioMatchTimer = setTimeout(() => void studioFindMatch().catch(studioFailure), 350) }
$('#studioCloudConnect').onclick = () => void studioStartAuth()
$('#studioAuthForm').onsubmit = async event => {
  event.preventDefault()
  if (studioAuthBusy || !studioAuth) return
  const answer = $('#studioAuthAnswer').value
  $('#studioAuthAnswer').value = ''; $('#studioAuthContinue').disabled = true
  studioAuthBusy = true
  try { studioApplyAuth(await api('/api/studio/cloud/auth', { method: 'POST', body: JSON.stringify({ id: studioAuth.id, answer }) })) }
  catch (error) { $('#studioAuthError').textContent = error.message; $('#studioAuthError').classList.remove('hidden'); $('#studioAuthContinue').disabled = false }
  finally { studioAuthBusy = false }
}
for (const [sheet, close] of [['studioDestinationSheet', 'studioDestinationClose'], ['studioAuthSheet', 'studioAuthClose']]) {
  portalSheets.wire($('#' + sheet), { closeButton: $('#' + close), close: () => {
    if (sheet === 'studioAuthSheet' && studioAuth && !studioAuth.complete) void api('/api/studio/cloud/auth', { method: 'POST', body: JSON.stringify({ action: 'cancel', id: studioAuth.id }) }).catch(() => {})
    closeLibrarySheet($('#' + sheet))
  } })
}
