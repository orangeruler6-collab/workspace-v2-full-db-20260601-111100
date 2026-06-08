import { request } from './client'

export function listDailyHot(date) {
  const query = date ? '?date=' + encodeURIComponent(date) : ''
  return request('/api/daily-hot/list' + query)
}

export function refreshDailyHot(payload) {
  return request('/api/daily-hot/refresh', {
    method: 'POST',
    body: payload || {}
  })
}

export function analyzeDailyHot(payload) {
  return request('/api/daily-hot/analyze', {
    method: 'POST',
    body: payload || {}
  })
}

export function updateDailyHotStatus(id, status) {
  return request('/api/daily-hot/update-status', {
    method: 'POST',
    body: { id, status }
  })
}

export function manualAddDailyHot(payload) {
  return request('/api/daily-hot/manual-add', {
    method: 'POST',
    body: payload || {}
  })
}
