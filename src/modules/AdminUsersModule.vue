<template>
  <div class="admin-module">
    <div class="admin-head module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">🔐</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">ACCESS CONTROL</div>
          <h2>权限管理</h2>
        </div>
      </div>
      <div class="module-page-actions">
        <div class="search-box">
          <input v-model="searchKeyword" class="inp search-input" placeholder="搜索用户名/姓名..." />
        </div>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadUsers">刷新</button>
        <button class="btn btn-primary btn-sm" @click="showCreate = true">+ 新建账号</button>
      </div>
    </div>

    <div class="admin-main">
      <div v-if="loading" class="empty-state">加载中</div>
      <div v-else-if="!filteredUsers.length" class="empty-state">暂无用户</div>
      <div v-else class="user-list">
        <article v-for="user in filteredUsers" :key="user.id" class="user-row" :class="{ self: isCurrentUser(user), pending: user.is_pending, offjob: !user.is_on_job, expanded: expandedUsers.has(user.id) }">
          <div class="user-main" @click="toggleExpand(user.id)">
            <div class="user-avatar" :class="{ 'is-leader': isLeader(user), 'is-minister': isMinister(user) }">
              {{ user.role === 'admin' ? '管' : (isMinister(user) ? '部' : (isLeader(user) ? '组' : '员')) }}
            </div>
            <div>
              <strong>{{ user.display_name || user.username }}</strong>
              <span class="user-meta">
                @{{ user.username }}
                <span class="meta-badge" v-if="user.group_name">{{ user.group_name }}</span>
                <span class="meta-badge minister" v-if="isMinister(user)">部长</span>
                <span class="meta-badge leader" v-else-if="isLeader(user)">组长</span>
                <span class="meta-badge" v-else-if="user.employee_type">{{ user.employee_type }}</span>
                <span class="meta-badge warning" v-if="user.is_pending">待激活</span>
                <span class="meta-badge danger" v-if="!user.is_on_job">已离职</span>
                <span class="meta-badge" v-if="user.active && !user.is_pending">启用</span>
                <span class="meta-badge danger" v-else-if="!user.is_pending">停用</span>
                <em v-if="isCurrentUser(user)" class="self-badge">当前</em>
              </span>
            </div>
            <button class="expand-btn" :class="{ open: expandedUsers.has(user.id) }">▼</button>
          </div>

          <div v-if="expandedUsers.has(user.id)" class="user-detail">
            <div class="detail-controls">
              <input v-model.trim="user.display_name" class="inp compact" placeholder="显示名" />
              <select v-model="user.role" class="inp compact" :disabled="isCurrentUser(user)">
                <option value="member">成员</option>
                <option value="admin">管理员</option>
              </select>
              <select v-model="user.group_name" class="inp compact">
                <option value="">无</option>
                <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
              </select>
              <label class="toggle-line">
                <input v-model="user.is_on_job" type="checkbox" :disabled="isCurrentUser(user)" />
                <span>{{ user.is_on_job ? '在职' : '离职' }}</span>
              </label>
              <label class="toggle-line">
                <input v-model="user.active" type="checkbox" :disabled="isCurrentUser(user)" />
                <span>{{ user.active ? '启用' : (user.is_pending ? '待激活' : '停用') }}</span>
              </label>
            </div>
            <div v-if="user.role === 'member'" class="permission-grid">
              <div class="permission-note">普通模块已默认全员开放；这里只控制敏感权限。</div>
              <label v-for="module in restrictedModules" :key="module.id" class="permission-check">
                <input v-model="user.permissions" type="checkbox" :value="module.id" />
                <span>{{ module.label }}</span>
              </label>
            </div>
            <div v-else class="admin-note">管理员默认拥有全部模块和后台权限。</div>
            <div class="row-actions">
              <input v-model="passwordDrafts[user.id]" class="inp compact password-input" type="password" placeholder="新密码" />
              <button class="btn btn-ghost btn-sm" @click="handleReset(user)">重置密码</button>
              <button class="btn btn-primary btn-sm" @click="handleSave(user)">保存</button>
              <button class="btn btn-danger btn-sm" :disabled="isCurrentUser(user)" @click="handleDelete(user)">删除</button>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- 新建账号弹窗 -->
    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <div class="modal-box">
        <div class="modal-title">新建账号</div>
        <div class="modal-form">
          <div class="mf-row"><label>用户名</label><input v-model.trim="draft.username" class="inp" placeholder="真实姓名" /></div>
          <div class="mf-row"><label>显示名</label><input v-model.trim="draft.display_name" class="inp" placeholder="默认同用户名" /></div>
          <div class="mf-row"><label>初始密码</label><input v-model="draft.password" class="inp" type="password" placeholder="至少 6 位" /></div>
          <div class="mf-row"><label>所属组别</label>
            <select v-model="draft.group_name" class="inp">
              <option value="">无</option>
              <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
            </select>
          </div>
          <div class="mf-row"><label>员工类型</label>
            <select v-model="draft.employee_type" class="inp">
              <option value="正式员工">正式员工</option>
              <option value="实习生">实习生</option>
            </select>
          </div>
          <div class="mf-row"><label>角色</label>
            <select v-model="draft.role" class="inp">
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <label class="create-toggle">
            <input v-model="draft.active" type="checkbox" />
            <span>创建后立即启用</span>
          </label>
          <div v-if="draft.role === 'member'" class="modal-perms">
            <div class="permission-note">普通模块默认开放；如需开放敏感模块，在这里勾选。</div>
            <label v-for="module in restrictedModules" :key="module.id" class="perm-check">
              <input v-model="draft.permissions" type="checkbox" :value="module.id" />
              <span>{{ module.label }}</span>
            </label>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" :disabled="creating" @click="handleCreate">{{ creating ? '创建中' : '创建' }}</button>
          <button class="btn btn-ghost btn-sm" @click="showCreate = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { createUser, deleteUser, listUsers, resetUserPassword, updateUser } from '../api/admin'
