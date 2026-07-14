<template>
  <section class="style-workbench-native">
    <div class="page gross-margin-page">
      <header class="page-header">
        <div class="page-title-group">
          <span class="page-title-eyebrow">维护配置台</span>
          <div class="page-title-row">
            <span class="page-title-mark" aria-hidden="true">维</span>
            <div class="page-title-copy">
              <h1>{{ moduleId === 'trafficApply' ? '投流申请' : '数据维护' }}</h1>
              <p class="subtle">单价、数量、毛利。</p>
            </div>
          </div>
        </div>
        <div class="page-header-meta">
          <span class="stat-pill">2 个平台</span>
          <span class="stat-pill">{{ configuredPriceCount }} 个单价已填</span>
          <button class="btn ghost" type="button" :disabled="loading" @click="loadAll">
            <span class="style-workbench-icon" aria-hidden="true">↻</span>
            {{ loading ? '刷新中' : '刷新' }}
          </button>
        </div>
      </header>

      <div v-if="error" class="error" role="alert">{{ error }}</div>

      <section class="panel three-pane gross-margin-workspace" aria-label="数据维护工作区">
        <aside class="pane gross-price-pane">
          <div class="pane-header">
            <div>
              <h2>平台单价表</h2>
              <p class="pane-subtitle">默认单价</p>
            </div>
            <button class="btn compact" type="button" :disabled="savingTable" @click="saveTable">
              {{ savingTable ? '保存中' : '保存' }}
            </button>
          </div>
          <div class="pane-body">
            <div class="source-tabs gross-platform-tabs" role="group" aria-label="选择平台">
              <button type="button" :class="{ active: platform === 'douyin' }" @click="setPlatform('douyin')">抖音</button>
              <button type="button" :class="{ active: platform === 'bilibili' }" @click="setPlatform('bilibili')">B站</button>
            </div>

            <div v-if="priceItems.length" class="gross-price-groups">
              <section
                v-for="group in priceGroups"
                :key="group.service"
                class="gross-price-group"
                :class="{ 'gross-price-group-compact': group.items.length === 1 }">
                <h3>{{ group.label }}</h3>
                <div class="gross-price-option-list">
                  <label v-for="item in group.items" :key="item.id" class="gross-price-option">
                    <span>{{ item.name }}</span>
                    <span class="gross-price-input">
                      <input v-model.number="item.unitPrice" min="0" type="number" />
                      <small>元</small>
                    </span>
                  </label>
                </div>
              </section>
            </div>
            <div v-else class="empty-state-panel panel">
              <div class="panel-inner">
                <span class="empty-state-mark">价</span>
                <p class="subtle">单价表还没有初始化，请刷新后重试。</p>
              </div>
            </div>

            <button class="btn primary" type="button" :disabled="savingTable || !priceItems.length" @click="saveTable">
              <span class="style-workbench-icon" aria-hidden="true">✓</span>
              {{ savingTable ? '保存中' : '保存单价表' }}
            </button>
          </div>
        </aside>

        <section class="pane gross-maintenance-pane">
          <div class="pane-header">
            <div>
              <h2>{{ platformLabel(platform) }}本次维护</h2>
              <p class="pane-subtitle">价格与数量</p>
            </div>
          </div>
          <div class="pane-body">
            <div class="detail-section gross-price-summary-form">
              <div class="gross-account-row">
                <label class="field">
                  <span>账号名</span>
                  <input v-model="monitorForm.accountName" autocomplete="off" placeholder="输入账号名…" />
                </label>
                <label class="field">
                  <span>视频链接</span>
                  <input v-model="monitorForm.videoUrl" autocomplete="off" placeholder="粘贴视频链接，保存监控时会带上…" />
                </label>
              </div>
              <div class="gross-price-summary-grid">
                <label class="field">
                  <span>折前价格</span>
                  <input v-model.number="originalPrice" min="0" type="number" placeholder="原档位价格…" />
                </label>
                <label class="field">
                  <span>折扣率</span>
                  <span class="gross-rate-input">
                    <input v-model.number="discountRate" min="0" type="number" placeholder="可不填…" />
                    <small>%</small>
                  </span>
                </label>
                <label class="field">
                  <span>折后价格</span>
                  <input v-model.number="discountPrice" min="0" type="number" placeholder="实际报价…" />
                </label>
              </div>
            </div>

            <div class="gross-maintenance-table-wrap">
              <table class="gross-maintenance-table">
                <thead>
                  <tr>
                    <th>维护项</th>
                    <th>类型</th>
                    <th>数量</th>
                    <th>单价</th>
                    <th>小计</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in priceItems" :key="item.id">
                    <td>
                      <strong>{{ serviceLabel(item.service) }}</strong>
                      <span>{{ item.name }}</span>
                    </td>
                    <td>{{ item.name }}</td>
                    <td>
                      <span class="gross-quantity-input">
                        <input v-model.number="quantityInputs[item.id]" min="0" type="number" />
                        <small>{{ item.quantityUnit || '个' }}</small>
                      </span>
                    </td>
                    <td>{{ formatMoney(item.unitPrice) }}</td>
                    <td>{{ formatMoney(lineSubtotal(item)) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside class="pane gross-result-pane">
          <div class="pane-header">
            <div>
              <h2>结果</h2>
              <p class="pane-subtitle">实时汇总与导出</p>
            </div>
          </div>
          <div class="pane-body">
            <div class="gross-result-panel maintenance">
              <span>维护成本</span>
              <strong>{{ formatMoney(maintenanceCost) }}</strong>
              <small>{{ activeQuantityCount }} 个项目已录入数量</small>
            </div>

            <div class="gross-result-panel" :class="grossTone">
              <span>毛利率</span>
              <strong>{{ formatPercent(grossMarginRate) }}</strong>
              <small>{{ formatMoney(grossProfit) }} 毛利额</small>
            </div>

            <div class="gross-result-grid">
              <div class="metric-item"><span>折前价格</span><strong>{{ formatMoney(originalPrice) }}</strong></div>
              <div class="metric-item"><span>折后价格</span><strong>{{ formatMoney(effectiveDiscountPrice) }}</strong></div>
              <div class="metric-item"><span>折扣率</span><strong>{{ formatPercent(effectiveDiscountRate) }}</strong></div>
              <div class="metric-item"><span>成本占折前</span><strong>{{ formatPercent(costRate) }}</strong></div>
            </div>

            <div class="gross-result-tools">
              <button class="gross-template-entry" type="button">
                <span class="gross-template-entry-copy">
                  <span class="style-workbench-icon" aria-hidden="true">文</span>
                  <span>
                    <strong>监控文案</strong>
                    <small>{{ reviewTextLines }} 行，按当前维护项生成</small>
                  </span>
                </span>
                <strong class="gross-template-entry-action">预览</strong>
              </button>
              <textarea class="gross-bulk-monitor-input" v-model="monitorForm.sourceText" placeholder="维护目标文案"></textarea>
            </div>

            <div class="gross-action-panel">
              <div class="gross-action-grid">
                <button class="btn" type="button" :disabled="savingRecord" @click="copyReviewText">复制文案</button>
                <button class="btn" type="button" :disabled="!monitorRecords.length">监控 {{ monitorRecords.length }}</button>
                <button class="btn primary gross-export-primary" type="button" :disabled="savingRecord" @click="saveMonitor">
                  {{ savingRecord ? '保存中' : '保存监控' }}
                </button>
              </div>
            </div>

            <section class="detail-section">
              <div class="section-title-row">
                <h3>最近监控</h3>
                <span class="status-pill">{{ monitorRecords.length }} 条</span>
              </div>
              <article v-for="record in monitorRecords.slice(0, 3)" :key="record.id" class="gross-monitor-card" :class="{ 'high-risk': record.highRisk }">
                <div class="gross-monitor-card-copy">
                  <span class="gross-monitor-eyebrow"><em>{{ platformLabel(record.platform) }}</em>{{ record.status }}</span>
                  <strong>{{ record.accountName || record.projectName || '未命名' }}</strong>
                </div>
                <div class="button-row">
                  <button class="btn compact" type="button" :disabled="refreshingId === record.id" @click="refreshRecord(record.id)">
                    {{ refreshingId === record.id ? '刷新中' : '刷新数据' }}
                  </button>
                  <button class="btn danger compact" type="button" @click="deleteRecord(record.id)">删除</button>
                </div>
              </article>
            </section>
          </div>
        </aside>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  deleteGrossMarginMonitorRecord,
  loadGrossMarginLibrary,
  refreshGrossMarginMonitorRecord,
  saveGrossMarginMonitorRecord,
  saveGrossMarginPriceTable
} from '../api/styleWorkbench'

defineProps({
  moduleId: { type: String, default: 'styleGrossMargin' },
  currentUser: { type: Object, default: null },
  trafficContext: { type: Object, default: null },
  trafficPlans: { type: Array, default: () => [] }
})

const serviceLabels = {
  play: '播放',
  like: '点赞',
  favorite: '收藏',
  share: '转发',
  comment: '评论',
  danmaku: '弹幕',
  douPlus: 'dou+',
  coin: '投币',
  blueLink: '蓝链点击'
}

const loading = ref(false)
const savingTable = ref(false)
const savingRecord = ref(false)
const refreshingId = ref('')
const error = ref('')
const library = ref(null)
const platform = ref('douyin')
const priceItems = ref([])
const quantityInputs = reactive({})
const originalPrice = ref(0)
const discountRate = ref(0)
const discountPrice = ref(0)
const monitorForm = reactive({
  platform: 'douyin',
  accountName: '',
  videoUrl: '',
  sourceText: '',
  targetStats: {}
})

const activeTable = computed(() => library.value?.tables?.find((table) => table.platform === platform.value))
const monitorRecords = computed(() => library.value?.monitorRecords || [])
const configuredPriceCount = computed(() => priceItems.value.filter((item) => Number(item.unitPrice) > 0).length)
const priceGroups = computed(() => {
  const groups = new Map()
  for (const item of priceItems.value) {
    const service = item.service || item.kind || item.id
    if (!groups.has(service)) groups.set(service, { service, label: serviceLabel(service), items: [] })
    groups.get(service).items.push(item)
  }
  return Array.from(groups.values())
})
const activeQuantityCount = computed(() => priceItems.value.filter((item) => Number(quantityInputs[item.id] || 0) > 0).length)
const maintenanceCost = computed(() => priceItems.value.reduce((sum, item) => sum + lineSubtotal(item), 0))
const effectiveDiscountPrice = computed(() => Number(discountPrice.value || 0) || Number(originalPrice.value || 0) * Number(discountRate.value || 0) / 100)
const grossProfit = computed(() => effectiveDiscountPrice.value - maintenanceCost.value)
const grossMarginRate = computed(() => effectiveDiscountPrice.value > 0 ? grossProfit.value / effectiveDiscountPrice.value : 0)
const effectiveDiscountRate = computed(() => Number(originalPrice.value || 0) > 0 ? effectiveDiscountPrice.value / Number(originalPrice.value || 0) : 0)
const costRate = computed(() => Number(originalPrice.value || 0) > 0 ? maintenanceCost.value / Number(originalPrice.value || 0) : 0)
const grossTone = computed(() => {
  if (grossMarginRate.value < 0) return 'negative'
  if (grossMarginRate.value < 0.2) return 'warning'
  return 'positive'
})
const reviewText = computed(() => {
  const lines = [
    `账号：${monitorForm.accountName || '未填写'}`,
    `视频：${monitorForm.videoUrl || '未填写'}`,
    `折后价格：${formatMoney(effectiveDiscountPrice.value)}`,
    `维护成本：${formatMoney(maintenanceCost.value)}`,
    `毛利率：${formatPercent(grossMarginRate.value)}`
  ]
  for (const item of priceItems.value) {
    const quantity = Number(quantityInputs[item.id] || 0)
    if (quantity > 0) lines.push(`${serviceLabel(item.service)}-${item.name}：${quantity}${item.quantityUnit || '个'}，${formatMoney(lineSubtotal(item))}`)
  }
  return lines.join('\n')
})
const reviewTextLines = computed(() => reviewText.value.split('\n').length)

watch(activeTable, (table) => {
  priceItems.value = (table?.items || []).map((item) => ({ ...item }))
  for (const item of priceItems.value) {
    if (!(item.id in quantityInputs)) quantityInputs[item.id] = ''
  }
}, { immediate: true })

watch(platform, (value) => {
  monitorForm.platform = value
})

watch(reviewText, (value) => {
  if (!monitorForm.sourceText.trim()) monitorForm.sourceText = value
})

onMounted(loadAll)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    library.value = await loadGrossMarginLibrary()
  } catch (err) {
    error.value = err.message || '毛利数据读取失败'
  } finally {
    loading.value = false
  }
}

