<template>
  <div class="account-style-module">
    <div class="style-header module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">🎭</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">ACCOUNT STYLE LAB</div>
          <h2>账号风格库</h2>
        </div>
      </div>
      <div class="header-actions module-page-actions">
        <div class="metric-strip">
          <div class="metric-item">
            <span>{{ styles.length }}</span>
            <em>风格</em>
          </div>
          <div class="metric-item">
            <span>{{ enabledCount }}</span>
            <em>可用</em>
          </div>
          <div class="metric-item">
            <span>{{ totalSamples }}</span>
            <em>样本</em>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" @click="showCreate = true">＋ 新建风格</button>
      </div>
    </div>

    <div class="style-layout">
      <aside class="style-sidebar">
        <div class="sidebar-head">
          <div>
            <strong>风格列表</strong>
            <span>{{ filteredStyles.length }} / {{ styles.length }}</span>
          </div>
        </div>
        <input v-model="searchText" class="inp search-box" placeholder="搜索账号、平台、标签" />

        <div class="filter-panel">
          <div class="filter-group">
            <span class="filter-label">平台</span>
            <div class="filter-row">
              <button
                v-for="p in platformFilters"
                :key="p"
                class="filter-chip"
                :class="{ active: platformFilter === p }"
                @click="platformFilter = p">
                {{ p }}
              </button>
            </div>
          </div>
          <div class="filter-group">
            <span class="filter-label">状态</span>
            <div class="filter-row">
              <button
                v-for="s in statusFilters"
                :key="s"
                class="filter-chip"
                :class="{ active: statusFilter === s }"
                @click="statusFilter = s">
                {{ s }}
              </button>
            </div>
          </div>
        </div>

        <div class="style-list">
          <button
            v-for="item in filteredStyles"
            :key="item.id"
            class="style-list-item"
            :class="{ active: item.id === selectedId }"
            @click="selectStyle(item.id)">
            <span class="platform-mark" :class="item.platform === 'B站' ? 'bili' : 'douyin'">
              {{ item.platform === 'B站' ? 'B' : '抖' }}
            </span>
            <span class="style-list-body">
              <strong>{{ item.name }}</strong>
              <small>{{ item.platform }} · {{ item.contentType }} · {{ item.samples.length }} 篇</small>
            </span>
            <em class="status-badge" :class="statusClass(item.status)">{{ item.status }}</em>
          </button>

          <div v-if="filteredStyles.length === 0" class="empty-state">
            <div class="empty-title">没有匹配的风格</div>
            <div class="empty-sub">换个筛选条件试试</div>
          </div>
        </div>
      </aside>

      <main v-if="selectedStyle" class="style-detail">
        <div class="detail-head">
          <div class="identity-block">
            <span class="identity-logo" :class="selectedStyle.platform === 'B站' ? 'bili' : 'douyin'">
              {{ selectedStyle.platform === 'B站' ? 'B' : '抖' }}
            </span>
            <div>
              <h3>{{ selectedStyle.name }}</h3>
              <div class="detail-meta">
                <span>{{ selectedStyle.platform }}</span>
                <span>{{ selectedStyle.contentType }}</span>
                <span>{{ selectedStyle.scene || '通用场景' }}</span>
                <span>{{ selectedStyle.samples.length }} 篇样本</span>
              </div>
            </div>
          </div>

          <div class="operation-area">
            <div class="operation-status">
              <span class="operation-kicker">下一步</span>
              <strong>{{ primaryAction.title }}</strong>
              <small>{{ primaryAction.hint }}</small>
            </div>
            <div class="operation-meter" :style="{ '--sample-progress': sampleProgress + '%' }">
              <div class="operation-meter-top">
                <span>样本 {{ selectedStyle.samples.length }}/20</span>
                <em class="status-badge" :class="statusClass(selectedStyle.status)">{{ selectedStyle.status }}</em>
              </div>
              <span class="operation-meter-bar"></span>
            </div>
            <div class="operation-actions">
              <button class="btn btn-primary btn-sm operation-primary" :disabled="analyzing" @click="handlePrimaryAction">
                <span aria-hidden="true">{{ primaryAction.icon }}</span>
                {{ analyzing && primaryAction.key === 'analyze' ? 'GPT-5.5 分析中...' : primaryAction.label }}
              </button>
              <button
                v-if="primaryAction.key !== 'upload'"
                class="btn btn-ghost btn-sm"
                @click="openUpload">
                ＋ 添加样本
              </button>
              <button
                v-if="primaryAction.key !== 'analyze'"
                class="btn btn-ghost btn-sm"
                :disabled="analyzing"
                @click="runAnalyze">
                {{ analyzing ? 'GPT-5.5 分析中...' : analyzeButtonLabel }}
              </button>
            </div>
          </div>
        </div>

        <div class="stage-track">
          <div
            v-for="stage in stages"
            :key="stage.key"
            class="stage-item"
            :class="{ done: stage.done, active: stage.active }">
            <span class="stage-dot">{{ stage.done ? '✓' : stage.index }}</span>
            <div>
              <strong>{{ stage.title }}</strong>
              <small>{{ stage.text }}</small>
            </div>
          </div>
        </div>

        <div class="tab-row">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-btn"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key">
            {{ tab.label }}
          </button>
        </div>

        <section v-if="activeTab === 'overview'" class="overview-grid">
          <div class="summary-panel wide">
            <div class="panel-title">风格摘要</div>
            <div class="summary-lines">
              <div>
                <span>定位</span>
                <p>{{ selectedStyle.styleCard.positioning }}</p>
              </div>
              <div>
                <span>结构</span>
                <p>{{ selectedStyle.styleCard.structure }}</p>
              </div>
              <div>
                <span>语气</span>
                <p>{{ selectedStyle.styleCard.tone }}</p>
              </div>
            </div>
          </div>
          <div class="summary-panel">
            <div class="panel-title">状态</div>
            <div class="health-list">
              <div>
                <span>样本量</span>
                <strong :class="{ warn: selectedStyle.samples.length < 10 }">{{ selectedStyle.samples.length }}/20</strong>
              </div>
              <div>
                <span>风格卡</span>
                <strong>{{ selectedStyle.styleCard.confirmed ? '已确认' : '待确认' }}</strong>
              </div>
              <div>
                <span>生成调用</span>
                <strong>{{ selectedStyle.usedCount }} 次</strong>
              </div>
            </div>
          </div>
          <div class="summary-panel">
            <div class="panel-title">标签</div>
            <div class="tag-cloud">
              <span v-for="tag in selectedStyle.tags" :key="tag">{{ tag }}</span>
            </div>
          </div>
          <div class="summary-panel wide">
            <div class="panel-title">代表样本</div>
            <div class="sample-preview-list">
              <button
                v-for="sample in selectedStyle.samples.slice(0, 4)"
                :key="sample.id"
                class="sample-preview"
                @click="previewSample = sample">
                <strong>{{ sample.title }}</strong>
                <span>{{ sample.content }}</span>
              </button>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'samples'" class="samples-panel">
          <div class="panel-toolbar">
            <div>
              <strong>原文案样本</strong>
              <span>{{ selectedStyle.samples.length }} 篇</span>
            </div>
            <button class="btn btn-primary btn-sm" @click="openUpload">＋ 添加样本</button>
          </div>
          <div class="sample-table">
            <div
              v-for="sample in selectedStyle.samples"
              :key="sample.id"
              class="sample-row">
              <button class="sample-row-main" @click="previewSample = sample">
                <strong>{{ sample.title }}</strong>
                <span>{{ sample.content }}</span>
              </button>
              <button class="icon-action danger" title="删除样本" @click="removeSample(sample.id)">×</button>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'styleCard'" class="style-card-editor">
          <div class="panel-toolbar">
            <div>
              <strong>账号风格卡</strong>
              <span>{{ selectedStyle.styleCard.confirmed ? '已确认' : '可编辑' }}</span>
            </div>
            <div class="toolbar-actions">
              <button class="btn btn-ghost btn-sm" :disabled="analyzing" @click="runAnalyze">
                {{ analyzing ? 'GPT-5.5 分析中...' : '重新分析' }}
              </button>
              <button class="btn btn-primary btn-sm" @click="confirmStyle">保存并启用</button>
            </div>
          </div>

          <div class="editor-grid">
            <label class="field-block wide">
              <span>账号定位</span>
              <textarea v-model="selectedStyle.styleCard.positioning" class="inp" rows="3"></textarea>
            </label>
            <label class="field-block">
              <span>常见选题</span>
              <textarea v-model="selectedStyle.styleCard.topics" class="inp" rows="5"></textarea>
            </label>
            <label class="field-block">
              <span>标题特点</span>
              <textarea v-model="selectedStyle.styleCard.titleStyle" class="inp" rows="5"></textarea>
            </label>
            <label class="field-block">
              <span>开头方式</span>
              <textarea v-model="selectedStyle.styleCard.opening" class="inp" rows="5"></textarea>
            </label>
            <label class="field-block">
              <span>内容结构</span>
              <textarea v-model="selectedStyle.styleCard.structure" class="inp" rows="5"></textarea>
            </label>
            <label class="field-block">
              <span>语气风格</span>
              <textarea v-model="selectedStyle.styleCard.tone" class="inp" rows="5"></textarea>
            </label>
            <label class="field-block">
              <span>句子节奏</span>
              <textarea v-model="selectedStyle.styleCard.rhythm" class="inp" rows="5"></textarea>
            </label>
            <label class="field-block">
              <span>常用表达</span>
              <textarea v-model="selectedStyle.styleCard.expressions" class="inp" rows="5"></textarea>
            </label>
            <label class="field-block">
              <span>禁用表达</span>
              <textarea v-model="selectedStyle.styleCard.banned" class="inp" rows="5"></textarea>
            </label>
            <label class="field-block wide">
              <span>样本线索</span>
              <textarea v-model="selectedStyle.styleCard.sampleClues" class="inp" rows="6"></textarea>
            </label>
          </div>
        </section>

      </main>
    </div>

    <div v-if="showCreate" class="style-modal" @click.self="showCreate = false">
      <div class="style-modal-box">
        <div class="modal-head">
          <strong>新建账号风格</strong>
          <button class="icon-action" @click="showCreate = false">×</button>
        </div>
        <label class="field-block">
          <span>账号名称</span>
          <input v-model="draft.name" class="inp" placeholder="例如：运营加速器账号" />
        </label>
        <div class="form-grid">
          <label class="field-block">
            <span>平台</span>
            <select v-model="draft.platform" class="inp">
              <option>抖音</option>
              <option>B站</option>
            </select>
          </label>
          <label class="field-block">
            <span>内容类型</span>
            <select v-model="draft.contentType" class="inp">
              <option>口播</option>
              <option>知识</option>
              <option>测评</option>
              <option>带货</option>
              <option>剧情</option>
            </select>
          </label>
        </div>
        <label class="field-block">
          <span>适用场景</span>
          <input v-model="draft.scene" class="inp" placeholder="例如：AI工具转化 / 知识涨粉" />
        </label>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-sm" @click="showCreate = false">取消</button>
          <button class="btn btn-primary btn-sm" @click="createStyle">创建</button>
        </div>
      </div>
    </div>

    <div v-if="showUpload" class="style-modal" @click.self="showUpload = false">
      <div class="style-modal-box upload-box">
        <div class="modal-head">
          <strong>上传原文案</strong>
          <button class="icon-action" @click="showUpload = false">×</button>
        </div>
        <textarea
          v-model="sampleInput"
          class="inp paste-area"
          rows="12"
          placeholder="每篇文案之间用空行或 --- 分隔"></textarea>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-sm" @click="showUpload = false">取消</button>
          <button class="btn btn-primary btn-sm" @click="addSamples">加入样本库</button>
        </div>
      </div>
    </div>

    <div v-if="previewSample" class="style-modal" @click.self="previewSample = null">
      <div class="style-modal-box preview-box">
        <div class="modal-head">
          <strong>{{ previewSample.title }}</strong>
          <button class="icon-action" @click="previewSample = null">×</button>
        </div>
        <p class="preview-content">{{ previewSample.content }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { analyzeAccountStyle, saveAccountStyles } from '../api/accountStyles'
import { useToast } from '../composables/useToast'

const STORAGE_KEY = 'usagi_account_style_library'
const { showToast } = useToast()

const seedStyles = [
  {
    id: 'style-dy-ai-ops',
    name: '运营加速器账号',
    platform: '抖音',
    contentType: '口播',
    scene: 'AI工具转化',
    status: '可用',
    usedCount: 18,
    tags: ['强痛点', '短句', '转化'],
    samples: [
      makeSample('别再手动剪素材了，真正拖慢你的不是工具，是每次从零开始找思路。'),
      makeSample('很多人做内容卡住，不是不会写，是没有一个能复用的爆款拆解流程。'),
      makeSample('你以为账号起不来是选题不够多，其实是每条视频都没有稳定结构。'),
      makeSample('如果你每天还在复制粘贴改标题，这个方法能帮你省掉一半时间。'),
      makeSample('普通运营写脚本看感觉，高效运营先拆开头、节奏、卖点和结尾。'),
      makeSample('一个AI工具到底值不值得用，别看功能表，先看它能不能减少返工。'),
      makeSample('新手做短视频最容易犯的错，就是上来讲功能，而不是先讲场景。'),
      makeSample('你的文案没有转化，通常不是表达不够漂亮，而是痛点没有说准。'),
      makeSample('爆款不是玄学，它至少有一个清晰钩子、一个明确冲突和一个可执行动作。'),
      makeSample('今天这条给内容运营，尤其是每天被脚本、剪辑、复盘追着跑的人。'),
      makeSample('别把AI当成聊天框，它更适合变成你的内容生产流程。'),
      makeSample('同样是一个卖点，换成用户正在经历的场景，点击率会完全不一样。')
    ],
    styleCard: makeStyleCard({
      positioning: '面向内容运营和中小团队的效率型账号，强调工作流、提效、转化和可复用方法。',
      topics: 'AI工具提效\n短视频脚本拆解\n运营流程优化\n爆款结构复用',
      titleStyle: '直接点出问题或反常识，常用“别再”“不是……而是……”“真正关键”这类强判断句。',
      opening: '前两句直接进入痛点，用用户正在经历的低效场景建立代入感。',
      structure: '痛点场景 → 错误认知 → 方法拆解 → 工具/方案植入 → 明确行动',
      tone: '直接、口语化、有压迫感，但不夸张喊口号。',
      rhythm: '短句多，段落紧，每 2-3 句推进一次信息。',
      expressions: '别再...\n真正拖慢你的不是...\n很多人以为...\n关键不是功能，是流程',
      banned: '过度玄学\n空泛鸡汤\n太长的行业术语\n没有证据的绝对承诺',
      confirmed: true
    })
  },
  {
    id: 'style-bili-deep',
    name: '深度拆解账号',
    platform: 'B站',
    contentType: '知识',
    scene: '商业/内容分析',
    status: '待确认',
    usedCount: 7,
    tags: ['深度观点', '长结构', '案例'],
    samples: [
      makeSample('为什么同样是讲AI工具，有的人能做成方法论，有的人只是在报菜单？'),
      makeSample('这期我们不聊功能更新，而是拆一个更底层的问题：内容团队为什么会越提效越混乱。'),
      makeSample('看一个账号有没有长期价值，不能只看单条播放，而要看它有没有稳定的问题意识。'),
      makeSample('B站用户不是不接受商业内容，他们只是不接受没有信息增量的商业内容。'),
      makeSample('一个好选题通常不是从热点开始，而是从一个长期存在但没人讲透的问题开始。'),
      makeSample('如果把短视频内容看成生产系统，选题、脚本、剪辑和复盘其实是同一条链路。'),
      makeSample('今天我们用三个案例，拆一下为什么一些账号看起来慢，但后劲非常强。'),
      makeSample('真正成熟的内容团队，不是每天追热点，而是知道哪些热点值得接，哪些不值得。')
    ],
    styleCard: makeStyleCard({
      positioning: '面向内容从业者和商业观察人群的深度分析账号，重视逻辑、案例和观点可信度。',
      topics: '平台机制\n商业内容分析\n账号增长方法\nAI与内容生产',
      titleStyle: '标题提出一个值得讨论的问题，带有反常识或系统性视角。',
      opening: '先建立讨论背景，再给出本期核心问题，避免过早进入结论。',
      structure: '背景铺垫 → 核心问题 → 分层论证 → 案例解释 → 结论回收',
      tone: '理性、克制、有判断力，避免过度情绪化。',
      rhythm: '句子略长，允许铺垫，但每段都要有明确论点。',
      expressions: '这背后真正的问题是...\n我们不妨换一个角度看\n这不是单点技巧，而是系统问题',
      banned: '强行煽动\n标题党断言\n没有案例的空泛结论',
      confirmed: false
    })
  },
  {
    id: 'style-dy-review',
    name: '测评种草账号',
    platform: '抖音',
    contentType: '测评',
    scene: '工具/产品种草',
    status: '待分析',
    usedCount: 3,
    tags: ['测评', '对比', '种草'],
    samples: [
      makeSample('我连续用了三天这个工具，最意外的不是它功能多，而是它真的少了很多废操作。'),
      makeSample('如果你只看官网介绍，很难判断它好不好用，所以我直接拿真实项目试了一遍。'),
      makeSample('这个功能看起来不起眼，但对每天批量做内容的人来说，可能才是最省时间的地方。'),
      makeSample('先说结论，它不是万能工具，但有三个场景确实值得放进工作流。'),
      makeSample('我把它和之前常用的方案对比了一下，差距主要在这几个细节。')
    ],
    styleCard: makeStyleCard({
      positioning: '偏真实体验的产品测评账号，用试用过程和对比细节降低营销感。',
      topics: '工具测评\n真实试用\n产品对比\n使用场景',
      titleStyle: '强调试用时长、真实场景和结论前置。',
      opening: '先给使用结论，再说明测评条件。',
      structure: '结论 → 真实场景 → 优缺点 → 适合人群 → 购买/使用建议',
      tone: '可信、克制、像朋友分享体验。',
      rhythm: '中短句结合，关键结论单独成句。',
      expressions: '先说结论\n我实际试了一遍\n它最适合的人是...\n不适合所有人',
      banned: '无脑夸\n夸大效果\n没有试用依据的推荐',
      confirmed: false
    })
  }
]

const saved = loadSaved()
const styles = ref(saved || seedStyles)
const selectedId = ref(styles.value[0]?.id || '')
const activeTab = ref('overview')
const platformFilter = ref('全部')
const statusFilter = ref('全部')
const searchText = ref('')
const showCreate = ref(false)
const showUpload = ref(false)
const previewSample = ref(null)
const sampleInput = ref('')
const analyzing = ref(false)

const draft = reactive({
  name: '',
  platform: '抖音',
  contentType: '口播',
  scene: ''
})

const platformFilters = ['全部', '抖音', 'B站']
const statusFilters = ['全部', '可用', '待确认', '待分析']
const tabs = [
  { key: 'overview', label: '总览' },
  { key: 'samples', label: '样本' },
  { key: 'styleCard', label: '风格卡' }
]

const selectedStyle = computed(() => styles.value.find(item => item.id === selectedId.value))
const enabledCount = computed(() => styles.value.filter(item => item.status === '可用').length)
const totalSamples = computed(() => styles.value.reduce((sum, item) => sum + item.samples.length, 0))
const sampleProgress = computed(() => {
  const count = selectedStyle.value?.samples.length || 0
  return Math.min(100, Math.round((count / 20) * 100))
})
const analyzeButtonLabel = computed(() => selectedStyle.value?.styleCard?.positioning ? '重新分析' : '分析风格')
const primaryAction = computed(() => {
  const style = selectedStyle.value
  if (!style) {
    return { key: 'none', icon: '·', title: '选择风格', hint: '先从左侧选择一个账号', label: '选择' }
  }

  const sampleCount = style.samples.length
  if (sampleCount < 10) {
    return {
      key: 'upload',
      icon: '+',
      title: '补充原文案样本',
      hint: `建议至少 10 篇，还差 ${10 - sampleCount} 篇`,
      label: '添加样本'
    }
  }

  if (!style.styleCard.positioning || style.status === '待分析') {
    return {
      key: 'analyze',
      icon: '⟳',
      title: '提炼账号风格',
      hint: '根据样本生成可编辑风格卡',
      label: '分析风格'
    }
  }

  if (!style.styleCard.confirmed) {
    if (activeTab.value === 'styleCard') {
      return {
        key: 'confirm',
        icon: '✓',
        title: '确认风格卡',
        hint: '保存后即可用于文案生成',
        label: '保存启用'
      }
    }
    return {
      key: 'review',
      icon: '→',
      title: '确认风格卡',
      hint: '先检查字段，再保存启用',
      label: '检查风格卡'
    }
  }

  return {
    key: 'generate',
    icon: '→',
    title: '风格已可用',
    hint: '可以进入生成工作台',
    label: '去生成'
  }
})

const filteredStyles = computed(() => {
  const kw = searchText.value.trim().toLowerCase()
  return styles.value.filter(item => {
    const platformOk = platformFilter.value === '全部' || item.platform === platformFilter.value
    const statusOk = statusFilter.value === '全部' || item.status === statusFilter.value
    const searchOk = !kw || [item.name, item.platform, item.contentType, item.scene, ...item.tags].join(' ').toLowerCase().includes(kw)
    return platformOk && statusOk && searchOk
  })
})

const stages = computed(() => {
  const style = selectedStyle.value
  const hasStyle = Boolean(style)
  const hasSamples = style?.samples.length >= 10
  const hasCard = Boolean(style?.styleCard?.positioning)
  const confirmed = Boolean(style?.styleCard?.confirmed)
  return [
    { index: 1, key: 'create', title: '新建账号', text: hasStyle ? style.name : '未选择', done: hasStyle, active: activeTab.value === 'overview' },
    { index: 2, key: 'samples', title: '上传样本', text: `${style?.samples.length || 0}/20 篇`, done: hasSamples, active: activeTab.value === 'samples' },
    { index: 3, key: 'card', title: '确认风格卡', text: confirmed ? '已启用' : (hasCard ? '待确认' : '未分析'), done: confirmed, active: activeTab.value === 'styleCard' },
    { index: 4, key: 'generate', title: '调用生成', text: `${style?.usedCount || 0} 次`, done: (style?.usedCount || 0) > 0, active: false }
  ]
})

watch(styles, () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(styles.value))
}, { deep: true })

