const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const RUNTIME_ROOT = process.env.USAGI_RUNTIME_ROOT || (IS_SERVERLESS ? path.join(os.tmpdir(), 'usagi-workspace') : ROOT);
process.env.USAGI_RUNTIME_ROOT = RUNTIME_ROOT;
require('./env.cjs').loadEnv(ROOT);

const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';
// Load SF_KEY from openclaw config if not in environment
var SF_KEY = process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '';
try {
  var oc = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'));
  var providers = (oc.models || {}).providers || {};
  SF_KEY = SF_KEY || (providers.siliconflow || {}).apiKey || '';
  if (SF_KEY) {
    process.env.SILICONFLOW_API_KEY = SF_KEY;
    process.env.SF_KEY = SF_KEY;
  }
} catch(e) {}
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const AUTH_DISABLED = String(process.env.USAGI_AUTH_DISABLED || '').toLowerCase() === 'true';

// Rate limiter for auth routes (login/register)
const rateLimiter = (function() {
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 20; // max 20 requests per window
  const requests = new Map();

  // Clean up old entries periodically
  setInterval(function() {
    var now = Date.now();
    for (var [key, data] of requests) {
      if (now - data.start > windowMs) {
        requests.delete(key);
      }
    }
  }, 60000);

  return {
    check: function(ip) {
      var now = Date.now();
      var data = requests.get(ip);
      if (!data || now - data.start > windowMs) {
        requests.set(ip, { count: 1, start: now });
        return { allowed: true, remaining: maxRequests - 1 };
      }
      if (data.count >= maxRequests) {
        var retryAfter = Math.ceil((windowMs - (now - data.start)) / 1000);
        return { allowed: false, remaining: 0, retryAfter: retryAfter };
      }
      data.count++;
      return { allowed: true, remaining: maxRequests - data.count };
    }
  };
})();

const videoStore = require('./video_store.cjs');
const { parseBody, sendJSON, sendOptions, serveUpload } = require('./lib/http.cjs');
const Busboy = require('busboy');
const createLogger = require('./lib/logger.cjs');
const createPythonRuntime = require('./lib/python.cjs');
const createLlmRuntime = require('./lib/llm.cjs');
const createAuthStore = require('./lib/auth.cjs');
const createAuthRoutes = require('./routes/auth.cjs');
const createAdminRoutes = require('./routes/admin.cjs');
const createImagegenRoutes = require('./routes/imagegen.cjs');
const createIdeasRoutes = require('./routes/ideas.cjs');
const createProfitRoutes = require('./routes/profit.cjs');
const createScheduleRoutes = require('./routes/schedule.cjs');
const createToolsRoutes = require('./routes/tools.cjs');
const createVectorRoutes = require('./routes/vector.cjs');
const createDailyHotRoutes = require('./routes/dailyHot.cjs');
const createDownloadRoutes = require('./routes/download.cjs');
const createSmartCollectRoutes = require('./routes/smartCollect.cjs');
const createAiEditRoutes = require('./routes/aiEdit.cjs');
const createAccountMonitorRoutes = require('./routes/accountMonitor.cjs');
const createAccountStyleRoutes = require('./routes/accountStyles.cjs');
const createCopygenRoutes = require('./routes/copygen.cjs');
const createVideoPublishRoutes = require('./routes/videoPublish.cjs');
const createCommentReplyRoutes = require('./routes/commentReply.cjs');
const createAgentRoutes = require('./routes/agent.cjs');
const createTrafficPlanRoutes = require('./routes/trafficPlan.cjs');
const createTrafficPlanV2Routes = require('./routes/trafficPlanV2.cjs');
const createAccountDataRoutes = require('./routes/accountData.cjs');
const createProjectDeliveryRoutes = require('./routes/projectDelivery.cjs');
const createSystemHealthRoutes = require('./routes/systemHealth.cjs');
const createStyleWorkbenchRoutes = require('./routes/styleWorkbench.cjs');

const logger = createLogger('server');
var pythonRuntime = createPythonRuntime({ serverDir: __dirname });
var runPython = pythonRuntime.runPython;
var getPythonCandidates = pythonRuntime.getPythonCandidates;
var llmRuntime = createLlmRuntime({ root: ROOT, sfKey: SF_KEY });
var callMiniMaxChat = llmRuntime.callMiniMaxChat;
var handleChatRequest = llmRuntime.handleChatRequest;
var MINIMAX_API_KEY = llmRuntime.minimaxApiKey;
var authStore = createAuthStore({ root: RUNTIME_ROOT });

