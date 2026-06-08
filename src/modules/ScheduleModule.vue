<template>
  <div class="schedule-module">
    <div class="module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">📅</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">SCHEDULE BOARD</div>
          <h2>排期看板</h2>
        </div>
      </div>
      <div class="view-toggle module-page-actions">
        <button :class="{ active: viewMode === 'person' }" @click="viewMode = 'person'">👤 按人</button>
        <button :class="{ active: viewMode === 'week' }" @click="viewMode = 'week'">📆 按周</button>
      </div>
      <button class="undo-btn" @click="undo" title="撤销 (Ctrl+Z)">↩️ 撤销</button>
      <button class="ai-import-btn" @click="showAiImport = true" title="AI导入">🤖 AI导入</button>
    </div>

    <!-- 组选择 tabs（组长/部长可见，组员隐藏） -->
    <div v-if="canViewAllGroups" class="group-tabs">
      <button v-for="g in GROUPS" :key="g.id" class="group-tab" :class="{ active: activeGroup === g.id }" @click="activeGroup = g.id">{{ g.label }}</button>
    </div>

    <!-- ===== 按人视图 ===== -->
    <div v-if="viewMode === 'person'" class="board" ref="boardRef"
      @mousedown="startPan"
      @mousemove="doPan"
      @mouseup="endPan"
      @mouseleave="endPan"
      :style="{ cursor: isPanning ? 'grabbing' : 'grab' }">
      <div v-for="person in currentGroupMembers" :key="person" class="board-col">
        <div class="col-hdr">
          <span class="col-name">{{ person }}</span>
          <span class="col-count">{{ (itemsByPerson[person] || []).length }}</span>
        </div>
        <div class="card-stack"
          :class="{ 'paste-target': activePasteTarget?.person === person }"
          @mouseenter="setPasteTarget(person)"
          @click.self="setPasteTarget(person)"
          @dragover.prevent
          @drop="handleDrop($event, person)">
          <div v-for="item in ((itemsByPerson[person] || []).filter(i => i.status !== 'done'))" :key="item.id"
            class="task-card" :class="[item.status, { selected: activeTask?.id === (item.task?.id || item.id) }]" draggable="true"
            tabindex="0"
            @click.stop="setActiveTask(item)"
            @dblclick.stop="editItem(item)"
            @focus="setActiveTask(item)"
            @dragstart="handleDragStart($event, item)"
            @dragover.prevent
            @drop.stop="handleTaskDrop($event, person, item)"
            @dragend="handleDragEnd">
            <div class="task-title">
              <span class="task-account">{{ item.account || '账号待定' }}</span>
              <span class="task-type" :class="typeBadgeClass(item.type)">{{ TYPE_TAG[item.type] || item.type }}</span>
            </div>
            <div class="task-content">{{ item.content || '待定' }}</div>
            <div class="task-meta">
              <span class="task-status" :class="item.workflow_stage_tone">{{ item.workflow_stage_label }}</span>
              <span class="task-date">{{ item.date_label || formatPersonTaskDate(item.date) }}</span>
              <button
                v-if="hasScheduleDoc(item)"
                class="doc-entry"
                :title="item.doc_title || '打开文案'"
                @click.stop="openScheduleDoc(item, $event)">文</button>
            </div>
            <div class="task-actions">
              <span class="task-inline-tools">
                <button class="tbtn" @click.stop="editItem(item)">改</button>
                <button v-if="canDeleteTasks" class="tbtn" @click.stop="delItem(item.id)">删</button>
              </span>
              <button
                class="stage-advance-btn"
                :class="item.workflow_stage_tone"
                :style="{ '--stage-angle': `${item.workflow_stage_progress_angle}deg` }"
                @click.stop="toggleDone(item, $event)"
                :title="`${item.workflow_stage_step_label} · ${item.workflow_stage_action_label}`">
                <span>{{ item.workflow_stage_short_label }}</span>
              </button>
            </div>
          </div>
          <div v-if="dragItem && dragItem.view_person !== person" class="drop-hint">放到这里</div>
        </div>
        <div class="column-actions">
          <button class="add-btn" @click="openAdd(person)">+ 添加</button>
        </div>
      </div>
    </div>

    <!-- ===== 按周视图 ===== -->
    <div v-if="viewMode === 'week'" class="week-board-wrap">
      <div class="week-nav">
        <button class="week-arrow" @click="weekOffset--">&lt;</button>
        <span class="week-label">{{ weekRangeLabel }}</span>
        <button class="week-arrow" @click="weekOffset++">&gt;</button>
        <button class="btn btn-ghost btn-sm" @click="weekOffset = 0">今天</button>
      </div>
      <div class="week-board">
        <!-- Header: 周一 ~ 周日 -->
        <div class="week-head-row">
          <div class="week-acc-col"></div>
          <div v-for="(day, i) in weekDays" :key="i" class="week-day-hdr" :class="{ today: isToday(day) }">
            <span class="week-day-name">{{ ['周一','周二','周三','周四','周五','周六','周日'][i] }}</span>
            <span class="week-day-date">{{ fmtMd(day) }}</span>
          </div>
        </div>
        <!-- Rows: per account -->
        <div v-for="acc in currentGroupAccounts" :key="acc" class="week-row">
          <div class="week-acc-col">
            <span class="week-acc-name">{{ acc }}</span>
          </div>
          <div v-for="(day, i) in weekDays" :key="i" class="week-cell" :class="{ today: isToday(day) }"
            @dragover.prevent
            @drop="handleWeekDrop($event, acc, day)">
            <div v-for="item in getItemsForCell(acc, day)" :key="item._week_key || item.id" class="week-card"
              :class="item.status"
              draggable="true"
              tabindex="0"
              @dragstart="handleDragStart($event, item)"
              @dragend="handleDragEnd"
              @click="editItem(item)"
              :title="[item.person, item.account, item.content].filter(Boolean).join(' | ')">
              <span class="week-card-person" :class="{ merged: item._parallel_items }">{{ weekPeopleLabel(item) }}</span>
              <span class="week-card-type" :class="typeBadgeClass(item.type)">{{ TYPE_TAG[item.type] || item.type }}</span>
              <span class="week-card-stage" :class="workflowStageTone(item.workflow_stage)">{{ workflowStageStepLabel(item.workflow_stage, item) }}</span>
              <button
                v-if="hasScheduleDoc(item)"
                class="week-doc-entry"
                :title="item.doc_title || '打开文案'"
                @click.stop="openScheduleDoc(item, $event)">文</button>
              <span class="week-card-acc">{{ item.account }}</span>
              <span class="week-card-remark">{{ item.content || '待定' }}</span>
            </div>
            <div v-if="dragItem && dragItem.task?.account === acc && isSameDay(dragItem.task?.date, day)" class="drop-hint">+</div>
          </div>
        </div>
      </div>
      <div class="week-cross-drop" :class="{ active: dragItem }">
        <div class="week-cross-zone"
          @dragover.prevent
          @drop="moveDraggedItemToAdjacentWeek(-1, $event)">
          拖到这里：上一周周日
        </div>
        <div class="week-cross-zone"
          @dragover.prevent
          @drop="moveDraggedItemToAdjacentWeek(1, $event)">
          拖到这里：下一周周一
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="formShow" class="modal-overlay" @click.self="formShow = false">
      <div class="modal" @keydown.enter.exact="handleScheduleFormEnter">
        <div class="modal-hdr">
          <span>{{ editing ? '✏️ 编辑任务' : '➕ 新增任务' }}</span>
          <button class="tbtn close-btn" @click="formShow = false">x</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <label>账号</label>
            <select class="inp" v-model="form.account">
              <option v-for="acc in currentGroupAccounts" :key="acc" :value="acc">{{ acc }}</option>
            </select>
          </div>
          <div class="form-row">
            <label>负责人</label>
            <select class="inp" v-model="form.person" @change="syncFormPrimaryParticipant">
              <option v-for="m in currentGroupMembers" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="form-row">
            <label>内容</label>
            <textarea class="inp" v-model="form.content" rows="2" placeholder="输入任务内容..."></textarea>
          </div>
          <div class="form-row">
            <label>备注</label>
            <input class="inp" v-model="form.remark" placeholder="备注信息">
          </div>
          <div class="form-row">
            <label>文案入口</label>
            <div
              class="doc-dropzone"
              :class="{ dragging: form.doc_dragging, filled: form.doc_url }"
              @dragover.prevent="form.doc_dragging = true"
              @dragleave.prevent="form.doc_dragging = false"
              @drop="handleScheduleDocDrop"
              @paste="handleScheduleDocPaste">
              <input class="doc-link-input" v-model="form.doc_url" placeholder="拖入文案文件 / 飞书链接，或粘贴链接" @blur="setScheduleDocLink" @paste="handleScheduleDocPaste">
              <label class="doc-file-btn" title="选择文案文件">
                选
                <input type="file" accept=".txt,.doc,.docx,.pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" @change="handleScheduleDocFile">
              </label>
            </div>
            <div v-if="form.doc_url" class="doc-current">
              <span>{{ form.doc_title || form.doc_url }}</span>
              <button type="button" @click="clearScheduleDoc">移除</button>
            </div>
          </div>
          <div class="form-row">
            <label>日期</label>
            <input type="date" class="inp" v-model="form.date">
          </div>
          <div class="form-row">
            <label>类型</label>
            <select class="inp" v-model="form.type">
              <option value="日常">日常</option>
              <option value="商单">商单</option>
              <option value="星广联投">星广联投</option>
              <option value="CPM">CPM</option>
              <option value="素材代做">素材代做</option>
            </select>
          </div>
          <div class="form-row">
            <label>当前状态</label>
            <div class="btn-group workflow-group">
              <button
                v-for="stage in ['文案', '后期', '待发布', '已发布']"
                :key="stage"
                type="button"
                class="btn-option workflow-option"
                :class="{ active: form.workflow_stage === stage }"
                @click="setFormWorkflowStage(stage)">
                {{ stage }}
              </button>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="formShow = false">取消</button>
          <button class="btn btn-primary" @click="saveItem">保存</button>
        </div>
      </div>
    </div>

    <!-- AI Import Modal -->
    <div v-if="showAiImport" class="modal-overlay" @click.self="showAiImport = false">
      <div class="modal ai-import-modal">
        <div class="modal-hdr">
          <span>AI导入排期</span>
          <button class="tbtn close-btn" @click="showAiImport = false">x</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <label>输入排期任务描述</label>
            <textarea class="inp" v-model="aiImportText" rows="4" placeholder="例如：&#10;腾讯AI视频素材代做1条&#10;天机妹日常3条&#10;逆水寒素材24条"></textarea>
          </div>
          <div class="ai-hint">支持自然语言描述</div>

          <div v-if="aiParsedPreview.length > 0" class="ai-preview">
            <div class="ai-preview-title">
              <span>解析到 {{ aiParsedPreview.length }} 项任务</span>
              <small>默认按业务规则拆分：素材每格 6 个，日常每天 1 条</small>
            </div>
            <div class="ai-preview-list">
              <div v-for="(item, idx) in aiParsedPreview" :key="idx" class="ai-preview-item">
                <div class="ai-preview-main">
                  <span class="ai-preview-content">{{ item.content }}</span>
                  <span class="ai-preview-count">共{{ previewTaskTotal(item) }}{{ normalizeAiType(item.type, item) === '素材代做' ? '期' : '条' }}</span>
                </div>
                <div class="ai-preview-detail">
                  <span>{{ item.account || '账号待定' }}</span>
                  <span>{{ item.type || '日常' }}</span>
                  <span>{{ item.person || '自动分配' }}</span>
                </div>
              </div>
            </div>
            <div class="ai-split-options">
              <button class="ai-split-btn" :class="{ active: aiSelectedSplit === 'auto' }" @click="applyKeepOriginal">自动拆分</button>
              <button class="ai-split-btn" :class="{ active: aiSelectedSplit === 4 }" @click="applySplit(4)">每批4条</button>
              <button class="ai-split-btn" :class="{ active: aiSelectedSplit === 6 }" @click="applySplit(6)">每批6条</button>
              <button class="ai-split-btn" @click="applySplit(1)">按数量拆成单条</button>
              <div class="ai-custom-split">
                <input type="number" v-model="aiCustomSplitNum" min="1" placeholder="自定义" class="inp">
                <button class="ai-split-btn" :class="{ active: aiSelectedSplit === Number(aiCustomSplitNum) }" @click="applySplit(aiCustomSplitNum)">每批{{ aiCustomSplitNum || '?' }}条</button>
              </div>
            </div>
          </div>

          <div v-if="aiFinalPreview.length > 0" class="ai-preview ai-final-preview">
            <div class="ai-preview-title">
              <span>待导入预览：共 {{ aiFinalPreview.length }} 条任务</span>
              <small>确认后才会真正写入排期看板</small>
            </div>
            <div class="ai-final-table">
              <div class="ai-final-head">
                <span>#</span>
                <span>日期</span>
                <span>负责人</span>
                <span>账号</span>
                <span>类型</span>
                <span>内容</span>
              </div>
              <div v-for="(item, idx) in aiFinalPreview" :key="idx" class="ai-final-row">
                <span class="ai-final-index">{{ idx + 1 }}</span>
                <span class="ai-final-date">{{ formatAiDateLabel(item.date) }}</span>
                <span class="ai-final-person">{{ item.person }}</span>
                <span>{{ item.account || '素材' }}</span>
                <span class="ai-final-type">{{ item.type || '日常' }}</span>
                <span class="ai-final-content">{{ item.content }}</span>
              </div>
            </div>
            <div class="ai-split-options" style="margin-top:12px;">
              <button class="ai-split-btn" @click="applyKeepOriginal">恢复自动拆分</button>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showAiImport = false">取消</button>
          <button v-if="aiParsedPreview.length === 0" class="btn btn-primary" @click="parseAiImport" :disabled="aiImporting">{{ aiImporting ? '解析中...' : '解析排期' }}</button>
          <button v-else-if="aiFinalPreview.length === 0" class="btn btn-primary" @click="applyKeepOriginal">生成预览</button>
          <button v-else class="btn btn-primary ai-confirm-btn" @click="confirmAiImport">确认导入 {{ aiFinalPreview.length }} 条</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref } from 'vue'
