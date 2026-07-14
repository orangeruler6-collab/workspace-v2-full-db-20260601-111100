<template>
  <div class="comment-reply-module">
    <header class="module-page-header comment-reply-head">
      <div class="module-page-title">
        <span class="module-page-icon">评</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">COMMENT REPLY</div>
          <h2>评论回复</h2>
          <p>抖音测试号评论处理：抓取未回复，规则分流，安全项慢速发送。</p>
        </div>
      </div>
      <div class="module-page-actions">
        <span class="module-page-pill">安全 {{ safeCount }} / 待人工 {{ manualCount }}</span>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadAll">刷新</button>
      </div>
    </header>

    <section class="comment-reply-layout">
      <aside class="comment-reply-panel account-panel">
        <div class="panel-title">
          <strong>测试账号</strong>
          <span>只加载指定抖音号，默认先看麦小雯。</span>
        </div>
        <div class="pool-mini-stats">
          <span><b>{{ accounts.length }}</b>账号</span>
          <span><b>{{ testAccounts.length }}</b>测试池</span>
          <span><b>{{ enabledCount }}</b>已开</span>
        </div>
        <div class="test-account-strip" v-if="testAccounts.length">
          <button
            v-for="account in testAccounts"
            :key="account.accountId"
            type="button"
            :class="{ active: selectedAccountId === account.accountId }"
            @click="selectTestAccount(account)"
          >
            {{ account.accountName }}
          </button>
        </div>
        <div class="account-list">
          <button
            v-for="account in accounts"
            :key="account.accountId"
            type="button"
            class="account-card"
            :class="{ active: selectedAccountId === account.accountId, enabled: account.enabled, recommended: account.testRecommended, cohort: account.testCohort }"
            @click="selectAccount(account.accountId)"
          >
            <i class="account-avatar">{{ account.avatar || account.accountName?.slice(0, 1) }}</i>
            <div class="account-card-main">
              <div class="account-name-line">
                <strong>{{ account.accountName }}</strong>
                <em v-if="account.testRecommended">测试</em>
                <em v-else-if="account.testCohort">测试池</em>
              </div>
              <span>{{ account.enabled ? '已纳入本轮测试' : '未启用测试' }}</span>
            </div>
            <label class="mini-toggle" @click.stop>
              <input
                type="checkbox"
                :checked="account.enabled"
                :disabled="savingAccountId === account.accountId"
                @change="toggleAccount(account, $event.target.checked)"
              />
              <span>{{ account.enabled ? '已开启' : '关闭' }}</span>
            </label>
          </button>
        </div>
      </aside>

      <main class="comment-reply-main">
        <section class="comment-reply-panel action-panel">
          <div class="panel-title">
            <strong>{{ selectedAccount?.accountName || '选择账号' }}</strong>
            <span>{{ selectedAccount ? accountHint(selectedAccount) : '先在左侧选择要测试的大号。' }}</span>
          </div>
          <div v-if="selectedAccount" class="selected-account-brief">
            <div class="brief-identity">
              <i>{{ selectedAccount.avatar || selectedAccount.accountName?.slice(0, 1) }}</i>
              <div>
                <strong>{{ selectedAccount.accountName }}</strong>
                <span>{{ currentScopeLabel }} · {{ selectedItems.length }} 条</span>
              </div>
            </div>
            <div class="scope-picker">
              <div class="scope-picker-title">
                <strong>评论范围</strong>
                <span>抓取后按作品自动归类；只对当前范围分流和发送。</span>
              </div>
              <div class="scope-list">
                <button
                  type="button"
                  class="scope-chip"
                  :class="{ active: selectedScopeKey === 'all' }"
                  @click="selectedScopeKey = 'all'"
                >
                  <strong>全部未回复</strong>
                  <span>{{ accountItems.length }} 条</span>
                </button>
                <button
                  v-for="group in videoGroups"
                  :key="group.key"
                  type="button"
                  class="scope-chip"
                  :class="{ active: selectedScopeKey === group.key }"
                  @click="selectedScopeKey = group.key"
                >
                  <strong>{{ group.label }}</strong>
                  <span>{{ group.total }} 条 · 安全 {{ group.planned }}</span>
                </button>
              </div>
            </div>
            <div class="reply-style-row">
              <span>回复风格</span>
              <div class="style-segments">
                <button
                  v-for="option in replyStyleOptions"
                  :key="option.value"
                  type="button"
                  :class="{ active: replyStyle === option.value }"
                  @click="replyStyle = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div class="queue-summary">
              <span><em>安全待发</em><b>{{ selectedStats.planned }}</b></span>
              <span><em>待人工</em><b>{{ selectedStats.manual }}</b></span>
              <span><em>已回复</em><b>{{ selectedStats.sent }}</b></span>
              <span><em>失败</em><b>{{ selectedStats.failed }}</b></span>
            </div>
            <p class="style-hint">{{ selectedAccount.styleHint || '回复语气按账号既有内容风格保持自然，不做事实承诺。' }}</p>
          </div>
          <div class="action-row">
            <label>
              <span>抓取上限</span>
              <input v-model.number="collectLimit" class="inp" type="number" min="1" max="100" />
            </label>
            <label>
              <span>发送上限</span>
              <input v-model.number="sendLimit" class="inp" type="number" min="1" max="20" />
            </label>
            <button class="btn btn-primary" :disabled="!canOperate || collecting" @click="collectComments">
              {{ collecting ? '抓取中...' : '抓取未回复评论' }}
            </button>
            <button class="btn btn-ghost" :disabled="!canOperate || !selectedItems.length || planning" @click="planReplies">
              {{ planning ? '分流中...' : '规则分流当前范围' }}
            </button>
            <button class="btn btn-primary danger-soft" :disabled="!canSend || sending" @click="sendSafeReplies">
              {{ sending ? '发送中...' : `发送当前范围安全项 ${sendableCount}` }}
            </button>
          </div>
          <p v-if="statusText" class="status-line" :class="statusTone">{{ statusText }}</p>
        </section>

        <section class="comment-reply-panel">
          <div class="queue-tabs">
            <button :class="{ active: filterStatus === '' }" @click="filterStatus = ''">全部</button>
            <button :class="{ active: filterStatus === 'planned' }" @click="filterStatus = 'planned'">安全待发</button>
            <button :class="{ active: filterStatus === 'manual' }" @click="filterStatus = 'manual'">待人工</button>
            <button :class="{ active: filterStatus === 'sent' }" @click="filterStatus = 'sent'">已回复</button>
            <button :class="{ active: filterStatus === 'failed' }" @click="filterStatus = 'failed'">失败</button>
          </div>

          <div v-if="loading" class="empty-state">正在读取评论队列...</div>
          <div v-else-if="!filteredItems.length" class="empty-state">暂无评论记录。</div>
          <div v-else class="reply-list">
            <article v-for="item in filteredItems" :key="item.id" class="reply-card" :class="item.status">
              <div class="reply-top">
                <div>
                  <strong>{{ item.authorName || '评论用户' }}</strong>
                  <span>{{ item.accountName }} · {{ item.videoTitle || item.videoId || '未识别视频' }}</span>
                </div>
                <em>{{ statusLabel(item) }}</em>
              </div>
              <p class="comment-text">{{ item.commentText }}</p>
              <div class="reply-suggestion">
                <span>建议回复</span>
                <b>{{ item.suggestedReply || '待生成' }}</b>
              </div>
              <div class="reply-meta">
                <span v-if="item.riskReason">{{ item.riskReason }}</span>
                <span v-if="item.error">{{ item.error }}</span>
                <span>{{ formatTime(item.updatedAt || item.sentAt) }}</span>
                <button
                  v-if="item.status === 'planned' && item.riskLevel === 'safe'"
                  type="button"
                  class="mini-action"
                  :disabled="sending || sendingItemId === item.id"
                  @click="sendSingleReply(item)"
                >
                  {{ sendingItemId === item.id ? '发送中...' : '发送这条' }}
                </button>
              </div>
            </article>
          </div>
        </section>
      </main>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  collectCommentReply,
  fetchCommentReplyAccounts,
  fetchCommentReplyHistory,
  planCommentReply,
  sendCommentReply,
  updateCommentReplyAccount
} from '../api/commentReply'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()

