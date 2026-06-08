<template>
  <div class="copy-workbench-module">
    <header class="workbench-header module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon" aria-hidden="true">&#9997;&#65039;</span>
        <div class="module-page-copy">
          <h2>文案工作台</h2>
        </div>
      </div>
      <div class="workbench-actions">
        <button type="button" @click="activeFlow = 'material'">导入素材</button>
        <button type="button" @click="openStyleManager">管理账号</button>
        <button type="button" @click="activeFlow = 'records'">成稿记录</button>
      </div>
    </header>

    <nav class="flow-track" aria-label="文案生产流程">
      <button
        v-for="step in flowSteps"
        :key="step.key"
        type="button"
        class="flow-node"
        :class="{ active: activeFlow === step.key, done: step.done }"
        @click="activeFlow = step.key">
        <i>{{ step.index }}</i>
        <span>
          <strong>{{ step.label }}</strong>
          <small>{{ step.meta }}</small>
        </span>
        <b v-if="step.done">✓</b>
      </button>
    </nav>

    <section v-if="activeFlow === 'records'" class="records-view">
      <div class="panel-head compact">
        <div>
          <span>4</span>
          <h3>成稿记录</h3>
        </div>
        <div class="record-toolbar">
          <button class="btn btn-ghost btn-sm" @click="activeFlow = 'generate'">返回创作</button>
          <button class="btn btn-ghost btn-sm" @click="loadRecords">刷新</button>
        </div>
      </div>
      <div v-if="records.length" class="record-list">
        <article v-for="record in records" :key="record.id" class="record-card">
          <div>
            <span>{{ formatTime(record.created_at) }}</span>
            <strong>{{ record.title || record.payload?.requirement || '文案记录' }}</strong>
            <p>{{ cleanGarbledText(record.payload?.output) }}</p>
          </div>
          <button class="btn btn-ghost btn-sm" @click="useRecord(record)">载入</button>
        </article>
      </div>
      <div v-else class="empty-box">暂无记录</div>
    </section>

    <main v-else class="workbench-grid" :data-focus="activeFlow">
      <section class="work-panel material-panel" :class="{ focused: activeFlow === 'material' }">
        <div class="panel-head">
          <div>
            <span>1</span>
            <h3>素材输入</h3>
          </div>
          <b>{{ transcript ? transcriptStats : '待输入' }}</b>
        </div>

        <div class="source-type-tabs" role="tablist" aria-label="素材输入类型">
          <button
            type="button"
            :class="{ active: sourceType === 'video' }"
            @click="setSourceType('video')">
            视频链接
          </button>
          <button
            type="button"
            :class="{ active: sourceType === 'brief' }"
            @click="setSourceType('brief')">
            商单 BF
          </button>
        </div>

        <div v-if="sourceType === 'video'" class="source-row merged-source">
          <input v-model="material.url" class="inp" placeholder="粘贴链接 / BV号" @keyup.enter="runTranscribe" />
          <span class="detected-platform" :class="detectedPlatform">
            <span class="tab-platform-mark" :class="detectedPlatform === 'bilibili' ? 'bili' : 'douyin'" aria-hidden="true"></span>
            {{ detectedPlatformLabel }}
          </span>
          <button class="btn btn-primary" :disabled="transcribing" @click="runTranscribe">
            {{ transcribing ? '转写中...' : '转写' }}
          </button>
        </div>

        <div v-else class="source-row brief-source-row">
          <input v-model="brief.title" class="inp" placeholder="商单 BF 标题，例如：XX 品牌 5 月合作需求" />
          <span class="detected-platform brief-source-badge">BF</span>
        </div>

        <div class="transcript-card primary-block">
          <div class="sub-head">
            <strong>转写预览</strong>
            <div class="transcript-tools">
              <button type="button" :disabled="!transcript" @click="cleanTranscript">清洗</button>
              <button type="button" :disabled="!transcript" @click="handleCopy(transcript)">复制</button>
              <span v-if="transcribing" class="material-progress" :title="materialStageLabel">
                <i :style="{ width: materialProgress + '%' }"></i>
              </span>
              <small>{{ materialStageLabel }}</small>
            </div>
          </div>
          <textarea
            v-model="transcript"
            class="inp transcript-box"
            rows="9"
            :readonly="transcribing"
            placeholder="粘贴或转写内容"></textarea>
          <div class="panel-actions">
            <button class="btn btn-ghost" :disabled="!transcript" @click="addTranscriptToBasket">加入素材篮</button>
            <button class="btn btn-feishu" :disabled="!transcript" @click="writeTranscriptToFeishu">📤 写飞书</button>
            <button class="btn btn-primary" :disabled="!transcript" @click="goGenerateFromMaterial">去生成</button>
          </div>
          <p v-if="materialError" class="inline-error">{{ materialError }}</p>
        </div>

      </section>

      <section class="work-panel style-panel" :class="{ focused: activeFlow === 'style' }">
        <div class="panel-head">
          <div>
            <span>2</span>
            <h3>账号风格</h3>
          </div>
        </div>

        <div class="style-body">
          <aside class="style-list">
            <label class="style-filter">
              <span>筛选</span>
              <select v-model="styleFilter" class="inp">
                <option v-for="item in styleFilterOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <button
              v-for="style in filteredStyles"
              :key="style.id"
              type="button"
              class="style-item"
              :class="{ active: style.id === selectedStyleId }"
              @click="selectStyle(style.id)">
              <span class="platform-mark" :class="style.platform === 'B站' ? 'bili' : 'douyin'" aria-hidden="true"></span>
              <span>
                <strong>{{ style.name }}</strong>
              </span>
            </button>
            <button type="button" class="style-manage-btn" @click="openStyleManager">管理账号</button>
          </aside>

          <article v-if="selectedStyle" class="style-detail-card">
            <div class="style-identity">
              <span class="identity-logo" :class="selectedStyle.platform === 'B站' ? 'bili' : 'douyin'" aria-hidden="true"></span>
              <div>
                <strong>{{ selectedStyle.name }}</strong>
              </div>
              <b>当前</b>
            </div>

            <div class="style-metrics">
              <button type="button" :class="{ done: (selectedStyle.samples?.length || 0) > 0 }" @click="openSamplesModal">
                <span>样本</span>
                <strong>{{ selectedStyle.samples?.length || 0 }}</strong>
              </button>
              <button type="button" :class="{ done: selectedStyle.styleCard?.positioning }" @click="openStyleCardModal">
                <span>风格卡</span>
                <strong>{{ selectedStyle.styleCard?.positioning ? '已生成' : '待分析' }}</strong>
              </button>
              <button type="button" :class="{ done: selectedStyle.status === '可用' }" @click="confirmSelectedStyle">
                <span>状态</span>
                <strong>{{ selectedStyle.status || '待分析' }}</strong>
              </button>
            </div>

            <button type="button" class="style-summary" @click="openStyleCardModal">
              <div v-for="field in styleSummaryFields" :key="field.key">
                <span>{{ field.label }}</span>
                <p>{{ field.value || '待分析' }}</p>
              </div>
            </button>

            <div class="style-actions">
              <button class="btn btn-ghost btn-sm" :disabled="!canAnalyzeStyle || styleAnalyzing" @click="runStyleAnalyze">
                {{ styleAnalyzing ? '分析中...' : '分析风格' }}
              </button>
              <button class="btn btn-ghost btn-sm" :disabled="!selectedStyle.styleCard?.positioning" @click="confirmSelectedStyle">保存启用</button>
              <button class="btn btn-primary" @click="useSelectedStyle">用此风格</button>
            </div>
          </article>
          <div v-else class="empty-box">暂无账号</div>
        </div>
      </section>

      <section class="work-panel generate-panel" :class="{ focused: activeFlow === 'generate' }">
        <div class="panel-head">
          <div>
            <span>3</span>
            <h3>创作生成</h3>
          </div>
          <b>{{ output ? outputStats : '未生成' }}</b>
        </div>

        <div class="basket-box">
          <div class="sub-head">
            <strong>素材篮</strong>
            <span>{{ basket.length }} 条</span>
          </div>
          <div v-if="basket.length" class="basket-list">
            <article v-for="item in basket" :key="item.id">
              <div>
                <strong>{{ cleanGarbledText(item.title) }}</strong>
                <p>{{ cleanGarbledText(item.content) }}</p>
              </div>
              <button class="icon-btn" title="移除素材" @click="removeBasketItem(item.id)">×</button>
            </article>
          </div>
          <div v-else class="empty-box">暂无素材</div>
        </div>

        <div class="angle-section">
          <div class="sub-head">
            <strong>先选切入点</strong>
            <button class="plain-action" :disabled="!canGenerateAngles || angleLoading" @click="generateAngles">
              {{ angleLoading ? '生成中...' : (angles.length ? '换一批' : '生成切入点') }}
            </button>
          </div>
          <div class="angle-list">
            <button
              v-for="angle in angles"
              :key="angle.id"
              type="button"
              class="angle-card"
              :class="{ active: selectedAngleId === angle.id }"
              @click="selectedAngleId = angle.id">
              <span>{{ angle.type }}</span>
              <strong>{{ angle.title }}</strong>
              <p>{{ angle.logic }}</p>
            </button>
          </div>
          <div v-if="!angles.length" class="empty-box">{{ canGenerateAngles ? '待生成' : '先选账号' }}</div>
        </div>

        <div class="generate-settings">
          <button type="button" class="requirement-toggle" @click="showRequirementPanel = !showRequirementPanel">
            <span>补充要求</span>
            <strong>{{ task.note.trim() ? '已填写' : '可选' }}</strong>
          </button>
          <textarea
            v-if="showRequirementPanel || task.note.trim()"
            v-model="task.note"
            class="inp note-box"
            rows="3"
            placeholder="有特别角度、禁词、口播要求时再写"></textarea>
          <div class="setting-groups">
            <label class="select-field">
              <span>文案长度</span>
              <select v-model="task.length" class="inp">
                <option v-for="item in lengthOptions" :key="item">{{ item }}</option>
              </select>
            </label>
            <label class="select-field">
              <span>风格强度</span>
              <select v-model="task.strength" class="inp">
                <option v-for="item in strengthOptions" :key="item">{{ item }}</option>
              </select>
            </label>
          </div>
        </div>

        <div class="editor-card featured-editor">
          <div class="sub-head">
            <strong>正文</strong>
            <span>{{ currentAngle ? currentAngle.title : outputStats }}</span>
          </div>
          <textarea v-model="output" ref="outputTextarea" class="inp output-box" rows="9" placeholder="选好切入点后生成正文" @mouseenter="expandOutput" @mouseleave="collapseOutput"></textarea>
          <div class="generate-actions">
            <button class="btn btn-primary" :disabled="!canGenerateCopy || copyLoading" @click="generateCopy">{{ copyLoading ? '生成中...' : '生成正文' }}</button>
            <button class="btn btn-ghost" :disabled="!output" @click="handleCopy(output)">复制</button>
          </div>
        </div>


        <div v-if="output || publishRecommendation" class="delivery-card publish-recommend-card">
          <div class="sub-head">
            <strong>发布推荐</strong>
            <span>发布文案 / 封面标题 / 视频简介</span>
          </div>
          <div class="publish-settings">
            <label>
              <span>发布文案</span>
              <input v-model.number="publishSettings.captionMax" class="inp" type="number" min="30" max="200" />
            </label>
            <label>
              <span>视频简介</span>
              <input v-model.number="publishSettings.introMax" class="inp" type="number" min="60" max="300" />
            </label>
            <p>封面上 4-6 字；封面下 8-10 字以内。</p>
          </div>
          <textarea
            v-if="publishRecommendation"
            v-model="publishRecommendation"
            class="inp publish-output"
            rows="6"
            placeholder="发布推荐会出现在这里"></textarea>
          <div class="delivery-actions">
            <button class="btn btn-primary btn-sm" :disabled="!output || publishLoading" @click="generatePublishRecommendation">{{ publishLoading ? '生成中...' : '生成发布推荐' }}</button>
            <button class="btn btn-ghost btn-sm" :disabled="!publishRecommendation" @click="handleCopy(publishRecommendation)">复制</button>
          </div>
        </div>

        <div v-if="output || comments.length" class="delivery-card">
          <div class="sub-head">
            <strong>后处理</strong>
            <span>{{ comments.length ? comments.length + ' 评论' : outputStats }}</span>
          </div>
          <div class="delivery-actions">
            <button class="btn btn-ghost btn-sm" :disabled="!output || commentLoading" @click="generateOutputComments">{{ commentLoading ? '生成中...' : '评论' }}</button>
            <button class="btn btn-ghost btn-sm" :disabled="!output || !selectedStyle" @click="saveOutputAsSample">样本</button>
            <button class="btn btn-ghost btn-sm" :disabled="!output" @click="saveOutputRecord">保存</button>
          </div>
          <div v-if="comments.length" class="comment-list">
            <button v-for="(comment, index) in comments" :key="index" type="button" @click="handleCopy(comment)">
              {{ index + 1 }}. {{ comment }}
            </button>
          </div>
        </div>
      </section>
    </main>

    <div v-if="showStyleCreator" class="modal-backdrop" @click.self="closeStyleCreator">
      <section class="style-modal">
        <header>
          <h3>新建账号</h3>
          <button type="button" class="icon-btn" @click="closeStyleCreator">×</button>
        </header>
        <input v-model="styleDraft.name" class="inp" placeholder="账号名称" />
        <div class="style-create-grid">
          <select v-model="styleDraft.platform" class="inp">
            <option>抖音</option>
            <option>B站</option>
          </select>
          <select v-model="styleDraft.contentType" class="inp">
            <option>口播</option>
            <option>知识</option>
            <option>测评</option>
            <option>带货</option>
            <option>剧情</option>
          </select>
        </div>
        <input v-model="styleDraft.scene" class="inp" placeholder="适用场景" />
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="closeStyleCreator">取消</button>
          <button class="btn btn-primary" @click="createStyleFromDraft">创建</button>
        </div>
      </section>
    </div>

    <div v-if="showStyleManager" class="modal-backdrop" @click.self="showStyleManager = false">
      <section class="style-modal manager-modal">
        <header>
          <h3>管理账号</h3>
          <button type="button" class="icon-btn" @click="showStyleManager = false">×</button>
        </header>
        <div class="manager-list">
          <article
            v-for="style in styles"
            :key="style.id"
            class="manager-item"
            draggable="true"
            :class="{ active: style.id === selectedStyleId }"
            @dragstart="startStyleDrag(style.id)"
            @dragover.prevent
            @drop="dropStyle(style.id)">
            <button type="button" class="manager-select" @click="selectManagedStyle(style.id)">
              <span class="platform-mark" :class="style.platform === 'B站' ? 'bili' : 'douyin'" aria-hidden="true"></span>
              <strong>{{ style.name }}</strong>
              <em :class="statusClass(style.status)">{{ style.status }}</em>
            </button>
            <button
              type="button"
              class="manager-delete"
              :disabled="!canDeleteStyle(style)"
              @click="requestDeleteStyle(style)">
              删除
            </button>
          </article>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="openStyleCreator">新建账号</button>
          <button class="btn btn-primary" @click="showStyleManager = false">完成</button>
        </div>
      </section>
    </div>

    <div v-if="showStyleCardEditor" class="modal-backdrop" @click.self="closeStyleCardModal">
      <section class="style-modal card-modal">
        <header>
          <div class="modal-title-with-logo">
            <span class="identity-logo" :class="selectedStyle?.platform === 'B站' ? 'bili' : 'douyin'" aria-hidden="true"></span>
            <div>
              <h3>{{ selectedStyle?.name || '账号' }}风格卡</h3>
              <small>{{ selectedStyle?.platform || '平台' }} · {{ selectedStyle?.contentType || '内容' }}</small>
            </div>
          </div>
          <button type="button" class="icon-btn" @click="closeStyleCardModal">×</button>
        </header>
        <div class="card-editor-grid">
          <label v-for="field in styleCardEditFields" :key="field.key">
            <span>{{ field.label }}</span>
            <textarea v-model="styleCardDraft[field.key]" class="inp" rows="4"></textarea>
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="closeStyleCardModal">取消</button>
          <button class="btn btn-primary" @click="saveStyleCardDraft">保存</button>
        </div>
      </section>
    </div>

    <div v-if="showSamplesEditor" class="modal-backdrop" @click.self="closeSamplesModal">
      <section class="style-modal samples-modal">
        <header>
          <div>
            <h3>样本库</h3>
            <small>{{ selectedStyle?.samples?.length || 0 }} 条样本</small>
          </div>
          <button type="button" class="icon-btn" @click="closeSamplesModal">×</button>
        </header>
        <textarea v-model="sampleDraft" class="inp sample-input" rows="4" placeholder="粘贴新样本，空行会自动分成多条"></textarea>
        <button class="btn btn-primary" :disabled="!sampleDraft.trim()" @click="addSampleFromModal">添加样本</button>
        <div v-if="selectedStyle?.samples?.length" class="sample-list">
          <article v-for="sample in selectedStyle.samples" :key="sample.id">
            <div>
              <strong>{{ cleanGarbledText(sample.title) }}</strong>
              <p>{{ cleanGarbledText(sample.content) }}</p>
            </div>
            <button class="btn btn-ghost btn-sm" @click="requestDeleteSample(sample)">删除</button>
          </article>
        </div>
        <div v-else class="empty-box">暂无样本</div>
      </section>
    </div>

    <div v-if="deleteConfirm" class="modal-backdrop" @click.self="deleteConfirm = null">
      <section class="style-modal confirm-modal">
        <header>
          <h3>确认删除</h3>
          <button type="button" class="icon-btn" @click="deleteConfirm = null">×</button>
        </header>
        <p>{{ deleteConfirm.message }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deleteConfirm = null">取消</button>
          <button class="btn btn-primary danger-action" @click="confirmDelete">确认删除</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  addAccountStyleSamples,
  analyzeAccountStyle,
  confirmAccountStyle,
  createAccountStyle,
  deleteAccountStyle,
  deleteAccountStyleSample,
  incrementAccountStyleUsage,
  listAccountStyles,
  saveAccountStyleCard,
  saveAccountStyles
} from '../api/accountStyles'
import { getCurrentAuthUser } from '../api/client'
import { addCopygenRecord, generateCopygenAngles, generateCopygenPublishRecommend, generateCopygenText, listCopygenRecords } from '../api/copygen'
import { generateComments, transcribeVideo, writeFeishu } from '../api/tools'
import { useClipboard } from '../composables/useClipboard'
import { useToast } from '../composables/useToast'
import { cleanTranscriptText } from './tools/textCleanup'