function refreshStylesFromStorage() {
  const next = loadSaved()
  if (!next) return
  styles.value = next
  if (!styles.value.some(item => item.id === selectedId.value)) {
    selectedId.value = styles.value[0]?.id || ''
  }
}

function makeSample(content) {
  const text = content.trim()
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    title: text.slice(0, 24),
    content: text
  }
}

function makeStyleCard(card = {}) {
  return {
    positioning: card.positioning || '',
    topics: card.topics || '',
    titleStyle: card.titleStyle || '',
    opening: card.opening || '',
    structure: card.structure || '',
    tone: card.tone || '',
    rhythm: card.rhythm || '',
    expressions: card.expressions || '',
    banned: card.banned || '',
    sampleClues: card.sampleClues || '',
    confirmed: Boolean(card.confirmed)
  }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

function statusClass(status) {
  return {
    enabled: status === '可用',
    pending: status === '待确认',
    draft: status === '待分析'
  }
}

function selectStyle(id) {
  selectedId.value = id
  activeTab.value = 'overview'
}

function createStyle() {
  if (!draft.name.trim()) return
  const style = {
    id: `style-${Date.now()}`,
    name: draft.name.trim(),
    platform: draft.platform,
    contentType: draft.contentType,
    scene: draft.scene.trim(),
    status: '待分析',
    usedCount: 0,
    tags: [draft.platform, draft.contentType].concat(draft.scene ? [draft.scene] : []),
    samples: [],
    styleCard: makeStyleCard()
  }
  styles.value.unshift(style)
  selectedId.value = style.id
  Object.assign(draft, { name: '', platform: '抖音', contentType: '口播', scene: '' })
  showCreate.value = false
  activeTab.value = 'samples'
}

function openUpload() {
  sampleInput.value = ''
  showUpload.value = true
}

function addSamples() {
  const style = selectedStyle.value
  if (!style || !sampleInput.value.trim()) return
  const chunks = sampleInput.value
    .split(/\n\s*---+\s*\n|\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
  chunks.forEach(chunk => style.samples.push(makeSample(chunk)))
  style.status = '待分析'
  style.styleCard.confirmed = false
  showUpload.value = false
  activeTab.value = 'samples'
}

function removeSample(id) {
  const style = selectedStyle.value
  if (!style) return
  style.samples = style.samples.filter(sample => sample.id !== id)
  style.status = '待分析'
  style.styleCard.confirmed = false
}

async function runAnalyze() {
  const style = selectedStyle.value
  if (!style) return
  if (!style.samples.length) {
    showToast('请先添加样本文案，再用 GPT-5.5 分析风格', 'error')
    return
  }
  if (analyzing.value) return
  analyzing.value = true
  try {
    await saveAccountStyles(styles.value)
    const data = await analyzeAccountStyle(style.id, 'gpt-5.5')
    const nextStyle = data.style
    const index = styles.value.findIndex(item => item.id === style.id)
    if (nextStyle && index >= 0) {
      styles.value[index] = nextStyle
    } else if (data.styleCard) {
      style.styleCard = makeStyleCard(data.styleCard)
      style.status = '待确认'
    }
    activeTab.value = 'styleCard'
    showToast('GPT-5.5 已生成账号风格卡', 'success')
  } catch (e) {
    showToast('GPT-5.5 风格分析失败：' + (e.message || e), 'error')
  } finally {
    analyzing.value = false
  }
}

function confirmStyle() {
  const style = selectedStyle.value
  if (!style) return
  style.styleCard.confirmed = true
  style.status = '可用'
}

function handlePrimaryAction() {
  const action = primaryAction.value.key
  if (action === 'upload') {
    openUpload()
    return
  }
  if (action === 'analyze') {
    runAnalyze()
    return
  }
  if (action === 'review') {
    activeTab.value = 'styleCard'
    return
  }
  if (action === 'confirm') {
    confirmStyle()
    return
  }
  if (action === 'generate') {
    goGenerate()
  }
}

function goGenerate() {
  const style = selectedStyle.value
  if (!style) return
  localStorage.setItem('usagi_copygen_selected_style_id', style.id)
  window.dispatchEvent(new CustomEvent('usagi:copygen-style', { detail: { styleId: style.id } }))
  window.dispatchEvent(new CustomEvent('usagi:navigate', { detail: { module: 'copygen' } }))
}

onMounted(() => {
  window.addEventListener('usagi:styles-updated', refreshStylesFromStorage)
})

onUnmounted(() => {
  window.removeEventListener('usagi:styles-updated', refreshStylesFromStorage)
})
</script>

<style scoped>
.account-style-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.style-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
}

.style-header h2 {
  font-size: 20px;
  font-weight: 750;
  line-height: 1.2;
  color: var(--text);
  margin: 0;
}

.header-actions,
.operation-actions,
.toolbar-actions,
.modal-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.metric-strip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.metric-item {
  min-width: 70px;
  height: 32px;
  padding: 0 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--chip-bg);
}

