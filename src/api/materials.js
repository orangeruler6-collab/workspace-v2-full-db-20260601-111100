import { getAuthToken, request } from './client'

export function listMaterials(filters = {}) {
  return request('/api/materials/list', {
    method: 'POST',
    body: filters
  })
}

export function getMaterialStats(type = 'video') {
  return request('/api/materials/stats', {
    method: 'POST',
    body: { type }
  })
}

export function getMaterialStorage() {
  return request('/api/materials/storage', {
    method: 'POST',
    body: {}
  })
}

export function uploadMaterial(payload) {
  return request('/api/materials/upload', {
    method: 'POST',
    body: payload
  })
}

export function uploadMaterialFile(payload = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    Object.keys(payload || {}).forEach(key => {
      if (key === 'file') return
      if (payload[key] !== undefined && payload[key] !== null) form.append(key, payload[key])
    })
    if (!payload.file) {
      reject(new Error('missing file'))
      return
    }
    form.append('file', payload.file, payload.file.name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/materials/upload', true)
    const token = getAuthToken()
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token)
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !onProgress) return
      onProgress(Math.round((event.loaded / event.total) * 100), event)
    }
    xhr.onload = () => {
      let data = null
      try { data = JSON.parse(xhr.responseText || '{}') } catch(e) {}
      if (xhr.status >= 200 && xhr.status < 300 && data && !data.error) resolve(data)
      else reject(new Error((data && (data.error || data.msg)) || xhr.statusText || '上传失败'))
    }
    xhr.onerror = () => reject(new Error('网络上传失败'))
    xhr.ontimeout = () => reject(new Error('上传超时'))
    xhr.timeout = 30 * 60 * 1000
    xhr.send(form)
  })
}

export function updateMaterial(payload) {
  return request('/api/materials/update', {
    method: 'POST',
    body: payload
  })
}

export function aiTagMaterial(id) {
  return request('/api/materials/ai-tag', {
    method: 'POST',
    body: { id }
  })
}

export function deleteMaterial(id) {
  return request('/api/materials/delete', {
    method: 'POST',
    body: { id }
  })
}

export function restoreMaterials(ids = []) {
  return request('/api/materials/restore', {
    method: 'POST',
    body: { ids: Array.isArray(ids) ? ids : [ids] }
  })
}

export function recordMaterialDownload(id) {
  return request('/api/materials/download/' + encodeURIComponent(id), {
    method: 'POST',
    body: {}
  })
}

export function listFolders(type = 'video') {
  return request('/api/materials/folders', {
    method: 'POST',
    body: { type }
  })
}

export function createFolder(name, type = 'video', parent = '/') {
  return request('/api/materials/folders/create', {
    method: 'POST',
    body: { name, type, parent }
  })
}

export function deleteFolder(id, options = {}) {
  return request('/api/materials/folders/delete', {
    method: 'POST',
    body: { id, ...options }
  })
}

export function renameFolder(id, name) {
  return request('/api/materials/folders/rename', {
    method: 'POST',
    body: { id, name }
  })
}

export function moveFolder(id, parent) {
  return request('/api/materials/folders/move', {
    method: 'POST',
    body: { id, parent }
  })
}
