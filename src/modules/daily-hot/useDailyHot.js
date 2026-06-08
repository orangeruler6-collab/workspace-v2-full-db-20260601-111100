import { computed, onMounted, ref } from 'vue'
import { listDailyHot, refreshDailyHot } from '../../api/dailyHot'

function todayKey() {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-')
}

function yesterdayKey() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-')
}

function adjustDate(days) {
  const d = new Date(date.value)
  d.setDate(d.getDate() + days)
  date.value = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-')
  fetchList()
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''))
}

export function useDailyHot(showToast) {
  const date = ref(todayKey())
  const items = ref([])
  const stats = ref({})
  const loading = ref(false)
  const refreshing = ref(false)
  const lastUpdatedAt = ref(0)
  const sourceFilter = ref('all')
  const categoryFilter = ref('all')

  const categories = computed(() => {
    const names = new Set(items.value.map(item => item.category || '其他'))
    return Array.from(names).sort()
  })

  const sources = computed(() => {
    const names = new Set(items.value.map(item => item.sourceLabel || item.source || '未知来源'))
    return Array.from(names).sort()
  })

  const filteredItems = computed(() => {
    return items.value.filter(item => {
      if (categoryFilter.value !== 'all' && (item.category || '其他') !== categoryFilter.value) return false
      if (sourceFilter.value !== 'all' && (item.sourceLabel || item.source || '未知来源') !== sourceFilter.value) return false
      return true
    })
  })

  const categoryBars = computed(() => makeBars(countBy(filteredItems.value, item => item.category || '其他')))
  const sourceBars = computed(() => makeBars(countBy(filteredItems.value, item => item.sourceLabel || item.source || '未知来源')))
  const overview = computed(() => ({
    total: filteredItems.value.length,
    sources: new Set(filteredItems.value.map(item => item.sourceLabel || item.source || '未知来源')).size,
    categories: new Set(filteredItems.value.map(item => item.category || '其他')).size
  }))
  const keywords = computed(() => {
    const counts = {}
    filteredItems.value.forEach(item => {
      ;(item.tags || []).forEach(tag => {
        const key = String(tag || '').trim()
        if (!key) return
        counts[key] = (counts[key] || 0) + 1
      })
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count], index) => ({ name, count, featured: index === 0 }))
  })
  const qualityReview = computed(() => {
    const list = filteredItems.value
    const total = list.length
    const sourceTypes = {
      article: list.filter(item => item.source === 'article').length,
      opencli: list.filter(item => /^opencli-/i.test(String(item.source || ''))).length,
      manual: list.filter(item => item.source === 'manual').length
    }
    const lowContext = list.filter(item => !String(item.snippet || '').trim()).length
    const lowScore = list.filter(item => Number(item.score) > 0 && Number(item.score) < 45).length
    const keywordHits = keywords.value.reduce((sum, word) => sum + (word.count || 0), 0)
    const keywordCoverage = total ? Math.min(100, Math.round((keywordHits / Math.max(1, total)) * 100)) : 0
    const openCliRatio = total ? Math.round((sourceTypes.opencli / total) * 100) : 0
    const articleRatio = total ? Math.round((sourceTypes.article / total) * 100) : 0
    const notes = []

    if (!total) notes.push('暂无可复核内容')
    if (sourceTypes.opencli === 0) notes.push('OpenCLI 暂无入库内容，注意检查采集源')
    if (openCliRatio > 45) notes.push('OpenCLI 占比较高，建议人工扫一遍相关性')
    if (articleRatio > 85) notes.push('文章源占比偏高，短视频趋势可能不足')
    if (lowContext >= Math.max(3, Math.ceil(total * 0.18))) notes.push('缺摘要条目偏多，生成前要多看原文')
    if (lowScore >= Math.max(2, Math.ceil(total * 0.12))) notes.push('低热度候选较多，可优先使用前排内容')
    if (!notes.length) notes.push('结构正常，可以按前排热点继续推进')

    return {
      total,
      sourceTypes,
      lowContext,
      lowScore,
      keywordCoverage,
      openCliRatio,
      articleRatio,
      notes: notes.slice(0, 3)
    }
  })
  const lastUpdatedLabel = computed(() => {
    const latest = Number(lastUpdatedAt.value) || filteredItems.value.reduce((max, item) => Math.max(max, Number(item.capturedAt) || 0), 0)
    if (!latest) return '暂无更新'
    const d = new Date(latest)
    return '最近更新 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  })

  function makeBars(map) {
    const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1])
    const max = entries[0]?.[1] || 1
    return entries.slice(0, 8).map(([name, count]) => ({
      name,
      count,
      width: Math.max(8, Math.round((count / max) * 100))
    }))
  }

  function countBy(list, getKey) {
    return list.reduce((acc, item) => {
      const key = getKey(item)
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
  }

  function applyData(data) {
    items.value = (data.items || []).filter(isWebContentItem)
    stats.value = data.stats || {}
    lastUpdatedAt.value = Number(data.refreshedAt || data.stats?.refreshedAt) || (data.items || []).reduce((max, item) => Math.max(max, Number(item.capturedAt) || 0), 0)
  }

  async function fetchList() {
    loading.value = true
    try {
      const data = await listDailyHot(date.value)
      applyData(data)
    } catch (e) {
      showToast('每日热点加载失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    refreshing.value = true
    try {
      const data = await refreshDailyHot({
        date: date.value,
        sources: ['article'],
        opencliLimit: 0
      })
      applyData(data)
      showToast('已更新 ' + (data.items?.length || 0) + ' 条热点', 'success')
    } catch (e) {
      showToast('热点更新失败：' + e.message, 'error')
    } finally {
      refreshing.value = false
    }
  }

  function openHotLink(item) {
    if (!isHttpUrl(item?.url)) return
    window.open(item.url, '_blank', 'noopener')
  }

  function jumpToCopygen(item) {
    if (!item) return
    const prefill = {
      requirement: '基于热点「' + item.title + '」生成一条可发布文案',
      material: [
        '热点标题：' + item.title,
        item.snippet ? '摘要：' + item.snippet : '',
        item.category ? '分类：' + item.category : '',
        item.sourceLabel ? '来源：' + item.sourceLabel : '',
        isHttpUrl(item.url) ? '链接：' + item.url : ''
      ].filter(Boolean).join('\n')
    }
    const writerPrefill = {
      mode: 'topic',
      prompt: '基于热点「' + item.title + '」写一条可发布的短视频文案，保留事实信息，给出清晰观点和口播节奏。',
      sourceText: prefill.material || ''
    }
    localStorage.setItem('usagi_style_writer_prefill', JSON.stringify(writerPrefill))
    window.dispatchEvent(new CustomEvent('usagi:style-writer-prefill', { detail: writerPrefill }))
    window.dispatchEvent(new CustomEvent('usagi:navigate', { detail: { module: 'styleWriter' } }))
  }

  function heatWidth(score) {
    return Math.max(8, Math.min(100, Math.round((Number(score) || 0) / 2)))
  }

  function hasLink(item) {
    return isHttpUrl(item?.url)
  }

  function isWebContentItem(item) {
    if (!item) return false
    if (/^opencli-/i.test(String(item.source || ''))) return false
    return item.source === 'article' || isHttpUrl(item.url)
  }

  onMounted(fetchList)

  return {
    categoryBars,
    categoryFilter,
    categories,
    date,
    fetchList,
    filteredItems,
    hasLink,
    heatWidth,
    items,
    jumpToCopygen,
    keywords,
    qualityReview,
    lastUpdatedLabel,
    loading,
    openHotLink,
    overview,
    refresh,
    refreshing,
    sourceBars,
    sourceFilter,
    sources,
    stats,
    adjustDate,
    todayKey,
    yesterdayKey
  }
}
