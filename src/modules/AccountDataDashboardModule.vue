<template>
  <div class="account-data-module">
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
            :class="{ active: activePlatform === platform.id, muted: platform.placeholder }"
            @click="activePlatform = platform.id">
            {{ platform.label }}
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
        <span>展示维度</span>
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
      <span class="snapshot-note">占位数据 · 当前 {{ filteredAccounts.length }} 个账号 · 后续接 10:00 / 18:00 采集快照</span>
    </section>

    <section v-if="activeView === 'overview'" class="overview-layout">
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
              <span>按{{ activeDimensionMeta.label }}维度展示当前筛选范围的播放量排行</span>
            </div>
            <em>{{ activeRangeMeta.label }}口径 · {{ dashboardRows.length }} {{ activeDimensionMeta.unit }}</em>
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
                <em>{{ item.groupName }}</em>
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
                <em>总发文 {{ formatCompactNumber(sumBy(filteredAccounts, rangePosts)) }} 条</em>
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
              <div
                v-for="bar in overviewPostBars"
                :key="bar.label"
                class="wide-bar-item"
                :style="{ '--bar-height': `${bar.height}%` }">
                <strong>{{ bar.value }}</strong>
                <i></i>
                <span>{{ bar.label }}</span>
              </div>
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
              <button type="button" @click="openChartMore(panel)">MORE›</button>
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
                <strong>{{ item.account }}</strong>
                <em>{{ item.groupName }}</em>
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
            <span>账号</span>
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
            <span>{{ item.platformLabel }}</span>
            <span>{{ formatCompactNumber(item.totalViews) }}</span>
            <span class="metric-text views">{{ formatCompactNumber(item.yesterdayViews) }}</span>
            <span class="metric-text likes">{{ formatCompactNumber(item.yesterdayLikes) }}</span>
            <span>{{ completionRate(item) }}%</span>
            <span>{{ contentType(item) }}</span>
            <em>+{{ formatCompactNumber(item.followerDelta) }}</em>
          </div>
        </div>
      </article>
    </section>

    <section v-else-if="activeView === 'single'" class="single-layout">
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
                {{ account.account }} · {{ account.owner || '未填负责人' }}
              </option>
            </select>
          </label>
        </div>
        <div class="single-filter-meta">
          <span>平台：{{ singlePlatformLabel }}</span>
          <span>小组：{{ singleGroupLabel }}</span>
          <span>{{ singleFilteredAccounts.length }} 个账号</span>
        </div>
        <div v-if="selectedAccount" class="single-profile">
          <strong>{{ selectedAccount.account }}</strong>
          <span>{{ selectedAccount.groupName }} / {{ selectedAccount.platformLabel }} / {{ selectedAccount.owner }}</span>
          <em>{{ selectedAccount.profile || '暂未绑定 profile' }}</em>
        </div>
        <div v-if="selectedAccount" class="single-kpis">
          <span><b>{{ formatCompactNumber(selectedAccount.totalViews) }}</b>总播放</span>
          <span><b>{{ formatCompactNumber(selectedAccount.totalLikes) }}</b>总点赞</span>
          <span><b>+{{ formatCompactNumber(selectedAccount.followerDelta) }}</b>粉丝变化</span>
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
            <strong>近 8 次快照</strong>
            <span>后续接真实采集记录</span>
          </div>
          <div class="snapshot-table">
            <div class="snapshot-head">
              <span>快照</span>
              <span>播放</span>
              <span>点赞</span>
              <span>粉丝</span>
            </div>
            <div v-for="row in singleSnapshots" :key="row.label" class="snapshot-row">
              <span>{{ row.label }}</span>
              <strong>{{ formatCompactNumber(row.views) }}</strong>
              <strong class="metric-text likes">{{ formatCompactNumber(row.likes) }}</strong>
              <em>{{ formatCompactNumber(row.fans) }}</em>
            </div>
          </div>
        </article>
      </main>
    </section>

    <section v-else-if="activeView === 'battle'" class="battle-layout">
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
              <em>{{ battleChampion ? `当前最能打 · 指数 ${battleChampion.score}` : '占位数据接入中' }}</em>
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
                  <em>{{ group.accountCount }}号 · 完播 {{ group.completionRate }}% · {{ group.score }} 战力</em>
                </div>
                <div class="tree-leaves">
                  <span
                    v-for="leaf in group.leaves"
                    :key="leaf.id"
                    class="tree-leaf"
                    :class="leaf.typeClass"
                    :style="{ '--leaf-width': leaf.width + '%' }">
                    <b>{{ leaf.account }}</b>
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
              <b>{{ item.account }}</b>
              <em>{{ item.groupName }}</em>
              <strong>{{ item.completionRate }}%</strong>
              <i><u :style="{ width: item.completionRate + '%' }"></u></i>
            </div>
          </div>
        </article>
      </section>
    </section>

    <section v-else-if="activeView === 'updatePlan'" class="update-plan-layout">
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
              <em>本月还差 {{ updatePlanSummary.remaining }} 条，{{ updatePlanSummary.behindCount }} 个账号需要盯进度。</em>
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

      <section class="update-plan-sub-grid">
        <article class="update-group-card">
          <div class="panel-head">
            <strong>小组完成度</strong>
            <span>目标、已发和缺口汇总</span>
          </div>
          <div class="update-group-list">
            <div v-for="group in updateGroupRows" :key="group.groupName" class="update-group-row">
              <div>
                <strong>{{ group.groupName }}</strong>
                <em>目标 {{ group.target }} · 已发 {{ group.completed }} · 风险 {{ group.behindCount }}</em>
              </div>
              <i><u :style="{ width: group.progress + '%' }"></u></i>
              <b>{{ group.progress }}%</b>
            </div>
          </div>
        </article>

        <article class="update-owner-card">
          <div class="panel-head">
            <strong>负责人负载</strong>
            <span>看谁手上还有更新缺口</span>
          </div>
          <div class="update-owner-grid">
            <span v-for="owner in updateOwnerRows" :key="owner.owner">
              <em>{{ owner.owner }}</em>
              <strong>{{ owner.remaining }}</strong>
              <small>剩余 / 目标 {{ owner.target }}</small>
            </span>
          </div>
        </article>
      </section>

      <article class="update-plan-table-card">
        <div class="panel-head">
          <strong>账号更新明细</strong>
          <span>{{ updatePlanDisplayRows.length }} 个计划账号 · 来自月更新量表</span>
        </div>
        <div class="update-plan-table">
          <div class="update-plan-head">
            <span>账号</span>
            <span>小组 / 平台</span>
            <span>负责人</span>
            <span>月目标</span>
            <span>本月已发</span>
            <span>缺口</span>
            <span>进度</span>
            <span>状态</span>
            <span>对标 / 备注</span>
          </div>
          <div v-for="row in updatePlanDisplayRows" :key="row.id" class="update-plan-row">
            <strong>{{ row.account }}</strong>
            <span>{{ row.groupName }} · {{ row.platformLabel }}</span>
            <span>{{ row.owner || '-' }}</span>
            <b>{{ row.target }}</b>
            <span>{{ row.completed }}</span>
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
            <span>{{ topHotVideo.account }} · {{ topHotVideo.groupName }} · {{ topHotVideo.platformLabel }}</span>
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
                <em>{{ item.account }} · {{ item.contentType }} · 完播 {{ item.completionRate }}%</em>
              </div>
              <b>{{ item.hotIndex }}</b>
            </div>
          </div>
        </article>

        <article class="hot-table-card">
          <div class="panel-head">
            <strong>爆款作品明细</strong>
            <span>{{ hotVideoRows.length }} 条占位作品 · 后续接投稿导出表</span>
          </div>
          <div class="hot-video-table">
            <div class="hot-video-head">
              <span>作品</span>
              <span>账号</span>
              <span>类型</span>
              <span>发布时间</span>
              <span>播放</span>
              <span>点赞</span>
              <span>完播</span>
              <span>互动率</span>
              <span>指数</span>
            </div>
            <div v-for="item in hotVideoRows.slice(0, 18)" :key="item.id" class="hot-video-row">
              <strong>{{ item.title }}</strong>
              <span>{{ item.account }}</span>
              <span>{{ item.contentType }}</span>
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
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { accountDataMock, formatCompactNumber, platformOptions } from './account-data/mockData'
import { updatePlanRows } from './account-data/updatePlan'

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
  { id: 'group', label: '组别', unit: '个小组' },
  { id: 'department', label: '部门', unit: '个部门' }
]

