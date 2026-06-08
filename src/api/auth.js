import { clearAuthSession, request, setAuthSession } from './client'

export async function login(username, password) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: { username, password }
  })
  setAuthSession(data.token, data.user)
  return data
}

export async function register(username, password, inviteCode, extra = {}) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: { username, password, invite_code: inviteCode, ...extra }
  })
  setAuthSession(data.token, data.user)
  return data
}

export async function getMe() {
  const data = await request('/api/auth/me', {
    method: 'POST',
    body: {}
  })
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
