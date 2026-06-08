<template>
  <div class="project-agent-module">
    <header class="module-page-header agent-header">
      <div class="module-page-title">
        <span class="module-page-icon module-page-image-icon" aria-hidden="true">
          <img :src="agentHappyImage" alt="" />
        </span>
        <div class="module-page-copy">
          <div class="module-page-kicker">USAGI AGENT</div>
          <h2>项目助手</h2>
          <p>一个自由聊天入口，可以转写链接、读取飞书、查资料、做 BF 分析、周报和项目复盘。</p>
        </div>
      </div>
      <div class="agent-header-status">
        <span :class="['agent-dot', running ? 'busy' : 'ready']"></span>
        <span>{{ running ? '处理中' : '待命中' }}</span>
      </div>
    </header>

    <section class="agent-shell">
      <main class="agent-chat" :class="{ 'attachment-dragging': attachmentDragging }">
        <div class="agent-mode-row" role="radiogroup" aria-label="Agent 模式">
          <button
            v-for="mode in agentModes"
            :key="mode.id"
            type="button"
            class="agent-mode"
            :class="{ active: agentMode === mode.id }"
            :title="mode.hint"
            @click="agentMode = mode.id">
            <span class="agent-mode-icon">{{ mode.icon }}</span>
            {{ mode.label }}
          </button>
        </div>
        <div class="agent-prompt-row">
          <button
            v-for="chip in promptChips"
            :key="chip.type"
            type="button"
            class="agent-chip"
            @click="applyChip(chip)">
              <span class="agent-chip-icon">{{ chip.icon }}</span>
              {{ chip.label }}
          </button>
          <button type="button" class="agent-chip weekly-toggle-chip" :class="{ active: weeklyOpen }" @click="weeklyOpen = !weeklyOpen">
            <span class="agent-chip-icon">周</span>
            写周报
          </button>
        </div>

        <section v-if="weeklyOpen" class="weekly-card weekly-dialog-card">
          <div class="weekly-card-head">
            <div>
              <strong>写周报</strong>
              <span>我会按登录状态识别小组，周期固定取上周；生成前先让你确认。</span>
            </div>
            <div class="weekly-head-actions">
              <button class="btn btn-ghost btn-sm" type="button" @click="weeklyOpen = false">收起</button>
            </div>
          </div>
          <div class="weekly-dialog">
            <div class="weekly-dialog-bubble assistant">
              <strong>先确认这版周报口径：</strong>
              <span>小组按当前登录账号归属，周期固定为上周。补充项可以空着，我会先用流水和排期自动填表。</span>
            </div>
            <div class="weekly-confirm-grid">
              <div>
                <span>小组</span>
                <strong>{{ weeklyResolvedGroup }}</strong>
              </div>
              <div>
                <span>周期</span>
                <strong>{{ weeklyRangeText }}</strong>
              </div>
              <div>
                <span>输出</span>
                <strong>Word + 飞书</strong>
              </div>
            </div>
            <details class="weekly-dialog-details">
              <summary>需要补充正文内容时点这里</summary>
              <label class="weekly-field">
                <span>本月业绩情况</span>
                <textarea v-model="weeklyForm.performanceText" class="inp" rows="2" placeholder="可空，空着会保留填写位置。"></textarea>
              </label>
              <label class="weekly-field">
                <span>落地项推进进度</span>
                <textarea v-model="weeklyForm.landingText" class="inp" rows="2" placeholder="可空，空着会保留填写位置。"></textarea>
              </label>
              <label class="weekly-field">
                <span>账号数据总结</span>
                <textarea v-model="weeklyForm.summaryText" class="inp" rows="3" placeholder="可空，空着会根据排期生成基础总结。"></textarea>
              </label>
              <label class="weekly-field">
                <span>当周计划补充</span>
                <textarea v-model="weeklyForm.nextPlansText" class="inp" rows="3" placeholder="可空，不填就从排期看板取后续任务。"></textarea>
              </label>
            </details>
            <div v-if="weeklyJob?.status === 'failed'" class="weekly-inline-error">
              {{ weeklyJob.error || weeklyJob.message || '周报生成失败' }}
            </div>
            <div class="weekly-actions">
              <button class="btn btn-primary" type="button" :disabled="weeklyRunning" @click="startWeekly">
                {{ weeklyRunning ? '生成中...' : (weeklyJob?.report ? '按这个口径重新生成' : '确认，生成上周周报') }}
              </button>
              <button class="btn btn-ghost" type="button" :disabled="weeklyRunning" @click="clearWeeklySupplement">清空补充</button>
            </div>
          </div>
          <div v-if="weeklyJob" class="weekly-status-strip" :class="weeklyJob.status">
            <div class="weekly-status-copy">
              <strong>{{ weeklyStatusTitle }}</strong>
              <span>{{ weeklyStatusDetail }}</span>
            </div>
            <div v-if="weeklyJob?.report" class="weekly-status-actions">
              <a v-if="weeklyJob.report.feishu_url" class="btn btn-primary btn-sm" :href="weeklyJob.report.feishu_url" target="_blank" rel="noreferrer">打开飞书</a>
              <button v-if="weeklyJob.report.word_url" class="btn btn-ghost btn-sm" type="button" @click="downloadWeeklyDoc">下载 Word</button>
              <button class="btn btn-ghost btn-sm" type="button" @click="sendWeeklyToChat">放入对话</button>
            </div>
          </div>
          <div class="weekly-form">
            <div v-if="weeklyReports.length" class="weekly-history">
              <div class="weekly-history-head">
                <strong>周报留存</strong>
                <button class="mini-link" type="button" @click="loadWeeklyReports">刷新</button>
              </div>
              <button
                v-for="report in weeklyReports.slice(0, 5)"
                :key="report.id"
                type="button"
                class="weekly-history-row"
                @click="openWeeklyRecord(report)">
                <span>{{ report.title || report.group_name }}</span>
                <small>{{ report.range_start }} 至 {{ report.range_end }} · {{ report.leader_name || '组长' }}</small>
              </button>
            </div>
            <div v-if="weeklyJob" class="weekly-progress">
              <div class="weekly-progress-top">
                <strong>{{ weeklyJob.message || '处理中' }}</strong>
                <span>{{ weeklyJob.progress || 0 }}%</span>
              </div>
              <div class="weekly-bar"><i :style="{ width: (weeklyJob.progress || 0) + '%' }"></i></div>
              <div v-if="weeklyJob.account_progress" class="weekly-account-now">
                正在处理账号 {{ weeklyJob.account_progress.current }}/{{ weeklyJob.account_progress.total }}：{{ weeklyJob.account_progress.name }}
              </div>
              <div v-if="weeklyJob.account_results?.length" class="weekly-account-list">
                <div v-for="item in weeklyJob.account_results" :key="item.url || item.name" class="weekly-account-row" :class="item.status">
                  <strong>{{ item.name }}</strong>
                  <span>{{ item.platform }} · 粉丝 {{ item.fans || '待补' }} · 获赞 {{ item.likes || '待补' }}</span>
                  <small v-if="item.error">{{ item.error }}</small>
                </div>
              </div>
              <pre v-if="weeklyJob.report?.text" class="weekly-preview">{{ weeklyJob.report.text }}</pre>
            </div>
          </div>
        </section>

        <div ref="chatBodyRef" class="agent-chat-body" @scroll="handleChatScroll">
          <article class="agent-message assistant intro-message">
            <div class="agent-avatar usagi-agent-avatar">
              <img :src="agentHappyImage" alt="" />
            </div>
            <div class="agent-bubble">
              <strong>乌萨奇在岗，今天先拆哪一团？</strong>
              <p>直接贴抖音、B站、飞书链接，或者说“按内容二组格式生成本周周报并给我飞书”。我会自己调工具、写飞书，最后把链接和数据源交代清楚。</p>
            </div>
          </article>

          <article
            v-for="message in messages"
            :key="message.id"
            class="agent-message"
            :class="message.role">
            <div class="agent-avatar" :class="{ 'usagi-agent-avatar': message.role !== 'user' }">
              <template v-if="message.role === 'user'">你</template>
              <img v-else :src="agentIdleImage" alt="" />
            </div>
            <div class="agent-bubble">
              <div class="agent-message-meta">{{ message.role === 'user' ? '你' : '项目助手' }}</div>
              <div v-if="message.pending" class="inline-thinking">
                <span></span><span></span><span></span>
                <em>{{ runningLabel }}</em>
              </div>
              <div v-else class="agent-markdown">{{ message.content }}</div>
              <div v-if="!message.pending && message.files?.length" class="agent-file-list">
                <button
                  v-for="file in message.files"
                  :key="file.url || file.name"
                  type="button"
                  class="agent-file-card"
                  @click="downloadAgentFile(file)">
                  <span class="agent-file-icon">文</span>
                  <span class="agent-file-main">
                    <strong>{{ file.name }}</strong>
                    <small>{{ file.hint || '点击下载 Word 文档' }}</small>
                  </span>
                </button>
              </div>
            </div>
          </article>

          <article v-if="running && !messages.some(item => item.role === 'assistant' && !String(item.content || '').trim())" class="agent-message assistant">
            <div class="agent-avatar usagi-agent-avatar is-busy">
              <img :src="agentSignImage" alt="" />
            </div>
            <div class="agent-bubble typing-bubble">
              <span></span><span></span><span></span>
              <em>{{ runningLabel }}</em>
            </div>
          </article>
        </div>

        <footer
          class="agent-composer"
          @dragenter.prevent="handleAttachmentDragEnter"
          @dragover.prevent="attachmentDragging = true"
          @dragleave.prevent="handleAttachmentDragLeave"
          @drop.prevent="handleAttachmentDrop">
          <div v-if="attachments.length || attachmentError" class="agent-attachment-tray">
            <div
              v-for="file in attachments"
              :key="file.id"
              class="agent-attachment"
              :class="{ parsing: file.status === 'parsing', failed: file.status === 'failed' }">
              <span class="attachment-icon">{{ file.kind === 'image' ? '图' : '文' }}</span>
              <span class="attachment-main">
                <strong>{{ file.name }}</strong>
                <small>{{ attachmentMeta(file) }}</small>
              </span>
              <button class="attachment-remove" type="button" title="移除附件" @click="removeAttachment(file.id)">×</button>
            </div>
            <div v-if="attachmentError" class="attachment-error">{{ attachmentError }}</div>
          </div>
          <textarea
            v-model="input"
            class="agent-input"
            rows="4"
            placeholder="贴链接，或者输入：读取这个飞书 BF 并分析 / 按内容二组格式生成本周周报 / 复盘一下这个项目"
            @keydown.enter.exact.prevent="sendMessage"></textarea>
          <input ref="attachmentInputRef" class="agent-file-input" type="file" multiple :accept="acceptedAttachmentTypes" @change="handleAttachmentSelect" />
          <div class="agent-composer-actions">
            <button class="btn btn-ghost btn-sm" type="button" @click="openAttachmentPicker" :disabled="running || attachmentParsing">
              {{ attachmentParsing ? '解析中' : '附件' }}
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="previewTools" :disabled="running || !canSend">预览工具</button>
            <button v-if="running" class="btn btn-ghost btn-sm" type="button" @click="stopStreaming">停止</button>
            <button class="btn btn-primary" type="button" @click="sendMessage" :disabled="running || !canSend">
              {{ running ? '运行中...' : '发送' }}
            </button>
          </div>
          <div v-if="attachmentDragging" class="agent-drop-overlay">
            <strong>松手导入文件或图片</strong>
            <span>支持 PDF / DOCX / PNG / JPG / WEBP，解析后会作为本轮对话上下文</span>
          </div>
        </footer>
      </main>

      <aside class="agent-side">
        <section class="agent-panel">
          <div class="agent-panel-head">
            <strong>任务状态</strong>
            <span>{{ currentTaskLabel }} · {{ currentAgentModeLabel }}</span>
          </div>
          <div v-if="!toolSteps.length" class="agent-empty">还没有调用工具</div>
          <div v-else class="tool-list">
            <div v-for="tool in toolSteps" :key="tool.id + tool.label" class="tool-row" :class="tool.status">
              <span class="tool-status">{{ statusIcon(tool.status) }}</span>
              <div>
                <strong>{{ tool.label }}</strong>
                <small>{{ tool.detail || statusText(tool.status) }}</small>
              </div>
            </div>
          </div>
        </section>

        <section class="agent-panel">
          <div class="agent-panel-head">
            <strong>引用数据源</strong>
            <span>{{ sources.length }}</span>
          </div>
          <div v-if="!sources.length" class="agent-empty">生成时会显示来源</div>
          <div v-else class="source-list">
            <div v-for="source in sources" :key="source.route + source.label" class="source-row">
              <span>{{ source.label }}</span>
              <small>{{ source.summary }}</small>
            </div>
          </div>
        </section>

        <section class="agent-panel draft-panel">
          <div class="agent-panel-head">
            <strong>会话</strong>
            <button class="mini-link" type="button" @click="newConversation">新建</button>
          </div>
          <div v-if="lastDraft" class="current-draft">
            <input
              class="session-title-input"
              v-model="sessionTitle"
              :disabled="renamingDraft"
              @blur="renameCurrentDraft"
              @keydown.enter.prevent="renameCurrentDraft" />
            <small>会话 #{{ lastDraft.id }} · {{ currentSessionMeta }}</small>
            <div class="draft-actions">
              <button class="btn btn-ghost btn-sm" type="button" @click="copyLastReply" :disabled="!lastReply">复制</button>
              <button class="btn btn-ghost btn-sm" type="button" @click="renameCurrentDraft" :disabled="renamingDraft">命名</button>
            </div>
            <a v-if="feishuUrl" class="feishu-link" :href="feishuUrl" target="_blank" rel="noreferrer">打开飞书文档</a>
          </div>
          <div v-if="drafts.length" class="draft-list">
            <div
              v-for="draft in drafts"
              :key="draft.id"
              class="draft-row"
              :class="{ active: lastDraft?.id === draft.id }">
              <button type="button" class="draft-open" @click="openDraft(draft)">
                <span>{{ draft.title || draft.task_type }}</span>
                <small>#{{ draft.id }} · {{ formatTime(draft.updated_at || draft.created_at) }} · {{ draftSessionMeta(draft) }}</small>
              </button>
              <button
                type="button"
                class="draft-delete"
                title="删除会话"
                :disabled="deletingDraftIds.has(draft.id)"
                @click.stop="deleteDraft(draft)">
                {{ deletingDraftIds.has(draft.id) ? '...' : '×' }}
              </button>
            </div>
          </div>
          <div v-else class="agent-empty">暂无历史会话</div>
        </section>
      </aside>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { chatAgentStream, deleteAgentDraft, getWeeklyReport, getWeeklyReportJob, listAgentDrafts, listWeeklyReports, previewAgentTools, saveAgentDraft, startWeeklyReport, updateAgentDraft, writeAgentFeishu } from '../api/agent'
