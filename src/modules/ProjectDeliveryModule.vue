<template>
  <div class="project-delivery-module">
    <header class="module-page-header delivery-header">
      <div class="module-page-title">
        <span class="module-page-icon" aria-hidden="true">PD</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">PROJECT DELIVERY</div>
          <h2>&#39033;&#30446;&#30475;&#26495;</h2>
          <p>&#29420;&#31435;&#30340;&#39033;&#30446;&#20132;&#20184;&#35270;&#35282;&#65306;&#35745;&#21010;&#12289;&#32452;&#21035;&#12289;&#26085;&#26399;&#12289;&#32032;&#26448;&#32465;&#23450;&#12289;&#21457;&#24067;&#21644;&#25773;&#25918;&#37327;&#12290;</p>
        </div>
      </div>
      <div class="module-page-actions header-tools">
        <select v-model.number="activeProjectId" class="inp project-select" @change="loadDashboard">
          <option :value="0">&#36873;&#25321;&#39033;&#30446;</option>
          <option v-for="item in projects" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadDashboard">{{ loading ? 'Loading' : '&#21047;&#26032;' }}</button>
      </div>
    </header>

    <section class="delivery-setup">
      <div class="setup-main">
        <label class="field">
          <span>&#39033;&#30446;&#21517;&#31216;</span>
          <input v-model.trim="projectDraft.name" class="inp" placeholder="&#36870;&#27700;&#23506;&#32032;&#26448;&#20195;&#20570;" />
        </label>
        <label class="field">
          <span>&#36127;&#36131;&#20154;</span>
          <input v-model.trim="projectDraft.owner" class="inp" placeholder="&#39033;&#30446;&#36127;&#36131;&#20154;" />
        </label>
        <label class="field">
          <span>&#24320;&#22987;&#26085;&#26399;</span>
          <input v-model="projectDraft.start_date" class="inp" type="date" />
        </label>
        <label class="field">
          <span>&#32467;&#26463;&#26085;&#26399;</span>
          <input v-model="projectDraft.end_date" class="inp" type="date" />
        </label>
        <label class="field compact">
          <span>&#24635;&#26465;&#25968;</span>
          <input v-model.number="planDraft.total_count" class="inp" type="number" min="1" />
        </label>
        <label class="field compact">
          <span>&#27599;&#26085;/&#32452;</span>
          <input v-model.number="planDraft.daily_count" class="inp" type="number" min="1" />
        </label>
      </div>
      <div class="group-picker">
        <label v-for="group in groupOptions" :key="group" class="group-check">
          <input v-model="planDraft.groups" type="checkbox" :value="group" />
          <span>{{ group }}</span>
        </label>
      </div>
      <div class="setup-actions">
        <button class="btn btn-primary" :disabled="generating || !projectDraft.name || !planDraft.groups.length" @click="generatePlan">
          {{ generating ? 'Generating' : '&#20445;&#23384;&#24182;&#29983;&#25104;&#35745;&#21010;' }}
        </button>
        <span v-if="message" class="setup-message" :class="messageType">{{ message }}</span>
      </div>
    </section>

    <section class="kpi-grid">
      <article v-for="card in kpiCards" :key="card.key" class="kpi-card">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <em>{{ card.hint }}</em>
      </article>
    </section>

    <div class="delivery-grid">
      <section class="panel group-panel">
        <div class="panel-title">
          <strong>&#20845;&#32452;&#36827;&#24230;</strong>
          <span>&#35745;&#21010; / &#32032;&#26448; / &#21457;&#24067; / &#20170;&#26085;&#32570;&#21475;</span>
        </div>
        <div class="progress-table">
          <div class="progress-row progress-head">
            <span>&#32452;&#21035;</span>
            <span>&#35745;&#21010;</span>
            <span>&#32465;&#23450;</span>
            <span>&#24050;&#21457;</span>
            <span>&#20170;&#26085;</span>
            <span>&#32570;&#21475;</span>
          </div>
          <div v-for="row in summary.group_progress" :key="row.group_name" class="progress-row">
            <strong>{{ row.group_name }}</strong>
            <span>{{ row.plan }}</span>
            <span>{{ row.material_bound }}</span>
            <span>{{ row.published }}</span>
            <span>{{ row.today_done }}/{{ row.today_plan }}</span>
            <span :class="{ warn: row.gap > 0 }">{{ row.gap }}</span>
          </div>
          <div v-if="!summary.group_progress.length" class="empty-row">&#36824;&#27809;&#26377;&#29983;&#25104;&#20219;&#21153;</div>
        </div>
      </section>

      <section class="panel date-panel">
        <div class="panel-title">
          <strong>&#26085;&#26399;&#36827;&#24230;</strong>
          <span>&#25353;&#26085;&#26399;&#30475;&#21508;&#32452;&#35745;&#21010;&#21644;&#23436;&#25104;</span>
        </div>
        <div class="date-list">
          <article v-for="row in summary.date_progress" :key="row.date" class="date-item">
            <div>
              <strong>{{ row.date }}</strong>
              <span>{{ row.material_bound }}/{{ row.plan }} &#24050;&#32465;&#23450; · {{ row.published }} &#24050;&#21457;&#24067;</span>
            </div>
            <div class="date-bar"><i :style="{ width: percent(row.material_bound, row.plan) + '%' }"></i></div>
          </article>
          <div v-if="!summary.date_progress.length" class="empty-row">&#26242;&#26080;&#26085;&#26399;&#32479;&#35745;</div>
        </div>
      </section>
    </div>

    <section class="panel task-panel">
      <div class="panel-title task-title">
        <div>
          <strong>&#20219;&#21153;&#26126;&#32454;</strong>
          <span>&#25773;&#25918;&#37327;&#32479;&#35745;&#25918;&#22312;&#36825;&#37324;&#65307;&#31532;&#19968;&#29256;&#21482;&#35760;&#24405;&#26368;&#26032;&#25773;&#25918;&#37327;&#12290;</span>
        </div>
        <div class="task-filters">
          <select v-model="filters.group" class="inp">
            <option value="">&#20840;&#37096;&#32452;</option>
            <option v-for="group in groupOptions" :key="group" :value="group">{{ group }}</option>
          </select>
          <select v-model="filters.status" class="inp">
            <option value="">&#20840;&#37096;&#29366;&#24577;</option>
            <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
          <select v-model="filters.binding" class="inp">
            <option value="">&#20840;&#37096;&#32465;&#23450;</option>
            <option value="unbound">&#26410;&#32465;&#23450;</option>
            <option value="bound">&#24050;&#32465;&#23450;</option>
            <option value="publishable">&#24453;&#21457;&#24067;</option>
          </select>
        </div>
      </div>

      <div class="task-table">
        <div class="task-row task-head">
          <span>&#26085;&#26399;</span>
          <span>&#32452;&#21035; / &#36127;&#36131;&#20154;</span>
          <span>&#32032;&#26448;</span>
          <span>&#21457;&#24067;&#29366;&#24577;</span>
          <span>&#20316;&#21697;&#38142;&#25509;</span>
          <span>&#26368;&#26032;&#25773;&#25918;</span>
          <span>&#25805;&#20316;</span>
        </div>
        <div v-for="task in filteredTasks" :key="task.id" class="task-row">
          <span>{{ task.plan_date || '-' }}</span>
          <span>
            <strong>{{ task.group_name || '-' }}</strong>
            <em>{{ task.owner || '&#26410;&#20998;&#37197;' }}</em>
          </span>
          <span class="material-cell">
            <strong>{{ task.material?.original || (task.material_count ? task.material_count + ' &#20010;&#32032;&#26448;' : '&#26410;&#32465;&#23450;') }}</strong>
            <em>{{ task.material?.folder || '-' }}</em>
            <small class="bind-chip" :class="{ ok: isTaskBound(task) }">{{ isTaskBound(task) ? '&#24050;&#32465;&#23450;' : '&#26410;&#32465;&#23450;' }}</small>
          </span>
          <span>
            <select class="inp status-select" :value="task.status" @change="updateTask(task, { status: $event.target.value })">
              <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </span>
          <span>
            <input class="inp url-input" :value="task.work_url" placeholder="&#21457;&#24067;&#21518;&#20316;&#21697;&#38142;&#25509;" @change="updateTask(task, { work_url: $event.target.value })" />
          </span>
          <span>
            <input class="inp views-input" :value="task.latest_views || ''" type="number" min="0" placeholder="0" @change="refreshViews(task, $event.target.value)" />
            <em v-if="task.latest_views_at">{{ formatDate(task.latest_views_at) }}</em>
          </span>
          <span class="row-actions">
            <button v-if="!isTaskBound(task)" class="btn btn-ghost btn-sm" @click="goBindMaterial(task)">&#32465;&#32032;&#26448;</button>
            <button v-else class="btn btn-ghost btn-sm" @click="goPublishTask(task)">&#21435;&#21457;&#24067;</button>
            <button class="btn btn-ghost btn-sm" @click="markPublished(task)">&#24050;&#21457;&#24067;</button>
          </span>
        </div>
        <div v-if="!filteredTasks.length" class="empty-row">&#26242;&#26080;&#20219;&#21153;&#26126;&#32454;</div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  generateProjectDeliveryPlan,
  getProjectDeliveryDashboard,
  refreshProjectDeliveryMetrics,
  updateProjectDeliveryTask
} from '../api/projectDelivery'

