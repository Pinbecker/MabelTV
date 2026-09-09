'use strict'

;(function initialiseExperienceTheme() {
  const STORAGE_KEY = 'mabeltv-experience-theme'
  const ACCENT_STORAGE_KEY = 'mabeltv-experience-accent-hue'
  const STRENGTH_STORAGE_KEY = 'mabeltv-experience-accent-strength'
  const DEFAULT_ACCENT_HUE = 48
  const THEMES = Object.freeze({ light: 'light', dim: 'dim', dark: 'dark' })
  const THEME_LEVELS = Object.freeze([THEMES.light, THEMES.dim, THEMES.dark])
  const THEME_NAMES = Object.freeze({ light: 'Light', dim: 'Dark', dark: 'True black' })
  const THEME_COLOURS = Object.freeze({ light: '#f4f6f9', dim: '#151820', dark: '#0b0a0d' })
  const STRENGTHS = Object.freeze(['subtle', 'balanced', 'vivid'])
  const STRENGTH_NAMES = Object.freeze({ subtle: 'Subtle', balanced: 'Balanced', vivid: 'Vivid' })
  // Match the original installed PWA contract. iOS fixes this choice when the
  // Home Screen app is created, so themes must not switch viewport modes.
  const STATUS_BAR_STYLES = Object.freeze({ light: 'default', dim: 'default', dark: 'default' })

  function normaliseTheme(value) {
    return THEME_LEVELS.includes(value) ? value : THEMES.dark
  }

  function savedTheme() {
    try {
      return normaliseTheme(localStorage.getItem(STORAGE_KEY))
    } catch (_) {
      return THEMES.dark
    }
  }

  function normaliseAccentHue(value) {
    const hue = Number.parseInt(value, 10)
    return Number.isFinite(hue) ? Math.min(359, Math.max(0, hue)) : DEFAULT_ACCENT_HUE
  }

  function savedAccentHue() {
    try {
      return normaliseAccentHue(localStorage.getItem(ACCENT_STORAGE_KEY))
    } catch (_) {
      return DEFAULT_ACCENT_HUE
    }
  }

  function normaliseStrength(value) {
    return STRENGTHS.includes(value) ? value : 'balanced'
  }

  function savedAccentStrength() {
    try {
      return normaliseStrength(localStorage.getItem(STRENGTH_STORAGE_KEY))
    } catch (_) {
      return 'balanced'
    }
  }

  function accentName(hue) {
    if (hue < 18 || hue >= 348) return 'Red'
    if (hue < 78) return 'Orange'
    if (hue < 118) return 'Gold'
    if (hue < 170) return 'Green'
    if (hue < 215) return 'Teal'
    if (hue < 265) return 'Blue'
    if (hue < 305) return 'Purple'
    return 'Pink'
  }

  function updateSummary() {
    const summary = document.getElementById('appearanceSettingsSummary')
    if (!summary) return
    const theme = normaliseTheme(document.documentElement.dataset.experienceTheme)
    const strength = normaliseStrength(document.documentElement.dataset.experienceAccentStrength)
    summary.textContent = `${THEME_NAMES[theme]} · ${accentName(savedAccentHue())} · ${STRENGTH_NAMES[strength]}`
  }

  function updateAccentControl(hue) {
    const slider = document.getElementById('experienceAccentHue')
    const name = document.getElementById('experienceAccentName')
    const value = document.getElementById('experienceAccentHueValue')
    if (slider) slider.value = String(hue)
    if (name) name.textContent = accentName(hue)
    if (value) value.textContent = `${hue}°`
    document.querySelectorAll('[data-accent-preset]').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.accentPreset) === hue))
    })
    updateSummary()
  }

  function applyAccentHue(value, persist, notify = false) {
    const hue = normaliseAccentHue(value)
    document.documentElement.style.setProperty('--experience-accent-hue', String(hue))
    if (persist) {
      try { localStorage.setItem(ACCENT_STORAGE_KEY, String(hue)) } catch (_) { /* optional */ }
    }
    updateAccentControl(hue)
    if (notify) document.dispatchEvent(new CustomEvent('mabeltv:accent-change', { detail: { hue } }))
    return hue
  }

  function updateStrengthControl(strength) {
    document.querySelectorAll('[data-accent-strength]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.accentStrength === strength))
    })
    updateSummary()
  }

  function applyAccentStrength(value, persist, notify = false) {
    const strength = normaliseStrength(value)
    document.documentElement.dataset.experienceAccentStrength = strength
    if (persist) {
      try { localStorage.setItem(STRENGTH_STORAGE_KEY, strength) } catch (_) { /* optional */ }
    }
    updateStrengthControl(strength)
    if (notify) document.dispatchEvent(new CustomEvent('mabeltv:accent-strength-change', { detail: { strength } }))
    return strength
  }

  function updateThemeControl(theme) {
    const slider = document.getElementById('experienceThemeLevel')
    const name = document.getElementById('experienceThemeName')
    if (slider) slider.value = String(THEME_LEVELS.indexOf(theme))
    if (name) name.textContent = THEME_NAMES[theme]
    updateSummary()
  }

  function applyTheme(value, persist, notify = false) {
    const theme = normaliseTheme(value)
    document.documentElement.dataset.experienceTheme = theme

    const themeColour = document.querySelector('meta[name="theme-color"]')
    const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    if (themeColour) themeColour.setAttribute('content', THEME_COLOURS[theme])
    if (statusBar) statusBar.setAttribute('content', STATUS_BAR_STYLES[theme])

    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, theme) } catch (_) { /* optional */ }
    }
    updateThemeControl(theme)
    if (notify) document.dispatchEvent(new CustomEvent('mabeltv:theme-change', { detail: { theme } }))
    return theme
  }

  function bindControls() {
    const themeLevel = document.getElementById('experienceThemeLevel')
    const accent = document.getElementById('experienceAccentHue')
    updateThemeControl(normaliseTheme(document.documentElement.dataset.experienceTheme))
    updateAccentControl(savedAccentHue())
    updateStrengthControl(normaliseStrength(document.documentElement.dataset.experienceAccentStrength))
    if (themeLevel) themeLevel.addEventListener('input', () => {
      applyTheme(THEME_LEVELS[Number(themeLevel.value)] || THEMES.dark, true, true)
    })
    if (accent) accent.addEventListener('input', () => applyAccentHue(accent.value, true, true))
    document.querySelectorAll('[data-accent-preset]').forEach(button => {
      button.addEventListener('click', () => applyAccentHue(button.dataset.accentPreset, true, true))
    })
    document.querySelectorAll('[data-accent-strength]').forEach(button => {
      button.addEventListener('click', () => applyAccentStrength(button.dataset.accentStrength, true, true))
    })
  }

  applyAccentStrength(savedAccentStrength(), false)
  applyAccentHue(savedAccentHue(), false)
  applyTheme(savedTheme(), false)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControls, { once: true })
  else bindControls()

  window.MabelExperienceTheme = Object.freeze({
    get: () => normaliseTheme(document.documentElement.dataset.experienceTheme),
    set: theme => applyTheme(theme, true, true),
    getAccentHue: savedAccentHue,
    setAccentHue: hue => applyAccentHue(hue, true, true),
    getAccentStrength: savedAccentStrength,
    setAccentStrength: strength => applyAccentStrength(strength, true, true),
  })
})()