import { getCurrentAuthUser } from '../api/client'
import { parseWorkflowDocument } from '../api/tools'
import { useConfirm } from '../composables/useConfirm'
import { useToast } from '../composables/useToast'
import agentHappyImage from '../assets/usagi-pet-states/happy.png'
import agentIdleImage from '../assets/usagi-pet-states/idle.png'
import agentSignImage from '../assets/usagi-pet-states/sign.png'

const promptChips = [
  { type: 'transcribe_link', icon: '链', label: '转写', prompt: '帮我转写并整理这个链接：' },
  { type: 'read_link', icon: '读', label: '读链接', prompt: '读取这个抖音/B站链接，提取文案和可复用结构：' },
  { type: 'bf_analysis', icon: 'BF', label: 'BF', prompt: '读取这个飞书 BF 并分析客户诉求、卖点、内容角度和风险：' },
  { type: 'weekly_report', icon: '周', label: '周报', prompt: '按内容二组格式生成本周周报，包含营收、账号数据、工时、计划和风险：' },
  { type: 'project_review', icon: '盘', label: '复盘', prompt: '复盘这个项目这周的问题、进展、数据表现和下周动作：' },
  { type: 'free_writing', icon: '写', label: '写作', prompt: '帮我写一版：' },
  { type: 'research', icon: '查', label: '查资料', prompt: '帮我查资料并整理成可用于文案/复盘的要点：' }
]

