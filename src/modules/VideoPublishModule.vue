<template>
  <div class="video-publish-module">
    <div class="module-page-header publish-head">
      <div class="module-page-title">
        <span class="module-page-icon" aria-hidden="true">📡</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">VIDEO PUBLISH</div>
          <h2>视频发布</h2>
        </div>
      </div>
      <div class="module-page-actions publish-summary">
        <span class="module-page-pill">{{ selectedAccount.name }}</span>
        <span class="module-page-pill">{{ selectedPlatforms.length }} 个平台</span>
        <span class="module-page-pill">{{ videoItems.length }} 个视频</span>
      </div>
    </div>

    <div class="publish-layout official">
      <main class="publish-editor">
        <section class="publish-card upload-card">
          <div v-if="projectTaskContext" class="project-task-banner">
            <div>
              <strong>{{ projectTaskContext.project_name || 'Project task' }}</strong>
              <span>{{ [projectTaskContext.plan_date, projectTaskContext.group_name, projectTaskContext.owner].filter(Boolean).join(' / ') }}</span>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" @click="projectTaskContext = null">Clear</button>
          </div>
          <div class="section-title">
            <strong>上传视频</strong>
            <span>支持本地拖拽/选择；素材库只是辅助入口。</span>
          </div>

          <div
            v-if="!activeVideo"
            class="upload-zone"
            :class="{ dragging: localDragging }"
            @dragover.prevent="localDragging = true"
            @dragleave.prevent="localDragging = false"
            @drop.prevent="handleLocalDrop">
            <input ref="videoFileInput" type="file" accept="video/*" multiple hidden @change="handleLocalPick" />
            <div class="upload-icon">＋</div>
            <strong>点击或拖拽视频到这里</strong>
            <span>建议 MP4/MOV，单条视频发布信息会自动套用到已选平台。</span>
            <button type="button" class="btn btn-primary" @click="openVideoPicker">选择本地视频</button>
          </div>

          <div v-else class="video-preview-shell">
            <div class="video-preview">
              <video v-if="activeVideo.previewUrl" :src="activeVideo.previewUrl" controls></video>
              <div v-else class="video-placeholder">VIDEO</div>
            </div>
            <div class="video-meta">
              <strong>{{ materialTitle(activeVideo) }}</strong>
              <span>{{ activeVideo.source === 'library' ? '素材库' : '本地视频' }} · {{ formatSize(activeVideo.size) }}</span>
              <div class="video-actions">
                <button type="button" class="btn btn-ghost btn-sm" @click="openVideoPicker">继续添加</button>
                <button type="button" class="btn btn-ghost btn-sm" @click="removeVideo(queueId(activeVideo))">移除当前</button>
              </div>
            </div>
          </div>

          <div v-if="videoItems.length > 1" class="video-strip">
            <button
              v-for="(item, index) in videoItems"
              :key="queueId(item)"
              type="button"
              class="video-chip"
              :class="{ active: queueId(item) === activeVideoId }"
              @click="activeVideoId = queueId(item)">
              <span>#{{ index + 1 }}</span>
              <em>
                <small>{{ item.source === 'library' ? '素材库' : '本地' }}</small>
                {{ materialTitle(item) }}
              </em>
            </button>
          </div>
        </section>

        <section class="publish-card form-card">
          <div class="section-title">
            <strong>发布信息</strong>
            <span>按主平台发布页习惯填写，AI 只是帮你先起草。</span>
          </div>

          <div class="commerce-mode-bar" :class="{ active: publishForm.commerceEnabled }">
            <label>
              <input v-model="publishForm.commerceEnabled" type="checkbox" @change="handleCommerceToggle" />
              <span>逆水寒带货模式</span>
            </label>
            <em>{{ publishForm.commerceEnabled ? '只发抖音，带商品挂车参数' : '普通视频发布' }}</em>
          </div>

          <label class="field">
            <span>标题</span>
            <input v-model.trim="publishForm.title" class="inp" maxlength="60" placeholder="请输入视频标题，建议 10-30 字" />
          </label>

          <label class="field">
            <span>作品描述</span>
            <textarea
              v-model.trim="publishForm.description"
              class="inp desc-input"
              rows="7"
              placeholder="填写作品简介、看点、引导评论的话，也可以让 AI 推荐一版。"></textarea>
          </label>

          <div class="topic-row">
            <label class="field">
              <span>话题 / 标签</span>
              <input v-model.trim="publishForm.tags" class="inp" placeholder="#游戏 #趣闻 #热点" />
            </label>
            <button type="button" class="btn btn-primary ai-btn" :disabled="aiBusy" @click="recommendPublishCopy">
              {{ aiBusy ? '生成中' : 'AI 推荐' }}
            </button>
          </div>

          <section class="copy-source-card">
            <div class="copy-source-head">
              <strong>批量发布文案</strong>
              <span>当前视频按上传顺序发布，手动文案也按 #1、#2 依次匹配。</span>
            </div>
            <div class="copy-source-options" role="group" aria-label="选择发布文案来源">
              <label :class="{ active: publishForm.copyMode === 'auto' }">
                <input v-model="publishForm.copyMode" type="radio" value="auto" />
                <span>使用上方文案 / AI 推荐</span>
              </label>
              <label :class="{ active: publishForm.copyMode === 'manual' }">
                <input v-model="publishForm.copyMode" type="radio" value="manual" />
                <span>手动批量文案</span>
              </label>
            </div>
            <label v-if="publishForm.copyMode === 'manual'" class="field manual-copy-field">
              <span>手动发布文案</span>
              <textarea
                v-model="publishForm.manualCopyText"
                class="inp manual-copy-input"
                rows="8"
                placeholder="每条文案之间空一行，例如：&#10;第一条视频标题/文案&#10;可以多行描述&#10;&#10;第二条视频标题/文案&#10;继续写完整发布文案"></textarea>
              <small :class="{ warn: manualCopyBlocks.length < videoItems.length }">
                已识别 {{ manualCopyBlocks.length }} 条文案；当前 {{ videoItems.length }} 个视频。发布时按上传顺序逐条套用。
              </small>
            </label>
          </section>

          <div v-if="publishForm.commerceEnabled" class="commerce-panel">
            <div class="commerce-panel-head">
              <div>
                <strong>带货参数</strong>
                <span>发布前可手动改，后续挂车流程会读取这里。</span>
              </div>
              <div class="commerce-preset-actions">
                <button type="button" class="btn btn-ghost btn-sm" @click="applyCommercePreset('chisel')">凿子</button>
                <button type="button" class="btn btn-ghost btn-sm" @click="applyCommercePreset('fashion')">时装</button>
              </div>
            </div>

            <label class="field">
              <span>带货预设</span>
              <select v-model="publishForm.commercePreset" class="inp" @change="applyCommercePreset(publishForm.commercePreset)">
                <option value="chisel">逆水寒凿子带货</option>
                <option value="fashion">逆水寒时装带货</option>
              </select>
            </label>

            <details class="commerce-reference-details">
              <summary>
                <span>AI 参考词 / 自动文案池</span>
                <em>{{ commerceCopyLines().length }} 条，可展开编辑</em>
              </summary>
              <label class="field">
                <span>参考文案池</span>
                <textarea
                  v-model="publishForm.commerceCopyPool"
                  class="inp commerce-copy-input"
                  rows="7"
                  placeholder="一行一条，批量发布时可轮换使用"></textarea>
              </label>
            </details>

            <div class="commerce-action-row">
              <button type="button" class="btn btn-primary btn-sm" @click="fillDescriptionFromCommercePool">随机填入作品描述</button>
              <button type="button" class="btn btn-ghost btn-sm" @click="fillTitleFromCommercePool">随机填入标题</button>
            </div>

            <div class="commerce-queue-row">
              <span>文案队列剩余 {{ commerceCopyQueueRemaining }} 条，低于 3 条自动补 20 条</span>
              <div>
                <button type="button" class="btn btn-ghost btn-sm" @click="addCommerceCopyQueueBatch">补 20 条</button>
                <button type="button" class="btn btn-ghost btn-sm" @click="resetCommerceCopyQueue">重置队列</button>
              </div>
            </div>

            <label class="field">
              <span>商品链接</span>
              <input v-model.trim="publishForm.commerceProductUrl" class="inp" placeholder="请输入抖音商品链接" />
            </label>

            <label class="field">
              <span>商品文案</span>
              <input v-model.trim="publishForm.commerceProductText" class="inp" placeholder="商品挂车文案" />
            </label>
          </div>

          <div class="cover-row">
            <div class="cover-box">
              <span>封面</span>
              <strong>{{ publishForm.coverMode === 'auto' ? '默认首帧' : '自定义封面' }}</strong>
              <small>后端接入后支持抽帧/上传封面图。</small>
            </div>
            <div class="cover-actions">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                :class="{ active: publishForm.coverMode === 'auto' }"
                @click="publishForm.coverMode = 'auto'">
                默认首帧
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                :class="{ active: publishForm.coverMode === 'custom' }"
                @click="publishForm.coverMode = 'custom'">
                自定义
              </button>
            </div>
          </div>

          <div class="settings-grid">
            <label class="field">
              <span>可见范围</span>
              <select v-model="publishForm.visibility" class="inp">
                <option value="public">公开</option>
                <option value="private">仅自己可见</option>
                <option value="fans">粉丝可见</option>
              </select>
            </label>
          </div>

          <div class="queue-panel" :class="{ active: publishForm.queueEnabled }">
            <label class="queue-toggle">
              <input v-model="publishForm.queueEnabled" type="checkbox" />
              <span>加入定时队列</span>
            </label>
            <div v-if="publishForm.queueEnabled" class="queue-grid">
              <label class="field">
                <span>开始日期</span>
                <input v-model="publishForm.queueDate" class="inp" type="date" />
              </label>
              <label class="field">
                <span>开始时间</span>
                <input v-model="publishForm.queueTime" class="inp" type="time" />
              </label>
              <label class="field">
                <span>间隔分钟</span>
                <input v-model.number="publishForm.queueIntervalMinutes" class="inp" type="number" min="0" max="1440" step="1" />
              </label>
            </div>
            <small v-if="publishForm.queueEnabled">
              按当前账号 {{ selectedAccount.name }} 入队；多条视频会按间隔顺延，到点后后端自动触发。
            </small>
          </div>

          <div class="switch-row">
            <label><input v-model="publishForm.allowComment" type="checkbox" /> 允许评论</label>
            <label><input v-model="publishForm.allowShare" type="checkbox" /> 允许转发</label>
            <label><input v-model="publishForm.allowDownload" type="checkbox" /> 允许下载</label>
          </div>

          <div v-if="aiHint" class="ai-hint">
            <span>AI</span>
            <p>
              <strong>{{ aiSourceLabel }}</strong>
              {{ aiHint }}
              <em v-if="aiError">失败原因：{{ aiError }}</em>
            </p>
          </div>
        </section>
      </main>

      <aside class="publish-side">
        <section class="side-card account-card">
          <div class="section-title compact">
            <strong>发布账号</strong>
            <span>账号决定绑定平台身份。</span>
          </div>
          <input v-model.trim="accountSearch" class="inp" placeholder="搜索账号" />
          <select v-model="selectedAccountId" class="inp" @change="syncSelectedAccount">
            <option v-for="account in filteredAccounts" :key="account.id" :value="account.id">
              {{ account.name }}
            </option>
          </select>
          <div class="selected-account">
            <span>{{ selectedAccount.avatar }}</span>
            <div>
              <strong>{{ selectedAccount.name }}</strong>
              <small>{{ selectedAccount.description }}</small>
            </div>
          </div>
        </section>

        <section class="side-card platform-card">
          <div class="section-title compact">
            <strong>多平台同步</strong>
            <span>在发布页上叠加的平台选项。</span>
          </div>
          <div class="platform-actions">
            <button type="button" class="btn btn-ghost btn-sm" @click="selectReadyPlatforms">已登录</button>
            <button type="button" class="btn btn-ghost btn-sm" @click="selectAllPlatforms">全选</button>
          </div>
          <label
            v-for="platform in selectedAccount.platforms"
            :key="platform.id"
            class="platform-line"
            :class="{ active: selectedPlatformIds.includes(platform.id) }">
            <input v-model="selectedPlatformIds" type="checkbox" :value="platform.id" />
            <span class="platform-icon" :style="{ background: platform.color }">{{ platform.icon }}</span>
            <div>
              <strong>{{ platform.name }}</strong>
              <small>{{ platform.handle }}</small>
              <small class="profile-line">Profile: {{ bindingFor(platform).profile_alias || platform.profile || '未绑定' }}</small>
            </div>
            <div class="platform-tools">
              <em :class="loginStatusFor(platform)">{{ loginLabel(platform) }}</em>
              <button type="button" class="mini-link" :disabled="accountBusyKey === platformKey(selectedAccount, platform)" @click.prevent="saveBinding(platform)">绑定</button>
              <button type="button" class="mini-link" :disabled="accountBusyKey === platformKey(selectedAccount, platform)" @click.prevent="launchProfile(platform)">拉起</button>
              <button type="button" class="mini-link" :disabled="accountBusyKey === platformKey(selectedAccount, platform)" @click.prevent="checkLogin(platform)">检查</button>
              <button type="button" class="mini-link" :disabled="accountBusyKey === platformKey(selectedAccount, platform)" @click.prevent="openLogin(platform)">登录</button>
            </div>
          </label>
        </section>

        <section class="side-card submit-card">
          <div class="submit-summary">
            <strong>{{ taskCount }}</strong>
            <span>{{ taskCountLabel }}</span>
          </div>
          <button type="button" class="btn btn-primary publish-btn" :disabled="!canPublishNow || publishingNow" @click="publishNow">
            {{ publishingNow ? publishingText : submitText }}
          </button>
          <button v-if="publishingNow" type="button" class="btn btn-ghost publish-btn danger" :disabled="cancellingJobId === activePublishJobId && Boolean(activePublishJobId)" @click="togglePublishPause">
            {{ publishPaused ? '继续发布' : '立即暂停' }}
          </button>
          <button type="button" class="btn btn-ghost publish-btn" :disabled="!videoItems.length" @click="clearVideos">
            清空视频
          </button>
          <p>选择平台后会直接调用 OpenCLI 打开平台后台、上传视频并发布；执行记录会进入下方历史。</p>
        </section>

        <section class="side-card progress-card">
          <div class="section-title compact">
            <strong>发表进度</strong>
            <span>{{ publishActivity.detail || '等待创建或发表任务。' }}</span>
          </div>
          <div class="progress-track">
            <i :style="{ width: publishActivity.percent + '%' }"></i>
          </div>
          <div class="progress-state" :class="publishActivity.tone">
            <strong>{{ publishActivity.title }}</strong>
            <span>{{ publishActivity.percent }}%</span>
          </div>
          <div v-if="publishEvents.length" class="progress-events">
            <div v-for="event in publishEvents.slice(0, 6)" :key="event.id" class="progress-event" :class="event.type">
              <span>{{ event.time }}</span>
              <em>{{ event.message }}</em>
            </div>
          </div>
        </section>

        <section class="side-card jobs-card">
          <div class="section-title compact">
            <strong>发布历史</strong>
            <span>这里保留每个平台的发布结果；失败记录可直接重试。</span>
          </div>
          <div class="queue-status-bar" :class="{ paused: queueStatus.paused }">
            <div>
              <strong>{{ queueStatus.paused ? '定时队列已暂停' : '定时队列运行中' }}</strong>
              <small>
                待执行 {{ queueStatus.scheduled_count }} 条
                <template v-if="queueStatus.next_scheduled_at"> · 下次 {{ formatJobTime(queueStatus.next_scheduled_at) }}</template>
              </small>
            </div>
            <button type="button" class="btn btn-ghost btn-xs" :disabled="queueStatusBusy" @click="toggleQueuePaused">
              {{ queueStatusBusy ? '处理中' : (queueStatus.paused ? '恢复' : '暂停') }}
            </button>
          </div>
          <div v-if="!recentJobs.length" class="mini-empty">暂无发布历史</div>
          <div v-else class="job-mini-list">
            <div v-for="job in recentJobs.slice(0, 12)" :key="job.id" class="job-mini">
              <strong>{{ job.title || job.video?.name || '未命名任务' }}</strong>
              <small>{{ job.account?.name || '账号' }} · {{ job.platform?.name || job.platform?.id }} · {{ jobStatusLabel(job.status) }}</small>
              <small v-if="jobProgressText(job)" class="job-progress">{{ jobProgressText(job) }}</small>
              <small v-if="job.scheduled_at" class="job-schedule">触发时间：{{ formatJobTime(job.scheduled_at) }}</small>
              <span class="job-status" :class="jobStatusClass(job.status)">{{ jobStatusLabel(job.status) }}</span>
              <small v-if="job.error" class="job-error">{{ job.error }}</small>
              <div class="job-actions">
                <button type="button" class="btn btn-ghost btn-xs" :disabled="checkingJobId === job.id" @click="checkJob(job)">
                  {{ checkingJobId === job.id ? '检查中' : '检查' }}
                </button>
                <button type="button" class="btn btn-primary btn-xs" :disabled="runningJobId === job.id || !canRunJob(job)" @click="runJob(job)">
                  {{ runningJobId === job.id ? '发表中' : '发表' }}
                </button>
                <button v-if="canCancelJob(job)" type="button" class="btn btn-ghost btn-xs danger" :disabled="cancellingJobId === job.id" @click="cancelJob(job)">
                  {{ cancellingJobId === job.id ? '取消中' : '取消' }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { listMaterials } from '../api/materials'
import { chatMinimax } from '../api/tools'
import {
  cancelVideoPublishJob,
  checkVideoPublishLogin,
  checkVideoPublishJob,
  createVideoPublishJobs,
  getVideoPublishQueueStatus,
  launchVideoPublishProfile,
  listVideoPublishAccounts,
  listVideoPublishJobs,
  openVideoPublishLogin,
  pauseVideoPublishQueue,
  runVideoPublishJob,
  saveVideoPublishAccount,
  transcribeVideoPublishVideo,
  uploadVideoPublishFile
} from '../api/videoPublish'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()

const props = defineProps({
  trafficContext: { type: Object, default: null }
})

const chiselCommerceDefaults = {
  id: 'chisel',
  name: '逆水寒凿子',
  tags: '#逆水寒手游 #欧气 #逆水寒全民制作人 #逆水寒童话版本 #逆水寒凿子',
  productText: '欧气凿子来辣',
  productUrl: 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3822421447960297861&origin_type=pc_buyin_selection_decision',
  descriptionPool: [
    '10块试试欧气',
    '凿子开抽实测',
    '抽祥瑞看脸了',
    '这波看手气',
    '欧气凿子来辣',
    '今天搏一手',
    '凿子真有说法',
    '这发能不能出',
    '主包要出货了',
    '现场实测黑不黑',
    '十块快乐开抽',
    '祥瑞别躲了'
  ].join('\n'),
  copyPool: [
    '10块试试欧气',
    '今天凿子开抽',
    '这发能不能出',
    '祥瑞给我出来',
    '凿子欧气实测',
    '一发入魂看看',
    '这波搏一手',
    '抽卡道具开测',
    '欧气今天在吗',
    '凿子真香时刻',
    '十块快乐来了',
    '主包要出货了',
    '祥瑞别躲了',
    '这凿子有说法',
    '开凿子看脸',
    '今天就赌欧气',
    '十块搏个惊喜',
    '凿子安排上',
    '出货现场来了',
    '这次有点玄学',
    '快把欧气给我',
    '来接凿子欧气',
    '小小祥瑞拿下',
    '这波手气来了',
    '凿子黑不黑实测',
    '今晚欧气开张',
    '抽祥瑞就现在',
    '这凿子能出吗',
    '十块开个惊喜',
    '欧气别跑'
  ].join('\n')
}

const fashionCommerceDefaults = {
  id: 'fashion',
  name: '逆水寒时装',
  tags: '#逆水寒 #逆水寒手游 #逆水寒穿搭',
  productText: '逆水寒时装穿搭',
  productUrl: 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3771945132543312023&origin_type=pc_buyin_selection_decision',
  descriptionPool: [
    '这套真的仙品',
    '谁看了不心动',
    '这身穿搭绝了',
    '千万别眨眼',
    '直接美到发光'
  ].join('\n'),
  copyPool: [
    '买不了吃亏买不了上当',
    '这谁忍得住！',
    '这套衣服简直仙品来的',
    '千万别眨眼！',
    '美哉美哉',
    '换个风格飒气拉满',
    '新时装简直细节怪',
    '这个动作模板太帅了',
    '仙气直接拉满',
    '一眼就心动了',
    '这套安排上',
    '穿搭灵感来了',
    '今天换套仙的',
    '这身直接封神',
    '这波衣品在线'
  ].join('\n')
}
const commercePresets = {
  chisel: chiselCommerceDefaults,
  fashion: fashionCommerceDefaults
}

function padTimePart(value) {
  return String(value).padStart(2, '0')
}

function dateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())}`
}

function timeInputValue(date = new Date()) {
  return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`
}

