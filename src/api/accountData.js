import { request } from './client'

export function loadAccountDataDashboard() {
  return request('/api/account-data/dashboard', {
    method: 'POST',
    body: {}
  })
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
