<template>
  <section class="style-workbench-native">
    <div class="page library-page workbench-frame-page">
      <header class="page-header">
        <div class="page-title-group">
          <span class="page-title-eyebrow">账号风格</span>
          <div class="page-title-row">
            <div class="page-title-copy">
              <h1>账号库</h1>
              <p class="subtle">采集、转写、风格沉淀。</p>
            </div>
          </div>
        </div>
        <div class="page-header-meta">
          <button class="btn ghost" type="button" :disabled="loading" @click="loadAll">
            <RefreshCw :size="16" aria-hidden="true" />
            刷新
          </button>
        </div>
      </header>

      <section class="panel workbench-leading-panel library-quick-start" aria-label="账号采集">
        <div class="library-quick-form">
          <div class="library-quick-fields">
            <div class="field library-platform-field">
              <span id="collect-platform-label">平台</span>
              <div class="segmented library-platform-segmented" role="group" aria-labelledby="collect-platform-label">
                <button type="button" :aria-pressed="accountForm.platform === 'bilibili'" :class="{ active: accountForm.platform === 'bilibili' }" @click="setCollectPlatform('bilibili')">B站</button>
                <button type="button" :aria-pressed="accountForm.platform === 'douyin'" :class="{ active: accountForm.platform === 'douyin' }" @click="setCollectPlatform('douyin')">抖音</button>
              </div>
            </div>
            <div class="field library-account-name-field">
              <label for="style-collect-account">账号名 / 主页链接</label>
              <div class="input-with-icon">
                <Search :size="16" aria-hidden="true" />
                <input
                  id="style-collect-account"
                  v-model="accountForm.name"
                  autocomplete="off"
                  @keyup.enter="collectFromForm"
                  :placeholder="accountForm.platform === 'douyin' ? '例如：老青椒、主页链接或 sec_uid…' : '例如：某某UP主、空间链接或 UID…'" />
              </div>
            </div>
            <label class="field">
              <span>数量</span>
              <input v-model.number="collectLimit" min="1" max="50" type="number" />
            </label>
            <label class="field">
              <span>采集排序</span>
              <select v-model="collectOrder">
                <option v-for="option in collectOrderOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field">
              <span>采集时间</span>
              <select v-model="collectTimeRange">
                <option v-for="option in timeRangeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label v-if="collectTimeRange === 'custom'" class="field">
              <span>开始日期</span>
              <input v-model="customFromDate" type="date" />
            </label>
            <label v-if="collectTimeRange === 'custom'" class="field">
              <span>结束日期</span>
              <input v-model="customToDate" type="date" />
            </label>
          </div>
          <div class="library-quick-actions">
            <button
              class="btn primary library-collect-submit"
              type="button"
              :disabled="collecting"
              :title="canCollect ? '开始采集账号作品' : '先输入账号名、主页链接或 UID'"
              @click="collectFromForm">
              <Play :size="16" aria-hidden="true" />
              {{ collecting ? '正在采集' : '开始采集' }}
            </button>
            <button
              class="btn ghost icon-btn icon-only library-environment-trigger"
              type="button"
              aria-label="检查运行环境"
              title="检查运行环境"
              :disabled="collecting || healthLoading"
              @click="openEnvironment">
              <Settings2 :size="16" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <div v-if="error" class="error" role="alert">{{ error }}</div>

      <section class="three-pane library-workspace workbench-frame-workspace">
        <aside class="pane account-pane" :class="{ 'selection-mode': accountManageMode }">
          <div class="pane-header">
            <div>
              <h2>账号</h2>
              <p class="pane-subtitle">{{ filteredAccounts.length }} / {{ accounts.length }} · {{ totalTranscriptCount }} 转写</p>
            </div>
            <button class="btn icon-btn icon-only" :class="{ primary: accountManageMode }" type="button" :aria-label="accountManageMode ? '退出账号选择' : '批量选择账号'" :title="accountManageMode ? '退出选择' : '批量选择'" @click="toggleAccountManage">
              <X v-if="accountManageMode" :size="15" aria-hidden="true" />
              <CheckCircle2 v-else :size="15" aria-hidden="true" />
            </button>
          </div>
          <div v-if="accountManageMode" class="selection-toolbar" role="toolbar" aria-label="账号批量操作">
            <div class="selection-copy"><strong>已选 {{ selectedAccountIds.length }} 个</strong><span>删除本地资料</span></div>
            <button class="btn danger" type="button" :disabled="!selectedAccountIds.length || deleting" @click="deleteSelectedAccounts">{{ deleting ? '删除中' : '删除' }}</button>
          </div>
          <div class="pane-search search-control">
            <Search :size="15" aria-hidden="true" />
            <input v-model="accountSearch" aria-label="搜索账号" autocomplete="off" placeholder="搜索账号…" />
          </div>
          <div class="pane-body">
            <button
              v-for="account in filteredAccounts"
              :key="account.id"
              type="button"
              class="list-button account-list-button"
              :class="{ active: selectedAccount?.id === account.id, checked: accountManageMode && selectedAccountIds.includes(account.id) }"
              @click="accountManageMode ? toggleManagedAccount(account.id) : selectAccount(account)">
              <span v-if="accountManageMode" class="check-dot" :class="{ checked: selectedAccountIds.includes(account.id) }" aria-hidden="true"></span>
              <span class="account-avatar" :class="[`tone-${accountAvatarTone(account.id)}`, { 'has-image': account.avatarUrl && !failedAvatarIds.has(account.id) }]" aria-hidden="true">
                <img v-if="account.avatarUrl && !failedAvatarIds.has(account.id)" :src="account.avatarUrl" alt="" width="30" height="30" referrerpolicy="no-referrer" @error="failedAvatarIds.add(account.id)" />
                <span v-else>{{ platformInitial(account.platform) }}</span>
              </span>
              <span class="account-list-copy">
                <span class="list-title">{{ account.name }}</span>
                <span class="list-meta">{{ platformLabel(account.platform) }} · {{ account.videoCount || account.videos?.length || 0 }} 条 · {{ account.transcriptCount || 0 }} 转写</span>
              </span>
            </button>
            <div v-if="!filteredAccounts.length" class="empty-state-panel panel">
              <div class="panel-inner">
                <span class="empty-state-mark">库</span>
                <p class="subtle">还没有匹配账号，在上方采集后会写入本地风格库。</p>
              </div>
            </div>
          </div>
        </aside>

        <main class="pane video-pane" :class="{ 'selection-mode': videoManageMode }">
          <div class="pane-header video-pane-header">
            <div class="video-header-copy">
              <div class="video-title-row">
                <h2>视频</h2>
              </div>
              <p class="pane-subtitle">{{ selectedAccount ? `${videos.length} 条 · 转写 ${completedCount}/${videos.length}${pendingCount ? ` · 待处理 ${pendingCount}` : ''}` : '选择账号后查看视频' }}</p>
            </div>
            <div class="video-header-tools">
              <button class="btn icon-btn icon-only" :class="{ primary: videoManageMode }" type="button" :aria-label="videoManageMode ? '退出视频选择' : '批量选择视频'" :title="videoManageMode ? '退出选择' : '批量选择'" :disabled="!selectedAccount" @click="toggleVideoManage">
                <X v-if="videoManageMode" :size="15" aria-hidden="true" />
                <CheckCircle2 v-else :size="15" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div v-if="videoManageMode" class="selection-toolbar" role="toolbar" aria-label="视频批量操作">
            <div class="selection-copy"><strong>已选 {{ selectedVideoIds.length }} 条</strong><span>删除视频和转写稿</span></div>
            <button class="btn danger" type="button" :disabled="!selectedVideoIds.length || deleting" @click="deleteSelectedVideos">{{ deleting ? '删除中' : '删除' }}</button>
          </div>
          <div class="pane-body">
            <table v-if="videos.length" class="video-table">
              <thead>
                <tr>
                  <th v-if="videoManageMode" class="video-select-column"><span class="sr-only">选择</span></th>
                  <th><button class="video-sort-button" type="button" :class="{ active: sortMode === 'title' }" @click="sortMode = 'title'"><span>标题</span><ArrowDownWideNarrow v-if="sortMode === 'title'" :size="13" aria-hidden="true" /></button></th>
                  <th><button class="video-sort-button" type="button" :class="{ active: sortMode === 'latest' }" @click="sortMode = 'latest'"><span>发布日期</span><ArrowDownWideNarrow v-if="sortMode === 'latest'" :size="13" aria-hidden="true" /></button></th>
                  <th><button class="video-sort-button" type="button" :class="{ active: sortMode === 'views' }" @click="sortMode = 'views'"><span>播放</span><ArrowDownWideNarrow v-if="sortMode === 'views'" :size="13" aria-hidden="true" /></button></th>
                  <th><button class="video-sort-button" type="button" :class="{ active: sortMode === 'likes' }" @click="sortMode = 'likes'"><span>点赞</span><ArrowDownWideNarrow v-if="sortMode === 'likes'" :size="13" aria-hidden="true" /></button></th>
                  <th><button class="video-sort-button" type="button" :class="{ active: sortMode === 'comments' }" @click="sortMode = 'comments'"><span>评论</span><ArrowDownWideNarrow v-if="sortMode === 'comments'" :size="13" aria-hidden="true" /></button></th>
                  <th><button class="video-sort-button" type="button" :class="{ active: sortMode === 'favorites' }" @click="sortMode = 'favorites'"><span>收藏</span><ArrowDownWideNarrow v-if="sortMode === 'favorites'" :size="13" aria-hidden="true" /></button></th>
                  <th>转写</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="video in sortedVideos"
                  :key="video.id"
                  :class="{ active: !videoManageMode && selectedVideo?.id === video.id, checked: videoManageMode && selectedVideoIds.includes(video.id) }"
                  @click="videoManageMode ? toggleManagedVideo(video.id) : selectedVideoId = video.id">
                  <td v-if="videoManageMode" class="video-select-cell" aria-hidden="true"><span class="check-dot" :class="{ checked: selectedVideoIds.includes(video.id) }"></span></td>
                  <td class="video-title-column">
                    <button class="video-row-button" type="button">
                      <span class="video-title-cell">
                        <span class="video-title-copy">
                          <span class="video-title-line"><strong>{{ video.title || '未命名视频' }}</strong></span>
                          <span class="list-meta">{{ fullDateLabel(video.publishedAt || video.createdAt) }}</span>
                        </span>
                      </span>
                    </button>
                  </td>
                  <td class="video-date-cell">{{ fullDateLabel(video.publishedAt || video.createdAt) }}</td>
                  <td class="video-number-cell"><strong>{{ formatNumber(video.stats?.views || video.stats?.play || video.viewCount || video.hotScore) }}</strong></td>
                  <td class="video-number-cell">{{ formatNumber(video.stats?.likes) }}</td>
                  <td class="video-number-cell">{{ formatNumber(video.stats?.comments) }}</td>
                  <td class="video-number-cell">{{ formatNumber(video.stats?.favorites || video.stats?.collects) }}</td>
                  <td class="video-status-cell">
                    <span class="status-pill" :class="transcriptClass(video)">{{ transcriptLabel(video) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-state-panel panel">
              <div class="panel-inner">
                <span class="empty-state-mark">稿</span>
                <p class="subtle">当前账号还没有视频记录，点击补采集后会刷新这里。</p>
              </div>
            </div>
          </div>
        </main>

        <aside class="pane library-detail-pane">
          <div class="pane-header">
            <div>
              <h2>详情</h2>
              <p class="pane-subtitle">{{ selectedAccount?.name || '未选择账号' }}</p>
            </div>
          </div>
          <div class="pane-body detail-stack">
            <section class="detail-section selected-video-section">
              <div class="detail-module-heading">
                <h3>当前视频</h3>
                <p v-if="!selectedVideo" class="pane-subtitle">从中间列表选择一条视频</p>
              </div>
              <p class="detail-preview-text detail-transcript-preview">{{ transcriptPreview }}</p>
              <div class="detail-action-grid">
                <button class="btn detail-action-primary" type="button" :disabled="!selectedVideo || transcribing" @click="transcribeSelectedVideo">
                  <RefreshCw :size="16" aria-hidden="true" />
                  {{ transcribing ? '转写中…' : selectedVideoHasTranscript ? '重新转写' : '单视频转写' }}
                </button>
                <button class="btn detail-action-secondary" type="button" :disabled="!selectedVideoHasTranscript" @click="transcriptOpen = true">
                  <FileText :size="16" aria-hidden="true" />
                  查看原稿
                </button>
                <a v-if="selectedVideoOpenUrl" class="btn detail-action-secondary detail-action-link" :href="selectedVideoOpenUrl" target="_blank" rel="noreferrer">
                  <ExternalLink :size="16" aria-hidden="true" />
                  原链接
                </a>
                <button v-else class="btn detail-action-secondary detail-action-link" type="button" disabled>
                  <ExternalLink :size="16" aria-hidden="true" />
                  原链接
                </button>
              </div>
            </section>

            <section class="detail-section automation-section">
              <div class="detail-module-heading">
                <h3>账号风格</h3>
              </div>
              <p class="detail-preview-text detail-style-preview">{{ stylePreview }}</p>
              <div class="detail-action-grid">
                <button class="btn primary progress-button detail-action-primary" type="button" :disabled="!selectedAccount || generatingStyle" @click="generateStyle">
                  <span class="progress-button-content"><Sparkles :size="16" aria-hidden="true" />{{ generatingStyle ? '总结中…' : '总结风格' }}</span>
                </button>
                <button class="btn detail-action-secondary" type="button" :disabled="!selectedAccount" @click="styleOpen = true">
                  <FileText :size="16" aria-hidden="true" />
                  查看风格卡
                </button>
                <button class="btn detail-action-secondary" type="button" :disabled="!selectedAccount || !selectedAccount.transcriptCount || exporting" @click="exportTranscripts">
                  <Download :size="16" aria-hidden="true" />
                  {{ exporting ? '导出中…' : '导出转写稿' }}
                </button>
              </div>
            </section>
          </div>
        </aside>
      </section>

      <div v-if="environmentOpen" class="modal-backdrop" @click.self="environmentOpen = false">
        <section class="modal-panel environment-modal" role="dialog" aria-modal="true" aria-labelledby="style-health-title">
          <div class="modal-header">
            <div><span class="eyebrow">运行环境</span><h2 id="style-health-title">账号采集环境</h2></div>
            <button class="btn icon-btn icon-only" type="button" aria-label="关闭" @click="environmentOpen = false"><X :size="16" aria-hidden="true" /></button>
          </div>
          <div class="environment-modal-body">
            <div class="environment-check-list">
              <div class="environment-check-row"><CheckCircle2 :size="17" aria-hidden="true" /><div><strong>工作台 API</strong><small>{{ health?.name || '正在检查' }}</small></div><span class="status-pill" :class="health?.ok ? 'completed' : 'pending'">{{ health?.ok ? '可用' : '检查中' }}</span></div>
              <div class="environment-check-row"><CheckCircle2 :size="17" aria-hidden="true" /><div><strong>本地风格库</strong><small>{{ health?.libraryRoot || '正在读取路径' }}</small></div><span class="status-pill" :class="health?.libraryRoot ? 'completed' : 'pending'">{{ health?.libraryRoot ? '可用' : '检查中' }}</span></div>
            </div>
          </div>
          <div class="modal-footer"><button class="btn ghost" type="button" :disabled="healthLoading" @click="checkEnvironment"><RefreshCw :size="16" aria-hidden="true" />{{ healthLoading ? '检查中' : '重新检查' }}</button><button class="btn primary" type="button" @click="environmentOpen = false">完成</button></div>
        </section>
      </div>

      <div v-if="styleOpen" class="modal-backdrop" @click.self="styleOpen = false">
        <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="style-card-title">
          <div class="modal-header"><div><span class="eyebrow">账号风格</span><h2 id="style-card-title">{{ selectedAccount?.name || '风格卡' }}</h2></div><button class="btn icon-btn icon-only" type="button" aria-label="关闭" @click="styleOpen = false"><X :size="16" aria-hidden="true" /></button></div>
          <div class="modal-editor"><textarea v-model="styleDraft" aria-label="账号风格卡" placeholder="账号风格卡"></textarea></div>
          <div class="modal-footer"><button class="btn ghost" type="button" @click="styleOpen = false">取消</button><button class="btn primary" type="button" :disabled="savingStyle" @click="saveStyle">{{ savingStyle ? '保存中' : '保存风格卡' }}</button></div>
        </section>
      </div>

      <div v-if="transcriptOpen" class="modal-backdrop" @click.self="transcriptOpen = false">
        <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="transcript-title">
          <div class="modal-header"><div><span class="eyebrow">视频原稿</span><h2 id="transcript-title">{{ selectedVideo?.title || '转写稿' }}</h2></div><button class="btn icon-btn icon-only" type="button" aria-label="关闭" @click="transcriptOpen = false"><X :size="16" aria-hidden="true" /></button></div>
          <div class="modal-editor"><textarea :value="selectedTranscript" aria-label="视频转写稿" readonly></textarea></div>
          <div class="modal-footer"><button class="btn primary" type="button" @click="transcriptOpen = false">完成</button></div>
        </section>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowDownWideNarrow,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  X
} from 'lucide-vue-next'
import {
  collectStyleAccount,
  deleteStyleAccounts,
  deleteStyleVideos,
  downloadAccountTranscripts,
  generateAccountStyle,
  loadAccountDetail,
  loadStyleLibrary,
  loadStyleWorkbenchHealth,
  saveAccountStyle,
  transcribeAccountVideo
} from '../api/styleWorkbench'

const loading = ref(false)
const collecting = ref(false)
const deleting = ref(false)
const exporting = ref(false)
const transcribing = ref(false)
const generatingStyle = ref(false)
const savingStyle = ref(false)
const healthLoading = ref(false)
const error = ref('')
const library = ref(null)
const selectedAccount = ref(null)
const selectedVideoId = ref('')
const accountDetail = ref(null)
const styleDraft = ref('')
const accountSearch = ref('')
const collectLimit = ref(20)
const collectOrder = ref('views')
const collectTimeRange = ref('all')
const customFromDate = ref('')
const customToDate = ref('')
const sortMode = ref('views')
const environmentOpen = ref(false)
const styleOpen = ref(false)
const transcriptOpen = ref(false)
const health = ref(null)
const accountManageMode = ref(false)
const videoManageMode = ref(false)
const selectedAccountIds = ref([])
const selectedVideoIds = ref([])
const failedAvatarIds = reactive(new Set())
const accountForm = reactive({
  platform: 'bilibili',
  name: ''
})

const timeRangeOptions = [
  { value: 'all', label: '不限' },
  { value: '7d', label: '近 7 天', days: 7 },
  { value: '30d', label: '近 30 天', days: 30 },
  { value: '90d', label: '近 90 天', days: 90 },
  { value: '180d', label: '近半年', days: 180 },
  { value: '365d', label: '近一年', days: 365 },
  { value: '3y', label: '近 3 年', days: 1095 },
  { value: 'custom', label: '自定义' }
]

const accounts = computed(() => library.value?.accounts || [])
const filteredAccounts = computed(() => {
  const keyword = accountSearch.value.trim().toLowerCase()
  if (!keyword) return accounts.value
  return accounts.value.filter((account) => `${account.name} ${account.id} ${account.platform}`.toLowerCase().includes(keyword))
})
const videos = computed(() => accountDetail.value?.videos || selectedAccount.value?.videos || [])
const selectedVideo = computed(() => videos.value.find((video) => video.id === selectedVideoId.value) || videos.value[0] || null)
const totalTranscriptCount = computed(() => accounts.value.reduce((sum, account) => sum + (account.transcriptCount || 0), 0))
const completedCount = computed(() => videos.value.filter((video) => transcriptStatus(video) === 'completed').length)
const pendingCount = computed(() => Math.max(0, videos.value.length - completedCount.value))
const canCollect = computed(() => Boolean(accountForm.name.trim()))
const collectOrderOptions = computed(() => accountForm.platform === 'bilibili'
  ? [
      { value: 'views', label: '播放优先' },
      { value: 'likes', label: '点赞优先' },
      { value: 'favorites', label: '收藏优先' },
      { value: 'comments', label: '评论优先' },
      { value: 'pubdate', label: '时间优先' }
    ]
  : [
      { value: 'likes', label: '点赞优先' },
      { value: 'comments', label: '评论优先' },
      { value: 'pubdate', label: '时间优先' }
    ])
const sortedVideos = computed(() => {
  const items = [...videos.value]
  if (sortMode.value === 'title') return items.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'))
  if (sortMode.value === 'latest') return items.sort((a, b) => timestamp(b.publishedAt || b.createdAt) - timestamp(a.publishedAt || a.createdAt))
  return items.sort((a, b) => videoMetric(b, sortMode.value) - videoMetric(a, sortMode.value))
})
const selectedVideoHasTranscript = computed(() => transcriptStatus(selectedVideo.value) === 'completed')
const selectedTranscript = computed(() => selectedVideo.value?.transcript || selectedVideo.value?.transcriptText || selectedVideo.value?.content || '')
const transcriptPreview = computed(() => {
  if (transcribing.value) return '正在转写视频。'
  if (!selectedVideo.value) return '未选择视频。'
  if (selectedTranscript.value) return previewText(selectedTranscript.value)
  if (selectedVideoHasTranscript.value) return '已有转写稿，可打开查看或重新转写覆盖。'
  return '当前视频还没有转写稿。'
})
const stylePreview = computed(() => previewText(styleDraft.value) || (selectedAccount.value ? '风格卡待读取。' : '未选择账号。'))
const selectedVideoOpenUrl = computed(() => {
  const video = selectedVideo.value
  if (!video) return ''
  if (video.sourceUrl || video.url || video.openUrl) return video.sourceUrl || video.url || video.openUrl
  if (selectedAccount.value?.platform === 'bilibili' && video.id) return `https://www.bilibili.com/video/${video.id}`
  return ''
})

watch(videos, (items) => {
  if (!items.length) {
    selectedVideoId.value = ''
    return
  }
  if (!items.some((item) => item.id === selectedVideoId.value)) selectedVideoId.value = items[0].id
})

onMounted(loadAll)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const selectedId = selectedAccount.value?.id
    library.value = await loadStyleLibrary()
    const nextAccount = accounts.value.find((account) => account.id === selectedId) || accounts.value[0]
    if (nextAccount) await selectAccount(nextAccount)
    else {
      selectedAccount.value = null
      accountDetail.value = null
    }
  } catch (err) {
    error.value = err.message || '账号库读取失败'
  } finally {
    loading.value = false
  }
}

