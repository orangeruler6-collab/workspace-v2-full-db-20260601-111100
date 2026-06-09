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
    类型: item.business_type || item.category || '',
    账号: item.account || '',
    档期: item.month || '',
    费用: Number(item.revenue) || 0,
    毛利: Number(item.margin) || 0,
    备注: item.remark || '',
    组别: item.grp || '',
    来源: item.entry_source || '',
    原组: item.origin_group || '',
    代做组: item.producer_group || '',
    原组比例: Number(item.origin_share) || 30,
    代做比例: Number(item.producer_share) || 70,
    内部分成: !!Number(item.split_enabled || 0),
    下单金额: Number(item.order_amount) || 0,
    最终合作价: Number(item.final_amount) || Number(item.revenue) || 0,
    预估毛利: Number(item.projected_margin) || Number(item.margin) || 0,
    锁档日期: item.lock_date || '',
    发布日期: item.publish_date || '',
    是否发布: !!Number(item.is_published || 0),
    产品线: item.product_line || '',
    链接: item.link || '',
    单号: item.order_no || '',
    创建时间: Number(item.created_at) || 0
  }
}
