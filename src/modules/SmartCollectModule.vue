<template>
  <div class="ai-edit-page">
    <header class="module-page-header edit-header">
      <div class="module-page-title">
        <span class="module-page-icon">剪</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">VOICEOVER TO ROUGH CUT</div>
          <h2>AI剪辑工作台</h2>
          <p>先用文案和配音生成粗剪时间线，再逐段匹配素材，确认后导出 PR XML / timeline JSON 给剪辑继续精修。</p>
        </div>
      </div>
      <div class="module-page-actions">
        <span class="module-page-pill">{{ projectId ? '项目 ' + projectId : '半自动粗剪 V1' }}</span>
        <button class="btn btn-ghost btn-sm" @click="openMaterialFolder">打开素材库</button>
      </div>
      <div class="edit-hero-ui" aria-hidden="true">
        <div class="hero-ui-top">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="hero-ui-wave">
          <i v-for="n in 24" :key="n" :style="{ height: 10 + ((n * 7) % 24) + 'px' }"></i>
        </div>
        <div class="hero-ui-scenes">
          <span v-for="n in 4" :key="n"></span>
        </div>
        <div class="hero-ui-timeline">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </header>

    <section class="edit-layout">
      <aside class="input-rail">
        <div class="rail-card hero-card">
          <div class="card-head">
            <span class="step-dot">1</span>
            <div>
              <strong>输入区</strong>
              <small>文案、配音、比例和剪辑风格</small>
            </div>
          </div>

          <label class="input-group">
            <span>项目名</span>
            <input v-model="projectName" class="inp" placeholder="例如：呼叫网管游戏故事粗剪" />
          </label>

          <div class="two-grid">
            <label class="input-group">
              <span>目标比例</span>
              <select v-model="targetRatio" class="inp">
                <option value="9:16">9:16 竖屏</option>
                <option value="16:9">16:9 横屏</option>
                <option value="1:1">1:1 方屏</option>
              </select>
            </label>
            <label class="input-group">
              <span>剪辑风格</span>
              <select v-model="editStyle" class="inp">
                <option value="story">叙事讲述</option>
                <option value="fast">快节奏信息流</option>
                <option value="tianji">天机妹式热点故事</option>
                <option value="review">评论解析</option>
                <option value="game">游戏高能</option>
              </select>
            </label>
          </div>

          <label class="input-group">
            <span>完整文案</span>
            <textarea
              v-model="scriptText"
              class="inp script-box"
              rows="12"
              placeholder="粘贴最终口播文案。配音上传后会优先按配音时长切分镜；没有配音时按文案长度估算。"></textarea>
          </label>

          <label class="voice-drop" :class="{ ready: voiceoverInfo }">
            <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" @change="handleVoiceFile" />
            <span class="voice-icon">VO</span>
            <strong>{{ voiceoverFile ? voiceoverFile.name : '上传配音文件' }}</strong>
            <small>{{ voiceoverInfo ? formatTime(voiceoverInfo.duration) + ' · ' + durationSourceLabel : '支持 mp3 / wav / m4a；可稍后再传' }}</small>
          </label>

          <button class="btn btn-primary run-btn" @click="generateTimeline" :disabled="planning || !canGenerate">
            {{ planning ? '正在生成时间线...' : '生成分镜时间线' }}
          </button>
          <p class="hint">V1 先做可控粗剪：AI 给时间线和素材候选，最终选择权留给剪辑。</p>
        </div>

        <div class="rail-card assist-card">
          <div class="card-head compact">
            <span class="step-dot soft">+</span>
            <div>
              <strong>辅助素材</strong>
              <small>B站可自动下载；抖音请贴单条链接/主页或拖入素材</small>
            </div>
          </div>
          <textarea
            v-model="linksText"
            class="inp link-box"
            rows="5"
            placeholder="已有 B站视频、抖音单条视频、抖音账号主页/sec_uid、截图素材说明可贴这里。抖音关键词搜索暂不稳定，不会在这里假装自动搜索。"></textarea>
          <div class="ability-note">
            <strong>当前自动能力</strong>
            <span>本地素材库匹配 / B站关键词候选 / B站下载入库 / 图片或视频拖入当前镜头</span>
            <strong>需要人工补充</strong>
            <span>抖音关键词视频、评论截图、榜单截图、版权敏感原片</span>
          </div>
          <div class="assist-actions">
            <button class="btn btn-ghost btn-sm" @click="prepareLinks" :disabled="preparing || !canPrepareLinks">
              {{ preparing ? '整理中...' : '整理链接候选' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="downloadSelected" :disabled="!selectedIds.length || downloading">
              {{ downloading ? '入库中...' : `下载入库 ${selectedIds.length}` }}
            </button>
          </div>
          <div v-if="candidates.length" class="mini-candidates">
            <label v-for="item in candidates" :key="item.id" class="mini-candidate">
              <input type="checkbox" :checked="selectedIds.includes(item.id)" @change="toggle(item.id)" />
              <span>{{ item.title }}</span>
            </label>
          </div>
        </div>
      </aside>

      <main class="timeline-workbench ai-studio">
        <div class="workbench-toolbar">
          <div>
            <strong>AI 粗剪台</strong>
            <span>{{ scenes.length ? `${scenes.length} 个镜头 · ${formatTime(totalDuration)} · 已确认 ${selectedSceneCount}/${scenes.length} 镜头 · ${selectedUniqueAssetCount} 个唯一素材 / ${selectedAssetReferenceCount} 次引用` : '等待生成粗剪骨架' }}</span>
          </div>
          <div class="toolbar-actions">
            <button class="btn btn-primary btn-sm" @click="runSmartRoughCut" :disabled="smartRunning || !canGenerate">
              {{ smartRunning ? '智能剪辑中...' : '一键智能粗剪' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="searchAllScenes" :disabled="!scenes.length || searchingAll">
              {{ searchingAll ? '匹配中...' : '全部匹配素材' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="autoSelectCandidates" :disabled="!scenes.length">
              自动选素材
            </button>
            <button class="btn btn-ghost btn-sm" @click="saveTimeline" :disabled="!scenes.length || saving">
              {{ saving ? '保存中...' : '保存时间线' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="renderRoughCut" :disabled="!selectedSceneCount || rendering">
              {{ rendering ? '生成中...' : '生成粗剪' }}
            </button>
            <button class="btn btn-primary btn-sm" @click="exportPrXml" :disabled="!scenes.length || exporting">
              {{ exporting ? '导出中...' : '导出工程' }}
            </button>
          </div>
        </div>

        <div v-if="message" class="collect-message" :class="messageType">{{ message }}</div>
        <div class="capability-strip">
          <span class="ok">分镜</span>
          <span class="ok">素材匹配</span>
          <span class="ok">PR 工程</span>
          <span :class="selectedSceneCount ? 'ok' : 'pending'">粗剪 MP4</span>
        </div>
        <div v-if="workflowSteps.length" class="workflow-steps">
          <div
            v-for="step in workflowSteps"
            :key="step.key"
            class="workflow-step"
            :class="step.status">
            <span>{{ step.status === 'done' ? '✓' : step.status === 'running' ? '…' : step.status === 'error' ? '!' : '·' }}</span>
            <strong>{{ step.label }}</strong>
            <small>{{ step.note }}</small>
          </div>
        </div>

        <div v-if="!scenes.length" class="empty-state">
          <div class="empty-mark">00:00</div>
          <strong>从配音和文案开始生成粗剪</strong>
          <p>上传配音后会读取音频时长，按文案语义切成可确认的分镜段；如果 ffprobe 不可用，也会按文案长度兜底。</p>
        </div>

        <template v-else>
          <section class="studio-stage">
              <div class="preview-panel">
                <div class="preview-screen" :class="previewRatioClass">
                <div class="preview-safe" :class="{ 'has-material': primarySceneCandidate(activeScene) }">
                  <img
                    v-if="primarySceneCandidate(activeScene)?.thumb"
                    class="preview-media-thumb"
                    :src="primarySceneCandidate(activeScene).thumb"
                    alt="" />
                  <span class="source-badge">{{ primarySceneCandidate(activeScene) ? (primarySceneCandidate(activeScene).platform_label || primarySceneCandidate(activeScene).source || '本地素材') : '等待选素材' }}</span>
                  <strong>{{ activeScene ? `镜头 ${activeScene.index}` : '选择镜头' }}</strong>
                  <p>{{ activeScene?.visual_need || '这里会显示当前镜头的画面需求，选中素材后作为剪辑预览占位。' }}</p>
                </div>
              </div>
              <div class="preview-footer">
                <div>
                  <strong>{{ activeScene ? `${formatTime(activeScene.start)} - ${formatTime(activeScene.end)}` : '00:00 - 00:00' }}</strong>
                  <span>{{ activeScene?.duration ? formatTime(activeScene.duration) : '待估算' }}</span>
                </div>
                <p>{{ activeScene?.script_text || activeScene?.script || '点选下方镜头卡，右侧会出现该镜头的素材候选和可编辑字段。' }}</p>
              </div>
            </div>

            <aside class="scene-inspector" v-if="activeScene">
              <div class="inspector-head">
                <div>
                  <span>当前镜头</span>
                  <strong>{{ activeScene.index }} / {{ scenes.length }}</strong>
                </div>
                <button class="btn btn-ghost btn-sm" @click="searchSceneMaterial(activeScene)" :disabled="searchingIds.includes(activeScene.id)">
                  {{ searchingIds.includes(activeScene.id) ? '匹配中...' : '智能找素材' }}
                </button>
              </div>

              <label class="input-group">
                <span>画面需求</span>
                <textarea v-model="activeScene.visual_need" class="inp micro-area" rows="3"></textarea>
              </label>
              <label class="input-group">
                <span>搜索词</span>
                <input v-model="activeScene.search_query" class="inp" />
              </label>

              <label
                class="scene-drop"
                :class="{ over: draggingSceneFile }"
                @dragenter.prevent="draggingSceneFile = true"
                @dragover.prevent
                @dragleave.prevent="draggingSceneFile = false"
                @drop.prevent="handleSceneDrop">
                <input type="file" accept="video/*,image/*,.mp4,.mov,.webm,.png,.jpg,.jpeg,.webp" @change="handleSceneFile" />
                <strong>拖入当前镜头素材</strong>
                <small>截图、梗图、排名页或视频片段都可以；上传后会直接选入该镜头。</small>
              </label>

              <div class="asset-plan" v-if="activeScene.asset_label || activeScene.collect_from?.length || activeScene.match_tips">
                <div>
                  <span>素材类型</span>
                  <strong>{{ activeScene.asset_label || activeScene.asset_type || '待判断' }}</strong>
                </div>
                <p v-if="activeScene.collect_from?.length">建议来源：{{ activeScene.collect_from.join(' / ') }}</p>
                <p v-if="activeScene.auto_collect?.length">系统会自动查：{{ activeScene.auto_collect.join(' / ') }}</p>
                <p v-if="activeScene.manual_collect?.length">需要人工确认：{{ activeScene.manual_collect.join(' / ') }}</p>
                <p v-if="activeScene.platform_scope">{{ activeScene.platform_scope }}</p>
                <p v-if="activeScene.match_tips">{{ activeScene.match_tips }}</p>
                <div v-if="activeScene.search_queries?.length" class="query-chips">
                  <button
                    v-for="query in activeScene.search_queries"
                    :key="query"
                    type="button"
                    class="query-chip"
                    @click="activeScene.search_query = query">
                    {{ query }}
                  </button>
                </div>
              </div>

              <div v-if="activeScene.warning" class="scene-warning">{{ activeScene.warning }}</div>

              <div class="selected-line" :class="{ empty: !sceneSelectedCandidates(activeScene).length }">
                <span>{{ sceneSelectedCandidates(activeScene).length ? `已选 ${sceneSelectedCandidates(activeScene).length} 条素材` : '这个镜头还没有确认素材' }}</span>
                <button v-if="sceneSelectedCandidates(activeScene).length" class="text-btn" @click="clearSceneCandidate(activeScene)">清空</button>
              </div>
              <div v-if="sceneSelectedCandidates(activeScene).length" class="selected-materials">
                <button
                  v-for="item in sceneSelectedCandidates(activeScene)"
                  :key="'selected-' + item.id"
                  type="button"
                  class="selected-material-chip"
                  @click="toggleSceneCandidate(activeScene, item)">
                  <span>{{ item.platform_label || item.source || '素材' }}</span>
                  <strong>{{ item.title }}</strong>
                </button>
              </div>

              <div class="candidate-strip compact">
                <button
                  v-for="item in activeScene.candidates || []"
                  :key="item.id"
                  type="button"
                  class="material-chip"
                  :class="{ active: isSceneCandidateSelected(activeScene, item) }"
                  @click="toggleSceneCandidate(activeScene, item)">
                  <span class="source-badge">{{ item.platform_label || item.source }}</span>
                  <strong>{{ item.title }}</strong>
                  <small>{{ item.match_reason }}</small>
                </button>
                <div v-if="!(activeScene.candidates || []).length" class="candidate-empty">
                  还没有候选素材，先点“智能找素材”。
                </div>
              </div>
            </aside>
          </section>

          <section class="material-brief" v-if="assetBrief.length">
            <div class="brief-head">
              <div>
                <strong>素材包清单</strong>
                <span>按镜头画面类型整理，先补缺口最大的类型。</span>
              </div>
              <button class="btn btn-ghost btn-sm" @click="copyAssetBrief">复制清单</button>
            </div>
            <div class="brief-grid">
              <button
                v-for="group in assetBrief"
                :key="group.label"
                type="button"
                class="brief-card"
                @click="setActiveScene(group.first)">
                <span>{{ group.label }}</span>
                <strong>{{ group.ready }}/{{ group.count }}</strong>
                <small>{{ group.sources }}</small>
                <small v-if="group.manualTips">{{ group.manualTips }}</small>
              </button>
            </div>
          </section>

          <section class="filmstrip-panel">
            <button
              v-for="scene in scenes"
              :key="scene.id"
              type="button"
              class="shot-card"
              :class="{ active: activeScene?.id === scene.id, ready: sceneSelectedCandidates(scene).length }"
              @click="setActiveScene(scene)">
              <span>{{ String(scene.index).padStart(2, '0') }}</span>
              <em v-if="scene.asset_label">{{ scene.asset_label }}</em>
              <strong>{{ sceneSelectedTitle(scene) || scene.visual_need || '待匹配素材' }}</strong>
              <small>{{ formatTime(scene.start) }} - {{ formatTime(scene.end) }}</small>
            </button>
          </section>

          <section class="track-board">
            <div class="track-row">
              <span class="track-label">画面轨</span>
              <div class="track-clips">
                <button
                  v-for="scene in scenes"
                  :key="'v-' + scene.id"
                  type="button"
                  class="track-clip video"
                  :class="{ active: activeScene?.id === scene.id, empty: !sceneSelectedCandidates(scene).length }"
                  :style="{ flexGrow: Math.max(1, Math.round(scene.duration || 1)) }"
                  @click="setActiveScene(scene)">
                  {{ sceneSelectedCandidates(scene).length ? `${sceneSelectedCandidates(scene).length}素材` : '缺素材' }}
                </button>
              </div>
            </div>
            <div class="track-row">
              <span class="track-label">配音轨</span>
              <div class="track-clips">
                <div class="track-clip audio">{{ voiceoverInfo ? voiceoverFile?.name || 'voiceover' : '未上传配音，按文案估算' }}</div>
              </div>
            </div>
          </section>
        </template>

        <div v-if="exportResult" class="export-card">
          <strong>交接文件已生成</strong>
          <a :href="exportResult.xml_url" target="_blank" rel="noopener">PR XML</a>
          <a :href="exportResult.timeline_url" target="_blank" rel="noopener">timeline JSON</a>
          <a v-if="exportResult.srt_url" :href="exportResult.srt_url" target="_blank" rel="noopener">SRT 字幕</a>
          <span>当前导出的是剪辑工程交接文件，字幕是可二次编辑的外挂文件。</span>
        </div>

        <div v-if="renderResult" class="export-card render-card">
          <strong>粗剪成片已生成</strong>
          <a :href="renderResult.url" target="_blank" rel="noopener">打开 MP4</a>
          <a v-if="renderResult.srt_url" :href="renderResult.srt_url" target="_blank" rel="noopener">SRT 字幕</a>
          <span>已合成 {{ renderResult.clip_count || 0 }} 个镜头；跳过 {{ renderResult.skipped_count || 0 }} 个。</span>
          <video v-if="renderResult.url" :src="renderResult.url" controls></video>
        </div>

        <div v-if="downloadResults.length" class="download-report">
          <h3>下载入库结果</h3>
          <div v-for="item in downloadResults" :key="item.url + item.title" class="download-row" :class="{ ok: item.ok }">
            <strong>{{ item.title || item.url }}</strong>
            <span>{{ item.ok ? '已入库' : '待处理' }}</span>
            <p>{{ item.ok ? (item.storage_path || '已登记到素材库') : (item.error || item.hint || '需要人工处理') }}</p>
          </div>
        </div>
      </main>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  createAiEditProject,
  downloadSmartCollectSelected,
  exportAiEditPrXml,
  planAiEditTimeline,
  prepareSmartCollect,
  renderAiEditRoughCut,
  saveAiEditTimeline,
  searchAiEditScene,
  uploadAiEditMaterial,
  uploadAiEditVoiceover
} from '../api/smartCollect'

const projectName = ref('')
const projectId = ref('')
const materialType = ref('video')
const scriptText = ref('')
const linksText = ref('')
const targetRatio = ref('9:16')
const editStyle = ref('story')
const voiceoverFile = ref(null)
const voiceoverInfo = ref(null)
const planning = ref(false)
const preparing = ref(false)
const downloading = ref(false)
const searchingAll = ref(false)
const searchingIds = ref([])
const saving = ref(false)
const exporting = ref(false)
const rendering = ref(false)
const smartRunning = ref(false)
const scenes = ref([])
const candidates = ref([])
const selectedIds = ref([])
const projectFolder = ref('')
const message = ref('')
const messageType = ref('info')
const downloadResults = ref([])
const exportResult = ref(null)
const renderResult = ref(null)
const plannerSource = ref('')
const activeSceneId = ref('')
const draggingSceneFile = ref(false)
const workflowSteps = ref([])

const canGenerate = computed(() => projectName.value.trim() && scriptText.value.trim())
const canPrepareLinks = computed(() => projectName.value.trim() && linksText.value.trim())
const totalDuration = computed(() => {
  if (voiceoverInfo.value?.duration) return voiceoverInfo.value.duration
  if (!scenes.value.length) return 0
  return scenes.value[scenes.value.length - 1]?.end || 0
})
const durationSourceLabel = computed(() => {
  if (!voiceoverInfo.value) return ''
  return voiceoverInfo.value.duration_source === 'ffprobe' ? '已读取音频时长' : '时长兜底估算'
})
const allCandidates = computed(() => [
  ...candidates.value,
  ...scenes.value.flatMap(scene => scene.candidates || [])
])
const activeScene = computed(() => scenes.value.find(scene => scene.id === activeSceneId.value) || scenes.value[0] || null)
const selectedSceneCount = computed(() => scenes.value.filter(scene => sceneSelectedCandidates(scene).length).length)
const selectedAssetReferenceCount = computed(() => scenes.value.reduce((sum, scene) => sum + sceneSelectedCandidates(scene).length, 0))
const selectedUniqueAssetCount = computed(() => uniqueCandidates(scenes.value.flatMap(scene => sceneSelectedCandidates(scene))).length)
const previewRatioClass = computed(() => ({
  'ratio-vertical': targetRatio.value === '9:16',
  'ratio-wide': targetRatio.value === '16:9',
  'ratio-square': targetRatio.value === '1:1'
}))
const assetBrief = computed(() => {
  const map = new Map()
  scenes.value.forEach(scene => {
    const label = scene.asset_label || '待判断素材'
    if (!map.has(label)) {
      map.set(label, {
        label,
        count: 0,
        ready: 0,
        first: scene,
        sources: new Set(),
        manual: new Set()
      })
    }
    const item = map.get(label)
    item.count += 1
    if (sceneSelectedCandidates(scene).length) item.ready += 1
    ;(scene.collect_from || []).slice(0, 2).forEach(source => item.sources.add(source))
    ;(scene.manual_collect || []).slice(0, 1).forEach(tip => item.manual.add(tip))
  })
  return Array.from(map.values()).map(item => ({
    ...item,
    sources: Array.from(item.sources).join(' / ') || '按镜头需求补素材',
    manualTips: Array.from(item.manual).join(' / ')
  }))
})

function resetWorkflowSteps() {
  workflowSteps.value = [
    { key: 'plan', label: '拆文案分镜', status: 'idle', note: '按文案/配音时长生成镜头' },
    { key: 'match', label: '匹配素材', status: 'idle', note: '查素材库和 B站候选' },
    { key: 'select', label: '自动选素材', status: 'idle', note: '先复用同主体素材，再补新候选' },
    { key: 'render', label: '生成粗剪', status: 'idle', note: '拼接画面、配音和 SRT 字幕' }
  ]
}

function setWorkflowStep(key, status, note) {
  const index = workflowSteps.value.findIndex(step => step.key === key)
  if (index < 0) return
  workflowSteps.value[index] = {
    ...workflowSteps.value[index],
    status,
    note: note || workflowSteps.value[index].note
  }
}

function showMessage(text, type = 'info') {
  message.value = text
  messageType.value = type
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function fileTypeFromFile(file) {
  if (String(file?.type || '').startsWith('image/')) return 'image'
  return 'video'
}

function candidateKey(item) {
  return String(item?.material_id || item?.id || item?.url || item?.path || item?.title || '')
}

function uniqueCandidates(list) {
  const seen = new Set()
  const out = []
  ;(Array.isArray(list) ? list : []).forEach(item => {
    const key = candidateKey(item)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(item)
  })
  return out
}

function sceneSelectedCandidates(scene) {
  if (!scene) return []
  const multi = uniqueCandidates(scene.selected_candidates)
  if (multi.length) return multi
  return scene.selected_candidate ? [scene.selected_candidate] : []
}

function primarySceneCandidate(scene) {
  return sceneSelectedCandidates(scene)[0] || null
}

function syncSceneSelection(scene, list) {
  const selected = uniqueCandidates(list)
  scene.selected_candidates = selected
  scene.selected_candidate = selected[0] || null
  scene.selected_material_id = selected.map(item => item.material_id || item.id).filter(Boolean).join(',')
}

function isSceneCandidateSelected(scene, item) {
  const key = candidateKey(item)
  return sceneSelectedCandidates(scene).some(candidate => candidateKey(candidate) === key)
}

function sceneSelectedTitle(scene) {
  const selected = sceneSelectedCandidates(scene)
  if (!selected.length) return ''
  if (selected.length === 1) return selected[0].title
  return `${selected.length} 条素材：${selected.slice(0, 2).map(item => item.title).join(' / ')}${selected.length > 2 ? '…' : ''}`
}

function handleVoiceFile(event) {
  const file = event.target.files?.[0]
  voiceoverFile.value = file || null
  voiceoverInfo.value = null
}

async function uploadSceneMaterial(file) {
  const scene = activeScene.value
  if (!scene || !file) return
  try {
    const base64 = await fileToBase64(file)
    const type = fileTypeFromFile(file)
    const data = await uploadAiEditMaterial({
      filename: file.name,
      original: file.name,
      size: file.size,
      file_base64: base64,
      folder: '/AI剪辑工作台/' + (projectName.value.trim() || '未命名项目'),
      type
    })
    const candidate = {
      id: 'material-' + data.id,
      material_id: data.id,
      source: 'material-library',
      platform: 'material',
      platform_label: type === 'image' ? '手动图片' : '手动视频',
      title: file.name,
      url: data.url || `/uploads/${type}/${encodeURIComponent(data.filename || file.name)}`,
      path: data.url || `/uploads/${type}/${encodeURIComponent(data.filename || file.name)}`,
      thumb: data.thumb || '',
      type,
      folder: '/AI剪辑工作台/' + (projectName.value.trim() || '未命名项目'),
      status: 'ready',
      match_reason: '人工拖入当前镜头，优先级最高。',
      next_step: '已选入时间线'
    }
    scene.candidates = uniqueCandidates([candidate].concat(scene.candidates || []))
    selectSceneCandidate(scene, candidate)
    showMessage(`已把 ${file.name} 放进镜头 ${scene.index}。`, 'success')
  } catch (e) {
    showMessage('上传镜头素材失败：' + e.message, 'error')
  }
}

function handleSceneFile(event) {
  const file = event.target.files?.[0]
  if (event.target) event.target.value = ''
  uploadSceneMaterial(file)
}

function handleSceneDrop(event) {
  draggingSceneFile.value = false
  const file = event.dataTransfer?.files?.[0]
  uploadSceneMaterial(file)
}

async function ensureProject() {
  if (projectId.value) return projectId.value
  const data = await createAiEditProject({
    name: projectName.value,
    script: scriptText.value,
    target_ratio: targetRatio.value,
    edit_style: editStyle.value
  })
  projectId.value = data.project_id || data.project?.id || ''
  return projectId.value
}

async function uploadVoiceoverIfNeeded(id) {
  if (!voiceoverFile.value || voiceoverInfo.value) return voiceoverInfo.value
  const base64 = await fileToBase64(voiceoverFile.value)
  const data = await uploadAiEditVoiceover({
    project_id: id,
    filename: voiceoverFile.value.name,
    size: voiceoverFile.value.size,
    file_base64: base64
  })
  voiceoverInfo.value = data.voiceover || null
  return voiceoverInfo.value
}

async function generateTimeline() {
  if (!canGenerate.value || planning.value) return
  planning.value = true
  exportResult.value = null
  renderResult.value = null
  downloadResults.value = []
  try {
    const id = await ensureProject()
    const voice = await uploadVoiceoverIfNeeded(id)
    const data = await planAiEditTimeline({
      project_id: id,
      script: scriptText.value,
      target_ratio: targetRatio.value,
      edit_style: editStyle.value,
      duration: voice?.duration || 0
    })
    scenes.value = data.scenes || []
    activeSceneId.value = scenes.value[0]?.id || ''
    plannerSource.value = data.planner || ''
    const sourceLabel = plannerLabel(plannerSource.value)
    const warning = data.warning ? `；提示：${data.warning}` : ''
    showMessage(`${sourceLabel}已生成 ${scenes.value.length} 段分镜时间线，接下来逐段匹配素材${warning}`, data.warning ? 'info' : 'success')
  } catch (e) {
    showMessage('生成时间线失败：' + e.message, 'error')
  } finally {
    planning.value = false
  }
}

function candidateScore(item) {
  if (!item) return -1
  let score = 0
  if (item.source === 'material-library' || item.platform === 'material') score += 100
  if (item.status === 'ready') score += 20
  if (item.type === 'video') score += 8
  if (item.type === 'image') score += 5
  if (item.thumb) score += 3
  score += Math.min(20, Number(item.score) / 10000 || 0)
  return score
}

function bestCandidate(scene) {
  const list = Array.isArray(scene?.candidates) ? scene.candidates : []
  return list.slice().sort((a, b) => candidateScore(b) - candidateScore(a))[0] || null
}

function bestCandidates(scene, limit = 2) {
  const list = Array.isArray(scene?.candidates) ? scene.candidates : []
  const sorted = list.slice().sort((a, b) => candidateScore(b) - candidateScore(a))
  const preferred = sorted.filter(item => item.source === 'material-library' || item.platform === 'material')
  const fallback = sorted.filter(item => !(item.source === 'material-library' || item.platform === 'material'))
  return uniqueCandidates(preferred.concat(fallback)).slice(0, limit)
}

function sceneTerms(scene) {
  return uniqueCandidates([])
    .concat(scene?.asset_type || '')
    .concat(scene?.asset_label || '')
    .concat(scene?.entities || [])
    .concat(scene?.intent_terms || [])
    .concat(scene?.search_queries || [])
    .concat(scene?.search_query || '')
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => item && item.length >= 2)
}

function candidateTerms(item) {
  return [
    item?.title,
    item?.folder,
    item?.match_reason,
    item?.platform_label,
    item?.source,
    item?.type
  ]
    .join(' ')
    .toLowerCase()
    .split(/[\s,，、|/]+/)
    .map(term => term.trim())
    .filter(term => term && term.length >= 2)
}

function reuseEntryKey(entry) {
  return candidateKey(entry?.candidate || entry)
}

function uniqueReuseEntries(list) {
  const seen = new Set()
  const out = []
  ;(Array.isArray(list) ? list : []).forEach(entry => {
    const key = reuseEntryKey(entry)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(entry)
  })
  return out
}

function assetReuseGroup(scene) {
  const type = scene?.asset_type || ''
  if (['ranking_screenshot', 'comment_meme'].includes(type)) return type
  if (['interview_clip', 'show_original', 'gameplay_clip', 'visual_proof', 'broll', 'hook_famous_scene'].includes(type)) return 'motion-proof'
  return type || scene?.asset_label || 'general'
}

function reuseScore(scene, entry) {
  const item = entry?.candidate || entry
  const sourceScene = entry?.scene || null
  if (!scene || !item) return -1
  if (sourceScene && assetReuseGroup(scene) !== assetReuseGroup(sourceScene)) return -1
  let score = candidateScore(item)
  const sameAssetType = Boolean(sourceScene && scene.asset_type && scene.asset_type === sourceScene.asset_type)
  const sameAssetLabel = Boolean(sourceScene && scene.asset_label && scene.asset_label === sourceScene.asset_label)
  if (sameAssetType) score += 45
  if (sameAssetLabel) score += 35
  const terms = sceneTerms(scene)
  const sourceTerms = sceneTerms(sourceScene)
  const haystack = candidateTerms(item).concat(sourceTerms).join(' ')
  const hits = terms.filter(term => haystack.includes(term) || String(item.title || '').toLowerCase().includes(term))
  if (!sameAssetType && !sameAssetLabel && !hits.length) return -1
  score += Math.min(60, hits.length * 16)
  if (item.platform === 'bilibili' || item.source === 'bilibili') score -= 12
  return score
}

function reusableCandidatesForScene(scene, reusePool) {
  const pool = uniqueReuseEntries(reusePool)
  return pool
    .map(entry => ({ item: entry.candidate || entry, score: reuseScore(scene, entry) }))
    .filter(entry => entry.score >= 118)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.item)
}

function autoCandidatesForScene(scene, reusePool, previousScene) {
  const reused = reusableCandidatesForScene(scene, reusePool).slice(0, 1)
  const reusedKeys = new Set(reused.map(candidateKey))
  const needsFresh = !reused.length || scene.asset_type !== previousScene?.asset_type
  const freshLimit = needsFresh ? 1 : 0
  const fresh = bestCandidates(scene, 2)
    .filter(item => !reusedKeys.has(candidateKey(item)))
    .slice(0, freshLimit)
  const chosen = uniqueCandidates(reused.concat(fresh))
  return chosen.length ? chosen : bestCandidates(scene, 1)
}

function autoSelectCandidates() {
  let selectedScenes = 0
  let selectedReferences = 0
  let reusedReferences = 0
  const reusePool = []
  let previousScene = null
  scenes.value.forEach(scene => {
    const existing = sceneSelectedCandidates(scene)
    if (existing.length) {
      reusePool.push(...existing.map(candidate => ({ candidate, scene })))
      previousScene = scene
      return
    }
    if (sceneSelectedCandidates(scene).length) return
    const items = autoCandidatesForScene(scene, reusePool, previousScene)
    if (!items.length) return
    const reusedKeys = new Set(uniqueReuseEntries(reusePool).map(reuseEntryKey))
    reusedReferences += items.filter(item => reusedKeys.has(candidateKey(item))).length
    selectSceneCandidates(scene, items, { silent: true })
    reusePool.push(...items.map(candidate => ({ candidate, scene })))
    selectedScenes += 1
    selectedReferences += items.length
    previousScene = scene
  })
  const freshReferences = Math.max(0, selectedReferences - reusedReferences)
  showMessage(selectedScenes ? `已自动为 ${selectedScenes} 个镜头建立素材引用：复用 ${reusedReferences} 次，新选 ${freshReferences} 次，仍可逐段增删。` : '没有可自动选入的候选素材。', selectedScenes ? 'success' : 'info')
  return selectedScenes
}

async function searchSceneMaterial(scene) {
  if (!scene || searchingIds.value.includes(scene.id)) return
  const id = await ensureProject()
  searchingIds.value = [...searchingIds.value, scene.id]
  scene.status = 'searching'
  scene.warning = ''
  try {
    const data = await searchAiEditScene({
      project_id: id,
      scene_id: scene.id,
      query: scene.search_query,
      queries: scene.search_queries,
      visual_need: scene.visual_need,
      script_text: scene.script_text || scene.script,
      entities: scene.entities,
      intent_terms: scene.intent_terms,
      limit: 6
    })
    scene.candidates = data.candidates || []
    scene.warning = data.warning || ''
    scene.status = scene.candidates.length ? 'ready' : 'empty'
    showMessage(`镜头 ${scene.index} 找到 ${scene.candidates.length} 条候选，素材库 ${data.material_count || 0} 条。`, scene.candidates.length ? 'success' : 'info')
  } catch (e) {
    scene.status = 'error'
    showMessage(`镜头 ${scene.index} 匹配素材失败：${e.message}`, 'error')
  } finally {
    searchingIds.value = searchingIds.value.filter(item => item !== scene.id)
  }
}

async function searchAllScenes() {
  if (!scenes.value.length || searchingAll.value) return
  searchingAll.value = true
  let found = 0
  try {
    for (const scene of scenes.value) {
      if (!scene.candidates?.length) await searchSceneMaterial(scene)
      if (scene.candidates?.length) found += 1
    }
    showMessage(`已完成全片素材匹配：${found}/${scenes.value.length} 个镜头有候选。`, found ? 'success' : 'info')
  } finally {
    searchingAll.value = false
  }
}

function selectSceneCandidate(scene, item, options = {}) {
  selectSceneCandidates(scene, [item], options)
}

function selectSceneCandidates(scene, items, options = {}) {
  syncSceneSelection(scene, items)
  const selected = sceneSelectedCandidates(scene)
  selected.forEach(item => {
    if (item.platform === 'bilibili' || item.source === 'bilibili') {
      const set = new Set(selectedIds.value)
      set.add(item.id)
      selectedIds.value = Array.from(set)
    }
  })
  if (!options.silent && selected.some(item => item.platform === 'bilibili' || item.source === 'bilibili')) {
    showMessage('已选中 B站候选，并加入下载入库队列。生成粗剪时会尝试下载，失败则需要人工补素材。', 'info')
  }
}

function toggleSceneCandidate(scene, item) {
  if (!scene || !item) return
  const selected = sceneSelectedCandidates(scene)
  const key = candidateKey(item)
  const wasSelected = isSceneCandidateSelected(scene, item)
  const next = wasSelected
    ? selected.filter(candidate => candidateKey(candidate) !== key)
    : selected.concat(item)
  syncSceneSelection(scene, next)
  if (item.platform === 'bilibili' || item.source === 'bilibili') {
    const set = new Set(selectedIds.value)
    if (wasSelected) set.delete(item.id)
    else set.add(item.id)
    selectedIds.value = Array.from(set)
  }
}

async function runSmartRoughCut() {
  if (!canGenerate.value || smartRunning.value) return
  smartRunning.value = true
  resetWorkflowSteps()
  exportResult.value = null
  renderResult.value = null
  downloadResults.value = []
  try {
    setWorkflowStep('plan', 'running', '正在拆分镜和时间点')
    await generateTimeline()
    if (!scenes.value.length) throw new Error('没有生成可用分镜')
    setWorkflowStep('plan', 'done', `已生成 ${scenes.value.length} 个镜头`)

    setWorkflowStep('match', 'running', '正在批量查素材库和 B站候选')
    await searchAllScenes()
    const scenesWithCandidates = scenes.value.filter(scene => scene.candidates?.length).length
    setWorkflowStep('match', scenesWithCandidates ? 'done' : 'error', `${scenesWithCandidates}/${scenes.value.length} 个镜头有候选`)

    setWorkflowStep('select', 'running', '正在按可用性自动选素材')
    const selected = autoSelectCandidates()
    setWorkflowStep('select', selectedSceneCount.value ? 'done' : 'error', `已选 ${selectedSceneCount.value}/${scenes.value.length} 个镜头`)

    setWorkflowStep('render', 'running', '正在生成粗剪 MP4 和 SRT')
    if (!selectedSceneCount.value) throw new Error('没有确认素材，无法生成粗剪')
    await renderRoughCut()
    setWorkflowStep('render', renderResult.value?.ok ? 'done' : 'done', renderResult.value ? `生成 ${renderResult.value.clip_count || 0} 段，跳过 ${renderResult.value.skipped_count || 0} 段` : '粗剪已提交')
  } catch (e) {
    const running = workflowSteps.value.find(step => step.status === 'running')
    if (running) setWorkflowStep(running.key, 'error', e.message)
    showMessage('智能剪辑中断：' + e.message, 'error')
  } finally {
    smartRunning.value = false
  }
}

function clearSceneCandidate(scene) {
  syncSceneSelection(scene, [])
}

function setActiveScene(scene) {
  activeSceneId.value = scene?.id || ''
}

function buildTimelinePayload() {
  return {
    project_id: projectId.value,
    scenes: scenes.value,
    timeline: {
      project_id: projectId.value,
      ratio: targetRatio.value,
      audio: voiceoverInfo.value || null,
      clips: scenes.value.map(scene => ({
        scene_id: scene.id,
        index: scene.index,
        start: scene.start,
        end: scene.end,
        duration: scene.duration,
        script_text: scene.script_text || scene.script,
        visual_need: scene.visual_need,
        material: primarySceneCandidate(scene) || null,
        materials: sceneSelectedCandidates(scene)
      }))
    }
  }
}

async function copyAssetBrief() {
  const lines = assetBrief.value.flatMap(group => {
    const children = scenes.value
      .filter(scene => (scene.asset_label || '待判断素材') === group.label)
      .map(scene => `- 镜头${scene.index} ${formatTime(scene.start)}-${formatTime(scene.end)}：${scene.visual_need || scene.script_text || ''}`)
    return [`【${group.label}】${group.ready}/${group.count}，建议来源：${group.sources}${group.manualTips ? '，人工确认：' + group.manualTips : ''}`].concat(children)
  })
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    showMessage('素材包清单已复制，可以发给剪辑或素材同学。', 'success')
  } catch (e) {
    showMessage('复制失败：' + e.message, 'error')
  }
}

async function saveTimeline() {
  if (!scenes.value.length || saving.value) return
  saving.value = true
  try {
    await saveAiEditTimeline(buildTimelinePayload())
    showMessage('时间线已保存，刷新后仍可从后端项目文件恢复。', 'success')
  } catch (e) {
    showMessage('保存失败：' + e.message, 'error')
  } finally {
    saving.value = false
  }
}

async function exportPrXml() {
  if (!scenes.value.length || exporting.value) return
  exporting.value = true
  try {
    const data = await exportAiEditPrXml(buildTimelinePayload())
    exportResult.value = data
    showMessage('已导出 PR XML 和 timeline JSON。', 'success')
  } catch (e) {
    showMessage('导出失败：' + e.message, 'error')
  } finally {
    exporting.value = false
  }
}

async function renderRoughCut() {
  if (!selectedSceneCount.value || rendering.value) return
  rendering.value = true
  renderResult.value = null
  try {
    const id = await ensureProject()
    const data = await renderAiEditRoughCut(Object.assign(buildTimelinePayload(), { project_id: id }))
    renderResult.value = data
    const skipped = data.skipped_count ? `，${data.skipped_count} 个镜头需要人工补素材` : ''
    showMessage(`粗剪 MP4 已生成，合成 ${data.clip_count || 0} 个镜头${skipped}。`, data.skipped_count ? 'info' : 'success')
  } catch (e) {
    showMessage('生成粗剪失败：' + e.message, 'error')
  } finally {
    rendering.value = false
  }
}

async function prepareLinks() {
  if (!canPrepareLinks.value || preparing.value) return
  preparing.value = true
  downloadResults.value = []
  try {
    const data = await prepareSmartCollect({
      project_name: projectName.value,
      type: materialType.value,
      links: linksText.value
    })
    candidates.value = data.candidates || []
    selectedIds.value = candidates.value.map(item => item.id)
    projectFolder.value = data.project?.folder || ''
    showMessage(`已整理 ${candidates.value.length} 条链接候选，可下载入库后再回到时间线选择。`, 'success')
  } catch (e) {
    showMessage('整理链接失败：' + e.message, 'error')
  } finally {
    preparing.value = false
  }
}

function toggle(id) {
  const set = new Set(selectedIds.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  selectedIds.value = Array.from(set)
}

async function downloadSelected() {
  const items = allCandidates.value.filter(item => selectedIds.value.includes(item.id))
  if (!items.length || downloading.value) return
  downloading.value = true
  downloadResults.value = []
  try {
    const data = await downloadSmartCollectSelected({
      project_name: projectName.value,
      type: materialType.value,
      folder: projectFolder.value,
      items
    })
    downloadResults.value = data.results || []
    showMessage(data.message || `已处理 ${items.length} 条候选。`, data.imported_count ? 'success' : 'info')
  } catch (e) {
    showMessage('下载入库失败：' + e.message, 'error')
  } finally {
    downloading.value = false
  }
}

function formatTime(value) {
  const total = Math.max(0, Math.round(Number(value) || 0))
  const min = Math.floor(total / 60)
  const sec = total % 60
  return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
}

function plannerLabel(value) {
  return {
    siliconflow: '硅基流动规划：',
    'model-gateway': '模型网关规划：',
    'local-voiceover-duration': '本地规则规划：',
    'local-script-length': '本地规则规划：'
  }[value] || ''
}

function openMaterialFolder() {
  window.dispatchEvent(new CustomEvent('usagi:navigate', { detail: { module: 'material' } }))
}
</script>

<style scoped>
.ai-edit-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.edit-header {
  position: relative;
  display: grid;
  grid-template-columns: minmax(320px, 1fr) auto minmax(260px, 420px);
  align-items: center;
  gap: 18px;
  overflow: hidden;
  padding: 18px;
}

.edit-header::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 72% 20%, rgba(56, 189, 248, 0.12), transparent 30%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.02), rgba(124, 58, 237, 0.07));
}

.edit-header > * {
  position: relative;
  z-index: 1;
}

.edit-header .module-page-copy p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.module-page-icon {
  font-size: 18px;
  font-weight: 900;
}

.edit-hero-ui {
  min-width: 0;
  height: 132px;
  border: 1px solid rgba(56, 189, 248, 0.22);
  border-radius: 16px;
  padding: 12px;
  display: grid;
  grid-template-rows: 12px 1fr 30px 14px;
  gap: 9px;
  overflow: hidden;
  background:
    radial-gradient(circle at 78% 18%, rgba(56, 189, 248, 0.18), transparent 34%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.96));
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.32);
}

.hero-ui-top,
.hero-ui-scenes,
.hero-ui-timeline {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.hero-ui-top span {
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.24);
}

.hero-ui-top span:nth-child(1) { width: 34%; }
.hero-ui-top span:nth-child(2) { width: 18%; }
.hero-ui-top span:nth-child(3) { width: 26%; margin-left: auto; background: rgba(34, 211, 238, 0.32); }

.hero-ui-wave {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 8px;
  border-radius: 12px;
  border: 1px solid rgba(99, 102, 241, 0.32);
  background: rgba(30, 41, 59, 0.55);
}

.hero-ui-wave i {
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, #67e8f9, #8b5cf6);
}

.hero-ui-scenes span {
  flex: 1;
  border-radius: 9px;
  border: 1px solid rgba(56, 189, 248, 0.34);
  background:
    linear-gradient(135deg, rgba(34, 211, 238, 0.2), transparent),
    rgba(15, 23, 42, 0.82);
}

.hero-ui-scenes span:nth-child(2) { border-color: rgba(139, 92, 246, 0.48); }
.hero-ui-scenes span:nth-child(4) { border-color: rgba(245, 158, 11, 0.5); }

.hero-ui-timeline span {
  height: 8px;
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.36);
}

