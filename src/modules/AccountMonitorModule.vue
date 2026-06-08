<template>
  <div class="account-monitor-module">
    <header class="radar-hero">
      <div>
        <p class="eyebrow">CREATOR HOT BOARD</p>
        <h2>账号内容热榜</h2>
        <span>按分区和平台聚合账号池的新内容，只更新重复作品的数据，把爆款和异常增长内容顶到前面。</span>
      </div>
      <div class="hero-actions">
        <button class="board-action secondary traffic-entry" @click="openTrafficPlan">投流计划</button>
        <button class="board-action secondary" :disabled="loading" @click="load">刷新榜单</button>
        <button class="board-action primary" :disabled="collectingAll || !accounts.length" @click="collectAll">
          {{ collectButtonLabel }}
        </button>
        <div v-if="collectingAll || collectJob.done || collectJob.error" class="scan-progress" :class="{ done: !collectingAll && collectJob.done, error: collectJob.error }">
          <span>{{ collectProgressText }}</span>
          <i><b :style="{ width: collectProgressPercent + '%' }"></b></i>
        </div>
      </div>
    </header>

    <section class="timeline-panel">
      <div>
        <p class="eyebrow">TIME WINDOW</p>
        <strong>{{ viewMode === 'active' ? `近 ${windowDays} 天热榜` : '历史归档' }}</strong>
        <span>超过时间窗口的内容自动进入历史，不再压住新内容排行。</span>
      </div>
      <div class="timeline-actions">
        <select v-model.number="windowDays" class="inp timeline-select" @change="load">
          <option :value="3">近 3 天</option>
          <option :value="7">近 7 天</option>
          <option :value="14">近 14 天</option>
          <option :value="30">近 30 天</option>
        </select>
        <div class="trend-dock">
          <button class="trend-toggle" :class="{ active: trendOpen }" @click="trendOpen = !trendOpen">
            <span>历史趋势</span>
            <b>{{ trendSummary }}</b>
          </button>
          <section v-if="trendOpen" class="trend-popover">
            <div class="trend-head">
              <div>
                <p class="eyebrow">HISTORY SIGNAL</p>
                <strong>账号池波动</strong>
              </div>
              <button class="side-link" @click="trendOpen = false">收起</button>
            </div>
            <svg class="trend-chart" viewBox="0 0 320 108" preserveAspectRatio="none" aria-label="账号热榜历史趋势">
              <defs>
                <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stop-color="currentColor" stop-opacity=".24" />
                  <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path v-if="trendAreaPath" :d="trendAreaPath" class="trend-area" />
              <polyline v-if="trendLinePoints" :points="trendLinePoints" class="trend-line" />
              <circle
                v-for="point in trendPoints"
                :key="point.key"
                :cx="point.x"
                :cy="point.y"
                r="3"
                class="trend-dot" />
            </svg>
            <div class="trend-stats">
              <span><b>{{ trendLatest.count }}</b> 次采集</span>
              <span><b>{{ formatNumber(trendLatest.heat) }}</b> 热度</span>
              <span><b>{{ trendLatest.newCount }}</b> 新内容</span>
            </div>
            <p class="trend-note">按最近采集快照聚合，观察账号池整体热度、爆点和新增内容波动。</p>
          </section>
        </div>
        <div class="segmented-toggle" role="tablist" aria-label="热榜视图">
          <button :class="{ active: viewMode === 'active' }" @click="viewMode = 'active'">当前热榜</button>
          <button :class="{ active: viewMode === 'archived' }" @click="viewMode = 'archived'">历史归档 {{ archivedItems.length }}</button>
        </div>
        <button class="board-action danger" :disabled="clearing || !visibleItems.length" @click="clearVisible">
          {{ clearing ? '清理中...' : clearLabel }}
        </button>
      </div>
    </section>

    <main class="board-layout">
      <section class="rank-list">
        <article v-if="loading" class="empty-card">正在读取内容榜...</article>
        <article v-else-if="!rankedItems.length" class="empty-card">
          {{ viewMode === 'active' ? '当前时间窗口内还没有内容，先维护账号池并点击“扫描账号池”。' : '历史归档里还没有超过时间窗口的内容。' }}
        </article>
        <article v-for="(item, index) in rankedItems" :key="item.key || item.id || item.url" class="rank-card" :class="[item.platform, rankToneClass(index)]">
          <div class="rank-no">
            <span v-if="index < 3" class="rank-crown">{{ rankIcon(index) }}</span>
            <span v-else>{{ index + 1 }}</span>
          </div>
          <div class="rank-main">
            <a v-if="item.url" class="rank-title" :href="item.url" target="_blank" rel="noopener">{{ item.title }}</a>
            <strong v-else class="rank-title">{{ item.title }}</strong>
            <div class="rank-meta">
              <span class="platform-pill">{{ platformLabel(item.platform) }}</span>
              <span>{{ item.category || '综合热点' }}</span>
              <span class="account-pill">{{ item.accountName || item.account }}</span>
              <span v-for="tag in item.tags || []" :key="tag" :class="{ hot: tag === '爆款', focus: tag === '重点关注' }">{{ tag }}</span>
            </div>
          </div>
          <div class="rank-side">
            <b class="publish-time">{{ formatPublishDate(item) }}</b>
            <div class="metric-pack">
              <span v-for="metric in displayMetrics(item)" :key="metric.key" :class="metricClass(metric)">
                <i class="metric-icon">{{ metric.icon }}</i>
                <b>{{ metric.label }}</b>
                <strong>{{ metric.value }}</strong>
              </span>
            </div>
            <div class="rank-actions">
              <span class="rank-score">热度 {{ item.hotScore || 0 }}</span>
              <button class="workflow-jump" :disabled="!item.url" @click="jumpToWorkflow(item)">进工作流</button>
            </div>
          </div>
        </article>
      </section>

      <aside class="side-panel">
        <div class="panel-title">
          <strong>榜单筛选</strong>
          <span>{{ rankedItems.length }} 条</span>
        </div>
        <div v-if="hasActiveFilters" class="filter-active-row">
          <span>筛选中</span>
          <button class="side-link" @click="resetFilters">返回全部</button>
        </div>
        <section v-if="aiRecommendation" class="side-ai-card" :class="aiRecommendation.level">
          <div class="side-ai-head">
            <span>AI 提醒</span>
            <button class="side-link" @click="applyRecommendation(aiRecommendation)">定位</button>
          </div>
          <strong>{{ aiRecommendation.title }}</strong>
          <p>{{ aiRecommendation.reason }}</p>
          <small>{{ aiRecommendation.rule }}</small>
        </section>
        <input v-model="keyword" class="inp side-search" placeholder="搜索标题 / 账号" />
        <div class="side-filter-group">
          <span class="side-filter-label">平台</span>
          <button
            v-for="tab in platformTabs"
            :key="tab.value"
            class="side-filter"
            :class="{ active: platformFilter === tab.value }"
            @click="platformFilter = tab.value">
            <span>{{ tab.label }}</span>
            <b>{{ tab.count }}</b>
          </button>
        </div>
        <div class="side-filter-group">
          <span class="side-filter-label">分区</span>
          <button
            v-for="tab in categoryTabs"
            :key="tab.value"
            class="side-filter"
            :class="{ active: categoryFilter === tab.value }"
            @click="categoryFilter = tab.value">
            <span>{{ tab.label }}</span>
            <b>{{ tab.count }}</b>
          </button>
        </div>
        <div class="side-filter-group">
          <span class="side-filter-label">标签</span>
          <select v-model="tagFilter" class="inp side-select">
            <option value="all">全部标签</option>
            <option value="爆款">爆款</option>
            <option value="重点关注">重点关注</option>
            <option value="新增">新增</option>
            <option value="评论活跃">评论活跃</option>
          </select>
        </div>
        <div class="panel-title sub">
          <strong>账号池</strong>
          <button class="side-link" @click="showAccountForm = !showAccountForm">{{ showAccountForm ? '收起' : '维护' }}</button>
        </div>
        <section v-if="showAccountForm" class="account-pool side-pool">
          <div class="pool-form">
            <select v-model="draft.platform" class="inp">
              <option value="douyin">抖音</option>
              <option value="bilibili">B站</option>
            </select>
            <input v-model="draft.name" class="inp" placeholder="账号显示名" />
            <input v-model="draft.account" class="inp account-input" placeholder="sec_uid / 主页链接 / 抖音作品分享链接" />
            <select v-model="draft.category" class="inp">
              <option value="游戏杂谈">游戏杂谈</option>
              <option value="数码科技">数码科技</option>
              <option value="娱乐八卦">娱乐八卦</option>
              <option value="体育电竞">体育电竞</option>
              <option value="综合热点">综合热点</option>
            </select>
            <input v-model.number="draft.limit" class="inp limit-input" type="number" min="1" max="5" />
            <button class="board-action primary" :disabled="saving" @click="saveDraft">
              {{ saving ? '保存中...' : '加入账号池' }}
            </button>
          </div>
          <p class="pool-hint">抖音作品短链会作为单链接采集源保存，扫描时只采集这条作品；账号池批量更新仍建议使用主页链接或 sec_uid。</p>
        </section>
        <div class="pool-list side-account-list">
          <button
            v-for="account in accounts"
            :key="account.id"
            class="pool-chip"
            :class="account.platform"
            @click="collectOne(account)">
            <b>{{ account.name || account.account }}</b>
            <span>{{ platformLabel(account.platform) }} · {{ sourceLabel(account) }} · {{ account.category || '未分区' }}</span>
            <em>{{ collectingId === account.id ? '扫描中' : statusText(account) }}</em>
            <i @click.stop="removeAccount(account)">×</i>
          </button>
        </div>
        <section class="stats-strip side-stats">
          <article>
            <span>监控账号</span>
            <b>{{ accounts.length }}</b>
          </article>
          <article>
            <span>当前热榜</span>
            <b>{{ items.length }}</b>
          </article>
          <article>
            <span>重点内容</span>
            <b>{{ focusCount }}</b>
          </article>
          <article>
            <span>历史归档</span>
            <b>{{ archivedItems.length }}</b>
          </article>
        </section>
        <div class="panel-title sub">
          <strong>分区概览</strong>
          <span>{{ categories.length }} 个分区</span>
        </div>
        <div v-for="bar in categoryBars" :key="bar.name" class="bar-row">
          <span>{{ bar.name }}</span>
          <i><b :style="{ width: bar.width + '%' }"></b></i>
          <em>{{ bar.count }}</em>
        </div>
        <div class="panel-title sub">
          <strong>平台分布</strong>
        </div>
        <div v-for="bar in platformBars" :key="bar.name" class="bar-row platform">
          <span>{{ platformLabel(bar.name) }}</span>
          <i><b :style="{ width: bar.width + '%' }"></b></i>
          <em>{{ bar.count }}</em>
        </div>
        <div class="panel-title">
          <strong>榜单逻辑</strong>
        </div>
        <p class="logic-note">同一作品不会重复入库；重复扫描只更新平台能返回的指标。B站优先看播放量，抖音优先看点赞量，抓不到的字段不会展示。</p>
      </aside>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  clearAccountMonitor,
  collectAccountMonitor,
  collectAllAccountMonitor,
  deleteAccountMonitor,
  getAccountMonitorCollectStatus,
  listAccountMonitor,
  saveAccountMonitor
} from '../api/accountMonitor'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()