function defaultQueueStart() {
  return new Date(Date.now() + 10 * 60 * 1000)
}

const platformColors = {
  douyin: 'linear-gradient(135deg, #111827, #ff2f6d)',
  bilibili: 'linear-gradient(135deg, #00a1d6, #fb7299)',
  xiaohongshu: 'linear-gradient(135deg, #ff2442, #ff7a90)',
  wechatVideo: 'linear-gradient(135deg, #07c160, #22c55e)',
  kuaishou: 'linear-gradient(135deg, #ff7a00, #facc15)'
}

const defaultExcludedPlatformIds = new Set(['wechatVideo'])

const publishAccounts = [
  {
    id: 'tianji-mei',
    name: '天机妹',
    avatar: '机',
    description: '生活感、地域趣闻、轻剧情内容优先',
    styleHint: '口语化、接地气，有一点吐槽感，但不要太硬。',
    platforms: [
      platformAccount('bilibili', 'B站', 'B', 'B站 · 天机妹', 'tianji-mei-publish', 'ready'),
      platformAccount('kuaishou', '快手', 'K', '快手 · 天机妹', 'tianji-mei-publish', 'ready'),
      platformAccount('xiaohongshu', '小红书', 'R', '小红书 · 天机妹', 'tianji-mei-publish', 'ready'),
      platformAccount('wechatVideo', '视频号', 'V', '视频号 · 天机妹', 'tianji-mei-publish', 'ready'),
      platformAccount('douyin', '抖音', 'D', '抖音 · 天机妹', 'tianji-mei-publish', 'ready')
    ]
  },
  {
    id: 'maixiaohua',
    name: '麦晓花',
    avatar: '麦',
    description: '生活分享、情绪观点、女性向内容优先',
    styleHint: '语气自然亲近，先给观点和情绪，再补充故事细节。',
    platforms: [
      platformAccount('bilibili', 'B站', 'B', 'B站 · 麦晓花', 'maixiaohua-publish', 'ready'),
      platformAccount('kuaishou', '快手', 'K', '快手 · 麦晓花喔', 'maixiaohua-publish', 'ready'),
      platformAccount('xiaohongshu', '小红书', 'R', '小红书 · 麦晓花', 'maixiaohua-publish', 'ready'),
      platformAccount('wechatVideo', '视频号', 'V', '视频号 · 麦晓花来咯', 'maixiaohua-publish', 'ready'),
      platformAccount('douyin', '抖音', 'D', '抖音 · 麦晓花', 'maixiaohua-publish', 'ready')
    ]
  },
  {
    id: 'nishuihan-fanshiqii',
    name: '逆水寒-饭十七',
    avatar: '饭',
    description: '逆水寒手游带货发布账号',
    styleHint: '短句、强情绪、围绕欧气凿子和祥瑞出货表达。',
    platforms: [
      platformAccount('douyin', '抖音', 'D', '抖音 · 饭十七', 'dvabrcmr', 'ready')
    ]
  },
  {
    id: 'nishuihan-youdianhuang',
    name: '游点慌',
    avatar: '游',
    description: '逆水寒手游带货发布账号',
    styleHint: '短句、强情绪、围绕欧气凿子和祥瑞出货表达。',
    platforms: [
      platformAccount('douyin', '抖音', 'D', '抖音 · 游点慌', 'b3uk5kjf', 'ready')
    ]
  },
  {
    id: 'nishuihan-leiya',
    name: '雷鸭',
    avatar: '雷',
    description: '逆水寒手游带货发布账号',
    styleHint: '短句、强情绪、围绕欧气凿子和祥瑞出货表达。',
    platforms: [
      platformAccount('douyin', '抖音', 'D', '抖音 · 雷鸭Fist', 'h4g7ab4y', 'ready')
    ]
  }
]

