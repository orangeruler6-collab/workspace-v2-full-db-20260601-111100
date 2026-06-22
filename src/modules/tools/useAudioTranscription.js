import { ref } from 'vue'
import { transcribeAudioFile } from '../../api/tools'
import { cleanTranscriptText } from './textCleanup'

const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'opus', 'mpeg', 'mpga']

function isSupportedAudioFile(file) {
  const name = String(file?.name || '')
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return String(file?.type || '').startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext)
}

function extractError(error, fallback) {
  if (!error) return fallback
  if (error.name === 'AbortError') return '音频转写超时，请稍后重试或换一个音频文件'
  return error.message || String(error) || fallback
}

export function useAudioTranscription(showToast) {
  const audioFile = ref(null)
  const audioFileName = ref('')
  const audioTranscribing = ref(false)
  const audioProgress = ref(0)
  const audioProgressText = ref('等待上传')
  const audioResult = ref('')
  const audioError = ref('')
  const audioSource = ref('')
  const audioFixing = ref(false)

  function setAudioFile(file) {
    if (!file) return
    if (!isSupportedAudioFile(file)) {
      showToast('暂时只支持 MP3、M4A、WAV、AAC、FLAC、OGG 等音频文件', 'error')
      return
    }
    audioFile.value = file
    audioFileName.value = file.name || 'audio.mp3'
    audioError.value = ''
    audioProgressText.value = '已选择音频，等待转写'
  }

  async function handleTranscribeAudio() {
    if (!audioFile.value) {
      showToast('请先选择一个 MP3 或音频文件', 'error')
      return
    }

    audioTranscribing.value = true
    audioProgress.value = 8
    audioProgressText.value = '正在上传音频'
    audioResult.value = ''
    audioError.value = ''
    audioSource.value = ''

    let timeout = null
    let progressTimer = null
    try {
      const controller = new AbortController()
      timeout = window.setTimeout(() => controller.abort(), 10 * 60 * 1000)
      progressTimer = window.setInterval(() => {
        if (audioProgress.value >= 92) return
        audioProgress.value = Math.min(92, audioProgress.value + (audioProgress.value < 55 ? 6 : 3))
        audioProgressText.value = audioProgress.value < 45 ? '正在上传音频' : audioProgress.value < 78 ? '硅基流动转写中' : '正在整理转写稿'
      }, 900)

      const data = await transcribeAudioFile(audioFile.value, controller.signal)
      if (timeout) window.clearTimeout(timeout)
      if (progressTimer) window.clearInterval(progressTimer)

      const text = cleanTranscriptText(data.text || data.transcript_text || '')
      audioResult.value = text
      audioSource.value = data.source || data.model || 'siliconflow'

      if (!text) {
        audioProgress.value = 100
        audioProgressText.value = '没有拿到转写文本'
        audioError.value = data.error || '音频转写完成，但没有返回可用文本'
        showToast(audioError.value, 'error')
        return
      }

      audioProgress.value = 100
      audioProgressText.value = 'MP3 转写完成'
      showToast('MP3 音频转写完成', 'success')
    } catch (e) {
      if (timeout) window.clearTimeout(timeout)
      if (progressTimer) window.clearInterval(progressTimer)
      audioProgress.value = 100
      audioProgressText.value = '处理失败'
      audioError.value = extractError(e, '音频转写失败')
      showToast(audioError.value, 'error')
    } finally {
      audioTranscribing.value = false
    }
  }

  async function handleFixAudio() {
    const text = audioResult.value.trim()
    if (!text) {
      showToast('没有可清洗的音频转写稿', 'error')
      return
    }
    audioFixing.value = true
    try {
      const fixed = cleanTranscriptText(text)
      if (!fixed) throw new Error('清洗结果为空')
      audioResult.value = fixed
      showToast('已清洗并重新分段', 'success')
    } catch (e) {
      showToast('清洗失败：' + extractError(e, '未知错误'), 'error')
    } finally {
      audioFixing.value = false
    }
  }

  return {
    audioFile,
    audioFileName,
    audioTranscribing,
    audioProgress,
    audioProgressText,
    audioResult,
    audioError,
    audioSource,
    audioFixing,
    setAudioFile,
    handleTranscribeAudio,
    handleFixAudio
  }
}
