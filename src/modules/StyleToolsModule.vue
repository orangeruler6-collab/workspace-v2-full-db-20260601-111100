<template>
  <section class="style-workbench-native">
    <div class="page tools-page">
      <header class="page-header">
        <div class="page-title-group">
          <span class="page-title-eyebrow">内容工具</span>
          <div class="page-title-row">
            <span class="page-title-mark" aria-hidden="true">
              <Wrench :size="20" :stroke-width="2.1" />
            </span>
            <div class="page-title-copy">
              <h1>工具台</h1>
              <p class="subtle">选题标题，链接提文案，视频素材下载。</p>
            </div>
          </div>
        </div>
        <div class="page-header-meta">
          <span class="stat-pill">B站 / 抖音</span>
        </div>
      </header>

      <div v-if="error" class="error" role="alert">{{ error }}</div>

      <section class="panel tools-hub" :aria-busy="Boolean(busyTool)">
        <div class="tools-hub-grid">
          <div class="tools-entry">
            <div class="tools-mode-row">
              <span class="tools-label">工具</span>
              <div class="segmented tools-mode-tabs" role="group" aria-label="选择工具">
                <button
                  v-for="mode in toolModes"
                  :key="mode.id"
                  type="button"
                  :class="{ active: activeTool === mode.id }"
                  :aria-pressed="activeTool === mode.id"
                  @click="activeTool = mode.id">
                  <component :is="mode.icon" :size="15" aria-hidden="true" />
                  {{ mode.label }}
                </button>
              </div>
            </div>

            <div class="tools-active-head">
              <span>{{ activeMode.eyebrow }}</span>
              <strong>{{ activeMode.resultTitle }}</strong>
            </div>

            <div class="tools-entry-body">
              <template v-if="activeTool === 'publish-copy'">
                <div class="tools-inline-group">
                  <span class="tools-label">参考平台</span>
                  <div class="segmented tools-platform-tabs" role="group" aria-label="参考平台">
                    <button
                      v-for="option in publishPlatformOptions"
                      :key="option.value"
                      type="button"
                      :class="{ active: publishInput.platform === option.value }"
                      :aria-pressed="publishInput.platform === option.value"
                      @click="publishInput.platform = option.value">
                      <Search :size="15" aria-hidden="true" />
                      {{ option.label }}
                    </button>
                  </div>
                </div>
                <label class="field">
                  <span>原文案</span>
                  <textarea class="tools-source-textarea" v-model="publishInput.sourceText" placeholder="粘贴已有口播稿、发布文案或选题草稿…"></textarea>
                </label>
                <label class="field">
                  <span>相似选题关键词</span>
                  <div class="tools-input-shell">
                    <Hash :size="16" aria-hidden="true" />
                    <input v-model="publishInput.topicHint" autocomplete="off" placeholder="可留空…" />
                  </div>
                </label>
              </template>
              <template v-else-if="activeTool === 'transcribe'">
                <VideoLinkField v-model="videoUrl" />
                <label class="field">
                  <span>标题提示</span>
                  <input v-model="titleHint" autocomplete="off" placeholder="可留空…" />
                </label>
              </template>
              <template v-else>
                <VideoLinkField v-model="videoUrl" />
                <div class="tools-inline-group">
                  <span class="tools-label">下载类型</span>
                  <div class="tools-download-options" role="group" aria-label="下载类型">
                    <button
                      v-for="option in downloadOptions"
                      :key="option.kind"
                      class="btn icon-toggle"
                      :class="{ active: downloadKind === option.kind }"
                      type="button"
                      :aria-pressed="downloadKind === option.kind"
                      @click="downloadKind = option.kind">
                      <component :is="option.icon" :size="16" aria-hidden="true" />
                      {{ option.label }}
                    </button>
                  </div>
                </div>
              </template>
            </div>

            <div class="tools-run-row">
              <button class="btn primary tools-run-submit" type="button" :disabled="!canRun || Boolean(busyTool)" :aria-busy="busyTool === activeTool" @click="runActiveTool">
                <Loader2 v-if="busyTool" class="tools-spin" :size="16" aria-hidden="true" />
                <component :is="activeMode.icon" v-else :size="16" aria-hidden="true" />
                {{ primaryActionLabel }}
              </button>
            </div>
          </div>

          <div class="tools-preview" aria-live="polite">
            <div class="tools-preview-head">
              <div>
                <h2>{{ activeMode.resultTitle }}</h2>
                <p class="pane-subtitle">{{ previewSubtitle }}</p>
              </div>
              <div class="tools-result-meta">
                <span v-for="item in activeMeta" :key="item" class="status-pill">{{ item }}</span>
              </div>
            </div>

            <div v-if="activeTool === 'publish-copy' && publishCandidates.length" class="tools-candidate-list">
              <article v-for="(candidate, index) in publishCandidates" :key="`${candidate.title || index}-${index}`" class="tools-candidate-card">
                <div class="tools-candidate-head">
                  <span class="status-pill">{{ platformTargetLabel(candidate.platform) }}</span>
                  <span>{{ candidate.angle || candidate.frameworkName || `候选 ${index + 1}` }}</span>
                </div>
                <h3>{{ candidate.title }}</h3>
                <p>{{ candidate.caption }}</p>
                <button class="btn compact" type="button" @click="copyPublishCandidate(candidate)">
                  <Clipboard :size="15" aria-hidden="true" />
                  复制
                </button>
              </article>
            </div>
            <div v-else-if="activeTool === 'transcribe'" class="tools-result-shell">
              <textarea v-if="transcript" aria-label="提取结果文案" class="tools-result-text" :value="transcript" readonly></textarea>
              <div v-else class="tools-empty-result">
                <span class="empty-state-mark" aria-hidden="true">
                  <FileText :size="18" />
                </span>
                <h3>还没有提取结果</h3>
                <p class="subtle">粘贴单条视频链接后，文案会显示在这里。</p>
              </div>
              <div class="tools-result-actions">
                <a v-if="transcribeResult?.resolvedUrl" class="text-link" :href="transcribeResult.resolvedUrl" target="_blank" rel="noreferrer">
                  <ExternalLink :size="14" aria-hidden="true" />
                  打开来源
                </a>
                <button class="btn" type="button" :disabled="!transcript" @click="copyActiveResult">
                  <Clipboard :size="16" aria-hidden="true" />
                  复制文案
                </button>
              </div>
            </div>
            <div v-else-if="activeTool === 'download'" class="tools-source-card">
              <img v-if="transcribeResult?.coverUrl" :src="transcribeResult.coverUrl" :alt="`${transcribeResult.title || '视频'} 封面`" height="135" loading="lazy" width="240" />
              <div v-else class="tools-cover-placeholder">
                <ImageIcon :size="22" aria-hidden="true" />
              </div>
              <div>
                <strong>{{ transcribeResult?.title || '未读取标题' }}</strong>
                <span>{{ transcribeResult?.sourceAccountName || (videoUrl.trim() ? '链接已填写' : '来源待解析') }}</span>
              </div>
            </div>
            <div v-else-if="activeResult" class="tools-result-shell">
              <textarea class="tools-result-text" :value="activeResult" readonly></textarea>
              <div class="tools-result-actions">
                <button class="btn" type="button" @click="copyActiveResult">复制结果</button>
              </div>
            </div>
            <div v-else class="tools-empty-result">
              <span class="empty-state-mark" aria-hidden="true">
                <component :is="activeMode.icon" :size="18" />
              </span>
              <h3>{{ emptyState.title }}</h3>
              <p class="subtle">{{ emptyState.text }}</p>
            </div>
          </div>
        </div>
      </section>

      <section v-if="publishResearchVisible" class="panel tools-research-panel">
        <details class="tools-research-details">
          <summary>
            <span>框架和参考选题</span>
            <small>{{ publishFrameworks.length }} 个框架 / {{ publishReferenceCount }} 条参考</small>
          </summary>
          <div class="tools-research-grid">
            <div class="tools-framework-list">
              <div v-for="framework in publishFrameworks" :key="framework.name || framework.titlePattern" class="tools-framework-item">
                <strong>{{ framework.name || '参考框架' }}</strong>
                <span>标题：{{ framework.titlePattern || '未返回' }}</span>
                <span>发布：{{ framework.captionPattern || '未返回' }}</span>
                <span v-if="framework.structure">结构：{{ framework.structure }}</span>
              </div>
            </div>
            <div class="tools-reference-list">
              <a v-for="reference in publishReferences" :key="`${reference.platform}-${reference.url}`" :href="reference.url" target="_blank" rel="noreferrer">
                <span>{{ platformLabel(reference.platform) }}｜{{ reference.title }}</span>
                <small>{{ referenceMeta(reference) }}</small>
              </a>
            </div>
          </div>
        </details>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, h, reactive, ref } from 'vue'
