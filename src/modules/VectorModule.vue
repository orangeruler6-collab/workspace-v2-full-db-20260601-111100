<template>
  <div class="vector-page">
    <header class="module-page-header vector-header">
      <div class="module-page-title">
        <span class="module-page-icon">🧠</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">VECTOR LIBRARY</div>
          <h2>向量库录入台</h2>
          <p>把文案、BF 方向、案例拆成子模块沉淀，先稳定录入，再接检索、推荐和后续智能调用。</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost" @click="loadList">刷新</button>
        <button class="btn btn-primary" @click="focusEditor">录入当前子库</button>
      </div>
    </header>

    <section class="vector-shell">
      <aside class="vector-subnav">
        <div class="subnav-title">
          <span>子模块</span>
          <strong>{{ totalCount }} 条</strong>
        </div>
        <button
          v-for="cfg in collections"
          :key="cfg.key"
          class="subnav-item"
          :class="{ active: curCollection === cfg.key }"
          @click="switchCollection(cfg.key)">
          <span class="subnav-icon">{{ cfg.icon }}</span>
          <span class="subnav-copy">
            <strong>{{ cfg.title }}</strong>
            <small>{{ cfg.short }}</small>
          </span>
          <em>{{ counts[cfg.key] || 0 }}</em>
        </button>
      </aside>

      <main class="vector-content">
        <div class="content-top">
          <div>
            <div class="section-kicker">{{ currentConfig.kicker }}</div>
            <h3>{{ currentConfig.title }}</h3>
            <p>{{ currentConfig.desc }}</p>
          </div>
          <div class="content-tags">
            <span v-for="tag in currentConfig.tags" :key="tag">{{ tag }}</span>
          </div>
        </div>

        <div class="workspace">
          <aside class="editor-panel" ref="editorPanel">
            <div class="panel-head">
              <div>
                <div class="panel-kicker">{{ currentConfig.title }}</div>
                <h3>{{ editId ? '编辑记录' : '快速录入' }}</h3>
              </div>
              <button v-if="editId" class="mini-btn" @click="resetForm">退出编辑</button>
            </div>

            <section v-if="curCollection === 'wenan'" class="collector-box">
              <div class="collector-head">
                <div>
                  <strong>账号采集</strong>
                  <span>先拉作品列表，勾选后再转写解析，确认后入库。</span>
                </div>
                <button class="mini-btn" @click="clearCollector">清空采集</button>
              </div>
              <div class="collector-grid">
                <label class="field compact-field">
                  <span>平台</span>
                  <select class="inp" v-model="collector.platform">
                    <option value="douyin">抖音</option>
                    <option value="bilibili">B站</option>
                  </select>
                </label>
                <label class="field compact-field">
                  <span>数量</span>
                  <input class="inp" type="number" min="1" max="20" v-model.number="collector.limit" />
                </label>
              </div>
              <label class="field">
                <span>账号名 / UID / 主页链接</span>
                <input class="inp" v-model="collector.account" placeholder="抖音建议填 sec_uid 或主页链接；B站可填 UID / 用户名" />
              </label>
              <div class="source-actions">
                <button class="btn btn-ghost" :disabled="collecting || !collector.account.trim()" @click="collectAccountVideos">
                  {{ collecting ? '采集中...' : '拉取作品列表' }}
                </button>
                <button class="btn btn-primary" :disabled="preparing || !selectedCollectedItems.length" @click="prepareSelectedVideos">
                  {{ preparing ? '转写解析中...' : `转写解析 ${selectedCollectedItems.length} 条` }}
                </button>
              </div>
              <div v-if="collectorStatus" class="source-status" :class="{ error: collectorStatusType === 'error' }">{{ collectorStatus }}</div>
              <div v-if="collectedItems.length" class="collect-list">
                <label v-for="item in collectedItems" :key="item.id || item.url" class="collect-row">
                  <input type="checkbox" v-model="selectedCollectedIds" :value="item.id || item.url" />
                  <span>
                    <strong>{{ item.title || '未命名作品' }}</strong>
                    <small>{{ item.url || item.play_url || item.id }}</small>
                  </span>
                </label>
              </div>
              <div v-if="preparedDrafts.length" class="draft-list">
                <div class="draft-head">
                  <strong>待确认草稿</strong>
                  <span>{{ preparedDrafts.length }} 条</span>
                </div>
                                <article v-for="draft in preparedDrafts" :key="draft.id || draft.url" class="draft-card draft-card-editable">
                  <div class="draft-edit-grid">
                    <label class="draft-field">
                      <span>账号</span>
                      <input class="inp" v-model="draft.account" :placeholder="collector.account || form.account || '请填写账号'" />
                    </label>
                    <label class="draft-field">
                      <span>标题 / 钩子</span>
                      <input class="inp" v-model="draft.title" placeholder="这条文案的标题或开头钩子" />
                    </label>
                    <label class="draft-field full">
                      <span>摘要 / 金句</span>
                      <textarea class="inp" v-model="draft.summary" rows="2" placeholder="可编辑摘要、金句或提炼结果"></textarea>
                    </label>
                    <label class="draft-field full">
                      <span>转写原文 / 文案内容</span>
                      <textarea class="inp" v-model="draft.original_text" rows="4" placeholder="可编辑后再确认入库"></textarea>
                    </label>
                    <label class="draft-field">
                      <span>标签</span>
                      <input class="inp" v-model="draft.tags" placeholder="标签，用逗号分隔" />
                    </label>
                    <label class="draft-field">
                      <span>搜索词</span>
                      <input class="inp" v-model="draft.search_query" placeholder="后续检索关键词" />
                    </label>
                    <small v-if="draft.url" class="draft-link">{{ draft.url }}</small>
                    <small v-if="draft.transcript_error" class="draft-warning">{{ draft.transcript_error }}</small>
                  </div>
                  <button class="mini-btn" :disabled="confirmingDraftId === draft.id" @click="confirmDraft(draft)">
                    {{ confirmingDraftId === draft.id ? '保存中...' : '确认入库' }}
                  </button>
                </article>
              </div>
            </section>

            <div class="form-grid">
              <label class="field">
                <span>账号</span>
                <input class="inp" v-model="form.account" placeholder="必填，用于后续生成账号风格卡" />
              </label>
              <label v-if="curCollection !== 'wenan'" class="field">
                <span>{{ form.itemType === 'style_card' ? '风格来源' : '子类' }}</span>
                <select class="inp" v-model="form.scene">
                  <option v-for="scene in availableScenes" :key="scene" :value="scene">{{ scene }}</option>
                </select>
              </label>
            </div>

            <template v-if="curCollection === 'wenan'">
              <label class="field">
                <span>飞书链接</span>
                <input class="inp" v-model="form.feishu_link" placeholder="粘贴飞书文档链接，可选" />
              </label>
              <label class="field">
                <span>原文</span>
                <textarea class="inp tall" v-model="form.source" placeholder="可一次粘贴多篇文案，AI 会自动拆分成多条待确认草稿"></textarea>
              </label>
              <label class="field">
                <span>抖音 / B站链接</span>
                <input class="inp" v-model="form.link" placeholder="粘贴抖音、B站或 b23 链接，可选" />
              </label>
              <div class="source-actions">
                <button class="btn btn-ghost" :disabled="extractingSource || !hasExtractableSource" @click="extractSources">
                  {{ extractingSource ? '处理中...' : '提取/转写来源' }}
                </button>
                <span v-if="sourceStatus" class="source-status" :class="{ error: sourceStatusType === 'error' }">{{ sourceStatus }}</span>
              </div>
            </template>

            <template v-else-if="curCollection === 'bf'">
              <label class="field">
                <span>内容方向</span>
                <textarea class="inp tall" v-model="form.content_direction" placeholder="这条 BF 内容要往哪个创作方向走..."></textarea>
              </label>
              <label class="field">
                <span>营销目标</span>
                <input class="inp" v-model="form.marketing_target" placeholder="引流私域 / 产品种草 / 品牌曝光..." />
              </label>
              <label class="field">
                <span>补充说明</span>
                <textarea class="inp source" v-model="form.source" placeholder="可填参考链接、背景、投放要求"></textarea>
              </label>
            </template>

            <template v-else>
              <label class="field">
                <span>案例标签</span>
                <input class="inp" v-model="form.case_tags" placeholder="爆款, 低播放, 数据复盘..." />
              </label>
              <label class="field">
                <span>AI 解析 / 案例结论</span>
                <textarea class="inp tall" v-model="form.content" placeholder="这个案例为什么值得收录，核心经验是什么..."></textarea>
              </label>
              <label class="field">
                <span>案例链接</span>
                <input class="inp" v-model="form.link" placeholder="视频链接、飞书链接或素材地址" />
              </label>
            </template>

            <details class="ai-box">
              <summary>AI 辅助解析</summary>
              <textarea class="inp ai-raw" v-model="aiRaw" placeholder="把原始文案、案例描述或 BF 需求粘进来，AI 会按当前子库字段拆出来。"></textarea>
              <div class="ai-actions">
                <button class="btn btn-ghost" :disabled="analyzing || !aiRaw.trim()" @click="runAnalyze">
                  {{ analyzing ? '解析中...' : 'AI 拆字段' }}
                </button>
                <span v-if="analyzeError" class="error-text">{{ analyzeError }}</span>
              </div>
            </details>

            <div class="submit-row">
              <button class="btn btn-ghost" @click="resetForm">清空</button>
              <button class="btn btn-primary" :disabled="saving || !canSubmit" @click="saveItem">
                {{ saving ? '处理中...' : editId ? '保存修改' : curCollection === 'wenan' ? 'AI拆分生成草稿' : '入库' }}
              </button>
            </div>
          </aside>

          <section class="data-panel">
            <div class="toolbar">
              <div class="toolbar-left">
                <h3>{{ currentConfig.title }}数据</h3>
                <span>{{ listD.length }} / {{ currentTotal }} 条</span>
              </div>
              <div class="filters">
                <input class="inp search" v-model="keyword" placeholder="搜索内容 / 标签 / 链接" />
                <select class="inp compact" v-model="filterAccount">
                  <option value="">全部账号</option>
                  <option v-for="account in accountOptions" :key="account" :value="account">{{ account }}</option>
                </select>
                <select v-if="curCollection !== 'wenan'" class="inp compact" v-model="filterScene">
                  <option value="">全部子类</option>
                  <option v-for="scene in sceneOptions" :key="scene" :value="scene">{{ scene }}</option>
                </select>
              </div>
            </div>

            <div class="stats-strip">
              <div class="stat">
                <strong>{{ currentTotal }}</strong>
                <span>当前子库</span>
              </div>
              <div class="stat">
                <strong>{{ accountOptions.length }}</strong>
                <span>账号数</span>
              </div>
              <div v-if="curCollection !== 'wenan'" class="stat">
                <strong>{{ sceneOptions.length }}</strong>
                <span>子类数</span>
              </div>
            </div>

            <div v-if="curCollection !== 'wenan' && styleCards.length" class="style-card-strip">
              <div class="strip-head">
                <span>风格卡</span>
                <strong>{{ styleCards.length }} 张</strong>
              </div>
              <button
                v-for="card in styleCards.slice(0, 4)"
                :key="card.id"
                class="style-card-preview"
                @click="editItem(card)">
                <strong>{{ card.account || '通用' }}</strong>
                <span>{{ card.content || card.hook || '未填写风格定位' }}</span>
              </button>
            </div>

            <div v-if="loading" class="empty-state">正在加载...</div>
            <div v-else-if="!listD.length" class="empty-state">
              <strong>还没有可显示的数据</strong>
              <span>切换筛选条件，或者先在左侧录入第一条。</span>
            </div>
            <div v-else class="record-list">
              <article
                v-for="item in listD"
                :key="item.id"
                class="record-card"
                :class="{ 'is-style-card': item.type === 'style_card' }">
                <div class="record-main">
                  <div class="record-title">{{ mainTitle(item) }}</div>
                  <p class="record-summary">{{ originalPreview(item) }}</p>
                  <div class="record-meta">
                    <span>{{ item.account || '通用' }}</span>
                    <span v-if="originalText(item)" class="source-chip">原文 {{ originalText(item).length }} 字</span>
                  </div>
                  <details v-if="originalText(item)" class="record-original">
                    <summary>查看原文</summary>
                    <pre>{{ originalText(item) }}</pre>
                  </details>
                </div>
                <div class="record-actions">
                  <button class="mini-btn" @click="editItem(item)">编辑</button>
                  <button class="mini-btn danger" @click="removeItem(item)">删除</button>
                </div>
              </article>
            </div>
            <div v-if="!loading && hasMore" class="load-more-row">
              <button class="btn btn-ghost" @click="loadMore">加载更多</button>
            </div>
          </section>
        </div>
      </main>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  addVectorItem,
  analyzeVectorText,
  collectVectorAccount,
  deleteVectorItem,
  getVectorFacets,
  getVectorItem,
  getVectorStats,
  listVectorItems,
  prepareVectorAccountItems,
  prepareVectorCopyItems
} from '../api/vector'
import { readFeishu, transcribeVideo } from '../api/tools'
import { useConfirm } from '../composables/useConfirm'
import { useToast } from '../composables/useToast'
import { cleanTranscriptText } from './tools/textCleanup'