.metric-item span {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}

.metric-item em {
  font-style: normal;
  color: var(--text-muted);
  font-size: 10px;
}

.style-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 16px;
}

.style-sidebar,
.summary-panel,
.samples-panel,
.style-card-editor {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.style-sidebar {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  overflow: hidden;
}

.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sidebar-head strong {
  display: block;
  color: var(--text);
  font-size: 14px;
  line-height: 1.25;
}

.sidebar-head span {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.filter-panel {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.filter-group {
  display: grid;
  gap: 6px;
}

.filter-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.filter-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-chip,
.tab-btn,
.style-list-item,
.sample-preview,
.sample-row-main {
  font-family: inherit;
}

.filter-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 10px;
  background: var(--surface2);
  color: var(--text-dim);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.filter-chip:hover,
.filter-chip.active {
  color: var(--text);
  border-color: var(--border-mid);
  background: var(--surface3);
}

.search-box {
  height: 38px;
  flex: 0 0 auto;
}

.style-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-right: 2px;
}

.style-list-item {
  width: 100%;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}

.style-list-item:hover {
  border-color: var(--border-mid);
  background: var(--surface2);
}

.style-list-item.active {
  border-color: var(--primary);
  background: var(--surface2);
  transform: translateX(2px);
}

.platform-mark,
.identity-logo {
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

.platform-mark.douyin,
.identity-logo.douyin {
  background: #111827;
  border: 1px solid rgba(148, 163, 184, 0.28);
  color: #f8fafc;
}

.platform-mark.bili,
.identity-logo.bili {
  background: linear-gradient(135deg, #2563eb, #60a5fa);
}

.style-list-body {
  min-width: 0;
}

.style-list-body strong {
  display: block;
  font-size: 13px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.style-list-body small {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 3px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-style: normal;
  font-size: 10px;
  border-radius: 999px;
  padding: 3px 7px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  white-space: nowrap;
}

.status-badge.enabled {
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.08);
}

.status-badge.pending {
  color: #d97706;
  border-color: rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.08);
}

.status-badge.draft {
  color: #2563eb;
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.08);
}

.style-detail {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.detail-head {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(360px, 460px);
  align-items: stretch;
  gap: 18px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.identity-block {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding-right: 2px;
}

.identity-block h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.25;
  color: var(--text);
}

.detail-meta {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.detail-meta span {
  color: var(--text-muted);
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 11px;
}

.operation-area {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "status actions"
    "meter actions";
  align-items: center;
  gap: 10px 14px;
  padding-left: 18px;
  border-left: 1px solid var(--border);
}

.operation-status {
  grid-area: status;
  min-width: 0;
}

.operation-kicker {
  display: block;
  margin-bottom: 3px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
}

.operation-status strong {
  display: block;
  color: var(--text);
  font-size: 14px;
  line-height: 1.35;
}

.operation-status small {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.operation-meter {
  grid-area: meter;
  display: grid;
  gap: 7px;
}

.operation-meter-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.operation-meter-top span {
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 700;
}

.operation-meter-bar {
  position: relative;
  display: block;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface2);
}

.operation-meter-bar::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--sample-progress, 0%);
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), var(--primary));
}

