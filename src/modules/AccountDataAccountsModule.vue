<template>
  <div class="account-pool-module">
    <header class="module-page-header account-pool-head">
      <div class="module-page-title">
        <span class="module-page-icon">库</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">ACCOUNT POOL</div>
          <h2>账号池</h2>
        </div>
      </div>
      <div class="pool-actions">
        <select v-model="platformFilter" class="inp pool-select">
          <option value="all">全平台</option>
          <option value="douyin">抖音</option>
          <option value="bilibili">B站</option>
          <option value="kuaishou">快手</option>
          <option value="xiaohongshu">小红书</option>
          <option value="wechatVideo">视频号</option>
        </select>
        <select v-model="groupFilter" class="inp pool-select">
          <option value="all">全部小组</option>
          <option v-for="group in groupOptions" :key="group" :value="group">{{ group }}</option>
        </select>
        <input v-model.trim="keyword" class="inp pool-search" placeholder="搜索账号 / 小组" />
        <button type="button" class="pool-refresh" :disabled="loading" @click="loadAccounts">
          {{ loading ? '读取中' : '刷新' }}
        </button>
      </div>
    </header>

    <section class="pool-summary">
      <article v-for="item in poolSummary" :key="item.label">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </section>

    <section v-if="visibleCollectionFailures.length" class="collect-alert">
      <strong>采集失败提醒</strong>
      <span v-for="item in visibleCollectionFailures" :key="item.key">
        {{ item.groupName }} / {{ item.account }}：{{ item.message }}
      </span>
    </section>

    <section class="pool-table-wrap">
      <div class="pool-table">
        <div class="pool-table-head">
          <span>账号</span>
          <span>平台</span>
          <span>小组</span>
          <span>负责人</span>
          <span>采集</span>
          <span>最近采集</span>
          <span>状态</span>
        </div>
        <div v-if="loading && !accounts.length" class="pool-table-message">正在读取后端账号目录...</div>
        <div v-else-if="error" class="pool-table-message error">{{ error }}</div>
        <div v-else-if="!filteredAccounts.length" class="pool-table-message">暂无匹配账号</div>
        <div v-for="account in filteredAccounts" :key="account.id" class="pool-table-row">
          <strong class="account-name">
            {{ account.account }}
            <small v-if="account.sourceLabel">{{ account.sourceLabel }}</small>
          </strong>
          <span class="platform-stack">
            <span
              v-for="platform in account.displayPlatforms"
              :key="platform.id"
              class="platform-chip"
              :class="[platform.id, platform.loginClass]"
              :title="platform.title"
            >
              {{ platform.label }}
            </span>
            <span
              v-if="account.platformExtraCount"
              class="platform-chip more"
              :title="account.platformSummaryTitle"
            >
              +{{ account.platformExtraCount }}
            </span>
          </span>
          <span>{{ account.groupName }}</span>
          <span>{{ account.owner }}</span>
          <label class="switch">
            <input :checked="account.enabled" type="checkbox" disabled />
            <i></i>
          </label>
          <span>{{ account.lastCollectedAt || '-' }}</span>
          <em :class="accountStatusClass(account)">{{ accountStatusLabel(account) }}</em>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { loadAccountDataDashboard } from '../api/accountData'
import { listVideoPublishAccounts } from '../api/videoPublish'
import { GROUPS } from './schedule/constants'

const accounts = ref([])
const collectionFailures = ref([])
const loading = ref(false)
const error = ref('')
const platformFilter = ref('all')
const groupFilter = ref('all')
const keyword = ref('')