import { TYPE_TAG } from './schedule/constants'
import { useScheduleBoard } from './schedule/useScheduleBoard'
import { useToast } from '../composables/useToast'
import { chatMinimax } from '../api/tools'

const { showToast: showGlobalToast } = useToast()

function showToast(msg, type = 'info', options = false) {
  const toastOptions = typeof options === 'object' && options !== null
    ? { timeout: 4000, ...options }
    : { big: Boolean(options), timeout: 4000 }
  showGlobalToast(msg, type, toastOptions)
}

function typeBadgeClass(type) {
  const value = String(type || '').trim()
  if (value === '日常') return 'daily'
  if (value === '商单') return 'business'
  if (value === '素材代做') return 'material'
  return ''
}

// AI Import
const showAiImport = ref(false)
const aiImportText = ref('')
const aiImporting = ref(false)
const aiParsedPreview = ref([])  // AI解析后的原始任务
const aiFinalPreview = ref([])    // 拆分后的最终任务
const aiSelectedSplit = ref(null) // 用户选择的拆分方式
const aiCustomSplitNum = ref(5)   // 用户自定义拆分数量

async function parseAiImport() {
  if (!aiImportText.value.trim()) {
    showToast('请输入排期内容', 'error')
    return
  }

  aiImporting.value = true
  const membersList = currentGroupMembers.value.join('、')

  try {
    const result = await chatMinimax({
      model: 'MiniMax-M2.7-highspeed',
      system: `你是排期任务解析助手。请把用户输入的排期描述解析为 JSON 数组。

当前组成员：${membersList}
任务类型：日常、商单、素材代做、星广联投、CPM、一口价

规则：
1. 识别任务项目名称和总数量。
2. 如果指定负责人，用指定的人；否则分配给当前组成员。
3. 每项包含 account, content, type, count, person。
4. 如果是“账号名+日常+数量”，type 必须是“日常”，content 必须是“选题待定”，不要把“日常”写进 content。
5. 出现“素材、素材代做、代做、混剪、剪辑”，或“项目名+数字+期/条”且不是账号日常/商单时，type 必须是“素材代做”，account 必须是“素材”，content 写项目名，quantity 写总数量，例如“30期逆水寒” => {"account":"素材","content":"逆水寒","type":"素材代做","count":1,"quantity":30}。
6. 日常不存在堆叠；例如“天机妹日常x6” => type 日常、count 6、quantity 0，后续会拆成 6 天每天 1 条。
7. 素材 quantity 表示素材数量或交付数量；日常 count 表示排期条目数量。
8. “1期、1单、一次、一篇、一条商单”都表示一条商单排期，不要强制拆分。
9. 每项尽量包含 account, content, type, count, person, quantity。
10. 只返回 JSON 数组，不要解释。`,
      prompt: aiImportText.value
    })

    const reply = (result.reply || result.text || '').trim()
    if (!reply || reply.startsWith('error:')) {
      showToast('AI服务异常: ' + reply, 'error')
      aiImporting.value = false
      return
    }

    let tasks = []
    try {
      const jsonMatch = reply.match(/(\[[\s\S]*?\])/)
      tasks = JSON.parse(jsonMatch ? jsonMatch[1] : reply)
    } catch (e) {
      console.error('解析错误:', e)
      showToast('AI解析失败，请检查格式后重试', 'error')
      aiImporting.value = false
      return
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      showToast('未识别到有效任务', 'error')
      aiImporting.value = false
      return
    }

    aiParsedPreview.value = normalizeAiTasks(mergeLocalParsedTasks(tasks))
    applyKeepOriginal()
  } catch (e) {
    showToast('解析失败: ' + e.message, 'error')
  }

  aiImporting.value = false
}

