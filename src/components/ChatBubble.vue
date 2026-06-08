<template>
  <div class="usagi-chat" :class="petMoodClass">
    <button
      v-if="!open"
      type="button"
      class="pet-button"
      aria-label="打开乌萨奇 AI 助手"
      title="乌萨奇 AI 助手"
      @mouseenter="wakePet"
      @focus="wakePet"
      @click="openChat">
      <span class="pet-glow"></span>
      <img class="pet-image" :src="petImage" alt="乌萨奇 AI 助手" />
      <span class="pet-sleep-mark pet-sleep-one">Z</span>
      <span class="pet-sleep-mark pet-sleep-two">z</span>
      <span class="pet-dream-dot pet-dream-one"></span>
      <span class="pet-dream-dot pet-dream-two"></span>
      <span class="pet-chip">AI</span>
    </button>

    <section v-else class="chat-panel" aria-label="乌萨奇 AI 助手">
      <header class="chat-head">
        <div class="mini-pet" aria-hidden="true">
          <img :src="petImage" alt="" />
        </div>
        <div class="chat-title">
          <strong>乌萨奇 AI</strong>
          <span>{{ activeModuleLabel }} · {{ modelLabel }}</span>
        </div>
        <button type="button" class="chat-close" aria-label="关闭" @click="closeChat">×</button>
      </header>

      <div class="quick-actions">
        <button v-for="action in quickActions" :key="action.text" type="button" @click="useQuickAction(action.text)">
          {{ action.label }}
        </button>
      </div>

      <div ref="msgsRef" class="chat-messages">
        <div v-for="(msg, i) in messages" :key="i" class="message" :class="msg.role">
          <span>{{ msg.content }}</span>
        </div>
        <div v-if="loading" class="message bot loading">
          <span>呜啦呜啦，正在翻资料...</span>
        </div>
      </div>

      <form class="chat-form" @submit.prevent="send">
        <input v-model="input" class="chat-input" placeholder="问我数据、文案、热点、排期..." :disabled="loading" />
        <button type="submit" class="send-button" :disabled="loading || !input.trim()">
          {{ loading ? '...' : '↑' }}
        </button>
      </form>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { chatMinimax, searchVector } from '../api/tools'
import { ALL_MODULE_DEFINITIONS } from '../permissions'
import usagiIdleImage from '../assets/usagi-pet-states/idle.png'
import usagiHappyImage from '../assets/usagi-pet-states/happy.png'
import usagiSleepImage from '../assets/usagi-pet-states/sleep.png'
import usagiPanicImage from '../assets/usagi-pet-states/panic.png'
import usagiSignImage from '../assets/usagi-pet-states/sign.png'

const props = defineProps({
  activeModule: {
    type: String,
    default: 'dailyhot'
  }
})

const DEFAULT_MODEL = 'gpt-5.5'
const open = ref(false)
const input = ref('')
const loading = ref(false)
const petMood = ref('idle')
const msgsRef = ref(null)
let sleepTimer = null
let napTimer = null
let feedbackTimer = null
const messages = ref([
  {
    role: 'bot',
    content: '呀哈，我是乌萨奇 AI。你丢任务，我去蹦跶：找资料、切工作流、看数据、拆文案，都能试试。'
  }
])

const moduleAliases = {
  accountmonitor: '账号热榜',
  dailyhot: '每日热点',
  tools: '文案工具',
  copygen: '文案工具',
  workflow: '文案工作流',
  styleCollect: '账号库',
  styleLibrary: '账号库',
  styleProjectWorkbench: '项目工作台',
  styleProjects: '项目工作台',
  styleWriter: '对话写作',
  styleCopyTools: '项目工作台',
  styleAssets: '评论生成',
  styleGrossMargin: '数据维护',
  styleDrafts: '对话写作',
  ideoboard: '创意看板',
  schedule: '排期看板',
  ops: '流水看板',
  imagegen: 'AI 生图',
  posttools: '后期工具',
  videopublish: '视频发布',
  material: '素材库',
  smartcollect: '智能采集',
  vector: '向量库',
  adminUsers: '权限管理',
  operationLogs: '操作日志'
}