const groupOptions = computed(() => Array.from(new Set(accounts.value.map(item => item.groupName).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')))
const knownAccountNames = computed(() => new Set(accounts.value.map(item => normalize(item.account)).filter(Boolean)))

const filteredAccounts = computed(() => {
  const word = keyword.value.toLowerCase()
  return accounts.value
    .filter(item => platformFilter.value === 'all' || item.platformIds.includes(platformFilter.value))
    .filter(item => groupFilter.value === 'all' || item.groupName === groupFilter.value)
    .filter(item => {
      if (!word) return true
      const haystack = [
        item.account,
        item.platformLabels.join(' '),
        item.groupName,
        item.owner
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(word)
    })
    .sort((a, b) => a.groupId - b.groupId || a.account.localeCompare(b.account, 'zh-CN'))
})

const poolSummary = computed(() => {
  const visible = filteredAccounts.value
  const platformCount = visible.reduce((sum, item) => sum + item.platforms.length, 0)
  const loginIssues = visible.filter(item => item.hasLoginIssue || item.hasUnknownLogin).length
  const dataBound = visible.filter(item => item.dataProfile).length
  return [
    { label: '当前账号', value: visible.length },
    { label: '平台绑定', value: platformCount },
    { label: '待登录/待检', value: loginIssues },
    { label: '采集绑定', value: dataBound }
  ]
})

const visibleCollectionFailures = computed(() => {
  return collectionFailures.value
    .filter(item => knownAccountNames.value.has(normalize(item.account)))
    .filter(item => groupFilter.value === 'all' || item.groupName === groupFilter.value)
    .slice(0, 4)
})

const okLoginStatuses = new Set(['ready', 'confirmed', 'ok', 'logged_in', 'online', '已登录', '正常'])
const badLoginStatuses = new Set(['login', 'needs_login', 'need_login', 'expired', 'failed', 'error', 'offline', 'unauthorized', '未登录', '掉线'])

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function bindingKey(accountId, platformId) {
  return `${normalize(accountId)}:${normalize(platformId)}`
}

function platformLabel(platform) {
  return readableText(platform.name, platform.platform_name, platform.platformLabel, platform.id, platform.platform_id, '')
}

function loginState(status) {
  const raw = String(status || '').trim()
  const key = normalize(raw)
  if (key === 'connected') return { raw, label: '在线', className: 'ok', issue: false, unknown: false }
  if (key === 'not_connected' || key === 'disconnected') return { raw, label: '离线', className: 'warn', issue: true, unknown: false }
  if (!key || key === 'unknown') return { raw, label: '待检测', className: 'unknown', issue: false, unknown: true }
  if (okLoginStatuses.has(key) || okLoginStatuses.has(raw)) return { raw, label: '已登录', className: 'ok', issue: false, unknown: false }
  if (badLoginStatuses.has(key) || badLoginStatuses.has(raw)) return { raw, label: '未登录', className: 'warn', issue: true, unknown: false }
  return { raw, label: raw, className: 'warn', issue: true, unknown: false }
}

function latestText(values) {
  return values.filter(Boolean).sort().pop() || ''
}

function unique(values) {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)))
}

function looksBrokenText(value) {
  const text = String(value || '').trim()
  if (!text) return true
  const compact = text.replace(/\s+/g, '')
  if (!compact) return true
  const broken = (compact.match(/[?�]/g) || []).length
  return broken > 0 && broken >= Math.ceil(compact.length / 2)
}

function readableText(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text && !looksBrokenText(text)) return text
  }
  return ''
}

function buildDashboardIndex(rows = []) {
  const byProfile = new Map()
  const byAccount = new Map()
  for (const row of rows || []) {
    const platform = normalize(row.platform)
    if (!platform) continue
    if (row.profile) byProfile.set(`${normalize(row.profile)}:${platform}`, row)
    for (const name of [row.account, row.knownProfile].filter(Boolean)) {
      byAccount.set(`${normalize(name)}:${platform}`, row)
    }
  }
  return { byProfile, byAccount }
}

function findDashboardRow(index, account, platform, publishProfile, dataProfile) {
  const platformId = normalize(platform.id)
  const profileKeys = [publishProfile, dataProfile, ...(account.profileAliases || [])]
    .filter(Boolean)
    .map(value => `${normalize(value)}:${platformId}`)
  for (const key of profileKeys) {
    if (index.byProfile.has(key)) return index.byProfile.get(key)
  }
  const accountKeys = [account.name, account.dashboardName, account.id]
    .filter(Boolean)
    .map(value => `${normalize(value)}:${platformId}`)
  for (const key of accountKeys) {
    if (index.byAccount.has(key)) return index.byAccount.get(key)
  }
  return null
}

function createAccountRow(seed = {}) {
  return {
    id: seed.id || seed.accountId || seed.account || seed.profile || 'unknown',
    accountId: seed.accountId || seed.id || '',
    account: readableText(seed.account, seed.name, seed.account_name, seed.id, seed.profile, '未命名账号'),
    sourceLabel: seed.sourceLabel || '',
    groupId: Number(seed.groupId) || 0,
    groupName: seed.groupName || '待接入',
    owner: seed.owner || '',
    enabled: Boolean(seed.dataProfile),
    dataProfile: seed.dataProfile || seed.dataProfileAlias || '',
    dataProfileDirectory: seed.dataProfileDirectory || '',
    platformIds: [],
    platformLabels: [],
    publishProfiles: [],
    platforms: [],
    lastCollectedAt: '',
    hasLoginIssue: false,
    hasUnknownLogin: false,
    hasCollectData: false
  }
}

