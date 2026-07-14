<template>
  <section class="style-workbench-native">
    <div class="page writer-page">
      <div v-if="error" class="error" role="alert">{{ error }}</div>

      <section class="writer-workbench">
        <section class="panel writer-main">
          <div class="writer-refbar">
            <div aria-label="选择引用类型" class="segmented" role="group">
              <button type="button" :class="{ active: form.targetType === 'account' }" :aria-pressed="form.targetType === 'account'" @click="form.targetType = 'account'">账号</button>
              <button type="button" :class="{ active: form.targetType === 'project' }" :aria-pressed="form.targetType === 'project'" :disabled="!projects.length" @click="form.targetType = 'project'">项目</button>
            </div>

            <select v-if="form.targetType === 'account'" class="writer-ref-select" v-model="form.accountId" aria-label="选择参考账号">
              <option value="">选择账号</option>
              <option v-for="account in accounts" :key="account.id" :value="account.id">{{ platformLabel(account.platform) }} / {{ account.name }}</option>
            </select>
            <select v-else class="writer-ref-select" v-model="form.projectId" aria-label="选择参考项目">
              <option value="">选择项目</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>

            <div class="writer-ref-meta" aria-label="当前写作上下文">
              <span>{{ activeTitle || '未选择引用' }}</span>
              <span>{{ form.modeLabel || modeLabel(form.mode) }}</span>
              <span>{{ form.save ? '保存草稿' : '仅生成' }}</span>
            </div>

            <button class="btn ghost writer-style-trigger" type="button" disabled>风格卡</button>
          </div>

          <div class="writer-content-grid">
            <div class="writer-task">
              <div class="section-title-row">
                <h2>需求</h2>
                <span class="status-pill" :class="hasTaskInput ? 'done' : 'pending'">{{ hasTaskInput ? '已输入' : '待输入' }}</span>
              </div>

              <label class="writer-field">
                <span>素材 / 原文</span>
                <textarea
                  class="writer-textarea source"
                  v-model="form.sourceText"
                  autocomplete="off"
                  placeholder="粘贴原文、抖音分享链接；多条素材中间空一行。"></textarea>
              </label>

              <div v-if="form.sourceText.trim()" class="source-detect-row" aria-live="polite">
                <span class="status-pill done">{{ materialCount }} 条素材</span>
                <span v-if="linkCount" class="status-pill pending">{{ linkCount }} 个链接待转写</span>
              </div>

              <label class="writer-field">
                <span>写作要求</span>
                <textarea
                  class="writer-textarea main"
                  v-model="form.prompt"
                  autocomplete="off"
                  placeholder="请按参考风格改写，保留核心信息，增强开头钩子和评论互动点。"></textarea>
              </label>

              <label class="writer-field support-doc-field">
                <span>模式</span>
                <select class="writer-ref-select" v-model="form.mode">
                  <option value="rewrite">改写</option>
                  <option value="topic">选题</option>
                  <option value="script">脚本</option>
                  <option value="commentary">口播</option>
                </select>
              </label>

              <div class="writer-brief-panel" :class="{ ready: hasTaskInput }">
                <div class="writer-brief-head">
                  <span>写作 Brief</span>
                  <span class="status-pill" :class="hasTaskInput ? 'done' : 'pending'">{{ hasTaskInput ? '可生成' : '缺素材' }}</span>
                </div>
                <textarea class="writer-textarea brief" v-model="brief" placeholder="这里可以补充结构、卖点、禁用词或品牌口径。"></textarea>
              </div>

              <div class="writer-actionbar">
                <button class="btn icon-toggle" :class="{ active: form.useWebResearch }" type="button" :aria-pressed="form.useWebResearch" @click="form.useWebResearch = !form.useWebResearch">
                  {{ form.useWebResearch ? '联网开' : '联网关' }}
                </button>
                <button class="btn" type="button" @click="form.save = !form.save">{{ form.save ? '保存草稿' : '不保存' }}</button>
                <button class="btn primary" type="button" :disabled="!canWrite || writing" @click="writeCopy">
                  {{ writing ? '生成中' : '生成文案' }}
                </button>
              </div>
            </div>

            <div class="writer-result">
              <div class="section-title-row">
                <h2>结果</h2>
                <div v-if="resultText" class="button-row">
                  <button class="btn" type="button" @click="copyResult">复制</button>
                  <button class="btn" type="button" :disabled="!canWrite" @click="writeCopy">重写</button>
                </div>
                <span v-else class="status-pill pending" :data-busy="writing ? 'true' : undefined">{{ writing ? '生成中' : '待输入' }}</span>
              </div>
              <div class="result-box" :class="{ empty: !resultText }">
                {{ writing && !resultText ? '等待内容。' : (resultText || '结果在这里。') }}
              </div>
            </div>
          </div>
        </section>

        <aside class="panel writer-history-panel">
          <div class="writer-history-shell">
            <div class="writer-history-header">
              <div>
                <h2>草稿</h2>
                <p class="pane-subtitle">{{ drafts.length }} 条历史</p>
              </div>
              <button class="btn compact" type="button" :disabled="loading" @click="loadAll">刷新</button>
            </div>
            <div class="writer-history-body">
              <div class="writer-history-list">
                <button
                  v-for="draft in drafts"
                  :key="draft.id"
                  type="button"
                  class="list-button"
                  :class="{ active: draft.id === activeDraftId }"
                  @click="openDraft(draft)">
                  <span class="writer-history-copy">
                    <strong class="list-title">{{ draft.title || '未命名草稿' }}</strong>
                    <span class="list-meta">{{ draft.accountName || draft.projectName || draft.targetType }} · {{ timeLabel(draft.updatedAt || draft.createdAt) }}</span>
                  </span>
                  <span class="status-pill">{{ modeLabel(draft.mode) }}</span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { loadDrafts, loadStyleLibrary, writeStyleCopy } from '../api/styleWorkbench'