async function selectAccount(account) {
  selectedAccount.value = account
  accountDetail.value = null
  selectedVideoId.value = ''
  styleDraft.value = ''
  try {
    accountDetail.value = await loadAccountDetail({ platform: account.platform, accountId: account.id, includeStyle: true })
    styleDraft.value = accountDetail.value?.style || ''
  } catch (err) {
    error.value = err.message || '账号详情读取失败'
  }
}

function toggleAccountManage() {
  accountManageMode.value = !accountManageMode.value
  selectedAccountIds.value = []
}

function toggleManagedAccount(accountId) {
  selectedAccountIds.value = selectedAccountIds.value.includes(accountId)
    ? selectedAccountIds.value.filter((id) => id !== accountId)
    : [...selectedAccountIds.value, accountId]
}

function toggleVideoManage() {
  videoManageMode.value = !videoManageMode.value
  selectedVideoIds.value = []
}

function toggleManagedVideo(videoId) {
  selectedVideoIds.value = selectedVideoIds.value.includes(videoId)
    ? selectedVideoIds.value.filter((id) => id !== videoId)
    : [...selectedVideoIds.value, videoId]
}

async function deleteSelectedAccounts() {
  if (!selectedAccountIds.value.length) return
  if (!window.confirm(`确认删除选中的 ${selectedAccountIds.value.length} 个账号及其本地资料吗？`)) return
  deleting.value = true
  error.value = ''
  try {
    await deleteStyleAccounts(selectedAccountIds.value)
    toggleAccountManage()
    await loadAll()
  } catch (err) {
    error.value = err.message || '账号删除失败'
  } finally {
    deleting.value = false
  }
}