const moduleHints = [
  { id: 'accountmonitor', words: ['账号热榜', '账号监控', '账号榜', '爆款账号'] },
  { id: 'dailyhot', words: ['热点', '热榜', '每日热点', '选题'] },
  { id: 'tools', words: ['工具', '转写', '抖音', 'b站', '评论'] },
  { id: 'copygen', words: ['文案工具', '发布文案', '封面标题', '简介'] },
  { id: 'workflow', words: ['工作流', '流程', '拆解', '分析', '转写', '炸创意', '生成文案'] },
  { id: 'styleLibrary', words: ['账号库', '风格库', '账号风格'] },
  { id: 'styleProjectWorkbench', words: ['项目工作台', '项目库', '商单项目', '项目资料', '文案素材', '素材转写', '链接转写'] },
  { id: 'styleWriter', words: ['对话写作', '写作'] },
  { id: 'styleAssets', words: ['评论生成', '评论', '弹幕'] },
  { id: 'styleGrossMargin', words: ['数据维护', '毛利维护', '维护模板', '差额', '单价'] },
  { id: 'ideoboard', words: ['创意', '便签', '灵感'] },
  { id: 'schedule', words: ['排期', '任务', '日历'] },
  { id: 'ops', words: ['流水', '毛利', '数据', '利润'] },
  { id: 'imagegen', words: ['生图', '图片', '画图'] },
  { id: 'material', words: ['素材', '素材库', '文件'] },
  { id: 'smartcollect', words: ['智能采集', '采集', '收集'] },
  { id: 'videopublish', words: ['视频发布', '发布管理', '发视频'] },
  { id: 'posttools', words: ['后期工具', '后期', '剪辑工具'] },
  { id: 'vector', words: ['向量', '知识库', '检索'] },
  { id: 'adminUsers', words: ['权限', '用户管理', '账号权限'] },
  { id: 'operationLogs', words: ['操作日志', '日志'] }
]

const moduleAgentRoutes = [
  { id: 'accountmonitor', label: '账号热榜', words: ['账号热榜', '账号监控', '爆款账号'], next: '看账号表现、爆款标签和重点关注账号；点中账号后可以继续送进文案工作流拆解。' },
  { id: 'dailyhot', label: '每日热点', words: ['热点', '热榜', '每日热点', '今日热点', '今天热点', '选题池'], next: '浏览热点列表；点中具体热点后我可以继续拆切入点、框架和选题角度。' },
  { id: 'tools', label: '文案工具', words: ['文案工具', '转写工具', '评论工具', '抖音转写', 'b站转写'], next: '处理单条转写、评论和基础文案工具；复杂多步骤写作建议进文案工作流。' },
  { id: 'copygen', label: '文案工具', words: ['发布文案', '封面标题', '视频简介', '发布推荐'], next: '生成发布文案、封面标题和视频简介。' },
  { id: 'workflow', label: '文案工作流', words: ['文案工作流', '工作流', '拆解', '炸创意', '生成文案', '信息采集'], next: '按信息采集、汇总、分析、确认创意、生成文案推进。' },
  { id: 'styleLibrary', label: '账号库', words: ['账号库', '风格库', '账号风格', '风格采集', '账号采集'], next: '查看账号视频、转写稿和账号风格资料。' },
  { id: 'styleProjectWorkbench', label: '项目工作台', words: ['项目工作台', '项目库', '商单项目', '项目资料', '文案素材', '素材转写', '链接转写'], next: '管理项目资料、素材池和项目风格卡。' },
  { id: 'styleWriter', label: '对话写作', words: ['对话写作', '风格写作', '按风格写'], next: '选择账号风格后进行对话式写作。' },
  { id: 'styleAssets', label: '评论生成', words: ['评论生成', '评论', '弹幕'], next: '基于草稿、粘贴文案或视频链接生成评论池。' },
  { id: 'styleGrossMargin', label: '数据维护', words: ['数据维护', '毛利维护', '维护模板', '差额', '单价'], next: '维护单价表，并按模板查询当前数据差额。' },
  { id: 'ideoboard', label: '创意看板', words: ['创意看板', '创意', '便签', '灵感'], next: '记录、编辑和推进创意卡片。' },
  { id: 'schedule', label: '排期看板', words: ['排期', '排期看板', '任务', '日历', '本周活'], next: '查看人员任务、周视图和未完成任务。' },
  { id: 'ops', label: '流水看板', words: ['流水看板', '流水', '毛利', '业绩', '利润', '业务数据'], next: '查看组别流水、毛利目标、完成率和账号贡献。' },
  { id: 'imagegen', label: 'AI 生图', words: ['生图', 'ai生图', '图片生成', '画图', '封面图'], next: '生成图片并查看历史记录。' },
  { id: 'posttools', label: '后期工具', words: ['后期工具', '后期', '剪辑工具', '视频处理'], next: '进入后期工具，检查可用工具和处理流程。' },
  { id: 'videopublish', label: '视频发布', words: ['视频发布', '发布视频', '发布管理', '定时发布'], next: '配置发布文案、封面标题、简介和发布时间。' },
  { id: 'material', label: '素材库', words: ['素材库', '素材', '文件库', '资料库'], next: '查看、筛选和管理素材文件。' },
  { id: 'smartcollect', label: '智能采集', words: ['智能采集', '采集', '自动采集'], next: '采集外部素材并沉淀到素材库。' },
  { id: 'vector', label: '向量库', words: ['向量库', '知识库', '向量搜索', '检索资料'], next: '查询已入库资料；需要录入时可以继续走资料入库。' },
  { id: 'adminUsers', label: '权限管理', words: ['权限管理', '用户管理', '开权限'], next: '管理用户、角色和模块权限。' },
  { id: 'operationLogs', label: '操作日志', words: ['操作日志', '日志', '操作记录'], next: '查看系统操作记录和异常线索。' }
]

