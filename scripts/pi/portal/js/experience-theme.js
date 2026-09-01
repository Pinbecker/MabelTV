'use strict'

;(function initialiseExperienceTheme() {
  const STORAGE_KEY = 'mabeltv-experience-theme'
  const THEMES = Object.freeze({ dark: 'dark', light: 'light' })
  const THEME_COLOURS = Object.freeze({ dark: '#0b0a0d', light: '#f4f3f1' })
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
    if (!toggle) return
    updateControl(normaliseTheme(document.documentElement.dataset.experienceTheme))
    toggle.addEventListener('click', () => {
      const current = normaliseTheme(document.documentElement.dataset.experienceTheme)
      applyTheme(current === THEMES.light ? THEMES.dark : THEMES.light, true)
    })
  }

  applyTheme(savedTheme(), false)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControl, { once: true })
  else bindControl()

  window.MabelExperienceTheme = Object.freeze({
    get: () => normaliseTheme(document.documentElement.dataset.experienceTheme),
    set: theme => applyTheme(theme, true),
  })
})()