.hero-ui-timeline span:nth-child(1) { flex: 1.4; }
.hero-ui-timeline span:nth-child(2) { flex: 0.9; background: rgba(139, 92, 246, 0.42); }
.hero-ui-timeline span:nth-child(3) { flex: 1.1; background: rgba(245, 158, 11, 0.45); }

.edit-layout {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(320px, 390px) minmax(0, 1fr);
  gap: 14px;
}

.input-rail,
.timeline-workbench,
.scene-row,
.rail-card,
.export-card,
.download-report {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}

.input-rail {
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: grid;
  gap: 12px;
  align-content: start;
}

.rail-card {
  padding: 15px;
  background:
    linear-gradient(135deg, rgba(255, 214, 102, 0.11), rgba(0, 122, 255, 0.05)),
    var(--surface2);
}

.assist-card {
  background:
    linear-gradient(135deg, rgba(0, 245, 212, 0.08), rgba(255, 255, 255, 0.02)),
    var(--surface2);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.card-head.compact {
  margin-bottom: 10px;
}

.card-head strong {
  display: block;
  color: var(--text);
}

.card-head small {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
}

.step-dot {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--primary);
  color: #fff;
  font-weight: 900;
}

.step-dot.soft {
  background: var(--accent-soft);
  color: var(--accent);
}

