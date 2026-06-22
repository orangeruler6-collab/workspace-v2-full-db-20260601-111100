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
          <p>一个自由聊天入口，可以转写链接、读取飞书、查资料、做 BF 分析、日报、周报和项目复盘。</p>
        </div>
      </div>
      <div class="agent-header-status">
        <span :class="['agent-dot', running ? 'busy' : 'ready']"></span>
        <span>{{ running ? '处理中' : '待命中' }}</span>
      </div>
    </header>

    <section class="agent-shell">
      <main class="agent-chat" :class="{ 'attachment-dragging': attachmentDragging }">
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
                <span>战略项</span>
                <textarea v-model="weeklyForm.strategyText" class="inp" rows="4" placeholder="一行一个战略项，系统只负责写入，不自动编造。"></textarea>
              </label>
              <label class="weekly-field">
                <span>战略项完成情况</span>
                <textarea v-model="weeklyForm.strategyStatusText" class="inp" rows="2" placeholder="人工填写；不填则周报显示待补充。"></textarea>
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
              <p>直接贴抖音、B站、飞书链接，或者说“内容四组写日报”或“按内容二组格式生成本周周报并给我飞书”。我会自己调工具、写飞书，最后把链接和数据源交代清楚。</p>
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
              <div v-if="!message.pending && message.images?.length" class="agent-image-list">
                <figure
                  v-for="image in message.images"
                  :key="image.id || image.url || image.name"
                  class="agent-image-card">
                  <button class="agent-image-preview" type="button" @click="previewImageUrl = image.url">
                    <img :src="image.url" :alt="image.name || 'AI 生成图片'" loading="lazy" />
                  </button>
                  <figcaption>
                    <strong>{{ image.name || 'AI 生成图片' }}</strong>
                    <span>{{ image.hint || '可预览、下载或继续改图' }}</span>
                    <div class="agent-image-actions">
                      <button class="btn btn-ghost btn-sm" type="button" @click="previewImageUrl = image.url">预览</button>
                      <button class="btn btn-ghost btn-sm" type="button" @click="downloadAgentImage(image)">下载</button>
                      <button class="btn btn-primary btn-sm" type="button" @click="useAgentImageAsReference(image)">继续改图</button>
                    </div>
                  </figcaption>
                </figure>
              </div>
              <div v-if="!message.pending && message.files?.length" class="agent-file-list">
                <button
                  v-for="file in message.files"
                  :key="file.url || file.name"
                  type="button"
                  class="agent-file-card"
                  :disabled="!file.url && !file.dataUrl"
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
            placeholder="贴链接，或者输入：内容四组写日报 / 读取这个飞书 BF 并分析 / 按内容二组格式生成本周周报"
            @keydown.enter.exact.prevent="sendMessage"></textarea>
          <input ref="attachmentInputRef" class="agent-file-input" type="file" multiple :accept="acceptedAttachmentTypes" @change="handleAttachmentSelect" />
          <div class="agent-composer-actions">
            <button class="btn btn-ghost btn-sm" type="button" @click="openAttachmentPicker" :disabled="running">
              附件
            </button>
            <button v-if="running" class="btn btn-ghost btn-sm" type="button" @click="stopStreaming">停止</button>
            <button class="btn btn-primary" type="button" @click="sendMessage" :disabled="running || preparingSend || !canSend">
              {{ preparingSend ? '载入图片...' : (running ? '运行中...' : '发送') }}
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
            <span>{{ currentTaskLabel }}</span>
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

    <div v-if="previewImageUrl" class="agent-image-modal" @click.self="previewImageUrl = ''">
      <button class="agent-image-modal-close" type="button" @click="previewImageUrl = ''">×</button>
      <img :src="previewImageUrl" alt="图片预览" />
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { chatAgentStream, deleteAgentDraft, getWeeklyReport, getWeeklyReportJob, listAgentDrafts, listWeeklyReports, saveAgentDraft, startWeeklyReport, updateAgentDraft, writeAgentFeishu } from '../api/agent'
import { getCurrentAuthUser } from '../api/client'
import { normalizeImageUrl } from '../api/imagegen'
import { parseWorkflowDocument } from '../api/tools'
import { useConfirm } from '../composables/useConfirm'
import { useToast } from '../composables/useToast'
import { compressImageFile } from './imagegen/fileUtils'
import agentHappyImage from '../assets/usagi-pet-states/happy.png'
import agentIdleImage from '../assets/usagi-pet-states/idle.png'
import agentSignImage from '../assets/usagi-pet-states/sign.png'