var authRoutes = createAuthRoutes({ authStore: authStore });
var adminRoutes = createAdminRoutes({ authStore: authStore });
var imagegenRoutes = createImagegenRoutes({
  runPython: runPython,
  getPythonCandidates: getPythonCandidates,
  minimaxApiKey: MINIMAX_API_KEY,
  serverDir: __dirname
});
var ideasRoutes = createIdeasRoutes({ root: RUNTIME_ROOT, runPython: runPython });
var profitRoutes = createProfitRoutes({ runPython: runPython });
var scheduleRoutes = createScheduleRoutes({ root: RUNTIME_ROOT });
var dailyHotRoutes = createDailyHotRoutes({
  root: RUNTIME_ROOT,
  serverDir: __dirname,
  runPython: runPython,
  getPythonCandidates: getPythonCandidates,
  callMiniMaxChat: callMiniMaxChat
});
var toolsRoutes = createToolsRoutes({
  root: RUNTIME_ROOT,
  runPython: runPython,
  getPythonCandidates: getPythonCandidates,
  callMiniMaxChat: callMiniMaxChat,
  callOpenAICompatible: llmRuntime.callOpenAICompatible,
  callWebSearchResearch: llmRuntime.callWebSearchResearch,
  handleChatRequest: handleChatRequest,
  minimaxApiKey: MINIMAX_API_KEY,
  siliconflowApiKey: SF_KEY,
  dashscopeApiKey: DASHSCOPE_API_KEY,
  serverDir: __dirname
});
var vectorRoutes = createVectorRoutes({
  runPython: runPython,
  callMiniMaxChat: callMiniMaxChat
});
var accountStyleRoutes = createAccountStyleRoutes({
  root: RUNTIME_ROOT,
  callModelText: llmRuntime.callModelText
});
var copygenRoutes = createCopygenRoutes({
  root: RUNTIME_ROOT,
  callModelText: llmRuntime.callModelText
});
var videoPublishRoutes = createVideoPublishRoutes({
  root: RUNTIME_ROOT
});
var commentReplyRoutes = createCommentReplyRoutes({
  root: RUNTIME_ROOT
});
var trafficPlanRoutes = createTrafficPlanRoutes({
  root: RUNTIME_ROOT,
  runPython: runPython
});
var trafficPlanV2Routes = createTrafficPlanV2Routes({
  root: RUNTIME_ROOT
});
var accountDataRoutes = createAccountDataRoutes({
  root: RUNTIME_ROOT,
  serverDir: __dirname
});
var projectDeliveryRoutes = createProjectDeliveryRoutes({
  root: RUNTIME_ROOT
});
var systemHealthRoutes = createSystemHealthRoutes({
  root: RUNTIME_ROOT,
  repoRoot: ROOT
});
var styleWorkbenchRoutes = createStyleWorkbenchRoutes({
  root: RUNTIME_ROOT,
  repoRoot: ROOT
});
if (profitRoutes && typeof profitRoutes._startWecomAutoPullScheduler === 'function') {
  profitRoutes._startWecomAutoPullScheduler(Number(process.env.PROFIT_WECOM_PULL_INTERVAL_MS) || 4 * 60 * 60 * 1000);
}
if (trafficPlanRoutes && typeof trafficPlanRoutes._startCrmAutoRefresh === 'function') {
  trafficPlanRoutes._startCrmAutoRefresh(Number(process.env.TRAFFIC_CRM_REFRESH_INTERVAL_MS) || 2 * 60 * 60 * 1000);
}
if (accountDataRoutes && typeof accountDataRoutes._startCollectScheduler === 'function') {
  accountDataRoutes._startCollectScheduler();
}
if (systemHealthRoutes && typeof systemHealthRoutes._startScheduler === 'function') {
  systemHealthRoutes._startScheduler();
}
var smartCollectRoutes = createSmartCollectRoutes({
  db: videoStore._db,
  root: RUNTIME_ROOT,
  uploadDir: videoStore._uploadDir,
  thumbDir: videoStore._thumbDir,
  callModelText: llmRuntime.callModelText
});
var aiEditRoutes = createAiEditRoutes({
  db: videoStore._db,
  root: RUNTIME_ROOT,
  uploadDir: videoStore._uploadDir,
  thumbDir: videoStore._thumbDir,
  callModelText: llmRuntime.callModelText,
  siliconflowApiKey: SF_KEY
});
var accountMonitorRoutes = createAccountMonitorRoutes({
  root: RUNTIME_ROOT
});
var materialRoutes = {
  '/api/materials/upload': videoStore['/api/materials/upload'],
  '/api/materials/list': videoStore['/api/materials/list'],
  '/api/materials/delete': videoStore['/api/materials/delete'],
  '/api/materials/download': videoStore['/api/materials/download'],
  '/api/materials/ai-tag': videoStore['/api/materials/ai-tag'],
  '/api/materials/stats': videoStore['/api/materials/stats'],
  '/api/materials/storage': videoStore['/api/materials/storage'],
  '/api/materials/scan-unindexed': videoStore['/api/materials/scan-unindexed'],
  '/api/materials/import-unindexed': videoStore['/api/materials/import-unindexed'],
  '/api/materials/update': videoStore['/api/materials/update'],
  '/api/materials/restore': videoStore['/api/materials/restore'],
  '/api/materials/folders': videoStore['/api/materials/folders'],
  '/api/materials/folders/create': videoStore['/api/materials/folders/create'],
  '/api/materials/folders/delete': videoStore['/api/materials/folders/delete'],
  '/api/materials/folders/rename': videoStore['/api/materials/folders/rename'],
  '/api/materials/folders/move': videoStore['/api/materials/folders/move']
};
var downloadRoutes = createDownloadRoutes();

var routes = {};
Object.assign(routes, authRoutes, adminRoutes, toolsRoutes, vectorRoutes, imagegenRoutes, ideasRoutes, profitRoutes, scheduleRoutes, dailyHotRoutes, materialRoutes, downloadRoutes, smartCollectRoutes, aiEditRoutes, accountMonitorRoutes, accountStyleRoutes, copygenRoutes, videoPublishRoutes, commentReplyRoutes, trafficPlanRoutes, trafficPlanV2Routes, projectDeliveryRoutes, systemHealthRoutes, styleWorkbenchRoutes);
Object.assign(routes, accountDataRoutes);
var agentRoutes = createAgentRoutes({
  root: RUNTIME_ROOT,
  routes: routes,
  authStore: authStore,
  callOpenAICompatible: llmRuntime.callOpenAICompatible,
  callModelText: llmRuntime.callModelText,
  siliconflowApiKey: SF_KEY
});
Object.assign(routes, agentRoutes);

var authDisabledUser = {
  id: 0,
  username: 'dev-user',
  display_name: '免登录测试',
  role: 'admin',
  permissions: authStore.ALL_MODULES || [],
  active: true
};

