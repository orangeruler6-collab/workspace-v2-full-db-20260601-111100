<template>
  <section class="traffic-plan-v2">
    <header class="traffic-topbar">
      <div class="module-page-title">
        <span class="module-page-icon">◆</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">TRAFFIC PLAN</div>
          <h2>投流计划</h2>
          <p>项目监控和投流申请共用同一套数据，按账号执行、按期累计。</p>
        </div>
      </div>
    </header>

    <div class="traffic-tabs" role="tablist" aria-label="投流计划视图">
      <button type="button" :class="{ active: activeTab === 'monitor' }" @click="activeTab = 'monitor'">数据监控</button>
      <button type="button" :class="{ active: activeTab === 'apply' }" @click="activeTab = 'apply'">投流申请</button>
      <div class="traffic-tab-actions">
        <span class="traffic-current-group">{{ currentGroup }}</span>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="loading" @click="refresh">刷新</button>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="crmRefreshing" @click="refreshCrmData">
          {{ crmRefreshing ? '更新中...' : '更新后台数据' }}
        </button>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="crmLoginLoading" @click="openCrmLoginShot">
          {{ crmLoginLoading ? '取码中...' : 'CRM登录' }}
        </button>
        <small v-if="crmRefreshSummary" class="traffic-crm-refresh-meta" :title="crmRefreshTitle">{{ crmRefreshSummary }}</small>
        <button class="btn btn-primary btn-sm" type="button" @click="showCreate = true">新建项目</button>
      </div>
    </div>

    <div v-if="notice.message" class="traffic-notice" :class="notice.tone">{{ notice.message }}</div>

    <main v-if="activeTab === 'monitor'" class="traffic-monitor-layout">
      <aside class="traffic-project-rail">
        <div class="traffic-view-switch" role="group" aria-label="监控视角">
          <button type="button" :class="{ active: monitorViewMode === 'group' }" @click="setMonitorView('group')">
            按组
            <em>{{ currentGroup || '全部' }}</em>
          </button>
          <button type="button" :class="{ active: monitorViewMode === 'project' }" @click="setMonitorView('project')">
            按项目
            <em>看完整项目</em>
          </button>
        </div>
        <div class="traffic-rail-head">
          <strong>{{ monitorViewMode === 'group' ? '本组项目' : '全部项目' }}</strong>
          <span>{{ visibleProjects.length }} 个</span>
          <button class="traffic-archive-toggle" type="button" @click="showArchivedProjects = !showArchivedProjects">
            {{ showArchivedProjects ? '隐藏归档池' : '显示归档池' }}
          </button>
        </div>
        <input v-model.trim="projectKeyword" class="inp traffic-search" placeholder="搜索项目 / 账号" />
        <div class="traffic-project-list">
          <button
            v-for="project in visibleProjects"
            :key="project.projectId"
            type="button"
            class="traffic-project-item"
            :class="[{ active: selectedProjectId === project.projectId, archived: isArchivedProject(project) }, projectRiskState(project).key]"
            :style="projectAccentStyle(project)"
            @click="selectProject(project.projectId)">
            <span>
              <strong>
                <i></i>
                {{ project.projectName }}
              </strong>
              <em>{{ platformLabel(project.platform) }} · {{ displayScheduleDate(project.scheduleDate) }}</em>
              <small class="traffic-project-brief">
                <b>{{ projectAccountCountText(project) }}</b>
                <b>实时 CPM {{ formatCpm(packageCpm(project)) }}</b>
                <b v-if="isArchivedProject(project)">已归档</b>
              </small>
              <small class="traffic-project-state-dots" :title="`${project.executions.length} 个账号 · ${projectRiskState(project).label} · ${projectStatusText(project)}`">
                <i v-for="execution in project.executions.slice(0, 18)" :key="execution.executionId" :class="executionState(execution).key"></i>
              </small>
            </span>
            <b :title="`播放完成率 ${formatPercent(progress(project.currentMetrics.play, project.targetMetrics.play))}`">{{ formatPercent(progress(project.currentMetrics.play, project.targetMetrics.play)) }}</b>
            <em class="traffic-project-mini-track">
              <i class="planned" :style="{ width: progress(project.appliedMetrics.play, project.targetMetrics.play) + '%' }"></i>
              <i class="actual" :style="{ width: progress(project.currentMetrics.play, project.targetMetrics.play) + '%' }"></i>
            </em>
          </button>
          <div v-if="!visibleProjects.length" class="traffic-empty">暂无项目，先点击右上角新建项目。</div>
        </div>
        <section v-if="showArchivedProjects" class="traffic-archive-pool">
          <div class="traffic-archive-pool-head">
            <strong>归档池</strong>
            <span>{{ archivedProjects.length }} 个</span>
          </div>
          <div class="traffic-archive-list">
            <article v-for="project in archivedProjects" :key="project.projectId" class="traffic-archive-item" :style="projectAccentStyle(project)">
              <div>
                <strong>{{ project.projectName }}</strong>
                <span>{{ platformLabel(project.platform) }} · {{ projectAccountCountText(project) }}</span>
              </div>
              <button class="btn btn-ghost btn-sm" type="button" @click="restoreProject(project)">恢复</button>
            </article>
            <div v-if="!archivedProjects.length" class="traffic-empty compact">归档池为空。</div>
          </div>
        </section>
      </aside>

      <section class="traffic-monitor-main traffic-cockpit-main">
        <div class="traffic-command-deck">
          <div class="traffic-command-scope">
            <span>{{ monitorViewMode === 'group' ? '当前内容组' : '项目全局' }}</span>
            <strong>{{ monitorViewMode === 'group' ? currentGroup || '当前组' : '全部项目' }}</strong>
            <em>{{ overviewScheduleText }} · {{ monitorOverview.projectCount }} 项目 · {{ monitorOverview.accountCount }} 账号</em>
            <div class="traffic-heatline" :title="`${monitorOverview.riskProjectCount} 个风险项目，${monitorOverview.warnCount} 个账号需关注`">
              <i
                v-for="dot in overviewDots"
                :key="dot.key"
                :class="dot.tone"
                :style="{ background: dot.color }"></i>
            </div>
          </div>
          <div class="traffic-command-stack">
            <button v-if="firstFocusItem" class="traffic-command-button warn" type="button" @click="selectProjectExecution(firstFocusItem)">
              <span>重点监控</span>
              <strong>{{ focusExecutions.length }}</strong>
            </button>
            <button v-if="firstPendingExecution" class="traffic-command-button primary" type="button" @click="startApply(firstPendingExecution)">
              <span>待申请</span>
              <strong>{{ monitorOverview.pendingCount }}</strong>
            </button>
            <button class="traffic-command-button" type="button" :disabled="crmRefreshing" @click="refreshCrmData">
              <span>后台数据</span>
              <strong>{{ crmRefreshing ? '更新中' : '刷新' }}</strong>
              <em v-if="crmRefreshShort">{{ crmRefreshShort }}</em>
            </button>
          </div>
        </div>

        <template v-if="selectedProject">
          <div
            v-if="monitorViewMode === 'group'"
            class="traffic-group-monitor-panel">
            <div>
              <span>按组监控</span>
              <h3>{{ selectedProjectId ? selectedProject.projectName : currentGroup || '当前组' }}</h3>
              <em>{{ monitorOverview.projectCount }} 个项目 · {{ monitorOverview.accountCount }} 个账号</em>
            </div>
            <LayeredProgress
              label=""
              :target="monitorOverview.targetPlay"
              :planned="monitorOverview.appliedPlay"
              :actual="monitorOverview.actualPlay"
            />
            <div class="traffic-group-metrics">
              <span><em>待申请</em><b>{{ monitorOverview.pendingCount }}</b></span>
              <span><em>重点监控</em><b>{{ focusExecutions.length }}</b></span>
              <span><em>实时 CPM</em><b>{{ formatCpm(monitorOverview.actualCpm) }}</b></span>
              <span><em>维护成本</em><b>{{ formatMoney(monitorOverview.maintenanceCost) }}</b></span>
            </div>
          </div>

          <div v-else class="traffic-summary-panel traffic-project-cockpit traffic-project-strip" :style="projectAccentStyle(selectedProject)">
            <div class="traffic-strip-title">
              <span :class="projectRiskState(selectedProject).key">{{ platformLabel(selectedProject.platform) }} · {{ projectRiskState(selectedProject).label }}</span>
              <h3>{{ selectedProject.projectName }}</h3>
            </div>

            <div class="traffic-strip-facts" aria-label="项目信息">
              <b :title="projectScheduleText(selectedProject)"><em>档期</em>{{ projectScheduleSummary(selectedProject) }}</b>
              <b><em>账号</em>{{ selectedProject.executions.length }} 个</b>
              <b><em>金额</em>{{ formatMoney(projectBudget(selectedProject)) }}</b>
            </div>

            <div class="traffic-strip-rings" aria-label="项目核心指标">
              <span
                class="traffic-strip-ring play"
                :style="ringStyle(projectPlayGapPercent(selectedProject))"
                :title="`播放差额 ${formatWan(projectPlayGap(selectedProject))} · 目标 ${formatWan(selectedProject.targetMetrics.play)} · 实际 ${formatWan(selectedProject.currentMetrics.play)}`">
                <strong>{{ formatWan(projectPlayGap(selectedProject)) }}</strong>
                <em>播放差额</em>
              </span>
              <span
                class="traffic-strip-ring cpm"
                :style="ringStyle(projectCpmHealthPercent(selectedProject))"
                :title="`实时 CPM ${formatCpm(packageCpm(selectedProject))} · 目标 CPM ${formatNumber(projectTargetCpm(selectedProject))}`">
                <strong>{{ formatCpm(packageCpm(selectedProject)) }}</strong>
                <em>CPM</em>
              </span>
              <span
                class="traffic-strip-ring margin"
                :style="ringStyle(projectGrossMargin(selectedProject))"
                :title="`毛利率 ${formatPercent(projectGrossMargin(selectedProject))} · 维护成本 ${formatMoney(selectedProject.maintenanceCost)}`">
                <strong>{{ formatPercent(projectGrossMargin(selectedProject)) }}</strong>
                <em>毛利率</em>
              </span>
            </div>

            <div class="traffic-strip-phase" :style="ringStyle(projectPhaseOneProgress(selectedProject))">
              <span
                :title="`一期 ${formatWan(projectPhaseOneApplied(selectedProject))} / ${formatWan(selectedProject.targetMetrics.play)}`">
                <em>一期</em>
                <strong>{{ formatPercent(projectPhaseOneProgress(selectedProject)) }}</strong>
                <small>{{ formatWan(projectPhaseOneApplied(selectedProject)) }}</small>
              </span>
            </div>

            <div class="traffic-strip-play">
              <div class="traffic-strip-play-head">
                <strong>总播放</strong>
                <b>{{ formatPercent(progress(selectedProject.currentMetrics.play, selectedProject.targetMetrics.play)) }}</b>
                <small>{{ formatWan(selectedProject.currentMetrics.play) }} / {{ formatWan(selectedProject.targetMetrics.play) }}</small>
              </div>
              <LayeredProgress
                label=""
                :target="selectedProject.targetMetrics.play"
                :planned="selectedProject.appliedMetrics.play"
                :actual="selectedProject.currentMetrics.play"
                compact
              />
            </div>

            <div class="traffic-strip-actions">
              <button class="btn btn-ghost btn-sm traffic-strip-edit" type="button" @click="openEditProject(selectedProject)">修改项目信息</button>
              <button
                class="btn btn-ghost btn-sm"
                type="button"
                @click="archiveSelectedProject">
                {{ isArchivedProject(selectedProject) ? '取消归档' : '归档项目' }}
              </button>
            </div>
          </div>

          <div class="traffic-execution-panel">
            <div class="traffic-section-head">
              <div>
                <strong>{{ monitorViewMode === 'group' ? '组内账号执行' : '账号执行矩阵' }}</strong>
                <span class="traffic-visual-legend">
                  <i>申请</i>
                  <b>实际</b>
                  <em>风险</em>
                </span>
              </div>
              <div class="traffic-section-actions">
                <button class="btn btn-ghost btn-sm" type="button" @click="archiveSelectedProject">
                  {{ isArchivedProject(selectedProject) ? '取消归档' : '归档项目' }}
                </button>
                <button class="btn btn-danger btn-sm" type="button" @click="deleteSelectedProject">删除项目</button>
              </div>
            </div>
            <div class="traffic-execution-table">
              <div class="traffic-exec-header" aria-hidden="true">
                <span>账号</span>
                <span>核心指标</span>
                <span>互动数据</span>
                <span>操作</span>
              </div>
              <article
                v-for="execution in matrixExecutions"
                :key="execution.executionId"
                class="traffic-exec-row"
                :class="[executionState(execution).key, focusState(execution).level]"
                :style="projectAccentStyle(projectForExecution(execution) || selectedProject)">
                <div class="traffic-exec-main">
                  <div class="traffic-exec-gap-cell" :title="`播放差额 ${formatWan(executionPlayGap(execution))}${executionCrmTimeText(execution) ? ' · CRM ' + executionCrmTimeText(execution) : ''}`">
                    <span class="traffic-exec-gap-ring" :style="ringStyle(executionPlayGapPercent(execution))">
                      <b>{{ formatPercent(executionPlayGapPercent(execution)) }}</b>
                      <em>差额</em>
                    </span>
                    <small v-if="executionCrmMetaVisible(execution)" class="traffic-exec-gap-time" :class="{ closed: executionCrmFollowClosed(execution) }">
                      <template v-if="executionCrmFollowClosed(execution)">
                        <span>保量跟进</span>
                        <span>已关闭</span>
                      </template>
                      <template v-else>
                        <span>{{ executionCrmTimeParts(execution).date }}</span>
                        <span v-if="executionCrmTimeParts(execution).time">{{ executionCrmTimeParts(execution).time }}</span>
                      </template>
                    </small>
                  </div>
                  <strong>
                    <i></i>
                    <span>{{ execution.accountName }}</span>
                    <em class="traffic-exec-project-chip">{{ executionProjectName(execution) }}</em>
                  </strong>
                  <span :title="`${executionProjectName(execution)} · ${execution.accountGroup || '未分组'} · ${execution.scheduleDate || '未填档期'} · ${execution.videoUrl || '未填作品链接'}`">
                    {{ executionProjectName(execution) }} · {{ execution.accountGroup || '未分组' }} · {{ displayScheduleDate(execution.scheduleDate) }}
                  </span>
                  <small>
                    {{ executionApplicationCount(execution) ? `已申请 ${executionApplicationCount(execution)} 期` : '申请未提交' }}
                    · {{ executionApplicationCount(execution) ? (execution.videoUrl ? '作品链接已填' : '未填作品链接') : (execution.videoUrl ? '监控链接已填' : '未填作品链接') }}
                  </small>
                </div>
                <div class="traffic-exec-core-metrics">
                  <div class="traffic-exec-progress-stack">
                    <div class="traffic-exec-play-head">
                      <strong>播放</strong>
                      <b>
                        {{ formatPercent(progress(execution.currentMetrics.play, execution.targetMetrics.play)) }}
                        <small>{{ formatWan(execution.currentMetrics.play) }} / {{ formatWan(execution.targetMetrics.play) }}</small>
                      </b>
                    </div>
                    <LayeredProgress
                      class="traffic-exec-progress"
                      label=""
                      :target="execution.targetMetrics.play"
                      :planned="execution.appliedMetrics.play"
                      :actual="execution.currentMetrics.play"
                      compact
                    />
                  </div>
                  <MetricBar
                    class="traffic-exec-like-metric"
                    :metric="metricByKey(execution, 'like')"
                    compact
                    show-values
                  />
                </div>
                <div class="traffic-exec-metrics">
                  <div class="traffic-mini-metrics visual" aria-label="互动完成度">
                    <MetricBar
                      v-for="metric in secondaryMetricList(execution)"
                      :key="metric.key"
                      :metric="metric"
                      compact
                      show-values
                    />
                  </div>
                </div>
                <div class="traffic-exec-side">
                  <b :class="focusState(execution).level">{{ focusState(execution).label || executionState(execution).label }}</b>
                  <button class="btn btn-primary btn-sm" type="button" @click="startGapApply(execution)">补差额</button>
                  <button class="btn btn-primary btn-sm" type="button" @click="startApply(execution)">申请投流</button>
                  <button class="btn btn-ghost btn-sm" type="button" :disabled="crmRefreshing" @click="refreshCrmData">刷新数据</button>
                </div>
              </article>
            </div>
          </div>
        </template>
        <div v-else class="traffic-empty large">还没有选中项目。</div>
      </section>
    </main>

    <main v-else class="traffic-apply-layout">
      <aside class="traffic-apply-rail">
        <div class="traffic-rail-head">
          <div>
            <strong>维护基地</strong>
            <span>{{ currentGroup || '全部内容组' }}</span>
          </div>
          <div class="traffic-tree-tools">
            <button type="button" @click="expandApplyProjects">展开</button>
            <button type="button" @click="collapseApplyProjects">收起</button>
          </div>
        </div>
        <input v-model.trim="applyKeyword" class="inp traffic-search" placeholder="搜索项目 / 账号 / 期数" />
        <div class="traffic-apply-tree">
          <button class="traffic-unlinked-create" type="button" @click="startUnlinkedApply">
            <strong>新建未关联申请</strong>
            <span>没有监控项目时也可以直接导出</span>
          </button>
          <section v-for="project in applyTree" :key="project.projectId" class="traffic-tree-project" :style="projectAccentStyle(project)">
            <button class="traffic-tree-project-head" type="button" @click="toggleApplyProject(project.projectId)">
              <i>{{ isApplyProjectOpen(project) ? '⌄' : '›' }}</i>
              <span>
                <strong>{{ project.projectName }}</strong>
                <em>{{ project.executions.length }} 个账号 · 播放差额 {{ formatWan(applyProjectPending(project)) }}</em>
                <small class="traffic-tree-progress">
                  <b :style="{ width: progress(project.currentMetrics?.play, project.targetMetrics?.play) + '%' }"></b>
                </small>
              </span>
              <b :class="projectRiskState(project).key">{{ isApplyProjectOpen(project) ? '点击收起' : '点击展开' }}</b>
            </button>
            <div v-if="isApplyProjectOpen(project)" class="traffic-tree-accounts">
              <article
                v-for="execution in project.executions"
                :key="execution.executionId"
                class="traffic-tree-account"
                :class="{ active: selectedExecution?.executionId === execution.executionId }">
                <button class="traffic-tree-account-main" type="button" @click="startApply(execution)">
                  <span>
                    <strong>{{ execution.accountName }}</strong>
                    <em>下一期 {{ nextPhaseFor(execution) }} · 已申 {{ formatWan(executionAppliedPlay(execution)) }} · 差 {{ formatWan(pendingPlayFor(execution)) }}</em>
                    <small class="traffic-tree-progress">
                      <i :style="{ width: progress(execution.appliedMetrics?.play, execution.targetMetrics?.play) + '%' }"></i>
                      <b :style="{ width: progress(execution.currentMetrics?.play, execution.targetMetrics?.play) + '%' }"></b>
                    </small>
                  </span>
                  <span class="traffic-tree-account-actions">
                    <b :class="[executionState(execution).key, focusState(execution).level]">{{ focusState(execution).label || executionState(execution).label }}</b>
                  </span>
                </button>
              </article>
            </div>
          </section>
          <div v-if="!applyTree.length" class="traffic-empty compact">还没有关联项目，可先用上方未关联申请。</div>
        </div>
        <section class="traffic-settings-box traffic-preset-box">
          <button class="traffic-settings-toggle" type="button" @click="settingsOpen = !settingsOpen">
            <span>预设模板</span>
            <b>{{ settingsOpen ? '收起' : '展开' }}</b>
          </button>
          <div v-if="settingsOpen" class="traffic-settings-editor">
            <p>按当前目标播放量计算维护量，并同步到右侧本期投流维护。</p>
            <div class="traffic-preset-cpm-list">
              <button
                v-for="cpm in [30, 50, 70, 100]"
                :key="cpm"
                type="button"
                :class="{ active: isTargetCpmActive(cpm) }"
                @click="applyGenericPresetFromRail(cpm)">
                CPM {{ cpm }}
              </button>
            </div>
            <div class="traffic-preset-preview">
              <span v-for="item in genericPresetPreviewRows" :key="item.key">
                <em>{{ item.label }}</em>
                <b>{{ item.value }}</b>
              </span>
            </div>
            <button class="btn btn-primary btn-sm" type="button" @click="applyCurrentAccountStandard">同步到维护项</button>
          </div>
        </section>
      </aside>

      <section class="traffic-apply-main">
        <div class="traffic-apply-head" :class="{ empty: !canExportApplication }">
            <div>
              <strong>{{ form.projectName }}</strong>
              <span v-if="canExportApplication">{{ form.accountName }} · {{ platformLabel(form.platform) }} · {{ form.phaseName }}</span>
              <span v-else>先从左侧选择账号，或点击“新建未关联申请”后填写。</span>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" @click="activeTab = 'monitor'">回到监控</button>
          </div>

          <div v-if="canExportApplication" class="traffic-phase-strip">
            <button
              v-for="tab in phaseTabs"
              :key="tab.name"
              type="button"
              :class="{ active: tab.active, saved: tab.saved, next: tab.next }"
              @click="switchPhaseTab(tab.name)">
              <b>{{ tab.name }}</b>
              <em>{{ tab.saved ? '已保存' : tab.next ? '建议下一期' : '可填写' }}</em>
            </button>
            <button class="traffic-phase-add" type="button" @click="createNextPhase">
              <b>＋</b>
              <em>新增下一期</em>
            </button>
          </div>

          <div class="traffic-apply-progress" :class="{ empty: !selectedExecution }">
            <div v-if="!selectedExecution" class="traffic-apply-progress-empty">
              <strong>暂无关联进度</strong>
              <span>选择左侧项目账号后显示目标、申请和实际跑量；未关联申请只填写表单，不占用监控进度。</span>
            </div>
            <div v-else class="traffic-apply-progress-title">
              <strong>当前账号播放进度</strong>
              <span>{{ formatPercent(progress(applyProgressActual, applyProgressTarget)) }}</span>
            </div>
            <LayeredProgress
              v-if="selectedExecution"
              label=""
              :target="applyProgressTarget"
              :planned="applyProgressPlanned"
              :actual="applyProgressActual"
            />
            <div v-if="false && selectedExecution" class="traffic-apply-progress-meta">
              <span><b>{{ formatWan(applyProgressTarget) }}</b><em>总目标</em></span>
              <span><b>{{ formatWan(applyProgressPlanned) }}</b><em>已申请</em></span>
              <span><b>{{ formatWan(applyProgressActual) }}</b><em>真实跑到</em></span>
              <span><b>{{ formatWan(Math.max(0, applyProgressTarget - applyProgressActual)) }}</b><em>剩余差额</em></span>
            </div>
          </div>

          <div class="traffic-apply-workspace">
            <section class="traffic-form-panel">
              <div class="traffic-panel-title">
                <strong>基础信息</strong>
                <span>项目、账号和报价会优先从监控项目带入。</span>
              </div>
              <div class="traffic-form-grid">
            <div class="traffic-form-field traffic-account-picker-label">
              <span>账号名</span>
              <div class="traffic-account-picker">
                <input
                  v-model.trim="form.accountName"
                  class="inp"
                  placeholder="输入账号名，点击选择已建项目账号"
                  autocomplete="off"
                  @focus="openAccountPicker"
                  @click="openAccountPicker"
                  @input="handleAccountInput"
                  @blur="closeAccountPickerLater"
                />
                <div v-if="accountPickerOpen" class="traffic-account-suggestions">
                  <button
                    v-for="item in accountSuggestionRows"
                    :key="item.execution.executionId"
                    type="button"
                    :class="{ linked: form.executionId === item.execution.executionId }"
                    @click.prevent="selectAccountSuggestion(item.execution)"
                    @mousedown.prevent="selectAccountSuggestion(item.execution)">
                    <strong>{{ item.execution.accountName }}</strong>
                    <span>{{ item.projectName }} · {{ item.execution.accountGroup || '未分组' }} · {{ displayScheduleDate(item.execution.scheduleDate) }}</span>
                    <em>
                      折扣 {{ item.discountText }} · 折后 {{ formatMoney(item.execution.discountedPrice) }} · 目标 {{ formatWan(item.execution.targetMetrics?.play) }}
                    </em>
                  </button>
                  <div v-if="!accountSuggestionRows.length" class="traffic-account-suggestion-empty">
                    没有匹配账号；需要临时填写时，先点左侧“新建未关联申请”。
                  </div>
                </div>
              </div>
            </div>
            <div class="traffic-form-field traffic-platform-mode-field">
              <span>投流模式</span>
              <div class="traffic-platform-mode">
                <button type="button" :class="{ active: normalizePlatform(form.platform) === 'douyin' }" @click="switchApplyPlatform('douyin')">
                  抖音
                </button>
                <button type="button" :class="{ active: normalizePlatform(form.platform) === 'bilibili' }" @click="switchApplyPlatform('bilibili')">
                  B站
                </button>
              </div>
            </div>
            <div class="traffic-form-field traffic-platform-mode-field">
              <span>订单类型</span>
              <div class="traffic-platform-mode">
                <button type="button" :class="{ active: form.orderType === 'xingtu' }" @click="form.orderType = 'xingtu'">
                  星图单
                </button>
                <button type="button" :class="{ active: form.orderType === 'private' }" @click="form.orderType = 'private'">
                  私单
                </button>
              </div>
            </div>
            <label class="span-2">
              <span>视频链接</span>
              <input v-model.trim="form.videoUrl" class="inp" placeholder="粘贴视频链接或整段分享文案" @blur="normalizeFormUrl" />
            </label>
            <label>
              <span>期数</span>
              <div class="traffic-phase-control">
                <select v-model="form.phaseName" class="inp" @change="handlePhaseChange">
                  <option v-for="tab in phaseTabs" :key="tab.name" :value="tab.name">{{ tab.name }}</option>
                </select>
                <button type="button" @click="createNextPhase">新增下一期</button>
              </div>
              <div v-if="phaseHistoryRecords.length" class="traffic-phase-history">
                <span>历史</span>
                <button
                  v-for="record in phaseHistoryRecords"
                  :key="record.id || record.applicationId || record.phaseName"
                  type="button"
                  :class="{ active: normalize(record.phaseName) === normalize(form.phaseName) }"
                  @click="selectPhaseHistory(record)">
                  {{ record.phaseName || '未命名期数' }}
                </button>
              </div>
            </label>
            <label>
              <span>本期比例</span>
              <input v-model="form.phaseRatio" class="inp" inputmode="decimal" placeholder="自定义比例 %" @input="applyPhaseRatio" />
            </label>
            <label>
              <span>目标播放量</span>
              <input v-model="form.targetPlayWan" class="inp" inputmode="decimal" @input="handleTargetPlayInput" />
            </label>
            <label>
              <span>目标 CPM</span>
              <input v-model="form.targetCpm" class="inp" inputmode="decimal" placeholder="自定义 CPM" @input="handleTargetCpmInput" />
            </label>
            <label>
              <span>折前价格</span>
              <input v-model="form.originalPrice" class="inp" inputmode="decimal" @input="syncDiscountPrice" />
            </label>
            <label>
              <span>折扣率 %</span>
              <input v-model="form.discountRate" class="inp" inputmode="decimal" @input="syncDiscountPrice" />
            </label>
            <label>
              <span>折后价格</span>
              <input v-model="form.discountedPrice" class="inp" inputmode="decimal" @input="syncTargetPlay" />
            </label>
            <div class="traffic-standard-card span-2" :class="{ missing: !currentAccountStandard }">
              <div>
                <strong>{{ currentAccountStandard ? '已匹配账号维护预设' : '通用维护预设' }}</strong>
                <span v-if="currentAccountStandard">
                  CPM {{ formatNumber(currentAccountStandardPreview?.targetCpm) }} · 当前播放 {{ formatWan(currentAccountStandardPreview?.play) }} · 点赞 {{ formatCompact(currentAccountStandardPreview?.like) }}
                </span>
              <span v-else>按目标播放自动计算：点赞 1000 阶梯，评论/收藏/转发 50 阶梯。</span>
              </div>
              <div class="traffic-standard-actions">
                <label class="traffic-standard-toggle">
                  <input v-model="form.useAccountStandard" type="checkbox" @change="handleAccountStandardToggle" />
                  <span>使用账号预设</span>
                </label>
                <button type="button" class="ghost" @click="applyFirstBlackTechPreset">首期黑科技维护</button>
              </div>
            </div>
              </div>
            </section>

            <section class="traffic-maintenance-wrap">
            <div class="traffic-maintenance-head">
              <div>
                <strong>本期投流维护</strong>
                <span>填申请量，右侧实时生成最终审核文案。</span>
              </div>
              <div class="traffic-maintenance-actions">
                <em>{{ form.phaseName }} · {{ platformLabel(form.platform) }}</em>
                <button type="button" @click="clearMaintenanceQuantities">清空数量</button>
              </div>
            </div>
            <table class="traffic-maintenance-table">
              <thead>
                <tr>
                  <th>维护项</th>
                  <th>通道</th>
                  <th>申请数量</th>
                  <th>单价</th>
                  <th>成本</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="service in serviceRows" :key="service.key">
                  <td><strong>{{ service.label }}</strong></td>
                  <td>
                    <select v-model="form.selectedOptions[service.key]" class="inp">
                      <option v-for="option in optionsFor(service.key)" :key="option.id" :value="option.id">
                        {{ option.name }}
                      </option>
                    </select>
                  </td>
                  <td>
                    <input
                      v-model="form.quantityInputs[service.key]"
                      class="inp"
                      inputmode="decimal"
                      :placeholder="quantityHint(service.key)"
                      @blur="normalizeQuantityInput(service.key)"
                    />
                  </td>
                  <td>{{ formatUnitPrice(selectedOption(service.key)) }}</td>
                  <td><b>{{ formatMoney(lineCost(service.key)) }}</b></td>
                </tr>
              </tbody>
            </table>
            </section>
          </div>

          <aside class="traffic-result-panel">
            <div class="traffic-result-card">
              <span>累计维护成本</span>
              <strong>{{ formatMoney(cumulativeCost) }}</strong>
              <em>本期 {{ formatMoney(currentCost) }} · 已保存 {{ phaseHistoryRecords.length }} 期</em>
            </div>
            <div class="traffic-result-card" :class="grossTone">
              <span>毛利率</span>
              <strong>{{ formatPercent(grossMargin) }}</strong>
              <em>累计口径毛利额 {{ formatMoney(grossProfit) }}</em>
            </div>
            <div class="traffic-review-head">
              <span>最终审核文案</span>
              <em>跟随左侧数据实时生成，导出时使用当前最新文案</em>
            </div>
            <textarea v-model="reviewText" class="inp traffic-review" rows="13" readonly></textarea>
            <button class="btn btn-primary btn-sm" type="button" :disabled="saving || !canExportApplication" @click="exportCurrentPhase">
              {{ saving ? '保存中...' : canExportApplication ? '导出' + form.phaseName : '请选择来源后导出' }}
            </button>
            <section class="traffic-comment-entry" :class="{ open: commentPanelOpen }">
              <button class="traffic-comment-toggle" type="button" @click="commentPanelOpen = !commentPanelOpen">
                <span>
                  <strong>自定义评论下载</strong>
                  <em>复用文案工具台评论生成</em>
                </span>
                <b>{{ commentPanelOpen ? '收起' : '展开' }}</b>
              </button>
              <CommentGeneratorPanel
                v-if="commentPanelOpen"
                title="自定义评论"
                caption="自动带入本期申请链接和评论量"
                :context="commentContext"
                :auto-fill="true"
                compact
              />
            </section>
          </aside>
      </section>
    </main>

    <div v-if="showCreate" class="traffic-modal-mask" @click.self="showCreate = false">
      <section class="traffic-modal">
        <header>
          <strong>新建投流项目</strong>
          <button type="button" class="btn btn-ghost btn-sm" @click="showCreate = false">关闭</button>
        </header>
        <textarea v-model="createText" class="inp traffic-create-text" placeholder="粘贴锁档/报价文本"></textarea>
        <div class="traffic-create-actions">
          <label>
            <span>统一目标 CPM</span>
            <input v-model="createCpm" class="inp" inputmode="decimal" @input="syncParsedProjectCpm" />
          </label>
          <button class="btn btn-ghost btn-sm" type="button" @click="parseProject">解析</button>
          <button class="btn btn-primary btn-sm" type="button" :disabled="!parsedProject.accounts?.length" @click="createProject">创建项目</button>
        </div>
        <div v-if="parsedProject.accounts?.length" class="traffic-parse-preview">
          <strong>{{ parsedProject.projectName }} · {{ platformLabel(parsedProject.platform) }} · CPM {{ parsedProject.targetCpm }}</strong>
          <div v-for="account in parsedProject.accounts" :key="account.accountName">
            <span>{{ account.accountName }}</span>
            <em>{{ account.accountGroup }} · 折前 {{ formatMoney(account.originalPrice) }} · 折扣 {{ formatNumber(account.discountRate) }}% · 折后 {{ formatMoney(account.discountedPrice) }} · 目标 {{ formatWan(account.targetPlay) }}</em>
          </div>
        </div>
      </section>
    </div>

    <div v-if="showEditProject" class="traffic-modal-mask" @click.self="showEditProject = false">
      <section class="traffic-modal traffic-edit-project-modal">
        <header>
          <strong>修改项目信息</strong>
          <button type="button" class="btn btn-ghost btn-sm" @click="showEditProject = false">关闭</button>
        </header>
        <div class="traffic-form-grid">
          <label>
            <span>项目名</span>
            <input v-model.trim="editProjectForm.projectName" class="inp" />
          </label>
          <label>
            <span>平台</span>
            <select v-model="editProjectForm.platform" class="inp">
              <option value="douyin">抖音</option>
              <option value="bilibili">B站</option>
            </select>
          </label>
          <label>
            <span>档期</span>
            <input v-model.trim="editProjectForm.scheduleDate" class="inp" placeholder="例如 2026-05-27" />
          </label>
          <label>
            <span>目标 CPM</span>
            <input v-model="editProjectForm.targetCpm" class="inp" inputmode="decimal" @input="handleEditProjectCpmInput" />
          </label>
          <label>
            <span>目标播放量（万）</span>
            <input v-model="editProjectForm.targetPlayWan" class="inp" inputmode="decimal" @input="handleEditProjectPlayInput" />
          </label>
        </div>
        <p class="traffic-edit-project-hint">
          保存后会把项目目标播放同步分配到当前账号；只改 CPM 时，会按项目报价自动换算目标播放。
        </p>
        <div class="traffic-modal-actions">
          <button class="btn btn-ghost btn-sm" type="button" @click="showEditProject = false">取消</button>
          <button class="btn btn-primary btn-sm" type="button" @click="saveProjectInfo">保存项目信息</button>
        </div>
      </section>
    </div>

    <div v-if="crmLoginOpen" class="traffic-modal-mask" @click.self="crmLoginOpen = false">
      <section class="traffic-modal traffic-crm-login-modal">
        <header>
          <div>
            <strong>CRM 登录</strong>
            <span>扫码后保持这个登录态，后台刷新会复用同一个 CRM profile。</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" @click="crmLoginOpen = false">关闭</button>
        </header>
        <div class="traffic-crm-login-shot">
          <img v-if="crmLoginShot.imageDataUrl" :src="crmLoginShot.imageDataUrl" alt="CRM 登录截图" />
          <div v-else class="traffic-empty">{{ crmLoginLoading ? '正在获取 CRM 登录截图...' : '暂无截图' }}</div>
        </div>
        <div class="traffic-modal-actions">
          <span v-if="crmLoginShot.title || crmLoginShot.url">{{ crmLoginShot.title || crmLoginShot.url }}</span>
          <button class="btn btn-ghost btn-sm" type="button" :disabled="crmLoginLoading" @click="openCrmLoginShot">重新取码</button>
          <button class="btn btn-primary btn-sm" type="button" :disabled="crmRefreshing" @click="refreshCrmData">登录后刷新数据</button>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, defineComponent, h, nextTick, onMounted, reactive, ref, watch } from 'vue'
