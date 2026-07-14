<template>
  <div ref="dashboardRootRef" class="account-data-module">
    <header class="board-top">
      <div class="board-title">
        <i></i>
        <strong>自孵化号数据统计</strong>
      </div>
      <div class="board-actions">
        <div class="view-tabs" role="tablist" aria-label="看板视角">
          <button
            v-for="item in viewOptions"
            :key="item.id"
            type="button"
            class="view-tab"
            :class="{ active: activeView === item.id }"
            @click="activeView = item.id">
            {{ item.label }}
          </button>
        </div>
        <div class="platform-tabs" role="tablist" aria-label="平台筛选">
          <button
            v-for="platform in platformOptions"
            :key="platform.id"
            type="button"
            class="platform-tab"
            :class="[platformToneClass(platform.id), { active: activePlatform === platform.id, muted: platform.placeholder }]"
            @click="activePlatform = platform.id">
            <i>
              <img v-if="platformIcon(platform.id)" :src="platformIcon(platform.id)" alt="" />
              <span v-else>{{ platformShortLabel(platform.id) }}</span>
            </i>
            <span>{{ platform.label }}</span>
          </button>
        </div>
      </div>
    </header>

    <section class="filter-row">
      <select v-model="activeGroup" class="inp compact-select">
        <option value="all">全部小组</option>
        <option v-for="group in groupOptions" :key="group" :value="group">{{ group }}</option>
      </select>
      <input v-model.trim="keyword" class="inp compact-search" placeholder="搜索账号" />
      <div class="dimension-switch">
        <span>排行维度</span>
        <div class="dimension-tabs" role="tablist" aria-label="展示维度">
          <button
            v-for="item in dimensionOptions"
            :key="item.id"
            type="button"
            class="dimension-tab"
            :class="{ active: activeDimension === item.id }"
            @click="activeDimension = item.id">
            {{ item.label }}
          </button>
        </div>
      </div>
      <div class="filter-range">
        <span>全局口径</span>
        <div class="range-tabs" role="tablist" aria-label="全局时间口径">
          <button
            v-for="range in rangeOptions"
            :key="range.id"
            type="button"
            class="range-tab"
            :class="{ active: activeRange === range.id }"
            @click="activeRange = range.id">
            {{ range.label }}
          </button>
        </div>
      </div>
      <div class="history-period-controls">
        <label class="history-period-toggle">
          <input v-model="historyPeriodEnabled" type="checkbox">
          <span>历史月份</span>
        </label>
        <select v-model.number="selectedHistoryYear" class="inp history-period-select" :disabled="!historyPeriodEnabled">
          <option v-for="year in historyYearOptions" :key="year" :value="year">{{ year }}年</option>
        </select>
        <select v-model.number="selectedHistoryMonth" class="inp history-period-select" :disabled="!historyPeriodEnabled">
          <option v-for="month in historyMonthOptions" :key="month" :value="month">{{ month }}月</option>
        </select>
      </div>
      <button type="button" class="dashboard-refresh-btn" :disabled="dashboardLoading" @click="loadRealDashboard({ forceRefresh: true })">
        {{ dashboardLoading ? (dashboardUsingReal ? '后台更新中' : '读取中') : '刷新数据' }}
      </button>
      <span class="snapshot-note">{{ dashboardStatusText }} · 当前 {{ filteredAccounts.length }} 个账号</span>
    </section>

    <section v-if="dashboardError" class="dashboard-error-state">
      <div>
        <strong>数据看板读取失败</strong>
        <span>{{ dashboardError }}</span>
      </div>
      <button type="button" class="dashboard-refresh-btn" :disabled="dashboardLoading" @click="loadRealDashboard({ forceRefresh: true })">
        重试
      </button>
    </section>

    <section v-if="dashboardUsingReal && activeView === 'overview'" class="overview-layout">
      <section class="kpi-grid" aria-label="核心数据">
        <article
          v-for="item in kpiCards"
          :key="item.key"
          class="kpi-card"
          :style="{ '--metric-color': item.color }">
          <div>
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <em>{{ item.note }}</em>
          </div>
          <i>{{ item.icon }}</i>
        </article>
      </section>

      <section class="wide-chart-stack" aria-label="总览趋势补充">
        <article class="wide-chart-card views-trend-card">
          <div class="wide-chart-head">
            <div>
              <strong>播放排行榜</strong>
              <span>按{{ activeDimensionMeta.label }}维度展示播放排行，支持总览和单平台切换</span>
            </div>
            <div class="wide-head-actions">
              <em>{{ activeRangeMeta.label }}口径 · {{ playRankRows.length }} {{ activeDimensionMeta.unit }}</em>
              <div class="rank-platform-tabs" role="tablist" aria-label="播放排行平台">
                <button
                  v-for="platform in playRankPlatformOptions"
                  :key="platform.id"
                  type="button"
                  :class="{ active: playRankPlatform === platform.id }"
                  @click="playRankPlatform = platform.id">
                  {{ platform.label }}
                </button>
              </div>
            </div>
          </div>
          <div class="play-rank-showcase" v-if="overviewPlayRankRows.length">
            <article class="play-rank-hero">
              <span>#1</span>
              <div>
                <strong>{{ overviewPlayRankRows[0].account }}</strong>
                <em>{{ overviewPlayRankRows[0].groupName }} · {{ overviewPlayRankRows[0].platformLabel }}</em>
              </div>
              <b>{{ formatCompactNumber(overviewPlayRankRows[0].value) }}</b>
              <small>占比 {{ overviewPlayRankRows[0].share }}%</small>
            </article>
            <div class="play-rank-tile-grid">
              <article v-for="item in overviewPlayRankRows.slice(1, 5)" :key="item.id" class="play-rank-tile">
                <span>#{{ item.rank }}</span>
                <strong>{{ item.account }}</strong>
                <em>{{ item.groupName }} · {{ item.platformLabel }}</em>
                <b>{{ formatCompactNumber(item.value) }}</b>
              </article>
            </div>
            <div class="play-rank-chip-grid">
              <span v-for="item in overviewPlayRankRows.slice(5, 12)" :key="item.id" class="play-rank-chip">
                <b>#{{ item.rank }}</b>
                <em>{{ item.account }}</em>
                <strong>{{ formatCompactNumber(item.value) }}</strong>
              </span>
            </div>
          </div>
        </article>

        <div class="post-insight-stack">
          <article class="wide-chart-card posts-trend-card">
            <div class="wide-chart-head">
              <div>
                <strong>发文量统计</strong>
                <span>默认按日统计，右侧可切换为按周维度</span>
              </div>
              <div class="wide-head-actions">
                <em>{{ postScopeLabel }} {{ formatCompactNumber(displayPostTotal) }} 条<span v-if="postRecordTotal !== displayPostTotal"> · 平台记录 {{ formatCompactNumber(postRecordTotal) }} 条</span></em>
                <div class="wide-granularity-tabs" role="tablist" aria-label="发文量维度">
                  <button
                    v-for="option in postGranularityOptions"
                    :key="option.id"
                    type="button"
                    :class="{ active: postGranularity === option.id }"
                    @click="postGranularity = option.id">
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </div>
            <div class="wide-bar-chart" :class="{ weekly: postGranularity === 'week' }">
              <button
                v-for="bar in overviewPostBars"
                :key="bar.label"
                type="button"
                class="wide-bar-item"
                :class="{ empty: !bar.value }"
                :style="{ '--bar-height': `${bar.height}%` }"
                :title="bar.tooltip"
                @click="openPostBarModal(bar)"
                @keydown.enter.prevent="openPostBarModal(bar)">
                <strong>{{ bar.value }}</strong>
                <i></i>
                <span>{{ bar.label }}</span>
              </button>
            </div>
          </article>

          <article class="post-rhythm-card">
            <div class="post-rhythm-head">
              <div>
                <strong>发文节奏小结</strong>
                <span>{{ postGranularity === 'week' ? '按周看火力分布' : '按日看发布波峰' }}</span>
              </div>
              <em>{{ activeRangeMeta.label }}口径</em>
            </div>
            <div class="post-rhythm-grid">
              <span v-for="item in postRhythmCards" :key="item.key">
                <em>{{ item.label }}</em>
                <strong>{{ item.value }}</strong>
                <small>{{ item.note }}</small>
              </span>
            </div>
            <div class="post-hot-days">
              <span v-for="item in postPeakRows.slice(0, 3)" :key="item.label">
                <b>{{ item.label }}</b>
                <i><u :style="{ width: item.width + '%' }"></u></i>
                <em>{{ item.value }}篇</em>
              </span>
            </div>
          </article>
        </div>
      </section>

      <article class="recent-post-card">
        <div class="recent-post-head">
          <div>
            <strong>近期发布内容</strong>
            <span>按发布时间倒序展示当前筛选下最近发出的内容</span>
          </div>
          <div class="recent-post-head-actions">
            <em>{{ displayPostWorks.length }} 条</em>
            <button type="button" class="chart-more-btn recent-post-more" @click="openRecentPostsMore">MORE›</button>
          </div>
        </div>
        <div v-if="recentPostRows.length" class="recent-post-list">
          <div
            v-for="item in recentPostRows"
            :key="item.id"
            class="recent-post-row"
            :class="contentToneClass(item)"
            :style="{ '--post-platform-color': platformAccentColor(item.platform), '--post-kind-color': contentToneColor(item) }">
            <i :class="['platform-badge', platformToneClass(item.platform)]">
              <img v-if="platformIcon(item.platform)" :src="platformIcon(item.platform)" alt="" />
              <span v-else>{{ platformShortLabel(item.platform) }}</span>
            </i>
            <div class="recent-post-title">
              <strong :title="item.title">{{ item.title }}</strong>
              <small>
                <span>{{ item.account }} · {{ item.groupName }} · {{ item.platformLabel || item.platform }}</span>
                <b class="content-kind-pill" :class="contentToneClass(item)" :title="item.businessReason || item.contentType || '视频'">{{ contentToneLabel(item) }}</b>
              </small>
            </div>
            <strong class="recent-post-hot">{{ item.level || '热度' }}</strong>
            <div class="recent-post-meta">
              <span>时 {{ formatDashboardTime(item.publishAt || item.publishDate) }}</span>
              <b class="metric-text views">播 {{ formatCompactNumber(item.views) }}</b>
              <b class="metric-text likes">赞 {{ formatCompactNumber(item.likes) }}</b>
              <b>评 {{ formatCompactNumber(item.comments) }}</b>
              <em>热 {{ formatCompactNumber(item.hotIndex) }}</em>
            </div>
          </div>
        </div>
        <div v-else class="recent-post-empty">
          当前筛选下还没有可展示的近期发布内容
        </div>
      </article>

      <section class="analysis-grid">
        <article class="account-cosmos-card">
          <div class="panel-head">
            <strong>账号增长星图</strong>
            <span>{{ activeDimensionMeta.label }}维度 · 播放、点赞、粉丝变化合成能量</span>
          </div>
          <div class="cosmos-stage" v-if="constellationRows.length">
            <div class="cosmos-core">
              <span>增长中心</span>
              <strong>{{ constellationRows[0].account }}</strong>
              <em>{{ constellationRows[0].tag }} · {{ constellationRows[0].valueLabel }}</em>
            </div>
            <span
              v-for="node in constellationRows"
              :key="node.id"
              class="cosmos-node"
              :class="{ hot: node.rank <= 3 }"
              :style="{ '--x': `${node.x}%`, '--y': `${node.y}%`, '--size': `${node.size}px`, '--tone': node.color }">
              <b>#{{ node.rank }}</b>
              <strong>{{ node.account }}</strong>
              <em>{{ node.valueLabel }}</em>
              <small>{{ node.tag }}</small>
            </span>
          </div>
          <div class="cosmos-legend">
            <span><i class="views"></i>节点大小看增长能量</span>
            <span><i class="likes"></i>前三名高亮</span>
            <span><i class="fans"></i>{{ activeRangeMeta.label }}口径</span>
          </div>
        </article>

        <main class="chart-board">
          <article
            v-for="panel in chartPanels"
            :key="panel.key"
            class="chart-card"
            :style="{ '--metric-color': panel.color }">
            <div class="chart-head">
              <strong>{{ panel.title }}</strong>
              <div class="chart-head-actions">
                <div class="metric-mode-tabs" role="tablist" :aria-label="`${panel.title}维度`">
                  <button
                    v-for="option in metricModeOptions"
                    :key="option.id"
                    type="button"
                    :class="{ active: metricDisplayModes[panel.key] === option.id }"
                    @click="metricDisplayModes[panel.key] = option.id">
                    {{ option.label }}
                  </button>
                </div>
                <button type="button" class="chart-more-btn" @click="openChartMore(panel)">MORE›</button>
              </div>
            </div>
            <div class="chart-legend">
              <i></i>
              <span>{{ panel.legend }}</span>
            </div>
            <div class="chart-stat-strip">
              <span v-for="stat in panel.stats" :key="stat.label">
                <em>{{ stat.label }}</em>
                <b>{{ stat.value }}</b>
              </span>
            </div>
            <div class="chart-detail-list">
              <div v-for="item in panel.rows" :key="`${panel.key}-${item.id}-detail`" class="chart-detail-row">
                <span>#{{ item.rank }}</span>
                <strong :title="item.title || item.account">{{ item.displayName || item.account }}</strong>
                <em :title="item.subtitle || item.groupName">{{ item.subtitle || item.groupName }}</em>
                <i><u :style="{ width: item.height + '%' }"></u></i>
                <b>{{ panel.format(item.rawValue) }}</b>
                <small>{{ item.share }}%</small>
              </div>
            </div>
          </article>
        </main>
      </section>

      <article class="detail-card">
        <div class="panel-head">
          <strong>账号明细</strong>
          <span>{{ detailMetricLabel }} · {{ detailRows.length }} 个账号</span>
        </div>
        <div class="account-table">
          <div class="account-table-head">
            <span>账号 / 类型</span>
            <span>小组</span>
            <span>平台</span>
            <span>总播放</span>
            <span>昨日播放</span>
            <span>昨日点赞</span>
            <span>完播率</span>
            <span>类型</span>
            <span>粉丝变化</span>
          </div>
          <div v-for="item in detailRows" :key="item.id" class="account-table-row">
            <strong>{{ item.account }}</strong>
            <span>{{ item.groupName }}</span>
            <span class="platform-cell">
              <i :class="['platform-badge', platformToneClass(item.platform)]">
                <img v-if="platformIcon(item.platform)" :src="platformIcon(item.platform)" alt="" />
                <span v-else>{{ platformShortLabel(item.platform) }}</span>
              </i>
              <b>{{ item.platformLabel }}</b>
            </span>
            <span>{{ formatCompactNumber(item.totalViews) }}</span>
            <span class="metric-text views">{{ formatCompactNumber(item.yesterdayViews) }}</span>
            <span class="metric-text likes">{{ formatCompactNumber(item.yesterdayLikes) }}</span>
            <span>{{ completionRate(item) }}%</span>
            <span>{{ contentType(item) }}</span>
            <em :class="deltaClass(item.followerDelta)">{{ signedDeltaText(item.followerDelta) }}</em>
          </div>
        </div>
      </article>
    </section>

    <section v-else-if="dashboardUsingReal && activeView === 'single'" class="single-layout">
      <aside class="single-profile-card">
        <div class="panel-head">
          <strong>单账号维度</strong>
          <span>集中看一个账号</span>
        </div>
        <div class="single-filter-grid">
          <label>
            <span>组别</span>
            <select v-model="singleGroup" class="inp account-select">
              <option value="all">全部小组</option>
              <option v-for="group in singleGroupOptions" :key="group" :value="group">{{ group }}</option>
            </select>
          </label>
          <label>
            <span>平台</span>
            <select v-model="singlePlatform" class="inp account-select">
              <option v-for="platform in platformOptions" :key="platform.id" :value="platform.id">
                {{ platform.label }}
              </option>
            </select>
          </label>
          <label>
            <span>账号</span>
            <select v-model="selectedAccountId" class="inp account-select" :disabled="!singleFilteredAccounts.length">
              <option v-for="account in singleFilteredAccounts" :key="account.id" :value="account.id">
                {{ account.account }}
              </option>
            </select>
          </label>
        </div>
        <div class="single-filter-meta">
          <span>平台：{{ singlePlatformLabel }}</span>
          <span>小组：{{ singleGroupLabel }}</span>
          <span>{{ singleFilteredAccounts.length }} 个账号</span>
          <span v-if="selectedAccount">采集：{{ formatDashboardTime(selectedAccount.lastCollectedAt) }}</span>
          <span v-if="selectedAccount">最近发文：{{ selectedAccount.latestWorkDate || '暂无' }}</span>
        </div>
        <div v-if="selectedAccount" class="single-profile">
          <strong>{{ selectedAccount.account }}</strong>
          <span>
            {{ selectedAccount.groupName }} /
            <i :class="['platform-badge', platformToneClass(selectedAccount.platform)]">
              <img v-if="platformIcon(selectedAccount.platform)" :src="platformIcon(selectedAccount.platform)" alt="" />
              <span v-else>{{ platformShortLabel(selectedAccount.platform) }}</span>
            </i>
            {{ selectedAccount.platformLabel }}
          </span>
          <em>{{ selectedAccount.profile || '暂未绑定 profile' }}</em>
        </div>
        <div v-if="selectedAccount" class="single-kpis">
          <span><b>{{ formatCompactNumber(selectedAccount.totalViews) }}</b>总播放</span>
          <span><b>{{ formatCompactNumber(selectedAccount.totalLikes) }}</b>总点赞</span>
          <span><b :class="deltaClass(selectedAccount.followerDelta)">{{ signedDeltaText(selectedAccount.followerDelta) }}</b>粉丝变化</span>
        </div>
      </aside>

      <main class="single-main">
        <article class="single-chart-card">
          <div class="panel-head">
            <strong>单账号历史趋势</strong>
            <span>播放、点赞、粉丝三条指标同屏展示</span>
          </div>
          <div class="single-chart-stack">
            <section
              v-for="metric in singleTrendMetrics"
              :key="metric.key"
              class="single-chart-lane"
              :style="{ '--metric-color': metric.color }">
              <div class="lane-copy">
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value }}</strong>
                <em>{{ metric.note }}</em>
              </div>
              <svg viewBox="0 0 520 112" preserveAspectRatio="none" role="img" :aria-label="metric.label">
                <line v-for="tick in chartTicks" :key="tick" x1="0" x2="520" :y1="tick" :y2="tick" class="chart-grid-line" />
                <polyline :points="metric.points" />
              </svg>
            </section>
          </div>
        </article>

        <article class="single-history-card">
          <div class="panel-head">
            <strong>视频明细</strong>
            <span>展示当前选中账号的全部作品</span>
          </div>
          <div v-if="selectedAccountWorks.length" class="single-work-table">
            <div class="single-work-head">
              <span>作品</span>
              <span>发布时间</span>
              <span>播放</span>
              <span>点赞</span>
              <span>评论</span>
              <span>完播</span>
              <span>指数</span>
            </div>
            <div
              v-for="item in selectedAccountWorks"
              :key="item.id"
              class="single-work-row"
              :class="contentToneClass(item)">
              <div class="single-work-title">
                <strong>{{ item.title }}</strong>
                <small>
                  <b class="content-kind-pill" :class="contentToneClass(item)" :title="item.businessReason || item.contentType || '视频'">{{ contentToneLabel(item) }}</b>
                </small>
              </div>
              <span>{{ item.publishAt || item.publishDate || '-' }}</span>
              <strong class="metric-text views">{{ formatCompactNumber(item.views) }}</strong>
              <strong class="metric-text likes">{{ formatCompactNumber(item.likes) }}</strong>
              <span>{{ formatCompactNumber(item.comments) }}</span>
              <span>{{ Number(item.completionRate) || 0 }}%</span>
              <em>{{ formatCompactNumber(item.hotIndex) }}</em>
            </div>
          </div>
          <div v-else class="single-empty-state">
            当前账号还没有可展示的真实作品数据
          </div>
        </article>
      </main>
    </section>

    <section v-else-if="dashboardUsingReal && activeView === 'battle'" class="battle-layout">
      <section class="battle-summary-grid" aria-label="战力分析概览">
        <article
          v-for="item in battleSummaryCards"
          :key="item.key"
          class="battle-summary-card"
          :style="{ '--metric-color': item.color }">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <em>{{ item.note }}</em>
        </article>
      </section>

      <section class="battle-main-grid">
        <article class="battle-tree-card">
          <div class="panel-head">
            <strong>小组战力树</strong>
            <span>商单播放 1.5x / 日常播放 1x，叠加点赞、粉丝、发文、完播</span>
          </div>
          <div class="battle-tree" v-if="battleTreeRows.length">
            <div class="tree-root">
              <span>战力树主干</span>
              <strong>{{ battleChampion?.groupName || '等待数据' }}</strong>
              <em>{{ battleChampion ? `当前最能打 · 指数 ${battleChampion.score}` : '等待真实数据' }}</em>
              <b>{{ battleTreeRows[0]?.meme || '开局先看基本盘' }}</b>
            </div>
            <div class="tree-branches">
              <div
                v-for="(group, index) in battleTreeRows"
                :key="group.groupName"
                class="tree-branch"
                :class="{ champion: index === 0 }"
                :style="{ '--branch-color': group.color }">
                <i class="tree-branch-line"></i>
                <div class="tree-group-node">
                  <span>#{{ index + 1 }} · {{ group.meme }}</span>
                  <strong>{{ group.groupName }}</strong>
                  <em>{{ group.accountCount }} 个平台账号 · 完播 {{ group.completionRate }}% · {{ group.score }} 战力</em>
                </div>
                <div class="tree-leaves">
                  <span
                    v-for="leaf in group.leaves"
                    :key="leaf.id"
                    class="tree-leaf"
                    :class="leaf.typeClass"
                    :style="{ '--leaf-width': leaf.width + '%' }">
                    <b>{{ leaf.account }} · {{ leaf.platformLabel }}</b>
                    <em>{{ leaf.tag }}</em>
                    <i>{{ leaf.score }}</i>
                    <u></u>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article class="battle-chart-card fan-trend-large">
          <div class="panel-head">
            <strong>粉丝变化折线</strong>
            <span>按小组聚合最近 8 次快照</span>
          </div>
          <svg class="fan-line-chart" viewBox="0 0 520 172" preserveAspectRatio="none" role="img" aria-label="小组粉丝变化折线">
            <line v-for="tick in lineTicks" :key="tick" x1="0" x2="520" :y1="tick" :y2="tick" class="chart-grid-line" />
            <polyline
              v-for="line in groupFanTrendLines"
              :key="line.groupName"
              :points="line.points"
              :style="{ stroke: line.color }" />
          </svg>
          <div class="line-legend">
            <span v-for="line in groupFanTrendLines" :key="line.groupName">
              <i :style="{ background: line.color }"></i>{{ line.groupName }}
            </span>
          </div>
        </article>
      </section>

      <section class="battle-sub-grid">
        <article class="battle-chart-card">
          <div class="panel-head">
            <strong>发文量统计</strong>
            <span>商单 / 日常结构</span>
          </div>
          <div class="post-stack tall">
            <div v-for="row in postStructureRows" :key="row.groupName" class="post-stack-row">
              <b>{{ row.groupName }}</b>
              <div>
                <i class="business" :style="{ width: row.businessWidth + '%' }"></i>
                <i class="daily" :style="{ width: row.dailyWidth + '%' }"></i>
              </div>
              <span>{{ row.total }}篇</span>
            </div>
          </div>
          <div class="stack-legend">
            <span><i class="business"></i>商单</span>
            <span><i class="daily"></i>日常</span>
          </div>
        </article>

        <article class="battle-chart-card">
          <div class="panel-head">
            <strong>完播率视角</strong>
            <span>账号 Top 5</span>
          </div>
          <div class="completion-list large">
            <div v-for="item in completionRows" :key="item.id" class="completion-row">
              <b>{{ item.account }} · {{ item.platformLabel || item.platform }}</b>
              <em>{{ item.groupName }}</em>
              <strong>{{ item.completionRate }}%</strong>
              <i><u :style="{ width: item.completionRate + '%' }"></u></i>
            </div>
          </div>
        </article>
      </section>
    </section>

    <section v-else-if="dashboardUsingReal && activeView === 'updatePlan'" class="update-plan-layout">
      <section class="update-summary-grid" aria-label="更新计划概览">
        <article
          v-for="item in updatePlanSummaryCards"
          :key="item.key"
          class="update-summary-card"
          :style="{ '--metric-color': item.color }">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <em>{{ item.note }}</em>
        </article>
      </section>

      <section class="update-plan-main-grid">
        <article class="update-plan-progress-card">
          <div class="panel-head">
            <strong>月度更新计划</strong>
            <span>按账号月目标量追踪本月发文完成度</span>
          </div>
          <div class="plan-progress-hero">
            <div class="plan-progress-orb" :style="{ '--plan-rate': `${updatePlanSummary.completionRate * 3.6}deg` }">
              <strong>{{ updatePlanSummary.completionRate }}%</strong>
              <span>完成率</span>
            </div>
            <div class="plan-progress-copy">
              <span>{{ activePlatformLabel }} · {{ activeGroupLabel }}</span>
              <strong>{{ updatePlanSummary.completed }} / {{ updatePlanSummary.target }} 条</strong>
              <em>本月还差 {{ updatePlanSummary.remaining }} 条，按长视频/短视频口径盯进度。</em>
              <div class="plan-progress-bar">
                <u :style="{ width: updatePlanSummary.completionRate + '%' }"></u>
              </div>
            </div>
          </div>
        </article>

        <article class="update-risk-card">
          <div class="panel-head">
            <strong>需要优先跟进</strong>
            <span>按缺口和接入状态排序</span>
          </div>
          <div class="update-risk-list" v-if="updateRiskRows.length">
            <div v-for="row in updateRiskRows" :key="row.id" class="update-risk-row">
              <span :class="['plan-status', row.statusClass]">{{ row.statusLabel }}</span>
              <div>
                <strong>{{ row.account }}</strong>
                <em>{{ row.groupName }} · {{ row.owner || '未填负责人' }}</em>
              </div>
              <b>差 {{ row.gap }} 条</b>
            </div>
          </div>
          <div v-else class="plan-empty">当前筛选范围没有滞后账号。</div>
        </article>
      </section>

      <article class="update-plan-table-card">
        <div class="panel-head">
          <strong>账号更新明细</strong>
          <span>{{ updatePlanDisplayRows.length }} 个计划账号 · 1-3min 计入长视频</span>
        </div>
        <div class="update-plan-table">
          <div class="update-plan-head">
            <span>账号</span>
            <span>小组 / 平台</span>
            <span>负责人</span>
            <span>目标</span>
            <span>总条数</span>
            <span>公开</span>
            <span>隐藏</span>
            <span>长视频</span>
            <span>短视频</span>
            <span>缺口</span>
            <span>进度</span>
            <span>状态</span>
            <span>备注</span>
          </div>
          <div v-for="row in updatePlanDisplayRows" :key="row.id" class="update-plan-row">
            <strong>{{ row.account }}</strong>
            <span>{{ row.groupName }} · {{ row.platformLabel }}</span>
            <span>{{ row.owner || '-' }}</span>
            <b>{{ updatePlanTargetDisplay(row) }}</b>
            <b>{{ row.completed }}</b>
            <span>{{ row.visibleCompleted }}</span>
            <span>{{ updatePlanHiddenDisplay(row) }}</span>
            <span>{{ row.longCompleted }}/{{ row.longTarget }}</span>
            <span>{{ row.shortCompleted }}/{{ row.shortTarget }}</span>
            <em>{{ row.gap }}</em>
            <span class="plan-inline-progress">
              <i><u :style="{ width: row.progress + '%' }"></u></i>
              <b>{{ row.progress }}%</b>
            </span>
            <span :class="['plan-status', row.statusClass]">{{ row.statusLabel }}</span>
            <small>{{ row.contextNote }}</small>
          </div>
        </div>
      </article>
    </section>

    <section v-else class="hot-video-layout">
      <section class="hot-summary-grid" aria-label="爆款视频总览">
        <article
          v-for="item in hotVideoSummaryCards"
          :key="item.key"
          class="hot-summary-card"
          :style="{ '--metric-color': item.color }">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <em>{{ item.note }}</em>
        </article>
      </section>

      <section class="hot-main-grid">
        <article class="hot-hero-card" v-if="topHotVideo">
          <div class="panel-head">
            <strong>本期首位爆款</strong>
            <span>
              {{ topHotVideo.account }} · {{ topHotVideo.groupName }} ·
              <i :class="['platform-badge', platformToneClass(topHotVideo.platform)]">
                <img v-if="platformIcon(topHotVideo.platform)" :src="platformIcon(topHotVideo.platform)" alt="" />
                <span v-else>{{ platformShortLabel(topHotVideo.platform) }}</span>
              </i>
              {{ topHotVideo.platformLabel }}
            </span>
          </div>
          <div class="hot-hero">
            <i>{{ topHotVideo.level }}</i>
            <div>
              <strong>{{ topHotVideo.title }}</strong>
              <span>{{ topHotVideo.contentType }} · {{ topHotVideo.publishAt }} · 爆款指数 {{ topHotVideo.hotIndex }}</span>
            </div>
          </div>
          <div class="hot-hero-metrics">
            <span><b>{{ formatCompactNumber(topHotVideo.views) }}</b>播放</span>
            <span><b>{{ formatCompactNumber(topHotVideo.likes) }}</b>点赞</span>
            <span><b>{{ topHotVideo.completionRate }}%</b>完播</span>
            <span><b>{{ topHotVideo.interactionRate }}%</b>互动率</span>
          </div>
          <div class="hot-score-bar">
            <u :style="{ width: topHotVideo.width + '%' }"></u>
          </div>
        </article>

        <article class="hot-factor-card">
          <div class="panel-head">
            <strong>爆款拆解</strong>
            <span>播放、互动、完播、商单权重分开看</span>
          </div>
          <div class="hot-factor-list">
            <div v-for="factor in hotFactorRows" :key="factor.key" class="hot-factor-row" :style="{ '--metric-color': factor.color }">
              <span>{{ factor.label }}</span>
              <strong>{{ factor.value }}</strong>
              <i><u :style="{ width: factor.width + '%' }"></u></i>
              <em>{{ factor.note }}</em>
            </div>
          </div>
        </article>
      </section>

      <section class="hot-detail-grid">
        <article class="hot-rank-card">
          <div class="panel-head">
            <strong>爆款视频排行</strong>
            <span>按综合指数排序</span>
          </div>
          <div class="hot-rank-list">
            <div v-for="(item, index) in hotVideoRows.slice(0, 10)" :key="item.id" class="hot-rank-row">
              <span>{{ index + 1 }}</span>
              <div>
                <strong>{{ item.title }}</strong>
                <em>
                  <i :class="['platform-badge', platformToneClass(item.platform)]">
                    <img v-if="platformIcon(item.platform)" :src="platformIcon(item.platform)" alt="" />
                    <span v-else>{{ platformShortLabel(item.platform) }}</span>
                  </i>
                  {{ item.account }} · {{ contentToneLabel(item) }} · 完播 {{ item.completionRate }}%
                </em>
              </div>
              <b>{{ item.hotIndex }}</b>
            </div>
          </div>
        </article>

        <article class="hot-table-card">
          <div class="panel-head">
            <strong>爆款作品明细</strong>
            <span>{{ hotVideoRows.length }} 条真实作品</span>
          </div>
          <div class="hot-video-table">
            <div class="hot-video-head">
              <span>作品</span>
              <span>账号</span>
              <span>平台</span>
              <span>类型</span>
              <span>发布时间</span>
              <span>播放</span>
              <span>点赞</span>
              <span>完播</span>
              <span>互动率</span>
              <span>指数</span>
            </div>
            <div
              v-for="item in hotVideoRows.slice(0, 18)"
              :key="item.id"
              class="hot-video-row"
              :class="contentToneClass(item)">
              <strong>{{ item.title }}</strong>
              <span>{{ item.account }}</span>
              <span class="platform-cell">
                <i :class="['platform-badge', platformToneClass(item.platform)]">
                  <img v-if="platformIcon(item.platform)" :src="platformIcon(item.platform)" alt="" />
                  <span v-else>{{ platformShortLabel(item.platform) }}</span>
                </i>
                <b>{{ item.platformLabel }}</b>
              </span>
              <span>
                <b class="content-kind-pill" :class="contentToneClass(item)" :title="item.businessReason || item.contentType || '视频'">{{ contentToneLabel(item) }}</b>
              </span>
              <span>{{ item.publishAt }}</span>
              <span class="metric-text views">{{ formatCompactNumber(item.views) }}</span>
              <span class="metric-text likes">{{ formatCompactNumber(item.likes) }}</span>
              <span>{{ item.completionRate }}%</span>
              <span>{{ item.interactionRate }}%</span>
              <em>{{ item.hotIndex }}</em>
            </div>
          </div>
        </article>
      </section>
    </section>

    <div v-if="metricModalOpen" class="metric-modal-mask" @click.self="closeMetricModal">
      <section class="metric-modal" role="dialog" aria-modal="true" :aria-label="metricModalTitle">
        <header class="metric-modal-head">
          <div>
            <strong>{{ metricModalTitle }}</strong>
            <span>{{ metricModalSubtitle }}</span>
          </div>
          <button type="button" class="metric-modal-close" title="关闭" @click="closeMetricModal">×</button>
        </header>
        <div class="metric-modal-summary">
          <span>
            <em>当前口径</em>
            <strong>{{ activeRangeMeta.label }}</strong>
          </span>
          <span>
            <em>展示维度</em>
            <strong>{{ metricModalModeLabel }}</strong>
          </span>
          <span>
            <em>数据量</em>
            <strong>{{ metricModalRows.length }} 条</strong>
          </span>
          <span>
            <em>合计</em>
            <strong>{{ formatCompactNumber(metricModalTotal) }}</strong>
          </span>
        </div>
        <div v-if="metricModalRows.length" class="metric-modal-table">
          <template v-if="metricModalMode === 'work'">
            <div class="metric-modal-row metric-modal-row-head work">
              <span>排名</span>
              <span>作品</span>
              <span>账号</span>
              <span>平台</span>
              <span>发布时间</span>
              <span>{{ metricModalValueLabel }}</span>
              <span>点赞</span>
              <span>评论</span>
              <span>互动率</span>
            </div>
            <div v-for="row in metricModalRows" :key="row.id" class="metric-modal-row work">
              <b>#{{ row.rank }}</b>
              <strong :title="row.title">{{ row.title }}</strong>
              <span>{{ row.account }}</span>
              <span>{{ row.platformLabel }}</span>
              <span>{{ row.publishAt || row.publishDate || '-' }}</span>
              <em>{{ formatCompactNumber(row.rawValue) }}</em>
              <span>{{ formatCompactNumber(row.likes) }}</span>
              <span>{{ formatCompactNumber(row.comments) }}</span>
              <span>{{ row.interactionRate }}%</span>
            </div>
          </template>
          <template v-else>
            <div class="metric-modal-row metric-modal-row-head account">
              <span>排名</span>
              <span>账号</span>
              <span>小组</span>
              <span>平台</span>
              <span>{{ metricModalValueLabel }}</span>
              <span>播放</span>
              <span>点赞</span>
              <span>粉丝变化</span>
              <span>完播率</span>
            </div>
            <div v-for="row in metricModalRows" :key="row.id" class="metric-modal-row account">
              <b>#{{ row.rank }}</b>
              <strong>{{ row.account }}</strong>
              <span>{{ row.groupName }}</span>
              <span>{{ row.platformLabel }}</span>
              <em>{{ formatCompactNumber(row.rawValue) }}</em>
              <span>{{ formatCompactNumber(row.viewsValue) }}</span>
              <span>{{ formatCompactNumber(row.likesValue) }}</span>
              <span :class="deltaClass(row.fansValue)">{{ signedDeltaText(row.fansValue) }}</span>
              <span>{{ row.completionValue }}%</span>
            </div>
          </template>
        </div>
        <div v-else class="metric-modal-empty">当前筛选范围暂无数据。</div>
      </section>
    </div>

    <div v-if="postBarModalOpen" class="metric-modal-mask" @click.self="closePostBarModal">
      <section class="metric-modal post-detail-modal" role="dialog" aria-modal="true" :aria-label="postBarModalTitle">
        <header class="metric-modal-head">
          <div>
            <strong>{{ postBarModalTitle }}</strong>
            <span>{{ postBarModalSubtitle }}</span>
          </div>
          <button type="button" class="metric-modal-close" title="关闭" @click="closePostBarModal">×</button>
        </header>
        <div class="metric-modal-summary">
          <span>
            <em>发布数量</em>
            <strong>{{ postBarModalRows.length }} 条</strong>
          </span>
          <span>
            <em>播放合计</em>
            <strong>{{ formatCompactNumber(postBarModalTotals.views) }}</strong>
          </span>
          <span>
            <em>点赞合计</em>
            <strong>{{ formatCompactNumber(postBarModalTotals.likes) }}</strong>
          </span>
          <span>
            <em>评论合计</em>
            <strong>{{ formatCompactNumber(postBarModalTotals.comments) }}</strong>
          </span>
        </div>
        <div v-if="postBarModalRows.length" class="metric-modal-table post-detail-table">
          <div class="metric-modal-row metric-modal-row-head post-detail">
            <span>#</span>
            <span>内容</span>
            <span>账号</span>
            <span>平台</span>
            <span>发布时间</span>
            <span>播放</span>
            <span>点赞</span>
            <span>评论</span>
            <span>互动率</span>
          </div>
          <div v-for="row in postBarModalRows" :key="row.id" class="metric-modal-row post-detail">
            <b>#{{ row.rank }}</b>
            <strong :title="row.title">{{ row.title }}</strong>
            <span>{{ row.account }}</span>
            <span>{{ row.platformLabel || row.platform }}</span>
            <span>{{ formatDashboardTime(row.publishAt || row.publishDate) }}</span>
            <em>{{ formatCompactNumber(row.views) }}</em>
            <span>{{ formatCompactNumber(row.likes) }}</span>
            <span>{{ formatCompactNumber(row.comments) }}</span>
            <span>{{ row.interactionRate }}%</span>
          </div>
        </div>
        <div v-else class="metric-modal-empty">{{ postBarModalLoading ? '正在读取该时间段明细…' : '这个时间段没有可展示的发布内容。' }}</div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatCompactNumber, platformOptions } from './account-data/mockData'
