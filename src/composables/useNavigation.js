import { ref, computed, watch } from 'vue'
import { canAccessModule, MODULE_DEFINITIONS, flattenModuleDefinitions } from '../permissions'

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
  const activeModule = ref(DEFAULT_MODULE)

  const visibleNavItems = computed(() => {
    if (skipPermissions) return MODULE_DEFINITIONS
    const user = authUser.value
    if (!user) return []
    return filterNavItems(MODULE_DEFINITIONS, user, false)
  })

  const visibleLeafItems = computed(() => flattenModuleDefinitions(visibleNavItems.value))

  function ensureActiveModule() {
    if (!visibleLeafItems.value.length) return
    if (!canAccessModule(authUser.value, activeModule.value)) {
      activeModule.value = visibleLeafItems.value[0].id
    }
  }

  function setActiveModule(moduleId) {
    activeModule.value = moduleId
  }

  watch(visibleNavItems, ensureActiveModule)

  return {
    activeModule,
    visibleNavItems,
    visibleLeafItems,
    ensureActiveModule,
    setActiveModule
  }
}

export function useModuleMap(imports) {
  const styleWorkbenchRoutes = {
    styleLibrary: '/library',
    styleProjectWorkbench: '/project-workbench',
    styleWriter: '/writer',
    styleAssets: '/assets',
    styleCollect: '/library',
    styleProjects: '/project-workbench',
    styleCopyTools: '/project-workbench',
    styleDrafts: '/writer'
  }

  const MODULE_MAP = {
    copygen:    imports.CopyGenModule,
    projectAgent: imports.ProjectAgentModule,
    tools:      imports.ToolsModule,
    workflow:   imports.WorkflowModule,
    dailyhot:   imports.DailyHotModule,
    accountmonitor: imports.AccountMonitorModule,
    accountStyle: imports.AccountStyleModule,
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
    feedback:   imports.FeedbackModule,
    vector:     imports.VectorModule,
    adminUsers: imports.AdminUsersModule,
    operationLogs: imports.OperationLogModule,
    posttools:  imports.PostToolsModule,
  }

  Object.keys(styleWorkbenchRoutes).forEach((moduleId) => {
    MODULE_MAP[moduleId] = imports.StyleWorkbenchFrame
  })

  function getActiveModuleComponent(activeModuleId) {
    return MODULE_MAP[activeModuleId] || MODULE_MAP.accountmonitor || MODULE_MAP.dailyhot
  }

  function getActiveModuleKey(moduleId) {
    if (moduleId === 'dailyhot') return 'dailyhot-right-panel-v3'
    if (styleWorkbenchRoutes[moduleId]) return 'style-workbench-frame'
    return moduleId
  }

  function getStyleWorkbenchPath(moduleId) {
    return styleWorkbenchRoutes[moduleId] || '/'
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
