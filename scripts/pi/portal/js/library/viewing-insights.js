'use strict'

// MabelTV Insights is a routed view backed by independently cached resources.
// Dashboard ranges, lifetime catalogue, item ranges and diary dates never share
// mutable scope.
const viewingCharts = new Map()
const insightsPositions = new Map()
const viewingResources = new Map()
const viewingRequests = new Map()
let currentInsightsPath = 'insights'
let viewingDashboardRange = 7
let viewingItemRange = 0
let viewingInsightsRoute = { screen: 'dashboard' }
let selectedViewingItemId = ''
let openViewingSessionSwipe = null
let viewingRenderedRoute = ''
let viewingRenderedResource = null

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

function viewingTimezoneQuery() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  return `timezone_offset=${new Date().getTimezoneOffset()}&timezone=${encodeURIComponent(zone)}`
}

function viewingArtworkUrl(value) {
  return value ? `/api/channel/artwork/${encodeURIComponent(value)}` : ''
}

function viewingResourceKey(scope, identity = '') {
  return `${scope}:${identity}`
}

async function restoreViewingResource(scope, identity = '') {
  const key = viewingResourceKey(scope, identity)
  const existing = viewingResources.get(key)
  if (existing?.restored) return existing
  const cached = await readPortalDataCache(
    `mabel-insights-v2-${scope}-${encodeURIComponent(identity || 'default')}`,
    'viewing_insights')
  const resource = cached
    ? { data: cached.data, savedAt: Number(cached.saved_at) || 0,
      stale: Boolean(cached.stale), restored: true }
    : { data: null, savedAt: 0, stale: true, restored: true }
  viewingResources.set(key, resource)
  return resource
}

async function loadViewingResource(scope, identity, url, force = false) {
  const key = viewingResourceKey(scope, identity)
  const restored = await restoreViewingResource(scope, identity)
  renderInsightsRoute()
  // Cached content paints before the optional chart bundle is available. Start
  // loading it in parallel even when the cached resource is still fresh; the
  // chart loader rerenders this route once Chart is ready.
  ensureViewingCharts().catch(() => {})
  const fresh = restored.data && !restored.stale
    && Date.now() - restored.savedAt < 5 * 60 * 1000
  if (offlineMode || (!force && fresh)) return restored.data
  if (viewingRequests.has(key)) return viewingRequests.get(key)
  const request = (async () => {
    try {
      const data = await api(url)
      viewingResources.set(key, {
        data, savedAt: Date.now(), stale: false, restored: true,
      })
      await writePortalDataCache(
        `mabel-insights-v2-${scope}-${encodeURIComponent(identity || 'default')}`,
        data, 'viewing_insights')
      renderInsightsRoute(true)
      return data
    } finally {
      viewingRequests.delete(key)
    }
  })()
  viewingRequests.set(key, request)
  return request
}

function viewingResource(scope, identity = '') {
  return viewingResources.get(viewingResourceKey(scope, identity))?.data || null
}

function destroyViewingChart(root) {
  if (!root) return
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
      ? 'Loading chart…' : 'Viewing will appear here as it is watched.'
    root.append(empty)
    return
  }
  const canvas = document.createElement('canvas')
  root.append(canvas)
  const css = getComputedStyle(document.body)
  const accent = css.getPropertyValue('--experience-orange').trim() || '#ff7720'
  const muted = css.getPropertyValue('--experience-dim').trim() || '#8f8d98'
  const grid = css.getPropertyValue('--experience-line').trim() || 'rgba(255,255,255,.1)'
  const doughnut = type === 'doughnut'
  const chart = new Chart(canvas, {
    type,
    data: {
      labels: usable.map(item => item.chartLabel),
      datasets: [{
        data: usable.map(item => item.minutes), borderColor: accent,
        backgroundColor: doughnut ? [accent, '#7c4dff', '#45b8ff', '#55d6a5']
          : type === 'bar' ? accent : 'transparent',
        borderWidth: type === 'line' ? 2.5 : doughnut ? 0 : 1,
        borderRadius: type === 'bar' ? 7 : 0, borderSkipped: false,
        fill: false, tension: .32, pointRadius: type === 'line' ? 3 : 0,
        pointHoverRadius: 5, pointBackgroundColor: accent,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 220 },
      plugins: {
        legend: { display: doughnut, position: 'bottom', labels: {
          color: muted, boxWidth: 10, boxHeight: 10, usePointStyle: true,
          padding: 14, font: { size: 10 },
        } },
        tooltip: { callbacks: { label: context =>
          `${context.label}: ${viewingDuration(Number(context.raw || 0) * 60)}` } },
      },
      scales: doughnut ? {} : {
        x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0,
          autoSkip: true, maxTicksLimit: 8, font: { size: 9 } },
        border: { display: false } },
        y: { beginAtZero: true, grid: { color: grid }, ticks: { color: muted,
          maxTicksLimit: 4, callback: value => viewingDuration(Number(value) * 60),
          font: { size: 9 } }, border: { display: false } },
      },
      cutout: doughnut ? '62%' : undefined,
    },
  })
  viewingCharts.set(root, chart)
  root.setAttribute('aria-label', usable.map(item =>
    `${item.chartLabel} ${viewingDuration(item.seconds)}`).join(', '))
}

