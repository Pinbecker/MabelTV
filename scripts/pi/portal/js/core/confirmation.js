'use strict'

// Keep the existing confirmation boundary with large, theme-aware controls.
let portalConfirmation = null
function portalConfirm({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel' }) {
  if (portalConfirmation) return Promise.resolve(false)
  const dialog = $('#portalConfirmationSheet')
  $('#portalConfirmationTitle').textContent = title
  $('#portalConfirmationMessage').textContent = message || ''
  $('#portalConfirmationAccept').textContent = confirmLabel
  $('#portalConfirmationCancel').textContent = cancelLabel
  return new Promise(resolve => {
    portalConfirmation = resolve
    portalSheets.open(dialog, { focus: $('#portalConfirmationCancel') })
  })
}
function portalResolveConfirmation(accepted) {
  const resolve = portalConfirmation
  portalConfirmation = null
  portalSheets.close($('#portalConfirmationSheet'), { restore: false })
  resolve?.(accepted)
}
$('#portalConfirmationAccept').onclick = () => portalResolveConfirmation(true)
$('#portalConfirmationCancel').onclick = () => portalResolveConfirmation(false)
portalSheets.wire($('#portalConfirmationSheet'), {
  close: () => portalResolveConfirmation(false),
})
$('#portalConfirmationSheet').addEventListener('close', () => {
  if (portalConfirmation) portalResolveConfirmation(false)
})
window.addEventListener('popstate', () => {
  if (portalConfirmation) portalResolveConfirmation(false)
})
