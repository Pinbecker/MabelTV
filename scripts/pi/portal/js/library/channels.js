'use strict'

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
          ? `${previews}${remainder ? `<span class="more"><svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#signal-plus"/></svg>${remainder} more</span>` : ''}`
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
        bin.append(portalEmptyState({
          className: 'zero-state',
          title: 'Nothing in the recycle bin',
          message: 'Removed programmes will be kept here for 30 days.',
        }))
        return
      }
      items.forEach(item => {
        const row = document.createElement('div'); row.className = 'programme'
        const name = document.createElement('span'); name.textContent = `${item.display_name} · ${item.channel_name}`
        const actions = document.createElement('div'); actions.className = 'programme-actions'
        actions.append(
          portalButton({
            text: 'Restore',
            className: 'secondary',
            onClick: () => manage('restore', { id: item.id }),
          }),
          portalButton({
            text: 'Delete forever',
            className: 'danger',
            onClick: () => {
              if (confirm('Permanently delete this video? This cannot be undone.')) {
                manage('delete', { id: item.id })
              }
            },
          }),
        )
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
