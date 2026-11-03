'use strict'

async function loadMediaCompressionProfiles() {
  let profiles = library?.compressionProfiles
  if (!profiles?.length) profiles = (await api('/api/status')).compressionProfiles
  if (!profiles?.length) throw new Error('Compression profiles are unavailable. Refresh and try again.')
  if (library) library.compressionProfiles = profiles
  return profiles
}
function mediaCompressionBytes(bytes) {
  return bytes < 1e9 ? `${Math.round(bytes/1e6)} MB` : `${(bytes/1e9).toFixed(2)} GB`
}
function updateMediaCompressionEstimate(selectId, labelId, files) {
  const select = $('#' + selectId), label = $('#' + labelId)
  if (!select || !label) return
  const bytes = files.reduce((n,f) => n + Number(f.size || 0), 0)
  const option = select.selectedOptions[0]
  label.textContent = bytes ? `Estimated size: ${mediaCompressionBytes(bytes*Number(option.dataset.fraction)*.98)}` : ''
}
async function chooseMediaCompression(title, bytes, action = 'Optimise') {
  const profiles = await loadMediaCompressionProfiles()
  const dialog = document.createElement('dialog'); dialog.className = 'library-sheet studio-sheet'
  dialog.id = 'mediaCompressionSheet'
  dialog.innerHTML = '<section class="library-sheet-panel"><header class="library-sheet-head"><div><p class="section-kicker">Compression</p><h2></h2></div><button class="portal-sheet-close" type="button" aria-label="Close compression">×</button></header><div class="library-sheet-body studio-destination-form"><label>Compression<select aria-label="Compression profile"></select></label><p class="compression-current"></p><p class="compression-estimate" role="status"></p><p class="studio-caption">The original is replaced only after a smaller copy passes its checks.</p></div><div class="studio-sheet-footer"><button class="secondary compression-cancel" type="button">Cancel</button><button class="primary compression-confirm" type="button"></button></div></section>'
  dialog.querySelector('h2').textContent = title
  const select = dialog.querySelector('select')
  for (const profile of profiles) select.add(new Option(`${profile.label} · about ${Math.round((1-profile.sourceFraction)*100)}% smaller`, profile.id))
  select.value = 'compact'
  dialog.querySelector('.compression-current').textContent = `Current size: ${mediaCompressionBytes(bytes)}`
  const update = () => {
    const profile = profiles.find(p => p.id === select.value)
    dialog.querySelector('.compression-estimate').textContent = `Estimated size: ${mediaCompressionBytes(bytes*(profile.targetFraction || profile.sourceFraction*.98))}`
  }
  select.onchange = update; update()
  const confirm = dialog.querySelector('.compression-confirm'); confirm.textContent = action
  document.body.append(dialog)
  return new Promise(resolve => {
    let settled = false
    const close = value => {
      if (settled) return
      settled = true; closeLibrarySheet(dialog); resolve(value)
      setTimeout(() => dialog.remove(), 350)
    }
    confirm.onclick = () => close(select.value)
    dialog.querySelector('.compression-cancel').onclick = () => close(null)
    portalSheets.wire(dialog, { closeButton: dialog.querySelector('.portal-sheet-close'), close: () => close(null) })
    openLibrarySheet(dialog)
  })
}
