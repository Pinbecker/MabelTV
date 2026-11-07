'use strict'

let subtitleView = null
function bindSubtitleControls(root, source, title, returnTo) {
  if (!root) return
  let button = root.querySelector('[data-subtitle-options]')
  if (!button) {
    button = document.createElement('button'); button.type = 'button'; button.dataset.subtitleOptions = 'true'; button.className = 'watch-film-play'
    button.innerHTML = '<span class="watch-action-icon"><svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#signal-captions"/></svg></span><span><strong>Subtitles</strong><small>Choose a track or find another</small></span>'
    root.append(button)
  }
  button.onclick = () => void openSubtitleOptions(source, title, returnTo)
}
async function openSubtitleOptions(source, title, returnTo) {
  const sheet = $('#subtitleSheet'), revision = {}, view = { source, revision, fingerprint: null }
  subtitleView = view
  $('#subtitleTitle').textContent = title; $('#subtitleQuery').value = title
  $('#subtitleResults').replaceChildren(); $('#subtitleTracks').replaceChildren()
  $('#subtitleMessage').textContent = 'Loading subtitles…'
  $('#subtitleSearchButton').disabled = true
  portalSheets.open(sheet, { returnTo })
  try {
    const response = await subtitleCall('tracks', {})
    if (subtitleView !== view) return
    subtitleRenderTracks(response); $('#subtitleMessage').textContent = 'Changes apply the next time this copy is opened.'
    $('#subtitleSearchButton').disabled = !response.configured
    if (!response.configured) $('#subtitleMessage').textContent = 'Subtitle search is not configured.'
  } catch (error) { if (subtitleView === view) $('#subtitleMessage').textContent = error.message }
}
async function subtitleCall(action, body) {
  return api('/api/studio/subtitles/' + action, { method: 'POST', body: JSON.stringify({ source: subtitleView.source, ...body }) })
}
function subtitleRenderTracks(response) {
  subtitleView.fingerprint = response.fingerprint
  const root = $('#subtitleTracks'); root.replaceChildren()
  for (const track of [{ id: 'off', label: 'Off' }, ...response.tracks]) {
    const label = document.createElement('label'); label.className = 'studio-episode'
    label.innerHTML = `<input type="radio" name="subtitleTrack" value="${escapeHtml(track.id)}" ${response.selected === track.id ? 'checked' : ''}><span><strong>${escapeHtml(track.label)}</strong>${track.origin ? `<small>${track.origin === 'downloaded' ? 'Downloaded' : 'Included / saved'}</small>` : ''}</span>`
    label.querySelector('input').onchange = async event => {
      const view = subtitleView
      root.querySelectorAll('input').forEach(input => { input.disabled = true })
      try {
        await subtitleCall('select', { track: track.id, fingerprint: view.fingerprint })
        if (subtitleView === view) { response.selected = track.id; $('#subtitleMessage').textContent = 'Saved. Applies when this copy is next opened.' }
      } catch (error) { if (subtitleView === view) { $('#subtitleMessage').textContent = error.message; subtitleRenderTracks(response) } }
      finally { if (subtitleView === view) root.querySelectorAll('input').forEach(input => { input.disabled = false }) }
    }
    root.append(label)
  }
  if (!response.tracks.length) { const note = document.createElement('p'); note.textContent = 'No saved text subtitles. Search below.'; root.append(note) }
}
$('#subtitleSearchForm').onsubmit = async event => {
  event.preventDefault()
  const view = subtitleView, button = $('#subtitleSearchButton'); button.disabled = true
  const root = $('#subtitleResults'); root.replaceChildren(studioEmpty('Finding subtitles…', '', 'signal-search', true))
  try {
    const response = await subtitleCall('search', { query: $('#subtitleQuery').value })
    if (subtitleView !== view) return
    root.replaceChildren()
    if (!response.results.length) { const note = document.createElement('p'); note.textContent = 'No matching subtitles found.'; root.append(note) }
    for (const item of response.results) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'watch-film-play'
      row.innerHTML = `<span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml([item.fps ? item.fps + ' fps' : '', item.hearingImpaired ? 'Includes sound descriptions' : '', 'Download and use'].filter(Boolean).join(' · '))}</small></span>`
      row.onclick = async () => {
        row.disabled = true
        try {
          const updated = await subtitleCall('download', { id: item.id })
          if (subtitleView !== view) return
          subtitleRenderTracks(updated); $('#subtitleMessage').textContent = 'Saved. Reopen this copy to try these subtitles.'
        } catch (error) { if (subtitleView === view) $('#subtitleMessage').textContent = error.message }
        finally { row.disabled = false }
      }
      root.append(row)
    }
  } catch (error) { if (subtitleView === view) { root.replaceChildren(); $('#subtitleMessage').textContent = error.message } }
  finally { if (subtitleView === view) button.disabled = false }
}
portalSheets.wire($('#subtitleSheet'), { closeButton: $('#subtitleClose'), close: () => { subtitleView = null; portalSheets.dismiss($('#subtitleSheet')) } })
