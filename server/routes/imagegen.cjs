const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('routes:imagegen');
const TASK_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

module.exports = function createImagegenRoutes(deps) {
  const runPython = deps.runPython;
  const getPythonCandidates = deps.getPythonCandidates;
  const minimaxApiKey = deps.minimaxApiKey || '';
  const serverDir = deps.serverDir || path.join(__dirname, '..');
  const defaultGptImageKey = deps.defaultGptImageKey || process.env.GPT_IMAGE2_KEY || '';
  const defaultGptImageBaseUrl = (process.env.GPT_IMAGE2_BASE_URL || process.env.SUB2API_BASE_URL || 'https://geekai.live/v1').replace(/\/+$/, '');
  const primaryGptImageKey = process.env.GPT_IMAGE2_PRIMARY_KEY || process.env.GPT_IMAGE2_KEY || defaultGptImageKey;
  const primaryGptImageBaseUrl = (process.env.GPT_IMAGE2_PRIMARY_BASE_URL || defaultGptImageBaseUrl).replace(/\/+$/, '');
  function explicitEnv(name) {
    return Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : undefined;
  }

  function explicitProxyEnv(names) {
    for (const name of names) {
      const value = explicitEnv(name);
      if (value !== undefined) return value || '';
    }
    return '';
  }

  const primaryGptImageProxy = explicitProxyEnv(['GPT_IMAGE2_PRIMARY_PROXY', 'GPT_IMAGE2_PROXY']);
  const primaryGptImageSslVerify = process.env.GPT_IMAGE2_PRIMARY_SSL_VERIFY || process.env.GPT_IMAGE2_SSL_VERIFY || 'true';
  const fallbackGptImageKey = process.env.GPT_IMAGE2_FALLBACK_KEY || defaultGptImageKey;
  const fallbackGptImageBaseUrl = (process.env.GPT_IMAGE2_FALLBACK_BASE_URL || defaultGptImageBaseUrl).replace(/\/+$/, '');
  const fallbackGptImageProxy = explicitProxyEnv(['GPT_IMAGE2_FALLBACK_PROXY', 'GPT_IMAGE2_PROXY']);
  const fallbackGptImageSslVerify = process.env.GPT_IMAGE2_FALLBACK_SSL_VERIFY || process.env.GPT_IMAGE2_SSL_VERIFY || 'true';
  const gptImageOutageMs = Math.max(0, Number(process.env.GPT_IMAGE2_PROVIDER_OUTAGE_MS || 10 * 60 * 1000));
  const gptImageProviderOutage = { primary: { until: 0, error: '' } };
  const imagegenPublicBaseUrl = String(process.env.USAGI_IMAGEGEN_PUBLIC_BASE_URL || process.env.USAGI_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

  // DB instance closure
  let dbInstance = null;
  let dbRecovered = false;
  let imagegenTaskRunnerActive = false;

  function getDb() {
    if (dbInstance) return dbInstance;
    const dbPath = path.join(serverDir, 'data', 'imagegen_history.db');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) { try { fs.mkdirSync(dbDir, { recursive: true }); } catch(e) {} }
    const adapter = createSqliteAdapter({ dbPath, logger });
    dbInstance = adapter.createDb();
    // 初始化表
    dbInstance.run(`CREATE TABLE IF NOT EXISTS imagegen_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 0,
      username TEXT DEFAULT '匿名',
      model TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      image_data TEXT DEFAULT '',
      ratio TEXT DEFAULT '1:1',
      resolution TEXT DEFAULT '2K',
      result_url TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )`);
    dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_history_user ON imagegen_history(user_id, created_at DESC)`);
    dbInstance.run(`CREATE TABLE IF NOT EXISTS imagegen_tasks (
      id TEXT PRIMARY KEY,
      user_id INTEGER DEFAULT 0,
      username TEXT DEFAULT '',
      model TEXT NOT NULL DEFAULT 'gpt-image2',
      type TEXT NOT NULL,
      provider TEXT DEFAULT 'primary',
      prompt TEXT NOT NULL,
      request_json TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT DEFAULT '',
      result_url TEXT DEFAULT '',
      history_id INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      started_at INTEGER DEFAULT 0,
      finished_at INTEGER DEFAULT 0
    )`);
    dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_imagegen_tasks_status ON imagegen_tasks(status, created_at DESC)`);
    dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_imagegen_tasks_created ON imagegen_tasks(created_at DESC)`);
    dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_imagegen_tasks_user_created ON imagegen_tasks(user_id, created_at DESC)`);
    recoverImagegenTasks(dbInstance);
    return dbInstance;
  }

  function recoverImagegenTasks(db) {
    if (dbRecovered) return;
    dbRecovered = true;
    db.run(`UPDATE imagegen_tasks SET status='queued', updated_at=strftime('%s','now') WHERE status='running'`);
    db.all(`SELECT id FROM imagegen_tasks WHERE status='queued' ORDER BY created_at ASC LIMIT 3`, [], function(err, rows) {
      if (err) {
        logger.warn('recover imagegen tasks failed', err.message);
        return;
      }
      (rows || []).forEach(function(row, index) {
        setTimeout(kickImagegenTaskQueue, 1000 + index * 1000);
      });
    });
  }

  function saveHistory(db, userId, username, model, type, prompt, imageData, ratio, resolution, resultUrl) {
    try {
      const sql = `INSERT INTO imagegen_history (user_id, username, model, type, prompt, image_data, ratio, resolution, result_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const values = [userId, username, model, type, prompt, imageData || '', ratio, resolution, resultUrl];
      db.run(sql, values);
    } catch(e) {
      logger.warn('saveHistory error', e.message);
    }
  }

  function saveHistoryAndGetId(db, userId, username, model, type, prompt, imageData, ratio, resolution, resultUrl, cb) {
    const sql = `INSERT INTO imagegen_history (user_id, username, model, type, prompt, image_data, ratio, resolution, result_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [userId, username, model, type, prompt, imageData || '', ratio, resolution, resultUrl];
    db.run(sql, values, function(err) {
      if (err) {
        logger.warn('saveHistoryAndGetId error', err.message);
        cb(err);
        return;
      }
      cb(null, this.lastID || 0);
    });
  }

  function imagegenUploadDir() {
    const dir = path.join(path.dirname(serverDir), 'public', 'uploads', 'imagegen');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function imagegenTaskDir() {
    const dir = path.join(serverDir, 'data', 'imagegen_tasks');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function extFromContentType(contentType) {
    const type = String(contentType || '').toLowerCase();
    if (type.indexOf('image/jpeg') >= 0 || type.indexOf('image/jpg') >= 0) return '.jpg';
    if (type.indexOf('image/webp') >= 0) return '.webp';
    if (type.indexOf('image/gif') >= 0) return '.gif';
    return '.png';
  }

  function localImagegenUrl(filePath) {
    const relativeUrl = '/uploads/imagegen/' + encodeURIComponent(path.basename(filePath));
    return imagegenPublicBaseUrl ? imagegenPublicBaseUrl + relativeUrl : relativeUrl;
  }

  function saveDataImage(value, prefix) {
    const raw = String(value || '');
    const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    if (!match) return '';
    const ext = extFromContentType(match[1]);
    const fileName = (prefix || 'imagegen') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    const filePath = path.join(imagegenUploadDir(), fileName);
    fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
    return localImagegenUrl(filePath);
  }

  function downloadImageToLocal(url, prefix, cb) {
    let parsed;
    try { parsed = new URL(url); } catch(e) { cb(null, ''); return; }
    if (!/^https?:$/i.test(parsed.protocol)) { cb(null, ''); return; }

    const req = https.get(parsed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 UsagiImageHistory/1.0',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadImageToLocal(new URL(res.headers.location, parsed).toString(), prefix, cb);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        cb(new Error('image download HTTP ' + res.statusCode), '');
        return;
      }

      const chunks = [];
      let size = 0;
      const maxSize = 24 * 1024 * 1024;
      res.on('data', function(chunk) {
        size += chunk.length;
        if (size > maxSize) {
          req.destroy(new Error('image too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function() {
        const ext = extFromContentType(res.headers['content-type']);
        const fileName = (prefix || 'imagegen') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
        const filePath = path.join(imagegenUploadDir(), fileName);
        fs.writeFile(filePath, Buffer.concat(chunks), function(err) {
          if (err) { cb(err, ''); return; }
          cb(null, localImagegenUrl(filePath));
        });
      });
    });
    req.setTimeout(30000, function() {
      req.destroy(new Error('image download timeout'));
    });
    req.on('error', function(err) {
      cb(err, '');
    });
  }

  function saveHistoryWithLocalImage(db, userId, username, model, type, prompt, imageData, ratio, resolution, resultUrl) {
    const rawUrl = String(resultUrl || '');
    if (!rawUrl) return;
    if (rawUrl.indexOf('/uploads/imagegen/') === 0) {
      saveHistory(db, userId, username, model, type, prompt, imageData, ratio, resolution, rawUrl);
      return;
    }
    if (rawUrl.indexOf('data:image/') === 0) {
      let localUrl = '';
      try { localUrl = saveDataImage(rawUrl, model); } catch(e) { logger.warn('saveDataImage error', e.message); }
      saveHistory(db, userId, username, model, type, prompt, imageData, ratio, resolution, localUrl || rawUrl);
      return;
    }
    if (/^https?:\/\//i.test(rawUrl)) {
      downloadImageToLocal(rawUrl, model, function(err, localUrl) {
        if (err) logger.warn('download imagegen history image failed', err.message);
        saveHistory(db, userId, username, model, type, prompt, imageData, ratio, resolution, localUrl || rawUrl);
      });
      return;
    }
    saveHistory(db, userId, username, model, type, prompt, imageData, ratio, resolution, rawUrl);
  }

  function saveHistoryWithLocalImageAsync(db, userId, username, model, type, prompt, imageData, ratio, resolution, resultUrl, cb) {
    const rawUrl = String(resultUrl || '');
    cb = typeof cb === 'function' ? cb : function() {};
    if (!rawUrl) {
      cb(new Error('empty result url'));
      return;
    }
    function insert(localUrl) {
      saveHistoryAndGetId(db, userId, username, model, type, prompt, imageData, ratio, resolution, localUrl || rawUrl, function(err, historyId) {
        cb(err, localUrl || rawUrl, historyId || 0);
      });
    }
    if (rawUrl.indexOf('/uploads/imagegen/') === 0) {
      insert(rawUrl);
      return;
    }
    if (rawUrl.indexOf('data:image/') === 0) {
      let localUrl = '';
      try { localUrl = saveDataImage(rawUrl, model); } catch(e) { logger.warn('saveDataImage error', e.message); }
      insert(localUrl || rawUrl);
      return;
    }
    if (/^https?:\/\//i.test(rawUrl)) {
      downloadImageToLocal(rawUrl, model, function(err, localUrl) {
        if (err) logger.warn('download imagegen history image failed', err.message);
        insert(localUrl || rawUrl);
      });
      return;
    }
    insert(rawUrl);
  }

  function withLocalImageResult(result, localUrl, historyId) {
    const next = Object.assign({}, result || {});
    if (localUrl) {
      next.url = localUrl;
      next.image_url = localUrl;
      next.result_url = localUrl;
      next.local_url = localUrl;
    }
    if (historyId) next.history_id = historyId;
    return next;
  }

  function normalizeGptReferenceImages(body) {
    var inputs = [];
    if (Array.isArray(body.image_base64_list)) inputs = body.image_base64_list;
    else if (Array.isArray(body.images)) inputs = body.images;
    else if (Array.isArray(body.reference_images)) inputs = body.reference_images;
    else if (body.image_base64) inputs = [body.image_base64];
    else if (body.image) inputs = [body.image];
    return inputs.map(function(item, index) {
      if (!item) return null;
      if (typeof item === 'string') {
        return {
          base64: item.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''),
          mime: 'image/png',
          name: 'reference_' + (index + 1) + '.png'
        };
      }
      return {
        base64: String(item.base64 || item.image_base64 || item.image || item.data || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''),
        mime: item.mime || item.mime_type || item.type || 'image/png',
        name: item.name || item.filename || ('reference_' + (index + 1) + '.png')
      };
    }).filter(function(item) {
      return item && item.base64;
    }).slice(0, 8);
  }

  function summarizeReferenceImages(images) {
    if (!Array.isArray(images) || !images.length) return '';
    return JSON.stringify(images.map(function(item) {
      return {
        name: item.name || '',
        mime: item.mime || 'image/png',
        size: String(item.base64 || '').length
      };
    }));
  }

  function makeTaskId() {
    return 'ig_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function publicTaskRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id || 0,
      username: row.username || '',
      model: row.model || 'gpt-image2',
      type: row.type || 't2i',
      provider: row.provider || 'primary',
      prompt: row.prompt || '',
      status: row.status || 'queued',
      error: row.error || '',
      result_url: row.result_url || '',
      history_id: row.history_id || 0,
      created_at: row.created_at || 0,
      updated_at: row.updated_at || 0,
      started_at: row.started_at || 0,
      finished_at: row.finished_at || 0
    };
  }

  function taskUserScope(body) {
    const auth = body && body._auth || {};
    const userId = Number(auth.id || 0) || 0;
    const username = String(auth.username || auth.display_name || '').trim();
    if (userId > 0) return { where: 'user_id=?', params: [userId] };
    if (username) return { where: 'username=?', params: [username] };
    return { where: `(user_id=0 OR user_id IS NULL) AND COALESCE(username,'')=''`, params: [] };
  }

  function updateTask(db, id, fields, cb) {
    const keys = Object.keys(fields || {});
    if (!id || !keys.length) {
      if (cb) cb(null);
      return;
    }
    const sql = `UPDATE imagegen_tasks SET ${keys.map(k => `${k}=?`).join(', ')}, updated_at=strftime('%s','now') WHERE id=?`;
    const values = keys.map(k => fields[k]).concat(id);
    db.run(sql, values, function(err) {
      if (err) logger.warn('update imagegen task failed', err.message);
      if (cb) cb(err || null);
    });
  }

  function kickImagegenTaskQueue() {
    if (imagegenTaskRunnerActive) return;
    const db = getDb();
    db.get(`SELECT * FROM imagegen_tasks WHERE status='queued' ORDER BY created_at ASC LIMIT 1`, [], function(err, task) {
      if (err) {
        logger.warn('select imagegen task failed', err.message);
        return;
      }
      if (!task) return;
      imagegenTaskRunnerActive = true;
      runImagegenTask(task.id, function() {
        imagegenTaskRunnerActive = false;
        setTimeout(kickImagegenTaskQueue, 500);
      });
    });
  }

  function runImagegenTask(taskId, done) {
    done = typeof done === 'function' ? done : function() {};
    const db = getDb();
    db.get(`SELECT * FROM imagegen_tasks WHERE id=?`, [taskId], function(err, task) {
      if (err || !task || TASK_TERMINAL_STATUSES.has(task.status)) { done(); return; }
      let request = {};
      try { request = JSON.parse(task.request_json || '{}'); } catch(e) {}
      if (request._request_file) {
        try {
          const fileRequest = JSON.parse(fs.readFileSync(request._request_file, 'utf8'));
          request = Object.assign({}, request, fileRequest);
        } catch(e) {
          updateTask(db, taskId, { status: 'failed', error: 'request file read failed: ' + e.message, finished_at: Math.floor(Date.now() / 1000) }, done);
          return;
        }
      }
      updateTask(db, taskId, { status: 'running', error: '', started_at: Math.floor(Date.now() / 1000) });
      const type = task.type === 'i2i' ? 'i2i' : 't2i';
      const prompt = task.prompt || request.prompt || '';
      const ratio = request.ratio || '1:1';
      const size = type === 'i2i'
        ? gptImageEditSize(ratio, request.size)
        : gptImageSize(ratio, request.resolution || request.resolution_type, request.size);
      const params = {
        key: request.key || '',
        base_url: request.base_url || request.baseUrl || '',
        proxy: request.proxy || '',
        provider: request.provider || request.route || task.provider || 'primary',
        prompt: prompt,
        size: size,
        quality: request.quality || 'auto',
        background: request.background || '',
        output_format: request.output_format || '',
        transport: type === 'i2i' ? (request.transport || 'images') : (request.transport || '')
      };
      let imageData = '';
      if (type === 'i2i') {
        const images = normalizeGptReferenceImages(request);
        if (!images.length) {
          updateTask(db, taskId, { status: 'failed', error: 'reference image required', finished_at: Math.floor(Date.now() / 1000) }, done);
          return;
        }
        params.image_base64_list = images;
        params.max_retries = request.max_retries || Number(process.env.GPT_IMAGE2_I2I_MAX_RETRIES || 3);
        imageData = summarizeReferenceImages(images);
      }
      runSelectedGptImageFast(params, 'gpt-image2 task ' + taskId, function(result) {
        if (result && result.error) {
          updateTask(db, taskId, {
            status: 'failed',
            error: String(result.error || 'failed').slice(0, 1000),
            finished_at: Math.floor(Date.now() / 1000)
          }, done);
          return;
        }
        if (!result || !result.url) {
          updateTask(db, taskId, {
            status: 'failed',
            error: 'no image in response',
            finished_at: Math.floor(Date.now() / 1000)
          }, done);
          return;
        }
        saveHistoryWithLocalImageAsync(db, task.user_id || 0, task.username || '', 'gpt-image2', type, prompt, imageData, ratio, size, result.url, function(saveErr, localUrl, historyId) {
          updateTask(db, taskId, {
            status: saveErr ? 'failed' : 'succeeded',
            error: saveErr ? String(saveErr.message || saveErr).slice(0, 1000) : '',
            result_url: localUrl || result.url,
            history_id: historyId || 0,
            finished_at: Math.floor(Date.now() / 1000)
          }, done);
        });
      });
    });
  }

  function gptImageTimeoutMs(envName) {
    const raw = Number(process.env[envName] || process.env.GPT_IMAGE2_ROUTE_TIMEOUT_MS || 180000);
    return Number.isFinite(raw) && raw > 0 ? raw : 180000;
  }

  function gptImageChildTimeoutSec(params, envName) {
    const explicit = Number(params.timeout_sec || params.timeoutSec || 0);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(30, Math.floor(explicit));
    const routeMs = gptImageTimeoutMs(envName);
    const safetyMs = Math.max(1000, Number(process.env.GPT_IMAGE2_ROUTE_TIMEOUT_SAFETY_MS || 10000));
    return Math.max(30, Math.floor((routeMs - safetyMs) / 1000));
  }

  function gptImageMeta(params, transport, startedAt, extra) {
    return Object.assign({
      provider_base_url: params.base_url || '',
      provider_proxy: Boolean(params.proxy),
      ssl_verify: params.ssl_verify,
      transport: transport,
      size: params.size || '',
      elapsed_ms: Date.now() - startedAt
    }, extra || {});
  }

  function withGptImageMeta(result, params, transport, startedAt, extra) {
    const parsed = result && typeof result === 'object' ? result : {};
    return Object.assign({}, parsed, gptImageMeta(params, parsed.transport || transport, startedAt, extra));
  }

  function runGptImage(params, logLabel, cb) {
    const proxy = params.proxy || '';
    const startedAt = Date.now();
    const routeTimeoutMs = gptImageTimeoutMs('GPT_IMAGE2_ROUTE_TIMEOUT_MS');
    const childTimeoutSec = gptImageChildTimeoutSec(params, 'GPT_IMAGE2_ROUTE_TIMEOUT_MS');
    const proxyEnv = proxy ? {
      https_proxy: proxy,
      http_proxy: proxy,
      HTTPS_PROXY: proxy,
      HTTP_PROXY: proxy
    } : {
      https_proxy: '',
      http_proxy: '',
      HTTPS_PROXY: '',
      HTTP_PROXY: ''
    };
    const pyEnv = Object.assign({}, process.env, proxyEnv, {
      PYTHONIOENCODING: 'utf-8',
      GPT_IMAGE2_TIMEOUT_SEC: String(childTimeoutSec)
    });
    const scriptPath = path.join(serverDir, 'gpt_image2.py');
    if (!fs.existsSync(scriptPath)) {
      cb({ error: 'python script not found: gpt_image2.py' });
      return;
    }
    const tmpFile = path.join(os.tmpdir(), 'gpt2i_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(tmpFile, Buffer.from(JSON.stringify({ params: params }), 'utf8'));
    const py = spawn(getPythonCandidates()[0] || 'python', [scriptPath, tmpFile], {
      env: pyEnv,
      shell: false
    });
    const outChunks = [], errChunks = [];
    let done = false;
    function killProcessTree(proc) {
      if (!proc || !proc.pid) return;
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true });
        } else {
          proc.kill('SIGKILL');
        }
      } catch(e) {
        try { proc.kill(); } catch(err) {}
      }
    }
    const timer = setTimeout(function() {
      if (done) return;
      done = true;
      killProcessTree(py);
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      cb(gptImageMeta(params, 'images', startedAt, {
        error: 'GPT-Image2 request timed out',
        timeout_ms: routeTimeoutMs,
        child_timeout_sec: childTimeoutSec
      }));
      return;
      cb({ error: 'GPT-Image2 生成超时，请稍后重试或先切到 MiniMax 生图' });
    }, routeTimeoutMs);
    py.stdout.on('data', c => outChunks.push(c));
    py.stderr.on('data', c => errChunks.push(c));
    py.on('close', function() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      const out = Buffer.concat(outChunks).toString('utf-8').trim();
      const err = Buffer.concat(errChunks).toString('utf-8').trim();
      if (err) logger.warn(logLabel, err.slice(0, 200));
      const jsonLine = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || '';
      try { cb(withGptImageMeta(JSON.parse(jsonLine), params, 'images', startedAt, { child_timeout_sec: childTimeoutSec })); }
      catch(e) { cb({ error: 'GPT-Image2 返回解析失败: ' + out.slice(0, 200), stderr: err.slice(0, 200) }); }
    });
    py.on('error', function(e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch(err) {}
      cb(gptImageMeta(params, 'images', startedAt, { error: e.message, child_timeout_sec: childTimeoutSec }));
    });
  }

  function runGptImageResponses(params, logLabel, cb) {
    const proxy = params.proxy || '';
    const startedAt = Date.now();
    const routeTimeoutMs = gptImageTimeoutMs('GPT_IMAGE2_RESPONSES_TIMEOUT_MS');
    const childTimeoutSec = gptImageChildTimeoutSec(params, 'GPT_IMAGE2_RESPONSES_TIMEOUT_MS');
    const proxyEnv = proxy ? {
      https_proxy: proxy,
      http_proxy: proxy,
      HTTPS_PROXY: proxy,
      HTTP_PROXY: proxy
    } : {
      https_proxy: '',
      http_proxy: '',
      HTTPS_PROXY: '',
      HTTP_PROXY: ''
    };
    const pyEnv = Object.assign({}, process.env, proxyEnv, {
      PYTHONIOENCODING: 'utf-8',
      GPT_IMAGE2_TIMEOUT_SEC: String(childTimeoutSec)
    });
    const scriptPath = path.join(serverDir, 'gpt_image2_responses.py');
    if (!fs.existsSync(scriptPath)) {
      cb({ error: 'python script not found: gpt_image2_responses.py' });
      return;
    }
    const tmpFile = path.join(os.tmpdir(), 'gpt2i_responses_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(tmpFile, Buffer.from(JSON.stringify({ params: params }), 'utf8'));
    const py = spawn(getPythonCandidates()[0] || 'python', [scriptPath, tmpFile], {
      env: pyEnv,
      shell: false
    });
    const outChunks = [], errChunks = [];
    let done = false;
    function killProcessTree(proc) {
      if (!proc || !proc.pid) return;
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true });
        } else {
          proc.kill('SIGKILL');
        }
      } catch(e) {
        try { proc.kill(); } catch(err) {}
      }
    }
    const timer = setTimeout(function() {
      if (done) return;
      done = true;
      killProcessTree(py);
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      cb(gptImageMeta(params, 'responses', startedAt, {
        error: 'GPT-Image2 responses request timed out',
        timeout_ms: routeTimeoutMs,
        child_timeout_sec: childTimeoutSec
      }));
      return;
      cb({ error: 'GPT-Image2 加速线路超时，请稍后重试或切回原线路' });
    }, routeTimeoutMs);
    py.stdout.on('data', c => outChunks.push(c));
    py.stderr.on('data', c => errChunks.push(c));
    py.on('close', function() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      const out = Buffer.concat(outChunks).toString('utf-8').trim();
      const err = Buffer.concat(errChunks).toString('utf-8').trim();
      if (err) logger.warn(logLabel, err.slice(0, 200));
      const jsonLine = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || '';
      try { cb(withGptImageMeta(JSON.parse(jsonLine), params, 'responses', startedAt, { child_timeout_sec: childTimeoutSec })); }
      catch(e) { cb({ error: 'GPT-Image2 加速返回解析失败: ' + out.slice(0, 200), stderr: err.slice(0, 200) }); }
    });
    py.on('error', function(e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch(err) {}
      cb(gptImageMeta(params, 'responses', startedAt, { error: e.message, child_timeout_sec: childTimeoutSec }));
    });
  }

  function gptImageProviderConfig(provider) {
    const selected = String(provider || 'primary').toLowerCase();
    if (selected === 'fallback' || selected === 'legacy') {
      return {
        provider: 'fallback',
        key: fallbackGptImageKey,
        base_url: fallbackGptImageBaseUrl,
        proxy: fallbackGptImageProxy,
        ssl_verify: fallbackGptImageSslVerify
      };
    }
    return {
      provider: 'primary',
      key: primaryGptImageKey,
      base_url: primaryGptImageBaseUrl,
      proxy: primaryGptImageProxy,
      ssl_verify: primaryGptImageSslVerify
    };
  }

  function isGptImageNetworkError(error) {
    return /ssl|eof|timed?\s*out|timeout|fetch failed|connect|connection|remote|reset|disconnected|502|503|504|rate limit|quota|temporarily unavailable|upstream|no available compatible accounts|no available channel/i.test(String(error || ''));
  }

  function shouldBypassPrimaryGptImage(params) {
    return false;
  }

  function markPrimaryGptImageFailure(error) {
    if (!gptImageOutageMs || !isGptImageNetworkError(error)) return;
    gptImageProviderOutage.primary = {
      until: Date.now() + gptImageOutageMs,
      error: String(error || '').slice(0, 500)
    };
  }

  function runSelectedGptImage(params, logLabel, cb) {
    const provider = gptImageProviderConfig(params.provider);
    const selected = provider.provider;
    const hasProxyOverride = Object.prototype.hasOwnProperty.call(params, 'proxy') && String(params.proxy || '').trim();
    const requestParams = Object.assign({}, params, {
      key: params.key || provider.key,
      base_url: params.base_url || provider.base_url,
      proxy: hasProxyOverride ? params.proxy : provider.proxy,
      ssl_verify: params.ssl_verify || provider.ssl_verify
    });

    runGptImage(requestParams, logLabel + ' ' + selected, function(result) {
      cb(Object.assign({}, result || {}, { provider: selected }));
    });
  }

  function shouldUseResponsesTransport(params) {
    const transport = String(params.transport || '').toLowerCase();
    if (transport === 'images') return false;
    const provider = String(params.provider || '').toLowerCase();
    const baseUrl = String(params.base_url || params.baseUrl || '').toLowerCase();
    if (provider === 'fallback' || provider === 'legacy' || baseUrl.indexOf('geekai.live') >= 0) return false;
    if (transport === 'responses') return true;
    const useResponses = String(process.env.GPT_IMAGE2_USE_RESPONSES || 'false').toLowerCase();
    return useResponses !== 'false' && useResponses !== '0' && useResponses !== 'no';
  }

  function runSelectedGptImageFast(params, logLabel, cb) {
    const requestedProvider = String(params.provider || 'primary').toLowerCase();
    const bypassPrimary = false;
    const provider = gptImageProviderConfig(params.provider);
    const selected = provider.provider;
    const bypassedPrimaryError = '';
    const hasProxyOverride = Object.prototype.hasOwnProperty.call(params, 'proxy') && String(params.proxy || '').trim();
    const requestParams = Object.assign({}, params, {
      key: params.key || provider.key,
      base_url: params.base_url || provider.base_url,
      proxy: hasProxyOverride ? params.proxy : provider.proxy,
      ssl_verify: params.ssl_verify || provider.ssl_verify
    });

    const useResponses = shouldUseResponsesTransport(requestParams);
    const runPrimary = useResponses ? runGptImageResponses : runGptImage;
    runPrimary(requestParams, logLabel + ' ' + selected + (useResponses ? ' responses' : ' images'), function(result) {
      if (!result || !result.error) {
        cb(Object.assign({}, result || {}, {
          provider: selected,
          transport: result && result.transport ? result.transport : (useResponses ? 'responses' : 'images'),
          primaryError: bypassedPrimaryError || (result && result.primaryError)
        }));
        return;
      }

      if (useResponses) {
        if (String(requestParams.transport || '').toLowerCase() === 'responses') {
          if (selected === 'primary') markPrimaryGptImageFailure(result.error);
          cb(Object.assign({}, result || {}, {
            provider: selected,
            transport: 'responses',
            primaryError: bypassedPrimaryError || (result && result.primaryError)
          }));
          return;
        }
        logger.warn(logLabel + ' responses failed, switching to images transport', String(result.error).slice(0, 200));
        runGptImage(requestParams, logLabel + ' ' + selected + ' images-fallback', function(imageResult) {
          if (!imageResult || !imageResult.error) {
            cb(Object.assign({}, imageResult || {}, {
              provider: selected,
              transport: 'images',
              primaryError: result.error
            }));
            return;
          }

          if (selected === 'primary') markPrimaryGptImageFailure(result.error || imageResult.error);
          cb(Object.assign({}, imageResult || {}, {
            provider: selected,
            transport: 'images',
            primaryError: result.error
          }));
        });
        return;
      }

      if (selected === 'primary') markPrimaryGptImageFailure(result.error);
      if (selected === 'primary' && fallbackGptImageKey && String(fallbackGptImageBaseUrl || '').trim()) {
        const fallbackParams = Object.assign({}, params, {
          provider: 'fallback',
          key: params.fallback_key || fallbackGptImageKey,
          base_url: params.fallback_base_url || fallbackGptImageBaseUrl,
          proxy: hasProxyOverride ? params.proxy : fallbackGptImageProxy,
          ssl_verify: params.ssl_verify || fallbackGptImageSslVerify,
          transport: params.transport || 'images'
        });
        logger.warn(logLabel + ' primary failed, switching to fallback provider', String(result.error).slice(0, 200));
        runGptImage(fallbackParams, logLabel + ' fallback images', function(fallbackResult) {
          cb(Object.assign({}, fallbackResult || {}, {
            provider: 'fallback',
            transport: 'images',
            primaryError: bypassedPrimaryError || (result && result.error)
          }));
        });
        return;
      }
      cb(Object.assign({}, result || {}, {
        provider: selected,
        transport: useResponses ? 'responses' : 'images',
        primaryError: bypassedPrimaryError || (result && result.primaryError)
      }));
    });
  }

  function gptImageSize(ratio, resolution, fallback) {
    if (/^\d+x\d+$/i.test(String(fallback || ''))) return fallback;
    const res = String(resolution || '2K').toUpperCase();
    const key = String(ratio || '1:1');
    const table = {
      '1K': { '1:1': '1088x1088', '16:9': '2048x1152', '9:16': '1152x2048', '3:2': '1632x1088', '2:3': '1088x1632', '4:3': '1472x1104', '3:4': '1104x1472' },
      '2K': { '1:1': '1440x1440', '16:9': '2560x1440', '9:16': '1440x2560', '3:2': '2160x1440', '2:3': '1440x2160', '4:3': '1920x1440', '3:4': '1440x1920' },
      '4K': { '16:9': '3840x2160', '9:16': '2160x3840', '3:2': '3840x2560', '2:3': '2560x3840', '4:3': '3840x2880', '3:4': '2880x3840' }
    };
    return (table[res] && table[res][key]) || table['2K'][key] || table['2K']['1:1'];
  }

  function gptImageEditSize(ratio, fallback) {
    if (/^\d+x\d+$/i.test(String(fallback || ''))) return fallback;
    return gptImageSize(ratio, '2K', fallback);
  }

  return {
    '/api/imagegen/history': function(body, cb) {
      const page = Math.max(1, parseInt(body.page) || 1);
      const limit = Math.min(30, Math.max(1, parseInt(body.limit) || 12));
      const offset = (page - 1) * limit;
      const db = getDb();
      db.all(`SELECT id, user_id, username, model, type, prompt, ratio, resolution, result_url, created_at FROM imagegen_history ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset], function(err, rows) {
        if (err) { cb({ error: err.message }); return; }
        db.get(`SELECT COUNT(*) as cnt FROM imagegen_history`, [], function(err2, totalRow) {
          if (err2) { cb({ error: err2.message }); return; }
          cb({ list: rows || [], total: totalRow ? totalRow.cnt : 0, page, limit });
        });
      });
    },

    '/api/imagegen/history/:id': function(body, cb) {
      const id = parseInt(body.params?.id || body.id) || 0;
      if (!id) { cb({ error: 'invalid id' }); return; }
      const db = getDb();
      db.run(`DELETE FROM imagegen_history WHERE id=?`, [id], function(err) {
        if (err) { cb({ error: err.message }); return; }
        cb({ ok: this.changes > 0 });
      });
    },

    '/api/gpt-image2/tasks': function(body, cb) {
      const action = String(body.action || 'create');
      const db = getDb();
      if (action === 'list') {
        const limit = Math.min(50, Math.max(1, parseInt(body.limit) || 20));
        const scope = taskUserScope(body);
        db.all(`SELECT * FROM imagegen_tasks WHERE ${scope.where} ORDER BY created_at DESC LIMIT ?`, scope.params.concat(limit), function(err, rows) {
          if (err) { cb({ error: err.message }); return; }
          cb({ list: (rows || []).map(publicTaskRow) });
        });
        return;
      }
      const prompt = String(body.prompt || '').trim();
      if (!prompt) { cb({ error: 'prompt required' }); return; }
      const type = body.image_base64 || body.image_base64_list || body.images || body.reference_images ? 'i2i' : 't2i';
      if (type === 'i2i' && !normalizeGptReferenceImages(body).length) {
        cb({ error: 'reference image required' });
        return;
      }
      const id = makeTaskId();
      const userId = body._auth?.id || 0;
      const username = body._auth?.username || body._auth?.display_name || '';
      const provider = String(body.provider || body.route || 'primary');
      const requestPayload = {
        prompt: prompt,
        provider: provider,
        route: body.route || '',
        ratio: body.ratio || '1:1',
        resolution: body.resolution || body.resolution_type || '2K',
        size: body.size || '',
        quality: body.quality || 'auto',
        background: body.background || '',
        output_format: body.output_format || '',
        transport: body.transport || '',
        image_base64: body.image_base64 || '',
        image_base64_list: body.image_base64_list || body.images || body.reference_images || null,
        max_retries: body.max_retries || ''
      };
      let requestJson = '';
      try {
        const requestFile = path.join(imagegenTaskDir(), id + '.json');
        fs.writeFileSync(requestFile, JSON.stringify(requestPayload), 'utf8');
        requestJson = JSON.stringify({
          prompt: prompt,
          provider: provider,
          ratio: requestPayload.ratio,
          resolution: requestPayload.resolution,
          size: requestPayload.size,
          quality: requestPayload.quality,
          transport: requestPayload.transport,
          _request_file: requestFile
        });
      } catch(e) {
        cb({ error: 'write request file failed: ' + e.message });
        return;
      }
      db.run(
        `INSERT INTO imagegen_tasks (id, user_id, username, model, type, provider, prompt, request_json, status) VALUES (?, ?, ?, 'gpt-image2', ?, ?, ?, ?, 'queued')`,
        [id, userId, username, type, provider, prompt, requestJson],
        function(err) {
          if (err) { cb({ error: err.message }); return; }
          db.get(`SELECT * FROM imagegen_tasks WHERE id=?`, [id], function(getErr, row) {
            if (getErr) { cb({ error: getErr.message }); return; }
            setTimeout(kickImagegenTaskQueue, 20);
            cb({ task: publicTaskRow(row) });
          });
        }
      );
    },

    '/api/gpt-image2/tasks/status': function(body, cb) {
      const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 50) : [];
      const db = getDb();
      if (!ids.length) {
        const limit = Math.min(50, Math.max(1, parseInt(body.limit) || 20));
        const scope = taskUserScope(body);
        db.all(`SELECT * FROM imagegen_tasks WHERE ${scope.where} ORDER BY created_at DESC LIMIT ?`, scope.params.concat(limit), function(err, rows) {
          if (err) { cb({ error: err.message }); return; }
          cb({ list: (rows || []).map(publicTaskRow) });
        });
        return;
      }
      const placeholders = ids.map(() => '?').join(',');
      const scope = taskUserScope(body);
      db.all(`SELECT * FROM imagegen_tasks WHERE id IN (${placeholders}) AND ${scope.where} ORDER BY created_at DESC`, ids.concat(scope.params), function(err, rows) {
        if (err) { cb({ error: err.message }); return; }
        cb({ list: (rows || []).map(publicTaskRow) });
      });
    },

    '/api/dreamina': function(body, cb) {
      const action = body.action || 'text2image';
      logger.info('/api/dreamina', { action: action });
      runPython('dreamina_api.py', action, body, 180).then(result => {
        // 保存历史记录
        if (!result.error && result.image_url) {
          const userId = body._auth?.id || 0;
          const username = body._auth?.username || '匿名';
          saveHistoryWithLocalImage(getDb(), userId, username, 'dreamina', action === 'text2image' ? 't2i' : 'i2i', body.prompt || '', body.input_image || '', body.model || '4.0', '2K', result.image_url);
        }
        cb(result);
      });
    },

    '/api/dreamina/text2image': function(body, cb) {
      runPython('dreamina_api.py', 'text2image', body, 180).then(result => {
        if (!result.error && result.image_url) {
          const userId = body._auth?.id || 0;
          const username = body._auth?.username || '匿名';
          saveHistoryWithLocalImage(getDb(), userId, username, 'dreamina', 't2i', body.prompt || '', '', body.model || '4.0', '2K', result.image_url);
        }
        cb(result);
      });
    },

    '/api/dreamina/image2image': function(body, cb) {
      runPython('dreamina_api.py', 'image2image', body, 180).then(result => {
        if (!result.error && result.image_url) {
          const userId = body._auth?.id || 0;
          const username = body._auth?.username || '匿名';
          saveHistoryWithLocalImage(getDb(), userId, username, 'dreamina', 'i2i', body.prompt || '', body.input_image || '', body.model || '4.0', '2K', result.image_url);
        }
        cb(result);
      });
    },

    '/api/gpt-image2/text2image': function(body, cb) {
      const prompt = body.prompt || '';
      if (!prompt) { cb({ error: 'prompt required' }); return; }
      const size = gptImageSize(body.ratio, body.resolution || body.resolution_type, body.size);
      runSelectedGptImageFast({
        key: body.key || '',
        base_url: body.base_url || body.baseUrl || '',
        proxy: body.proxy || '',
        provider: body.provider || body.route || 'primary',
        prompt: prompt,
        size: size,
        quality: body.quality || 'auto',
        background: body.background || '',
        output_format: body.output_format || '',
        transport: body.transport || ''
      }, 'gpt-image2 err', result => {
        if (!result.error && result.url) {
          const userId = body._auth?.id || 0;
          const username = body._auth?.username || '匿名';
          saveHistoryWithLocalImageAsync(getDb(), userId, username, 'gpt-image2', 't2i', prompt, '', body.ratio || '1:1', size, result.url, function(err, localUrl, historyId) {
            if (err) logger.warn('save gpt-image2 t2i local image failed', err.message);
            cb(withLocalImageResult(result, localUrl, historyId));
          });
          return;
        }
        cb(result);
      });
    },

    '/api/gpt-image2/image2image': function(body, cb) {
      const prompt = body.prompt || '';
      if (!prompt) { cb({ error: 'prompt required' }); return; }
      const size = gptImageEditSize(body.ratio, body.size);
      const images = normalizeGptReferenceImages(body);
      if (!images.length) { cb({ error: 'reference image required' }); return; }
      runSelectedGptImageFast({
        key: body.key || '',
        base_url: body.base_url || body.baseUrl || '',
        proxy: body.proxy || '',
        provider: body.provider || body.route || 'primary',
        prompt: prompt,
        image_base64_list: images,
        size: size,
        quality: body.quality || 'auto',
        background: body.background || '',
        output_format: body.output_format || '',
        max_retries: body.max_retries || Number(process.env.GPT_IMAGE2_I2I_MAX_RETRIES || 3),
        // 图生图走 /images/edits 更稳定；Responses edit 在部分中转会长时间无结果导致前端断连。
        transport: body.transport || 'images'
      }, 'gpt-image2 i2i err', result => {
        if (!result.error && result.url) {
          const userId = body._auth?.id || 0;
          const username = body._auth?.username || '匿名';
          saveHistoryWithLocalImageAsync(getDb(), userId, username, 'gpt-image2', 'i2i', prompt, summarizeReferenceImages(images), body.ratio || '1:1', size, result.url, function(err, localUrl, historyId) {
            if (err) logger.warn('save gpt-image2 i2i local image failed', err.message);
            cb(withLocalImageResult(result, localUrl, historyId));
          });
          return;
        }
        cb(result);
      });
    },

    '/api/minimax/image': function(body, cb) {
      const prompt = body.prompt || '';
      if (!prompt) { cb({ error: 'prompt required' }); return; }
      if (!minimaxApiKey) { cb({ error: 'MINIMAX_API_KEY is not configured' }); return; }
      const payloadObj = {
        model: 'image-01',
        prompt: prompt,
        aspect_ratio: body.aspect_ratio || '1:1',
        response_format: 'url',
        n: Math.min(body.n || 1, 9)
      };
      if (body.subject_reference) {
        payloadObj.subject_reference = body.subject_reference;
      }
      const payload = JSON.stringify(payloadObj);
      const req = https.request({
        hostname: 'api.minimaxi.com',
        port: 443,
        path: '/v1/image_generation',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': 'Bearer ' + minimaxApiKey
        }
      }, function(res) {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', function() {
          try {
            const data = JSON.parse(raw);
            // 打印原始响应以便调试
            logger.info('MiniMax raw response keys:', Object.keys(data));
            // 检查 API 返回状态码 (可能在 base_resp 或顶层 status_code)
            const apiCode = data.base_resp?.status_code ?? data.status_code;
            if (apiCode && apiCode !== 0) {
              cb({ error: data.error || ('MiniMax error: ' + apiCode + ' ' + (data.base_resp?.status_msg || data.status_msg || '')) });
              return;
            }
            // 提取 URL 数组：可能是 data.data.image_urls / data.data.Image urls / data.data (直接是数组)
            let rawUrls = [];
            if (data.data) {
              if (Array.isArray(data.data)) {
                rawUrls = data.data;
              } else if (Array.isArray(data.data['image_urls'])) {
                rawUrls = data.data['image_urls'];
              } else if (Array.isArray(data.data['Image urls'])) {
                rawUrls = data.data['Image urls'];
              }
            }
            logger.info('MiniMax response: apiCode=' + apiCode + ', rawUrls len=' + rawUrls.length + ', firstUrl=' + (rawUrls[0] || '').substring(0, 80));
            // 空格->%20，%2F -> /
            const urls = rawUrls.map(function(url) {
              try {
                var u = new URL(url);
                return u.origin + u.pathname.replace(/ /g, '%20').replace(/%2F/g, '/') + u.search;
              } catch(e) {
                return url;
              }
            });
            // 保存每张图片到历史记录
            if (urls.length > 0) {
              const userId = body._auth?.id || 0;
              const username = body._auth?.username || '匿名';
              urls.forEach(function(url) {
                saveHistoryWithLocalImage(getDb(), userId, username, 'minimax', 't2i', prompt, '', body.aspect_ratio || '1:1', '2K', url);
              });
            }
            logger.info('MiniMax about to cb with urls len=' + urls.length + ', first=' + (urls[0]||'').slice(0,60));
            cb({ urls: urls, count: urls.length });
          } catch(e) {
            logger.info('MiniMax catch error: ' + e.message);
            cb({ error: raw.substring(0, 500) });
          }
        });
      });
      req.on('error', function(e) { cb({ error: e.message }); });
      req.setTimeout(120000, function() {
        req.destroy(new Error('MiniMax image request timeout'));
      });
      req.write(payload);
      req.end();
    }
  };
};
