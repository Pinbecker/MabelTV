'use strict'

    function formatBytes(bytes) {
      const value = Number(bytes || 0)
      if (value >= 1073741824) return `${(value / 1073741824).toFixed(1)} GB`
      return `${Math.max(1, Math.round(value / 1048576))} MB`
    }

    async function refreshUsb() {
      usbState = await api('/api/usb')
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
      if (!usbEntries.length) root.append(portalEmptyState({
        title: usbVolume ? 'No videos here' : 'No drive selected',
        message: usbVolume
          ? 'Open another folder.'
          : 'Select a connected USB drive to browse its videos.',
      }))
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