.input-group {
  display: grid;
  gap: 7px;
  margin-bottom: 12px;
  color: var(--text-dim);
  font-size: 12px;
}

.two-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.script-box {
  min-height: 230px;
  resize: vertical;
}

.link-box {
  resize: vertical;
}

.voice-drop {
  position: relative;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px 10px;
  align-items: center;
  padding: 12px;
  border-radius: 14px;
  border: 1px dashed var(--border);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
}

.voice-drop.ready {
  border-style: solid;
  border-color: rgba(34, 197, 94, 0.45);
}

.voice-drop input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.voice-icon {
  grid-row: span 2;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: var(--primary-gradient);
  color: #fff;
  font-weight: 900;
}

.voice-drop strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.voice-drop small,
.hint {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.run-btn {
  width: 100%;
  margin-top: 10px;
}

.assist-actions,
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mini-candidates {
  display: grid;
  gap: 7px;
  margin-top: 10px;
  max-height: 180px;
  overflow: auto;
}

.mini-candidate {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--text-dim);
  font-size: 12px;
}

.mini-candidate span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ability-note {
  display: grid;
  gap: 4px;
  margin: 10px 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.ability-note strong {
  color: var(--text);
  font-size: 12px;
}

.timeline-workbench {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 15px;
}

.workbench-toolbar {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 12px;
  background: var(--surface);
}

.workbench-toolbar strong {
  display: block;
  color: var(--text);
  font-size: 18px;
}

.workbench-toolbar span {
  color: var(--text-muted);
  font-size: 12px;
}

.collect-message {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface2);
  color: var(--text-dim);
  font-size: 13px;
}