const BASKET_KEY = 'usagi_copy_material_basket'
const SELECTED_STYLE_KEY = 'usagi_copygen_selected_style_id'
const STYLE_LOCAL_KEY = 'usagi_account_style_library'
const { showToast } = useToast()
const { handleCopy } = useClipboard(showToast)

const activeFlow = ref('material')
const styles = ref([])
const selectedStyleId = ref(localStorage.getItem(SELECTED_STYLE_KEY) || '')
const styleFilter = ref('all')
const showRequirementPanel = ref(false)
const showStyleCreator = ref(false)
const showStyleManager = ref(false)
const showStyleCardEditor = ref(false)
const showSamplesEditor = ref(false)
const deleteConfirm = ref(null)
const draggingStyleId = ref('')
const styleAnalyzing = ref(false)
const transcribing = ref(false)
const transcribeProgress = ref(0)
let transcribeTimer = null
const materialError = ref('')
const transcript = ref('')
const transcriptSourceTitle = ref('')
const transcriptAuthor = ref('')
const sourceType = ref('video')
const basket = ref(readBasket())
const angles = ref([])
const selectedAngleId = ref('')
const output = ref('')
const outputTextarea = ref(null)
const angleLoading = ref(false)
const copyLoading = ref(false)
const records = ref([])
const comments = ref([])
const commentLoading = ref(false)
const publishRecommendation = ref('')
const publishLoading = ref(false)
const publishSettings = reactive({
  captionMax: 80,
  introMax: 120
})