const accounts = ref([])
const items = ref([])
const snapshots = ref([])
const loading = ref(false)
const saving = ref(false)
const clearing = ref(false)
const collectingId = ref('')
const collectingAll = ref(false)
const collectJob = reactive({
  running: false,
  source: '',
  startedAt: 0,
  finishedAt: 0,
  total: 0,
  done: 0,
  currentAccountId: '',
  currentAccountName: '',
  error: '',
  results: []
})
let collectPollTimer = null
const showAccountForm = ref(false)
const viewMode = ref('active')
const windowDays = ref(7)
const platformFilter = ref('all')
const categoryFilter = ref('all')
const tagFilter = ref('all')
const keyword = ref('')
const archivedItems = ref([])
const trendOpen = ref(false)
const baseCategories = ['游戏杂谈', '数码科技', '娱乐八卦', '体育电竞', '综合热点']
const visibleItems = computed(() => viewMode.value === 'archived' ? archivedItems.value : items.value)
const platformTabs = computed(() => [
  { value: 'all', label: '全部平台', count: visibleItems.value.length },
  { value: 'douyin', label: '抖音', count: visibleItems.value.filter(item => item.platform === 'douyin').length },
  { value: 'bilibili', label: 'B站', count: visibleItems.value.filter(item => item.platform === 'bilibili').length }
])
const draft = reactive({
  platform: 'douyin',
  name: '',
  account: '',
  category: '游戏杂谈',
  limit: 5
})

