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
const createFeedbackRoutes = require('./routes/feedback.cjs');
const createAgentRoutes = require('./routes/agent.cjs');
const createTrafficPlanRoutes = require('./routes/trafficPlan.cjs');
const createTrafficPlanV2Routes = require('./routes/trafficPlanV2.cjs');
const createProjectDeliveryRoutes = require('./routes/projectDelivery.cjs');

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
var feedbackRoutes = createFeedbackRoutes({
  root: RUNTIME_ROOT
});
var trafficPlanRoutes = createTrafficPlanRoutes({
  root: RUNTIME_ROOT,
  runPython: runPython
});
var trafficPlanV2Routes = createTrafficPlanV2Routes({
  root: RUNTIME_ROOT
});
var projectDeliveryRoutes = createProjectDeliveryRoutes({
  root: RUNTIME_ROOT
});
if (trafficPlanRoutes && typeof trafficPlanRoutes._startCrmAutoRefresh === 'function') {
  trafficPlanRoutes._startCrmAutoRefresh(Number(process.env.TRAFFIC_CRM_REFRESH_INTERVAL_MS) || 2 * 60 * 60 * 1000);
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
Object.assign(routes, authRoutes, adminRoutes, toolsRoutes, vectorRoutes, imagegenRoutes, ideasRoutes, profitRoutes, scheduleRoutes, dailyHotRoutes, materialRoutes, downloadRoutes, smartCollectRoutes, aiEditRoutes, accountMonitorRoutes, accountStyleRoutes, copygenRoutes, videoPublishRoutes, feedbackRoutes, trafficPlanRoutes, trafficPlanV2Routes, projectDeliveryRoutes);
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
  username: '免登录测试',
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
    routePath === '/api/auth/register' ||
    routePath === '/api/workflow/styles' ||
    routePath === '/api/imagegen/history';
}