import {
  createTrafficPlanV2Project,
  deleteTrafficPlanV2Project,
  fetchTrafficPlanV2,
  fetchTrafficPlanV2CrmLoginScreenshot,
  fetchTrafficPlanV2CrmStatus,
  parseTrafficPlanV2Text,
  refreshTrafficPlanV2CrmCsv,
  saveTrafficPlanV2Application,
  saveTrafficPlanV2Settings,
  updateTrafficPlanV2Project
} from '../api/trafficPlan'
import CommentGeneratorPanel from './tools/CommentGeneratorPanel.vue'

const props = defineProps({
  moduleId: { type: String, default: 'trafficPlan' },
  currentUser: { type: Object, default: null },
  trafficContext: { type: Object, default: null }
})

const LayeredProgress = defineComponent({
  name: 'LayeredProgress',
  props: {
    label: { type: String, default: '' },
    target: { type: Number, default: 0 },
    planned: { type: Number, default: 0 },
    actual: { type: Number, default: 0 },
    compact: { type: Boolean, default: false }
  },
  setup(localProps) {
    const pct = (value) => {
      const target = Number(localProps.target) || 0
      if (!target) return 0
      return Math.max(0, Math.min(100, Math.round(Number(value || 0) / target * 100)))
    }
    return () => h('div', { class: ['layered-progress', localProps.compact ? 'compact' : ''] }, [
      !localProps.label ? null : h('div', { class: 'layered-progress-head' }, [
        h('strong', localProps.label),
        h('span', { title: `实际 ${formatCompact(localProps.actual)} / 申请 ${formatCompact(localProps.planned)} / 目标 ${formatCompact(localProps.target)}` }, formatPercent(pct(localProps.actual)))
      ]),
      h('div', { class: 'layered-track' }, [
        h('em', { class: 'target', style: { width: '100%' } }),
        h('i', { class: 'planned', style: { width: pct(localProps.planned) + '%' } }),
        h('b', { class: 'actual', style: { width: pct(localProps.actual) + '%' } })
      ]),
      !localProps.compact && localProps.label ? h('div', { class: 'layered-legend' }, [
        h('span', { class: 'target', title: `目标 ${formatCompact(localProps.target)}` }),
        h('span', { class: 'planned', title: `已申请 ${formatCompact(localProps.planned)}` }),
        h('span', { class: 'actual', title: `真实 ${formatCompact(localProps.actual)}` }),
        h('span', { class: 'gap', title: `差额 ${formatCompact(Math.max(0, Number(localProps.target || 0) - Number(localProps.actual || 0)))}` })
      ]) : null
    ])
  }
})

const MetricBar = defineComponent({
  name: 'MetricBar',
  props: {
    metric: { type: Object, required: true },
    compact: { type: Boolean, default: false },
    showValues: { type: Boolean, default: false }
  },
  setup(localProps) {
    const valueText = () => {
      const parts = []
      const planned = Number(localProps.metric.planned || 0)
      const actual = Number(localProps.metric.actual || 0)
      if (planned) parts.push(`申请 ${formatCompact(planned)}`)
      if (actual || !planned) parts.push(`实际 ${formatCompact(actual)}`)
      return parts.join(' / ')
    }
    const compactValueText = () => {
      const planned = Number(localProps.metric.planned || 0)
      const actual = Number(localProps.metric.actual || 0)
      if (planned) return `${formatCompact(actual)} / ${formatCompact(planned)}`
      return formatCompact(actual)
    }
    return () => h('span', {
      class: ['metric-bar', localProps.metric.tone, localProps.metric.natural ? 'natural' : '', localProps.compact ? 'compact' : '', localProps.showValues ? 'with-values' : ''],
      title: `${localProps.metric.label}：${valueText()}`
    }, [
      h('em', [
        h('strong', localProps.metric.label),
        localProps.showValues ? h('small', localProps.compact ? compactValueText() : valueText()) : null
      ]),
      h('span', { class: 'metric-track' }, [
        h('i', { class: 'metric-planned', style: { width: localProps.metric.plannedPct + '%' } }),
        h('b', { class: 'metric-actual', style: { width: localProps.metric.actualPct + '%' } })
      ])
    ])
  }
})

const activeTab = ref(props.moduleId === 'trafficApply' ? 'apply' : 'monitor')
const loading = ref(false)
const crmRefreshing = ref(false)
const crmLoginLoading = ref(false)
const saving = ref(false)
const showCreate = ref(false)
const showEditProject = ref(false)
const crmLoginOpen = ref(false)
const crmLoginShot = ref({})
const createText = ref('')
const createCpm = ref('30')
const parsedProject = ref({})
const SETTINGS_SERVICE_OPTIONS = {
  douyin: [
    ['play', '播放'],
    ['like', '点赞'],
    ['comment', '评论'],
    ['favorite', '收藏'],
    ['share', '转发'],
    ['douPlus', 'dou+']
  ],
  bilibili: [
    ['play', '播放'],
    ['danmaku', '弹幕'],
    ['comment', '评论'],
    ['like', '点赞'],
    ['favorite', '收藏'],
    ['coin', '投币'],
    ['share', '分享'],
    ['blueLink', '蓝链点击']
  ]
}
const phaseRatioOptions = Array.from({ length: 10 }, (_, index) => String((index + 1) * 10))
const editProjectForm = reactive({
  projectId: '',
  projectName: '',
  platform: 'douyin',
  scheduleDate: '',
  targetCpm: '30',
  targetPlayWan: ''
})
const settingsOpen = ref(false)
const settingsSaving = ref(false)
const settingsPlatform = ref('douyin')
const settingsStandardKeyword = ref('')
const settingsDraft = reactive({
  priceTables: [],
  presets: [],
  accountStandards: []
})
const projectKeyword = ref('')
const applyKeyword = ref('')
const selectedProjectId = ref('')
const selectedExecutionId = ref('')
const monitorViewMode = ref('project')
const collapsedApplyProjects = ref({})
const showArchivedProjects = ref(false)
const accountPickerOpen = ref(false)
const reviewTouched = ref(false)
const reviewText = ref('')
const commentPanelOpen = ref(false)
const suppressTargetPlayAutoSync = ref(false)
const crmStatus = ref(null)
const notice = reactive({ tone: '', message: '' })
const state = reactive({
  projects: [],
  executions: [],
  applications: [],
  priceTables: [],
  presets: [],
  accountStandards: [],
  groups: []
})

const form = reactive({
  id: '',
  projectId: '',
  projectName: '未选择来源',
  executionId: '',
  accountName: '',
  accountGroup: '',
  platform: 'douyin',
  douyinId: '',
  accountId: '',
  cooperationCode: '',
  orderType: 'xingtu',
  phaseName: '一期',
  phaseRatio: '100',
  videoUrl: '',
  useAccountStandard: false,
  targetPlayWan: '',
  targetCpm: '30',
  originalPrice: '',
  discountRate: '',
  discountedPrice: '',
  quantityInputs: emptyQuantities(),
  selectedOptions: {}
})

function withoutTargetPlayAutoSync(callback) {
  suppressTargetPlayAutoSync.value = true
  try {
    callback()
  } finally {
    nextTick(() => {
      suppressTargetPlayAutoSync.value = false
    })
  }
}

const currentGroup = computed(() => props.currentUser?.group_name || props.currentUser?.groupName || props.currentUser?.group || inferGroup(props.currentUser?.display_name || props.currentUser?.username) || '')
const effectiveGroup = computed(() => monitorViewMode.value === 'group' ? currentGroup.value : '')
const monitorExecutions = computed(() => {
  if (!effectiveGroup.value) return state.executions
  const groupKey = normalize(effectiveGroup.value)
  return state.executions.filter(execution => normalize(execution.accountGroup || execution.groupName) === groupKey)
})
const selectedProject = computed(() => visibleProjects.value.find(project => project.projectId === selectedProjectId.value) || visibleProjects.value[0] || null)
const monitorProjects = computed(() => {
  if (selectedProjectId.value && selectedProject.value) return [selectedProject.value]
  return visibleProjects.value
})
const matrixExecutions = computed(() => {
  if (monitorViewMode.value === 'group') {
    const rows = selectedProjectId.value && selectedProject.value
      ? selectedProject.value.executions || []
      : monitorExecutions.value
    return [...rows].sort((a, b) => {
      const accountCompare = normalize(a.accountName).localeCompare(normalize(b.accountName), 'zh-CN')
      if (accountCompare) return accountCompare
      return normalize(executionProjectName(a)).localeCompare(normalize(executionProjectName(b)), 'zh-CN')
    })
  }
  return selectedProject.value?.executions || []
})
const selectedProjectStatus = computed(() => {
  const rows = selectedProject.value?.executions || []
  return rows.reduce((out, execution) => {
    out[executionState(execution).key] = (out[executionState(execution).key] || 0) + 1
    return out
  }, { done: 0, running: 0, warn: 0, pending: 0 })
})
const monitorOverview = computed(() => {
  const projects = monitorProjects.value
  const executions = projects.flatMap(project => project.executions || [])
  const targetPlay = projects.reduce((sum, project) => sum + toNumber(project.targetMetrics?.play), 0)
  const appliedPlay = projects.reduce((sum, project) => sum + toNumber(project.appliedMetrics?.play), 0)
  const actualPlay = projects.reduce((sum, project) => sum + toNumber(project.currentMetrics?.play), 0)
  const budget = projects.reduce((sum, project) => sum + projectBudget(project), 0)
  const maintenanceCost = projects.reduce((sum, project) => sum + toNumber(project.maintenanceCost), 0)
  const warnCount = executions.filter(execution => executionState(execution).key === 'warn').length
  const pendingCount = executions.filter(execution => pendingPlayFor(execution) > 0 && toNumber(execution.appliedMetrics?.play) <= 0).length
  const appliedCount = executions.filter(execution => toNumber(execution.appliedMetrics?.play) > 0).length
  return {
    projectCount: projects.length,
    accountCount: executions.length,
    riskProjectCount: projects.filter(project => projectRiskState(project).key === 'warn' || projectRiskState(project).key === 'danger').length,
    warnCount,
    pendingCount,
    appliedCount,
    targetPlay,
    appliedPlay,
    actualPlay,
    budget,
    maintenanceCost,
    targetCpm: targetPlay ? budget / targetPlay * 1000 : 0,
    actualCpm: actualPlay ? budget / actualPlay * 1000 : 0
  }
})
const overviewRiskPct = computed(() => monitorOverview.value.projectCount ? monitorOverview.value.riskProjectCount / monitorOverview.value.projectCount * 100 : 0)
const overviewDots = computed(() => {
  const dots = monitorProjects.value.map((project, index) => ({
    key: project.projectId || index,
    tone: projectRiskState(project).key,
    color: projectAccent(project).color,
    rank: riskRank(projectRiskState(project).key)
  })).sort((a, b) => b.rank - a.rank)
  return dots.slice(0, 36)
})
const firstFocusItem = computed(() => focusExecutions.value[0] || null)
const firstPendingExecution = computed(() => {
  for (const project of monitorProjects.value) {
    const execution = (project.executions || []).find(item => pendingPlayFor(item) > 0 && toNumber(item.appliedMetrics?.play) <= 0)
    if (execution) return execution
  }
  return null
})
const overviewAdvice = computed(() => {
  const focus = firstFocusItem.value
  if (focus) {
    return {
      tone: focus.level === 'danger' ? 'danger' : 'warn',
      title: `${focus.execution.accountName} 需要重点监控`,
      detail: `${focus.project.projectName} · ${focus.reason || '申请量还没跑到'}，先核对后台数据或准备补投。`
    }
  }
  const pending = firstPendingExecution.value
  if (pending) {
    return {
      tone: 'pending',
      title: `${pending.accountName} 还没提交投流申请`,
      detail: `${pending.projectName || '当前项目'} 还有 ${formatWan(pendingPlayFor(pending))} 播放目标未申请，可以从这里直接进入投流申请。`
    }
  }
  if (!monitorOverview.value.projectCount) {
    return {
      tone: 'pending',
      title: '先创建项目',
      detail: '粘贴锁档文案创建项目后，这里会自动给出待申请和重点监控建议。'
    }
  }
  return {
    tone: 'done',
    title: '当前没有需要立即处理的账号',
    detail: '保持后台数据刷新；如果实际量低于申请量，系统会自动把账号推到重点监控。'
  }
})
const overviewAdviceDots = computed(() => {
  const tones = []
  for (let index = 0; index < monitorOverview.value.pendingCount; index += 1) tones.push('pending')
  for (let index = 0; index < focusExecutions.value.length; index += 1) tones.push(focusExecutions.value[index].level)
  for (let index = 0; index < Math.max(0, monitorOverview.value.appliedCount - focusExecutions.value.length); index += 1) tones.push('running')
  if (!tones.length && monitorOverview.value.projectCount) tones.push('done')
  return tones.slice(0, 18).map((tone, index) => ({ key: `${tone}-${index}`, tone }))
})
const overviewScheduleText = computed(() => {
  const dates = monitorProjects.value.flatMap(project => [
    project.scheduleDate,
    ...(project.executions || []).map(execution => execution.scheduleDate)
  ]).filter(Boolean)
  const unique = Array.from(new Set(dates)).sort()
  if (!unique.length) return '未填档期'
  if (unique.length === 1) return displayScheduleDate(unique[0])
  return `${displayScheduleDate(unique[0])} - ${displayScheduleDate(unique[unique.length - 1])}`
})
const projectStatusDots = computed(() => {
  const dots = []
  const status = selectedProjectStatus.value
  ;[['done', status.done], ['running', status.running], ['warn', status.warn], ['pending', status.pending]].forEach(([tone, count]) => {
    for (let index = 0; index < count; index += 1) dots.push({ key: tone + index, tone })
  })
  return dots.slice(0, 28)
})
const selectedExecution = computed(() => state.executions.find(execution => execution.executionId === selectedExecutionId.value) || null)
const focusExecutions = computed(() => {
  const items = []
  monitorProjects.value.forEach(project => {
    ;(project.executions || []).forEach(execution => {
      const focus = focusState(execution)
      if (!focus.level) return
      items.push({ project, execution, ...focus })
    })
  })
  return items.sort((a, b) => riskRank(b.level) - riskRank(a.level)).slice(0, 12)
})
const visibleProjects = computed(() => {
  const keyword = normalize(projectKeyword.value)
  const sourceExecutions = monitorViewMode.value === 'group' ? monitorExecutions.value : state.executions
  const executionIds = new Set(sourceExecutions.map(execution => execution.executionId))
  const list = state.projects
    .filter(project => !isArchivedProject(project))
    .map(project => ({
    ...project,
    executions: (project.executions || []).filter(execution => executionIds.has(execution.executionId))
  })).filter(project => project.executions.length || monitorViewMode.value === 'project')
  if (!keyword) return list
  return list.filter(project => normalize(`${project.projectName} ${project.executions?.map(execution => execution.accountName).join(' ')}`).includes(keyword))
})
const archivedProjects = computed(() => {
  const keyword = normalize(projectKeyword.value)
  const sourceExecutions = monitorViewMode.value === 'group' ? monitorExecutions.value : state.executions
  const executionIds = new Set(sourceExecutions.map(execution => execution.executionId))
  const list = state.projects
    .filter(project => isArchivedProject(project))
    .map(project => ({
      ...project,
      executions: (project.executions || []).filter(execution => executionIds.has(execution.executionId))
    }))
    .filter(project => project.executions.length || monitorViewMode.value === 'project')
  if (!keyword) return list
  return list.filter(project => normalize(`${project.projectName} ${project.executions?.map(execution => execution.accountName).join(' ')}`).includes(keyword))
})
const applyTree = computed(() => {
  const keyword = normalize(applyKeyword.value)
  return state.projects.filter(project => !isArchivedProject(project)).map(project => {
    const executions = (project.executions || []).filter(execution => {
      if (execution.accountGroup && currentGroup.value && normalize(execution.accountGroup) !== normalize(currentGroup.value)) return false
      if (!keyword) return true
      return normalize(`${project.projectName} ${execution.accountName} ${nextPhaseFor(execution)}`).includes(keyword)
    })
    return { ...project, executions }
  }).filter(project => project.executions.length)
})
const accountSuggestionRows = computed(() => {
  const keyword = normalize(form.accountName)
  const groupKey = normalize(currentGroup.value)
  const selectedId = form.executionId
  const rows = state.executions
    .map(execution => ({
      execution,
      projectName: execution.projectName || state.projects.find(project => project.projectId === execution.projectId)?.projectName || '未命名项目',
      groupRank: groupKey && normalize(execution.accountGroup) === groupKey ? 0 : 1,
      selectedRank: selectedId === execution.executionId ? 0 : 1,
      pending: pendingPlayFor(execution),
      discountText: toNumber(execution.discountRate) ? `${formatNumber(execution.discountRate)}%` : '未填'
    }))
    .filter(item => {
      if (normalizePlatform(item.execution.platform) !== normalizePlatform(form.platform)) return false
      if (groupKey && item.groupRank !== 0 && item.execution.accountGroup) return false
      if (!keyword) return true
      return normalize(`${item.execution.accountName} ${item.projectName} ${item.execution.accountGroup || ''}`).includes(keyword)
    })
    .sort((a, b) => a.selectedRank - b.selectedRank || a.groupRank - b.groupRank || b.pending - a.pending || normalize(a.execution.accountName).localeCompare(normalize(b.execution.accountName)))
  return rows.slice(0, 12)
})
const activeSettingsTables = computed(() => settingsDraft.priceTables.filter(table => table.platform === settingsPlatform.value))
const visibleSettingsStandards = computed(() => {
  const keyword = normalize(settingsStandardKeyword.value)
  return settingsDraft.accountStandards
    .filter(standard => normalizePlatform(standard.platform) === settingsPlatform.value)
    .filter(standard => !keyword || normalize(standard.accountName).includes(keyword))
    .slice(0, 60)
})
const priceTable = computed(() => state.priceTables.find(table => table.platform === normalizePlatform(form.platform)) || state.priceTables[0] || { items: [] })
const serviceRows = computed(() => {
  const keys = normalizePlatform(form.platform) === 'bilibili'
    ? [['play', '播放'], ['danmaku', '弹幕'], ['comment', '评论'], ['like', '点赞'], ['favorite', '收藏'], ['coin', '投币'], ['share', '分享'], ['blueLink', '蓝链点击']]
    : [['play', '播放'], ['like', '点赞'], ['comment', '评论'], ['favorite', '收藏'], ['share', '转发'], ['douPlus', 'dou+']]
  return keys.filter(([key]) => optionsFor(key).length).map(([key, label]) => ({ key, label }))
})
const existingRecords = computed(() => state.applications.filter(record => record.executionId === form.executionId))
const phaseHistoryRecords = computed(() => {
  return dedupePhaseRecords(existingRecords.value).sort((a, b) => {
    const phaseDiff = phaseNumber(a.phaseName) - phaseNumber(b.phaseName)
    if (phaseDiff) return phaseDiff
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  })
})
function executionPhaseRecords(execution) {
  return dedupePhaseRecords(state.applications.filter(record => record.executionId === execution.executionId))
    .sort((a, b) => {
      const phaseDiff = phaseNumber(a.phaseName) - phaseNumber(b.phaseName)
      if (phaseDiff) return phaseDiff
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    })
}

function latestSavedPhaseName(execution) {
  const records = executionPhaseRecords(execution || {})
  if (!records.length) return ''
  return [...records].sort((a, b) => phaseNumber(b.phaseName) - phaseNumber(a.phaseName))[0]?.phaseName || ''
}

function dedupePhaseRecords(records) {
  const map = new Map()
  ;(records || []).forEach(record => {
    const key = normalize(record.phaseName || '一期')
    const previous = map.get(key)
    if (!previous || String(record.updatedAt || '').localeCompare(String(previous.updatedAt || '')) >= 0) map.set(key, record)
  })
  return [...map.values()]
}

const phaseTabs = computed(() => {
  const base = ['一期', '二期', '三期']
  const names = new Set([...base, ...phaseHistoryRecords.value.map(record => record.phaseName || '一期')])
  const nextName = form.executionId ? nextPhaseFor({ executionId: form.executionId }) : nextPhaseName(form.phaseName)
  names.add(nextName)
  return [...names]
    .filter(Boolean)
    .sort((a, b) => phaseNumber(a) - phaseNumber(b))
    .map(name => {
      const record = latestPhaseRecord(form.executionId, name)
      return {
        name,
        saved: Boolean(record),
        active: normalize(name) === normalize(form.phaseName),
        next: !record && normalize(name) === normalize(nextName)
      }
    })
})

function latestPhaseRecord(executionId, phaseName) {
  return dedupePhaseRecords(state.applications.filter(record =>
    record.executionId === executionId && normalize(record.phaseName) === normalize(phaseName)
  ))[0] || null
}

function latestPhaseVideoUrl(executionId) {
  return dedupePhaseRecords(state.applications.filter(record =>
    record.executionId === executionId && normalize(record.videoUrl)
  ))
    .sort((a, b) => {
      const phaseDiff = phaseNumber(b.phaseName) - phaseNumber(a.phaseName)
      if (phaseDiff) return phaseDiff
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    })[0]?.videoUrl || ''
}
const currentCost = computed(() => serviceRows.value.reduce((sum, service) => sum + lineCost(service.key), 0))
const cumulativeCost = computed(() => {
  const samePhase = normalize(form.phaseName)
  const previous = dedupePhaseRecords(existingRecords.value)
    .filter(record => normalize(record.phaseName) !== samePhase)
    .reduce((sum, record) => sum + toNumber(record.maintenanceCost), 0)
  return previous + currentCost.value
})
const grossProfit = computed(() => toNumber(form.discountedPrice) - cumulativeCost.value)
const grossMargin = computed(() => {
  const basePrice = toNumber(form.originalPrice)
  return basePrice ? grossProfit.value / basePrice * 100 : 0
})
const grossTone = computed(() => grossMargin.value >= 75 ? 'good' : grossMargin.value >= 60 ? 'warn' : 'bad')
const generatedReview = computed(() => buildReviewText())
const canExportApplication = computed(() => Boolean(form.executionId && normalize(form.accountName)))
const applyProgressTarget = computed(() => toNumber(selectedExecution.value?.targetMetrics?.play) || Math.round(toNumber(form.targetPlayWan) * 10000))
const applyProgressPlanned = computed(() => toNumber(selectedExecution.value?.appliedMetrics?.play))
const applyProgressActual = computed(() => toNumber(selectedExecution.value?.currentMetrics?.play))
const commentContext = computed(() => ({
  account: '',
  videoUrl: form.videoUrl,
  scenario: '',
  script: '',
  count: commentRequestCount.value
}))
const commentRequestCount = computed(() => {
  const option = selectedOption('comment')
  const raw = quantityInputToRaw(form.quantityInputs.comment, selectedQuantityUnit('comment', option), 'comment')
  return raw ? Math.max(5, Math.min(300, Math.round(raw / 5) * 5)) : 30
})
const currentAccountStandard = computed(() => findAccountStandard(form.accountName, form.platform))
const currentAccountStandardPreview = computed(() => {
  const standard = currentAccountStandard.value
  if (!standard) return null
  const metrics = standard.metrics || {}
  const basePlay = toNumber(metrics.play)
  const platform = normalizePlatform(standard.platform || form.platform)
  return {
    targetCpm: toNumber(standard.targetCpm),
    play: normalizeMetricRaw('play', basePlay),
    like: platform === 'douyin' ? douyinAutoLike(basePlay) : normalizeMetricRaw('like', toNumber(metrics.like))
  }
})
const genericPresetPreviewRows = computed(() => {
  const play = Math.round(toNumber(form.targetPlayWan) * 10000) || toNumber(selectedExecution.value?.targetMetrics?.play)
  const metrics = genericPresetMetrics(play)
  const keys = normalizePlatform(form.platform) === 'bilibili'
    ? [['play', '播放'], ['like', '点赞'], ['comment', '评论'], ['favorite', '收藏'], ['coin', '投币'], ['share', '分享'], ['danmaku', '弹幕'], ['blueLink', '蓝链']]
    : [['play', '播放'], ['like', '点赞'], ['comment', '评论'], ['favorite', '收藏'], ['share', '转发']]
  return keys.map(([key, label]) => ({
    key,
    label,
    value: key === 'play' ? formatWan(metrics.play) : formatCompact(metrics[key])
  }))
})
const targetCpmChoices = computed(() => {
  const choices = []
  const pushChoice = (label, value, key) => {
    const number = toNumber(value)
    if (!number) return
    if (choices.some(item => Math.abs(toNumber(item.value) - number) < 0.001)) return
    choices.push({ label, value: number, key: key || `${label}-${number}` })
  }
  const fixedChoices = normalizePlatform(form.platform) === 'bilibili'
    ? [60, 100, 150, 180]
    : [30, 50, 70, 100]
  fixedChoices.forEach(value => pushChoice('CPM', value, `fixed-${value}`))
  pushChoice('项目', selectedExecution.value?.targetCpm, 'project')
  pushChoice('预设', currentAccountStandard.value?.targetCpm, 'standard')
  const current = toNumber(form.targetCpm)
  if (current && !choices.some(item => Math.abs(toNumber(item.value) - current) < 0.001)) pushChoice('当前', current, 'current')
  return choices.slice(0, 8)
})

const crmLastResult = computed(() => crmStatus.value?.lastResult || null)
const crmLastSuccessAt = computed(() => crmLastResult.value?.crmRefreshAt || crmLastResult.value?.at || '')
const crmRefreshSummary = computed(() => {
  const at = displayCrmTime(crmLastSuccessAt.value)
  if (!at) return ''
  const rows = toNumber(crmLastResult.value?.csvRows)
  return rows ? `后台 ${at} · ${rows} 行` : `后台 ${at}`
})
const crmRefreshShort = computed(() => displayCrmTime(crmLastSuccessAt.value).replace(/^(\d+月\d+日)\s+/, ''))
const crmRefreshTitle = computed(() => {
  const result = crmLastResult.value || {}
  const parts = []
  if (crmRefreshSummary.value) parts.push(`上次成功刷新：${crmRefreshSummary.value}`)
  if (result.csvUpdatedRange?.max) parts.push(`CSV 最新业务时间：${displayCrmTime(result.csvUpdatedRange.max)}`)
  if (result.file?.name) parts.push(`文件：${result.file.name}`)
  return parts.join(' · ')
})

watch(() => props.moduleId, (moduleId) => {
  activeTab.value = moduleId === 'trafficApply' ? 'apply' : activeTab.value
})

watch(selectedProject, (project) => {
  if (project && !visibleProjects.value.some(item => item.projectId === selectedProjectId.value)) selectedProjectId.value = project.projectId
}, { immediate: true })

watch(generatedReview, (text) => {
  reviewText.value = text
  reviewTouched.value = false
})

watch(() => [form.discountedPrice, form.targetCpm], () => {
  if (suppressTargetPlayAutoSync.value) return
  syncTargetPlay()
})

onMounted(() => {
  refresh()
  refreshCrmStatus()
})

async function refresh() {
  loading.value = true
  try {
    const data = await fetchTrafficPlanV2(monitorViewMode.value === 'group' ? { groupName: currentGroup.value } : { allGroups: true })
    applyState(data)
  } catch (error) {
    toast('error', '投流计划读取失败：' + (error.message || error))
  } finally {
    loading.value = false
  }
}

async function refreshCrmData() {
  crmRefreshing.value = true
  try {
    const data = await refreshTrafficPlanV2CrmCsv(monitorViewMode.value === 'group' ? { groupName: currentGroup.value } : { allGroups: true })
    if (!data.ok) throw new Error(data.error || 'CRM CSV 更新失败')
    applyState(data)
    crmStatus.value = { lastResult: data }
    const fileName = data.file?.name ? ` · ${data.file.name}` : ''
    const csvRows = data.csvRows ? ` · CSV ${data.csvRows} 行` : ''
    const csvFresh = data.csvUpdatedRange?.max ? ` · CSV最新 ${displayCrmTime(data.csvUpdatedRange.max)}` : ''
    toast('success', `后台数据已更新：匹配 ${data.matched || 0} 条，未匹配 ${data.unmatched || 0} 条${csvRows}${csvFresh}${fileName}`)
  } catch (error) {
    toast('error', '后台数据更新失败：' + (error.message || error))
  } finally {
    crmRefreshing.value = false
  }
}

async function refreshCrmStatus() {
  try {
    const data = await fetchTrafficPlanV2CrmStatus()
    if (data?.ok) crmStatus.value = data
  } catch (error) {}
}

async function openCrmLoginShot() {
  crmLoginOpen.value = true
  crmLoginLoading.value = true
  try {
    const data = await fetchTrafficPlanV2CrmLoginScreenshot()
    if (!data.ok) throw new Error(data.error || 'CRM 登录截图获取失败')
    crmLoginShot.value = data
    toast(data.needLogin ? 'warn' : 'success', data.needLogin ? 'CRM 登录码已打开，请扫码登录' : 'CRM 当前看起来已登录')
  } catch (error) {
    toast('error', 'CRM 登录截图失败：' + (error.message || error))
  } finally {
    crmLoginLoading.value = false
  }
}

function applyState(data) {
  state.projects = Array.isArray(data.projects) ? data.projects : []
  state.executions = Array.isArray(data.executions) ? data.executions : []
  state.applications = Array.isArray(data.applications) ? data.applications : []
  state.priceTables = Array.isArray(data.priceTables) ? data.priceTables : []
  state.presets = Array.isArray(data.presets) ? data.presets : []
  state.accountStandards = Array.isArray(data.accountStandards) ? data.accountStandards : []
  state.groups = Array.isArray(data.groups) ? data.groups : []
  resetSettingsEditor()
  if (!selectedProjectId.value && state.projects[0]) selectedProjectId.value = state.projects[0].projectId
}

function selectProject(projectId) {
  selectedProjectId.value = projectId
  activeTab.value = 'monitor'
}

function setMonitorView(mode) {
  if (monitorViewMode.value === mode) return
  monitorViewMode.value = mode
  selectedProjectId.value = ''
  refresh()
}

async function parseProject() {
  try {
    const data = await parseTrafficPlanV2Text({ text: createText.value, groupName: currentGroup.value })
    const parsed = data.parsed || {}
    const effectiveCpm = toNumber(parsed.targetCpm) || toNumber(createCpm.value) || 30
    createCpm.value = String(effectiveCpm)
    parsedProject.value = { ...parsed, targetCpm: effectiveCpm }
    parsedProject.value.accounts = uniqueParsedAccounts(parsedProject.value.accounts).map(account => ({
      ...account,
      targetCpm: parsedProject.value.targetCpm,
      targetPlay: parsedAccountTargetPlay(account, parsedProject.value.targetCpm)
    }))
    toast('success', `已解析 ${parsedProject.value.accounts?.length || 0} 个账号`)
  } catch (error) {
    toast('error', '解析失败：' + (error.message || error))
  }
}

function projectWithCreateCpm() {
  const targetCpm = toNumber(createCpm.value) || toNumber(parsedProject.value.targetCpm) || 30
  return {
    ...parsedProject.value,
    targetCpm,
    accounts: uniqueParsedAccounts(parsedProject.value.accounts).map(account => ({
      ...account,
      targetCpm,
      targetPlay: parsedAccountTargetPlay(account, targetCpm)
    }))
  }
}

function accountStandardTargetPlay(account) {
  const standard = findAccountStandard(account?.accountName || account?.name, account?.platform || parsedProject.value?.platform)
  return Math.round(toNumber(standard?.metrics?.play))
}

function parsedAccountTargetPlay(account, targetCpm) {
  return accountStandardTargetPlay(account)
    || Math.round(toNumber(account?.targetPlay) || toNumber(account?.targetMetrics?.play))
    || (account?.discountedPrice && targetCpm ? Math.round(toNumber(account.discountedPrice) / targetCpm * 1000) : 0)
}

function hasValidParsedPrice(account) {
  return toNumber(account?.originalPrice) > 0 && toNumber(account?.discountedPrice) > 0
}

function uniqueParsedAccounts(accounts) {
  const map = new Map()
  ;(accounts || []).filter(hasValidParsedPrice).forEach(account => {
    const key = normalize(account.accountName || account.name)
    if (!key) return
    map.set(key, account)
  })
  return Array.from(map.values())
}

function syncParsedProjectCpm() {
  if (!parsedProject.value?.accounts?.length) return
  parsedProject.value = projectWithCreateCpm()
}

async function createProject() {
  try {
    const payload = { ...projectWithCreateCpm(), groupName: currentGroup.value }
    if (!payload.accounts?.length) {
      toast('error', '没有解析到有效价格，不能创建投流计划')
      return
    }
    const data = await createTrafficPlanV2Project(payload)
    const createdProjectId = data.projects?.[0]?.projectId || data.project?.projectId || ''
    if (createdProjectId) selectedProjectId.value = createdProjectId
    await refresh()
    showCreate.value = false
    createText.value = ''
    parsedProject.value = {}
    toast('success', '项目已创建')
  } catch (error) {
    toast('error', '创建失败：' + (error.message || error))
  }
}

