<template>
  <LegacyGrossMarginModule
    v-if="LegacyGrossMarginModule"
    :path="path"
    :module-id="moduleId"
    :current-user="currentUser"
    :traffic-context="trafficContext"
    :traffic-plans="trafficPlans"
  />
  <section v-else class="gross-load-state">
    <div class="module-page-header gross-load-head">
      <div class="module-page-title">
        <span class="module-page-icon">维</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">MAINTENANCE</div>
          <h2>{{ moduleId === 'trafficApply' ? '投流申请' : '数据维护' }}</h2>
          <p>{{ loadError || '维护测算模块加载中...' }}</p>
        </div>
      </div>
      <button v-if="loadError" type="button" class="btn btn-primary btn-sm" @click="loadLegacyModule">
        重试
      </button>
    </div>
  </section>
</template>

<script setup>
import { markRaw, onMounted, ref, shallowRef } from 'vue'

defineProps({
  path: {
    type: String,
    default: ''
  },
  moduleId: {
    type: String,
    default: 'styleGrossMargin'
  },
  currentUser: {
    type: Object,
    default: null
  },
  trafficContext: {
    type: Object,
    default: null
  },
  trafficPlans: {
    type: Array,
    default: () => []
  }
})

const LegacyGrossMarginModule = shallowRef(null)
const loadError = ref('')

async function loadLegacyModule() {
  loadError.value = ''
  try {
    const mod = await import('../legacy-assets/GrossMarginModule-legacy.js')
    const comp = mod.u || mod.c?.default || mod.default
    if (!comp || typeof comp !== 'object') {
      loadError.value = '维护测算模块加载失败：旧模块没有导出可渲染组件'
      return
    }
    LegacyGrossMarginModule.value = markRaw(comp)
  } catch (error) {
    loadError.value = `维护测算模块加载失败：${error?.message || error || '未知错误'}`
    console.error('[gross-margin] failed to load legacy module', error)
  }
}

onMounted(loadLegacyModule)
</script>

<style src="../legacy-assets/GrossMarginModule-legacy.css"></style>

<style scoped>
.gross-load-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
  color: var(--text, #182033);
}

.gross-load-head {
  border: 1px solid var(--card-border, var(--border, rgba(20, 32, 52, .1)));
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--card-bg, var(--panel-bg, rgba(255, 255, 255, .9)));
}
</style>

<style>
@media (max-width: 720px) {
  .gross-native-module {
    height: auto;
    min-height: 100%;
    overflow: visible;
  }

  .gross-native-head {
    margin-bottom: 10px;
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--panel-bg);
    box-shadow: var(--shadow);
  }

  .gross-native-head .module-page-title {
    align-items: flex-start;
  }

  .gross-native-head .module-page-icon {
    width: 38px;
    height: 38px;
    flex-basis: 38px;
  }

  .gross-native-head .module-page-title h2 {
    font-size: 18px;
  }

  .gross-native-head .module-page-copy p {
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .gross-native-actions {
    width: 100%;
    justify-content: stretch;
  }

  .gross-native-actions .btn,
  .gross-native-pill {
    flex: 1 1 auto;
    justify-content: center;
    min-height: 34px;
  }

  .gross-traffic-banner {
    align-items: flex-start;
    flex-direction: column;
    border-radius: 12px;
  }

  .gross-native-workspace {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
  }

  .gross-native-panel {
    padding: 10px;
    border-radius: 14px;
    box-shadow: none;
  }

  .gross-maintenance-pane {
    border-color: color-mix(in srgb, var(--primary) 28%, var(--card-border));
  }

  .gross-maintenance-pane {
    order: 1;
  }

  .gross-result-pane {
    order: 2;
  }

  .gross-record-pane {
    order: 3;
  }

  .gross-panel-title {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .gross-panel-title strong {
    font-size: 16px;
  }

  .gross-panel-title span {
    line-height: 1.45;
  }

  .gross-panel-title .btn,
  .gross-refresh-traffic-btn,
  .gross-target-row .btn,
  .gross-price-drawer-body > .btn,
  .gross-export-row .btn {
    width: 100%;
    justify-content: center;
  }

  .gross-current-group,
  .gross-account-node-head,
  .gross-review-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .gross-record-list {
    max-height: none;
    overflow: visible;
  }

  .gross-target-row,
  .gross-account-row,
  .gross-price-summary-grid,
  .gross-preset-config-grid,
  .gross-result-grid {
    grid-template-columns: 1fr;
  }

  .gross-target-row,
  .gross-account-row,
  .gross-price-summary-grid {
    gap: 8px;
    margin-bottom: 8px;
  }

  .gross-target-row .field-hint,
  .span-2 {
    grid-column: auto;
  }

  .gross-price-option {
    grid-template-columns: minmax(0, 1fr) 96px;
  }

  .gross-price-option em {
    grid-column: 1 / -1;
  }

  .gross-maintenance-table-wrap {
    margin-inline: -2px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .gross-maintenance-table-wrap::before {
    display: block;
    padding: 7px 9px;
    color: var(--text-muted);
    background: var(--row-bg);
    border-bottom: 1px solid var(--border);
    content: "表格可左右滑动";
    font-size: 11px;
    font-weight: 800;
  }

  .gross-maintenance-table {
    min-width: 620px;
  }

  .gross-maintenance-table th:first-child,
  .gross-maintenance-table td:first-child {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--panel-bg);
    box-shadow: 1px 0 0 var(--border);
  }

  .gross-maintenance-table th:first-child {
    z-index: 3;
  }

  .gross-result-panel strong {
    font-size: 22px;
  }

  .gross-review-editor textarea {
    min-height: 220px;
  }
}
</style>