const confirmAction = useConfirm()
const { showToast } = useToast()

const collections = [
  {
    key: 'wenan',
    title: '文案库',
    short: '原文 / 标题 / 标签',
    icon: '✍️',
    kicker: 'COPY BASE',
    desc: '用户只提供原文、飞书或视频链接；AI 自动拆分多篇文案，并生成标题、标签和概括。',
    tags: ['原文', '飞书链接', '抖音/B站', 'AI拆分']
  },
  {
    key: 'bf',
    title: 'BF库',
    short: '目标 / 方向 / 参考',
    icon: '📋',
    kicker: 'BUSINESS FRAME',
    desc: '记录营销目标、内容方向、参考要求，适合商务、投流和选题前置整理。',
    tags: ['营销目标', '内容方向', '参考'],
    scenes: ['BF框架', 'BF素材', 'BF参考']
  },
  {
    key: 'cases',
    title: '案例库',
    short: '案例 / 复盘 / 链接',
    icon: '🧩',
    kicker: 'CASE STUDY',
    desc: '收集优秀案例、差评案例、数据复盘，给复盘和选题做证据。',
    tags: ['案例标签', '复盘', '链接'],
    scenes: ['优秀案例', '差评案例', '数据复盘']
  }
]

const curCollection = ref('wenan')
const listD = ref([])
const counts = reactive({ wenan: 0, bf: 0, cases: 0 })
const facets = reactive({ wenan: { accounts: [], scenes: [] }, bf: { accounts: [], scenes: [] }, cases: { accounts: [], scenes: [] } })
const currentTotal = ref(0)
const pageSize = 60
const offset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const saving = ref(false)
const analyzing = ref(false)
const extractingSource = ref(false)
const collecting = ref(false)
const preparing = ref(false)
const analyzeError = ref('')
const sourceStatus = ref('')
const sourceStatusType = ref('')
const collectorStatus = ref('')
const collectorStatusType = ref('')
const aiRaw = ref('')
const keyword = ref('')
const filterAccount = ref('')
const filterScene = ref('')
const editId = ref('')
const editorPanel = ref(null)
const collectedItems = ref([])
const selectedCollectedIds = ref([])
const preparedDrafts = ref([])
const confirmingDraftId = ref('')
let filterTimer = null

