'use strict'

    function watchFilmTitle(film) {
      return film?.metadata?.title || film?.display_name || 'Untitled film'
    }

    function watchFilmResumable(film) {
      const position = Number(film?.remote_position || 0)
      const duration = Number(film?.remote_duration || 0)
      if (position < 30) return false
      if (!duration) return true
      const completionWindow = Math.min(Math.max(180, duration * .05), duration * .2)
      return position < duration - completionWindow
    }

    async function clearWatchFilmProgress(film, playAfter = false, actionOverride = null) {
      const source = { kind: 'adult', file: film.path }
      const action = actionOverride
      const actionLabel = action?.querySelector('strong') || action?.querySelector('span:last-child')
      const originalLabel = actionLabel?.textContent || ''
      if (action) {
        action.disabled = true
        action.setAttribute('aria-busy', 'true')
      }
      if (actionLabel) actionLabel.textContent = playAfter ? 'Starting from beginning…' : 'Removing…'
      try {
        await api('/api/remote/clear-position', {
          method: 'POST', body: JSON.stringify(source),
        })
        film.remote_position = 0
        film.remote_last_watched = 0
        const storedFilm = (library?.adult_library || []).find(item => item.path === film.path)
        if (storedFilm) {
          storedFilm.remote_position = 0
          storedFilm.remote_last_watched = 0
        }
        const startFilm = { ...film }
        if (playAfter) {
          playWatchFilm(startFilm, 0)
          return
        }
        closeWatchFilmSheet()
        renderAdultWatch()
        renderHomeLibrary()
        notice(`${watchFilmTitle(film)} was removed from Continue Watching.`)
      } finally {
        if (action) {
          action.disabled = false
          action.removeAttribute('aria-busy')
        }
        if (actionLabel) actionLabel.textContent = originalLabel
      }
    }

    function watchTimeLabel(value) {
      const seconds = Math.max(0, Math.floor(Number(value) || 0))
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      if (hours) return `${hours}h ${minutes}m`
      return `${Math.max(1, minutes)}m`
    }

    function filmSortTitle(value) {
      return watchFilmTitle(value).replace(/^the\s+/i, '').trim()
    }

    function adultFilmEntry(film) {
      return { kind: 'adult', film }
    }

    function mabelFilmEntries() {
      return (library?.channels || [])
        .filter(channel => channel.content_type === 'films')
        .flatMap(channel => (channel.programmes || []).map(film => ({
          kind: 'channel', channel, film,
        })))
    }

    function allFilmEntries() {
      return [
        ...(library?.adult_library || []).map(adultFilmEntry),
        ...mabelFilmEntries(),
      ].sort((left, right) => filmSortTitle(left.film).localeCompare(
        filmSortTitle(right.film), undefined, { sensitivity: 'base' }))
    }

    function favouriteSeriesChannels() {
      return (library?.channels || [])
        .filter(channel => channel.content_type !== 'films' && channel.favourite === true)
        .sort((left, right) => left.name.localeCompare(
          right.name, undefined, { sensitivity: 'base' }))
    }

    function favouriteAdultSeries() {
      return (library?.adult_series || [])
        .filter(series => series.favourite === true)
        .sort((left, right) => left.title.localeCompare(
          right.title, undefined, { sensitivity: 'base' }))
    }

    function filmEntryPoster(entry) {
      const film = entry.film
      const metadata = film.metadata || {}
      const fallback = watchFilmTitle(film).slice(0, 1).toUpperCase()
      if (entry.kind === 'adult') return filmPoster(film)
      if (metadata.poster) {
        const image = document.createElement('img')
        image.src = `/api/channel/artwork/${encodeURIComponent(metadata.poster)}`
        image.alt = ''
        image.loading = 'lazy'
        image.decoding = 'async'
        return image
      }
      const placeholder = document.createElement('span')
      placeholder.className = 'watch-card-placeholder'
      placeholder.textContent = fallback
      return placeholder
    }

    function filmEntrySourceLabel(entry) {
      return entry.kind === 'adult' ? 'Adult TV' : entry.channel.name
    }

    function filmEntrySearchText(entry) {
      const film = entry.film
      const metadata = film.metadata || {}
      return [watchFilmTitle(film), film.display_name, metadata.year,
        filmEntrySourceLabel(entry)].filter(Boolean).join(' ').toLocaleLowerCase()
    }

    function openFilmEntry(entry, context = 'library') {
      if (entry.kind === 'adult') openWatchFilmSheet(entry.film, context)
      else openWatchProgrammeSheet(entry.channel, entry.film, context)
    }

    function closeFilmResumeChoiceSheet(restoreParent = true) {
      const dialog = $('#filmResumeChoiceSheet')
      portalSheets.close(dialog, { restore: restoreParent })
    }

    function openFilmResumeChoice({ title, destination, position,
      continueAction, restartAction, returnTo = null }) {
      $('#filmResumeChoiceEyebrow').textContent = destination
      $('#filmResumeChoiceTitle').textContent = title
      $('#filmResumeChoiceMeta').textContent = `Continue from ${watchTimeLabel(position)}, or start this film from the beginning?`
      $('#filmResumeContinue').querySelector('small').textContent = `Resume from ${watchTimeLabel(position)}`
      $('#filmResumeContinue').onclick = () => {
        closeFilmResumeChoiceSheet(false)
        continueAction()
      }
      $('#filmResumeRestart').onclick = () => {
        closeFilmResumeChoiceSheet(false)
        restartAction()
      }
      const dialog = $('#filmResumeChoiceSheet')
      portalSheets.open(dialog, { returnTo })
    }

    function watchFilmProgress(film) {
      const position = Number(film?.remote_position || 0)
      const duration = Number(film?.remote_duration || 0)
      return duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0
    }

    function filmPoster(film) {
      const metadata = film.metadata || {}
      const fallback = watchFilmTitle(film).slice(0, 1).toUpperCase()
      if (metadata.poster) return posterImage(metadata.poster, fallback)
      const placeholder = document.createElement('span')
      placeholder.className = 'watch-card-placeholder'
      placeholder.textContent = fallback
      return placeholder
    }

    function adultWatchCard(film) {
      const metadata = film.metadata || {}
      const resumable = watchFilmResumable(film)
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'watch-card'
      card.dataset.adultPath = film.path
      card.setAttribute('aria-label', `${watchFilmTitle(film)}${resumable ? `, resume at ${watchTimeLabel(film.remote_position)}` : ''}`)
      const art = document.createElement('span')
      art.className = 'watch-card-art'
      art.append(filmPoster(film))
      art.append(adultOptimisationBadge(film))
      if (film.browser_ready === false) {
        const format = document.createElement('span')
        format.className = 'watch-format'
        format.textContent = 'VLC READY'
        art.append(format)
      }
      const progressValue = watchFilmProgress(film)
      if (resumable && progressValue) {
        const progress = document.createElement('span')
        progress.className = 'watch-progress'
        const fill = document.createElement('span')
        fill.style.width = `${progressValue}%`
        progress.append(fill)
        art.append(progress)
      }
      const copy = document.createElement('span')
      copy.className = 'watch-card-copy'
      const title = document.createElement('strong')
      title.textContent = watchFilmTitle(film)
      const detail = document.createElement('small')
      detail.textContent = resumable ? `Resume · ${watchTimeLabel(film.remote_position)}` : [metadata.year, film.folder].filter(Boolean).join(' · ') || 'Film'
      copy.append(title, detail)
      card.append(art, copy)
      card.onclick = () => openWatchFilmSheet(film)
      return card
    }

    function continueWatchCard(value) {
      if (value?.kind === 'adult-series') return adultSeriesContinueCard(value)
      const entry = value?.film ? value : adultFilmEntry(value)
      const film = entry.film
      const item = document.createElement('div')
      item.className = 'watch-continue-item'
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'watch-continue-card'
      card.setAttribute('aria-label', `Resume ${watchFilmTitle(film)} at ${watchTimeLabel(film.remote_position)}`)
      const art = document.createElement('span')
      art.className = 'watch-continue-art'
      art.style.setProperty('--watch-progress', `${watchFilmProgress(film)}%`)
      art.append(filmEntryPoster(entry))
      if (entry.kind === 'adult') {
        card.dataset.adultPath = film.path
        art.append(adultOptimisationBadge(film))
      }
      const copy = document.createElement('span')
      copy.className = 'watch-continue-copy'
      const label = document.createElement('small')
      label.textContent = 'Continue'
      const title = document.createElement('strong')
      title.textContent = watchFilmTitle(film)
      const time = document.createElement('span')
      time.textContent = `${watchTimeLabel(film.remote_position)} watched`
      const play = document.createElement('i')
      play.textContent = '▶'
      copy.append(label, title, time, play)
      card.append(art, copy)
      card.onclick = () => openFilmEntry(entry, 'continue')
      item.append(card)
      return item
    }

    function adultSeriesContinueEntries() {
      return (library?.adult_series || []).map(series => {
        const episode = (series.episodes || [])
          .filter(value => value.watched !== true && watchFilmResumable(value))
          .sort((left, right) => Number(right.remote_last_watched || 0)
            - Number(left.remote_last_watched || 0))[0]
        return episode ? {
          kind: 'adult-series', series, episode,
          lastWatched: Number(episode.remote_last_watched || 0),
        } : null
      }).filter(Boolean)
    }

    function adultSeriesContinueCard(entry) {
      const { series, episode } = entry
      const item = document.createElement('div')
      item.className = 'watch-continue-item'
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'watch-continue-card'
      card.setAttribute('aria-label', `Resume ${series.title}, ${episode.display_name} at ${watchTimeLabel(episode.remote_position)}`)
      const art = document.createElement('span')
      art.className = 'watch-continue-art'
      art.style.setProperty('--watch-progress', `${watchFilmProgress(episode)}%`)
      const artworkName = episode.still || series.metadata?.poster
      if (artworkName) {
        const image = document.createElement('img')
        image.src = `/api/adult/series/artwork/${encodeURIComponent(artworkName)}`
        image.alt = ''
        image.loading = 'lazy'
        art.append(image)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = series.title.slice(0, 1).toUpperCase()
        art.append(placeholder)
      }
      const copy = document.createElement('span')
      copy.className = 'watch-continue-copy'
      const label = document.createElement('small')
      label.textContent = `Continue · ${series.title}`
      const title = document.createElement('strong')
      title.textContent = episode.display_name
      const time = document.createElement('span')
      time.textContent = `${watchTimeLabel(episode.remote_position)} watched`
      const play = document.createElement('i')
      play.textContent = '▶'
      copy.append(label, title, time, play)
      card.append(art, copy)
      // Continue Watching is a direct launch surface, not a drill-down into
      // series management. Its close action must return to Adult TV.
      card.onclick = () => openAdultEpisodeSheet(series, episode)
      item.append(card)
      return item
    }

    function homePosterTile(entry, context = 'library') {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'home-poster-card'
      card.setAttribute('aria-label', `Open ${watchFilmTitle(entry.film)} from ${filmEntrySourceLabel(entry)}`)
      const art = document.createElement('span')
      art.className = 'home-poster-art'
      art.append(filmEntryPoster(entry))
      if (entry.film.favourite) {
        const favourite = document.createElement('span')
        favourite.className = 'home-favourite-mark'
        favourite.textContent = '♥'
        art.append(favourite)
      }
      const copy = document.createElement('span')
      copy.className = 'home-poster-copy'
      const title = document.createElement('strong')
      title.textContent = watchFilmTitle(entry.film)
      const source = document.createElement('small')
      source.textContent = filmEntrySourceLabel(entry)
      copy.append(title, source)
      card.append(art, copy)
      card.onclick = () => openFilmEntry(entry, context)
      return card
    }

    function homeChannelTile(channel) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'home-poster-card home-channel-card'
      card.setAttribute('aria-label', `Open favourite channel ${channel.name}`)
      const art = document.createElement('span')
      art.className = 'home-poster-art home-channel-art'
      if (channel.metadata?.artwork) {
        const image = document.createElement('img')
        image.src = `/api/channel/artwork/${encodeURIComponent(channel.metadata.artwork)}`
        image.alt = ''
        image.loading = 'lazy'
        image.decoding = 'async'
        art.append(image)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = channel.name.slice(0, 1).toUpperCase()
        art.append(placeholder)
      }
      const favourite = document.createElement('span')
      favourite.className = 'home-favourite-mark'
      favourite.textContent = '♥'
      art.append(favourite)
      const badge = document.createElement('span')
      badge.className = 'home-channel-mark'
      badge.textContent = `CH ${channel.number}`
      art.append(badge)
      const copy = document.createElement('span')
      copy.className = 'home-poster-copy'
      const title = document.createElement('strong')
      title.textContent = channel.metadata?.title || channel.name
      const source = document.createElement('small')
      source.textContent = 'Series channel'
      copy.append(title, source)
      card.append(art, copy)
      card.onclick = () => openWatchChannelSheet(channel)
      return card
    }

    function homeAdultSeriesTile(series) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'home-poster-card home-channel-card'
      card.setAttribute('aria-label', `Open favourite series ${series.title}`)
      const art = document.createElement('span')
      art.className = 'home-poster-art home-channel-art'
      art.append(adultSeriesArtwork(series))
      const favourite = document.createElement('span')
      favourite.className = 'home-favourite-mark'
      favourite.textContent = '♥'
      art.append(favourite)
      const copy = document.createElement('span')
      copy.className = 'home-poster-copy'
      const title = document.createElement('strong')
      title.textContent = series.title
      const source = document.createElement('small')
      source.textContent = 'Adult TV series'
      copy.append(title, source)
      card.append(art, copy)
      card.onclick = () => openAdultSeriesViewing(series)
      return card
    }

    function openAdultSeriesViewing(series) {
      const tmdbId = Number(series?.metadata?.tmdb_id || 0)
      if (!tmdbId || typeof openAdultTitle !== 'function') {
        openAdultSeriesSheet(series)
        return
      }
      openAdultTitle({
        media_type: 'tv', tmdb_id: tmdbId,
        title: series.metadata?.title || series.title,
        year: series.metadata?.year || '',
        overview: series.metadata?.overview || '',
        on_mabeltv: true,
      })
    }

    function renderHomeLibrary() {
      const search = $('#homeFilmSearch')
      if (!search) return
      const entries = allFilmEntries()
      const query = homeSearchText.trim().toLocaleLowerCase()
      search.value = homeSearchText
      $('#homeFilmSearchClear').classList.toggle('hidden', !homeSearchText)

      const results = query
        ? entries.filter(entry => filmEntrySearchText(entry).includes(query)).slice(0, 18)
        : []
      $('#homeSearchSection').classList.toggle('hidden', !query)
      $('#homeSearchCount').textContent = query ? `${results.length} found` : ''
      const searchRail = $('#homeSearchRail')
      searchRail.innerHTML = ''
      results.forEach(entry => searchRail.append(homePosterTile(entry)))
      if (query && !results.length) {
        const empty = document.createElement('p')
        empty.className = 'home-media-empty'
        empty.textContent = 'No films match that search.'
        searchRail.append(empty)
      }

      const favouriteFilms = entries.filter(entry => entry.film.favourite)
      const favouriteChannels = favouriteSeriesChannels()
      const favouriteSeries = favouriteAdultSeries()
      const favourites = [
        ...favouriteFilms.map(entry => ({ type: 'film', entry,
          title: watchFilmTitle(entry.film) })),
        ...favouriteChannels.map(channel => ({ type: 'channel', channel,
          title: channel.metadata?.title || channel.name })),
        ...favouriteSeries.map(series => ({ type: 'adult-series', series,
          title: series.title })),
      ].sort((left, right) => left.title.localeCompare(
        right.title, undefined, { sensitivity: 'base' }))
      $('#homeFavouritesCount').textContent = favourites.length
        ? `${favourites.length} item${favourites.length === 1 ? '' : 's'}` : ''
      const favouriteRail = $('#homeFavouritesRail')
      favouriteRail.innerHTML = ''
      favourites.forEach(value => favouriteRail.append(value.type === 'film'
        ? homePosterTile(value.entry, 'favourite')
        : value.type === 'adult-series' ? homeAdultSeriesTile(value.series)
          : homeChannelTile(value.channel)))
      $('#homeFavouritesEmpty').classList.toggle('hidden', Boolean(favourites.length))

      const continuing = entries
        .filter(entry => watchFilmResumable(entry.film))
        .sort((left, right) => Number(right.film.remote_last_watched || 0)
          - Number(left.film.remote_last_watched || 0))
        .slice(0, 10)
      $('#homeContinueSection').classList.toggle('hidden', !continuing.length)
      $('#homeContinueCount').textContent = continuing.length
        ? `${continuing.length} in progress` : ''
      const continueRail = $('#homeContinueRail')
      continueRail.innerHTML = ''
      continuing.forEach(entry => continueRail.append(continueWatchCard(entry)))
    }

    async function setFilmFavourite(entry, enabled) {
      const payload = entry.kind === 'adult'
        ? { kind: 'adult', file: entry.film.path, enabled }
        : { kind: 'channel', channel: entry.channel.number,
            file: entry.film.name, enabled }
      await api('/api/favourite', { method: 'POST', body: JSON.stringify(payload) })
      entry.film.favourite = enabled
      renderHomeLibrary()
      renderAdultWatch()
      notice(enabled ? `${watchFilmTitle(entry.film)} was added to Favourites.`
        : `${watchFilmTitle(entry.film)} was removed from Favourites.`)
    }

    async function setChannelFavourite(channel, enabled) {
      await api('/api/favourite', {
        method: 'POST', body: JSON.stringify({
          kind: 'series-channel', channel: channel.number, enabled,
        }),
      })
      channel.favourite = enabled
      renderHomeLibrary()
      notice(enabled ? `${channel.name} was added to Favourites.`
        : `${channel.name} was removed from Favourites.`)
    }

    async function setAdultSeriesFavourite(series, enabled) {
      await api('/api/favourite', { method: 'POST', body: JSON.stringify({
        kind: 'adult-series', series: series.id, enabled,
      }) })
      series.favourite = enabled
      renderHomeLibrary()
      renderAdultSeries(adultSearchText)
      notice(enabled ? `${series.title} was added to Favourites.`
        : `${series.title} was removed from Favourites.`)
    }

    function closeWatchFilmSheet(restoreParent = true) {
      const dialog = $('#watchFilmSheet')
      portalSheets.close(dialog, { restore: restoreParent })
      selectedWatchFilm = null
    }

    function playWatchFilm(film, position) {
      closeWatchFilmSheet(false)
      openRemotePlayer({ kind: 'adult', file: film.path }, position)
    }

    function playWatchFilmOnTv(film, position = null) {
      closeWatchFilmSheet(false)
      playOnTv({
        kind: 'adult',
        file: film.path,
        position: position === null
          ? Number(film.remote_position || 0) : Math.max(0, Number(position) || 0),
      }, watchFilmTitle(film))
    }

    function openWatchFilmSheet(film, context = 'library', returnTo = null) {
      selectedWatchFilm = film
      const metadata = film.metadata || {}
      const title = watchFilmTitle(film)
      const resumable = watchFilmResumable(film)
      const streamable = film.browser_ready !== false
      const progress = watchFilmProgress(film)
      const poster = metadata.poster ? artworkUrl(metadata.poster) : ''
      $('#watchFilmBackdrop').style.setProperty('--watch-film-art', poster ? `url("${poster}")` : 'linear-gradient(135deg,#2e3a34,#101513)')
      const posterRoot = $('#watchFilmPoster')
      posterRoot.replaceChildren(filmPoster(film))
      $('#watchFilmEyebrow').textContent = resumable ? 'Continue watching' : streamable ? 'Ready to watch' : 'VLC playback available'
      $('#watchFilmTitle').textContent = title
      const metaRoot = $('#watchFilmMeta')
      metaRoot.innerHTML = ''
      ;[metadata.year, film.folder || 'Adult library', Number(film.remote_duration || 0) > 0 ? watchTimeLabel(film.remote_duration) : 'Film'].filter(Boolean).forEach(value => {
        const span = document.createElement('span')
        span.textContent = value
        metaRoot.append(span)
      })
      $('#watchFilmOverview').textContent = metadata.overview || 'A film from your private MabelTV library.'
      const progressRoot = $('#watchFilmProgress')
      progressRoot.classList.toggle('hidden', !resumable)
      $('#watchFilmProgressLabel').textContent = resumable ? `${Math.round(progress)}% · ${watchTimeLabel(film.remote_position)} watched` : ''
      $('#watchFilmProgressFill').style.width = `${progress}%`
      const availability = $('#watchFilmAvailability')
      availability.classList.toggle('hidden', streamable)
      availability.textContent = streamable ? '' : 'This original can open directly in VLC. Downloading prepares a separate browser-compatible copy for offline MabelTV playback.'
      const favouriteResumeChoice = context === 'favourite' && resumable
      const tvPlay = $('#watchFilmTv')
      tvPlay.querySelector('strong').textContent = favouriteResumeChoice
        ? 'Play on TV' : resumable ? 'Continue on TV' : 'Play on TV'
      tvPlay.querySelector('small').textContent = favouriteResumeChoice
        ? 'Choose continue or start from beginning'
        : resumable ? `Continue from ${watchTimeLabel(film.remote_position)}`
          : 'Replaces what is playing there'
      tvPlay.onclick = favouriteResumeChoice ? () => {
        closeWatchFilmSheet(false)
        openFilmResumeChoice({
          title, destination: 'Play on TV', position: film.remote_position,
          returnTo: () => openWatchFilmSheet(film, context, returnTo),
          continueAction: () => playWatchFilmOnTv(film),
          restartAction: () => playWatchFilmOnTv(film, 0),
        })
      } : () => playWatchFilmOnTv(film)
      const herePlay = $('#watchFilmHere')
      herePlay.disabled = false
      herePlay.querySelector('strong').textContent = streamable
        ? favouriteResumeChoice ? 'Play on this device'
          : resumable ? 'Continue on this device' : 'Play on this device'
        : 'Play in VLC'
      herePlay.querySelector('small').textContent = streamable
        ? favouriteResumeChoice ? 'Choose continue or start from beginning'
          : resumable ? `Continue from ${watchTimeLabel(film.remote_position)}`
            : 'Starts an independent stream'
        : 'Opens the original without conversion'
      herePlay.onclick = streamable ? favouriteResumeChoice ? () => {
        closeWatchFilmSheet(false)
        openFilmResumeChoice({
          title, destination: 'Play on this device', position: film.remote_position,
          returnTo: () => openWatchFilmSheet(film, context, returnTo),
          continueAction: () => playWatchFilm(film, Number(film.remote_position || 0)),
          restartAction: () => playWatchFilm(film, 0),
        })
      } : () => playWatchFilm(film, resumable ? Number(film.remote_position || 0) : 0)
        : () => { closeWatchFilmSheet(false); openInVlc({ kind: 'adult', file: film.path }, title) }
      const favouriteButton = $('#watchFilmFavourite')
      favouriteButton.classList.toggle('active', film.favourite === true)
      favouriteButton.setAttribute('aria-label', film.favourite
        ? 'Remove film from favourites' : 'Add film to favourites')
      favouriteButton.onclick = () => setFilmFavourite(
        adultFilmEntry(film), film.favourite !== true).then(() => {
          favouriteButton.classList.toggle('active', film.favourite === true)
          favouriteButton.setAttribute('aria-label', film.favourite
            ? 'Remove film from favourites' : 'Add film to favourites')
        }).catch(showError)
      const manageFilm = $('#watchFilmManage')
      const managementAvailable = currentPortalDesign === 'experience'
      manageFilm.classList.toggle('hidden', !managementAvailable)
      manageFilm.onclick = managementAvailable ? () => {
        closeWatchFilmSheet(false)
        openAdultFilmSheet(film, () => openWatchFilmSheet(film, context, returnTo))
      } : null
      const dialog = $('#watchFilmSheet')
      portalSheets.open(dialog, { returnTo })
    }

