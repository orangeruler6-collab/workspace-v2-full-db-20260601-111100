<template>
  <div class="style-workbench-frame">
    <div v-if="active && loading" class="style-workbench-state">
      <div class="style-workbench-spinner"></div>
      <span>正在预加载文案工作台...</span>
    </div>

    <div v-if="active && failed" class="style-workbench-state error">
      <strong>文案工作台服务未连接</strong>
      <span>请确认 Next 子应用已经随 `npm run dev` 启动，或单独运行 `npm run dev:style`。</span>
      <button type="button" class="btn btn-primary btn-sm" @click="reloadFrames">重新加载</button>
    </div>

    <div v-if="active && !loading && !failed && !ready" class="style-workbench-state">
      <div class="style-workbench-spinner"></div>
      <span>文案工作台正在接线中，稍等一下下...</span>
      <button type="button" class="btn btn-primary btn-sm" @click="reloadFrames">重新连接</button>
    </div>

    <iframe
      v-for="frame in activeFrames"
      :key="frame.path"
      :ref="setFrameRef(frame.path)"
      class="style-workbench-iframe"
      :class="{ active: ready && normalizedPath === frame.path, preloaded: loadedFrames.has(frame.path) }"
      :src="frameUrl(frame)"
      :title="frame.title"
      loading="eager"
      @load="handleLoad(frame.path)"></iframe>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCurrentAuthUser } from '../api/client'

let healthReady = false

const frames = [
  { path: '/library', title: '账号库', url: '/style-workbench/library' },
  { path: '/project-workbench', title: '项目工作台', url: '/style-workbench/project-workbench' },
  { path: '/writer', title: '对话写作', url: '/style-workbench/writer' },
  { path: '/assets', title: '评论生成', url: '/style-workbench/assets' },
  { path: '/gross-margin', title: '数据维护', url: '/style-workbench/gross-margin' }
]

const moduleByPath = {
  '/library': 'styleLibrary',
  '/project-workbench': 'styleProjectWorkbench',
  '/writer': 'styleWriter',
  '/assets': 'styleAssets',
  '/gross-margin': 'styleGrossMargin'
}

const props = defineProps({
  active: {
    type: Boolean,
    default: false
  },
  path: {
    type: String,
    default: '/'
  },
  trafficContext: {
    type: Object,
    default: null
  }
})

const frameRefs = new Map()
const loading = ref(true)
const failed = ref(false)
const ready = ref(false)
const loadedFrames = ref(new Set())
const mountedFramePaths = ref(new Set([normalizePath(props.path)]))
const authVersion = ref(authSignature())
let failTimer = null
let warmupTimers = []
let warmupStarted = false

const normalizedPath = computed(() => normalizePath(props.path))
const mountedFrames = computed(() => frames.filter(frame => mountedFramePaths.value.has(frame.path)))
const activeFrames = computed(() => mountedFrames.value)

function normalizePath(path) {
  if (!path || path === '/') return '/library'
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  if (normalized === '/projects') return '/project-workbench'
  if (normalized === '/copy-tools') return '/project-workbench'
  if (normalized === '/drafts') return '/writer'
  return moduleByPath[normalized] ? normalized : '/library'
}

function frameUrl(frame) {
  const query = new URLSearchParams({
    uiStyle: currentTheme(),
    hostActive: '0',
    hostWarmupData: '1',
    activePath: frame.path,
    authVersion: authVersion.value
  })
  return `${frame.url}?${query.toString()}`
}

function setFrameRef(path) {
  return (el) => {
    if (el) frameRefs.set(path, el)
    else frameRefs.delete(path)
  }
}

function clearFailTimer() {
  if (failTimer) {
    clearTimeout(failTimer)
    failTimer = null
  }
}

function clearWarmupTimers() {
  warmupTimers.forEach((timer) => clearTimeout(timer))
  warmupTimers = []
}

function armFailTimer() {
  clearFailTimer()
  failTimer = setTimeout(() => {
    if (loading.value) {
      failed.value = true
      loading.value = false
      ready.value = false
    }
  }, 8000)
}

function handleLoad(path) {
  const next = new Set(loadedFrames.value)
  next.add(path)
  loadedFrames.value = next
  sendThemeToFrames()
  sendAuthToFrames()
  sendActiveStateToFrames()

  if (path === normalizedPath.value || next.size === frames.length) {
    clearFailTimer()
    loading.value = false
    failed.value = false
  }
  if (path === normalizedPath.value) {
    warmupRemainingFrames()
  }
}

function mountFrame(path) {
  const next = new Set(mountedFramePaths.value)
  next.add(normalizePath(path))
  mountedFramePaths.value = next
}

function warmupRemainingFrames() {
  if (warmupStarted) return
  if (!loadedFrames.value.has(normalizedPath.value)) return
  warmupStarted = true
  clearWarmupTimers()
  const orderedPaths = [
    normalizePath(normalizedPath.value),
    '/library',
    '/project-workbench',
    '/writer',
    '/assets',
    '/gross-margin'
  ].filter((path, index, list) => list.indexOf(path) === index)

  orderedPaths.forEach((path, index) => {
    if (mountedFramePaths.value.has(path)) return
    const timer = setTimeout(() => {
      mountFrame(path)
    }, 120 + index * 180)
    warmupTimers.push(timer)
  })
}