const loading = ref(false)
const writing = ref(false)
const error = ref('')
const library = ref(null)
const draftState = ref({ drafts: [] })
const resultText = ref('')
const brief = ref('')
const activeDraftId = ref('')
const form = reactive({
  targetType: 'account',
  accountId: '',
  projectId: '',
  mode: 'rewrite',
  prompt: '',
  sourceText: '',
  save: true,
  useWebResearch: false
})

const accounts = computed(() => library.value?.accounts || [])
const projects = computed(() => library.value?.projects || [])
const drafts = computed(() => Array.isArray(draftState.value) ? draftState.value : (draftState.value?.drafts || []))
const activeTitle = computed(() => {
  if (form.targetType === 'project') return projects.value.find((project) => project.id === form.projectId)?.name || ''
  return accounts.value.find((account) => account.id === form.accountId)?.name || ''
})
const hasTaskInput = computed(() => Boolean(form.sourceText.trim() || form.prompt.trim() || brief.value.trim()))
const canWrite = computed(() => Boolean(form.targetType === 'account' ? form.accountId : form.projectId) && hasTaskInput.value)
const linkCount = computed(() => (form.sourceText.match(/https?:\/\//g) || []).length)
const materialCount = computed(() => Math.max(1, form.sourceText.split(/\n\s*\n/).filter((part) => part.trim()).length))

onMounted(loadAll)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [nextLibrary, nextDrafts] = await Promise.all([loadStyleLibrary(), loadDrafts()])
    library.value = nextLibrary
    draftState.value = nextDrafts
    if (!form.accountId && accounts.value[0]) form.accountId = accounts.value[0].id
    if (!form.projectId && projects.value[0]) form.projectId = projects.value[0].id
  } catch (err) {
    error.value = err.message || '写作数据读取失败'
  } finally {
    loading.value = false
  }
}

async function writeCopy() {
  const targetId = form.targetType === 'account' ? form.accountId : form.projectId
  if (!targetId) {
    error.value = '请选择写作对象'
    return
  }
  writing.value = true
  error.value = ''
  try {
    const account = accounts.value.find((item) => item.id === form.accountId)
    const result = await writeStyleCopy({
      targetType: form.targetType,
      platform: account?.platform,
      accountId: form.targetType === 'account' ? form.accountId : undefined,
      projectId: form.targetType === 'project' ? form.projectId : undefined,
      mode: form.mode,
      prompt: [form.prompt, brief.value].filter(Boolean).join('\n\n'),
      sourceText: form.sourceText,
      save: form.save,
      useWebResearch: form.useWebResearch
    })
    resultText.value = result.content || ''
    if (result.draft) {
      activeDraftId.value = result.draft.id
      await loadAll()
    }
  } catch (err) {
    error.value = err.message || '文案生成失败'
  } finally {
    writing.value = false
  }
}

function openDraft(draft) {
  activeDraftId.value = draft.id
  resultText.value = draft.content || ''
  form.mode = draft.mode || form.mode
  form.targetType = draft.targetType || form.targetType
  if (draft.accountId) form.accountId = draft.accountId
  if (draft.projectId) form.projectId = draft.projectId
}

async function copyResult() {
  await navigator.clipboard?.writeText(resultText.value).catch(() => {})
}

function platformLabel(platform) {
  return platform === 'bilibili' ? 'B站' : '抖音'
}

function modeLabel(mode) {
  if (mode === 'topic') return '选题'
  if (mode === 'script') return '脚本'
  if (mode === 'commentary') return '口播'
  if (mode === 'rewrite') return '改写'
  return mode || '草稿'
}

function timeLabel(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>
