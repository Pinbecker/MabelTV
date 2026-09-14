'use strict'

const librarySignalIcon = window.MabelPortalUI.icon

function myTvOptimisationLabel(film) {
      const state = film?.playback_state || 'original'
      const progress = Math.max(0, Math.min(100, Number(film?.playback_progress || 0)))
      if (state === 'processing') return `Optimising ${Math.round(progress)}%`
      if (state === 'queued') return 'Optimising · waiting'
      if (state === 'error') return 'Optimisation needs attention'
      return ''
    }

function myTvOptimisationBadge(film) {
      const badge = document.createElement('span')
      badge.className = 'my-tv-optimisation-badge'
      badge.textContent = myTvOptimisationLabel(film)
      badge.classList.toggle('hidden', !badge.textContent)
      return badge
    }

function updateMyTvOptimisationCards(film) {
      document.querySelectorAll('[data-my-tv-path]').forEach(card => {
        if (card.dataset.myTvPath !== film.path) return
        let badge = card.querySelector('.my-tv-optimisation-badge')
        if (!badge) {
          badge = myTvOptimisationBadge(film)
          const art = card.querySelector('.watch-card-art')
          ;(art || card).append(badge)
        }
        badge.textContent = myTvOptimisationLabel(film)
        badge.classList.toggle('hidden', !badge.textContent)
        card.classList.toggle('is-optimising', ['queued', 'processing'].includes(film.playback_state))
      })
    }

async function reloadLibraryWithoutLosingPlace(preferredUploadChannel = null) {
      await load(preferredUploadChannel)
    }

async function pollMyTvOptimisations() {
      clearTimeout(myTvOptimisationRefresh)
      try {
        const result = await api('/api/my-tv/optimisations')
        const films = library?.my_tv_library || []
        result.items.forEach(item => {
          const film = films.find(value => value.path === item.path)
          if (!film) return
          film.playback_state = item.state
          film.playback_progress = item.progress
          film.playback_message = item.message
          updateMyTvOptimisationCards(film)
        })
        if (!result.active && myTvOptimisationWasActive) {
          myTvOptimisationWasActive = false
          await reloadLibraryWithoutLosingPlace()
          return
        }
        myTvOptimisationWasActive = result.active
        if (result.active) {
          myTvOptimisationRefresh = setTimeout(
            () => pollMyTvOptimisations().catch(() => {}), 1500)
        }
      } catch (_) {
        if ((library?.my_tv_library || []).some(film =>
          ['queued', 'processing'].includes(film.playback_state))) {
          myTvOptimisationRefresh = setTimeout(
            () => pollMyTvOptimisations().catch(() => {}), 3000)
        }
      }
    }