function mergeLocalParsedTasks(aiTasks) {
  const localTasks = parseLocalScheduleText(aiImportText.value)
  if (!localTasks.length) return aiTasks
  if (localTasks.some(task => normalizeAiType(task.type, task) === '素材代做' && Number(task.quantity || task.itemCount || 0) > 1)) {
    return localTasks
  }
  if (localTasks.length > 1) return localTasks
  const lines = String(aiImportText.value || '').split(/\r?\n|[;；]/).map(line => line.trim()).filter(Boolean)
  if (localTasks.length >= lines.length) return localTasks
  const nonMaterialTasks = (Array.isArray(aiTasks) ? aiTasks : [])
    .filter(task => normalizeAiType(task.type) !== '素材代做')
    .filter(task => !isDuplicateLocalMaterialTask(task, localTasks))
  return nonMaterialTasks.concat(localTasks)
}

function parseLocalScheduleText(text) {
  return String(text || '')
    .split(/\r?\n|[;；]/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(parseLocalScheduleLine)
    .filter(Boolean)
}

function parseLocalScheduleLine(line) {
  const text = String(line || '').trim()
  if (!text) return null
  const tasks = []
  const person = currentGroupMembers.value.find(name => text.includes(name)) || ''
  const takenRanges = []

  const materialTask = parseLocalMaterialTask(text, person, takenRanges)
  if (materialTask) {
    tasks.push(materialTask)
    takenRanges.push([materialTask._source_start || 0, materialTask._source_end || text.length])
  }

  currentGroupAccounts.value
    .filter(account => account !== '素材')
    .flatMap(account => accountSearchTerms(account).map(term => ({ account, term })))
    .forEach(({ account, term }) => {
      const escaped = escapeRegExp(term)
      const re = new RegExp(`${escaped}\\s*(日常|商单|商务|广告|推广|CPM|一口价|星广联投|星广)?\\s*(?:x|X|×|\\*)?\\s*(\\d+)\\s*(?:条|期|个|份|支|篇)?`, 'g')
      let match
      while ((match = re.exec(text))) {
        const start = match.index
        const end = match.index + match[0].length
        if (rangeOverlaps(takenRanges, start, end)) continue
        const type = normalizeAiType(match[1] || '日常')
        const count = Math.max(1, Number(match[2]) || 1)
        tasks.push({
          account,
          content: type === '日常' ? '选题待定' : type,
          type,
          count,
          quantity: 0,
          person
        })
        takenRanges.push([start, end])
      }
    })

  return tasks
}

function parseLocalMaterialTask(text, person, takenRanges = []) {
  const explicitBusiness = /商单|商务|广告|推广|CPM|一口价|星广|联投/.test(text)
  const explicitDaily = /日常/.test(text)
  if (!explicitBusiness && !explicitDaily) {
    const suffixMatch = text.match(/(\d+)\s*(?:条|期|个|份|支|篇)\s*([^，,、\s]+)/)
    if (suffixMatch && !rangeOverlaps(takenRanges, suffixMatch.index || 0, (suffixMatch.index || 0) + suffixMatch[0].length)) {
      const quantity = Number(suffixMatch[1] || 0)
      if (quantity) {
        return {
          account: '素材',
          content: normalizeMaterialContentBase(suffixMatch[2]),
          type: '素材代做',
          count: 1,
          quantity,
          person,
          _source_start: suffixMatch.index || 0,
          _source_end: (suffixMatch.index || 0) + suffixMatch[0].length
        }
      }
    }
  }
  const materialPatterns = [
    /([^，,、\s]*?)(?:素材代做|素材|代做|混剪|剪辑)\s*(?:x|X|×|\*)?\s*(\d+)\s*(?:条|期|个|份|支|篇)?/,
    /([^，,、\s]*?)\s*(\d+)\s*(?:条|期|个|份|支|篇)\s*(?:素材代做|素材|代做|混剪|剪辑)/
  ]
  if (!explicitBusiness && !explicitDaily) {
    materialPatterns.push(/([^，,、\s]*?)\s*(\d+)\s*(?:条|期|个|份|支|篇)/)
    materialPatterns.push(/([^，,、\s]*?)(?:x|X|×|\*)\s*(\d+)\s*(?:条|期|个|份|支|篇)?/)
  }
  let match = null
  for (const pattern of materialPatterns) {
    match = text.match(pattern)
    if (match && !rangeOverlaps(takenRanges, match.index || 0, (match.index || 0) + match[0].length)) break
    match = null
  }
  if (!match && /素材代做|素材|代做|混剪|剪辑/.test(text)) {
    const idx = text.search(/素材代做|素材|代做|混剪|剪辑/)
    if (idx >= 0 && !rangeOverlaps(takenRanges, idx, idx + 4)) {
      match = ['', '', '1']
      match.index = idx
    }
  }
  if (!match) return null
  const quantity = Number(match[2] || 0)
  if (!quantity) return null
  const materialLike = /素材|代做|混剪|剪辑/.test(match[0]) || !/商单|商务|广告|推广|CPM|一口价|星广|联投/.test(match[0])
  if (!materialLike) return null
  const cleaned = String(match[1] || '')
    .replace(/(?:x|X|×|\*)\s*\d+/g, '')
    .replace(/\d+\s*(?:条|期|个|份|支|篇)/g, '')
    .replace(person, '')
    .replace(/任务|排期|需求/g, '')
    .trim()
  const base = cleaned || '素材代做'
  return {
    account: '素材',
    content: normalizeMaterialContentBase(base),
    type: '素材代做',
    count: 1,
    quantity,
    person,
    _source_start: match.index || 0,
    _source_end: (match.index || 0) + match[0].length
  }
}

function accountSearchTerms(account) {
  const aliases = {
    麦晓花: ['麦晓花', '晓花', '晓晓花'],
    天机妹: ['天机妹'],
    花蛮楼: ['花蛮楼'],
    有事找学姐: ['有事找学姐', '学姐'],
    夏天丶Cat: ['夏天丶Cat', '夏天Cat', '夏天'],
    小张同学: ['小张同学', '小张']
  }
  return aliases[account] || [account]
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rangeOverlaps(ranges, start, end) {
  return ranges.some(([left, right]) => start < right && end > left)
}

function extractLocalAccount(text) {
  const source = String(text || '')
  return currentGroupAccounts.value.find(account => account !== '素材' && source.includes(account)) || ''
}

function isDuplicateLocalMaterialTask(task, localTasks) {
  const text = [task.account, task.content].filter(Boolean).join('')
  return localTasks.some(local => {
    const key = String(local.content || '').replace(/素材代做|素材|代做/g, '').trim()
    return key && text.includes(key)
  })
}

function normalizeAiTasks(tasks) {
  return tasks.map((task) => {
    const type = normalizeAiType(task.type, task)
    const inferredQuantity = inferTaskQuantity(task)
    const count = Math.max(1, Number(task.count) || 1)
    const quantity = Number(task.quantity || task.itemCount || task.amount || inferredQuantity || 0) || 0
    return {
      ...task,
      type,
      account: type === '素材代做' ? '素材' : (task.account || ''),
      content: normalizeTaskContent(task, type, quantity),
      count: shouldKeepAsSingleTask(task, type) ? 1 : count,
      quantity
    }
  })
}

function previewTaskTotal(task) {
  const type = normalizeAiType(task.type, task)
  if (type === '素材代做') {
    return Number(task.quantity || task.itemCount || task.amount || inferTaskQuantity(task) || task.count || 1) || 1
  }
  return Number(task.count || 1) || 1
}

function normalizeAiType(type, task = {}) {
  const value = String(type || '').trim()
  if (/素材/.test(value)) return '素材代做'
  if (/商单|商务|广告|推广/.test(value)) return '商单'
  if (/星广/.test(value)) return '星广联投'
  if (/CPM/i.test(value)) return 'CPM'
  if (/一口价/.test(value)) return '一口价'
  const text = [task.account, task.content, task.remark].filter(Boolean).join(' ')
  const quantity = Number(task.quantity || task.itemCount || task.amount || 0) || 0
  if (!/日常|商单|商务|广告|推广|CPM|一口价|星广|联投/.test(text) && (quantity > 1 || /(?:x|X|×|\*)\s*\d+|\d+\s*(?:条|期|个|份|支|篇)/.test(text))) {
    const account = extractLocalAccount(text)
    if (!account) return '素材代做'
  }
  return value || '日常'
}

function inferTaskQuantity(task) {
  const text = [task.account, task.content, task.remark, aiImportText.value].filter(Boolean).join(' ')
  const match = text.match(/(?:x|X|×|\*)\s*(\d+)|(\d+)\s*(?:条|期|个|份|支|篇)/)
  return match ? Number(match[1] || match[2] || 0) : 0
}

function normalizeTaskContent(task, type, quantity) {
  const raw = String(task.content || task.account || '').trim()
  if (type === '日常') {
    return !raw || raw === '日常' || raw === String(task.account || '').trim() ? '选题待定' : raw
  }
  if (type !== '素材代做' && raw === type) return '选题待定'
  if (type !== '素材代做') return raw
  const cleaned = raw
    .replace(/(?:x|X|×|\*)\s*\d+/g, '')
    .replace(/\d+\s*(?:条|期|个|份|支|篇)/g, '')
    .replace(/^素材$/, '')
    .trim()
  const base = cleaned || String(task.account || '').trim() || '素材代做'
  return normalizeMaterialContentBase(base)
}

function normalizeMaterialContentBase(value) {
  return String(value || '素材代做')
    .replace(/素材代做|素材|代做|混剪|剪辑/g, '')
    .trim() || '素材代做'
}

function shouldKeepAsSingleTask(task, type) {
  const text = [task.account, task.content, aiImportText.value].filter(Boolean).join(' ')
  if (type !== '素材代做' && type !== '日常' && /商单|商务|广告|推广|CPM|一口价|星广|联投|期|单/i.test(text)) return true
  return false
}

function applyKeepOriginal() {
  applySplit(6, 'auto')
}

function applySplit(size, mode = null) {
  const splitSize = Math.max(1, Number(size) || 1)
  const result = []
  const members = currentGroupMembers.value
  const dates = buildAiImportDates()

  for (const task of aiParsedPreview.value) {
    const totalCount = Number(task.count) || 1
    const type = normalizeAiType(task.type, task)
    const isSucai = type === '素材代做'
    const quantity = Number(task.quantity || task.itemCount || task.count || 1) || 1
    const baseContent = normalizeTaskContent(task, type, quantity) || (isSucai ? '待定' : '选题待定')
    const numItems = isSucai ? Math.ceil(quantity / splitSize) : totalCount

    for (let i = 0; i < numItems; i++) {
      const isLast = i === numItems - 1
      const remaining = quantity - i * splitSize
      const itemCount = isSucai ? (isLast && remaining < splitSize ? remaining : splitSize) : 1
      const person = task.person || members[0]
      const date = dates[result.length % dates.length]

      result.push({
        account: isSucai ? '素材' : (task.account || ''),
        content: isSucai ? `${baseContent}x${itemCount}` : baseContent,
        type,
        count: 1,
        itemCount,
        person,
        date
      })
    }
  }

  aiFinalPreview.value = result
  aiSelectedSplit.value = mode || splitSize
}

function resetAiPreview() {
  aiSelectedSplit.value = null
  aiFinalPreview.value = []
}

function buildAiImportDates() {
  const today = new Date()
  const dayOfWeek = today.getDay() || 7
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dayOfWeek - 1))

  const mondayToSunday = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    mondayToSunday.push(d.toISOString().split('T')[0])
  }

  const offsets = [6, 5, 4, 3, 2, 1]
  return offsets.map(offset => mondayToSunday[offset])
}