async function deleteSelectedProject() {
  if (!selectedProject.value) return
  if (!window.confirm(`确认删除「${selectedProject.value.projectName}」吗？`)) return
  try {
    await deleteTrafficPlanV2Project({ projectId: selectedProject.value.projectId })
    selectedProjectId.value = ''
    await refresh()
    selectedProjectId.value = state.projects[0]?.projectId || ''
    toast('success', '项目已删除')
  } catch (error) {
    toast('error', '删除失败：' + (error.message || error))
  }
}

async function archiveSelectedProject() {
  const project = selectedProject.value
  if (!project) return
  const nextArchived = !isArchivedProject(project)
  try {
    await updateTrafficPlanV2Project({
      projectId: project.projectId,
      projectName: project.projectName,
      platform: project.platform,
      scheduleDate: project.scheduleDate,
      preserveTargetMetrics: true,
      status: nextArchived ? 'archived' : 'active'
    })
    await refresh()
    if (nextArchived) {
      selectedProjectId.value = visibleProjects.value[0]?.projectId || ''
      toast('success', `已归档「${project.projectName}」`)
    } else {
      selectedProjectId.value = project.projectId
      toast('success', `已取消归档「${project.projectName}」`)
    }
  } catch (error) {
    toast('error', '归档失败：' + (error.message || error))
  }
}

async function restoreProject(project) {
  if (!project) return
  try {
    await updateTrafficPlanV2Project({
      projectId: project.projectId,
      projectName: project.projectName,
      platform: project.platform,
      scheduleDate: project.scheduleDate,
      preserveTargetMetrics: true,
      status: 'active'
    })
    await refresh()
    selectedProjectId.value = project.projectId
    toast('success', `已恢复「${project.projectName}」`)
  } catch (error) {
    toast('error', '恢复失败：' + (error.message || error))
  }
}

function openEditProject(project) {
  if (!project) return
  const targetPlay = toNumber(project.targetMetrics?.play)
  Object.assign(editProjectForm, {
    projectId: project.projectId,
    projectName: project.projectName || '',
    platform: normalizePlatform(project.platform),
    scheduleDate: project.scheduleDate || '',
    targetCpm: stripZeros(String(projectTargetCpm(project) || project.targetCpm || defaultTargetCpm(project.platform))),
    targetPlayWan: targetPlay ? stripZeros((targetPlay / 10000).toFixed(2)) : ''
  })
  showEditProject.value = true
}

function editProjectSource() {
  return state.projects.find(project => project.projectId === editProjectForm.projectId)
    || selectedProject.value
}

function handleEditProjectCpmInput() {
  const project = editProjectSource()
  const budget = projectBudget(project)
  const cpm = toNumber(editProjectForm.targetCpm)
  if (!budget || !cpm) return
  editProjectForm.targetPlayWan = stripZeros((budget / cpm / 10).toFixed(2))
}

function handleEditProjectPlayInput() {
  const project = editProjectSource()
  const budget = projectBudget(project)
  const targetPlay = Math.round(toNumber(editProjectForm.targetPlayWan) * 10000)
  if (!budget || !targetPlay) return
  editProjectForm.targetCpm = stripZeros((budget / targetPlay * 1000).toFixed(2))
}

async function saveProjectInfo() {
  if (!editProjectForm.projectId) return
  const targetCpm = toNumber(editProjectForm.targetCpm) || defaultTargetCpm(editProjectForm.platform)
  const targetPlay = Math.round(toNumber(editProjectForm.targetPlayWan) * 10000)
  try {
    await updateTrafficPlanV2Project({
      projectId: editProjectForm.projectId,
      projectName: editProjectForm.projectName,
      platform: editProjectForm.platform,
      scheduleDate: editProjectForm.scheduleDate,
      targetCpm,
      targetPlay
    })
    selectedProjectId.value = editProjectForm.projectId
    await refresh()
    selectedProjectId.value = editProjectForm.projectId
    showEditProject.value = false
    toast('success', '项目信息已更新')
  } catch (error) {
    toast('error', '项目更新失败：' + (error.message || error))
  }
}

function startApply(execution, options = {}) {
  selectedExecutionId.value = execution.executionId
  collapsedApplyProjects.value = { ...collapsedApplyProjects.value, [execution.projectId]: false }
  activeTab.value = 'apply'
  fillForm(execution, options)
}

function selectExecutionPhase(execution, record) {
  if (!execution?.executionId || !record) return
  selectedExecutionId.value = execution.executionId
  collapsedApplyProjects.value = { ...collapsedApplyProjects.value, [execution.projectId]: false }
  activeTab.value = 'apply'
  applyApplicationRecord(record, execution)
}

function startGapApply(execution) {
  startApply(execution, { phaseName: nextPhaseFor(execution) })
  const gap = executionPlayGap(execution)
  if (gap > 0) {
    applyPlayAmount(gap, { keepExisting: false })
  }
  reviewTouched.value = false
  reviewText.value = generatedReview.value
  toast('success', `已按播放差额 ${formatWan(gap)} 回填投流申请`)
}

function startUnlinkedApply() {
  selectedExecutionId.value = ''
  activeTab.value = 'apply'
  const executionId = 'manual-' + Date.now().toString(36)
  const platform = normalizePlatform(form.platform || 'douyin')
  Object.assign(form, {
    id: '',
    projectId: 'unlinked-project',
    projectName: '未关联项目',
    executionId,
    accountName: '',
    accountGroup: currentGroup.value || '',
    platform,
    douyinId: '',
    accountId: '',
    cooperationCode: '',
    orderType: 'xingtu',
    phaseName: '一期',
    phaseRatio: '100',
    videoUrl: '',
    useAccountStandard: false,
    targetPlayWan: '',
    targetCpm: String(defaultTargetCpm(platform)),
    originalPrice: '',
    discountRate: '',
    discountedPrice: '',
    quantityInputs: emptyQuantities(),
    selectedOptions: defaultSelectedOptions(platform)
  })
  reviewTouched.value = false
  reviewText.value = generatedReview.value
}

function openAccountPicker() {
  accountPickerOpen.value = true
}

function closeAccountPickerLater() {
  window.setTimeout(() => {
    accountPickerOpen.value = false
  }, 120)
}

function handleAccountInput() {
  accountPickerOpen.value = true
  if (!form.executionId || String(form.executionId).startsWith('manual-')) {
    applyExactAccountStandardForManual()
    return
  }
  const linked = state.executions.find(item => item.executionId === form.executionId)
  if (linked && normalize(form.accountName) !== normalize(linked.accountName)) {
    selectedExecutionId.value = ''
    form.executionId = 'manual-' + Date.now().toString(36)
    form.projectId = 'unlinked-project'
    form.projectName = '未关联项目'
    applyExactAccountStandardForManual()
  }
}

function selectAccountSuggestion(execution) {
  if (!execution?.executionId) return
  accountPickerOpen.value = false
  startApply(execution)
  syncDiscountPrice()
  syncTargetPlay()
}

function isApplyProjectOpen(project) {
  if (applyKeyword.value) return true
  if (selectedExecution.value?.projectId === project.projectId) return true
  return collapsedApplyProjects.value[project.projectId] !== true
}

function toggleApplyProject(projectId) {
  collapsedApplyProjects.value = {
    ...collapsedApplyProjects.value,
    [projectId]: collapsedApplyProjects.value[projectId] !== true
  }
}

function expandApplyProjects() {
  collapsedApplyProjects.value = {}
}

function collapseApplyProjects() {
  collapsedApplyProjects.value = Object.fromEntries(applyTree.value.map(project => [project.projectId, true]))
}

function pendingPlayFor(execution) {
  return Math.max(0, toNumber(execution.targetMetrics?.play) - toNumber(execution.appliedMetrics?.play))
}

function executionAppliedPlay(execution) {
  return toNumber(execution?.appliedMetrics?.play)
}

function executionPlayGap(execution) {
  return Math.max(0, toNumber(execution.targetMetrics?.play) - toNumber(execution.currentMetrics?.play))
}

function executionPlayGapPercent(execution) {
  return progress(executionPlayGap(execution), toNumber(execution.targetMetrics?.play))
}

function projectPlayGap(project) {
  return Math.max(0, toNumber(project?.targetMetrics?.play) - toNumber(project?.currentMetrics?.play))
}

function projectPlayGapPercent(project) {
  return progress(projectPlayGap(project), toNumber(project?.targetMetrics?.play))
}

function projectForExecution(execution) {
  if (!execution) return null
  return state.projects.find(project => project.projectId === execution.projectId)
    || state.projects.find(project => normalize(project.projectName) === normalize(execution.projectName))
    || null
}

function executionProjectName(execution) {
  return execution?.projectName || projectForExecution(execution)?.projectName || '未命名项目'
}

function resolveAccountIdentity(execution = null, record = null, options = {}) {
  const sourceExecution = execution || selectedExecution.value || {}
  const platform = record?.platform || sourceExecution.platform || form.platform
  const accountName = record?.accountName || sourceExecution.accountName || form.accountName
  const standard = findAccountStandard(accountName, platform) || {}
  const formFallback = options.includeForm === false ? {} : form
  return {
    douyinId: reviewIdentityValue(
      sourceExecution.douyinId,
      sourceExecution.accountId,
      record?.douyinId,
      record?.accountId,
      standard.douyinId,
      standard.accountId,
      formFallback.douyinId,
      formFallback.accountId
    ),
    accountId: reviewIdentityValue(
      sourceExecution.accountId,
      sourceExecution.douyinId,
      record?.accountId,
      record?.douyinId,
      standard.accountId,
      standard.douyinId,
      formFallback.accountId,
      formFallback.douyinId
    ),
    cooperationCode: reviewIdentityValue(
      sourceExecution.cooperationCode,
      record?.cooperationCode,
      standard.cooperationCode,
      formFallback.cooperationCode
    )
  }
}

function applyProjectPending(project) {
  return (project.executions || []).reduce((sum, execution) => sum + pendingPlayFor(execution), 0)
}

function fillForm(execution, options = {}) {
  const phaseName = options.phaseName || latestSavedPhaseName(execution) || '一期'
  const identity = resolveAccountIdentity(execution, null, { includeForm: false })
  withoutTargetPlayAutoSync(() => {
    Object.assign(form, {
      id: '',
      projectId: execution.projectId,
      projectName: execution.projectName,
      executionId: execution.executionId,
      accountName: execution.accountName,
      accountGroup: execution.accountGroup,
      platform: normalizePlatform(execution.platform),
      douyinId: identity.douyinId,
      accountId: identity.accountId,
      cooperationCode: identity.cooperationCode,
      orderType: execution.orderType || execution.dealType || 'xingtu',
      phaseName,
      phaseRatio: '100',
      videoUrl: latestPhaseVideoUrl(execution.executionId) || execution.videoUrl || '',
      useAccountStandard: false,
      targetPlayWan: stripZeros((toNumber(execution.targetMetrics?.play) / 10000).toFixed(2)),
      targetCpm: String(defaultTargetCpm(execution.platform)),
      originalPrice: String(execution.originalPrice || execution.discountedPrice || ''),
      discountRate: String(execution.discountRate || ''),
      discountedPrice: String(execution.discountedPrice || ''),
      quantityInputs: emptyQuantities(),
      selectedOptions: defaultSelectedOptions(execution.platform)
    })
    const existing = latestPhaseRecord(execution.executionId, phaseName)
    if (existing) {
      applyApplicationRecord(existing, execution)
    } else {
      if (form.useAccountStandard) applyAccountStandard(execution, { quiet: true })
      reviewTouched.value = false
      reviewText.value = generatedReview.value
    }
  })
}

function applyApplicationRecord(record, execution = null) {
  if (!record) return
  const sourceExecution = execution || state.executions.find(item => item.executionId === record.executionId) || selectedExecution.value || {}
  const platform = normalizePlatform(record.platform || sourceExecution.platform || form.platform)
  const identity = resolveAccountIdentity(sourceExecution, record, { includeForm: false })
  withoutTargetPlayAutoSync(() => {
    Object.assign(form, {
      id: record.id || record.applicationId || '',
      projectId: record.projectId || sourceExecution.projectId || form.projectId,
      projectName: record.projectName || sourceExecution.projectName || form.projectName,
      executionId: record.executionId || sourceExecution.executionId || form.executionId,
      accountName: record.accountName || sourceExecution.accountName || form.accountName,
      accountGroup: record.accountGroup || sourceExecution.accountGroup || form.accountGroup,
      platform,
      douyinId: identity.douyinId,
      accountId: identity.accountId,
      cooperationCode: identity.cooperationCode,
      orderType: record.orderType || sourceExecution.orderType || sourceExecution.dealType || form.orderType || 'xingtu',
      phaseName: record.phaseName || form.phaseName,
      videoUrl: record.videoUrl || latestPhaseVideoUrl(record.executionId || sourceExecution.executionId || form.executionId) || sourceExecution.videoUrl || form.videoUrl,
      useAccountStandard: false,
      phaseRatio: String(record.phaseRatio || '100'),
      targetPlayWan: stripZeros((toNumber(record.targetPlay || record.targetMetrics?.play) / 10000).toFixed(2)),
      targetCpm: String(record.targetCpm || form.targetCpm || defaultTargetCpm(platform)),
      originalPrice: String(record.originalPrice || sourceExecution.originalPrice || form.originalPrice),
      discountRate: String(record.discountRate || sourceExecution.discountRate || form.discountRate),
      discountedPrice: String(record.discountedPrice || sourceExecution.discountedPrice || form.discountedPrice),
      quantityInputs: { ...emptyQuantities(), ...(record.quantityInputs || {}) },
      selectedOptions: { ...defaultSelectedOptions(platform), ...(record.selectedOptions || {}) }
    })
    reviewText.value = generatedReview.value
    reviewTouched.value = false
  })
}

function selectPhaseHistory(record) {
  if (!record) return
  const execution = state.executions.find(item => item.executionId === record.executionId) || selectedExecution.value
  if (execution?.executionId) selectedExecutionId.value = execution.executionId
  applyApplicationRecord(record, execution)
  toast('success', `已载入${record.phaseName || '历史期数'}`)
}

function handlePhaseChange() {
  if (!form.executionId) return
  const existing = latestPhaseRecord(form.executionId, form.phaseName)
  if (existing) {
    applyApplicationRecord(existing)
    return
  }
  const execution = state.executions.find(item => item.executionId === form.executionId) || selectedExecution.value
  const identity = resolveAccountIdentity(execution)
  Object.assign(form, {
    id: '',
    douyinId: identity.douyinId,
    accountId: identity.accountId,
    cooperationCode: identity.cooperationCode,
    orderType: form.orderType || 'xingtu',
    videoUrl: form.videoUrl || latestPhaseVideoUrl(form.executionId) || execution?.videoUrl || '',
    phaseRatio: '100',
    quantityInputs: emptyQuantities(),
    selectedOptions: defaultSelectedOptions(form.platform)
  })
  if (form.useAccountStandard) applyAccountStandard(execution, { quiet: true })
  reviewTouched.value = false
  reviewText.value = generatedReview.value
}

function switchPhaseTab(phaseName) {
  if (!phaseName) return
  form.phaseName = phaseName
  handlePhaseChange()
}

function createNextPhase() {
  if (!form.executionId) {
    toast('error', '先从左侧选择一个账号')
    return
  }
  const execution = state.executions.find(item => item.executionId === form.executionId) || selectedExecution.value
  const phaseName = execution ? nextPhaseFor(execution) : nextPhaseName(form.phaseName)
  const identity = resolveAccountIdentity(execution)
  Object.assign(form, {
    id: '',
    douyinId: identity.douyinId,
    accountId: identity.accountId,
    cooperationCode: identity.cooperationCode,
    orderType: form.orderType || 'xingtu',
    phaseName,
    phaseRatio: '100',
    videoUrl: form.videoUrl || latestPhaseVideoUrl(form.executionId) || execution?.videoUrl || '',
    quantityInputs: emptyQuantities(),
    selectedOptions: defaultSelectedOptions(form.platform)
  })
  reviewTouched.value = false
  reviewText.value = generatedReview.value
  toast('success', `已切到${phaseName}，可以填写本期申请量`)
}

function clearMaintenanceQuantities() {
  form.targetPlayWan = ''
  form.quantityInputs = emptyQuantities()
  reviewTouched.value = false
  reviewText.value = generatedReview.value
  toast('success', '已清空本期播放和互动数量')
}

async function exportCurrentPhase() {
  if (!canExportApplication.value) {
    toast('error', '请先从左侧选择账号，或新建未关联申请')
    return
  }
  if (normalizePlatform(form.platform) === 'douyin') {
    const missing = []
    if (!resolveDouyinIdForReview()) missing.push('抖音ID')
    if (!resolveCooperationCodeForReview()) missing.push('合作码')
    if (missing.length) {
      toast('error', `数据库未读取到${missing.join('、')}，请检查账号维护表后刷新`)
      return
    }
  }
  saving.value = true
  normalizeFormUrl()
  normalizeAllQuantityInputs()
  const exportText = generatedReview.value
  const playOption = selectedOption('play')
  const requestedPlay = quantityInputToRaw(form.quantityInputs.play, selectedQuantityUnit('play', playOption), 'play')
    || Math.round(toNumber(form.targetPlayWan) * 10000)
  let copied = false
  let copyError = null
  try {
    try {
      await copyTextToClipboard(exportText)
      copied = true
    } catch (error) {
      copyError = error
    }
    const payload = {
      id: form.id || `${form.executionId}-app-${normalize(form.phaseName)}`,
      executionId: form.executionId,
      projectId: form.projectId,
      projectName: form.projectName,
      accountName: form.accountName,
      accountGroup: form.accountGroup,
      platform: form.platform,
      douyinId: resolveDouyinIdForReview(),
      accountId: resolveAccountIdForReview(),
      cooperationCode: resolveCooperationCodeForReview(),
      orderType: form.orderType,
      phaseName: form.phaseName,
      phaseRatio: form.phaseRatio,
      videoUrl: form.videoUrl,
      targetPlay: requestedPlay,
      targetCpm: toNumber(form.targetCpm),
      originalPrice: toNumber(form.originalPrice),
      discountRate: toNumber(form.discountRate),
      discountedPrice: toNumber(form.discountedPrice),
      quantityInputs: { ...form.quantityInputs },
      selectedOptions: { ...form.selectedOptions },
      maintenanceCost: currentCost.value,
      exportedReviewText: exportText
    }
    const result = await saveTrafficPlanV2Application(payload)
    const exec = result.execution
    await refresh()
    selectedExecutionId.value = exec.executionId
    fillForm(state.executions.find(item => item.executionId === exec.executionId) || exec, { phaseName: payload.phaseName })
    if (copied) {
      toast('success', `${payload.phaseName}已复制到剪贴板，并已保存同步`)
    } else {
      toast('warn', `${payload.phaseName}已保存同步，但复制失败：${copyError?.message || copyError || '请手动复制文案'}`)
    }
  } catch (error) {
    toast('error', '导出失败：' + (error.message || error))
  } finally {
    saving.value = false
  }
}

function normalizeAllQuantityInputs() {
  serviceRows.value.forEach(service => normalizeQuantityInput(service.key))
}

async function copyTextToClipboard(text) {
  const value = String(text || '').trim()
  if (!value) throw new Error('没有可复制的审核文案')
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!ok) throw new Error('浏览器拒绝复制到剪贴板')
}

function buildReviewText() {
  const platform = normalizePlatform(form.platform)
  const line = service => ({
    option: selectedOption(service),
    quantity: form.quantityInputs[service]
  })
  const footer = '@姚琳琳(Lin.) @罗雪莲 @翁林湑(空白) 辛苦审核'
  const phase = form.phaseName || '本期'
  const playOption = selectedOption('play')
  const currentPlay = currentApplyPlay()
  const currentPlayLines = [
    `当前播放量：${formatWan(currentPlay)}`
  ]
  const common = [
    `标的：${form.projectName || '未填项目'}`,
    `账号：${form.accountName || '未填账号'}`,
    `订单类型：${orderTypeLabel(form.orderType)}`,
    `视频链接：${form.videoUrl || '待补'}`
  ]

  if (platform === 'bilibili') {
    return [
      '【B站】',
      ...common,
      `目标CPM：${formatReviewMoney(form.targetCpm)}`,
      `播放量（${formatBilibiliPlayChannel(playOption)}）：${formatReviewMetricValue('play', playOption, form.quantityInputs.play, platform)}`,
      ...currentPlayLines,
      `点赞：${formatReviewMetricValue('like', selectedOption('like'), form.quantityInputs.like, platform)}`,
      `投币：${formatReviewMetricValue('coin', selectedOption('coin'), form.quantityInputs.coin, platform)}`,
      `收藏：${formatReviewMetricValue('favorite', selectedOption('favorite'), form.quantityInputs.favorite, platform)}`,
      `评论：${formatReviewMetricValue('comment', selectedOption('comment'), form.quantityInputs.comment, platform)}`,
      `分享：${formatReviewMetricValue('share', selectedOption('share'), form.quantityInputs.share, platform)}`,
      `弹幕：${formatReviewMetricValue('danmaku', selectedOption('danmaku'), form.quantityInputs.danmaku, platform)}`,
      `蓝链点击：${formatReviewMetricValue('blueLink', selectedOption('blueLink'), form.quantityInputs.blueLink, platform)}`,
      `${phase}维护成本：${formatReviewMoney(currentCost.value)}元`,
      `累计维护成本：${formatReviewMoney(cumulativeCost.value)}元`,
      `维护后毛利率：${formatReviewPercent(grossMargin.value / 100)}`,
      `集团毛利：${formatReviewMoney(grossProfit.value)}元`,
      footer
    ].join('\n')
  }

  return [
    '【抖音】',
    ...common.slice(0, 3),
    `抖音ID：${resolveDouyinIdForReview()}`,
    `合作码：${resolveCooperationCodeForReview()}`,
    common[3],
    `目标CPM：${formatReviewMoney(form.targetCpm)}`,
    `播放量${formatReviewLabelSuffix(playOption)}：${formatReviewMetricValue('play', playOption, form.quantityInputs.play, platform)}`,
    ...currentPlayLines,
    `点赞${formatReviewLabelSuffix(selectedOption('like'))}：${formatReviewMetricValue('like', selectedOption('like'), form.quantityInputs.like, platform)}`,
    `评论${formatReviewLabelSuffix(selectedOption('comment'))}：${formatReviewMetricValue('comment', selectedOption('comment'), form.quantityInputs.comment, platform)}`,
    `收藏：${formatReviewMetricValue('favorite', selectedOption('favorite'), form.quantityInputs.favorite, platform)}`,
    `转发：${formatReviewMetricValue('share', selectedOption('share'), form.quantityInputs.share, platform)}`,
    `抖加：${formatReviewMetricValue('douPlus', selectedOption('douPlus'), form.quantityInputs.douPlus, platform)}`,
    `${phase}维护成本：${formatReviewMoney(currentCost.value)}元`,
    `累计维护成本：${formatReviewMoney(cumulativeCost.value)}元`,
    `维护后毛利率：${formatReviewPercent(grossMargin.value / 100)}`,
    `集团毛利：${formatReviewMoney(grossProfit.value)}元`,
    footer
  ].join('\n')
}

function buildCommentContextScript() {
  return ''
}

function formatReviewLabelSuffix(option) {
  const name = formatTypeOptionName(option?.name || '')
  return name ? `（${name}）` : ''
}

function orderTypeLabel(value) {
  return value === 'private' ? '私单' : '星图单'
}

function reviewRequiredValue(...values) {
  const value = values
    .map(item => String(item ?? '').trim())
    .find(item => item && item !== '待补' && item !== '/' && item !== '-')
  return value || ''
}

function reviewIdentityValue(...values) {
  const value = values
    .map(item => String(item ?? '').trim())
    .find(item => item && item !== '待补' && item !== '/' && item !== '-' && !isSuspiciousIdentityValue(item))
  return value || ''
}

function isSuspiciousIdentityValue(value) {
  const raw = String(value ?? '').trim()
  return /^\d{1,3}$/.test(raw)
}

function resolveDouyinIdForReview() {
  return resolveAccountIdentity(selectedExecution.value).douyinId
}

function resolveAccountIdForReview() {
  return resolveAccountIdentity(selectedExecution.value).accountId
}

function resolveCooperationCodeForReview() {
  return resolveAccountIdentity(selectedExecution.value).cooperationCode
}

function isQianchuanTechOption(option) {
  const raw = `${option?.id || ''} ${option?.name || ''}`
  return /tech|hkj|黑科技|无视版|千川无视/i.test(raw)
}

function currentApplyPlay() {
  return Math.round(toNumber(selectedExecution.value?.currentMetrics?.play))
}

function applyPlayGap() {
  const requested = quantityInputToRaw(form.quantityInputs.play, selectedQuantityUnit('play', selectedOption('play')), 'play')
  const target = requested || Math.round(toNumber(form.targetPlayWan) * 10000) || toNumber(selectedExecution.value?.targetMetrics?.play)
  const current = currentApplyPlay()
  return Math.max(0, Math.round(toNumber(target) - current))
}

function formatTypeOptionName(name) {
  return String(name || '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
}

function formatBilibiliPlayChannel(option) {
  if (!option?.id) return '正常通道'
  return String(option.id).includes('fast') ? '快速通道' : '正常通道'
}

function formatReviewMetricValue(service, option, quantity, platform) {
  const unit = canonicalQuantityUnit(option?.quantityUnit, service)
  const raw = quantityInputToRaw(quantity, unit, service)
  if (!raw) return '/'
  if (service === 'douPlus') return `${formatReviewMoney(raw)}元`
  if (unit === '万') return `${formatThreshold(raw / 10000)}${platform === 'bilibili' ? 'W' : '万'}`
  return formatReviewNumber(raw)
}

function formatThreshold(value) {
  const number = toNumber(value)
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(6)))
}

function formatReviewNumber(value) {
  const number = toNumber(value)
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)))
}

function formatReviewMoney(value) {
  const number = toNumber(value)
  return Math.abs(number - Math.round(number)) < 0.000001 ? String(Math.round(number)) : number.toFixed(2)
}

function formatReviewPercent(value) {
  return `${(toNumber(value) * 100).toFixed(1)}%`
}

function syncDiscountPrice() {
  const original = toNumber(form.originalPrice)
  const rate = toNumber(form.discountRate)
  if (original && rate) form.discountedPrice = stripZeros((original * rate / 100).toFixed(2))
}

function syncTargetPlay() {
  const price = toNumber(form.discountedPrice)
  const cpm = toNumber(form.targetCpm)
  const original = toNumber(form.originalPrice)
  if (price && original) form.discountRate = stripZeros((price / original * 100).toFixed(2))
  if (form.useAccountStandard && currentAccountStandard.value) {
    applyAccountStandard(null, { quiet: true, forcePrices: false, allowGeneric: false })
    return
  }
  if (price && cpm) {
    const rawPlay = Math.round(price / cpm * 1000)
    applyPlayAmount(phaseAdjustedPlay(rawPlay), { keepExisting: false })
  }
}

function setTargetCpm(value) {
  form.targetCpm = stripZeros(String(toNumber(value)))
  syncTargetPlay()
}

function isTargetCpmActive(value) {
  return Math.abs(toNumber(form.targetCpm) - toNumber(value)) < 0.001
}

function normalizeFormUrl() {
  form.videoUrl = extractUrl(form.videoUrl)
}

function switchApplyPlatform(platform) {
  const nextPlatform = normalizePlatform(platform)
  if (normalizePlatform(form.platform) === nextPlatform) return
  selectedExecutionId.value = ''
  const executionId = 'manual-' + Date.now().toString(36)
  form.platform = nextPlatform
  form.orderType = 'xingtu'
  form.id = ''
  form.projectId = 'unlinked-project'
  form.projectName = '未关联项目'
  form.executionId = executionId
  form.accountName = ''
  form.videoUrl = ''
  form.useAccountStandard = false
  form.targetPlayWan = ''
  form.originalPrice = ''
  form.discountRate = ''
  form.discountedPrice = ''
  form.phaseName = '一期'
  form.phaseRatio = '100'
  form.quantityInputs = emptyQuantities()
  form.selectedOptions = defaultSelectedOptions(nextPlatform)
  form.targetCpm = String(defaultTargetCpm(nextPlatform))
  reviewTouched.value = false
  reviewText.value = generatedReview.value
}

function phaseAdjustedPlay(rawPlay) {
  const play = Math.round(toNumber(rawPlay))
  const ratio = toNumber(form.phaseRatio) || 100
  return play ? Math.round(play * ratio / 100) : 0
}

function applyPlayAmount(rawPlay, options = {}) {
  const play = normalizeMetricRaw('play', rawPlay)
  form.targetPlayWan = play ? stripZeros(String(play / 10000)) : ''
  form.quantityInputs.play = rawMetricToInput('play', play)
  const standard = options.accountStandard || (form.useAccountStandard ? findAccountStandard(form.accountName, form.platform) : null)
  if (standard && options.useAccountStandard !== false) fillAccountStandardByPlay(standard, play, options)
  else fillGenericPresetByPlay(play, options)
}

function applyPhaseRatio() {
  if (form.useAccountStandard && currentAccountStandard.value) {
    applyAccountStandard(null, { quiet: true })
    reviewTouched.value = false
    reviewText.value = generatedReview.value
    return
  }
  const basePlay = toNumber(selectedExecution.value?.targetMetrics?.play)
    || Math.round(toNumber(form.discountedPrice) && toNumber(form.targetCpm) ? toNumber(form.discountedPrice) / toNumber(form.targetCpm) * 1000 : 0)
    || Math.round(toNumber(form.targetPlayWan) * 10000)
  const play = phaseAdjustedPlay(basePlay)
  if (!play) return
  applyPlayAmount(play, { keepExisting: false })
}

function handleTargetPlayInput() {
  const play = Math.round(toNumber(form.targetPlayWan) * 10000)
  const standard = findAccountStandard(form.accountName, form.platform)
  if (form.useAccountStandard && standard) {
    const standardPlay = phaseAdjustedPlay(toNumber(standard.metrics?.play))
    if (Math.abs(play - standardPlay) > 1) form.useAccountStandard = false
  }
  form.quantityInputs.play = rawMetricToInput('play', play)
  if (form.useAccountStandard && standard) fillAccountStandardByPlay(standard, play, { keepExisting: false })
  else fillGenericPresetByPlay(play, { keepExisting: false })
}

function handleTargetCpmInput() {
  const standard = currentAccountStandard.value
  if (form.useAccountStandard && standard && Math.abs(toNumber(form.targetCpm) - toNumber(standard.targetCpm)) > 0.001) {
    form.useAccountStandard = false
  }
  syncTargetPlay()
}

function applyGenericPresetFromRail(cpm) {
  setTargetCpm(cpm)
  fillGenericPresetByPlay(Math.round(toNumber(form.targetPlayWan) * 10000), { keepExisting: false })
}

function optionsFor(service) {
  return (priceTable.value.items || []).filter(item => item.service === service)
}

function selectedOption(service) {
  return optionsFor(service).find(option => option.id === form.selectedOptions[service]) || optionsFor(service)[0] || null
}

function defaultSelectedOptions(platform) {
  const table = state.priceTables.find(item => item.platform === normalizePlatform(platform)) || state.priceTables[0] || { items: [] }
  return Object.fromEntries(['play', 'like', 'comment', 'favorite', 'share', 'douPlus', 'danmaku', 'coin', 'blueLink'].map(key => {
    const option = table.items.find(item => item.service === key)
    return [key, option?.id || '']
  }))
}

function findAccountStandard(accountName, platform) {
  const accountKey = normalize(accountName)
  if (!accountKey) return null
  const platformKey = normalizePlatform(platform)
  const rows = state.accountStandards.filter(standard => normalizePlatform(standard.platform) === platformKey)
  return rows.find(standard => normalize(standard.accountName) === accountKey)
    || rows.find(standard => accountKey.includes(normalize(standard.accountName)) || normalize(standard.accountName).includes(accountKey))
    || null
}

function findExactAccountStandard(accountName, platform) {
  const accountKey = normalize(accountName)
  if (!accountKey) return null
  const platformKey = normalizePlatform(platform)
  return state.accountStandards.find(standard => normalizePlatform(standard.platform) === platformKey && normalize(standard.accountName) === accountKey) || null
}

function applyExactAccountStandardForManual() {
  if (form.executionId && !String(form.executionId).startsWith('manual-')) return
  const standard = findExactAccountStandard(form.accountName, form.platform)
  if (!standard) return
  form.useAccountStandard = true
  applyAccountStandard(null, { quiet: true, forcePrices: false, allowGeneric: false })
  reviewTouched.value = false
  reviewText.value = generatedReview.value
}

function applyCurrentAccountStandard() {
  form.useAccountStandard = true
  applyAccountStandard(null, { quiet: false, forcePrices: false, allowGeneric: false })
}

function handleAccountStandardToggle() {
  if (!form.useAccountStandard) {
    reviewTouched.value = false
    reviewText.value = generatedReview.value
    return
  }
  const standard = currentAccountStandard.value
  if (!standard) {
    form.useAccountStandard = false
    toast('error', '没有找到这个账号的维护预设')
    return
  }
  applyAccountStandard(null, { quiet: false, forcePrices: false, allowGeneric: false })
}

function applyFirstBlackTechPreset() {
  form.phaseName = '一期'
  form.phaseRatio = '100'
  form.targetPlayWan = '5'
  form.quantityInputs = {
    ...emptyQuantities(),
    play: rawMetricToInput('play', 50000),
    like: rawMetricToInput('like', 1000)
  }
  form.selectedOptions = { ...defaultSelectedOptions(form.platform), ...form.selectedOptions }
  reviewTouched.value = false
  reviewText.value = generatedReview.value
  toast('success', '已套用首期黑科技维护：5w播放 / 1k点赞')
}

