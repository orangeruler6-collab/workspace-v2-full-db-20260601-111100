import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getCurrentAuthUser, request } from '../../api/client'
import { addIdea, addIdeaComment, deleteIdeaById, deleteIdeaComment, listIdeas, recordIdeaClick, toggleIdeaFavorite, updateIdea } from '../../api/ideas'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'

export const IDEA_TABS = [
  { key: 'all', label: '全部' },
  { key: 'favorites', label: '收藏' },
  { key: 'mine', label: '我的' },
  { key: 'douyin', label: '抖音' },
  { key: 'bilibili', label: 'B站' },
  { key: 'hot', label: '热点' },
]

function currentLoginUser() {
  const authUser = getCurrentAuthUser()
  if (authUser) return authUser.username || authUser.display_name || '匿名'
  try {
    const raw = localStorage.getItem('usagi_login')
    return raw ? JSON.parse(raw).user || '匿名' : '匿名'
  } catch (e) {
    return '匿名'
  }
}

function normalizeVideoUrl(url) {
  let value = String(url || '').trim()
  value = value.replace(/[)\]}>'"`.,!?;:\u3002\uff0c\uff01\uff1f\uff1b\uff1a\uff09\u3011\u300b\u3001]+$/g, '')
  if (/^BV[\w]{10}$/i.test(value)) return `https://www.bilibili.com/video/${value}`
  if (value && !/^https?:\/\//i.test(value)) value = 'https://' + value
  return value
}

