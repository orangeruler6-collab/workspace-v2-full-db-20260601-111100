const DEFAULT_GAME_KEYWORDS = [
  '游戏', '手游', '端游', '电竞', '三角洲', '无畏契约', '真三国', '天下',
  '战火勋章', '精灵养成', '字节三端', '逆水寒', '王者', '和平精英'
]

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[：﹕]/g, ':')
    .replace(/[，]/g, ',')
    .replace(/[；]/g, ';')
}

function normalizeAccountKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s·丶_\-—~～]+/g, '')
}

function normalizeAlias(value) {
  const key = normalizeAccountKey(value)
  if (key === normalizeAccountKey('王路飞')) return normalizeAccountKey('王路飞cp')
  if (key === normalizeAccountKey('薛定谔的机')) return normalizeAccountKey('薛定谔的机')
  if (key === normalizeAccountKey('夏天Cat')) return normalizeAccountKey('夏天丶cat')
  return key
}

function flattenAccounts(groups) {
  const result = []
  for (const group of groups || []) {
    for (const account of group.accounts || []) {
      if (!account || result.some(item => normalizeAccountKey(item.account) === normalizeAccountKey(account))) continue
      result.push({ account, group: group.label || '' })
    }
  }
  return result
}

function findAccountByName(name, accountItems) {
  const key = normalizeAlias(name)
  return accountItems.find(item => normalizeAlias(item.account) === key || key.includes(normalizeAlias(item.account)) || normalizeAlias(item.account).includes(key))
}

function accountNamePattern(account) {
  const escaped = String(account || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (account === '王路飞cp') return '(?:王路飞cp|王路飞)'
  if (account === '夏天丶cat') return '(?:夏天丶cat|夏天Cat|夏天cat)'
  if (account === '薛定谔的机') return '薛定谔的机-?'
  return escaped + '-?'
}

function extractLineValue(text, labels) {
  const pattern = new RegExp(`^(?:${labels.join('|')})\\s*:\\s*(.+)$`, 'im')
  const match = normalizeText(text).match(pattern)
  return match ? match[1].trim() : ''
}

function extractProject(text) {
  return extractLineValue(text, ['产品', '项目', '游戏', '标的', '合作产品', '投放产品']).replace(/\s+/g, ' ').trim()
}

function normalizePlatform(value, fallbackText = '') {
  const primary = String(value || '')
  const raw = primary.trim() ? primary : String(fallbackText || '')
  if (/B站|b站|哔哩|bilibili|花火/i.test(raw)) return 'B站'
  if (/快手|磁力聚星/.test(raw)) return '快手'
  if (/抖音|星图|douyin/i.test(raw)) return '抖音'
  if (/小红书/.test(raw)) return '小红书'
  if (/视频号/.test(raw)) return '视频号'
  return '抖音'
}

function extractPlatform(text) {
  return normalizePlatform(extractLineValue(text, ['合作平台', '平台']), text)
}

function inferProductLine(project, text) {
  const raw = [project, text].join(' ')
  return DEFAULT_GAME_KEYWORDS.some(keyword => raw.includes(keyword)) ? '游戏' : '非游'
}

function parseDateParts(text, selectedYear) {
  const raw = normalizeText(text)
  let match = raw.match(/(20\d{2})\s*年\s*(1[0-2]|0?[1-9])\s*月\s*(\d{1,2})?/)
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : 0 }
  match = raw.match(/(20\d{2})[./-](1[0-2]|0?[1-9])(?:[./-](\d{1,2}))?/)
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : 0 }
  match = raw.match(/(^|[^\d])(1[0-2]|0?[1-9])\s*[./]\s*(\d{1,2})/)
  if (match) return { year: Number(selectedYear) || new Date().getFullYear(), month: Number(match[2]), day: Number(match[3]) }
  match = raw.match(/(^|[^\d])(1[0-2]|0?[1-9])\s*月\s*(\d{1,2})?/)
  if (match) return { year: Number(selectedYear) || new Date().getFullYear(), month: Number(match[2]), day: match[3] ? Number(match[3]) : 0 }
  return { year: Number(selectedYear) || new Date().getFullYear(), month: 0, day: 0 }
}

function scheduleFromDate(date, selectedMonth) {
  const month = Number(date.month || selectedMonth || (new Date().getMonth() + 1))
  return `${date.year}年${month}月`
}

