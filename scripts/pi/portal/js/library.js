'use strict'

function librarySignalIcon(name, className = 'icon') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
      svg.classList.add(...className.split(' ').filter(Boolean))
      svg.setAttribute('aria-hidden', 'true')
      use.setAttribute('href', `/portal/icons.svg#${name}`)
      svg.append(use)
      return svg
    }

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
        root.innerHTML = '<div class="empty"><strong>No films yet</strong>Upload one here and it will appear in Adult mode on the television.</div>'
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
        root.innerHTML = `<div class="empty"><strong>${query ? 'No matching films' : 'This collection is empty'}</strong>${query ? 'Try a different title.' : 'Move a film here or choose this collection while uploading.'}</div>`
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
          root.innerHTML = '<div class="empty"><strong>No matches found</strong>Rename the film more precisely and scan again.</div>'
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
          root.innerHTML = '<div class="empty"><strong>No matches found</strong>Rename the film more precisely and search again.</div>'
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
          root.innerHTML = '<div class="empty"><strong>No matches found</strong>Check the channel name, save it, and search again.</div>'
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
    $('#tmdbClose').onclick = () => portalSheets.close(tmdbDialog)
    tmdbDialog.oncancel = event => {
      event.preventDefault()
      portalSheets.close(tmdbDialog)
    }
    tmdbDialog.onclick = event => {
      if (event.target === tmdbDialog) portalSheets.close(tmdbDialog)
    }
    $('#adultSearch').oninput = event => { adultSearchText = event.target.value; renderAdultLibrary() }
    $('#adultSearchClear').onclick = () => { adultSearchText = ''; $('#adultSearch').value = ''; renderAdultLibrary(); $('#adultSearch').focus() }
    $('#adultAddFilms').onclick = () => openLibrarySheet($('#adultUploadSheet'), $('#adultFile'))
    $('#adultCollectionTrigger').onclick = () => openLibrarySheet($('#adultCollectionSheet'))
    $('#adultUploadClose').onclick = () => closeLibrarySheet($('#adultUploadSheet'))
    $('#adultCollectionClose').onclick = () => closeLibrarySheet($('#adultCollectionSheet'))
    $('#adultFilmClose').onclick = () => closeLibrarySheet($('#adultFilmSheet'))
    ;[$('#adultUploadSheet'), $('#adultCollectionSheet'), $('#adultFilmSheet')].forEach(dialog => {
      dialog.onclick = event => { if (event.target === dialog) closeLibrarySheet(dialog) }
      dialog.oncancel = event => {
        event.preventDefault()
        closeLibrarySheet(dialog)
      }
      dialog.onclose = () => {
        if (!document.querySelector('dialog[open]')) document.documentElement.style.overflow = ''
        if (dialog === $('#adultFilmSheet')) {
          selectedAdultFilm = null
          selectedAdultFilmReturnTo = null
        }
      }
    })
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

    function formatBytes(bytes) {
      const value = Number(bytes || 0)
      if (value >= 1073741824) return `${(value / 1073741824).toFixed(1)} GB`
      return `${Math.max(1, Math.round(value / 1048576))} MB`
    }

    async function refreshUsb() {
      usbState = await api('/api/usb')
      const root = $('#usbDriveList')
      root.innerHTML = ''
      if (!usbState.volumes.length) root.innerHTML = '<div class="empty"><strong>No USB drive found</strong>Plug one into the Pi, wait a moment, then scan again.</div>'
      usbState.volumes.forEach(volume => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `usb-drive ${usbVolume === volume.id ? 'active' : ''}`
        row.append(librarySignalIcon('signal-hard-drive', 'usb-drive-icon'))
        const copy = document.createElement('div')
        copy.className = 'usb-drive-copy'
        const driveState = volume.mounted ? 'Ready' : volume.sleeping ? 'Sleeping · wakes automatically' : 'Ready to open'
        copy.innerHTML = `<strong>${escapeHtml(volume.label)}</strong><small>${escapeHtml(volume.filesystem)}${volume.size ? ` · ${formatBytes(volume.size)}` : ''} · ${driveState}</small>`
        const action = document.createElement('span')
        action.className = 'usb-drive-action'
        action.append(
          document.createTextNode(usbVolume === volume.id ? 'Browsing' : volume.mounted ? 'Browse' : volume.sleeping ? 'Wake & open' : 'Open safely'),
          librarySignalIcon('signal-chevron-right')
        )
        row.onclick = async () => {
          row.disabled = true
          try {
            if (!volume.mounted) await api('/api/usb', { method: 'POST', body: JSON.stringify({ action: 'mount', device: volume.device }) })
            usbVolume = volume.id
            usbPath = ''
            usbSelection.clear()
            await refreshUsb()
            await browseUsb('')
          } catch (error) { notice(error.message, true) }
          finally { row.disabled = false }
        }
        row.append(copy, action)
        root.append(row)
      })
      const active = usbState.volumes.find(volume => volume.id === usbVolume && volume.mounted)
      if (!active && usbVolume) {
        usbVolume = ''
        usbPath = ''
        usbEntries = []
        usbSelection.clear()
        renderUsbFiles()
      }
    }

    async function browseUsb(path) {
      if (!usbVolume) return
      const data = await api(`/api/usb/browse?volume=${encodeURIComponent(usbVolume)}&path=${encodeURIComponent(path)}`)
      usbPath = data.path
      usbEntries = data.entries
      renderUsbFiles()
      requestAnimationFrame(() => $('#usbBrowser').scrollIntoView({
        block: 'start', behavior: 'auto'
      }))
    }

    function renderUsbFiles() {
      const root = $('#usbFileList')
      root.innerHTML = ''
      const volume = usbState.volumes.find(item => item.id === usbVolume)
      const breadcrumb = $('#usbBreadcrumb')
      breadcrumb.replaceChildren()
      if (volume) {
        const parts = usbPath.split('/').filter(Boolean)
        $('#usbFolderTitle').textContent = parts.at(-1) || volume.label
        $('#usbPathContext').textContent = parts.length
          ? `${volume.label} · ${parts.slice(0, -1).join(' / ') || 'Drive root'}`
          : 'Drive root'
        const pathLabel = document.createElement('span')
        pathLabel.append(librarySignalIcon('signal-hard-drive'), document.createTextNode(
          [volume.label, ...parts].join(' / ')))
        breadcrumb.append(pathLabel)
      } else {
        const empty = document.createElement('span')
        empty.textContent = 'Choose a connected drive to begin'
        breadcrumb.append(empty)
        $('#usbFolderTitle').textContent = 'Choose a drive'
        $('#usbPathContext').textContent = 'Browse drive'
      }
      $('#usbUp').disabled = !usbVolume || !usbPath
      const visibleVideos = usbEntries.filter(entry => entry.type === 'video')
      const allVisibleSelected = visibleVideos.length > 0 && visibleVideos.every(entry => usbSelection.has(entry.path))
      $('#usbSelectAll').disabled = visibleVideos.length === 0
      $('#usbSelectAll').querySelector('span').textContent = allVisibleSelected ? 'Clear visible selection' : 'Select visible videos'
      $('#usbEject').classList.toggle('hidden', !usbVolume)
      if (!usbEntries.length) root.innerHTML = `<div class="empty"><strong>${usbVolume ? 'No videos here' : 'No drive selected'}</strong>${usbVolume ? 'Open another folder.' : 'Select a connected USB drive to browse its videos.'}</div>`
      usbEntries.forEach(entry => {
        const row = document.createElement('article')
        row.className = `usb-file is-${entry.type}${usbSelection.has(entry.path) ? ' selected' : ''}`
        if (entry.type === 'video') {
          const selector = document.createElement('label')
          selector.className = 'usb-file-select'
          const checkbox = document.createElement('input')
          checkbox.type = 'checkbox'
          checkbox.setAttribute('aria-label', `Select ${entry.name} to copy`)
          checkbox.checked = usbSelection.has(entry.path)
          checkbox.onchange = () => { checkbox.checked ? usbSelection.add(entry.path) : usbSelection.delete(entry.path); renderUsbFiles() }
          selector.append(checkbox, librarySignalIcon('signal-check'))
          row.append(selector)
        }
        const main = document.createElement(entry.type === 'folder' ? 'button' : 'div')
        if (entry.type === 'folder') main.type = 'button'
        main.className = 'usb-file-main'
        main.append(librarySignalIcon(entry.type === 'folder' ? 'signal-folder' : 'signal-film', 'usb-file-icon'))
        const copy = document.createElement('span')
        copy.className = 'usb-file-copy'
        copy.innerHTML = `<strong>${escapeHtml(entry.name)}</strong><small>${entry.type === 'folder' ? 'Folder · tap to open' : formatBytes(entry.size)}</small>`
        main.append(copy)
        if (entry.type === 'folder') {
          main.append(librarySignalIcon('signal-chevron-right', 'usb-file-chevron'))
          main.onclick = () => browseUsb(entry.path).catch(error => notice(error.message, true))
        }
        row.append(main)
        const actions = document.createElement('div')
        actions.className = 'usb-file-actions'
        if (entry.type === 'folder') {
          const select = document.createElement('button')
          select.type = 'button'; select.className = 'usb-folder-toggle'
          select.setAttribute('aria-label', `${usbSelection.has(entry.path) ? 'Remove' : 'Select'} ${entry.name} for copying`)
          select.setAttribute('aria-pressed', String(usbSelection.has(entry.path)))
          select.append(librarySignalIcon(usbSelection.has(entry.path) ? 'signal-check' : 'signal-plus'))
          select.onclick = () => { usbSelection.has(entry.path) ? usbSelection.delete(entry.path) : usbSelection.add(entry.path); renderUsbFiles() }
          actions.append(select)
        } else {
          const watch = document.createElement('button')
          watch.type = 'button'; watch.className = 'secondary'
          watch.append(librarySignalIcon('signal-play'), document.createTextNode(entry.browser_ready ? 'Watch here' : 'Play in VLC'))
          watch.title = entry.browser_ready ? 'Stream this file directly from the USB drive' : 'Open the original file directly in VLC'
          watch.onclick = entry.browser_ready
            ? () => openRemotePlayer({ kind: 'usb', volume: usbVolume, file: entry.path })
            : () => openInVlc({ kind: 'usb', volume: usbVolume, file: entry.path }, entry.name)
          const download = document.createElement('button')
          download.type = 'button'; download.className = 'secondary'
          download.append(librarySignalIcon('signal-download'), document.createTextNode('Download'))
          download.onclick = () => downloadToDevice(
            { kind: 'usb', volume: usbVolume, file: entry.path }, entry.name)
          const play = document.createElement('button')
          play.type = 'button'; play.className = 'secondary'
          play.append(librarySignalIcon('signal-monitor-play'), document.createTextNode('Play on TV'))
          play.onclick = async () => {
            if (!confirm(`Play “${entry.name}” directly from the USB drive on the TV?`)) return
            play.disabled = true
            try {
              const result = await api('/api/usb', { method: 'POST', body: JSON.stringify({ action: 'play', volume: usbVolume, path: entry.path }) })
              notice(result.message)
            } catch (error) { notice(error.message, true) }
            finally { play.disabled = false }
          }
          actions.append(watch, download, play)
        }
        row.append(actions)
        root.append(row)
      })
      updateUsbSelection()
    }

    function updateUsbSelection() {
      $('#usbSelectionCount').textContent = usbSelection.size ? `${usbSelection.size} item${usbSelection.size === 1 ? '' : 's'} selected` : 'Nothing selected'
      $('#usbImportSummary').textContent = usbSelection.size
        ? `${usbSelection.size} item${usbSelection.size === 1 ? '' : 's'} ready to copy. Originals stay on the drive.`
        : 'Choose videos or folders above.'
      $('#usbImport').disabled = !usbVolume || usbSelection.size === 0
      if ($('#usbTarget').value === 'series' && usbSelection.size === 1
          && !$('#usbSeriesName').value.trim()) {
        const entry = usbEntries.find(value => value.path === [...usbSelection][0])
        if (entry?.type === 'folder') $('#usbSeriesName').value = entry.name
      }
    }

    function viewingDuration(seconds) {
      const minutes = Math.max(0, Math.round(Number(seconds || 0) / 60))
      const hours = Math.floor(minutes / 60)
      const remainder = minutes % 60
      return hours ? `${hours}h ${remainder}m` : `${minutes}m`
    }

    function viewingDate(value) {
      if (!value) return 'Not watched yet'
      return new Intl.DateTimeFormat(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
      }).format(new Date(value))
    }

    function viewingArtworkUrl(value) {
      return value ? `/api/channel/artwork/${encodeURIComponent(value)}` : ''
    }

    function viewingCatalog() {
      const insightMap = new Map((viewingInsightsData?.items || []).map(item => [item.item_key, item]))
      const channels = []
      const films = []
      ;(library?.channels || []).forEach(channel => {
        const channelNumber = Number(channel.number)
        if (channel.content_type === 'films') {
          ;(channel.programmes || []).forEach(programme => {
            const itemKey = `channel:${channelNumber}:${String(programme.name || '').toLocaleLowerCase()}`
            const tracked = insightMap.get(itemKey) || {}
            films.push({
              ...viewingEmptyItem('film'), ...tracked, item_key: itemKey, kind: 'film',
              channel_number: channelNumber,
              title: programme.metadata?.title || programme.display_name || programme.name,
              source: channel.name,
              artwork: viewingArtworkUrl(programme.metadata?.poster),
            })
          })
        } else {
          const itemKey = `channel:${channelNumber}`
          channels.push({
            ...viewingEmptyItem('channel'), ...(insightMap.get(itemKey) || {}),
            item_key: itemKey, kind: 'channel', channel_number: channelNumber,
            title: channel.name, source: 'MabelTV series channel',
            artwork: viewingArtworkUrl(channel.metadata?.artwork),
          })
        }
      })
      const sort = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      return { channels: channels.sort(sort), films: films.sort(sort) }
    }

    function viewingEmptyItem(kind) {
      const named = names => names.map(name => ({ name, label: name, seconds: 0, sessions: 0 }))
      return {
        seconds: 0, sessions: 0, active_days: 0, average_session_seconds: 0,
        longest_session_seconds: 0, share: 0, busiest_period: 'Not watched yet',
        first_watched: '', last_watched: '', timeline: [],
        time_of_day: named(['Overnight', 'Morning', 'Afternoon', 'Evening']),
        hourly: Array.from({ length: 24 }, (_, hour) => ({
          name: String(hour), label: `${hour}:00`, seconds: 0, sessions: 0,
        })),
        weekdays: named(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
        by_surface: [], average_progress: 0, furthest_progress: 0,
        completion_sessions: 0, kind,
      }
    }

    function destroyViewingChart(root) {
      const chart = viewingCharts.get(root)
      if (chart) chart.destroy()
      viewingCharts.delete(root)
      root.replaceChildren()
    }

    function renderViewingChart(root, values, type = 'line', labels = {}) {
      if (!root) return
      destroyViewingChart(root)
      const usable = (values || []).map(item => ({
        ...item, chartLabel: labels[item.name] || item.label || item.name,
        minutes: Math.round(Number(item.seconds || 0) / 60),
      }))
      if (!usable.length || !usable.some(item => item.minutes > 0) || typeof Chart === 'undefined') {
        const empty = document.createElement('p')
        empty.className = 'viewing-empty viewing-chart-empty'
        empty.textContent = typeof Chart === 'undefined'
          ? 'The chart is temporarily unavailable.' : 'Viewing will appear here as it is watched.'
        root.append(empty)
        return
      }
      const canvas = document.createElement('canvas')
      root.append(canvas)
      const css = getComputedStyle(document.body)
      const orange = css.getPropertyValue('--experience-orange').trim() || '#ff7a1a'
      const muted = css.getPropertyValue('--experience-dim').trim() || '#8f8d98'
      const grid = css.getPropertyValue('--experience-line').trim() || 'rgba(255,255,255,.1)'
      const isDoughnut = type === 'doughnut'
      const config = {
        type,
        data: {
          labels: usable.map(item => item.chartLabel),
          datasets: [{
            data: usable.map(item => item.minutes),
            borderColor: orange,
            backgroundColor: isDoughnut
              ? [orange, '#7c4dff', '#45b8ff', '#55d6a5']
              : type === 'bar' ? orange : 'transparent',
            borderWidth: type === 'line' ? 2.5 : isDoughnut ? 0 : 1,
            borderRadius: type === 'bar' ? 7 : 0,
            borderSkipped: false,
            fill: false,
            tension: .32,
            pointRadius: type === 'line' ? 3 : 0,
            pointHoverRadius: 5,
            pointBackgroundColor: orange,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 320 },
          plugins: {
            legend: { display: isDoughnut, position: 'bottom', labels: { color: muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14, font: { size: 10 } } },
            tooltip: { callbacks: { label: context => `${context.label}: ${viewingDuration(Number(context.raw || 0) * 60)}` } },
          },
          scales: isDoughnut ? {} : {
            x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 9 } }, border: { display: false } },
            y: { beginAtZero: true, grid: { color: grid }, ticks: { color: muted, maxTicksLimit: 4, callback: value => viewingDuration(Number(value) * 60), font: { size: 9 } }, border: { display: false } },
          },
          cutout: isDoughnut ? '62%' : undefined,
        },
      }
      const chart = new Chart(canvas, config)
      viewingCharts.set(root, chart)
      root.setAttribute('aria-label', usable.map(item =>
        `${item.chartLabel} ${viewingDuration(item.seconds)}`).join(', '))
    }

    function setViewingArtwork(root, url) {
      root.classList.toggle('has-artwork', Boolean(url))
      root.style.backgroundImage = url ? `url("${url}")` : ''
    }

    function showViewingScreen(screen) {
      $$('.viewing-screen').forEach(root => root.classList.add('hidden'))
      screen?.classList.remove('hidden')
    }

    function pushInsightsRoute(path) {
      const parent = location.hash.startsWith('#insights') ? location.hash.slice(1) : 'insights'
      history.pushState({ insightsChild: true, insightsParent: parent }, '', `#${path}`)
      openInsightsRoute(path)
    }

    function replaceInsightsRoute(path) {
      history.replaceState({ ...history.state, insightsChild: true }, '', `#${path}`)
      openInsightsRoute(path)
    }

    function insightsParentRoute() {
      if (viewingInsightsRoute.screen === 'item') {
        return viewingItem(viewingInsightsRoute.itemKey)?.kind === 'film' ? 'insights/films' : 'insights/channels'
      }
      if (viewingInsightsRoute.screen === 'period') return 'insights/diary'
      return 'insights'
    }

    function navigateInsightsBack() {
      const target = insightsParentRoute()
      if (history.state?.insightsParent === target) history.back()
      else replaceInsightsRoute(target)
    }

    function openViewingItem(itemKey, tab = 'summary') {
      pushInsightsRoute(`insights/item/${encodeURIComponent(itemKey)}/${tab}`)
    }

    function viewingItem(itemKey) {
      const catalog = viewingCatalog()
      return [...catalog.channels, ...catalog.films].find(item => item.item_key === itemKey)
    }

    function renderViewingMosaic(root, items) {
      root.replaceChildren()
      items.filter(item => item.artwork).slice(0, 3).forEach(item => {
        const image = document.createElement('span')
        image.style.backgroundImage = `url("${item.artwork}")`
        root.append(image)
      })
      if (!root.children.length) root.append(librarySignalIcon('signal-film'))
    }

    function renderViewingHighlights() {
      const root = $('#viewingHighlights')
      root.replaceChildren()
      const catalog = viewingCatalog()
      const values = [...catalog.channels.filter(item => item.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 1),
        ...catalog.films.filter(item => item.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 2)]
      if (!values.length) {
        root.innerHTML = '<p class="viewing-empty">Highlights will appear after MabelTV has been watched.</p>'
        return
      }
      values.forEach(item => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `viewing-highlight ${item.kind}`
        if (item.artwork) button.style.backgroundImage = `linear-gradient(0deg, rgba(8,8,11,.96), rgba(8,8,11,.06) 76%), url("${item.artwork}")`
        const copy = document.createElement('span')
        copy.innerHTML = `<small>${item.kind === 'film' ? item.source : `CH ${item.channel_number}`}</small><strong></strong><span></span>`
        copy.querySelector('strong').textContent = item.title
        copy.querySelector('span').textContent = `${viewingDuration(item.seconds)} watched`
        button.append(copy)
        button.onclick = () => openViewingItem(item.item_key)
        root.append(button)
      })
    }

    function renderViewingBrowse(kind) {
      const isFilms = kind === 'films'
      const values = viewingCatalog()[kind]
      const query = $('#viewingBrowseSearch').value.trim().toLocaleLowerCase()
      const filtered = values.filter(item => item.title.toLocaleLowerCase().includes(query))
      $('#viewingBrowseKicker').textContent = isFilms ? 'MabelTV film library' : 'MabelTV series library'
      $('#viewingBrowseTitle').textContent = isFilms ? 'Every film' : 'Every channel'
      $('#viewingBrowseIntro').textContent = isFilms
        ? 'Choose any film — watched or not — for its progress and viewing patterns.'
        : 'Choose any series channel — watched or not — for its complete viewing story.'
      $('#viewingBrowseCount').textContent = String(values.length)
      $('#viewingBrowseSearch').placeholder = isFilms ? 'Search films' : 'Search channels'
      const root = $('#viewingBrowseGrid')
      root.replaceChildren()
      filtered.forEach(item => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `viewing-catalog-card ${item.kind}`
        const art = document.createElement('span')
        art.className = 'viewing-catalog-art'
        if (item.artwork) art.style.backgroundImage = `url("${item.artwork}")`
        else art.append(librarySignalIcon(item.kind === 'film' ? 'signal-film' : 'signal-tv'))
        const copy = document.createElement('span')
        copy.className = 'viewing-catalog-copy'
        const label = document.createElement('small')
        label.textContent = item.kind === 'film' ? item.source : `CH ${item.channel_number}`
        const title = document.createElement('strong')
        title.textContent = item.title
        const watched = document.createElement('span')
        watched.textContent = item.seconds > 0
          ? `${viewingDuration(item.seconds)} · ${item.sessions} ${item.sessions === 1 ? 'watch' : 'watches'}`
          : 'Not watched in this period'
        copy.append(label, title, watched)
        button.append(art, copy)
        button.onclick = () => openViewingItem(item.item_key)
        root.append(button)
      })
      if (!filtered.length) root.innerHTML = '<p class="viewing-empty">Nothing matches that search.</p>'
      showViewingScreen($('#viewingBrowse'))
    }

    function renderViewingItem(item, tab = 'summary') {
      if (!item) { pushInsightsRoute('insights'); return }
      selectedViewingItemKey = item.item_key
      $('#viewingItemBackLabel').textContent = item.kind === 'film' ? 'All films' : 'All channels'
      $('#viewingItemKicker').textContent = item.kind === 'film' ? 'Film insight' : 'Channel insight'
      $('#viewingItemTitle').textContent = item.title
      $('#viewingItemSource').textContent = item.kind === 'channel'
        ? `CH ${item.channel_number} · MabelTV series channel` : `CH ${item.channel_number} · ${item.source}`
      $('#viewingItemRangeSelect').value = String(viewingInsightsRange)
      setViewingArtwork($('#viewingItemArtwork'), item.artwork)
      $('#viewingItemTotal').textContent = viewingDuration(item.seconds)
      $('#viewingItemSessions').textContent = String(item.sessions || 0)
      $('#viewingItemDays').textContent = String(item.active_days || 0)
      $('#viewingItemAverage').textContent = viewingDuration(item.average_session_seconds)
      $('#viewingItemShare').textContent = `${Math.round(Number(item.share || 0) * 100)}%`
      $('#viewingItemPeriod').textContent = item.seconds ? item.busiest_period : 'Not watched yet'
      $('#viewingItemFirst').textContent = viewingDate(item.first_watched)
      $('#viewingItemLast').textContent = viewingDate(item.last_watched)
      $('#viewingItemLongest').textContent = `Longest ${viewingDuration(item.longest_session_seconds)}`
      $('#viewingFilmProgress').classList.toggle('hidden', item.kind !== 'film')
      if (item.kind === 'film') {
        $('#viewingFilmAverage').textContent = `${Math.round(Number(item.average_progress || 0) * 100)}%`
        $('#viewingFilmFurthest').textContent = `${Math.round(Number(item.furthest_progress || 0) * 100)}%`
        $('#viewingFilmCompletions').textContent = String(item.completion_sessions || 0)
      }
      $('#viewingItemTimelineTitle').textContent = viewingInsightsRange === 1
        ? 'Today hour by hour' : viewingInsightsRange === 365 ? 'Month by month' : 'Day by day'
      $$('[data-insights-tab]').forEach(button => button.classList.toggle('active', button.dataset.insightsTab === tab))
      $('#viewingItemSummary').classList.toggle('hidden', tab !== 'summary')
      $('#viewingItemPatterns').classList.toggle('hidden', tab !== 'patterns')
      $('#viewingItemHistory').classList.toggle('hidden', tab !== 'history')
      showViewingScreen($('#viewingItemDetail'))
      renderViewingChart($('#viewingItemTimeline'), item.timeline || [], 'line')
      renderViewingChart($('#viewingItemHourly'), item.hourly || [], 'line')
      renderViewingChart($('#viewingItemTime'), item.time_of_day || [], 'bar')
      renderViewingChart($('#viewingItemWeekdays'), item.weekdays || [], 'bar')
      renderViewingChart($('#viewingItemSurfaces'), item.by_surface || [], 'doughnut', {
        tv: 'On the TV', device: 'On this device',
      })
      const sessions = (viewingInsightsData?.sessions || []).filter(value => value.item_key === item.item_key)
      renderViewingSessions(sessions, { root: $('#viewingItemSessionList'), title: $('#viewingItemSessionTitle'), count: $('#viewingItemSessionCount'), scoped: true })
    }

    function localDateKey(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    const viewingPeriodNames = ['Overnight', 'Morning', 'Afternoon', 'Evening']

    function sessionsForViewingPeriod(dateKey, period) {
      return (viewingInsightsData?.sessions || []).filter(item => {
        const started = new Date(item.started || item.when)
        return localDateKey(started) === dateKey && Math.floor(started.getHours() / 6) === period
      }).sort((a, b) => new Date(a.started) - new Date(b.started))
    }

    function viewingDateKeys() {
      const span = viewingInsightsRange
      return Array.from({ length: span }, (_, index) => {
        const date = new Date()
        date.setHours(12, 0, 0, 0)
        date.setDate(date.getDate() - (span - index - 1))
        return localDateKey(date)
      })
    }

    function renderViewingDiary() {
      const root = $('#viewingDiaryDays')
      root.replaceChildren()
      const keys = viewingDateKeys().reverse()
      keys.filter((key, index) => index < 2 || viewingPeriodNames.some((_, period) =>
        sessionsForViewingPeriod(key, period).length)).forEach(key => {
        const day = document.createElement('section')
        day.className = 'viewing-diary-day'
        const date = new Date(`${key}T12:00:00`)
        const heading = document.createElement('header')
        const title = document.createElement('h3')
        title.textContent = key === localDateKey(new Date()) ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
        heading.append(title)
        const periods = document.createElement('div')
        periods.className = 'viewing-diary-periods'
        viewingPeriodNames.forEach((name, period) => {
          const sessions = sessionsForViewingPeriod(key, period)
          const total = sessions.reduce((sum, item) => sum + Number(item.seconds || 0), 0)
          const button = document.createElement('button')
          button.type = 'button'
          button.innerHTML = `<span><small>${name}</small><strong>${viewingDuration(total)}</strong></span><span class="viewing-period-thumbs"></span><svg><use href="/portal/icons.svg#signal-chevron-right"/></svg>`
          const thumbs = button.querySelector('.viewing-period-thumbs')
          ;[...new Set(sessions.map(item => item.item_key))].slice(0, 3).forEach(itemKey => {
            const item = viewingItem(itemKey)
            if (!item?.artwork) return
            const thumb = document.createElement('i')
            thumb.style.backgroundImage = `url("${item.artwork}")`
            thumbs.append(thumb)
          })
          button.onclick = () => pushInsightsRoute(`insights/period/${key}/${period}`)
          periods.append(button)
        })
        day.append(heading, periods)
        root.append(day)
      })
      showViewingScreen($('#viewingDiary'))
    }

    function renderViewingPeriod(dateKey, period) {
      const sessions = sessionsForViewingPeriod(dateKey, period)
      const total = sessions.reduce((sum, item) => sum + Number(item.seconds || 0), 0)
      const date = new Date(`${dateKey}T12:00:00`)
      $('#viewingPeriodDate').textContent = dateKey === localDateKey(new Date()) ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
      $('#viewingPeriodTitle').textContent = viewingPeriodNames[period]
      $('#viewingPeriodSummary').textContent = sessions.length
        ? `${viewingDuration(total)} across ${sessions.length} viewing ${sessions.length === 1 ? 'entry' : 'entries'}`
        : 'No qualifying viewing in this part of the day'
      const stats = $('#viewingPeriodStats')
      const unique = new Set(sessions.map(item => item.item_key)).size
      const channels = new Set(sessions.map(item => item.channel_number)).size
      stats.innerHTML = `<article><svg><use href="/portal/icons.svg#signal-clock"/></svg><span>Total watched</span><strong>${viewingDuration(total)}</strong></article><article><svg><use href="/portal/icons.svg#signal-play"/></svg><span>Things watched</span><strong>${unique}</strong></article><article><svg><use href="/portal/icons.svg#signal-tv"/></svg><span>Channels visited</span><strong>${channels}</strong></article><article><svg><use href="/portal/icons.svg#signal-history"/></svg><span>Longest watch</span><strong>${viewingDuration(Math.max(0, ...sessions.map(item => Number(item.seconds || 0))))}</strong></article>`
      const root = $('#viewingPeriodEntries')
      root.replaceChildren()
      if (!sessions.length) root.innerHTML = '<p class="viewing-empty">Nothing lasting two minutes or more was watched here.</p>'
      sessions.forEach((session, index) => {
        const item = viewingItem(session.item_key)
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'viewing-period-entry'
        const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(session.started))
        row.innerHTML = `<span class="viewing-period-number">${index + 1}</span><span class="viewing-period-entry-art"></span><span><small>${time} · ${session.source}</small><strong></strong><span>${session.duration}</span></span><svg><use href="/portal/icons.svg#signal-chevron-right"/></svg>`
        row.querySelector('strong').textContent = session.title
        const art = row.querySelector('.viewing-period-entry-art')
        if (item?.artwork) art.style.backgroundImage = `url("${item.artwork}")`
        row.onclick = () => openViewingItem(session.item_key, 'history')
        root.append(row)
      })
      const allKeys = viewingDateKeys()
      const flatIndex = allKeys.indexOf(dateKey) * 4 + period
      const move = delta => {
        const next = flatIndex + delta
        if (next < 0 || next >= allKeys.length * 4) return
        pushInsightsRoute(`insights/period/${allKeys[Math.floor(next / 4)]}/${next % 4}`)
      }
      $('#viewingPeriodPrevious').disabled = flatIndex <= 0
      $('#viewingPeriodNext').disabled = flatIndex >= allKeys.length * 4 - 1
      $('#viewingPeriodPrevious').onclick = () => move(-1)
      $('#viewingPeriodNext').onclick = () => move(1)
      showViewingScreen($('#viewingPeriod'))
    }

    function renderInsightsRoute() {
      if (!viewingInsightsData) return
      const route = viewingInsightsRoute
      if (route.screen === 'channels' || route.screen === 'films') renderViewingBrowse(route.screen)
      else if (route.screen === 'item') renderViewingItem(viewingItem(route.itemKey), route.tab)
      else if (route.screen === 'diary') renderViewingDiary()
      else if (route.screen === 'period') renderViewingPeriod(route.date, route.period)
      else {
        selectedViewingItemKey = ''
        renderViewingHighlights()
        const catalog = viewingCatalog()
        renderViewingMosaic($('#viewingChannelMosaic'), catalog.channels)
        renderViewingMosaic($('#viewingFilmMosaic'), catalog.films)
        $('#viewingChannelSummary').textContent = `${catalog.channels.length} channels · every viewing pattern`
        $('#viewingFilmSummary').textContent = `${catalog.films.length} films · progress and repeats`
        showViewingScreen($('#viewingDashboard'))
      }
    }

    function openInsightsRoute(requested) {
      const previousScreen = viewingInsightsRoute.screen
      const item = requested.match(/^insights\/item\/(.+)\/(summary|patterns|history)$/)
      const period = requested.match(/^insights\/period\/(\d{4}-\d{2}-\d{2})\/([0-3])$/)
      if (item) viewingInsightsRoute = { screen: 'item', itemKey: decodeURIComponent(item[1]), tab: item[2] }
      else if (period) viewingInsightsRoute = { screen: 'period', date: period[1], period: Number(period[2]) }
      else if (requested === 'insights/channels') viewingInsightsRoute = { screen: 'channels' }
      else if (requested === 'insights/films') viewingInsightsRoute = { screen: 'films' }
      else if (requested === 'insights/diary') viewingInsightsRoute = { screen: 'diary' }
      else viewingInsightsRoute = { screen: 'dashboard' }
      if ((viewingInsightsRoute.screen === 'channels' || viewingInsightsRoute.screen === 'films')
          && viewingInsightsRoute.screen !== previousScreen && $('#viewingBrowseSearch')) {
        $('#viewingBrowseSearch').value = ''
      }
      $('.insights-page')?.classList.toggle('is-child', viewingInsightsRoute.screen !== 'dashboard')
      $('#viewingRangeControls')?.classList.toggle('hidden', viewingInsightsRoute.screen !== 'dashboard')
      openView('insights', { instantScroll: true })
      renderInsightsRoute()
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
    }
    window.openInsightsRoute = openInsightsRoute
    if (location.hash === '#insights' || location.hash.startsWith('#insights/')) {
      queueMicrotask(() => openInsightsRoute(location.hash.slice(1)))
    }

    function setViewingSessionSwipe(wrapper, open, animate = true) {
      if (!wrapper) return
      wrapper.classList.toggle('swiping', !animate)
      wrapper.classList.toggle('open', open)
      wrapper.style.removeProperty('--viewing-swipe-offset')
      if (open) {
        if (openViewingSessionSwipe && openViewingSessionSwipe !== wrapper) {
          setViewingSessionSwipe(openViewingSessionSwipe, false)
        }
        openViewingSessionSwipe = wrapper
      } else if (openViewingSessionSwipe === wrapper) {
        openViewingSessionSwipe = null
      }
    }

    function bindViewingSessionSwipe(wrapper, surface) {
      const revealWidth = 86
      let pointerId = null
      let startX = 0
      let startY = 0
      let startOffset = 0
      let offset = 0
      let horizontal = false
      let suppressClick = false

      surface.onpointerdown = event => {
        if (event.button !== undefined && event.button !== 0) return
        pointerId = event.pointerId
        startX = event.clientX
        startY = event.clientY
        startOffset = wrapper.classList.contains('open') ? -revealWidth : 0
        offset = startOffset
        horizontal = false
      }
      surface.onpointermove = event => {
        if (pointerId !== event.pointerId) return
        const deltaX = event.clientX - startX
        const deltaY = event.clientY - startY
        if (!horizontal && Math.abs(deltaX) < 7) return
        if (!horizontal && Math.abs(deltaY) > Math.abs(deltaX)) {
          pointerId = null
          return
        }
        horizontal = true
        surface.setPointerCapture?.(event.pointerId)
        offset = Math.max(-revealWidth, Math.min(0, startOffset + deltaX))
        wrapper.classList.add('swiping')
        wrapper.style.setProperty('--viewing-swipe-offset', `${offset}px`)
        if (event.cancelable) event.preventDefault()
      }
      const finish = event => {
        if (pointerId !== event.pointerId) return
        const wasHorizontal = horizontal
        const shouldOpen = wasHorizontal
          ? offset < -(revealWidth * .42)
          : wrapper.classList.contains('open')
        pointerId = null
        horizontal = false
        suppressClick = wasHorizontal
        if (wasHorizontal) setTimeout(() => { suppressClick = false }, 350)
        setViewingSessionSwipe(wrapper, shouldOpen)
      }
      surface.onpointerup = finish
      surface.onpointercancel = finish
      surface.onclick = event => {
        if (suppressClick) {
          suppressClick = false
          event.preventDefault()
          return
        }
        if (!wrapper.classList.contains('open')) return
        event.preventDefault()
        setViewingSessionSwipe(wrapper, false)
      }
    }

    function renderViewingSessions(values, options = {}) {
      const root = options.root || $('#viewingSessions')
      const titleRoot = options.title || $('#viewingSessionTitle')
      const countRoot = options.count || $('#viewingSessionCount')
      root.replaceChildren()
      openViewingSessionSwipe = null
      titleRoot.textContent = options.scoped ? 'Recent viewing'
        : viewingInsightsRange === 1 ? 'Today' : 'Viewing in this period'
      countRoot.textContent = values.length
        ? `${values.length} viewing ${values.length === 1 ? 'entry' : 'entries'}` : 'No activity'
      if (!values.length) {
        const empty = document.createElement('p')
        empty.className = 'viewing-empty'
        empty.textContent = options.scoped ? 'No qualifying viewing for this item in this period.'
          : viewingInsightsRange === 1
          ? 'No MabelTV viewing has reached two minutes today.'
          : 'No qualifying MabelTV viewing in this period.'
        root.append(empty)
        return
      }
      const timeFormat = new Intl.DateTimeFormat(undefined, {
        weekday: viewingInsightsRange === 1 ? undefined : 'short',
        hour: 'numeric', minute: '2-digit',
      })
      let previousDay = ''
      values.forEach(item => {
        const dayKey = new Date(item.when).toLocaleDateString()
        if (viewingInsightsRange !== 1 && dayKey !== previousDay) {
          const day = document.createElement('p')
          day.className = 'viewing-session-day'
          day.textContent = new Intl.DateTimeFormat(undefined, {
            weekday: 'long', day: 'numeric', month: 'short',
          }).format(new Date(item.when))
          root.append(day)
          previousDay = dayKey
        }
        const wrapper = document.createElement('div')
        wrapper.className = 'viewing-session-swipe'
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'viewing-session-delete'
        remove.setAttribute('aria-label', `Delete ${item.title} from viewing insights`)
        remove.append(librarySignalIcon('signal-trash'), document.createElement('span'))
        remove.querySelector('span').textContent = 'Delete'
        const row = document.createElement('div')
        row.className = 'viewing-session-row'
        const icon = document.createElement('span')
        icon.className = `viewing-session-icon ${item.kind === 'film' ? 'film' : 'channel'}`
        icon.append(librarySignalIcon(item.kind === 'film' ? 'signal-film' : 'signal-tv'))
        const copy = document.createElement('span')
        copy.className = 'viewing-session-copy'
        const title = document.createElement('strong')
        title.textContent = item.title
        const details = document.createElement('small')
        const surface = item.surface === 'device' ? 'This device' : 'TV'
        let detail = `${item.source} · ${surface} · ${timeFormat.format(new Date(item.when))}`
        if (item.kind === 'film' && Number(item.media_duration) > 0) {
          detail += ` · ${Math.round(Number(item.progress) * 100)}% through film`
        }
        details.textContent = detail
        copy.append(title, details)
        const duration = document.createElement('b')
        duration.textContent = item.duration || viewingDuration(item.seconds)
        row.append(icon, copy, duration)
        wrapper.append(remove, row)
        bindViewingSessionSwipe(wrapper, row)
        remove.onfocus = () => setViewingSessionSwipe(wrapper, true)
        remove.onclick = async () => {
          remove.disabled = true
          wrapper.classList.add('deleting')
          try {
            await api('/api/viewing-insights/delete', {
              method: 'POST', body: JSON.stringify({ ids: [item.id] }),
            })
            await loadViewingInsights(true)
            notice('Viewing session deleted.')
          } catch (error) {
            wrapper.classList.remove('deleting')
            remove.disabled = false
            setViewingSessionSwipe(wrapper, false)
            notice(error.message, true)
          }
        }
        root.append(wrapper)
      })
    }

    async function loadViewingInsights(force = false) {
      const loading = $('#viewingInsightsLoading')
      const root = $('#viewingInsights')
      if (!loading || !root || offlineMode) return
      loading.classList.add('hidden')
      if (!force && viewingInsightsData && viewingInsightsLoadedRange === viewingInsightsRange) {
        renderInsightsRoute()
        root.classList.remove('hidden')
        return
      }
      try {
        const data = await api(`/api/viewing-insights?days=${viewingInsightsRange}&timezone_offset=${new Date().getTimezoneOffset()}`)
        viewingInsightsData = data
        viewingInsightsLoadedRange = viewingInsightsRange
        const rangeLabels = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days', 365: 'Last 12 months' }
        const rangeLabel = rangeLabels[viewingInsightsRange] || 'Viewing activity'
        $('#viewingOverviewTitle').textContent = rangeLabel
        $('#viewingActiveDays').textContent = String(data.summary.active_days)
        $('#viewingRangeTotal').textContent = viewingDuration(data.summary.range_seconds)
        $('#viewingSessionTotal').textContent = String(data.summary.sessions || 0)
        $('#viewingLongestSession').textContent = viewingDuration(data.summary.longest_session_seconds)
        $('#viewingBusiestPeriod').textContent = data.summary.busiest_period || '—'
        const current = Number(data.summary.range_seconds) || 0
        const previous = Number(data.summary.previous_range_seconds) || 0
        const comparison = $('#viewingComparison')
        comparison.classList.remove('up', 'down')
        if (!current && !previous) comparison.textContent = 'No activity in this period'
        else if (!previous) { comparison.textContent = 'First activity in this period'; comparison.classList.add('up') }
        else {
          const change = Math.round((current - previous) / previous * 100)
          comparison.textContent = change === 0 ? 'Same as the previous period'
            : `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than the previous period`
          comparison.classList.add(change >= 0 ? 'up' : 'down')
        }
        $('#viewingTimelineTitle').textContent = viewingInsightsRange === 1
          ? 'Today by time of day' : viewingInsightsRange === 365
            ? 'Month by month' : 'Day by day'
        const sessions = Number(data.summary.sessions) || 0
        $('#viewingSessionSummary').textContent = sessions
          ? `${sessions} ${sessions === 1 ? 'entry' : 'entries'} · longest ${viewingDuration(data.summary.longest_session_seconds)}`
          : 'No activity'
        renderViewingChart($('#viewingTimelineChart'), data.timeline || [], 'line')
        renderViewingChart($('#viewingTimeChart'), data.time_of_day || [], 'bar')
        renderInsightsRoute()
        root.classList.remove('hidden')
        loading.classList.add('hidden')
      } catch (error) {
        loading.textContent = 'Viewing insights are temporarily unavailable.'
        loading.classList.remove('hidden')
      }
    }

    $$('[data-viewing-range]').forEach(button => button.onclick = () => {
      viewingInsightsRange = Number(button.dataset.viewingRange)
      $$('[data-viewing-range]').forEach(option => option.classList.toggle(
        'active', Number(option.dataset.viewingRange) === viewingInsightsRange))
      loadViewingInsights(true)
    })
    $$('[data-insights-destination]').forEach(button => button.onclick = () =>
      pushInsightsRoute(`insights/${button.dataset.insightsDestination}`))
    $$('[data-insights-back]').forEach(button => button.onclick = navigateInsightsBack)
    $$('[data-insights-tab]').forEach(button => button.onclick = () => {
      if (!selectedViewingItemKey) return
      replaceInsightsRoute(`insights/item/${encodeURIComponent(selectedViewingItemKey)}/${button.dataset.insightsTab}`)
    })
    $('#viewingItemRangeSelect').onchange = event => {
      viewingInsightsRange = Number(event.target.value)
      $$('[data-viewing-range]').forEach(option => option.classList.toggle(
        'active', Number(option.dataset.viewingRange) === viewingInsightsRange))
      loadViewingInsights(true)
    }
    $('#viewingBrowseSearch').oninput = () => {
      if (viewingInsightsRoute.screen === 'channels' || viewingInsightsRoute.screen === 'films') {
        renderViewingBrowse(viewingInsightsRoute.screen)
      }
    }

    $('#usbRefresh').onclick = () => refreshUsb().catch(error => notice(error.message, true))
    $('#usbUp').onclick = () => browseUsb(usbPath.split('/').slice(0, -1).join('/')).catch(error => notice(error.message, true))
    $('#usbSelectAll').onclick = () => {
      const videos = usbEntries.filter(entry => entry.type === 'video')
      const allSelected = videos.every(entry => usbSelection.has(entry.path))
      videos.forEach(entry => allSelected ? usbSelection.delete(entry.path) : usbSelection.add(entry.path))
      renderUsbFiles()
    }
    $('#usbTarget').onchange = () => {
      const target = $('#usbTarget').value
      $('#usbChannelLabel').classList.toggle('hidden', target !== 'channel')
      $('#usbSeriesLabel').classList.toggle('hidden', target !== 'series')
      if (target === 'series' && !$('#usbSeriesName').value.trim() && usbSelection.size === 1) {
        const selected = [...usbSelection][0]
        const entry = usbEntries.find(value => value.path === selected)
        if (entry?.type === 'folder') $('#usbSeriesName').value = entry.name
      }
    }
    $('#usbEject').onclick = () => openLibrarySheet($('#usbEjectSheet'), $('#cancelUsbEject'))
    $('#closeUsbEject').onclick = $('#cancelUsbEject').onclick = () => closeLibrarySheet($('#usbEjectSheet'))
    $('#usbEjectSheet').onclick = event => {
      if (event.target === $('#usbEjectSheet')) closeLibrarySheet($('#usbEjectSheet'))
    }
    $('#usbEjectSheet').onclose = () => { document.documentElement.style.overflow = '' }
    $('#confirmUsbEject').onclick = async () => {
      const button = $('#confirmUsbEject')
      button.disabled = true
      try {
        closeLibrarySheet($('#usbEjectSheet'))
        const result = await api('/api/usb', { method: 'POST', body: JSON.stringify({ action: 'eject', volume: usbVolume }) })
        usbVolume = ''; usbPath = ''; usbEntries = []; usbSelection.clear(); renderUsbFiles(); await refreshUsb(); notice(result.message)
      } catch (error) { notice(error.message, true) }
      finally { button.disabled = false }
    }
    $('#usbImport').onclick = async () => {
      const selectedCount = usbSelection.size
      if (!confirm(`Copy ${selectedCount} selected item${selectedCount === 1 ? '' : 's'} into MabelTV? The USB originals will not be changed.`)) return
      const button = $('#usbImport'); button.disabled = true
      try {
        const payload = { action: 'import', volume: usbVolume, paths: [...usbSelection], target: $('#usbTarget').value }
        if (payload.target === 'channel') payload.channel = Number($('#usbChannel').value)
        if (payload.target === 'series') payload.series_name = $('#usbSeriesName').value.trim()
        const job = await api('/api/usb', { method: 'POST', body: JSON.stringify(payload) })
        usbSelection.clear(); renderUsbFiles(); monitorUsbJob(job.id)
      } catch (error) { notice(error.message, true); updateUsbSelection() }
    }

    async function monitorUsbJob(id) {
      clearTimeout(usbJobTimer)
      $('#usbJob').classList.remove('hidden')
      try {
        const job = await api(`/api/usb/imports/${id}`)
        $('#usbJobTitle').textContent = job.status === 'complete' ? 'Copy complete' : job.status === 'error' ? 'Copy stopped' : `Copying ${job.current || 'videos'}…`
        $('#usbJobText').textContent = `${job.files_done} of ${job.files_total} files · ${formatBytes(job.bytes_done)} of ${formatBytes(job.bytes_total)} — ${job.message}`
        $('#usbJobProgress').max = Math.max(1, job.bytes_total)
        $('#usbJobProgress').value = job.bytes_done
        if (job.status === 'complete') { await load(); notice('USB videos copied into MabelTV.') }
        else if (job.status === 'error') notice(job.message, true)
        else usbJobTimer = setTimeout(() => monitorUsbJob(id), 1000)
      } catch (error) { notice(error.message, true) }
    }


    function renderTvSettings() {
      const settings = library?.tv_settings || {}
      const setValue = (selector, value, fallback) => {
        const control = $(selector)
        const next = String(value ?? fallback)
        if ([...control.options].some(option => option.value === next)) control.value = next
      }
      setValue('#tvPlaybackMode', settings.playback_mode, 'continuous')
      setValue('#tvEpisodeReset', settings.episode_reset_minutes, 0)
      setValue('#tvPictureMode', settings.picture_mode, 'channel')
      setValue('#tvBorder', settings.tv_border, 'slim-black')
      setValue('#tvDisplayResolution', settings.display_resolution, '720p')
      setValue('#tvVolumeLimit', settings.volume_limit_enabled, true)
      setValue('#tvSoundEffects', settings.sound_effects_enabled, true)
      setValue('#tvScrubbing', settings.scrubbing_enabled, false)
      const setRange = (input, output, value, fallback) => {
        const control = $(input)
        control.value = String(value ?? fallback)
        $(output).textContent = `${control.value}%`
      }
      setRange('#tvCrtGlass', '#tvCrtGlassValue', settings.crt_glass, 35)
      setRange('#tvDistortion', '#tvDistortionValue', settings.video_distortion, 20)
      setRange('#tvMaximumVolume', '#tvMaximumVolumeValue', settings.maximum_volume, 60)
    }

    function renderParentOverlayStyle() {
      const current = library?.appearance?.parent_overlay_style || 'classic'
      $$('[data-parent-style]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.parentStyle === current))
      })
    }

    $$('[data-parent-style]').forEach(button => button.onclick = () => {
      const style = button.dataset.parentStyle
      if (style !== (library?.appearance?.parent_overlay_style || 'classic'))
        manage('set-parent-overlay-style', { style })
    })

    function renderTvGuideSetting() {
      const enabled = library?.appearance?.tv_guide_enabled === true
      $('#tvGuideToggle').setAttribute('aria-pressed', String(enabled))
      $('#tvGuideToggle').textContent = enabled ? 'On' : 'Off'
      $('#tvGuideState').textContent = enabled ? 'On · ready on the television' : 'Off'
    }

    function renderPortalPinSetting() {
      const required = library?.owner?.portal_pin_required !== false
      $('#portalPinState').textContent = required
        ? 'A parent PIN is required to open this portal'
        : 'This portal opens without a PIN'
      $('#portalPinToggle').textContent = required ? 'Turn off PIN entry' : 'Turn on PIN entry'
    }

    $('#tvGuideToggle').onclick = () => manage('set-tv-guide-enabled', {
      enabled: !(library?.appearance?.tv_guide_enabled === true)
    })

    ;[['#tvCrtGlass', '#tvCrtGlassValue'], ['#tvDistortion', '#tvDistortionValue'], ['#tvMaximumVolume', '#tvMaximumVolumeValue']]
      .forEach(([input, output]) => $(input).oninput = () => { $(output).textContent = `${$(input).value}%` })

    function renderStatus() {
      const system = library.system || {}, storage = library.storage || {}, warnings = system.warnings || []
      const warningCount = warnings.length || 1
      $('#topHealth').textContent = system.healthy ? 'Everything looks good' : `${warningCount} item${warningCount === 1 ? '' : 's'} need attention`
      $('#topHealth').classList.toggle('bad', !system.healthy)
      $('#homeStatusIcon').textContent = system.healthy ? '✓' : '!'
      $('#homeStatusIcon').classList.toggle('warn', !system.healthy)
      $('#healthTitle').textContent = system.healthy ? 'Everything looks good' : `${tvName()} needs a little attention`
      $('#healthSummary').textContent = system.healthy ? 'The player, temperature, power, and storage checks are all healthy.' : (warnings[0] || 'Check the system details below.')
      $('#temperature').textContent = system.temperature_c ? `${system.temperature_c.toFixed(1)}°C` : 'Unknown'
      $('#storageFree').textContent = `${Number(storage.free_gb || 0).toFixed(1)} GB`
      $('#uptime').textContent = duration(system.uptime_seconds)
      $('#warningsCard').classList.toggle('hidden', warnings.length === 0)
      $('#warnings').innerHTML = warnings.map(warning => `<div class="callout warn">${escapeHtml(warning)}</div>`).join('')
      $$('[data-version]').forEach(element => { element.textContent = system.version || '' })
      $('#systemDetails').innerHTML = `<dt>TV player</dt><dd>${escapeHtml(system.player || 'unknown')}</dd><dt>Video preparation</dt><dd>${escapeHtml(system.media_worker || 'unknown')}</dd><dt>Temperature</dt><dd>${system.temperature_c ? `${system.temperature_c.toFixed(1)}°C` : 'unavailable'}</dd><dt>Power / heat limiting now</dt><dd>${system.currently_throttled ? 'Yes' : 'No'}</dd><dt>Since last boot</dt><dd>${system.historical_throttle ? 'A power or heat event occurred' : 'No limiting recorded'}</dd><dt>Storage</dt><dd>${Number(storage.free_gb || 0).toFixed(1)} GB free of ${Number(storage.total_gb || 0).toFixed(1)} GB</dd><dt>Uptime</dt><dd>${duration(system.uptime_seconds)}</dd><dt>Device</dt><dd>${escapeHtml(system.device_name || tvName())}</dd><dt>Version</dt><dd>${escapeHtml(system.version || 'development')}</dd><dt>Last checked</dt><dd>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</dd>`
      if (library.owner?.pin_change_recommended) {
        $('#warningsCard').classList.remove('hidden')
      }
    }

    function renderUploads() {
      const root = $('#uploadJobs'), jobs = library.uploads || []
      if (!jobs.length) { root.innerHTML = '<p class="muted">No videos are waiting.</p>'; return }
      const labels = {
        uploading: 'Uploading', validating: 'Checking the video', queued: 'Waiting in the preparation queue',
        processing: 'Preparing for smooth playback', publishing: 'Publishing', finalising: 'Refreshing the TV',
        error: 'Needs attention', 'refresh-error': 'TV refresh needed'
      }
      root.innerHTML = jobs.map(job => {
        const percent = job.size ? Math.min(100, Math.round((job.offset || 0) * 100 / job.size)) : 0
        const detail = job.status === 'error'
          ? `${escapeHtml(job.error || 'This video could not be prepared.')} Choose the original file above to try again.`
          : job.status === 'refresh-error'
            ? 'The video is safely stored, but the TV did not refresh. Retry it here.'
            : `${escapeHtml(labels[job.status] || job.status)}${job.status === 'uploading' ? ` · ${percent}%` : ''}`
        const actions = `${job.refreshable ? `<button type="button" class="secondary" data-upload-action="refresh" data-upload-id="${job.id}">Retry TV refresh</button>` : ''}${job.retryable ? `<button type="button" class="secondary" data-upload-action="retry" data-upload-id="${job.id}">Retry now</button>` : ''}${job.cancelable ? `<button type="button" class="secondary" data-upload-action="cancel" data-upload-id="${job.id}">${job.status === 'error' ? 'Dismiss' : 'Cancel upload'}</button>` : ''}`
        return `<div class="callout ${['error', 'refresh-error'].includes(job.status) ? 'warn' : ''}"><strong>${escapeHtml(job.file_name)}</strong><br><span class="small muted">${escapeHtml(job.channel_name)} · ${detail}</span>${actions ? `<div class="row" style="margin-top:10px">${actions}</div>` : ''}</div>`
      }).join('')
      $$('[data-upload-action]').forEach(button => button.onclick = () => uploadQueueAction(
        button.dataset.uploadId, button.dataset.uploadAction))
    }

    async function uploadQueueAction(id, action) {
      if (action === 'cancel' && !confirm('Remove this upload and free the space it is using?')) return
      try {
        const result = await api('/api/uploads/' + id, {
          method: 'POST', body: JSON.stringify({ action })
        })
        await refreshLiveStatus()
        notice(result.message || 'Done.')
      } catch (error) { notice(error.message, true) }
    }

    async function refreshLiveStatus() {
      const fresh = await api('/api/status')
      if (!library) return
      library = { ...library, ...fresh }
      renderStatus()
      renderUploads()
    }

    function activityDuration(seconds) {
      const value = Math.max(0, Number(seconds) || 0)
      if (!value) return 'Estimating time left'
      const minutes = Math.ceil(value / 60)
      return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${minutes}m left`
    }

    function activityJobMarkup(job, kind) {
      const isOptimising = kind === 'optimising'
      const percent = Math.max(0, Math.min(100, Number(job.progress ?? (job.size ? (job.offset || 0) * 100 / job.size : 0)) || 0))
      const transfer = job.transfer_state || 'active'
      const state = isOptimising ? (job.state === 'queued' ? 'Waiting for the encoder' : job.message || 'Optimising for Pi') : (transfer === 'waiting' ? 'Waiting in upload queue' : transfer === 'paused' ? 'Paused' : !job.source_available && job.status === 'uploading' ? 'Waiting for source file — select the same file again on the laptop to resume' : ({ uploading: 'Uploading', validating: 'Checking video', queued: 'Waiting to publish', processing: 'Preparing video', publishing: 'Publishing', finalising: 'Refreshing TV', error: job.error || 'Needs attention', 'refresh-error': 'TV refresh needed' }[job.status] || job.status))
      const detail = isOptimising ? activityDuration(job.eta_seconds) : `${job.channel_name || 'MabelTV'} · ${Math.round(percent)}%`
      const paused = isOptimising ? job.state === 'paused' : (job.status === 'paused' || transfer === 'paused')
      const cancellable = isOptimising ? ['queued', 'processing', 'paused'].includes(job.state) : ['uploading', 'queued', 'paused'].includes(job.status)
      const pausable = isOptimising ? ['queued', 'processing'].includes(job.state) : ['uploading', 'queued'].includes(job.status)
      const startable = !isOptimising && job.status === 'uploading' && transfer !== 'active'
      const controls = cancellable ? `<div class="activity-job-controls">${startable ? `<button type="button" data-activity-action="start" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Start next</button>` : paused ? `<button type="button" data-activity-action="resume" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Resume</button>` : pausable ? `<button type="button" data-activity-action="pause" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Pause</button>` : ''}<button type="button" class="danger" data-activity-action="cancel" data-activity-kind="${kind}" data-activity-id="${escapeHtml(job.path || job.id)}">Cancel</button></div>` : ''
      return `<article class="activity-job"><div class="activity-job-top"><div><h2>${escapeHtml(job.title || job.file_name || 'Video')}</h2><p>${escapeHtml(state)}</p></div><strong>${Math.round(percent)}%</strong></div><div class="activity-progress"><i style="width:${percent}%"></i></div><div class="activity-job-meta"><span>${escapeHtml(detail)}</span><span>${isOptimising && job.started ? 'In progress' : ''}</span></div>${controls}</article>`
    }

    function renderActivity(activity) {
      const uploads = activity.uploads || [], optimisations = activity.optimisations || []
      const activeUploads = uploads.filter(job => !['error', 'refresh-error'].includes(job.status))
      const activeOptimisations = optimisations.filter(job => ['queued', 'processing'].includes(job.state))
      const uploadsRoot = $('#activityUploadList'), optimisationRoot = $('#activityOptimisationList')
      if (!uploadsRoot || !optimisationRoot) return
      $('#activityUploadCount').textContent = String(activeUploads.length)
      $('#activityOptimisationCount').textContent = String(activeOptimisations.length)
      $('#activitySummary').textContent = activity.active
        ? `${activeUploads.length + activeOptimisations.length} background job${activeUploads.length + activeOptimisations.length === 1 ? '' : 's'} in progress.`
        : 'Nothing is uploading or being prepared right now.'
      const temperature = $('#activityTemperature')
      temperature.classList.toggle('hidden', !activity.temperature_warning)
      temperature.textContent = activity.temperature_warning ? `${Number(activity.temperature_c).toFixed(0)}°C · watching temperature` : ''
      uploadsRoot.innerHTML = uploads.length ? uploads.map(job => activityJobMarkup(job, 'upload')).join('') : '<div class="activity-empty">No uploads are waiting or in progress.</div>'
      optimisationRoot.innerHTML = optimisations.length ? optimisations.map(job => activityJobMarkup(job, 'optimising')).join('') : '<div class="activity-empty">No films are being optimised right now.</div>'
      $$('[data-activity-action]').forEach(button => button.onclick = () => activityAction(button))
      const header = $('#mobileActivityStatus')
      const headerText = $('#mobileActivityText')
      const warning = activity.temperature_warning
      const firstOptimisation = activeOptimisations[0]
      header.classList.remove('hidden')
      header.classList.toggle('is-warning', warning)
      header.classList.toggle('is-idle', !activity.active && !warning)
      const firstUpload = activeUploads[0]
      headerText.textContent = warning ? `${Number(activity.temperature_c).toFixed(0)}°C · Pi warming up`
        : firstOptimisation ? `Optimising · ${Math.round(firstOptimisation.progress || 0)}%`
          : activeUploads.length ? `${firstUpload.status === 'paused' ? 'Paused' : 'Uploading'} · ${Math.round((firstUpload.size ? firstUpload.offset * 100 / firstUpload.size : 0) || 0)}%` : ''
    }

    async function activityAction(button) {
      const action = button.dataset.activityAction
      if (action === 'cancel') {
        const message = button.dataset.activityKind === 'optimising'
          ? 'Cancel this optimisation? The unfinished optimised copy will be deleted. Your original film will be kept.'
          : 'Cancel this upload? All partially uploaded data for it will be deleted and its storage freed.'
        if (!confirm(message)) return
      }
      button.disabled = true
      try {
        if (button.dataset.activityKind === 'optimising') {
          await api('/api/manage', { method: 'POST', body: JSON.stringify({ action: 'optimisation-action', operation: action, file: button.dataset.activityId }) })
        } else {
          await api(`/api/uploads/${button.dataset.activityId}`, { method: 'POST', body: JSON.stringify({ action }) })
        }
        await loadActivity()
      } catch (error) { notice(error.message, true); button.disabled = false }
    }

    async function loadActivity() {
      const activity = await api('/api/activity')
      renderActivity(activity)
      return activity
    }

    $$('[data-activity-tab]').forEach(button => button.onclick = () => {
      const optimisation = button.dataset.activityTab === 'optimising'
      $$('[data-activity-tab]').forEach(item => item.classList.toggle('active', item === button))
      $('#activityUploads').classList.toggle('hidden', optimisation)
      $('#activityOptimising').classList.toggle('hidden', !optimisation)
    })

    window.setInterval(() => loadActivity().catch(() => {}), 5000)

    function actionButton(text, action, kind = 'secondary') {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = text; button.className = kind; button.onclick = action
      return button
    }

    function aspectLabel(value) {
      return { crop: 'Fill screen', fit: 'Whole picture', stretch: 'Stretch' }[value] || 'Fill screen'
    }

    function contentLabel(value) {
      return value === 'films' ? 'Films / long videos' : 'Shows / episodes'
    }

    function channelCardMarkup(channel, overview = false) {
      const total = channel.programmes.length
      const shown = channel.enabled ? channel.enabled_programmes : 0
      if (overview) {
        const previewLimit = 2
        const previews = channel.programmes.slice(0, previewLimit)
          .map(programme => `<span>${escapeHtml(programme.display_name)}</span>`).join('')
        const remainder = Math.max(0, total - previewLimit)
        const preview = total
          ? `${previews}${remainder ? `<span class="more">＋ ${remainder} more</span>` : ''}`
          : '<span class="muted">Ready for its first programme</span>'
        return `<button type="button" class="channel-card overview-channel-card ${channel.enabled ? '' : 'hidden-channel'}" data-open-channel="${channel.number}" data-open-channel-folder="${escapeHtml(channel.folder)}" aria-label="Manage channel ${channel.number}, ${escapeHtml(channel.name)}">
          <span class="channel-card-top"><span class="channel-number">CH ${channel.number}</span><span class="channel-status">${channel.enabled ? 'On TV' : 'Hidden'}</span></span>
          <h3>${escapeHtml(channel.name)}</h3>
          <span class="channel-meta">${escapeHtml(contentLabel(channel.content_type))} · ${shown} of ${total} on TV</span>
          <span class="channel-preview">${preview}</span>
          <span class="channel-card-footer">Manage channel</span>
        </button>`
      }
      const first = channel.programmes[0]?.display_name
      if (document.body.classList.contains('portal-classic')) {
        return `<button type="button" class="channel-card library-main-card ${channel.enabled ? '' : 'hidden-channel'}" data-open-channel="${channel.number}" data-open-channel-folder="${escapeHtml(channel.folder)}" aria-label="Open channel ${channel.number}, ${escapeHtml(channel.name)}">
          <span class="library-card-top"><span class="library-channel-pill">CH ${channel.number}</span><span class="library-channel-state">${channel.enabled ? 'On TV' : 'Hidden'}</span></span>
          <span class="channel-card-copy"><h3>${escapeHtml(channel.name)}</h3><span class="channel-card-detail">${total} programme${total === 1 ? '' : 's'} · ${escapeHtml(channel.content_type === 'films' ? 'Films' : 'Shows')}</span>${first ? `<span class="library-card-preview">${escapeHtml(first)}${total > 1 ? ` <em>+ ${total - 1} more</em>` : ''}</span>` : '<span class="library-card-preview muted">Ready for its first programme</span>'}</span>
          <span class="library-card-footer"><span>${shown} shown on TV</span><span>Open channel <svg class="icon"><use href="/portal/icons.svg#signal-chevron-right"/></svg></span></span>
        </button>`
      }
      const channelArtwork = channel.metadata?.artwork
        ? ` style="background-image:linear-gradient(180deg,rgba(8,8,11,.04),rgba(8,8,11,.82)),url('/api/channel/artwork/${encodeURIComponent(channel.metadata.artwork)}')"`
        : ''
      return `<button type="button" class="channel-card library-main-card ${channel.enabled ? '' : 'hidden-channel'}" data-open-channel="${channel.number}" data-open-channel-folder="${escapeHtml(channel.folder)}" aria-label="Open channel ${channel.number}, ${escapeHtml(channel.name)}">
        <span class="library-channel-visual"${channelArtwork}><span class="library-card-top"><span class="library-channel-pill">CH ${channel.number}</span><span class="library-channel-state">${channel.enabled ? 'On TV' : 'Hidden'}</span></span><span class="library-channel-initial">${escapeHtml(channel.name.slice(0, 1).toUpperCase())}</span></span>
        <span class="channel-card-copy"><span class="channel-card-heading"><h3>${escapeHtml(channel.name)}</h3><svg class="icon"><use href="/portal/icons.svg#signal-chevron-right"/></svg></span><span class="channel-card-detail">${total} programme${total === 1 ? '' : 's'} · ${escapeHtml(channel.content_type === 'films' ? 'Films' : 'Shows')}</span>${first ? `<span class="library-card-preview">${escapeHtml(first)}${total > 1 ? ` <em>+ ${total - 1} more</em>` : ''}</span>` : '<span class="library-card-preview muted">Ready for its first programme</span>'}</span>
        <span class="library-card-footer"><span>${shown} shown on TV</span><span>${channel.enabled ? 'Available' : 'Hidden'}</span></span>
      </button>`
    }

    function bindChannelCards(root) {
      root.querySelectorAll('[data-open-channel]').forEach(button => {
        button.onclick = () => {
          const channel = (library.channels || []).find(value =>
            value.folder === button.dataset.openChannelFolder)
            || (library.channels || []).find(value =>
              value.number === Number(button.dataset.openChannel))
          if (channel) openChannel(channel, false)
        }
      })
    }

    function selectedChannelFromLibrary(channels = library?.channels || []) {
      if (selectedManageChannelFolder) {
        const byFolder = channels.find(channel =>
          channel.folder === selectedManageChannelFolder)
        if (byFolder) return byFolder
      }
      return channels.find(channel => channel.number === selectedManageChannel) || null
    }

    function sameChannelSelection(channel) {
      const selected = selectedChannelFromLibrary()
      if (!selected || !channel || selected.number !== channel.number) return false
      return !selected.folder || !channel.folder || selected.folder === channel.folder
    }

    function showChannelHub() {
      channelNavigationRevision += 1
      selectedManageChannel = null
      selectedManageChannelFolder = ''
      channelWorkspaceReturnToWatch = false
      channelReturnPosition = null
      programmePage = 1
      $('#channelHub').classList.remove('hidden')
      $('#channelWorkspace').classList.add('hidden')
      $('#backToChannels span').textContent = 'All channels'
    }

    function openChannel(channelOrNumber, returnToWatch = false, options = {}) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      const channels = library?.channels || []
      const requestedNumber = Number(typeof channelOrNumber === 'object'
        ? channelOrNumber?.number : channelOrNumber)
      const requestedFolder = String(typeof channelOrNumber === 'object'
        ? channelOrNumber?.folder || '' : options.folder || '')
      const channel = (requestedFolder
        ? channels.find(value => value.folder === requestedFolder) : null)
        || channels.find(value => value.number === requestedNumber)
      if (!channel) {
        showError(new Error('That channel is no longer available.'))
        showChannelHub()
        return
      }
      channelReturnPosition = returnToWatch
        ? (options.returnPosition || channelReturnSnapshot(channel)) : null
      resetViewScroll()
      channelNavigationRevision += 1
      const navigationRevision = channelNavigationRevision
      selectedManageChannel = Number(channel.number)
      selectedManageChannelFolder = String(channel.folder || '')
      channelWorkspaceReturnToWatch = returnToWatch
      programmeSearch = ''
      programmePage = 1
      $('#backToChannels span').textContent = returnToWatch ? 'Back to MabelTV' : 'All channels'
      if (options.updateHistory !== false) {
        const parentHash = returnToWatch ? '#watch' : '#channels'
        const parentState = returnToWatch
          ? { channelParent: true, mabelWatchReturn: channelReturnPosition }
          : { channelParent: true }
        history.replaceState(parentState, '', parentHash)
        history.pushState({ channelPage: true, mabelWatchReturn: channelReturnPosition }, '', `#channel/${selectedManageChannel}/${returnToWatch ? 'watch' : 'library'}`)
      }
      openView('channels', { instantScroll: true })
      renderChannels()
      resetViewScroll()
      requestAnimationFrame(() => {
        if (channelNavigationRevision === navigationRevision
            && sameChannelSelection(channel)) resetViewScroll()
      })
    }

    function closeChannelPage() {
      if (history.state?.channelPage) {
        history.back()
        return
      }
      const target = channelWorkspaceReturnToWatch ? 'watch' : 'channels'
      const parentState = channelWorkspaceReturnToWatch
        ? { channelParent: true, mabelWatchReturn: channelReturnPosition }
        : { channelParent: true }
      history.replaceState(parentState, '', `#${target}`)
      openRequestedView({ type: 'popstate' })
    }

    function renderBin() {
      const items = library.recycle || []
      $('#recycleCount').textContent = items.length
      const bin = $('#bin')
      bin.innerHTML = ''
      if (!items.length) {
        bin.innerHTML = '<div class="zero-state"><strong>Nothing in the recycle bin</strong>Removed programmes will be kept here for 30 days.</div>'
        return
      }
      items.forEach(item => {
        const row = document.createElement('div'); row.className = 'programme'
        const name = document.createElement('span'); name.textContent = `${item.display_name} · ${item.channel_name}`
        const actions = document.createElement('div'); actions.className = 'programme-actions'
        actions.append(actionButton('Restore', () => manage('restore', { id: item.id })), actionButton('Delete forever', () => { if (confirm('Permanently delete this video? This cannot be undone.')) manage('delete', { id: item.id }) }, 'danger'))
        row.append(name, actions); bin.append(row)
      })
    }

    function openLibrarySheet(dialog, focus = null, returnTo = null) {
      portalSheets.open(dialog, { focus, returnTo })
    }

    function closeLibrarySheet(dialog, restoreParent = true) {
      portalSheets.close(dialog, { restore: restoreParent })
    }

    function renderProgrammeList(channel) {
      const selected = selectedChannelFromLibrary()
      if (!selected) return
      // Always render the currently selected channel. A delayed callback may
      // still hold an older channel object, but it must never leave the old
      // cards on screen or suppress the first render of the new channel.
      channel = selected
      const search = programmeSearch.trim().toLowerCase()
      const filtered = channel.programmes.filter(programme => {
        const matchesSearch = !search || programme.display_name.toLowerCase().includes(search) || programme.name.toLowerCase().includes(search)
        return matchesSearch
      })
      programmePage = Math.min(programmePage, Math.max(1, Math.ceil(filtered.length / PROGRAMMES_PER_PAGE)))
      ChannelPageComponents.renderLibrary({
        channel,
        filtered,
        page: programmePage,
        pageSize: PROGRAMMES_PER_PAGE,
        search: programmeSearch,
        onOpen: (selectedChannel, programme) => openWatchProgrammeSheet(selectedChannel, programme),
        onLoadMore: () => {
          const current = selectedChannelFromLibrary()
          if (!current) return
          programmePage += 1
          renderProgrammeList(current)
        },
      })
    }

    function renderChannels() {
      const cards = $('#channelCards')
      const channels = library.channels || []
      $('#libraryChannelCount').textContent = channels.length
      $('#libraryProgrammeCount').textContent = channels.reduce((sum, channel) => sum + channel.programmes.length, 0)
      cards.innerHTML = channels.length
        ? channels.map(channel => channelCardMarkup(channel)).join('')
        : '<div class="zero-state"><strong>No channels yet</strong>Create the first channel below.</div>'
      bindChannelCards(cards)
      renderBin()
      const channel = selectedChannelFromLibrary(channels)
      if (!channel) { showChannelHub(); return }
      selectedManageChannel = Number(channel.number)
      selectedManageChannelFolder = String(channel.folder || '')
      $('#channelHub').classList.add('hidden')
      $('#channelWorkspace').classList.remove('hidden')
      $('#channelWorkspace').dataset.channelNumber = String(channel.number)
      $('#channelWorkspace').dataset.channelFolder = String(channel.folder || '')
      $('#editChannelNumber').value = channel.number
      $('#editChannelName').value = channel.name
      $('#editChannelAspect').value = channel.aspect || 'crop'
      $('#editChannelContentType').value = channel.content_type || 'shows'
      ChannelPageComponents.renderHero(channel, { aspectLabel })
      // Paint the channel identity and its contents as one transaction. The
      // management controls below may come from an older cached PWA shell; a
      // missing optional control must not leave this area empty or showing the
      // previously opened channel.
      renderProgrammeList(channel)
      $('#channelVisibilityTitle').textContent = channel.enabled ? 'Hide channel' : 'Show channel'
      $('#channelVisibilityHint').textContent = channel.enabled
        ? 'Keep every video, but remove this channel from the television.'
        : 'Put this channel and its available videos back on the television.'
      $('#workspaceToggleChannel').onclick = () => manage('toggle-channel', { channel: channel.number })
      $('#channelSettingsTitle').textContent = `Edit ${channel.name}`
      $('#workspaceSettings').onclick = () => openLibrarySheet($('#channelSettingsSheet'), $('#editChannelName'))
      const favouriteButton = $('#workspaceFavourite')
      const seriesChannel = channel.content_type !== 'films'
      favouriteButton.classList.toggle('hidden', !seriesChannel)
      favouriteButton.classList.toggle('active', seriesChannel && channel.favourite === true)
      favouriteButton.setAttribute('aria-label', channel.favourite
        ? `Remove ${channel.name} from favourites`
        : `Add ${channel.name} to favourites`)
      favouriteButton.onclick = seriesChannel ? () => setChannelFavourite(
        channel, channel.favourite !== true).then(() => renderChannels()).catch(showError) : null
      const contentType = $('#editChannelContentType')
      const metadataAction = $('#channelMetadataAction')
      const syncChannelMetadataAction = () => {
        const selectedAsShow = contentType.value === 'shows'
        const savedAsShow = channel.content_type === 'shows'
        metadataAction.classList.toggle('hidden', !selectedAsShow)
        metadataAction.disabled = !tmdbConfigured || !savedAsShow
        $('#channelMetadataActionTitle').textContent = channel.metadata?.tmdb_id
          ? 'Refresh channel metadata'
          : 'Add channel metadata'
        $('#channelMetadataActionHint').textContent = !savedAsShow
          ? 'Save this as a Shows / episodes channel first.'
          : tmdbConfigured
            ? 'Search TMDB and choose the correct show.'
            : 'Connect TMDB in Settings to search for this show.'
      }
      contentType.onchange = syncChannelMetadataAction
      metadataAction.onclick = () => {
        if (channel.content_type !== 'shows') return
        closeLibrarySheet($('#channelSettingsSheet'), false)
        scanChannelTmdb(channel, () =>
          openLibrarySheet($('#channelSettingsSheet'), $('#editChannelName')))
      }
      syncChannelMetadataAction()
      const watchButton = $('#channelWatchTv')
      watchButton.disabled = !channel.enabled
      watchButton.querySelector('strong').textContent = channel.enabled ? 'Open on TV' : 'Channel hidden'
      watchButton.querySelector('small').textContent = channel.enabled ? 'Switch MabelTV to this channel' : 'Show it in Manage to play it'
      watchButton.onclick = () => sendLiveCommand('tune-channel', watchButton, { channel: channel.number })
      $('#channel').value = String(channel.number)
      $('#uploadDestination').textContent = channel.name
      $('#workspaceAddMedia').onclick = () => openLibrarySheet($('#channelUploadPanel'), $('#file'))
      $('#programmeSearch').value = programmeSearch
    }