async function deleteSelectedVideos() {
  if (!selectedAccount.value || !selectedVideoIds.value.length) return
  if (!window.confirm(`确认删除选中的 ${selectedVideoIds.value.length} 条视频和转写稿吗？`)) return
  deleting.value = true
  error.value = ''
  try {
    await deleteStyleVideos({
      platform: selectedAccount.value.platform,
      accountId: selectedAccount.value.id,
      videoIds: selectedVideoIds.value
    })
    toggleVideoManage()
    await selectAccount(selectedAccount.value)
  } catch (err) {
    error.value = err.message || '视频删除失败'
  } finally {
    deleting.value = false
  }
}

function setCollectPlatform(platform) {
  accountForm.platform = platform
  if (!collectOrderOptions.value.some((option) => option.value === collectOrder.value)) {
    collectOrder.value = collectOrderOptions.value[0].value
  }
}

async function collectFromForm() {
  if (!accountForm.name.trim()) {
    error.value = '请输入账号名或主页链接'
    return
  }
  collecting.value = true
  error.value = ''
  try {
    const result = await collectStyleAccount({
      platform: accountForm.platform,
      name: accountForm.name.trim(),
      limit: Math.min(50, Math.max(1, Number(collectLimit.value) || 20)),
      order: collectOrder.value,
      ...collectDateFilter()
    })
    await loadAll()
    const account = result?.account || accounts.value.find((item) => item.name === accountForm.name)
    if (account) await selectAccount(account)
  } catch (err) {
    error.value = err.message || '采集失败'
  } finally {
    collecting.value = false
  }
}