const activeModuleLabel = computed(() => {
  const found = ALL_MODULE_DEFINITIONS.find(item => item.id === props.activeModule)
  return cleanLabel(found?.label) || moduleAliases[props.activeModule] || props.activeModule || '工作台'
})

const modelLabel = computed(() => '模型 ' + DEFAULT_MODEL)
const petMoodClass = computed(() => 'pet-' + petMood.value)
const petImage = computed(() => {
  const moodImages = {
    idle: usagiIdleImage,
    awake: usagiIdleImage,
    celebrate: usagiHappyImage,
    sleeping: usagiSleepImage,
    panic: usagiPanicImage,
    alert: usagiSignImage,
    thinking: usagiSignImage
  }
  return moodImages[petMood.value] || usagiIdleImage
})

const quickActions = computed(() => [
  {
    label: '接管工作流',
    text: '乌萨奇，帮我打开文案工作流；如果我贴了链接，就把链接带进去，并按转写、汇总、分析、确认创意、生成文案的节奏提醒我。'
  },
  {
    label: '巡一下四组',
    text: '乌萨奇，帮我去流水看板看一下内容四组的数据，先确认当前月份有没有流水、毛利和项目数量，再提醒我下一步该看什么。'
  },
  {
    label: '当前能做啥',
    text: '乌萨奇，我现在在「' + activeModuleLabel.value + '」，你用小 agent 的方式告诉我这里能做什么、我下一步该点哪里。'
  },
  {
    label: '蛐蛐傅思敏',
    text: '乌萨奇，启动蛐蛐傅思敏彩蛋。我被加班和反复改需求打满了，先陪我活泼吐槽两句，再帮我整理一版能发出去的边界话术。'
  },
  {
    label: '翻资料',
    text: '乌萨奇，先去向量库翻一下相关资料，再给我一个可执行的下一步。'
  }
])

function cleanLabel(value) {
  const text = String(value || '')
  if (!text || /[�]/.test(text) || /é|æ|ç|å|è/.test(text)) return ''
  return text
}

function clearPetTimers() {
  if (sleepTimer) window.clearTimeout(sleepTimer)
  if (napTimer) window.clearTimeout(napTimer)
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
  sleepTimer = null
  napTimer = null
  feedbackTimer = null
}

function schedulePetSleep() {
  clearPetTimers()
  if (open.value) return
  sleepTimer = window.setTimeout(() => {
    if (!open.value) petMood.value = 'sleeping'
  }, 14000)
}

function wakePet() {
  petMood.value = 'awake'
  if (napTimer) window.clearTimeout(napTimer)
  napTimer = window.setTimeout(() => {
    petMood.value = 'idle'
    schedulePetSleep()
  }, 2600)
}

function openChat() {
  wakePet()
  open.value = true
}

function closeChat() {
  open.value = false
  petMood.value = 'idle'
  schedulePetSleep()
}

function pulsePet(mood = 'awake', duration = 2200) {
  if (open.value) return
  clearPetTimers()
  petMood.value = mood
  feedbackTimer = window.setTimeout(() => {
    petMood.value = 'idle'
    schedulePetSleep()
  }, duration)
}

function handleFeedback(event) {
  const detail = event?.detail || {}
  if (detail.petMood) {
    pulsePet(detail.petMood)
    return
  }
  if (detail.kind === 'handoff') return pulsePet('alert', 3600)
  if (detail.type === 'error') return pulsePet('panic', 3200)
  if (detail.type === 'warning') return pulsePet('alert', 2600)
  if (detail.kind === 'generate' || detail.kind === 'ai') return pulsePet('thinking', 2800)
  if (detail.type === 'success') return pulsePet('celebrate', 2300)
}

function useQuickAction(text) {
  input.value = text
  send()
}

onMounted(() => {
  schedulePetSleep()
  window.addEventListener('usagi:feedback', handleFeedback)
})

onUnmounted(() => {
  clearPetTimers()
  window.removeEventListener('usagi:feedback', handleFeedback)
})

function scrollBottom() {
  nextTick(() => {
    if (msgsRef.value) msgsRef.value.scrollTop = msgsRef.value.scrollHeight
  })
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function extractUrls(text) {
  const raw = String(text || '')
  const matches = raw.match(/https?:\/\/[^\s，。！？、）)]+/gi) || []
  return matches.map(url => url.replace(/[，。！？、）)]+$/g, ''))
}

function hasWorkflowIntent(text) {
  return /(文案工作流|工作流|拆解|分析|转写|炸创意|生成文案|跑流程|带进去|预填)/.test(String(text || ''))
}

