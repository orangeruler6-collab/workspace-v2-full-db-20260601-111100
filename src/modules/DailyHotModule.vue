<template>
  <div class="daily-hot-module">
    <div class="hot-topbar module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon" aria-hidden="true">&#128293;</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">DAILY HOT</div>
          <h2>每日热点</h2>
        </div>
      </div>
      <div class="module-page-actions hot-summary">
        <span class="module-page-pill">{{ overview.total }} 条热点</span>
        <span class="module-page-pill">{{ overview.sources }} 个来源</span>
        <span class="module-page-pill">{{ lastUpdatedLabel }}</span>
      </div>
    </div>

    <div class="filter-strip">
      <div class="filter-fields compact">
        <div class="date-picker">
          <div class="date-nav">
            <button type="button" class="date-nav-btn" @click="adjustDate(-1)">◀</button>
            <input class="inp date-input" type="date" v-model="date" @change="fetchList" />
            <button type="button" class="date-nav-btn" @click="adjustDate(1)">▶</button>
          </div>
        </div>
        <select v-model="categoryFilter" class="inp filter-select compact">
          <option value="all">全部分类</option>
          <option v-for="name in categories" :key="name" :value="name">{{ name }}</option>
        </select>
        <select v-model="sourceFilter" class="inp filter-select compact">
          <option value="all">全部来源</option>
          <option v-for="name in sources" :key="name" :value="name">{{ name }}</option>
        </select>
      </div>
      <div class="filter-actions">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="fetchList">🔄</button>
        <button class="btn btn-primary btn-sm" :disabled="refreshing" @click="refresh">
          {{ refreshing ? '更新中' : '更新' }}
        </button>
      </div>
    </div>

    <div class="hot-layout">
      <main class="hot-feed">
        <div class="feed-head">
          <div>
            <strong>文章热点列表</strong>
            <span>按文章源和分类展示</span>
          </div>
          <em>{{ filteredItems.length }} 条</em>
        </div>

        <div v-if="loading" class="empty-state">加载中</div>
        <div v-else-if="!filteredItems.length" class="empty-state">暂无热点信息</div>

        <template v-else>
          <article
            v-for="item in filteredItems"
            :key="item.id"
            class="hot-card"
            :class="{ featured: (item.dailyRank || item.rank || 999) <= 3 }">
            <div class="rank-cell">
              <span class="rank-box">{{ item.dailyRank || item.rank || '-' }}</span>
            </div>
            <div class="card-main">
              <div class="card-title-row">
                <a
                  v-if="hasLink(item)"
                  class="hot-title"
                  :href="item.url"
                  target="_blank"
                  rel="noopener"
                  @click.stop>{{ item.title }}</a>
                <span v-else class="hot-title">{{ item.title }}</span>
              </div>
              <p v-if="item.snippet" class="snippet">{{ item.snippet }}</p>
              <div class="meta-row">
                <span>{{ item.sourceLabel || item.source || '未知来源' }}</span>
                <span>{{ item.category || '其他' }}</span>
                <span v-if="item.sourceCount > 1">{{ item.sourceCount }} 个来源</span>
                <span v-if="hasLink(item)">可跳转</span>
              </div>
              <div v-if="item.tags?.length" class="tag-row">
                <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
              </div>
            </div>
            <div class="card-side">
              <div class="heat-meter">
                <span>热度</span>
                <strong>{{ item.score }}</strong>
                <i><b :style="{ width: heatWidth(item.score) + '%' }"></b></i>
              </div>
              <div class="card-actions">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :disabled="!hasLink(item)"
                  @click.stop="openHotLink(item)">
                  打开来源
                </button>
                <button type="button" class="btn btn-primary btn-sm" @click.stop="jumpToCopygen(item)">去生成</button>
              </div>
            </div>
          </article>
        </template>
      </main>

      <aside class="info-panel">
        <div class="side-head">
          <span>{{ overview.total }} 条热点 · {{ overview.sources }} 来源 · {{ overview.categories }} 分类</span>
          <span class="side-time">{{ lastUpdatedLabel }}</span>
        </div>

        <section class="side-section">
          <div class="section-title">
            <span>分类分布</span>
          </div>
          <div v-if="!categoryBars.length" class="empty-mini">暂无数据</div>
          <div v-else class="bar-list">
            <div v-for="bar in categoryBars" :key="bar.name" class="bar-row">
              <span>{{ bar.name }}</span>
              <i><b :style="{ width: bar.width + '%' }"></b></i>
              <em>{{ bar.count }}</em>
            </div>
          </div>
        </section>

        <section class="side-section">
          <div class="section-title">
            <span>高频关键词</span>
          </div>
          <div v-if="!keywords.length" class="empty-mini compact">暂无关键词</div>
          <div v-else class="keyword-cloud">
            <span
              v-for="word in keywords"
              :key="word.name"
              class="keyword"
              :class="{ featured: word.featured }">{{ word.name }}</span>
          </div>
        </section>

        <section class="side-section quality-section">
          <div class="section-title">
            <span>搜索复核</span>
            <small>内容质量</small>
          </div>
          <div class="quality-grid">
            <div class="quality-card">
              <span>文章源</span>
              <strong>{{ qualityReview.sourceTypes.article }}</strong>
              <em>{{ qualityReview.articleRatio }}%</em>
            </div>
            <div class="quality-card">
              <span>OpenCLI</span>
              <strong>{{ qualityReview.sourceTypes.opencli }}</strong>
              <em>{{ qualityReview.openCliRatio }}%</em>
            </div>
            <div class="quality-card">
              <span>缺摘要</span>
              <strong>{{ qualityReview.lowContext }}</strong>
              <em>需复看</em>
            </div>
            <div class="quality-card">
              <span>关键词覆盖</span>
              <strong>{{ qualityReview.keywordCoverage }}%</strong>
              <em>标签命中</em>
            </div>
          </div>
          <div class="quality-notes">
            <span v-for="note in qualityReview.notes" :key="note">{{ note }}</span>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { useToast } from '../composables/useToast'
