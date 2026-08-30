'use strict'

;(() => {
  const DESIGNS = [
    { id: 'current', name: 'Current system', note: 'The existing rounded MabelTV component language.' },
    { id: 'signal', name: 'Signal', note: 'Editorial geometry, precise icons and quieter surfaces.' },
    { id: 'aperture', name: 'Aperture', note: 'Immersive cinema layers, floating controls and artwork-led cards.' },
  ]
  const MODES = [
    { id: 'dark', name: 'Dark', note: 'Cinema-weight surfaces for low light.' },
    { id: 'light', name: 'Light', note: 'Bright, calm surfaces with the same hierarchy.' },
  ]
  const PALETTES = [
    { id: 'ember', name: 'Ember', note: 'Coral signal with forest undertones.' },
    { id: 'tide', name: 'Tide', note: 'Broadcast blue with cool mineral surfaces.' },
    { id: 'grove', name: 'Grove', note: 'Moss green with grounded natural neutrals.' },
    { id: 'plum', name: 'Plum', note: 'Aubergine surfaces with a soft violet signal.' },
    { id: 'ochre', name: 'Ochre', note: 'Warm charcoal, parchment and amber.' },
    { id: 'mono', name: 'Mono', note: 'A restrained monochrome studio palette.' },
  ]
  const ICON_MAP = {
    home: 'house',
    'live-tv': 'radio',
    watch: 'clapperboard',
    usb: 'hard-drive',
    settings: 'settings',
    search: 'search',
    download: 'download',
  }
  const VALID = {
    design: new Set(DESIGNS.map(item => item.id)),
    mode: new Set(MODES.map(item => item.id)),
    palette: new Set(PALETTES.map(item => item.id)),
  }
  const STORAGE = {
    design: 'mabeltv-portal-design',
    mode: 'mabeltv-portal-theme',
    palette: 'mabeltv-portal-palette',
  }
  const SERVER_FIELDS = {
    design: ['set-portal-design', 'design', 'portal_design'],
    mode: ['set-portal-theme', 'theme', 'portal_theme'],
    palette: ['set-portal-palette', 'palette', 'portal_palette'],
  }

  const html = document.documentElement
  let previewDesign = null
  let state = {
    design: normalise('design', html.dataset.portalDesign, 'current'),
    mode: normalise('mode', html.dataset.portalTheme, 'dark'),
    palette: normalise('palette', html.dataset.portalPalette, 'ember'),
  }

  function normalise(kind, value, fallback) {
    return VALID[kind].has(String(value || '')) ? String(value) : fallback
  }

  function activeState() {
    return { ...state, design: previewDesign || state.design }
  }

  function swapIcons(design) {
    document.querySelectorAll('svg use').forEach(use => {
      if (!use.dataset.portalOriginalHref) {
        use.dataset.portalOriginalHref = use.getAttribute('href') || ''
      }
      const original = use.dataset.portalOriginalHref
      const name = original.split('#').pop()
      const mapped = ICON_MAP[name]
      if (design !== 'current' && mapped) use.setAttribute('href', `/portal/icons.svg#signal-${mapped}`)
      else if (original) use.setAttribute('href', original)
    })
  }

  function updateThemeColour() {
    const colour = getComputedStyle(html).getPropertyValue('--canvas').trim()
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta && colour) meta.content = colour
  }

  function updateSelection() {
    const active = activeState()
    document.querySelectorAll('[data-appearance-design]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.appearanceDesign === state.design))
    })
    document.querySelectorAll('[data-appearance-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.appearanceMode === state.mode))
    })
    document.querySelectorAll('[data-appearance-palette]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.appearancePalette === state.palette))
    })
    document.querySelectorAll('[data-apply-gallery-design]').forEach(button => {
      const selected = button.dataset.applyGalleryDesign === state.design
      button.classList.toggle('active', selected)
      button.textContent = selected ? `${button.dataset.applyGalleryLabel} is applied` : `Use ${button.dataset.applyGalleryLabel}`
      button.setAttribute('aria-pressed', String(selected))
    })
    document.body.dataset.appearancePreview = previewDesign ? active.design : ''
  }

  function apply(next = state, options = {}) {
    const persistLocal = options.persistLocal !== false
    state = {
      design: normalise('design', next.design, state.design),
      mode: normalise('mode', next.mode, state.mode),
      palette: normalise('palette', next.palette, state.palette),
    }
    const active = activeState()
    html.dataset.portalDesign = active.design
    html.dataset.portalTheme = active.mode
    html.dataset.portalPalette = active.palette
    if (persistLocal) {
      try {
        Object.entries(STORAGE).forEach(([key, storageKey]) => localStorage.setItem(storageKey, state[key]))
      } catch (_) { /* Storage is optional. */ }
    }
    swapIcons(active.design)
    updateThemeColour()
    updateSelection()
    window.dispatchEvent(new CustomEvent('mabeltv:appearancechange', { detail: active }))
  }

  function choiceMarkup(item, kind) {
    const preview = kind === 'palette'
      ? `<span class="appearance-palette-swatch" data-palette-preview="${item.id}"><i></i><i></i><i></i></span>`
      : `<span class="appearance-${kind}-preview" data-${kind}-preview="${item.id}"><i></i><i></i><i></i></span>`
    return `<button type="button" class="appearance-choice" data-appearance-${kind}="${item.id}" aria-pressed="false">${preview}<span><strong>${item.name}</strong><small>${item.note}</small></span></button>`
  }

  function renderControls() {
    const root = document.querySelector('#portalAppearanceControl')
    if (!root || root.dataset.rendered === 'true') return
    root.dataset.rendered = 'true'
    root.innerHTML = `
      <header class="appearance-heading"><p class="section-kicker">Portal appearance</p><h2>Build your look</h2><p>Component style, colour and brightness are independent. Change any one without losing the other two.</p></header>
      <fieldset class="appearance-group"><legend>Component style</legend><p>Swap the complete interface language across every portal page.</p><div class="appearance-choice-grid appearance-design-grid">${DESIGNS.map(item => choiceMarkup(item, 'design')).join('')}</div></fieldset>
      <fieldset class="appearance-group"><legend>Colour palette</legend><p>Each palette includes coordinated backgrounds, surfaces, borders and accents.</p><div class="appearance-choice-grid appearance-palette-grid">${PALETTES.map(item => choiceMarkup(item, 'palette')).join('')}</div></fieldset>
      <fieldset class="appearance-group"><legend>Brightness</legend><p>Every component style and palette has a paired light and dark treatment.</p><div class="appearance-choice-grid appearance-mode-grid">${MODES.map(item => choiceMarkup(item, 'mode')).join('')}</div></fieldset>`
    root.querySelectorAll('[data-appearance-design]').forEach(button => {
      button.onclick = () => select('design', button.dataset.appearanceDesign)
    })
    root.querySelectorAll('[data-appearance-mode]').forEach(button => {
      button.onclick = () => select('mode', button.dataset.appearanceMode)
    })
    root.querySelectorAll('[data-appearance-palette]').forEach(button => {
      button.onclick = () => select('palette', button.dataset.appearancePalette)
    })
    updateSelection()
  }

  async function select(kind, value) {
    const next = normalise(kind, value, state[kind])
    if (next === state[kind]) return
    const previous = { ...state }
    apply({ ...state, [kind]: next })
    const [action, key, appearanceField] = SERVER_FIELDS[kind]
    try {
      await api('/api/manage', {
        method: 'POST',
        body: JSON.stringify({ action, [key]: next }),
      })
      if (window.MabelPortalLibrary?.appearance) {
        window.MabelPortalLibrary.appearance[appearanceField] = next
      }
    } catch (error) {
      apply(previous)
      if (typeof notice === 'function') notice(error?.message || 'The appearance choice could not be saved.', true)
    }
  }

  function render(library) {
    const appearance = library?.appearance || {}
    apply({
      design: normalise('design', appearance.portal_design, state.design),
      mode: normalise('mode', appearance.portal_theme, state.mode),
      palette: normalise('palette', appearance.portal_palette, state.palette),
    })
    renderControls()
  }

  function preview(design) {
    previewDesign = normalise('design', design, null)
    apply(state, { persistLocal: false })
  }

  function clearPreview() {
    if (!previewDesign) return
    previewDesign = null
    apply(state, { persistLocal: false })
  }

  window.MabelPortalAppearance = {
    apply,
    clearPreview,
    current: () => ({ ...state }),
    palettes: PALETTES,
    preview,
    render,
    select,
  }
  apply(state)
})()
