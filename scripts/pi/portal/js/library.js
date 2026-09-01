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

let viewingInsightsRange = 30

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
        const stateLabel = state === 'optimised' ? 'Pi ready' : state === 'processing' ? 'Optimising…' : state === 'queued' ? 'Queued' : state === 'error' ? 'Needs attention' : 'Original'
        meta.textContent = [metadata.year, film.folder || 'Unfiled', stateLabel].filter(Boolean).join(' · ')
        const more = document.createElement('span'); more.className = 'adult-film-more'
        more.setAttribute('aria-hidden', 'true')
        more.append(librarySignalIcon('signal-chevron-right'))
        copy.append(title, meta)
        row.append(poster, copy, more)
        row.setAttribute('aria-label', `Open details for ${title.textContent}`)
        row.onclick = () => openAdultFilmSheet(film)
        root.append(row)
      })
      clearTimeout(adultOptimisationRefresh)
      if (films.some(film => ['queued', 'processing'].includes(film.playback_state)))
        adultOptimisationRefresh = setTimeout(() => load().catch(() => {}), 2500)
    }

    function openAdultFilmSheet(film) {
      selectedAdultFilm = film
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
      optimise.querySelector('strong').textContent = film.playback_state === 'optimised' ? 'Already optimised' : busy ? 'Optimising…' : 'Optimise for Pi'
      optimise.querySelector('small').textContent = film.playback_state === 'optimised'
        ? 'This film already uses the TV playback profile'
        : busy ? 'The playback copy is being prepared' : 'Prepare a smoother TV playback copy'
      const scan = $('#adultFilmScan')
      scan.disabled = !tmdbConfigured
      scan.querySelector('strong').textContent = metadata.tmdb_id ? 'Refresh metadata & subtitles' : 'Find metadata & subtitles'
      const removeProgress = $('#adultFilmRemoveProgress')
      removeProgress.classList.toggle('hidden', !watchFilmResumable(film))
      const sheet = $('#adultFilmSheet')
      sheet.showModal()
      sheet.querySelector('.watch-film-panel').focus({ preventScroll: true })
      document.documentElement.style.overflow = 'hidden'
    }

    async function scanTmdb(film) {
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
              $('#tmdbDialog').close(); await load(); notice('Film metadata, artwork, and available subtitles were saved locally.')
            } catch (error) { notice(error.message, true); choose.disabled = false }
          }
          row.append(poster, copy, choose); root.append(row)
        })
        $('#tmdbDialog').showModal(); notice('')
      } catch (error) { notice(error.message, true) }
    }

    async function scanProgrammeTmdb(channel, programme) {
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
              $('#tmdbDialog').close()
              selectedManageChannel = Number(channel.number)
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
        $('#tmdbDialog').showModal()
        notice('')
      } catch (error) { notice(error.message, true) }
    }

    async function scanChannelTmdb(channel) {
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
              $('#tmdbDialog').close()
              selectedManageChannel = Number(channel.number)
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
        $('#tmdbDialog').showModal()
        notice('')
      } catch (error) { notice(error.message, true) }
    }

    $('#tmdbClose').onclick = () => $('#tmdbDialog').close()
    $('#adultSearch').oninput = event => { adultSearchText = event.target.value; renderAdultLibrary() }
    $('#adultSearchClear').onclick = () => { adultSearchText = ''; $('#adultSearch').value = ''; renderAdultLibrary(); $('#adultSearch').focus() }
    $('#adultAddFilms').onclick = () => openLibrarySheet($('#adultUploadSheet'), $('#adultFile'))
    $('#adultCollectionTrigger').onclick = () => openLibrarySheet($('#adultCollectionSheet'))
    $('#adultUploadClose').onclick = () => closeLibrarySheet($('#adultUploadSheet'))
    $('#adultCollectionClose').onclick = () => closeLibrarySheet($('#adultCollectionSheet'))
    $('#adultFilmClose').onclick = () => closeLibrarySheet($('#adultFilmSheet'))
    ;[$('#adultUploadSheet'), $('#adultCollectionSheet'), $('#adultFilmSheet')].forEach(dialog => {
      dialog.onclick = event => { if (event.target === dialog) closeLibrarySheet(dialog) }
      dialog.onclose = () => { document.documentElement.style.overflow = ''; if (dialog === $('#adultFilmSheet')) selectedAdultFilm = null }
    })
    $('#adultFilmMove').onclick = async () => { if (selectedAdultFilm) { const film = selectedAdultFilm; closeLibrarySheet($('#adultFilmSheet')); await manage('move-adult', { file: film.path, folder: $('#adultFilmFolder').value }) } }
    $('#adultFilmScan').onclick = () => { const film = selectedAdultFilm; if (film) { closeLibrarySheet($('#adultFilmSheet')); scanTmdb(film) } }
    $('#adultFilmRename').onclick = () => { const film = selectedAdultFilm; if (!film) return; const name = prompt('Film name:', film.display_name); if (name?.trim()) { closeLibrarySheet($('#adultFilmSheet')); manage('rename-adult', { file: film.path, name: name.trim() }) } }
    $('#adultFilmOptimise').onclick = () => { const film = selectedAdultFilm; if (film && confirm(`Optimise “${film.display_name}” for the Pi? The original is replaced only after the new copy passes its checks.`)) { closeLibrarySheet($('#adultFilmSheet')); manage('optimise-adult', { file: film.path }) } }
    $('#adultFilmRemoveProgress').onclick = () => {
      const film = selectedAdultFilm
      if (!film) return
      const action = $('#adultFilmRemoveProgress')
      closeLibrarySheet($('#adultFilmSheet'))
      clearWatchFilmProgress(film, false, action).catch(showError)
    }
    $('#adultFilmRemove').onclick = () => { const film = selectedAdultFilm; if (film && confirm(`Move “${film.display_name}” to the recycle bin?`)) { closeLibrarySheet($('#adultFilmSheet')); manage('trash-adult', { file: film.path }) } }

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
    }

    function renderUsbFiles() {
      const root = $('#usbFileList')
      root.innerHTML = ''
      const volume = usbState.volumes.find(item => item.id === usbVolume)
      const breadcrumb = $('#usbBreadcrumb')
      breadcrumb.replaceChildren()
      if (volume) {
        const rootButton = document.createElement('button')
        rootButton.type = 'button'
        rootButton.append(librarySignalIcon('signal-hard-drive'), document.createTextNode(volume.label))
        rootButton.onclick = () => browseUsb('').catch(error => notice(error.message, true))
        breadcrumb.append(rootButton)
        const parts = usbPath.split('/').filter(Boolean)
        parts.forEach((part, index) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = part
          if (index === parts.length - 1) button.setAttribute('aria-current', 'page')
          button.onclick = () => browseUsb(parts.slice(0, index + 1).join('/')).catch(error => notice(error.message, true))
          breadcrumb.append(librarySignalIcon('signal-chevron-right', 'usb-breadcrumb-separator'), button)
        })
      } else {
        const empty = document.createElement('span')
        empty.textContent = 'Choose a connected drive to begin'
        breadcrumb.append(empty)
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
          select.type = 'button'; select.className = 'usb-folder-select'
          select.append(librarySignalIcon(usbSelection.has(entry.path) ? 'signal-check' : 'signal-plus'), document.createTextNode(usbSelection.has(entry.path) ? 'Selected' : 'Select folder'))
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
    }

    function viewingDuration(seconds) {
      const minutes = Math.max(0, Math.round(Number(seconds || 0) / 60))
      const hours = Math.floor(minutes / 60)
      const remainder = minutes % 60
      return hours ? `${hours}h ${remainder}m` : `${minutes}m`
    }

    function renderViewingChart(root, values) {
      root.replaceChildren()
      if (!values.length || !values.some(item => Number(item.seconds) > 0)) {
        const empty = document.createElement('p')
        empty.className = 'viewing-empty'
        empty.textContent = 'Viewing will appear here as it is watched.'
        root.append(empty)
        return
      }
      const namespace = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(namespace, 'svg')
      svg.setAttribute('viewBox', '0 0 640 190')
      svg.setAttribute('preserveAspectRatio', 'none')
      svg.setAttribute('aria-hidden', 'true')
      const maximum = Math.max(...values.map(item => Number(item.seconds) || 0), 1)
      const step = 640 / values.length
      values.forEach((item, index) => {
        const value = Number(item.seconds) || 0
        const height = Math.max(value ? 5 : 2, value / maximum * 132)
        const width = Math.max(5, step * .55)
        const group = document.createElementNS(namespace, 'g')
        const title = document.createElementNS(namespace, 'title')
        title.textContent = `${item.label}: ${viewingDuration(value)}`
        const bar = document.createElementNS(namespace, 'rect')
        bar.setAttribute('x', String(index * step + (step - width) / 2))
        bar.setAttribute('y', String(145 - height))
        bar.setAttribute('width', String(width))
        bar.setAttribute('height', String(height))
        bar.setAttribute('rx', String(Math.min(5, width / 3)))
        bar.classList.add(value ? 'has-value' : 'is-empty')
        group.append(title, bar)
        if (values.length <= 14 || index % Math.ceil(values.length / 8) === 0 || index === values.length - 1) {
          const label = document.createElementNS(namespace, 'text')
          label.setAttribute('x', String(index * step + step / 2))
          label.setAttribute('y', '174')
          label.setAttribute('text-anchor', 'middle')
          label.textContent = item.label
          group.append(label)
        }
        svg.append(group)
      })
      root.append(svg)
      root.setAttribute('aria-label', values.map(item =>
        `${item.label} ${viewingDuration(item.seconds)}`).join(', '))
    }

    function renderViewingBreakdown(root, values, labels) {
      root.replaceChildren()
      const maximum = Math.max(...values.map(item => Number(item.seconds) || 0), 1)
      if (!values.length) {
        root.innerHTML = '<p class="viewing-empty">No viewing in this period yet.</p>'
        return
      }
      values.forEach(item => {
        const row = document.createElement('div')
        const heading = document.createElement('span')
        const name = document.createElement('strong')
        name.textContent = labels[item.name] || item.name
        const duration = document.createElement('small')
        duration.textContent = viewingDuration(item.seconds)
        heading.append(name, duration)
        const progress = document.createElement('progress')
        progress.max = maximum
        progress.value = Number(item.seconds) || 0
        progress.setAttribute('aria-label', `${name.textContent}: ${duration.textContent}`)
        row.append(heading, progress)
        root.append(row)
      })
    }

    function renderViewingList(root, values, recent = false) {
      root.replaceChildren()
      if (!values.length) {
        const empty = document.createElement('li')
        empty.className = 'viewing-empty'
        empty.textContent = 'Nothing to show yet.'
        root.append(empty)
        return
      }
      values.forEach(item => {
        const row = document.createElement('li')
        const copy = document.createElement('span')
        const title = document.createElement('strong')
        title.textContent = item.title
        const details = document.createElement('small')
        const surface = item.surface === 'device' ? 'This device' : 'TV'
        details.textContent = recent
          ? `${item.source} · ${surface} · ${new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(item.when))}`
          : item.source
        copy.append(title, details)
        const value = document.createElement('b')
        value.textContent = item.duration || viewingDuration(item.seconds)
        row.append(copy, value)
        root.append(row)
      })
    }

    async function loadViewingInsights() {
      const loading = $('#viewingInsightsLoading')
      const root = $('#viewingInsights')
      if (!loading || !root || offlineMode) return
      loading.classList.remove('hidden')
      try {
        const data = await api(`/api/viewing-insights?days=${viewingInsightsRange}&timezone_offset=${new Date().getTimezoneOffset()}`)
        $('#viewingToday').textContent = viewingDuration(data.summary.today_seconds)
        $('#viewingWeek').textContent = viewingDuration(data.summary.week_seconds)
        $('#viewingMonth').textContent = viewingDuration(data.summary.month_seconds)
        $('#viewingActiveDays').textContent = String(data.summary.active_days)
        $('#viewingRangeTotal').textContent = viewingDuration(data.summary.range_seconds)
        renderViewingChart($('#viewingDailyChart'), data.daily || [])
        const longValues = viewingInsightsRange === 365 ? data.monthly || [] : data.weekly || []
        $('#viewingTrendTitle').textContent = viewingInsightsRange === 365 ? 'Monthly trend' : 'Weekly trend'
        renderViewingChart($('#viewingTrendChart'), longValues)
        renderViewingBreakdown($('#viewingSurfaceBreakdown'), data.by_surface || [], {
          tv: 'On the TV', device: 'On this device',
        })
        renderViewingBreakdown($('#viewingKindBreakdown'), data.by_kind || [], {
          adult: 'Adult TV films', film: 'MabelTV films', episode: 'MabelTV episodes', usb: 'USB videos',
        })
        renderViewingList($('#viewingTopTitles'), data.top_titles || [])
        renderViewingList($('#viewingRecent'), data.recent || [], true)
        root.classList.remove('hidden')
        loading.classList.add('hidden')
      } catch (error) {
        loading.textContent = 'Viewing insights are temporarily unavailable.'
      }
    }

    $$('[data-viewing-range]').forEach(button => button.onclick = () => {
      viewingInsightsRange = Number(button.dataset.viewingRange)
      $$('[data-viewing-range]').forEach(option => option.classList.toggle(
        'active', Number(option.dataset.viewingRange) === viewingInsightsRange))
      loadViewingInsights()
    })

    $('#usbRefresh').onclick = () => refreshUsb().catch(error => notice(error.message, true))
    $('#usbUp').onclick = () => browseUsb(usbPath.split('/').slice(0, -1).join('/')).catch(error => notice(error.message, true))
    $('#usbSelectAll').onclick = () => {
      const videos = usbEntries.filter(entry => entry.type === 'video')
      const allSelected = videos.every(entry => usbSelection.has(entry.path))
      videos.forEach(entry => allSelected ? usbSelection.delete(entry.path) : usbSelection.add(entry.path))
      renderUsbFiles()
    }
    $('#usbTarget').onchange = () => $('#usbChannelLabel').classList.toggle('hidden', $('#usbTarget').value !== 'channel')
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
      $('#tvGuideToggle').textContent = enabled ? 'Turn off' : 'Turn on'
      $('#tvGuideState').textContent = enabled ? 'TV guide is ready' : 'TV guide is off'
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
        return `<button type="button" class="channel-card overview-channel-card ${channel.enabled ? '' : 'hidden-channel'}" data-open-channel="${channel.number}" aria-label="Manage channel ${channel.number}, ${escapeHtml(channel.name)}">
          <span class="channel-card-top"><span class="channel-number">CH ${channel.number}</span><span class="channel-status">${channel.enabled ? 'On TV' : 'Hidden'}</span></span>
          <h3>${escapeHtml(channel.name)}</h3>
          <span class="channel-meta">${escapeHtml(contentLabel(channel.content_type))} · ${shown} of ${total} on TV</span>
          <span class="channel-preview">${preview}</span>
          <span class="channel-card-footer">Manage channel</span>
        </button>`
      }
      const first = channel.programmes[0]?.display_name
      if (document.body.classList.contains('portal-classic')) {
        return `<button type="button" class="channel-card library-main-card ${channel.enabled ? '' : 'hidden-channel'}" data-open-channel="${channel.number}" aria-label="Open channel ${channel.number}, ${escapeHtml(channel.name)}">
          <span class="library-card-top"><span class="library-channel-pill">CH ${channel.number}</span><span class="library-channel-state">${channel.enabled ? 'On TV' : 'Hidden'}</span></span>
          <span class="channel-card-copy"><h3>${escapeHtml(channel.name)}</h3><span class="channel-card-detail">${total} programme${total === 1 ? '' : 's'} · ${escapeHtml(channel.content_type === 'films' ? 'Films' : 'Shows')}</span>${first ? `<span class="library-card-preview">${escapeHtml(first)}${total > 1 ? ` <em>+ ${total - 1} more</em>` : ''}</span>` : '<span class="library-card-preview muted">Ready for its first programme</span>'}</span>
          <span class="library-card-footer"><span>${shown} shown on TV</span><span>Open channel <svg class="icon"><use href="/portal/icons.svg#signal-chevron-right"/></svg></span></span>
        </button>`
      }
      const channelArtwork = channel.metadata?.artwork
        ? ` style="background-image:linear-gradient(180deg,rgba(8,8,11,.04),rgba(8,8,11,.82)),url('/api/channel/artwork/${encodeURIComponent(channel.metadata.artwork)}')"`
        : ''
      return `<button type="button" class="channel-card library-main-card ${channel.enabled ? '' : 'hidden-channel'}" data-open-channel="${channel.number}" aria-label="Open channel ${channel.number}, ${escapeHtml(channel.name)}">
        <span class="library-channel-visual"${channelArtwork}><span class="library-card-top"><span class="library-channel-pill">CH ${channel.number}</span><span class="library-channel-state">${channel.enabled ? 'On TV' : 'Hidden'}</span></span><span class="library-channel-initial">${escapeHtml(channel.name.slice(0, 1).toUpperCase())}</span></span>
        <span class="channel-card-copy"><span class="channel-card-heading"><h3>${escapeHtml(channel.name)}</h3><svg class="icon"><use href="/portal/icons.svg#signal-chevron-right"/></svg></span><span class="channel-card-detail">${total} programme${total === 1 ? '' : 's'} · ${escapeHtml(channel.content_type === 'films' ? 'Films' : 'Shows')}</span>${first ? `<span class="library-card-preview">${escapeHtml(first)}${total > 1 ? ` <em>+ ${total - 1} more</em>` : ''}</span>` : '<span class="library-card-preview muted">Ready for its first programme</span>'}</span>
        <span class="library-card-footer"><span>${shown} shown on TV</span><span>${channel.enabled ? 'Available' : 'Hidden'}</span></span>
      </button>`
    }

    function bindChannelCards(root) {
      root.querySelectorAll('[data-open-channel]').forEach(button => {
        button.onclick = () => openChannel(Number(button.dataset.openChannel), false)
      })
    }

    function showChannelHub() {
      selectedManageChannel = null
      channelWorkspaceReturnToWatch = false
      programmePage = 1
      $('#channelHub').classList.remove('hidden')
      $('#channelWorkspace').classList.add('hidden')
      $('#backToChannels span').textContent = 'All channels'
    }

    function openChannel(number, returnToWatch = false, options = {}) {
      selectedManageChannel = Number(number)
      channelWorkspaceReturnToWatch = returnToWatch
      programmeSearch = ''
      programmeVisibility = 'all'
      programmePage = 1
      $('#backToChannels span').textContent = returnToWatch ? 'Back to MabelTV' : 'All channels'
      if (options.updateHistory !== false) {
        const parentHash = returnToWatch ? '#watch' : '#channels'
        if (location.hash !== parentHash) history.replaceState({ channelParent: true }, '', parentHash)
        history.pushState({ channelPage: true }, '', `#channel/${selectedManageChannel}/${returnToWatch ? 'watch' : 'library'}`)
      }
      openView('channels')
      renderChannels()
    }

    function closeChannelPage() {
      if (history.state?.channelPage) {
        history.back()
        return
      }
      const target = channelWorkspaceReturnToWatch ? 'watch' : 'channels'
      history.replaceState({ channelParent: true }, '', `#${target}`)
      openRequestedView()
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

    function openLibrarySheet(dialog, focus = null) {
      if (!dialog.open) dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
      if (focus) setTimeout(() => focus.focus({ preventScroll: true }), 80)
    }

    function closeLibrarySheet(dialog) {
      if (dialog.open) dialog.close()
    }

    function renderProgrammeList(channel) {
      const search = programmeSearch.trim().toLowerCase()
      const filtered = channel.programmes.filter(programme => {
        const matchesSearch = !search || programme.display_name.toLowerCase().includes(search) || programme.name.toLowerCase().includes(search)
        const matchesVisibility = programmeVisibility === 'all' || (programmeVisibility === 'enabled' ? programme.enabled : !programme.enabled)
        return matchesSearch && matchesVisibility
      })
      programmePage = Math.min(programmePage, Math.max(1, Math.ceil(filtered.length / PROGRAMMES_PER_PAGE)))
      ChannelPageComponents.renderLibrary({
        channel,
        filtered,
        page: programmePage,
        pageSize: PROGRAMMES_PER_PAGE,
        visibility: programmeVisibility,
        search: programmeSearch,
        onOpen: (selectedChannel, programme) => openWatchProgrammeSheet(selectedChannel, programme),
        onLoadMore: () => { programmePage += 1; renderProgrammeList(channel) },
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
      const channel = channels.find(value => value.number === selectedManageChannel)
      if (!channel) { showChannelHub(); return }
      $('#channelHub').classList.add('hidden')
      $('#channelWorkspace').classList.remove('hidden')
      $('#editChannelNumber').value = channel.number
      $('#editChannelName').value = channel.name
      $('#editChannelAspect').value = channel.aspect || 'crop'
      $('#editChannelContentType').value = channel.content_type || 'shows'
      ChannelPageComponents.renderHero(channel, { aspectLabel })
      $('#workspaceToggleChannel span').textContent = channel.enabled ? 'Hide channel' : 'Show channel'
      $('#workspaceToggleChannel').onclick = () => manage('toggle-channel', { channel: channel.number })
      $('#channelSettingsTitle').textContent = `Edit ${channel.name}`
      $('#workspaceSettings').onclick = () => openLibrarySheet($('#channelSettingsSheet'), $('#editChannelName'))
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
        closeLibrarySheet($('#channelSettingsSheet'))
        scanChannelTmdb(channel)
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
      $('#programmeVisibility').value = programmeVisibility
      renderProgrammeList(channel)
    }