const categories = computed(() => Array.from(new Set(baseCategories.concat(visibleItems.value.map(item => item.category || '综合热点')))))
const categoryTabs = computed(() => {
  const counts = countBy(visibleItems.value, item => item.category || '综合热点')
  return [{ value: 'all', label: '全部分区', count: visibleItems.value.length }].concat(
    categories.value.map(name => ({ value: name, label: name, count: counts[name] || 0 }))
  )
})
const focusCount = computed(() => items.value.filter(item => (item.tags || []).some(tag => tag === '爆款' || tag === '重点关注')).length)
const newCount = computed(() => items.value.filter(item => (item.tags || []).includes('新增') || item.isNew).length)
const clearLabel = computed(() => viewMode.value === 'archived' ? '清空历史' : '清空当前榜')
const hasActiveFilters = computed(() => Boolean(keyword.value.trim()) || platformFilter.value !== 'all' || categoryFilter.value !== 'all' || tagFilter.value !== 'all')
const aiRecommendation = computed(() => {
  if (viewMode.value !== 'active') return null
  const item = [...items.value]
    .sort((a, b) => (Number(b.hotScore) || 0) - (Number(a.hotScore) || 0))
    .find(isAiRecommendable)
  if (!item) return null
  const metrics = item.metrics || {}
  const score = Number(item.hotScore) || 0
  const level = score >= 760 || hasPlatformBreakout(item) ? 'urgent' : 'watch'
  const mainMetric = item.platform === 'douyin'
    ? `点赞 ${formatNumber(metrics.like || 0)}`
    : `播放 ${formatNumber(metrics.play || 0)}${Number(metrics.like) ? ` / 点赞 ${formatNumber(metrics.like)}` : ''}`
  return {
    level,
    item,
    title: level === 'urgent' ? '这条建议今天优先看' : '这条可以观察一下',
    reason: `${platformLabel(item.platform)} · ${formatPublishDate(item)} · ${mainMetric}`,
    rule: '规则：近 72 小时内，抖音赞 10w+ / B站播 20w+，或综合热度进入重点线。'
  }
})

