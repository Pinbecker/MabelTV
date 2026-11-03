'use strict'

let myTvSendTarget = null

function bindSendToMabel(root, source, title, returnTo) {
  let button = root.querySelector('[data-send-to-mabel]')
  if (!button) {
    button = document.createElement('button')
    button.type = 'button'; button.className = 'watch-film-play'
    button.dataset.sendToMabel = ''
    button.innerHTML = '<span class="watch-action-icon"><svg class="icon"><use href="/portal/icons.svg#signal-tv" /></svg></span><span><strong></strong><small>Make an independent copy in a channel</small></span>'
    root.append(button)
  }
  button.querySelector('strong').textContent = `Send to ${tvName()}`
  button.onclick = () => {
    portalSheets.dismiss(root.closest('dialog'))
    void openSendToMabel(source, title, returnTo).catch(error => notice(error.message, true))
  }
}

async function openSendToMabel(source, title, returnTo) {
  const profiles = await loadMediaCompressionProfiles()
  const compression = $('#myTvSendCompression'); compression.replaceChildren()
  for (const profile of profiles) compression.add(new Option(`${profile.label} · about ${Math.round((1-profile.sourceFraction)*100)}% smaller`, profile.id))
  compression.value = 'compact'
  const files = source.kind === 'my_tv' ? (library.my_tv_library || []).filter(f => f.path === source.file)
    : (library.my_tv_series || []).find(s => s.id === source.series)?.episodes.filter(e => !source.file || e.path === source.file) || []
  const bytes = files.reduce((n,f) => n + Number(f.size || 0), 0)
  const estimate = () => {
    const profile = profiles.find(p => p.id === compression.value)
    $('#myTvSendEstimate').textContent = bytes ? `Estimated channel copy: ${mediaCompressionBytes(bytes*profile.targetFraction)}` : 'Size estimate available when the source size is known.'
  }
  compression.onchange = estimate; estimate()
  myTvSendTarget = { source, title, returnTo }
  const select = $('#myTvSendChannel')
  select.replaceChildren()
  const type = source.kind === 'my_tv' ? 'films' : 'shows'
  for (const channel of [...(library?.channels || [])].sort((a, b) => a.number - b.number)) {
    if ((channel.content_type || 'shows') !== type) continue
    select.add(new Option(`CH ${channel.number} · ${channel.name}`, String(channel.number)))
  }
  select.add(new Option('Create a new channel…', 'new'))
  $('#myTvSendHeading').textContent = `Send to ${tvName()}`
  $('#myTvSendTitle').textContent = title
  $('#myTvSendExplanation').textContent = `A separate copy will live in ${tvName()}. Your My TV original, saved position and viewing history stay independent.`
  $('#myTvSendName').value = source.kind === 'my_tv' ? 'Films' : title
  $('#myTvSendSubmit').textContent = `Send to ${tvName()}`
  $('#myTvSendError').textContent = ''
  $('#myTvSendSubmit').disabled = false
  syncMyTvSendChannel()
  portalSheets.open($('#myTvSendSheet'), { returnTo })
}

function syncMyTvSendChannel() {
  const creating = $('#myTvSendChannel').value === 'new'
  $('#myTvSendNewChannel').classList.toggle('hidden', !creating)
  $('#myTvSendName').required = creating
}
$('#myTvSendChannel').onchange = syncMyTvSendChannel
$('#myTvSendForm').onsubmit = async event => {
  event.preventDefault()
  const target = myTvSendTarget
  const button = $('#myTvSendSubmit')
  if (!target || button.disabled) return
  const channel = $('#myTvSendChannel').value
  button.disabled = true; $('#myTvSendError').textContent = ''
  try {
    const result = await api('/api/my-tv/send-to-mabel', { method: 'POST', body: JSON.stringify({
      ...target.source, compression: $('#myTvSendCompression').value, ...(channel === 'new' ? { new_channel: $('#myTvSendName').value.trim() } : { channel: Number(channel) }),
    }) })
    portalSheets.close($('#myTvSendSheet'))
    notice(`Copying ${result.count === 1 ? target.title : `${result.count} episodes`} to ${result.channel_name}. Follow progress in Downloads.`)
    reloadLibraryWithoutLosingPlace().catch(showError)
  } catch (error) { $('#myTvSendError').textContent = error.message }
  finally { button.disabled = false }
}
portalSheets.wire($('#myTvSendSheet'), { closeButton: $('#myTvSendClose'),
  close: () => portalSheets.close($('#myTvSendSheet')) })
