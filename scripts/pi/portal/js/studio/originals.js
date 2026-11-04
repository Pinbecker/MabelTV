'use strict'

let studioOriginalChoice = null
async function studioLoadOriginalAction() {
  const button = $('#studioDownloadOriginal'), draft = studioDraft
  button.disabled = true; button.title = 'Reading original source'
  studioOriginalChoice = null
  if (!draft?.sources.length) return
  const info = await api('/api/studio/originals', { method: 'POST', body: JSON.stringify({ ids: draft.sources.map(source => source.id) }) })
  if (draft !== studioDraft) return
  studioOriginalChoice = info.available ? info : null
  button.disabled = !info.available; button.title = info.reason || ''
}
$('#studioDownloadOriginal').onclick = () => {
  if (!studioOriginalChoice) return
  studioChooseOriginal(studioOriginalChoice)
}
function studioChooseOriginal(info) {
  closeLibrarySheet($('#studioActionsSheet'), false)
  const items = info.items || [info]
  openStudioDestination(items.map(item => ({ type: 'original', title: item.title, bytes: item.bytes })))
  studioDraft.originalInfo = info
  studioDraft.originalInfo.items = items
  $('#studioDestinationForm input[name="studioCloudCopies"][value="original"]').checked = true
  $('#studioDestinationTitle').textContent = info.title
  studioSyncDestination()
}
$('#myTvFilmOriginal').onclick = async () => {
  const film = selectedMyTvFilm
  if (!film) return
  const button = $('#myTvFilmOriginal'); button.disabled = true
  try {
    const info = await api('/api/studio/original?' + new URLSearchParams({ kind: 'my_tv', file: film.path }))
    if (!info.available) throw new Error(info.reason)
    closeLibrarySheet($('#myTvFilmSheet'), false)
    studioChooseOriginal(info)
  } catch (error) { notice(error.message, true) }
  finally { button.disabled = false }
}
$('#myTvEpisodeOriginal').onclick = async () => {
  const selected = selectedMyTvEpisode
  if (!selected) return
  const button = $('#myTvEpisodeOriginal'); button.disabled = true
  try {
    const info = await api('/api/studio/original?' + new URLSearchParams({ kind: 'my-tv-series', series: selected.series.id, file: selected.episode.path }))
    if (!info.available) throw new Error(info.reason)
    closeLibrarySheet($('#myTvEpisodeSheet'), false)
    studioChooseOriginal(info)
  } catch (error) { notice(error.message, true) }
  finally { button.disabled = false }
}