const filteredItems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return visibleItems.value.filter(item => {
    if (platformFilter.value !== 'all' && item.platform !== platformFilter.value) return false
    if (categoryFilter.value !== 'all' && (item.category || '综合热点') !== categoryFilter.value) return false
    if (tagFilter.value !== 'all' && !(item.tags || []).includes(tagFilter.value)) return false
    if (q && !`${item.title || ''} ${item.accountName || ''} ${item.account || ''}`.toLowerCase().includes(q)) return false
    return true
  })
})

const rankedItems = computed(() => {
  return [...filteredItems.value]
    .sort((a, b) => (Number(b.hotScore) || 0) - (Number(a.hotScore) || 0))
    .slice(0, 100)
})

const categoryBars = computed(() => makeBars(countBy(visibleItems.value, item => item.category || '综合热点')))
const platformBars = computed(() => makeBars(countBy(visibleItems.value, item => item.platform || 'douyin')))
const trendBuckets = computed(() => {
  const buckets = new Map()
  ;(snapshots.value || []).forEach(snapshot => {
    const ts = Number(snapshot.capturedAt) || 0
    if (!ts) return
    const bucket = Math.floor(ts / 3600000) * 3600000
    const current = buckets.get(bucket) || { ts: bucket, count: 0, heat: 0, newCount: 0 }
    const itemsList = Array.isArray(snapshot.items) ? snapshot.items : []
    const stats = snapshot.stats || {}
    current.count += 1
    current.newCount += Number(stats.newCount) || 0
    current.heat += itemsList.reduce((sum, item) => {
      const metrics = item.metrics || {}
      return sum + (Number(item.hotScore) || 0) + (Number(metrics.play) || 0) / 1200 + (Number(metrics.like) || 0) / 80 + (Number(metrics.comment) || 0) * 2
    }, 0)
    buckets.set(bucket, current)
  })
  return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts).slice(-18)
})
const trendLatest = computed(() => trendBuckets.value[trendBuckets.value.length - 1] || { count: 0, heat: 0, newCount: 0 })
const trendPoints = computed(() => {
  const rows = trendBuckets.value
  if (!rows.length) return []
  const max = Math.max(1, ...rows.map(row => row.heat))
  return rows.map((row, index) => ({
    key: row.ts,
    x: rows.length === 1 ? 160 : Math.round((index / (rows.length - 1)) * 300 + 10),
    y: Math.round(96 - (row.heat / max) * 78)
  }))
})
const trendLinePoints = computed(() => trendPoints.value.map(point => `${point.x},${point.y}`).join(' '))
const trendAreaPath = computed(() => {
  const points = trendPoints.value
  if (!points.length) return ''
  return `M${points[0].x} 104 ${points.map(point => `L${point.x} ${point.y}`).join(' ')} L${points[points.length - 1].x} 104 Z`
})
const trendSummary = computed(() => {
  if (!trendBuckets.value.length) return '暂无'
  return `${formatNumber(Math.round(trendLatest.value.heat))} / ${trendLatest.value.newCount}新`
})
const collectProgressPercent = computed(() => {
  if (!collectJob.total) return collectingAll.value ? 8 : 0
  return Math.max(6, Math.min(100, Math.round((collectJob.done / collectJob.total) * 100)))
})
const collectButtonLabel = computed(() => {
  if (!collectingAll.value) return '扫描账号池'
  if (collectJob.total) return `扫描中 ${collectJob.done}/${collectJob.total}`
  return '启动扫描中'
})
const collectProgressText = computed(() => {
  if (collectJob.error) return `扫描异常：${collectJob.error}`
  if (collectingAll.value && collectJob.currentAccountName) {
    return `正在扫描：${collectJob.currentAccountName}（${collectJob.done}/${collectJob.total || accounts.value.length}）`
  }
  if (collectingAll.value) return '账号池扫描已在后台运行，页面会自动刷新榜单'
  if (collectJob.done && collectJob.total) return `本轮扫描完成：${collectJob.done}/${collectJob.total}`
  return ''
})

function applyCollectJob(job) {
  Object.assign(collectJob, {
    running: Boolean(job && job.running),
    source: job && job.source || '',
    startedAt: Number(job && job.startedAt) || 0,
    finishedAt: Number(job && job.finishedAt) || 0,
    total: Number(job && job.total) || 0,
    done: Number(job && job.done) || 0,
    currentAccountId: job && job.currentAccountId || '',
    currentAccountName: job && job.currentAccountName || '',
    error: job && job.error || '',
    results: Array.isArray(job && job.results) ? job.results : []
  })
  collectingAll.value = collectJob.running
}

function applyData(data) {
  accounts.value = Array.isArray(data.accounts) ? data.accounts : []
  snapshots.value = Array.isArray(data.snapshots) ? data.snapshots : []
  items.value = Array.isArray(data.items) ? data.items : []
  archivedItems.value = Array.isArray(data.archivedItems) ? data.archivedItems : []
  if (data.collectJob) applyCollectJob(data.collectJob)
}