const groupOptions = ['内容一部', '内容二组', '内容三组', '内容四组', '内容五组', '内容六组', 'MCN经纪组']
const statusOptions = [
  { value: 'planned', label: '待绑定' },
  { value: 'material_bound', label: '已绑定' },
  { value: 'ready', label: '待发布' },
  { value: 'published', label: '已发布' },
  { value: 'blocked', label: '异常' },
  { value: 'failed', label: '失败' }
]

const projects = ref([])
const activeProjectId = ref(0)
const activeProject = ref(null)
const tasks = ref([])
const summary = ref({
  total_plan: 0,
  material_bound: 0,
  pending: 0,
  ready: 0,
  published: 0,
  blocked: 0,
  completion_rate: 0,
  latest_views: 0,
  group_progress: [],
  date_progress: []
})
const loading = ref(false)
const generating = ref(false)
const message = ref('')
const messageType = ref('info')
const filters = reactive({ group: '', status: '', binding: '' })
const today = new Date().toISOString().slice(0, 10)

const projectDraft = reactive({
  name: '逆水寒素材代做',
  owner: '',
  start_date: today,
  end_date: today
})

const planDraft = reactive({
  total_count: 200,
  daily_count: 1,
  groups: groupOptions.slice()
})

const kpiCards = computed(() => [
  { key: 'total', label: '总计划条数', value: summary.value.total_plan || 0, hint: activeProject.value?.name || '未选择项目' },
  { key: 'bound', label: '素材已绑定', value: summary.value.material_bound || 0, hint: percent(summary.value.material_bound, summary.value.total_plan) + '%' },
  { key: 'pending', label: '待发布', value: summary.value.ready || summary.value.pending || 0, hint: '已绑定但未发布' },
  { key: 'published', label: '已发布', value: summary.value.published || 0, hint: summary.value.completion_rate + '% 完成' },
  { key: 'blocked', label: '异常', value: summary.value.blocked || 0, hint: '需要人工处理' },
  { key: 'views', label: '最新播放量', value: formatNumber(summary.value.latest_views || 0), hint: '抖音最新值 v1' }
])

