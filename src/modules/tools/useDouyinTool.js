import { ref } from 'vue'
import { runDouyinDownloader, transcribeVideo, writeFeishu } from '../../api/tools'
import { cleanTranscriptText } from './textCleanup'

const PROGRESS_STEPS = [
  { at: 10, text: '正在解析抖音链接' },
  { at: 28, text: '正在获取视频信息' },
  { at: 48, text: '正在提取音频/字幕' },
  { at: 70, text: '正在转写文案' },
  { at: 88, text: '正在整理结果' }
]

const URL_BOUNDARY = /[\s"'<>，。！？；：、）】》」』\])}]+/

function cleanUrl(url) {
  let value = String(url || '').trim()
  value = value.split(URL_BOUNDARY)[0] || value
  value = value.replace(/[?#&]*$/, '')
  value = value.replace(/[)\]}>"'，。！？；：、]+$/g, '')
  if (value && !/^https?:\/\//i.test(value)) value = 'https://' + value
  return value
}

export function extractDouyinUrls(text) {
  const raw = String(text || '').trim()
  if (!raw) return []

  const results = []
  const patterns = [
    /(?:https?:\/\/)?v\.douyin\.com\/[^\s"'<>，。！？；：、）】》」』\])}]+/ig,
    /(?:https?:\/\/)?(?:www\.)?douyin\.com\/video\/[^\s"'<>，。！？；：、）】》」』\])}]+/ig,
    /(?:https?:\/\/)?(?:www\.)?douyin\.com\/note\/[^\s"'<>，。！？；：、）】》」』\])}]+/ig,
    /(?:https?:\/\/)?(?:www\.)?iesdouyin\.com\/share\/[^\s"'<>，。！？；：、）】》」』\])}]+/ig
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(raw))) {
      const url = cleanUrl(match[0])
      if (url && !results.includes(url)) results.push(url)
    }
  }

  return results
}

function firstDouyinUrl(text) {
  return extractDouyinUrls(text)[0] || ''
}

function extractError(error, fallback) {
  if (!error) return fallback
  if (error.name === 'AbortError') return '转写超时，请稍后重试或换一个链接'
  return error.message || String(error) || fallback
}

function buildDouyinSummary(data, isBatch, urlCount) {
  const parts = []
  if (data.message) parts.push(data.message)
  else parts.push(isBatch ? `批量处理完成：${urlCount} 条链接` : '抖音处理完成')
  if (data.transcript_text) parts.push('已生成转写文案')
  if (Array.isArray(data.files) && data.files.length) parts.push(`已生成文件：${data.files.length} 个`)
  if (Array.isArray(data.items) && data.items.length) parts.push(`返回条目：${data.items.length} 条`)
  return parts.join('\n')
}

export function useDouyinTool(showToast) {
  const douyinMode = ref('download')
  const douyinUrl = ref('')
  const douyinKeyword = ref('')
  const douyinTranscribeUrl = ref('')
  const douyinTranscribeModel = ref('FunAudioLLM/SenseVoiceSmall')
  const douyinTranscribing = ref(false)
  const douyinTranscribeResult = ref('')
  const douyinLimit = ref(20)
  const douyinThread = ref(5)
  const douyinCollectComments = ref(false)
  const douyinIncludeReplies = ref(false)
  const douyinCommentLimit = ref(50)
  const douyinDownloadEnabled = ref(false)
  const douyinDownloadType = ref('mp4')
  const douyinTranscriptModel = ref('FunAudioLLM/SenseVoiceSmall')
  const douyinLoading = ref(false)
  const douyinProgress = ref(0)
  const douyinProgressText = ref('等待开始')
  const douyinSummary = ref('')
  const douyinLog = ref('')
  const douyinFiles = ref([])
  const douyinItems = ref([])
  const douyinError = ref('')
  const douyinTranscriptText = ref('')
  const douyinFixing = ref(false)
  const douyinWritingFeishu = ref(false)
  const douyinFeishuUrl = ref('')

  async function handleRunDouyin() {
    const urls = extractDouyinUrls(douyinUrl.value)
    if (!urls.length) {
      showToast('没有识别到抖音链接，请粘贴分享口令或视频链接', 'error')
      return
    }

    const isBatch = urls.length > 1
    const useFastTranscribe = !isBatch && !douyinDownloadEnabled.value && !douyinCollectComments.value
    douyinUrl.value = urls[0]
    douyinLoading.value = true
    douyinTranscribing.value = true
    douyinProgress.value = 6
    douyinProgressText.value = isBatch ? `已识别 ${urls.length} 条链接` : '正在解析抖音链接'
    douyinSummary.value = ''
    douyinLog.value = ''
    douyinFiles.value = []
    douyinItems.value = []
    douyinError.value = ''
    douyinTranscriptText.value = ''
    douyinTranscribeResult.value = ''

    let timeout = null
    let progressTimer = null

    try {
      const controller = new AbortController()
      timeout = window.setTimeout(() => controller.abort(), 900000)
      progressTimer = window.setInterval(() => {
        if (douyinProgress.value >= 92) return
        const next = PROGRESS_STEPS.find(step => step.at > douyinProgress.value)
        douyinProgress.value = Math.min(92, douyinProgress.value + (douyinProgress.value < 60 ? 4 : 2))
        if (next && douyinProgress.value >= next.at) {
          douyinProgressText.value = isBatch ? `正在批量转写 ${urls.length} 条链接` : next.text
        }
      }, 1200)

      if (useFastTranscribe) {
        douyinProgressText.value = '快速转写中'
        const data = await transcribeVideo('douyin', urls[0], controller.signal)
        if (timeout) window.clearTimeout(timeout)
        if (progressTimer) window.clearInterval(progressTimer)

        const text = cleanTranscriptText(data.text || '')
        douyinTranscriptText.value = text
        douyinTranscribeResult.value = text
        douyinSummary.value = text ? '快速转写完成' : (data.error || '处理完成，但没有拿到转写文本')
        douyinLog.value = data.error || ''

        if (!text) {
          douyinProgress.value = 100
          douyinProgressText.value = '没有拿到转写文本'
          douyinError.value = data.error || '抖音转写失败'
          showToast(douyinError.value, 'error')
          return
        }

        douyinProgress.value = 100
        douyinProgressText.value = '转写完成'
        showToast('抖音文案转写完成', 'success')
        return
      }

      const payload = {
        action: 'download',
        keyword: douyinKeyword.value.trim(),
        limit: douyinLimit.value,
        thread: douyinThread.value,
        collectComments: douyinCollectComments.value,
        includeReplies: douyinIncludeReplies.value,
        commentLimit: douyinCommentLimit.value,
        autoTranscript: true,
        transcriptModel: douyinTranscriptModel.value,
        downloadAssets: douyinDownloadEnabled.value,
        downloadType: douyinDownloadType.value
      }
      if (isBatch) payload.urls = urls
      else payload.url = urls[0]

      const data = await runDouyinDownloader(payload, controller.signal)
      if (timeout) window.clearTimeout(timeout)
      if (progressTimer) window.clearInterval(progressTimer)

      douyinFiles.value = Array.isArray(data.files) ? data.files : []
      douyinItems.value = Array.isArray(data.items) ? data.items : []
      douyinTranscriptText.value = data.transcript_text || data.text || ''
      douyinTranscribeResult.value = douyinTranscriptText.value
      douyinLog.value = [data.log, data.stderr].filter(Boolean).join('\n\n')
      douyinSummary.value = buildDouyinSummary(data, isBatch, urls.length)

      if (data.success === false || data.ok === false || data.error) {
        douyinProgress.value = 100
        douyinProgressText.value = '处理失败'
        douyinError.value = data.error || data.stderr || data.log || data.message || '抖音转写失败'
        showToast(douyinError.value, 'error')
        return
      }

      douyinProgress.value = 100
      douyinProgressText.value = douyinTranscriptText.value ? '转写完成' : '处理完成，但没有拿到转写文本'
      showToast(douyinTranscriptText.value ? '抖音文案转写完成' : '处理完成，请查看返回信息', douyinTranscriptText.value ? 'success' : 'info')
    } catch (e) {
      if (timeout) window.clearTimeout(timeout)
      if (progressTimer) window.clearInterval(progressTimer)
      douyinProgress.value = 100
      douyinProgressText.value = '处理失败'
      douyinError.value = extractError(e, '抖音转写失败')
      showToast(douyinError.value, 'error')
    } finally {
      douyinLoading.value = false
      douyinTranscribing.value = false
    }
  }

  async function handleTranscribeDouyin() {
    const url = firstDouyinUrl(douyinTranscribeUrl.value || douyinUrl.value)
    if (!url) {
      showToast('请先粘贴抖音分享口令或视频链接', 'error')
      return
    }
    douyinUrl.value = url
    douyinTranscribeUrl.value = url
    await handleRunDouyin()
  }

  async function handleFixDouyin() {
    const text = douyinTranscriptText.value.trim()
    if (!text) {
      showToast('没有可清洗的文案', 'error')
      return
    }
    douyinFixing.value = true
    try {
      const fixed = cleanTranscriptText(text)
      if (!fixed) throw new Error('清洗结果为空')
      douyinTranscriptText.value = fixed
      douyinTranscribeResult.value = fixed
      showToast('已清洗并重新分段', 'success')
    } catch (e) {
      showToast('清洗失败：' + extractError(e, '未知错误'), 'error')
    } finally {
      douyinFixing.value = false
    }
  }

  async function handleWriteToFeishu() {
    const text = douyinTranscriptText.value.trim()
    if (!text) {
      showToast('没有可写入飞书的文案', 'error')
      return
    }
    douyinWritingFeishu.value = true
    try {
      const title = '抖音转写 ' + new Date().toLocaleDateString('zh-CN')
      const result = await writeFeishu({ tool: 'docx', title, content: text })
      if (result && result.code === 0) {
        douyinFeishuUrl.value = result.doc_url || ''
        showToast('已写入飞书', 'success')
      } else {
        showToast('写入飞书失败：' + (result && result.msg ? result.msg : '未知错误'), 'error')
      }
    } catch (e) {
      showToast('写入飞书失败：' + extractError(e, '未知错误'), 'error')
    } finally {
      douyinWritingFeishu.value = false
    }
  }

  return {
    douyinMode,
    douyinUrl,
    douyinKeyword,
    douyinTranscribeUrl,
    douyinTranscribeModel,
    douyinTranscribing,
    douyinTranscribeResult,
    douyinLimit,
    douyinThread,
    douyinCollectComments,
    douyinIncludeReplies,
    douyinCommentLimit,
    douyinDownloadEnabled,
    douyinDownloadType,
    douyinTranscriptModel,
    douyinLoading,
    douyinProgress,
    douyinProgressText,
    douyinSummary,
    douyinLog,
    douyinFiles,
    douyinItems,
    douyinError,
    douyinTranscriptText,
    douyinFixing,
    douyinWritingFeishu,
    douyinFeishuUrl,
    handleRunDouyin,
    handleTranscribeDouyin,
    handleFixDouyin,
    handleWriteToFeishu
  }
}