.collect-message.success {
  color: #22c55e;
}

.collect-message.error {
  color: #f97373;
}

.capability-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.capability-strip span {
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--surface2);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.capability-strip .ok {
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
}

.capability-strip .pending {
  background: rgba(245, 158, 11, 0.11);
  color: #f59e0b;
}

.workflow-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.workflow-step {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 3px 8px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface2);
}

.workflow-step > span {
  grid-row: span 2;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-weight: 900;
}

.workflow-step strong {
  min-width: 0;
  color: var(--text);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-step small {
  min-width: 0;
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-step.running {
  border-color: rgba(59, 130, 246, 0.45);
  background: rgba(59, 130, 246, 0.08);
}

.workflow-step.running > span {
  color: #93c5fd;
}

.workflow-step.done {
  border-color: rgba(34, 197, 94, 0.45);
  background: rgba(34, 197, 94, 0.08);
}

.workflow-step.done > span {
  color: #86efac;
}

.workflow-step.error {
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(248, 113, 113, 0.08);
}

.workflow-step.error > span {
  color: #fca5a5;
}

.empty-state {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 330px;
  text-align: center;
  color: var(--text-dim);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.02);
}

.empty-state p {
  max-width: 560px;
  margin: 0 auto;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.empty-mark {
  width: 88px;
  height: 88px;
  display: grid;
  place-items: center;
  border-radius: 28px;
  background: var(--primary-gradient);
  color: #fff;
  font-weight: 900;
  box-shadow: 0 18px 40px var(--primary-shadow);
}

.studio-stage {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(280px, 360px);
  gap: 12px;
  min-height: 430px;
}

.preview-panel,
.scene-inspector,
.filmstrip-panel,
.track-board {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface2);
}

.preview-panel {
  min-width: 0;
  display: grid;
  grid-template-rows: minmax(260px, 1fr) auto;
  overflow: hidden;
}

.preview-screen {
  min-height: 300px;
  display: grid;
  place-items: center;
  padding: 20px;
  background:
    radial-gradient(circle at 22% 18%, rgba(255, 214, 102, 0.18), transparent 26%),
    radial-gradient(circle at 78% 22%, rgba(0, 245, 212, 0.14), transparent 28%),
    linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.96));
}