function hasVentingIntent(text) {
  const raw = String(text || '')
  return /(吐槽|加班|外耗|领导|老板|上级|崩溃|烦死|干不完|回血|破防|委屈|傅思敏)/.test(raw)
}

function detectSchedulePerson(text) {
  const raw = String(text || '')
  const known = ['陈健伊', '姚希', '宋丽佳', '林宇辰', '傅思敏']
  const exact = known.find(name => raw.includes(name))
  if (exact) return exact
  const match = raw.match(/([\u4e00-\u9fa5]{2,4})(?:这周|本周|还有|没干完|未完成|任务|活)/)
  return match?.[1] || ''
}

function hasScheduleTodoIntent(text) {
  const raw = String(text || '')
  return /(这周|本周|本星期|本周内)/.test(raw)
    && /(还有什么|还有哪些|没干完|未完成|待完成|没做完|剩什么|什么活|任务|活|要干什么|要做什么|做什么|干什么|排了什么|安排了什么)/.test(raw)
}

function wantsUnfinishedOnly(text) {
  return /(还有什么|还有哪些|没干完|未完成|待完成|没做完|剩什么|没闭环|延期)/.test(String(text || ''))
}

const agentGroups = [
  { id: 1, label: '内容一组', words: ['一组', '内容一组'] },
  { id: 2, label: '内容二组', words: ['二组', '内容二组'] },
  { id: 3, label: '内容三组', words: ['三组', '内容三组'] },
  { id: 4, label: '内容四组', words: ['四组', '内容四组'] },
  { id: 5, label: '内容五组', words: ['五组', '内容五组'] },
  { id: 6, label: '内容六组', words: ['六组', '内容六组'] }
]

function detectContentGroup(text) {
  const raw = String(text || '')
  return agentGroups.find(group => group.words.some(word => raw.includes(word))) || null
}