const material = reactive({
  platform: 'douyin',
  url: ''
})

const brief = reactive({
  title: '',
  content: ''
})

const lengthOptions = ['短文案', '中等脚本', 'B站长稿']
const strengthOptions = ['轻', '中', '强']

const task = reactive({
  title: '',
  note: '',
  length: '中等脚本',
  strength: '中'
})

const styleDraft = reactive({
  name: '',
  platform: '抖音',
  contentType: '口播',
  scene: ''
})

const styleCardEditFields = [
  { key: 'positioning', label: '定位' },
  { key: 'topics', label: '选题方向' },
  { key: 'titleStyle', label: '标题方式' },
  { key: 'opening', label: '开头方式' },
  { key: 'structure', label: '正文结构' },
  { key: 'tone', label: '语气' },
  { key: 'rhythm', label: '节奏' },
  { key: 'expressions', label: '常用表达' },
  { key: 'banned', label: '禁用表达' },
  { key: 'sampleClues', label: '样本线索' }
]

const styleCardDraft = reactive(styleCardEditFields.reduce((draft, field) => {
  draft[field.key] = ''
  return draft
}, {}))
const sampleDraft = ref('')

const selectedStyle = computed(() => styles.value.find(style => style.id === selectedStyleId.value))
const currentUser = computed(() => getCurrentAuthUser())
const currentAngle = computed(() => angles.value.find(angle => angle.id === selectedAngleId.value))
const currentMaterialContent = computed(() => sourceType.value === 'brief' ? brief.content : transcript.value)
const outputStats = computed(() => `${output.value.replace(/\s/g, '').length} 字`)
const transcriptStats = computed(() => transcript.value ? `${transcript.value.replace(/\s/g, '').length} 字` : '等待素材')

