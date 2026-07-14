<template>
  <div class="card tool-card play-count-card">
    <div class="card-hdr play-count-hdr">
      <span class="tool-icon play-count-icon" aria-hidden="true">播</span>
      <div class="card-title-group play-count-title">
        <span class="card-title">播放查询</span>
      </div>
      <span class="cooldown-pill" :class="{ active: cooldownSeconds > 0 }">
        {{ cooldownSeconds > 0 ? formatCooldown(cooldownSeconds) : '可查' }}
      </span>
    </div>

    <div class="card-body">
      <div class="play-query-panel" :class="{ busy: playLoading, cooling: cooldownSeconds > 0 }">
        <textarea
          v-model="playInput"
          class="inp play-input"
          rows="3"
          placeholder="粘贴抖音口令、短链或视频链接"
          @keydown.enter.ctrl.prevent="handleQuery"
        />
        <button class="btn btn-primary play-query-btn" :disabled="!canQuery" @click="handleQuery">
          <span class="query-btn-icon">{{ playLoading ? '...' : cooldownSeconds > 0 ? 'CD' : '查' }}</span>
          <span>{{ playLoading ? '查询中' : cooldownSeconds > 0 ? '冷却中' : '查询' }}</span>
        </button>
      </div>

      <div v-if="lastResult" class="play-result-grid">
        <div class="play-metric">
          <span>综合播放</span>
          <strong>{{ formatCompactNumber(lastResult.comprehensivePlayCount || lastResult.comprehensive_play_count) }}</strong>
          <small v-if="shouldShowExact(lastResult.comprehensivePlayCount || lastResult.comprehensive_play_count)">
            具体 {{ formatNumber(lastResult.comprehensivePlayCount || lastResult.comprehensive_play_count) }}
          </small>
        </div>
        <div class="play-metric natural">
          <span>自然播放</span>
          <strong>{{ formatCompactNumber(lastResult.naturalPlayCount || lastResult.natural_play_count) }}</strong>
          <small v-if="shouldShowExact(lastResult.naturalPlayCount || lastResult.natural_play_count)">
            具体 {{ formatNumber(lastResult.naturalPlayCount || lastResult.natural_play_count) }}
          </small>
        </div>
        <div class="play-verdict">
          {{ lastResult.verdict || '结果仅供投放判断参考' }}
        </div>
      </div>

      <div v-if="playError" class="result-box error-box play-error">{{ playError }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getDouyinPlayCountStatus, queryDouyinPlayCount } from '../../api/tools'
import { useToast } from '../../composables/useToast'

const { showToast } = useToast()
const playInput = ref('')
const playLoading = ref(false)
const playError = ref('')
const lastResult = ref(null)
const nextAvailableAt = ref('')
const cooldownKey = ref('')
const now = ref(Date.now())
let timer = null

const cooldownSeconds = computed(() => {
  if (!nextAvailableAt.value) return 0
  const inputKey = normalizePlayCountKey(playInput.value)
  if (!inputKey || inputKey !== cooldownKey.value) return 0
  return Math.max(0, Math.ceil((Date.parse(nextAvailableAt.value) - now.value) / 1000))
})

const canQuery = computed(() => Boolean(playInput.value.trim()) && !playLoading.value && cooldownSeconds.value <= 0)

watch(playInput, (value) => {
  const inputKey = normalizePlayCountKey(value)
  if (inputKey && inputKey !== cooldownKey.value) {
    nextAvailableAt.value = ''
    cooldownKey.value = ''
    if (!playLoading.value) playError.value = ''
  }
})

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
  loadStatus()
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})

async function loadStatus() {
  try {
    const data = await getDouyinPlayCountStatus()
    syncState(data)
  } catch (e) {
    playError.value = e?.message || '播放量查询状态读取失败'
  }
}

async function handleQuery() {
  if (!playInput.value.trim()) {
    playError.value = '请先粘贴抖音视频链接或分享口令'
    return
  }
  playLoading.value = true
  playError.value = ''
  const requestedInput = playInput.value
  try {
    const data = await queryDouyinPlayCount(requestedInput)
    syncState(data, requestedInput)
    if (data.reason === 'cooldown') {
      playError.value = '查询冷却中，' + formatCooldown(data.cooldownSeconds || data.cooldown_seconds || 0) + ' 后可用'
      return
    }
    if (data.reason === 'running') {
      playError.value = '上一条播放量查询还在进行中，请稍等'
      return
    }
    if (data.reason === 'cloudflare') {
      playError.value = data.message || 'Cloudflare 验证未通过，已关闭浏览器，请重试一次'
      return
    }
    if (data.result) {
      lastResult.value = data.result
      showToast('播放量查询完成', 'success')
    }
  } catch (e) {
    const data = e?.data || {}
    syncState(data, requestedInput)
    if (data.reason === 'cooldown') {
      playError.value = '这条视频查询冷却中，' + formatCooldown(data.cooldownSeconds || data.cooldown_seconds || 0) + ' 后可再次查询'
    } else {
      playError.value = e?.message || '播放量查询失败'
    }
  } finally {
    playLoading.value = false
  }
}