function addOrUpdatePlatform(account, platform) {
  const existing = account.platforms.find(item => item.id === platform.id)
  const next = existing || { id: platform.id }
  Object.assign(next, platform)
  const state = loginState(next.loginStatus)
  next.loginLabel = state.label
  next.loginClass = state.className
  next.title = [
    next.handle,
    next.publishProfile ? `发布 Profile: ${next.publishProfile}` : '',
    next.publishProfileDirectory ? `Chrome: ${next.publishProfileDirectory}` : '',
    state.raw ? `登录状态: ${state.raw}` : ''
  ].filter(Boolean).join('\n')
  if (!existing) account.platforms.push(next)
}

function finalizeAccountRows(rowMap) {
  const rows = Array.from(new Set(rowMap.values()))
  for (const account of rows) {
    account.platforms.sort((a, b) => a.id.localeCompare(b.id))
    account.platformIds = unique(account.platforms.map(platform => platform.id))
    account.platformLabels = unique(account.platforms.map(platform => platform.label))
    account.publishProfiles = unique(account.platforms.map(platform => platform.publishProfile))
    account.lastCollectedAt = latestText(account.platforms.map(platform => platform.lastCollectedAt))
    account.hasLoginIssue = account.platforms.some(platform => platform.loginClass === 'warn')
    account.hasUnknownLogin = account.platforms.some(platform => platform.loginClass === 'unknown')
    account.hasCollectData = account.platforms.some(platform => Boolean(platform.lastCollectedAt))
    account.enabled = Boolean(account.dataProfile)
    account.displayPlatforms = account.platforms.slice(0, 3)
    account.platformExtraCount = Math.max(0, account.platforms.length - account.displayPlatforms.length)
    account.platformSummaryTitle = account.platforms
      .map(platform => [platform.label, platform.loginLabel].filter(Boolean).join(' · '))
      .join('\n')
  }
  return rows
}

function registerAccountRow(rowMap, row, aliases = []) {
  for (const alias of aliases) {
    const key = normalize(alias)
    if (key) rowMap.set(key, row)
  }
}

function findAccountRow(rowMap, aliases = []) {
  for (const alias of aliases) {
    const row = rowMap.get(normalize(alias))
    if (row) return row
  }
  return null
}

function seedScheduleAccounts(rowMap) {
  for (const group of GROUPS || []) {
    for (const accountName of group.accounts || []) {
      if (!accountName || accountName === '素材') continue
      const existing = findAccountRow(rowMap, [accountName])
      if (existing) continue
      const row = createAccountRow({
        id: `schedule:${group.id}:${accountName}`,
        account: accountName,
        groupId: group.id,
        groupName: group.label
      })
      registerAccountRow(rowMap, row, [row.id, accountName])
    }
  }
}

function buildAccountRows(catalogAccounts = [], bindingRows = [], dashboardAccounts = []) {
  const bindingByKey = new Map()
  for (const row of bindingRows || []) {
    bindingByKey.set(bindingKey(row.account_id, row.platform_id), row)
  }
  const dashboardIndex = buildDashboardIndex(dashboardAccounts)
  const rowMap = new Map()
  seedScheduleAccounts(rowMap)

  for (const account of catalogAccounts || []) {
    const row = findAccountRow(rowMap, [
      account.name,
      account.dashboardName,
      account.id,
      ...(account.profileAliases || []),
      ...(account.platforms || []).map(platform => platform.profile_alias || platform.profile)
    ])
    if (!row) continue
    row.accountId = account.id || row.accountId
    row.owner = row.owner || account.owner || ''
    row.dataProfile = account.dataProfileAlias || row.dataProfile
    row.dataProfileDirectory = account.dataProfileDirectory || row.dataProfileDirectory
    for (const platform of account.platforms || []) {
      const key = bindingKey(account.id, platform.id)
      const binding = bindingByKey.get(key) || {}
      const publishProfile = binding.profile_alias || platform.profile_alias || platform.profile || ''
      const publishProfileDirectory = platform.chrome_profile_directory || platform.chromeProfileDirectory || ''
      const dataProfile = account.dataProfileAlias || ''
      const dashboardRow = findDashboardRow(dashboardIndex, account, platform, publishProfile, dataProfile)
      addOrUpdatePlatform(row, {
        id: platform.id,
        label: platformLabel(platform),
        handle: binding.platform_handle || platform.handle || '',
        publishProfile,
        publishProfileDirectory,
        loginStatus: binding.login_status || platform.login_status || platform.status || 'unknown',
        collectStatus: dashboardRow?.collectStatus || '',
        lastCollectedAt: dashboardRow?.lastCollectedAt || ''
      })
    }
    registerAccountRow(rowMap, row, [
      row.id,
      row.accountId,
      row.account,
      account.dashboardName,
      ...(account.profileAliases || []),
      ...(account.platforms || []).map(platform => platform.profile_alias || platform.profile)
    ])
  }

  for (const dashboardRow of dashboardAccounts || []) {
    const row = findAccountRow(rowMap, [dashboardRow.account, dashboardRow.knownProfile, dashboardRow.profile])
    if (!row) continue
    addOrUpdatePlatform(row, {
      id: dashboardRow.platform || 'unknown',
      label: dashboardRow.platformLabel || dashboardRow.platform || '未知平台',
      publishProfile: dashboardRow.profile || '',
      loginStatus: 'unknown',
      collectStatus: dashboardRow.collectStatus || '',
      lastCollectedAt: dashboardRow.lastCollectedAt || ''
    })
  }

  return finalizeAccountRows(rowMap)
}