function expandOutput() {
  const el = outputTextarea.value
  if (!el || !output.value) return
  el.style.overflow = 'hidden'
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function collapseOutput() {
  const el = outputTextarea.value
  if (!el) return
  el.style.height = ''
  el.style.overflow = ''
}
const detectedPlatform = computed(() => detectPlatform(material.url))
const detectedPlatformLabel = computed(() => detectedPlatform.value === 'bilibili' ? 'B站' : '抖音')
const materialProgress = computed(() => {
  if (transcribing.value) return transcribeProgress.value || 8
  return transcribeProgress.value
})
const materialStageLabel = computed(() => {
  if (sourceType.value === 'brief') {
    const count = transcript.value.replace(/\s/g, '').length
    return count ? `${count} 字 BF` : '等待 BF'
  }
  if (transcribing.value) return `转写中 ${Math.round(materialProgress.value)}%`
  if (transcript.value) return transcriptStats.value
  return '等待素材'
})
const materialText = computed(() => {
  const fromBasket = basket.value.map((item, index) => `素材${index + 1}｜${cleanGarbledText(item.title)}\n${cleanGarbledText(item.content)}`).join('\n\n')
  return [fromBasket, cleanGarbledText(task.note)].filter(Boolean).join('\n\n')
})
const canGenerateAngles = computed(() => Boolean(selectedStyle.value && materialText.value.trim()))
const canGenerateCopy = computed(() => Boolean(selectedStyle.value && currentAngle.value))
const canAnalyzeStyle = computed(() => Boolean(selectedStyle.value?.samples?.length))
const styleFilterOptions = computed(() => {
  const map = new Map()
  styles.value.forEach(style => {
    styleFilterKeys(style).forEach(key => {
      if (!key.value) return
      const current = map.get(key.value) || { value: key.value, label: key.label, count: 0 }
      current.count += 1
      map.set(key.value, current)
    })
  })
  return [{ value: 'all', label: '全部账号' }].concat(Array.from(map.values()).map(item => ({
    value: item.value,
    label: `${item.label} · ${item.count}`
  })))
})
const filteredStyles = computed(() => {
  if (styleFilter.value === 'all') return styles.value
  return styles.value.filter(style => styleFilterKeys(style).some(key => key.value === styleFilter.value))
})
const flowSteps = computed(() => [
  { key: 'material', index: 1, label: '素材输入', meta: basket.value.length ? `${basket.value.length} 条已收集` : '转写 / 粘贴', done: basket.value.length > 0 || Boolean(transcript.value) },
  { key: 'style', index: 2, label: '账号风格', meta: selectedStyle.value?.name || '选择账号', done: Boolean(selectedStyle.value?.status === '可用' || selectedStyle.value?.styleCard?.positioning) },
  { key: 'generate', index: 3, label: '创作生成', meta: output.value ? outputStats.value : (angles.value.length ? `${angles.value.length} 个切角` : '切角 / 正文'), done: Boolean(output.value) },
  { key: 'records', index: 4, label: '成稿记录', meta: records.value.length ? `${records.value.length} 条历史` : '复用成稿', done: records.value.length > 0 }
])
const styleSummaryFields = computed(() => {
  const card = selectedStyle.value?.styleCard || {}
  return [
    { key: 'positioning', label: '定位', value: cleanGarbledText(card.positioning) },
    { key: 'tone', label: '语气', value: cleanGarbledText(card.tone) },
    { key: 'structure', label: '结构', value: cleanGarbledText(card.structure) },
    { key: 'expressions', label: '常用表达', value: cleanGarbledText(card.expressions) }
  ]
})

function cleanGarbledText(value) {
  return String(value || '')
    .replace(/\uFFFD+/g, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
    .trim()
}

function detectPlatform(url) {
  const value = String(url || '').trim()
  if (/bilibili\.com|b23\.tv|(^|\s)BV[0-9A-Za-z]{8,}/i.test(value)) return 'bilibili'
  if (/douyin\.com|iesdouyin|v\.douyin|抖音/i.test(value)) return 'douyin'
  return 'douyin'
}

function styleFilterKeys(style) {
  const tags = [
    style.platform,
    style.contentType,
    style.scene,
    ...(Array.isArray(style.tags) ? style.tags : [])
  ].filter(Boolean)
  return Array.from(new Set(tags.map(item => String(item).trim()).filter(Boolean))).map(item => ({
    value: item,
    label: item
  }))
}

function setSourceType(type) {
  if (!['video', 'brief'].includes(type)) return
  sourceType.value = type
  materialError.value = ''
  stopTranscribeProgress(false)
}

function startTranscribeProgress() {
  stopTranscribeProgress()
  transcribeProgress.value = 6
  transcribeTimer = window.setInterval(() => {
    const next = transcribeProgress.value + Math.max(1, (92 - transcribeProgress.value) * 0.08)
    transcribeProgress.value = Math.min(92, next)
  }, 650)
}

function stopTranscribeProgress(done = false) {
  if (transcribeTimer) {
    window.clearInterval(transcribeTimer)
    transcribeTimer = null
  }
  transcribeProgress.value = done ? 100 : 0
}

function readBasket() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BASKET_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

function writeBasket(items) {
  basket.value = items.slice(0, 30)
  localStorage.setItem(BASKET_KEY, JSON.stringify(basket.value))
  window.dispatchEvent(new CustomEvent('usagi:material-basket-updated'))
}

function addMaterialToBasket(title, content, source, jumpToGenerate = false) {
  const text = cleanGarbledText(content)
  if (!text) return showToast('没有可加入素材篮的内容', 'error')
  if (!basket.value.some(item => item.content === text)) {
    writeBasket([{
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      title: cleanGarbledText(title),
      source,
      content: text,
      createdAt: Date.now()
    }, ...basket.value])
  }
  if (jumpToGenerate) activeFlow.value = 'generate'
  showToast('已加入素材篮', 'success')
}

function removeBasketItem(id) {
  writeBasket(basket.value.filter(item => item.id !== id))
}

async function refreshStyles() {
  try {
    const data = await listAccountStyles()
    styles.value = Array.isArray(data.styles) ? data.styles : []
    if (styles.value.length) localStorage.setItem(STYLE_LOCAL_KEY, JSON.stringify(styles.value))
  } catch (e) {
    styles.value = readLocalStyles()
  }
  if (!styles.value.some(style => style.id === selectedStyleId.value)) {
    selectedStyleId.value = styles.value[0]?.id || ''
  }
}

function readLocalStyles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STYLE_LOCAL_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

function selectStyle(id) {
  selectedStyleId.value = id
  localStorage.setItem(SELECTED_STYLE_KEY, id)
}

function useSelectedStyle() {
  if (!selectedStyle.value) return
  selectStyle(selectedStyle.value.id)
  activeFlow.value = 'generate'
  showToast('已选用这个账号风格', 'success')
}

function openStyleManager() {
  activeFlow.value = 'style'
  showStyleManager.value = true
}

function openStyleCreator() {
  showStyleManager.value = false
  showStyleCreator.value = true
}

function closeStyleCreator() {
  showStyleCreator.value = false
}

function selectManagedStyle(id) {
  selectStyle(id)
  activeFlow.value = 'style'
}

function syncStyleCardDraft() {
  const card = selectedStyle.value?.styleCard || {}
  styleCardEditFields.forEach(field => {
    styleCardDraft[field.key] = cleanGarbledText(card[field.key])
  })
}

function openStyleCardModal() {
  if (!selectedStyle.value) return
  syncStyleCardDraft()
  showStyleCardEditor.value = true
}

function closeStyleCardModal() {
  showStyleCardEditor.value = false
}

async function saveStyleCardDraft() {
  if (!selectedStyle.value) return
  try {
    const payload = {}
    styleCardEditFields.forEach(field => {
      payload[field.key] = cleanGarbledText(styleCardDraft[field.key])
    })
    await saveAccountStyleCard(selectedStyle.value.id, payload)
    await refreshStyles()
    showStyleCardEditor.value = false
    showToast('风格卡已保存', 'success')
  } catch (e) {
    showToast('保存风格卡失败：' + (e.message || '未知错误'), 'error')
  }
}

function openSamplesModal() {
  if (!selectedStyle.value) return
  sampleDraft.value = ''
  showSamplesEditor.value = true
}

function closeSamplesModal() {
  showSamplesEditor.value = false
}

async function addSampleFromModal() {
  if (!selectedStyle.value || !sampleDraft.value.trim()) return
  try {
    await addAccountStyleSamples(selectedStyle.value.id, cleanGarbledText(sampleDraft.value))
    sampleDraft.value = ''
    await refreshStyles()
    showToast('样本已添加', 'success')
  } catch (e) {
    showToast('添加样本失败：' + (e.message || '未知错误'), 'error')
  }
}

function requestDeleteSample(sample) {
  if (!selectedStyle.value || !sample) return
  deleteConfirm.value = {
    type: 'sample',
    styleId: selectedStyle.value.id,
    sampleId: sample.id,
    message: `确认删除样本「${sample.title || '未命名样本'}」吗？`
  }
}

function canDeleteStyle(style) {
  if (!style) return false
  const user = currentUser.value
  if (!user) return true
  if (user.role === 'admin') return true
  if (!style.createdBy) return true
  const userId = String(user.id || '')
  return Boolean(style.createdBy && String(style.createdBy) === userId)
}

function requestDeleteStyle(style) {
  if (!canDeleteStyle(style)) {
    showToast('只能删除自己创建的账号', 'error')
    return
  }
  deleteConfirm.value = {
    type: 'style',
    styleId: style.id,
    message: `确认删除账号「${style.name || '未命名账号'}」吗？`
  }
}

async function confirmDelete() {
  const target = deleteConfirm.value
  if (!target) return
  try {
    if (target.type === 'sample') {
      await deleteAccountStyleSample(target.styleId, target.sampleId)
      await refreshStyles()
      showToast('样本已删除', 'success')
    } else if (target.type === 'style') {
      await deleteAccountStyle(target.styleId)
      await refreshStyles()
      if (selectedStyleId.value === target.styleId) selectStyle(styles.value[0]?.id || '')
      showStyleManager.value = true
      showToast('账号已删除', 'success')
    }
    deleteConfirm.value = null
  } catch (e) {
    showToast('删除失败：' + (e.message || '未知错误'), 'error')
  }
}

function startStyleDrag(id) {
  draggingStyleId.value = id
}

async function dropStyle(targetId) {
  const sourceId = draggingStyleId.value
  draggingStyleId.value = ''
  if (!sourceId || sourceId === targetId) return
  const current = styles.value.slice()
  const from = current.findIndex(style => style.id === sourceId)
  const to = current.findIndex(style => style.id === targetId)
  if (from < 0 || to < 0) return
  const [moved] = current.splice(from, 1)
  current.splice(to, 0, moved)
  styles.value = current
  try {
    await saveAccountStyles(current)
    localStorage.setItem(STYLE_LOCAL_KEY, JSON.stringify(current))
    showToast('账号顺序已更新', 'success')
  } catch (e) {
    showToast('排序保存失败：' + (e.message || '未知错误'), 'error')
    await refreshStyles()
  }
}

async function createStyleFromDraft() {
  if (!styleDraft.name.trim()) return showToast('请先填写账号名称', 'error')
  try {
    const data = await createAccountStyle({
      name: styleDraft.name.trim(),
      platform: styleDraft.platform,
      contentType: styleDraft.contentType,
      scene: styleDraft.scene.trim()
    })
    await refreshStyles()
    selectedStyleId.value = data.style?.id || styles.value[0]?.id || ''
    Object.assign(styleDraft, { name: '', platform: '抖音', contentType: '口播', scene: '' })
    showStyleCreator.value = false
    showToast('账号风格已创建', 'success')
  } catch (e) {
    showToast('新建失败：' + (e.message || '未知错误'), 'error')
  }
}

async function runTranscribe() {
  if (!material.url.trim()) return showToast('请先粘贴视频链接', 'error')
  const platform = detectedPlatform.value
  material.platform = platform
  transcribing.value = true
  startTranscribeProgress()
    materialError.value = ''
    transcript.value = ''
    transcriptSourceTitle.value = ''
    transcriptAuthor.value = ''
    try {
    const data = await transcribeVideo(platform, material.url.trim())
    transcript.value = cleanGarbledText(data.text || '')
    transcriptAuthor.value = cleanGarbledText(data.author || '')
    transcriptSourceTitle.value = data.title || data.bvid || (platform === 'douyin' ? '抖音转写稿' : 'B站转写稿')
    if (!transcript.value) throw new Error('没有拿到可用转写文本')
    stopTranscribeProgress(true)
    showToast('转写完成', 'success')
  } catch (e) {
    stopTranscribeProgress(false)
    materialError.value = e.message || '转写失败'
    showToast(materialError.value, 'error')
  } finally {
    transcribing.value = false
  }
}

function cleanTranscript() {
  const fixed = cleanTranscriptText(transcript.value)
  if (!fixed) return showToast('没有可清洗的内容', 'error')
  transcript.value = fixed
  showToast('清洗分段完成', 'success')
}

function addTranscriptToBasket() {
  if (sourceType.value === 'brief') {
    addMaterialToBasket(brief.title || '商单 BF', transcript.value, 'brief')
    return
  }
  const platform = detectedPlatform.value
  const title = transcriptSourceTitle.value || (platform === 'bilibili' ? 'B站转写稿' : '抖音转写稿')
  addMaterialToBasket(title, transcript.value, platform)
}

function goGenerateFromMaterial() {
  if (sourceType.value === 'brief') {
    addMaterialToBasket(brief.title || '商单 BF', transcript.value, 'brief', true)
    return
  }
  const platform = detectedPlatform.value
  const title = transcriptSourceTitle.value || (platform === 'bilibili' ? 'B站转写稿' : '抖音转写稿')
  addMaterialToBasket(title, transcript.value, platform, true)
}

async function writeTranscriptToFeishu() {
  if (!transcript.value) return
  if (sourceType.value === 'brief') {
    try {
      const d = await writeFeishu({ tool: 'docx', title: brief.title || '商单 BF', content: transcript.value, doc_id: '' })
      if (d.doc_url) {
        showToast(`å·²å†™å…¥é£žä¹¦: ${d.doc_url}`, 'success', true)
      } else {
        showToast(d.error || 'å†™å…¥å¤±è´¥', 'error')
      }
    } catch (e) {
      showToast('å†™å…¥å¤±è´¥: ' + e.message, 'error')
    }
    return
  }
  const platform = detectedPlatform.value
  const title = transcriptSourceTitle.value || (platform === 'bilibili' ? 'B站转写稿' : '抖音转写稿')
  try {
    const d = await writeFeishu({ tool: 'docx', title: title, content: transcript.value, doc_id: '' })
    if (d.doc_url) {
      showToast(`已写入飞书: ${d.doc_url}`, 'success', true)
    } else {
      showToast(d.error || '写入失败', 'error')
    }
  } catch (e) {
    showToast('写入失败: ' + e.message, 'error')
  }
}

async function runStyleAnalyze() {
  if (!selectedStyle.value) return
  styleAnalyzing.value = true
  try {
    await analyzeAccountStyle(selectedStyle.value.id)
    await refreshStyles()
    showToast('风格分析完成', 'success')
  } catch (e) {
    showToast('分析失败：' + (e.message || '未知错误'), 'error')
  } finally {
    styleAnalyzing.value = false
  }
}

async function confirmSelectedStyle() {
  if (!selectedStyle.value) return
  try {
    await confirmAccountStyle(selectedStyle.value.id, selectedStyle.value.styleCard)
    await refreshStyles()
    showToast('账号风格已启用', 'success')
  } catch (e) {
    showToast('保存失败：' + (e.message || '未知错误'), 'error')
  }
}

async function generateAngles() {
  if (!canGenerateAngles.value) return
  angleLoading.value = true
  output.value = ''
  try {
    const data = await generateCopygenAngles({
      style: selectedStyle.value,
      requirement: cleanGarbledText(task.note) || '做一条新文案',
      material: materialText.value,
      length: task.length,
      strength: task.strength
    })
    angles.value = data.angles || []
    selectedAngleId.value = angles.value[0]?.id || ''
    activeFlow.value = 'generate'
  } catch (e) {
    showToast('生成切角失败：' + (e.message || '未知错误'), 'error')
  } finally {
    angleLoading.value = false
  }
}

async function generateCopy() {
  if (!canGenerateCopy.value) return
  copyLoading.value = true
  try {
    const requirement = cleanGarbledText(task.note) || '做一条新文案'
    const data = await generateCopygenText({
      style: selectedStyle.value,
      requirement,
      material: materialText.value,
      angle: currentAngle.value,
      length: task.length,
      strength: task.strength
    })
    output.value = cleanGarbledText(data.output || '')
    await incrementAccountStyleUsage(selectedStyle.value.id).catch(() => {})
    await saveOutputRecord()
    activeFlow.value = 'generate'
  } catch (e) {
    showToast('生成正文失败：' + (e.message || '未知错误'), 'error')
  } finally {
    copyLoading.value = false
  }
}

async function saveOutputRecord() {
  if (!output.value.trim()) return
  await addCopygenRecord({
    styleId: selectedStyle.value?.id || '',
    styleName: selectedStyle.value?.name || '',
    requirement: task.note || '文案生成记录',
    material: materialText.value,
    angle: currentAngle.value,
    output: output.value,
    length: task.length,
    strength: task.strength
  }).catch(() => {})
  await loadRecords()
  showToast('成稿已保存', 'success')
}

async function saveOutputAsSample() {
  if (!selectedStyle.value || !output.value.trim()) return
  try {
    await addAccountStyleSamples(selectedStyle.value.id, output.value)
    await refreshStyles()
    showToast('成稿已存为账号样本', 'success')
  } catch (e) {
    showToast('保存样本失败：' + (e.message || '未知错误'), 'error')
  }
}


async function generatePublishRecommendation() {
  if (!output.value.trim()) return
  publishLoading.value = true
  try {
    const data = await generateCopygenPublishRecommend({
      copy: output.value,
      context: materialText.value,
      style: selectedStyle.value,
      captionMax: publishSettings.captionMax,
      introMax: publishSettings.introMax
    })
    publishRecommendation.value = cleanGarbledText(data.recommendation || '')
    showToast('发布推荐已生成', 'success')
  } catch (e) {
    showToast('发布推荐生成失败：' + (e.message || '模型无返回'), 'error')
  } finally {
    publishLoading.value = false
  }
}

async function generateOutputComments() {
  if (!output.value.trim()) return
  commentLoading.value = true
  comments.value = []
  try {
    const accountName = transcriptAuthor.value || selectedStyle.value?.name || ''
    const data = await generateComments({
      script: output.value,
      count: 30,
      account: accountName,
      scenario: '成稿配套评论'
    })
    comments.value = (data.comments || []).map(cleanGarbledText).filter(Boolean)
    showToast('评论已生成', 'success')
  } catch (e) {
    showToast('评论生成失败：' + (e.message || '未知错误'), 'error')
  } finally {
    commentLoading.value = false
  }
}

async function loadRecords() {
  try {
    const data = await listCopygenRecords()
    records.value = data.records || []
  } catch (e) {
    records.value = []
  }
}

function useRecord(record) {
  const payload = record.payload || {}
  task.title = cleanGarbledText(payload.requirement || record.title || '')
  task.note = cleanGarbledText(payload.material || '')
  output.value = cleanGarbledText(payload.output || '')
  if (payload.styleId) selectedStyleId.value = payload.styleId
  angles.value = payload.angle ? [payload.angle] : []
  selectedAngleId.value = payload.angle?.id || ''
  activeFlow.value = 'generate'
}

function statusClass(status) {
  return {
    enabled: status === '可用',
    pending: status === '待确认',
    draft: status === '待分析'
  }
}

function formatTime(value) {
  if (!value) return ''
  return new Date(Number(value) * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  refreshStyles()
  loadRecords()
  window.addEventListener('usagi:material-basket-updated', () => {
    basket.value = readBasket()
  })
})

onBeforeUnmount(() => {
  stopTranscribeProgress(false)
})
</script>

<style scoped>
.copy-workbench-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--text);
}

