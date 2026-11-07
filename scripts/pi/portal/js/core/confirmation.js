'use strict'

// Keep the existing confirmation boundary with large, theme-aware controls.
let portalConfirmation = null
function portalConfirm({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', onConfirm = null, pendingLabel = 'Working…' }) {
  if (portalConfirmation) return Promise.resolve(false)
  const dialog = $('#portalConfirmationSheet')
  $('#portalConfirmationTitle').textContent = title
  $('#portalConfirmationMessage').textContent = message || ''
  $('#portalConfirmationAccept').textContent = confirmLabel
  $('#portalConfirmationCancel').textContent = cancelLabel
  $('#portalConfirmationAccept').disabled = false
  $('#portalConfirmationCancel').disabled = false
  dialog.removeAttribute('aria-busy')
  return new Promise(resolve => {
    portalConfirmation = { resolve, onConfirm, pendingLabel, busy: false }
    portalSheets.open(dialog, { focus: $('#portalConfirmationCancel') })
  })
}
function portalResolveConfirmation(accepted, completed = false) {
  const pending = portalConfirmation
  if (!pending || (pending.busy && !completed)) return
  portalConfirmation = null
  portalSheets.close($('#portalConfirmationSheet'), { restore: false })
  pending.resolve(accepted)
}
$('#portalConfirmationAccept').onclick = async () => {
  const pending = portalConfirmation
  if (!pending || pending.busy) return
  if (!pending.onConfirm) { portalResolveConfirmation(true); return }
  pending.busy = true
  const dialog = $('#portalConfirmationSheet')
  dialog.setAttribute('aria-busy', 'true')
  $('#portalConfirmationAccept').disabled = true
  $('#portalConfirmationCancel').disabled = true
  $('#portalConfirmationAccept').textContent = pending.pendingLabel
  $('#portalConfirmationMessage').textContent = 'Waiting for the TV…'
  try {
    await pending.onConfirm()
    portalResolveConfirmation(true, true)
  } catch (error) {
    if (error.status === 401) {
      portalResolveConfirmation(false, true)
      document.querySelectorAll('dialog[open]').forEach(sheet => portalSheets.close(sheet, { restore: false }))
      return
    }
    if (portalConfirmation !== pending) return
    pending.busy = false
    dialog.removeAttribute('aria-busy')
    $('#portalConfirmationMessage').textContent = error.message || 'The TV did not start. Try again.'
    $('#portalConfirmationAccept').textContent = 'Try again'
    $('#portalConfirmationAccept').disabled = false
    $('#portalConfirmationCancel').disabled = false
    $('#portalConfirmationAccept').focus({ preventScroll: true })
  }
}
$('#portalConfirmationCancel').onclick = () => portalResolveConfirmation(false)
portalSheets.wire($('#portalConfirmationSheet'), {
  close: () => portalResolveConfirmation(false),
})
$('#portalConfirmationSheet').addEventListener('close', () => {
  if (!$('#portalConfirmationSheet').open && portalConfirmation) portalResolveConfirmation(false)
})
window.addEventListener('popstate', () => {
  if (portalConfirmation) portalResolveConfirmation(false)
})
