import { request } from './client'

export function prepareSmartCollect(payload = {}) {
  return request('/api/smart-collect/prepare', {
    method: 'POST',
    body: payload
  })
}

export function planSmartCollectScript(payload = {}) {
  return request('/api/smart-collect/script-plan', {
    method: 'POST',
    body: payload
  })
}

export function importSmartCollectSelected(payload = {}) {
  return request('/api/smart-collect/import-selected', {
    method: 'POST',
    body: payload
  })
}

export function searchSmartCollectCandidates(payload = {}) {
  return request('/api/smart-collect/search-candidates', {
    method: 'POST',
    body: payload
  })
}

export function downloadSmartCollectSelected(payload = {}) {
  return request('/api/smart-collect/download-selected', {
    method: 'POST',
    body: payload
  })
}

export function getSmartCollectDownloaderStatus() {
  return request('/api/smart-collect/downloader-status', {
    method: 'POST',
    body: {}
  })
}

export function createAiEditProject(payload = {}) {
  return request('/api/ai-edit/projects/create', {
    method: 'POST',
    body: payload
  })
}

export function uploadAiEditVoiceover(payload = {}) {
  return request('/api/ai-edit/voiceover/upload', {
    method: 'POST',
    body: payload
  })
}

export function planAiEditTimeline(payload = {}) {
  return request('/api/ai-edit/timeline/plan', {
    method: 'POST',
    body: payload
  })
}

export function searchAiEditScene(payload = {}) {
  return request('/api/ai-edit/scene/search', {
    method: 'POST',
    body: payload
  })
}

export function saveAiEditTimeline(payload = {}) {
  return request('/api/ai-edit/timeline/save', {
    method: 'POST',
    body: payload
  })
}

export function exportAiEditPrXml(payload = {}) {
  return request('/api/ai-edit/export/prxml', {
    method: 'POST',
    body: payload
  })
}

export function renderAiEditRoughCut(payload = {}) {
  return request('/api/ai-edit/render/rough-cut', {
    method: 'POST',
    body: payload
  })
}

export function uploadAiEditMaterial(payload = {}) {
  return request('/api/materials/upload', {
    method: 'POST',
    body: payload
  })
}
