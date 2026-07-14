<template>
  <div class="app-shell">
    <!-- Top Bar -->
    <header class="topbar">
      <div class="topbar-left">
        <div class="topbar-logo">
          <span class="topbar-logo-icon" aria-hidden="true">
            <img :src="brandUsagiImage" alt="" />
          </span>
          <div class="topbar-logo-text">
            <div class="topbar-logo-name">乌萨奇工作平台</div>
            <div class="topbar-logo-ver">v2.0 // chen/xue</div>
          </div>
        </div>
      </div>
      <div class="topbar-right">
        <button
          class="topbar-update"
          type="button"
          aria-label="查看更新公告"
          @click="openUpdateAnnouncement">
          <span class="topbar-update-dot"></span>
          <span class="topbar-update-label">更新公告</span>
          <div class="topbar-update-popover" role="status">
            <strong>{{ updateAnnouncement.title }}</strong>
            <em>当前弹窗只展示 {{ updateAnnouncement.versionLabel }}</em>
            <span class="topbar-update-history-title">历史版本更新记录</span>
            <span v-for="item in updateAnnouncement.history" :key="item.version">{{ item.version }} · {{ item.title }}</span>
            <em>点击查看本次完整说明</em>
          </div>
        </button>
        <div class="topbar-style-switch" role="radiogroup" aria-label="UI风格">
          <button
            v-for="style in uiStyles"
            :key="style.id"
            type="button"
            class="topbar-style-option"
            :class="{ active: activeUiStyle === style.id }"
            role="radio"
            :aria-label="style.label"
            :aria-checked="activeUiStyle === style.id"
            :title="style.hint"
            @click="setUiStyle(style.id)">
            <span class="style-swatch" :style="{ background: style.swatch }"></span>
            <span class="style-label">{{ style.label }}</span>
          </button>
        </div>
        <div class="topbar-status">
          <span class="topbar-status-icon" aria-hidden="true">
            <img v-if="activeUiStyle === 'usagi'" :src="statusUsagiImage" alt="" />
            <template v-else>&#128048;</template>
          </span>
          <span class="topbar-status-text">{{ AUTH_DISABLED ? '免登录测试中' : (isLoggedIn ? '乌萨奇工作中' : '等待登录') }}</span>
          <span class="topbar-status-dot"></span>
        </div>
        <button
          v-if="isLoggedIn && !AUTH_DISABLED"
          type="button"
          class="topbar-logout"
          title="退出登录"
          @click="handleLogout">
          退出登录
        </button>
        <div class="topbar-time">{{ currentTime }}</div>
      </div>
    </header>

    <!-- Body -->
    <!-- 登录遮罩 -->
    <div v-if="!authReady" class="login-overlay">
      <div class="login-box">
        <div class="login-logo">
          <img :src="loginUsagiImage" alt="" />
        </div>
        <div class="login-title">乌萨奇工作平台</div>
        <div class="login-subtitle">正在恢复登录状态</div>
      </div>
    </div>

    <div v-else-if="!isLoggedIn" class="login-overlay">
      <div class="login-box">
        <div class="login-logo">
          <img :src="loginUsagiImage" alt="" />
        </div>
        <div class="login-title">乌萨奇工作平台</div>
        <div class="auth-tabs" role="tablist" aria-label="账号入口">
          <button
            type="button"
            class="auth-tab"
            :class="{ active: authMode === 'login' }"
            @click="setAuthMode('login')">
            登录
          </button>
          <button
            type="button"
            class="auth-tab"
            :class="{ active: authMode === 'register' }"
            @click="setAuthMode('register')">
            注册
          </button>
        </div>
        <div class="login-subtitle">{{ authMode === 'login' ? '请输入用户名和密码登录' : '使用中文真名和邀请码注册' }}</div>
        <div class="login-field">
          <label>真实姓名</label>
          <input class="inp" v-model="loginUser" placeholder="例如：张三" @keyup.enter="submitAuth" />
        </div>
        <div class="login-field">
          <label>密码</label>
          <input class="inp" type="password" v-model="loginPass" placeholder="至少 6 位" @keyup.enter="submitAuth" />
        </div>
        <div v-if="authMode === 'register'" class="login-field">
          <label>所属组别</label>
          <select class="inp" v-model="registerGroup">
            <option value="">请选择组别</option>
            <option value="内容一部">内容一部</option>
            <option value="内容二组">内容二组</option>
            <option value="内容三组">内容三组</option>
            <option value="内容四组">内容四组</option>
            <option value="内容五组">内容五组</option>
            <option value="内容六组">内容六组</option>
            <option value="MCN经纪组">MCN经纪组</option>
          </select>
        </div>
        <div v-if="authMode === 'register'" class="login-field">
          <label>邀请码</label>
          <input class="inp" v-model="registerInvite" placeholder="???" @keyup.enter="submitAuth" />
        </div>
        <div v-if="loginError" class="login-error">{{ loginError }}</div>
        <button class="btn btn-primary login-btn" :disabled="loggingIn" @click="submitAuth">
          {{ loggingIn ? (authMode === 'login' ? '登录中' : '注册中') : (authMode === 'login' ? '登录' : '注册并进入') }}
        </button>
      </div>
    </div>

    <div v-if="authReady && isLoggedIn" class="body-layout">
      <!-- Sidebar -->
      <aside class="sidebar">
        <nav class="sidebar-nav" ref="sidebarNavRef">
          <template v-for="item in visibleNavItems" :key="item.id">
            <button
              type="button"
              class="nav-item hover-spring click-press"
              :data-nav-id="item.id"
              :class="{ active: activeModule === item.id, expanded: item.children && isNavGroupOpen(item.id), parent: item.children }"
              :aria-current="!item.children && activeModule === item.id ? 'page' : undefined"
              :aria-expanded="item.children ? isNavGroupOpen(item.id) : undefined"
              @click="handleNavItemClick(item)">
              <span class="nav-icon"><NavIcon :name="item.id" /></span>
              <span class="nav-label">{{ item.label }}</span>
              <NavIcon v-if="item.children" name="chevron" :size="14" class="nav-chevron" />
            </button>
            <div v-if="item.children && isNavGroupOpen(item.id)" class="nav-children">
              <button
                v-for="child in item.children"
                :key="child.id"
                type="button"
                class="nav-item nav-child hover-spring click-press"
                :data-nav-id="child.id"
                :class="{ active: activeModule === child.id }"
                :aria-current="activeModule === child.id ? 'page' : undefined"
                @click="setActiveModule(child.id)">
                <span class="nav-icon"><NavIcon :name="child.id" /></span>
                <span class="nav-label">{{ child.label }}</span>
              </button>
            </div>
          </template>
        </nav>
        <!-- 账号登录面板 -->
        <div class="sidebar-account">
          <div class="account-avatar">
            <img :src="accountUsagiImage" alt="" />
          </div>
          <div class="account-info">
            <div class="account-name">{{ accountName }}</div>
            <div class="account-status">{{ accountStatus }}</div>
          </div>
          <button v-if="!AUTH_DISABLED" class="account-edit" type="button" aria-label="退出登录" title="退出登录" @click="handleLogout">
            <NavIcon name="logout" :size="16" />
          </button>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        <div class="module">
          <KeepAlive>
            <component
              :is="activeModuleComponent"
              :key="activeModuleKey"
              :module-id="activeModule"
              :current-user="authUser"
              :traffic-context="activeTrafficContext" />
          </KeepAlive>
        </div>
      </main>
    </div>

    <Transition name="modal">
      <div
        v-if="showUpdateAnnouncement"
        class="update-modal-backdrop"
        @click.self="closeUpdateAnnouncement">
        <section
          class="update-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="updateAnnouncementTitle">
          <button class="update-modal-close" type="button" title="关闭" @click="closeUpdateAnnouncement">×</button>
          <div class="update-modal-kicker">更新公告</div>
          <h3 id="updateAnnouncementTitle">{{ updateAnnouncement.title }}</h3>
          <p class="update-modal-subtitle">{{ updateAnnouncement.subtitle }}</p>
          <div class="update-modal-list">
            <article
              v-for="item in updateAnnouncement.items"
              :key="item.title"
              class="update-modal-item">
              <span>{{ item.icon }}</span>
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.desc }}</p>
              </div>
            </article>
          </div>
          <button class="btn btn-primary update-modal-action" type="button" @click="closeUpdateAnnouncement">
            知道啦
          </button>
        </section>
      </div>
    </Transition>

    <!-- Chat Bubble -->
    <ChatBubble :active-module="activeModule" />
    <BaseConfirmDialog
      :show="confirmState.show"
      :title="confirmState.title"
      :message="confirmState.message"
      :confirm-text="confirmState.confirmText"
      :cancel-text="confirmState.cancelText"
      :type="confirmState.type"
      @confirm="confirmAccept"
      @cancel="confirmCancel"
    />
    <BaseToast
      :show="toast.show"
      :message="toast.msg"
      :type="toast.type"
      :big="toast.big"
    />
    <UsagiCelebration />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent, nextTick } from 'vue'
