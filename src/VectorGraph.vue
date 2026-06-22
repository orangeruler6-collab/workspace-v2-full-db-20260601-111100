<template>
  <div class="vector-graph-container">
    <!-- Stats Bar -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-label">总记录</span>
        <span class="stat-value">{{ stats.total }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">场景数</span>
        <span class="stat-value">{{ stats.scenes }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">账号数</span>
        <span class="stat-value">{{ stats.accounts }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">状态</span>
        <span class="stat-value" :class="loading ? 'loading' : 'ready'">{{ loading ? '加载中...' : '就绪' }}</span>
      </div>
      <div class="stat-item" style="margin-left:auto; display:flex; align-items:center; gap:8px;">
        <button class="add-node-btn" @click="openNewNodeModal">+ 添加节点</button>
        <button class="sim-btn" @click="loadData" :disabled="loading">
          {{ loading ? '加载中...' : '刷新数据' }}
        </button>
      </div>
    </div>

    <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>

    <!-- Graph Area -->
    <div class="graph-area" ref="graphArea">
      <svg ref="svgRef" class="graph-svg"></svg>
      
      <!-- Loading Overlay -->
      <div v-if="loading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span>加载向量数据...</span>
      </div>

      <!-- Empty State -->
      <div v-else-if="nodes.length === 0" class="empty-state">
        <span class="empty-icon">🔍</span>
        <p>暂无向量数据</p>
        <p class="empty-hint">向量库为空或加载失败</p>
      </div>
    </div>

    <!-- Node Details Panel -->
    <div v-if="selectedNode" class="node-panel">
      <div class="panel-header">
        <span>节点详情</span>
        <button class="close-btn" @click="selectedNode = null">×</button>
      </div>
      <div class="panel-body">
        <div class="info-row">
          <span class="info-label">内容</span>
          <span class="info-value">{{ selectedNode.content?.substring(0, 100) }}...</span>
        </div>
        <div class="info-row">
          <span class="info-label">账号</span>
          <span class="info-value">{{ selectedNode.account }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">场景</span>
          <span class="info-value">{{ selectedNode.scene }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">类型</span>
          <span class="info-value">{{ selectedNode.type }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">相似节点</span>
          <span class="info-value">{{ selectedNode.relatedCount || 0 }}</span>
        </div>
      </div>
    </div>

    <!-- Add Node Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-content">
        <div class="modal-header">
          <span>添加向量节点</span>
          <button class="close-btn" @click="showModal = false">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>内容</label>
            <textarea v-model="newNode.content" class="inp" rows="3" placeholder="输入内容"></textarea>
          </div>
          <div class="form-group">
            <label>账号</label>
            <select v-model="newNode.account" class="inp">
              <option value="">选择账号</option>
              <option v-for="acc in ACCOUNTS" :key="acc" :value="acc">{{ acc }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>场景</label>
            <select v-model="newNode.scene" class="inp">
              <option value="">选择场景</option>
              <option v-for="s in SCENES" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>类型</label>
            <select v-model="newNode.type" class="inp">
              <option value="template">模板</option>
              <option value="material">素材</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-pri" @click="addNode">添加</button>
          <button class="btn-sec" @click="showModal = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { addVectorItem, listVectorItems } from './api/vector'

const ACCOUNTS = ['天机妹', '花蛮楼', '麦小雯', '夏天丶Cat', '有事找学姐', '小张同学', '通用']
const SCENES = ['开场', '承接', '结尾', '梗', '素材']

const graphArea = ref(null)
const svgRef = ref(null)
const loading = ref(false)
const nodes = ref([])
const stats = ref({ total: 0, scenes: 0, accounts: 0 })
const selectedNode = ref(null)
const showModal = ref(false)
const errorMessage = ref('')
const newNode = ref({ content: '', account: '', scene: '', type: 'template' })

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await listVectorItems('wenan', { limit: 200, offset: 0 })
    if (data.items) {
      nodes.value = data.items
      stats.value = {
        total: data.total || data.items.length,
        scenes: [...new Set(data.items.map(n => n.scene))].length,
        accounts: [...new Set(data.items.map(n => n.account))].length
      }
    }
  } catch (e) {
    errorMessage.value = '向量数据加载失败：' + (e.message || '请检查后端服务')
    nodes.value = []
  } finally {
    loading.value = false
  }
}

function openNewNodeModal() {
  newNode.value = { content: '', account: '', scene: '', type: 'template' }
  showModal.value = true
}

async function addNode() {
  if (!newNode.value.content) {
    errorMessage.value = '请输入内容'
    return
  }
  try {
    await addVectorItem('wenan', newNode.value)
    showModal.value = false
    errorMessage.value = ''
    await loadData()
  } catch (e) {
    errorMessage.value = '添加失败：' + (e.message || '请稍后重试')
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.vector-graph-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.stats-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(0, 245, 212, 0.05);
  border: 1px solid rgba(0, 245, 212, 0.2);
  border-radius: 4px;
  margin-bottom: 16px;
}

.error-banner {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  font-size: 12px;
  line-height: 1.5;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-label {
  color: rgba(0, 245, 212, 0.7);
  font-size: 12px;
}

.stat-value {
  color: #00f5d4;
  font-weight: bold;
}

.stat-value.loading { color: #ff6b6b; }
.stat-value.ready { color: #00f5d4; }

.add-node-btn, .sim-btn {
  padding: 6px 12px;
  border: 1px solid #00f5d4;
  background: transparent;
  color: #00f5d4;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.add-node-btn:hover, .sim-btn:hover {
  background: rgba(0, 245, 212, 0.1);
}

.sim-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.graph-area {
  flex: 1;
  position: relative;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(123, 47, 255, 0.3);
  border-radius: 4px;
  overflow: hidden;
}

.graph-svg {
  width: 100%;
  height: 100%;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.7);
  color: #00f5d4;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(0, 245, 212, 0.2);
  border-top-color: #00f5d4;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.5);
}

.empty-icon { font-size: 48px; }
.empty-hint { font-size: 12px; color: rgba(255, 255, 255, 0.3); }

.node-panel {
  position: absolute;
  right: 16px;
  top: 80px;
  width: 280px;
  background: rgba(13, 17, 23, 0.95);
  border: 1px solid rgba(0, 245, 212, 0.3);
  border-radius: 4px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid rgba(0, 245, 212, 0.2);
  font-weight: bold;
  color: #00f5d4;
}

.close-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 20px;
  cursor: pointer;
}

.panel-body { padding: 12px; }

.info-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.info-label {
  font-size: 11px;
  color: rgba(0, 245, 212, 0.6);
  text-transform: uppercase;
}

.info-value {
  color: #fff;
  font-size: 13px;
  word-break: break-all;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  width: 400px;
  background: #0d1117;
  border: 1px solid rgba(0, 245, 212, 0.3);
  border-radius: 8px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid rgba(0, 245, 212, 0.2);
  font-weight: bold;
  color: #00f5d4;
}

.modal-body { padding: 16px; }

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.inp {
  width: 100%;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(123, 47, 255, 0.3);
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
}

.modal-footer {
  display: flex;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid rgba(0, 245, 212, 0.2);
}

.btn-pri {
  flex: 1;
  padding: 8px 16px;
  background: #00f5d4;
  border: none;
  border-radius: 4px;
  color: #000;
  font-weight: bold;
  cursor: pointer;
}

.btn-sec {
  flex: 1;
  padding: 8px 16px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
}
</style>
