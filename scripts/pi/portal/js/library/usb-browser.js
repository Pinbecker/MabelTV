'use strict'

    const usbFolderPositions = new Map()
    let usbBrowseRevision = 0
    let renderedUsbLocation = ''

    function formatBytes(bytes) {
      const value = Math.max(0, Number(bytes || 0))
      if (value >= 1073741824) return `${(value / 1073741824).toFixed(1)} GB`
      if (value >= 1048576) return `${Math.max(1, Math.round(value / 1048576))} MB`
      if (value >= 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
      return `${value} bytes`
    }

    function renderUsbDrives() {
      const root = $('#usbDriveList')
      root.innerHTML = ''
      if (!usbState.volumes.length) root.append(portalEmptyState({
        title: 'No USB drive found',
        message: 'Plug one into the Pi, wait a moment, then scan again.',
      }))
      usbState.volumes.forEach(volume => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `usb-drive ${usbVolume === volume.id ? 'active' : ''}`
        row.append(librarySignalIcon('signal-hard-drive', 'usb-drive-icon'))
        const copy = document.createElement('div')
        copy.className = 'usb-drive-copy'
        const driveState = volume.mounted ? 'Ready' : volume.sleeping
          ? 'Sleeping · wakes automatically' : 'Ready to open'
        const capacity = volume.mounted && Number.isFinite(Number(volume.free))
          ? `${formatBytes(volume.free)} free` : volume.size ? formatBytes(volume.size) : ''
        copy.innerHTML = `<strong>${escapeHtml(volume.label)}</strong><small>${[
          volume.filesystem, capacity, driveState].filter(Boolean).map(escapeHtml).join(' · ')}</small>`
        const action = document.createElement('span')
        action.className = 'usb-drive-action'
        action.append(document.createTextNode(usbVolume === volume.id ? 'Browsing'
          : volume.mounted ? 'Browse' : volume.sleeping ? 'Wake & open' : 'Open safely'),
        librarySignalIcon('signal-chevron-right'))
        row.onclick = async () => {
          row.disabled = true
          try {
            if (!volume.mounted) await api('/api/usb', {
              method: 'POST', body: JSON.stringify({ action: 'mount', device: volume.device }),
            })
            usbVolume = volume.id
            usbSelection.clear()
            await refreshUsb()
            await browseUsb('')
          } catch (error) { notice(error.message, true) }
          finally { row.disabled = false }
        }
        row.append(copy, action)
        root.append(row)
      })
    }

    function renderUsbImportBanner() {
      const jobs = usbState.imports || []
      const job = jobs.find(value => !['complete', 'error'].includes(value.status))
      $('#usbJob').classList.toggle('hidden', !job)
      if (!job) return
      const paused = job.status === 'paused'
      $('#usbJobTitle').textContent = paused ? 'USB transfer needs attention' : 'USB transfer in progress'
      $('#usbJobText').textContent = `${job.files_done || 0} of ${job.files_total || 0} videos · ${
        formatBytes(job.bytes_done)} of ${formatBytes(job.bytes_total)}${job.message ? ` · ${job.message}` : ''}`
    }

    async function refreshUsb() {
      usbState = await api('/api/usb')
      preservePortalPosition(() => {
        renderUsbDrives()
        renderUsbImportBanner()
      })
      const active = usbState.volumes.find(volume => volume.id === usbVolume && volume.mounted)
      if (!active && usbVolume) {
        usbVolume = ''
        usbPath = ''
        usbEntries = []
        usbBrowseTruncated = false
        usbSelection.clear()
        renderUsbFiles()
      }
    }

    async function browseUsb(path) {
      if (!usbVolume) return
      const volume = usbVolume
      const revision = ++usbBrowseRevision
      const originView = document.querySelector('.view.active')
      const data = await api(`/api/usb/browse?volume=${encodeURIComponent(volume)}&path=${encodeURIComponent(path)}`)
      if (revision !== usbBrowseRevision || volume !== usbVolume
          || originView !== document.querySelector('.view.active')) return
      const visible = $('#view-usb').classList.contains('active')
      if (visible && renderedUsbLocation) usbFolderPositions.set(renderedUsbLocation, capturePortalPosition({ anchor: false }))
      usbPath = data.path
      usbEntries = data.entries
      usbBrowseTruncated = data.truncated === true
      const location = JSON.stringify([volume, usbPath])
      const changed = location !== renderedUsbLocation
      renderUsbFiles()
      renderedUsbLocation = location
      if (!visible || !changed) return
      const saved = usbFolderPositions.get(location)
      if (saved) restorePortalPosition(saved)
      else setPortalScrollTop(portalScrollTop() + $('#usbBrowser').getBoundingClientRect().top - 72)
    }

    function usbBreadcrumbButton(label, path, first = false) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'usb-breadcrumb-button'
      if (first) button.append(librarySignalIcon('signal-hard-drive'))
      button.append(document.createTextNode(label))
      button.onclick = () => browseUsb(path).catch(error => notice(error.message, true))
      return button
    }

    function toggleUsbSelection(entry) {
      if (usbSelection.has(entry.path)) usbSelection.delete(entry.path)
      else usbSelection.add(entry.path)
      renderUsbFiles()
    }

    function openUsbFileActions(entry) {
      selectedUsbEntry = entry
      $('#usbFileActionsTitle').textContent = entry.name
      $('#usbFileActionsMeta').textContent = `${formatBytes(entry.size)} · Original stays on the USB drive`
      const watch = $('#usbWatchHere')
      watch.querySelector('strong').textContent = entry.browser_ready
        ? 'Watch on this device' : 'Play in VLC'
      watch.querySelector('small').textContent = entry.browser_ready
        ? 'Stream directly from the USB drive' : 'Open the original file in VLC'
      openLibrarySheet($('#usbFileActionsSheet'), watch)
    }

    function renderUsbFiles() {
      return preservePortalPosition(renderUsbFileRows)
    }

    function renderUsbFileRows() {
      const target = $('#usbFileList')
      const root = document.createDocumentFragment()
      const volume = usbState.volumes.find(item => item.id === usbVolume)
      const breadcrumb = $('#usbBreadcrumb')
      breadcrumb.replaceChildren()
      if (volume) {
        const parts = usbPath.split('/').filter(Boolean)
        $('#usbFolderTitle').textContent = parts.at(-1) || volume.label
        $('#usbPathContext').textContent = parts.length
          ? `${volume.label} · ${parts.slice(0, -1).join(' / ') || 'Drive root'}` : 'Drive root'
        breadcrumb.append(usbBreadcrumbButton(volume.label, '', true))
        parts.forEach((part, index) => {
          const divider = document.createElement('span')
          divider.className = 'usb-breadcrumb-divider'
          divider.textContent = '›'
          breadcrumb.append(divider, usbBreadcrumbButton(part, parts.slice(0, index + 1).join('/')))
        })
      } else {
        const empty = document.createElement('span')
        empty.textContent = 'Choose a connected drive to begin'
        breadcrumb.append(empty)
        $('#usbFolderTitle').textContent = 'Choose a drive'
        $('#usbPathContext').textContent = 'Browse drive'
      }
      $('#usbUp').disabled = !usbVolume || !usbPath
      const visibleVideos = usbEntries.filter(entry => entry.type === 'video')
      const allVisibleSelected = visibleVideos.length > 0
        && visibleVideos.every(entry => usbSelection.has(entry.path))
      $('#usbSelectAll').disabled = visibleVideos.length === 0
      $('#usbSelectAll').querySelector('span').textContent = allVisibleSelected
        ? 'Clear visible selection' : 'Select visible videos'
      $('#usbEject').classList.toggle('hidden', !usbVolume)
      $('#usbTruncated').classList.toggle('hidden', !usbBrowseTruncated)
      if (!usbEntries.length) root.append(portalEmptyState({
        title: usbVolume ? 'No videos here' : 'No drive selected',
        message: usbVolume ? 'Open another folder.'
          : 'Select a connected USB drive to browse its videos.',
      }))
      usbEntries.forEach(entry => {
        const row = document.createElement('article')
        row.dataset.usbPath = entry.path
        row.className = `usb-file is-${entry.type}${usbSelection.has(entry.path) ? ' selected' : ''}`
        const main = document.createElement('button')
        main.type = 'button'
        main.className = 'usb-file-main'
        main.append(librarySignalIcon(entry.type === 'folder'
          ? 'signal-folder' : 'signal-film', 'usb-file-icon'))
        const copy = document.createElement('span')
        copy.className = 'usb-file-copy'
        copy.innerHTML = `<strong>${escapeHtml(entry.name)}</strong><small>${entry.type === 'folder'
          ? 'Folder · tap to open' : `${formatBytes(entry.size)} · tap for playback options`}</small>`
        main.append(copy, librarySignalIcon('signal-chevron-right', 'usb-file-chevron'))
        main.onclick = entry.type === 'folder'
          ? () => browseUsb(entry.path).catch(error => notice(error.message, true))
          : () => openUsbFileActions(entry)

        const actions = document.createElement('div')
        actions.className = 'usb-file-actions'
        const select = document.createElement('button')
        select.type = 'button'
        select.className = 'usb-item-toggle'
        select.setAttribute('aria-label', `${usbSelection.has(entry.path) ? 'Remove' : 'Select'} ${entry.name} for copying`)
        select.setAttribute('aria-pressed', String(usbSelection.has(entry.path)))
        select.append(librarySignalIcon(usbSelection.has(entry.path) ? 'signal-check' : 'signal-plus'))
        select.onclick = () => toggleUsbSelection(entry)
        actions.append(select)
        if (entry.type === 'video') {
          const more = document.createElement('button')
          more.type = 'button'
          more.className = 'usb-file-more'
          more.setAttribute('aria-label', `More options for ${entry.name}`)
          more.append(librarySignalIcon('signal-ellipsis'))
          more.onclick = () => openUsbFileActions(entry)
          actions.append(more)
        }
        row.append(main, actions)
        root.append(row)
      })
      target.replaceChildren(root)
      updateUsbSelection()
    }

    function updateUsbSelection() {
      const count = usbSelection.size
      $('#usbSelectionTray').classList.toggle('hidden', count === 0)
      $('#usbSelectionCount').textContent = count
        ? `${count} item${count === 1 ? '' : 's'} selected` : 'Nothing selected'
      $('#usbImportSummary').textContent = count
        ? `${count} item${count === 1 ? '' : 's'} ready to review. Folders are checked for videos next.`
        : 'Choose videos or folders above.'
      $('#usbImport').disabled = !usbVolume || count === 0
    }
