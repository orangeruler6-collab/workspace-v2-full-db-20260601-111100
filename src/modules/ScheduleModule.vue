<template>
  <div class="schedule-module" :class="{ 'schedule-module-todo': activeGroup === DEPARTMENT_TODO_TAB }">
    <div class="module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">📅</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">SCHEDULE BOARD</div>
          <h2>排期看板</h2>
        </div>
      </div>
      <div v-if="activeGroup !== DEPARTMENT_TODO_TAB" class="view-toggle module-page-actions">
        <button :class="{ active: viewMode === 'person' }" @click="viewMode = 'person'">👤 按人</button>
        <button :class="{ active: viewMode === 'week' }" @click="viewMode = 'week'">📆 按周</button>
      </div>
      <button v-if="activeGroup !== DEPARTMENT_TODO_TAB" class="undo-btn" @click="undo" title="撤销 (Ctrl+Z)">↩️ 撤销</button>
      <button v-if="activeGroup !== DEPARTMENT_TODO_TAB" class="history-btn" @click="showScheduleHistory = true" title="查看推进记录">🕘 历史记录</button>
      <button v-if="activeGroup !== DEPARTMENT_TODO_TAB" class="ai-import-btn" @click="openBatchImport" title="批量创建">➕ 批量创建</button>
    </div>

    <!-- 组选择 tabs（组长/部长可见，组员隐藏） -->
    <div v-if="canViewAllGroups" class="group-tabs">
      <button v-for="g in GROUPS" :key="g.id" class="group-tab" :class="{ active: activeGroup === g.id }" @click="activeGroup = g.id">{{ g.label }}</button>
      <button class="group-tab department-todo-tab" :class="{ active: activeGroup === DEPARTMENT_TODO_TAB }" @click="activeGroup = DEPARTMENT_TODO_TAB">部门待办</button>
    </div>

    <section
      v-if="activeGroup === DEPARTMENT_TODO_TAB"
      class="todo-board"
      :class="{ 'todo-board-alarm': departmentTodoStats.overdue || departmentTodoStats.today || departmentTodoStats.soon }"
      aria-label="组待办事项">
      <div class="todo-board-head">
        <div class="todo-board-title">
          <span class="todo-mascot-mark" aria-hidden="true">!</span>
          <div>
            <div class="todo-kicker">SUBJUGATION BOARD</div>
            <h3>部门讨伐板</h3>
          </div>
        </div>
        <div class="todo-raid-summary">
          <span><strong>{{ departmentTodoStats.open }}</strong> 待讨伐</span>
          <span><strong>{{ departmentTodoStats.today + departmentTodoStats.soon }}</strong> 斩杀线</span>
          <span><strong>{{ departmentTodoStats.overdue }}</strong> 逾期</span>
          <span><strong>{{ departmentTodoStats.progress }}%</strong> 清场</span>
          <button type="button" class="todo-history-btn" @click="openTodoHistory">已完成历史</button>
        </div>
      </div>
      <div class="todo-board-hint">输入讨伐令时可以带“明天 / 周四 / 14:00 / 重要”，系统会自动识别 DDL 斩杀线。</div>
      <div class="todo-group-grid">
        <article
          v-for="g in visibleTodoGroups"
          :key="g.id"
          class="todo-group"
          :class="[{ active: activeGroup === g.id }, todoGroupTone(g)]">
          <header class="todo-group-head">
            <div class="todo-group-title">
              <span>{{ g.label }}</span>
              <small>组长：{{ groupLeaderName(g) }} · 下一次 {{ getGroupNextDeadline(g) }}</small>
            </div>
            <div class="todo-group-actions">
              <span class="todo-open-count" :class="todoGroupTone(g)">{{ getGroupQuestLevel(g) }}</span>
              <button type="button" class="todo-assign-btn" @click="openTodoAssignment(g)">分配</button>
            </div>
          </header>
          <div class="todo-group-stats">
            <span>未讨伐 {{ getGroupTodoStats(g).open }}</span>
            <span>今日 {{ getGroupTodoStats(g).today }}</span>
            <span>逾期 {{ getGroupTodoStats(g).overdue }}</span>
            <i><b :style="{ width: `${getGroupTodoStats(g).progress}%` }"></b></i>
          </div>
          <div class="todo-list">
            <div
              v-for="todo in getGroupTodos(g).slice(0, 8)"
              :key="todo.id"
              class="todo-item"
              :class="[todo.status, todoAlarmLevel(todo)]">
              <button
                type="button"
                class="todo-check"
                :class="{ checked: todo.status === 'done' }"
                @click="handleTodoCheck(todo)"
                :title="todo.status === 'done' ? '标记未完成' : '标记完成'">
                {{ todo.status === 'done' ? '✓' : '' }}
              </button>
              <div class="todo-main">
                <div class="todo-title-line">
                  <span class="todo-rank" :class="todoAlarmLevel(todo)">RANK {{ todoQuestRank(todo) }}</span>
                  <span class="todo-title">{{ todo.title }}</span>
                  <span v-if="todoReminderLabel(todo)" class="todo-badge">{{ todoReminderLabel(todo) }}</span>
                </div>
                <p v-if="todo.detail" class="todo-detail">{{ todo.detail }}</p>
                <div class="todo-meta">
                  <span class="todo-deadline" :class="todoAlarmLevel(todo)">斩杀线 {{ todoCountdownLabel(todo) }}</span>
                  <span>{{ todoDueLabel(todo) }}</span>
                  <span v-if="todo.created_by">由 {{ todo.created_by }} 创建</span>
                </div>
                <div class="todo-charge" :class="todoAlarmLevel(todo)">
                  <div class="todo-pressure">
                    <div class="todo-pressure-top">
                      <span>{{ todoDeadlinePressureLabel(todo) }}</span>
                      <em>{{ todoDeadlinePressure(todo) }}%</em>
                    </div>
                    <i><b :style="{ width: `${todoDeadlinePressure(todo)}%` }"></b></i>
                  </div>
                  <button
                    v-if="todo.status !== 'done'"
                    type="button"
                    class="todo-plead"
                    @click.stop="openPleadDelay(todo)">
                    球球老大
                  </button>
                </div>
              </div>
              <div class="todo-actions">
                <button class="todo-edit" type="button" title="修改待办" @click="openTodoEdit(todo)">改</button>
                <button class="todo-delete" type="button" title="删除待办" @click="removeTodo(todo)">×</button>
              </div>
            </div>
            <div v-if="getGroupTodos(g).length === 0" class="todo-empty">
              <span>今天没有讨伐令</span>
              <small>可以短暂除草，但别被 DDL 发现。</small>
            </div>
          </div>
        </article>
      </div>
    </section>

    <div v-if="todoAssignGroup" class="modal-overlay" @click.self="closeTodoAssignment">
      <div class="modal todo-assign-modal">
        <div class="modal-hdr">
          <span>分配本周讨伐令</span>
          <button class="tbtn close-btn" @click="closeTodoAssignment">x</button>
        </div>
        <div class="modal-body">
          <div class="todo-modal-hero">
            <img :src="todoSignImage" alt="">
            <div>
              <strong>{{ todoAssignGroup.label }}</strong>
              <span>一周布置一次就够了，写清楚斩杀线，大家才知道先打哪只。</span>
            </div>
          </div>
          <div class="form-row">
            <label>任务内容</label>
            <textarea
              class="inp todo-title-input"
              v-model="todoDraftFor(todoAssignGroup).title"
              rows="3"
              placeholder="例如：周报复盘 周五 23:00 重要"
              @keydown.ctrl.enter.prevent="submitTodoAssignment"></textarea>
          </div>
          <div class="form-row">
            <label>执行要求</label>
            <textarea
              class="inp todo-detail-input"
              v-model="todoDraftFor(todoAssignGroup).detail"
              rows="3"
              placeholder="例如：先给出复盘结论，再补数据截图；周五下班前发群里确认。"></textarea>
          </div>
          <div class="form-row todo-modal-grid">
            <label>
              <span>日期</span>
              <input class="inp" type="date" v-model="todoDraftFor(todoAssignGroup).dueDate">
            </label>
            <label>
              <span>时间</span>
              <input class="inp" type="time" v-model="todoDraftFor(todoAssignGroup).dueTime">
            </label>
            <label class="todo-modal-important">
              <input type="checkbox" v-model="todoDraftFor(todoAssignGroup).important">
              <span>重要提醒</span>
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="closeTodoAssignment">先不派</button>
          <button class="btn btn-primary" @click="submitTodoAssignment">发布讨伐令</button>
        </div>
      </div>
    </div>

    <div v-if="todoEditForm.open" class="modal-overlay" @click.self="closeTodoEdit">
      <div class="modal todo-assign-modal">
        <div class="modal-hdr">
          <span>修改部门待办</span>
          <button class="tbtn close-btn" @click="closeTodoEdit">x</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <label>任务内容</label>
            <textarea class="inp todo-title-input" v-model="todoEditForm.title" rows="3"></textarea>
          </div>
          <div class="form-row">
            <label>执行要求</label>
            <textarea class="inp todo-detail-input" v-model="todoEditForm.detail" rows="3"></textarea>
          </div>
          <div class="form-row todo-modal-grid">
            <label>
              <span>日期</span>
              <input class="inp" type="date" v-model="todoEditForm.dueDate">
            </label>
            <label>
              <span>时间</span>
              <input class="inp" type="time" v-model="todoEditForm.dueTime">
            </label>
            <label class="todo-modal-important">
              <input type="checkbox" v-model="todoEditForm.important">
              <span>重要提醒</span>
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="closeTodoEdit">取消</button>
          <button class="btn btn-primary" @click="submitTodoEdit">保存修改</button>
        </div>
      </div>
    </div>

    <div v-if="pleadTodo" class="modal-overlay" @click.self="closePleadDelay">
      <div class="modal plead-modal">
        <div class="modal-hdr">
          <span>检讨书提交处</span>
          <button class="tbtn close-btn" @click="closePleadDelay">x</button>
        </div>
        <div class="modal-body">
          <div class="todo-modal-hero">
            <img :src="todoPanicImage" alt="">
            <div>
              <strong>球球老大！</strong>
              <span>这不是直接延期，是先递交一份像样的检讨。</span>
            </div>
          </div>
          <div class="plead-paper">
            <span>检讨对象：{{ pleadTodo.title }}</span>
            <textarea class="inp" v-model="pleadText" rows="4"></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="closePleadDelay">我再拼一下</button>
          <button class="btn btn-primary" @click="confirmPleadDelay">含泪申请顺延 1 天</button>
        </div>
      </div>
    </div>

    <div v-if="commitTodo" class="modal-overlay" @click.self="closeCommitTodo">
      <div class="modal commit-modal">
        <div class="modal-hdr">
          <span>完成承诺书</span>
          <button class="tbtn close-btn" @click="closeCommitTodo">x</button>
        </div>
        <div class="modal-body">
          <div class="todo-modal-hero">
            <img :src="todoSignImage" alt="">
            <div>
              <strong>确认讨伐完成</strong>
              <span>先签个承诺书，再把任务标记为完成。</span>
            </div>
          </div>
          <div class="plead-paper">
            <span>承诺对象：{{ commitTodo.title }}</span>
            <textarea class="inp" v-model="commitText" rows="4"></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="closeCommitTodo">我再检查一下</button>
          <button class="btn btn-primary" @click="confirmCommitTodo">我承诺，标记完成</button>
        </div>
      </div>
    </div>

    <div v-if="leaderDeadlineAlert" class="modal-overlay deadline-alert-overlay" @click.self="closeLeaderDeadlineAlert">
      <div class="modal deadline-alert-modal">
        <div class="modal-hdr">
          <span>{{ leaderDeadlineConfirming ? '尽快完成小约定' : '乌萨奇 DDL 小铃铛' }}</span>
          <button class="tbtn close-btn" @click="closeLeaderDeadlineAlert">x</button>
        </div>
        <div class="modal-body">
          <div class="todo-modal-hero">
            <img :src="leaderDeadlineConfirming ? todoSignImage : todoPanicImage" alt="">
            <div>
              <strong v-if="!leaderDeadlineConfirming">{{ leaderDeadlineAlert.group.label }} 有 {{ leaderDeadlineAlert.todos.length }} 个任务 DDL 小于 2 天</strong>
              <strong v-else>再盖一个“尽快完成”小印章</strong>
              <span v-if="!leaderDeadlineConfirming">呀哈，临期任务已经排队敲门啦，今天一起把它们盯紧！</span>
              <span v-else>不是马上消失术，是认真接住任务的小约定。</span>
            </div>
          </div>
          <div class="deadline-alert-list">
            <div v-for="todo in leaderDeadlineAlert.todos" :key="todo.id" class="deadline-alert-item" :class="todoAlarmLevel(todo)">
              <strong>{{ todo.title }}</strong>
              <span>{{ todoCountdownLabel(todo) }} · {{ todoDueLabel(todo) }}</span>
            </div>
          </div>
          <div v-if="leaderDeadlineConfirming" class="plead-paper">
            <span>今日保证：</span>
            <textarea class="inp" v-model="leaderDeadlinePromise" rows="4"></textarea>
          </div>
        </div>
        <div v-if="!leaderDeadlineConfirming" class="modal-foot">
          <button class="btn btn-primary" @click="beginLeaderDeadlineConfirmation">已知晓，去确认</button>
        </div>
        <div v-else class="modal-foot">
          <button class="btn btn-ghost" @click="leaderDeadlineConfirming = false">我再看一眼</button>
          <button class="btn btn-primary" @click="confirmLeaderDeadlinePromise">我保证，尽快完成</button>
        </div>
      </div>
    </div>

    <!-- ===== 按人视图 ===== -->
    <div v-if="activeGroup !== DEPARTMENT_TODO_TAB && viewMode === 'person'" class="board" ref="boardRef"
      @mousedown="startPan"
      @mousemove="doPan"
      @mouseup="endPan"
      @mouseleave="endPan"
      @click="closeTransferMenu"
      :style="{ cursor: isPanning ? 'grabbing' : 'grab' }">
      <div v-for="person in currentGroupMembers" :key="person" class="board-col">
        <div class="col-hdr">
          <span class="col-name">{{ person }}</span>
          <span class="col-count">{{ personScheduleItems(person).length }}</span>
        </div>
        <div class="card-stack"
          :class="{ 'paste-target': activePasteTarget?.person === person }"
          @mouseenter="setPasteTarget(person)"
          @click.self="setPasteTarget(person)"
          @dragover.prevent
          @drop="handleScheduleColumnDrop($event, person)">
          <div v-for="item in personScheduleItems(person)" :key="item.id"
            class="task-card" :class="[item.status, { selected: activeTask?.id === (item.task?.id || item.id), 'todo-mapped-card': isMappedTodoItem(item) }]" draggable="true"
            tabindex="0"
            @click.stop="selectScheduleItem(item)"
            @contextmenu.prevent.stop="openScheduleTransferMenu($event, item)"
            @dblclick.stop="editScheduleItem(item)"
            @focus="focusScheduleItem(item)"
            @dragstart="handleScheduleDragStart($event, item)"
            @dragover.prevent
            @drop.stop="handleScheduleTaskDrop($event, person, item)"
            @dragend="handleDragEnd">
            <div class="task-title">
              <span class="task-account">{{ item.account || '账号待定' }}</span>
              <span class="task-type" :class="typeBadgeClass(item.type)">{{ TYPE_TAG[item.type] || item.type }}</span>
              <span v-if="item.stack_label" class="task-stack-badge">{{ item.stack_label }}</span>
            </div>
            <div class="task-content">{{ item.content || '待定' }}</div>
            <div v-if="item.latest_activity_text" class="task-activity-latest">{{ item.latest_activity_text }}</div>
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
                <button class="tbtn" @click.stop="editScheduleItem(item)">改</button>
                <button class="tbtn" @click.stop="removeScheduleItem(item)">删</button>
              </span>
              <button
                class="stage-advance-btn"
                :class="item.workflow_stage_tone"
                :style="{ '--stage-angle': `${item.workflow_stage_progress_angle}deg` }"
                @click.stop="advanceScheduleItem(item, $event)"
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

    <div
      v-if="transferMenu.open"
      class="transfer-menu"
      :style="{ left: `${transferMenu.x}px`, top: `${transferMenu.y}px` }"
      @click.stop>
      <div class="transfer-menu-title">转交给</div>
      <button
        v-for="m in currentGroupMembers"
        :key="m"
        type="button"
        :disabled="m === (transferMenu.item?.view_person || transferMenu.item?.person)"
        @click="transferTask(transferMenu.item, m)">
        {{ m }}
      </button>
    </div>

    <!-- ===== 按周视图 ===== -->
    <div v-if="activeGroup !== DEPARTMENT_TODO_TAB && viewMode === 'week'" class="week-board-wrap">
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
        <div v-for="acc in currentGroupWeekAccounts" :key="acc" class="week-row" :class="{ 'todo-week-row': acc === '部门待办' }">
          <div class="week-acc-col">
            <span class="week-acc-name">{{ acc }}</span>
          </div>
          <div v-for="(day, i) in weekDays" :key="i" class="week-cell" :class="{ today: isToday(day) }"
            @dragover.prevent
            @drop="handleWeekDrop($event, acc, day)">
            <div v-for="item in getItemsForCell(acc, day)" :key="item._week_key || item.id" class="week-card"
              :class="[item.status, { 'todo-mapped-card': isMappedTodoItem(item) }]"
              :draggable="!isMappedTodoItem(item)"
              tabindex="0"
              @dragstart="handleScheduleDragStart($event, item)"
              @dragend="handleDragEnd"
              @dragover.prevent
              @drop.stop="handleWeekScheduleCardDrop($event, item)"
              @click="editWeekScheduleItem(item)"
              :title="[item.person, item.account, item.content].filter(Boolean).join(' | ')">
              <span class="week-card-person" :class="{ merged: item._parallel_items }">{{ weekPeopleLabel(item) }}</span>
              <span class="week-card-type" :class="typeBadgeClass(item.type)">{{ TYPE_TAG[item.type] || item.type }}</span>
              <span v-if="item.stack_label" class="week-card-stack">{{ item.stack_label }}</span>
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
            <label>合作模式</label>
            <label class="cooperation-toggle">
              <input type="checkbox" v-model="form.cooperation" @change="handleCooperationToggle">
              <span>多人协作，同步显示到合作人列</span>
            </label>
          </div>
          <div v-if="form.cooperation" class="form-row">
            <label>合作人</label>
            <div class="participant-picker">
              <button
                v-for="m in currentGroupMembers"
                :key="m"
                type="button"
                class="participant-chip"
                :class="{ active: isParticipantSelected(m), primary: form.person === m }"
                @click="toggleParticipant(m)">
                {{ m }}
              </button>
            </div>
            <div v-if="form.participants?.length > 1" class="participant-summary">
              <span
                v-for="row in form.participants"
                :key="row.person"
                class="participant-pill"
                :title="participantRolesLabel(row)">
                {{ row.person }}<small v-if="form.person === row.person">主</small>
              </span>
            </div>
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
          <div v-if="isStackableScheduleType(form.type)" class="form-row">
            <label>{{ form.type === '素材代做' ? '素材条数' : '星广条数' }}</label>
            <input class="inp stack-count-input" type="number" min="1" max="99" step="1" v-model.number="form.stack_count" placeholder="例如 5">
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
          <div class="form-row">
            <label>推进记录</label>
            <div v-if="form.activity_log?.length" class="activity-log-list">
              <div v-for="row in form.activity_log.slice().reverse()" :key="row.id" class="activity-log-item">
                <span>{{ formatActivityLogTime(row.at) }}</span>
                <strong>{{ activityLogLine(row) }}</strong>
              </div>
            </div>
            <div v-else class="activity-log-empty">暂无推进记录</div>
          </div>
        </div>
        <div class="modal-foot">
          <button v-if="editing" class="btn btn-danger modal-delete-btn" type="button" @click="deleteEditingItem">删除</button>
          <button v-if="editing && form.cooperation && form.participants?.length > 1" class="btn btn-ghost split-task-btn" type="button" @click="splitEditingItem">分离合作任务</button>
          <button class="btn btn-ghost" @click="formShow = false">取消</button>
          <button class="btn btn-primary" @click="saveItem">保存</button>
        </div>
      </div>
    </div>

    <div v-if="showScheduleHistory" class="modal-overlay" @click.self="showScheduleHistory = false">
      <div class="modal schedule-history-modal">
        <div class="modal-hdr">
          <span>历史记录</span>
          <button class="tbtn close-btn" @click="showScheduleHistory = false">x</button>
        </div>
        <div class="modal-body">
          <div v-if="scheduleHistoryRows.length" class="schedule-history-list">
            <div v-for="row in scheduleHistoryRows" :key="row.id" class="schedule-history-item">
              <div class="schedule-history-time">{{ formatActivityLogTime(row.at) }}</div>
              <div class="schedule-history-main">
                <strong>{{ activityLogLine(row) }}</strong>
                <span>{{ [row.person, row.account, row.type, row.content].filter(Boolean).join(' / ') }}</span>
              </div>
            </div>
          </div>
          <div v-else class="activity-log-empty">暂无推进记录</div>
        </div>
      </div>
    </div>

    <div v-if="showTodoHistory" class="modal-overlay" @click.self="showTodoHistory = false">
      <div class="modal schedule-history-modal todo-history-modal">
        <div class="modal-hdr">
          <span>已完成待办历史</span>
          <button class="tbtn close-btn" @click="showTodoHistory = false">x</button>
        </div>
        <div class="modal-body">
          <div v-if="scheduleTodoHistoryLoading" class="activity-log-empty">正在读取历史记录...</div>
          <div v-else-if="scheduleTodoHistory.length" class="schedule-history-list">
            <div v-for="todo in scheduleTodoHistory" :key="todo.id" class="schedule-history-item todo-history-item">
              <div class="schedule-history-time">
                <span>{{ todo.archive_week || '历史' }}</span>
                <small>{{ formatTodoHistoryTime(todo.archived_at) }}</small>
              </div>
              <div class="schedule-history-main">
                <strong>{{ todo.title }}</strong>
                <span>{{ [todo.group_name, todo.detail, todoDueLabel(todo), todo.created_by ? `由 ${todo.created_by} 创建` : ''].filter(Boolean).join(' / ') }}</span>
              </div>
            </div>
          </div>
          <div v-else class="activity-log-empty">暂无已完成待办历史</div>
        </div>
      </div>
    </div>

    <!-- Batch Import Modal -->
    <div v-if="showAiImport" class="modal-overlay" @click.self="showAiImport = false">
      <div class="modal ai-import-modal">
        <div class="modal-hdr">
          <span>批量创建任务</span>
          <button class="tbtn close-btn" @click="showAiImport = false">x</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <label>账号</label>
            <select class="inp" v-model="batchForm.account">
              <option v-for="acc in currentGroupAccounts" :key="acc" :value="acc">{{ acc }}</option>
            </select>
          </div>
          <div class="form-row">
            <label>负责人</label>
            <select class="inp" v-model="batchForm.person">
              <option v-for="m in currentGroupMembers" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="form-row">
            <label>类型</label>
            <select class="inp" v-model="batchForm.type">
              <option value="日常">日常</option>
              <option value="商单">商单</option>
              <option value="星广联投">星广联投</option>
              <option value="CPM">CPM</option>
              <option value="素材代做">素材代做</option>
            </select>
          </div>
          <div class="form-row">
            <label>内容</label>
            <input class="inp" v-model.trim="batchForm.content" placeholder="例如：选题待定 / 项目名 / 视频标题">
          </div>
          <div class="form-row">
            <label>创建条数</label>
            <div class="batch-slider-row">
              <input
                class="batch-count-slider"
                type="range"
                min="1"
                :max="batchCountMax"
                step="1"
                v-model.number="batchForm.count">
              <strong>{{ batchForm.count }} 条</strong>
            </div>
            <div class="batch-range-hint">{{ batchPlanHint }}</div>
          </div>
          <div v-if="batchIsStackable" class="form-row">
            <label>{{ batchForm.type === '素材代做' ? '单卡素材数' : '单条堆叠' }}</label>
            <div class="batch-slider-row">
              <input
                class="batch-count-slider"
                type="range"
                min="1"
                max="20"
                step="1"
                v-model.number="batchForm.stack_count">
              <strong>x{{ batchForm.stack_count }}</strong>
            </div>
            <div class="batch-range-hint">每张{{ batchForm.type === '素材代做' ? '素材代做' : '星广' }}任务卡代表 {{ batchForm.stack_count }} 条，不影响创建任务卡数量</div>
          </div>
          <div class="form-row">
            <label>排布日期</label>
            <div class="batch-week-picker">
              <div class="batch-week-range-head">
                <strong>{{ batchWeekRangeLabel }}</strong>
                <span>{{ formatAiDateLabel(batchForm.startDate) }} - {{ formatAiDateLabel(batchForm.endDate) }}</span>
              </div>
              <div class="batch-week-range" :style="batchWeekRangeStyle">
                <div class="batch-week-rail" aria-hidden="true">
                  <i></i>
                </div>
                <input
                  class="batch-week-slider"
                  type="range"
                  min="0"
                  max="6"
                  step="1"
                  v-model.number="batchWeekStartIndex">
                <input
                  class="batch-week-slider batch-week-slider-end"
                  type="range"
                  min="0"
                  max="6"
                  step="1"
                  v-model.number="batchWeekEndIndex">
              </div>
              <div class="batch-week-labels">
                <span
                  v-for="day in batchWeekDays"
                  :key="day.date"
                  :class="{ active: isBatchDateInRange(day.date), today: day.isToday }">
                  <b>{{ day.week }}</b>
                  <em>{{ day.label }}</em>
                </span>
              </div>
            </div>
          </div>
          <div class="ai-hint">默认从今天排到本周末；数量超过天数时会均匀分摊到这些天。</div>

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
                <span>堆叠</span>
                <span>内容</span>
              </div>
              <div v-for="(item, idx) in aiFinalPreview" :key="idx" class="ai-final-row">
                <span class="ai-final-index">{{ idx + 1 }}</span>
                <span class="ai-final-date">{{ formatAiDateLabel(item.date) }}</span>
                <span class="ai-final-person">{{ item.person }}</span>
                <span>{{ item.account || '素材' }}</span>
                <span class="ai-final-type">{{ item.type || '日常' }}</span>
                <span>{{ item.stack_count > 1 ? `x${item.stack_count}` : '-' }}</span>
                <span class="ai-final-content">{{ item.content }}</span>
              </div>
            </div>
            <div class="ai-split-options" style="margin-top:12px;">
              <button class="ai-split-btn" @click="generateBatchPreview">重新生成预览</button>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showAiImport = false">取消</button>
          <button v-if="aiFinalPreview.length === 0" class="btn btn-primary" @click="generateBatchPreview">生成预览</button>
          <button v-else class="btn btn-primary ai-confirm-btn" @click="confirmAiImport">确认导入 {{ aiFinalPreview.length }} 条</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { TYPE_TAG } from './schedule/constants'