import ChatBubble from './components/ChatBubble.vue'
import NavIcon from './components/NavIcon.vue'
import BaseConfirmDialog from './components/BaseConfirmDialog.vue'
import BaseToast from './components/BaseToast.vue'
import UsagiCelebration from './components/UsagiCelebration.vue'
import { provideConfirm } from './composables/useConfirm'
import { provideToast } from './composables/useToast'
import { useNavigation, useModuleMap } from './composables/useNavigation'
import { useClock } from './composables/useClock'
import { canAccessModule, isAdminLike, MEMBER_MODULES } from './permissions'
import { getMe, login, logout, register } from './api/auth'
import { clearAuthSession, getAuthToken } from './api/client'
import { clearAccountDataDashboardCache, preloadAccountDataDashboard } from './api/accountData'
import { loadUnreadScheduleNotifications, markScheduleNotificationsRead } from './api/schedule'
import usagiIdleImage from './assets/usagi-pet-states/idle.png'
import usagiHappyImage from './assets/usagi-pet-states/happy.png'
import usagiSignImage from './assets/usagi-pet-states/sign.png'
import usagiSleepImage from './assets/usagi-pet-states/sleep.png'
import usagiLoginImage from './assets/usagi-ai-pet.png'

// 懒加载模块 - 减少首屏加载体积
const ToolsModule = defineAsyncComponent(() => import('./modules/ToolsModule.vue'))
const WorkflowModule = defineAsyncComponent(() => import('./modules/WorkflowModule.vue'))
const OpsModule = defineAsyncComponent(() => import('./modules/OpsModule.vue'))
const ScheduleModule = defineAsyncComponent(() => import('./modules/ScheduleModule.vue'))
const AccountStyleModule = defineAsyncComponent(() => import('./modules/AccountStyleModule.vue'))
const CopyGenModule = defineAsyncComponent(() => import('./modules/CopyWorkbenchModule.vue'))
const DailyHotModule = defineAsyncComponent(() => import('./modules/DailyHotModule.vue?rightPanel=v3'))
const ImagegenModule = defineAsyncComponent(() => import('./modules/ImagegenModule.vue'))
const AccountMonitorModule = defineAsyncComponent(() => import('./modules/AccountMonitorModule.vue'))
const AccountDataDashboardModule = defineAsyncComponent(() => import('./modules/AccountDataDashboardModule.vue'))
const AccountDataAccountsModule = defineAsyncComponent(() => import('./modules/AccountDataAccountsModule.vue'))
const IdeaBoardModule = defineAsyncComponent(() => import('./modules/IdeaBoardModule.vue'))
const SmartCollectModule = defineAsyncComponent(() => import('./modules/SmartCollectModule.vue'))
const MaterialModule = defineAsyncComponent(() => import('./modules/MaterialModule.vue'))
const VideoPublishModule = defineAsyncComponent(() => import('./modules/VideoPublishModule.vue'))
const ProjectDeliveryModule = defineAsyncComponent(() => import('./modules/ProjectDeliveryModule.vue'))
const CommentReplyModule = defineAsyncComponent(() => import('./modules/CommentReplyModule.vue'))
const VectorModule = defineAsyncComponent(() => import('./modules/VectorModule.vue'))
const AdminUsersModule = defineAsyncComponent(() => import('./modules/AdminUsersModule.vue'))
const OperationLogModule = defineAsyncComponent(() => import('./modules/OperationLogModule.vue'))
const SystemHealthModule = defineAsyncComponent(() => import('./modules/SystemHealthModule.vue'))
const PostToolsModule = defineAsyncComponent(() => import('./modules/PostToolsModule.vue'))
const ProjectAgentModule = defineAsyncComponent(() => import('./modules/ProjectAgentModule.vue'))
const TrafficPlanModule = defineAsyncComponent(() => import('./modules/TrafficPlanModule.vue'))
const GrossMarginModule = defineAsyncComponent(() => import('./modules/GrossMarginModule.vue'))
const StyleLibraryModule = defineAsyncComponent(() => import('./modules/StyleLibraryModule.vue'))
const StyleProjectWorkbenchModule = defineAsyncComponent(() => import('./modules/StyleProjectWorkbenchModule.vue'))
const StyleWriterModule = defineAsyncComponent(() => import('./modules/StyleWriterModule.vue'))
const StyleAssetsModule = defineAsyncComponent(() => import('./modules/StyleAssetsModule.vue'))
const DouyinHotlistModule = defineAsyncComponent(() => import('./modules/DouyinHotlistModule.vue'))
const StyleToolsModule = defineAsyncComponent(() => import('./modules/StyleToolsModule.vue'))