const accounts = ref([])
const items = ref([])
const selectedAccountId = ref('')
const selectedScopeKey = ref('all')
const replyStyle = ref('natural')
const filterStatus = ref('')
const collectLimit = ref(50)
const sendLimit = ref(20)
const loading = ref(false)
const collecting = ref(false)
const planning = ref(false)
const sending = ref(false)
const sendingItemId = ref('')
const savingAccountId = ref('')
const statusText = ref('')
const statusTone = ref('idle')

const replyStyleOptions = [
  { value: 'natural', label: '自然轻短' },
  { value: 'warm', label: '热情互动' },
  { value: 'restrained', label: '克制官方' }
]

const selectedAccount = computed(() => accounts.value.find(item => item.accountId === selectedAccountId.value) || null)
const testAccounts = computed(() => accounts.value
  .filter(item => item.testCohort || item.testRecommended)
  .sort((a, b) => Number(Boolean(b.testRecommended)) - Number(Boolean(a.testRecommended)) || Number(a.testRank || 999) - Number(b.testRank || 999) || String(a.accountName || '').localeCompare(String(b.accountName || ''), 'zh-CN'))
)
const accountItems = computed(() => items.value.filter(item => !selectedAccountId.value || item.accountId === selectedAccountId.value))
const videoGroups = computed(() => {
  const map = new Map()
  accountItems.value.forEach(item => {
    const key = scopeKey(item)
    const current = map.get(key) || {
      key,
      label: scopeLabel(item),
      total: 0,
      planned: 0,
      manual: 0,
      sent: 0,
      failed: 0,
      updatedAt: 0
    }
    current.total += 1
    current.updatedAt = Math.max(current.updatedAt, Number(item.updatedAt || item.sentAt || 0))
    if (item.status === 'planned' && item.riskLevel === 'safe') current.planned += 1
    if (item.status === 'manual') current.manual += 1
    if (item.status === 'sent') current.sent += 1
    if (item.status === 'failed') current.failed += 1
    map.set(key, current)
  })
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt || b.total - a.total)
})
const selectedItems = computed(() => {
  if (selectedScopeKey.value === 'all') return accountItems.value
  return accountItems.value.filter(item => scopeKey(item) === selectedScopeKey.value)
})
const filteredItems = computed(() => {
  return selectedItems.value
    .filter(item => !filterStatus.value || item.status === filterStatus.value)
})
const selectedScopeIds = computed(() => selectedItems.value.map(item => item.id).filter(Boolean))
const currentScopeLabel = computed(() => {
  if (selectedScopeKey.value === 'all') return '全部未回复'
  const group = videoGroups.value.find(item => item.key === selectedScopeKey.value)
  return group?.label || '当前作品'
})
const enabledCount = computed(() => accounts.value.filter(item => item.enabled).length)
const safeCount = computed(() => items.value.filter(item => item.riskLevel === 'safe' && item.status === 'planned').length)
const manualCount = computed(() => items.value.filter(item => item.status === 'manual').length)
const sendableCount = computed(() => selectedItems.value.filter(item => item.status === 'planned' && item.riskLevel === 'safe').length)
const selectedStats = computed(() => ({
  planned: selectedItems.value.filter(item => item.status === 'planned' && item.riskLevel === 'safe').length,
  manual: selectedItems.value.filter(item => item.status === 'manual').length,
  sent: selectedItems.value.filter(item => item.status === 'sent').length,
  failed: selectedItems.value.filter(item => item.status === 'failed').length
}))
const canOperate = computed(() => Boolean(selectedAccount.value?.enabled && selectedAccount.value?.canRun))
const canSend = computed(() => canOperate.value && sendableCount.value > 0)

