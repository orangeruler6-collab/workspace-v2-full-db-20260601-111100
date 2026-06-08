const fs = require('fs');
const path = require('path');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('routes:accountStyles');

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function makeSample(content) {
  const text = cleanText(content);
  return {
    id: makeId('sample'),
    title: text.slice(0, 24) || '未命名样本',
    content: text
  };
}

function cleanText(value) {
  return String(value || '')
    .replace(/\uFFFD+/g, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
    .trim();
}

function makeStyleCard(card) {
  card = card || {};
  function text(value) {
    if (Array.isArray(value)) return value.join('\n');
    if (value && typeof value === 'object') {
      return Object.values(value).map(text).filter(Boolean).join('\n');
    }
    if (value === null || value === undefined) return '';
    return cleanText(value);
  }
  return {
    positioning: text(card.positioning),
    topics: text(card.topics),
    titleStyle: text(card.titleStyle),
    opening: text(card.opening),
    structure: text(card.structure),
    tone: text(card.tone),
    rhythm: text(card.rhythm),
    expressions: text(card.expressions),
    banned: text(card.banned),
    sampleClues: text(card.sampleClues || card.sample_clues || card.sampleSignals || card.sample_signals),
    confirmed: Boolean(card.confirmed)
  };
}

function normalizeStyle(style) {
  const next = Object.assign({}, style || {});
  next.id = next.id || makeId('style');
  next.name = String(next.name || '').trim() || '未命名账号';
  next.platform = next.platform || '抖音';
  next.contentType = next.contentType || '口播';
  next.scene = next.scene || '';
  next.status = next.status || '待分析';
  next.usedCount = Number(next.usedCount) || 0;
  next.createdBy = Number(next.createdBy) || 0;
  next.createdByName = next.createdByName || '';
  next.tags = Array.isArray(next.tags) ? next.tags : [next.platform, next.contentType].filter(Boolean);
  next.samples = Array.isArray(next.samples) ? next.samples.map(function(sample) {
    return {
      id: sample.id || makeId('sample'),
      title: cleanText(sample.title || String(sample.content || '').slice(0, 24)) || '未命名样本',
      content: cleanText(sample.content || sample.text || '')
    };
  }).filter(function(sample) { return sample.content; }) : [];
  next.styleCard = makeStyleCard(next.styleCard);
  return next;
}

function splitSampleInput(input) {
  if (Array.isArray(input)) return input.map(function(item) { return item.content || item.text || item; });
  return String(input || '')
    .split(/\n\s*---+\s*\n|\n{2,}/)
    .map(function(item) { return item.trim(); })
    .filter(Boolean);
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('模型网关未返回内容');
  try { return JSON.parse(raw); } catch(e) {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('模型网关返回内容不是 JSON');
}

function compactForPrompt(value, max) {
  const text = cleanText(value).replace(/\s+/g, ' ');
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function formatStyleSample(sample, index, perSampleLimit) {
  const title = cleanText(sample.title || '').slice(0, 60) || ('样本 ' + (index + 1));
  const content = compactForPrompt(sample.content || sample.text || '', perSampleLimit);
  return [
    '样本 ' + (index + 1) + '｜' + title,
    content
  ].filter(Boolean).join('\n');
}

function buildBalancedSampleCorpus(style) {
  const samples = Array.isArray(style.samples) ? style.samples.filter(function(sample) {
    return cleanText(sample && (sample.content || sample.text || '')).length > 0;
  }) : [];
  const picked = samples.slice(0, 16);
  const perSampleLimit = picked.length <= 6 ? 850 : (picked.length <= 10 ? 620 : 460);
  return picked.map(function(sample, index) {
    return formatStyleSample(sample, index, perSampleLimit);
  }).join('\n\n---\n\n');
}

function buildAnalyzePrompts(style) {
  const samples = buildBalancedSampleCorpus(style);
  const systemPrompt = '你是短视频账号风格分析师。请从多条爆款样本的共性里提炼可复用风格，不要被单条长样本带偏。只返回 JSON，不要 Markdown，不要解释。';
  const userPrompt = [
    '账号：' + (style.name || ''),
    '平台：' + (style.platform || ''),
    '内容类型：' + (style.contentType || ''),
    '场景：' + (style.scene || ''),
    '',
    '请基于下面的多条样本总结账号风格。每条样本都要参考，优先提炼 3 条以上样本共同出现的规律；单条样本里的偶发事件只能写进 sampleClues，不能当成整体风格。',
    '',
    '样本：',
    samples || '暂无样本',
    '',
    '输出 JSON，字段固定如下，字段值全部使用中文字符串：',
    '{',
    '  "positioning": "内容定位：这个账号主要讲什么、面向谁、靠什么价值吸引用户",',
    '  "topics": "常见选题/题材范围，分行列出",',
    '  "titleStyle": "标题或第一句话的常见处理方式",',
    '  "opening": "开头方式：如何制造继续看的理由",',
    '  "structure": "叙事结构：从钩子到展开再到结尾的顺序",',
    '  "tone": "语气、人设、情绪强度",',
    '  "rhythm": "句式与节奏：长短句、段落推进、信息密度",',
    '  "expressions": "常用话术/可复用表达，分行列出",',
    '  "banned": "写作禁忌：不能照搬、不能出现的表达问题，分行列出",',
    '  "sampleClues": "样本线索：列出 4-8 条样本共性或代表样本，必须覆盖多个样本，不要只写样本1"',
    '}'
  ].join('\n');
  return { systemPrompt: systemPrompt, userPrompt: userPrompt };
}

module.exports = function createAccountStyleRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const callModelText = deps.callModelText || deps.callOpenAIText;
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'account_styles.db');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const adapter = createSqliteAdapter({ dbPath: dbPath, logger: logger });
  function getDb() {
    return adapter.createDb();
  }

  const initDb = getDb();
  initDb.run(`CREATE TABLE IF NOT EXISTS account_style_state (
    id          TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    updated_at  INTEGER DEFAULT 0
  )`, function(err) {
    initDb.close();
  });

  function readLibrary(cb) {
    const db = getDb();
    db.get('SELECT payload, updated_at FROM account_style_state WHERE id=?', ['library'], function(err, row) {
      db.close();
      if (err) { cb({ error: err.message }); return; }
      if (!row) { cb({ styles: [], updatedAt: 0 }); return; }
      try {
        cb({ styles: JSON.parse(row.payload || '[]').map(normalizeStyle), updatedAt: row.updated_at || 0 });
      } catch(e) {
        cb({ error: '账号风格库数据损坏：' + e.message });
      }
    });
  }

  function saveLibrary(styles, cb) {
    if (!Array.isArray(styles)) {
      cb({ error: 'styles must be an array' });
      return;
    }
    const normalized = styles.map(normalizeStyle);
    const db = getDb();
    // Use INSERT OR REPLACE for compatibility
    db.run(
      `INSERT OR REPLACE INTO account_style_state (id,payload,updated_at)
       VALUES (?, ?, ?)`,
      ['library', JSON.stringify(normalized), Math.floor(Date.now() / 1000)],
      function(err) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        cb({ ok: true, count: normalized.length, styles: normalized });
      }
    );
  }

  function withLibrary(cb, done) {
    readLibrary(function(data) {
      if (data.error) { done(data); return; }
      const styles = Array.isArray(data.styles) ? data.styles : [];
      cb(styles, function(result) {
        if (result && result.error) { done(result); return; }
        saveLibrary(styles, function(saved) {
          if (saved.error) { done(saved); return; }
          done(Object.assign({ ok: true }, result || {}, { styles: saved.styles }));
        });
      });
    });
  }

  function findStyle(styles, id) {
    return styles.find(function(style) { return style.id === id; });
  }

  return {
    '/api/account-styles/list': function(body, cb) {
      readLibrary(cb);
    },

    '/api/account-styles/save': function(body, cb) {
      saveLibrary(body.styles, cb);
    },

    '/api/account-styles/create': function(body, cb) {
      withLibrary(function(styles, done) {
        const auth = body._auth || {};
        const style = normalizeStyle({
          id: body.id || makeId('style'),
          name: body.name,
          platform: body.platform || '抖音',
          contentType: body.contentType || '口播',
          scene: body.scene || '',
          status: '待分析',
          usedCount: 0,
          createdBy: Number(auth.id) || 0,
          createdByName: auth.display_name || auth.username || '',
          tags: [body.platform || '抖音', body.contentType || '口播'].concat(body.scene ? [body.scene] : []),
          samples: [],
          styleCard: makeStyleCard()
        });
        styles.unshift(style);
        done({ style: style });
      }, cb);
    },

    '/api/account-styles/update': function(body, cb) {
      withLibrary(function(styles, done) {
        const style = findStyle(styles, body.id);
        if (!style) { done({ error: '账号风格不存在' }); return; }
        ['name', 'platform', 'contentType', 'scene', 'status'].forEach(function(key) {
          if (body[key] !== undefined) style[key] = body[key];
        });
        if (Array.isArray(body.tags)) style.tags = body.tags;
        if (body.styleCard) style.styleCard = makeStyleCard(Object.assign({}, style.styleCard, body.styleCard));
        done({ style: style });
      }, cb);
    },

    '/api/account-styles/delete': function(body, cb) {
      withLibrary(function(styles, done) {
        const auth = body._auth || {};
        const current = findStyle(styles, body.id);
        if (!current) { done({ error: '账号风格不存在' }); return; }
        const isAdmin = auth.role === 'admin';
        const isLegacy = !current.createdBy;
        const isOwner = isLegacy || Number(current.createdBy) === Number(auth.id);
        const isDevNoAuth = !auth || !auth.id;
        if (!isAdmin && !isOwner && !isDevNoAuth) {
          done({ error: '只能删除自己创建的账号' });
          return;
        }
        const before = styles.length;
        for (let i = styles.length - 1; i >= 0; i--) {
          if (styles[i].id === body.id) styles.splice(i, 1);
        }
        done({ deleted: before - styles.length });
      }, cb);
    },

    '/api/account-styles/samples/add': function(body, cb) {
      withLibrary(function(styles, done) {
        const style = findStyle(styles, body.id || body.styleId);
        if (!style) { done({ error: '账号风格不存在' }); return; }
        const samples = splitSampleInput(body.samples !== undefined ? body.samples : body.content).map(makeSample);
        if (!samples.length) { done({ error: '没有可加入的样本文案' }); return; }
        style.samples = style.samples.concat(samples);
        style.status = '待分析';
        style.styleCard.confirmed = false;
        done({ style: style, added: samples.length });
      }, cb);
    },

    '/api/account-styles/samples/delete': function(body, cb) {
      withLibrary(function(styles, done) {
        const style = findStyle(styles, body.id || body.styleId);
        if (!style) { done({ error: '账号风格不存在' }); return; }
        const before = style.samples.length;
        style.samples = style.samples.filter(function(sample) { return sample.id !== body.sampleId; });
        style.status = '待分析';
        style.styleCard.confirmed = false;
        done({ style: style, deleted: before - style.samples.length });
      }, cb);
    },

    '/api/account-styles/analyze': function(body, cb) {
      if (!callModelText) { cb({ error: '模型网关 runtime is not available' }); return; }
      readLibrary(function(data) {
        if (data.error) { cb(data); return; }
        const styles = data.styles || [];
        const style = findStyle(styles, body.id || body.styleId);
        if (!style) { cb({ error: '账号风格不存在' }); return; }
        if (!style.samples.length) { cb({ error: '请先添加样本文案' }); return; }
        const prompts = buildAnalyzePrompts(style);
        callModelText(prompts.systemPrompt, prompts.userPrompt, {
          model: body.model || process.env.MODEL_STYLE_MODEL || process.env.OPENAI_STYLE_MODEL || 'gpt-5.5',
          timeoutMs: 180000
        }).then(function(raw) {
          let parsed;
          try { parsed = extractJsonObject(raw); }
          catch(e) { cb({ error: e.message }); return; }
          style.styleCard = makeStyleCard(parsed);
          style.status = '待确认';
          saveLibrary(styles, function(saved) {
            if (saved.error) { cb(saved); return; }
            cb({ ok: true, style: style, styleCard: style.styleCard, model: body.model || process.env.MODEL_STYLE_MODEL || process.env.OPENAI_STYLE_MODEL || 'gpt-5.5' });
          });
        }).catch(function(err) {
          cb({ error: err.message || '模型网关分析失败' });
        });
      });
    },

    '/api/account-styles/card/save': function(body, cb) {
      withLibrary(function(styles, done) {
        const style = findStyle(styles, body.id || body.styleId);
        if (!style) { done({ error: '账号风格不存在' }); return; }
        style.styleCard = makeStyleCard(Object.assign({}, style.styleCard, body.styleCard || {}));
        style.status = style.styleCard.confirmed ? '可用' : '待确认';
        done({ style: style, styleCard: style.styleCard });
      }, cb);
    },

    '/api/account-styles/confirm': function(body, cb) {
      withLibrary(function(styles, done) {
        const style = findStyle(styles, body.id || body.styleId);
        if (!style) { done({ error: '账号风格不存在' }); return; }
        if (body.styleCard) style.styleCard = makeStyleCard(Object.assign({}, style.styleCard, body.styleCard));
        style.styleCard.confirmed = true;
        style.status = '可用';
        done({ style: style, styleCard: style.styleCard });
      }, cb);
    },

    '/api/account-styles/usage/increment': function(body, cb) {
      withLibrary(function(styles, done) {
        const style = findStyle(styles, body.id || body.styleId);
        if (!style) { done({ error: '账号风格不存在' }); return; }
        style.usedCount = (Number(style.usedCount) || 0) + 1;
        done({ style: style, usedCount: style.usedCount });
      }, cb);
    }
  };
};
