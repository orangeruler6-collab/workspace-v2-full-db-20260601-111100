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
      <input v-model.trim="filters.keyword" class="inp" placeholder="摘要 / 详情" @keyup.enter="search" />
      <input v-model="filters.fromDate" class="inp" type="date" />
      <input v-model="filters.toDate" class="inp" type="date" />
      <label class="quiet-toggle">
        <input v-model="filters.importantOnly" type="checkbox" @change="search" />
        <span>只看有效操作</span>
      </label>
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
          <span>具体操作</span>
        </div>
        <article v-for="log in logs" :key="log.id" class="log-row">
          <span class="time-cell">{{ formatTime(log.created_at) }}</span>
          <span>{{ log.username || '-' }}</span>
          <span>{{ moduleLabel(log.module) }}</span>
          <span>
            <em class="action-chip" :class="actionTone(log.action)">{{ actionLabel(log.action) }}</em>
          </span>
          <span class="summary-cell">
            {{ displaySummary(log) }}
            <details v-if="hasMeta(log.metadata)">
              <summary>详情</summary>
              <div class="meta-list">
                <div v-for="item in metaItems(log.metadata)" :key="item.key" class="meta-item">
                  <b>{{ item.label }}</b>
                  <span>{{ item.value }}</span>
                </div>
              </div>
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
const modules = flattenModules(MODULE_DEFINITIONS)
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
  toDate: '',
  importantOnly: true
})

const actionLabels = {
  'schedule.task.create': '新建排期',
  'schedule.task.update': '修改排期',
  'schedule.task.progress': '推进排期',
  'schedule.task.delete': '删除排期',
  'schedule.task.handoff': '任务交接',
  'schedule.todo.create': '新建待办',
  'schedule.todo.update': '修改待办',
  'schedule.todo.done': '完成待办',
  'schedule.todo.reopen': '重开待办',
  'schedule.todo.delete': '删除待办',
  'user.create': '新建用户',
  'user.update': '修改用户',
  'user.reset_password': '重置密码',
  'user.delete': '删除用户',
  'profit.create': '新增流水',
  'profit.update': '修改流水',
  'profit.delete': '删除流水',
  'material.upload': '上传素材',
  'material.update': '修改素材',
  'material.delete': '删除素材',
  'idea.create': '新增创意',
  'idea.update': '修改创意',
  'idea.delete': '删除创意',
  'dailyhot.refresh': '更新热点',
  'dailyhot.analyze': '分析热点',
  'dailyhot.update_status': '修改热点状态',
  'dailyhot.manual_add': '手动加热点',
  'system_health.run': '系统自检',
  'imagegen.text2image': '文生图',
  'imagegen.image2image': '图生图',
  'imagegen.task.create': '生图排队',
  'imagegen.history.delete': '删除生图',
  'posttools.video_download': '视频下载',
  'posttools.video_download_batch': '批量下载',
  'posttools.media_convert': '媒体转换',
  'posttools.ncm_convert': 'NCM 转换',
  'posttools.video_analyze': '视频转写',
  'posttools.ai_recommend': 'AI 推荐',
  'videopublish.job.create': '创建发布',
  'videopublish.job.status': '修改发布状态',
  'videopublish.job.cancel': '取消发布',
  'videopublish.job.run': '执行发布',
  'videopublish.job.run_batch': '启动队列',
  'videopublish.job.delete': '删除发布',
  'videopublish.account.save': '保存发布账号',
  'videopublish.account.login': '打开登录态',
  'videopublish.video.upload': '上传视频',
  'videopublish.video.transcribe': '视频转写',
  'comment_reply.collect': '采集评论',
  'comment_reply.plan': '生成回复',
  'comment_reply.send': '发送回复',
  login: '登录',
  logout: '退出登录',
  'login.success': '登录',
  'auth.login': '登录'
}

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
      icon: '●',
      label: '主 API',
      required: true,
      ok: Boolean(data.api?.ok),
      detail: data.api?.ok ? '端口 ' + (data.api.port || 5555) + ' 可用' : '未返回状态'
    },
    {
      key: 'styleWorkbench',
      icon: '🧩',
      label: '账号风格库',
      required: false,
      ok: Boolean(data.styleWorkbench?.ok),
      detail: data.styleWorkbench?.ok ? '原生 API 已接入' : (data.styleWorkbench?.error || '文案工作台原生 API 未连接')
    },
    {
      key: 'opencli',
      icon: 'C',
      label: 'OpenCLI',
      required: false,
      ok: Boolean(data.opencli?.ok),
      detail: data.opencli?.ok ? [data.opencli.bin, data.opencli.version].filter(Boolean).join(' / ') : (data.opencli?.error || '命令不可用')
    },
    {
      key: 'chat',
      icon: 'AI',
      label: '对话模型',
      required: true,
      ok: Boolean(data.chat?.ok),
      detail: data.chat?.ok ? [data.chat.model, data.chat.wireApi, data.chat.proxyConfigured ? '代理已配' : '直连'].filter(Boolean).join(' / ') : '未配置'
    },
    {
      key: 'siliconflow',
      icon: 'SF',
      label: '硅基流动',
      required: true,
      ok: Boolean(data.siliconflow?.ok),
      detail: data.siliconflow?.ok ? '已配置' : '未配置'
    },
    {
      key: 'feishu',
      icon: 'F',
      label: '飞书',
      required: false,
      ok: Boolean(data.feishu?.ok || data.feishu?.doctorOk),
      detail: data.feishu?.doctorOk ? 'CLI 登录正常' : (data.feishu?.configured ? '已配置，待 doctor 校验' : (data.feishu?.error || '需登录/配置'))
    }
  ]
})