const selectedAccountId = ref(publishAccounts[0].id)
const selectedPlatformIds = ref(readyPlatformIds(publishAccounts[0]))
const accountSearch = ref('')
const videoFileInput = ref(null)
const localDragging = ref(false)
const videoItems = ref([])
const activeVideoId = ref('')
const materials = ref([])
const materialSearch = ref('')
const materialLoading = ref(false)
const projectTaskContext = ref(null)
const aiBusy = ref(false)
const publishingNow = ref(false)
const publishPaused = ref(false)
const publishingText = ref('发布中')
const aiHint = ref('')
const aiSource = ref('')
const aiError = ref('')
const activeTranscript = ref('')
const recentJobs = ref([])
const accountBindings = ref([])
const opencliProfiles = ref([])
const accountBusyKey = ref('')
const runningJobId = ref(0)
const activePublishJobId = ref(0)
const checkingJobId = ref(0)
const cancellingJobId = ref(0)
const publishStopRequested = ref(false)
const queueStatus = reactive({
  paused: false,
  running: false,
  scheduled_count: 0,
  next_scheduled_at: 0,
  publishing_count: 0
})
const queueStatusBusy = ref(false)
let recentJobsTimer = 0
const publishActivity = reactive({
  title: '待开始',
  detail: '',
  percent: 0,
  tone: 'idle'
})
const publishEvents = ref([])
const commerceCopyQueue = ref({})
const publishPauseWaiters = []
const directPublishCooldownMs = 10 * 1000
const queueStartDefault = defaultQueueStart()

const publishForm = reactive({
  title: '',
  description: '',
  tags: '',
  copyMode: 'auto',
  manualCopyText: '',
  commerceEnabled: false,
  commercePreset: chiselCommerceDefaults.id,
  commerceCopyPool: chiselCommerceDefaults.copyPool,
  commerceProductUrl: chiselCommerceDefaults.productUrl,
  commerceProductText: chiselCommerceDefaults.productText,
  coverMode: 'auto',
  visibility: 'public',
  publishTime: 'now',
  queueEnabled: false,
  queueDate: dateInputValue(queueStartDefault),
  queueTime: timeInputValue(queueStartDefault),
  queueIntervalMinutes: 10,
  allowComment: true,
  allowShare: true,
  allowDownload: false
})

const selectedAccount = computed(() => publishAccounts.find(account => account.id === selectedAccountId.value) || publishAccounts[0])
const filteredAccounts = computed(() => {
  const keyword = accountSearch.value.toLowerCase()
  if (!keyword) return publishAccounts
  return publishAccounts.filter(account => {
    return [
      account.name,
      account.description,
      account.styleHint,
      ...account.platforms.map(platform => platform.handle)
    ].join(' ').toLowerCase().includes(keyword)
  })
})
const selectedPlatforms = computed(() => selectedAccount.value.platforms.filter(platform => selectedPlatformIds.value.includes(platform.id)))
const selectedPlatformLabels = computed(() => selectedPlatforms.value.map(platform => platform.name).join(' / ') || '未选择平台')
const activeVideo = computed(() => videoItems.value.find(item => queueId(item) === activeVideoId.value) || videoItems.value[0] || null)
const activeCommercePreset = computed(() => commercePresets[publishForm.commercePreset] || chiselCommerceDefaults)
const commerceCopyQueueRemaining = computed(() => commerceQueueForPreset(activeCommercePreset.value.id).length)
const manualCopyBlocks = computed(() => parseManualCopyBlocks(publishForm.manualCopyText))
const taskCount = computed(() => videoItems.value.length * selectedPlatformIds.value.length)
const taskCountLabel = computed(() => {
  if (publishForm.queueEnabled) return '本次将加入定时队列的记录'
  return publishForm.commerceEnabled ? '本次将发布的抖音带货记录' : '本次将直接发布的平台记录'
})
const canPublishNow = computed(() => videoItems.value.length > 0 && selectedPlatformIds.value.length > 0)
const submitText = computed(() => {
  if (publishForm.queueEnabled) return '加入定时队列'
  return publishForm.commerceEnabled ? '开始抖音带货发布' : '立即发布到所选平台'
})
const aiSourceLabel = computed(() => {
  if (aiBusy.value) return '模型生成中'
  if (aiSource.value === 'model') return '模型推荐'
  if (aiSource.value === 'fallback') return '本地兜底'
  return '推荐状态'
})

function platformAccount(id, name, icon, handle, profile, status) {
  return { id, name, icon, handle, profile, status, color: platformColors[id] || 'var(--surface2)' }
}

function readyPlatformIds(account) {
  return account.platforms
    .filter(platform => platform.status === 'ready' && !defaultExcludedPlatformIds.has(platform.id))
    .map(platform => platform.id)
}

function syncSelectedAccount() {
  selectedPlatformIds.value = readyPlatformIds(selectedAccount.value)
  aiHint.value = `${selectedAccount.value.name} 已选中，平台账号已同步。`
}

function selectReadyPlatforms() {
  selectedPlatformIds.value = readyPlatformIds(selectedAccount.value)
}

function selectAllPlatforms() {
  selectedPlatformIds.value = selectedAccount.value.platforms.map(platform => platform.id)
}

function commerceQueueStorageKey(presetId) {
  return `video-publish-commerce-copy-queue:${presetId}:v2`
}

function commerceQueueForPreset(presetId) {
  return Array.isArray(commerceCopyQueue.value[presetId]) ? commerceCopyQueue.value[presetId] : []
}

function isCorruptedCommerceCopy(value) {
  return /^\?+$/.test(String(value || '').trim())
}

function saveCommerceQueue(presetId, queue) {
  const cleaned = Array.from(new Set((Array.isArray(queue) ? queue : [])
    .map(item => cleanCommerceCopy(item))
    .filter(item => item && !isCorruptedCommerceCopy(item))))
  commerceCopyQueue.value = { ...commerceCopyQueue.value, [presetId]: cleaned }
  try {
    window.localStorage.setItem(commerceQueueStorageKey(presetId), JSON.stringify(cleaned))
  } catch {
    // localStorage may be unavailable in embedded or privacy-restricted browsers.
  }
  return cleaned
}

function loadCommerceQueue(presetId) {
  try {
    const raw = window.localStorage.getItem(commerceQueueStorageKey(presetId))
    const parsed = raw ? JSON.parse(raw) : []
    return saveCommerceQueue(presetId, Array.isArray(parsed) ? parsed : [])
  } catch {
    return saveCommerceQueue(presetId, [])
  }
}