function applyAccountStandard(execution, options = {}) {
  const standard = findAccountStandard(execution?.accountName || form.accountName, execution?.platform || form.platform)
  if (!standard) {
    if (options.allowGeneric !== false) {
      syncTargetPlay()
      fillGenericPresetByPlay(Math.round(toNumber(form.targetPlayWan) * 10000), { keepExisting: false })
      if (!options.quiet) toast('success', '已套用通用维护预设')
      return
    }
    if (!options.quiet) toast('error', '没有找到这个账号的维护预设')
    return
  }
  const metrics = standard.metrics || {}
  if (!toNumber(standard.targetCpm) || !toNumber(metrics.play)) {
    if (!options.quiet) toast('error', `「${standard.accountName}」维护标准缺少 CPM 或播放量，请先检查维护标准表`)
    return
  }
  const identity = resolveAccountIdentity(execution)
  form.douyinId = identity.douyinId
  form.accountId = identity.accountId
  form.cooperationCode = identity.cooperationCode
  form.targetCpm = String(standard.targetCpm)
  if ((!form.originalPrice || options.forcePrices) && (standard.originalPrice || standard.quotePrice)) {
    form.originalPrice = String(standard.originalPrice || standard.quotePrice)
  }
  if ((!form.discountedPrice || options.forcePrices) && standard.discountedPrice) form.discountedPrice = String(standard.discountedPrice)
  if (toNumber(form.originalPrice) && toNumber(form.discountedPrice)) {
    form.discountRate = stripZeros((toNumber(form.discountedPrice) / toNumber(form.originalPrice) * 100).toFixed(2))
  }
  applyPlayAmount(phaseAdjustedPlay(toNumber(metrics.play)), { accountStandard: standard, keepExisting: false })
  if (!options.quiet) toast('success', `已套用「${standard.accountName}」维护预设`)
}

function fillAccountStandardByPlay(standard, rawPlay, options = {}) {
  const metrics = standard?.metrics || {}
  const basePlay = toNumber(metrics.play)
  const play = normalizeMetricRaw('play', rawPlay || basePlay)
  const ratio = basePlay && play ? play / basePlay : 1
  const platform = normalizePlatform(standard?.platform || form.platform)
  Object.keys(metrics).forEach(key => {
    if (key === 'play') return
    if (options.keepExisting && toNumber(form.quantityInputs[key])) return
    const rawValue = platform === 'douyin' && key === 'like'
      ? douyinAutoLike(play)
      : toNumber(metrics[key]) * ratio
    form.quantityInputs[key] = rawMetricToInput(key, rawValue)
  })
}

function fillGenericPresetByPlay(rawPlay, options = {}) {
  const play = Math.round(toNumber(rawPlay))
  if (!play) return
  const metrics = genericPresetMetrics(play)
  Object.entries(metrics).forEach(([key, value]) => {
    if (key === 'play') return
    if (options.keepExisting && toNumber(form.quantityInputs[key])) return
    form.quantityInputs[key] = rawMetricToInput(key, value)
  })
}

function genericPresetMetrics(play) {
  const rawPlay = normalizeMetricRaw('play', play)
  if (normalizePlatform(form.platform) === 'bilibili') {
    return {
      play: rawPlay,
      like: normalizeMetricRaw('like', rawPlay * 0.03),
      comment: normalizeMetricRaw('comment', rawPlay * 0.001),
      favorite: normalizeMetricRaw('favorite', rawPlay * 0.01),
      share: normalizeMetricRaw('share', rawPlay * 0.005),
      danmaku: normalizeMetricRaw('danmaku', rawPlay * 0.002),
      coin: normalizeMetricRaw('coin', rawPlay * 0.005),
      blueLink: normalizeMetricRaw('blueLink', rawPlay * 0.001)
    }
  }
  const like = douyinAutoLike(rawPlay)
  const highEngagementPack = rawPlay >= 180000
  return {
    play: rawPlay,
    like,
    comment: highEngagementPack ? 200 : 100,
    favorite: highEngagementPack ? 300 : 200,
    share: highEngagementPack ? 200 : 100,
    douPlus: 0
  }
}

function douyinAutoLike(rawPlay) {
  const play = toNumber(rawPlay)
  if (!play) return 0
  return Math.max(3000, normalizeMetricRaw('like', play * 0.075))
}

function roundUpStep(value, step) {
  const number = toNumber(value)
  const size = toNumber(step) || 1
  if (!number) return 0
  return Math.ceil(number / size) * size
}

function metricStep(service) {
  if (service === 'play') return 10000
  if (service === 'like') return 1000
  if (service === 'douPlus') return 1
  return 50
}

function normalizeMetricRaw(service, rawValue) {
  const raw = Math.max(0, toNumber(rawValue))
  if (!raw) return 0
  return roundUpStep(raw, metricStep(service))
}

function rawMetricToInput(service, rawValue) {
  const raw = service === 'like' ? Math.max(0, toNumber(rawValue)) : normalizeMetricRaw(service, rawValue)
  const unit = selectedQuantityUnit(service)
  if (unit === '万') return stripZeros(String(raw / 10000))
  if (unit === '千') return stripZeros(String(raw / 1000))
  return raw ? (service === 'like' ? stripZeros(String(Number(raw.toFixed(6)))) : String(Math.round(raw))) : ''
}

function resetSettingsEditor() {
  settingsDraft.priceTables = cloneSettingsValue(state.priceTables).map(table => ({
    platform: normalizePlatform(table.platform),
    items: Array.isArray(table.items) ? table.items.map(item => ({
      id: item.id || makePriceRowId(table.platform, item.service),
      service: item.service || 'play',
      name: item.name || '',
      unitPrice: item.unitPrice ?? '',
      quantityUnit: item.quantityUnit || '个',
      minimumQuantity: item.minimumQuantity ?? '',
      priceTiers: Array.isArray(item.priceTiers) ? item.priceTiers.map(tier => ({ ...tier })) : []
    })) : []
  }))
  settingsDraft.presets = cloneSettingsValue(state.presets).map(preset => ({
    id: preset.id || `preset-${Date.now().toString(36)}`,
    platform: normalizePlatform(preset.platform),
    name: preset.name || '',
    targetCpm: preset.targetCpm ?? '',
    quantities: { ...(preset.quantities || {}) }
  }))
  settingsDraft.accountStandards = cloneSettingsValue(state.accountStandards).map((standard, index) => ({
    id: standard.id || `standard-${index}-${Date.now().toString(36)}`,
    platform: normalizePlatform(standard.platform),
    accountName: standard.accountName || '',
    fansWan: standard.fansWan ?? '',
    xingtuId: standard.xingtuId || '',
    douyinId: standard.douyinId || '',
    accountId: standard.accountId || '',
    uid: standard.uid || '',
    cooperationCode: standard.cooperationCode || '',
    originalPrice: standard.originalPrice ?? '',
    quotePrice: standard.quotePrice ?? '',
    longOriginalPrice: standard.longOriginalPrice ?? '',
    longQuotePrice: standard.longQuotePrice ?? standard.customQuotePrice ?? '',
    customOriginalPrice: standard.customOriginalPrice ?? '',
    customQuotePrice: standard.customQuotePrice ?? '',
    homepageUrl: standard.homepageUrl || '',
    discountLabel: standard.discountLabel || '',
    discountedPrice: standard.discountedPrice ?? '',
    targetCpm: standard.targetCpm ?? '',
    metrics: { ...(standard.metrics || {}) },
    source: standard.source || 'manual'
  }))
  if (!settingsDraft.priceTables.some(table => table.platform === settingsPlatform.value)) {
    settingsPlatform.value = settingsDraft.priceTables[0]?.platform || 'douyin'
  }
}

async function saveSettingsEditor() {
  settingsSaving.value = true
  try {
    const payload = {
      priceTables: settingsDraft.priceTables.map(table => ({
        platform: normalizePlatform(table.platform),
        items: (table.items || []).map(item => ({
          id: item.id || makePriceRowId(table.platform, item.service),
          service: item.service || 'play',
          name: item.name || '',
          unitPrice: toNumber(item.unitPrice),
          quantityUnit: item.quantityUnit || '个',
          minimumQuantity: item.minimumQuantity === '' || item.minimumQuantity === null || item.minimumQuantity === undefined ? undefined : toNumber(item.minimumQuantity),
          priceTiers: Array.isArray(item.priceTiers) ? item.priceTiers.map(tier => ({
            min: toNumber(tier.min ?? tier.from),
            max: tier.max === '' || tier.max === null || tier.max === undefined ? undefined : toNumber(tier.max ?? tier.to),
            unitPrice: toNumber(tier.unitPrice)
          })).filter(tier => tier.unitPrice) : []
        }))
      })),
      presets: settingsDraft.presets.map(preset => ({
        id: preset.id || `preset-${Date.now().toString(36)}`,
        platform: normalizePlatform(preset.platform),
        name: preset.name || '',
        targetCpm: toNumber(preset.targetCpm),
        quantities: Object.fromEntries(Object.entries(preset.quantities || {}).map(([key, value]) => [key, toNumber(value)]))
      })),
      accountStandards: settingsDraft.accountStandards.map(standard => ({
        id: standard.id || `standard-${Date.now().toString(36)}`,
        platform: normalizePlatform(standard.platform),
        accountName: standard.accountName || '',
        fansWan: toNumber(standard.fansWan),
        xingtuId: standard.xingtuId || '',
        douyinId: standard.douyinId || '',
        accountId: standard.accountId || '',
        uid: standard.uid || '',
        cooperationCode: standard.cooperationCode || '',
        originalPrice: toNumber(standard.originalPrice),
        quotePrice: toNumber(standard.quotePrice),
        longOriginalPrice: toNumber(standard.longOriginalPrice),
        longQuotePrice: toNumber(standard.longQuotePrice),
        customOriginalPrice: toNumber(standard.customOriginalPrice),
        customQuotePrice: toNumber(standard.customQuotePrice),
        homepageUrl: standard.homepageUrl || '',
        discountLabel: standard.discountLabel || '',
        discountedPrice: toNumber(standard.discountedPrice),
        targetCpm: toNumber(standard.targetCpm),
        metrics: Object.fromEntries(Object.entries(standard.metrics || {}).map(([key, value]) => [key, toNumber(value)])),
        source: standard.source || 'manual'
      }))
    }
    const data = await saveTrafficPlanV2Settings(payload)
    if (Array.isArray(data.priceTables)) state.priceTables = data.priceTables
    if (Array.isArray(data.presets)) state.presets = data.presets
    if (Array.isArray(data.accountStandards)) state.accountStandards = data.accountStandards
    resetSettingsEditor()
    toast('success', '价格表和预设已保存')
  } catch (error) {
    toast('error', '配置保存失败：' + (error.message || error))
  } finally {
    settingsSaving.value = false
  }
}

function cloneSettingsValue(value) {
  try {
    return JSON.parse(JSON.stringify(value || []))
  } catch (error) {
    return []
  }
}

function settingsServiceOptions(platform) {
  return (SETTINGS_SERVICE_OPTIONS[normalizePlatform(platform)] || SETTINGS_SERVICE_OPTIONS.douyin).map(([key, label]) => ({ key, label }))
}

