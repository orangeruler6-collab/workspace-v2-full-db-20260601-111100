<template>
  <section class="style-workbench-native">
    <div class="page douyin-hotlist-page workbench-frame-page">
      <header class="page-header">
        <div class="page-title-group">
          <span class="page-title-eyebrow">对标内容</span>
          <div class="page-title-row">
            <span class="page-title-mark" aria-hidden="true">榜</span>
            <div class="page-title-copy">
              <h1>抖音热榜</h1>
              <p class="subtle">维护独立对标池，抓取近 3 天值得拆解的内容。</p>
            </div>
          </div>
        </div>
        <div class="page-header-meta">
          <span class="stat-pill">{{ accounts.length }} 个账号</span>
          <button class="btn compact" type="button" @click="accountManagerOpen = true">
            <span class="style-workbench-icon" aria-hidden="true">⚙</span>
            管理账号
          </button>
          <button class="btn" type="button" :disabled="loading" @click="loadAll">
            <span class="style-workbench-icon" aria-hidden="true">↻</span>
            重载
          </button>
          <button class="btn primary" type="button" :disabled="refreshing || !accounts.length" @click="refreshHotlist">
            <span class="style-workbench-icon" aria-hidden="true">↗</span>
            {{ refreshing ? '正在抓取' : '抓取全部近 3 天' }}
          </button>
        </div>
      </header>

      <div v-if="message" class="notice" role="status">{{ message }}</div>
      <div v-if="error" class="error" role="alert">{{ error }}</div>

      <section class="douyin-hotlist-workspace workbench-frame-workspace">
        <section class="pane douyin-hotlist-rank-pane">
          <div class="pane-header">
            <div>
              <h2>{{ selectedAccountName || '实时热度榜' }}</h2>
              <p class="pane-subtitle">{{ rankSubtitle }}</p>
            </div>
            <div class="douyin-hotlist-rank-actions">
              <div class="segmented-control douyin-hotlist-window-filter" aria-label="时间筛选">
                <button type="button" class="active">3天</button>
              </div>
              <label class="inline-sort-control douyin-hotlist-account-filter">
                <span>账号</span>
                <select v-model="selectedAccountId" :disabled="loading || !accounts.length">
                  <option value="all">全部账号</option>
                  <option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.name }}</option>
                </select>
              </label>
              <label class="inline-sort-control douyin-hotlist-sort">
                <span>排序</span>
                <select v-model="sortMode">
                  <option value="heat">综合热度</option>
                  <option value="likes">点赞最高</option>
                  <option value="comments">评论最多</option>
                  <option value="saves">收藏转发</option>
                  <option value="recent">最新发布</option>
                </select>
              </label>
              <span class="status-pill" :class="loading ? 'pending' : 'completed'">{{ loading ? '读取中' : `${visibleItems.length} 条` }}</span>
            </div>
          </div>

          <div class="douyin-hotlist-list">
            <article
              v-for="entry in visibleItems"
              :key="entry.item.video?.id || entry.displayRank"
              class="douyin-hotlist-item has-cover"
              :class="[rankClass(entry.displayRank), { 'is-surging': entry.item.surge }]">
              <div class="douyin-hotlist-rank" :aria-label="`第 ${entry.displayRank} 名`">
                <strong>{{ entry.displayRank }}</strong>
                <span>{{ sortMode === 'heat' ? '热榜' : `总榜 ${entry.item.rank || entry.displayRank}` }}</span>
              </div>
              <div class="douyin-hotlist-item-content">
                <div class="douyin-hotlist-item-head">
                  <span class="douyin-hotlist-cover douyin-hotlist-cover-placeholder" :class="`tone-${avatarTone(entry.item.account?.id)}`" aria-hidden="true">
                    {{ accountInitial(entry.item.account?.name) }}
                  </span>
                  <div class="douyin-hotlist-item-main">
                    <h3>{{ entry.item.video?.title || '未命名视频' }}</h3>
                    <div class="douyin-hotlist-item-meta">
                      <span class="douyin-hotlist-account-meta">
                        <span class="douyin-hotlist-source-avatar" :class="`tone-${avatarTone(entry.item.account?.id)}`" aria-hidden="true">
                          {{ accountInitial(entry.item.account?.name) }}
                        </span>
                        {{ entry.item.account?.name || '未知账号' }}
                      </span>
                      <span>发布 {{ dateLabel(entry.item.video?.publishedAt) }}</span>
                    </div>
                    <div class="douyin-hotlist-signal-row">
                      <span class="douyin-hotlist-signal">{{ entry.item.signal || '互动强度较高' }}</span>
                      <span v-if="entry.item.surge" class="douyin-hotlist-surge-badge">{{ entry.item.surge.label || '升温' }}</span>
                    </div>
                  </div>
                  <a v-if="entry.item.video?.url" class="btn icon-only compact" :href="entry.item.video.url" target="_blank" rel="noopener" aria-label="打开视频">↗</a>
                </div>

                <div class="douyin-hotlist-item-data">
                  <div class="douyin-hotlist-metrics" aria-label="互动数据">
                    <span class="douyin-hotlist-metric tone-likes">
                      <small>点赞</small>
                      <strong>{{ formatNumber(entry.item.video?.stats?.likes) }}</strong>
                    </span>
                    <span class="douyin-hotlist-metric tone-comments">
                      <small>评论</small>
                      <strong>{{ formatNumber(entry.item.video?.stats?.comments) }}</strong>
                    </span>
                    <span class="douyin-hotlist-metric tone-favorites">
                      <small>收藏</small>
                      <strong>{{ formatNumber(entry.item.video?.stats?.favorites) }}</strong>
                    </span>
                    <span class="douyin-hotlist-metric tone-shares">
                      <small>转发</small>
                      <strong>{{ formatNumber(entry.item.video?.stats?.shares) }}</strong>
                    </span>
                  </div>
                  <div class="douyin-hotlist-heat">
                    <div class="douyin-hotlist-score">
                      <span>热度</span>
                      <strong>{{ scoreNumber(entry.item.heatScore) }}</strong>
                    </div>
                    <div class="douyin-hotlist-heat-track" aria-hidden="true">
                      <span :style="{ '--heat-strength': `${heatStrength(entry.item.heatScore)}%` }"></span>
                    </div>
                    <small>互动与发布时间综合</small>
                  </div>
                </div>
              </div>
            </article>

            <div v-if="!loading && !visibleItems.length" class="empty-state-panel douyin-hotlist-empty-rank">
              <span class="empty-state-mark">榜</span>
              <h2>暂无近 3 天内容</h2>
              <p class="subtle">添加账号后抓取，榜单会按跨账号热度排序。</p>
            </div>
          </div>
        </section>
      </section>

      <div v-if="accountManagerOpen" class="modal-backdrop" @click.self="accountManagerOpen = false">
        <section class="modal-panel douyin-hotlist-account-modal" role="dialog" aria-modal="true" aria-labelledby="douyin-hotlist-account-modal-title">
          <div class="modal-header">
            <div>
              <span class="eyebrow">独立热榜账号池</span>
              <h2 id="douyin-hotlist-account-modal-title">管理账号</h2>
            </div>
            <button class="btn icon-btn icon-only" type="button" aria-label="关闭管理账号" @click="accountManagerOpen = false">×</button>
          </div>
          <div class="douyin-hotlist-account-modal-body">
            <form class="douyin-hotlist-add-row douyin-hotlist-account-modal-form" @submit.prevent="addAccount">
              <input v-model="query" autocomplete="off" placeholder="账号名 / 主页链接 / sec_uid" />
              <button class="btn primary compact" type="submit" :disabled="adding || !query.trim()">
                {{ adding ? '添加中' : '添加' }}
              </button>
            </form>
            <div class="douyin-hotlist-account-modal-list">
              <article v-for="account in accounts" :key="account.id" class="douyin-hotlist-managed-account">
                <div>
                  <strong>{{ account.name }}</strong>
                  <span>近 3 天 {{ account.recentVideoCount || 0 }} 条 · 累计 {{ account.videoCount || 0 }} 条</span>
                </div>
                <button class="btn compact danger" type="button" :disabled="removingAccountId === account.id" @click="removeAccount(account)">
                  {{ removingAccountId === account.id ? '移除中' : '移除' }}
                </button>
              </article>
              <div v-if="!accounts.length" class="douyin-hotlist-empty-inline">
                还没有对标账号，先在上方添加。
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { addDouyinHotlistAccount, loadDouyinHotlist, refreshDouyinHotlist, removeDouyinHotlistAccount } from '../api/styleWorkbench'

