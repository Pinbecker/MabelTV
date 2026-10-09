'use strict'

    const watchTabPositions = new Map()
    let renderedWatchKind = null
    let mabelChannelKind = 'episodes'
    const mabelChannelTabs = [['episodes', 'Episodes'], ['films', 'Films'], ['playlists', 'Playlists'], ['storytime', 'Stories']]
    function mabelChannelPanelId(kind) {
      const name = kind === 'storytime' ? 'Audio' : mabelChannelTabs.find(([value]) => value === kind)[1]
      return `mabelChannel${name}`
    }
    const mabelFilmRailPositions = new Map()

    function updateMabelChannelScrollFloor(scrollY = portalScrollTop()) {
      const browser = $('#remoteMabel')
      if (!browser?.offsetWidth || browser.classList.contains('hidden') || !$('#view-watch').classList.contains('active')) return
      const panel = browser.querySelector('.mabel-channel-panel:not(.hidden)')
      const toggle = browser.querySelector('.mabel-channel-toggle')
      if (!panel || !toggle) return
      const naturalHeight = panel.offsetHeight + toggle.offsetHeight + parseFloat(getComputedStyle(browser).rowGap || 0)
      const outsideHeight = document.scrollingElement.scrollHeight - browser.offsetHeight
      const floor = scrollY + window.innerHeight - outsideHeight
      // Keep the current viewport in place when changing to a shorter list.
      // Release that extra space as the parent scrolls upwards.
      browser.style.minHeight = floor > naturalHeight ? `${Math.ceil(floor)}px` : ''
    }

    function selectMabelChannelKind(kind) {
      if (!mabelChannelTabs.some(([value]) => value === kind) || kind === mabelChannelKind) return
      const position = capturePortalPosition({ anchor: false })
      const browser = $('#remoteMabel')
      if (mabelChannelKind === 'films') browser.querySelectorAll('.watch-film-channel-rail').forEach(rail =>
        mabelFilmRailPositions.set(rail.closest('[data-watch-channel-folder]').dataset.watchChannelFolder, rail.scrollLeft))
      mabelChannelKind = kind
      browser.querySelectorAll('[data-mabel-channel-kind]').forEach(button => {
        const selected = button.dataset.mabelChannelKind === kind
        button.setAttribute('aria-selected', String(selected))
        button.tabIndex = selected ? 0 : -1
      })
      browser.querySelectorAll('.mabel-channel-panel').forEach(panel =>
        panel.classList.toggle('hidden', panel.id !== mabelChannelPanelId(kind)))
      if (kind === 'playlists') loadMabelPlaylists().catch(showError)
      if (kind === 'storytime' || kind === 'episodes') loadFamilyLibrary().catch(showError)
      updateMabelChannelScrollFloor(position.scrollY)
      restorePortalPosition(position)
      if (kind === 'films') browser.querySelectorAll('.watch-film-channel-rail').forEach(rail => {
        rail.scrollLeft = mabelFilmRailPositions.get(rail.closest('[data-watch-channel-folder]').dataset.watchChannelFolder) || 0
      })
    }

    window.addEventListener('scroll', () => {
      if ($('#remoteMabel')?.style.minHeight) updateMabelChannelScrollFloor()
    }, { passive: true })

    function renderRemoteViewing({ force = false } = {}) {
      const position = capturePortalPosition()
      const visible = position.view?.id === 'view-watch'
      const renderedKey = `${watchDomain}:${remoteKind}`
      if (visible && renderedWatchKind && !position.locked) watchTabPositions.set(renderedWatchKind, position)
      const changed = renderedWatchKind !== renderedKey
      if (!changed && !force) return
      if (changed) cancelPortalScrollSettlement()
      renderWatchSections()
      renderedWatchKind = renderedKey
      const restored = visible && changed ? watchTabPositions.get(renderedKey) || position : position
      if (visible && remoteKind === 'channel') updateMabelChannelScrollFloor(restored.scrollY)
      restorePortalPosition(restored)
    }

    function renderWatchSections() {
      const remote = library?.remote_viewing || {}; const simultaneous = remote.allow_simultaneous === true
      $('#remoteConcurrentToggle').textContent = simultaneous ? 'On' : 'Off'
      $('#remoteConcurrentState').textContent = simultaneous
        ? 'On · TV and browser can play together' : 'Off · one player at a time'
      $('#remoteConcurrentToggle').setAttribute('aria-pressed', String(simultaneous))
      $('#remoteConcurrentToggle').setAttribute('aria-checked', String(simultaneous))
      $('#watchDomainTitle').textContent = watchDomain === 'my_tv' ? 'My TV' : tvName()
      $('#watchDomainFooter').innerHTML = watchDomain === 'my_tv'
        ? 'My TV · Downloads' : `<span data-tv-name>${escapeHtml(tvName())}</span> · Remote viewing`
      $('#watchMabelTab').classList.toggle('active', remoteKind === 'channel'); $('#watchMabelTab').setAttribute('aria-selected', String(remoteKind === 'channel'))
      $('#watchMabelInsightsTab').classList.remove('active'); $('#watchMabelInsightsTab').setAttribute('aria-selected', 'false')
      $('#watchDownloadsTab').classList.toggle('active', remoteKind === 'downloads'); $('#watchDownloadsTab').setAttribute('aria-selected', String(remoteKind === 'downloads'))
      $('#watchMabelLayout').classList.toggle('hidden', remoteKind !== 'channel')
      $('#watchDownloadsLayout').classList.toggle('hidden', remoteKind !== 'downloads')
      const mabelAdmin = $('#watchMabelAdmin')
      if (mabelAdmin) mabelAdmin.classList.toggle('hidden', remoteKind !== 'channel')
      if (remoteKind === 'downloads') {
        renderDownloads().catch(showError)
        return
      }
      const mabel = $('#remoteMabel'); mabel.innerHTML = ''; mabel.style.minHeight = ''
      const mabelFilms = mabelFilmEntries()
      renderMabelDiscovery(mabelFilms)
      const channels = [...(library?.channels || [])].sort((left, right) =>
        Number(left.number || 0) - Number(right.number || 0))
      const episodeChannels = channels.filter(channel => !['films', 'memories'].includes(channel.content_type))
      const filmChannels = channels.filter(channel => channel.content_type === 'films')
      const toggle = document.createElement('div')
      toggle.className = 'mabel-channel-toggle'
      toggle.setAttribute('role', 'tablist')
      toggle.setAttribute('aria-label', 'Browse TV channels')
      const panels = {}
      for (const [kind, label] of mabelChannelTabs) {
        const button = document.createElement('button')
        button.type = 'button'; button.id = mabelChannelPanelId(kind) + 'Tab'
        button.dataset.mabelChannelKind = kind
        button.textContent = label
        button.setAttribute('role', 'tab')
        button.setAttribute('aria-controls', mabelChannelPanelId(kind))
        button.setAttribute('aria-selected', String(mabelChannelKind === kind))
        button.tabIndex = mabelChannelKind === kind ? 0 : -1
        button.onclick = () => selectMabelChannelKind(kind)
        button.onkeydown = event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const index = mabelChannelTabs.findIndex(([value]) => value === mabelChannelKind)
          const next = mabelChannelTabs[event.key === 'Home' ? 0 : event.key === 'End' ? mabelChannelTabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + mabelChannelTabs.length) % mabelChannelTabs.length][0]
          selectMabelChannelKind(next)
          toggle.querySelector(`[data-mabel-channel-kind="${next}"]`).focus({ preventScroll: true })
        }
        toggle.append(button)
        const panel = document.createElement('div')
        panel.id = mabelChannelPanelId(kind)
        panel.className = `mabel-channel-panel${mabelChannelKind === kind ? '' : ' hidden'}`
        panel.setAttribute('role', 'tabpanel')
        panel.setAttribute('aria-labelledby', button.id)
        panels[kind] = panel
      }
      mabel.append(toggle, ...Object.values(panels))
      renderMabelPlaylists(); renderStorytimeLibrary(); renderMemoryLibrary()
      if (mabelChannelKind === 'playlists') loadMabelPlaylists().catch(showError)
      if (['storytime', 'episodes'].includes(mabelChannelKind)) loadFamilyLibrary().catch(showError)
      const episodeArtworkPositions = {
        'mabel-show-1-1588.jpg': '82% center',
        'mabel-show-2-69926.jpg': '85% center',
        'mabel-show-9-322913.jpg': '88% center',
      }
      if (episodeChannels.length) {
        const section = document.createElement('section')
        section.className = 'watch-section mabel-episode-channel-section'
        const grid = document.createElement('div')
        grid.className = 'mabel-episode-channel-grid'
        episodeChannels.forEach(channel => {
          const programmes = channel.enabled
            ? (channel.programmes || []).filter(programme => programme.enabled)
            : []
          const metadata = channel.metadata || {}
          const card = document.createElement('button')
          card.type = 'button'
          card.className = 'watch-card watch-mabel-series-channel-card'
          card.setAttribute('aria-label', `Open channel ${channel.number}, ${channel.name}`)
          const art = document.createElement('span')
          art.className = 'watch-card-art'
          const artwork = channel.name === 'Family Videos'
            ? 'mabel-show-10-0.jpg'
            : metadata.artwork
          if (artwork) {
            const image = document.createElement('img')
            image.loading = 'lazy'
            image.decoding = 'async'
            image.src = `/api/channel/artwork/${encodeURIComponent(artwork)}`
            image.style.objectPosition = episodeArtworkPositions[artwork] || '50% center'
            image.alt = ''
            art.append(image)
          } else {
            const placeholder = document.createElement('span')
            placeholder.className = 'watch-card-placeholder'
            placeholder.textContent = String(metadata.title || channel.name).slice(0, 1).toUpperCase()
            art.append(placeholder)
          }
          const copy = document.createElement('span')
          copy.className = 'watch-card-copy watch-mabel-channel-copy'
          const detail = document.createElement('small')
          detail.textContent = `CH ${channel.number} · ${channel.enabled
            ? `${programmes.length} EP`
            : 'Hidden from TV'}`
          const title = document.createElement('strong')
          title.textContent = metadata.title || channel.name
          copy.append(detail, title)
          card.append(art, copy)
          card.onclick = () => openChannel(channel, true)
          grid.append(card)
        })
        section.append(grid)
        panels.episodes.append(section)
      }
      const memories = document.createElement('section'); memories.id = 'mabelMemoryChannels'
      panels.episodes.append(memories); renderMemoryLibrary()
      filmChannels.forEach(channel => {
        const programmes = channel.enabled
          ? (channel.programmes || []).filter(programme => programme.enabled)
          : []
        const section = document.createElement('section'); section.className = 'watch-section mabel-channel-section mabel-film-channel'
        section.dataset.watchChannelFolder = String(channel.folder || '')
        const head = document.createElement('button'); head.type = 'button'; head.className = 'watch-section-head mabel-film-head'
        head.innerHTML = `<span class="mabel-film-head-copy"><span>CH ${channel.number} · ${channel.enabled ? `${programmes.length} film${programmes.length === 1 ? '' : 's'}` : 'Hidden from TV'}</span><h2>${escapeHtml(channel.name)}</h2></span><svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#signal-chevron-right"/></svg>`
        head.setAttribute('aria-label', `Open channel ${channel.number}, ${channel.name}`); head.onclick = () => openChannel(channel, true); section.append(head)
        if (programmes.length) {
          const rail = document.createElement('div')
          rail.className = 'watch-channel-rail watch-film-channel-rail'
          rail.setAttribute('aria-label', `${channel.name} films`)
          programmes.forEach(programme => {
            const card = document.createElement('button'); card.type = 'button'
            const programmeMetadata = programme.metadata || {}
            const resumable = watchFilmResumable(programme)
            const progressValue = watchFilmProgress(programme)
            card.className = 'watch-card watch-mabel-film-card'
            card.setAttribute('aria-label', `${watchFilmTitle(programme)}${resumable ? `, resume at ${watchTimeLabel(programme.remote_position)}` : ''}`)
            const art = document.createElement('span'); art.className = 'watch-card-art'
            if (programmeMetadata.poster) {
              const image = document.createElement('img')
              image.loading = 'lazy'
              image.decoding = 'async'
              image.src = `/api/channel/artwork/${encodeURIComponent(programmeMetadata.poster)}`
              image.alt = ''
              image.loading = 'lazy'
              art.append(image)
            } else {
              const placeholder = document.createElement('span')
              placeholder.className = 'watch-card-placeholder'
              placeholder.textContent = watchFilmTitle(programme).slice(0, 1).toUpperCase()
              art.append(placeholder)
            }
            if (programme.browser_ready === false) {
              const format = document.createElement('span')
              format.className = 'watch-format'
              format.textContent = 'VLC READY'
              art.append(format)
            }
            if (resumable && progressValue) {
              const progress = document.createElement('span')
              progress.className = 'watch-progress'
              const fill = document.createElement('span')
              fill.style.width = `${progressValue}%`
              progress.append(fill)
              art.append(progress)
            }
            const copy = document.createElement('span'); copy.className = 'watch-card-copy'
            const title = document.createElement('strong'); title.textContent = watchFilmTitle(programme)
            const detail = document.createElement('small')
            detail.textContent = resumable
              ? `Resume · ${watchTimeLabel(programme.remote_position)}`
              : [programmeMetadata.year, channel.name].filter(Boolean).join(' · ') || 'Film'
            copy.append(title, detail)
            card.append(art, copy)
            card.onclick = () => openWatchProgrammeSheet(channel, programme)
            rail.append(card)
          })
          section.append(rail)
        } else {
          const empty = document.createElement('p'); empty.className = 'watch-channel-empty'; empty.textContent = channel.enabled ? 'No programmes are currently shown. Open this channel to manage it.' : 'This channel is hidden from the television. Open it to make changes.'; section.append(empty)
        }
        panels.films.append(section)
      })
      for (const [kind, panel] of Object.entries(panels)) {
        if (!panel.children.length) panel.append(portalEmptyState({
          className: 'watch-empty',
          message: `No ${kind === 'films' ? 'film' : 'episode'} channels have been created yet.`,
        }))
      }
      startMabelFilmArtCycle()
      renderMyTvWatch()
      renderHomeLibrary()
    }

    $('#watchMabelTab').onclick = () => navigateDomainRoute(watchDomain, 'watch')
    $('#watchMabelInsightsTab').onclick = () => navigateDomainRoute(watchDomain, 'insights')
    $('#watchDownloadsTab').onclick = () => navigateDomainRoute(watchDomain, 'downloads')
    $('#myTvHomeWatchTab').onclick = () => navigateDomainRoute('my_tv', 'watch')
    $('#myTvHomeInsightsTab').onclick = () => navigateDomainRoute('my_tv', 'insights')
    $('#myTvHomeDownloadsTab').onclick = () => navigateDomainRoute('my_tv', 'downloads')
    const watchTitle = $('#view-watch .watch-title > div:first-child')
    watchTitle.onclick = () => scrollPortalToTop()
    watchTitle.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        scrollPortalToTop()
      }
    }
    window.addEventListener('mabeltv-downloads-changed', () => {
      if (remoteKind === 'downloads') renderDownloads().catch(() => {})
    })
    window.addEventListener('offline', () => {
      document.body.classList.add('offline-mode')
      offlineMode = true
      portalConnectionState = 'offline'
      const active = document.querySelector('.view.active')?.id.replace(/^view-/, '') || 'overview'
      openView(active)
    })
    window.addEventListener('online', () => {
      portalConnectionState = 'connecting'
      void attemptPortalReconnect()
    })
    $('#watchSearch').oninput = event => { watchSearchText = event.target.value; renderMyTvWatch() }
    $('#watchSearchClear').onclick = event => { event.preventDefault(); watchSearchText = ''; renderMyTvWatch(); $('#watchSearch').focus() }
    $('#watchMabelSearch').oninput = event => { mabelSearchText = event.target.value; renderMabelDiscovery(mabelFilmEntries()) }
    $('#watchMabelSearchClear').onclick = event => { event.preventDefault(); mabelSearchText = ''; renderMabelDiscovery(mabelFilmEntries()); $('#watchMabelSearch').focus() }
    const myTvSeriesCreate = $('#myTvSeriesCreate')
    if (myTvSeriesCreate) myTvSeriesCreate.onclick = async () => {
      const name = prompt('Series name:')
      if (!name?.trim()) return
      try {
        await api('/api/manage', { method: 'POST', body: JSON.stringify({
          action: 'create-my-tv-series', name: name.trim(),
        }) })
        await reloadLibraryWithoutLosingPlace()
        const created = library?.my_tv_series?.find(series =>
          series.stored_title?.toLocaleLowerCase() === name.trim().toLocaleLowerCase()
          || series.title?.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
        if (!created) throw new Error('The series was created, but could not be reopened')
        openMyTvSeriesSheet(created)
      } catch (error) { showError(error) }
    }
    const myTvSeriesClose = $('#myTvSeriesClose')
    const myTvSeriesSheet = $('#myTvSeriesSheet')
    const dismissContentCardJourney = () => portalSheets.dismissJourney()
    portalSheets.wire(myTvSeriesSheet, {
      closeButton: myTvSeriesClose,
      close: dismissContentCardJourney,
      onClose: () => { selectedMyTvSeries = null },
    })
    const myTvSeriesMoreSheet = $('#myTvSeriesMoreSheet')
    portalSheets.wire(myTvSeriesMoreSheet, {
      closeButton: $('#myTvSeriesMoreClose'),
      close: closeMyTvSeriesMoreSheet,
    })
    const myTvSeasonClose = $('#myTvSeasonClose')
    const myTvSeasonSheet = $('#myTvSeasonSheet')
    portalSheets.wire(myTvSeasonSheet, {
      closeButton: myTvSeasonClose,
      close: dismissContentCardJourney,
      onClose: () => { selectedMyTvSeason = null },
    })
    portalSheets.wire($('#myTvSeasonSettingsSheet'), {
      closeButton: $('#myTvSeasonSettingsClose'),
    })
    const myTvSeriesRestartClose = $('#myTvSeriesRestartClose')
    const myTvSeriesRestartCancel = $('#myTvSeriesRestartCancel')
    if (myTvSeriesRestartCancel) myTvSeriesRestartCancel.onclick = returnFromMyTvSeriesRestartSheet
    const myTvSeriesRestartConfirm = $('#myTvSeriesRestartConfirm')
    if (myTvSeriesRestartConfirm) myTvSeriesRestartConfirm.onclick = confirmMyTvSeriesRestart
    const myTvSeriesRestartSheet = $('#myTvSeriesRestartSheet')
    portalSheets.wire(myTvSeriesRestartSheet, {
      closeButton: myTvSeriesRestartClose,
      close: returnFromMyTvSeriesRestartSheet,
    })
    const myTvSeriesUploadClose = $('#myTvSeriesUploadClose')
    const myTvSeriesUploadSheet = $('#myTvSeriesUploadSheet')
    const closeMyTvSeriesUploadSheet = () => {
      closeLibrarySheet(myTvSeriesUploadSheet)
      myTvSeriesUploadTarget = null
    }
    portalSheets.wire(myTvSeriesUploadSheet, {
      closeButton: myTvSeriesUploadClose,
      close: closeMyTvSeriesUploadSheet,
      cancel: () => closeLibrarySheet(myTvSeriesUploadSheet),
      onClose: () => {
        if (!myTvSeriesSourcePickerOpen) myTvSeriesUploadTarget = null
      },
    })
    const myTvSeriesChooseSource = $('#myTvSeriesChooseSource')
    if (myTvSeriesChooseSource) myTvSeriesChooseSource.onclick = openMyTvSeriesSourceSheet
    const myTvSeriesSourceClose = $('#myTvSeriesSourceClose')
    if (myTvSeriesSourceClose) myTvSeriesSourceClose.onclick = returnToMyTvSeriesUploadSheet
    const myTvSeriesSourceFiles = $('#myTvSeriesSourceFiles')
    if (myTvSeriesSourceFiles) myTvSeriesSourceFiles.onclick = chooseMyTvSeriesFiles
    const myTvSeriesSourceUsb = $('#myTvSeriesSourceUsb')
    if (myTvSeriesSourceUsb) myTvSeriesSourceUsb.onclick = chooseMyTvSeriesUsb
    const myTvSeriesSourceSheet = $('#myTvSeriesSourceSheet')
    portalSheets.wire(myTvSeriesSourceSheet, {
      closeButton: myTvSeriesSourceClose,
      close: returnToMyTvSeriesUploadSheet,
    })
    const myTvEpisodeClose = $('#myTvEpisodeClose')
    const myTvEpisodeSheet = $('#myTvEpisodeSheet')
    portalSheets.wire(myTvEpisodeSheet, {
      closeButton: myTvEpisodeClose,
      close: closeMyTvEpisodeSheet,
      onClose: () => { selectedMyTvEpisode = null },
    })
    const homeFilmSearch = $('#homeFilmSearch')
    const homeFilmSearchClear = $('#homeFilmSearchClear')
    if (homeFilmSearch) homeFilmSearch.oninput = event => { homeSearchText = event.target.value; renderHomeLibrary() }
    if (homeFilmSearchClear) homeFilmSearchClear.onclick = event => { event.preventDefault(); homeSearchText = ''; renderHomeLibrary(); homeFilmSearch.focus() }
    ;[
      [$('#watchChannelSheet'), $('#watchChannelClose'), closeWatchChannelSheet],
      [$('#filmResumeChoiceSheet'), $('#filmResumeChoiceClose'), closeFilmResumeChoiceSheet],
      [$('#watchFilmSheet'), $('#watchFilmClose'), closeWatchFilmSheet,
        () => { selectedWatchFilm = null }],
      [$('#watchProgrammeSheet'), $('#watchProgrammeClose'), closeWatchProgrammeSheet,
        () => { selectedWatchProgramme = null }],
      [$('#watchProgrammeMoreSheet'), $('#watchProgrammeMoreClose'), closeWatchProgrammeMoreSheet],
      [$('#watchProgrammeEpisodeMoreSheet'), $('#watchProgrammeEpisodeMoreClose'),
        closeWatchProgrammeEpisodeMoreSheet],
    ].forEach(([dialog, closeButton, close, onClose]) => portalSheets.wire(dialog, {
      closeButton,
      close: dialog?.hasAttribute('data-card-sheet') ? dismissContentCardJourney : close,
      onClose,
    }))
    $('#watchAddMyTv').onclick = () =>
      openLibrarySheet($('#myTvUploadSheet'), $('#myTvFile'))
    $('#watchManageMyTv').onclick = () => openLibrarySheet($('#myTvCollectionSheet'))
    $('#remoteConcurrentToggle').onclick = () => saveSettingsPreference($('#remoteConcurrentToggle'), 'set-remote-simultaneous', { enabled: library?.remote_viewing?.allow_simultaneous !== true }, 'Simultaneous playback')
