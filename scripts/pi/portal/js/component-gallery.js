'use strict';

(() => {
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="/portal/icons.svg#${name}"/></svg>`
  const signalIcon = (name) => `<svg class="icon signal-icon" aria-hidden="true"><use href="/portal/icons.svg#signal-${name}"/></svg>`
  const chevron = '<svg class="channel-page-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'
  const overflow = '<button type="button" class="channel-page-overflow" aria-label="More options"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button>'
  const SIGNAL_ICON_MAP = {
    home: 'house',
    'live-tv': 'radio',
    watch: 'clapperboard',
    usb: 'hard-drive',
    settings: 'settings',
    search: 'search',
    download: 'download',
  }
  const DIRECTIONS = {
    current: { tab: 'Current', label: 'Current portal', apply: 'current system' },
    signal: { tab: '01 · Signal', label: 'Signal · Direction 01', apply: 'Signal' },
    aperture: { tab: '02 · Aperture', label: 'Aperture · Direction 02', apply: 'Aperture' },
  }

  const escapeHtml = (value) => {
    const span = document.createElement('span')
    span.textContent = String(value ?? '')
    return span.innerHTML
  }

  const artwork = (kind, value) => value
    ? `/api/${kind}/artwork/${encodeURIComponent(value)}`
    : ''

  function samples(library) {
    const adult = (library?.adult_library || [])[0] || {}
    const channels = library?.channels || []
    const channel = channels.find(item => item.programmes?.length) || channels[0] || {}
    const programme = channel.programmes?.[0] || {}
    const filmTitle = adult.metadata?.title || adult.display_name || 'Casino Royale'
    const programmeTitle = programme.metadata?.title || programme.display_name || 'Postman Pat Takes the Bus'
    return {
      adult,
      channel,
      programme,
      filmTitle,
      filmYear: adult.metadata?.year || '2006',
      filmPoster: artwork('adult', adult.metadata?.poster),
      programmeTitle,
      channelName: channel.metadata?.title || channel.name || 'Postman Pat',
      channelNumber: channel.number || 1,
      channelArtwork: artwork('channel', channel.metadata?.artwork),
    }
  }

  const poster = (sample, className) => sample.filmPoster
    ? `<img class="${className}" src="${escapeHtml(sample.filmPoster)}" alt="Poster for ${escapeHtml(sample.filmTitle)}">`
    : `<span class="${className} component-poster-placeholder">${escapeHtml(sample.filmTitle.slice(0, 1))}</span>`

  const SECTIONS = [
    {
      id: 'foundations',
      title: 'Foundations & status',
      description: 'Type, colour, labels and feedback shared by every portal page.',
      specimens: [
        { title: 'Type hierarchy', tags: 'heading eyebrow body caption', wide: true, render: () => '<div class="component-type-sample"><p class="eyebrow">Section eyebrow</p><h1>Primary page heading.</h1><h2>Section heading</h2><p>Body copy explains what is happening in clear, calm language.</p><small>Supporting detail and metadata</small></div>' },
        { title: 'Core colour tokens', tags: 'colour palette tokens theme', render: () => '<div class="component-swatches"><span class="canvas"><i></i>Canvas</span><span class="surface-one"><i></i>Surface</span><span class="text"><i></i>Text</span><span class="accent"><i></i>Accent</span><span class="danger-swatch"><i></i>Danger</span></div>' },
        { title: 'Badges & state', tags: 'badge status health count format', render: () => '<div class="component-inline-wrap"><span class="health-pill">TV healthy</span><span class="count-badge">37 films</span><span class="watch-format">VLC READY</span><span class="remote-state-pill">Live</span></div>' },
        { title: 'Notices & callouts', tags: 'notice error warning feedback progress', wide: true, render: () => '<div class="component-stack"><p class="notice">Film added to the library.</p><p class="notice bad">The drive needs to be reconnected.</p><div class="callout"><strong>Preparing your film</strong><p>Metadata and subtitles are being checked.</p><progress max="100" value="58"></progress></div></div>' },
      ],
    },
    {
      id: 'actions',
      title: 'Buttons & actions',
      description: 'Primary, secondary, destructive and compact actions, including close controls.',
      specimens: [
        { title: 'Button hierarchy', tags: 'button primary secondary danger disabled', wide: true, render: () => '<div class="component-inline-wrap component-button-hierarchy"><button type="button">Primary action</button><button type="button" class="secondary">Secondary</button><button type="button" class="danger">Destructive</button><button type="button" disabled>Unavailable</button></div>' },
        { title: 'Close & overflow controls', tags: 'close x cancel overflow more icon', render: () => '<div class="component-icon-row"><button type="button" class="library-sheet-close dialog-close" aria-label="Close"></button><button type="button" class="watch-film-close dialog-close" aria-label="Close film"></button>' + overflow + '</div>' },
        { title: 'Playback destinations', tags: 'play tv device download media action', wide: true, render: () => '<div class="watch-film-actions component-action-list"><button type="button" class="watch-film-play"><span class="watch-action-icon">TV</span><span><strong>Resume on TV</strong><small>Continue from 1h 7m</small></span></button><button type="button" class="watch-film-play"><span class="watch-action-icon">▶</span><span><strong>Resume on this device</strong><small>Uses the shared film position</small></span></button><button type="button" class="watch-film-secondary">' + icon('download') + '<span>Download to this device</span></button></div>' },
      ],
    },
    {
      id: 'controls',
      title: 'Inputs & selection',
      description: 'The controls used to search, filter and tune MabelTV.',
      specimens: [
        { title: 'Text, search & dropdown', tags: 'input search select dropdown text', render: () => '<div class="component-stack"><label>Film title<input type="text" value="Casino" aria-label="Film title"></label><label>Collection<select aria-label="Collection"><option>All films</option><option>Unfiled</option></select></label><label class="watch-search">' + icon('search') + '<input type="search" placeholder="Search films" aria-label="Search films"></label></div>' },
        { title: 'Range slider', tags: 'slider range percentage volume', render: () => '<div class="range-setting component-range"><label for="componentRange">Maximum volume</label><input id="componentRange" type="range" min="0" max="100" value="60"><output for="componentRange">60%</output></div>' },
        { title: 'Tabs & segmented filters', tags: 'tabs filter segmented selection', wide: true, render: () => '<div class="component-stack"><div class="watch-tabs"><button type="button" class="active">Adult</button><button type="button">MabelTV</button><button type="button">Downloads</button></div><div class="adult-folder-tabs"><button type="button" class="adult-folder-tab active">All films</button><button type="button" class="adult-folder-tab">Bond</button><button type="button" class="adult-folder-tab">Family</button></div></div>' },
        { title: 'Feature toggle', tags: 'toggle setting switch control', wide: true, render: () => '<div class="feature-control"><div><strong>TV guide is on</strong><p class="small muted">Hold OK / Select to open it on the television.</p></div><button type="button" class="feature-toggle" aria-pressed="true">Turn off</button></div>' },
      ],
    },
    {
      id: 'navigation',
      title: 'Navigation & player chrome',
      description: 'Wayfinding from the portal shell through to native phone playback.',
      specimens: [
        { title: 'Portal navigation', tags: 'navigation nav home live watch usb settings', wide: true, dark: true, render: () => '<nav class="portal-nav component-nav-preview" aria-label="Navigation example"><button type="button">' + icon('home') + 'Home<span class="nav-dot"></span></button><button type="button">' + icon('live-tv') + 'Live TV<span class="nav-dot"></span></button><button type="button" class="active">' + icon('watch') + 'Watch<span class="nav-dot"></span></button><button type="button">' + icon('usb') + 'USB<span class="nav-dot"></span></button><button type="button">' + icon('settings') + 'Settings<span class="nav-dot"></span></button></nav>' },
        { title: 'Inline player top bar', tags: 'player header back start over native iphone', wide: true, dark: true, render: () => '<header class="ios-watch-head component-player-head"><button type="button" class="ios-watch-back" aria-label="Back to library">←</button><div><strong>Passengers (2016)</strong><small>MabelTV remote viewing</small></div><button type="button">Start over</button></header>' },
        { title: 'Channel back link', tags: 'back breadcrumb channel navigation', render: () => '<nav class="channel-page-nav"><button type="button" class="channel-page-back">← Back to MabelTV</button></nav>' },
      ],
    },
    {
      id: 'adult-cards',
      title: 'Adult TV & playback cards',
      description: 'Film discovery, continuing, organising and offline playback.',
      specimens: [
        { title: 'Film card', tags: 'adult film poster library card progress', render: (s) => `<button type="button" class="watch-card component-film-card"><span class="watch-card-art">${poster(s, 'component-film-poster')}<span class="watch-progress"><span data-gallery-progress="56"></span></span></span><span class="watch-card-copy"><strong>${escapeHtml(s.filmTitle)}</strong><small>${escapeHtml(s.filmYear)} · Unfiled</small></span></button>` },
        { title: 'Continue Watching card', tags: 'continue resume film progress card', wide: true, render: (s) => `<div class="watch-continue-item component-continue"><button type="button" class="watch-continue-card"><span class="watch-continue-art" data-gallery-progress-ring="56">${poster(s, 'component-film-poster')}</span><span class="watch-continue-copy"><small>Continue</small><strong>${escapeHtml(s.filmTitle)}</strong><span>1h 7m watched</span><i>▶</i></span></button></div>` },
        { title: 'Organise-film row', tags: 'adult organiser film row metadata open', wide: true, render: (s) => `<button type="button" class="adult-film component-adult-row">${poster(s, 'adult-film-poster')}<span class="adult-film-copy"><strong>${escapeHtml(s.filmTitle)}</strong><small>${escapeHtml(s.filmYear)} · Unfiled · Original</small></span><span class="adult-film-more" aria-hidden="true">${chevron}</span></button>` },
        { title: 'Offline download card', tags: 'download offline saved progress card', wide: true, render: (s) => `<article class="download-card"><div class="download-card-head"><span class="download-card-icon">▶</span><span class="download-card-copy"><strong>${escapeHtml(s.filmTitle)}</strong><small>Ready offline · 2.10 GB</small></span></div><div class="download-card-actions"><button type="button">Watch offline</button><button type="button" class="danger">Remove</button></div></article>` },
      ],
    },
    {
      id: 'channel-cards',
      title: 'MabelTV & channel cards',
      description: 'The children’s channel identity, episode tiles and channel-management rows.',
      specimens: [
        { title: 'Kids channel identity', tags: 'kids mabel show channel identity hero card', wide: true, dark: true, render: (s) => `<button type="button" class="mabel-show-identity component-show-identity"${s.channelArtwork ? ` data-gallery-background="${escapeHtml(s.channelArtwork)}"` : ''}><div><span>CH ${escapeHtml(s.channelNumber)} · 26 episodes</span><h2>${escapeHtml(s.channelName)}</h2><p>Warm stories ready to watch on MabelTV or this device.</p></div></button>` },
        { title: 'Episode tile', tags: 'episode programme kids mabel card', render: (s) => `<button type="button" class="watch-programme watch-mabel-episode"><span class="watch-mabel-copy"><small>S01 E01</small><strong>${escapeHtml(s.programmeTitle)}</strong><span>Choose where to watch ›</span></span></button>` },
        { title: 'Channel-page episode row', tags: 'channel page episode row overflow', wide: true, render: (s) => `<article class="channel-page-show-card"><button type="button" class="channel-page-show-main"><span class="channel-page-episode">S01E01</span><span class="channel-page-show-copy"><strong>${escapeHtml(s.programmeTitle)}</strong><small>Choose where to watch</small></span>${chevron}</button>${overflow}</article>` },
        { title: 'Channel-page film card', tags: 'channel page film poster grid card', render: (s) => `<article class="channel-page-film-card component-channel-film"><button type="button" class="channel-page-film-main"><span class="channel-page-poster is-placeholder">${escapeHtml(s.filmTitle.slice(0, 1))}</span><span class="channel-page-film-copy"><strong>${escapeHtml(s.filmTitle)}</strong><small>${escapeHtml(s.filmYear)} · Choose where to watch</small></span></button>${overflow}</article>` },
        { title: 'Channel management card', tags: 'channel management library card programmes', wide: true, render: (s) => `<button type="button" class="channel-card library-main-card component-channel-management"><span class="library-card-top"><span class="library-channel-pill">CH ${escapeHtml(s.channelNumber)}</span><span class="library-channel-state">On TV</span></span><span class="channel-card-copy"><h3>${escapeHtml(s.channelName)}</h3><span class="channel-card-detail">26 programmes · Shows</span><span class="library-card-preview">${escapeHtml(s.programmeTitle)} <em>+ 25 more</em></span></span><span class="library-card-footer"><span>26 shown on TV</span><span>Open channel ${chevron}</span></span></button>` },
        { title: 'Programme management row', tags: 'programme management row rename hide bin', wide: true, render: (s) => `<article class="programme component-programme-row"><span><strong>${escapeHtml(s.programmeTitle)}</strong><small>Shown on MabelTV · 24 minutes</small></span><div class="programme-actions"><button type="button" class="secondary">Hide</button><button type="button" class="secondary">Rename</button></div></article>` },
      ],
    },
    {
      id: 'live-settings',
      title: 'Live TV, settings & creation',
      description: 'Remote-control clusters, visual choices and the media upload entry point.',
      specimens: [
        { title: 'Remote destinations', tags: 'remote live tv destination guide menu adult', wide: true, render: () => '<div class="remote-mode-row component-remote-modes"><button type="button" class="remote-mode"><span class="remote-mode-icon">' + icon('watch') + '</span><span><strong>MabelTV</strong><small>Children’s channels</small></span></button><button type="button" class="remote-mode"><span class="remote-mode-icon">' + icon('live-tv') + '</span><span><strong>Guide</strong><small>What’s on now</small></span></button><button type="button" class="remote-mode"><span class="remote-mode-icon">' + icon('settings') + '</span><span><strong>Menu</strong><small>Parent controls</small></span></button><button type="button" class="remote-mode"><span class="remote-mode-icon">' + icon('watch') + '</span><span><strong>Adult TV</strong><small>Private library</small></span></button></div>' },
        { title: 'Remote playback controls', tags: 'remote transport previous restart pause subtitles next', wide: true, dark: true, render: () => '<div class="remote-transport component-remote-transport"><button type="button"><span>Previous</span></button><button type="button"><span>Restart</span></button><button type="button" class="remote-play"><span>Pause</span></button><button type="button"><span>Subtitles</span></button><button type="button"><span>Next</span></button></div>' },
        { title: 'Portal theme choice', tags: 'theme appearance dark light picker', wide: true, render: () => '<div class="portal-theme-picker component-theme-picker"><button type="button" class="active"><span class="theme-preview theme-preview-dark"><i></i><i></i><i></i></span><span><strong>Dark cinema</strong><small>Rich charcoal surfaces and warm highlights</small></span></button><button type="button"><span class="theme-preview theme-preview-light"><i></i><i></i><i></i></span><span><strong>Soft daylight</strong><small>Warm white, crisp type and gentle depth</small></span></button></div>' },
        { title: 'Parent-menu design choice', tags: 'design setting visual option parent menu', render: () => '<button type="button" class="design-option component-design-option"><span class="design-preview modern"><span class="mini-rail"></span><span class="mini-page"><span class="mini-line"></span><span class="mini-line"></span><span class="mini-line"></span></span></span><span class="design-copy"><strong>Modern family</strong><small>A warmer, clearer app-style design</small></span></button>' },
        { title: 'Upload drop-zone', tags: 'upload add film programme file drop field', render: () => '<label class="drop-field component-drop-field"><input type="file" disabled><span class="drop-copy"><span class="drop-icon">' + icon('download') + '</span><strong>Choose videos</strong><small>Select one or several files</small></span></label>' },
      ],
    },
    {
      id: 'sheets-storage',
      title: 'Sheets, storage & empty states',
      description: 'Bottom sheets, connected drives, file rows and quiet empty states.',
      specimens: [
        { title: 'Bottom-sheet header & actions', tags: 'modal sheet dialog close actions', wide: true, render: () => '<section class="library-sheet-panel component-sheet-preview"><span class="library-sheet-handle"></span><header class="library-sheet-head"><div><p class="section-kicker">Film options</p><h2>Choose what happens next</h2><p>Actions and details live in a focused sheet.</p></div><button type="button" class="library-sheet-close dialog-close" aria-label="Close"></button></header><div class="library-sheet-body"><div class="library-sheet-actions"><button type="button" class="secondary">Cancel</button><button type="button">Save changes</button></div></div></section>' },
        { title: 'USB drive', tags: 'usb storage drive sleep connected', render: () => '<article class="usb-drive active"><div class="usb-drive-copy"><strong>Media Drive</strong><small>931 GB · Sleeping until needed</small></div><button type="button" class="secondary">Browse drive</button></article>' },
        { title: 'USB file row', tags: 'usb file video copy select', wide: true, render: () => '<article class="usb-file"><div class="usb-file-copy"><strong>Family Holiday.mp4</strong><small>1.84 GB · Video</small></div><div class="usb-file-actions"><button type="button" class="secondary">Watch</button><button type="button">Copy</button></div></article>' },
        { title: 'Empty state', tags: 'empty blank no results state', render: () => '<div class="empty"><strong>No matching films</strong>Try a different title or collection.</div>' },
      ],
    },
  ]

  const specimenCount = SECTIONS.reduce((total, section) => total + section.specimens.length, 0)
  let activeMode = 'current'
  let rendered = false
  let currentLibrary = null

  function renderSpecimen(specimen, sample, direction) {
    const classes = ['component-specimen']
    if (specimen.wide) classes.push('wide')
    const tags = `${specimen.title} ${specimen.tags || ''}`.toLocaleLowerCase()
    const label = DIRECTIONS[direction]?.label || DIRECTIONS.current.label
    return `<article class="${classes.join(' ')}" data-component-search="${escapeHtml(tags)}"><header><div><p>${escapeHtml(specimen.title)}</p><span>${label}</span></div></header><div class="component-stage${specimen.dark ? ' component-stage-dark' : ''}" data-component-preview>${specimen.render(sample)}</div></article>`
  }

  function renderInventory(sample, direction) {
    return SECTIONS.map(section => `<section id="component-family-${direction}-${section.id}" class="component-family" data-component-family><header class="component-family-head"><div><p class="section-kicker">Component family</p><h2>${escapeHtml(section.title)}</h2></div><p>${escapeHtml(section.description)}</p></header><div class="component-inventory">${section.specimens.map(specimen => renderSpecimen(specimen, sample, direction)).join('')}</div></section>`).join('')
  }

  function renderSignalDirection(sample) {
    return `<section id="componentGalleryDirection" class="component-alternatives component-theme-signal"><header class="signal-direction-intro"><div class="signal-direction-index"><span>01</span><small>MABELTV / DESIGN DIRECTION</small></div><div class="signal-direction-copy"><p>Warm broadcast modernism</p><h2>Signal</h2><p>A quieter, more exact media interface: editorial typography, disciplined geometry, real optical icons and colour used as information—not decoration.</p></div><dl><div><dt>Character</dt><dd>Warm · precise · assured</dd></div><div><dt>Geometry</dt><dd>6px controls · 8px cards</dd></div><div><dt>Icon system</dt><dd>Lucide · 1.8px optical stroke</dd></div></dl></header><div class="signal-principles"><span><b>01</b> Content leads</span><span><b>02</b> One accent, one purpose</span><span><b>03</b> Quiet surfaces, exact states</span></div>${renderInventory(sample, 'signal')}</section>`
  }

  function renderApertureDirection(sample) {
    return `<section id="componentGalleryDirection" class="component-alternatives component-theme-aperture"><header class="aperture-direction-intro"><div class="aperture-orbit" aria-hidden="true"><span></span><i></i></div><div class="aperture-direction-copy"><p>Immersive domestic cinema</p><h2>Aperture</h2><p>The interface recedes and the media takes the room: floating controls, deep spatial layers and navigation that behaves like a cinema console.</p></div><dl><div><dt>Character</dt><dd>Immersive · tactile · cinematic</dd></div><div><dt>Geometry</dt><dd>Floating layers · 24px fields</dd></div><div><dt>Motion</dt><dd>Depth, focus and a single viewing axis</dd></div></dl></header><div class="aperture-principles"><span><b>01</b> Artwork owns the frame</span><span><b>02</b> Controls float, never crowd</span><span><b>03</b> Depth communicates priority</span></div>${renderInventory(sample, 'aperture')}</section>`
  }

  function renderGallery(sample) {
    const content = activeMode === 'signal'
      ? renderSignalDirection(sample)
      : activeMode === 'aperture'
        ? renderApertureDirection(sample)
        : `<div id="componentGalleryCurrent">${renderInventory(sample, 'current')}</div>`
    const direction = DIRECTIONS[activeMode] || DIRECTIONS.current
    const searchIcon = activeMode === 'current' ? icon('search') : signalIcon('search')
    const tabs = Object.entries(DIRECTIONS).map(([id, item]) => `<button type="button" class="${activeMode === id ? 'active' : ''}" data-gallery-mode="${id}" role="tab" aria-selected="${activeMode === id}">${item.tab}</button>`).join('')
    return `<div class="component-gallery-toolbar surface"><div class="component-gallery-modes" role="tablist" aria-label="Component views">${tabs}</div><button type="button" class="component-gallery-apply" data-apply-gallery-design="${activeMode}" data-apply-gallery-label="${direction.apply}" aria-pressed="false">Use ${direction.apply}</button><label class="component-gallery-search">${searchIcon}<input id="componentGallerySearch" type="search" placeholder="Find a component" autocomplete="off" aria-label="Find a component"></label></div><nav class="component-gallery-index" aria-label="Component families">${SECTIONS.map(section => `<button type="button" data-gallery-section="${section.id}">${escapeHtml(section.title)}</button>`).join('')}</nav>${content}`
  }

  function hydrateDirection(root, selector) {
    const theme = root.querySelector(selector)
    if (!theme) return
    theme.querySelectorAll('use').forEach(use => {
      const href = use.getAttribute('href') || ''
      const mapped = SIGNAL_ICON_MAP[href.split('#').pop()]
      if (mapped) use.setAttribute('href', `/portal/icons.svg#signal-${mapped}`)
    })
    theme.querySelectorAll('.dialog-close').forEach(button => { button.innerHTML = signalIcon('x') })
    theme.querySelectorAll('.channel-page-overflow').forEach(button => { button.innerHTML = signalIcon('ellipsis') })
    theme.querySelectorAll('.channel-page-chevron').forEach(svg => { svg.innerHTML = '<use href="/portal/icons.svg#signal-chevron-right"/>' })
    const playerBack = theme.querySelector('.component-player-head .ios-watch-back')
    if (playerBack) playerBack.innerHTML = signalIcon('chevron-left')
    const channelBack = theme.querySelector('.channel-page-back')
    if (channelBack) channelBack.innerHTML = `${signalIcon('chevron-left')}<span>Back to MabelTV</span>`
    const destinations = theme.querySelectorAll('.component-action-list .watch-action-icon')
    if (destinations[0]) destinations[0].innerHTML = signalIcon('monitor-play')
    if (destinations[1]) destinations[1].innerHTML = signalIcon('play')
    const continuePlay = theme.querySelector('.component-continue .watch-continue-copy i')
    if (continuePlay) continuePlay.innerHTML = signalIcon('play')
    const downloadPlay = theme.querySelector('.download-card-icon')
    if (downloadPlay) downloadPlay.innerHTML = signalIcon('play')
    const uploadIcon = theme.querySelector('.component-drop-field use')
    if (uploadIcon) uploadIcon.setAttribute('href', '/portal/icons.svg#signal-upload')
    const transportIcons = ['skip-back', 'restart', 'play', 'captions', 'skip-forward']
    theme.querySelectorAll('.component-remote-transport button').forEach((button, index) => {
      const label = button.textContent.trim()
      button.innerHTML = `${signalIcon(transportIcons[index])}<span>${escapeHtml(label)}</span>`
    })
  }

  function hydrate(root) {
    root.querySelectorAll('[data-gallery-progress]').forEach(item => { item.style.width = `${item.dataset.galleryProgress}%` })
    root.querySelectorAll('[data-gallery-progress-ring]').forEach(item => { item.style.setProperty('--watch-progress', `${item.dataset.galleryProgressRing}%`) })
    root.querySelectorAll('[data-gallery-background]').forEach(item => {
      const signal = Boolean(item.closest('.component-theme-signal'))
      const aperture = Boolean(item.closest('.component-theme-aperture'))
      const gradient = aperture
        ? 'linear-gradient(135deg, rgb(4 7 9 / 28%), rgb(4 7 9 / 86%))'
        : signal
          ? 'linear-gradient(90deg, rgb(17 22 21 / 92%), rgb(17 22 21 / 12%))'
          : 'linear-gradient(90deg, rgb(0 0 0 / 84%), rgb(0 0 0 / 22%))'
      item.style.backgroundImage = `${gradient}, url("${item.dataset.galleryBackground}")`
    })
    const range = root.querySelector('#componentRange')
    if (range) range.oninput = () => { range.nextElementSibling.value = `${range.value}%` }
    hydrateDirection(root, '.component-theme-signal')
    hydrateDirection(root, '.component-theme-aperture')
  }

  function filterInventory(value) {
    const root = document.querySelector('#componentGalleryRoot')
    if (!root) return
    const query = value.trim().toLocaleLowerCase()
    let visible = 0
    const inventory = root.querySelector(activeMode === 'current' ? '#componentGalleryCurrent' : '#componentGalleryDirection')
    inventory?.querySelectorAll('[data-component-search]').forEach(item => {
      const show = !query || item.dataset.componentSearch.includes(query)
      item.classList.toggle('hidden', !show)
      if (show) visible += 1
    })
    inventory?.querySelectorAll('[data-component-family]').forEach(section => {
      section.classList.toggle('hidden', !section.querySelector('[data-component-search]:not(.hidden)'))
    })
    const count = document.querySelector('#componentInventoryCount')
    if (count) {
      const direction = activeMode === 'current' ? '' : ` · ${DIRECTIONS[activeMode].apply} direction`
      count.textContent = query ? `${visible} of ${specimenCount} components${direction}` : `${specimenCount} components · ${SECTIONS.length} families${direction}`
    }
  }

  function bind(root) {
    root.querySelectorAll('[data-component-preview]').forEach(stage => {
      stage.addEventListener('click', event => {
        if (event.target.closest('button, a')) event.preventDefault()
      })
    })
    root.querySelectorAll('[data-gallery-mode]').forEach(button => {
      button.onclick = () => {
        activeMode = button.dataset.galleryMode
        render(currentLibrary, true)
      }
    })
    root.querySelector('[data-apply-gallery-design]')?.addEventListener('click', event => {
      window.MabelPortalAppearance?.select('design', event.currentTarget.dataset.applyGalleryDesign)
    })
    root.querySelectorAll('[data-gallery-section]').forEach(button => {
      button.onclick = () => document.querySelector(`#component-family-${activeMode}-${button.dataset.gallerySection}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    root.querySelector('#componentGallerySearch')?.addEventListener('input', event => filterInventory(event.target.value))
  }

  function render(library, force = false) {
    currentLibrary = library || currentLibrary
    const root = document.querySelector('#componentGalleryRoot')
    if (!root) return
    if (rendered && !force) {
      window.MabelPortalAppearance?.preview(activeMode)
      return
    }
    root.innerHTML = renderGallery(samples(currentLibrary))
    hydrate(root)
    bind(root)
    window.MabelPortalAppearance?.preview(activeMode)
    filterInventory('')
    rendered = true
  }

  window.MabelComponentGallery = { render, sections: SECTIONS }
  if (document.querySelector('#view-components')?.classList.contains('active')) {
    render(window.MabelPortalLibrary)
  }
})()
