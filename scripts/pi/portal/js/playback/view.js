'use strict'

    function renderRemoteViewing() {
      const remote = library?.remote_viewing || {}; const simultaneous = remote.allow_simultaneous === true
      $('#remoteConcurrentToggle').textContent = simultaneous ? 'On' : 'Off'
      $('#remoteConcurrentState').textContent = simultaneous
        ? 'On · TV and browser can play together' : 'Off · one player at a time'
      $('#remoteConcurrentToggle').setAttribute('aria-pressed', String(simultaneous))
      $('#watchMabelTab').classList.toggle('active', remoteKind === 'channel'); $('#watchMabelTab').setAttribute('aria-selected', String(remoteKind === 'channel'))
      $('#watchAdultTab').classList.toggle('active', remoteKind === 'adult'); $('#watchAdultTab').setAttribute('aria-selected', String(remoteKind === 'adult'))
      $('#watchDownloadsTab').classList.toggle('active', remoteKind === 'downloads'); $('#watchDownloadsTab').setAttribute('aria-selected', String(remoteKind === 'downloads'))
      $('#watchMabelLayout').classList.toggle('hidden', remoteKind !== 'channel'); $('#watchAdultLayout').classList.toggle('hidden', remoteKind !== 'adult')
      $('#watchDownloadsLayout').classList.toggle('hidden', remoteKind !== 'downloads')
      $('#watchLibraryAdmin').classList.toggle('hidden', remoteKind !== 'adult')
      const mabelAdmin = $('#watchMabelAdmin')
      if (mabelAdmin) mabelAdmin.classList.toggle('hidden', remoteKind !== 'channel')
      $('#watchAddAdult').classList.toggle('hidden', remoteKind !== 'adult')
      $('#watchManageAdult').classList.toggle('hidden', remoteKind !== 'adult')
      if (remoteKind === 'downloads') {
        renderDownloads().catch(showError)
        return
      }
      const mabel = $('#remoteMabel'); mabel.innerHTML = ''
      const mabelFilms = mabelFilmEntries()
      renderMabelDiscovery(mabelFilms)
      ;(library?.channels || []).forEach(channel => {
        const programmes = channel.enabled
          ? (channel.programmes || []).filter(programme => programme.enabled)
          : []
        const isFilms = channel.content_type === 'films'
        const section = document.createElement('section'); section.className = `watch-section mabel-channel-section ${isFilms ? 'mabel-film-channel' : 'mabel-show-channel'}`
        section.dataset.watchChannelFolder = String(channel.folder || '')
        const metadata = channel.metadata || {}
        if (!isFilms) {
          const identity = document.createElement('button'); identity.type = 'button'; identity.className = 'mabel-show-identity'
          if (metadata.artwork) identity.style.backgroundImage = `linear-gradient(90deg,rgba(7,12,10,.92) 0%,rgba(7,12,10,.62) 52%,rgba(7,12,10,.2) 100%),url('/api/channel/artwork/${encodeURIComponent(metadata.artwork)}')`
          identity.innerHTML = `<div><span>CH ${channel.number} · ${channel.enabled ? `${programmes.length} episodes` : 'Hidden from TV'}</span><h2>${escapeHtml(metadata.title || channel.name)}</h2><p>${escapeHtml(metadata.overview || `${channel.name} on MabelTV.`)}</p></div>`
          identity.setAttribute('aria-label', `Open channel ${channel.number}, ${channel.name}`)
          identity.onclick = () => openChannel(channel, true)
          section.append(identity)
        } else {
          const artworks = [...new Set((channel.programmes || [])
            .map(programme => programme.metadata?.poster)
            .filter(Boolean))]
          const firstArtwork = artworks.length ? Math.floor(Math.random() * artworks.length) : 0
          const head = document.createElement('button'); head.type = 'button'; head.className = 'watch-section-head mabel-film-head'
          head.innerHTML = `<span class="mabel-film-head-art" aria-hidden="true"><span class="mabel-film-head-art-layer is-visible"></span><span class="mabel-film-head-art-layer"></span></span><span class="mabel-film-head-copy"><span>CH ${channel.number} · Film channel${channel.enabled ? '' : ' · Hidden from TV'}</span><h2>${escapeHtml(channel.name)}</h2></span>`
          if (artworks.length) {
            head.dataset.filmArt = 'true'
            head._mabelFilmArtworks = artworks
            head._mabelFilmArtIndex = firstArtwork
            head._mabelFilmArtLayer = 0
            head.querySelector('.mabel-film-head-art-layer').style.backgroundImage = `url('/api/channel/artwork/${encodeURIComponent(artworks[firstArtwork])}')`
          }
          head.setAttribute('aria-label', `Open channel ${channel.number}, ${channel.name}`); head.onclick = () => openChannel(channel, true); section.append(head)
        }
        if (programmes.length) {
          const rail = document.createElement('div')
          rail.className = `watch-channel-rail${isFilms ? ' watch-film-channel-rail' : ' watch-episode-rail'}`
          rail.setAttribute('aria-label', `${channel.name} ${isFilms ? 'films' : 'episodes'}`)
          programmes.forEach(programme => {
            const card = document.createElement('button'); card.type = 'button'
            const programmeMetadata = programme.metadata || {}
            if (isFilms) {
              const resumable = watchFilmResumable(programme)
              const progressValue = watchFilmProgress(programme)
              card.className = 'watch-card watch-mabel-film-card'
              card.setAttribute('aria-label', `${watchFilmTitle(programme)}${resumable ? `, resume at ${watchTimeLabel(programme.remote_position)}` : ''}`)
              const art = document.createElement('span'); art.className = 'watch-card-art'
              if (programmeMetadata.poster) {
                const image = document.createElement('img')
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
            } else {
              card.className = 'watch-programme watch-mabel-episode'
              const copy = document.createElement('span'); copy.className = 'watch-mabel-copy'
              const title = document.createElement('strong'); title.textContent = programmeMetadata.title || programme.display_name
              const play = document.createElement('small')
              play.textContent = programme.browser_ready === false ? 'TV or VLC · choose where to play' : 'Choose where to watch  ›'
              copy.append(title, play); card.append(copy)
            }
            card.onclick = () => openWatchProgrammeSheet(channel, programme)
            rail.append(card)
          })
          section.append(rail)
          if (!isFilms) addMabelEpisodeRailCue(section, rail)
        } else {
          const empty = document.createElement('p'); empty.className = 'watch-channel-empty'; empty.textContent = channel.enabled ? 'No programmes are currently shown. Open this channel to manage it.' : 'This channel is hidden from the television. Open it to make changes.'; section.append(empty)
        }
        mabel.append(section)
      })
      if (!mabel.children.length) mabel.append(portalEmptyState({
        className: 'watch-empty',
        message: 'No MabelTV channels have been created yet.',
      }))
      startMabelFilmArtCycle()
      renderAdultWatch()
      renderHomeLibrary()
    }

    $('#watchMabelTab').onclick = () => { remoteKind = 'channel'; renderRemoteViewing() }
    $('#watchAdultTab').onclick = () => { remoteKind = 'adult'; renderRemoteViewing() }
    $('#watchDownloadsTab').onclick = () => { remoteKind = 'downloads'; renderRemoteViewing() }
    window.addEventListener('mabeltv-downloads-changed', () => {
      if (remoteKind === 'downloads') renderDownloads().catch(() => {})
    })
    window.addEventListener('offline', () => {
      document.body.classList.add('offline-mode')
      offlineMode = true
      remoteKind = 'downloads'
      openView('watch')
      renderRemoteViewing()
    })
    window.addEventListener('online', () => {
      offlineMode = false
      document.body.classList.remove('offline-mode')
      if (remoteKind === 'downloads') renderDownloads().catch(() => {})
    })
    $('#watchSearch').oninput = event => { watchSearchText = event.target.value; renderAdultWatch() }
    $('#watchSearchClear').onclick = event => { event.preventDefault(); watchSearchText = ''; renderAdultWatch(); $('#watchSearch').focus() }
    $('#watchMabelSearch').oninput = event => { mabelSearchText = event.target.value; renderMabelDiscovery(mabelFilmEntries()) }
    $('#watchMabelSearchClear').onclick = event => { event.preventDefault(); mabelSearchText = ''; renderMabelDiscovery(mabelFilmEntries()); $('#watchMabelSearch').focus() }
    const adultSeriesCreate = $('#adultSeriesCreate')
    if (adultSeriesCreate) adultSeriesCreate.onclick = async () => {
      const name = prompt('Series name:')
      if (!name?.trim()) return
      try {
        await api('/api/manage', { method: 'POST', body: JSON.stringify({
          action: 'create-adult-series', name: name.trim(),
        }) })
        await reloadLibraryWithoutLosingPlace()
        const created = library?.adult_series?.find(series =>
          series.stored_title?.toLocaleLowerCase() === name.trim().toLocaleLowerCase()
          || series.title?.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
        if (!created) throw new Error('The series was created, but could not be reopened')
        openAdultSeriesSheet(created)
        notice(`${created.title} is ready. Start Series 1 when you are ready to add episodes.`)
      } catch (error) { showError(error) }
    }
    const adultSeriesClose = $('#adultSeriesClose')
    const adultSeriesSheet = $('#adultSeriesSheet')
    portalSheets.wire(adultSeriesSheet, {
      closeButton: adultSeriesClose,
      close: closeAdultSeriesSheet,
      onClose: () => { selectedAdultSeries = null },
    })
    const adultSeasonClose = $('#adultSeasonClose')
    const adultSeasonSheet = $('#adultSeasonSheet')
    portalSheets.wire(adultSeasonSheet, {
      closeButton: adultSeasonClose,
      close: returnToAdultSeriesSheet,
      onClose: () => { selectedAdultSeason = null },
    })
    const adultSeriesRestartClose = $('#adultSeriesRestartClose')
    const adultSeriesRestartCancel = $('#adultSeriesRestartCancel')
    if (adultSeriesRestartCancel) adultSeriesRestartCancel.onclick = returnFromAdultSeriesRestartSheet
    const adultSeriesRestartConfirm = $('#adultSeriesRestartConfirm')
    if (adultSeriesRestartConfirm) adultSeriesRestartConfirm.onclick = confirmAdultSeriesRestart
    const adultSeriesRestartSheet = $('#adultSeriesRestartSheet')
    portalSheets.wire(adultSeriesRestartSheet, {
      closeButton: adultSeriesRestartClose,
      close: returnFromAdultSeriesRestartSheet,
    })
    const adultSeriesUploadClose = $('#adultSeriesUploadClose')
    const adultSeriesUploadSheet = $('#adultSeriesUploadSheet')
    const closeAdultSeriesUploadSheet = () => {
      closeLibrarySheet(adultSeriesUploadSheet)
      adultSeriesUploadTarget = null
    }
    portalSheets.wire(adultSeriesUploadSheet, {
      closeButton: adultSeriesUploadClose,
      close: closeAdultSeriesUploadSheet,
      cancel: () => closeLibrarySheet(adultSeriesUploadSheet),
      onClose: () => {
        if (!adultSeriesSourcePickerOpen) adultSeriesUploadTarget = null
      },
    })
    const adultSeriesChooseSource = $('#adultSeriesChooseSource')
    if (adultSeriesChooseSource) adultSeriesChooseSource.onclick = openAdultSeriesSourceSheet
    const adultSeriesSourceClose = $('#adultSeriesSourceClose')
    if (adultSeriesSourceClose) adultSeriesSourceClose.onclick = returnToAdultSeriesUploadSheet
    const adultSeriesSourceFiles = $('#adultSeriesSourceFiles')
    if (adultSeriesSourceFiles) adultSeriesSourceFiles.onclick = chooseAdultSeriesFiles
    const adultSeriesSourceUsb = $('#adultSeriesSourceUsb')
    if (adultSeriesSourceUsb) adultSeriesSourceUsb.onclick = chooseAdultSeriesUsb
    const adultSeriesSourceSheet = $('#adultSeriesSourceSheet')
    portalSheets.wire(adultSeriesSourceSheet, {
      closeButton: adultSeriesSourceClose,
      close: returnToAdultSeriesUploadSheet,
    })
    const adultEpisodeClose = $('#adultEpisodeClose')
    const adultEpisodeSheet = $('#adultEpisodeSheet')
    portalSheets.wire(adultEpisodeSheet, {
      closeButton: adultEpisodeClose,
      close: returnToAdultSeasonSheet,
      onClose: () => { selectedAdultEpisode = null },
    })
    const adultEpisodeMoreClose = $('#adultEpisodeMoreClose')
    const adultEpisodeMoreSheet = $('#adultEpisodeMoreSheet')
    portalSheets.wire(adultEpisodeMoreSheet, {
      closeButton: adultEpisodeMoreClose,
      close: closeAdultEpisodeMoreSheet,
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
      close,
      onClose,
    }))
    $('#watchAddAdult').onclick = () => $('#adultAddFilms').click()
    $('#watchManageAdult').onclick = () => openLibrarySheet($('#adultCollectionSheet'))
    $('#remoteConcurrentToggle').onclick = () => manage('set-remote-simultaneous', { enabled: library?.remote_viewing?.allow_simultaneous !== true })