.preview-safe {
  position: relative;
  display: grid;
  align-content: end;
  gap: 8px;
  width: min(100%, 260px);
  min-height: 360px;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background:
    linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.24) 48%, rgba(0, 0, 0, 0.68) 100%),
    rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04), 0 24px 70px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}

.preview-safe.has-material {
  background:
    linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.26) 42%, rgba(0, 0, 0, 0.78) 100%),
    rgba(0, 0, 0, 0.2);
}

.preview-media-thumb {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-safe .source-badge,
.preview-safe strong,
.preview-safe p {
  position: relative;
  z-index: 1;
}

.ratio-wide .preview-safe {
  width: min(100%, 520px);
  min-height: 292px;
}

.ratio-square .preview-safe {
  width: min(100%, 360px);
  min-height: 360px;
}

.preview-safe strong {
  color: #fff;
  font-size: 24px;
}

.preview-safe p {
  margin: 0;
  color: rgba(255, 255, 255, 0.78);
  line-height: 1.65;
  font-size: 13px;
}

.preview-footer {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-top: 1px solid var(--border);
}

.preview-footer div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.preview-footer strong,
.inspector-head strong {
  color: var(--text);
}

.preview-footer span,
.inspector-head span {
  color: var(--text-muted);
  font-size: 12px;
}

.preview-footer p {
  margin: 0;
  color: var(--text-dim);
  line-height: 1.65;
  font-size: 13px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  -webkit-line-clamp: 3;
}

.scene-inspector {
  min-width: 0;
  padding: 14px;
  overflow: auto;
}

.inspector-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.inspector-head span {
  display: block;
  margin-bottom: 3px;
}

.micro-area {
  min-height: 64px;
  resize: vertical;
}

.scene-drop {
  position: relative;
  display: grid;
  gap: 4px;
  margin: 2px 0 10px;
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-dim);
  cursor: pointer;
}