function commerceManualLinesForPreset(presetId) {
  if (presetId === publishForm.commercePreset) return commerceCopyLines()
  const preset = commercePresets[presetId] || chiselCommerceDefaults
  return String(preset.copyPool || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
}

function commerceGeneratedCopyCandidates(presetId) {
  const preset = commercePresets[presetId] || chiselCommerceDefaults
  const base = String(preset.copyPool || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
  const extras = presetId === 'fashion'
    ? [
      '这套谁能忍住',
      '仙品穿搭来了',
      '千万别眨眼',
      '这身直接封神',
      '穿上就有氛围',
      '这套太会了',
      '逆水寒穿搭开测',
      '这衣服有点美',
      '今天换套仙的',
      '这波衣品在线',
      '仙气直接拉满',
      '这套真顶不住',
      '穿搭灵感来了',
      '一眼就心动了',
      '这套安排上'
    ]
    : [
      '凿子出货挑战',
      '今天看脸开抽',
      '祥瑞让我看看',
      '十块欧气局',
      '开抽前先许愿',
      '这波有点期待',
      '凿子玄学来了',
      '欧气测试开始',
      '祥瑞来不来',
      '十块快乐实测'
    ]
  return Array.from(new Set([...base, ...extras]))
}
function shuffledCommerceCopies(presetId, batchSize = 20) {
  const queue = commerceQueueForPreset(presetId)
  const candidates = [...commerceManualLinesForPreset(presetId), ...commerceGeneratedCopyCandidates(presetId)]
    .map(item => cleanCommerceCopy(item))
    .filter(Boolean)
  const unique = Array.from(new Set(candidates))
  const existing = new Set(queue)
  const preferred = unique.filter(item => !existing.has(item))
  const fallback = unique.filter(item => existing.has(item))
  return [...preferred, ...fallback]
    .map(item => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(entry => entry.item)
    .slice(0, Math.max(1, batchSize))
}

function refillCommerceCopyQueue(presetId = publishForm.commercePreset, batchSize = 20, replace = false) {
  const current = replace ? [] : commerceQueueForPreset(presetId)
  const additions = shuffledCommerceCopies(presetId, batchSize).filter(item => !current.includes(item))
  const nextQueue = current.concat(additions)
  const saved = saveCommerceQueue(presetId, nextQueue)
  if (saved.length) {
    aiHint.value = `${activeCommercePreset.value.name}文案队列已准备 ${saved.length} 条，批量发布会按顺序取用。`
  }
  return saved
}

function ensureCommerceCopyQueue(presetId = publishForm.commercePreset, minRemaining = 3, batchSize = 20) {
  const current = commerceQueueForPreset(presetId)
  if (current.length <= minRemaining) return refillCommerceCopyQueue(presetId, batchSize)
  return current
}

function takeCommerceQueuedCopy(presetId = publishForm.commercePreset) {
  let queue = ensureCommerceCopyQueue(presetId, 0, 20)
  if (!queue.length) return ''
  const [copy, ...remaining] = queue
  saveCommerceQueue(presetId, remaining)
  ensureCommerceCopyQueue(presetId, 3, 20)
  return copy
}

function resetCommerceCopyQueue() {
  const queue = refillCommerceCopyQueue(publishForm.commercePreset, 20, true)
  showToast(`已重置文案队列：${queue.length} 条`, 'success')
}

function addCommerceCopyQueueBatch() {
  const before = commerceCopyQueueRemaining.value
  const queue = refillCommerceCopyQueue(publishForm.commercePreset, 20)
  showToast(`已补充文案队列：${before} → ${queue.length} 条`, 'success')
}

function applyCommercePreset(id = publishForm.commercePreset) {
  const preset = commercePresets[id] || chiselCommerceDefaults
  publishForm.commercePreset = preset.id
  publishForm.tags = preset.tags
  publishForm.commerceCopyPool = preset.copyPool
  publishForm.commerceProductUrl = preset.productUrl
  publishForm.commerceProductText = preset.productText
  publishForm.title = ''
  publishForm.description = ''
  selectDouyinOnly()
  ensureCommerceCopyQueue(preset.id, 3, 20)
  showToast(`已套入${preset.name}带货配置`, 'success')
}

function applyChiselDefaults() {
  applyCommercePreset('chisel')
}

function commerceCopyLines() {
  return String(publishForm.commerceCopyPool || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
}

function commerceDescriptionLines() {
  return String(activeCommercePreset.value.descriptionPool || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
}

function parseManualCopyBlocks(value) {
  return String(value || '')
    .split(/\r?\n\s*\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean)
}

function manualCopyTitle(block) {
  const firstLine = String(block || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || ''
  return Array.from(firstLine.replace(/^标题[:：]\s*/, '')).slice(0, 30).join('')
}

function applyManualCopiesToVideos(items, startIndex = 0) {
  if (publishForm.copyMode !== 'manual') return items
  const blocks = manualCopyBlocks.value
  const nextItems = items.map((item, index) => {
    const block = blocks[startIndex + index]
    if (!block) return item
    return {
      ...item,
      title: manualCopyTitle(block) || item.title || materialTitle(item),
      description: block
    }
  })
  const first = nextItems[0]
  if (first?.title) publishForm.title = first.title
  if (first?.description) publishForm.description = first.description
  aiSource.value = 'fallback'
  aiHint.value = `已按上传顺序匹配 ${Math.min(blocks.length, videoItems.value.length)} 条手动文案。`
  return nextItems
}

function validateManualCopyForm() {
  if (publishForm.copyMode !== 'manual') return true
  const count = manualCopyBlocks.value.length
  if (!count) {
    showToast('请填写手动发布文案，文案之间用空行分隔', 'warning')
    return false
  }
  if (count < videoItems.value.length) {
    showToast(`手动文案只有 ${count} 条，当前有 ${videoItems.value.length} 个视频，请补齐后再发布`, 'warning')
    return false
  }
  return true
}

function pickCommerceCopy() {
  const lines = commerceCopyLines()
  if (!lines.length) return ''
  return lines[Math.floor(Math.random() * lines.length)]
}

function cleanCommerceCopy(value, max = 20) {
  return Array.from(String(value || '').trim().replace(/\s+/g, ' ')).slice(0, max).join('')
}

function looksLikeVideoFilename(value) {
  const text = String(value || '').trim()
  return /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(text) || /^(\d{10,}|local-|material-|remote-|[\w-]+_){1,}/i.test(text)
}

function commerceCopyForIndex(index, offset = 0) {
  const lines = commerceCopyLines()
  if (!lines.length) return ''
  return cleanCommerceCopy(lines[(offset + index) % lines.length])
}

function commerceDescriptionForIndex(index, title) {
  const descLines = commerceDescriptionLines()
  const titleText = cleanCommerceCopy(title)
  if (descLines.length) {
    for (let i = 0; i < descLines.length; i += 1) {
      const candidate = cleanCommerceCopy(descLines[(index + i) % descLines.length])
      if (candidate && candidate !== titleText) return candidate
    }
  }
  const titleLines = commerceCopyLines()
  if (titleLines.length > 1) {
    const offset = Math.max(1, Math.ceil(titleLines.length / 2))
    for (let i = 0; i < titleLines.length; i += 1) {
      const candidate = cleanCommerceCopy(titleLines[(index + offset + i) % titleLines.length])
      if (candidate && candidate !== titleText) return candidate
    }
  }
  const productText = cleanCommerceCopy(publishForm.commerceProductText)
  return productText && productText !== titleText ? productText : titleText
}

function applyCommerceCopiesToVideos(items) {
  if (!publishForm.commerceEnabled) return items
  const lines = commerceCopyLines()
  const copySet = new Set(lines.map(item => cleanCommerceCopy(item)).filter(Boolean))
  const rotatePool = items.length > 1
  const currentTitle = cleanCommerceCopy(publishForm.title)
  const currentDescription = cleanCommerceCopy(publishForm.description)
  const forceQueueCopy = publishForm.commerceEnabled
  const manualTitle = !forceQueueCopy && currentTitle && !looksLikeVideoFilename(currentTitle) && !rotatePool && !copySet.has(currentTitle) ? currentTitle : ''
  const manualDescription = !forceQueueCopy && currentDescription && currentDescription !== currentTitle && !looksLikeVideoFilename(currentDescription) && !rotatePool && !copySet.has(currentDescription) ? currentDescription : ''
  let firstTitle = ''
  let firstDescription = ''
  const withCopy = items.map((item, index) => {
    const itemTitle = String(item.title || '').trim()
    const itemDescription = String(item.description || '').trim()
    const generated = itemTitle && itemDescription
      ? ''
      : takeCommerceQueuedCopy(activeCommercePreset.value.id)
        || commerceCopyForIndex(index)
        || cleanCommerceCopy(activeCommercePreset.value.copyPool.split(/\r?\n/)[0])
    const title = itemTitle || manualTitle || generated
    const description = itemDescription || manualDescription || commerceDescriptionForIndex(index, title)
    if (!firstTitle) firstTitle = title
    if (!firstDescription) firstDescription = description
    return { ...item, title, description }
  })
  if (!manualTitle && firstTitle) publishForm.title = firstTitle
  if (!manualDescription && firstDescription) publishForm.description = firstDescription
  if (!publishForm.tags) publishForm.tags = activeCommercePreset.value.tags
  if (firstTitle) {
    aiSource.value = 'fallback'
    aiHint.value = `已根据${activeCommercePreset.value.name}参考文案生成短标题：${firstTitle}`
  }
  return withCopy
}

function fillDescriptionFromCommercePool() {
  const copy = takeCommerceQueuedCopy(activeCommercePreset.value.id) || pickCommerceCopy()
  if (!copy) {
    showToast('参考文案池为空，请先填写文案', 'warning')
    return
  }
  publishForm.description = cleanCommerceCopy(copy)
}

function fillTitleFromCommercePool() {
  const copy = takeCommerceQueuedCopy(activeCommercePreset.value.id) || pickCommerceCopy()
  if (!copy) {
    showToast('参考文案池为空，请先填写文案', 'warning')
    return
  }
  publishForm.title = cleanCommerceCopy(copy)
}

function selectDouyinOnly() {
  const douyin = selectedAccount.value.platforms.find(platform => platform.id === 'douyin')
  if (douyin) selectedPlatformIds.value = ['douyin']
}

function isCommerceAccount(account = selectedAccount.value) {
  return String(account?.id || '').startsWith('nishuihan-')
}

function ensureCommerceAccount() {
  if (isCommerceAccount()) return false
  const fallback = publishAccounts.find(account => account.id === 'nishuihan-fanshiqii')
    || publishAccounts.find(account => String(account.id || '').startsWith('nishuihan-'))
  if (!fallback) return false
  selectedAccountId.value = fallback.id
  selectedPlatformIds.value = readyPlatformIds(fallback)
  aiHint.value = `逆水寒带货模式已切换到 ${fallback.name}，避免发到普通账号。`
  return true
}

function handleCommerceToggle() {
  if (!publishForm.commerceEnabled) return
  const switched = ensureCommerceAccount()
  applyCommercePreset(publishForm.commercePreset)
  if (switched) showToast('已自动切到逆水寒-饭十七，避免发错账号', 'info')
}

function commerceOptionsForJob() {
  return {
    enabled: Boolean(publishForm.commerceEnabled),
    mode: publishForm.commerceEnabled ? `nishuihan-${activeCommercePreset.value.id}` : '',
    preset: activeCommercePreset.value.id,
    productUrl: publishForm.commerceProductUrl,
    productText: publishForm.commerceProductText,
    tagsRaw: publishForm.tags,
    copyPool: commerceCopyLines()
  }
}

function validateCommerceForm() {
  if (!publishForm.commerceEnabled) return true
  const switched = ensureCommerceAccount()
  if (!isCommerceAccount()) {
    showToast('带货模式只能使用逆水寒专用账号', 'warning')
    return false
  }
  if (switched) showToast('已自动切到逆水寒专用账号，请确认后再发布', 'info')
  selectDouyinOnly()
  if (!publishForm.commerceProductUrl) {
    showToast('带货模式需要填写商品链接', 'warning')
    return false
  }
  if (!publishForm.commerceProductText) {
    showToast('带货模式需要填写商品文案', 'warning')
    return false
  }
  if (!publishForm.tags) publishForm.tags = activeCommercePreset.value.tags
  return true
}

function queueStartTimestamp() {
  if (!publishForm.queueEnabled) return 0
  const date = String(publishForm.queueDate || '').trim()
  const time = String(publishForm.queueTime || '').trim() || '00:00'
  const ts = Date.parse(`${date}T${time}:00`)
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0
}

function validateQueueForm() {
  if (!publishForm.queueEnabled) return true
  if (!queueStartTimestamp()) {
    showToast('请填写有效的定时队列开始时间', 'warning')
    return false
  }
  publishForm.queueIntervalMinutes = Math.max(0, Math.min(1440, Number(publishForm.queueIntervalMinutes) || 0))
  return true
}

function platformKey(account, platform) {
  return `${account?.id || ''}:${platform?.id || ''}`
}

function bindingFor(platform) {
  return accountBindings.value.find(item => item.account_id === selectedAccount.value.id && item.platform_id === platform.id) || {}
}

function loginStatusFor(platform) {
  return bindingFor(platform).login_status || platform.status || 'unknown'
}

function loginLabel(platform) {
  const status = loginStatusFor(platform)
  if (status === 'ready') return '已登录'
  if (status === 'blocked') return '需处理'
  if (status === 'login') return '需登录'
  return '未检查'
}

function pushPublishEvent(message, type = 'info') {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  publishEvents.value = [{ id: `${Date.now()}-${Math.random()}`, time, message, type }].concat(publishEvents.value).slice(0, 12)
}

function setPublishActivity(title, detail, percent, tone = 'active') {
  publishActivity.title = title
  publishActivity.detail = detail || ''
  publishActivity.percent = Math.max(0, Math.min(100, Number(percent) || 0))
  publishActivity.tone = tone
}

async function togglePublishPause() {
  if (!publishingNow.value) return
  if (!publishPaused.value) {
    publishPaused.value = true
    publishStopRequested.value = true
    publishingText.value = '立即暂停'
    const jobId = Number(activePublishJobId.value || runningJobId.value || 0)
    setPublishActivity('立即暂停', jobId ? `正在停止当前发布任务 #${jobId}` : '正在停止发布队列', publishActivity.percent, 'active')
    pushPublishEvent(jobId ? `立即暂停：正在停止任务 #${jobId}` : '立即暂停：正在停止发布队列', 'warning')
    if (jobId) {
      cancellingJobId.value = jobId
      try {
        await cancelVideoPublishJob(jobId)
        await loadRecentJobs()
        setPublishActivity('已暂停', `任务 #${jobId} 已请求停止，后续记录不会继续执行`, 100, 'ok')
        pushPublishEvent(`已暂停：任务 #${jobId} 已停止请求`, 'success')
      } catch (e) {
        await loadRecentJobs()
        setPublishActivity('暂停失败', e.message || '取消任务失败', 100, 'bad')
        pushPublishEvent(`暂停失败：${e.message || '取消任务失败'}`, 'error')
      } finally {
        cancellingJobId.value = 0
      }
    }
    return
  }
  publishStopRequested.value = false
  publishPaused.value = false
  publishingText.value = '发布中'
  pushPublishEvent('继续发布队列', 'success')
  while (publishPauseWaiters.length) {
    const resolve = publishPauseWaiters.shift()
    if (resolve) resolve()
  }
}

function waitWhilePublishPaused(nextIndex, total) {
  if (publishStopRequested.value) return Promise.reject(new Error('发布已立即暂停'))
  if (!publishPaused.value) return Promise.resolve()
  publishingText.value = '已暂停'
  setPublishActivity('已暂停', `队列已暂停，继续后执行 ${nextIndex + 1}/${total}`, publishActivity.percent, 'active')
  return new Promise(resolve => {
    publishPauseWaiters.push(resolve)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function sleepUntilPublishActive(ms) {
  return new Promise(resolve => {
    const started = Date.now()
    const tick = () => {
      if (publishStopRequested.value || Date.now() - started >= ms) {
        resolve()
        return
      }
      window.setTimeout(tick, 500)
    }
    tick()
  })
}

async function waitBeforeNextDirectPublish(nextIndex, total) {
  if (nextIndex >= total) return
  const seconds = Math.round(directPublishCooldownMs / 1000)
  publishingText.value = '慢速等待'
  setPublishActivity('慢速等待', `上一条已结束，等待 ${seconds} 秒后执行 ${nextIndex + 1}/${total}`, publishActivity.percent, 'active')
  pushPublishEvent(`慢速队列等待 ${seconds} 秒，再开始第 ${nextIndex + 1} 条`)
  await sleepUntilPublishActive(directPublishCooldownMs)
}

function jobStatusLabel(status) {
  const map = {
    pending: '待处理',
    ready: '待发表',
    draft: '草稿',
    scheduled: '已定时',
    publishing: '发表中',
    published: '已发表',
    failed: '失败',
    cancelled: '已取消'
  }
  return map[String(status || '')] || (status || '未知')
}

function jobStatusClass(status) {
  const value = String(status || '')
  if (['published', 'draft', 'scheduled'].includes(value)) return 'ok'
  if (value === 'publishing') return 'active'
  if (value === 'failed') return 'bad'
  return 'idle'
}

function jobProgressText(job) {
  const text = String(job?.progress_detail || job?.progress_stage || '').trim()
  if (!text || ['published', 'draft', 'scheduled'].includes(String(job?.status || ''))) return ''
  return text
}

function activeJobProgress(id) {
  const job = recentJobs.value.find(item => Number(item.id) === Number(id))
  return jobProgressText(job)
}

function formatJobTime(ts) {
  const value = Number(ts) || 0
  if (!value) return ''
  return new Date(value * 1000).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function bindingPayload(platform) {
  const fallbackProfile = platform.profile || opencliProfiles.value[0]?.alias || opencliProfiles.value[0]?.context_id
  return {
    account_id: selectedAccount.value.id,
    account_name: selectedAccount.value.name,
    platform_id: platform.id,
    platform_name: platform.name,
    platform_handle: platform.handle,
    profile_alias: bindingFor(platform).profile_alias || fallbackProfile || platform.profile
  }
}

async function loadPublishAccounts() {
  try {
    const data = await listVideoPublishAccounts({ includeProfiles: true })
    accountBindings.value = data.accounts || []
    opencliProfiles.value = data.profiles || []
  } catch (e) {
    accountBindings.value = []
    opencliProfiles.value = []
  }
}

async function saveBinding(platform) {
  const key = platformKey(selectedAccount.value, platform)
  accountBusyKey.value = key
  try {
    await saveVideoPublishAccount(bindingPayload(platform))
    await loadPublishAccounts()
    showToast('发布账号 Profile 已绑定', 'success')
  } catch (e) {
    showToast('绑定失败：' + (e.message || '未知错误'), 'error')
  } finally {
    accountBusyKey.value = ''
  }
}

async function launchProfile(platform) {
  const key = platformKey(selectedAccount.value, platform)
  accountBusyKey.value = key
  try {
    await saveVideoPublishAccount(bindingPayload(platform))
    const data = await launchVideoPublishProfile(bindingPayload(platform))
    await loadPublishAccounts()
    showToast(data.ok ? `已拉起：${data.profile_directory || 'Chrome Profile'}` : ('拉起失败：' + (data.error || '未知错误')), data.ok ? 'success' : 'error')
  } catch (e) {
    showToast('拉起失败：' + (e.message || '未知错误'), 'error')
  } finally {
    accountBusyKey.value = ''
  }
}

async function checkLogin(platform) {
  const key = platformKey(selectedAccount.value, platform)
  accountBusyKey.value = key
  try {
    await saveVideoPublishAccount(bindingPayload(platform))
    const data = await checkVideoPublishLogin(bindingPayload(platform))
    await loadPublishAccounts()
    const ready = data.ready !== undefined ? data.ready : data.login_status === 'ready'
    showToast(ready ? '登录态和发布页可用' : '登录态需要处理：' + (data.error || '请打开登录页确认'), ready ? 'success' : 'warning')
  } catch (e) {
    showToast('检查失败：' + (e.message || '未知错误'), 'error')
  } finally {
    accountBusyKey.value = ''
  }
}

async function openLogin(platform) {
  const key = platformKey(selectedAccount.value, platform)
  accountBusyKey.value = key
  try {
    await saveVideoPublishAccount(bindingPayload(platform))
    await openVideoPublishLogin(bindingPayload(platform))
    showToast('已打开登录窗口，请在对应 Profile 中完成登录', 'info')
  } catch (e) {
    showToast('打开登录窗口失败：' + (e.message || '未知错误'), 'error')
  } finally {
    accountBusyKey.value = ''
  }
}

function queueId(item) {
  return item.localId || item.id
}

function isQueued(id) {
  return videoItems.value.some(item => queueId(item) === id)
}

function materialTitle(item) {
  return item.name || item.original || item.filename || '未命名视频'
}

function tagLine(item) {
  const tags = Array.isArray(item.tags) ? item.tags : String(item.tags || '').split(',').filter(Boolean)
  return tags.length ? tags.slice(0, 4).join(' / ') : '暂无标签'
}

function formatSize(size) {
  const value = Number(size) || 0
  if (!value) return '0 MB'
  if (value > 1024 * 1024 * 1024) return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB'
  return (value / 1024 / 1024).toFixed(1) + ' MB'
}

function openVideoPicker() {
  videoFileInput.value?.click()
}

function localVideoItem(file) {
  return {
    localId: `local-${file.name}-${file.size}-${file.lastModified}`,
    source: 'local',
    file,
    previewUrl: URL.createObjectURL(file),
    name: file.name,
    filename: file.name,
    size: file.size,
    category: '本地视频',
    tags: ['本地导入']
  }
}

function addVideoItems(items) {
  const next = [...videoItems.value]
  let added = 0
  items.forEach(item => {
    const id = queueId(item)
    if (next.some(row => queueId(row) === id)) return
    next.push(item.source ? item : { ...item, source: 'library' })
    added += 1
  })
  videoItems.value = next
  if (!activeVideoId.value && next.length) activeVideoId.value = queueId(next[0])
  return added
}

function addLocalFiles(files) {
  const videos = Array.from(files || []).filter(file => file.type.startsWith('video/'))
  if (!videos.length) {
    showToast('请选择视频文件', 'warning')
    return
  }
  const added = addVideoItems(videos.map(localVideoItem))
  showToast(added ? `已加入 ${added} 个本地视频` : '视频已在发布区', added ? 'success' : 'info')
}

function handleLocalPick(event) {
  addLocalFiles(event.target.files)
  event.target.value = ''
}

function handleLocalDrop(event) {
  localDragging.value = false
  addLocalFiles(event.dataTransfer?.files)
}

function toggleQueue(item) {
  const id = queueId(item)
  if (isQueued(id)) {
    removeVideo(id)
    return
  }
  const added = addVideoItems([{ ...item, source: 'library' }])
  if (added) showToast('已从素材库加入发布区', 'success')
}

function removeVideo(id) {
  videoItems.value = videoItems.value.filter(item => queueId(item) !== id)
  if (activeVideoId.value === id) activeVideoId.value = queueId(videoItems.value[0] || {}) || ''
}

function clearVideos() {
  videoItems.value = []
  activeVideoId.value = ''
}

function serializeVideoForJob(item) {
  return {
    id: item.id || '',
    localId: item.localId || '',
    source: item.source || 'library',
    name: materialTitle(item),
    filename: item.filename || item.name || item.original || '',
    title: item.title || '',
    description: item.description || '',
    size: Number(item.size) || 0,
    url: item.url || item.path || item.src || '',
    category: item.category || '',
    tags: Array.isArray(item.tags) ? item.tags : String(item.tags || '').split(',').filter(Boolean)
  }
}

async function ensureServerVideo(item) {
  if (item.source !== 'local' || !item.file || item.url) return item
  const data = await uploadVideoPublishFile(item.file, {
    account_id: selectedAccount.value.id,
    account_name: selectedAccount.value.name
  })
  return {
    ...item,
    uploaded: true,
    source: 'local',
    id: data.video?.filename || item.id || item.localId,
    filename: data.video?.filename || item.filename,
    name: data.video?.name || item.name,
    size: data.video?.size || item.size,
    url: data.video?.url || item.url
  }
}

async function prepareVideosForJobs() {
  const prepared = []
  for (let i = 0; i < videoItems.value.length; i += 1) {
    const item = videoItems.value[i]
    if (item.source === 'local' && item.file && !item.url) {
      publishingText.value = `上传本地视频 ${i + 1}/${videoItems.value.length}`
    }
    prepared.push(await ensureServerVideo(item))
  }
  videoItems.value = prepared
  return prepared
}

async function prepareOneVideoForJob(item, index, total) {
  if (item.source === 'local' && item.file && !item.url) {
    publishingText.value = `上传视频 ${index + 1}/${total}`
    setPublishActivity('上传视频', `正在上传第 ${index + 1}/${total} 条素材：${materialTitle(item)}`, 18, 'active')
    pushPublishEvent(`上传第 ${index + 1}/${total} 条素材：${materialTitle(item)}`)
  }
  const ready = await ensureServerVideo(item)
  videoItems.value = videoItems.value.map(row => queueId(row) === queueId(item) ? ready : row)
  return ready
}

async function ensureActiveVideoReady() {
  const current = activeVideo.value
  if (!current) throw new Error('请先上传或导入一个视频')
  const ready = await ensureServerVideo(current)
  videoItems.value = videoItems.value.map(item => queueId(item) === queueId(current) ? ready : item)
  if (!activeVideoId.value) activeVideoId.value = queueId(ready)
  return ready
}

async function transcribeActiveVideoForCopy() {
  setPublishActivity('视频转写', '正在提取音频并转写视频文案', 18, 'active')
  pushPublishEvent('开始转写当前视频')
  const readyVideo = await ensureActiveVideoReady()
  const data = await transcribeVideoPublishVideo({
    url: readyVideo.url || readyVideo.path || readyVideo.src,
    filename: readyVideo.filename || readyVideo.name
  })
  const text = String(data.text || '').trim()
  if (!text) throw new Error(data.error || '未拿到可用转写文本')
  activeTranscript.value = text
  setPublishActivity('转写完成', `已获得 ${text.length} 字转写稿，正在生成发布信息`, 42, 'active')
  pushPublishEvent(`转写完成：${text.length} 字`, 'success')
  return text
}

async function ensureSelectedBindings() {
  for (const platform of selectedPlatforms.value) {
    await saveVideoPublishAccount(bindingPayload(platform))
  }
  await loadPublishAccounts()
}

function serializePlatformForJob(platform) {
  return {
    id: platform.id,
    name: platform.name,
    handle: platform.handle,
    profile: platform.profile,
    status: platform.status
  }
}

function serializeAccountForJob(account) {
  return {
    id: account.id,
    name: account.name,
    description: account.description,
    styleHint: account.styleHint
  }
}

async function loadMaterials() {
  materialLoading.value = true
  try {
    const data = await listMaterials({
      type: 'video',
      search: materialSearch.value,
      page: 1,
      pageSize: 12,
      sortBy: 'created_at',
      sortDir: 'desc'
    })
    materials.value = data.list || []
  } catch (e) {
    materials.value = []
    showToast('素材库读取失败：' + e.message, 'error')
  } finally {
    materialLoading.value = false
  }
}

async function addProjectTaskMaterial(ctx) {
  const materialId = Number(ctx?.material_id) || 0
  if (!materialId && !ctx?.material_name) return
  materialLoading.value = true
  try {
    const data = await listMaterials({
      type: 'video',
      id: materialId || undefined,
      search: materialId ? '' : (ctx.material_name || ''),
      page: 1,
      pageSize: 60,
      sortBy: 'created_at',
      sortDir: 'desc'
    })
    const rows = data.list || []
    materials.value = rows
    const item = rows.find(row => Number(row.id) === materialId) ||
      rows.find(row => String(row.original || row.filename || '').includes(ctx.material_name || '')) ||
      rows[0]
    if (!item) {
      showToast('Project task material was not found in the video library', 'warning')
      return
    }
    const added = addVideoItems([{ ...item, source: 'library' }])
    activeVideoId.value = queueId(item)
    publishForm.title = publishForm.title || ctx.title || materialTitle(item)
    projectTaskContext.value = ctx
    if (added) showToast('Project task material added to publish queue', 'success')
  } catch (e) {
    showToast('Failed to load project task material: ' + e.message, 'error')
  } finally {
    materialLoading.value = false
  }
}

function applyProjectDeliveryContext(payload) {
  const ctx = payload?.projectDeliveryTask || payload
  if (!ctx || ctx.source !== 'project-delivery') return
  projectTaskContext.value = ctx
  addProjectTaskMaterial(ctx)
}

async function loadRecentJobs() {
  try {
    const data = await listVideoPublishJobs({ limit: 20 })
    recentJobs.value = data.jobs || []
    loadQueueStatus()
    syncPublishingStateFromJobs()
  } catch (e) {
    recentJobs.value = []
  }
}

async function loadQueueStatus() {
  try {
    const data = await getVideoPublishQueueStatus()
    if (data && data.ok !== false) {
      queueStatus.paused = Boolean(data.paused)
      queueStatus.running = Boolean(data.running)
      queueStatus.scheduled_count = Number(data.scheduled_count) || 0
      queueStatus.next_scheduled_at = Number(data.next_scheduled_at) || 0
      queueStatus.publishing_count = Number(data.publishing_count) || 0
    }
  } catch {
    // Queue status is auxiliary; recent jobs remain the source of truth.
  }
}

async function toggleQueuePaused() {
  queueStatusBusy.value = true
  try {
    const nextPaused = !queueStatus.paused
    const data = await pauseVideoPublishQueue(nextPaused)
    queueStatus.paused = Boolean(data.paused)
    await loadRecentJobs()
    showToast(queueStatus.paused ? '定时队列已暂停' : '定时队列已恢复', queueStatus.paused ? 'warning' : 'success')
  } catch (e) {
    showToast('定时队列状态更新失败：' + (e.message || '未知错误'), 'error')
  } finally {
    queueStatusBusy.value = false
  }
}

function syncPublishingStateFromJobs() {
  if (publishingNow.value && activePublishJobId.value) {
    const current = recentJobs.value.find(job => Number(job.id) === Number(activePublishJobId.value))
    if (current && String(current.status || '') !== 'publishing') {
      publishingNow.value = false
      publishPaused.value = false
      publishStopRequested.value = false
      activePublishJobId.value = 0
      const ok = ['published', 'draft', 'scheduled', 'ready'].includes(String(current.status || ''))
      const progress = jobProgressText(current) || jobStatusLabel(current.status)
      setPublishActivity(ok ? '发布完成' : '发布停止', progress, 100, ok ? 'ok' : 'bad')
      pushPublishEvent(`发布任务 #${current.id} 已更新为 ${jobStatusLabel(current.status)}`, ok ? 'success' : 'warning')
    }
    return
  }
  if (publishingNow.value) return
  const active = recentJobs.value.find(job => String(job.status || '') === 'publishing')
  if (!active) return
  publishingNow.value = true
  publishPaused.value = false
  publishStopRequested.value = false
  activePublishJobId.value = active.id
  const progress = jobProgressText(active) || '已有发布任务正在执行'
  publishingText.value = progress.slice(0, 12)
  setPublishActivity('发布中', progress, 55, 'active')
  pushPublishEvent(`已接管正在执行的发布任务 #${active.id}`)
}

function canRunJob(job) {
  return ['pending', 'ready', 'draft', 'scheduled', 'failed', 'cancelled'].includes(String(job?.status || ''))
}

function canCancelJob(job) {
  return ['publishing', 'scheduled'].includes(String(job?.status || ''))
}

async function runJob(job) {
  if (!job?.id) return
  runningJobId.value = job.id
  setPublishActivity('发表中', `${job.platform?.name || job.platform?.id || '平台'} 任务 #${job.id} 正在执行`, 35, 'active')
  pushPublishEvent(`开始发表：${job.platform?.name || job.platform?.id || '平台'} #${job.id}`)
  let progressTimer = 0
  try {
    progressTimer = window.setInterval(async () => {
      await loadRecentJobs()
      const progress = activeJobProgress(job.id)
      if (progress) {
        setPublishActivity('发表中', progress, publishActivity.percent || 35, 'active')
        publishingText.value = progress.slice(0, 12)
      }
    }, 2000)
    const data = await runVideoPublishJob(job.id)
    await loadRecentJobs()
    if (data.ok) {
      setPublishActivity('发表完成', `${job.platform?.name || job.platform?.id || '平台'} 任务已完成`, 100, 'ok')
      pushPublishEvent(`发表完成：${job.platform?.name || job.platform?.id || '平台'} #${job.id}`, 'success')
    } else {
      setPublishActivity('发表失败', data.error || '平台执行失败', 100, 'bad')
      pushPublishEvent(`发表失败：${data.error || '平台执行失败'}`, 'error')
    }
    showToast(data.ok ? '发布执行已完成' : '发布执行失败：' + (data.error || ''), data.ok ? 'success' : 'error')
  } catch (e) {
    await loadRecentJobs()
    setPublishActivity('发表失败', e.message || '未知错误', 100, 'bad')
    pushPublishEvent(`发表失败：${e.message || '未知错误'}`, 'error')
    showToast('发布执行失败：' + (e.message || '未知错误'), 'error')
  } finally {
    if (progressTimer) window.clearInterval(progressTimer)
    runningJobId.value = 0
  }
}

async function cancelJob(job) {
  if (!job?.id) return
  cancellingJobId.value = job.id
  setPublishActivity('取消任务', `正在取消发布任务 #${job.id}`, 65, 'active')
  pushPublishEvent(`请求取消：任务 #${job.id}`, 'warning')
  try {
    const data = await cancelVideoPublishJob(job.id)
    await loadRecentJobs()
    if (data.ok) {
      setPublishActivity('已取消', `任务 #${job.id} 已停止，可从历史中重新发表`, 100, 'ok')
      pushPublishEvent(`已取消：任务 #${job.id}`, 'success')
      showToast('发布任务已取消', 'success')
    } else {
      throw new Error(data.error || '取消失败')
    }
  } catch (e) {
    await loadRecentJobs()
    setPublishActivity('取消失败', e.message || '未知错误', 100, 'bad')
    pushPublishEvent(`取消失败：${e.message || '未知错误'}`, 'error')
    showToast('取消失败：' + (e.message || '未知错误'), 'error')
  } finally {
    cancellingJobId.value = 0
  }
}

async function checkJob(job) {
  if (!job?.id) return
  checkingJobId.value = job.id
  setPublishActivity('检查任务', `${job.platform?.name || job.platform?.id || '平台'} #${job.id} 正在检查登录态和视频文件`, 20, 'active')
  pushPublishEvent(`检查任务：${job.platform?.name || job.platform?.id || '平台'} #${job.id}`)
  try {
    const data = await checkVideoPublishJob(job.id)
    const message = data.ok ? '任务可执行' : `暂不可执行：${(data.reasons || []).join('；') || data.error || '未知原因'}`
    setPublishActivity(data.ok ? '检查通过' : '检查未通过', message, data.ok ? 45 : 100, data.ok ? 'ok' : 'bad')
    pushPublishEvent(message, data.ok ? 'success' : 'warning')
    showToast(message, data.ok ? 'success' : 'warning')
  } catch (e) {
    setPublishActivity('检查失败', e.message || '未知错误', 100, 'bad')
    pushPublishEvent(`检查失败：${e.message || '未知错误'}`, 'error')
    showToast('任务检查失败：' + (e.message || '未知错误'), 'error')
  } finally {
    checkingJobId.value = 0
  }
}

function buildFallbackCopy() {
  const title = materialTitle(activeVideo.value || {})
  const tags = tagLine(activeVideo.value || {}).replace(/\s*\/\s*/g, ', ')
  publishForm.title = publishForm.title || title
  const transcriptLead = activeTranscript.value
    ? activeTranscript.value.replace(/\s+/g, ' ').slice(0, 90)
    : ''
  publishForm.description = publishForm.description || (transcriptLead
    ? `${transcriptLead}... 你觉得这个点最有意思的是哪里？`
    : `这条内容适合用「${selectedAccount.value.name}」的口吻发布：先抓住看点，再把事件讲清楚，最后给一个适合评论区接话的收束。`)
  publishForm.tags = publishForm.tags || (tags && tags !== '暂无标签' ? tags : '#热点 #视频 #内容分发')
  aiSource.value = 'fallback'
  aiHint.value = activeTranscript.value ? '模型暂时不可用，已根据转写稿生成一版本地推荐。' : '模型暂时不可用，已用视频信息和账号风格生成一版本地推荐。'
}

function parseAiCopy(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
    const data = JSON.parse(cleaned)
    return {
      title: data.title || '',
      description: data.description || data.desc || '',
      tags: Array.isArray(data.tags) ? data.tags.join(' ') : (data.tags || '')
    }
  } catch (e) {
    const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
    return {
      title: lines[0]?.replace(/^标题[:：]\s*/, '') || '',
      description: lines.slice(1, 4).join('\n'),
      tags: ''
    }
  }
}

async function recommendPublishCopy() {
  if (!activeVideo.value) {
    showToast('先上传或导入一个视频', 'warning')
    return false
  }

  aiBusy.value = true
  aiHint.value = ''
  aiSource.value = ''
  aiError.value = ''
  try {
    const transcript = await transcribeActiveVideoForCopy()
    const prompt = [
      '请根据视频转写稿，为短视频发布页生成发布信息。',
      `账号：${selectedAccount.value.name}`,
      `账号风格：${selectedAccount.value.styleHint}`,
      `发布平台：${selectedPlatformLabels.value}`,
      `视频：${materialTitle(activeVideo.value)}｜${activeVideo.value.category || '未分类'}｜${tagLine(activeVideo.value)}`,
      '转写稿（主要依据）：',
      transcript.slice(0, 6000),
      '要求：标题 10-30 字，必须贴合转写稿里的真实内容；描述 60-120 字，保留视频看点和评论引导；话题 3-5 个，带 #。只返回 JSON：{"title":"","description":"","tags":[""]}'
    ].join('\n')
    const data = await chatMinimax({
      model: 'gpt-5.5',
      system: '你是短视频发布运营助手。必须基于转写稿生成标题、描述和话题，不要凭空编造。只返回可解析 JSON，不要 Markdown。',
      prompt
    })
    const reply = data.reply || data.text || data.content
    if (/^error:/i.test(String(reply || '').trim())) throw new Error(String(reply).replace(/^error:\s*/i, ''))
    const parsed = parseAiCopy(reply)
    if (!parsed || (!parsed.title && !parsed.description)) throw new Error(data.error || 'AI 未返回有效文案')
    publishForm.title = parsed.title || publishForm.title
    publishForm.description = parsed.description || publishForm.description
    publishForm.tags = parsed.tags || publishForm.tags
    aiSource.value = 'model'
    setPublishActivity('AI 推荐完成', '已基于视频转写稿生成发布信息', 62, 'ok')
    pushPublishEvent('AI 推荐完成：已基于转写稿生成', 'success')
    aiHint.value = `已基于 ${activeTranscript.value.length} 字视频转写稿，为 ${selectedAccount.value.name} 和 ${selectedPlatformLabels.value} 推荐发布信息。`
    showToast('AI 推荐已填入发布信息', 'success')
    return true
  } catch (e) {
    aiError.value = e.message || '模型无返回'
    pushPublishEvent(`AI 推荐转入兜底：${aiError.value}`, 'warning')
    buildFallbackCopy()
    showToast('AI 推荐暂不可用，已使用本地推荐', 'info')
    return true
  } finally {
    aiBusy.value = false
  }
}

async function runCreatedPublishIds(ids, results, currentIndex, totalCount) {
  for (let i = 0; i < ids.length; i += 1) {
    if (publishStopRequested.value) break
    await waitWhilePublishPaused(currentIndex, totalCount)
    const id = ids[i]
    activePublishJobId.value = id
    const pct = Math.round(55 + (currentIndex / Math.max(1, totalCount)) * 40)
    publishingText.value = `执行发布 ${currentIndex + 1}/${totalCount}`
    setPublishActivity('执行发布', `正在执行第 ${currentIndex + 1}/${totalCount} 条：记录 #${id}`, pct, 'active')
    pushPublishEvent(`开始发布第 ${currentIndex + 1}/${totalCount} 条：记录 #${id}`)
    let progressTimer = 0
    try {
      progressTimer = window.setInterval(async () => {
        await loadRecentJobs()
        const progress = activeJobProgress(id)
        if (progress) {
          publishingText.value = progress.slice(0, 12)
          setPublishActivity('执行中', `第 ${currentIndex + 1}/${totalCount} 条：${progress}`, pct, 'active')
        }
      }, 2000)
      const result = await runVideoPublishJob(id)
      if (progressTimer) {
        window.clearInterval(progressTimer)
        progressTimer = 0
      }
      if (publishStopRequested.value) break
      if (result.ok === false) throw new Error(result.error || '执行失败')
      results.push({ id, ok: result.ok !== false, ...result })
      if (result.needs_confirm) {
        pushPublishEvent(`挂车完成：记录 #${id}，已停在发布前`, 'success')
      } else {
        pushPublishEvent(`发布完成：记录 #${id}`, 'success')
      }
    } catch (err) {
      if (progressTimer) window.clearInterval(progressTimer)
      if (publishStopRequested.value) {
        results.push({ id, ok: false, cancelled: true, error: '发布已立即暂停' })
        pushPublishEvent(`已暂停：记录 #${id} 已停止`, 'warning')
        setPublishActivity('已暂停', `记录 #${id} 已停止，后续记录未继续执行`, pct, 'active')
        await loadRecentJobs()
        break
      }
      results.push({ id, ok: false, error: err.message || '执行失败' })
      pushPublishEvent(`发布失败：记录 #${id}，${err.message || '执行失败'}`, 'error')
      setPublishActivity('队列已停止', `记录 #${id} 失败，后续记录未继续打开页面`, pct, 'bad')
      publishPaused.value = true
      await loadRecentJobs()
      break
    }
    activePublishJobId.value = 0
    await loadRecentJobs()
  }
}

async function publishNow() {
  if (!videoItems.value.length) {
    showToast('请先上传或导入视频', 'warning')
    return
  }
  if (!selectedPlatformIds.value.length) {
    showToast('请选择至少一个发布平台', 'warning')
    return
  }
  if (!validateCommerceForm()) return
  if (!validateQueueForm()) return
  if (!validateManualCopyForm()) return
  const queueMode = Boolean(publishForm.queueEnabled)
  publishingNow.value = true
  publishStopRequested.value = false
  activePublishJobId.value = 0
  publishingText.value = queueMode ? '准备入队' : '准备发布'
  setPublishActivity(queueMode ? '准备入队' : '准备发布', '正在整理视频、账号和平台信息', 10, 'active')
  pushPublishEvent(`${queueMode ? '开始入队' : '开始发布'}：${selectedPlatforms.value.map(item => item.name).join(' / ')}`)
  try {
    if (publishForm.copyMode !== 'manual' && !publishForm.title && !publishForm.description && !publishForm.tags) {
      await recommendPublishCopy()
    }
    if (!queueMode) {
      publishingText.value = '确认账号'
      setPublishActivity('确认账号', '正在确认已选平台 Profile 绑定', 35, 'active')
      await ensureSelectedBindings()
      const formForDirectJob = {
        ...publishForm,
        publishTime: publishForm.publishTime
      }
      const results = []
      const total = videoItems.value.length
      pushPublishEvent(`立即发布改为逐条处理：共 ${total} 条素材，每次只上传并发布 1 条`, 'success')
      for (let i = 0; i < total; i += 1) {
        if (publishStopRequested.value) break
        await waitWhilePublishPaused(i, total)
        const preparedVideo = applyCommerceCopiesToVideos(applyManualCopiesToVideos([await prepareOneVideoForJob(videoItems.value[i], i, total)], i))[0]
        if (publishStopRequested.value) break
        publishingText.value = `创建任务 ${i + 1}/${total}`
        setPublishActivity('创建发布任务', `正在写入第 ${i + 1}/${total} 条发布记录`, 45, 'active')
        const data = await createVideoPublishJobs({
          account: serializeAccountForJob(selectedAccount.value),
          platforms: selectedPlatforms.value.map(serializePlatformForJob),
          videos: [serializeVideoForJob(preparedVideo)],
          form: formForDirectJob,
          options: {
            commerce: commerceOptionsForJob()
          },
          project_delivery: projectTaskContext.value || null
        })
        const jobs = Array.isArray(data.jobs) ? data.jobs : []
        const ids = jobs.map(job => job.id).filter(Boolean)
        if (!ids.length) throw new Error('没有生成可执行的发布记录')
        await runCreatedPublishIds(ids, results, i, total)
        if (publishPaused.value || results.some(item => !item.ok && !item.cancelled)) break
        await loadRecentJobs()
        if (publishStopRequested.value) break
        await waitBeforeNextDirectPublish(i + 1, total)
      }

      if (publishStopRequested.value) {
        setPublishActivity('已暂停', '发布队列已立即暂停，后续记录未执行', 100, 'active')
        showToast('发布队列已暂停', 'warning')
        return
      }
      const failed = results.filter(item => !item.ok).length
      const waitingConfirm = results.filter(item => item.ok && item.needs_confirm).length
      setPublishActivity(
        failed ? '发布完成，有失败' : (waitingConfirm ? '待确认发布' : '发布完成'),
        failed ? `${failed} 条发布失败，请在历史里重试` : (waitingConfirm ? `${waitingConfirm} 条已挂商品，等待手动点发布` : `${results.length} 条发布已执行`),
        100,
        failed ? 'bad' : 'ok'
      )
      showToast(failed ? `发布执行完成，${failed} 条失败` : (waitingConfirm ? '商品已挂好，停在发布前' : '所选平台已执行发布'), failed ? 'warning' : 'success', {
        celebrate: !failed,
        celebrationTitle: waitingConfirm ? `${selectedAccount.value.name} 待确认发布` : `${selectedAccount.value.name} 发布完成`
      })
      return
    }
    const preparedVideos = applyCommerceCopiesToVideos(applyManualCopiesToVideos(await prepareVideosForJobs()))
    publishingText.value = '确认账号'
    setPublishActivity('确认账号', '正在确认已选平台 Profile 绑定', 35, 'active')
    await ensureSelectedBindings()
    publishingText.value = '写入历史'
    setPublishActivity('写入历史', '正在写入发布历史并准备执行', 50, 'active')
    const formForJob = {
      ...publishForm,
      publishTime: queueMode ? 'queue' : publishForm.publishTime
    }
    const data = await createVideoPublishJobs({
      account: serializeAccountForJob(selectedAccount.value),
      platforms: selectedPlatforms.value.map(serializePlatformForJob),
      videos: preparedVideos.map(serializeVideoForJob),
      form: formForJob,
      options: {
        commerce: commerceOptionsForJob()
      },
      project_delivery: projectTaskContext.value || null
    })
    const jobs = Array.isArray(data.jobs) ? data.jobs : []
    const ids = jobs.map(job => job.id).filter(Boolean)
    if (!ids.length) throw new Error('没有生成可执行的发布记录')

    if (queueMode) {
      await loadRecentJobs()
      const firstAt = new Date(queueStartTimestamp() * 1000).toLocaleString('zh-CN', { hour12: false })
      publishingText.value = '已入队'
      setPublishActivity('已加入定时队列', `${ids.length} 条记录已绑定 ${selectedAccount.value.name}，从 ${firstAt} 开始触发`, 100, 'ok')
      pushPublishEvent(`定时队列已创建：${ids.length} 条，从 ${firstAt} 开始`, 'success')
      showToast(`${ids.length} 条已加入定时队列`, 'success', {
        celebrate: true,
        celebrationTitle: `${selectedAccount.value.name} 定时队列已创建`
      })
      return
    }

    publishingText.value = '发布中'
    pushPublishEvent(`发布历史已写入：${ids.length} 条，开始直接执行`, 'success')
    const results = []
    for (let i = 0; i < ids.length; i += 1) {
      if (publishStopRequested.value) break
      await waitWhilePublishPaused(i, ids.length)
      const id = ids[i]
      activePublishJobId.value = id
      const pct = Math.round(55 + (i / ids.length) * 40)
      publishingText.value = `准备执行 ${i + 1}/${ids.length}`
      setPublishActivity('准备执行', `正在执行 ${i + 1}/${ids.length}：记录 #${id}`, pct, 'active')
      pushPublishEvent(`开始发布记录 #${id}`)
      let progressTimer = 0
      try {
        progressTimer = window.setInterval(async () => {
          await loadRecentJobs()
          const progress = activeJobProgress(id)
          if (progress) {
            publishingText.value = progress.slice(0, 12)
            setPublishActivity('执行中', `${i + 1}/${ids.length}：${progress}`, pct, 'active')
          }
        }, 2000)
        const result = await runVideoPublishJob(id)
        if (progressTimer) {
          window.clearInterval(progressTimer)
          progressTimer = 0
        }
        if (publishStopRequested.value) break
        if (result.ok === false) throw new Error(result.error || '执行失败')
        results.push({ id, ok: result.ok !== false, ...result })
        if (result.needs_confirm) {
          pushPublishEvent(`挂车完成：记录 #${id}，已停在发布前`, 'success')
        } else {
          pushPublishEvent(`发布完成：记录 #${id}`, 'success')
        }
      } catch (err) {
        if (progressTimer) window.clearInterval(progressTimer)
        if (publishStopRequested.value) {
          results.push({ id, ok: false, cancelled: true, error: '发布已立即暂停' })
          pushPublishEvent(`已暂停：记录 #${id} 已停止`, 'warning')
          setPublishActivity('已暂停', `记录 #${id} 已停止，后续记录未继续执行`, pct, 'active')
          await loadRecentJobs()
          break
        }
        results.push({ id, ok: false, error: err.message || '执行失败' })
        pushPublishEvent(`发布失败：记录 #${id}，${err.message || '执行失败'}`, 'error')
        setPublishActivity('队列已停止', `记录 #${id} 失败，后续记录未继续打开页面`, pct, 'bad')
        publishPaused.value = true
        await loadRecentJobs()
        break
      }
      activePublishJobId.value = 0
      await loadRecentJobs()
      if (publishStopRequested.value) break
      await waitBeforeNextDirectPublish(i + 1, ids.length)
    }

    if (publishStopRequested.value) {
      setPublishActivity('已暂停', '发布队列已立即暂停，后续记录未执行', 100, 'active')
      showToast('发布队列已暂停', 'warning')
      return
    }
    const failed = results.filter(item => !item.ok).length
    const waitingConfirm = results.filter(item => item.ok && item.needs_confirm).length
    setPublishActivity(
      failed ? '发布完成，有失败' : (waitingConfirm ? '待确认发布' : '发布完成'),
      failed ? `${failed} 条发布失败，请在历史里重试` : (waitingConfirm ? `${waitingConfirm} 条已挂商品，等待手动点发布` : `${results.length} 条发布已执行`),
      100,
      failed ? 'bad' : 'ok'
    )
    showToast(failed ? `发布执行完成，${failed} 条失败` : (waitingConfirm ? '商品已挂好，停在发布前' : '所选平台已执行发布'), failed ? 'warning' : 'success', {
      celebrate: !failed,
      celebrationTitle: waitingConfirm ? `${selectedAccount.value.name} 待确认发布` : `${selectedAccount.value.name} 发布完成`
    })
  } catch (e) {
    setPublishActivity('发布失败', e.message || '后端无返回', 100, 'bad')
    pushPublishEvent(`发布失败：${e.message || '后端无返回'}`, 'error')
    showToast('发布失败：' + (e.message || '后端无返回'), 'error')
  } finally {
    publishingNow.value = false
    publishPaused.value = false
    publishStopRequested.value = false
    activePublishJobId.value = 0
    while (publishPauseWaiters.length) {
      const resolve = publishPauseWaiters.shift()
      if (resolve) resolve()
    }
    publishingText.value = '发布中'
  }
}

onMounted(() => {
  Object.keys(commercePresets).forEach(id => loadCommerceQueue(id))
  ensureCommerceCopyQueue(publishForm.commercePreset, 3, 20)
  loadRecentJobs()
  loadPublishAccounts()
  recentJobsTimer = window.setInterval(loadRecentJobs, 3000)
})

onUnmounted(() => {
  if (recentJobsTimer) window.clearInterval(recentJobsTimer)
})

watch(() => props.trafficContext, payload => {
  applyProjectDeliveryContext(payload)
}, { immediate: true })
</script>

<style scoped>
.video-publish-module {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.publish-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.publish-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.publish-layout.official {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 12px;
  overflow: hidden;
}

.publish-editor,
.publish-side {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.publish-card,
.side-card {
  border: 1px solid var(--card-border, var(--border));
  border-radius: 10px;
  background: var(--card-bg, var(--panel-bg));
  box-shadow: var(--shadow);
}

.publish-card {
  padding: 16px;
}

.project-task-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(56, 189, 248, 0.22);
  border-radius: 8px;
  background: rgba(56, 189, 248, 0.07);
}

.project-task-banner strong,
.project-task-banner span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-task-banner strong {
  color: var(--text);
  font-size: 13px;
}

.project-task-banner span {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 12px;
}

.side-card {
  padding: 12px;
}

.section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-title.compact {
  display: block;
}

.section-title strong {
  display: block;
  color: var(--text);
  font-size: 15px;
  font-weight: 850;
}

.section-title span {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.upload-zone {
  min-height: 260px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 9px;
  border: 1px dashed var(--border-mid);
  border-radius: 12px;
  background: var(--panel-bg-soft);
  text-align: center;
}

.upload-zone.dragging {
  border-color: var(--success-border);
  background: var(--success-bg);
}

.upload-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--success-text);
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  font-size: 24px;
  font-weight: 900;
}

.upload-zone strong {
  color: var(--text);
  font-size: 17px;
}

.upload-zone span {
  max-width: 460px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.video-preview-shell {
  display: grid;
  grid-template-columns: minmax(280px, 420px) minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
}

.video-preview {
  aspect-ratio: 16 / 9;
  min-height: 220px;
  overflow: hidden;
  border-radius: 12px;
  background: #111827;
}

.video-preview video,
.video-placeholder {
  width: 100%;
  height: 100%;
}

.video-preview video {
  display: block;
  object-fit: contain;
}

.video-placeholder {
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  font-weight: 900;
}

.video-meta {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--chip-border);
  border-radius: 10px;
  background: var(--panel-bg-soft);
}

.video-meta strong,
.video-meta span {
  display: block;
}

.video-meta strong {
  color: var(--text);
  font-size: 15px;
  line-height: 1.4;
}

.video-meta span {
  margin-top: 7px;
  color: var(--text-muted);
  font-size: 12px;
}

.video-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.video-strip {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.video-chip {
  flex: 0 0 176px;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  padding: 7px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-dim);
}

.video-chip.active {
  border-color: var(--success-border);
  background: var(--success-bg);
}

.video-chip span {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--success-text);
  background: var(--card-bg);
  font-size: 11px;
  font-weight: 900;
}

.video-chip em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
  font-size: 12px;
}

.video-chip em small {
  display: block;
  margin-bottom: 1px;
  color: var(--text-muted);
  font-size: 10px;
  font-style: normal;
}

.field {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.field > span {
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 750;
}

.inp {
  width: 100%;
}

.desc-input {
  min-height: 150px;
  resize: vertical;
}

.topic-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.ai-btn {
  margin-bottom: 12px;
  height: 36px;
  white-space: nowrap;
}

.copy-source-card {
  display: grid;
  gap: 10px;
  margin: 0 0 14px;
  padding: 12px;
  border: 1px solid var(--chip-border, var(--border));
  border-radius: 10px;
  background: var(--panel-bg-soft);
}

.copy-source-head {
  display: grid;
  gap: 3px;
}

.copy-source-head strong {
  color: var(--text);
  font-size: 13px;
}

.copy-source-head span,
.manual-copy-field small {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.manual-copy-field small.warn {
  color: var(--warning-text, #a16207);
}

.copy-source-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.copy-source-options label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 8px 10px;
  border: 1px solid var(--chip-border, var(--border));
  border-radius: 8px;
  background: var(--card-bg);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.copy-source-options label.active {
  border-color: var(--success-border);
  color: var(--success-text);
  background: var(--success-bg);
}

.manual-copy-field {
  margin-bottom: 0;
}

.manual-copy-input {
  min-height: 176px;
  resize: vertical;
  line-height: 1.55;
}

.commerce-mode-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--chip-border, var(--border));
  border-radius: 8px;
  background: var(--row-bg, var(--surface2));
}

.commerce-mode-bar.active {
  border-color: var(--primary);
  background: var(--accent-soft, rgba(123, 47, 255, 0.12));
}

.commerce-mode-bar label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
  font-weight: 800;
}

.commerce-mode-bar em {
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.commerce-panel {
  display: grid;
  gap: 10px;
  margin: 2px 0 14px;
  padding: 12px;
  border: 1px solid var(--card-border, var(--border));
  border-radius: 8px;
  background: var(--row-bg, var(--surface2));
}

.commerce-panel .field {
  margin-bottom: 0;
}

.commerce-reference-details {
  border: 1px solid var(--chip-border, var(--border));
  border-radius: 8px;
  background: var(--card-bg);
}

.commerce-reference-details summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
  font-weight: 850;
}

.commerce-reference-details summary em {
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
  font-weight: 650;
}

.commerce-reference-details .field {
  padding: 0 12px 12px;
}

.commerce-panel-head,
.commerce-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.commerce-panel-head strong {
  display: block;
  color: var(--text);
  font-size: 13px;
}

.commerce-panel-head span {
  color: var(--text-muted);
  font-size: 12px;
}

.commerce-preset-actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.commerce-queue-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px dashed var(--chip-border, var(--border));
  border-radius: 8px;
  background: var(--surface, #fff);
}

.commerce-queue-row span {
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.commerce-queue-row div {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
}

.commerce-copy-input {
  min-height: 128px;
  resize: vertical;
}

.queue-panel {
  display: grid;
  gap: 10px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--chip-border, var(--border));
  border-radius: 8px;
  background: var(--row-bg, var(--surface2));
}

.queue-panel.active {
  border-color: var(--primary);
}

.queue-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
  font-weight: 800;
}

.queue-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 112px;
  gap: 10px;
  align-items: end;
}

.queue-panel small {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.commerce-test-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}

.cover-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  margin: 4px 0 12px;
  padding: 12px;
  border: 1px solid var(--chip-border);
  border-radius: 10px;
  background: var(--panel-bg-soft);
}

.cover-box span,
.cover-box strong,
.cover-box small {
  display: block;
}

.cover-box span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.cover-box strong {
  margin-top: 3px;
  color: var(--text);
  font-size: 14px;
}

.cover-box small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.cover-actions,
.switch-row,
.platform-actions,
.material-search {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.cover-actions .active {
  border-color: var(--success-border);
  color: var(--success-text);
  background: var(--success-bg);
}

.job-progress {
  display: block;
  color: var(--primary);
  font-weight: 800;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.switch-row {
  margin-top: 2px;
  color: var(--text-dim);
  font-size: 12px;
}

.switch-row label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ai-hint {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  margin-top: 12px;
  padding: 9px;
  border: 1px solid var(--success-border);
  border-radius: 9px;
  background: var(--success-bg);
}

.ai-hint span {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--success-text);
  background: var(--card-bg);
  font-size: 11px;
  font-weight: 900;
}

.ai-hint p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.ai-hint p strong,
.ai-hint p em {
  display: block;
}

.ai-hint p strong {
  color: var(--text);
  font-size: 12px;
}

.ai-hint p em {
  margin-top: 4px;
  color: var(--warning-text, #a16207);
  font-style: normal;
}

.account-card {
  display: grid;
  gap: 8px;
}

.selected-account {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--success-border);
  border-radius: 10px;
  background: var(--success-bg);
}

.selected-account > span {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: var(--success-text);
  background: var(--card-bg);
  font-weight: 900;
}

.selected-account strong,
.selected-account small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selected-account strong {
  color: var(--text);
  font-size: 13px;
  white-space: nowrap;
}

.selected-account small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
}

.platform-card {
  display: grid;
  gap: 8px;
}

.platform-line {
  display: grid;
  grid-template-columns: auto 30px minmax(0, 1fr) minmax(72px, auto);
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--chip-border);
  border-radius: 9px;
  background: var(--panel-bg-soft);
}

.platform-line.active {
  border-color: var(--success-border);
  background: var(--success-bg);
}

.platform-icon {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
}

.platform-line strong,
.platform-line small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-line strong {
  color: var(--text);
  font-size: 12px;
}

.platform-line small {
  color: var(--text-muted);
  font-size: 11px;
}

.profile-line {
  margin-top: 2px;
  opacity: .82;
}

.platform-tools,
.job-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.platform-line em {
  padding: 2px 6px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--chip-bg);
  font-style: normal;
  font-size: 10px;
  font-weight: 850;
}

.platform-line em.ready {
  color: var(--success-text);
  background: var(--success-bg);
}

.platform-line em.login {
  color: var(--warning-text);
  background: var(--warning-bg);
}

.mini-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent, var(--primary));
  cursor: pointer;
  font-size: 11px;
  font-weight: 800;
}

