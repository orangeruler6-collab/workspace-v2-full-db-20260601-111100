import { GROUPS } from '../schedule/constants'

const platformSeeds = [
  { id: 'douyin', label: '抖音', weight: 1, profilePrefix: 'dy' },
  { id: 'bilibili', label: 'B站', weight: 0.42, profilePrefix: 'bili' },
  { id: 'kuaishou', label: '快手', weight: 0.18, profilePrefix: 'ks' }
]

const boundProfiles = {
  饭十七: 'dvabrcmr',
  雷鸭Fist: 'h4g7ab4y',
  游点慌: 'b3uk5kjf',
  天机妹: 'tianji-mei-publish',
  麦晓花: 'maixiaohua-publish'
}

function hashText(text) {
  return String(text || '').split('').reduce((sum, char, index) => {
    return sum + char.charCodeAt(0) * (index + 7)
  }, 0)
}

function buildAccount(group, account, index, platform) {
  const seed = hashText(`${group.label}-${account}-${platform.id}`)
  const baseViews = Math.round((56000 + seed % 280000) * platform.weight)
  const yesterdayViews = Math.round((2400 + seed % 42000) * platform.weight)
  const likes = Math.round(baseViews * (0.018 + (seed % 18) / 1000))
  const yesterdayLikes = Math.round(yesterdayViews * (0.02 + (seed % 16) / 1000))
  const followers = Math.round((8000 + seed % 180000) * Math.max(platform.weight, 0.24))
  const followerDelta = Math.round((18 + seed % 880) * Math.max(platform.weight, 0.28))
  const comments = Math.round(likes * (0.08 + (seed % 9) / 100))
  const favorites = Math.round(likes * (0.22 + (seed % 12) / 100))
  const enabled = platform.id === 'douyin' ? account !== '素材' : seed % 4 === 0
  const profile = platform.id === 'douyin'
    ? (boundProfiles[account] || (enabled && seed % 3 === 0 ? `${platform.profilePrefix}-${index + group.id}` : ''))
    : ''
  return {
    id: `${platform.id}-${group.id}-${index}`,
    account,
    groupId: group.id,
    groupName: group.label,
    owner: group.members[index % group.members.length] || '',
    platform: platform.id,
    platformLabel: platform.label,
    enabled,
    profile,
    collectStatus: profile ? (seed % 5 === 0 ? '待复核' : '正常') : '未绑定',
    lastCollectedAt: profile ? `2026-06-09 ${seed % 2 ? '10:18' : '18:06'}` : '',
    totalViews: baseViews,
    yesterdayViews,
    totalLikes: likes,
    yesterdayLikes,
    followers,
    followerDelta,
    comments,
    favorites,
    shares: Math.round(likes * (0.04 + (seed % 8) / 100)),
    hitWorks: Math.max(0, Math.round(yesterdayViews / 28000)),
    growthScore: Math.round(yesterdayViews * 0.72 + followerDelta * 18 + yesterdayLikes * 5),
    trend: Array.from({ length: 8 }, (_, day) => {
      const wave = Math.sin((seed % 9 + day) / 1.7)
      return Math.max(0, Math.round(yesterdayViews * (0.58 + day * 0.055 + wave * 0.13)))
    }),
    fanTrend: Array.from({ length: 8 }, (_, day) => {
      const wave = Math.cos((seed % 7 + day) / 1.8)
      return Math.max(0, Math.round(followers - followerDelta * (7 - day) * 0.42 + wave * followerDelta * 0.16))
    })
  }
}

export const platformOptions = [
  { id: 'all', label: '全平台' },
  ...platformSeeds.map(item => ({ id: item.id, label: item.label, placeholder: item.id === 'kuaishou' }))
]

export const accountDataMock = GROUPS.flatMap(group => {
  return group.accounts
    .filter(account => account !== '素材')
    .flatMap((account, index) => platformSeeds.map(platform => buildAccount(group, account, index, platform)))
})

export const chartPalette = ['#2f80ed', '#00a67e', '#f59f00', '#e64980', '#7048e8', '#12b886']

export function formatCompactNumber(value) {
  const num = Number(value) || 0
  if (Math.abs(num) >= 100000000) return `${(num / 100000000).toFixed(1)}亿`
  if (Math.abs(num) >= 10000) return `${(num / 10000).toFixed(1)}万`
  return num.toLocaleString('zh-CN')
}

export function platformLabel(platform) {
  return platformOptions.find(item => item.id === platform)?.label || platform
}