const agentModes = [
  { id: 'auto', icon: '自', label: '自动', hint: '日常推荐：乌萨奇自己判断用平台工具还是深度分析' },
  { id: 'platform', icon: '数', label: '平台', hint: '只读网页已有数据和工具，不额外做 Codex 长分析' },
  { id: 'codex', icon: '深', label: '深度', hint: '强制加一轮 Codex 长分析，适合复杂复盘、周报、方案诊断' }
]

const taskLabels = {
  transcribe_link: '链接转写',
  read_feishu: '飞书读取',
  bf_analysis: 'BF 分析',
  weekly_report: '周报生成',
  project_review: '项目复盘',
  research: '资料整理',
  free_writing: '自由写作'
}

const input = ref('')
const messages = ref([])
const running = ref(false)
const runningLabel = ref('正在理解需求')
const toolSteps = ref([])
const sources = ref([])
const drafts = ref([])
const lastDraft = ref(null)
const lastReply = ref('')
const feishuUrl = ref('')
const currentTask = ref('')
const agentMode = ref('auto')
const renamingDraft = ref(false)
const sessionTitle = ref('')
const chatBodyRef = ref(null)
const attachmentInputRef = ref(null)
const askConfirm = useConfirm()
const { showToast } = useToast()
const autoScroll = ref(true)
const attachments = ref([])
const attachmentDragging = ref(false)
const attachmentDragDepth = ref(0)
const attachmentError = ref('')
const acceptedAttachmentTypes = '.pdf,.docx,.doc,.png,.jpg,.jpeg,.webp,.gif,.bmp,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const weeklyOpen = ref(false)
const weeklyRunning = ref(false)
const weeklyJob = ref(null)
const weeklyReports = ref([])
const weeklyTimer = ref(null)
const streamController = ref(null)
const deletingDraftIds = ref(new Set())
const weeklyGroups = ['内容一组', '内容二组', '内容三组', '内容四组', '内容五组', '内容六组']
const weeklyGroupIds = {
  '内容一组': 1,
  '内容二组': 2,
  '内容三组': 3,
  '内容四组': 4,
  '内容五组': 5,
  '内容六组': 6
}
const weeklyGroupTargets = {
  4: 100200
}
const weeklyForm = ref({
  group: '内容二组',
  start: '',
  end: '',
  accountsText: '',
  performanceText: '',
  landingText: '',
  summaryText: '',
  nextPlansText: ''
})

function currentAuthSignature() {
  const user = getCurrentAuthUser() || {}
  return String(user.id || user.username || user.display_name || 'anonymous')
}

function lastDraftStorageKey() {
  return `usagi_project_agent_last_draft:${currentAuthSignature()}`
}

function rememberCurrentDraft(draft) {
  if (!draft?.id) return
  try {
    localStorage.setItem(lastDraftStorageKey(), String(draft.id))
  } catch (e) {}
}

function forgetCurrentDraft(draftId) {
  try {
    const key = lastDraftStorageKey()
    if (!draftId || localStorage.getItem(key) === String(draftId)) {
      localStorage.removeItem(key)
    }
  } catch (e) {}
}

const currentTaskLabel = computed(() => currentTask.value === 'outline_writing' ? '大纲写作' : (taskLabels[currentTask.value] || '自由对话'))
const currentAgentModeLabel = computed(() => agentModes.find(item => item.id === agentMode.value)?.label || '自动')
const conversationCount = computed(() => messages.value.filter(item => item.role === 'user' || item.role === 'assistant').length)
const currentSessionMeta = computed(() => draftSessionMeta(lastDraft.value, conversationCount.value))
const attachmentParsing = computed(() => attachments.value.some(item => item.status === 'parsing'))
const readyAttachments = computed(() => attachments.value.filter(item => item.status === 'ready' && item.text))
const canSend = computed(() => Boolean(input.value.trim() || readyAttachments.value.length) && !attachmentParsing.value)
const weeklyStatusTitle = computed(() => {
  const status = weeklyJob.value?.status || ''
  if (status === 'done') return '周报已生成'
  if (status === 'failed') return '周报生成失败'
  if (weeklyRunning.value) return '周报生成中'
  return weeklyJob.value?.message || '周报状态'
})
const weeklyStatusDetail = computed(() => {
  const job = weeklyJob.value || {}
  if (job.status === 'failed') return job.error || job.message || '请稍后重试'
  if (job.status === 'done') {
    const report = job.report || {}
    return `${report.title || '文件已生成'}${report.feishu_url ? '，飞书链接已返回' : ''}`
  }
  const progress = Number(job.progress || 0)
  return `${job.message || '正在处理'}${progress ? `，进度 ${progress}%` : ''}`
})
const weeklyResolvedGroup = computed(() => resolveWeeklyGroup())
const weeklyRangeText = computed(() => {
  const range = defaultWeeklyRange()
  return `${range.start} 至 ${range.end}`
})

function wantsFeishuOutput(text) {
  const source = String(text || '').toLowerCase()
  return /(飞书|feishu|lark)/i.test(source) && /(写入|同步|保存|导出|发我|发给我|给我|链接|文档|doc|docx)/i.test(source)
}

function draftSessionMeta(draft, visibleCount) {
  const rawCount = Number(draft?.message_count || 0)
  const visible = Number(visibleCount || 0) || (Array.isArray(draft?.messages) ? draft.messages.length : 0) || 0
  const count = Math.max(rawCount, visible, 0)
  const prefix = count ? `${count} 条上下文` : '新会话'
  return draft?.summary ? `${prefix} · 已压缩` : prefix
}

function applyChip(chip) {
  input.value = chip.prompt
  currentTask.value = chip.type === 'read_link' ? 'transcribe_link' : chip.type
}

function statusIcon(status) {
  if (status === 'done') return 'OK'
  if (status === 'failed') return '!'
  if (status === 'skipped') return '-'
  return '...'
}

function statusText(status) {
  if (status === 'done') return '完成'
  if (status === 'failed') return '失败'
  if (status === 'skipped') return '已跳过'
  return '运行中'
}

function scrollToBottom(force = false) {
  if (!force && !autoScroll.value) return
  nextTick(() => {
    const el = chatBodyRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function handleChatScroll() {
  const el = chatBodyRef.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  autoScroll.value = distance < 120
}

function openAttachmentPicker() {
  attachmentInputRef.value?.click?.()
}

function handleAttachmentSelect(event) {
  const files = Array.from(event?.target?.files || [])
  if (event?.target) event.target.value = ''
  importAttachments(files)
}

function handleAttachmentDragEnter() {
  attachmentDragDepth.value += 1
  attachmentDragging.value = true
}

function handleAttachmentDragLeave() {
  attachmentDragDepth.value = Math.max(0, attachmentDragDepth.value - 1)
  if (!attachmentDragDepth.value) attachmentDragging.value = false
}

function handleAttachmentDrop(event) {
  attachmentDragDepth.value = 0
  attachmentDragging.value = false
  importAttachments(Array.from(event?.dataTransfer?.files || []))
}

function isSupportedAttachment(file) {
  const name = String(file?.name || '')
  const type = String(file?.type || '')
  return /^(image\/)/i.test(type) || /\.(pdf|docx|doc|png|jpe?g|webp|gif|bmp)$/i.test(name)
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',', 2)[1] || '')
    reader.onerror = () => reject(reader.error || new Error('read file failed'))
    reader.readAsDataURL(file)
  })
}

