import { request } from './client'

export function listFeedback(payload = {}) {
  return request('/api/feedback/list', {
    method: 'POST',
    body: payload
  })
}

export function createFeedback(payload = {}) {
  return request('/api/feedback/create', {
    method: 'POST',
    body: payload
  })
}

export function updateFeedback(payload = {}) {
  return request('/api/feedback/update', {
    method: 'POST',
    body: payload
  })
}

export function deleteFeedback(id) {
  return request('/api/feedback/delete', {
    method: 'POST',
    body: { id }
  })
}

export function fileToImagePayload(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve({})
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      resolve({
        screenshot_data: dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl,
        screenshot_type: file.type || 'image/png',
        screenshot_name: file.name || 'screenshot'
      })
    }
    reader.onerror = () => reject(new Error('截图读取失败'))
    reader.readAsDataURL(file)
  })
}
