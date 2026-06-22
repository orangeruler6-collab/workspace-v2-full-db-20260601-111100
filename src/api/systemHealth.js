import { request } from './client'

export function getSystemHealthLatest() {
  return request('/api/system-health/latest', { method: 'POST', body: {} })
}

export function runSystemHealthCheck() {
  return request('/api/system-health/run', { method: 'POST', body: {} })
}

export function listSystemHealthHistory(limit = 30) {
  return request('/api/system-health/history', { method: 'POST', body: { limit } })
}
