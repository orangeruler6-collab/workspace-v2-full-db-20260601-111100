<template>
  <div class="sb-wrap">
    <div class="sb-header">
      <span class="sb-title">📅 排期看板</span>
      <div class="sb-tabs">
        <button v-for="m in members" :key="m.id" class="sb-tab" :class="{ active: selMember === m.id }" :style="selMember === m.id ? { borderBottomColor: m.color, color: m.color } : {}" @click="selMember = selMember === m.id ? null : m.id">
          {{ m.name }}
        </button>
        <button class="sb-tab" :class="{ active: selMember === null }" @click="selMember = null">全部</button>
      </div>
      <div class="sb-header-right">
        <button class="sb-add-btn" @click="addTask">+ 新任务</button>
      </div>
    </div>
    <div v-if="saveError" class="sb-error">{{ saveError }}</div>
    <div class="sb-grid">
      <div
        v-for="day in days"
        :key="day"
        class="sb-col"
        :class="{ 'drag-over': dragOverDay === day }"
        @dragenter="onDragEnter($event, day)"
        @dragover.prevent="onDragOver($event, day)"
        @drop.prevent="onDrop($event, day)"
        @dragleave="onDragLeave">
        <div class="sb-col-hd">{{ day }}<span class="sb-col-count">{{ filteredTasks.filter(t => t.day === day).length }}</span></div>
        <div class="sb-col-body">
          <div
            v-for="task in filteredTasks.filter(t => t.day === day)"
            :key="task.id"
            class="sb-task"
            :style="{ borderLeftColor: getMember(task.memberId).color }"
            draggable="true"
            @dragstart="onDragStart($event, task)"
            @dragend="onDragEnd"
            @click="editTask(task)">
            <div class="sb-task-name">{{ task.name }}</div>
            <div class="sb-task-footer">
              <span class="sb-task-type" :class="task.type">{{ task.type }}</span>
              <span class="sb-task-member" :style="{ color: getMember(task.memberId).color }">{{ getMember(task.memberId).name }}</span>
            </div>
          </div>
          <div v-if="!filteredTasks.filter(t => t.day === day).length" class="sb-empty">拖拽任务到这里</div>
        </div>
      </div>
    </div>

    <!-- 任务编辑弹窗 -->
    <div v-if="showEdit" class="sb-modal" @click.self="showEdit = false">
      <div class="sb-modal-box">
        <div class="sb-modal-title">{{ editMode === 'new' ? '新任务' : '编辑任务' }}</div>
        <div class="sb-modal-field">
          <label>任务名</label>
          <input v-model="editTaskData.name" class="inp" placeholder="例如：天机妹-商单A" />
        </div>
        <div class="sb-modal-row">
          <div class="sb-modal-field">
            <label>负责人</label>
            <select v-model="editTaskData.memberId" class="inp">
              <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </div>
          <div class="sb-modal-field">
            <label>类型</label>
            <select v-model="editTaskData.type" class="inp">
              <option value="文案">文案</option>
              <option value="后期">后期</option>
            </select>
          </div>
        </div>
        <div class="sb-modal-btns">
          <button v-if="editMode === 'edit'" class="btn btn-ghost btn-sm" @click="deleteTask">删除</button>
          <button class="btn btn-ghost btn-sm" @click="showEdit = false">取消</button>
          <button class="btn btn-primary btn-sm" @click="saveTask">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { loadSchedule, saveSchedule } from './api/schedule'