const rangeMeta = {
  yesterday: { label: '昨日', scale: 1, total: false },
  week: { label: '本周', scale: 4.2, total: false },
  month: { label: '本月', scale: 12, total: false },
  year: { label: '今年', scale: 30, total: false },
  all: { label: '总体', scale: 1, total: true }
}

const hotTitlePool = [
  '逆风翻盘这一段太有记忆点',
  '十秒内把节奏拉满',
  '这条互动突然爆了',
  '结尾反转带动完播',
  '评论区跟着一起上头',
  '高能片段集中爆发',
  '账号近期最强单条',
  '商单转化表现突出',
  '日常内容破圈明显',
  '粉丝新增贡献最高'
]

const postGranularityOptions = [
  { id: 'day', label: '按日' },
  { id: 'week', label: '按周' }
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
  '最翁damnnn': '最翁说游',
  麦小雯: '麦晓花',
  上官北: '上官北丶'
}

const updatePlanStatusMap = {
  done: { label: '已达标', className: 'done' },
  onTrack: { label: '进度正常', className: 'on-track' },
  behind: { label: '需追赶', className: 'behind' },
  unmatched: { label: '待接入', className: 'unmatched' },
  paused: { label: '暂不更新', className: 'paused' }
}

const activeView = ref('overview')
const activePlatform = ref('all')
const activeRange = ref('all')
const activeGroup = ref('all')
const activeDimension = ref('account')
const keyword = ref('')
const postGranularity = ref('day')
const singleGroup = ref('all')
const singlePlatform = ref('all')
const selectedAccountId = ref('')
const detailMetric = ref('views')
const chartTicks = [32, 58, 84]
const lineTicks = [36, 78, 120, 162]
const overviewPostDayLabels = ['1日', '3日', '5日', '7日', '9日', '11日', '13日', '15日', '17日', '19日', '21日', '23日', '25日', '27日']
const overviewPostWeekLabels = ['第1周', '第2周', '第3周', '第4周', '第5周', '第6周', '第7周', '第8周']
const activeRangeMeta = computed(() => rangeMeta[activeRange.value] || rangeMeta.all)