.workbench-header {
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0;
}

.workbench-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.workbench-actions button,
.panel-head b {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-muted);
  padding: 0 10px;
  font-size: 12px;
  font-weight: 800;
}

.workbench-actions button {
  cursor: pointer;
  font-family: inherit;
}

.workbench-actions button:hover {
  border-color: var(--border-bright);
  color: var(--primary-light);
}

.flow-track {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  padding: 4px;
}

.flow-node {
  min-width: 0;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 850;
}

.flow-node span {
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: left;
}

.flow-node strong,
.flow-node small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-node strong {
  font-size: 13px;
  line-height: 1.15;
}

.flow-node small {
  font-size: 10px;
  font-weight: 750;
  opacity: 0.72;
}

.flow-node:focus {
  outline: none;
}

.flow-node:focus-visible {
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.flow-node i {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--chip-bg);
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
}

.flow-node.active {
  background: var(--primary-gradient);
  color: #fff;
  box-shadow: 0 8px 18px var(--primary-shadow);
}

.flow-node.done i,
.flow-node.active i {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.flow-node b {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--success-bg);
  color: var(--success-text);
  font-size: 11px;
}

.workbench-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(420px, 1.15fr) minmax(420px, 1.18fr);
  gap: 16px;
  flex: 1;
  overflow: hidden;
}