const filteredTasks = computed(() => tasks.value.filter(task => {
  if (filters.group && task.group_name !== filters.group) return false
  if (filters.status && task.status !== filters.status) return false
  const bound = isTaskBound(task)
  if (filters.binding === 'bound' && !bound) return false
  if (filters.binding === 'unbound' && bound) return false
  if (filters.binding === 'publishable' && (!bound || task.status === 'published' || task.status === 'blocked' || task.status === 'failed')) return false
  return true
}))

function isTaskBound(task) {
  return Boolean(task?.material_id || task?.material_count || task?.material)
}

function taskContext(task) {
  return {
    source: 'project-delivery',
    project_id: task.project_id || activeProjectId.value || 0,
    project_name: activeProject.value?.name || '',
    task_id: task.id,
    group_name: task.group_name || '',
    owner: task.owner || '',
    plan_date: task.plan_date || '',
    title: task.title || '',
    material_id: task.material_id || task.material?.id || 0,
    material_name: task.material?.original || task.material?.filename || '',
    material_folder: task.material?.folder || ''
  }
}

function navigateModule(module, task) {
  window.dispatchEvent(new CustomEvent('usagi:navigate', {
    detail: {
      module,
      trafficContext: { projectDeliveryTask: taskContext(task) }
    }
  }))
}

function goBindMaterial(task) {
  navigateModule('material', task)
}

function goPublishTask(task) {
  navigateModule('videopublish', task)
}

function showMessage(text, type = 'info') {
  message.value = text
  messageType.value = type
  setTimeout(() => { if (message.value === text) message.value = '' }, 4000)
}

function percent(value, total) {
  const base = Number(total) || 0
  if (!base) return 0
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) / base * 100)))
}