function setPlatform(value) {
  platform.value = value
}

async function saveTable() {
  savingTable.value = true
  error.value = ''
  try {
    const result = await saveGrossMarginPriceTable({ platform: platform.value, items: priceItems.value })
    library.value = result.library
  } catch (err) {
    error.value = err.message || '单价表保存失败'
  } finally {
    savingTable.value = false
  }
}

async function saveMonitor() {
  if (!monitorForm.videoUrl.trim() || !monitorForm.sourceText.trim()) {
    error.value = '请填写视频链接和维护目标文案'
    return
  }
  savingRecord.value = true
  error.value = ''
  try {
    const result = await saveGrossMarginMonitorRecord({
      ...monitorForm,
      targetStats: buildTargetStats()
    })
    library.value = result.library
    monitorForm.videoUrl = ''
    monitorForm.sourceText = reviewText.value
  } catch (err) {
    error.value = err.message || '监控保存失败'
  } finally {
    savingRecord.value = false
  }
}

async function refreshRecord(recordId) {
  refreshingId.value = recordId
  error.value = ''
  try {
    const result = await refreshGrossMarginMonitorRecord(recordId)
    library.value = result.library
  } catch (err) {
    error.value = err.message || '刷新失败'
  } finally {
    refreshingId.value = ''
  }
}

async function deleteRecord(recordId) {
  try {
    const result = await deleteGrossMarginMonitorRecord(recordId)
    library.value = result.library
  } catch (err) {
    error.value = err.message || '删除失败'
  }
}

async function copyReviewText() {
  monitorForm.sourceText = reviewText.value
  await navigator.clipboard?.writeText(reviewText.value).catch(() => {})
}

function buildTargetStats() {
  const entries = priceItems.value
    .filter((item) => Number(quantityInputs[item.id] || 0) > 0)
    .map((item) => [item.service || item.id, Number(quantityInputs[item.id] || 0)])
  return Object.fromEntries(entries)
}

function lineSubtotal(item) {
  return Number(quantityInputs[item.id] || 0) * Number(item.unitPrice || 0)
}

function serviceLabel(value) {
  return serviceLabels[value] || value || '维护项'
}

function platformLabel(value) {
  return value === 'bilibili' ? 'B站' : '抖音'
}

function formatMoney(value) {
  const number = Number(value || 0)
  return `¥${number.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

function formatPercent(value) {
  const number = Number(value || 0)
  return `${(number * 100).toFixed(1)}%`
}
</script>
