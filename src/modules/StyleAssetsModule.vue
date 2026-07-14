<template>
  <section class="style-workbench-native">
    <div class="page assets-page">
      <header class="page-header">
        <div class="page-title-group">
          <span class="page-title-eyebrow">互动素材</span>
          <div class="page-title-row">
            <span class="page-title-mark" aria-hidden="true">评</span>
            <div class="page-title-copy">
              <h1>评论生成</h1>
              <p class="subtle">链接转写，文案直接生成。</p>
            </div>
          </div>
        </div>
        <div class="page-header-meta">
          <span class="stat-pill">{{ records.length }} 条记录</span>
          <button class="btn ghost" type="button" :disabled="loading" @click="loadAll">
            <span class="style-workbench-icon" aria-hidden="true">↻</span>
            刷新
          </button>
        </div>
      </header>

      <div v-if="error" class="error" role="alert">{{ error }}</div>

      <section class="engagement-workbench">
        <section class="panel engagement-main">
          <div class="engagement-refbar">
            <div>
              <h2>生成器</h2>
              <p class="pane-subtitle">链接或文案。</p>
            </div>
          </div>
          <div class="engagement-content-grid">
            <section class="pane engagement-generator-pane">
              <div class="pane-body">
                <div class="detail-section engagement-source-panel">
                  <div class="source-tabs" role="group" aria-label="选择素材来源">
                    <button type="button" :class="{ active: form.sourceType === 'text' }" @click="form.sourceType = 'text'">文本</button>
                    <button type="button" :class="{ active: form.sourceType === 'draft' }" @click="form.sourceType = 'draft'">草稿</button>
                    <button type="button" :class="{ active: form.sourceType === 'url' }" @click="form.sourceType = 'url'">链接</button>
                  </div>

                  <label v-if="form.sourceType === 'draft'" class="field">
                    <span>选择草稿</span>
                    <select v-model="form.draftId">
                      <option value="">选择草稿</option>
                      <option v-for="draft in drafts" :key="draft.id" :value="draft.id">{{ draft.title || draft.id }}</option>
                    </select>
                  </label>
                  <label v-else-if="form.sourceType === 'url'" class="field">
                    <span>视频链接</span>
                    <input v-model="form.url" autocomplete="off" placeholder="粘贴视频链接" />
                  </label>
                  <label v-else class="field">
                    <span>标题</span>
                    <input v-model="form.title" autocomplete="off" placeholder="可选标题" />
                  </label>

                  <label v-if="form.sourceType === 'text'" class="field engagement-source-text-field">
                    <span>文案</span>
                    <textarea
                      class="engagement-source-input"
                      v-model="form.text"
                      placeholder="粘贴文案"></textarea>
                  </label>
                </div>

                <div class="detail-section">
                  <div class="section-title-row">
                    <h3>生成数量</h3>
                    <span class="status-pill" :class="generating ? 'pending' : 'completed'">{{ generating ? '生成中' : '就绪' }}</span>
                  </div>
                  <div class="engagement-option-grid">
                    <label class="engagement-option" :class="{ active: form.commentCount > 0 }">
                      <input type="checkbox" :checked="form.commentCount > 0" @change="form.commentCount = form.commentCount > 0 ? 0 : 20" />
                      <span>
                        <strong>评论</strong>
                        <small>贴近账号语气</small>
                      </span>
                      <input type="number" min="0" max="80" v-model.number="form.commentCount" />
                    </label>
                    <label class="engagement-option" :class="{ active: form.danmakuCount > 0 }">
                      <input type="checkbox" :checked="form.danmakuCount > 0" @change="form.danmakuCount = form.danmakuCount > 0 ? 0 : 10" />
                      <span>
                        <strong>弹幕</strong>
                        <small>短句高密度</small>
                      </span>
                      <input type="number" min="0" max="80" v-model.number="form.danmakuCount" />
                    </label>
                  </div>
                  <button class="btn primary engagement-submit" type="button" :disabled="generating" @click="generate">
                    {{ generating ? '生成中' : '生成互动素材' }}
                  </button>
                </div>
              </div>
            </section>

            <section class="pane engagement-result-pane">
              <div class="pane-body engagement-results-pane">
                <div class="section-title-row">
                  <h2>结果</h2>
                  <button class="btn compact" type="button" :disabled="!allResultText" @click="copyResult">复制全部</button>
                </div>
                <div class="asset-list-block">
                  <div class="section-title-row">
                    <h3>评论</h3>
                    <span class="status-pill">{{ comments.length }}</span>
                  </div>
                  <div class="asset-text-list" :class="{ empty: !comments.length }">
                    <p v-for="item in comments" :key="item.id || item.text || item">{{ item.text || item }}</p>
                    <span v-if="!comments.length">暂无评论结果</span>
                  </div>
                </div>
                <div class="asset-list-block">
                  <div class="section-title-row">
                    <h3>弹幕</h3>
                    <span class="status-pill">{{ danmaku.length }}</span>
                  </div>
                  <div class="asset-text-list" :class="{ empty: !danmaku.length }">
                    <p v-for="item in danmaku" :key="item.id || item.text || item">{{ item.text || item }}</p>
                    <span v-if="!danmaku.length">暂无弹幕结果</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>

        <aside class="pane engagement-history-pane">
          <div class="pane-header">
            <div>
              <h2>历史</h2>
              <p class="pane-subtitle">生成记录</p>
            </div>
            <span class="status-pill">{{ records.length }}</span>
          </div>
          <div class="pane-body">
            <button v-for="record in records" :key="record.id" type="button" class="list-button" @click="openRecord(record)">
              <span>
                <strong class="list-title">{{ record.title || '未命名记录' }}</strong>
                <span class="list-meta">{{ sourceLabel(record.sourceType) }} · {{ timeLabel(record.updatedAt || record.createdAt) }}</span>
              </span>
              <span class="status-pill">{{ record.comments?.items?.length || 0 }}</span>
            </button>
          </div>
        </aside>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { generateStyleEngagement, loadDrafts, loadEngagementRecords } from '../api/styleWorkbench'

