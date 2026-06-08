const JSON_HEADERS = { 'Content-Type': 'application/json' }
const AUTH_TOKEN_KEY = 'usagi_auth_token'
const AUTH_USER_KEY = 'usagi_auth_user'

export function getAuthToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY) || '' } catch (e) { return '' }
}

export function setAuthSession(token, user) {
  try {
    if (token !== undefined && token !== null) {
      if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
      else localStorage.removeItem(AUTH_TOKEN_KEY)
    }
    if (user) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
      localStorage.setItem('usagi_login', JSON.stringify({ user: user.username || user.display_name || '匿名' }))
    } else {
      localStorage.removeItem(AUTH_USER_KEY)
      localStorage.removeItem('usagi_login')
    }
  } catch (e) {}
}

export function clearAuthSession() {
  setAuthSession('', null)
}

export function getCurrentAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

export async function callMiniMaxChat(messages) {
  const system = messages.find(m => m.role === 'system')?.content || '你是乌萨奇，陈的AI助手。实用、直接、有个性。'
  const nonSystem = messages.filter(m => m.role !== 'system')
  const data = await request('/api/chat-minimax', {
    method: 'POST',
    body: { system, history: nonSystem.slice(0, -1), prompt: nonSystem[nonSystem.length - 1]?.content || '' }
  })
  return data.response || data.content || data.message || ''
}

export async function request(path, options = {}) {
  const token = getAuthToken()
  const init = {
    method: options.method || 'GET',
    headers: { ...JSON_HEADERS, ...(options.headers || {}) }
  }
  if (token && !init.headers.Authorization) init.headers.Authorization = 'Bearer ' + token

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }

  if (options.query) {
    const qs = Object.entries(options.query)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    if (qs) path = path + '?' + qs
  }

  if (options.signal) {
    init.signal = options.signal
  }

  const resp = await fetch(path, init)

  let data
  try {
    data = await resp.json()
  } catch (e) {
    // 非 JSON 响应
    const text = await resp.text().catch(() => 'Unknown error')
    if (resp.status === 401 && !options.skipAuthExpired) {
      clearAuthSession()
      window.dispatchEvent(new CustomEvent('usagi:auth-expired'))
    }
    throw new Error(`请求失败 (${resp.status}): ${text.slice(0, 100)}`)
  }

  if (resp.status === 401 && !options.skipAuthExpired) {
    clearAuthSession()
    window.dispatchEvent(new CustomEvent('usagi:auth-expired'))
  }

  // 统一错误格式检查
  const hasError = !resp.ok || data.error || data.ok === false
  if (hasError) {
    const errorMsg = data.error || data.message || `HTTP ${resp.status}`
    const err = new Error(errorMsg)
    err.status = resp.status
    err.data = data
    throw err
  }

  return data
}
