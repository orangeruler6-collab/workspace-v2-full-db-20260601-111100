<template>
  <div class="feedback-module">
    <header class="module-page-header feedback-head">
      <div class="module-page-title">
        <span class="module-page-icon">✦</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">FEEDBACK HUB</div>
          <h2>意见收集</h2>
        </div>
      </div>
      <div class="module-page-actions feedback-actions">
        <span class="module-page-pill">{{ items.length }} 条反馈</span>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadItems">刷新</button>
      </div>
    </header>

    <div class="feedback-layout">
      <section class="feedback-panel submit-panel">
        <div class="panel-title">
          <strong>提交新意见</strong>
          <span>页面问题、交互建议、功能想法都可以放这里。</span>
        </div>

        <label class="field">
          <span>标题</span>
          <input v-model.trim="form.title" class="inp" maxlength="80" placeholder="一句话说明问题或建议" />
        </label>

        <label class="field">
          <span>关联模块</span>
          <select v-model="form.module" class="inp">
            <option value="">暂不指定</option>
            <option v-for="module in moduleOptions" :key="module.id" :value="module.id">{{ module.label }}</option>
          </select>
        </label>

        <label class="field">
          <span>优先级</span>
          <select v-model="form.priority" class="inp">
            <option value="normal">普通</option>
            <option value="high">重要</option>
            <option value="urgent">紧急</option>
            <option value="low">低优先级</option>
          </select>
        </label>

        <label class="field">
          <span>具体说明</span>
          <textarea v-model.trim="form.content" class="inp feedback-textarea" rows="7" placeholder="尽量写清楚：在哪个页面、点了什么、期望是什么、现在是什么。"></textarea>
        </label>

        <label class="screenshot-box" :class="{ active: screenshotName }">
          <input type="file" accept="image/*" hidden @change="handleScreenshot" />
          <span>{{ screenshotName ? '已选择截图' : '上传截图' }}</span>
          <strong>{{ screenshotName || '点击选择一张图片' }}</strong>
          <small>支持 png/jpg/webp，建议小于 8MB。</small>
        </label>

        <button class="btn btn-primary submit-btn" :disabled="submitting" @click="submitFeedback">
          {{ submitting ? '提交中...' : '提交意见' }}
        </button>
      </section>

      <section class="feedback-panel board-panel">
        <div class="filter-bar">
          <input v-model.trim="filters.keyword" class="inp" placeholder="搜索标题 / 内容 / 用户" @keyup.enter="loadItems" />
          <select v-model="filters.status" class="inp" @change="loadItems">
            <option value="">全部状态</option>
            <option value="open">新反馈</option>
            <option value="reviewing">评估中</option>
            <option value="doing">处理中</option>
            <option value="done">已完成</option>
            <option value="closed">已关闭</option>
          </select>
          <select v-model="filters.module" class="inp" @change="loadItems">
            <option value="">全部模块</option>
            <option v-for="module in moduleOptions" :key="module.id" :value="module.id">{{ module.label }}</option>
          </select>
          <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadItems">筛选</button>
        </div>

        <div v-if="loading" class="empty-state">正在读取反馈...</div>
        <div v-else-if="!items.length" class="empty-state">暂时还没有反馈，第一条就从这里开始。</div>
        <div v-else class="feedback-grid">
          <article v-for="item in items" :key="item.id" class="feedback-card" :class="['priority-' + item.priority, 'status-' + item.status]">
            <div class="card-top">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ item.reporter?.display_name || item.reporter?.username || '匿名用户' }} · {{ formatTime(item.created_at) }}</span>
              </div>
              <em>{{ statusLabel(item.status) }}</em>
            </div>

            <p>{{ item.content }}</p>

            <img v-if="item.screenshot_url" class="screenshot-preview" :src="item.screenshot_url" alt="反馈截图" />

            <div class="meta-row">
              <span>{{ moduleLabel(item.module) }}</span>
              <span>{{ priorityLabel(item.priority) }}</span>
              <span v-if="item.reporter?.group_name">{{ item.reporter.group_name }}</span>
            </div>

            <div class="card-admin">
              <select v-model="item.status" class="inp mini" @change="saveItem(item)">
                <option value="open">新反馈</option>
                <option value="reviewing">评估中</option>
                <option value="doing">处理中</option>
                <option value="done">已完成</option>
                <option value="closed">已关闭</option>
              </select>
              <select v-model="item.priority" class="inp mini" @change="saveItem(item)">
                <option value="low">低</option>
                <option value="normal">普通</option>
                <option value="high">重要</option>
                <option value="urgent">紧急</option>
              </select>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { createFeedback, fileToImagePayload, listFeedback, updateFeedback } from '../api/feedback'
import { getCurrentAuthUser } from '../api/client'
import { MODULE_DEFINITIONS, flattenModuleDefinitions } from '../permissions'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()
const currentUser = getCurrentAuthUser()
const items = ref([])
const loading = ref(false)
const submitting = ref(false)
const screenshotFile = ref(null)
const screenshotName = ref('')

const form = reactive({
  title: '',
  module: '',
  priority: 'normal',
  content: ''
})

const filters = reactive({
  keyword: '',
  status: '',
  module: ''
})

const moduleOptions = computed(() => flattenModuleDefinitions(MODULE_DEFINITIONS).filter(item => !item.adminOnly))
const moduleMap = computed(() => Object.fromEntries(moduleOptions.value.map(item => [item.id, item.label])))

