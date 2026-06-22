<template>
  <div class="imagegen-module">
    <div class="module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">🎨</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">IMAGE STUDIO</div>
          <h2>AI生图</h2>
        </div>
      </div>
    </div>

    <!-- 主体：左侧输入 + 右侧展示 -->
    <div class="ig-layout">

      <!-- ========== 左侧输入区 ========== -->
      <div class="ig-left">
        <!-- 模式切换 -->
        <div class="mode-tabs">
          <button :class="{ active: mode !== 'history' }" @click="mode = 't2i'">🌄 生图</button>
          <button :class="{ active: mode === 'history' }" @click="switchToHistory">📜 历史</button>
        </div>

        <!-- 历史记录列表 -->
        <div v-if="mode === 'history'" class="history-list">
          <div v-if="historyLoading" class="history-loading">加载中...</div>
          <div v-else-if="!historyList.length" class="history-empty">暂无历史记录</div>
          <div v-else class="history-items">
            <div
              v-for="item in historyList"
              :key="item.id"
              class="history-item"
              :class="{ active: selectedHistory?.id === item.id }"
              @click="selectHistoryItem(item)">
              <div class="history-thumb">
                <img
                  :src="normalizeImageUrl(item.result_url)"
                  loading="lazy"
                  decoding="async"
                  draggable="true"
                  title="拖到参考图"
                  @dragstart="handleImageDragStart($event, normalizeImageUrl(item.result_url))"
                  @error="(e) => e.target.style.display='none'" />
              </div>
              <div class="history-info">
                <div class="history-prompt">{{ item.prompt }}</div>
                <div class="history-meta">
                  <span class="history-model">{{ item.model }}</span>
                  <span class="history-time">{{ formatTime(item.created_at) }}</span>
                </div>
              </div>
              <button class="history-del" @click.stop="delHistory(item.id)" title="删除">🗑</button>
            </div>
          </div>
          <div v-if="historyTotal > historyList.length" class="history-more">
            <button class="btn btn-ghost btn-sm" @click="loadMoreHistory">加载更多</button>
          </div>
        </div>

        <!-- 参考图上传区 -->
        <div
          v-if="mode !== 'history'"
          class="upload-zone"
          :class="{ 'drag-active': i2iDragActive }"
          @dragenter.prevent="i2iDragActive = true"
          @dragover.prevent="i2iDragActive = true"
          @dragleave.prevent="i2iDragActive = false"
          @drop.prevent="handleI2IDrop">
          <input ref="i2iFileInput" type="file" accept="image/*" multiple style="display:none" @change="handleI2IUpload" />
          <div class="reference-toolbar">
            <div>
              <div class="reference-title">参考图</div>
              <div class="reference-sub">GPT-Image2 最多 8 张；MiniMax / 即梦仅使用第 1 张</div>
            </div>
            <div class="reference-actions">
              <button class="btn btn-ghost btn-sm" type="button" @click.stop="i2iFileInput?.click()">添加</button>
              <button v-if="i2iFiles.length" class="btn btn-ghost btn-sm" type="button" @click.stop="clearI2IReferences">清空</button>
            </div>
          </div>
          <div v-if="!i2iFiles.length" class="upload-hint" @click="i2iFileInput?.click()">
            <span class="upload-icon">📷</span>
            <span>点击上传 / 拖拽参考图或历史结果</span>
          </div>
          <div v-else class="reference-grid">
            <div
              v-for="(file, index) in i2iFiles"
              :key="file.__i2iId || `${file.name}-${file.size}-${file.lastModified}-${index}`"
              class="reference-card"
              :class="{ primary: index === 0 }">
              <button class="reference-remove" type="button" title="移除" @click.stop="removeI2IReference(index)">×</button>
              <img :src="i2iPreviews[index]" class="reference-img" alt="参考图" @click.stop="previewUrl = i2iPreviews[index]" />
              <div class="reference-meta">
                <span>{{ index + 1 }}</span>
                <strong v-if="index === 0">主参考</strong>
                <strong v-else>参考</strong>
              </div>
            </div>
            <button
              v-if="i2iFiles.length < 8"
              class="reference-add-card"
              type="button"
              @click.stop="i2iFileInput?.click()">
              <span>+</span>
              <em>添加</em>
            </button>
          </div>
        </div>

        <!-- Prompt -->
        <textarea
          v-model="prompt"
          class="inp"
          rows="5"
          :placeholder="hasI2IReferences ? '描述你想要的画面变化，如：在参考图基础上加入霓虹灯光效果' : '描述你想要的画面，如：一只赛博朋克风格的机械兔子在未来城市中奔跑，超写实，8K'"
          @keydown.enter.exact="handleGenerate"
        />

        <div v-if="model === 'gpt-image2'" class="prompt-queue">
          <div class="prompt-queue-head">
            <span>提示词队列：输入后点生成会自动加入</span>
            <div class="prompt-queue-actions">
              <button v-if="promptJobs.length" class="btn btn-ghost btn-sm" type="button" @click="clearPromptJobs">清空</button>
            </div>
          </div>
          <div v-if="promptJobs.length" class="prompt-job-list">
            <div v-for="(job, index) in promptJobs" :key="job.id" class="prompt-job">
              <span>{{ index + 1 }}</span>
              <p>{{ job.prompt }}</p>
              <em>{{ promptJobStatusLabel(job) }}</em>
              <button type="button" title="移除" :disabled="job.status === 'running'" @click="removePromptJob(job.id)">×</button>
            </div>
          </div>
        </div>

        <!-- 型号 -->
        <div class="param-section">
          <div class="param-label">型号</div>
          <div class="param-row">
            <button
              v-for="m in MODEL_OPTIONS"
              :key="m.value"
              class="btn-option"
              :class="{ active: model === m.value }"
              @click="handleModelChange(m.value)">
              {{ m.label }}
            </button>
          </div>
          <div class="model-hint">
            <span v-if="model === 'dreamina'">即梦暂未开通，当前不可用</span>
            <span v-else-if="model === 'minimax'">MiniMax 生成速度较快，成片质量一般</span>
            <span v-else-if="model === 'gpt-image2'">GPT-Image2 质量较高，生成等待时间较长</span>
          </div>
        </div>

        <!-- GPT-Image2 线路 -->
        <div v-if="model === 'gpt-image2'" class="param-section">
          <div class="param-label">线路</div>
          <div class="param-row route-row">
            <button
              v-for="route in GPT_IMAGE_ROUTES"
              :key="route.value"
              class="btn-option route-option"
              :class="{ active: gptImageRoute === route.value }"
              :title="route.hint"
              @click="gptImageRoute = route.value">
              {{ route.label }}
            </button>
          </div>
          <div class="model-hint">{{ activeGptImageRoute.hint }}</div>
        </div>

        <!-- 比例 -->
        <div class="param-section">
          <div class="param-label">比例</div>
          <div class="param-row">
            <button
              v-for="r in RATIO_OPTIONS"
              :key="r"
              class="btn-option"
              :class="{ active: ratio === r }"
              @click="ratio = r">
              {{ r }}
            </button>
          </div>
        </div>

        <!-- 分辨率 -->
        <div class="param-section">
          <div class="param-label">分辨率</div>
          <div class="param-row">
            <button
              v-for="r in resolutionOptions"
              :key="r.value"
              class="btn-option"
              :class="{ active: resVal === r.value }"
              :disabled="r.disabled"
              :title="r.hint || ''"
              @click="!r.disabled && (resVal = r.value)">
              {{ r.value }}
            </button>
          </div>
          <div v-if="resolutionHint" class="model-hint">{{ resolutionHint }}</div>
        </div>

        <!-- 张数 -->
        <div class="param-section">
          <div class="param-label">张数</div>
          <div class="param-row">
            <button
              v-for="n in [1,2,3,4]"
              :key="n"
              class="btn-option"
              :class="{ active: count === n }"
              @click="count = n">
              {{ n }}张
            </button>
          </div>
        </div>

        <!-- 生成按钮 -->
        <button
          class="btn btn-primary"
          @click="handleGenerate">
          {{ loading && model === 'gpt-image2' ? '🎨 继续生成' : (loading ? `🎨 生成中${progress > 0 ? ` (${progress})` : ''}` : '🎨 开始生成') }}
        </button>
      </div>

      <!-- ========== 右侧展示区 ========== -->
      <div class="ig-right">
        <div v-if="mode === 'history' && selectedHistory" class="history-viewer">
          <div class="history-viewer-img" @click="previewUrl = normalizeImageUrl(selectedHistory.result_url)">
            <img
              :src="normalizeImageUrl(selectedHistory.result_url)"
              alt="历史图片"
              loading="lazy"
              decoding="async"
              draggable="true"
              title="拖到参考图"
              @dragstart="handleImageDragStart($event, normalizeImageUrl(selectedHistory.result_url))" />
          </div>
          <div class="history-viewer-info">
            <div class="history-viewer-meta">
              <span>{{ selectedHistory.model }}</span>
              <span>{{ selectedHistory.ratio || '默认比例' }}</span>
              <span>{{ selectedHistory.resolution || '默认清晰度' }}</span>
              <span>{{ formatTime(selectedHistory.created_at) }}</span>
            </div>
            <p>{{ selectedHistory.prompt }}</p>
            <div class="history-viewer-actions">
              <button class="btn btn-primary btn-sm" @click="handleSaveImg(normalizeImageUrl(selectedHistory.result_url))">下载图片</button>
              <button class="btn btn-ghost btn-sm" @click="handleCopy(normalizeImageUrl(selectedHistory.result_url))">复制链接</button>
              <button class="btn btn-ghost btn-sm" @click="reuseHistoryItem(selectedHistory)">复用参数</button>
              <button class="btn btn-ghost btn-sm" @click="useUrlAsI2IReference(normalizeImageUrl(selectedHistory.result_url), '历史图片')">用作参考图</button>
            </div>
          </div>
        </div>

        <div v-else-if="mode === 'history'" class="result-placeholder">
          <div class="placeholder-inner">
            <span class="placeholder-icon">📜</span>
            <span class="placeholder-text">选择一条历史记录查看原图</span>
            <span class="placeholder-hint">右侧会显示大图、下载和复制入口。</span>
          </div>
        </div>
        <!-- 无结果占位 -->
        <div v-else-if="model === 'gpt-image2' && !promptJobs.length && !loading" class="result-placeholder">
          <div class="placeholder-inner">
            <span class="placeholder-icon">🎨</span>
            <span class="placeholder-text">每条提示词会生成一张卡片</span>
            <span class="placeholder-hint">输入提示词后点击生成，可连续添加多条并发生成。</span>
          </div>
        </div>
        <div v-else-if="model !== 'gpt-image2' && !results.length && !loading" class="result-placeholder">
          <div class="placeholder-inner">
            <span class="placeholder-icon">🎨</span>
            <span class="placeholder-text">生成结果将在此展示</span>
            <span class="placeholder-hint">按 Enter 或点击上方按钮开始生成</span>
          </div>
        </div>

        <!-- 加载中模糊动画 -->
        <div v-if="mode !== 'history' && model !== 'gpt-image2' && loading" class="blur-bg">
          <div class="blur-inner"></div>
          <span class="blur-text">🎨 生成中{{ progress > 0 ? ` (${progress}/${count})` : '...' }}</span>
        </div>

        <div v-if="mode !== 'history' && model === 'gpt-image2' && promptJobs.length" class="result-grid gpt-result-grid">
          <div
            v-for="job in promptJobs"
            :key="job.id"
            class="result-cell prompt-result-cell"
            :class="{ pending: job.status === 'queued' || job.status === 'running', failed: job.status === 'error', dragging: draggingResultUrl === job.url }"
            @click="job.url && (previewUrl = job.url)"
            @contextmenu.prevent="job.url && showCtxMenu($event, job.url)">
            <div
              class="prompt-result-frame"
              :draggable="!!job.url"
              :title="job.url ? '拖到参考图区域' : ''"
              @dragstart.stop="job.url && handleImageDragStart($event, job.url)"
              @dragend.stop="handleImageDragEnd">
              <div v-if="job.status === 'running'" class="prompt-result-loading">
                <div class="prompt-result-sheen"></div>
                <div class="prompt-result-orbit" aria-hidden="true">
                  <i></i><i></i><i></i>
                </div>
              </div>
              <img
                v-if="job.url"
                :src="job.url"
                class="prompt-result-img"
                :class="{ revealed: job.revealed }"
                alt="生成结果"
                draggable="true"
                title="拖到参考图区域"
                @dragstart.stop="handleImageDragStart($event, job.url)"
                @dragend.stop="handleImageDragEnd" />
              <div v-if="!job.url && job.status !== 'running'" class="prompt-result-state">
                <span>{{ promptJobStatusLabel(job) }}</span>
                <p>{{ job.error || job.prompt }}</p>
              </div>
              <div v-if="job.status !== 'running'" class="prompt-result-caption">{{ job.prompt }}</div>
            </div>
          </div>
        </div>

        <!-- 结果网格 -->
        <div v-if="mode !== 'history' && model !== 'gpt-image2' && results.length" class="result-grid" :class="{ revealed: !loading }">
          <div
            v-for="(url, i) in results"
            :key="i"
            class="result-cell"
            @click="previewUrl = url"
            @contextmenu.prevent="showCtxMenu($event, url)">
            <img
              :src="url"
              class="result-img"
              :class="{ revealed: !loading }"
              alt="生成结果"
              draggable="true"
              title="拖到参考图"
              @dragstart.stop="handleImageDragStart($event, url)" />
          </div>
        </div>
      </div>
    </div>

    <!-- 余额查询 (保持不变) -->
    <div class="egg-row">
      <div class="egg-card">
        <div class="egg-card-left">
          <span class="egg-icon">💰</span>
          <div>
            <div class="egg-title">查询额度</div>
            <div class="egg-desc">各模型剩余额度</div>
          </div>
        </div>
        <div class="egg-card-right">
          <div class="egg-models">
            <div class="egg-model-row">
              <span>即梦 Dreamina</span>
              <span :class="{ loading: eggLoading }">{{ eggModels[0].credit }}</span>
            </div>
            <div class="egg-model-row">
              <span>MiniMax</span>
              <span :class="{ loading: eggLoading }">{{ eggModels[1].credit }}</span>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" :disabled="eggLoading" @click="handleEggCheck">
            {{ eggLoading ? '查询中...' : '🔍 查询' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 图片预览弹窗 -->
    <div v-if="previewUrl" class="img-preview-modal" @click.self="previewUrl = ''">
      <button class="preview-close" @click="previewUrl = ''">✕</button>
      <img :src="previewUrl" class="preview-full-img" alt="预览" />
    </div>

    <!-- 右键菜单 -->
    <div v-if="ctxMenu.show" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
      <div class="ctx-item" @click="handleCopy(ctxMenu.url); ctxMenu.show = false">📋 复制链接</div>
      <div class="ctx-item" @click="handleSaveImg(ctxMenu.url); ctxMenu.show = false">💾 保存图片</div>
    </div>

    <!-- 彩蛋弹窗 -->
    <div v-if="showEggJoke" class="egg-modal" @click.self="showEggJoke = false">
      <div class="egg-modal-box">
        <div class="egg-modal-hdr">😂 彩蛋</div>
        <div class="egg-modal-body">
          你们搞大模型的就是码神，你们已经解放平面兄弟了，还要解放文案兄弟，拍摄兄弟，剪辑兄弟，解放投流兄弟，解放产品兄弟，最后解放自己解放全人类。
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:16px" @click="showEggJoke = false">了解了</button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  createGptImageTask,
  editDreaminaImage,
  editGptImage,
  generateDreaminaImage,
  generateGptImage,
  generateMiniMaxImage,
  getGptImageTaskStatus,
  listGptImageTasks,
  normalizeImageUrl,
  getImagegenHistory,
  deleteImagegenHistory
} from '../api/imagegen'
import { useToast } from '../composables/useToast'
import { RATIO_OPTIONS, RESOLUTION_OPTIONS, T2I_MODEL_OPTIONS } from './imagegen/constants'
import { compressImageFile, readFileAsDataUrl, stripDataUrl } from './imagegen/fileUtils'

const { showToast } = useToast()

// ============ 合并后的状态 ============
const mode = ref('t2i')       // 't2i' | 'history'
const prompt = ref('')
const model = ref('gpt-image2')
const gptImageRoute = ref('primary')
const ratio = ref('16:9')
const resVal = ref('2K')
const count = ref(1)
const loading = ref(false)
const results = ref([])
const progress = ref(0)
const promptJobs = ref([])
const i2iFile = ref(null)
const i2iFiles = ref([])
const i2iPreview = ref('')
const i2iPreviews = ref([])
const i2iFileInput = ref(null)
const i2iDragActive = ref(false)
const draggingResultUrl = ref('')
const imageFileCache = new Map()
const gptJobControllers = new Map()
const GPT_MAX_CONCURRENT = 1
const GPT_TASK_POLL_MS = 2500
let gptQueueRunning = false
let activeGptWorkers = 0
let gptTaskPollTimer = null

const MODEL_OPTIONS = T2I_MODEL_OPTIONS
const RES_OPTIONS = RESOLUTION_OPTIONS
const hasI2IReferences = computed(() => Boolean(i2iFiles.value.length || i2iFile.value))
const GPT_IMAGE_SIZE_TABLE = {
  '1K': ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'],
  '2K': ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'],
  '4K': ['16:9', '9:16', '3:2', '2:3', '4:3', '3:4']
}
const resolutionOptions = computed(() => {
  if (model.value === 'minimax') {
    return [{ value: '2K', disabled: false, hint: 'MiniMax 当前接口固定清晰度' }]
  }
  if (model.value === 'gpt-image2' && hasI2IReferences.value) {
    return [{ value: '2K', disabled: false, hint: '参考图生成当前固定使用 2K' }]
  }
  if (model.value === 'gpt-image2' && !Object.values(GPT_IMAGE_SIZE_TABLE).some(ratios => ratios.includes(ratio.value))) {
    return [{ value: '2K', disabled: false, hint: `${ratio.value} 暂未配置 GPT-Image2 尺寸映射` }]
  }
  return RES_OPTIONS.map(value => {
    const supportedRatios = GPT_IMAGE_SIZE_TABLE[value] || []
    const disabled = model.value === 'gpt-image2' && !supportedRatios.includes(ratio.value)
    return {
      value,
      disabled,
      hint: disabled ? `${value} 不支持 ${ratio.value}，会自动使用 2K` : ''
    }
  })
})
const resolutionHint = computed(() => {
  if (model.value === 'minimax') return 'MiniMax 当前不接收分辨率参数，按接口默认清晰度生成。'
  if (model.value === 'gpt-image2' && hasI2IReferences.value) return '上传参考图后，GPT-Image2 编辑模式后端固定使用 2K。'
  if (model.value === 'gpt-image2' && !Object.values(GPT_IMAGE_SIZE_TABLE).some(ratios => ratios.includes(ratio.value))) return `${ratio.value} 暂未配置 GPT-Image2 尺寸映射，建议先切到 16:9、9:16、3:2、2:3、4:3、3:4 或 1:1。`
  if (model.value === 'gpt-image2' && ratio.value === '1:1') return 'GPT-Image2 当前没有 4K 的 1:1 映射，正方图可选 1K 或 2K。'
  return ''
})
const GPT_IMAGE_ROUTES = [
  { label: '主线路', value: 'primary', hint: '安频线路，默认使用' },
  { label: '原线路', value: 'fallback', hint: '原 Image2 线路，主线路不可用时手动切换' }
]
const activeGptImageRoute = computed(() => GPT_IMAGE_ROUTES.find(route => route.value === gptImageRoute.value) || GPT_IMAGE_ROUTES[0])

function handleModelChange(val) {
  model.value = val
  resVal.value = '2K'
}

function normalizeResolutionSelection() {
  const options = resolutionOptions.value || []
  const current = options.find(item => item.value === resVal.value)
  if (!current || current.disabled) {
    resVal.value = options.find(item => !item.disabled)?.value || '2K'
  }
}

watch([model, ratio, hasI2IReferences], normalizeResolutionSelection)

// ============ 参考图上传 ============
function syncPrimaryI2IReference() {
  i2iFile.value = i2iFiles.value[0] || null
  i2iPreview.value = i2iPreviews.value[0] || ''
}

function makeI2IReferenceId(file) {
  return `${file.name || 'image'}-${file.size || 0}-${file.lastModified || 0}-${Math.random().toString(36).slice(2, 8)}`
}

function fileToPreview(file) {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve(ev.target.result || '')
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

function isDuplicateReference(file) {
  return i2iFiles.value.some(item =>
    item.name === file.name &&
    item.size === file.size &&
    item.lastModified === file.lastModified
  )
}

async function appendI2IReferences(files, previewUrls = []) {
  const validFiles = Array.from(files || []).filter(file => file && file.type && file.type.startsWith('image/'))
  if (!validFiles.length) {
    showToast('请拖入图片文件或生成结果', 'error')
    return false
  }
  const available = Math.max(0, 8 - i2iFiles.value.length)
  if (!available) {
    showToast('参考图最多 8 张', 'error')
    return false
  }
  const nextFiles = []
  const nextPreviews = []
  for (let index = 0; index < validFiles.length && nextFiles.length < available; index++) {
    const file = validFiles[index]
    if (isDuplicateReference(file)) continue
    file.__i2iId = file.__i2iId || makeI2IReferenceId(file)
    nextFiles.push(file)
    nextPreviews.push(previewUrls[index] || await fileToPreview(file))
  }
  if (!nextFiles.length) {
    showToast('这些参考图已经添加过了', 'info')
    return false
  }
  i2iFiles.value = i2iFiles.value.concat(nextFiles)
  i2iPreviews.value = i2iPreviews.value.concat(nextPreviews)
  syncPrimaryI2IReference()
  const skipped = validFiles.length - nextFiles.length
  showToast(`已添加 ${nextFiles.length} 张参考图${skipped > 0 ? '，其余已跳过' : ''}`, 'success')
  return true
}

async function setI2IFile(file, previewUrl = '') {
  if (!file || !file.type.startsWith('image/')) {
    showToast('请拖入图片文件或生成结果', 'error')
    return false
  }
  file.__i2iId = file.__i2iId || makeI2IReferenceId(file)
  i2iFiles.value = [file]
  i2iPreviews.value = [previewUrl || await fileToPreview(file)]
  syncPrimaryI2IReference()
  return true
}

async function setI2IFiles(files) {
  const validFiles = Array.from(files || []).filter(file => file && file.type && file.type.startsWith('image/')).slice(0, 8)
  if (!validFiles.length) {
    showToast('请拖入图片文件或生成结果', 'error')
    return false
  }
  i2iFiles.value = []
  i2iPreviews.value = []
  await appendI2IReferences(validFiles)
  return true
}

async function handleI2IUpload(e) {
  const files = Array.from(e.target.files || [])
  if (!files.length) return
  await appendI2IReferences(files)
  e.target.value = ''
}

function removeI2IReference(index) {
  i2iFiles.value.splice(index, 1)
  i2iPreviews.value.splice(index, 1)
  syncPrimaryI2IReference()
}

function clearI2IReferences() {
  i2iFiles.value = []
  i2iPreviews.value = []
  syncPrimaryI2IReference()
}

function handleImageDragStart(e, url) {
  const normalized = normalizeImageUrl(url)
  draggingResultUrl.value = normalized
  warmImageFileCache(normalized)
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData('text/plain', normalized)
  e.dataTransfer.setData('text/uri-list', normalized)
  e.dataTransfer.setData('application/x-usagi-image-url', normalized)
}

function handleImageDragEnd() {
  draggingResultUrl.value = ''
}

function warmImageFileCache(url) {
  const normalized = normalizeImageUrl(url)
  if (!normalized || imageFileCache.has(normalized)) return
  const pending = imageUrlToFile(normalized, 'i2i-reference.png').catch(error => {
    imageFileCache.delete(normalized)
    throw error
  })
  imageFileCache.set(normalized, pending)
}

async function imageUrlToFile(url, name = 'reference.png') {
  if (url.startsWith('data:')) {
    const res = await fetch(url)
    const blob = await res.blob()
    return new File([blob], name, { type: blob.type || 'image/png' })
  }
  const absolute = new URL(url, window.location.origin).toString()
  const res = await fetch(absolute)
  if (!res.ok) throw new Error('图片读取失败: ' + res.status)
  const blob = await res.blob()
  return new File([blob], name, { type: blob.type || 'image/png' })
}

async function useUrlAsI2IReference(url, label = '生成结果') {
  const normalized = normalizeImageUrl(url)
  try {
    const cached = imageFileCache.get(normalized)
    const file = cached ? await cached : await imageUrlToFile(normalized, 'i2i-reference.png')
    if (await appendI2IReferences([file], [normalized])) {
      mode.value = 't2i'
      showToast(label + '已加入参考图', 'success')
    }
  } catch (e) {
    showToast(e.message || '设置参考图失败', 'error')
  }
}

async function handleI2IDrop(e) {
  i2iDragActive.value = false
  const files = Array.from(e.dataTransfer.files || [])
  if (files.length) {
    await appendI2IReferences(files)
    return
  }
  const url = e.dataTransfer.getData('application/x-usagi-image-url')
    || e.dataTransfer.getData('text/uri-list')
    || e.dataTransfer.getData('text/plain')
  if (url) {
    await useUrlAsI2IReference(url, '拖拽图片')
  }
}

// ============ 统一生成入口 ============
const ratioMap = { '21:9': '21:9', '16:9': '16:9', '3:2': '3:2', '4:3': '4:3', '1:1': '1:1', '3:4': '3:4', '2:3': '2:3', '9:16': '9:16' }

async function readI2IBase64List(options = {}) {
  const withMeta = Boolean(options.withMeta)
  const files = (i2iFiles.value.length ? i2iFiles.value : (i2iFile.value ? [i2iFile.value] : [])).slice(0, 8)
  const count = Math.max(1, files.length)
  const totalTargetBytes = count > 1 ? 2.0 * 1024 * 1024 : 700 * 1024
  const perImageMaxBytes = Math.max(280 * 1024, Math.min(600 * 1024, Math.floor(totalTargetBytes / count)))
  const maxSide = count > 4 ? 720 : 896
  const refs = await Promise.all(files.map(async file => {
    const compressed = await compressImageFile(file, {
      always: true,
      maxSide,
      maxBytes: perImageMaxBytes,
      quality: 0.62,
      minQuality: 0.38
    })
    const dataUrl = await readFileAsDataUrl(compressed)
    const base64 = stripDataUrl(dataUrl)
    return {
      base64,
      mime: compressed.type || 'image/jpeg',
      name: compressed.name || 'reference-compressed.jpg'
    }
  }))
  const totalBase64Chars = refs.reduce((sum, item) => sum + String(item.base64 || '').length, 0)
  if (totalBase64Chars > totalTargetBytes * 1.45) {
    throw new Error('参考图仍然过大，请减少张数或换更小的图片')
  }
  return withMeta ? refs : refs.map(item => item.base64)
}

function addPromptJobs(amount = 1, base64List = []) {
  const text = prompt.value.trim()
  if (!text) return []
  const total = Math.max(1, Math.floor(Number(amount) || 1))
  const references = Array.isArray(base64List) ? base64List : []
  const jobs = Array.from({ length: total }, (_, index) => ({
    id: Date.now() + '-' + index + '-' + Math.random().toString(36).slice(2, 8),
    prompt: total > 1 ? `${text} (${index + 1}/${total})` : text,
    rawPrompt: text,
    base64List: references,
    batchIndex: index + 1,
    batchTotal: total,
    status: 'queued',
    url: '',
    error: '',
    revealed: false,
    taskId: '',
    provider: gptImageRoute.value
  }))
  promptJobs.value.push(...jobs)
  return jobs
}

function pendingPromptJobs() {
  return promptJobs.value.filter(job => job.status === 'queued')
}

function hasSubmittedActiveGptJob() {
  return promptJobs.value.some(job => job.taskId && (job.status === 'queued' || job.status === 'running'))
}

function claimPromptJob() {
  if (hasSubmittedActiveGptJob()) return null
  const job = pendingPromptJobs()[0]
  if (job) job.status = 'running'
  return job
}

function unfinishedPromptJobs() {
  return promptJobs.value.filter(job => job.status === 'queued' || job.status === 'running')
}

function syncGptLoading() {
  loading.value = gptQueueRunning || unfinishedPromptJobs().length > 0
}

function isTerminalGptStatus(status) {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

function applyGptTaskToJob(task, existingJob = null) {
  if (!task) return null
  let job = existingJob || promptJobs.value.find(item => item.taskId === task.id || item.id === task.id)
  if (!job) {
    job = {
      id: task.id,
      taskId: task.id,
      prompt: task.prompt || '',
      rawPrompt: task.prompt || '',
      base64List: [],
      batchIndex: 1,
      batchTotal: 1,
      status: 'queued',
      url: '',
      error: '',
      revealed: false,
      provider: task.provider || 'primary'
    }
    promptJobs.value.unshift(job)
  }
  job.taskId = task.id
  job.provider = task.provider || job.provider || 'primary'
  job.prompt = task.prompt || job.prompt
  job.rawPrompt = task.prompt || job.rawPrompt
  if (task.status === 'succeeded') {
    const wasDone = job.status === 'done'
    job.url = normalizeImageUrl(task.result_url || job.url)
    if (job.url) warmImageFileCache(job.url)
    job.status = 'done'
    job.error = ''
    window.setTimeout(() => { job.revealed = true }, 60)
    if (!wasDone) progress.value += 1
  } else if (task.status === 'failed' || task.status === 'canceled') {
    const wasError = job.status === 'error'
    job.status = 'error'
    job.error = task.error || 'failed'
    if (!wasError) progress.value += 1
  } else if (task.status === 'running') {
    job.status = 'running'
    job.error = ''
  } else {
    job.status = 'queued'
  }
  return job
}

async function pollGptTasks() {
  const ids = promptJobs.value.map(job => job.taskId).filter(Boolean)
  if (!ids.length) {
    stopGptTaskPolling()
    syncGptLoading()
    return
  }
  try {
    const data = await getGptImageTaskStatus(ids)
    ;(data.list || []).forEach(task => applyGptTaskToJob(task))
  } catch (e) {
    // Keep polling; a transient page/API hiccup should not orphan the running tasks.
  } finally {
    syncGptLoading()
    const hasActive = promptJobs.value.some(job => job.taskId && (job.status === 'queued' || job.status === 'running'))
    if (!hasActive && pendingPromptJobs().length) {
      runGptQueue()
    } else if (!hasActive) {
      stopGptTaskPolling()
    }
  }
}

function startGptTaskPolling() {
  if (gptTaskPollTimer) return
  gptTaskPollTimer = window.setInterval(pollGptTasks, GPT_TASK_POLL_MS)
  pollGptTasks()
}

function stopGptTaskPolling() {
  if (gptTaskPollTimer) {
    window.clearInterval(gptTaskPollTimer)
    gptTaskPollTimer = null
  }
}

async function restoreGptTasks() {
  try {
    const data = await listGptImageTasks(20)
    const tasks = data.list || []
    const nowSec = Math.floor(Date.now() / 1000)
    const visible = tasks
      .filter(task => !isTerminalGptStatus(task.status) || nowSec - Number(task.created_at || 0) < 30 * 60)
      .slice(0, 12)
    visible.forEach(task => applyGptTaskToJob(task))
    if (visible.length) {
      model.value = 'gpt-image2'
      startGptTaskPolling()
      syncGptLoading()
    }
  } catch (e) {}
}

function resetErroredPromptJobs() {
  let changed = false
  promptJobs.value.forEach(job => {
    if (job.status === 'error') {
      job.status = 'queued'
      job.error = ''
      changed = true
    }
  })
  return changed
}

function runGptQueue() {
  gptQueueRunning = true
  syncGptLoading()
  while (activeGptWorkers < GPT_MAX_CONCURRENT) {
    const job = claimPromptJob()
    if (!job) break
    activeGptWorkers += 1
    runGptPromptJob(job).finally(() => {
      activeGptWorkers = Math.max(0, activeGptWorkers - 1)
      if (pendingPromptJobs().length) {
        runGptQueue()
      } else if (activeGptWorkers === 0) {
        gptQueueRunning = false
        syncGptLoading()
      }
    })
  }
  if (activeGptWorkers === 0 && !pendingPromptJobs().length) gptQueueRunning = false
  syncGptLoading()
}

function removePromptJob(id) {
  promptJobs.value = promptJobs.value.filter(job => job.id !== id || job.status === 'running')
}

function clearPromptJobs() {
  if (loading.value && model.value === 'gpt-image2') {
    promptJobs.value = promptJobs.value.filter(job => job.taskId && (job.status === 'queued' || job.status === 'running'))
    return
  }
  promptJobs.value = promptJobs.value.filter(job => job.taskId && job.status === 'running')
}

function stopGptJobs(message = '已停止生成') {
  gptJobControllers.forEach(controller => {
    try { controller.abort() } catch (e) {}
  })
  gptJobControllers.clear()
  activeGptWorkers = 0
  stopGptTaskPolling()
  promptJobs.value.forEach(job => {
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'error'
      job.error = message
    }
  })
  gptQueueRunning = false
  progress.value = 0
  syncGptLoading()
  showToast(message, 'info')
}

function promptJobStatusLabel(job) {
  if (job.status === 'running') return '生成中'
  if (job.status === 'done') return '已完成'
  if (job.status === 'error') return '失败'
  return '等待'
}

function hasRunningPromptJobs() {
  return unfinishedPromptJobs().length > 0
}

async function runGptPromptJob(job) {
  if (job.status !== 'running') job.status = 'running'
  job.error = ''
  job.revealed = false
  const base64List = Array.isArray(job.base64List) ? job.base64List : []
  try {
    const data = await createGptImageTask({
      prompt: job.rawPrompt || job.prompt,
      ...(base64List.length ? { image_base64_list: base64List } : {}),
      ratio: ratio.value,
      resolution: resVal.value,
      quality: 'auto',
      provider: gptImageRoute.value
    })
    if (data.error) throw new Error(data.error)
    if (!data.task?.id) throw new Error('task create failed')
    applyGptTaskToJob(data.task, job)
    startGptTaskPolling()
  } catch (e) {
    job.error = formatGptImageError(e)
    job.status = 'error'
    progress.value += 1
  } finally {
    syncGptLoading()
  }
}

function formatGptImageError(e) {
  const data = e?.data || {}
  const message = String(e?.message || e || '')
  const primaryError = String(data.primaryError || '')
  const fallbackError = String(data.fallbackResponsesError || data.imageFallbackError || '')
  const combined = [message, primaryError, fallbackError].filter(Boolean).join(' | ')
  const detailParts = [
    data.transport ? `transport=${data.transport}` : '',
    data.size ? `size=${data.size}` : '',
    data.elapsed_ms ? `elapsed=${Math.round(Number(data.elapsed_ms) / 1000)}s` : '',
    data.provider_base_url ? String(data.provider_base_url).replace(/^https?:\/\//, '') : ''
  ].filter(Boolean)
  const detailSuffix = detailParts.length ? ` (${detailParts.join(', ')})` : ''
  const providerLabel = data.provider === 'fallback' ? '原线路' : data.provider === 'primary' ? '主线路' : '当前线路'
  if (/502|503|504|upstream|temporarily unavailable/i.test(combined)) {
    return `${providerLabel}上游接口暂时不可用${detailSuffix}：${message || primaryError || '请稍后重试'}`
  }
  if (/GPT-Image2 request timed out|GPT-Image2 responses request timed out/i.test(combined)) {
    return `${providerLabel}生成超时${detailSuffix}：已按 3 分钟停止等待`
  }
  if (/413|too large|body too large|request body/i.test(combined)) {
    return '参考图太大了，换小一点的图或减少数量'
  }
  if (/insufficient account balance|余额不足|balance/i.test(combined)) {
    const primarySuffix = primaryError ? `；主线路也不可用：${primaryError}` : ''
    return `${providerLabel}余额不足${primarySuffix}`
  }
  if (/ssl|eof|fetch failed|connect|connection|remote|reset|disconnected|timed?\s*out|timeout/i.test(combined)) {
    return `${providerLabel}网络/SSL 连接失败：${message || primaryError || '请稍后重试'}`
  }
  if (/403|forbidden|unauthorized|api key|invalid key/i.test(combined)) {
    return `${providerLabel}权限或密钥异常：${message || '请检查密钥'}`
  }
  return message || '生成失败'
}

async function handleGenerate() {
  const hasPrompt = prompt.value.trim() || (model.value === 'gpt-image2' && promptJobs.value.length)
  if (!hasPrompt) return showToast('请输入描述词', 'error')

  loading.value = true
  if (model.value !== 'gpt-image2') {
    results.value = []
    progress.value = 0
  }

  try {
    if (model.value === 'minimax') {
      const base64List = hasI2IReferences.value ? await readI2IBase64List() : []
      const base64 = base64List[0] || null
      const data = await generateMiniMaxImage({
        prompt: prompt.value,
        aspect_ratio: ratioMap[ratio.value] || '1:1',
        n: count.value,
        ...(base64 ? { subject_reference: [{ type: 'character', image_file: base64 }] } : {})
      })
      if (data.urls && data.urls.length) {
        results.value = data.urls
        showToast(`生成成功 (${data.urls.length}张)`, 'success')
      } else {
        showToast(data.error || '生成失败', 'error')
      }
    } else if (model.value === 'gpt-image2') {
      const base64List = hasI2IReferences.value && prompt.value.trim() ? await readI2IBase64List({ withMeta: true }) : []
      const newJobs = prompt.value.trim() ? addPromptJobs(count.value, base64List) : []
      if (!newJobs.length) resetErroredPromptJobs()
      const queuedBeforeRun = pendingPromptJobs().length
      if (!queuedBeforeRun) {
        syncGptLoading()
        showToast(loading.value ? '队列正在生成，输入新提示词后可继续追加' : '没有待生成任务', loading.value ? 'info' : 'error')
        return
      }
      if (gptQueueRunning) {
        runGptQueue()
        syncGptLoading()
        showToast(`已追加 ${newJobs.length || queuedBeforeRun} 张生图任务`, 'success')
      } else {
        progress.value = 0
        runGptQueue()
        showToast(`已提交 ${newJobs.length || queuedBeforeRun} 张生图任务`, 'success')
      }
    } else {
      // 即梦
      const base64List = hasI2IReferences.value ? await readI2IBase64List() : []
      const base64 = base64List[0] || null
      const data = base64
        ? await editDreaminaImage({ prompt: prompt.value, image_base64: base64, model_version: model.value, ratio: ratio.value, resolution_type: resVal.value })
        : await generateDreaminaImage({ prompt: prompt.value, model_version: model.value, ratio: ratio.value, resolution_type: resVal.value })
      if (data.image_url || data.url) {
        results.value = [data.image_url || data.url]
        showToast('生成成功', 'success')
      } else {
        showToast(data.error || '生成失败', 'error')
      }
    }
  } catch(e) {
    showToast('请求失败: ' + e.message, 'error')
  } finally {
    loading.value = model.value === 'gpt-image2' ? hasRunningPromptJobs() : false
    if (model.value !== 'gpt-image2' || !loading.value) progress.value = 0
  }
}

// ============ 查询余额 ============
const eggLoading = ref(false)
const showEggJoke = ref(false)
const eggModels = ref([{ credit: '—' }, { credit: '—' }])

async function handleEggCheck() {
  eggLoading.value = true
  eggModels.value = [{ credit: '查询中...' }, { credit: '查询中...' }]
  await new Promise(r => setTimeout(r, 1500))
  eggModels.value = [{ credit: 'FREE（免费）' }, { credit: 'FREE（免费）' }]
  eggLoading.value = false
  showEggJoke.value = true
}

// ============ 历史记录 ============
const historyLoading = ref(false)
const historyList = ref([])
const historyPage = ref(1)
const historyTotal = ref(0)
const selectedHistory = ref(null)

async function switchToHistory() {
  mode.value = 'history'
  historyPage.value = 1
  await loadHistory()
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const data = await getImagegenHistory(historyPage.value, 12)
    if (historyPage.value === 1) {
      historyList.value = data.list || []
      selectedHistory.value = null
    } else {
      historyList.value.push(...(data.list || []))
    }
    historyTotal.value = data.total || 0
  } catch(e) {
    showToast('加载历史失败', 'error')
  } finally {
    historyLoading.value = false
  }
}

async function loadMoreHistory() {
  historyPage.value++
  await loadHistory()
}

async function delHistory(id) {
  try {
    await deleteImagegenHistory(id)
    historyList.value = historyList.value.filter(h => h.id !== id)
    if (selectedHistory.value?.id === id) selectedHistory.value = historyList.value[0] || null
    historyTotal.value--
    showToast('已删除', 'success')
  } catch(e) {
    showToast('删除失败', 'error')
  }
}

function useHistoryItem(item) {
  // 将历史记录的提示词填充到输入框
  mode.value = 't2i'
  prompt.value = item.prompt
  // 根据模型类型设置
  if (item.model === 'minimax') model.value = 'minimax'
  else if (item.model === 'gpt-image2') model.value = 'gpt-image2'
  else model.value = item.model || 'dreamina'
  // 设置比例
  if (item.ratio) ratio.value = item.ratio
  showToast('已填充提示词', 'success')
}

function selectHistoryItem(item) {
  selectedHistory.value = item
}

function reuseHistoryItem(item) {
  if (!item) return
  useHistoryItem(item)
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// ============ 预览 & 右键菜单 ============
const previewUrl = ref('')
const ctxMenu = ref({ show: false, url: '', x: 0, y: 0 })

function showCtxMenu(e, url) {
  ctxMenu.value = { show: true, url, x: e.clientX, y: e.clientY }
}
function closeCtxMenu() { ctxMenu.value.show = false }

if (typeof document !== 'undefined') {
  document.addEventListener('click', closeCtxMenu)
}

async function handleCopy(text) {
  try { await navigator.clipboard.writeText(text); showToast('已复制到剪贴板', 'success') }
  catch { showToast('复制失败', 'error') }
}

function handleSaveImg(url) {
  const normalized = normalizeImageUrl(url)
  if (!normalized) {
    showToast('图片地址为空，不能下载', 'error')
    return
  }
  fetch(normalized)
    .then(resp => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.blob()
    })
    .then(blob => {
      if (!blob.size) throw new Error('empty image')
      if (blob.type && !blob.type.startsWith('image/')) throw new Error(blob.type)
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = 'generated-' + Date.now() + '.png'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
      showToast('图片已开始下载', 'success')
    })
    .catch(e => {
      showToast('图片下载失败：' + (e.message || '请稍后重试'), 'error')
    })
}

onMounted(() => {
  restoreGptTasks()
})

onUnmounted(() => {
  stopGptTaskPolling()
})
</script>

<style scoped>
/* ============ 主体布局 ============ */
.ig-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.ig-left {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ig-right {
  flex: 1;
  min-height: 480px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 14px;
  overflow: hidden;
  position: relative;
  background: var(--surface, #12122a);
}

/* ============ 模式切换 ============ */
.mode-tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--surface2, #1e1e3a);
  border-radius: 10px;
}
.mode-tabs button {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted, #888);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.mode-tabs button.active {
  background: var(--primary, #7b2fff);
  color: #fff;
}

/* ============ 参数 ============ */
.prompt-queue {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.prompt-queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
  color: var(--text-dim, #888);
}
.prompt-queue-actions {
  display: flex;
  gap: 6px;
}
.prompt-job-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prompt-job {
  display: grid;
  grid-template-columns: 20px 1fr auto 24px;
  align-items: start;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 6px;
  background: var(--surface2, #1e1e3a);
}
.prompt-job span {
  color: var(--text-muted, #888);
  font-size: 11px;
}
.prompt-job p {
  margin: 0;
  color: var(--text, #e0d8ff);
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
}
.prompt-job em {
  color: var(--text-muted, #888);
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
}
.prompt-job button {
  border: 0;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.prompt-job button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.param-section { display: flex; flex-direction: column; gap: 5px; }
.param-label { font-size: 11px; color: var(--text-dim, #888); font-weight: 500; }
.param-row { display: flex; gap: 4px; flex-wrap: wrap; }
.route-row { gap: 6px; }
.btn-option {
  padding: 3px 7px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border, #2a2a4a);
  background: transparent;
  color: var(--text-dim, #888);
  transition: all 0.12s;
  font-family: inherit;
  white-space: nowrap;
}
.btn-option:hover { border-color: var(--border-mid, #3a3a5c); color: var(--text, #e0d8ff); background: var(--surface2, #1e1e3a); }
.btn-option.active { background: var(--primary-dark, #5a1fdb); border-color: var(--primary-dark, #5a1fdb); color: #fff; }
.btn-option:disabled {
  cursor: not-allowed;
  opacity: 0.42;
  background: transparent;
  color: var(--text-muted, #888);
}
.btn-option:disabled:hover {
  border-color: var(--border, #2a2a4a);
  background: transparent;
  color: var(--text-muted, #888);
}
.route-option {
  min-width: 76px;
  padding: 5px 10px;
  border-radius: 999px;
}

.model-hint {
  font-size: 10px;
  color: var(--text-muted, #888);
  margin-top: 4px;
  line-height: 1.4;
}

/* ============ 右侧展示区 ============ */
.result-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 480px;
}
.placeholder-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-muted, #666);
}
.placeholder-icon { font-size: 40px; opacity: 0.5; }
.placeholder-text { font-size: 14px; }
.placeholder-hint { font-size: 11px; opacity: 0.6; }

/* 模糊加载动画 */
.blur-bg {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 2;
}
.blur-inner {
  position: absolute;
  inset: 0;
  background: linear-gradient(45deg, var(--primary-dark, #5a1fdb) 0%, var(--primary, #7b2fff) 50%, var(--accent, #00f5d4) 100%);
  opacity: 0.25;
  animation: pulse 1.5s ease-in-out infinite;
}
.blur-text {
  position: relative;
  z-index: 1;
  font-size: 16px;
  color: var(--primary-light, #b47fff);
  font-weight: 600;
}
@keyframes pulse { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.35; } }

/* 结果网格 */
.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  padding: 8px;
}
.result-grid.revealed .result-img { filter: blur(0); opacity: 1; }
.result-cell {
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  background: #000;
  aspect-ratio: 1;
}
.result-cell:hover::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 2px solid var(--primary, #7b2fff);
  border-radius: 8px;
  z-index: 1;
  pointer-events: none;
}
.result-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  filter: blur(15px);
  opacity: 0.4;
  transition: filter 0.8s ease-out, opacity 0.8s ease-out;
}
.result-img.revealed { filter: blur(0); opacity: 1; }

.prompt-result-cell {
  aspect-ratio: 1;
}
.prompt-result-frame {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(13, 18, 26, 0.98), rgba(29, 24, 48, 0.96)),
    #05050d;
}
.prompt-result-img,
.prompt-result-state,
.prompt-result-loading {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.prompt-result-img {
  object-fit: cover;
  display: block;
  filter: blur(15px);
  opacity: 0.4;
  transition: filter 0.8s ease-out, opacity 0.8s ease-out;
}
.prompt-result-img.revealed {
  filter: blur(0);
  opacity: 1;
}
.prompt-result-loading {
  z-index: 1;
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 22px 18px 72px;
  background:
    radial-gradient(circle at 32% 22%, rgba(255, 255, 255, 0.12), transparent 24%),
    radial-gradient(circle at 74% 24%, rgba(0, 214, 178, 0.14), transparent 22%),
    linear-gradient(135deg, rgba(9, 14, 23, 0.98), rgba(32, 27, 55, 0.96));
}
.prompt-result-sheen {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    linear-gradient(110deg, transparent 8%, rgba(255, 255, 255, 0.12) 20%, transparent 34%),
    repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 14px);
  transform: translateX(-60%);
  animation: promptSheen 2.4s ease-in-out infinite;
}
.prompt-result-orbit {
  position: relative;
  z-index: 2;
  grid-row: 2;
  display: inline-flex;
  justify-self: center;
  align-self: center;
  gap: 7px;
}
.prompt-result-orbit i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--primary-light, #b47fff) 70%, #fff);
  opacity: 0.34;
  animation: promptDot 1.18s ease-in-out infinite;
}
.prompt-result-orbit i:nth-child(2) { animation-delay: 0.14s; }
.prompt-result-orbit i:nth-child(3) { animation-delay: 0.28s; }
@keyframes promptSheen {
  0% { transform: translateX(-68%); opacity: 0.25; }
  45%, 65% { opacity: 0.82; }
  100% { transform: translateX(68%); opacity: 0.22; }
}
@keyframes promptDot {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.32; }
  40% { transform: translateY(-5px); opacity: 0.96; }
}
.prompt-result-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px;
  color: var(--text-muted, #888);
  text-align: center;
}
.prompt-result-state span {
  color: var(--text, #e0d8ff);
  font-size: 14px;
  font-weight: 700;
}
.prompt-result-state p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.prompt-result-cell.failed {
  border-color: rgba(239, 68, 68, 0.45);
}
.prompt-result-cell.dragging {
  transform: scale(0.985);
  opacity: 0.72;
  box-shadow: 0 0 0 2px var(--primary, #7b2fff), 0 14px 32px rgba(123, 47, 255, 0.25);
}
.prompt-result-cell.dragging .prompt-result-frame::after {
  content: '拖到参考图区域';
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 24, 0.28);
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}
.prompt-result-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  min-height: 48px;
  padding: 18px 10px 8px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0.36) 58%, rgba(0, 0, 0, 0));
  color: rgba(255, 255, 255, 0.88);
  font-size: 11px;
  line-height: 1.35;
  max-height: 54px;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  pointer-events: none;
}

/* ============ 余额卡片 ============ */
.egg-row { margin-top: 0; }
.egg-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 18px;
  background: var(--panel-bg, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
}
.egg-card-left { display: flex; align-items: center; gap: 12px; }
.egg-icon { font-size: 24px; }
.egg-title { font-size: 13px; font-weight: 600; color: var(--text, #e0d8ff); }
.egg-desc { font-size: 11px; color: var(--text-muted, #888); margin-top: 2px; }
.egg-card-right { display: flex; align-items: center; gap: 16px; }
.egg-models { display: flex; gap: 16px; }
.egg-model-row { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.egg-model-row span:first-child { font-size: 11px; color: var(--text-muted, #888); }
.egg-model-row span:last-child { font-size: 14px; font-weight: 700; color: var(--primary-light, #b47fff); }
.egg-model-row span.loading { font-size: 12px; color: var(--text-muted, #888); font-weight: 400; }

/* ============ 上传区 ============ */
.upload-zone {
  border: 2px dashed var(--border-mid, #3a3a5c);
  border-radius: 10px;
  padding: 14px;
  transition: border-color 0.15s, background 0.15s;
  background: var(--surface, #12122a);
  min-height: 188px;
}
.upload-zone:hover,
.upload-zone.drag-active { border-color: var(--primary-dark, #5a1fdb); background: var(--surface2, #1e1e3a); }
.upload-hint {
  min-height: 112px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted, #888);
  font-size: 12px;
  text-align: center;
  cursor: pointer;
}
.upload-icon { font-size: 24px; }
.reference-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.reference-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text, #e0d8ff);
}
.reference-sub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-muted, #888);
  line-height: 1.35;
}
.reference-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 10px;
}
.reference-card,
.reference-add-card {
  position: relative;
  min-height: 116px;
  border: 1px solid var(--border-mid, #3a3a5c);
  border-radius: 8px;
  background: rgba(255,255,255,0.035);
  overflow: hidden;
}
.reference-card.primary {
  border-color: var(--primary-light, #b47fff);
  box-shadow: 0 0 0 1px rgba(180,127,255,0.18) inset;
}
.reference-img {
  width: 100%;
  height: 116px;
  display: block;
  object-fit: cover;
  cursor: zoom-in;
}
.reference-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  width: 24px;
  height: 24px;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 50%;
  background: rgba(0,0,0,0.62);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.reference-remove:hover { background: rgba(220, 38, 38, 0.86); }
.reference-meta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,0.72));
  color: #fff;
  font-size: 11px;
}
.reference-meta span {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255,255,255,0.18);
}
.reference-meta strong {
  font-size: 11px;
  font-weight: 600;
}
.reference-add-card {
  min-height: 116px;
  border-style: dashed;
  color: var(--text-muted, #888);
  cursor: pointer;
}
.reference-add-card span {
  display: block;
  margin-top: 24px;
  font-size: 28px;
  line-height: 1;
}
.reference-add-card em {
  display: block;
  margin-top: 8px;
  font-style: normal;
  font-size: 12px;
}
.reference-add-card:hover {
  border-color: var(--primary-light, #b47fff);
  color: var(--primary-light, #b47fff);
}

/* ============ 图片预览弹窗 ============ */
.img-preview-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.85);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(6px);
}
.preview-close {
  position: absolute;
  top: 16px;
  right: 20px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.12);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-close:hover { background: rgba(255,255,255,0.2); }
.preview-full-img { max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }

/* ============ 右键菜单 ============ */
.ctx-menu {
  position: fixed;
  z-index: 1000;
  background: var(--panel-bg, #1a1a2e);
  border: 1px solid var(--border-mid, #3a3a5c);
  border-radius: 10px;
  padding: 6px;
  min-width: 140px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.ctx-item {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text, #e0d8ff);
  cursor: pointer;
  transition: background 0.1s;
}
.ctx-item:hover { background: var(--primary-dark, #5a1fdb); }

/* ============ 彩蛋弹窗 ============ */
.egg-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}
.egg-modal-box {
  background: var(--surface, #1e1e3a);
  border: 1px solid var(--border-mid, #3a3a5c);
  border-radius: 16px;
  padding: 28px;
  width: 420px;
  max-width: 90vw;
}
.egg-modal-hdr { font-size: 16px; font-weight: 800; color: var(--text, #e0d8ff); margin-bottom: 14px; }
.egg-modal-body { font-size: 14px; color: var(--text-dim, #b0a8d0); line-height: 1.8; text-align: center; }

/* ============ 历史记录 ============ */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 600px;
  overflow-y: auto;
}

.history-loading,
.history-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted, #888);
  font-size: 13px;
}

.history-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  display: flex;
  gap: 10px;
  padding: 10px;
  background: var(--surface2, #1e1e3a);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  align-items: center;
}

.history-item.active {
  outline: 2px solid var(--primary, #a78bfa);
  background: rgba(167, 139, 250, 0.13);
}

.history-item:hover {
  background: var(--surface, #2a2a4a);
}

.history-thumb {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: #000;
}

.history-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-info {
  flex: 1;
  min-width: 0;
}

.history-prompt {
  font-size: 12px;
  color: var(--text, #e0d8ff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.history-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--text-muted, #888);
}

.history-model {
  background: var(--primary-dark, #5a1fdb);
  color: #fff;
  padding: 1px 6px;
  border-radius: 4px;
}

.history-time {
  opacity: 0.7;
}

.history-del {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 14px;
  opacity: 0.5;
  transition: opacity 0.15s;
}

.history-del:hover {
  opacity: 1;
}

.history-more {
  text-align: center;
  padding: 10px;
}

.history-viewer {
  min-height: 100%;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 14px;
}

.history-viewer-img {
  min-height: 420px;
  border-radius: 16px;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(167, 139, 250, 0.12), rgba(0, 245, 212, 0.06)),
    var(--surface2, #1e1e3a);
  display: grid;
  place-items: center;
  cursor: zoom-in;
}

.history-viewer-img img {
  max-width: 100%;
  max-height: 72vh;
  object-fit: contain;
  display: block;
}

.history-viewer-info {
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--border, rgba(167, 139, 250, 0.18));
  background: var(--surface2, #1e1e3a);
}

.history-viewer-info p {
  margin: 10px 0 12px;
  color: var(--text, #e0d8ff);
  line-height: 1.7;
  font-size: 13px;
}

.history-viewer-meta,
.history-viewer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.history-viewer-meta span {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--accent-soft, rgba(0, 245, 212, 0.08));
  color: var(--text-muted, #aaa);
  font-size: 11px;
}
</style>
