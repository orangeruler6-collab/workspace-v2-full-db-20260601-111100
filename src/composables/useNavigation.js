import { ref, computed, watch } from 'vue'
import { onMounted, onUnmounted } from 'vue'
import { ALL_MODULE_DEFINITIONS, canAccessModule, MODULE_DEFINITIONS, flattenModuleDefinitions } from '../permissions'

const MODULE_QUERY_KEY = 'module'

function readModuleFromUrl() {
  if (typeof window === 'undefined') return ''
  return new URL(window.location.href).searchParams.get(MODULE_QUERY_KEY) || ''
}

function isKnownModule(moduleId) {
  return ALL_MODULE_DEFINITIONS.some(item => item.id === moduleId)
}

function writeModuleToUrl(moduleId, historyMode = 'replace') {
  if (typeof window === 'undefined' || !isKnownModule(moduleId)) return
  const url = new URL(window.location.href)
  if (url.searchParams.get(MODULE_QUERY_KEY) === moduleId) return
  url.searchParams.set(MODULE_QUERY_KEY, moduleId)
  const method = historyMode === 'push' ? 'pushState' : 'replaceState'
  window.history[method]({ module: moduleId }, '', url)
}

function filterNavItems(items, user, skipPermissions) {
  return items.reduce((acc, item) => {
    if (item.children) {
      const children = filterNavItems(item.children, user, skipPermissions)
      if (children.length) acc.push({ ...item, children })
      return acc
    }
    if (skipPermissions || canAccessModule(user, item.id)) acc.push(item)
    return acc
  }, [])
}

export function useNavigation(authUser, DEFAULT_MODULE = 'accountmonitor', skipPermissions = false) {
  const requestedModule = readModuleFromUrl()
  const activeModule = ref(isKnownModule(requestedModule) ? requestedModule : DEFAULT_MODULE)

  const visibleNavItems = computed(() => {
    if (skipPermissions) return MODULE_DEFINITIONS
    const user = authUser.value
    if (!user) return []
    return filterNavItems(MODULE_DEFINITIONS, user, false)
  })

  const visibleLeafItems = computed(() => flattenModuleDefinitions(visibleNavItems.value))

  function hasAccess(moduleId) {
    return skipPermissions || canAccessModule(authUser.value, moduleId)
  }

  function ensureActiveModule() {
    if (!visibleLeafItems.value.length) return
    if (!isKnownModule(activeModule.value) || !hasAccess(activeModule.value)) {
      setActiveModule(visibleLeafItems.value[0].id, { history: 'replace' })
      return
    }
    writeModuleToUrl(activeModule.value, 'replace')
  }

  function setActiveModule(moduleId, options = {}) {
    if (!isKnownModule(moduleId)) return false
    const historyMode = options.history === 'replace' ? 'replace' : 'push'
    activeModule.value = moduleId
    writeModuleToUrl(moduleId, historyMode)
    return true
  }

  function handlePopState() {
    const moduleId = readModuleFromUrl()
    if (isKnownModule(moduleId) && hasAccess(moduleId)) {
      activeModule.value = moduleId
      return
    }
    ensureActiveModule()
  }

  watch(visibleNavItems, ensureActiveModule, { immediate: true })

  onMounted(() => {
    window.addEventListener('popstate', handlePopState)
    ensureActiveModule()
  })

  onUnmounted(() => {
    window.removeEventListener('popstate', handlePopState)
  })

  return {
    activeModule,
    visibleNavItems,
    visibleLeafItems,
    ensureActiveModule,
    setActiveModule
  }
}

export function useModuleMap(imports) {
  const MODULE_MAP = {
    copygen:    imports.CopyGenModule,
    projectAgent: imports.ProjectAgentModule,
    tools:      imports.ToolsModule,
    workflow:   imports.WorkflowModule,
    dailyhot:   imports.DailyHotModule,
    accountmonitor: imports.AccountMonitorModule,
    commentReply: imports.CommentReplyModule,
    accountDataDashboard: imports.AccountDataDashboardModule,
    accountDataAccounts: imports.AccountDataAccountsModule,
    accountStyle: imports.AccountStyleModule,
    styleLibrary: imports.StyleLibraryModule,
    styleCollect: imports.StyleLibraryModule,
    styleProjectWorkbench: imports.StyleProjectWorkbenchModule,
    styleProjects: imports.StyleProjectWorkbenchModule,
    styleCopyTools: imports.StyleProjectWorkbenchModule,
    styleWriter: imports.StyleWriterModule,
    styleDrafts: imports.StyleWriterModule,
    styleAssets: imports.StyleAssetsModule,
    styleDouyinHotlist: imports.DouyinHotlistModule,
    ops:        imports.OpsModule,
    trafficPlan: imports.TrafficPlanModule,
    trafficApply: imports.TrafficPlanModule,
    styleGrossMargin: imports.GrossMarginModule,
    schedule:   imports.ScheduleModule,
    imagegen:   imports.ImagegenModule,
    ideoboard:  imports.IdeaBoardModule,
    smartcollect: imports.SmartCollectModule,
    material:   imports.MaterialModule,
    projectDelivery: imports.ProjectDeliveryModule,
    videopublish: imports.VideoPublishModule,
    vector:     imports.VectorModule,
    adminUsers: imports.AdminUsersModule,
    operationLogs: imports.OperationLogModule,
    systemHealth: imports.SystemHealthModule,
    posttools:  imports.PostToolsModule,
  }

  function getActiveModuleComponent(activeModuleId) {
    return MODULE_MAP[activeModuleId] || MODULE_MAP.accountmonitor || MODULE_MAP.dailyhot
  }

  function getActiveModuleKey(moduleId) {
    if (moduleId === 'dailyhot') return 'dailyhot-right-panel-v3'
    return moduleId
  }

  function getStyleWorkbenchPath(moduleId) {
    return moduleId || ''
  }

  function isValidModule(moduleId) {
    return !!MODULE_MAP[moduleId]
  }

  return {
    MODULE_MAP,
    getActiveModuleComponent,
    getActiveModuleKey,
    getStyleWorkbenchPath,
    isValidModule
  }
}


