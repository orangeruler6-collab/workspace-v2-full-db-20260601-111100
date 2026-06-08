const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('routes:trafficPlan');

const EMPTY_STATE = {
  plans: [],
  importedVideos: [],
  accountLibrary: [],
  applyRequests: []
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function text(value) {
  return String(value || '').trim();
}

function normalizedText(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

function cleanTrafficAccountName(value) {
  return text(value)
    .replace(/^【|】$/g, '')
    .replace(/\s+/g, '')
    .replace(/\d+\s*[-~－—]\s*\d+\s*s.*$/i, '')
    .replace(/(?:B站定制|bilibili定制|定制视频|定制报价|定制|植入视频|图文|视频|报价|合作价|折扣|实际合作|合作金额|金额|价格).*$/i, '')
    .replace(/[：:]+$/g, '');
}

function num(value) {
  if (typeof value === 'string') {
    const raw = value.trim().replace(/,/g, '');
    const matched = raw.match(/([\d.]+)\s*([wW万kK千]?)/);
    if (matched) {
      const base = Number(matched[1]);
      if (Number.isFinite(base)) {
        const unit = matched[2].toLowerCase();
        if (unit === 'w' || unit === '万') return Math.round(base * 10000);
        if (unit === 'k' || unit === '千') return Math.round(base * 1000);
        return base;
      }
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function jsonValue(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function timestamp(value) {
  if (!value) return nowSec();
  const n = Number(value);
  if (Number.isFinite(n) && n > 1000000000) return Math.floor(n > 9999999999 ? n / 1000 : n);
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : nowSec();
}

function userKey(body) {
  const auth = body && body._auth || {};
  return text(auth.username || auth.display_name || auth.name || 'default');
}

function scopeKey(prefix, body) {
  const state = body && body.state && typeof body.state === 'object' ? body.state : {};
  const group = text(body && (body.groupName || body.group) || state.groupName || state.group);
  return group ? (prefix + ':' + group) : userKey(body || {});
}

function trafficScopeKey(body) {
  return scopeKey('traffic', body);
}

function maintenanceScopeKey(body) {
  return scopeKey('maintenance', body);
}

function stateFromBody(body) {
  const state = body && body.state && typeof body.state === 'object' ? body.state : body || {};
  return {
    projects: Array.isArray(state.projects) ? state.projects : [],
    plans: Array.isArray(state.plans) ? state.plans : [],
    importedVideos: Array.isArray(state.importedVideos) ? state.importedVideos : [],
    accountLibrary: Array.isArray(state.accountLibrary) ? state.accountLibrary : [],
    applyRequests: Array.isArray(state.applyRequests) ? state.applyRequests : []
  };
}

function hasTrafficStateData(state) {
  return Boolean(
    state &&
    (
      state.projects && state.projects.length ||
      state.plans && state.plans.length ||
      state.importedVideos && state.importedVideos.length ||
      state.accountLibrary && state.accountLibrary.length ||
      state.applyRequests && state.applyRequests.length
    )
  );
}

function run(db, sql, params) {
  return new Promise(function(resolve, reject) {
    db.run(sql, params || [], function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params) {
  return new Promise(function(resolve, reject) {
    db.all(sql, params || [], function(err, rows) {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function get(db, sql, params) {
  return new Promise(function(resolve, reject) {
    db.get(sql, params || [], function(err, row) {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function closeDb(db) {
  try { db.close(); } catch (e) {}
}

function stableSlug(value) {
  return normalizedText(value).replace(/[^\w\u4e00-\u9fa5-]+/g, '').slice(0, 40) || 'project';
}

function generatedId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function projectDisplayName(plan) {
  return text(plan.projectName || plan.marketingTarget || plan.targetName || plan.productName || '未命名项目');
}

function existingProjectId(plan) {
  return text(plan.projectId || plan.projectInstanceId || plan.projectKey || plan.linkedTrafficProjectId);
}

function ensureProjectId(plan, fallbackIndex) {
  const existing = existingProjectId(plan);
  if (existing && existing !== projectDisplayName(plan)) return existing;
  const created = timestamp(plan.createdAt || plan.projectCreatedAt || plan.updatedAt || Date.now());
  const seed = [
    stableSlug(projectDisplayName(plan)),
    text(plan.platform || 'platform'),
    text(plan.scheduleDate || plan.projectMeta && plan.projectMeta.scheduleDate || ''),
    created,
    fallbackIndex || 0
  ].join('-');
  return 'proj-' + seed;
}

function executionIdFor(plan, projectId, index) {
  const existing = text(plan.id || plan.executionId || plan.linkedTrafficTaskId);
  if (existing && existing.indexOf('|') < 0) return existing;
  return [
    'exec',
    projectId,
    stableSlug(plan.accountName || plan.account || 'account'),
    index || 0
  ].join('-');
}

function normalizePlan(plan, index) {
  const projectId = ensureProjectId(plan || {}, index);
  const id = executionIdFor(plan || {}, projectId, index);
  const projectName = projectDisplayName(plan || {});
  const accountName = cleanTrafficAccountName(plan && (plan.accountName || plan.account));
  return Object.assign({}, plan, {
    id: id,
    executionId: id,
    projectId: projectId,
    projectKey: projectId,
    projectInstanceId: projectId,
    projectName: projectName,
    accountName: accountName || text(plan && plan.accountName),
    marketingTarget: text(plan && plan.marketingTarget) || projectName,
    updatedAt: plan && plan.updatedAt || new Date().toISOString(),
    createdAt: plan && plan.createdAt || new Date().toISOString()
  });
}

function normalizeProject(project, plans) {
  const first = plans && plans[0] || {};
  const projectId = text(project && (project.projectId || project.projectKey || project.id)) || ensureProjectId(first, 0);
  const projectName = text(project && (project.projectName || project.name || project.marketingTarget)) || projectDisplayName(first);
  const accounts = Array.from(new Set((plans || []).map(function(plan) { return text(plan.accountName); }).filter(Boolean)));
  return Object.assign({}, project, {
    id: projectId,
    projectId: projectId,
    projectKey: projectId,
    projectName: projectName,
    marketingTarget: text(project && project.marketingTarget) || projectName,
    platform: text(project && project.platform) || text(first.platform),
    scheduleDate: text(project && project.scheduleDate) || text(first.scheduleDate || first.projectMeta && first.projectMeta.scheduleDate),
    targetCpm: num(project && project.targetCpm || first.targetCpm),
    accounts: Array.isArray(project && project.accounts) && project.accounts.length ? project.accounts : accounts,
    createdAt: project && project.createdAt || first.createdAt || new Date().toISOString(),
    updatedAt: project && project.updatedAt || first.updatedAt || new Date().toISOString()
  });
}

function normalizeMaintenanceRecord(record) {
  const linkedTrafficTaskId = text(record.linkedTrafficTaskId || record.executionId || record.trafficExecutionId);
  const linkedTrafficProjectId = text(record.linkedTrafficProjectId || record.projectId || record.projectKey || record.trafficProjectId);
  return Object.assign({}, record, {
    id: text(record.id) || generatedId('maintenance'),
    linkedTrafficTaskId: linkedTrafficTaskId,
    linkedTrafficProjectId: linkedTrafficProjectId,
    linkedTrafficProjectName: text(record.linkedTrafficProjectName || record.projectName || record.targetName),
    targetName: text(record.targetName || record.projectName || record.linkedTrafficProjectName),
    accountName: cleanTrafficAccountName(record.accountName),
    phaseName: text(record.phaseName || record.periodName || record.phase || '一期'),
    updatedAt: record.updatedAt || new Date().toISOString(),
    createdAt: record.createdAt || new Date().toISOString()
  });
}

function normalizeApplyRequest(request) {
  const linkedTrafficTaskId = text(request.linkedTrafficTaskId || request.executionId || request.trafficExecutionId);
  const linkedTrafficProjectId = text(request.linkedTrafficProjectId || request.projectId || request.projectKey || request.trafficProjectId);
  return Object.assign({}, request, {
    id: text(request.id) || generatedId('apply'),
    linkedTrafficTaskId: linkedTrafficTaskId,
    linkedTrafficProjectId: linkedTrafficProjectId,
    linkedTrafficProjectName: text(request.linkedTrafficProjectName || request.projectName || request.targetName),
    projectName: text(request.projectName || request.linkedTrafficProjectName || request.targetName),
    accountName: cleanTrafficAccountName(request.accountName),
    phaseName: text(request.phaseName || request.periodName || request.phase || '一期'),
    updatedAt: request.updatedAt || new Date().toISOString(),
    createdAt: request.createdAt || new Date().toISOString()
  });
}

function maintenancePlayAmount(record) {
  const quantityInputs = record && record.quantityInputs || {};
  const raw = quantityInputs.play;
  const value = num(raw);
  if (!value) return 0;
  return Math.round(value * 10000);
}

function maintenanceMetricAmount(record, key) {
  const quantityInputs = record && record.quantityInputs || {};
  const value = num(quantityInputs[key]);
  if (!value) return 0;
  const platform = String(record && record.platform || '').toLowerCase();
  const isBilibili = platform.indexOf('bilibili') >= 0 || platform.indexOf('b站') >= 0;
  if (key === 'like' && value < 1000) return Math.round(value * 1000);
  if (isBilibili && (key === 'favorite' || key === 'share') && value < 1000) return Math.round(value * 1000);
  return Math.round(value);
}

function maintenanceBatchFromRecord(record, execution) {
  const phaseName = text(record.phaseName || record.periodName || record.phase || '本期');
  const executionId = text(record.linkedTrafficTaskId || record.executionId || record.trafficExecutionId);
  const projectId = text(record.linkedTrafficProjectId || record.projectId || record.projectKey || execution && (execution.projectId || execution.projectKey));
  const targetPlay = maintenancePlayAmount(record);
  const cpmTargetPlay = Math.round(num(record.targetPlayWan) * 10000);
  const targetMetrics = {
    play: targetPlay,
    like: maintenanceMetricAmount(record, 'like'),
    comment: maintenanceMetricAmount(record, 'comment'),
    favorite: maintenanceMetricAmount(record, 'favorite'),
    share: maintenanceMetricAmount(record, 'share'),
    coin: maintenanceMetricAmount(record, 'coin'),
    danmaku: maintenanceMetricAmount(record, 'danmaku'),
    blueClick: maintenanceMetricAmount(record, 'blueLink') || maintenanceMetricAmount(record, 'blueClick')
  };
  return {
    id: text(record.batchId) || (executionId + '-maintenance-' + phaseName),
    demandId: text(record.batchId) || (executionId + '-maintenance-' + phaseName),
    demandName: phaseName,
    phaseName: phaseName,
    demandStatus: text(record.demandStatus || record.status || 'running'),
    submittedBy: text(record.groupName || record.group),
    owner: text(record.owner || '投流组'),
    submittedAt: record.exportedAt || record.updatedAt || new Date().toISOString(),
    startedAt: record.startedAt || record.exportedAt || record.updatedAt || new Date().toISOString(),
    orderAmount: num(record.discountPrice || record.orderAmount),
    budget: num(record.discountPrice || record.budget || record.orderAmount),
    targetCpm: num(record.targetCpm),
    targetPlay: targetPlay,
    cpmTargetPlay: cpmTargetPlay,
    targetMetrics: targetMetrics,
    maintenanceCost: num(record.maintenanceCost),
    trafficType: text(record.trafficType || record.selectedOptions && record.selectedOptions.play || 'maintenance'),
    videoUrl: text(record.videoUrl),
    remark: text(record.exportedReviewText || record.reviewText || record.applyText),
    linkedMaintenanceRecordId: text(record.id),
    linkedTrafficTaskId: executionId,
    linkedTrafficProjectId: projectId
  };
}

async function syncMaintenanceRecordToTrafficPlan(db, record) {
  const executionId = text(record.linkedTrafficTaskId || record.executionId || record.trafficExecutionId);
  if (!executionId) return { ok: false, reason: 'missing linked traffic task id' };
  const groupName = text(record.groupName || record.group);
  const candidateKeys = Array.from(new Set([
    groupName ? ('traffic:' + groupName) : '',
    text(record.trafficScopeKey)
  ].filter(Boolean)));
  const params = candidateKeys.length ? candidateKeys.concat([executionId]) : [executionId];
  const sql = candidateKeys.length
    ? 'SELECT user_key,payload FROM traffic_account_executions WHERE user_key IN (' + placeholders(candidateKeys) + ') AND id=? ORDER BY updated_at DESC LIMIT 1'
    : 'SELECT user_key,payload FROM traffic_account_executions WHERE id=? ORDER BY updated_at DESC LIMIT 1';
  const row = await get(db, sql, params);
  if (!row) return { ok: false, reason: 'linked execution not found' };
  const execution = parseJson(row.payload, {});
  const batch = maintenanceBatchFromRecord(record, execution);
  if (!batch.targetPlay && !batch.maintenanceCost) return { ok: false, reason: 'empty batch metrics' };
  const projectId = text(execution.projectId || execution.projectKey || batch.linkedTrafficProjectId);
  const batches = Array.isArray(execution.batches) ? execution.batches.slice() : [];
  const index = batches.findIndex(function(item) {
    return text(item.id) === batch.id ||
      (text(item.linkedMaintenanceRecordId) && text(item.linkedMaintenanceRecordId) === text(record.id)) ||
      (text(item.phaseName || item.demandName) === batch.phaseName && text(item.linkedTrafficTaskId || execution.id) === executionId);
  });
  if (index >= 0) batches[index] = Object.assign({}, batches[index], batch);
  else batches.push(batch);
  const nextExecution = Object.assign({}, execution, {
    batches: batches,
    updatedAt: new Date().toISOString()
  });
  await run(db, `INSERT OR REPLACE INTO traffic_account_executions
    (user_key,id,project_key,account_group,account_name,platform,order_amount,budget,target_cpm,target_play,actual_play,video_url,xingtu_url,payload,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    row.user_key,
    text(nextExecution.id || executionId),
    projectId,
    text(nextExecution.accountGroup || nextExecution.groupName || nextExecution.group),
    text(nextExecution.accountName),
    text(nextExecution.platform),
    num(nextExecution.orderAmount || nextExecution.discountedAmount),
    num(nextExecution.budget || nextExecution.trafficBudget),
    num(nextExecution.targetCpm),
    num(nextExecution.targetPlay || nextExecution.targetMetrics && nextExecution.targetMetrics.play),
    num(nextExecution.current && nextExecution.current.play || nextExecution.actualPlay),
    text(nextExecution.videoUrl || nextExecution.videoId),
    text(nextExecution.xingtuUrl || nextExecution.authorUrl || nextExecution.creatorUrl),
    jsonValue(nextExecution),
    timestamp(nextExecution.createdAt) || nowSec(),
    timestamp(nextExecution.updatedAt) || nowSec()
  ]);
  await run(db, `INSERT OR REPLACE INTO traffic_batches
    (user_key,id,execution_id,project_key,demand_id,demand_name,status,traffic_type,budget,target_play,payload,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    row.user_key,
    batch.id,
    executionId,
    projectId,
    batch.demandId,
    batch.demandName,
    batch.demandStatus,
    batch.trafficType,
    batch.budget,
    batch.targetPlay,
    jsonValue(batch),
    timestamp(batch.submittedAt) || nowSec(),
    nowSec()
  ]);
  return { ok: true, executionId: executionId, batchId: batch.id, targetPlay: batch.targetPlay };
}

function placeholders(values) {
  return values.map(function() { return '?'; }).join(',');
}

function extractFirstUrl(value) {
  const match = String(value || '').match(/https?:\/\/[^\s"'<>，。；、\])}]+/i);
  return match ? match[0] : '';
}

function runOpencli(args, timeoutMs) {
  return new Promise(function(resolve) {
    const opencliPath = process.env.OPENCLI_BIN || process.env.USAGI_OPENCLI_PATH ||
      (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencli.cmd') : 'opencli');
    const command = process.platform === 'win32' ? 'cmd.exe' : opencliPath;
    const spawnArgs = process.platform === 'win32' ? ['/d', '/s', '/c', opencliPath].concat(args) : args;
    const child = spawn(command, spawnArgs, { shell: false, env: Object.assign({}, process.env) });
    const out = [];
    const err = [];
    let settled = false;
    const timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (e) {}
      resolve({ ok: false, code: -1, stdout: Buffer.concat(out).toString('utf8'), stderr: 'opencli timeout' });
    }, timeoutMs || 45000);
    child.stdout.on('data', function(chunk) { out.push(Buffer.from(chunk)); });
    child.stderr.on('data', function(chunk) { err.push(Buffer.from(chunk)); });
    child.on('error', function(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout: Buffer.concat(out).toString('utf8'), stderr: error.message || String(error) });
    });
    child.on('close', function(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}

function parseOpencliJson(stdout) {
  const clean = String(stdout || '').trim();
  const lines = clean.split(/\r?\n/).map(function(line) { return line.trim(); }).filter(Boolean);
  const candidates = [clean].concat(lines.slice().reverse());
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(clean.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      let parsed = JSON.parse(candidate);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) {}
  }
  return null;
}

module.exports = function createTrafficPlanRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const runPython = deps.runPython;
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'traffic_plan.db');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const adapter = createSqliteAdapter({ dbPath: dbPath, logger: logger });
  function getDb() {
    return adapter.createDb();
  }

  async function initSchema() {
    const db = getDb();
    try {
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_projects (
        user_key TEXT NOT NULL,
        project_key TEXT NOT NULL,
        project_name TEXT NOT NULL,
        platform TEXT DEFAULT '',
        schedule_date TEXT DEFAULT '',
        target_cpm REAL DEFAULT 0,
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, project_key)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_account_executions (
        user_key TEXT NOT NULL,
        id TEXT NOT NULL,
        project_key TEXT NOT NULL,
        account_group TEXT DEFAULT '',
        account_name TEXT DEFAULT '',
        platform TEXT DEFAULT '',
        order_amount REAL DEFAULT 0,
        budget REAL DEFAULT 0,
        target_cpm REAL DEFAULT 0,
        target_play REAL DEFAULT 0,
        actual_play REAL DEFAULT 0,
        video_url TEXT DEFAULT '',
        xingtu_url TEXT DEFAULT '',
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, id)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_batches (
        user_key TEXT NOT NULL,
        id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        project_key TEXT NOT NULL,
        demand_id TEXT DEFAULT '',
        demand_name TEXT DEFAULT '',
        status TEXT DEFAULT '',
        traffic_type TEXT DEFAULT '',
        budget REAL DEFAULT 0,
        target_play REAL DEFAULT 0,
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, id)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_account_library (
        user_key TEXT NOT NULL,
        account_group TEXT DEFAULT '',
        account_name TEXT NOT NULL,
        platform TEXT DEFAULT '',
        xingtu_url TEXT DEFAULT '',
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, account_group, account_name)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_imported_videos (
        user_key TEXT NOT NULL,
        id TEXT NOT NULL,
        account_name TEXT DEFAULT '',
        title TEXT DEFAULT '',
        url TEXT DEFAULT '',
        item_id TEXT DEFAULT '',
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, id)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_apply_requests (
        user_key TEXT NOT NULL,
        id TEXT NOT NULL,
        project_name TEXT DEFAULT '',
        account_name TEXT DEFAULT '',
        platform TEXT DEFAULT '',
        phase_name TEXT DEFAULT '',
        budget REAL DEFAULT 0,
        target_play REAL DEFAULT 0,
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, id)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_maintenance_records (
        user_key TEXT NOT NULL,
        id TEXT NOT NULL,
        group_name TEXT DEFAULT '',
        target_name TEXT DEFAULT '',
        account_name TEXT DEFAULT '',
        phase_name TEXT DEFAULT '',
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, id)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_maintenance_group_configs (
        user_key TEXT NOT NULL,
        group_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, group_name)
      )`);
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_traffic_exec_project ON traffic_account_executions(user_key, project_key)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_traffic_exec_group ON traffic_account_executions(account_group, updated_at)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_traffic_batch_exec ON traffic_batches(user_key, execution_id)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_traffic_maintenance_group ON traffic_maintenance_records(user_key, group_name, updated_at)');
    } finally {
      closeDb(db);
    }
  }

  const ready = initSchema();

  function withReady(cb, done) {
    ready.then(cb).catch(function(err) {
      done({ ok: false, error: err.message || String(err) });
    });
  }

  function keyedPlans(state) {
    return (state.plans || []).map(function(plan, index) {
      return normalizePlan(plan, index + 1);
    });
  }

  async function readState(key) {
    const db = getDb();
    try {
      const projectRows = await all(db, 'SELECT payload FROM traffic_projects WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const executionRows = await all(db, 'SELECT payload FROM traffic_account_executions WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const videoRows = await all(db, 'SELECT payload FROM traffic_imported_videos WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const accountRows = await all(db, 'SELECT payload FROM traffic_account_library WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const applyRows = await all(db, 'SELECT payload FROM traffic_apply_requests WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const meta = await get(db, `SELECT MAX(updated_at) AS updated_at FROM (
        SELECT updated_at FROM traffic_projects WHERE user_key=?
        UNION ALL SELECT updated_at FROM traffic_account_executions WHERE user_key=?
        UNION ALL SELECT updated_at FROM traffic_imported_videos WHERE user_key=?
        UNION ALL SELECT updated_at FROM traffic_account_library WHERE user_key=?
        UNION ALL SELECT updated_at FROM traffic_apply_requests WHERE user_key=?
      )`, [key, key, key, key, key]);
      return {
        ok: true,
        dbPath: dbPath,
        scopeKey: key,
        projects: projectRows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean),
        plans: executionRows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean),
        importedVideos: videoRows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean),
        accountLibrary: accountRows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean),
        applyRequests: applyRows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean),
        updatedAt: meta && meta.updated_at || 0
      };
    } finally {
      closeDb(db);
    }
  }

  function mergeTrafficStates(primary, fallback) {
    const projectMap = new Map();
    const planMap = new Map();
    const videoMap = new Map();
    const accountMap = new Map();
    const applyMap = new Map();
    function append(state) {
      if (!state) return;
      (state.projects || []).forEach(function(item) {
        const key = text(item.projectId || item.projectKey || item.id || item.projectName);
        if (key) projectMap.set(key, Object.assign({}, projectMap.get(key) || {}, item));
      });
      (state.plans || []).forEach(function(item) {
        const key = text(item.id || item.executionId);
        if (key) planMap.set(key, Object.assign({}, planMap.get(key) || {}, item));
      });
      (state.importedVideos || []).forEach(function(item) {
        const key = text(item.id || item.item_id || item.url || item.title);
        if (key) videoMap.set(key, Object.assign({}, videoMap.get(key) || {}, item));
      });
      (state.accountLibrary || []).forEach(function(item) {
        const key = [text(item.accountGroup || item.group), text(item.accountName || item.name)].join('|');
        if (text(item.accountName || item.name)) accountMap.set(key, Object.assign({}, accountMap.get(key) || {}, item));
      });
      (state.applyRequests || []).forEach(function(item) {
        const key = text(item.id);
        if (key) applyMap.set(key, Object.assign({}, applyMap.get(key) || {}, item));
      });
    }
    append(fallback);
    append(primary);
    return {
      ok: true,
      dbPath: dbPath,
      scopeKey: primary && primary.scopeKey || '',
      legacyKey: fallback && fallback.scopeKey || '',
      projects: Array.from(projectMap.values()),
      plans: Array.from(planMap.values()),
      importedVideos: Array.from(videoMap.values()),
      accountLibrary: Array.from(accountMap.values()),
      applyRequests: Array.from(applyMap.values()),
      updatedAt: Math.max(primary && primary.updatedAt || 0, fallback && fallback.updatedAt || 0)
    };
  }

  async function saveState(key, incoming) {
    const rawState = stateFromBody(incoming);
    const replaceMode = Boolean(incoming && incoming.replaceState);
    const state = Object.assign({}, rawState, { plans: keyedPlans(rawState) });
    if (replaceMode && !hasTrafficStateData(state) && !(incoming && incoming.confirmReset === true)) {
      const existing = await readState(key);
      if (hasTrafficStateData(existing)) {
        return {
          ok: false,
          preserved: true,
          error: '拒绝空投流状态覆盖已有数据；如需清空，请从明确的重置动作进入。'
        };
      }
    }
    if (!state.plans.length && !(incoming && incoming.allowEmptyPlans)) {
      const existing = await readState(key);
      if (existing && existing.plans && existing.plans.length) {
        state.plans = existing.plans;
        state.projects = existing.projects || [];
        state.importedVideos = state.importedVideos.length ? state.importedVideos : existing.importedVideos || [];
        state.accountLibrary = state.accountLibrary.length ? state.accountLibrary : existing.accountLibrary || [];
        state.applyRequests = state.applyRequests.length ? state.applyRequests : existing.applyRequests || [];
      }
    }

    const db = getDb();
    const now = nowSec();
    try {
      if (replaceMode) {
        await run(db, 'DELETE FROM traffic_batches WHERE user_key=?', [key]);
        await run(db, 'DELETE FROM traffic_account_executions WHERE user_key=?', [key]);
        await run(db, 'DELETE FROM traffic_projects WHERE user_key=?', [key]);
        await run(db, 'DELETE FROM traffic_imported_videos WHERE user_key=?', [key]);
        await run(db, 'DELETE FROM traffic_account_library WHERE user_key=?', [key]);
        await run(db, 'DELETE FROM traffic_apply_requests WHERE user_key=?', [key]);
      }

      const plansByProject = new Map();
      state.plans.forEach(function(plan) {
        const pKey = text(plan.projectId || plan.projectKey);
        if (!plansByProject.has(pKey)) plansByProject.set(pKey, []);
        plansByProject.get(pKey).push(plan);
      });

      const projectPayloads = new Map();
      (state.projects || []).forEach(function(project) {
        const pKey = text(project.projectId || project.projectKey || project.id);
        if (pKey) projectPayloads.set(pKey, project);
      });

      for (const entry of plansByProject.entries()) {
        const projectId = entry[0];
        const plans = entry[1];
        const project = normalizeProject(projectPayloads.get(projectId), plans);
        const createdAt = timestamp(project.createdAt);
        const updatedAt = timestamp(project.updatedAt);
        await run(db, `INSERT OR REPLACE INTO traffic_projects
          (user_key,project_key,project_name,platform,schedule_date,target_cpm,payload,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`, [
          key,
          project.projectId,
          project.projectName,
          text(project.platform),
          text(project.scheduleDate),
          num(project.targetCpm),
          jsonValue(project),
          createdAt || now,
          updatedAt || now
        ]);
      }

      for (const plan of state.plans) {
        const id = text(plan.id || plan.executionId);
        const pKey = text(plan.projectId || plan.projectKey);
        const createdAt = timestamp(plan.createdAt);
        const updatedAt = timestamp(plan.updatedAt);
        await run(db, `INSERT OR REPLACE INTO traffic_account_executions
          (user_key,id,project_key,account_group,account_name,platform,order_amount,budget,target_cpm,target_play,actual_play,video_url,xingtu_url,payload,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          key,
          id,
          pKey,
          text(plan.accountGroup || plan.groupName || plan.group),
          text(plan.accountName),
          text(plan.platform),
          num(plan.orderAmount || plan.discountedAmount),
          num(plan.budget || plan.trafficBudget),
          num(plan.targetCpm),
          num(plan.targetPlay || plan.targetMetrics && plan.targetMetrics.play),
          num(plan.current && plan.current.play || plan.actualPlay),
          text(plan.videoUrl || plan.videoId),
          text(plan.xingtuUrl || plan.authorUrl || plan.creatorUrl),
          jsonValue(plan),
          createdAt || now,
          updatedAt || now
        ]);

        const batches = Array.isArray(plan.batches) ? plan.batches : [];
        for (let i = 0; i < batches.length; i += 1) {
          const batch = batches[i] || {};
          const batchId = text(batch.id) || (id + '-batch-' + (i + 1));
          await run(db, `INSERT OR REPLACE INTO traffic_batches
            (user_key,id,execution_id,project_key,demand_id,demand_name,status,traffic_type,budget,target_play,payload,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
            key,
            batchId,
            id,
            pKey,
            text(batch.demandId || batch.phaseId),
            text(batch.demandName || batch.phaseName),
            text(batch.demandStatus || batch.status),
            text(batch.trafficType || plan.trafficType),
            num(batch.budget),
            num(batch.targetPlay || batch.expectedPlay),
            jsonValue(Object.assign({}, batch, {
              id: batchId,
              executionId: id,
              projectId: pKey
            })),
            timestamp(batch.createdAt || plan.createdAt) || now,
            timestamp(batch.updatedAt || plan.updatedAt) || now
          ]);
        }
      }

      for (const item of state.accountLibrary) {
        const accountName = cleanTrafficAccountName(item.accountName || item.name);
        if (!accountName) continue;
        await run(db, `INSERT OR REPLACE INTO traffic_account_library
          (user_key,account_group,account_name,platform,xingtu_url,payload,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?)`, [
          key,
          text(item.accountGroup || item.group),
          accountName,
          text(item.platform),
          text(item.xingtuUrl || item.authorUrl || item.creatorUrl),
          jsonValue(Object.assign({}, item, { accountName: accountName })),
          timestamp(item.createdAt) || now,
          timestamp(item.updatedAt) || now
        ]);
      }

      for (let i = 0; i < state.importedVideos.length; i += 1) {
        const item = state.importedVideos[i] || {};
        const id = text(item.id || item.item_id || item.itemId || item.url || item.title) || ('video-' + i);
        await run(db, `INSERT OR REPLACE INTO traffic_imported_videos
          (user_key,id,account_name,title,url,item_id,payload,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`, [
          key,
          id,
          text(item.accountName),
          text(item.title || item.item_title),
          text(item.url),
          text(item.item_id || item.itemId),
          jsonValue(Object.assign({}, item, { id: id })),
          timestamp(item.importedAt || item.createdAt) || now,
          timestamp(item.updatedAt || item.importedAt) || now
        ]);
      }

      for (const raw of state.applyRequests) {
        const item = normalizeApplyRequest(raw || {});
        await run(db, `INSERT OR REPLACE INTO traffic_apply_requests
          (user_key,id,project_name,account_name,platform,phase_name,budget,target_play,payload,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
          key,
          item.id,
          item.projectName,
          item.accountName,
          text(item.platform),
          item.phaseName,
          num(item.budget),
          num(item.targetPlay || item.targetMetrics && item.targetMetrics.play),
          jsonValue(item),
          timestamp(item.createdAt) || now,
          timestamp(item.updatedAt) || now
        ]);
      }

      return { ok: true, count: state.plans.length };
    } finally {
      closeDb(db);
    }
  }

  async function deleteProjectState(key, projectId) {
    const pKey = text(projectId);
    if (!pKey) return { ok: false, error: '缺少项目 ID' };
    const db = getDb();
    try {
      const rows = await all(db, 'SELECT id FROM traffic_account_executions WHERE user_key=? AND project_key=?', [key, pKey]);
      const ids = rows.map(function(row) { return text(row.id); }).filter(Boolean);
      if (ids.length) {
        await run(db, 'DELETE FROM traffic_batches WHERE user_key=? AND execution_id IN (' + placeholders(ids) + ')', [key].concat(ids));
      }
      await run(db, 'DELETE FROM traffic_account_executions WHERE user_key=? AND project_key=?', [key, pKey]);
      await run(db, 'DELETE FROM traffic_projects WHERE user_key=? AND project_key=?', [key, pKey]);
      return { ok: true, projectId: pKey, deletedExecutions: ids.length };
    } finally {
      closeDb(db);
    }
  }

  async function readGroupTasks(groupName, legacyKey) {
    const group = text(groupName);
    const groupKey = 'traffic:' + group;
    const keys = Array.from(new Set([groupKey, legacyKey].map(text).filter(Boolean)));
    const db = getDb();
    try {
      const rows = keys.length
        ? await all(db, 'SELECT payload, account_group FROM traffic_account_executions WHERE user_key IN (' + placeholders(keys) + ') ORDER BY updated_at DESC', keys)
        : [];
      const map = new Map();
      rows.forEach(function(row) {
        const plan = parseJson(row.payload, null);
        if (!plan) return;
        const planGroup = text(row.account_group || plan.accountGroup || plan.groupName || plan.group);
        if (group && normalizedText(planGroup) !== normalizedText(group)) return;
        const key = text(plan.id || plan.executionId);
        if (key && !map.has(key)) map.set(key, Object.assign({}, plan, { accountGroup: planGroup || group }));
      });
      return { ok: true, scopeKey: groupKey, legacyKey: legacyKey, count: map.size, plans: Array.from(map.values()) };
    } finally {
      closeDb(db);
    }
  }

  async function readMaintenanceSources(groupName) {
    const group = text(groupName);
    const db = getDb();
    try {
      const rows = await all(db, 'SELECT payload, account_group FROM traffic_account_executions ORDER BY updated_at DESC', []);
      const map = new Map();
      rows.forEach(function(row) {
        const plan = parseJson(row.payload, null);
        if (!plan) return;
        const planGroup = text(row.account_group || plan.accountGroup || plan.groupName || plan.group);
        if (group && normalizedText(planGroup) !== normalizedText(group)) return;
        const key = text(plan.id || plan.executionId);
        if (key && !map.has(key)) map.set(key, Object.assign({}, plan, { accountGroup: planGroup || group }));
      });
      return { ok: true, groupName: group, count: map.size, plans: Array.from(map.values()) };
    } finally {
      closeDb(db);
    }
  }

  async function readMaintenanceState(key) {
    const db = getDb();
    try {
      const recordRows = await all(db, 'SELECT payload FROM traffic_maintenance_records WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const configRows = await all(db, 'SELECT payload FROM traffic_maintenance_group_configs WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const meta = await get(db, `SELECT MAX(updated_at) AS updated_at FROM (
        SELECT updated_at FROM traffic_maintenance_records WHERE user_key=?
        UNION ALL SELECT updated_at FROM traffic_maintenance_group_configs WHERE user_key=?
      )`, [key, key]);
      return {
        ok: true,
        records: recordRows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean),
        groupConfigs: configRows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean),
        updatedAt: meta && meta.updated_at || 0
      };
    } finally {
      closeDb(db);
    }
  }

  async function saveMaintenanceState(key, state) {
    const records = Array.isArray(state && state.records) ? state.records : [];
    const groupConfigs = Array.isArray(state && state.groupConfigs) ? state.groupConfigs : [];
    const db = getDb();
    const now = nowSec();
    try {
      await run(db, 'DELETE FROM traffic_maintenance_records WHERE user_key=?', [key]);
      await run(db, 'DELETE FROM traffic_maintenance_group_configs WHERE user_key=?', [key]);
      for (const raw of records) {
        const record = normalizeMaintenanceRecord(raw || {});
        await run(db, `INSERT OR REPLACE INTO traffic_maintenance_records
          (user_key,id,group_name,target_name,account_name,phase_name,payload,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`, [
          key,
          record.id,
          text(record.groupName || record.group),
          record.targetName,
          record.accountName,
          record.phaseName,
          jsonValue(record),
          timestamp(record.createdAt) || now,
          timestamp(record.updatedAt) || now
        ]);
        await syncMaintenanceRecordToTrafficPlan(db, record);
      }
      for (const config of groupConfigs) {
        const groupName = text(config.groupName || config.group) || '未分组';
        await run(db, `INSERT OR REPLACE INTO traffic_maintenance_group_configs
          (user_key,group_name,payload,updated_at)
          VALUES (?,?,?,?)`, [
          key,
          groupName,
          jsonValue(Object.assign({}, config, { groupName: groupName })),
          timestamp(config.updatedAt) || now
        ]);
      }
      return { ok: true, records: records.length, groupConfigs: groupConfigs.length };
    } finally {
      closeDb(db);
    }
  }

  async function fetchDouyinStats(params) {
    const url = extractFirstUrl(params && (params.url || params.videoUrl)) || text(params && (params.url || params.videoUrl || params.awemeId || params.videoId));
    if (!url) return { ok: false, error: '请先填写抖音视频链接' };
    return { ok: false, error: '抖音播放检测已暂时关闭，请手动填写；互动后续按链接接入', url: url };
  }

  async function fetchXingtuVideos(params) {
    return { ok: false, error: '星图抓取已暂时关闭，请先用手动或 CRM CSV 回填', xingtuUrl: text(params && (params.xingtuUrl || params.authorUrl || params.creatorUrl)) };
  }

  async function fetchBilibiliStats(body) {
    const url = text(body.url || body.bvid);
    if (!url) return { ok: false, error: '请先填写 B 站视频链接或 BV 号' };
    if (!runPython) return { ok: false, error: 'B 站统计脚本未配置' };
    const result = await runPython('bilibili_stats.py', 'stats', { url: url }, 75);
    if (result && result.ok) return Object.assign({ source_method: 'bilibili video url/BV stats' }, result);
    return { ok: false, error: result && (result.error || result.message) || 'B 站数据读取失败' };
  }

  function readLatestCrmCsv() {
    return { ok: false, error: 'CRM CSV 自动回填未配置导出文件路径' };
  }

  function refreshCrmExecutionCsvState() {
    return Promise.resolve({ ok: false, error: 'CRM CSV 自动回填未配置导出文件路径' });
  }

  function startCrmAutoRefresh(intervalMs) {
    return { ok: true, intervalMs: Math.max(10 * 60 * 1000, Number(intervalMs) || 2 * 60 * 60 * 1000), disabled: true };
  }

  return {
    _startCrmAutoRefresh: startCrmAutoRefresh,

    '/api/traffic-plan/state': function(body, cb) {
      withReady(function() {
        const key = trafficScopeKey(body || {});
        const legacyKey = userKey(body || {});
        if (body._method === 'GET' || body.action === 'read') {
          Promise.all([
            readState(key),
            legacyKey !== key ? readState(legacyKey) : Promise.resolve({ projects: [], plans: [], importedVideos: [], accountLibrary: [], applyRequests: [], updatedAt: 0, scopeKey: legacyKey })
          ]).then(function(results) {
            cb(mergeTrafficStates(results[0], results[1]));
          }).catch(function(err) {
            cb({ ok: false, error: err.message || String(err) });
          });
          return;
        }
        saveState(key, body.state ? body : { state: stateFromBody(body) }).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/reset': function(body, cb) {
      withReady(function() {
        saveState(trafficScopeKey(body || {}), { state: EMPTY_STATE, allowEmptyPlans: true, replaceState: true, confirmReset: body && body.confirmReset === true }).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/delete-project': function(body, cb) {
      withReady(function() {
        deleteProjectState(trafficScopeKey(body || {}), body.projectId || body.projectKey).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/group-tasks': function(body, cb) {
      withReady(function() {
        const groupName = text(body.groupName || body.group || body._auth && body._auth.group_name);
        if (!groupName) {
          cb({ ok: true, scopeKey: '', legacyKey: userKey(body || {}), count: 0, plans: [] });
          return;
        }
        readGroupTasks(groupName, userKey(body || {})).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/maintenance-sources': function(body, cb) {
      withReady(function() {
        const groupName = text(body.groupName || body.group || body._auth && body._auth.group_name);
        if (!groupName) {
          cb({ ok: true, groupName: '', count: 0, plans: [] });
          return;
        }
        readMaintenanceSources(groupName).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/maintenance-state': function(body, cb) {
      withReady(function() {
        const key = maintenanceScopeKey(body || {});
        const legacyKey = userKey(body || {});
        if (body._method === 'GET' || body.action === 'read') {
          Promise.all([
            readMaintenanceState(key),
            legacyKey !== key ? readMaintenanceState(legacyKey) : Promise.resolve({ records: [], groupConfigs: [], updatedAt: 0 })
          ]).then(function(results) {
            const primary = results[0] || {};
            const legacy = results[1] || {};
            const recordMap = new Map();
            (legacy.records || []).concat(primary.records || []).forEach(function(record) {
              const normalized = normalizeMaintenanceRecord(record || {});
              const id = text(normalized.id);
              if (id) recordMap.set(id, Object.assign({}, recordMap.get(id) || {}, normalized));
            });
            const configMap = new Map();
            (legacy.groupConfigs || []).concat(primary.groupConfigs || []).forEach(function(config) {
              if (!config) return;
              const groupName = text(config.groupName || config.group) || '未分组';
              configMap.set(groupName, Object.assign({}, configMap.get(groupName) || {}, config, { groupName: groupName }));
            });
            cb({
              ok: true,
              scopeKey: key,
              legacyKey: legacyKey,
              records: Array.from(recordMap.values()),
              groupConfigs: Array.from(configMap.values()),
              updatedAt: Math.max(primary.updatedAt || 0, legacy.updatedAt || 0)
            });
          }).catch(function(err) {
            cb({ ok: false, error: err.message || String(err) });
          });
          return;
        }
        saveMaintenanceState(key, body.state || body).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/bilibili-stats': function(body, cb) {
      fetchBilibiliStats(body || {}).then(cb).catch(function(err) {
        cb({ ok: false, error: err.message || String(err) });
      });
    },

    '/api/traffic-plan/douyin-stats': function(body, cb) {
      fetchDouyinStats(body || {}).then(cb).catch(function(err) {
        cb({ ok: false, error: err.message || String(err) });
      });
    },

    '/api/traffic-plan/xingtu-videos': function(body, cb) {
      fetchXingtuVideos(body || {}).then(cb).catch(function(err) {
        cb({ ok: false, error: err.message || String(err) });
      });
    },

    '/api/traffic-plan/crm-execution-csv': function(body, cb) {
      try {
        cb(readLatestCrmCsv(body || {}));
      } catch (err) {
        cb({ ok: false, error: err.message || String(err) });
      }
    },

    '/api/traffic-plan/crm-refresh-now': function(body, cb) {
      withReady(function() {
        refreshCrmExecutionCsvState(body || {}).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    }
  };
};