function flattenModules(items = []) {
  return items.flatMap(item => Array.isArray(item.children) ? item.children : [item])
}

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
      importantOnly: filters.importantOnly,
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
      styleWorkbench: { ok: false, native: true, error: e.message }
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
  if (value === 'schedule') return '排期看板'
  if (value === 'operationLogs') return '操作日志'
  return moduleMap.value[value] || value || '-'
}

function actionLabel(value) {
  const raw = String(value || '')
  if (raw.endsWith('.failed')) {
    const base = raw.replace(/\.failed$/, '')
    return (actionLabels[base] || base) + '失败'
  }
  return actionLabels[raw] || raw || '-'
}

function actionTone(value = '') {
  if (value.includes('delete')) return 'danger'
  if (value.includes('failed')) return 'danger'
  if (value.includes('create') || value.includes('upload')) return 'success'
  if (value.includes('progress') || value.includes('done') || value.includes('handoff')) return 'primary'
  return 'neutral'
}

function displaySummary(log) {
  const meta = log.metadata || {}
  if (log.action?.startsWith('profit.')) {
    const verb = log.action === 'profit.create' ? '新增流水' : log.action === 'profit.delete' ? '删除流水' : '修改流水'
    const subject = [meta.grp, meta.project, meta.account].filter(Boolean).join(' / ')
    const amount = meta.final_amount || meta.revenue || meta.margin
    const status = meta.execution_status ? `，状态：${meta.execution_status}` : ''
    return `${verb}：${subject || meta.id || '未命名记录'}${amount ? `，金额：${amount}` : ''}${status}`
  }
  if (log.summary) return log.summary
  if (meta.path) return `${meta.method || 'POST'} ${meta.path}`
  return '-'
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

function metaItems(meta) {
  const data = meta || {}
  const pairs = [
    ['account', '账号'],
    ['person', '执行人'],
    ['group_name', '分组'],
    ['grp', '分组'],
    ['project', '项目'],
    ['platform', '平台'],
    ['account', '账号'],
    ['date', '日期'],
    ['month', '月份'],
    ['type', '类型'],
    ['status', '状态'],
    ['execution_status', '执行状态'],
    ['final_amount', '金额'],
    ['revenue', '营收'],
    ['margin', '毛利'],
    ['progress', '进度'],
    ['workflow_stage', '阶段'],
    ['title', '标题'],
    ['due_at', '时间'],
    ['from', '交接人'],
    ['to', '接收人']
  ]
  const source = data.after || data.task || data
  return pairs
    .map(([key, label]) => ({ key, label, value: source?.[key] }))
    .filter(item => item.value !== undefined && item.value !== null && String(item.value).trim() !== '')
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
}

.log-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
}

.filter-bar {
  display: grid;
  grid-template-columns: minmax(110px, 1fr) minmax(140px, 1fr) minmax(120px, 1fr) minmax(150px, 1.2fr) 140px 140px auto auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
}

.quiet-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  background: var(--surface);
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
  grid-template-columns: 140px 120px 120px 120px minmax(280px, 1fr);
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

.time-cell {
  color: var(--text-muted);
}

.summary-cell {
  color: var(--text);
  line-height: 1.55;
}

.action-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-style: normal;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.action-chip.primary {
  color: var(--primary-light);
  background: var(--status-bg);
}

.action-chip.success {
  color: #0f8f5f;
  background: rgba(15, 143, 95, 0.1);
}

.action-chip.danger {
  color: var(--danger-text, #ef4444);
  background: var(--danger-bg, rgba(239, 68, 68, 0.1));
}

details {
  margin-top: 6px;
}

summary {
  color: var(--primary-light);
  cursor: pointer;
  font-size: 12px;
}

.meta-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.meta-item {
  display: inline-flex;
  gap: 4px;
  padding: 3px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-dim);
  font-size: 11px;
}

.meta-item b {
  color: var(--text-muted);
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

@media (max-width: 1100px) {
  .health-grid,
  .filter-bar,
  .log-row {
    grid-template-columns: 1fr;
  }
}
</style>