function formatNumber(value) {
  const num = Number(value) || 0
  if (num >= 10000) return (num / 10000).toFixed(num >= 100000 ? 0 : 1) + 'w'
  return String(num)
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

async function loadDashboard() {
  loading.value = true
  try {
    const data = await getProjectDeliveryDashboard(activeProjectId.value)
    projects.value = data.projects || []
    activeProject.value = data.project || null
    tasks.value = data.tasks || []
    summary.value = data.summary || summary.value
    if (!activeProjectId.value && activeProject.value?.id) activeProjectId.value = activeProject.value.id
    if (activeProject.value) {
      projectDraft.name = activeProject.value.name || projectDraft.name
      projectDraft.owner = activeProject.value.owner || ''
      projectDraft.start_date = activeProject.value.start_date || projectDraft.start_date
      projectDraft.end_date = activeProject.value.end_date || projectDraft.end_date
      planDraft.total_count = activeProject.value.total_plan || planDraft.total_count
    }
  } catch (e) {
    showMessage('加载项目看板失败: ' + e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function generatePlan() {
  generating.value = true
  try {
    const data = await generateProjectDeliveryPlan({
      project_id: activeProjectId.value || undefined,
      name: projectDraft.name,
      owner: projectDraft.owner,
      start_date: projectDraft.start_date,
      end_date: projectDraft.end_date,
      total_count: planDraft.total_count,
      daily_count: planDraft.daily_count,
      groups: planDraft.groups
    })
    activeProjectId.value = data.project_id || activeProjectId.value
    showMessage('已生成 ' + (data.created || 0) + ' 条任务', 'success')
    await loadDashboard()
  } catch (e) {
    showMessage('生成计划失败: ' + e.message, 'error')
  } finally {
    generating.value = false
  }
}

async function updateTask(task, patch) {
  try {
    await updateProjectDeliveryTask({ id: task.id, ...patch })
    Object.assign(task, patch)
    await loadDashboard()
  } catch (e) {
    showMessage('更新任务失败: ' + e.message, 'error')
  }
}

async function refreshViews(task, value) {
  try {
    await refreshProjectDeliveryMetrics({
      project_id: task.project_id,
      task_id: task.id,
      work_url: task.work_url,
      latest_views: Number(value) || 0
    })
    await loadDashboard()
  } catch (e) {
    showMessage('播放量回填失败: ' + e.message, 'error')
  }
}

async function markPublished(task) {
  await updateTask(task, { status: 'published', publish_status: 'published' })
}

onMounted(loadDashboard)
</script>

<style scoped>
.project-delivery-module {
  min-height: 100%;
  padding: 18px;
  color: var(--text);
}

.delivery-header {
  margin-bottom: 14px;
}

.module-page-icon {
  font-size: 13px;
  font-weight: 900;
}

.module-page-copy p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.header-tools {
  display: flex;
  gap: 8px;
  align-items: center;
}

.project-select {
  min-width: 220px;
}

.delivery-setup,
.panel,
.kpi-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(8, 14, 28, 0.78);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
}

.delivery-setup {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 8px;
  margin-bottom: 14px;
}

.setup-main {
  display: grid;
  grid-template-columns: 1.4fr 0.9fr repeat(2, 0.9fr) 0.55fr 0.55fr;
  gap: 10px;
}

.field {
  display: grid;
  gap: 5px;
}

.field span,
.panel-title span,
.kpi-card span,
.kpi-card em,
.task-row em {
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.group-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.group-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
}

.setup-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.setup-message.success {
  color: #34d399;
}

.setup-message.error,
.warn {
  color: #fb7185;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.kpi-card {
  display: grid;
  gap: 5px;
  padding: 12px;
  border-radius: 8px;
}

.kpi-card strong {
  font-size: 24px;
}

.delivery-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: 14px;
  margin-bottom: 14px;
}

.panel {
  border-radius: 8px;
  padding: 14px;
}

.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.progress-table,
.task-table,
.date-list {
  display: grid;
  gap: 6px;
}

.progress-row {
  display: grid;
  grid-template-columns: 1.2fr repeat(5, 0.7fr);
  align-items: center;
  gap: 8px;
  padding: 8px 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
}

.progress-head,
.task-head {
  color: var(--text-muted);
  font-size: 12px;
  background: rgba(255, 255, 255, 0.07);
}

.date-item {
  display: grid;
  gap: 8px;
  padding: 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
}

.date-item > div:first-child {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.date-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}

.date-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #38bdf8);
}

.task-title {
  align-items: flex-end;
}

.task-filters {
  display: flex;
  gap: 8px;
}

.task-row {
  display: grid;
  grid-template-columns: 90px 130px minmax(180px, 1.5fr) 120px minmax(180px, 1.2fr) 120px 148px;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.035);
}

.task-row > span {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.material-cell strong,
.material-cell em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bind-chip {
  width: max-content;
  padding: 2px 7px;
  border: 1px solid rgba(251, 113, 133, 0.35);
  border-radius: 999px;
  color: #fb7185;
  background: rgba(251, 113, 133, 0.08);
  font-size: 11px;
}

.bind-chip.ok {
  border-color: rgba(52, 211, 153, 0.35);
  color: #34d399;
  background: rgba(52, 211, 153, 0.08);
}

.status-select,
.views-input,
.url-input {
  width: 100%;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.empty-row {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
}

@media (max-width: 1180px) {
  .setup-main,
  .delivery-grid,
  .kpi-grid {
    grid-template-columns: 1fr 1fr;
  }

  .task-row {
    grid-template-columns: 90px 130px minmax(180px, 1fr) 120px;
  }
}
</style>