import { Clipboard, Download, ExternalLink, FileText, Hash, Image as ImageIcon, Link as LinkIcon, Loader2, Music, Search, Sparkles, Video, Wrench } from 'lucide-vue-next'
import { downloadSingleVideoAsset, generatePublishCopy, transcribeSingleVideo } from '../api/styleWorkbench'

const error = ref('')
const busyTool = ref('')
const activeTool = ref('publish-copy')
const videoUrl = ref('')
const titleHint = ref('')
const transcript = ref('')
const transcribeResult = ref(null)
const publishResult = ref(null)
const downloadKind = ref('video')
const publishInput = reactive({
  platform: 'both',
  sourceText: '',
  topicHint: ''
})

const toolModes = [
  { id: 'publish-copy', label: '标题文案', eyebrow: '选题研究', resultTitle: '标题 / 发布文案', icon: Sparkles },
  { id: 'transcribe', label: '提取文案', eyebrow: '单条链接', resultTitle: '转写结果', icon: FileText },
  { id: 'download', label: '素材下载', eyebrow: '视频资产', resultTitle: '素材信息', icon: Download }
]
const publishPlatformOptions = [
  { value: 'both', label: '双平台' },
  { value: 'bilibili', label: 'B站' },
  { value: 'douyin', label: '抖音' }
]
const downloadOptions = [
  { kind: 'video', label: '视频', icon: Video },
  { kind: 'cover', label: '封面', icon: ImageIcon },
  { kind: 'audio', label: '音频', icon: Music }
]