import { updatePlanRows } from './account-data/updatePlan'
import {
  loadAccountDataCollectStatus,
  loadAccountDataDashboard,
  loadAccountDataDashboardPublishDetail,
  loadAccountDataDashboardWorks
} from '../api/accountData'
import douyinIcon from '../assets/platform-icons/douyin.ico'
import bilibiliIcon from '../assets/platform-icons/bilibili.ico'
import kuaishouIcon from '../assets/platform-icons/kuaishou.ico'

const metricColors = {
  people: '#ff6b00',
  fans: '#2f9bf0',
  posts: '#8b6be8',
  views: '#ffa000',
  likes: '#f94d6a',
  battle: '#ff6b00',
  completion: '#18a058',
  daily: '#8b6be8',
  plan: '#00a67e',
  warn: '#ef4444'
}

const platformVisuals = {
  all: { short: '全', className: 'platform-all' },
  douyin: { short: '抖', className: 'platform-douyin', icon: douyinIcon },
  bilibili: { short: 'B', className: 'platform-bilibili', icon: bilibiliIcon },
  kuaishou: { short: '快', className: 'platform-kuaishou', icon: kuaishouIcon }
}

function platformShortLabel(platform) {
  return platformVisuals[platform]?.short || String(platform || '?').slice(0, 1).toUpperCase()
}

function platformToneClass(platform) {
  return platformVisuals[platform]?.className || 'platform-default'
}

function platformIcon(platform) {
  return platformVisuals[platform]?.icon || ''
}

function platformAccentColor(platform) {
  const map = {
    all: '#5f6878',
    douyin: '#111827',
    bilibili: '#00a1d6',
    kuaishou: '#ff7a00',
    xiaohongshu: '#ff2442',
    wechatVideo: '#18a058'
  }
  return map[platform] || '#7f8794'
}

function contentToneClass(item) {
  const content = String(item?.contentType || '').trim()
  const kind = String(item?.businessKind || '').trim()
  if (content === '商单' || kind === '平台单') return 'is-business'
  if (kind.includes('疑似')) return 'is-suspect'
  if (kind.includes('分发')) return 'is-distribution'
  return 'is-daily'
}

function contentToneColor(item) {
  const cls = contentToneClass(item)
  if (cls === 'is-business') return '#ff6b00'
  if (cls === 'is-suspect') return '#8b6be8'
  if (cls === 'is-distribution') return '#00a67e'
  return '#64748b'
}

function contentToneLabel(item) {
  const content = String(item?.contentType || '').trim()
  const kind = String(item?.businessKind || '').trim()
  if (content === '商单') return kind || '平台单'
  if (kind) return kind
  return content || '视频'
}

const viewOptions = [
  { id: 'overview', label: '总览' },
  { id: 'single', label: '单账号' },
  { id: 'battle', label: '战力分析' },
  { id: 'hotVideo', label: '爆款视频' },
  { id: 'updatePlan', label: '更新计划' }
]

const rangeOptions = [
  { id: 'yesterday', label: '昨日增量' },
  { id: 'week', label: '本周增量' },
  { id: 'month', label: '本月增量' },
  { id: 'year', label: '今年增量' },
  { id: 'all', label: '总体情况' }
]

const dimensionOptions = [
  { id: 'account', label: '账号', unit: '个账号' },
  { id: 'department', label: '部门', unit: '个部门' }
]

const rangeMeta = {
  yesterday: { label: '昨日', scale: 1, total: false },
  week: { label: '本周', scale: 4.2, total: false },
  month: { label: '本月', scale: 12, total: false },
  year: { label: '今年', scale: 30, total: false },
  all: { label: '总体', scale: 1, total: true }
}

const postGranularityOptions = [
  { id: 'day', label: '按日' },
  { id: 'week', label: '按周' }
]

const metricModeOptions = [
  { id: 'account', label: '账号' },
  { id: 'work', label: '作品' }
]

const playRankPlatformOptions = [
  { id: 'all', label: '总览' },
  { id: 'bilibili', label: 'B站' },
  { id: 'douyin', label: '抖音' },
  { id: 'kuaishou', label: '快手' }
]

const battleMemePool = [
  '今天上大分',
  '稳住别浪',
  '有点东西',
  '开香槟预备',
  '冲榜发动机',
  '高能蓄力中',
  '基本盘很硬',
  '这波能打'
]

const updatePlanAccountAliases = {
  魁仔不想肝: '葵仔不想肝',
  畅玩白晓生: '畅玩百晓生',
  最翁damn: '最游话说',
  最翁damnnn: '最游话说',
  最翁说游: '最游话说',
  王路飞cp: '王路飞CP',
  上官北: '上官北丶',
  雷鸭fist: '雷鸭Fist',
  雷鸭FIST: '雷鸭Fist',
  lee小强: 'Lee小强',
  LEE小强: 'Lee小强',
  夏天丶cat: '夏天丶Cat'
}

const updatePlanAccountAliasMap = Object.fromEntries(
  Object.entries(updatePlanAccountAliases).map(([key, value]) => [normalizeAccountKey(key), value])
)

const updatePlanStatusMap = {
  done: { label: '已达标', className: 'done' },
  onTrack: { label: '进度正常', className: 'on-track' },
  behind: { label: '需追赶', className: 'behind' },
  unmatched: { label: '待接入', className: 'unmatched' },
  paused: { label: '无需目标', className: 'paused' }
}

const updatePlanMainPlatforms = new Set(['douyin', 'bilibili'])

const activeView = ref('overview')
const activePlatform = ref('all')
const activeRange = ref('month')
const activeGroup = ref('all')
const activeDimension = ref('account')
const playRankPlatform = ref('all')
const metricDisplayModes = ref({
  views: 'account',
  likes: 'account'
})
const keyword = ref('')
const postGranularity = ref('day')
const singleGroup = ref('all')
const singlePlatform = ref('all')
const selectedAccountId = ref('')
const detailMetric = ref('views')
const metricModalKey = ref('')
const postBarModalKey = ref('')
const postBarModalLoadedWorks = ref([])
const postBarModalLoading = ref(false)
const realDashboard = ref(null)
const dashboardLoading = ref(false)
const dashboardError = ref('')
const historyPeriodEnabled = ref(false)
const selectedHistoryYear = ref(new Date().getFullYear())
const selectedHistoryMonth = ref(new Date().getMonth() + 1)
const dashboardRootRef = ref(null)
let dashboardPollTimer = null
let lastCollectionRunning = false
let lastIndexDigest = ''
let dashboardRequestSeq = 0
const chartTicks = [32, 58, 84]
const lineTicks = [36, 78, 120, 162]
const overviewPostDayLabels = ['1日', '3日', '5日', '7日', '9日', '11日', '13日', '15日', '17日', '19日', '21日', '23日', '25日', '27日']
const overviewPostWeekLabels = ['第1周', '第2周', '第3周', '第4周', '第5周', '第6周', '第7周', '第8周']
const activeRangeMeta = computed(() => rangeMeta[activeRange.value] || rangeMeta.all)
const historyYearOptions = computed(() => {
  const year = new Date().getFullYear()
  return [year, year - 1, year - 2]
})
const historyMonthOptions = Array.from({ length: 12 }, (_, index) => index + 1)
const selectedHistoryMonthKey = computed(() => selectedHistoryYear.value + '-' + String(selectedHistoryMonth.value).padStart(2, '0'))
const dashboardRangeBaseDate = computed(() => historyPeriodEnabled.value
  ? new Date(selectedHistoryYear.value, selectedHistoryMonth.value - 1, 1)
  : new Date())
