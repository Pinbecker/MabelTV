'use strict'

// Series share the local collection names without moving their episode roots.
function configureMyTvSeriesCollection(series) {
  const select = $('#myTvSeriesCollection'), createField = $('#myTvSeriesNewCollection')
  const populate = value => {
    select.replaceChildren(new Option('Unfiled', ''), ...(library.my_tv_folders || []).map(name => new Option(name, name)), new Option('New collection…', '__new__'))
    select.value = value; createField.classList.add('hidden'); $('#myTvSeriesMoveCollection').disabled = false
  }
  populate(series.folder || '')
  select.onchange = () => {
    createField.classList.toggle('hidden', select.value !== '__new__')
    $('#myTvSeriesMoveCollection').disabled = select.value === '__new__'
    if (select.value === '__new__') $('#myTvSeriesCollectionName').focus()
  }
  $('#myTvSeriesCreateCollection').onclick = async () => {
    const name = $('#myTvSeriesCollectionName').value.trim(), button = $('#myTvSeriesCreateCollection')
    if (!name) { $('#myTvSeriesCollectionName').focus(); return }
    button.disabled = true
    try {
      const previous = new Set(library.my_tv_folders || [])
      await api('/api/manage', { method: 'POST', body: JSON.stringify({ action: 'create-my-tv-folder', name }) })
      await reloadLibraryWithoutLosingPlace()
      populate(library.my_tv_folders.includes(name) ? name : library.my_tv_folders.find(value => !previous.has(value)) || '')
      $('#myTvSeriesCollectionName').value = ''
    } catch (error) { notice(error.message, true) }
    finally { button.disabled = false }
  }
  $('#myTvSeriesMoveCollection').onclick = async () => {
    const button = $('#myTvSeriesMoveCollection'); button.disabled = true
    try {
      await api('/api/manage', { method: 'POST', body: JSON.stringify({ action: 'move-my-tv-series-collection', series: series.id, folder: select.value }) })
      await reloadLibraryWithoutLosingPlace()
      closeMyTvSeriesMoreSheet()
    } catch (error) { notice(error.message, true) }
    finally { button.disabled = false }
  }
}