import { useScheduleBoard } from './schedule/useScheduleBoard'
import { saveScheduleTodo } from '../api/schedule'
import { useToast } from '../composables/useToast'
import todoPanicImage from '../assets/usagi-pet-states/panic.png'
import todoSignImage from '../assets/usagi-pet-states/sign.png'

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

function openTodoAssignment(group) {
  todoAssignGroup.value = group
  const draft = todoDraftFor(group)
  draft.dueDate = draft.dueDate || defaultBatchDate()
  draft.dueTime = draft.dueTime || '23:00'
}

function closeTodoAssignment() {
  todoAssignGroup.value = null
}

async function submitTodoAssignment() {
  if (!todoAssignGroup.value) return
  await addGroupTodo(todoAssignGroup.value)
  if (!todoDraftFor(todoAssignGroup.value).title) closeTodoAssignment()
}

function splitTodoDueAt(value) {
  const text = String(value || '').trim()
  if (!text) return { date: '', time: '' }
  const [date = '', time = ''] = text.split('T')
  return {
    date: date.slice(0, 10),
    time: time.slice(0, 5)
  }
}

function closeTodoEdit() {
  Object.assign(todoEditForm, {
    open: false,
    id: null,
    groupName: '',
    title: '',
    detail: '',
    dueDate: '',
    dueTime: '',
    important: false,
    status: 'open',
    progress: 0,
    assignee: ''
  })
}

