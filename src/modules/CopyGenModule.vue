<template>
  <div class="copygen-module">
    <div class="copygen-header module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">✍️</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">COPY STUDIO</div>
          <h2>文案生成</h2>
        </div>
      </div>
      <div class="header-badges module-page-actions">
        <span class="module-page-pill">{{ styles.length }} 个风格</span>
        <span class="module-page-pill">{{ selectedStyle?.platform || '未选择平台' }}</span>
        <span class="module-page-pill">{{ selectedStyle?.contentType || '未选择类型' }}</span>
      </div>
    </div>

    <div class="copygen-layout">
      <aside class="config-panel">
        <div class="panel-heading">
          <div>
            <span>输入配置</span>
            <strong>先定账号，再填需求</strong>
          </div>
          <small>{{ selectedStyle ? '已选择' : '待选择' }}</small>
        </div>

        <label class="field-block">
          <span>账号风格</span>
          <select v-model="selectedStyleId" class="inp">
            <option disabled value="">选择一个账号风格</option>
            <option v-for="style in styles" :key="style.id" :value="style.id">
              {{ style.name }} · {{ style.platform }} · {{ style.contentType }}
            </option>
          </select>
        </label>

        <div v-if="selectedStyle" class="style-mini-card">
          <div class="style-mini-head">
            <span class="platform-logo" :class="selectedStyle.platform === 'B站' ? 'bili' : 'douyin'">
              {{ selectedStyle.platform === 'B站' ? 'B' : '抖' }}
            </span>
            <div>
              <strong>{{ selectedStyle.name }}</strong>
              <small>{{ selectedStyle.status }} · {{ selectedStyle.samples?.length || 0 }} 篇样本</small>
            </div>
          </div>
          <p>{{ selectedStyle.styleCard?.positioning || '这个账号还没有完整风格卡，建议先去账号风格库完善。' }}</p>
        </div>

        <div class="input-group">
          <label class="field-block">
            <span>新需求</span>
            <textarea
              v-model="form.requirement"
              class="inp"
              rows="4"
              placeholder="例如：给一个AI剪辑工具写一条抖音口播脚本"></textarea>
          </label>

          <label class="field-block">
            <span>产品/素材</span>
            <textarea
              v-model="form.material"
              class="inp material-input"
              rows="6"
              placeholder="粘贴产品卖点、活动信息、链接摘要、转写稿片段"></textarea>
          </label>
        </div>

        <div class="option-grid">
          <label class="field-block">
            <span>长度</span>
            <select v-model="form.length" class="inp">
              <option>短文案</option>
              <option>中等脚本</option>
              <option>B站长稿</option>
            </select>
          </label>
          <label class="field-block">
            <span>风格强度</span>
            <select v-model="form.strength" class="inp">
              <option>轻</option>
              <option>中</option>
              <option>强</option>
            </select>
          </label>
        </div>

        <div class="submit-area">
          <button type="button" class="btn btn-primary full-width" :disabled="!selectedStyle" @click="generateAngles">
            生成切角
          </button>
          <small>生成后会自动进入大纲步骤</small>
        </div>
      </aside>

      <main class="workspace-panel">
        <div class="progress-strip" aria-label="文案生成流程">
          <div class="progress-step" :class="{ current: !angles.length, done: angles.length }">
            <span>1</span>
            <div>
              <strong>切角</strong>
              <small>{{ angles.length ? `${angles.length} 个方向` : '待生成' }}</small>
            </div>
          </div>
          <div class="progress-step" :class="{ current: angles.length && !outline.length, done: outline.length }">
            <span>2</span>
            <div>
              <strong>大纲</strong>
              <small>{{ outline.length ? `${outline.length} 段结构` : '待确认' }}</small>
            </div>
          </div>
          <div class="progress-step" :class="{ current: outline.length && !output, done: output }">
            <span>3</span>
            <div>
              <strong>正文</strong>
              <small>{{ output ? '可编辑' : '待生成' }}</small>
            </div>
          </div>
        </div>

        <div class="decision-grid">
          <section class="work-section">
            <div class="section-head">
              <div class="section-title">
                <span class="section-index">1</span>
                <div>
                  <strong>切角</strong>
                  <span>选择一个方向</span>
                </div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" :disabled="!selectedStyle" @click="generateAngles">
                {{ angles.length ? '换一批' : '生成' }}
              </button>
            </div>

            <div v-if="angles.length" class="angle-grid">
              <button
                v-for="angle in angles"
                :key="angle.id"
                type="button"
                class="angle-card"
                :class="{ active: selectedAngle === angle.id }"
                :aria-pressed="selectedAngle === angle.id"
                @click="pickAngle(angle.id)">
                <span>{{ angle.type }}</span>
                <strong>{{ angle.title }}</strong>
                <p>{{ angle.logic }}</p>
              </button>
            </div>
            <div v-else class="empty-block">
              <strong>还没有切角</strong>
              <span>先生成 3 个方向</span>
            </div>
          </section>

          <section class="work-section">
            <div class="section-head">
              <div class="section-title">
                <span class="section-index">2</span>
                <div>
                  <strong>大纲</strong>
                  <span>确认结构</span>
                </div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" :disabled="!selectedAngle" @click="generateOutline">
                重生成
              </button>
            </div>

            <div v-if="outline.length" class="outline-list">
              <div v-for="(item, index) in outline" :key="item" class="outline-item">
                <span>{{ index + 1 }}</span>
                <p>{{ item }}</p>
              </div>
            </div>
            <div v-else class="empty-block">
              <span>选择切角后出现大纲</span>
            </div>
          </section>
        </div>

        <section class="work-section output-section">
          <div class="section-head">
            <div class="section-title">
              <span class="section-index">3</span>
              <div>
                <strong>正文</strong>
                <span>生成后可直接编辑</span>
              </div>
            </div>
            <div class="section-actions">
              <button type="button" class="btn btn-ghost btn-sm" :disabled="!output" @click="makeShorter">更短</button>
              <button type="button" class="btn btn-primary btn-sm" :disabled="!outline.length" @click="generateCopy">生成正文</button>
            </div>
          </div>

          <textarea
            v-model="output"
            class="inp output-area"
            rows="10"
            placeholder="正文会出现在这里，也可以直接编辑"></textarea>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