function setStatus(text, tone = 'idle') {
  statusText.value = text
  statusTone.value = tone
}

function scopeKey(item) {
  const value = item.videoId || item.videoTitle || item.raw?.videoId || item.raw?.videoTitle || 'unknown'
  return `video:${String(value).trim() || 'unknown'}`
}

function scopeLabel(item) {
  const value = item.videoTitle || item.videoId || item.raw?.videoTitle || item.raw?.videoId
  return value ? String(value).slice(0, 32) : '未识别作品'
}

function accountHint(account) {
  if (!account.enabled) return '该账号未开启测试，请先打开开关。'
  if (!account.canRun) return account.loginReason || '登录态不可用，需要先处理抖音后台登录。'
  return '手动触发：先抓取未回复，再选择作品范围分流和发送。'
}

function selectAccount(accountId) {
  selectedAccountId.value = accountId
}

function selectRecommended() {
  const target = accounts.value.find(item => item.testRecommended) || accounts.value.find(item => /麦小雯|麦晓雯/.test(item.accountName || ''))
  if (target) {
    selectTestAccount(target)
  }
}

function selectTestAccount(account) {
  selectedAccountId.value = account.accountId
}

async function loadAccounts() {
  const data = await fetchCommentReplyAccounts()
  accounts.value = Array.isArray(data.accounts) ? data.accounts : []
  if (!selectedAccountId.value && accounts.value.length) {
    const target = accounts.value.find(item => item.testRecommended) || accounts.value.find(item => /麦小雯|麦晓雯/.test(item.accountName || '')) || accounts.value[0]
    selectedAccountId.value = target.accountId
  }
}