function moduleLabel(id) {
  return moduleMap.value[id] || '未指定模块'
}

function priorityLabel(value) {
  return { low: '低优先级', normal: '普通', high: '重要', urgent: '紧急' }[value] || '普通'
}

function statusLabel(value) {
  return { open: '新反馈', reviewing: '评估中', doing: '处理中', done: '已完成', closed: '已关闭' }[value] || '新反馈'
}

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function handleScreenshot(event) {
  const file = event.target.files?.[0]
  screenshotFile.value = file || null
  screenshotName.value = file?.name || ''
}

async function loadItems() {
  loading.value = true
  try {
    const data = await listFeedback({
      keyword: filters.keyword,
      status: filters.status,
      module: filters.module,
      limit: 120
    })
    items.value = data.items || []
  } catch (e) {
    showToast('反馈加载失败：' + (e.message || '未知错误'), 'error')
  } finally {
    loading.value = false
  }
}

async function submitFeedback() {
  if (!form.title || !form.content) {
    showToast('请先填写标题和具体说明', 'warning')
    return
  }
  submitting.value = true
  try {
    const imagePayload = await fileToImagePayload(screenshotFile.value)
    await createFeedback({
      title: form.title,
      content: form.content,
      module: form.module,
      priority: form.priority,
      ...imagePayload
    })
    form.title = ''
    form.content = ''
    form.module = ''
    form.priority = 'normal'
    screenshotFile.value = null
    screenshotName.value = ''
    showToast(`意见已提交，感谢 ${currentUser?.display_name || currentUser?.username || '你'} 的反馈`, 'success')
    await loadItems()
  } catch (e) {
    showToast('提交失败：' + (e.message || '未知错误'), 'error')
  } finally {
    submitting.value = false
  }
}

async function saveItem(item) {
  try {
    await updateFeedback({
      id: item.id,
      status: item.status,
      priority: item.priority,
      assignee: item.assignee || '',
      reply: item.reply || ''
    })
    showToast('反馈状态已更新', 'success')
  } catch (e) {
    showToast('更新失败：' + (e.message || '未知错误'), 'error')
  }
}

onMounted(loadItems)
</script>

<style scoped>
.feedback-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.feedback-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.feedback-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.feedback-layout {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 14px;
  overflow: hidden;
}

.feedback-panel {
  min-height: 0;
  border: 1px solid var(--card-border, var(--border));
  border-radius: 14px;
  background:
    radial-gradient(circle at top left, rgba(255, 216, 79, .16), transparent 34%),
    var(--card-bg, var(--panel-bg));
  box-shadow: var(--shadow);
}

.submit-panel {
  padding: 16px;
  overflow: auto;
}

.board-panel {
  padding: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-title {
  margin-bottom: 14px;
}

.panel-title strong,
.panel-title span {
  display: block;
}

.panel-title strong {
  color: var(--text);
  font-size: 16px;
  font-weight: 900;
}

.panel-title span {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.field {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.field > span {
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 800;
}

.feedback-textarea {
  resize: vertical;
  min-height: 150px;
}

.screenshot-box {
  display: grid;
  gap: 4px;
  margin: 8px 0 12px;
  padding: 14px;
  border: 1px dashed var(--border-mid);
  border-radius: 12px;
  background: var(--panel-bg-soft);
  cursor: pointer;
}

.screenshot-box.active {
  border-color: var(--success-border);
  background: var(--success-bg);
}

.screenshot-box span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.screenshot-box strong {
  color: var(--text);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.screenshot-box small {
  color: var(--text-muted);
  font-size: 11px;
}

.submit-btn {
  width: 100%;
}

.filter-bar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 130px 150px auto;
  gap: 8px;
}

.empty-state {
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 220px;
  border: 1px dashed var(--border-mid);
  border-radius: 12px;
  color: var(--text-muted);
  background: var(--panel-bg-soft);
}

.feedback-grid {
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  padding-right: 4px;
}

.feedback-card {
  display: grid;
  gap: 10px;
  padding: 13px;
  border: 1px solid var(--chip-border);
  border-radius: 13px;
  background: var(--panel-bg-soft);
}

.feedback-card.priority-urgent {
  border-color: var(--danger-border, #fca5a5);
}

.feedback-card.priority-high {
  border-color: var(--warning-border, #facc15);
}

.card-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}

.card-top strong,
.card-top span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-top strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 900;
}

.card-top span {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.card-top em {
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--success-text);
  background: var(--success-bg);
  font-size: 11px;
  font-style: normal;
  font-weight: 900;
}

.feedback-card.status-done .card-top em,
.feedback-card.status-closed .card-top em {
  color: var(--text-muted);
  background: var(--chip-bg);
}

.feedback-card p {
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.screenshot-preview {
  width: 100%;
  max-height: 190px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--chip-border);
}

.meta-row,
.card-admin {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.meta-row span {
  padding: 3px 7px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--chip-bg);
  font-size: 11px;
  font-weight: 800;
}

.card-admin .mini {
  width: auto;
  min-width: 92px;
  height: 30px;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .feedback-layout {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .board-panel {
    min-height: 520px;
  }
}

@media (max-width: 760px) {
  .filter-bar {
    grid-template-columns: 1fr;
  }
}
</style>
