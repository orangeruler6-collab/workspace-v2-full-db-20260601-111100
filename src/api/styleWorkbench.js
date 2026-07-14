import { getAuthToken, request } from './client'

export function loadStyleLibrary() {
  return request('/api/library')
}

export function loadStyleLibraryOverview() {
  return request('/api/library/overview')
}

export function loadStyleWorkbenchHealth() {
  return request('/api/health/style-workbench')
}

export function loadAccountDetail({ platform, accountId, includeStyle = false }) {
  return request('/api/accounts', {
    query: { platform, accountId, includeStyle: includeStyle ? '1' : undefined }
  })
}

export function createStyleAccount(input) {
  return request('/api/accounts', { method: 'POST', body: input })
}

export function deleteStyleAccounts(accountIds) {
  return request('/api/accounts', { method: 'DELETE', body: { accountIds } })
}

export function collectStyleAccount(input) {
  return request('/api/collect', { method: 'POST', body: input })
}

export function saveAccountStyle({ platform, accountId, content }) {
  return request('/api/style', { method: 'PUT', body: { platform, accountId, content } })
}

export function generateAccountStyle({ platform, accountId }) {
  return request('/api/style', { method: 'POST', body: { platform, accountId } })
}

export function transcribeAccountVideo({ platform, accountId, videoId, mediaUrl }) {
  return request('/api/transcribe', {
    method: 'POST',
    body: { platform, accountId, videoId, mediaUrl, allowRemoteDownload: true }
  })
}

export function deleteStyleVideos({ platform, accountId, videoIds }) {
  return request('/api/videos', { method: 'DELETE', body: { platform, accountId, videoIds } })
}

export async function downloadAccountTranscripts({ platform, accountId, accountName }) {
  const token = getAuthToken()
  const params = new URLSearchParams({ platform, accountId })
  const headers = token ? { Authorization: 'Bearer ' + token } : {}
  const response = await fetch(`/api/accounts/transcripts-export?${params.toString()}`, {
    headers,
    cache: 'no-store'
  })
  if (!response.ok) throw new Error(`导出失败（HTTP ${response.status}）`)
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || '导出转写稿失败')
  }
  const fileName = fileNameFromContentDisposition(response.headers.get('content-disposition')) || `${accountName || '账号'}-全部转写稿.docx`
  downloadBlob(await response.blob(), fileName)
  return { fileName }
}

export function loadProjectDetail(projectId, includeStyle = false) {
  return request('/api/projects', {
    query: { projectId, includeStyle: includeStyle ? '1' : undefined }
  })
}

export function saveStyleProject(input) {
  return request('/api/projects', { method: 'POST', body: input })
}

export function saveProjectStyle({ projectId, content }) {
  return request('/api/projects', { method: 'PUT', body: { projectId, content } })
}

export function generateProjectStyle(projectId) {
  return request('/api/projects', { method: 'PATCH', body: { projectId } })
}

export function loadCopySources() {
  return request('/api/copy-sources')
}

export function transcribeCopySource(input) {
  return request('/api/copy-sources', { method: 'POST', body: { action: 'transcribe', ...input } })
}

export function createProjectFromSources(input) {
  return request('/api/copy-sources', { method: 'POST', body: { action: 'create_project', ...input } })
}

export function loadDrafts() {
  return request('/api/drafts')
}

export function writeStyleCopy(input) {
  return request('/api/write', { method: 'POST', body: input })
}

export function saveStyleDraft(input) {
  return request('/api/drafts', { method: 'POST', body: input })
}

export function loadEngagementRecords() {
  return request('/api/engagement')
}

export function generateStyleEngagement(input) {
  return request('/api/engagement', { method: 'POST', body: input })
}

export function loadGrossMarginLibrary() {
  return request('/api/gross-margin')
}

export function saveGrossMarginPriceTable(input) {
  return request('/api/gross-margin', { method: 'POST', body: { action: 'savePriceTable', ...input } })
}

export function saveGrossMarginMonitorRecord(input) {
  return request('/api/gross-margin', { method: 'POST', body: { action: 'saveMonitorRecord', ...input } })
}

export function refreshGrossMarginMonitorRecord(recordId) {
  return request('/api/gross-margin', { method: 'POST', body: { action: 'refreshMonitorRecord', recordId } })
}

export function deleteGrossMarginMonitorRecord(recordId) {
  return request('/api/gross-margin', { method: 'POST', body: { action: 'deleteMonitorRecord', recordId } })
}

export function loadDouyinHotlist(input = {}) {
  return request('/api/douyin-hotlist', { query: input })
}

export function addDouyinHotlistAccount(query) {
  return request('/api/douyin-hotlist', { method: 'POST', body: { action: 'addAccount', query } })
}

export function removeDouyinHotlistAccount(accountId) {
  return request('/api/douyin-hotlist', { method: 'POST', body: { action: 'removeAccount', accountId } })
}

export function refreshDouyinHotlist(input = {}) {
  return request('/api/douyin-hotlist', { method: 'POST', body: { action: 'refresh', ...input } })
}

export function transcribeSingleVideo(input) {
  return request('/api/tools/single-video/transcribe', { method: 'POST', body: input })
}

export function generatePublishCopy(input) {
  return request('/api/tools/publish-copy', { method: 'POST', body: input })
}

export async function downloadSingleVideoAsset(input) {
  const token = getAuthToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  const response = await fetch('/api/tools/single-video/download', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
    cache: 'no-store'
  })
  if (!response.ok) {
    const data = await response.clone().json().catch(async () => {
      const text = await response.text().catch(() => '')
      return { error: text || `HTTP ${response.status}` }
    })
    throw new Error(data.error || data.message || `HTTP ${response.status}`)
  }
  const fileName = fileNameFromContentDisposition(response.headers.get('content-disposition')) || fallbackDownloadName(input.kind)
  const blob = await response.blob()
  downloadBlob(blob, fileName)
  return { fileName }
}

function fileNameFromContentDisposition(value) {
  if (!value) return ''
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (encoded && encoded[1]) {
    try { return decodeURIComponent(encoded[1]) } catch (e) { return encoded[1] }
  }
  const plain = value.match(/filename="?([^";]+)"?/i)
  return plain?.[1] || ''
}

function fallbackDownloadName(kind) {
  if (kind === 'cover') return '视频封面.jpg'
  if (kind === 'audio') return '视频音频.mp3'
  return '视频文件.mp4'
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
