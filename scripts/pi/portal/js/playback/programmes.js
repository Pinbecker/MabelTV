'use strict'

    function closeWatchProgrammeSheet(restoreParent = true) {
      const dialog = $('#watchProgrammeSheet')
      portalSheets.close(dialog, { restore: restoreParent })
      selectedWatchProgramme = null
    }

    function closeWatchProgrammeMoreSheet(restoreParent = true) {
      const dialog = $('#watchProgrammeMoreSheet')
      portalSheets.close(dialog, { restore: restoreParent })
    }

    function closeWatchProgrammeEpisodeMoreSheet(restoreParent = true) {
      const dialog = $('#watchProgrammeEpisodeMoreSheet')
      portalSheets.close(dialog, { restore: restoreParent })
    }

    function closeWatchChannelSheet(restoreParent = true) {
      const dialog = $('#watchChannelSheet')
      portalSheets.close(dialog, { restore: restoreParent })
    }

    function openWatchChannelSheet(channel) {
      const programme = (channel.programmes || []).find(value =>
        value.name === channel.resume_file && value.enabled !== false)
        || (channel.programmes || []).find(value => value.enabled !== false)
      const title = channel.metadata?.title || channel.name
      const position = Math.max(0, Number(channel.resume_position) || 0)
      const episodeTitle = channel.resume_title || programme?.display_name || ''
      $('#watchChannelEyebrow').textContent = `CH ${channel.number} · Series channel`
      $('#watchChannelTitle').textContent = title
      $('#watchChannelMeta').textContent = [
        `${channel.programmes.length} episode${channel.programmes.length === 1 ? '' : 's'}`,
        episodeTitle && position > 0
          ? `${episodeTitle} · ${watchTimeLabel(position)} in`
          : episodeTitle,
      ].filter(Boolean).join(' · ')

      const tv = $('#watchChannelTv')
      tv.disabled = !programme || !channel.enabled
      tv.querySelector('strong').textContent = position > 10 ? 'Continue on TV' : 'Play on TV'
      tv.querySelector('small').textContent = !channel.enabled
        ? 'This channel is hidden from the television'
        : position > 10 ? `Continue ${episodeTitle} from ${watchTimeLabel(position)}`
          : episodeTitle ? `Start with ${episodeTitle}` : 'This channel has no available episodes'
      tv.onclick = programme && channel.enabled ? () => {
        closeWatchChannelSheet(false)
        playOnTv({ kind: 'channel', channel: channel.number,
          file: programme.name, position }, title)
      } : null

      const here = $('#watchChannelHere')
      here.disabled = !programme
      const browserReady = programme?.browser_ready !== false
      here.querySelector('strong').textContent = !browserReady
        ? 'Play current episode in VLC'
        : position > 10 ? 'Continue on this device' : 'Play on this device'
      here.querySelector('small').textContent = !programme
        ? 'This channel has no available episodes'
        : !browserReady ? `${episodeTitle} needs VLC on this device`
          : position > 10 ? `Continue ${episodeTitle} from ${watchTimeLabel(position)}`
            : `Start with ${episodeTitle}`
      here.onclick = programme ? () => {
        closeWatchChannelSheet(false)
        const source = { kind: 'channel', channel: channel.number,
          file: programme.name, position }
        if (browserReady) openRemotePlayer(source, position)
        else openInVlc(source, title)
      } : null

      const favourite = $('#watchChannelFavourite')
      favourite.classList.toggle('active', channel.favourite === true)
      favourite.setAttribute('aria-label', channel.favourite
        ? 'Remove channel from favourites' : 'Add channel to favourites')
      favourite.onclick = () => setChannelFavourite(
        channel, channel.favourite !== true).then(() => {
          favourite.classList.toggle('active', channel.favourite === true)
          favourite.setAttribute('aria-label', channel.favourite
            ? 'Remove channel from favourites' : 'Add channel to favourites')
        }).catch(showError)
      $('#watchChannelOpen').onclick = () => {
        closeWatchChannelSheet(false)
        openChannel(channel, false)
      }
      const dialog = $('#watchChannelSheet')
      portalSheets.open(dialog)
    }

    function openWatchProgrammeEpisodeMoreSheet(channel, programme, context, returnTo) {
      const title = programme.metadata?.title || programme.display_name
      $('#watchProgrammeEpisodeMoreEyebrow').textContent = `CH ${channel.number} · ${channel.name}`
      $('#watchProgrammeEpisodeMoreTitle').textContent = title
      $('#watchProgrammeEpisodeMoreMeta').textContent = 'More episode options'
      portalSheets.open($('#watchProgrammeEpisodeMoreSheet'), {
        returnTo: () => openWatchProgrammeSheet(channel, programme, context, returnTo),
      })
    }

    function openWatchProgrammeMoreSheet(channel, programme, context, returnTo) {
      const metadata = programme.metadata || {}
      const title = metadata.title || programme.display_name
      $('#watchProgrammeMoreEyebrow').textContent = `CH ${channel.number} · ${channel.name}`
      $('#watchProgrammeMoreTitle').textContent = title
      $('#watchProgrammeMoreMeta').textContent = [metadata.year, 'More film options'].filter(Boolean).join(' · ')
      portalSheets.open($('#watchProgrammeMoreSheet'), {
        returnTo: () => openWatchProgrammeSheet(channel, programme, context, returnTo),
      })
    }

    function openWatchProgrammeSheet(channel, programme, context = 'library', returnTo = null) {
      selectedWatchProgramme = { channel, programme, context, returnTo }
      const metadata = programme.metadata || {}
      const title = metadata.title || programme.display_name
      const filmChannel = channel.content_type === 'films'
      const resumable = filmChannel && watchFilmResumable(programme)
      const favouriteResumeChoice = context === 'favourite' && resumable
      $('#watchProgrammeEyebrow').textContent = `CH ${channel.number} · ${channel.name}`
      $('#watchProgrammeTitle').textContent = title
      $('#watchProgrammeMeta').textContent = [metadata.year, resumable ? `Resume at ${watchTimeLabel(programme.remote_position)}` : filmChannel ? 'Film' : 'MabelTV programme'].filter(Boolean).join(' · ')
      $('#watchProgrammeTv').querySelector('strong').textContent = favouriteResumeChoice
        ? 'Play on TV' : resumable ? 'Continue on TV' : 'Play on TV'
      $('#watchProgrammeTv').querySelector('small').textContent = favouriteResumeChoice
        ? 'Choose continue or start from beginning'
        : resumable ? `Continue from ${watchTimeLabel(programme.remote_position)}`
          : 'Replaces what is playing there'
      $('#watchProgrammeTv').onclick = favouriteResumeChoice ? () => {
        closeWatchProgrammeSheet(false)
        openFilmResumeChoice({
          title, destination: 'Play on TV', position: programme.remote_position,
          returnTo: () => openWatchProgrammeSheet(channel, programme, context, returnTo),
          continueAction: () => playOnTv({ kind: 'channel', channel: channel.number,
            file: programme.name, position: Number(programme.remote_position || 0) }, title),
          restartAction: () => playOnTv({ kind: 'channel', channel: channel.number,
            file: programme.name, position: 0 }, title),
        })
      } : () => {
        closeWatchProgrammeSheet(false)
        playOnTv({ kind: 'channel', channel: channel.number, file: programme.name,
          position: filmChannel ? Number(programme.remote_position || 0) : undefined }, title)
      }
      const here = $('#watchProgrammeHere')
      here.disabled = false
      here.querySelector('strong').textContent = programme.browser_ready === false
        ? 'Play in VLC' : favouriteResumeChoice ? 'Play on this device'
          : resumable ? 'Continue on this device' : 'Play on this device'
      here.querySelector('small').textContent = programme.browser_ready === false
        ? 'Opens the original without conversion'
        : favouriteResumeChoice ? 'Choose continue or start from beginning'
          : resumable ? `Continue from ${watchTimeLabel(programme.remote_position)}`
            : 'Starts an independent stream'
      const source = { kind: 'channel', channel: channel.number, file: programme.name }
      if (filmChannel) source.position = Number(programme.remote_position || 0)
      here.onclick = favouriteResumeChoice && programme.browser_ready !== false ? () => {
        closeWatchProgrammeSheet(false)
        openFilmResumeChoice({
          title, destination: 'Play on this device', position: programme.remote_position,
          returnTo: () => openWatchProgrammeSheet(channel, programme, context, returnTo),
          continueAction: () => openRemotePlayer({ kind: 'channel',
            channel: channel.number, file: programme.name,
            position: Number(programme.remote_position || 0) }, Number(programme.remote_position || 0)),
          restartAction: () => openRemotePlayer({ kind: 'channel',
            channel: channel.number, file: programme.name, position: 0 }, 0),
        })
      } : () => {
        closeWatchProgrammeSheet(false)
        if (programme.browser_ready === false) openInVlc(source, title)
        else openRemotePlayer(source, filmChannel ? Number(programme.remote_position || 0) : 0)
      }
      $('#watchProgrammeDownload').onclick = () => {
        closeWatchProgrammeMoreSheet(false)
        downloadToDevice(source, title)
      }
      const filmTools = $('#watchProgrammeFilmTools')
      filmTools.classList.toggle('hidden', !filmChannel)
      const viewingActions = $('#watchProgrammeViewingActions')
      if (filmChannel && currentPortalDesign === 'experience'
          && typeof wireLocalFilmViewingActions === 'function') {
        void wireLocalFilmViewingActions(viewingActions, programme).catch(showError)
      } else viewingActions.classList.add('hidden')

      const episodeTools = $('#watchProgrammeEpisodeTools')
      episodeTools.classList.toggle('hidden', filmChannel)
      const progressNote = $('#watchProgrammeSheet .watch-programme-note')
      progressNote.classList.toggle('hidden', !filmChannel)
      if (!filmChannel) {
        $('#watchProgrammeEpisodeMore').onclick = () => {
          const parentReturn = selectedWatchProgramme?.returnTo || returnTo
          closeWatchProgrammeSheet(false)
          openWatchProgrammeEpisodeMoreSheet(channel, programme, context, parentReturn)
        }
        $('#watchProgrammeEpisodeDownload').onclick = () => {
          closeWatchProgrammeEpisodeMoreSheet(false)
          downloadToDevice(source, title)
        }
        const toggleButton = $('#watchProgrammeEpisodeToggle')
        toggleButton.querySelector('strong').textContent = programme.enabled ? 'Hide from TV' : 'Show on TV'
        toggleButton.querySelector('small').textContent = programme.enabled
          ? 'Keep the episode without showing it on this channel'
          : 'Put this episode back on its channel'
        toggleButton.onclick = () => {
          closeWatchProgrammeEpisodeMoreSheet(false)
          manage('toggle-programme', { channel: channel.number, file: programme.name })
        }
        $('#watchProgrammeEpisodeRename').onclick = () => {
          closeWatchProgrammeEpisodeMoreSheet(false)
          renameProgramme(channel, programme)
        }
        $('#watchProgrammeEpisodeBin').onclick = () => {
          closeWatchProgrammeEpisodeMoreSheet(false)
          if (confirm(`Move “${title}” to the recycle bin?`)) {
            manage('trash', { channel: channel.number, file: programme.name })
          }
        }
      }

      const moreButton = $('#watchProgrammeMore')
      moreButton.onclick = filmChannel ? () => {
        const parentReturn = selectedWatchProgramme?.returnTo || returnTo
        closeWatchProgrammeSheet(false)
        openWatchProgrammeMoreSheet(channel, programme, context, parentReturn)
      } : null

      const metadataButton = $('#watchProgrammeMetadata')
      metadataButton.disabled = !tmdbConfigured
      metadataButton.onclick = filmChannel && tmdbConfigured ? () => {
        closeWatchProgrammeMoreSheet(false)
        scanProgrammeTmdb(channel, programme, () =>
          openWatchProgrammeMoreSheet(channel, programme, context, returnTo))
      } : null

      const favouriteButton = $('#watchProgrammeFavourite')
      favouriteButton.classList.toggle('hidden', !filmChannel)
      favouriteButton.classList.toggle('active', programme.favourite === true)
      favouriteButton.setAttribute('aria-label', programme.favourite
        ? 'Remove film from favourites' : 'Add film to favourites')
      favouriteButton.onclick = filmChannel ? () => setFilmFavourite(
        { kind: 'channel', channel, film: programme }, programme.favourite !== true
      ).then(() => {
        favouriteButton.classList.toggle('active', programme.favourite === true)
        favouriteButton.setAttribute('aria-label', programme.favourite
          ? 'Remove film from favourites' : 'Add film to favourites')
      }).catch(showError) : null

      const toggleButton = $('#watchProgrammeToggle')
      toggleButton.querySelector('strong').textContent = programme.enabled ? 'Hide from TV' : 'Show on TV'
      toggleButton.querySelector('small').textContent = programme.enabled
        ? 'Keep the film without showing it on this channel'
        : 'Return the film to this TV channel'
      toggleButton.onclick = filmChannel ? () => {
        closeWatchProgrammeMoreSheet(false)
        manage('toggle-programme', { channel: channel.number, file: programme.name })
      } : null

      const renameButton = $('#watchProgrammeRename')
      renameButton.onclick = filmChannel ? () => {
        closeWatchProgrammeMoreSheet(false)
        renameProgramme(channel, programme)
      } : null

      const binButton = $('#watchProgrammeBin')
      binButton.onclick = filmChannel ? () => {
        closeWatchProgrammeMoreSheet(false)
        if (confirm(`Move “${title}” to the recycle bin?`)) {
          manage('trash', { channel: channel.number, file: programme.name })
        }
      } : null

      const moveButton = $('#watchProgrammeMove')
      const otherFilmChannels = (library?.channels || [])
        .filter(value => value.content_type === 'films' && Number(value.number) !== Number(channel.number))
        .sort((left, right) => Number(left.number) - Number(right.number))
      if (filmChannel && otherFilmChannels.length) {
        moveButton.disabled = false
        moveButton.querySelector('small').textContent = otherFilmChannels.length === 1
          ? `Move to CH ${otherFilmChannels[0].number} · ${otherFilmChannels[0].name}`
          : `Choose from ${otherFilmChannels.length} other film channels`
        moveButton.onclick = () => {
          closeWatchProgrammeMoreSheet(false)
          $('#watchProgrammeMoveTitle').textContent = `Move “${title}”`
          const options = $('#watchProgrammeChannelOptions')
          options.innerHTML = ''
          otherFilmChannels.forEach(value => {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'watch-film-play'
            button.setAttribute('aria-label', `Move ${title} to CH ${value.number}, ${value.name}`)
            const icon = document.createElement('span')
            icon.className = 'watch-action-icon'
            icon.textContent = String(value.number)
            const copy = document.createElement('span')
            const heading = document.createElement('strong')
            heading.textContent = `CH ${value.number} · ${value.name}`
            const hint = document.createElement('small')
            hint.textContent = 'Move this film here'
            copy.append(heading, hint)
            button.append(icon, copy)
            button.onclick = () => {
              closeLibrarySheet($('#watchProgrammeMoveSheet'), false)
              manage('move-programme', {
                channel: channel.number,
                file: programme.name,
                target_channel: value.number
              }, value.number)
            }
            options.append(button)
          })
          openLibrarySheet($('#watchProgrammeMoveSheet'), null, () =>
            openWatchProgrammeMoreSheet(channel, programme, context, returnTo))
        }
      } else {
        moveButton.disabled = true
        moveButton.querySelector('small').textContent = 'Create another film channel to move this film'
        moveButton.onclick = null
      }
      const dialog = $('#watchProgrammeSheet')
      portalSheets.open(dialog, { returnTo })
    }