import { getCurrentAuthUser } from '../api/client'
import { MEMBER_MODULES, RESTRICTED_MEMBER_MODULES } from '../permissions'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()
const memberModules = MEMBER_MODULES
const restrictedModules = MEMBER_MODULES.filter(module => RESTRICTED_MEMBER_MODULES.includes(module.id))
const groups = ['内容一部', '内容二组', '内容三组', '内容四组', '内容五组', '内容六组', 'MCN经纪组']

const users = ref([])
const currentUser = ref(getCurrentAuthUser())
const loading = ref(false)
const creating = ref(false)
const showCreate = ref(false)
const searchKeyword = ref('')
const expandedUsers = reactive(new Set())
const passwordDrafts = reactive({})
const draft = reactive({
  username: '',
  display_name: '',
  group_name: '',
  employee_type: '正式员工',
  password: '',
  role: 'member',
  active: true,
  permissions: []
})

function isLeader(user) {
  return user.title === '组长'
}

function isMinister(user) {
  return user.title === '部长'
}

function toggleExpand(userId) {
  if (expandedUsers.has(userId)) {
    expandedUsers.delete(userId)
  } else {
    expandedUsers.add(userId)
  }
}

const filteredUsers = computed(() => {
  const kw = searchKeyword.value.toLowerCase().trim()
  if (!kw) return users.value
  return users.value.filter(u => {
    const name = (u.display_name || u.username || '').toLowerCase()
    const username = (u.username || '').toLowerCase()
    return name.includes(kw) || username.includes(kw)
  })
})

async function loadUsers() {
  loading.value = true
  try {
    currentUser.value = getCurrentAuthUser()
    const data = await listUsers()
    users.value = (data.users || []).map(user => ({
      ...user,
      permissions: Array.isArray(user.permissions) ? user.permissions : []
    }))
  } catch (e) {
    showToast('账号加载失败：' + e.message, 'error')
  } finally {
    loading.value = false
  }
}

function isCurrentUser(user) {
  return Number(user?.id) === Number(currentUser.value?.id)
}

function resetDraft() {
  draft.username = ''
  draft.display_name = ''
  draft.group_name = ''
  draft.employee_type = '正式员工'
  draft.password = ''
  draft.role = 'member'
  draft.active = true
  draft.permissions = []
}

async function handleCreate() {
  if (!draft.username || !draft.password) {
    showToast('请填写用户名和初始密码', 'error')
    return
  }
  creating.value = true
  try {
    await createUser({
      username: draft.username,
      display_name: draft.display_name || draft.username,
      real_name: draft.username,
      group_name: draft.group_name,
      employee_type: draft.employee_type,
      password: draft.password,
      role: draft.role,
      active: draft.active,
      is_on_job: true,
      permissions: draft.role === 'admin' ? [] : draft.permissions.filter(id => RESTRICTED_MEMBER_MODULES.includes(id))
    })
    showToast('账号已创建', 'success')
    resetDraft()
    showCreate.value = false
    await loadUsers()
  } catch (e) {
    showToast('创建失败：' + e.message, 'error')
  } finally {
    creating.value = false
  }
}

async function handleSave(user) {
  try {
    await updateUser({
      id: user.id,
      display_name: user.display_name,
      group_name: user.group_name,
      employee_type: user.employee_type,
      is_on_job: user.is_on_job,
      is_pending: user.is_pending,
      role: user.role,
      active: user.active,
      permissions: user.role === 'admin' ? [] : user.permissions.filter(id => RESTRICTED_MEMBER_MODULES.includes(id))
    })
    showToast('权限已保存', 'success')
    await loadUsers()
  } catch (e) {
    showToast('保存失败：' + e.message, 'error')
  }
}