async function load() {
  loading.value = true
  try {
    applyData(await listAccountMonitor({ windowDays: windowDays.value }))
  } catch (e) {
    showToast('账号内容榜读取失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function clearVisible() {
  clearing.value = true
  try {
    const scope = viewMode.value === 'archived' ? 'archived' : 'active'
    applyData(await clearAccountMonitor({ scope, windowDays: windowDays.value }))
    showToast(scope === 'archived' ? '历史归档已清空' : '当前热榜已清空，历史仍保留', 'success')
  } catch (e) {
    showToast('清理失败：' + e.message, 'error')
  } finally {
    clearing.value = false
  }
}

async function saveDraft() {
  if (!draft.account.trim()) {
    showToast('先填写账号ID或主页链接', 'warning')
    return
  }
  saving.value = true
  try {
    applyData(await saveAccountMonitor({ ...draft }))
    draft.name = ''
    draft.account = ''
    showToast('已加入账号池', 'success')
  } catch (e) {
    showToast('保存失败：' + e.message, 'error')
  } finally {
    saving.value = false
  }
}

async function collectOne(account) {
  collectingId.value = account.id
  try {
    const data = await collectAccountMonitor(account.id)
    applyData(data)
    if (data.error) showToast('扫描失败：' + data.error, 'error')
    else showToast('已扫描新增内容并更新榜单', 'success')
  } catch (e) {
    showToast('扫描失败：' + e.message, 'error')
  } finally {
    collectingId.value = ''
  }
}

async function collectAll() {
  collectingAll.value = true
  try {
    applyData(await collectAllAccountMonitor({ windowDays: windowDays.value }))
    showToast('账号池开始后台扫描，榜单会自动更新', 'success')
    startCollectPolling()
  } catch (e) {
    showToast('批量扫描失败：' + e.message, 'error')
    collectingAll.value = false
    stopCollectPolling()
  }
}

function startCollectPolling() {
  stopCollectPolling()
  collectPollTimer = window.setInterval(pollCollectStatus, 4000)
  pollCollectStatus()
}

function stopCollectPolling() {
  if (collectPollTimer) {
    window.clearInterval(collectPollTimer)
    collectPollTimer = null
  }
}

async function pollCollectStatus() {
  try {
    const data = await getAccountMonitorCollectStatus({ windowDays: windowDays.value })
    const wasRunning = collectingAll.value
    applyData(data)
    if (!collectJob.running) {
      stopCollectPolling()
      if (wasRunning) {
        showToast(collectJob.error ? '账号池扫描结束，但有异常：' + collectJob.error : '账号池扫描完成，榜单已更新', collectJob.error ? 'warning' : 'success')
      }
    }
  } catch (e) {
    showToast('扫描进度刷新失败：' + e.message, 'warning')
    stopCollectPolling()
    collectingAll.value = false
  }
}

async function syncCollectStatus() {
  try {
    const data = await getAccountMonitorCollectStatus({ windowDays: windowDays.value })
    applyData(data)
    if (collectJob.running) startCollectPolling()
  } finally {
  }
}

async function removeAccount(account) {
  try {
    applyData(await deleteAccountMonitor(account.id))
    showToast('已移出账号池', 'success')
  } catch (e) {
    showToast('删除失败：' + e.message, 'error')
  }
}

function applyRecommendation(recommendation) {
  const item = recommendation && recommendation.item
  if (!item) return
  keyword.value = item.title || ''
  platformFilter.value = item.platform || 'all'
  categoryFilter.value = item.category || 'all'
  tagFilter.value = 'all'
}

function resetFilters() {
  keyword.value = ''
  platformFilter.value = 'all'
  categoryFilter.value = 'all'
  tagFilter.value = 'all'
}

function openTrafficPlan() {
  window.dispatchEvent(new CustomEvent('usagi:navigate', { detail: { module: 'trafficPlan' } }))
  showToast('已打开投流计划，后续会从这里承接账号热榜的视频数据', 'success')
}

function jumpToWorkflow(item) {
  const url = String(item?.url || '').trim()
  if (!url) {
    showToast('这条内容没有可带入工作流的链接', 'warning')
    return
  }
  try {
    localStorage.setItem('usagi_workflow_prefill_url', url)
  } catch (e) {}
  window.dispatchEvent(new CustomEvent('usagi:workflow-prefill', { detail: { url } }))
  window.dispatchEvent(new CustomEvent('usagi:navigate', { detail: { module: 'workflow' } }))
  showToast('已把链接带入文案工作流输入源', 'success')
}

function makeBars(map) {
  const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1])
  const max = entries[0]?.[1] || 1
  return entries.map(([name, count]) => ({
    name,
    count,
    width: Math.max(8, Math.round((count / max) * 100))
  }))
}