function makePriceRowId(platform, service) {
  return `${normalizePlatform(platform)}-${service || 'service'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function addPriceRow(table) {
  if (!table) return
  table.items.push({
    id: makePriceRowId(table.platform, 'play'),
    service: 'play',
    name: '新通道',
    unitPrice: '',
    quantityUnit: '万',
    minimumQuantity: ''
  })
}

function removePriceRow(table, id) {
  if (!table) return
  table.items = (table.items || []).filter(item => item.id !== id)
}

function addPresetRow() {
  const platform = settingsPlatform.value || 'douyin'
  settingsDraft.presets.push({
    id: `preset-${Date.now().toString(36)}`,
    platform,
    name: `${platformLabel(platform)}预设`,
    targetCpm: defaultTargetCpm(platform),
    quantities: Object.fromEntries(settingsServiceOptions(platform).map(service => [service.key, '']))
  })
}

function removePresetRow(id) {
  settingsDraft.presets = settingsDraft.presets.filter(preset => preset.id !== id)
}

function addStandardRow() {
  const platform = settingsPlatform.value || 'douyin'
  settingsDraft.accountStandards.unshift({
    id: `standard-${Date.now().toString(36)}`,
    platform,
    accountName: '',
    fansWan: '',
    quotePrice: '',
    longQuotePrice: '',
    discountLabel: '',
    discountedPrice: '',
    targetCpm: platform === 'bilibili' ? 150 : 30,
    metrics: Object.fromEntries(settingsServiceOptions(platform).map(service => [service.key, ''])),
    source: 'manual'
  })
}

function removeStandardRow(id) {
  settingsDraft.accountStandards = settingsDraft.accountStandards.filter(standard => standard.id !== id)
}

function lineCost(service) {
  const option = selectedOption(service)
  const unit = selectedQuantityUnit(service, option)
  const raw = quantityInputToRaw(form.quantityInputs[service], unit, service)
  const quantity = rawToBillableAmount(raw, unit)
  return quantity * effectiveUnitPrice(option, quantity)
}

function effectiveUnitPrice(option, billableQuantity) {
  const tiers = Array.isArray(option?.priceTiers) ? option.priceTiers : []
  const quantity = toNumber(billableQuantity)
  if (tiers.length && quantity) {
    const matched = tiers.find(tier => {
      const min = toNumber(tier.min ?? tier.from)
      const max = toNumber(tier.max ?? tier.to)
      return quantity >= min && (!max || quantity <= max)
    })
    if (matched) return toNumber(matched.unitPrice)
    const fallback = [...tiers]
      .sort((a, b) => toNumber(b.min ?? b.from) - toNumber(a.min ?? a.from))
      .find(tier => quantity >= toNumber(tier.min ?? tier.from))
    if (fallback) return toNumber(fallback.unitPrice)
  }
  return toNumber(option?.unitPrice)
}

function normalizeQuantityInput(service) {
  const option = selectedOption(service)
  const raw = quantityInputToRaw(form.quantityInputs[service], selectedQuantityUnit(service, option), service)
  form.quantityInputs[service] = rawMetricToInput(service, raw)
  if (service === 'play') form.targetPlayWan = raw ? stripZeros(String(raw / 10000)) : ''
  reviewTouched.value = false
  reviewText.value = generatedReview.value
}

function canonicalQuantityUnit(quantityUnit, service = '') {
  const unit = String(quantityUnit || '').trim()
  if (/万|w/i.test(unit)) return '万'
  if (/千|k/i.test(unit)) return '千'
  if (/元|¥|rmb/i.test(unit) || service === 'douPlus') return '元'
  if (/个/.test(unit)) return '个'
  if (service === 'play') return '万'
  if (service === 'like') return '千'
  return '个'
}

function selectedQuantityUnit(service, option = selectedOption(service)) {
  return canonicalQuantityUnit(option?.quantityUnit, service)
}

function parseQuantityInput(quantity) {
  if (typeof quantity === 'number') return { amount: Number.isFinite(quantity) ? quantity : 0, suffix: '' }
  const normalized = String(quantity || '').trim().replace(/,/g, '')
  if (!normalized) return { amount: 0, suffix: '' }
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([wWkK万千个元]?)$/)
  if (!match) return { amount: toNumber(normalized), suffix: '' }
  return { amount: Number(match[1]) || 0, suffix: match[2] || '' }
}

function quantityInputToRaw(quantity, quantityUnit, service = '') {
  const { amount, suffix } = parseQuantityInput(quantity)
  if (!amount) return 0
  if (/[wW万]/.test(suffix)) return amount * 10000
  if (/[kK千]/.test(suffix)) return amount * 1000
  const unit = canonicalQuantityUnit(quantityUnit, service)
  if (unit === '万') return amount * 10000
  if (unit === '千') return amount * 1000
  return amount
}

function rawToBillableAmount(rawValue, quantityUnit) {
  const raw = toNumber(rawValue)
  if (!raw) return 0
  const unit = canonicalQuantityUnit(quantityUnit)
  if (unit === '万') return raw / 10000
  if (unit === '千') return raw / 1000
  return raw
}

function quantityHint(service) {
  return `单位：${selectedQuantityUnit(service)}`
}

function metricList(execution) {
  const keys = normalizePlatform(execution.platform) === 'bilibili'
    ? [['danmaku', '弹幕'], ['comment', '评论'], ['like', '点赞'], ['favorite', '收藏'], ['coin', '投币'], ['share', '分享'], ['blueLink', '蓝链点击']]
    : [['like', '点赞'], ['comment', '评论'], ['favorite', '收藏'], ['share', '转发']]
  return keys.map(([key, label]) => {
    const actual = toNumber(execution.currentMetrics?.[key])
    const planned = toNumber(execution.appliedMetrics?.[key])
    const target = toNumber(execution.targetMetrics?.[key])
    const base = planned || target || actual
    const progressValue = base ? Math.max(0, Math.min(100, actual / base * 100)) : 0
    const plannedPct = base ? Math.max(0, Math.min(100, planned / base * 100)) : 0
    const actualPct = base ? Math.max(0, Math.min(100, actual / base * 100)) : 0
    const natural = !planned && actual > 0
    return {
      key,
      label,
      icon: label,
      actual,
      planned,
      target,
      progress: progressValue,
      plannedPct: natural ? 0 : plannedPct,
      actualPct: natural ? 100 : actualPct,
      natural,
      tone: planned ? (progressValue >= 100 ? 'done' : progressValue >= 45 ? 'running' : 'warn') : (natural ? 'done' : 'idle')
    }
  })
}

function projectMetricList(project) {
  return metricList(project).map(metric => ({ ...metric, label: `总${metric.label}` }))
}

function metricByKey(execution, key) {
  return metricList(execution).find(metric => metric.key === key) || {
    key,
    label: key === 'like' ? '点赞' : key,
    actual: 0,
    planned: 0,
    target: 0,
    progress: 0,
    plannedPct: 0,
    actualPct: 0,
    natural: false,
    tone: 'idle'
  }
}

function secondaryMetricList(execution) {
  return metricList(execution).filter(metric => metric.key !== 'like')
}

function nextPhaseFor(execution) {
  const records = state.applications.filter(record => record.executionId === execution.executionId)
  const nums = records.map(record => phaseNumber(record.phaseName)).filter(Boolean)
  const used = new Set(nums)
  for (let index = 1; index <= 5; index += 1) {
    if (!used.has(index)) return ['一期', '二期', '三期', '四期', '五期'][index - 1]
  }
  const max = Math.max(0, ...nums)
  return `第${max + 1}期`
}

function executionApplicationCount(execution) {
  return state.applications.filter(record => record.executionId === execution.executionId).length
}

function nextPhaseName(phaseName) {
  const current = phaseNumber(phaseName)
  return ['一期', '二期', '三期', '四期', '五期'][current] || `第${current + 1}期`
}

function phaseNumber(phaseName) {
  const raw = String(phaseName || '')
  if (/一|1/.test(raw)) return 1
  if (/二|2/.test(raw)) return 2
  if (/三|3/.test(raw)) return 3
  if (/四|4/.test(raw)) return 4
  if (/五|5/.test(raw)) return 5
  const match = raw.match(/\d+/)
  return match ? Number(match[0]) : 0
}

function executionState(execution) {
  const target = toNumber(execution.targetMetrics?.play)
  const actual = toNumber(execution.currentMetrics?.play)
  const applied = toNumber(execution.appliedMetrics?.play)
  if (target && actual >= target) return { key: 'done', label: '已完成' }
  const focus = focusState(execution)
  if (focus.level === 'danger') return { key: 'warn', label: '需关注' }
  if (focus.level === 'warn') return { key: 'warn', label: '需关注' }
  if (applied > 0 && actual < applied * 0.4) return { key: 'warn', label: '需关注' }
  if (applied > 0) return { key: 'running', label: '投放中' }
  return { key: 'pending', label: '待投流' }
}

function projectRiskState(project) {
  const rows = project?.executions || []
  const status = rows.reduce((out, execution) => {
    const key = executionState(execution).key
    out[key] = (out[key] || 0) + 1
    return out
  }, {})
  const target = toNumber(project?.targetMetrics?.play)
  const applied = toNumber(project?.appliedMetrics?.play)
  const actual = toNumber(project?.currentMetrics?.play)
  if (status.warn > 0) return { key: 'warn', label: `${status.warn} 个需关注` }
  if (target && actual >= target) return { key: 'done', label: '项目达标' }
  if (applied > 0 && actual < applied * 0.4) return { key: 'warn', label: '投后偏慢' }
  if (applied > 0) return { key: 'running', label: '投放跟进中' }
  return { key: 'pending', label: '待投流' }
}

function isArchivedProject(project) {
  return normalize(project?.status || project?.projectStatus || project?.archivedStatus) === 'archived'
}

function projectStatusText(project) {
  if (isArchivedProject(project)) return '已归档'
  const target = toNumber(project?.targetMetrics?.play)
  const actual = toNumber(project?.currentMetrics?.play)
  const applied = toNumber(project?.appliedMetrics?.play)
  if (!target) return '未设置目标'
  if (actual >= target) return '已达标'
  if (applied > 0) return `差 ${formatWan(Math.max(0, target - actual))}`
  return `播放差额 ${formatWan(Math.max(0, target - applied))}`
}

function projectScheduleText(project) {
  const dates = [
    project?.scheduleDate,
    ...(project?.executions || []).map(execution => execution.scheduleDate)
  ].filter(Boolean)
  const unique = Array.from(new Set(dates)).sort()
  if (!unique.length) return '未填'
  if (unique.length === 1) return displayScheduleDate(unique[0])
  return `${displayScheduleDate(unique[0])} - ${displayScheduleDate(unique[unique.length - 1])}`
}

function projectScheduleSummary(project) {
  const dates = [
    project?.scheduleDate,
    ...(project?.executions || []).map(execution => execution.scheduleDate)
  ].filter(Boolean)
  const unique = Array.from(new Set(dates)).sort()
  if (!unique.length) return '未填档期'
  if (unique.length === 1) return displayScheduleDate(unique[0])
  return `${displayScheduleDate(unique[0])} 等${unique.length}档`
}

function displayScheduleDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return '未填档期'
  const match = raw.match(/(?:\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (match) return `${Number(match[1])}月${Number(match[2])}日`
  const shortMatch = raw.match(/(^|[^\d])(\d{1,2})[-/.月](\d{1,2})/)
  if (shortMatch) return `${Number(shortMatch[2])}月${Number(shortMatch[3])}日`
  return raw
}

function displayCrmTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const match = raw.match(/(?:\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:[日T\s]+(\d{1,2}):(\d{1,2}))?/)
  if (match) {
    const time = match[3] ? ` ${String(Number(match[3])).padStart(2, '0')}:${String(Number(match[4])).padStart(2, '0')}` : ''
    return `${Number(match[1])}月${Number(match[2])}日${time}`
  }
  return raw
}

function displayCrmTimeParts(value) {
  const raw = String(value || '').trim()
  if (!raw) return { date: '', time: '' }
  const match = raw.match(/(?:\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:[日T\s]+(\d{1,2}):(\d{1,2}))?/)
  if (match) {
    return {
      date: `${Number(match[1])}月${Number(match[2])}日`,
      time: match[3] ? `${String(Number(match[3])).padStart(2, '0')}:${String(Number(match[4])).padStart(2, '0')}` : ''
    }
  }
  const parts = raw.split(/\s+/)
  return { date: parts[0] || raw, time: parts.slice(1).join(' ') }
}

function executionCrmTimeText(execution) {
  return displayCrmTime(execution?.crmUpdatedAt)
}

function executionCrmTimeParts(execution) {
  return displayCrmTimeParts(execution?.crmUpdatedAt)
}

function executionCrmFollowClosed(execution) {
  const status = String(execution?.crmFollowStatus || '').trim()
  return /关|关闭|已关闭|closed|off/i.test(status)
}

function executionCrmMetaVisible(execution) {
  return executionCrmFollowClosed(execution) || Boolean(executionCrmTimeText(execution))
}

function progress(actual, target) {
  const t = toNumber(target)
  if (!t) return 0
  return Math.max(0, Math.min(100, toNumber(actual) / t * 100))
}

function ratioWidth(actual, target) {
  const base = toNumber(target)
  if (!base) return 0
  return Math.max(0, Math.min(100, toNumber(actual) / base * 100))
}

function packageCpm(project) {
  const actual = toNumber(project.currentMetrics?.play)
  return actual ? projectBudget(project) / actual * 1000 : 0
}

function projectCpmHealthPercent(project) {
  const actual = packageCpm(project)
  const target = projectTargetCpm(project)
  if (!actual || !target) return 0
  return Math.max(0, Math.min(100, target / actual * 100))
}

function projectBudget(project) {
  return (project?.executions || []).reduce((sum, execution) => sum + toNumber(execution.discountedPrice), 0) || toNumber(project?.totalAmount)
}

function projectOriginalBudget(project) {
  return (project?.executions || []).reduce((sum, execution) => sum + toNumber(execution.originalPrice || execution.discountedPrice), 0)
    || toNumber(project?.originalAmount || project?.originalPrice || project?.totalAmount)
}

function projectAccountCountText(project) {
  const visibleCount = project?.executions?.length || 0
  const source = state.projects.find(item => item.projectId === project?.projectId)
  const totalCount = source?.executions?.length || visibleCount
  if (monitorViewMode.value === 'group' && totalCount && totalCount !== visibleCount) return `${visibleCount}/${totalCount} 账号`
  return `${visibleCount} 账号`
}

function projectTargetCpm(project) {
  const target = toNumber(project?.targetMetrics?.play)
  const budget = projectBudget(project)
  return target ? budget / target * 1000 : toNumber(project?.targetCpm)
}

function projectGrossMargin(project) {
  const discountedBudget = projectBudget(project)
  const baseBudget = projectOriginalBudget(project)
  if (!baseBudget) return 0
  return (discountedBudget - toNumber(project?.maintenanceCost)) / baseBudget * 100
}

function projectPhaseOneApplied(project) {
  const records = Array.isArray(project?.records) ? project.records : []
  const phaseOne = records.filter(record => phaseNumber(record.phaseName) === 1)
  if (phaseOne.length) {
    return phaseOne.reduce((sum, record) => sum + toNumber(record.targetMetrics?.play || record.targetPlay), 0)
  }
  return toNumber(project?.appliedMetrics?.play)
}

function projectPhaseOneProgress(project) {
  return progress(projectPhaseOneApplied(project), project?.targetMetrics?.play)
}

function ringStyle(percent) {
  return { '--pct': `${Math.max(0, Math.min(100, toNumber(percent)))}%` }
}

function executionCpm(execution) {
  const actual = toNumber(execution?.currentMetrics?.play)
  const cost = toNumber(execution?.maintenanceCost)
  return actual ? cost / actual * 1000 : 0
}

function selectProjectExecution(item) {
  selectedProjectId.value = item.project.projectId
  selectedExecutionId.value = item.execution.executionId
}

function focusState(execution) {
  const applied = toNumber(execution?.appliedMetrics?.play)
  const actual = toNumber(execution?.currentMetrics?.play)
  if (!applied || actual >= applied) return { level: '', label: '', reason: '' }
  const scheduleDate = parseLocalDate(execution?.scheduleDate)
  if (!scheduleDate) return { level: '', label: '', reason: '' }
  const today = startOfToday()
  const ratio = applied ? actual / applied : 1
  if (scheduleDate < today) {
    return {
      level: 'danger',
      label: '逾期',
      reason: `差 ${formatWan(Math.max(0, applied - actual))}`
    }
  }
  if (sameDay(scheduleDate, today) && ratio < 1) {
    return {
      level: ratio < 0.45 ? 'danger' : 'warn',
      label: ratio < 0.45 ? '重点' : '关注',
      reason: `今日差 ${formatWan(Math.max(0, applied - actual))}`
    }
  }
  return { level: '', label: '', reason: '' }
}

function parseLocalDate(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function projectAccent(project) {
  const palette = [
    ['#0f766e', 'rgba(15, 118, 110, .11)'],
    ['#059669', 'rgba(5, 150, 105, .12)'],
    ['#d97706', 'rgba(217, 119, 6, .13)'],
    ['#dc2626', 'rgba(220, 38, 38, .11)'],
    ['#0891b2', 'rgba(8, 145, 178, .12)'],
    ['#be123c', 'rgba(190, 18, 60, .10)'],
    ['#475569', 'rgba(71, 85, 105, .10)']
  ]
  const source = String(project?.projectName || project?.projectId || '')
  let hash = 0
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) - hash) + source.charCodeAt(index)
  const item = palette[Math.abs(hash) % palette.length]
  return { color: item[0], wash: item[1] }
}

function projectAccentStyle(project) {
  const accent = projectAccent(project)
  return {
    '--project-accent': accent.color,
    '--project-wash': accent.wash
  }
}

function riskRank(level) {
  return { danger: 4, warn: 3, running: 2, pending: 1, done: 0 }[level] || 0
}

function emptyQuantities() {
  return { play: '', like: '', comment: '', favorite: '', share: '', douPlus: '', danmaku: '', coin: '', blueLink: '' }
}

function extractUrl(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/https?:\/\/[^\s"'<>，。；;、]+/i)
  return (match?.[0] || raw).replace(/[，。；;、,.!?！？]+$/g, '')
}

function inferGroup(name) {
  const key = normalize(name)
  const found = state.groups.find(group => (group.members || []).some(member => normalize(member) === key))
  return found?.groupName || ''
}

function normalizePlatform(value) {
  const raw = String(value || '').toLowerCase()
  if (/b站|bilibili|哔哩/.test(raw)) return 'bilibili'
  return 'douyin'
}

function defaultTargetCpm(platform) {
  return normalizePlatform(platform) === 'bilibili' ? 150 : 30
}

function platformLabel(platform) {
  return normalizePlatform(platform) === 'bilibili' ? 'B站' : '抖音'
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase()
}

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function toQuantityAmount(value, quantityUnit) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const normalized = String(value || '').trim().replace(/,/g, '')
  if (!normalized) return 0
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([wWkK万千]?)$/)
  if (!match) return toNumber(normalized)
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return 0
  const suffix = match[2]
  if (/[wW万]/.test(suffix)) {
    if (quantityUnit === '万') return amount
    if (quantityUnit === '千') return amount * 10
    return amount * 10000
  }
  if (/[kK千]/.test(suffix)) {
    if (quantityUnit === '万') return amount / 10
    if (quantityUnit === '千') return amount
    return amount * 1000
  }
  return amount
}

function stripZeros(value) {
  return String(value || '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function formatMoney(value) {
  return `¥${toNumber(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

function formatNumber(value) {
  const n = toNumber(value)
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

function formatCpm(value) {
  const n = toNumber(value)
  return n ? formatNumber(n) : '--'
}

function formatPercent(value) {
  return `${toNumber(value).toFixed(1)}%`
}

function formatCompact(value) {
  const n = Math.round(toNumber(value))
  if (n >= 100000000) return stripZeros((n / 100000000).toFixed(1)) + '亿'
  if (n >= 10000) return stripZeros((n / 10000).toFixed(1)) + '万'
  return n.toLocaleString('zh-CN')
}

function formatWan(value) {
  return formatCompact(value)
}

function formatUnitPrice(option) {
  if (!option) return '-'
  const unit = canonicalQuantityUnit(option.quantityUnit, option.service)
  const tiers = Array.isArray(option.priceTiers) ? option.priceTiers.filter(tier => toNumber(tier.unitPrice)) : []
  if (tiers.length) {
    return tiers.map(tier => {
      const min = toNumber(tier.min ?? tier.from)
      const max = toNumber(tier.max ?? tier.to)
      const range = max ? `${formatNumber(min)}-${formatNumber(max)}${unit}` : `${formatNumber(min)}${unit}起`
      return `${range} ${formatMoney(tier.unitPrice)}/${unit}`
    }).join('；')
  }
  return `${formatMoney(option.unitPrice)}/${unit}`
}

function toast(tone, message) {
  notice.tone = tone
  notice.message = message
  window.clearTimeout(toast.timer)
  toast.timer = window.setTimeout(() => {
    notice.message = ''
  }, 2600)
}
</script>

<style scoped>
.traffic-plan-v2 {
  --motion-fast: 150ms;
  --motion-mid: 260ms;
  --motion-slow: 520ms;
  --ease-out: cubic-bezier(.2, .8, .2, 1);
  --traffic-surface: color-mix(in srgb, var(--panel-bg) 94%, var(--card-bg, #f8fafc));
  --traffic-wash: color-mix(in srgb, var(--active-bg) 34%, transparent);
  --traffic-line: color-mix(in srgb, var(--border) 78%, transparent);
  --traffic-panel: var(--panel-bg);
  --traffic-panel-soft: var(--panel-bg-soft);
  --traffic-panel-strong: var(--card-bg, var(--panel-bg));
  --traffic-accent-main: var(--primary);
  --traffic-accent-soft: var(--active-bg);
  --traffic-warning-soft: var(--warning-bg, rgba(245, 158, 11, .12));
  --traffic-warning-text: var(--warning-text, #b45309);
  --traffic-success-soft: var(--success-bg, rgba(16, 185, 129, .12));
  --traffic-success-text: var(--success-text, #047857);
  --traffic-track-bg: color-mix(in srgb, var(--panel-bg-soft) 72%, var(--card-bg, #fff));
  --traffic-track-border: color-mix(in srgb, var(--primary) 20%, var(--border));
  --traffic-planned-bg:
    repeating-linear-gradient(
      -45deg,
      color-mix(in srgb, var(--primary) 28%, transparent) 0 7px,
      color-mix(in srgb, var(--primary) 10%, transparent) 7px 14px
    ),
    linear-gradient(90deg, color-mix(in srgb, var(--primary) 18%, transparent), color-mix(in srgb, var(--accent, var(--primary)) 12%, transparent));
  --traffic-actual-bg: linear-gradient(90deg, color-mix(in srgb, var(--secondary, #22c55e) 82%, #fff), var(--secondary, #22c55e));
  --traffic-shadow-soft: 0 10px 26px rgba(15, 23, 42, .065);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--text);
  font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  font-synthesis-weight: none;
  letter-spacing: 0;
  line-height: 1.35;
}

.traffic-plan-v2 :where(button, input, select, textarea) {
  font-family: inherit;
  line-height: 1.2;
  letter-spacing: 0;
}

.traffic-plan-v2 :where(strong, b) {
  font-weight: 700;
  line-height: 1.2;
}

.traffic-plan-v2 :where(em, small, span) {
  font-style: normal;
  letter-spacing: 0;
  line-height: 1.35;
}

.traffic-plan-v2 :where(button, .btn) {
  line-height: 1;
}

.traffic-plan-v2 :where(button, .btn, .traffic-project-item, .traffic-exec-row, .traffic-summary-panel, .traffic-overview-advice, .metric-bar, .layered-track) {
  transition:
    border-color var(--motion-fast) var(--ease-out),
    background-color var(--motion-fast) var(--ease-out),
    box-shadow var(--motion-fast) var(--ease-out),
    transform var(--motion-fast) var(--ease-out),
    opacity var(--motion-fast) var(--ease-out);
}

.traffic-plan-v2 :where(button, .btn):active {
  transform: translateY(1px) scale(.99);
}

.traffic-topbar,
.traffic-tabs,
.traffic-summary-panel,
.traffic-execution-panel,
.traffic-project-rail,
.traffic-apply-rail,
.traffic-apply-main,
.traffic-modal {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-bg);
  box-shadow: var(--shadow);
}

.traffic-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
}

.traffic-top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.traffic-current-group {
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
}

.traffic-tabs {
  display: inline-flex;
  width: fit-content;
  padding: 4px;
  gap: 4px;
}

.traffic-tabs button {
  min-height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.traffic-tabs button.active {
  background: var(--primary);
  color: #fff;
}

.traffic-notice {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}

.traffic-notice.success { background: rgba(16, 185, 129, .14); color: #047857; }
.traffic-notice.error { background: rgba(239, 68, 68, .13); color: #dc2626; }

.traffic-monitor-layout,
.traffic-apply-layout {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
}

.traffic-view-switch {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.traffic-view-switch button {
  min-width: 0;
  min-height: 44px;
  display: grid;
  gap: 2px;
  align-content: center;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-dim);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.traffic-view-switch button em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-style: normal;
  font-size: 10px;
}

.traffic-view-switch button.active {
  border-color: var(--primary);
  background: var(--active-bg);
  color: var(--text);
}

.traffic-project-rail,
.traffic-apply-rail {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 10px;
  overflow: hidden;
}

.traffic-project-rail {
  background: var(--panel-bg);
}

.traffic-rail-head,
.traffic-section-head,
.traffic-apply-head,
.traffic-modal header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.traffic-rail-head span,
.traffic-section-head span,
.traffic-apply-head span,
.traffic-summary-title em,
.traffic-exec-main span,
.traffic-exec-main small,
.traffic-exec-side em,
.traffic-result-card em {
  color: var(--text-muted);
  font-size: 12px;
}

.traffic-archive-toggle {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  padding: 5px 8px;
  cursor: pointer;
  white-space: nowrap;
}

.traffic-strip-actions,
.traffic-section-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.traffic-search {
  min-height: 34px;
}

.traffic-project-list,
.traffic-execution-table {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: grid;
  gap: 8px;
  align-content: start;
}

.traffic-archive-pool {
  display: grid;
  gap: 8px;
  min-height: 0;
  padding-top: 8px;
  border-top: 1px solid var(--traffic-line);
}

.traffic-archive-pool-head,
.traffic-archive-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.traffic-archive-pool-head strong {
  color: var(--text);
  font-size: 12px;
}

.traffic-archive-pool-head span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.traffic-archive-list {
  display: grid;
  gap: 6px;
  max-height: 188px;
  overflow: auto;
  align-content: start;
}

.traffic-archive-item {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--traffic-line);
  border-left: 4px solid var(--project-accent, var(--border));
  border-radius: 10px;
  background: var(--traffic-surface);
  opacity: .78;
}

.traffic-archive-item > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.traffic-archive-item strong,
.traffic-archive-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-archive-item strong {
  color: var(--text);
  font-size: 12px;
}

.traffic-archive-item span {
  color: var(--text-muted);
  font-size: 11px;
}

.traffic-apply-tree {
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 6px;
  align-content: start;
}

.traffic-project-item {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--traffic-line);
  border-left: 5px solid var(--project-accent, var(--border));
  border-radius: 10px;
  background: var(--traffic-surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.traffic-project-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  justify-content: space-between;
  gap: 10px;
  padding: 11px;
  animation: trafficFadeLift var(--motion-mid) var(--ease-out) both;
}

.traffic-project-item.done { border-left-color: #10b981; }
.traffic-project-item.running { border-left-color: #3b82f6; }
.traffic-project-item.warn { border-left-color: #f59e0b; }
.traffic-project-item.danger { border-left-color: #ef4444; background: rgba(239, 68, 68, .06); }
.traffic-project-item.pending { border-left-color: #94a3b8; }
.traffic-project-item.archived { opacity: .72; filter: saturate(.75); }

.traffic-project-item span,
.traffic-tree-project {
  display: grid;
  gap: 3px;
}

.traffic-project-item strong {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.2;
}

.traffic-project-item strong i {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--project-accent, #94a3b8);
}

.traffic-project-item.done strong i { background: #10b981; }
.traffic-project-item.running strong i { background: #3b82f6; }
.traffic-project-item.warn strong i { background: #f59e0b; }
.traffic-project-item.danger strong i { background: #ef4444; }

.traffic-project-item em,
.traffic-project-item small,
.traffic-tree-project-head em,
.traffic-tree-account em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  line-height: 1.25;
}

.traffic-project-item.active,
.traffic-tree-account.active {
  border-color: var(--project-accent, var(--primary));
  background: color-mix(in srgb, var(--active-bg) 72%, var(--panel-bg));
}

.traffic-project-item:hover {
  border-color: color-mix(in srgb, var(--project-accent, var(--primary)) 46%, var(--border));
  box-shadow: 0 8px 20px rgba(15, 23, 42, .08);
  transform: translateY(-1px);
}

.traffic-project-item.active {
  box-shadow: 0 10px 24px color-mix(in srgb, var(--project-accent, #3b82f6) 16%, transparent);
}

.traffic-project-item > b {
  justify-self: end;
  padding: 4px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg) 82%, transparent);
  font-size: 14px;
  line-height: 1.1;
}

.traffic-project-brief {
  display: flex !important;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.traffic-project-brief b {
  max-width: 100%;
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--border) 74%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg) 72%, transparent);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-project-state-dots {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  min-height: 9px;
}

.traffic-project-state-dots i {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #94a3b8;
}

.traffic-project-state-dots i.done { background: #10b981; }
.traffic-project-state-dots i.running { background: #3b82f6; }
.traffic-project-state-dots i.warn { background: #f59e0b; }
.traffic-project-state-dots i.pending { background: #94a3b8; }

.traffic-project-risk {
  color: var(--text-dim) !important;
  font-weight: 600;
}

.traffic-project-mini-track {
  grid-column: 1 / -1;
  position: relative;
  height: 8px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 80%, #fff);
  border-radius: 999px;
  background: #edf2f7;
}

.traffic-project-mini-track i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
}

.traffic-project-mini-track .planned {
  background: rgba(59, 130, 246, .18);
  transition: width var(--motion-slow) var(--ease-out);
}

.traffic-project-mini-track .actual {
  top: 2px;
  bottom: 2px;
  background: #10b981;
  transition: width var(--motion-slow) var(--ease-out);
}

.traffic-monitor-main {
  width: 100%;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: grid;
  gap: 10px;
  align-content: start;
}

.traffic-monitor-overview {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(180px, .32fr) minmax(360px, 1fr) minmax(230px, .44fr);
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background:
    radial-gradient(circle at 8% 18%, color-mix(in srgb, var(--active-bg) 70%, transparent), transparent 34%),
    linear-gradient(135deg, color-mix(in srgb, var(--panel-bg-soft) 74%, transparent), transparent 62%),
    var(--panel-bg);
  box-shadow: var(--shadow);
}

.traffic-overview-title {
  display: grid;
  gap: 6px;
}

.traffic-overview-title strong {
  font-size: 17px;
  line-height: 1.18;
}

.traffic-overview-title span,
.traffic-overview-kpis small,
.visual-tile small {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.25;
}

.traffic-overview-meta {
  min-width: 0;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
}

.traffic-overview-meta b {
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.1;
}

.traffic-overview-meta em {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-heatline,
.traffic-project-dots {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 180px;
}

.traffic-heatline {
  max-width: 170px;
}

.traffic-heatline i,
.traffic-project-dots i,
.status-spark b {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #94a3b8;
}

.traffic-heatline i.done,
.traffic-project-dots i.done,
.status-spark b.done { background: #10b981; }
.traffic-heatline i.running,
.traffic-project-dots i.running,
.status-spark b.running { background: #3b82f6; }
.traffic-heatline i.warn,
.traffic-heatline i.danger,
.traffic-project-dots i.warn,
.traffic-project-dots i.danger,
.status-spark b.warn { background: #ef4444; }
.traffic-heatline i.pending,
.traffic-project-dots i.pending,
.status-spark b.pending { background: #94a3b8; }

.traffic-overview-advice {
  min-width: 0;
  display: grid;
  gap: 7px;
  padding: 13px 14px;
  border: 1px solid color-mix(in srgb, var(--project-accent, var(--primary)) 24%, var(--border));
  border-radius: 10px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--active-bg) 46%, transparent), transparent 72%),
    var(--panel-bg-soft);
}

.traffic-overview-advice span {
  width: fit-content;
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(59, 130, 246, .12);
  color: #2563eb;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.traffic-overview-advice strong {
  overflow: hidden;
  color: var(--text);
  font-size: 18px;
  line-height: 1.18;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-overview-advice p {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-overview-advice i {
  display: flex;
  gap: 4px;
  min-height: 8px;
}

.traffic-overview-advice i b {
  width: 26px;
  height: 7px;
  border-radius: 999px;
  background: #94a3b8;
}

.traffic-overview-advice i b.done { background: #10b981; }
.traffic-overview-advice i b.running { background: #3b82f6; }
.traffic-overview-advice i b.pending { background: #94a3b8; }
.traffic-overview-advice i b.warn { background: #f59e0b; }
.traffic-overview-advice i b.danger { background: #ef4444; }

.traffic-overview-advice.done {
  border-color: rgba(16, 185, 129, .26);
  background: rgba(16, 185, 129, .07);
}

.traffic-overview-advice.warn {
  border-color: rgba(245, 158, 11, .34);
  background: rgba(245, 158, 11, .08);
  animation: trafficAttention 2.4s var(--ease-out) infinite;
}

.traffic-overview-advice.danger {
  border-color: rgba(239, 68, 68, .32);
  background: rgba(239, 68, 68, .08);
  animation: trafficAttention 1.8s var(--ease-out) infinite;
}

.traffic-overview-actions {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.traffic-overview-chips {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.traffic-overview-chips span {
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel-bg-soft) 86%, transparent);
}

.traffic-overview-chips b {
  color: var(--text);
  font-size: 18px;
  line-height: 1;
}

.traffic-overview-chips em {
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
}

.traffic-overview-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.traffic-overview-buttons .btn {
  min-width: 0;
  padding-inline: 8px;
}

.visual-ring {
  --pct: 0%;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: conic-gradient(#ef4444 var(--pct), var(--chip-bg) 0);
  position: relative;
}

.visual-tile.risk {
  grid-template-columns: 38px minmax(0, 1fr);
}

.visual-tile.cpm-card {
  grid-template-columns: 42px minmax(0, 1fr);
}

.visual-tile small {
  grid-column: 2;
  margin-top: -6px;
  font-size: 10px;
  white-space: nowrap;
}

.visual-meter {
  --pct: 0%;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  position: relative;
  background: conic-gradient(#3b82f6 var(--pct), var(--chip-bg) 0);
}

.visual-meter::after {
  content: "";
  position: absolute;
  inset: 5px;
  border-radius: inherit;
  background: var(--panel-bg);
}

.visual-meter b {
  position: relative;
  z-index: 1;
  max-width: 30px;
  overflow: hidden;
  color: var(--text);
  font-size: 10px;
  line-height: 1;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.visual-meter.cpm {
  background: conic-gradient(#10b981 min(var(--pct), 100%), #f59e0b var(--pct), var(--chip-bg) 0);
}

.visual-meter.risk {
  background: conic-gradient(#ef4444 var(--pct), var(--chip-bg) 0);
}

.visual-ring::after {
  content: "";
  position: absolute;
  inset: 4px;
  border-radius: inherit;
  background: var(--panel-bg);
}

.visual-ring b {
  position: relative;
  z-index: 1;
  color: #dc2626;
  font-size: 10px;
}

.visual-bar {
  position: relative;
  height: 16px;
  min-width: 72px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 78%, #fff);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .42), rgba(255, 255, 255, .08)),
    repeating-linear-gradient(90deg, rgba(148, 163, 184, .16), rgba(148, 163, 184, .16) 0 1px, transparent 1px 18px),
    color-mix(in srgb, var(--chip-bg) 82%, #fff);
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, .06);
}

.visual-bar b,
.visual-bar u {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
}

.visual-bar b {
  background: linear-gradient(90deg, #10b981, #3b82f6);
}

.visual-bar.cpm b {
  background: linear-gradient(90deg, #10b981, #f59e0b, #ef4444);
}

.visual-bar.cpm u {
  left: calc(100% - 2px);
  width: 2px;
  background: var(--text-dim);
  opacity: .65;
}

.visual-bar.money b {
  background: linear-gradient(90deg, #64748b, #3b82f6);
}

.visual-bar.gap b {
  background: linear-gradient(90deg, #f59e0b, #ef4444);
}

.visual-bar.achieve b {
  background: linear-gradient(90deg, #10b981, #2563eb);
}

.traffic-overview-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.traffic-overview-kpis span {
  min-width: 0;
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel-bg-soft) 82%, transparent);
}

.traffic-overview-kpis em {
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.15;
}

.traffic-overview-kpis b {
  font-size: 18px;
  line-height: 1.15;
}

.traffic-overview-kpis .risk {
  border-color: rgba(239, 68, 68, .38);
  background: rgba(239, 68, 68, .07);
}

.traffic-overview-progress {
  grid-column: auto;
}

.traffic-cockpit-main {
  gap: 10px;
  padding-right: 2px;
}

.traffic-command-deck {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(220px, auto);
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel-bg) 96%, var(--panel-bg-soft));
  box-shadow: 0 4px 14px rgba(15, 23, 42, .035);
}

.traffic-command-scope,
.traffic-command-stack {
  min-width: 0;
}

.traffic-command-scope {
  display: grid;
  grid-template-columns: minmax(118px, auto) minmax(0, 1fr);
  gap: 3px 10px;
  align-items: center;
  padding: 2px 0;
}

.traffic-command-scope span {
  grid-column: 1;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.traffic-command-scope strong {
  grid-column: 1;
  overflow: hidden;
  color: var(--text);
  font-size: 15px;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-command-scope em {
  grid-column: 2;
  grid-row: 1;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-command-scope .traffic-heatline {
  grid-column: 2;
  grid-row: 2;
  max-width: none;
  align-items: center;
}

.traffic-command-stack {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.traffic-command-button {
  min-width: 0;
  display: grid;
  grid-template-columns: auto auto;
  gap: 6px;
  align-items: center;
  align-content: center;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-bg-soft);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.traffic-command-button span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.traffic-command-button strong {
  overflow: hidden;
  font-size: 13px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-command-button em {
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-command-button.primary {
  border-color: color-mix(in srgb, var(--primary) 28%, var(--border));
  background: color-mix(in srgb, var(--active-bg) 64%, var(--panel-bg));
}

.traffic-command-button.warn {
  border-color: rgba(245, 158, 11, .34);
  background: rgba(245, 158, 11, .10);
}

.traffic-command-button:hover,
.traffic-play-stage:hover,
.traffic-finance-stage span:hover,
.traffic-interaction-stage .metric-bar:hover,
.traffic-exec-row:hover .metric-bar {
  transform: translateY(-1px);
}

.traffic-summary-panel {
  min-width: 0;
}

.traffic-project-cockpit {
  min-width: 0;
  display: grid;
  gap: 12px;
  min-height: 198px;
  padding: 18px 18px 18px 20px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--project-accent, var(--primary)) 28%, var(--border));
  border-left: 5px solid var(--project-accent, var(--primary));
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel-bg) 94%, var(--panel-bg-soft));
  box-shadow: 0 8px 20px rgba(15, 23, 42, .045);
  animation: trafficFadeLift var(--motion-mid) var(--ease-out) both;
}

.traffic-project-cockpit:hover {
  box-shadow: 0 12px 28px rgba(15, 23, 42, .07);
}

.traffic-project-strip {
  grid-template-columns: minmax(150px, .34fr) minmax(176px, .42fr) minmax(0, 1fr) minmax(96px, auto);
  grid-template-rows: auto minmax(82px, 1fr);
  align-items: stretch;
}

.traffic-cockpit-head {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto minmax(360px, .9fr);
  gap: 12px;
  align-items: center;
  padding: 13px 16px 11px;
  border-bottom: 1px solid color-mix(in srgb, var(--project-accent, #3b82f6) 18%, var(--border));
}

.traffic-cockpit-head > div:first-child {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.traffic-cockpit-head span {
  width: fit-content;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--primary-light);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.traffic-cockpit-head span.done { color: #047857; background: rgba(16, 185, 129, .13); }
.traffic-cockpit-head span.running { color: #2563eb; background: rgba(59, 130, 246, .13); }
.traffic-cockpit-head span.warn { color: #b45309; background: rgba(245, 158, 11, .15); }
.traffic-cockpit-head span.danger { color: #dc2626; background: rgba(239, 68, 68, .13); }
.traffic-cockpit-head span.pending { color: #64748b; }

.traffic-cockpit-head h3 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 24px;
  line-height: 1.12;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-cockpit-actions {
  display: flex;
  justify-content: flex-end;
}

.traffic-summary-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.traffic-summary-facts b {
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--project-accent, #3b82f6) 14%, var(--border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel-bg) 78%, var(--panel-bg-soft));
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.15;
}

.traffic-summary-facts em {
  color: var(--text-muted);
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
}

.traffic-cockpit-body {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(300px, .82fr) minmax(300px, 1fr) minmax(170px, .34fr);
  gap: 11px;
  padding: 12px 16px 15px;
}

.traffic-play-stage,
.traffic-interaction-stage,
.traffic-finance-stage {
  min-width: 0;
}

.traffic-play-stage {
  display: grid;
  gap: 12px;
  align-content: center;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--project-accent, #3b82f6) 24%, var(--border));
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel-bg) 86%, var(--project-wash, var(--panel-bg-soft)));
}

.traffic-play-stage-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.traffic-play-stage-head strong {
  font-size: 17px;
  line-height: 1.1;
}

.traffic-play-stage-head b {
  color: var(--project-accent, #2563eb);
  font-size: 28px;
  line-height: 1;
}

.traffic-play-stage .layered-progress-head {
  display: none;
}

.traffic-play-stage .layered-track {
  height: 32px;
  border-radius: 13px;
}

.traffic-finance-stage span {
  min-width: 0;
  display: grid;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel-bg) 78%, var(--panel-bg-soft));
}

.traffic-finance-stage em {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-finance-stage strong {
  overflow: hidden;
  color: var(--text);
  font-size: 14px;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-interaction-stage {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  align-content: stretch;
}

.traffic-interaction-stage .metric-bar {
  min-height: 58px;
  padding: 9px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel-bg) 84%, var(--panel-bg-soft));
}

.traffic-interaction-stage .metric-bar .metric-track {
  height: 22px;
}

.traffic-finance-stage {
  display: grid;
  gap: 9px;
  align-content: stretch;
}

.traffic-finance-stage .visual-bar {
  width: 100%;
  min-width: 0;
}

.traffic-finance-stage .status-spark {
  min-height: 20px;
  align-content: start;
}

.traffic-strip-title,
.traffic-strip-play,
.traffic-strip-metrics,
.traffic-strip-facts {
  min-width: 0;
}

.traffic-strip-title {
  grid-column: 1;
  grid-row: 1;
  display: grid;
  gap: 5px;
}

.traffic-strip-title span {
  width: fit-content;
  max-width: 100%;
  padding: 4px 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-strip-title span.done { color: #047857; background: rgba(16, 185, 129, .13); }
.traffic-strip-title span.running { color: #2563eb; background: rgba(59, 130, 246, .13); }
.traffic-strip-title span.warn {
  color: #8a5a12;
  background: rgba(245, 158, 11, .08);
}
.traffic-strip-title span.danger { color: #8a5a12; background: rgba(245, 158, 11, .08); }
.traffic-strip-title span.pending { color: #64748b; }

.traffic-strip-title h3 {
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 17px;
  line-height: 1.16;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-strip-facts {
  grid-column: 2;
  grid-row: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  align-content: center;
}

.traffic-strip-facts b {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--project-accent, #3b82f6) 12%, var(--border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg) 82%, var(--panel-bg-soft));
  color: var(--text);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.08;
}

.traffic-strip-facts em {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-strip-play {
  grid-column: 3 / 5;
  grid-row: 2;
  display: grid;
  gap: 10px;
  align-content: center;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--project-accent, #3b82f6) 16%, var(--border));
  border-radius: 14px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, #3b82f6) 8%, transparent), transparent 72%),
    color-mix(in srgb, var(--panel-bg) 84%, var(--panel-bg-soft));
}

.traffic-strip-play-head {
  min-width: 0;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
}

.traffic-strip-play-head strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
}

.traffic-strip-play-head b {
  color: var(--project-accent, #2563eb);
  font-size: 18px;
  line-height: 1;
}

.traffic-strip-play-head small {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-strip-play :deep(.layered-track) {
  height: 24px;
  border-radius: 12px;
}

.traffic-strip-play :deep(.layered-track .actual) {
  top: 6px;
  bottom: 6px;
}

.traffic-strip-rings {
  grid-column: 1 / 3;
  grid-row: 2;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(88px, 1fr));
  gap: 10px;
}

.traffic-strip-ring {
  --pct: 0%;
  position: relative;
  min-width: 0;
  min-height: 116px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 5px;
  padding: 12px 9px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--project-accent, #3b82f6) 18%, var(--border));
  border-radius: 16px;
  background:
    radial-gradient(circle at 50% 45%, var(--panel-bg) 0 35%, transparent 36%),
    conic-gradient(var(--project-accent, #3b82f6) var(--pct), color-mix(in srgb, var(--border) 58%, transparent) 0);
}

.traffic-strip-ring.margin {
  background:
    radial-gradient(circle at 50% 45%, var(--panel-bg) 0 35%, transparent 36%),
    conic-gradient(#22c55e var(--pct), color-mix(in srgb, var(--border) 58%, transparent) 0);
}

.traffic-strip-ring::after {
  content: "";
  position: absolute;
  inset: 8px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--panel-bg) 72%, transparent);
}

.traffic-strip-ring strong,
.traffic-strip-ring em {
  position: relative;
  z-index: 1;
  max-width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-strip-ring strong {
  color: var(--text);
  font-size: 18px;
  line-height: 1;
}

.traffic-strip-ring em {
  color: var(--text-muted);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
  line-height: 1;
}

.traffic-strip-phase {
  grid-column: 3;
  grid-row: 1;
  --pct: 0%;
  min-width: 0;
  display: grid;
}

.traffic-strip-phase span {
  min-width: 0;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  align-content: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px dashed color-mix(in srgb, var(--project-accent, #3b82f6) 34%, var(--border));
  border-radius: 16px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--project-accent, #3b82f6) var(--pct), transparent), transparent),
    color-mix(in srgb, var(--panel-bg) 82%, var(--panel-bg-soft));
}

.traffic-strip-phase em,
.traffic-strip-phase strong,
.traffic-strip-phase small {
  max-width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-strip-phase em {
  color: var(--text-muted);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
}

.traffic-strip-phase strong {
  color: var(--text);
  font-size: 15px;
  line-height: 1;
}

.traffic-strip-phase small {
  color: var(--text-muted);
  font-size: 10px;
}

.traffic-strip-metrics {
  grid-column: 1 / 4;
  grid-row: 2;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.traffic-strip-metrics .metric-bar {
  min-height: 36px;
  padding: 6px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel-bg) 86%, var(--panel-bg-soft));
}

.traffic-strip-metrics .metric-bar :deep(.metric-track) {
  height: 10px;
  border-radius: 7px;
}

.traffic-strip-metrics .metric-bar :deep(em strong) {
  font-size: 10px;
  line-height: 1;
}

.traffic-strip-edit {
  grid-column: 4;
  grid-row: 1;
  white-space: nowrap;
}

.traffic-strip-actions {
  grid-column: 4;
  grid-row: 1;
  justify-self: end;
}

.traffic-strip-actions .traffic-strip-edit {
  grid-column: auto;
  grid-row: auto;
}

.traffic-group-monitor-panel {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(180px, .38fr) minmax(360px, 1fr) minmax(320px, .82fr);
  gap: 14px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel-bg) 92%, var(--panel-bg-soft));
  box-shadow: 0 8px 22px rgba(15, 23, 42, .045);
}

.traffic-group-monitor-panel > div:first-child {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.traffic-group-monitor-panel span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.traffic-group-monitor-panel h3 {
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 23px;
  line-height: 1.12;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-group-monitor-panel em {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-group-monitor-panel .layered-progress-head {
  display: none;
}

.traffic-group-monitor-panel .layered-track {
  height: 28px;
}

.traffic-group-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}

.traffic-group-metrics span {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: color-mix(in srgb, var(--panel-bg) 82%, var(--panel-bg-soft));
}

.traffic-group-metrics b {
  overflow: hidden;
  color: var(--text);
  font-size: 14px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-ring {
  width: 104px;
  aspect-ratio: 1;
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  place-items: center;
  align-content: center;
  justify-self: center;
  border-radius: 50%;
  background: conic-gradient(var(--project-accent, var(--primary)) var(--pct), var(--chip-bg) 0);
  position: relative;
}

.traffic-ring::after {
  content: "";
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  background: var(--panel-bg);
}

.traffic-ring strong,
.traffic-ring span,
.traffic-ring i {
  position: relative;
  z-index: 1;
}

.traffic-ring strong {
  grid-row: 2;
  font-size: 20px;
  line-height: 1;
}

.traffic-ring span {
  grid-row: 3;
  align-self: start;
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.traffic-ring i {
  position: absolute;
  right: 24px;
  bottom: 25px;
  width: 18px;
  height: 18px;
  border: 3px solid var(--panel-bg);
  border-radius: 999px;
  background: var(--project-accent, var(--primary));
  box-shadow: 0 2px 5px rgba(15, 23, 42, .12);
}

.traffic-project-visuals {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(240px, .82fr) minmax(260px, 1fr);
  gap: 10px 14px;
  margin: 14px 14px 14px 0;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--project-accent, var(--primary)) 24%, var(--border));
  border-radius: 12px;
  background:
    linear-gradient(90deg, var(--project-wash, transparent), transparent 74%),
    color-mix(in srgb, var(--panel-bg-soft) 86%, transparent);
}

.traffic-project-play-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 62%, transparent);
}

.traffic-project-visuals > .layered-progress {
  grid-column: 1;
}

.traffic-project-visuals > .layered-progress .layered-progress-head {
  display: none;
}

.traffic-project-play-head strong {
  font-size: 15px;
  line-height: 1.1;
}

.traffic-project-play-head b {
  font-size: 24px;
  line-height: 1;
}

.traffic-project-metric-bars {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  align-content: stretch;
}

.traffic-project-metric-bars .metric-bar {
  grid-template-columns: 1fr;
  align-content: space-between;
  gap: 7px;
  padding: 9px;
  border: 1px solid color-mix(in srgb, var(--project-accent, #3b82f6) 22%, var(--border));
  border-radius: 8px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, #3b82f6) 8%, transparent), transparent 72%),
    color-mix(in srgb, var(--project-wash, transparent) 58%, var(--panel-bg-soft));
}

.traffic-project-metric-bars .metric-bar em {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 12.5px;
  font-weight: 800;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-project-metric-bars .metric-bar em strong {
  color: inherit;
}

.traffic-project-metric-bars .metric-bar .metric-track {
  height: 19px;
  border-color: color-mix(in srgb, var(--project-accent, #3b82f6) 22%, var(--border));
  background: #edf2f7;
}

.traffic-project-metric-bars .metric-bar .metric-planned {
  background: rgba(59, 130, 246, .18);
  transition: width var(--motion-slow) var(--ease-out);
}

.traffic-project-metric-bars .metric-bar .metric-actual {
  height: 10px;
  background: #10b981;
  transition: width var(--motion-slow) var(--ease-out);
}

.traffic-project-status-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.traffic-project-status-strip.visual-only {
  display: flex;
  height: 18px;
  gap: 5px;
}

.traffic-project-visual-grid {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  min-width: 0;
  padding: 0 14px 14px 0;
}

.traffic-project-visual-grid span {
  min-width: 0;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 10px;
  border: 0;
  border-top: 1px solid var(--traffic-line);
  border-radius: 0;
  background: transparent;
}

.traffic-project-visual-grid em {
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
}

.status-spark {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 10px;
}

.traffic-project-status-strip span {
  display: grid;
  gap: 2px;
  padding: 7px;
  border-radius: 7px;
  background: var(--panel-bg-soft);
}

.traffic-project-status-strip.visual-only span {
  flex: calc(var(--weight, 0) + 1) 1 16px;
  padding: 0;
  min-width: 16px;
  overflow: hidden;
  background: var(--chip-bg);
}

.traffic-project-status-strip.visual-only span b {
  display: block;
  width: 100%;
  height: 100%;
}

.traffic-project-status-strip.visual-only .done b { background: #10b981; }
.traffic-project-status-strip.visual-only .running b { background: #3b82f6; }
.traffic-project-status-strip.visual-only .warn b { background: #f59e0b; }
.traffic-project-status-strip.visual-only .pending b { background: #94a3b8; }

.traffic-project-status-strip b {
  font-size: 14px;
}

.traffic-project-status-strip em {
  color: var(--text-muted);
  font-style: normal;
  font-size: 10px;
  font-weight: 600;
}

.traffic-project-interaction-map {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(7, minmax(22px, 1fr));
  gap: 6px;
}

.traffic-project-interaction-map span {
  --pct: 0%;
  height: 14px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chip-bg);
  position: relative;
}

.traffic-project-interaction-map span i {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--pct);
  border-radius: inherit;
  background: #94a3b8;
}

.traffic-project-interaction-map span.done i { background: #10b981; }
.traffic-project-interaction-map span.running i { background: #3b82f6; }
.traffic-project-interaction-map span.warn i { background: #f59e0b; }
.traffic-project-interaction-map span.idle i { background: #cbd5e1; }

.traffic-focus-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
  gap: 8px;
}

.traffic-focus-strip button {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--project-accent, #f59e0b) 42%, var(--border));
  border-left: 4px solid var(--project-accent, #f59e0b);
  border-radius: 8px;
  background:
    linear-gradient(90deg, var(--project-wash, rgba(245, 158, 11, .12)), transparent 72%),
    var(--panel-bg);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  animation: trafficFadeLift var(--motion-mid) var(--ease-out) both;
}

.traffic-focus-strip button:hover {
  box-shadow: 0 10px 24px rgba(15, 23, 42, .1);
  transform: translateY(-1px);
}

.traffic-focus-strip button.danger {
  border-color: rgba(239, 68, 68, .45);
}

.traffic-focus-strip strong,
.traffic-focus-strip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-focus-strip span {
  color: var(--text-muted);
  font-size: 11px;
}

.traffic-focus-strip i {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chip-bg);
}

.traffic-focus-strip i b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #10b981, var(--project-accent, #2563eb));
  transition: width var(--motion-slow) var(--ease-out);
}

.traffic-summary-meta {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 8px;
}

.traffic-summary-meta span,
.traffic-result-card {
  min-width: 0;
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.traffic-summary-meta em,
.traffic-result-card span {
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
}

.traffic-execution-panel {
  display: grid;
  gap: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 16px;
  background: var(--panel-bg);
  box-shadow: 0 12px 30px rgba(15, 23, 42, .055);
}

.traffic-section-head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--traffic-line);
  background:
    linear-gradient(90deg, rgba(15, 23, 42, .03), transparent 74%),
    color-mix(in srgb, var(--panel-bg-soft) 86%, #fff);
}

.traffic-execution-table {
  gap: 0;
}

.traffic-exec-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(150px, .26fr) minmax(360px, .9fr) minmax(340px, .78fr) minmax(112px, .2fr);
  gap: 14px;
  padding: 10px 15px;
  border-bottom: 1px solid var(--traffic-line);
  background: rgba(248, 250, 252, .96);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.traffic-exec-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(150px, .26fr) minmax(360px, .9fr) minmax(340px, .78fr) minmax(112px, .2fr);
  gap: 14px;
  align-items: center;
  padding: 16px 15px;
  border: 0;
  border-bottom: 1px solid var(--traffic-line);
  border-left: 6px solid var(--project-accent, var(--border));
  border-radius: 0;
  background: var(--panel-bg);
  animation: trafficFadeLift var(--motion-mid) var(--ease-out) both;
}

.traffic-exec-row.done { border-left-color: #10b981; background: color-mix(in srgb, var(--panel-bg) 96%, rgba(16, 185, 129, .08)); }
.traffic-exec-row.running { border-left-color: #3b82f6; }
.traffic-exec-row.warn { border-left-color: #f59e0b; background: color-mix(in srgb, var(--panel-bg) 97%, rgba(245, 158, 11, .08)); }
.traffic-exec-row.pending { border-left-color: #94a3b8; }

.traffic-exec-row:hover {
  border-left-color: var(--project-accent, #3b82f6);
  box-shadow: 0 10px 26px rgba(15, 23, 42, .08);
  transform: translateY(-1px);
}

.traffic-exec-row.danger {
  animation: trafficFadeLift var(--motion-mid) var(--ease-out) both, trafficAttention 2.6s var(--ease-out) infinite;
}

.traffic-exec-main,
.traffic-exec-side,
.traffic-exec-core-metrics,
.traffic-exec-metrics {
  display: grid;
  gap: 4px;
  min-width: 0;
  align-content: center;
}

.traffic-exec-side {
  justify-items: stretch;
  gap: 6px;
}

.traffic-exec-side .btn {
  min-width: 0;
  padding-inline: 6px;
  min-height: 28px;
  font-size: 11px;
}

.traffic-exec-main strong {
  display: flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  font-size: 17px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-exec-main strong > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.traffic-exec-project-chip {
  flex: 0 1 auto;
  max-width: 128px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--project-accent, var(--primary)) 36%, transparent);
  background: color-mix(in srgb, var(--project-accent, var(--primary)) 13%, var(--panel-bg));
  color: color-mix(in srgb, var(--project-accent, var(--primary)) 72%, var(--text));
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-exec-main strong i {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--project-accent, #94a3b8);
}

.traffic-exec-main small {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.25;
}

.mini-money {
  width: 34px;
  height: 7px;
  border-radius: 999px;
  background: linear-gradient(90deg, #64748b, #3b82f6);
}

.mini-cpm {
  --pct: 0%;
  width: 34px;
  height: 7px;
  border-radius: 999px;
  background: linear-gradient(90deg, #10b981 var(--pct), var(--chip-bg) 0);
}

.traffic-exec-progress-stack {
  display: grid;
  gap: 9px;
  min-width: 0;
  align-items: center;
}

.traffic-exec-core-metrics {
  grid-template-columns: minmax(0, 1.3fr) minmax(118px, .7fr);
  gap: 10px;
  align-items: stretch;
}

.traffic-exec-play-head {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.traffic-exec-play-head strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
}

.traffic-exec-play-head b {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 8px;
  color: var(--text);
  font-size: 20px;
  font-weight: 850;
  line-height: 1;
  text-align: right;
}

.traffic-exec-play-head b small {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 750;
  white-space: nowrap;
}

.traffic-exec-progress :deep(.layered-progress-head) {
  display: none;
}

.traffic-exec-progress :deep(.layered-track) {
  height: 30px;
  border-radius: 10px;
  border-color: color-mix(in srgb, var(--project-accent, #3b82f6) 30%, var(--border));
  background: #eef2f7;
}

.traffic-exec-progress :deep(.layered-track .actual) {
  top: 8px;
  bottom: 8px;
}

.traffic-exec-metrics {
  display: block;
  gap: 0;
}

.traffic-exec-like-metric {
  min-height: 76px;
  padding: 10px 11px;
  border-radius: 12px;
}

.traffic-exec-like-metric :deep(.metric-track) {
  display: block;
  min-height: 24px;
  height: 24px;
}

.traffic-exec-metrics .traffic-mini-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  min-width: 0;
}

.traffic-exec-metrics .traffic-mini-metrics .metric-bar {
  min-height: 42px;
  padding: 7px 8px;
  border-radius: 10px;
}

.traffic-exec-metrics .traffic-mini-metrics .metric-bar :deep(.metric-track) {
  display: block;
  min-height: 15px;
  height: 15px;
}

.traffic-exec-progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.traffic-exec-progress-meta.compact {
  justify-content: flex-start;
  gap: 7px;
}

.traffic-exec-progress-meta.compact span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 28px;
  height: 8px;
  padding: 0;
  border-radius: 999px;
  background: var(--panel-bg-soft);
  white-space: nowrap;
}

.traffic-exec-progress-meta.compact span::before {
  content: "";
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: #94a3b8;
}

.traffic-exec-progress-meta.compact .planned::before { background: #3b82f6; }
.traffic-exec-progress-meta.compact .actual::before { background: #10b981; }
.traffic-exec-progress-meta.compact .gap::before { background: #f59e0b; }

.traffic-visual-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 16px;
}

.traffic-visual-legend i,
.traffic-visual-legend b,
.traffic-visual-legend em {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: auto;
  height: auto;
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
}

.traffic-visual-legend i::before,
.traffic-visual-legend b::before,
.traffic-visual-legend em::before {
  content: "";
  display: block;
  width: 24px;
  height: 7px;
  border-radius: 999px;
}

.traffic-visual-legend i::before {
  background: repeating-linear-gradient(90deg, rgba(59, 130, 246, .45), rgba(59, 130, 246, .45) 0 6px, rgba(59, 130, 246, .12) 6px 10px);
}

.traffic-visual-legend b::before {
  background: #10b981;
}

.traffic-visual-legend em::before {
  background: #f59e0b;
}

.traffic-tree-tools {
  display: flex;
  gap: 5px;
}

.traffic-tree-tools button {
  min-height: 24px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.traffic-tree-project {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.traffic-tree-project-head {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  padding: 8px 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  background:
    linear-gradient(90deg, var(--project-wash, transparent), transparent 74%),
    color-mix(in srgb, var(--panel-bg-soft) 72%, transparent);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.traffic-tree-project-head:hover {
  border-color: var(--border);
}

.traffic-tree-project-head i {
  color: var(--text-muted);
  font-style: normal;
  font-weight: 700;
}

.traffic-tree-project-head > b {
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.15;
}

.traffic-tree-project-head > b.danger,
.traffic-tree-project-head > b.warn {
  color: #b45309;
  background: rgba(245, 158, 11, .15);
}

.traffic-tree-project-head > b.done {
  color: #047857;
  background: rgba(16, 185, 129, .14);
}

.traffic-tree-project-head span,
.traffic-tree-account span {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.traffic-tree-project-head strong,
.traffic-tree-account strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-tree-accounts {
  display: grid;
  gap: 3px;
  padding-left: 13px;
  border-left: 1px solid var(--border);
  margin-left: 8px;
}

.traffic-tree-account {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 6px;
  padding: 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.traffic-tree-account:hover {
  background: var(--panel-bg-soft);
}

.traffic-tree-account.active {
  border-color: var(--project-accent, var(--primary));
  background: var(--active-bg);
}

.traffic-tree-account-main {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.traffic-tree-phase-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.traffic-tree-phase-list button {
  min-height: 22px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-bg);
  color: var(--text-muted);
  font: inherit;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
}

.traffic-tree-phase-list button.active,
.traffic-tree-phase-list button:hover {
  border-color: color-mix(in srgb, var(--project-accent, var(--primary)) 48%, var(--border));
  background: color-mix(in srgb, var(--active-bg) 76%, var(--panel-bg));
  color: var(--project-accent, var(--primary));
}

.traffic-tree-phase-list button.new {
  border-color: color-mix(in srgb, var(--primary) 34%, var(--border));
  color: var(--primary);
}

.traffic-tree-progress {
  position: relative;
  display: block;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chip-bg);
}

.traffic-tree-progress i,
.traffic-tree-progress b {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
}

.traffic-tree-progress i {
  background: repeating-linear-gradient(90deg, rgba(59, 130, 246, .4), rgba(59, 130, 246, .4) 0 5px, transparent 5px 8px);
}

.traffic-tree-progress b {
  top: 2px;
  bottom: 2px;
  background: linear-gradient(90deg, #10b981, var(--project-accent, #2563eb));
}

.traffic-tree-account b {
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.15;
  white-space: nowrap;
}

.traffic-tree-account b.done { color: #047857; background: rgba(16, 185, 129, .14); }
.traffic-tree-account b.running { color: #2563eb; background: rgba(59, 130, 246, .14); }
.traffic-tree-account b.warn { color: #b45309; background: rgba(245, 158, 11, .16); }
.traffic-tree-account b.pending { color: #64748b; }

.traffic-tree-account-actions {
  display: grid;
  gap: 4px;
  justify-items: end;
  min-width: 72px;
}

.traffic-tree-account-actions i {
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--primary) 34%, var(--border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--active-bg) 58%, var(--panel-bg));
  color: var(--primary);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
  line-height: 1.1;
  white-space: nowrap;
}

.traffic-unlinked-create {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px dashed color-mix(in srgb, var(--primary) 55%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--active-bg) 62%, transparent);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.traffic-unlinked-create span {
  color: var(--text-muted);
  font-size: 11px;
}

.traffic-settings-box {
  margin-top: auto;
  display: grid;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.traffic-settings-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.traffic-settings-toggle b {
  color: var(--text-muted);
  font-size: 11px;
}

.traffic-settings-editor {
  display: grid;
  gap: 8px;
}

.traffic-settings-editor p {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.traffic-settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.traffic-settings-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.traffic-settings-tabs button,
.traffic-settings-section-head button,
.traffic-settings-price-row button,
.traffic-settings-preset-main button,
.traffic-standard-card button {
  min-height: 28px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.traffic-settings-tabs button.active {
  border-color: color-mix(in srgb, var(--primary) 46%, var(--border));
  background: var(--active-bg);
  color: var(--text);
}

.traffic-standard-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.traffic-standard-actions .ghost {
  border-color: color-mix(in srgb, var(--primary) 42%, var(--border));
  background: color-mix(in srgb, var(--active-bg) 58%, var(--panel-bg));
  color: var(--primary);
}

.traffic-settings-section {
  display: grid;
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel-bg) 72%, var(--panel-bg-soft));
}

.traffic-settings-section-head,
.traffic-settings-preset-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
}

.traffic-settings-section-head strong {
  color: var(--text);
  font-size: 12px;
}

.traffic-settings-price-head,
.traffic-settings-price-row {
  display: grid;
  grid-template-columns: minmax(58px, .8fr) minmax(82px, 1.1fr) minmax(56px, .72fr) minmax(52px, .58fr) minmax(54px, .64fr) 42px;
  gap: 5px;
  align-items: center;
}

.traffic-settings-price-head {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
}

.traffic-settings-price-row .inp,
.traffic-settings-preset-row .inp,
.traffic-settings-standard-search {
  min-height: 30px;
  padding-inline: 7px;
  font-size: 11px;
}

.traffic-settings-price-row button,
.traffic-settings-preset-main button {
  color: #b45309;
}

.traffic-settings-preset-row {
  display: grid;
  gap: 7px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--panel-bg-soft) 76%, transparent);
}

.traffic-settings-preset-main {
  grid-template-columns: minmax(0, 1fr) 74px 74px 42px;
}

.traffic-settings-preset-quantities {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.traffic-settings-preset-quantities label {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 5px;
  align-items: center;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
}

.traffic-standard-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--active-bg) 58%, var(--panel-bg));
}

.traffic-standard-card.missing {
  border-color: color-mix(in srgb, var(--border) 88%, transparent);
  background: color-mix(in srgb, var(--panel-bg-soft) 74%, transparent);
}

.traffic-standard-card strong {
  display: block;
  color: var(--text);
  font-size: 12px;
}

.traffic-standard-card span {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.traffic-standard-card button {
  padding-inline: 10px;
  color: var(--primary);
}

.traffic-standard-card button:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.traffic-preset-box .traffic-settings-editor {
  gap: 8px;
}

.traffic-preset-cpm-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.traffic-preset-cpm-list button {
  min-height: 32px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.traffic-preset-cpm-list button.active {
  border-color: color-mix(in srgb, var(--primary) 56%, var(--border));
  background: var(--active-bg);
  color: var(--text);
}

.traffic-preset-preview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.traffic-preset-preview span {
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--panel-bg) 76%, var(--panel-bg-soft));
}

.traffic-preset-preview em {
  color: var(--text-muted);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
}

.traffic-preset-preview b {
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-cpm-picker {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.traffic-cpm-picker .inp {
  grid-column: span 2;
  min-height: 34px;
}

.traffic-cpm-picker button {
  min-height: 34px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel-bg) 78%, var(--panel-bg-soft));
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  align-content: center;
  gap: 1px;
  transition: transform .14s ease, border-color .14s ease, background .14s ease;
}

.traffic-cpm-picker button:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--primary) 36%, var(--border));
}

.traffic-cpm-picker button.active {
  border-color: color-mix(in srgb, var(--primary) 58%, var(--border));
  background: var(--active-bg);
  color: var(--text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 16%, transparent);
}

.traffic-cpm-picker button em {
  font-size: 9px;
  font-style: normal;
  font-weight: 800;
}

.traffic-cpm-picker button b {
  font-size: 13px;
}

.traffic-exec-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-mini-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}

.traffic-mini-metrics.visual {
  grid-template-columns: 1fr;
  align-content: center;
  gap: 6px;
  padding: 0;
  border-top: 0;
}

.metric-bar {
  min-width: 0;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--project-accent, #8bd3dd) 16%, var(--border));
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .88), rgba(255, 255, 255, .56)),
    color-mix(in srgb, var(--project-wash, rgba(139, 211, 221, .14)) 72%, var(--panel-bg));
}

.metric-bar em {
  min-width: 0;
  display: grid;
  gap: 2px;
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.05;
  text-align: left;
}

.metric-bar em strong,
.metric-bar em small {
  min-width: 0;
  overflow: hidden;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-bar :deep(em strong) {
  color: color-mix(in srgb, var(--text) 78%, var(--project-accent, #0f766e));
}

.metric-bar :deep(em small) {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 750;
}

.metric-bar :deep(.metric-track) {
  min-width: 0;
  display: block;
  position: relative;
  width: 100%;
  min-height: 16px;
  height: 16px;
  overflow: hidden;
  border: 1px solid rgba(125, 211, 252, .34);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .95), rgba(240, 253, 250, .84)),
    #ecfeff;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, .045), 0 1px 0 rgba(255, 255, 255, .86);
}

.metric-bar :deep(.metric-track)::after {
  content: "";
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(255, 255, 255, .72);
  border-radius: inherit;
  pointer-events: none;
}

.metric-bar :deep(.metric-planned),
.metric-bar :deep(.metric-actual) {
  position: absolute;
  left: 0;
  border-radius: inherit;
  display: block;
}

.metric-bar :deep(.metric-planned) {
  width: 0;
  top: 0;
  bottom: 0;
  height: 100%;
  background:
    repeating-linear-gradient(
      -45deg,
      rgba(56, 189, 248, .24) 0,
      rgba(56, 189, 248, .24) 7px,
      rgba(186, 230, 253, .18) 7px,
      rgba(186, 230, 253, .18) 14px
    ),
    linear-gradient(90deg, rgba(224, 242, 254, .72), rgba(191, 219, 254, .62));
  box-shadow: inset 0 0 0 1px rgba(14, 165, 233, .16), inset 0 1px 0 rgba(255, 255, 255, .48);
  transition: width var(--motion-slow) var(--ease-out);
}

.metric-bar :deep(.metric-actual) {
  width: 0;
  top: 50%;
  height: 9px;
  transform: translateY(-50%);
  margin-left: 2px;
  max-width: calc(100% - 4px);
  border-radius: 999px;
  background: linear-gradient(90deg, #5eead4, #22c55e);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .68), 0 4px 9px rgba(34, 197, 94, .18);
  transition: width var(--motion-slow) var(--ease-out);
}

.metric-bar.warn :deep(.metric-actual) { background: linear-gradient(90deg, #facc15, #fb923c); }
.metric-bar.done :deep(.metric-actual) { background: linear-gradient(90deg, #5eead4, #22c55e); }
.metric-bar.idle :deep(.metric-actual) { background: #cbd5e1; }
.metric-bar.natural :deep(.metric-planned) { opacity: 0; }

.metric-bar.compact :deep(.metric-planned) {
  height: 100%;
}

.metric-bar.compact :deep(.metric-actual) {
  height: 8px;
}

.metric-bar.compact {
  grid-template-columns: 44px minmax(0, 1fr);
}

.metric-bar.with-values {
  grid-template-columns: 1fr;
  gap: 5px;
}

.metric-bar.with-values :deep(.metric-track) {
  display: block;
  min-height: 18px;
  height: 18px;
  border-radius: 8px;
}

.metric-bar.with-values :deep(em) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.metric-bar.with-values :deep(em strong) {
  flex: 0 0 auto;
}

.metric-bar.with-values :deep(em small) {
  flex: 1 1 auto;
  min-width: 0;
  text-align: right;
}

.metric-bar.with-values :deep(.metric-actual) {
  height: 9px;
}

.traffic-metric-orb {
  --pct: 0%;
  width: 34px;
  height: 34px;
  position: relative;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: conic-gradient(#94a3b8 var(--pct), var(--chip-bg) 0);
}

.traffic-metric-orb::after {
  content: "";
  position: absolute;
  inset: 4px;
  border-radius: inherit;
  background: var(--panel-bg);
}

.traffic-metric-orb em {
  position: relative;
  z-index: 1;
  color: var(--text-dim);
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
}

.traffic-metric-orb b {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 2;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: 2px solid var(--panel-bg);
  background: #94a3b8;
}

.traffic-metric-orb.done {
  background: conic-gradient(#10b981 var(--pct), var(--chip-bg) 0);
}

.traffic-metric-orb.running {
  background: conic-gradient(#3b82f6 var(--pct), var(--chip-bg) 0);
}

.traffic-metric-orb.warn {
  background: conic-gradient(#f59e0b var(--pct), var(--chip-bg) 0);
}

.traffic-metric-orb.done b { background: #10b981; }
.traffic-metric-orb.running b { background: #3b82f6; }
.traffic-metric-orb.warn b { background: #f59e0b; }

.layered-progress {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.layered-progress :deep(.layered-progress-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.15;
}

.layered-progress.compact :deep(.layered-progress-head span) {
  font-size: 0;
}

.layered-progress.compact :deep(.layered-progress-head span::after) {
  content: "";
}

.layered-progress :deep(.layered-track) {
  position: relative;
  height: 20px;
  overflow: hidden;
  border: 1px solid rgba(125, 211, 252, .34);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .95), rgba(240, 253, 250, .84)),
    #ecfeff;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, .045), 0 1px 0 rgba(255, 255, 255, .86);
}

.layered-progress :deep(.layered-track)::after {
  content: "";
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(255, 255, 255, .72);
  border-radius: inherit;
  pointer-events: none;
}

.layered-progress :deep(.layered-track .target),
.layered-progress :deep(.layered-track .planned),
.layered-progress :deep(.layered-track .actual) {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: inherit;
}

.layered-progress :deep(.layered-track .target) {
  width: 100%;
  background: rgba(209, 250, 229, .22);
}

.layered-progress :deep(.layered-track .planned) {
  background:
    repeating-linear-gradient(
      -45deg,
      rgba(56, 189, 248, .24) 0,
      rgba(56, 189, 248, .24) 8px,
      rgba(186, 230, 253, .18) 8px,
      rgba(186, 230, 253, .18) 16px
    ),
    linear-gradient(90deg, rgba(224, 242, 254, .72), rgba(191, 219, 254, .62));
  box-shadow: inset 0 0 0 1px rgba(14, 165, 233, .16), inset 0 1px 0 rgba(255, 255, 255, .48);
  transition: width var(--motion-slow) var(--ease-out);
}

.layered-progress :deep(.layered-track .actual) {
  top: 6px;
  bottom: 6px;
  max-width: calc(100% - 4px);
  margin-left: 2px;
  background: linear-gradient(90deg, #5eead4, #22c55e);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .68), 0 4px 9px rgba(34, 197, 94, .18);
  transition: width var(--motion-slow) var(--ease-out);
}

.layered-legend {
  min-width: 0;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.layered-legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 32px;
  height: 8px;
  border-radius: 999px;
  background: var(--chip-bg);
}

.layered-legend span::before {
  content: "";
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: #94a3b8;
}

.layered-legend .planned::before {
  background: #3b82f6;
}

.layered-legend .actual::before {
  background: #10b981;
}

.layered-legend .gap::before {
  background: #f59e0b;
}

.traffic-apply-main {
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 12px;
  padding: 14px;
  align-content: start;
}

.traffic-apply-main :where(.inp, input, select, textarea) {
  border-color: color-mix(in srgb, var(--project-accent, var(--primary)) 12%, var(--border));
  background: color-mix(in srgb, var(--panel-bg) 86%, var(--panel-bg-soft));
  color: var(--text);
}

.traffic-apply-head,
.traffic-apply-progress,
.traffic-apply-workspace {
  grid-column: 1 / 2;
}

.traffic-apply-head {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.traffic-apply-head.empty {
  border-color: rgba(245, 158, 11, .35);
}

.traffic-apply-head.empty strong {
  color: var(--text-dim);
}

.traffic-apply-progress {
  display: grid;
  gap: 9px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--project-accent, var(--primary)) 18%, var(--border));
  border-radius: 12px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 8%, transparent), transparent 72%),
    color-mix(in srgb, var(--panel-bg) 84%, var(--panel-bg-soft));
}

.traffic-apply-progress.empty {
  min-height: 104px;
  align-content: center;
  border-style: dashed;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 5%, transparent), transparent 72%),
    color-mix(in srgb, var(--panel-bg) 72%, var(--panel-bg-soft));
}

.traffic-apply-progress-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  color: var(--text);
  line-height: 1.2;
}

.traffic-apply-progress-title strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-apply-progress-title span {
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 800;
}

.traffic-apply-progress-empty {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 8px 10px;
}

.traffic-apply-progress-empty strong {
  color: var(--text);
  font-size: 16px;
  line-height: 1.1;
}

.traffic-apply-progress-empty span {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.traffic-apply-progress-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.traffic-apply-progress-meta span {
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--project-accent, var(--primary)) 10%, var(--border));
  border-radius: 9px;
  background: color-mix(in srgb, var(--panel-bg) 82%, var(--panel-bg-soft));
}

.traffic-apply-progress-meta em {
  color: var(--text-muted);
  font-style: normal;
  font-size: 10px;
  font-weight: 600;
}

.traffic-apply-workspace {
  display: grid;
  gap: 12px;
}

.traffic-form-panel,
.traffic-maintenance-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.traffic-form-panel {
  display: grid;
  gap: 12px;
  padding: 12px;
}

.traffic-panel-title,
.traffic-maintenance-head,
.traffic-review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.traffic-panel-title span,
.traffic-maintenance-head span,
.traffic-maintenance-head em,
.traffic-review-head em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
}

.traffic-maintenance-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.traffic-maintenance-actions button {
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.traffic-maintenance-actions button:hover {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--border));
  color: var(--text);
}

.traffic-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.traffic-form-grid label,
.traffic-form-grid .traffic-form-field,
.traffic-create-actions label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.traffic-form-grid .span-2 {
  grid-column: span 2;
}

.traffic-phase-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 8px;
}

.traffic-phase-strip button {
  min-width: 0;
  min-height: 58px;
  display: grid;
  align-content: center;
  gap: 2px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel-bg-soft) 78%, var(--panel-bg));
  color: var(--text-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.traffic-phase-strip button b {
  color: var(--text);
  font-size: 16px;
  line-height: 1;
}

.traffic-phase-strip button em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
}

.traffic-phase-strip button.saved {
  border-color: color-mix(in srgb, #22c55e 35%, var(--border));
  background: color-mix(in srgb, #dcfce7 32%, var(--panel-bg));
}

.traffic-phase-strip button.next {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--primary) 38%, var(--border));
}

.traffic-phase-strip button.active {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--active-bg) 78%, var(--panel-bg));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 22%, transparent);
}

.traffic-phase-strip .traffic-phase-add {
  border-style: dashed;
  text-align: center;
}

.traffic-phase-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
}

.traffic-phase-control button {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--primary) 36%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--active-bg) 64%, var(--panel-bg));
  color: var(--primary);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  cursor: pointer;
}

.traffic-phase-control button:hover {
  border-color: var(--primary);
  box-shadow: 0 6px 16px rgba(37, 99, 235, .12);
}

.traffic-phase-history {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-height: 24px;
}

.traffic-phase-history span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.traffic-phase-history button {
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.traffic-phase-history button.active,
.traffic-phase-history button:hover {
  border-color: color-mix(in srgb, var(--primary) 44%, var(--border));
  background: color-mix(in srgb, var(--active-bg) 76%, var(--panel-bg));
  color: var(--primary);
}

.traffic-platform-mode {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  min-height: 34px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-bg-soft);
}

.traffic-platform-mode button {
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
}

.traffic-platform-mode button.active {
  background: var(--card-bg);
  color: var(--primary);
  box-shadow: 0 4px 12px rgba(37, 99, 235, .12);
}

.traffic-maintenance-wrap {
  overflow: hidden;
}

.traffic-maintenance-head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.traffic-maintenance-table {
  width: 100%;
  border-collapse: collapse;
}

.traffic-maintenance-table th,
.traffic-maintenance-table td {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-size: 12px;
  line-height: 1.25;
}

.traffic-maintenance-table th {
  color: var(--text-muted);
  background: color-mix(in srgb, var(--panel-bg-soft) 78%, var(--panel-bg));
}

.traffic-maintenance-table tbody tr:last-child td {
  border-bottom: 0;
}

.traffic-result-panel {
  grid-column: 2 / 3;
  grid-row: 1 / span 4;
  display: grid;
  gap: 10px;
  align-content: start;
  position: sticky;
  top: 0;
}

.traffic-result-card.good { border-color: rgba(16, 185, 129, .55); }
.traffic-result-card.warn { border-color: rgba(245, 158, 11, .6); }
.traffic-result-card.bad { border-color: rgba(239, 68, 68, .55); }

.traffic-review {
  min-height: 260px;
  resize: vertical;
  line-height: 1.55;
  font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
}

.traffic-comment-entry {
  display: grid;
  gap: 8px;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  overflow: hidden;
}

.traffic-comment-entry.open {
  background: var(--panel-bg);
}

.traffic-comment-toggle {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.traffic-comment-toggle span {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.traffic-comment-toggle em,
.traffic-comment-toggle b {
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
}

.traffic-comment-entry :deep(.comment-card) {
  border: 0;
  border-top: 1px solid var(--border);
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}

.traffic-comment-entry :deep(.card-body) {
  padding: 10px;
  gap: 10px;
}

.traffic-comment-entry :deep(.card-hdr) {
  display: none;
}

.traffic-comment-entry :deep(.comment-textarea) {
  min-height: 120px;
}

.traffic-comment-entry :deep(.action-row .btn) {
  min-height: 30px;
  padding: 0 9px;
  font-size: 12px;
}

.traffic-empty {
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--active-bg) 34%, transparent), transparent 70%),
    color-mix(in srgb, var(--panel-bg-soft) 80%, transparent);
  color: var(--text-muted);
  text-align: center;
  line-height: 1.55;
}

.traffic-empty.large {
  min-height: 220px;
  display: grid;
  place-items: center;
  border-style: solid;
}

.traffic-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, .42);
}

.traffic-modal {
  width: min(920px, 96vw);
  max-height: 88vh;
  overflow: auto;
  display: grid;
  gap: 12px;
  padding: 14px;
}

.traffic-crm-login-modal {
  width: min(980px, 96vw);
}

.traffic-crm-login-shot {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel-bg-soft);
}

.traffic-crm-login-shot img {
  display: block;
  width: 100%;
  max-height: min(68vh, 760px);
  object-fit: contain;
  background: #fff;
}

.traffic-create-text {
  min-height: 220px;
  resize: vertical;
}

.traffic-create-actions {
  display: grid;
  grid-template-columns: 180px auto auto;
  gap: 8px;
  align-items: end;
}

.traffic-parse-preview {
  display: grid;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.traffic-parse-preview div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
}

.traffic-parse-preview em {
  color: var(--text-muted);
  font-style: normal;
}

/* Traffic plan visual sample layer. Keep this section presentation-only. */
.traffic-plan-v2 {
  --traffic-paper: var(--traffic-panel);
  --traffic-paper-strong: var(--traffic-panel-strong);
  --traffic-paper-soft: var(--traffic-panel-soft);
  --traffic-mint: color-mix(in srgb, var(--secondary, #22c55e) 72%, #8ff0d1);
  --traffic-mint-deep: var(--secondary, #22c55e);
  --traffic-sky: color-mix(in srgb, var(--primary) 78%, #8bd8ff);
  --traffic-sky-soft: color-mix(in srgb, var(--primary) 12%, var(--panel-bg-soft));
  --traffic-honey: var(--traffic-accent-soft);
  --traffic-peach: color-mix(in srgb, var(--accent, var(--primary)) 16%, var(--panel-bg-soft));
  --traffic-ink: var(--text);
  --traffic-soft-border: color-mix(in srgb, var(--border) 84%, var(--primary) 16%);
  --traffic-sticker-shadow: var(--traffic-shadow-soft);
  --traffic-row-shadow: 0 8px 18px rgba(31, 41, 55, .045);
  color: var(--traffic-ink);
}

:global(:root[data-ui-style="violet"] .traffic-plan-v2 ){
  --traffic-paper: color-mix(in srgb, var(--panel-bg) 96%, #0d0b1d);
  --traffic-paper-strong: color-mix(in srgb, var(--card-bg) 90%, #201d38);
  --traffic-paper-soft: color-mix(in srgb, var(--panel-bg-soft) 92%, #201d38);
  --traffic-honey: color-mix(in srgb, var(--primary) 24%, var(--panel-bg-soft));
  --traffic-peach: color-mix(in srgb, var(--accent) 12%, var(--panel-bg-soft));
  --traffic-soft-border: color-mix(in srgb, var(--border) 82%, var(--primary) 18%);
  --traffic-track-bg: linear-gradient(180deg, rgba(255, 255, 255, .08), rgba(125, 211, 252, .06)), color-mix(in srgb, var(--panel-bg-soft) 88%, #0f172a);
  --traffic-sticker-shadow: 0 12px 26px rgba(0, 0, 0, .26);
}

:global(:root[data-ui-style="violet"]) .traffic-topbar,
:global(:root[data-ui-style="violet"]) .traffic-tabs,
:global(:root[data-ui-style="violet"]) .traffic-summary-panel,
:global(:root[data-ui-style="violet"]) .traffic-execution-panel,
:global(:root[data-ui-style="violet"]) .traffic-project-rail,
:global(:root[data-ui-style="violet"]) .traffic-apply-rail,
:global(:root[data-ui-style="violet"]) .traffic-apply-main,
:global(:root[data-ui-style="violet"]) .traffic-modal {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .08), rgba(255, 255, 255, .03)),
    var(--traffic-paper);
}

:global(:root[data-ui-style="violet"]) .traffic-command-deck,
:global(:root[data-ui-style="violet"]) .traffic-group-monitor-panel,
:global(:root[data-ui-style="violet"]) .traffic-project-cockpit,
:global(:root[data-ui-style="violet"]) .traffic-apply-progress,
:global(:root[data-ui-style="violet"]) .traffic-form-panel,
:global(:root[data-ui-style="violet"]) .traffic-maintenance-wrap,
:global(:root[data-ui-style="violet"]) .traffic-comment-entry,
:global(:root[data-ui-style="violet"]) .traffic-settings-box,
:global(:root[data-ui-style="violet"]) .traffic-exec-row,
:global(:root[data-ui-style="violet"]) .traffic-project-item,
:global(:root[data-ui-style="violet"]) .traffic-tree-project-head,
:global(:root[data-ui-style="violet"]) .traffic-tree-account,
:global(:root[data-ui-style="violet"]) .traffic-unlinked-create {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 9%, transparent), transparent 72%),
    linear-gradient(180deg, rgba(255, 255, 255, .09), rgba(255, 255, 255, .035)),
    var(--traffic-paper);
}

:global(:root[data-ui-style="violet"]) .traffic-exec-header,
:global(:root[data-ui-style="violet"]) .traffic-maintenance-table th {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .14), rgba(255, 255, 255, .06)),
    var(--traffic-paper-strong);
}

:global(:root[data-ui-style="violet"]) .traffic-strip-facts b,
:global(:root[data-ui-style="violet"]) .traffic-summary-facts b,
:global(:root[data-ui-style="violet"]) .traffic-finance-stage span,
:global(:root[data-ui-style="violet"]) .traffic-project-brief b,
:global(:root[data-ui-style="violet"]) .traffic-tree-account b,
:global(:root[data-ui-style="violet"]) .traffic-tree-project-head > b,
:global(:root[data-ui-style="violet"]) .traffic-command-button,
:global(:root[data-ui-style="violet"]) .traffic-apply-progress-meta span,
:global(:root[data-ui-style="violet"]) .traffic-group-metrics span,
:global(:root[data-ui-style="violet"]) .metric-bar,
:global(:root[data-ui-style="violet"]) .traffic-exec-side b {
  background: rgba(255, 255, 255, .10);
  color: var(--text);
}

:global(:root[data-ui-style="violet"]) .traffic-project-cockpit,
:global(:root[data-ui-style="violet"]) .traffic-exec-row:hover {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 13%, transparent), transparent 72%),
    linear-gradient(180deg, rgba(255, 255, 255, .12), rgba(255, 255, 255, .04)),
    var(--traffic-paper);
}

:global(:root[data-ui-style="violet"]) .traffic-exec-main strong,
:global(:root[data-ui-style="violet"]) .traffic-strip-title h3,
:global(:root[data-ui-style="violet"]) .traffic-cockpit-head h3,
:global(:root[data-ui-style="violet"]) .traffic-group-monitor-panel h3,
:global(:root[data-ui-style="violet"]) .traffic-metric-orb em {
  color: var(--text);
}

:global(:root[data-ui-style="violet"]) .traffic-exec-progress :deep(.layered-track),
:global(:root[data-ui-style="violet"]) .traffic-play-stage .layered-track,
:global(:root[data-ui-style="violet"]) .traffic-strip-play :deep(.layered-track),
:global(:root[data-ui-style="violet"]) .traffic-group-monitor-panel .layered-track,
:global(:root[data-ui-style="violet"]) .traffic-project-visuals > .layered-progress :deep(.layered-track),
:global(:root[data-ui-style="violet"]) .layered-progress :deep(.layered-track),
:global(:root[data-ui-style="violet"]) .metric-bar :deep(.metric-track),
:global(:root[data-ui-style="violet"]) .traffic-project-metric-bars .metric-bar .metric-track {
  background: var(--traffic-track-bg);
}

:global(:root[data-ui-style="apple"] .traffic-plan-v2 ){
  --traffic-paper: rgba(255, 255, 255, .82);
  --traffic-paper-strong: rgba(255, 255, 255, .94);
  --traffic-paper-soft: rgba(246, 248, 252, .78);
  --traffic-honey: linear-gradient(135deg, rgba(0, 122, 255, .12), rgba(255, 255, 255, .68));
  --traffic-soft-border: color-mix(in srgb, var(--border) 86%, var(--primary) 14%);
  --traffic-sticker-shadow: 0 12px 28px rgba(0, 0, 0, .07);
}

:global(:root[data-ui-style="usagi"] .traffic-plan-v2 ){
  --traffic-paper: color-mix(in srgb, var(--panel-bg) 86%, #fff8e7);
  --traffic-paper-strong: color-mix(in srgb, var(--panel-bg) 78%, #fff3cf);
  --traffic-paper-soft: color-mix(in srgb, var(--panel-bg-soft) 72%, #fff8e7);
  --traffic-mint: color-mix(in srgb, var(--usagi-mint, #8ff0d1) 78%, #2dd4bf);
  --traffic-mint-deep: #22c55e;
  --traffic-sky: #8bd8ff;
  --traffic-sky-soft: #dff5ff;
  --traffic-honey: color-mix(in srgb, var(--usagi-yellow, #ffd84f) 72%, #fff2b8);
  --traffic-peach: color-mix(in srgb, var(--usagi-pink, #ff9fb5) 52%, #fff1f2);
  --traffic-ink: color-mix(in srgb, var(--text) 86%, var(--usagi-ink, #4a3024));
  --traffic-soft-border: color-mix(in srgb, var(--border) 68%, var(--usagi-border, #ffd84f) 32%);
  --traffic-sticker-shadow: 0 14px 30px color-mix(in srgb, var(--usagi-yellow, #ffd84f) 10%, transparent), 0 8px 22px rgba(31, 41, 55, .06);
  --traffic-track-bg: linear-gradient(180deg, #fffefa, #f2fffb);
  --traffic-track-border: color-mix(in srgb, var(--traffic-sky) 38%, var(--traffic-soft-border));
  --traffic-planned-bg:
    repeating-linear-gradient(
      -45deg,
      rgba(96, 165, 250, .34) 0 7px,
      rgba(224, 242, 254, .48) 7px 14px
    ),
    linear-gradient(90deg, rgba(191, 231, 255, .72), rgba(219, 234, 254, .66));
  --traffic-actual-bg: linear-gradient(90deg, #8ff0d1, #4ade80 72%, #22c55e);
}

.traffic-topbar,
.traffic-tabs,
.traffic-summary-panel,
.traffic-execution-panel,
.traffic-project-rail,
.traffic-apply-rail,
.traffic-apply-main,
.traffic-modal {
  border-color: var(--traffic-soft-border);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .58), rgba(255, 255, 255, .18)),
    var(--traffic-paper);
  box-shadow: var(--traffic-sticker-shadow);
}

:global(:root[data-ui-style="violet"]) .traffic-topbar,
:global(:root[data-ui-style="violet"]) .traffic-tabs,
:global(:root[data-ui-style="violet"]) .traffic-summary-panel,
:global(:root[data-ui-style="violet"]) .traffic-execution-panel,
:global(:root[data-ui-style="violet"]) .traffic-project-rail,
:global(:root[data-ui-style="violet"]) .traffic-apply-rail,
:global(:root[data-ui-style="violet"]) .traffic-apply-main,
:global(:root[data-ui-style="violet"]) .traffic-modal {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .08), rgba(255, 255, 255, .025)),
    var(--traffic-paper);
}

.traffic-topbar {
  padding: 12px 14px;
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--traffic-paper-strong) 92%, transparent), var(--traffic-paper));
}

.traffic-current-group,
.traffic-tabs,
.traffic-view-switch button,
.traffic-command-button,
.traffic-tree-tools button,
.traffic-settings-toggle {
  border-color: color-mix(in srgb, var(--traffic-soft-border) 82%, transparent);
  background: color-mix(in srgb, var(--traffic-paper-soft) 88%, transparent);
}

.traffic-tabs {
  padding: 5px;
  border-radius: 999px;
}

.traffic-tabs button {
  border-radius: 999px;
}

.traffic-tabs button.active,
.traffic-view-switch button.active {
  border-color: color-mix(in srgb, var(--primary) 36%, var(--traffic-soft-border));
  background: var(--traffic-honey);
  color: var(--text);
  box-shadow: 0 8px 16px color-mix(in srgb, var(--primary) 12%, transparent);
}

:global(:root[data-ui-style="usagi"]) .traffic-tabs button.active,
:global(:root[data-ui-style="usagi"]) .traffic-view-switch button.active {
  color: var(--usagi-ink, #4a3024);
}

.traffic-notice {
  width: fit-content;
  max-width: min(720px, 100%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid var(--traffic-soft-border);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .78), rgba(255, 255, 255, .46)),
    var(--traffic-paper-strong);
  box-shadow: 0 10px 20px rgba(31, 41, 55, .06);
  animation: trafficToastPop var(--motion-mid) var(--ease-out) both;
}

.traffic-notice::before {
  content: "";
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--traffic-mint-deep);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--traffic-mint) 24%, transparent);
}

.traffic-notice.success {
  color: #047857;
}

.traffic-notice.error {
  color: #b42318;
}

.traffic-notice.error::before {
  background: #fb7185;
  box-shadow: 0 0 0 4px rgba(251, 113, 133, .18);
}

.traffic-project-rail,
.traffic-apply-rail {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .50), transparent),
    var(--traffic-paper);
}

:global(:root[data-ui-style="violet"]) .traffic-project-rail,
:global(:root[data-ui-style="violet"]) .traffic-apply-rail {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .055), transparent),
    var(--traffic-paper);
}

.traffic-project-item,
.traffic-tree-project-head,
.traffic-tree-account,
.traffic-unlinked-create {
  border-color: color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 18%, var(--traffic-soft-border));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 8%, transparent), transparent 72%),
    linear-gradient(180deg, rgba(255, 255, 255, .72), rgba(255, 255, 255, .36)),
    var(--traffic-paper-soft);
  box-shadow: 0 5px 12px rgba(31, 41, 55, .035);
}

.traffic-project-item {
  border-radius: 11px;
  padding: 10px;
}

.traffic-project-item.active,
.traffic-tree-account.active {
  border-color: color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 48%, var(--traffic-honey));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 16%, transparent), transparent 76%),
    linear-gradient(180deg, #fffefa, color-mix(in srgb, var(--traffic-paper-strong) 78%, #fff));
  box-shadow: 0 10px 22px color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 14%, transparent);
}

.traffic-project-item.danger {
  background:
    linear-gradient(90deg, rgba(251, 146, 60, .10), transparent),
    var(--traffic-paper-soft);
}

.traffic-project-item > b {
  background: rgba(255, 255, 255, .62);
  color: color-mix(in srgb, var(--traffic-ink) 84%, var(--project-accent, var(--traffic-sky)));
}

.traffic-project-brief b,
.traffic-tree-account b,
.traffic-tree-project-head > b,
.traffic-command-button,
.traffic-apply-progress-meta span,
.traffic-group-metrics span {
  border-color: color-mix(in srgb, var(--traffic-soft-border) 78%, transparent);
  background: rgba(255, 255, 255, .56);
}

.traffic-project-mini-track,
.traffic-tree-progress {
  border: 1px solid var(--traffic-track-border);
  background: var(--traffic-track-bg);
  box-shadow: inset 0 1px 2px rgba(31, 41, 55, .045);
}

.traffic-project-mini-track .planned,
.traffic-tree-progress i {
  background: var(--traffic-planned-bg);
}

.traffic-project-mini-track .actual,
.traffic-tree-progress b {
  background: var(--traffic-actual-bg);
}

.traffic-command-deck,
.traffic-group-monitor-panel,
.traffic-project-cockpit,
.traffic-apply-progress,
.traffic-form-panel,
.traffic-maintenance-wrap,
.traffic-comment-entry,
.traffic-settings-box {
  border-color: var(--traffic-soft-border);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .64), rgba(255, 255, 255, .28)),
    var(--traffic-paper);
  box-shadow: var(--traffic-row-shadow);
}

:global(:root[data-ui-style="violet"]) .traffic-command-deck,
:global(:root[data-ui-style="violet"]) .traffic-group-monitor-panel,
:global(:root[data-ui-style="violet"]) .traffic-project-cockpit,
:global(:root[data-ui-style="violet"]) .traffic-apply-progress,
:global(:root[data-ui-style="violet"]) .traffic-form-panel,
:global(:root[data-ui-style="violet"]) .traffic-maintenance-wrap,
:global(:root[data-ui-style="violet"]) .traffic-comment-entry,
:global(:root[data-ui-style="violet"]) .traffic-settings-box {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .075), rgba(255, 255, 255, .025)),
    var(--traffic-paper);
}

.traffic-command-deck {
  border-radius: 13px;
  padding: 9px 11px;
}

.traffic-command-scope span,
.traffic-command-button span,
.traffic-section-head span,
.traffic-visual-legend,
.traffic-rail-head span {
  color: color-mix(in srgb, var(--text-muted) 82%, var(--usagi-orange, #f59e0b));
}

.traffic-command-button.warn {
  border-color: color-mix(in srgb, #f59e0b 28%, var(--traffic-soft-border));
  background: color-mix(in srgb, #fff7d6 66%, var(--traffic-paper));
}

.traffic-command-button.primary {
  border-color: color-mix(in srgb, var(--traffic-mint) 46%, var(--traffic-soft-border));
  background: color-mix(in srgb, #dffbef 62%, var(--traffic-paper));
}

.traffic-project-cockpit {
  border-left-width: 6px;
  border-radius: 14px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 12%, transparent), transparent 70%),
    linear-gradient(180deg, rgba(255, 255, 255, .70), rgba(255, 255, 255, .32)),
    var(--traffic-paper);
}

.traffic-project-strip {
  grid-template-columns: minmax(150px, .34fr) minmax(176px, .42fr) minmax(0, 1fr) minmax(96px, auto);
  grid-template-rows: auto minmax(82px, 1fr);
  padding: 18px;
  gap: 12px;
}

.traffic-strip-title span,
.traffic-cockpit-head span {
  background: rgba(255, 255, 255, .62);
  border: 1px solid color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 18%, var(--traffic-soft-border));
  color: color-mix(in srgb, var(--traffic-ink) 74%, var(--project-accent, var(--traffic-sky)));
}

.traffic-strip-title h3,
.traffic-cockpit-head h3,
.traffic-group-monitor-panel h3 {
  color: var(--traffic-ink);
}

.traffic-strip-facts {
  gap: 7px;
}

.traffic-strip-facts b,
.traffic-summary-facts b,
.traffic-finance-stage span {
  border-color: color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 16%, var(--traffic-soft-border));
  background: rgba(255, 255, 255, .58);
  border-radius: 11px;
}

.traffic-strip-play-head b,
.traffic-play-stage-head b,
.traffic-project-play-head b,
.traffic-exec-play-head b {
  color: color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 76%, var(--traffic-mint-deep));
}

.traffic-execution-panel {
  overflow: hidden;
}

.traffic-exec-header {
  grid-template-columns: minmax(106px, .24fr) minmax(220px, .74fr) minmax(210px, .60fr) minmax(74px, .16fr);
  gap: 8px;
  padding-inline: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .86), rgba(255, 255, 255, .58)),
    color-mix(in srgb, var(--traffic-paper-strong) 78%, var(--traffic-paper));
  border-bottom-color: var(--traffic-soft-border);
}

.traffic-exec-row {
  position: relative;
  grid-template-columns: minmax(106px, .24fr) minmax(220px, .74fr) minmax(210px, .60fr) minmax(74px, .16fr);
  gap: 8px;
  padding: 14px 12px;
  border-bottom-color: color-mix(in srgb, var(--traffic-soft-border) 74%, transparent);
  border-left-width: 7px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 7%, transparent), transparent 68%),
    linear-gradient(180deg, rgba(255, 255, 255, .72), rgba(255, 255, 255, .32)),
    var(--traffic-paper);
  box-shadow: none;
}

.traffic-exec-row:hover {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 12%, transparent), transparent 72%),
    linear-gradient(180deg, #fffefa, rgba(255, 255, 255, .52)),
    var(--traffic-paper);
  box-shadow: 0 12px 24px color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 10%, rgba(31, 41, 55, .06));
}

.traffic-exec-row.done {
  border-left-color: var(--traffic-mint-deep);
  background:
    linear-gradient(90deg, rgba(143, 240, 209, .14), transparent 68%),
    var(--traffic-paper);
}

.traffic-exec-row.warn,
.traffic-exec-row.danger {
  background:
    linear-gradient(90deg, rgba(251, 191, 36, .12), transparent 68%),
    var(--traffic-paper);
}

.traffic-exec-row.danger {
  animation: trafficFadeLift var(--motion-mid) var(--ease-out) both;
}

.traffic-exec-main strong {
  color: var(--traffic-ink);
}

.traffic-exec-main span,
.traffic-exec-main small {
  color: color-mix(in srgb, var(--text-muted) 86%, var(--usagi-orange, #f59e0b));
}

.traffic-exec-side b {
  width: fit-content;
  max-width: 100%;
  justify-self: end;
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .62);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1;
}

.traffic-exec-side b.warn,
.traffic-exec-side b.danger {
  color: #b45309;
  background: rgba(254, 243, 199, .82);
}

.traffic-exec-side b.done {
  color: #047857;
  background: rgba(209, 250, 229, .86);
}

.traffic-exec-side .btn,
.traffic-strip-edit,
.traffic-phase-control button {
  border-radius: 999px;
}

.traffic-exec-side {
  gap: 5px;
  min-width: 0;
}

.traffic-exec-side .btn {
  min-height: 27px;
  padding-inline: 5px;
  font-size: 10px;
}

.traffic-exec-core-metrics {
  grid-template-columns: minmax(0, 1.25fr) minmax(86px, .55fr);
  gap: 6px;
}

.traffic-exec-like-metric {
  min-height: 66px;
  padding: 8px;
}

.traffic-exec-metrics {
  grid-template-columns: minmax(92px, .42fr) minmax(0, 1fr);
  gap: 6px;
}

.traffic-exec-metrics .traffic-mini-metrics {
  grid-template-columns: 1fr;
  gap: 5px;
}

.traffic-exec-metrics .traffic-mini-metrics .metric-bar {
  min-height: 28px;
  padding: 6px 7px;
}

.traffic-exec-metrics .traffic-mini-metrics .metric-bar.with-values {
  gap: 3px;
}

.traffic-exec-metrics .traffic-mini-metrics .metric-bar.with-values :deep(.metric-track) {
  height: 9px;
  min-height: 9px;
}

.traffic-exec-metrics .traffic-mini-metrics .metric-bar.with-values :deep(em strong),
.traffic-exec-metrics .traffic-mini-metrics .metric-bar.with-values :deep(em small) {
  font-size: 10px;
  line-height: 1;
}

.traffic-exec-progress :deep(.layered-track),
.traffic-play-stage .layered-track,
.traffic-strip-play :deep(.layered-track),
.traffic-group-monitor-panel .layered-track,
.traffic-project-visuals > .layered-progress :deep(.layered-track),
.layered-progress :deep(.layered-track),
.metric-bar :deep(.metric-track),
.traffic-project-metric-bars .metric-bar .metric-track {
  border-color: var(--traffic-track-border);
  background: var(--traffic-track-bg);
  box-shadow:
    inset 0 1px 2px rgba(31, 41, 55, .045),
    0 1px 0 rgba(255, 255, 255, .82);
}

.layered-progress :deep(.layered-track) {
  border-radius: 13px;
}

.traffic-exec-progress :deep(.layered-track) {
  height: 31px;
  border-radius: 13px;
}

.traffic-strip-play :deep(.layered-track) {
  height: 19px;
}

.traffic-group-monitor-panel .layered-track {
  height: 26px;
}

.layered-progress :deep(.layered-track .target) {
  background:
    linear-gradient(90deg, rgba(255, 255, 255, .22), rgba(255, 255, 255, 0)),
    rgba(221, 252, 241, .34);
}

.layered-progress :deep(.layered-track .planned),
.metric-bar :deep(.metric-planned),
.traffic-project-metric-bars .metric-bar .metric-planned {
  background: var(--traffic-planned-bg);
  box-shadow:
    inset 0 0 0 1px rgba(59, 130, 246, .14),
    inset 0 1px 0 rgba(255, 255, 255, .50);
}

.layered-progress :deep(.layered-track .actual),
.metric-bar :deep(.metric-actual),
.traffic-project-metric-bars .metric-bar .metric-actual {
  background: var(--traffic-actual-bg);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, .76),
    0 5px 12px rgba(34, 197, 94, .18);
}

.metric-bar {
  border-color: color-mix(in srgb, var(--project-accent, var(--traffic-sky)) 16%, var(--traffic-soft-border));
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .76), rgba(255, 255, 255, .36)),
    color-mix(in srgb, var(--project-wash, rgba(139, 216, 255, .12)) 64%, var(--traffic-paper-soft));
}

.metric-bar em strong {
  color: var(--traffic-ink);
}

.metric-bar :deep(em strong) {
  color: color-mix(in srgb, var(--traffic-ink) 86%, var(--project-accent, var(--traffic-sky)));
}

.metric-bar :deep(em small) {
  color: color-mix(in srgb, var(--text-muted) 88%, var(--usagi-orange, #f59e0b));
}

.metric-bar.with-values :deep(.metric-track) {
  height: 17px;
  border-radius: 10px;
}

.traffic-exec-metrics > .metric-bar {
  min-height: 72px;
}

.traffic-exec-metrics .traffic-mini-metrics .metric-bar {
  min-height: 44px;
}

.traffic-visual-legend i::before,
.layered-legend .planned::before {
  background: var(--traffic-planned-bg);
  border: 1px solid rgba(96, 165, 250, .22);
}

.traffic-visual-legend b::before,
.layered-legend .actual::before {
  background: var(--traffic-actual-bg);
}

.traffic-visual-legend em::before,
.layered-legend .gap::before {
  background: linear-gradient(90deg, #fde68a, #f59e0b);
}

.traffic-apply-main {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .56), rgba(255, 255, 255, .22)),
    var(--traffic-paper);
}

.traffic-apply-head,
.traffic-apply-progress,
.traffic-apply-workspace {
  border-color: var(--traffic-soft-border);
}

.traffic-result-card {
  border-color: var(--traffic-soft-border);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .70), rgba(255, 255, 255, .34)),
    var(--traffic-paper-soft);
}

.traffic-result-card.good {
  border-color: color-mix(in srgb, var(--traffic-mint-deep) 34%, var(--traffic-soft-border));
}

.traffic-result-card.warn,
.traffic-result-card.bad {
  border-color: color-mix(in srgb, #f59e0b 34%, var(--traffic-soft-border));
}

.traffic-maintenance-table th {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .72), rgba(255, 255, 255, .36)),
    var(--traffic-paper-strong);
}

.traffic-maintenance-table th,
.traffic-maintenance-table td {
  border-bottom-color: color-mix(in srgb, var(--traffic-soft-border) 72%, transparent);
}

.traffic-comment-entry :deep(.comment-card),
.traffic-comment-entry :deep(.card-body) {
  background: transparent;
}

.traffic-empty {
  border-color: color-mix(in srgb, var(--traffic-soft-border) 80%, transparent);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--traffic-honey) 22%, transparent), transparent 62%),
    var(--traffic-paper-soft);
}

.traffic-modal-mask {
  background:
    radial-gradient(circle at 50% 20%, rgba(255, 248, 214, .28), transparent 32%),
    rgba(74, 48, 36, .30);
  backdrop-filter: blur(7px);
}

.traffic-modal {
  border: 1px solid color-mix(in srgb, var(--traffic-soft-border) 84%, var(--usagi-ink, #4a3024) 12%);
  border-radius: 18px;
  background:
    radial-gradient(circle at 32px 28px, color-mix(in srgb, var(--traffic-honey) 34%, transparent) 0 22px, transparent 23px),
    radial-gradient(circle at calc(100% - 40px) 30px, color-mix(in srgb, var(--traffic-peach) 28%, transparent) 0 20px, transparent 21px),
    linear-gradient(180deg, rgba(255, 255, 255, .80), rgba(255, 255, 255, .46)),
    var(--traffic-paper);
  box-shadow: 0 28px 70px rgba(31, 41, 55, .22), var(--traffic-sticker-shadow);
  animation: trafficModalIn var(--motion-mid) var(--ease-out) both;
}

.traffic-modal header {
  margin: -2px -2px 2px;
  padding: 4px 2px 10px;
  border: 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--traffic-soft-border) 84%, transparent);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.traffic-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 6px;
}

.traffic-edit-project-hint {
  margin: -2px 0 4px;
  color: var(--traffic-muted);
  font-size: 12px;
  line-height: 1.6;
}

.traffic-parse-preview {
  border-color: var(--traffic-soft-border);
  background: rgba(255, 255, 255, .50);
}

.traffic-plan-v2 .btn-primary {
  border-color: color-mix(in srgb, var(--usagi-ink, #4a3024) 22%, var(--traffic-honey));
  background: linear-gradient(135deg, var(--traffic-honey), color-mix(in srgb, var(--traffic-mint) 26%, #fff4c7));
  color: var(--usagi-ink, #4a3024);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--traffic-honey) 18%, transparent);
}

.traffic-plan-v2 .btn-ghost {
  border-color: color-mix(in srgb, var(--traffic-soft-border) 82%, transparent);
  background: rgba(255, 255, 255, .42);
}

.traffic-plan-v2 .btn-danger {
  border-color: rgba(251, 146, 60, .34);
  background: rgba(255, 247, 237, .72);
  color: #b45309;
}

@keyframes trafficModalIn {
  from {
    opacity: 0;
    transform: translateY(10px) scale(.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes trafficToastPop {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes trafficFadeLift {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes trafficAttention {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
  }
  50% {
    box-shadow: 0 0 0 3px rgba(245, 158, 11, .10);
  }
}

@media (prefers-reduced-motion: reduce) {
  .traffic-plan-v2,
  .traffic-plan-v2 *,
  .traffic-plan-v2 *::before,
  .traffic-plan-v2 *::after {
    animation: none !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}

@media (max-width: 1180px) {
  .traffic-topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .traffic-top-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .traffic-tabs {
    width: 100%;
  }

  .traffic-tabs button {
    flex: 1;
  }

  .traffic-monitor-layout,
  .traffic-apply-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }

  .traffic-summary-panel,
  .traffic-exec-row,
  .traffic-exec-header,
  .traffic-monitor-overview,
  .traffic-apply-main {
    grid-template-columns: 1fr;
  }

  .traffic-command-deck,
  .traffic-command-scope,
  .traffic-cockpit-head,
  .traffic-cockpit-body,
  .traffic-group-monitor-panel,
  .traffic-exec-progress-stack,
  .traffic-exec-metrics {
    grid-template-columns: 1fr;
  }

  .traffic-command-stack,
  .traffic-summary-facts,
  .traffic-interaction-stage,
  .traffic-group-metrics,
  .traffic-exec-metrics .traffic-mini-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .traffic-overview-kpis,
  .traffic-summary-meta,
  .traffic-visual-metrics,
  .traffic-project-visual-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .traffic-monitor-overview,
  .traffic-summary-panel,
  .traffic-exec-row,
  .traffic-exec-header {
    grid-template-columns: 1fr;
  }

  .traffic-exec-header {
    display: none;
  }

  .traffic-project-visuals,
  .traffic-project-metric-bars {
    grid-template-columns: 1fr;
  }

  .traffic-project-visuals {
    margin: 0;
  }

  .traffic-project-visual-grid {
    padding: 0;
  }

  .traffic-project-metric-bars {
    grid-column: auto;
    grid-row: auto;
  }

  .traffic-mini-metrics.visual {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .traffic-exec-right {
    grid-template-columns: 1fr;
  }

  .traffic-result-panel,
  .traffic-apply-head,
  .traffic-apply-progress,
  .traffic-apply-workspace {
    grid-column: auto;
    grid-row: auto;
    position: static;
  }

  .traffic-apply-progress-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .traffic-command-stack,
  .traffic-summary-facts,
  .traffic-interaction-stage,
  .traffic-group-metrics,
  .traffic-exec-metrics .traffic-mini-metrics {
    grid-template-columns: 1fr;
  }
}

/* Final theme correction: keep each global style in its own color language. */
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-topbar),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-tabs),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-summary-panel),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-execution-panel),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-rail),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-apply-rail),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-apply-main),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-modal ){
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .075), rgba(255, 255, 255, .025)),
    color-mix(in srgb, var(--panel-bg) 96%, #0d0b1d) !important;
  border-color: color-mix(in srgb, var(--border) 82%, var(--primary) 18%);
  box-shadow: 0 12px 26px rgba(0, 0, 0, .26);
}

:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-item),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-tree-project-head),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-tree-account),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-unlinked-create),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-command-deck),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-group-monitor-panel),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-cockpit),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-exec-row),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .metric-bar),
:global(:root[data-ui-style="violet"] .traffic-plan-v2 .traffic-result-card ){
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 10%, transparent), transparent 72%),
    linear-gradient(180deg, rgba(255, 255, 255, .08), rgba(255, 255, 255, .025)),
    color-mix(in srgb, var(--panel-bg) 96%, #0d0b1d) !important;
}

:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-topbar),
:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-tabs),
:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-summary-panel),
:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-execution-panel),
:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-project-rail),
:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-apply-rail),
:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-apply-main),
:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-modal ){
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .74), rgba(255, 255, 255, .34)),
    rgba(255, 255, 255, .82) !important;
  border-color: color-mix(in srgb, var(--border) 86%, var(--primary) 14%);
}

:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-tabs button.active),
:global(:root[data-ui-style="apple"] .traffic-plan-v2 .traffic-view-switch button.active ){
  background: linear-gradient(135deg, rgba(0, 122, 255, .13), rgba(255, 255, 255, .72)) !important;
  color: var(--text);
}

:global(:root[data-ui-style="usagi"] .traffic-plan-v2 .traffic-tabs button.active),
:global(:root[data-ui-style="usagi"] .traffic-plan-v2 .traffic-view-switch button.active ){
  background: linear-gradient(135deg, var(--usagi-yellow), var(--usagi-cream)) !important;
  color: var(--usagi-ink);
}

/* Hard theme reset for the traffic module. This keeps global style switches honest. */
:global(html[data-ui-style="apple"]) .traffic-plan-v2 {
  --traffic-ink: var(--text);
  --traffic-paper: rgba(255, 255, 255, .84);
  --traffic-paper-strong: rgba(255, 255, 255, .94);
  --traffic-paper-soft: rgba(246, 248, 252, .78);
  --traffic-soft-border: rgba(0, 0, 0, .08);
  color: var(--text) !important;
}

:global(html[data-ui-style="apple"]) .traffic-plan-v2 :where(.traffic-topbar, .traffic-tabs, .traffic-summary-panel, .traffic-execution-panel, .traffic-project-rail, .traffic-apply-rail, .traffic-apply-main, .traffic-modal) {
  background-color: rgba(255, 255, 255, .84) !important;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, .74), rgba(255, 255, 255, .34)) !important;
  border-color: rgba(0, 0, 0, .08) !important;
  color: var(--text) !important;
  box-shadow: 0 12px 28px rgba(0, 0, 0, .07) !important;
}

:global(html[data-ui-style="apple"]) .traffic-plan-v2 :where(.traffic-project-item, .traffic-tree-project-head, .traffic-tree-account, .traffic-unlinked-create, .traffic-command-deck, .traffic-group-monitor-panel, .traffic-project-cockpit, .traffic-exec-row, .metric-bar, .traffic-result-card) {
  background-color: rgba(255, 255, 255, .78) !important;
  background-image:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 8%, transparent), transparent 72%),
    linear-gradient(180deg, rgba(255, 255, 255, .70), rgba(255, 255, 255, .34)) !important;
  color: var(--text) !important;
}

:global(html[data-ui-style="violet"]) .traffic-plan-v2 {
  --traffic-ink: var(--text);
  --traffic-paper: rgba(18, 18, 42, .84);
  --traffic-paper-strong: rgba(32, 29, 56, .90);
  --traffic-paper-soft: rgba(32, 29, 56, .62);
  --traffic-soft-border: rgba(196, 181, 253, .22);
  color: var(--text) !important;
}

:global(html[data-ui-style="violet"]) .traffic-plan-v2 :where(.traffic-topbar, .traffic-tabs, .traffic-summary-panel, .traffic-execution-panel, .traffic-project-rail, .traffic-apply-rail, .traffic-apply-main, .traffic-modal) {
  background-color: rgba(18, 18, 42, .84) !important;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, .075), rgba(255, 255, 255, .025)) !important;
  border-color: rgba(196, 181, 253, .22) !important;
  color: var(--text) !important;
  box-shadow: 0 12px 26px rgba(0, 0, 0, .26) !important;
}

:global(html[data-ui-style="violet"]) .traffic-plan-v2 :where(.traffic-project-item, .traffic-tree-project-head, .traffic-tree-account, .traffic-unlinked-create, .traffic-command-deck, .traffic-group-monitor-panel, .traffic-project-cockpit, .traffic-exec-row, .metric-bar, .traffic-result-card) {
  background-color: rgba(18, 18, 42, .86) !important;
  background-image:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 10%, transparent), transparent 72%),
    linear-gradient(180deg, rgba(255, 255, 255, .08), rgba(255, 255, 255, .025)) !important;
  color: var(--text) !important;
}

:global(html[data-ui-style="usagi"]) .traffic-plan-v2 {
  --traffic-ink: var(--text);
  --traffic-paper: rgba(255, 251, 241, .78);
  --traffic-paper-strong: rgba(255, 253, 247, .92);
  --traffic-paper-soft: rgba(239, 222, 190, .62);
  --traffic-soft-border: rgba(110, 72, 47, .14);
  color: var(--text) !important;
}

:global(html[data-ui-style="usagi"]) .traffic-plan-v2 :where(.traffic-topbar, .traffic-tabs, .traffic-summary-panel, .traffic-execution-panel, .traffic-project-rail, .traffic-apply-rail, .traffic-apply-main, .traffic-modal) {
  background-color: rgba(255, 251, 241, .78) !important;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, .58), rgba(255, 255, 255, .18)) !important;
  border-color: rgba(110, 72, 47, .14) !important;
  color: var(--text) !important;
}

/* Theme bridge: visual polish follows the active global style, not one fixed palette. */
.traffic-plan-v2 {
  --traffic-paper: var(--panel-bg);
  --traffic-paper-strong: var(--card-bg, var(--panel-bg));
  --traffic-paper-soft: var(--panel-bg-soft);
  --traffic-ink: var(--text);
  --traffic-soft-border: var(--border);
  --traffic-theme-surface: var(--panel-bg);
  --traffic-theme-card: var(--panel-bg-soft);
  --traffic-theme-card-hover: var(--panel-bg-hover, var(--panel-bg));
  --traffic-theme-active: var(--active-bg);
  --traffic-theme-chip: var(--chip-bg, var(--panel-bg-soft));
  --traffic-theme-shadow: var(--shadow);
  --traffic-theme-track: color-mix(in srgb, var(--panel-bg-soft) 78%, var(--card-bg, var(--panel-bg)));
  color: var(--text) !important;
}

:global(html[data-ui-style="violet"]) .traffic-plan-v2 {
  --traffic-theme-surface: rgba(18, 18, 42, .82);
  --traffic-theme-card: rgba(32, 29, 56, .58);
  --traffic-theme-card-hover: rgba(38, 34, 68, .76);
  --traffic-theme-chip: rgba(255, 255, 255, .08);
  --traffic-theme-shadow: 0 12px 28px rgba(0, 0, 0, .28);
  --traffic-theme-track: linear-gradient(180deg, rgba(255, 255, 255, .08), rgba(125, 211, 252, .055)), rgba(32, 29, 56, .62);
  --traffic-planned-bg:
    repeating-linear-gradient(-45deg, rgba(96, 165, 250, .34) 0 7px, rgba(125, 211, 252, .16) 7px 14px),
    linear-gradient(90deg, rgba(59, 130, 246, .34), rgba(125, 211, 252, .22));
  --traffic-actual-bg: linear-gradient(90deg, #5eead4, #34d399 72%, #22c55e);
}

:global(html[data-ui-style="apple"]) .traffic-plan-v2 {
  --traffic-theme-surface: rgba(255, 255, 255, .84);
  --traffic-theme-card: rgba(246, 248, 252, .82);
  --traffic-theme-card-hover: rgba(255, 255, 255, .96);
  --traffic-theme-chip: rgba(255, 255, 255, .72);
  --traffic-theme-shadow: 0 12px 28px rgba(0, 0, 0, .07);
  --traffic-theme-track: linear-gradient(180deg, rgba(255, 255, 255, .92), rgba(239, 246, 255, .86));
  --traffic-planned-bg:
    repeating-linear-gradient(-45deg, rgba(59, 130, 246, .24) 0 7px, rgba(191, 219, 254, .38) 7px 14px),
    linear-gradient(90deg, rgba(147, 197, 253, .56), rgba(219, 234, 254, .72));
  --traffic-actual-bg: linear-gradient(90deg, #86efac, #34d399 72%, #10b981);
}

:global(html[data-ui-style="usagi"]) .traffic-plan-v2 {
  --traffic-theme-surface: rgba(255, 253, 247, .82);
  --traffic-theme-card: rgba(255, 249, 235, .72);
  --traffic-theme-card-hover: rgba(255, 253, 247, .94);
  --traffic-theme-chip: rgba(255, 255, 255, .62);
  --traffic-theme-shadow: 0 12px 26px rgba(90, 61, 31, .08);
  --traffic-theme-track: linear-gradient(180deg, #fffefa, #effdf8);
  --traffic-planned-bg:
    repeating-linear-gradient(-45deg, rgba(125, 211, 252, .30) 0 7px, rgba(224, 242, 254, .52) 7px 14px),
    linear-gradient(90deg, rgba(186, 230, 253, .62), rgba(219, 234, 254, .60));
  --traffic-actual-bg: linear-gradient(90deg, #99f6e4, #86efac 70%, #34d399);
}

:global(html[data-ui-style]) .traffic-plan-v2 :where(.traffic-topbar, .traffic-tabs, .traffic-summary-panel, .traffic-execution-panel, .traffic-project-rail, .traffic-apply-rail, .traffic-apply-main, .traffic-modal) {
  background: var(--traffic-theme-surface) !important;
  border-color: var(--border) !important;
  color: var(--text) !important;
  box-shadow: var(--traffic-theme-shadow) !important;
}

:global(html[data-ui-style]) .traffic-plan-v2 :where(.traffic-project-item, .traffic-tree-project-head, .traffic-tree-account, .traffic-unlinked-create, .traffic-command-deck, .traffic-group-monitor-panel, .traffic-project-cockpit, .traffic-exec-row, .metric-bar, .traffic-result-card, .traffic-form-panel, .traffic-maintenance-wrap, .traffic-comment-entry, .traffic-settings-box, .traffic-apply-progress) {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 7%, transparent), transparent 74%),
    var(--traffic-theme-card) !important;
  border-color: var(--border) !important;
  color: var(--text) !important;
}

:global(html[data-ui-style]) .traffic-plan-v2 :where(.traffic-project-item.active, .traffic-tree-account.active, .traffic-exec-row:hover, .traffic-project-cockpit:hover) {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 12%, transparent), transparent 76%),
    var(--traffic-theme-card-hover) !important;
}

:global(html[data-ui-style]) .traffic-plan-v2 :where(.traffic-tabs button.active, .traffic-view-switch button.active) {
  background: var(--traffic-theme-active) !important;
  border-color: var(--border-bright, var(--border)) !important;
  color: var(--text) !important;
}

:global(html[data-ui-style]) .traffic-plan-v2 :where(.traffic-current-group, .traffic-view-switch button, .traffic-command-button, .traffic-tree-tools button, .traffic-settings-toggle, .traffic-strip-facts b, .traffic-summary-facts b, .traffic-finance-stage span, .traffic-project-brief b, .traffic-tree-account b, .traffic-tree-project-head > b, .traffic-apply-progress-meta span, .traffic-group-metrics span, .traffic-exec-side b) {
  background: var(--traffic-theme-chip) !important;
  border-color: var(--border) !important;
  color: var(--text-muted) !important;
}

:global(html[data-ui-style]) .traffic-plan-v2 :where(.inp, input, select, textarea) {
  background: var(--traffic-theme-chip) !important;
  border-color: color-mix(in srgb, var(--border) 82%, var(--primary) 18%) !important;
  color: var(--text) !important;
}

:global(html[data-ui-style]) .traffic-plan-v2 :where(.traffic-maintenance-table th) {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 10%, transparent), transparent 70%),
    var(--traffic-theme-chip) !important;
  border-color: var(--border) !important;
  color: var(--text-muted) !important;
}

:global(html[data-ui-style]) .traffic-plan-v2 :where(.traffic-maintenance-table td) {
  border-color: color-mix(in srgb, var(--border) 72%, transparent) !important;
}

:global(html[data-ui-style]) .traffic-plan-v2 :where(.traffic-exec-progress .layered-track, .traffic-play-stage .layered-track, .traffic-strip-play .layered-track, .traffic-group-monitor-panel .layered-track, .traffic-project-visuals > .layered-progress .layered-track, .layered-progress .layered-track, .metric-bar .metric-track, .traffic-project-metric-bars .metric-bar .metric-track, .traffic-project-mini-track, .traffic-tree-progress) {
  background: var(--traffic-theme-track) !important;
  border-color: color-mix(in srgb, var(--border) 78%, var(--primary) 22%) !important;
}

/* Scoped CSS cannot reliably out-rank the earlier decorative blocks above, so these
   fully-global selectors pin the traffic module to the active app theme. */
:global(html[data-ui-style] .traffic-plan-v2 .traffic-topbar),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tabs),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-summary-panel),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-execution-panel),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-rail),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-apply-rail),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-apply-main),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-modal) {
  background: var(--traffic-theme-surface) !important;
  border-color: var(--border) !important;
  color: var(--text) !important;
  box-shadow: var(--traffic-theme-shadow) !important;
}