import { useDailyHot } from './daily-hot/useDailyHot?rightPanel=v3'

const { showToast } = useToast()

const {
  categoryBars,
  categoryFilter,
  categories,
  date,
  fetchList,
  filteredItems,
  hasLink,
  heatWidth,
  jumpToCopygen,
  keywords,
  lastUpdatedLabel,
  loading,
  openHotLink,
  overview,
  qualityReview,
  refresh,
  refreshing,
  sourceBars,
  sourceFilter,
  sources,
  todayKey,
  yesterdayKey
} = useDailyHot(showToast)
</script>

<style scoped>
.daily-hot-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
}

.hot-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
}

.hot-kicker {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0;
}

.hot-topbar h2 {
  margin: 0;
  color: var(--text);
  font-size: 20px;
  font-weight: 750;
  line-height: 1.2;
  letter-spacing: 0;
}

.filter-select {}

/* 日期选择器美化 */
.date-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
}

.date-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.date-nav-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  font-family: inherit;
}

.date-nav-btn:hover {
  border-color: var(--primary);
  color: var(--primary-light);
  background: var(--accent-soft);
}

.date-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 12px;
  color-scheme: dark;
}

.date-input::-webkit-calendar-picker-indicator {
  filter: invert(0.7);
  cursor: pointer;
}

.date-label {
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 700;
}

.filter-select {
  width: 100%;
}

.filter-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  flex-shrink: 0;
}