const STYLE_KEY = 'usagi_account_style_library'
const SELECTED_KEY = 'usagi_copygen_selected_style_id'
const PREFILL_KEY = 'usagi_copygen_prefill'

const fallbackStyles = [
  {
    id: 'style-dy-ai-ops',
    name: '运营加速器账号',
    platform: '抖音',
    contentType: '口播',
    status: '可用',
    usedCount: 0,
    samples: [{ id: 's1', title: '样本文案', content: '别再手动剪素材了，真正拖慢你的不是工具，是每次从零开始找思路。' }],
    styleCard: {
      positioning: '面向内容运营和中小团队的效率型账号，强调工作流、提效、转化和可复用方法。',
      structure: '痛点场景 → 错误认知 → 方法拆解 → 工具/方案植入 → 明确行动',
      tone: '直接、口语化、有压迫感，但不夸张喊口号。'
    }
  },
  {
    id: 'style-bili-deep',
    name: '深度拆解账号',
    platform: 'B站',
    contentType: '知识',
    status: '待确认',
    usedCount: 0,
    samples: [{ id: 's2', title: '样本文案', content: '这期我们不聊功能更新，而是拆一个更底层的问题。' }],
    styleCard: {
      positioning: '面向内容从业者和商业观察人群的深度分析账号，重视逻辑、案例和观点可信度。',
      structure: '背景铺垫 → 核心问题 → 分层论证 → 案例解释 → 结论回收',
      tone: '理性、克制、有判断力，避免过度情绪化。'
    }
  }
]

const styles = ref(loadStyles())
const selectedStyleId = ref(localStorage.getItem(SELECTED_KEY) || styles.value[0]?.id || '')
const form = reactive({
  requirement: '',
  material: '',
  length: '中等脚本',
  strength: '中'
})
const angles = ref([])
const selectedAngle = ref('')
const outline = ref([])
const output = ref('')

const selectedStyle = computed(() => styles.value.find(style => style.id === selectedStyleId.value))
const currentAngle = computed(() => angles.value.find(angle => angle.id === selectedAngle.value))

watch(selectedStyleId, value => {
  if (value) localStorage.setItem(SELECTED_KEY, value)
  clearWork()
})

function loadStyles() {
  try {
    const raw = localStorage.getItem(STYLE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) && parsed.length ? parsed : fallbackStyles
  } catch (e) {
    return fallbackStyles
  }
}

function refreshStyles() {
  styles.value = loadStyles()
  if (!styles.value.some(style => style.id === selectedStyleId.value)) {
    selectedStyleId.value = styles.value[0]?.id || ''
  }
}

function handleStyleJump(event) {
  refreshStyles()
  if (event?.detail?.styleId) {
    selectedStyleId.value = event.detail.styleId
  }
}

function applyCopygenPrefill(payload) {
  if (!payload) return
  form.requirement = payload.requirement || ''
  form.material = payload.material || ''
  if (payload.length) form.length = payload.length
  if (payload.strength) form.strength = payload.strength
  clearWork()
}

