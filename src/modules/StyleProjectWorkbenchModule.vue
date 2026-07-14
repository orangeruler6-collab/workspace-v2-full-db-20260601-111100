<template>
  <section class="style-workbench-native">
    <div class="page project-workbench-page">
      <div v-if="error" class="error" role="alert">{{ error }}</div>

      <section class="project-workbench-shell">
        <div class="project-workbench-flow" aria-label="项目工作流">
          <div class="project-flow-steps">
            <div class="project-flow-step" :class="projectState">
              <span class="project-flow-icon"><FolderKanban :size="15" aria-hidden="true" /></span>
              <span class="project-flow-copy"><strong>项目</strong><small>{{ projectValue }}</small></span>
              <CheckCircle2 v-if="projectState === 'done'" class="project-flow-state" :size="15" aria-hidden="true" />
              <CircleDashed v-else class="project-flow-state" :size="15" aria-hidden="true" />
            </div>
            <div class="project-flow-step" :class="projectSources.length ? 'done' : 'pending'">
              <span class="project-flow-icon"><FileText :size="15" aria-hidden="true" /></span>
              <span class="project-flow-copy"><strong>案例素材</strong><small>{{ projectSources.length ? `${projectSources.length} 份` : '待添加' }}</small></span>
              <CheckCircle2 v-if="projectSources.length" class="project-flow-state" :size="15" aria-hidden="true" />
              <CircleDashed v-else class="project-flow-state" :size="15" aria-hidden="true" />
            </div>
            <div class="project-flow-step" :class="selectedAccounts.length ? 'done' : 'neutral'">
              <span class="project-flow-icon"><UsersRound :size="15" aria-hidden="true" /></span>
              <span class="project-flow-copy"><strong>参考账号</strong><small>{{ selectedAccounts.length ? `${selectedAccounts.length} 个` : '可选' }}</small></span>
              <CheckCircle2 v-if="selectedAccounts.length" class="project-flow-state" :size="15" aria-hidden="true" />
              <CircleDashed v-else class="project-flow-state" :size="15" aria-hidden="true" />
            </div>
            <div class="project-flow-step" :class="styleState">
              <span class="project-flow-icon"><PenLine :size="15" aria-hidden="true" /></span>
              <span class="project-flow-copy"><strong>风格卡</strong><small>{{ generatingStyle ? '生成中' : styleCount ? `${styleCount} 字` : '待生成' }}</small></span>
              <CheckCircle2 v-if="styleCount" class="project-flow-state" :size="15" aria-hidden="true" />
              <CircleDashed v-else class="project-flow-state" :size="15" aria-hidden="true" />
            </div>
          </div>
          <div class="project-flow-action">
            <button class="btn primary" type="button" :disabled="flowActionDisabled" @click="handlePrimaryFlowAction">
              <component v-if="flowActionIconPosition === 'before'" :is="flowActionIcon" :size="15" aria-hidden="true" />
              {{ flowActionLabel }}
              <component v-if="flowActionIconPosition === 'after'" :is="flowActionIcon" :size="15" aria-hidden="true" />
            </button>
          </div>
        </div>

        <main class="project-workbench-canvas">
          <div class="project-workbench-grid">
            <aside class="project-workbench-section project-context-panel">
              <button class="project-context-summary project-context-summary-button" type="button" @click="focusProjectSelection">
                <span class="project-context-icon" aria-hidden="true">
                  <FolderKanban :size="15" />
                </span>
                <span class="project-context-summary-copy">
                  <span class="project-context-title-row">
                    <strong>{{ projectTitle }}</strong>
                    <span class="project-save-state" :class="selectedProject && !isDirty ? 'done' : 'pending'">{{ projectSaveLabel }}</span>
                  </span>
                  <small>{{ projectForm.description || '填写项目说明' }}</small>
                </span>
                <ChevronDown :size="15" aria-hidden="true" />
              </button>

              <div class="project-context-readiness">
                <div><strong>{{ projectSources.length }}</strong><span>案例素材</span></div>
                <div><strong>{{ selectedAccounts.length }}</strong><span>参考账号</span></div>
              </div>
              <p class="project-context-note">{{ contextSummary }}</p>

              <div class="project-context-block">
                <div class="project-context-block-head">
                  <div>
                    <h3>素材池</h3>
                    <small>{{ projectSources.length }} 份案例素材</small>
                  </div>
                  <div v-if="projectSources.length" class="project-context-actions">
                    <button class="btn compact" type="button" @click="focusSourceSelection">
                      <Plus :size="14" aria-hidden="true" />
                      加入
                    </button>
                    <button class="btn compact" type="button" @click="focusLinkInput">转写</button>
                    <button class="btn compact" type="button">管理</button>
                  </div>
                </div>
                <div v-if="projectSources.length" class="project-workbench-source-list source-pool-scroll">
                  <button
                    v-for="source in projectSources"
                    :key="source.id"
                    type="button"
                    class="project-workbench-source compact"
                    @click="previewSource(source)">
                    <span class="project-workbench-source-icon"><FileText :size="15" aria-hidden="true" /></span>
                    <span>
                      <strong>{{ source.title || '未命名素材' }}</strong>
                      <small>{{ platformLabel(source.platform) }} · {{ source.wordCount || source.textLength || 0 }} 字</small>
                    </span>
                    <span class="project-workbench-source-action">查看</span>
                  </button>
                </div>
                <div v-else class="project-empty-actions">
                  <button class="project-workbench-empty action" type="button" @click="focusSourceSelection">选已有素材</button>
                  <button class="project-workbench-empty action" type="button" @click="focusLinkInput">转写链接</button>
                </div>
              </div>

              <div class="project-context-block project-account-supplement">
                <div class="project-context-block-head">
                  <div>
                    <h3>参考账号</h3>
                    <small>{{ selectedAccounts.length ? `${selectedAccounts.length} 个已选` : '可选补充长期口吻' }}</small>
                  </div>
                  <button class="btn compact" type="button" @click="focusAccountSelection">
                    <UsersRound :size="14" aria-hidden="true" />
                    账号
                  </button>
                </div>
                <div v-if="selectedAccounts.length" class="project-account-chip-list" aria-label="已选账号">
                  <button
                    v-for="account in selectedAccounts.slice(0, 4)"
                    :key="account.id"
                    class="project-account-chip"
                    type="button"
                    title="参考账号">
                    <strong>{{ account.name }}</strong>
                    <span>{{ platformLabel(account.platform) }} · {{ account.transcriptCount || 0 }}</span>
                  </button>
                  <button v-if="selectedAccounts.length > 4" class="project-account-chip muted" type="button">+{{ selectedAccounts.length - 4 }}</button>
                </div>
                <p v-else class="microcopy">{{ emptyAccountHint }}</p>
              </div>
            </aside>

            <section class="project-workbench-section style-editor-panel">
              <div class="project-style-head">
                <div class="project-style-heading">
                  <span class="project-style-kicker">
                    <FileText :size="14" aria-hidden="true" />
                    项目资产
                  </span>
                  <h2>风格卡</h2>
                  <p class="pane-subtitle">{{ styleStatus }}</p>
                </div>
                <div class="project-style-actions">
                  <span class="status-pill" :class="selectedProject && !isDirty ? 'done' : 'pending'">{{ projectSaveLabel }}</span>
                  <button class="btn" type="button" :disabled="generatingStyle || !selectedProject" @click="generateStyle">
                    <Sparkles :size="16" aria-hidden="true" />
                    {{ generatingStyle ? '生成中' : (styleCount ? '重生成' : '生成') }}
                  </button>
                  <button v-if="canShowSave" class="btn" type="button" :disabled="!canSaveWorkspace || savingStyle" @click="saveStyle">
                    <Save :size="16" aria-hidden="true" />
                    {{ savingStyle ? '保存中' : '保存' }}
                  </button>
                  <button class="btn primary" type="button" :class="{ disabled: !canWrite }" :disabled="!canWrite" @click="goWriter">
                    写作
                    <ArrowRight :size="16" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div class="project-style-meta">
                <div><span>字数</span><strong>{{ styleCount || '0' }}</strong></div>
                <div><span>来源</span><strong>{{ selectedProject ? '当前项目' : '未绑定项目' }}</strong></div>
                <div><span>状态</span><strong>{{ generatingStyle ? '生成中' : isDirty ? '有修改' : '已同步' }}</strong></div>
              </div>

              <div class="project-style-document">
                <textarea class="project-workbench-style" v-model="styleDraft" :placeholder="emptyStylePlaceholder"></textarea>
              </div>
            </section>
          </div>
        </main>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ArrowRight, CheckCircle2, ChevronDown, CircleDashed, FileText, FolderKanban, PenLine, Plus, RefreshCw, Save, Sparkles, UsersRound } from 'lucide-vue-next'
