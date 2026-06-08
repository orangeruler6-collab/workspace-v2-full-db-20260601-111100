import { request } from './client'

export function listAccountMonitor(payload = {}) {
  return request('/api/account-monitor/list', {
    method: 'POST',
    body: payload || {}
  })
}

export function saveAccountMonitor(payload) {
  return request('/api/account-monitor/upsert', {
    method: 'POST',
    body: payload || {}
  })
}

export function deleteAccountMonitor(id) {
  return request('/api/account-monitor/delete', {
    method: 'POST',
    body: { id }
  })
}

export function collectAccountMonitor(id) {
  return request('/api/account-monitor/collect', {
    method: 'POST',
    body: { id }
  })
}

export function collectAllAccountMonitor(payload = {}) {
  return request('/api/account-monitor/collect-all', {
    method: 'POST',
    body: payload || {}
  })
}

export function getAccountMonitorCollectStatus(payload = {}) {
  return request('/api/account-monitor/collect-status', {
    method: 'POST',
    body: payload || {}
  })
}

export function clearAccountMonitor(payload = {}) {
  return request('/api/account-monitor/clear', {
    method: 'POST',
    body: payload || {}
  })
}
