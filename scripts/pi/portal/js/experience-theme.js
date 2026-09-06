'use strict'

;(function initialiseExperienceTheme() {
  const STORAGE_KEY = 'mabeltv-experience-theme'
  const ACCENT_STORAGE_KEY = 'mabeltv-experience-accent-hue'
  const DEFAULT_ACCENT_HUE = 48
  const THEMES = Object.freeze({ dark: 'dark', light: 'light' })
  const THEME_COLOURS = Object.freeze({ dark: '#0b0a0d', light: '#f4f6f9' })
  // Match the original installed PWA contract. iOS fixes this choice when the
  // Home Screen app is created, so themes must not switch viewport modes.
  const STATUS_BAR_STYLES = Object.freeze({ dark: 'default', light: 'default' })

  function normaliseTheme(value) {
    return value === THEMES.light ? THEMES.light : THEMES.dark
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

  function updateAccentControl(hue) {
    const slider = document.getElementById('experienceAccentHue')
    const name = document.getElementById('experienceAccentName')
    if (slider) slider.value = String(hue)
    if (name) name.textContent = accentName(hue)
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

  function updateControl(theme) {
    const toggle = document.getElementById('experienceThemeToggle')
    const state = document.getElementById('experienceThemeState')
    if (toggle) toggle.setAttribute('aria-checked', theme === THEMES.light ? 'true' : 'false')
    if (state) state.textContent = theme === THEMES.light ? 'On' : 'Off'
  }

  function applyTheme(value, persist) {
    const theme = normaliseTheme(value)
    document.documentElement.dataset.experienceTheme = theme

    const themeColour = document.querySelector('meta[name="theme-color"]')
    const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    if (themeColour) themeColour.setAttribute('content', THEME_COLOURS[theme])
    if (statusBar) statusBar.setAttribute('content', STATUS_BAR_STYLES[theme])

    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, theme) } catch (_) { /* optional */ }
    }
    updateControl(theme)
    return theme
  }

  function bindControl() {
    const toggle = document.getElementById('experienceThemeToggle')
    const accent = document.getElementById('experienceAccentHue')
    if (toggle) {
      updateControl(normaliseTheme(document.documentElement.dataset.experienceTheme))
      toggle.addEventListener('click', () => {
        const current = normaliseTheme(document.documentElement.dataset.experienceTheme)
        applyTheme(current === THEMES.light ? THEMES.dark : THEMES.light, true)
      })
    }
    if (accent) {
      updateAccentControl(savedAccentHue())
      accent.addEventListener('input', () => applyAccentHue(accent.value, true, true))
    }
  }

  applyAccentHue(savedAccentHue(), false)
  applyTheme(savedTheme(), false)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControl, { once: true })
  else bindControl()

  window.MabelExperienceTheme = Object.freeze({
    get: () => normaliseTheme(document.documentElement.dataset.experienceTheme),
    set: theme => applyTheme(theme, true),
    getAccentHue: savedAccentHue,
    setAccentHue: hue => applyAccentHue(hue, true, true),
  })
})()
