import { computed, ref } from 'vue'
import { generateComments, transcribeVideo, writeFeishu } from '../../api/tools'
import { extractBilibiliUrl } from './useBilibiliTranscription'
import { extractDouyinUrls } from './useDouyinTool'
import { cleanTranscriptText } from './textCleanup'
import { createDocxBlob } from '../../utils/docx'

const COMMENT_SCENARIO_DEFAULT = '成稿配套评论'
const DANMAKU_SCENARIO_DEFAULT = 'B站弹幕生成'

function cleanCommentText(value) {
  return String(value || '')
    .replace(/\uFFFD+/g, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
    .trim()
}

function removeKnownUrls(value) {
  return String(value || '')
    .replace(/(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/[^\s"'<>，。！？；：、）】》」』\])}]+/ig, '')
    .replace(/(?:https?:\/\/)?b23\.tv\/[^\s"'<>，。！？；：、）】》」』\])}]+/ig, '')
    .replace(/(?:https?:\/\/)?v\.douyin\.com\/[^\s"'<>，。！？；：、）】》」』\])}]+/ig, '')
    .replace(/(?:https?:\/\/)?(?:www\.)?douyin\.com\/(?:video|note)\/[^\s"'<>，。！？；：、）】》」』\])}]+/ig, '')
    .replace(/(?:https?:\/\/)?(?:www\.)?iesdouyin\.com\/share\/[^\s"'<>，。！？；：、）】》」』\])}]+/ig, '')
    .replace(/\bBV[0-9A-Za-z]{8,}\b/g, '')
    .trim()
}

function pickAccountName(data) {
  const pushAuthorCandidates = (target, value) => {
    if (!value) return
    if (typeof value === 'object') {
      target.push(value.nickname, value.name, value.author, value.authorName, value.userName, value.up, value.owner, value.account)
      return
    }
    target.push(value)
  }
  const candidates = [
    data?.nickname,
    data?.up,
    data?.user,
    data?.account,
    data?.author_name,
    data?.authorName,
    data?.creator
  ]
  pushAuthorCandidates(candidates, data?.author)
  pushAuthorCandidates(candidates, data?.owner)
  pushAuthorCandidates(candidates, data?.metadata?.author)
  pushAuthorCandidates(candidates, data?.aweme_info?.author)
  pushAuthorCandidates(candidates, data?.raw?.author)
  candidates.push(data?.title)
  if (Array.isArray(data?.items)) {
    data.items.forEach(item => {
      candidates.push(item?.nickname, item?.up, item?.user, item?.account)
      pushAuthorCandidates(candidates, item?.author)
      pushAuthorCandidates(candidates, item?.owner)
    })
  }
  for (const value of candidates) {
    if (!value) continue
    const text = String(value).replace(/\s*\(mid:\s*\d+\)\s*$/i, '').trim()
    if (text && text.length <= 40) return text
  }
  return ''
}

function cleanAccountCandidate(value) {
  const text = String(value || '')
    .replace(/^[@#\s]+/, '')
    .replace(/(的作品|的视频|的主页|发布的作品|发布的视频)$/g, '')
    .replace(/[，。！？、,.!?;:：；\s]+$/g, '')
    .trim()
  if (!text || text.length > 40) return ''
  if (/抖音|视频|评论|复制|打开|看看|链接|搜索|分享|客户端|推荐/.test(text)) return ''
  return text
}

function pickAccountNameFromInput(value) {
  const text = String(value || '').replace(/\r/g, '\n')
  const patterns = [
    /【([^】]{1,40}?)(?:的作品|的视频|的主页|发布的作品|发布的视频)】/,
    /(?:^|[\s，。:：])@([^\s，。:：|｜【】]{1,40})/,
    /(?:账号|账号名|作者|博主|达人|昵称)[:：]\s*([^\n，。]{1,40})/,
    /([^\s，。【】]{1,40}?)(?:的作品|的视频|的主页)/
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const name = cleanAccountCandidate(match && match[1])
    if (name) return name
  }
  return ''
}

export function useCommentTool(showToast) {
  const commentScript = ref('')
  const commentCount = ref(30)
  const commentMode = ref('comment')
  const activeTypeLabel = ref('评论')
  const commentScenario = ref(COMMENT_SCENARIO_DEFAULT)
  const danmakuEnabled = ref(false)
  const danmakuCount = ref(100)
  const commentAccountSel = ref('')
  const commentVideoUrl = ref('')
  const commentResult = ref(null)
  const danmakuResult = ref(null)
  const commentError = ref('')
  const commentLoading = ref(false)
  const commentPrefillLoading = ref(false)
  const commentAutoTranscribing = ref(false)
  const commentLoadingText = ref('生成中...')
  const commentSaving = ref(false)
  const commentWordSaving = ref(false)
  const commentDocUrl = ref('')
  const hasGeneratedItems = computed(() => Boolean(commentResult.value?.length || danmakuResult.value?.length))

  function buildCommentDocumentContent() {
    const accountName = commentAccountSel.value || '通用'
    const link = commentVideoUrl.value || '(未填链接)'
    const totalComments = commentResult.value?.length || 0
    const totalDanmaku = danmakuResult.value?.length || 0
    return [
      '账号名：' + accountName,
      '链接：' + link,
      '评论条数：' + totalComments + '条',
      '弹幕条数：' + totalDanmaku + '条',
      '',
      totalComments ? '评论：\n' + commentResult.value.map((c, i) => (i + 1) + '、' + c).join('\n') : '',
      totalDanmaku ? '\n弹幕：\n' + danmakuResult.value.map((c, i) => (i + 1) + '、' + c).join('\n') : ''
    ].join('\n')
  }

  function buildCommentDocumentTitle() {
    const accountName = commentAccountSel.value || '通用'
    const totalComments = commentResult.value?.length || 0
    const totalDanmaku = danmakuResult.value?.length || 0
    return accountName + '-自定义评论' + totalComments + '条' + (totalDanmaku ? '-弹幕' + totalDanmaku + '条' : '')
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function safeFileName(value) {
    return String(value || '评论素材')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80)
  }

  function detectCommentSourceUrl() {
    const source = [commentVideoUrl.value, commentScript.value].filter(Boolean).join('\n')
    const douyinUrl = extractDouyinUrls(source)[0] || ''
    if (douyinUrl) return { platform: 'douyin', url: douyinUrl }
    const bilibiliUrl = extractBilibiliUrl(source)
    if (bilibiliUrl) return { platform: 'bilibili', url: bilibiliUrl }
    return null
  }

  function canAutoFillAccount() {
    const current = String(commentAccountSel.value || '').trim()
    return !current || /^(通用|common|默认)$/i.test(current)
  }

  async function transcribeCommentSource(source) {
    commentAutoTranscribing.value = true
    commentLoadingText.value = source.platform === 'bilibili' ? 'B站转写中...' : '抖音转写中...'
    showToast('检测到仅填写链接，开始自动转写', 'info')

    if (source.platform === 'bilibili') {
      const data = await transcribeVideo('bilibili', source.url)
      if (data.error && !data.text) throw new Error(data.error || 'B站转写失败')
      if (canAutoFillAccount()) {
        const accountName = pickAccountName(data) || pickAccountNameFromInput([source.url, commentVideoUrl.value, commentScript.value].join('\n'))
        if (accountName) commentAccountSel.value = accountName
      }
      return data.text || ''
    }

    const data = await transcribeVideo('douyin', source.url)
    if (data.error && !data.text) throw new Error(data.error || '抖音转写失败')
    if (canAutoFillAccount()) {
      const accountName = pickAccountName(data) || pickAccountNameFromInput([source.url, commentVideoUrl.value, commentScript.value].join('\n'))
      if (accountName) commentAccountSel.value = accountName
    }
    return data.text || ''
  }

  async function prefillCommentFromLink(options = {}) {
    if (commentPrefillLoading.value || commentLoading.value && !options.allowDuringGeneration) return
    const source = detectCommentSourceUrl()
    if (!source) return
    const currentScript = cleanCommentText(commentScript.value)
    if (!canAutoFillAccount() && removeKnownUrls(currentScript)) return
    const accountFromInput = pickAccountNameFromInput([commentVideoUrl.value, commentScript.value].join('\n'))
    if (canAutoFillAccount() && accountFromInput) commentAccountSel.value = accountFromInput
    commentPrefillLoading.value = true
    try {
      commentVideoUrl.value = source.url
      const transcript = await transcribeCommentSource(source)
      const cleaned = cleanTranscriptText(transcript)
      if (cleaned && (!removeKnownUrls(currentScript) || options.replaceScript)) commentScript.value = cleaned
    } catch (e) {
      console.warn('[comment-tool] 自动读取链接信息失败：', e)
      showToast('B站/抖音转写失败：' + (e.message || '请稍后重试'), 'warn')
    } finally {
      commentPrefillLoading.value = false
      commentAutoTranscribing.value = false
      commentLoadingText.value = '生成中...'
    }
  }

  async function ensureCommentScript() {
    const currentScript = cleanCommentText(commentScript.value)
    const textWithoutUrls = removeKnownUrls(currentScript)
    if (textWithoutUrls) return currentScript

    const source = detectCommentSourceUrl()
    if (!source) return ''

    commentVideoUrl.value = source.url
    const transcript = await transcribeCommentSource(source)
    const cleaned = cleanTranscriptText(transcript)
    if (!cleaned) throw new Error('转写完成，但没有拿到可用文案')
    commentScript.value = cleaned
    showToast('已自动转写并清洗文案', 'success')
    return cleaned
  }

  async function requestCommentItems({ script, mode, count, scenario }) {
    if (!count) return []
    const data = await generateComments({
      script,
      count,
      scenario,
      account: commentAccountSel.value,
      videoUrl: commentVideoUrl.value,
      mode,
    })
    if (data.error) throw new Error(data.error)
    if (!data.comments) throw new Error('返回格式异常')
    const items = data.comments.map(cleanCommentText).filter(Boolean)
    if (!items.length) throw new Error('返回格式异常')
    return items
  }

  async function handleComment(mode = 'comment') {
    const onlyDanmaku = /弹幕|danmaku|barrage/i.test(String(mode || ''))
    commentMode.value = onlyDanmaku ? 'danmaku' : 'comment'
    activeTypeLabel.value = onlyDanmaku ? '弹幕' : '评论'
    if (!onlyDanmaku && (!commentScenario.value || commentScenario.value === DANMAKU_SCENARIO_DEFAULT)) {
      commentScenario.value = COMMENT_SCENARIO_DEFAULT
    }
    commentLoading.value = true
    commentAutoTranscribing.value = false
    commentLoadingText.value = '生成中...'
    commentResult.value = null
    danmakuResult.value = null
    commentError.value = ''
    commentDocUrl.value = ''
    try {
      await prefillCommentFromLink({ allowDuringGeneration: true })
      const script = await ensureCommentScript()
      if (!script) {
        showToast('请粘贴视频文案，或填写抖音/B站链接', 'error')
        return
      }
      if (onlyDanmaku) {
        commentLoadingText.value = '生成弹幕中...'
        danmakuResult.value = await requestCommentItems({
          script,
          count: Math.max(0, Math.min(300, Number(danmakuCount.value) || 0)),
          scenario: DANMAKU_SCENARIO_DEFAULT,
          mode: 'danmaku'
        })
        showToast('生成 ' + danmakuResult.value.length + ' 条弹幕', 'success')
        return
      }

      commentLoadingText.value = '生成评论中...'
      commentResult.value = await requestCommentItems({
        script,
        count: Math.max(5, Math.min(300, Number(commentCount.value) || 30)),
        scenario: commentScenario.value || COMMENT_SCENARIO_DEFAULT,
        mode: 'comment'
      })

      const nextDanmakuCount = Math.max(0, Math.min(300, Number(danmakuCount.value) || 0))
      if (danmakuEnabled.value && nextDanmakuCount > 0) {
        commentMode.value = 'danmaku'
        commentLoadingText.value = '生成弹幕中...'
        danmakuResult.value = await requestCommentItems({
          script,
          count: nextDanmakuCount,
          scenario: DANMAKU_SCENARIO_DEFAULT,
          mode: 'danmaku'
        })
      }
      commentMode.value = 'comment'
      showToast('生成 ' + commentResult.value.length + ' 条评论' + (danmakuResult.value?.length ? '、' + danmakuResult.value.length + ' 条弹幕' : ''), 'success')
    } catch (e) {
      commentError.value = e.message
      showToast(e.message || '请求失败', 'error')
    } finally {
      commentLoading.value = false
      commentAutoTranscribing.value = false
      commentLoadingText.value = '生成中...'
    }
  }

  async function handleCommentSave() {
    if (!hasGeneratedItems.value) return
    commentSaving.value = true
    try {
      const data = await writeFeishu({
        tool: 'docx',
        title: buildCommentDocumentTitle(),
        content: buildCommentDocumentContent()
      })
      if (data && data.code === 0 && data.doc_url) {
        commentDocUrl.value = data.doc_url
        showToast('已写入飞书', 'success')
      } else {
        showToast('写入飞书失败：' + (data?.msg || '未知错误'), 'error')
      }
    } catch (e) {
      showToast('写入飞书失败：' + (e.message || '未知错误'), 'error')
    } finally {
      commentSaving.value = false
    }
  }

  async function handleCommentWord() {
    if (!hasGeneratedItems.value) return
    commentWordSaving.value = true
    try {
      const title = buildCommentDocumentTitle()
      const accountName = commentAccountSel.value || '通用'
      const link = commentVideoUrl.value || '(未填链接)'
      const totalComments = commentResult.value?.length || 0
      const totalDanmaku = danmakuResult.value?.length || 0
      const paragraphs = [
        { text: title, bold: true, size: 32, spacingAfter: 220 },
        { text: '账号名称：' + accountName },
        { text: '链接：' + link },
        { text: '评论条数：' + totalComments + '条' },
        { text: '弹幕条数：' + totalDanmaku + '条', spacingAfter: 220 },
        ...(totalComments ? [
          { text: '评论', bold: true, spacingBefore: 120, spacingAfter: 120 },
          ...commentResult.value.map((comment, index) => ({
            text: (index + 1) + '、' + cleanCommentText(comment),
            spacingAfter: 120
          }))
        ] : []),
        ...(totalDanmaku ? [
          { text: '弹幕', bold: true, spacingBefore: 180, spacingAfter: 120 },
          ...danmakuResult.value.map((comment, index) => ({
            text: (index + 1) + '、' + cleanCommentText(comment),
            spacingAfter: 120
          }))
        ] : [])
      ]
      const blob = createDocxBlob(paragraphs)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = safeFileName(title) + '.docx'
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      showToast('Word docx 文件已下载', 'success')
    } catch (e) {
      showToast('生成 Word 失败：' + (e.message || '未知错误'), 'error')
    } finally {
      commentWordSaving.value = false
    }
  }

  return {
    commentScript,
    commentCount,
    commentMode,
    activeTypeLabel,
    commentScenario,
    danmakuEnabled,
    danmakuCount,
    commentAccountSel,
    commentVideoUrl,
    commentResult,
    danmakuResult,
    commentError,
    commentLoading,
    commentPrefillLoading,
    commentAutoTranscribing,
    commentLoadingText,
    commentSaving,
    commentWordSaving,
    commentDocUrl,
    hasGeneratedItems,
    handleComment,
    prefillCommentFromLink,
    handleCommentSave,
    handleCommentWord
  }
}