function detectMonthPayload(text) {
  const raw = String(text || '')
  const now = new Date()
  const exact = raw.match(/(\d{1,2})\s*月/)
  if (exact) return { year: now.getFullYear(), month: Math.max(1, Math.min(12, Number(exact[1]))) }
  if (/上月|上个月/.test(raw)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function hasOpsPerformanceIntent(text) {
  const raw = String(text || '')
  return !!detectContentGroup(raw)
    && /(业绩|流水|毛利|数据|业务|完成率|收入|利润|怎么样|如何|看一下|查一下|巡一下)/.test(raw)
}

function hasHotIntent(text) {
  const raw = String(text || '')
  return /(热点|热榜|今日热|今天热|每日热点|选题池)/.test(raw)
}

function hasExplicitModuleIntent(text) {
  const raw = String(text || '')
  return /(打开|进入|切到|跳到|去|看一下|查一下|帮我看|测试一下|用一下|在哪|怎么用|能做什么|继续做|管理|录入|编辑)/.test(raw)
}

function detectModuleRoute(text) {
  const raw = String(text || '').toLowerCase()
  const matched = moduleAgentRoutes
    .map(route => ({
      route,
      score: route.words.reduce((sum, word) => sum + (raw.includes(String(word).toLowerCase()) ? String(word).length : 0), 0)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.route
  if (!matched) return null
  if (hasExplicitModuleIntent(text) || raw.length <= 18) return matched
  return null
}

function detectAgentAction(text) {
  const raw = String(text || '')
  const urls = extractUrls(raw)
  if (hasScheduleTodoIntent(raw)) {
    const person = detectSchedulePerson(raw) || '陈健伊'
    const unfinishedOnly = wantsUnfinishedOnly(raw)
    return {
      type: 'schedule:person-week-todos',
      module: 'schedule',
      payload: { person, weekOffset: 0, unfinishedOnly },
      message: unfinishedOnly
        ? '呀哈，收到。我直接去排期看板查 ' + person + ' 本周还没闭环的任务，不在这里空口判断。'
        : '呀哈，收到。我直接去排期看板查 ' + person + ' 本周要做什么，不让你手动筛。'
    }
  }
  if (hasOpsPerformanceIntent(raw)) {
    const group = detectContentGroup(raw) || agentGroups[3]
    const monthPayload = detectMonthPayload(raw)
    return {
      type: 'ops:monthly-performance',
      module: 'ops',
      payload: { groupId: group.id, groupLabel: group.label, ...monthPayload },
      message: '呜啦，我直接去流水看板查 ' + group.label + ' ' + monthPayload.month + ' 月业绩，不在这里凭感觉讲。'
    }
  }
  if (hasHotIntent(raw)) {
    return {
      type: 'dailyhot:open',
      module: 'dailyhot',
      message: '呀哈，我先打开每日热点。热点模块目前主要是页面浏览入口；等你点中具体热点，我可以继续帮你拆切入点、框架和选题角度。'
    }
  }
  const moduleRoute = detectModuleRoute(raw)
  if (moduleRoute && moduleRoute.id !== 'workflow') {
    return {
      type: 'module:open',
      module: moduleRoute.id,
      payload: { moduleId: moduleRoute.id, label: moduleRoute.label, next: moduleRoute.next },
      message: '呀哈，我先打开「' + moduleRoute.label + '」。' + moduleRoute.next
    }
  }
  if (hasWorkflowIntent(raw) || urls.length || moduleRoute?.id === 'workflow') {
    return {
      type: 'workflow:open',
      module: 'workflow',
      urls,
      message: urls.length
        ? '呀哈，已切到文案工作流，并把链接带到输入区。下一步建议先跑转写，再看分析报告；炸创意前先确认方向，别一口气冲太远。'
        : '呀哈，已切到文案工作流。你先贴视频或飞书链接，我会按输入、转写、汇总、分析、确认创意、生成文案的节奏推进。'
    }
  }
  return null
}

function waitForAgentResult(id, timeout = 2200) {
  return new Promise(resolve => {
    let done = false
    const finish = result => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      window.removeEventListener('usagi:agent-result', onResult)
      resolve(result)
    }
    const onResult = event => {
      const detail = event.detail || {}
      if (detail.id === id) finish(detail)
    }
    const timer = window.setTimeout(() => finish(null), timeout)
    window.addEventListener('usagi:agent-result', onResult)
  })
}

async function performAgentAction(action, sourceText) {
  if (!action) return false
  if (action.module) {
    window.dispatchEvent(new CustomEvent('usagi:navigate', { detail: { module: action.module } }))
  }

  if (action.type === 'dailyhot:open' || action.type === 'module:open') {
    messages.value.push({ role: 'bot', content: action.message })
    return true
  }

  if (action.type === 'workflow:open') {
    const firstUrl = action.urls?.[0] || ''
    if (firstUrl) {
      try {
        localStorage.setItem('usagi_workflow_prefill_url', firstUrl)
      } catch (e) {}
      await wait(360)
      window.dispatchEvent(new CustomEvent('usagi:workflow-prefill', { detail: { url: firstUrl, text: sourceText } }))
    }
    const extra = action.urls?.length > 1
      ? '\n\n我先带入第 1 条链接；多链接批量预填后面再接，先别把输入区搞乱，稳一点。'
      : ''
    messages.value.push({ role: 'bot', content: action.message + extra })
    return true
  }

  if (action.type === 'schedule:person-week-todos') {
    messages.value.push({ role: 'bot', content: action.message })
    await wait(420)
    const id = 'usagi-' + Date.now() + '-' + Math.random().toString(16).slice(2)
    const detail = {
      id,
      module: action.module,
      type: action.type,
      payload: action.payload || {}
    }
    try {
      localStorage.setItem('usagi_pending_schedule_action', JSON.stringify(detail))
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('usagi:agent-action', { detail }))
    const result = await waitForAgentResult(id, 3200)
    if (result?.message) {
      messages.value.push({ role: 'bot', content: result.message })
    } else {
      messages.value.push({
        role: 'bot',
        content: '我已经打开排期看板了，但还没收到筛选回执。你可以看本周人员视图里对应负责人的未完成卡片。'
      })
    }
    return true
  }

  if (action.type === 'ops:switch-group' || action.type === 'ops:monthly-performance') {
    messages.value.push({ role: 'bot', content: action.message })
    await wait(420)
    const id = 'usagi-' + Date.now() + '-' + Math.random().toString(16).slice(2)
    const detail = {
      id,
      module: action.module,
      type: action.type,
      payload: action.payload || {}
    }
    try {
      localStorage.setItem('usagi_pending_ops_action', JSON.stringify(detail))
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('usagi:agent-action', { detail }))
    const result = await waitForAgentResult(id, 3600)
    messages.value.push({
      role: 'bot',
      content: result?.message || '我已经打开流水看板了，但还没收到数据回执。你可以先看当前筛选后的 KPI 卡片。'
    })
    return true
  }

  return false
}

function detectTargetModule(text) {
  const lower = String(text || '').toLowerCase()
  return moduleHints.find(item => item.words.some(word => lower.includes(word.toLowerCase())))?.id || ''
}

function formatVectorContext(results) {
  const items = Array.isArray(results) ? results.slice(0, 4) : []
  if (!items.length) return ''
  return items.map((item, index) => {
    const title = item.title || item.source_title || item.account || '资料 ' + (index + 1)
    const body = item.summary || item.content || item.original_text || item.text || item.golden_line || ''
    return (index + 1) + '. ' + title + '\n' + String(body).slice(0, 420)
  }).join('\n\n')
}

async function loadKnowledgeContext(text) {
  try {
    const data = await searchVector({
      query: text,
      collection: 'anythingllm_md_v2',
      limit: 4,
      min_score: 1
    })
    return formatVectorContext(data.results)
  } catch (e) {
    return ''
  }
}

function buildSystemPrompt(context, targetModule, ventingMode = false) {
  const navigationLine = targetModule
    ? '用户可能想打开模块：' + (moduleAliases[targetModule] || targetModule) + '。如果确实需要跳转，请先说明建议去哪里，再给下一步建议。'
    : '如果用户的问题适合某个模块，请明确告诉用户该去哪个模块。'

  const ventingLine = ventingMode
    ? '当前进入“蛐蛐傅思敏”彩蛋模式：先用自然、活泼、像同事陪伴的方式接住用户对加班和反复改需求的吐槽，可以更有内部玩梗感，再给可执行的边界话术。不要机械模板化，也不要升级成人身攻击。'
    : ''

  return [
    '你是平台右下角的乌萨奇 AI 助手。角色灵感是 Chiikawa 里的乌萨奇：高能、跳脱、行动力强，有点怪但很机灵。',
    '说话可以活泼可爱一点，比如“呀哈，收到”“呜啦，我去看看”，但不要过度，不要模仿原作台词，不要自称官方角色。',
    '你是 web 小 agent：先判断用户想去哪里、能不能替用户执行，再决定聊天回答。每次都要落到具体动作。',
    '先做意图路由：识别模块、对象、时间范围和指标；排期任务查排期看板，组别业绩/流水/毛利查流水看板，热点相关打开每日热点；其他模块先精准打开并说明下一步。',
    '对于“某人这周还有什么没干完/任务状态”这类问题，优先通过排期看板 agent 动作查询，不要只给用户筛选建议。查不到回执时再说明需要看排期数据。',
    '对于“某组这个月业绩/流水/毛利怎么样”这类问题，优先通过流水看板 agent 动作查询并回传摘要，不要只告诉用户去筛选。',
    '对于文案工作流，要按输入源、转写、汇总、背景搜索、平台素材、分析报告、确认创意、生成文案、发布推荐来组织回答；炸创意前必须提醒用户确认方向。',
    '你熟悉平台模块：热点、文案工具、文案工作流、账号风格、向量库、素材库、流水看板、排期和后期工具。',
    '回答业务问题时，优先围绕切入点、框架、论据、结尾、发布表达、执行步骤来拆。',
    '用户吐槽加班、外耗、领导或具体同事时，可以用活泼语气接住情绪，但不要攻击或羞辱真实个人；重点转成优先级、边界话术、协作风险和下一步动作。',
    ventingLine,
    '不要编造数据；资料不足就直接说缺什么。',
    '当前用户所在模块：' + activeModuleLabel.value + '。',
    '当前对话模型：' + DEFAULT_MODEL + '。',
    navigationLine,
    '你可以结合下面的知识库检索结果回答；如果资料不足，要直接说明。',
    context ? '知识库参考：\n' + context : '知识库参考：未检索到足够相关内容。'
  ].join('\n')
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return

  messages.value.push({ role: 'user', content: text })
  input.value = ''
  loading.value = true
  wakePet()
  scrollBottom()

  try {
    const agentAction = detectAgentAction(text)
    if (agentAction && await performAgentAction(agentAction, text)) {
      return
    }

    const targetModule = detectTargetModule(text)
    const ventingMode = hasVentingIntent(text)
    const knowledgeContext = await loadKnowledgeContext(text)
    const history = messages.value
      .slice(-8, -1)
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }))

    const data = await chatMinimax({
      model: DEFAULT_MODEL,
      prompt: text,
      history,
      system: buildSystemPrompt(knowledgeContext, targetModule, ventingMode),
      temperature: 0.68,
      maxTokens: 2200
    })

    const reply = data.reply || '呀哈，我这边没有拿到有效回答。'
    messages.value.push({ role: 'bot', content: reply })

    if (targetModule && targetModule !== props.activeModule && /去|打开|跳转|带我|进入|切到/.test(text)) {
      window.dispatchEvent(new CustomEvent('usagi:navigate', { detail: { module: targetModule } }))
    }
  } catch (e) {
    messages.value.push({ role: 'bot', content: '请求失败：' + (e.message || e) })
  } finally {
    loading.value = false
    scrollBottom()
  }
}
</script>

<style scoped>
.usagi-chat {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 10050;
  font-family: inherit;
}

.pet-button {
  position: relative;
  width: 92px;
  height: 104px;
  border: 0;
  background: transparent;
  cursor: pointer;
  filter: drop-shadow(0 16px 26px rgba(61, 43, 96, 0.28));
  animation: pet-bob 3.4s ease-in-out infinite;
}

.pet-glow {
  position: absolute;
  inset: 18px 0 2px;
  border-radius: 999px;
  background: radial-gradient(circle at 50% 52%, rgba(218, 199, 244, 0.32), rgba(195, 143, 52, 0.12) 54%, transparent 72%);
  animation: pet-glow-pulse 4.8s ease-in-out infinite;
}

.pet-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform-origin: 50% 80%;
  animation: pet-breathe 4.2s ease-in-out infinite;
  filter: drop-shadow(0 11px 20px rgba(90, 62, 123, 0.22)) drop-shadow(0 2px 0 rgba(255, 255, 255, 0.16));
}

