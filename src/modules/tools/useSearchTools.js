import { computed, reactive, ref, watch } from 'vue'

export const DOUYIN_STANDARDS = [
  ['花无缺', 12250, 408333, 20000, 200, 300, 200, 4716, 61.5, 5595, 54.33, 1895, 84.53],
  ['尼大木', 7000, 233333, 20000, 200, 300, 200, 3753, 46.38, 5070, 27.57, 1370, 80.43],
  ['苏大强', 5600, 186667, 20000, 200, 300, 200, 3497, 37.56, 4930, 11.96, 1230, 78.04],
  ['天机妹', 10500, 350000, 20000, 200, 300, 200, 4395, 58.14, 5420, 48.38, 1720, 83.62],
  ['麦晓花', 3360, 112000, 10000, 200, 300, 200, 1986, 40.89, 2061, 38.66, 806, 76.01],
  ['最翁说游', 9310, 310333, 20000, 200, 300, 200, 4177, 55.14, 5301, 43.06, 1601, 82.8],
  ['报告砖家', 9975, 332500, 20000, 200, 300, 200, 4299, 56.9, 5368, 46.19, 1668, 83.28],
  ['麦冬冬', 7000, 233333, 20000, 200, 300, 200, 3753, 46.38, 5070, 27.57, 1370, 80.43],
  ['超玩教授', 2240, 74667, 10000, 200, 300, 200, 1781, 20.51, 1949, 12.99, 694, 69.02],
  ['葵仔不想肝', 3500, 116667, 10000, 200, 300, 200, 2012, 42.52, 2075, 40.71, 820, 76.57],
  ['薛定谔的机', 6076, 202533, 10000, 200, 300, 200, 2484, 59.12, 3878, 36.18, 1078, 82.26],
  ['游热娃子', 4900, 163333, 10000, 100, 200, 100, 2138, 56.36, 2690, 45.1, 830, 83.06],
  ['游小妹', 5600, 186667, 10000, 100, 200, 100, 2267, 59.52, 2760, 50.71, 900, 83.93],
  ['灵梦小师妹', 3600, 120000, 10000, 100, 200, 100, 1900, 47.22, 2060, 42.78, 700, 80.56],
  ['lee小强', 1400, 46667, 5000, 100, 200, 100, 947, 32.38, 1090, 22.14, 380, 72.86],
  ['不玩就分手', 2450, 81667, 5000, 100, 200, 100, 1139, 53.5, 1195, 51.22, 485, 80.2],
  ['网瘾少女一条', 4200, 140000, 10000, 100, 200, 100, 2010, 52.14, 2620, 37.62, 760, 81.9],
  ['中二探长', 2100, 70000, 5000, 100, 200, 100, 1075, 48.81, 1160, 44.76, 450, 78.57],
  ['沙雕101', 3500, 116667, 5000, 100, 200, 100, 1332, 61.95, 2000, 42.86, 590, 83.14],
  ['嘿小虎', 2100, 70000, 3000, 100, 200, 100, 855, 59.29, 940, 55.24, 410, 80.48],
  ['有事找学姐', 3920, 130667, 3000, 100, 200, 100, 1189, 69.68, 1122, 71.38, 592, 84.9],
  ['花蛮楼', 4500, 150000, 5000, 100, 200, 100, 1515, 66.33, 1400, 68.89, 690, 84.67],
  ['游点慌', 3600, 120000, 5000, 100, 200, 100, 1350, 62.5, 1310, 63.61, 600, 83.33],
  ['饭十七', 3780, 126000, 3000, 100, 200, 100, 1163, 69.23, 1108, 70.69, 578, 84.71],
  ['跑腿的包子', 3500, 116667, 5000, 100, 200, 100, 1332, 61.95, 1300, 62.86, 590, 83.14],
  ['雷鸭fist', 5600, 186667, 5000, 100, 200, 100, 1717, 69.35, 1510, 73.04, 800, 85.71],
  ['痞仔伯爵', 5180, 172667, 5000, 100, 200, 100, 1640, 68.35, 1468, 71.66, 758, 85.37],
  ['爱数码的老李', 4130, 137667, 5000, 100, 200, 100, 1447, 64.96, 1363, 67, 653, 84.19],
  ['游侠蹦蹦', 3000, 100000, 3000, 100, 200, 100, 1020, 66, 1030, 65.67, 500, 83.33],
  ['夏洛', 3000, 100000, 3000, 100, 200, 100, 1020, 66, 1030, 65.67, 500, 83.33],
  ['畅玩百晓生', 3000, 100000, 3000, 100, 200, 100, 1020, 66, 1030, 65.67, 500, 83.33],
  ['游戏永动机', 3000, 100000, 3000, 100, 200, 100, 1020, 66, 1030, 65.67, 500, 83.33],
  ['皮皮说游戏', 3000, 100000, 3000, 100, 200, 100, 1020, 66, 1030, 65.67, 500, 83.33]
].map(([account, price, plays, likes, comments, favorites, shares, premiumCost, premiumMargin, douCost, douMargin, privateCost, privateMargin]) => ({
  account,
  price,
  plays,
  likes,
  comments,
  favorites,
  shares,
  premiumCost,
  premiumMargin,
  douCost,
  douMargin,
  privateCost,
  privateMargin
}))

