<template>
  <div class="tools-module">
    <div class="module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">文</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">COPY TOOLS</div>
          <h2>文案工具</h2>
        </div>
      </div>
    </div>

    <div class="tools-workflow">
      <section class="tools-left-column">
        <div class="card tool-card transcribe-card">
          <div class="card-hdr">
            <span class="tool-icon">转</span>
            <div class="card-title-group">
              <span class="card-title">抖音 / B站 / MP3 转写</span>
              <span class="card-caption">链接走快速转写，音频直接上传硅基流动</span>
            </div>
            <div class="transcribe-switch" aria-label="转写平台">
              <button
                type="button"
                class="mode-btn"
                :class="{ active: transcribePlatform === 'douyin' }"
                @click="transcribePlatform = 'douyin'">
                抖音
              </button>
              <button
                type="button"
                class="mode-btn"
                :class="{ active: transcribePlatform === 'bilibili' }"
                @click="transcribePlatform = 'bilibili'">
                B站
              </button>
              <button
                type="button"
                class="mode-btn"
                :class="{ active: transcribePlatform === 'audio' }"
                @click="transcribePlatform = 'audio'">
                MP3
              </button>
            </div>
          </div>

          <div class="card-body">
          <div v-show="transcribePlatform === 'douyin'" class="transcribe-pane">
            <div class="operation-step">
              <span class="step-index">1</span>
              <div class="step-main">
                <div class="step-label">链接输入</div>
                <div class="control-row">
                  <input
                    v-model="douyinUrl"
                    class="inp"
                    placeholder="粘贴抖音分享口令、短链或视频链接"
                    @keyup.enter="handleRunDouyin" />
                  <button class="btn btn-primary run-btn" :disabled="douyinLoading" @click="handleRunDouyin">
                    {{ douyinLoading ? '转写中...' : '开始转写' }}
                  </button>
                </div>
              </div>
            </div>

            <div class="operation-step">
              <span class="step-index">2</span>
              <div class="step-main">
                <div class="step-label">可选动作</div>
                <div class="download-option" :class="{ active: douyinDownloadEnabled }">
                  <label class="toggle-row">
                    <input v-model="douyinDownloadEnabled" type="checkbox" />
                    <span>同时下载素材</span>
                  </label>
                  <select v-model="douyinDownloadType" class="inp compact-select" :disabled="!douyinDownloadEnabled">
                    <option value="mp4">MP4 视频</option>
                    <option value="mp3">MP3 音频</option>
                    <option value="cover">封面图</option>
                    <option value="all">全部素材</option>
                  </select>
                  <span class="field-hint">不勾选时走快速转写模式</span>
                </div>
              </div>
            </div>

            <div class="operation-step">
              <span class="step-index">3</span>
              <div class="step-main">
                <div class="progress-panel" :class="{ active: douyinLoading, done: douyinProgress === 100 && !douyinError, failed: !!douyinError }">
                  <div class="progress-line">
                    <span class="step-label">进度</span>
                    <span class="progress-status">{{ douyinProgressText }}</span>
                    <strong>{{ douyinProgress }}%</strong>
                  </div>
                  <div class="progress-track">
                    <span class="progress-fill" :style="{ width: douyinProgress + '%' }"></span>
                  </div>
                </div>

                <div v-if="douyinError" class="result-box error-box">
                  {{ douyinError }}
                </div>

                <div v-if="douyinTranscriptText" class="transcript-output">
                  <div class="result-head">
                    <span class="step-label">转写文案</span>
                    <div class="result-actions">
                      <button class="btn btn-primary btn-sm" @click="handleGenerateCopy('douyin', douyinTranscriptText)">带入评论</button>
                      <button class="btn btn-ghost btn-sm" :disabled="douyinFixing" @click="handleFixDouyin">
                        {{ douyinFixing ? '清洗中...' : '清洗分段' }}
                      </button>
                      <button class="btn btn-ghost btn-sm" :disabled="douyinWritingFeishu" @click="handleWriteToFeishu">
                        {{ douyinWritingFeishu ? '写入中...' : '写入飞书' }}
                      </button>
                      <a v-if="douyinFeishuUrl" :href="douyinFeishuUrl" target="_blank" class="feishu-link">打开飞书</a>
                    </div>
                  </div>
                  <textarea
                    v-model="douyinTranscriptText"
                    class="inp transcript-area"
                    rows="8"
                    :readonly="douyinLoading || douyinFixing"
                    placeholder="转写结果会出现在这里" />
                </div>

                <div v-if="douyinSummary && !douyinTranscriptText && !douyinError" class="result-box">
                  {{ douyinSummary }}
                </div>

                <div v-if="douyinItems.length" class="result-box result-list">
                  <button
                    v-for="(item, i) in douyinItems"
                    :key="item.id || i"
                    type="button"
                    class="result-item"
                    @click="handleCopy(item.url || item.title || '')">
                    <span class="result-tag">{{ item.author || item.hot || item.id || ('RESULT ' + (i + 1)) }}</span>
                    <span>{{ item.title || item.url || '返回条目' }}</span>
                  </button>
                </div>

                <div v-if="douyinFiles.length" class="asset-list">
                  <div class="asset-list-head">
                    <span class="step-label">下载文件</span>
                    <span>{{ douyinFiles.length }} 个</span>
                  </div>
                  <div v-for="file in douyinFiles" :key="file.path || file.url || file.name" class="asset-row">
                    <span class="result-tag">{{ fileTypeLabel(file.type) }}</span>
                    <span class="asset-name">{{ file.name }}</span>
                    <a :href="file.url" :download="file.name" target="_blank" class="btn btn-ghost btn-sm">下载</a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-show="transcribePlatform === 'bilibili'" class="transcribe-pane">
            <div class="operation-step">
              <span class="step-index">1</span>
              <div class="step-main">
                <div class="step-label">链接输入</div>
                <div class="control-row">
                  <input
                    v-model="bilibiliUrl"
                    class="inp"
                    placeholder="粘贴 B站视频链接、b23 短链或 BV 号"
                    @keyup.enter="handleTranscribeBilibili" />
                  <button class="btn btn-primary run-btn" :disabled="transcribingBilibili" @click="handleTranscribeBilibili">
                    {{ transcribingBilibili ? '转写中...' : '开始转写' }}
                  </button>
                </div>
              </div>
            </div>

            <div class="operation-step">
              <span class="step-index">2</span>
              <div class="step-main">
                <div class="step-label">处理路线</div>
                <div class="bilibili-route-panel">
                  <span class="route-card active">优先字幕</span>
                  <span class="route-card">音频兜底</span>
                  <span class="route-card">清洗分段</span>
                </div>
              </div>
            </div>

            <div class="operation-step">
              <span class="step-index">3</span>
              <div class="step-main">
                <div class="progress-panel" :class="{ active: transcribingBilibili, done: bilibiliProgress === 100 && !bilibiliError, failed: !!bilibiliError }">
                  <div class="progress-line">
                    <span class="step-label">进度</span>
                    <span class="progress-status">{{ bilibiliProgressText }}</span>
                    <strong>{{ bilibiliProgress }}%</strong>
                  </div>
                  <div class="progress-track">
                    <span class="progress-fill" :style="{ width: bilibiliProgress + '%' }"></span>
                  </div>
                </div>

                <div v-if="bilibiliTitle || bilibiliBvid || bilibiliSource" class="source-meta-strip">
                  <span v-if="bilibiliTitle" class="source-title">{{ bilibiliTitle }}</span>
                  <span v-if="bilibiliBvid" class="result-tag">{{ bilibiliBvid }}</span>
                  <span v-if="bilibiliSource" class="result-tag">{{ bilibiliSourceLabel(bilibiliSource) }}</span>
                </div>

                <div v-if="bilibiliError" class="result-box error-box">
                  {{ bilibiliError }}
                </div>

                <div v-if="bilibiliResult" class="transcript-output">
                  <div class="result-head">
                    <span class="step-label">转写文案</span>
                    <div class="result-actions">
                      <button class="btn btn-primary btn-sm" @click="handleGenerateCopy('bilibili', bilibiliResult)">带入评论</button>
                      <button class="btn btn-ghost btn-sm" :disabled="bilibiliFixing" @click="handleFixBilibili">
                        {{ bilibiliFixing ? '清洗中...' : '清洗分段' }}
                      </button>
                    </div>
                  </div>
                  <textarea
                    v-model="bilibiliResult"
                    class="inp transcript-area"
                    rows="8"
                    :readonly="transcribingBilibili || bilibiliFixing"
                    placeholder="转写结果会出现在这里" />
                </div>
              </div>
            </div>
          </div>

          <div v-show="transcribePlatform === 'audio'" class="transcribe-pane">
            <div class="operation-step">
              <span class="step-index">1</span>
              <div class="step-main">
                <div class="step-label">MP3 上传</div>
                <div
                  class="audio-upload-zone"
                  :class="{ active: audioFileName, busy: audioTranscribing, dragging: audioDragging }"
                  @dragover.prevent="audioDragging = true"
                  @dragleave.prevent="audioDragging = false"
                  @drop.prevent="handleAudioDrop">
                  <div class="audio-upload-copy">
                    <strong>{{ audioFileName || '选择或拖入 MP3 / 音频文件' }}</strong>
                    <span>支持拖入 MP3、M4A、WAV、AAC、FLAC、OGG，适合直播录音和长音频转写</span>
                  </div>
                  <label class="btn btn-ghost btn-sm" :class="{ disabled: audioTranscribing }">
                    选择文件
                    <input
                      type="file"
                      accept=".mp3,.m4a,.wav,.aac,.flac,.ogg,.opus,audio/*"
                      :disabled="audioTranscribing"
                      @change="handleAudioFileChange" />
                  </label>
                </div>
              </div>
            </div>

            <div class="operation-step">
              <span class="step-index">2</span>
              <div class="step-main">
                <div class="step-label">处理路线</div>
                <div class="bilibili-route-panel">
                  <span class="route-card active">上传音频</span>
                  <span class="route-card active">硅基流动</span>
                  <span class="route-card">清洗分段</span>
                </div>
                <button class="btn btn-primary run-btn audio-run-btn" :disabled="audioTranscribing || !audioFileName" @click="handleTranscribeAudio">
                  {{ audioTranscribing ? '转写中...' : '开始 MP3 转写' }}
                </button>
              </div>
            </div>

            <div class="operation-step">
              <span class="step-index">3</span>
              <div class="step-main">
                <div class="progress-panel" :class="{ active: audioTranscribing, done: audioProgress === 100 && !audioError, failed: !!audioError }">
                  <div class="progress-line">
                    <span class="step-label">进度</span>
                    <span class="progress-status">{{ audioProgressText }}</span>
                    <strong>{{ audioProgress }}%</strong>
                  </div>
                  <div class="progress-track">
                    <span class="progress-fill" :style="{ width: audioProgress + '%' }"></span>
                  </div>
                </div>

                <div v-if="audioFileName || audioSource" class="source-meta-strip">
                  <span v-if="audioFileName" class="source-title">{{ audioFileName }}</span>
                  <span v-if="audioSource" class="result-tag">{{ audioSourceLabel(audioSource) }}</span>
                </div>

                <div v-if="audioError" class="result-box error-box">
                  {{ audioError }}
                </div>

                <div v-if="audioResult" class="transcript-output">
                  <div class="result-head">
                    <span class="step-label">转写文案</span>
                    <div class="result-actions">
                      <button class="btn btn-primary btn-sm" @click="handleGenerateCopy('audio', audioResult)">带入评论</button>
                      <button class="btn btn-ghost btn-sm" :disabled="audioFixing" @click="handleFixAudio">
                        {{ audioFixing ? '清洗中...' : '清洗分段' }}
                      </button>
                    </div>
                  </div>
                  <textarea
                    v-model="audioResult"
                    class="inp transcript-area"
                    rows="8"
                    :readonly="audioTranscribing || audioFixing"
                    placeholder="MP3 转写结果会出现在这里" />
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>

      </section>
      <section class="tools-right-column">
        <CommentGeneratorPanel ref="commentPanelRef" />
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useToast } from '../composables/useToast'
import { useClipboard } from '../composables/useClipboard'
import { useDouyinTool } from './tools/useDouyinTool'
import { useBilibiliTranscription } from './tools/useBilibiliTranscription'
import { useAudioTranscription } from './tools/useAudioTranscription'
import CommentGeneratorPanel from './tools/CommentGeneratorPanel.vue'

