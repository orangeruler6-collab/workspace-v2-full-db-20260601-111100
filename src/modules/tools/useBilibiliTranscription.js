import { ref } from 'vue'
import { transcribeVideo } from '../../api/tools'
import { cleanTranscriptText } from './textCleanup'

const PROGRESS_STEPS = [
  { at: 10, text: '正在解析 B站链接' },
  { at: 30, text: '正在读取视频信息' },
  { at: 52, text: '正在优先获取字幕' },
  { at: 74, text: '正在尝试音频转写兜底' },
  { at: 90, text: '正在整理文案' }
]

function normalizeBilibiliUrl(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''

  const bv = raw.match(/\bBV[0-9A-Za-z]{8,}\b/)
  if (bv) return `https://www.bilibili.com/video/${bv[0]}`

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/[^\s"'<>，。！？；：、）】》」』\])}]+/i,
    /(?:https?:\/\/)?b23\.tv\/[^\s"'<>，。！？；：、）】》」』\])}]+/i
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (!match) continue
    let url = match[0].replace(/[)\]}>"'，。！？；：、]+$/g, '')
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    return url
  }

  return ''
}

function extractError(error, fallback) {
  if (!error) return fallback
  if (error.name === 'AbortError') return '转写超时，请稍后重试或换一个链接'
  return error.message || String(error) || fallback
}

export function extractBilibiliUrl(text) {
  return normalizeBilibiliUrl(text)
}

export function useBilibiliTranscription(showToast) {
  const bilibiliUrl = ref('')
  const transcribingBilibili = ref(false)
  const bilibiliProgress = ref(0)
  const bilibiliProgressText = ref('等待开始')
  const bilibiliResult = ref('')
  const bilibiliError = ref('')
  const bilibiliTitle = ref('')
  const bilibiliBvid = ref('')
  const bilibiliSource = ref('')
  const bilibiliFixing = ref(false)

  async function handleTranscribeBilibili() {
    const cleanedUrl = normalizeBilibiliUrl(bilibiliUrl.value)
    if (!cleanedUrl) {
      showToast('没有识别到 B站链接，请粘贴 B站链接、b23 短链或 BV 号', 'error')
      return
    }

    bilibiliUrl.value = cleanedUrl
    transcribingBilibili.value = true
    bilibiliProgress.value = 6
    bilibiliProgressText.value = '正在解析 B站链接'
    bilibiliResult.value = ''
    bilibiliError.value = ''
    bilibiliTitle.value = ''
    bilibiliBvid.value = ''
    bilibiliSource.value = ''

    let timeout = null
    let progressTimer = null

    try {
      const controller = new AbortController()
      timeout = window.setTimeout(() => controller.abort(), 600000)
      progressTimer = window.setInterval(() => {
        if (bilibiliProgress.value >= 92) return
        const next = PROGRESS_STEPS.find(step => step.at > bilibiliProgress.value)
        bilibiliProgress.value = Math.min(92, bilibiliProgress.value + (bilibiliProgress.value < 62 ? 4 : 2))
        if (next && bilibiliProgress.value >= next.at) {
          bilibiliProgressText.value = next.text
        }
      }, 1200)

      const data = await transcribeVideo('bilibili', cleanedUrl, controller.signal)
      if (timeout) window.clearTimeout(timeout)
      if (progressTimer) window.clearInterval(progressTimer)

      bilibiliTitle.value = data.title || ''
      bilibiliBvid.value = data.bvid || ''
      bilibiliSource.value = data.source || ''

      if (data.error && !data.text) {
        bilibiliProgress.value = 100
        bilibiliProgressText.value = '处理失败'
        bilibiliError.value = data.error || 'B站转写失败'
        showToast(bilibiliError.value, 'error')
        return
      }

      bilibiliResult.value = data.text || ''
      if (!bilibiliResult.value) {
        bilibiliProgress.value = 100
        bilibiliProgressText.value = '没有拿到转写文本'
        bilibiliError.value = data.error || '没有拿到可用字幕或音频转写结果'
        showToast(bilibiliError.value, 'error')
        return
      }

      bilibiliProgress.value = 100
      bilibiliProgressText.value = data.source === 'bilibili-cli:subtitle' ? '字幕提取完成' : '音频转写完成'
      showToast('B站文案转写完成', 'success')
    } catch (e) {
      if (timeout) window.clearTimeout(timeout)
      if (progressTimer) window.clearInterval(progressTimer)
      bilibiliProgress.value = 100
      bilibiliProgressText.value = '处理失败'
      bilibiliError.value = extractError(e, 'B站转写失败')
      showToast(bilibiliError.value, 'error')
    } finally {
      transcribingBilibili.value = false
    }
  }

  async function handleFix() {
    const text = bilibiliResult.value.trim()
    if (!text) {
      showToast('没有可清洗的文案', 'error')
      return
    }
    bilibiliFixing.value = true
    try {
      const fixed = cleanTranscriptText(text)
      if (!fixed) throw new Error('清洗结果为空')
      bilibiliResult.value = fixed
      showToast('已清洗并重新分段', 'success')
    } catch (e) {
      showToast('清洗失败：' + extractError(e, '未知错误'), 'error')
    } finally {
      bilibiliFixing.value = false
    }
  }

  return {
    bilibiliUrl,
    transcribingBilibili,
    bilibiliProgress,
    bilibiliProgressText,
    bilibiliResult,
    bilibiliError,
    bilibiliTitle,
    bilibiliBvid,
    bilibiliSource,
    bilibiliFixing,
    handleTranscribeBilibili,
    handleFix
  }
}