function extractToken(req, body) {
  return body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

function isPublicRoute(routePath) {
  return routePath === '/api/auth/login' ||
    routePath === '/api/auth/erp-login' ||
    routePath === '/api/auth/register' ||
    routePath === '/api/workflow/styles' ||
    routePath === '/api/imagegen/history';
}

function moduleForRoute(routePath) {
  // Native style-workbench routes share the main API server. Keep these
  // mappings ahead of the legacy tools routes so authenticated requests are
  // authorized against the corresponding workbench module instead of falling
  // through to the default-deny branch.
  if (routePath === '/api/health/style-workbench') return 'auth';
  if (
    routePath.indexOf('/api/library') === 0 ||
    routePath.indexOf('/api/accounts') === 0 ||
    routePath.indexOf('/api/videos') === 0 ||
    routePath.indexOf('/api/collect') === 0 ||
    routePath.indexOf('/api/transcribe') === 0 ||
    routePath.indexOf('/api/batch-transcribe') === 0 ||
    routePath.indexOf('/api/transcripts') === 0 ||
    routePath.indexOf('/api/style') === 0 ||
    routePath.indexOf('/api/jobs') === 0 ||
    routePath.indexOf('/api/tools/single-video') === 0
  ) return 'styleLibrary';
  if (
    routePath.indexOf('/api/projects') === 0 ||
    routePath.indexOf('/api/copy-sources') === 0
  ) return 'styleProjectWorkbench';
  if (
    routePath.indexOf('/api/write') === 0 ||
    routePath.indexOf('/api/drafts') === 0 ||
    routePath.indexOf('/api/draft-assets') === 0 ||
    routePath === '/api/engagement' ||
    routePath === '/api/feishu/document' ||
    routePath === '/api/tools/publish-copy'
  ) return 'styleWriter';
  if (routePath.indexOf('/api/gross-margin') === 0) return 'styleGrossMargin';
  if (routePath.indexOf('/api/douyin-hotlist') === 0) return 'styleDouyinHotlist';
  if (routePath.indexOf('/api/admin/users') === 0) return 'adminUsers';
  if (routePath.indexOf('/api/admin/logs') === 0) return 'operationLogs';
  if (routePath.indexOf('/api/agent') === 0) return 'projectAgent';
  if (routePath.indexOf('/api/auth/') === 0) return 'auth';
  if (routePath.indexOf('/api/profit') === 0 || routePath.indexOf('/api/profits') === 0 || routePath === '/api/feishu/profit') return 'ops';
  if (routePath.indexOf('/api/schedule') === 0) return 'schedule';
  if (routePath.indexOf('/api/materials') === 0) return 'material';
  if (routePath.indexOf('/api/smart-collect') === 0) return 'smartcollect';
  if (routePath.indexOf('/api/ai-edit') === 0) return 'smartcollect';
  if (routePath.indexOf('/api/ideas') === 0) return 'ideaboard';
  if (routePath.indexOf('/api/daily-hot') === 0) return 'dailyhot';
  if (routePath.indexOf('/api/account-monitor') === 0) return 'accountmonitor';
  if (routePath.indexOf('/api/account-data') === 0) return 'accountDataDashboard';
  if (routePath.indexOf('/api/project-delivery') === 0) return 'projectDelivery';
  if (routePath.indexOf('/api/download') === 0) return 'download';
  if (routePath.indexOf('/api/imagegen') === 0 || routePath.indexOf('/api/minimax/image') === 0 || routePath.indexOf('/api/gpt-image2') === 0 || routePath.indexOf('/api/dreamina') === 0) return 'imagegen';
  if (routePath.indexOf('/api/vector') === 0 || routePath.indexOf('/api/bf') === 0 || routePath.indexOf('/api/cases') === 0) return 'tools';
  if (routePath.indexOf('/api/posttools') === 0) return 'posttools';
  if (routePath.indexOf('/api/workflow') === 0) return 'workflow';
  if (routePath.indexOf('/api/account-styles') === 0) return 'copygen';
  if (routePath.indexOf('/api/copygen') === 0) return 'copygen';
  if (routePath.indexOf('/api/video-publish') === 0) return 'videopublish';
  if (routePath.indexOf('/api/comment-reply') === 0) return 'commentReply';
  if (routePath.indexOf('/api/traffic-plan') === 0) return 'trafficPlan';
  if (routePath.indexOf('/api/system-health') === 0) return 'systemHealth';
  if (routePath.indexOf('/api/system/health') === 0) return 'auth';
  if (
    routePath.indexOf('/api/transcribe') === 0 ||
    routePath.indexOf('/api/comment') === 0 ||
    routePath.indexOf('/api/to-feishu') === 0 ||
    routePath.indexOf('/api/hot') === 0 ||
    routePath.indexOf('/api/search-intent') === 0 ||
    routePath.indexOf('/api/platform') === 0 ||
    routePath.indexOf('/api/ai-fix') === 0 ||
    routePath.indexOf('/api/ai_extract') === 0 ||
    routePath.indexOf('/api/chat-minimax') === 0 ||
    routePath.indexOf('/api/douyin') === 0 ||
    routePath.indexOf('/api/feishu/read') === 0 ||
    routePath.indexOf('/api/audit') === 0 ||
    routePath.indexOf('/api/status') === 0 ||
    routePath.indexOf('/api/upload') === 0
  ) return 'tools';
  return '';
}

function auditBody(body) {
  var out = {};
  Object.keys(body || {}).forEach(function(key) {
    if (key.charAt(0) === '_') return;
    out[key] = body[key];
  });
  return out;
}

function auditBriefBody(body) {
  var out = {};
  Object.keys(body || {}).forEach(function(key) {
    if (key.charAt(0) === '_') return;
    var value = body[key];
    if (/image|base64|file|data|blob|buffer/i.test(key)) {
      if (Array.isArray(value)) out[key + '_count'] = value.length;
      else if (value) out[key + '_present'] = true;
      return;
    }
    if (typeof value === 'string') {
      out[key] = value.length > 220 ? value.slice(0, 220) + '...' : value;
      return;
    }
    out[key] = value;
  });
  return out;
}

function shortText(value, fallback, limit) {
  var text = String(value || fallback || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, limit || 80);
}

function auditSummaryFor(routePath, body, data) {
  var method = body._method || 'POST';
  if (data && (data.error || data.ok === false)) return 'request failed: ' + routePath;
  if (method === 'GET') return 'view: ' + routePath;
  if (method === 'DELETE') return 'delete: ' + routePath;
  if (method === 'PATCH' || method === 'PUT') return 'update: ' + routePath;
  return 'operate: ' + routePath;
}

function shouldAuditRoute(routePath) {
  if (routePath.indexOf('/api/') !== 0) return false;
  if (routePath === '/api/health') return false;
  if (routePath === '/api/system/health') return false;
  if (routePath === '/api/system-health/latest') return false;
  if (routePath === '/api/admin/logs') return false;
  if (routePath === '/api/auth/me') return false;
  if (routePath === '/api/workflow/styles') return false;
  if (routePath === '/api/ideas/click') return false;
  if (routePath === '/api/schedule/revision') return false;
  if (routePath === '/api/schedule/load') return false;
  if (routePath === '/api/schedule/save') return false;
  if (routePath === '/api/schedule/todos/load') return false;
  if (routePath === '/api/schedule/todos/history') return false;
  if (routePath === '/api/schedule/todos/save') return false;
  if (routePath === '/api/schedule/todos/status') return false;
  if (routePath === '/api/schedule/todos/delete') return false;
  if (routePath === '/api/schedule/notify-handoff') return false;
  if (routePath === '/api/schedule/notifications/unread') return false;
  if (routePath === '/api/schedule/notifications/read') return false;
  if (routePath === '/api/account-data/collect/status') return false;
  if (routePath === '/api/ideas/list') return false;
  return true;
}

function genericAuditInfo(routePath, body, data, startedAt) {
  var method = body._method || 'POST';
  var failed = Boolean(data && (data.error || data.ok === false));
  return {
    module: moduleForRoute(routePath) || 'api',
    action: (failed ? 'api.failed.' : 'api.') + String(method).toLowerCase(),
    target_type: 'api',
    target_id: routePath,
    summary: auditSummaryFor(routePath, body, data),
    metadata: {
      path: routePath,
      method: method,
      status: failed ? 'failed' : 'success',
      duration_ms: Math.max(0, Date.now() - startedAt),
      error: failed ? String(data.error || data.message || 'request failed').slice(0, 300) : '',
      request: auditBody(body)
    }
  };
}

function auditInfo(routePath, body, data) {
  var failed = Boolean(data && (data.error || data.ok === false));
  var brief = auditBriefBody(body);
  var errorText = failed ? String(data.error || data.message || '执行失败').slice(0, 180) : '';
  function statusSuffix() { return failed ? '失败：' + errorText : '成功'; }
  function imagegenInfo(action, label, type, model) {
    var prompt = shortText(body.prompt || body.text || body.positive_prompt, '未填写提示词', 80);
    return {
      module: 'imagegen',
      action: failed ? action + '.failed' : action,
      target_type: 'imagegen',
      target_id: data && (data.historyId || data.id || data.taskId || data.url) || '',
      summary: label + '：' + prompt + '（' + statusSuffix() + '）',
      metadata: Object.assign({}, brief, {
        type: type,
        model: body.model || model || '',
        ratio: body.ratio || body.aspect_ratio || '',
        size: body.size || body.resolution || '',
        result_url: data && (data.url || data.image_url || data.result_url) || '',
        error: errorText
      })
    };
  }
  function posttoolsInfo(action, label, target) {
    return {
      module: 'posttools',
      action: failed ? action + '.failed' : action,
      target_type: 'posttools',
      target_id: target || body.url || body.source || data && (data.id || data.job_id) || '',
      summary: label + '：' + shortText(target || body.url || body.source || body.text || body.filename, '未命名任务', 80) + '（' + statusSuffix() + '）',
      metadata: Object.assign({}, brief, { error: errorText })
    };
  }
  function videoPublishInfo(action, label, target) {
    var account = body.accountName || body.account_name || body.accountId || body.account_id || body.account || '';
    var platform = body.platform || body.platformId || '';
    var subject = [account, platform, target || body.id || body.jobId || body.title || body.video_name].filter(Boolean).join(' / ');
    return {
      module: 'videopublish',
      action: failed ? action + '.failed' : action,
      target_type: 'video_publish',
      target_id: body.id || body.jobId || data && (data.id || data.jobId) || '',
      summary: label + '：' + shortText(subject, '未命名发布任务', 100) + '（' + statusSuffix() + '）',
      metadata: Object.assign({}, brief, { error: errorText })
    };
  }
  function commentReplyInfo(action, label) {
    var account = body.accountName || body.account_name || body.accountId || body.account_id || body.account || '';
    return {
      module: 'commentReply',
      action: failed ? action + '.failed' : action,
      target_type: 'comment_reply',
      target_id: body.id || body.accountId || data && (data.id || data.jobId) || '',
      summary: label + '：' + shortText(account || body.videoUrl || body.comment || body.content, '评论回复任务', 80) + '（' + statusSuffix() + '）',
      metadata: Object.assign({}, brief, { error: errorText })
    };
  }

  if (!data) return null;
  if (routePath === '/api/gpt-image2/text2image') return imagegenInfo('imagegen.text2image', 'GPT-Image2 文生图', 'text2image', 'gpt-image2');
  if (routePath === '/api/gpt-image2/image2image') return imagegenInfo('imagegen.image2image', 'GPT-Image2 图生图', 'image2image', 'gpt-image2');
  if (routePath === '/api/dreamina/text2image') return imagegenInfo('imagegen.text2image', '即梦文生图', 'text2image', 'dreamina');
  if (routePath === '/api/dreamina/image2image') return imagegenInfo('imagegen.image2image', '即梦图生图', 'image2image', 'dreamina');
  if (routePath === '/api/minimax/image') return imagegenInfo('imagegen.text2image', 'MiniMax 生图', 'text2image', 'minimax');
  if (routePath === '/api/gpt-image2/tasks' && body.action !== 'list') return imagegenInfo('imagegen.task.create', '创建生图队列', body.type || 'task', 'gpt-image2');
  if (/^\/api\/imagegen\/history\/\d+$/.test(routePath) && body._method === 'DELETE') return { module: 'imagegen', action: failed ? 'imagegen.history.delete.failed' : 'imagegen.history.delete', target_type: 'imagegen_history', target_id: body.id || '', summary: '删除生图历史：' + (body.id || '') + '（' + statusSuffix() + '）', metadata: brief };

  if (routePath === '/api/posttools/video-download') return posttoolsInfo('posttools.video_download', '视频下载', body.url);
  if (routePath === '/api/posttools/video-download-batch-start') return posttoolsInfo('posttools.video_download_batch', '批量视频下载', Array.isArray(body.urls) ? body.urls.length + ' 条链接' : body.url);
  if (routePath === '/api/posttools/media-convert') return posttoolsInfo('posttools.media_convert', '媒体转换', body.source || body.action);
  if (routePath === '/api/posttools/ncm-convert') return posttoolsInfo('posttools.ncm_convert', 'NCM 转换', body._originalName || body.name);
  if (routePath === '/api/posttools/video-analyze') return posttoolsInfo('posttools.video_analyze', '视频转写/分析', body.url || body.provider);
  if (routePath === '/api/posttools/ai-recommend') return posttoolsInfo('posttools.ai_recommend', 'AI 推荐文案', body.text);

  if (routePath === '/api/video-publish/jobs/create') return videoPublishInfo('videopublish.job.create', '创建发布任务', body.title || body.video_name);
  if (routePath === '/api/video-publish/jobs/update-status') return videoPublishInfo('videopublish.job.status', '修改发布任务状态', body.status);
  if (routePath === '/api/video-publish/jobs/cancel') return videoPublishInfo('videopublish.job.cancel', '取消发布任务', body.id);
  if (routePath === '/api/video-publish/jobs/run') return videoPublishInfo('videopublish.job.run', '执行发布任务', body.id);
  if (routePath === '/api/video-publish/jobs/run-batch') return videoPublishInfo('videopublish.job.run_batch', '启动发布队列', Array.isArray(body.ids) ? body.ids.length + ' 条任务' : body.id);
  if (routePath === '/api/video-publish/jobs/delete') return videoPublishInfo('videopublish.job.delete', '删除发布任务', body.id);
  if (routePath === '/api/video-publish/accounts/save') return videoPublishInfo('videopublish.account.save', '保存发布账号', body.name || body.accountName || body.id);
  if (routePath === '/api/video-publish/accounts/open-login' || routePath === '/api/video-publish/accounts/launch-profile') return videoPublishInfo('videopublish.account.login', '打开发布账号登录态', body.profileAlias || body.accountId || body.id);
  if (routePath === '/api/video-publish/videos/transcribe') return videoPublishInfo('videopublish.video.transcribe', '发布视频转写', body.videoName || body.video_url || body.path);

  if (routePath === '/api/comment-reply/collect') return commentReplyInfo('comment_reply.collect', '采集评论');
  if (routePath === '/api/comment-reply/plan') return commentReplyInfo('comment_reply.plan', '生成评论回复方案');
  if (routePath === '/api/comment-reply/send') return commentReplyInfo('comment_reply.send', '发送评论回复');

  if (failed) return null;
  if (routePath === '/api/profits' && body._method === 'POST') return { module: 'ops', action: 'profit.create', target_type: 'profit', target_id: data.id, summary: 'create profit record', metadata: auditBody(body) };
  if (/^\/api\/profits\/\d+$/.test(routePath) && (body._method === 'PATCH' || body._method === 'PUT')) return { module: 'ops', action: 'profit.update', target_type: 'profit', target_id: body.id, summary: 'update profit record', metadata: auditBody(body) };
  if (/^\/api\/profits\/\d+$/.test(routePath) && body._method === 'DELETE') return { module: 'ops', action: 'profit.delete', target_type: 'profit', target_id: body.id, summary: 'delete profit record', metadata: auditBody(body) };
  if (routePath === '/api/profit/add') return { module: 'ops', action: 'profit.create', target_type: 'profit', target_id: data.id, summary: 'create profit record', metadata: auditBody(body) };
  if (routePath === '/api/profit/update') return { module: 'ops', action: 'profit.update', target_type: 'profit', target_id: body.id, summary: 'update profit record', metadata: auditBody(body) };
  if (routePath === '/api/profit/delete') return { module: 'ops', action: 'profit.delete', target_type: 'profit', target_id: body.id, summary: 'delete profit record', metadata: auditBody(body) };
  if (routePath === '/api/materials/upload') return { module: 'material', action: 'material.upload', target_type: 'material', target_id: data.id, summary: 'upload material: ' + (body.original || body.filename || ''), metadata: auditBody(body) };
  if (routePath === '/api/materials/update') return { module: 'material', action: 'material.update', target_type: 'material', target_id: body.id, summary: 'update material', metadata: auditBody(body) };
  if (routePath === '/api/materials/delete') return { module: 'material', action: 'material.delete', target_type: 'material', target_id: body.id, summary: 'delete material', metadata: auditBody(body) };
  if (routePath === '/api/ideas/add') return { module: 'ideaboard', action: 'idea.create', target_type: 'idea', target_id: data.id, summary: 'create idea', metadata: auditBody(body) };
  if (routePath === '/api/ideas/update') return { module: 'ideaboard', action: 'idea.update', target_type: 'idea', target_id: body.id, summary: 'update idea', metadata: auditBody(body) };
  if (routePath === '/api/ideas/delete') return { module: 'ideaboard', action: 'idea.delete', target_type: 'idea', target_id: body.id, summary: 'delete idea', metadata: auditBody(body) };
  if (routePath === '/api/daily-hot/refresh') return { module: 'dailyhot', action: 'dailyhot.refresh', target_type: 'daily_hot', target_id: body.date || data.date || '', summary: 'refresh daily hot', metadata: { date: body.date || data.date, sources: body.sources, count: Array.isArray(data.items) ? data.items.length : 0 } };
  if (routePath === '/api/daily-hot/analyze') return { module: 'dailyhot', action: 'dailyhot.analyze', target_type: 'daily_hot', target_id: body.date || data.date || '', summary: 'analyze daily hot', metadata: { date: body.date || data.date } };
  if (routePath === '/api/daily-hot/update-status') return { module: 'dailyhot', action: 'dailyhot.update_status', target_type: 'daily_hot', target_id: body.id, summary: 'update hot status: ' + body.status, metadata: auditBody(body) };
  if (routePath === '/api/daily-hot/manual-add') return { module: 'dailyhot', action: 'dailyhot.manual_add', target_type: 'daily_hot', target_id: body.title || '', summary: 'manual add hot: ' + (body.title || ''), metadata: auditBody(body) };
  if (routePath === '/api/system-health/run') return { module: 'systemHealth', action: 'system_health.run', target_type: 'system_health', summary: 'run system health check', metadata: { status: data.report && data.report.status, summary: data.report && data.report.summary } };
  return null;
}
function routeRequest(req, res) {
  var parsedUrl;
  try { parsedUrl = new URL(req.url, 'http://localhost'); }
  catch(e) { parsedUrl = { pathname: req.url || '/', searchParams: new URLSearchParams() }; }
  var routePath = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    sendOptions(res);
    return;
  }

  if (routePath === '/' || routePath === '/api/health') {
    sendJSON(res, 200, {
      ok: true,
      name: 'Usagi Workspace API',
      port: PORT,
      authDisabled: AUTH_DISABLED,
      time: new Date().toISOString()
    });
    return;
  }

  var remoteMaterialMatch = routePath.match(/^\/api\/materials\/remote-(preview|download)\/(\d+)$/);
  if (remoteMaterialMatch && videoStore._streamRemoteMaterial) {
    videoStore._streamRemoteMaterial({
      mode: remoteMaterialMatch[1],
      id: remoteMaterialMatch[2],
      req: req,
      res: res
    });
    return;
  }

  if (serveUpload(RUNTIME_ROOT, routePath, res)) return;

  if (routePath === '/api/agent/chat/stream') {
    parseBody(req, parsedUrl, async function(body) {
      var token = extractToken(req, body);
      var authUser = null;
      if (AUTH_DISABLED) {
        authUser = authDisabledUser;
      } else {
        try { authUser = await authStore.authenticate(token); }
        catch(e) { sendJSON(res, 500, { error: e.message }); return; }
        if (!authUser) { sendJSON(res, 401, { error: 'Unauthorized' }); return; }
        if (!authStore.canAccess(authUser, 'projectAgent')) { sendJSON(res, 403, { error: 'Forbidden' }); return; }
      }
      body._auth = authUser;
      body._token = token;
      body._req = req;
      var route = routes[routePath];
      if (!route) { sendJSON(res, 404, { error: 'unknown endpoint' }); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      try {
        route(body, res);
      } catch (e) {
        try {
          res.write('event: error\n');
          res.write('data: ' + JSON.stringify({ error: e.message || String(e) }) + '\n\n');
        } catch (err) {}
        res.end();
      }
    });
    return;
  }

  // Serve raw BF markdown files: /raw_bf/filename.md
  var rawBfMatch = routePath.match(/^\/raw_bf\/(.+)/);
  if (rawBfMatch) {
    var rawBfDir = 'C:\\Users\\Administrator\\.openclaw\\workspace\\bf_raw_docs';
    var filename = rawBfMatch[1];
    try { filename = decodeURIComponent(filename); } catch (e) {}
    var rawBfFile = path.join(rawBfDir, filename);
    var safeDir = rawBfDir + path.sep;
    if (!rawBfFile.startsWith(safeDir) && rawBfFile !== rawBfDir) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    require('fs').readFile(rawBfFile, 'utf-8', function(err, data) {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (routePath === '/api/transcribe/audio' && req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    var audioBusboy = Busboy({ headers: req.headers, limits: { fileSize: 1024 * 1024 * 1024 } });
    var audioUploadData = {};
    var audioUploadFilePath = null;
    var audioUploadErrored = false;
    var audioFileWritePromise = null;
    var audioResponseSent = false;

    function sendAudioJSON(statusCode, data) {
      if (audioResponseSent) return;
      audioResponseSent = true;
      sendJSON(res, statusCode, data);
    }

    function cleanupAudioTemp() {
      if (audioUploadFilePath) {
        try { fs.unlinkSync(audioUploadFilePath); } catch(e) {}
      }
    }

    audioBusboy.on('file', function(fieldname, file, info) {
      var filename = info.filename || 'audio';
      var uploadDir = path.join(RUNTIME_ROOT, 'temp', 'transcribe-audio');
      try { fs.mkdirSync(uploadDir, { recursive: true }); } catch(e) {}
      audioUploadFilePath = path.join(uploadDir, Date.now() + '_' + filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'));
      audioUploadData._originalName = filename;
      var writeStream = fs.createWriteStream(audioUploadFilePath);
      file.pipe(writeStream);
      audioFileWritePromise = new Promise(function(resolve, reject) {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        file.on('error', reject);
      });
      file.on('limit', function() {
        audioUploadErrored = true;
        try { writeStream.destroy(); } catch(e) {}
      });
    });

    audioBusboy.on('field', function(fieldname, value) {
      audioUploadData[fieldname] = value;
    });

    audioBusboy.on('error', function(err) {
      if (audioUploadErrored) return;
      audioUploadErrored = true;
      cleanupAudioTemp();
      sendAudioJSON(400, { error: err.message });
    });

    audioBusboy.on('finish', async function() {
      if (audioUploadErrored) {
        cleanupAudioTemp();
        sendAudioJSON(400, { error: 'file too large or upload interrupted' });
        return;
      }
      if (audioFileWritePromise) {
        try { await audioFileWritePromise; }
        catch(e) {
          cleanupAudioTemp();
          sendAudioJSON(400, { error: 'failed to save uploaded file: ' + e.message });
          return;
        }
      }
      if (!audioUploadFilePath || !fs.existsSync(audioUploadFilePath)) {
        sendAudioJSON(400, { error: 'missing uploaded file' });
        return;
      }
      var token = extractToken(req, audioUploadData);
      var authUser = null;
      if (AUTH_DISABLED) {
        authUser = authDisabledUser;
      } else {
        try { authUser = await authStore.authenticate(token); }
        catch(e) { cleanupAudioTemp(); sendAudioJSON(500, { error: e.message }); return; }
        if (!authUser) { cleanupAudioTemp(); sendAudioJSON(401, { error: 'Unauthorized' }); return; }
        if (!authStore.canAccess(authUser, 'tools')) { cleanupAudioTemp(); sendAudioJSON(403, { error: 'Forbidden' }); return; }
      }
      audioUploadData._auth = authUser;
      audioUploadData._token = token;
      audioUploadData._tempPath = audioUploadFilePath;
      var route = routes['/api/transcribe/audio'];
      if (!route) { cleanupAudioTemp(); sendAudioJSON(404, { error: 'unknown endpoint' }); return; }
      try {
        route(audioUploadData, function(data) {
          sendAudioJSON(data && data.error ? 400 : 200, data);
        });
      } catch(e) {
        cleanupAudioTemp();
        sendAudioJSON(500, { error: e.message });
      }
    });

    req.pipe(audioBusboy);
    return;
  }

  // Handle multipart form data for ncm-convert
  if (routePath === '/api/posttools/ncm-convert' && req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    var busboy = Busboy({ headers: req.headers, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit
    var uploadData = {};
    var uploadFilePath = null;

    busboy.on('file', function(fieldname, file, info) {
      var filename = info.filename || 'file';
      var uploadDir = path.join(RUNTIME_ROOT, 'temp');
      try { require('fs').mkdirSync(uploadDir, { recursive: true }); } catch(e) {}
      uploadFilePath = path.join(uploadDir, Date.now() + '_' + filename);
      uploadData._originalName = filename;
      var writeStream = require('fs').createWriteStream(uploadFilePath);
      file.pipe(writeStream);
      file.on('end', function() {
        writeStream.end();
      });
    });

    busboy.on('field', function(fieldname, value) {
      uploadData[fieldname] = value;
    });

    busboy.on('finish', function() {
      uploadData._tempPath = uploadFilePath;
      // Call route handler directly with parsed body
      var route = routes[routePath];
      if (!route) {
        sendJSON(res, 404, { error: 'unknown endpoint' });
        return;
      }
      var replied = false;
      function reply(data) {
        if (replied) return;
        replied = true;
        sendJSON(res, 200, data);
      }
      try {
        route(uploadData, reply);
      } catch(e) {
        reply({ error: e.message });
      }
    });

    req.pipe(busboy);
    return;
  }

  if (routePath === '/api/video-publish/videos/upload-file' && req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    var videoBusboy = Busboy({ headers: req.headers, limits: { fileSize: 8 * 1024 * 1024 * 1024 } });
    var videoUploadData = {};
    var videoUploadFilePath = null;
    var videoUploadErrored = false;
    var videoFileWritePromise = null;
    var videoResponseSent = false;

    function sendVideoJSON(statusCode, data) {
      if (videoResponseSent) return;
      videoResponseSent = true;
      sendJSON(res, statusCode, data);
    }

    function cleanupVideoTemp() {
      if (videoUploadFilePath) {
        try { fs.unlinkSync(videoUploadFilePath); } catch(e) {}
      }
    }

    videoBusboy.on('file', function(fieldname, file, info) {
      var filename = info.filename || 'video';
      var uploadDir = path.join(RUNTIME_ROOT, 'temp', 'video-publish');
      try { fs.mkdirSync(uploadDir, { recursive: true }); } catch(e) {}
      videoUploadFilePath = path.join(uploadDir, Date.now() + '_' + filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'));
      videoUploadData._originalName = filename;
      var writeStream = fs.createWriteStream(videoUploadFilePath);
      file.pipe(writeStream);
      videoFileWritePromise = new Promise(function(resolve, reject) {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        file.on('error', reject);
      });
      file.on('limit', function() {
        videoUploadErrored = true;
        try { writeStream.destroy(); } catch(e) {}
      });
    });

    videoBusboy.on('field', function(fieldname, value) {
      videoUploadData[fieldname] = value;
    });

    videoBusboy.on('error', function(err) {
      if (videoUploadErrored) return;
      videoUploadErrored = true;
      cleanupVideoTemp();
      sendVideoJSON(400, { error: err.message });
    });

    videoBusboy.on('finish', async function() {
      if (videoUploadErrored) {
        cleanupVideoTemp();
        sendVideoJSON(400, { error: 'file too large or upload interrupted' });
        return;
      }
      if (videoFileWritePromise) {
        try { await videoFileWritePromise; }
        catch(e) {
          cleanupVideoTemp();
          sendVideoJSON(400, { error: 'failed to save uploaded file: ' + e.message });
          return;
        }
      }
      if (!videoUploadFilePath || !fs.existsSync(videoUploadFilePath)) {
        sendVideoJSON(400, { error: 'missing uploaded file' });
        return;
      }
      var token = extractToken(req, videoUploadData);
      var authUser = null;
      if (AUTH_DISABLED) {
        authUser = authDisabledUser;
      } else {
        try { authUser = await authStore.authenticate(token); }
        catch(e) { cleanupVideoTemp(); sendVideoJSON(500, { error: e.message }); return; }
        if (!authUser) { cleanupVideoTemp(); sendVideoJSON(401, { error: 'Unauthorized' }); return; }
        if (!authStore.canAccess(authUser, 'videopublish')) { cleanupVideoTemp(); sendVideoJSON(403, { error: 'Forbidden' }); return; }
      }
      videoUploadData._auth = authUser;
      videoUploadData._token = token;
      videoUploadData._tempPath = videoUploadFilePath;
      var route = routes['/api/video-publish/videos/upload'];
      if (!route) { cleanupVideoTemp(); sendVideoJSON(404, { error: 'unknown endpoint' }); return; }
      try {
        route(videoUploadData, function(data) {
          if (authUser) {
            var failed = Boolean(data && (data.error || data.ok === false));
            authStore.logOperation({
              auth: authUser,
              req: req,
              module: 'videopublish',
              action: failed ? 'videopublish.video.upload.failed' : 'videopublish.video.upload',
              target_type: 'video_publish',
              target_id: data && (data.id || data.video_id || data.url) || '',
              summary: '上传发布视频：' + shortText(videoUploadData._originalName || videoUploadData.name || '未命名视频', '', 100) + '（' + (failed ? '失败：' + String(data.error || data.message || '上传失败').slice(0, 160) : '成功') + '）',
              metadata: {
                filename: videoUploadData._originalName || videoUploadData.name || '',
                size: videoUploadData.size || '',
                accountId: videoUploadData.accountId || videoUploadData.account_id || '',
                platform: videoUploadData.platform || '',
                error: failed ? String(data.error || data.message || '').slice(0, 200) : ''
              }
            }).catch(function(e) {
              logger.warn('audit log failed', e);
            });
          }
          sendVideoJSON(data && data.error ? 400 : 200, data);
        });
      } catch(e) {
        cleanupVideoTemp();
        sendVideoJSON(500, { error: e.message });
      }
    });

    req.pipe(videoBusboy);
    return;
  }

  if (routePath === '/api/materials/upload' && req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    var materialBusboy = Busboy({ headers: req.headers, limits: { fileSize: 8 * 1024 * 1024 * 1024 } });
    var materialUploadData = {};
    var materialUploadFilePath = null;
    var materialUploadErrored = false;
    var materialFileWritePromise = null;
    var materialResponseSent = false;

    function sendMaterialJSON(statusCode, data) {
      if (materialResponseSent) return;
      materialResponseSent = true;
      sendJSON(res, statusCode, data);
    }

    materialBusboy.on('file', function(fieldname, file, info) {
      var filename = info.filename || 'material';
      var uploadDir = path.join(RUNTIME_ROOT, 'temp', 'materials');
      try { fs.mkdirSync(uploadDir, { recursive: true }); } catch(e) {}
      materialUploadFilePath = path.join(uploadDir, Date.now() + '_' + filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'));
      materialUploadData._originalName = filename;
      var writeStream = fs.createWriteStream(materialUploadFilePath);
      file.pipe(writeStream);
      materialFileWritePromise = new Promise(function(resolve, reject) {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        file.on('error', reject);
      });
      file.on('limit', function() {
        materialUploadErrored = true;
        try { writeStream.destroy(); } catch(e) {}
      });
    });

    materialBusboy.on('field', function(fieldname, value) {
      materialUploadData[fieldname] = value;
    });

    materialBusboy.on('error', function(err) {
      if (materialUploadErrored) return;
      materialUploadErrored = true;
      sendMaterialJSON(400, { error: err.message });
    });

    materialBusboy.on('finish', async function() {
      function cleanupTemp() {
        if (materialUploadFilePath) {
          try { fs.unlinkSync(materialUploadFilePath); } catch(e) {}
        }
      }
      if (materialUploadErrored) {
        cleanupTemp();
        sendMaterialJSON(400, { error: 'file too large or upload interrupted' });
        return;
      }
      if (materialFileWritePromise) {
        try { await materialFileWritePromise; }
        catch(e) {
          cleanupTemp();
          sendMaterialJSON(400, { error: 'failed to save uploaded file: ' + e.message });
          return;
        }
      }
      if (!materialUploadFilePath || !fs.existsSync(materialUploadFilePath)) {
        sendMaterialJSON(400, { error: 'missing uploaded file' });
        return;
      }
      var token = extractToken(req, materialUploadData);
      var authUser = null;
      if (AUTH_DISABLED) {
        authUser = authDisabledUser;
      } else {
        try { authUser = await authStore.authenticate(token); }
        catch(e) { cleanupTemp(); sendMaterialJSON(500, { error: e.message }); return; }
        if (!authUser) { cleanupTemp(); sendMaterialJSON(401, { error: 'Unauthorized' }); return; }
        if (!authStore.canAccess(authUser, 'material')) { cleanupTemp(); sendMaterialJSON(403, { error: 'Forbidden' }); return; }
      }
      materialUploadData._auth = authUser;
      materialUploadData._token = token;
      materialUploadData._tempPath = materialUploadFilePath;
      var route = routes['/api/materials/upload'];
      if (!route) { cleanupTemp(); sendMaterialJSON(404, { error: 'unknown endpoint' }); return; }
      try {
        route(materialUploadData, function(data) {
          sendMaterialJSON(data && data.error ? 400 : 200, data);
        });
      } catch(e) {
        sendMaterialJSON(500, { error: e.message });
      }
    });

    req.pipe(materialBusboy);
    return;
  }

  // Apply rate limiting to auth routes
  if (routePath === '/api/auth/login' || routePath === '/api/auth/register') {
    var clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    var rateResult = rateLimiter.check(clientIp);
    if (!rateResult.allowed) {
      sendJSON(res, 429, {
        error: '璇锋眰杩囦簬棰戠箒锛岃 ' + rateResult.retryAfter + ' 绉掑悗鍐嶈瘯',
        retryAfter: rateResult.retryAfter
      });
      return;
    }
  }

  parseBody(req, parsedUrl, async function(body) {
    var auditStartedAt = Date.now();
    var token = extractToken(req, body);
    var authUser = null;
    if (AUTH_DISABLED && routePath.indexOf('/api/') === 0) {
      authUser = authDisabledUser;
    } else if (!isPublicRoute(routePath) && routePath.indexOf('/api/') === 0) {
      try { authUser = await authStore.authenticate(token); }
      catch(e) { sendJSON(res, 500, { error: e.message }); return; }
      if (!authUser) {
        sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }
      var moduleId = moduleForRoute(routePath);
      if (!moduleId) {
        sendJSON(res, 403, { error: 'Forbidden' });
        return;
      }
      if (!authStore.canAccess(authUser, moduleId)) {
        sendJSON(res, 403, { error: 'Forbidden' });
        return;
      }
    }
    body._auth = authUser;
    body._token = token;
    body._req = req;
    var route = routes[routePath];
    var styleJobMatch = routePath.match(/^\/api\/jobs\/([^/]+)$/);
    if (!route && styleJobMatch && routes['/api/jobs/:jobId']) {
      body.jobId = decodeURIComponent(styleJobMatch[1]);
      route = routes['/api/jobs/:jobId'];
    }
    var profitItemMatch = routePath.match(/^\/api\/profits\/(\d+)$/);
    if (!route && profitItemMatch && routes['/api/profits/:id']) {
      body.id = profitItemMatch[1];
      route = routes['/api/profits/:id'];
    }
    var materialDownloadMatch = routePath.match(/^\/api\/materials\/download\/(\d+)$/);
    if (!route && materialDownloadMatch && routes['/api/materials/download']) {
      body.id = materialDownloadMatch[1];
      route = routes['/api/materials/download'];
    }
    var imagegenHistoryMatch = routePath.match(/^\/api\/imagegen\/history\/(\d+)$/);
    if (!route && imagegenHistoryMatch && routes['/api/imagegen/history/:id']) {
      body.id = imagegenHistoryMatch[1];
      route = routes['/api/imagegen/history/:id'];
    }
    if (!route) { sendJSON(res, 404, { error: 'unknown endpoint' }); return; }
    var replied = false;
    function reply(data) {
      if (replied) return;
      replied = true;
      sendJSON(res, 200, data);
      var info = auditInfo(routePath, body, data);
      if (!info && shouldAuditRoute(routePath)) info = genericAuditInfo(routePath, body, data, auditStartedAt);
      if (info && authUser) {
        authStore.logOperation(Object.assign({}, info, {
          auth: authUser,
          req: req
        })).catch(function(e) {
          logger.warn('audit log failed', e);
        });
      }
    }
    try {
      route(body, reply);
    } catch(e) {
      reply({ error: e.message });
    }
  });
}

var ready = null;
function ensureReady() {
  if (!ready) ready = authStore.init();
  return ready;
}

function handleRequest(req, res) {
  ensureReady().then(function() {
    routeRequest(req, res);
  }).catch(function(e) {
    logger.error('auth init failed', e);
    sendJSON(res, 500, { error: e.message });
  });
}

var server = http.createServer(handleRequest);
server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 720000);
server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 730000);
server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS || 65000);

var PORT = Number(process.env.PORT) || 5555;
if (require.main === module) {
ensureReady().then(function() {
  server.listen(PORT, '0.0.0.0', function() {
    logger.info('Usagi Workspace API running', { port: PORT });
  });
}).catch(function(e) {
  logger.error('auth init failed', e);
  process.exit(1);
});
}

module.exports = handleRequest;