function openTodoEdit(todo) {
  const due = splitTodoDueAt(todo?.due_at)
  Object.assign(todoEditForm, {
    open: true,
    id: todo?.id || null,
    groupName: todo?.group_name || '',
    title: todo?.title || '',
    detail: todo?.detail || '',
    dueDate: due.date,
    dueTime: due.time,
    important: Boolean(Number(todo?.important || 0)),
    status: todo?.status || 'open',
    progress: Number(todo?.progress || 0) || 0,
    assignee: String(todo?.assignee || '').trim()
  })
}

async function submitTodoEdit() {
  const title = String(todoEditForm.title || '').trim()
  if (!todoEditForm.id || !title) {
    showToast('先把待办内容填上', 'error')
    return
  }
  try {
    await saveScheduleTodo({
      id: todoEditForm.id,
      group_name: todoEditForm.groupName,
      title,
      detail: String(todoEditForm.detail || '').trim(),
      due_at: todoEditForm.dueDate ? `${todoEditForm.dueDate}T${todoEditForm.dueTime || '23:00'}` : '',
      important: todoEditForm.important ? 1 : 0,
      progress: todoEditForm.progress,
      status: todoEditForm.status,
      assignee: todoEditForm.assignee
    })
    await loadScheduleTodosData()
    closeTodoEdit()
    showToast('待办已修改', 'success')
  } catch (err) {
    showToast('待办修改失败: ' + (err?.message || err), 'error')
  }
}