export const BILIBILI_STANDARDS = [
  ['痞仔伯爵', 24000, 80000, 1000, 200, 300, 70, 70, 150, 8000, 8540, 51.53],
  ['暴走星号键', 16000, 53333, 1000, 100, 200, 50, 50, 150, 5333, 5730, 51.35],
  ['雷鸭Fist', 12800, 42667, 800, 100, 200, 50, 50, 100, 4267, 4593, 51.29],
  ['王路飞cp', 12000, 40000, 1000, 100, 200, 50, 50, 150, 4000, 4344, 51.04],
  ['情风师兄', 15200, 50667, 1000, 100, 200, 50, 50, 150, 5067, 5453, 51.3],
  ['上官北', 11200, 37333, 800, 100, 200, 50, 50, 100, 3733, 4039, 51.15],
  ['李野王SG', 20000, 66667, 1000, 200, 300, 70, 70, 150, 6667, 7154, 51.39],
  ['硬件侠', 15000, 50000, 800, 100, 200, 50, 50, 100, 5000, 5356, 48.22],
  ['游电工厂', 16000, 53333, 800, 100, 200, 50, 50, 100, 5333, 5703, 51.49],
  ['小张同学', 11200, 37333, 800, 100, 200, 50, 50, 100, 3733, 4039, 51.15],
  ['跑腿的包子', 16000, 53333, 800, 100, 200, 50, 50, 100, 5333, 5703, 51.49],
  ['团子好贵', 8000, 26667, 500, 60, 100, 30, 50, 50, 2667, 2867, 51.33],
  ['薛定谔的机-', 8000, 26667, 500, 60, 100, 30, 50, 50, 2667, 2867, 51.33],
  ['中二探长', 16000, 53333, 800, 100, 200, 50, 50, 100, 5333, 5703, 51.49],
  ['夏天丶Cat', 8000, 26667, 500, 60, 100, 30, 50, 50, 2667, 2867, 51.33]
].map(([account, price, plays, likes, coins, favorites, comments, shares, danmaku, bihuo, cost, margin]) => ({
  account,
  price,
  plays,
  likes,
  coins,
  favorites,
  comments,
  shares,
  danmaku,
  bihuo,
  cost,
  margin
}))

const ACCOUNT_PROFILES = {
  天机妹: { douyinId: '783586217', uid: '96439098937', xtId: '', cooperationCode: '85729365814' },
  麦晓花: { douyinId: 'maihua12345678', uid: '3865503336239772', xtId: '6823619490735980552', cooperationCode: '16641924918' },
  有事找学姐: { douyinId: '2142588510', uid: '83991008833', xtId: '6687444049818812420', cooperationCode: '12753698611' },
  花蛮楼: { douyinId: 'huaml12345678', uid: '4133752889687031', xtId: '6920170232069750791', cooperationCode: '28784178590' },
  中二探长: { douyinId: '2068472561', uid: '237914238758142', xtId: '', cooperationCode: '22542874010' },
  张三说书: { douyinId: '', uid: '', xtId: '', cooperationCode: '' },
  夏天丶cat: { douyinId: '', uid: '', xtId: '', cooperationCode: '' },
  夏天丶Cat: { douyinId: '', uid: '', xtId: '', cooperationCode: '' }
}