.pet-chip {
  position: absolute;
  right: -3px;
  bottom: 5px;
  min-width: 27px;
  height: 20px;
  border: 2px solid var(--border-bright);
  border-radius: 999px;
  background: var(--panel-bg-hover);
  color: var(--primary-dark);
  font-size: 10px;
  font-weight: 900;
  line-height: 16px;
  box-shadow: 0 6px 18px var(--primary-shadow);
}

.pet-button:hover {
  transform: translateY(-2px) scale(1.03);
}

.pet-awake .pet-image,
.pet-celebrate .pet-image,
.pet-button:hover .pet-image {
  animation: pet-wiggle 0.7s ease both, pet-breathe 4.2s ease-in-out 0.7s infinite;
}

.pet-celebrate .pet-button {
  animation: pet-hop 0.78s cubic-bezier(0.34, 1.56, 0.64, 1) both, pet-bob 3.4s ease-in-out 0.78s infinite;
}

.pet-thinking .pet-image {
  animation: pet-think 1.35s ease-in-out infinite;
}

.pet-alert .pet-image {
  animation: pet-alert 0.88s ease-in-out infinite;
}

.pet-panic .pet-image {
  animation: pet-panic 0.58s ease-in-out infinite;
}

.pet-alert .pet-chip,
.pet-panic .pet-chip {
  border-color: color-mix(in srgb, #f59e0b 56%, var(--border-bright));
  color: #b45309;
}

.pet-thinking .pet-chip {
  color: color-mix(in srgb, #2563eb 76%, var(--primary-light));
}

.pet-sleeping .pet-button {
  animation: pet-sleep-bob 5.2s ease-in-out infinite;
}

.pet-sleeping .pet-image {
  animation: pet-sleep-breathe 4.8s ease-in-out infinite;
  filter: saturate(0.92) brightness(0.96) drop-shadow(0 10px 18px rgba(83, 58, 150, 0.28));
}

.pet-sleeping .pet-chip {
  opacity: 0.45;
  transform: translateY(2px) scale(0.94);
}

.pet-sleep-mark,
.pet-dream-dot {
  position: absolute;
  pointer-events: none;
  opacity: 0;
}

.pet-sleep-mark {
  right: 1px;
  top: 4px;
  color: var(--primary-light);
  font-size: 16px;
  font-weight: 900;
  text-shadow: 0 2px 12px var(--primary-shadow);
}

.pet-sleep-two {
  right: -10px;
  top: 22px;
  font-size: 12px;
}

.pet-dream-dot {
  width: 8px;
  height: 8px;
  border: 2px solid rgba(79, 58, 31, 0.75);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.75);
}

.pet-dream-one {
  right: 8px;
  top: 36px;
}

.pet-dream-two {
  right: -6px;
  top: 15px;
  width: 10px;
  height: 10px;
}

.pet-sleeping .pet-sleep-one {
  animation: pet-zzz 2.8s ease-in-out infinite;
}

.pet-sleeping .pet-sleep-two {
  animation: pet-zzz 2.8s ease-in-out 0.8s infinite;
}

.pet-sleeping .pet-dream-one {
  animation: pet-dream 3.2s ease-in-out 0.2s infinite;
}

.pet-sleeping .pet-dream-two {
  animation: pet-dream 3.2s ease-in-out 1.1s infinite;
}

.chat-panel {
  width: min(376px, calc(100vw - 28px));
  height: min(560px, calc(100vh - 42px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-mid);
  border-radius: 18px;
  background:
    linear-gradient(180deg, var(--panel-bg-hover), var(--panel-bg-soft)),
    var(--bg-card);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px) saturate(1.15);
  -webkit-backdrop-filter: blur(18px) saturate(1.15);
}

.chat-head {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 14px;
  border-bottom: 1px solid var(--border);
  background:
    radial-gradient(circle at 18% 0%, var(--accent-soft), transparent 44%),
    linear-gradient(135deg, var(--surface), var(--surface2));
  user-select: none;
}

.mini-pet {
  width: 48px;
  height: 51px;
  flex: 0 0 auto;
}

.mini-pet img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 5px 8px rgba(79, 58, 31, 0.18));
}