function consumeCopygenPrefill() {
  try {
    const raw = localStorage.getItem(PREFILL_KEY)
    if (!raw) return
    applyCopygenPrefill(JSON.parse(raw))
    localStorage.removeItem(PREFILL_KEY)
  } catch (e) {
    localStorage.removeItem(PREFILL_KEY)
  }
}

function handleCopygenPrefill(event) {
  applyCopygenPrefill(event?.detail)
  localStorage.removeItem(PREFILL_KEY)
}

function clearWork() {
  angles.value = []
  selectedAngle.value = ''
  outline.value = []
  output.value = ''
}

function generateAngles() {
  if (!selectedStyle.value) return
  const subject = form.requirement.trim() || '这次选题'
  const platform = selectedStyle.value.platform
  const styleName = selectedStyle.value.name
  angles.value = [
    {
      id: 'pain',
      type: '痛点切角',
      title: `为什么${subject}一直做不顺`,
      logic: `先抓用户低效或焦虑场景，再用「${styleName}」的节奏给出解决动作。`
    },
    {
      id: 'contrast',
      type: '对比切角',
      title: '普通做法和高效做法差在哪',
      logic: `用前后对比降低理解成本，适合${platform}用户快速判断价值。`
    },
    {
      id: 'scenario',
      type: '场景切角',
      title: '一个真实工作场景里的解决方案',
      logic: '从具体使用瞬间进入，顺着场景植入卖点，营销感更低。'
    }
  ]
  pickAngle(angles.value[0].id)
}

function pickAngle(id) {
  selectedAngle.value = id
  generateOutline()
}

function generateOutline() {
  if (!selectedStyle.value || !currentAngle.value) return
  const isBili = selectedStyle.value.platform === 'B站'
  outline.value = isBili
    ? [
        `用「${currentAngle.value.title}」建立本期核心问题`,
        '补充背景，让用户知道为什么现在值得讨论',
        '拆 2-3 个关键原因，每个原因配一个具体例子',
        '把产品或观点放进解决路径，而不是硬插广告',
        '结尾回收到一个清晰判断或行动建议'
      ]
    : [
        `前三秒直接切入「${currentAngle.value.title}」`,
        '讲一个用户正在经历的具体场景',
        '指出普通做法的问题，制造认知反差',
        '给出方法或产品卖点，保持短句推进',
        '用一句明确 CTA 收住'
      ]
  output.value = ''
}

function generateCopy() {
  if (!selectedStyle.value || !currentAngle.value) return
  if (!outline.value.length) generateOutline()

  const style = selectedStyle.value
  const requirement = form.requirement.trim() || '做一条新文案'
  const material = form.material.trim() || '把核心卖点放进一个用户能立刻理解的场景里'
  const isBili = style.platform === 'B站'

  output.value = isBili
    ? `这期我们聊一个具体问题：${currentAngle.value.title}。

很多内容不是没有卖点，而是卖点没有放进用户真正关心的链路里。${material}，如果只当成功能介绍，用户很快就会划走；但如果把它放到真实工作流里，它就变成了一个可以判断价值的解决方案。

所以这条内容的重点不是“它有什么功能”，而是“它解决了哪个长期存在的问题”。按照「${style.name}」的写法，可以先讲背景，再拆原因，最后回到一个明确结论：${requirement}，关键是让用户看到信息增量。`
    : `别急着开始${requirement}，你可能一开始就做错了。

很多人以为关键是多找几个选题、多换几个标题，但真正影响结果的，是你有没有把用户场景、核心卖点和结尾动作串成一条线。

这次的重点是：${material}。

按「${style.name}」的写法，这条内容可以这样走：
1. 先指出用户正在遇到的问题；
2. 再拆掉一个常见误区；
3. 然后给出清晰方法；
4. 最后把行动引导放到一个自然的位置。

所以这条不是单纯讲功能，而是让用户看到：它为什么现在就和自己有关。`

  bumpUsedCount(style.id)
}

function makeShorter() {
  if (!output.value) return
  output.value = output.value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join('\n\n')
}

function bumpUsedCount(styleId) {
  const next = styles.value.map(style => {
    if (style.id !== styleId) return style
    return { ...style, usedCount: (style.usedCount || 0) + 1 }
  })
  styles.value = next
  localStorage.setItem(STYLE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('usagi:styles-updated'))
}

onMounted(() => {
  refreshStyles()
  consumeCopygenPrefill()
  window.addEventListener('usagi:copygen-style', handleStyleJump)
  window.addEventListener('usagi:copygen-prefill', handleCopygenPrefill)
  window.addEventListener('usagi:styles-updated', refreshStyles)
  window.addEventListener('focus', refreshStyles)
})

