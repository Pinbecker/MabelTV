'use strict'

// Presentation helpers shared by Studio's source and destination owners.
function studioVideoLabel(value) {
  return String(value || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ')
    .replace(/\s+(?:2160p|1080p|720p|480p|BluRay|BRRip|WEBRip|WEB-DL|HDTV)\b.*$/i, '').replace(/[\s-]+$/, '').trim()
}
function studioEmpty(title, message = '', symbol = 'signal-search', loading = false) {
  const panel = document.createElement('div'); panel.className = 'studio-empty'
  const art = document.createElement('span'), heading = document.createElement('h3')
  if (loading) { const spinner = document.createElement('i'); spinner.className = 'studio-spinner'; art.append(spinner) }
  else art.append(librarySignalIcon(symbol))
  heading.textContent = title; panel.append(art, heading)
  if (message) { const copy = document.createElement('p'); copy.textContent = message; panel.append(copy) }
  return panel
}
function studioMediaArt(host, title = null, fallback = 'signal-film') {
  host.replaceChildren()
  const poster = title && myTvViewingPosterUrl(title)
  host.append(poster ? myTvArtworkImage(poster) : librarySignalIcon(fallback))
}
function studioSyncSelects() {
  for (const select of $$('[data-studio-options]')) {
    let trigger = select.nextElementSibling
    if (!trigger?.classList.contains('studio-select-trigger')) {
      select.classList.add('sr-only'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true')
      trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'studio-select-trigger'
      trigger.setAttribute('aria-haspopup', 'dialog'); trigger.onclick = event => { event.preventDefault(); studioOpenOptions(select) }
      select.after(trigger)
    }
    const copy = document.createElement('span')
    copy.textContent = (select.id === 'studioSeries' && select.value === 'new' && $('#studioNewSeries').value || select.selectedOptions[0]?.textContent || 'Choose ' + select.dataset.studioOptions.toLowerCase()).split(' · ')[0]
    if (select.dataset.studioDetail) { const small = document.createElement('small'); small.textContent = select.dataset.studioDetail; copy.append(small) }
    trigger.replaceChildren(copy, librarySignalIcon('signal-chevron-right'))
    trigger.setAttribute('aria-label', select.dataset.studioOptions + ': ' + copy.textContent)
    trigger.disabled = select.disabled
  }
}
let studioOptionSelect = null
function studioOpenOptions(select) {
  studioOptionSelect = select
  $('#studioOptionTitle').textContent = select.dataset.studioOptions
  $('#studioNewSeriesField').classList.toggle('hidden', select.id !== 'studioSeries' || select.value !== 'new')
  const root = $('#studioOptions'); root.replaceChildren()
  for (const option of select.options) {
    const row = document.createElement('label'); row.className = 'studio-choice'
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'studioOption'; input.value = option.value
    input.checked = option.selected; input.disabled = option.disabled
    const text = document.createElement('span'); text.textContent = option.textContent.split(' · ')[0]
    row.append(input, text)
    if (option.textContent.includes(' · ')) { const small = document.createElement('small'); small.textContent = option.textContent.split(' · ').slice(1).join(' · '); row.append(small) }
    input.onchange = () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); studioSyncSelects() }
    root.append(row)
  }
  openLibrarySheet($('#studioOptionSheet'))
}
function studioCloseOptions() {
  $('#studioNewSeriesField').classList.add('hidden')
  closeLibrarySheet($('#studioOptionSheet'))
  studioOptionSelect?.nextElementSibling?.focus({ preventScroll: true }); studioOptionSelect = null
}
$('#studioOptionDone').onclick = studioCloseOptions
portalSheets.wire($('#studioOptionSheet'), { closeButton: $('#studioOptionClose'), close: studioCloseOptions })
studioSyncSelects()
$('#studioNewSeries').oninput = studioSyncSelects