async function importAttachments(files) {
  const picked = files.filter(Boolean).slice(0, 6)
  if (!picked.length) return
  attachmentError.value = ''
  for (const file of picked) {
    if (!isSupportedAttachment(file)) {
      attachmentError.value = '仅支持 PDF / Word / 图片文件'
      continue
    }
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name || 'attachment',
      size: file.size || 0,
      mime: file.type || '',
      kind: String(file.type || '').startsWith('image/') ? 'image' : 'document',
      status: 'parsing',
      text: '',
      error: ''
    }
    attachments.value.push(item)
    toolSteps.value = [
      { id: item.id, label: `解析附件：${item.name}`, status: 'running', detail: item.kind === 'image' ? '正在识别图片内容' : '正在提取文档文字' },
      ...toolSteps.value
    ]
    try {
      const fileData = await readFileAsBase64(file)
      if (item.kind === 'image') item.imageBase64 = fileData
      const data = await parseWorkflowDocument({ filename: item.name, size: item.size, mime: item.mime, file_data: fileData })
      const text = cleanAttachmentText(data.text || '')
      if (!text) throw new Error(data.error || '没有提取到可用内容')
      item.status = 'ready'
      item.title = data.title || item.name.replace(/\.[^.]+$/, '')
      item.text = text
      toolSteps.value = toolSteps.value.map(step => step.id === item.id
        ? { ...step, status: 'done', detail: `已提取 ${text.length} 字` }
        : step)
      sources.value = [
        { route: 'attachment', label: item.name, summary: `${item.kind === 'image' ? '图片识别' : '文档解析'} · ${text.length} 字` },
        ...sources.value.filter(source => source.label !== item.name)
      ]
    } catch (e) {
      item.status = 'failed'
      item.error = e.message || String(e)
      attachmentError.value = `${item.name} 解析失败：${item.error}`
      toolSteps.value = toolSteps.value.map(step => step.id === item.id
        ? { ...step, status: 'failed', detail: item.error }
        : step)
    }
  }
}

/*
async function importAttachmentsLegacyCorrupt(files) {
  const picked = files.filter(Boolean).slice(0, 6)
  if (!picked.length) return
  attachmentError.value = ''
  for (const file of picked) {
    if (!isSupportedAttachment(file)) {
      attachmentError.value = '仅支持 PDF / Word / 图片文件'
      continue
    }
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name || 'attachment',
      size: file.size || 0,
      mime: file.type || '',
      kind: String(file.type || '').startsWith('image/') ? 'image' : 'document',
      status: 'parsing',
      text: '',
      error: ''
    }
    attachments.value.push(item)
    toolSteps.value = [
      { id: item.id, label: `解析附件：${item.name}`, status: 'running', detail: item.kind === 'image' ? '正在识别图片内容' : '正在提取文档文字' },
      ...toolSteps.value
    ]
    try {
      const fileData = await readFileAsBase64(file)
      if (item.kind === 'image') item.imageBase64 = fileData
      const data = await parseWorkflowDocument({ filename: item.name, size: item.size, mime: item.mime, file_data: fileData })
      const text = cleanAttachmentText(data.text || '')
      if (!text) throw new Error(data.error || '没有提取到可用内容')
      item.status = 'ready'
      item.title = data.title || item.name.replace(/\.[^.]+$/, '')
      item.text = text
      toolSteps.value = toolSteps.value.map(step => step.id === item.id
        ? { ...step, status: 'done', detail: `已提取 ${text.length} 字` }
        : step)
      sources.value = [
        { route: 'attachment', label: item.name, summary: `${item.kind === 'image' ? '图片识别' : '文档解析'} · ${text.length} 字` },
        ...sources.value.filter(source => source.label !== item.name)
      ]
    } catch (e) {
      item.status = 'failed'
      item.error = e.message || String(e)
      attachmentError.value = `${item.name} 解析失败：${item.error}`
      toolSteps.value = toolSteps.value.map(step => step.id === item.id
        ? { ...step, status: 'failed', detail: item.error }
        : step)
    }
  }
}

*/

function removeAttachment(id) {
  const target = attachments.value.find(item => item.id === id)
  attachments.value = attachments.value.filter(item => item.id !== id)
  if (target) {
    sources.value = sources.value.filter(source => source.label !== target.name)
    toolSteps.value = toolSteps.value.filter(step => step.id !== target.id)
  }
}

function attachmentMeta(file) {
  if (file.status === 'parsing') return '正在解析...'
  if (file.status === 'failed') return file.error || '解析失败'
  return `${file.kind === 'image' ? '图片识别' : '文档解析'} · ${formatFileSize(file.size)} · ${file.text.length} 字`
}