function openPleadDelay(todo) {
  pleadTodo.value = todo
  pleadText.value = `我深刻检讨：${todo?.title || '这个任务'} 没有按时讨伐成功。\n原因我先不狡辩，接下来我会把斩杀线守住。\n球球老大，给我顺延一天。`
}

function closePleadDelay() {
  pleadTodo.value = null
  pleadText.value = ''
}

async function confirmPleadDelay() {
  if (!pleadTodo.value) return
  await pleadDelayTodo(pleadTodo.value)
  closePleadDelay()
}

function openCommitTodo(todo) {
  commitTodo.value = todo
  commitText.value = `我承诺：${todo?.title || '这项任务'} 已经认真完成，没有敷衍、没有糊弄、没有把坑留给下一位同事。\n我确认可以标记为完成。`
}

function closeCommitTodo() {
  commitTodo.value = null
  commitText.value = ''
}

function handleTodoCheck(todo) {
  if (todo?.status === 'done') {
    toggleTodoDone(todo)
    return
  }
  openCommitTodo(todo)
}

function isMappedTodoItem(item) {
  return Boolean(item?._todo_mapped)
}

function selectScheduleItem(item) {
  if (isMappedTodoItem(item)) {
    openTodoEdit(item.todo)
    return
  }
  setActiveTask(item)
}

function focusScheduleItem(item) {
  if (isMappedTodoItem(item)) return
  setActiveTask(item)
}

function editScheduleItem(item) {
  if (isMappedTodoItem(item)) {
    openTodoEdit(item.todo)
    return
  }
  editItem(item)
}

function removeScheduleItem(item) {
  if (isMappedTodoItem(item)) {
    removeTodo(item.todo)
    return
  }
  delItem(item.id)
}

function advanceScheduleItem(item, event) {
  if (isMappedTodoItem(item)) {
    handleTodoCheck(item.todo)
    return
  }
  toggleDone(item, event)
}

function handleScheduleDragStart(event, item) {
  if (isMappedTodoItem(item)) {
    dragItem.value = { task: item }
    return
  }
  handleDragStart(event, item)
}

async function handleScheduleColumnDrop(event, person) {
  const mapped = dragItem.value?.task
  if (isMappedTodoItem(mapped)) {
    event.preventDefault()
    await assignTodoToPerson(mapped.todo, person)
    dragItem.value = null
    return
  }
  handleDrop(event, person)
}

function openScheduleTransferMenu(event, item) {
  if (isMappedTodoItem(item)) return
  openTransferMenu(event, item)
}

function handleScheduleTaskDrop(event, person, item) {
  const mapped = dragItem.value?.task
  if (isMappedTodoItem(mapped)) {
    event.preventDefault()
    assignTodoToPerson(mapped.todo, person)
    dragItem.value = null
    return
  }
  if (isMappedTodoItem(item)) return
  handleTaskDrop(event, person, item)
}

function editWeekScheduleItem(item) {
  if (isMappedTodoItem(item)) {
    openTodoEdit(item.todo)
    return
  }
  editWeekItem(item)
}

function handleWeekScheduleCardDrop(event, item) {
  if (isMappedTodoItem(item)) return
  handleWeekCardDrop(event, item)
}

async function confirmCommitTodo() {
  if (!commitTodo.value) return
  await toggleTodoDone(commitTodo.value)
  closeCommitTodo()
}

function currentUserName() {
  const user = currentUser.value || {}
  return String(user.real_name || user.display_name || user.username || '').trim()
}

function parseTodoDueAt(todo) {
  const date = new Date(String(todo?.due_at || '').trim())
  return Number.isNaN(date.getTime()) ? null : date
}

function isTodoInsideTwoDays(todo) {
  if (!todo || todo.status === 'done') return false
  const dueAt = parseTodoDueAt(todo)
  if (!dueAt) return false
  return dueAt.getTime() - Date.now() <= 2 * 24 * 60 * 60 * 1000
}

function closeLeaderDeadlineAlert() {
  leaderDeadlineAlert.value = null
  leaderDeadlineConfirming.value = false
  leaderDeadlinePromise.value = ''
}

function leaderDeadlineDayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function leaderDeadlineStorageKey(name, group) {
  return `usagi_schedule_leader_deadline_alert:${name}:${group.id}`
}

function beginLeaderDeadlineConfirmation() {
  if (!leaderDeadlineAlert.value) return
  leaderDeadlineConfirming.value = true
  leaderDeadlinePromise.value = '我保证：已经知晓以上临期任务，会马上确认负责人和当前进度，尽快推动完成。\n如果遇到卡点，我会及时同步，不让任务偷偷越过 DDL。'
}

function confirmLeaderDeadlinePromise() {
  if (!String(leaderDeadlinePromise.value || '').trim()) {
    showToast('先留下今天的尽快完成小约定哦', 'error')
    return
  }
  closeLeaderDeadlineAlert()
  showToast('呀哈，今日保证已盖章！一起尽快把任务收好尾', 'success')
}

function maybeShowLeaderDeadlineAlert() {
  const name = currentUserName()
  if (!name) return
  const group = GROUPS.find(item => item.leader === name)
  if (!group) return
  const todos = scheduleTodos.value
    .filter(todo => String(todo.group_name || '') === group.label && isTodoInsideTwoDays(todo))
    .sort((a, b) => (parseTodoDueAt(a)?.getTime() || 0) - (parseTodoDueAt(b)?.getTime() || 0))
  if (!todos.length) return
  const dayKey = leaderDeadlineDayKey()
  const storageKey = leaderDeadlineStorageKey(name, group)
  try {
    if (localStorage.getItem(storageKey) === dayKey) return
  } catch {}
  const alertKey = `${name}:${group.id}:${dayKey}`
  if (lastLeaderDeadlineAlertKey.value === alertKey) return
  lastLeaderDeadlineAlertKey.value = alertKey
  try {
    localStorage.setItem(storageKey, dayKey)
  } catch {}
  leaderDeadlineConfirming.value = false
  leaderDeadlinePromise.value = ''
  leaderDeadlineAlert.value = { group, todos: todos.slice(0, 6) }
}

// AI Import
const showAiImport = ref(false)
const showScheduleHistory = ref(false)
const showTodoHistory = ref(false)
const aiImportText = ref('')
const aiImporting = ref(false)
const aiParsedPreview = ref([])  // AI解析后的原始任务
const aiFinalPreview = ref([])    // 拆分后的最终任务
const aiSelectedSplit = ref(null) // 用户选择的拆分方式
const aiCustomSplitNum = ref(5)   // 用户自定义拆分数量
const todoAssignGroup = ref(null)
const todoEditForm = reactive({
  open: false,
  id: null,
  groupName: '',
  title: '',
  detail: '',
  dueDate: '',
  dueTime: '',
  important: false,
  status: 'open',
  progress: 0,
  assignee: ''
})
const pleadTodo = ref(null)
const pleadText = ref('')
const commitTodo = ref(null)
const commitText = ref('')
const leaderDeadlineAlert = ref(null)
const leaderDeadlineConfirming = ref(false)
const leaderDeadlinePromise = ref('')
const lastLeaderDeadlineAlertKey = ref('')
const transferMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  item: null
})

const batchForm = reactive({
  account: '',
  person: '',
  type: '日常',
  content: '选题待定',
  count: 1,
  stack_count: 1,
  startDate: '',
  endDate: ''
})

