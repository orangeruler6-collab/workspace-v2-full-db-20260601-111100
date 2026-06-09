export const MODULE_DEFINITIONS = [
  { id: 'accountmonitor', label: '账号热榜', icon: '↗' },
  { id: 'trafficPlan', label: '投流计划', icon: '◆' },
  { id: 'dailyhot', label: '每日热点', icon: '🔥' },
  {
    id: 'accountDataWorkbench',
    label: '账号数据看板',
    icon: '📈',
    children: [
      { id: 'accountDataDashboard', label: '数据看板', icon: '图' },
      { id: 'accountDataAccounts', label: '账号池', icon: '库' },
      { id: 'ops', label: '流水看板', icon: '📊' }
    ]
  },
  {
    id: 'copyWorkbench',
    label: '文案工作台',
    icon: '✍️',
    children: [
      { id: 'styleLibrary', label: '账号库', icon: '📚' },
      { id: 'styleProjectWorkbench', label: '项目工作台', icon: '🗂️' },
      { id: 'styleWriter', label: '对话写作', icon: '💬' },
      { id: 'styleAssets', label: '评论生成', icon: '💬' },
      { id: 'tools', label: '文案工具', icon: '🧰' },
      { id: 'styleGrossMargin', label: '数据维护', icon: '🧮' }
    ]
  },
  { id: 'projectAgent', label: '项目助手', icon: '◈' },
  { id: 'ideoboard', label: '创意看板', icon: '💡' },
  { id: 'schedule', label: '排期看板', icon: '📅' },
  { id: 'imagegen', label: 'AI 生图', icon: '🎨' },
  { id: 'posttools', label: '后期工具', icon: '🎬' },
  { id: 'videopublish', label: '视频发布', icon: '📡' },
  { id: 'material', label: '素材库', icon: '🗃️' },
  { id: 'smartcollect', label: '智能采片', icon: '🎞️' },
  { id: 'feedback', label: '意见收集', icon: '✦' },
  { id: 'vector', label: '向量库', icon: '🧠' },
  { id: 'adminUsers', label: '成员管理', icon: '👥', adminOnly: true },
  { id: 'operationLogs', label: '操作日志', icon: '📜', adminOnly: true }
]

const copyWorkbenchChildren = MODULE_DEFINITIONS.find(item => item.id === 'copyWorkbench')?.children
if (copyWorkbenchChildren && !copyWorkbenchChildren.some(item => item.id === 'workflow')) {
  const writerIndex = copyWorkbenchChildren.findIndex(item => item.id === 'styleWriter')
  copyWorkbenchChildren.splice(Math.max(0, writerIndex + 1), 0, {
    id: 'workflow',
    label: '文案工作流',
    icon: '流'
  })
}
if (copyWorkbenchChildren) {
  const assetsIndex = copyWorkbenchChildren.findIndex(item => item.id === 'styleAssets')
  if (assetsIndex >= 0) copyWorkbenchChildren.splice(assetsIndex, 1)
  const grossMarginIndex = copyWorkbenchChildren.findIndex(item => item.id === 'styleGrossMargin')
  if (grossMarginIndex >= 0) copyWorkbenchChildren.splice(grossMarginIndex, 1)
}

export const HIDDEN_MODULE_DEFINITIONS = [
  { id: 'trafficApply', label: '投流申请', icon: '◆', hidden: true },
  { id: 'copygen', label: '文案生成器', icon: '✍️', hidden: true },
  { id: 'accountStyle', label: '账号风格', icon: '📚', hidden: true },
  { id: 'styleCollect', label: '采集首页', icon: '📥', hidden: true },
  { id: 'styleProjects', label: '项目库', icon: '🗂️', hidden: true },
  { id: 'styleCopyTools', label: '文案素材', icon: '🧾', hidden: true },
  { id: 'styleDrafts', label: '草稿', icon: '📝', hidden: true },
  { id: 'projectDelivery', label: '项目看板', icon: '板', hidden: true },
  { id: 'workflow', label: '文案工作流', icon: '⚡', hidden: true }
]

export function flattenModuleDefinitions(items = MODULE_DEFINITIONS) {
  return items.flatMap(item => item.children ? item.children : [item])
}

export const LEAF_MODULE_DEFINITIONS = flattenModuleDefinitions(MODULE_DEFINITIONS)
export const ALL_MODULE_DEFINITIONS = LEAF_MODULE_DEFINITIONS.concat(
  HIDDEN_MODULE_DEFINITIONS.filter(item => item.id !== 'workflow')
)
export const MEMBER_MODULES = LEAF_MODULE_DEFINITIONS.filter(item => !item.adminOnly)
export const RESTRICTED_MEMBER_MODULES = ['ops', 'adminUsers', 'operationLogs']

export function isAdminLike(user) {
  if (!user) return false
  if (user.role === 'admin') return true
  const title = user.title || ''
  return title === '组长' || title === '部长'
}

export function canAccessModule(user, moduleId) {
  if (!user) return false
  if (isAdminLike(user)) return true
  if (moduleId === 'accountmonitor' && Array.isArray(user.permissions) && user.permissions.includes('dailyhot')) return true

  const parentModule = MODULE_DEFINITIONS.find(item => item.id === moduleId && Array.isArray(item.children))
  if (parentModule) {
    return parentModule.children.some(child => canAccessModule(user, child.id))
  }

  if (user.role === 'member') {
    if (RESTRICTED_MEMBER_MODULES.includes(moduleId)) {
      const title = user.title || ''
      if (title === '组长' || title === '部长') return true
      return moduleId === 'ops' && Array.isArray(user.permissions) && user.permissions.includes(moduleId)
    }
  }

  const module = ALL_MODULE_DEFINITIONS.find(item => item.id === moduleId)
  if (!module || module.adminOnly) return false
  if (user.role === 'member') return true
  return Array.isArray(user.permissions) && user.permissions.includes(moduleId)
}
