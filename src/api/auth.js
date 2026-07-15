import { clearAuthSession, request, setAuthSession } from './client'

const AUTH_REQUEST_TIMEOUT_MS = 10000
const ERP_AUTH_BASE = import.meta.env.VITE_ERP_AUTH_BASE || 'https://erp.changwankeji.com:8188/api.php'

function withAuthTimeout(fn, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  return fn(controller.signal)
    .catch((error) => {
      if (error?.name === 'AbortError') throw new Error('登录服务响应超时，请刷新后重试')
      throw error
    })
    .finally(() => window.clearTimeout(timer))
}

export async function login(username, password) {
  const data = await withAuthTimeout((signal) => request('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    signal
  }))
  setAuthSession(data.token, data.user)
  return data
}

export function decodeErpToken(encoded) {
  return window.atob(String(encoded || '').replace(/!/g, '+').replace(/\./g, '/').replace(/:/g, '='))
}

export function takeErpTokenFromHash() {
  const hash = window.location.hash || ''
  const match = hash.match(/(?:^#|[&#])(?:token|auth_token)=([^&]+)/)
  if (!match) return []
  const raw = match[1] || ''
  const decodedURIComponent = (() => {
    try { return decodeURIComponent(raw) } catch (e) { return raw }
  })()
  const candidates = [raw, decodedURIComponent]
  try {
    candidates.push(decodeErpToken(decodedURIComponent))
  } catch (e) {}
  try {
    candidates.push(decodeErpToken(raw))
  } catch (e) {}
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return Array.from(new Set(candidates.map((token) => String(token || '').trim()).filter(Boolean)))
}

export function getErpLoginUrl(redirectUrl) {
  const url = new URL(ERP_AUTH_BASE)
  url.searchParams.set('m', 'login|api|module')
  url.searchParams.set('a', 'getAuthToken')
  url.searchParams.set('redirect_url', redirectUrl)
  return url.toString()
}

export function redirectToErpLogin() {
  const currentUrl = new URL(window.location.href)
  currentUrl.hash = ''
  window.location.href = getErpLoginUrl(currentUrl.toString())
}

export async function erpLogin(authToken) {
  const tokens = Array.isArray(authToken) ? authToken : [authToken]
  const data = await withAuthTimeout((signal) => request('/api/auth/erp-login', {
    method: 'POST',
    body: {
      auth_token: tokens[0] || '',
      auth_tokens: tokens
    },
    signal
  }))
  setAuthSession(data.token, data.user)
  return data
}

export async function register(username, password, inviteCode, extra = {}) {
  const data = await withAuthTimeout((signal) => request('/api/auth/register', {
    method: 'POST',
    body: { username, password, invite_code: inviteCode, ...extra },
    signal
  }))
  setAuthSession(data.token, data.user)
  return data
}

export async function getMe() {
  const data = await withAuthTimeout((signal) => request('/api/auth/me', {
    method: 'POST',
    body: {},
    signal
  }))
  if (data.user) setAuthSession(null, data.user)
  return data
}

export async function logout() {
  try {
    await request('/api/auth/logout', {
      method: 'POST',
      body: {}
    })
  } finally {
    clearAuthSession()
  }
}
