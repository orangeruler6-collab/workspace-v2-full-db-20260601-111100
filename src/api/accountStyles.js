import { request } from './client'

export function listAccountStyles() {
  return request('/api/account-styles/list')
}

export function saveAccountStyles(styles) {
  return request('/api/account-styles/save', {
    method: 'POST',
    body: { styles }
  })
}

export function createAccountStyle(payload) {
  return request('/api/account-styles/create', {
    method: 'POST',
    body: payload
  })
}

export function updateAccountStyle(payload) {
  return request('/api/account-styles/update', {
    method: 'POST',
    body: payload
  })
}

export function deleteAccountStyle(id) {
  return request('/api/account-styles/delete', {
    method: 'POST',
    body: { id }
  })
}

export function addAccountStyleSamples(id, content) {
  return request('/api/account-styles/samples/add', {
    method: 'POST',
    body: { id, content }
  })
}

export function deleteAccountStyleSample(id, sampleId) {
  return request('/api/account-styles/samples/delete', {
    method: 'POST',
    body: { id, sampleId }
  })
}

export function analyzeAccountStyle(id, model = 'gpt-5.5') {
  return request('/api/account-styles/analyze', {
    method: 'POST',
    body: { id, model }
  })
}

export function saveAccountStyleCard(id, styleCard) {
  return request('/api/account-styles/card/save', {
    method: 'POST',
    body: { id, styleCard }
  })
}

export function confirmAccountStyle(id, styleCard) {
  return request('/api/account-styles/confirm', {
    method: 'POST',
    body: { id, styleCard }
  })
}

export function incrementAccountStyleUsage(id) {
  return request('/api/account-styles/usage/increment', {
    method: 'POST',
    body: { id }
  })
}