async function ensureViewingCharts() {
  if (typeof Chart !== 'undefined') return
  await window.MabelAssets?.chart().catch(() => {})
  if (typeof Chart !== 'undefined') renderInsightsRoute(true)
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
  const parent = location.hash.startsWith('#insights')
    ? location.hash.slice(1) : 'insights/mabeltv'
  history.pushState({ insightsChild: true, insightsParent: parent }, '', `#${path}`)
  openInsightsRoute(path)
}

function replaceInsightsRoute(path) {
  history.replaceState({ ...history.state, insightsChild: true }, '', `#${path}`)
  openInsightsRoute(path)
}

function insightsParentRoute() {
  const stored = String(history.state?.insightsParent || '')
  if (['insights/mabeltv', 'insights/channels', 'insights/films', 'insights/diary'].includes(stored)) return stored
  if (/^insights\/diary\/\d{4}-\d{2}-\d{2}$/.test(stored)) return stored
  if (viewingInsightsRoute.screen === 'item') {
    const item = viewingResource('catalogue')?.items?.find(
      value => value.item_id === viewingInsightsRoute.itemId)
    return item?.kind === 'film' ? 'insights/films' : 'insights/channels'
  }
  return 'insights/mabeltv'
}

function navigateInsightsBack() {
  const target = insightsParentRoute()
  if (history.state?.insightsParent === target) history.back()
  else replaceInsightsRoute(target)
}

function openViewingItem(itemId, tab = 'summary') {
  pushInsightsRoute(`insights/item/${encodeURIComponent(itemId)}/${tab}`)
}

function renderViewingMosaic(root, artwork) {
  root.replaceChildren()
  ;(artwork || []).slice(0, 3).forEach(value => {
    const image = document.createElement('span')
    image.style.backgroundImage = `url("${viewingArtworkUrl(value)}")`
    root.append(image)
  })
  if (!root.children.length) root.append(librarySignalIcon('signal-film'))
}

function renderViewingHighlights(values) {
  const root = $('#viewingHighlights')
  root.replaceChildren()
  if (!values?.length) {
    root.innerHTML = '<p class="viewing-empty">Highlights will appear after MabelTV has been watched.</p>'
    return
  }
  values.slice(0, 3).forEach(item => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `viewing-highlight ${item.kind}`
    const art = document.createElement('span')
    art.className = 'viewing-highlight-art'
    const artwork = viewingArtworkUrl(item.artwork)
    if (artwork) art.style.backgroundImage = `url("${artwork}")`
    else art.append(librarySignalIcon(item.kind === 'film' ? 'signal-film' : 'signal-tv'))
    const copy = document.createElement('span')
    copy.innerHTML = '<small></small><strong></strong><span></span>'
    copy.querySelector('small').textContent = item.kind === 'film'
      ? item.source : `CH ${item.channel_number}`
    copy.querySelector('strong').textContent = item.title
    copy.querySelector('span').textContent = `${viewingDuration(item.seconds)} watched`
    button.append(art, copy)
    button.onclick = () => openViewingItem(item.item_id)
    root.append(button)
  })
}