.chat-title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  color: var(--text);
}

.chat-title strong {
  font-size: 15px;
}

.chat-title span {
  color: var(--text-dim);
  font-size: 12px;
}

.chat-close {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--chip-bg);
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 800;
  line-height: 1;
}

.chat-close:hover {
  border-color: var(--border-bright);
  color: var(--text);
  background: var(--surface2);
}

.quick-actions {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 12px 0;
}

.quick-actions button {
  flex: 0 0 auto;
  border: 1px solid var(--chip-border);
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-dim);
  cursor: pointer;
  font-size: 12px;
  padding: 7px 10px;
}

.quick-actions button:hover {
  border-color: var(--border-bright);
  color: var(--text);
  background: var(--active-bg);
}

.chat-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 14px;
}

.message {
  max-width: 86%;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.65;
}

.message span {
  display: block;
  padding: 10px 12px;
  border-radius: 16px;
}

.message.user {
  align-self: flex-end;
}

.message.user span {
  border-bottom-right-radius: 6px;
  background: var(--primary-gradient);
  color: white;
  box-shadow: 0 8px 18px var(--primary-shadow);
}

.message.bot {
  align-self: flex-start;
}

.message.bot span {
  border: 1px solid var(--border);
  border-bottom-left-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.message.loading span {
  color: var(--text-dim);
}

.chat-form {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border);
  background: var(--panel-bg-soft);
}

