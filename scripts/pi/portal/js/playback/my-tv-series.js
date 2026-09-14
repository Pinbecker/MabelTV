'use strict'

    let myTvSeriesViewingLoadStarted = false
    const myTvSeriesRailCatalogue = new Map()

    function myTvSeriesRailCounts(local, viewing) {
      if (Number(local?.episode_count || 0) > 0) {
        return {
          series: Number(local.season_count || 0),
          episodes: Number(local.episode_count || 0),
          watched: Number(local.watched_count || 0),
        }
      }
      const cached = myTvSeriesRailCatalogue.get(Number(viewing?.tmdb_id || 0))
      const savedWatched = Object.values(viewing?.episodes || {})
        .filter(episode => episode?.watched === true).length
      return {
        series: cached?.series ?? '—',
        episodes: cached?.episodes ?? '—',
        watched: Math.max(Number(cached?.watched || 0), savedWatched),
      }
    }

    function renderMyTvSeriesRailFacts(root, counts) {
      renderMyTvTitleMetadata(root, {}, { facts: [
        { label: 'Series', value: String(counts.series) },
        { label: 'Episodes', value: String(counts.episodes) },
        { label: 'Watched', value: String(counts.watched) },
      ] })
    }

    async function hydrateMyTvSeriesRailCard(card, progress, viewing) {
      const tmdbId = Number(viewing?.tmdb_id || 0)
      if (!tmdbId) return
      let counts = myTvSeriesRailCatalogue.get(tmdbId)
      if (!counts) {
        const detail = await api(`/api/my-tv/title?media_type=tv&tmdb_id=${tmdbId}`)
        const seasons = detail.seasons || []
        counts = {
          series: seasons.length,
          episodes: seasons.reduce((total, season) => total + Number(season.episodes || 0), 0),
          watched: seasons.reduce((total, season) => total + Number(season.watched_count || 0), 0),
        }
        myTvSeriesRailCatalogue.set(tmdbId, counts)
      }
      if (!card.isConnected) return
      renderMyTvSeriesRailFacts(card.querySelector('.my-tv-series-card-facts'), counts)
      progress.style.setProperty('--series-progress', `${counts.episodes
        ? counts.watched / counts.episodes * 100 : 0}%`)
    }

    function myTvSeriesArtwork(series, className = 'my-tv-series-card-art', viewing = null) {
      const art = document.createElement('span')
      art.className = className
      const name = series.metadata?.poster
      if (name) {
        const image = document.createElement('img')
        image.loading = 'lazy'
        image.decoding = 'async'
        image.src = `/api/my-tv/series/artwork/${encodeURIComponent(name)}`
        image.alt = ''
        image.loading = 'lazy'
        art.append(image)
      } else if (viewing?.poster_path) {
        const image = document.createElement('img')
        image.loading = 'lazy'
        image.decoding = 'async'
        image.src = myTvPosterUrl(viewing.poster_path)
        image.alt = ''
        image.loading = 'lazy'
        art.append(image)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'watch-card-placeholder'
        placeholder.textContent = (series.title || viewing?.title || '?').slice(0, 1).toUpperCase()
        art.append(placeholder)
      }
      return art
    }

    function myTvSeasonArtwork(series, episodes, className = 'my-tv-season-card-art') {
      const art = document.createElement('span')
      art.className = className
      const still = (episodes || []).find(episode => episode.still)?.still
      const name = still || series.metadata?.poster
      if (name) {
        const image = document.createElement('img')
        image.loading = 'lazy'
        image.decoding = 'async'
        image.src = `/api/my-tv/series/artwork/${encodeURIComponent(name)}`
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

    function openMyTvSeriesUpload(series, season, isNew = false, navigation = null) {
      const number = Number(season)
      const seasonParent = selectedMyTvSeason?.returnTo || null
      const seriesParent = selectedMyTvSeries?.returnTo || null
      const returnTo = navigation?.returnTo || (selectedMyTvSeason
        ? () => openMyTvSeasonSheet(series, number, seasonParent)
        : () => openMyTvSeriesSheet(series, seriesParent))
      const seasonReturnTo = selectedMyTvSeason
        ? seasonParent
        : () => openMyTvSeriesSheet(series, seriesParent)
      myTvSeriesUploadTarget = {
        id: series.id, title: series.title, season: number, isNew, returnTo,
        successReturn: navigation?.successReturn
          || (() => openMyTvSeasonSheet(series, number, seasonReturnTo)),
      }
      $('#myTvSeriesUploadEyebrow').textContent = `${series.title} · Series ${number}`
      $('#myTvSeriesUploadTitle').textContent = isNew
        ? `Start Series ${number}` : `Add episodes to Series ${number}`
      $('#myTvSeriesUploadDescription').textContent = isNew
        ? 'Choose the first episodes for this new series.'
        : 'Every selected episode will be added to this series.'
      $('#myTvSeriesUploadDestination').textContent = `${series.title} · Series ${number}`
      $('#myTvSeriesUploadDestinationMeta').textContent = isNew
        ? 'This series will appear as soon as its first episode is added.'
        : 'Existing episodes stay exactly where they are.'
      selectedMyTvSeriesFiles = []
      renderSelectedMyTvSeriesFiles()
      closeMyTvSeasonSheet(false)
      closeMyTvSeriesSheet(false)
      portalSheets.dismiss($('#myTvTitleSeasonSheet'))
      openLibrarySheet($('#myTvSeriesUploadSheet'), $('#myTvSeriesFile'), returnTo)
    }

    function openMyTvSeriesSourceSheet() {
      const upload = $('#myTvSeriesUploadSheet')
      const source = $('#myTvSeriesSourceSheet')
      if (!upload || !source || !myTvSeriesUploadTarget) return
      myTvSeriesSourcePickerOpen = true
      closeLibrarySheet(upload, false)
      portalSheets.open(source, {
        returnTo: () => openLibrarySheet(upload, null, myTvSeriesUploadTarget?.returnTo),
      })
    }

    function returnToMyTvSeriesUploadSheet() {
      const source = $('#myTvSeriesSourceSheet')
      portalSheets.close(source)
      myTvSeriesSourcePickerOpen = false
    }

    function chooseMyTvSeriesFiles() {
      const source = $('#myTvSeriesSourceSheet')
      portalSheets.close(source)
      myTvSeriesSourcePickerOpen = false
      if (!myTvSeriesUploadTarget) return
      setTimeout(() => $('#myTvSeriesFile')?.click(), 80)
    }

    function chooseMyTvSeriesUsb() {
      const target = myTvSeriesUploadTarget
      const source = $('#myTvSeriesSourceSheet')
      portalSheets.dismiss(source)
      myTvSeriesSourcePickerOpen = false
      myTvSeriesUploadTarget = null
      if (!target) return
      $('#usbTarget').value = 'series'
      renderUsbSeriesDestinations(target.id, target.season)
      $('#usbTarget').dispatchEvent(new Event('change'))
      openView('usb')
      refreshUsb().catch(showError)
    }

    function renderMyTvSeries(query = '') {
      if (!$('#myTvSeriesSection') || !$('#myTvSeriesRail')) return
      const allSeries = library?.my_tv_series || []
      if (remoteKind === 'my_tv' && !myTvViewingLoaded && !myTvSeriesViewingLoadStarted) {
        myTvSeriesViewingLoadStarted = true
        void loadMyTvViewing().catch(() => {}).finally(() => {
          myTvSeriesViewingLoadStarted = false
        })
      }
      const upNext = (myTvViewingData.items || [])
        .filter(item => item.media_type === 'tv' && item.up_next === true)
      const upNextById = new Map(upNext.map(item => [Number(item.tmdb_id || 0), item]))
      const represented = new Set()
      const available = allSeries.flatMap(value => {
        const tmdbId = Number(value.metadata?.tmdb_id || 0)
        const viewing = tmdbId ? upNextById.get(tmdbId) || null : null
        if (Number(value.episode_count || 0) < 1 && !viewing) return []
        if (tmdbId) represented.add(tmdbId)
        return [{ local: value, viewing, title: value.title }]
      })
      upNext.forEach(viewing => {
        const tmdbId = Number(viewing.tmdb_id || 0)
        if (tmdbId && !represented.has(tmdbId)) {
          available.push({ local: null, viewing, title: viewing.title || 'Untitled series' })
        }
      })
      const search = query.trim().toLocaleLowerCase()
      const series = available.filter(value => !search || [
        value.title, value.local?.stored_title, value.viewing?.overview,
        ...(value.local?.episodes || []).map(episode => episode.display_name),
      ].join(' ').toLocaleLowerCase().includes(search))
      $('#myTvSeriesSection').classList.toggle('hidden', Boolean(search) && !series.length)
      const rail = $('#myTvSeriesRail')
      rail.innerHTML = ''
      series.forEach(value => {
        const local = value.local
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'my-tv-series-card'
        const art = myTvSeriesArtwork(local || value, 'my-tv-series-card-art', value.viewing)
        const tmdbId = Number(local?.metadata?.tmdb_id || value.viewing?.tmdb_id || 0)
        if (tmdbId && typeof appendMyTvArtworkStatus === 'function') {
          appendMyTvArtworkStatus(art, {
            key: `tv:${tmdbId}`, media_type: 'tv', tmdb_id: tmdbId,
            title: value.title, viewing: value.viewing || {},
          }, { media_type: 'tv', local: local || null })
        }
        const counts = myTvSeriesRailCounts(local, value.viewing)
        const progress = document.createElement('span')
        progress.className = 'my-tv-series-card-progress'
        progress.style.setProperty('--series-progress', `${Number(counts.episodes) > 0
          ? Number(counts.watched) / Number(counts.episodes) * 100 : 0}%`)
        art.append(progress)
        const copy = document.createElement('span')
        const title = document.createElement('strong')
        title.textContent = value.title
        const meta = document.createElement('span')
        meta.className = 'watch-film-meta my-tv-series-card-facts'
        renderMyTvSeriesRailFacts(meta, counts)
        copy.append(title, meta)
        card.append(art, copy)
        card.onclick = () => local ? openMyTvSeriesViewing(local) : openMyTvTitle(value.viewing)
        rail.append(card)
        if (!Number(local?.episode_count || 0)) {
          void hydrateMyTvSeriesRailCard(card, progress, value.viewing).catch(() => {})
        }
      })
      if (!available.length) {
        rail.append(portalEmptyState({
          className: 'my-tv-series-empty',
          title: 'No TV series yet',
          message: `Add a series to Up Next, or add episodes to ${tvName()}.`,
          messageTag: 'span',
        }))
      }
    }

    function closeMyTvSeriesSheet(restoreParent = true) {
      const dialog = $('#myTvSeriesSheet')
      portalSheets.close(dialog, { restore: restoreParent })
      selectedMyTvSeries = null
    }

    function closeMyTvSeasonSheet(restoreParent = true) {
      const dialog = $('#myTvSeasonSheet')
      portalSheets.close(dialog, { restore: restoreParent })
      selectedMyTvSeason = null
    }

    function closeMyTvSeriesMoreSheet(restoreParent = true) {
      portalSheets.close($('#myTvSeriesMoreSheet'), { restore: restoreParent })
    }

    function returnToMyTvSeriesSheet() {
      closeMyTvSeasonSheet()
    }

    function returnFromMyTvSeriesRestartSheet() {
      const dialog = $('#myTvSeriesRestartSheet')
      portalSheets.close(dialog)
      myTvSeriesRestartTarget = null
    }

    function openMyTvSeriesRestartSheet(series, season = null, returnToOverride = null) {
      const current = library?.my_tv_series?.find(value => value.id === series.id) || series
      const scope = season === null ? 'series' : 'season'
      const seasonNumber = season === null ? null : Number(season)
      myTvSeriesRestartTarget = {
        seriesId: current.id,
        seriesTitle: current.title,
        scope,
        season: seasonNumber,
      }
      $('#myTvSeriesRestartTitle').textContent = scope === 'season'
        ? `Restart Series ${seasonNumber}?` : `Restart all of ${current.title}?`
      $('#myTvSeriesRestartDescription').textContent = scope === 'season'
        ? 'This clears every watched mark and resume point in this series.'
        : 'This clears every watched mark and resume point across the complete show.'
      $('#myTvSeriesRestartTarget').textContent = scope === 'season'
        ? `${current.title} · Series ${seasonNumber}` : current.title
      const seasonReturn = selectedMyTvSeason?.returnTo || null
      const seriesReturn = selectedMyTvSeries?.returnTo || null
      const parentReturn = returnToOverride || (selectedMyTvSeason
        ? () => openMyTvSeasonSheet(current, seasonNumber, seasonReturn)
        : () => openMyTvSeriesSheet(current, seriesReturn))
      myTvSeriesRestartTarget.returnTo = parentReturn
      closeMyTvSeasonSheet(false)
      closeMyTvSeriesSheet(false)
      const dialog = $('#myTvSeriesRestartSheet')
      portalSheets.open(dialog, { returnTo: parentReturn })
    }

    function openMyTvSeriesMoreSheet(series, returnTo = null, parentReturn = null) {
      const current = library?.my_tv_series?.find(value => value.id === series.id) || series
      $('#myTvSeriesMoreTitle').textContent = current.title
      renderMyTvSeriesHeaderFacts($('#myTvSeriesMoreMeta'), [
        { label: 'Series', value: String(current.season_count) },
        { label: 'Episodes', value: String(current.episode_count) },
      ])
      $('#myTvSeriesRestart').onclick = () => {
        closeMyTvSeriesMoreSheet(false)
        openMyTvSeriesRestartSheet(current, null,
          parentReturn || (() => openMyTvSeriesSheet(current, returnTo)))
      }
      const metadata = $('#myTvSeriesMetadata')
      metadata.disabled = !tmdbConfigured
      metadata.onclick = tmdbConfigured ? () => {
        closeMyTvSeriesMoreSheet(false)
        scanMyTvSeriesTmdb(current, () => openMyTvSeriesMoreSheet(current, returnTo, parentReturn))
      } : null
      $('#myTvSeriesDelete').onclick = async () => {
        if (!confirm(`Move the complete “${current.title}” show and every series and episode to the recycle bin?`)) return
        closeMyTvSeriesMoreSheet(false)
        try {
          await manage('trash-my-tv-series', { series: current.id, scope: 'series' })
        } catch (error) { showError(error) }
      }
      portalSheets.open($('#myTvSeriesMoreSheet'), {
        returnTo: parentReturn || (() => openMyTvSeriesSheet(current, returnTo)),
      })
    }

    async function confirmMyTvSeriesRestart() {
      const target = myTvSeriesRestartTarget
      const button = $('#myTvSeriesRestartConfirm')
      if (!target || button.disabled) return
      button.disabled = true
      try {
        if (target.scope === 'tracked-season') {
          const detail = target.viewingTitle
          detail.viewing = await updateMyTvViewing(detail, 'season_watched', {
            season: target.season, episode_count: target.episodeCount, watched: false,
          })
          target.viewingSeason.watched_count = 0
          await syncMyTvTitleEpisodeStatus(detail)
          portalSheets.dismiss($('#myTvSeriesRestartSheet'))
          myTvSeriesRestartTarget = null
          setTimeout(() => target.returnTo?.(), 0)
          notice(`${target.episodeCount} episode${target.episodeCount === 1 ? '' : 's'} reset to not watched.`)
          return
        }
        const result = await api('/api/my-tv/series/restart', {
          method: 'POST', body: JSON.stringify({
            series: target.seriesId,
            scope: target.scope,
            season: target.season,
          }),
        })
        const dialog = $('#myTvSeriesRestartSheet')
        portalSheets.dismiss(dialog)
        myTvSeriesRestartTarget = null
        await reloadLibraryWithoutLosingPlace()
        const series = library?.my_tv_series?.find(value => value.id === target.seriesId)
        if (series) setTimeout(() => target.returnTo ? target.returnTo()
          : target.scope === 'season' ? openMyTvSeasonSheet(series, target.season)
            : openMyTvSeriesSheet(series), 0)
        notice(`${result.episodes_reset} episode${result.episodes_reset === 1 ? '' : 's'} reset to not watched.`)
      } catch (error) {
        showError(error)
      } finally {
        button.disabled = false
      }
    }

    function closeMyTvEpisodeSheet(restoreParent = true) {
      const dialog = $('#myTvEpisodeSheet')
      portalSheets.close(dialog, { restore: restoreParent })
      selectedMyTvEpisode = null
    }

    function returnToMyTvSeasonSheet() {
      closeMyTvEpisodeSheet()
    }

    function openMyTvEpisodeSheet(series, episode, returnTo = null) {
      const current = library?.my_tv_series?.find(value => value.id === series.id) || series
      selectedMyTvEpisode = {
        series: current,
        season: episode.season,
        episode,
        returnTo,
      }
      $('#myTvEpisodeEyebrow').textContent = `${series.title} · Series ${episode.season}`
      $('#myTvEpisodeTitle').textContent = episode.display_name
      $('#myTvEpisodeMeta').textContent = `S${String(episode.season).padStart(2, '0')} E${String(episode.episode).padStart(2, '0')}${episode.watched ? ' · Watched' : episode.remote_position > 0 ? ` · ${watchTimeLabel(episode.remote_position)} watched` : ''}`
      const source = { kind: 'my-tv-series', series: series.id,
        file: episode.path, position: Number(episode.remote_position || 0) }
      $('#myTvEpisodeTv').onclick = () => {
        playOnTv(source, episode.display_name)
      }
      const here = $('#myTvEpisodeHere')
      here.querySelector('strong').textContent = episode.browser_ready
        ? episode.remote_position > 10 ? 'Continue on this device' : 'Watch on this device'
        : 'Play in VLC'
      here.querySelector('small').textContent = episode.browser_ready
        ? episode.remote_position > 10 ? `Continue from ${watchTimeLabel(episode.remote_position)}` : 'Starts an independent stream'
        : 'Open the original file without conversion'
      here.onclick = () => {
        if (episode.browser_ready) {
          const mobile = isAppleMobilePlayer()
          if (mobile) closeMyTvEpisodeSheet(false)
          openRemotePlayer(source, episode.remote_position,
            mobile ? () => openMyTvEpisodeSheet(current, episode, returnTo) : null)
        }
        else openInVlc(source, episode.display_name)
      }
      const viewSeries = $('#myTvEpisodeViewSeries')
      viewSeries.classList.toggle('hidden', typeof returnTo === 'function')
      viewSeries.onclick = () => {
        closeMyTvEpisodeSheet(false)
        openMyTvSeriesViewing(current)
      }
      $('#myTvEpisodeDownload').onclick = () => {
        closeMyTvEpisodeSheet(false)
        downloadToDevice(source, `${series.title} - ${episode.display_name}`)
      }
      const removeProgress = $('#myTvEpisodeRemoveProgress')
      removeProgress.classList.toggle('hidden', !watchFilmResumable(episode))
      removeProgress.onclick = watchFilmResumable(episode) ? () => {
        clearContinueProgress({
          source, title: `${series.title} · ${episode.display_name}`,
          action: removeProgress,
          onCleared: () => {
            episode.remote_position = 0
            episode.remote_last_watched = 0
            closeMyTvEpisodeSheet(false)
          },
        }).catch(showError)
      } : null
      $('#myTvEpisodeDelete').onclick = async () => {
        if (!confirm(`Move “${episode.display_name}” to the recycle bin?`)) return
        closeMyTvEpisodeSheet(false)
        try {
          await manage('trash-my-tv-series', {
            series: series.id, scope: 'episode', file: episode.path,
          })
        } catch (error) { showError(error) }
      }
      const dialog = $('#myTvEpisodeSheet')
      portalSheets.open(dialog, { returnTo })
    }

    async function finishLocalSeriesIfComplete(series) {
      const tmdbId = Number(series.metadata?.tmdb_id || 0)
      if (!tmdbId || !series.episode_count
          || Number(series.watched_count || 0) < Number(series.episode_count || 0)) return
      const result = await api('/api/my-tv/viewing')
      const saved = (result.items || []).find(item => item.key === `tv:${tmdbId}`)
      if (saved?.manual_state === 'watched') return
      await updateMyTvViewing({
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

    function wireMyTvSeasonBulkButton(button, label, watched, total, onConfirm, compact = false) {
      let watchedCount = Number(watched || 0)
      let episodeCount = Number(total || 0)
      let confirming = false
      let confirmTimer = null
      button.classList.toggle('my-tv-season-status', compact)
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
        const previousWatched = watchedCount
        watchedCount = targetWatched ? episodeCount : 0
        confirming = false
        render()
        button.disabled = true
        try {
          const result = await onConfirm(targetWatched)
          watchedCount = Number.isFinite(Number(result))
            ? Number(result) : targetWatched ? episodeCount : 0
          confirming = false
          render()
        } catch (error) {
          watchedCount = previousWatched
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

    function renderMyTvSeriesHeaderFacts(root, facts) {
      root.replaceChildren()
      root.className = 'my-tv-series-header-facts'
      facts.filter(fact => fact?.value !== undefined && fact?.value !== null).forEach(fact => {
        const item = document.createElement('span')
        item.className = 'my-tv-title-fact'
        const label = document.createElement('small')
        label.textContent = fact.label
        const value = document.createElement('strong')
        value.textContent = fact.value
        item.append(label, value)
        root.append(item)
      })
    }

    function openMyTvSeasonSheet(series, season, returnTo = null, targetPath = '') {
      const current = library?.my_tv_series?.find(value => value.id === series.id) || series
      const number = Number(season)
      const episodes = (current.episodes || []).filter(episode => Number(episode.season) === number)
      selectedMyTvSeason = { series: current, season: number, returnTo }
      $('#myTvSeasonEyebrow').textContent = current.title
      $('#myTvSeasonTitle').textContent = `Series ${number}`
      const watched = episodes.filter(episode => episode.watched).length
      renderMyTvSeriesHeaderFacts($('#myTvSeasonMeta'), [
        { label: 'Episodes', value: String(episodes.length) },
        { label: `On ${tvName()}`, value: String(episodes.length) },
        { label: 'Watched', value: String(watched) },
      ])
      $('#myTvSeasonArtwork').replaceChildren(myTvSeasonArtwork(
        current, episodes, 'my-tv-season-sheet-artwork'))
      $('#myTvSeasonUploadHint').textContent = `Upload directly into Series ${number}`
      $('#myTvSeasonSettingsEyebrow').textContent = `${current.title} · Series ${number}`
      $('#myTvSeasonEpisodeTitle').textContent = `Series ${number} episodes`
      $('#myTvSeasonEpisodeCount').textContent = `${episodes.length} total`
      const markSeason = async targetWatched => {
        const result = await api('/api/my-tv/series/watched', { method: 'POST', body: JSON.stringify({
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
        renderMyTvWatch()
        renderHomeLibrary()
        closeMyTvSeasonSheet(false)
        openMyTvSeasonSheet(current, number, returnTo)
        return targetWatched ? episodes.length : 0
      }
      wireMyTvSeasonBulkButton($('#myTvSeasonWatched'), `Series ${number}`,
        watched, episodes.length, markSeason)
      const root = $('#myTvSeasonEpisodes')
      root.replaceChildren()
      episodes.forEach(episode => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `my-tv-series-episode${episode.watched ? ' is-watched' : ''}`
        const artwork = document.createElement('span')
        artwork.className = 'my-tv-series-episode-art'
        if (episode.still) {
          const image = document.createElement('img')
          image.loading = 'lazy'
          image.decoding = 'async'
          image.src = `/api/my-tv/series/artwork/${encodeURIComponent(episode.still)}`
          image.alt = ''
          image.loading = 'lazy'
          artwork.append(image)
        }
        const numberBadge = document.createElement('span')
        numberBadge.className = 'my-tv-series-episode-number'
        numberBadge.textContent = `E${String(episode.episode).padStart(2, '0')}`
        artwork.append(numberBadge)
        const copy = document.createElement('span')
        copy.className = 'my-tv-series-episode-copy'
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
        row.onclick = event => {
          if (event.detail > 0) row.blur()
          closeMyTvSeasonSheet(false)
          openMyTvEpisodeSheet(current, episode, () =>
            openMyTvSeasonSheet(current, number, returnTo))
        }
        root.append(row)
      })
      if (!episodes.length) {
        root.replaceChildren(portalEmptyState({
          className: 'my-tv-series-empty',
          title: 'No episodes in this series',
          message: 'Add prepared videos from this device or choose USB.',
          messageTag: 'span',
        }))
      }
      const settingsSheet = $('#myTvSeasonSettingsSheet')
      $('#myTvSeasonSettings').onclick = () => {
        portalSheets.suspend($('#myTvSeasonSheet'))
        portalSheets.open(settingsSheet, {
          returnTo: () => openMyTvSeasonSheet(current, number, returnTo),
        })
      }
      $('#myTvSeasonUpload').onclick = () => {
        portalSheets.dismiss(settingsSheet)
        openMyTvSeriesUpload(current, number)
      }
      $('#myTvSeasonMetadata').disabled = !tmdbConfigured
      $('#myTvSeasonMetadata').onclick = () => {
        portalSheets.dismiss(settingsSheet)
        closeMyTvSeasonSheet(false)
        scanMyTvSeriesTmdb(current, () => openMyTvSeasonSheet(current, number, returnTo))
      }
      $('#myTvSeasonRestart').onclick = () => {
        portalSheets.dismiss(settingsSheet)
        openMyTvSeriesRestartSheet(current, number)
      }
      $('#myTvSeasonDelete').onclick = async () => {
        if (!confirm(`Move every episode in Series ${number} of “${current.title}” to the recycle bin?`)) return
        portalSheets.dismiss(settingsSheet)
        closeMyTvSeasonSheet(false)
        try {
          await manage('trash-my-tv-series', {
            series: current.id, scope: 'season', season: number,
          })
        } catch (error) { showError(error) }
      }
      const dialog = $('#myTvSeasonSheet')
      portalSheets.open(dialog, { returnTo })
      if (targetPath) requestAnimationFrame(() => root.querySelector('.is-next')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    }

    function openMyTvSeriesSheet(series, returnTo = null) {
      const current = library?.my_tv_series?.find(value => value.id === series.id) || series
      selectedMyTvSeries = { series: current, returnTo }
      const syncSeriesHeader = () => {
        current.watched_count = (current.episodes || []).filter(episode => episode.watched).length
        renderMyTvSeriesHeaderFacts($('#myTvSeriesSheetMeta'), [
          { label: 'Series', value: String(current.season_count) },
          { label: 'Episodes', value: String(current.episode_count) },
          { label: 'Watched', value: String(current.watched_count) },
        ])
        const next = nextLocalEpisodeAfterProgress(current.episodes,
          episode => episode.watched === true)
        const nextButton = $('#myTvSeriesNextEpisode')
        nextButton.classList.toggle('hidden', !next)
        if (next) {
          nextButton.querySelector('small').textContent = 'Next episode'
          nextButton.querySelector('strong').textContent = `Series ${next.season}, Episode ${next.episode} · ${next.display_name}`
          nextButton.onclick = () => {
            portalSheets.suspend($('#myTvSeriesSheet'), { card: true })
            openMyTvSeasonSheet(current, next.season,
              () => openMyTvSeriesSheet(current, returnTo), next.path)
          }
        }
      }
      $('#myTvSeriesSheetTitle').textContent = current.title
      syncSeriesHeader()
      $('#myTvSeriesOverview').textContent = current.metadata?.overview
        || 'Choose an episode, or match this series with TMDB to add descriptions and artwork.'
      $('#myTvSeriesSheetPoster').replaceChildren(myTvSeriesArtwork(
        current, 'my-tv-series-sheet-art'))
      const favourite = $('#myTvSeriesFavourite')
      favourite.classList.toggle('active', current.favourite === true)
      favourite.setAttribute('aria-label', current.favourite
        ? 'Remove series from favourites' : 'Add series to favourites')
      favourite.onclick = () => setMyTvSeriesFavourite(current, current.favourite !== true)
        .then(() => {
          favourite.classList.toggle('active', current.favourite === true)
          favourite.setAttribute('aria-label', current.favourite
            ? 'Remove series from favourites' : 'Add series to favourites')
        }).catch(showError)
      const tmdbId = Number(current.metadata?.tmdb_id || 0)
      if (tmdbId) {
        const syncWatching = () => syncSeriesHeader()
        void wireLocalSeriesViewingActions($('#myTvSeriesIntents'), current, syncWatching)
          .catch(showError)
        renderMyTvPersonalRating($('#myTvSeriesPersonalRating'), localSeriesViewingDetail(current))
      } else {
        $('#myTvSeriesIntents').classList.add('hidden')
        $('#myTvSeriesPersonalRating').classList.add('hidden')
      }
      const root = $('#myTvSeriesEpisodes')
      root.innerHTML = ''
      const groups = new Map()
      ;(current.seasons || []).forEach(season => groups.set(Number(season), []))
      ;(current.episodes || []).forEach(episode => {
        if (!groups.has(episode.season)) groups.set(episode.season, [])
        groups.get(episode.season).push(episode)
      })
      $('#myTvSeriesSeasonCount').textContent = `${groups.size} series`
      ;[...groups.entries()].sort((left, right) => left[0] - right[0]).forEach(([season, episodes]) => {
        const card = document.createElement('article')
        card.className = 'my-tv-season-card'
        card.tabIndex = 0
        card.setAttribute('role', 'button')
        const art = myTvSeasonArtwork(current, episodes)
        const shade = document.createElement('span')
        shade.className = 'my-tv-season-card-shade'
        const copy = document.createElement('span')
        copy.className = 'my-tv-season-card-copy'
        const kicker = document.createElement('span')
        kicker.textContent = `${current.title} · ${episodes.length} episode${episodes.length === 1 ? '' : 's'}`
        const heading = document.createElement('strong')
        heading.textContent = `Series ${season}`
        const detail = document.createElement('small')
        const watched = episodes.filter(episode => episode.watched).length
        detail.textContent = watched ? `${watched} watched · Open series` : 'Open series'
        copy.append(kicker, heading, detail)
        const progress = document.createElement('span')
        progress.className = 'my-tv-season-card-progress'
        progress.style.setProperty('--season-progress', `${episodes.length ? watched / episodes.length * 100 : 0}%`)
        const openSeason = () => {
          portalSheets.suspend($('#myTvSeriesSheet'), { card: true })
          openMyTvSeasonSheet(current, season, () => openMyTvSeriesSheet(current, returnTo))
        }
        card.onclick = openSeason
        card.onkeydown = event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSeason() }
        }
        const status = document.createElement('button')
        status.type = 'button'
        wireMyTvSeasonBulkButton(status, `Series ${season}`, watched, episodes.length,
          async targetWatched => {
            const result = await api('/api/my-tv/series/watched', { method: 'POST', body: JSON.stringify({
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
            renderMyTvWatch()
            renderHomeLibrary()
            return count
          }, true)
        card.append(art, shade, copy, progress,
          librarySignalIcon('signal-chevron-right', 'icon my-tv-season-card-chevron'), status)
        root.append(card)
      })
      const nextSeries = Math.max(0, ...[...groups.keys()].map(Number)) + 1
      const addCard = document.createElement('button')
      addCard.type = 'button'
      addCard.className = 'my-tv-season-add-card'
      addCard.append(librarySignalIcon('signal-plus'), document.createElement('span'))
      addCard.querySelector('span').innerHTML = `<strong>Create Series ${nextSeries}</strong><small>Make it available for uploads and USB</small>`
      addCard.onclick = async () => {
        addCard.disabled = true
        try {
          await api('/api/manage', { method: 'POST', body: JSON.stringify({
            action: 'create-my-tv-season', series: current.id, season: nextSeries,
          }) })
          await reloadLibraryWithoutLosingPlace()
          const refreshed = library?.my_tv_series?.find(value => value.id === current.id)
          if (!refreshed) throw new Error('The series was created, but the show could not be reopened')
          portalSheets.suspend($('#myTvSeriesSheet'), { card: true })
          openMyTvSeasonSheet(refreshed, nextSeries,
            () => openMyTvSeriesSheet(refreshed, returnTo))
        } catch (error) {
          showError(error)
          addCard.disabled = false
        }
      }
      root.append(addCard)
      $('#myTvSeriesMore').onclick = () => {
        closeMyTvSeriesSheet(false)
        openMyTvSeriesMoreSheet(current, returnTo)
      }
      const dialog = $('#myTvSeriesSheet')
      portalSheets.open(dialog, { returnTo })
    }

    async function scanMyTvSeriesTmdb(series, returnTo = null) {
      try {
        const result = await api('/api/tmdb/my-tv-series/search', {
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
              await api('/api/tmdb/my-tv-series/apply', { method: 'POST', body: JSON.stringify({
                series: series.id, tmdb_id: match.id,
              }) })
              portalSheets.dismiss($('#tmdbDialog'))
              await reloadLibraryWithoutLosingPlace()
            } catch (error) { showError(error); choose.disabled = false }
          }
          row.append(poster, copy, choose)
          root.append(row)
        })
        portalSheets.open($('#tmdbDialog'), { returnTo })
        notice('')
      } catch (error) { showError(error) }
    }