function viewingCatalogueCard(item) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `viewing-catalog-card ${item.kind}`
  button.setAttribute('aria-label', `Open viewing insight for ${item.title}`)
  const art = document.createElement('span')
  art.className = 'viewing-catalog-art'
  const artwork = viewingArtworkUrl(item.artwork)
  if (artwork) art.style.backgroundImage = `url("${artwork}")`
  else art.append(librarySignalIcon(item.kind === 'film' ? 'signal-film' : 'signal-tv'))
  const copy = document.createElement('span')
  copy.className = 'viewing-catalog-copy'
  const label = document.createElement('small')
  label.textContent = item.kind === 'film' ? item.source
    : item.channel_number ? `CH ${item.channel_number}` : 'Archive'
  const title = document.createElement('strong')
  title.textContent = item.title
  const watched = document.createElement('span')
  watched.textContent = item.seconds > 0
    ? `${viewingDuration(item.seconds)} · ${item.sessions} ${item.sessions === 1 ? 'session' : 'sessions'}`
    : 'Not watched yet'
  copy.append(label, title, watched)
  button.append(art, copy)
  button.onclick = () => openViewingItem(item.item_id)
  return button
}

function appendViewingCatalogueGroup(root, label, items, isFilms) {
  const section = document.createElement('section')
  section.className = 'viewing-catalog-group'
  const header = document.createElement('header')
  const title = document.createElement('h3')
  title.textContent = label
  const count = document.createElement('span')
  const noun = isFilms ? 'film' : 'channel'
  count.textContent = `${items.length} ${noun}${items.length === 1 ? '' : 's'}`
  header.append(title, count)
  const grid = document.createElement('div')
  grid.className = `viewing-catalog-grid ${isFilms ? 'is-films' : 'is-channels'}`
  items.forEach(item => grid.append(viewingCatalogueCard(item)))
  section.append(header, grid)
  root.append(section)
}

function renderViewingDashboard() {
  const data = viewingResource('overview', String(viewingDashboardRange))
  showViewingScreen($('#viewingDashboard'))
  if (!data) return
  $('#viewingOverviewTitle').textContent = data.range_label
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
  else if (!previous) {
    comparison.textContent = 'First activity in this period'
    comparison.classList.add('up')
  } else {
    const change = Math.round((current - previous) / previous * 100)
    comparison.textContent = change === 0 ? 'Same as the previous period'
      : `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than the previous period`
    comparison.classList.add(change >= 0 ? 'up' : 'down')
  }
  $('#viewingTimelineTitle').textContent = viewingDashboardRange === 1
    ? 'Today by time of day' : viewingDashboardRange === 365
      ? 'Month by month' : 'Day by day'
  const sessions = Number(data.summary.sessions) || 0
  $('#viewingSessionSummary').textContent = sessions
    ? `${sessions} ${sessions === 1 ? 'entry' : 'entries'} · longest ${viewingDuration(data.summary.longest_session_seconds)}`
    : 'No activity'
  const catalogue = data.catalogue || {}
  renderViewingMosaic($('#viewingChannelMosaic'), catalogue.channel_artwork)
  renderViewingMosaic($('#viewingFilmMosaic'), catalogue.film_artwork)
  $('#viewingChannelSummary').textContent = `${catalogue.channels || 0} channels · lifetime stories`
  $('#viewingFilmSummary').textContent = `${catalogue.films || 0} films · lifetime progress`
  renderViewingHighlights(data.highlights)
  renderViewingChart($('#viewingTimelineChart'), data.timeline || [], 'line')
  renderViewingChart($('#viewingTimeChart'), data.time_of_day || [], 'bar')
}

