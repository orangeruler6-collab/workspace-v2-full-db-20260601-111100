import { inject, provide, reactive } from 'vue'

const ToastKey = Symbol('toast')

const defaults = {
  show: false,
  msg: '',
  type: 'info',
  big: false
}

const majorSuccessWords = [
  '完成',
  '生成',
  '导入',
  '写入',
  '发布',
  '转写完成',
  '分析完成',
  '扫描完成',
  '创建',
  '保存'
]

const feedbackKindRules = [
  { kind: 'handoff', words: ['新订单', '收到新的订单', '交接'] },
  { kind: 'task-done', words: ['完成', '已完成', '打卡'] },
  { kind: 'generate', words: ['生成', '分析完成', '转写完成', 'AI 推荐', 'AI推荐'] },
  { kind: 'save', words: ['保存', '已更新', '已添加', '已导入', '已写入', '入库'] },
  { kind: 'favorite', words: ['收藏'] },
  { kind: 'copy', words: ['复制'] }
]

let globalShowToast = null

function inferFeedbackKind(msg, type, options = {}) {
  if (options.kind || options.feedbackKind) return options.kind || options.feedbackKind
  const text = String(msg || '')
  if (type === 'error') return 'error'
  if (type === 'warning' || type === 'warn') return 'warning'
  if (type === 'success') {
    const match = feedbackKindRules.find(rule => rule.words.some(word => text.includes(word)))
    return match?.kind || 'success'
  }
  if (options.feedback) return 'info'
  return ''
}

function inferIntensity(msg, type, options = {}) {
  if (options.intensity) return options.intensity
  if (options.big) return 'hero'
  if (type === 'error' || type === 'warning' || type === 'warn') return 'notice'
  const text = String(msg || '')
  return majorSuccessWords.some(word => text.includes(word)) ? 'pop' : 'light'
}

function emitFeedback(msg, type, options = {}) {
  if (typeof window === 'undefined') return
  if (options.feedback === false || options.quiet) return
  const normalizedType = type === 'warn' ? 'warning' : type
  const kind = inferFeedbackKind(msg, normalizedType, options)
  if (!kind) return
  window.dispatchEvent(new CustomEvent('usagi:feedback', {
    detail: {
      type: normalizedType,
      kind,
      intensity: inferIntensity(msg, normalizedType, options),
      title: options.celebrationTitle || options.title,
      message: msg,
      detail: options.celebrationDetail || options.detail || String(msg || '').slice(0, 72),
      x: options.x,
      y: options.y,
      mode: options.mode,
      timeout: options.feedbackTimeout,
      petMood: options.petMood,
      meta: options.meta || null
    }
  }))
}

function createToastController(timeout = 3500) {
  const toast = reactive({ ...defaults })
  let toastTimer = null

  function hideToast() {
    toast.show = false
  }

  function showToast(msg, type = 'info', options = {}) {
    if (typeof options === 'boolean') options = { big: options }
    toast.msg = msg
    toast.type = type
    toast.big = Boolean(options.big)
    toast.show = true
    clearTimeout(toastTimer)
    toastTimer = setTimeout(hideToast, options.timeout || timeout)
    emitFeedback(msg, type, options)
  }

  return { toast, showToast, hideToast }
}

export function provideToast(timeout = 3500) {
  const controller = createToastController(timeout)
  globalShowToast = controller.showToast
  provide(ToastKey, controller.showToast)
  return controller
}

export function useToast(timeout = 3500) {
  const injectedShowToast = inject(ToastKey, null)
  const showToast = injectedShowToast || globalShowToast
  if (showToast) {
    return {
      toast: reactive({ ...defaults }),
      showToast
    }
  }
  return createToastController(timeout)
}