import {
  generateProjectStyle,
  loadCopySources,
  loadProjectDetail,
  loadStyleLibrary,
  saveProjectStyle,
  saveStyleProject,
  transcribeCopySource
} from '../api/styleWorkbench'

const loading = ref(false)
const savingProject = ref(false)
const transcribing = ref(false)
const generatingStyle = ref(false)
const savingStyle = ref(false)
const error = ref('')
const library = ref(null)
const copySourceState = ref({ sources: [] })
const selectedProject = ref(null)
const projectDetail = ref(null)
const styleDraft = ref('')
const projectForm = reactive({
  projectId: '',
  name: '',
  description: '',
  sourceAccountIds: [],
  sourceMaterialIds: []
})
const sourceForm = reactive({
  url: '',
  titleHint: ''
})

const projects = computed(() => library.value?.projects || [])
const accounts = computed(() => library.value?.accounts || [])
const sources = computed(() => copySourceState.value?.sources || library.value?.copySources || [])
const styleCount = computed(() => styleDraft.value.trim().length)
const projectSources = computed(() => {
  const selectedIds = new Set(projectForm.sourceMaterialIds || [])
  const detailSources = projectDetail.value?.sourceMaterials || projectDetail.value?.project?.sourceMaterials || []
  const poolSources = sources.value.filter((source) => selectedIds.has(source.id))
  const merged = [...detailSources, ...poolSources]
  const seen = new Set()
  return merged.filter((source) => {
    if (!source?.id || seen.has(source.id)) return false
    seen.add(source.id)
    return true
  })
})
const selectedAccounts = computed(() => {
  const selectedIds = new Set(projectForm.sourceAccountIds || [])
  const detailAccounts = projectDetail.value?.sourceAccounts || projectDetail.value?.project?.sourceAccounts || []
  const poolAccounts = accounts.value.filter((account) => selectedIds.has(account.id))
  const merged = [...detailAccounts, ...poolAccounts]
  const seen = new Set()
  return merged.filter((account) => {
    if (!account?.id || seen.has(account.id)) return false
    seen.add(account.id)
    return true
  })
})
const projectTitle = computed(() => projectForm.name.trim() || selectedProject.value?.name || '未命名项目')
const isDirty = computed(() => {
  if (!selectedProject.value) return Boolean(projectForm.name.trim() || projectForm.description.trim() || styleDraft.value.trim())
  const savedStyle = projectDetail.value?.style || ''
  return projectForm.name !== selectedProject.value.name ||
    projectForm.description !== (selectedProject.value.description || '') ||
    styleDraft.value !== savedStyle
})
const projectState = computed(() => selectedProject.value ? (isDirty.value ? 'pending' : 'done') : projectForm.name.trim() ? 'pending' : 'neutral')
const projectValue = computed(() => selectedProject.value ? (isDirty.value ? '未保存' : '已保存') : projectForm.name.trim() ? '待保存' : '未命名')
const projectSaveLabel = computed(() => selectedProject.value ? (isDirty.value ? '未保存' : '已保存') : '待保存')
const styleState = computed(() => generatingStyle.value ? 'active' : styleCount.value ? 'done' : 'pending')
const styleStatus = computed(() => {
  if (generatingStyle.value) return '正在生成项目风格卡'
  if (styleCount.value) return '可继续编辑，也可以直接进入写作'
  return '等待素材生成'
})
const contextSummary = computed(() => projectSources.value.length
  ? `${projectSources.value.length} 份案例素材将参与风格提炼`
  : '从素材池检索已有案例，或粘贴链接转写后加入。')