const taskLabels = {
  transcribe_link: '链接转写',
  read_feishu: '飞书读取',
  bf_analysis: 'BF 分析',
  weekly_report: '周报生成',
  daily_report: '日报生成',
  project_review: '项目复盘',
  image_generation: '图片生成',
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
const renamingDraft = ref(false)
const sessionTitle = ref('')
const chatBodyRef = ref(null)
const attachmentInputRef = ref(null)
const askConfirm = useConfirm()
const { showToast } = useToast()
const ATTACHMENT_PARSE_TIMEOUT_MS = 18000
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
const preparingSend = ref(false)
const previewImageUrl = ref('')
const weeklyGroups = ['内容一组', '内容二组', '内容三组', '内容四组', '内容五组', '内容六组']
const weeklyGroupMembers = {
  '内容一组': ['许树杰', '许梦婷', '刘登魁', '许国锬', '叶进生', '高明镇', '薛荐轩', '叶颖'],
  '内容二组': ['傅思敏', '赵良杰', '陈乐恒', '吴恒', '李扬林', '施律彬', '罗晓棋'],
  '内容三组': ['曹媛', '陈泓睿', '陈鸿睿', '林文涛', '刘佳琳', '肖子璇'],
  '内容四组': ['姚希', '陈健伊', '宋丽佳', '林宇辰'],
  '内容五组': ['朱信宇', '林心语', '商光涵', '杨鸿霆', '吴楷煌'],
  '内容六组': ['廖李星', '吴皓轩', '林孝添', '林语婷', '张碧珊', '叶子健']
}
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
  strategyText: '',
  strategyStatusText: '',
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
const conversationCount = computed(() => messages.value.filter(item => item.role === 'user' || item.role === 'assistant').length)
const currentSessionMeta = computed(() => draftSessionMeta(lastDraft.value, conversationCount.value))
const attachmentParsing = computed(() => attachments.value.some(item => item.status === 'parsing' && item.kind !== 'image'))
const readyAttachments = computed(() => attachments.value.filter(item => item.status === 'ready' && (item.text || (item.kind === 'image' && item.imageBase64) || (item.kind === 'document' && item.fileBase64))))
const imageAttachmentsLoading = computed(() => attachments.value.some(item => item.kind === 'image' && item.status === 'loading'))
const canSend = computed(() => Boolean(input.value.trim() || readyAttachments.value.length || imageAttachmentsLoading.value))
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

function isImageAttachment(file) {
  const name = String(file?.name || '')
  const type = String(file?.type || '')
  return /^(image\/)/i.test(type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)
}

function readFileAsBase64(file, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      try { reader.abort() } catch (e) {}
      reject(new Error(`读取文件超过 ${Math.round(timeoutMs / 1000)} 秒，请重新选择或压缩后再试`))
    }, timeoutMs)
    reader.onload = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(String(reader.result || '').split(',', 2)[1] || '')
    }
    reader.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(reader.error || new Error('read file failed'))
    }
    reader.readAsDataURL(file)
  })
}

async function prepareAgentImageFile(file) {
  const compressed = await compressImageFile(file, {
    maxSide: 1280,
    maxBytes: 900 * 1024,
    quality: 0.72,
    minQuality: 0.54,
    always: file.size > 900 * 1024
  })
  return compressed || file
}

