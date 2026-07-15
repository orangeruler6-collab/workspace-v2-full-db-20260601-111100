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
      <div v-if="isErpEmbedFrame" class="login-box erp-embed-callback">
        <div class="login-logo">
          <img :src="loginUsagiImage" alt="" />
        </div>
        <div class="login-title">&#x6b63;&#x5728;&#x5b8c;&#x6210;&#x767b;&#x5f55;</div>
        <div class="login-subtitle">&#x4f01;&#x5fae;&#x5df2;&#x786e;&#x8ba4;&#xff0c;&#x6b63;&#x5728;&#x628a;&#x767b;&#x5f55;&#x6001;&#x540c;&#x6b65;&#x56de;&#x5de5;&#x4f5c;&#x5e73;&#x53f0;...</div>
        <div v-if="loginError" class="login-error">{{ loginError }}</div>
      </div>
      <div v-else class="login-box login-box-wide">
        <button class="login-logo login-logo-button" type="button" title="&#x8d26;&#x53f7;&#x5bc6;&#x7801;&#x9690;&#x85cf;&#x5165;&#x53e3;" @click="togglePasswordLogin">
          <img :src="loginUsagiImage" alt="" />
        </button>
        <div class="login-title">&#x4e4c;&#x8428;&#x5947;&#x5de5;&#x4f5c;&#x5e73;&#x53f0;</div>
        <div class="login-subtitle">&#x8bf7;&#x4f7f;&#x7528;&#x4f01;&#x5fae;&#x626b;&#x7801;&#x767b;&#x5f55;&#xff0c;&#x6210;&#x529f;&#x540e;&#x4f1a;&#x81ea;&#x52a8;&#x8fdb;&#x5165;&#x7cfb;&#x7edf;</div>
        <section class="erp-qr-panel" aria-label="&#x4f01;&#x5fae;&#x626b;&#x7801;&#x767b;&#x5f55;">
          <div class="erp-qr-head">
            <strong>&#x4f01;&#x5fae;&#x626b;&#x7801;&#x767b;&#x5f55;</strong>
            <span>&#x767b;&#x5f55;&#x6001;&#x4fdd;&#x6301; 30 &#x5929;</span>
          </div>
          <iframe class="erp-login-frame" :src="erpLoginFrameUrl" title="&#x4f01;&#x5fae;&#x626b;&#x7801;&#x767b;&#x5f55;" loading="eager"></iframe>
          <button class="btn btn-ghost erp-open-btn" type="button" :disabled="loggingIn" @click="doErpLogin">
            &#x626b;&#x7801;&#x533a;&#x6253;&#x4e0d;&#x5f00;&#xff1f;&#x70b9;&#x8fd9;&#x91cc;&#x8df3;&#x8f6c; ERP &#x767b;&#x5f55;
          </button>
        </section>
        <div v-if="loginError" class="login-error">{{ loginError }}</div>
        <section v-if="showPasswordLogin" class="password-login-panel">
          <div class="auth-tabs" role="tablist" aria-label="&#x8d26;&#x53f7;&#x5165;&#x53e3;">
            <button type="button" class="auth-tab" :class="{ active: authMode === 'login' }" @click="setAuthMode('login')">&#x767b;&#x5f55;</button>
            <button type="button" class="auth-tab" :class="{ active: authMode === 'register' }" @click="setAuthMode('register')">&#x6ce8;&#x518c;</button>
          </div>
          <div class="login-subtitle">{{ authMode === 'login' ? '\u8bf7\u8f93\u5165\u7528\u6237\u540d\u548c\u5bc6\u7801\u767b\u5f55' : '\u4f7f\u7528\u4e2d\u6587\u771f\u540d\u548c\u9080\u8bf7\u7801\u6ce8\u518c' }}</div>
          <div class="login-field">
            <label>&#x771f;&#x5b9e;&#x59d3;&#x540d;</label>
            <input class="inp" v-model="loginUser" placeholder="&#x4f8b;&#x5982;&#xff1a;&#x5f20;&#x4e09;" @keyup.enter="submitAuth" />
          </div>
          <div class="login-field">
            <label>&#x5bc6;&#x7801;</label>
            <input class="inp" type="password" v-model="loginPass" placeholder="&#x81f3;&#x5c11; 6 &#x4f4d;" @keyup.enter="submitAuth" />
          </div>
          <div v-if="authMode === 'register'" class="login-field">
            <label>&#x6240;&#x5c5e;&#x7ec4;&#x522b;</label>
            <select class="inp" v-model="registerGroup">
              <option value="">&#x8bf7;&#x9009;&#x62e9;&#x7ec4;&#x522b;</option>
              <option value="&#x5185;&#x5bb9;&#x4e00;&#x90e8;">&#x5185;&#x5bb9;&#x4e00;&#x90e8;</option>
              <option value="&#x5185;&#x5bb9;&#x4e8c;&#x7ec4;">&#x5185;&#x5bb9;&#x4e8c;&#x7ec4;</option>
              <option value="&#x5185;&#x5bb9;&#x4e09;&#x7ec4;">&#x5185;&#x5bb9;&#x4e09;&#x7ec4;</option>
              <option value="&#x5185;&#x5bb9;&#x56db;&#x7ec4;">&#x5185;&#x5bb9;&#x56db;&#x7ec4;</option>
              <option value="&#x5185;&#x5bb9;&#x4e94;&#x7ec4;">&#x5185;&#x5bb9;&#x4e94;&#x7ec4;</option>
              <option value="&#x5185;&#x5bb9;&#x516d;&#x7ec4;">&#x5185;&#x5bb9;&#x516d;&#x7ec4;</option>
              <option value="MCN&#x7ecf;&#x7eaa;&#x7ec4;">MCN&#x7ecf;&#x7eaa;&#x7ec4;</option>
            </select>
          </div>
          <div v-if="authMode === 'register'" class="login-field">
            <label>&#x9080;&#x8bf7;&#x7801;</label>
            <input class="inp" v-model="registerInvite" placeholder="***" @keyup.enter="submitAuth" />
          </div>
          <button class="btn btn-primary login-btn" :disabled="loggingIn" @click="submitAuth">
            {{ loggingIn ? (authMode === 'login' ? '\u767b\u5f55\u4e2d' : '\u6ce8\u518c\u4e2d') : (authMode === 'login' ? '\u767b\u5f55' : '\u6ce8\u518c\u5e76\u8fdb\u5165') }}
          </button>
        </section>
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
              <span class="nav-icon">{{ item.icon }}</span>
              <span class="nav-label">{{ item.label }}</span>
              <span v-if="item.children" class="nav-chevron">{{ isNavGroupOpen(item.id) ? '⌄' : '›' }}</span>
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
                <span class="nav-icon">{{ child.icon }}</span>
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
            ⎋
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
import BaseConfirmDialog from './components/BaseConfirmDialog.vue'
import BaseToast from './components/BaseToast.vue'
import UsagiCelebration from './components/UsagiCelebration.vue'
import { provideConfirm } from './composables/useConfirm'
import { provideToast } from './composables/useToast'
import { useNavigation, useModuleMap } from './composables/useNavigation'
import { useClock } from './composables/useClock'
import { canAccessModule, isAdminLike, MEMBER_MODULES } from './permissions'
import { erpLogin, getErpLoginUrl, getMe, login, logout, redirectToErpLogin, register, takeErpTokenFromHash } from './api/auth'
import { clearAuthSession, getAuthToken, setAuthSession } from './api/client'
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
const HotspotRadarModule = defineAsyncComponent(() => import('./modules/HotspotRadarModule.vue'))
const ImportedDouyinHotlistModule = defineAsyncComponent(() => import('./modules/ImportedDouyinHotlistModule.vue'))

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
const UPDATE_ANNOUNCEMENT_VERSION = '2026-07-14-workbench-efficiency-update'
const UPDATE_ANNOUNCEMENT_KEY = 'usagi_update_announcement_seen_version'
const updateAnnouncement = {
  versionLabel: '7/14 工作台与效率更新',
  title: '7/14 文案、数据、下载与生图更新',
  subtitle: '本次更新覆盖文案生产、日报产出、视频下载和 AI 生图，进一步缩短日常内容工作的处理时间。',
  items: [
    {
      icon: '1',
      title: '文案工作台上线',
      desc: '账号库、项目工作台和对话写作已完成接入；原有文案工具继续保留旧版，不切换到新版工具台。'
    },
    {
      icon: '2',
      title: '数据采集提前至 16:00',
      desc: '数据看板全量采集调整为每天 16:00 开始，通常可在 18:00 前完成；各组可在 18:00 通过项目助手生成当日组内日报。'
    },
    {
      icon: '3',
      title: 'B站下载提升至 1080P',
      desc: 'B站视频下载默认优先获取 1080P 清晰度，提升后期剪辑、素材复用和画面细节表现。'
    },
    {
      icon: '4',
      title: 'AI 生图默认调整为 1K',
      desc: 'AI 生图默认分辨率降低至 1K，以提升生成速度并减少资源消耗；有高清需求时仍可自由选择 2K 或 4K。'
    }
  ],
  history: [
    { version: '7/14 工作台与效率更新', title: '文案工作台上线、16:00 采集、B站 1080P 下载、AI 生图默认 1K' },
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
  HotspotRadarModule,
  ImportedDouyinHotlistModule,
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
const showPasswordLogin = ref(false)
const registerInvite = ref('')
const registerGroup = ref('')
const accountName = computed(() => authUser.value?.display_name || authUser.value?.username || '未登录')
const accountStatus = computed(() => AUTH_DISABLED ? '免登录测试模式' : (isAdminLike(authUser.value) ? '管理员' : '成员'))
const brandUsagiImage = usagiHappyImage
const loginUsagiImage = usagiLoginImage
const accountUsagiImage = usagiIdleImage
const statusUsagiImage = computed(() => isLoggedIn.value ? usagiSignImage : usagiSleepImage)
const isErpEmbedFrame = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('erp_embed') === '1'
const erpLoginFrameUrl = computed(() => {
  const redirect = new URL(window.location.href)
  redirect.hash = ''
  redirect.searchParams.set('erp_embed', '1')
  return getErpLoginUrl(redirect.toString())
})

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

function togglePasswordLogin() {
  showPasswordLogin.value = !showPasswordLogin.value
  loginError.value = ''
}

function notifyParentErpLogin(type, payload = {}) {
  if (window.parent === window) return
  window.parent.postMessage({ type, ...payload }, window.location.origin)
}

function handleErpLoginMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data || {}
  if (data.type === 'usagi-erp-login-success' && data.token && data.user) {
    setAuthSession(data.token, data.user)
    authUser.value = data.user
    loginError.value = ''
    authReady.value = true
    syncInitialModuleSelection()
    return
  }
  if (data.type === 'usagi-erp-login-error') {
    loginError.value = data.message || 'ERP 登录失败，请重试'
  }
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

function doErpLogin() {
  if (AUTH_DISABLED || loggingIn.value) return
  loggingIn.value = true
  loginError.value = ''
  redirectToErpLogin()
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
  const erpTokens = takeErpTokenFromHash()
  if (erpTokens.length) {
    loggingIn.value = true
    loginError.value = ''
    try {
      const data = await erpLogin(erpTokens)
      authUser.value = data.user
      syncInitialModuleSelection()
      notifyParentErpLogin('usagi-erp-login-success', { token: data.token, user: data.user })
    } catch (e) {
      clearAuthSession()
      loginError.value = e.message || 'ERP 登录失败，请重试'
      notifyParentErpLogin('usagi-erp-login-error', { message: loginError.value })
    } finally {
      loggingIn.value = false
      authReady.value = true
    }
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
  window.addEventListener('message', handleErpLoginMessage)
  window.addEventListener('usagi:navigate', handleModuleNavigate)
  window.addEventListener('usagi:auth-expired', handleAuthExpired)
})

onUnmounted(() => {
  stopScheduleNotificationPolling()
  cancelAccountDataPreload()
  window.removeEventListener('message', handleErpLoginMessage)
  window.removeEventListener('usagi:navigate', handleModuleNavigate)
  window.removeEventListener('usagi:auth-expired', handleAuthExpired)
})
</script>

<style>
@import './style.css';
@import './style-workbench-native.css';
</style>
