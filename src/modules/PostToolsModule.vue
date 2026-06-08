<template>
  <div class="posttools-module">
    <div class="module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">🎬</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">POST TOOLS</div>
          <h2>后期工具</h2>
        </div>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="posttools-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id">
        <span class="tab-icon">{{ tab.icon }}</span>
        <span class="tab-label">{{ tab.label }}</span>
      </button>
    </div>

    <!-- 视频下载与转换 -->
    <div v-if="activeTab === 'download'" class="tool-section media-workbench">
      <section class="tool-card media-console">
        <div class="tool-header media-console-header">
          <span class="tool-icon">↓</span>
          <div>
            <h3>素材下载与转换</h3>
            <p class="tool-desc">高频入口：抖音 / B站下载、MP3 提取、MP4 转换、压缩和封面提取，会自动进入右侧任务队列。</p>
          </div>
        </div>

        <div class="media-workbench-grid">
          <div class="media-composer">
            <div class="media-flow-strip">
              <span>1. 粘贴链接 / 拖文件</span>
              <span>2. 自动下载原片</span>
              <span>3. 转码 / 提取</span>
              <span>4. 队列交付</span>
            </div>

            <div
              class="media-drop-zone"
              :class="{ dragging: mediaDragging, hasFile: Boolean(mediaFileName) }"
              @dragover.prevent="mediaDragging = true"
              @dragleave="mediaDragging = false"
              @drop.prevent="handleMediaDrop">
              <div class="media-input-row">
                <textarea
                  v-model="mediaInput"
                  class="inp media-link-input"
                  rows="6"
                  placeholder="粘贴抖音 / B站分享口令、B站链接或 BV 号。可以是一整段文案，系统会自动拆出链接并去掉前后缀；也可以拖入 MP4、MOV、WEBM、MP3、WAV 文件。"
                  @keydown.enter.ctrl.prevent="runMediaAction(selectedMediaAction)" />
                <input ref="mediaFileInput" class="hidden-input" type="file" accept="video/*,audio/*" @change="handleMediaFileSelect" />
                <button class="btn btn-ghost media-pick-btn" type="button" @click="triggerMediaFile">选本地文件</button>
              </div>
              <div class="media-source-line">
                <span v-if="mediaFileName">已选择：{{ mediaFileName }}</span>
                <span v-else>{{ detectMediaSourceLabel(mediaInput) }}</span>
                <button v-if="mediaFileName" class="media-clear-btn" type="button" @click="clearMediaFile">清除</button>
              </div>
            </div>

            <div class="media-action-grid">
              <button
                v-for="action in mediaActions"
                :key="action.id"
                type="button"
                class="media-action"
                :class="{ active: selectedMediaAction === action.id }"
                :disabled="mediaBusy || (mediaFile && action.id === 'download-video')"
                @click="selectMediaAction(action.id)">
                <span class="media-action-title">{{ action.label }}</span>
                <span class="media-action-desc">{{ mediaFile && action.id === 'download-video' ? '本地文件无需下载' : action.desc }}</span>
              </button>
            </div>

            <div v-if="selectedMediaAction === 'download-video' && !mediaFile" class="media-quality-switch">
              <button
                v-for="option in mediaQualityOptions"
                :key="option.id"
                type="button"
                class="media-quality-option"
                :class="{ active: selectedMediaQuality === option.id }"
                :disabled="mediaBusy"
                @click="selectedMediaQuality = option.id">
                <span>{{ option.label }}</span>
                <small>{{ option.desc }}</small>
              </button>
            </div>

            <div class="media-submit-row">
              <div class="media-submit-copy">
                <strong>{{ selectedMediaActionLabel }}</strong>
                <span>{{ mediaRunHint }}</span>
              </div>
              <button
                class="btn btn-primary media-start-btn"
                type="button"
                :disabled="mediaBusy || !canRunMediaAction"
                @click="runMediaAction(selectedMediaAction)">
                {{ mediaBusy ? '处理中...' : '开始处理' }}
              </button>
            </div>

            <div v-if="mediaBusy" class="analyzing-bar">
              <div class="analyzing-bar-inner"></div>
              <span>{{ mediaStatus || '处理中...' }}</span>
            </div>
            <div v-if="mediaError" class="error-inline">{{ mediaError }}</div>
          </div>

          <aside class="media-queue-panel">
            <div class="media-queue-head">
              <div>
                <h4>下载 / 处理队列</h4>
                <p>{{ mediaQueueSummary }}</p>
              </div>
              <button v-if="mediaTasks.length" class="media-clear-btn" type="button" :disabled="mediaBusy" @click="clearMediaTasks">清空</button>
            </div>

            <div v-if="!mediaTasks.length" class="media-empty-queue">
              <strong>还没有任务</strong>
              <span>点击左侧动作后，会在这里显示下载位置、处理状态和输出文件。</span>
            </div>

            <div v-else class="media-task-list">
              <div
                v-for="task in mediaTasks"
                :key="task.id"
                class="media-task"
                :class="task.status">
                <div class="media-task-top">
                  <span class="media-task-badge">{{ mediaTaskStatusText(task) }}</span>
                  <span class="media-task-action">{{ mediaActionLabel(task.actionId) }}</span>
                </div>
                <div class="media-task-title">{{ task.title }}</div>
                <div class="media-task-source">{{ task.sourceLabel }}</div>
                <div v-if="task.status === 'running'" class="media-task-progress">
                  <span></span>
                </div>
                <div v-if="task.statusText" class="media-task-note">{{ task.statusText }}</div>
                <div v-if="task.error" class="error-inline">{{ task.error }}</div>

                <div v-if="task.files.length" class="download-result-list media-results">
                  <div
                    v-for="file in task.files"
                    :key="file.url || file.path || file.name"
                    class="download-result-row">
                    <div class="download-file-meta">
                      <span class="file-name">{{ file.name || '处理结果' }}</span>
                      <span class="file-size">{{ [file.type, formatFileSize(file.size), file.url ? '保存：' + file.url : ''].filter(Boolean).join(' · ') }}</span>
                    </div>
                    <div class="download-result-actions">
                      <button
                        v-for="action in mediaFollowupActions"
                        :key="action.id"
                        class="btn btn-ghost btn-sm"
                        type="button"
                        :disabled="mediaBusy || !file.url"
                        @click="runMediaFollowup(action.id, file, task)">
                        {{ action.shortLabel }}
                      </button>
                      <a class="btn btn-primary btn-sm" :href="file.download_url || file.url" :download="file.name || true" target="_blank">下载</a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>

    <div v-if="activeTab === 'download_old'" class="tool-section video-download-section">
      <div class="download-grid">
        <section
          v-for="item in videoDownloadPanels"
          :key="item.platform"
          class="tool-card video-download-card"
          :class="item.platform">
          <div class="tool-header">
            <span class="tool-icon">{{ item.icon }}</span>
            <div>
              <h3>{{ item.title }}</h3>
              <p class="tool-desc">{{ item.desc }}</p>
            </div>
          </div>
          <div class="download-form">
            <input
              v-model="videoDownload[item.platform].url"
              class="inp download-input"
              :placeholder="item.placeholder"
              @keyup.enter="downloadPlatformVideo(item.platform)" />
            <button
              class="btn btn-primary"
              :disabled="videoDownload[item.platform].loading"
              @click="downloadPlatformVideo(item.platform)">
              {{ videoDownload[item.platform].loading ? '下载中...' : '下载视频' }}
            </button>
          </div>
          <div v-if="videoDownload[item.platform].error" class="error-inline">
            {{ videoDownload[item.platform].error }}
          </div>
          <div v-if="videoDownload[item.platform].files.length" class="download-result-list">
            <div
              v-for="file in videoDownload[item.platform].files"
              :key="file.url || file.path || file.name"
              class="download-result-row">
              <div class="download-file-meta">
                <span class="file-name">{{ file.name || '视频文件' }}</span>
                <span class="file-size">{{ formatFileSize(file.size) }}</span>
              </div>
              <a class="btn btn-ghost btn-sm" :href="file.download_url || file.url" :download="file.name || true" target="_blank">下载</a>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div v-if="activeTab === 'ncm'" class="tool-section">
      <div class="tool-card">
        <div class="tool-header">
          <span class="tool-icon">🎵</span>
          <div>
            <h3>NCM 转 MP3</h3>
            <p class="tool-desc">拖拽网易云音乐NCM文件到下方区域，自动转换为MP3格式</p>
          </div>
        </div>
        <div
          class="drop-zone"
          :class="{ dragging: isDraggingNcm }"
          @dragover.prevent="isDraggingNcm = true"
          @dragleave="isDraggingNcm = false"
          @drop.prevent="handleNcmDrop">
          <div class="drop-hint">
            <span class="drop-icon">📁</span>
            <span>拖拽 NCM 文件到此处</span>
            <span class="drop-sub">或点击选择文件</span>
          </div>
          <input type="file" accept=".ncm" multiple @change="handleNcmSelect" class="file-input" />
        </div>
        <div v-if="ncmFiles.length" class="file-list">
          <div v-for="(file, i) in ncmFiles" :key="i" class="file-item">
            <span class="file-name">{{ file.name }}</span>
            <span v-if="file.status === 'converting'" class="file-status converting">转换中...</span>
            <span v-else-if="file.status === 'done'" class="file-status done">
              ✅ 完成
              <button class="btn btn-ghost btn-xs" @click="downloadMp3(file)">📥 下载</button>
            </span>
            <span v-else-if="file.status === 'error'" class="file-status error">❌ {{ file.error }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 视频打点分析 -->
    <div v-if="activeTab === 'video'" class="video-page">
      <!-- 左侧：视频区域 -->
      <div class="video-main-area">
        <!-- 视频上传区 -->
        <div
          v-if="!videoFile"
          class="video-upload-full"
          :class="{ 'drag-over': isDraggingVideo }"
          @click="triggerVideoUpload"
          @dragover.prevent="isDraggingVideo = true"
          @dragleave="isDraggingVideo = false"
          @drop.prevent="handleVideoDrop">
          <div class="video-upload-hint">
            <span class="video-upload-icon">📹</span>
            <span class="upload-title">拖拽视频文件到此处</span>
            <span class="upload-sub">支持 MP4、MOV、WEBM 格式</span>
          </div>
          <div v-if="isDraggingVideo" class="drag-overlay">
            <span>📥 释放以导入视频</span>
          </div>
          <input type="file" ref="videoInput" accept="video/*" @change="handleVideoUpload" class="hidden-input" />
        </div>

        <!-- 视频播放器 -->
        <div v-if="videoFile" class="video-player-full"
          @dragover.prevent="isDraggingVideo = true"
          @dragleave="isDraggingVideo = false"
          @drop.prevent="handleVideoDrop">
          <div v-if="isDraggingVideo" class="drag-overlay">
            <span>📥 释放以替换视频</span>
          </div>
          <video
            ref="videoPlayer"
            class="video-player-native"
            :src="videoSrc"
            controls
            @timeupdate="onTimeUpdate"
            @loadedmetadata="onVideoLoaded">
          </video>
        </div>

        <!-- 时间线 -->
        <div v-if="videoFile" class="video-timeline-area">
          <div class="timeline-wrapper" @click="seekToPosition">
            <div class="timeline-track">
              <div class="timeline-progress" :style="{ width: progressPercent + '%' }"></div>
              <div
                v-for="(seg, i) in videoSegments"
                :key="i"
                class="timeline-marker"
                :style="{ left: getMarkerPercent(seg.timestamp) + '%' }"
                :title="seg.timestamp + ': ' + seg.description"
                @click.stop="seekToTimestamp(seg.timestamp)">
              </div>
            </div>
          </div>
          <div class="timeline-labels">
            <span>{{ formatTime(currentTime) }}</span>
            <span>{{ formatTime(videoDuration) }}</span>
          </div>
        </div>

        <!-- 控制按钮 -->
        <div v-if="videoFile" class="video-controls-row">
          <button class="btn btn-ghost" @click="triggerVideoUpload">📤 上传视频</button>
          <button class="btn btn-ghost" @click="clearVideo">🗑️ 清除</button>
          <div class="analyze-form">
            <input
              v-model="analyzeUrl"
              class="inp analyze-input"
              :placeholder="uploadedVideoUrl ? '视频已上传，可直接点击AI打点' : '输入视频链接让AI分析...'"
              @keyup.enter="analyzeVideo" />
            <button class="btn btn-primary" @click="analyzeVideo" :disabled="analyzing || uploadingVideo">
              {{ analyzing ? '分析中...' : uploadingVideo ? '上传中...' : '🚀 AI打点' }}
            </button>
          </div>
        </div>

        <div v-if="uploadingVideo" class="upload-status">
          视频正在上传到服务器，上传完成后才能 AI 打点...
        </div>

        <!-- 加载状态 -->
        <div v-if="analyzing" class="analyzing-bar">
          <div class="analyzing-bar-inner"></div>
          <span>AI 正在分析视频内容...</span>
        </div>

        <!-- 错误信息 -->
        <div v-if="videoError" class="error-inline">
          {{ videoError }}
        </div>
      </div>

      <!-- 右侧：打点列表 -->
      <div class="segments-panel">
        <div class="panel-header">
          <h3>📍 打点列表</h3>
          <div class="segment-badges" v-if="videoSegments.length">
            <span class="segment-count">{{ videoSegments.length }} 个打点</span>
            <span class="segment-count" :class="{ fused: analyzeMeta.transcript_used }">
              {{ analyzeMeta.transcript_used ? '画面+语音' : '仅画面' }}
            </span>
          </div>
        </div>

        <div class="segments-scroll" v-if="videoSegments.length">
          <div
            v-for="(seg, i) in videoSegments"
            :key="i"
            class="segment-item"
            :class="{ active: isCurrentSegment(seg.timestamp) }"
            @click="seekToTimestamp(seg.timestamp)">
            <div class="segment-time">{{ seg.timestamp }}</div>
            <div class="segment-desc">{{ seg.description }}</div>
          </div>
        </div>

        <div v-else class="segments-empty">
          <span v-if="videoFile && !analyzing">暂无打点</span>
          <span v-else-if="!videoFile">请先上传视频</span>
        </div>

        <!-- 选中打点详情 -->
        <div v-if="selectedSegment" class="segment-detail">
          <div class="detail-header">
            <span class="detail-time">{{ selectedSegment.timestamp }}</span>
          </div>
          <div class="detail-content">
            {{ selectedSegment.description }}
          </div>
          <button class="btn btn-sm btn-ghost" @click="jumpToSelected">▶ 跳转到</button>
        </div>
      </div>
    </div>

    <!-- AI剪辑建议 -->
    <div v-if="activeTab === 'ai'" class="ai-page">
      <div class="ai-layout">
        <!-- 左侧：输入区 -->
        <div class="ai-input-section">
          <div class="ai-section-header">
            <span class="section-icon">📝</span>
            <div>
              <h3>视频文案</h3>
              <p>粘贴视频脚本或口播内容</p>
            </div>
          </div>
          <textarea
            v-model="contentText"
            class="ai-textarea"
            placeholder="在此输入视频文案内容，AI将为你生成剪辑建议..."
            :disabled="recommending"></textarea>
          <button class="btn btn-primary ai-analyze-btn" @click="getRecommendations" :disabled="recommending || !contentText.trim()">
            <span v-if="recommending" class="btn-spinner"></span>
            <span v-else>✨</span>
            {{ recommending ? '分析中...' : '开始AI分析' }}
          </button>
        </div>

        <!-- 右侧：结果区 -->
        <div class="ai-results-section">
          <!-- 加载状态 -->
          <div v-if="recommending" class="ai-loading">
            <div class="loading-orb">
              <span></span><span></span><span></span>
            </div>
            <p>AI 正在分析文案...</p>
          </div>

          <!-- 错误状态 -->
          <div v-else-if="recommendations?.error" class="ai-error-state">
            <span class="error-icon">⚠️</span>
            <p>{{ recommendations.error }}</p>
          </div>

          <!-- 结果内容 -->
          <div v-else-if="recommendations" class="ai-results">
            <!-- 分镜脚本 -->
            <div v-if="recommendations.scenes" class="result-block scenes-block">
              <div class="result-header">
                <span class="result-icon">🎬</span>
                <h3>分镜脚本</h3>
              </div>
              <div class="scenes-timeline">
                <div v-for="(s, i) in recommendations.scenes" :key="i" class="scene-item">
                  <div class="scene-marker">{{ s.time }}</div>
                  <div class="scene-content">
                    <div class="scene-visual">{{ s.visual }}</div>
                    <div class="scene-desc">{{ s.description }}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 剪辑技巧 -->
            <div v-if="recommendations.editing_tips" class="result-block tips-block">
              <div class="result-header">
                <span class="result-icon">💡</span>
                <h3>剪辑技巧</h3>
              </div>
              <div class="tips-list">
                <div v-for="(t, i) in recommendations.editing_tips" :key="i" class="tip-card">
                  <span class="tip-num">{{ String(i + 1).padStart(2, '0') }}</span>
                  <span class="tip-text">{{ t }}</span>
                </div>
              </div>
            </div>

            <!-- 精彩亮点 -->
            <div v-if="recommendations.highlights" class="result-block highlights-block">
              <div class="result-header">
                <span class="result-icon">⭐</span>
                <h3>精彩亮点</h3>
              </div>
              <div class="highlights-grid">
                <div v-for="(h, i) in recommendations.highlights" :key="i" class="highlight-card">
                  <span class="highlight-badge">亮点 {{ i + 1 }}</span>
                  <p>{{ h }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-else class="ai-empty">
            <div class="empty-icon">🤖</div>
            <h4>AI 剪辑助手</h4>
            <p>输入视频文案后，AI将为你生成专业的分镜脚本、剪辑技巧和精彩亮点建议</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { callMiniMaxChat, getAuthToken, request } from '../api/client'
import { uploadMaterial, uploadMaterialFile } from '../api/materials'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()

// chunk 方式转换 ArrayBuffer → base64（避免大文件栈溢出）
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < len; i += CHUNK) {
    const chunk = bytes.slice(i, Math.min(i + CHUNK, len))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}
const activeTab = ref('download')
const tabs = [
  { id: 'download', label: '视频下载', icon: '↓' },
  { id: 'ncm', label: 'NCM转MP3', icon: '🎵' },
  { id: 'video', label: '视频打点', icon: '🎬' },
  { id: 'ai', label: 'AI推荐', icon: '✨' },
]

// NCM转MP3
const videoDownloadPanels = [
  {
    platform: 'douyin',
    icon: '抖',
    title: '抖音视频下载',
    desc: '粘贴抖音分享口令、短链或视频链接，下载原视频文件。',
    placeholder: '粘贴抖音链接'
  },
  {
    platform: 'bilibili',
    icon: 'B',
    title: 'B站视频下载',
    desc: '粘贴 B站视频链接、b23 短链或 BV 号，优先下载最高可用清晰度视频文件。',
    placeholder: '粘贴 B站链接 / BV号'
  }
]

const mediaActions = [
  { id: 'download-video', label: '下载原视频', shortLabel: '原视频', desc: '抖音 / B站链接' },
  { id: 'extract-mp3', label: '提取 MP3', shortLabel: 'MP3', desc: '链接或本地文件' },
  { id: 'convert-mp4', label: '转 MP4', shortLabel: 'MP4', desc: 'MOV / WEBM / MKV' },
  { id: 'compress-720p', label: '压缩 720P', shortLabel: '压缩', desc: '适合传输预览' },
  { id: 'cover-jpg', label: '提取封面', shortLabel: '封面', desc: '生成 JPG 首帧' }
]
const mediaFollowupActions = computed(() => mediaActions.filter(action => action.id !== 'download-video'))
const mediaQualityOptions = [
  { id: '1080', label: '1080P', desc: '优先高画质' },
  { id: '720', label: '720P', desc: '更稳更快' }
]

const mediaInput = ref('')
const mediaFileInput = ref(null)
const mediaFile = ref(null)
const mediaFileName = ref('')
const mediaDragging = ref(false)
const mediaBusy = ref(false)
const mediaStatus = ref('')
const mediaError = ref('')
const mediaTasks = ref([])
const selectedMediaAction = ref('download-video')
const selectedMediaQuality = ref('1080')
let mediaTaskSeq = 0

const mediaQueueSummary = computed(() => {
  if (!mediaTasks.value.length) return '等待新任务'
  const running = mediaTasks.value.filter(task => task.status === 'running').length
  const done = mediaTasks.value.filter(task => task.status === 'done').length
  const failed = mediaTasks.value.filter(task => task.status === 'error').length
  if (running) return `${running} 个处理中 · ${done} 个已完成`
  if (failed) return `${done} 个已完成 · ${failed} 个失败`
  return `${done} 个已完成`
})

const selectedMediaActionMeta = computed(() => mediaActions.find(action => action.id === selectedMediaAction.value) || mediaActions[0])
const selectedMediaActionLabel = computed(() => selectedMediaActionMeta.value?.label || '处理任务')
const canRunMediaAction = computed(() => {
  if (mediaBusy.value) return false
  if (mediaFile.value) return selectedMediaAction.value !== 'download-video'
  return Boolean(mediaInput.value.trim())
})
const mediaRunHint = computed(() => {
  if (mediaFile.value && selectedMediaAction.value === 'download-video') return '本地文件不需要下载，请选择转 MP4、提取 MP3、压缩或封面。'
  if (mediaFile.value) return `将处理本地文件：${mediaFileName.value}`
  const count = splitMediaLinks(mediaInput.value).length
  if (count > 1) return `将按顺序处理 ${count} 条链接，结果保留在右侧队列。`
  if (count === 1) return '将处理当前链接，下载和转换过程会进入右侧队列。'
  return '先粘贴链接或拖入文件，再选择处理方式。'
})

function detectMediaSourceLabel(value) {
  const text = String(value || '').trim()
  const count = splitMediaLinks(text).length
  if (count > 1) return `已自动拆出 ${count} 条可处理内容，将按队列顺序处理`
  if (count === 1) {
    const platform = detectDownloadPlatform(splitMediaLinks(text)[0])
    return platform === 'bilibili' ? '已识别：B站链接 / BV 号' : '已识别：抖音链接'
  }
  return text ? '未识别到抖音 / B站链接或 BV 号' : '支持粘贴整段分享文案，也支持拖入本地音视频做格式转换'
}

function selectMediaAction(actionId) {
  if (mediaFile.value && actionId === 'download-video') return
  selectedMediaAction.value = actionId
  mediaError.value = ''
}

function triggerMediaFile() {
  mediaFileInput.value?.click()
}

function setMediaFile(file) {
  if (!file) return
  mediaFile.value = file
  mediaFileName.value = file.name || '本地文件'
  mediaInput.value = ''
  mediaError.value = ''
}

function clearMediaFile() {
  mediaFile.value = null
  mediaFileName.value = ''
  if (mediaFileInput.value) mediaFileInput.value.value = ''
}

function handleMediaFileSelect(e) {
  setMediaFile(e.target.files?.[0])
}

function handleMediaDrop(e) {
  mediaDragging.value = false
  setMediaFile(e.dataTransfer?.files?.[0])
}

function detectDownloadPlatform(value) {
  const text = String(value || '').trim()
  if (/bilibili\.com|b23\.tv|\bBV[0-9A-Za-z]{8,}\b/i.test(text)) return 'bilibili'
  if (/douyin\.com|iesdouyin\.com|v\.douyin\.com/i.test(text)) return 'douyin'
  return ''
}

function normalizeResultFiles(result) {
  const files = Array.isArray(result.files) ? result.files : (result.file ? [result.file] : [])
  return files.map(file => {
    if (!file || typeof file !== 'object') return file
    if (file.download_url || !file.url || !file.mtime) return file
    return { ...file, download_url: `${file.url}${file.url.includes('?') ? '&' : '?'}v=${file.mtime}` }
  })
}

function mediaActionLabel(actionId) {
  return mediaActions.find(action => action.id === actionId)?.label || '处理任务'
}

function mediaTaskStatusText(task) {
  if (task.status === 'done') return '完成'
  if (task.status === 'error') return '失败'
  if (task.status === 'pending') return '排队'
  return '处理中'
}

function createMediaTask(actionId, sourceLabel, title) {
  const task = {
    id: ++mediaTaskSeq,
    actionId,
    title: title || mediaActionLabel(actionId),
    sourceLabel: sourceLabel || '本地输入',
    status: 'pending',
    statusText: '等待处理',
    error: '',
    files: []
  }
  mediaTasks.value.unshift(task)
  return task
}

function updateMediaTask(task, patch = {}) {
  Object.assign(task, patch)
}

function clearMediaTasks() {
  if (mediaBusy.value) return
  mediaTasks.value = []
}

function cleanMediaToken(value) {
  return String(value || '')
    .trim()
    .replace(/^[\s"'“”‘’<>()\[\]【】]+|[\s"'“”‘’<>()\[\]【】，。！？!?；;、]+$/g, '')
}

function normalizeMediaInputToken(value) {
  const token = cleanMediaToken(value)
  const bvid = token.match(/\bBV[0-9A-Za-z]{8,}\b/i)?.[0]
  if (bvid && !/^https?:\/\//i.test(token)) return bvid
  return token
}

function splitMediaLinks(value) {
  const text = String(value || '')
  const results = []
  const seen = new Set()
  const seenBvid = new Set()
  const add = item => {
    const normalized = normalizeMediaInputToken(item)
    const platform = detectDownloadPlatform(normalized)
    if (!normalized || !platform) return
    const bvid = normalized.match(/\bBV[0-9A-Za-z]{8,}\b/i)?.[0]
    if (platform === 'bilibili' && bvid) {
      const bvidKey = bvid.toLowerCase()
      if (seenBvid.has(bvidKey)) return
      seenBvid.add(bvidKey)
    }
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    results.push(normalized)
  }

  const urlPattern = /https?:\/\/[^\s"'“”‘’<>，。！？!?；;、)）\]}】]+/gi
  for (const match of text.matchAll(urlPattern)) add(match[0])

  const bvPattern = /\bBV[0-9A-Za-z]{8,}\b/gi
  for (const match of text.matchAll(bvPattern)) add(match[0])

  if (!results.length) {
    text.split(/[\r\n]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(add)
  }
  return results
}

async function uploadMediaSourceIfNeeded() {
  if (!mediaFile.value) return ''
  mediaStatus.value = '上传文件中...'
  const result = await uploadMaterialFile({
    file: mediaFile.value,
    type: mediaFile.value.type.startsWith('audio/') ? 'audio' : 'video'
  })
  return result.url || result.download_url || `/uploads/${result.type || 'video'}/${result.filename}`
}

async function downloadVideoSource(url, task) {
  const platform = detectDownloadPlatform(url)
  if (!platform) throw new Error('请粘贴抖音或 B站视频链接')
  mediaStatus.value = platform === 'douyin' ? '下载抖音视频中...' : '下载 B站视频中...'
  if (task) updateMediaTask(task, {
    status: 'running',
    statusText: platform === 'douyin' ? '正在下载抖音原视频' : '正在下载 B站原视频'
  })
  const result = await request('/api/posttools/video-download', {
    method: 'POST',
    body: { platform, url: String(url || '').trim(), quality: selectedMediaQuality.value }
  })
  const files = normalizeResultFiles(result)
  if (!result.ok || !files.length) throw new Error(result.error || '视频下载失败')
  return files
}

async function convertMediaSource(actionId, sourceUrl, task) {
  const action = mediaActions.find(item => item.id === actionId)
  mediaStatus.value = action ? `${action.label}处理中...` : '处理文件中...'
  if (task) updateMediaTask(task, {
    status: 'running',
    statusText: action ? `正在${action.label}` : '正在处理文件'
  })
  const result = await request('/api/posttools/media-convert', {
    method: 'POST',
    body: { action: actionId, source: sourceUrl }
  })
  const files = normalizeResultFiles(result)
  if (!result.ok || !files.length) throw new Error(result.error || '处理失败')
  return files
}

async function runMediaAction(actionId) {
  if (!canRunMediaAction.value) {
    mediaError.value = mediaRunHint.value
    showToast(mediaError.value, 'warn')
    return
  }
  selectedMediaAction.value = actionId
  mediaError.value = ''
  mediaBusy.value = true
  try {
    if (mediaFile.value) {
      const task = createMediaTask(actionId, mediaFileName.value, mediaFileName.value)
      updateMediaTask(task, { status: 'running', statusText: '正在上传本地文件' })
      const sourceUrl = await uploadMediaSourceIfNeeded()
      if (!sourceUrl) throw new Error('本地文件上传失败')
      const files = actionId === 'download-video'
        ? [{ name: mediaFileName.value, url: sourceUrl, type: mediaFile.value.type.startsWith('audio/') ? 'audio' : 'video', size: mediaFile.value.size }]
        : await convertMediaSource(actionId, sourceUrl, task)
      updateMediaTask(task, { status: 'done', statusText: '已生成文件', files })
      showToast('处理完成', 'success')
      return
    }

    const links = splitMediaLinks(mediaInput.value)
    if (!links.length) throw new Error('请先粘贴链接或拖入文件')

    let doneCount = 0
    for (const link of links) {
      const task = createMediaTask(actionId, link, link)
      try {
        if (actionId === 'download-video') {
          const files = await downloadVideoSource(link, task)
          updateMediaTask(task, { status: 'done', statusText: '原视频已保存', files })
        } else if (detectDownloadPlatform(link)) {
          const downloadedFiles = await downloadVideoSource(link, task)
          const firstVideo = downloadedFiles.find(file => file.url) || downloadedFiles[0]
          const sourceUrl = firstVideo?.url || ''
          if (!sourceUrl) throw new Error('下载完成但没有拿到可处理文件')
          const files = await convertMediaSource(actionId, sourceUrl, task)
          updateMediaTask(task, { status: 'done', statusText: '已生成文件', files })
        } else {
          const files = await convertMediaSource(actionId, link, task)
          updateMediaTask(task, { status: 'done', statusText: '已生成文件', files })
        }
        doneCount += 1
      } catch (taskError) {
        updateMediaTask(task, { status: 'error', statusText: '', error: taskError.message || '处理失败' })
      }
    }
    if (!doneCount) throw new Error('队列任务全部失败')
    showToast(links.length > 1 ? `队列完成 ${doneCount}/${links.length}` : '处理完成', 'success')
  } catch (e) {
    mediaError.value = e.message || '处理失败'
    showToast(mediaError.value, 'error')
  } finally {
    mediaBusy.value = false
    mediaStatus.value = ''
  }
}

async function runMediaFollowup(actionId, file, parentTask) {
  if (!file?.url || mediaBusy.value) return
  selectedMediaAction.value = actionId
  mediaError.value = ''
  mediaBusy.value = true
  const task = createMediaTask(actionId, file.url, file.name || parentTask?.title || '处理结果')
  try {
    const files = await convertMediaSource(actionId, file.url, task)
    updateMediaTask(task, { status: 'done', statusText: '已生成文件', files })
    showToast('处理完成', 'success')
  } catch (e) {
    updateMediaTask(task, { status: 'error', statusText: '', error: e.message || '处理失败' })
    mediaError.value = e.message || '处理失败'
    showToast(mediaError.value, 'error')
  } finally {
    mediaBusy.value = false
    mediaStatus.value = ''
  }
}

const videoDownload = {
  douyin: makeVideoDownloadState(),
  bilibili: makeVideoDownloadState()
}

function makeVideoDownloadState() {
  return {
    url: '',
    loading: false,
    error: '',
    files: []
  }
}

function formatFileSize(size) {
  const n = Number(size) || 0
  if (!n) return ''
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

async function downloadPlatformVideo(platform) {
  const state = videoDownload[platform]
  const url = state.url.trim()
  if (!url) {
    showToast(platform === 'douyin' ? '请先粘贴抖音链接' : '请先粘贴 B站链接', 'error')
    return
  }
  state.loading = true
  state.error = ''
  state.files = []
  try {
    const result = await request('/api/posttools/video-download', {
      method: 'POST',
      body: { platform, url, quality: selectedMediaQuality.value }
    })
    state.files = Array.isArray(result.files) ? result.files : []
    if (!result.ok || !state.files.length) throw new Error(result.error || '视频下载失败')
    showToast('视频下载完成', 'success')
  } catch (e) {
    state.error = e.message || '视频下载失败'
    showToast(state.error, 'error')
  } finally {
    state.loading = false
  }
}

const isDraggingNcm = ref(false)
const ncmFiles = ref([])
function handleNcmDrop(e) {
  isDraggingNcm.value = false
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.ncm'))
  if (!files.length) {
    showToast('请拖拽 NCM 文件', 'error')
    return
  }
  processNcmFiles(files)
}

function handleNcmSelect(e) {
  const files = Array.from(e.target.files).filter(f => f.name.endsWith('.ncm'))
  if (files.length) processNcmFiles(files)
}

function downloadMp3(file) {
  if (!file.mp3Path) return;
  const url = file.mp3Path.startsWith('/') ? file.mp3Path : '/uploads/audio/' + file.mp3Path;
  window.open(url, '_blank');
}

async function processNcmFiles(files) {
  for (const file of files) {
    const fileName = file.name
    const idx = ncmFiles.value.length
    // 先插入占位项
    ncmFiles.value.push({ name: fileName, status: 'converting', error: '', mp3Path: '' })

    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = getAuthToken()

      const result = await fetch('/api/posttools/ncm-convert', {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: formData
      }).then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data.error || data.ok === false) {
          throw new Error(data.error || 'NCM 转换失败')
        }
        return data
      })

      if (result.ok) {
        // splice 强制替换触发 Vue 重渲染
        ncmFiles.value.splice(idx, 1, { name: fileName, status: 'done', error: '', mp3Path: result.mp3_path || '' })
        showToast(`${fileName} 转换完成，已生成 MP3`, 'success')
      } else {
        ncmFiles.value.splice(idx, 1, { name: fileName, status: 'error', error: result.error || '转换失败', mp3Path: '' })
      }
    } catch (e) {
      ncmFiles.value.splice(idx, 1, { name: fileName, status: 'error', error: e.message, mp3Path: '' })
    }
  }
}

// 视频打点分析
const videoFile = ref(null)
const videoSrc = ref('')
const videoPlayer = ref(null)
const videoInput = ref(null)
const analyzing = ref(false)
const uploadingVideo = ref(false)
const isDraggingVideo = ref(false)
const videoError = ref('')
const videoSegments = ref([])
const analyzeMeta = ref({})
const currentTime = ref(0)
const videoDuration = ref(0)
const analyzeUrl = ref('')
const uploadedVideoUrl = ref('')
const selectedSegment = ref(null)

const progressPercent = computed(() => {
  if (!videoDuration.value) return 0
  return (currentTime.value / videoDuration.value) * 100
})

function triggerVideoUpload() {
  videoInput.value?.click()
}

async function handleVideoUpload(e) {
  const file = e.target.files?.[0]
  if (file) {
    videoFile.value = file
    videoSrc.value = URL.createObjectURL(file)
    videoSegments.value = []
    analyzeMeta.value = {}
    videoError.value = ''
    uploadedVideoUrl.value = ''
    analyzeUrl.value = ''
    // 上传视频到服务器
    uploadingVideo.value = true
    try {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = arrayBufferToBase64(arrayBuffer)
      const result = await uploadMaterial({
        file_base64: base64,
        filename: file.name,
        size: file.size,
        type: 'video'
      })
      if (result.id) {
        uploadedVideoUrl.value = `/uploads/${result.type || 'video'}/${result.filename}`
        analyzeUrl.value = uploadedVideoUrl.value
        showToast('视频已上传，可点击AI打点', 'success')
      } else {
        throw new Error(result.error || '上传接口未返回素材ID')
      }
    } catch (err) {
      showToast('视频上传失败: ' + err.message, 'warn')
    } finally {
      uploadingVideo.value = false
    }
  }
}

async function handleVideoDrop(e) {
  isDraggingVideo.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('video/')) {
    if (videoSrc.value) URL.revokeObjectURL(videoSrc.value)
    videoFile.value = file
    videoSrc.value = URL.createObjectURL(file)
    videoSegments.value = []
    analyzeMeta.value = {}
    videoError.value = ''
    uploadedVideoUrl.value = ''
    analyzeUrl.value = ''
    // 上传视频到服务器
    uploadingVideo.value = true
    try {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = arrayBufferToBase64(arrayBuffer)
      const result = await uploadMaterial({
        file_base64: base64,
        filename: file.name,
        size: file.size,
        type: 'video'
      })
      if (result.id) {
        uploadedVideoUrl.value = `/uploads/${result.type || 'video'}/${result.filename}`
        analyzeUrl.value = uploadedVideoUrl.value
        showToast('视频已上传，可点击AI打点', 'success')
      } else {
        throw new Error(result.error || '上传接口未返回素材ID')
      }
    } catch (err) {
      showToast('视频上传失败: ' + err.message, 'warn')
    } finally {
      uploadingVideo.value = false
    }
  }
}

function clearVideo() {
  if (videoSrc.value) {
    URL.revokeObjectURL(videoSrc.value)
  }
  videoFile.value = null
  videoSrc.value = ''
  videoSegments.value = []
  analyzeMeta.value = {}
  videoError.value = ''
  uploadedVideoUrl.value = ''
  analyzeUrl.value = ''
  uploadingVideo.value = false
}

function onVideoLoaded() {
  if (videoPlayer.value) {
    videoDuration.value = videoPlayer.value.duration
  }
}

function onTimeUpdate() {
  if (videoPlayer.value) {
    currentTime.value = videoPlayer.value.currentTime
  }
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function getMarkerPercent(timestamp) {
  // Parse timestamp like "0:00-0:30" or "0:30"
  const match = timestamp.match(/(\d+):(\d+)/)
  if (!match) return 0
  const mins = parseInt(match[1])
  const secs = parseInt(match[2])
  const totalSecs = mins * 60 + secs
  if (!videoDuration.value) return 0
  return (totalSecs / videoDuration.value) * 100
}

function seekToTimestamp(timestamp) {
  const match = timestamp.match(/(\d+):(\d+)/)
  if (!match || !videoPlayer.value) return
  const mins = parseInt(match[1])
  const secs = parseInt(match[2])
  videoPlayer.value.currentTime = mins * 60 + secs
  // 设置选中的打点
  const seg = videoSegments.value.find(s => s.timestamp === timestamp)
  if (seg) selectedSegment.value = seg
}

function jumpToSelected() {
  if (selectedSegment.value) {
    seekToTimestamp(selectedSegment.value.timestamp)
  }
}

function seekToPosition(e) {
  if (!videoPlayer.value || !videoDuration.value) return
  const rect = e.currentTarget.getBoundingClientRect()
  const percent = (e.clientX - rect.left) / rect.width
  videoPlayer.value.currentTime = percent * videoDuration.value
}

function isCurrentSegment(timestamp) {
  const match = timestamp.match(/(\d+):(\d+)/)
  if (!match) return false
  const mins = parseInt(match[1])
  const secs = parseInt(match[2])
  const segStart = mins * 60 + secs
  // Mark as active if current time is within 5 seconds of segment start
  return Math.abs(currentTime.value - segStart) < 5
}

async function analyzeVideo() {
  const url = uploadedVideoUrl.value || analyzeUrl.value.trim()
  if (!url) {
    showToast(uploadingVideo.value ? '视频还在上传，请稍等' : '请先上传视频或输入视频链接', 'error')
    return
  }
  analyzing.value = true
  videoError.value = ''
  analyzeMeta.value = {}

  try {
    const result = await request('/api/posttools/video-analyze', {
      method: 'POST',
      body: { url: url, provider: 'siliconflow' }
    })

    if (result.error) {
      videoError.value = result.error
      showToast(result.error, 'error')
    } else if (result.segments) {
      videoSegments.value = result.segments
      analyzeMeta.value = result.meta || {}
      showToast('分析完成', 'success')
    } else {
      videoError.value = '分析结果格式异常'
      showToast('分析结果格式异常', 'error')
    }
  } catch (e) {
    videoError.value = e.message
    showToast('分析失败: ' + e.message, 'error')
  } finally {
    analyzing.value = false
  }
}

// AI剪辑建议
const contentText = ref('')
const recommending = ref(false)
const recommendations = ref(null)

async function getRecommendations() {
  if (!contentText.value.trim()) {
    showToast('请输入文案内容', 'error')
    return
  }
  recommending.value = true
  recommendations.value = null

  try {
    const response = await request('/api/posttools/ai-recommend', {
      method: 'POST',
      body: { text: contentText.value }
    })

    if (response.error) {
      recommendations.value = { error: response.error }
      showToast(response.error, 'error')
    } else {
      recommendations.value = response
      showToast('分析完成', 'success')
    }
  } catch (e) {
    recommendations.value = { error: e.message }
    showToast('分析失败: ' + e.message, 'error')
  } finally {
    recommending.value = false
  }
}
</script>

<style scoped>
.posttools-module {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
}

.posttools-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  padding: 4px;
  background: var(--surface2, #1e1e3a);
  border-radius: 10px;
  width: fit-content;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted, #888);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: var(--text, #e0d8ff);
}

.tab-btn.active {
  background: var(--primary, #7b2fff);
  color: #fff;
}

.tab-icon {
  font-size: 16px;
}

.tool-section {
  max-width: 100%;
}

.tool-card {
  background: var(--panel-bg, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
  padding: 20px;
}

.video-download-section {
  max-width: 1180px;
}

.media-workbench {
  max-width: 100%;
}

.media-console {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
  min-height: calc(100vh - 180px);
  background:
    linear-gradient(135deg, rgba(123, 47, 255, 0.10), transparent 34%),
    linear-gradient(180deg, var(--card-bg, var(--panel-bg)), var(--panel-bg, #12122a));
}

.media-console-header {
  margin-bottom: 0;
  align-items: center;
}

.media-workbench-grid {
  display: grid;
  grid-template-columns: minmax(460px, 1fr) minmax(380px, 520px);
  gap: 16px;
  align-items: stretch;
  flex: 1;
  min-height: 0;
}

.media-composer,
.media-queue-panel {
  min-width: 0;
}

.media-composer {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.media-flow-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.media-flow-strip span {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--chip-border, var(--border));
  border-radius: 8px;
  background: rgba(255,255,255,0.04);
  color: var(--text-dim, #aaa);
  font-size: 12px;
  font-weight: 650;
}

.media-drop-zone {
  border: 1px dashed var(--card-border, var(--border));
  background:
    linear-gradient(180deg, rgba(255,255,255,0.05), transparent),
    var(--row-bg, var(--surface2));
  border-radius: 12px;
  padding: 16px;
  transition: border-color .2s, background .2s, box-shadow .2s;
}

.media-drop-zone.dragging {
  border-color: var(--primary, #7b2fff);
  background: var(--accent-soft, rgba(123, 47, 255, .1));
  box-shadow: 0 0 0 3px rgba(123, 47, 255, .10);
}

.media-input-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.media-link-input {
  flex: 1;
  resize: vertical;
  min-height: 150px;
  line-height: 1.55;
}

.media-pick-btn {
  min-width: 116px;
}

.media-source-line {
  margin-top: 8px;
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted, #888);
}

.media-clear-btn {
  border: 0;
  background: transparent;
  color: var(--primary-light, #b47fff);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 0;
}

.media-action-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.media-action {
  border: 1px solid var(--chip-border, var(--border));
  background:
    linear-gradient(180deg, rgba(255,255,255,0.05), transparent),
    var(--row-bg, var(--surface2));
  color: var(--text, #e0d8ff);
  border-radius: 10px;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  min-height: 72px;
  transition: transform .18s, border-color .18s, background .18s, box-shadow .18s;
}

.media-action:hover,
.media-action.active {
  border-color: var(--primary, #7b2fff);
  background: var(--accent-soft, rgba(123, 47, 255, .12));
}

.media-action:hover {
  transform: translateY(-1px);
}

.media-action.active {
  box-shadow: inset 0 0 0 1px rgba(123, 47, 255, .18);
}

.media-action:disabled {
  cursor: not-allowed;
  opacity: .72;
  transform: none;
}

.media-action-title,
.media-action-desc {
  display: block;
}

.media-action-title {
  font-size: 13px;
  font-weight: 700;
}

.media-action-desc {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted, #888);
}

.media-quality-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.media-quality-option {
  border: 1px solid var(--chip-border, var(--border));
  background: var(--row-bg, var(--surface2));
  color: var(--text, #e0d8ff);
  border-radius: 10px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  min-height: 56px;
}

.media-quality-option.active {
  border-color: var(--primary, #7b2fff);
  background: var(--accent-soft, rgba(123, 47, 255, .12));
}

.media-quality-option:disabled {
  cursor: not-allowed;
  opacity: .72;
}

.media-quality-option span,
.media-quality-option small {
  display: block;
}

.media-quality-option span {
  font-size: 13px;
  font-weight: 750;
}

.media-quality-option small {
  margin-top: 3px;
  color: var(--text-muted, #888);
  font-size: 11px;
}

.media-results {
  margin-top: 0;
}

.media-submit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
  background:
    linear-gradient(90deg, var(--accent-soft, rgba(123, 47, 255, .12)), transparent),
    rgba(255,255,255,0.035);
}

.media-submit-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.media-submit-copy strong {
  color: var(--text, #e0d8ff);
  font-size: 14px;
}

.media-submit-copy span {
  color: var(--text-muted, #888);
  font-size: 12px;
  line-height: 1.45;
}

.media-start-btn {
  min-width: 120px;
  white-space: nowrap;
}

.media-queue-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
  padding: 14px;
  background: rgba(255,255,255,0.035);
  min-height: 420px;
}

.media-queue-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--divider, var(--border));
}

.media-queue-head h4 {
  margin: 0;
  color: var(--text, #e0d8ff);
  font-size: 15px;
}

.media-queue-head p {
  margin: 4px 0 0;
  color: var(--text-muted, #888);
  font-size: 12px;
}

.media-empty-queue {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  text-align: center;
  border: 1px dashed var(--border, #2a2a4a);
  border-radius: 10px;
  color: var(--text-muted, #888);
  padding: 24px;
}

.media-empty-queue strong {
  color: var(--text, #e0d8ff);
}

.media-task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  padding-right: 2px;
}

.media-task {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 10px;
  padding: 12px;
  background: var(--row-bg, var(--surface2));
}

.media-task.done {
  border-color: rgba(34, 197, 94, .28);
}

.media-task.error {
  border-color: rgba(239, 68, 68, .34);
}

.media-task.running {
  border-color: rgba(123, 47, 255, .45);
}

.media-task-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.media-task-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft, rgba(123, 47, 255, .12));
  color: var(--primary-light, #b47fff);
  font-size: 11px;
  font-weight: 700;
}

.media-task.done .media-task-badge {
  background: rgba(34, 197, 94, .12);
  color: #22c55e;
}

.media-task.error .media-task-badge {
  background: rgba(239, 68, 68, .12);
  color: #ef4444;
}

.media-task-action,
.media-task-note,
.media-task-source {
  color: var(--text-muted, #888);
  font-size: 12px;
}

.media-task-title {
  color: var(--text, #e0d8ff);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  word-break: break-all;
}

.media-task-source {
  word-break: break-all;
}

.media-task-progress {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface3, #2a2a4a);
}

.media-task-progress span {
  display: block;
  width: 38%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--primary, #7b2fff), var(--primary-light, #b47fff));
  animation: media-progress 1.1s ease-in-out infinite;
}

@keyframes media-progress {
  0% { transform: translateX(-110%); }
  100% { transform: translateX(280%); }
}

.download-result-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

.download-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.video-download-card {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.video-download-card.douyin {
  border-color: rgba(34, 211, 238, 0.28);
}

.video-download-card.bilibili {
  border-color: rgba(96, 165, 250, 0.28);
}

.download-form {
  display: flex;
  gap: 10px;
  align-items: center;
}

.download-input {
  flex: 1;
  min-width: 0;
}

.download-result-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.download-result-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--surface2, #1e1e3a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
}

.download-file-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.file-size {
  font-size: 11px;
  color: var(--text-muted, #888);
}

.tool-header {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.tool-icon {
  font-size: 28px;
}

.tool-header h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  color: var(--text, #e0d8ff);
}

.tool-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #888);
}

.drop-zone {
  border: 2px dashed var(--border, #2a2a4a);
  border-radius: 10px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
  margin-bottom: 16px;
}

.drop-zone:hover,
.drop-zone.dragging {
  border-color: var(--primary, #7b2fff);
  background: rgba(123, 47, 255, 0.1);
}

.drop-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted, #888);
}

.drop-icon {
  font-size: 32px;
}

.drop-sub {
  font-size: 11px;
  color: var(--text-dim, #666);
}

.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--surface2, #1e1e3a);
  border-radius: 6px;
  font-size: 12px;
}

.file-name {
  color: var(--text, #e0d8ff);
  word-break: break-all;
}

.file-status {
  flex-shrink: 0;
  margin-left: 8px;
}

.file-status.done {
  color: #22c55e;
  display: flex;
  align-items: center;
}

.file-status.error {
  color: #ef4444;
}

.file-status.converting {
  color: var(--primary, #7b2fff);
}

.input-group {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.url-input {
  flex: 1;
}

.or-divider {
  text-align: center;
  margin: 12px 0;
  position: relative;
  color: var(--text-muted, #888);
  font-size: 11px;
}

.or-divider::before,
.or-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 40%;
  height: 1px;
  background: var(--border, #2a2a4a);
}

.or-divider::before { left: 0; }
.or-divider::after { right: 0; }

.upload-area {
  text-align: center;
}

.hidden-input {
  display: none;
}

.result-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border, #2a2a4a);
}

.result-section h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: var(--primary-light, #b47fff);
}

.segments-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.segment-item {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  background: var(--surface2, #1e1e3a);
  border-radius: 6px;
  font-size: 12px;
}

.seg-time {
  color: var(--primary, #7b2fff);
  font-weight: 600;
  flex-shrink: 0;
}

.seg-desc {
  color: var(--text, #e0d8ff);
}

.content-input {
  width: 100%;
  resize: vertical;
  min-height: 100px;
  margin-bottom: 12px;
}

.recommendations {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border, #2a2a4a);
}

.rec-section {
  margin-bottom: 16px;
}

.rec-section h4 {
  margin: 0 0 10px 0;
  font-size: 13px;
  color: var(--primary-light, #b47fff);
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rec-tag {
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 12px;
  cursor: pointer;
  transition: transform 0.15s;
}

.rec-tag:hover {
  transform: scale(1.05);
}

.image-tag {
  background: rgba(123, 47, 255, 0.2);
  color: #b47fff;
  border: 1px solid rgba(123, 47, 255, 0.3);
}

.music-tag {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.error-msg {
  color: #ef4444;
  font-size: 12px;
  padding: 12px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 6px;
}

.loading-placeholder {
  color: var(--text-muted, #888);
  font-size: 12px;
  white-space: pre-wrap;
}

/* 视频打点分析样式 */
.video-upload-area {
  border: 2px dashed var(--border, #2a2a4a);
  border-radius: 10px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 16px;
}

.video-upload-area:hover {
  border-color: var(--primary, #7b2fff);
  background: rgba(123, 47, 255, 0.05);
}

.video-upload-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted, #888);
}

.video-upload-icon {
  font-size: 36px;
}

.video-upload-sub {
  font-size: 11px;
  color: var(--text-dim, #666);
}

.video-player-wrapper {
  margin-bottom: 16px;
}

.video-player {
  width: 100%;
  border-radius: 8px;
  background: #000;
  max-height: 400px;
}

.video-timeline {
  position: relative;
  height: 8px;
  background: var(--surface2, #1e1e3a);
  border-radius: 4px;
  margin-top: 8px;
  cursor: pointer;
  overflow: visible;
}

.timeline-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--primary, #7b2fff);
  border-radius: 4px;
  transition: width 0.1s;
}

.timeline-marker {
  position: absolute;
  top: -4px;
  width: 12px;
  height: 12px;
  background: #f59e0b;
  border: 2px solid #fff;
  border-radius: 50%;
  transform: translateX(-50%);
  cursor: pointer;
  z-index: 2;
}

.timeline-marker:hover {
  background: #fbbf24;
  transform: translateX(-50%) scale(1.2);
}

.video-time-display {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted, #888);
}

.video-analyze-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border, #2a2a4a);
}

.analyze-hint {
  font-size: 12px;
  color: var(--text-muted, #888);
  margin-bottom: 8px;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 12px;
}
.btn-xs {
  padding: 2px 8px;
  font-size: 11px;
  margin-left: 8px;
}

.segments-table {
  margin-top: 16px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  overflow: hidden;
}

.segments-table-header {
  display: flex;
  padding: 10px 12px;
  background: var(--surface2, #1e1e3a);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #888);
  border-bottom: 1px solid var(--border, #2a2a4a);
}

.segments-table-row {
  display: flex;
  padding: 10px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border, #2a2a4a);
  cursor: pointer;
  transition: background 0.15s;
}

.segments-table-row:last-child {
  border-bottom: none;
}

.segments-table-row:hover {
  background: rgba(123, 47, 255, 0.1);
}

.segments-table-row.active {
  background: rgba(123, 47, 255, 0.15);
}

.col-time {
  width: 80px;
  flex-shrink: 0;
  color: var(--primary, #7b2fff);
  font-weight: 600;
}

.col-desc {
  flex: 1;
  color: var(--text, #e0d8ff);
}

.analyzing-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  color: var(--text-muted, #888);
  font-size: 13px;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border, #2a2a4a);
  border-top-color: var(--primary, #7b2fff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.hidden-input {
  display: none;
}

/* ============ 视频打点分析大布局 ============ */
.video-page {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 16px;
  height: 100%;
  overflow: hidden;
}

.video-main-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.video-upload-full {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--border, #2a2a4a);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--surface2, #1e1e3a);
}

.video-upload-full:hover, .video-upload-full.drag-over {
  border-color: var(--primary, #7b2fff);
  background: rgba(123, 47, 255, 0.08);
}

.video-upload-full.drag-over .video-upload-hint {
  opacity: 0.3;
}

.video-upload-full .video-upload-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--text-muted, #888);
}

.video-upload-full .video-upload-icon {
  font-size: 64px;
}

.video-upload-full .upload-title {
  font-size: 18px;
  color: var(--text, #e0d8ff);
}

.video-upload-full .upload-sub {
  font-size: 12px;
  color: var(--text-dim, #666);
}

.video-player-full {
  flex: 1;
  min-height: 0;
  background: #000;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.video-player-native {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(123, 47, 255, 0.25);
  border: 3px dashed var(--primary, #7b2fff);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  pointer-events: none;
}

.drag-overlay span {
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  background: rgba(123, 47, 255, 0.85);
  padding: 12px 24px;
  border-radius: 10px;
}

.video-timeline-area {
  flex-shrink: 0;
}

.timeline-wrapper {
  padding: 8px 0;
  cursor: pointer;
}

.timeline-track {
  position: relative;
  height: 10px;
  background: var(--surface2, #1e1e3a);
  border-radius: 5px;
  overflow: visible;
}

.timeline-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: linear-gradient(90deg, var(--primary, #7b2fff), #9f7aea);
  border-radius: 5px;
  transition: width 0.1s;
}

.timeline-marker {
  position: absolute;
  top: -5px;
  width: 20px;
  height: 20px;
  background: #f59e0b;
  border: 3px solid #fff;
  border-radius: 50%;
  transform: translateX(-50%);
  cursor: pointer;
  z-index: 2;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.timeline-marker:hover {
  background: #fbbf24;
  transform: translateX(-50%) scale(1.15);
}

.timeline-labels {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 11px;
  color: var(--text-muted, #888);
}

.video-controls-row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.analyze-form {
  display: flex;
  gap: 8px;
  flex: 1;
  margin-left: auto;
}

.analyze-input {
  flex: 1;
  min-width: 200px;
}

.upload-status {
  padding: 8px 12px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: 8px;
  font-size: 12px;
  color: #f59e0b;
}

.analyzing-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(123, 47, 255, 0.1);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-muted, #888);
}

.analyzing-bar-inner {
  width: 100px;
  height: 4px;
  background: var(--surface2, #1e1e3a);
  border-radius: 2px;
  overflow: hidden;
  animation: analyzing-pulse 1.5s ease-in-out infinite;
}

@keyframes analyzing-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.error-inline {
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 6px;
  font-size: 12px;
  color: #ef4444;
}

/* ============ 右侧打点面板 ============ */
.segments-panel {
  background: var(--panel-bg, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border, #2a2a4a);
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  color: var(--text, #e0d8ff);
}

.segment-badges {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.segment-count {
  font-size: 11px;
  color: var(--text-muted, #888);
  background: var(--surface2, #1e1e3a);
  padding: 2px 8px;
  border-radius: 10px;
}

.segment-count.fused {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.12);
}

.segments-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.segments-scroll::-webkit-scrollbar {
  width: 6px;
}

.segments-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.segments-scroll::-webkit-scrollbar-thumb {
  background: var(--border, #2a2a4a);
  border-radius: 3px;
}

.segment-item {
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid var(--border, #2a2a4a);
}

.segment-item:last-child {
  border-bottom: none;
}

.segment-item:hover {
  background: rgba(123, 47, 255, 0.08);
}

.segment-item.active {
  background: rgba(123, 47, 255, 0.15);
  border-left: 3px solid var(--primary, #7b2fff);
}

.segment-time {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary, #7b2fff);
  margin-bottom: 4px;
}

.segment-desc {
  font-size: 12px;
  color: var(--text, #e0d8ff);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.segments-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim, #666);
  font-size: 13px;
}

.segment-detail {
  padding: 16px;
  border-top: 1px solid var(--border, #2a2a4a);
  background: var(--surface2, #1e1e3a);
}

.detail-header {
  margin-bottom: 8px;
}

.detail-time {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary, #7b2fff);
}

.detail-content {
  font-size: 12px;
  color: var(--text, #e0d8ff);
  line-height: 1.5;
  margin-bottom: 12px;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 12px;
}
.btn-xs {
  padding: 2px 8px;
  font-size: 11px;
  margin-left: 8px;
}

/* ============ AI剪辑建议页面 ============ */
.ai-page {
  height: 100%;
  overflow: hidden;
}

.ai-layout {
  display: grid;
  grid-template-columns: 400px 1fr;
  gap: 20px;
  height: 100%;
  overflow: hidden;
}

/* 左侧输入区 */
.ai-input-section {
  display: flex;
  flex-direction: column;
  background: var(--panel-bg, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 16px;
  padding: 20px;
  overflow: hidden;
}

.ai-section-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.section-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.ai-section-header h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text, #e0d8ff);
}

.ai-section-header p {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #888);
}

.ai-textarea {
  flex: 1;
  min-height: 200px;
  padding: 16px;
  background: var(--surface2, #1e1e3a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
  color: var(--text, #e0d8ff);
  font-size: 14px;
  font-family: inherit;
  line-height: 1.7;
  resize: none;
}

.ai-textarea:focus {
  outline: none;
  border-color: var(--primary, #7b2fff);
  box-shadow: 0 0 0 3px rgba(123, 47, 255, 0.15);
}

.ai-textarea::placeholder {
  color: var(--text-dim, #666);
}

.ai-analyze-btn {
  margin-top: 16px;
  padding: 14px 24px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
}

.ai-analyze-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(123, 47, 255, 0.4);
}

/* 右侧结果区 */
.ai-results-section {
  display: flex;
  flex-direction: column;
  background: var(--panel-bg, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 16px;
  padding: 20px;
  overflow: hidden;
}

/* 加载状态 */
.ai-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.loading-orb {
  display: flex;
  gap: 8px;
}

.loading-orb span {
  width: 12px;
  height: 12px;
  background: var(--primary, #7b2fff);
  border-radius: 50%;
  animation: orb-bounce 1.4s ease-in-out infinite;
}

.loading-orb span:nth-child(1) { animation-delay: -0.32s; }
.loading-orb span:nth-child(2) { animation-delay: -0.16s; }

@keyframes orb-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

.ai-loading p {
  color: var(--text-muted, #888);
  font-size: 14px;
  margin: 0;
}

/* 错误状态 */
.ai-error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.error-icon {
  font-size: 48px;
}

.ai-error-state p {
  color: #ef4444;
  font-size: 14px;
  margin: 0;
  text-align: center;
}

/* 空状态 */
.ai-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 12px;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 8px;
}

.ai-empty h4 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text, #e0d8ff);
}

.ai-empty p {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted, #888);
  max-width: 280px;
  line-height: 1.6;
}

/* 结果内容 */
.ai-results {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.ai-results::-webkit-scrollbar {
  width: 6px;
}

.ai-results::-webkit-scrollbar-track {
  background: transparent;
}

.ai-results::-webkit-scrollbar-thumb {
  background: var(--border, #2a2a4a);
  border-radius: 3px;
}

/* 结果块 */
.result-block {
  background: var(--surface2, #1e1e3a);
  border-radius: 12px;
  padding: 16px;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border, #2a2a4a);
}

.result-icon {
  font-size: 22px;
}

.result-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text, #e0d8ff);
}

/* 分镜脚本 */
.scenes-timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scene-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.scene-marker {
  flex-shrink: 0;
  padding: 4px 10px;
  background: rgba(123, 47, 255, 0.2);
  color: #b47fff;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
}

.scene-content {
  flex: 1;
}

.scene-visual {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #e0d8ff);
  margin-bottom: 4px;
}

.scene-desc {
  font-size: 12px;
  color: var(--text-muted, #888);
  line-height: 1.5;
}

/* 剪辑技巧 */
.tips-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tip-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px;
  background: var(--panel-bg, #12122a);
  border-radius: 8px;
}

.tip-num {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--primary, #7b2fff), #9f7aea);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 6px;
}

.tip-text {
  flex: 1;
  font-size: 13px;
  color: var(--text, #e0d8ff);
  line-height: 1.5;
}

/* 精彩亮点 */
.highlights-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.highlight-card {
  position: relative;
  padding: 14px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(123, 47, 255, 0.08));
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 10px;
}

.highlight-badge {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  margin-bottom: 8px;
}

.highlight-card p {
  margin: 0;
  font-size: 12px;
  color: var(--text, #e0d8ff);
  line-height: 1.5;
}

/* 按钮loading */
.btn-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* readability pass */
.posttools-tabs {
  border: 1px solid var(--card-border, var(--border));
  background: var(--card-bg, var(--surface2));
  box-shadow: var(--shadow);
}

.tab-btn {
  color: var(--text-dim);
}

.tab-btn:hover {
  background: var(--row-bg-hover, var(--surface2));
}

.tab-btn.active {
  background: var(--primary-gradient);
  color: #fff;
  box-shadow: 0 8px 18px var(--primary-shadow);
}

.tool-card,
.tip-card,
.highlight-card {
  border: 1px solid var(--card-border, var(--border));
  background: var(--card-bg, var(--panel-bg));
  box-shadow: var(--shadow);
}

.drop-zone {
  border-color: var(--card-border, var(--border));
  background: var(--row-bg, transparent);
}

.drop-zone:hover,
.drop-zone.dragging {
  border-color: var(--card-border-hover, var(--primary));
  background: var(--row-bg-hover, var(--accent-soft));
}

.file-item,
.segment-item,
.rec-tag,
.scene-card {
  border: 1px solid var(--chip-border);
  background: var(--row-bg, var(--surface2));
}

.file-status.done {
  color: var(--success-text);
}

.file-status.error {
  color: var(--danger-text);
}

.file-status.converting,
.seg-time {
  color: var(--primary-light);
}

.result-section,
.recommendations {
  border-top-color: var(--divider, var(--border));
}

.highlight-card {
  background:
    linear-gradient(135deg, var(--warning-bg), transparent),
    var(--card-bg, var(--panel-bg));
}

.highlight-badge {
  background: var(--warning-bg);
  color: var(--warning-text);
}

@media (max-width: 860px) {
  .media-workbench-grid {
    grid-template-columns: 1fr;
  }

  .media-console {
    min-height: 0;
  }

  .media-queue-panel {
    min-height: 300px;
  }

  .media-flow-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .media-input-row {
    flex-direction: column;
  }

  .media-pick-btn {
    width: 100%;
  }

  .media-submit-row {
    flex-direction: column;
    align-items: stretch;
  }

  .media-start-btn {
    width: 100%;
  }

  .media-action-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .download-result-row {
    align-items: stretch;
    flex-direction: column;
  }

  .download-result-actions {
    justify-content: flex-start;
  }

  .download-grid {
    grid-template-columns: 1fr;
  }

  .download-form {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 520px) {
  .media-flow-strip,
  .media-action-grid {
    grid-template-columns: 1fr;
  }
}
</style>