const PROFILE_STORAGE_KEY = 'usagi_maintenance_account_profiles'

function toMoney(value) {
  const n = Number(value || 0)
  return n ? Math.round(n).toLocaleString('zh-CN') : '0'
}

function toPercent(value) {
  return Number(value || 0).toFixed(2) + '%'
}

function scaleCount(base, ratio) {
  return Math.max(0, Math.round(Number(base || 0) * ratio))
}

function buildMaintenancePhaseLines(result) {
  if (!result?.phases?.length) return []
  return [
    `分期投放：共 ${result.phases.length} 期，合计 ${toMoney(result.amount)} 元。`,
    ...result.phases.map((phase, index) => {
      return `${phase.name || `第${index + 1}期`}：占比 ${toPercent(phase.percent)}，预计 ${toMoney(phase.amount)} 元，播放和互动按同等比例拆分跟进。`
    })
  ]
}

function buildMaintenanceApplicationPhaseLines(result) {
  if (!result?.phases?.length) return []
  return [
    `投放分期：${result.phases.length}期，合计${toMoney(result.amount)}元`,
    ...result.phases.map((phase, index) => `${phase.name || `第${index + 1}期`}：${toPercent(phase.percent)}，约${toMoney(phase.amount)}元`)
  ]
}

function normalizeAccountName(name) {
  const text = String(name || '').trim()
  if (text.toLowerCase() === 'lee小强') return 'lee小强'
  if (text.toLowerCase() === '雷鸭fist') return '雷鸭fist'
  return text
}

function loadProfiles() {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}')
    const cleaned = sanitizeProfiles({ ...ACCOUNT_PROFILES, ...stored })
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(cleaned))
    return cleaned
  } catch (e) {
    return { ...ACCOUNT_PROFILES }
  }
}

function saveProfiles(profiles) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(sanitizeProfiles(profiles)))
}

function sanitizeProfiles(profiles) {
  return Object.fromEntries(Object.entries(profiles || {}).map(([account, profile]) => [account, {
    douyinId: profile?.douyinId || '',
    uid: profile?.uid || '',
    xtId: profile?.xtId || '',
    cooperationCode: profile?.cooperationCode || ''
  }]))
}