.work-panel,
.record-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-bg);
  padding: 16px;
  overflow: hidden;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.12);
}

.work-panel {
  overflow-y: auto;
}

.records-view {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  padding: 14px;
  overflow: hidden;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.12);
}

.records-view .record-list {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  flex: 1;
}

.record-toolbar {
  display: flex;
  gap: 8px;
}

.work-panel.focused {
  border-color: var(--border-bright);
  box-shadow: inset 0 3px 0 var(--primary), 0 18px 36px rgba(0, 0, 0, 0.16);
}

.panel-head,
.sub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.panel-head span,
.sub-head span,
.field-block span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.panel-head > div > span {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--primary-gradient);
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}

.panel-head > div {
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-head h3,
.panel-head strong,
.sub-head strong {
  display: block;
  margin-top: 3px;
  color: var(--text);
  font-size: 15px;
  line-height: 1.3;
}

.panel-head h3 {
  margin-top: 0;
  font-size: 18px;
  font-weight: 900;
}

.platform-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.platform-tabs button {
  height: 42px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  font-weight: 850;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
}

.platform-tabs button.active {
  border-color: var(--border-bright);
  background: var(--active-bg);
  color: var(--primary-light);
  transform: translateY(-1px);
}

.platform-tabs span {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  margin-right: 6px;
  border-radius: 6px;
  background: var(--surface3);
  color: var(--text);
  font-size: 11px;
}

.source-row,
.option-row,
.generate-actions,
.delivery-actions,
.style-actions,
.mini-actions,
.panel-actions {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.source-type-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
  border-radius: 14px;
  background:
    radial-gradient(circle at 18% 0%, color-mix(in srgb, var(--primary) 13%, transparent), transparent 48%),
    color-mix(in srgb, var(--panel-bg-soft) 92%, transparent);
}

.source-type-tabs button {
  min-height: 38px;
  border: 1px solid transparent;
  border-radius: 11px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface2) 72%, transparent), color-mix(in srgb, var(--panel-bg) 92%, transparent));
  color: var(--text-dim);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 900;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
}

