import { request } from './client'

export function listProfits(grp) {
  const qs = grp ? '?grp=' + encodeURIComponent(grp) : ''
  return request('/api/profits' + qs)
}

export function getProfitStats(grp) {
  const qs = grp ? '?grp=' + encodeURIComponent(grp) : ''
  return request('/api/profits/stats' + qs)
}

export function parseProfitText(text) {
  return request('/api/profits/parse', {
    method: 'POST',
    body: { text }
  })
}

export function parseProfitFile(fileName, fileData, options = {}) {
  return request('/api/profits/parse', {
    method: 'POST',
    body: {
      file_name: fileName,
      file_data: fileData,
      year: options.year,
      month: options.month
    }
  })
}

export function syncProfitRecords(records, options = {}) {
  return request('/api/profits/sync', {
    method: 'POST',
    body: {
      records,
      mode: options.mode || 'sync'
    }
  })
}

export function syncProfitsToFeishu(options = {}) {
  return request('/api/profits/sync-feishu', {
    method: 'POST',
    body: {
      limit: options.limit || 0,
      force: options.force !== false
    }
  })
}

export function addProfit(record) {
  return request('/api/profits', {
    method: 'POST',
    body: record
  })
}

export function updateProfit(id, record) {
  return request('/api/profits/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: record
  })
}

export function deleteProfit(id) {
  return request('/api/profits/' + encodeURIComponent(id), {
    method: 'DELETE'
  })
}

export function importFeishuProfits() {
  return request('/api/feishu/profit')
}