const loading = ref(false)
const generating = ref(false)
const error = ref('')
const draftState = ref({ drafts: [] })
const recordState = ref({ records: [] })
const comments = ref([])
const danmaku = ref([])
const form = reactive({
  sourceType: 'text',
  draftId: '',
  title: '',
  text: '',
  url: '',
  commentCount: 20,
  danmakuCount: 10
})

const drafts = computed(() => draftState.value?.drafts || [])
const records = computed(() => recordState.value?.records || [])
const allResultText = computed(() => [...comments.value, ...danmaku.value].map((item) => item.text || item).join('\n'))

onMounted(loadAll)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [nextDrafts, nextRecords] = await Promise.all([loadDrafts(), loadEngagementRecords()])
    draftState.value = nextDrafts
    recordState.value = nextRecords
    if (!form.draftId && drafts.value[0]) form.draftId = drafts.value[0].id
  } catch (err) {
    error.value = err.message || '评论数据读取失败'
  } finally {
    loading.value = false
  }
}

async function generate() {
  generating.value = true
  error.value = ''
  try {
    const payload = buildPayload()
    const result = await generateStyleEngagement(payload)
    comments.value = result.comments?.items || []
    danmaku.value = result.danmaku?.items || []
    await loadAll()
  } catch (err) {
    error.value = err.message || '评论生成失败'
  } finally {
    generating.value = false
  }
}

function buildPayload() {
  const base = {
    includeComments: Number(form.commentCount) > 0,
    commentCount: Number(form.commentCount) || 0,
    includeDanmaku: Number(form.danmakuCount) > 0,
    danmakuCount: Number(form.danmakuCount) || 0
  }
  if (form.sourceType === 'draft') return { sourceType: 'draft', draftId: form.draftId, ...base }
  if (form.sourceType === 'url') return { sourceType: 'url', url: form.url, ...base }
  return { sourceType: 'text', title: form.title, text: form.text, ...base }
}

function openRecord(record) {
  comments.value = record.comments?.items || []
  danmaku.value = record.danmaku?.items || []
}

async function copyResult() {
  await navigator.clipboard?.writeText(allResultText.value).catch(() => {})
}

function sourceLabel(type) {
  if (type === 'draft') return '草稿'
  if (type === 'url') return '链接'
  return '文本'
}

function timeLabel(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>