.source-type-tabs button:hover {
  border-color: var(--border-bright);
  color: var(--text);
  background:
    radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--primary-light) 15%, transparent), transparent 58%),
    color-mix(in srgb, var(--surface2) 88%, var(--panel-bg));
  transform: translateY(-1px);
}

.source-type-tabs button.active {
  border-color: var(--border-bright);
  background:
    radial-gradient(circle at 18% 16%, rgba(255, 255, 255, 0.22), transparent 34%),
    var(--primary-gradient);
  color: var(--btn-primary-text, #fff);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 10px 24px color-mix(in srgb, var(--primary) 28%, transparent);
}

.source-row .inp,
.option-row .inp {
  min-width: 0;
}

.source-row .inp {
  flex: 1;
}

.merged-source {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
}

.brief-source-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.brief-source-badge {
  min-width: 48px;
  justify-content: center;
  color: var(--primary-light);
}

.detected-platform {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  font-weight: 850;
  padding: 0 10px;
  white-space: nowrap;
}

.generate-actions .btn,
.delivery-actions .btn,
.style-actions .btn {
  flex: 1;
}

.transcript-card,
.search-card,
.basket-box,
.angle-section,
.editor-card,
.delivery-card {
  display: grid;
  gap: 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  padding: 10px;
}

.primary-block {
  border-color: var(--border-bright);
  background: var(--active-bg);
}

.featured-editor {
  border-color: var(--border-bright);
  background: linear-gradient(180deg, var(--active-bg), var(--panel-bg-soft));
  box-shadow: inset 0 3px 0 var(--primary), 0 10px 24px rgba(0, 0, 0, 0.08);
}

.featured-editor .output-box {
  min-height: 210px;
}

.assist-block {
  background: var(--panel-bg);
}

.transcript-box,
.output-box,
.note-box {
  resize: none;
  line-height: 1.65;
}

.output-box {
  transition: height 0.2s ease;
  overflow: hidden;
}

.transcript-tools {
  min-width: 210px;
  display: grid;
  grid-template-columns: auto auto minmax(62px, 1fr) auto;
  align-items: center;
  gap: 6px;
}

.transcript-tools button {
  min-width: 42px;
  min-height: 26px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  font-weight: 850;
  padding: 0 8px;
  white-space: nowrap;
}

.transcript-tools button:not(:disabled):hover {
  border-color: var(--border-bright);
  color: var(--primary-light);
}

.transcript-tools button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.panel-actions .btn-feishu {
  color: var(--text-dim);
  border: 1px solid var(--border);
  background: transparent;
}

.panel-actions .btn-feishu:hover:not(:disabled) {
  color: var(--primary-light);
  border-color: var(--primary);
}

.material-progress {
  position: relative;
  width: 100%;
  height: 6px;
  min-width: 58px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface3);
}

.material-progress i {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  border-radius: inherit;
  background: var(--primary-gradient);
  transition: width 0.24s ease;
}

.transcript-tools small {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 850;
  white-space: nowrap;
}

.mini-actions {
  flex-wrap: wrap;
}

.panel-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.inline-error {
  margin: 0;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--danger-text);
  padding: 8px 10px;
  font-size: 12px;
}

.search-results,
.basket-list,
.comment-list {
  display: grid;
  gap: 7px;
}

.search-results article,
.basket-list article,
.record-card {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 9px;
}

.search-results span,
.record-card span {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
}

.search-results p,
.basket-list p,
.record-card p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.style-body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(155px, 0.72fr) minmax(230px, 1.28fr);
  gap: 10px;
  flex: 1;
  overflow: hidden;
}

.style-list {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.style-filter {
  display: grid;
  gap: 5px;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel-bg);
  padding-bottom: 4px;
}

.style-filter span {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 900;
}

.style-filter select {
  min-height: 34px;
  font-size: 12px;
}

.style-item {
  min-width: 0;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  padding: 8px;
  text-align: left;
}

.style-item.active {
  border-color: var(--border-bright);
  background: var(--active-bg);
}

.style-item strong,
.basket-list strong,
.record-card strong {
  display: block;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.style-item small {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 10px;
}

.style-manage-btn {
  min-height: 38px;
  margin-top: auto;
  border: 1px dashed var(--border-mid);
  border-radius: 8px;
  background: var(--panel-bg);
  color: var(--primary-light);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 850;
}

.style-manage-btn:hover {
  border-color: var(--border-bright);
  background: var(--active-bg);
}

.style-item em {
  grid-column: 2;
  width: fit-content;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  padding: 3px 7px;
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
}

.style-item em.enabled {
  border-color: var(--success-border);
  background: var(--success-bg);
  color: var(--success-text);
}

.style-item em.pending {
  border-color: var(--warning-border);
  background: var(--warning-bg);
  color: var(--warning-text);
}

.tab-platform-mark,
.platform-mark,
.identity-logo {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 7px;
  color: #fff;
  font-weight: 900;
}

.platform-mark {
  width: 28px;
  height: 28px;
  font-size: 12px;
}

.identity-logo {
  width: 38px;
  height: 38px;
}

.tab-platform-mark::before,
.platform-mark::before,
.identity-logo::before {
  position: relative;
  z-index: 1;
  display: block;
  line-height: 1;
}

.tab-platform-mark.douyin,
.platform-mark.douyin,
.identity-logo.douyin {
  background: #07090f;
  box-shadow: inset -4px -4px 0 rgba(255, 46, 85, 0.55), inset 4px 4px 0 rgba(37, 244, 238, 0.5);
}

.tab-platform-mark.douyin::before,
.platform-mark.douyin::before,
.identity-logo.douyin::before {
  content: "♪";
  color: #fff;
  text-shadow: -1px 0 #25f4ee, 1px 0 #ff2e55;
}

.tab-platform-mark.douyin::before,
.platform-mark.douyin::before {
  font-size: 18px;
}

.identity-logo.douyin::before {
  font-size: 24px;
}

.tab-platform-mark.bili,
.platform-mark.bili,
.identity-logo.bili {
  border-radius: 8px;
  background: #00a1d6;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.82);
}

.tab-platform-mark.bili::before,
.platform-mark.bili::before,
.identity-logo.bili::before {
  content: "bili";
  color: #fff;
  font-family: ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
  letter-spacing: 0;
}

.tab-platform-mark.bili::before,
.platform-mark.bili::before {
  font-size: 9px;
}

.identity-logo.bili::before {
  font-size: 12px;
}

.style-detail-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  padding: 10px;
}

.style-identity {
  display: flex;
  align-items: center;
  gap: 9px;
}

.style-identity div {
  min-width: 0;
  flex: 1;
}

.style-identity b {
  flex: 0 0 auto;
  border: 1px solid var(--success-border);
  border-radius: 999px;
  background: var(--success-bg);
  color: var(--success-text);
  padding: 4px 8px;
  font-size: 11px;
}

.style-identity strong {
  display: block;
  color: var(--text);
  font-size: 15px;
}