const activeMode = computed(() => toolModes.find((mode) => mode.id === activeTool.value) || toolModes[0])
const publishCandidates = computed(() => Array.isArray(publishResult.value?.candidates) ? publishResult.value.candidates : [])
const publishFrameworks = computed(() => Array.isArray(publishResult.value?.frameworks) ? publishResult.value.frameworks : [])
const publishReferences = computed(() => {
  const references = publishResult.value?.research?.references
  return Array.isArray(references) ? references.slice(0, 8) : []
})
const publishReferenceCount = computed(() => Number(publishResult.value?.research?.referenceCount || publishReferences.value.length || 0))
const publishResearchVisible = computed(() => activeTool.value === 'publish-copy' && Boolean(publishResult.value))
const activeResult = computed(() => {
  if (activeTool.value === 'transcribe') return transcript.value
  if (activeTool.value === 'publish-copy') return publishCandidates.value.map(formatCandidateText).join('\n\n')
  return ''
})
const canRun = computed(() => {
  if (activeTool.value === 'publish-copy') return Boolean(publishInput.sourceText.trim())
  return Boolean(videoUrl.value.trim())
})
const activeMeta = computed(() => {
  if (activeTool.value === 'publish-copy') {
    if (!publishResult.value) return ['待生成']
    return [
      platformTargetLabel(publishResult.value.platform),
      `${publishReferenceCount.value} 条参考`,
      publishResult.value.fallback ? '需检查' : '已生成'
    ]
  }
  if (activeTool.value === 'transcribe') {
    if (!transcribeResult.value) return ['待提取']
    return [
      platformLabel(transcribeResult.value.platform),
      transcriptionSourceLabel(transcribeResult.value.source),
      transcribeResult.value.mediaUrls?.length ? `${transcribeResult.value.mediaUrls.length} 个媒体地址` : '未返回媒体地址'
    ]
  }
  return [
    downloadOptions.find((option) => option.kind === downloadKind.value)?.label || '素材',
    videoUrl.value.trim() ? '链接就绪' : '待链接'
  ]
})
const primaryActionLabel = computed(() => {
  if (busyTool.value === activeTool.value) {
    if (activeTool.value === 'publish-copy') return '生成中'
    if (activeTool.value === 'transcribe') return '提取中'
    return '下载中'
  }
  if (activeTool.value === 'publish-copy') return '生成标题文案'
  if (activeTool.value === 'transcribe') return '提取文案'
  const option = downloadOptions.find((item) => item.kind === downloadKind.value)
  return `下载${option?.label || '素材'}`
})
const previewSubtitle = computed(() => {
  if (activeTool.value === 'publish-copy') return '候选标题和发布文案。'
  if (activeTool.value === 'transcribe') return '平台字幕 / 火山转写 / 标题兜底。'
  return '下载会直接保存到本机。'
})
const emptyState = computed(() => {
  if (activeTool.value === 'publish-copy') return { title: '待生成', text: '结果会显示在这里。' }
  if (activeTool.value === 'transcribe') return { title: '还没有提取结果', text: '粘贴单条视频链接后，文案会显示在这里。' }
  return { title: '素材待下载', text: '粘贴单条视频链接后，选择视频、封面或音频。' }
})