const loading = ref(false)
const refreshing = ref(false)
const adding = ref(false)
const error = ref('')
const message = ref('')
const snapshot = ref(null)
const query = ref('')
const accountManagerOpen = ref(false)
const removingAccountId = ref('')
const selectedAccountId = ref('all')
const sortMode = ref('heat')

const accounts = computed(() => snapshot.value?.accounts || [])
const items = computed(() => snapshot.value?.items || [])
const selectedAccountName = computed(() => {
  if (selectedAccountId.value === 'all') return ''
  return accounts.value.find((account) => account.id === selectedAccountId.value)?.name || ''
})
const visibleItems = computed(() => {
  const filtered = items.value.filter((item) => selectedAccountId.value === 'all' || item.account?.id === selectedAccountId.value)
  return [...filtered]
    .sort((left, right) => compareItems(left, right, sortMode.value))
    .map((item, index) => ({ item, displayRank: index + 1 }))
})
const maxHeatScore = computed(() => Math.max(...visibleItems.value.map((entry) => Number(entry.item.heatScore || 0)), 1))
const rankSubtitle = computed(() => {
  const summary = snapshot.value?.summary
  if (!summary) return '跨账号排序，按互动强度和发布时间综合判断。'
  return `${summary.accountCount || accounts.value.length} 个账号 · 近 3 天 ${summary.recentVideoCount || visibleItems.value.length} 条 · 最近刷新 ${dateLabel(summary.lastRefreshedAt)}`
})