const emptyAccountHint = computed(() => accounts.value.length ? '未选择时，仅用素材池生成风格卡。' : '暂无账号，可只用素材池生成。')
const canSaveWorkspace = computed(() => Boolean(selectedProject.value && isDirty.value && !savingStyle.value))
const canShowSave = computed(() => Boolean(selectedProject.value))
const canWrite = computed(() => Boolean(styleCount.value))
const flowActionLabel = computed(() => {
  if (!projectForm.name.trim() && !selectedProject.value) return '选择项目'
  if (generatingStyle.value) return '生成中'
  if (isDirty.value && selectedProject.value) return '保存修改'
  if (styleCount.value) return '进入写作'
  if (!projectSources.value.length && !selectedAccounts.value.length) return '添加素材'
  return '生成风格'
})
const flowActionDisabled = computed(() => generatingStyle.value || savingProject.value || savingStyle.value)
const flowActionIcon = computed(() => {
  if (generatingStyle.value || flowActionLabel.value === '生成风格') return Sparkles
  return ArrowRight
})
const flowActionIconPosition = computed(() => flowActionIcon.value === Sparkles ? 'before' : 'after')
const emptyStylePlaceholder = `# 项目风格卡

## 一、项目定位

## 二、内容口吻

## 三、结构节奏

## 四、禁用表达`

