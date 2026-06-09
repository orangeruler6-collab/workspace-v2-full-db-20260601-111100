import { getAuthToken, request } from './client'

export function listVideoPublishJobs(payload = {}) {
  return request('/api/video-publish/jobs', {
    method: 'POST',
    body: payload
  })
}

export function listVideoPublishAccounts(payload = {}) {
  return request('/api/video-publish/accounts/list', {
    method: 'POST',
    body: payload
  })
}

export function saveVideoPublishAccount(payload = {}) {
  return request('/api/video-publish/accounts/save', {
    method: 'POST',
    body: payload
  })
}

export function checkVideoPublishLogin(payload = {}) {
  return request('/api/video-publish/accounts/check-login', {
    method: 'POST',
    body: payload
  })
}

export function openVideoPublishLogin(payload = {}) {
  return request('/api/video-publish/accounts/open-login', {
    method: 'POST',
    body: payload
  })
}

export function launchVideoPublishProfile(payload = {}) {
  return request('/api/video-publish/accounts/launch-profile', {
    method: 'POST',
    body: payload
  })
}

export function createVideoPublishJobs(payload) {
  return request('/api/video-publish/jobs/create', {
    method: 'POST',
    body: payload
  })
}

export function updateVideoPublishJobStatus(payload) {
  return request('/api/video-publish/jobs/update-status', {
    method: 'POST',
    body: payload
  })
}

export function runVideoPublishJob(id) {
  return request('/api/video-publish/jobs/run', {
    method: 'POST',
    body: { id }
  })
}

export function cancelVideoPublishJob(id) {
  return request('/api/video-publish/jobs/cancel', {
    method: 'POST',
    body: { id }
  })
}

export function checkVideoPublishJob(id) {
  return request('/api/video-publish/jobs/check', {
    method: 'POST',
    body: { id }
  })
}

export function runVideoPublishJobs(ids = []) {
  return request('/api/video-publish/jobs/run-batch', {
    method: 'POST',
    body: { ids }
  })
}

export function getVideoPublishQueueStatus() {
  return request('/api/video-publish/queue/status', {
    method: 'POST',
    body: {}
  })
}

export function pauseVideoPublishQueue(paused = true) {
  return request('/api/video-publish/queue/pause', {
    method: 'POST',
    body: { paused }
  })
}

export function listVideoPublishJobLogs(payload = {}) {
  return request('/api/video-publish/jobs/logs', {
    method: 'POST',
    body: payload
  })
}

export function deleteVideoPublishJob(id) {
  return request('/api/video-publish/jobs/delete', {
    method: 'POST',
    body: { id }
  })
}

export function uploadVideoPublishFile(file, payload = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('name', file.name || 'video')
  form.append('type', file.type || '')
  form.append('size', String(file.size || 0))
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, String(value))
  })
  const headers = {}
  const token = getAuthToken()
  if (token) headers.Authorization = 'Bearer ' + token
  return fetch('/api/video-publish/videos/upload-file', {
    method: 'POST',
    headers,
    body: form
  }).then(async resp => {
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data.error || data.ok === false) throw new Error(data.error || data.message || `HTTP ${resp.status}`)
    return data
  })
}

export function transcribeVideoPublishVideo(payload = {}) {
  return request('/api/video-publish/videos/transcribe', {
    method: 'POST',
    body: payload
  })
}