.chat-input {
  min-width: 0;
  flex: 1;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
  padding: 0 12px;
}

.chat-input:focus {
  border-color: var(--border-bright);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.send-button {
  width: 42px;
  height: 40px;
  border: 0;
  border-radius: 12px;
  background: var(--primary-gradient);
  color: #fff;
  cursor: pointer;
  font-weight: 900;
  box-shadow: 0 8px 18px var(--primary-shadow);
}

.send-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

@keyframes pet-bob {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50% { transform: translateY(-7px) rotate(2deg); }
}

@keyframes pet-wiggle {
  0% { transform: rotate(0deg) scale(1); }
  22% { transform: rotate(-7deg) scale(1.04); }
  48% { transform: rotate(7deg) scale(1.04); }
  72% { transform: rotate(-3deg) scale(1.02); }
  100% { transform: rotate(0deg) scale(1); }
}

@keyframes pet-hop {
  0% { transform: translateY(0) rotate(-1deg) scale(1); }
  36% { transform: translateY(-18px) rotate(5deg) scale(1.08); }
  68% { transform: translateY(3px) rotate(-3deg) scale(0.98); }
  100% { transform: translateY(0) rotate(0deg) scale(1); }
}

@keyframes pet-think {
  0%, 100% { transform: rotate(-2deg) translateY(0); }
  50% { transform: rotate(4deg) translateY(-4px); }
}

@keyframes pet-alert {
  0%, 100% { transform: rotate(0deg) scale(1); }
  25% { transform: rotate(-7deg) scale(1.03); }
  55% { transform: rotate(7deg) scale(1.02); }
}

@keyframes pet-panic {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  25% { transform: translateX(-3px) rotate(-6deg); }
  50% { transform: translateX(3px) rotate(6deg); }
  75% { transform: translateX(-2px) rotate(-4deg); }
}

@keyframes pet-sleep-bob {
  0%, 100% { transform: translateY(0) rotate(-4deg); }
  50% { transform: translateY(3px) rotate(-6deg); }
}

@keyframes pet-breathe {
  0%, 100% { transform: scale(1); }
  45% { transform: scale(1.035, 0.985); }
  70% { transform: scale(0.99, 1.015); }
}

@keyframes pet-sleep-breathe {
  0%, 100% { transform: rotate(-3deg) scale(0.98, 1); }
  50% { transform: rotate(-4deg) scale(1.015, 0.965); }
}

@keyframes pet-glow-pulse {
  0%, 100% { opacity: 0.8; transform: scale(0.98); }
  50% { opacity: 1; transform: scale(1.06); }
}

@keyframes pet-zzz {
  0% { opacity: 0; transform: translate(0, 8px) scale(0.7); }
  20% { opacity: 0.85; }
  80% { opacity: 0.85; }
  100% { opacity: 0; transform: translate(8px, -18px) scale(1.05); }
}

@keyframes pet-dream {
  0% { opacity: 0; transform: translate(0, 8px) scale(0.45); }
  25% { opacity: 0.75; }
  100% { opacity: 0; transform: translate(12px, -22px) scale(1.25); }
}

@media (prefers-reduced-motion: reduce) {
  .pet-button,
  .pet-glow,
  .pet-image,
  .pet-sleep-mark,
  .pet-dream-dot {
    animation: none !important;
  }
}

@media (max-width: 560px) {
  .usagi-chat {
    right: 10px;
    bottom: calc(72px + env(safe-area-inset-bottom));
  }

  .pet-button {
    width: 54px;
    height: 62px;
    filter: drop-shadow(0 10px 16px rgba(61, 43, 96, 0.2));
  }

  .pet-chip {
    right: -4px;
    bottom: 1px;
    min-width: 22px;
    height: 17px;
    border-width: 1px;
    font-size: 9px;
    line-height: 15px;
  }

  .pet-sleep-mark,
  .pet-dream-dot {
    display: none;
  }

  .chat-panel {
    width: calc(100vw - 20px);
    height: min(620px, calc(100vh - 92px));
    border-radius: 16px;
  }
}
</style>
