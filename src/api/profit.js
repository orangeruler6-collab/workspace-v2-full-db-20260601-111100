import { request } from './client'

export function listProfits(grp, options = {}) {
  return request('/api/profits', {
    query: {
      grp: grp || undefined,
      year: options.year || undefined,
      month: options.month || undefined
    }
  })
}

export function getProfitStats(grp, options = {}) {
  return request('/api/profits/stats', {
    query: {
      grp: grp || undefined,
      year: options.year || undefined,
      month: options.month || undefined
    }
  })
}

export function listProfitTargets() {
  return request('/api/profits/targets')
}

export function saveProfitTarget(payload) {
  return request('/api/profits/targets/save', {
    method: 'POST',
    body: payload
  })
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

export function pullProfitsFromWecom(options = {}) {
  return request('/api/profits/pull-wecom', {
    method: 'POST',
    body: {
      year: options.year || 0,
      month: options.month || 0,
      mode: options.mode || 'merge',
      sourceMode: options.sourceMode || options.priceMode || options.wecomMode || 'all'
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
