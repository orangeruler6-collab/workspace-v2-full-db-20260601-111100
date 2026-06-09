<template>
  <div class="ops-module">
    <div class="module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">📊</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">PROFIT BOARD</div>
          <h2>流水看板</h2>
        </div>
      </div>
      <button class="ai-chat-btn" @click="openAiChat" title="AI分析">🤖 AI分析</button>
    </div>

    <div class="group-tabs">
      <button class="group-tab department-tab" :class="{ active: isDepartmentView }" @click="switchDepartment">部门总览</button>
      <button v-for="g in GROUPS" :key="g.id" class="group-tab" :class="{ active: !isDepartmentView && activeGroup === g.id }" @click="switchGroup(g.id)">{{ g.label }}</button>
    </div>

    <div class="year-month-bar">
      <select class="inp ym-select" v-model="selectedYear" @change="onFilterChange">
        <option v-for="y in availableYears" :key="y" :value="y">{{ y }}年</option>
      </select>
      <select class="inp ym-select" v-model="selectedMonth" @change="onFilterChange">
        <option value="">全部月份</option>
        <option v-for="m in 12" :key="m" :value="m">{{ m }}月</option>
      </select>
      <label v-if="!isDepartmentView" class="target-editor">
        <span>毛利目标</span>
        <input
          class="inp target-input"
          type="number"
          min="0"
          step="1000"
          v-model.number="targetDraft"
          @change="saveProfitTarget"
          @keyup.enter="saveProfitTarget"
        />
      </label>
      <span class="ym-info" v-if="prevMonthData">
        上月对比: <span :class="prevMonthDiff >= 0 ? 'diff-up' : 'diff-down'">{{ prevMonthDiff >= 0 ? '+' : '' }}{{ prevMonthDiff }}%</span>
      </span>
    </div>

    <div v-if="isDepartmentView" class="department-board">
      <div class="department-hero">
        <div class="department-hero-main">
          <span class="dept-eyebrow">部门业绩总览</span>
          <strong>￥{{ departmentSummary.margin.toLocaleString() }}</strong>
          <em>{{ selectedYear }}年{{ selectedMonth ? selectedMonth + '月' : '全部月份' }}毛利，覆盖 {{ departmentSummary.groupCount }} 个组 / {{ departmentSummary.accountCount }} 个账号</em>
        </div>
        <div class="department-hero-stats">
          <div><span>总流水</span><strong>￥{{ departmentSummary.total.toLocaleString() }}</strong></div>
          <div><span>毛利率</span><strong>{{ departmentSummary.marginRate }}%</strong></div>
          <div><span>项目数</span><strong>{{ departmentSummary.projectCount }}</strong></div>
          <div><span>记录数</span><strong>{{ departmentSummary.count }}</strong></div>
        </div>
      </div>
      <div class="history-compare-strip">
        <article v-for="card in historyComparison.cards" :key="'dept-' + card.key">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <em>{{ card.note }}</em>
        </article>
      </div>

      <div class="dept-import-card">
        <div class="dept-import-copy">
          <strong>全部门增量导入</strong>
          <span>导入 Excel 里新增的数据；库里已有但 Excel 没出现的手工补录、平台收益、素材代做都会保留。</span>
          <em v-if="deptImport.fileName">已选择：{{ deptImport.fileName }}</em>
        </div>
        <label class="dept-import-drop" :class="{ busy: deptImport.parsing || profitWriting }">
          <input type="file" accept=".xlsx,.xls" :disabled="deptImport.parsing || profitWriting" @change="onDepartmentImportFileChange" />
          <span>{{ deptImport.parsing ? '解析中...' : '选择 Excel 增量导入' }}</span>
        </label>
      </div>

      <div v-if="loadingDepartment" class="loading-text">加载部门数据中...</div>
      <template v-else>
        <div class="dept-panel wide matrix-panel">
          <div class="dept-panel-title">平台 × 赛道</div>
          <div class="matrix-summary">
            <span>四格覆盖 ￥{{ platformVerticalCoverage.matchedRevenue.toLocaleString() }} / {{ platformVerticalCoverage.matchedCount }}条</span>
            <span>未纳入 ￥{{ platformVerticalCoverage.unmatchedRevenue.toLocaleString() }} / {{ platformVerticalCoverage.unmatchedCount }}条</span>
          </div>
          <div class="platform-matrix">
            <div v-for="item in platformVerticalBoard" :key="item.name" class="matrix-tile">
              <div class="matrix-head">
                <strong>{{ item.name }}</strong>
                <span>{{ item.count }}条</span>
              </div>
              <div class="matrix-money">￥{{ item.revenue.toLocaleString() }}</div>
              <div class="matrix-meta">毛利率 {{ item.marginRate }}% · 占比 {{ item.share }}%</div>
              <div class="matrix-bar"><i :style="{ width: item.share + '%' }"></i></div>
            </div>
          </div>
          <div v-if="platformVerticalUnmatched.length" class="matrix-unmatched">
            <span v-for="item in platformVerticalUnmatched" :key="item.name">{{ item.name }} ￥{{ item.revenue.toLocaleString() }}</span>
          </div>
        </div>

        <div class="department-grid">
          <div class="dept-panel radar-panel">
            <div class="dept-panel-title">各组流水雷达图</div>
            <div class="radar-wrap">
              <svg viewBox="0 0 260 244" class="radar-svg" role="img" aria-label="部门业绩六边形图">
                <polygon class="radar-ring radar-ring-3" points="130,20 225,75 225,165 130,220 35,165 35,75" />
                <polygon class="radar-ring radar-ring-2" points="130,53 196,91 196,149 130,187 64,149 64,91" />
                <polygon class="radar-ring radar-ring-1" points="130,86 168,108 168,132 130,154 92,132 92,108" />
                <line v-for="(axis, i) in departmentRadar" :key="'axis-' + axis.label" class="radar-axis" x1="130" y1="120" :x2="axis.outer.x" :y2="axis.outer.y" />
                <polygon class="radar-area" :points="departmentRadarPoints" />
                <circle v-for="axis in departmentRadar" :key="axis.label" class="radar-dot" :cx="axis.point.x" :cy="axis.point.y" r="3.5" />
                <text v-for="axis in departmentRadar" :key="'label-' + axis.label" class="radar-label" :x="axis.labelPoint.x" :y="axis.labelPoint.y" text-anchor="middle">{{ axis.label }}</text>
              </svg>
              <div class="radar-score-list">
                <div v-for="axis in departmentRadar" :key="'score-' + axis.label" class="radar-score">
                  <span :title="axis.fullLabel">{{ axis.label }}</span>
                  <strong>￥{{ axis.revenue.toLocaleString() }}</strong>
                </div>
              </div>
            </div>
          </div>

          <div class="dept-panel">
            <div class="dept-panel-title">小组贡献排行</div>
            <div class="dept-ranking">
              <div v-for="item in groupPerformance" :key="item.group" class="dept-rank-row">
                <div class="rank-main">
                  <strong>{{ item.group }}</strong>
                  <span>{{ item.count }}条 / {{ item.projects }}个项目 / {{ item.marginRate }}%毛利率</span>
                </div>
                <div class="rank-money">￥{{ item.margin.toLocaleString() }}</div>
                <div class="rank-bar"><i :style="{ width: item.pct + '%' }"></i></div>
              </div>
            </div>
          </div>

          <div class="dept-panel">
            <div class="dept-panel-title">平台收益结构</div>
            <div class="dept-chip-list">
              <div v-for="(item, i) in platformPerformance" :key="item.name" class="dept-chip-row">
                <span class="legend-dot" :style="{ background: bizColors[i % bizColors.length] }"></span>
                <strong>{{ item.name }}</strong>
                <em>{{ item.share }}%</em>
                <span>￥{{ item.revenue.toLocaleString() }}</span>
              </div>
              <div v-if="platformPerformance.length === 0" class="legend-empty">暂无数据</div>
            </div>
          </div>

          <div class="dept-panel">
            <div class="dept-panel-title">业务类型分布</div>
            <div class="dept-chip-list">
              <div v-for="(item, i) in categoryPerformance" :key="item.name" class="dept-chip-row">
                <span class="legend-dot" :style="{ background: deptPalette[i % deptPalette.length] }"></span>
                <strong>{{ item.name }}</strong>
                <em>{{ item.share }}%</em>
                <span>￥{{ item.revenue.toLocaleString() }}</span>
              </div>
              <div v-if="categoryPerformance.length === 0" class="legend-empty">暂无数据</div>
            </div>
          </div>

          <div class="dept-panel dept-list-panel">
            <div class="dept-panel-title">项目毛利 Top 8</div>
            <div class="dept-project-grid">
              <div v-for="item in projectRanking" :key="item.name" class="dept-project-row">
                <span class="project-title" :title="item.name">{{ item.name }}</span>
                <span>{{ item.count }}条</span>
                <strong>￥{{ item.margin.toLocaleString() }}</strong>
                <div class="rank-bar"><i :style="{ width: item.pct + '%' }"></i></div>
              </div>
              <div v-if="projectRanking.length === 0" class="legend-empty">暂无数据</div>
            </div>
          </div>

          <div class="dept-panel dept-list-panel">
            <div class="dept-panel-title">账号毛利 Top 10</div>
            <div class="dept-account-grid">
              <div v-for="item in accountRanking" :key="item.name" class="dept-account-row">
                <strong :title="item.name">{{ item.name }}</strong>
                <span>{{ item.group || '未分组' }}</span>
                <em>￥{{ item.margin.toLocaleString() }}</em>
              </div>
              <div v-if="accountRanking.length === 0" class="legend-empty">暂无数据</div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <template v-else>
    <div class="kpi-grid">
      <div class="kpi-card kpi-goal">
        <div class="kpi-ring" :style="{ '--kpi-rate': Math.min(profitSummary.rate, 100) + '%' }">
          <span>{{ profitSummary.rate }}%</span>
        </div>
        <div class="kpi-main">
          <span class="kpi-label">目标完成率</span>
          <strong>￥{{ profitSummary.margin.toLocaleString() }}</strong>
          <em>目标 ￥{{ profitSummary.target.toLocaleString() }}，还差 ￥{{ profitGap.toLocaleString() }}</em>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">总流水</span>
        <strong>￥{{ profitSummary.total.toLocaleString() }}</strong>
        <em>当前筛选 {{ profitSummary.count }} 条记录</em>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">平均毛利率</span>
        <strong>{{ marginRate }}%</strong>
        <em>毛利 / 流水</em>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">项目数</span>
        <strong>{{ profitSummary.count }}</strong>
        <em>按毛利降序查看明细</em>
      </div>
    </div>

    <div class="history-compare-strip">
      <article v-for="card in historyComparison.cards" :key="'group-' + card.key">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <em>{{ card.note }}</em>
      </article>
    </div>

    <div class="ops-grid">
      <!-- Card 1: 环形图 - 各业务占比 -->
      <div class="ops-card">
        <div class="card-title">📊 {{ currentGroupLabel }} 业务占比</div>
        <div class="donut-wrap distribution-wrap">
          <div class="donut-center">
            <div class="donut-pct">{{ profitSummary.rate }}%</div>
            <div class="donut-label">完成率</div>
          </div>
          <div class="donut-legend distribution-list">
            <div v-for="(item, i) in bizBreakdown" :key="item.type" class="legend-item">
              <span class="legend-dot" :style="{ background: bizColors[i % bizColors.length] }"></span>
              <span class="legend-type">{{ item.type }}</span>
              <span class="legend-pct">{{ item.pct }}%</span>
              <span class="legend-bar"><i :style="{ width: item.pct + '%', background: bizColors[i % bizColors.length] }"></i></span>
            </div>
            <div v-if="bizBreakdown.length === 0" class="legend-empty">暂无数据</div>
          </div>
        </div>
        <div class="rule-note"><span>⚠️</span>记录口径：只记自己账号</div>
      </div>

      <!-- Card 2: 账号流水 -->
      <div class="ops-card">
        <div class="card-title">👤 {{ currentGroupLabel }} 账号流水</div>
        <div class="account-list">
          <div v-for="(item, i) in accountBreakdown" :key="item.account" class="account-row">
            <span class="account-name">{{ item.account }}</span>
            <span class="account-bar"><i :style="{ width: item.pct + '%' }"></i></span>
            <span class="account-amount">￥{{ item.amount.toLocaleString() }}</span>
          </div>
          <div v-if="accountBreakdown.length === 0" class="account-empty">暂无数据</div>
        </div>
      </div>

      <!-- Card 3: 数据表格 + 毛利概览 -->
      <div class="ops-card wide">
        <div class="card-title">📋 流水记录 <span class="card-sub">（本地数据库）</span></div>
        <div v-if="loadingProfit" class="loading-text">加载中...</div>
        <div v-else-if="profitSummary">
          <!-- 紧凑的一行统计 + 进度条 -->
          <div class="summary-inline">
            <span class="inline-item">毛利目标 <em>￥{{ profitSummary.target.toLocaleString() }}</em></span>
            <span class="inline-item">当前毛利 <em class="accent">￥{{ profitSummary.margin.toLocaleString() }}</em></span>
            <span class="inline-item">总流水 <em>￥{{ profitSummary.total.toLocaleString() }}</em></span>
            <span class="inline-item">项目数 <em>{{ profitSummary.count }}个</em></span>
          </div>
          <div class="progress-bar-wrap" style="margin:12px 0;">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: Math.min(profitSummary.rate, 100) + '%' }"></div>
            </div>
            <span class="progress-label">完成率 {{ profitSummary.rate }}% / 100%</span>
          </div>
          <!-- 数据表格 -->
          <div v-if="sortedItems.length" class="profit-table">
            <div class="pt-head">
              <span>项目</span><span>账号</span><span>类型</span><span>平台</span><span>流水</span><span>毛利</span><span></span>
            </div>
            <div v-for="item in sortedItems" :key="item.id" class="pt-row">
              <span class="proj-name" :title="item.项目">{{ item.项目 }}</span>
              <span class="account-name">{{ item.账号 }}</span>
              <span class="type-tag" :class="getTypeClass(item.类型)">{{ item.类型 || '一口价' }}</span>
              <span class="platform-tag">{{ item.平台 }}</span>
              <span class="amount">￥{{ Math.round(Number(item.费用 || 0)).toLocaleString() }}</span>
              <span class="amount accent">￥{{ Math.round(Number(item.毛利 || 0)).toLocaleString() }}</span>
              <span class="pt-actions">
                <button v-if="item.链接" class="btn-op btn-link" @click="openProfitLink(item.链接)">打开</button>
                <button class="btn-op btn-edit" @click="openEditModal(item)">✏️</button>
                <button class="btn-op btn-del" @click="deleteItem(item.id)">🗑️</button>
              </span>
            </div>
          </div>
          <div v-else class="loading-text"><span>暂无数据，请从下方录入</span></div>
          <div class="table-actions">
            <button class="btn btn-ghost btn-sm" @click="loadProfitData">🔄 刷新</button>
            <button class="btn btn-ghost btn-sm" style="color:#f87171" @click="clearAll">🗑 清空全部</button>
          </div>
        </div>
      </div>

      <!-- Card 4: 毛利录入 -->
      <div class="ops-card wide">
        <div class="card-title">📝 毛利录入 <span class="card-sub">粘贴信息或拖入Excel → 规则/智能解析 → 写入本地数据库</span></div>
        <div class="import-mode-switch">
          <button class="btn btn-ghost btn-sm" :class="{ active: profitImportMode === 'single' }" @click="profitImportMode = 'single'">当前组导入</button>
          <button class="btn btn-ghost btn-sm" :class="{ active: profitImportMode === 'total' }" @click="profitImportMode = 'total'">总表导入</button>
          <button class="btn btn-primary btn-sm" @click="openCreateModal">手动新增</button>
          <button class="btn btn-ghost btn-sm" :disabled="feishuSyncing" @click="syncCurrentProfitsToFeishu">{{ feishuSyncing ? '同步中...' : '同步飞书' }}</button>
        </div>
        <button class="entry-toggle" @click="entryExpanded = !entryExpanded">
          <strong>录入流水 / 导入 Excel</strong>
          <span>{{ entryExpanded ? '收起' : '展开录入' }}</span>
        </button>
        <div v-if="entryExpanded" class="profit-input-area">
          <div class="pi-col">
            <div class="pi-label">📋 文本粘贴</div>
            <textarea v-model="profitText" class="inp pi-textarea" rows="5" placeholder="粘贴确认信息，如：&#10;逆水寒96条素材代做，16218元合计&#10;天机妹 逆水寒 3500元 5月"></textarea>
            <div class="parse-actions">
              <button class="btn btn-ghost" :disabled="profitParsing" @click="parseProfitTextRule">{{ profitParsing && profitParseMode === 'rule' ? '规则解析中...' : '规则解析' }}</button>
              <button class="btn btn-primary" :disabled="profitParsing" @click="parseProfitTextSmart">{{ profitParsing && profitParseMode === 'smart' ? '智能解析中...' : '智能解析' }}</button>
            </div>
          </div>
          <div class="pi-col">
            <div class="pi-label">📊 Excel拖入</div>
            <div class="drop-zone" :class="{ 'drag-over': profitDragOver }"
              @dragover.prevent="profitDragOver=true"
              @dragleave="profitDragOver=false"
              @drop.prevent="onProfitDrop">
              <div class="dz-icon">📁</div>
              <div class="dz-text">拖入Excel文件到这里</div>
              <div class="dz-hint">或点击选择文件</div>
              <input type="file" accept=".xlsx,.xls" class="dz-input" @change="onProfitFileChange" />
            </div>
            <div v-if="profitFileName" class="dz-filename">📄 {{ profitFileName }}</div>
          </div>
        </div>
        <div v-if="parsedRecords.length" class="parsed-preview">
          <div class="pp-head">
            <span>组别</span><span>账号</span><span>项目</span><span>平台</span><span>流水</span><span>毛利</span><span>档期</span><span>备注</span>
          </div>
          <div v-for="(r,i) in parsedRecords" :key="i" class="pp-row">
            <span>{{ r.grp || currentGroupLabel }}</span>
            <span>{{ r.account }}</span>
            <span>{{ r.project }}</span>
            <span>{{ r.platform }}</span>
            <span class="fee">￥{{ Number(r.fee || 0).toLocaleString() }}</span>
            <span class="fee accent">￥{{ Number(r.margin || 0).toLocaleString() }}</span>
            <span>{{ r.schedule }}</span>
            <span>{{ r.note }}</span>
          </div>
          <div class="pp-actions">
            <button class="btn btn-primary" :disabled="profitWriting" @click="writeParsedRecords">{{ profitWriting ? '写入中...' : (profitImportMode === 'total' ? '🔁 同步数据库（' + parsedRecords.length + '条）' : '📤 写入数据库（' + parsedRecords.length + '条）') }}</button>
            <button class="btn btn-ghost btn-sm" @click="parsedRecords=[]">取消</button>
          </div>
        </div>
        <div v-if="parsedError" class="parsed-error">{{ parsedError }}</div>
      </div>
    </div>
    </template>

    <!-- 修改记录弹窗 -->
    <div v-if="editModal.show" class="modal-mask" @click.self="editModal.show=false">
      <div class="modal-box">
        <div class="modal-title">📝 {{ editModal.mode === 'create' ? '新增流水记录' : '修改流水记录' }}</div>
        <div class="modal-form">
          <div class="mf-row"><label>归属组</label>
            <select class="inp" v-model="editModal.data.组别">
              <option v-for="group in GROUPS" :key="group.id" :value="group.label">{{ group.label }}</option>
            </select>
          </div>
          <div class="mf-row"><label>账号</label><input class="inp" v-model="editModal.data.账号" placeholder="账号 / 素材 / 平台收益"></div>
          <div class="mf-row"><label>产品/项目</label><input class="inp" v-model="editModal.data.项目" placeholder="产品或项目名"></div>
          <div class="mf-row"><label>业务口径</label>
            <select class="inp" v-model="editModal.data.类型">
              <option v-for="type in PROFIT_BUSINESS_TYPES" :key="type" :value="type">{{ type }}</option>
            </select>
          </div>
          <div class="mf-row"><label>平台</label>
            <select class="inp" v-model="editModal.data.平台">
              <option v-for="platform in PROFIT_PLATFORM_OPTIONS" :key="platform" :value="platform">{{ platform }}</option>
            </select>
          </div>
          <div class="mf-row"><label>档期</label><input class="inp" v-model="editModal.data.档期"></div>
          <div class="mf-row"><label>下单金额（元）</label><input class="inp" type="number" v-model.number="editModal.data.下单金额"></div>
          <div class="mf-row"><label>最终合作价/流水（元）</label><input class="inp" type="number" v-model.number="editModal.data.费用" @input="syncManualFinancials"></div>
          <div class="mf-row"><label>预估毛利（元）</label><input class="inp" type="number" v-model.number="editModal.data.毛利" @input="syncManualFinancials"></div>
          <div class="mf-row"><label>来源</label>
            <select class="inp" v-model="editModal.data.来源">
              <option value="manual">手动录入</option>
              <option value="ai">AI解析</option>
              <option value="excel">Excel导入</option>
            </select>
          </div>
          <label class="mf-check">
            <input type="checkbox" v-model="editModal.data.内部分成" @change="syncInternalSplitDefaults">
            <span>内部代做分成</span>
          </label>
          <label class="mf-check">
            <input type="checkbox" v-model="editModal.data.是否发布">
            <span>已发布</span>
          </label>
          <div v-if="editModal.data.是否发布" class="mf-split-grid">
            <label><span>发布日期</span><input class="inp" v-model="editModal.data.发布日期" placeholder="例如 2026-06-10"></label>
            <label><span>发布链接</span><input class="inp" v-model="editModal.data.链接" placeholder="粘贴链接，表格只显示打开按钮"></label>
          </div>
          <div v-if="editModal.data.内部分成" class="mf-split-grid">
            <label><span>原组</span>
              <select class="inp" v-model="editModal.data.原组">
                <option v-for="group in GROUPS" :key="'origin-' + group.id" :value="group.label">{{ group.label }}</option>
              </select>
            </label>
            <label><span>代做组</span>
              <select class="inp" v-model="editModal.data.代做组">
                <option value="">请选择代做组</option>
                <option v-for="group in GROUPS" :key="'producer-' + group.id" :value="group.label">{{ group.label }}</option>
              </select>
            </label>
            <label><span>原组比例 %</span><input class="inp" type="number" min="0" max="100" v-model.number="editModal.data.原组比例"></label>
            <label><span>代做比例 %</span><input class="inp" type="number" min="0" max="100" v-model.number="editModal.data.代做比例"></label>
          </div>
          <div class="mf-row"><label>备注</label><input class="inp" v-model="editModal.data.备注"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" @click="doEditRecord">{{ editModal.mode === 'create' ? '新增' : '保存' }}</button>
          <button class="btn btn-ghost btn-sm" @click="editModal.show=false">取消</button>
        </div>
      </div>
    </div>

    <!-- AI Chat Modal -->
    <div v-if="aiChat.show" class="modal-mask" @click.self="aiChat.show=false">
      <div class="modal-box ai-chat-modal">
        <div class="modal-title">🤖 AI 数据分析</div>
        <div class="ai-chat-intro">
          当前数据：{{ currentGroupLabel }} {{ selectedYear }}年{{ selectedMonth ? selectedMonth + '月' : '全部月份' }}，
          共 {{ filteredItems.length }} 条记录，
          毛利 ￥{{ filteredItems.reduce((s,i) => s+(Number(i.毛利)||0), 0).toLocaleString() }}
        </div>
        <div class="ai-chat-history" ref="aiChatHistory">
          <div v-for="(msg, i) in aiChat.history" :key="i" class="chat-msg" :class="msg.role">
            <div class="chat-bubble">{{ msg.content }}</div>
          </div>
        </div>
        <div class="ai-chat-input">
          <input class="inp" v-model="aiChat.input" :placeholder="isDepartmentView ? '问我关于部门总览的数据...' : '问我关于这个组的数据...'" @keyup.enter="sendAiChat">
          <button class="btn btn-primary btn-sm" @click="sendAiChat" :disabled="aiChat.sending">{{ aiChat.sending ? '分析中...' : '发送' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  addProfit,
  deleteProfit,
  importFeishuProfits,
  listProfits,
  parseProfitFile,
  parseProfitText as parseProfitInput,
  syncProfitRecords,
  syncProfitsToFeishu,
  updateProfit
} from '../api/profit'
import { GROUPS, GROUP_TARGETS, PROFIT_BUSINESS_TYPES, PROFIT_PLATFORM_OPTIONS, PROFIT_RATES, PROFIT_TYPE_LABELS } from './ops/constants'
import { arrayBufferToBase64, calcMargin, toProfitRow } from './ops/utils'
import { callMiniMaxChat, getCurrentAuthUser } from '../api/client'
import { useConfirm } from '../composables/useConfirm'
import { useToast } from '../composables/useToast'

const confirmAction = useConfirm()
const { showToast } = useToast()

function getTypeClass(type) {
  const t = type || '一口价'
  if (t.includes('一口价') || t.includes('直播')) return 'type-yijia'
  if (t.includes('流量激励')) return 'type-liuliang'
  if (t.includes('短视频')) return 'type-duan'
  if (t.includes('星广')) return 'type-xingguang'
  if (t.includes('内部')) return 'type-neibu'
  if (t.includes('素材')) return 'type-sucai'
  return 'type-default'
}

function openProfitLink(rawLink) {
  const link = String(rawLink || '').trim()
  if (!link) return
  const url = /^https?:\/\//i.test(link) ? link : `https://${link}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

function normalizeGroupKey(value) {
  return String(value || '')
    .trim()
    .replace(/\u5185\u5bb9/g, '')
    .replace(/\u7ec4/g, '')
}

function resolveCurrentUserGroup() {
  const user = getCurrentAuthUser()
  if (!user) return null

  const groupText = String(user.group_name || user.groupName || user.group || '').trim()
  if (groupText) {
    const groupKey = normalizeGroupKey(groupText)
    const matchedByGroup = GROUPS.find(group => {
      return group.label === groupText
        || String(group.id) === groupText
        || normalizeGroupKey(group.label) === groupKey
    })
    if (matchedByGroup) return matchedByGroup
  }

  const userName = String(user.real_name || user.display_name || user.username || '').trim()
  return GROUPS.find(group => (group.members || []).includes(userName)) || null
}

const initialUserGroup = resolveCurrentUserGroup()
const activeGroup = ref(initialUserGroup?.id || GROUPS[0]?.id || 1)
const currentGroupLabel = computed(() => isDepartmentView.value ? '部门总览' : (GROUPS.find(g => g.id === activeGroup.value)?.label || ''))

// Year/Month filter
const currentYear = new Date().getFullYear()
const selectedYear = ref(currentYear)
const selectedMonth = ref(new Date().getMonth() + 1)
const availableYears = [currentYear, currentYear - 1, currentYear - 2]
const profitTargets = ref(loadProfitTargets())
const targetDraft = ref(0)
const profitImportMode = ref('single')
const isDepartmentView = ref(!initialUserGroup)
const deptImport = reactive({
  parsing: false,
  fileName: ''
})

function targetKey(groupId = activeGroup.value, year = selectedYear.value, month = selectedMonth.value) {
  return `${groupId}:${year}:${month || 'all'}`
}

function loadProfitTargets() {
  try {
    const raw = localStorage.getItem('usagi_profit_targets')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persistProfitTargets() {
  try {
    localStorage.setItem('usagi_profit_targets', JSON.stringify(profitTargets.value))
  } catch {}
}

function currentProfitTarget() {
  const value = profitTargets.value[targetKey()]
  if (value !== undefined && value !== null && value !== '') return Number(value) || 0
  return GROUP_TARGETS[activeGroup.value] || 0
}

function syncTargetDraft() {
  targetDraft.value = currentProfitTarget()
}

function saveProfitTarget() {
  const value = Math.max(0, Number(targetDraft.value) || 0)
  targetDraft.value = value
  profitTargets.value = {
    ...profitTargets.value,
    [targetKey()]: value
  }
  persistProfitTargets()
  showToast('毛利目标已保存', 'success')
}

function onFilterChange() {
  // Filter is applied client-side via filteredItems computed
  syncTargetDraft()
}

async function switchDepartment() {
  isDepartmentView.value = true
  await loadDepartmentData()
}

async function switchGroup(id) {
  isDepartmentView.value = false
  activeGroup.value = id
  syncTargetDraft()
  await loadProfitData()
}

watch([selectedYear, selectedMonth, activeGroup], syncTargetDraft)

// ---- calc ----
const calcType = ref('daizuo')
const calcName = ref('')
const calcRevenue = ref(0)
const calcCost = ref(0)
const calcResult = ref(null)
const profitRate = ref('')

function calcProfit() {
  if (!calcRevenue.value || calcRevenue.value <= 0) { showToast('请输入正确的收入金额', 'error'); return }
  profitRate.value = PROFIT_RATES[calcType.value]
  calcResult.value = Math.round(calcRevenue.value * profitRate.value / 100)
  showToast(PROFIT_TYPE_LABELS[calcType.value] + ' ￥' + calcRevenue.value + ' → 毛利 ￥' + calcResult.value, 'success')
}

// ---- 数据按组隔离 ----
function makeKey(gid) { return 'usagi_profit_g' + gid }
function loadLocal(gid) {
  try {
    const raw = localStorage.getItem(makeKey(gid))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function saveLocal(gid, items) {
  try { localStorage.setItem(makeKey(gid), JSON.stringify(items)) } catch {}
}
const groupData = reactive(Object.fromEntries(GROUPS.map(g => [g.id, []])))
const loadingProfit = ref(false)
const departmentItems = ref([])
const loadingDepartment = ref(false)
const currentItems = computed(() => isDepartmentView.value ? departmentItems.value : (groupData[activeGroup.value] || []))

function itemMonthNumber(item) {
  const match = String(item?.档期 || '').match(/(^|[^\d])(1[0-2]|0?[1-9])\s*月/)
  return match ? Number(match[2]) : 0
}

function itemYearNumber(item) {
  const raw = String(item?.档期 || '')
  const match = raw.match(/(20\d{2})\s*(?:年|-|\/|\.)/)
  if (match) return Number(match[1])
  const created = Number(item?.创建时间) || 0
  if (created) return new Date(created * 1000).getFullYear()
  return currentYear
}

function filterBySelectedPeriod(items, month = selectedMonth.value, year = selectedYear.value) {
  return (items || [])
    .filter(item => !year || itemYearNumber(item) === Number(year))
    .filter(item => !month || itemMonthNumber(item) === Number(month))
}

function splitDepartmentItem(item) {
  if (!item?.内部分成) return [item]
  const originGroup = item.原组 || item.组别
  const producerGroup = item.代做组 || ''
  if (!originGroup || !producerGroup) return [item]
  const originShare = Math.max(0, Math.min(100, Number(item.原组比例) || 30))
  const producerShare = Math.max(0, Math.min(100, Number(item.代做比例) || (100 - originShare)))
  const makePart = (group, share, role) => ({
    ...item,
    id: `${item.id || item.项目}-${role}`,
    组别: group,
    费用: Math.round((Number(item.费用) || 0) * share / 100),
    毛利: Math.round((Number(item.毛利) || 0) * share / 100),
    备注: [item.备注, role === 'origin' ? `原组${share}%` : `代做组${share}%`].filter(Boolean).join('；')
  })
  return [
    makePart(originGroup, originShare, 'origin'),
    makePart(producerGroup, producerShare, 'producer')
  ]
}

const departmentEffectiveItems = computed(() => departmentItems.value.flatMap(splitDepartmentItem))

// Year/Month filtered items
const filteredItems = computed(() => {
  return filterBySelectedPeriod(currentItems.value)
})

// Sorted items by margin descending
const sortedItems = computed(() => {
  return [...filteredItems.value].sort((a, b) => (Number(b.毛利) || 0) - (Number(a.毛利) || 0))
})

// Summary follows the selected year, with optional month narrowing.
const profitSummary = computed(() => {
  const items = filteredItems.value
  const total = items.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  const margin = items.reduce((s, i) => s + (Number(i.毛利) || 0), 0)
  const target = currentProfitTarget()
  return { target, total, margin, rate: target > 0 ? Math.round(margin / target * 100) : 0, count: items.length, items }
})

const profitGap = computed(() => Math.max(0, profitSummary.value.target - profitSummary.value.margin))
const marginRate = computed(() => {
  if (!profitSummary.value.total) return 0
  return Math.round(profitSummary.value.margin / profitSummary.value.total * 100)
})

function toDepartmentRow(item) {
  return {
    ...toProfitRow(item),
    组别: item.grp || ''
  }
}

function isGenericProjectLabel(name) {
  const raw = String(name || '').trim()
  if (!raw) return true
  return ['流量激励', '平台收益', '未命名项目', '未命名'].includes(raw)
}

function normalizePlatformLabel(value) {
  const raw = String(value || '').toLowerCase()
  if (raw.includes('b站') || raw.includes('bilibili') || raw.includes('哔哩')) return 'B站'
  if (raw.includes('抖音') || raw.includes('douyin')) return '抖音'
  return ''
}

function inferVerticalLabel(item) {
  const raw = [item.项目, item.类型, item.备注].filter(Boolean).join(' ').toLowerCase()
  if (!raw) return ''
  if (/(游戏|手游|端游|电竞|steam|tap|taptap|无畏|守望|三角洲|原神|方舟|王者|传奇|幻境|西游|逆水寒|cf|和平精英|地平线|刺客信条|鸣潮|燕云|心动小镇|造梦|战火|七日世界|英魂|决斗链接|网易520|克烈)/.test(raw)) return '游戏'
  if (/(数码|科技|电子|手机|相机|耳机|路由|家电|茶吧机|冰块|飞利浦|京东|天猫|充电|笔记本|显示器|投影|平板|净水器|扫地|机器人|空气净化|按摩椅|智能眼镜|划船机|吸尘器|咖啡机|音箱|电视|ai|tcl|东芝|荣耀|三星|淘宝|美的|安吉尔|科沃斯|韦思卡尔|奥佳华|漫步者|水星家纺|雷鸟)/.test(raw)) return '数码'
  return ''
}

function normalizeMonthFilter(items) {
  return filterBySelectedPeriod(items)
}

function makeGroupMap() {
  const map = new Map(GROUPS.map(group => [group.label, {
    group: group.label,
    revenue: 0,
    margin: 0,
    count: 0,
    projects: new Set(),
    accounts: new Set()
  }]))
  return map
}

function cap(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

const departmentSummary = computed(() => {
  const items = normalizeMonthFilter(departmentEffectiveItems.value)
  const total = items.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  const margin = items.reduce((s, i) => s + (Number(i.毛利) || 0), 0)
  const projects = new Set()
  const fallbackProjects = new Set()
  const accounts = new Set()
  const groups = new Set()
  for (const item of items) {
    if (item.项目) {
      fallbackProjects.add(item.项目)
      if (!isGenericProjectLabel(item.项目)) projects.add(item.项目)
    }
    if (item.账号) accounts.add(item.账号)
    if (item.组别) groups.add(item.组别)
  }
  const projectCount = projects.size || fallbackProjects.size
  return {
    total,
    margin,
    count: items.length,
    projectCount,
    accountCount: accounts.size,
    groupCount: groups.size,
    marginRate: total ? Math.round(margin / total * 100) : 0
  }
})

const groupPerformance = computed(() => {
  const items = normalizeMonthFilter(departmentEffectiveItems.value)
  const map = makeGroupMap()
  for (const item of items) {
    const label = item.组别 || normalizeProfitGroup(item.组别) || inferGroupFromAccount(item.账号) || ''
    const target = map.get(label)
    if (!target) continue
    target.revenue += Number(item.费用) || 0
    target.margin += Number(item.毛利) || 0
    target.count += 1
    if (item.项目) target.projects.add(item.项目)
    if (item.账号) target.accounts.add(item.账号)
  }
  const rows = [...map.values()].map(item => ({
    ...item,
    projects: item.projects.size,
    accounts: item.accounts.size,
    marginRate: item.revenue ? Math.round(item.margin / item.revenue * 100) : 0
  }))
  const maxMargin = Math.max(1, ...rows.map(item => item.margin))
  return rows
    .map(item => ({ ...item, pct: Math.round(item.margin / maxMargin * 100) }))
    .sort((a, b) => b.margin - a.margin)
})

const platformPerformance = computed(() => {
  const items = normalizeMonthFilter(departmentEffectiveItems.value)
  const total = items.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  const map = new Map()
  for (const item of items) {
    const key = item.平台 || '未知'
    const curr = map.get(key) || { name: key, revenue: 0, margin: 0 }
    curr.revenue += Number(item.费用) || 0
    curr.margin += Number(item.毛利) || 0
    map.set(key, curr)
  }
  return [...map.values()]
    .map(item => ({ ...item, share: total ? Math.round(item.revenue / total * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
})

const categoryPerformance = computed(() => {
  const items = normalizeMonthFilter(departmentEffectiveItems.value)
  const total = items.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  const map = new Map()
  for (const item of items) {
    const key = item.类型 || '未分类'
    const curr = map.get(key) || { name: key, revenue: 0, margin: 0 }
    curr.revenue += Number(item.费用) || 0
    curr.margin += Number(item.毛利) || 0
    map.set(key, curr)
  }
  return [...map.values()]
    .map(item => ({ ...item, share: total ? Math.round(item.revenue / total * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
})

const platformVerticalBoard = computed(() => {
  const items = normalizeMonthFilter(departmentEffectiveItems.value)
  const total = items.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  const buckets = [
    { name: '抖音游戏', platform: '抖音', vertical: '游戏', revenue: 0, margin: 0, count: 0 },
    { name: 'B站游戏', platform: 'B站', vertical: '游戏', revenue: 0, margin: 0, count: 0 },
    { name: 'B站数码', platform: 'B站', vertical: '数码', revenue: 0, margin: 0, count: 0 },
    { name: '抖音数码', platform: '抖音', vertical: '数码', revenue: 0, margin: 0, count: 0 }
  ]
  for (const item of items) {
    const platform = normalizePlatformLabel(item.平台)
    const vertical = inferVerticalLabel(item)
    if (!platform || !vertical) continue
    const bucket = buckets.find(entry => entry.platform === platform && entry.vertical === vertical)
    if (!bucket) continue
    bucket.revenue += Number(item.费用) || 0
    bucket.margin += Number(item.毛利) || 0
    bucket.count += 1
  }
  return buckets.map(bucket => ({
    ...bucket,
    share: total ? Math.round(bucket.revenue / total * 100) : 0,
    marginRate: bucket.revenue ? Math.round(bucket.margin / bucket.revenue * 100) : 0
  }))
})

const platformVerticalCoverage = computed(() => {
  const items = normalizeMonthFilter(departmentEffectiveItems.value)
  const total = items.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  let matchedRevenue = 0
  let matchedCount = 0
  for (const item of items) {
    const platform = normalizePlatformLabel(item.平台)
    const vertical = inferVerticalLabel(item)
    if ((platform === '抖音' || platform === 'B站') && (vertical === '游戏' || vertical === '数码')) {
      matchedRevenue += Number(item.费用) || 0
      matchedCount += 1
    }
  }
  return {
    matchedRevenue,
    matchedCount,
    unmatchedRevenue: Math.max(0, total - matchedRevenue),
    unmatchedCount: Math.max(0, items.length - matchedCount)
  }
})

const platformVerticalUnmatched = computed(() => {
  const items = normalizeMonthFilter(departmentEffectiveItems.value)
  const map = new Map()
  for (const item of items) {
    const platform = normalizePlatformLabel(item.平台) || item.平台 || '其他平台'
    const vertical = inferVerticalLabel(item) || '未识别'
    if ((platform === '抖音' || platform === 'B站') && (vertical === '游戏' || vertical === '数码')) continue
    const name = `${platform} / ${vertical}`
    const curr = map.get(name) || { name, revenue: 0, count: 0 }
    curr.revenue += Number(item.费用) || 0
    curr.count += 1
    map.set(name, curr)
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 4)
})

const projectRanking = computed(() => {
  const items = normalizeMonthFilter(departmentEffectiveItems.value)
  const candidates = items.filter(item => !isGenericProjectLabel(item.项目))
  const sourceItems = candidates.length ? candidates : items
  const map = new Map()
  for (const item of sourceItems) {
    const key = item.项目 || '未命名项目'
    const curr = map.get(key) || { name: key, revenue: 0, margin: 0, count: 0 }
    curr.revenue += Number(item.费用) || 0
    curr.margin += Number(item.毛利) || 0
    curr.count += 1
    map.set(key, curr)
  }
  const rows = [...map.values()].sort((a, b) => b.margin - a.margin)
  const maxMargin = Math.max(1, ...rows.map(item => item.margin))
  return rows.slice(0, 8).map(item => ({ ...item, pct: Math.round(item.margin / maxMargin * 100) }))
})

const accountRanking = computed(() => {
  const items = normalizeMonthFilter(departmentEffectiveItems.value)
  const map = new Map()
  for (const item of items) {
    const key = item.账号 || '未知账号'
    const curr = map.get(key) || { name: key, group: item.组别 || '', revenue: 0, margin: 0, count: 0 }
    curr.group = curr.group || item.组别 || ''
    curr.revenue += Number(item.费用) || 0
    curr.margin += Number(item.毛利) || 0
    curr.count += 1
    map.set(key, curr)
  }
  return [...map.values()].sort((a, b) => b.margin - a.margin).slice(0, 10)
})

const deptPalette = ['#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#14b8a6']

const departmentRadar = computed(() => {
  const revenueByGroup = new Map(groupPerformance.value.map(item => [item.group, Number(item.revenue) || 0]))
  const maxRevenue = Math.max(1, ...groupPerformance.value.map(item => Number(item.revenue) || 0))
  const axes = GROUPS.map(group => {
    const revenue = revenueByGroup.get(group.label) || 0
    return {
      label: group.label.replace('内容', ''),
      fullLabel: group.label,
      score: cap(revenue / maxRevenue * 100),
      revenue
    }
  })
  const centerX = 130
  const centerY = 120
  const radius = 100
  return axes.map((axis, index) => {
    const angle = (-90 + index * 60) * Math.PI / 180
    const outer = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    }
    const score = axis.score
    const point = {
      x: centerX + Math.cos(angle) * radius * (score / 100),
      y: centerY + Math.sin(angle) * radius * (score / 100)
    }
    const labelPoint = {
      x: centerX + Math.cos(angle) * 110,
      y: centerY + Math.sin(angle) * 110
    }
    return { ...axis, outer, point, labelPoint }
  })
})

const departmentRadarPoints = computed(() => {
  return departmentRadar.value.map(axis => `${axis.point.x},${axis.point.y}`).join(' ')
})

// Previous month comparison
const prevMonthData = computed(() => {
  if (!selectedMonth.value) return null
  const sourceItems = isDepartmentView.value ? departmentEffectiveItems.value : currentItems.value
  let prevMonth = selectedMonth.value - 1
  if (prevMonth <= 0) { prevMonth = 12 }
  const prevYear = selectedMonth.value - 1 <= 0 ? Number(selectedYear.value) - 1 : Number(selectedYear.value)
  const prevItems = filterBySelectedPeriod(sourceItems, prevMonth, prevYear)
  if (prevItems.length === 0) return null
  const total = prevItems.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  const margin = prevItems.reduce((s, i) => s + (Number(i.毛利) || 0), 0)
  return { total, margin }
})

const prevMonthDiff = computed(() => {
  if (!prevMonthData.value) return 0
  const currItems = filteredItems.value
  const currTotal = currItems.reduce((s, i) => s + (Number(i.毛利) || 0), 0)
  const prevMargin = prevMonthData.value.margin
  if (prevMargin === 0) return currTotal > 0 ? 100 : 0
  return Math.round((currTotal - prevMargin) / prevMargin * 100)
})

function summarizeProfitItems(items) {
  const rows = items || []
  const total = rows.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  const margin = rows.reduce((s, i) => s + (Number(i.毛利) || 0), 0)
  const projects = new Set(rows.map(item => item.项目).filter(Boolean))
  return { total, margin, count: rows.length, projects: projects.size }
}

function compareRate(current, base) {
  if (!base) return current ? 100 : 0
  return Math.round((current - base) / base * 100)
}

const historyComparison = computed(() => {
  const sourceItems = isDepartmentView.value ? departmentEffectiveItems.value : currentItems.value
  const month = Number(selectedMonth.value) || 0
  const year = Number(selectedYear.value) || currentYear
  const current = summarizeProfitItems(filterBySelectedPeriod(sourceItems, month, year))
  let prevMonth = month ? month - 1 : 0
  let prevYear = year
  if (month && prevMonth <= 0) {
    prevMonth = 12
    prevYear = year - 1
  }
  const previous = month ? summarizeProfitItems(filterBySelectedPeriod(sourceItems, prevMonth, prevYear)) : null
  const lastYear = month ? summarizeProfitItems(filterBySelectedPeriod(sourceItems, month, year - 1)) : null
  return {
    current,
    previous,
    lastYear,
    cards: [
      {
        key: 'mom',
        label: '环比上月',
        value: previous && previous.count ? `${compareRate(current.margin, previous.margin)}%` : '待补数据',
        note: previous && previous.count ? `上月毛利 ￥${previous.margin.toLocaleString()}` : '导入上月数据后自动计算'
      },
      {
        key: 'yoy',
        label: '同比去年',
        value: lastYear && lastYear.count ? `${compareRate(current.margin, lastYear.margin)}%` : '待补数据',
        note: lastYear && lastYear.count ? `去年同月毛利 ￥${lastYear.margin.toLocaleString()}` : '等待补充去年同期数据'
      },
      {
        key: 'projects',
        label: '项目数对比',
        value: previous && previous.count ? `${current.projects - previous.projects >= 0 ? '+' : ''}${current.projects - previous.projects}` : `${current.projects}`,
        note: `当前 ${current.projects} 个项目 / ${current.count} 条记录`
      }
    ]
  }
})
const circumference = 52 * 2 * Math.PI // r=52, 2πr
const donutPerimeter = 2 * Math.PI * 70 // r=70

const bizColors = ['#7b2fff', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899']

const bizBreakdown = computed(() => {
  const items = filteredItems.value
  const total = items.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  if (total === 0) return []

  const map = {}
  for (const item of items) {
    const type = item.平台 || '未知'
    map[type] = (map[type] || 0) + (Number(item.费用) || 0)
  }

  return Object.entries(map)
    .map(([type, amount]) => ({
      type,
      amount,
      pct: Math.round(amount / total * 100)
    }))
    .sort((a, b) => b.amount - a.amount)
})

// 环形图扇区计算 (r=70)
const donutSegments = computed(() => {
  const items = filteredItems.value
  const total = items.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  if (total === 0) return []

  const map = {}
  for (const item of items) {
    const type = item.平台 || '未知'
    map[type] = (map[type] || 0) + (Number(item.费用) || 0)
  }

  let offset = donutPerimeter * 0.25 // 从顶部开始(3点钟方向)

  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([type, amount]) => {
      const pct = amount / total
      const dashLen = donutPerimeter * pct
      const seg = { type, amount, pct: Math.round(pct * 100), dash: dashLen, offset }
      offset -= dashLen
      return seg
    })
})

// 每个账号的流水
const accountBreakdown = computed(() => {
  const items = filteredItems.value
  const map = {}
  for (const item of items) {
    const acc = item.账号 || '未知'
    map[acc] = (map[acc] || 0) + (Number(item.费用) || 0)
  }
  const max = Math.max(1, ...Object.values(map))
  return Object.entries(map)
    .map(([account, amount]) => ({ account, amount, pct: Math.round(amount / max * 100) }))
    .sort((a, b) => b.amount - a.amount)
})

async function loadProfitData() {
  loadingProfit.value = true
  try {
    const grpLabel = GROUPS.find(g => g.id === activeGroup.value)?.label || '内容组1'
    const d = await listProfits(grpLabel)
    const items = (d.data || []).map(toProfitRow)
    groupData[activeGroup.value] = items
  } catch(e) {
    showToast('加载失败: ' + e.message, 'error')
  }
  loadingProfit.value = false
}

async function loadDepartmentData() {
  loadingDepartment.value = true
  try {
    const d = await listProfits()
    const items = (d.data || []).map(toDepartmentRow)
    departmentItems.value = items
  } catch (e) {
    showToast('加载部门总览失败: ' + e.message, 'error')
  }
  loadingDepartment.value = false
}

async function importFromFeishu() {
  loadingProfit.value = true
  try {
    const data = await importFeishuProfits()
    if (data.items && data.items.length) {
      const items = data.items.map((it, idx) => ({
        id: Date.now() + idx,
        项目: it.项目 || '',
        平台: it.平台 || '',
        账号: it.账号 || '',
        档期: it.档期 || '',
        费用: Number(it.费用) || 0,
        毛利: calcMargin(Number(it.费用) || 0, it.平台 || '抖音'),
        备注: it.备注 || ''
      }))
      groupData[4] = items
      saveLocal(4, items)
      showToast('已导入 ' + items.length + ' 条记录', 'success')
    } else {
      showToast('飞书无数据', 'error')
    }
  } catch(e) {
    showToast('导入失败: ' + e.message, 'error')
  }
  loadingProfit.value = false
}
// ---- entry ----
const profitText = ref('')
const profitParsing = ref(false)
const profitWriting = ref(false)
const feishuSyncing = ref(false)
const profitDragOver = ref(false)
const profitFileName = ref('')
const parsedRecords = ref([])
const parsedError = ref('')
const entryExpanded = ref(false)

const profitParseMode = ref('')

function defaultProfitSchedule() {
  const month = Number(selectedMonth.value) || new Date().getMonth() + 1
  return month + '月'
}

function normalizeProfitSchedule(value) {
  const raw = String(value || '').trim()
  const cnMatch = raw.match(/(^|[^\d])(1[0-2]|0?[1-9])\s*月/)
  if (cnMatch) return Number(cnMatch[2]) + '月'
  const isoMatch = raw.match(/\b(?:20\d{2})[-/.年]\s*(1[0-2]|0?[1-9])(?:[-/.月])/)
  if (isoMatch) return Number(isoMatch[1]) + '月'
  const shortDateMatch = raw.match(/(^|[^\d])(1[0-2]|0?[1-9])\s*[/.]\s*\d{1,2}/)
  if (shortDateMatch) return Number(shortDateMatch[2]) + '月'
  return defaultProfitSchedule()
}

function getScheduleMonthNumber(value) {
  const match = String(value || '').match(/(^|[^\d])(1[0-2]|0?[1-9])\s*月/)
  return match ? Number(match[2]) : 0
}

function extractProfitAmount(text) {
  const raw = String(text || '').replace(/,/g, '')
  const yuan = [...raw.matchAll(/(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*(?:元|块|rmb|RMB|合计)/g)]
  if (yuan.length) return Number(yuan[yuan.length - 1][1]) || 0
  const nums = [...raw.matchAll(/\d+(?:\.\d+)?/g)]
    .map(m => Number(m[0]))
    .filter(n => Number.isFinite(n))
  return nums.length ? Math.max(...nums) : 0
}

function currentGroupAccounts() {
  return GROUPS.find(g => g.id === activeGroup.value)?.accounts || []
}

function normalizeAccountKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s·丶_\-—]+/g, '')
}

function inferGroupFromAccount(account) {
  const key = normalizeAccountKey(account)
  if (!key) return ''
  const match = GROUPS.find(group => (group.accounts || []).some(item => normalizeAccountKey(item) === key))
  return match?.label || ''
}

function preserveSpecialProfitProject(text) {
  return /平台收益|代做|素材代做/.test(String(text || ''))
}

function extractProjectFromProfitText(text) {
  const raw = String(text || '')
  const match = raw.match(/(?:合作产品|投放产品|推广产品|产品|项目|游戏)\s*[：:]\s*([^\n\r]+)/)
  return match ? match[1].trim() : ''
}

function extractPlatformFromProfitText(text) {
  const raw = String(text || '')
  const match = raw.match(/(?:合作平台|平台)\s*[：:]\s*([^\n\r]+)/)
  return match ? normalizeProfitPlatform({ platform: match[1].trim() }) : ''
}

function extractScheduleFromProfitText(text) {
  const raw = String(text || '')
  const match = raw.match(/(?:推广档期|档期)\s*[：:]\s*([^\n\r]+)/)
  return match ? normalizeProfitSchedule(match[1]) : ''
}

function extractFeeSection(text) {
  const raw = String(text || '')
  const match = raw.match(/(?:^|\n)\s*(?:二[、.．]|2[、.．])?\s*费用\s*[：:]?\s*\n?([\s\S]*?)(?=\n\s*(?:三[、.．]|3[、.．])?\s*(?:备注|补充|其他)|$)/)
  return match ? match[1].trim() : raw
}

function parseFeeSectionProfitText(text) {
  const project = extractProjectFromProfitText(text) || '未命名项目'
  const platform = extractPlatformFromProfitText(text) || '抖音'
  const schedule = extractScheduleFromProfitText(text) || defaultProfitSchedule()
  const accounts = currentGroupAccounts()
  const feeSection = extractFeeSection(text)
  const records = []

  for (const account of accounts) {
    if (!account || account === '素材') continue
    const escaped = account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(escaped + '[^\\n\\r\\d¥￥]{0,20}[¥￥]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:元|块|rmb|RMB)?', 'i')
    const match = feeSection.match(re)
    if (!match) continue
    const fee = Number(String(match[1]).replace(/,/g, '')) || 0
    if (fee <= 0) continue
    records.push({
      account,
      project,
      platform,
      fee,
      margin: calcMargin(fee, platform),
      schedule,
      note: `${account}${fee}元`
    })
  }
  return records
}

function extractProfitCount(text) {
  const match = String(text || '').match(/(\d+)\s*(?:条|篇|个|支|单)/)
  return match ? match[1] : ''
}

function normalizeProfitPlatform(record, sourceText = '') {
  const raw = [record.platform, record.type, record.category, record.note, sourceText].filter(Boolean).join(' ')
  if (/抖音|douyin/i.test(raw)) return '抖音'
  if (/B站|b站|哔哩|bilibili/i.test(raw)) return 'B站'
  if (/快手/.test(raw)) return '快手'
  if (/星广|星图/.test(raw)) return '星广'
  if (/代做|素材代做|素材/.test(raw)) return '代做'
  if (/小红书/.test(raw)) return '小红书'
  if (/视频号/.test(raw)) return '视频号'
  return record.platform || '抖音'
}

function normalizeProfitAccount(account, sourceText = '', options = {}) {
  const text = String(sourceText || '')
  const raw = String(account || '').trim()
  if (options.preserveAccount && raw && !/^未知|未填写|无$/.test(raw)) return raw
  const accounts = currentGroupAccounts()
  const hit = accounts.find(a => text.includes(a))
  if (hit) return hit
  if (/平台收益/.test(text)) return '平台收益'
  if (/素材|代做/.test(text)) return accounts.includes('素材') ? '素材' : '素材'
  if (!raw || /^未知|未填写|无$/.test(raw)) return ''
  return raw
}

function normalizeProfitProject(project, sourceText = '', options = {}) {
  let raw = String(project || '').trim()
  const source = String(sourceText || '').trim()
  if (/(维护标准|总表|汇总|提报|模板|明细|清单|报表|台账|数据表)/.test(raw)) raw = ''
  if (!raw || raw.length > 24 || /元|合计|条/.test(raw)) raw = source
  const group = GROUPS.find(g => g.id === activeGroup.value)
  for (const acc of group?.accounts || []) raw = raw.replaceAll(acc, ' ')
  raw = raw
    .replace(/(?:¥|￥)?\s*\d+(?:\.\d+)?\s*(?:元|块|rmb|RMB|合计)?/gi, ' ')
    .replace(/\d+\s*(?:条|篇|个|支|单)/g, ' ')
  const shouldPreservePlatformProject = /平台收益/.test(source) || /平台收益/.test(raw)
  if (shouldPreservePlatformProject) raw = raw.replace(/合计|确认|报价|费用|流水/g, ' ')
  else raw = raw.replace(/素材代做|代做|素材|合计|确认|报价|费用|流水/g, ' ')
  raw = raw
    .replace(/[，,。；;：:\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  raw = dedupeProjectWords(raw)
  return raw || String(project || '').trim() || (options.allowBlankProject ? '' : '未命名项目')
}

function dedupeProjectWords(value) {
  const parts = String(value || '').split(/\s+/).filter(Boolean)
  const cleaned = []
  for (const part of parts) {
    if (cleaned.includes(part)) continue
    if (cleaned.some(prev => prev.includes(part))) continue
    cleaned.push(part)
  }
  return cleaned.join(' ').trim()
}

function normalizeProfitGroup(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const aliases = {
    '内用二组': '内容二组',
    '内容2组': '内容二组',
    '内容4组': '内容四组'
  }
  if (aliases[raw]) return aliases[raw]
  const exact = GROUPS.find(g => g.label === raw)
  if (exact) return exact.label
  const compact = raw.replace(/\s+/g, '')
  const fuzzy = GROUPS.find(g => compact.includes(g.label.replace(/\s+/g, '')))
  return fuzzy?.label || ''
}

function inferBusinessType(record = {}, sourceText = '') {
  const raw = [
    record.business_type,
    record.businessType,
    record.category,
    record.type,
    record.platform,
    record.project,
    record.note,
    sourceText
  ].filter(Boolean).join(' ')
  if (/星广联投.*非保底|非保底.*星广联投/.test(raw)) return '星广联投非保底'
  if (/星广联投|保底/.test(raw)) return '星广联投-保底'
  if (/内部代做|原组|代做组|分成/.test(raw)) return '内部代做'
  if (/素材/.test(raw)) return '素材'
  if (/内容电商|电商|带货/.test(raw)) return '内容电商'
  if (/生态/.test(raw)) return '生态'
  if (/流量激励|激励/.test(raw)) return '流量激励'
  if (/其他/.test(raw)) return '其他'
  return record.category || record.type || '一口价'
}

function normalizeProfitRecord(record, sourceText = '', options = {}) {
  const source = sourceText || record.raw || record.note || ''
  const enrichedSource = [source, record.category, record.project, record.platform].filter(Boolean).join(' ')
  const fee = Number(String(record.fee ?? record.revenue ?? record.amount ?? '').replace(/,/g, '')) || extractProfitAmount(source)
  const parsedMargin = Number(String(record.margin ?? record.profit ?? '').replace(/,/g, '')) || 0
  const platform = normalizeProfitPlatform(record, source)
  const orderAmount = Number(String(record.order_amount ?? record.orderAmount ?? '').replace(/,/g, '')) || 0
  const finalAmount = Number(String(record.final_amount ?? record.finalAmount ?? '').replace(/,/g, '')) || fee
  const projectedMargin = Number(String(record.projected_margin ?? record.projectedMargin ?? '').replace(/,/g, '')) || parsedMargin || calcMargin(fee, platform)
  const publishDate = record.publish_date || record.publishDate || ''
  const link = record.link || record.url || ''
  const businessType = inferBusinessType(record, source)
  const schedule = normalizeProfitSchedule(record.schedule || record.month)
  const account = normalizeProfitAccount(record.account, enrichedSource, { preserveAccount: options.preserveAccount })
  const project = normalizeProfitProject(record.project, enrichedSource, options)
  const count = record.count || extractProfitCount(source)
  const noteParts = []
  if (record.note) noteParts.push(String(record.note))
  if (source && !noteParts.includes(source)) noteParts.push(source)
  if (count && !noteParts.some(n => n.includes(count + '条'))) noteParts.push('数量：' + count + '条')
  if (/素材代做|代做/.test(source) && !noteParts.some(n => n.includes('素材代做'))) noteParts.push('类型：素材代做')
  return {
    ...record,
    account,
    project,
    platform,
    category: businessType,
    business_type: businessType,
    fee,
    margin: parsedMargin || calcMargin(fee, platform),
    schedule,
    note: noteParts.filter(Boolean).join('；'),
    entry_source: record.entry_source || record.entrySource || (options.entrySource || 'ai'),
    origin_group: normalizeProfitGroup(record.origin_group || record.originGroup || ''),
    producer_group: normalizeProfitGroup(record.producer_group || record.producerGroup || ''),
    origin_share: Number(record.origin_share ?? record.originShare ?? 30) || 30,
    producer_share: Number(record.producer_share ?? record.producerShare ?? 70) || 70,
    split_enabled: record.split_enabled || record.splitEnabled || businessType === '内部代做' ? 1 : 0,
    order_amount: orderAmount,
    final_amount: finalAmount,
    projected_margin: projectedMargin,
    publish_date: publishDate,
    is_published: record.is_published || record.isPublished || record.published || publishDate ? 1 : 0,
    product_line: record.product_line || record.productLine || '',
    link,
    order_no: record.order_no || record.orderNo || ''
  }
}

function prepareTotalImportRecords(records, sourceText = '') {
  return (records || [])
    .map((record, index) => {
      const source = record.raw || record.source || record.note || sourceText || ''
      const normalized = normalizeProfitRecord({
        ...record,
        schedule: record.schedule || record.month,
        month: record.month || record.schedule
      }, source, { preserveSpecialProject: true, preserveAccount: true, allowBlankProject: true })
      const explicitGroup = normalizeProfitGroup(record.grp || record.group || normalized.grp)
      const inferredGroup = explicitGroup || inferGroupFromAccount(normalized.account)
      return {
        ...normalized,
        grp: inferredGroup,
        __sourceIndex: index
      }
    })
    .filter(r => Number(r.fee) > 0)
    .filter(r => r.grp)
}

function splitProfitInput(text) {
  return String(text || '')
    .split(/\n+|；|;/)
    .map(t => t.trim())
    .filter(Boolean)
}

function localRuleParseProfitText(text) {
  const feeSectionRecords = parseFeeSectionProfitText(text)
  if (feeSectionRecords.length) return feeSectionRecords
  return splitProfitInput(text)
    .map(chunk => normalizeProfitRecord({ raw: chunk }, chunk))
    .filter(r => r.fee > 0 && currentGroupAccounts().includes(r.account))
}

function applyParsedProfitRecords(records, mode, sourceText = profitText.value) {
  const accounts = currentGroupAccounts()
  const sourceProject = extractProjectFromProfitText(sourceText)
  const sourceSchedule = extractScheduleFromProfitText(sourceText)
  const normalized = (records || [])
    .map(r => normalizeProfitRecord({
      ...r,
      project: sourceProject && (!r.project || r.project === '未命名项目') ? sourceProject : r.project,
      schedule: sourceSchedule || r.schedule || r.month
    }, r.raw || r.source || r.note || sourceText))
    .filter(r => Number(r.fee) > 0)
    .filter(r => accounts.includes(r.account))
  parsedRecords.value = normalized
  if (normalized.length) {
    showToast((mode === 'smart' ? '智能解析' : '规则解析') + '出 ' + normalized.length + ' 条记录，确认后写入', 'success')
    return true
  }
  return false
}

async function parseProfitTextRule() {
  if (!profitText.value.trim()) { showToast('请粘贴确认信息', 'error'); return }
  profitParsing.value = true
  profitParseMode.value = 'rule'
  parsedError.value = ''
  parsedRecords.value = []
  try {
    const localRecords = localRuleParseProfitText(profitText.value)
    const d = await parseProfitInput(profitText.value).catch(() => ({ records: [] }))
    const records = localRecords.length ? localRecords : (d.records || [])
    if (!applyParsedProfitRecords(records, 'rule')) {
      parsedError.value = d.error || '规则解析没有识别到金额/项目，请换智能解析试试'
      showToast('规则解析失败', 'error')
    }
  } catch (e) {
    parsedError.value = e.message
    showToast('请求失败', 'error')
  } finally {
    profitParsing.value = false
    profitParseMode.value = ''
  }
}

function parseAiProfitJson(text) {
  const clean = String(text || '').replace(/\`\`\`json|\`\`\`/g, '').trim()
  const candidates = [clean]
  const arrayMatch = clean.match(/\[[\s\S]*\]/)
  if (arrayMatch) candidates.push(arrayMatch[0])
  const objectMatch = clean.match(/\{[\s\S]*\}/)
  if (objectMatch) candidates.push(objectMatch[0])
  for (const item of candidates) {
    try {
      const parsed = JSON.parse(item)
      if (Array.isArray(parsed)) return parsed
      if (Array.isArray(parsed.records)) return parsed.records
    } catch {}
  }
  return []
}

async function parseProfitTextSmart() {
  if (!profitText.value.trim()) { showToast('请粘贴确认信息', 'error'); return }
  profitParsing.value = true
  profitParseMode.value = 'smart'
  parsedError.value = ''
  parsedRecords.value = []
  try {
    const group = GROUPS.find(g => g.id === activeGroup.value)
    const response = await callMiniMaxChat([
      {
        role: 'system',
        content: '你是毛利录入解析器。只返回 JSON，不要解释。只解析“费用/报价/达人金额”里的账号金额行，不要把推广需求、授权要求、备注条款、编号1/2/3/4/5/6/7解析成记录。只返回当前组 accounts 内的账号，其他组账号必须忽略。每条包含 account, project, platform, fee, schedule, note, count。platform 可用 抖音/B站/快手/星广/代做/小红书/视频号。素材代做类 account 用 素材，platform 用 代做。没有月份就用当前筛选月份。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          group: group?.label || '',
          accounts: group?.accounts || [],
          defaultSchedule: defaultProfitSchedule(),
          input: profitText.value
        })
      }
    ])
    const aiRecords = parseAiProfitJson(response)
    const fallbackRecords = localRuleParseProfitText(profitText.value)
    if (!applyParsedProfitRecords(aiRecords.length ? aiRecords : fallbackRecords, 'smart')) {
      parsedError.value = '智能解析没有识别到可写入记录，请补充金额或项目'
      showToast('智能解析失败', 'error')
    }
  } catch (e) {
    const fallbackRecords = localRuleParseProfitText(profitText.value)
    if (!applyParsedProfitRecords(fallbackRecords, 'rule')) {
      parsedError.value = e.message
      showToast('智能解析失败', 'error')
    }
  } finally {
    profitParsing.value = false
    profitParseMode.value = ''
  }
}

const parseProfitText = parseProfitTextSmart

function onProfitDrop(e) {
  profitDragOver.value = false
  const file = e.dataTransfer.files[0]
  if (file) handleProfitFile(file)
}

function onProfitFileChange(e) {
  const file = e.target.files[0]
  if (file) handleProfitFile(file)
  e.target.value = ''
}

async function handleProfitFile(file) {
  profitFileName.value = file.name
  profitParsing.value = true
  parsedError.value = ''
  parsedRecords.value = []
  try {
    const buf = await file.arrayBuffer()
    const b64 = arrayBufferToBase64(buf)
    const d = await parseProfitFile(file.name, b64, { year: selectedYear.value, month: selectedMonth.value })
    if (d.records && d.records.length) {
      parsedRecords.value = profitImportMode.value === 'total'
        ? prepareTotalImportRecords(d.records, file.name)
        : d.records.map(r => normalizeProfitRecord(r))
      if (!parsedRecords.value.length) {
        parsedError.value = profitImportMode.value === 'total' ? '总表没有识别到带组别的有效记录' : 'Excel解析失败'
        showToast('解析失败', 'error')
        return
      }
      showToast('解析出 ' + parsedRecords.value.length + ' 条记录，确认后写入', 'success')
    } else {
      parsedError.value = d.error || 'Excel解析失败'
      showToast('解析失败', 'error')
    }
  } catch (e) { parsedError.value = e.message; showToast('请求失败', 'error') }
  finally { profitParsing.value = false }
}

async function onDepartmentImportFileChange(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  await handleDepartmentIncrementalImport(file)
}

async function handleDepartmentIncrementalImport(file) {
  deptImport.fileName = file.name
  deptImport.parsing = true
  parsedError.value = ''
  try {
    const buf = await file.arrayBuffer()
    const b64 = arrayBufferToBase64(buf)
    const parsed = await parseProfitFile(file.name, b64, { year: selectedYear.value, month: selectedMonth.value })
    if (!parsed.records || !parsed.records.length) {
      showToast(parsed.error || 'Excel 没有识别到可导入记录', 'error')
      return
    }

    const records = prepareTotalImportRecords(parsed.records, file.name)
      .map(r => normalizeProfitRecord(r, r.raw || r.source || r.note || '', { preserveSpecialProject: true, preserveAccount: true, allowBlankProject: true }))
    if (!records.length) {
      showToast('总表没有识别到带组别的有效记录', 'error')
      return
    }

    const ok = await confirmAction({
      title: '全部门增量导入',
      message: `将从「${file.name}」增量导入 ${records.length} 条记录。\n只新增 Excel 中数据库没有的内容；数据库里已有但 Excel 没出现的记录会保留，不会删除。`,
      confirmText: '增量导入',
      type: 'primary'
    })
    if (!ok) return

    profitWriting.value = true
    const result = await syncProfitRecords(records, { mode: 'incremental' })
    showToast(
      `增量导入完成：新增 ${result.inserted || 0} 条，已存在跳过 ${result.skipped || 0} 条，保留库内 ${result.preserved || 0} 条`,
      'success'
    )
    const firstSchedule = records.map(item => normalizeProfitSchedule(item.schedule || item.month)).find(Boolean)
    const month = getScheduleMonthNumber(firstSchedule)
    if (month) selectedMonth.value = month
    await loadDepartmentData()
  } catch (e) {
    showToast('全部门增量导入失败：' + (e.message || '未知错误'), 'error')
  } finally {
    deptImport.parsing = false
    profitWriting.value = false
  }
}

async function writeParsedRecords() {
  if (!parsedRecords.value.length) return
  profitWriting.value = true
  try {
    let firstSchedule = ''
    if (profitImportMode.value === 'total') {
      const records = parsedRecords.value.map(r => normalizeProfitRecord(r, r.raw || r.source || r.note || '', { preserveSpecialProject: true, preserveAccount: true, allowBlankProject: true }))
      for (const item of records) {
        if (!firstSchedule) firstSchedule = normalizeProfitSchedule(item.schedule || item.month)
      }
      const ok = await confirmAction({
        title: '同步总表',
        message: `将按组别和月份同步 ${records.length} 条记录。\n平台收益、代做、素材代做内容会保留。`,
        confirmText: '同步',
        type: 'danger'
      })
      if (!ok) { profitWriting.value = false; return }
      const result = await syncProfitRecords(records, { mode: 'sync' })
      const month = getScheduleMonthNumber(firstSchedule)
      if (month) selectedMonth.value = month
      showToast(
        '总表已同步 ' + (result.total || records.length) + ' 条，保留平台收益/代做内容',
        'success'
      )
    } else {
      const grpLabel = GROUPS.find(g => g.id === activeGroup.value)?.label || '内容组1'
      for (const raw of parsedRecords.value) {
        const r = normalizeProfitRecord(raw)
        const fee = Number(r.fee) || 0
        const platform = r.platform || '抖音'
        const schedule = normalizeProfitSchedule(r.schedule)
        const margin = Number(r.margin ?? r.profit ?? '') || calcMargin(fee, platform)
        if (!firstSchedule) firstSchedule = schedule
        await addProfit({
          grp: grpLabel,
          project: r.project || '',
          platform,
          account: r.account || '',
          revenue: fee,
          margin,
          month: schedule,
          remark: r.note || '',
          category: r.business_type || r.category || '一口价',
          business_type: r.business_type || r.category || '一口价',
          entry_source: r.entry_source || (profitFileName.value ? 'excel' : 'ai'),
          origin_group: r.origin_group || '',
          producer_group: r.producer_group || '',
          origin_share: Number(r.origin_share) || 30,
          producer_share: Number(r.producer_share) || 70,
          split_enabled: r.split_enabled ? 1 : 0,
          order_amount: Number(r.order_amount) || 0,
          final_amount: Number(r.final_amount) || fee,
          projected_margin: Number(r.projected_margin) || margin,
          publish_date: r.publish_date || '',
          is_published: r.is_published ? 1 : 0,
          product_line: r.product_line || '',
          link: r.link || '',
          order_no: r.order_no || ''
        })
      }
      const month = getScheduleMonthNumber(firstSchedule)
      if (month) selectedMonth.value = month
      showToast('已添加 ' + parsedRecords.value.length + ' 条记录，已切到 ' + (firstSchedule || defaultProfitSchedule()) + ' 查看', 'success')
    }
    parsedRecords.value = []
    profitText.value = ''
    profitFileName.value = ''
    await loadProfitData()
  } catch(e) {
    showToast('写入失败: ' + e.message, 'error')
  }
  profitWriting.value = false
}

async function syncCurrentProfitsToFeishu() {
  if (feishuSyncing.value) return
  const ok = await confirmAction({
    title: '同步流水到飞书',
    message: '将把本地流水数据库全量同步到飞书表格。已同步过的记录会更新，不会按按钮重复新增。',
    confirmText: '开始同步',
    type: 'info'
  })
  if (!ok) return
  feishuSyncing.value = true
  try {
    const result = await syncProfitsToFeishu({ force: true })
    if (result.error || result.code) {
      throw new Error(result.error || result.msg || '飞书同步失败')
    }
    const written = Number(result.created || 0) + Number(result.updated || 0)
    showToast(`飞书同步完成：${written} 条，失败 ${Number(result.failed || 0)} 条`, result.failed ? 'warning' : 'success')
    if (isDepartmentView.value) await loadDepartmentData()
    else await loadProfitData()
  } catch (e) {
    showToast('飞书同步失败: ' + e.message, 'error')
  }
  feishuSyncing.value = false
}

const handledAgentActionIds = new Set()

function replyAgentAction(id, ok, message) {
  window.dispatchEvent(new CustomEvent('usagi:agent-result', {
    detail: { id, ok, message }
  }))
}

function money(value) {
  return '￥' + Math.round(Number(value) || 0).toLocaleString()
}

function summarizeOpsPerformance(group) {
  const summary = profitSummary.value
  const monthLabel = selectedYear.value + '年' + (selectedMonth.value ? selectedMonth.value + '月' : '全部月份')
  const gap = Math.max(0, summary.target - summary.margin)
  const topAccounts = accountBreakdown.value.slice(0, 3)
    .map(item => item.account + ' ' + money(item.amount))
    .join('、') || '暂无账号流水'
  const status = summary.count
    ? (summary.rate >= 100 ? '已经达标' : '还没达标')
    : '当前没有流水记录'
  return [
    '我查了流水看板：' + group.label + ' ' + monthLabel + '业绩' + status + '。',
    '总流水 ' + money(summary.total) + '，毛利 ' + money(summary.margin) + '，目标 ' + money(summary.target) + '，完成率 ' + summary.rate + '%，还差 ' + money(gap) + '。',
    '记录数 ' + summary.count + ' 条；重点账号：' + topAccounts + '。',
    summary.count ? '建议继续看毛利降序明细，优先处理高流水低毛利或临近交付的项目。' : '建议先确认这个月是否还没录入流水，或者档期字段是不是没有写成“' + monthLabel + '”。'
  ].join('\n')
}

function consumePendingAgentAction() {
  try {
    const raw = localStorage.getItem('usagi_pending_ops_action')
    if (!raw) return
    localStorage.removeItem('usagi_pending_ops_action')
    handleAgentAction({ detail: JSON.parse(raw) })
  } catch (e) {}
}

async function handleAgentAction(event) {
  const action = event.detail || {}
  if (action.module !== 'ops') return
  if (action.id && handledAgentActionIds.has(action.id)) return
  if (action.id) handledAgentActionIds.add(action.id)
  const groupId = Number(action.payload?.groupId || 0)
  const group = GROUPS.find(g => g.id === groupId)
  if (!group) {
    replyAgentAction(action.id, false, '没找到这个内容组。')
    return
  }
  try {
    if (action.type === 'ops:monthly-performance') {
      selectedYear.value = Number(action.payload?.year || selectedYear.value)
      selectedMonth.value = Number(action.payload?.month || selectedMonth.value)
      await switchGroup(groupId)
      replyAgentAction(action.id, true, summarizeOpsPerformance(group))
      return
    }
    if (action.type === 'ops:switch-group') {
      await switchGroup(groupId)
      replyAgentAction(action.id, true, '已切到' + group.label + '，并刷新了当前数据。')
    }
  } catch (e) {
    replyAgentAction(action.id, false, '切换失败：' + (e.message || e))
  }
}

onMounted(() => {
  const defaultGroup = resolveCurrentUserGroup()
  if (defaultGroup) {
    activeGroup.value = defaultGroup.id
    isDepartmentView.value = false
  } else {
    isDepartmentView.value = true
  }
  syncTargetDraft()
  if (isDepartmentView.value) loadDepartmentData()
  else loadProfitData()
  window.addEventListener('usagi:agent-action', handleAgentAction)
  consumePendingAgentAction()
})

onUnmounted(() => {
  window.removeEventListener('usagi:agent-action', handleAgentAction)
})

// ---- 新增/修改/删除/清空 ----
function currentGroupOption() {
  return GROUPS.find(g => g.id === activeGroup.value)?.label || GROUPS[0]?.label || '内容组1'
}

function makeProfitDraft(overrides = {}) {
  const groupLabel = overrides.组别 || currentGroupOption()
  const platform = overrides.平台 || '抖音一口价'
  const fee = Number(overrides.费用) || 0
  return {
    id: '',
    组别: groupLabel,
    账号: '',
    项目: '',
    类型: '一口价',
    平台: platform,
    档期: defaultProfitSchedule(),
    费用: fee,
    毛利: Number(overrides.毛利) || calcMargin(fee, platform),
    下单金额: Number(overrides.下单金额) || 0,
    最终合作价: Number(overrides.最终合作价) || fee,
    预估毛利: Number(overrides.预估毛利) || Number(overrides.毛利) || calcMargin(fee, platform),
    是否发布: false,
    发布日期: '',
    链接: '',
    产品线: '',
    备注: '',
    来源: 'manual',
    原组: groupLabel,
    代做组: '',
    原组比例: 30,
    代做比例: 70,
    内部分成: false,
    ...overrides
  }
}

const editModal = reactive({ show: false, mode: 'edit', data: makeProfitDraft(), index: -1 })

function syncManualFinancials() {
  if (!editModal.show) return
  const fee = Number(editModal.data.费用) || 0
  editModal.data.最终合作价 = fee
  if (!Number(editModal.data.毛利)) {
    editModal.data.毛利 = calcMargin(fee, editModal.data.平台 || '抖音一口价')
  }
  editModal.data.预估毛利 = Number(editModal.data.毛利) || calcMargin(fee, editModal.data.平台 || '抖音一口价')
}

function syncInternalSplitDefaults() {
  if (!editModal.data.内部分成) return
  editModal.data.类型 = '内部代做'
  editModal.data.原组 = editModal.data.原组 || editModal.data.组别 || currentGroupOption()
  editModal.data.原组比例 = Number(editModal.data.原组比例) || 30
  editModal.data.代做比例 = Number(editModal.data.代做比例) || 70
}

function openCreateModal() {
  editModal.mode = 'create'
  editModal.index = -1
  editModal.data = makeProfitDraft()
  editModal.show = true
}

function openEditModal(item) {
  const idx = currentItems.value.findIndex(i => i.id === item.id)
  editModal.mode = 'edit'
  editModal.data = makeProfitDraft({
    ...item,
    组别: item.组别 || currentGroupOption(),
    类型: item.类型 || '一口价',
    来源: item.来源 || 'manual',
    原组: item.原组 || item.组别 || currentGroupOption(),
    代做组: item.代做组 || '',
    原组比例: Number(item.原组比例) || 30,
    代做比例: Number(item.代做比例) || 70,
    内部分成: !!item.内部分成,
    下单金额: Number(item.下单金额) || 0,
    最终合作价: Number(item.最终合作价) || Number(item.费用) || 0,
    预估毛利: Number(item.预估毛利) || Number(item.毛利) || 0,
    是否发布: !!item.是否发布,
    发布日期: item.发布日期 || '',
    链接: item.链接 || '',
    产品线: item.产品线 || ''
  })
  editModal.index = idx
  editModal.show = true
}

function buildProfitPayloadFromModal() {
  const fee = Number(editModal.data.费用) || 0
  const platform = editModal.data.平台 || '抖音一口价'
  const businessType = editModal.data.类型 || '一口价'
  const margin = Number(editModal.data.毛利) || calcMargin(fee, platform)
  const splitEnabled = !!editModal.data.内部分成
  const originShare = Math.max(0, Math.min(100, Number(editModal.data.原组比例) || 30))
  const producerShare = Math.max(0, Math.min(100, Number(editModal.data.代做比例) || (100 - originShare)))
  return {
    grp: editModal.data.组别 || currentGroupOption(),
    project: editModal.data.项目 || '',
    platform,
    account: editModal.data.账号 || '',
    revenue: fee,
    margin,
    month: normalizeProfitSchedule(editModal.data.档期),
    remark: editModal.data.备注 || '',
    category: businessType,
    business_type: businessType,
    entry_source: editModal.data.来源 || 'manual',
    origin_group: splitEnabled ? (editModal.data.原组 || editModal.data.组别 || currentGroupOption()) : '',
    producer_group: splitEnabled ? (editModal.data.代做组 || '') : '',
    origin_share: originShare,
    producer_share: producerShare,
    split_enabled: splitEnabled ? 1 : 0,
    order_amount: Number(editModal.data.下单金额) || 0,
    final_amount: Number(editModal.data.最终合作价) || fee,
    projected_margin: Number(editModal.data.预估毛利) || margin,
    publish_date: editModal.data.是否发布 ? (editModal.data.发布日期 || '') : '',
    is_published: editModal.data.是否发布 ? 1 : 0,
    link: editModal.data.是否发布 ? (editModal.data.链接 || '') : '',
    product_line: editModal.data.产品线 || ''
  }
}

async function doEditRecord() {
  const payload = buildProfitPayloadFromModal()
  if (!payload.account && !payload.project) {
    showToast('请至少填写账号或项目', 'error')
    return
  }
  if (payload.is_published && (!payload.publish_date || !payload.link)) {
    showToast('已发布记录需要填写发布日期和发布链接', 'error')
    return
  }
  try {
    if (editModal.mode === 'create') {
      await addProfit(payload)
    } else {
      await updateProfit(editModal.data.id, payload)
    }
    editModal.show = false
    showToast(editModal.mode === 'create' ? '新增成功' : '修改成功', 'success')
    if (isDepartmentView.value) await loadDepartmentData()
    else await loadProfitData()
  } catch(e) {
    showToast('保存失败: ' + e.message, 'error')
  }
}
async function deleteItem(id) {
  const item = currentItems.value.find(row => row.id === id)
  const ok = await confirmAction({
    title: '删除流水记录',
    message: `确定删除「${item?.项目 || '这条记录'}」？\n删除后会从本地数据库移除。`,
    confirmText: '删除',
    type: 'danger'
  })
  if (!ok) return
  try {
    await deleteProfit(id)
    showToast('已删除', 'success')
    await loadProfitData()
  } catch(e) {
    showToast('删除失败: ' + e.message, 'error')
  }
}
async function clearAll() {
  const ok = await confirmAction({
    title: '清空当前组流水',
    message: `确定清空「${currentGroupLabel.value}」全部 ${currentItems.value.length} 条记录？\n此操作会逐条删除本地数据库记录，不可恢复。`,
    confirmText: '清空全部',
    type: 'danger'
  })
  if (!ok) return
  try {
    const items = groupData[activeGroup.value]
    for (const item of items) {
      if (item.id) await deleteProfit(item.id)
    }
    showToast('已清空', 'success')
    await loadProfitData()
  } catch(e) {
    showToast('清空失败: ' + e.message, 'error')
  }
}

// ---- AI Chat ----
const aiChat = reactive({
  show: false,
  input: '',
  sending: false,
  history: []
})

function openAiChat() {
  aiChat.show = true
  aiChat.history = []
  aiChat.input = ''
  // Auto send initial query
  const monthStr = selectedYear.value + '年' + (selectedMonth.value ? selectedMonth.value + '月' : '全部月份')
  const items = filteredItems.value
  const total = items.reduce((s, i) => s + (Number(i.费用) || 0), 0)
  const margin = items.reduce((s, i) => s + (Number(i.毛利) || 0), 0)
  const platformStats = {}
  items.forEach(item => {
    const p = item.平台 || '未知'
    platformStats[p] = (platformStats[p] || 0) + (Number(item.费用) || 0)
  })
  const dataSummary = `${currentGroupLabel.value} ${monthStr}数据：共${items.length}条记录，总流水￥${total.toLocaleString()}，总毛利￥${margin.toLocaleString()}。平台分布：${JSON.stringify(platformStats)}`
  aiChat.history.push({ role: 'system', content: `你是乌萨奇，陈的AI数据分析助手。用户会问你关于数据的问题。请基于提供的数据回答。\n\n${dataSummary}` })
  aiChat.history.push({ role: 'assistant', content: `你好！我是AI数据分析助手。我已经加载了${currentGroupLabel.value}的${monthStr}数据（${items.length}条记录）。你可以问我关于这些数据的问题，比如：\n- 这个月的总毛利是多少？\n- 哪个平台的流水最高？\n- 和上月对比有什么变化？` })
}

async function sendAiChat() {
  if (!aiChat.input.trim() || aiChat.sending) return
  const question = aiChat.input.trim()
  aiChat.input = ''
  aiChat.history.push({ role: 'user', content: question })
  aiChat.sending = true
  try {
    const response = await callMiniMaxChat(aiChat.history)
    aiChat.history.push({ role: 'assistant', content: response })
  } catch(e) {
    aiChat.history.push({ role: 'assistant', content: '抱歉，分析时出错了：' + e.message })
  }
  aiChat.sending = false
}
</script>

<style scoped>
.ops-module { display: flex; flex-direction: column; }
.ops-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
.department-board { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.department-hero {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(34,197,94,0.08), rgba(6,182,212,0.06) 45%, rgba(245,158,11,0.06));
}
.department-hero-main { display: flex; flex-direction: column; gap: 4px; }
.dept-eyebrow { font-size: 11px; font-weight: 700; color: #22c55e; }
.department-hero-main strong { font-size: 22px; line-height: 1.05; color: var(--text, #e0d8ff); }
.department-hero-main em { font-style: normal; font-size: 12px; color: var(--text-muted); }
.department-hero-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.department-hero-stats div,
.dept-panel {
  background: var(--surface, #1a1a2e);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
}
.department-hero-stats div { padding: 7px 8px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.department-hero-stats span, .dept-panel-title, .rank-main span, .dept-chip-row em, .dept-account-row span { font-size: 11px; color: var(--text-muted); }
.department-hero-stats strong { font-size: 16px; color: var(--text, #e0d8ff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-compare-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}
.history-compare-strip article {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  background: var(--surface, #1a1a2e);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.history-compare-strip span { font-size: 11px; color: var(--text-muted); }
.history-compare-strip strong { font-size: 16px; color: #67e8f9; }
.history-compare-strip em { font-size: 11px; font-style: normal; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dept-import-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid rgba(34,197,94,0.32);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(34,197,94,0.12), rgba(6,182,212,0.07)),
    var(--surface, #1a1a2e);
}
.dept-import-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.dept-import-copy strong {
  color: #22c55e;
  font-size: 13px;
}
.dept-import-copy span,
.dept-import-copy em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
}
.dept-import-drop {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 176px;
  padding: 8px 12px;
  border: 1px solid rgba(34,197,94,0.42);
  border-radius: 8px;
  color: #07140f;
  background: linear-gradient(135deg, #22c55e, #67e8f9);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  overflow: hidden;
}
.dept-import-drop.busy {
  opacity: 0.72;
  cursor: wait;
}
.dept-import-drop input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.department-grid { display: grid; grid-template-columns: 1.08fr 0.92fr; gap: 8px; }
.dept-panel { padding: 8px; min-width: 0; }
.dept-panel.wide { grid-column: 1 / -1; }
.dept-list-panel { min-height: 0; display: flex; flex-direction: column; }
.dept-panel-title { margin-bottom: 6px; font-size: 12px; font-weight: 700; color: var(--primary-light, #b47fff); }
.radar-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 118px; gap: 8px; align-items: center; }
.radar-svg { width: 100%; max-width: 230px; height: auto; display: block; margin: 0 auto; }
.radar-ring { fill: none; stroke-width: 1; stroke: rgba(148,163,184,0.15); }
.radar-ring-2 { stroke: rgba(148,163,184,0.22); }
.radar-ring-3 { stroke: rgba(148,163,184,0.3); }
.radar-axis { stroke: rgba(96,165,250,0.35); stroke-width: 1; }
.radar-area { fill: rgba(34,197,94,0.18); stroke: rgba(34,197,94,0.85); stroke-width: 2; }
.radar-dot { fill: #22c55e; stroke: #0f172a; stroke-width: 1.5; }
.radar-label { font-size: 10px; fill: var(--text-muted); dominant-baseline: middle; }
.radar-score-list { display: grid; gap: 4px; }
.radar-score {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  background: var(--bg-card, #12122a);
  border-radius: 7px;
  border: 1px solid var(--border, #2a2a4a);
}
.radar-score span { white-space: nowrap; }
.radar-score strong { color: #22c55e; }
.dept-ranking, .dept-chip-list, .dept-project-grid, .dept-account-grid { display: flex; flex-direction: column; gap: 6px; }
.dept-list-panel .dept-project-grid,
.dept-list-panel .dept-account-grid {
  max-height: 292px;
  overflow-y: auto;
  padding-right: 2px;
}
.dept-list-panel .dept-project-grid::-webkit-scrollbar,
.dept-list-panel .dept-account-grid::-webkit-scrollbar { width: 5px; }
.dept-list-panel .dept-project-grid::-webkit-scrollbar-thumb,
.dept-list-panel .dept-account-grid::-webkit-scrollbar-thumb {
  background: rgba(148,163,184,0.28);
  border-radius: 999px;
}
.dept-rank-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 10px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(42,42,74,0.4);
}
.dept-rank-row:last-child { border-bottom: none; }
.rank-main { display: flex; flex-direction: column; gap: 2px; }
.rank-main strong, .dept-account-row strong, .project-title { color: var(--text, #e0d8ff); font-size: 13px; }
.rank-money, .dept-account-row em, .dept-project-row strong { color: #22c55e; font-style: normal; font-weight: 700; }
.rank-bar { grid-column: 1 / -1; height: 5px; border-radius: 999px; background: var(--surface2, #1e1e3a); overflow: hidden; }
.rank-bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #22c55e, #06b6d4); }
.dept-chip-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto auto;
  gap: 6px 8px;
  align-items: center;
  padding: 6px 8px;
  background: var(--bg-card, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 7px;
}
.dept-chip-row strong { color: var(--text, #e0d8ff); font-size: 12px; }
.dept-chip-row em { font-style: normal; color: var(--primary-light, #b47fff); }
.dept-project-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px 84px;
  gap: 6px 8px;
  align-items: center;
  padding: 6px 8px;
  background: var(--bg-card, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 7px;
}
.dept-project-row span { font-size: 12px; color: var(--text-muted); }
.dept-project-row .rank-bar { display: none; }
.project-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dept-account-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px 84px;
  gap: 6px 8px;
  align-items: center;
  padding: 6px 8px;
  background: var(--bg-card, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 7px;
}
.dept-account-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.matrix-panel { padding-bottom: 9px; }
.matrix-summary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: -2px 0 6px;
}
.matrix-summary span {
  padding: 4px 8px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 999px;
  background: var(--bg-card, #12122a);
  color: var(--text-muted);
  font-size: 10px;
}
.platform-matrix {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.matrix-tile {
  padding: 8px;
  background: var(--bg-card, #12122a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 7px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.matrix-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}
.matrix-head strong {
  font-size: 12px;
  color: var(--text, #e0d8ff);
}
.matrix-head span,
.matrix-meta {
  font-size: 10px;
  color: var(--text-muted);
}
.matrix-money {
  font-size: 16px;
  font-weight: 800;
  line-height: 1.05;
  color: #22c55e;
}
.matrix-bar {
  height: 5px;
  border-radius: 999px;
  background: var(--surface2, #1e1e3a);
  overflow: hidden;
}
.matrix-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #06b6d4);
  border-radius: inherit;
}
.matrix-unmatched {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.matrix-unmatched span {
  padding: 4px 7px;
  border-radius: 7px;
  background: rgba(245,158,11,0.08);
  border: 1px solid rgba(245,158,11,0.18);
  color: #d97706;
  font-size: 10px;
}
.module-page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.module-page-header h2 { margin: 0; font-size: 20px; color: var(--primary, #7b2fff); font-weight: 700; }
.ai-chat-btn { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border, #2a2a4a); background: var(--surface2, #1e1e3a); color: var(--text, #e0d8ff); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; }
.ai-chat-btn:hover { background: var(--primary, #7b2fff); border-color: var(--primary, #7b2fff); }
.ai-chat-modal { width: 560px; max-height: 80vh; display: flex; flex-direction: column; }
.ai-chat-intro { font-size: 12px; color: var(--text-muted); padding: 8px 12px; background: var(--surface2, #1e1e3a); border-radius: 8px; margin-bottom: 12px; }
.ai-chat-history { flex: 1; overflow-y: auto; max-height: 300px; display: flex; flex-direction: column; gap: 10px; padding: 4px; }
.chat-msg { display: flex; flex-direction: column; }
.chat-msg.user { align-items: flex-end; }
.chat-msg.assistant { align-items: flex-start; }
.chat-bubble { padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; max-width: 85%; }
.chat-msg.user .chat-bubble { background: var(--primary, #7b2fff); color: #fff; }
.chat-msg.assistant .chat-bubble { background: var(--surface2, #1e1e3a); color: var(--text, #e0d8ff); }
.chat-msg.system { display: none; }
.ai-chat-input { display: flex; gap: 8px; margin-top: 12px; }
.ai-chat-input .inp { flex: 1; }
.group-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
.group-tab { padding: 6px 14px; border-radius: 7px; border: 1px solid var(--border, #2a2a4a); background: var(--surface, #1a1a2e); color: var(--text-dim, #9d98b0); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; }
.group-tab:hover { border-color: var(--primary, #7b2fff); color: var(--primary-light, #b47fff); }
.group-tab.active { background: var(--primary, #7b2fff); border-color: var(--primary, #7b2fff); color: #fff; }
.year-month-bar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 12px;
  padding: 0;
  flex-wrap: wrap;
}
.year-month-bar::before {
  content: '统计周期';
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-right: 0;
}
.ym-select {
  width: auto;
  min-width: 74px;
  max-width: 92px;
  padding: 4px 7px;
  font-size: 11px;
  border-radius: 7px;
}
.ym-info {
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 8px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 999px;
  background: var(--surface2, #1e1e3a);
}
.target-editor {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 5px 8px 5px 10px;
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 8px;
  background: var(--surface2, #1e1e3a);
}
.target-editor span {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary-light, #b47fff);
  white-space: nowrap;
}
.target-input {
  width: 128px;
  padding: 5px 8px;
  font-size: 12px;
  text-align: right;
}
@media (max-width: 760px) {
  .ym-select {
    flex: 0 0 auto;
  }
  .target-editor {
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
  }
  .target-input {
    flex: 0 1 160px;
  }
  .kpi-grid {
    grid-template-columns: 1fr;
  }
  .kpi-goal {
    grid-template-columns: 82px minmax(0, 1fr);
  }
  .ops-grid,
  .profit-input-area,
  .department-hero,
  .department-grid,
  .radar-wrap {
    grid-template-columns: 1fr;
  }
  .department-hero-stats { grid-template-columns: 1fr 1fr; }
  .dept-import-card { grid-template-columns: 1fr; }
  .dept-import-drop { width: 100%; }
  .dept-panel.wide { grid-column: auto; }
  .platform-matrix { grid-template-columns: 1fr 1fr; }
  .matrix-money { font-size: 16px; }
}
.diff-up { color: var(--success-text); font-weight: 700; }
.diff-down { color: #f87171; font-weight: 700; }
.kpi-grid {
  display: grid;
  grid-template-columns: 1.25fr repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.kpi-card {
  min-width: 0;
  background: var(--surface, #1a1a2e);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kpi-goal {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}
.kpi-ring {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  background: conic-gradient(var(--success-text, #22c55e) 0 var(--kpi-rate), var(--surface2, #1e1e3a) var(--kpi-rate) 100%);
  display: grid;
  place-items: center;
  position: relative;
}
.kpi-ring::after {
  content: '';
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  background: var(--surface, #1a1a2e);
}
.kpi-ring span {
  position: relative;
  z-index: 1;
  font-size: 20px;
  font-weight: 800;
  color: var(--text, #e0d8ff);
}
.kpi-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kpi-label {
  font-size: 11px;
  color: var(--text-muted);
}
.kpi-card strong {
  font-size: 22px;
  line-height: 1.1;
  color: var(--text, #e0d8ff);
}
.kpi-goal strong {
  color: var(--success-text, #22c55e);
}
.kpi-card em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}
.ops-card { background: var(--surface, #1a1a2e); border: 1px solid var(--border, #2a2a4a); border-radius: 12px; padding: 16px; }
.ops-card.wide { grid-column: 1 / -1; }
.card-title { font-size: 13px; font-weight: 700; color: var(--primary-light, #b47fff); margin-bottom: 12px; }
.card-sub { font-size: 10px; font-weight: 500; color: var(--text-muted); }
.calc-form { display: flex; flex-direction: column; gap: 12px; }
.form-row { display: flex; flex-direction: column; gap: 5px; }
.form-row label { font-size: 12px; font-weight: 600; color: var(--primary-light, #b47fff); }
.inp { width: 100%; background: var(--surface2, #1e1e3a); border: 1px solid var(--border, #2a2a4a); border-radius: 8px; padding: 8px 12px; color: var(--text, #e0d8ff); font-size: 13px; font-family: inherit; outline: none; box-sizing: border-box; transition: border-color 0.15s; }
.inp:focus { border-color: var(--primary, #7b2fff); }
select.inp { cursor: pointer; }
.calc-result { margin-top: 16px; background: var(--bg-card, #12122a); border-radius: 10px; padding: 14px; border: 1px solid var(--border, #2a2a4a); }
.result-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--text, #e0d8ff); padding: 3px 0; }
.result-row span:first-child { color: var(--text-muted); }
.result-divider { height: 1px; background: var(--border, #2a2a4a); margin: 8px 0; }
.result-highlight { font-size: 15px; font-weight: 700; color: var(--success-text); }
.rules-list { display: flex; flex-direction: column; gap: 10px; }
.rule-item { display: grid; grid-template-columns: 110px 50px 1fr; align-items: center; gap: 10px; padding: 10px 12px; background: var(--bg-card, #12122a); border-radius: 8px; border: 1px solid var(--border, #2a2a4a); }
.rule-type { font-size: 12px; font-weight: 600; color: var(--text, #e0d8ff); }
.rule-rate { font-size: 14px; font-weight: 700; color: var(--success-text); text-align: center; }
.rule-desc { font-size: 11px; color: var(--text-muted); }
.rule-note { margin-top: 10px; padding: 8px 10px; background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.2); border-radius: 8px; font-size: 11px; color: #eab308; display: flex; gap: 6px; }
.summary-stats { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.stat-item { background: var(--bg-card, #12122a); border: 1px solid var(--border, #2a2a4a); border-radius: 10px; padding: 12px 18px; display: flex; flex-direction: column; gap: 4px; min-width: 100px; }
.stat-label { font-size: 11px; color: var(--text-muted); }
.stat-value { font-size: 18px; font-weight: 700; color: var(--text, #e0d8ff); }
.stat-value.goal { color: #eab308; }
.stat-value.done { color: var(--success-text); }
.stat-value.accent { color: var(--success-text); }
.stat-value.pending { color: #eab308; }
.profit-bar-wrap { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.profit-bar { flex: 1; height: 8px; background: var(--surface2, #1e1e3a); border-radius: 4px; overflow: hidden; }
.profit-bar-fill { height: 100%; background: linear-gradient(90deg, var(--primary, #7b2fff), var(--success-text)); border-radius: 4px; transition: width 0.4s ease; }
.profit-bar-label { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.profit-table { display: flex; flex-direction: column; background: var(--panel-bg, #12122a); border-radius: 6px; min-width: 0; }
.pt-head { display: grid; grid-template-columns: 2fr 1fr 80px 60px 100px 100px 112px; gap: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; color: var(--primary-light, #b47fff); border-bottom: 1px solid var(--border, #2a2a4a); background: var(--surface2, #1e1e3a); }
.pt-row { display: grid; grid-template-columns: 2fr 1fr 80px 60px 100px 100px 112px; gap: 10px; padding: 10px 14px; font-size: 13px; color: var(--text, #e0d8ff); border-bottom: 1px solid rgba(42,42,74,0.4); align-items: center; }
.pt-row:last-child { border-bottom: none; }
.pt-row:hover { background: rgba(255,255,255,0.03); }
.pt-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pt-actions { display: flex; gap: 4px; align-items: center; justify-content: center; }
.btn-op { padding: 4px 8px; border-radius: 4px; font-size: 13px; cursor: pointer; font-family: inherit; border: none; transition: all 0.15s; }
.btn-edit { background: transparent; color: var(--text-muted); }
.btn-edit:hover { background: var(--accent-soft); color: var(--primary, #7b2fff); }
.btn-del { background: transparent; color: var(--text-muted); }
.btn-del:hover { background: rgba(239,68,68,0.2); color: #f87171; }
.btn-link { background: rgba(59,130,246,0.14); color: #60a5fa; border: 1px solid rgba(96,165,250,0.28); }
.btn-link:hover { background: rgba(59,130,246,0.24); color: #93c5fd; }
.pt-row .amount { color: var(--success-text); font-weight: 600; text-align: right; }
.pt-row .amount.accent { color: #fbbf24; font-weight: 700; }
.loading-text { font-size: 13px; color: var(--text-muted); padding: 16px 0; text-align: center; }
.refresh-btn { margin-top: 10px; }
.entry-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 12px;
  border: 1px dashed var(--border, #2a2a4a);
  border-radius: 10px;
  background: var(--bg-card, #12122a);
  color: var(--text, #e0d8ff);
  cursor: pointer;
  font-family: inherit;
}
.entry-toggle strong {
  font-size: 14px;
}
.entry-toggle span {
  color: var(--primary-light, #b47fff);
  font-size: 12px;
}
.import-mode-switch {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.import-mode-switch .btn {
  padding-inline: 12px;
}
.import-mode-switch .btn.active {
  background: var(--primary, #7b2fff);
  border-color: var(--primary, #7b2fff);
  color: #fff;
}
.profit-input-area { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.pi-col { display: flex; flex-direction: column; gap: 8px; }
.pi-label { font-size: 11px; font-weight: 600; color: var(--primary-light, #b47fff); }
.pi-textarea { resize: none; min-height: 100px; line-height: 1.6; }
.parse-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.parse-actions .btn { width: 100%; padding-left: 10px; padding-right: 10px; }
.drop-zone { position: relative; border: 2px dashed var(--border, #2a2a4a); border-radius: 10px; padding: 18px 14px; text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s; background: var(--surface2, #1e1e3a); }
.drop-zone:hover, .drop-zone.drag-over { border-color: var(--primary, #7b2fff); background: var(--accent-soft); }
.dz-icon { font-size: 22px; margin-bottom: 6px; }
.dz-text { font-size: 12px; font-weight: 600; color: var(--text, #e0d8ff); margin-bottom: 3px; }
.dz-hint { font-size: 10px; color: var(--text-muted); }
.dz-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
.dz-filename { font-size: 12px; color: var(--primary-light, #b47fff); }
.parsed-preview { background: var(--bg-card, #12122a); border: 1px solid var(--border, #2a2a4a); border-radius: 10px; overflow: hidden; margin-top: 8px; }
.pp-head { display: grid; grid-template-columns: 1fr 1.5fr 2fr 1fr 1fr 1fr 1fr 2fr; padding: 6px 10px; font-size: 11px; font-weight: 600; color: var(--primary-light, #b47fff); background: var(--surface2, #1e1e3a); border-bottom: 1px solid var(--border, #2a2a4a); }
.pp-row { display: grid; grid-template-columns: 1fr 1.5fr 2fr 1fr 1fr 1fr 1fr 2fr; padding: 6px 10px; font-size: 12px; color: var(--text, #e0d8ff); border-bottom: 1px solid rgba(42,42,74,0.4); }
.pp-row:last-of-type { border-bottom: none; }
.pp-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-row .fee { color: var(--success-text); font-weight: 600; }
.pp-row .fee.accent { color: #eab308; }
.pp-actions { display: flex; gap: 8px; padding: 8px 10px; background: var(--surface2, #1e1e3a); }
.parsed-error { margin-top: 8px; padding: 8px 10px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; font-size: 12px; color: #f87171; }
.btn { padding: 8px 18px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 500; transition: all 0.15s; }
.btn-primary { background: var(--primary, #7b2fff); color: #fff; border: none; }
.btn-primary:hover { background: var(--primary-dark, #4a1a8a); }
.btn-ghost { background: transparent; border: 1px solid var(--border, #2a2a4a); color: var(--text, #e0d8ff); }
.btn-ghost:hover { border-color: var(--primary, #7b2fff); color: var(--primary-light, #b47fff); }
.btn-sm { padding: 5px 14px; font-size: 11px; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.modal-box { background: var(--surface, #1a1a2e); border: 1px solid var(--border, #2a2a4a); border-radius: 16px; padding: 24px; width: 520px; max-width: 92vw; max-height: 88vh; overflow-y: auto; }
.modal-title { font-size: 16px; font-weight: 700; color: var(--primary-light, #b47fff); margin-bottom: 20px; }
.modal-form { display: flex; flex-direction: column; gap: 12px; }
.mf-row { display: flex; flex-direction: column; gap: 4px; }
.mf-row label { font-size: 12px; font-weight: 600; color: var(--primary-light, #b47fff); }
.mf-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text, #e0d8ff);
  font-size: 12px;
  font-weight: 600;
}
.mf-check input { width: 15px; height: 15px; accent-color: var(--primary, #7b2fff); }
.mf-split-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 10px;
  border: 1px solid rgba(123,47,255,0.22);
  border-radius: 8px;
  background: var(--bg-card, #12122a);
}
.mf-split-grid label { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mf-split-grid span { font-size: 11px; font-weight: 600; color: var(--primary-light, #b47fff); }
.modal-actions { display: flex; gap: 10px; margin-top: 20px; }

/* 环形图 */
.donut-wrap {
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
  justify-content: center;
}
.distribution-wrap {
  display: block;
}
.distribution-wrap .donut-center {
  display: none;
}
.distribution-list {
  width: 100%;
}
.donut-svg {
  width: 140px;
  height: 140px;
  transform: rotate(-90deg);
  flex-shrink: 0;
}
.donut-bg {
  fill: none;
  stroke: var(--surface2, #1e1e3a);
  stroke-width: 20;
}
.donut-seg {
  fill: none;
  stroke-linecap: butt;
  transition: stroke-dasharray 0.6s ease;
}
.donut-center {
  position: absolute;
  left: 70px;
  top: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}
.donut-pct {
  font-size: 24px;
  font-weight: 800;
  color: var(--primary-light, #b47fff);
  line-height: 1;
}
.donut-label {
  font-size: 10px;
  color: var(--text-muted);
}
.donut-legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}
.legend-item {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) 48px;
  align-items: center;
  gap: 8px 10px;
  font-size: 12px;
  padding: 8px 0;
}
.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.legend-type {
  flex: 1;
  color: var(--text, #e0d8ff);
}
.legend-pct {
  color: var(--primary-light, #b47fff);
  font-weight: 600;
  text-align: right;
}
.legend-bar {
  grid-column: 1 / -1;
  height: 8px;
  border-radius: 999px;
  background: var(--surface2, #1e1e3a);
  overflow: hidden;
}
.legend-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
}
.legend-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
  padding: 10px 0;
}

/* 进度条 */
.progress-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.progress-bar-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
}
.progress-bar {
  flex: 1;
  height: 12px;
  background: var(--surface2, #1e1e3a);
  border-radius: 6px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary, #7b2fff), var(--success-text));
  border-radius: 6px;
  transition: width 0.4s ease;
}
.progress-label {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.stat-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  background: var(--bg-card, #12122a);
  border-radius: 8px;
  border: 1px solid var(--border, #2a2a4a);
}
.stat-label {
  font-size: 10px;
  color: var(--text-muted);
}
.stat-val {
  font-size: 15px;
  font-weight: 700;
  color: var(--text, #e0d8ff);
}
.stat-val.goal { color: #eab308; }
.stat-val.accent { color: var(--success-text); }
.stat-val.done { color: var(--success-text); }

/* 紧凑一行统计 */
.summary-inline {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.inline-item em {
  font-style: normal;
  color: var(--text, #e0d8ff);
  font-weight: 600;
  margin-left: 4px;
}
.inline-item em.accent {
  color: var(--success-text);
}

/* 账号流水 */
.account-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
  padding-right: 2px;
}
.account-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px 10px;
  padding: 8px 12px;
  background: var(--bg-card, #12122a);
  border-radius: 8px;
  border: 1px solid var(--border, #2a2a4a);
}
.account-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #e0d8ff);
}
.account-amount {
  font-size: 14px;
  font-weight: 700;
  color: var(--success-text);
}
.account-bar {
  grid-column: 1 / -1;
  height: 6px;
  border-radius: 999px;
  background: var(--surface2, #1e1e3a);
  overflow: hidden;
}
.account-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--primary, #7b2fff), var(--success-text));
}
.account-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 20px 0;
}

/* 平台标签 */
.platform-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--primary-light, #b47fff);
  font-size: 12px;
  font-weight: 600;
}

/* 项目类型标签 */
.type-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.type-yijia { background: rgba(156, 39, 176, 0.2); color: #ce93d8; }
.type-liuliang { background: rgba(33, 150, 243, 0.2); color: #64b5f6; }
.type-duan { background: rgba(76, 175, 80, 0.2); color: #81c784; }
.type-xingguang { background: rgba(255, 152, 0, 0.2); color: #ffb74d; }
.type-neibu { background: rgba(139, 195, 74, 0.2); color: #aed581; }
.type-sucai { background: rgba(233, 30, 99, 0.2); color: #f48fb1; }
.type-default { background: rgba(158, 158, 158, 0.2); color: #bdbdbd; }

/* 表格操作 */
.table-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border, #2a2a4a);
}
</style>