async function loadHistory() {
  const data = await fetchCommentReplyHistory({ limit: 200 })
  items.value = Array.isArray(data.items) ? data.items : []
}

async function loadAll() {
  loading.value = true
  try {
    await Promise.all([loadAccounts(), loadHistory()])
    setStatus('已刷新评论回复状态', 'ok')
  } catch (error) {
    setStatus(error.message || '刷新失败', 'error')
    showToast('评论回复刷新失败：' + (error.message || error), 'error')
  } finally {
    loading.value = false
  }
}

async function toggleAccount(account, enabled) {
  savingAccountId.value = account.accountId
  try {
    const data = await updateCommentReplyAccount(account.accountId, enabled)
    accounts.value = Array.isArray(data.accounts) ? data.accounts : accounts.value
    setStatus(`${account.accountName} 已${enabled ? '开启' : '关闭'}评论回复测试`, 'ok')
  } catch (error) {
    showToast('账号开关保存失败：' + (error.message || error), 'error')
  } finally {
    savingAccountId.value = ''
  }
}

async function collectComments() {
  if (!selectedAccount.value) return
  collecting.value = true
  setStatus('正在打开抖音评论管理并读取未回复评论...', 'idle')
  try {
    const data = await collectCommentReply({
      accountId: selectedAccount.value.accountId,
      limit: collectLimit.value,
      replyStyle: replyStyle.value
    })
    if (Array.isArray(data.history)) items.value = data.history
    else if (Array.isArray(data.items)) items.value = mergeItems(items.value, data.items)
    selectedScopeKey.value = 'all'
    setStatus(`已抓取 ${data.count || data.items?.length || 0} 条评论`, 'ok')
  } catch (error) {
    setStatus(error.message || '抓取失败', 'error')
    showToast('抓取失败：' + (error.message || error), 'error')
  } finally {
    collecting.value = false
  }
}

async function planReplies() {
  planning.value = true
  try {
    const data = await planCommentReply({
      accountId: selectedAccountId.value,
      ids: selectedScopeIds.value,
      replyStyle: replyStyle.value,
      limit: 200
    })
    if (Array.isArray(data.items)) items.value = mergeItems(items.value, data.items)
    await loadHistory()
    setStatus(`当前范围分流完成：安全项 ${data.safeCount || 0} 条`, 'ok')
  } catch (error) {
    setStatus(error.message || '规则判定失败', 'error')
  } finally {
    planning.value = false
  }
}

async function sendSafeReplies() {
  if (!selectedAccount.value) return
  sending.value = true
  setStatus('正在手动执行安全项，按 6-15 秒间隔发送...', 'idle')
  try {
    const data = await sendCommentReply({
      accountId: selectedAccount.value.accountId,
      limit: sendLimit.value,
      ids: selectedScopeIds.value
    })
    if (Array.isArray(data.history)) items.value = mergeItems(items.value, data.history)
    const sent = data.sent?.length || 0
    const failed = data.failed?.length || 0
    setStatus(`发送完成：成功 ${sent} 条，失败 ${failed} 条`, failed ? 'warn' : 'ok')
  } catch (error) {
    setStatus(error.message || '发送失败', 'error')
    showToast('发送失败：' + (error.message || error), 'error')
  } finally {
    sending.value = false
  }
}