const form = reactive({
  account: '',
  scene: '开场',
  itemType: 'copy',
  content: '',
  hook: '',
  golden_line: '',
  source: '',
  feishu_link: '',
  marketing_target: '',
  content_direction: '',
  case_tags: '',
  link: ''
})
const collector = reactive({
  platform: 'douyin',
  account: '',
  limit: 5
})

const currentConfig = computed(() => collections.find(item => item.key === curCollection.value) || collections[0])
const totalCount = computed(() => Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0))
const availableScenes = computed(() => {
  return currentConfig.value.scenes || []
})
const hasExtractableSource = computed(() => curCollection.value === 'wenan' && (form.link.trim() || form.feishu_link.trim()))
const selectedCollectedItems = computed(() => {
  const picked = new Set(selectedCollectedIds.value)
  return collectedItems.value.filter(item => picked.has(item.id || item.url))
})
const accountOptions = computed(() => facets[curCollection.value]?.accounts || unique(listD.value.map(item => item.account).filter(Boolean)))
const sceneOptions = computed(() => facets[curCollection.value]?.scenes || unique(listD.value.map(item => item.scene).filter(Boolean)))
const styleCards = computed(() => listD.value.filter(item => item.type === 'style_card'))
const canSubmit = computed(() => {
  if (curCollection.value === 'wenan') return form.account.trim() && (form.source.trim() || form.link.trim() || form.feishu_link.trim())
  if (curCollection.value === 'bf') return form.content_direction.trim() || form.marketing_target.trim()
  return form.content.trim() || form.case_tags.trim() || form.link.trim()
})
function unique(values) {
  return Array.from(new Set(values))
}