function moduleForRoute(routePath) {
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
  if (routePath.indexOf('/api/project-delivery') === 0) return 'projectDelivery';
  if (routePath.indexOf('/api/download') === 0) return 'download';
  if (routePath.indexOf('/api/imagegen') === 0 || routePath.indexOf('/api/minimax/image') === 0 || routePath.indexOf('/api/gpt-image2') === 0 || routePath.indexOf('/api/dreamina') === 0) return 'imagegen';
  if (routePath.indexOf('/api/vector') === 0 || routePath.indexOf('/api/bf') === 0 || routePath.indexOf('/api/cases') === 0) return 'tools';
  if (routePath.indexOf('/api/posttools') === 0) return 'posttools';
  if (routePath.indexOf('/api/workflow') === 0) return 'workflow';
  if (routePath.indexOf('/api/account-styles') === 0) return 'copygen';
  if (routePath.indexOf('/api/copygen') === 0) return 'copygen';
  if (routePath.indexOf('/api/video-publish') === 0) return 'videopublish';
  if (routePath.indexOf('/api/feedback') === 0) return 'feedback';
  if (routePath.indexOf('/api/traffic-plan') === 0) return 'trafficPlan';
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

function auditSummaryFor(routePath, body, data) {
  var method = body._method || 'POST';
  if (data && (data.error || data.ok === false)) return '请求失败：' + routePath;
  if (method === 'GET') return '查看：' + routePath;
  if (method === 'DELETE') return '删除：' + routePath;
  if (method === 'PATCH' || method === 'PUT') return '更新：' + routePath;
  return '操作：' + routePath;
}

function shouldAuditRoute(routePath) {
  if (routePath.indexOf('/api/') !== 0) return false;
  if (routePath === '/api/health') return false;
  if (routePath === '/api/system/health') return false;
  if (routePath === '/api/admin/logs') return false;
  if (routePath === '/api/auth/me') return false;
  if (routePath === '/api/workflow/styles') return false;
  if (routePath === '/api/ideas/click') return false;
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
  if (!data || data.error || data.ok === false) return null;
  if (routePath === '/api/profits' && body._method === 'POST') {
    return { module: 'ops', action: 'profit.create', target_type: 'profit', target_id: data.id, summary: '新增流水记录', metadata: auditBody(body) };
  }
  if (/^\/api\/profits\/\d+$/.test(routePath) && (body._method === 'PATCH' || body._method === 'PUT')) {
    return { module: 'ops', action: 'profit.update', target_type: 'profit', target_id: body.id, summary: '更新流水记录', metadata: auditBody(body) };
  }
  if (/^\/api\/profits\/\d+$/.test(routePath) && body._method === 'DELETE') {
    return { module: 'ops', action: 'profit.delete', target_type: 'profit', target_id: body.id, summary: '删除流水记录', metadata: auditBody(body) };
  }
  if (routePath === '/api/profit/add') return { module: 'ops', action: 'profit.create', target_type: 'profit', target_id: data.id, summary: '新增流水记录', metadata: auditBody(body) };
  if (routePath === '/api/profit/update') return { module: 'ops', action: 'profit.update', target_type: 'profit', target_id: body.id, summary: '更新流水记录', metadata: auditBody(body) };
  if (routePath === '/api/profit/delete') return { module: 'ops', action: 'profit.delete', target_type: 'profit', target_id: body.id, summary: '删除流水记录', metadata: auditBody(body) };
  if (routePath === '/api/schedule/save') return { module: 'schedule', action: 'schedule.save', target_type: 'schedule', summary: '保存排期看板', metadata: { tasks: Array.isArray(body.tasks) ? body.tasks.length : 0, members: Array.isArray(body.members) ? body.members.length : 0 } };
  if (routePath === '/api/materials/upload') return { module: 'material', action: 'material.upload', target_type: 'material', target_id: data.id, summary: '上传素材：' + (body.original || body.filename || ''), metadata: auditBody(body) };
  if (routePath === '/api/materials/update') return { module: 'material', action: 'material.update', target_type: 'material', target_id: body.id, summary: '更新素材信息', metadata: auditBody(body) };
  if (routePath === '/api/materials/delete') return { module: 'material', action: 'material.delete', target_type: 'material', target_id: body.id, summary: '删除素材', metadata: auditBody(body) };
  if (routePath === '/api/ideas/add') return { module: 'ideaboard', action: 'idea.create', target_type: 'idea', target_id: data.id, summary: '新增创意', metadata: auditBody(body) };
  if (routePath === '/api/ideas/update') return { module: 'ideaboard', action: 'idea.update', target_type: 'idea', target_id: body.id, summary: '更新创意', metadata: auditBody(body) };
  if (routePath === '/api/ideas/delete') return { module: 'ideaboard', action: 'idea.delete', target_type: 'idea', target_id: body.id, summary: '删除创意', metadata: auditBody(body) };
  if (routePath === '/api/daily-hot/refresh') return { module: 'dailyhot', action: 'dailyhot.refresh', target_type: 'daily_hot', target_id: body.date || data.date || '', summary: '更新每日热点', metadata: { date: body.date || data.date, sources: body.sources, count: Array.isArray(data.items) ? data.items.length : 0 } };
  if (routePath === '/api/daily-hot/analyze') return { module: 'dailyhot', action: 'dailyhot.analyze', target_type: 'daily_hot', target_id: body.date || data.date || '', summary: '分析每日热点', metadata: { date: body.date || data.date } };
  if (routePath === '/api/daily-hot/update-status') return { module: 'dailyhot', action: 'dailyhot.update_status', target_type: 'daily_hot', target_id: body.id, summary: '更新热点状态：' + body.status, metadata: auditBody(body) };
  if (routePath === '/api/daily-hot/manual-add') return { module: 'dailyhot', action: 'dailyhot.manual_add', target_type: 'daily_hot', target_id: body.title || '', summary: '手动新增热点：' + (body.title || ''), metadata: auditBody(body) };
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

    videoBusboy.on('file', function(fieldname, file, info) {
      var filename = info.filename || 'video';
      var uploadDir = path.join(RUNTIME_ROOT, 'temp', 'video-publish');
      try { fs.mkdirSync(uploadDir, { recursive: true }); } catch(e) {}
      videoUploadFilePath = path.join(uploadDir, Date.now() + '_' + filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'));
      videoUploadData._originalName = filename;
      var writeStream = fs.createWriteStream(videoUploadFilePath);
      file.pipe(writeStream);
      file.on('end', function() {
        writeStream.end();
      });
    });

    videoBusboy.on('field', function(fieldname, value) {
      videoUploadData[fieldname] = value;
    });

    videoBusboy.on('finish', async function() {
      var token = extractToken(req, videoUploadData);
      var authUser = null;
      if (AUTH_DISABLED) {
        authUser = authDisabledUser;
      } else {
        try { authUser = await authStore.authenticate(token); }
        catch(e) { sendJSON(res, 500, { error: e.message }); return; }
        if (!authUser) { sendJSON(res, 401, { error: 'Unauthorized' }); return; }
        if (!authStore.canAccess(authUser, 'videopublish')) { sendJSON(res, 403, { error: 'Forbidden' }); return; }
      }
      videoUploadData._auth = authUser;
      videoUploadData._token = token;
      videoUploadData._tempPath = videoUploadFilePath;
      var route = routes['/api/video-publish/videos/upload'];
      if (!route) { sendJSON(res, 404, { error: 'unknown endpoint' }); return; }
      try {
        route(videoUploadData, function(data) {
          sendJSON(res, data && data.error ? 400 : 200, data);
        });
      } catch(e) {
        sendJSON(res, 500, { error: e.message });
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
        error: '请求过于频繁，请 ' + rateResult.retryAfter + ' 秒后再试',
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