function formatAiDateLabel(date) {
  if (!date) return '未定'
  const d = new Date(date + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return date
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()} ${week}`
}

function confirmAiImport() {
  if (!aiFinalPreview.value.length) {
    showToast('请先选择拆分方式，生成待导入预览', 'error')
    return
  }

  let imported = 0

  for (const task of aiFinalPreview.value) {
    const person = task.person || currentGroupMembers.value[0] || '陈健伊'
    const type = task.type || '日常'
    const isSucai = type === '素材代做'
    const account = isSucai ? '素材' : (task.account || currentGroupAccounts.value[0] || '素材')
    const itemDate = task.date || buildAiImportDates()[imported % 6]

    openAdd(person)
    form.account = account
    form.content = task.content || normalizeTaskContent(task, type, task.itemCount || task.quantity || 0) || (isSucai ? '待定' : '选题待定')
    form.type = type
    form.date = itemDate
    saveItem()
    imported++
  }

  showToast(`已导入 ${imported} 条任务`, 'success')
  aiParsedPreview.value = []
  aiFinalPreview.value = []
  aiSelectedSplit.value = null
  aiImportText.value = ''
  showAiImport.value = false
}

const {
  ALL_ACCOUNTS,
  GROUPS,
  MEMBERS,
  activeGroup,
  activePasteTarget,
  activeTask,
  boardRef,
  canViewAllGroups,
  canDeleteTasks,
  clearScheduleDoc,
  currentGroupAccounts,
  currentGroupMembers,
  copyItem,
  delItem,
  doPan,
  dragItem,
  editItem,
  editing,
  endPan,
  form,
  formShow,
  fmtMd,
  getItemsForCell,
  handleDragStart,
  handleDragEnd,
  handleDrop,
  handleTaskDrop,
  handleScheduleDocDrop,
  handleScheduleDocFile,
  handleScheduleDocPaste,
  handleWeekDrop,
  hasScheduleDoc,
  moveDraggedItemToAdjacentWeek,
  isPanning,
  isSameDay,
  isToday,
  itemsByPerson,
  openAdd,
  openScheduleDoc,
  saveItem,
  setActiveTask,
  setPasteTarget,
  setScheduleDocLink,
  setWeekPasteTarget,
  formatPersonTaskDate,
  startPan,
  toggleDone,
  undo,
  viewMode,
  weekCardTitle,
  weekDays,
  weekOffset,
  weekRangeLabel,
  workflowStageStepLabel,
  workflowStageTone
} = useScheduleBoard(showToast)

const PARTICIPANT_ROLE_OPTIONS = ['文案', '后期']

function defaultParticipantRoles() {
  return PARTICIPANT_ROLE_OPTIONS.includes(form.workflow_stage)
    ? [form.workflow_stage]
    : ['文案']
}

function setFormWorkflowStage(stage) {
  form.workflow_stage = stage
  if (stage === '已发布') {
    form.status = 'done'
  } else if (stage === '延期') {
    form.status = 'delayed'
  } else {
    form.status = 'pending'
  }
}

function isParticipantSelected(person) {
  return Array.isArray(form.participants) && form.participants.some(row => row.person === person)
}

function syncFormPrimaryParticipant() {
  if (!Array.isArray(form.participants)) form.participants = []
  if (!form.person) return
  const idx = form.participants.findIndex(row => row.person === form.person)
  if (idx === 0) return
  if (idx > 0) {
    const [row] = form.participants.splice(idx, 1)
    form.participants.unshift(row)
    return
  }
  form.participants.unshift({ person: form.person, roles: defaultParticipantRoles() })
}

function toggleParticipant(person) {
  if (!Array.isArray(form.participants)) form.participants = []
  const idx = form.participants.findIndex(row => row.person === person)
  if (idx >= 0) {
    if (form.participants.length <= 1) {
      showToast('至少保留一个参与人', 'error')
      return
    }
    form.participants.splice(idx, 1)
    if (form.person === person) form.person = form.participants[0]?.person || ''
    return
  }
  form.participants.push({ person, roles: defaultParticipantRoles() })
  if (!form.person) form.person = person
  syncFormPrimaryParticipant()
}

function toggleParticipantRole(row, role) {
  const roles = Array.isArray(row.roles) ? row.roles : []
  if (roles.includes(role)) {
    if (roles.length <= 1) return
    row.roles = roles.filter(item => item !== role)
    return
  }
  row.roles = [...roles, role]
}

function participantRolesLabel(row) {
  return Array.isArray(row.roles) && row.roles.length ? row.roles.join(' / ') : '未设定'
}

function weekPeopleLabel(item) {
  if (item?._parallel_items) return item.person
  return (item?.participants || []).map(row => row.person).filter(Boolean).join(' / ') || item?.person || ''
}

function handleScheduleFormEnter(event) {
  if (event?.isComposing) return
  const target = event?.target
  const tag = String(target?.tagName || '').toLowerCase()
  if (tag === 'button' || tag === 'a' || target?.type === 'file') return
  event?.preventDefault()
  saveItem()
}
</script>

<style scoped>
.schedule-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
  flex-shrink: 0;
}

.module-header h2 {
  margin: 0;
  font-size: 20px;
  color: var(--primary, #7b2fff);
  font-weight: 700;
}

.view-toggle {
  display: flex;
  gap: 4px;
  background: var(--surface2, #1e1e3a);
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--border, #2a2a4a);
}

.view-toggle button {
  padding: 5px 14px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text, #e0d8ff);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.view-toggle button.active {
  background: var(--primary, #7b2fff);
  color: #fff;
}

.undo-btn {
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid var(--border, #2a2a4a);
  background: var(--surface2, #1e1e3a);
  color: var(--text, #e0d8ff);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.undo-btn:hover {
  background: var(--primary, #7b2fff);
  border-color: var(--primary, #7b2fff);
  transform: scale(1.05);
}
.undo-btn:active {
  transform: scale(0.95) rotate(-5deg);
}
.ai-import-btn {
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid var(--border, #2a2a4a);
  background: var(--surface2, #1e1e3a);
  color: var(--text, #e0d8ff);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ai-import-btn:hover {
  background: var(--success-text);
  border-color: var(--success-text);
  transform: scale(1.05);
}
.ai-import-btn:active {
  transform: scale(0.95);
}
.ai-import-modal {
  width: min(860px, calc(100vw - 40px));
  max-height: min(760px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
}
.ai-import-modal .modal-body {
  overflow: auto;
  min-height: 0;
}
.ai-import-modal .modal-foot {
  position: sticky;
  bottom: 0;
  z-index: 2;
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.ai-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  margin-bottom: 12px;
}
.ai-preview {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: 8px;
}
.ai-preview-title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
  color: var(--text);
}
.ai-preview-title small {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
}
.ai-preview-list {
  max-height: 260px;
  overflow-y: auto;
}
.ai-preview-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--surface2);
  border-radius: 10px;
  margin-bottom: 8px;
  border: 2px solid var(--border);
  box-shadow: 0 4px 12px rgba(11, 8, 23, 0.16);
}
.ai-preview-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ai-preview-content {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: normal;
  line-height: 1.45;
}
.ai-preview-count {
  font-size: 12px;
  color: var(--primary);
  font-weight: 700;
  white-space: nowrap;
}
.ai-preview-detail {
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 260px;
}
.ai-preview-detail span {
  background: var(--surface);
  padding: 2px 6px;
  border-radius: 4px;
}
.ai-split-options {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.ai-split-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 2px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.ai-split-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px var(--primary-shadow, rgba(123, 47, 255, 0.2));
}
.ai-split-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  box-shadow: 0 8px 18px var(--primary-shadow-hover, rgba(123, 47, 255, 0.28));
}
.ai-custom-split {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}
.ai-custom-split input {
  width: 60px;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
.ai-final-table {
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface2);
}
.ai-final-head,
.ai-final-row {
  display: grid;
  grid-template-columns: 44px 96px 84px 110px 86px minmax(220px, 1fr);
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.ai-final-head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--surface2) 88%, var(--primary) 12%);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  border-bottom: 1px solid var(--border);
}
.ai-final-row {
  min-height: 48px;
  font-size: 12px;
  color: var(--text);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}
.ai-final-row:last-child {
  border-bottom: none;
}
.ai-final-row:nth-child(odd) {
  background: rgba(255,255,255,0.025);
}
.ai-final-index,
.ai-final-date,
.ai-final-person,
.ai-final-type {
  font-weight: 700;
}
.ai-final-date {
  color: var(--primary);
}
.ai-final-content {
  line-height: 1.45;
  word-break: break-word;
}
.ai-confirm-btn {
  min-width: 140px;
  font-weight: 800;
}

/* ===== Group Tabs ===== */
.group-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.group-tab {
  padding: 7px 18px;
  border-radius: 8px;
  border: 1px solid var(--border, #2a2a4a);
  background: var(--surface, #1a1a2e);
  color: var(--text-dim, #9d98b0);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.group-tab:hover {
  border-color: var(--primary, #7b2fff);
  color: var(--primary-light, #b47fff);
}

.group-tab.active {
  background: var(--primary, #7b2fff);
  border-color: var(--primary, #7b2fff);
  color: #fff;
}

/* ===== Person Board ===== */
.board {
  display: flex;
  gap: 24px;
  overflow-x: auto;
  flex: 1;
  padding-bottom: 12px;
  align-items: flex-start;
  user-select: none;
}

.board-col {
  min-width: 320px;
  flex: 1;
  max-width: 400px;
  background: var(--surface, #1a1a2e);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.board-col.pasteActive {
  border-color: color-mix(in srgb, var(--primary, #7b2fff) 58%, var(--border, #2a2a4a));
  box-shadow: inset 0 0 0 1px rgba(123,47,255,0.18);
}

.col-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border, #2a2a4a);
}

.col-name { font-size: 15px; font-weight: 700; color: var(--primary-light, #b47fff); letter-spacing: 0; }
.col-count {
  background: var(--accent-soft);
  color: var(--primary, #7b2fff);
  border: 1px solid var(--border-bright);
  font-size: 11px; font-weight: 700;
  padding: 3px 10px; border-radius: 10px;
}

.card-stack {
  flex: 1; display: flex; flex-direction: column; gap: 12px;
  padding: 14px; overflow-y: auto; min-height: 120px; position: relative;
}
.card-stack.paste-target {
  background: color-mix(in srgb, var(--accent-soft) 58%, transparent);
  box-shadow: inset 0 0 0 1px var(--border-bright);
}

.task-card {
  background: var(--panel-bg, var(--bg-card, #12122a));
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 10px; padding: 14px 16px;
  cursor: grab; position: relative;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s;
  animation: cardAppear 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.task-card:hover { cursor: pointer; }
.task-card:hover {
  border-color: var(--primary, #7b2fff);
  box-shadow: 0 12px 30px var(--primary-shadow, rgba(123,47,255,0.3));
  transform: scale(1.03) translateY(-2px);
}
.task-card.selected {
  border-color: var(--primary, #7b2fff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary, #7b2fff) 48%, transparent), 0 10px 26px var(--primary-shadow, rgba(123,47,255,0.22));
}
.task-card:focus-visible,
.week-card:focus-visible {
  outline: 2px solid var(--primary, #7b2fff);
  outline-offset: 2px;
}
.task-card:active { cursor: grabbing; transform: scale(0.92) rotate(-3deg); }
.task-card.done-exit { animation: doneExplode 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }

@keyframes cardAppear {
  0% { transform: scale(0.8) translateY(10px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}

@keyframes doneExplode {
  0% { transform: scale(1); opacity: 1; }
  40% { transform: scale(1.25) rotate(5deg); opacity: 1; }
  100% { transform: scale(0) rotate(20deg); opacity: 0; }
}

.task-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 70px;
  margin-bottom: 6px;
  min-width: 0;
}
.task-account {
  font-size: 13px;
  color: var(--text, #e0d8ff);
  font-weight: 800;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-type {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--primary-light, #b47fff);
}
.task-content {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text, #e0d8ff);
  margin-bottom: 10px;
  padding-right: 8px;
  word-break: break-word;
  min-height: 2.8em;
}
.task-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.task-type-tag { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: var(--accent-soft); color: var(--primary-light, #b47fff); }
.task-type.daily {
  background: rgba(16, 185, 129, 0.34);
  color: #a7f3d0;
  border: 1px solid rgba(52, 211, 153, 0.45);
}
.task-type.business {
  background: rgba(245, 158, 11, 0.32);
  color: #fde68a;
  border: 1px solid rgba(251, 191, 36, 0.48);
}
.task-type.material {
  background: rgba(14, 165, 233, 0.32);
  color: #bae6fd;
  border: 1px solid rgba(56, 189, 248, 0.5);
}
.task-status { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; }
.task-status.draft { background: rgba(96, 165, 250, 0.14); color: #93c5fd; }
.task-status.post { background: rgba(45, 212, 191, 0.14); color: #5eead4; }
.task-status.pending { background: var(--warning-bg); color: var(--warning-text); }
.task-status.done { background: var(--success-bg); color: var(--success-text); }
.task-status.delayed { background: var(--danger-bg); color: var(--danger-text); }
.task-date {
  font-size: 16px;
  color: var(--text, #e0d8ff);
  font-weight: 900;
  margin-left: auto;
  line-height: 1;
}
.task-participants {
  max-width: 100%;
  font-size: 10px;
  color: var(--text-muted);
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 5px;
  padding: 2px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-entry,
.week-doc-entry {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-bright);
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--primary-light, #b47fff);
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
}

.doc-entry:hover,
.week-doc-entry:hover {
  background: var(--primary, #7b2fff);
  color: #fff;
}

.task-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
.task-inline-tools {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
  order: 0;
}
.task-card:hover .task-inline-tools,
.task-card:focus-within .task-inline-tools {
  opacity: 1;
}
.tbtn { background: none; border: none; cursor: pointer; padding: 2px 4px; font-size: 12px; border-radius: 4px; color: var(--text, #e0d8ff); transition: background 0.15s; }
.tbtn:hover { background: var(--accent-soft); }
.stage-advance-btn {
  --stage-color: var(--primary-light, #b47fff);
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at center, var(--panel-bg, var(--bg-card, #12122a)) 0 56%, transparent 58%),
    conic-gradient(var(--stage-color) 0 var(--stage-angle, 120deg), rgba(255,255,255,0.1) var(--stage-angle, 120deg) 360deg);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 0 1px rgba(255,255,255,0.04);
  color: var(--text, #e0d8ff);
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  order: 1;
  padding: 0;
  transition: filter 0.15s, transform 0.15s, box-shadow 0.15s;
}
.stage-advance-btn.draft { --stage-color: #60a5fa; }
.stage-advance-btn.post { --stage-color: #2dd4bf; }
.stage-advance-btn.pending { --stage-color: var(--warning-text); }
.stage-advance-btn.done { --stage-color: var(--success-text); }
.stage-advance-btn span {
  font-size: 8px;
  font-weight: 900;
  line-height: 1;
}
.stage-advance-btn:hover {
  filter: brightness(1.16);
  transform: translateY(-1px) scale(1.04);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 0 0 1px color-mix(in srgb, var(--stage-color) 54%, transparent);
}

.drop-hint {
  border: 2px dashed var(--border-bright);
  background: var(--accent-soft);
  border-radius: 8px; padding: 14px; text-align: center;
  font-size: 11px; color: var(--primary, #7b2fff); margin-top: 4px;
}

.column-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 10px;
}

.add-btn {
  margin: 0;
  padding: 8px;
  background: transparent; border: 2px dashed var(--border, #2a2a4a);
  border-radius: 8px; color: var(--primary-light, #b47fff);
  font-size: 12px; font-family: inherit; cursor: pointer;
  transition: border-color 0.15s, color 0.15s; width: 100%;
}
.add-btn:hover { border-color: var(--primary, #7b2fff); color: var(--primary, #7b2fff); }

/* ===== Week Board ===== */
.week-board-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.week-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-shrink: 0;
}

.week-cross-drop {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  height: 0;
  margin-top: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  transition: height 0.16s ease, margin 0.16s ease, opacity 0.16s ease;
}

.week-cross-drop.active {
  height: 42px;
  margin-top: 12px;
  opacity: 1;
  pointer-events: auto;
}

.week-cross-zone {
  border: 1px dashed var(--border-bright);
  border-radius: 12px;
  padding: 10px 12px;
  text-align: center;
  color: var(--primary-light, #b47fff);
  background: var(--accent-soft);
  font-size: 12px;
  font-weight: 700;
}

.week-cross-zone:hover {
  border-color: var(--primary, #7b2fff);
  background: rgba(123, 47, 255, 0.18);
}

.week-arrow {
  background: var(--surface2, #1e1e3a);
  border: 1px solid var(--border, #2a2a4a);
  color: var(--text, #e0d8ff);
  font-size: 18px;
  width: 32px; height: 32px;
  border-radius: 8px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.week-arrow:hover { border-color: var(--primary, #7b2fff); color: var(--primary-light, #b47fff); }

.week-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary-light, #b47fff);
  min-width: 160px;
  text-align: center;
}

.week-board {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
}

.week-head-row {
  display: grid;
  grid-template-columns: 120px repeat(7, 1fr);
  border-bottom: 1px solid var(--border, #2a2a4a);
  position: sticky;
  top: 0;
  background: var(--surface, #1a1a2e);
  z-index: 2;
}

.week-acc-col {
  padding: 10px 12px;
  border-right: 1px solid var(--border, #2a2a4a);
  display: flex;
  align-items: center;
}

.week-day-hdr {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px;
  border-right: 1px solid var(--border, #2a2a4a);
  gap: 2px;
}
.week-day-hdr:last-child { border-right: none; }
.week-day-hdr.today { background: rgba(123, 47, 255, 0.12); }

.week-day-name { font-size: 11px; font-weight: 700; color: var(--text-dim, #9d98b0); }
.week-day-date { font-size: 12px; color: var(--text, #e0d8ff); }
.week-day-hdr.today .week-day-date { color: var(--primary, #7b2fff); font-weight: 700; }

.week-row {
  display: grid;
  grid-template-columns: 120px repeat(7, 1fr);
  border-bottom: 1px solid var(--border, #2a2a4a);
}
.week-row:last-child { border-bottom: none; }

.week-acc-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text, #e0d8ff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.week-cell {
  min-height: 64px;
  padding: 5px;
  border-right: 1px solid var(--border, #2a2a4a);
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  transition: background 0.1s;
}
.week-cell:last-child { border-right: none; }
.week-cell.today { background: rgba(123, 47, 255, 0.08); }
.week-cell:hover { background: var(--panel-bg-soft); }

.week-card {
  padding: 3px 5px;
  border-radius: 4px;
  font-size: 10px;
  cursor: grab;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-left: 3px solid;
  transition: filter 0.2s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s;
  animation: weekCardPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  position: relative;
}
.week-card:hover { filter: brightness(1.25); transform: scale(1.05); }
.week-card:active { cursor: grabbing; transform: scale(0.95) rotate(-2deg); }
.week-card.done-exit { animation: doneExplode 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }

@keyframes weekCardPop {
  0% { transform: scale(0.7); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.week-card.pending { background: var(--warning-bg); border-color: var(--warning-text); }
.week-card.done { background: var(--success-bg); border-color: var(--success-text); }
.week-card.delayed { background: var(--danger-bg); border-color: var(--danger-text); }
.week-card.draft { background: rgba(96, 165, 250, 0.11); border-color: #60a5fa; }
.week-card.post { background: rgba(45, 212, 191, 0.11); border-color: #2dd4bf; }

.week-card-person {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary, #7b2fff);
}
.week-card-person.merged {
  font-size: 11px;
  line-height: 1.2;
  padding-right: 28px;
}

.week-card-type {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(123, 47, 255, 0.2);
  color: var(--primary-light, #b47fff);
}
.week-card-type.daily {
  background: rgba(16, 185, 129, 0.36);
  color: #a7f3d0;
  border: 1px solid rgba(52, 211, 153, 0.45);
}
.week-card-type.business {
  background: rgba(245, 158, 11, 0.36);
  color: #fde68a;
  border: 1px solid rgba(251, 191, 36, 0.48);
}
.week-card-type.material {
  background: rgba(14, 165, 233, 0.36);
  color: #bae6fd;
  border: 1px solid rgba(56, 189, 248, 0.5);
}

:global(:root[data-ui-style="apple"] .task-type),
:global(:root[data-ui-style="apple"] .week-card-type) {
  background: rgba(0, 122, 255, 0.1);
  color: #064b83;
  border: 1px solid rgba(0, 122, 255, 0.2);
}

:global(:root[data-ui-style="apple"] .task-type.daily),
:global(:root[data-ui-style="apple"] .week-card-type.daily) {
  background: rgba(52, 199, 89, 0.16);
  color: #176a2f;
  border-color: rgba(36, 138, 61, 0.28);
}

:global(:root[data-ui-style="apple"] .task-type.business),
:global(:root[data-ui-style="apple"] .week-card-type.business) {
  background: rgba(255, 159, 10, 0.18);
  color: #7a4b00;
  border-color: rgba(154, 103, 0, 0.3);
}

:global(:root[data-ui-style="apple"] .task-type.material),
:global(:root[data-ui-style="apple"] .week-card-type.material) {
  background: rgba(90, 200, 250, 0.2);
  color: #005180;
  border-color: rgba(0, 122, 255, 0.26);
}

:global(:root[data-ui-style="usagi"] .task-type),
:global(:root[data-ui-style="usagi"] .week-card-type) {
  background: rgba(201, 149, 55, 0.16);
  color: #6b3f08;
  border: 1px dashed rgba(110, 72, 47, 0.22);
}

:global(:root[data-ui-style="usagi"] .task-type.daily),
:global(:root[data-ui-style="usagi"] .week-card-type.daily) {
  background: rgba(103, 185, 158, 0.24);
  color: #1f6b58;
  border-color: rgba(31, 138, 106, 0.32);
}

:global(:root[data-ui-style="usagi"] .task-type.business),
:global(:root[data-ui-style="usagi"] .week-card-type.business) {
  background: rgba(255, 216, 79, 0.34);
  color: #7a4a08;
  border-color: rgba(168, 100, 0, 0.3);
}

:global(:root[data-ui-style="usagi"] .task-type.material),
:global(:root[data-ui-style="usagi"] .week-card-type.material) {
  background: rgba(215, 126, 145, 0.2);
  color: #8a3148;
  border-color: rgba(199, 67, 95, 0.3);
}

.week-doc-entry {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  font-size: 9px;
}

.week-card-stage {
  align-self: flex-start;
  max-width: calc(100% - 24px);
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 9px;
  font-weight: 800;
  color: var(--text, #e0d8ff);
  background: rgba(255,255,255,0.08);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.week-card-stage.draft { color: #93c5fd; }
.week-card-stage.post { color: #5eead4; }
.week-card-stage.pending { color: var(--warning-text); }
.week-card-stage.done { color: var(--success-text); }
.week-card-acc {
  font-size: 11px;
  font-weight: 600;
  color: var(--success-text);
}

.week-card-remark {
  font-size: 12px;
  line-height: 1.35;
  color: var(--text, #e0d8ff);
  white-space: normal;
  overflow: hidden;
  max-width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* Modal */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(11, 8, 23, 0.58);
  display: flex; align-items: center; justify-content: center;
  z-index: 999;
}
.modal {
  background: var(--bg-card, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 16px; width: 440px; max-width: 95vw;
  box-shadow: 0 20px 54px rgba(11, 8, 23, 0.34);
}
.modal-hdr {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 24px; border-bottom: 1px solid var(--border, #2a2a4a);
  font-size: 14px; font-weight: 600; color: var(--primary-light, #b47fff);
}
.close-btn { font-size: 14px; padding: 4px 8px; }
.modal-body { display: flex; flex-direction: column; gap: 14px; padding: 16px 24px; }
.form-row { display: flex; flex-direction: column; gap: 6px; }
.form-row label { font-size: 12px; font-weight: 600; color: var(--primary-light, #b47fff); }
.inp { width: 100%; background: var(--surface2, #1e1e3a); border: 1px solid var(--border, #2a2a4a); border-radius: 8px; padding: 8px 12px; color: var(--text, #e0d8ff); font-size: 13px; font-family: inherit; outline: none; box-sizing: border-box; transition: border-color 0.15s; }
.inp:focus { border-color: var(--primary, #7b2fff); }
textarea.inp { resize: vertical; min-height: 72px; }
select.inp { cursor: pointer; }

.doc-input-row,
.doc-dropzone {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.doc-dropzone {
  align-items: center;
  min-height: 36px;
  padding: 4px;
  border: 1px dashed var(--border, #2a2a4a);
  border-radius: 9px;
  background: color-mix(in srgb, var(--surface2, #1e1e3a) 82%, transparent);
  transition: border-color .15s, background .15s, box-shadow .15s;
}

.doc-dropzone.dragging {
  border-color: var(--primary, #7b2fff);
  background: var(--accent-soft);
  box-shadow: 0 0 0 2px rgba(123, 47, 255, 0.12);
}

.doc-dropzone.filled {
  border-style: solid;
}

.doc-link-input {
  min-width: 0;
  height: 28px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text, #e0d8ff);
  font: inherit;
  font-size: 12px;
  padding: 0 7px;
}

.doc-link-input::placeholder {
  color: var(--text-muted);
}

.doc-file-btn {
  display: inline-grid;
  place-items: center;
  height: 28px;
  min-width: 30px;
  padding: 0 8px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  background: var(--surface2, #1e1e3a);
  color: var(--primary-light, #b47fff);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.doc-file-btn:hover {
  border-color: var(--primary, #7b2fff);
  background: var(--accent-soft);
}

.doc-file-btn input {
  display: none;
}

.doc-current {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.doc-current span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.doc-current button {
  border: 0;
  background: transparent;
  color: var(--danger-text);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
.btn-group { display: flex; gap: 8px; }
.btn-option { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border, #2a2a4a); background: transparent; color: var(--text, #e0d8ff); font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.15s; }
.btn-option.active { background: var(--primary, #7b2fff); border-color: var(--primary, #7b2fff); color: #fff; }
.btn-option:not(.active):hover { border-color: var(--primary, #7b2fff); }
.workflow-group {
  flex-wrap: wrap;
}
.workflow-option {
  padding-inline: 10px;
}
.collab-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.participant-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 30px;
}
.participant-summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border: 1px solid var(--border, #2a2a4a);
  background: var(--surface2, #1e1e3a);
  color: var(--text, #e0d8ff);
  border-radius: 7px;
  padding: 5px 9px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.participant-summary-chip.primary {
  border-color: var(--primary, #7b2fff);
  box-shadow: inset 0 0 0 1px rgba(123,47,255,0.22);
}
.participant-summary-chip small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 11px;
}
.participant-advanced {
  border: 1px dashed var(--border, #2a2a4a);
  border-radius: 8px;
  padding: 8px;
}
.participant-advanced summary {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 12px;
}
.participant-advanced[open] summary {
  margin-bottom: 8px;
  color: var(--text, #e0d8ff);
}
.participant-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.participant-pool,
.participant-role-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.participant-chip,
.participant-role-chip {
  border: 1px solid var(--border, #2a2a4a);
  background: var(--surface2, #1e1e3a);
  color: var(--text-dim, #9d98b0);
  border-radius: 7px;
  padding: 5px 9px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.participant-chip.active,
.participant-role-chip.active {
  color: #fff;
  background: var(--primary, #7b2fff);
  border-color: var(--primary, #7b2fff);
}
.participant-picked {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.participant-row {
  display: grid;
  grid-template-columns: 72px minmax(62px, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  background: rgba(255,255,255,0.03);
}
.participant-name {
  font-size: 12px;
  font-weight: 800;
  color: var(--text, #e0d8ff);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.participant-role-label {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.participant-role-chip {
  padding: 3px 7px;
  font-size: 11px;
}
.modal-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 24px 20px; }
.btn { padding: 8px 18px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 500; transition: all 0.15s; }
.btn-primary { background: var(--primary, #7b2fff); color: #fff; border: none; }
.btn-primary:hover { background: var(--primary-dark, #4a1a8a); }
.btn-ghost { background: transparent; border: 1px solid var(--border, #2a2a4a); color: var(--text, #e0d8ff); }
.btn-ghost:hover { border-color: var(--primary, #7b2fff); color: var(--primary-light, #b47fff); }
.btn-sm { padding: 4px 12px; font-size: 11px; }
.toast { position: fixed; bottom: 28px; right: 28px; padding: 12px 20px; border-radius: 10px; font-size: 13px; z-index: 1001; font-weight: 500; pointer-events: none; }
.toast.success { background: var(--success-bg); color: var(--success-text); border: 1px solid var(--success-border); }
.toast.error { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
.toast.info { background: var(--surface2, #1e1e3a); color: var(--text, #e0d8ff); border: 1px solid var(--border, #2a2a4a); }
.toast.big { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 24px 48px; border-radius: 16px; font-size: 20px; font-weight: 700; text-align: center; min-width: 320px; z-index: 9999; box-shadow: 0 0 40px rgba(0,245,212,0.3), 0 0 80px rgba(123,47,255,0.2); }
</style>