function lockDateFromDate(date) {
  if (!date.year || !date.month || !date.day) return ''
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

function extractScheduleText(text) {
  return extractLineValue(text, ['推广档期', '档期', '发布时间', '发布档期'])
}

function extractHeaderAccounts(text, accountItems) {
  const raw = extractLineValue(text, ['达人昵称', '达人'])
  const found = []
  if (raw) {
    raw.split(/[、,，/]/).forEach(part => {
      const item = findAccountByName(part.replace(/通用bf.*$/i, '').trim(), accountItems)
      if (item && !found.some(hit => hit.account === item.account)) found.push(item)
    })
  }
  for (const item of accountItems) {
    if (item.account === '素材') continue
    const pattern = new RegExp(accountNamePattern(item.account), 'i')
    if (pattern.test(text) && !found.some(hit => hit.account === item.account)) found.push(item)
  }
  return found
}

function extractAccountScheduleText(scheduleText, account) {
  const raw = normalizeText(scheduleText)
  if (!raw || !account) return ''
  const pattern = new RegExp(`${accountNamePattern(account)}\\s*([12]?\\d[./月]\\d{1,2}(?:日)?)`, 'i')
  const match = raw.match(pattern)
  return match ? match[1] : ''
}

function extractFeeSection(text) {
  const raw = normalizeText(text)
  const feeIndex = raw.search(/(^|\n)\s*费用\s*:/)
  if (feeIndex >= 0) {
    return raw.slice(feeIndex).replace(/^.*?费用\s*:\s*/s, '').split(/烦请确认/)[0].trim()
  }
  const remarkIndex = raw.lastIndexOf('备注')
  const tail = remarkIndex >= 0 ? raw.slice(remarkIndex) : raw
  return tail.split(/烦请确认/)[0].trim()
}

function mergeFeeLines(section) {
  const lines = normalizeText(section)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const chunks = []
  let pending = ''
  for (const line of lines) {
    if (/^[\u4e00-\u9fa5A-Za-z0-9_\-·丶～~]+:$/.test(line)) {
      pending = line
      continue
    }
    if (pending) {
      chunks.push(`${pending}${line}`)
      pending = ''
    } else {
      chunks.push(line)
    }
  }
  if (pending) chunks.push(pending)
  return chunks
}

function moneyNumber(value) {
  return Math.round(Number(String(value || '').replace(/,/g, '')) || 0)
}

function amountAfter(labelPattern, text) {
  const raw = normalizeText(text).replace(/,/g, '')
  let match = raw.match(new RegExp(`(?:${labelPattern})[^\\n;。]*?=\\s*(\\d+(?:\\.\\d+)?)\\s*(?:元|块)?`, 'i'))
  if (match) return moneyNumber(match[1])
  match = raw.match(new RegExp(`(?:${labelPattern})[^\\n;。]{0,16}?(\\d+(?:\\.\\d+)?)\\s*(?:元|块)`, 'i'))
  return match ? moneyNumber(match[1]) : 0
}

function extractVideoBaseAmount(text) {
  const raw = normalizeText(text).replace(/,/g, '')
  const match = raw.match(/视频合作底价[^;\n。]*?=\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/i)
  return match ? moneyNumber(match[1]) : 0
}

function extractCount(text) {
  const match = normalizeText(text).match(/(\d+)\s*条\s*视频|推广\s*(\d+)\s*条|(\d+)\s*(?:条|支|篇)/)
  return match ? moneyNumber(match[1] || match[2] || match[3]) : 0
}

function extractFinalAmount(text) {
  const raw = normalizeText(text).replace(/,/g, '')
  const total = amountAfter('合作总费用|总费用|即共计|共计|总计', raw)
  if (total) return total
  const discounted = amountAfter('实际合作金额|实际合作价格|合作底价|合作金额|合作价格|合作费用|折后|对客折扣后', raw)
  if (discounted) return discounted
  const expression = raw.match(/=\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/)
  if (expression) return moneyNumber(expression[1])
  const count = extractCount(raw)
  const unit = raw.match(/单条\s*(\d+(?:\.\d+)?)\s*(?:元|块)/)
  if (count && unit) return moneyNumber(unit[1]) * count
  const yuan = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(?:元|块)/g)].map(match => moneyNumber(match[1]))
  return yuan.length ? yuan[yuan.length - 1] : 0
}

function extractOrderAmount(text, finalAmount) {
  const raw = normalizeText(text).replace(/,/g, '')
  const count = extractCount(raw)
  const platformOrder = raw.match(/(?:下|改价至|下1-20s|下\s*1-20s)\D{0,8}(\d+(?:\.\d+)?)\s*(?:元|块).*?接单/i)
  if (platformOrder) return moneyNumber(platformOrder[1]) * (count || 1)
  const quote = raw.match(/(?:刊例价|定制视频刊例价|定制视频报价|B站定制视频报价|B站定制报价|抖音60s\+视频报价|视频报价|星图报价为?|报价为?|报价)\D{0,8}(\d+(?:\.\d+)?)\s*(?:元|块)?/i)
  if (quote) return moneyNumber(quote[1])
  const expression = raw.match(/(\d+(?:\.\d+)?)\s*\*\s*0?\.\d+\s*=\s*(\d+(?:\.\d+)?)/)
  if (expression) return moneyNumber(expression[1])
  return finalAmount || 0
}

