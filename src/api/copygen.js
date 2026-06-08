import { request } from './client'

export function loadCopygenState() {
  return request('/api/copygen/state')
}

export function saveCopygenState(state) {
  return request('/api/copygen/state/save', {
    method: 'POST',
    body: { state }
  })
}

export function addCopygenRecord(payload) {
  return request('/api/copygen/records/add', {
    method: 'POST',
    body: {
      style_id: payload.styleId || '',
      title: payload.requirement || '文案生成记录',
      payload
    }
  })
}

export function listCopygenRecords() {
  return request('/api/copygen/records')
}

export function generateCopygenAngles(payload) {
  return request('/api/copygen/angles', {
    method: 'POST',
    body: payload
  })
}

export function generateCopygenText(payload) {
  return request('/api/copygen/generate', {
    method: 'POST',
    body: payload
  })
}


export function generateCopygenPublishRecommend(payload) {
  return request('/api/copygen/publish-recommend', {
    method: 'POST',
    body: payload
  })
}
