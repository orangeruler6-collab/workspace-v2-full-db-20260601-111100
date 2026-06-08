import { getAuthToken, request } from './client'

export function chatAgent(payload, signal) {
  return request('/api/agent/chat', {
    method: 'POST',
    body: payload,
    signal
  })
}

export async function chatAgentStream(payload, handlers = {}, signal) {
  const token = getAuthToken()
  const resp = await fetch('/api/agent/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: JSON.stringify(payload),
    signal
  })
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => 'stream failed')
    throw new Error(`请求失败 (${resp.status}): ${text.slice(0, 120)}`)
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      const lines = block.split(/\r?\n/)
      let event = 'message'
      const dataLines = []
      for (const line of lines) {
        if (!line) continue
        if (line.startsWith('event:')) {
          event = line.slice(6).trim()
          continue
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
      }
      const text = dataLines.join('\n').trim()
      if (!text) continue
      let parsed = null
      try { parsed = JSON.parse(text) } catch (e) { parsed = { raw: text } }
      if (handlers.onEvent) handlers.onEvent(event, parsed)
      if (event === 'delta' && handlers.onDelta) handlers.onDelta(parsed)
      if (event === 'done' && handlers.onDone) handlers.onDone(parsed)
      if (event === 'error' && handlers.onError) handlers.onError(parsed)
    }
  }
}

export function runAgentTask(payload, signal) {
  return request('/api/agent/run', {
    method: 'POST',
    body: payload,
    signal
  })
}

export function previewAgentTools(payload) {
  return request('/api/agent/tools/preview', {
    method: 'POST',
    body: payload
  })
}

export function listAgentDrafts(payload = {}) {
  return request('/api/agent/drafts/list', {
    method: 'POST',
    body: payload,
    skipAuthExpired: true
  })
}

export function saveAgentDraft(payload) {
  return request('/api/agent/drafts/save', {
    method: 'POST',
    body: payload
  })
}

export function updateAgentDraft(payload) {
  return request('/api/agent/drafts/update', {
    method: 'POST',
    body: payload
  })
}

export function deleteAgentDraft(payload) {
  return request('/api/agent/drafts/delete', {
    method: 'POST',
    body: payload
  })
}

export function writeAgentFeishu(payload) {
  return request('/api/agent/feishu/write', {
    method: 'POST',
    body: payload
  })
}

export function startWeeklyReport(payload) {
  return request('/api/agent/weekly-report/start', {
    method: 'POST',
    body: payload
  })
}

export function getWeeklyReportJob(id) {
  return request('/api/agent/weekly-report/status', {
    method: 'POST',
    body: { id }
  })
}

export function listWeeklyReports(payload = {}) {
  return request('/api/agent/weekly-report/list', {
    method: 'POST',
    body: payload
  })
}

export function getWeeklyReport(payload) {
  return request('/api/agent/weekly-report/get', {
    method: 'POST',
    body: payload
  })
}