function reloadFrames() {
  healthReady = false
  loading.value = true
  failed.value = false
  loadedFrames.value = new Set()
  mountedFramePaths.value = new Set([normalizedPath.value])
  warmupStarted = false
  clearWarmupTimers()
  checkWorkbench()
}

async function checkWorkbench() {
  clearFailTimer()
  loading.value = !healthReady
  failed.value = false

  if (healthReady) {
    ready.value = true
    loading.value = false
    warmupRemainingFrames()
    return
  }

  armFailTimer()

  try {
    const response = await fetch('/style-workbench/api/health', { cache: 'no-store' })
    if (!response.ok) throw new Error(`health ${response.status}`)
    clearFailTimer()
    healthReady = true
    ready.value = true
    loading.value = false
    failed.value = false
    warmupRemainingFrames()
  } catch (e) {
    clearFailTimer()
    failed.value = true
    loading.value = false
  }
}

function normalizeTheme(value) {
  if (['apple', 'silver', 'violet', 'usagi'].includes(value)) return value
  if (value === 'light') return 'apple'
  if (value === 'dark') return 'violet'
  return 'apple'
}

function currentTheme() {
  try {
    return normalizeTheme(document.documentElement.dataset.uiStyle || localStorage.getItem('usagi_ui_style') || 'apple')
  } catch (e) {
    return normalizeTheme(document.documentElement.dataset.uiStyle || 'apple')
  }
}

function sendThemeToFrames(style = currentTheme()) {
  const message = { type: 'usagi-ui-style', style: normalizeTheme(style) }
  frameRefs.forEach((frame) => {
    frame.contentWindow?.postMessage(message, window.location.origin)
  })
}

function safeAuthUser() {
  const user = getCurrentAuthUser()
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    title: user.title,
    permissions: Array.isArray(user.permissions) ? user.permissions : []
  }
}

function sendAuthToFrames() {
  const nextSignature = authSignature()
  if (nextSignature !== authVersion.value) {
    authVersion.value = nextSignature
  }
  const message = { type: 'usagi-auth-user', user: safeAuthUser() }
  frameRefs.forEach((frame) => {
    frame.contentWindow?.postMessage(message, window.location.origin)
  })
}

function authSignature() {
  const user = getCurrentAuthUser()
  const stable = user?.id ?? user?.username ?? user?.display_name ?? ''
  return stable ? `user-${String(stable)}` : 'anonymous'
}

function sendActiveStateToFrames() {
  const message = {
    type: 'style-workbench-active-path',
    path: normalizedPath.value,
    active: props.active
  }
  frameRefs.forEach((frame) => {
    frame.contentWindow?.postMessage(message, window.location.origin)
  })
}

function sendLibraryChangedToFrames(sourceWindow) {
  const message = { type: 'style-workbench-library-changed' }
  frameRefs.forEach((frame) => {
    if (frame.contentWindow === sourceWindow) return
    frame.contentWindow?.postMessage(message, window.location.origin)
  })
}

function sendWriterPrefillToFrame(payload) {
  mountFrame('/writer')
  setTimeout(() => {
    const frame = frameRefs.get('/writer')
    frame?.contentWindow?.postMessage({
      type: 'usagi-style-writer-prefill',
      payload
    }, window.location.origin)
  }, 120)
}

function sendTrafficContextToFrame(payload) {
  if (!payload) return
  mountFrame('/gross-margin')
  setTimeout(() => {
    const frame = frameRefs.get('/gross-margin')
    frame?.contentWindow?.postMessage({
      type: 'usagi-traffic-maintenance-context',
      payload
    }, window.location.origin)
  }, 140)
}

watch(normalizedPath, () => {
  mountFrame(normalizedPath.value)
  if (!loadedFrames.value.has(normalizedPath.value)) {
    loading.value = true
    failed.value = false
    armFailTimer()
  } else {
    clearFailTimer()
    loading.value = false
  }
  if (!healthReady) checkWorkbench()
  else warmupRemainingFrames()
  sendActiveStateToFrames()
})

watch(() => props.active, () => {
  if (props.active) mountFrame(normalizedPath.value)
  sendActiveStateToFrames()
})

watch(() => props.trafficContext, (payload) => {
  sendTrafficContextToFrame(payload)
}, { deep: true })

function handleHostThemeChange(event) {
  sendThemeToFrames(event?.detail?.style)
}

function handleWriterPrefill(event) {
  sendWriterPrefillToFrame(event.detail || null)
}

function handleFrameMessage(event) {
  if (event.origin !== window.location.origin) return
  if (event.data?.type === 'style-workbench-library-changed') {
    sendLibraryChangedToFrames(event.source)
  } else if (event.data?.type === 'usagi-auth-request') {
    event.source?.postMessage({ type: 'usagi-auth-user', user: safeAuthUser() }, window.location.origin)
  }
}

onMounted(() => {
  checkWorkbench()
  window.addEventListener('usagi:ui-style', handleHostThemeChange)
  window.addEventListener('usagi:style-writer-prefill', handleWriterPrefill)
  window.addEventListener('message', handleFrameMessage)
})

onBeforeUnmount(() => {
  clearFailTimer()
  clearWarmupTimers()
  window.removeEventListener('usagi:ui-style', handleHostThemeChange)
  window.removeEventListener('usagi:style-writer-prefill', handleWriterPrefill)
  window.removeEventListener('message', handleFrameMessage)
})
</script>