function formatFileSize(size) {
  const n = Number(size) || 0
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

function cleanAttachmentText(text) {
  return String(text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function buildAttachmentContext() {
  const list = readyAttachments.value
  if (!list.length) return ''
  return list.map((file, index) => [
    `【附件 ${index + 1}】${file.name}`,
    `类型：${file.kind === 'image' ? '图片识别 / OCR' : '文档解析'}`,
    '内容：',
    file.text.slice(0, 18000)
  ].join('\n')).join('\n\n---\n\n')
}

function defaultWeeklyRange() {
  const today = new Date()
  const day = today.getDay() || 7
  const monday = new Date(today)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(today.getDate() - day - 6)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { start: fmt(monday), end: fmt(sunday) }
}

function resolveWeeklyGroup() {
  const user = getCurrentAuthUser() || {}
  const group = String(user.group_name || user.groupName || '').trim()
  return weeklyGroups.includes(group) ? group : '内容二组'
}

function weeklyProfitTarget(groupName, range) {
  const groupId = weeklyGroupIds[groupName] || 0
  const month = Number(String(range?.start || '').slice(5, 7)) || ''
  const year = Number(String(range?.start || '').slice(0, 4)) || new Date().getFullYear()
  try {
    const raw = localStorage.getItem('usagi_profit_targets')
    const targets = raw ? JSON.parse(raw) : {}
    const exact = targets[`${groupId}:${year}:${month || 'all'}`]
    if (exact !== undefined && exact !== null && exact !== '') return Number(exact) || 0
    const allMonth = targets[`${groupId}:${year}:all`]
    if (allMonth !== undefined && allMonth !== null && allMonth !== '') return Number(allMonth) || 0
  } catch (e) {}
  return Number(weeklyGroupTargets[groupId] || 0)
}

function applyWeeklyDefaults() {
  const range = defaultWeeklyRange()
  weeklyForm.value.group = resolveWeeklyGroup()
  weeklyForm.value.start = range.start
  weeklyForm.value.end = range.end
  return range
}

function clearWeeklySupplement() {
  weeklyForm.value.performanceText = ''
  weeklyForm.value.landingText = ''
  weeklyForm.value.summaryText = ''
  weeklyForm.value.nextPlansText = ''
}

function stopWeeklyPolling() {
  if (weeklyTimer.value) {
    window.clearTimeout(weeklyTimer.value)
    weeklyTimer.value = null
  }
}

async function pollWeeklyJob(id) {
  if (!id) return
  try {
    const data = await getWeeklyReportJob(id)
    weeklyJob.value = data.job || data
    const status = weeklyJob.value?.status || ''
    weeklyRunning.value = status === 'running' || status === 'queued'
    if (weeklyRunning.value) {
      weeklyTimer.value = window.setTimeout(() => pollWeeklyJob(id), 1500)
    } else {
      stopWeeklyPolling()
      if (weeklyJob.value?.status === 'done') loadWeeklyReports()
    }
  } catch (e) {
    weeklyRunning.value = false
    stopWeeklyPolling()
    weeklyJob.value = {
      ...(weeklyJob.value || {}),
      status: 'failed',
      message: '周报状态读取失败',
      error: friendlyWeeklyError(e)
    }
  }
}

function friendlyWeeklyError(e) {
  const message = e?.message || String(e || '')
  if (e?.status === 401 || /unauthorized|登录|401/i.test(message)) {
    return '登录态过期了，重新登录后再点“确认生成”即可。'
  }
  if (/failed to fetch|network|timeout/i.test(message)) {
    return '没有连上后端服务，请确认本地服务还在运行。'
  }
  return message || '未知错误'
}

async function startWeekly() {
  if (weeklyRunning.value) return
  const range = applyWeeklyDefaults()
  weeklyRunning.value = true
  stopWeeklyPolling()
  weeklyJob.value = {
    status: 'running',
    progress: 1,
    message: '正在创建周报任务',
    account_results: []
  }
  try {
    const data = await startWeeklyReport({
      group: weeklyForm.value.group || resolveWeeklyGroup(),
      range,
      targetMargin: weeklyProfitTarget(weeklyForm.value.group || resolveWeeklyGroup(), range),
      accountsText: weeklyForm.value.accountsText,
      performanceText: weeklyForm.value.performanceText,
      landingText: weeklyForm.value.landingText,
      summaryText: weeklyForm.value.summaryText,
      nextPlansText: weeklyForm.value.nextPlansText
    })
    weeklyJob.value = data.job || data
    if (!weeklyJob.value?.id) throw new Error('后端没有返回周报任务编号')
    pollWeeklyJob(weeklyJob.value.id)
  } catch (e) {
    weeklyRunning.value = false
    weeklyJob.value = {
      status: 'failed',
      progress: 0,
      message: '周报任务创建失败',
      error: friendlyWeeklyError(e)
    }
  }
}

function weeklyDocDownloadUrl(report) {
  const raw = report?.word_relative_url || report?.word_url || ''
  if (!raw) return ''
  try {
    const url = new URL(raw, window.location.origin)
    if (url.pathname.startsWith('/uploads/')) {
      return url.pathname + url.search
    }
    return url.href
  } catch (e) {
    return raw
  }
}

function weeklyDocFileName(report) {
  const fallback = `${report?.title || 'weekly-report'}.docx`
  return String(report?.filename || fallback).replace(/[\\/:*?"<>|]/g, '_')
}

async function downloadFileFromUrl(docUrl, filename) {
  if (docUrl) {
    try {
      const resp = await fetch(docUrl)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = String(filename || 'download.docx').replace(/[\\/:*?"<>|]/g, '_')
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      showToast('Word download started', 'success', { quiet: true })
      return true
    } catch (e) {
      showToast('Word download failed: ' + (e.message || 'please retry'), 'error')
    }
  }
  return false
}

async function downloadWeeklyDoc() {
  const report = weeklyJob.value?.report
  if (!report) return
  const ok = await downloadFileFromUrl(weeklyDocDownloadUrl(report), weeklyDocFileName(report))
  if (ok) return
  const html = report.html || `<pre>${String(report.text || '').replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))}</pre>`
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = weeklyDocFileName(report).replace(/\.docx$/i, '.doc')
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

async function downloadAgentFile(file) {
  if (!file?.url) return
  await downloadFileFromUrl(weeklyDocDownloadUrl({
    word_url: file.url,
    word_relative_url: file.relative_url || file.relativeUrl || ''
  }), file.name || 'download.docx')
}

async function loadWeeklyReports() {
  try {
    const data = await listWeeklyReports({ limit: 20 })
    weeklyReports.value = data.reports || []
  } catch (e) {
    console.warn('[project-agent] load weekly reports failed', e)
    weeklyReports.value = []
  }
}

async function openWeeklyRecord(record) {
  if (!record?.id) return
  try {
    const data = await getWeeklyReport({ id: record.id })
    const detail = data.report || record
    weeklyJob.value = {
      status: 'done',
      progress: 100,
      message: '已打开历史周报',
      report: detail.report || detail
    }
    weeklyJob.value.report.word_url = detail.word_url || weeklyJob.value.report.word_url || ''
    weeklyJob.value.report.feishu_url = detail.feishu_url || weeklyJob.value.report.feishu_url || ''
  } catch (e) {
    weeklyJob.value = {
      status: 'failed',
      progress: 0,
      message: '历史周报读取失败',
      error: e.message || String(e)
    }
  }
}

function sendWeeklyToChat() {
  const text = weeklyJob.value?.report?.text
  if (!text) return
  messages.value.push({
    id: Date.now() + '-weekly',
    role: 'assistant',
    content: text
  })
  lastReply.value = text
  currentTask.value = 'weekly_report'
  scrollToBottom(true)
}

async function previewTools() {
  if (!canSend.value) return
  runningLabel.value = '正在预览工具'
  try {
    const text = [input.value.trim(), buildAttachmentContext()].filter(Boolean).join('\n\n')
    const data = await previewAgentTools({ message: text, task_type: currentTask.value, agent_mode: agentMode.value })
    currentTask.value = data.task_type || currentTask.value
    toolSteps.value = data.tools || []
  } catch (e) {
    toolSteps.value = [{ id: 'preview_error', label: '工具预览失败', status: 'failed', detail: e.message }]
  }
}

function stopStreaming() {
  if (!running.value || !streamController.value) return
  runningLabel.value = '正在停止'
  streamController.value.abort()
}

async function sendMessage() {
  const typedText = input.value.trim()
  const attachmentContext = buildAttachmentContext()
  const text = [typedText, attachmentContext].filter(Boolean).join('\n\n')
  if (!text || running.value || attachmentParsing.value) return
  const attachmentSummary = readyAttachments.value.length
    ? `\n\n宸查檮鍔狅細${readyAttachments.value.map(item => item.name).join('銆?')}`
    : ''
  const baseId = Date.now()
  const userMessage = { id: baseId + '-u', role: 'user', content: (typedText || '请解读这些附件') + attachmentSummary }
  const assistantMessage = { id: baseId + '-a', role: 'assistant', content: '', pending: true }
  messages.value.push(userMessage, assistantMessage)
  input.value = ''
  running.value = true
  runningLabel.value = '正在调度工具'
  autoScroll.value = true
  const attachmentSources = readyAttachments.value.map(item => ({
    route: 'attachment',
    label: item.name,
    summary: `${item.kind === 'image' ? '????' : '????'} ? ${item.text.length} ?`
  }))
  toolSteps.value = []
  sources.value = attachmentSources
  feishuUrl.value = ''
  lastReply.value = ''
  scrollToBottom()

  try {
    let draftId = lastDraft.value?.id || null
    if (!draftId) {
      const seed = await saveAgentDraft({
        task_type: currentTask.value || 'free_writing',
        input: typedText || '解读附件',
        output: '',
        title: buildSessionTitle(typedText || text),
        tools: [],
        sources: attachmentSources,
        messages: [{ role: 'user', content: userMessage.content }]
      })
      lastDraft.value = seed.draft || seed
      draftId = lastDraft.value?.id || null
      rememberCurrentDraft(lastDraft.value)
      sessionTitle.value = lastDraft.value?.title || sessionTitle.value
      loadDrafts()
    }

    let finalData = null
    let streamError = null
    streamController.value = new AbortController()

    await chatAgentStream({
      message: text,
      task_type: currentTask.value,
      agent_mode: agentMode.value,
      draft_id: draftId,
      history: messages.value
        .filter(item => item.id !== assistantMessage.id)
        .slice(-10)
        .map(item => ({ role: item.role, content: item.content })),
      images: readyAttachments.value.filter(item => item.kind === 'image' && item.imageBase64).map(item => item.imageBase64).slice(0, 4)
    }, {
      onEvent(event, payload) {
        if (event === 'status') {
          runningLabel.value = payload?.message || runningLabel.value
          if (payload?.id && String(payload.id).startsWith('weekly-')) {
            weeklyJob.value = payload
          }
          return
        }
        if (event === 'plan') {
          currentTask.value = payload?.task_type || currentTask.value
          agentMode.value = payload?.agent_mode || agentMode.value
          toolSteps.value = payload?.tools || toolSteps.value
          return
        }
        if (event === 'context') {
          toolSteps.value = payload?.tools || toolSteps.value
          sources.value = [...attachmentSources, ...((payload && payload.sources) || [])]
        }
      },
      onDelta(payload) {
        assistantMessage.pending = false
        assistantMessage.content += payload?.delta || ''
        scrollToBottom()
      },
      onDone(payload) {
        finalData = payload || {}
      },
      onError(payload) {
        streamError = payload || { message: 'stream failed' }
      }
    }, streamController.value.signal)

    if (streamError) {
      throw new Error(streamError.message || streamError.error || '未知错误')
    }

    if (finalData) {
      const isWeeklyReportResult = finalData.task_type === 'weekly_report' || Boolean(finalData.report?.word_url)
      currentTask.value = finalData.task_type || currentTask.value
      toolSteps.value = finalData.tools || toolSteps.value
      agentMode.value = finalData.agent_mode || agentMode.value
      sources.value = [...attachmentSources, ...(finalData.sources || [])]
      if (finalData.job) {
        weeklyJob.value = finalData.job
      }
      if (finalData.report) {
        weeklyJob.value = {
          ...(weeklyJob.value || {}),
          ok: true,
          status: 'done',
          stage: 'done',
          message: '周报已生成',
          progress: 100,
          report: finalData.report
        }
      }
      lastDraft.value = finalData.draft || null
      rememberCurrentDraft(lastDraft.value)
      sessionTitle.value = lastDraft.value?.title || sessionTitle.value
      lastReply.value = finalData.reply || finalData.output || assistantMessage.content || ''
      feishuUrl.value = isWeeklyReportResult ? '' : (finalData.feishu_url || finalData.doc_url || finalData.url || finalData.link || finalData.feishu?.doc_url || finalData.feishu?.url || lastDraft.value?.feishu_url || lastDraft.value?.feishuUrl || '')
      if (!isWeeklyReportResult && !feishuUrl.value && wantsFeishuOutput(typedText || text) && lastReply.value) {
        runningLabel.value = '乌萨奇正在写入飞书'
        toolSteps.value = [
          ...toolSteps.value,
          { id: 'feishu_write_frontend', label: '写入飞书文档', module: 'tools', status: 'running', detail: '用户要求飞书输出，自动创建文档' }
        ]
        const feishuData = await writeAgentFeishu({
          title: sessionTitle.value || buildSessionTitle(typedText || text),
          content: lastReply.value,
          tool: 'doc'
        })
        feishuUrl.value = feishuData?.url || feishuData?.link || feishuData?.doc_url || feishuData?.document_url || feishuData?.feishu_url || feishuData?.feishuUrl || ''
        toolSteps.value = toolSteps.value.map(item => item.id === 'feishu_write_frontend'
          ? { ...item, status: feishuUrl.value ? 'done' : 'failed', detail: feishuUrl.value ? '已创建飞书文档' : (feishuData?.error || feishuData?.msg || '未返回飞书链接') }
          : item)
      }
      assistantMessage.pending = false
      const hasFeishuLink = feishuUrl.value && String(lastReply.value || '').includes(feishuUrl.value)
      assistantMessage.content = (lastReply.value || '这次没有生成内容。') + (feishuUrl.value && !hasFeishuLink ? '\n\n飞书文档：' + feishuUrl.value : '')
      if (isWeeklyReportResult && finalData.report?.word_url) {
        assistantMessage.files = [{
          name: finalData.report.filename || `${finalData.report.title || '周报'}.doc`,
          url: finalData.report.word_url,
          relative_url: finalData.report.word_relative_url || '',
          hint: 'Word 文档'
        }]
      }
    } else {
      lastReply.value = assistantMessage.content
    }

    attachments.value = attachments.value.filter(item => item.status !== 'ready')
    loadDrafts()
  } catch (e) {
    const aborted = e?.name === 'AbortError' || /abort|aborted|cancel/i.test(String(e?.message || ''))
    if (aborted) {
      if (!assistantMessage.content.trim()) {
        assistantMessage.pending = false
        assistantMessage.content = '已停止'
      } else {
        assistantMessage.content += '\n\n[已停止]'
      }
      lastReply.value = assistantMessage.content
      runningLabel.value = '已停止'
    } else {
      assistantMessage.pending = false
      assistantMessage.content = '运行失败：' + (e.message || '未知错误')
    }
  } finally {
    streamController.value = null
    running.value = false
    if (runningLabel.value !== '已停止') runningLabel.value = '处理完成'
    scrollToBottom()
  }
}

async function loadDrafts(restoreLast = false) {
  try {
    const data = await listAgentDrafts({ limit: 80 })
    drafts.value = data.drafts || []
    if (restoreLast && !lastDraft.value && drafts.value.length) {
      let preferredId = ''
      try { preferredId = localStorage.getItem(lastDraftStorageKey()) || '' } catch (e) {}
      const preferred = preferredId ? drafts.value.find(item => String(item.id) === String(preferredId)) : null
      openDraft(preferred || drafts.value[0], false)
    }
  } catch (e) {
    console.warn('[project-agent] load drafts failed', e)
    drafts.value = []
  }
}

function buildSessionTitle(text) {
  const clean = String(text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  return clean ? `项目助手 - ${clean.slice(0, 28)}` : '项目助手会话'
}

function openDraft(draft, remember = true) {
  lastDraft.value = draft
  if (remember) rememberCurrentDraft(draft)
  lastReply.value = draft.output || ''
  sources.value = draft.sources || []
  toolSteps.value = draft.tools || []
  currentTask.value = draft.task_type || ''
  sessionTitle.value = draft.title || ''
  feishuUrl.value = draft.feishu_url || draft.feishuUrl || ''
  const restored = Array.isArray(draft.messages) && draft.messages.length
    ? draft.messages
    : [
        draft.input ? { role: 'user', content: draft.input } : null,
        draft.output ? { role: 'assistant', content: draft.output } : null
      ].filter(Boolean)
  const mapped = restored.map((item, index) => ({
    id: `${draft.id}-${index}`,
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content || item.text || ''
  }))
  messages.value = draft.summary
    ? [
        {
          id: `${draft.id}-summary`,
          role: 'assistant',
          content: `这段会话较早的内容已自动压缩成摘要：\n\n${draft.summary}`
        },
        ...mapped
      ]
    : mapped
  autoScroll.value = true
  scrollToBottom()
}

function newConversation() {
  forgetCurrentDraft()
  messages.value = []
  lastDraft.value = null
  lastReply.value = ''
  feishuUrl.value = ''
  sessionTitle.value = ''
  toolSteps.value = []
  sources.value = []
  currentTask.value = ''
  agentMode.value = 'auto'
  input.value = ''
  autoScroll.value = true
}

async function renameCurrentDraft() {
  if (!lastDraft.value?.id || renamingDraft.value) return
  const title = sessionTitle.value.trim() || lastDraft.value.title || '项目助手会话'
  renamingDraft.value = true
  try {
    const data = await updateAgentDraft({ id: lastDraft.value.id, title })
    lastDraft.value = data.draft || { ...lastDraft.value, title }
    rememberCurrentDraft(lastDraft.value)
    sessionTitle.value = lastDraft.value.title || title
    await loadDrafts()
  } finally {
    renamingDraft.value = false
  }
}

async function deleteDraft(draft) {
  if (!draft?.id) return
  if (deletingDraftIds.value.has(draft.id)) return
  const ok = await askConfirm({
    title: '删除会话',
    message: `确定删除会话“${draft.title || draft.task_type || draft.id}”吗？`,
    confirmText: '删除',
    cancelText: '取消',
    type: 'danger'
  })
  if (!ok) return
  deletingDraftIds.value = new Set([...deletingDraftIds.value, draft.id])
  try {
    await deleteAgentDraft({ id: draft.id })
    drafts.value = drafts.value.filter(item => item.id !== draft.id)
    forgetCurrentDraft(draft.id)
    if (lastDraft.value?.id === draft.id) {
      const nextDraft = drafts.value[0]
      if (nextDraft) openDraft(nextDraft)
      else newConversation()
    }
    showToast(`已删除会话 #${draft.id}`, 'success')
    await loadDrafts()
  } catch (e) {
    showToast('删除会话失败：' + (e.message || '未知错误'), 'error')
  } finally {
    const next = new Set(deletingDraftIds.value)
    next.delete(draft.id)
    deletingDraftIds.value = next
  }
}

async function copyLastReply() {
  if (!lastReply.value) return
  await navigator.clipboard?.writeText(lastReply.value).catch(() => {})
}

function formatTime(ts) {
  if (!ts) return ''
  const date = new Date(Number(ts) * 1000)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

onMounted(() => {
  applyWeeklyDefaults()
  window.setTimeout(() => loadDrafts(true), 80)
  window.setTimeout(loadWeeklyReports, 120)
})

onBeforeUnmount(() => {
  stopWeeklyPolling()
  streamController.value?.abort?.()
})
</script>

<style scoped>
.project-agent-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
}

.agent-header {
  flex-shrink: 0;
}

.agent-header-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--card-border);
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-dim);
  font-size: 13px;
}

.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-text);
}

.agent-dot.busy {
  background: var(--warning-text);
  animation: agentPulse 1s infinite ease-in-out;
}

.agent-shell {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(290px, 28vw, 380px);
  gap: 16px;
  align-items: stretch;
}

.agent-chat,
.agent-panel {
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  box-shadow: var(--shadow);
}

.agent-chat {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 18px;
  overflow: hidden;
  position: relative;
}

.agent-chat.attachment-dragging {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 22%, transparent), var(--shadow);
}

.agent-mode-row,
.agent-prompt-row {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  overflow-x: auto;
}

.agent-mode-row {
  padding-bottom: 0;
  background: var(--card-header-bg);
}

.agent-prompt-row {
  border-bottom: 1px solid var(--divider);
  background: var(--card-header-bg);
}

.agent-mode,
.agent-chip {
  border: 1px solid var(--chip-border);
  background: var(--chip-bg);
  color: var(--text);
  border-radius: 999px;
  padding: 6px 9px;
  white-space: nowrap;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  transition: transform var(--t-base) var(--ease-spring), border-color var(--t-base);
}

.agent-mode-icon,
.agent-chip-icon {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  margin-right: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  font-size: 11px;
  font-weight: 800;
}

.agent-chip:hover {
  transform: translateY(-1px);
  border-color: var(--card-border-hover);
}

.agent-mode.active,
.weekly-toggle-chip.active {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--active-bg);
}

.weekly-card {
  margin: 0 12px 12px;
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--card-border));
  border-radius: 8px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--card-bg) 92%, var(--usagi-paper)), var(--card-bg));
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 12%, transparent);
  overflow: hidden;
  flex: 0 1 auto;
  max-height: min(58vh, 560px);
  display: flex;
  flex-direction: column;
}

