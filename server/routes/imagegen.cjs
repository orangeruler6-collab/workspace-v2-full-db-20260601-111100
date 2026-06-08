const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('routes:imagegen');

module.exports = function createImagegenRoutes(deps) {
  const runPython = deps.runPython;
  const getPythonCandidates = deps.getPythonCandidates;
  const minimaxApiKey = deps.minimaxApiKey || '';
  const serverDir = deps.serverDir || path.join(__dirname, '..');
  const defaultGptImageKey = deps.defaultGptImageKey || process.env.GPT_IMAGE2_KEY || '';
  const defaultGptImageBaseUrl = (process.env.GPT_IMAGE2_BASE_URL || process.env.SUB2API_BASE_URL || 'https://geekai.live/v1').replace(/\/+$/, '');
  const primaryGptImageKey = process.env.GPT_IMAGE2_PRIMARY_KEY || process.env.GPT_IMAGE2_KEY || defaultGptImageKey;
  const primaryGptImageBaseUrl = (process.env.GPT_IMAGE2_PRIMARY_BASE_URL || defaultGptImageBaseUrl).replace(/\/+$/, '');
  const primaryGptImageProxy = process.env.GPT_IMAGE2_PRIMARY_PROXY || process.env.GPT_IMAGE2_PROXY || process.env.FHL_PROXY_URL || process.env.MODEL_PROXY_URL || '';
  const primaryGptImageSslVerify = process.env.GPT_IMAGE2_PRIMARY_SSL_VERIFY || process.env.GPT_IMAGE2_SSL_VERIFY || 'true';
  const fallbackGptImageKey = process.env.GPT_IMAGE2_FALLBACK_KEY || defaultGptImageKey;
  const fallbackGptImageBaseUrl = (process.env.GPT_IMAGE2_FALLBACK_BASE_URL || defaultGptImageBaseUrl).replace(/\/+$/, '');
  const fallbackGptImageProxy = process.env.GPT_IMAGE2_FALLBACK_PROXY || process.env.GPT_IMAGE2_PROXY || process.env.FHL_PROXY_URL || process.env.MODEL_PROXY_URL || '';
  const fallbackGptImageSslVerify = process.env.GPT_IMAGE2_FALLBACK_SSL_VERIFY || process.env.GPT_IMAGE2_SSL_VERIFY || 'true';
  const gptImageOutageMs = Math.max(0, Number(process.env.GPT_IMAGE2_PROVIDER_OUTAGE_MS || 10 * 60 * 1000));
  const gptImageProviderOutage = { primary: { until: 0, error: '' } };

  // DB instance closure
  let dbInstance = null;

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
    return dbInstance;
  }

  function saveHistory(db, userId, username, model, type, prompt, imageData, ratio, resolution, resultUrl) {
    try {
      // 使用同步方式确保插入完成后再发响应
      const sql = `INSERT INTO imagegen_history (user_id, username, model, type, prompt, image_data, ratio, resolution, result_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const values = [userId, username, model, type, prompt, imageData || '', ratio, resolution, resultUrl];
      db.run(sql, values);
    } catch(e) {
      logger.warn('saveHistory error', e.message);
    }
  }

  function imagegenUploadDir() {
    const dir = path.join(path.dirname(serverDir), 'public', 'uploads', 'imagegen');
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
    return '/uploads/imagegen/' + encodeURIComponent(path.basename(filePath));
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
    return /ssl|eof|timed?\s*out|timeout|fetch failed|connect|connection|remote|reset|disconnected|502|503|504|rate limit|quota|temporarily unavailable|upstream/i.test(String(error || ''));
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
    const hasProxyOverride = Object.prototype.hasOwnProperty.call(params, 'proxy');
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
    const hasProxyOverride = Object.prototype.hasOwnProperty.call(params, 'proxy');
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
    if (/^(1024x1024|1536x1024|1024x1536|auto)$/i.test(String(fallback || ''))) return fallback;
    const key = String(ratio || '1:1');
    if (key === '1:1') return '1024x1024';
    if (key === '9:16' || key === '3:4' || key === '2:3') return '1024x1536';
    return '1536x1024';
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
          saveHistoryWithLocalImage(getDb(), userId, username, 'gpt-image2', 't2i', prompt, '', body.ratio || '1:1', size, result.url);
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
        max_retries: body.max_retries || 1,
        // 图生图走 /images/edits 更稳定；Responses edit 在部分中转会长时间无结果导致前端断连。
        transport: body.transport || 'images'
      }, 'gpt-image2 i2i err', result => {
        if (!result.error && result.url) {
          const userId = body._auth?.id || 0;
          const username = body._auth?.username || '匿名';
          saveHistoryWithLocalImage(getDb(), userId, username, 'gpt-image2', 'i2i', prompt, summarizeReferenceImages(images), body.ratio || '1:1', size, result.url);
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