.filter-fields {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.filter-fields.compact {
  gap: 8px;
}

.filter-select.compact {
  height: 32px;
  padding: 4px 8px;
  font-size: 12px;
}

.filter-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-actions .btn {
  height: 32px;
  padding: 0 12px;
}

.hot-layout {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(520px, 1fr) 280px;
  gap: 12px;
  overflow: hidden;
}

.hot-feed {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.feed-head {
  min-height: 26px;
  padding: 0 4px 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text);
}

.feed-head strong {
  font-size: 14px;
}

.feed-head span {
  color: var(--text-muted);
  font-size: 12px;
}

.hot-card {
  width: 100%;
  flex: 0 0 auto;
  min-height: 74px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 108px;
  gap: 8px;
  transition: border-color 0.16s, background 0.16s;
}

.hot-card.clickable {
  cursor: pointer;
}

.hot-card:hover {
  border-color: var(--border-mid);
  background: var(--panel-bg-hover);
}

.rank-box {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--chip-bg);
  color: var(--text-dim);
  font-weight: 800;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.card-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hot-title {
  color: var(--text);
  display: -webkit-box;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.34;
  text-decoration: none;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

a.hot-title:hover {
  color: var(--primary-light);
}

.snippet {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.42;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meta-row,
.tag-row {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.meta-row span {
  padding: 1px 6px;
  border: 1px solid var(--chip-border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.tag-row span {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.4;
}

.card-side {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 6px;
}

.card-side strong {
  color: var(--text-dim);
  font-size: 14px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.card-side i {
  width: 72px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chip-border);
}

.card-side b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
}

.info-panel {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.side-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.side-head span {
  font-size: 12px;
  color: var(--text-dim);
}

.side-head .side-time {
  font-size: 11px;
  color: var(--text-muted);
}

.side-section {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.section-title {
  margin-bottom: 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
}

.section-title small {
  min-width: 0;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.metric-card {
  min-height: 48px;
  padding: 7px;
  border: 1px solid rgba(255, 255, 255, 0.045);
  border-radius: 7px;
  background: var(--chip-bg);
}

.metric-card span {
  display: block;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.2;
}

.metric-card strong {
  display: block;
  margin-top: 6px;
  color: var(--text);
  font-size: 17px;
  line-height: 1;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.bar-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bar-row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 7px;
  color: var(--text-dim);
  font-size: 11px;
}

.bar-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-row i {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chip-border);
}

.bar-row b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
}

.bar-row em {
  color: var(--text-muted);
  font-style: normal;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.source-row {
  min-height: 30px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.045);
  color: var(--text-dim);
  font-size: 12px;
}

.source-row:last-child {
  border-bottom: 0;
}

.source-row strong {
  min-width: 0;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-row span {
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.keyword-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.keyword {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.2;
}

.keyword.featured {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.08);
}

.quality-section {
  display: none;
  padding-top: 2px;
}

.quality-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.quality-card {
  min-width: 0;
  min-height: 54px;
  padding: 8px;
  border: 1px solid var(--chip-border);
  border-radius: 7px;
  background: var(--chip-bg);
}

.quality-card span {
  display: block;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.2;
}

.quality-card strong {
  display: inline-block;
  margin-top: 6px;
  color: var(--text);
  font-size: 18px;
  line-height: 1;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
}

.quality-card em {
  margin-left: 5px;
  color: var(--text-dim);
  font-style: normal;
  font-size: 10px;
}

.quality-notes {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}

.quality-notes span {
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text-dim);
  background: var(--panel-bg-hover);
  font-size: 11px;
  line-height: 1.42;
}

.empty-state,
.empty-mini {
  border: 1px dashed var(--border-mid);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.empty-state {
  min-height: 180px;
}

.empty-mini {
  min-height: 90px;
}

.empty-mini.compact {
  min-height: 54px;
}

@media (max-width: 1120px) {
  .hot-layout {
    grid-template-columns: 1fr;
  }

  .info-panel {
    min-height: 260px;
  }
}

@media (max-width: 760px) {
  .daily-hot-module {
    overflow-y: auto;
  }

  .hot-topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .filter-strip {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .filter-actions {
    justify-content: flex-start;
  }

  .hot-card {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .card-side {
    grid-column: 1 / -1;
    align-items: flex-start;
  }
}

.daily-hot-module {
  --hot-accent: #f59e0b;
  --hot-accent-soft: rgba(245, 158, 11, 0.12);
  --hot-green: #22c55e;
  gap: 12px;
}

.hot-topbar {
  margin: 0;
  flex-shrink: 0;
}

.hot-summary {
  align-items: center;
}

.hot-summary .module-page-pill {
  height: 30px;
  color: var(--text-dim);
}

.filter-strip {
  grid-template-columns: minmax(150px, 190px) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: stretch;
  min-height: 64px;
  padding: 10px;
  flex-shrink: 0;
}

.filter-fields {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.filter-select {
  height: 34px;
  padding: 6px 10px;
  font-size: 12px;
}

.hot-layout {
  grid-template-columns: minmax(580px, 1fr) 320px;
  gap: 14px;
}

.hot-feed {
  gap: 8px;
  padding: 10px;
  background: var(--panel-bg-soft);
}

.feed-head {
  min-height: 38px;
  padding: 2px 4px 8px;
}

.feed-head div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feed-head strong {
  font-size: 15px;
  line-height: 1.2;
}

.feed-head span {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.2;
}

.feed-head em {
  color: var(--text-dim);
  font-size: 12px;
  font-style: normal;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.hot-card {
  min-height: 90px;
  padding: 10px;
  grid-template-columns: 36px minmax(0, 1fr) minmax(140px, 170px);
  gap: 10px;
  align-items: start;
  border-color: var(--border);
  background: var(--panel-bg);
  transition: border-color 0.16s, background 0.16s, transform 0.16s;
}

.hot-card.featured {
  border-color: rgba(245, 158, 11, 0.34);
  background: linear-gradient(180deg, var(--hot-accent-soft), var(--panel-bg) 58%);
}

.hot-card:hover {
  background: var(--panel-bg-hover);
  transform: translateY(-1px);
}

.rank-cell {
  display: flex;
  justify-content: center;
}

.rank-box {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--chip-bg);
  color: var(--text);
  border: 1px solid var(--chip-border);
  font-size: 13px;
}

.hot-card.featured .rank-box {
  background: rgba(245, 158, 11, 0.16);
  border-color: rgba(245, 158, 11, 0.42);
  color: var(--hot-accent);
}

.card-main {
  gap: 7px;
}

.card-title-row {
  min-width: 0;
}

.hot-title {
  font-size: 14px;
  line-height: 1.42;
}

.snippet {
  color: var(--text-muted);
  line-height: 1.5;
}

.meta-row,
.tag-row {
  gap: 5px;
}

.meta-row span {
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--chip-bg);
  line-height: 1.35;
}

.tag-row span {
  padding: 2px 7px;
  border-radius: 6px;
  color: var(--text-dim);
}

.card-side {
  height: 100%;
  align-items: stretch;
  justify-content: space-between;
  gap: 10px;
}

.heat-meter {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}

.heat-meter span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.heat-meter strong {
  color: var(--text);
  font-size: 15px;
  line-height: 1;
}

.heat-meter i {
  grid-column: 1 / -1;
  width: 100%;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chip-border);
}

.heat-meter b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--hot-accent), var(--hot-green));
}

.card-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 7px;
}

.card-actions .btn-primary {
  display: inline-flex;
}

.card-actions .btn {
  width: 100%;
  min-height: 32px;
  padding: 0 8px;
}

.daily-hot-module .btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.info-panel {
  gap: 12px;
  padding: 12px;
  background: var(--panel-bg-soft);
}

.side-head {
  min-height: 42px;
  padding: 0 2px 10px;
  align-items: center;
}

.side-head strong {
  font-size: 14px;
}

.side-section {
  padding: 0 0 12px;
  border: 0;
  border-radius: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
}

.side-section:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.section-title {
  margin-bottom: 10px;
  font-size: 13px;
}

.metric-grid {
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--chip-bg);
}

.metric-card {
  min-height: 58px;
  padding: 10px;
  border: 0;
  border-right: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
}

.metric-card:last-child {
  border-right: 0;
}

.metric-card strong {
  margin-top: 8px;
  font-size: 20px;
}

.bar-row {
  grid-template-columns: 68px minmax(0, 1fr) 30px;
  min-height: 24px;
}

.bar-row i {
  height: 6px;
}

.bar-row b {
  background: linear-gradient(90deg, var(--hot-accent), var(--primary));
}

.source-row {
  min-height: 34px;
}

.keyword {
  border-radius: 6px;
  color: var(--text-dim);
}

.keyword.featured {
  color: var(--hot-accent);
  background: var(--hot-accent-soft);
}

/* readability pass */
.daily-hot-module .filter-strip,
.daily-hot-module .hot-feed,
.daily-hot-module .info-panel {
  border: 1px solid var(--card-border, var(--border));
  background: var(--card-bg, var(--panel-bg));
  box-shadow: var(--shadow);
}

.daily-hot-module .filter-strip {
  border-radius: var(--radius);
}

.daily-hot-module .hot-feed,
.daily-hot-module .info-panel {
  border-radius: 12px;
}

.daily-hot-module .hot-card {
  border-color: var(--card-border, var(--border));
  background:
    linear-gradient(180deg, var(--card-bg, var(--panel-bg)), var(--panel-bg-soft));
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.035);
}

.daily-hot-module .hot-card:hover {
  border-color: var(--card-border-hover, var(--border-mid));
  background: var(--card-bg-hover, var(--panel-bg-hover));
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.16);
}

.daily-hot-module .hot-title {
  color: var(--text);
  font-weight: 760;
}

.daily-hot-module .snippet {
  color: var(--text-dim);
}

.daily-hot-module .meta-row span,
.daily-hot-module .tag-row span,
.daily-hot-module .keyword,
.daily-hot-module .source-row {
  border: 1px solid var(--chip-border);
  background: var(--row-bg, var(--chip-bg));
}

.daily-hot-module .metric-grid,
.daily-hot-module .side-section {
  border-color: var(--divider, var(--border));
}

:root[data-ui-style="apple"] .daily-hot-module .hot-card.featured {
  border-color: rgba(154, 103, 0, 0.32);
  background: linear-gradient(180deg, rgba(255, 248, 225, 0.88), var(--card-bg) 62%);
}

:root[data-ui-style="apple"] .daily-hot-module .rank-box,
:root[data-ui-style="apple"] .daily-hot-module .meta-row span,
:root[data-ui-style="apple"] .daily-hot-module .tag-row span {
  background: rgba(255, 255, 255, 0.74);
}

@media (max-width: 1120px) {
  .daily-hot-module {
    overflow-y: auto;
  }

  .hot-layout {
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .hot-feed,
  .info-panel {
    overflow: visible;
  }

  .hot-feed {
    min-height: 420px;
  }
}

@media (max-width: 900px) {
  .filter-strip {
    grid-template-columns: 1fr;
  }

  .filter-context {
    padding: 0;
  }

  .filter-fields {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .filter-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

@media (max-width: 760px) {
  .hot-summary {
    justify-content: flex-start;
  }

  .filter-fields {
    grid-template-columns: 1fr;
  }

  .filter-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .filter-actions .btn {
    width: 100%;
  }

  .hot-card {
    grid-template-columns: 34px minmax(0, 1fr);
    grid-template-areas:
      "rank main"
      "rank side";
    min-height: 0;
    gap: 8px 10px;
  }

  .rank-cell {
    grid-area: rank;
    justify-content: flex-start;
  }

  .rank-box {
    width: 30px;
    height: 30px;
  }

  .card-main {
    grid-area: main;
  }

  .card-side {
    grid-area: side;
    height: auto;
    align-items: stretch;
  }

  .heat-meter {
    grid-template-columns: auto auto minmax(72px, 1fr);
  }

  .heat-meter i {
    grid-column: auto;
  }

  .card-actions {
    grid-template-columns: 1fr 1fr;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .metric-card {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .metric-card:last-child {
    border-bottom: 0;
  }
}
</style>
