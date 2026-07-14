import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  deleteScheduleTodo,
  loadSchedule,
  loadScheduleRevision,
  loadScheduleTodoHistory,
  loadScheduleTodos,
  notifyScheduleHandoff,
  saveSchedule,
  saveScheduleTodo,
  updateScheduleTodoStatus,
  uploadScheduleDoc
} from '../../api/schedule'
import { ALL_ACCOUNTS, GROUPS, MEMBERS, STATUS_MAP, TYPE_TAG, WORKFLOW_STAGES } from './constants'
import { getCurrentAuthUser } from '../../api/client'

const DEPARTMENT_TODO_TAB = 'department-todos'
const DEPARTMENT_TODO_ACCOUNT = '部门待办'
const SCHEDULE_SYNC_INTERVAL_MS = 15000
const SCHEDULE_IDLE_SYNC_DELAY_MS = 8000
const DEFAULT_TODO_DUE_TIME = '23:00'

const PRODUCTION_WORKFLOW_STAGES = ['文案', '后期', '待发布', '已发布']

function applyScheduleCollaborativePreset() {
  return null
}

function createEmptyForm() {
  return {
    id: null,
    account: '',
    person: '',
    group_name: '',
    content: '',
    remark: '',
    date: '',
    type: '日常',
    status: 'pending',
    workflow_stage: '文案',
    stack_count: 1,
    cooperation: false,
    participants: [],
    parallel_person: '',
    activity_log: [],
    doc_title: '',
    doc_url: '',
    doc_kind: '',
    doc_dragging: false
  }
}

function createEmptyTodoDraft() {
  return {
    title: '',
    detail: '',
    dueDate: '',
    dueTime: '',
    important: false
  }
}

