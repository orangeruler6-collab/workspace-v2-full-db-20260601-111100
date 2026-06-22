<template>
  <div class="system-health module-page">
    <header class="module-page-header health-header">
      <div class="module-page-title">
        <span class="module-page-icon">◎</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">SYSTEM CHECK</div>
          <h2>全模块自检</h2>
        </div>
      </div>
      <div class="module-page-actions">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadLatest">刷新</button>
        <button class="btn btn-primary btn-sm" :disabled="running" @click="runCheck">{{ running ? '自检中' : '立即自检' }}</button>
      </div>
    </header>

    <section class="health-summary" :class="statusClass">
      <div>
        <strong>{{ statusText }}</strong>
        <span>{{ checkedLabel }}</span>
      </div>
      <div class="health-counts">
        <span>正常 {{ summary.ok || 0 }}</span>
        <span>提醒 {{ summary.warn || 0 }}</span>
        <span>失败 {{ summary.fail || 0 }}</span>
      </div>
      <p>系统会每天北京时间 {{ scheduleLabel }} 自动自检一次，报告保存在本机 data/system-health。</p>
    </section>

    <section v-if="!report && !loading" class="health-empty">
      <h3>还没有自检报告</h3>
      <p>点“立即自检”先跑一份，之后每天凌晨会自动更新。</p>
    </section>

    <section v-if="loading" class="health-empty">正在读取自检报告...</section>

    <section v-if="report" class="health-grid">
      <article v-for="group in report.groups" :key="group.id" class="health-group">
        <div class="health-group-title">
          <h3>{{ groupLabel(group) }}</h3>
          <span>{{ groupSummary(group) }}</span>
        </div>
        <div class="health-checks">
          <div v-for="check in group.checks" :key="group.id + check.name" class="health-check" :class="check.status">
            <div class="health-check-main">
              <span class="health-dot"></span>
              <strong>{{ checkName(check.name) }}</strong>
              <em>{{ check.status === 'ok' ? '正常' : check.status === 'warn' ? '提醒' : '失败' }}</em>
            </div>
            <p>{{ check.message || '-' }}</p>
            <small v-if="check.durationMs !== undefined">耗时 {{ check.durationMs }}ms</small>
            <details v-if="check.hits && check.hits.length">
              <summary>查看命中日志</summary>
              <pre>{{ check.hits.join('\n') }}</pre>
            </details>
          </div>
        </div>
      </article>
    </section>

    <section class="health-history" v-if="history.length">
      <div class="health-group-title">
        <h3>最近报告</h3>
        <span>{{ history.length }} 份</span>
      </div>
      <div class="history-table">
        <div class="history-row history-head"><span>时间</span><span>触发</span><span>状态</span><span>结果</span></div>
        <div v-for="item in history" :key="item.file" class="history-row">
          <span>{{ formatTime(item.finishedAt || item.startedAt) }}</span>
          <span>{{ item.trigger === 'daily' ? '定时' : '手动' }}</span>
          <span>{{ item.status === 'ok' ? '正常' : item.status === 'warn' ? '提醒' : '失败' }}</span>
          <span>正常 {{ item.summary?.ok || 0 }} / 提醒 {{ item.summary?.warn || 0 }} / 失败 {{ item.summary?.fail || 0 }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { getSystemHealthLatest, listSystemHealthHistory, runSystemHealthCheck } from '../api/systemHealth'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()
const loading = ref(false)
const running = ref(false)
const report = ref(null)
const schedule = ref(null)
const history = ref([])

const summary = computed(() => report.value?.summary || {})
const scheduleLabel = computed(() => schedule.value?.time || report.value?.schedule?.time || '05:00')
const statusClass = computed(() => report.value?.status || 'empty')
const statusText = computed(() => {
  if (!report.value) return '等待首次自检'
  if (report.value.status === 'ok') return '全部关键项正常'
  if (report.value.status === 'warn') return '有提醒项，需要关注'
  return '发现失败项，需要处理'
})
const checkedLabel = computed(() => report.value?.finishedAt ? '最近检查：' + formatTime(report.value.finishedAt) : '尚未生成报告')

function groupLabel(group) {
  const map = { services: '服务连通', storage: '本地资产', dependencies: '依赖检查', config: '关键配置', logs: '近期日志' }
  return map[group.id] || group.label || group.id
}
function checkName(name) {
  const map = {
    'Main API 5555': '主 API 5555',
    'Next workbench 3100': '文案工作台 Next 3100',
    'Runtime data root': '运行数据目录',
    'Style library': '风格素材库',
    'Next app': 'Next 子应用目录',
    'Vite config': '前端构建配置',
    'Account library typecheck': '账号库 TypeScript',
    'Chat model config': '模型配置',
    'Volcengine ASR config': '火山 ASR 配置',
    'Feishu config': '飞书配置',
    'API error log': '主服务错误日志',
    'Next supervisor log': 'Next 监督日志',
    'Next error log': 'Next 错误日志'
  }
  return map[name] || name
}
function groupSummary(group) {
  const counts = (group.checks || []).reduce((acc, item) => {
    acc[item.status === 'fail' ? 'fail' : item.status === 'warn' ? 'warn' : 'ok'] += 1
    return acc
  }, { ok: 0, warn: 0, fail: 0 })
  return `正常 ${counts.ok} / 提醒 ${counts.warn} / 失败 ${counts.fail}`
}
function formatTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}
async function loadHistory() {
  try {
    const data = await listSystemHealthHistory(20)
    history.value = data.reports || []
  } catch (e) {
    history.value = []
  }
}
async function loadLatest() {
  loading.value = true
  try {
    const data = await getSystemHealthLatest()
    report.value = data.report || null
    schedule.value = data.schedule || null
    await loadHistory()
  } catch (e) {
    showToast?.(e.message || '读取自检报告失败', 'error')
  } finally {
    loading.value = false
  }
}
async function runCheck() {
  running.value = true
  try {
    const data = await runSystemHealthCheck()
    report.value = data.report || null
    showToast?.('自检完成', 'success')
    await loadHistory()
  } catch (e) {
    showToast?.(e.message || '自检失败', 'error')
  } finally {
    running.value = false
  }
}