const { confirmState, confirmAccept, confirmCancel } = provideConfirm()
const { toast, showToast: showGlobalToast } = provideToast()

const AUTH_DISABLED = import.meta.env.VITE_USAGI_AUTH_DISABLED === 'true'
const AUTH_DISABLED_USER = {
  id: 0,
  username: '免登录测试',
  display_name: '免登录测试',
  role: 'admin',
  permissions: MEMBER_MODULES.map(item => item.id),
  active: true
}

const DEFAULT_MODULE = 'accountmonitor'
const COPY_WORKBENCH_MAINTENANCE = false
const COPY_MAINTENANCE_MODULES = new Set([
  'copyWorkbench',
  'styleLibrary',
  'styleProjectWorkbench',
  'styleWriter',
  'styleAssets',
  'styleGrossMargin',
  'copygen',
  'accountStyle',
  'styleCollect',
  'styleProjects',
  'styleCopyTools',
  'styleDrafts'
])
const UPDATE_ANNOUNCEMENT_VERSION = '2026-07-09-ops-workflow-schedule'
const UPDATE_ANNOUNCEMENT_KEY = 'usagi_update_announcement_seen_version'
const updateAnnouncement = {
  versionLabel: '7/9 工作流与排期更新',
  title: '7/9 工作流、投流与排期看板更新',
  subtitle: '本次重点处理账号分组、转写精度、投流申请、评论生成和排期待办联动，减少重复录入和页面来回切换。',
  items: [
    {
      icon: '🔁',
      title: '账号换组与名单调整',
      desc: '已按最新组织结构调整账号归属、人员分组和一部/六组相关映射，投流计划与排期相关视图同步适配。'
    },
    {
      icon: '🎧',
      title: '转写精度提高',
      desc: '文案工具转写链路已优化，优先试用更准确的转写渠道，提升口播稿和素材拆解可用度。'
    },
    {
      icon: '📈',
      title: '投流申请与账号模板调整',
      desc: '投流计划账号模板不再强绑定固定维护量，后续根据 CPM 浮动计算；账号模板仍默认勾选。互动量梯度已从 50 调整为 10，方便微调。'
    },
    {
      icon: '🛠️',
      title: '文案工作台维护',
      desc: 'Next 版文案工作台进入维护阶段，旧文案入口临时暂停；当前文案需求请先使用「文案工作流」。'
    },
    {
      icon: '⚡',
      title: '评论生成加速',
      desc: '评论生成性能已优化，目前 200 条评论平均约 1 分钟完成。'
    },
    {
      icon: '📅',
      title: '排期看板/部门待办优化',
      desc: '部门待办已映射到组内排期表，映射任务支持拖动分配给组内成员，并同步保存负责人。'
    }
  ],
  history: [
    { version: '7/9 工作流与排期更新', title: '账号换组、转写精度、投流模板、评论加速、待办映射' },
    { version: '文案工作台维护', title: '旧文案入口暂停，文案需求迁移到文案工作流' },
    { version: 'AI 生图恢复', title: '主线路图生图恢复，任务改为串行队列' },
    { version: '发布模块公测', title: 'B站、抖音、快手、小红书发布链路可用' },
    { version: 'V3', title: '维护测算、分期拆量、申请文本生成' },
    { version: 'V2', title: '数据维护入口与账号标准查询' }
  ]
}