.weekly-dialog-card {
  max-height: min(48vh, 460px);
}

.weekly-card-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
}

.weekly-card-head > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.weekly-head-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.weekly-card-head strong {
  color: var(--text);
  font-size: 15px;
}

.weekly-card-head span,
.weekly-field span,
.weekly-grid label span,
.weekly-account-row small {
  color: var(--text-muted);
  font-size: 12px;
}

.weekly-dialog {
  border-top: 1px dashed color-mix(in srgb, var(--border) 72%, var(--usagi-border));
  padding: 12px;
  display: grid;
  gap: 10px;
}

.weekly-dialog-bubble {
  border: 1px solid var(--chip-border);
  border-radius: 12px;
  background: var(--panel-bg-soft);
  padding: 10px 12px;
  display: grid;
  gap: 4px;
  line-height: 1.55;
}

.weekly-dialog-bubble strong {
  color: var(--text);
  font-size: 13px;
}

.weekly-dialog-bubble span {
  color: var(--text-muted);
  font-size: 12px;
}

.weekly-confirm-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.weekly-confirm-grid > div {
  min-width: 0;
  border: 1px solid var(--chip-border);
  border-radius: 10px;
  background: var(--chip-bg);
  padding: 9px 10px;
  display: grid;
  gap: 3px;
}

