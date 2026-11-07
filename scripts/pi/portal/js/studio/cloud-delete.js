'use strict'

let studioDeleteContext = null, studioDeleteVersion = '', studioDeleteFiles = []
function studioConfirmCloudDelete() {
  studioDeleteContext = studioDraft.cloudContext
  const list = $('#studioCloudDeleteNames'); list.replaceChildren()
  studioDeleteFiles = [...new Map(studioDeleteContext.files.map(file => [file.id, file])).values()]
  for (const file of studioDeleteFiles) {
    const row = document.createElement('li'), label = document.createElement('label')
    label.className = 'studio-episode'
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(file.id)}"><span><strong>${escapeHtml(file.name || file.path?.split('/').pop() || 'Video')}</strong><small>${escapeHtml(studioBytes(file.bytes))} · ${escapeHtml((file.extension || file.path?.split('.').pop() || '').replace('.', '').toUpperCase())}</small></span>`
    label.querySelector('input').checked = studioDeleteFiles.length === 1
    label.querySelector('input').onchange = studioDeleteSelection
    row.append(label); list.append(row)
  }
  studioDeleteSelection()
  $('#studioCloudDeleteError').classList.add('hidden')
  closeLibrarySheet($('#studioDestinationSheet'), false)
  closeLibrarySheet($('#studioActionsSheet'), false)
  openLibrarySheet($('#studioCloudDeleteSheet'))
}
function studioDeleteSelection() {
  const count = $$('#studioCloudDeleteNames input:checked').length
  $('#studioCloudDeleteConfirm').disabled = !count
  $('#studioCloudDeleteConfirm').textContent = count ? `Delete ${count} ${count === 1 ? 'file' : 'files'}` : 'Choose a version'
}
function studioCancelCloudDelete() {
  closeLibrarySheet($('#studioCloudDeleteSheet'), false)
  openLibrarySheet($('#studioActionsSheet'))
}
function studioCloudOperationsStatus(operations) {
  const latest = [...(operations || [])].sort((a, b) => b.created - a.created)[0]
  if (!latest) return
  const version = `${latest.id}:${latest.status}`
  $('#studioManagerProgress').textContent = latest.status === 'complete' ? 'Deleted from iCloud.'
    : latest.status === 'failed' ? latest.error : `Deleting from iCloud · ${latest.completed || 0}/${latest.items.length}`
  $('#studioManagerProgress').classList.remove('hidden')
  if (version !== studioDeleteVersion && latest.status === 'complete') { studioDeleteVersion = version; void studioLoadCloud().catch(studioFailure) }
}
$('#studioDestinationDelete').onclick = studioConfirmCloudDelete
$('#studioCloudDeleteCancel').onclick = studioCancelCloudDelete
$('#studioCloudDeleteConfirm').onclick = async () => {
  const button = $('#studioCloudDeleteConfirm'); button.disabled = true
  try {
    const selected = new Set($$('#studioCloudDeleteNames input:checked').map(input => input.value))
    const items = studioDeleteFiles.filter(item => selected.has(item.id)).map(item => ({ id: item.id, bytes: item.bytes, modified: item.modified || '', remoteId: item.remoteId || '' }))
    if (!items.length) return
    await api('/api/studio/cloud/operation', { method: 'POST', body: JSON.stringify({ action: 'delete', confirmed: true, items }) })
    closeLibrarySheet($('#studioCloudDeleteSheet'))
    studioState.selected.clear(); studioState.selecting = false
    $('#studioManagerProgress').textContent = 'Deletion queued.'; $('#studioManagerProgress').classList.remove('hidden')
    await studioTick()
  } catch (error) { $('#studioCloudDeleteError').textContent = error.message; $('#studioCloudDeleteError').classList.remove('hidden') }
  finally { button.disabled = false }
}
portalSheets.wire($('#studioCloudDeleteSheet'), { closeButton: $('#studioCloudDeleteClose'), close: studioCancelCloudDelete })