.operation-actions {
  grid-area: actions;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
  gap: 8px;
  width: 226px;
}

.operation-actions .btn {
  width: 100%;
  min-width: 0;
  padding-left: 10px;
  padding-right: 10px;
}

.operation-primary {
  grid-column: 1 / -1;
  min-width: 104px;
}

.stage-track {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.stage-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 9px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.stage-item.active {
  border-color: var(--border-mid);
  background: var(--surface);
}

.stage-item.done .stage-dot {
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.3);
}

.stage-dot {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--border-mid);
  color: var(--primary-light);
  font-size: 11px;
  font-weight: 800;
  flex: 0 0 auto;
}

.stage-item strong {
  display: block;
  font-size: 12px;
  color: var(--text);
}

.stage-item small {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-row {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 4px;
  width: fit-content;
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
}

.tab-btn {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  padding: 7px 13px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.tab-btn:hover,
.tab-btn.active {
  color: var(--text);
  border-color: var(--border);
  background: var(--surface2);
}

.overview-grid,
.samples-panel,
.style-card-editor {
  min-height: 0;
}

.overview-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1.4fr 0.8fr;
  grid-auto-rows: minmax(150px, auto);
  gap: 12px;
  overflow-y: auto;
}

.summary-panel {
  padding: 14px;
  overflow: hidden;
}

.summary-panel.wide {
  grid-column: span 1;
}

.panel-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 12px;
}