.weekly-confirm-grid span {
  color: var(--text-muted);
  font-size: 11px;
}

.weekly-confirm-grid strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 13px;
}

.weekly-dialog-details {
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: var(--row-bg);
  padding: 9px 10px;
}

.weekly-dialog-details summary {
  cursor: pointer;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}

.weekly-dialog-details[open] {
  display: grid;
  gap: 10px;
}

.weekly-dialog-details[open] summary {
  margin-bottom: 2px;
}

.weekly-form {
  min-height: 0;
  overflow: auto;
  border-top: 1px dashed color-mix(in srgb, var(--border) 72%, var(--usagi-border));
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.weekly-status-strip {
  flex: 0 0 auto;
  margin: 0 12px 12px;
  padding: 9px 10px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--row-bg) 90%, transparent);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.weekly-status-copy {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.weekly-status-copy strong {
  flex: 0 0 auto;
  font-size: 13px;
}

.weekly-status-copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.weekly-status-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.weekly-status-strip.done {
  border-color: var(--success-border);
  background: var(--success-bg);
}

.weekly-status-strip.failed {
  border-color: var(--danger-border);
  background: var(--danger-bg);
}

.weekly-status-strip.failed .weekly-status-copy span {
  color: var(--danger-text);
}

.weekly-optional-note {
  padding: 8px 10px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.weekly-inline-error {
  padding: 8px 10px;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--danger-text);
  font-size: 12px;
  line-height: 1.5;
}

.weekly-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 10px;
}

.weekly-grid label,
.weekly-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.weekly-form textarea {
  resize: vertical;
  min-height: 74px;
}

.weekly-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.weekly-actions-hint {
  color: var(--text-muted);
  font-size: 12px;
}

.weekly-history {
  border: 1px solid var(--chip-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--row-bg) 80%, transparent);
  padding: 10px;
  display: grid;
  gap: 8px;
}

.weekly-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text);
  font-size: 13px;
}

.weekly-history-row {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 11px;
  background: var(--chip-bg);
  color: var(--text);
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  cursor: pointer;
}

.weekly-history-row:hover {
  border-color: var(--card-border-hover);
  transform: translateY(-1px);
}

.weekly-history-row span,
.weekly-history-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weekly-history-row small {
  color: var(--text-muted);
}

.weekly-progress {
  border: 1px solid var(--chip-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--row-bg) 88%, transparent);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.weekly-progress-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--text);
  font-size: 13px;
}

.weekly-bar {
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 42%, transparent);
  overflow: hidden;
}

.weekly-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary-gradient);
  transition: width .25s ease;
}

.weekly-account-now {
  color: var(--primary-light);
  font-size: 12px;
}

.weekly-account-list {
  display: grid;
  gap: 7px;
}

.weekly-account-row {
  display: grid;
  grid-template-columns: minmax(90px, .7fr) minmax(0, 1fr);
  gap: 6px 10px;
  align-items: center;
  border: 1px solid var(--chip-border);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--chip-bg);
}

.weekly-account-row strong,
.weekly-account-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weekly-account-row.failed {
  border-color: color-mix(in srgb, var(--danger-text) 34%, var(--chip-border));
}

.weekly-account-row small {
  grid-column: 1 / -1;
  color: var(--danger-text);
}

.weekly-preview {
  max-height: 260px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 12px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
  padding: 12px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.7;
}