async function transcribeSelectedVideo() {
  if (!selectedAccount.value || !selectedVideo.value) return
  transcribing.value = true
  error.value = ''
  try {
    await transcribeAccountVideo({
      platform: selectedAccount.value.platform,
      accountId: selectedAccount.value.id,
      videoId: selectedVideo.value.id,
      mediaUrl: selectedVideo.value.mediaUrl || selectedVideo.value.videoUrl || selectedVideoOpenUrl.value
    })
    await selectAccount(selectedAccount.value)
  } catch (err) {
    error.value = err.message || '视频转写失败'
  } finally {
    transcribing.value = false
  }
}

async function exportTranscripts() {
  if (!selectedAccount.value) return
  exporting.value = true
  error.value = ''
  try {
    await downloadAccountTranscripts({
      platform: selectedAccount.value.platform,
      accountId: selectedAccount.value.id,
      accountName: selectedAccount.value.name
    })
  } catch (err) {
    error.value = err.message || '导出转写稿失败'
  } finally {
    exporting.value = false
  }
}

async function generateStyle() {
  if (!selectedAccount.value) return
  generatingStyle.value = true
  error.value = ''
  try {
    const result = await generateAccountStyle({
      platform: selectedAccount.value.platform,
      accountId: selectedAccount.value.id
    })
    styleDraft.value = result.style || ''
    styleOpen.value = true
  } catch (err) {
    error.value = err.message || '风格生成失败'
  } finally {
    generatingStyle.value = false
  }
}

