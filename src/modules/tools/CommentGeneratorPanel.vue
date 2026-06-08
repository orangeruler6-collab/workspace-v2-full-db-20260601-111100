<template>
  <div class="card tool-card comment-card" :class="{ compact }">
    <div class="card-hdr">
      <span class="tool-icon">评</span>
      <div class="card-title-group">
        <span class="card-title">{{ title }}</span>
        <span class="card-caption">{{ caption }}</span>
      </div>
      <button
        v-if="hasContext"
        class="btn btn-ghost btn-sm"
        type="button"
        @click="applyContext(true)"
      >
        带入上下文
      </button>
    </div>
    <div class="card-body">
      <label class="field-block">
        <span>视频链接</span>
        <input v-model="commentVideoUrl" class="inp" placeholder="选填，抖音/B站链接" />
      </label>
      <div class="form-line">
        <label class="field-block">
          <span>账号</span>
          <input v-model="commentAccountSel" class="inp" placeholder="账号名或通用" />
        </label>
        <label class="field-block">
          <span>场景</span>
          <input v-model="commentScenario" class="inp" placeholder="评论场景" />
        </label>
      </div>
      <label class="field-block">
        <span>评论条数：{{ commentCount }}</span>
        <input v-model.number="commentCount" type="range" min="5" max="300" step="5" class="range-input" />
      </label>
      <div class="danmaku-option">
        <label class="toggle-row">
          <input v-model="danmakuEnabled" type="checkbox" />
          <span>同时生成弹幕</span>
        </label>
        <label v-if="danmakuEnabled" class="field-block">
          <span>弹幕条数：{{ danmakuCount }}</span>
          <input v-model.number="danmakuCount" type="range" min="0" max="300" step="5" class="range-input" />
        </label>
      </div>
      <label class="field-block">
        <span>原始文案</span>
        <textarea v-model="commentScript" class="inp comment-textarea" rows="8" placeholder="粘贴转写文案、投流申请文案，或只填视频链接自动转写" />
      </label>
      <div class="action-row">
        <button class="btn btn-primary" :disabled="commentLoading" @click="handleComment('comment')">
          {{ commentLoading ? commentLoadingText : (danmakuEnabled && danmakuCount > 0 ? '生成评论+弹幕' : '生成评论') }}
        </button>
        <button class="btn btn-ghost" :disabled="!hasGeneratedItems || commentSaving" @click="handleCommentSave">
          {{ commentSaving ? '写入中...' : '写入飞书' }}
        </button>
        <button class="btn btn-ghost" :disabled="!hasGeneratedItems || commentWordSaving" @click="handleCommentWord">
          {{ commentWordSaving ? '导出中...' : '导出 Word' }}
        </button>
      </div>
      <a v-if="commentDocUrl" :href="commentDocUrl" target="_blank" class="feishu-link">打开评论文档</a>
      <div v-if="commentError" class="result-box error-box">{{ commentError }}</div>
      <div v-if="hasGeneratedItems" class="comment-list">
        <section v-if="commentResult?.length" class="result-section">
          <div class="result-section-head">
            <strong>评论</strong>
            <span>{{ commentResult.length }} 条</span>
          </div>
          <button
            v-for="(comment, index) in commentResult"
            :key="'comment-' + index"
            type="button"
            class="comment-item"
            @click="handleCopy(comment)"
          >
            <span class="comment-index">{{ index + 1 }}</span>
            <span>{{ comment }}</span>
          </button>
        </section>
        <section v-if="danmakuResult?.length" class="result-section">
          <div class="result-section-head">
            <strong>弹幕</strong>
            <span>{{ danmakuResult.length }} 条</span>
          </div>
          <button
            v-for="(comment, index) in danmakuResult"
            :key="'danmaku-' + index"
            type="button"
            class="comment-item danmaku-item"
            @click="handleCopy(comment)"
          >
            <span class="comment-index">{{ index + 1 }}</span>
            <span>{{ comment }}</span>
          </button>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useToast } from '../../composables/useToast'
import { useClipboard } from '../../composables/useClipboard'
import { useCommentTool } from './useCommentTool'

const props = defineProps({
  title: {
    type: String,
    default: '评论生成'
  },
  caption: {
    type: String,
    default: '可直接粘贴文案，也可填视频链接自动转写'
  },
  context: {
    type: Object,
    default: () => ({})
  },
  autoFill: {
    type: Boolean,
    default: false
  },
  compact: {
    type: Boolean,
    default: false
  }
})

const { showToast } = useToast()
const { handleCopy } = useClipboard(showToast)

const {
  commentScript,
  commentCount,
  commentScenario,
  danmakuEnabled,
  danmakuCount,
  commentAccountSel,
  commentVideoUrl,
  commentResult,
  danmakuResult,
  commentError,
  commentLoading,
  commentPrefillLoading,
  commentLoadingText,
  commentSaving,
  commentWordSaving,
  commentDocUrl,
  hasGeneratedItems,
  handleComment,
  prefillCommentFromLink,
  handleCommentSave,
  handleCommentWord
} = useCommentTool(showToast)