.agent-chat-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.agent-message {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.agent-message.user {
  grid-template-columns: minmax(0, 1fr) 38px;
}

.agent-message.user .agent-avatar {
  grid-column: 2;
  grid-row: 1;
  background: var(--primary-gradient);
  color: white;
}

.agent-message.user .agent-bubble {
  grid-column: 1;
  justify-self: end;
  background: var(--active-bg);
}

.agent-avatar {
  width: 38px;
  height: 38px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  border: 1px solid var(--card-border);
  font-weight: 800;
  overflow: hidden;
}

.agent-avatar img {
  width: 124%;
  height: 124%;
  object-fit: contain;
  transform: translateY(2px);
}

.usagi-agent-avatar {
  border-color: color-mix(in srgb, var(--usagi-border) 76%, var(--card-border));
  background:
    radial-gradient(circle at 28% 16%, rgba(255, 255, 255, 0.7), transparent 34%),
    linear-gradient(145deg, color-mix(in srgb, var(--usagi-cream) 72%, var(--surface)), color-mix(in srgb, var(--usagi-yellow) 46%, var(--surface2)));
  box-shadow: 0 10px 22px color-mix(in srgb, var(--usagi-yellow) 14%, transparent);
}

.usagi-agent-avatar.is-busy img {
  animation: agentMascotPeek 1.6s ease-in-out infinite;
}

.agent-bubble {
  max-width: 820px;
  border: 1px solid var(--card-border);
  border-radius: 16px;
  padding: 13px 14px;
  background: var(--panel-bg);
  color: var(--text);
  line-height: 1.65;
  white-space: pre-wrap;
}

.intro-message .agent-bubble p {
  margin-top: 6px;
  color: var(--text-dim);
}

.agent-message-meta {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.agent-file-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  white-space: normal;
}

.agent-file-card {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  max-width: 360px;
  padding: 9px 10px;
  border: 1px solid var(--chip-border);
  border-radius: 10px;
  background: var(--chip-bg);
  color: var(--text);
  text-decoration: none;
}

.agent-file-card:hover {
  border-color: var(--card-border-hover);
  transform: translateY(-1px);
}

.agent-file-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  color: var(--primary);
  font-size: 13px;
  font-weight: 800;
}

.agent-file-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.agent-file-main strong,
.agent-file-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-file-main small {
  color: var(--text-muted);
  font-size: 12px;
}

.typing-bubble {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
}

.typing-bubble span,
.inline-thinking span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  animation: dotJump 1s infinite ease-in-out;
}

.typing-bubble span:nth-child(2) { animation-delay: .12s; }
.typing-bubble span:nth-child(3) { animation-delay: .24s; }
.inline-thinking span:nth-child(2) { animation-delay: .12s; }
.inline-thinking span:nth-child(3) { animation-delay: .24s; }
.typing-bubble em,
.inline-thinking em {
  margin-left: 6px;
  color: var(--text-dim);
  font-style: normal;
  font-size: 13px;
}

.inline-thinking {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
}

.agent-composer {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 14px;
  border-top: 1px solid var(--divider);
  background: var(--card-header-bg);
}

.agent-attachment-tray {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.agent-attachment {
  display: inline-grid;
  grid-template-columns: 28px minmax(120px, 1fr) 24px;
  align-items: center;
  gap: 8px;
  max-width: min(100%, 360px);
  border: 1px solid var(--chip-border);
  border-radius: 12px;
  background: var(--row-bg);
  padding: 7px 8px;
}

.agent-attachment.parsing {
  border-color: color-mix(in srgb, var(--warning-text) 45%, var(--chip-border));
}

.agent-attachment.failed {
  border-color: var(--danger-border, var(--chip-border));
  background: var(--danger-bg, var(--row-bg));
}

.attachment-icon {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--chip-bg);
  color: var(--primary);
  font-weight: 800;
  font-size: 12px;
}

.attachment-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.attachment-main strong,
.attachment-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-main small,
.attachment-error {
  color: var(--text-muted);
  font-size: 12px;
}

.attachment-error {
  color: var(--danger-text);
}

.attachment-remove {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 17px;
  line-height: 1;
}

.attachment-remove:hover {
  color: var(--danger-text);
  background: var(--chip-bg);
}

.agent-file-input {
  display: none;
}

.agent-drop-overlay {
  position: absolute;
  inset: 10px;
  z-index: 5;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  border: 2px dashed color-mix(in srgb, var(--primary) 66%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--card-bg) 88%, transparent);
  color: var(--text);
  pointer-events: none;
  text-align: center;
}

.agent-drop-overlay span {
  color: var(--text-muted);
  font-size: 13px;
}

.agent-input {
  width: 100%;
  resize: vertical;
  min-height: 92px;
  border-radius: 14px;
  border: 1px solid var(--input-border);
  background: var(--input-bg);
  color: var(--text);
  padding: 12px;
  line-height: 1.6;
}

.agent-composer-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: flex-end;
}

.agent-side {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
}

.agent-panel {
  min-width: 0;
  border-radius: 16px;
  padding: 14px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.agent-panel-head {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.agent-panel-head span,
.agent-empty,
.source-row small,
.tool-row small,
.current-draft small,
.draft-row small {
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.tool-list,
.source-list,
.draft-list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.tool-row,
.source-row,
.draft-row,
.current-draft {
  min-width: 0;
  border: 1px solid var(--chip-border);
  background: var(--row-bg);
  border-radius: 12px;
  padding: 10px;
}

.tool-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
}

.tool-status {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--chip-bg);
  font-weight: 800;
}

.tool-row.done .tool-status { color: var(--success-text); }
.tool-row.failed .tool-status { color: var(--danger-text); }
.tool-row.running .tool-status { color: var(--warning-text); }

.source-row,
.draft-row {
  min-width: 0;
  display: flex;
  gap: 6px;
}

.draft-row {
  width: 100%;
  color: var(--text);
  align-items: center;
  padding: 0;
  overflow: hidden;
}

.draft-row.active {
  border-color: var(--primary);
  background: var(--active-bg);
}

.draft-open {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.draft-open span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-open small,
.current-draft small {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-delete {
  width: 30px;
  height: 30px;
  margin-right: 6px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.draft-delete:hover {
  border-color: var(--danger-border, var(--card-border));
  color: var(--danger-text);
  background: var(--danger-bg, var(--chip-bg));
}

.session-title-input {
  width: 100%;
  border: 1px solid var(--input-border);
  border-radius: 10px;
  background: var(--input-bg);
  color: var(--text);
  padding: 8px 10px;
  font-weight: 800;
}

.draft-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.draft-panel {
  min-height: 0;
}

.draft-panel .current-draft,
.draft-panel .draft-actions {
  flex-shrink: 0;
}

.draft-panel .draft-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
  scrollbar-gutter: stable;
}

.tool-list,
.source-list {
  overflow: auto;
  max-height: min(30vh, 260px);
  padding-right: 2px;
  scrollbar-gutter: stable;
}

.mini-link,
.feishu-link {
  border: 0;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  text-decoration: none;
}

.feishu-link {
  display: inline-block;
  margin-top: 10px;
}

@keyframes dotJump {
  0%, 80%, 100% { transform: translateY(0); opacity: .5; }
  40% { transform: translateY(-4px); opacity: 1; }
}

@keyframes agentMascotPeek {
  0%, 100% { transform: translateY(2px) rotate(-2deg); }
  50% { transform: translateY(-1px) rotate(2deg); }
}

@keyframes agentPulse {
  0%, 100% { transform: scale(1); opacity: .65; }
  50% { transform: scale(1.35); opacity: 1; }
}

@media (max-width: 1100px) {
  .agent-shell {
    grid-template-columns: 1fr;
  }
  .agent-side {
    grid-template-rows: auto auto minmax(280px, 1fr);
  }
}

@media (max-width: 760px) {
  .weekly-grid,
  .weekly-account-row,
  .weekly-confirm-grid {
    grid-template-columns: 1fr;
  }
  .agent-composer {
    grid-template-columns: 1fr;
  }
  .agent-composer-actions {
    flex-direction: row;
  }
  .agent-side {
    grid-template-rows: auto auto minmax(260px, 1fr);
  }
}
</style>


