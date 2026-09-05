'use strict'

const librarySignalIcon = window.MabelPortalUI.icon

let viewingInsightsRange = 1
let openViewingSessionSwipe = null
let viewingInsightsData = null
let viewingInsightsLoadedRange = null
let selectedViewingItemKey = ''
let viewingInsightsRoute = { screen: 'dashboard' }
const viewingCharts = new Map()

function adultOptimisationLabel(film) {
      const state = film?.playback_state || 'original'
      const progress = Math.max(0, Math.min(100, Number(film?.playback_progress || 0)))
      if (state === 'processing') return `Optimising ${Math.round(progress)}%`
      if (state === 'queued') return 'Optimising · waiting'
      if (state === 'error') return 'Optimisation needs attention'
      return ''
    }

function adultOptimisationBadge(film) {
      const badge = document.createElement('span')
      badge.className = 'adult-optimisation-badge'
      badge.textContent = adultOptimisationLabel(film)
      badge.classList.toggle('hidden', !badge.textContent)
      return badge
    }

function updateAdultOptimisationCards(film) {
      document.querySelectorAll('[data-adult-path]').forEach(card => {
        if (card.dataset.adultPath !== film.path) return
        let badge = card.querySelector('.adult-optimisation-badge')
        if (!badge) {
          badge = adultOptimisationBadge(film)
          const art = card.querySelector('.watch-card-art')
          ;(art || card).append(badge)
        }
        badge.textContent = adultOptimisationLabel(film)
        badge.classList.toggle('hidden', !badge.textContent)
        card.classList.toggle('is-optimising', ['queued', 'processing'].includes(film.playback_state))
      })
    }

async function reloadLibraryWithoutLosingPlace() {
      const scrollY = window.scrollY
      const horizontal = [...document.querySelectorAll(
        '.watch-channel-rail,.watch-continue-rail,.home-poster-rail')]
        .map(element => ({ element, left: element.scrollLeft }))
      await load()
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' })
        horizontal.forEach(value => {
          if (value.element.isConnected) value.element.scrollLeft = value.left
        })
      }))
    }

async function pollAdultOptimisations() {
      clearTimeout(adultOptimisationRefresh)
      try {
        const result = await api('/api/adult/optimisations')
        const films = library?.adult_library || []
        result.items.forEach(item => {
          const film = films.find(value => value.path === item.path)
          if (!film) return
          film.playback_state = item.state
          film.playback_progress = item.progress
          film.playback_message = item.message
          updateAdultOptimisationCards(film)
        })
        if (!result.active && adultOptimisationWasActive) {
          adultOptimisationWasActive = false
          await reloadLibraryWithoutLosingPlace()
          return
        }
        adultOptimisationWasActive = result.active
        if (result.active) {
          adultOptimisationRefresh = setTimeout(
            () => pollAdultOptimisations().catch(() => {}), 1500)
        }
      } catch (_) {
        if ((library?.adult_library || []).some(film =>
          ['queued', 'processing'].includes(film.playback_state))) {
          adultOptimisationRefresh = setTimeout(
            () => pollAdultOptimisations().catch(() => {}), 3000)
        }
      }
    }