// Auth state first (needed by navigation)
const authReady = ref(AUTH_DISABLED)
const authUser = ref(AUTH_DISABLED ? AUTH_DISABLED_USER : null)
const showUpdateAnnouncement = ref(false)

// Navigation (depends on authUser)
const { activeModule, visibleNavItems, visibleLeafItems, ensureActiveModule, setActiveModule } = useNavigation(
  authUser,
  DEFAULT_MODULE,
  AUTH_DISABLED
)

const expandedNavGroups = ref(new Set())
const sidebarNavRef = ref(null)
const manuallyOpenedNavGroups = ref(new Set())

// Module Map
const { getActiveModuleComponent, getActiveModuleKey, isValidModule } = useModuleMap({
  CopyGenModule,
  ToolsModule,
  StyleToolsModule,
  WorkflowModule,
  DailyHotModule,
  AccountMonitorModule,
  AccountDataDashboardModule,
  AccountDataAccountsModule,
  StyleLibraryModule,
  StyleProjectWorkbenchModule,
  StyleWriterModule,
  StyleAssetsModule,
  DouyinHotlistModule,
  AccountStyleModule,
  OpsModule,
  ScheduleModule,
  ImagegenModule,
  IdeaBoardModule,
  SmartCollectModule,
  MaterialModule,
  VideoPublishModule,
  ProjectDeliveryModule,
  CommentReplyModule,
  VectorModule,
  AdminUsersModule,
  OperationLogModule,
  SystemHealthModule,
  PostToolsModule,
  ProjectAgentModule,
  TrafficPlanModule,
  GrossMarginModule
})

