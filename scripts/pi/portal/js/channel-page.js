'use strict'

const ChannelPageComponents = (() => {
  const artworkPath = name => `/api/channel/artwork/${encodeURIComponent(name)}`

  function signalIcon(name, className = 'icon') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    svg.classList.add(...className.split(' ').filter(Boolean))
    svg.setAttribute('aria-hidden', 'true')
    use.setAttribute('href', `/portal/icons.svg#${name}`)
    svg.append(use)
    return svg
  }

  function mount() {
    const root = document.querySelector('[data-channel-page-root]')
    if (!root || root.dataset.mounted === 'true') return
    root.dataset.mounted = 'true'
    root.classList.add('channel-page')
    root.innerHTML = `
      <nav class="channel-page-nav" aria-label="Channel navigation">
        <button id="backToChannels" type="button" class="workspace-back channel-page-back">
          <svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#signal-arrow-left"/></svg>
          <span>All channels</span>
        </button>
      </nav>
      <section id="channelPageHero" class="channel-page-hero" aria-labelledby="workspaceChannelName">
        <div class="channel-page-hero-art" aria-hidden="true"></div>
        <div class="channel-page-hero-shade" aria-hidden="true"></div>
        <div class="channel-page-hero-content">
          <div class="channel-page-identity">
            <span id="workspaceChannelBadge" class="channel-page-badge">CH</span>
            <div>
              <p id="workspaceEyebrow" class="channel-page-eyebrow">MabelTV channel</p>
              <h1 id="workspaceChannelName">Channel</h1>
            </div>
          </div>
          <p id="workspaceChannelStatus" class="channel-page-overview"></p>
          <div class="channel-page-facts" aria-label="Channel details">
            <span><strong id="workspaceProgrammeCount">0</strong> <span id="workspaceProgrammeLabel">programmes</span></span>
            <span><strong id="workspaceVisibleCount">0</strong> on TV</span>
            <span><strong id="workspacePictureMode">Fill screen</strong></span>
          </div>
          <div class="channel-page-actions">
            <button id="channelWatchTv" type="button" class="channel-page-primary">
              <svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#signal-monitor-play"/></svg>
              <span><strong>Open on TV</strong><small>Switch MabelTV to this channel</small></span>
            </button>
            <button id="workspaceAddMedia" type="button" class="channel-page-secondary" aria-label="Add videos">
              <svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#signal-plus"/></svg>
              <span>Add videos</span>
            </button>
            <button id="workspaceFavourite" type="button" class="channel-page-icon channel-page-favourite hidden" aria-label="Add channel to favourites">
              <svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#signal-heart"/></svg>
            </button>
            <button id="workspaceSettings" type="button" class="channel-page-icon" aria-label="Manage channel">
              <svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#signal-settings"/></svg>
            </button>
          </div>
        </div>
      </section>
      <section class="channel-page-library" aria-labelledby="channelLibraryTitle">
        <header class="channel-page-library-head">
          <div>
            <p class="channel-page-kicker">Channel library</p>
            <h2 id="channelLibraryTitle">Everything in this channel</h2>
            <p id="channelSummary">Browse every programme in this channel.</p>
          </div>
          <span id="channelResultCount" class="channel-page-result-count"></span>
        </header>
        <div class="channel-page-toolbar">
          <label class="channel-page-search">
            <svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#signal-search"/></svg>
            <span>Find a programme</span>
            <input id="programmeSearch" type="search" placeholder="Search titles" autocomplete="off">
          </label>
        </div>
        <div id="channels" class="channel-page-programmes"></div>
        <div id="programmePager" class="channel-page-more hidden"></div>
      </section>`
  }

  function episodeDetails(programme, ordinal) {
    const match = programme.name.match(/^(S\d+E\d+)/i)
    const marker = match?.[1]?.toUpperCase() || String(ordinal).padStart(2, '0')
    const original = programme.metadata?.title || programme.display_name
    if (!match) return { marker, title: original }
    const withoutMarker = original.replace(/^S\d+E\d+\s*(?:[-–—:|]\s*)?/i, '').trim()
    return { marker, title: withoutMarker || original }
  }

  function createShowCard(channel, programme, ordinal, onOpen) {
    const details = episodeDetails(programme, ordinal)
    const card = document.createElement('article')
    card.className = `channel-page-show-card${programme.enabled ? '' : ' is-hidden'}`

    const main = document.createElement('button')
    main.type = 'button'
    main.className = 'channel-page-show-main'
    main.setAttribute('aria-label', `Choose where to watch ${programme.display_name}`)

    const marker = document.createElement('span')
    marker.className = 'channel-page-episode'
    const markerParts = details.marker.match(/^(S\d+)(E\d+)$/i)
    if (markerParts) {
      const season = document.createElement('span')
      season.className = 'channel-page-season'
      season.textContent = markerParts[1]
      const episode = document.createElement('span')
      episode.className = 'channel-page-episode-number'
      episode.textContent = markerParts[2]
      marker.append(season, episode)
    } else marker.textContent = details.marker

    const copy = document.createElement('span')
    copy.className = 'channel-page-show-copy'
    const title = document.createElement('strong')
    title.textContent = details.title
    const hint = document.createElement('small')
    hint.textContent = programme.enabled ? 'Choose where to watch' : 'Hidden from the TV channel'
    copy.append(title, hint)

    const chevron = signalIcon('signal-chevron-right', 'channel-page-chevron')

    main.append(marker, copy, chevron)
    main.onclick = () => onOpen(channel, programme)
    card.append(main)
    return card
  }

  function createPoster(programme) {
    const metadata = programme.metadata || {}
    const visual = document.createElement('span')
    visual.className = 'watch-card-art'

    const showPlaceholder = () => {
      const placeholder = document.createElement('span')
      placeholder.className = 'watch-card-placeholder'
      placeholder.textContent = (metadata.title || programme.display_name).slice(0, 1).toUpperCase()
      visual.replaceChildren(placeholder)
    }

    if (!metadata.poster) {
      showPlaceholder()
      return visual
    }
    const image = document.createElement('img')
    image.src = artworkPath(metadata.poster)
    image.alt = ''
    image.loading = 'lazy'
    image.decoding = 'async'
    image.onerror = showPlaceholder
    visual.append(image)
    return visual
  }

  function filmTimeLabel(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0))
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours) return `${hours}h ${minutes}m`
    return `${Math.max(1, minutes)}m`
  }

  function filmResumeState(programme) {
    const position = Math.max(0, Number(programme.remote_position) || 0)
    const duration = Math.max(0, Number(programme.remote_duration) || 0)
    const completionWindow = duration
      ? Math.min(Math.max(180, duration * .05), duration * .2)
      : 0
    const resumable = position >= 30 && (!duration || position < duration - completionWindow)
    const progress = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0
    return { position, resumable, progress }
  }

  function createFilmCard(channel, programme, onOpen) {
    const metadata = programme.metadata || {}
    const title = metadata.title || programme.display_name
    const resume = filmResumeState(programme)
    const card = document.createElement('button')
    card.type = 'button'
    card.className = `watch-card channel-page-film-card${programme.enabled ? '' : ' is-hidden'}`
    card.setAttribute('aria-label', `${title}${resume.resumable ? `, resume at ${filmTimeLabel(resume.position)}` : ''}`)
    const visual = createPoster(programme)
    if (programme.browser_ready === false) {
      const format = document.createElement('span')
      format.className = 'watch-format'
      format.textContent = 'VLC READY'
      visual.append(format)
    }
    if (!programme.enabled) {
      const hidden = document.createElement('span')
      hidden.className = 'channel-page-hidden-chip'
      hidden.textContent = 'Hidden'
      visual.append(hidden)
    }
    if (resume.resumable && resume.progress) {
      const progress = document.createElement('span')
      progress.className = 'watch-progress'
      const fill = document.createElement('span')
      fill.style.width = `${resume.progress}%`
      progress.append(fill)
      visual.append(progress)
    }
    const copy = document.createElement('span')
    copy.className = 'watch-card-copy'
    const heading = document.createElement('strong')
    heading.textContent = title
    const meta = document.createElement('small')
    meta.textContent = resume.resumable
      ? `Resume · ${filmTimeLabel(resume.position)}`
      : [metadata.year, channel.name].filter(Boolean).join(' · ') || 'Film'
    copy.append(heading, meta)
    card.append(visual, copy)
    card.onclick = () => onOpen(channel, programme)
    return card
  }

  function renderHero(channel, handlers) {
    const metadata = channel.metadata || {}
    const isFilms = channel.content_type === 'films'
    const title = metadata.title || channel.name
    const heroArtwork = metadata.artwork || (isFilms
      ? channel.programmes.find(programme => programme.metadata?.poster)?.metadata.poster
      : '')
    const hero = document.querySelector('#channelPageHero')
    document.querySelector('[data-channel-page-root]').classList.toggle('is-film-channel', isFilms)
    hero.style.setProperty('--channel-page-art', heroArtwork ? `url("${artworkPath(heroArtwork)}")` : 'none')
    hero.classList.toggle('has-artwork', Boolean(heroArtwork))
    document.querySelector('#workspaceChannelBadge').textContent = `CH ${channel.number}`
    document.querySelector('#workspaceEyebrow').textContent = `CH ${channel.number} · ${isFilms ? 'Film channel' : 'Series channel'}`
    document.querySelector('#workspaceChannelName').textContent = title
    document.querySelector('#workspaceChannelStatus').textContent = metadata.overview || (isFilms
      ? 'Your own film channel, ready to play on the television or this device.'
      : 'Every episode in one place, ready to play on the television or this device.')
    document.querySelector('#workspaceProgrammeCount').textContent = channel.programmes.length
    document.querySelector('#workspaceProgrammeLabel').textContent = isFilms
      ? `film${channel.programmes.length === 1 ? '' : 's'}`
      : `episode${channel.programmes.length === 1 ? '' : 's'}`
    document.querySelector('#workspaceVisibleCount').textContent = channel.enabled ? channel.enabled_programmes : 0
    document.querySelector('#workspacePictureMode').textContent = handlers.aspectLabel(channel.aspect)
  }

  function renderLibrary({ channel, filtered, page, pageSize, search, onOpen, onLoadMore }) {
    const isFilms = channel.content_type === 'films'
    const visibleCount = isFilms
      ? filtered.length
      : Math.min(filtered.length, page * pageSize)
    const visible = filtered.slice(0, visibleCount)
    const root = document.querySelector('#channels')
    root.replaceChildren()
    root.className = `channel-page-programmes ${isFilms ? 'is-film-grid watch-poster-grid' : 'is-show-list'}`

    document.querySelector('#channelLibraryTitle').textContent = isFilms ? 'Films in this channel' : 'Episodes in this channel'
    document.querySelector('#channelSummary').textContent = search
      ? `${filtered.length} matching ${isFilms ? 'film' : 'episode'}${filtered.length === 1 ? '' : 's'}`
      : isFilms ? `${filtered.length} films in this channel.` : 'Choose an episode, then decide where to watch it.'
    document.querySelector('#channelResultCount').textContent = `${filtered.length} ${isFilms ? 'film' : 'episode'}${filtered.length === 1 ? '' : 's'}`
    document.querySelector('#programmeSearch').placeholder = isFilms ? 'Search films' : 'Search episodes'
    document.querySelector('#programmeSearch').value = search

    if (!visible.length) {
      const empty = document.createElement('div')
      empty.className = 'channel-page-empty'
      const heading = document.createElement('strong')
      const message = document.createElement('span')
      heading.textContent = channel.programmes.length ? 'Nothing matches that search' : `No ${isFilms ? 'films' : 'episodes'} yet`
      message.textContent = channel.programmes.length ? 'Try another title.' : 'Use Add videos to put the first one here.'
      empty.append(heading, message)
      root.append(empty)
    } else {
      visible.forEach((programme, index) => {
        const ordinal = filtered.indexOf(programme) + 1
        root.append(isFilms
          ? createFilmCard(channel, programme, onOpen)
          : createShowCard(channel, programme, ordinal, onOpen))
      })
    }

    const more = document.querySelector('#programmePager')
    more.replaceChildren()
    const hasMore = !isFilms && visibleCount < filtered.length
    more.classList.toggle('hidden', !hasMore)
    if (hasMore) {
      const status = document.createElement('span')
      status.textContent = `Showing ${visibleCount} of ${filtered.length}`
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'channel-page-load-more'
      button.append(
        signalIcon('signal-chevron-down'),
        document.createTextNode(`Show ${Math.min(pageSize, filtered.length - visibleCount)} more`)
      )
      button.onclick = onLoadMore
      more.append(status, button)
    }
  }

  mount()
  return { mount, renderHero, renderLibrary, episodeDetails }
})()