function countBy(list, getKey) {
  return list.reduce((acc, item) => {
    const key = getKey(item)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function platformLabel(platform) {
  return platform === 'bilibili' ? 'B站' : '抖音'
}

function sourceLabel(account) {
  return account?.sourceType === 'video_link' ? '单链接' : '账号'
}

function formatNumber(value) {
  const n = Number(value) || 0
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return String(n)
}

function itemAgeHours(item) {
  const ts = Number(item.publishedTs) || Date.parse(item.publishedAt || '') || 0
  if (!ts) return Infinity
  return (Date.now() - ts) / 3600000
}

function hasPlatformBreakout(item) {
  const metrics = item.metrics || {}
  if (item.platform === 'douyin') return Number(metrics.like) >= 200000
  return Number(metrics.play) >= 500000 || Number(metrics.like) >= 50000
}

function isAiRecommendable(item) {
  if (!item || itemAgeHours(item) > 72) return false
  const score = Number(item.hotScore) || 0
  if (score < 680 && !hasPlatformBreakout(item)) return false
  return score >= 520 || hasPlatformBreakout(item) || (item.tags || []).includes('爆款')
}

function displayMetrics(item) {
  const metrics = item.metrics || {}
  const config = [
    { key: 'play', label: '播放', value: metrics.play },
    { key: 'like', label: '点赞', value: metrics.like },
    { key: 'comment', label: '评论', value: metrics.comment }
  ]
  const available = config
    .filter(metric => Number(metric.value) > 0)
    .map(metric => ({ ...metric, icon: metricIcon(metric.key), value: formatNumber(metric.value) }))
  return available
}

function metricIcon(key) {
  if (key === 'play') return '▶'
  if (key === 'like') return '♥'
  return '✦'
}

function metricClass(metric) {
  return `metric-${metric.key}`
}

function rankToneClass(index) {
  if (index === 0) return 'rank-top rank-first'
  if (index === 1) return 'rank-top rank-second'
  if (index === 2) return 'rank-top rank-third'
  return ''
}

function rankIcon(index) {
  return ['1', '2', '3'][index] || ''
}

function formatPublishDate(item) {
  const ts = Number(item.publishedTs) || Date.parse(item.publishedAt || '') || 0
  if (!ts) return '未识别'
  const d = new Date(ts)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:00`
}

function statusText(account) {
  if (account.sourceType === 'video_link' && account.lastStatus === 'pending_link') return '待扫'
  if (account.lastStatus === 'pending_resolve') return '待解析'
  if (account.lastStatus === 'error') return '失败'
  if (!account.lastCollectedAt) return '未扫'
  return '已扫'
}

onMounted(async () => {
  await load()
  await syncCollectStatus()
})
onUnmounted(stopCollectPolling)
</script>

<style scoped>
.account-monitor-module {
  height: 100%;
  overflow: auto;
  padding: 18px;
  color: var(--text);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, transparent), transparent 180px),
    var(--bg);
}

.radar-hero,
.timeline-panel,
.account-pool,
.stats-strip article,
.rank-card,
.side-panel,
.empty-card {
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  box-shadow: var(--shadow-sm);
  border-radius: 22px;
}

.radar-hero {
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
}

.radar-hero::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(110deg, transparent 0 58%, color-mix(in srgb, var(--accent) 12%, transparent) 58% 100%),
    radial-gradient(circle at 88% 18%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 28%);
  opacity: .7;
}

.radar-hero > * {
  position: relative;
  z-index: 1;
}

.timeline-panel {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  margin-top: 10px;
  padding: 10px 12px;
}

.timeline-panel strong {
  display: block;
  margin-bottom: 2px;
  font-size: 16px;
}

.timeline-panel span {
  color: var(--text-muted);
  font-size: 13px;
}

.timeline-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.segmented-toggle {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--chip-bg) 82%, transparent);
}

.segmented-toggle button {
  min-height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.segmented-toggle button.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--panel));
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.timeline-select {
  max-width: 120px;
}

.trend-dock {
  position: relative;
}

.trend-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 82%, var(--accent) 6%);
  color: var(--text);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.trend-toggle b {
  color: var(--accent);
  font-size: 11px;
}

.trend-toggle.active {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
  background: color-mix(in srgb, var(--accent) 16%, var(--panel));
}

.trend-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 12;
  width: min(360px, calc(100vw - 36px));
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 20px;
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 34%),
    color-mix(in srgb, var(--panel) 96%, var(--bg));
  box-shadow: var(--shadow-lg, 0 22px 60px rgba(15, 23, 42, .18));
}

.trend-head,
.trend-stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.trend-head strong {
  font-size: 15px;
}

.trend-chart {
  width: 100%;
  height: 112px;
  margin: 8px 0 10px;
  color: var(--accent);
}

.trend-area {
  fill: url(#trendFill);
}

.trend-line {
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.trend-dot {
  fill: color-mix(in srgb, var(--accent) 86%, #fff);
  stroke: var(--panel);
  stroke-width: 2;
}

.trend-stats span {
  display: grid;
  gap: 2px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.trend-stats b {
  color: var(--text);
  font-size: 15px;
}

.trend-note {
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.btn.danger {
  color: var(--danger, #ef4444);
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .12em;
}

.radar-hero h2 {
  margin: 0 0 5px;
  font-size: 24px;
}

.radar-hero span,
.panel-title span,
.empty-card {
  color: var(--text-muted);
}

.hero-actions,
.pool-form,
.stats-strip {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hero-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 420px;
}

.scan-progress {
  flex: 1 1 100%;
  min-width: 240px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 76%, var(--accent) 8%);
  box-shadow: var(--shadow-sm);
}

.scan-progress span {
  display: block;
  margin-bottom: 6px;
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
}

.scan-progress i {
  display: block;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 72%, transparent);
}

.scan-progress b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 52%, #22c55e));
  transition: width .28s ease;
}

.scan-progress.error b {
  background: linear-gradient(90deg, #f97316, #ef4444);
}

.scan-progress.done b {
  background: linear-gradient(90deg, #22c55e, color-mix(in srgb, var(--accent) 42%, #22c55e));
}

.board-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 13px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, var(--accent));
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 78%, var(--chip-bg));
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 10%, transparent);
  cursor: pointer;
  transition: transform .16s ease, border-color .16s ease, background .16s ease, opacity .16s ease;
}

.board-action:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 58%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--panel));
}

.board-action:disabled {
  opacity: .48;
  cursor: not-allowed;
}

.board-action.primary {
  border-color: color-mix(in srgb, var(--accent) 72%, var(--border));
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 86%, #22d3ee), color-mix(in srgb, var(--accent) 68%, #f59e0b));
  color: #fff;
}

.board-action.traffic-entry {
  border-color: color-mix(in srgb, #22c55e 42%, var(--border));
  background: color-mix(in srgb, #22c55e 12%, var(--panel));
  color: color-mix(in srgb, #16a34a 78%, var(--text));
}

.board-action.danger {
  border-color: color-mix(in srgb, var(--danger, #ef4444) 50%, var(--border));
  color: var(--danger, #ef4444);
}

.account-pool {
  padding: 14px;
}

.pool-form {
  flex-wrap: wrap;
}

.pool-hint {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.account-input {
  min-width: 260px;
  flex: 1;
}

.limit-input {
  max-width: 90px;
}

.pool-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.pool-chip {
  position: relative;
  display: grid;
  gap: 3px;
  min-width: 180px;
  padding: 10px 32px 10px 12px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--chip-bg);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.pool-chip span,
.pool-chip em {
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.pool-chip i {
  position: absolute;
  top: 8px;
  right: 10px;
  color: var(--danger, #ef4444);
  font-style: normal;
}

.stats-strip {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.stats-strip article {
  padding: 14px;
  display: grid;
  gap: 4px;
}

.stats-strip span {
  color: var(--text-muted);
  font-size: 12px;
}

.stats-strip b {
  font-size: 24px;
}

.board-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  align-items: start;
  gap: 14px;
  margin-top: 10px;
}

.rank-list {
  display: grid;
  align-self: start;
  align-content: start;
  gap: 6px;
}

.rank-card {
  display: grid;
  grid-template-columns: 36px minmax(240px, 1fr) minmax(188px, 30%);
  gap: 10px;
  align-items: center;
  min-height: 70px;
  padding: 10px 12px;
  border-radius: 16px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 54%),
    color-mix(in srgb, var(--panel) 90%, transparent);
}

.rank-card.rank-top {
  min-height: 86px;
  border: 1px solid color-mix(in srgb, var(--accent) 36%, var(--border));
  box-shadow: 0 16px 42px rgba(15, 23, 42, .12);
}

.rank-card.rank-first {
  background:
    radial-gradient(circle at 8% 18%, rgba(251, 191, 36, .22), transparent 34%),
    linear-gradient(90deg, rgba(251, 191, 36, .12), transparent 58%),
    color-mix(in srgb, var(--panel) 92%, transparent);
}

.rank-card.rank-second {
  background:
    linear-gradient(90deg, rgba(148, 163, 184, .14), transparent 58%),
    color-mix(in srgb, var(--panel) 92%, transparent);
}

.rank-card.rank-third {
  background:
    linear-gradient(90deg, rgba(249, 115, 22, .12), transparent 58%),
    color-mix(in srgb, var(--panel) 92%, transparent);
}

.rank-card.douyin {
  border-color: color-mix(in srgb, #22d3ee 44%, var(--border));
}

.rank-card.bilibili {
  border-color: color-mix(in srgb, #fb7299 44%, var(--border));
}

.rank-no {
  display: grid;
  justify-items: center;
  gap: 4px;
  color: var(--accent);
  font-size: 14px;
  font-weight: 900;
}

.rank-crown {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 12px;
  background: linear-gradient(135deg, #fbbf24, #f97316);
  color: #241100;
  font-size: 15px;
  box-shadow: 0 10px 24px rgba(249, 115, 22, .28);
}

.rank-meta,
.metric-pack {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.rank-main {
  min-width: 0;
}

.rank-meta {
  overflow: hidden;
  max-height: 48px;
  min-width: 0;
}

.rank-meta span,
.metric-pack span {
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-muted);
  font-size: 11px;
}

.rank-meta .account-pill {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 36%, var(--border));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--panel) 92%, transparent));
  color: var(--text);
  font-size: 12px;
  font-weight: 950;
  max-width: min(132px, 32vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rank-meta .platform-pill {
  color: var(--accent);
  font-weight: 900;
}

.rank-meta .hot ~ .focus,
.rank-meta .focus ~ .hot,
.rank-meta .hot ~ .hot,
.rank-meta .focus ~ .focus {
  display: none;
}

.metric-pack span {
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
  color: var(--text);
  font-size: 13px;
  font-weight: 900;
}

.metric-pack .metric-play {
  border: 1px solid rgba(59, 130, 246, .28);
  background: rgba(59, 130, 246, .12);
  color: #60a5fa;
}

.metric-pack .metric-like {
  border: 1px solid rgba(244, 63, 94, .28);
  background: rgba(244, 63, 94, .12);
  color: #fb7185;
}

.metric-pack .metric-comment {
  border: 1px solid rgba(34, 197, 94, .22);
  background: rgba(34, 197, 94, .10);
  color: #4ade80;
}

.metric-icon {
  font-style: normal;
  font-size: 12px;
}

.metric-pack b {
  font-size: 11px;
}

.metric-pack strong {
  color: var(--text);
  font-size: 14px;
}

.rank-title {
  display: block;
  overflow: hidden;
  margin: 0 0 4px;
  color: var(--text);
  font-size: 14px;
  font-weight: 800;
  line-height: 1.25;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rank-side {
  display: grid;
  justify-items: end;
  gap: 5px;
  min-width: 0;
}

.publish-time {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.rank-meta .hot {
  background: rgba(239, 68, 68, .14);
  color: #ef4444;
}

.rank-meta .focus {
  background: rgba(245, 158, 11, .16);
  color: #d97706;
}

.rank-score {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--chip-bg) 72%, transparent);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
}

.metric-pack {
  justify-content: flex-end;
  gap: 6px;
}

.rank-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.workflow-jump {
  min-height: 24px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, var(--panel));
  color: var(--text);
  font-size: 10px;
  font-weight: 900;
  cursor: pointer;
}

.workflow-jump:disabled {
  opacity: .42;
  cursor: not-allowed;
}

.logic-note {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.75;
}

.side-panel {
  padding: 16px;
  align-self: start;
  position: sticky;
  top: 14px;
  max-height: calc(100vh - 36px);
  overflow: auto;
}

.panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.side-ai-card {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
  padding: 11px;
  border: 1px solid color-mix(in srgb, var(--accent) 36%, var(--border));
  border-radius: 16px;
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
}

.side-ai-card.urgent {
  border-color: color-mix(in srgb, #ef4444 38%, var(--border));
  background: color-mix(in srgb, #ef4444 7%, var(--panel));
}

.side-ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: .06em;
}

.side-ai-card strong {
  color: var(--text);
  font-size: 14px;
}

.side-ai-card p,
.side-ai-card small {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.filter-active-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -4px 0 12px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border));
  border-radius: 14px;
  background: color-mix(in srgb, var(--accent) 9%, var(--panel));
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.panel-title.sub {
  margin-top: 22px;
}

.side-search,
.side-select {
  width: 100%;
}

.side-filter-group {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.side-filter-label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.side-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--chip-bg) 82%, transparent);
  color: var(--text-muted);
  cursor: pointer;
}

.side-filter.active {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--panel));
  color: var(--text);
}

.side-filter b {
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 80%, transparent);
  color: var(--text);
  font-size: 12px;
}

.side-link {
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.side-pool {
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.side-pool .pool-form {
  display: grid;
  gap: 8px;
}

.side-pool .account-input,
.side-pool .limit-input {
  min-width: 0;
  max-width: none;
  width: 100%;
}

.side-account-list {
  display: grid;
  margin-top: 10px;
}

.side-account-list .pool-chip {
  min-width: 0;
  width: 100%;
}

.side-stats {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 14px;
}

.side-stats article {
  border-radius: 16px;
}

.bar-row {
  display: grid;
  grid-template-columns: 76px 1fr 34px;
  gap: 8px;
  align-items: center;
  margin: 10px 0;
  color: var(--text-muted);
  font-size: 12px;
}

.bar-row i {
  height: 8px;
  border-radius: 999px;
  background: var(--chip-bg);
  overflow: hidden;
}

.bar-row b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #14b8a6, #f59e0b);
}

.empty-card {
  padding: 20px;
}

@media (max-width: 1120px) {
  .board-layout,
  .rank-card {
    grid-template-columns: 1fr;
  }

  .rank-side {
    justify-items: start;
  }

  .metric-pack {
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .radar-hero,
  .timeline-panel {
    flex-direction: column;
    align-items: stretch;
  }

  .timeline-actions {
    justify-content: flex-start;
  }

  .stats-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