async function loadAccounts() {
  loading.value = true
  error.value = ''
  try {
    const [publishData, dashboardData] = await Promise.all([
      listVideoPublishAccounts({ includeProfiles: false }),
      loadAccountDataDashboard()
    ])
    const catalog = Array.isArray(publishData.catalog_accounts) ? publishData.catalog_accounts : []
    const bindings = Array.isArray(publishData.accounts) ? publishData.accounts : []
    const dashboardRows = Array.isArray(dashboardData.accounts) ? dashboardData.accounts : []
    collectionFailures.value = (Array.isArray(dashboardData.collectionFailures) ? dashboardData.collectionFailures : [])
      .map((item, index) => ({
        key: `${item.account || ''}:${item.platform || ''}:${item.dataset || ''}:${index}`,
        account: item.account || '数据采集账号',
        groupName: item.groupName || '待接入',
        message: item.message || item.error || '采集失败'
      }))
    accounts.value = buildAccountRows(catalog, bindings, dashboardRows)
    if (!accounts.value.length) error.value = '后端账号目录为空'
  } catch (err) {
    accounts.value = []
    collectionFailures.value = []
    error.value = err?.message || '读取账号目录失败'
  } finally {
    loading.value = false
  }
}

function accountStatusClass(account) {
  if (account.sourceLabel === '未入目录' && account.platforms.length === 1 && account.platforms[0].id === 'profile') {
    if (account.hasLoginIssue) return 'warn'
    if (account.hasUnknownLogin) return 'empty'
    return 'ok'
  }
  if (!account.platforms.length || !account.dataProfile || !account.publishProfiles.length) return 'empty'
  if (account.hasLoginIssue || account.hasUnknownLogin) return 'warn'
  return 'ok'
}

function accountStatusLabel(account) {
  if (!account.platforms.length) return '待接入'
  if (account.sourceLabel === '未入目录' && account.platforms.length === 1 && account.platforms[0].id === 'profile') {
    if (account.hasLoginIssue) return '离线'
    if (account.hasUnknownLogin) return '待检测'
    return '在线'
  }
  if (!account.publishProfiles.length || !account.dataProfile) return '待配置'
  if (account.hasLoginIssue) return '需处理'
  if (account.hasUnknownLogin) return '待检测'
  return account.hasCollectData ? '正常' : '待采集'
}

onMounted(loadAccounts)
</script>

<style scoped>
.account-pool-module {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 100%;
  color: var(--text);
}

.account-pool-head {
  align-items: center;
}

.pool-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.pool-select {
  width: 124px;
  height: 32px;
}

.pool-search {
  width: 210px;
  height: 32px;
}

.pool-refresh {
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 0 12px;
  background: var(--surface2);
  color: var(--text);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.pool-refresh:disabled {
  cursor: wait;
  opacity: .62;
}

.pool-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.pool-summary article,
.pool-table-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  box-shadow: 0 12px 30px rgba(16, 24, 40, .07);
}

.pool-summary article {
  min-height: 78px;
  padding: 13px 14px;
  display: grid;
  gap: 6px;
}

.pool-summary span {
  color: var(--text-muted);
  font-size: 12px;
}

.pool-summary strong {
  font-size: 24px;
  line-height: 1;
}