function parseWorkflowDocumentWithTimeout(payload, timeoutMs = ATTACHMENT_PARSE_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  return parseWorkflowDocument(payload, controller.signal)
    .finally(() => window.clearTimeout(timer))
    .catch(error => {
      if (error?.name === 'AbortError' || /abort/i.test(String(error?.message || ''))) {
        throw new Error(`解析超过 ${Math.round(timeoutMs / 1000)} 秒，已转为发送后解析`)
      }
      throw error
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
      kind: isImageAttachment(file) ? 'image' : 'document',
      status: 'loading',
      text: '',
      error: ''
    }
    attachments.value.push(item)
    toolSteps.value = [
      { id: item.id, label: `添加附件：${item.name}`, status: 'running', detail: item.kind === 'image' ? '正在载入图片' : '正在读取文件' },
      ...toolSteps.value
    ]
    let fileData = ''
    try {
      if (item.kind === 'image') {
        item.loadPromise = readFileAsBase64(file)
        fileData = await item.loadPromise
        item.loadPromise = null
        item.imageBase64 = fileData
        item.originalSize = file.size || 0
        item.size = file.size || 0
        item.mime = file.type || ''
        item.compressed = false
        item.status = 'ready'
        item.title = item.name.replace(/\.[^.]+$/, '')
        item.text = ''
        toolSteps.value = toolSteps.value.map(step => step.id === item.id
          ? { ...step, status: 'done', detail: item.compressed ? `已压缩并载入图片参考：${formatFileSize(item.originalSize)} → ${formatFileSize(item.size)}` : '已载入图片参考，发送后再看图/改图' }
          : step)
        sources.value = [
          { route: 'attachment', label: item.name, summary: item.compressed ? `图片参考 · 已压缩 ${formatFileSize(item.originalSize)} → ${formatFileSize(item.size)}` : '图片参考 · 可用于看图、图生图或改图' },
          ...sources.value.filter(source => source.label !== item.name)
        ]
        continue
      }
      fileData = await readFileAsBase64(file)
      item.fileBase64 = fileData
      item.status = 'ready'
      item.pendingParse = true
      item.title = item.name.replace(/\.[^.]+$/, '')
      toolSteps.value = toolSteps.value.map(step => step.id === item.id
        ? { ...step, status: 'done', detail: '已添加文件，后台解析中；可直接发送' }
        : step)
      sources.value = [
        { route: 'attachment', label: item.name, summary: '文件已添加 · 可直接发送，后台解析中' },
        ...sources.value.filter(source => source.label !== item.name)
      ]
      parseWorkflowDocumentWithTimeout({ filename: item.name, size: item.size, mime: item.mime, file_data: fileData })
        .then(data => {
          if (!attachments.value.some(entry => entry.id === item.id)) return
          const text = cleanAttachmentText(data.text || '')
          if (!text) throw new Error(data.error || '没有提取到可用内容')
          item.pendingParse = false
          item.error = ''
          item.title = data.title || item.title
          item.text = text
          toolSteps.value = toolSteps.value.map(step => step.id === item.id
            ? { ...step, status: 'done', detail: `已提取 ${text.length} 字` }
            : step)
          sources.value = [
            { route: 'attachment', label: item.name, summary: `文档解析 · ${text.length} 字` },
            ...sources.value.filter(source => source.label !== item.name)
          ]
        })
        .catch(error => {
          if (!attachments.value.some(entry => entry.id === item.id)) return
          item.pendingParse = true
          item.error = error.message || String(error)
          toolSteps.value = toolSteps.value.map(step => step.id === item.id
            ? { ...step, status: 'done', detail: '后台解析未完成，发送后由 AI 继续处理' }
            : step)
          sources.value = [
            { route: 'attachment', label: item.name, summary: '文件已添加 · 发送后继续解析' },
            ...sources.value.filter(source => source.label !== item.name)
          ]
        })
      continue
    } catch (e) {
      item.loadPromise = null
      if (item.kind === 'image' && (item.imageBase64 || fileData)) {
        item.imageBase64 = item.imageBase64 || fileData
        item.status = 'ready'
        item.title = item.name.replace(/\.[^.]+$/, '')
        item.text = ''
        item.error = e.message || String(e)
        toolSteps.value = toolSteps.value.map(step => step.id === item.id
          ? { ...step, status: 'done', detail: '已保留为图片参考，OCR 未提取到文字' }
          : step)
        sources.value = [
          { route: 'attachment', label: item.name, summary: '图片参考 · 可用于看图、图生图或改图' },
          ...sources.value.filter(source => source.label !== item.name)
        ]
        continue
      }
      if (item.kind === 'document' && (item.fileBase64 || fileData)) {
        item.fileBase64 = item.fileBase64 || fileData
        item.status = 'ready'
        item.pendingParse = true
        item.title = item.name.replace(/\.[^.]+$/, '')
        item.text = ''
        item.error = e.message || String(e)
        toolSteps.value = toolSteps.value.map(step => step.id === item.id
          ? { ...step, status: 'done', detail: '已上传文件，发送消息后再交给后端解析' }
          : step)
        sources.value = [
          { route: 'attachment', label: item.name, summary: '文件已上传 · 发送后解析正文' },
          ...sources.value.filter(source => source.label !== item.name)
        ]
        continue
      }
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
  if (file.status === 'loading') return file.kind === 'image' ? '正在载入图片...' : '正在读取文件...'
  if (file.status === 'parsing') return '正在解析...'
  if (file.status === 'failed') return file.error || '解析失败'
  if (file.kind === 'image' && !file.text) return `图片参考 · ${formatFileSize(file.size)}`
  if (file.kind === 'document' && !file.text) return `文件已上传 · ${formatFileSize(file.size)} · 发送后解析`
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

function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function waitForImageAttachmentsReady() {
  const pending = attachments.value.filter(item => item.kind === 'image' && item.status === 'loading')
  if (!pending.length) return
  attachmentError.value = '图片正在载入，马上发送...'
  await Promise.allSettled(pending.map(item => item.loadPromise || delay(80)))
  const failed = pending.filter(item => item.status !== 'ready' || !item.imageBase64)
  if (failed.length) {
    const names = failed.map(item => item.name).join('、')
    throw new Error(`${names} 没有载入成功，请重新上传图片`)
  }
  attachmentError.value = ''
}

function buildAttachmentContext() {
  const list = readyAttachments.value
  if (!list.length) return ''
  return list.map((file, index) => [
    `【附件 ${index + 1}】${file.name}`,
    `类型：${file.kind === 'image' ? '图片参考 / OCR' : '文档解析'}`,
    '内容：',
    file.text
      ? file.text.slice(0, 18000)
      : (file.kind === 'image'
          ? '这是一张图片附件；若需要请结合随请求上传的图片本体进行视觉理解或图生图。'
          : '这个文件已上传但尚未完成正文解析；发送后请后端继续解析原文件并基于正文回答。')
  ].join('\n')).join('\n\n---\n\n')
}

function pendingDocumentPayloads(list = readyAttachments.value) {
  return list
    .filter(item => item.kind === 'document' && item.fileBase64 && !item.text)
    .map(item => ({
      filename: item.name,
      size: item.size || 0,
      mime: item.mime || '',
      file_data: item.fileBase64
    }))
    .slice(0, 4)
}

function imageAttachmentPayloads(list = readyAttachments.value) {
  return list
    .filter(item => item.kind === 'image' && item.imageBase64)
    .map(item => ({
      base64: item.imageBase64,
      mime: item.mime || 'image/jpeg',
      name: item.name,
      size: item.size || 0
    }))
    .slice(0, 4)
}

function attachmentImageUrl(item) {
  if (!item?.imageBase64) return ''
  return `data:${item.mime || 'image/jpeg'};base64,${item.imageBase64}`
}

function attachmentFileDataUrl(item) {
  if (!item?.fileBase64) return ''
  const fallbackMime = /\.pdf$/i.test(item.name || '')
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return `data:${item.mime || fallbackMime};base64,${item.fileBase64}`
}

function attachmentMessageImages(list = readyAttachments.value) {
  return list
    .filter(item => item.kind === 'image' && item.imageBase64)
    .map(item => ({
      id: item.id,
      name: item.name,
      url: attachmentImageUrl(item),
      hint: `用户上传图片 · ${formatFileSize(item.size)}`
    }))
}

function attachmentMessageFiles(list = readyAttachments.value) {
  return list
    .filter(item => item.kind === 'document')
    .map(item => ({
      id: item.id,
      name: item.name,
      dataUrl: attachmentFileDataUrl(item),
      size: item.size || 0,
      mime: item.mime || '',
      hint: item.text
        ? `用户上传文件 · 已解析 ${item.text.length} 字`
        : `用户上传文件 · ${formatFileSize(item.size)} · 发送后解析`
    }))
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
  if (weeklyGroups.includes(group)) return group
  const name = String(user.real_name || user.display_name || user.username || '').trim()
  const matched = weeklyGroups.find(item => (weeklyGroupMembers[item] || []).includes(name))
  return matched || '内容二组'
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

function defaultWeeklyStrategyText(groupName, range) {
  const month = String(range?.start || '').slice(5, 7)
  if (groupName === '内容四组' && month === '06') {
    return [
      '按照账号更新标准完成月度账号更新条数，账号主编责任制落实到位（需要配合抽查与提交运营文档）',
      '商单评论区抽奖测试',
      'AI工作台热点及文案撰写功能优化'
    ].join('\n')
  }
  return ''
}

function applyWeeklyDefaults() {
  const range = defaultWeeklyRange()
  weeklyForm.value.group = resolveWeeklyGroup()
  weeklyForm.value.start = range.start
  weeklyForm.value.end = range.end
  if (!weeklyForm.value.strategyText.trim()) {
    weeklyForm.value.strategyText = defaultWeeklyStrategyText(weeklyForm.value.group, range)
  }
  return range
}

function clearWeeklySupplement() {
  weeklyForm.value.performanceText = ''
  weeklyForm.value.landingText = ''
  weeklyForm.value.strategyText = ''
  weeklyForm.value.strategyStatusText = ''
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
      strategyText: weeklyForm.value.strategyText,
      strategyStatusText: weeklyForm.value.strategyStatusText,
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
      if (String(docUrl).startsWith('data:')) {
        const anchor = document.createElement('a')
        anchor.href = docUrl
        anchor.download = String(filename || 'download.docx').replace(/[\\/:*?"<>|]/g, '_')
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        showToast('文件已开始下载', 'success', { quiet: true })
        return true
      }
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
      showToast('文件已开始下载', 'success', { quiet: true })
      return true
    } catch (e) {
      showToast('文件下载失败：' + (e.message || '请稍后重试'), 'error')
    }
  }
  return false
}

function absoluteAssetUrl(raw) {
  const url = normalizeImageUrl(String(raw || '').trim())
  if (!url || url.startsWith('data:')) return url
  try {
    return new URL(escapeBadPercent(url), window.location.origin).toString()
  } catch (e) {
    return escapeBadPercent(url)
  }
}

function escapeBadPercent(value) {
  return String(value || '').replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
}

function safeDecodeURIComponent(value) {
  const raw = String(value || '')
  try {
    return decodeURIComponent(raw)
  } catch (e) {
    try {
      return decodeURIComponent(escapeBadPercent(raw))
    } catch (inner) {
      return raw
    }
  }
}

function safeImageFileName(value, index = 0) {
  const fallback = `agent-image-${index + 1}.png`
  try {
    const pathname = new URL(absoluteAssetUrl(value), window.location.origin).pathname
    const name = safeDecodeURIComponent(pathname.split('/').filter(Boolean).pop() || fallback)
    return String(name || fallback).replace(/[\\/:*?"<>|]/g, '_')
  } catch (e) {
    return fallback
  }
}

function addImageUrl(list, seen, raw, source = 'AI 生成图片') {
  const clean = String(raw || '').trim().replace(/[，。；;、)）\]】"'<>]+$/g, '')
  if (!clean) return
  const url = normalizeImageUrl(clean)
  if (!url || seen.has(url)) return
  seen.add(url)
  list.push({
    url,
    name: `${source} ${list.length + 1}`,
    hint: '点击可预览，或作为参考图继续修改'
  })
}

function extractAgentImages(data, content = '') {
  const list = []
  const seen = new Set()
  const add = (value, source) => addImageUrl(list, seen, value, source)
  if (data) {
    add(data.image_url || data.imageUrl || data.result_url || data.url, 'AI 生成图片')
    if (data.image) add(data.image.url || data.image.image_url || data.image.result_url, 'AI 生成图片')
    ;['images', 'urls', 'results'].forEach(key => {
      const values = Array.isArray(data[key]) ? data[key] : []
      values.forEach(item => add(typeof item === 'string' ? item : (item?.url || item?.image_url || item?.result_url), 'AI 生成图片'))
    })
  }
  const text = String(content || '')
  const labeled = /图片链接[：:]\s*(https?:\/\/[^\s)）\]】"'，。；;]+|\/uploads\/imagegen\/[^\s)）\]】"'，。；;]+)/gi
  let match = null
  while ((match = labeled.exec(text))) add(match[1], 'AI 生成图片')
  const general = /(https?:\/\/[^\s)）\]】"'，。；;]+|\/uploads\/imagegen\/[^\s)）\]】"'，。；;]+)/gi
  while ((match = general.exec(text))) {
    const value = match[1]
    if (/\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(value) || value.includes('/uploads/imagegen/')) {
      add(value, 'AI 生成图片')
    }
  }
  return list
}

function addAgentFile(list, seen, file, fallbackName = 'AI 返回文档') {
  if (!file) return
  const rawUrl = typeof file === 'string'
    ? file
    : (file.url || file.word_url || file.wordUrl || file.docx_url || file.docxUrl || file.file_url || file.fileUrl || file.relative_url || file.relativeUrl || '')
  const url = String(rawUrl || '').trim()
  const dataUrl = typeof file === 'object' ? String(file.dataUrl || file.data_url || '').trim() : ''
  if (!url && !dataUrl) return
  const key = url || dataUrl.slice(0, 80)
  if (seen.has(key)) return
  seen.add(key)
  const name = typeof file === 'object'
    ? (file.name || file.filename || file.title || fallbackName)
    : fallbackName
  list.push({
    name: String(name || fallbackName).replace(/[\\/:*?"<>|]/g, '_'),
    url,
    dataUrl,
    relative_url: typeof file === 'object' ? (file.relative_url || file.relativeUrl || '') : '',
    hint: typeof file === 'object' ? (file.hint || file.type || '点击下载文档') : '点击下载文档'
  })
}

function extractAgentFiles(data) {
  const list = []
  const seen = new Set()
  if (!data) return list
  if (data.report && (data.report.word_url || data.report.word_relative_url)) {
    addAgentFile(list, seen, {
      name: data.report.filename || `${data.report.title || '周报'}.docx`,
      url: data.report.word_url,
      relative_url: data.report.word_relative_url || '',
      hint: 'Word 文档'
    })
  }
  addAgentFile(list, seen, {
    name: data.filename || data.file_name || data.title || 'AI 返回文档.docx',
    url: data.word_url || data.wordUrl || data.docx_url || data.docxUrl || data.file_url || data.fileUrl,
    relative_url: data.word_relative_url || data.relative_url || data.relativeUrl || '',
    hint: data.file_hint || data.hint || '点击下载文档'
  })
  ;['files', 'documents', 'attachments'].forEach(key => {
    const values = Array.isArray(data[key]) ? data[key] : []
    values.forEach(item => addAgentFile(list, seen, item, 'AI 返回文档'))
  })
  return list
}

async function imageUrlToBase64(rawUrl) {
  const url = absoluteAssetUrl(rawUrl)
  if (!url) throw new Error('图片地址为空')
  if (url.startsWith('data:')) return url.split(',', 2)[1] || ''
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const blob = await resp.blob()
  const name = safeImageFileName(url)
  const file = new File([blob], name, { type: blob.type || 'image/png' })
  const imageFile = await prepareAgentImageFile(file)
  return await readFileAsBase64(imageFile)
}

async function downloadAgentImage(image) {
  try {
    const url = absoluteAssetUrl(image?.url)
    if (!url) throw new Error('图片地址为空')
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const blob = await resp.blob()
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = safeImageFileName(image?.url, 0)
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(objectUrl)
    showToast('图片已开始下载', 'success', { quiet: true })
  } catch (e) {
    showToast('图片下载失败：' + (e.message || '请稍后重试'), 'error')
  }
}

async function useAgentImageAsReference(image) {
  try {
    const base64 = await imageUrlToBase64(image?.url)
    if (!base64) throw new Error('没有读取到图片数据')
    const name = safeImageFileName(image?.url, attachments.value.length)
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      size: 0,
      mime: 'image/png',
      kind: 'image',
      status: 'ready',
      text: '',
      error: '',
      imageBase64: base64,
      title: name.replace(/\.[^.]+$/, '')
    }
    attachments.value.push(item)
    sources.value = [
      { route: 'imagegen', label: name, summary: '生成图参考 · 可继续图生图或改图' },
      ...sources.value.filter(source => source.label !== name)
    ]
    if (!input.value.trim()) input.value = '基于这张参考图继续修改：'
    currentTask.value = 'image_generation'
    showToast('已放入参考图，可以继续描述怎么改', 'success')
  } catch (e) {
    showToast('放入参考图失败：' + (e.message || '请稍后重试'), 'error')
  }
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
  if (!file?.url && !file?.dataUrl) return
  if (file.dataUrl) {
    await downloadFileFromUrl(file.dataUrl, file.name || 'attachment')
    return
  }
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
    weeklyForm.value.strategyText = (weeklyJob.value.report.strategy_items || []).join('\n')
    weeklyForm.value.strategyStatusText = weeklyJob.value.report.strategy_status || weeklyJob.value.report.strategyStatus || ''
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

function stopStreaming() {
  if (!running.value || !streamController.value) return
  runningLabel.value = '正在停止'
  streamController.value.abort()
}

async function sendMessage() {
  if (running.value || preparingSend.value) return
  preparingSend.value = true
  try {
    await waitForImageAttachmentsReady()
  } catch (e) {
    attachmentError.value = e.message || String(e)
    showToast(attachmentError.value, 'error')
    preparingSend.value = false
    return
  }
  preparingSend.value = false
  const typedText = input.value.trim()
  const readySnapshot = readyAttachments.value.slice()
  const attachmentContext = buildAttachmentContext()
  const text = [typedText, attachmentContext].filter(Boolean).join('\n\n')
  if (!text || running.value) return
  const attachmentSummary = readySnapshot.length
    ? `\n\n已附加：${readySnapshot.map(item => item.name).join('、')}`
    : ''
  const baseId = Date.now()
  const userMessage = {
    id: baseId + '-u',
    role: 'user',
    content: (typedText || '请解读这些附件') + attachmentSummary,
    images: attachmentMessageImages(readySnapshot),
    files: attachmentMessageFiles(readySnapshot)
  }
  const assistantMessage = { id: baseId + '-a', role: 'assistant', content: '', pending: true }
  messages.value.push(userMessage, assistantMessage)
  input.value = ''
  running.value = true
  runningLabel.value = '正在调度工具'
  autoScroll.value = true
  const attachmentSources = readySnapshot.map(item => ({
    route: 'attachment',
    label: item.name,
    summary: item.kind === 'image'
      ? `图片附件 · ${formatFileSize(item.size)}`
      : (item.text ? `文件附件 · 已解析 ${item.text.length} 字` : `文件附件 · ${formatFileSize(item.size)} · 发送后解析`)
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
      agent_mode: 'auto',
      draft_id: draftId,
      history: messages.value
        .filter(item => item.id !== assistantMessage.id)
        .slice(-10)
        .map(item => ({ role: item.role, content: item.content })),
      images: imageAttachmentPayloads(readySnapshot),
      documents: pendingDocumentPayloads(readySnapshot)
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
      const finalText = finalData.reply || finalData.output || assistantMessage.content || ''
      const finalImages = extractAgentImages(finalData, finalText)
      const finalFiles = extractAgentFiles(finalData)
      const isImageResult = Boolean(finalImages.length || finalData.image_url || finalData.imageUrl || finalData.result_url || finalData.image?.url)
      currentTask.value = finalData.task_type || currentTask.value
      toolSteps.value = finalData.tools || toolSteps.value
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
      lastReply.value = finalText
      feishuUrl.value = (isWeeklyReportResult || isImageResult) ? '' : (finalData.feishu_url || finalData.doc_url || finalData.url || finalData.link || finalData.feishu?.doc_url || finalData.feishu?.url || lastDraft.value?.feishu_url || lastDraft.value?.feishuUrl || '')
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
      if (finalImages.length) {
        assistantMessage.images = finalImages
      }
      if (finalFiles.length) {
        assistantMessage.files = finalFiles
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
  cursor: pointer;
}

.agent-file-card:hover {
  border-color: var(--card-border-hover);
  transform: translateY(-1px);
}

.agent-file-card:disabled {
  cursor: default;
  opacity: 0.9;
}

.agent-file-card:disabled:hover {
  border-color: var(--chip-border);
  transform: none;
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

.agent-image-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 240px));
  gap: 10px;
  margin-top: 10px;
  white-space: normal;
}

.agent-image-card {
  overflow: hidden;
  margin: 0;
  border: 1px solid var(--card-border);
  border-radius: 12px;
  background: var(--surface);
}

.agent-image-preview {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border: 0;
  padding: 0;
  background: var(--surface2);
  cursor: zoom-in;
}

.agent-image-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.agent-image-card figcaption {
  display: grid;
  gap: 5px;
  padding: 9px;
}

.agent-image-card strong {
  font-size: 13px;
}

.agent-image-card span {
  color: var(--text-muted);
  font-size: 12px;
}

.agent-image-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 3px;
}

.agent-image-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.72);
}

.agent-image-modal img {
  max-width: min(96vw, 1100px);
  max-height: 92vh;
  object-fit: contain;
  border-radius: 12px;
  background: white;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.35);
}

.agent-image-modal-close {
  position: fixed;
  top: 18px;
  right: 18px;
  width: 38px;
  height: 38px;
  border: 1px solid rgba(255, 255, 255, 0.36);
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.6);
  color: white;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
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


