'use strict'

let managementBusy = false
    async function manage(action, extra = {}, preferredChannel = null) {
      if (managementBusy) return
      managementBusy = true
      try {
        notice('Working…')
        const result = await api('/api/manage', { method: 'POST', body: JSON.stringify({ action, ...extra }) })
        if (preferredChannel !== null) selectedManageChannel = Number(preferredChannel)
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

    $('#backToChannels').onclick = () => {
      if (channelWorkspaceReturnToWatch) {
        selectedManageChannel = null
        channelWorkspaceReturnToWatch = false
        remoteKind = 'channel'
        openView('watch')
        renderRemoteViewing()
      } else showChannelHub()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    const showAddChannelSheet = () => openLibrarySheet($('#addChannelPanel'), $('#newChannelNumber'))
    $('#showAddChannel').onclick = showAddChannelSheet
    $('#openAddChannelUtility').onclick = showAddChannelSheet
    $('#watchNewChannel').onclick = showAddChannelSheet
    $('#refreshChannelArtwork').onclick = async () => {
      const button = $('#refreshChannelArtwork'); button.disabled = true
      try {
        notice('Finding artwork for MabelTV programmes…')
        const result = await api('/api/tmdb/channels', { method: 'POST', body: '{}' })
        await load()
        notice(`Artwork refreshed for ${Number(result.updated || 0)} item${Number(result.updated || 0) === 1 ? '' : 's'}.`)
      } catch (error) { notice(error.message, true) }
      finally { button.disabled = false }
    }
    $('#openRecycleBin').onclick = () => openLibrarySheet($('#recycleSheet'))
    $('#watchRefreshArtwork').onclick = () => $('#refreshChannelArtwork').click()
    $('#watchRecycleBin').onclick = () => $('#openRecycleBin').click()
    $('#closeAddChannel').onclick = () => closeLibrarySheet($('#addChannelPanel'))
    $('#cancelAddChannel').onclick = () => closeLibrarySheet($('#addChannelPanel'))
    $('#closeRecycleBin').onclick = () => closeLibrarySheet($('#recycleSheet'))
    $('#closeChannelUpload').onclick = () => closeLibrarySheet($('#channelUploadPanel'))
    $('#closeChannelSettings').onclick = () => closeLibrarySheet($('#channelSettingsSheet'))
    $('#closeProgrammeActions').onclick = () => closeLibrarySheet($('#programmeActionSheet'))
    ;[$('#addChannelPanel'), $('#recycleSheet'), $('#channelUploadPanel'), $('#channelSettingsSheet'), $('#programmeActionSheet')].forEach(dialog => {
      dialog.onclick = event => { if (event.target === dialog) closeLibrarySheet(dialog) }
      dialog.onclose = () => {
        document.documentElement.style.overflow = ''
        if (dialog === $('#programmeActionSheet')) selectedProgrammeAction = null
      }
    })
    $('#programmeSearch').oninput = event => {
      programmeSearch = event.target.value
      programmePage = 1
      const channel = library.channels.find(value => value.number === selectedManageChannel)
      if (channel) renderProgrammeList(channel)
    }
    $('#programmeVisibility').onchange = event => {
      programmeVisibility = event.target.value
      programmePage = 1
      const channel = library.channels.find(value => value.number === selectedManageChannel)
      if (channel) renderProgrammeList(channel)
    }
    $$('[data-programme-visibility]').forEach(button => button.onclick = () => {
      programmeVisibility = button.dataset.programmeVisibility
      $('#programmeVisibility').value = programmeVisibility
      programmePage = 1
      const channel = library.channels.find(value => value.number === selectedManageChannel)
      if (channel) renderProgrammeList(channel)
    })
    $('#programmeActionPlay').onclick = () => {
      const item = selectedProgrammeAction
      if (!item) return
      closeLibrarySheet($('#programmeActionSheet'))
      playOnTv({ kind: 'channel', channel: item.channel.number, file: item.programme.name }, item.programme.display_name)
    }
    $('#programmeActionToggle').onclick = () => {
      const item = selectedProgrammeAction
      if (!item) return
      closeLibrarySheet($('#programmeActionSheet'))
      manage('toggle-programme', { channel: item.channel.number, file: item.programme.name })
    }
    $('#programmeActionRename').onclick = () => {
      const item = selectedProgrammeAction
      if (!item) return
      closeLibrarySheet($('#programmeActionSheet'))
      renameProgramme(item.channel, item.programme)
    }
    $('#programmeActionBin').onclick = () => {
      const item = selectedProgrammeAction
      if (!item) return
      closeLibrarySheet($('#programmeActionSheet'))
      if (confirm(`Move “${item.programme.display_name}” to the recycle bin?`)) manage('trash', { channel: item.channel.number, file: item.programme.name })
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
          queued: 'Waiting behind another video in the preparation queue…',
          processing: 'Preparing the video for smooth Raspberry Pi playback…',
          publishing: 'Publishing the prepared video…',
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

    async function sendSelectedFile(file, channel, position, total, waitUntilPublished) {
      let finalResult = {}
      const prefix = total > 1 ? `Video ${position} of ${total}: ` : ''
      $('#progress').max = file.size; $('#progress').value = 0
      $('#uploadText').textContent = `${prefix}preparing ${file.name}…`
      const created = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ channel, file_name: file.name, size: file.size }) })
      finalResult = created
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
      for (let index = 0; index < files.length; index += 1) {
        try {
          const result = await sendSelectedFile(files[index], channel, index + 1, files.length, files.length === 1)
          accepted += 1
          singleResult = result
        } catch (error) {
          failures.push({ file: files[index], message: error.message })
        }
      }
      selectedManageChannel = channel
      await load(channel).catch(() => {})
      selectedUploadFiles = failures.map(failure => failure.file)
      renderSelectedUploadFiles()
      $('#progress').value = 0
      if (failures.length) {
        notice(`${accepted} of ${files.length} videos were accepted.\n${failures.map(failure => `${failure.file.name}: ${failure.message}`).join('\n')}`, true)
        $('#uploadText').textContent = 'Failed or interrupted files remain selected. Tap Upload selected to resume them safely.'
      } else {
        $('#uploadState').classList.add('hidden')
        if (files.length > 1) {
          notice(`${accepted} videos uploaded to CH ${channel}. ${tvName()} is checking and preparing them in the background.`)
        } else {
          notice(singleResult?.refreshed
            ? `Published${singleResult.optimised ? ' and prepared' : ''} on CH ${channel}.`
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
        row.className = 'row'; row.style.marginTop = '8px'
        const name = document.createElement('span')
        name.className = 'grow'; name.textContent = file.name
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

    async function sendAdultFile(file, position, total) {
      const prefix = total > 1 ? `Film ${position} of ${total}: ` : ''
      $('#adultProgress').max = file.size; $('#adultProgress').value = 0
      const created = await api('/api/adult/uploads', {
        method: 'POST', body: JSON.stringify({ file_name: file.name, size: file.size,
                                               folder: $('#adultUploadFolder').value })
      })
      let offset = Number(created.offset) || 0, result = created
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
      for (let index = 0; index < files.length; index += 1) {
        try {
          await sendAdultFile(files[index], index + 1, files.length)
        } catch (error) {
          failures.push({ file: files[index], message: error.message })
        }
      }
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
      'return-to-mabeltv': 'Returning to MabelTV', 'open-tv-guide': 'Opening guide',
      'open-parent-menu': 'Opening menu', 'enter-adult-mode': 'Opening Adult TV',
      'close-overlay': 'Back', 'channel-up': 'Channel up', 'channel-down': 'Channel down',
      'volume-up': 'Volume up', 'volume-down': 'Volume down', 'toggle-mute': 'Sound changed',
      'navigate-up': 'Up', 'navigate-down': 'Down', 'navigate-left': 'Left',
      'navigate-right': 'Right', select: 'Selected', 'previous-programme': 'Previous programme',
      'next-programme': 'Next programme', 'restart-programme': 'Restarting programme',
      'toggle-pause': 'Playback changed', 'toggle-subtitles': 'Subtitles changed',
      'toggle-remote-lock': 'Remote lock changed', 'turn-on': 'Turning TV on',
      'turn-off': 'Turning TV off', 'toggle-power': 'Power command sent'
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
        if (command === 'turn-on' || command === 'turn-off' || command === 'toggle-power') {
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
    $('#openRemotePower').onclick = () => { renderRemoteState(liveTvState); $('#remotePowerSheet').showModal() }
    $('#closeRemotePower').onclick = $('#cancelRemotePower').onclick = () => $('#remotePowerSheet').close()
    $('#confirmRemotePower').onclick = async () => {
      $('#remotePowerSheet').close()
      await sendLiveCommand(liveTvState.standby === true ? 'turn-on' : 'turn-off', $('#openRemotePower'))
    }
    ;[$('#liveChannelSheet'), $('#remotePowerSheet')].forEach(dialog => dialog.onclick = event => {
      if (event.target === dialog) dialog.close()
    })
    $('#enterAdultMode').onclick = async () => {
      const button = $('#enterAdultMode')
      button.disabled = true
      try {
        await api('/api/live/control', { method: 'POST', body: JSON.stringify({ command: 'enter-adult-mode' }) })
        notice('Adult mode is open on MabelTV.')
      } catch (error) { notice(error.message, true) }
      finally { setTimeout(() => { button.disabled = false }, 450) }
    }
    $('#homePowerToggle').onclick = async () => {
      const button = $('#homePowerToggle')
      const turningOn = liveTvState.standby === true
      const command = turningOn ? 'turn-on' : 'turn-off'
      button.textContent = turningOn ? 'Turning On…' : 'Turning Off…'
      $('#homePowerState').textContent = turningOn ? 'Turning on…' : 'Turning off…'
      if (await sendLiveCommand(command, button)) {
        notice(turningOn
          ? 'MabelTV is turning on and selecting its HDMI input.'
          : 'MabelTV is entering standby. The Raspberry Pi stays on.')
      } else {
        refreshHomePowerState().catch(() => {})
      }
    }
    $('#portalPinForm').onsubmit = async event => {
      event.preventDefault()
      const required = library?.owner?.portal_pin_required !== false
      try {
        const result = await api('/api/portal-security', { method: 'POST', body: JSON.stringify({ current_pin: $('#portalPinCurrent').value, required: !required }) })
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
        await api('/api/account', { method: 'POST', body: JSON.stringify({ current_pin: $('#currentPin').value, new_pin: $('#newPin').value }) })
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