const dashboardAccounts = computed(() => {
  const rows = Array.isArray(realDashboard.value?.accounts) ? realDashboard.value.accounts : []
  return rows
})
const dashboardWorks = computed(() => Array.isArray(realDashboard.value?.works) ? realDashboard.value.works : [])
const dashboardUsingReal = computed(() => Array.isArray(realDashboard.value?.accounts) && realDashboard.value.accounts.length > 0)
const dashboardSourceCount = computed(() => Array.isArray(realDashboard.value?.sources) ? realDashboard.value.sources.length : 0)
const dashboardStatusText = computed(() => {
  if (dashboardError.value) return '读取失败：' + dashboardError.value
  if (realDashboard.value?.historyMode) return '历史月份 ' + (realDashboard.value.historyMonth || selectedHistoryMonthKey.value) + ' · ' + dashboardWorks.value.length + ' 条作品'
  if (dashboardUsingReal.value) return dashboardLoading.value ? '最新采集数据 · 后台更新中' : '最新采集数据'
  if (dashboardLoading.value) return '读取中'
  return '等待采集结果'
})

const platformFiltered = computed(() => {
  if (activePlatform.value === 'all') return dashboardAccounts.value
  return dashboardAccounts.value.filter(item => item.platform === activePlatform.value)
})

const groupOptions = computed(() => Array.from(new Set(platformFiltered.value.map(item => item.groupName))))

const activePlatformLabel = computed(() => platformOptions.find(item => item.id === activePlatform.value)?.label || '全平台')
const activeGroupLabel = computed(() => activeGroup.value === 'all' ? '全部小组' : activeGroup.value)
const singlePlatformLabel = computed(() => platformOptions.find(item => item.id === singlePlatform.value)?.label || '全平台')
const singleGroupLabel = computed(() => singleGroup.value === 'all' ? '全部小组' : singleGroup.value)
const activeDimensionMeta = computed(() => dimensionOptions.find(item => item.id === activeDimension.value) || dimensionOptions[0])

const filteredAccounts = computed(() => {
  return filterAccountsByPlatform(activePlatform.value)
})

const filteredAccountIds = computed(() => new Set(filteredAccounts.value.map(item => item.id)))

function accountMatchesCommonFilters(item) {
  const word = keyword.value.toLowerCase()
  return (activeGroup.value === 'all' || item.groupName === activeGroup.value) &&
    (!word || item.account.toLowerCase().includes(word))
}

function filterAccountsByPlatform(platform = activePlatform.value) {
  return dashboardAccounts.value
    .filter(item => platform === 'all' || item.platform === platform)
    .filter(accountMatchesCommonFilters)
}

function parseDashboardDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct
  const date = new Date(raw.replace(/[年月]/g, '/').replace(/[日号]/g, '').replace(/-/g, '/'))
  return Number.isNaN(date.getTime()) ? null : date
}