.scene-drop.over,
.scene-drop:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.scene-drop input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.scene-drop strong {
  color: var(--text);
  font-size: 13px;
}

.scene-drop small {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.scene-warning {
  margin-top: 8px;
  color: #f59e0b;
  font-size: 12px;
}

.candidate-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.candidate-strip.compact {
  grid-template-columns: 1fr;
  max-height: 255px;
  overflow: auto;
  padding-right: 3px;
}

.candidate-empty {
  display: grid;
  place-items: center;
  min-height: 94px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  color: var(--text-muted);
  font-size: 13px;
}

.asset-plan {
  display: grid;
  gap: 8px;
  margin: 10px 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
}

.asset-plan div:first-child {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.asset-plan span,
.asset-plan p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.asset-plan strong {
  color: var(--text);
  font-size: 13px;
}

.query-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.query-chip {
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
}

.material-chip {
  min-width: 0;
  text-align: left;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text-dim);
  cursor: pointer;
}

.material-chip.active {
  border-color: rgba(34, 197, 94, 0.55);
  background: rgba(34, 197, 94, 0.09);
}

.source-badge {
  display: inline-flex;
  margin-bottom: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 800;
}

.material-chip strong,
.material-chip small {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.material-chip strong {
  color: var(--text);
  line-height: 1.35;
  -webkit-line-clamp: 2;
}

.material-chip small {
  margin-top: 5px;
  color: var(--text-muted);
  line-height: 1.45;
  -webkit-line-clamp: 2;
}

.selected-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(34, 197, 94, 0.08);
  color: var(--text-dim);
  font-size: 12px;
}

.selected-line.empty {
  background: rgba(245, 158, 11, 0.08);
}

.selected-materials {
  display: grid;
  gap: 7px;
  margin: 8px 0 10px;
}

.selected-material-chip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid rgba(34, 197, 94, 0.4);
  border-radius: 10px;
  background: rgba(34, 197, 94, 0.07);
  color: var(--text-dim);
  text-align: left;
  cursor: pointer;
}

