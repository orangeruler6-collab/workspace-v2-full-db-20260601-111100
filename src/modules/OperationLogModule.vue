<template>
  <div class="log-module">
    <div class="log-head module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">📜</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">AUDIT LOG</div>
          <h2>操作日志</h2>
        </div>
      </div>
      <div class="module-page-actions">
        <button class="btn btn-ghost btn-sm" :disabled="healthLoading" @click="loadHealth">刷新环境</button>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadLogs">刷新日志</button>
      </div>
    </div>

    <section class="health-panel">
      <div class="health-head">
        <div>
          <strong>环境状态</strong>
          <span>{{ healthCheckedLabel }}</span>
        </div>
        <em :class="{ ok: healthOverallOk, warn: !healthOverallOk }">{{ healthOverallOk ? '运行正常' : '需要检查' }}</em>
      </div>
      <div class="health-grid">
        <div v-for="item in healthItems" :key="item.key" class="health-card" :class="{ ok: item.ok, warn: !item.ok }">
          <div class="health-card-title">
            <span>{{ item.icon }}</span>
            <strong>{{ item.label }}</strong>
            <small v-if="!item.required">可选</small>
          </div>
          <p>{{ item.detail }}</p>
        </div>
      </div>
    </section>

    <div class="filter-bar">
      <input v-model.trim="filters.username" class="inp" placeholder="用户" @keyup.enter="search" />
      <select v-model="filters.module" class="inp">
        <option value="">全部模块</option>
        <option v-for="module in modules" :key="module.id" :value="module.id">{{ module.label }}</option>
      </select>
      <input v-model.trim="filters.action" class="inp" placeholder="动作关键词" @keyup.enter="search" />
      <input v-model.trim="filters.keyword" class="inp" placeholder="路径/摘要/详情" @keyup.enter="search" />
      <input v-model="filters.fromDate" class="inp" type="date" />
      <input v-model="filters.toDate" class="inp" type="date" />
      <button class="btn btn-primary" @click="search">筛选</button>
    </div>

    <section class="log-panel">
      <div class="log-summary">
        <span>共 {{ total }} 条</span>
        <span>第 {{ page + 1 }} 页</span>
      </div>
      <div v-if="loading" class="empty-state">加载中</div>
      <div v-else-if="!logs.length" class="empty-state">暂无日志</div>
      <div v-else class="log-table">
        <div class="log-row log-row-head">
          <span>时间</span>
          <span>用户</span>
          <span>模块</span>
          <span>动作</span>
          <span>摘要</span>
        </div>
        <article v-for="log in logs" :key="log.id" class="log-row">
          <span>{{ formatTime(log.created_at) }}</span>
          <span>{{ log.username || '-' }}</span>
          <span>{{ moduleLabel(log.module) }}</span>
          <span>{{ log.action }}</span>
          <span>
            {{ log.summary || '-' }}
            <details v-if="hasMeta(log.metadata)">
              <summary>详情</summary>
              <pre>{{ formatMeta(log.metadata) }}</pre>
            </details>
          </span>
        </article>
      </div>
      <div class="pager">
        <button class="btn btn-ghost btn-sm" :disabled="page <= 0 || loading" @click="prevPage">上一页</button>
        <button class="btn btn-ghost btn-sm" :disabled="(page + 1) * limit >= total || loading" @click="nextPage">下一页</button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { getEnvironmentStatus, listOperationLogs } from '../api/admin'
import { MODULE_DEFINITIONS } from '../permissions'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()
const modules = MODULE_DEFINITIONS
const logs = ref([])
const total = ref(0)
const loading = ref(false)
const healthLoading = ref(false)
const health = ref(null)
const page = ref(0)
const limit = 50
const filters = reactive({
  username: '',
  module: '',
  action: '',
  keyword: '',
  fromDate: '',
  toDate: ''
})

const moduleMap = computed(() => Object.fromEntries(modules.map(module => [module.id, module.label])))
const healthOverallOk = computed(() => {
  if (!health.value) return false
  return healthItems.value.filter(item => item.required).every(item => item.ok)
})
const healthCheckedLabel = computed(() => {
  const ts = health.value?.checkedAt
  if (!ts) return healthLoading.value ? '检查中' : '尚未检查'
  const d = new Date(ts)
  return '最近检查 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
})
const healthItems = computed(() => {
  const data = health.value || {}
  return [
    {
      key: 'api',
      icon: '🟢',
      label: '主 API',
      required: true,
      ok: Boolean(data.api?.ok),
      detail: data.api?.ok ? '端口 ' + (data.api.port || 5555) + ' 可用' : '未返回状态'
    },
    {
      key: 'next',
      icon: '🧩',
      label: '账号风格库',
      required: false,
      ok: Boolean(data.styleWorkbench?.ok),
      detail: data.styleWorkbench?.ok ? 'Next ' + (data.styleWorkbench.port || 3100) + ' 已连接' : (data.styleWorkbench?.error || 'Next 子应用未连接')
    },
    {
      key: 'opencli',
      icon: '🔎',
      label: 'OpenCLI',
      required: false,
      ok: Boolean(data.opencli?.ok),
      detail: data.opencli?.ok ? [data.opencli.bin, data.opencli.version].filter(Boolean).join(' · ') : (data.opencli?.error || '命令不可用')
    },
    {
      key: 'chat',
      icon: '🤖',
      label: '对话模型',
      required: true,
      ok: Boolean(data.chat?.ok),
      detail: data.chat?.ok ? [data.chat.model, data.chat.wireApi, data.chat.proxyConfigured ? '代理已配' : '直连'].filter(Boolean).join(' / ') : '未配置'
    },
    {
      key: 'siliconflow',
      icon: '⚡',
      label: '硅基流动',
      required: true,
      ok: Boolean(data.siliconflow?.ok),
      detail: data.siliconflow?.ok ? '已配置' : '未配置'
    },
    {
      key: 'feishu',
      icon: '📄',
      label: '飞书',
      required: false,
      ok: Boolean(data.feishu?.ok || data.feishu?.doctorOk),
      detail: data.feishu?.doctorOk ? 'CLI 登录正常' : (data.feishu?.configured ? '已配置，待 doctor 校验' : (data.feishu?.error || '需登录/配置'))
    }
  ]
})