const { showToast } = useToast()
const { handleCopy } = useClipboard(showToast)
const transcribePlatform = ref('douyin')
const commentPanelRef = ref(null)
const audioDragging = ref(false)

const {
  douyinUrl,
  douyinDownloadEnabled,
  douyinDownloadType,
  douyinLoading,
  douyinProgress,
  douyinProgressText,
  douyinSummary,
  douyinFiles,
  douyinItems,
  douyinError,
  douyinTranscriptText,
  douyinFixing,
  douyinWritingFeishu,
  douyinFeishuUrl,
  handleRunDouyin,
  handleFixDouyin,
  handleWriteToFeishu
} = useDouyinTool(showToast)

const {
  bilibiliUrl,
  transcribingBilibili,
  bilibiliProgress,
  bilibiliProgressText,
  bilibiliResult,
  bilibiliError,
  bilibiliTitle,
  bilibiliBvid,
  bilibiliSource,
  bilibiliFixing,
  handleTranscribeBilibili,
  handleFix: handleFixBilibili
} = useBilibiliTranscription(showToast)

const {
  audioFileName,
  audioTranscribing,
  audioProgress,
  audioProgressText,
  audioResult,
  audioError,
  audioSource,
  audioFixing,
  setAudioFile,
  handleTranscribeAudio,
  handleFixAudio
} = useAudioTranscription(showToast)

