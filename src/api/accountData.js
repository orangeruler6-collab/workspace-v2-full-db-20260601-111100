import { clearAuthSession, getAuthToken, request } from './client'

const DASHBOARD_CACHE_TTL_MS = 30000
const DASHBOARD_REQUEST_TIMEOUT_MS = 45000
let dashboardCache = null
let dashboardPromise = null

function dashboardCacheKey(options = {}) {
  return [String(options.historyMonth || ''), options.workScope === 'all' ? 'all' : 'month'].join('|')
}

function requestDashboard(payload) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/account-data/dashboard', true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    const token = getAuthToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.timeout = DASHBOARD_REQUEST_TIMEOUT_MS
    xhr.onload = () => {
      let data = null
      try {
        data = JSON.parse(xhr.responseText || '{}')
      } catch (error) {
        reject(new Error(`看板响应解析失败 (${xhr.status})`))
        return
      }
      if (xhr.status === 401) {
        clearAuthSession()
        window.dispatchEvent(new CustomEvent('usagi:auth-expired'))
      }
      if (xhr.status < 200 || xhr.status >= 300 || data?.error || data?.ok === false) {
        const error = new Error(data?.error || data?.message || `HTTP ${xhr.status}`)
        error.status = xhr.status
        error.data = data
        reject(error)
        return
      }
      resolve(data)
    }
    xhr.onerror = () => reject(new Error('看板网络请求失败'))
    xhr.ontimeout = () => reject(new Error('看板读取超时，请稍后重试'))
    xhr.onabort = () => reject(new Error('看板读取已取消'))
    xhr.send(JSON.stringify(payload))
  })
}

async function requestDashboardWithRetry(payload, attempts = 3) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestDashboard(payload)
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => window.setTimeout(resolve, attempt * 500))
    }
  }
  throw lastError
}

export function loadAccountDataDashboard(options = {}) {
  const key = dashboardCacheKey(options)
  const now = Date.now()
  if (!options.forceRefresh && dashboardCache && dashboardCache.key === key && now - dashboardCache.at < DASHBOARD_CACHE_TTL_MS) {
    return Promise.resolve(dashboardCache.data)
  }
  if (!options.forceRefresh && dashboardPromise && dashboardPromise.key === key) {
    return dashboardPromise.promise
  }
  const startedAt = Date.now()
  console.info('[account-data] dashboard request started', { key, forceRefresh: Boolean(options.forceRefresh) })
  const promise = requestDashboard({
    historyMonth: options.historyMonth || undefined,
    workScope: options.workScope === 'all' ? 'all' : 'month',
    responseMode: 'summary',
    forceRefresh: Boolean(options.forceRefresh)
  }).then((data) => {
    console.info('[account-data] dashboard response received', {
      key,
      durationMs: Date.now() - startedAt,
      accounts: Array.isArray(data?.accounts) ? data.accounts.length : 0,
      works: Array.isArray(data?.works) ? data.works.length : 0
    })
    dashboardCache = { key, data, at: Date.now() }
    return data
  }).catch((error) => {
    console.warn('[account-data] dashboard request failed', {
      key,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error)
    })
    throw error
  }).finally(() => {
    if (dashboardPromise?.promise === promise) dashboardPromise = null
  })
  dashboardPromise = { key, promise }
  return promise
}

export async function loadAccountDataDashboardWorks(options = {}) {
  const total = Math.max(0, Number(options.worksTotal) || 0)
  if (!total) return []
  const limit = 250
  const offsets = []
  for (let offset = 0; offset < total; offset += limit) offsets.push(offset)
  const pages = new Array(offsets.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, offsets.length) }, async () => {
    while (cursor < offsets.length) {
      const index = cursor++
      pages[index] = await requestDashboardWithRetry({
        historyMonth: options.historyMonth || undefined,
        workScope: options.workScope === 'all' ? 'all' : 'month',
        responseMode: 'works',
        worksOffset: offsets[index],
        worksLimit: limit
      })
    }
  })
  await Promise.all(workers)
  const works = pages.flatMap((page) => Array.isArray(page?.works) ? page.works : [])
  if (dashboardCache?.key === dashboardCacheKey(options)) {
    dashboardCache = {
      key: dashboardCache.key,
      at: Date.now(),
      data: { ...dashboardCache.data, works, worksDeferred: false }
    }
  }
  return works
}

export async function loadAccountDataDashboardPublishWorks(options = {}) {
  const data = await requestDashboardWithRetry({
    historyMonth: options.historyMonth || undefined,
    workScope: options.workScope === 'all' ? 'all' : 'month',
    responseMode: 'publish-works'
  })
  return Array.isArray(data?.works) ? data.works : []
}

export async function loadAccountDataDashboardPublishDetail(options = {}) {
  const data = await requestDashboardWithRetry({
    historyMonth: options.historyMonth || undefined,
    workScope: options.workScope === 'all' ? 'all' : 'month',
    responseMode: 'publish-detail',
    startDate: options.startDate,
    endDate: options.endDate || options.startDate
  })
  return Array.isArray(data?.works) ? data.works : []
}

export function preloadAccountDataDashboard(options = {}) {
  return loadAccountDataDashboard(options).catch(() => null)
}

export function clearAccountDataDashboardCache() {
  dashboardCache = null
  dashboardPromise = null
}

export function loadAccountDataCollectStatus() {
  return request('/api/account-data/collect/status', {
    method: 'POST',
    body: {}
  })
}

export function runAccountDataCollect(payload = {}) {
  return request('/api/account-data/collect/run', {
    method: 'POST',
    body: payload
  })
}

export function openAccountDataProfileLogin(payload = {}) {
  return request('/api/account-data/profile-login/open', {
    method: 'POST',
    body: payload
  })
}

export function closeAccountDataProfileLogin(payload = {}) {
  return request('/api/account-data/profile-login/close', {
    method: 'POST',
    body: payload
  })
}