.mini-link:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
  opacity: .55;
}

.material-card {
  display: grid;
  gap: 8px;
}

.material-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}

.material-mini-list {
  display: grid;
  gap: 6px;
}

.material-mini {
  min-width: 0;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  padding: 7px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-dim);
}

.material-mini.active {
  border-color: var(--success-border);
  background: var(--success-bg);
}

.material-mini span {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--success-text);
  background: var(--card-bg);
  font-size: 12px;
  font-weight: 900;
}

.material-mini em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
  font-size: 12px;
}

.mini-empty {
  min-height: 48px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--border-mid);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.submit-card {
  display: grid;
  gap: 10px;
}

.submit-summary {
  display: grid;
  place-items: center;
  min-height: 92px;
  border: 1px solid var(--chip-border);
  border-radius: 10px;
  background: var(--panel-bg-soft);
}

.submit-summary strong,
.submit-summary span {
  display: block;
  text-align: center;
}

.submit-summary strong {
  color: var(--text);
  font-size: 34px;
  line-height: 1;
}

.submit-summary span {
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.publish-btn {
  width: 100%;
}

.submit-card p {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}

.progress-card {
  display: grid;
  gap: 8px;
}

.progress-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chip-bg);
  border: 1px solid var(--chip-border);
}

.progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent, var(--primary));
  transition: width .22s ease;
}