.collect-alert {
  border: 1px solid color-mix(in srgb, #f59f00 36%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, #f59f00 10%, var(--surface));
  color: var(--text);
  min-height: 42px;
  padding: 9px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
}

.collect-alert strong {
  color: #e67700;
  font-size: 12px;
  font-weight: 900;
}

.collect-alert span {
  color: var(--text-dim);
}

.pool-table-wrap {
  overflow: auto;
  padding: 10px;
}

.pool-table {
  min-width: 940px;
  display: grid;
  gap: 3px;
}

.pool-table-head,
.pool-table-row {
  display: grid;
  grid-template-columns: minmax(128px, 1.2fr) minmax(150px, 1fr) 92px 84px 58px 132px 78px;
  gap: 8px;
  align-items: center;
  min-height: 36px;
  padding: 0 10px;
}

.pool-table-head {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 900;
  border-bottom: 1px solid var(--border);
}

.pool-table-row {
  border-radius: 7px;
  background: color-mix(in srgb, var(--surface2) 58%, transparent);
  font-size: 12px;
}

.account-name {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.account-name small {
  flex: 0 0 auto;
  padding: 2px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, #f59f00 14%, var(--surface));
  color: #e67700;
  font-size: 10px;
  font-weight: 900;
}

.pool-table-message {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--surface2) 58%, transparent);
  color: var(--text-muted);
  font-size: 12px;
}

.pool-table-message.error {
  color: #d6336c;
}

.platform-stack {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  overflow: hidden;
}

.platform-chip {
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, #2f80ed 10%, var(--surface));
  color: #2f80ed;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 900;
  line-height: 1;
}

.platform-chip.bilibili {
  background: color-mix(in srgb, #e64980 12%, var(--surface));
  color: #d6336c;
}

.platform-chip.kuaishou {
  background: color-mix(in srgb, #f59f00 14%, var(--surface));
  color: #e67700;
}

.platform-chip.xiaohongshu {
  background: color-mix(in srgb, #fa5252 12%, var(--surface));
  color: #e03131;
}

.platform-chip.wechatVideo {
  background: color-mix(in srgb, #12b886 12%, var(--surface));
  color: #087f5b;
}

.platform-chip.warn {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #f59f00 42%, transparent);
}

.platform-chip.unknown {
  color: var(--text-muted);
  background: color-mix(in srgb, var(--text-muted) 10%, var(--surface));
}

.platform-chip.more {
  color: var(--text);
  background: color-mix(in srgb, var(--text-muted) 12%, var(--surface));
}

.platform-pill {
  width: fit-content;
  min-width: 46px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
  background: color-mix(in srgb, #2f80ed 15%, var(--surface));
  color: #2f80ed;
}

.platform-pill.bilibili {
  background: color-mix(in srgb, #e64980 15%, var(--surface));
  color: #d6336c;
}

.platform-pill.kuaishou {
  background: color-mix(in srgb, #f59f00 18%, var(--surface));
  color: #e67700;
}

.platform-pill.xiaohongshu {
  background: color-mix(in srgb, #fa5252 15%, var(--surface));
  color: #e03131;
}

.platform-pill.wechatVideo {
  background: color-mix(in srgb, #12b886 15%, var(--surface));
  color: #087f5b;
}

.switch {
  width: 42px;
  height: 24px;
  position: relative;
  display: inline-flex;
}

.switch input {
  position: absolute;
  opacity: 0;
}

.switch i {
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: var(--border);
  transition: background .15s ease;
}

.switch i:before {
  content: "";
  position: absolute;
  width: 18px;
  height: 18px;
  left: 3px;
  top: 3px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .2);
  transition: transform .15s ease;
}

.switch input:checked + i {
  background: #00a67e;
}

.switch input:checked + i:before {
  transform: translateX(18px);
}

.switch input:disabled + i {
  opacity: .72;
}

.profile-cell {
  color: var(--text-dim);
  font-family: SF Mono, Consolas, monospace;
  font-size: 11px;
  display: grid;
  gap: 3px;
  line-height: 1.15;
}

.profile-cell > span {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-cell span,
.profile-cell em,
.profile-cell i {
  font-style: normal;
}

.profile-cell b {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--text-muted) 14%, var(--surface));
  color: var(--text);
  font-family: inherit;
  font-size: 10px;
}

.profile-values {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.profile-values i {
  max-width: 128px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-cell small {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 10px;
}

.profile-cell.empty {
  color: var(--text-muted);
}

.pool-table-row > em {
  width: fit-content;
  min-width: 52px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  border-radius: 999px;
  font-style: normal;
  font-size: 11px;
  font-weight: 900;
}

.pool-table-row > em.ok {
  background: color-mix(in srgb, #00a67e 15%, var(--surface));
  color: #008767;
}

.pool-table-row > em.warn {
  background: color-mix(in srgb, #f59f00 18%, var(--surface));
  color: #e67700;
}

.pool-table-row > em.empty {
  background: color-mix(in srgb, var(--text-muted) 14%, var(--surface));
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .account-pool-head {
    align-items: stretch;
    flex-direction: column;
  }

  .pool-actions {
    justify-content: flex-start;
  }

  .pool-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
