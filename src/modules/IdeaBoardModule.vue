<template>
  <div class="idea-board">
    <div class="module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">💡</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">IDEA BOARD</div>
          <h2>创意看板</h2>
        </div>
      </div>
      <div class="module-page-actions">
        <span class="module-page-pill">{{ ideas.length }} 条创意</span>
        <span class="module-page-pill">{{ uniqueUsers }} 位成员</span>
      </div>
    </div>
    <div class="board-layout">
      <!-- 左侧：上传面板 -->
      <div class="upload-panel">
        <div class="panel-title">📋 添加创意</div>

        <div class="input-group">
          <label>视频链接</label>
          <textarea
            class="inp"
            v-model="inputUrl"
            rows="5"
            placeholder="粘贴一条或多条抖音/B站链接，带说明文字也可以"
          ></textarea>
          <div class="input-hint">支持一次粘贴多条链接；备注会应用到本次保存的每一条。</div>
        </div>

        <div class="input-group">
          <label>备注（选填）</label>
          <textarea
            class="inp"
            v-model="inputNote"
            rows="3"
            placeholder="简单描述这个视频给你的启发..."
          ></textarea>
        </div>

        <div v-if="parseError" class="parse-error">{{ parseError }}</div>
        <div v-if="parsing && parseProgress.total" class="parse-progress">
          正在处理 {{ parseProgress.done + 1 > parseProgress.total ? parseProgress.total : parseProgress.done + 1 }}/{{ parseProgress.total }}
          <span v-if="parseProgress.failed">，失败 {{ parseProgress.failed }}</span>
        </div>

        <button class="btn btn-primary" @click="doParse" :disabled="parsing || !inputUrl.trim()">
          <span v-if="parsing" class="spinner-sm"></span>
          <span v-else>转写并保存</span>
        </button>

        <div class="divider"></div>

        <div class="stats">
          当前共 <span class="stat-num">{{ ideas.length }}</span> 条创意 ·
          来自 <span class="stat-num">{{ uniqueUsers }}</span> 位成员
        </div>

        <div class="panel-tip">
          💡 粘贴链接 → 点击解析 → AI自动识别视频内容并生成便签
        </div>
      </div>

      <!-- 右侧：便签墙 -->
      <div class="board-area">
        <div class="board-header">
          <div class="board-title">💡 团队创意集</div>
          <div class="filter-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >{{ tab.label }}</button>
          </div>
        </div>

        <!-- 解析中状态 -->
        <div v-if="parsing" class="parsing-badge">
          <div class="spinner-sm"></div>
          正在批量转写 {{ parseProgress.done }}/{{ parseProgress.total }}
        </div>

        <!-- 空状态 -->
        <div v-if="filteredIdeas.length === 0 && !parsing" class="empty-state">
          <div class="empty-icon">💡</div>
          <h3>还没有创意</h3>
          <p>粘贴一个抖音或B站视频链接，开始收集灵感</p>
        </div>

        <!-- 便签网格 -->
        <div v-else class="card-grid">
          <div
            v-for="idea in filteredIdeas"
            :key="idea.id"
            class="card"
            @click="recordClick(idea)"
            @contextmenu="openCommentMenu(idea, $event)"
          >
            <div class="card-header">
              <div class="card-user">
                <div class="card-avatar">{{ getAvatar(idea.user_name) }}</div>
                <div class="card-user-info">
                  <div class="card-user-name">{{ idea.user_name }}</div>
                  <div class="card-time">{{ formatTime(idea.created_at) }}</div>
                </div>
              </div>
              <div v-if="canEditIdea(idea)" class="card-actions">
                <button class="card-action" @click.stop="openEditIdea(idea)" title="编辑">编辑</button>
                <button class="card-action danger" @click.stop="deleteIdea(idea.id)" title="删除">删除</button>
              </div>
            </div>

            <button
              type="button"
              class="favorite-button"
              :class="{ active: idea.is_favorited }"
              :disabled="isSavingFavorite(idea.id)"
              :title="idea.is_favorited ? '取消收藏' : '收藏这个创意'"
              @click.stop="toggleFavorite(idea)"
            >
              <span class="favorite-icon">{{ idea.is_favorited ? '♥' : '♡' }}</span>
              <span>{{ idea.favorite_count || 0 }}</span>
            </button>

            <div class="card-meta-row">
              <div class="card-platform">{{ platformLabel(idea.platform) }}</div>
              <div class="card-clicks" :title="'这个创意被点击了 ' + (idea.click_count || 0) + ' 次'">
                点击 {{ idea.click_count || 0 }}
              </div>
            </div>

            <div v-if="idea.video_title" class="card-title">{{ idea.video_title }}</div>

            <div v-if="idea.summary" class="card-summary">{{ idea.summary }}</div>

            <div v-if="idea.note" class="card-note">📝 {{ idea.note }}</div>

            <div v-if="idea.tags && idea.tags.length" class="card-tags">
              <span v-for="tag in idea.tags" :key="tag" class="card-tag">{{ tag }}</span>
            </div>

            <a v-if="idea.video_url && idea.video_url.startsWith('http')" class="card-link" :href="idea.video_url" target="_blank" rel="noopener" @click.stop="recordClick(idea)">
              🔗 查看原视频 →
            </a>

            <div v-if="idea.comments && idea.comments.length" class="comment-cloud" aria-label="创意评价">
              <div
                v-for="(comment, index) in idea.comments"
                :key="comment.id"
                class="comment-bubble"
                :style="commentBubbleStyle(index)"
              >
                <span class="comment-text">{{ comment.text }}</span>
                <span class="comment-meta">{{ comment.user_name }} · {{ formatTime(comment.created_at) }}</span>
                <button
                  v-if="canDeleteComment(comment)"
                  type="button"
                  class="comment-delete"
                  title="删除评价"
                  @click.stop="removeIdeaComment(comment)"
                >×</button>
              </div>
            </div>

            <div class="comment-composer">
              <input
                v-model="commentDrafts[idea.id]"
                class="comment-input"
                type="text"
                maxlength="80"
                placeholder="评价一下：适合谁做？亮点/风险是什么？"
                @keyup.enter="submitIdeaComment(idea)"
                @click.stop
              />
              <button
                type="button"
                class="comment-submit"
                :disabled="isSavingComment(idea.id) || !String(commentDrafts[idea.id] || '').trim()"
                @click.stop="submitIdeaComment(idea)"
              >
                {{ isSavingComment(idea.id) ? '贴中' : '评价' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="commentMenu.open" class="comment-menu-mask" @click="closeCommentMenu">
      <div
        class="comment-menu"
        :style="{ left: commentMenu.x + 'px', top: commentMenu.y + 'px' }"
        @click.stop
      >
        <div class="comment-menu-title">给这条创意贴一句评价</div>
        <div class="comment-menu-subtitle">{{ commentMenu.idea?.video_title || '未命名创意' }}</div>
        <input
          v-if="commentMenu.idea"
          v-model="commentDrafts[commentMenu.idea.id]"
          class="comment-input"
          type="text"
          maxlength="80"
          autofocus
          placeholder="比如：这个选题适合最翁"
          @keyup.enter="submitIdeaComment(commentMenu.idea)"
          @keyup.esc="closeCommentMenu"
        />
        <div class="comment-menu-actions">
          <button type="button" class="comment-menu-cancel" @click="closeCommentMenu">取消</button>
          <button
            v-if="commentMenu.idea"
            type="button"
            class="comment-submit"
            :disabled="isSavingComment(commentMenu.idea.id) || !String(commentDrafts[commentMenu.idea.id] || '').trim()"
            @click="submitIdeaComment(commentMenu.idea)"
          >
            {{ isSavingComment(commentMenu.idea.id) ? '贴中' : '贴上去' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="editingIdea" class="edit-mask" @click.self="closeEditIdea">
      <div class="edit-dialog">
        <div class="edit-head">
          <strong>编辑创意</strong>
          <button type="button" class="edit-close" @click="closeEditIdea">×</button>
        </div>
        <div class="edit-grid">
          <label>
            <span>平台</span>
            <select v-model="editForm.platform" class="inp">
              <option value="douyin">抖音</option>
              <option value="bilibili">B站</option>
              <option value="hot">热点</option>
            </select>
          </label>
          <label>
            <span>视频链接</span>
            <input v-model="editForm.video_url" class="inp" type="text" />
          </label>
          <label>
            <span>标题</span>
            <input v-model="editForm.video_title" class="inp" type="text" />
          </label>
          <label>
            <span>标签</span>
            <input v-model="editForm.tagsText" class="inp" type="text" placeholder="用逗号分隔" />
          </label>
          <label class="wide">
            <span>摘要</span>
            <textarea v-model="editForm.summary" class="inp" rows="4"></textarea>
          </label>
          <label class="wide">
            <span>备注</span>
            <textarea v-model="editForm.note" class="inp" rows="3"></textarea>
          </label>
        </div>
        <div class="edit-footer">
          <button type="button" class="btn btn-secondary" @click="closeEditIdea">取消</button>
          <button type="button" class="btn btn-primary" :disabled="savingEdit" @click="saveIdeaEdit">
            {{ savingEdit ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useIdeaBoard } from './ideas/useIdeaBoard'

const {
  activeTab,
  canEditIdea,
  canDeleteComment,
  closeEditIdea,
  closeCommentMenu,
  commentBubbleStyle,
  commentDrafts,
  commentMenu,
  currentUser,
  deleteIdea,
  doParse,
  editForm,
  editingIdea,
  filteredIdeas,
  formatTime,
  getAvatar,
  platformLabel,
  ideas,
  inputNote,
  inputUrl,
  parseError,
  parseProgress,
  parsing,
  removeIdeaComment,
  saveIdeaEdit,
  savingEdit,
  submitIdeaComment,
  isSavingComment,
  isSavingFavorite,
  openEditIdea,
  openCommentMenu,
  recordClick,
  toggleFavorite,
  tabs,
  uniqueUsers
} = useIdeaBoard()
</script>

<style scoped>
.idea-board {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.board-layout {
  display: flex;
  gap: 20px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── 上传面板 ── */
.upload-panel {
  width: 300px;
  flex-shrink: 0;
  background: var(--bg-secondary, #111827);
  border: 1px solid var(--border-color, #1f2937);
  border-radius: 12px;
  padding: 20px;
  height: fit-content;
  overflow-y: auto;
  box-shadow: var(--shadow);
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-cyan, #00f5d4);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.input-group { margin-bottom: 12px; }
.input-group label {
  display: block;
  font-size: 12px;
  color: var(--text-muted, #9ca3af);
  margin-bottom: 6px;
}
.input-hint { font-size: 11px; color: var(--text-muted, #6b7280); margin-top: 4px; }

.divider { height: 1px; background: var(--border-color, #1f2937); margin: 16px 0; }

.stats { font-size: 12px; color: var(--text-muted, #6b7280); }
.stat-num { color: var(--accent-cyan, #00f5d4); font-weight: 600; }

.panel-tip {
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-muted, #6b7280);
  background: var(--bg-tertiary, #1f2937);
  border-radius: 8px;
  padding: 10px;
  line-height: 1.6;
}

.parse-error {
  font-size: 12px;
  color: var(--danger-text, #ef4444);
  background: var(--danger-bg, rgba(239, 68, 68, 0.1));
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
}

.parse-progress {
  font-size: 12px;
  color: var(--accent-cyan, #00f5d4);
  background: var(--accent-soft, rgba(0, 245, 212, 0.08));
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
}

/* ── 便签墙 ── */
.board-area {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
}

.board-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.board-title { font-size: 18px; font-weight: 600; color: var(--text-primary, #e0e6ed); }

.filter-tabs { display: flex; gap: 8px; }
.filter-tabs button {
  padding: 6px 14px;
  border: 1px solid var(--border-color, #374151);
  background: transparent;
  color: var(--text-muted, #9ca3af);
  border-radius: 20px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.filter-tabs button.active {
  background: var(--accent-purple, #7b2fff);
  color: #fff;
  border-color: var(--accent-purple, #7b2fff);
}

.parsing-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.1);
  padding: 8px 16px;
  border-radius: 20px;
  margin-bottom: 16px;
}

/* ── 卡片网格 ── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.card {
  background: var(--bg-secondary, #111827);
  border: 1px solid var(--border-color, #1f2937);
  border-radius: 12px;
  padding: 16px;
  position: relative;
  box-shadow: var(--shadow);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}
.card:hover {
  border-color: var(--accent-purple, #7b2fff);
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
.card:hover .card-actions { opacity: 1; }

.favorite-button {
  position: absolute;
  top: 48px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 42px;
  height: 26px;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--accent-purple, #7b2fff) 20%, var(--border-color, #374151));
  border-radius: 999px;
  color: color-mix(in srgb, var(--text-muted, #9ca3af) 86%, #fff);
  background:
    radial-gradient(circle at 32% 18%, rgba(255,255,255,0.08), transparent 32%),
    color-mix(in srgb, var(--bg-tertiary, #1f2937) 90%, transparent);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  transition: transform 0.18s, border-color 0.18s, color 0.18s, background 0.18s;
}

.favorite-button:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, #b8924b 48%, var(--accent-purple, #7b2fff));
  color: #c6a86b;
}

.favorite-button.active {
  border-color: color-mix(in srgb, #b8924b 38%, var(--border-color, #374151));
  color: #d7bd82;
  background:
    radial-gradient(circle at 28% 18%, rgba(255,255,255,0.1), transparent 28%),
    linear-gradient(135deg, rgba(184,146,75,0.15), rgba(123,47,255,0.08)),
    color-mix(in srgb, var(--bg-tertiary, #1f2937) 84%, transparent);
  box-shadow: 0 6px 16px rgba(184, 146, 75, 0.08);
}

.favorite-button:disabled {
  opacity: 0.6;
  cursor: wait;
}

.favorite-icon {
  font-size: 14px;
  line-height: 1;
  transform: translateY(-0.5px);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}
.card-user { display: flex; align-items: center; gap: 8px; }
.card-avatar {
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, var(--accent-purple, #7b2fff), var(--accent-cyan, #00f5d4));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.card-user-info { font-size: 12px; }
.card-user-name { color: var(--text-primary, #e0e6ed); font-weight: 500; }
.card-time { color: var(--text-muted, #6b7280); font-size: 11px; }
.card-actions {
  opacity: 0;
  display: flex;
  gap: 6px;
  transition: opacity 0.2s;
}
.card-action {
  background: none;
  border: none;
  color: var(--accent-cyan, #00f5d4);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
}
.card-action.danger {
  color: var(--danger-text, #ef4444);
}

.card-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.card-platform {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
  background: var(--bg-tertiary, #1f2937);
  padding: 3px 8px;
  border-radius: 4px;
}

.card-clicks {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--accent-cyan, #00f5d4);
  background: color-mix(in srgb, var(--accent-cyan, #00f5d4) 10%, var(--bg-tertiary, #1f2937));
  border: 1px solid color-mix(in srgb, var(--accent-cyan, #00f5d4) 22%, var(--border-color, #374151));
  border-radius: 4px;
  padding: 3px 8px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #e0e6ed);
  margin-bottom: 8px;
  line-height: 1.4;
}
.card-summary {
  font-size: 13px;
  color: var(--text-muted, #9ca3af);
  line-height: 1.6;
  margin-bottom: 8px;
}
.card-note {
  font-size: 12px;
  color: var(--accent-cyan, #00f5d4);
  background: var(--accent-soft, rgba(0, 245, 212, 0.05));
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 8px;
}

.card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.card-tag {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--bg-tertiary, #1f2937);
  color: var(--accent-cyan, #00f5d4);
}

.card-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--accent-purple, #7b2fff);
  text-decoration: none;
}
.card-link:hover { text-decoration: underline; }

.comment-cloud {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  margin: 13px -4px 0;
  padding: 2px 0;
}

.comment-bubble {
  position: relative;
  max-width: calc(100% - 22px);
  padding: 8px 28px 7px 11px;
  border: 1px solid color-mix(in srgb, var(--accent-cyan, #00f5d4) 38%, var(--border-color, #374151));
  border-radius: 16px 16px 16px 5px;
  color: var(--text-primary, #e0e6ed);
  background:
    radial-gradient(circle at 12% 8%, rgba(255,255,255,0.16), transparent 34%),
    linear-gradient(135deg, rgba(0,245,212,0.16), rgba(123,47,255,0.12));
  box-shadow: 0 10px 28px rgba(0,0,0,0.16);
}

.comment-bubble::before {
  content: '';
  position: absolute;
  left: 12px;
  bottom: -6px;
  width: 11px;
  height: 11px;
  border-left: 1px solid color-mix(in srgb, var(--accent-cyan, #00f5d4) 38%, var(--border-color, #374151));
  border-bottom: 1px solid color-mix(in srgb, var(--accent-cyan, #00f5d4) 38%, var(--border-color, #374151));
  background: color-mix(in srgb, var(--bg-secondary, #111827) 70%, var(--accent-cyan, #00f5d4) 18%);
  transform: rotate(-42deg);
}

.comment-text {
  display: block;
  font-size: 12px;
  line-height: 1.45;
}

.comment-meta {
  display: block;
  margin-top: 3px;
  font-size: 10px;
  color: var(--text-muted, #9ca3af);
}

.comment-delete {
  position: absolute;
  top: 5px;
  right: 7px;
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  color: var(--text-muted, #9ca3af);
  background: rgba(255,255,255,0.08);
  cursor: pointer;
  line-height: 16px;
  padding: 0;
}

.comment-delete:hover {
  color: var(--danger-text, #ef4444);
  background: rgba(239,68,68,0.14);
}

.comment-composer {
  display: none;
}

.comment-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 260;
  background: transparent;
}

.comment-menu {
  position: fixed;
  width: min(320px, calc(100vw - 24px));
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--accent-cyan, #00f5d4) 34%, var(--border-color, #374151));
  border-radius: 16px;
  background:
    radial-gradient(circle at 8% 0%, rgba(0,245,212,0.14), transparent 38%),
    var(--bg-secondary, #111827);
  box-shadow: 0 18px 50px rgba(0,0,0,0.28);
}

.comment-menu-title {
  color: var(--text-primary, #e0e6ed);
  font-size: 13px;
  font-weight: 700;
}

.comment-menu-subtitle {
  overflow: hidden;
  margin: 4px 0 10px;
  color: var(--text-muted, #9ca3af);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.comment-input {
  width: 100%;
  border: 1px solid var(--border-color, #374151);
  border-radius: 999px;
  padding: 9px 12px;
  color: var(--text-primary, #e0e6ed);
  background: color-mix(in srgb, var(--bg-tertiary, #1f2937) 82%, transparent);
  font-size: 12px;
}

.comment-input:focus {
  outline: none;
  border-color: var(--accent-cyan, #00f5d4);
  box-shadow: 0 0 0 3px rgba(0,245,212,0.08);
}

.comment-menu-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.comment-menu-cancel,
.comment-submit {
  border: 0;
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.comment-menu-cancel {
  color: var(--text-muted, #9ca3af);
  background: var(--bg-tertiary, #1f2937);
}

.comment-submit {
  color: #061014;
  background: linear-gradient(135deg, var(--accent-cyan, #00f5d4), #a7f3d0);
}

.comment-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── 空状态 ── */
.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-muted, #6b7280);
}
.empty-icon { font-size: 48px; margin-bottom: 16px; }
.empty-state h3 { color: var(--text-secondary, #9ca3af); margin-bottom: 8px; }
.empty-state p { font-size: 14px; }

/* ── 按钮 & 输入框（复用全局样式） ── */
.btn { width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
.btn-primary { background: linear-gradient(135deg, var(--accent-purple, #7b2fff), var(--accent-cyan, #00f5d4)); color: #fff; }
.btn-primary:hover { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.inp {
  width: 100%;
  background: var(--bg-tertiary, #1f2937);
  border: 1px solid var(--border-color, #374151);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text-primary, #e0e6ed);
  font-size: 14px;
  font-family: inherit;
}
.inp:focus { outline: none; border-color: var(--accent-purple, #7b2fff); }

.spinner-sm {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--chip-border, rgba(255,255,255,0.3));
  border-top-color: var(--accent-purple, #fff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }

.edit-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.56);
}
.edit-dialog {
  width: min(720px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: var(--bg-secondary, #111827);
  border: 1px solid var(--border-color, #374151);
  border-radius: 12px;
  padding: 18px;
  box-shadow: var(--shadow-lg);
}
.edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  color: var(--text-primary, #e0e6ed);
}
.edit-close {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: var(--bg-tertiary, #1f2937);
  color: var(--text-muted, #9ca3af);
  cursor: pointer;
  font-size: 18px;
}
.edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.edit-grid label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted, #9ca3af);
  font-size: 12px;
}
.edit-grid .wide {
  grid-column: 1 / -1;
}
.edit-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
.edit-footer .btn {
  width: auto;
  min-width: 92px;
}
.btn-secondary {
  background: var(--bg-tertiary, #1f2937);
  color: var(--text-primary, #e0e6ed);
  border: 1px solid var(--border-color, #374151);
}
</style>