const normalizedContext = computed(() => {
  const source = props.context || {}
  const rawCount = Number(source.count || source.commentCount || source.quantity || 0)
  return {
    account: String(source.account || source.accountName || '').trim(),
    videoUrl: String(source.videoUrl || source.link || '').trim(),
    scenario: String(source.scenario || '').trim(),
    script: String(source.script || source.text || source.applyText || '').trim(),
    count: Number.isFinite(rawCount) && rawCount > 0 ? Math.max(5, Math.min(300, Math.round(rawCount / 5) * 5)) : 0
  }
})

const hasContext = computed(() =>
  Boolean(normalizedContext.value.account || normalizedContext.value.videoUrl || normalizedContext.value.script)
)

const contextKey = computed(() => JSON.stringify(normalizedContext.value))
const lastAppliedScript = ref('')

function applyContext(force = false) {
  const context = normalizedContext.value
  if (!hasContext.value) return
  if (force || !commentAccountSel.value.trim()) commentAccountSel.value = context.account || commentAccountSel.value
  if (force || !commentVideoUrl.value.trim()) commentVideoUrl.value = context.videoUrl || commentVideoUrl.value
  if (force || !commentScenario.value.trim()) commentScenario.value = context.scenario || commentScenario.value
  const currentScript = commentScript.value.trim()
  const canReplaceScript = force || !currentScript || currentScript === lastAppliedScript.value
  if (canReplaceScript) {
    commentScript.value = context.script || ''
    lastAppliedScript.value = commentScript.value.trim()
  }
  if (context.count && (force || props.autoFill || commentCount.value === 30)) commentCount.value = context.count
  if (force) showToast('已带入当前投流上下文', 'success')
}

function fill(value = {}) {
  const data = value || {}
  if (data.account !== undefined || data.accountName !== undefined) {
    commentAccountSel.value = String(data.account || data.accountName || '').trim()
  }
  if (data.videoUrl !== undefined || data.link !== undefined) {
    commentVideoUrl.value = String(data.videoUrl || data.link || '').trim()
  }
  if (data.scenario !== undefined) {
    commentScenario.value = String(data.scenario || '').trim()
  }
  if (data.script !== undefined || data.text !== undefined || data.applyText !== undefined) {
    commentScript.value = String(data.script || data.text || data.applyText || '').trim()
    lastAppliedScript.value = commentScript.value
  }
  if (data.count !== undefined || data.commentCount !== undefined || data.quantity !== undefined) {
    const rawCount = Number(data.count || data.commentCount || data.quantity || 0)
    if (Number.isFinite(rawCount) && rawCount > 0) commentCount.value = Math.max(5, Math.min(300, Math.round(rawCount / 5) * 5))
  }
  if (data.mode !== undefined || data.type !== undefined) {
    const mode = String(data.mode || data.type || '').trim()
    if (/弹幕|danmaku|barrage/i.test(mode)) danmakuEnabled.value = true
  }
}

defineExpose({ fill, applyContext })

watch(contextKey, () => {
  if (!props.autoFill) return
  if (commentResult.value?.length) return
  applyContext(false)
}, { immediate: true })
</script>

<style scoped>
.comment-card {
  min-width: 0;
}

.comment-card.compact {
  height: 100%;
}

.card-body {
  display: grid;
  gap: 12px;
}

.field-block {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.field-block > span {
  color: var(--text-muted, #64748b);
  font-size: 11px;
  font-weight: 900;
}

.form-line {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.range-input {
  width: 100%;
  accent-color: var(--primary, #1677ff);
}

.danmaku-option {
  min-width: 0;
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border, #d7dde8);
  border-radius: 8px;
  background: var(--panel-bg-soft, rgba(148, 163, 184, 0.08));
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text, #172033);
  font-size: 13px;
  font-weight: 800;
}

.toggle-row input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary, #1677ff);
}

.comment-textarea {
  width: 100%;
  min-height: 170px;
  resize: vertical;
}

.action-row {
  min-width: 0;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.feishu-link {
  color: var(--primary-light, #0a66d8);
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;
}

.result-box {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border, #d7dde8);
  border-radius: 8px;
  background: var(--panel-bg-soft, rgba(148, 163, 184, 0.08));
}

.error-box {
  border-color: rgba(239, 68, 68, 0.45);
  color: var(--danger, #ef4444);
}

.comment-list {
  display: grid;
  gap: 14px;
}

.result-section {
  display: grid;
  gap: 8px;
}

.result-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted, #64748b);
  font-size: 12px;
  font-weight: 900;
}

.result-section-head strong {
  color: var(--text, #172033);
  font-size: 13px;
}

.comment-item {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  width: 100%;
  padding: 9px;
  border: 1px solid var(--border, #d7dde8);
  border-radius: 8px;
  background: var(--panel-bg, #fff);
  color: var(--text, #172033);
  text-align: left;
  cursor: pointer;
}

.comment-item > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.comment-index {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--accent-soft, rgba(22, 119, 255, 0.12));
  color: var(--primary, #1677ff);
  font-size: 11px;
  font-weight: 900;
}

.danmaku-item .comment-index {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}

@media (max-width: 720px) {
  .form-line {
    grid-template-columns: 1fr;
  }

  .action-row .btn {
    width: 100%;
  }
}
</style>