function syncState(data = {}, requestedInput = '') {
  const result = data.result || data.lastResult || data.last_result || null
  if (result) lastResult.value = result
  nextAvailableAt.value = data.nextAvailableAt || data.next_available_at || result?.nextAvailableAt || result?.next_available_at || ''
  if (nextAvailableAt.value) {
    cooldownKey.value = data.reason === 'cooldown'
      ? normalizePlayCountKey(requestedInput)
      : String(result?.key || normalizePlayCountKey(result?.input || requestedInput))
  }
}

function normalizePlayCountKey(value) {
  const text = String(value || '').trim()
  const awemeId = text.match(/douyin\.com\/video\/(\d{15,20})/i)?.[1]
    || text.match(/(^|\D)(\d{15,20})(?!\d)/)?.[2]
  if (awemeId) return awemeId
  const url = text.match(/https?:\/\/(?:[a-z0-9-]+\.)?(?:douyin|iesdouyin)\.com\/[^\s"'<>，。！？；：、）】》」』\]\)}]+/i)?.[0]
  return String(url || text).toLowerCase().replace(/[?#].*$/, '')
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function formatCompactNumber(value) {
  const number = Number(value || 0)
  if (number < 10000) return formatNumber(number)
  const wan = number / 10000
  const digits = wan >= 100 ? 0 : 1
  return wan.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }) + '万'
}

function shouldShowExact(value) {
  return Number(value || 0) >= 10000
}

function formatCooldown(seconds) {
  const safe = Math.max(0, Math.ceil(Number(seconds) || 0))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return minutes ? `${minutes}分${String(rest).padStart(2, '0')}秒` : `${rest}秒`
}
</script>

<style scoped>
.play-count-card {
  min-height: 0;
}

.play-count-hdr {
  min-height: 52px;
}

.play-count-title {
  flex: 1 1 auto;
}

.play-count-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(20, 184, 166, 0.32);
  border-radius: 8px;
  color: #0f766e;
  background:
    linear-gradient(135deg, rgba(20, 184, 166, 0.16), rgba(22, 119, 255, 0.1)),
    var(--chip-bg);
  font-size: 15px;
  font-weight: 900;
}

.cooldown-pill {
  flex: 0 0 auto;
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border: 1px solid rgba(20, 184, 166, 0.32);
  border-radius: 999px;
  color: #0f766e;
  background: rgba(20, 184, 166, 0.1);
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.cooldown-pill.active {
  border-color: rgba(245, 158, 11, 0.42);
  color: #b45309;
  background: rgba(245, 158, 11, 0.12);
}

.play-query-panel {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 86px;
  gap: 9px;
  align-items: stretch;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--border) 82%, rgba(20, 184, 166, 0.32));
  border-radius: 10px;
  background:
    linear-gradient(135deg, rgba(20, 184, 166, 0.08), rgba(22, 119, 255, 0.05)),
    var(--panel-bg-soft);
}

.play-query-panel.busy {
  border-color: rgba(22, 119, 255, 0.34);
}

.play-query-panel.cooling {
  border-color: rgba(245, 158, 11, 0.32);
  background:
    linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(20, 184, 166, 0.04)),
    var(--panel-bg-soft);
}

.play-input {
  width: 100%;
  min-height: 74px;
  resize: vertical;
  border-radius: 8px;
}

.play-query-btn {
  min-width: 0;
  display: inline-flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
}

.query-btn-icon {
  width: 26px;
  height: 22px;
  display: grid;
  place-items: center;
  align-self: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 11px;
  font-weight: 900;
}

.play-result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.play-metric,
.play-verdict {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-bg);
}

.play-metric {
  position: relative;
  display: grid;
  gap: 5px;
  padding: 11px;
  overflow: hidden;
}

.play-metric::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #14b8a6;
}

.play-metric.natural::before {
  background: #1677ff;
}

.play-metric span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.play-metric strong {
  color: var(--text);
  font-size: 24px;
  line-height: 1.05;
  letter-spacing: 0;
}

.play-metric small {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.25;
}

.play-verdict {
  grid-column: 1 / -1;
  padding: 10px 11px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
  background:
    linear-gradient(135deg, rgba(22, 119, 255, 0.08), rgba(20, 184, 166, 0.06)),
    var(--panel-bg-soft);
}

.play-error {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(239, 68, 68, 0.45);
  border-radius: 10px;
  color: var(--danger, #ef4444);
  background: rgba(239, 68, 68, 0.08);
  font-size: 12px;
  line-height: 1.55;
}

@media (max-width: 760px) {
  .play-query-panel,
  .play-result-grid {
    grid-template-columns: 1fr;
  }

  .play-query-btn {
    min-height: 40px;
    flex-direction: row;
  }

  .play-verdict {
    grid-column: auto;
  }
}
</style>