async function sendSingleReply(item) {
  if (!selectedAccount.value || !item?.id) return
  sendingItemId.value = item.id
  setStatus('正在发送当前评论...', 'idle')
  try {
    const data = await sendCommentReply({
      accountId: selectedAccount.value.accountId,
      limit: 1,
      ids: [item.id]
    })
    if (Array.isArray(data.history)) items.value = mergeItems(items.value, data.history)
    const sent = data.sent?.length || 0
    const failed = data.failed?.length || 0
    setStatus(`单条发送完成：成功 ${sent} 条，失败 ${failed} 条`, failed ? 'warn' : 'ok')
  } catch (error) {
    setStatus(error.message || '单条发送失败', 'error')
    showToast('单条发送失败：' + (error.message || error), 'error')
  } finally {
    sendingItemId.value = ''
  }
}

function mergeItems(oldItems, newItems) {
  const map = new Map()
  oldItems.forEach(item => map.set(item.id, item))
  newItems.forEach(item => map.set(item.id, item))
  return [...map.values()].sort((a, b) => Number(b.updatedAt || b.sentAt || 0) - Number(a.updatedAt || a.sentAt || 0))
}

function statusLabel(item) {
  const labels = {
    planned: '安全待发',
    manual: '待人工',
    sent: '已回复',
    failed: '失败'
  }
  return labels[item.status] || item.status || '未规划'
}

function formatTime(value) {
  const time = Number(value || 0)
  if (!time) return '刚刚'
  return new Date(time * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

watch(selectedAccountId, () => {
  filterStatus.value = ''
  selectedScopeKey.value = 'all'
})

watch(videoGroups, groups => {
  if (selectedScopeKey.value === 'all') return
  if (!groups.some(group => group.key === selectedScopeKey.value)) selectedScopeKey.value = 'all'
})

onMounted(loadAll)
</script>

<style scoped>
.comment-reply-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.comment-reply-head p {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.comment-reply-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(250px, 300px) minmax(0, 1fr);
  gap: 14px;
}

.comment-reply-panel {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  box-shadow: var(--shadow-sm);
}

.account-panel,
.comment-reply-main {
  min-height: 0;
}

.account-panel {
  display: flex;
  flex-direction: column;
}

.comment-reply-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
}

.panel-title {
  padding: 14px;
  display: grid;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}

.panel-title strong {
  color: var(--text);
  font-size: 14px;
}

.panel-title span,
.reply-meta,
.account-card span {
  color: var(--text-muted);
  font-size: 12px;
}

.pool-mini-stats {
  padding: 8px 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  border-bottom: 1px solid var(--border);
}

.pool-mini-stats span {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.pool-mini-stats b {
  margin-right: 4px;
  color: var(--text);
  font-size: 14px;
}

.test-account-strip {
  padding: 8px 10px;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
}

.test-account-strip button {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.test-account-strip button.active {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--panel-bg));
  color: var(--primary);
}

.account-list {
  min-height: 0;
  overflow: auto;
  padding: 10px;
  display: grid;
  gap: 8px;
}

.account-card {
  width: 100%;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.account-card.active {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 18%, transparent);
}

.account-card.enabled {
  background: color-mix(in srgb, var(--success-bg, #dcfce7) 32%, var(--panel-bg));
}

.account-card.recommended {
  border-color: color-mix(in srgb, var(--primary) 42%, var(--border));
}

.account-card.cohort {
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--primary) 50%, transparent);
}

.account-avatar,
.brief-identity i {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--primary) 14%, var(--panel-bg));
  color: var(--primary);
  font-style: normal;
  font-size: 15px;
  font-weight: 900;
}

.account-card-main {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.account-name-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.account-name-line em {
  flex: 0 0 auto;
  padding: 2px 5px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--primary) 12%, var(--panel-bg));
  color: var(--primary);
  font-size: 10px;
  font-style: normal;
  font-weight: 900;
}

.account-card strong,
.account-card span,
.account-card small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-card small {
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 900;
}