function renderAdultLibrary() {
      const films = library?.adult_library || []
      const folders = library?.adult_folders || []
      if (adultFolderFilter !== '*' && adultFolderFilter !== '' && !folders.includes(adultFolderFilter)) adultFolderFilter = '*'
      const folderName = adultFolderFilter === '*' ? 'All films' : (adultFolderFilter || 'Unfiled')
      $('#adultHeroCount').textContent = String(films.length)
      const uploadFolder = $('#adultUploadFolder')
      const uploadChoice = uploadFolder.value
      uploadFolder.innerHTML = '<option value="">Unfiled</option>'
      folders.forEach(folder => {
        const option = document.createElement('option'); option.value = folder; option.textContent = folder
        uploadFolder.append(option)
      })
      uploadFolder.value = folders.includes(uploadChoice) ? uploadChoice : ''

      const tabs = $('#adultFolderTabs'); tabs.innerHTML = ''
      const tabValues = [{ value: '*', name: 'All films' }, { value: '', name: 'Unfiled' },
        ...folders.map(folder => ({ value: folder, name: folder }))]
      tabValues.forEach(item => {
        const count = item.value === '*' ? films.length : films.filter(film => film.folder === item.value).length
        if (item.value === '' && count === 0) return
        const tab = document.createElement('button'); tab.type = 'button'
        tab.className = `adult-folder-tab${adultFolderFilter === item.value ? ' active' : ''}`
        tab.innerHTML = `<span>${escapeHtml(item.name)}</span><strong>${count}</strong>`
        tab.onclick = () => {
          adultFolderFilter = item.value
          if (currentPortalDesign !== 'experience') $('#adultCollectionSheet').close()
          renderAdultLibrary()
        }
        tabs.append(tab)
      })
      const realFolderSelected = adultFolderFilter !== '*' && adultFolderFilter !== ''
      $('#adultRenameFolder').disabled = !realFolderSelected
      $('#adultDeleteFolder').disabled = !realFolderSelected

      const root = $('#adultFilmList')
      root.innerHTML = ''
      if (!films.length) {
        root.append(portalEmptyState({
          title: 'No films yet',
          message: 'Upload one here and it will appear in Adult mode on the television.',
        }))
        return
      }
      const query = adultSearchText.trim().toLocaleLowerCase()
      const visibleFilms = (adultFolderFilter === '*' ? films
        : films.filter(film => film.folder === adultFolderFilter))
        .filter(film => !query || `${film.metadata?.title || ''} ${film.display_name} ${film.folder || ''}`.toLocaleLowerCase().includes(query))
      $('#adultFilmCount').textContent = `${visibleFilms.length} film${visibleFilms.length === 1 ? '' : 's'}`
      $('#adultCollectionName').textContent = folderName
      $('#adultLibrarySummary').textContent = query ? `Results for “${adultSearchText.trim()}”` : folderName === 'All films' ? 'Every film, in one place.' : `${folderName} collection`
      $('#adultSearchClear').classList.toggle('hidden', !adultSearchText)
      if (!visibleFilms.length) {
        root.append(portalEmptyState({
          title: query ? 'No matching films' : 'This collection is empty',
          message: query
            ? 'Try a different title.'
            : 'Move a film here or choose this collection while uploading.',
        }))
      }
      visibleFilms.forEach(film => {
        const row = document.createElement('button')
        row.type = 'button'; row.className = 'adult-film'
        row.dataset.adultPath = film.path
        const metadata = film.metadata || {}
        const poster = document.createElement(metadata.poster ? 'img' : 'span')
        poster.className = 'adult-film-poster'
        if (metadata.poster) {
          poster.src = `/api/adult/artwork/${encodeURIComponent(metadata.poster)}`
          poster.alt = `Poster for ${metadata.title || film.display_name}`
        }
        const copy = document.createElement('div')
        copy.className = 'adult-film-copy'
        const title = document.createElement('strong')
        title.textContent = metadata.title || film.display_name
        const meta = document.createElement('small')
        const state = film.playback_state || 'original'
        const stateLabel = adultOptimisationLabel(film) || (state === 'optimised' ? 'Pi ready' : state === 'error' ? 'Needs attention' : 'Original')
        meta.textContent = [metadata.year, film.folder || 'Unfiled', stateLabel].filter(Boolean).join(' · ')
        const more = document.createElement('span'); more.className = 'adult-film-more'
        more.setAttribute('aria-hidden', 'true')
        more.append(librarySignalIcon('signal-chevron-right'))
        copy.append(title, meta)
        row.append(poster, copy, more, adultOptimisationBadge(film))
        row.setAttribute('aria-label', `Open details for ${title.textContent}`)
        row.onclick = () => openAdultFilmSheet(film)
        root.append(row)
      })
      if (films.some(film => ['queued', 'processing'].includes(film.playback_state))) {
        adultOptimisationWasActive = true
        clearTimeout(adultOptimisationRefresh)
        adultOptimisationRefresh = setTimeout(
          () => pollAdultOptimisations().catch(() => {}), 500)
      }
    }

    function openAdultFilmSheet(film, returnTo = null) {
      selectedAdultFilm = film
      selectedAdultFilmReturnTo = returnTo
      const metadata = film.metadata || {}; const folders = library?.adult_folders || []
      const title = metadata.title || film.display_name
      $('#adultFilmSheetTitle').textContent = title
      $('#adultFilmSheetEyebrow').textContent = 'Film settings'
      const metaRoot = $('#adultFilmSheetMeta')
      metaRoot.innerHTML = ''
      ;[metadata.year, film.folder || 'Unfiled', `${(Number(film.size || 0) / 1073741824).toFixed(2)} GB`, film.playback_state === 'optimised' ? 'Optimised for Pi' : 'Original quality'].filter(Boolean).forEach(value => {
        const span = document.createElement('span')
        span.textContent = value
        metaRoot.append(span)
      })
      $('#adultFilmSheetOverview').textContent = metadata.overview || 'Manage this film without changing where you left off.'
      const artwork = metadata.poster ? artworkUrl(metadata.poster) : ''
      $('#adultFilmBackdrop').style.setProperty('--watch-film-art', artwork ? `url("${artwork}")` : 'linear-gradient(135deg,#2e3a34,#101513)')
      $('#adultFilmSheetPoster').replaceChildren(filmPoster(film))
      const select = $('#adultFilmFolder'); select.innerHTML = '<option value="">Unfiled</option>'
      folders.forEach(folder => { const option = document.createElement('option'); option.value = folder; option.textContent = folder; select.append(option) })
      select.value = film.folder || ''
      const busy = ['processing', 'queued'].includes(film.playback_state)
      const optimise = $('#adultFilmOptimise')
      optimise.disabled = busy || film.playback_state === 'optimised'
      optimise.querySelector('strong').textContent = film.playback_state === 'optimised' ? 'Already optimised' : busy ? adultOptimisationLabel(film) : 'Optimise for Pi'
      optimise.querySelector('small').textContent = film.playback_state === 'optimised'
        ? 'This film already uses the TV playback profile'
        : busy ? 'The playback copy is being prepared' : 'Prepare a smoother TV playback copy'
      const scan = $('#adultFilmScan')
      scan.disabled = !tmdbConfigured
      scan.querySelector('strong').textContent = metadata.tmdb_id ? 'Refresh metadata & subtitles' : 'Find metadata & subtitles'
      const removeProgress = $('#adultFilmRemoveProgress')
      removeProgress.classList.toggle('hidden', !watchFilmResumable(film))
      const sheet = $('#adultFilmSheet')
      portalSheets.open(sheet, {
        returnTo,
        focus: sheet.querySelector('.watch-film-panel'),
      })
    }

    async function scanTmdb(film, returnTo = null) {
      try {
        notice(`Searching TMDB for ${film.display_name}…`)
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
              portalSheets.dismiss($('#tmdbDialog')); await load(); notice('Film metadata, artwork, and available subtitles were saved locally.')
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
        notice(`Searching TMDB for ${programme.display_name}…`)
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
              await load(channel.number)
              notice('The selected film metadata and artwork were saved locally.')
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
        notice(`Searching TMDB for ${channel.name}…`)
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
              await load(channel.number)
              notice('The selected show metadata and channel artwork were saved locally.')
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
    $('#adultSearch').oninput = event => { adultSearchText = event.target.value; renderAdultLibrary() }
    $('#adultSearchClear').onclick = () => { adultSearchText = ''; $('#adultSearch').value = ''; renderAdultLibrary(); $('#adultSearch').focus() }
    $('#adultAddFilms').onclick = () => openLibrarySheet($('#adultUploadSheet'), $('#adultFile'))
    $('#adultCollectionTrigger').onclick = () => openLibrarySheet($('#adultCollectionSheet'))
    ;[
      [$('#adultUploadSheet'), $('#adultUploadClose')],
      [$('#adultCollectionSheet'), $('#adultCollectionClose')],
      [$('#adultFilmSheet'), $('#adultFilmClose')],
    ].forEach(([dialog, closeButton]) => portalSheets.wire(dialog, {
      closeButton,
      close: () => closeLibrarySheet(dialog),
      onClose: () => {
        if (dialog === $('#adultFilmSheet')) {
          selectedAdultFilm = null
          selectedAdultFilmReturnTo = null
        }
      },
    }))
    $('#adultFilmDownload').onclick = () => {
      const film = selectedAdultFilm
      if (!film) return
      closeLibrarySheet($('#adultFilmSheet'), false)
      downloadToDevice({ kind: 'adult', file: film.path }, film.metadata?.title || film.display_name)
    }
    $('#adultFilmMove').onclick = async () => { if (selectedAdultFilm) { const film = selectedAdultFilm; closeLibrarySheet($('#adultFilmSheet'), false); await manage('move-adult', { file: film.path, folder: $('#adultFilmFolder').value }) } }
    $('#adultFilmScan').onclick = () => {
      const film = selectedAdultFilm
      const parentReturn = selectedAdultFilmReturnTo
      if (film) {
        closeLibrarySheet($('#adultFilmSheet'), false)
        scanTmdb(film, () => openAdultFilmSheet(film, parentReturn))
      }
    }
    $('#adultFilmRename').onclick = () => { const film = selectedAdultFilm; if (!film) return; const name = prompt('Film name:', film.display_name); if (name?.trim()) { closeLibrarySheet($('#adultFilmSheet'), false); manage('rename-adult', { file: film.path, name: name.trim() }) } }
    $('#adultFilmOptimise').onclick = () => { const film = selectedAdultFilm; if (film && confirm(`Optimise “${film.display_name}” for the Pi? The original is replaced only after the new copy passes its checks.`)) { closeLibrarySheet($('#adultFilmSheet'), false); manage('optimise-adult', { file: film.path }) } }
    $('#adultFilmRemoveProgress').onclick = () => {
      const film = selectedAdultFilm
      if (!film) return
      const action = $('#adultFilmRemoveProgress')
      closeLibrarySheet($('#adultFilmSheet'), false)
      clearWatchFilmProgress(film, false, action).catch(showError)
    }
    $('#adultFilmRemove').onclick = () => { const film = selectedAdultFilm; if (film && confirm(`Move “${film.display_name}” to the recycle bin?`)) { closeLibrarySheet($('#adultFilmSheet'), false); manage('trash-adult', { file: film.path }) } }

    $('#adultCreateFolder').onclick = async () => {
      const name = $('#adultFolderName').value.trim()
      if (!name) return
      await manage('create-adult-folder', { name })
      $('#adultFolderName').value = ''
      adultFolderFilter = name
      renderAdultLibrary()
    }
    $('#adultRenameFolder').onclick = async () => {
      if (adultFolderFilter === '*' || adultFolderFilter === '') return
      const name = prompt('Collection name:', adultFolderFilter)
      if (!name?.trim()) return
      const oldFolder = adultFolderFilter
      adultFolderFilter = name.trim()
      await manage('rename-adult-folder', { folder: oldFolder, name: name.trim() })
    }
    $('#adultDeleteFolder').onclick = async () => {
      if (adultFolderFilter === '*' || adultFolderFilter === '') return
      if (!confirm(`Delete the empty “${adultFolderFilter}” collection?`)) return
      const folder = adultFolderFilter; adultFolderFilter = '*'
      await manage('delete-adult-folder', { folder })
    }