async function handleDelete(user) {
  if (isCurrentUser(user)) return
  const label = user.display_name || user.username
  if (!window.confirm(`确定删除账号「${label}」吗？这会让该账号无法再登录。`)) return
  try {
    await deleteUser(user.id)
    showToast('账号已删除', 'success')
    expandedUsers.delete(user.id)
    await loadUsers()
  } catch (e) {
    showToast('删除失败：' + e.message, 'error')
  }
}

async function handleReset(user) {
  const nextPassword = passwordDrafts[user.id]
  if (!nextPassword) {
    showToast('请先输入新密码', 'error')
    return
  }
  try {
    await resetUserPassword(user.id, nextPassword)
    passwordDrafts[user.id] = ''
    showToast('密码已重置', 'success')
  } catch (e) {
    showToast('重置失败：' + e.message, 'error')
  }
}

onMounted(loadUsers)
</script>

<style scoped>
.admin-module {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.admin-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
}

.admin-kicker {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
}

.admin-head h2 {
  margin: 0;
  color: var(--text);
  font-size: 20px;
  font-weight: 750;
  line-height: 1.2;
}

.search-box {
  position: relative;
}

.search-input {
  width: 180px;
  height: 32px;
  padding: 4px 10px;
  font-size: 12px;
  background: var(--surface2, #1e1e3a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  color: var(--text, #e0d8ff);
}

.admin-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.user-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-row {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  overflow: hidden;
}

.user-row.self {
  border-color: var(--primary);
}

.user-row.expanded {
  border-color: var(--primary-light);
}

.user-main {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
}

.user-main:hover {
  background: var(--panel-bg-hover);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--primary-gradient);
  font-size: 12px;
  font-weight: 800;
  flex-shrink: 0;
}

.user-avatar.is-leader {
  background: linear-gradient(135deg, #22c55e, #16a34a);
}

.user-avatar.is-minister {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}

.user-main strong {
  display: block;
  color: var(--text);
  font-size: 14px;
}

.user-main > div > span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 2px;
}

.expand-btn {
  margin-left: auto;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  transition: transform 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.expand-btn.open {
  transform: rotate(180deg);
}

.self-badge {
  display: inline-flex;
  margin-left: 6px;
  color: var(--primary);
  font-style: normal;
  font-weight: 800;
}

.user-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
}

.meta-badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  background: var(--accent-soft);
  color: var(--primary-light);
}

.meta-badge.leader {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.meta-badge.minister {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.meta-badge.warning {
  background: rgba(234, 179, 8, 0.15);
  color: #eab308;
}

.meta-badge.danger {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.user-row.pending {
  opacity: 0.7;
}

.user-row.offjob {
  opacity: 0.5;
}

.user-detail {
  padding: 12px;
  border-top: 1px solid var(--border);
  background: var(--panel-bg-soft);
}

.detail-controls {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) 90px 110px 76px 92px;
  gap: 8px;
  align-items: center;
}

.compact {
  height: 32px;
  padding: 4px 8px;
  font-size: 12px;
}

.toggle-line {
  height: 32px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-bg);
}

.toggle-line span {
  font-size: 11px;
}

.user-detail .inp:disabled,
.toggle-line input:disabled + span {
  cursor: not-allowed;
  opacity: 0.62;
}

.admin-note {
  margin-top: 10px;
  color: var(--success-text);
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
}

.permission-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 6px;
}

.permission-check {
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  background: var(--panel-bg);
}

.row-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  align-items: center;
}

.password-input {
  max-width: 120px;
  height: 30px;
  padding: 4px 8px;
  font-size: 12px;
}

.empty-state {
  color: var(--text-muted);
  font-size: 13px;
  padding: 60px;
  text-align: center;
}

/* 弹窗样式 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-box {
  background: var(--surface, #1a1a2e);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
  padding: 20px;
  width: 360px;
  max-width: 90vw;
}

.modal-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--primary-light, #b47fff);
  margin-bottom: 16px;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mf-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.mf-row label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}

.mf-row .inp {
  height: 36px;
  padding: 6px 10px;
  font-size: 13px;
}

.modal-perms {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.create-toggle {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 7px 10px;
  background: var(--surface2, #1e1e3a);
}

.btn-danger {
  border-color: rgba(239, 68, 68, 0.35);
  color: #f87171;
  background: rgba(239, 68, 68, 0.1);
}

.btn-danger:hover:not(:disabled) {
  border-color: rgba(239, 68, 68, 0.55);
  background: rgba(239, 68, 68, 0.18);
}

.btn-danger:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.perm-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface2, #1e1e3a);
}

.modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  justify-content: flex-end;
}

@media (max-width: 900px) {
  .detail-controls {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 600px) {
  .detail-controls {
    grid-template-columns: 1fr;
  }
}
</style>