function renderViewingBrowse(kind) {
  const data = viewingResource('catalogue')
  const isFilms = kind === 'films'
  const values = (data?.items || []).filter(
    item => item.kind === (isFilms ? 'film' : 'channel'))
    .sort((a, b) => isFilms
      ? a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      : Number(a.channel_number || Number.MAX_SAFE_INTEGER)
        - Number(b.channel_number || Number.MAX_SAFE_INTEGER))
  const query = $('#viewingBrowseSearch').value.trim().toLocaleLowerCase()
  const filtered = values.filter(item => [item.title, item.source, item.channel_number]
    .some(value => String(value || '').toLocaleLowerCase().includes(query)))
  $('#viewingBrowseKicker').textContent = isFilms
    ? 'MabelTV film library' : 'MabelTV series library'
  $('#viewingBrowseTitle').textContent = isFilms ? 'Every film' : 'Every channel'
  $('#viewingBrowseIntro').textContent = isFilms
    ? 'Lifetime progress for every current and previously watched film.'
    : 'Lifetime viewing for every current and previously watched series channel.'
  $('#viewingBrowseSearch').placeholder = isFilms ? 'Search films' : 'Search channels'
  const root = $('#viewingBrowseGrid')
  root.replaceChildren()
  if (isFilms) {
    const groups = new Map()
    filtered.forEach(item => {
      const source = String(item.source || 'Other films').trim() || 'Other films'
      if (!groups.has(source)) groups.set(source, [])
      groups.get(source).push(item)
    })
    ;[...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
      .forEach(([source, items]) => appendViewingCatalogueGroup(root, source, items, true))
  } else if (filtered.length) {
    appendViewingCatalogueGroup(root, 'Series channels', filtered, false)
  }
  if (data && !filtered.length) {
    root.innerHTML = '<p class="viewing-empty">Nothing matches that search.</p>'
  }
  showViewingScreen($('#viewingBrowse'))
}

function renderViewingItem() {
  const identity = `${viewingInsightsRoute.itemId}:${viewingItemRange}`
  const data = viewingResource('item', identity)
  showViewingScreen($('#viewingItemDetail'))
  if (!data?.item) return
  const item = data.item
  selectedViewingItemId = item.item_id
  const parent = insightsParentRoute()
  $('#viewingItemBackLabel').textContent = parent === 'insights/mabeltv'
    ? 'Insights' : parent.startsWith('insights/diary') ? 'Follow the day'
      : item.kind === 'film' ? 'All films' : 'All channels'
  $('#viewingItemKicker').textContent = item.kind === 'film'
    ? 'Film insight' : 'Channel insight'
  $('#viewingItemTitle').textContent = item.title
  $('#viewingItemSource').textContent = item.channel_number
    ? `CH ${item.channel_number} · ${item.source}` : item.source
  $('#viewingItemRangeSelect').value = String(viewingItemRange)
  setViewingArtwork($('#viewingItemArtwork'), viewingArtworkUrl(item.artwork))
  $('#viewingItemTotal').textContent = viewingDuration(item.seconds)
  $('#viewingItemSessions').textContent = String(item.sessions || 0)
  $('#viewingItemDays').textContent = String(item.active_days || 0)
  $('#viewingItemAverage').textContent = viewingDuration(item.average_session_seconds)
  $('#viewingItemShare').textContent = `${Math.round(Number(item.share || 0) * 100)}%`
  $('#viewingItemPeriod').textContent = item.busiest_period || '—'
  $('#viewingItemFirst').textContent = viewingDate(item.first_watched)
  $('#viewingItemLast').textContent = viewingDate(item.last_watched)
  $('#viewingItemLongest').textContent = `Longest ${viewingDuration(item.longest_session_seconds)}`
  $('#viewingFilmProgress').classList.toggle('hidden', item.kind !== 'film')
  if (item.kind === 'film') {
    $('#viewingFilmAverage').textContent = `${Math.round(Number(item.average_progress || 0) * 100)}%`
    $('#viewingFilmFurthest').textContent = `${Math.round(Number(item.furthest_progress || 0) * 100)}%`
    $('#viewingFilmCompletions').textContent = String(item.completion_sessions || 0)
  }
  $('#viewingItemTimelineTitle').textContent = viewingItemRange === 0
    ? 'Lifetime month by month' : viewingItemRange === 365
      ? 'Month by month' : 'Day by day'
  const tab = viewingInsightsRoute.tab || 'summary'
  $$('[data-insights-tab]').forEach(button => button.classList.toggle(
    'active', button.dataset.insightsTab === tab))
  $('#viewingItemSummary').classList.toggle('hidden', tab !== 'summary')
  $('#viewingItemPatterns').classList.toggle('hidden', tab !== 'patterns')
  $('#viewingItemHistory').classList.toggle('hidden', tab !== 'history')
  if (tab === 'summary') {
    renderViewingChart($('#viewingItemTimeline'), item.timeline || [], 'line')
  }
  if (tab === 'patterns') {
    renderViewingChart($('#viewingItemHourly'), item.hourly || [], 'line')
    renderViewingChart($('#viewingItemTime'), item.time_of_day || [], 'bar')
    renderViewingChart($('#viewingItemWeekdays'), item.weekdays || [], 'bar')
    renderViewingChart($('#viewingItemSurfaces'), item.by_surface || [],
      'doughnut', { tv: 'On the TV', device: 'On this device' })
  }
  if (tab === 'history') {
    renderViewingSessions(item.history || [], {
      root: $('#viewingItemSessionList'), title: $('#viewingItemSessionTitle'),
      count: $('#viewingItemSessionCount'), scoped: true,
    })
  }
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
      ? offset < -(revealWidth * .42) : wrapper.classList.contains('open')
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
    if (wrapper.classList.contains('open')) {
      event.preventDefault()
      setViewingSessionSwipe(wrapper, false)
    }
  }
}

