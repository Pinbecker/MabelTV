'use strict'

let studioDraft = null, studioMatchTimer = null, studioAuth = null, studioAuthBusy = false

function openStudioDestination(sources, matchingJob = null, cloudContext = null) {
  const fromCloud = sources.length > 0 && sources.every(source => source.type === 'cloud')
  studioDraft = { sources, targetCollections: {}, match: cloudContext?.titles.length === 1 ? cloudContext.titles[0].metadata : null, matchingJob, cloudContext }
  studioState.episodeDraft = null
  $('#studioDestinationTitle').textContent = matchingJob ? matchingJob.title : sources.length === 1 ? sources[0].title : `${sources.length} items selected`
  $('#studioDestinationError').classList.add('hidden')
  $('#studioDestinationForm').reset()
  $(`#studioDestinationForm input[name="studioCloudCopies"][value="${fromCloud ? 'original' : 'optimised'}"]`).checked = true
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
    const seriesTitle = sources[0].seriesTitle || sources[0].title
    const existing = (library.my_tv_series || []).find(item => item.title.toLowerCase() === seriesTitle.toLowerCase())
    series.value = existing?.id || 'new'
    $('#studioNewSeries').value = seriesTitle
    $('#studioSeason').value = sources[0].series ?? 1
  }
  const nonVideo = sources.some(source => source.kind && source.kind !== 'video')
  if (nonVideo) throw new Error('Choose a film or TV video.')
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
  void studioLoadVersions(studioDraft)
}
function studioSyncDestination() {
  const chosen = $('#studioDestinationForm input[name="studioDestination"]:checked').value
  const series = chosen === 'film' && $('#studioLibraryType').value === 'series'
  const multipleSeasons = new Set(studioDraft?.sources.flatMap(source => source.seasons || [source.series]).filter(value => Number.isInteger(value))).size > 1
  $('#studioSeasonField').classList.toggle('hidden', multipleSeasons)
  $('#studioSeasonNotice').classList.toggle('hidden', !multipleSeasons)
  $('#studioLibraryTypeField').classList.toggle('hidden', chosen !== 'film')
  $('#studioChannelField').classList.toggle('hidden', chosen !== 'mabel')
  $('#studioSeriesFields').classList.toggle('hidden', !series)
  $('#studioNewSeriesField').classList.toggle('hidden', $('#studioSeries').value !== 'new' || !series)
  const fromCloud = studioDraft?.sources.length > 0 && studioDraft.sources.every(source => source.type === 'cloud')
  const cloudCopies = $('#studioDestinationForm input[name="studioCloudCopies"]:checked')?.value || 'original'
  $('#studioCloudCopiesField').classList.toggle('hidden', Boolean(studioDraft?.matchingJob))
  const originalOnly = chosen === 'icloud' && cloudCopies === 'original'
  const recovering = Boolean(studioDraft?.originalInfo)
  $('#studioDestinationHeading').textContent = recovering ? 'Download original' : chosen === 'icloud' ? 'Save to iCloud' : 'Send to TV'
  $('#studioOriginalModeField').classList.toggle('hidden', !recovering)
  $('#studioOriginalNote').classList.toggle('hidden', !recovering)
  $('#studioCompressionField').classList.toggle('hidden', Boolean(studioDraft?.matchingJob) || originalOnly)
  $('#studioOriginalQuality').classList.toggle('hidden', !originalOnly || Boolean(studioDraft?.matchingJob))
  $('#studioCloudCopiesLabel').textContent = chosen === 'icloud' ? 'Version' : 'iCloud copy'
  $('#studioCompression').dataset.studioDetail = chosen === 'mabel' ? 'Up to 720p' : 'Up to 1080p'
  const collections = library.my_tv_folders || []
  const collection = $('#studioTargetCollection')
  const scope = 'My TV collection'
  $('#studioTargetCollectionField label strong').textContent = scope
  collection.dataset.studioOptions = scope
  collection.replaceChildren(new Option('Unfiled', ''), ...collections.map(name => new Option(name, name)), new Option('New collection…', '__new__'))
  collection.value = studioDraft?.targetCollections[chosen] || ''
  $('#studioTargetCollectionField').classList.toggle('hidden', chosen !== 'film' || Boolean(studioDraft?.matchingJob))
  $('#studioNewCollectionField').classList.toggle('hidden', chosen !== 'film' || collection.value !== '__new__')
  studioSyncSelects()
  studioUpdateCompressionEstimate()
  $('#studioCloudReplaceWarning').classList.toggle('hidden', !fromCloud || cloudCopies !== 'optimised' || Boolean(studioDraft?.matchingJob))
  $('#studioMatchSection').classList.toggle('hidden', !studioDraft?.matchingJob)
  $('#studioDestinationSubmitLabel').textContent = studioDraft?.matchingJob ? 'Save title match' : chosen === 'icloud' ? 'Save to iCloud' : chosen === 'mabel' ? 'Send to Mabel TV' : 'Send to My TV'
  if (recovering) {
    $('#studioCompressionField').classList.add('hidden'); $('#studioCloudCopiesField').classList.add('hidden')
    $('#studioOriginalQuality').classList.remove('hidden')
    $('#studioOriginalQuality .studio-quality-original').firstChild.textContent = chosen === 'icloud' ? 'Original' : 'Pi-compatible copy'
    $('#studioOriginalQuality small').textContent = chosen === 'icloud' ? 'Unchanged source' : 'High quality · destination limits'
    $('#studioDestinationSubmitLabel').textContent = 'Download original'
  }
}
function studioUpdateCompressionEstimate() { studioSyncSelects() }
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
    if (draft.cloudContext && !draft.originalInfo && !draft.presenceReady) throw new Error('Wait for the Pi copy check, or retry it.')
    if (!draft.originalInfo && draft.sources.length && draft.sources.every(source => source.existingCopy?.mode === 'keep')) {
      closeLibrarySheet($('#studioDestinationSheet')); notice('Existing TV copies kept.'); return
    }
    if (draft.matchingJob) {
      if (!draft.match) throw new Error('Choose the matching title first.')
      await api('/api/studio/action', { method: 'POST', body: JSON.stringify({ id: draft.matchingJob.id, action: 'metadata', match: draft.match }) })
    } else {
      const chosen = $('#studioDestinationForm input[name="studioDestination"]:checked').value
      if (chosen === 'film' && $('#studioTargetCollection').value === '__new__') throw new Error('Create the collection first.')
      const replaceOriginal = !draft.originalInfo && draft.sources.length > 0 && draft.sources.every(source => source.type === 'cloud') && $('#studioDestinationForm input[name="studioCloudCopies"]:checked').value === 'optimised'
      if (replaceOriginal && !draft.replaceCloudOriginal) { studioOpenReplaceWarning(); return }
      const destination = { kind: chosen === 'film' ? $('#studioLibraryType').value : chosen,
        compression: $('#studioCompression').value === 'compatible' ? 'compact' : $('#studioCompression').value,
        preparationIntent: $('#studioCompression').value === 'compatible' ? 'compatible' : 'compress',
        collection: chosen === 'film' ? $('#studioTargetCollection').value : '',
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
      if (draft.originalInfo) {
        const mode = $('#studioOriginalMode').value
        if (mode === 'replace' && !await portalConfirm({ title: 'Replace existing copy?', message: `Replace the existing ${chosen === 'icloud' ? 'iCloud' : 'TV'} version of ${draft.originalInfo.title} after the new copy is verified.`, confirmLabel: 'Download and replace' })) return
        await api('/api/studio/download-originals', { method: 'POST', body: JSON.stringify({ ids: draft.originalInfo.items.map(item => item.deliveryId), destination, mode, confirmReplace: mode === 'replace' }) })
      } else {
        if (draft.sources.some(source => source.existingCopy?.mode === 'replace') && !await portalConfirm({ title: 'Replace the selected TV copy?', message: 'The existing copy stays until the new one is verified.', confirmLabel: 'Replace copy' })) return
        await api('/api/studio/jobs', { method: 'POST', body: JSON.stringify({ sources: draft.sources, destination, replaceCloudOriginal: draft.replaceCloudOriginal === true, match: chosen === 'film' ? draft.match : null }) })
      }
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
$('#studioCompression').onchange = studioUpdateCompressionEstimate
$('#studioTargetCollection').onchange = () => {
  const chosen = $('#studioDestinationForm input[name="studioDestination"]:checked').value
  if ($('#studioTargetCollection').value !== '__new__') studioDraft.targetCollections[chosen] = $('#studioTargetCollection').value
  $('#studioNewCollectionField').classList.toggle('hidden', $('#studioTargetCollection').value !== '__new__')
  if ($('#studioTargetCollection').value === '__new__') $('#studioNewCollectionName').focus({ preventScroll: true })
  studioSyncSelects()
}
$('#studioMatchQuery').oninput = () => {
  clearTimeout(studioMatchTimer)
  if (!$('#studioMatchQuery').value.trim()) { $('#studioMatchResults').replaceChildren(); return }
  studioMatchTimer = setTimeout(() => void studioFindMatch().catch(studioFailure), 350)
}
$('#studioMatchQuery').onkeydown = event => {
  if (event.key !== 'Enter') return
  event.preventDefault(); clearTimeout(studioMatchTimer)
  void studioFindMatch().catch(studioFailure)
}
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