onMounted(loadLatest)
</script>

<style scoped>
.system-health { display: flex; flex-direction: column; gap: 16px; }
.health-header { align-items: center; }
.health-summary, .health-empty, .health-group, .health-history {
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  border-radius: 8px;
  padding: 16px;
}
.health-summary { display: grid; grid-template-columns: minmax(180px, 1fr) auto; gap: 10px 16px; align-items: center; }
.health-summary strong { display: block; color: var(--text); font-size: 18px; }
.health-summary span, .health-summary p { color: var(--text-dim); }
.health-summary p { grid-column: 1 / -1; margin: 0; }
.health-summary.ok { border-color: var(--success-border); }
.health-summary.warn { border-color: var(--warning-border); }
.health-summary.fail { border-color: var(--danger-border); }
.health-counts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.health-counts span { border: 1px solid var(--chip-border); background: var(--chip-bg); border-radius: 999px; padding: 5px 9px; }
.health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.health-group-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
.health-group-title h3 { margin: 0; font-size: 16px; color: var(--text); }
.health-group-title span { color: var(--text-dim); font-size: 12px; }
.health-checks { display: flex; flex-direction: column; gap: 10px; }
.health-check { border: 1px solid var(--border); background: var(--row-bg); border-radius: 8px; padding: 12px; }
.health-check.ok { border-color: var(--success-border); }
.health-check.warn { border-color: var(--warning-border); }
.health-check.fail { border-color: var(--danger-border); }
.health-check-main { display: flex; align-items: center; gap: 8px; }
.health-check-main strong { color: var(--text); flex: 1; }
.health-check-main em { color: var(--text-dim); font-style: normal; font-size: 12px; }
.health-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--success-text); flex: 0 0 auto; }
.health-check.warn .health-dot { background: var(--warning-text); }
.health-check.fail .health-dot { background: #fb7185; }
.health-check p { color: var(--text-dim); margin: 8px 0 0; word-break: break-word; }
.health-check small { display: block; color: var(--text-muted); margin-top: 6px; }
.health-check pre { white-space: pre-wrap; word-break: break-word; margin-top: 8px; color: var(--text-dim); font-size: 12px; }
.history-table { display: flex; flex-direction: column; gap: 6px; }
.history-row { display: grid; grid-template-columns: 1.2fr 0.6fr 0.6fr 1.4fr; gap: 10px; padding: 8px 10px; border-radius: 6px; background: var(--row-bg); color: var(--text-dim); }
.history-head { color: var(--text); background: var(--surface2); }
@media (max-width: 760px) {
  .health-summary { grid-template-columns: 1fr; }
  .health-counts { justify-content: flex-start; }
  .history-row { grid-template-columns: 1fr; }
}
</style>
