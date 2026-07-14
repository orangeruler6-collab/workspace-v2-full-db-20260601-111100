export const platformOptions = [
  { id: 'all', label: '全平台' },
  { id: 'douyin', label: '抖音' },
  { id: 'bilibili', label: 'B站' },
  { id: 'kuaishou', label: '快手', placeholder: true }
]

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