function handleAudioFileChange(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (file) setAudioFile(file)
}

function handleAudioDrop(event) {
  audioDragging.value = false
  if (audioTranscribing.value) return
  const file = event.dataTransfer?.files?.[0]
  if (file) setAudioFile(file)
}

function handleGenerateCopy(platform, text) {
  const value = String(text || '').trim()
  if (!value) return showToast('没有可带入的文案', 'error')
  commentPanelRef.value?.fill({
    script: value,
    videoUrl: platform === 'bilibili' ? bilibiliUrl.value : platform === 'douyin' ? douyinUrl.value : ''
  })
  transcribePlatform.value = platform
  showToast('已带入评论生成区', 'success')
}

function fileTypeLabel(type) {
  const map = {
    mp4: '视频',
    video: '视频',
    mp3: '音频',
    audio: '音频',
    cover: '封面',
    image: '图片',
    text: '文本'
  }
  return map[type] || type || '文件'
}

function bilibiliSourceLabel(source) {
  const map = {
    'bilibili-cli:subtitle': '官方字幕',
    subtitle: '字幕',
    audio: '音频转写',
    whisper: '音频转写'
  }
  return map[source] || source
}

function audioSourceLabel(source) {
  const map = {
    siliconflow: '硅基流动',
    'FunAudioLLM/SenseVoiceSmall': 'SenseVoiceSmall'
  }
  return map[source] || source || '音频转写'
}
</script>