function dateToSeconds(value, endOfDay = false) {
  if (!value) return ''
  const d = new Date(value + (endOfDay ? 'T23:59:59' : 'T00:00:00'))
  return Math.floor(d.getTime() / 1000)
}

async function loadLogs() {
  loading.value = true
  try {
    const data = await listOperationLogs({
      username: filters.username,
      module: filters.module,
      action: filters.action,
      keyword: filters.keyword,
      from: dateToSeconds(filters.fromDate),
      to: dateToSeconds(filters.toDate, true),
      limit,
      offset: page.value * limit
    })
    logs.value = data.logs || []
    total.value = data.total || 0
  } catch (e) {
    showToast('日志加载失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function loadHealth() {
  healthLoading.value = true
  try {
    health.value = await getEnvironmentStatus()
  } catch (e) {
    showToast('环境状态检查失败：' + e.message, 'error')
    health.value = {
      checkedAt: Date.now(),
      api: { ok: false },
      styleWorkbench: { ok: false, error: e.message }
    }
  } finally {
    healthLoading.value = false
  }
}

function search() {
  page.value = 0
  loadLogs()
}

function prevPage() {
  page.value = Math.max(0, page.value - 1)
  loadLogs()
}

function nextPage() {
  if ((page.value + 1) * limit >= total.value) return
  page.value += 1
  loadLogs()
}

function moduleLabel(value) {
  if (value === 'auth') return '登录认证'
  return moduleMap.value[value] || value || '-'
}

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

function hasMeta(meta) {
  return meta && Object.keys(meta).length > 0
}

function formatMeta(meta) {
  return JSON.stringify(meta || {}, null, 2)
}

onMounted(() => {
  loadHealth()
  loadLogs()
})
</script>

<style scoped>
.log-module {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.log-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
}

.log-kicker {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
}

.log-head h2 {
  margin: 0;
  color: var(--text);
  font-size: 20px;
  font-weight: 750;
  line-height: 1.2;
}

.filter-bar {
  display: grid;
  grid-template-columns: minmax(110px, 1fr) minmax(140px, 1fr) minmax(120px, 1fr) minmax(140px, 1.2fr) 140px 140px auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
}

.health-panel {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft, var(--panel-bg));
}

.health-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.health-head strong {
  display: block;
  color: var(--text);
  font-size: 13px;
}

.health-head span {
  color: var(--text-muted);
  font-size: 11px;
}

.health-head em {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-style: normal;
  font-size: 11px;
  font-weight: 800;
}

.health-head em.ok {
  color: var(--success, #087447);
  background: var(--success-soft, rgba(8, 116, 71, 0.1));
}

.health-head em.warn {
  color: var(--warning, #a15c07);
  background: var(--warning-soft, rgba(161, 92, 7, 0.1));
}

.health-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.health-card {
  min-width: 0;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface, var(--panel-bg));
}

.health-card.ok {
  border-color: color-mix(in srgb, var(--primary, #14b8a6) 34%, var(--border));
}

.health-card.warn {
  border-color: color-mix(in srgb, #f59e0b 38%, var(--border));
}

.health-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
}

.health-card-title small {
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
}

.health-card p {
  margin: 5px 0 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.35;
  word-break: break-word;
}

.log-panel {
  min-height: 0;
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  padding: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.log-summary {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 12px;
  margin-bottom: 10px;
}

.log-table {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.log-row {
  display: grid;
  grid-template-columns: 140px 130px 130px 170px minmax(240px, 1fr);
  gap: 10px;
  align-items: start;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
}

.log-row:last-child {
  border-bottom: none;
}

.log-row-head {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--text);
  background: var(--surface);
  font-weight: 800;
}

details {
  margin-top: 6px;
}

summary {
  color: var(--primary-light);
  cursor: pointer;
  font-size: 12px;
}

pre {
  margin-top: 6px;
  padding: 8px;
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.5;
}

.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.empty-state {
  color: var(--text-muted);
  font-size: 13px;
  padding: 42px;
  text-align: center;
}

@media (max-width: 980px) {
  .health-grid,
  .filter-bar,
  .log-row {
    grid-template-columns: 1fr;
  }
}
</style>