onUnmounted(() => {
  window.removeEventListener('usagi:copygen-style', handleStyleJump)
  window.removeEventListener('usagi:copygen-prefill', handleCopygenPrefill)
  window.removeEventListener('usagi:styles-updated', refreshStyles)
  window.removeEventListener('focus', refreshStyles)
})
</script>

<style scoped>
.copygen-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.copygen-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
}

.header-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.copygen-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 340px) minmax(0, 1fr);
  gap: 16px;
}

.config-panel,
.work-section {
  border: 1px solid var(--border);
  border-radius: 8px;
}

.config-panel {
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--panel-bg);
  box-shadow: var(--shadow);
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.panel-heading span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.panel-heading strong {
  display: block;
  margin-top: 4px;
  color: var(--text);
  font-size: 16px;
  font-weight: 800;
  line-height: 1.3;
}

.panel-heading small {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 6px 9px;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-block span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.input-group {
  display: grid;
  gap: 12px;
}

.material-input {
  min-height: 132px;
}

.style-mini-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  padding: 12px;
}

.style-mini-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.platform-logo {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  color: #fff;
  flex: 0 0 auto;
}

.platform-logo.douyin {
  background: linear-gradient(135deg, #111827, #06b6d4);
}

.platform-logo.bili {
  background: linear-gradient(135deg, #2563eb, #60a5fa);
}

.style-mini-card strong {
  display: block;
  color: var(--text);
  font-size: 13px;
}

.style-mini-card small {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.style-mini-card p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.7;
}

.option-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.full-width {
  width: 100%;
}

.submit-area {
  margin-top: auto;
  display: grid;
  gap: 8px;
  padding-top: 2px;
}

.submit-area small {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
}

.workspace-panel {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
  display: grid;
  grid-template-rows: auto auto minmax(260px, 1fr);
  gap: 12px;
}

.progress-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.progress-step {
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  padding: 10px 12px;
  color: var(--text-muted);
}

.progress-step > span {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--border-mid);
  font-size: 12px;
  font-weight: 800;
}

.progress-step strong {
  display: block;
  color: inherit;
  font-size: 13px;
  line-height: 1.2;
}

.progress-step small {
  display: block;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.2;
}

.progress-step.current {
  color: var(--text);
  border-color: var(--border-bright);
  background: var(--active-bg);
}

.progress-step.done {
  color: var(--success-text);
  border-color: var(--success-border);
  background: var(--success-bg);
}

.progress-step.done > span {
  border-color: var(--success-border);
  background: var(--success-bg);
}

.decision-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.work-section {
  min-width: 0;
  background: var(--bg-card);
  padding: 14px;
  box-shadow: var(--shadow);
}

.output-section {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-title {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.section-index {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--border-mid);
  background: var(--surface);
  color: var(--primary-light);
  font-size: 11px;
  font-weight: 800;
}

.section-title strong {
  display: block;
  color: var(--text);
  font-size: 14px;
  line-height: 1.25;
}

.section-title span:not(.section-index) {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.3;
}

.section-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.angle-grid {
  display: grid;
  gap: 8px;
}

.angle-card {
  display: grid;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  padding: 11px 12px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.angle-card:hover {
  border-color: var(--border-mid);
  transform: translateY(-1px);
}

.angle-card.active {
  border-color: var(--border-bright);
  background: var(--active-bg);
}

.angle-card span {
  color: var(--accent);
  font-size: 11px;
  font-weight: 800;
}

.angle-card strong {
  color: var(--text);
  font-size: 13px;
  line-height: 1.45;
}

.angle-card p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.65;
}

.empty-block {
  min-height: 120px;
  border: 1px dashed var(--border-mid);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--text-muted);
}

.empty-block strong {
  color: var(--text-dim);
  font-size: 13px;
}

.empty-block span {
  font-size: 12px;
}

.outline-list {
  display: grid;
  gap: 8px;
}

.outline-item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 9px 10px;
}

.outline-item span {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(124, 58, 237, 0.18);
  color: var(--primary-light);
  font-size: 11px;
  font-weight: 800;
}

.outline-item p {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
}

.output-area {
  flex: 1;
  min-height: 240px;
  resize: none;
}

@media (max-width: 1180px) {
  .copygen-layout {
    grid-template-columns: 1fr;
    overflow-y: auto;
    align-content: start;
    padding-bottom: 84px;
  }

  .config-panel {
    min-height: auto;
    overflow: visible;
  }

  .submit-area {
    margin-top: 0;
  }

  .workspace-panel {
    overflow: visible;
  }
}

@media (max-width: 920px) {
  .decision-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .copygen-header,
  .section-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .progress-strip,
  .option-grid {
    grid-template-columns: 1fr;
  }

  .section-actions {
    justify-content: flex-start;
  }
}
</style>