.selected-material-chip span {
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
  font-size: 11px;
  font-weight: 800;
}

.selected-material-chip strong {
  min-width: 0;
  color: var(--text);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-btn {
  border: 0;
  background: transparent;
  color: var(--primary-light);
  cursor: pointer;
}

.material-brief {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface2);
}

.brief-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.brief-head strong {
  display: block;
  color: var(--text);
}

.brief-head span {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
}

.brief-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
}

.brief-card {
  min-width: 0;
  display: grid;
  gap: 5px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text-dim);
  text-align: left;
  cursor: pointer;
}

.brief-card:hover {
  border-color: var(--primary);
}

.brief-card span {
  color: var(--text-muted);
  font-size: 12px;
}

.brief-card strong {
  color: var(--text);
  font-size: 20px;
}

.brief-card small {
  color: var(--text-muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  -webkit-line-clamp: 2;
}

.filmstrip-panel {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  padding: 10px;
  overflow-x: auto;
}

.shot-card {
  flex: 0 0 168px;
  min-height: 116px;
  display: grid;
  align-content: space-between;
  gap: 7px;
  padding: 11px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  text-align: left;
  cursor: pointer;
}

.shot-card.active {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft);
}

.shot-card.ready {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.09), var(--surface));
}

.shot-card span {
  width: 30px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 900;
}

