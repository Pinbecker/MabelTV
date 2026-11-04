'use strict'

let studioDeleteContext = null, studioDeleteVersion = ''
function studioConfirmCloudDelete() {
  studioDeleteContext = studioDraft.cloudContext
  const list = $('#studioCloudDeleteNames'); list.replaceChildren()
  for (const title of studioDeleteContext.titles) {
    const row = document.createElement('li')
    row.textContent = title.title || title.name
    if (title.kind === 'series') row.textContent += ` · ${studioDeleteContext.files.length} selected episodes`
    else if (title.versions?.length > 1) row.textContent += ` · ${title.versions.length} versions`
    list.append(row)
  }
  $('#studioCloudDeleteError').classList.add('hidden')
  closeLibrarySheet($('#studioDestinationSheet'), false)
  closeLibrarySheet($('#studioActionsSheet'), false)
  openLibrarySheet($('#studioCloudDeleteSheet'))
}
function studioCancelCloudDelete() {
  closeLibrarySheet($('#studioCloudDeleteSheet'), false)
  openLibrarySheet($('#studioDestinationSheet'))
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
    const items = studioDeleteContext.files.map(item => ({ id: item.id, bytes: item.bytes, modified: item.modified || '', remoteId: item.remoteId || '' }))
    await api('/api/studio/cloud/operation', { method: 'POST', body: JSON.stringify({ action: 'delete', confirmed: true, items }) })
    closeLibrarySheet($('#studioCloudDeleteSheet'))
    studioState.selected.clear(); studioState.selecting = false
    $('#studioManagerProgress').textContent = 'Deletion queued.'; $('#studioManagerProgress').classList.remove('hidden')
    await studioTick()
  } catch (error) { $('#studioCloudDeleteError').textContent = error.message; $('#studioCloudDeleteError').classList.remove('hidden') }
  finally { button.disabled = false }
}
portalSheets.wire($('#studioCloudDeleteSheet'), { closeButton: $('#studioCloudDeleteClose'), close: studioCancelCloudDelete })
