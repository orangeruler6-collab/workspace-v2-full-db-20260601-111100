import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  aiTagMaterial,
  createFolder,
  deleteFolder,
  deleteMaterial,
  getMaterialStats,
  getMaterialStorage,
  listFolders,
  listMaterials,
  moveFolder,
  recordMaterialDownload,
  renameFolder,
  restoreMaterials,
  updateMaterial,
  uploadMaterial,
  uploadMaterialFile
} from '../../api/materials'
import { getCurrentAuthUser } from '../../api/client'
import {
  getProjectDeliveryDashboard,
  linkProjectDeliveryMaterials
} from '../../api/projectDelivery'
import { useConfirm } from '../../composables/useConfirm'

const ALL_FOLDER = '__all__'
const FOLDER_OPEN_KEY = 'material-library-open-folders'
const CLIP_BASKET_KEY = 'material-library-clip-basket'
const ALL_CATEGORY = '__all__'

export function useMaterialLibrary(props = {}) {
  const confirmAction = useConfirm()

  const materialType = ref('video')
  const list = ref([])
  const categories = ref([])
  const total = ref(0)
  const totalSize = ref(0)
  const storage = ref(null)
  const loading = ref(false)
  const selectedCat = ref(ALL_CATEGORY)
  const searchText = ref('')
  const page = ref(1)
  const pageSize = ref(60)
  const sortBy = ref('created_at')
  const sortDir = ref('desc')
  const viewMode = ref('grid')

  const folders = ref([])
  const rootFolderStats = ref({ count: 0, size: 0 })
  const currentFolder = ref(ALL_FOLDER)
  const newFolderName = ref('')
  const folderLoading = ref(false)
  const creatingFolder = ref(false)

  const currentUser = (() => {
    try { return getCurrentAuthUser() } catch(e) { return null }
  })()
  const uploaderName = ref(currentUser?.display_name || currentUser?.username || '')
  const dragging = ref(false)
  const uploading = ref(false)
  const uploadPct = ref(0)
  const uploadCurrentPct = ref(0)
  const uploadCurrentName = ref('')
  const uploadSpeedText = ref('')
  const uploadEtaText = ref('')
  const uploadBatchDone = ref(0)
  const uploadBatchTotal = ref(0)
  const uploadMsg = ref('')
  const uploadMsgType = ref('info')
  const previewItem = ref(null)
  const editItem = ref(null)
  const editName = ref('')
  const editCategory = ref('')
  const editTagsStr = ref('')
  const saving = ref(false)
  const aiTaggingId = ref(null)
  const uploadInputRef = ref(null)
  const ctxMenu = ref({ show: false, x: 0, y: 0, item: null, mode: 'blank' })
  const ctxFolderNaming = ref(false)
  const ctxFolderDraft = ref('')
  const selectedIds = ref([])
  const detailItem = ref(null)
  const detailFolder = ref(null)
  const bulkMoving = ref(false)
  const bulkMoveTarget = ref('')
  const bulkAiTagging = ref(false)
  const projectBinding = ref(false)
  const projectOptions = ref([])
  const projectTaskOptions = ref([])
  const bindProjectId = ref(0)
  const bindTaskId = ref(0)
  const projectBindingHint = ref('')
  const folderRenameNaming = ref(false)
  const folderRenameDraft = ref('')
  const folderMoveNaming = ref(false)
  const folderMoveTarget = ref('')
  const openFolderMap = ref(loadJson(FOLDER_OPEN_KEY, {}))
  const dragItem = ref(null)
  const dragFolder = ref(null)
  const dragOverFolder = ref('')
  const undoStack = ref([])
  const clipBasket = ref(loadJson(CLIP_BASKET_KEY, []))
  const basketOpen = ref(false)
  let searchTimer = null

  const typeLabels = { video: '视频', bgm: 'BGM', image: '图片' }
  const typeExts = {
    video: 'video/*',
    bgm: '.mp3,.wav,.flac,.aac,.ogg,.wma,.m4a',
    image: 'image/*'
  }
  const BGM_TAGS = ['轻快', '紧张', '史诗', '温柔']
  const EDIT_USE_TAGS = [
    '采访/发言片段',
    '评论/梗图',
    '排名/数据截图',
    '开场名场面',
    '游戏/比赛画面',
    '综艺/原片',
    '人物近景',
    '背景补充',
    '品牌/商单物料'
  ]

  const folderForQuery = computed(() => currentFolder.value === ALL_FOLDER ? undefined : currentFolder.value)
  const uploadFolder = computed(() => currentFolder.value === ALL_FOLDER ? '/' : currentFolder.value)
  const currentFolderLabel = computed(() => currentFolder.value === ALL_FOLDER ? '全部素材' : currentFolder.value)
  const parentFolder = computed(() => {
    if (currentFolder.value === ALL_FOLDER || currentFolder.value === '/') return ALL_FOLDER
    const idx = currentFolder.value.lastIndexOf('/')
    return idx <= 0 ? '/' : currentFolder.value.slice(0, idx)
  })
  const visibleFolders = computed(() => {
    const parent = currentFolder.value === ALL_FOLDER ? '/' : currentFolder.value
    return folders.value.filter(folder => folder.parent === parent)
  })
  const folderTree = computed(() => buildFolderTree('/', 0))
  const folderRows = computed(() => flattenFolderTree(folderTree.value))
  const selectedCount = computed(() => selectedIds.value.length)
  const selectedItems = computed(() => list.value.filter(item => selectedIds.value.includes(item.id)))
  const legacyFolderOptions = computed(() => [
    { path: '/', label: '根目录' },
    ...folderRows.value.map(folder => ({ path: folder.path, label: '　'.repeat(folder.level || 0) + folder.name }))
  ])
  const folderOptions = computed(() => [
    {
      path: '/',
      label: '根目录',
      count: Number(rootFolderStats.value.deep_count ?? rootFolderStats.value.count) || 0,
      size: Number(rootFolderStats.value.deep_size ?? rootFolderStats.value.size) || 0
    },
    ...folderRows.value.map(folder => ({
      path: folder.path,
      label: `${'  '.repeat(folder.level || 0)}${folder.name}`,
      count: Number(folder.deep_count ?? folder.count) || 0,
      size: Number(folder.deep_size ?? folder.size) || 0
    }))
  ])
  const clipBasketItems = computed(() => clipBasket.value.filter(item => item.type === materialType.value))
  const clipBasketCount = computed(() => clipBasket.value.length)
  const uploadQueueText = computed(() => uploadBatchTotal.value > 1 ? `${uploadBatchDone.value + 1}/${uploadBatchTotal.value}` : '')
  const breadcrumbItems = computed(() => {
    if (currentFolder.value === ALL_FOLDER) return [{ label: '全部素材', path: ALL_FOLDER }]
    if (currentFolder.value === '/') return [{ label: '根目录', path: '/' }]
    const parts = currentFolder.value.split('/').filter(Boolean)
    const items = [{ label: '根目录', path: '/' }]
    let nextPath = ''
    parts.forEach(part => {
      nextPath += '/' + part
      items.push({ label: part, path: nextPath })
    })
    return items
  })

  function buildFolderTree(parent, level) {
    return folders.value
      .filter(folder => (folder.parent || '/') === parent)
      .map(folder => ({
        ...folder,
        level,
        children: buildFolderTree(folder.path, level + 1)
      }))
  }

  function flattenFolderTree(items) {
    const rows = []
    ;(items || []).forEach(item => {
      rows.push(item)
      if (isFolderOpen(item.path)) {
        rows.push(...flattenFolderTree(item.children || []))
      }
    })
    return rows
  }

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || '') || fallback
    } catch(e) {
      return fallback
    }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch(e) {}
  }

  function pushUndo(action) {
    undoStack.value = [action].concat(undoStack.value).slice(0, 20)
    showMsg((action.label || '操作') + '，按 Ctrl+Z 可撤回', 'info')
  }

  async function runUndo() {
    const action = undoStack.value.shift()
    if (!action) {
      showMsg('没有可撤回的操作', 'info')
      return
    }
    try {
      await action.undo()
      await loadFolders()
      await loadStorage()
      await loadList()
      await loadProjectBindingOptions(bindProjectId.value)
      showMsg('已撤回：' + (action.label || '上一步操作'), 'success')
    } catch(e) {
      showMsg('撤回失败: ' + e.message, 'error')
    }
  }

  function debouncedSearch() {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      page.value = 1
      loadList()
    }, 400)
  }

  async function loadList() {
    loading.value = true
    try {
      const categoryForQuery = selectedCat.value === ALL_CATEGORY ? '' : selectedCat.value
      const data = await listMaterials({
        type: materialType.value,
        category: categoryForQuery,
        search: searchText.value,
        folder: folderForQuery.value,
        page: page.value,
        pageSize: pageSize.value,
        sortBy: sortBy.value,
        sortDir: sortDir.value
      })
      list.value = data.list || []
      selectedIds.value = selectedIds.value.filter(id => list.value.some(item => item.id === id))
      if (detailItem.value && !list.value.some(item => item.id === detailItem.value.id)) detailItem.value = null
      total.value = data.total || 0
      totalSize.value = data.total_size || 0
      storage.value = data.storage || storage.value
      loadStats()
    } catch (e) {
      list.value = []
      showMsg('素材列表加载失败: ' + e.message, 'error')
    } finally {
      loading.value = false
    }
  }

  async function loadStats() {
    try {
      const data = await getMaterialStats(materialType.value)
      categories.value = data.categories || []
      if (!total.value) total.value = data.total || 0
    } catch (e) {
      categories.value = []
      if (!list.value.length) total.value = 0
    }
  }

  async function loadStorage() {
    try {
      storage.value = await getMaterialStorage()
    } catch(e) {
      storage.value = null
    }
  }

  async function loadFolders() {
    folderLoading.value = true
    try {
      const data = await listFolders(materialType.value)
      folders.value = data.folders || []
      rootFolderStats.value = data.root || { count: 0, size: 0 }
    } catch(e) {
      folders.value = []
      rootFolderStats.value = { count: 0, size: 0 }
      showMsg('目录加载失败: ' + e.message, 'error')
    } finally {
      folderLoading.value = false
    }
  }

  function selectFolder(folderPath = ALL_FOLDER) {
    currentFolder.value = folderPath || ALL_FOLDER
    openFolderAncestors(currentFolder.value)
    page.value = 1
    clearSelection()
    bulkMoveTarget.value = ''
    detailItem.value = null
    detailFolder.value = null
    loadList()
  }

  function openFolderAncestors(folderPath) {
    if (!folderPath || folderPath === ALL_FOLDER || folderPath === '/') return
    const nextOpenMap = { ...openFolderMap.value }
    const parts = folderPath.split('/').filter(Boolean)
    let path = ''
    parts.slice(0, -1).forEach(part => {
      path += '/' + part
      nextOpenMap[path] = true
    })
    openFolderMap.value = nextOpenMap
    saveJson(FOLDER_OPEN_KEY, openFolderMap.value)
  }

  function goParentFolder() {
    selectFolder(parentFolder.value)
  }

  function folderDeepStats(folder) {
    if (!folder?.path) return { count: 0, size: 0, folders: 0 }
    const prefix = folder.path + '/'
    const descendants = folders.value.filter(item => item.path === folder.path || item.path.startsWith(prefix))
    return {
      count: descendants.reduce((sum, item) => sum + (Number(item.count) || 0), 0),
      size: descendants.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
      folders: Math.max(0, descendants.length - 1)
    }
  }

  async function createCurrentFolder() {
    const name = newFolderName.value.trim()
    if (!name) {
      showMsg('请输入文件夹名称', 'error')
      return
    }
    creatingFolder.value = true
    try {
      const parent = uploadFolder.value
      await createFolder(name, materialType.value, parent)
      const nextPath = parent === '/' ? '/' + name : parent + '/' + name
      newFolderName.value = ''
      await loadFolders()
      selectFolder(nextPath)
      showMsg('文件夹已创建', 'success')
    } catch(e) {
      showMsg('创建文件夹失败: ' + e.message, 'error')
    } finally {
      creatingFolder.value = false
    }
  }

  async function removeFolder(folder) {
    if (!folder?.id) return
    const stats = folderDeepStats(folder)
    const ok = await confirmAction({
      title: '删除文件夹和素材',
      message: `将删除「${folder.name}」及其子文件夹。包含 ${stats.folders} 个子文件夹、${stats.count} 个素材，约 ${formatSize(stats.size)}。此操作会删除实际文件，无法撤回。`,
      confirmText: '确认删除',
      type: 'danger'
    })
    if (!ok) return
    try {
      const result = await deleteFolder(folder.id, { deleteMaterials: true })
      if (currentFolder.value === folder.path || currentFolder.value.startsWith(folder.path + '/')) {
        currentFolder.value = ALL_FOLDER
      }
      await loadFolders()
      await loadStorage()
      loadList()
      const failed = Array.isArray(result.failed_files) ? result.failed_files.length : 0
      showMsg(failed ? `文件夹已删除，但有 ${failed} 个文件未能删除` : '文件夹和素材已删除', failed ? 'error' : 'success')
    } catch(e) {
      showMsg('删除文件夹失败: ' + e.message, 'error')
    }
  }

  function setViewMode(mode) {
    viewMode.value = mode === 'list' ? 'list' : 'grid'
  }

  function isSelected(item) {
    return selectedIds.value.includes(item?.id)
  }

  function toggleSelect(item) {
    if (!item?.id) return
    const set = new Set(selectedIds.value)
    if (set.has(item.id)) set.delete(item.id)
    else set.add(item.id)
    selectedIds.value = Array.from(set)
  }

  function selectAllVisible() {
    selectedIds.value = list.value.map(item => item.id)
  }

  function clearSelection() {
    selectedIds.value = []
  }

  function openDetail(item) {
    detailFolder.value = null
    detailItem.value = item
  }

  function openFolderDetail(folder) {
    if (!folder) return
    detailItem.value = null
    detailFolder.value = folder
  }

  function closeDetail() {
    detailItem.value = null
    detailFolder.value = null
  }

  function toggleFolderOpen(folderPath) {
    if (!folderPath) return
    openFolderMap.value = Object.assign({}, openFolderMap.value, {
      [folderPath]: !openFolderMap.value[folderPath]
    })
    saveJson(FOLDER_OPEN_KEY, openFolderMap.value)
  }

  function isFolderOpen(folderPath) {
    return openFolderMap.value[folderPath] !== false
  }

  function hasFolderChildren(folder) {
    return !!folder?.children?.length
  }

  function startDragItem(item) {
    dragItem.value = item
    dragFolder.value = null
  }

  function startDragFolder(folder) {
    dragFolder.value = folder || null
    dragItem.value = null
  }

  function clearDragState() {
    dragItem.value = null
    dragFolder.value = null
    dragOverFolder.value = ''
  }

  function dragOverFolderPath(path) {
    dragOverFolder.value = path || '/'
  }

  function hasExternalFiles(e) {
    const types = Array.from(e?.dataTransfer?.types || [])
    return types.includes('Files') && (e?.dataTransfer?.files?.length || 0) > 0
  }

  async function dropItemToFolder(folderPath, e) {
    if (hasExternalFiles(e)) {
      await uploadFiles(Array.from(e.dataTransfer.files || []), folderPath || '/')
      return
    }
    if (dragFolder.value?.id) {
      await moveDraggedFolderTo(folderPath || '/')
      return
    }
    const item = dragItem.value
    const target = folderPath || '/'
    clearDragState()
    if (!item?.id || (item.folder || '/') === target) return
    const previous = item.folder || '/'
    try {
      await updateMaterial({ id: item.id, folder: target })
      pushUndo({
        label: '拖拽移动素材',
        undo: async () => updateMaterial({ id: item.id, folder: previous })
      })
      await loadFolders()
      await loadList()
      showMsg('素材已移动到 ' + target, 'success')
    } catch(e) {
      showMsg('拖拽移动失败: ' + e.message, 'error')
    }
  }

  function canMoveFolderTo(folder, targetParent) {
    if (!folder?.id) return false
    const target = targetParent || '/'
    if (target === folder.parent) return false
    if (target === folder.path || target.startsWith(folder.path + '/')) return false
    return true
  }

  async function moveFolderTo(folder, targetParent) {
    const target = targetParent || '/'
    if (!folder?.id || !canMoveFolderTo(folder, target)) {
      showMsg('涓嶈兘绉诲姩鍒板綋鍓嶇洰褰曟垨鑷繁鐨勫瓙鐩綍', 'error')
      return
    }
    try {
      const previousParent = folder.parent || '/'
      const result = await moveFolder(folder.id, target)
      pushUndo({
        label: '移动文件夹',
        undo: async () => moveFolder(folder.id, previousParent)
      })
      await loadFolders()
      await loadList()
      if (detailFolder.value?.id === folder.id) detailFolder.value = null
      if (currentFolder.value === folder.path || currentFolder.value.startsWith(folder.path + '/')) {
        selectFolder(result.path || target)
      }
      showMsg('鏂囦欢澶瑰凡绉诲姩鍒? ' + target, 'success')
    } catch(e) {
      showMsg('绉诲姩鏂囦欢澶瑰け璐? ' + e.message, 'error')
    }
  }

  async function moveDraggedFolderTo(targetParent) {
    const folder = dragFolder.value
    clearDragState()
    await moveFolderTo(folder, targetParent || '/')
  }

  function addToClipBasket(item) {
    if (!item?.id) return
    const exists = clipBasket.value.some(row => row.id === item.id)
    if (!exists) {
      clipBasket.value = clipBasket.value.concat([{
        id: item.id,
        original: item.original,
        type: item.type,
        thumb: item.thumb,
        filename: item.filename,
        folder: item.folder || '/'
      }])
      saveJson(CLIP_BASKET_KEY, clipBasket.value)
    }
    showMsg(exists ? '素材已在剪辑篮中' : '已加入剪辑篮', 'success')
  }

  function removeFromClipBasket(id) {
    clipBasket.value = clipBasket.value.filter(item => item.id !== id)
    saveJson(CLIP_BASKET_KEY, clipBasket.value)
  }

  function clearClipBasket() {
    clipBasket.value = []
    saveJson(CLIP_BASKET_KEY, clipBasket.value)
  }

  function toggleBasketOpen() {
    basketOpen.value = !basketOpen.value
  }

  async function batchDeleteSelected() {
    const items = selectedItems.value
    if (!items.length) return
    const ok = await confirmAction({
      title: '批量删除素材',
      message: `将删除 ${items.length} 个素材和对应实际文件，无法撤回。`,
      confirmText: '批量删除',
      type: 'danger'
    })
    if (!ok) return
    try {
      for (const item of items) await deleteMaterial(item.id)
      pushUndo({
        label: `删除 ${items.length} 个素材`,
        undo: async () => restoreMaterials(items.map(item => item.id))
      })
      clearSelection()
      detailItem.value = null
      await loadFolders()
      await loadStorage()
      await loadList()
      showMsg(`已删除 ${items.length} 个素材`, 'success')
    } catch(e) {
      showMsg('批量删除失败: ' + e.message, 'error')
    }
  }

  async function batchMoveSelected(targetFolder) {
    const folder = targetFolder || bulkMoveTarget.value || '/'
    const items = selectedItems.value
    if (!items.length || bulkMoving.value) return
    if (items.every(item => (item.folder || '/') === folder)) {
      showMsg('选中的素材已经在目标目录里', 'info')
      return
    }
    const before = items.map(item => ({ id: item.id, folder: item.folder || '/' }))
    bulkMoving.value = true
    try {
      for (const item of items) await updateMaterial({ id: item.id, folder })
      pushUndo({
        label: `移动 ${items.length} 个素材`,
        undo: async () => {
          for (const row of before) await updateMaterial({ id: row.id, folder: row.folder })
        }
      })
      clearSelection()
      bulkMoveTarget.value = ''
      await loadFolders()
      await loadList()
      showMsg(`已移动 ${items.length} 个素材到 ${folder}`, 'success')
    } catch(e) {
      showMsg('批量移动失败: ' + e.message, 'error')
    } finally {
      bulkMoving.value = false
    }
  }

  async function batchAiTagSelected() {
    const items = selectedItems.value
    if (!items.length || bulkAiTagging.value) return
    bulkAiTagging.value = true
    try {
      for (const item of items) await aiTagMaterial(item.id)
      await loadList()
      await loadStats()
      showMsg(`已更新 ${items.length} 个素材的 AI 标签`, 'success')
    } catch(e) {
      showMsg('批量 AI 标签失败: ' + e.message, 'error')
    } finally {
      bulkAiTagging.value = false
    }
  }

  async function loadProjectBindingOptions(projectId) {
    try {
      const data = await getProjectDeliveryDashboard(projectId || bindProjectId.value || undefined)
      projectOptions.value = data.projects || []
      if (!bindProjectId.value && data.project?.id) bindProjectId.value = data.project.id
      projectTaskOptions.value = (data.tasks || [])
        .slice()
        .sort((a, b) => {
          const aBound = Number(a.material_count || a.material_id || 0) > 0 ? 1 : 0
          const bBound = Number(b.material_count || b.material_id || 0) > 0 ? 1 : 0
          if (aBound !== bBound) return aBound - bBound
          return String(a.plan_date || '').localeCompare(String(b.plan_date || '')) || Number(a.id || 0) - Number(b.id || 0)
        })
        .map(task => ({
        id: task.id,
        label: [
          Number(task.material_count || task.material_id || 0) > 0 ? '已绑定' : '未绑定',
          task.plan_date,
          task.group_name,
          task.owner,
          task.title
        ].filter(Boolean).join(' / ') || ('#' + task.id),
        status: task.status
      }))
      if (!bindTaskId.value) {
        const firstOpenTask = projectTaskOptions.value.find(task => !String(task.label || '').startsWith('已绑定'))
        bindTaskId.value = firstOpenTask?.id || 0
      }
    } catch(e) {
      projectOptions.value = []
      projectTaskOptions.value = []
    }
  }

  async function changeBindProject(projectId) {
    bindProjectId.value = Number(projectId) || 0
    bindTaskId.value = 0
    await loadProjectBindingOptions(bindProjectId.value)
  }

  async function applyProjectDeliveryContext(payload) {
    const ctx = payload?.projectDeliveryTask || payload
    if (!ctx || ctx.source !== 'project-delivery') return
    if (ctx.project_id) {
      bindProjectId.value = Number(ctx.project_id) || 0
      bindTaskId.value = Number(ctx.task_id) || 0
      await loadProjectBindingOptions(bindProjectId.value)
      if (ctx.task_id) bindTaskId.value = Number(ctx.task_id) || bindTaskId.value
    }
    if (ctx.material_folder) {
      currentFolder.value = ctx.material_folder
      page.value = 1
      await loadList()
    }
    const label = [ctx.project_name, ctx.plan_date, ctx.group_name, ctx.owner].filter(Boolean).join(' / ')
    projectBindingHint.value = label ? 'From project task: ' + label : ''
  }

  async function batchBindProjectTask() {
    const ids = selectedIds.value.slice()
    if (!ids.length || !bindProjectId.value || projectBinding.value) return
    projectBinding.value = true
    try {
      await linkProjectDeliveryMaterials({
        project_id: bindProjectId.value,
        task_id: bindTaskId.value || 0,
        material_ids: ids
      })
      clearSelection()
      await loadList()
      await loadProjectBindingOptions(bindProjectId.value)
      showMsg('已绑定到项目任务', 'success')
    } catch(e) {
      showMsg('项目绑定失败: ' + e.message, 'error')
    } finally {
      projectBinding.value = false
    }
  }

  function onDragEnter(e) {
    if (hasExternalFiles(e)) dragging.value = true
  }

  function onDragOver(e) {
    if (!hasExternalFiles(e)) return
    dragging.value = true
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(e) {
    if (e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
    dragging.value = false
  }

  function onDrop(e, targetFolder) {
    dragging.value = false
    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length) uploadFiles(files, targetFolder)
  }

  function onFileSelect(e) {
    const files = Array.from(e.target.files || [])
    if (files.length) uploadFiles(files)
    e.target.value = ''
  }

  function normalizeMaterialType(type) {
    const value = String(type || '').toLowerCase()
    return Object.prototype.hasOwnProperty.call(typeLabels, value) ? value : materialType.value
  }

  function resetUploadProgress() {
    uploadPct.value = 0
    uploadCurrentPct.value = 0
    uploadCurrentName.value = ''
    uploadSpeedText.value = ''
    uploadEtaText.value = ''
    uploadBatchDone.value = 0
    uploadBatchTotal.value = 0
  }

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return ''
    const totalSeconds = Math.max(1, Math.round(seconds))
    const minutes = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60)
      const restMinutes = minutes % 60
      return `${hours}h ${restMinutes}m`
    }
    if (minutes > 0) return `${minutes}m ${secs}s`
    return `${secs}s`
  }

  function updateUploadProgress(file, percent, event, startedAt, batchLoadedBefore = 0, batchTotalSize = file.size || 1) {
    const loaded = Math.max(0, Math.min(Number(event?.loaded) || Math.round((file.size || 0) * (percent || 0) / 100), file.size || 0))
    const elapsedSeconds = Math.max(0.25, (Date.now() - startedAt) / 1000)
    const bytesPerSecond = loaded / elapsedSeconds
    const totalLoaded = batchLoadedBefore + loaded
    uploadCurrentPct.value = Math.max(1, Math.min(100, Math.round(percent || 0)))
    uploadPct.value = Math.max(1, Math.min(99, Math.round((totalLoaded / Math.max(1, batchTotalSize)) * 100)))
    uploadSpeedText.value = bytesPerSecond > 0 ? `${formatSize(bytesPerSecond)}/s` : ''
    uploadEtaText.value = bytesPerSecond > 0 ? formatEta((batchTotalSize - totalLoaded) / bytesPerSecond) : ''
  }

  async function uploadFiles(files, targetFolder) {
    const validFiles = Array.from(files || []).filter(file => file && file.size !== undefined)
    if (!validFiles.length) return
    if (uploading.value) {
      showMsg('正在上传中，请等这一批完成后再导入', 'info')
      return
    }
    const tooLarge = validFiles.find(file => file.size > 8 * 1024 * 1024 * 1024)
    if (tooLarge) {
      showMsg('单个素材不能超过 8GB：' + tooLarge.name, 'error')
      return
    }

    uploading.value = true
    resetUploadProgress()
    uploadBatchTotal.value = validFiles.length
    const batchTotalSize = validFiles.reduce((sum, file) => sum + (file.size || 0), 0) || 1
    let batchLoadedBefore = 0
    let latestType = materialType.value
    try {
      showMsg(validFiles.length > 1 ? `正在导入 ${validFiles.length} 个素材...` : '正在上传到内网文件系统...', 'info')
      for (let i = 0; i < validFiles.length; i += 1) {
        uploadBatchDone.value = i
        const data = await handleFile(validFiles[i], {
          targetFolder: targetFolder || uploadFolder.value,
          batchLoadedBefore,
          batchTotalSize,
          keepUploadingState: true
        })
        batchLoadedBefore += validFiles[i].size || 0
        latestType = normalizeMaterialType(data?.type || latestType)
      }
      uploadPct.value = 100
      uploadCurrentPct.value = 100
      materialType.value = latestType
      selectedCat.value = ALL_CATEGORY
      searchText.value = ''
      sortBy.value = 'created_at'
      sortDir.value = 'desc'
      page.value = 1
      await Promise.all([
        loadFolders(),
        loadStorage(),
        loadList()
      ])
      showMsg(validFiles.length > 1 ? `导入完成：${validFiles.length} 个素材已入库` : '上传成功，素材已入库，AI 标签后台处理中', 'success')
    } catch(e) {
      showMsg('上传失败: ' + e.message, 'error')
    } finally {
      uploading.value = false
      resetUploadProgress()
    }
  }

  async function handleFile(file, options = {}) {
    if (file.size > 8 * 1024 * 1024 * 1024) {
      showMsg('单个素材不能超过 8GB', 'error')
      throw new Error('file is larger than 8GB')
    }
    if (file.size > 8 * 1024 * 1024 * 1024) {
      showMsg('单个素材不能超过 8GB', 'error')
      return
    }
    if (!options.keepUploadingState) uploading.value = true
    uploadPct.value = 0
    uploadCurrentPct.value = 0
    uploadCurrentName.value = file.name
    const startedAt = Date.now()
    showMsg('正在上传到内网文件系统...', 'info')

    try {
      const data = await uploadMaterialFile({
        file,
        filename: file.name,
        original: file.name,
        size: file.size,
        lastModified: file.lastModified || 0,
        folder: options.targetFolder || uploadFolder.value,
        uploader: uploaderName.value || '当前用户'
      }, (percent, event) => {
        updateUploadProgress(file, percent, event, startedAt, options.batchLoadedBefore || 0, options.batchTotalSize || file.size || 1)
        if (percent >= 100) showMsg('文件已到达服务端，正在写入内网文件系统...', 'info')
      })
      uploadPct.value = 100
      materialType.value = normalizeMaterialType(data.type)
      selectedCat.value = ALL_CATEGORY
      searchText.value = ''
      sortBy.value = 'created_at'
      sortDir.value = 'desc'
      showMsg(data.remote_storage ? '上传成功，已存入内网文件系统，AI 标签后台处理中' : '上传成功，素材已入库，AI 标签后台处理中', 'success')
      page.value = 1
      await Promise.all([
        loadFolders(),
        loadStorage(),
        loadList()
      ])
      return data
    } catch (e) {
      showMsg('上传失败: ' + e.message, 'error')
      throw e
    } finally {
      if (!options.keepUploadingState) {
        uploading.value = false
        resetUploadProgress()
      }
    }
  }

  function showMsg(msg, type = 'info') {
    uploadMsg.value = msg
    uploadMsgType.value = type
    setTimeout(() => { uploadMsg.value = '' }, 5000)
  }

  function normalizeTags(item) {
    if (Array.isArray(item?.tags)) return item.tags.map(tag => String(tag || '').trim()).filter(Boolean)
    if (typeof item?.tags === 'string') {
      return item.tags.split(/[,，/]/).map(tag => tag.trim()).filter(Boolean)
    }
    return []
  }

  function materialUseTags(item) {
    const tags = normalizeTags(item)
    return tags.filter(tag => EDIT_USE_TAGS.includes(tag))
  }

  function hasUseTag(item, tag) {
    return normalizeTags(item).includes(tag)
  }

  async function applyQuickSearch(tag) {
    searchText.value = tag
    selectedCat.value = ALL_CATEGORY
    page.value = 1
    await loadList()
  }

  function patchMaterialInState(id, patch) {
    list.value = list.value.map(row => row.id === id ? { ...row, ...patch } : row)
    if (detailItem.value?.id === id) detailItem.value = { ...detailItem.value, ...patch }
    if (editItem.value?.id === id) editItem.value = { ...editItem.value, ...patch }
  }

  async function toggleUseTagForItem(item, tag) {
    if (!item?.id || !tag) return
    const current = normalizeTags(item)
    const exists = current.includes(tag)
    const nextTags = exists ? current.filter(row => row !== tag) : current.concat(tag)
    const nextCategory = item.category && item.category !== '待分类' ? item.category : tag
    try {
      await updateMaterial({ id: item.id, tags: nextTags, category: nextCategory })
      patchMaterialInState(item.id, { tags: nextTags, category: nextCategory })
      showMsg(exists ? `已移除用途：${tag}` : `已标记用途：${tag}`, 'success')
      loadStats()
    } catch(e) {
      showMsg('更新用途标签失败: ' + e.message, 'error')
    }
  }

  async function deleteItem(item) {
    const ok = await confirmAction({
      title: '删除素材',
      message: `确认删除「${item.original}」？这会删除实际文件，无法撤回。`,
      confirmText: '删除',
      type: 'danger'
    })
    if (!ok) return
    try {
      await deleteMaterial(item.id)
      pushUndo({
        label: '删除素材',
        undo: async () => restoreMaterials([item.id])
      })
      if (detailItem.value?.id === item.id) detailItem.value = null
      selectedIds.value = selectedIds.value.filter(id => id !== item.id)
      loadFolders()
      loadStorage()
      loadList()
    } catch (e) {
      showMsg('删除失败: ' + e.message, 'error')
    }
  }

  function openEdit(item) {
    editItem.value = item
    editName.value = item.original || ''
    editCategory.value = item.category || ''
    editTagsStr.value = Array.isArray(item.tags) ? item.tags.join(',') : ''
  }

  async function quickRenameMaterial(item) {
    if (!item?.id) return
    const raw = window.prompt('素材名称', item.original || item.filename || '')
    const name = String(raw || '').trim()
    if (!name || name === item.original) return
    try {
      const previous = item.original || ''
      await updateMaterial({ id: item.id, original: name })
      pushUndo({
        label: '重命名素材',
        undo: async () => updateMaterial({ id: item.id, original: previous })
      })
      patchMaterialInState(item.id, { original: name })
      await loadList()
      showMsg('素材已重命名', 'success')
    } catch(e) {
      showMsg('重命名素材失败: ' + e.message, 'error')
    }
  }

  async function quickRenameFolder(folder) {
    if (!folder?.id) return
    const raw = window.prompt('文件夹名称', folder.name || '')
    const name = String(raw || '').trim()
    if (!name || name === folder.name) return
    try {
      const data = await renameFolder(folder.id, name)
      pushUndo({
        label: '重命名文件夹',
        undo: async () => renameFolder(folder.id, folder.name)
      })
      await loadFolders()
      await loadList()
      if (detailFolder.value?.id === folder.id) {
        detailFolder.value = null
      }
      if (currentFolder.value === folder.path || currentFolder.value.startsWith(folder.path + '/')) {
        selectFolder(data.path || (folder.parent === '/' ? '/' + name : folder.parent + '/' + name))
      }
      showMsg('文件夹已重命名', 'success')
    } catch(e) {
      showMsg('重命名文件夹失败: ' + e.message, 'error')
    }
  }

  async function saveEdit() {
    if (!editItem.value) return
    saving.value = true
    const tags = editTagsStr.value.split(',').map(t => t.trim()).filter(Boolean)
    try {
      await updateMaterial({
        id: editItem.value.id,
        original: editName.value,
        category: editCategory.value,
        tags
      })
      editItem.value = null
      loadList()
      loadStats()
    } catch (e) {
      showMsg('保存失败: ' + e.message, 'error')
    } finally {
      saving.value = false
    }
  }

  async function runAiTag(item) {
    if (!item?.id || aiTaggingId.value) return
    aiTaggingId.value = item.id
    try {
      const data = await aiTagMaterial(item.id)
      showMsg('AI标签已更新：' + (data.category || '待分类'), 'success')
      await loadList()
      if (detailItem.value?.id === item.id) {
        const fresh = list.value.find(row => row.id === item.id)
        if (fresh) detailItem.value = fresh
      }
      loadStats()
    } catch(e) {
      showMsg('AI标签失败: ' + e.message, 'error')
    } finally {
      aiTaggingId.value = null
    }
  }

  function openPreview(item) {
    previewItem.value = item
  }

  function downloadFile(item) {
    const a = document.createElement('a')
    a.href = item.download_url || item.url || `/uploads/${item.type}/${item.filename}`
    a.download = item.original
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    recordMaterialDownload(item.id).catch(() => {})
  }

  function formatDuration(s) {
    if (!s) return ''
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  }

  function formatDate(timestamp) {
    if (!timestamp) return ''
    const d = new Date(timestamp * 1000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function switchType(type) {
    materialType.value = type
    selectedCat.value = ALL_CATEGORY
    currentFolder.value = ALL_FOLDER
    page.value = 1
    loadFolders()
    loadList()
  }

  function selectCategory(category) {
    selectedCat.value = category
    page.value = 1
    loadList()
  }

  function changeSort(value) {
    sortBy.value = value
    page.value = 1
    loadList()
  }

  function toggleSortDir() {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
    page.value = 1
    loadList()
  }

  const totalPages = () => Math.max(1, Math.ceil((total.value || 0) / pageSize.value))

  function nextPage() {
    if (page.value >= totalPages()) return
    page.value += 1
    loadList()
  }

  function prevPage() {
    if (page.value <= 1) return
    page.value -= 1
    loadList()
  }

  function showBlankCtxMenu(e) {
    e.preventDefault()
    ctxFolderNaming.value = false
    ctxFolderDraft.value = ''
    ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, item: null, mode: 'blank' }
  }

  function showCardCtxMenu(e, item) {
    e.preventDefault()
    ctxFolderNaming.value = false
    ctxFolderDraft.value = ''
    ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, item: item, mode: 'card' }
  }

  function showFolderCtxMenu(e, folder) {
    e.preventDefault()
    ctxFolderNaming.value = false
    ctxFolderDraft.value = ''
    folderRenameNaming.value = false
    folderRenameDraft.value = folder?.name || ''
    folderMoveNaming.value = false
    folderMoveTarget.value = ''
    ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, item: folder, mode: 'folder' }
  }

  function hideCtxMenu() {
    ctxMenu.value.show = false
    ctxFolderNaming.value = false
    ctxFolderDraft.value = ''
    folderRenameNaming.value = false
    folderRenameDraft.value = ''
    folderMoveNaming.value = false
    folderMoveTarget.value = ''
  }

  async function ctxDelete(item) {
    hideCtxMenu()
    await deleteItem(item)
  }

  async function ctxChangeCategory(item, category) {
    hideCtxMenu()
    try {
      const previous = item.category
      await updateMaterial({ id: item.id, category })
      pushUndo({
        label: '修改分类',
        undo: async () => updateMaterial({ id: item.id, category: previous })
      })
      showMsg('分类已更新：' + category, 'success')
      page.value = 1
      loadList()
      loadStats()
    } catch(e) {
      showMsg('更新分类失败: ' + e.message, 'error')
    }
  }

  function ctxStartRenameFolder() {
    folderRenameNaming.value = true
    folderRenameDraft.value = ctxMenu.value.item?.name || ''
  }

  async function ctxConfirmRenameFolder() {
    const folder = ctxMenu.value.item
    const name = String(folderRenameDraft.value || '').trim()
    if (!folder?.id || !name) {
      showMsg('请输入文件夹名称', 'error')
      return
    }
    try {
      const data = await renameFolder(folder.id, name)
      pushUndo({
        label: '重命名文件夹',
        undo: async () => renameFolder(folder.id, folder.name)
      })
      hideCtxMenu()
      await loadFolders()
      if (currentFolder.value === folder.path || currentFolder.value.startsWith(folder.path + '/')) {
        selectFolder(data.path || (folder.parent === '/' ? '/' + name : folder.parent + '/' + name))
      }
      showMsg('文件夹已重命名', 'success')
    } catch(e) {
      showMsg('重命名失败: ' + e.message, 'error')
    }
  }

  async function ctxRemoveFolder() {
    const folder = ctxMenu.value.item
    hideCtxMenu()
    await removeFolder(folder)
  }

  function ctxStartMoveFolder() {
    folderMoveNaming.value = true
    folderMoveTarget.value = ctxMenu.value.item?.parent || '/'
  }

  async function ctxConfirmMoveFolder() {
    const folder = ctxMenu.value.item
    const target = folderMoveTarget.value || '/'
    hideCtxMenu()
    await moveFolderTo(folder, target)
  }

  /*
  async function ctxCreateFolder() {
    hideCtxMenu()
    const raw = window.prompt('新建文件夹名称')
    const name = String(raw || '').trim()
    if (!name) return
    newFolderName.value = name
    await createCurrentFolder()
  }

  */

  function ctxStartCreateFolder() {
    ctxFolderNaming.value = true
    ctxFolderDraft.value = ''
  }

  async function ctxConfirmCreateFolder() {
    const name = String(ctxFolderDraft.value || '').trim()
    if (!name) {
      showMsg('请输入文件夹名称', 'error')
      return
    }
    hideCtxMenu()
    newFolderName.value = name
    await createCurrentFolder()
  }

  function triggerUpload() {
    hideCtxMenu()
    nextTick(() => {
      if (uploadInputRef.value) uploadInputRef.value.click()
    })
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
    loadStorage()
    loadFolders()
    loadProjectBindingOptions()
    loadList()
  })

  watch(() => props.trafficContext, payload => {
    applyProjectDeliveryContext(payload)
  }, { immediate: true })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })

  function handleKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'z') {
      e.preventDefault()
      runUndo()
    }
  }

  return {
    ALL_FOLDER,
    ALL_CATEGORY,
    materialType,
    typeLabels,
    typeExts,
    BGM_TAGS,
    EDIT_USE_TAGS,
    switchType,
    uploadInputRef,
    triggerUpload,
    categories,
    total,
    totalSize,
    storage,
    folders,
    folderTree,
    folderRows,
    visibleFolders,
    rootFolderStats,
    currentFolder,
    currentFolderLabel,
    parentFolder,
    breadcrumbItems,
    newFolderName,
    folderLoading,
    creatingFolder,
    loadFolders,
    selectFolder,
    goParentFolder,
    createCurrentFolder,
    removeFolder,
    loading,
    selectedCat,
    searchText,
    page,
    pageSize,
    sortBy,
    sortDir,
    viewMode,
    setViewMode,
    debouncedSearch,
    loadList,
    loadStorage,
    list,
    dragging,
    uploading,
    uploadPct,
    uploadCurrentPct,
    uploadCurrentName,
    uploadSpeedText,
    uploadEtaText,
    uploadQueueText,
    uploadMsg,
    uploadMsgType,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onFileSelect,
    deleteItem,
    openEdit,
    quickRenameMaterial,
    quickRenameFolder,
    openPreview,
    previewItem,
    downloadFile,
    editItem,
    editName,
    editCategory,
    editTagsStr,
    saving,
    aiTaggingId,
    saveEdit,
    runAiTag,
    applyQuickSearch,
    toggleUseTagForItem,
    materialUseTags,
    hasUseTag,
    formatDuration,
    formatSize,
    formatDate,
    selectCategory,
    changeSort,
    toggleSortDir,
    nextPage,
    prevPage,
    totalPages,
    selectedIds,
    selectedCount,
    selectedItems,
    folderOptions,
    detailItem,
    detailFolder,
    bulkMoving,
    bulkMoveTarget,
    bulkAiTagging,
    projectBinding,
    projectOptions,
    projectTaskOptions,
    bindProjectId,
    bindTaskId,
    projectBindingHint,
    folderMoveNaming,
    folderMoveTarget,
    openFolderMap,
    dragItem,
    dragFolder,
    dragOverFolder,
    undoStack,
    clipBasket,
    clipBasketItems,
    clipBasketCount,
    basketOpen,
    isSelected,
    toggleSelect,
    selectAllVisible,
    clearSelection,
    openDetail,
    openFolderDetail,
    closeDetail,
    toggleFolderOpen,
    isFolderOpen,
    hasFolderChildren,
    startDragItem,
    startDragFolder,
    clearDragState,
    dragOverFolderPath,
    dropItemToFolder,
    addToClipBasket,
    removeFromClipBasket,
    clearClipBasket,
    toggleBasketOpen,
    runUndo,
    batchDeleteSelected,
    batchMoveSelected,
    batchAiTagSelected,
    loadProjectBindingOptions,
    changeBindProject,
    batchBindProjectTask,
    ctxMenu,
    ctxFolderNaming,
    ctxFolderDraft,
    folderRenameNaming,
    folderRenameDraft,
    showBlankCtxMenu,
    showCardCtxMenu,
    showFolderCtxMenu,
    hideCtxMenu,
    ctxStartCreateFolder,
    ctxConfirmCreateFolder,
    ctxStartRenameFolder,
    ctxConfirmRenameFolder,
    ctxRemoveFolder,
    ctxStartMoveFolder,
    ctxConfirmMoveFolder,
    moveFolderTo,
    ctxDelete,
    ctxChangeCategory,
    showMsg
  }
}