export function useSearchTools(showToast) {
  const maintenancePlatform = ref('douyin')
  const maintenanceAccount = ref('中二探长')
  const maintenanceAmount = ref(2625)
  const maintenanceUsePhases = ref(false)
  const maintenancePhases = reactive([
    { name: '第1期', percent: 60 },
    { name: '第2期', percent: 40 }
  ])
  const maintenanceOrderType = ref('platform')
  const maintenanceVideoUrl = ref('')
  const maintenanceNeedDou = ref(false)
  const maintenanceProfiles = reactive(loadProfiles())
  const profileDraft = reactive({ account: '', douyinId: '', uid: '', xtId: '', cooperationCode: '' })

  const douyinAccounts = DOUYIN_STANDARDS.map(item => item.account)
  const bilibiliAccounts = BILIBILI_STANDARDS.map(item => item.account)
  const maintenanceAccountOptions = computed(() => maintenancePlatform.value === 'bilibili' ? bilibiliAccounts : douyinAccounts)

  const currentStandard = computed(() => {
    const account = normalizeAccountName(maintenanceAccount.value)
    const list = maintenancePlatform.value === 'bilibili' ? BILIBILI_STANDARDS : DOUYIN_STANDARDS
    return list.find(item => item.account === account) || null
  })

  const currentProfile = computed(() => maintenanceProfiles[normalizeAccountName(maintenanceAccount.value)] || {})

  const maintenanceTotalAmount = computed(() => Number(maintenanceAmount.value || currentStandard.value?.price || 0))

  const maintenancePhaseItems = computed(() => {
    if (!maintenanceUsePhases.value) return []
    return maintenancePhases
      .map((phase, index) => {
        const percent = Math.max(0, Number(phase.percent || 0))
        const amount = Math.round(maintenanceTotalAmount.value * percent / 100)
        const name = String(phase.name || `第${index + 1}期`).trim() || `第${index + 1}期`
        return { name, percent, amount }
      })
      .filter(phase => phase.percent > 0)
  })

  const maintenancePhasePercentTotal = computed(() => maintenancePhaseItems.value.reduce((sum, phase) => sum + phase.percent, 0))

  const maintenanceResult = computed(() => {
    const account = normalizeAccountName(maintenanceAccount.value)
    if (!account) return null
    const standard = currentStandard.value
    if (!standard) {
      const amount = maintenanceTotalAmount.value
      return {
        platform: maintenancePlatform.value,
        amount,
        ratio: 1,
        phases: maintenancePhaseItems.value,
        missingStandard: true,
        plays: 0,
        likes: 0,
        comments: 0,
        favorites: 0,
        shares: 0,
        coins: 0,
        danmaku: 0,
        bihuo: 0,
        cost: 0,
        margin: amount ? 100 : 0,
        usePrivate: maintenanceOrderType.value === 'private',
        useDou: maintenanceNeedDou.value && maintenanceOrderType.value !== 'private'
      }
    }
    const amount = maintenanceTotalAmount.value
    const ratio = standard.price ? amount / standard.price : 1
    const phases = maintenancePhaseItems.value
    if (maintenancePlatform.value === 'bilibili') {
      const cost = Math.round(standard.cost * ratio)
      return {
        platform: 'bilibili',
        amount,
        ratio,
        phases,
        plays: scaleCount(standard.plays, ratio),
        likes: scaleCount(standard.likes, ratio),
        coins: scaleCount(standard.coins, ratio),
        favorites: scaleCount(standard.favorites, ratio),
        comments: scaleCount(standard.comments, ratio),
        shares: scaleCount(standard.shares, ratio),
        danmaku: scaleCount(standard.danmaku, ratio),
        bihuo: Math.round(standard.bihuo * ratio),
        cost,
        margin: amount ? ((amount - cost) / amount) * 100 : 0
      }
    }

    const usePrivate = maintenanceOrderType.value === 'private'
    const useDou = maintenanceNeedDou.value && !usePrivate
    const baseCost = usePrivate ? standard.privateCost : useDou ? standard.douCost : standard.premiumCost
    const baseMargin = usePrivate ? standard.privateMargin : useDou ? standard.douMargin : standard.premiumMargin
    const cost = Math.round(baseCost * ratio)
    return {
      platform: 'douyin',
      amount,
      ratio,
      phases,
      plays: scaleCount(standard.plays, ratio),
      likes: scaleCount(standard.likes, ratio),
      comments: scaleCount(standard.comments, ratio),
      favorites: scaleCount(standard.favorites, ratio),
      shares: scaleCount(standard.shares, ratio),
      cost,
      margin: amount ? ((amount - cost) / amount) * 100 : baseMargin,
      baseMargin,
      usePrivate,
      useDou
    }
  })

  const maintenancePlanText = computed(() => {
    const result = maintenanceResult.value
    if (!result) return '请先填写账号名。'
    const phaseLines = buildMaintenancePhaseLines(result)
    if (result.missingStandard) {
      return [
        `账号「${normalizeAccountName(maintenanceAccount.value)}」暂未录入维护标准，已保留账号名用于导出。`,
        `金额 ${toMoney(result.amount)} 元，播放/互动/成本请按本次实际需求手动补充。`,
        ...phaseLines,
        '建议后续把该账号的报价、播放、互动和成本标准补入账号库，后续可自动测算。'
      ].join('\n')
    }
    if (result.platform === 'bilibili') {
      return [
        `B站按新版标准等比测算，金额 ${toMoney(result.amount)} 元，必火作为主播放，目标播放 ${toMoney(result.plays)}。`,
        ...phaseLines,
        `互动分批跟进：点赞 ${toMoney(result.likes)}、投币 ${toMoney(result.coins)}、收藏 ${toMoney(result.favorites)}、分享 ${toMoney(result.shares)}、弹幕 ${toMoney(result.danmaku)}、自定义评论 ${toMoney(result.comments)}。`,
        `预计维护成本 ${toMoney(result.cost)} 元，维护后毛利率 ${toPercent(result.margin)}。`
      ].join('\n')
    }
    const channel = result.usePrivate ? '私单按普通千川/HKJ组合控成本' : result.useDou ? '普通千川配 Dou+ 补量' : '高质千川做主力播放'
    const douLine = result.useDou
      ? 'Dou+ 按最短 6 小时批次排，不和千川主投高峰重叠。'
      : '默认不排 Dou+，避免和千川互冲；发布后自然量弱再临时补 6 小时批次。'
    return [
      `${channel}，金额 ${toMoney(result.amount)} 元，目标播放 ${toMoney(result.plays)}。`,
      ...phaseLines,
      `点赞 ${toMoney(result.likes)}、评论 ${toMoney(result.comments)}、收藏 ${toMoney(result.favorites)}、转发 ${toMoney(result.shares)} 跟播放节奏分 2-3 批补。`,
      douLine,
      `预计维护成本 ${toMoney(result.cost)} 元，维护后毛利率 ${toPercent(result.margin)}。`
    ].join('\n')
  })

  const maintenanceApplicationText = computed(() => {
    const result = maintenanceResult.value
    const account = normalizeAccountName(maintenanceAccount.value)
    if (!result) return ''
    const videoUrl = maintenanceVideoUrl.value.trim() || '待发布后补'
    const applicationPhaseLines = buildMaintenanceApplicationPhaseLines(result)
    if (result.missingStandard) {
      const platformTitle = result.platform === 'bilibili' ? '【B站】' : '【抖音】'
      return [
        '辛苦娜姐、00姐、空白、跃萍姐帮忙看下这个维护申请。',
        '',
        platformTitle,
        `账号：${account}`,
        `视频链接：${videoUrl}`,
        ...applicationPhaseLines,
        '播放量：待补',
        '点赞：待补',
        '评论：待补',
        '收藏：待补',
        '分享/转发：待补',
        `维护成本预计：待补，维护金额${toMoney(result.amount)}元`,
        '',
        '该账号暂未录入维护标准，导出时先保留账号名和基础模板。'
      ].join('\n')
    }
    if (result.platform === 'bilibili') {
      return [
        '辛苦娜姐、00姐、空白、跃萍姐帮忙看下这个维护申请。',
        '',
        '【B站】',
        `账号：${account}`,
        `视频链接：${videoUrl}`,
        ...applicationPhaseLines,
        `必火：${toMoney(result.bihuo)}元`,
        `播放量：${toMoney(result.plays)}`,
        `点赞：${toMoney(result.likes)}`,
        `投币：${toMoney(result.coins)}`,
        `收藏：${toMoney(result.favorites)}`,
        `分享：${toMoney(result.shares)}`,
        `弹幕：${toMoney(result.danmaku)}（自定义）`,
        `维护成本：${toMoney(result.cost)}元，维护后毛利率${toPercent(result.margin)}`,
        '',
        '评论文档里除评论外，把视频链接也贴在前面。'
      ].join('\n')
    }
    const profile = currentProfile.value
    const playLabel = result.usePrivate ? '普通千川播放量' : result.useDou ? '普通千川播放量' : '高质千川播放量'
    const likeLabel = result.usePrivate ? 'HKJ点赞' : '千川点赞'
    return [
      '辛苦娜姐、00姐、空白、跃萍姐帮忙看下这个维护申请。',
      '',
      '【抖音】',
      `账号：${account}`,
      `抖音ID：${profile.douyinId || '待补'}`,
      `合作码：${profile.cooperationCode || '待补'}`,
      `视频链接：${videoUrl}`,
      ...applicationPhaseLines,
      `${playLabel}：${toMoney(result.plays)}`,
      `${likeLabel}：${toMoney(result.likes)}`,
      `自定义评论：${toMoney(result.comments)}`,
      `HKJ收藏：${toMoney(result.favorites)}`,
      `HKJ转发：${toMoney(result.shares)}`,
      `抖加：${result.useDou ? '按 6 小时批次补量' : '暂不投'}`,
      `维护成本预计：${toMoney(result.cost)}元，维护后毛利率${toPercent(result.margin)}`,
      '',
      '评论文档里除评论外，把视频链接也贴在前面。'
    ].join('\n')
  })

  function syncProfileDraft() {
    const account = normalizeAccountName(maintenanceAccount.value)
    const profile = maintenanceProfiles[account] || {}
    Object.assign(profileDraft, {
      account,
      douyinId: profile.douyinId || '',
      uid: profile.uid || '',
      xtId: profile.xtId || '',
      cooperationCode: profile.cooperationCode || ''
    })
  }

  function saveAccountProfile() {
    const account = normalizeAccountName(profileDraft.account)
    if (!account) return showToast('请先填写账号', 'error')
    maintenanceProfiles[account] = {
      douyinId: profileDraft.douyinId.trim(),
      uid: profileDraft.uid.trim(),
      xtId: profileDraft.xtId.trim(),
      cooperationCode: profileDraft.cooperationCode.trim()
    }
    saveProfiles({ ...maintenanceProfiles })
    maintenanceAccount.value = account
    showToast('账号资料已保存', 'success')
  }

  function handleVecSearch() {
    const account = normalizeAccountName(maintenanceAccount.value)
    if (!account) return showToast('请先填写账号', 'error')
    showToast(currentStandard.value ? '维护测算已生成' : '账号未入库，已按待补标准生成导出模板', 'success')
  }

  function addMaintenancePhase() {
    maintenanceUsePhases.value = true
    maintenancePhases.push({ name: `第${maintenancePhases.length + 1}期`, percent: 0 })
  }

  function removeMaintenancePhase(index) {
    if (maintenancePhases.length <= 1) return
    maintenancePhases.splice(index, 1)
    normalizeMaintenancePhases()
  }

  function enableTwoPhasePlan() {
    maintenanceUsePhases.value = true
    maintenancePhases.splice(
      0,
      maintenancePhases.length,
      { name: '第1期', percent: 60 },
      { name: '第2期', percent: 40 }
    )
  }

  function normalizeMaintenancePhases() {
    maintenancePhases.forEach((phase, index) => {
      if (!String(phase.name || '').trim()) phase.name = `第${index + 1}期`
    })
  }

  watch([maintenancePlatform, maintenanceAccount], () => {
    syncProfileDraft()
  }, { immediate: true })

  watch(currentStandard, (standard) => {
    if (standard && !maintenanceAmount.value) maintenanceAmount.value = standard.price
  }, { immediate: true })

  watch(maintenanceUsePhases, (enabled) => {
    if (enabled && maintenancePhasePercentTotal.value <= 0) enableTwoPhasePlan()
  })

  return {
    vecQuery: maintenanceVideoUrl,
    vecAccount: maintenanceAccount,
    vecScene: maintenanceOrderType,
    vecResults: computed(() => maintenanceResult.value ? [maintenanceResult.value] : []),
    vecLoading: ref(false),
    handleVecSearch,
    maintenancePlatform,
    maintenanceAccount,
    maintenanceAmount,
    maintenanceUsePhases,
    maintenancePhases,
    maintenanceTotalAmount,
    maintenancePhasePercentTotal,
    maintenanceOrderType,
    maintenanceVideoUrl,
    maintenanceNeedDou,
    maintenanceAccountOptions,
    currentStandard,
    currentProfile,
    profileDraft,
    maintenancePlanText,
    maintenanceApplicationText,
    addMaintenancePhase,
    removeMaintenancePhase,
    enableTwoPhasePlan,
    saveAccountProfile,
    syncProfileDraft
  }
}
