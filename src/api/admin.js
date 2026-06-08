import { request } from './client'

export function listUsers() {
  return request('/api/admin/users', {
    method: 'POST',
    body: {}
  })
}

export function createUser(payload) {
  return request('/api/admin/users/create', {
    method: 'POST',
    body: payload
  })
}

export function updateUser(payload) {
  return request('/api/admin/users/update', {
    method: 'POST',
    body: payload
  })
}

export function resetUserPassword(id, password) {
  return request('/api/admin/users/reset-password', {
    method: 'POST',
    body: { id, password }
  })
}

export function deleteUser(id) {
  return request('/api/admin/users/delete', {
    method: 'POST',
    body: { id }
  })
}

export function listOperationLogs(filters = {}) {
  return request('/api/admin/logs', {
    method: 'POST',
    body: filters
  })
}

export function getEnvironmentStatus() {
  return request('/api/system/health', {
    method: 'POST',
    body: {}
  })
}