function dashboardDateKey(value) {
  const date = parseDashboardDate(value)
  if (!date) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function formatDashboardTime(value) {
  const date = parseDashboardDate(value)
  if (!date) return '暂无'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function startOfDashboardDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfDashboardWeek(date) {
  const day = date.getDay() || 7
  return addDashboardDays(startOfDashboardDay(date), 1 - day)
}

function addDashboardDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function dashboardRangeWindow(range, now = dashboardRangeBaseDate.value) {
  const today = historyPeriodEnabled.value && range === 'month'
    ? new Date(selectedHistoryYear.value, selectedHistoryMonth.value, 0)
    : startOfDashboardDay(now)
  if (range === 'yesterday') {
    const start = addDashboardDays(today, -1)
    return { start, end: today }
  }
  if (range === 'week') {
    const day = today.getDay() || 7
    return { start: addDashboardDays(today, 1 - day), end: addDashboardDays(today, 1) }
  }
  if (range === 'month') {
    const monthStart = historyPeriodEnabled.value
      ? new Date(selectedHistoryYear.value, selectedHistoryMonth.value - 1, 1)
      : new Date(today.getFullYear(), today.getMonth(), 1)
    return { start: monthStart, end: addDashboardDays(today, 1) }
  }
  if (range === 'year') {
    const yearStart = new Date(today.getFullYear(), 0, 1)
    const yearEnd = historyPeriodEnabled.value
      ? new Date(today.getFullYear() + 1, 0, 1)
      : addDashboardDays(today, 1)
    return { start: yearStart, end: yearEnd }
  }
  return null
}

function workInDashboardRange(work, range = activeRange.value) {
  if (range === 'all') return true
  const date = parseDashboardDate(work?.publishDate || work?.publishAt)
  const window = dashboardRangeWindow(range)
  return Boolean(date && window && date >= window.start && date < window.end)
}

function postChartRangeWindow() {
  const window = dashboardRangeWindow(activeRange.value)
  if (activeRange.value !== 'month' || historyPeriodEnabled.value || !window || !dashboardWorks.value.length) return window
  const currentMonthWorks = dashboardWorks.value.filter((work) => {
    const date = parseDashboardDate(work?.publishDate || work?.publishAt)
    return date && date >= window.start && date < window.end
  })
  if (currentMonthWorks.length >= 8) return window
  const previousEnd = new Date(window.start)
  const previousStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth() - 1, 1)
  return { start: previousStart, end: previousEnd }
}

function workInPostChartRange(work) {
  if (activeRange.value === 'all') return true
  const date = parseDashboardDate(work?.publishDate || work?.publishAt)
  const window = postChartRangeWindow()
  return Boolean(date && window && date >= window.start && date < window.end)
}

function postChartDaySlots(limit) {
  const today = startOfDashboardDay(new Date())
  const window = postChartRangeWindow()
  let start = addDashboardDays(today, 1 - limit)
  let end = today
  if (window) {
    start = window.start
    end = addDashboardDays(window.end, -1)
    if (!historyPeriodEnabled.value && end > today) end = today
    const minStart = addDashboardDays(end, 1 - limit)
    if (start < minStart) start = minStart
  }
  const slots = []
  for (let cursor = start; cursor <= end; cursor = addDashboardDays(cursor, 1)) {
    slots.push({
      key: dashboardDateKey(cursor),
      label: `${cursor.getMonth() + 1}/${cursor.getDate()}`
    })
  }
  return slots
}

function postChartWeekSlots(limit) {
  const today = startOfDashboardDay(new Date())
  const window = postChartRangeWindow()
  let start = addDashboardDays(startOfDashboardWeek(today), -7 * (limit - 1))
  let end = startOfDashboardWeek(today)
  if (window) {
    start = startOfDashboardWeek(window.start)
    end = startOfDashboardWeek(addDashboardDays(window.end, -1))
    if (!historyPeriodEnabled.value && end > startOfDashboardWeek(today)) end = startOfDashboardWeek(today)
    const minStart = addDashboardDays(end, -7 * (limit - 1))
    if (start < minStart) start = minStart
  }
  const slots = []
  for (let cursor = start; cursor <= end; cursor = addDashboardDays(cursor, 7)) {
    slots.push({
      key: dashboardDateKey(cursor),
      label: `${cursor.getMonth() + 1}/${cursor.getDate()}周`
    })
  }
  return slots
}

function normalizeWorkTitle(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/#[^\s#]+/g, '')
    .replace(/[\s\u00a0·丶、，,。.!！?？:：;；_\-—"'“”`]+/g, '')
    .slice(0, 64)
}

function normalizePlatform(value) {
  return String(value || '').trim().toLowerCase()
}

function uniqueContentKey(work) {
  const accountKey = normalizeAccountKey(work?.account || work?.profile || work?.accountId)
  const platformKey = normalizePlatform(work?.platform)
  const titleKey = normalizeWorkTitle(work?.title)
  const dayKey = work?.publishDate || dashboardDateKey(work?.publishAt)
  return [accountKey, platformKey, titleKey || work?.id || '', dayKey || 'unknown-date'].join('|')
}


function cleanTooltipText(value) {
  return String(value || '')
    .replace(/\uFFFD/g, '')
    .replace(/[??]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
function dedupeContentWorks(rows) {
  const map = new Map()
  rows.forEach((work) => {
    const key = uniqueContentKey(work)
    const current = map.get(key)
    if (!current || (Number(work?.views) || 0) > (Number(current?.views) || 0)) {
      map.set(key, work)
    }
  })
  return Array.from(map.values())
}

const mainPlatformByAccount = computed(() => {
  const result = new Map()
  const priority = { douyin: 3, bilibili: 2, kuaishou: 1 }
  dashboardAccounts.value.forEach((account) => {
    if (account?.publishVolumeExcluded) return
    const key = normalizeAccountKey(account?.account || account?.profile || account?.accountId)
    if (!key) return
    const platform = String(account?.platform || '').trim()
    const explicitPlatform = String(account?.primaryPlatform || '').trim()
    if (explicitPlatform) {
      result.set(key, { platform: explicitPlatform, score: Number.POSITIVE_INFINITY })
      return
    }
    const score = (Number(account?.postTotal) || 0) + (Number(account?.hiddenTotal) || 0)
    const current = result.get(key)
    if (!current || score > current.score || (score === current.score && (priority[platform] || 0) > (priority[current.platform] || 0))) {
      result.set(key, { platform, score })
    }
  })
  return new Map(Array.from(result, ([key, value]) => [key, value.platform]))
})

function isMainPlatformWork(work) {
  const accountKey = normalizeAccountKey(work?.account || work?.profile || work?.accountId)
  const mainPlatform = mainPlatformByAccount.value.get(accountKey)
  return !mainPlatform || String(work?.platform || '').trim() === mainPlatform
}

const filteredRangeWorks = computed(() => {
  return filterWorksByPlatform(activePlatform.value)
})

function filterWorksByPlatform(platform = activePlatform.value) {
  if (!dashboardWorks.value.length) return []
  const accountIds = new Set(filterAccountsByPlatform(platform).map(item => item.id))
  return dashboardWorks.value
    .filter(item => !accountIds.size || accountIds.has(item.accountId))
    .filter(item => platform === 'all' || item.platform === platform)
    .filter(item => !item.publishVolumeExcluded)
    .filter(item => workInPostChartRange(item))
}

const displayPostWorks = computed(() => {
  return activePlatform.value === 'all'
    ? dedupeContentWorks(filteredRangeWorks.value.filter(work => isMainPlatformWork(work) || (Number(work?.views) || 0) >= 100000))
    : filteredRangeWorks.value
})

const dashboardPublishStats = computed(() => realDashboard.value?.publishStats || null)

function filterPublishStatRows(rows, platform = activePlatform.value) {
  const accountIds = new Set(filterAccountsByPlatform(platform).map(item => String(item.id || '')))
  return (Array.isArray(rows) ? rows : [])
    .filter(row => !accountIds.size || accountIds.has(String(row?.accountId || '')))
    .filter(row => platform === 'all' || row?.platform === platform)
    .filter(row => workInPostChartRange({ publishDate: row?.date }))
}

const publishRecordStatRows = computed(() => filterPublishStatRows(dashboardPublishStats.value?.records))
const publishDisplayStatRows = computed(() => activePlatform.value === 'all'
  ? filterPublishStatRows(dashboardPublishStats.value?.displayRecords, 'all')
  : publishRecordStatRows.value)
const hasPublishStats = computed(() => Array.isArray(dashboardPublishStats.value?.records))

const recentPostRows = computed(() => {
  return [...displayPostWorks.value]
    .map((work) => {
      const date = parseDashboardDate(work.publishAt || work.publishDate)
      return {
        ...work,
        title: work.title || '未命名作品',
        sortTime: date ? date.getTime() : 0,
        hotIndex: Number(work.hotIndex) || 0,
        views: Number(work.views) || 0,
        likes: Number(work.likes) || 0,
        comments: Number(work.comments) || 0
      }
    })
    .sort((a, b) => b.sortTime - a.sortTime || b.hotIndex - a.hotIndex || b.views - a.views)
    .slice(0, 12)
})

const postRecordTotal = computed(() => {
  if (hasPublishStats.value) return sumBy(publishRecordStatRows.value, row => Number(row?.count) || 0)
  if (dashboardWorks.value.length) return filteredRangeWorks.value.length
  return sumBy(filteredAccounts.value, rangePosts)
})

const displayPostTotal = computed(() => {
  if (hasPublishStats.value) return sumBy(publishDisplayStatRows.value, row => Number(row?.count) || 0)
  if (dashboardWorks.value.length) return displayPostWorks.value.length
  return 0
})

const postScopeLabel = computed(() => activePlatform.value === 'all' ? '去重发文' : `${activePlatformLabel.value}发布`)

const singlePlatformFiltered = computed(() => {
  if (singlePlatform.value === 'all') return dashboardAccounts.value
  return dashboardAccounts.value.filter(item => item.platform === singlePlatform.value)
})

const singleGroupOptions = computed(() => Array.from(new Set(singlePlatformFiltered.value.map(item => item.groupName))))

const singleFilteredAccounts = computed(() => {
  return singlePlatformFiltered.value
    .filter(item => singleGroup.value === 'all' || item.groupName === singleGroup.value)
})

watch(singleGroupOptions, (groups) => {
  if (singleGroup.value !== 'all' && !groups.includes(singleGroup.value)) {
    singleGroup.value = 'all'
  }
})

watch(singleFilteredAccounts, (rows) => {
  if (rows.some(item => item.id === selectedAccountId.value)) return
  selectedAccountId.value = rows[0]?.id || ''
}, { immediate: true })

watch(activePlatform, (platform) => {
  playRankPlatform.value = platform
})

watch(activeDimension, (dimension) => {
  if (!dimensionOptions.some(item => item.id === dimension)) {
    activeDimension.value = 'account'
  }
})

function postCount(item) {
  if (item?.publishVolumeExcluded) return 0
  if (Number.isFinite(item.postTotal)) return item.postTotal
  return Math.max(6, Math.round(item.totalViews / 4200 + item.hitWorks * 2))
}

function hiddenPostCount(item) {
  if (item?.publishVolumeExcluded) return 0
  return Number.isFinite(Number(item?.hiddenTotal)) ? Number(item.hiddenTotal) : 0
}

function departmentName(item) {
  return Number(item.groupId) <= 3 ? '内容一部' : '内容二部'
}

function aggregateDepartmentGroupRows(rows) {
  return aggregateDimensionRows(rows, item => item.groupName, item => item.groupName, 'departmentGroup')
}

function aggregateDimensionRows(rows, keyGetter, labelGetter, type) {
  const map = new Map()
  rows.forEach((item) => {
    const key = keyGetter(item)
      const current = map.get(key) || {
        id: `${type}-${key}`,
        account: labelGetter(item),
        groupName: type === 'departmentGroup' ? departmentName(item) : type === 'group' ? '组别聚合' : type === 'department' ? '部门聚合' : item.groupName,
        groupId: item.groupId,
        platform: activePlatform.value,
        platformLabel: activePlatformLabel.value,
        owner: item.owner || '',
      totalViews: 0,
      yesterdayViews: 0,
      totalLikes: 0,
      yesterdayLikes: 0,
      followers: 0,
      followerDelta: 0,
      comments: 0,
      favorites: 0,
      shares: 0,
      hitWorks: 0,
      postTotal: 0,
      accountCount: 0,
      completionTotal: 0
    }
    current.totalViews += item.totalViews
    current.yesterdayViews += item.yesterdayViews
    current.totalLikes += item.totalLikes
    current.yesterdayLikes += item.yesterdayLikes
    current.followers += item.followers
    current.followerDelta += item.followerDelta
    current.comments += item.comments
    current.favorites += item.favorites
    current.shares += item.shares
    current.hitWorks += item.hitWorks
    current.postTotal += postCount(item)
    current.accountCount += 1
    current.completionTotal += completionRate(item)
    current.metricsByRange = mergeMetricsByRange(current.metricsByRange, item.metricsByRange)
    map.set(key, current)
  })
  return Array.from(map.values()).map((item) => ({
    ...item,
    completionValue: item.accountCount ? Math.round(item.completionTotal / item.accountCount) : 0,
    groupName: type === 'accountRollup'
      ? item.groupName
      : type === 'departmentGroup'
        ? `${item.groupName} · ${item.accountCount} 个账号`
        : `${item.accountCount} 个账号`,
    owner: type === 'accountRollup' ? item.owner : type === 'departmentGroup' ? item.groupName : type === 'department' ? '部门聚合' : '小组聚合'
  }))
}

function stableNumber(text) {
  return String(text || '').split('').reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 11), 0)
}

function contentType(item) {
  return stableNumber(`${item.account}-${item.groupName}`) % 3 === 0 ? '商单' : '日常'
}

function contentFactor(item) {
  return contentType(item) === '商单' ? 1.5 : 1
}

function accountBattleScore(item) {
  const weightedPlay = rangeViews(item) * contentFactor(item)
  return Math.round(weightedPlay / 1200 + rangeLikes(item) * 0.18 + rangeFans(item) * 1.4 + rangePosts(item) * 80 + completionRate(item) * 18)
}

function videoContentType(account, seed, index) {
  if (index === 0 && contentType(account) === '商单') return '商单'
  return seed % 4 === 0 ? '商单' : '日常'
}

function completionRate(item) {
  if (Number.isFinite(item.completionValue)) return item.completionValue
  const seed = stableNumber(`${item.id}-${item.account}`)
  return Math.min(92, Math.max(28, Math.round(42 + (seed % 38) + item.hitWorks * 1.8)))
}

function rangeMetric(item, range, key) {
  const value = item?.metricsByRange?.[range]?.[key]
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function mergeMetricsByRange(base = {}, next = {}) {
  const merged = { ...base }
  Object.entries(next || {}).forEach(([range, metrics]) => {
    const current = merged[range] || {}
    merged[range] = {
      views: (Number(current.views) || 0) + (Number(metrics.views) || 0),
      likes: (Number(current.likes) || 0) + (Number(metrics.likes) || 0),
      comments: (Number(current.comments) || 0) + (Number(metrics.comments) || 0),
      favorites: (Number(current.favorites) || 0) + (Number(metrics.favorites) || 0),
      shares: (Number(current.shares) || 0) + (Number(metrics.shares) || 0),
      posts: (Number(current.posts) || 0) + (Number(metrics.posts) || 0),
      hiddenPosts: (Number(current.hiddenPosts) || 0) + (Number(metrics.hiddenPosts) || 0),
      fans: (Number(current.fans) || 0) + (Number(metrics.fans) || 0)
    }
  })
  return merged
}

function rangeViews(item) {
  const metric = rangeMetric(item, activeRange.value, 'views')
  if (metric !== null) return metric
  return activeRangeMeta.value.total
    ? item.totalViews
    : Math.round(item.yesterdayViews * activeRangeMeta.value.scale)
}

function rangeLikes(item) {
  const metric = rangeMetric(item, activeRange.value, 'likes')
  if (metric !== null) return metric
  return activeRangeMeta.value.total
    ? item.totalLikes
    : Math.round(item.yesterdayLikes * activeRangeMeta.value.scale)
}

function rangeFans(item) {
  const metric = rangeMetric(item, activeRange.value, 'fans')
  if (metric !== null) return metric
  return activeRangeMeta.value.total
    ? item.followers
    : Math.round(item.followerDelta * activeRangeMeta.value.scale)
}

function rangePosts(item) {
  const metric = rangeMetric(item, activeRange.value, 'posts')
  if (metric !== null) return metric
  return activeRangeMeta.value.total
    ? postCount(item)
    : Math.max(1, Math.round(postCount(item) * activeRangeMeta.value.scale / 18))
}

function monthlyPostCount(item) {
  if (!item) return 0
  if (item.publishVolumeExcluded) return 0
  const metric = rangeMetric(item, 'month', 'posts')
  if (metric !== null) return metric
  return Math.max(0, Math.round(postCount(item) * rangeMeta.month.scale / 18))
}

function monthlyHiddenPostCount(item) {
  if (!item) return 0
  if (item.publishVolumeExcluded) return 0
  const metric = rangeMetric(item, 'month', 'hiddenPosts')
  if (metric !== null) return metric
  return hiddenPostCount(item)
}

function normalizeAccountKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s·丶、，,。._\-—/\\:：]/g, '')
}

function updateMonthProgressRatio() {
  if (historyPeriodEnabled.value) return 1
  const now = new Date()
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return Math.min(1, Math.max(0.03, now.getDate() / Math.max(1, days)))
}

function findUpdatePlanAccount(plan) {
  const candidates = dashboardAccounts.value.filter(item => item.platform === plan.platform)
  const planKey = normalizeAccountKey(plan.account)
  const targetName = updatePlanAccountAliasMap[planKey] || plan.account
  const targetKey = normalizeAccountKey(targetName)
  return candidates.find(item => normalizeAccountKey(item.account) === targetKey) ||
    candidates.find((item) => {
      const accountKey = normalizeAccountKey(item.account)
      return accountKey && targetKey && (accountKey.includes(targetKey) || targetKey.includes(accountKey))
    }) ||
    null
}

function updatePlanAccountKeys(plan, matchedAccount) {
  const keys = new Set()
  const addKey = (value) => {
    const key = normalizeAccountKey(value)
    if (key) keys.add(key)
  }
  const planKey = normalizeAccountKey(plan?.account)
  addKey(plan?.account)
  const aliasName = updatePlanAccountAliasMap[planKey]
  addKey(aliasName)
  addKey(matchedAccount?.account)
  addKey(matchedAccount?.accountId)
  addKey(matchedAccount?.id)
  addKey(matchedAccount?.profile)
  return keys
}

function activeBusinessMonthKey() {
  if (historyPeriodEnabled.value) return selectedHistoryMonthKey.value
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}

const businessOrderCountMap = computed(() => {
  const rows = Array.isArray(realDashboard.value?.businessOrderCounts)
    ? realDashboard.value.businessOrderCounts
    : []
  const map = new Map()
  rows.forEach((item) => {
    const month = String(item?.month || '').trim()
    const platform = String(item?.platform || '').trim()
    const accountKey = normalizeAccountKey(item?.account || item?.accountKey)
    if (!month || !accountKey) return
    const key = [month, platform, accountKey].join('|')
    map.set(key, (map.get(key) || 0) + (Number(item?.count) || 0))
  })
  return map
})

function updatePlanWorkIndexKey(platform, accountKey, lengthType, hidden) {
  return [
    String(platform || '').trim(),
    String(accountKey || '').trim(),
    normalizeVideoLengthType(lengthType),
    hidden ? 'hidden' : 'visible'
  ].join('|')
}

function addUpdatePlanWorkIndexItem(map, key, workId) {
  if (!key || !workId) return
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(workId)
}

const updatePlanWorkCountMap = computed(() => {
  const map = new Map()
  if (!Array.isArray(dashboardWorks.value) || !dashboardWorks.value.length) return map
  dashboardWorks.value.forEach((work, index) => {
    if (work?.publishVolumeExcluded) return
    if (!workInCurrentMonth(work)) return
    const platform = work?.platform
    if (!updatePlanMainPlatforms.has(platform)) return
    const accountKeys = workAccountKeys(work)
    if (!accountKeys.length) return
    const lengthType = normalizeVideoLengthType(work?.videoLengthType)
    const hidden = Boolean(work?.hiddenByZeroViews)
    const workId = work?.id || work?.key || [
      platform,
      work?.account || '',
      work?.profile || '',
      work?.title || '',
      work?.publishAt || work?.publishDate || '',
      index
    ].join('|')
    accountKeys.forEach((accountKey) => {
      addUpdatePlanWorkIndexItem(map, updatePlanWorkIndexKey(platform, accountKey, lengthType, hidden), workId)
      addUpdatePlanWorkIndexItem(map, updatePlanWorkIndexKey(platform, accountKey, 'all', hidden), workId)
    })
  })
  return map
})

function businessOrderCountForPlan(plan, matchedAccount) {
  const month = activeBusinessMonthKey()
  const platform = String(plan?.platform || matchedAccount?.platform || '').trim()
  const accountKeys = Array.from(updatePlanAccountKeys(plan, matchedAccount))
  for (const accountKey of accountKeys) {
    const exact = businessOrderCountMap.value.get([month, platform, accountKey].join('|'))
    if (Number(exact) > 0) return Number(exact)
  }
  for (const accountKey of accountKeys) {
    const loose = businessOrderCountMap.value.get([month, '', accountKey].join('|'))
    if (Number(loose) > 0) return Number(loose)
  }
  return 0
}

function workAccountKeys(work) {
  return [
    work?.account,
    work?.profile,
    work?.accountId
  ].map(normalizeAccountKey).filter(Boolean)
}

function accountKeyMatches(workKeys, accountKeys) {
  for (const workKey of workKeys) {
    for (const accountKey of accountKeys) {
      if (!workKey || !accountKey) continue
      if (workKey === accountKey) return true
      if (workKey.length >= 2 && accountKey.length >= 2 && (workKey.includes(accountKey) || accountKey.includes(workKey))) return true
    }
  }
  return false
}

function normalizeVideoLengthType(value) {
  const text = String(value || '').trim().toLowerCase()
  if (text === 'long' || text === '长视频') return 'long'
  if (text === 'short' || text === '短视频') return 'short'
  return 'unknown'
}

function workMatchesPlanLength(work, plan) {
  const planType = normalizeVideoLengthType(plan?.videoLengthType)
  if (planType === 'unknown') return true
  return normalizeVideoLengthType(work?.videoLengthType) === planType
}

function updatePlanWorkCountForPlan(plan, matchedAccount, hidden) {
  const platform = String(plan?.platform || matchedAccount?.platform || '').trim()
  const planType = normalizeVideoLengthType(plan?.videoLengthType)
  const lengthType = planType === 'unknown' ? 'all' : planType
  const accountKeys = Array.from(updatePlanAccountKeys(plan, matchedAccount))
  const seen = new Set()
  accountKeys.forEach((accountKey) => {
    const rows = updatePlanWorkCountMap.value.get(updatePlanWorkIndexKey(platform, accountKey, lengthType, hidden))
    if (!rows) return
    rows.forEach((id) => seen.add(id))
  })
  return seen.size
}

function workInCurrentMonth(work) {
  const date = parseDashboardDate(work?.publishDate || work?.publishAt)
  if (!date) return false
  const now = historyPeriodEnabled.value ? dashboardRangeBaseDate.value : new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

function updatePlanCompleted(plan, matchedAccount) {
  if (!updatePlanMainPlatforms.has(plan?.platform)) return 0
  const hasLengthTarget = normalizeVideoLengthType(plan?.videoLengthType) !== 'unknown'
  const preferWorkRows = Boolean(realDashboard.value?.historyMode) || hasLengthTarget
  const aggregated = preferWorkRows ? 0 : monthlyPostCount(matchedAccount)
  if (aggregated > 0) return aggregated
  if (Array.isArray(dashboardWorks.value) && dashboardWorks.value.length) {
    return updatePlanWorkCountForPlan(plan, matchedAccount, false)
  }
  return updatePlanEligibleCompleted(matchedAccount)
}

function updatePlanHiddenCompleted(plan, matchedAccount) {
  if (!updatePlanMainPlatforms.has(plan?.platform)) return 0
  const hasLengthTarget = normalizeVideoLengthType(plan?.videoLengthType) !== 'unknown'
  const preferWorkRows = Boolean(realDashboard.value?.historyMode) || hasLengthTarget
  const aggregated = preferWorkRows ? 0 : monthlyHiddenPostCount(matchedAccount)
  if (aggregated > 0) return aggregated
  if (Array.isArray(dashboardWorks.value) && dashboardWorks.value.length) {
    return updatePlanWorkCountForPlan(plan, matchedAccount, true)
  }
  return monthlyHiddenPostCount(matchedAccount)
}

function updatePlanEligibleCompleted(item) {
  if (!item || item.publishVolumeExcluded) return 0
  return monthlyPostCount(item)
}

function updatePlanStatus(plan, matchedAccount, completed, expected) {
  if (!plan.monthlyTarget) return 'paused'
  if (!matchedAccount) return 'unmatched'
  if (completed >= plan.monthlyTarget) return 'done'
  if (completed >= expected) return 'onTrack'
  return 'behind'
}

function updatePlanHiddenDisplay(row) {
  return Number(row?.hiddenCompleted) || 0
}

function updatePlanTargetDisplay(row) {
  const target = Number(row?.target) || 0
  return target > 0 ? target : '无需目标'
}

function updatePlanCompletedDisplay(row) {
  return Number(row?.completed) || 0
}

function sumBy(rows, getter) {
  return rows.reduce((sum, item) => sum + getter(item), 0)
}

function withBarHeight(rows, getter, totalBase = null) {
  const max = Math.max(1, ...rows.map(getter))
  const total = Math.max(1, totalBase ?? sumBy(rows, getter))
  return rows.map((item, index) => ({
    ...item,
    rank: index + 1,
    rawValue: getter(item),
    height: Math.max(4, Math.round(getter(item) / max * 100)),
    share: Math.max(1, Math.round(getter(item) / total * 100))
  }))
}

function chartStats(sortedRows, getter, topRows, format) {
  const total = sumBy(sortedRows, getter)
  const topValue = topRows[0]?.rawValue || 0
  const avgValue = sortedRows.length ? Math.round(total / sortedRows.length) : 0
  const topTotal = sumBy(topRows, item => item.rawValue)
  return [
    { label: '最高', value: format(topValue) },
    { label: '均值', value: format(avgValue) },
    { label: 'Top5占比', value: `${total ? Math.round(topTotal / total * 100) : 0}%` }
  ]
}

function chartStatsFromRawRows(sortedRows, topRows, format) {
  const total = sumBy(sortedRows, item => Number(item.rawValue) || 0)
  const topValue = topRows[0]?.rawValue || 0
  const avgValue = sortedRows.length ? Math.round(total / sortedRows.length) : 0
  const topTotal = sumBy(topRows, item => Number(item.rawValue) || 0)
  return [
    { label: '最高', value: format(topValue) },
    { label: '均值', value: format(avgValue) },
    { label: 'Top5占比', value: `${total ? Math.round(topTotal / total * 100) : 0}%` }
  ]
}

function metricMode(metric) {
  return metricDisplayModes.value?.[metric] || 'account'
}

function workMetricRows(metric) {
  if (!dashboardWorks.value.length) return []
  const metricKey = metric === 'likes' ? 'likes' : 'views'
  const rows = filterWorksByPlatform(activePlatform.value)
    .map((work) => ({
      ...work,
      displayName: work.title || '未命名作品',
      subtitle: `${work.account} · ${work.platformLabel || work.platform}${work.publishAt ? ' · ' + work.publishAt : ''}`,
      rawValue: Number(work[metricKey]) || 0
    }))
    .sort((a, b) => b.rawValue - a.rawValue)
  const topRows = rows.slice(0, 5)
  const total = Math.max(1, sumBy(rows, item => item.rawValue))
  const max = Math.max(1, ...topRows.map(item => item.rawValue))
  return topRows.map((item, index) => ({
    ...item,
    rank: index + 1,
    height: Math.max(4, Math.round(item.rawValue / max * 100)),
    share: Math.max(1, Math.round(item.rawValue / total * 100))
  }))
}

function accountMetricRows(sortedRows, getter, totalBase) {
  return withBarHeight(sortedRows.slice(0, 5), getter, totalBase)
    .map(item => ({
      ...item,
      displayName: item.account,
      subtitle: item.groupName
    }))
}

function fullWorkMetricRows(metric) {
  if (!dashboardWorks.value.length) return []
  const metricKey = metric === 'likes' ? 'likes' : 'views'
  return filterWorksByPlatform(activePlatform.value)
    .map((work) => ({
      ...work,
      title: work.title || '未命名作品',
      rawValue: Number(work[metricKey]) || 0,
      likes: Number(work.likes) || 0,
      comments: Number(work.comments) || 0,
      interactionRate: Number(work.interactionRate) || 0
    }))
    .sort((a, b) => b.rawValue - a.rawValue || (Number(b.views) || 0) - (Number(a.views) || 0))
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

function fullAccountMetricRows(metric) {
  return [...dashboardRows.value]
    .map((item) => ({
      ...item,
      rawValue: metricValue(item, metric),
      viewsValue: rangeViews(item),
      likesValue: rangeLikes(item),
      fansValue: rangeFans(item),
      completionValue: completionRate(item)
    }))
    .sort((a, b) => b.rawValue - a.rawValue || b.viewsValue - a.viewsValue)
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

function trendPoints(values, width = 520, height = 112, padding = 12) {
  if (!Array.isArray(values) || values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  return values.map((value, index) => {
    const x = padding + index * ((width - padding * 2) / Math.max(1, values.length - 1))
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function trimAccount(name) {
  const text = String(name || '')
  return text.length > 5 ? `${text.slice(0, 5)}...` : text
}

function linePoints(values, width = 520, height = 172, padding = 14) {
  if (!Array.isArray(values) || values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  return values.map((value, index) => {
    const x = padding + index * ((width - padding * 2) / Math.max(1, values.length - 1))
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function openChartMore(panel) {
  detailMetric.value = panel?.key || 'views'
  metricModalKey.value = panel?.key || 'views'
}

function openRecentPostsMore() {
  activeView.value = 'hotVideo'
}

function closeMetricModal() {
  metricModalKey.value = ''
}

async function openPostBarModal(bar) {
  if (!bar?.value) return
  postBarModalKey.value = bar?.key || bar?.label || ''
  postBarModalLoadedWorks.value = []
  if (Array.isArray(bar?.works) && bar.works.length) return
  const start = parseDashboardDate(bar?.key)
  if (!start) return
  const end = postGranularity.value === 'week' ? addDashboardDays(start, 6) : start
  const modalKey = postBarModalKey.value
  postBarModalLoading.value = true
  try {
    let works = await loadAccountDataDashboardPublishDetail({
      historyMonth: historyPeriodEnabled.value ? selectedHistoryMonthKey.value : '',
      workScope: (activeRange.value === 'year' || activeRange.value === 'all') ? 'all' : 'month',
      startDate: dashboardDateKey(start),
      endDate: dashboardDateKey(end)
    })
    const accountIds = new Set(filterAccountsByPlatform(activePlatform.value).map(item => item.id))
    works = works
      .filter(item => !accountIds.size || accountIds.has(item.accountId))
      .filter(item => activePlatform.value === 'all' || item.platform === activePlatform.value)
      .filter(item => !item.publishVolumeExcluded)
    if (activePlatform.value === 'all') {
      works = dedupeContentWorks(works.filter(work => isMainPlatformWork(work) || (Number(work?.views) || 0) >= 100000))
    }
    if (postBarModalKey.value === modalKey) postBarModalLoadedWorks.value = works
  } catch (error) {
    if (postBarModalKey.value === modalKey) dashboardError.value = error?.message || '发文明细读取失败'
  } finally {
    if (postBarModalKey.value === modalKey) postBarModalLoading.value = false
  }
}

function closePostBarModal() {
  postBarModalKey.value = ''
  postBarModalLoadedWorks.value = []
  postBarModalLoading.value = false
}

const kpiCards = computed(() => {
  const rows = filteredAccounts.value
  const range = activeRangeMeta.value
  const accountCount = rows.length
  const followers = sumBy(rows, rangeFans)
  const posts = displayPostTotal.value
  const views = sumBy(rows, rangeViews)
  const likes = sumBy(rows, rangeLikes)
  const postNote = dashboardWorks.value.length
    ? (activePlatform.value === 'all'
        ? `跨平台分发已去重${postRecordTotal.value !== posts ? ` · 平台记录 ${formatCompactNumber(postRecordTotal.value)} 条` : ''}`
        : `${activePlatformLabel.value}作品表`)
    : '由账号汇总估算'
  return [
    { key: 'people', label: '总账号数', value: accountCount, note: '当前筛选范围', icon: '人', color: metricColors.people },
    { key: 'fans', label: range.total ? '总粉丝数' : '粉丝增量', value: formatCompactNumber(followers), note: `${range.label}口径`, icon: '粉', color: metricColors.fans },
    { key: 'posts', label: activePlatform.value === 'all' ? (range.total ? '内容发文数' : '内容发文增量') : (range.total ? '平台发布数' : '平台发布增量'), value: formatCompactNumber(posts), note: postNote, icon: '发', color: metricColors.posts },
    { key: 'views', label: range.total ? '总曝光量' : '曝光增量', value: formatCompactNumber(views), note: `${range.label}口径`, icon: '播', color: metricColors.views },
    { key: 'likes', label: range.total ? '总点赞数' : '点赞增量', value: formatCompactNumber(likes), note: `${range.label}口径`, icon: '赞', color: metricColors.likes }
  ]
})

const dashboardRows = computed(() => {
  if (activeDimension.value === 'group') {
    return aggregateDimensionRows(filteredAccounts.value, item => item.groupName, item => item.groupName, 'group')
  }
  if (activeDimension.value === 'department') {
    return aggregateDepartmentGroupRows(filteredAccounts.value)
  }
  return filteredAccounts.value
})

const playRankRows = computed(() => {
  const rows = filterAccountsByPlatform(playRankPlatform.value)
  if (activeDimension.value === 'department') {
    return aggregateDepartmentGroupRows(rows)
  }
  if (playRankPlatform.value === 'all') {
    return aggregateDimensionRows(rows, item => item.account, item => item.account, 'accountRollup')
  }
  return rows
})

function mergeTextList(values) {
  return Array.from(new Set((values || [])
    .map(value => String(value || '').trim())
    .filter(Boolean))).join(' / ')
}

function groupedUpdatePlanRows(sourcePlans) {
  const map = new Map()
  sourcePlans.forEach((plan) => {
    const accountKey = normalizeAccountKey(plan.account)
    const key = [plan.platform, accountKey || plan.account].join('|')
    if (!map.has(key)) {
      map.set(key, {
        ...plan,
        id: `update-plan-account-${plan.platform}-${accountKey || map.size}`,
        monthlyTarget: 0,
        monthlyTotal: 0,
        longTarget: 0,
        shortTarget: 0,
        planParts: [],
        durationTexts: [],
        contentDirections: [],
        notes: [],
        benchmarkList: []
      })
    }
    const row = map.get(key)
    const target = Number(plan.monthlyTarget) || 0
    const lengthType = normalizeVideoLengthType(plan.videoLengthType)
    row.monthlyTarget += target
    row.monthlyTotal += Number(plan.monthlyTotal) || 0
    if (lengthType === 'long') row.longTarget += target
    if (lengthType === 'short') row.shortTarget += target
    row.planParts.push(plan)
    row.durationTexts.push(plan.durationText)
    row.contentDirections.push(plan.contentDirection)
    row.notes.push(plan.note)
    row.benchmarkList.push(plan.benchmarkAccounts)
  })
  return Array.from(map.values()).map((row) => ({
    ...row,
    durationSummary: mergeTextList(row.durationTexts),
    contentDirection: mergeTextList(row.contentDirections),
    note: mergeTextList(row.notes),
    benchmarkAccounts: mergeTextList(row.benchmarkList),
    videoLengthType: row.longTarget && row.shortTarget ? 'mixed' : (row.longTarget ? 'long' : (row.shortTarget ? 'short' : 'unknown'))
  }))
}

const updatePlanDisplayRows = computed(() => {
  const word = keyword.value.toLowerCase()
  const monthProgress = updateMonthProgressRatio()
  const sourcePlans = groupedUpdatePlanRows(updatePlanRows.filter(item => updatePlanMainPlatforms.has(item.platform)))
  const plannedAccountKeys = new Set()
  sourcePlans.forEach((plan) => {
    const matchedAccount = findUpdatePlanAccount(plan)
    const accountKey = normalizeAccountKey(matchedAccount?.account || plan.account)
    if (accountKey) plannedAccountKeys.add(`${plan.platform}:${accountKey}`)
  })
  const noTargetPlans = dashboardAccounts.value
    .filter(item => updatePlanMainPlatforms.has(item.platform))
    .filter(item => !item.publishVolumeExcluded)
    .filter((item) => {
      const accountKey = normalizeAccountKey(item.account)
      return accountKey && !plannedAccountKeys.has(`${item.platform}:${accountKey}`)
    })
    .map((item, index) => ({
      id: `update-plan-no-target-${item.platform}-${normalizeAccountKey(item.account) || index}`,
      groupName: item.groupName || '未分组',
      platform: item.platform,
      platformLabel: item.platformLabel || item.platform,
      accountType: item.accountType || '',
      owner: item.owner || '',
      account: item.account,
      benchmarkAccounts: '',
      monthlyTarget: 0,
      longTarget: 0,
      shortTarget: 0,
      durationSummary: '',
      note: '账号池未设置更新目标',
      sourceAccount: item
    }))
  return sourcePlans
    .concat(noTargetPlans)
    .filter(item => activePlatform.value === 'all' || item.platform === activePlatform.value)
    .filter(item => activeGroup.value === 'all' || item.groupName === activeGroup.value)
    .filter((item) => {
      if (!word) return true
      return `${item.account} ${item.owner} ${item.groupName} ${item.platformLabel}`.toLowerCase().includes(word)
    })
    .map((plan) => {
      const matchedAccount = plan.sourceAccount || findUpdatePlanAccount(plan)
      const longPlan = { ...plan, videoLengthType: 'long', monthlyTarget: Number(plan.longTarget) || 0 }
      const shortPlan = { ...plan, videoLengthType: 'short', monthlyTarget: Number(plan.shortTarget) || 0 }
      const longVisibleCompleted = updatePlanCompleted(longPlan, matchedAccount)
      const longHiddenCompleted = updatePlanHiddenCompleted(longPlan, matchedAccount)
      const shortVisibleCompleted = updatePlanCompleted(shortPlan, matchedAccount)
      const shortHiddenCompleted = updatePlanHiddenCompleted(shortPlan, matchedAccount)
      const longCompleted = longVisibleCompleted + longHiddenCompleted
      const shortCompleted = shortVisibleCompleted + shortHiddenCompleted
      const visibleCompleted = longVisibleCompleted + shortVisibleCompleted
      const hiddenCompleted = longHiddenCompleted + shortHiddenCompleted
      const completed = visibleCompleted + hiddenCompleted
      const businessOrderCount = businessOrderCountForPlan(plan, matchedAccount)
      const target = Number(plan.monthlyTarget) || 0
      const expected = Math.ceil(target * monthProgress)
      const gap = Math.max(0, target - completed)
      const progress = target ? Math.min(100, Math.round(completed / target * 100)) : 100
      const status = updatePlanStatus(plan, matchedAccount, completed, expected)
      const statusMeta = updatePlanStatusMap[status] || updatePlanStatusMap.behind
      const matchNote = matchedAccount && matchedAccount.account !== plan.account ? `匹配：${matchedAccount.account}` : ''
      const collectNote = matchedAccount?.collectStatusReason || ''
      return {
        ...plan,
        groupName: matchedAccount?.groupName || plan.groupName || '未分组',
        owner: matchedAccount?.owner || plan.owner || '',
        matched: Boolean(matchedAccount),
        matchedAccountName: matchedAccount?.account || '',
        followers: Number(matchedAccount?.followers) || 0,
        target,
        completed,
        visibleCompleted,
        hiddenCompleted,
        longTarget: Number(plan.longTarget) || 0,
        shortTarget: Number(plan.shortTarget) || 0,
        longCompleted,
        shortCompleted,
        longVisibleCompleted,
        shortVisibleCompleted,
        longHiddenCompleted,
        shortHiddenCompleted,
        businessOrderCount,
        expected,
        gap,
        progress,
        status,
        statusLabel: statusMeta.label,
        statusClass: statusMeta.className,
        contextNote: [plan.benchmarkAccounts ? `对标：${plan.benchmarkAccounts}` : '', plan.note, matchNote, collectNote || (!matchedAccount && target ? '待接入账号池' : '')]
          .filter(Boolean)
          .join('；') || '正常推进'
      }
    })
    .sort((a, b) => {
      return b.followers - a.followers || b.gap - a.gap || b.target - a.target
    })
})

const updatePlanSummary = computed(() => {
  const rows = updatePlanDisplayRows.value
  const target = sumBy(rows, item => item.target)
  const completed = sumBy(rows, item => item.target ? Math.min(item.completed, item.target) : 0)
  const remaining = sumBy(rows, item => item.gap)
  const behindCount = rows.filter(item => item.target > 0 && (item.status === 'behind' || item.status === 'unmatched')).length
  const activeCount = rows.filter(item => item.target > 0).length
  return {
    rowCount: rows.length,
    activeCount,
    target,
    completed,
    remaining,
    behindCount,
    pausedCount: rows.filter(item => item.status === 'paused').length,
    matchedCount: rows.filter(item => item.matched).length,
    completionRate: target ? Math.min(100, Math.round(completed / target * 100)) : 100
  }
})

const updateLengthRows = computed(() => {
  const map = new Map([
    ['long', { key: 'long', label: '长视频', target: 0, completed: 0, remaining: 0 }],
    ['short', { key: 'short', label: '短视频', target: 0, completed: 0, remaining: 0 }]
  ])
  updatePlanDisplayRows.value.forEach((item) => {
    const longRow = map.get('long')
    const shortRow = map.get('short')
    const longTarget = Number(item.longTarget) || 0
    const shortTarget = Number(item.shortTarget) || 0
    const longCompleted = Math.min(Number(item.longCompleted) || 0, longTarget)
    const shortCompleted = Math.min(Number(item.shortCompleted) || 0, shortTarget)
    longRow.target += longTarget
    longRow.completed += longCompleted
    longRow.remaining += Math.max(0, longTarget - longCompleted)
    shortRow.target += shortTarget
    shortRow.completed += shortCompleted
    shortRow.remaining += Math.max(0, shortTarget - shortCompleted)
  })
  return Array.from(map.values()).map(item => ({
    ...item,
    progress: item.target ? Math.min(100, Math.round(item.completed / item.target * 100)) : 100
  }))
})

const updatePlanSummaryCards = computed(() => {
  const summary = updatePlanSummary.value
  const longRow = updateLengthRows.value.find(item => item.key === 'long') || { target: 0, completed: 0, remaining: 0, progress: 0 }
  const shortRow = updateLengthRows.value.find(item => item.key === 'short') || { target: 0, completed: 0, remaining: 0, progress: 0 }
  return [
    {
      key: 'target',
      label: '月更新目标',
      value: `${summary.target}条`,
      note: `长视频 ${longRow.target} · 短视频 ${shortRow.target}`,
      color: metricColors.plan
    },
    {
      key: 'long',
      label: '长视频',
      value: `${longRow.completed}/${longRow.target}`,
      note: `完成率 ${longRow.progress}%`,
      color: metricColors.posts
    },
    {
      key: 'short',
      label: '短视频',
      value: `${shortRow.completed}/${shortRow.target}`,
      note: `完成率 ${shortRow.progress}%`,
      color: metricColors.views
    },
    {
      key: 'remaining',
      label: '剩余缺口',
      value: `${summary.remaining}条`,
      note: `${summary.behindCount} 个账号需要跟进`,
      color: summary.remaining ? metricColors.warn : metricColors.completion
    }
  ]
})

const updateRiskRows = computed(() => {
  return updatePlanDisplayRows.value
    .filter(item => item.target > 0 && (item.status === 'behind' || item.status === 'unmatched'))
    .sort((a, b) => b.gap - a.gap || b.target - a.target)
    .slice(0, 6)
})

const updateGroupRows = computed(() => {
  const map = new Map()
  updatePlanDisplayRows.value.forEach((item) => {
    const current = map.get(item.groupName) || {
      groupName: item.groupName,
      target: 0,
      completed: 0,
      remaining: 0,
      behindCount: 0
    }
    current.target += item.target
    current.completed += item.target ? Math.min(item.completed, item.target) : 0
    current.remaining += item.gap
    if (item.target > 0 && (item.status === 'behind' || item.status === 'unmatched')) current.behindCount += 1
    map.set(item.groupName, current)
  })
  return Array.from(map.values())
    .map(item => ({
      ...item,
      progress: item.target ? Math.min(100, Math.round(item.completed / item.target * 100)) : 100
    }))
    .sort((a, b) => b.remaining - a.remaining || b.target - a.target)
})

const updatePlanGroupSections = computed(() => {
  const map = new Map()
  updatePlanDisplayRows.value.forEach((item) => {
    const groupName = item.groupName || '未分组'
    const current = map.get(groupName) || {
      groupName,
      target: 0,
      completed: 0,
      remaining: 0,
      hiddenCompleted: 0,
      longTarget: 0,
      longCompleted: 0,
      shortTarget: 0,
      shortCompleted: 0,
      rows: []
    }
    current.target += Number(item.target) || 0
    current.completed += item.target ? Math.min(Number(item.completed) || 0, Number(item.target) || 0) : 0
    current.remaining += Number(item.gap) || 0
    current.hiddenCompleted += Number(item.hiddenCompleted) || 0
    current.longTarget += Number(item.longTarget) || 0
    current.longCompleted += Math.min(Number(item.longCompleted) || 0, Number(item.longTarget) || 0)
    current.shortTarget += Number(item.shortTarget) || 0
    current.shortCompleted += Math.min(Number(item.shortCompleted) || 0, Number(item.shortTarget) || 0)
    current.rows.push(item)
    map.set(groupName, current)
  })
  return Array.from(map.values())
    .map((group) => ({
      ...group,
      progress: group.target ? Math.min(100, Math.round(group.completed / group.target * 100)) : 100,
      rows: group.rows.slice().sort((a, b) => b.gap - a.gap || b.target - a.target || b.hiddenCompleted - a.hiddenCompleted)
    }))
    .sort((a, b) => b.remaining - a.remaining || b.target - a.target || b.hiddenCompleted - a.hiddenCompleted)
})

const chartPanels = computed(() => {
  const rows = dashboardRows.value
  const range = activeRangeMeta.value
  const viewsSorted = [...rows].sort((a, b) => rangeViews(b) - rangeViews(a))
  const likesSorted = [...rows].sort((a, b) => rangeLikes(b) - rangeLikes(a))
  const viewsTotal = sumBy(viewsSorted, rangeViews)
  const likesTotal = sumBy(likesSorted, rangeLikes)
  const topViews = metricMode('views') === 'work'
    ? workMetricRows('views')
    : accountMetricRows(viewsSorted, rangeViews, viewsTotal)
  const topLikes = metricMode('likes') === 'work'
    ? workMetricRows('likes')
    : accountMetricRows(likesSorted, rangeLikes, likesTotal)
  const workViewsAll = metricMode('views') === 'work'
    ? filterWorksByPlatform(activePlatform.value).map(work => ({ rawValue: Number(work.views) || 0 }))
    : []
  const workLikesAll = metricMode('likes') === 'work'
    ? filterWorksByPlatform(activePlatform.value).map(work => ({ rawValue: Number(work.likes) || 0 }))
    : []
  return [
    {
      key: 'views',
      title: range.total ? '总曝光量' : '曝光增量',
      legend: metricMode('views') === 'work' ? '作品曝光榜' : (range.total ? '账号曝光量' : '账号曝光增量'),
      unit: '万',
      color: metricColors.views,
      rows: topViews,
      stats: metricMode('views') === 'work'
        ? chartStatsFromRawRows(workViewsAll.sort((a, b) => b.rawValue - a.rawValue), topViews, formatCompactNumber)
        : chartStats(viewsSorted, rangeViews, topViews, formatCompactNumber),
      format: formatCompactNumber
    },
    {
      key: 'likes',
      title: range.total ? '总点赞数' : '点赞增量',
      legend: metricMode('likes') === 'work' ? '作品点赞榜' : (range.total ? '账号点赞数' : '账号点赞增量'),
      unit: '万',
      color: metricColors.likes,
      rows: topLikes,
      stats: metricMode('likes') === 'work'
        ? chartStatsFromRawRows(workLikesAll.sort((a, b) => b.rawValue - a.rawValue), topLikes, formatCompactNumber)
        : chartStats(likesSorted, rangeLikes, topLikes, formatCompactNumber),
      format: formatCompactNumber
    }
  ]
})

const metricModalOpen = computed(() => Boolean(metricModalKey.value))
const metricModalMetric = computed(() => metricModalKey.value || 'views')
const metricModalMode = computed(() => metricMode(metricModalMetric.value))
const metricModalModeLabel = computed(() => metricModalMode.value === 'work' ? '作品' : activeDimensionMeta.value.label)
const metricModalValueLabel = computed(() => metricModalMetric.value === 'likes' ? '点赞' : '播放')
const metricModalTitle = computed(() => {
  const metricText = metricModalMetric.value === 'likes'
    ? (activeRangeMeta.value.total ? '总点赞数' : '点赞增量')
    : (activeRangeMeta.value.total ? '总曝光量' : '曝光增量')
  return `${metricText}全量榜`
})
const metricModalSubtitle = computed(() => {
  const filters = [
    activeRangeMeta.value.label,
    activePlatformLabel.value,
    activeGroupLabel.value,
    keyword.value ? `搜索：${keyword.value}` : ''
  ].filter(Boolean)
  return `${filters.join(' · ')} · ${metricModalModeLabel.value}维度`
})
const metricModalRows = computed(() => {
  if (!metricModalOpen.value) return []
  return metricModalMode.value === 'work'
    ? fullWorkMetricRows(metricModalMetric.value)
    : fullAccountMetricRows(metricModalMetric.value)
})
const metricModalTotal = computed(() => sumBy(metricModalRows.value, item => Number(item.rawValue) || 0))

const postBarModalOpen = computed(() => Boolean(postBarModalKey.value))
const selectedPostBar = computed(() => {
  if (!postBarModalKey.value) return null
  return overviewPostBars.value.find(item => item.key === postBarModalKey.value || item.label === postBarModalKey.value) || null
})
const postBarModalRows = computed(() => {
  const barWorks = Array.isArray(selectedPostBar.value?.works) ? selectedPostBar.value.works : []
  const works = barWorks.length ? barWorks : postBarModalLoadedWorks.value
  return works
    .map((work) => ({
      ...work,
      title: work.title || '未命名作品',
      views: Number(work.views) || 0,
      likes: Number(work.likes) || 0,
      comments: Number(work.comments) || 0,
      interactionRate: Number(work.interactionRate) || 0
    }))
    .sort((a, b) => {
      const at = parseDashboardDate(a.publishAt || a.publishDate)?.getTime() || 0
      const bt = parseDashboardDate(b.publishAt || b.publishDate)?.getTime() || 0
      return bt - at || b.views - a.views || b.likes - a.likes
    })
    .map((item, index) => ({ ...item, rank: index + 1 }))
})
const postBarModalTitle = computed(() => {
  const label = selectedPostBar.value?.label || '发布明细'
  return `${label}发布内容`
})
const postBarModalSubtitle = computed(() => {
  const granularity = postGranularity.value === 'week' ? '按周统计' : '按日统计'
  return `${activeRangeMeta.value.label}口径 · ${activePlatformLabel.value} · ${activeGroupLabel.value} · ${granularity}`
})
const postBarModalTotals = computed(() => ({
  views: sumBy(postBarModalRows.value, item => Number(item.views) || 0),
  likes: sumBy(postBarModalRows.value, item => Number(item.likes) || 0),
  comments: sumBy(postBarModalRows.value, item => Number(item.comments) || 0)
}))

const constellationRows = computed(() => {
  const palette = ['#ff6b00', '#2f9bf0', '#8b6be8', '#f94d6a', '#18a058', '#ffa000']
  const positions = [
    [34, 22], [66, 22], [19, 52], [82, 53], [42, 78], [60, 78],
    [16, 30], [86, 31], [28, 70], [72, 70], [49, 14], [50, 88]
  ]
  const rows = [...dashboardRows.value]
    .map((item) => {
      const energy = Math.round(rangeViews(item) * 0.68 + rangeLikes(item) * 4.4 + rangeFans(item) * 18 + rangePosts(item) * 120)
      return { ...item, energy }
    })
    .sort((a, b) => b.energy - a.energy)
    .slice(0, 12)
  const max = Math.max(1, ...rows.map(item => item.energy))
  return rows.map((item, index) => {
    const [x, y] = positions[index] || [50, 50]
    const score = Math.max(0, item.energy / max)
    return {
      ...item,
      rank: index + 1,
      x,
      y,
      size: Math.round(70 + score * 58),
      color: palette[index % palette.length],
      valueLabel: formatCompactNumber(rangeViews(item)),
      tag: index === 0 ? '全场主星' : index < 3 ? '高光轨道' : index < 7 ? '稳定发光' : '潜力节点'
    }
  })
})

const overviewPlayRankRows = computed(() => {
  const rows = [...playRankRows.value]
    .sort((a, b) => rangeViews(b) - rangeViews(a))
    .slice(0, 12)
  const total = Math.max(1, sumBy(playRankRows.value, rangeViews))
  const max = Math.max(1, ...rows.map(rangeViews))
  return rows.map((item, index) => ({
      ...item,
      rank: index + 1,
      value: rangeViews(item),
      width: Math.max(8, Math.round(rangeViews(item) / max * 100)),
      share: Math.max(1, Math.round(rangeViews(item) / total * 100))
    }))
})

const overviewPostBars = computed(() => {
  if (hasPublishStats.value) {
    const limit = postGranularity.value === 'week' ? 8 : 14
    const slots = postGranularity.value === 'week'
      ? postChartWeekSlots(limit)
      : postChartDaySlots(limit)
    const buckets = new Map(slots.map(slot => [slot.key, { ...slot, value: 0, works: [] }]))
    publishDisplayStatRows.value.forEach((row) => {
      const date = parseDashboardDate(row?.date)
      if (!date) return
      let key = dashboardDateKey(date)
      if (postGranularity.value === 'week') {
        const start = startOfDashboardWeek(date)
        key = dashboardDateKey(start)
      }
      const current = buckets.get(key)
      if (!current) return
      current.value += Number(row?.count) || 0
      buckets.set(key, current)
    })
    displayPostWorks.value.forEach((work) => {
      const date = parseDashboardDate(work.publishDate || work.publishAt)
      if (!date) return
      let key = dashboardDateKey(date)
      if (postGranularity.value === 'week') key = dashboardDateKey(startOfDashboardWeek(date))
      const current = buckets.get(key)
      if (!current) return
      current.works.push(work)
      buckets.set(key, current)
    })
    const bars = slots.map(slot => buckets.get(slot.key) || { ...slot, value: 0, works: [] })
    const max = Math.max(1, ...bars.map(item => item.value))
    return bars.map(item => ({
      key: item.key,
      label: item.label,
      value: item.value,
      height: item.value ? Math.max(8, Math.round(item.value / max * 100)) : 0,
      works: [...(item.works || [])].sort((a, b) => {
        const at = parseDashboardDate(a.publishAt || a.publishDate)?.getTime() || 0
        const bt = parseDashboardDate(b.publishAt || b.publishDate)?.getTime() || 0
        return bt - at || (Number(b.views) || 0) - (Number(a.views) || 0)
      }),
      tooltip: item.value
        ? [
            `${item.label} · ${item.value}篇`,
            ...item.works
              .slice(0, 12)
              .map(work => `${cleanTooltipText(work.account)} / ${cleanTooltipText(work.platformLabel || work.platform)} / ${cleanTooltipText(work.title) || '未知标题'}`),
            item.works.length > 12 ? `还有 ${item.works.length - 12} 条未展示` : ''
          ].filter(Boolean).join('\n')
        : `${item.label} · 0篇`
    }))
  }
  return []
})

const postPeakRows = computed(() => {
  const rows = [...overviewPostBars.value].filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 4)
  const max = Math.max(1, ...rows.map(item => item.value))
  return rows.map(item => ({
    ...item,
    width: Math.max(8, Math.round(item.value / max * 100))
  }))
})

const postRhythmCards = computed(() => {
  const rows = overviewPostBars.value
  const total = sumBy(rows, item => item.value)
  const avg = rows.length ? Math.round(total / rows.length) : 0
  const peak = postPeakRows.value[0]
  const activeSlots = total ? rows.filter(item => item.value >= Math.max(1, avg)).length : 0
  return [
    { key: 'peak', label: '峰值档期', value: peak ? peak.label : '-', note: peak ? `${peak.value} 篇集中发力` : '等待数据' },
    { key: 'avg', label: '平均火力', value: `${avg}篇`, note: postGranularity.value === 'week' ? '每周均值' : '每个采样日均值' },
    { key: 'active', label: '活跃节点', value: `${activeSlots}/${rows.length}`, note: '高于均值的发布节点' }
  ]
})

const groupBattleRows = computed(() => {
  const map = new Map()
  filteredAccounts.value.forEach((item) => {
    const current = map.get(item.groupName) || {
      groupName: item.groupName,
      accountCount: 0,
      score: 0,
      completionTotal: 0
    }
    current.accountCount += 1
    current.score += accountBattleScore(item)
    current.completionTotal += completionRate(item)
    map.set(item.groupName, current)
  })
  const rows = Array.from(map.values())
    .map(item => ({
      ...item,
      score: Math.round(item.score),
      completionRate: item.accountCount ? Math.round(item.completionTotal / item.accountCount) : 0
    }))
    .sort((a, b) => b.score - a.score)
  const max = Math.max(1, ...rows.map(item => item.score))
  return rows.map(item => ({ ...item, width: Math.max(6, Math.round(item.score / max * 100)) }))
})

const battleChampion = computed(() => groupBattleRows.value[0] || null)

const battleTreeRows = computed(() => {
  const palette = ['#ff6b00', '#2f9bf0', '#8b6be8', '#f94d6a', '#18a058', '#ffa000']
  return groupBattleRows.value.slice(0, 6).map((group, index) => {
    const accounts = filteredAccounts.value
      .filter(item => item.groupName === group.groupName)
      .map(item => ({
        ...item,
        battleScore: accountBattleScore(item),
        completionRate: completionRate(item)
      }))
      .sort((a, b) => b.battleScore - a.battleScore)
      .slice(0, 5)
    const maxLeafScore = Math.max(1, ...accounts.map(item => item.battleScore))
    return {
      ...group,
      color: palette[index % palette.length],
      meme: battleMemePool[index % battleMemePool.length],
      leaves: accounts.map((account, leafIndex) => {
        const type = contentType(account)
        const completion = account.completionRate >= 70 ? '完播能打' : account.completionRate >= 55 ? '稳健输出' : '蓄力中'
        return {
          id: `${group.groupName}-${account.id}`,
          account: account.account,
          platformLabel: account.platformLabel || account.platform,
          score: account.battleScore,
          tag: leafIndex === 0 ? '组内主C' : `${type} · ${completion}`,
          typeClass: type === '商单' ? 'is-business' : 'is-daily',
          width: Math.max(18, Math.round(account.battleScore / maxLeafScore * 100))
        }
      })
    }
  })
})

const battleSummaryCards = computed(() => {
  const rows = filteredAccounts.value
  const champion = battleChampion.value
  const usingRealWorks = dashboardWorks.value.length > 0
  const workRows = dashboardWorks.value.length ? displayPostWorks.value : []
  const businessPosts = usingRealWorks
    ? workRows.filter(item => item.contentType === '商单').length
    : sumBy(rows.filter(item => contentType(item) === '商单'), rangePosts)
  const dailyPosts = usingRealWorks
    ? workRows.filter(item => item.contentType !== '商单').length
    : sumBy(rows.filter(item => contentType(item) === '日常'), rangePosts)
  const avgCompletion = rows.length ? Math.round(sumBy(rows, completionRate) / rows.length) : 0
  const fanDelta = sumBy(rows, item => rangeFans(item))
  return [
    {
      key: 'champion',
      label: '当前战力冠军',
      value: champion?.groupName || '-',
      note: champion ? `指数 ${champion.score}` : '等待数据',
      color: metricColors.battle
    },
    {
      key: 'business',
      label: '商单发文',
      value: `${businessPosts}篇`,
      note: `日常 ${dailyPosts}篇`,
      color: metricColors.posts
    },
    {
      key: 'completion',
      label: '平均完播率',
      value: `${avgCompletion}%`,
      note: rows.length ? '账号均值' : '等待数据',
      color: metricColors.completion
    },
    {
      key: 'fans',
      label: '粉丝变化',
      value: signedDeltaText(fanDelta),
      note: `${activeRangeMeta.value.label}口径`,
      color: metricColors.fans
    }
  ]
})

const postStructureRows = computed(() => {
  return groupBattleRows.value.map((group) => {
    const rows = filteredAccounts.value.filter(item => item.groupName === group.groupName)
    const usingRealWorks = dashboardWorks.value.length > 0
    const workRows = usingRealWorks ? displayPostWorks.value.filter(item => item.groupName === group.groupName) : []
    const business = usingRealWorks
      ? workRows.filter(item => item.contentType === '商单').length
      : sumBy(rows.filter(item => contentType(item) === '商单'), rangePosts)
    const daily = usingRealWorks
      ? workRows.filter(item => item.contentType !== '商单').length
      : sumBy(rows.filter(item => contentType(item) === '日常'), rangePosts)
    const total = business + daily
    const totalBase = Math.max(1, total)
    return {
      groupName: group.groupName,
      business,
      daily,
      total,
      businessWidth: business ? Math.max(4, Math.round(business / totalBase * 100)) : 0,
      dailyWidth: daily ? Math.max(4, Math.round(daily / totalBase * 100)) : 0
    }
  }).slice(0, 6)
})

const completionRows = computed(() => {
  return [...filteredAccounts.value]
    .map(item => ({ ...item, completionRate: completionRate(item) }))
    .sort((a, b) => b.completionRate - a.completionRate)
    .slice(0, 5)
})

const groupFanTrendLines = computed(() => {
  const palette = ['#2f9bf0', '#ff6b00', '#8b6be8', '#f94d6a']
  const groups = groupBattleRows.value.slice(0, 4).map(item => item.groupName)
  return groups.map((groupName, index) => {
    const rows = filteredAccounts.value.filter(item => item.groupName === groupName)
    const values = Array.from({ length: 8 }, (_, pointIndex) => {
      return rows.reduce((sum, item) => sum + (item.fanTrend?.[pointIndex] || 0), 0)
    })
    return {
      groupName,
      color: palette[index % palette.length],
      points: linePoints(values)
    }
  })
})

const hotVideoRows = computed(() => {
  if (dashboardWorks.value.length) {
    const accountIds = new Set(filteredAccounts.value.map(item => item.id))
    const rows = dashboardWorks.value
      .filter(item => !accountIds.size || accountIds.has(item.accountId))
      .filter(item => !item.publishVolumeExcluded)
      .filter(item => workInDashboardRange(item))
      .map(item => ({
        ...item,
        contentType: item.contentType || '日常',
        completionRate: Number(item.completionRate) || 0,
        interactionRate: Number(item.interactionRate) || 0,
        hotIndex: Number(item.hotIndex) || 0,
        level: item.level || '潜力'
      }))
      .sort((a, b) => b.hotIndex - a.hotIndex || b.views - a.views)
    const max = Math.max(1, ...rows.map(item => item.hotIndex || item.views || 0))
    return rows.map(item => ({ ...item, width: Math.max(8, Math.round((item.hotIndex || item.views || 0) / max * 100)) }))
  }
  return []
})

const topHotVideo = computed(() => hotVideoRows.value[0] || null)

const hotVideoSummaryCards = computed(() => {
  const rows = hotVideoRows.value
  const top = rows[0]
  const topLevelCount = rows.filter(item => item.level === 'S级' || item.level === 'A级').length
  const businessCount = rows.filter(item => item.contentType === '商单').length
  const avgCompletion = rows.length ? Math.round(sumBy(rows, item => item.completionRate) / rows.length) : 0
  return [
    {
      key: 'count',
      label: '爆款作品数',
      value: topLevelCount,
      note: `${rows.length} 条作品池`,
      color: metricColors.battle
    },
    {
      key: 'top',
      label: '最高爆款指数',
      value: top?.hotIndex || 0,
      note: top?.account || '等待数据',
      color: metricColors.views
    },
    {
      key: 'completion',
      label: '平均完播率',
      value: `${avgCompletion}%`,
      note: '爆款池均值',
      color: metricColors.completion
    },
    {
      key: 'business',
      label: '商单占比',
      value: rows.length ? `${Math.round(businessCount / rows.length * 100)}%` : '0%',
      note: '商单按 1.5x 权重计入',
      color: metricColors.posts
    }
  ]
})

const hotFactorRows = computed(() => {
  const top = topHotVideo.value
  if (!top) return []
  const values = [
    { key: 'views', label: '播放贡献', value: formatCompactNumber(top.views), raw: top.views / 1000, note: '播放基底', color: metricColors.views },
    { key: 'interaction', label: '互动贡献', value: `${top.interactionRate}%`, raw: top.interactionRate * 120, note: '点赞评论分享', color: metricColors.likes },
    { key: 'completion', label: '完播贡献', value: `${top.completionRate}%`, raw: top.completionRate * 34, note: '完播率视角', color: metricColors.completion },
    { key: 'business', label: '内容权重', value: top.contentType, raw: top.contentType === '商单' ? 1800 : 1000, note: top.contentType === '商单' ? '商单 1.5x' : '日常 1x', color: metricColors.posts }
  ]
  const max = Math.max(1, ...values.map(item => item.raw))
  return values.map(item => ({ ...item, width: Math.max(8, Math.round(item.raw / max * 100)) }))
})

function metricValue(item, metric) {
  if (metric === 'fans') return rangeFans(item)
  if (metric === 'posts') return rangePosts(item)
  if (metric === 'views') return rangeViews(item)
  if (metric === 'likes') return rangeLikes(item)
  if (metric === 'completion') return completionRate(item)
  return Number(item?.[metric]) || 0
}

function signedDeltaText(value) {
  const number = Number(value) || 0
  if (number > 0) return `+${formatCompactNumber(number)}`
  if (number < 0) return `-${formatCompactNumber(Math.abs(number))}`
  return '0'
}

function deltaClass(value) {
  const number = Number(value) || 0
  if (number > 0) return 'delta-up'
  if (number < 0) return 'delta-down'
  return 'delta-flat'
}

const detailMetricLabel = computed(() => {
  const map = {
    fans: activeRangeMeta.value.total ? '总粉丝数排序' : `${activeRangeMeta.value.label}粉丝增量排序`,
    posts: activeRangeMeta.value.total ? '总发布数排序' : `${activeRangeMeta.value.label}发布增量排序`,
    views: activeRangeMeta.value.total ? '总曝光量排序' : `${activeRangeMeta.value.label}曝光增量排序`,
    likes: activeRangeMeta.value.total ? '总点赞数排序' : `${activeRangeMeta.value.label}点赞增量排序`
  }
  return map[detailMetric.value] || '账号明细'
})

const detailRows = computed(() => {
  return [...filteredAccounts.value]
    .sort((a, b) => metricValue(b, detailMetric.value) - metricValue(a, detailMetric.value))
})

const selectedAccount = computed(() => {
  return filteredAccounts.value.find(item => item.id === selectedAccountId.value) || filteredAccounts.value[0] || null
})

const selectedLikeTrend = computed(() => {
  const account = selectedAccount.value
  if (!account) return []
  if (Array.isArray(account.likeTrend) && account.likeTrend.length) return account.likeTrend
  const baseRate = Math.max(0.018, account.yesterdayLikes / Math.max(1, account.yesterdayViews))
  return account.trend.map(value => Math.round(value * baseRate))
})

const singleTrendMetrics = computed(() => {
  const account = selectedAccount.value
  if (!account) return []
  return [
    {
      key: 'views',
      label: '播放趋势',
      value: formatCompactNumber(account.yesterdayViews),
      note: '昨日新增播放',
      color: metricColors.views,
      points: trendPoints(account.trend)
    },
    {
      key: 'likes',
      label: '点赞趋势',
      value: formatCompactNumber(account.yesterdayLikes),
      note: '昨日新增点赞',
      color: metricColors.likes,
      points: trendPoints(selectedLikeTrend.value)
    },
    {
      key: 'fans',
      label: '粉丝趋势',
      value: signedDeltaText(account.followerDelta),
      note: '最近快照变化',
      color: metricColors.fans,
      points: trendPoints(account.fanTrend)
    }
  ]
})

const selectedAccountWorks = computed(() => {
  const account = selectedAccount.value
  if (!account || !dashboardWorks.value.length) return []
  const accountId = String(account.id || '').trim()
  const accountName = String(account.account || '').trim()
  return dashboardWorks.value
    .filter((work) => {
      if (accountId && String(work.accountId || '').trim() === accountId) return true
      if (accountName && String(work.account || '').trim() === accountName) return true
      return false
    })
    .map((work) => ({
      ...work,
      title: work.title || '未命名作品',
      contentType: work.contentType || '视频',
      views: Number(work.views) || 0,
      likes: Number(work.likes) || 0,
      comments: Number(work.comments) || 0,
      completionRate: Number(work.completionRate) || 0,
      hotIndex: Number(work.hotIndex) || 0
    }))
    .sort((a, b) => {
      const at = parseDashboardDate(a.publishDate || a.publishAt)?.getTime() || 0
      const bt = parseDashboardDate(b.publishDate || b.publishAt)?.getTime() || 0
      return bt - at || b.views - a.views || b.hotIndex - a.hotIndex
    })
})

async function loadRealDashboard(options = {}) {
  const requestSeq = ++dashboardRequestSeq
  const useHistory = options.historyPeriodEnabled !== undefined
    ? Boolean(options.historyPeriodEnabled)
    : Boolean(historyPeriodEnabled.value)
  const historyMonth = useHistory ? String(options.historyMonth || selectedHistoryMonthKey.value) : ''
  const workScope = options.workScope || ((activeRange.value === 'year' || activeRange.value === 'all') ? 'all' : 'month')
  // Background refreshes must not put an already usable dashboard back into
  // the blocking loading state while publication details are being hydrated.
  dashboardLoading.value = !realDashboard.value
  dashboardError.value = ''
  try {
    const data = await loadAccountDataDashboard({
      historyMonth,
      workScope,
      forceRefresh: Boolean(options.forceRefresh)
    })
    if (requestSeq !== dashboardRequestSeq) return
    const stillSameHistoryState = useHistory === Boolean(historyPeriodEnabled.value)
    const stillSameHistoryMonth = !useHistory || historyMonth === selectedHistoryMonthKey.value
    if (!stillSameHistoryState || !stillSameHistoryMonth) return
    realDashboard.value = data || null
    const digest = data?.collectionIndex?.sourceStats?.digest || data?.collectionIndex?.generatedAt || ''
    if (digest) lastIndexDigest = digest
    if (data?.worksDeferred && Number(data?.worksTotal) > 0) {
      dashboardLoading.value = false
      loadAccountDataDashboardWorks({
        historyMonth,
        workScope,
        worksTotal: data.worksTotal
      }).then((works) => {
        if (requestSeq !== dashboardRequestSeq) return
        const sameHistoryState = useHistory === Boolean(historyPeriodEnabled.value)
        const sameHistoryMonth = !useHistory || historyMonth === selectedHistoryMonthKey.value
        if (!sameHistoryState || !sameHistoryMonth) return
        realDashboard.value = { ...data, works, worksDeferred: false }
      }).catch(() => {})
    }
  } catch (e) {
    if (requestSeq !== dashboardRequestSeq) return
    dashboardError.value = e?.message || String(e || '读取失败')
    realDashboard.value = null
  } finally {
    if (requestSeq === dashboardRequestSeq) dashboardLoading.value = false
  }
}

async function syncDashboardAfterCollect() {
  try {
    const data = await loadAccountDataCollectStatus()
    const running = Boolean(data?.state?.running)
    const digest = data?.index?.sourceStats?.digest || data?.index?.generatedAt || ''
    const changed = Boolean(digest && lastIndexDigest && digest !== lastIndexDigest)
    const justFinished = lastCollectionRunning && !running
    lastCollectionRunning = running
    if (digest) lastIndexDigest = digest
    if ((changed || justFinished) && !dashboardLoading.value && !historyPeriodEnabled.value) {
      await loadRealDashboard({ historyPeriodEnabled: false })
    }
  } catch (e) {}
}

watch([historyPeriodEnabled, selectedHistoryYear, selectedHistoryMonth], () => {
  loadRealDashboard({
    historyPeriodEnabled: historyPeriodEnabled.value,
    historyMonth: selectedHistoryMonthKey.value
  })
})

watch(activeRange, (range) => {
  if (!historyPeriodEnabled.value && (range === 'year' || range === 'all')) {
    loadRealDashboard({ historyPeriodEnabled: false, workScope: 'all' })
  }
})

onMounted(() => {
  window.requestAnimationFrame(() => {
    dashboardRootRef.value?.scrollIntoView({ block: 'start' })
  })
  loadRealDashboard({ historyPeriodEnabled: false })
  syncDashboardAfterCollect()
  dashboardPollTimer = window.setInterval(syncDashboardAfterCollect, 30000)
})

onUnmounted(() => {
  if (dashboardPollTimer) window.clearInterval(dashboardPollTimer)
  dashboardPollTimer = null
})
</script>

<style scoped>
.account-data-module {
  --ad-page: var(--page-bg, var(--bg, #f5f6f8));
  --ad-card: var(--panel-bg, var(--bg-card, #fff));
  --ad-card-strong: var(--card-bg-hover, var(--ad-card));
  --ad-soft: var(--panel-bg-soft, #f8f9fb);
  --ad-row: var(--row-bg, #f8f9fb);
  --ad-row-hover: var(--row-bg-hover, #fff7f0);
  --ad-control: var(--control-bg, #fff);
  --ad-control-hover: var(--control-bg-hover, #fff7f0);
  --ad-border: var(--border, #edf0f4);
  --ad-border-strong: var(--border-mid, var(--ad-border));
  --ad-text: var(--text, #202330);
  --ad-text-strong: var(--text-primary, var(--text, #202330));
  --ad-muted: var(--text-muted, #8b92a0);
  --ad-subtle: var(--text-dim, #596172);
  --ad-shadow: var(--shadow, 0 8px 24px rgba(31, 41, 55, .06));
  --ad-shadow-soft: var(--shadow-sm, 0 8px 18px rgba(31, 41, 55, .035));
  --ad-accent-soft: color-mix(in srgb, var(--orange) 12%, transparent);
  --ad-chart-bg: linear-gradient(180deg, var(--ad-soft), var(--ad-card));
  --ad-on-accent: #fff;
  --board-bg: var(--ad-page);
  --card-bg: var(--ad-card);
  --card-border: var(--ad-border);
  --orange: var(--accent, #ff6b00);
  --business: #ff6b00;
  --suspect: #8b6be8;
  --distribution: #00a67e;
  --daily: #64748b;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 100%;
  margin: -8px -16px 0;
  padding: 20px 20px 24px;
  border-radius: 10px;
  background: var(--board-bg);
  color: var(--ad-text);
}

:global(:root[data-ui-style="violet"] .account-data-module) {
  --ad-page:
    radial-gradient(circle at 12% 0%, rgba(167, 139, 250, .14), transparent 32%),
    radial-gradient(circle at 92% 12%, rgba(0, 245, 212, .1), transparent 30%),
    var(--page-bg);
  --ad-card: rgba(18, 18, 42, .82);
  --ad-card-strong: rgba(32, 29, 56, .92);
  --ad-soft: rgba(32, 29, 56, .56);
  --ad-row: rgba(255, 255, 255, .045);
  --ad-row-hover: rgba(167, 139, 250, .12);
  --ad-control: rgba(32, 29, 56, .82);
  --ad-control-hover: rgba(42, 37, 70, .94);
  --ad-border: rgba(196, 181, 253, .2);
  --ad-border-strong: rgba(196, 181, 253, .32);
  --ad-chart-bg: linear-gradient(180deg, rgba(32, 29, 56, .5), rgba(18, 18, 42, .78));
  --ad-shadow-soft: 0 14px 28px rgba(0, 0, 0, .18);
  --orange: var(--accent);
}

:global(:root[data-ui-style="apple"] .account-data-module) {
  --ad-page: linear-gradient(180deg, #f5f7fb 0%, #eef2f7 100%);
  --ad-card: rgba(255, 255, 255, .78);
  --ad-card-strong: rgba(255, 255, 255, .94);
  --ad-soft: rgba(246, 246, 248, .78);
  --ad-row: rgba(247, 249, 252, .9);
  --ad-row-hover: rgba(235, 244, 255, .92);
  --ad-control: rgba(255, 255, 255, .82);
  --ad-control-hover: rgba(245, 249, 255, .96);
  --ad-chart-bg: linear-gradient(180deg, rgba(251, 252, 255, .9), rgba(255, 255, 255, .86));
  --orange: var(--accent);
}

:global(:root[data-ui-style="usagi"] .account-data-module) {
  --ad-page:
    radial-gradient(circle at 8% 8%, rgba(255, 216, 79, .28), transparent 26%),
    radial-gradient(circle at 88% 14%, rgba(255, 159, 181, .16), transparent 28%),
    var(--page-bg);
  --ad-card: rgba(255, 251, 241, .82);
  --ad-card-strong: rgba(255, 253, 247, .96);
  --ad-soft: rgba(239, 222, 190, .58);
  --ad-row: rgba(255, 255, 250, .55);
  --ad-row-hover: rgba(232, 203, 118, .18);
  --ad-control: rgba(250, 239, 214, .88);
  --ad-control-hover: rgba(244, 225, 190, .96);
  --ad-border: rgba(110, 72, 47, .14);
  --ad-border-strong: rgba(177, 119, 28, .24);
  --ad-chart-bg: linear-gradient(180deg, rgba(255, 249, 235, .9), rgba(255, 251, 241, .78));
  --ad-shadow-soft: var(--usagi-sticker-shadow);
  --orange: var(--usagi-orange);
  --ad-on-accent: var(--usagi-ink);
}

.board-top {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 16px;
  border-radius: 8px;
  background: var(--card-bg);
}

.board-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 190px;
  flex: 0 0 auto;
}

.board-title i {
  width: 7px;
  height: 26px;
  border-radius: 999px;
  background: var(--orange);
}

.board-title strong {
  font-size: 22px;
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
}

.board-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.view-tabs,
.platform-tabs,
.range-tabs {
  display: inline-flex;
  align-items: center;
  border: 1px solid #d9dee8;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}

.view-tab,
.platform-tab,
.range-tab {
  height: 30px;
  min-width: 56px;
  padding: 0 13px;
  border: 0;
  border-right: 1px solid #d9dee8;
  background: #fff;
  color: #586070;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.platform-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.platform-tab i,
.platform-badge {
  width: 20px;
  height: 20px;
  display: inline-grid;
  place-items: center;
  flex: 0 0 20px;
  border-radius: 6px;
  color: #fff;
  font-size: 11px;
  font-style: normal;
  font-weight: 900;
  line-height: 1;
}

.platform-badge {
  width: 22px;
  height: 22px;
  margin-right: 5px;
}

.platform-tab i img,
.platform-badge img {
  width: 86%;
  height: 86%;
  display: block;
  border-radius: 4px;
  object-fit: contain;
  background: rgba(255, 255, 255, .12);
}

.platform-all {
  background: #5f6878;
}

.platform-douyin {
  background: linear-gradient(135deg, #111827, #ff2f6d);
}

.platform-bilibili {
  background: linear-gradient(135deg, #00a1d6, #fb7299);
}

.platform-kuaishou {
  background: linear-gradient(135deg, #ff7a00, #facc15);
}

.platform-default {
  background: #7f8794;
}

.view-tab:last-child,
.platform-tab:last-child,
.range-tab:last-child {
  border-right: 0;
}

.view-tab.active,
.platform-tab.active,
.range-tab.active {
  color: var(--orange);
  background: #fff7f0;
  box-shadow: inset 0 0 0 1px var(--orange);
}

.platform-tab.platform-douyin.active {
  color: #111827;
  background: linear-gradient(180deg, rgba(17, 24, 39, .08), rgba(255, 47, 109, .07));
  box-shadow: inset 0 0 0 1px rgba(17, 24, 39, .28);
}

.platform-tab.platform-bilibili.active {
  color: #0077a8;
  background: linear-gradient(180deg, rgba(0, 161, 214, .11), rgba(251, 114, 153, .06));
  box-shadow: inset 0 0 0 1px rgba(0, 161, 214, .32);
}

.platform-tab.platform-kuaishou.active {
  color: #c75a00;
  background: linear-gradient(180deg, rgba(255, 122, 0, .12), rgba(250, 204, 21, .08));
  box-shadow: inset 0 0 0 1px rgba(255, 122, 0, .34);
}

.platform-tab.muted:not(.active) {
  opacity: .62;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: var(--card-bg);
}

.dashboard-collect-alert {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid #ffd4bf;
  border-radius: 8px;
  background: #fff7f2;
  color: #9a3412;
  font-size: 12px;
}

.dashboard-collect-alert strong {
  color: #c2410c;
}

.dashboard-collect-alert span {
  padding-left: 10px;
  border-left: 1px solid #f3b89f;
}

.filter-range {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-left: 6px;
}

.dimension-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.filter-range > span,
.dimension-switch > span {
  color: #596172;
  font-size: 12px;
  white-space: nowrap;
}

.dimension-tabs {
  display: inline-flex;
  align-items: center;
  border: 1px solid #d9dee8;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}

.dimension-tab {
  height: 30px;
  min-width: 54px;
  padding: 0 12px;
  border: 0;
  border-right: 1px solid #d9dee8;
  background: #fff;
  color: #586070;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dimension-tab:last-child {
  border-right: 0;
}

.dimension-tab.active {
  color: var(--orange);
  background: #fff7f0;
  box-shadow: inset 0 0 0 1px var(--orange);
}

.compact-select {
  width: 124px;
  height: 32px;
}

.compact-search {
  width: 180px;
  height: 32px;
}

.history-period-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
}

.history-period-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #d9dee8;
  border-radius: 4px;
  background: #fff;
  color: #586070;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.history-period-toggle input {
  margin: 0;
}

.history-period-select {
  width: 78px;
  height: 32px;
  padding: 0 8px;
}

.history-period-select:disabled {
  opacity: .48;
  cursor: not-allowed;
}

.dashboard-refresh-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #d9dee8;
  border-radius: 4px;
  background: #fff;
  color: #586070;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.dashboard-refresh-btn:hover:not(:disabled) {
  color: var(--orange);
  border-color: var(--orange);
  background: #fff7f0;
}

.dashboard-refresh-btn:disabled {
  cursor: not-allowed;
  opacity: .58;
}

.dashboard-error-state {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin: 0 0 14px;
  border: 1px solid #f2c6bd;
  border-radius: 8px;
  background: #fff7f4;
  color: #924236;
}

.dashboard-error-state div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.dashboard-error-state strong {
  font-size: 13px;
}

.dashboard-error-state span {
  min-width: 0;
  overflow-wrap: anywhere;
  color: #a96155;
  font-size: 12px;
}

.snapshot-note,
.panel-head span,
.account-table-row span,
.single-profile span,
.single-profile em {
  color: #8b92a0;
  font-style: normal;
  font-size: 12px;
}

.overview-layout,
.single-layout,
.single-main,
.battle-layout,
.update-plan-layout,
.hot-video-layout {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
}

.kpi-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.kpi-card,
.chart-card,
.detail-card,
.battle-summary-card,
.battle-tree-card,
.battle-chart-card,
.update-summary-card,
.update-plan-progress-card,
.update-risk-card,
.update-plan-table-card,
.hot-summary-card,
.hot-hero-card,
.hot-factor-card,
.hot-rank-card,
.hot-table-card,
.single-profile-card,
.single-chart-card,
.single-history-card {
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: var(--card-bg);
}

.kpi-card {
  min-height: 104px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px;
}

.kpi-card div {
  display: grid;
  gap: 8px;
}

.kpi-card span {
  color: #596172;
  font-size: 13px;
}

.kpi-card strong {
  color: #222633;
  font-size: 24px;
  line-height: 1;
  letter-spacing: 0;
}

.kpi-card em {
  color: #9aa1ad;
  font-size: 12px;
  font-style: normal;
}

.kpi-card i {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  flex: 0 0 46px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--metric-color), color-mix(in srgb, var(--metric-color) 72%, #fff));
  color: #fff;
  font-style: normal;
  font-weight: 900;
  box-shadow: 0 12px 24px color-mix(in srgb, var(--metric-color) 24%, transparent);
}

.battle-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.hot-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.update-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.battle-summary-card {
  min-height: 96px;
  display: grid;
  gap: 8px;
  padding: 16px;
  border-left: 4px solid var(--metric-color);
}

.battle-summary-card span {
  color: #596172;
  font-size: 13px;
}

.battle-summary-card strong {
  color: #202330;
  font-size: 24px;
  line-height: 1;
}

.battle-summary-card em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.hot-summary-card {
  min-height: 96px;
  display: grid;
  gap: 8px;
  padding: 16px;
  border-top: 4px solid var(--metric-color);
}

.hot-summary-card span {
  color: #596172;
  font-size: 13px;
}

.hot-summary-card strong {
  color: #202330;
  font-size: 24px;
  line-height: 1;
}

.hot-summary-card em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.update-summary-card {
  min-height: 96px;
  display: grid;
  gap: 8px;
  padding: 16px;
  border-left: 4px solid var(--metric-color);
  background:
    radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--metric-color) 12%, transparent), transparent 42%),
    #fff;
}

.update-summary-card span {
  color: #596172;
  font-size: 13px;
}

.update-summary-card strong {
  color: #202330;
  font-size: 24px;
  line-height: 1;
}

.update-summary-card em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.battle-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.42fr) minmax(320px, .58fr);
  gap: 18px;
  align-items: start;
}

.update-plan-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, .92fr);
  gap: 18px;
  align-items: stretch;
}

.hot-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, .92fr);
  gap: 18px;
}

.hot-detail-grid {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.battle-sub-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.battle-tree-card,
.battle-chart-card,
.update-plan-progress-card,
.update-risk-card,
.update-plan-table-card,
.hot-hero-card,
.hot-factor-card,
.hot-rank-card,
.hot-table-card {
  min-height: 300px;
  padding: 18px;
}

.battle-tree-card {
  min-height: 440px;
  overflow: hidden;
}

.battle-tree {
  position: relative;
  min-height: 360px;
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 16px;
  padding: 12px;
  border: 1px solid #edf0f4;
  border-radius: 8px;
  background:
    radial-gradient(circle at 16% 18%, rgba(255, 107, 0, .12), transparent 28%),
    linear-gradient(135deg, #fffaf6 0%, #fff 45%, #f7fbff 100%);
}

.battle-tree::before {
  content: "";
  position: absolute;
  left: 164px;
  top: 40px;
  bottom: 34px;
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ff6b00, #2f9bf0, #8b6be8);
  opacity: .22;
}

.tree-root {
  position: sticky;
  top: 12px;
  z-index: 1;
  align-self: start;
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 8px;
  background: linear-gradient(145deg, #ff6b00, #ffa000);
  color: #fff;
  box-shadow: 0 18px 34px rgba(255, 107, 0, .22);
}

.tree-root span,
.tree-root em,
.tree-root b {
  color: rgba(255, 255, 255, .78);
  font-size: 12px;
  font-style: normal;
}

.tree-root strong {
  overflow: hidden;
  font-size: 20px;
  line-height: 1.1;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-root b {
  width: fit-content;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, .16);
  color: #fff;
  font-weight: 900;
}

.tree-branches {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 8px;
}

.tree-branch {
  position: relative;
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 8px;
  align-items: stretch;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--branch-color) 18%, #edf0f4);
  border-radius: 12px;
  background: rgba(255, 255, 255, .78);
  box-shadow: 0 10px 24px rgba(32, 35, 48, .04);
}

.tree-branch.champion {
  background: color-mix(in srgb, var(--branch-color) 8%, #fff);
  box-shadow: 0 14px 28px color-mix(in srgb, var(--branch-color) 14%, transparent);
}

.tree-branch-line {
  position: absolute;
  left: -18px;
  top: 50%;
  width: 18px;
  height: 2px;
  border-radius: 999px;
  background: var(--branch-color);
  opacity: .45;
}

.tree-group-node {
  min-width: 0;
  display: grid;
  align-content: center;
  gap: 4px;
  padding: 9px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--branch-color) 9%, #fff);
}

.tree-group-node span {
  color: var(--branch-color);
  font-size: 11px;
  font-weight: 900;
}

.tree-group-node strong {
  overflow: hidden;
  color: #202330;
  font-size: 16px;
  line-height: 1.1;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-group-node em {
  color: #7f8794;
  font-size: 11px;
  font-style: normal;
  line-height: 1.25;
}

.tree-leaves {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  gap: 6px;
}

.tree-leaf {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto 4px;
  gap: 3px 6px;
  padding: 7px 8px;
  border-radius: 7px;
  background: #fff;
  box-shadow: inset 0 0 0 1px #edf0f4;
}

.tree-leaf.is-business {
  box-shadow: inset 0 0 0 1px rgba(255, 107, 0, .25);
}

.tree-leaf.is-daily {
  box-shadow: inset 0 0 0 1px rgba(139, 107, 232, .22);
}

.tree-leaf b,
.tree-leaf em {
  grid-column: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-leaf b {
  grid-row: 1;
  color: #202330;
  font-size: 12px;
}

.tree-leaf em {
  grid-row: 2;
  color: #8b92a0;
  font-size: 11px;
  font-style: normal;
}

.tree-leaf i {
  grid-column: 2;
  grid-row: 1 / 3;
  align-self: center;
  color: var(--branch-color);
  font-size: 13px;
  font-style: normal;
  font-weight: 900;
}

.tree-leaf u {
  grid-column: 1 / 3;
  width: var(--leaf-width);
  height: 4px;
  border-radius: 999px;
  background: var(--branch-color);
}

.hot-hero-card {
  min-height: 260px;
}

.hot-hero {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
  min-height: 104px;
  padding: 16px;
  border-radius: 8px;
  background: linear-gradient(135deg, #fff7f0, #fff);
}

.hot-hero > i {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: var(--orange);
  color: #fff;
  font-style: normal;
  font-weight: 900;
  box-shadow: 0 14px 28px rgba(255, 107, 0, .22);
}

.hot-hero div {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.hot-hero strong {
  overflow: hidden;
  color: #202330;
  font-size: 22px;
  line-height: 1.25;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hot-hero span {
  color: #8b92a0;
  font-size: 12px;
}

.hot-hero-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.hot-hero-metrics span {
  display: grid;
  gap: 5px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f8f9fb;
  color: #7f8794;
  font-size: 12px;
}

.hot-hero-metrics b {
  color: #202330;
  font-size: 18px;
}

.hot-score-bar {
  height: 8px;
  margin-top: 16px;
  overflow: hidden;
  border-radius: 999px;
  background: #f1f3f6;
}

.hot-score-bar u {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--orange);
}

.plan-progress-hero {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 20px;
  align-items: center;
  min-height: 220px;
  padding: 18px;
  border: 1px solid #edf0f4;
  border-radius: 8px;
  background:
    radial-gradient(circle at 12% 12%, rgba(0, 166, 126, .12), transparent 28%),
    linear-gradient(135deg, #f7fffc 0%, #fff 52%, #fff7f0 100%);
}

.plan-progress-orb {
  position: relative;
  width: 150px;
  height: 150px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(#00a67e var(--plan-rate), #edf0f4 0deg);
  box-shadow: 0 16px 30px rgba(0, 166, 126, .14);
}

.plan-progress-orb::before {
  content: "";
  position: absolute;
  inset: 14px;
  border-radius: inherit;
  background: #fff;
  box-shadow: inset 0 0 0 1px #edf0f4;
}

.plan-progress-orb strong,
.plan-progress-orb span {
  position: relative;
  z-index: 1;
}

.plan-progress-orb strong {
  align-self: end;
  color: #202330;
  font-size: 30px;
  line-height: 1;
}

.plan-progress-orb span {
  align-self: start;
  margin-top: 7px;
  color: #8b92a0;
  font-size: 12px;
  font-weight: 900;
}

.plan-progress-copy {
  min-width: 0;
  display: grid;
  gap: 10px;
}

.plan-progress-copy span {
  color: #00a67e;
  font-size: 12px;
  font-weight: 900;
}

.plan-progress-copy strong {
  color: #202330;
  font-size: 30px;
  line-height: 1;
}

.plan-progress-copy em {
  color: #6d7584;
  font-size: 13px;
  font-style: normal;
}

.plan-progress-bar,
.update-group-row i {
  overflow: hidden;
  border-radius: 999px;
  background: #edf0f4;
}

.plan-progress-bar {
  height: 10px;
  margin-top: 4px;
}

.plan-progress-bar u,
.update-group-row u {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #00a67e, #ff9f43);
}

.update-risk-list,
.update-group-list {
  display: grid;
  gap: 10px;
}

.update-risk-row {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) 64px;
  gap: 10px;
  align-items: center;
  min-height: 52px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f8f9fb;
}

.update-risk-row div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.update-risk-row strong,
.update-risk-row em {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.update-risk-row strong {
  color: #202330;
  font-size: 13px;
}

.update-risk-row em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.update-risk-row b {
  color: #ef4444;
  font-size: 12px;
  text-align: right;
}

.plan-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: #596172;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.plan-status.done {
  background: #e7f7ef;
  color: #00a67e;
}

.plan-status.on-track {
  background: #fff7e8;
  color: #f59f00;
}

.plan-status.behind,
.plan-status.unmatched {
  background: #fff0f0;
  color: #ef4444;
}

.plan-status.paused {
  background: #f1f3f6;
  color: #8b92a0;
}

.plan-empty {
  min-height: 120px;
  display: grid;
  place-items: center;
  border: 1px dashed #dce2ea;
  border-radius: 8px;
  color: #8b92a0;
  font-size: 13px;
}

.update-group-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(120px, .8fr) 44px;
  gap: 10px;
  align-items: center;
  min-height: 46px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f8f9fb;
}

.update-group-row div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.update-group-row strong,
.update-group-row em {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.update-group-row strong {
  color: #202330;
  font-size: 13px;
}

.update-group-row em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.update-group-row i {
  height: 8px;
}

.update-group-row b {
  color: #00a67e;
  font-size: 12px;
  text-align: right;
}

.hot-factor-list,
.hot-rank-list {
  display: grid;
  gap: 10px;
}

.hot-factor-row {
  display: grid;
  grid-template-columns: 82px 72px minmax(0, 1fr) 92px;
  gap: 10px;
  align-items: center;
  min-height: 42px;
}

.hot-factor-row span {
  color: #596172;
  font-size: 12px;
  font-weight: 900;
}

.hot-factor-row strong {
  color: var(--metric-color);
  font-size: 14px;
}

.hot-factor-row i {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #f1f3f6;
}

.hot-factor-row u {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--metric-color);
}

.hot-factor-row em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
  text-align: right;
}

.hot-rank-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 58px;
  gap: 10px;
  align-items: center;
  min-height: 46px;
  padding: 7px 8px;
  border-radius: 8px;
}

.hot-rank-row:hover {
  background: #f8f9fb;
}

.hot-rank-row > span {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #fff3e8;
  color: var(--orange);
  font-size: 11px;
  font-weight: 900;
}

.hot-rank-row div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.hot-rank-row strong,
.hot-rank-row em {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hot-rank-row strong {
  color: #202330;
  font-size: 13px;
}

.hot-rank-row em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.hot-rank-row b {
  color: var(--orange);
  font-size: 13px;
  text-align: right;
}

.battle-list,
.completion-list,
.post-stack {
  display: grid;
  gap: 8px;
}

.battle-list.large,
.completion-list.large,
.post-stack.tall {
  gap: 12px;
}

.battle-row {
  display: grid;
  grid-template-columns: 24px minmax(70px, .8fr) minmax(98px, 1fr) 56px;
  gap: 8px;
  align-items: center;
  min-height: 34px;
}

.battle-row > span {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: #fff3e8;
  color: var(--orange);
  font-size: 11px;
  font-weight: 900;
}

.battle-row b,
.completion-row b,
.post-stack-row b {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.battle-row em,
.completion-row em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.battle-row strong {
  color: var(--orange);
  font-size: 12px;
  text-align: right;
}

.battle-row i,
.completion-row i {
  grid-column: 2 / 5;
  height: 4px;
  border-radius: 999px;
  background: #f1f3f6;
  overflow: hidden;
}

.battle-row u {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--orange);
}

.fan-line-chart {
  width: 100%;
  height: 172px;
  display: block;
  border-radius: 8px;
  background: linear-gradient(180deg, #fbfcfe, #fff);
}

.fan-trend-large .fan-line-chart {
  height: 244px;
}

.fan-line-chart polyline {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.line-legend,
.stack-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 8px;
}

.line-legend span,
.stack-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #596172;
  font-size: 12px;
}

.line-legend i,
.stack-legend i {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.post-stack-row {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) 44px;
  gap: 8px;
  align-items: center;
  min-height: 28px;
}

.post-stack-row div {
  display: flex;
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: #f1f3f6;
}

.post-stack-row i,
.stack-legend i {
  display: block;
  height: 100%;
}

.post-stack-row span {
  color: #596172;
  font-size: 12px;
  text-align: right;
}

.business {
  background: var(--orange);
}

.daily {
  background: #8b6be8;
}

.completion-row {
  display: grid;
  grid-template-columns: minmax(76px, 1fr) 58px 46px;
  gap: 8px;
  align-items: center;
  min-height: 32px;
}

.completion-row strong {
  color: #18a058;
  font-size: 12px;
  text-align: right;
}

.completion-row i {
  grid-column: 1 / 4;
}

.completion-row u {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #18a058;
}

.analysis-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.panel-head,
.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
}

.chart-head {
  align-items: flex-start;
}

.panel-head strong,
.chart-head strong {
  color: #202330;
  font-size: 14px;
}

.chart-head-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.chart-board {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  align-items: start;
  align-content: start;
}

.account-cosmos-card {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: #fff;
}

.cosmos-stage {
  position: relative;
  min-height: 360px;
  overflow: hidden;
  border: 1px solid #edf0f4;
  border-radius: 8px;
  background:
    radial-gradient(circle at 20% 20%, rgba(47, 155, 240, .12), transparent 23%),
    radial-gradient(circle at 82% 28%, rgba(255, 107, 0, .1), transparent 21%),
    linear-gradient(135deg, #f9fbff 0%, #fff 48%, #fff8f2 100%);
}

.cosmos-stage::before {
  content: "";
  position: absolute;
  inset: 24px;
  border-radius: 999px;
  border: 1px dashed rgba(139, 146, 160, .22);
}

.cosmos-stage::after {
  content: "";
  position: absolute;
  inset: 70px 150px;
  border-radius: 999px;
  border: 1px dashed rgba(139, 146, 160, .16);
}

.cosmos-core {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  width: 150px;
  min-height: 86px;
  display: grid;
  gap: 6px;
  place-items: center;
  padding: 14px;
  border-radius: 18px;
  background: #202330;
  color: #fff;
  text-align: center;
  transform: translate(-50%, -50%);
  box-shadow: 0 18px 38px rgba(32, 35, 48, .16);
}

.cosmos-core span,
.cosmos-core em {
  color: rgba(255, 255, 255, .7);
  font-size: 11px;
  font-style: normal;
}

.cosmos-core strong {
  max-width: 100%;
  overflow: hidden;
  font-size: 18px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cosmos-node {
  position: absolute;
  left: var(--x);
  top: var(--y);
  z-index: 3;
  width: var(--size);
  height: var(--size);
  display: grid;
  place-items: center;
  align-content: center;
  gap: 3px;
  padding: 9px;
  border: 1px solid color-mix(in srgb, var(--tone) 38%, #fff);
  border-radius: 999px;
  background: color-mix(in srgb, var(--tone) 10%, #fff);
  color: #202330;
  text-align: center;
  transform: translate(-50%, -50%);
  box-shadow: 0 12px 26px color-mix(in srgb, var(--tone) 15%, transparent);
}

.cosmos-node.hot {
  background: linear-gradient(145deg, color-mix(in srgb, var(--tone) 78%, #fff), var(--tone));
  color: #fff;
}

.cosmos-node b {
  color: var(--tone);
  font-size: 11px;
  line-height: 1;
}

.cosmos-node.hot b,
.cosmos-node.hot em,
.cosmos-node.hot small {
  color: rgba(255, 255, 255, .82);
}

.cosmos-node strong,
.cosmos-node em,
.cosmos-node small {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cosmos-node strong {
  font-size: 12px;
}

.cosmos-node em,
.cosmos-node small {
  color: #8b92a0;
  font-size: 10px;
  font-style: normal;
}

.cosmos-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 10px;
}

.cosmos-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #596172;
  font-size: 12px;
}

.cosmos-legend i {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.cosmos-legend .views {
  background: #ffa000;
}

.cosmos-legend .likes {
  background: #f94d6a;
}

.cosmos-legend .fans {
  background: #2f9bf0;
}

.chart-card {
  min-width: 0;
  min-height: 322px;
  padding: 20px 20px 16px;
}

.chart-more-btn {
  border: 0;
  background: transparent;
  color: var(--orange);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 900;
}

.chart-more-btn:hover {
  text-decoration: underline;
}

.chart-legend {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  height: 20px;
  color: #596172;
  font-size: 12px;
}

.chart-legend i {
  width: 24px;
  height: 14px;
  border-radius: 4px;
  background: var(--metric-color);
}

.chart-stat-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 8px 0 10px;
}

.chart-stat-strip span {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--metric-color) 7%, #f8f9fb);
}

.chart-stat-strip em {
  overflow: hidden;
  color: #8b92a0;
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.chart-stat-strip b {
  overflow: hidden;
  color: #202330;
  font-size: 13px;
  line-height: 1.1;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.chart-detail-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.chart-detail-row {
  display: grid;
  grid-template-columns: 34px minmax(88px, .95fr) minmax(62px, .68fr) minmax(94px, 1.3fr) 68px 44px;
  gap: 10px;
  align-items: center;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 7px;
  background: #f8f9fb;
  font-size: 12px;
  transition: background .14s ease;
}

.chart-detail-row:hover {
  background: color-mix(in srgb, var(--metric-color) 9%, #f8f9fb);
}

.chart-detail-row span {
  color: var(--metric-color);
  font-weight: 900;
}

.chart-detail-row strong,
.chart-detail-row em {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.chart-detail-row strong {
  color: #202330;
  font-size: 12px;
}

.chart-detail-row em {
  color: #8b92a0;
  font-style: normal;
}

.chart-detail-row i {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--metric-color) 10%, #edf0f4);
}

.chart-detail-row u {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--metric-color);
}

.chart-detail-row b {
  overflow: hidden;
  color: #202330;
  font-size: 12px;
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.chart-detail-row small {
  color: #8b92a0;
  font-size: 11px;
  text-align: right;
}

.metric-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(20, 24, 34, .42);
  backdrop-filter: blur(4px);
}

.metric-modal {
  width: min(1120px, 96vw);
  max-height: min(760px, 88vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #e4e8ef;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(20, 24, 34, .22);
}

.metric-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid #edf0f4;
}

.metric-modal-head div {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.metric-modal-head strong {
  color: #202330;
  font-size: 17px;
}

.metric-modal-head span {
  color: #7b8494;
  font-size: 12px;
}

.metric-modal-close {
  width: 30px;
  height: 30px;
  border: 1px solid #d9dee8;
  border-radius: 6px;
  background: #fff;
  color: #596172;
  font: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.metric-modal-close:hover {
  color: var(--orange);
  border-color: var(--orange);
  background: #fff7f0;
}

.metric-modal-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid #edf0f4;
  background: #fafbfc;
}

.metric-modal-summary span {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #fff;
}

.metric-modal-summary em {
  color: #8b92a0;
  font-size: 11px;
  font-style: normal;
}

.metric-modal-summary strong {
  overflow: hidden;
  color: #202330;
  font-size: 14px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.metric-modal-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 20px 18px;
}

.metric-modal-row {
  display: grid;
  gap: 10px;
  align-items: center;
  min-height: 38px;
  min-width: 920px;
  padding: 0 10px;
  border-bottom: 1px solid #f0f2f5;
  color: #596172;
  font-size: 12px;
}

.metric-modal-row.work {
  grid-template-columns: 48px minmax(240px, 1.6fr) minmax(90px, .7fr) 70px 128px 84px 74px 66px 64px;
}

.metric-modal-row.account {
  grid-template-columns: 48px minmax(120px, 1fr) minmax(100px, .8fr) 84px 94px 94px 82px 82px 70px;
}

.metric-modal.post-detail-modal {
  width: min(1180px, 96vw);
}

.metric-modal-row.post-detail {
  grid-template-columns: 44px minmax(260px, 1.8fr) minmax(90px, .75fr) 76px 116px 82px 74px 66px 66px;
}

.metric-modal-row-head {
  position: sticky;
  top: -12px;
  z-index: 1;
  min-height: 34px;
  border-bottom: 1px solid #dfe4ec;
  background: #fff;
  color: #8b92a0;
  font-weight: 800;
}

.metric-modal-row b {
  color: var(--orange);
  font-size: 12px;
}

.metric-modal-row strong {
  min-width: 0;
  overflow: hidden;
  color: #202330;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.metric-modal-row span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.metric-modal-row em {
  color: #202330;
  font-size: 13px;
  font-style: normal;
  font-weight: 900;
}

.metric-modal-empty {
  padding: 44px 20px 52px;
  color: #8b92a0;
  text-align: center;
  font-size: 13px;
}

.wide-chart-stack {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.04fr) minmax(320px, .96fr);
  gap: 18px;
  align-items: start;
}

.wide-chart-card {
  min-width: 0;
  min-height: 300px;
  padding: 18px;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: var(--card-bg);
}

.wide-chart-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}

.wide-chart-head > div:first-child {
  display: grid;
  gap: 6px;
}

.wide-chart-head strong {
  color: #202330;
  font-size: 15px;
}

.wide-chart-head span,
.wide-chart-head em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.wide-head-actions {
  display: flex !important;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: nowrap;
  min-width: 0;
}

.rank-platform-tabs,
.metric-mode-tabs {
  display: inline-flex !important;
  align-items: center;
  flex-direction: row;
  flex: 0 0 auto;
  border: 1px solid #d9dee8;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}

.rank-platform-tabs button,
.metric-mode-tabs button {
  height: 24px;
  min-width: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border: 0;
  border-right: 1px solid #d9dee8;
  background: #fff;
  color: #586070;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.rank-platform-tabs button:last-child,
.metric-mode-tabs button:last-child {
  border-right: 0;
}

.rank-platform-tabs button.active,
.metric-mode-tabs button.active {
  color: var(--orange);
  background: #fff7f0;
  box-shadow: inset 0 0 0 1px var(--orange);
}

.wide-granularity-tabs {
  display: inline-flex;
  border: 1px solid #d9dee8;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}

.wide-granularity-tabs button {
  height: 28px;
  min-width: 48px;
  padding: 0 10px;
  border: 0;
  border-right: 1px solid #d9dee8;
  background: #fff;
  color: #586070;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.wide-granularity-tabs button:last-child {
  border-right: 0;
}

.wide-granularity-tabs button.active {
  color: var(--orange);
  background: #fff7f0;
  box-shadow: inset 0 0 0 1px var(--orange);
}

.play-rank-showcase {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(168px, .88fr) minmax(0, 1.12fr);
  gap: 12px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--orange) 13%, #edf0f4);
  border-radius: 8px;
  background:
    radial-gradient(circle at 18% 0%, rgba(255, 160, 0, .07), transparent 34%),
    linear-gradient(180deg, #fffdf8, #fff);
}

.play-rank-hero {
  min-height: 184px;
  display: grid;
  align-content: space-between;
  gap: 14px;
  padding: 16px;
  border-radius: 10px;
  background: linear-gradient(135deg, #ff6b00, #ffa000);
  color: #fff;
  box-shadow: 0 14px 30px rgba(255, 107, 0, .2);
}

.play-rank-hero > span {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgba(255, 255, 255, .2);
  font-size: 14px;
  font-weight: 900;
}

.play-rank-hero div {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.play-rank-hero strong {
  overflow: hidden;
  font-size: 22px;
  line-height: 1.15;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.play-rank-hero em,
.play-rank-hero small {
  color: rgba(255, 255, 255, .78);
  font-size: 12px;
  font-style: normal;
}

.play-rank-hero b {
  font-size: 28px;
  line-height: 1;
}

.play-rank-tile-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.play-rank-tile {
  min-height: 84px;
  display: grid;
  gap: 5px;
  padding: 12px;
  border-radius: 9px;
  background: rgba(255, 255, 255, .82);
  box-shadow: inset 0 0 0 1px rgba(255, 160, 0, .09);
}

.play-rank-tile span {
  color: var(--orange);
  font-size: 11px;
  font-weight: 900;
}

.play-rank-tile strong,
.play-rank-chip em {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.play-rank-tile strong {
  color: #202330;
  font-size: 14px;
}

.play-rank-tile em {
  color: #8b92a0;
  font-size: 11px;
  font-style: normal;
}

.play-rank-tile b {
  color: var(--orange);
  font-size: 16px;
}

.play-rank-chip-grid {
  grid-column: 1 / 3;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.play-rank-chip {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 9px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, .72);
}

.play-rank-chip b {
  color: var(--orange);
  font-size: 11px;
}

.play-rank-chip em {
  color: #8b92a0;
  font-size: 11px;
  font-style: normal;
}

.play-rank-chip strong {
  color: #202330;
  font-size: 12px;
}

.posts-trend-card {
  min-height: 0;
  align-self: start;
}

.post-insight-stack {
  min-width: 0;
  display: grid;
  gap: 12px;
}

.recent-post-card {
  min-width: 0;
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--orange) 12%, var(--card-border));
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .96), rgba(255, 255, 255, .99)),
    radial-gradient(circle at 0 0, rgba(255, 107, 0, .08), transparent 34%);
}

.recent-post-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.recent-post-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.recent-post-more {
  padding-inline: 8px;
}

.recent-post-head div {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.recent-post-head strong {
  color: #202330;
  font-size: 14px;
}

.recent-post-head span,
.recent-post-head em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.recent-post-list {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.recent-post-row {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-content: start;
  gap: 8px 10px;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid color-mix(in srgb, var(--post-kind-color) 18%, #edf0f4);
  border-radius: 8px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--post-platform-color) 10%, transparent), transparent 38%),
    linear-gradient(180deg, color-mix(in srgb, var(--post-kind-color) 5%, #fff), #fbfcfe),
    #fbfcfe;
  color: #596172;
  font-size: 12px;
  box-shadow: 0 8px 18px rgba(31, 41, 55, .035);
}

.recent-post-row::before {
  content: '';
  position: absolute;
  inset: 10px auto 10px 0;
  width: 3px;
  border-radius: 999px;
  background: var(--post-kind-color);
  opacity: .82;
}

.recent-post-row.is-business {
  border-color: color-mix(in srgb, var(--business) 28%, #edf0f4);
  box-shadow: 0 10px 22px rgba(255, 107, 0, .08);
}

.recent-post-row.is-suspect {
  border-color: color-mix(in srgb, var(--suspect) 26%, #edf0f4);
}

.recent-post-row.is-distribution {
  border-color: color-mix(in srgb, var(--distribution) 24%, #edf0f4);
}

.recent-post-row > .platform-badge {
  margin: 0;
  align-self: start;
}

.recent-post-title {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.recent-post-title strong {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recent-post-title strong {
  color: #202330;
  font-size: 13px;
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.recent-post-title small {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: #8b92a0;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recent-post-title small > span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recent-post-hot {
  align-self: start;
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--post-kind-color) 12%, #fff);
  color: var(--post-kind-color);
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
}

.recent-post-meta {
  grid-column: 2 / 4;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 5px 8px;
  color: #8b92a0;
  font-size: 11px;
}

.recent-post-meta span {
  min-width: 0;
  flex: 1 1 128px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recent-post-meta b,
.recent-post-meta em {
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
  padding: 3px 7px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #edf0f4;
  font-style: normal;
  font-weight: 800;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recent-post-row em {
  color: #202330;
  font-style: normal;
  font-weight: 800;
}

.content-kind-pill {
  display: inline-flex;
  align-items: center;
  max-width: 96px;
  min-width: 0;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 11px;
  font-style: normal;
  font-weight: 900;
  line-height: 1.1;
  white-space: nowrap;
}

.content-kind-pill.is-business {
  color: #c44f00;
  border-color: rgba(255, 107, 0, .22);
  background: rgba(255, 107, 0, .1);
}

.content-kind-pill.is-suspect {
  color: #6550c5;
  border-color: rgba(139, 107, 232, .24);
  background: rgba(139, 107, 232, .1);
}

.content-kind-pill.is-distribution {
  color: #007f63;
  border-color: rgba(0, 166, 126, .22);
  background: rgba(0, 166, 126, .1);
}

.content-kind-pill.is-daily {
  color: #596172;
  border-color: rgba(100, 116, 139, .18);
  background: rgba(100, 116, 139, .08);
}

.recent-post-empty {
  padding: 18px 12px;
  border: 1px dashed #dce2eb;
  border-radius: 8px;
  color: #8b92a0;
  font-size: 12px;
  text-align: center;
}

.post-rhythm-card {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr);
  gap: 10px 12px;
  padding: 12px;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background:
    radial-gradient(circle at 92% 8%, rgba(139, 107, 232, .1), transparent 30%),
    #fff;
}

.post-rhythm-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  grid-column: 1 / 3;
  margin-bottom: 0;
}

.post-rhythm-head div {
  display: grid;
  gap: 5px;
}

.post-rhythm-head strong {
  color: #202330;
  font-size: 14px;
}

.post-rhythm-head span,
.post-rhythm-head em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.post-rhythm-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 0;
}

.post-rhythm-grid span {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 7px 8px;
  border-radius: 8px;
  background: #f8f9fb;
}

.post-rhythm-grid em,
.post-rhythm-grid small {
  overflow: hidden;
  color: #8b92a0;
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.post-rhythm-grid strong {
  color: #202330;
  font-size: 16px;
}

.post-hot-days {
  align-self: stretch;
  display: grid;
  gap: 6px;
}

.post-hot-days span {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 52px;
  gap: 8px;
  align-items: center;
  min-height: 23px;
}

.post-hot-days b {
  color: #596172;
  font-size: 12px;
}

.post-hot-days i {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #f1f3f6;
}

.post-hot-days u {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #8b6be8;
}

.post-hot-days em {
  color: #202330;
  font-size: 12px;
  font-style: normal;
  text-align: right;
}

.wide-bar-chart {
  height: 210px;
  display: grid;
  grid-template-columns: repeat(14, minmax(0, 1fr));
  align-items: end;
  gap: 12px;
  padding: 14px 16px 0;
  border: 1px solid color-mix(in srgb, #8b6be8 13%, #edf0f4);
  border-radius: 8px;
  background:
    linear-gradient(#edf0f4 1px, transparent 1px) 0 34px / 100% 42px,
    linear-gradient(180deg, #fbfaff, #fff);
}

.wide-bar-chart.weekly {
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 22px;
}

.wide-bar-item {
  min-width: 0;
  height: 100%;
  display: grid;
  grid-template-rows: 20px 1fr 24px;
  gap: 5px;
  align-items: end;
  justify-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition: background .16s ease, transform .16s ease;
}

.wide-bar-item:hover,
.wide-bar-item:focus-visible {
  background: rgba(139, 107, 232, .08);
  outline: none;
  transform: translateY(-2px);
}

.wide-bar-item.empty {
  cursor: default;
}

.wide-bar-item.empty:hover,
.wide-bar-item.empty:focus-visible {
  background: transparent;
  transform: none;
}

.wide-bar-item strong {
  color: #4b5565;
  font-size: 11px;
  line-height: 1;
}

.wide-bar-item i {
  width: 18px;
  height: var(--bar-height);
  min-height: 10px;
  border-radius: 999px 999px 4px 4px;
  background: #8b6be8;
  box-shadow: 0 10px 18px rgba(139, 107, 232, .18);
}

.wide-bar-item.empty i {
  height: 2px;
  min-height: 2px;
  border-radius: 999px;
  background: #dfe4ec;
  box-shadow: none;
}

.wide-bar-item span {
  max-width: 100%;
  overflow: hidden;
  color: #8b92a0;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.detail-card,
.single-profile-card,
.single-chart-card,
.single-history-card {
  padding: 18px;
}

.account-table,
.snapshot-table,
.single-work-table {
  display: grid;
  gap: 3px;
  overflow-x: auto;
}

.detail-card .account-table {
  max-height: 520px;
  overflow: auto;
}

.hot-video-table {
  display: grid;
  gap: 3px;
  max-height: 520px;
  overflow: auto;
}

.hot-video-head,
.hot-video-row {
  display: grid;
  grid-template-columns: minmax(170px, 1.45fr) .7fr .58fr .42fr .72fr .6fr .6fr .46fr .46fr .52fr;
  gap: 10px;
  align-items: center;
  min-height: 38px;
  min-width: 980px;
  padding: 0 10px;
}

.hot-video-head {
  position: sticky;
  top: 0;
  z-index: 3;
  border-bottom: 1px solid #edf0f4;
  background: #fff;
  color: #8b92a0;
  font-size: 12px;
  font-weight: 900;
}

.hot-video-row {
  border-radius: 7px;
  background: #f8f9fb;
  font-size: 12px;
}

.hot-video-row.is-business,
.single-work-row.is-business {
  background: linear-gradient(90deg, rgba(255, 107, 0, .1), #fff 46%);
  box-shadow: inset 3px 0 0 var(--business);
}

.hot-video-row.is-suspect,
.single-work-row.is-suspect {
  background: linear-gradient(90deg, rgba(139, 107, 232, .09), #fff 46%);
  box-shadow: inset 3px 0 0 var(--suspect);
}

.hot-video-row.is-distribution,
.single-work-row.is-distribution {
  background: linear-gradient(90deg, rgba(0, 166, 126, .08), #fff 46%);
  box-shadow: inset 3px 0 0 var(--distribution);
}

.hot-video-row strong,
.hot-video-row span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hot-video-row em {
  color: var(--orange);
  font-style: normal;
  font-weight: 900;
}

.update-plan-table {
  display: grid;
  gap: 3px;
  max-height: 560px;
  overflow: auto;
}

.update-plan-head,
.update-plan-row {
  display: grid;
  grid-template-columns: minmax(120px, 1.05fr) minmax(112px, .92fr) .62fr .5fr .54fr .5fr .5fr .62fr .62fr .44fr .72fr .62fr minmax(160px, 1.18fr);
  gap: 10px;
  align-items: center;
  min-height: 38px;
  min-width: 1320px;
  padding: 0 10px;
}

.update-plan-head {
  position: sticky;
  top: 0;
  z-index: 3;
  border-bottom: 1px solid #edf0f4;
  background: #fff;
  color: #8b92a0;
  font-size: 12px;
  font-weight: 900;
}

.update-plan-row {
  border-radius: 7px;
  background: #f8f9fb;
  font-size: 12px;
}

.update-plan-row strong,
.update-plan-row span,
.update-plan-row small {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.update-plan-row > b {
  color: #202330;
  font-size: 13px;
}

.update-plan-row > em {
  color: #ef4444;
  font-style: normal;
  font-weight: 900;
}

.update-plan-row small {
  color: #8b92a0;
}

.plan-inline-progress {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38px;
  gap: 6px;
  align-items: center;
}

.plan-inline-progress i {
  height: 6px;
}

.plan-inline-progress b {
  color: #00a67e;
  font-size: 12px;
  text-align: right;
}

.account-table-head,
.account-table-row {
  display: grid;
  grid-template-columns: minmax(110px, 1.25fr) .74fr .54fr .7fr .7fr .7fr .58fr .5fr .7fr;
  gap: 10px;
  align-items: center;
  min-height: 36px;
  min-width: 980px;
  padding: 0 10px;
}

.platform-cell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.platform-cell b {
  min-width: 0;
  overflow: hidden;
  color: #586070;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.account-table-head,
.snapshot-head,
.single-work-head {
  position: sticky;
  top: 0;
  z-index: 3;
  background: #fff;
  color: #8b92a0;
  font-size: 12px;
  font-weight: 900;
  border-bottom: 1px solid #edf0f4;
}

.account-table-row,
.snapshot-row,
.single-work-row {
  border-radius: 7px;
  background: #f8f9fb;
  font-size: 12px;
}

.account-table-row em,
.snapshot-row em,
.single-work-row em {
  color: #00a67e;
  font-style: normal;
  font-weight: 900;
}

.delta-up {
  color: #00a67e !important;
}

.delta-down {
  color: #e14b3b !important;
}

.delta-flat {
  color: #8b92a0 !important;
}

.single-work-head,
.single-work-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.45fr) minmax(140px, .92fr) .56fr .56fr .54fr .46fr .52fr;
  gap: 10px;
  align-items: center;
  min-width: 960px;
  min-height: 36px;
  padding: 0 10px;
}

.single-work-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.single-work-title strong,
.single-work-title small {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.single-work-title small {
  color: #8b92a0;
  font-size: 11px;
}

.single-empty-state {
  padding: 18px 14px;
  color: #8b92a0;
  font-size: 13px;
}

.metric-text.views {
  color: var(--orange);
}

.metric-text.likes {
  color: #f94d6a;
}

.single-layout {
  grid-template-columns: 320px minmax(0, 1fr);
  align-items: start;
}

.single-profile-card {
  position: sticky;
  top: 0;
}

.account-select {
  width: 100%;
  height: 36px;
}

.single-filter-grid {
  display: grid;
  gap: 10px;
}

.single-filter-grid label {
  display: grid;
  gap: 5px;
  color: #596172;
  font-size: 12px;
  font-weight: 800;
}

.single-filter-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.single-filter-meta span {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  background: #f8f9fb;
  color: #7f8794;
  font-size: 12px;
}

.single-profile {
  display: grid;
  gap: 5px;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid #edf0f4;
  border-radius: 8px;
  background: #f8f9fb;
}

.single-profile strong {
  font-size: 22px;
}

.single-kpis {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.single-kpis span {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 7px;
  background: #f8f9fb;
  color: #7f8794;
  font-size: 12px;
}

.single-kpis b {
  color: #202330;
}

.single-main {
  min-width: 0;
}

.single-chart-stack {
  display: grid;
  gap: 10px;
}

.single-chart-lane {
  display: grid;
  grid-template-columns: 124px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  min-height: 132px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--metric-color) 18%, #edf0f4);
  border-radius: 8px;
  background: color-mix(in srgb, var(--metric-color) 5%, #fff);
}

.lane-copy {
  display: grid;
  gap: 4px;
}

.lane-copy span {
  color: #596172;
  font-size: 12px;
  font-weight: 800;
}

.lane-copy strong {
  color: var(--metric-color);
  font-size: 25px;
  line-height: 1;
}

.lane-copy em {
  color: #8b92a0;
  font-size: 12px;
  font-style: normal;
}

.single-chart-lane svg {
  width: 100%;
  height: 112px;
  border-radius: 8px;
  overflow: visible;
}

.single-chart-lane polyline {
  fill: none;
  stroke: var(--metric-color);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chart-grid-line {
  stroke: #edf0f4;
  stroke-width: 1;
}

.snapshot-head,
.snapshot-row {
  display: grid;
  grid-template-columns: 1fr .8fr .8fr .8fr;
  gap: 10px;
  align-items: center;
  min-height: 34px;
  padding: 0 10px;
}

.account-data-module :is(
  .board-top,
  .filter-row,
  .kpi-card,
  .chart-card,
  .detail-card,
  .battle-summary-card,
  .battle-tree-card,
  .battle-chart-card,
  .update-summary-card,
  .update-plan-progress-card,
  .update-risk-card,
  .update-plan-table-card,
  .hot-summary-card,
  .hot-hero-card,
  .hot-factor-card,
  .hot-rank-card,
  .hot-table-card,
  .single-profile-card,
  .single-chart-card,
  .single-history-card,
  .account-cosmos-card,
  .recent-post-card,
  .post-rhythm-card,
  .metric-modal
) {
  border-color: var(--ad-border);
  background: var(--ad-card);
  color: var(--ad-text);
  box-shadow: var(--ad-shadow-soft);
}

.account-data-module :is(
  .view-tabs,
  .platform-tabs,
  .range-tabs,
  .dimension-tabs,
  .rank-platform-tabs,
  .metric-mode-tabs
) {
  border-color: var(--ad-border-strong);
  background: var(--ad-control);
}

.account-data-module :is(
  .view-tab,
  .platform-tab,
  .range-tab,
  .dimension-tab,
  .rank-platform-tabs button,
  .metric-mode-tabs button,
  .dashboard-refresh-btn,
  .inp
) {
  border-color: var(--ad-border-strong);
  background: var(--ad-control);
  color: var(--ad-subtle);
}

.account-data-module :is(
  .view-tab:hover,
  .platform-tab:hover,
  .range-tab:hover,
  .dimension-tab:hover,
  .rank-platform-tabs button:hover,
  .metric-mode-tabs button:hover,
  .dashboard-refresh-btn:hover:not(:disabled)
) {
  border-color: var(--orange);
  background: var(--ad-control-hover);
  color: var(--orange);
}

.account-data-module :is(
  .view-tab.active,
  .platform-tab.active,
  .range-tab.active,
  .dimension-tab.active,
  .rank-platform-tabs button.active,
  .metric-mode-tabs button.active
) {
  background: var(--ad-accent-soft);
  color: var(--orange);
  box-shadow: inset 0 0 0 1px var(--orange);
}

.account-data-module :is(
  .board-title strong,
  .kpi-card strong,
  .battle-summary-card strong,
  .hot-summary-card strong,
  .update-summary-card strong,
  .hot-hero strong,
  .plan-progress-copy strong,
  .update-risk-row strong,
  .update-group-row strong,
  .hot-factor-row strong,
  .hot-rank-row strong,
  .battle-row b,
  .post-stack-row b,
  .panel-head strong,
  .chart-head strong,
  .tree-group-node strong,
  .tree-leaf b,
  .cosmos-node,
  .chart-stat-strip b,
  .chart-detail-row strong,
  .chart-detail-row b,
  .metric-modal-head strong,
  .metric-modal-summary strong,
  .metric-modal-row strong,
  .recent-post-head strong,
  .recent-post-title strong,
  .recent-post-row em,
  .post-rhythm-head strong,
  .post-rhythm-grid strong,
  .post-hot-days em,
  .update-plan-row > b,
  .single-kpis b,
  .single-profile strong,
  .single-work-title strong,
  .wide-bar-item strong
) {
  color: var(--ad-text-strong);
}

.account-data-module :is(
  .snapshot-note,
  .panel-head span,
  .account-table-row span,
  .single-profile span,
  .single-profile em,
  .kpi-card span,
  .kpi-card em,
  .battle-summary-card span,
  .battle-summary-card em,
  .hot-summary-card span,
  .hot-summary-card em,
  .update-summary-card span,
  .update-summary-card em,
  .filter-range > span,
  .dimension-switch > span,
  .hot-hero span,
  .hot-hero-metrics span,
  .plan-progress-copy span,
  .plan-progress-copy em,
  .update-risk-row em,
  .update-group-row em,
  .update-plan-head,
  .update-plan-row span,
  .update-plan-row small,
  .hot-factor-row span,
  .hot-rank-row em,
  .battle-row em,
  .battle-row i,
  .post-stack-row span,
  .post-stack-row i,
  .chart-legend,
  .chart-stat-strip em,
  .chart-detail-row em,
  .chart-detail-row small,
  .metric-modal-head span,
  .metric-modal-summary span,
  .metric-modal-row span,
  .metric-modal-row em,
  .cosmos-node em,
  .cosmos-node small,
  .cosmos-legend span,
  .recent-post-head span,
  .recent-post-head em,
  .recent-post-title small,
  .recent-post-meta,
  .content-kind-pill.is-daily,
  .recent-post-empty,
  .post-rhythm-head span,
  .post-rhythm-head em,
  .post-rhythm-grid em,
  .post-rhythm-grid small,
  .post-hot-days b,
  .wide-bar-item span,
  .hot-video-head,
  .update-plan-group-head,
  .account-table-head,
  .snapshot-head,
  .single-work-head,
  .platform-cell b,
  .single-work-title small,
  .single-empty-state,
  .single-filter-grid label,
  .single-filter-meta span,
  .lane-copy span,
  .lane-copy em
) {
  color: var(--ad-muted);
}

.account-data-module :is(
  .update-summary-card,
  .battle-tree,
  .hot-hero,
  .cosmos-stage,
  .chart-board,
  .post-rhythm-card,
  .wide-bar-chart
) {
  border-color: var(--ad-border);
  background: var(--ad-chart-bg);
}

.account-data-module :is(
  .tree-branch,
  .tree-leaf,
  .chart-detail-row,
  .hot-rank-row,
  .update-risk-row,
  .update-group-row,
  .hot-video-row,
  .update-plan-row,
  .account-table-row,
  .snapshot-row,
  .single-work-row,
  .single-filter-meta span,
  .single-profile,
  .single-kpis span,
  .post-rhythm-grid span,
  .metric-modal-summary,
  .metric-modal-row,
  .recent-post-meta b,
  .recent-post-meta em
) {
  border-color: var(--ad-border);
  background: var(--ad-row);
  color: var(--ad-text);
}

.account-data-module :is(
  .tree-branch.champion,
  .tree-group-node,
  .chart-stat-strip span,
  .chart-detail-row:hover,
  .hot-rank-row:hover,
  .single-chart-lane,
  .recent-post-row,
  .recent-post-hot
) {
  border-color: var(--ad-border);
  background: var(--ad-row-hover);
}

.account-data-module :is(
  .hot-video-head,
  .update-plan-group-head,
  .account-table-head,
  .snapshot-head,
  .single-work-head,
  .metric-modal-head
) {
  border-bottom-color: var(--ad-border);
  background: var(--ad-card-strong);
}

.account-data-module :is(
  .hot-video-row.is-business,
  .single-work-row.is-business
) {
  background: linear-gradient(90deg, color-mix(in srgb, var(--business) 14%, transparent), var(--ad-row) 48%);
}

.account-data-module :is(
  .hot-video-row.is-suspect,
  .single-work-row.is-suspect
) {
  background: linear-gradient(90deg, color-mix(in srgb, var(--suspect) 13%, transparent), var(--ad-row) 48%);
}

.account-data-module :is(
  .hot-video-row.is-distribution,
  .single-work-row.is-distribution
) {
  background: linear-gradient(90deg, color-mix(in srgb, var(--distribution) 12%, transparent), var(--ad-row) 48%);
}

.account-data-module :is(.chart-grid-line) {
  stroke: var(--ad-border);
}

.account-data-module :is(.wide-bar-item.empty i) {
  background: var(--ad-border-strong);
}

.account-data-module :is(.metric-modal-close) {
  background: var(--ad-control);
  color: var(--ad-muted);
}

.account-data-module :is(.metric-modal-close:hover) {
  background: var(--ad-control-hover);
  color: var(--orange);
}

.account-data-module :is(.tree-root, .hot-hero > i, .kpi-card i) {
  color: var(--ad-on-accent);
}

@media (max-width: 1280px) {
  .kpi-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
  }

  .kpi-card {
    min-height: 92px;
    padding: 14px 12px;
  }

  .kpi-card strong {
    font-size: 22px;
  }

  .kpi-card i {
    width: 42px;
    height: 42px;
    flex-basis: 42px;
  }

  .battle-summary-grid,
  .update-summary-grid,
  .hot-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hot-main-grid,
  .hot-detail-grid,
  .update-plan-main-grid {
    grid-template-columns: 1fr;
  }

  .tree-leaves {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1040px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analysis-grid,
  .single-layout,
  .battle-main-grid,
  .battle-sub-grid,
  .update-plan-main-grid {
    grid-template-columns: 1fr;
  }

  .single-profile-card {
    position: static;
    min-height: auto;
  }
}

@media (max-width: 820px) {
  .wide-chart-stack {
    grid-template-columns: minmax(0, 1fr);
  }

  .recent-post-list {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .account-data-module {
    margin: 0;
    padding: 14px;
  }

  .board-top {
    align-items: flex-start;
    flex-direction: column;
    padding: 14px;
  }

  .board-actions {
    justify-content: flex-start;
  }

  .kpi-grid,
  .chart-board,
  .battle-summary-grid,
  .update-summary-grid,
  .hot-summary-grid,
  .hot-hero-metrics {
    grid-template-columns: 1fr;
  }

  .cosmos-stage {
    min-height: 520px;
  }

  .cosmos-stage::before,
  .cosmos-stage::after,
  .cosmos-core {
    display: none;
  }

  .cosmos-node {
    position: static;
    width: auto;
    height: auto;
    min-height: 58px;
    justify-items: start;
    place-items: initial;
    text-align: left;
    transform: none;
  }

  .cosmos-stage {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: start;
    gap: 8px;
    padding: 12px;
  }

  .single-chart-lane {
    grid-template-columns: 1fr;
  }

  .hot-factor-row {
    grid-template-columns: 1fr;
  }

  .plan-progress-hero,
  .update-risk-row,
  .update-group-row {
    grid-template-columns: 1fr;
  }

  .plan-progress-orb {
    justify-self: center;
  }

  .battle-tree {
    grid-template-columns: minmax(0, 1fr);
  }

  .battle-tree::before,
  .tree-branch-line {
    display: none;
  }

  .tree-root {
    position: static;
  }

  .tree-branch {
    grid-template-columns: minmax(0, 1fr);
  }

  .tree-leaves {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .chart-detail-row {
    grid-template-columns: 28px minmax(0, 1fr) 70px;
  }

  .chart-detail-row em,
  .chart-detail-row i,
  .chart-detail-row small {
    display: none;
  }

  .hot-factor-row em {
    text-align: left;
  }

  .play-rank-showcase,
  .play-rank-chip-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .play-rank-chip-grid {
    grid-column: 1 / 3;
  }
}

@media (max-width: 640px) {
  .play-rank-showcase,
  .play-rank-tile-grid,
  .play-rank-chip-grid {
    grid-template-columns: 1fr;
  }

  .play-rank-chip-grid {
    grid-column: auto;
  }

  .cosmos-stage {
    grid-template-columns: 1fr;
  }
}
</style>