async function runActiveTool() {
  if (activeTool.value === 'publish-copy') {
    await generate()
    return
  }
  if (activeTool.value === 'transcribe') {
    await transcribe()
    return
  }
  await download()
}

async function transcribe() {
  if (!videoUrl.value.trim()) {
    error.value = '请粘贴视频链接'
    return
  }
  busyTool.value = 'transcribe'
  error.value = ''
  try {
    const data = await transcribeSingleVideo({ url: videoUrl.value.trim(), titleHint: titleHint.value.trim() || undefined })
    transcribeResult.value = data.result || null
    transcript.value = data.result?.text || ''
    if (!publishInput.sourceText) publishInput.sourceText = transcript.value
  } catch (err) {
    error.value = err.message || '转写失败'
  } finally {
    busyTool.value = ''
  }
}

async function generate() {
  busyTool.value = 'publish-copy'
  error.value = ''
  try {
    publishResult.value = await generatePublishCopy({
      platform: publishInput.platform,
      sourceText: publishInput.sourceText.trim(),
      topicHint: publishInput.topicHint.trim() || undefined,
      candidateCount: 6
    })
  } catch (err) {
    error.value = err.message || '发布文案生成失败'
  } finally {
    busyTool.value = ''
  }
}

async function download() {
  if (!videoUrl.value.trim()) {
    error.value = '请粘贴视频链接'
    return
  }
  busyTool.value = 'download'
  error.value = ''
  try {
    await downloadSingleVideoAsset({ url: videoUrl.value.trim(), kind: downloadKind.value })
  } catch (err) {
    error.value = err.message || '素材下载失败'
  } finally {
    busyTool.value = ''
  }
}

async function copyActiveResult() {
  await navigator.clipboard?.writeText(activeResult.value).catch(() => {})
}

async function copyPublishCandidate(candidate) {
  await navigator.clipboard?.writeText(formatCandidateText(candidate)).catch(() => {})
}

function formatCandidateText(candidate) {
  return `${candidate.title || ''}\n\n${candidate.caption || ''}`.trim()
}

function platformTargetLabel(platform) {
  if (platform === 'both') return '双平台'
  return platformLabel(platform)
}

function platformLabel(platform) {
  if (platform === 'bilibili') return 'B站'
  if (platform === 'douyin') return '抖音'
  return '未知平台'
}

function transcriptionSourceLabel(source) {
  if (source === 'platform_subtitle') return '平台字幕'
  if (source === 'volcengine') return '火山转写'
  return '标题兜底'
}

function referenceMeta(reference) {
  const stats = reference?.stats || {}
  const items = [
    stats.views ? `播放 ${stats.views}` : '',
    stats.likes ? `赞 ${stats.likes}` : '',
    stats.comments ? `评 ${stats.comments}` : ''
  ].filter(Boolean)
  return items.length ? items.join(' / ') : (reference?.query || '')
}

const VideoLinkField = {
  props: {
    modelValue: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('label', { class: 'field' }, [
      h('span', '视频链接'),
      h('div', { class: 'tools-input-shell' }, [
        h(LinkIcon, { size: 16, 'aria-hidden': 'true' }),
        h('input', {
          autocomplete: 'off',
          name: 'videoUrl',
          type: 'url',
          value: props.modelValue,
          placeholder: 'https://www.bilibili.com/video/BV… 或 https://www.douyin.com/video/…',
          onInput: (event) => emit('update:modelValue', event.target.value)
        })
      ])
    ])
  }
}
</script>