export default {
  name: 'ScheduleBoard',
  data: function() {
    return {
      selMember: null,
      days: ['周一', '周二', '周三', '周四', '周五'],
      dragEnterCounts: {},
      members: [
        { id: 'chen', name: '陈健伊', color: '#6366f1' },
        { id: 'lin', name: '林宇辰', color: '#f59e0b' },
        { id: 'yao', name: '姚希', color: '#10b981' },
        { id: 'song', name: '宋丽佳', color: '#ec4899' }
      ],
      tasks: [],
      showEdit: false,
      editMode: 'new',
      editTaskData: { id: null, name: '', memberId: 'chen', type: '文案', day: '周一' },
      saveError: '',
      dragTask: null,
      dragOverDay: null,
    }
  },
  computed: {
    filteredTasks: function() {
      if (!this.selMember) return this.tasks
      return this.tasks.filter(function(t) { return t.memberId === this.selMember }.bind(this))
    }
  },
  mounted: function() {
    this.loadTasks()
  },
  methods: {
    getMember: function(id) {
      return this.members.find(function(m) { return m.id === id }) || {}
    },
    loadTasks: function() {
      var self = this
      loadSchedule().then(function(d) {
        if (d.members && d.members.length) self.members = d.members
        if (d.tasks && d.tasks.length) self.tasks = d.tasks
      }).catch(function() {})
    },
    saveAll: function() {
      var self = this
      this.saveError = ''
      saveSchedule(this.tasks, this.members).then(function(d) {
        if (!d.ok) self.saveError = '保存失败：' + (d.error || '请稍后重试')
      }).catch(function(e) { self.saveError = '保存失败：' + (e.message || '请检查后端服务') })
    },
    onDragStart: function(e, task) {
      this.dragTask = task
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnter: function(e, day) {
      e.preventDefault()
      this.dragOverDay = day
    },
    onDragOver: function(e, day) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      this.dragOverDay = day
    },
    onDragLeave: function(e) {
      // Don't clear immediately - only clear if leaving to outside the entire grid
    },
    onDrop: function(e, day) {
      e.preventDefault()
      if (!this.dragTask) return
      var task = this.tasks.find(function(t) { return t.id === this.dragTask.id }.bind(this))
      if (task && task.day !== day) {
        task.day = day
        this.saveAll()
      }
      this.dragTask = null
      this.dragOverDay = null
    },
    onDragEnd: function() {
      this.dragTask = null
      this.dragOverDay = null
    },
    addTask: function() {
      this.editMode = 'new'
      this.editTaskData = { id: Date.now(), name: '', memberId: 'chen', type: '文案', day: '周一' }
      this.showEdit = true
    },
    editTask: function(task) {
      this.editMode = 'edit'
      this.editTaskData = Object.assign({}, task)
      this.showEdit = true
    },
    saveTask: function() {
      if (!this.editTaskData.name.trim()) return
      if (this.editMode === 'new') {
        this.tasks.push(Object.assign({}, this.editTaskData))
      } else {
        var t = this.tasks.find(function(x) { return x.id === this.editTaskData.id }.bind(this))
        if (t) Object.assign(t, this.editTaskData)
      }
      this.showEdit = false
      this.saveAll()
    },
    deleteTask: function() {
      this.tasks = this.tasks.filter(function(t) { return t.id !== this.editTaskData.id }.bind(this))
      this.showEdit = false
      this.saveAll()
    }
  }
}
</script>

<style scoped>
.sb-wrap { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.sb-header { padding: 12px 16px; background: #1a1a28; border-bottom: 1px solid #222; display: flex; align-items: center; gap: 16px; flex-shrink: 0; flex-wrap: wrap; }
.sb-error { margin: 10px 16px 0; padding: 9px 12px; border: 1px solid rgba(239,68,68,.35); border-radius: 8px; background: rgba(239,68,68,.1); color: #fca5a5; font-size: 12px; }
.sb-title { font-size: 15px; font-weight: 600; color: #fff; margin-right: 8px; }
.sb-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.sb-tab { background: none; border: none; color: #888; font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer; border-bottom: 2px solid transparent; transition: all .15s; }
.sb-tab:hover { color: #fff; background: rgba(255,255,255,.05); }
.sb-tab.active { color: #fff; font-weight: 600; }
.sb-header-right { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.sb-add-btn { background: #7c3aed; color: #fff; border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
.sb-add-btn:hover { background: #6d28d9; }
.sb-grid { display: flex; flex: 1; overflow-x: auto; overflow-y: auto; gap: 12px; padding: 16px; min-height: 0; }
.sb-col { min-width: 160px; flex: 1; display: flex; flex-direction: column; gap: 8px; }
.sb-col-hd { font-size: 12px; font-weight: 600; color: #9d98b0; padding: 6px 4px; border-bottom: 1px solid rgba(124,58,237,.2); display: flex; align-items: center; gap: 6px; }
.sb-col-count { background: rgba(124,58,237,.2); color: #a78bfa; font-size: 10px; padding: 1px 6px; border-radius: 10px; }
.sb-col-body { display: flex; flex-direction: column; gap: 6px; min-height: 60px; }
.sb-col.drag-over .sb-col-body { background: rgba(124,58,237,.08); border-radius: 8px; }
.sb-task { background: #131020; border: 1px solid #222; border-left: 3px solid; border-radius: 8px; padding: 8px 10px; cursor: grab; transition: all .15s; }
.sb-task:hover { border-color: rgba(124,58,237,.4); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,.4); }
.sb-task:active { cursor: grabbing; opacity: .7; }
.sb-task-name { font-size: 12px; font-weight: 600; color: #f0eef5; margin-bottom: 6px; line-height: 1.4; }
.sb-task-footer { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.sb-task-type { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
.sb-task-type.文案 { background: rgba(99,102,241,.2); color: #818cf8; }
.sb-task-type.后期 { background: rgba(16,185,129,.2); color: #34d399; }
.sb-task-member { font-size: 10px; font-weight: 600; }
.sb-empty { color: #444; font-size: 11px; text-align: center; padding: 16px 8px; border: 1px dashed rgba(124,58,237,.15); border-radius: 8px; margin-top: 4px; }
.sb-modal { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 500; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.sb-modal-box { background: #1a1625; border: 1px solid rgba(124,58,237,.3); border-radius: 14px; padding: 24px; width: 360px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.6); }
.sb-modal-title { font-size: 15px; font-weight: 700; color: #fff; }
.sb-modal-field { display: flex; flex-direction: column; gap: 6px; }
.sb-modal-field label { font-size: 11px; color: #6b6480; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }
.sb-modal-row { display: flex; gap: 12px; }
.sb-modal-row .sb-modal-field { flex: 1; }
.sb-modal-btns { display: flex; gap: 8px; justify-content: flex-end; }
</style>