.style-identity span:last-child {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.style-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.style-metrics button {
  min-width: 0;
  min-height: 64px;
  display: grid;
  align-content: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: linear-gradient(180deg, var(--surface), var(--panel-bg-soft));
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.08);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  padding: 9px;
  text-align: left;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.style-metrics button:hover {
  border-color: var(--border-bright);
  transform: translateY(-1px);
}

.style-metrics button.done {
  border-color: var(--success-border);
  background: var(--success-bg);
}

.style-metrics span {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 900;
}

.style-metrics strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 14px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.style-metrics button.done strong {
  color: var(--success-text);
}

.style-summary {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  padding: 0;
  text-align: left;
}

.style-summary div {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: linear-gradient(180deg, var(--surface), var(--panel-bg));
  padding: 10px;
  transition: transform 0.16s ease, border-color 0.16s ease;
}

.style-summary:hover div {
  border-color: var(--border-bright);
  transform: translateY(-1px);
}

.style-summary span {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 900;
}

.style-summary p {
  margin: 4px 0 0;
  color: var(--text);
  font-size: 12px;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.style-actions {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: auto;
  background: var(--panel-bg-soft);
  padding-top: 8px;
}

.style-actions .btn-primary {
  grid-column: 1 / -1;
}

.style-create-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.generate-settings {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  padding: 10px;
}

.requirement-toggle {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  padding: 0 10px;
}

.requirement-toggle span {
  font-size: 12px;
  font-weight: 900;
}

.requirement-toggle strong {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 850;
}

.setting-groups {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(150px, 0.65fr);
  gap: 8px;
}

.select-field {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.select-field span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.select-field select {
  min-height: 40px;
  cursor: pointer;
}

.segmented {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  padding: 4px;
}

.segmented button {
  min-width: 0;
  min-height: 34px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 850;
}

.segmented button.active {
  background: var(--primary-gradient);
  color: #fff;
  box-shadow: 0 6px 14px var(--primary-shadow);
}

.field-block {
  display: grid;
  gap: 6px;
}

.angle-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.generate-panel .angle-list {
  grid-template-columns: 1fr;
}

.angle-card {
  min-width: 0;
  display: grid;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  padding: 10px;
  text-align: left;
}

.angle-card.active {
  border-color: var(--border-bright);
  background: var(--active-bg);
  box-shadow: inset 3px 0 0 var(--primary);
}

.angle-card span {
  color: var(--primary-light);
  font-size: 10px;
  font-weight: 900;
}

.angle-card strong {
  color: var(--text);
  font-size: 13px;
}

.angle-card p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.empty-box {
  min-height: 48px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--border-mid);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  padding: 10px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel-bg);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.plain-action {
  border: 0;
  background: transparent;
  color: var(--primary-light);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 850;
}


.publish-recommend-card {
  border-color: color-mix(in srgb, var(--primary) 36%, var(--border));
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--primary) 10%, transparent), transparent),
    var(--panel-bg-soft);
}

.publish-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  align-items: end;
}

.publish-settings label {
  display: grid;
  gap: 5px;
}

.publish-settings span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 850;
}

.publish-settings p {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.publish-output {
  min-height: 150px;
  resize: vertical;
  line-height: 1.65;
}

.comment-list button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  padding: 8px 10px;
  text-align: left;
}

.record-panel {
  flex: 0 0 auto;
  max-height: 190px;
}

.record-panel.expanded {
  max-height: 260px;
  border-color: var(--border-bright);
}

.record-list {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  overflow-y: auto;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.24);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 24px;
}

.style-modal {
  width: min(460px, 100%);
  display: grid;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-bg-hover);
  box-shadow: var(--shadow-lg);
  padding: 16px;
}

.style-modal header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.style-modal h3 {
  margin: 0;
  color: var(--text);
  font-size: 18px;
}

.modal-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.manager-modal {
  width: min(520px, 100%);
}

.manager-list {
  max-height: 420px;
  display: grid;
  gap: 8px;
  overflow-y: auto;
}

.manager-item {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text);
  cursor: grab;
  font-family: inherit;
  padding: 8px;
  text-align: left;
}

.manager-item.active {
  border-color: var(--border-bright);
  background: var(--active-bg);
}

.manager-select {
  min-width: 0;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
  padding: 2px;
  text-align: left;
}

.manager-select strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manager-select em {
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  padding: 4px 8px;
  font-size: 11px;
  font-style: normal;
  font-weight: 850;
}

.manager-select em.enabled {
  border-color: var(--success-border);
  background: var(--success-bg);
  color: var(--success-text);
}

.manager-select em.pending {
  border-color: var(--warning-border);
  background: var(--warning-bg);
  color: var(--warning-text);
}

.manager-delete {
  min-height: 30px;
  border: 1px solid var(--danger-border);
  border-radius: 7px;
  background: var(--danger-bg);
  color: var(--danger-text);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 850;
  padding: 0 10px;
}

.manager-delete:disabled {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text-muted);
  cursor: not-allowed;
  opacity: 0.46;
}

.card-modal {
  width: min(900px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  overflow: hidden;
}

.modal-title-with-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-title-with-logo small,
.samples-modal header small {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.card-editor-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  overflow-y: auto;
  padding-right: 2px;
}

.card-editor-grid label {
  min-width: 0;
  display: grid;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: linear-gradient(180deg, var(--surface), var(--panel-bg-soft));
  padding: 10px;
}

.card-editor-grid label:first-child,
.card-editor-grid label:nth-child(5) {
  grid-column: auto;
}

.card-editor-grid span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.card-editor-grid textarea {
  min-height: 130px;
  border-color: transparent;
  background: transparent;
  padding: 0;
  resize: vertical;
}

.samples-modal {
  width: min(900px, 100%);
  height: min(820px, calc(100vh - 48px));
  grid-template-rows: auto auto auto minmax(0, 1fr);
  overflow: hidden;
}

.sample-input {
  resize: vertical;
}

.sample-list {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 8px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
}

.sample-list article {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 10px;
}

.sample-list strong {
  display: block;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sample-list p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.confirm-modal {
  width: min(420px, 100%);
}

.confirm-modal p {
  margin: 0;
  color: var(--text);
  line-height: 1.6;
}

.danger-action {
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger-text);
}

@media (max-width: 1320px) {
  .workbench-grid {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .work-panel {
    min-height: 520px;
  }

  .record-list {
    grid-template-columns: 1fr;
  }

  .records-view .record-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .workbench-header,
  .panel-head,
  .sub-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .flow-track,
  .angle-list,
  .style-body,
  .style-metrics,
  .style-summary,
  .card-editor-grid,
  .panel-actions,
  .generate-settings,
  .setting-groups,
  .record-list {
    grid-template-columns: 1fr;
  }

  .source-row,
  .option-row,
  .generate-actions,
  .delivery-actions,
  .style-actions,
  .panel-actions,
  .mini-actions {
    flex-direction: column;
    width: 100%;
  }

  .source-row .btn,
  .generate-actions .btn,
  .delivery-actions .btn,
  .style-actions .btn,
  .panel-actions .btn {
    width: 100%;
  }

  .merged-source {
    grid-template-columns: 1fr;
  }

  .detected-platform {
    justify-content: center;
    width: 100%;
  }

  .transcript-tools {
    width: 100%;
    grid-template-columns: auto auto minmax(80px, 1fr);
  }

  .transcript-tools small {
    display: none;
  }

  .card-editor-grid label:first-child,
  .card-editor-grid label:nth-child(5) {
    grid-column: auto;
  }
}
</style>