function searchable(item) {
  return [
    item.content,
    item.text,
    item.hook,
    item.golden_line,
    item.progression,
    item.marketing_target,
    item.content_direction,
    item.case_tags,
    item.link,
    item.source,
    item.account,
    item.scene,
    item.type
  ].filter(Boolean).join(' ')
}

function tagList(item) {
  const raw = String(item.case_tags || '')
  return raw
    .split(/[,，、\s]+/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 6)
}


function shortText(value, max = 42) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}

function mainTitle(item) {
  if (curCollection.value === 'wenan') {
    return shortText(item.hook || item.golden_line || item.source_title || item.case_tags || '文案素材', 36)
  }
  if (curCollection.value === 'bf') return shortText(item.marketing_target || item.scene || item.account || 'BF素材', 36)
  return shortText(item.case_tags || item.scene || item.account || '案例素材', 36)
}

function mainBody(item) {
  if (curCollection.value === 'bf') return item.content_direction || item.content || item.source || '暂无内容方向'
  if (curCollection.value === 'wenan') return item.golden_line || item.content || item.source || item.link || item.progression || '暂无内容'
  return item.content || item.source || item.link || '暂无内容'
}

function originalText(item) {
  const raw = String(item.original_text || item.originalText || item.text || item.content || '').trim()
  const source = String(item.source || '').trim()
  const text = raw || (source.length > 80 ? source : '')
  const match = text.match(/转写原文[：:]\s*([\s\S]+)$/)
  return (match ? match[1] : text).trim()
}

function originalPreview(item) {
  return shortText(originalText(item) || mainBody(item), 120)
}

function normalizeSourceUrl(url) {
  let value = String(url || '').trim()
  value = value.replace(/[)\]}>'"`.,!?;:\u3002\uff0c\uff01\uff1f\uff1b\uff1a\uff09\u3011\u300b\u3001]+$/g, '')
  if (/^BV[\w]{10}$/i.test(value)) return `https://www.bilibili.com/video/${value}`
  if (value && !/^https?:\/\//i.test(value)) value = 'https://' + value
  return value
}