.progress-state {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.progress-state strong {
  color: var(--text);
}

.progress-state.ok strong {
  color: var(--success-text);
}

.progress-state.bad strong {
  color: var(--danger-text, #b91c1c);
}

.progress-events {
  display: grid;
  gap: 6px;
  max-height: 156px;
  overflow: auto;
  scrollbar-width: thin;
}

.progress-event {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 7px;
  padding: 7px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
  color: var(--text-dim);
  font-size: 11px;
}

.progress-event span {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.progress-event em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
}

.progress-event.success em {
  color: var(--success-text);
}

.progress-event.warning em {
  color: var(--warning-text, #a16207);
}

.progress-event.error em {
  color: var(--danger-text, #b91c1c);
}

.jobs-card {
  display: grid;
  gap: 8px;
}

.job-mini-list {
  display: grid;
  gap: 6px;
}

.job-mini {
  position: relative;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: var(--panel-bg-soft);
}

.job-mini strong,
.job-mini small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-mini strong {
  color: var(--text);
  font-size: 12px;
}

.job-mini small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.job-error {
  color: var(--danger-text, #b91c1c) !important;
  white-space: normal !important;
}

.job-status {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-top: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--chip-bg);
  font-size: 10px;
  font-weight: 850;
}

.job-status.ok {
  color: var(--success-text);
  background: var(--success-bg);
}

.job-status.active {
  color: var(--accent, var(--primary));
  background: var(--chip-bg);
}

.job-status.bad {
  color: var(--danger-text, #b91c1c);
  background: var(--danger-bg, #fee2e2);
}

.queue-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-soft, rgba(15, 23, 42, 0.04));
}

.queue-status-bar div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.queue-status-bar strong {
  font-size: 12px;
}

.queue-status-bar small {
  color: var(--text-muted);
  font-size: 11px;
}

.queue-status-bar.paused {
  border-color: rgba(185, 28, 28, 0.26);
  background: rgba(185, 28, 28, 0.06);
}

.btn-xs {
  min-height: 28px;
  padding: 4px 10px;
  font-size: 11px;
}

.btn-xs.danger {
  color: var(--danger-text, #b91c1c);
  border-color: rgba(185, 28, 28, 0.28);
  background: rgba(185, 28, 28, 0.06);
}

@media (max-width: 1180px) {
  .publish-layout.official {
    grid-template-columns: 1fr;
  }

  .publish-side {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: visible;
  }
}

@media (max-width: 900px) {
  .video-preview-shell,
  .topic-row,
  .cover-row,
  .commerce-panel-head,
  .commerce-action-row,
  .settings-grid,
  .publish-side {
    grid-template-columns: 1fr;
  }

  .commerce-panel-head,
  .commerce-action-row,
  .commerce-mode-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .upload-zone {
    min-height: 220px;
  }

  .publish-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