const activeModuleComponent = computed(() => getActiveModuleComponent(activeModule.value))
const activeModuleKey = computed(() => getActiveModuleKey(activeModule.value))
const activeTrafficContext = ref(null)

let accountDataPreloadTimer = null

function findParentNavGroup(moduleId) {
  return visibleNavItems.value.find(item => item.children?.some(child => child.id === moduleId))
}

function syncActiveNavGroup(moduleId) {
  const parent = findParentNavGroup(moduleId)
  if (!parent) return
  if (!expandedNavGroups.value.has(parent.id)) {
    const next = new Set(expandedNavGroups.value)
    next.add(parent.id)
    expandedNavGroups.value = next
  }
  nextTick(() => scrollNavItemIntoView(moduleId))
}

watch([activeModule, visibleNavItems], ([moduleId]) => {
  syncActiveNavGroup(moduleId)
}, { immediate: true })

// Auth state
const loggingIn = ref(false)
const isLoggedIn = computed(() => !!authUser.value)
const authMode = ref('login')
const loginUser = ref('')
const loginPass = ref('')
const loginError = ref('')
const registerInvite = ref('')
const registerGroup = ref('')
const accountName = computed(() => authUser.value?.display_name || authUser.value?.username || '未登录')
const accountStatus = computed(() => AUTH_DISABLED ? '免登录测试模式' : (isAdminLike(authUser.value) ? '管理员' : '成员'))
const brandUsagiImage = usagiHappyImage
const loginUsagiImage = usagiLoginImage
const accountUsagiImage = usagiIdleImage
const statusUsagiImage = computed(() => isLoggedIn.value ? usagiSignImage : usagiSleepImage)

