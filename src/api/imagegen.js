import { request } from './client'

export function normalizeImageUrl(value) {
  const raw = value || ''
  if (!raw || raw.startsWith('data:') || raw.startsWith('/') || /^https?:\/\//i.test(raw)) return raw
  return 'data:image/png;base64,' + raw
}

export function generateMiniMaxImage(payload) {
  return request('/api/minimax/image', {
    method: 'POST',
    body: payload
  })
}

export function generateGptImage(payload, signal) {
  return request('/api/gpt-image2/text2image', {
    method: 'POST',
    body: payload,
    signal
  })
}

export function editGptImage(payload, signal) {
  return request('/api/gpt-image2/image2image', {
    method: 'POST',
    body: payload,
    signal
  })
}

export function generateGptImageFast(payload) {
  return request('/api/gpt-image2/text2image', {
    method: 'POST',
    body: {
      transport: 'responses',
      ...payload
    }
  })
}

export function editGptImageFast(payload) {
  return request('/api/gpt-image2/image2image', {
    method: 'POST',
    body: {
      transport: 'responses',
      ...payload
    }
  })
}

export function generateDreaminaImage(payload) {
  return request('/api/dreamina/text2image', {
    method: 'POST',
    body: payload
  })
}

export function editDreaminaImage(payload) {
  return request('/api/dreamina/image2image', {
    method: 'POST',
    body: payload
  })
}

export function getImagegenHistory(page = 1, limit = 12) {
  return request('/api/imagegen/history', {
    method: 'GET',
    query: { page, limit }
  })
}

export function deleteImagegenHistory(id) {
  return request(`/api/imagegen/history/${id}`, {
    method: 'DELETE'
  })
}

