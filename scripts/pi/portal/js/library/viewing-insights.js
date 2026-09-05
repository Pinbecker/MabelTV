'use strict'

    function viewingDuration(seconds) {
      const minutes = Math.max(0, Math.round(Number(seconds || 0) / 60))
      const hours = Math.floor(minutes / 60)
      const remainder = minutes % 60
      return hours ? `${hours}h ${remainder}m` : `${minutes}m`
    }

    function viewingDate(value) {
      if (!value) return 'Not watched yet'
      return new Intl.DateTimeFormat(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
      }).format(new Date(value))
    }

    function viewingArtworkUrl(value) {
      return value ? `/api/channel/artwork/${encodeURIComponent(value)}` : ''
    }

    function viewingCatalog() {
      const insightMap = new Map((viewingInsightsData?.items || []).map(item => [item.item_key, item]))
      const channels = []
      const films = []
      ;(library?.channels || []).forEach(channel => {
        const channelNumber = Number(channel.number)
        if (channel.content_type === 'films') {
          ;(channel.programmes || []).forEach(programme => {
            const itemKey = `channel:${channelNumber}:${String(programme.name || '').toLocaleLowerCase()}`
            const tracked = insightMap.get(itemKey) || {}
            films.push({
              ...viewingEmptyItem('film'), ...tracked, item_key: itemKey, kind: 'film',
              channel_number: channelNumber,
              title: programme.metadata?.title || programme.display_name || programme.name,
              source: channel.name,
              artwork: viewingArtworkUrl(programme.metadata?.poster),
            })
          })
        } else {
          const itemKey = `channel:${channelNumber}`
          channels.push({
            ...viewingEmptyItem('channel'), ...(insightMap.get(itemKey) || {}),
            item_key: itemKey, kind: 'channel', channel_number: channelNumber,
            title: channel.name, source: 'MabelTV series channel',
            artwork: viewingArtworkUrl(channel.metadata?.artwork),
          })
        }
      })
      const sort = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      return { channels: channels.sort(sort), films: films.sort(sort) }
    }

    function viewingEmptyItem(kind) {
      const named = names => names.map(name => ({ name, label: name, seconds: 0, sessions: 0 }))
      return {
        seconds: 0, sessions: 0, active_days: 0, average_session_seconds: 0,
        longest_session_seconds: 0, share: 0, busiest_period: 'Not watched yet',
        first_watched: '', last_watched: '', timeline: [],
        time_of_day: named(['Overnight', 'Morning', 'Afternoon', 'Evening']),
        hourly: Array.from({ length: 24 }, (_, hour) => ({
          name: String(hour), label: `${hour}:00`, seconds: 0, sessions: 0,
        })),
        weekdays: named(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
        by_surface: [], average_progress: 0, furthest_progress: 0,
        completion_sessions: 0, kind,
      }
    }

    function destroyViewingChart(root) {
      const chart = viewingCharts.get(root)
      if (chart) chart.destroy()
      viewingCharts.delete(root)
      root.replaceChildren()
    }

    function renderViewingChart(root, values, type = 'line', labels = {}) {
      if (!root) return
      destroyViewingChart(root)
      const usable = (values || []).map(item => ({
        ...item, chartLabel: labels[item.name] || item.label || item.name,
        minutes: Math.round(Number(item.seconds || 0) / 60),
      }))
      if (!usable.length || !usable.some(item => item.minutes > 0) || typeof Chart === 'undefined') {
        const empty = document.createElement('p')
        empty.className = 'viewing-empty viewing-chart-empty'
        empty.textContent = typeof Chart === 'undefined'
          ? 'The chart is temporarily unavailable.' : 'Viewing will appear here as it is watched.'
        root.append(empty)
        return
      }
      const canvas = document.createElement('canvas')
      root.append(canvas)
      const css = getComputedStyle(document.body)
      const orange = css.getPropertyValue('--experience-orange').trim() || '#ff7a1a'
      const muted = css.getPropertyValue('--experience-dim').trim() || '#8f8d98'
      const grid = css.getPropertyValue('--experience-line').trim() || 'rgba(255,255,255,.1)'
      const isDoughnut = type === 'doughnut'
      const config = {
        type,
        data: {
          labels: usable.map(item => item.chartLabel),
          datasets: [{
            data: usable.map(item => item.minutes),
            borderColor: orange,
            backgroundColor: isDoughnut
              ? [orange, '#7c4dff', '#45b8ff', '#55d6a5']
              : type === 'bar' ? orange : 'transparent',
            borderWidth: type === 'line' ? 2.5 : isDoughnut ? 0 : 1,
            borderRadius: type === 'bar' ? 7 : 0,
            borderSkipped: false,
            fill: false,
            tension: .32,
            pointRadius: type === 'line' ? 3 : 0,
            pointHoverRadius: 5,
            pointBackgroundColor: orange,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 320 },
          plugins: {
            legend: { display: isDoughnut, position: 'bottom', labels: { color: muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14, font: { size: 10 } } },
            tooltip: { callbacks: { label: context => `${context.label}: ${viewingDuration(Number(context.raw || 0) * 60)}` } },
          },
          scales: isDoughnut ? {} : {
            x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 9 } }, border: { display: false } },
            y: { beginAtZero: true, grid: { color: grid }, ticks: { color: muted, maxTicksLimit: 4, callback: value => viewingDuration(Number(value) * 60), font: { size: 9 } }, border: { display: false } },
          },
          cutout: isDoughnut ? '62%' : undefined,
        },
      }
      const chart = new Chart(canvas, config)
      viewingCharts.set(root, chart)
      root.setAttribute('aria-label', usable.map(item =>
        `${item.chartLabel} ${viewingDuration(item.seconds)}`).join(', '))
    }

    function setViewingArtwork(root, url) {
      root.classList.toggle('has-artwork', Boolean(url))
      root.style.backgroundImage = url ? `url("${url}")` : ''
    }

    function showViewingScreen(screen) {
      $$('.viewing-screen').forEach(root => root.classList.add('hidden'))
      screen?.classList.remove('hidden')
    }

    function pushInsightsRoute(path) {
      const parent = location.hash.startsWith('#insights') ? location.hash.slice(1) : 'insights'
      history.pushState({ insightsChild: true, insightsParent: parent }, '', `#${path}`)
      openInsightsRoute(path)
    }

    function replaceInsightsRoute(path) {
      history.replaceState({ ...history.state, insightsChild: true }, '', `#${path}`)
      openInsightsRoute(path)
    }

    function insightsParentRoute() {
      if (viewingInsightsRoute.screen === 'item') {
        return viewingItem(viewingInsightsRoute.itemKey)?.kind === 'film' ? 'insights/films' : 'insights/channels'
      }
      if (viewingInsightsRoute.screen === 'period') return 'insights/diary'
      return 'insights'
    }

    function navigateInsightsBack() {
      const target = insightsParentRoute()
      if (history.state?.insightsParent === target) history.back()
      else replaceInsightsRoute(target)
    }

    function openViewingItem(itemKey, tab = 'summary') {
      pushInsightsRoute(`insights/item/${encodeURIComponent(itemKey)}/${tab}`)
    }

    function viewingItem(itemKey) {
      const catalog = viewingCatalog()
      return [...catalog.channels, ...catalog.films].find(item => item.item_key === itemKey)
    }

    function renderViewingMosaic(root, items) {
      root.replaceChildren()
      items.filter(item => item.artwork).slice(0, 3).forEach(item => {
        const image = document.createElement('span')
        image.style.backgroundImage = `url("${item.artwork}")`
        root.append(image)
      })
      if (!root.children.length) root.append(librarySignalIcon('signal-film'))
    }

    function renderViewingHighlights() {
      const root = $('#viewingHighlights')
      root.replaceChildren()
      const catalog = viewingCatalog()
      const values = [...catalog.channels.filter(item => item.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 1),
        ...catalog.films.filter(item => item.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 2)]
      if (!values.length) {
        root.innerHTML = '<p class="viewing-empty">Highlights will appear after MabelTV has been watched.</p>'
        return
      }
      values.forEach(item => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `viewing-highlight ${item.kind}`
        if (item.artwork) button.style.backgroundImage = `linear-gradient(0deg, rgba(8,8,11,.96), rgba(8,8,11,.06) 76%), url("${item.artwork}")`
        const copy = document.createElement('span')
        copy.innerHTML = '<small></small><strong></strong><span></span>'
        copy.querySelector('small').textContent = item.kind === 'film'
          ? item.source : `CH ${item.channel_number}`
        copy.querySelector('strong').textContent = item.title
        copy.querySelector('span').textContent = `${viewingDuration(item.seconds)} watched`
        button.append(copy)
        button.onclick = () => openViewingItem(item.item_key)
        root.append(button)
      })
    }

    function renderViewingBrowse(kind) {
      const isFilms = kind === 'films'
      const values = viewingCatalog()[kind]
      const query = $('#viewingBrowseSearch').value.trim().toLocaleLowerCase()
      const filtered = values.filter(item => item.title.toLocaleLowerCase().includes(query))
      $('#viewingBrowseKicker').textContent = isFilms ? 'MabelTV film library' : 'MabelTV series library'
      $('#viewingBrowseTitle').textContent = isFilms ? 'Every film' : 'Every channel'
      $('#viewingBrowseIntro').textContent = isFilms
        ? 'Choose any film — watched or not — for its progress and viewing patterns.'
        : 'Choose any series channel — watched or not — for its complete viewing story.'
      $('#viewingBrowseCount').textContent = String(values.length)
      $('#viewingBrowseSearch').placeholder = isFilms ? 'Search films' : 'Search channels'
      const root = $('#viewingBrowseGrid')
      root.replaceChildren()
      filtered.forEach(item => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `viewing-catalog-card ${item.kind}`
        const art = document.createElement('span')
        art.className = 'viewing-catalog-art'
        if (item.artwork) art.style.backgroundImage = `url("${item.artwork}")`
        else art.append(librarySignalIcon(item.kind === 'film' ? 'signal-film' : 'signal-tv'))
        const copy = document.createElement('span')
        copy.className = 'viewing-catalog-copy'
        const label = document.createElement('small')
        label.textContent = item.kind === 'film' ? item.source : `CH ${item.channel_number}`
        const title = document.createElement('strong')
        title.textContent = item.title
        const watched = document.createElement('span')
        watched.textContent = item.seconds > 0
          ? `${viewingDuration(item.seconds)} · ${item.sessions} ${item.sessions === 1 ? 'watch' : 'watches'}`
          : 'Not watched in this period'
        copy.append(label, title, watched)
        button.append(art, copy)
        button.onclick = () => openViewingItem(item.item_key)
        root.append(button)
      })
      if (!filtered.length) root.innerHTML = '<p class="viewing-empty">Nothing matches that search.</p>'
      showViewingScreen($('#viewingBrowse'))
    }

    function renderViewingItem(item, tab = 'summary') {
      if (!item) { pushInsightsRoute('insights'); return }
      selectedViewingItemKey = item.item_key
      $('#viewingItemBackLabel').textContent = item.kind === 'film' ? 'All films' : 'All channels'
      $('#viewingItemKicker').textContent = item.kind === 'film' ? 'Film insight' : 'Channel insight'
      $('#viewingItemTitle').textContent = item.title
      $('#viewingItemSource').textContent = item.kind === 'channel'
        ? `CH ${item.channel_number} · MabelTV series channel` : `CH ${item.channel_number} · ${item.source}`
      $('#viewingItemRangeSelect').value = String(viewingInsightsRange)
      setViewingArtwork($('#viewingItemArtwork'), item.artwork)
      $('#viewingItemTotal').textContent = viewingDuration(item.seconds)
      $('#viewingItemSessions').textContent = String(item.sessions || 0)
      $('#viewingItemDays').textContent = String(item.active_days || 0)
      $('#viewingItemAverage').textContent = viewingDuration(item.average_session_seconds)
      $('#viewingItemShare').textContent = `${Math.round(Number(item.share || 0) * 100)}%`
      $('#viewingItemPeriod').textContent = item.seconds ? item.busiest_period : 'Not watched yet'
      $('#viewingItemFirst').textContent = viewingDate(item.first_watched)
      $('#viewingItemLast').textContent = viewingDate(item.last_watched)
      $('#viewingItemLongest').textContent = `Longest ${viewingDuration(item.longest_session_seconds)}`
      $('#viewingFilmProgress').classList.toggle('hidden', item.kind !== 'film')
      if (item.kind === 'film') {
        $('#viewingFilmAverage').textContent = `${Math.round(Number(item.average_progress || 0) * 100)}%`
        $('#viewingFilmFurthest').textContent = `${Math.round(Number(item.furthest_progress || 0) * 100)}%`
        $('#viewingFilmCompletions').textContent = String(item.completion_sessions || 0)
      }
      $('#viewingItemTimelineTitle').textContent = viewingInsightsRange === 1
        ? 'Today hour by hour' : viewingInsightsRange === 365 ? 'Month by month' : 'Day by day'
      $$('[data-insights-tab]').forEach(button => button.classList.toggle('active', button.dataset.insightsTab === tab))
      $('#viewingItemSummary').classList.toggle('hidden', tab !== 'summary')
      $('#viewingItemPatterns').classList.toggle('hidden', tab !== 'patterns')
      $('#viewingItemHistory').classList.toggle('hidden', tab !== 'history')
      showViewingScreen($('#viewingItemDetail'))
      renderViewingChart($('#viewingItemTimeline'), item.timeline || [], 'line')
      renderViewingChart($('#viewingItemHourly'), item.hourly || [], 'line')
      renderViewingChart($('#viewingItemTime'), item.time_of_day || [], 'bar')
      renderViewingChart($('#viewingItemWeekdays'), item.weekdays || [], 'bar')
      renderViewingChart($('#viewingItemSurfaces'), item.by_surface || [], 'doughnut', {
        tv: 'On the TV', device: 'On this device',
      })
      const sessions = (viewingInsightsData?.sessions || []).filter(value => value.item_key === item.item_key)
      renderViewingSessions(sessions, { root: $('#viewingItemSessionList'), title: $('#viewingItemSessionTitle'), count: $('#viewingItemSessionCount'), scoped: true })
    }

    function localDateKey(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    const viewingPeriodNames = ['Overnight', 'Morning', 'Afternoon', 'Evening']

    function sessionsForViewingPeriod(dateKey, period) {
      return (viewingInsightsData?.sessions || []).filter(item => {
        const started = new Date(item.started || item.when)
        return localDateKey(started) === dateKey && Math.floor(started.getHours() / 6) === period
      }).sort((a, b) => new Date(a.started) - new Date(b.started))
    }

    function viewingDateKeys() {
      const span = viewingInsightsRange
      return Array.from({ length: span }, (_, index) => {
        const date = new Date()
        date.setHours(12, 0, 0, 0)
        date.setDate(date.getDate() - (span - index - 1))
        return localDateKey(date)
      })
    }

    function renderViewingDiary() {
      const root = $('#viewingDiaryDays')
      root.replaceChildren()
      const keys = viewingDateKeys().reverse()
      keys.filter((key, index) => index < 2 || viewingPeriodNames.some((_, period) =>
        sessionsForViewingPeriod(key, period).length)).forEach(key => {
        const day = document.createElement('section')
        day.className = 'viewing-diary-day'
        const date = new Date(`${key}T12:00:00`)
        const heading = document.createElement('header')
        const title = document.createElement('h3')
        title.textContent = key === localDateKey(new Date()) ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
        heading.append(title)
        const periods = document.createElement('div')
        periods.className = 'viewing-diary-periods'
        viewingPeriodNames.forEach((name, period) => {
          const sessions = sessionsForViewingPeriod(key, period)
          const total = sessions.reduce((sum, item) => sum + Number(item.seconds || 0), 0)
          const button = document.createElement('button')
          button.type = 'button'
          button.innerHTML = `<span><small>${name}</small><strong>${viewingDuration(total)}</strong></span><span class="viewing-period-thumbs"></span><svg><use href="/portal/icons.svg#signal-chevron-right"/></svg>`
          const thumbs = button.querySelector('.viewing-period-thumbs')
          ;[...new Set(sessions.map(item => item.item_key))].slice(0, 3).forEach(itemKey => {
            const item = viewingItem(itemKey)
            if (!item?.artwork) return
            const thumb = document.createElement('i')
            thumb.style.backgroundImage = `url("${item.artwork}")`
            thumbs.append(thumb)
          })
          button.onclick = () => pushInsightsRoute(`insights/period/${key}/${period}`)
          periods.append(button)
        })
        day.append(heading, periods)
        root.append(day)
      })
      showViewingScreen($('#viewingDiary'))
    }

    function renderViewingPeriod(dateKey, period) {
      const sessions = sessionsForViewingPeriod(dateKey, period)
      const total = sessions.reduce((sum, item) => sum + Number(item.seconds || 0), 0)
      const date = new Date(`${dateKey}T12:00:00`)
      $('#viewingPeriodDate').textContent = dateKey === localDateKey(new Date()) ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
      $('#viewingPeriodTitle').textContent = viewingPeriodNames[period]
      $('#viewingPeriodSummary').textContent = sessions.length
        ? `${viewingDuration(total)} across ${sessions.length} viewing ${sessions.length === 1 ? 'entry' : 'entries'}`
        : 'No qualifying viewing in this part of the day'
      const stats = $('#viewingPeriodStats')
      const unique = new Set(sessions.map(item => item.item_key)).size
      const channels = new Set(sessions.map(item => item.channel_number)).size
      stats.innerHTML = `<article><svg><use href="/portal/icons.svg#signal-clock"/></svg><span>Total watched</span><strong>${viewingDuration(total)}</strong></article><article><svg><use href="/portal/icons.svg#signal-play"/></svg><span>Things watched</span><strong>${unique}</strong></article><article><svg><use href="/portal/icons.svg#signal-tv"/></svg><span>Channels visited</span><strong>${channels}</strong></article><article><svg><use href="/portal/icons.svg#signal-history"/></svg><span>Longest watch</span><strong>${viewingDuration(Math.max(0, ...sessions.map(item => Number(item.seconds || 0))))}</strong></article>`
      const root = $('#viewingPeriodEntries')
      root.replaceChildren()
      if (!sessions.length) root.innerHTML = '<p class="viewing-empty">Nothing lasting two minutes or more was watched here.</p>'
      sessions.forEach((session, index) => {
        const item = viewingItem(session.item_key)
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'viewing-period-entry'
        const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(session.started))
        row.innerHTML = '<span class="viewing-period-number"></span><span class="viewing-period-entry-art"></span><span><small></small><strong></strong><span></span></span><svg><use href="/portal/icons.svg#signal-chevron-right"/></svg>'
        row.querySelector('.viewing-period-number').textContent = index + 1
        row.querySelector('small').textContent = `${time} · ${session.source}`
        row.querySelector('strong').textContent = session.title
        row.querySelector('small').parentElement.lastElementChild.textContent = session.duration
        const art = row.querySelector('.viewing-period-entry-art')
        if (item?.artwork) art.style.backgroundImage = `url("${item.artwork}")`
        row.onclick = () => openViewingItem(session.item_key, 'history')
        root.append(row)
      })
      const allKeys = viewingDateKeys()
      const flatIndex = allKeys.indexOf(dateKey) * 4 + period
      const move = delta => {
        const next = flatIndex + delta
        if (next < 0 || next >= allKeys.length * 4) return
        pushInsightsRoute(`insights/period/${allKeys[Math.floor(next / 4)]}/${next % 4}`)
      }
      $('#viewingPeriodPrevious').disabled = flatIndex <= 0
      $('#viewingPeriodNext').disabled = flatIndex >= allKeys.length * 4 - 1
      $('#viewingPeriodPrevious').onclick = () => move(-1)
      $('#viewingPeriodNext').onclick = () => move(1)
      showViewingScreen($('#viewingPeriod'))
    }

    function renderInsightsRoute() {
      if (!viewingInsightsData) return
      const route = viewingInsightsRoute
      if (route.screen === 'channels' || route.screen === 'films') renderViewingBrowse(route.screen)
      else if (route.screen === 'item') renderViewingItem(viewingItem(route.itemKey), route.tab)
      else if (route.screen === 'diary') renderViewingDiary()
      else if (route.screen === 'period') renderViewingPeriod(route.date, route.period)
      else {
        selectedViewingItemKey = ''
        renderViewingHighlights()
        const catalog = viewingCatalog()
        renderViewingMosaic($('#viewingChannelMosaic'), catalog.channels)
        renderViewingMosaic($('#viewingFilmMosaic'), catalog.films)
        $('#viewingChannelSummary').textContent = `${catalog.channels.length} channels · every viewing pattern`
        $('#viewingFilmSummary').textContent = `${catalog.films.length} films · progress and repeats`
        showViewingScreen($('#viewingDashboard'))
      }
    }

    function openInsightsRoute(requested) {
      const previousScreen = viewingInsightsRoute.screen
      const item = requested.match(/^insights\/item\/(.+)\/(summary|patterns|history)$/)
      const period = requested.match(/^insights\/period\/(\d{4}-\d{2}-\d{2})\/([0-3])$/)
      if (item) viewingInsightsRoute = { screen: 'item', itemKey: decodeURIComponent(item[1]), tab: item[2] }
      else if (period) viewingInsightsRoute = { screen: 'period', date: period[1], period: Number(period[2]) }
      else if (requested === 'insights/channels') viewingInsightsRoute = { screen: 'channels' }
      else if (requested === 'insights/films') viewingInsightsRoute = { screen: 'films' }
      else if (requested === 'insights/diary') viewingInsightsRoute = { screen: 'diary' }
      else viewingInsightsRoute = { screen: 'dashboard' }
      if ((viewingInsightsRoute.screen === 'channels' || viewingInsightsRoute.screen === 'films')
          && viewingInsightsRoute.screen !== previousScreen && $('#viewingBrowseSearch')) {
        $('#viewingBrowseSearch').value = ''
      }
      $('.insights-page')?.classList.toggle('is-child', viewingInsightsRoute.screen !== 'dashboard')
      $('#viewingRangeControls')?.classList.toggle('hidden', viewingInsightsRoute.screen !== 'dashboard')
      openView('insights', { instantScroll: true })
      renderInsightsRoute()
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
    }
    window.openInsightsRoute = openInsightsRoute
    if (location.hash === '#insights' || location.hash.startsWith('#insights/')) {
      queueMicrotask(() => openInsightsRoute(location.hash.slice(1)))
    }

    function setViewingSessionSwipe(wrapper, open, animate = true) {
      if (!wrapper) return
      wrapper.classList.toggle('swiping', !animate)
      wrapper.classList.toggle('open', open)
      wrapper.style.removeProperty('--viewing-swipe-offset')
      if (open) {
        if (openViewingSessionSwipe && openViewingSessionSwipe !== wrapper) {
          setViewingSessionSwipe(openViewingSessionSwipe, false)
        }
        openViewingSessionSwipe = wrapper
      } else if (openViewingSessionSwipe === wrapper) {
        openViewingSessionSwipe = null
      }
    }

    function bindViewingSessionSwipe(wrapper, surface) {
      const revealWidth = 86
      let pointerId = null
      let startX = 0
      let startY = 0
      let startOffset = 0
      let offset = 0
      let horizontal = false
      let suppressClick = false

      surface.onpointerdown = event => {
        if (event.button !== undefined && event.button !== 0) return
        pointerId = event.pointerId
        startX = event.clientX
        startY = event.clientY
        startOffset = wrapper.classList.contains('open') ? -revealWidth : 0
        offset = startOffset
        horizontal = false
      }
      surface.onpointermove = event => {
        if (pointerId !== event.pointerId) return
        const deltaX = event.clientX - startX
        const deltaY = event.clientY - startY
        if (!horizontal && Math.abs(deltaX) < 7) return
        if (!horizontal && Math.abs(deltaY) > Math.abs(deltaX)) {
          pointerId = null
          return
        }
        horizontal = true
        surface.setPointerCapture?.(event.pointerId)
        offset = Math.max(-revealWidth, Math.min(0, startOffset + deltaX))
        wrapper.classList.add('swiping')
        wrapper.style.setProperty('--viewing-swipe-offset', `${offset}px`)
        if (event.cancelable) event.preventDefault()
      }
      const finish = event => {
        if (pointerId !== event.pointerId) return
        const wasHorizontal = horizontal
        const shouldOpen = wasHorizontal
          ? offset < -(revealWidth * .42)
          : wrapper.classList.contains('open')
        pointerId = null
        horizontal = false
        suppressClick = wasHorizontal
        if (wasHorizontal) setTimeout(() => { suppressClick = false }, 350)
        setViewingSessionSwipe(wrapper, shouldOpen)
      }
      surface.onpointerup = finish
      surface.onpointercancel = finish
      surface.onclick = event => {
        if (suppressClick) {
          suppressClick = false
          event.preventDefault()
          return
        }
        if (!wrapper.classList.contains('open')) return
        event.preventDefault()
        setViewingSessionSwipe(wrapper, false)
      }
    }

    function renderViewingSessions(values, options = {}) {
      const root = options.root || $('#viewingSessions')
      const titleRoot = options.title || $('#viewingSessionTitle')
      const countRoot = options.count || $('#viewingSessionCount')
      root.replaceChildren()
      openViewingSessionSwipe = null
      titleRoot.textContent = options.scoped ? 'Recent viewing'
        : viewingInsightsRange === 1 ? 'Today' : 'Viewing in this period'
      countRoot.textContent = values.length
        ? `${values.length} viewing ${values.length === 1 ? 'entry' : 'entries'}` : 'No activity'
      if (!values.length) {
        const empty = document.createElement('p')
        empty.className = 'viewing-empty'
        empty.textContent = options.scoped ? 'No qualifying viewing for this item in this period.'
          : viewingInsightsRange === 1
          ? 'No MabelTV viewing has reached two minutes today.'
          : 'No qualifying MabelTV viewing in this period.'
        root.append(empty)
        return
      }
      const timeFormat = new Intl.DateTimeFormat(undefined, {
        weekday: viewingInsightsRange === 1 ? undefined : 'short',
        hour: 'numeric', minute: '2-digit',
      })
      let previousDay = ''
      values.forEach(item => {
        const dayKey = new Date(item.when).toLocaleDateString()
        if (viewingInsightsRange !== 1 && dayKey !== previousDay) {
          const day = document.createElement('p')
          day.className = 'viewing-session-day'
          day.textContent = new Intl.DateTimeFormat(undefined, {
            weekday: 'long', day: 'numeric', month: 'short',
          }).format(new Date(item.when))
          root.append(day)
          previousDay = dayKey
        }
        const wrapper = document.createElement('div')
        wrapper.className = 'viewing-session-swipe'
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'viewing-session-delete'
        remove.setAttribute('aria-label', `Delete ${item.title} from viewing insights`)
        remove.append(librarySignalIcon('signal-trash'), document.createElement('span'))
        remove.querySelector('span').textContent = 'Delete'
        const row = document.createElement('div')
        row.className = 'viewing-session-row'
        const icon = document.createElement('span')
        icon.className = `viewing-session-icon ${item.kind === 'film' ? 'film' : 'channel'}`
        icon.append(librarySignalIcon(item.kind === 'film' ? 'signal-film' : 'signal-tv'))
        const copy = document.createElement('span')
        copy.className = 'viewing-session-copy'
        const title = document.createElement('strong')
        title.textContent = item.title
        const details = document.createElement('small')
        const surface = item.surface === 'device' ? 'This device' : 'TV'
        let detail = `${item.source} · ${surface} · ${timeFormat.format(new Date(item.when))}`
        if (item.kind === 'film' && Number(item.media_duration) > 0) {
          detail += ` · ${Math.round(Number(item.progress) * 100)}% through film`
        }
        details.textContent = detail
        copy.append(title, details)
        const duration = document.createElement('b')
        duration.textContent = item.duration || viewingDuration(item.seconds)
        row.append(icon, copy, duration)
        wrapper.append(remove, row)
        bindViewingSessionSwipe(wrapper, row)
        remove.onfocus = () => setViewingSessionSwipe(wrapper, true)
        remove.onclick = async () => {
          remove.disabled = true
          wrapper.classList.add('deleting')
          try {
            await api('/api/viewing-insights/delete', {
              method: 'POST', body: JSON.stringify({ ids: [item.id] }),
            })
            await loadViewingInsights(true)
            notice('Viewing session deleted.')
          } catch (error) {
            wrapper.classList.remove('deleting')
            remove.disabled = false
            setViewingSessionSwipe(wrapper, false)
            notice(error.message, true)
          }
        }
        root.append(wrapper)
      })
    }

    async function loadViewingInsights(force = false) {
      const loading = $('#viewingInsightsLoading')
      const root = $('#viewingInsights')
      if (!loading || !root || offlineMode) return
      loading.classList.add('hidden')
      if (!force && viewingInsightsData && viewingInsightsLoadedRange === viewingInsightsRange) {
        renderInsightsRoute()
        root.classList.remove('hidden')
        return
      }
      try {
        const data = await api(`/api/viewing-insights?days=${viewingInsightsRange}&timezone_offset=${new Date().getTimezoneOffset()}`)
        viewingInsightsData = data
        viewingInsightsLoadedRange = viewingInsightsRange
        const rangeLabels = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days', 365: 'Last 12 months' }
        const rangeLabel = rangeLabels[viewingInsightsRange] || 'Viewing activity'
        $('#viewingOverviewTitle').textContent = rangeLabel
        $('#viewingActiveDays').textContent = String(data.summary.active_days)
        $('#viewingRangeTotal').textContent = viewingDuration(data.summary.range_seconds)
        $('#viewingSessionTotal').textContent = String(data.summary.sessions || 0)
        $('#viewingLongestSession').textContent = viewingDuration(data.summary.longest_session_seconds)
        $('#viewingBusiestPeriod').textContent = data.summary.busiest_period || '—'
        const current = Number(data.summary.range_seconds) || 0
        const previous = Number(data.summary.previous_range_seconds) || 0
        const comparison = $('#viewingComparison')
        comparison.classList.remove('up', 'down')
        if (!current && !previous) comparison.textContent = 'No activity in this period'
        else if (!previous) { comparison.textContent = 'First activity in this period'; comparison.classList.add('up') }
        else {
          const change = Math.round((current - previous) / previous * 100)
          comparison.textContent = change === 0 ? 'Same as the previous period'
            : `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than the previous period`
          comparison.classList.add(change >= 0 ? 'up' : 'down')
        }
        $('#viewingTimelineTitle').textContent = viewingInsightsRange === 1
          ? 'Today by time of day' : viewingInsightsRange === 365
            ? 'Month by month' : 'Day by day'
        const sessions = Number(data.summary.sessions) || 0
        $('#viewingSessionSummary').textContent = sessions
          ? `${sessions} ${sessions === 1 ? 'entry' : 'entries'} · longest ${viewingDuration(data.summary.longest_session_seconds)}`
          : 'No activity'
        renderViewingChart($('#viewingTimelineChart'), data.timeline || [], 'line')
        renderViewingChart($('#viewingTimeChart'), data.time_of_day || [], 'bar')
        renderInsightsRoute()
        root.classList.remove('hidden')
        loading.classList.add('hidden')
      } catch (error) {
        loading.textContent = 'Viewing insights are temporarily unavailable.'
        loading.classList.remove('hidden')
      }
    }

    $$('[data-viewing-range]').forEach(button => button.onclick = () => {
      viewingInsightsRange = Number(button.dataset.viewingRange)
      $$('[data-viewing-range]').forEach(option => option.classList.toggle(
        'active', Number(option.dataset.viewingRange) === viewingInsightsRange))
      loadViewingInsights(true)
    })
    $$('[data-insights-destination]').forEach(button => button.onclick = () =>
      pushInsightsRoute(`insights/${button.dataset.insightsDestination}`))
    $$('[data-insights-back]').forEach(button => button.onclick = navigateInsightsBack)
    $$('[data-insights-tab]').forEach(button => button.onclick = () => {
      if (!selectedViewingItemKey) return
      replaceInsightsRoute(`insights/item/${encodeURIComponent(selectedViewingItemKey)}/${button.dataset.insightsTab}`)
    })
    $('#viewingItemRangeSelect').onchange = event => {
      viewingInsightsRange = Number(event.target.value)
      $$('[data-viewing-range]').forEach(option => option.classList.toggle(
        'active', Number(option.dataset.viewingRange) === viewingInsightsRange))
      loadViewingInsights(true)
    }
    $('#viewingBrowseSearch').oninput = () => {
      if (viewingInsightsRoute.screen === 'channels' || viewingInsightsRoute.screen === 'films') {
        renderViewingBrowse(viewingInsightsRoute.screen)
      }
    }