let notificationPollTimer = null
let notificationPolling = false
let notificationPollDelayMs = 30000

function hasSeenUpdateAnnouncement() {
  try {
    return localStorage.getItem(UPDATE_ANNOUNCEMENT_KEY) === UPDATE_ANNOUNCEMENT_VERSION
  } catch(e) {
    return true
  }
}

function markUpdateAnnouncementSeen() {
  try {
    localStorage.setItem(UPDATE_ANNOUNCEMENT_KEY, UPDATE_ANNOUNCEMENT_VERSION)
  } catch(e) {}
}

function openUpdateAnnouncement() {
  showUpdateAnnouncement.value = true
}

function closeUpdateAnnouncement() {
  markUpdateAnnouncementSeen()
  showUpdateAnnouncement.value = false
}

function maybeShowUpdateAnnouncement() {
  if (!isLoggedIn.value || hasSeenUpdateAnnouncement()) return
  window.setTimeout(() => {
    if (isLoggedIn.value && !hasSeenUpdateAnnouncement()) {
      showUpdateAnnouncement.value = true
    }
  }, 500)
}

function scheduleAccountDataPreload() {
  cancelAccountDataPreload()
  if (!isLoggedIn.value || !canAccessModule(authUser.value, 'accountDataDashboard')) return
  accountDataPreloadTimer = window.setTimeout(() => {
    accountDataPreloadTimer = null
    if (isLoggedIn.value) preloadAccountDataDashboard()
  }, 300)
}

function cancelAccountDataPreload() {
  if (!accountDataPreloadTimer) return
  window.clearTimeout(accountDataPreloadTimer)
  accountDataPreloadTimer = null
}

// Clock
const { currentTime } = useClock()

// UI Style
const uiStyles = [
  {
    id: 'violet',
    label: '紫夜',
    hint: '深紫黑底，适合沉浸式运营工作',
    swatch: 'linear-gradient(135deg, #7c3aed, #00f5d4)'
  },
  {
    id: 'apple',
    label: '银白',
    hint: '白色玻璃质感，偏 Apple 的清爽工作台',
    swatch: 'linear-gradient(135deg, #f5f5f7, #007aff)'
  },
  {
    id: 'usagi',
    label: '乌萨奇',
    hint: '软黄手绘、贴纸感，更像有陪伴感的乌萨奇工作平台',
    swatch: 'linear-gradient(135deg, #fff2b8, #ffd84f 48%, #ff9fb5)'
  }
]

const UI_STYLE_KEY = 'usagi_ui_style'
const DEFAULT_UI_STYLE = 'apple'
const UI_STYLE_DEFAULT_VERSION_KEY = 'usagi_ui_style_default_version'
const UI_STYLE_DEFAULT_VERSION = 'apple-default-20260429'

function getInitialUiStyle() {
  try {
    if (localStorage.getItem(UI_STYLE_DEFAULT_VERSION_KEY) !== UI_STYLE_DEFAULT_VERSION) {
      localStorage.setItem(UI_STYLE_KEY, DEFAULT_UI_STYLE)
      localStorage.setItem(UI_STYLE_DEFAULT_VERSION_KEY, UI_STYLE_DEFAULT_VERSION)
      return DEFAULT_UI_STYLE
    }
    const saved = localStorage.getItem(UI_STYLE_KEY)
    if (saved === 'mist') {
      localStorage.setItem(UI_STYLE_KEY, 'apple')
      return 'apple'
    }
    if (uiStyles.some((style) => style.id === saved)) return saved
  } catch(e) {}
  return DEFAULT_UI_STYLE
}

const activeUiStyle = ref(getInitialUiStyle())

