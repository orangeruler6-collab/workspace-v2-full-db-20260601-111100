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
        </select>
        <select v-model="groupFilter" class="inp pool-select">
          <option value="all">全部小组</option>
          <option v-for="group in groupOptions" :key="group" :value="group">{{ group }}</option>
        </select>
        <input v-model.trim="keyword" class="inp pool-search" placeholder="搜索账号 / profile" />
      </div>
    </header>

    <section class="pool-summary">
      <article v-for="item in poolSummary" :key="item.label">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </section>

    <section class="pool-table-wrap">
      <div class="pool-table">
        <div class="pool-table-head">
          <span>账号</span>
          <span>平台</span>
          <span>小组</span>
          <span>负责人</span>
          <span>采集</span>
          <span>Profile</span>
          <span>最近采集</span>
          <span>状态</span>
        </div>
        <div v-for="account in filteredAccounts" :key="account.id" class="pool-table-row">
          <strong>{{ account.account }}</strong>
          <span class="platform-pill" :class="account.platform">{{ account.platformLabel }}</span>
          <span>{{ account.groupName }}</span>
          <span>{{ account.owner }}</span>
          <label class="switch">
            <input v-model="account.enabled" type="checkbox" />
            <i></i>
          </label>
          <span class="profile-cell">{{ account.profile || '待绑定' }}</span>
          <span>{{ account.lastCollectedAt || '-' }}</span>
          <em :class="statusClass(account)">{{ account.collectStatus }}</em>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { accountDataMock } from './account-data/mockData'

const accounts = reactive(accountDataMock.map(item => ({ ...item })))
const platformFilter = ref('all')
const groupFilter = ref('all')
const keyword = ref('')

const groupOptions = computed(() => Array.from(new Set(accounts.map(item => item.groupName))))

const filteredAccounts = computed(() => {
  const word = keyword.value.toLowerCase()
  return accounts
    .filter(item => platformFilter.value === 'all' || item.platform === platformFilter.value)
    .filter(item => groupFilter.value === 'all' || item.groupName === groupFilter.value)
    .filter(item => {
      if (!word) return true
      return item.account.toLowerCase().includes(word) || item.profile.toLowerCase().includes(word)
    })
    .sort((a, b) => a.groupId - b.groupId || a.platform.localeCompare(b.platform) || a.account.localeCompare(b.account, 'zh-CN'))
})

const poolSummary = computed(() => {
  const visible = filteredAccounts.value
  const enabled = visible.filter(item => item.enabled).length
  const bound = visible.filter(item => item.profile).length
  const douyin = visible.filter(item => item.platform === 'douyin').length
  return [
    { label: '当前账号', value: visible.length },
    { label: '启用采集', value: enabled },
    { label: '已绑 Profile', value: bound },
    { label: '抖音账号', value: douyin }
  ]
})

function statusClass(account) {
  if (!account.profile) return 'empty'
  if (account.collectStatus === '待复核') return 'warn'
  return 'ok'
}
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

.pool-table-wrap {
  overflow: auto;
  padding: 10px;
}

.pool-table {
  min-width: 1040px;
  display: grid;
  gap: 3px;
}

.pool-table-head,
.pool-table-row {
  display: grid;
  grid-template-columns: minmax(120px, 1.1fr) 72px 90px 84px 62px minmax(138px, 1fr) 132px 72px;
  gap: 10px;
  align-items: center;
  min-height: 38px;
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

.profile-cell {
  color: var(--text-dim);
  font-family: SF Mono, Consolas, monospace;
  font-size: 11px;
}

.pool-table-row em {
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

.pool-table-row em.ok {
  background: color-mix(in srgb, #00a67e 15%, var(--surface));
  color: #008767;
}

.pool-table-row em.warn {
  background: color-mix(in srgb, #f59f00 18%, var(--surface));
  color: #e67700;
}

.pool-table-row em.empty {
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