function extractRebateAmount(text, orderAmount, finalAmount) {
  const raw = normalizeText(text).replace(/,/g, '')
  const explicit = raw.match(/(?:返点|后返)\D{0,6}(\d+(?:\.\d+)?)\s*元/)
  if (explicit) return moneyNumber(explicit[1])
  const percent = raw.match(/(?:返点|折扣|后返)\D{0,6}(\d+(?:\.\d+)?)\s*%/)
  if (percent && orderAmount && finalAmount && orderAmount > finalAmount) return orderAmount - finalAmount
  return 0
}

function chunkForAccount(section, account, allAccounts) {
  if (allAccounts.length === 1) return section
  const chunks = mergeFeeLines(section)
  const pattern = new RegExp(accountNamePattern(account), 'i')
  const accountChunks = chunks.filter(chunk => pattern.test(chunk))
  if (accountChunks.length) return accountChunks.join('\n')
  return ''
}

function parseProfitConfirmationText(text, options = {}) {
  const normalized = normalizeText(text)
  const accountItems = flattenAccounts(options.groups || [])
  const project = extractProject(normalized) || '未命名项目'
  const platform = extractPlatform(normalized)
  const scheduleText = extractScheduleText(normalized)
  const scheduleDate = parseDateParts(scheduleText || normalized, options.selectedYear)
  const schedule = scheduleFromDate(scheduleDate, options.selectedMonth)
  const lockDate = lockDateFromDate(scheduleDate)
  const productLine = inferProductLine(project, normalized)
  const headerAccounts = extractHeaderAccounts(normalized, accountItems)
  const feeSection = extractFeeSection(normalized)
  const accounts = headerAccounts.length ? headerAccounts : accountItems.filter(item => new RegExp(accountNamePattern(item.account), 'i').test(feeSection))
  const uniqueAccounts = accounts.filter((item, index, list) => list.findIndex(other => other.account === item.account) === index)
  const records = []

  for (const item of uniqueAccounts) {
    if (!item.account || item.account === '素材') continue
    const accountText = chunkForAccount(feeSection, item.account, uniqueAccounts)
    if (!accountText) continue
    const finalAmount = extractFinalAmount(accountText)
    if (!finalAmount) continue
    const itemScheduleText = extractAccountScheduleText(scheduleText, item.account) || scheduleText
    const itemScheduleDate = parseDateParts(itemScheduleText || normalized, options.selectedYear)
    const videoBase = extractVideoBaseAmount(accountText)
    const orderAmount = extractOrderAmount(accountText, finalAmount)
    const rebateAmount = extractRebateAmount(accountText, orderAmount, videoBase || finalAmount)
    const count = extractCount(accountText)
    records.push({
      grp: item.group || '',
      account: item.account,
      project,
      platform,
      fee: finalAmount,
      revenue: finalAmount,
      margin: 0,
      schedule: scheduleFromDate(itemScheduleDate, options.selectedMonth),
      month: scheduleFromDate(itemScheduleDate, options.selectedMonth),
      lock_date: lockDateFromDate(itemScheduleDate) || lockDate,
      note: [accountText.trim(), count ? `数量：${count}条` : ''].filter(Boolean).join('；'),
      category: '一口价',
      business_type: '一口价',
      entry_source: 'rule',
      order_amount: orderAmount,
      rebate_amount: rebateAmount,
      final_amount: finalAmount,
      projected_margin: 0,
      product_line: productLine,
      count,
      raw: accountText
    })
  }

  return records
}

function splitConfirmationSamples(text) {
  const confirm = '烦请确认'
  const lines = normalizeText(text).split('\n')
  const parts = []
  let buf = []
  let sawConfirm = false
  for (const line of lines) {
    buf.push(line)
    if (line.includes(confirm)) sawConfirm = true
    if (sawConfirm && line.includes('@')) {
      const block = buf.join('\n').trim()
      if (block) parts.push(block)
      buf = []
      sawConfirm = false
    }
  }
  const tail = buf.join('\n').trim()
  if (tail) parts.push(tail)
  return parts
}

export {
  parseProfitConfirmationText,
  splitConfirmationSamples,
  normalizePlatform,
  normalizeAccountKey
}