const batchDateRangeDays = computed(() => buildDateRange(batchForm.startDate, batchForm.endDate).length || 1)
const batchIsSingleDate = computed(() => normalizeDateValue(batchForm.startDate) === normalizeDateValue(batchForm.endDate))
function isStackableScheduleType(type) {
  const value = String(type || '')
  return value.includes('星广') || value === '素材代做'
}

const batchIsStackable = computed(() => isStackableScheduleType(batchForm.type))
const batchCountMax = computed(() => 9)
const batchPlanHint = computed(() => {
  if (batchIsSingleDate.value) return `${formatAiDateLabel(batchForm.startDate)} 单日创建 ${batchForm.count} 条`
  return `区间 ${batchDateRangeDays.value} 天，当前创建 ${batchForm.count} 条，系统会自然排布`
})
const batchWeekDays = computed(() => currentWeekDates().map((date, index) => ({
  date,
  week: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index],
  label: formatMonthDay(date),
  isToday: date === defaultBatchDate()
})))
const batchWeekStartIndex = computed({
  get() {
    return batchWeekDateIndex(batchForm.startDate)
  },
  set(value) {
    setBatchWeekRange(value, Math.max(Number(value) || 0, batchWeekEndIndex.value))
  }
})
const batchWeekEndIndex = computed({
  get() {
    return batchWeekDateIndex(batchForm.endDate)
  },
  set(value) {
    setBatchWeekRange(Math.min(batchWeekStartIndex.value, Number(value) || 0), value)
  }
})
const batchWeekRangeStyle = computed(() => {
  const start = batchWeekStartIndex.value
  const end = batchWeekEndIndex.value
  return {
    '--batch-week-start': `${(Math.min(start, end) / 6) * 100}%`,
    '--batch-week-end': `${(Math.max(start, end) / 6) * 100}%`
  }
})
const batchWeekRangeLabel = computed(() => {
  if (batchIsSingleDate.value) return batchWeekDays.value[batchWeekStartIndex.value]?.week || '单日'
  const start = batchWeekDays.value[batchWeekStartIndex.value]?.week || '周内'
  const end = batchWeekDays.value[batchWeekEndIndex.value]?.week || '周内'
  return `${start} 到 ${end}`
})

function toDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function defaultBatchDate() {
  return toDateValue(new Date())
}

function currentWeekDates() {
  const today = new Date()
  const day = today.getDay() || 7
  const monday = new Date(today)
  monday.setDate(today.getDate() - day + 1)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return toDateValue(date)
  })
}

function currentWeekDefaultRange() {
  const week = currentWeekDates()
  const today = defaultBatchDate()
  const todayIndex = week.indexOf(today)
  const startIndex = todayIndex >= 0 ? todayIndex : 0
  return {
    start: week[startIndex] || today,
    end: week[6] || today
  }
}

function batchWeekDateIndex(dateText) {
  const week = currentWeekDates()
  const index = week.indexOf(normalizeDateValue(dateText))
  if (index >= 0) return index
  const fallback = week.indexOf(defaultBatchDate())
  return fallback >= 0 ? fallback : 0
}

