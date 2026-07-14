import { clearAuthSession, request, setAuthSession } from './client'

const AUTH_REQUEST_TIMEOUT_MS = 10000

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
