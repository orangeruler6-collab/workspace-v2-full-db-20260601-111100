import { request } from './client'

function normalizeList(data) {
  const items = data.items || data.data || []
  return {
    ...data,
    items,
    data: items,
    total: data.total ?? items.length
  }
}

export function listVectorItems(collection = 'wenan', filters = {}) {
  return request('/api/vector/list', {
    method: 'POST',
    body: { collection, ...(filters || {}) }
  }).then(normalizeList)
}

export function getVectorStats(collection = 'wenan') {
  return request('/api/vector/stats', {
    method: 'POST',
    body: { collection }
  })
}

export function getVectorFacets(collection = 'wenan') {
  return request('/api/vector/facets', {
    method: 'POST',
    body: { collection }
  })
}

export function getVectorItem(collection = 'wenan', id = '') {
  return request('/api/vector/get', {
    method: 'POST',
    body: { collection, id }
  })
}

export function collectVectorAccount(payload) {
  return request('/api/vector/collect-account', {
    method: 'POST',
    body: payload
  })
}

export function prepareVectorAccountItems(payload) {
  return request('/api/vector/prepare-account-items', {
    method: 'POST',
    body: payload
  })
}

export function prepareVectorCopyItems(payload) {
  return request('/api/vector/prepare-copy-items', {
    method: 'POST',
    body: payload
  })
}

export function addVectorItem(collection = 'wenan', record) {
  return request('/api/vector/add', {
    method: 'POST',
    body: {
      ...(record || {}),
      collection
    }
  })
}

export function deleteVectorItem(collection = 'wenan', id) {
  return request('/api/vector/delete', {
    method: 'POST',
    body: { id, collection }
  })
}

export function analyzeVectorText(text, account = '通用', collection = 'wenan') {
  return request('/api/vector/analyze', {
    method: 'POST',
    body: { text, account, collection }
  })
}