.summary-lines {
  display: grid;
  gap: 12px;
}

.summary-lines span,
.field-block span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 6px;
}

.summary-lines p {
  margin: 0;
  font-size: 13px;
  color: var(--text);
  line-height: 1.65;
}

.health-list {
  display: grid;
  gap: 10px;
}

.health-list div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border);
}

.health-list div:last-child {
  border-bottom: none;
}

.health-list span {
  font-size: 12px;
  color: var(--text-muted);
}

.health-list strong {
  font-size: 13px;
  color: var(--text);
}

.health-list strong.warn {
  color: #d97706;
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-cloud span {
  font-size: 12px;
  color: #2563eb;
  background: rgba(96, 165, 250, 0.1);
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 999px;
  padding: 5px 10px;
}

.sample-preview-list,
.sample-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sample-preview,
.sample-row {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.sample-preview {
  width: 100%;
  display: grid;
  gap: 5px;
  padding: 10px 12px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.sample-preview strong,
.sample-row-main strong {
  font-size: 13px;
  color: var(--text);
}

.sample-preview strong {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sample-preview span,
.sample-row-main span {
  min-width: 0;
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.samples-panel,
.style-card-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.panel-toolbar.compact {
  padding: 0 0 12px;
  border-bottom: none;
}

.panel-toolbar strong {
  display: block;
  color: var(--text);
  font-size: 14px;
}

.panel-toolbar span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 2px;
}

.sample-table {
  padding: 12px;
  overflow-y: auto;
}

.sample-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
  align-items: center;
}

.sample-row-main {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  background: transparent;
  border: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.icon-action {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface2);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
}

.icon-action:hover {
  color: var(--text);
  border-color: var(--border-mid);
}

.icon-action.danger:hover {
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.35);
}

.editor-grid {
  padding: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  overflow-y: auto;
}

.field-block {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.field-block.wide {
  grid-column: 1 / -1;
}

.style-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  backdrop-filter: blur(6px);
}

.style-modal-box {
  width: min(560px, 100%);
  background: var(--surface);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.upload-box {
  width: min(720px, 100%);
}

.preview-box {
  width: min(680px, 100%);
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-head strong {
  color: var(--text);
  font-size: 15px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.paste-area {
  min-height: 260px;
}

.preview-content {
  margin: 0;
  color: var(--text);
  line-height: 1.8;
  white-space: pre-wrap;
}

.empty-state {
  padding: 28px 12px;
  text-align: center;
  color: var(--text-muted);
}

.empty-title {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 4px;
}

.empty-sub {
  font-size: 12px;
}

@media (max-width: 1180px) {
  .style-layout {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .detail-head {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .operation-area {
    padding-left: 0;
    padding-top: 12px;
    border-left: none;
    border-top: 1px solid var(--border);
  }

  .stage-track,
  .overview-grid {
    grid-template-columns: 1fr;
  }

  .editor-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .style-header,
  .detail-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .style-layout {
    grid-template-columns: 1fr;
  }

  .operation-area {
    grid-template-columns: 1fr;
    grid-template-areas:
      "status"
      "meter"
      "actions";
  }

  .operation-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .style-sidebar {
    max-height: 360px;
  }

  .metric-strip {
    width: 100%;
  }
}
</style>