:global(html[data-ui-style] .traffic-plan-v2 .traffic-topbar) {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 5%, transparent), transparent 62%),
    var(--traffic-theme-surface) !important;
}

:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-item),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tree-project-head),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tree-account),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-unlinked-create),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-command-deck),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-group-monitor-panel),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-cockpit),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-exec-row),
:global(html[data-ui-style] .traffic-plan-v2 .metric-bar),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-result-card),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-form-panel),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-maintenance-wrap),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-comment-entry),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-settings-box),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-apply-progress) {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 7%, transparent), transparent 74%),
    var(--traffic-theme-card) !important;
  border-color: var(--border) !important;
  color: var(--text) !important;
}

:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-item.active),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tree-account.active),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-exec-row:hover),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-cockpit:hover) {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 12%, transparent), transparent 76%),
    var(--traffic-theme-card-hover) !important;
}

:global(html[data-ui-style] .traffic-plan-v2 .traffic-tabs button.active),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-view-switch button.active) {
  background: var(--traffic-theme-active) !important;
  border-color: var(--border-bright, var(--border)) !important;
  color: var(--text) !important;
}

:global(html[data-ui-style] .traffic-plan-v2 .inp),
:global(html[data-ui-style] .traffic-plan-v2 input),
:global(html[data-ui-style] .traffic-plan-v2 select),
:global(html[data-ui-style] .traffic-plan-v2 textarea) {
  background: var(--traffic-theme-chip) !important;
  border-color: color-mix(in srgb, var(--border) 82%, var(--primary) 18%) !important;
  color: var(--text) !important;
}

