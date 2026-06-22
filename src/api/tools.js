import { getAuthToken, request } from './client'

export function transcribeVideo(platform, url, signal) {
  return request('/api/transcribe/' + platform, {
    method: 'POST',
    body: { url },
    signal
  })
}

export async function transcribeAudioFile(file, signal) {
  const form = new FormData()
  form.append('file', file, file.name || 'audio.mp3')
  const headers = {}
  const token = getAuthToken()
  if (token) headers.Authorization = 'Bearer ' + token

  const resp = await fetch('/api/transcribe/audio', {
    method: 'POST',
    headers,
    body: form,
    signal
  })
  let data
  try {
    data = await resp.json()
  } catch (e) {
    const text = await resp.text().catch(() => 'Unknown error')
    throw new Error(`请求失败 (${resp.status}): ${text.slice(0, 100)}`)
  }
  if (!resp.ok || data.error || data.ok === false) {
    const err = new Error(data.error || data.message || `HTTP ${resp.status}`)
    err.status = resp.status
    err.data = data
    throw err
  }
  return data
}

export function runDouyinDownloader(payload, signal) {
  return request('/api/douyin/downloader', {
    method: 'POST',
    body: payload,
    signal
  })
}

export function fixText(text) {
  return request('/api/ai-fix', {
    method: 'POST',
    body: { text }
  })
}

export function generateComments(payload) {
  return request('/api/comment/generate', {
    method: 'POST',
    body: payload
  })
}

export function writeFeishu(payload) {
  return request('/api/to-feishu', {
    method: 'POST',
    body: payload
  })
}

export function searchHot(payload) {
  const body = typeof payload === 'string' ? { query: payload } : (payload || {})
  return request('/api/hot/search', {
    method: 'POST',
    body
  })
}

export function searchPlatform(payload) {
  return request('/api/platform/search', {
    method: 'POST',
    body: payload
  })
}

export function extractSearchIntent(payload) {
  return request('/api/search-intent', {
    method: 'POST',
    body: payload
  })
}

export function searchVector(payload) {
  return request('/api/vector/search', {
    method: 'POST',
    body: payload
  })
}

export function readFeishu(doc) {
  const body = typeof doc === 'object' && doc !== null
    ? doc
    : String(doc || '').includes('feishu.cn')
      ? { url: doc }
      : { doc_id: doc }
  return request('/api/feishu/read', {
    method: 'POST',
    body
  })
}

export function parseWorkflowDocument(payload, signal) {
  return request('/api/workflow/parse-document', {
    method: 'POST',
    body: payload,
    signal
  })
}

export function chatMinimax(payload) {
  return request('/api/chat-minimax', {
    method: 'POST',
    body: payload
  })
}

export function listWorkflowStyles() {
  return request('/api/workflow/styles', {
    method: 'POST',
    body: {}
  })
}

export function fetchBilibiliTrafficStats(payload) {
  return request('/api/traffic-plan/bilibili-stats', {
    method: 'POST',
    body: payload
  })
}