function extractSourceUrls(text) {
  const raw = String(text || '')
  const patterns = [
    /(?:https?:\/\/)?v\.douyin\.com\/[^\s"'<>\u4e00-\u9fa5]+/gi,
    /(?:https?:\/\/)?(?:www\.)?douyin\.com\/video\/\d+[^\s"'<>\u4e00-\u9fa5]*/gi,
    /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/BV[\w]+[^\s"'<>\u4e00-\u9fa5]*/gi,
    /(?:https?:\/\/)?b23\.tv\/[^\s"'<>\u4e00-\u9fa5]+/gi,
    /(?:https?:\/\/)?(?:[^/\s"'<>\u4e00-\u9fa5]+\.)?feishu\.cn\/(?:docx|wiki)\/[^\s"'<>\u4e00-\u9fa5]+/gi,
    /\bBV[\w]{10}\b/g
  ]
  const urls = []
  const seen = new Set()
  for (const pattern of patterns) {
    const matches = raw.match(pattern) || []
    for (const match of matches) {
      const url = normalizeSourceUrl(match)
      const key = url.toLowerCase()
      if (url && !seen.has(key)) {
        seen.add(key)
        urls.push(url)
      }
    }
  }
  const fallback = normalizeSourceUrl(raw)
  if (!urls.length && fallback) urls.push(fallback)
  return urls
}

function getFeishuDocId(url) {
  const clean = normalizeSourceUrl(url)
  return clean.match(/(?:docx|wiki)\/([a-zA-Z0-9_-]{8,})/)?.[1] || clean.match(/([a-zA-Z0-9_-]{10,})/)?.[1] || ''
}

function isFeishuUrl(url) {
  return /feishu\.cn\/(?:docx|wiki)\//i.test(url)
}

function getVideoPlatform(url) {
  if (/douyin|iesdouyin/i.test(url)) return 'douyin'
  if (/bilibili|b23\.tv|^BV/i.test(url)) return 'bilibili'
  return ''
}

function mergeSourceText(blocks) {
  const existing = form.source.trim()
  const incoming = blocks.map(item => item.trim()).filter(Boolean).join('\n\n')
  if (!incoming) return existing
  if (!existing) return incoming
  return `${existing}\n\n${incoming}`
}

async function extractSources() {
  if (!hasExtractableSource.value) return ''
  extractingSource.value = true
  sourceStatus.value = '正在提取来源...'
  sourceStatusType.value = ''
  try {
    const blocks = []
    const feishuUrls = extractSourceUrls(form.feishu_link).filter(isFeishuUrl)
    const videoUrls = extractSourceUrls(form.link).filter(url => getVideoPlatform(url))
    let done = 0
    const total = feishuUrls.length + videoUrls.length

    for (const url of feishuUrls) {
      done += 1
      sourceStatus.value = `读取飞书 ${done}/${total}`
      const docId = getFeishuDocId(url)
      if (!docId) throw new Error('飞书链接无法识别文档 ID')
      const result = await readFeishu(docId)
      const text = cleanTranscriptText(result.text || '')
      if (text) blocks.push(`【飞书】${url}\n${text}`)
      else if (result.error) throw new Error(result.error)
    }

    for (const url of videoUrls) {
      done += 1
      const platform = getVideoPlatform(url)
      sourceStatus.value = `转写${platform === 'douyin' ? '抖音' : 'B站'} ${done}/${total}`
      const result = await transcribeVideo(platform, url)
      const text = cleanTranscriptText(result.text || '')
      if (text) blocks.push(`【${platform === 'douyin' ? '抖音' : 'B站'}】${url}\n${text}`)
      else if (result.error) throw new Error(result.error)
    }

    if (!blocks.length) {
      sourceStatus.value = '没有提取到可用正文'
      sourceStatusType.value = 'error'
      return ''
    }
    form.source = mergeSourceText(blocks)
    sourceStatus.value = `已提取 ${blocks.length} 个来源`
    showToast('来源已提取到原文', 'success')
    return form.source
  } catch(e) {
    sourceStatus.value = e.message || '来源处理失败'
    sourceStatusType.value = 'error'
    showToast('来源处理失败：' + sourceStatus.value, 'error')
    return ''
  } finally {
    extractingSource.value = false
  }
}

function clearCollector() {
  collectedItems.value = []
  selectedCollectedIds.value = []
  preparedDrafts.value = []
  collectorStatus.value = ''
  collectorStatusType.value = ''
}

async function collectAccountVideos() {
  if (!collector.account.trim()) return
  collecting.value = true
  collectorStatus.value = '正在拉取账号作品...'
  collectorStatusType.value = ''
  try {
    const result = await collectVectorAccount({
      platform: collector.platform,
      account: collector.account,
      limit: collector.limit
    })
    collectedItems.value = result.items || []
    selectedCollectedIds.value = collectedItems.value.map(item => item.id || item.url).filter(Boolean).slice(0, Math.min(3, collectedItems.value.length))
    preparedDrafts.value = []
    collectorStatus.value = collectedItems.value.length ? `已拉取 ${collectedItems.value.length} 条，默认勾选前 ${selectedCollectedIds.value.length} 条` : '没有拉取到作品'
    if (!collectedItems.value.length) collectorStatusType.value = 'error'
  } catch(e) {
    collectorStatus.value = e.message || '账号采集失败'
    collectorStatusType.value = 'error'
  } finally {
    collecting.value = false
  }
}

async function prepareSelectedVideos() {
  const items = selectedCollectedItems.value
  if (!items.length) return
  preparing.value = true
  collectorStatus.value = '正在逐条转写并用 GPT-5.4 解析...'
  collectorStatusType.value = ''
  try {
    const result = await prepareVectorAccountItems({
      platform: collector.platform,
      account: collector.account,
      items,
      limit: items.length
    })
    preparedDrafts.value = result.drafts || []
    collectorStatus.value = preparedDrafts.value.length ? `已生成 ${preparedDrafts.value.length} 条待确认草稿` : '没有生成可确认草稿'
    if (!preparedDrafts.value.length) collectorStatusType.value = 'error'
  } catch(e) {
    collectorStatus.value = e.message || '转写解析失败'
    collectorStatusType.value = 'error'
  } finally {
    preparing.value = false
  }
}

async function confirmDraft(draft) {
  confirmingDraftId.value = draft.id || draft.url || draft.title
  try {
    const account = String(draft.account || collector.account || form.account || '').trim()
    if (!account) throw new Error('账号名必填')
    const result = await addVectorItem('wenan', {
      account,
      scene: '文案',
      type: 'copy',
      text: draft.original_text || draft.summary || draft.title,
      source: draft.original_text || '',
      hook: draft.title || '',
      golden_line: draft.summary || '',
      content: draft.original_text || draft.summary || draft.title,
      progression: draft.search_query || '',
      case_tags: draft.tags || '',
      link: draft.url || ''
    })
    if (!result.success && !result.id) throw new Error(result.error || '入库失败')
    preparedDrafts.value = preparedDrafts.value.filter(item => item !== draft)
    showToast('已确认入文案库', 'success')
    await loadList()
    await loadCounts()
    await loadFacets('wenan')
  } catch(e) {
    showToast('确认入库失败：' + e.message, 'error')
  } finally {
    confirmingDraftId.value = ''
  }
}

function resetForm() {
  editId.value = ''
  form.account = ''
  form.itemType = 'copy'
  form.scene = curCollection.value === 'wenan' ? '文案' : (currentConfig.value.scenes || [])[0]
  form.content = ''
  form.hook = ''
  form.golden_line = ''
  form.source = ''
  form.feishu_link = ''
  form.marketing_target = ''
  form.content_direction = ''
  form.case_tags = ''
  form.link = ''
  analyzeError.value = ''
  sourceStatus.value = ''
  sourceStatusType.value = ''
}

function setWenanMode(mode) {
  form.itemType = mode === 'style_card' ? 'style_card' : 'copy'
  if (!editId.value) {
    form.scene = form.itemType === 'style_card' ? currentConfig.value.styleScenes[0] : currentConfig.value.scenes[0]
  }
}

function switchCollection(key) {
  if (curCollection.value === key) return
  curCollection.value = key
  filterAccount.value = ''
  filterScene.value = ''
  keyword.value = ''
  listD.value = []
  currentTotal.value = 0
  offset.value = 0
  hasMore.value = false
  resetForm()
  loadList()
  loadFacets(key)
}

function focusEditor() {
  editorPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function buildPayload() {
  const base = {
    id: editId.value,
    account: form.account,
    scene: form.scene,
    source: form.source
  }
  if (curCollection.value === 'wenan') {
    return {
      ...base,
      account: form.account.trim(),
      scene: '文案',
      type: 'copy',
      progression: form.feishu_link,
      link: form.link,
      text: form.source || form.link || form.feishu_link,
      original_text: form.source,
      hook: form.hook,
      golden_line: form.golden_line,
      case_tags: form.case_tags
    }
  }
  if (curCollection.value === 'bf') {
    return {
      ...base,
      type: 'bf',
      text: form.content_direction || form.marketing_target,
      marketing_target: form.marketing_target,
      content_direction: form.content_direction
    }
  }
  return {
    ...base,
    type: 'case',
    text: form.content || form.case_tags || form.link,
    case_tags: form.case_tags,
    link: form.link
  }
}

async function saveItem() {
  if (!canSubmit.value) {
    showToast(curCollection.value === 'wenan' ? '请先填写账号名和来源内容' : '请先填写内容', 'error')
    return
  }
  saving.value = true
  try {
    if (curCollection.value === 'wenan' && hasExtractableSource.value && !form.source.trim()) {
      await extractSources()
      if (!form.source.trim()) throw new Error('来源还没有提取到正文，暂不入库')
    }
    if (curCollection.value === 'wenan' && !editId.value) {
      const result = await prepareVectorCopyItems({
        account: form.account.trim(),
        source: form.source,
        link: form.link,
        feishu_link: form.feishu_link
      })
      preparedDrafts.value = result.drafts || []
      if (!preparedDrafts.value.length) throw new Error(result.error || 'AI 没有拆出可确认草稿')
      showToast(`已生成 ${preparedDrafts.value.length} 条待确认草稿`, 'success')
      return
    }
    const result = await addVectorItem(curCollection.value, buildPayload())
    if (!result.success && !result.id) throw new Error(result.error || '保存失败')
    showToast(editId.value ? '已保存修改' : '已入库', 'success')
    resetForm()
    await loadList()
    await loadCounts()
    await loadFacets(curCollection.value)
  } catch(e) {
    showToast('保存失败：' + e.message, 'error')
  } finally {
    saving.value = false
  }
}

async function editItem(item) {
  let fullItem = item
  if (item?.is_preview && item.id) {
    try {
      const data = await getVectorItem(curCollection.value, item.id)
      fullItem = data.item || data.data || item
    } catch(e) {
      showToast('完整记录加载失败：' + e.message, 'error')
      return
    }
  }
  item = fullItem
  editId.value = item.id
  form.account = item.account || '通用'
  form.itemType = item.type === 'style_card' ? 'style_card' : 'copy'
  form.scene = item.scene || availableScenes.value[0]
  form.content = item.content || item.text || ''
  form.hook = item.hook || ''
  form.golden_line = item.golden_line || ''
  form.source = originalText(item) || item.source || ''
  form.feishu_link = item.progression || ''
  form.marketing_target = item.marketing_target || ''
  form.content_direction = item.content_direction || ''
  form.case_tags = item.case_tags || ''
  form.link = item.link || ''
  focusEditor()
}

async function removeItem(item) {
  const ok = await confirmAction({
    title: '删除向量记录',
    message: '确定删除这条记录吗？删除后不可恢复。',
    confirmText: '删除',
    type: 'danger'
  })
  if (!ok) return
  try {
    const result = await deleteVectorItem(curCollection.value, item.id)
    if (!result.success) throw new Error(result.error || '删除失败')
    listD.value = listD.value.filter(row => row.id !== item.id)
    counts[curCollection.value] = Math.max(0, (counts[curCollection.value] || 1) - 1)
    currentTotal.value = Math.max(0, currentTotal.value - 1)
    loadFacets(curCollection.value)
    showToast('已删除', 'success')
  } catch(e) {
    showToast('删除失败：' + e.message, 'error')
  }
}

async function runAnalyze() {
  if (!aiRaw.value.trim()) return
  analyzing.value = true
  analyzeError.value = ''
  try {
    const result = await analyzeVectorText(aiRaw.value, form.account, curCollection.value)
    if (!result.success || !result.data) throw new Error(result.error || 'AI 没有返回可用字段')
    applyAnalyze(result.data)
    showToast('AI 已拆出字段，可继续人工修正', 'success')
  } catch(e) {
    analyzeError.value = e.message
  } finally {
    analyzing.value = false
  }
}

function applyAnalyze(data) {
  form.account = data.account || form.account
  form.scene = data.scene || form.scene
  if (curCollection.value === 'wenan') {
    form.hook = data.title || data.hook || form.hook
    form.golden_line = data.summary || data.golden_line || form.golden_line
    form.case_tags = Array.isArray(data.tags) ? data.tags.join('，') : (data.tags || data.case_tags || form.case_tags)
    form.source = form.source || aiRaw.value
  } else if (curCollection.value === 'bf') {
    form.marketing_target = data.marketing_target || form.marketing_target
    form.content_direction = data.content_direction || form.content_direction || aiRaw.value
    form.source = form.source || aiRaw.value
  } else {
    form.content = data.content || form.content || aiRaw.value
    form.case_tags = data.case_tags || form.case_tags
    form.link = data.link || form.link
  }
}

async function loadList() {
  loading.value = true
  try {
    offset.value = 0
    const data = await listVectorItems(curCollection.value, listQuery(0))
    listD.value = data.items || []
    currentTotal.value = data.total ?? listD.value.length
    counts[curCollection.value] = currentTotal.value
    offset.value = Number(data.offset || 0) + listD.value.length
    hasMore.value = Boolean(data.has_more)
  } catch(e) {
    listD.value = []
    currentTotal.value = 0
    hasMore.value = false
    showToast('加载失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}

function listQuery(nextOffset = offset.value) {
  return {
    limit: pageSize,
    offset: nextOffset,
    keyword: keyword.value.trim(),
    account: filterAccount.value,
    scene: filterScene.value
  }
}

async function loadMore() {
  if (loading.value || !hasMore.value) return
  loading.value = true
  try {
    const data = await listVectorItems(curCollection.value, listQuery(offset.value))
    const rows = data.items || []
    listD.value = listD.value.concat(rows)
    currentTotal.value = data.total ?? currentTotal.value
    counts[curCollection.value] = currentTotal.value
    offset.value = Number(data.offset ?? offset.value) + rows.length
    hasMore.value = Boolean(data.has_more)
  } catch(e) {
    showToast('加载更多失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function loadCounts() {
  await Promise.all(collections.map(async cfg => {
    try {
      const data = await getVectorStats(cfg.key)
      counts[cfg.key] = data.total || 0
    } catch(e) {
      counts[cfg.key] = counts[cfg.key] || 0
    }
  }))
}

async function loadFacets(collection = curCollection.value) {
  try {
    const data = await getVectorFacets(collection)
    facets[collection] = {
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      scenes: Array.isArray(data.scenes) ? data.scenes : []
    }
  } catch(e) {
    facets[collection] = facets[collection] || { accounts: [], scenes: [] }
  }
}

watch([keyword, filterAccount, filterScene], () => {
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => {
    loadList()
  }, 260)
})

onMounted(async () => {
  resetForm()
  await Promise.all([loadList(), loadCounts(), loadFacets()])
})
</script>

<style scoped>
.vector-page {
  height: 100%;
  overflow: auto;
  padding: 18px;
  color: var(--text);
}

.vector-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  margin-bottom: 14px;
}

.module-page-icon {
  width: 42px;
  height: 42px;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-gradient);
  color: #fff;
  font-size: 20px;
  font-weight: 900;
  box-shadow: 0 14px 34px rgba(0, 122, 255, 0.24);
}

.module-page-copy p {
  margin: 4px 0 0;
  color: var(--text-dim);
  font-size: 13px;
}

.header-actions,
.submit-row,
.ai-actions,
.source-actions,
.record-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.load-more-row {
  display: flex;
  justify-content: center;
  padding: 12px 0 2px;
}

.vector-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.vector-subnav,
.vector-content,
.editor-panel,
.data-panel {
  border: 1px solid var(--border);
  background: var(--panel-bg);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.vector-subnav {
  position: sticky;
  top: 12px;
  border-radius: 22px;
  padding: 12px;
}

.subnav-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 8px 12px;
  color: var(--text-dim);
  font-size: 12px;
}

.subnav-title strong {
  color: var(--text);
}

.subnav-item {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 16px;
  padding: 12px;
  display: grid;
  grid-template-columns: 34px 1fr auto;
  gap: 10px;
  align-items: center;
  text-align: left;
  color: var(--text);
  background: transparent;
  cursor: pointer;
  transition: background .18s ease, border-color .18s ease, transform .18s ease;
}

.subnav-item:hover,
.subnav-item.active {
  background: var(--panel-bg-hover);
  border-color: var(--border-mid);
  transform: translateY(-1px);
}

.subnav-icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface2);
  color: var(--primary);
  font-size: 17px;
  font-weight: 900;
}

.subnav-copy strong,
.subnav-copy small {
  display: block;
}

.subnav-copy small {
  margin-top: 2px;
  color: var(--text-dim);
  font-size: 11px;
}

.subnav-item em {
  font-style: normal;
  color: var(--text-dim);
  font-size: 12px;
}

.vector-content {
  border-radius: 24px;
  padding: 16px;
}

.content-top {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  padding: 4px 4px 16px;
}

.section-kicker,
.panel-kicker {
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--text-dim);
  font-weight: 800;
}

.content-top h3,
.panel-head h3,
.toolbar h3 {
  margin: 4px 0;
  color: var(--text);
}

.content-top p {
  margin: 0;
  max-width: 640px;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.6;
}

.content-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}

.content-tags span,
.record-meta span,
.record-meta a {
  font-size: 11px;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--surface2);
  color: var(--text-dim);
  text-decoration: none;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(330px, 410px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.editor-panel,
.data-panel {
  border-radius: 22px;
  padding: 16px;
}

.panel-head,
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  margin-bottom: 14px;
}

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 5px;
  border-radius: 15px;
  background: var(--surface);
  margin-bottom: 12px;
}

.mode-tab {
  border: 0;
  border-radius: 12px;
  padding: 9px 10px;
  background: transparent;
  color: var(--text-dim);
  font-weight: 800;
  cursor: pointer;
}

.mode-tab.active {
  background: var(--primary-gradient);
  color: #fff;
  box-shadow: 0 10px 24px rgba(0, 122, 255, 0.18);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.field span {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 700;
}

.inp {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 12px;
  padding: 10px 12px;
  color: var(--text);
  outline: none;
  font-size: 13px;
}

.inp:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.12);
}

textarea.inp {
  resize: vertical;
  min-height: 86px;
}

.tall {
  min-height: 118px;
}

.source,
.ai-raw {
  min-height: 76px;
}

.style-card-note {
  display: grid;
  gap: 4px;
  border: 1px solid rgba(0, 122, 255, 0.18);
  border-radius: 16px;
  padding: 12px;
  margin-bottom: 12px;
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.10), rgba(52, 199, 89, 0.08));
}

.style-card-note strong {
  color: var(--text);
}

.style-card-note span {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.collector-box {
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 12px;
  margin-bottom: 14px;
  background: var(--panel-bg-soft);
}

.collector-head,
.draft-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.collector-head strong,
.collector-head span,
.draft-head strong,
.draft-head span {
  display: block;
}

.collector-head span,
.draft-head span {
  color: var(--text-dim);
  font-size: 12px;
  margin-top: 3px;
}

.collector-grid {
  display: grid;
  grid-template-columns: 1fr 110px;
  gap: 10px;
}

.compact-field {
  margin-bottom: 10px;
}

.collect-list,
.draft-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.collect-row,
.draft-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 10px;
  background: var(--surface);
}

.collect-row input {
  margin-top: 3px;
}

.collect-row span,
.collect-row strong,
.collect-row small,
.draft-card strong,
.draft-card small {
  display: block;
}

.collect-row strong,
.draft-card strong {
  color: var(--text);
  font-size: 13px;
}

.collect-row small,
.draft-card small {
  color: var(--text-dim);
  font-size: 11px;
  margin-top: 4px;
  word-break: break-all;
}

.draft-warning {
  color: #f59e0b !important;
}

.draft-card {
  justify-content: space-between;
}

.draft-card p {
  margin: 5px 0 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.ai-box {
  border: 1px dashed var(--border-mid);
  border-radius: 16px;
  padding: 12px;
  margin: 8px 0 14px;
  background: var(--panel-bg-soft);
}

.ai-box summary {
  cursor: pointer;
  color: var(--text);
  font-weight: 800;
  font-size: 13px;
}

.ai-box[open] summary {
  margin-bottom: 10px;
}

.btn,
.mini-btn {
  border: 0;
  border-radius: 12px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 800;
  font-size: 12px;
}

.btn-primary {
  background: var(--primary-gradient);
  color: #fff;
}

.btn-ghost,
.mini-btn {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.btn:disabled {
  opacity: .48;
  cursor: not-allowed;
}

.mini-btn {
  padding: 7px 10px;
}

.mini-btn.danger {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.10);
}

.submit-row {
  justify-content: flex-end;
}

.error-text {
  color: #ef4444;
  font-size: 12px;
}

.source-actions {
  justify-content: space-between;
  flex-wrap: wrap;
  margin: -2px 0 14px;
}

.source-status {
  color: var(--text-dim);
  font-size: 12px;
}

.source-status.error {
  color: #ef4444;
}

.toolbar-left h3 {
  margin: 0;
}

.toolbar-left span {
  color: var(--text-dim);
  font-size: 12px;
}

.filters {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.search {
  width: 220px;
}

.compact {
  width: 130px;
}

.stats-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}

.stat {
  border-radius: 16px;
  padding: 12px;
  background: var(--surface);
}

.stat strong {
  display: block;
  font-size: 22px;
  color: var(--text);
}

.stat span {
  color: var(--text-dim);
  font-size: 12px;
}

.style-card-strip {
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--panel-bg-soft);
}

.strip-head {
  display: flex;
  justify-content: space-between;
  color: var(--text-dim);
  font-size: 12px;
  margin-bottom: 8px;
}

.style-card-preview {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 10px;
  background: var(--surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  margin-top: 8px;
}

.style-card-preview strong,
.style-card-preview span {
  display: block;
}

.style-card-preview span {
  margin-top: 4px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 58vh;
  overflow: auto;
  padding-right: 4px;
}

.record-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  border-radius: 18px;
  padding: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.record-card.is-style-card {
  border-color: rgba(0, 122, 255, 0.28);
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.08), var(--surface));
}