<style scoped>
.tools-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tools-module .module-page-header {
  margin-bottom: 18px;
}

.tools-workflow {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: minmax(360px, 0.78fr) minmax(560px, 1.22fr);
  align-content: start;
  align-items: start;
  gap: 18px;
  padding: 0 2px 24px 0;
}

.tools-left-column {
  min-width: 0;
  display: grid;
  gap: 18px;
  align-items: start;
}

.tools-right-column {
  min-width: 0;
  display: grid;
  gap: 18px;
  align-items: start;
}

.transcribe-card {
  min-height: 0;
  height: auto;
}

.card {
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  box-shadow: var(--shadow);
}

.card-hdr {
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-bg-soft);
}

.card-body {
  display: grid;
  gap: 14px;
  padding: 14px;
}

.tool-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--chip-bg);
  color: var(--primary-light);
  font-size: 15px;
  font-weight: 900;
}

.card-title-group {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.card-title {
  color: var(--text);
  font-size: 14px;
  font-weight: 900;
}

.card-caption {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.transcribe-switch {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-bg);
  white-space: nowrap;
}

.mode-btn {
  min-width: 54px;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.mode-btn.active {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 6px 16px var(--primary-shadow);
}

.transcribe-pane,
.step-main,
.transcript-output,
.asset-list,
.maintenance-body {
  min-width: 0;
  display: grid;
  gap: 12px;
}

.operation-step {
  min-width: 0;
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 11px;
  align-items: start;
}

.operation-step:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 14px;
  top: 34px;
  bottom: -14px;
  width: 1px;
  background: var(--border);
}

.step-index {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--chip-bg);
  color: var(--primary-light);
  font-size: 11px;
  font-weight: 900;
}

