import { createApp } from 'vue'
import App from './App.vue'

function isMalformedUriError(error) {
  return error instanceof URIError && /URI malformed/i.test(String(error.message || ''))
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (!isMalformedUriError(event.error)) return
    console.warn('[usagi] ignored malformed URI from unsafe external input', event.error)
    event.preventDefault()
  }, true)

  window.addEventListener('unhandledrejection', (event) => {
    if (!isMalformedUriError(event.reason)) return
    console.warn('[usagi] ignored malformed URI from unsafe external input', event.reason)
    event.preventDefault()
  })
}

createApp(App).mount('#app')
