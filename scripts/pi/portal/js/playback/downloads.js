'use strict'

    function downloadCardHeader(iconName, title, status, statusClass = '') {
      const head = document.createElement('div')
      head.className = 'download-card-head'
      const icon = document.createElement('span')
      icon.className = 'download-card-icon'
      icon.append(portalIcon(iconName))
      const copy = document.createElement('span')
      copy.className = 'download-card-copy'
      const heading = document.createElement('strong')
      heading.textContent = title
      const detail = document.createElement('small')
      if (statusClass) detail.className = statusClass
      detail.textContent = status
      copy.append(heading, detail)
      head.append(icon, copy)
      return head
    }

    async function renderDownloads() {
      const root = $('#downloadsGrid')
      $('#offlineModeBanner').classList.toggle('hidden', navigator.onLine && !offlineMode)
      if (!offlineStorageReady || !window.MabelOffline) {
        root.innerHTML = offlineSetupMarkup()
        $('#downloadsStorage').textContent = 'Setup needed'
        return
      }
      let downloads = []
      try { downloads = await window.MabelOffline.listDownloads() }
      catch (error) {
        root.replaceChildren(portalEmptyState({
          className: 'downloads-empty',
          title: 'Downloads could not be opened',
          message: error.message,
        }))
        return
      }
      if (navigator.storage?.estimate) {
        try {
          const estimate = await navigator.storage.estimate()
          $('#downloadsStorage').textContent = `${window.MabelOffline.formatBytes(estimate.usage || 0)} used on this device`
        } catch (_) { $('#downloadsStorage').textContent = `${downloads.length} saved` }
      } else $('#downloadsStorage').textContent = `${downloads.length} saved`
      root.innerHTML = ''
      const completedIds = new Set(downloads.map(item => item.id))
      pendingDownloads.forEach((pending, key) => {
        if (pending.manifest?.id && completedIds.has(pending.manifest.id)) return
        const card = document.createElement('article')
        card.className = 'download-card'
        const bad = pending.phase === 'error'
        card.append(downloadCardHeader(
          'signal-download',
          pending.title,
          pending.message || 'Preparing download…',
          bad ? 'bad' : 'download-preparing',
        ))
        if (!bad) {
          const progress = document.createElement('progress')
          progress.removeAttribute('value')
          card.append(progress)
        } else {
          const actions = document.createElement('div'); actions.className = 'download-card-actions'
          const dismiss = portalButton({
            text: 'Dismiss',
            className: 'secondary',
            onClick: () => { pendingDownloads.delete(key); renderDownloads().catch(() => {}) },
          })
          actions.append(dismiss); card.append(actions)
        }
        root.append(card)
      })
      downloads.forEach(manifest => {
        const card = document.createElement('article')
        card.className = 'download-card'
        const complete = manifest.status === 'complete'
        const active = window.MabelOffline.activeDownloads.has(manifest.id)
        const percent = manifest.size ? Math.min(100, Math.round(Number(manifest.downloadedBytes || 0) / manifest.size * 100)) : 0
        const status = complete ? `Ready offline · ${window.MabelOffline.formatBytes(manifest.size)}`
          : active ? `Downloading · ${percent}%`
            : `Paused · ${percent}%${manifest.error ? ` · ${manifest.error}` : ''}`
        card.append(downloadCardHeader(complete ? 'signal-play' : 'signal-download', manifest.title, status))
        if (!complete) {
          const progress = document.createElement('progress'); progress.max = 100; progress.value = percent; card.append(progress)
        }
        const actions = document.createElement('div'); actions.className = 'download-card-actions'
        if (complete) {
          const play = portalButton({
            text: 'Watch offline',
            onClick: () => startOfflinePlayer(manifest).catch(showError),
          })
          actions.append(play)
        } else if (active) {
          const pause = portalButton({
            text: 'Pause',
            className: 'secondary',
            onClick: () => window.MabelOffline.pauseDownload(manifest.id),
          })
          actions.append(pause)
        } else {
          const resume = portalButton({
            text: navigator.onLine ? 'Resume' : 'Reconnect to resume',
            disabled: !navigator.onLine,
            onClick: () => downloadToDevice(manifest.source, manifest.title),
          })
          actions.append(resume)
        }
        const remove = portalButton({
          text: 'Remove',
          className: 'secondary download-remove',
          onClick: async () => {
            if (!confirm(`Remove “${manifest.title}” from this device? The copy on the Pi or USB drive will not be changed.`)) return
            await window.MabelOffline.removeDownload(manifest.id)
            await renderDownloads()
          },
        })
        actions.append(remove); card.append(actions); root.append(card)
      })
      if (!root.children.length) root.append(portalEmptyState({
        className: 'downloads-empty',
        title: 'No downloads yet',
        message: 'Choose Download to this device on a film, programme, or USB video.',
      }))
    }

    function mabelSearchCard(entry) {
      const film = entry.film
      const metadata = film.metadata || {}
      const resumable = watchFilmResumable(film)
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'watch-card watch-mabel-film-card'
      card.setAttribute('aria-label', `${watchFilmTitle(film)} from ${entry.channel.name}${resumable ? `, resume at ${watchTimeLabel(film.remote_position)}` : ''}`)
      const art = document.createElement('span')
      art.className = 'watch-card-art'
      art.append(filmEntryPoster(entry))
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
      detail.textContent = resumable
        ? `Resume · ${watchTimeLabel(film.remote_position)}`
        : [metadata.year, entry.channel.name].filter(Boolean).join(' · ') || 'Film'
      copy.append(title, detail)
      card.append(art, copy)
      card.onclick = () => openFilmEntry(entry)
      return card
    }

    function renderMabelDiscovery(entries) {
      const input = $('#watchMabelSearch')
      if (!input) return
      const sorted = [...entries].sort((left, right) => filmSortTitle(left.film)
        .localeCompare(filmSortTitle(right.film), undefined, { sensitivity: 'base' }))
      const query = mabelSearchText.trim().toLocaleLowerCase()
      input.value = mabelSearchText
      $('#watchMabelSearchClear').classList.toggle('hidden', !mabelSearchText)

      const continuing = sorted
        .filter(entry => watchFilmResumable(entry.film))
        .sort((left, right) => Number(right.film.remote_last_watched || 0) - Number(left.film.remote_last_watched || 0))
        .slice(0, 10)
      $('#watchMabelContinueSection').classList.toggle(
        'hidden', !continuing.length || Boolean(query))
      $('#watchMabelContinueCount').textContent = continuing.length
        ? `${continuing.length} in progress` : ''
      const continueRail = $('#watchMabelContinueRail')
      continueRail.innerHTML = ''
      continuing.forEach(entry => continueRail.append(continueWatchCard(entry)))

      const matches = query
        ? sorted.filter(entry => filmEntrySearchText(entry).includes(query)) : []
      $('#watchMabelSearchSection').classList.toggle('hidden', !query)
      $('#watchMabelSearchTitle').textContent = query
        ? `“${mabelSearchText.trim()}”` : 'Search results'
      $('#watchMabelSearchCount').textContent = query
        ? `${matches.length} film${matches.length === 1 ? '' : 's'}` : ''
      const grid = $('#watchMabelSearchGrid')
      grid.innerHTML = ''
      matches.forEach(entry => grid.append(mabelSearchCard(entry)))
      if (query && !matches.length) {
        const empty = document.createElement('div')
        empty.className = 'watch-empty'
        empty.innerHTML = '<strong>No matching films</strong><br>Try another title.'
        grid.append(empty)
      }
      $('#remoteMabel').classList.toggle('hidden', Boolean(query))
    }

    function addMabelEpisodeRailCue(section, rail) {
      const cue = document.createElement('span')
      cue.className = 'watch-episode-scroll-cue'
      cue.setAttribute('aria-hidden', 'true')
      const thumb = document.createElement('span')
      cue.append(thumb)
      const update = () => {
        const viewport = Math.max(1, rail.clientWidth)
        const total = Math.max(viewport, rail.scrollWidth)
        const width = Math.max(18, viewport / total * 100)
        const available = 100 - width
        const travelled = Math.max(1, total - viewport)
        thumb.style.width = `${width}%`
        thumb.style.transform = `translateX(${available * rail.scrollLeft / travelled}%)`
        cue.classList.toggle('hidden', total <= viewport + 2)
      }
      rail.addEventListener('scroll', update, { passive: true })
      section.append(cue)
      requestAnimationFrame(update)
    }