onMounted(loadAll)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    snapshot.value = await loadDouyinHotlist({ window: '3d' })
  } catch (err) {
    error.value = err.message || '热榜读取失败'
  } finally {
    loading.value = false
  }
}

async function addAccount() {
  if (!query.value.trim()) {
    error.value = '请输入账号信息'
    return
  }
  adding.value = true
  error.value = ''
  message.value = ''
  try {
    snapshot.value = await addDouyinHotlistAccount(query.value.trim())
    query.value = ''
    message.value = '已加入独立热榜账号池。'
  } catch (err) {
    error.value = err.message || '账号添加失败'
  } finally {
    adding.value = false
  }
}

async function removeAccount(account) {
  if (!account?.id) return
  if (!window.confirm(`从热榜账号池移除“${account.name}”？`)) return
  removingAccountId.value = account.id
  error.value = ''
  message.value = ''
  try {
    snapshot.value = await removeDouyinHotlistAccount(account.id)
    if (selectedAccountId.value === account.id) selectedAccountId.value = 'all'
    message.value = '已从独立热榜账号池移除。'
  } catch (err) {
    error.value = err.message || '账号移除失败'
  } finally {
    removingAccountId.value = ''
  }
}

async function refreshHotlist() {
  refreshing.value = true
  error.value = ''
  message.value = ''
  try {
    snapshot.value = await refreshDouyinHotlist({ window: '3d', limit: 40 })
    const refresh = snapshot.value?.refresh
    message.value = refresh ? `已刷新 ${refresh.completed}/${refresh.requested} 个账号。` : '热榜已更新。'
  } catch (err) {
    error.value = err.message || '热榜更新失败'
  } finally {
    refreshing.value = false
  }
}

function compareItems(left, right, mode) {
  if (mode === 'likes') return Number(right.video?.stats?.likes || 0) - Number(left.video?.stats?.likes || 0)
  if (mode === 'comments') return Number(right.video?.stats?.comments || 0) - Number(left.video?.stats?.comments || 0)
  if (mode === 'saves') {
    const rightScore = Number(right.video?.stats?.favorites || 0) + Number(right.video?.stats?.shares || 0)
    const leftScore = Number(left.video?.stats?.favorites || 0) + Number(left.video?.stats?.shares || 0)
    return rightScore - leftScore
  }
  if (mode === 'recent') return timeValue(right.video?.publishedAt) - timeValue(left.video?.publishedAt)
  return Number(right.heatScore || 0) - Number(left.heatScore || 0)
}

function rankClass(rank) {
  if (rank === 1) return 'rank-one'
  if (rank === 2) return 'rank-two'
  if (rank === 3) return 'rank-three'
  return ''
}

function heatStrength(value) {
  return Math.max(6, Math.min(100, Math.round((Number(value || 0) / maxHeatScore.value) * 100)))
}

function formatNumber(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number <= 0) return '0'
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`
  return String(Math.round(number))
}

function scoreNumber(value) {
  return Math.round(Number(value || 0)).toLocaleString('zh-CN')
}

function dateLabel(value) {
  if (!value) return '未刷新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未刷新'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function timeValue(value) {
  if (!value) return 0
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function avatarTone(id) {
  const text = String(id || '')
  const sum = Array.from(text).reduce((total, char) => total + char.charCodeAt(0), 0)
  return (sum % 7) + 1
}

function accountInitial(name) {
  return String(name || '抖').trim().slice(0, 1)
}
</script>