.record-title {
  font-weight: 900;
  color: var(--text);
  margin-bottom: 0;
  line-height: 1.35;
}

.record-summary {
  margin: 0;
  color: var(--text-dim);
  line-height: 1.45;
  font-size: 12px;
}

.source-chip {
  border: 1px solid rgba(0, 122, 255, 0.16);
  border-radius: 999px;
  padding: 3px 8px;
  background: rgba(0, 122, 255, 0.08);
  color: var(--primary);
  font-weight: 800;
  font-size: 11px;
}

.record-original {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel-bg-soft);
  overflow: hidden;
}

.record-original summary {
  cursor: pointer;
  padding: 8px 10px;
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
}

.record-original pre {
  margin: 0;
  padding: 0 10px 10px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  font: inherit;
  line-height: 1.55;
}

.record-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.record-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.account-chip {
  color: var(--text) !important;
  font-weight: 800;
}

.record-tags span {
  border: 1px solid rgba(0, 122, 255, 0.18);
  border-radius: 999px;
  padding: 4px 8px;
  background: rgba(0, 122, 255, 0.08);
  color: var(--primary);
  font-size: 11px;
  font-weight: 800;
}

.record-actions {
  flex-direction: column;
  align-items: stretch;
  flex-shrink: 0;
}

.empty-state {
  min-height: 220px;
  border-radius: 18px;
  background: var(--panel-bg-soft);
  display: grid;
  place-items: center;
  text-align: center;
  color: var(--text-dim);
  gap: 6px;
}

.empty-state strong,
.empty-state span {
  display: block;
}

@media (max-width: 1180px) {
  .vector-shell,
  .workspace {
    grid-template-columns: 1fr;
  }

  .vector-subnav {
    position: static;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }

  .subnav-title {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .vector-page {
    padding: 12px;
  }

  .vector-header,
  .content-top,
  .panel-head,
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .vector-subnav,
  .form-grid,
  .stats-strip {
    grid-template-columns: 1fr;
  }

  .filters,
  .search,
  .compact {
    width: 100%;
  }
}
</style>


.draft-card-editable {
  align-items: stretch;
}

.draft-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  min-width: 0;
}

.draft-field {
  display: grid;
  gap: 4px;
}

.draft-field.full,
.draft-link,
.draft-warning {
  grid-column: 1 / -1;
}

.draft-field span {
  color: var(--text-muted);
  font-size: 11px;
}

.draft-link {
  color: var(--text-muted);
  font-size: 11px;
  word-break: break-all;
}