.step-label,
.field-block > span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.control-row,
.form-line,
.action-row,
.download-option,
.phase-panel,
.source-meta-strip,
.result-actions {
  min-width: 0;
  display: flex;
  gap: 8px;
}

.control-row {
  align-items: stretch;
}

.control-row > .inp {
  min-width: 0;
  flex: 1 1 auto;
}

.run-btn {
  flex: 0 0 108px;
}

.download-option,
.phase-panel,
.source-meta-strip,
.result-actions {
  align-items: center;
  flex-wrap: wrap;
}

.download-option {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.download-option.active {
  border-color: var(--border-bright);
}

.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
}

.compact-select {
  max-width: 150px;
}

.field-hint {
  color: var(--text-muted);
  font-size: 11px;
}

.progress-panel,
.result-box,
.result-head,
.profile-panel,
.phase-panel {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.progress-panel.active {
  border-color: var(--border-bright);
}

.progress-panel.done {
  border-color: rgba(16, 185, 129, 0.42);
}

.progress-panel.failed,
.error-box {
  border-color: rgba(239, 68, 68, 0.45);
  color: var(--danger, #ef4444);
}

.progress-line,
.asset-list-head,
.profile-head {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.progress-status {
  min-width: 0;
  flex: 1 1 auto;
  color: var(--text-dim);
  font-size: 12px;
}

.progress-track {
  height: 7px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chip-bg);
}

.progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary-gradient);
  transition: width 0.2s ease;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.transcript-area {
  width: 100%;
  min-height: 220px;
  resize: vertical;
}

.audio-upload-zone {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: var(--panel-bg-soft);
}

.audio-upload-zone.active {
  border-color: var(--border-bright);
}

.audio-upload-zone.dragging {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--panel-bg-soft));
}

.audio-upload-zone.busy {
  opacity: 0.82;
}

.audio-upload-zone input[type="file"] {
  display: none;
}

.audio-upload-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.audio-upload-copy strong {
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-upload-copy span {
  color: var(--text-muted);
  font-size: 12px;
}

.audio-run-btn {
  margin-top: 10px;
  width: 100%;
}

.comment-textarea,
.result-textarea {
  width: 100%;
  min-height: 170px;
  resize: vertical;
}

.result-textarea {
  min-height: 240px;
}

.bilibili-route-panel {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.route-card {
  min-height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 800;
}

.route-card.active {
  color: var(--primary-light);
  border-color: var(--border-bright);
}

.source-title,
.asset-name,
.result-item > span:last-child,
.comment-item > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-tag {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 900;
}

.result-list,
.comment-list {
  display: grid;
  gap: 8px;
}

.result-item,
.comment-item {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  width: 100%;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.comment-index {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--primary);
  font-size: 11px;
  font-weight: 900;
}

.asset-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.field-block {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.form-line {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.range-input {
  width: 100%;
  accent-color: var(--primary);
}

.action-row {
  flex-wrap: wrap;
}

.feishu-link {
  color: var(--primary-light);
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;
}

.maintenance-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.inline-toggle {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.phase-total {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 900;
}

.phase-total.warn {
  color: var(--danger, #ef4444);
}

.phase-list,
.profile-grid {
  display: grid;
  gap: 8px;
}

.phase-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 100px auto;
  gap: 8px;
}

.profile-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.full-btn {
  width: 100%;
}

.maintenance-output-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 1200px) {
  .tools-workflow,
  .maintenance-output-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .card-hdr,
  .result-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .transcribe-switch {
    width: 100%;
    margin-left: 0;
  }

  .control-row,
  .download-option,
  .action-row {
    flex-direction: column;
  }

  .run-btn,
  .compact-select,
  .action-row .btn {
    width: 100%;
    max-width: none;
    flex: none;
  }

  .operation-step {
    grid-template-columns: 1fr;
  }

  .operation-step::after,
  .step-index {
    display: none;
  }

  .form-line,
  .maintenance-form,
  .profile-grid,
  .phase-row,
  .bilibili-route-panel {
    grid-template-columns: 1fr;
  }
}
</style>