onMounted(loadAll)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [nextLibrary, nextSources] = await Promise.all([loadStyleLibrary(), loadCopySources()])
    library.value = nextLibrary
    copySourceState.value = nextSources
    if (!selectedProject.value && projects.value.length) await selectProject(projects.value[0])
  } catch (err) {
    error.value = err.message || '项目数据读取失败'
  } finally {
    loading.value = false
  }
}

async function selectProject(project) {
  selectedProject.value = project
  projectForm.projectId = project.id
  projectForm.name = project.name
  projectForm.description = project.description || ''
  projectForm.sourceAccountIds = project.sourceAccountIds || project.sourceAccounts?.map((item) => item.id) || []
  projectForm.sourceMaterialIds = project.sourceMaterialIds || project.sourceMaterials?.map((item) => item.id) || []
  try {
    projectDetail.value = await loadProjectDetail(project.id, true)
    const detailProject = projectDetail.value?.project || projectDetail.value
    if (Array.isArray(detailProject?.sourceAccountIds)) projectForm.sourceAccountIds = detailProject.sourceAccountIds
    if (Array.isArray(detailProject?.sourceMaterialIds)) projectForm.sourceMaterialIds = detailProject.sourceMaterialIds
    styleDraft.value = projectDetail.value?.style || ''
  } catch (err) {
    error.value = err.message || '项目详情读取失败'
  }
}

async function saveProject() {
  if (!projectForm.name.trim()) {
    error.value = '请输入项目名'
    return
  }
  savingProject.value = true
  error.value = ''
  try {
    const saved = await saveStyleProject({ ...projectForm })
    await loadAll()
    const next = projects.value.find((item) => item.id === saved.id) || saved
    await selectProject(next)
  } catch (err) {
    error.value = err.message || '项目保存失败'
  } finally {
    savingProject.value = false
  }
}

async function transcribeSource() {
  if (!sourceForm.url.trim()) {
    error.value = '请粘贴素材链接'
    return
  }
  transcribing.value = true
  error.value = ''
  try {
    const result = await transcribeCopySource({ ...sourceForm, analyzeVideo: true })
    projectForm.sourceMaterialIds = Array.from(new Set([...projectForm.sourceMaterialIds, result.source.id]))
    sourceForm.url = ''
    sourceForm.titleHint = ''
    await loadAll()
  } catch (err) {
    error.value = err.message || '素材转写失败'
  } finally {
    transcribing.value = false
  }
}

async function generateStyle() {
  if (!selectedProject.value) return
  generatingStyle.value = true
  error.value = ''
  try {
    const result = await generateProjectStyle(selectedProject.value.id)
    styleDraft.value = result.style || ''
  } catch (err) {
    error.value = err.message || '项目风格生成失败'
  } finally {
    generatingStyle.value = false
  }
}

async function saveStyle() {
  if (!selectedProject.value) return
  savingStyle.value = true
  error.value = ''
  try {
    await saveProjectStyle({ projectId: selectedProject.value.id, content: styleDraft.value })
    await selectProject(selectedProject.value)
  } catch (err) {
    error.value = err.message || '项目风格保存失败'
  } finally {
    savingStyle.value = false
  }
}

function handlePrimaryFlowAction() {
  if (!projectForm.name.trim() && !selectedProject.value) {
    focusProjectSelection()
    return
  }
  if (isDirty.value && selectedProject.value) {
    saveStyle()
    return
  }
  if (styleCount.value) {
    goWriter()
    return
  }
  if (!projectSources.value.length && !selectedAccounts.value.length) {
    focusSourceSelection()
    return
  }
  generateStyle()
}

function focusProjectSelection() {
  const firstProject = projects.value[0]
  if (firstProject && !selectedProject.value) selectProject(firstProject)
}

function focusSourceSelection() {}

function focusLinkInput() {}

function focusAccountSelection() {}

function previewSource() {}

function goWriter() {
  window.dispatchEvent(new CustomEvent('usagi:navigate', { detail: { module: 'styleWriter' } }))
}

function platformLabel(platform) {
  if (platform === 'bilibili') return 'B站'
  if (platform === 'douyin') return '抖音'
  return '链接'
}
</script>