async function saveStyle() {
  if (!selectedAccount.value) return
  savingStyle.value = true
  error.value = ''
  try {
    await saveAccountStyle({
      platform: selectedAccount.value.platform,
      accountId: selectedAccount.value.id,
      content: styleDraft.value
    })
    await selectAccount(selectedAccount.value)
    styleOpen.value = false
  } catch (err) {
    error.value = err.message || '风格保存失败'
  } finally {
    savingStyle.value = false
  }
}

function platformLabel(platform) {
  return platform === 'bilibili' ? 'B站' : '抖音'
}

function formatNumber(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number <= 0) return '0'
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`
  return String(Math.round(number))
}

function fullDateLabel(value) {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未记录'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function transcriptLabel(video) {
  const status = transcriptStatus(video)
  if (status === 'completed') return '已转写'
  if (status === 'pending' || status === 'processing') return '转写中'
  if (status === 'failed') return '失败'
  return '未转写'
}

function transcriptClass(video) {
  const status = transcriptStatus(video)
  if (status === 'completed') return 'completed'
  if (status === 'pending' || status === 'processing') return 'pending'
  if (status === 'failed') return 'failed'
  return 'not_started'
}

function transcriptStatus(video) {
  return video?.transcriptStatus || (video?.hasTranscript || video?.transcript || video?.transcriptText ? 'completed' : 'not_started')
}

function platformInitial(platform) {
  return platform === 'bilibili' ? 'B' : '抖'
}

function accountAvatarTone(id) {
  return Array.from(String(id || '')).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 8
}

function previewText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > 220 ? `${text.slice(0, 220)}…` : text
}

function timestamp(value) {
  const time = new Date(value || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

function videoMetric(video, mode) {
  if (mode === 'likes') return Number(video?.stats?.likes || 0)
  if (mode === 'comments') return Number(video?.stats?.comments || 0)
  if (mode === 'favorites') return Number(video?.stats?.favorites || video?.stats?.collects || 0)
  return Number(video?.stats?.views || video?.stats?.play || video?.viewCount || video?.hotScore || 0)
}

function collectDateFilter() {
  if (collectTimeRange.value === 'all') return {}
  if (collectTimeRange.value === 'custom') {
    return {
      ...(customFromDate.value ? { fromDate: customFromDate.value } : {}),
      ...(customToDate.value ? { toDate: customToDate.value } : {})
    }
  }
  const option = timeRangeOptions.find((item) => item.value === collectTimeRange.value)
  if (!option?.days) return {}
  const today = new Date()
  const from = new Date(today)
  from.setDate(today.getDate() - option.days + 1)
  return { fromDate: dateInputValue(from), toDate: dateInputValue(today) }
}

function dateInputValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function openEnvironment() {
  environmentOpen.value = true
  await checkEnvironment()
}

async function checkEnvironment() {
  healthLoading.value = true
  error.value = ''
  try {
    health.value = await loadStyleWorkbenchHealth()
  } catch (err) {
    error.value = err.message || '运行环境检查失败'
  } finally {
    healthLoading.value = false
  }
}
</script>