function applyUiStyle(styleId) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.uiStyle = styleId
  window.dispatchEvent(new CustomEvent('usagi:ui-style', { detail: { style: styleId } }))
}

function setUiStyle(styleId) {
  if (!uiStyles.some((style) => style.id === styleId)) return
  activeUiStyle.value = styleId
  try {
    localStorage.setItem(UI_STYLE_KEY, styleId)
  } catch(e) {}
  applyUiStyle(styleId)
}

applyUiStyle(activeUiStyle.value)

function syncInitialModuleSelection() {
  ensureActiveModule()
}

function setAuthMode(mode) {
  authMode.value = mode
  loginError.value = ''
}

async function doLogin() {
  const username = loginUser.value.trim()
  if (!username || !loginPass.value) {
    loginError.value = '请输入用户名和密码'
    return
  }
  loggingIn.value = true
  loginError.value = ''
  try {
    const data = await login(username, loginPass.value)
    authUser.value = data.user
    loginPass.value = ''
    ensureActiveModule()
  } catch (e) {
    loginError.value = e.message || '登录失败'
  } finally {
    loggingIn.value = false
  }
}

async function doRegister() {
  const username = loginUser.value.trim()
  const chineseName = /^[一-龥]{2,12}$/
  if (!chineseName.test(username)) {
    loginError.value = '账号名必须使用 2-20 个中文字符的真名'
    return
  }
  if (!loginPass.value || loginPass.value.length < 6) {
    loginError.value = '密码至少 6 位'
    return
  }
  if (!registerGroup.value.trim()) {
    loginError.value = '请选择所属组别'
    return
  }
  loggingIn.value = true
  loginError.value = ''
  try {
    const data = await register(username, loginPass.value, registerInvite.value.trim(), {
      group_name: registerGroup.value.trim(),
      real_name: username
    })
    loginPass.value = ''
    registerInvite.value = ''
    registerGroup.value = ''
    if (data.user) {
      authUser.value = data.user
      ensureActiveModule()
    } else {
      authUser.value = null
      authMode.value = 'login'
      loginError.value = data.message || '注册已提交，请等待管理员启用账号'
    }
  } catch (e) {
    loginError.value = e.message || '注册失败'
  } finally {
    loggingIn.value = false
  }
}

async function submitAuth() {
  if (authMode.value === 'register') {
    doRegister()
    return
  }
  doLogin()
}

async function restoreSession() {
  if (AUTH_DISABLED) {
    authUser.value = AUTH_DISABLED_USER
    authReady.value = true
    syncInitialModuleSelection()
    return
  }
  if (!getAuthToken()) {
    authReady.value = true
    return
  }
  try {
    const data = await getMe()
    authUser.value = data.user
    syncInitialModuleSelection()
  } catch (e) {
    clearAuthSession()
  } finally {
    authReady.value = true
  }
}

async function handleLogout() {
  if (AUTH_DISABLED) return
  await logout().catch(() => {})
  authUser.value = null
  loginPass.value = ''
  setActiveModule(DEFAULT_MODULE, { history: 'replace' })
}

function handleAuthExpired() {
  authUser.value = null
  loginError.value = '登录已过期，请重新登录'
  authReady.value = true
}

function formatScheduleNotification(notification) {
  const content = String(notification?.task_content || '').replace(/\s+/g, ' ').trim()
  const account = String(notification?.task_account || '').trim()
  const tail = [account, content].filter(Boolean).join(' / ')
  return tail
    ? `\u60a8\u6536\u5230\u65b0\u7684\u8ba2\u5355\uff1a${tail.slice(0, 42)}`
    : '\u60a8\u6536\u5230\u65b0\u7684\u8ba2\u5355'
}

