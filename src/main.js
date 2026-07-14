import { createApp } from 'vue'
import App from './App.vue'

const MODULE_RELOAD_KEY = 'usagi_module_reload_at'

function isMalformedUriError(error) {
  return error instanceof URIError && /URI malformed/i.test(String(error.message || ''))
}

function isModuleLoadError(error) {
  const message = String(error?.message || error || '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload (?:CSS|module)|error loading dynamically imported module/i.test(message)
}

function reloadAfterModuleError(error) {
  if (!isModuleLoadError(error)) return false

  // A browser can briefly retain an old lazy-module URL after a Vite restart.
  // Reload once to fetch the current module graph without creating a loop.
  const now = Date.now()
  let lastReload = 0
  try {
    lastReload = Number(sessionStorage.getItem(MODULE_RELOAD_KEY) || 0)
  } catch {}

  if (now - lastReload < 30000) return false
  try {
    sessionStorage.setItem(MODULE_RELOAD_KEY, String(now))
  } catch {}
  window.location.reload()
  return true
}

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    if (!reloadAfterModuleError(event.payload)) return
    event.preventDefault()
  })

  window.addEventListener('error', (event) => {
    if (isMalformedUriError(event.error)) {
      console.warn('[usagi] ignored malformed URI from unsafe external input', event.error)
      event.preventDefault()
      return
    }
    if (reloadAfterModuleError(event.error || event.message)) event.preventDefault()
  }, true)

  window.addEventListener('unhandledrejection', (event) => {
    if (isMalformedUriError(event.reason)) {
      console.warn('[usagi] ignored malformed URI from unsafe external input', event.reason)
      event.preventDefault()
      return
    }
    if (reloadAfterModuleError(event.reason)) event.preventDefault()
  })
}

createApp(App).mount('#app')
