'use strict'

    const downloadsPreferences = new Map()
    let downloadsRenderSerial = 0
    let downloadMenuManifest = null
    let downloadUnlockResolve = null
    portalSheets.wire($('#downloadOptionsSheet'), {
      closeButton: $('#downloadOptionsClose'),
      close: () => portalSheets.close($('#downloadOptionsSheet')),
      backdropClose: () => portalSheets.close($('#downloadOptionsSheet')),
      cancel: () => portalSheets.close($('#downloadOptionsSheet')),
      onClose: () => { downloadMenuManifest = null },
    })

    portalSheets.wire($('#downloadUnlockSheet'), {
      closeButton: $('#downloadUnlockClose'),
      onClose: () => {
        $('#downloadUnlockPin').value = ''
        const resolve = downloadUnlockResolve; downloadUnlockResolve = null; resolve?.(false)
      },
    })

    async function unlockOfflineDownloads() {
      if (downloadUnlockResolve) return false
      const sheet = $('#downloadUnlockSheet'), input = $('#downloadUnlockPin'), error = $('#downloadUnlockError'), submit = $('#downloadUnlockSubmit')
      input.value = ''; input.disabled = false; submit.disabled = false; error.classList.add('hidden')
      return new Promise(resolve => {
        downloadUnlockResolve = resolve
        $('#downloadUnlockForm').onsubmit = async event => {
          event.preventDefault(); input.disabled = true; submit.disabled = true; error.classList.add('hidden')
          try {
            await window.MabelOffline.verifyPin(input.value)
            if (downloadUnlockResolve !== resolve || !sheet.open) { setOfflineProtectedAccess(false); return }
            setOfflineProtectedAccess(true)
            downloadUnlockResolve = null; resolve(true); portalSheets.close(sheet)
          } catch (failure) {
            if (!sheet.open) return
            error.textContent = failure.message; error.classList.remove('hidden'); input.value = ''
          } finally { input.disabled = false; submit.disabled = false; if (sheet.open) input.focus() }
        }
        portalSheets.open(sheet, { focus: input })
      })
    }

    new MutationObserver(() => {
      if ($('#app').classList.contains('hidden')) {
        portalSheets.close($('#downloadOptionsSheet')); portalSheets.close($('#downloadUnlockSheet'))
      }
    }).observe($('#app'), { attributes: true, attributeFilter: ['class'] })

    function downloadBelongsHere(value, domain = downloadDomain) {
      const source = value?.source || value?.manifest?.source || {}
      const privateMedia = ['my_tv', 'my-tv-series'].includes(source.kind)
        || value?.protected === true || value?.manifest?.protected === true
      return domain === 'my_tv' ? privateMedia : !privateMedia
    }

    function downloadPreferences() {
      if (!downloadsPreferences.has(downloadDomain)) downloadsPreferences.set(downloadDomain, { query: '', filter: 'all' })
      return downloadsPreferences.get(downloadDomain)
    }

    function downloadKind(manifest) {
      const source = manifest.source || {}
      if (source.kind === 'my-tv-series') return { label: 'My TV episode', icon: 'signal-tv' }
      if (source.kind === 'my_tv') return { label: 'My TV film', icon: 'signal-film' }
      if (source.kind === 'usb') return { label: 'USB video', icon: 'signal-hard-drive' }
      const channel = library?.channels?.find(item => Number(item.number) === Number(source.channel))
      return { label: channel?.name || tvName() + ' programme', icon: 'signal-tv' }
    }

    function downloadState(manifest) {
      const active = window.MabelOffline.activeDownloads.has(manifest.id)
      const complete = manifest.status === 'complete'
      const failed = !complete && !active && Boolean(manifest.error && manifest.error !== 'Download paused')
      const percent = manifest.size ? Math.min(100, Math.round(Number(manifest.downloadedBytes || 0) / manifest.size * 100)) : 0
      return { active, complete, failed, percent, label: complete ? 'Ready offline' : active ? 'Downloading' : failed ? 'Needs attention' : 'Paused',
        style: complete ? 'ready' : active ? 'active' : failed ? 'error' : 'paused' }
    }

    function downloadPrimaryAction(manifest, inMenu = false) {
      const state = downloadState(manifest)
      return portalButton({
        className: 'download-primary' + (state.active ? ' is-secondary' : ''),
        text: state.complete ? 'Watch offline' : state.active ? 'Pause' : state.failed ? 'Retry download' : 'Resume',
        iconName: state.complete ? 'signal-play' : state.active ? 'signal-pause' : 'signal-download',
        disabled: !state.complete && !state.active && !navigator.onLine,
        onClick: async () => {
          if (inMenu) portalSheets.close($('#downloadOptionsSheet'))
          if (state.complete) await startOfflinePlayer(manifest).catch(showError)
          else if (state.active) { window.MabelOffline.pauseDownload(manifest.id); await renderDownloads() }
          else await downloadToDevice(manifest.source, manifest.title)
        },
      })
    }

    function downloadCard(manifest) {
      const state = downloadState(manifest), kind = downloadKind(manifest)
      const card = document.createElement('article')
      card.className = 'download-card is-' + state.style
      card.dataset.downloadId = manifest.id
      const cover = document.createElement('div'); cover.className = 'download-cover'
      cover.setAttribute('aria-hidden', 'true'); cover.append(portalIcon(kind.icon))
      const copy = document.createElement('div'); copy.className = 'download-card-copy'
      const heading = document.createElement('h4'); heading.textContent = manifest.title
      const meta = document.createElement('p'); meta.className = 'download-meta'
      meta.textContent = [kind.label, window.MabelOffline.formatBytes(state.complete ? manifest.size : manifest.downloadedBytes || 0)].join(' · ')
      const badge = document.createElement('span'); badge.className = 'download-status is-' + state.style
      badge.append(portalIcon(state.complete ? 'signal-check' : state.active ? 'signal-download' : 'signal-pause'))
      badge.append(document.createTextNode(state.label))
      copy.append(heading, meta, badge)
      const actions = document.createElement('div'); actions.className = 'download-card-actions'
      actions.append(downloadPrimaryAction(manifest), portalButton({ iconName: 'signal-ellipsis', className: 'download-more',
        ariaLabel: 'Download options for ' + manifest.title, onClick: () => openDownloadOptions(manifest) }))
      card.append(cover, copy)
      if (!state.complete) {
        const detail = document.createElement('div'); detail.className = 'download-progress-detail'
        const progress = document.createElement('progress'); progress.max = 100; progress.value = state.percent
        progress.setAttribute('aria-label', manifest.title + ' download progress')
        const text = document.createElement('span'); text.textContent = state.percent + '% · ' + window.MabelOffline.formatBytes(manifest.downloadedBytes || 0) + ' of ' + window.MabelOffline.formatBytes(manifest.size)
        detail.append(progress, text)
        if (state.failed) { const error = document.createElement('p'); error.className = 'download-error'; error.textContent = manifest.error; detail.append(error) }
        if (!navigator.onLine && !state.active) { const hint = document.createElement('p'); hint.textContent = 'Reconnect to resume this download.'; detail.append(hint) }
        card.append(detail)
      }
      card.append(actions)
      return card
    }

    function openDownloadOptions(manifest) {
      downloadMenuManifest = manifest
      const sheet = $('#downloadOptionsSheet'), content = $('#downloadOptionsContent')
      $('#downloadOptionsTitle').textContent = manifest.title
      $('#downloadOptionsEyebrow').textContent = 'Saved on this device'
      const state = downloadState(manifest), kind = downloadKind(manifest)
      const summary = document.createElement('div'); summary.className = 'download-menu-summary'
      const symbol = document.createElement('span'); symbol.className = 'download-cover'; symbol.append(portalIcon(kind.icon))
      const copy = document.createElement('p')
      copy.textContent = [kind.label, state.label, window.MabelOffline.formatBytes(state.complete ? manifest.size : manifest.downloadedBytes || 0)].join(' · ')
      summary.append(symbol, copy)
      const message = document.createElement('p'); message.className = 'download-menu-note'
      message.textContent = state.complete ? 'Watch this copy without an internet connection.' : 'Your saved progress is kept when you pause. Reconnect to finish downloading.'
      content.replaceChildren(summary, message, downloadPrimaryAction(manifest, true), portalButton({
        text: 'Remove from this device', iconName: 'signal-trash', className: 'download-delete', onClick: () => confirmDownloadRemoval(manifest),
      }))
      $('#downloadOptionsClose').onclick = () => portalSheets.close(sheet)
      portalSheets.open(sheet, { focus: $('#downloadOptionsClose') })
    }

    function confirmDownloadRemoval(manifest) {
      $('#downloadOptionsTitle').textContent = 'Remove this download?'
      $('#downloadOptionsEyebrow').textContent = 'Free up device storage'
      const message = document.createElement('p'); message.className = 'download-menu-note'
      message.textContent = '“' + manifest.title + '” will be removed from this device. The copy in your TV library or on your USB drive stays safe. You can download it again when connected.'
      const keep = portalButton({ text: 'Keep download', className: 'download-primary is-secondary', onClick: () => openDownloadOptions(manifest) })
      const remove = portalButton({ text: 'Remove from this device', iconName: 'signal-trash', className: 'download-delete is-confirm', onClick: async () => {
        remove.disabled = true; keep.disabled = true
        try {
          await window.MabelOffline.removeDownload(manifest.id)
          portalSheets.close($('#downloadOptionsSheet')); downloadMenuManifest = null
          await renderDownloads(); notice('Download removed from this device.')
        } catch (error) { remove.disabled = false; keep.disabled = false; showError(error) }
      } })
      $('#downloadOptionsContent').replaceChildren(message, keep, remove)
      keep.focus({ preventScroll: true })
    }

    function downloadPendingCard(pending, key) {
      const card = document.createElement('article'); card.className = 'download-card download-pending' + (pending.phase === 'error' ? ' is-error' : '')
      const cover = document.createElement('div'); cover.className = 'download-cover'; cover.append(portalIcon('signal-download'))
      const copy = document.createElement('div'); copy.className = 'download-card-copy'
      const title = document.createElement('h4'); title.textContent = pending.title
      const message = document.createElement('p'); message.className = 'download-meta'; message.textContent = pending.message || 'Preparing for this device…'
      copy.append(title, message); card.append(cover, copy)
      if (pending.phase !== 'error') {
        const progress = document.createElement('progress'); progress.setAttribute('aria-label', pending.title + ' preparation progress'); card.append(progress)
      } else {
        const actions = document.createElement('div'); actions.className = 'download-card-actions'
        actions.append(portalButton({ text: 'Retry', iconName: 'signal-download', className: 'download-primary', disabled: !navigator.onLine,
          onClick: () => downloadToDevice(pending.source, pending.title) }), portalButton({ text: 'Dismiss', className: 'download-dismiss',
          onClick: () => { pendingDownloads.delete(key); renderDownloads().catch(showError) } }))
        card.append(actions)
      }
      return card
    }

    function downloadSection(title, cards, description) {
      const section = document.createElement('section'); section.className = 'downloads-section'
      const heading = document.createElement('header'); heading.className = 'downloads-section-head'
      const label = document.createElement('h3'); label.textContent = title
      const count = document.createElement('span'); count.textContent = cards.length
      heading.append(label, count)
      const descriptionNode = document.createElement('p'); descriptionNode.className = 'downloads-section-note'; descriptionNode.textContent = description
      const grid = document.createElement('div'); grid.className = 'downloads-card-list'; grid.append(...cards)
      section.append(heading, descriptionNode, grid)
      return section
    }

    async function renderDownloads() {
      const serial = ++downloadsRenderSerial, domain = downloadDomain, preferences = downloadPreferences()
      const current = () => serial === downloadsRenderSerial && domain === downloadDomain
      const target = $('#downloadsGrid'), root = document.createElement('div')
      $('#offlineModeBanner').classList.toggle('hidden', navigator.onLine && !offlineMode)
      $('#downloadsDomainLabel').textContent = domain === 'my_tv' ? 'My TV downloads' : tvName() + ' downloads'
      const search = $('#downloadsSearch'); search.value = preferences.query
      search.oninput = () => { preferences.query = search.value; renderDownloads().catch(showError) }
      $$('#downloadsFilters button').forEach(button => {
        button.classList.toggle('active', button.dataset.downloadFilter === preferences.filter)
        button.setAttribute('aria-pressed', String(button.dataset.downloadFilter === preferences.filter))
        button.onclick = () => { preferences.filter = button.dataset.downloadFilter; renderDownloads().catch(showError) }
      })
      if (!offlineStorageReady && window.MabelOffline) {
        try { await window.MabelOffline.initialise(); offlineStorageReady = true }
        catch (error) { offlineStorageError = error?.message || 'Offline storage could not start' }
      }
      if (!current()) return
      if (!offlineStorageReady || !window.MabelOffline) {
        root.innerHTML = offlineSetupMarkup(); target.replaceChildren(...root.childNodes)
        $('#downloadsStorage').textContent = 'Device storage unavailable'; $('#downloadsSummary').textContent = 'Set up offline downloads to save your favourites.'
        $('#downloadsTools').classList.add('hidden'); return
      }
      if (domain === 'my_tv' && !offlineProtectedAccess) {
        portalSheets.close($('#downloadOptionsSheet'))
        $('#downloadsTools').classList.add('hidden'); $('#downloadsStorage').textContent = 'Private device storage'
        $('#downloadsSummary').textContent = 'Unlock to see your saved My TV downloads.'
        const locked = portalEmptyState({ className: 'downloads-empty', title: 'Your My TV downloads are locked', message: 'Use your parent PIN to open your private offline library.' })
        const icon = document.createElement('span'); icon.className = 'downloads-empty-icon'; icon.append(portalIcon('signal-lock')); locked.prepend(icon)
        locked.append(portalButton({ text: 'Unlock downloads', className: 'download-primary', iconName: 'signal-lock', onClick: async () => {
          if (await authoriseOfflineDownload({ protected: true })) await renderDownloads()
        } }))
        target.replaceChildren(locked); return
      }
      let downloads
      try { downloads = await window.MabelOffline.listDownloads() }
      catch (error) {
        if (!current()) return
        target.replaceChildren(portalEmptyState({ className: 'downloads-empty', title: 'Downloads could not be opened', message: error.message }))
        $('#downloadsStorage').textContent = 'Storage unavailable'; return
      }
      if (!current()) return
      // Do not keep a private title open after its domain changes.
      if (downloadMenuManifest && !downloadBelongsHere(downloadMenuManifest, domain)) {
        portalSheets.close($('#downloadOptionsSheet')); downloadMenuManifest = null
      }
      downloads = downloads.filter(item => downloadBelongsHere(item, domain)).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      const ids = new Set(downloads.map(item => item.id))
      const pending = [...pendingDownloads.entries()].filter(([, item]) => downloadBelongsHere(item, domain) && !ids.has(item.manifest?.id))
      const ready = downloads.filter(item => item.status === 'complete')
      const inProgress = downloads.length - ready.length + pending.length
      const bytes = downloads.reduce((total, item) => total + Number(item.downloadedBytes || (item.status === 'complete' ? item.size : 0) || 0), 0)
      $('#downloadsStorage').textContent = window.MabelOffline.formatBytes(bytes) + ' saved on this device'
      $('#downloadsSummary').textContent = ready.length + ' ready offline' + (inProgress ? ' · ' + inProgress + ' in progress' : '')
      $('#downloadsTools').classList.toggle('hidden', !downloads.length && !pending.length)
      $$('#downloadsFilters button').forEach(button => {
        const counts = { all: downloads.length + pending.length, ready: ready.length, progress: inProgress }
        button.querySelector('span').textContent = counts[button.dataset.downloadFilter]
      })
      const query = preferences.query.trim().toLocaleLowerCase(), match = item => !query || String(item.title || '').toLocaleLowerCase().includes(query)
      const progressCards = preferences.filter === 'ready' ? [] : [...pending.filter(([, item]) => match(item)).map(([key, item]) => downloadPendingCard(item, key)), ...downloads.filter(item => item.status !== 'complete' && match(item)).map(downloadCard)]
      const readyCards = preferences.filter === 'progress' ? [] : ready.filter(match).map(downloadCard)
      if (progressCards.length) root.append(downloadSection('In progress', progressCards, 'Keep the app open while downloading. You can pause and resume.'))
      if (readyCards.length) root.append(downloadSection('Ready to watch', readyCards, 'Saved here. No connection needed.'))
      if (!root.children.length) {
        const empty = portalEmptyState({ className: 'downloads-empty', title: downloads.length || pending.length ? 'No matching downloads' : 'Your next watch, ready to go.',
          message: downloads.length || pending.length ? 'Try another title or choose All to see your saved downloads.' : domain === 'my_tv' ? 'Save a My TV film or episode, then watch it here wherever you are.' : 'Save a programme or USB video, then take a little ' + tvName() + ' with you.' })
        const icon = document.createElement('span'); icon.className = 'downloads-empty-icon'; icon.append(portalIcon('signal-download')); empty.prepend(icon)
        empty.append(portalButton({ text: downloads.length || pending.length ? 'Show all downloads' : 'Browse library', className: 'download-primary',
          onClick: () => { if (downloads.length || pending.length) { preferences.query = ''; preferences.filter = 'all'; renderDownloads().catch(showError) } else navigateDomainRoute(domain, 'watch') } }))
        root.append(empty)
      }
      preservePortalPosition(() => target.replaceChildren(...root.childNodes))
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
      return preservePortalPosition(() => renderMabelDiscoveryContents(entries))
    }

    function renderMabelDiscoveryContents(entries) {
      const input = $('#watchMabelSearch')
      if (!input) return
      const sorted = [...entries].sort((left, right) => filmSortTitle(left.film)
        .localeCompare(filmSortTitle(right.film), undefined, { sensitivity: 'base' }))
      const query = mabelSearchText.trim().toLocaleLowerCase()
      input.value = mabelSearchText
      $('#watchMabelSearchClear').classList.toggle('hidden', !mabelSearchText)

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