export function useScheduleBoard(showToast, options = {}) {
  const currentUser = computed(() => options.user || getCurrentAuthUser())

  function normalizeGroupKey(value) {
    return String(value || '')
      .trim()
      .replace(/\u5185\u5bb9/g, '')
      .replace(/\u7ec4/g, '')
      .replace(/\u90e8/g, '')
  }

  function groupKeys(group) {
    return [group?.label, ...(group?.aliases || [])]
      .map(normalizeGroupKey)
      .filter(Boolean)
  }

  function canonicalGroupLabel(value) {
    const key = normalizeGroupKey(value)
    const group = GROUPS.find(item => groupKeys(item).includes(key))
    return group?.label || String(value || '').trim()
  }

  function findGroupByUser(user) {
    if (!user) return null
    const groupText = String(user.group_name || user.groupName || user.group || '').trim()
    if (groupText) {
      const groupKey = normalizeGroupKey(groupText)
      const matchedByGroup = GROUPS.find(group => {
        return group.label === groupText
          || String(group.id) === groupText
          || groupKeys(group).includes(groupKey)
      })
      if (matchedByGroup) return matchedByGroup
    }

    const userName = String(user.real_name || user.display_name || user.username || '').trim()
    return GROUPS.find(group => group.members.includes(userName)) || null
  }

  const canDeleteTasks = computed(() => {
    const user = currentUser.value
    if (!user) return false
    if (user.role === 'admin') return true
    const title = String(user.title || '').trim()
    return title === '部长' || title === '组长'
  })

  const canViewAllGroups = computed(() => {
    const user = currentUser.value
    if (!user) return false
    if (user.role === 'admin') return true
    const title = String(user.title || '').trim()
    return title === '部长' || title === '组长'
  })

  const getDefaultGroupId = () => {
    const user = currentUser.value
    if (!user) return GROUPS[0].id

    const matched = findGroupByUser(user)
    if (matched) return matched.id
    if (user.role === 'admin') return 3
    return GROUPS[0].id
  }

  const activeGroup = ref(getDefaultGroupId())
  const viewMode = ref('person')
  const weekOffset = ref(0)
  const scheduleRevision = ref(0)
  const allItems = ref([])
  const itemsByPerson = reactive(Object.fromEntries(MEMBERS.map(member => [member, []])))
  const boardRef = ref(null)
  const isPanning = ref(false)
  const panStart = ref({ x: 0, scrollLeft: 0 })
  const dragItem = ref(null)
  const copiedTask = ref(null)
  const activeTask = ref(null)
  const activePasteTarget = ref(null)
  const formShow = ref(false)
  const editing = ref(false)
  const history = ref([])
  const maxHistory = 20
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const form = reactive(createEmptyForm())
  const scheduleTodos = ref([])
  const scheduleTodoHistory = ref([])
  const scheduleTodoHistoryLoading = ref(false)
  const todoDrafts = reactive({})
  let scheduleSyncTimer = 0
  let scheduleSaving = false
  let scheduleLoading = false
  let scheduleSyncing = false
  let lastLocalScheduleChangeAt = 0

  watch(currentUser, () => {
    activeGroup.value = getDefaultGroupId()
  })

  function pushHistory() {
    history.value.push(JSON.stringify(allItems.value))
    if (history.value.length > maxHistory) history.value.shift()
    markLocalScheduleChanged()
  }

  function markLocalScheduleChanged() {
    lastLocalScheduleChangeAt = Date.now()
  }

  function undo() {
    if (!history.value.length) {
      showToast('没有可撤销的操作', 'info')
      return
    }
    const snapshot = history.value.pop()
    try {
      const tasks = JSON.parse(snapshot)
      rebuildItemsByPerson(tasks)
      persistSchedule()
      showToast('已撤销', 'success')
    } catch (err) {
      showToast('撤销失败', 'error')
    }
  }

  function isTextEditingTarget(target) {
    const tag = String(target?.tagName || '').toLowerCase()
    return Boolean(target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag))
  }

  function handleKeydown(e) {
    const key = String(e.key || '').toLowerCase()
    const isCommand = e.ctrlKey || e.metaKey
    if (!isCommand || isTextEditingTarget(e.target)) return

    if (key === 'z') {
      e.preventDefault()
      undo()
      return
    }

    if (key === 'c') {
      const source = activeTask.value || (editing.value ? allItems.value.find(item => item.id === form.id) : null)
      if (!source) return
      e.preventDefault()
      copyItem(source)
      return
    }

    if (key === 'v') {
      if (!copiedTask.value) return
      e.preventDefault()
      pasteCopiedTask(activePasteTarget.value)
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('usagi:agent-action', handleAgentAction)
    consumePendingAgentAction()
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('usagi:agent-action', handleAgentAction)
    if (scheduleSyncTimer) {
      window.clearInterval(scheduleSyncTimer)
      scheduleSyncTimer = 0
    }
  })

  const currentGroup = computed(() => GROUPS.find(group => group.id === activeGroup.value) || GROUPS[0])
  const currentGroupMembers = computed(() => {
    const members = [...(currentGroup.value?.members || [])]
    const name = currentUserName()
    if (!name) return members
    const index = members.indexOf(name)
    if (index <= 0) return members
    const [self] = members.splice(index, 1)
    members.unshift(self)
    return members
  })
  const currentGroupAccounts = computed(() => currentGroup.value?.accounts || [])
  const currentGroupWeekAccounts = computed(() => {
    const accounts = currentGroupAccounts.value || []
    return getGroupTodos(currentGroup.value).some(todo => todo.status !== 'done')
      ? [DEPARTMENT_TODO_ACCOUNT, ...accounts]
      : accounts
  })
  const visibleTodoGroups = computed(() => canViewAllGroups.value ? GROUPS : [currentGroup.value].filter(Boolean))

  function todoDraftFor(group) {
    const key = String(group?.id || group?.label || 'default')
    if (!todoDrafts[key]) todoDrafts[key] = createEmptyTodoDraft()
    return todoDrafts[key]
  }

  function groupLeaderName(group) {
    return group?.leader || '未设置'
  }

  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  function toDateValue(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  function nextWeekdayDate(weekday) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
    const target = map[weekday]
    if (target == null) return ''
    const date = new Date()
    const current = date.getDay()
    let delta = target - current
    if (delta <= 0) delta += 7
    date.setDate(date.getDate() + delta)
    return toDateValue(date)
  }

  function dateFromMonthDay(monthText, dayText) {
    const now = new Date()
    const month = Math.max(1, Math.min(12, Number(monthText || now.getMonth() + 1)))
    const day = Math.max(1, Math.min(31, Number(dayText || now.getDate())))
    const date = new Date(now.getFullYear(), month - 1, day)
    if (date < today) date.setFullYear(date.getFullYear() + 1)
    return toDateValue(date)
  }

  function parseQuickTodoText(text) {
    const raw = String(text || '').trim()
    const parsed = { title: raw, date: '', time: '', important: /重要|紧急|提醒|高优先|必须/.test(raw) }
    const timeMatch = raw.match(/(?:^|[^\d])([01]?\d|2[0-3])(?:[:：点时]([0-5]\d)?)?/)
    if (timeMatch && /[:：点时]/.test(timeMatch[0])) {
      parsed.time = `${pad2(Number(timeMatch[1]))}:${pad2(Number(timeMatch[2] || 0))}`
    }
    if (/后天/.test(raw)) {
      const date = new Date()
      date.setDate(date.getDate() + 2)
      parsed.date = toDateValue(date)
    } else if (/明天/.test(raw)) {
      const date = new Date()
      date.setDate(date.getDate() + 1)
      parsed.date = toDateValue(date)
    } else if (/今天/.test(raw)) {
      parsed.date = toDateValue(new Date())
    } else {
      const weekdayMatch = raw.match(/(?:周|星期)([一二三四五六日天])/)
      if (weekdayMatch) parsed.date = nextWeekdayDate(weekdayMatch[1])
      const dayMatch = raw.match(/(?:(\d{1,2})[月/-])?(\d{1,2})[号日]/)
      if (dayMatch) parsed.date = dateFromMonthDay(dayMatch[1], dayMatch[2])
    }

    parsed.title = raw
      .replace(/后天|明天|今天/g, '')
      .replace(/(?:周|星期)[一二三四五六日天]/g, '')
      .replace(/(?:(?:\d{1,2})[月/-])?\d{1,2}[号日]/g, '')
      .replace(/(?:^|[^\d])([01]?\d|2[0-3])(?:[:：点时]([0-5]\d)?)?/g, ' ')
      .replace(/重要|紧急|提醒|高优先|必须/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return parsed
  }

  function combineTodoDueAt(dateValue, timeValue) {
    if (!dateValue) return ''
    return `${dateValue}T${timeValue || DEFAULT_TODO_DUE_TIME}`
  }

  function toTodoDateTimeValue(date) {
    return `${toDateValue(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  }

  function parseTodoDueDate(todo) {
    const value = String(todo?.due_at || '').trim()
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  function startOfCurrentWeek(date = new Date()) {
    const result = new Date(date)
    const day = result.getDay()
    const diff = day === 0 ? -6 : 1 - day
    result.setHours(0, 0, 0, 0)
    result.setDate(result.getDate() + diff)
    return result
  }

  function unixSecondsToDate(value) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) return null
    const date = new Date(number * 1000)
    return Number.isNaN(date.getTime()) ? null : date
  }

  function shouldShowTodoOnBoard(todo) {
    const weekStart = startOfCurrentWeek()
    const dueDate = parseTodoDueDate(todo)
    if (dueDate && dueDate < weekStart) return false

    if (todo?.status === 'done') {
      const doneDate = unixSecondsToDate(todo.updated_at)
        || unixSecondsToDate(todo.created_at)
        || dueDate
      if (doneDate && doneDate < weekStart) return false
    }

    return true
  }

  function todoAlarmLevel(todo) {
    if (todo?.status === 'done') return 'done'
    const dueDate = parseTodoDueDate(todo)
    if (!dueDate) return Number(todo?.important) ? 'important' : ''
    const now = new Date()
    if (dueDate < now) return 'overdue'
    const todayValue = toDateValue(now)
    if (toDateValue(dueDate) === todayValue) return 'today'
    if (dueDate.getTime() - now.getTime() <= 24 * 60 * 60 * 1000) return 'soon'
    return Number(todo?.important) ? 'important' : ''
  }

  function todoReminderLabel(todo) {
    const level = todoAlarmLevel(todo)
    if (level === 'done') return '已完成'
    if (level === 'overdue') return '已逾期'
    if (level === 'today') return '今日提醒'
    if (level === 'soon') return '24小时内'
    if (level === 'important') return '重要'
    return ''
  }

  function todoDueLabel(todo) {
    const date = parseTodoDueDate(todo)
    if (!date) return '未设日程'
    const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${date.getMonth() + 1}/${date.getDate()} ${weeks[date.getDay()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  }

  function formatTodoDuration(ms) {
    const minutes = Math.max(1, Math.ceil(Math.abs(ms) / 60000))
    if (minutes < 60) return `${minutes}分钟`
    const hours = Math.ceil(minutes / 60)
    if (hours < 24) return `${hours}小时`
    const days = Math.ceil(hours / 24)
    return `${days}天`
  }

  function todoCountdownLabel(todo) {
    if (todo?.status === 'done') return '已完成'
    const date = parseTodoDueDate(todo)
    if (!date) return '未设 DDL'
    const now = new Date()
    const diff = date.getTime() - now.getTime()
    if (diff < 0) return `超时 ${formatTodoDuration(diff)}`
    if (toDateValue(date) === toDateValue(now)) return `今天 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    return `剩 ${formatTodoDuration(diff)}`
  }

  function todoQuestRank(todo) {
    const level = todoAlarmLevel(todo)
    if (level === 'done') return 'OK'
    if (level === 'overdue') return 'S'
    if (level === 'today' || level === 'soon') return 'A'
    if (level === 'important') return 'B'
    return parseTodoDueDate(todo) ? 'C' : 'N'
  }

  function todoDeadlinePressure(todo) {
    if (todo?.status === 'done') return 0
    const level = todoAlarmLevel(todo)
    if (level === 'overdue') return 100
    const dueDate = parseTodoDueDate(todo)
    if (!dueDate) return Number(todo?.important) ? 42 : 18
    const diff = dueDate.getTime() - Date.now()
    const day = 24 * 60 * 60 * 1000
    if (diff <= 6 * 60 * 60 * 1000) return 88
    if (level === 'today') return 78
    if (level === 'soon') return 62
    if (diff <= 3 * day) return 46
    if (Number(todo?.important)) return 38
    return 18
  }

  function todoDeadlinePressureLabel(todo) {
    const level = todoAlarmLevel(todo)
    if (todo?.status === 'done') return '已拆弹'
    if (level === 'overdue') return '已越过斩杀线'
    if (level === 'today') return '斩杀线贴脸'
    if (level === 'soon') return '斩杀线逼近'
    if (Number(todo?.important)) return '重点盯防'
    return parseTodoDueDate(todo) ? '斩杀线稳定' : '未设斩杀线'
  }

  function compareTodos(a, b) {
    if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1
    if (Number(a.important) !== Number(b.important)) return Number(b.important) - Number(a.important)
    const dueA = parseTodoDueDate(a)?.getTime() || Number.MAX_SAFE_INTEGER
    const dueB = parseTodoDueDate(b)?.getTime() || Number.MAX_SAFE_INTEGER
    if (dueA !== dueB) return dueA - dueB
    return Number(b.created_at || b.id || 0) - Number(a.created_at || a.id || 0)
  }

  function getGroupTodos(group) {
    const keys = groupKeys(group)
    return scheduleTodos.value
      .filter(todo => keys.includes(normalizeGroupKey(todo.group_name)))
      .filter(shouldShowTodoOnBoard)
      .slice()
      .sort(compareTodos)
  }

  function todoScheduleDate(todo) {
    const dueDate = parseTodoDueDate(todo)
    return formatDate(dueDate || today)
  }

  function todoSchedulePerson(todo, group = currentGroup.value) {
    const assignee = String(todo?.assignee || '').trim()
    if (assignee) return assignee
    const leader = String(group?.leader || '').trim()
    if (leader) return leader
    return currentGroupMembers.value[0] || MEMBERS[0] || ''
  }

  function todoScheduleStatus(todo) {
    if (todo?.status === 'done') return 'done'
    return todoAlarmLevel(todo) === 'overdue' ? 'delayed' : 'pending'
  }

  function todoScheduleTone(todo) {
    const level = todoAlarmLevel(todo)
    if (level === 'done') return 'done'
    if (level === 'overdue') return 'delayed'
    return 'pending'
  }

  function buildTodoScheduleItem(todo, group = currentGroup.value) {
    const status = todoScheduleStatus(todo)
    const person = todoSchedulePerson(todo, group)
    const title = String(todo?.title || '').trim() || '部门待办'
    const detail = String(todo?.detail || '').trim()
    return {
      id: `todo-${todo?.id || title}`,
      _todo_mapped: true,
      todo,
      account: DEPARTMENT_TODO_ACCOUNT,
      person,
      view_person: person,
      group_name: group?.label || todo?.group_name || '',
      content: title,
      remark: detail,
      type: DEPARTMENT_TODO_ACCOUNT,
      status,
      date: todoScheduleDate(todo),
      date_label: todoCountdownLabel(todo),
      latest_activity_text: detail,
      workflow_stage: DEPARTMENT_TODO_ACCOUNT,
      workflow_stage_label: todoReminderLabel(todo) || DEPARTMENT_TODO_ACCOUNT,
      workflow_stage_tone: todoScheduleTone(todo),
      workflow_stage_short_label: todo?.status === 'done' ? 'OK' : '办',
      workflow_stage_step_label: DEPARTMENT_TODO_ACCOUNT,
      workflow_stage_action_label: todo?.status === 'done' ? '标记未完成' : '标记完成',
      workflow_stage_progress_angle: todoDeadlinePressure(todo) * 3.6,
      _week_key: `todo-week-${todo?.id || title}`
    }
  }

  function currentGroupTodoScheduleItems() {
    return getGroupTodos(currentGroup.value)
      .filter(todo => todo.status !== 'done')
      .map(todo => buildTodoScheduleItem(todo, currentGroup.value))
  }

  function personScheduleItems(person) {
    const normalItems = (itemsByPerson[person] || []).filter(item => item.status !== 'done')
    const todoItems = currentGroupTodoScheduleItems().filter(item => item.person === person)
    return [...todoItems, ...normalItems].sort(compareTaskOrder)
  }

  function getGroupOpenTodoCount(group) {
    return getGroupTodos(group).filter(todo => todo.status !== 'done').length
  }

  function summarizeTodoList(todos) {
    const list = Array.isArray(todos) ? todos : []
    const total = list.length
    const done = list.filter(todo => todo.status === 'done').length
    const open = total - done
    const overdue = list.filter(todo => todoAlarmLevel(todo) === 'overdue').length
    const todayCount = list.filter(todo => todoAlarmLevel(todo) === 'today').length
    const soon = list.filter(todo => todoAlarmLevel(todo) === 'soon').length
    const important = list.filter(todo => Number(todo?.important) && todo.status !== 'done').length
    return {
      total,
      open,
      done,
      overdue,
      today: todayCount,
      soon,
      important,
      progress: total ? Math.round((done / total) * 100) : 0
    }
  }

  function getGroupTodoStats(group) {
    return summarizeTodoList(getGroupTodos(group))
  }

  const departmentTodoStats = computed(() => {
    return summarizeTodoList(visibleTodoGroups.value.flatMap(group => getGroupTodos(group)))
  })

  function getGroupNextDeadline(group) {
    const next = getGroupTodos(group).find(todo => todo.status !== 'done' && parseTodoDueDate(todo))
    return next ? todoCountdownLabel(next) : '暂无 DDL'
  }

  function getGroupQuestLevel(group) {
    const stats = getGroupTodoStats(group)
    if (stats.overdue) return 'S'
    if (stats.today || stats.soon) return 'A'
    if (stats.important) return 'B'
    return stats.open ? 'C' : 'OK'
  }

  function todoGroupTone(group) {
    const stats = getGroupTodoStats(group)
    if (stats.overdue) return 'danger'
    if (stats.today || stats.soon) return 'urgent'
    if (stats.important) return 'focus'
    if (!stats.open && stats.total) return 'clear'
    return ''
  }

  async function loadScheduleTodosData() {
    try {
      const data = await loadScheduleTodos()
      scheduleTodos.value = Array.isArray(data.todos)
        ? data.todos.map(todo => ({
          ...todo,
          group_name: canonicalGroupLabel(todo.group_name)
        }))
        : []
    } catch (err) {
      showToast('待办加载失败: ' + err.message, 'error')
    }
  }

  async function loadScheduleTodoHistoryData() {
    scheduleTodoHistoryLoading.value = true
    try {
      const data = await loadScheduleTodoHistory(300)
      scheduleTodoHistory.value = Array.isArray(data.todos) ? data.todos : []
    } catch (err) {
      showToast('待办历史加载失败: ' + err.message, 'error')
    } finally {
      scheduleTodoHistoryLoading.value = false
    }
  }

  async function addGroupTodo(group) {
    const draft = todoDraftFor(group)
    const parsed = parseQuickTodoText(draft.title)
    const title = parsed.title || String(draft.title || '').trim()
    if (!title) {
      showToast('先输入待办事项', 'error')
      return
    }
    const dueDate = draft.dueDate || parsed.date
    const dueTime = draft.dueTime || parsed.time || (dueDate ? DEFAULT_TODO_DUE_TIME : '')
    try {
      await saveScheduleTodo({
        group_name: group?.label || '',
        title,
        detail: String(draft.detail || '').trim(),
        due_at: combineTodoDueAt(dueDate, dueTime),
        important: draft.important || parsed.important ? 1 : 0,
        progress: 0,
        status: 'open'
      })
      Object.assign(draft, createEmptyTodoDraft())
      await loadScheduleTodosData()
      showToast('待办已添加', 'success')
    } catch (err) {
      showToast('待办保存失败: ' + err.message, 'error')
    }
  }

  async function toggleTodoDone(todo) {
    const nextStatus = todo?.status === 'done' ? 'open' : 'done'
    try {
      await updateScheduleTodoStatus(todo.id, nextStatus)
      todo.status = nextStatus
      await loadScheduleTodosData()
    } catch (err) {
      showToast('待办状态更新失败: ' + err.message, 'error')
    }
  }

  async function assignTodoToPerson(todo, person) {
    const assignee = String(person || '').trim()
    if (!todo || !todo.id || !assignee) return
    try {
      await saveScheduleTodo({
        id: todo.id,
        group_name: canonicalGroupLabel(todo.group_name),
        title: todo.title,
        detail: todo.detail || '',
        due_at: todo.due_at || '',
        important: todo.important,
        progress: todo.progress || 0,
        status: todo.status || 'open',
        assignee
      })
      todo.assignee = assignee
      await loadScheduleTodosData()
      showToast('待办已安排给 ' + assignee, 'success')
    } catch (err) {
      showToast('待办安排失败: ' + err.message, 'error')
    }
  }

  async function pleadDelayTodo(todo) {
    if (!todo || todo.status === 'done') return
    const now = new Date()
    const dueDate = parseTodoDueDate(todo)
    const nextDue = dueDate && dueDate > now ? new Date(dueDate) : new Date(now)
    if (!dueDate) {
      nextDue.setHours(23, 0, 0, 0)
    }
    nextDue.setDate(nextDue.getDate() + 1)
    try {
      await saveScheduleTodo({
        id: todo.id,
        group_name: canonicalGroupLabel(todo.group_name),
        title: todo.title,
        detail: todo.detail || '',
        due_at: toTodoDateTimeValue(nextDue),
        important: todo.important,
        progress: 0,
        status: 'open',
        assignee: todo.assignee || ''
      })
      todo.due_at = toTodoDateTimeValue(nextDue)
      todo.status = 'open'
      await loadScheduleTodosData()
      showToast('老大同意了，DDL 顺延 1 天', 'success', { big: true, timeout: 2600 })
    } catch (err) {
      showToast('求延期失败: ' + err.message, 'error')
    }
  }

  async function removeTodo(todo) {
    try {
      await deleteScheduleTodo(todo.id)
      scheduleTodos.value = scheduleTodos.value.filter(item => item.id !== todo.id)
      showToast('待办已删除', 'success')
    } catch (err) {
      showToast('待办删除失败: ' + err.message, 'error')
    }
  }

  const weekDays = computed(() => getWeekDays(weekOffset.value))
  const weekRangeLabel = computed(() => {
    const days = weekDays.value
    const start = days[0]
    const end = days[6]
    return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`
  })

  function ensurePersonBucket(person) {
    if (person && !itemsByPerson[person]) itemsByPerson[person] = []
  }

  function compareTaskOrder(a, b) {
    const taskA = a?.task || a
    const taskB = b?.task || b
    const orderA = Number(taskA?.sort_order || 0)
    const orderB = Number(taskB?.sort_order || 0)
    if (orderA !== orderB) return orderA - orderB
    const dateCompare = String(taskA?.date || '').localeCompare(String(taskB?.date || ''))
    if (dateCompare) return dateCompare
    return Number(taskA?.id || 0) - Number(taskB?.id || 0)
  }

  function findGroupByMember(person) {
    return GROUPS.find(group => group.members.includes(person))
  }

  function findGroupByAccount(account) {
    const matches = GROUPS.filter(group => group.accounts.includes(account))
    return matches.length === 1 ? matches[0] : null
  }

  function inferItemGroupName(item, fallbackGroup = currentGroup.value) {
    const explicit = String(item?.group_name || '').trim()
    if (GROUPS.some(group => group.label === explicit)) return explicit
    return findGroupByMember(item?.person)?.label
      || findGroupByAccount(item?.account)?.label
      || fallbackGroup?.label
      || ''
  }

  function normalizeWorkflowStage(stage, item = {}) {
    const explicit = String(stage || '').trim()
    if (WORKFLOW_STAGES.includes(explicit)) return explicit
    if (item?.status === 'done') return '已发布'
    if (item?.status === 'delayed') return '延期'
    const text = [item?.type, item?.content, item?.remark, item?.doc_title].filter(Boolean).join(' ')
    if (/后期|剪辑|合成|调色/.test(text)) return '后期'
    if (String(item?.doc_url || '').trim()) return '待发布'
    return '文案'
  }

  function normalizeProductionWorkflowStage(stage, item = {}) {
    const value = normalizeWorkflowStage(stage, item)
    return PRODUCTION_WORKFLOW_STAGES.includes(value) ? value : '文案'
  }

  function normalizeParticipantRoles(roles, fallbackStage = '文案') {
    const source = Array.isArray(roles)
      ? roles
      : String(roles || '').split(/[\/,，、;+]+/)
    const cleaned = Array.from(new Set(source.map(role => String(role || '').trim()).filter(Boolean)))
    if (cleaned.length) return cleaned
    return fallbackStage ? [fallbackStage] : []
  }

  function normalizeParticipants(rawParticipants, fallbackPerson, fallbackStage = '文案') {
    let rows = rawParticipants
    if (typeof rows === 'string') {
      const text = rows.trim()
      if (!text) {
        rows = []
      } else {
        try {
          rows = JSON.parse(text)
        } catch {
          rows = text.split(/[;；]/).map(part => {
            const [person, roleText] = String(part || '').split(/[:：]/)
            return { person, roles: roleText ? roleText.split(/[\/,，、+]+/) : [] }
          })
        }
      }
    }
    if (!Array.isArray(rows)) rows = []
    const map = new Map()
    rows.forEach(row => {
      const person = String(row?.person || row?.name || '').trim()
      if (!person) return
      const nextRoles = normalizeParticipantRoles(row?.roles || row?.role || [], fallbackStage)
      const existing = map.get(person)
      if (existing) {
        existing.roles = Array.from(new Set([...(existing.roles || []), ...nextRoles]))
      } else {
        map.set(person, { person, roles: nextRoles })
      }
    })
    let cleaned = Array.from(map.values())
    if (!cleaned.length) {
      const person = String(fallbackPerson || '').trim()
      if (person) cleaned = [{ person, roles: normalizeParticipantRoles([], fallbackStage) }]
    }
    return cleaned
  }

  function participantsToJson(participants) {
    return JSON.stringify(
      (participants || [])
        .map(row => ({
          person: String(row?.person || '').trim(),
          roles: normalizeParticipantRoles(row?.roles || [], '文案')
        }))
        .filter(row => row.person)
    )
  }

  function normalizeActivityLog(rawLog) {
    let rows = rawLog
    if (typeof rows === 'string') {
      const text = rows.trim()
      if (!text) return []
      try {
        rows = JSON.parse(text)
      } catch {
        rows = []
      }
    }
    if (!Array.isArray(rows)) return []
    return rows
      .map(row => ({
        id: String(row?.id || '').trim() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        at: String(row?.at || '').trim(),
        actor: String(row?.actor || '').trim(),
        action: String(row?.action || 'stage_advance').trim(),
        from: String(row?.from || '').trim(),
        to: String(row?.to || '').trim(),
        text: String(row?.text || '').trim()
      }))
      .filter(row => row.at || row.text || row.to)
      .slice(-30)
  }

  function activityLogToJson(log) {
    return JSON.stringify(normalizeActivityLog(log).slice(-30))
  }

  function currentUserName() {
    const user = currentUser.value || {}
    return String(user.real_name || user.display_name || user.username || '').trim() || '系统'
  }

  function formatActivityTime(value) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const pad = number => String(number).padStart(2, '0')
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  function activityText(row) {
    if (!row) return ''
    if (row.text) return row.text
    if (row.action === 'stage_advance') {
      const actor = row.actor || '有人'
      return `${actor} 推进到${row.to || '下一步'}`
    }
    return row.to ? `推进到${row.to}` : ''
  }

  function latestActivityText(item) {
    const log = normalizeActivityLog(item?.activity_json || item?.activity_log || [])
    const latest = log[log.length - 1]
    if (!latest) return ''
    const time = formatActivityTime(latest.at)
    return [time, activityText(latest)].filter(Boolean).join(' ')
  }

  function appendStageActivity(item, fromStage, toStage) {
    if (!item || !toStage) return
    const log = normalizeActivityLog(item.activity_json || item.activity_log || [])
    const actor = currentUserName()
    log.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      at: new Date().toISOString(),
      actor,
      action: 'stage_advance',
      from: fromStage || '',
      to: toStage,
      text: `${actor} 将${item.account || '账号'}${item.type || ''}推进到${toStage}`
    })
    item.activity_log = log.slice(-30)
    item.activity_json = activityLogToJson(item.activity_log)
  }

  function normalizeScheduleItem(item, fallbackGroup = currentGroup.value) {
    const workflowStage = normalizeWorkflowStage(item?.workflow_stage, item)
    const participants = normalizeParticipants(item?.participants_json || item?.participants || '', item?.person, workflowStage)
    const activityLog = normalizeActivityLog(item?.activity_json || item?.activity_log || [])
    const primaryPerson = participants[0]?.person || String(item?.person || '').trim()
    const stackCount = normalizeStackCount(item)
    const normalized = {
      ...item,
      group_name: inferItemGroupName(item, fallbackGroup),
      sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : 0,
      parallel_key: String(item?.parallel_key || ''),
      schedule_hidden: Number(item?.schedule_hidden || 0) ? 1 : 0,
      linked_parent_id: Number.isFinite(Number(item?.linked_parent_id)) ? Number(item.linked_parent_id) : null,
      workflow_stage: workflowStage,
      participants,
      participants_json: participantsToJson(participants),
      activity_log: activityLog,
      activity_json: activityLogToJson(activityLog),
      stack_count: stackCount,
      stack_label: stackCount > 1 ? `x${stackCount}` : '',
      person: primaryPerson
    }
    return syncStatusFromWorkflowStage(normalized)
  }

  function buildTaskView(task, person, participant) {
    const roles = normalizeParticipantRoles(participant?.roles || [], task.workflow_stage)
    return {
      ...task,
      task,
      view_person: person,
      participant_roles: roles,
      participant_role_label: roles.join(' / '),
      participants_text: (task.participants || []).map(row => row.person).filter(Boolean).join(' / '),
      participant_count: Array.isArray(task.participants) ? task.participants.length : 0,
      stack_label: task.stack_label || '',
      latest_activity_text: latestActivityText(task),
      is_shared: Array.isArray(task.participants) && task.participants.length > 1,
      is_primary_person: person === task.person,
      workflow_stage_label: normalizeWorkflowStage(task.workflow_stage, task),
      workflow_stage_tone: workflowStageTone(task.workflow_stage),
      workflow_stage_step_label: workflowStageStepLabel(task.workflow_stage, task),
      workflow_stage_short_label: workflowStageShortLabel(task.workflow_stage, task),
      workflow_stage_progress_angle: workflowStageProgressAngle(task.workflow_stage, task),
      workflow_stage_action_label: workflowStageActionLabel(task.workflow_stage, task),
      date_label: formatPersonTaskDate(task.date)
    }
  }

  function workflowStageTone(stage) {
    const value = normalizeWorkflowStage(stage)
    if (value === '文案') return 'draft'
    if (value === '后期') return 'post'
    if (value === '待发布') return 'pending'
    if (value === '已发布') return 'done'
    return 'delayed'
  }

  function isStackableTask(task) {
    const type = String(task?.type || '')
    return type.includes('星广') || type === '素材代做'
  }

  function normalizeStackCount(task) {
    if (!isStackableTask(task)) return 1
    const raw = Number(task?.stack_count || task?.stackCount || task?.itemCount || task?.quantity || 1)
    if (!Number.isFinite(raw)) return 1
    return Math.max(1, Math.min(99, Math.round(raw)))
  }

  function workflowStageIndex(stage) {
    const value = normalizeProductionWorkflowStage(stage)
    const index = PRODUCTION_WORKFLOW_STAGES.indexOf(value)
    return index === -1 ? 0 : index
  }

  function workflowStageStepLabel(stage, item = {}) {
    const value = normalizeProductionWorkflowStage(stage, item)
    const index = PRODUCTION_WORKFLOW_STAGES.indexOf(value)
    const step = index === -1 ? 1 : Math.min(index + 1, 3)
    const total = 3
    return `${value} ${step}/${total}`
  }

  function workflowStageShortLabel(stage, item = {}) {
    const value = normalizeProductionWorkflowStage(stage, item)
    const index = PRODUCTION_WORKFLOW_STAGES.indexOf(value)
    const step = index === -1 ? 1 : Math.min(index + 1, 3)
    return `${step}/3`
  }

  function workflowStageProgressAngle(stage, item = {}) {
    const value = normalizeProductionWorkflowStage(stage, item)
    const index = PRODUCTION_WORKFLOW_STAGES.indexOf(value)
    const step = index === -1 ? 1 : Math.min(index + 1, 3)
    return Math.round((step / 3) * 360)
  }

  function workflowStageActionLabel(stage, item = {}) {
    const value = normalizeProductionWorkflowStage(stage, item)
    if (value === '待发布') return '发布'
    if (value === '已发布') return '已发布'
    return '下一步'
  }

  function workflowStageToastLabel(stage, item = {}) {
    const value = normalizeProductionWorkflowStage(stage, item)
    if (value === '文案') return '后期'
    if (value === '后期') return '待发布'
    if (value === '待发布') return '已发布'
    return '已发布'
  }

  function nextWorkflowStage(stage, item = {}) {
    const value = normalizeProductionWorkflowStage(stage, item)
    const index = PRODUCTION_WORKFLOW_STAGES.indexOf(value)
    if (index < 0 || index >= PRODUCTION_WORKFLOW_STAGES.length - 1) return value
    return PRODUCTION_WORKFLOW_STAGES[index + 1]
  }

  function isUntouchedDailyTopic(item) {
    if (String(item?.type || '').trim() !== '日常') return false
    const content = String(item?.content || '').replace(/\s+/g, '').trim()
    return !content || content === '选题待定' || content === '待定'
  }

  function syncStatusFromWorkflowStage(item) {
    if (!item) return item
    if (item.workflow_stage === '已发布') {
      item.status = 'done'
    } else if (item.workflow_stage === '延期') {
      item.status = 'delayed'
    } else if (item.status === 'done') {
      item.status = 'pending'
    }
    if (item.status !== 'done' && item.status !== 'delayed') {
      item.status = getAutoStatus(item)
    }
    return item
  }

  function legacyWorkflowStageIndex(stage) {
    const value = normalizeWorkflowStage(stage)
    const index = WORKFLOW_STAGES.indexOf(value)
    return index === -1 ? 0 : index
  }

  function rebuildItemsByPerson(items) {
    Object.keys(itemsByPerson).forEach(person => { itemsByPerson[person] = [] })
    const normalized = (items || [])
      .map(item => normalizeScheduleItem(item))
      .filter(item => !item.schedule_hidden)
    normalized.sort(compareTaskOrder)
    allItems.value = normalized
    normalized.forEach(item => {
      const participants = Array.isArray(item.participants) && item.participants.length
        ? item.participants
        : normalizeParticipants('', item.person, item.workflow_stage)
      item.participants = participants
      item.participants_json = participantsToJson(participants)
      item.person = participants[0]?.person || item.person || ''
      participants.forEach(participant => {
        ensurePersonBucket(participant.person)
        itemsByPerson[participant.person].push(buildTaskView(item, participant.person, participant))
      })
    })
    Object.keys(itemsByPerson).forEach(person => {
      itemsByPerson[person].sort(compareTaskOrder)
    })
  }

  function currentTasks() {
    return allItems.value
      .filter(item => item.person !== '__deleted__')
      .filter(item => !item.schedule_hidden)
      .map(item => ({
        ...item,
        participants: normalizeParticipants(item.participants_json || item.participants || '', item.person, item.workflow_stage),
        participants_json: participantsToJson(normalizeParticipants(item.participants_json || item.participants || '', item.person, item.workflow_stage)),
        activity_log: normalizeActivityLog(item.activity_json || item.activity_log || []),
        activity_json: activityLogToJson(item.activity_json || item.activity_log || [])
      }))
  }

  function persistSchedule(refreshAfterSave = false) {
    const localSnapshot = currentTasks()
    scheduleSaving = true
    return saveSchedule(localSnapshot, MEMBERS, { revision: scheduleRevision.value })
      .then(result => {
        const nextRevision = Number(result?.revision || 0)
        scheduleRevision.value = nextRevision
        markLocalScheduleChanged()
        return result
      })
      .catch(err => {
        if (err?.data?.code === 'schedule_conflict') {
          const nextRevision = Number(err.data.revision || 0)
          scheduleRevision.value = nextRevision
          try {
            localStorage.setItem('usagi_schedule_unsaved_backup', JSON.stringify({
              at: Date.now(),
              revision: nextRevision,
              tasks: localSnapshot
            }))
          } catch (backupErr) {}
          showToast('排期已被其他人更新，本地修改已保留，先同步后再保存', 'info')
          return null
        }
        showToast('排期保存失败: ' + err.message, 'error')
      })
      .finally(() => {
        scheduleSaving = false
      })
  }

  function updateSortOrderAround(moving, targetTask = null, afterTarget = false) {
    const ordered = allItems.value
      .filter(item => item.id !== moving.id)
      .sort(compareTaskOrder)
    if (!ordered.length || !targetTask) {
      moving.sort_order = ordered.length ? Number(ordered[ordered.length - 1].sort_order || 0) + 10 : 10
      return
    }
    const targetIndex = ordered.findIndex(item => item.id === targetTask.id)
    if (targetIndex === -1) {
      moving.sort_order = Number(ordered[ordered.length - 1].sort_order || 0) + 10
      return
    }
    const left = afterTarget ? ordered[targetIndex] : ordered[targetIndex - 1]
    const right = afterTarget ? ordered[targetIndex + 1] : ordered[targetIndex]
    const leftOrder = left ? Number(left.sort_order || 0) : null
    const rightOrder = right ? Number(right.sort_order || 0) : null
    if (leftOrder != null && rightOrder != null && leftOrder !== rightOrder) {
      moving.sort_order = (leftOrder + rightOrder) / 2
      return
    }
    if (leftOrder != null) {
      moving.sort_order = leftOrder + 10
      return
    }
    if (rightOrder != null) {
      moving.sort_order = rightOrder - 10
      return
    }
    moving.sort_order = 10
  }

  function renumberSortOrders() {
    const ordered = [...allItems.value].sort(compareTaskOrder)
    ordered.forEach((item, index) => {
      item.sort_order = (index + 1) * 10
    })
  }

  function promoteParticipant(task, person) {
    const participants = normalizeParticipants(task.participants_json || task.participants || '', task.person, task.workflow_stage)
    const index = participants.findIndex(row => row.person === person)
    if (index === 0) return participants
    if (index > 0) {
      const [row] = participants.splice(index, 1)
      participants.unshift(row)
      return participants
    }
    participants.unshift({
      person,
      roles: normalizeParticipantRoles([], task.workflow_stage)
    })
    return participants
  }

  function reassignParticipant(task, fromPerson, toPerson) {
    const participants = normalizeParticipants(task.participants_json || task.participants || '', task.person, task.workflow_stage)
    const fromIndex = participants.findIndex(row => row.person === fromPerson)
    const toIndex = participants.findIndex(row => row.person === toPerson)

    if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
      participants.splice(fromIndex, 1)
      const existing = participants.find(row => row.person === toPerson)
      if (existing && task.person === fromPerson) {
        const idx = participants.findIndex(row => row.person === toPerson)
        const [row] = participants.splice(idx, 1)
        participants.unshift(row)
      }
      return participants
    }

    if (fromIndex >= 0) {
      participants[fromIndex] = { ...participants[fromIndex], person: toPerson }
    } else {
      participants.unshift({
        person: toPerson,
        roles: normalizeParticipantRoles([], task.workflow_stage)
      })
    }

    const deduped = []
    participants.forEach(row => {
      if (!row.person || deduped.some(item => item.person === row.person)) return
      deduped.push(row)
    })
    if (task.person === fromPerson || !deduped.some(row => row.person === task.person)) {
      const primaryIndex = deduped.findIndex(row => row.person === toPerson)
      if (primaryIndex > 0) {
        const [primary] = deduped.splice(primaryIndex, 1)
        deduped.unshift(primary)
      }
    }
    return deduped
  }

  function transferTaskToPerson(source, toPerson) {
    const master = source?.task || allItems.value.find(item => item.id === source?.id)
    const targetPerson = String(toPerson || '').trim()
    if (!master || !targetPerson) return
    const fromPerson = source?.view_person || master.person
    if (fromPerson === targetPerson) return
    pushHistory()
    const nextParticipants = reassignParticipant(master, fromPerson, targetPerson)
    master.participants = nextParticipants
    master.participants_json = participantsToJson(nextParticipants)
    master.person = master.person === fromPerson || !nextParticipants.some(row => row.person === master.person)
      ? (nextParticipants[0]?.person || targetPerson)
      : master.person
    master.group_name = inferItemGroupName(master)
    rebuildItemsByPerson(allItems.value)
    sendHandoffNotification(fromPerson, targetPerson, master)
    persistSchedule(true)
    showToast(`已转交给 ${targetPerson}`, 'success')
  }

  function moveDraggedTaskToPerson(person, targetTask = null, afterTarget = false) {
    const dragPayload = dragItem.value
    const moving = dragPayload?.task || dragPayload
    if (!moving) return false
    const targetMaster = targetTask?.task || targetTask || null
    if (targetMaster && targetMaster.id === moving.id && person === moving.person) return false

    const fromPerson = dragPayload?.view_person || moving.person
    const nextParticipants = fromPerson === person
      ? normalizeParticipants(moving.participants_json || moving.participants || '', moving.person, moving.workflow_stage)
      : reassignParticipant(moving, fromPerson, person)
    moving.participants = nextParticipants
    moving.participants_json = participantsToJson(nextParticipants)
    moving.person = moving.person === fromPerson || !nextParticipants.some(row => row.person === moving.person)
      ? (nextParticipants[0]?.person || person)
      : moving.person
    moving.group_name = inferItemGroupName(moving)

    if (targetMaster) {
      updateSortOrderAround(moving, targetMaster, afterTarget)
    } else {
      updateSortOrderAround(moving, null, false)
    }

    renumberSortOrders()
    rebuildItemsByPerson(allItems.value)
    if (fromPerson !== person) {
      sendHandoffNotification(fromPerson, person, moving)
    }
    showToast(fromPerson === person ? '已调整顺序' : `已转给 ${person}`, 'success')
    return true
  }

  function normalizeWeekMergeValue(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function getWeekMergeKey(item) {
    const explicit = String(item?.parallel_key || '').trim()
    if (explicit) return `parallel:${explicit}`
    return [
      'sig',
      normalizeWeekMergeValue(item?.account),
      normalizeWeekMergeValue(item?.date),
      normalizeWeekMergeValue(item?.type),
      normalizeWeekMergeValue(item?.content)
    ].join('|')
  }

  function handleDragStart(event, item) {
    const master = item?.task || item
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(master.id))
    dragItem.value = {
      task: master,
      view_person: item?.view_person || master.person,
      parallelItems: item?._parallel_items || null
    }
  }

  function handleDragEnd() {
    window.setTimeout(() => {
      dragItem.value = null
    }, 0)
  }

  function handleDrop(event, person) {
    event.preventDefault()
    if (!dragItem.value) return
    pushHistory()
    if (moveDraggedTaskToPerson(person)) {
      persistSchedule()
    } else {
      history.value.pop()
    }
    dragItem.value = null
  }

  function handleTaskDrop(event, person, targetItem) {
    event.preventDefault()
    if (!dragItem.value) return
    const rect = event.currentTarget?.getBoundingClientRect?.()
    const afterTarget = Boolean(rect && event.clientY > rect.top + rect.height / 2)
    pushHistory()
    if (moveDraggedTaskToPerson(person, targetItem, afterTarget)) {
      persistSchedule()
    } else {
      history.value.pop()
    }
    dragItem.value = null
  }

  function mergeParallelWeekItems(items) {
    const merged = []
    const groups = new Map()
    items.forEach(item => {
      const key = getWeekMergeKey(item)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    })
    groups.forEach((groupItems, groupKey) => {
      if (groupItems.length < 2) {
        merged.push(groupItems[0])
        return
      }
      const first = groupItems[0]
      const people = Array.from(new Set(groupItems.map(item => item.person).filter(Boolean)))
      const statuses = groupItems.map(item => getAutoStatus(item))
      const status = statuses.includes('delayed')
        ? 'delayed'
        : (statuses.every(value => value === 'done') ? 'done' : 'pending')
      merged.push({
        ...first,
        person: people.join(' / '),
        status,
        _parallel_items: groupItems,
        _week_key: groupKey
      })
    })
    return merged.sort(compareTaskOrder)
  }

  function normalizedMergeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function mergeNeedsUserConfirm(items) {
    const list = (items || []).filter(Boolean)
    const contents = new Set(list.map(item => normalizedMergeText(item.content)).filter(Boolean))
    return contents.size > 1
  }

  function mergedRemarkForItems(primary, items) {
    const existing = String(primary?.remark || '').trim()
    const lines = (items || [])
      .filter(item => item && item.id !== primary.id)
      .map(item => {
        const person = normalizedMergeText(item.person)
        const content = normalizedMergeText(item.content)
        if (!content || content === normalizedMergeText(primary.content)) return ''
        return `${person || '合作人'}：${content}`
      })
      .filter(Boolean)
    if (!lines.length) return existing
    const sourceText = ['合并来源：', ...lines.map(line => `- ${line}`)].join('\n')
    return existing ? `${existing}\n${sourceText}` : sourceText
  }

  function uniqueParticipantsForItems(items, fallbackStage = '文案') {
    const rows = []
    ;(items || []).forEach(item => {
      normalizeParticipants(item.participants_json || item.participants || '', item.person, item.workflow_stage || fallbackStage)
        .forEach(row => {
          if (!row.person || rows.some(existing => existing.person === row.person)) return
          rows.push(createParticipant(row.person, row.roles || item.workflow_stage || fallbackStage))
        })
    })
    return rows
  }

  function materializeMergedItems(items, options = {}) {
    const list = Array.from(new Map((items || []).filter(Boolean).map(item => [item.id, item])).values())
    if (list.length < 2) return list[0] || null
    const primary = options.primary || list[0]
    if (!primary) return null
    if (!options.skipConfirm && mergeNeedsUserConfirm(list)) {
      const ok = window.confirm('这些任务内容不完全一致，仍然合并为同一个合作任务吗？\n\n合并后会以当前卡片内容为主，其他内容会写入备注。')
      if (!ok) return null
    }
    const participants = uniqueParticipantsForItems(list, primary.workflow_stage)
    primary.participants = participants.length ? participants : normalizeParticipants(primary.participants_json || primary.participants || '', primary.person, primary.workflow_stage)
    primary.participants_json = participantsToJson(primary.participants)
    primary.person = primary.participants[0]?.person || primary.person
    primary.parallel_key = primary.parallel_key || `collab-${Date.now()}-${primary.id}`
    primary.remark = mergedRemarkForItems(primary, list)
    const statuses = list.map(item => getAutoStatus(item))
    primary.status = statuses.includes('delayed')
      ? 'delayed'
      : (statuses.every(value => value === 'done') ? 'done' : 'pending')
    allItems.value = allItems.value.filter(item => item.id === primary.id || !list.some(source => source.id === item.id))
    return primary
  }

  function isSameDay(dateStr, day) {
    if (!dateStr) return false
    const d = parseLocalDate(dateStr)
    if (!d) return false
    return d.toDateString() === day.toDateString()
  }

  function getItemsForCell(acc, day) {
    if (acc === DEPARTMENT_TODO_ACCOUNT) {
      return currentGroupTodoScheduleItems().filter(item => isSameDay(item.date, day))
    }
    const groupName = currentGroup.value?.label || ''
    const items = allItems.value.filter(item =>
      item.account === acc
      && item.group_name === groupName
      && isSameDay(item.date, day)
    )
    return mergeParallelWeekItems(items)
  }

  function weekCardTitle(item) {
    const people = item?._parallel_items?.map(task => task.person).filter(Boolean) || [item?.person].filter(Boolean)
    return [people.join(' / '), item?.account, item?.content].filter(Boolean).join(' | ')
  }

  function editWeekItem(item) {
    if (item?._parallel_items?.length > 1) {
      pushHistory()
      const merged = materializeMergedItems(item._parallel_items, { primary: item._parallel_items[0], skipConfirm: true })
      if (!merged) {
        history.value.pop()
        return
      }
      renumberSortOrders()
      rebuildItemsByPerson(allItems.value)
      persistSchedule(true)
      editItem(merged)
      showToast('已合并为合作任务，可在弹窗里调整合作人', 'success')
      return
    }
    editItem(item)
  }

  function handleWeekCardDrop(event, targetItem) {
    event.preventDefault()
    event.stopPropagation()
    if (!dragItem.value) return
    const movingSource = dragItem.value.task || dragItem.value
    const movingItems = dragItem.value.parallelItems?.length
      ? dragItem.value.parallelItems
      : [allItems.value.find(item => item.id === movingSource?.id) || movingSource]
    const targetItems = targetItem?._parallel_items?.length
      ? targetItem._parallel_items
      : [allItems.value.find(item => item.id === (targetItem?.task || targetItem)?.id) || targetItem?.task || targetItem]
    const target = targetItems[0]
    const mergeItems = Array.from(new Map([...targetItems, ...movingItems].filter(Boolean).map(item => [item.id, item])).values())
    if (!target || mergeItems.length < 2 || mergeItems.every(item => item.id === target.id)) {
      dragItem.value = null
      return
    }
    pushHistory()
    movingItems.forEach(item => {
      item.account = target.account
      item.group_name = target.group_name || currentGroup.value?.label || inferItemGroupName(target)
      item.date = target.date
      if (item.status !== 'done') item.status = getAutoStatus(item)
    })
    const merged = materializeMergedItems(mergeItems, { primary: target })
    if (!merged) {
      history.value.pop()
      dragItem.value = null
      return
    }
    renumberSortOrders()
    rebuildItemsByPerson(allItems.value)
    persistSchedule(true)
    showToast('已合并为合作任务', 'success')
    dragItem.value = null
  }

  function statusLabel(item) {
    return STATUS_MAP[getAutoStatus(item)] || STATUS_MAP.pending
  }

  function getAutoStatus(item) {
    if (normalizeWorkflowStage(item?.workflow_stage, item) === '已发布') return 'done'
    if (item?.status === 'done') return 'done'
    const taskDate = parseLocalDate(item?.date)
    if (!taskDate) return 'pending'
    return taskDate < today ? 'delayed' : 'pending'
  }

  function parseLocalDate(dateStr) {
    if (!dateStr) return null
    const parts = String(dateStr).slice(0, 10).split('-').map(Number)
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null
    const d = new Date(parts[0], parts[1] - 1, parts[2])
    d.setHours(0, 0, 0, 0)
    return d
  }

  function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function formatPersonTaskDate(dateStr) {
    const d = parseLocalDate(dateStr)
    if (!d) return dateStr || ''
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  function fmtMd(d) {
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  function isToday(d) {
    return d.toDateString() === today.toDateString()
  }

  function getWeekDays(offset) {
    const d = new Date(today)
    const dayOfWeek = d.getDay() || 7
    d.setDate(d.getDate() - (dayOfWeek - 1) + offset * 7)
    return Array.from({ length: 7 }, (_, index) => {
      const dd = new Date(d)
      dd.setDate(d.getDate() + index)
      return dd
    })
  }

  function startOfWeek(d) {
    const start = new Date(d)
    const dayOfWeek = start.getDay() || 7
    start.setDate(start.getDate() - (dayOfWeek - 1))
    start.setHours(0, 0, 0, 0)
    return start
  }

  function carryUnfinishedTasksToCurrentWeek(tasks) {
    const thisMonday = startOfWeek(today)
    let carriedCount = 0
    const carried = tasks.map(item => {
      const taskDate = parseLocalDate(item.date)
      if (!taskDate || taskDate >= thisMonday || item.status === 'done') return { ...item }
      carriedCount += 1
      return {
        ...item,
        date: formatDate(new Date(thisMonday)),
        status: item.status === 'pending' ? 'delayed' : item.status
      }
    })
    return { tasks: carried, carriedCount }
  }

  function buildCelebrationCopy(item) {
    const content = String(item?.content || '').replace(/\s+/g, ' ').trim()
    return {
      toast: content ? `已完成：${content.slice(0, 18)}` : '任务已完成',
      detail: [item?.person, item?.account, item?.type].filter(Boolean).join(' / ')
    }
  }

  function toggleDone(item, event) {
    const master = item?.task || allItems.value.find(x => x.id === item.id)
    if (!master) return
    const currentStage = normalizeProductionWorkflowStage(master.workflow_stage, master)
    const nextStage = nextWorkflowStage(currentStage, master)
    if (nextStage === currentStage) return
    if (currentStage === '文案' && nextStage === '后期' && isUntouchedDailyTopic(master)) {
      showToast('我嘞个豆！你选题都没填，怎么推进后期勒！', 'error', { big: true })
      return
    }
    pushHistory()
    master.workflow_stage = nextStage
    appendStageActivity(master, currentStage, nextStage)
    if (nextStage === '已发布') {
      master.status = 'done'
      const copy = buildCelebrationCopy(master)
      showToast(copy.toast, 'success', { big: true, detail: copy.detail })
    } else {
      master.status = 'pending'
      syncStatusFromWorkflowStage(master)
      showToast(`已推进到${workflowStageToastLabel(currentStage, master)}`, 'success')
    }
    master.participants_json = participantsToJson(master.participants || [])
    master.activity_json = activityLogToJson(master.activity_log || [])
    rebuildItemsByPerson(allItems.value)
    persistSchedule(true)
  }

  function setActiveTask(item) {
    const source = item?.task || item
    if (!source) return
    activeTask.value = source
    if (item?.view_person || source.person) {
      setPasteTarget({ person: item?.view_person || source.person })
    }
  }

  function setPasteTarget(target) {
    if (!target) return
    if (typeof target === 'string') {
      activePasteTarget.value = { person: target }
      return
    }
    activePasteTarget.value = {
      person: String(target.person || '').trim(),
      account: String(target.account || '').trim(),
      date: target.date instanceof Date ? formatDate(target.date) : String(target.date || '').slice(0, 10)
    }
  }

  function setWeekPasteTarget(account, day) {
    activePasteTarget.value = {
      account: String(account || '').trim(),
      date: formatDate(day)
    }
  }

  function normalizePasteTarget(assign) {
    if (typeof assign === 'string') return { person: assign }
    const source = assign || activePasteTarget.value || {}
    return {
      person: String(source.person || '').trim(),
      account: String(source.account || '').trim(),
      date: source.date instanceof Date ? formatDate(source.date) : String(source.date || '').slice(0, 10)
    }
  }

  function mapParticipantsToTarget(template, targetPerson, stage) {
    const sourceParticipants = normalizeParticipants(template.participants_json || template.participants || '', template.person, stage)
    const person = String(targetPerson || '').trim()
    if (!person) return sourceParticipants

    if (sourceParticipants.length <= 1) {
      return [createParticipant(person, sourceParticipants[0]?.roles || stage)]
    }

    const rows = sourceParticipants.map(row => createParticipant(row.person, row.roles || stage))
    const existingIndex = rows.findIndex(row => row.person === person)
    if (existingIndex === 0) return rows
    if (existingIndex > 0) {
      const [row] = rows.splice(existingIndex, 1)
      rows.unshift(row)
      return rows
    }

    rows[0] = createParticipant(person, rows[0]?.roles || stage)
    return rows.filter((row, index, list) => row.person && list.findIndex(item => item.person === row.person) === index)
  }

  function taskTemplateFrom(source) {
    const task = source?.task || source
    const stage = normalizeWorkflowStage(task.workflow_stage, task)
    const template = {
      account: task.account || '',
      person: task.person || '',
      group_name: inferItemGroupName(task),
      content: task.content || '',
      remark: task.remark || '',
      date: task.date || formatToday(),
      type: task.type || '日常',
      stack_count: normalizeStackCount(task),
      status: task.status === 'done' ? 'pending' : (task.status || 'pending'),
      workflow_stage: stage,
      participants: normalizeParticipants(task.participants_json || task.participants || '', task.person, stage),
      doc_title: task.doc_title || '',
      doc_url: task.doc_url || '',
      doc_kind: task.doc_kind || '',
      activity_log: normalizeActivityLog(task.activity_json || task.activity_log || []),
      activity_json: activityLogToJson(task.activity_json || task.activity_log || [])
    }
    const collab = applyScheduleCollaborativePreset(template, GROUPS)
    if (!collab) return template
    const participants = collab.participants || template.participants
    return {
      ...template,
      workflow_stage: collab.workflow_stage || template.workflow_stage,
      participants,
      participants_json: participantsToJson(participants),
      person: participants[0]?.person || template.person
    }
  }

  function writeTaskClipboard(template) {
    const text = [template.date, template.account, TYPE_TAG[template.type] || template.type, template.content]
      .filter(Boolean)
      .join(' | ')
    window.navigator?.clipboard?.writeText?.(text).catch(() => {})
  }

  function editItem(item) {
    const source = item?.task || item
    setActiveTask(item)
    editing.value = true
    form.id = source.id
    form.account = source.account || ''
    form.person = source.person || ''
    form.group_name = inferItemGroupName(source)
    form.content = source.content || ''
    form.remark = source.remark || ''
    form.date = source.date || ''
    form.type = source.type || '日常'
    form.stack_count = normalizeStackCount(source)
    form.status = source.status || 'pending'
    form.workflow_stage = normalizeWorkflowStage(source.workflow_stage, source)
    form.participants = normalizeParticipants(source.participants_json || source.participants || '', source.person, form.workflow_stage)
    form.cooperation = form.participants.length > 1
    form.parallel_person = ''
    form.activity_log = normalizeActivityLog(source.activity_json || source.activity_log || [])
    form.doc_title = source.doc_title || ''
    form.doc_url = source.doc_url || ''
    form.doc_kind = source.doc_kind || ''
    form.doc_dragging = false
    formShow.value = true
  }

  function copyItem(item) {
    const source = item?.task || item
    if (!source) return
    activeTask.value = source
    copiedTask.value = taskTemplateFrom(source)
    writeTaskClipboard(copiedTask.value)
    showToast('已复制任务', 'success')
  }

  function pasteCopiedTask(assign) {
    if (!copiedTask.value) {
      showToast('先复制一个任务', 'error')
      return
    }
    const target = normalizePasteTarget(assign)
    const task = buildTaskFromTemplate(copiedTask.value, target)
    pushHistory()
    task.id = Math.max(0, ...allItems.value.map(item => Number(item.id) || 0)) + 1
    task.sort_order = Math.max(0, ...allItems.value.map(item => Number(item.sort_order) || 0)) + 10
    allItems.value.push(task)
    renumberSortOrders()
    rebuildItemsByPerson(allItems.value)
    persistSchedule(true)
    const targetLabel = [target.person, target.account, target.date].filter(Boolean).join(' / ')
    showToast(targetLabel ? `已粘贴到 ${targetLabel}` : '已粘贴任务', 'success')
  }

  function buildTaskFromTemplate(template, target = {}) {
    const stage = normalizeWorkflowStage(template.workflow_stage, template)
    const targetPerson = target.person || template.person || currentGroupMembers.value[0] || MEMBERS[0]
    const targetAccount = target.account || template.account || currentGroupAccounts.value[0] || ALL_ACCOUNTS[0]
    const participants = mapParticipantsToTarget(template, target.person, stage)
    const primaryPerson = participants[0]?.person || targetPerson
    const task = {
      account: targetAccount,
      person: primaryPerson,
      group_name: inferItemGroupName({ ...template, account: targetAccount, person: primaryPerson }, currentGroup.value),
      content: template.content || '',
      remark: template.remark || '',
      date: target.date || template.date || formatToday(),
      type: template.type || '日常',
      stack_count: normalizeStackCount(template),
      status: template.status === 'done' ? 'pending' : (template.status || 'pending'),
      workflow_stage: stage,
      participants,
      participants_json: participantsToJson(participants),
      sort_order: 0,
      parallel_key: '',
      doc_title: template.doc_title || '',
      doc_url: template.doc_url || '',
      doc_kind: template.doc_kind || '',
      activity_log: normalizeActivityLog(template.activity_json || template.activity_log || []),
      activity_json: activityLogToJson(template.activity_json || template.activity_log || [])
    }
    syncStatusFromWorkflowStage(task)
    const collab = applyScheduleCollaborativePreset(task, GROUPS)
    if (!collab) return task
    const nextParticipants = collab.participants || participants
    return {
      ...task,
      workflow_stage: collab.workflow_stage || task.workflow_stage,
      participants: nextParticipants,
      participants_json: participantsToJson(nextParticipants),
      person: nextParticipants[0]?.person || task.person
    }
  }

  function createParticipant(person, roles) {
    return {
      person,
      roles: normalizeParticipantRoles(roles, '文案')
    }
  }

  function normalizeFormParticipants(sourceParticipants, fallbackPerson, fallbackStage) {
    const participants = normalizeParticipants(sourceParticipants, fallbackPerson, fallbackStage)
    const extraPerson = String(form.parallel_person || '').trim()
    if (extraPerson && !participants.some(row => row.person === extraPerson)) {
      participants.push(createParticipant(extraPerson, fallbackStage))
    }
    if (!participants.length && fallbackPerson) {
      participants.push(createParticipant(fallbackPerson, fallbackStage))
    }
    return participants
  }

  function openAdd(assign, template = null) {
    editing.value = false
    form.id = null
    const source = template || {}
    const targetPerson = typeof assign === 'string'
      ? assign
      : (source.person || currentGroupMembers.value[0] || MEMBERS[0])
    const targetAccount = source.account || currentGroupAccounts.value[0] || ALL_ACCOUNTS[0]
    const stage = normalizeWorkflowStage(source.workflow_stage, source)
    const participants = mapParticipantsToTarget({ ...source, person: source.person || targetPerson }, targetPerson, stage)
    form.account = targetAccount
    form.person = targetPerson
    form.group_name = inferItemGroupName({ ...source, account: targetAccount, person: targetPerson }, currentGroup.value) || currentGroup.value?.label || ''
    form.content = source.content || ''
    form.remark = source.remark || ''
    form.date = source.date || formatToday()
    form.type = source.type || '日常'
    form.stack_count = normalizeStackCount(source)
    form.status = source.status === 'done' ? 'pending' : (source.status || 'pending')
    form.workflow_stage = stage
    form.participants = participants
    form.cooperation = participants.length > 1
    form.parallel_person = ''
    form.activity_log = normalizeActivityLog(source.activity_json || source.activity_log || [])
    form.doc_title = source.doc_title || ''
    form.doc_url = source.doc_url || ''
    form.doc_kind = source.doc_kind || ''
    form.doc_dragging = false
    formShow.value = true
  }

  function formatToday() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function buildTaskFromForm(personOverride) {
    const participantRows = form.cooperation
      ? normalizeFormParticipants(form.participants, personOverride || form.person, form.workflow_stage)
      : [createParticipant(personOverride || form.person, form.workflow_stage)]
    const participants = participantRows.length
      ? participantRows
      : [createParticipant(personOverride || form.person, form.workflow_stage)]
    const primaryPerson = participants[0]?.person || personOverride || form.person
    const task = {
      account: form.account,
      person: primaryPerson,
      group_name: inferItemGroupName({ account: form.account, person: primaryPerson, group_name: form.group_name }, currentGroup.value),
      content: form.content,
      remark: form.remark,
      date: form.date,
      type: form.type,
      stack_count: normalizeStackCount(form),
      status: form.status,
      workflow_stage: form.workflow_stage || '文案',
      participants,
      participants_json: participantsToJson(participants),
      sort_order: Number.isFinite(Number(form.sort_order)) ? Number(form.sort_order) : 0,
      parallel_key: '',
      doc_title: form.doc_title,
      doc_url: form.doc_url,
      doc_kind: form.doc_kind,
      activity_log: normalizeActivityLog(form.activity_log || []),
      activity_json: activityLogToJson(form.activity_log || [])
    }
    syncStatusFromWorkflowStage(task)
    const collab = applyScheduleCollaborativePreset(task, GROUPS)
    if (!collab) return task
    const nextParticipants = collab.participants || participants
    return {
      ...task,
      workflow_stage: collab.workflow_stage || task.workflow_stage,
      participants: nextParticipants,
      participants_json: participantsToJson(nextParticipants),
      person: nextParticipants[0]?.person || task.person
    }
  }

  function saveItem() {
    if (!form.content.trim()) {
      showToast('内容不能为空', 'error')
      return
    }
    if (!form.date) {
      showToast('请选择日期', 'error')
      return
    }
    const participants = form.cooperation
      ? normalizeFormParticipants(form.participants, form.person, form.workflow_stage)
      : (form.person ? [createParticipant(form.person, form.workflow_stage)] : [])
    if (!participants.length) {
      showToast('至少选择一个参与人', 'error')
      return
    }

    pushHistory()
    const nextPrimary = participants[0]?.person || form.person

    if (editing.value) {
      const item = allItems.value.find(x => x.id === form.id)
      if (!item) {
        history.value.pop()
        showToast('未找到要编辑的任务', 'error')
        return
      }
      const fromPerson = item.person
      const next = buildTaskFromForm(nextPrimary)
      Object.assign(item, next, { id: item.id })
      if (fromPerson !== item.person) {
        sendHandoffNotification(fromPerson, item.person, item)
      }
      showToast('已更新', 'success')
    } else {
      const nextId = Math.max(0, ...allItems.value.map(item => Number(item.id) || 0)) + 1
      const task = Object.assign({ id: nextId }, buildTaskFromForm(nextPrimary))
      task.sort_order = Math.max(0, ...allItems.value.map(item => Number(item.sort_order) || 0)) + 10
      allItems.value.push(task)
      showToast(task.participants.length > 1 ? '已新增联动任务' : '已新增任务', 'success')
    }

    renumberSortOrders()
    rebuildItemsByPerson(allItems.value)
    formShow.value = false
    persistSchedule(true)
  }

  function delItem(id) {
    if (!canDeleteTasks.value) {
      showToast('组员不能删除任务', 'error')
      return
    }
    pushHistory()
    allItems.value = allItems.value.filter(item => item.id !== id)
    rebuildItemsByPerson(allItems.value)
    persistSchedule()
    showToast('已删除', 'error')
  }

  function deleteEditingItem() {
    if (!editing.value || !form.id) return
    if (!canDeleteTasks.value) {
      delItem(form.id)
      return
    }
    delItem(form.id)
    formShow.value = false
    editing.value = false
    activeTask.value = null
  }

  function hasScheduleDoc(item) {
    return Boolean(String(item?.doc_url || '').trim())
  }

  function openScheduleDoc(item, event) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const source = item?.task || item
    const url = String(source?.doc_url || '').trim()
    if (!url) return
    if ((source?.doc_kind || '') === 'file' || url.startsWith('/uploads/')) {
      const link = document.createElement('a')
      link.href = url
      link.download = source?.doc_title || ''
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  function clearScheduleDoc() {
    form.doc_title = ''
    form.doc_url = ''
    form.doc_kind = ''
    form.doc_dragging = false
  }

  function setScheduleDocLink(value) {
    const url = String(value || form.doc_url || '').trim()
    if (!url) {
      form.doc_title = ''
      form.doc_kind = ''
      return
    }
    form.doc_url = url
    form.doc_kind = /feishu\.cn/i.test(url) ? 'feishu' : 'link'
    if (!form.doc_title) form.doc_title = form.doc_kind === 'feishu' ? '飞书文档' : '文档链接'
  }

  async function uploadScheduleDocFile(file) {
    if (!file) return
    try {
      const data = await uploadScheduleDoc(file)
      form.doc_title = data.title || file.name
      form.doc_url = data.url || ''
      form.doc_kind = data.kind || 'file'
      showToast('文档附件已上传', 'success')
    } catch (err) {
      showToast('文档附件上传失败: ' + err.message, 'error')
    }
  }

  async function handleScheduleDocFile(event) {
    await uploadScheduleDocFile(event?.target?.files?.[0])
    if (event?.target) event.target.value = ''
  }

  async function handleScheduleDocDrop(event) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    form.doc_dragging = false
    const file = event?.dataTransfer?.files?.[0]
    if (file) {
      await uploadScheduleDocFile(file)
      return
    }
    const text = event?.dataTransfer?.getData?.('text/uri-list') || event?.dataTransfer?.getData?.('text/plain') || ''
    if (text.trim()) {
      setScheduleDocLink(text.trim())
      showToast('文档链接已保存', 'success')
    }
  }

  function handleScheduleDocPaste(event) {
    const text = event?.clipboardData?.getData?.('text') || ''
    if (!/^https?:\/\//i.test(text.trim())) return
    setScheduleDocLink(text.trim())
  }

  function startPan(e) {
    if (e.target.closest('.task-card') || e.target.closest('.add-btn') || e.target.closest('button')) return
    isPanning.value = true
    panStart.value = { x: e.clientX, scrollLeft: boardRef.value?.scrollLeft || 0 }
  }

  function doPan(e) {
    if (!isPanning.value) return
    const board = boardRef.value
    if (!board) return
    const dx = e.clientX - panStart.value.x
    board.scrollLeft = panStart.value.scrollLeft - dx
  }

  function endPan() {
    isPanning.value = false
  }

  function handleWeekDrop(event, acc, day) {
    event.preventDefault()
    if (!dragItem.value) return
    pushHistory()
    const moving = dragItem.value.task || dragItem.value
    const targets = dragItem.value.parallelItems?.length ? dragItem.value.parallelItems : [moving]
    const nextDate = formatDate(day)
    targets.forEach(item => {
      item.account = acc
      item.group_name = currentGroup.value?.label || inferItemGroupName(item)
      item.date = nextDate
      if (item.status !== 'done') item.status = getAutoStatus(item)
    })
    renumberSortOrders()
    rebuildItemsByPerson(allItems.value)
    persistSchedule()
    showToast(`已移至 ${acc} ${fmtMd(day)}`, 'success')
    dragItem.value = null
  }

  function splitEditingItem() {
    if (!editing.value || !form.id) return
    const item = allItems.value.find(x => x.id === form.id)
    if (!item) {
      showToast('未找到要分离的任务', 'error')
      return
    }
    const participants = normalizeParticipants(form.participants, form.person, form.workflow_stage)
    if (participants.length < 2) {
      showToast('只有一个合作人，不需要分离', 'info')
      return
    }
    const ok = window.confirm(`确定把这个合作任务分离成 ${participants.length} 条单人任务吗？`)
    if (!ok) return
    pushHistory()
    const base = buildTaskFromForm(participants[0]?.person || form.person)
    const maxId = Math.max(0, ...allItems.value.map(row => Number(row.id) || 0))
    Object.assign(item, base, {
      id: item.id,
      person: participants[0].person,
      participants: [participants[0]],
      participants_json: participantsToJson([participants[0]]),
      parallel_key: ''
    })
    participants.slice(1).forEach((participant, index) => {
      const clone = {
        ...base,
        id: maxId + index + 1,
        person: participant.person,
        participants: [participant],
        participants_json: participantsToJson([participant]),
        sort_order: Number(item.sort_order || 0) + index + 1,
        parallel_key: ''
      }
      allItems.value.push(clone)
    })
    renumberSortOrders()
    rebuildItemsByPerson(allItems.value)
    formShow.value = false
    editing.value = false
    activeTask.value = null
    persistSchedule(true)
    showToast('已分离为单人任务', 'success')
  }

  function moveDraggedItemToAdjacentWeek(direction, event) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    if (!dragItem.value) return
    const moving = dragItem.value.task || dragItem.value
    const targets = dragItem.value.parallelItems?.length ? dragItem.value.parallelItems : [moving]
    const days = weekDays.value
    const nextDate = new Date(direction < 0 ? days[0] : days[6])
    nextDate.setDate(nextDate.getDate() + (direction < 0 ? -1 : 1))
    pushHistory()
    const dateText = formatDate(nextDate)
    targets.forEach(item => {
      item.date = dateText
      if (item.status !== 'done') item.status = getAutoStatus(item)
    })
    renumberSortOrders()
    rebuildItemsByPerson(allItems.value)
    weekOffset.value += direction < 0 ? -1 : 1
    persistSchedule()
    showToast(direction > 0 ? '已移至下一周' : '已移至上一周', 'success')
    dragItem.value = null
  }

  function moveItemByWeeks(item, weeks, event) {
    event?.stopPropagation?.()
    const master = item?.task || allItems.value.find(x => x.id === item.id)
    if (!master) return
    const current = parseLocalDate(master.date) || today
    current.setDate(current.getDate() + weeks * 7)
    pushHistory()
    master.date = formatDate(current)
    if (master.status !== 'done') master.status = getAutoStatus(master)
    renumberSortOrders()
    rebuildItemsByPerson(allItems.value)
    persistSchedule()
    showToast(weeks > 0 ? '已移到下一周' : '已移到上一周', 'success')
  }

  function emitAgentResult(id, message) {
    if (!id) return
    window.dispatchEvent(new CustomEvent('usagi:agent-result', {
      detail: { id, module: 'schedule', message }
    }))
  }

  function consumePendingAgentAction() {
    try {
      const raw = localStorage.getItem('usagi_pending_schedule_action')
      if (!raw) return
      localStorage.removeItem('usagi_pending_schedule_action')
      handleAgentAction({ detail: JSON.parse(raw) })
    } catch (err) {}
  }

  async function handleAgentAction(event) {
    const detail = event.detail || {}
    if (detail.module !== 'schedule' || detail.type !== 'schedule:person-week-todos') return
    const person = detail.payload?.person || '陈健伊'
    const group = findGroupByMember(person)
    if (group) activeGroup.value = group.id
    viewMode.value = 'person'
    weekOffset.value = Number(detail.payload?.weekOffset || 0)
    await loadScheduleData()
    emitAgentResult(detail.id, summarizePersonWeekTodos(person, {
      unfinishedOnly: detail.payload?.unfinishedOnly !== false
    }))
  }

  function summarizePersonWeekTodos(person, options = {}) {
    const unfinishedOnly = options.unfinishedOnly !== false
    const tasks = allItems.value
      .filter(item => item.person === person || (Array.isArray(item.participants) && item.participants.some(row => row.person === person)))
      .filter(item => !unfinishedOnly || item.status !== 'done')
      .filter(item => weekDays.value.some(day => isSameDay(item.date, day)))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))

    const lines = tasks.slice(0, 8).map(item => {
      const status = STATUS_MAP[getAutoStatus(item)] || STATUS_MAP[item.status] || item.status || '未完成'
      const content = item.content || '未填写内容'
      return '· ' + [item.date, item.account, TYPE_TAG[item.type] || item.type, content, status].filter(Boolean).join(' | ')
    })

    if (!tasks.length) {
      return unfinishedOnly
        ? `${person} 本周没有未完成任务。`
        : `${person} 本周没有排期任务。`
    }

    const more = tasks.length > lines.length ? `\n还有 ${tasks.length - lines.length} 条未展开。` : ''
    return [
      unfinishedOnly
        ? `${person} 本周还有 ${tasks.length} 条未完成/延期任务。`
        : `${person} 本周一共有 ${tasks.length} 条排期任务。`,
      lines.join('\n') + more,
      unfinishedOnly
        ? '建议先看延期和今天之前的卡片。'
        : '建议按日期继续往前处理。'
    ].join('\n\n')
  }

  function buildTaskOrderForLoad(tasks) {
    const normalized = (tasks || []).map(item => normalizeScheduleItem(item))
    normalized.sort(compareTaskOrder)
    return normalized
  }

  async function loadScheduleData(options = {}) {
    if (scheduleLoading) return
    scheduleLoading = true
    try {
      const data = await loadSchedule()
      const nextRevision = Number(data.revision || 0)
      scheduleRevision.value = nextRevision
      const sourceTasks = Array.isArray(data.tasks) ? data.tasks : []
      rebuildItemsByPerson(buildTaskOrderForLoad(sourceTasks))
      if (options.synced) showToast('排期已同步最新变更', 'info')
    } catch (err) {
      showToast('排期加载失败: ' + err.message, 'error')
    } finally {
      scheduleLoading = false
    }
  }

  async function syncScheduleIfChanged() {
    if (formShow.value || dragItem.value) return
    if (scheduleSaving) return
    if (scheduleLoading || scheduleSyncing) return
    if (Date.now() - lastLocalScheduleChangeAt < SCHEDULE_IDLE_SYNC_DELAY_MS) return
    if (typeof document !== 'undefined' && document.hidden) return
    scheduleSyncing = true
    try {
      const data = await loadScheduleRevision()
      const nextRevision = Number(data.revision || 0)
      if (nextRevision !== scheduleRevision.value) {
        await loadScheduleData({ synced: true })
      }
    } catch (err) {
    } finally {
      scheduleSyncing = false
    }
  }

  onMounted(() => {
    loadScheduleData()
    loadScheduleTodosData()
    scheduleSyncTimer = window.setInterval(syncScheduleIfChanged, SCHEDULE_SYNC_INTERVAL_MS)
  })

  function sendHandoffNotification(fromPerson, toPerson, item) {
    notifyScheduleHandoff({
      fromPerson,
      toPerson,
      task: {
        id: item?.id,
        account: item?.account,
        type: item?.type,
        content: item?.content,
        remark: item?.remark,
        date: item?.date
      }
    }).catch(() => {})
  }

  return {
    ALL_ACCOUNTS,
    DEPARTMENT_TODO_TAB,
    GROUPS,
    MEMBERS,
    WORKFLOW_STAGES,
    activeGroup,
    activePasteTarget,
    activeTask,
    addGroupTodo,
    allItems,
    assignTodoToPerson,
    boardRef,
    canDeleteTasks,
    canViewAllGroups,
    clearScheduleDoc,
    compareTaskOrder,
    copiedTask,
    copyItem,
    currentGroup,
    currentGroupAccounts,
    currentGroupMembers,
    currentGroupWeekAccounts,
    currentTasks,
    currentUser,
    deleteEditingItem,
    delItem,
    departmentTodoStats,
    doPan,
    dragItem,
    editItem,
    editWeekItem,
    editing,
    endPan,
    form,
    formShow,
    formatDate,
    formatPersonTaskDate,
    fmtMd,
    getAutoStatus,
    getGroupNextDeadline,
    getGroupOpenTodoCount,
    getGroupQuestLevel,
    getGroupTodos,
    getGroupTodoStats,
    getItemsForCell,
    groupLeaderName,
    handleAgentAction,
    handleDragEnd,
    handleDragStart,
    handleDrop,
    handleKeydown,
    handleScheduleDocDrop,
    handleScheduleDocFile,
    handleScheduleDocPaste,
    handleTaskDrop,
    handleWeekCardDrop,
    handleWeekDrop,
    hasScheduleDoc,
    inferItemGroupName,
    isPanning,
    isSameDay,
    isToday,
    itemsByPerson,
    loadScheduleData,
    loadScheduleTodoHistoryData,
    loadScheduleTodosData,
    moveDraggedItemToAdjacentWeek,
    moveItemByWeeks,
    openAdd,
    openScheduleDoc,
    persistSchedule,
    pasteCopiedTask,
    personScheduleItems,
    pleadDelayTodo,
    promoteParticipant,
    rebuildItemsByPerson,
    saveItem,
    setActiveTask,
    setPasteTarget,
    setScheduleDocLink,
    setWeekPasteTarget,
    splitEditingItem,
    scheduleTodoHistory,
    scheduleTodoHistoryLoading,
    scheduleTodos,
    statusLabel,
    startPan,
    todoAlarmLevel,
    todoCountdownLabel,
    todoDeadlinePressure,
    todoDeadlinePressureLabel,
    todoDraftFor,
    todoDueLabel,
    todoGroupTone,
    todoQuestRank,
    todoReminderLabel,
    transferTaskToPerson,
    summarizePersonWeekTodos,
    toggleDone,
    toggleTodoDone,
    undo,
    removeTodo,
    visibleTodoGroups,
    viewMode,
    weekCardTitle,
    weekDays,
    weekOffset,
    weekRangeLabel,
    workflowStageActionLabel,
    workflowStageIndex,
    workflowStageProgressAngle,
    workflowStageShortLabel,
    workflowStageStepLabel,
    legacyWorkflowStageIndex,
    workflowStageTone
  }
}