:global(html[data-ui-style] .traffic-plan-v2 .traffic-exec-progress .layered-track),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-play-stage .layered-track),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-strip-play .layered-track),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-group-monitor-panel .layered-track),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-visuals > .layered-progress .layered-track),
:global(html[data-ui-style] .traffic-plan-v2 .layered-progress .layered-track),
:global(html[data-ui-style] .traffic-plan-v2 .metric-bar .metric-track),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-metric-bars .metric-bar .metric-track),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-mini-track),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tree-progress) {
  background: var(--traffic-theme-track) !important;
  border-color: color-mix(in srgb, var(--border) 78%, var(--primary) 22%) !important;
}

/* Violet should feel like the app's night mode, not a stack of grey disabled chips. */
:global(html[data-ui-style="violet"] .traffic-plan-v2) {
  --traffic-theme-surface: rgba(17, 24, 56, .84);
  --traffic-theme-card: rgba(27, 39, 84, .64);
  --traffic-theme-card-hover: rgba(37, 50, 104, .78);
  --traffic-theme-chip: rgba(124, 58, 237, .16);
  --traffic-theme-active: linear-gradient(135deg, rgba(124, 58, 237, .62), rgba(37, 99, 235, .34));
  --traffic-theme-shadow: 0 16px 34px rgba(0, 0, 0, .30);
  --traffic-theme-track: linear-gradient(180deg, rgba(255, 255, 255, .075), rgba(56, 189, 248, .08)), rgba(18, 31, 68, .76);
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-topbar),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-summary-panel),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-execution-panel),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-rail) {
  background:
    radial-gradient(circle at 12% 0%, rgba(124, 58, 237, .18), transparent 38%),
    linear-gradient(180deg, rgba(59, 130, 246, .10), rgba(15, 23, 42, .05)),
    var(--traffic-theme-surface) !important;
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-item),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-command-deck),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-group-monitor-panel),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-cockpit),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-exec-row),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .metric-bar) {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, #60a5fa) 14%, transparent), transparent 74%),
    linear-gradient(180deg, rgba(124, 58, 237, .10), rgba(14, 165, 233, .045)),
    var(--traffic-theme-card) !important;
  border-color: rgba(129, 140, 248, .30) !important;
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-exec-header),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-maintenance-table th) {
  background:
    linear-gradient(90deg, rgba(124, 58, 237, .18), rgba(56, 189, 248, .10)),
    rgba(20, 34, 72, .86) !important;
  color: rgba(240, 238, 245, .86) !important;
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-current-group),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-view-switch button),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-command-button),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-tree-tools button),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-settings-toggle),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-strip-facts b),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-summary-facts b),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-finance-stage span),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-brief b),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-tree-account b),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-tree-project-head > b),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-apply-progress-meta span),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-group-metrics span),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-exec-side b) {
  background:
    linear-gradient(135deg, rgba(124, 58, 237, .20), rgba(56, 189, 248, .10)) !important;
  border-color: rgba(129, 140, 248, .34) !important;
  color: rgba(240, 238, 245, .82) !important;
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-top-actions .btn:not(:disabled)),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-exec-side .btn:not(:disabled)),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-strip-edit:not(:disabled)) {
  background:
    linear-gradient(135deg, rgba(124, 58, 237, .34), rgba(37, 99, 235, .22)) !important;
  border-color: rgba(129, 140, 248, .42) !important;
  color: rgba(248, 250, 252, .92) !important;
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .btn-primary:not(:disabled)),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-command-button.primary) {
  background:
    linear-gradient(135deg, rgba(45, 212, 191, .36), rgba(124, 58, 237, .34)) !important;
  border-color: rgba(94, 234, 212, .42) !important;
  color: #f8fafc !important;
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .btn:disabled) {
  background: rgba(124, 58, 237, .12) !important;
  border-color: rgba(129, 140, 248, .18) !important;
  color: rgba(240, 238, 245, .44) !important;
  opacity: .78;
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-item > b) {
  background:
    radial-gradient(circle at 35% 30%, rgba(94, 234, 212, .42), transparent 48%),
    linear-gradient(135deg, rgba(124, 58, 237, .34), rgba(37, 99, 235, .22)) !important;
  color: rgba(248, 250, 252, .94) !important;
  border: 1px solid rgba(129, 140, 248, .34);
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-mini-track),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-tree-progress),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .layered-track),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .metric-track) {
  background: var(--traffic-theme-track) !important;
  border-color: rgba(125, 211, 252, .32) !important;
}