const platformFiltered = computed(() => {
  if (activePlatform.value === 'all') return accountDataMock
  return accountDataMock.filter(item => item.platform === activePlatform.value)
})

const groupOptions = computed(() => Array.from(new Set(platformFiltered.value.map(item => item.groupName))))

const activePlatformLabel = computed(() => platformOptions.find(item => item.id === activePlatform.value)?.label || '全平台')
const activeGroupLabel = computed(() => activeGroup.value === 'all' ? '全部小组' : activeGroup.value)
const singlePlatformLabel = computed(() => platformOptions.find(item => item.id === singlePlatform.value)?.label || '全平台')
const singleGroupLabel = computed(() => singleGroup.value === 'all' ? '全部小组' : singleGroup.value)
const activeDimensionMeta = computed(() => dimensionOptions.find(item => item.id === activeDimension.value) || dimensionOptions[0])

const filteredAccounts = computed(() => {
  const word = keyword.value.toLowerCase()
  return platformFiltered.value
    .filter(item => activeGroup.value === 'all' || item.groupName === activeGroup.value)
    .filter(item => !word || item.account.toLowerCase().includes(word))
})

const singlePlatformFiltered = computed(() => {
  if (singlePlatform.value === 'all') return accountDataMock
  return accountDataMock.filter(item => item.platform === singlePlatform.value)
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

function postCount(item) {
  if (Number.isFinite(item.postTotal)) return item.postTotal
  return Math.max(6, Math.round(item.totalViews / 4200 + item.hitWorks * 2))
}

function departmentName(item) {
  return Number(item.groupId) <= 3 ? '内容一部' : '内容二部'
}

function aggregateDimensionRows(rows, keyGetter, labelGetter, type) {
  const map = new Map()
  rows.forEach((item) => {
    const key = keyGetter(item)
    const current = map.get(key) || {
      id: `${type}-${key}`,
      account: labelGetter(item),
      groupName: type === 'group' ? '组别聚合' : '部门聚合',
      groupId: item.groupId,
      platform: activePlatform.value,
      platformLabel: activePlatformLabel.value,
      owner: '',
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
    map.set(key, current)
  })
  return Array.from(map.values()).map((item) => ({
    ...item,
    completionValue: item.accountCount ? Math.round(item.completionTotal / item.accountCount) : 0,
    groupName: `${item.accountCount} 个账号`,
    owner: type === 'department' ? '部门聚合' : '小组聚合'
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

function rangeViews(item) {
  return activeRangeMeta.value.total
    ? item.totalViews
    : Math.round(item.yesterdayViews * activeRangeMeta.value.scale)
}

function rangeLikes(item) {
  return activeRangeMeta.value.total
    ? item.totalLikes
    : Math.round(item.yesterdayLikes * activeRangeMeta.value.scale)
}

function rangeFans(item) {
  return activeRangeMeta.value.total
    ? item.followers
    : Math.round(item.followerDelta * activeRangeMeta.value.scale)
}

function rangePosts(item) {
  return activeRangeMeta.value.total
    ? postCount(item)
    : Math.max(1, Math.round(postCount(item) * activeRangeMeta.value.scale / 18))
}

function monthlyPostCount(item) {
  if (!item) return 0
  return Math.max(0, Math.round(postCount(item) * rangeMeta.month.scale / 18))
}

function normalizeAccountKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s·丶、，,。._\-—/\\:：]/g, '')
}

function updateMonthProgressRatio() {
  const now = new Date()
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return Math.min(1, Math.max(0.03, now.getDate() / Math.max(1, days)))
}

function findUpdatePlanAccount(plan) {
  const candidates = accountDataMock.filter(item => item.platform === plan.platform)
  const planKey = normalizeAccountKey(plan.account)
  const targetName = updatePlanAccountAliases[planKey] || plan.account
  const targetKey = normalizeAccountKey(targetName)
  return candidates.find(item => normalizeAccountKey(item.account) === targetKey) ||
    candidates.find((item) => {
      const accountKey = normalizeAccountKey(item.account)
      return accountKey && targetKey && (accountKey.includes(targetKey) || targetKey.includes(accountKey))
    }) ||
    null
}

function updatePlanStatus(plan, matchedAccount, completed, expected) {
  if (!plan.monthlyTarget) return 'paused'
  if (!matchedAccount) return 'unmatched'
  if (completed >= plan.monthlyTarget) return 'done'
  if (completed >= expected) return 'onTrack'
  return 'behind'
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
  scrollToDetail()
}

function scrollToDetail() {
  nextTick(() => {
    document.querySelector('.detail-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

const kpiCards = computed(() => {
  const rows = filteredAccounts.value
  const range = activeRangeMeta.value
  const accountCount = rows.length
  const followers = sumBy(rows, rangeFans)
  const posts = sumBy(rows, rangePosts)
  const views = sumBy(rows, rangeViews)
  const likes = sumBy(rows, rangeLikes)
  return [
    { key: 'people', label: '总账号数', value: accountCount, note: '当前筛选范围', icon: '人', color: metricColors.people },
    { key: 'fans', label: range.total ? '总粉丝数' : '粉丝增量', value: formatCompactNumber(followers), note: `${range.label}口径`, icon: '粉', color: metricColors.fans },
    { key: 'posts', label: range.total ? '总发布数' : '发布增量', value: formatCompactNumber(posts), note: '由作品表接入', icon: '发', color: metricColors.posts },
    { key: 'views', label: range.total ? '总曝光量' : '曝光增量', value: formatCompactNumber(views), note: `${range.label}口径`, icon: '播', color: metricColors.views },
    { key: 'likes', label: range.total ? '总点赞数' : '点赞增量', value: formatCompactNumber(likes), note: `${range.label}口径`, icon: '赞', color: metricColors.likes }
  ]
})

const dashboardRows = computed(() => {
  if (activeDimension.value === 'group') {
    return aggregateDimensionRows(filteredAccounts.value, item => item.groupName, item => item.groupName, 'group')
  }
  if (activeDimension.value === 'department') {
    return aggregateDimensionRows(filteredAccounts.value, departmentName, departmentName, 'department')
  }
  return filteredAccounts.value
})

const updatePlanDisplayRows = computed(() => {
  const word = keyword.value.toLowerCase()
  const monthProgress = updateMonthProgressRatio()
  return updatePlanRows
    .filter(item => activePlatform.value === 'all' || item.platform === activePlatform.value)
    .filter(item => activeGroup.value === 'all' || item.groupName === activeGroup.value)
    .filter((item) => {
      if (!word) return true
      return `${item.account} ${item.owner} ${item.groupName} ${item.platformLabel}`.toLowerCase().includes(word)
    })
    .map((plan) => {
      const matchedAccount = findUpdatePlanAccount(plan)
      const completed = matchedAccount ? monthlyPostCount(matchedAccount) : 0
      const target = Number(plan.monthlyTarget) || 0
      const expected = Math.ceil(target * monthProgress)
      const gap = Math.max(0, target - completed)
      const progress = target ? Math.min(100, Math.round(completed / target * 100)) : 100
      const status = updatePlanStatus(plan, matchedAccount, completed, expected)
      const statusMeta = updatePlanStatusMap[status] || updatePlanStatusMap.behind
      const matchNote = matchedAccount && matchedAccount.account !== plan.account ? `匹配：${matchedAccount.account}` : ''
      return {
        ...plan,
        matched: Boolean(matchedAccount),
        matchedAccountName: matchedAccount?.account || '',
        target,
        completed,
        expected,
        gap,
        progress,
        status,
        statusLabel: statusMeta.label,
        statusClass: statusMeta.className,
        contextNote: [plan.benchmarkAccounts ? `对标：${plan.benchmarkAccounts}` : '', plan.note, matchNote || (!matchedAccount && target ? '待接入账号池' : '')]
          .filter(Boolean)
          .join('；') || '正常推进'
      }
    })
    .sort((a, b) => {
      const statusWeight = { behind: 0, unmatched: 1, onTrack: 2, done: 3, paused: 4 }
      return (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9) || b.gap - a.gap || b.target - a.target
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

const updatePlanSummaryCards = computed(() => {
  const summary = updatePlanSummary.value
  return [
    {
      key: 'target',
      label: '月更新目标',
      value: `${summary.target}条`,
      note: `${summary.activeCount} 个账号有目标`,
      color: metricColors.plan
    },
    {
      key: 'completed',
      label: '本月已发',
      value: `${summary.completed}条`,
      note: `完成率 ${summary.completionRate}%`,
      color: metricColors.posts
    },
    {
      key: 'remaining',
      label: '剩余缺口',
      value: `${summary.remaining}条`,
      note: `${summary.behindCount} 个账号需跟进`,
      color: summary.behindCount ? metricColors.warn : metricColors.completion
    },
    {
      key: 'matched',
      label: '账号接入',
      value: `${summary.matchedCount}/${summary.rowCount}`,
      note: `${summary.pausedCount} 个暂不更新`,
      color: metricColors.views
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

const updateOwnerRows = computed(() => {
  const map = new Map()
  updatePlanDisplayRows.value.forEach((item) => {
    const owner = item.owner || '未填负责人'
    const current = map.get(owner) || { owner, target: 0, completed: 0, remaining: 0 }
    current.target += item.target
    current.completed += item.target ? Math.min(item.completed, item.target) : 0
    current.remaining += item.gap
    map.set(owner, current)
  })
  return Array.from(map.values())
    .filter(item => item.target > 0)
    .sort((a, b) => b.remaining - a.remaining || b.target - a.target)
    .slice(0, 8)
})

const chartPanels = computed(() => {
  const rows = dashboardRows.value
  const range = activeRangeMeta.value
  const viewsSorted = [...rows].sort((a, b) => rangeViews(b) - rangeViews(a))
  const likesSorted = [...rows].sort((a, b) => rangeLikes(b) - rangeLikes(a))
  const viewsTotal = sumBy(viewsSorted, rangeViews)
  const likesTotal = sumBy(likesSorted, rangeLikes)
  const topViews = withBarHeight(viewsSorted.slice(0, 5), rangeViews, viewsTotal)
  const topLikes = withBarHeight(likesSorted.slice(0, 5), rangeLikes, likesTotal)
  return [
    {
      key: 'views',
      title: range.total ? '总曝光量' : '曝光增量',
      legend: range.total ? '曝光量' : '曝光增量',
      unit: '万',
      color: metricColors.views,
      rows: topViews,
      stats: chartStats(viewsSorted, rangeViews, topViews, formatCompactNumber),
      format: formatCompactNumber
    },
    {
      key: 'likes',
      title: range.total ? '总点赞数' : '点赞增量',
      legend: range.total ? '点赞数' : '点赞增量',
      unit: '万',
      color: metricColors.likes,
      rows: topLikes,
      stats: chartStats(likesSorted, rangeLikes, topLikes, formatCompactNumber),
      format: formatCompactNumber
    }
  ]
})

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
  const rows = [...dashboardRows.value]
    .sort((a, b) => rangeViews(b) - rangeViews(a))
    .slice(0, 12)
  const total = Math.max(1, sumBy(dashboardRows.value, rangeViews))
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
  const rows = dashboardRows.value
  const labels = postGranularity.value === 'week' ? overviewPostWeekLabels : overviewPostDayLabels
  const divisor = postGranularity.value === 'week' ? 2.8 : 6
  const bars = labels.map((label, index) => {
    const value = rows.reduce((sum, item) => {
      const seed = stableNumber(`${item.id}-${label}`)
      const base = Math.max(1, rangePosts(item) / divisor)
      const wave = 0.55 + ((seed + index * 13) % 76) / 100
      return sum + Math.max(1, Math.round(base * wave))
    }, 0)
    return { label, value }
  })
  const max = Math.max(1, ...bars.map(item => item.value))
  return bars.map(item => ({
    ...item,
    height: Math.max(8, Math.round(item.value / max * 100))
  }))
})

const postPeakRows = computed(() => {
  const rows = [...overviewPostBars.value].sort((a, b) => b.value - a.value).slice(0, 4)
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
  const activeSlots = rows.filter(item => item.value >= avg).length
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
  const businessPosts = sumBy(rows.filter(item => contentType(item) === '商单'), rangePosts)
  const dailyPosts = sumBy(rows.filter(item => contentType(item) === '日常'), rangePosts)
  const avgCompletion = rows.length ? Math.round(sumBy(rows, completionRate) / rows.length) : 0
  const fanDelta = sumBy(rows, item => Math.max(0, rangeFans(item)))
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
      note: '账号均值占位',
      color: metricColors.completion
    },
    {
      key: 'fans',
      label: '粉丝变化',
      value: `+${formatCompactNumber(fanDelta)}`,
      note: `${activeRangeMeta.value.label}口径`,
      color: metricColors.fans
    }
  ]
})

const postStructureRows = computed(() => {
  return groupBattleRows.value.map((group) => {
    const rows = filteredAccounts.value.filter(item => item.groupName === group.groupName)
    const business = sumBy(rows.filter(item => contentType(item) === '商单'), rangePosts)
    const daily = sumBy(rows.filter(item => contentType(item) === '日常'), rangePosts)
    const total = Math.max(1, business + daily)
    return {
      groupName: group.groupName,
      business,
      daily,
      total,
      businessWidth: Math.max(4, Math.round(business / total * 100)),
      dailyWidth: Math.max(4, Math.round(daily / total * 100))
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
  const rows = filteredAccounts.value.flatMap((account, accountIndex) => {
    return Array.from({ length: 3 }, (_, index) => {
      const seed = stableNumber(`${account.id}-${account.account}-${index}`)
      const content = videoContentType(account, seed, index)
      const factor = content === '商单' ? 1.5 : 1
      const views = Math.max(1200, Math.round(rangeViews(account) * (0.22 + index * 0.11 + (seed % 18) / 48)))
      const likes = Math.max(20, Math.round(views * (0.018 + (seed % 24) / 1000)))
      const comments = Math.round(likes * (0.08 + (seed % 10) / 90))
      const shares = Math.round(likes * (0.04 + (seed % 8) / 90))
      const fanGain = Math.max(0, Math.round(rangeFans(account) * (0.05 + (seed % 20) / 120)))
      const completion = Math.min(96, Math.max(32, completionRate(account) + (seed % 21) - 10))
      const interaction = Number((((likes + comments + shares) / Math.max(1, views)) * 100).toFixed(1))
      const hotIndex = Math.round(views / 850 * factor + likes * 0.42 + comments * 3.6 + shares * 3.2 + fanGain * 15 + completion * 28)
      return {
        id: `${account.id}-hot-${index}`,
        title: hotTitlePool[(seed + index + accountIndex) % hotTitlePool.length],
        account: account.account,
        groupName: account.groupName,
        platformLabel: account.platformLabel,
        contentType: content,
        publishAt: `2026-06-${String(9 - index).padStart(2, '0')} ${index === 0 ? '18:00' : '10:00'}`,
        views,
        likes,
        comments,
        shares,
        fanGain,
        completionRate: completion,
        interactionRate: interaction,
        hotIndex,
        level: hotIndex >= 22000 ? 'S级' : hotIndex >= 14000 ? 'A级' : hotIndex >= 7600 ? 'B级' : '潜力'
      }
    })
  }).sort((a, b) => b.hotIndex - a.hotIndex)
  const max = Math.max(1, ...rows.map(item => item.hotIndex))
  return rows.map(item => ({ ...item, width: Math.max(8, Math.round(item.hotIndex / max * 100)) }))
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
      value: `+${formatCompactNumber(account.followerDelta)}`,
      note: '最近快照变化',
      color: metricColors.fans,
      points: trendPoints(account.fanTrend)
    }
  ]
})

const singleSnapshots = computed(() => {
  const account = selectedAccount.value
  if (!account) return []
  return account.trend.map((views, index) => ({
    label: index % 2 === 0 ? `D-${7 - index} 10:00` : `D-${7 - index} 18:00`,
    views,
    likes: selectedLikeTrend.value[index] || 0,
    fans: account.fanTrend[index] || 0
  })).reverse()
})
</script>

<style scoped>
.account-data-module {
  --board-bg: #f5f6f8;
  --card-bg: #fff;
  --card-border: #edf0f4;
  --orange: #ff6b00;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 100%;
  margin: -8px -16px 0;
  padding: 20px 20px 24px;
  border-radius: 10px;
  background: var(--board-bg);
  color: #202330;
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
.update-group-card,
.update-owner-card,
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

.update-plan-sub-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, .72fr);
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
.update-group-card,
.update-owner-card,
.update-plan-table-card,
.hot-hero-card,
.hot-factor-card,
.hot-rank-card,
.hot-table-card {
  min-height: 300px;
  padding: 18px;
}

.battle-tree-card {
  min-height: 520px;
  overflow: hidden;
}

.battle-tree {
  position: relative;
  min-height: 446px;
  display: grid;
  grid-template-columns: 178px minmax(0, 1fr);
  gap: 22px;
  padding: 18px;
  border: 1px solid #edf0f4;
  border-radius: 8px;
  background:
    radial-gradient(circle at 16% 18%, rgba(255, 107, 0, .12), transparent 28%),
    linear-gradient(135deg, #fffaf6 0%, #fff 45%, #f7fbff 100%);
}

.battle-tree::before {
  content: "";
  position: absolute;
  left: 194px;
  top: 52px;
  bottom: 44px;
  width: 4px;
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
  gap: 9px;
  padding: 18px;
  border-radius: 16px;
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
  font-size: 24px;
  line-height: 1.1;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-root b {
  width: fit-content;
  padding: 5px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .16);
  color: #fff;
  font-weight: 900;
}

.tree-branches {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 13px;
}

.tree-branch {
  position: relative;
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  padding: 12px;
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
  left: -22px;
  top: 50%;
  width: 22px;
  height: 2px;
  border-radius: 999px;
  background: var(--branch-color);
  opacity: .45;
}

.tree-group-node {
  min-width: 0;
  display: grid;
  align-content: center;
  gap: 6px;
  padding: 12px;
  border-radius: 10px;
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
  font-size: 18px;
  line-height: 1.1;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-group-node em {
  color: #7f8794;
  font-size: 12px;
  font-style: normal;
  line-height: 1.35;
}

.tree-leaves {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.tree-leaf {
  min-width: 0;
  display: grid;
  grid-template-rows: auto auto auto 6px;
  gap: 5px;
  padding: 10px;
  border-radius: 10px;
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
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-leaf b {
  color: #202330;
  font-size: 12px;
}

.tree-leaf em {
  color: #8b92a0;
  font-size: 11px;
  font-style: normal;
}

.tree-leaf i {
  color: var(--branch-color);
  font-size: 14px;
  font-style: normal;
  font-weight: 900;
}

.tree-leaf u {
  width: var(--leaf-width);
  height: 6px;
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
.plan-inline-progress i,
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
.plan-inline-progress u,
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

.update-owner-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.update-owner-grid span {
  min-width: 0;
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  background: #f8f9fb;
}

.update-owner-grid em {
  min-width: 0;
  overflow: hidden;
  color: #596172;
  font-size: 12px;
  font-style: normal;
  font-weight: 900;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.update-owner-grid strong {
  color: #ef4444;
  font-size: 22px;
  line-height: 1;
}

.update-owner-grid small {
  color: #8b92a0;
  font-size: 12px;
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

.panel-head strong,
.chart-head strong {
  color: #202330;
  font-size: 14px;
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

.chart-head button {
  border: 0;
  background: transparent;
  color: var(--orange);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 900;
}

.chart-head button:hover {
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

.wide-chart-head div {
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
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
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
.snapshot-table {
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
  grid-template-columns: minmax(170px, 1.45fr) .75fr .44fr .74fr .62fr .62fr .46fr .46fr .52fr;
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
  grid-template-columns: minmax(120px, 1.05fr) minmax(112px, .92fr) .62fr .42fr .54fr .44fr .72fr .62fr minmax(180px, 1.3fr);
  gap: 10px;
  align-items: center;
  min-height: 38px;
  min-width: 1120px;
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

.account-table-head,
.snapshot-head {
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
.snapshot-row {
  border-radius: 7px;
  background: #f8f9fb;
  font-size: 12px;
}

.account-table-row em,
.snapshot-row em {
  color: #00a67e;
  font-style: normal;
  font-weight: 900;
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
  .update-plan-main-grid,
  .update-plan-sub-grid {
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
  .update-plan-main-grid,
  .update-plan-sub-grid {
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

  .update-owner-grid {
    grid-template-columns: 1fr;
  }
}
</style>