export function extractVideoUrls(text) {
  const raw = String(text || '')
  const patterns = [
    /(?:https?:\/\/)?v\.douyin\.com\/[^\s"'<>\u4e00-\u9fa5]+/gi,
    /(?:https?:\/\/)?(?:www\.)?douyin\.com\/video\/\d+[^\s"'<>\u4e00-\u9fa5]*/gi,
    /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/BV[\w]+[^\s"'<>\u4e00-\u9fa5]*/gi,
    /(?:https?:\/\/)?b23\.tv\/[^\s"'<>\u4e00-\u9fa5]+/gi,
    /\bBV[\w]{10}\b/g,
  ]
  const urls = []
  const seen = new Set()
  const seenBvIds = new Set()
  for (const pattern of patterns) {
    const matches = raw.match(pattern) || []
    for (const match of matches) {
      const url = normalizeVideoUrl(match)
      const key = url.toLowerCase()
      const bvMatch = url.match(/\b(BV[\w]{10})\b/i)
      const bvKey = bvMatch ? bvMatch[1].toLowerCase() : ''
      if (bvKey && seenBvIds.has(bvKey)) continue
      if (url && !seen.has(key)) {
        seen.add(key)
        if (bvKey) seenBvIds.add(bvKey)
        urls.push(url)
      }
    }
  }
  return urls
}

export function extractVideoUrl(text) {
  return extractVideoUrls(text)[0] || ''
}

function getVideoPlatform(videoUrl) {
  const isBilibili = videoUrl.includes('bilibili.com') || videoUrl.includes('b23.tv')
  return isBilibili ? 'bilibili' : 'douyin'
}

export function useIdeaBoard() {
  const confirmAction = useConfirm()
  const { showToast } = useToast()
  const currentUser = ref(currentLoginUser())
  const ideas = ref([])
  const inputUrl = ref('')
  const inputNote = ref('')
  const parsing = ref(false)
  const parseError = ref('')
  const parseProgress = ref({
    total: 0,
    done: 0,
    failed: 0,
    current: ''
  })
  const activeTab = ref('all')
  const editingIdea = ref(null)
  const commentDrafts = ref({})
  const savingCommentIds = ref(new Set())
  const savingFavoriteIds = ref(new Set())
  const clickSavingIds = new Set()
  const lastClickAt = new Map()
  const commentMenu = ref({
    open: false,
    idea: null,
    x: 0,
    y: 0
  })
  const editForm = ref({
    id: '',
    platform: 'douyin',
    video_url: '',
    video_title: '',
    summary: '',
    note: '',
    tagsText: ''
  })
  const savingEdit = ref(false)
  let refreshTimer = null

  const filteredIdeas = computed(() => {
    let list = ideas.value
    if (activeTab.value === 'favorites') list = list.filter(item => item.is_favorited)
    if (activeTab.value === 'mine') list = list.filter(item => item.user_name === currentUser.value)
    if (activeTab.value === 'douyin') list = list.filter(item => item.platform === 'douyin')
    if (activeTab.value === 'bilibili') list = list.filter(item => item.platform === 'bilibili')
    if (activeTab.value === 'hot') list = list.filter(item => item.platform === 'hot')
    return list
  })

  const uniqueUsers = computed(() => new Set(ideas.value.map(item => item.user_name)).size)

  async function fetchIdeas() {
    try {
      const data = await listIdeas()
      if (data.ideas) {
        ideas.value = data.ideas.map(item => ({
          ...item,
          comments: Array.isArray(item.comments) ? item.comments : [],
          favorite_count: Number(item.favorite_count || 0),
          click_count: Number(item.click_count || 0),
          is_favorited: Boolean(item.is_favorited)
        }))
      }
    } catch(e) {
      showToast('创意加载失败：' + (e.message || '请稍后重试'), 'error')
    }
  }

  async function doParseSingle() {
    if (!inputUrl.value.trim()) return
    parsing.value = true
    parseError.value = ''

    const rawInput = inputUrl.value.trim()
    const videoUrl = extractVideoUrl(rawInput)
    if (!videoUrl) {
      parseError.value = '未检测到视频链接，请输入包含抖音或B站链接的文本'
      parsing.value = false
      return
    }

    const note = rawInput.replace(videoUrl, '').trim() || inputNote.value.trim()
    let timer = null
    try {
      const isBilibili = videoUrl.includes('bilibili.com') || videoUrl.includes('b23.tv')
      const platform = isBilibili ? 'bilibili' : 'douyin'
      const transcribeApi = isBilibili ? '/api/transcribe/bilibili' : '/api/transcribe/douyin'
      const timeoutMs = isBilibili ? 300000 : 180000

      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), timeoutMs)
      const data = await request(transcribeApi, {
        method: 'POST',
        body: { url: videoUrl },
        signal: controller.signal
      })
      clearTimeout(timer)
      timer = null
      if (!data.text) {
        parseError.value = data.error || '解析失败'
        parsing.value = false
        return
      }

      const fullText = data.text || ''
      const aiData = await request('/api/chat-minimax', {
        method: 'POST',
        body: {
          system: '你是一个短视频内容分析专家。从视频转写文本中提取信息，输出JSON格式：\n{ "short_title": "8字以内的爆款标题", "summary": "50字以内的视频内容总结", "tags": ["标签1", "标签2", "标签3"] }\n要求：标题要有吸引力，标签精准。只输出JSON，不要其他内容。',
          message: '视频链接：' + videoUrl + '\n\n转写文本：\n' + fullText.substring(0, 3000)
        }
      })
      let shortTitle = ''
      let summary = ''
      let tags = []

      try {
        const match = aiData.reply.match(/\{[\s\S]*\}/)
        if (match) {
          const parsed = JSON.parse(match[0])
          shortTitle = parsed.short_title || ''
          summary = parsed.summary || ''
          tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4) : []
        }
      } catch(e) {}

      if (!shortTitle) shortTitle = platform === 'bilibili' ? 'B站视频' : '抖音视频'
      if (!summary) summary = fullText.substring(0, 200).trim()

      const createData = await addIdea({
        user_name: currentUser.value,
        platform,
        video_url: videoUrl,
        video_title: shortTitle,
        summary,
        tags,
        note,
      })
      if (createData.id) {
        await fetchIdeas()
        inputUrl.value = ''
        inputNote.value = ''
      } else {
        parseError.value = createData.error || '保存失败'
      }
    } catch(e) {
      if (timer) clearTimeout(timer)
      parseError.value = e.name === 'AbortError' ? '请求超时' : '网络错误：' + e.message
    } finally {
      parsing.value = false
    }
  }

  async function transcribeAndSaveIdea(videoUrl, note) {
    let timer = null
    try {
      const platform = getVideoPlatform(videoUrl)
      const isBilibili = platform === 'bilibili'
      const transcribeApi = isBilibili ? '/api/transcribe/bilibili' : '/api/transcribe/douyin'
      const timeoutMs = isBilibili ? 900000 : 300000

      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), timeoutMs)
      const data = await request(transcribeApi, {
        method: 'POST',
        body: { url: videoUrl },
        signal: controller.signal
      })
      clearTimeout(timer)
      timer = null
      if (!data.text) throw new Error(data.error || '解析失败')

      const fullText = data.text || ''
      const aiData = await request('/api/chat-minimax', {
        method: 'POST',
        body: {
          system: '你是一个短视频内容分析专家。从视频转写文本中提取信息，输出JSON格式：\n{ "short_title": "8字以内的爆款标题", "summary": "50字以内的视频内容总结", "tags": ["标签1", "标签2", "标签3"] }\n要求：标题要有吸引力，标签精准。只输出JSON，不要其他内容。',
          message: '视频链接：' + videoUrl + '\n\n转写文本：\n' + fullText.substring(0, 3000)
        }
      })
      let shortTitle = ''
      let summary = ''
      let tags = []

      try {
        const match = aiData.reply.match(/\{[\s\S]*\}/)
        if (match) {
          const parsed = JSON.parse(match[0])
          shortTitle = parsed.short_title || ''
          summary = parsed.summary || ''
          tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4) : []
        }
      } catch(e) {}

      if (!shortTitle) shortTitle = platform === 'bilibili' ? 'B站视频' : '抖音视频'
      if (!summary) summary = fullText.substring(0, 200).trim()

      const createData = await addIdea({
        user_name: currentUser.value,
        platform,
        video_url: videoUrl,
        video_title: shortTitle,
        summary,
        tags,
        note,
      })
      if (!createData.id) throw new Error(createData.error || '保存失败')
      return createData
    } catch(e) {
      if (timer) clearTimeout(timer)
      throw e
    }
  }

  async function doParse() {
    const rawInput = inputUrl.value.trim()
    if (!rawInput) return

    const videoUrls = extractVideoUrls(rawInput)
    if (!videoUrls.length) {
      parseError.value = '未检测到视频链接，请粘贴抖音或B站链接'
      return
    }

    const inlineNote = videoUrls.length === 1 ? rawInput.replace(extractVideoUrl(rawInput), '').trim() : ''
    const note = inputNote.value.trim() || inlineNote
    parsing.value = true
    parseError.value = ''
    parseProgress.value = {
      total: videoUrls.length,
      done: 0,
      failed: 0,
      current: ''
    }

    const failures = []
    try {
      for (const videoUrl of videoUrls) {
        parseProgress.value = {
          ...parseProgress.value,
          current: videoUrl
        }
        try {
          await transcribeAndSaveIdea(videoUrl, note)
        } catch (e) {
          failures.push({ url: videoUrl, message: e.name === 'AbortError' ? '请求超时' : e.message || '处理失败' })
          parseProgress.value = {
            ...parseProgress.value,
            failed: failures.length
          }
        } finally {
          parseProgress.value = {
            ...parseProgress.value,
            done: parseProgress.value.done + 1
          }
        }
      }

      await fetchIdeas()
      const successCount = videoUrls.length - failures.length
      if (successCount > 0) {
        inputUrl.value = ''
        inputNote.value = ''
        showToast(`已保存 ${successCount} 条创意${failures.length ? `，${failures.length} 条失败` : ''}`, failures.length ? 'info' : 'success')
      }
      if (failures.length) {
        parseError.value = `有 ${failures.length} 条没有处理成功：` + failures.map(item => item.message).join('；')
      }
    } catch(e) {
      parseError.value = e.name === 'AbortError' ? '请求超时' : '网络错误：' + e.message
    } finally {
      parsing.value = false
      parseProgress.value = {
        ...parseProgress.value,
        current: ''
      }
    }
  }

  async function deleteIdea(id) {
    const ok = await confirmAction({
      title: '删除创意',
      message: '确认删除这条创意？删除后团队创意墙里将不再显示。',
      confirmText: '删除',
      type: 'danger'
    })
    if (!ok) return
    try {
      const authUser = getCurrentAuthUser()
      await deleteIdeaById(id, authUser?.role === 'admin' ? '' : currentUser.value)
      await fetchIdeas()
    } catch(e) {
      showToast('删除失败：' + (e.message || '请稍后重试'), 'error')
    }
  }

  function canEditIdea(idea) {
    const authUser = getCurrentAuthUser()
    return !!idea && (idea.user_name === currentUser.value || authUser?.role === 'admin')
  }

  function canDeleteComment(comment) {
    const authUser = getCurrentAuthUser()
    return !!comment && (comment.user_name === currentUser.value || authUser?.role === 'admin')
  }

  function commentBubbleStyle(index) {
    const positions = [
      { transform: 'rotate(-2deg)', marginLeft: '2px' },
      { transform: 'rotate(2.4deg)', marginLeft: '18px' },
      { transform: 'rotate(-1.2deg)', marginLeft: '9px' },
      { transform: 'rotate(1.5deg)', marginLeft: '28px' }
    ]
    return positions[index % positions.length]
  }

  function openCommentMenu(idea, event) {
    if (!idea || !event) return
    event.preventDefault()
    commentMenu.value = {
      open: true,
      idea,
      x: Math.min(event.clientX || 0, Math.max(16, window.innerWidth - 340)),
      y: Math.min(event.clientY || 0, Math.max(16, window.innerHeight - 190))
    }
  }

  function closeCommentMenu() {
    commentMenu.value = {
      open: false,
      idea: null,
      x: 0,
      y: 0
    }
  }

  async function submitIdeaComment(idea) {
    if (!idea?.id) return
    const text = String(commentDrafts.value[idea.id] || '').trim()
    if (!text) return
    if (text.length > 80) {
      showToast('评价控制在 80 字以内会更像便签', 'error')
      return
    }
    const nextSaving = new Set(savingCommentIds.value)
    nextSaving.add(idea.id)
    savingCommentIds.value = nextSaving
    try {
      const data = await addIdeaComment({
        idea_id: idea.id,
        user_name: currentUser.value,
        text
      })
      if (data.error || !data.comment) {
        showToast(data.error || '评价失败', 'error')
        return
      }
      const target = ideas.value.find(item => item.id === idea.id)
      if (target) {
        target.comments = Array.isArray(target.comments) ? target.comments.concat(data.comment) : [data.comment]
      }
      commentDrafts.value = { ...commentDrafts.value, [idea.id]: '' }
      closeCommentMenu()
      showToast('评价已贴到创意旁边', 'success')
    } catch(e) {
      showToast('评价失败：' + (e.message || '网络异常'), 'error')
    } finally {
      const doneSaving = new Set(savingCommentIds.value)
      doneSaving.delete(idea.id)
      savingCommentIds.value = doneSaving
    }
  }

  async function removeIdeaComment(comment) {
    if (!comment?.id) return
    try {
      const authUser = getCurrentAuthUser()
      const data = await deleteIdeaComment(comment.id, authUser?.role === 'admin' ? '' : currentUser.value)
      if (data.error || data.deleted === 0) {
        showToast(data.error || '删除评价失败', 'error')
        return
      }
      ideas.value = ideas.value.map(idea => ({
        ...idea,
        comments: (idea.comments || []).filter(item => item.id !== comment.id)
      }))
    } catch(e) {
      showToast('删除评价失败：' + (e.message || '网络异常'), 'error')
    }
  }

  function isSavingComment(ideaId) {
    return savingCommentIds.value.has(ideaId)
  }

  function isSavingFavorite(ideaId) {
    return savingFavoriteIds.value.has(ideaId)
  }

  async function recordClick(idea) {
    if (!idea?.id) return
    const now = Date.now()
    const last = lastClickAt.get(idea.id) || 0
    if (now - last < 800 || clickSavingIds.has(idea.id)) return
    lastClickAt.set(idea.id, now)
    clickSavingIds.add(idea.id)
    const previousCount = Number(idea.click_count || 0)
    idea.click_count = previousCount + 1
    try {
      const data = await recordIdeaClick(idea.id)
      if (data.error) throw new Error(data.error)
      idea.click_count = Number(data.click_count || idea.click_count || 0)
    } catch (e) {
      idea.click_count = previousCount
    } finally {
      clickSavingIds.delete(idea.id)
    }
  }

  async function toggleFavorite(idea) {
    if (!idea?.id || isSavingFavorite(idea.id)) return
    const previousFavorited = Boolean(idea.is_favorited)
    const previousCount = Number(idea.favorite_count || 0)
    const nextSaving = new Set(savingFavoriteIds.value)
    nextSaving.add(idea.id)
    savingFavoriteIds.value = nextSaving
    idea.is_favorited = !previousFavorited
    idea.favorite_count = Math.max(0, previousCount + (idea.is_favorited ? 1 : -1))
    try {
      const data = await toggleIdeaFavorite(idea.id, idea.is_favorited)
      if (data.error) throw new Error(data.error)
      idea.is_favorited = Boolean(data.is_favorited)
      idea.favorite_count = Number(data.favorite_count || 0)
    } catch (e) {
      idea.is_favorited = previousFavorited
      idea.favorite_count = previousCount
      showToast('收藏失败：' + (e.message || '请稍后重试'), 'error')
    } finally {
      const doneSaving = new Set(savingFavoriteIds.value)
      doneSaving.delete(idea.id)
      savingFavoriteIds.value = doneSaving
    }
  }

  function openEditIdea(idea) {
    editingIdea.value = idea
    editForm.value = {
      id: idea.id,
      platform: idea.platform || 'douyin',
      video_url: idea.video_url || '',
      video_title: idea.video_title || '',
      summary: idea.summary || '',
      note: idea.note || '',
      tagsText: Array.isArray(idea.tags) ? idea.tags.join(', ') : ''
    }
  }

  function closeEditIdea() {
    editingIdea.value = null
    savingEdit.value = false
  }

  async function saveIdeaEdit() {
    const form = editForm.value
    if (!form.video_url.trim()) {
      showToast('请填写视频链接', 'error')
      return
    }
    savingEdit.value = true
    try {
      const tags = form.tagsText
        .split(/[,，\n]/)
        .map(tag => tag.trim())
        .filter(Boolean)
        .slice(0, 8)
      const data = await updateIdea({
        id: form.id,
        platform: form.platform,
        video_url: form.video_url.trim(),
        video_title: form.video_title.trim(),
        summary: form.summary.trim(),
        note: form.note.trim(),
        tags
      })
      if (data.error || data.updated === 0) {
        showToast(data.error || '没有更新权限或记录不存在', 'error')
        return
      }
      closeEditIdea()
      fetchIdeas().catch(() => {})
      showToast('创意已更新', 'success')
    } catch(e) {
      showToast('保存失败：' + (e.message || '未知错误'), 'error')
    } finally {
      savingEdit.value = false
    }
  }

  function getAvatar(name) {
    const emojis = ['🐰', '🌸', '🌙', '⭐', '🔥', '💎', '🎮', '🎯']
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
    return emojis[Math.abs(hash) % emojis.length]
  }

  function platformLabel(platform) {
    if (platform === 'bilibili') return '📺 B站'
    if (platform === 'hot') return '热点'
    return '🎵 抖音'
  }

  function formatTime(ts) {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }

  onMounted(() => {
    fetchIdeas()
    refreshTimer = setInterval(fetchIdeas, 30000)
  })

  onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer)
  })

  return {
    activeTab,
    canEditIdea,
    canDeleteComment,
    closeEditIdea,
    commentBubbleStyle,
    commentDrafts,
    commentMenu,
    currentUser,
    deleteIdea,
    doParse,
    editForm,
    editingIdea,
    filteredIdeas,
    formatTime,
    getAvatar,
    platformLabel,
    ideas,
    inputNote,
    inputUrl,
    parseError,
    parseProgress,
    parsing,
    removeIdeaComment,
    saveIdeaEdit,
    savingEdit,
    submitIdeaComment,
    isSavingComment,
    isSavingFavorite,
    openEditIdea,
    openCommentMenu,
    recordClick,
    toggleFavorite,
    closeCommentMenu,
    tabs: IDEA_TABS,
    uniqueUsers
  }
}