/* Testing mode polish: keep the visual bars clear but lighter, so real data can lead. */
.traffic-plan-v2 .traffic-exec-progress :deep(.layered-track) {
  height: 22px !important;
  border-radius: 10px !important;
}

.traffic-plan-v2 .traffic-exec-progress :deep(.layered-track .actual) {
  top: 5px !important;
  bottom: 5px !important;
}

.traffic-plan-v2 .traffic-strip-play :deep(.layered-track) {
  height: 13px !important;
  border-radius: 8px !important;
}

.traffic-plan-v2 .traffic-strip-play :deep(.layered-track .actual) {
  top: 4px !important;
  bottom: 4px !important;
}

.traffic-plan-v2 .traffic-group-monitor-panel .layered-track {
  height: 18px !important;
  border-radius: 9px !important;
}

.traffic-plan-v2 .metric-bar :deep(.metric-track),
.traffic-plan-v2 .traffic-project-metric-bars .metric-bar .metric-track {
  height: 10px !important;
  min-height: 10px !important;
  border-radius: 7px !important;
}

.traffic-plan-v2 .traffic-exec-like-metric :deep(.metric-track) {
  height: 14px !important;
  min-height: 14px !important;
}

.traffic-plan-v2 .traffic-exec-metrics .traffic-mini-metrics .metric-bar :deep(.metric-track) {
  height: 8px !important;
  min-height: 8px !important;
}

.traffic-plan-v2 .layered-progress :deep(.layered-track)::after {
  inset: 2px !important;
}

/* Visual settle pass: keep traffic plan consistent in violet / apple / usagi without touching data logic. */
.traffic-plan-v2 {
  --traffic-v2-surface: var(--panel-bg);
  --traffic-v2-card: color-mix(in srgb, var(--panel-bg) 88%, var(--panel-bg-soft));
  --traffic-v2-card-soft: color-mix(in srgb, var(--panel-bg-soft) 88%, var(--panel-bg));
  --traffic-v2-chip: color-mix(in srgb, var(--chip-bg, var(--panel-bg-soft)) 86%, var(--panel-bg));
  --traffic-v2-border: color-mix(in srgb, var(--border) 86%, var(--primary) 14%);
  --traffic-v2-shadow: 0 10px 24px rgba(15, 23, 42, .06);
  --traffic-v2-track: linear-gradient(180deg, rgba(255, 255, 255, .94), rgba(240, 253, 250, .88)), #ecfeff;
  --traffic-v2-planned:
    repeating-linear-gradient(-45deg, rgba(59, 130, 246, .22) 0 6px, rgba(191, 219, 254, .38) 6px 12px),
    linear-gradient(90deg, rgba(186, 230, 253, .58), rgba(219, 234, 254, .68));
  --traffic-v2-actual: linear-gradient(90deg, #6ee7b7, #34d399 72%, #10b981);
}

:global(html[data-ui-style="violet"] .traffic-plan-v2) {
  --traffic-v2-surface: rgba(16, 23, 54, .88);
  --traffic-v2-card: rgba(27, 38, 78, .78);
  --traffic-v2-card-soft: rgba(35, 48, 94, .62);
  --traffic-v2-chip: rgba(107, 114, 255, .16);
  --traffic-v2-border: rgba(129, 140, 248, .30);
  --traffic-v2-shadow: 0 14px 30px rgba(0, 0, 0, .26);
  --traffic-v2-track: linear-gradient(180deg, rgba(255, 255, 255, .08), rgba(56, 189, 248, .055)), rgba(18, 31, 68, .82);
  --traffic-v2-planned:
    repeating-linear-gradient(-45deg, rgba(96, 165, 250, .32) 0 6px, rgba(125, 211, 252, .13) 6px 12px),
    linear-gradient(90deg, rgba(59, 130, 246, .30), rgba(125, 211, 252, .18));
  --traffic-v2-actual: linear-gradient(90deg, #5eead4, #34d399 72%, #22c55e);
}

:global(html[data-ui-style="apple"] .traffic-plan-v2) {
  --traffic-v2-surface: rgba(255, 255, 255, .86);
  --traffic-v2-card: rgba(255, 255, 255, .78);
  --traffic-v2-card-soft: rgba(246, 248, 252, .86);
  --traffic-v2-chip: rgba(255, 255, 255, .72);
  --traffic-v2-border: rgba(0, 0, 0, .08);
  --traffic-v2-shadow: 0 12px 28px rgba(0, 0, 0, .07);
  --traffic-v2-track: linear-gradient(180deg, rgba(255, 255, 255, .96), rgba(239, 246, 255, .86));
}

:global(html[data-ui-style="usagi"] .traffic-plan-v2) {
  --traffic-v2-surface: rgba(255, 253, 247, .86);
  --traffic-v2-card: rgba(255, 249, 235, .78);
  --traffic-v2-card-soft: rgba(255, 246, 220, .78);
  --traffic-v2-chip: rgba(255, 255, 255, .66);
  --traffic-v2-border: rgba(110, 72, 47, .14);
  --traffic-v2-shadow: 0 12px 26px rgba(90, 61, 31, .08);
  --traffic-v2-track: linear-gradient(180deg, #fffefa, #f0fdf8);
  --traffic-v2-planned:
    repeating-linear-gradient(-45deg, rgba(125, 211, 252, .30) 0 6px, rgba(224, 242, 254, .52) 6px 12px),
    linear-gradient(90deg, rgba(186, 230, 253, .62), rgba(219, 234, 254, .60));
  --traffic-v2-actual: linear-gradient(90deg, #99f6e4, #86efac 70%, #34d399);
}

:global(html[data-ui-style] .traffic-plan-v2 .traffic-topbar),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tabs),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-rail),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-apply-rail),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-monitor-main),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-apply-main),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-modal) {
  background: var(--traffic-v2-surface) !important;
  border-color: var(--traffic-v2-border) !important;
  color: var(--text) !important;
  box-shadow: var(--traffic-v2-shadow) !important;
}

:global(html[data-ui-style] .traffic-plan-v2 .traffic-command-deck),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-group-monitor-panel),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-cockpit),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-execution-panel),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-exec-row),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-item),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tree-project-head),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tree-account),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-unlinked-create),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-apply-head),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-apply-progress),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-form-panel),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-maintenance-wrap),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-result-card),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-comment-entry),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-settings-box),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-parse-preview),
:global(html[data-ui-style] .traffic-plan-v2 .metric-bar) {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 5%, transparent), transparent 74%),
    var(--traffic-v2-card) !important;
  border-color: var(--traffic-v2-border) !important;
  color: var(--text) !important;
  box-shadow: 0 6px 18px rgba(15, 23, 42, .035) !important;
}

:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-command-deck),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-project-cockpit),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-exec-row),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-apply-progress),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-form-panel),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-maintenance-wrap),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .traffic-result-card),
:global(html[data-ui-style="violet"] .traffic-plan-v2 .metric-bar) {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, #60a5fa) 10%, transparent), transparent 74%),
    linear-gradient(180deg, rgba(124, 58, 237, .06), rgba(56, 189, 248, .025)),
    var(--traffic-v2-card) !important;
}

:global(html[data-ui-style] .traffic-plan-v2 .traffic-current-group),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-view-switch button),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-command-button),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tree-tools button),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-settings-toggle),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-strip-facts b),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-project-brief b),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tree-project-head > b),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-tree-account b),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-apply-progress-meta span),
:global(html[data-ui-style] .traffic-plan-v2 .traffic-exec-side b) {
  background: var(--traffic-v2-chip) !important;
  border-color: var(--traffic-v2-border) !important;
  color: var(--text-muted) !important;
}

.traffic-plan-v2 .traffic-apply-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid var(--traffic-v2-border);
  border-radius: 12px;
}

.traffic-plan-v2 .traffic-apply-head.empty {
  border-style: dashed;
}

.traffic-plan-v2 .traffic-apply-progress {
  min-height: 54px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: min-content;
  align-content: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
}

.traffic-plan-v2 .traffic-apply-progress-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.traffic-plan-v2 .traffic-apply-progress-title strong {
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-plan-v2 .traffic-apply-progress-title span {
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
}

.traffic-plan-v2 .traffic-apply-progress > .layered-progress {
  min-width: 0;
  gap: 0;
}

.traffic-plan-v2 .traffic-apply-progress > .layered-progress :deep(.layered-track) {
  height: 14px !important;
  border-radius: 999px !important;
}

.traffic-plan-v2 .traffic-apply-progress > .traffic-apply-progress-meta {
  display: none !important;
}

.traffic-plan-v2 .traffic-monitor-main {
  overflow-y: auto !important;
  overflow-x: hidden !important;
  align-content: start;
  padding-right: 4px;
}

.traffic-plan-v2 .traffic-execution-panel {
  overflow: visible !important;
}

.traffic-plan-v2 .traffic-execution-table {
  max-height: none !important;
  overflow: visible !important;
}

.traffic-plan-v2 .traffic-exec-header {
  position: sticky;
  top: 0;
  z-index: 4;
}

.traffic-plan-v2 .traffic-topbar {
  display: none !important;
}

.traffic-plan-v2 .module-page-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.traffic-plan-v2 .module-page-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.traffic-plan-v2 .module-page-copy {
  min-width: 0;
}

.traffic-plan-v2 .module-page-copy .module-page-kicker,
.traffic-plan-v2 .module-page-copy p {
  display: none !important;
}

.traffic-plan-v2 .module-page-copy h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.1;
}

.traffic-plan-v2 .traffic-tabs {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px !important;
  border-radius: 14px !important;
}

.traffic-plan-v2 .traffic-tabs > button {
  min-width: 108px;
  min-height: 34px;
  padding-inline: 14px;
}

.traffic-plan-v2 .traffic-tab-actions {
  min-width: 0;
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.traffic-plan-v2 .traffic-crm-refresh-meta {
  max-width: 168px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-plan-v2 .traffic-tabs {
  margin-top: 0;
}

.traffic-plan-v2 .traffic-exec-main {
  grid-template-columns: 66px minmax(0, 1fr);
  column-gap: 12px;
  align-items: center;
}

.traffic-plan-v2 .traffic-exec-main > strong,
.traffic-plan-v2 .traffic-exec-main > span:not(.traffic-exec-gap-ring),
.traffic-plan-v2 .traffic-exec-main > small {
  grid-column: 2;
}

.traffic-plan-v2 .traffic-exec-gap-cell {
  grid-column: 1;
  grid-row: 1 / span 3;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.traffic-plan-v2 .traffic-exec-gap-ring {
  --pct: 0%;
  width: 60px;
  height: 60px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 1px;
  justify-self: center;
  border-radius: 999px;
  position: relative;
  background: conic-gradient(var(--project-accent, var(--primary)) var(--pct), var(--traffic-track-bg) 0);
}

.traffic-plan-v2 .traffic-exec-gap-ring::after {
  content: "";
  position: absolute;
  inset: 6px;
  border-radius: inherit;
  background: var(--panel-bg);
}

.traffic-plan-v2 .traffic-exec-gap-ring b,
.traffic-plan-v2 .traffic-exec-gap-ring em {
  position: relative;
  z-index: 1;
  text-align: center;
}

.traffic-plan-v2 .traffic-exec-gap-ring b {
  max-width: 50px;
  overflow: hidden;
  color: var(--text);
  font-size: 10.5px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-plan-v2 .traffic-exec-gap-ring em {
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
}

.traffic-plan-v2 .traffic-exec-gap-time {
  width: 66px;
  max-width: 66px;
  overflow: hidden;
  display: flex !important;
  flex-direction: column;
  align-items: center;
  gap: 0 !important;
  color: color-mix(in srgb, var(--text-muted) 82%, transparent);
  font-size: 6.5px;
  font-weight: 800;
  line-height: .96;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-plan-v2 .traffic-exec-gap-time span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
  text-overflow: ellipsis;
}

.traffic-plan-v2 .traffic-exec-gap-time.closed {
  color: color-mix(in srgb, var(--text-muted) 62%, #f59e0b);
}

.traffic-plan-v2 .traffic-exec-core-metrics {
  grid-template-columns: minmax(0, 1fr) !important;
  gap: 8px;
}

.traffic-plan-v2 .traffic-apply-progress.empty {
  min-height: 86px;
  border-style: dashed;
  background: var(--traffic-v2-card-soft) !important;
}

.traffic-plan-v2 .traffic-apply-progress-empty {
  position: relative;
  padding-left: 28px;
}

.traffic-plan-v2 .traffic-apply-progress-empty::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 12px;
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--primary) 50%, var(--traffic-v2-border));
  border-radius: 999px;
  background: var(--traffic-v2-chip);
}

.traffic-plan-v2 .traffic-apply-progress-empty strong {
  font-size: 15px;
}

.traffic-plan-v2 .traffic-apply-progress-empty span {
  max-width: 560px;
}

.traffic-plan-v2 .traffic-apply-progress-meta {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.traffic-plan-v2 .traffic-apply-progress-meta span {
  min-height: 46px;
  align-content: center;
  padding: 7px 8px;
  border-radius: 10px;
}

.traffic-plan-v2 .traffic-apply-progress-meta b {
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-plan-v2 .traffic-form-panel,
.traffic-plan-v2 .traffic-maintenance-wrap,
.traffic-plan-v2 .traffic-comment-entry,
.traffic-plan-v2 .traffic-settings-box {
  border-radius: 12px;
}

.traffic-plan-v2 .traffic-account-picker-label {
  position: relative;
  z-index: 8;
}

.traffic-plan-v2 .traffic-account-picker {
  position: relative;
  min-width: 0;
}

.traffic-plan-v2 .traffic-account-suggestions {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  left: 0;
  width: min(420px, calc(100vw - 40px));
  min-width: 100%;
  max-height: 310px;
  overflow: auto;
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--traffic-v2-border);
  border-radius: 12px;
  background: var(--traffic-v2-surface);
  box-shadow: 0 18px 36px rgba(15, 23, 42, .16);
}

.traffic-plan-v2 .traffic-account-suggestions button {
  min-width: 0;
  display: grid;
  gap: 3px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--traffic-v2-border) 82%, transparent);
  border-left: 4px solid var(--project-accent, var(--primary));
  border-radius: 10px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 8%, transparent), transparent 78%),
    var(--traffic-v2-card);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.traffic-plan-v2 .traffic-account-suggestions button:hover,
.traffic-plan-v2 .traffic-account-suggestions button.linked {
  border-color: color-mix(in srgb, var(--primary) 34%, var(--traffic-v2-border));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--project-accent, var(--primary)) 14%, transparent), transparent 78%),
    var(--traffic-v2-card-soft);
}

.traffic-plan-v2 .traffic-account-suggestions strong,
.traffic-plan-v2 .traffic-account-suggestions span,
.traffic-plan-v2 .traffic-account-suggestions em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-plan-v2 .traffic-account-suggestions strong {
  color: var(--text);
  font-size: 13px;
  line-height: 1.15;
}

.traffic-plan-v2 .traffic-account-suggestions span,
.traffic-plan-v2 .traffic-account-suggestions em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  line-height: 1.18;
}

.traffic-plan-v2 .traffic-account-suggestion-empty {
  padding: 10px;
  border: 1px dashed var(--traffic-v2-border);
  border-radius: 10px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.traffic-plan-v2 .traffic-form-grid label span,
.traffic-plan-v2 .traffic-create-actions label span {
  color: var(--text-muted);
}

.traffic-plan-v2 .traffic-phase-control button,
.traffic-plan-v2 .traffic-modal-actions .btn,
.traffic-plan-v2 .traffic-create-actions .btn,
.traffic-plan-v2 .traffic-result-panel > .btn {
  border-radius: 999px;
}

.traffic-plan-v2 .traffic-maintenance-table th,
.traffic-plan-v2 .traffic-maintenance-table td {
  padding: 9px 10px;
}

.traffic-plan-v2 .traffic-maintenance-table th {
  background: var(--traffic-v2-card-soft) !important;
}

.traffic-plan-v2 .traffic-result-panel {
  gap: 9px;
}

.traffic-plan-v2 .traffic-result-card {
  border-radius: 12px;
  padding: 10px 11px;
}

.traffic-plan-v2 .traffic-result-card strong {
  color: var(--text);
  font-size: 22px;
  line-height: 1.05;
}

.traffic-plan-v2 .traffic-review-head {
  padding: 0 2px;
}

.traffic-plan-v2 .traffic-review {
  border-radius: 12px;
  background: var(--traffic-v2-chip) !important;
}

.traffic-plan-v2 .traffic-modal-mask {
  backdrop-filter: blur(8px);
}

.traffic-plan-v2 .traffic-modal {
  border: 1px solid var(--traffic-v2-border);
  border-radius: 16px;
}

.traffic-plan-v2 .traffic-modal header {
  padding-bottom: 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--traffic-v2-border) 70%, transparent);
}

.traffic-plan-v2 .layered-progress :deep(.layered-track),
.traffic-plan-v2 .metric-bar :deep(.metric-track),
.traffic-plan-v2 .traffic-project-mini-track,
.traffic-plan-v2 .traffic-tree-progress {
  background: var(--traffic-v2-track) !important;
  border-color: color-mix(in srgb, var(--traffic-v2-border) 72%, var(--primary) 28%) !important;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, .045) !important;
}

.traffic-plan-v2 .layered-progress :deep(.layered-track .planned),
.traffic-plan-v2 .metric-bar :deep(.metric-planned),
.traffic-plan-v2 .traffic-project-mini-track .planned,
.traffic-plan-v2 .traffic-tree-progress i {
  background: var(--traffic-v2-planned) !important;
}

.traffic-plan-v2 .layered-progress :deep(.layered-track .actual),
.traffic-plan-v2 .metric-bar :deep(.metric-actual),
.traffic-plan-v2 .traffic-project-mini-track .actual,
.traffic-plan-v2 .traffic-tree-progress b {
  background: var(--traffic-v2-actual) !important;
}

.traffic-plan-v2 .traffic-apply-progress > .layered-progress :deep(.layered-track) {
  height: 18px !important;
  border-radius: 10px !important;
}

.traffic-plan-v2 .traffic-apply-progress > .layered-progress :deep(.layered-track .actual) {
  top: 5px !important;
  bottom: 5px !important;
}

.traffic-plan-v2 .traffic-exec-progress :deep(.layered-track) {
  height: 20px !important;
  border-radius: 10px !important;
}

.traffic-plan-v2 .traffic-exec-progress :deep(.layered-track .actual) {
  top: 5px !important;
  bottom: 5px !important;
}

.traffic-plan-v2 .traffic-exec-like-metric {
  min-height: 58px;
}

.traffic-plan-v2 .traffic-exec-like-metric :deep(.metric-track) {
  height: 12px !important;
  min-height: 12px !important;
}

.traffic-plan-v2 .traffic-exec-metrics .traffic-mini-metrics .metric-bar {
  min-height: 34px;
}

.traffic-plan-v2 .traffic-exec-metrics .traffic-mini-metrics .metric-bar :deep(.metric-track) {
  height: 7px !important;
  min-height: 7px !important;
}

.traffic-plan-v2 .metric-bar :deep(.metric-track)::after,
.traffic-plan-v2 .layered-progress :deep(.layered-track)::after {
  opacity: .62;
}

@media (max-width: 720px) {
  .traffic-plan-v2 {
    height: auto !important;
    min-height: 100%;
    gap: 10px;
    overflow: visible !important;
  }

  .traffic-plan-v2 .traffic-tabs {
    position: sticky;
    top: 0;
    z-index: 8;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 10px !important;
    border-radius: 16px !important;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  .traffic-plan-v2 .traffic-tabs > button {
    min-width: 0;
    min-height: 40px;
    padding-inline: 8px;
    border-radius: 12px;
    font-size: 13px;
  }

  .traffic-plan-v2 .traffic-tab-actions {
    grid-column: 1 / -1;
    width: 100%;
    margin-left: 0;
    display: flex;
    flex-wrap: nowrap !important;
    align-items: center;
    gap: 7px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 1px;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .traffic-plan-v2 .traffic-tab-actions::-webkit-scrollbar {
    display: none;
  }

  .traffic-plan-v2 .traffic-current-group {
    flex: 0 0 auto;
    min-height: 26px;
    padding-inline: 10px;
  }

  .traffic-plan-v2 .traffic-tab-actions .btn {
    flex: 0 0 auto;
    width: auto;
    min-width: max-content;
    min-height: 30px;
    justify-content: center;
    padding-inline: 10px;
    border-radius: 999px;
    font-size: 11px;
  }

  .traffic-plan-v2 .traffic-tab-actions .btn-primary {
    grid-column: auto !important;
    flex: 0 0 auto !important;
    width: auto;
  }

  .traffic-plan-v2 .traffic-crm-refresh-meta {
    display: none;
  }

  .traffic-plan-v2 .traffic-monitor-layout,
  .traffic-plan-v2 .traffic-apply-layout {
    display: flex !important;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow: visible !important;
  }

  .traffic-plan-v2 .traffic-project-rail,
  .traffic-plan-v2 .traffic-apply-rail,
  .traffic-plan-v2 .traffic-monitor-main,
  .traffic-plan-v2 .traffic-apply-main,
  .traffic-plan-v2 .traffic-summary-panel,
  .traffic-plan-v2 .traffic-execution-panel {
    width: 100%;
    min-width: 0;
    max-width: none;
    border-radius: 16px !important;
  }

  .traffic-plan-v2 .traffic-project-rail,
  .traffic-plan-v2 .traffic-apply-rail {
    padding: 10px !important;
  }

  .traffic-plan-v2 .traffic-view-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .traffic-plan-v2 .traffic-view-switch button {
    min-height: 48px;
    border-radius: 12px;
  }

  .traffic-plan-v2 .traffic-rail-head,
  .traffic-plan-v2 .traffic-section-head,
  .traffic-plan-v2 .traffic-strip-actions,
  .traffic-plan-v2 .traffic-section-actions {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .traffic-plan-v2 .traffic-archive-toggle,
  .traffic-plan-v2 .traffic-section-actions .btn,
  .traffic-plan-v2 .traffic-strip-actions .btn {
    width: 100%;
    justify-content: center;
  }

  .traffic-plan-v2 .traffic-project-list {
    max-height: 310px;
    overflow: auto;
    padding-right: 3px;
    -webkit-overflow-scrolling: touch;
  }

  .traffic-plan-v2 .traffic-project-item {
    min-height: 86px;
    padding: 12px;
    border-radius: 14px;
  }

  .traffic-plan-v2 .traffic-project-item > b {
    font-size: 15px;
  }

  .traffic-plan-v2 .traffic-command-deck,
  .traffic-plan-v2 .traffic-command-scope,
  .traffic-plan-v2 .traffic-group-monitor-panel,
  .traffic-plan-v2 .traffic-summary-panel,
  .traffic-plan-v2 .traffic-project-strip,
  .traffic-plan-v2 .traffic-exec-row,
  .traffic-plan-v2 .traffic-apply-head,
  .traffic-plan-v2 .traffic-apply-workspace,
  .traffic-plan-v2 .traffic-result-panel {
    grid-template-columns: 1fr !important;
  }

  .traffic-plan-v2 .traffic-form-grid,
  .traffic-plan-v2 .traffic-form-panel .traffic-form-grid,
  .traffic-plan-v2 .traffic-create-grid,
  .traffic-plan-v2 .traffic-create-actions {
    grid-template-columns: 1fr !important;
  }

  .traffic-plan-v2 .traffic-form-grid > *,
  .traffic-plan-v2 .traffic-form-grid .span-2,
  .traffic-plan-v2 .traffic-create-grid > *,
  .traffic-plan-v2 .traffic-create-actions > * {
    grid-column: 1 / -1 !important;
    width: 100%;
    min-width: 0;
  }

  .traffic-plan-v2 .traffic-standard-card {
    display: flex !important;
    flex-direction: column;
    align-items: stretch !important;
    gap: 12px;
    width: 100%;
    min-width: 0;
    padding: 12px;
    border-radius: 14px;
  }

  .traffic-plan-v2 .traffic-standard-card > div:first-child {
    width: 100%;
    min-width: 0;
  }

  .traffic-plan-v2 .traffic-standard-card strong,
  .traffic-plan-v2 .traffic-standard-card span {
    display: block;
    max-width: 100%;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .traffic-plan-v2 .traffic-standard-card strong {
    margin-bottom: 4px;
    font-size: 14px;
  }

  .traffic-plan-v2 .traffic-standard-card span {
    line-height: 1.5;
  }

  .traffic-plan-v2 .traffic-standard-actions {
    display: grid !important;
    grid-template-columns: 1fr;
    gap: 8px;
    width: 100%;
  }

  .traffic-plan-v2 .traffic-standard-toggle {
    display: flex !important;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    min-height: 38px;
    padding: 0 10px;
    border: 1px solid var(--traffic-v2-border, var(--border));
    border-radius: 999px;
    background: var(--traffic-v2-chip, var(--chip-bg));
  }

  .traffic-plan-v2 .traffic-standard-toggle input {
    flex: 0 0 auto;
  }

  .traffic-plan-v2 .traffic-standard-toggle span {
    display: inline;
    flex: 1 1 auto;
    text-align: left;
    white-space: nowrap;
  }

  .traffic-plan-v2 .traffic-standard-actions button {
    width: 100%;
    min-height: 38px;
    justify-content: center;
  }

  .traffic-plan-v2 .traffic-command-deck,
  .traffic-plan-v2 .traffic-group-monitor-panel,
  .traffic-plan-v2 .traffic-project-cockpit,
  .traffic-plan-v2 .traffic-execution-panel,
  .traffic-plan-v2 .traffic-exec-row,
  .traffic-plan-v2 .traffic-apply-head,
  .traffic-plan-v2 .traffic-apply-progress,
  .traffic-plan-v2 .traffic-form-panel,
  .traffic-plan-v2 .traffic-maintenance-wrap,
  .traffic-plan-v2 .traffic-result-card,
  .traffic-plan-v2 .traffic-comment-entry,
  .traffic-plan-v2 .traffic-settings-box {
    border-radius: 16px !important;
  }

  .traffic-plan-v2 .traffic-command-stack,
  .traffic-plan-v2 .traffic-strip-facts,
  .traffic-plan-v2 .traffic-strip-rings,
  .traffic-plan-v2 .traffic-group-metrics,
  .traffic-plan-v2 .traffic-exec-metrics .traffic-mini-metrics,
  .traffic-plan-v2 .traffic-apply-progress-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .traffic-plan-v2 .traffic-strip-ring {
    min-height: 92px;
  }

  .traffic-plan-v2 .traffic-exec-row {
    gap: 10px;
    padding: 10px;
  }

  .traffic-plan-v2 .traffic-exec-main {
    grid-template-columns: 60px minmax(0, 1fr);
    column-gap: 10px;
  }

  .traffic-plan-v2 .traffic-exec-gap-ring {
    width: 56px;
    height: 56px;
  }

  .traffic-plan-v2 .traffic-exec-gap-time {
    width: 60px;
    max-width: 60px;
  }

  .traffic-plan-v2 .traffic-exec-side,
  .traffic-plan-v2 .traffic-exec-actions,
  .traffic-plan-v2 .traffic-create-actions,
  .traffic-plan-v2 .traffic-modal-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .traffic-plan-v2 .traffic-exec-side .btn,
  .traffic-plan-v2 .traffic-exec-actions .btn,
  .traffic-plan-v2 .traffic-create-actions .btn,
  .traffic-plan-v2 .traffic-modal-actions .btn {
    width: 100%;
    justify-content: center;
  }

  .traffic-plan-v2 .traffic-maintenance-table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .traffic-plan-v2 .traffic-maintenance-table {
    min-width: 620px;
  }

  .traffic-plan-v2 .traffic-modal {
    width: min(100vw - 20px, 720px);
    max-height: 90vh;
    overflow: auto;
  }
}

@media (max-width: 1180px) {
  .traffic-plan-v2 .traffic-apply-progress-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>


