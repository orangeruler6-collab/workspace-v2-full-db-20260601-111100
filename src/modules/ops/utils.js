export function calcMargin(fee, platform) {
  if (!platform) return Math.round(fee)
  const p = platform.trim()
  if (p === 'B站') return Math.round(fee * 0.6)
  if (p === '代做') return Math.round(fee * 1.0)
  return Math.round(fee * 0.5)
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function toProfitRow(item) {
  return {
    id: item.id,
    项目: item.project || '',
    平台: item.platform || '',
    类型: item.category || '',
    账号: item.account || '',
    档期: item.month || '',
    费用: Number(item.revenue) || 0,
    毛利: Number(item.margin) || 0,
    备注: item.remark || ''
  }
}
