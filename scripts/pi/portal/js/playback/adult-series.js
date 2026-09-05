'use strict'

    function adultSeriesArtwork(series, className = 'adult-series-card-art') {
      const art = document.createElement('span')
      art.className = className
      const name = series.metadata?.poster
      if (name) {
        const image = document.createElement('img')
        image.src = `/api/adult/series/artwork/${encodeURIComponent(name)}`
        image.alt = ''
        image.loading = 'lazy'
        art.append(image)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = series.title.slice(0, 1).toUpperCase()
        art.append(placeholder)
      }
      return art
    }

    function adultSeasonArtwork(series, episodes, className = 'adult-season-card-art') {
      const art = document.createElement('span')
      art.className = className
      const still = (episodes || []).find(episode => episode.still)?.still
      const name = still || series.metadata?.poster
      if (name) {
        const image = document.createElement('img')
        image.src = `/api/adult/series/artwork/${encodeURIComponent(name)}`
        image.alt = ''
        image.loading = 'lazy'
        art.append(image)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = String((episodes || [])[0]?.season || 1)
        art.append(placeholder)
      }
      return art
    }

    function openAdultSeriesUpload(series, season, isNew = false) {
      const number = Number(season)
      const seasonParent = selectedAdultSeason?.returnTo || null
      const seriesParent = selectedAdultSeries?.returnTo || null
      const returnTo = selectedAdultSeason
        ? () => openAdultSeasonSheet(series, number, seasonParent)
        : () => openAdultSeriesSheet(series, seriesParent)
      const seasonReturnTo = selectedAdultSeason
        ? seasonParent
        : () => openAdultSeriesSheet(series, seriesParent)
      adultSeriesUploadTarget = {
        id: series.id, title: series.title, season: number, isNew, returnTo,
        successReturn: () => openAdultSeasonSheet(series, number, seasonReturnTo),
      }
      $('#adultSeriesUploadEyebrow').textContent = `${series.title} · Series ${number}`
      $('#adultSeriesUploadTitle').textContent = isNew
        ? `Start Series ${number}` : `Add episodes to Series ${number}`
      $('#adultSeriesUploadDescription').textContent = isNew
        ? 'Choose the first episodes for this new series.'
        : 'Every selected episode will be added to this series.'
      $('#adultSeriesUploadDestination').textContent = `${series.title} · Series ${number}`
      $('#adultSeriesUploadDestinationMeta').textContent = isNew
        ? 'This series will appear as soon as its first episode is added.'
        : 'Existing episodes stay exactly where they are.'
      selectedAdultSeriesFiles = []
      renderSelectedAdultSeriesFiles()
      closeAdultSeasonSheet(false)
      closeAdultSeriesSheet(false)
      openLibrarySheet($('#adultSeriesUploadSheet'), $('#adultSeriesFile'), returnTo)
    }

    function openAdultSeriesSourceSheet() {
      const upload = $('#adultSeriesUploadSheet')
      const source = $('#adultSeriesSourceSheet')
      if (!upload || !source || !adultSeriesUploadTarget) return
      adultSeriesSourcePickerOpen = true
      closeLibrarySheet(upload, false)
      portalSheets.open(source, {
        returnTo: () => openLibrarySheet(upload, null, adultSeriesUploadTarget?.returnTo),
      })
    }

    function returnToAdultSeriesUploadSheet() {
      const source = $('#adultSeriesSourceSheet')
      portalSheets.close(source)
      adultSeriesSourcePickerOpen = false
    }

    function chooseAdultSeriesFiles() {
      const source = $('#adultSeriesSourceSheet')
      portalSheets.close(source)
      adultSeriesSourcePickerOpen = false
      if (!adultSeriesUploadTarget) return
      setTimeout(() => $('#adultSeriesFile')?.click(), 80)
    }

    function chooseAdultSeriesUsb() {
      const target = adultSeriesUploadTarget
      const source = $('#adultSeriesSourceSheet')
      portalSheets.dismiss(source)
      adultSeriesSourcePickerOpen = false
      adultSeriesUploadTarget = null
      if (!target) return
      $('#usbTarget').value = 'series'
      $('#usbSeriesName').value = target.title
      $('#usbTarget').dispatchEvent(new Event('change'))
      openView('usb')
      refreshUsb().catch(showError)
    }

    function renderAdultSeries(query = '') {
      if (!$('#adultSeriesSection') || !$('#adultSeriesRail')) return
      const allSeries = library?.adult_series || []
      const search = query.trim().toLocaleLowerCase()
      const series = allSeries.filter(value => !search || [
        value.title, value.stored_title,
        ...(value.episodes || []).map(episode => episode.display_name),
      ].join(' ').toLocaleLowerCase().includes(search))
      $('#adultSeriesSection').classList.toggle('hidden', Boolean(search) && !series.length)
      const rail = $('#adultSeriesRail')
      rail.innerHTML = ''
      series.forEach(value => {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'adult-series-card'
        const art = adultSeriesArtwork(value)
        const progress = document.createElement('span')
        progress.className = 'adult-series-card-progress'
        progress.style.setProperty('--series-progress', `${value.episode_count
          ? value.watched_count / value.episode_count * 100 : 0}%`)
        art.append(progress)
        const copy = document.createElement('span')
        const title = document.createElement('strong')
        title.textContent = value.title
        const meta = document.createElement('small')
        meta.textContent = `${value.season_count} series · ${value.episode_count} episode${value.episode_count === 1 ? '' : 's'} · ${value.watched_count} watched`
        copy.append(title, meta)
        card.append(art, copy)
        card.onclick = () => openAdultSeriesViewing(value)
        rail.append(card)
      })
      if (!allSeries.length) {
        rail.append(portalEmptyState({
          className: 'adult-series-empty',
          title: 'No TV series yet',
          message: 'Create one here, then upload episodes directly from this device.',
          messageTag: 'span',
        }))
      }
    }

    function closeAdultSeriesSheet(restoreParent = true) {
      const dialog = $('#adultSeriesSheet')
      portalSheets.close(dialog, { restore: restoreParent })
      selectedAdultSeries = null
    }

    function closeAdultSeasonSheet(restoreParent = true) {
      const dialog = $('#adultSeasonSheet')
      portalSheets.close(dialog, { restore: restoreParent })
      selectedAdultSeason = null
    }

    function returnToAdultSeriesSheet() {
      closeAdultSeasonSheet()
    }

    function returnFromAdultSeriesRestartSheet() {
      const dialog = $('#adultSeriesRestartSheet')
      portalSheets.close(dialog)
      adultSeriesRestartTarget = null
    }

    function openAdultSeriesRestartSheet(series, season = null) {
      const current = library?.adult_series?.find(value => value.id === series.id) || series
      const scope = season === null ? 'series' : 'season'
      const seasonNumber = season === null ? null : Number(season)
      adultSeriesRestartTarget = {
        seriesId: current.id,
        seriesTitle: current.title,
        scope,
        season: seasonNumber,
      }
      $('#adultSeriesRestartTitle').textContent = scope === 'season'
        ? `Restart Series ${seasonNumber}?` : `Restart all of ${current.title}?`
      $('#adultSeriesRestartDescription').textContent = scope === 'season'
        ? 'Every episode in this series will be marked unwatched and lose its resume point.'
        : 'Every episode in every series will be marked unwatched and lose its resume point.'
      $('#adultSeriesRestartTarget').textContent = scope === 'season'
        ? `${current.title} · Series ${seasonNumber}` : current.title
      const seasonReturn = selectedAdultSeason?.returnTo || null
      const seriesReturn = selectedAdultSeries?.returnTo || null
      const parentReturn = selectedAdultSeason
        ? () => openAdultSeasonSheet(current, seasonNumber, seasonReturn)
        : () => openAdultSeriesSheet(current, seriesReturn)
      closeAdultSeasonSheet(false)
      closeAdultSeriesSheet(false)
      const dialog = $('#adultSeriesRestartSheet')
      portalSheets.open(dialog, { returnTo: parentReturn })
    }

    async function confirmAdultSeriesRestart() {
      const target = adultSeriesRestartTarget
      const button = $('#adultSeriesRestartConfirm')
      if (!target || button.disabled) return
      button.disabled = true
      try {
        const result = await api('/api/adult/series/restart', {
          method: 'POST', body: JSON.stringify({
            series: target.seriesId,
            scope: target.scope,
            season: target.season,
          }),
        })
        const dialog = $('#adultSeriesRestartSheet')
        portalSheets.dismiss(dialog)
        adultSeriesRestartTarget = null
        await reloadLibraryWithoutLosingPlace()
        const series = library?.adult_series?.find(value => value.id === target.seriesId)
        if (series) setTimeout(() => target.scope === 'season'
          ? openAdultSeasonSheet(series, target.season)
          : openAdultSeriesSheet(series), 0)
        notice(`${result.episodes_reset} episode${result.episodes_reset === 1 ? '' : 's'} ready to watch from the beginning.`)
      } catch (error) {
        showError(error)
      } finally {
        button.disabled = false
      }
    }

    function closeAdultEpisodeSheet(restoreParent = true) {
      const dialog = $('#adultEpisodeSheet')
      portalSheets.close(dialog, { restore: restoreParent })
      selectedAdultEpisode = null
    }

    function closeAdultEpisodeMoreSheet(restoreParent = true) {
      const dialog = $('#adultEpisodeMoreSheet')
      portalSheets.close(dialog, { restore: restoreParent })
    }

    function returnToAdultSeasonSheet() {
      closeAdultEpisodeSheet()
    }

    function openAdultEpisodeSheet(series, episode, returnTo = null) {
      const current = library?.adult_series?.find(value => value.id === series.id) || series
      selectedAdultEpisode = {
        series: current,
        season: episode.season,
        episode,
        returnTo,
      }
      $('#adultEpisodeEyebrow').textContent = `${series.title} · Series ${episode.season}`
      $('#adultEpisodeTitle').textContent = episode.display_name
      $('#adultEpisodeMeta').textContent = `S${String(episode.season).padStart(2, '0')} E${String(episode.episode).padStart(2, '0')}${episode.watched ? ' · Watched' : episode.remote_position > 0 ? ` · ${watchTimeLabel(episode.remote_position)} watched` : ''}`
      const source = { kind: 'adult-series', series: series.id,
        file: episode.path, position: Number(episode.remote_position || 0) }
      $('#adultEpisodeTv').onclick = () => {
        closeAdultEpisodeSheet(false)
        playOnTv(source, episode.display_name)
      }
      const here = $('#adultEpisodeHere')
      here.querySelector('strong').textContent = episode.browser_ready
        ? episode.remote_position > 10 ? 'Continue on this device' : 'Watch on this device'
        : 'Play in VLC'
      here.querySelector('small').textContent = episode.browser_ready
        ? episode.remote_position > 10 ? `Continue from ${watchTimeLabel(episode.remote_position)}` : 'Starts an independent stream'
        : 'Open the original file without conversion'
      here.onclick = () => {
        closeAdultEpisodeSheet(false)
        if (episode.browser_ready) openRemotePlayer(source, episode.remote_position)
        else openInVlc(source, episode.display_name)
      }
      const watched = $('#adultEpisodeWatched')
      watched.disabled = false
      watched.querySelector('strong').textContent = episode.watched
        ? 'Mark as unwatched' : 'Mark watched'
      watched.querySelector('small').textContent = episode.watched
        ? 'Put this episode back in your unwatched list'
        : 'Useful after watching this episode in VLC'
      watched.onclick = async () => {
        watched.disabled = true
        try {
          const result = await api('/api/adult/series/watched', { method: 'POST', body: JSON.stringify({
            series: series.id, file: episode.path, watched: !episode.watched,
          }) })
          episode.watched = result.watched === true
          episode.remote_position = Number(result.remote_position || 0)
          episode.remote_duration = Number(result.remote_duration || episode.remote_duration || 0)
          episode.remote_last_watched = Number(result.remote_last_watched || 0)
          series.watched_count = Math.max(0, Number(series.watched_count || 0)
            + (episode.watched ? 1 : -1))
          if (episode.watched) await finishLocalSeriesIfComplete(series)
          closeAdultEpisodeSheet(false)
          if (returnTo) returnTo()
          renderAdultWatch()
          renderHomeLibrary()
          notice(episode.watched ? 'Episode marked watched.' : episode.remote_position > 10
            ? `Marked unwatched. Resume point restored at ${watchTimeLabel(episode.remote_position)}.`
            : 'Episode marked unwatched.')
        } catch (error) { showError(error) } finally { watched.disabled = false }
      }
      $('#adultEpisodeMore').onclick = () => {
        $('#adultEpisodeMoreEyebrow').textContent = `${series.title} · Series ${episode.season}`
        $('#adultEpisodeMoreTitle').textContent = episode.display_name
        $('#adultEpisodeMoreMeta').textContent = `S${String(episode.season).padStart(2, '0')} E${String(episode.episode).padStart(2, '0')} · More episode options`
        closeAdultEpisodeSheet(false)
        const dialog = $('#adultEpisodeMoreSheet')
        portalSheets.open(dialog, {
          returnTo: () => openAdultEpisodeSheet(current, episode, returnTo),
        })
      }
      $('#adultEpisodeDownload').onclick = () => {
        closeAdultEpisodeMoreSheet(false)
        downloadToDevice(source, `${series.title} - ${episode.display_name}`)
      }
      $('#adultEpisodeDelete').onclick = async () => {
        if (!confirm(`Move “${episode.display_name}” to the recycle bin?`)) return
        closeAdultEpisodeMoreSheet(false)
        try {
          await manage('trash-adult-series', {
            series: series.id, scope: 'episode', file: episode.path,
          })
          notice('Episode moved to the recycle bin.')
        } catch (error) { showError(error) }
      }
      const dialog = $('#adultEpisodeSheet')
      portalSheets.open(dialog, { returnTo })
      const tmdbId = Number(current.metadata?.tmdb_id || 0)
      if (tmdbId) api('/api/adult/viewing').then(result => {
        if (selectedAdultEpisode?.episode?.path !== episode.path) return
        const saved = (result.items || []).find(item => item.key === `tv:${tmdbId}`) || {}
        const rewatching = saved.series_watching === true
          && saved.series_watching_mode === 'rewatch'
        if (!rewatching) return
        const episodeKey = `${episode.season}:${episode.episode}`
        const rewatched = saved.rewatch_episodes?.[episodeKey]?.watched === true
        $('#adultEpisodeMeta').textContent = `S${String(episode.season).padStart(2, '0')} E${String(episode.episode).padStart(2, '0')} · ${rewatched ? 'Watched again' : 'Active rewatch'}`
        watched.querySelector('strong').textContent = rewatched
          ? 'Remove from this rewatch' : 'Mark watched again'
        watched.querySelector('small').textContent = rewatched
          ? 'Moves the rewatch position back to this episode'
          : 'Advances the separate rewatch position'
        watched.onclick = async () => {
          watched.disabled = true
          try {
            const trackingTitle = {
              media_type: 'tv', tmdb_id: tmdbId, title: current.title,
              year: current.metadata?.year || '', overview: current.metadata?.overview || '',
              viewing: saved,
            }
            await updateAdultViewing(trackingTitle, 'episode_watched', {
              season: episode.season, episode: episode.episode,
              watched: !rewatched, rewatch: true,
            })
            closeAdultEpisodeSheet(false)
            if (returnTo) returnTo()
            notice(rewatched ? 'Removed from this rewatch.' : 'Episode marked watched again.')
          } catch (error) { showError(error) } finally { watched.disabled = false }
        }
      }).catch(() => {})
    }

    async function finishLocalSeriesIfComplete(series) {
      const tmdbId = Number(series.metadata?.tmdb_id || 0)
      if (!tmdbId || !series.episode_count
          || Number(series.watched_count || 0) < Number(series.episode_count || 0)) return
      const result = await api('/api/adult/viewing')
      const saved = (result.items || []).find(item => item.key === `tv:${tmdbId}`)
      if (saved?.manual_state === 'watched') return
      await updateAdultViewing({
        media_type: 'tv', tmdb_id: tmdbId, title: series.title,
        year: series.metadata?.year || '', overview: series.metadata?.overview || '',
        viewing: saved || {},
      }, 'watched')
    }

    function nextLocalEpisodeAfterProgress(episodes, isWatched = episode => episode.watched === true) {
      const ordered = [...(episodes || [])].sort((a, b) =>
        Number(a.season) - Number(b.season) || Number(a.episode) - Number(b.episode))
      let lastWatched = -1
      ordered.forEach((episode, index) => {
        if (isWatched(episode)) lastWatched = index
      })
      return ordered[lastWatched + 1] || null
    }

    function localEpisodeAirDate(value) {
      const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!match) return ''
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`
    }

    function wireAdultSeasonBulkButton(button, label, watched, total, onConfirm, compact = false) {
      let watchedCount = Number(watched || 0)
      let episodeCount = Number(total || 0)
      let confirming = false
      let confirmTimer = null
      button.classList.toggle('adult-season-status', compact)
      const render = () => {
        clearTimeout(confirmTimer)
        const complete = episodeCount > 0 && watchedCount >= episodeCount
        const partial = watchedCount > 0 && !complete
        button.classList.toggle('is-complete', complete)
        button.classList.toggle('is-partial', partial)
        button.classList.toggle('is-confirming', confirming)
        button.replaceChildren(librarySignalIcon(complete ? 'signal-check'
          : partial ? 'signal-minus' : 'signal-check'))
        if (!compact || confirming) {
          const copy = document.createElement('span')
          copy.textContent = confirming
            ? complete ? 'Mark all unwatched?' : 'Mark all watched?'
            : complete ? `${label} complete · Mark unwatched`
              : partial ? `${watchedCount} of ${episodeCount} watched · Mark all watched`
                : `Mark all ${episodeCount} episodes watched`
          button.append(copy)
        }
        button.setAttribute('aria-label', complete
          ? `${label} complete. Mark every episode unwatched`
          : partial ? `${label} partly watched. Mark every episode watched`
            : `${label} not started. Mark every episode watched`)
      }
      button.syncSeasonStatus = (nextWatched, nextTotal = episodeCount) => {
        watchedCount = Number(nextWatched || 0)
        episodeCount = Number(nextTotal || 0)
        confirming = false
        render()
      }
      button.onclick = async event => {
        event.preventDefault()
        event.stopPropagation()
        if (button.disabled || !episodeCount) return
        if (!confirming) {
          confirming = true
          render()
          confirmTimer = setTimeout(() => { confirming = false; render() }, 3500)
          return
        }
        const targetWatched = watchedCount < episodeCount
        button.disabled = true
        try {
          const result = await onConfirm(targetWatched)
          watchedCount = Number.isFinite(Number(result))
            ? Number(result) : targetWatched ? episodeCount : 0
          confirming = false
          render()
        } catch (error) {
          confirming = false
          render()
          showError(error)
        } finally {
          button.disabled = false
        }
      }
      render()
      return button
    }

    function openAdultSeasonSheet(series, season, returnTo = null, targetPath = '') {
      const current = library?.adult_series?.find(value => value.id === series.id) || series
      const number = Number(season)
      const episodes = (current.episodes || []).filter(episode => Number(episode.season) === number)
      selectedAdultSeason = { series: current, season: number, returnTo }
      $('#adultSeasonEyebrow').textContent = current.title
      $('#adultSeasonTitle').textContent = `Series ${number}`
      const watched = episodes.filter(episode => episode.watched).length
      $('#adultSeasonMeta').textContent = `${episodes.length} episode${episodes.length === 1 ? '' : 's'} · ${watched} watched`
      $('#adultSeasonArtwork').replaceChildren(adultSeasonArtwork(
        current, episodes, 'adult-season-sheet-artwork'))
      $('#adultSeasonUploadHint').textContent = `Upload directly into Series ${number}`
      $('#adultSeasonEpisodeTitle').textContent = `Series ${number} episodes`
      $('#adultSeasonEpisodeCount').textContent = `${episodes.length} total`
      const markSeason = async targetWatched => {
        const result = await api('/api/adult/series/watched', { method: 'POST', body: JSON.stringify({
          series: current.id, scope: 'season', season: number, watched: targetWatched,
        }) })
        episodes.forEach(episode => {
          const saved = (result.episodes || []).find(value => value.path === episode.path)
          episode.watched = targetWatched
          episode.remote_position = Number(saved?.remote_position || 0)
          episode.remote_duration = Number(saved?.remote_duration || episode.remote_duration || 0)
          episode.remote_last_watched = Number(saved?.remote_last_watched || 0)
        })
        current.watched_count = (current.episodes || []).filter(episode => episode.watched).length
        if (targetWatched) await finishLocalSeriesIfComplete(current)
        renderAdultWatch()
        renderHomeLibrary()
        notice(targetWatched ? `Series ${number} marked watched.`
          : `Series ${number} marked unwatched. Saved resume points were restored.`)
        closeAdultSeasonSheet(false)
        openAdultSeasonSheet(current, number, returnTo)
        return targetWatched ? episodes.length : 0
      }
      wireAdultSeasonBulkButton($('#adultSeasonWatched'), `Series ${number}`,
        watched, episodes.length, markSeason)
      const root = $('#adultSeasonEpisodes')
      root.replaceChildren()
      episodes.forEach(episode => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `adult-series-episode${episode.watched ? ' is-watched' : ''}`
        const artwork = document.createElement('span')
        artwork.className = 'adult-series-episode-art'
        if (episode.still) {
          const image = document.createElement('img')
          image.src = `/api/adult/series/artwork/${encodeURIComponent(episode.still)}`
          image.alt = ''
          image.loading = 'lazy'
          artwork.append(image)
        }
        const numberBadge = document.createElement('span')
        numberBadge.className = 'adult-series-episode-number'
        numberBadge.textContent = `E${String(episode.episode).padStart(2, '0')}`
        artwork.append(numberBadge)
        const copy = document.createElement('span')
        copy.className = 'adult-series-episode-copy'
        const title = document.createElement('strong')
        title.textContent = episode.display_name
        const detail = document.createElement('small')
        const playbackState = episode.watched ? 'Watched' : episode.remote_position > 10
          ? `Continue · ${watchTimeLabel(episode.remote_position)}`
          : episode.browser_ready ? 'Watch here or on TV' : 'VLC or TV'
        detail.textContent = [playbackState, localEpisodeAirDate(episode.air_date)]
          .filter(Boolean).join(' · ')
        copy.append(title, detail)
        const progress = watchFilmProgress(episode)
        if (progress > 0 && !episode.watched) row.classList.add('has-progress')
        row.style.setProperty('--episode-progress', `${progress}%`)
        row.append(artwork, copy, librarySignalIcon('signal-chevron-right'))
        row.dataset.episodePath = episode.path
        if (episode.path === targetPath) row.classList.add('is-next')
        row.onclick = () => {
          closeAdultSeasonSheet(false)
          openAdultEpisodeSheet(current, episode, () =>
            openAdultSeasonSheet(current, number, returnTo, episode.path))
        }
        root.append(row)
      })
      if (!episodes.length) {
        root.replaceChildren(portalEmptyState({
          className: 'adult-series-empty',
          title: 'No episodes in this series',
          message: 'Add prepared videos directly from this phone or computer.',
          messageTag: 'span',
        }))
      }
      $('#adultSeasonUpload').onclick = () => openAdultSeriesUpload(current, number)
      $('#adultSeasonMetadata').disabled = !tmdbConfigured
      $('#adultSeasonMetadata').onclick = () => {
        closeAdultSeasonSheet(false)
        scanAdultSeriesTmdb(current, () => openAdultSeasonSheet(current, number, returnTo))
      }
      $('#adultSeasonRestart').onclick = () => openAdultSeriesRestartSheet(current, number)
      $('#adultSeasonDelete').onclick = async () => {
        if (!confirm(`Move every episode in Series ${number} of “${current.title}” to the recycle bin?`)) return
        closeAdultSeasonSheet(false)
        try {
          await manage('trash-adult-series', {
            series: current.id, scope: 'season', season: number,
          })
          notice(`Series ${number} moved to the recycle bin.`)
        } catch (error) { showError(error) }
      }
      const dialog = $('#adultSeasonSheet')
      portalSheets.open(dialog, { returnTo })
      if (targetPath) requestAnimationFrame(() => root.querySelector('.is-next')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    }

    function openAdultSeriesSheet(series, returnTo = null) {
      const current = library?.adult_series?.find(value => value.id === series.id) || series
      selectedAdultSeries = { series: current, returnTo }
      let localViewingState = {}
      const syncSeriesHeader = () => {
        current.watched_count = (current.episodes || []).filter(episode => episode.watched).length
        $('#adultSeriesSheetMeta').textContent = `${current.season_count} series · ${current.episode_count} episodes · ${current.watched_count} watched`
        const rewatching = localViewingState.series_watching === true
          && localViewingState.series_watching_mode === 'rewatch'
        const states = localViewingState.rewatch_episodes || {}
        const next = nextLocalEpisodeAfterProgress(current.episodes, episode => rewatching
          ? states[`${episode.season}:${episode.episode}`]?.watched === true
          : episode.watched === true)
        const nextButton = $('#adultSeriesNextEpisode')
        nextButton.classList.toggle('hidden', !next)
        if (next) {
          nextButton.querySelector('small').textContent = rewatching
            ? 'Next episode in this rewatch' : 'Next episode'
          nextButton.querySelector('strong').textContent = `Series ${next.season}, Episode ${next.episode} · ${next.display_name}`
          nextButton.onclick = () => {
            closeAdultSeriesSheet(false)
            openAdultSeasonSheet(current, next.season,
              () => openAdultSeriesSheet(current, returnTo), next.path)
          }
        }
      }
      $('#adultSeriesSheetTitle').textContent = current.title
      syncSeriesHeader()
      $('#adultSeriesOverview').textContent = current.metadata?.overview
        || 'Choose an episode, or match this series with TMDB to add descriptions and artwork.'
      $('#adultSeriesSheetPoster').replaceChildren(adultSeriesArtwork(
        current, 'adult-series-sheet-art'))
      const favourite = $('#adultSeriesFavourite')
      favourite.classList.toggle('active', current.favourite === true)
      favourite.setAttribute('aria-label', current.favourite
        ? 'Remove series from favourites' : 'Add series to favourites')
      favourite.onclick = () => setAdultSeriesFavourite(current, current.favourite !== true)
        .then(() => {
          favourite.classList.toggle('active', current.favourite === true)
          favourite.setAttribute('aria-label', current.favourite
            ? 'Remove series from favourites' : 'Add series to favourites')
        }).catch(showError)
      const watching = $('#adultSeriesWatching')
      const tmdbId = Number(current.metadata?.tmdb_id || 0)
      watching.classList.toggle('hidden', !tmdbId)
      if (tmdbId) {
        const trackingTitle = {
          media_type: 'tv', tmdb_id: tmdbId, title: current.title,
          year: current.metadata?.year || '', overview: current.metadata?.overview || '',
        }
        const syncWatching = state => {
          trackingTitle.viewing = state || {}
          localViewingState = state || {}
          watching.classList.toggle('active', state?.series_watching === true)
          watching.setAttribute('aria-pressed', String(state?.series_watching === true))
          const rewatching = state?.series_watching === true
            && state?.series_watching_mode === 'rewatch'
          watching.querySelector('strong').textContent = state?.series_watching
            ? rewatching ? 'Rewatching this series' : 'Watching this series'
            : state?.rewatch ? 'Start rewatching series' : 'Start watching series'
          watching.querySelector('small').textContent = state?.series_watching
            ? 'Its next episode is kept in Up Next' : 'Keep the show and its next episode in Up Next'
          syncSeriesHeader()
        }
        syncWatching({})
        watching.disabled = true
        watching.onclick = async () => {
          if (watching.disabled) return
          watching.disabled = true
          try {
            const state = await updateAdultViewing(trackingTitle, 'watching', {
              enabled: !trackingTitle.viewing?.series_watching,
              mode: trackingTitle.viewing?.rewatch
                || (current.episode_count > 0 && current.watched_count >= current.episode_count)
                ? 'rewatch' : 'first_watch',
            })
            syncWatching(state)
            notice(state.series_watching
              ? 'Series added to Watching and Up Next.' : 'Series removed from Watching.')
          } catch (error) { showError(error) } finally { watching.disabled = false }
        }
        api('/api/adult/viewing').then(result => {
          if (selectedAdultSeries?.series?.id !== current.id) return
          const item = (result.items || []).find(value => value.key === `tv:${tmdbId}`)
          syncWatching(item || {})
        }).catch(() => syncWatching({})).finally(() => { watching.disabled = false })
      }
      const root = $('#adultSeriesEpisodes')
      root.innerHTML = ''
      const groups = new Map()
      ;(current.episodes || []).forEach(episode => {
        if (!groups.has(episode.season)) groups.set(episode.season, [])
        groups.get(episode.season).push(episode)
      })
      $('#adultSeriesSeasonCount').textContent = `${groups.size} series`
      ;[...groups.entries()].sort((left, right) => left[0] - right[0]).forEach(([season, episodes]) => {
        const card = document.createElement('article')
        card.className = 'adult-season-card'
        card.tabIndex = 0
        card.setAttribute('role', 'button')
        const art = adultSeasonArtwork(current, episodes)
        const shade = document.createElement('span')
        shade.className = 'adult-season-card-shade'
        const copy = document.createElement('span')
        copy.className = 'adult-season-card-copy'
        const kicker = document.createElement('span')
        kicker.textContent = `${current.title} · ${episodes.length} episode${episodes.length === 1 ? '' : 's'}`
        const heading = document.createElement('strong')
        heading.textContent = `Series ${season}`
        const detail = document.createElement('small')
        const watched = episodes.filter(episode => episode.watched).length
        detail.textContent = watched ? `${watched} watched · Open series` : 'Open series'
        copy.append(kicker, heading, detail)
        const progress = document.createElement('span')
        progress.className = 'adult-season-card-progress'
        progress.style.setProperty('--season-progress', `${episodes.length ? watched / episodes.length * 100 : 0}%`)
        const openSeason = () => {
          closeAdultSeriesSheet(false)
          openAdultSeasonSheet(current, season, () => openAdultSeriesSheet(current, returnTo))
        }
        card.onclick = openSeason
        card.onkeydown = event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSeason() }
        }
        const status = document.createElement('button')
        status.type = 'button'
        wireAdultSeasonBulkButton(status, `Series ${season}`, watched, episodes.length,
          async targetWatched => {
            const result = await api('/api/adult/series/watched', { method: 'POST', body: JSON.stringify({
              series: current.id, scope: 'season', season, watched: targetWatched,
            }) })
            episodes.forEach(episode => {
              const saved = (result.episodes || []).find(value => value.path === episode.path)
              episode.watched = targetWatched
              episode.remote_position = Number(saved?.remote_position || 0)
              episode.remote_duration = Number(saved?.remote_duration || episode.remote_duration || 0)
              episode.remote_last_watched = Number(saved?.remote_last_watched || 0)
            })
            const count = targetWatched ? episodes.length : 0
            detail.textContent = count ? `${count} watched · Open series` : 'Open series'
            progress.style.setProperty('--season-progress', `${targetWatched ? 100 : 0}%`)
            syncSeriesHeader()
            if (targetWatched) await finishLocalSeriesIfComplete(current)
            renderAdultWatch()
            renderHomeLibrary()
            notice(targetWatched ? `Series ${season} marked watched.`
              : `Series ${season} marked unwatched. Saved resume points were restored.`)
            return count
          }, true)
        card.append(art, shade, copy, progress,
          librarySignalIcon('signal-chevron-right', 'icon adult-season-card-chevron'), status)
        root.append(card)
      })
      const nextSeries = Math.max(0, ...[...groups.keys()].map(Number)) + 1
      const addCard = document.createElement('button')
      addCard.type = 'button'
      addCard.className = 'adult-season-add-card'
      addCard.append(librarySignalIcon('signal-plus'), document.createElement('span'))
      addCard.querySelector('span').innerHTML = `<strong>Start Series ${nextSeries}</strong><small>Upload its first episodes</small>`
      addCard.onclick = () => openAdultSeriesUpload(current, nextSeries, true)
      root.append(addCard)
      $('#adultSeriesMetadata').disabled = !tmdbConfigured
      $('#adultSeriesMetadata').onclick = () => {
        closeAdultSeriesSheet(false)
        scanAdultSeriesTmdb(current, () => openAdultSeriesSheet(current, returnTo))
      }
      $('#adultSeriesRestart').onclick = () => openAdultSeriesRestartSheet(current)
      $('#adultSeriesDelete').onclick = async () => {
        if (!confirm(`Move the complete “${current.title}” show and every series and episode to the recycle bin?`)) return
        closeAdultSeriesSheet(false)
        try {
          await manage('trash-adult-series', { series: current.id, scope: 'series' })
          notice(`${current.title} moved to the recycle bin.`)
        } catch (error) { showError(error) }
      }
      const dialog = $('#adultSeriesSheet')
      portalSheets.open(dialog, { returnTo })
    }

    async function scanAdultSeriesTmdb(series, returnTo = null) {
      try {
        notice(`Searching TMDB for ${series.title}…`)
        const result = await api('/api/tmdb/adult-series/search', {
          method: 'POST', body: JSON.stringify({ series: series.id })
        })
        $('#tmdbDialogTitle').textContent = `Match “${result.query}”`
        const root = $('#tmdbResults')
        root.innerHTML = ''
        if (!result.results.length) root.append(portalEmptyState({
          title: 'No matches found',
          message: 'Try creating the series with its full name.',
        }))
        result.results.forEach(match => {
          const row = document.createElement('article')
          row.className = 'tmdb-result'
          const poster = document.createElement('span')
          poster.className = 'tmdb-result-poster'
          poster.append(librarySignalIcon('signal-tv'))
          const copy = document.createElement('div')
          copy.innerHTML = `<strong>${escapeHtml(match.title)}${match.year ? ` (${escapeHtml(match.year)})` : ''}</strong><p>${escapeHtml(match.overview || 'No description supplied.')}</p>`
          const choose = document.createElement('button')
          choose.type = 'button'; choose.className = 'primary tmdb-result-choose'
          choose.textContent = 'Use this series'
          choose.onclick = async () => {
            choose.disabled = true
            try {
              notice('Matching seasons and episodes…')
              await api('/api/tmdb/adult-series/apply', { method: 'POST', body: JSON.stringify({
                series: series.id, tmdb_id: match.id,
              }) })
              portalSheets.dismiss($('#tmdbDialog'))
              await reloadLibraryWithoutLosingPlace()
              notice('Series, season and episode metadata was saved locally.')
            } catch (error) { showError(error); choose.disabled = false }
          }
          row.append(poster, copy, choose)
          root.append(row)
        })
        portalSheets.open($('#tmdbDialog'), { returnTo })
        notice('')
      } catch (error) { showError(error) }
    }

    function renderAdultWatch() {
      const adult = $('#remoteAdult')
      adult.innerHTML = ''
      const allFilms = [...(library?.adult_library || [])].sort((left, right) => watchFilmTitle(left).localeCompare(watchFilmTitle(right), undefined, { sensitivity: 'base' }))
      watchFolder = '*'
      $('#watchSearch').value = watchSearchText
      $('#watchSearchClear').classList.toggle('hidden', !watchSearchText)

      const query = watchSearchText.trim().toLocaleLowerCase()
      renderAdultSeries(watchSearchText)
      const resumableFilms = allFilms
        .filter(film => film.browser_ready !== false && watchFilmResumable(film))
        .map(film => ({ ...adultFilmEntry(film),
          lastWatched: Number(film.remote_last_watched || 0) }))
      const resumable = [...resumableFilms, ...adultSeriesContinueEntries()]
        .sort((left, right) => Number(right.lastWatched || 0) - Number(left.lastWatched || 0))
        .slice(0, 10)
      const continueSection = $('#watchContinueSection')
      continueSection.classList.toggle('hidden', !resumable.length || Boolean(query))
      $('#watchContinueCount').textContent = resumable.length ? `${resumable.length} in progress` : ''
      const continueRail = $('#watchContinueRail')
      continueRail.innerHTML = ''
      resumable.forEach(entry => continueRail.append(continueWatchCard(entry)))

      const films = allFilms.filter(film => {
        // Search is always global. A film should never look missing merely
        // because someone last browsed a different collection.
        if (!query) return true
        const metadata = film.metadata || {}
        return [watchFilmTitle(film), film.display_name, film.folder, metadata.year].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)
      })
      $('#watchLibraryKicker').textContent = query ? 'Search all films' : 'Your library'
      $('#watchLibraryTitle').textContent = query ? `“${watchSearchText.trim()}”` : 'All films'
      $('#watchLibraryCount').textContent = `${films.length} film${films.length === 1 ? '' : 's'}`
      const grid = document.createElement('div')
      grid.className = 'watch-poster-grid'
      films.forEach(film => grid.append(adultWatchCard(film)))
      if (!films.length) {
        const empty = document.createElement('div')
        empty.className = 'watch-empty'
        empty.innerHTML = query ? '<strong>No matches</strong><br>Try another title or clear your filters.' : '<strong>Nothing here yet</strong><br>This collection has no films matching the current filters.'
        grid.append(empty)
      }
      adult.append(grid)
    }