function renderMyTvLibraryControls() {
      const films = library?.my_tv_library || []
      const folders = library?.my_tv_folders || []
      if (myTvFolderFilter !== '*' && myTvFolderFilter !== '' &&
          !folders.includes(myTvFolderFilter)) myTvFolderFilter = '*'
      const folderName = myTvFolderFilter === '*'
        ? 'All films' : (myTvFolderFilter || 'Unfiled')
      const uploadFolder = $('#myTvUploadFolder')
      const uploadChoice = uploadFolder.value
      uploadFolder.innerHTML = '<option value="">Unfiled</option>'
      folders.forEach(folder => {
        const option = document.createElement('option')
        option.value = folder
        option.textContent = folder
        uploadFolder.append(option)
      })
      uploadFolder.value = folders.includes(uploadChoice) ? uploadChoice : ''

      const tabs = document.createDocumentFragment()
      const tabValues = [{ value: '*', name: 'All films' },
        { value: '', name: 'Unfiled' },
        ...folders.map(folder => ({ value: folder, name: folder }))]
      tabValues.forEach(item => {
        const count = item.value === '*' ? films.length
          : films.filter(film => film.folder === item.value).length
        if (item.value === '' && count === 0) return
        const tab = portalButton({ iconName: 'folder', iconClass: 'icon' })
        tab.className = `my-tv-folder-tab${myTvFolderFilter === item.value ? ' active' : ''}`
        const copy = document.createElement('span')
        const title = document.createElement('strong')
        title.textContent = item.name
        copy.append(title)
        const badge = document.createElement('span')
        badge.className = 'count-badge'
        badge.textContent = count
        tab.append(copy, badge)
        tab.setAttribute('aria-pressed', String(myTvFolderFilter === item.value))
        tab.onclick = () => {
          myTvFolderFilter = item.value
          renderMyTvLibraryControls()
        }
        tabs.append(tab)
      })
      $('#myTvFolderTabs').replaceChildren(tabs)
      const realFolderSelected = myTvFolderFilter !== '*' && myTvFolderFilter !== ''
      $('#myTvRenameFolder').disabled = !realFolderSelected
      const selectedCount = films.filter(film => film.folder === myTvFolderFilter).length
      $('#myTvDeleteFolder').disabled = !realFolderSelected || selectedCount > 0
      $('#myTvFolderSelectionActions').classList.toggle('hidden', !realFolderSelected)
      $('#myTvFolderSelectionActions [data-selected-collection]').textContent = folderName
      $('#myTvDeleteFolderHint').textContent = selectedCount
        ? 'Move its films first' : 'This collection is empty'
    }

    function openMyTvFilmSheet(film, returnTo = null) {
      selectedMyTvFilm = film
      selectedMyTvFilmReturnTo = returnTo
      const metadata = film.metadata || {}; const folders = library?.my_tv_folders || []
      const title = metadata.title || film.display_name
      $('#myTvFilmSheetTitle').textContent = title
      $('#myTvFilmSheetEyebrow').textContent = 'Film settings'
      const metaRoot = $('#myTvFilmSheetMeta')
      renderMyTvTitleMetadata(metaRoot, {}, {
        facts: [
          { label: 'Year', value: metadata.year },
          { label: 'Collection', value: film.folder || 'Unfiled' },
          { label: 'Size', value: `${(Number(film.size || 0) / 1073741824).toFixed(2)} GB` },
          { label: 'Quality', value: film.playback_state === 'optimised' ? 'Optimised for Pi' : 'Original' },
        ],
      })
      $('#myTvFilmSheetOverview').textContent = metadata.overview || 'Manage this film without changing where you left off.'
      const artwork = metadata.poster ? artworkUrl(metadata.poster) : ''
      $('#myTvFilmBackdrop').style.setProperty('--watch-film-art', artwork ? `url("${artwork}")` : 'linear-gradient(135deg,#2e3a34,#101513)')
      $('#myTvFilmSheetPoster').replaceChildren(filmPoster(film))
      const select = $('#myTvFilmFolder'); select.innerHTML = '<option value="">Unfiled</option>'
      folders.forEach(folder => { const option = document.createElement('option'); option.value = folder; option.textContent = folder; select.append(option) })
      select.value = film.folder || ''
      const busy = ['processing', 'queued'].includes(film.playback_state)
      const optimise = $('#myTvFilmOptimise')
      optimise.disabled = busy || film.playback_state === 'optimised'
      optimise.querySelector('strong').textContent = film.playback_state === 'optimised' ? 'Already optimised' : busy ? myTvOptimisationLabel(film) : 'Optimise for Pi'
      optimise.querySelector('small').textContent = film.playback_state === 'optimised'
        ? 'This film already uses the TV playback profile'
        : busy ? 'The playback copy is being prepared' : 'Prepare a smoother TV playback copy'
      const scan = $('#myTvFilmScan')
      scan.disabled = !tmdbConfigured
      scan.querySelector('strong').textContent = metadata.tmdb_id ? 'Refresh metadata & subtitles' : 'Find metadata & subtitles'
      const removeProgress = $('#myTvFilmRemoveProgress')
      removeProgress.classList.toggle('hidden', !watchFilmResumable(film))
      const sheet = $('#myTvFilmSheet')
      portalSheets.open(sheet, {
        returnTo,
        focus: sheet.querySelector('.watch-film-panel'),
      })
    }

    async function scanTmdb(film, returnTo = null) {
      try {
        const result = await api('/api/tmdb/search', {
          method: 'POST', body: JSON.stringify({ file: film.path })
        })
        $('#tmdbDialogTitle').textContent = `Match “${result.query || film.display_name}”`
        const root = $('#tmdbResults')
        root.innerHTML = ''
        if (!result.results.length) {
          root.append(portalEmptyState({
            title: 'No matches found',
            message: 'Rename the film more precisely and scan again.',
          }))
        }
        result.results.forEach(match => {
          const row = document.createElement('article')
          row.className = 'tmdb-result'
          const poster = document.createElement('span')
          poster.className = 'tmdb-result-poster'
          poster.setAttribute('aria-hidden', 'true')
          poster.append(librarySignalIcon('signal-clapperboard'))
          const copy = document.createElement('div')
          copy.innerHTML = `<strong>${escapeHtml(match.title)}${match.year ? ` (${escapeHtml(match.year)})` : ''}</strong><p>${escapeHtml(match.overview || 'No description supplied.')}</p>`
          const choose = document.createElement('button')
          choose.type = 'button'; choose.className = 'primary tmdb-result-choose'; choose.textContent = 'Use this match'
          choose.onclick = async () => {
            choose.disabled = true
            try {
              await api('/api/tmdb/apply', { method: 'POST', body: JSON.stringify({ file: film.path, tmdb_id: match.id }) })
              portalSheets.dismiss($('#tmdbDialog')); await reloadLibraryWithoutLosingPlace()
            } catch (error) { notice(error.message, true); choose.disabled = false }
          }
          row.append(poster, copy, choose); root.append(row)
        })
        portalSheets.open($('#tmdbDialog'), { returnTo }); notice('')
      } catch (error) { notice(error.message, true) }
    }

    async function scanProgrammeTmdb(channel, programme, returnTo = null) {
      const title = programme.metadata?.title || programme.display_name
      try {
        const result = await api('/api/tmdb/programme', {
          method: 'POST',
          body: JSON.stringify({ channel: channel.number, file: programme.name })
        })
        $('#tmdbDialogTitle').textContent = `Match “${result.query || title}”`
        const root = $('#tmdbResults')
        root.innerHTML = ''
        if (!result.results.length) {
          root.append(portalEmptyState({
            title: 'No matches found',
            message: 'Rename the film more precisely and search again.',
          }))
        }
        result.results.forEach(match => {
          const row = document.createElement('article')
          row.className = 'tmdb-result'
          const poster = document.createElement('span')
          poster.className = 'tmdb-result-poster'
          poster.setAttribute('aria-hidden', 'true')
          poster.append(librarySignalIcon('signal-clapperboard'))
          const copy = document.createElement('div')
          copy.innerHTML = `<strong>${escapeHtml(match.title)}${match.year ? ` (${escapeHtml(match.year)})` : ''}</strong><p>${escapeHtml(match.overview || 'No description supplied.')}</p>`
          const choose = document.createElement('button')
          choose.type = 'button'
          choose.className = 'primary tmdb-result-choose'
          choose.textContent = 'Use this match'
          choose.onclick = async () => {
            choose.disabled = true
            try {
              await api('/api/tmdb/programme', {
                method: 'POST',
                body: JSON.stringify({
                  channel: channel.number,
                  file: programme.name,
                  tmdb_id: match.id
                })
              })
              portalSheets.dismiss($('#tmdbDialog'))
              await reloadLibraryWithoutLosingPlace(channel.number)
            } catch (error) {
              notice(error.message, true)
              choose.disabled = false
            }
          }
          row.append(poster, copy, choose)
          root.append(row)
        })
        portalSheets.open($('#tmdbDialog'), { returnTo })
        notice('')
      } catch (error) { notice(error.message, true) }
    }

    async function scanChannelTmdb(channel, returnTo = null) {
      const title = channel.metadata?.title || channel.name
      try {
        const result = await api('/api/tmdb/channel', {
          method: 'POST',
          body: JSON.stringify({ channel: channel.number })
        })
        $('#tmdbDialogTitle').textContent = `Match “${result.query || title}”`
        const root = $('#tmdbResults')
        root.innerHTML = ''
        if (!result.results.length) {
          root.append(portalEmptyState({
            title: 'No matches found',
            message: 'Check the channel name, save it, and search again.',
          }))
        }
        result.results.forEach(match => {
          const row = document.createElement('article')
          row.className = 'tmdb-result'
          const poster = document.createElement('span')
          poster.className = 'tmdb-result-poster'
          poster.setAttribute('aria-hidden', 'true')
          poster.append(librarySignalIcon('signal-clapperboard'))
          const copy = document.createElement('div')
          copy.innerHTML = `<strong>${escapeHtml(match.title)}${match.year ? ` (${escapeHtml(match.year)})` : ''}</strong><p>${escapeHtml(match.overview || 'No description supplied.')}</p>`
          const choose = document.createElement('button')
          choose.type = 'button'
          choose.className = 'primary tmdb-result-choose'
          choose.textContent = 'Use this match'
          choose.onclick = async () => {
            choose.disabled = true
            try {
              await api('/api/tmdb/channel', {
                method: 'POST',
                body: JSON.stringify({ channel: channel.number, tmdb_id: match.id })
              })
              portalSheets.dismiss($('#tmdbDialog'))
              await reloadLibraryWithoutLosingPlace(channel.number)
            } catch (error) {
              notice(error.message, true)
              choose.disabled = false
            }
          }
          row.append(poster, copy, choose)
          root.append(row)
        })
        portalSheets.open($('#tmdbDialog'), { returnTo })
        notice('')
      } catch (error) { notice(error.message, true) }
    }

    const tmdbDialog = $('#tmdbDialog')
    portalSheets.wire(tmdbDialog, {
      closeButton: $('#tmdbClose'),
      close: () => portalSheets.close(tmdbDialog),
    })
    ;[
      [$('#myTvUploadSheet'), $('#myTvUploadClose')],
      [$('#myTvCollectionSheet'), $('#myTvCollectionClose')],
      [$('#myTvFilmSheet'), $('#myTvFilmClose')],
    ].forEach(([dialog, closeButton]) => portalSheets.wire(dialog, {
      closeButton,
      close: () => closeLibrarySheet(dialog),
      onClose: () => {
        if (dialog === $('#myTvFilmSheet')) {
          selectedMyTvFilm = null
          selectedMyTvFilmReturnTo = null
        }
      },
    }))
    $('#myTvFilmDownload').onclick = () => {
      const film = selectedMyTvFilm
      if (!film) return
      closeLibrarySheet($('#myTvFilmSheet'), false)
      downloadToDevice({ kind: 'my_tv', file: film.path }, film.metadata?.title || film.display_name)
    }
    $('#myTvFilmMove').onclick = async () => { if (selectedMyTvFilm) { const film = selectedMyTvFilm; closeLibrarySheet($('#myTvFilmSheet'), false); await manage('move-my-tv', { file: film.path, folder: $('#myTvFilmFolder').value }) } }
    $('#myTvFilmScan').onclick = () => {
      const film = selectedMyTvFilm
      const parentReturn = selectedMyTvFilmReturnTo
      if (film) {
        closeLibrarySheet($('#myTvFilmSheet'), false)
        scanTmdb(film, () => openMyTvFilmSheet(film, parentReturn))
      }
    }
    $('#myTvFilmRename').onclick = () => { const film = selectedMyTvFilm; if (!film) return; const name = prompt('Film name:', film.display_name); if (name?.trim()) { closeLibrarySheet($('#myTvFilmSheet'), false); manage('rename-my-tv', { file: film.path, name: name.trim() }) } }
    $('#myTvFilmOptimise').onclick = () => { const film = selectedMyTvFilm; if (film && confirm(`Optimise “${film.display_name}” for the Pi? The original is replaced only after the new copy passes its checks.`)) { closeLibrarySheet($('#myTvFilmSheet'), false); manage('optimise-my-tv', { file: film.path }) } }
    $('#myTvFilmRemoveProgress').onclick = () => {
      const film = selectedMyTvFilm
      if (!film) return
      const action = $('#myTvFilmRemoveProgress')
      closeLibrarySheet($('#myTvFilmSheet'), false)
      clearWatchFilmProgress(film, action).catch(showError)
    }
    $('#myTvFilmRemove').onclick = () => { const film = selectedMyTvFilm; if (film && confirm(`Move “${film.display_name}” to the recycle bin?`)) { closeLibrarySheet($('#myTvFilmSheet'), false); manage('trash-my-tv', { file: film.path }) } }

    $('#myTvCreateFolder').onclick = async () => {
      const name = $('#myTvFolderName').value.trim()
      if (!name) return
      await manage('create-my-tv-folder', { name })
      $('#myTvFolderName').value = ''
      myTvFolderFilter = name
      renderMyTvLibraryControls()
    }
    $('#myTvRenameFolder').onclick = async () => {
      if (myTvFolderFilter === '*' || myTvFolderFilter === '') return
      const name = prompt('Collection name:', myTvFolderFilter)
      if (!name?.trim()) return
      const oldFolder = myTvFolderFilter
      myTvFolderFilter = name.trim()
      await manage('rename-my-tv-folder', { folder: oldFolder, name: name.trim() })
    }
    $('#myTvDeleteFolder').onclick = async () => {
      if (myTvFolderFilter === '*' || myTvFolderFilter === '') return
      if (!confirm(`Delete the empty “${myTvFolderFilter}” collection?`)) return
      const folder = myTvFolderFilter; myTvFolderFilter = '*'
      await manage('delete-my-tv-folder', { folder })
    }
