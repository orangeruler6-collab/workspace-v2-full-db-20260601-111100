import { request } from './client'

function escapeBadPercent(value) {
  return String(value || '').replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
}

export function normalizeImageUrl(value) {
  const raw = String(value || '').trim()
  if (!raw || raw.startsWith('data:')) return raw
  const safeRaw = escapeBadPercent(raw)
  if (safeRaw.startsWith('/uploads/') || /^https?:\/\//i.test(safeRaw)) return normalizeUploadUrl(safeRaw)
  if (safeRaw.startsWith('/')) return safeRaw
  return 'data:image/png;base64,' + raw
}

function normalizeUploadUrl(value) {
  if (typeof window === 'undefined') return value
  try {
    const url = new URL(escapeBadPercent(value), window.location.origin)
    if (url.pathname.startsWith('/uploads/')) {
      return window.location.origin + url.pathname + url.search + url.hash
    }
    return url.toString()
  } catch (e) {
    return value
  }
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

export function createGptImageTask(payload) {
  return request('/api/gpt-image2/tasks', {
    method: 'POST',
    body: payload
  })
}

export function listGptImageTasks(limit = 20) {
  return request('/api/gpt-image2/tasks', {
    method: 'POST',
    body: { action: 'list', limit }
  })
}

export function getGptImageTaskStatus(ids = []) {
  return request('/api/gpt-image2/tasks/status', {
    method: 'POST',
    body: { ids }
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