function renderViewingSessions(values, options) {
  const { root, title, count } = options
  root.replaceChildren()
  openViewingSessionSwipe = null
  title.textContent = 'Viewing history'
  count.textContent = values.length
    ? `${values.length} viewing ${values.length === 1 ? 'entry' : 'entries'}`
    : 'No activity'
  if (!values.length) {
    root.innerHTML = '<p class="viewing-empty">No qualifying viewing for this item in this period.</p>'
    return
  }
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', hour: 'numeric', minute: '2-digit',
  })
  let previousDay = ''
  values.forEach(item => {
    const dayKey = new Date(item.when).toLocaleDateString()
    if (dayKey !== previousDay) {
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
    const rowTitle = document.createElement('strong')
    rowTitle.textContent = item.title
    const details = document.createElement('small')
    const surface = item.surface === 'device' ? 'This device' : 'TV'
    let detail = `${item.source} · ${surface} · ${timeFormat.format(new Date(item.when))}`
    if (item.kind === 'film' && Number(item.media_duration) > 0) {
      detail += ` · ${Math.round(Number(item.progress) * 100)}% through film`
    }
    details.textContent = detail
    copy.append(rowTitle, details)
    const duration = document.createElement('b')
    duration.textContent = viewingDuration(item.seconds)
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
        const identity = `${viewingInsightsRoute.itemId}:${viewingItemRange}`
        viewingResources.delete(viewingResourceKey('item', identity))
        viewingResources.delete(viewingResourceKey('catalogue'))
        viewingResources.delete(viewingResourceKey(
          'overview', String(viewingDashboardRange)))
        await loadViewingItem(true)
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

function renderViewingDiary() {
  const data = viewingResource('diary', viewingInsightsRoute.date)
  showViewingScreen($('#viewingDiary'))
  if (!data) return
  const title = $('#viewingDayTitle')
  const selected = new Date(`${data.date}T12:00:00`)
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(selected)
  const day = new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(selected)
  const month = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(selected)
  title.replaceChildren()
  const dayLine = document.createElement('span')
  dayLine.textContent = `${weekday} ${day}`
  const monthLine = document.createElement('span')
  monthLine.textContent = month
  title.append(dayLine, monthLine)
  title.setAttribute('aria-label', data.label)
  const previous = $('#viewingDayPrevious')
  const next = $('#viewingDayNext')
  previous.disabled = !data.previous_date
  next.disabled = !data.next_date
  previous.onclick = () => replaceInsightsRoute(
    `insights/diary/${data.previous_date}`)
  next.onclick = () => data.next_date && replaceInsightsRoute(
    `insights/diary/${data.next_date}`)
  const root = $('#viewingDiaryPeriods')
  root.replaceChildren()
  ;(data.periods || []).forEach(period => {
    const section = document.createElement('section')
    section.className = 'viewing-diary-period'
    const header = document.createElement('header')
    header.innerHTML = '<div><p class="section-kicker"></p><h3></h3></div><strong></strong>'
    header.querySelector('.section-kicker').textContent = period.name
    header.querySelector('h3').textContent = period.sessions
      ? `${period.sessions} viewing ${period.sessions === 1 ? 'entry' : 'entries'}`
      : 'No qualifying viewing'
    header.querySelector('strong').textContent = viewingDuration(period.seconds)
    const entries = document.createElement('div')
    entries.className = 'viewing-period-entries'
    if (!period.entries.length) {
      entries.innerHTML = '<p class="viewing-empty">Nothing lasting two minutes or more was watched.</p>'
    }
    period.entries.forEach((entry, index) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'viewing-period-entry'
      row.innerHTML = '<span class="viewing-period-number"></span><span class="viewing-period-entry-art"></span><span><small></small><strong></strong><span></span></span><svg><use href="/portal/icons.svg#signal-chevron-right"/></svg>'
      row.querySelector('.viewing-period-number').textContent = index + 1
      row.querySelector('small').textContent = `${new Intl.DateTimeFormat(undefined, {
        hour: 'numeric', minute: '2-digit',
      }).format(new Date(entry.started))} · ${entry.source}`
      row.querySelector('strong').textContent = entry.title
      row.querySelector('small').parentElement.lastElementChild.textContent =
        viewingDuration(entry.seconds)
      if (entry.artwork) {
        row.querySelector('.viewing-period-entry-art').style.backgroundImage =
          `url("${viewingArtworkUrl(entry.artwork)}")`
      }
      row.onclick = () => openViewingItem(entry.item_id, 'history')
      entries.append(row)
    })
    section.append(header, entries)
    root.append(section)
  })
}

function renderInsightsRoute(force = false) {
  if (myInsightsMode !== 'mabel') return
  const route = viewingInsightsRoute
  let routeKey = route.screen
  let resource = null
  if (route.screen === 'dashboard') {
    routeKey += `:${viewingDashboardRange}`
    resource = viewingResource('overview', String(viewingDashboardRange))
  } else if (route.screen === 'channels' || route.screen === 'films') {
    resource = viewingResource('catalogue')
  } else if (route.screen === 'item') {
    routeKey += `:${route.itemId}:${route.tab}:${viewingItemRange}`
    resource = viewingResource('item', `${route.itemId}:${viewingItemRange}`)
  } else if (route.screen === 'diary') {
    routeKey += `:${route.date}`
    resource = viewingResource('diary', route.date)
  }
  if (!force && routeKey === viewingRenderedRoute
      && resource === viewingRenderedResource) return
  viewingRenderedRoute = routeKey
  viewingRenderedResource = resource
  if (route.screen === 'dashboard') renderViewingDashboard()
  else if (route.screen === 'channels' || route.screen === 'films') {
    renderViewingBrowse(route.screen)
  } else if (route.screen === 'item') renderViewingItem()
  else if (route.screen === 'diary') renderViewingDiary()
  if (force) ensureViewingCharts().catch(() => {})
}

async function loadViewingDashboard(force = false) {
  const identity = String(viewingDashboardRange)
  return loadViewingResource('overview', identity,
    `/api/viewing-insights/overview?days=${viewingDashboardRange}&${viewingTimezoneQuery()}`,
    force)
}

async function loadViewingCatalogue(force = false) {
  return loadViewingResource(
    'catalogue', '', '/api/viewing-insights/catalogue', force)
}

async function loadViewingItem(force = false) {
  const identity = `${viewingInsightsRoute.itemId}:${viewingItemRange}`
  return loadViewingResource('item', identity,
    `/api/viewing-insights/item?item_id=${encodeURIComponent(viewingInsightsRoute.itemId)}&days=${viewingItemRange}&${viewingTimezoneQuery()}`,
    force)
}

async function loadViewingDiary(force = false) {
  return loadViewingResource('diary', viewingInsightsRoute.date,
    `/api/viewing-insights/diary?date=${encodeURIComponent(viewingInsightsRoute.date)}&${viewingTimezoneQuery()}`,
    force)
}

function loadViewingInsights(force = false) {
  $('#viewingInsights')?.classList.remove('hidden')
  const route = viewingInsightsRoute
  if (route.screen === 'dashboard') return loadViewingDashboard(force)
  if (route.screen === 'channels' || route.screen === 'films') {
    return loadViewingCatalogue(force)
  }
  if (route.screen === 'item') return loadViewingItem(force)
  if (route.screen === 'diary') return loadViewingDiary(force)
  return Promise.resolve()
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function openInsightsRoute(requested, event = null, options = {}) {
  if ($('#view-insights').classList.contains('active')) {
    insightsPositions.set(currentInsightsPath, {
      position: capturePortalPosition(), search: $('#viewingBrowseSearch').value,
    })
  }
  const saved = options.reset ? null : insightsPositions.get(requested)
  currentInsightsPath = requested
  if (requested.startsWith('insights/adult/')) {
    $('.insights-page')?.classList.add('is-child')
    $('#viewingRangeControls')?.classList.add('hidden')
    setMyInsightsMode('adult', { load: false })
    openAdultInsightsRoute(requested)
    openView('insights', { instantScroll: true, resetScroll: true })
    resetViewScroll()
    return
  }
  closeAdultInsightsRoute()
  const previousScreen = viewingInsightsRoute.screen
  const item = requested.match(
    /^insights\/item\/(.+)\/(summary|patterns|history)$/)
  const diary = requested.match(
    /^insights\/diary(?:\/(\d{4}-\d{2}-\d{2}))?$/)
  if (item) {
    viewingInsightsRoute = {
      screen: 'item', itemId: decodeURIComponent(item[1]), tab: item[2],
    }
  } else if (requested === 'insights/channels') {
    viewingInsightsRoute = { screen: 'channels' }
  } else if (requested === 'insights/films') {
    viewingInsightsRoute = { screen: 'films' }
  } else if (diary) {
    viewingInsightsRoute = { screen: 'diary', date: diary[1] || localDateKey() }
  } else {
    viewingInsightsRoute = { screen: 'dashboard' }
  }
  if ((viewingInsightsRoute.screen === 'channels'
       || viewingInsightsRoute.screen === 'films')
      && viewingInsightsRoute.screen !== previousScreen) {
    $('#viewingBrowseSearch').value = saved?.search || ''
  }
  $('.insights-page')?.classList.toggle(
    'is-child', viewingInsightsRoute.screen !== 'dashboard')
  $('#viewingRangeControls')?.classList.toggle(
    'hidden', viewingInsightsRoute.screen !== 'dashboard')
  setMyInsightsMode(requested === 'insights' ? 'adult' : 'mabel', { load: false })
  openView('insights', { instantScroll: true, resetScroll: true })
  renderInsightsRoute()
  loadViewingInsights().catch(() => {})
  if (saved) {
    restorePortalPosition(saved.position)
    settlePortalPosition(saved.position)
  } else {
    resetViewScroll()
  }
}

$$('[data-viewing-range]').forEach(button => {
  button.onclick = () => {
    viewingDashboardRange = Number(button.dataset.viewingRange)
    $$('[data-viewing-range]').forEach(option => option.classList.toggle(
      'active', Number(option.dataset.viewingRange) === viewingDashboardRange))
    loadViewingDashboard(true).catch(() => {})
  }
})
$$('[data-insights-destination]').forEach(button => {
  button.onclick = () => pushInsightsRoute(
    `insights/${button.dataset.insightsDestination}`)
})
$$('[data-insights-back]').forEach(button => {
  button.onclick = navigateInsightsBack
})
$$('[data-insights-tab]').forEach(button => {
  button.onclick = () => {
    if (!selectedViewingItemId) return
    replaceInsightsRoute(
      `insights/item/${encodeURIComponent(selectedViewingItemId)}/${button.dataset.insightsTab}`)
  }
})
$('#viewingItemRangeSelect').onchange = event => {
  viewingItemRange = Number(event.target.value)
  loadViewingItem().catch(() => {})
}
$('#viewingBrowseSearch').oninput = () => {
  if (['channels', 'films'].includes(viewingInsightsRoute.screen)) {
    preservePortalPosition(() => renderViewingBrowse(viewingInsightsRoute.screen))
  }
}
document.addEventListener('mabeltv:accent-change', () => renderInsightsRoute(true))
if (location.hash === '#insights' || location.hash.startsWith('#insights/')) {
  queueMicrotask(() => openInsightsRoute(location.hash.slice(1)))
}