.shot-card em {
  width: fit-content;
  max-width: 100%;
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(255, 214, 102, 0.12);
  color: #f59e0b;
  font-style: normal;
  font-size: 11px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shot-card strong {
  color: var(--text);
  line-height: 1.35;
  font-size: 13px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  -webkit-line-clamp: 2;
}

.shot-card small {
  color: var(--text-muted);
}

.track-board {
  display: grid;
  gap: 9px;
  margin-top: 12px;
  padding: 12px;
}

.track-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.track-label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.track-clips {
  min-width: 0;
  display: flex;
  gap: 4px;
  padding: 7px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.track-clip {
  min-width: 64px;
  min-height: 38px;
  display: grid;
  place-items: center;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: rgba(0, 122, 255, 0.18);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.track-clip.video {
  cursor: pointer;
}

.track-clip.video.empty {
  background: rgba(245, 158, 11, 0.12);
  color: var(--text-muted);
}

.track-clip.active {
  border-color: var(--primary);
  color: var(--text);
}

.track-clip.audio {
  justify-content: start;
  width: 100%;
  background: rgba(34, 197, 94, 0.14);
}

.export-card {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
  color: var(--text-dim);
}

.export-card a {
  color: var(--primary-light);
  font-weight: 800;
}

.render-card {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
}

.render-card video {
  grid-column: 1 / -1;
  width: min(100%, 460px);
  max-height: 360px;
  border-radius: 12px;
  background: #000;
}

.download-report {
  margin-top: 12px;
  padding: 12px;
}

.download-report h3 {
  margin: 0 0 10px;
  color: var(--text);
}

.download-row {
  padding: 10px;
  border-radius: 10px;
  background: var(--surface2);
  margin-top: 8px;
}

.download-row strong,
.download-row span {
  color: var(--text);
}

.download-row p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

@media (max-width: 980px) {
  .edit-header {
    grid-template-columns: 1fr;
  }

  .edit-hero-ui {
    height: 150px;
  }

  .edit-layout {
    grid-template-columns: 1fr;
  }

  .studio-stage {
    grid-template-columns: 1fr;
  }

  .track-row {
    grid-template-columns: 1fr;
  }
}
</style>
