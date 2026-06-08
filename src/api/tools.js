import { request } from './client'

export function transcribeVideo(platform, url, signal) {
  return request('/api/transcribe/' + platform, {
    method: 'POST',
    body: { url },
    signal
  })
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

export function parseWorkflowDocument(payload) {
  return request('/api/workflow/parse-document', {
    method: 'POST',
    body: payload
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
