'use strict'

    let mabelQueue = null
    let mabelQueueLoading = null

    function mabelQueueArtwork(item) {
      const art = document.createElement('span')
      art.className = 'home-poster-art mabel-queue-art'
      if (item.artwork) {
        const image = document.createElement('img')
        image.src = `/api/channel/artwork/${encodeURIComponent(item.artwork)}`
        image.alt = ''
        image.loading = 'lazy'
        art.append(image)
      } else {
        const initial = document.createElement('span')
        initial.className = 'watch-card-placeholder'
        initial.textContent = item.title.slice(0, 1).toUpperCase()
        art.append(initial)
      }
      return art
    }

    function mabelQueueRailCard(item, index) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'home-poster-card mabel-queue-rail-card'
      card.setAttribute('aria-label', `Open ${item.title}`)
      const art = mabelQueueArtwork(item)
      const rank = document.createElement('span')
      rank.className = 'mabel-queue-rank'
      rank.textContent = String(index + 1).padStart(2, '0')
      art.append(rank)
      if (item.playing || item.starting) {
        const badge = document.createElement('span')
        badge.className = 'mabel-queue-playing'
        badge.textContent = item.playing ? 'Playing' : 'Starting…'
        art.append(badge)
      }
      const copy = document.createElement('span')
      copy.className = 'home-poster-copy'
      const title = document.createElement('strong')
      title.textContent = item.title
      const source = document.createElement('small')
      const duration = mabelQueueDuration(item)
      source.textContent = duration > 0 ? watchTimeLabel(duration) : item.channel_name
      copy.append(title, source)
      card.append(art, copy)
      card.onclick = () => openMabelQueueItem(item)
      return card
    }

    function mabelQueueProgramme(item) {
      const channel = (library?.channels || []).find(value =>
        value.number === item.channel_number)
      const programme = channel?.programmes?.find(value =>
        value.name === item.file_name)
      return { channel, programme }
    }

    function mabelQueueDuration(item) {
      const { programme } = mabelQueueProgramme(item)
      return Number(programme?.remote_duration || 0)
        || Number(programme?.metadata?.runtime || 0) * 60
    }

    function openMabelQueueItem(item) {
      const { channel, programme } = mabelQueueProgramme(item)
      if (!programme) {
        showError(new Error('That programme is no longer in the TV library.'))
        return
      }
      openWatchProgrammeSheet(channel, programme, { queueId: item.id })
    }

    function mabelQueueSummary(items) {
      const count = `${items.length} programme${items.length === 1 ? '' : 's'}`
      if (!items.length) return 'Nothing queued yet'
      const durations = items.map(mabelQueueDuration)
      if (durations.some(value => !Number.isFinite(value) || value <= 0)) return count
      const minutes = Math.round(durations.reduce((sum, value) => sum + value, 0) / 300) * 5
      const hours = Math.floor(minutes / 60)
      const remainder = minutes % 60
      const time = hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${remainder}m`
      return `${count} · about ${time}`
    }

    function renderMabelQueueRails() {
      if (!mabelQueue) return
      const items = mabelQueue.items || []
      const summary = mabelQueueSummary(items)
      $('#homeMabelQueueCount').textContent = summary
      $('#watchMabelQueueCount').textContent = summary
      const empty = !items.length
      for (const selector of ['#homeMabelQueueEmpty', '#watchMabelQueueEmpty'])
        $(selector).classList.toggle('hidden', !empty)
      for (const selector of ['#homeMabelQueueRail', '#watchMabelQueueRail']) {
        const rail = $(selector)
        rail.classList.toggle('hidden', empty)
        rail.replaceChildren()
        items.forEach((item, index) => rail.append(mabelQueueRailCard(item, index)))
        if (empty) continue
        const ending = document.createElement('button')
        ending.type = 'button'
        ending.className = 'home-poster-card mabel-queue-rail-card mabel-queue-rail-ending'
        ending.innerHTML = '<span class="home-poster-art mabel-queue-ending-art" aria-hidden="true"><span>✓</span></span><span class="home-poster-copy"><strong>After the last one</strong><small></small></span>'
        ending.querySelector('small').textContent = mabelQueue.ending === 'keep_playing'
          ? 'Keep playing' : 'All done screen'
        ending.onclick = openMabelQueuePage
        rail.append(ending)
      }
    }

    function mabelQueueRow(item, index, count) {
      const row = document.createElement('div')
      row.className = 'mabel-queue-row'
      row.dataset.queueId = item.id
      const open = document.createElement('button')
      open.type = 'button'
      open.className = 'mabel-queue-row-open'
      open.setAttribute('aria-label', `Open ${item.title}`)
      open.onclick = () => openMabelQueueItem(item)
      const copy = document.createElement('span')
      copy.className = 'mabel-queue-row-copy'
      const number = document.createElement('small')
      number.className = 'mabel-queue-row-number'
      number.textContent = `${String(index + 1).padStart(2, '0')} · ${item.playing ? 'Playing' : item.starting ? 'Starting…' : index === 0 ? 'First up' : 'Then'}`
      const title = document.createElement('strong')
      title.textContent = item.title
      const channel = document.createElement('span')
      channel.textContent = item.channel_name
      const detail = document.createElement('span')
      const duration = mabelQueueDuration(item)
      detail.textContent = `${duration > 0 ? `${watchTimeLabel(duration)} · ` : ''}CH ${item.channel_number}`
      copy.append(number, title, channel, detail)
      const art = mabelQueueArtwork(item)
      if (item.playing || item.starting) {
        const badge = document.createElement('span')
        badge.className = 'mabel-queue-playing'
        badge.textContent = item.playing ? 'Playing' : 'Starting…'
        art.append(badge)
      }
      open.append(art, copy)
      const controls = document.createElement('div')
      controls.className = 'mabel-queue-row-controls'
      for (const [action, icon, disabled] of [
        ['up', 'signal-chevron-up', index === 0 || !!mabelQueue.items[index - 1]?.playing || !!mabelQueue.items[index - 1]?.starting],
        ['down', 'signal-chevron-down', index === count - 1],
      ]) {
        const button = document.createElement('button')
        button.type = 'button'
        button.disabled = disabled
        if (item.playing || item.starting) button.disabled = true
        button.setAttribute('aria-label', `Move ${item.title} ${action}`)
        button.append(portalIcon(icon))
        button.onclick = () => moveMabelQueueItem(item.id, action).catch(showError)
        controls.append(button)
      }
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'mabel-queue-row-remove'
      remove.setAttribute('aria-label', `Remove ${item.title} from Up Next`)
      remove.append(portalIcon('signal-x'))
      remove.disabled = item.playing || item.starting
      remove.onclick = () => confirmMabelQueueChange(
        `Remove “${item.title}”?`, 'This takes it out of Up Next. The film or episode stays in your library.',
        'Remove', 'remove', { id: item.id })
      row.append(open, controls, remove)
      return row
    }

    function renderMabelQueuePage() {
      if (!mabelQueue) return
      const items = mabelQueue.items || []
      const count = mabelQueueSummary(items)
      $('#mabelQueuePageCount').textContent = mabelQueue.active
        ? `${mabelQueue.current_title || 'A programme'} is playing · ${count}`
        : mabelQueue.error || (mabelQueue.paused ? `Queue paused · ${count}` : count)
      $('#mabelQueueStart strong').textContent = mabelQueue.paused ? 'Resume queue on TV' : 'Start queue on TV'
      $('#mabelQueueStart').disabled = !items.length || (mabelQueue.owner === 'tv' && mabelQueue.phase === 'playing' && !mabelQueue.paused)
      $('#mabelQueueClear').disabled = !items.length && !mabelQueue.active
      const list = $('#mabelQueueList')
      list.replaceChildren()
      items.forEach((item, index) => list.append(mabelQueueRow(item, index, items.length)))
      if (!items.length) {
        const empty = document.createElement('p')
        empty.className = 'mabel-queue-empty'
        empty.textContent = mabelQueue.active
          ? 'The last queued programme is playing now.'
          : 'Open an episode or film and choose Add to Up Next.'
        list.append(empty)
      }
      $('#mabelQueueAllDone').setAttribute('aria-pressed',
        String(mabelQueue.ending === 'all_done'))
      $('#mabelQueueKeepPlaying').setAttribute('aria-pressed',
        String(mabelQueue.ending === 'keep_playing'))
      $('#mabelQueueEndingHint').textContent = mabelQueue.ending === 'keep_playing'
        ? 'After the final item, this channel carries on naturally.'
        : 'A gentle message appears on the TV when the queue finishes.'
    }

    function renderMabelQueue() {
      renderMabelQueueRails()
      renderMabelQueuePage()
    }

    async function loadMabelQueue() {
      if (offlineMode) return
      if (mabelQueueLoading) return mabelQueueLoading
      mabelQueueLoading = api('/api/mabel-queue').then(value => {
        const changed = JSON.stringify(value) !== JSON.stringify(mabelQueue)
        mabelQueue = value
        if (changed) renderMabelQueue()
        checkMabelQueuePlayerOwnership()
        return value
      }).finally(() => { mabelQueueLoading = null })
      return mabelQueueLoading
    }

    async function changeMabelQueue(action, extra = {}) {
      const result = await api('/api/mabel-queue', {
        method: 'POST', body: JSON.stringify({ action, ...extra }),
      })
      if (action === 'start') await loadMabelQueue()
      else { mabelQueue = result; renderMabelQueue() }
      return result
    }

    async function moveMabelQueueItem(id, direction) {
      const positions = new Map([...document.querySelectorAll('.mabel-queue-row')]
        .map(row => [row.dataset.queueId, row.getBoundingClientRect().top]))
      await changeMabelQueue(direction, { id })
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
      for (const row of document.querySelectorAll('.mabel-queue-row')) {
        const previous = positions.get(row.dataset.queueId)
        if (previous === undefined) continue
        const offset = previous - row.getBoundingClientRect().top
        if (Math.abs(offset) > 1) row.animate([
          { transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' },
        ], { duration: 290, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    }

    function openMabelQueuePage() {
      history.pushState({ primaryView: 'watch' }, '', '#mabel-queue')
      openView('mabel-queue')
    }

    function confirmMabelQueueChange(title, message, actionLabel, action, extra = {}) {
      const dialog = $('#mabelQueueConfirm')
      $('#mabelQueueConfirmTitle').textContent = title
      $('#mabelQueueConfirmText').textContent = message
      $('#mabelQueueConfirmAccept').textContent = actionLabel
      $('#mabelQueueConfirmAccept').onclick = async () => {
        const button = $('#mabelQueueConfirmAccept')
        button.disabled = true
        try {
          await changeMabelQueue(action, extra)
          portalSheets.close(dialog)
        } catch (error) { showError(error) }
        finally { button.disabled = false }
      }
      portalSheets.open(dialog)
    }

    async function addToMabelQueue(channel, programme, trigger, close) {
      if (trigger.disabled) return
      trigger.disabled = true
      try {
        await changeMabelQueue('add', { channel: channel.number, file: programme.name })
        close()
        notice('Added to Up Next')
      } catch (error) { showError(error) }
      finally { trigger.disabled = false }
    }

    function bindMabelQueuePlayer(video, payload, result, start) {
      const stream = new URL(result.stream_url, location.origin).searchParams.get('stream')
      const binding = { id: payload.queue_id || '', stream, payload, start, started: false, ending: false }
      video._mabelQueue = binding
      video.onplaying = () => {
        if (!binding.id || binding.started) return
        binding.started = true
        binding.confirmed = api('/api/mabel-queue', { method: 'POST', body: JSON.stringify({ action: 'started',
          id: binding.id, stream }) }).then(value => { mabelQueue = value; renderMabelQueue() })
          .catch(error => { if (video._mabelQueue === binding) { video.pause(); showError(error) } })
      }
    }

    function checkMabelQueuePlayerOwnership() {
      for (const video of [$('#iosWatchVideo'), $('#mabelWatchVideo')]) {
        const binding = video?._mabelQueue
        if (binding?.id && binding.started && !binding.ending && mabelQueue
            && (mabelQueue.owner !== `device:${binding.stream}` || mabelQueue.current_id !== binding.id)) {
          video._mabelQueue = null
          video.pause()
          notice('Queue playback has moved to another player')
        }
      }
    }

    async function finishMabelQueueDevice(video) {
      const binding = video._mabelQueue
      if (!binding || binding.ending) return
      binding.ending = true
      try {
        if (binding.confirmed) await binding.confirmed
        const state = binding.id ? await api('/api/mabel-queue', { method: 'POST',
          body: JSON.stringify({ action: 'finish', id: binding.id, stream: binding.stream }) })
          : await api('/api/mabel-queue')
        mabelQueue = state; renderMabelQueue()
        if (state.paused) return
        const next = state.items?.[0]
        if (next && (!state.owner || state.owner === `device:${binding.stream}`)) {
          const { programme } = mabelQueueProgramme(next)
          if (!programme || programme.browser_ready === false)
            throw new Error('The next queued programme cannot play in this browser. Choose Play on TV instead.')
          await binding.start({ kind: 'channel', channel: next.channel_number, file: next.file_name,
            queue_id: next.id, queue_auto: true, queue_from_stream: binding.stream })
        } else if (binding.id && !state.items?.length && state.completed) {
          notice('All done — time to switch the telly off')
          video._mabelQueue = null
          if (video === $('#iosWatchVideo')) closeIosRemotePlayer()
          else closeMabelWatchPlayer()
        } else if (binding.id && !state.items?.length && state.ending === 'keep_playing') {
          const channel = library?.channels?.find(value => value.number === binding.payload.channel)
          const programmes = channel?.programmes?.filter(value => value.enabled !== false) || []
          const index = programmes.findIndex(value => value.name === binding.payload.file)
          const programme = programmes.length ? programmes[(index + 1) % programmes.length] : null
          if (programme?.browser_ready !== false && programme)
            await binding.start({ kind: 'channel', channel: channel.number, file: programme.name, position: 0 })
        }
      } catch (error) {
        if (binding.id) await api('/api/mabel-queue', { method: 'POST', body: JSON.stringify({
          action: 'failed', id: mabelQueue?.current_id || binding.id, stream: binding.stream,
          error: error.message }) }).catch(() => {})
        showError(error)
      }
    }

    function failMabelQueueDevice(video, message) {
      const binding = video._mabelQueue
      if (!binding?.id) return
      api('/api/mabel-queue', { method: 'POST', body: JSON.stringify({ action: 'failed',
        id: binding.id, stream: binding.stream, error: message }) }).then(loadMabelQueue).catch(() => {})
    }

    $('#homeMabelQueueOpen').onclick = openMabelQueuePage
    $('#watchMabelQueueOpen').onclick = openMabelQueuePage
    $('#homeMabelQueueEmpty').onclick = openMabelQueuePage
    $('#watchMabelQueueEmpty').onclick = openMabelQueuePage
    $('#mabelQueueBack').onclick = () => history.back()
    $('#mabelQueueBrowse').onclick = () => {
      history.pushState({}, '', '#watch')
      openRequestedView()
    }
    $('#mabelQueueStart').onclick = () => changeMabelQueue('start').catch(showError)
    $('#mabelQueueClear').onclick = () => confirmMabelQueueChange(
      'Clear the whole queue?', 'Every waiting programme will be removed from Up Next.',
      'Clear queue', 'clear')
    portalSheets.wire($('#mabelQueueConfirm'), {
      closeButton: $('#mabelQueueConfirmCancel'),
    })
    new ResizeObserver(entries => {
      const height = Math.ceil(entries[0].target.getBoundingClientRect().height)
      $('#view-mabel-queue').style.setProperty('--mabel-queue-header-height', `${height}px`)
    }).observe($('#mabelQueueFixedHead'))
    $('#mabelQueueAllDone').onclick = () => changeMabelQueue(
      'ending', { ending: 'all_done' }).catch(showError)
    $('#mabelQueueKeepPlaying').onclick = () => changeMabelQueue(
      'ending', { ending: 'keep_playing' }).catch(showError)
    setInterval(() => {
      const active = document.querySelector('.view.active')?.id
      if (!offlineMode && !document.hidden
          && ['view-overview', 'view-watch', 'view-mabel-queue'].includes(active)
          && (mabelQueue?.active || mabelQueue?.items?.length || active === 'view-mabel-queue'))
        loadMabelQueue().catch(() => {})
    }, 2500)