function formatMonthDay(dateText) {
  const date = parseBatchDate(dateText)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function normalizeDateValue(value) {
  return String(value || '').slice(0, 10) || defaultBatchDate()
}

function parseBatchDate(value) {
  const normalized = normalizeDateValue(value)
  const date = new Date(`${normalized}T00:00:00`)
  return Number.isNaN(date.getTime()) ? new Date(`${defaultBatchDate()}T00:00:00`) : date
}

function addDays(dateText, days) {
  const date = dateText ? new Date(`${dateText}T00:00:00`) : new Date()
  date.setDate(date.getDate() + Number(days || 0))
  return toDateValue(date)
}

function buildDateRange(startValue, endValue) {
  const start = parseBatchDate(startValue)
  const end = parseBatchDate(endValue)
  const left = start <= end ? start : end
  const right = start <= end ? end : start
  const result = []
  const cursor = new Date(left)
  while (cursor <= right && result.length < 100) {
    result.push(toDateValue(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return result.length ? result : [defaultBatchDate()]
}

function buildBatchDates(count) {
  const dates = buildDateRange(batchForm.startDate, batchForm.endDate)
  if (dates.length <= 1) return Array.from({ length: count }, () => dates[0] || defaultBatchDate())
  if (count === 1) return [dates[0]]
  return Array.from({ length: count }, (_, index) => {
    const dateIndex = Math.floor(index * dates.length / count)
    return dates[dateIndex]
  })
}

function openBatchImport() {
  batchForm.account = batchForm.account || currentGroupAccounts.value[0] || '素材'
  batchForm.person = batchForm.person || currentGroupMembers.value[0] || ''
  batchForm.type = batchForm.type || '日常'
  batchForm.content = batchForm.content || '选题待定'
  const defaultRange = currentWeekDefaultRange()
  batchForm.startDate = defaultRange.start
  batchForm.endDate = defaultRange.end
  batchForm.count = clampBatchCount(Number(batchForm.count) || 1)
  batchForm.stack_count = clampStackCount(batchForm.stack_count)
  aiParsedPreview.value = []
  aiFinalPreview.value = []
  aiSelectedSplit.value = null
  showAiImport.value = true
}

function clampBatchCount(value) {
  return Math.max(1, Math.min(batchCountMax.value, Number(value) || 1))
}

function clampStackCount(value) {
  return Math.max(1, Math.min(99, Math.round(Number(value) || 1)))
}

function setBatchRange(startDate, endDate) {
  batchForm.startDate = normalizeDateValue(startDate)
  batchForm.endDate = normalizeDateValue(endDate || startDate)
  batchForm.count = clampBatchCount(batchForm.count)
  aiFinalPreview.value = []
}

function setBatchWeekRange(startIndex, endIndex) {
  const week = currentWeekDates()
  const start = Math.max(0, Math.min(6, Number(startIndex) || 0))
  const end = Math.max(0, Math.min(6, Number(endIndex) || 0))
  setBatchRange(week[Math.min(start, end)], week[Math.max(start, end)])
}

function isBatchDateInRange(date) {
  const value = normalizeDateValue(date)
  const start = normalizeDateValue(batchForm.startDate)
  const end = normalizeDateValue(batchForm.endDate)
  return value >= start && value <= end
}

function generateBatchPreview() {
  const count = clampBatchCount(batchForm.count)
  batchForm.count = count
  batchForm.stack_count = clampStackCount(batchForm.stack_count)
  const dates = buildBatchDates(count)
  if (!batchForm.person) {
    showToast('请选择负责人', 'error')
    return
  }
  const type = batchForm.type || '日常'
  const isSucai = type === '素材代做'
  if (!isSucai && !batchForm.account) {
    showToast('请选择账号', 'error')
    return
  }

  const content = String(batchForm.content || '').trim() || '选题待定'
  const stackCount = batchIsStackable.value ? batchForm.stack_count : 1
  aiFinalPreview.value = Array.from({ length: count }, (_, index) => ({
    account: isSucai ? '素材' : batchForm.account,
    person: batchForm.person,
    type,
    content,
    count: 1,
    stack_count: stackCount,
    date: dates[index] || dates[0] || defaultBatchDate()
  }))
}

function parseAiImport() {
  generateBatchPreview()
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
    麦小雯: ['麦小雯', '小雯'],
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
    form.stack_count = isStackableScheduleType(type) ? clampStackCount(task.stack_count || task.itemCount || task.quantity) : 1
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
  DEPARTMENT_TODO_TAB,
  GROUPS,
  MEMBERS,
  activeGroup,
  activePasteTarget,
  activeTask,
  addGroupTodo,
  allItems,
  assignTodoToPerson,
  boardRef,
  canViewAllGroups,
  canDeleteTasks,
  clearScheduleDoc,
  currentGroupAccounts,
  currentGroupMembers,
  currentGroupWeekAccounts,
  copyItem,
  currentUser,
  deleteEditingItem,
  delItem,
  departmentTodoStats,
  doPan,
  dragItem,
  editItem,
  editWeekItem,
  editing,
  endPan,
  form,
  formShow,
  fmtMd,
  getGroupNextDeadline,
  getGroupOpenTodoCount,
  getGroupQuestLevel,
  getGroupTodos,
  getGroupTodoStats,
  getItemsForCell,
  groupLeaderName,
  handleDragStart,
  handleDragEnd,
  handleDrop,
  handleTaskDrop,
  handleScheduleDocDrop,
  handleScheduleDocFile,
  handleScheduleDocPaste,
  handleWeekCardDrop,
  handleWeekDrop,
  hasScheduleDoc,
  moveDraggedItemToAdjacentWeek,
  isPanning,
  isSameDay,
  isToday,
  itemsByPerson,
  loadScheduleTodoHistoryData,
  loadScheduleTodosData,
  openAdd,
  openScheduleDoc,
  personScheduleItems,
  pleadDelayTodo,
  saveItem,
  scheduleTodoHistory,
  scheduleTodoHistoryLoading,
  scheduleTodos,
  setActiveTask,
  setPasteTarget,
  setScheduleDocLink,
  setWeekPasteTarget,
  splitEditingItem,
  formatPersonTaskDate,
  removeTodo,
  startPan,
  todoAlarmLevel,
  todoCountdownLabel,
  todoDeadlinePressure,
  todoDeadlinePressureLabel,
  todoDraftFor,
  todoDueLabel,
  todoGroupTone,
  todoQuestRank,
  todoReminderLabel,
  toggleDone,
  toggleTodoDone,
  transferTaskToPerson,
  undo,
  visibleTodoGroups,
  viewMode,
  weekCardTitle,
  weekDays,
  weekOffset,
  weekRangeLabel,
  workflowStageStepLabel,
  workflowStageTone
} = useScheduleBoard(showToast)

const scheduleHistoryRows = computed(() => {
  return (allItems.value || [])
    .flatMap(item => normalizeActivityRows(item).map(row => ({
      ...row,
      person: item.person || '',
      account: item.account || '',
      type: item.type || '',
      content: item.content || ''
    })))
    .filter(row => row.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 80)
})

watch(
  () => [
    currentUser.value?.real_name,
    currentUser.value?.display_name,
    currentUser.value?.username,
    scheduleTodos.value.map(todo => `${todo.id}:${todo.status}:${todo.due_at}`).join('|')
  ],
  () => {
    maybeShowLeaderDeadlineAlert()
  },
  { immediate: true }
)

watch(
  () => [batchForm.startDate, batchForm.endDate],
  () => {
    batchForm.startDate = normalizeDateValue(batchForm.startDate)
    batchForm.endDate = normalizeDateValue(batchForm.endDate || batchForm.startDate)
    batchForm.count = clampBatchCount(batchForm.count)
    aiFinalPreview.value = []
  }
)

watch(
  () => batchForm.count,
  value => {
    const next = clampBatchCount(value)
    if (next !== value) batchForm.count = next
    aiFinalPreview.value = []
  }
)

watch(
  () => [batchForm.account, batchForm.person, batchForm.type, batchForm.content],
  () => {
    if (!batchIsStackable.value) batchForm.stack_count = 1
    aiFinalPreview.value = []
  }
)

watch(
  () => batchForm.stack_count,
  value => {
    const next = clampStackCount(value)
    if (next !== value) batchForm.stack_count = next
    aiFinalPreview.value = []
  }
)

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

function handleCooperationToggle() {
  if (form.cooperation) {
    syncFormPrimaryParticipant()
    return
  }
  form.participants = form.person
    ? [{ person: form.person, roles: defaultParticipantRoles() }]
    : []
}

function syncFormPrimaryParticipant() {
  if (!Array.isArray(form.participants)) form.participants = []
  if (!form.person) return
  if (!form.cooperation) {
    form.participants = [{ person: form.person, roles: defaultParticipantRoles() }]
    return
  }
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

function openTransferMenu(event, item) {
  setActiveTask(item)
  const width = 112
  const height = Math.min(230, 34 + currentGroupMembers.value.length * 31)
  const x = Math.min(event.clientX, window.innerWidth - width - 8)
  const y = Math.min(event.clientY, window.innerHeight - height - 8)
  transferMenu.open = true
  transferMenu.x = Math.max(8, x)
  transferMenu.y = Math.max(8, y)
  transferMenu.item = item
}

function closeTransferMenu() {
  transferMenu.open = false
  transferMenu.item = null
}

function transferTask(item, person) {
  transferTaskToPerson(item, person)
  closeTransferMenu()
}

function formatActivityLogTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatTodoHistoryTime(value) {
  const raw = Number(value || 0)
  const date = new Date(raw > 10000000000 ? raw : raw * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function openTodoHistory() {
  showTodoHistory.value = true
  await loadScheduleTodoHistoryData()
}

function normalizeActivityRows(item) {
  const source = item?.activity_log || item?.activity_json || []
  if (Array.isArray(source)) return source.filter(Boolean)
  if (typeof source !== 'string' || !source.trim()) return []
  try {
    const parsed = JSON.parse(source)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch {
    return []
  }
}

function activityLogLine(row) {
  if (row?.text) return row.text
  if (row?.action === 'stage_advance') {
    return `${row.actor || '有人'} 推进到${row.to || '下一步'}`
  }
  return row?.to ? `推进到${row.to}` : '推进记录'
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

.schedule-module-todo {
  height: auto;
  min-height: 100%;
  overflow: visible;
  padding-bottom: 110px;
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

.undo-btn,
.history-btn {
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
.undo-btn:hover,
.history-btn:hover {
  background: var(--primary, #7b2fff);
  border-color: var(--primary, #7b2fff);
  transform: scale(1.05);
}
.undo-btn:active,
.history-btn:active {
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
.batch-slider-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface2);
}
.batch-slider-row strong {
  color: var(--text);
  font-size: 13px;
  text-align: right;
  white-space: nowrap;
}
.batch-count-slider {
  width: 100%;
  accent-color: var(--primary, #7b2fff);
}
.batch-week-picker {
  display: grid;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface2);
}
.batch-week-range-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.batch-week-range-head strong {
  color: var(--text);
  font-size: 13px;
}
.batch-week-range-head span {
  color: var(--text-muted);
  font-size: 11px;
}
.batch-week-range {
  position: relative;
  height: 28px;
}
.batch-week-rail {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 12px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 72%, var(--surface));
  pointer-events: none;
}
.batch-week-rail i {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--batch-week-start);
  right: calc(100% - var(--batch-week-end));
  border-radius: inherit;
  background: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent);
}
.batch-week-slider {
  position: absolute;
  inset: 0;
  width: 100%;
  margin: 0;
  appearance: none;
  background: transparent;
  pointer-events: none;
}
.batch-week-slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
  pointer-events: auto;
  cursor: grab;
}
.batch-week-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
  pointer-events: auto;
  cursor: grab;
}
.batch-week-slider-end::-webkit-slider-thumb {
  background: color-mix(in srgb, var(--primary) 82%, #00f5d4);
}
.batch-week-slider-end::-moz-range-thumb {
  background: color-mix(in srgb, var(--primary) 82%, #00f5d4);
}
.batch-week-labels {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}
.batch-week-labels span {
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 5px 2px;
  border-radius: 7px;
  color: var(--text-muted);
  text-align: center;
}
.batch-week-labels span.active {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--text);
}
.batch-week-labels span.today {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 48%, transparent);
}
.batch-week-labels b {
  font-size: 11px;
}
.batch-week-labels em {
  font-size: 10px;
  font-style: normal;
}
.batch-range-hint {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}
.batch-range-hint {
  line-height: 1.5;
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
  grid-template-columns: 44px 96px 84px 110px 86px 58px minmax(220px, 1fr);
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

.department-todo-tab {
  border-style: dashed;
}

/* ===== Group Todos ===== */
.todo-board {
  --todo-warn: color-mix(in srgb, var(--text, #111827) 30%, #b45309 70%);
  --todo-warn-soft: color-mix(in srgb, var(--surface, #ffffff) 82%, #f59e0b 18%);
  --todo-danger: color-mix(in srgb, var(--text, #111827) 22%, #b91c1c 78%);
  --todo-danger-soft: color-mix(in srgb, var(--surface, #ffffff) 82%, #ef4444 18%);
  --todo-ok: color-mix(in srgb, var(--text, #111827) 28%, #047857 72%);
  flex: 0 0 auto;
  min-height: 0;
  margin-bottom: 0;
  padding: 14px 14px 16px;
  border: 1px solid color-mix(in srgb, var(--border, #2a2a4a) 76%, #f7d68a 24%);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 32%),
    color-mix(in srgb, var(--surface, #1a1a2e) 94%, #f7d68a 6%);
  box-shadow: 0 16px 34px rgba(11, 8, 23, 0.16);
  display: flex;
  flex-direction: column;
  overflow: visible;
  position: relative;
}

.todo-board::before {
  content: "";
  position: absolute;
  inset: 8px;
  pointer-events: none;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 14px;
}

.todo-board-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.todo-board-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.todo-mascot-mark {
  width: 38px;
  height: 38px;
  display: inline-grid;
  place-items: center;
  border-radius: 14px 14px 12px 14px;
  background: color-mix(in srgb, #f7d68a 84%, #ffffff 16%);
  color: #6b3f08;
  border: 2px solid rgba(255, 255, 255, 0.64);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
  font-size: 22px;
  font-weight: 1000;
  line-height: 1;
}

.todo-kicker {
  font-size: 10px;
  font-weight: 800;
  color: var(--text-muted, #8f88a8);
  letter-spacing: 0;
}

.todo-board h3 {
  margin: 2px 0 0;
  font-size: 18px;
  color: var(--text, #e0d8ff);
}

.todo-board-hint {
  position: relative;
  z-index: 1;
  max-width: 100%;
  margin-bottom: 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted, #8f88a8);
}

.todo-raid-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}

.todo-raid-summary span {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
}

.todo-history-btn {
  min-height: 26px;
  padding: 3px 9px;
  border: 1px solid color-mix(in srgb, var(--primary, #2563eb) 45%, var(--border, #2a2a4a));
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface, #ffffff) 82%, var(--primary, #2563eb) 18%);
  color: color-mix(in srgb, var(--text, #111827) 30%, var(--primary, #2563eb) 70%);
  font-size: 12px;
  font-weight: 900;
  font-family: inherit;
  cursor: pointer;
}

.todo-history-btn:hover {
  background: color-mix(in srgb, var(--surface, #ffffff) 72%, var(--primary, #2563eb) 28%);
}

.todo-raid-summary strong {
  color: var(--todo-warn);
  font-size: 14px;
}

.todo-group-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  align-items: start;
  gap: 12px;
  max-height: none;
  overflow: visible;
}

.todo-group {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--border, #2a2a4a) 68%, #fff1a8 32%);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.08), transparent 34%),
    var(--surface, #1a1a2e);
  padding: 11px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
}

.todo-group:hover {
  transform: translateY(-1px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 12px 24px rgba(0,0,0,0.12);
}

.todo-group.active {
  border-color: color-mix(in srgb, var(--primary, #7b2fff) 64%, var(--border, #2a2a4a));
  box-shadow: inset 0 0 0 1px rgba(123, 47, 255, 0.18);
}

.todo-group.danger {
  border-color: rgba(255, 113, 131, 0.72);
}

.todo-group.urgent,
.todo-group.focus {
  border-color: rgba(255, 211, 112, 0.72);
}

.todo-group.clear {
  border-color: rgba(105, 214, 188, 0.66);
}

.todo-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 0;
}

.todo-group-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.todo-group-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text, #e0d8ff);
}

.todo-group-title span {
  font-size: 15px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-group-title small {
  font-size: 11px;
  color: var(--text-muted, #8f88a8);
}

.todo-open-count {
  min-width: 36px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--todo-warn-soft);
  color: var(--todo-warn);
  border: 1px solid color-mix(in srgb, var(--todo-warn) 32%, transparent);
  font-size: 13px;
  font-weight: 1000;
}

.todo-open-count.danger {
  color: var(--todo-danger);
  background: var(--todo-danger-soft);
  border-color: color-mix(in srgb, var(--todo-danger) 36%, transparent);
}

.todo-open-count.urgent,
.todo-open-count.focus {
  color: var(--todo-warn);
}

.todo-open-count.clear {
  color: var(--todo-ok);
}

.todo-assign-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  color: var(--text, #e0d8ff);
  font-size: 12px;
  font-weight: 900;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.16s, border-color 0.16s;
}

.todo-assign-btn:hover {
  transform: translateY(-1px) scale(1.04);
  border-color: rgba(255,255,255,0.24);
  background: rgba(255,255,255,0.13);
}

.todo-group-stats {
  display: grid;
  grid-template-columns: repeat(3, auto) minmax(54px, 1fr);
  align-items: center;
  gap: 6px;
  margin-bottom: 0;
  font-size: 11px;
  color: var(--text-muted, #8f88a8);
}

.todo-group-stats span {
  padding: 3px 6px;
  border-radius: 999px;
  background: rgba(255,255,255,0.055);
  white-space: nowrap;
}

.todo-group-stats i,
.todo-pressure i {
  display: block;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.08);
}

.todo-group-stats b,
.todo-pressure b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #69d6bc, #f7d68a, #ff7183);
}

.todo-quick-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) 118px 84px auto auto;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
}

.todo-input,
.todo-date,
.todo-time {
  min-width: 0;
  height: 32px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface2, #1e1e3a) 88%, #ffffff 12%);
  color: var(--text, #e0d8ff);
  padding: 0 8px;
  font-size: 12px;
  font-family: inherit;
}

.todo-important {
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 7px;
  border-radius: 12px;
  border: 1px solid var(--border, #2a2a4a);
  background: color-mix(in srgb, var(--surface2, #1e1e3a) 88%, #fff1a8 12%);
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
  white-space: nowrap;
}

.todo-important input {
  width: 13px;
  height: 13px;
}

.todo-add-btn {
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(145deg, #69d6bc, #7b2fff);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 8px 16px rgba(0,0,0,0.14);
}

.todo-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: none;
  overflow: visible;
  padding-top: 0;
}

.todo-item {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 52px;
  align-items: start;
  gap: 8px;
  padding: 9px;
  border: 1px solid color-mix(in srgb, var(--border, #2a2a4a) 72%, transparent);
  border-radius: 14px;
  background:
    radial-gradient(circle at 95% 10%, rgba(247, 214, 138, 0.12), transparent 26%),
    var(--surface2, #1e1e3a);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
  position: relative;
  transform-origin: center;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.16s, box-shadow 0.16s;
}

.todo-item:hover {
  transform: translateY(-1px) scale(1.01);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 10px 20px rgba(0,0,0,0.12);
}

.todo-item.overdue {
  border-color: rgba(255, 113, 131, 0.68);
  background:
    radial-gradient(circle at 95% 10%, rgba(255, 113, 131, 0.22), transparent 28%),
    color-mix(in srgb, var(--surface2, #1e1e3a) 88%, #ff7183 12%);
}

.todo-item.today,
.todo-item.soon,
.todo-item.important {
  border-color: rgba(255, 211, 112, 0.68);
  background:
    radial-gradient(circle at 95% 10%, rgba(255, 211, 112, 0.24), transparent 30%),
    color-mix(in srgb, var(--surface2, #1e1e3a) 88%, #ffd370 12%);
}

.todo-item.done {
  opacity: 0.62;
}

.todo-check,
.todo-edit,
.todo-delete {
  width: 22px;
  height: 22px;
  border-radius: 9px;
  border: 1px solid var(--border, #2a2a4a);
  background: var(--surface, #1a1a2e);
  color: var(--text-muted, #8f88a8);
  font-family: inherit;
  cursor: pointer;
}

.todo-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
}

.todo-edit {
  width: 28px;
  font-size: 11px;
}

.todo-check {
  width: 26px;
  height: 26px;
  border-radius: 11px;
}

.todo-check.checked {
  background: #69d6bc;
  border-color: #69d6bc;
  color: #fff;
}

.todo-delete:hover {
  border-color: var(--danger-text, #ef4444);
  color: var(--danger-text, #ef4444);
}

.todo-edit:hover {
  border-color: var(--primary, #7b2fff);
  color: var(--primary-light, #b47fff);
}

.todo-main {
  min-width: 0;
}

.todo-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-bottom: 6px;
}

.todo-rank {
  flex: 0 0 auto;
  padding: 3px 6px;
  border-radius: 8px;
  background: rgba(105, 214, 188, 0.16);
  color: #69d6bc;
  border: 1px solid rgba(105, 214, 188, 0.32);
  font-size: 10px;
  font-weight: 1000;
  line-height: 1;
}

.todo-rank.overdue {
  background: var(--todo-danger-soft);
  border-color: color-mix(in srgb, var(--todo-danger) 38%, transparent);
  color: var(--todo-danger);
}

.todo-rank.today,
.todo-rank.soon,
.todo-rank.important {
  background: var(--todo-warn-soft);
  border-color: color-mix(in srgb, var(--todo-warn) 38%, transparent);
  color: var(--todo-warn);
}

.todo-title {
  flex: 1 1 auto;
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 15px;
  line-height: 1.28;
  font-weight: 950;
  color: var(--text, #e0d8ff);
}

.todo-detail {
  margin: 0 0 5px;
  padding: 6px 8px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--border, #2a2a4a) 70%, transparent);
  background: color-mix(in srgb, var(--surface, #ffffff) 88%, var(--text-muted, #64748b) 12%);
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
  line-height: 1.38;
  display: -webkit-box;
  overflow: hidden;
  white-space: pre-line;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.todo-item.done .todo-title {
  text-decoration: line-through;
  color: var(--text-muted, #8f88a8);
}

.todo-badge {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--todo-warn-soft);
  color: var(--todo-warn);
  font-size: 10px;
  font-weight: 800;
}

.todo-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 7px;
  overflow: hidden;
  margin-top: 2px;
  color: var(--text-muted, #8f88a8);
  font-size: 11px;
}

.todo-meta span {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-deadline {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--todo-warn) 28%, transparent);
  background: var(--todo-warn-soft);
  color: var(--todo-warn);
  font-size: 12px;
  font-weight: 950;
  line-height: 1.35;
}

.todo-deadline.overdue {
  border-color: color-mix(in srgb, var(--todo-danger) 34%, transparent);
  background: var(--todo-danger-soft);
  color: var(--todo-danger);
}

.todo-deadline.done {
  border-color: color-mix(in srgb, var(--todo-ok) 30%, transparent);
  background: color-mix(in srgb, var(--surface, #ffffff) 86%, #10b981 14%);
  color: var(--todo-ok);
}

.todo-charge {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 8px;
  margin-top: 7px;
}

.todo-pressure {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.todo-pressure-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted, #8f88a8);
  font-size: 11px;
}

.todo-pressure-top span,
.todo-pressure-top em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-pressure-top em {
  flex: 0 0 auto;
  font-style: normal;
  color: var(--todo-warn);
  font-weight: 900;
}

.todo-charge.overdue .todo-pressure-top em,
.todo-charge.overdue .todo-pressure-top span {
  color: var(--todo-danger);
}

.todo-charge.today .todo-pressure-top em,
.todo-charge.today .todo-pressure-top span,
.todo-charge.soon .todo-pressure-top em,
.todo-charge.soon .todo-pressure-top span {
  color: var(--todo-warn);
}

.todo-plead {
  position: static;
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--primary, #2563eb) 42%, var(--border, #2a2a4a));
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface, #ffffff) 80%, var(--primary, #2563eb) 20%);
  color: color-mix(in srgb, var(--text, #111827) 28%, var(--primary, #2563eb) 72%);
  font-size: 11px;
  font-weight: 900;
  font-family: inherit;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
  transition: transform 0.14s, background 0.14s, border-color 0.14s, color 0.14s;
}

.todo-plead:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--surface, #ffffff) 70%, var(--primary, #2563eb) 30%);
  border-color: color-mix(in srgb, var(--primary, #2563eb) 62%, var(--border, #2a2a4a));
}

.todo-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 10px;
  border: 1px dashed var(--border, #2a2a4a);
  border-radius: 14px;
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
  text-align: center;
  background: rgba(255,255,255,0.04);
}

.todo-empty span {
  color: var(--text, #e0d8ff);
  font-weight: 900;
}

.todo-empty small {
  font-size: 11px;
}

.todo-assign-modal,
.plead-modal {
  border-radius: 20px;
}

.todo-modal-hero {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 16px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
}

.todo-modal-hero img {
  width: 74px;
  height: 74px;
  object-fit: contain;
  filter: drop-shadow(0 8px 12px rgba(0,0,0,0.18));
}

.todo-modal-hero strong,
.todo-modal-hero span {
  display: block;
}

.todo-modal-hero strong {
  color: var(--text, #e0d8ff);
  font-size: 15px;
  margin-bottom: 4px;
}

.todo-modal-hero span {
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
  line-height: 1.5;
}

.todo-modal-grid {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  align-items: end;
  gap: 8px;
}

.todo-modal-grid label {
  min-width: 0;
}

.todo-modal-important {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 12px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  white-space: nowrap;
}

.todo-title-input {
  min-height: 86px;
  resize: vertical;
  font-size: 15px;
  line-height: 1.45;
  font-weight: 800;
}

.todo-detail-input {
  min-height: 76px;
  resize: vertical;
  line-height: 1.5;
}

.plead-paper {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plead-paper span {
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
}

.deadline-alert-list {
  display: grid;
  gap: 8px;
}

.deadline-alert-item {
  display: grid;
  gap: 4px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--todo-warn, #b45309) 28%, var(--border, #2a2a4a));
  background: color-mix(in srgb, var(--surface, #ffffff) 86%, #f59e0b 14%);
}

.deadline-alert-item.overdue {
  border-color: color-mix(in srgb, var(--todo-danger, #b91c1c) 36%, var(--border, #2a2a4a));
  background: color-mix(in srgb, var(--surface, #ffffff) 84%, #ef4444 16%);
}

.deadline-alert-item strong {
  color: var(--text, #e0d8ff);
  font-size: 13px;
}

.deadline-alert-item span {
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
}

@media (max-width: 1180px) {
  .todo-group-grid {
    grid-template-columns: repeat(2, minmax(280px, 1fr));
  }
}

@media (max-width: 760px) {
  .todo-board-head,
  .todo-raid-summary {
    align-items: flex-start;
    justify-content: flex-start;
  }

  .todo-board-head {
    flex-direction: column;
  }

  .todo-group-grid,
  .todo-quick-row {
    grid-template-columns: 1fr;
  }

  .todo-charge {
    grid-template-columns: 1fr;
  }

  .todo-modal-grid {
    grid-template-columns: 1fr;
  }

  .batch-slider-row {
    grid-template-columns: 1fr;
  }

  .batch-slider-row strong {
    text-align: left;
  }
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
.task-card.todo-mapped-card {
  border-color: rgba(245, 158, 11, .46);
  background:
    linear-gradient(135deg, rgba(245, 158, 11, .12), rgba(16, 185, 129, .08)),
    var(--panel-bg, var(--bg-card, #12122a));
}
.task-card.todo-mapped-card .task-account,
.week-card.todo-mapped-card .week-card-acc {
  color: #b45309;
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
.task-stack-badge,
.week-card-stack {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: linear-gradient(135deg, #f97316, #facc15);
  color: #241002;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
  box-shadow: 0 4px 10px rgba(249, 115, 22, 0.24);
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
.task-activity-latest {
  margin: -2px 38px 9px 0;
  padding: 4px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface2, #1e1e3a) 82%, var(--primary, #7b2fff) 18%);
  color: var(--text-muted, #8f88a8);
  font-size: 10px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.transfer-menu {
  position: fixed;
  z-index: 1200;
  width: 112px;
  max-height: 190px;
  overflow: auto;
  padding: 5px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  background: var(--bg-card, #12122a);
  box-shadow: 0 12px 26px rgba(0,0,0,0.28);
}
.transfer-menu-title {
  padding: 4px 8px 6px;
  color: var(--text-muted, #8f88a8);
  font-size: 11px;
  font-weight: 700;
  border-bottom: 1px solid color-mix(in srgb, var(--border, #2a2a4a) 70%, transparent);
  margin-bottom: 4px;
}
.transfer-menu button {
  width: 100%;
  display: block;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text, #e0d8ff);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.transfer-menu button:hover:not(:disabled) {
  background: var(--accent-soft);
}
.transfer-menu button:disabled {
  color: var(--text-muted, #8f88a8);
  cursor: default;
  opacity: 0.5;
}
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
.week-row.todo-week-row {
  background: color-mix(in srgb, #f59e0b 8%, transparent);
}
.week-row.todo-week-row .week-acc-col {
  background: color-mix(in srgb, #f59e0b 12%, var(--surface, #1a1a2e));
}

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
.week-card.todo-mapped-card {
  border-color: rgba(245, 158, 11, .58);
  background:
    linear-gradient(135deg, rgba(245, 158, 11, .18), rgba(16, 185, 129, .1)),
    var(--panel-bg, var(--bg-card, #12122a));
}

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
.week-card-stack {
  position: absolute;
  top: 22px;
  right: 4px;
  min-width: 22px;
  height: 16px;
  padding: 0 5px;
  font-size: 9px;
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
.participant-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cooperation-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  padding: 8px 10px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  background: var(--surface2, #1e1e3a);
  color: var(--text, #e0d8ff);
  font-size: 13px;
  cursor: pointer;
}
.cooperation-toggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary, #7b2fff);
}
.participant-chip {
  min-height: 28px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--border, #2a2a4a);
  background: var(--surface2, #1e1e3a);
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.participant-chip.active {
  border-color: color-mix(in srgb, var(--primary, #7b2fff) 58%, var(--border, #2a2a4a));
  background: color-mix(in srgb, var(--surface2, #1e1e3a) 72%, var(--primary, #7b2fff) 28%);
  color: var(--text, #e0d8ff);
  font-weight: 800;
}
.participant-chip.primary {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-light, #b47fff) 70%, transparent);
}
.participant-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.participant-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface, #12122a) 82%, var(--success-text, #22c55e) 18%);
  color: var(--text, #e0d8ff);
  font-size: 11px;
}
.participant-pill small {
  padding: 1px 4px;
  border-radius: 999px;
  background: rgba(255,255,255,0.14);
  color: var(--primary-light, #b47fff);
  font-size: 10px;
}
.activity-log-list {
  display: grid;
  gap: 6px;
  max-height: 150px;
  overflow: auto;
}
.activity-log-item {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--border, #2a2a4a) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface2, #1e1e3a) 88%, var(--primary, #7b2fff) 12%);
}
.activity-log-item span {
  color: var(--text-muted, #8f88a8);
  font-size: 11px;
}
.activity-log-item strong {
  min-width: 0;
  color: var(--text, #e0d8ff);
  font-size: 12px;
  line-height: 1.45;
  font-weight: 650;
  word-break: break-word;
}
.activity-log-empty {
  padding: 8px 10px;
  border: 1px dashed var(--border, #2a2a4a);
  border-radius: 8px;
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
}
.schedule-history-modal {
  width: min(680px, calc(100vw - 28px));
}
.schedule-history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(62vh, 520px);
  overflow: auto;
}
.schedule-history-item {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  background: var(--surface2, #1e1e3a);
}
.schedule-history-time {
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
  white-space: nowrap;
}
.schedule-history-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.schedule-history-main strong {
  color: var(--text, #e0d8ff);
  font-size: 13px;
}
.schedule-history-main span {
  color: var(--text-muted, #8f88a8);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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
.modal-delete-btn { margin-right: auto; }
.btn { padding: 8px 18px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 500; transition: all 0.15s; }
.btn-primary { background: var(--primary, #7b2fff); color: #fff; border: none; }
.btn-primary:hover { background: var(--primary-dark, #4a1a8a); }
.btn-danger { background: var(--danger-bg, rgba(239, 68, 68, 0.12)); color: var(--danger-text, #ef4444); border: 1px solid var(--danger-border, rgba(239, 68, 68, 0.28)); }
.btn-danger:hover { border-color: var(--danger-text, #ef4444); background: rgba(239, 68, 68, 0.18); }
.btn-ghost { background: transparent; border: 1px solid var(--border, #2a2a4a); color: var(--text, #e0d8ff); }
.btn-ghost:hover { border-color: var(--primary, #7b2fff); color: var(--primary-light, #b47fff); }
.btn-sm { padding: 4px 12px; font-size: 11px; }
.toast { position: fixed; bottom: 28px; right: 28px; padding: 12px 20px; border-radius: 10px; font-size: 13px; z-index: 1001; font-weight: 500; pointer-events: none; }
.toast.success { background: var(--success-bg); color: var(--success-text); border: 1px solid var(--success-border); }
.toast.error { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
.toast.info { background: var(--surface2, #1e1e3a); color: var(--text, #e0d8ff); border: 1px solid var(--border, #2a2a4a); }
.toast.big { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 24px 48px; border-radius: 16px; font-size: 20px; font-weight: 700; text-align: center; min-width: 320px; z-index: 9999; box-shadow: 0 0 40px rgba(0,245,212,0.3), 0 0 80px rgba(123,47,255,0.2); }
</style>
