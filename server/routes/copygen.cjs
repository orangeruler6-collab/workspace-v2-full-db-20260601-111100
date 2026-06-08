const fs = require('fs');
const path = require('path');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('routes:copygen');

module.exports = function createCopygenRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const callModelText = deps.callModelText;
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'copygen.db');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const adapter = createSqliteAdapter({ dbPath: dbPath, logger: logger });
  function getDb() {
    return adapter.createDb();
  }

  const initDb = getDb();
  initDb.run(`CREATE TABLE IF NOT EXISTS copygen_state (
    user_key    TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    updated_at  INTEGER DEFAULT 0
  )`, function() {
    initDb.run(`CREATE TABLE IF NOT EXISTS copygen_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key    TEXT NOT NULL,
      style_id    TEXT DEFAULT '',
      title       TEXT DEFAULT '',
      payload     TEXT NOT NULL,
      created_at  INTEGER DEFAULT 0
    )`, function() {
      initDb.close();
    });
  });

  function userKey(body) {
    const auth = body._auth || {};
    return auth.username || auth.display_name || 'default';
  }

  function text(value) {
    if (Array.isArray(value)) return value.map(text).filter(Boolean).join('\n');
    if (value && typeof value === 'object') return Object.values(value).map(text).filter(Boolean).join('\n');
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/\uFFFD+/g, '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
      .trim();
  }

  function extractJsonObject(raw) {
    const value = String(raw || '').trim();
    if (!value) throw new Error('模型网关未返回内容');
    try { return JSON.parse(value); } catch(e) {}
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
    throw new Error('模型网关返回内容不是 JSON');
  }

  function normalizeAngles(payload) {
    const raw = Array.isArray(payload) ? payload : payload.angles;
    return (Array.isArray(raw) ? raw : []).slice(0, 3).map(function(item, index) {
      return {
        id: item.id || ('angle-' + (index + 1)),
        type: text(item.type || item.name || ('切角 ' + (index + 1))).slice(0, 20),
        title: text(item.title).slice(0, 60),
        logic: text(item.logic || item.reason || item.description).slice(0, 140)
      };
    }).filter(function(item) {
      return item.title && item.logic;
    });
  }

  function fallbackAngles(requirement, material, style) {
    const subject = requirement || '这次选题';
    const platform = style.platform || '短视频';
    const tone = text((style.styleCard || {}).tone || '').slice(0, 18);
    const keyword = material.slice(0, 22) || subject;
    return [
      {
        id: 'pain',
        type: '痛点切角',
        title: subject.length > 12 ? subject.slice(0, 22) : '为什么' + subject + '一直做不顺',
        logic: '先抓用户正在经历的具体问题，再把' + keyword + '放进解决动作里。'
      },
      {
        id: 'contrast',
        type: '对比切角',
        title: '普通做法和高效做法差在哪',
        logic: '用前后对比降低理解成本，适合' + platform + '用户快速判断价值。'
      },
      {
        id: 'scenario',
        type: '场景切角',
        title: '一个真实场景里的解决方案',
        logic: '从具体使用瞬间进入，顺着场景植入卖点' + (tone ? '，语气保持' + tone : '') + '。'
      }
    ];
  }

  function callModelWithRetry(systemPrompt, userPrompt, options, attempts) {
    attempts = attempts || 2;
    return callModelText(systemPrompt, userPrompt, options).catch(function(err) {
      if (attempts <= 1) throw err;
      return new Promise(function(resolve) {
        setTimeout(resolve, 900);
      }).then(function() {
        return callModelWithRetry(systemPrompt, userPrompt, options, attempts - 1);
      });
    });
  }

  function stylePrompt(style) {
    style = style || {};
    const card = style.styleCard || {};
    return [
      style.name || '',
      style.platform || '',
      style.contentType || '',
      text(card.positioning),
      text(card.opening),
      text(card.structure),
      text(card.tone),
      text(card.rhythm),
      text(card.expressions),
      text(card.sampleClues)
    ].filter(Boolean).join('，').slice(0, 900);
  }

  return {
    '/api/copygen/state': function(body, cb) {
      const key = userKey(body);
      const db = getDb();
      db.get('SELECT payload, updated_at FROM copygen_state WHERE user_key=?', [key], function(err, row) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        if (!row) { cb({ state: null, updatedAt: 0 }); return; }
        try {
          cb({ state: JSON.parse(row.payload || '{}'), updatedAt: row.updated_at || 0 });
        } catch(e) {
          cb({ error: '文案生成状态数据损坏：' + e.message });
        }
      });
    },

    '/api/copygen/state/save': function(body, cb) {
      const key = userKey(body);
      const state = body.state || {};
      const db = getDb();
      db.run(
        `INSERT OR REPLACE INTO copygen_state (user_key,payload,updated_at)
         VALUES (?, ?, ?)`,
        [key, JSON.stringify(state), Math.floor(Date.now() / 1000)],
        function(err) {
          db.close();
          if (err) { cb({ error: err.message }); return; }
          cb({ ok: true });
        }
      );
    },

    '/api/copygen/records': function(body, cb) {
      const key = userKey(body);
      const db = getDb();
      db.all('SELECT id,style_id,title,payload,created_at FROM copygen_records WHERE user_key=? ORDER BY created_at DESC LIMIT 50', [key], function(err, rows) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        const records = (rows || []).map(function(row) {
          try { row.payload = JSON.parse(row.payload || '{}'); }
          catch(e) { row.payload = {}; }
          return row;
        });
        cb({ records: records });
      });
    },

    '/api/copygen/records/add': function(body, cb) {
      const key = userKey(body);
      const payload = body.payload || {};
      const title = body.title || payload.requirement || '文案生成记录';
      const styleId = body.style_id || payload.styleId || '';
      const db = getDb();
      db.run(
        'INSERT INTO copygen_records (user_key,style_id,title,payload) VALUES (?,?,?,?)',
        [key, styleId, title, JSON.stringify(payload)],
        function(err) {
          db.close();
          if (err) { cb({ error: err.message }); return; }
          cb({ id: this.lastID });
        }
      );
    },

    '/api/copygen/angles': function(body, cb) {
      if (!callModelText) { cb({ error: '模型网关 runtime is not available' }); return; }
      const requirement = text(body.requirement || '做一条新文案').slice(0, 500);
      const material = text(body.material || '').replace(/\s+/g, ' ').slice(0, 520);
      const style = body.style || {};
      const prompt = [
        '根据：' + [requirement, material].filter(Boolean).join('。'),
        '输出 JSON，格式 {"angles":[{"id":"pain","type":"痛点切角","title":"...","logic":"..."}]}。',
        '生成3个切角，title和logic都要短。'
      ].join('\n');
      callModelWithRetry('', prompt, {
        model: body.model || process.env.MODEL_STYLE_MODEL || process.env.OPENAI_STYLE_MODEL || 'gpt-5.2',
        maxOutputTokens: 520
      }).then(function(raw) {
        let parsed;
        try { parsed = extractJsonObject(raw); }
        catch(e) { cb({ error: e.message }); return; }
        const angles = normalizeAngles(parsed);
        cb({ angles: angles.length ? angles : fallbackAngles(requirement, material, style) });
      }).catch(function(err) {
        cb({ angles: fallbackAngles(requirement, material, style), warning: err.message || '模型网关不稳定，已使用本地兜底切角' });
      });
    },

    '/api/copygen/generate': function(body, cb) {
      if (!callModelText) { cb({ error: '模型网关 runtime is not available' }); return; }
      const requirement = text(body.requirement || '做一条新文案').slice(0, 500);
      const material = text(body.material || '').slice(0, 1600);
      const angle = body.angle || {};
      const style = body.style || {};
      const prompt = [
        '根据：' + [
          '任务：' + requirement,
          '素材：' + (material || '无'),
          '切角：' + [angle.type, angle.title, angle.logic].filter(Boolean).join(' / '),
          '风格：' + stylePrompt(style),
          '长度：' + (body.length || '中等脚本') + '，强度：' + (body.strength || '中')
        ].join('。'),
        '输出可直接发布的中文正文，不要解释，不要标题。'
      ].join('\n').slice(0, 3200);
      callModelText('', prompt, {
        model: body.model || process.env.MODEL_STYLE_MODEL || process.env.OPENAI_STYLE_MODEL || 'gpt-5.2',
        maxOutputTokens: body.length === 'B站长稿' ? 1800 : 1100
      }).then(function(raw) {
        const output = text(raw);
        if (!output) { cb({ error: '模型未生成正文' }); return; }
        cb({ output: output });
      }).catch(function(err) {
        cb({ error: err.message || '生成正文失败' });
      });
    },

    '/api/copygen/publish-recommend': function(body, cb) {
      if (!callModelText) { cb({ error: 'model runtime is not available' }); return; }
      const copy = text(body.copy || '').slice(0, 5000);
      if (!copy) { cb({ error: '需要先生成正文' }); return; }
      const captionMax = Math.max(30, Math.min(200, Number(body.captionMax) || 80));
      const introMax = Math.max(60, Math.min(300, Number(body.introMax) || 120));
      const context = text(body.context || '').slice(0, 1600);
      const style = body.style || {};
      const prompt = [
        '你是短视频发布运营。请根据已经生成的口播正文，生成发布辅助物料。',
        '严格只返回 Markdown，不要 JSON，不要解释。',
        '发布文案控制在 ' + captionMax + ' 字以内，像真人发布，不要标题党。',
        '封面标题分两行：上面 4-6 个字；下面 8-10 个字以内，概括事件或核心冲突。',
        '视频简介控制在 ' + introMax + ' 字以内，说清视频讲什么、看点是什么。',
        '不要新增正文里没有的事实。',
        '',
        '固定格式：',
        '## 发布文案',
        '（' + captionMax + '字以内）',
        '',
        '## 封面标题',
        '上：（4-6字）',
        '下：（8-10字以内）',
        '',
        '## 视频简介',
        '（' + introMax + '字以内）',
        '',
        '账号/风格参考：',
        stylePrompt(style),
        '',
        '补充上下文：',
        context,
        '',
        '已生成正文：',
        copy
      ].join('\n');
      callModelText('你只做短视频发布文案、封面标题、视频简介推荐，必须遵守字数和格式。', prompt, {
        model: body.model || process.env.MODEL_STYLE_MODEL || process.env.OPENAI_STYLE_MODEL || 'gpt-5.2',
        maxOutputTokens: 700
      }).then(function(raw) {
        const recommendation = text(raw);
        if (!recommendation) { cb({ error: '模型未生成发布推荐' }); return; }
        cb({ recommendation: recommendation });
      }).catch(function(err) {
        cb({ error: err.message || '生成发布推荐失败' });
      });
    }
  };
};