.account-card small.ok {
  color: var(--success-text, #15803d);
}

.account-card small.warn {
  color: var(--warning-text, #b45309);
}

.account-card em {
  width: fit-content;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
}

.account-card em.ok {
  color: var(--success-text, #15803d);
  background: var(--success-bg, #dcfce7);
}

.account-card em.warn {
  color: var(--warning-text, #b45309);
  background: var(--warning-bg, #fef3c7);
}

.mini-toggle {
  display: grid;
  justify-items: end;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.selected-account-brief {
  margin: 12px 14px 0;
  display: grid;
  gap: 10px;
}

.brief-identity {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.brief-identity div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.brief-identity strong {
  color: var(--text);
  font-size: 14px;
}

.brief-identity span {
  color: var(--text-muted);
  font-size: 12px;
}

.scope-picker {
  display: grid;
  gap: 8px;
}

.scope-picker-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.scope-picker-title strong,
.reply-style-row > span {
  color: var(--text);
  font-size: 12px;
  font-weight: 900;
}

.scope-picker-title span {
  color: var(--text-muted);
  font-size: 11px;
}

.scope-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.scope-chip {
  flex: 0 0 168px;
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.scope-chip.active {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 10%, var(--panel-bg));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 16%, transparent);
}

.scope-chip strong,
.scope-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scope-chip strong {
  font-size: 12px;
}

.scope-chip span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.reply-style-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.style-segments {
  min-width: 0;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.style-segments button {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.style-segments button.active {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}

.queue-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.queue-summary span {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel-bg-soft) 78%, var(--panel-bg));
}

.queue-summary em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 900;
}

.queue-summary b {
  color: var(--text);
  font-size: 18px;
  line-height: 1;
}

.style-hint {
  margin: 0;
  padding: 9px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--primary) 8%, var(--panel-bg));
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.action-panel {
  padding-bottom: 12px;
}

.action-row {
  padding: 12px 14px 0;
  display: flex;
  gap: 8px;
  align-items: end;
  flex-wrap: wrap;
}

.action-row label {
  display: grid;
  gap: 4px;
  width: 110px;
}

.action-row label span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.danger-soft {
  background: var(--danger, #ef4444);
  border-color: var(--danger, #ef4444);
}

.status-line {
  margin: 10px 14px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.status-line.ok {
  color: var(--success-text, #15803d);
}

.status-line.warn {
  color: var(--warning-text, #b45309);
}

.status-line.error {
  color: var(--danger, #ef4444);
}

.queue-tabs {
  padding: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
}

.queue-tabs button {
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.queue-tabs button.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.reply-list {
  max-height: calc(100vh - 310px);
  overflow: auto;
  padding: 10px;
  display: grid;
  gap: 10px;
}

.reply-card {
  min-width: 0;
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.reply-card.planned {
  border-color: color-mix(in srgb, var(--success-text, #15803d) 34%, var(--border));
}

.reply-card.manual {
  border-color: color-mix(in srgb, var(--warning-text, #b45309) 34%, var(--border));
}

.reply-card.failed {
  border-color: color-mix(in srgb, var(--danger, #ef4444) 34%, var(--border));
}

.reply-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.reply-top div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.reply-top strong,
.reply-top span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reply-top em {
  color: var(--primary);
  font-size: 12px;
  font-style: normal;
  font-weight: 900;
  white-space: nowrap;
}

.comment-text {
  margin: 0;
  color: var(--text);
  line-height: 1.55;
}

.reply-suggestion {
  display: grid;
  gap: 4px;
  padding: 8px;
  border-radius: 8px;
  background: var(--panel-bg);
}

.reply-suggestion span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.reply-suggestion b {
  color: var(--text);
  font-size: 13px;
}

.reply-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mini-action {
  min-height: 24px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--primary) 34%, var(--border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 10%, var(--panel-bg));
  color: var(--primary);
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
}

.mini-action:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.empty-state {
  margin: 12px;
  padding: 28px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  text-align: center;
}

@media (max-width: 920px) {
  .comment-reply-layout {
    grid-template-columns: 1fr;
  }

  .reply-style-row,
  .queue-summary {
    grid-template-columns: 1fr;
  }

  .reply-list {
    max-height: none;
  }
}
</style>