async function pollScheduleNotifications() {
  if (!authUser.value || notificationPolling) return
  if (typeof document !== 'undefined' && document.hidden) return
  notificationPolling = true
  try {
    const data = await loadUnreadScheduleNotifications()
    notificationPollDelayMs = 30000
    const notifications = Array.isArray(data.notifications) ? data.notifications : []
    if (notifications.length) {
      const latest = notifications[notifications.length - 1]
      showGlobalToast(formatScheduleNotification(latest), 'success', {
        big: true,
        timeout: 6000,
        kind: 'handoff',
        intensity: 'hero',
        title: latest.title || '新订单跳进来了',
        detail: latest.message || formatScheduleNotification(latest),
        meta: {
          sender: latest.sender_name || '',
          account: latest.task_account || '',
          task: latest.task_content || ''
        }
      })
      await markScheduleNotificationsRead(notifications.map(item => item.id))
    }
  } catch(e) {
    // Global notifications should stay quiet if the network blips.
    notificationPollDelayMs = Math.min(120000, Math.max(30000, notificationPollDelayMs * 2))
  } finally {
    notificationPolling = false
  }
}

function startScheduleNotificationPolling() {
  if (notificationPollTimer) window.clearInterval(notificationPollTimer)
  pollScheduleNotifications()
  notificationPollTimer = window.setTimeout(runScheduleNotificationPoll, notificationPollDelayMs)
}

function runScheduleNotificationPoll() {
  if (notificationPollTimer) window.clearTimeout(notificationPollTimer)
  pollScheduleNotifications().finally(() => {
    if (!authUser.value) return
    notificationPollTimer = window.setTimeout(runScheduleNotificationPoll, notificationPollDelayMs)
  })
}

function stopScheduleNotificationPolling() {
  if (notificationPollTimer) {
    window.clearTimeout(notificationPollTimer)
    notificationPollTimer = null
  }
  notificationPollDelayMs = 30000
}

watch(isLoggedIn, (loggedIn) => {
  if (loggedIn) {
    startScheduleNotificationPolling()
    maybeShowUpdateAnnouncement()
    nextTick(() => {
      scheduleAccountDataPreload()
    })
  } else {
    stopScheduleNotificationPolling()
    showUpdateAnnouncement.value = false
    cancelAccountDataPreload()
    clearAccountDataDashboardCache()
  }
}, { immediate: true })

// Event handlers
function isNavGroupOpen(moduleId) {
  return expandedNavGroups.value.has(moduleId)
}

function toggleNavGroup(moduleId) {
  const next = new Set(expandedNavGroups.value)
  const manualNext = new Set(manuallyOpenedNavGroups.value)
  if (next.has(moduleId)) {
    next.delete(moduleId)
    manualNext.delete(moduleId)
  } else {
    next.add(moduleId)
    manualNext.add(moduleId)
    nextTick(() => {
      const activeChild = visibleNavItems.value
        .find(item => item.id === moduleId)
        ?.children?.find(child => child.id === activeModule.value)
      scrollNavItemIntoView(activeChild ? activeChild.id : moduleId)
    })
  }
  expandedNavGroups.value = next
  manuallyOpenedNavGroups.value = manualNext
}

function handleNavItemClick(item) {
  if (item.children) {
    toggleNavGroup(item.id)
    return
  }
  setActiveModule(item.id)
}

function handleModuleNavigate(event) {
  const moduleId = event?.detail?.module
  if (event?.detail?.trafficContext) {
    activeTrafficContext.value = event.detail.trafficContext
  }
  if (moduleId && isValidModule(moduleId)) {
    setActiveModule(moduleId)
  }
}

function scrollNavItemIntoView(moduleId) {
  const root = sidebarNavRef.value
  if (!root || !moduleId) return
  const target = root.querySelector(`[data-nav-id="${CSS.escape(moduleId)}"]`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

onMounted(() => {
  restoreSession()
  window.addEventListener('usagi:navigate', handleModuleNavigate)
  window.addEventListener('usagi:auth-expired', handleAuthExpired)
})

onUnmounted(() => {
  stopScheduleNotificationPolling()
  cancelAccountDataPreload()
  window.removeEventListener('usagi:navigate', handleModuleNavigate)
  window.removeEventListener('usagi:auth-expired', handleAuthExpired)
})
</script>

<style>
@import './style.css';
@import './style-workbench-native.css';
</style>

