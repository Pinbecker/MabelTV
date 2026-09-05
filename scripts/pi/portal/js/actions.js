'use strict'

let managementBusy = false
    const uploadSourceId = (() => {
      const key = 'mabeltv-upload-source-id'
      let value = localStorage.getItem(key)
      if (!/^[a-f0-9]{32}$/.test(value || '')) {
        value = crypto.randomUUID().replace(/-/g, '')
        localStorage.setItem(key, value)
      }
      return value
    })()

    async function waitForUploadTurn(id, label) {
      while (true) {
        await api('/api/uploads/' + id, { method: 'POST', body: JSON.stringify({ action: 'heartbeat' }) })
        const state = await api('/api/uploads/' + id)
        if (state.status === 'error') throw new Error(state.error || 'This upload was cancelled')
        if (state.transfer_state === 'active') return state
        $('#uploadText').textContent = `${label} is waiting in the upload queue. You can change its priority from Activity.`
        await new Promise(resolve => setTimeout(resolve, 1200))
      }
    }
    async function manage(action, extra = {}, preferredChannel = null) {
      if (managementBusy) return
      managementBusy = true
      const navigationRevision = channelNavigationRevision
      try {
        notice('Working…')
        const result = await api('/api/manage', { method: 'POST', body: JSON.stringify({ action, ...extra }) })
        if (preferredChannel !== null && channelNavigationRevision === navigationRevision) {
          selectedManageChannel = Number(preferredChannel)
        }
        await load(preferredChannel)
        notice(result.message || 'Done.', result.refreshed === false)
      } catch (error) { notice(error.message, true) }
      finally { managementBusy = false }
    }

    async function playOnTv(payload, title) {
      if (!confirm(`Play “${title}” on Mabel TV now? This will replace what is currently playing.`)) return
      try {
        notice(`Starting ${title} on Mabel TV…`)
        const result = await api('/api/play-on-tv', {
          method: 'POST', body: JSON.stringify(payload)
        })
        notice(result.message || `Playing ${title} on Mabel TV.`)
      } catch (error) { notice(error.message, true) }
    }

    async function renameProgramme(channel, programme) {
      const name = prompt('Programme name (keep S01E02 - at the start for episodes):', programme.display_name)
      if (name && name.trim()) await manage('rename', { channel: channel.number, file: programme.name, name: name.trim() })
    }

    $('#backToChannels').onclick = closeChannelPage
    const showAddChannelSheet = () => openLibrarySheet($('#addChannelPanel'), $('#newChannelNumber'))
    $('#showAddChannel').onclick = showAddChannelSheet
    $('#openAddChannelUtility').onclick = showAddChannelSheet
    $('#watchNewChannel').onclick = showAddChannelSheet
    $('#openRecycleBin').onclick = () => openLibrarySheet($('#recycleSheet'))
    $('#watchRecycleBin').onclick = () => $('#openRecycleBin').click()
    $('#closeAddChannel').onclick = () => closeLibrarySheet($('#addChannelPanel'))
    $('#cancelAddChannel').onclick = () => closeLibrarySheet($('#addChannelPanel'))
    $('#closeRecycleBin').onclick = () => closeLibrarySheet($('#recycleSheet'))
    $('#closeChannelUpload').onclick = () => closeLibrarySheet($('#channelUploadPanel'))
    $('#closeChannelSettings').onclick = () => closeLibrarySheet($('#channelSettingsSheet'))
    $('#watchProgrammeMoveClose').onclick = () => closeLibrarySheet($('#watchProgrammeMoveSheet'))
    ;[$('#addChannelPanel'), $('#recycleSheet'), $('#channelUploadPanel'), $('#channelSettingsSheet'), $('#watchProgrammeMoveSheet')].forEach(dialog => {
      dialog.onclick = event => { if (event.target === dialog) closeLibrarySheet(dialog) }
      dialog.oncancel = event => {
        event.preventDefault()
        closeLibrarySheet(dialog)
      }
      dialog.onclose = () => {
        document.documentElement.style.overflow = ''
      }
    })
    $('#programmeSearch').oninput = event => {
      programmeSearch = event.target.value
      programmePage = 1
      const channel = library.channels.find(value => value.number === selectedManageChannel)
      if (channel) renderProgrammeList(channel)
    }
    $('#refreshLibrary').onclick = () => manage('refresh')
    $('#editChannelForm').onsubmit = async event => {
      event.preventDefault()
      const number = Number($('#editChannelNumber').value)
      await manage('update-channel', { original_number: selectedManageChannel, number, name: $('#editChannelName').value, aspect: $('#editChannelAspect').value, content_type: $('#editChannelContentType').value }, number)
      closeLibrarySheet($('#channelSettingsSheet'))
    }
    $('#deleteChannel').onclick = () => {
      const channel = library.channels.find(value => value.number === selectedManageChannel)
      if (channel && confirm(`Delete the empty channel “${channel.name}”?`)) {
        closeLibrarySheet($('#channelSettingsSheet'))
        manage('delete-channel', { channel: channel.number })
      }
    }
    $('#addChannelForm').onsubmit = async event => {
      event.preventDefault()
      const number = Number($('#newChannelNumber').value), name = $('#newChannelName').value.trim()
      await manage('add-channel', { number, name, folder: slug(name), aspect: $('#newChannelAspect').value, content_type: $('#newChannelContentType').value }, number)
      event.target.reset()
      closeLibrarySheet($('#addChannelPanel'))
    }

    function uploadChunk(id, offset, part, finalChunk = false) {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open('PATCH', '/api/uploads/' + id, true)
        request.withCredentials = true
        request.timeout = finalChunk ? 2700000 : 30000
        request.setRequestHeader('Upload-Offset', String(offset))
        request.setRequestHeader('Content-Type', 'application/offset+octet-stream')
        request.onload = () => {
          let body = {}; try { body = JSON.parse(request.responseText) } catch (_) {}
          if (request.status < 200 || request.status >= 300) { reject(new Error(body.error || 'Upload failed')); return }
          resolve(body)
        }
        request.onerror = () => reject(new Error(`The connection to ${tvName()} was lost`))
        request.ontimeout = () => reject(new Error(finalChunk ? 'Preparation is still taking a long time. Choose the same file to check or resume it.' : `${tvName()} did not receive this upload part.`))
        request.send(part)
      })
    }

    async function resilientUploadChunk(id, offset, part, finalChunk = false) {
      try { return await uploadChunk(id, offset, part, finalChunk) }
      catch (error) {
        const saved = await api('/api/uploads/' + id)
        if (saved.status === 'error') throw new Error(saved.error || `${tvName()} could not check this video`)
        if (saved.status === 'paused') {
          $('#uploadText').textContent = 'Upload paused. Resume it from Activity to continue.'
          while (true) {
            await new Promise(resolve => setTimeout(resolve, 1200))
            const resumed = await api('/api/uploads/' + id)
            if (resumed.status === 'error') throw new Error(resumed.error || 'This upload was cancelled')
            if (resumed.status !== 'paused') {
              if (resumed.transfer_state !== 'active') return waitForUploadTurn(id, 'This file')
              return resumed
            }
          }
        }
        if (saved.status === 'uploading' && saved.transfer_state !== 'active') {
          return waitForUploadTurn(id, 'This file')
        }
        if (saved.complete || saved.processing || saved.status === 'validating' ||
            (Number.isFinite(saved.offset) && saved.offset > offset)) return saved
        throw error
      }
    }

    async function waitForPreparation(id) {
      while (true) {
        const state = await api('/api/uploads/' + id)
        if (state.complete) return state
        if (state.status === 'error') throw new Error(state.error || `${tvName()} could not prepare this video`)
        const messages = {
          validating: 'Checking that this is a playable video…',
          queued: 'Waiting briefly to publish this video…',
          processing: 'Finishing an older queued upload…',
          publishing: 'Publishing the original video…',
          finalising: 'Refreshing the TV library…'
        }
        $('#uploadText').textContent = `${messages[state.status] || 'Finishing the video…'} You may close this page and return later.`
        await new Promise(resolve => setTimeout(resolve, 2500))
      }
    }

    let selectedUploadFiles = []

    function selectedFileKey(file) {
      return `${file.name}\u0000${file.size}\u0000${file.lastModified}`
    }

    function renderSelectedUploadFiles() {
      const root = $('#selectedFiles'), button = $('#uploadButton')
      root.innerHTML = ''
      if (!selectedUploadFiles.length) {
        root.textContent = 'No videos selected yet.'
        button.disabled = true
        return
      }
      const heading = document.createElement('strong')
      heading.textContent = `${selectedUploadFiles.length} video${selectedUploadFiles.length === 1 ? '' : 's'} ready to upload`
      root.append(heading)
      selectedUploadFiles.forEach((file, index) => {
        const row = document.createElement('div')
        row.className = 'row'; row.style.marginTop = '8px'
        const name = document.createElement('span')
        name.className = 'grow'; name.textContent = file.name
        const remove = document.createElement('button')
        remove.type = 'button'; remove.className = 'link'; remove.textContent = 'Remove'
        remove.onclick = () => {
          selectedUploadFiles.splice(index, 1)
          renderSelectedUploadFiles()
        }
        row.append(name, remove); root.append(row)
      })
      button.disabled = false
    }

    $('#file').onchange = event => {
      const existing = new Set(selectedUploadFiles.map(selectedFileKey))
      Array.from(event.target.files || []).forEach(file => {
        const key = selectedFileKey(file)
        if (!existing.has(key)) { selectedUploadFiles.push(file); existing.add(key) }
      })
      event.target.value = ''
      renderSelectedUploadFiles()
    }

    async function sendSelectedFile(file, created, channel, position, total, waitUntilPublished) {
      let finalResult = {}
      const prefix = total > 1 ? `Video ${position} of ${total}: ` : ''
      $('#progress').max = file.size; $('#progress').value = 0
      $('#uploadText').textContent = `${prefix}preparing ${file.name}…`
      finalResult = created
      if (!finalResult.complete) finalResult = await waitForUploadTurn(created.id, file.name)
      let offset = Number(created.offset) || 0
      $('#progress').value = offset
      while (offset < file.size) {
        const part = file.slice(offset, Math.min(offset + 8388608, file.size))
        const finalChunk = offset + part.size >= file.size
        $('#uploadText').textContent = finalChunk
          ? `${prefix}uploading the final part of ${file.name}…`
          : `${prefix}${file.name} · ${(offset / 1048576).toFixed(0)} MB of ${(file.size / 1048576).toFixed(0)} MB`
        finalResult = await resilientUploadChunk(created.id, offset, part, finalChunk)
        offset = Number(finalResult.offset) || offset
        $('#progress').value = offset
      }
      if (waitUntilPublished && !finalResult.complete) finalResult = await waitForPreparation(created.id)
      return finalResult
    }

    $('#uploadForm').onsubmit = async event => {
      event.preventDefault()
      const files = selectedUploadFiles.slice()
      if (!files.length) return
      const channel = Number($('#channel').value), button = $('#uploadButton')
      const failures = []
      let accepted = 0, singleResult = null
      button.disabled = true
      $('#channel').disabled = true
      $('#file').disabled = true
      $('#uploadState').classList.remove('hidden')
      notice(files.length === 1 ? 'Preparing upload…' : `Uploading ${files.length} videos one at a time…`)
      const queued = []
      for (const file of files) {
        try {
          queued.push(await api('/api/uploads', { method: 'POST', body: JSON.stringify({ channel, file_name: file.name, size: file.size, source_id: uploadSourceId }) }))
        } catch (error) {
          failures.push({ file, message: error.message })
        }
      }
      await Promise.all(queued.map(async (created, index) => {
        const file = files.find(item => item.name === created.file_name) || files[index]
        try {
          const result = await sendSelectedFile(file, created, channel, index + 1, queued.length, true)
          accepted += 1
          singleResult = result
        } catch (error) { failures.push({ file, message: error.message }) }
      }))
      const stillOnUploadChannel = sameChannelSelection(
        (library.channels || []).find(value => value.number === channel))
      await load(stillOnUploadChannel ? channel : null).catch(() => {})
      selectedUploadFiles = failures.map(failure => failure.file)
      renderSelectedUploadFiles()
      $('#progress').value = 0
      if (failures.length) {
        notice(`${accepted} of ${files.length} videos were accepted.\n${failures.map(failure => `${failure.file.name}: ${failure.message}`).join('\n')}`, true)
        $('#uploadText').textContent = 'Failed or interrupted files remain selected. Tap Upload selected to resume them safely.'
      } else {
        $('#uploadState').classList.add('hidden')
        if (files.length > 1) {
          notice(`${accepted} videos published to CH ${channel} and available now.`)
        } else {
          notice(singleResult?.refreshed
            ? `Published on CH ${channel} and available now.`
            : `The video is safely stored on CH ${channel}, but the TV could not refresh. Use Retry TV refresh below.`,
            !singleResult?.refreshed)
        }
      }
      $('#channel').disabled = false
      $('#file').disabled = false
      button.disabled = selectedUploadFiles.length === 0
    }

    let selectedAdultFiles = []

    function renderSelectedAdultFiles() {
      const root = $('#adultSelectedFiles'), button = $('#adultUploadButton')
      root.innerHTML = ''
      if (!selectedAdultFiles.length) {
        root.textContent = 'No films selected yet.'
        button.disabled = true
        return
      }
      const heading = document.createElement('strong')
      heading.textContent = `${selectedAdultFiles.length} film${selectedAdultFiles.length === 1 ? '' : 's'} ready to upload`
      root.append(heading)
      selectedAdultFiles.forEach((file, index) => {
        const row = document.createElement('div')
        row.className = 'selected-upload-file'
        const name = document.createElement('span')
        name.textContent = file.name
        const remove = document.createElement('button')
        remove.type = 'button'; remove.className = 'link'; remove.textContent = 'Remove'
        remove.onclick = () => { selectedAdultFiles.splice(index, 1); renderSelectedAdultFiles() }
        row.append(name, remove); root.append(row)
      })
      button.disabled = false
    }

    $('#adultFile').onchange = event => {
      const existing = new Set(selectedAdultFiles.map(selectedFileKey))
      Array.from(event.target.files || []).forEach(file => {
        const key = selectedFileKey(file)
        if (!existing.has(key)) { selectedAdultFiles.push(file); existing.add(key) }
      })
      event.target.value = ''
      renderSelectedAdultFiles()
    }

    async function waitForAdultPreparation(id) {
      while (true) {
        const state = await api('/api/uploads/' + id)
        if (state.complete) return state
        if (state.status === 'error') throw new Error(state.error || 'MabelTV could not prepare this film')
        const messages = {
          validating: 'Checking the film…', queued: 'Waiting in the upload queue…',
          processing: 'Preparing the film…', publishing: 'Publishing the original film…',
          finalising: 'Adding the film to Adult mode…'
        }
        $('#adultUploadText').textContent = messages[state.status] || 'Preparing the film…'
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    }

    async function sendAdultFile(file, created, position, total) {
      const prefix = total > 1 ? `Film ${position} of ${total}: ` : ''
      $('#adultProgress').max = file.size; $('#adultProgress').value = 0
      let result = created
      if (!result.complete) result = await waitForUploadTurn(created.id, file.name)
      let offset = Number(result.offset) || 0
      while (offset < file.size) {
        const part = file.slice(offset, Math.min(offset + 8388608, file.size))
        const finalChunk = offset + part.size >= file.size
        $('#adultUploadText').textContent = finalChunk
          ? `${prefix}finishing ${file.name}…`
          : `${prefix}${file.name} · ${(offset / 1048576).toFixed(0)} MB of ${(file.size / 1048576).toFixed(0)} MB`
        result = await resilientUploadChunk(created.id, offset, part, finalChunk)
        offset = Number(result.offset) || offset
        $('#adultProgress').value = offset
      }
      if (!result.complete) result = await waitForAdultPreparation(created.id)
      return result
    }

    $('#adultUploadForm').onsubmit = async event => {
      event.preventDefault()
      const files = selectedAdultFiles.slice()
      if (!files.length) return
      const failures = []
      $('#adultUploadButton').disabled = true
      $('#adultFile').disabled = true
      $('#adultUploadState').classList.remove('hidden')
      notice(files.length === 1 ? 'Uploading film…' : `Uploading ${files.length} films one at a time…`)
      const queued = await Promise.all(files.map(async file => ({ file, created: await api('/api/adult/uploads', {
        method: 'POST', body: JSON.stringify({ file_name: file.name, size: file.size,
          folder: $('#adultUploadFolder').value, source_id: uploadSourceId })
      }) })))
      await Promise.all(queued.map(async ({ file, created }, index) => {
        try { await sendAdultFile(file, created, index + 1, queued.length) }
        catch (error) { failures.push({ file, message: error.message }) }
      }))
      selectedAdultFiles = failures.map(failure => failure.file)
      renderSelectedAdultFiles()
      $('#adultProgress').value = 0
      $('#adultUploadState').classList.toggle('hidden', failures.length === 0)
      await load().catch(() => {})
      if (failures.length) {
        $('#adultUploadText').textContent = 'Interrupted films remain selected so you can resume them.'
        notice(`${files.length - failures.length} of ${files.length} films were added.\n${failures.map(failure => `${failure.file.name}: ${failure.message}`).join('\n')}`, true)
      } else {
        notice(`${files.length} film${files.length === 1 ? '' : 's'} added to Adult mode in original quality. Test them on TV first.`)
        closeLibrarySheet($('#adultUploadSheet'))
      }
      $('#adultFile').disabled = false
      $('#adultUploadButton').disabled = selectedAdultFiles.length === 0
    }

    function renderSelectedAdultSeriesFiles() {
      const root = $('#adultSeriesSelectedFiles')
      const button = $('#adultSeriesUploadButton')
      root.replaceChildren()
      if (!selectedAdultSeriesFiles.length) {
        root.textContent = 'No episodes selected yet.'
        button.disabled = true
        return
      }
      const heading = document.createElement('strong')
      heading.textContent = `${selectedAdultSeriesFiles.length} episode${selectedAdultSeriesFiles.length === 1 ? '' : 's'} ready`
      root.append(heading)
      selectedAdultSeriesFiles.forEach((file, index) => {
        const row = document.createElement('div')
        row.className = 'selected-upload-file'
        const name = document.createElement('span')
        name.textContent = file.name
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'link'
        remove.textContent = 'Remove'
        remove.onclick = () => {
          selectedAdultSeriesFiles.splice(index, 1)
          renderSelectedAdultSeriesFiles()
        }
        row.append(name, remove)
        root.append(row)
      })
      button.disabled = false
    }

    $('#adultSeriesFile').onchange = event => {
      const existing = new Set(selectedAdultSeriesFiles.map(selectedFileKey))
      Array.from(event.target.files || []).forEach(file => {
        const key = selectedFileKey(file)
        if (!existing.has(key)) {
          selectedAdultSeriesFiles.push(file)
          existing.add(key)
        }
      })
      event.target.value = ''
      renderSelectedAdultSeriesFiles()
    }

    async function waitForAdultSeriesPreparation(id) {
      while (true) {
        const state = await api('/api/uploads/' + id)
        if (state.complete) return state
        if (state.status === 'error') throw new Error(state.error || 'MabelTV could not add this episode')
        const messages = {
          validating: 'Checking the episode…', queued: 'Waiting in the upload queue…',
          publishing: 'Adding the episode to its series…', finalising: 'Updating the series library…',
        }
        $('#adultSeriesUploadText').textContent = messages[state.status] || 'Preparing the episode…'
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    }

    async function sendAdultSeriesFile(file, created, position, total, season) {
      const prefix = total > 1 ? `Episode ${position} of ${total}: ` : ''
      $('#adultSeriesProgress').max = file.size
      $('#adultSeriesProgress').value = 0
      let result = created
      if (!result.complete) result = await waitForUploadTurn(created.id, file.name)
      let offset = Number(result.offset) || 0
      while (offset < file.size) {
        const part = file.slice(offset, Math.min(offset + 8388608, file.size))
        const finalChunk = offset + part.size >= file.size
        $('#adultSeriesUploadText').textContent = finalChunk
          ? `${prefix}finishing ${file.name}…`
          : `${prefix}${file.name} · ${(offset / 1048576).toFixed(0)} MB of ${(file.size / 1048576).toFixed(0)} MB`
        result = await resilientUploadChunk(created.id, offset, part, finalChunk)
        offset = Number(result.offset) || offset
        $('#adultSeriesProgress').value = offset
      }
      if (!result.complete) result = await waitForAdultSeriesPreparation(created.id)
      return result
    }

    $('#adultSeriesUploadForm').onsubmit = async event => {
      event.preventDefault()
      const files = selectedAdultSeriesFiles.slice()
      const target = adultSeriesUploadTarget
      const season = Number(target?.season)
      if (!files.length || !target || !Number.isInteger(season) || season < 1 || season > 99) return
      const failures = []
      $('#adultSeriesUploadButton').disabled = true
      $('#adultSeriesFile').disabled = true
      $('#adultSeriesUploadState').classList.remove('hidden')
      notice(files.length === 1 ? 'Uploading episode…' : `Uploading ${files.length} episodes one at a time…`)
      const queued = await Promise.all(files.map(async file => ({ file, created: await api('/api/adult/series/uploads', {
        method: 'POST', body: JSON.stringify({ series: target.id, season, file_name: file.name,
          size: file.size, source_id: uploadSourceId }),
      }) })))
      await Promise.all(queued.map(async ({ file, created }, index) => {
        try { await sendAdultSeriesFile(file, created, index + 1, queued.length, season) }
        catch (error) { failures.push({ file, message: error.message }) }
      }))
      selectedAdultSeriesFiles = failures.map(failure => failure.file)
      renderSelectedAdultSeriesFiles()
      $('#adultSeriesProgress').value = 0
      $('#adultSeriesUploadState').classList.toggle('hidden', failures.length === 0)
      await load().catch(() => {})
      if (failures.length) {
        $('#adultSeriesUploadText').textContent = 'Interrupted episodes remain selected so you can resume them.'
        notice(`${files.length - failures.length} of ${files.length} episodes were added.\n${failures.map(failure => `${failure.file.name}: ${failure.message}`).join('\n')}`, true)
      } else {
        closeLibrarySheet($('#adultSeriesUploadSheet'), false)
        adultSeriesUploadTarget = null
        notice(`${files.length} episode${files.length === 1 ? '' : 's'} added to Series ${season}.`)
        target.successReturn?.()
      }
      $('#adultSeriesFile').disabled = false
      $('#adultSeriesUploadButton').disabled = selectedAdultSeriesFiles.length === 0
    }

    async function systemAction(action, waitingText) {
      notice(waitingText)
      try {
        const result = await api('/api/system', { method: 'POST', body: JSON.stringify({ action }) })
        notice(result.message || 'Done.')
        if (action === 'restart-player') setTimeout(() => refreshLiveStatus().catch(() => {}), 2500)
      } catch (error) { notice(error.message, true) }
    }
    $('#checkAgain').onclick = async () => { try { notice('Checking…'); await refreshLiveStatus(); notice('Checks updated.') } catch (error) { notice(error.message, true) } }
    $('#restartPlayer').onclick = () => { if (confirm('Restart the TV player now? The picture will disappear briefly.')) systemAction('restart-player', 'Restarting the TV player…') }
    $('#rebootPi').onclick = () => { if (confirm(`Restart the Raspberry Pi now? ${tvName()} will be unavailable for about a minute.`)) systemAction('reboot', 'Restarting the Raspberry Pi…') }
    $('#poweroffPi').onclick = () => { if (confirm('Shut down the Raspberry Pi now? You will need to switch its power back on afterwards.')) systemAction('poweroff', 'Shutting down safely…') }
    const liveCommandFeedback = {
      'return-to-mabeltv': 'Returning to MabelTV', 'open-channel-menu': 'Opening channel menu',
      'open-parent-menu': 'Opening menu', 'enter-adult-mode': 'Opening Adult TV',
      'close-overlay': 'Back', 'channel-up': 'Channel up', 'channel-down': 'Channel down',
      'volume-up': 'Volume up', 'volume-down': 'Volume down', 'toggle-mute': 'Sound changed',
      'navigate-up': 'Up', 'navigate-down': 'Down', 'navigate-left': 'Left',
      'navigate-right': 'Right', select: 'Selected', 'previous-programme': 'Previous programme',
      'next-programme': 'Next programme', 'restart-programme': 'Restarting programme',
      'toggle-pause': 'Playback changed', 'toggle-subtitles': 'Subtitles changed',
      'toggle-widescreen-mode': 'Widescreen mode changed',
      'toggle-remote-lock': 'Remote lock changed', 'turn-on': 'Turning TV on',
      'turn-off': 'Turning TV off', 'turn-on-mabel-only': 'Turning MabelTV on',
      'turn-off-mabel-only': 'Putting MabelTV in standby', 'toggle-power': 'Power command sent'
    }

    async function sendLiveCommand(command, button = null, extra = {}) {
      if (button?.dataset.remoteBusy === 'true') return
      if (button) {
        button.dataset.remoteBusy = 'true'
        button.classList.add('is-sending')
      }
      navigator.vibrate?.(8)
      setRemoteFeedback(liveCommandFeedback[command] || 'Sending…', '', 0)
      try {
        await api('/api/live/control', { method: 'POST', body: JSON.stringify({ command, ...extra }) })
        if (button) {
          button.classList.remove('is-sending')
          button.classList.add('command-ok')
          setTimeout(() => button.classList.remove('command-ok'), 380)
        }
        setRemoteFeedback(liveCommandFeedback[command] || 'Done', 'success')
        if (['turn-on', 'turn-off', 'turn-on-mabel-only', 'turn-off-mabel-only',
          'toggle-power'].includes(command)) {
          setTimeout(() => {
            refreshLiveTv(true)
            refreshHomePowerState().catch(() => {})
          }, 1400)
        } else {
          setTimeout(() => refreshLiveTv(false), 280)
        }
        return true
      } catch (error) {
        if (button) button.classList.remove('is-sending')
        setRemoteFeedback('Command failed', 'error', 2200)
        notice(error.message, true)
        return false
      } finally {
        if (button) delete button.dataset.remoteBusy
      }
    }

    async function tuneLiveChannel(channel, button) {
      if (!Number.isInteger(channel)) return
      await sendLiveCommand('tune-channel', button, { channel })
      $('#liveChannelSheet').close()
      setRemoteFeedback(`Opening channel ${channel}`, 'success')
    }

    $$('[data-live-command]').forEach(button => button.onclick = () => sendLiveCommand(button.dataset.liveCommand, button))
    $('#openLiveChannels').onclick = () => { renderLiveChannelOptions(); $('#liveChannelSheet').showModal() }
    $('#closeLiveChannels').onclick = () => $('#liveChannelSheet').close()
    function connectedTvAlreadyAtTarget(state, turningOn) {
      const power = String(state?.connected_tv_power || '').trim().toLocaleLowerCase()
      return turningOn
        ? power === 'on' || power.includes('standby to on')
        : power === 'standby' || power.includes('on to standby')
    }

    async function openPortalPowerSheet(event) {
      const trigger = event?.currentTarget || null
      try {
        liveTvState = await api('/api/live')
      } catch (_) {
        // The last poll is still safer than inventing a second power state.
      }
      renderRemoteState(liveTvState)
      const turningOn = liveTvState.standby === true
      if (connectedTvAlreadyAtTarget(liveTvState, turningOn)) {
        await applyPortalPower(false, trigger)
        return
      }
      const dialog = $('#remotePowerSheet')
      if (!dialog.open) dialog.showModal()
    }

    async function applyPortalPower(includeConnectedTv, button) {
      const turningOn = liveTvState.standby === true
      const command = turningOn
        ? (includeConnectedTv ? 'turn-on' : 'turn-on-mabel-only')
        : (includeConnectedTv ? 'turn-off' : 'turn-off-mabel-only')
      const dialog = $('#remotePowerSheet')
      if (dialog.open) dialog.close()
      if (await sendLiveCommand(command, button)) {
        notice(turningOn
          ? (includeConnectedTv
              ? 'MabelTV is turning on and selecting its HDMI input.'
              : 'MabelTV is turning on. The connected television is unchanged.')
          : (includeConnectedTv
              ? 'MabelTV and the connected television are entering standby.'
              : 'MabelTV is entering standby. The connected television is unchanged.'))
      }
    }

    $('#openRemotePower').onclick = openPortalPowerSheet
    $('#closeRemotePower').onclick = $('#cancelRemotePower').onclick = () => $('#remotePowerSheet').close()
    $('#confirmRemotePower').onclick = () => applyPortalPower(true, $('#confirmRemotePower'))
    $('#mabelOnlyRemotePower').onclick = () => applyPortalPower(false, $('#mabelOnlyRemotePower'))
    ;[$('#liveChannelSheet'), $('#remotePowerSheet')].forEach(dialog => dialog.onclick = event => {
      if (event.target === dialog) dialog.close()
    })
    const enterAdultMode = $('#enterAdultMode')
    if (enterAdultMode) enterAdultMode.onclick = async () => {
      const button = enterAdultMode
      button.disabled = true
      try {
        await api('/api/live/control', { method: 'POST', body: JSON.stringify({ command: 'enter-adult-mode' }) })
        notice('Adult mode is open on MabelTV.')
      } catch (error) { notice(error.message, true) }
      finally { setTimeout(() => { button.disabled = false }, 450) }
    }
    $('#homePowerToggle').onclick = openPortalPowerSheet
    $('#portalPinForm').onsubmit = async event => {
      event.preventDefault()
      const required = library?.owner?.portal_pin_required !== false
      try {
        const currentPin = $('#portalPinCurrent').value
        const result = await api('/api/portal-security', { method: 'POST', body: JSON.stringify({ current_pin: currentPin, required: !required }) })
        await syncOfflineSecurity(result.portal_pin_required, currentPin)
        setOfflineProtectedAccess(result.portal_pin_required === false)
        $('#portalPinCurrent').value = ''
        library.owner = { ...(library.owner || {}), portal_pin_required: result.portal_pin_required }
        renderPortalPinSetting()
        notice(result.portal_pin_required ? 'Portal PIN entry is on.' : 'Portal PIN entry is off. Your PIN is still saved.')
      } catch (error) { notice(error.message, true) }
    }
    $('#pinForm').onsubmit = async event => {
      event.preventDefault()
      if ($('#newPin').value !== $('#newPinAgain').value) { notice('The two new PINs do not match.', true); return }
      try {
        const newPin = $('#newPin').value
        await api('/api/account', { method: 'POST', body: JSON.stringify({ current_pin: $('#currentPin').value, new_pin: newPin }) })
        await syncOfflineSecurity(library?.owner?.portal_pin_required !== false, newPin)
        setOfflineProtectedAccess(false)
        $('#currentPin').value = ''; $('#newPin').value = ''; $('#newPinAgain').value = ''
        showOnly('login')
        $('#loginError').classList.remove('bad')
        $('#loginError').textContent = 'Your parent PIN was changed. Sign in again with the new PIN.'
        $('#pin').focus()
      } catch (error) { notice(error.message, true) }
    }
    $('#tvNameForm').onsubmit = async event => {
      event.preventDefault()
      if (!$('#tvNameChild').checkValidity()) { $('#tvNameChild').reportValidity(); return }
      try {
        const identity = await api('/api/identity', { method: 'POST', body: JSON.stringify({ child_name: $('#tvNameChild').value }) })
        library.owner = { ...(library.owner || {}), ...identity }
        applyTvName()
        notice(identity.player_restarted
          ? `${identity.tv_name} is saved. The TV picture will refresh briefly.`
          : `${identity.tv_name} is saved. Restart the TV player to show the new name on screen.`)
      } catch (error) { notice(error.message, true) }
    }
    $('#tvSettingsForm').onsubmit = async event => {
      event.preventDefault()
      const settings = {
        playback_mode: $('#tvPlaybackMode').value,
        episode_reset_minutes: Number($('#tvEpisodeReset').value),
        picture_mode: $('#tvPictureMode').value,
        tv_border: $('#tvBorder').value,
        crt_glass: Number($('#tvCrtGlass').value),
        video_distortion: Number($('#tvDistortion').value),
        display_resolution: $('#tvDisplayResolution').value,
        volume_limit_enabled: $('#tvVolumeLimit').value === 'true',
        maximum_volume: Number($('#tvMaximumVolume').value),
        sound_effects_enabled: $('#tvSoundEffects').value === 'true',
        scrubbing_enabled: $('#tvScrubbing').value === 'true',
      }
      await manage('set-tv-settings', { settings })
    }

    initialise()
    setInterval(() => {
      if (!$('#app').classList.contains('hidden')) refreshLiveStatus().catch(() => {})
    }, 60000)
