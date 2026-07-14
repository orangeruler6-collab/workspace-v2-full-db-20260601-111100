const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('routes:agent');

function now() {
  return Math.floor(Date.now() / 1000);
}

function jobId(prefix) {
  return String(prefix || 'job') + '-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8);
}

function toPromise(route, body) {
  return new Promise(function(resolve) {
    try {
      route(body || {}, function(data) {
        resolve(data || {});
      });
    } catch (e) {
      resolve({ error: e.message || String(e) });
    }
  });
}

function clip(value, length) {
  const text = String(value || '').replace(/\r/g, '\n').trim();
  if (!length || text.length <= length) return text;
  return text.slice(0, length) + '\n...[已截断]';
}

const AGENT_COMPACT_MESSAGE_LIMIT = 18;
const AGENT_COMPACT_CHAR_LIMIT = 24000;
const AGENT_KEEP_RECENT_MESSAGES = 10;

function normalizeAgentImages(images) {
  return (Array.isArray(images) ? images : []).map(function(item) {
    if (item && typeof item === 'object') {
      const base64 = String(item.base64 || item.image_base64 || item.image || item.data || item.file_data || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim();
      return {
        base64: base64,
        mime: String(item.mime || item.type || 'image/jpeg').trim() || 'image/jpeg',
        name: String(item.name || item.filename || 'image').trim() || 'image',
        size: Number(item.size) || 0
      };
    }
    const raw = String(item || '').trim();
    const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    return {
      base64: match ? match[2].trim() : raw.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim(),
      mime: match ? match[1] : 'image/jpeg',
      name: 'image',
      size: 0
    };
  }).filter(function(item) { return item.base64; }).slice(0, 6);
}

function normalizeAgentMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map(function(item) {
    return {
      role: item && item.role === 'assistant' ? 'assistant' : 'user',
      content: String((item && (item.content || item.text)) || '').trim(),
      images: normalizeAgentImages(item && item.images)
    };
  }).filter(function(item) { return item.content; });
}

function agentMessagesLength(messages) {
  return normalizeAgentMessages(messages).reduce(function(total, item) {
    return total + item.content.length;
  }, 0);
}

function shouldCompactAgentMessages(messages) {
  const normalized = normalizeAgentMessages(messages);
  return normalized.length > AGENT_COMPACT_MESSAGE_LIMIT || agentMessagesLength(normalized) > AGENT_COMPACT_CHAR_LIMIT;
}

function buildAgentHistory(summary, messages) {
  const history = normalizeAgentMessages(messages);
  const cleanSummary = String(summary || '').trim();
  if (!cleanSummary) return history;
  return [{ role: 'user', content: '[已压缩的会话上下文]\n' + cleanSummary }].concat(history);
}

function latestAgentImageBase64(messages) {
  const normalized = normalizeAgentMessages(messages);
  for (let i = normalized.length - 1; i >= 0; i--) {
    const image = normalized[i].images && normalized[i].images[0];
    if (image) return String(image.base64 || image).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  }
  return '';
}

function normalizeAgentDocuments(documents) {
  return (Array.isArray(documents) ? documents : []).map(function(item) {
    const filename = String(item && (item.filename || item.file_name || item.name) || 'document').trim() || 'document';
    const fileData = String(item && (item.file_data || item.file_base64 || item.base64 || item.data) || '').trim();
    return {
      filename: filename,
      size: Number(item && item.size) || 0,
      mime: String(item && (item.mime || item.type) || ''),
      file_data: fileData
    };
  }).filter(function(item) { return item.file_data; }).slice(0, 4);
}

function extractLinks(text) {
  return String(text || '').match(/https?:\/\/[^\s，。；、)）]+/g) || [];
}

function includesAny(text, words) {
  const source = String(text || '').toLowerCase();
  return words.some(function(word) { return source.indexOf(String(word).toLowerCase()) >= 0; });
}

function wantsFeishuDocument(input) {
  const text = String(input || '').toLowerCase();
  return /(飞书|feishu|lark)/i.test(text) && /(文档|doc|docx|链接|给我|生成|写入|输出|发我|整理成|出一份|同步|保存|存|发到|发过去|发布|导出|新建|创建)/i.test(text);
}

function wantsOnlyFeishuSync(input) {
  const text = String(input || '').toLowerCase().replace(/\s+/g, '');
  if (!/(飞书|feishu|lark)/i.test(text)) return false;
  if (!/(同步|写入|输出|保存|存|发到|发过去|发布|导出|新建|创建|链接|给我)/i.test(text)) return false;
  return !/(写一篇|写个|生成一篇|生成个|出一篇|帮我写|文案内容|脚本|方案|周报|复盘|分析|总结|改成|润色|重写)/i.test(text);
}

function latestAssistantContent(messages) {
  const normalized = normalizeAgentMessages(messages);
  for (let i = normalized.length - 1; i >= 0; i--) {
    if (normalized[i].role === 'assistant') {
      const content = String(normalized[i].content || normalized[i].text || '').trim();
      if (content) return content;
    }
  }
  return '';
}

function wantsCodexDeepAnalysis(input) {
  const text = String(input || '').toLowerCase();
  return /(codex|深度|深入|完整|全面|仔细|复盘|分析|检查|诊断|为什么|怎么回事|周报|总结|报告|项目)/i.test(text)
    && /(深度|深入|完整|全面|仔细|复盘|分析|检查|诊断|为什么|怎么回事|周报|总结|报告|项目|codex)/i.test(text);
}

function compactIntentText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?;；:：]/g, '');
}

function detectGroupScope(input) {
  const text = compactIntentText(input);
  const groups = [
    { key: '内容一部', aliases: ['内容一部', '内容一组', '一部', '一组', '1组', '一组的', '一部的', '一组这边', '一部这边'] },
    { key: '内容二组', aliases: ['内容二组', '二组', '2组', '二组的', '二组这边'] },
    { key: '内容三组', aliases: ['内容三组', '三组', '3组', '三组的', '三组这边'] },
    { key: '内容四组', aliases: ['内容四组', '四组', '4组', '四组的', '四组这边'] },
    { key: '内容五组', aliases: ['内容五组', '五组', '5组', '五组的', '五组这边'] },
    { key: '内容六组', aliases: ['内容六组', '六组', '6组', '六组的', '六组这边'] },
    { key: 'MCN经纪组', aliases: ['MCN经纪组', '经济组', '经纪组', 'MCN经纪组这边'] }
  ];
  for (const group of groups) {
    if (group.aliases.some(function(alias) { return text.indexOf(alias) >= 0; })) return group.key;
  }
  return '';
}

function detectMonthScope(input) {
  const raw = String(input || '');
  const compact = compactIntentText(raw);
  const currentYear = new Date().getFullYear();
  const result = { year: 0, month: 0 };
  const normalYearMatch = raw.match(/(20\d{2})\s*年/);
  if (normalYearMatch) result.year = Number(normalYearMatch[1]) || 0;
  const normalNumericMonth = raw.match(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*月/);
  if (normalNumericMonth) result.month = Number(normalNumericMonth[1]) || 0;
  const normalChineseMonths = [
    ['十二月', 12], ['十一月', 11], ['十月', 10], ['九月', 9], ['八月', 8], ['七月', 7],
    ['六月', 6], ['五月', 5], ['四月', 4], ['三月', 3], ['二月', 2], ['一月', 1], ['正月', 1]
  ];
  if (!result.month) {
    for (const pair of normalChineseMonths) {
      if (raw.indexOf(pair[0]) >= 0) {
        result.month = pair[1];
        break;
      }
    }
  }
  if (!result.month && /(本月|这个月|当月)/.test(raw)) result.month = new Date().getMonth() + 1;
  if (!result.month && /(上月|上个月)/.test(raw)) result.month = new Date().getMonth() || 12;
  if (result.month && !result.year) {
    result.year = /(去年|上年|上一年)/.test(raw) ? currentYear - 1 : currentYear;
  }
  if (result.month) return result;
  const yearMatch = compact.match(/(20\d{2})年?/);
  if (yearMatch) result.year = Number(yearMatch[1]) || 0;
  const numericMonth = compact.match(/(?:^|[^\d])([1-9]|1[0-2])月/);
  if (numericMonth) result.month = Number(numericMonth[1]) || 0;
  const chineseMonths = [
    ['十二月', '12月'], ['十一月', '11月'], ['十月', '10月'], ['九月', '9月'],
    ['八月', '8月'], ['七月', '7月'], ['六月', '6月'], ['五月', '5月'],
    ['四月', '4月'], ['三月', '3月'], ['二月', '2月'], ['一月', '1月']
  ];
  if (!result.month) {
    for (let i = 0; i < chineseMonths.length; i += 1) {
      if (chineseMonths[i].some(function(alias) { return compact.indexOf(alias) >= 0; })) {
        result.month = 12 - i;
        break;
      }
    }
  }
  if (!result.month && /(本月|这个月|当月)/.test(compact)) result.month = new Date().getMonth() + 1;
  if (!result.month && /(上月|上个月)/.test(compact)) result.month = new Date().getMonth() || 12;
  if (result.month && !result.year) {
    result.year = /(去年|上年|上一年)/.test(compact) ? currentYear - 1 : currentYear;
  }
  return result.month ? result : null;
}

function asksForWorkSummary(input) {
  const text = compactIntentText(input);
  const timeLike = /(本周|这周|这星期|本星期|上周|上星期|周报|周会|近期|最近|本月|这个月|五月|5月|今天|昨天)/.test(text);
  const workLike = /(工作|情况|做得|做的|干得|干的|咋样|怎么样|如何|好不好|行不行|复盘|总结|进展|产出|表现|完成|计划|忙啥|做了啥|数据|成果|问题|风险|评价|看一下|看下|盘一下|盘一盘)/.test(text);
  return timeLike && workLike;
}

function asksForPlatformData(input) {
  const text = compactIntentText(input);
  return /(流水|营收|毛利|账号|涨粉|播放|发布|排期|工时|订单|商单|项目进展|产出|数据|表现|工作量|完成度)/.test(text);
}

function asksForDailyReport(input) {
  const text = compactIntentText(input);
  return /(日报|日结|今日汇总|当天汇总|今天汇总|每日汇报|生成日报|写日报)/.test(text);
}

function asksForImageGeneration(input) {
  const text = String(input || '').toLowerCase();
  return /(生图|出图|做图|生成图|生成一张图|画图|配图|封面|海报|插画|视觉图|小红书封面|头图|图生图|改图|重绘|扩图|image|cover|poster|illustration)/i.test(text);
}

function asksForImageEdit(input) {
  const text = String(input || '').toLowerCase();
  return /(图生图|改图|重绘|扩图|换风格|保持构图|image2image|i2i|edit image|(?:按|根据|参考)这张图(?:片)?[^，。！？\n]*(?:改|生成|做成|变成|换|重绘|扩|风格|封面|海报))/i.test(text);
}

function asksForImageUnderstanding(input) {
  const text = String(input || '').toLowerCase();
  return /(看图|识图|读图|图片理解|图片解读|分析图片|分析截图|截图|ocr|识别图片|图片内容|这张图|这张图片|画面|海报分析|视觉分析|image understanding|vision|describe image)/i.test(text);
}

function asksForPlatformSnapshot(input) {
  const text = String(input || '').toLowerCase();
  return /(全平台|整个平台|平台整体|全部功能|全部能力|所有能力|所有模块|网页能力|工具能力|大工厂|工厂|全局|总览|项目复盘|复盘|周报|周会|本周|上周|最近|整体情况|工作情况|数据情况|哪里出问题|风险|排查|诊断|总结|bf分析|bf 分析|运营情况|账号表现)/i.test(text);
}

function asksForOutlineWriting(input) {
  const text = String(input || '').toLowerCase();
  const compact = compactIntentText(text);
  return /(大纲|提纲|框架|内容方向|内容结构|outline)/i.test(text)
    && /(达人|发布平台|视频时长|第一部分|第二部分|第三部分|占比|商单|推广|brief|bf|kol|koc|抖音|b站|bilibili|口播|视频)/i.test(text + compact);
}

function asksForVideoAnalysis(input) {
  const text = String(input || '').toLowerCase();
  return /(视频打点|视频分析|分析视频|画面分析|抽帧|分镜|时间轴|剪辑点|切片点|高光点|镜头|素材文档|打点文档|视频素材整理|timeline|frame analysis)/i.test(text);
}

function detectTask(input, explicitType) {
  if (explicitType) return explicitType;
  const text = String(input || '');
  const compact = compactIntentText(text);
  const groupScope = detectGroupScope(text);
  const links = extractLinks(text);
  if (links.some(function(link) { return /douyin\.com|v\.douyin\.com/i.test(link); })) return 'transcribe_link';
  if (links.some(function(link) { return /bilibili\.com|b23\.tv/i.test(link); })) return 'transcribe_link';
  if (asksForOutlineWriting(text)) return 'outline_writing';
  if (links.some(function(link) { return /feishu\.cn|larksuite\.com/i.test(link); })) {
    if (/bf|brief|briefing|商单|品牌|客户|报价/i.test(text)) return 'bf_analysis';
    return 'read_feishu';
  }
  if (asksForImageUnderstanding(text) && !asksForImageEdit(text)) return 'research';
  if (asksForImageGeneration(text)) return 'image_generation';
  if (asksForDailyReport(text)) return 'daily_report';
  if (groupScope && (asksForWorkSummary(text) || asksForPlatformData(text) || /(周报|周会|怎么样|咋样|如何|好不好|行不行|评价|看看|看下|分析|汇总|生成|整理|盘一下|盘一盘)/.test(compact))) return 'weekly_report';
  if (/周报|周会/i.test(text)) return 'weekly_report';
  if (/本周|上周|这周|最近|本月|这个月/i.test(text) && (asksForWorkSummary(text) || asksForPlatformData(text))) return 'weekly_report';
  if (/复盘|问题|总结|项目/i.test(text)) return 'project_review';
  if (/bf|brief|商单|品牌|客户|推广|植入/i.test(text)) return 'bf_analysis';
  if (/查|搜索|资料|案例|向量库|素材|参考|找一下|有没有/i.test(text)) return 'research';
  return 'free_writing';
}

function previewIntent(input, explicitType) {
  const taskType = detectTask(input, explicitType);
  return {
    input: String(input || ''),
    task_type: taskType,
    group: detectGroupScope(input),
    work_summary: asksForWorkSummary(input),
    platform_data: asksForPlatformData(input),
    links: extractLinks(input)
  };
}

function toolMeta(id, label, moduleId, status, detail) {
  return { id: id, label: label, module: moduleId || '', status: status || 'pending', detail: detail || '' };
}

function createDraftStore(root) {
  const dataDir = path.join(root, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const adapter = createSqliteAdapter({ dbPath: path.join(dataDir, 'agent_drafts.db'), logger: logger });
  const db = adapter.createDb();

  function run(sql, params) {
    return new Promise(function(resolve, reject) {
      db.run(sql, params || [], function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function all(sql, params) {
    return new Promise(function(resolve, reject) {
      db.all(sql, params || [], function(err, rows) {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async function get(sql, params) {
    const rows = await all(sql, params || []);
    return rows[0] || null;
  }

  async function init() {
    await run(`CREATE TABLE IF NOT EXISTS agent_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 0,
      username TEXT DEFAULT '',
      task_type TEXT DEFAULT '',
      input TEXT DEFAULT '',
      tools TEXT DEFAULT '[]',
      sources TEXT DEFAULT '[]',
      output TEXT DEFAULT '',
      title TEXT DEFAULT '',
      feishu_url TEXT DEFAULT '',
      messages TEXT DEFAULT '[]',
      summary TEXT DEFAULT '',
      message_count INTEGER DEFAULT 0,
      last_compacted_at INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    await ensureColumn('agent_drafts', 'messages', "TEXT DEFAULT '[]'");
    await ensureColumn('agent_drafts', 'summary', "TEXT DEFAULT ''");
    await ensureColumn('agent_drafts', 'message_count', 'INTEGER DEFAULT 0');
    await ensureColumn('agent_drafts', 'last_compacted_at', 'INTEGER DEFAULT 0');
    await ensureColumn('agent_drafts', 'deleted_at', 'INTEGER DEFAULT 0');
  }

  async function ensureColumn(table, column, definition) {
    const rows = await all('PRAGMA table_info(' + table + ')');
    if (rows.some(function(row) { return row.name === column; })) return;
    await run('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
  }

  async function save(data) {
    await init();
    const ts = now();
    const result = await run(
      `INSERT INTO agent_drafts (user_id,username,task_type,input,tools,sources,output,title,feishu_url,messages,summary,message_count,last_compacted_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.user_id || 0,
        data.username || '',
        data.task_type || '',
        data.input || '',
        JSON.stringify(data.tools || []),
        JSON.stringify(data.sources || []),
        data.output || '',
        data.title || '',
        data.feishu_url || '',
        JSON.stringify(data.messages || []),
        data.summary || '',
        Number(data.message_count || (Array.isArray(data.messages) ? data.messages.length : 0)),
        Number(data.last_compacted_at || 0),
        ts,
        ts
      ]
    );
    return Object.assign({ id: result.lastID, created_at: ts, updated_at: ts }, data, {
      summary: data.summary || '',
      message_count: Number(data.message_count || (Array.isArray(data.messages) ? data.messages.length : 0)),
      last_compacted_at: Number(data.last_compacted_at || 0)
    });
  }

  async function list(user, limit) {
    await init();
    const params = [Number(user && user.id || 0)];
    const where = ' WHERE user_id=?';
    params.push(Math.max(1, Math.min(Number(limit) || 30, 100)));
    const rows = await all(
      `SELECT * FROM agent_drafts${where}${where ? ' AND' : ' WHERE'} COALESCE(deleted_at,0)=0 ORDER BY updated_at DESC, id DESC LIMIT ?`,
      params
    );
    return rows.map(function(row) {
      try { row.tools = JSON.parse(row.tools || '[]'); } catch(e) { row.tools = []; }
      try { row.sources = JSON.parse(row.sources || '[]'); } catch(e) { row.sources = []; }
      try { row.messages = JSON.parse(row.messages || '[]'); } catch(e) { row.messages = []; }
      return row;
    });
  }

  async function update(id, user, patch) {
    await init();
    const row = await getDraft(id, user);
    if (!row) return null;
    const fields = [];
    const params = [];
    ['title', 'task_type', 'input', 'output', 'feishu_url', 'summary'].forEach(function(key) {
      if (patch[key] !== undefined) {
        fields.push(key + '=?');
        params.push(patch[key] || '');
      }
    });
    ['message_count', 'last_compacted_at'].forEach(function(key) {
      if (patch[key] !== undefined) {
        fields.push(key + '=?');
        params.push(Number(patch[key] || 0));
      }
    });
    ['tools', 'sources', 'messages'].forEach(function(key) {
      if (patch[key] !== undefined) {
        fields.push(key + '=?');
        params.push(JSON.stringify(patch[key] || []));
      }
    });
    if (!fields.length) return row;
    fields.push('updated_at=?');
    params.push(now());
    params.push(Number(id));
    params.push(Number(user && user.id || 0));
    await run('UPDATE agent_drafts SET ' + fields.join(',') + ' WHERE id=? AND user_id=?', params);
    return getDraft(id, user);
  }

  async function remove(id, user) {
    await init();
    const row = await getDraft(id, user);
    if (!row) return false;
    await run('UPDATE agent_drafts SET deleted_at=?, updated_at=? WHERE id=? AND user_id=?', [now(), now(), Number(id), Number(user && user.id || 0)]);
    return true;
  }

  async function getDraft(id, user) {
    await init();
    const params = [Number(id)];
    let where = 'WHERE id=? AND COALESCE(deleted_at,0)=0';
    where += ' AND user_id=?';
    params.push(Number(user && user.id || 0));
    const rows = await all('SELECT * FROM agent_drafts ' + where + ' LIMIT 1', params);
    const row = rows[0];
    if (!row) return null;
    try { row.tools = JSON.parse(row.tools || '[]'); } catch(e) { row.tools = []; }
    try { row.sources = JSON.parse(row.sources || '[]'); } catch(e) { row.sources = []; }
    try { row.messages = JSON.parse(row.messages || '[]'); } catch(e) { row.messages = []; }
    return row;
  }

  return { init: init, save: save, list: list, update: update, remove: remove, get: getDraft };
}

function createWeeklyReportStore(root) {
  const dataDir = path.join(root, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const adapter = createSqliteAdapter({ dbPath: path.join(dataDir, 'weekly_reports.db'), logger: logger });
  const db = adapter.createDb();

  function run(sql, params) {
    return new Promise(function(resolve, reject) {
      db.run(sql, params || [], function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function all(sql, params) {
    return new Promise(function(resolve, reject) {
      db.all(sql, params || [], function(err, rows) {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async function init() {
    await run(`CREATE TABLE IF NOT EXISTS weekly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT DEFAULT '',
      leader_name TEXT DEFAULT '',
      range_start TEXT DEFAULT '',
      range_end TEXT DEFAULT '',
      title TEXT DEFAULT '',
      status TEXT DEFAULT 'done',
      report_json TEXT DEFAULT '{}',
      text TEXT DEFAULT '',
      html TEXT DEFAULT '',
      word_path TEXT DEFAULT '',
      word_url TEXT DEFAULT '',
      feishu_url TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      created_by_name TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }

  function parseRow(row) {
    if (!row) return null;
    try { row.report = JSON.parse(row.report_json || '{}'); } catch (e) { row.report = {}; }
    delete row.report_json;
    return row;
  }

  async function save(data) {
    await init();
    const ts = now();
    const result = await run(
      `INSERT INTO weekly_reports (group_name,leader_name,range_start,range_end,title,status,report_json,text,html,word_path,word_url,feishu_url,created_by,created_by_name,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.group_name || '',
        data.leader_name || '',
        data.range_start || '',
        data.range_end || '',
        data.title || '',
        data.status || 'done',
        JSON.stringify(data.report || {}),
        data.text || '',
        data.html || '',
        data.word_path || '',
        data.word_url || '',
        data.feishu_url || '',
        data.created_by || 0,
        data.created_by_name || '',
        ts,
        ts
      ]
    );
    return Object.assign({ id: result.lastID, created_at: ts, updated_at: ts }, data);
  }

  async function list(limit) {
    await init();
    const rows = await all(
      'SELECT * FROM weekly_reports ORDER BY created_at DESC, id DESC LIMIT ?',
      [Math.max(1, Math.min(Number(limit) || 30, 100))]
    );
    return rows.map(parseRow);
  }

  async function get(id) {
    await init();
    const rows = await all('SELECT * FROM weekly_reports WHERE id=? LIMIT 1', [Number(id)]);
    return parseRow(rows[0] || null);
  }

  return { init: init, save: save, list: list, get: get };
}

function createDailyReportStore(root) {
  const dataDir = path.join(root, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const adapter = createSqliteAdapter({ dbPath: path.join(dataDir, 'daily_reports.db'), logger: logger });
  const db = adapter.createDb();

  function run(sql, params) {
    return new Promise(function(resolve, reject) {
      db.run(sql, params || [], function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  async function init() {
    await run(`CREATE TABLE IF NOT EXISTS daily_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT DEFAULT '',
      report_date TEXT DEFAULT '',
      data_date TEXT DEFAULT '',
      title TEXT DEFAULT '',
      draft_json TEXT DEFAULT '{}',
      text TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      created_by_name TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }

  async function save(data) {
    await init();
    const ts = now();
    const result = await run(
      `INSERT INTO daily_reports (group_name,report_date,data_date,title,draft_json,text,image_url,created_by,created_by_name,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.group_name || '',
        data.report_date || '',
        data.data_date || '',
        data.title || '',
        JSON.stringify(data.draft || {}),
        data.text || '',
        data.image_url || '',
        data.created_by || 0,
        data.created_by_name || '',
        ts,
        ts
      ]
    );
    return Object.assign({ id: result.lastID, created_at: ts, updated_at: ts }, data);
  }

  return { init: init, save: save };
}

module.exports = function createAgentRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const routes = deps.routes || {};
  const authStore = deps.authStore;
  const draftStore = createDraftStore(root);
  const weeklyStore = createWeeklyReportStore(root);
  const dailyStore = createDailyReportStore(root);
  const callOpenAICompatible = deps.callOpenAICompatible;
  const callOpenAICompatibleStream = deps.callOpenAICompatibleStream;
  const callModelText = deps.callModelText;
  const siliconflowApiKey = deps.siliconflowApiKey || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '';
  const codexCommand = process.env.CODEX_BIN || (process.platform === 'win32' ? 'codex.cmd' : 'codex');
  const weeklyReportJobs = new Map();

  function callSiliconFlow(messages, options) {
    options = options || {};
    return new Promise(function(resolve, reject) {
      if (!siliconflowApiKey) {
        reject(new Error('SILICONFLOW_API_KEY is not configured'));
        return;
      }
      const payload = JSON.stringify({
        model: options.model || process.env.AGENT_SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V3',
        messages: messages,
        temperature: options.temperature === undefined ? 0.55 : options.temperature,
        ...(options.maxTokens || options.max_tokens ? { max_tokens: options.maxTokens || options.max_tokens } : {})
      });
      const req = https.request({
        hostname: 'api.siliconflow.cn',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': 'Bearer ' + siliconflowApiKey
        }
      }, function(res) {
        let data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error('SiliconFlow HTTP ' + res.statusCode + ': ' + data.slice(0, 200)));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const message = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
            resolve(String(message && message.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim());
          } catch (e) {
            reject(new Error('SiliconFlow JSON parse error: ' + e.message));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(options.timeoutMs || 120000, function() {
        req.destroy(new Error('SiliconFlow request timeout'));
      });
      req.write(payload);
      req.end();
    });
  }

  function openCliBin() {
    const preferred = process.env.OPENCLI_BIN || process.env.USAGI_OPENCLI_PATH || path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencli.cmd');
    if (preferred && fs.existsSync(preferred)) return preferred;
    return process.platform === 'win32' ? 'opencli.cmd' : 'opencli';
  }

  function runCommand(command, args, options) {
    return new Promise(function(resolve) {
      const useCmd = process.platform === 'win32' && /\.cmd$/i.test(command);
      const spawnCommand = useCmd ? (process.env.ComSpec || 'cmd.exe') : command;
      const spawnArgs = useCmd ? ['/d', '/s', '/c', command].concat(args || []) : (args || []);
      const proc = spawn(spawnCommand, spawnArgs, {
        cwd: root,
        windowsHide: true
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(function() {
        try { proc.kill(); } catch (e) {}
        resolve({ ok: false, code: -1, stdout: stdout, stderr: stderr + '\ntimeout' });
      }, options && options.timeout || 30000);
      proc.stdout.on('data', function(chunk) { stdout += chunk.toString('utf8'); });
      proc.stderr.on('data', function(chunk) { stderr += chunk.toString('utf8'); });
      proc.on('error', function(err) {
        clearTimeout(timer);
        resolve({ ok: false, code: -1, stdout: stdout, stderr: err.message });
      });
      proc.on('close', function(code) {
        clearTimeout(timer);
        resolve({ ok: code === 0, code: code, stdout: stdout, stderr: stderr });
      });
    });
  }

  function parseJsonLoose(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {}
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(raw.slice(first, last + 1)); } catch (e) {}
    }
    return null;
  }

  function stripText(value) {
    return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  function toNumber(value) {
    const text = String(value || '').replace(/,/g, '').trim();
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return 0;
    const n = Number(match[0]) || 0;
    if (/万/.test(text)) return Math.round(n * 10000);
    if (/亿/.test(text)) return Math.round(n * 100000000);
    return Math.round(n);
  }

  function safeDocFileName(value) {
    return String(value || 'weekly-report')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 90);
  }

  function absolutePublicUrl(relativeUrl, req) {
    const rel = String(relativeUrl || '').trim();
    if (!rel) return '';
    if (/^https?:\/\//i.test(rel)) return rel;
    const headers = req && req.headers || {};
    const host = String(headers['x-forwarded-host'] || headers.host || ('127.0.0.1:' + (process.env.PORT || '5555')))
      .split(',')[0]
      .trim();
    let proto = String(headers['x-forwarded-proto'] || 'http')
      .split(',')[0]
      .trim() || 'http';
    if (/^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/i.test(host)) proto = 'http';
    const pathText = rel.charAt(0) === '/' ? rel : ('/' + rel);
    return proto + '://' + host + pathText;
  }

  function relativeUploadUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.indexOf('/uploads/') === 0) return raw;
    try {
      const parsed = new URL(raw);
      return parsed.pathname.indexOf('/uploads/') === 0 ? parsed.pathname + parsed.search : '';
    } catch (e) {
      return '';
    }
  }

  function htmlEscape(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function xmlEscape(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function normalizeWeeklyLines(value) {
    return String(value || '')
      .split(/\r?\n|[;；]/)
      .map(function(line) { return line.trim(); })
      .filter(Boolean);
  }

  function parseAccountLines(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map(function(line) { return line.trim(); })
      .filter(Boolean)
      .map(function(line) {
        const url = (line.match(/https?:\/\/\S+/) || [''])[0].replace(/[，。；;]+$/g, '');
        const name = stripText(line.replace(url, '').replace(/[|｜,，]/g, ' '));
        return { name: name || url || '未命名账号', url: url, platform: /bilibili|b23\.tv/i.test(url) ? 'B站' : '抖音' };
      });
  }

  const WEEKLY_GROUPS = {
    '内容一部': {
      leader: '薛荐轩',
      members: ['薛荐轩', '廖李星', '高明镇', '林孝添', '叶子健', '许国锬', '许树杰', '林语婷', '许梦婷'],
      revenueRows: ['最游话说', '薛定谔的机', '李野王SG', '游电工厂', '硬件侠', '情风师兄', '上官北丶', '王路飞CP'],
      accounts: ['最游话说', '薛定谔的机', '李野王SG', '游电工厂', '硬件侠', '情风师兄', '上官北丶', '王路飞CP']
    },
    '内容二组': {
      leader: '傅思敏',
      members: ['傅思敏', '赵良杰', '陈乐恒', '吴恒', '李扬林', '施律彬', '罗晓棋'],
      revenueRows: ['报告砖家', '痞仔伯爵', '暴走星号键', '雷鸭Fist', '网瘾少女一条', '沙雕101', '钱包收益', '代做'],
      accounts: ['痞仔伯爵', '暴走星号键', '雷鸭Fist', '报告砖家', '沙雕101', '网瘾少女一条']
    },
    '内容三组': {
      leader: '陈鸿睿',
      members: ['曹媛', '陈泓睿', '林文涛', '刘佳琳', '肖子璇'],
      revenueRows: ['策划克星阿强', '中二探长', '团子好贵', '灵梦小师妹', '跑腿的包子', '饭十七', '皮皮说游戏'],
      accounts: ['策划克星阿强', '中二探长', '团子好贵', '灵梦小师妹', '跑腿的包子', '饭十七', '皮皮说游戏']
    },
    '内容四组': {
      leader: '陈健伊',
      members: ['姚希', '陈健伊', '宋丽佳', '林宇辰'],
      revenueRows: ['天机妹', '花蛮楼', '麦小雯', '夏天丶Cat', '有事找学姐', '小张同学', '素材'],
      accounts: ['天机妹', '花蛮楼', '麦小雯', '夏天丶Cat', '有事找学姐', '小张同学']
    },
    '内容五组': {
      leader: '杨鸿霆',
      members: ['朱信宇', '林心语', '商光涵', '杨鸿霆', '吴楷煌'],
      revenueRows: ['游小妹', '游热娃子', '超玩教授', 'Lee小强', '木游话说', '麦冬冬'],
      accounts: ['游小妹', '游热娃子', '超玩教授', 'Lee小强', '木游话说', '麦冬冬']
    },
    '内容六组': {
      leader: '刘登魁',
      members: ['张莹珊', '刘思嫚', '吴皓轩', '邓姝', '叶进生', '叶颖', '刘登魁'],
      revenueRows: ['花无缺', '葵仔不想肝', '游戏永动机', '畅玩百晓生'],
      accounts: ['花无缺', '葵仔不想肝', '游戏永动机', '畅玩百晓生']
    },
    'MCN经纪组': {
      leader: '',
      members: ['张家豪', '钟文祯', '龙星羽', '吴羿玄'],
      revenueRows: ['素材'],
      accounts: ['素材']
    }
  };

  const WEEKLY_ACCOUNT_NAME_ALIASES = [
    { canonical: '木游话说', aliases: ['尼大木'] },
    { canonical: '策划克星阿强', aliases: ['苏大强'] },
    { canonical: '最游话说', aliases: ['最翁Damnnn', '最翁damn', '最翁说游'] },
    { canonical: '畅玩百晓生', aliases: ['畅玩白晓生'] },
    { canonical: '王路飞CP', aliases: ['王路飞cp'] },
    { canonical: '麦小雯', aliases: ['麦晓花'] }
  ];

  let weeklyUpdatePlanCache = { mtimeMs: 0, rows: [] };
  let weeklyDashboardCache = { mtimeMs: 0, accounts: [] };
  let weeklyDashboardWorksCache = { mtimeMs: 0, works: [] };

  function readWeeklyUpdatePlanRows() {
    const file = path.join(root, 'src', 'modules', 'account-data', 'updatePlan.js');
    try {
      const stat = fs.statSync(file);
      if (weeklyUpdatePlanCache.mtimeMs === stat.mtimeMs) return weeklyUpdatePlanCache.rows;
      const source = fs.readFileSync(file, 'utf8');
      const rows = Array.from(source.matchAll(/\{\s*"groupName"[\s\S]*?\n\s*\}/g)).map(function(match) {
        try { return JSON.parse(match[0]); } catch (e) { return null; }
      }).filter(Boolean);
      weeklyUpdatePlanCache = { mtimeMs: stat.mtimeMs, rows: rows };
      return rows;
    } catch (e) {
      return weeklyUpdatePlanCache.rows;
    }
  }

  function readWeeklyDashboardAccounts() {
    const file = path.join(root, 'data', 'account-data-dashboard-snapshot.json');
    try {
      const stat = fs.statSync(file);
      if (weeklyDashboardCache.mtimeMs === stat.mtimeMs) return weeklyDashboardCache.accounts;
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      const accounts = payload && payload.dashboard && Array.isArray(payload.dashboard.accounts)
        ? payload.dashboard.accounts
        : [];
      weeklyDashboardCache = { mtimeMs: stat.mtimeMs, accounts: accounts };
      return accounts;
    } catch (e) {
      return weeklyDashboardCache.accounts;
    }
  }

  function readWeeklyDashboardWorks() {
    const file = path.join(root, 'data', 'account-data-dashboard-snapshot.json');
    try {
      const stat = fs.statSync(file);
      if (weeklyDashboardWorksCache.mtimeMs === stat.mtimeMs) return weeklyDashboardWorksCache.works;
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      const works = payload && payload.dashboard && Array.isArray(payload.dashboard.works)
        ? payload.dashboard.works
        : [];
      weeklyDashboardWorksCache = { mtimeMs: stat.mtimeMs, works: works };
      return works;
    } catch (e) {
      return weeklyDashboardWorksCache.works;
    }
  }

  function weeklyPlanRowsForAccount(accountName) {
    const canonical = normalizeAccountNameForProfit(canonicalWeeklyAccountName(accountName));
    return readWeeklyUpdatePlanRows().filter(function(row) {
      return normalizeAccountNameForProfit(canonicalWeeklyAccountName(row && row.account)) === canonical;
    });
  }

  function weeklyPlanForAccount(accountName, platformLabel) {
    const rows = weeklyPlanRowsForAccount(accountName);
    const platform = platformLabel === 'B站' ? 'bilibili' : (platformLabel === '抖音' ? 'douyin' : '');
    const exact = platform ? rows.filter(function(row) { return row.platform === platform; }) : [];
    const candidates = exact.length ? exact : rows;
    if (!candidates.length) return { monthlyTarget: 0, platform: platform || '' };
    return {
      monthlyTarget: candidates.reduce(function(max, row) {
        return Math.max(max, Number(row.monthlyTotal || row.monthlyTarget || 0));
      }, 0),
      platform: candidates[0].platform || platform || ''
    };
  }

  function weeklyDashboardMetric(accountName, platformLabel) {
    const canonical = normalizeAccountNameForProfit(canonicalWeeklyAccountName(accountName));
    const platform = platformLabel === 'B站' ? 'bilibili' : (platformLabel === '抖音' ? 'douyin' : '');
    const candidates = readWeeklyDashboardAccounts().filter(function(item) {
      const itemAccount = normalizeAccountNameForProfit(canonicalWeeklyAccountName(item && item.account));
      return itemAccount === canonical && (!platform || item.platform === platform);
    }).sort(function(a, b) {
      return String(b.lastCollectedAt || '').localeCompare(String(a.lastCollectedAt || ''));
    });
    const item = candidates[0];
    if (!item) return null;
    const fanTrend = Array.isArray(item.fanTrend) ? item.fanTrend.map(Number).filter(Number.isFinite) : [];
    const sevenDayFans = fanTrend.length >= 2 ? fanTrend[fanTrend.length - 1] - fanTrend[0] : null;
    return {
      followers: Number(item.followers || 0),
      seven_day_fans: sevenDayFans,
      month_posts: Number(item.metricsByRange && item.metricsByRange.month && item.metricsByRange.month.posts || 0),
      collected_at: item.lastCollectedAt || item.generatedAt || '',
      platform: item.platform || platform || ''
    };
  }

  function weeklyWorksFor(report, accountName) {
    if (/素材|代做/.test(String(accountName || ''))) return [];
    const canonical = normalizeAccountNameForProfit(canonicalWeeklyAccountName(accountName));
    const platformLabel = weeklyPlatformFor(accountName);
    const platform = platformLabel === 'B站' ? 'bilibili' : 'douyin';
    const range = report && report.range || {};
    const unique = new Map();
    readWeeklyDashboardWorks().forEach(function(item) {
      const itemAccount = normalizeAccountNameForProfit(canonicalWeeklyAccountName(item && item.account));
      if (itemAccount !== canonical || item.platform !== platform) return;
      if (!inDateRange(item.publishDate || item.publishAt, range.start, range.end)) return;
      if (item.publishVolumeExcluded) return;
      const key = String(item.id || item.title || item.publishAt || '');
      const previous = unique.get(key);
      if (!previous || String(item.collectedAt || '') > String(previous.collectedAt || '')) unique.set(key, item);
    });
    return Array.from(unique.values());
  }

  function weeklyWorkType(item) {
    const text = [item && item.contentType, item && item.businessKind, item && item.businessSource, item && item.businessReason]
      .map(function(value) { return String(value || ''); })
      .join(' ');
    return /商单|商业|推广|合作|广告|植入|星广|CPM/i.test(text) ? 'commercial' : 'daily';
  }

  function weeklyWorksStatsFor(report, accountName) {
    const works = weeklyWorksFor(report, accountName);
    const commercial = works.filter(function(item) { return weeklyWorkType(item) === 'commercial'; });
    const daily = works.filter(function(item) { return weeklyWorkType(item) === 'daily'; });
    const hotDaily = daily.filter(function(item) {
      return Number(item.views || 0) >= 100000 || Number(item.likes || 0) >= 10000 || /S级|爆款/.test(String(item.level || ''));
    }).sort(function(a, b) {
      return Number(b.views || 0) - Number(a.views || 0) || Number(b.likes || 0) - Number(a.likes || 0);
    });
    return {
      works: works,
      total: works.length,
      commercial: commercial.length,
      daily: daily.length,
      hotDaily: hotDaily,
      topDaily: hotDaily[0] || daily.slice().sort(function(a, b) { return Number(b.views || 0) - Number(a.views || 0); })[0] || null
    };
  }

  function weeklyWorkTopicLabel(item) {
    const title = String(item && item.title || '').trim();
    if (/未成年|防沉迷/.test(title)) return '未成年人防沉迷内容';
    const clean = title.split('#')[0].replace(/[？?！!。；;，,]+$/g, '').trim();
    if (!clean) return '高表现内容';
    return clean.length > 20 ? clean.slice(0, 20) + '…' : clean;
  }

  function normalizeWeeklyGroup(value) {
    const text = String(value || '').trim();
    if (WEEKLY_GROUPS[text]) return text;
    const compact = text.replace(/\s+/g, '');
    const aliases = {
      '一部': '内容一部',
      '内容一组': '内容一部',
      '一组': '内容一部',
      '1组': '内容一部',
      '内容1组': '内容一部',
      '二组': '内容二组',
      '2组': '内容二组',
      '内容2组': '内容二组',
      '三组': '内容三组',
      '3组': '内容三组',
      '内容3组': '内容三组',
      '四组': '内容四组',
      '4组': '内容四组',
      '内容4组': '内容四组',
      '五组': '内容五组',
      '5组': '内容五组',
      '内容5组': '内容五组',
      '六组': '内容六组',
      '6组': '内容六组',
      '内容6组': '内容六组',
      'MCN经纪组': 'MCN经纪组',
      '经济组': 'MCN经纪组',
      '经纪组': 'MCN经纪组'
    };
    return aliases[compact] || '内容二组';
  }

  function weeklyPlatformFor(name) {
    if (/素材|代做/.test(String(name || ''))) return '代做';
    const bilibili = new Set(['痞仔伯爵', '暴走星号键', '雷鸭Fist']);
    if (bilibili.has(String(name || '').trim())) return 'B站';
    const planned = weeklyPlanRowsForAccount(name);
    const platforms = Array.from(new Set(planned.map(function(row) { return row.platform; }).filter(Boolean)));
    if (platforms.length === 1) return platforms[0] === 'bilibili' ? 'B站' : '抖音';
    return '抖音';
  }

  function weeklyRowsForGroup(groupName) {
    const group = WEEKLY_GROUPS[normalizeWeeklyGroup(groupName)] || WEEKLY_GROUPS['内容二组'];
    return {
      leader: group.leader,
      members: group.members.slice(),
      revenueRows: group.revenueRows.map(function(name) { return [name, weeklyPlatformFor(name)]; }),
      accountRows: group.accounts.map(function(name) { return [name, weeklyPlatformFor(name)]; }),
      accountDataRows: group.accounts.concat(['素材代做']).map(function(name) { return [name, weeklyPlatformFor(name)]; })
    };
  }

  function weeklyAccountNamesForGroup(groupName) {
    const rows = weeklyRowsForGroup(groupName);
    const names = new Set();
    rows.revenueRows.concat(rows.accountRows).forEach(function(row) {
      if (!row || !row[0]) return;
      weeklyAccountAliasNames(row[0]).forEach(function(name) { names.add(name); });
    });
    return Array.from(names);
  }

  function weeklyAccountAliasNames(value) {
    const rule = findWeeklyAccountAliasRule(value);
    return rule ? [rule.canonical].concat(rule.aliases || []) : [value];
  }

  function findWeeklyAccountAliasRule(value) {
    const key = normalizeAccountNameForProfit(value);
    if (!key) return null;
    return WEEKLY_ACCOUNT_NAME_ALIASES.find(function(rule) {
      return [rule.canonical].concat(rule.aliases || []).some(function(name) {
        const aliasKey = normalizeAccountNameForProfit(name);
        return aliasKey && (key === aliasKey || key.indexOf(aliasKey) >= 0 || aliasKey.indexOf(key) >= 0);
      });
    }) || null;
  }

  function canonicalWeeklyAccountName(value) {
    const text = String(value || '').trim();
    const rule = findWeeklyAccountAliasRule(text);
    return rule ? rule.canonical : text;
  }

  function profitRowMatchesWeeklyGroup(row, groupName) {
    const target = normalizeWeeklyGroup(groupName);
    const fields = [
      row && row.grp,
      row && row.group,
      row && row.group_name,
      row && row.groupName
    ];
    return fields.some(function(value) {
      return value && normalizeWeeklyGroup(value) === target;
    });
  }

  function filterWeeklyProfitRows(rows, groupName) {
    const allowed = weeklyAccountNamesForGroup(groupName)
      .map(canonicalWeeklyAccountName)
      .map(normalizeAccountNameForProfit)
      .filter(Boolean);
    if (!allowed.length) return rows || [];
    return (rows || []).filter(function(row) {
      if (profitRowMatchesWeeklyGroup(row, groupName)) return true;
      const account = normalizeAccountNameForProfit(canonicalWeeklyAccountName(row && (row.account || row.account_name || row.name)));
      if (!account) return false;
      return allowed.some(function(name) {
        return account === name || account.indexOf(name) >= 0 || name.indexOf(account) >= 0;
      });
    });
  }

  function groupFromAuthUser(auth) {
    const authGroup = auth && (auth.group_name || auth.groupName || auth.group || auth.department || auth.team) || '';
    if (authGroup) return normalizeWeeklyGroup(authGroup);
    const name = String(auth && (auth.real_name || auth.display_name || auth.username) || '').trim();
    if (!name) return '';
    const entry = Object.entries(WEEKLY_GROUPS).find(function(item) {
      return (item[1].members || []).indexOf(name) >= 0;
    });
    return entry ? entry[0] : '';
  }

  function estimateFollowerDelta(name) {
    const big = new Set(['痞仔伯爵', '暴走星号键', '雷鸭Fist', '天机妹', '最游话说', '花无缺', '不玩就分手']);
    const medium = new Set(['报告砖家', '沙雕101', '灵梦小师妹', '网瘾少女一条', '麦小雯', '花蛮楼', '有事找学姐', '策划克星阿强', '饭十七', '游小妹', '游热娃子', '超玩教授']);
    const clean = String(name || '').trim();
    if (big.has(clean)) return '-3';
    if (medium.has(clean)) return '-0.1';
    return '0';
  }

  function weeklyAccountDefaults(groupName) {
    return weeklyRowsForGroup(groupName).accountDataRows.map(function(row) {
      return {
        name: row[0],
        platform: row[1],
        fans_delta: '0',
        status: 'estimated'
      };
    });
  }

  function weekRange(offsetWeeks) {
    const offset = Number(offsetWeeks || 0);
    const today = new Date();
    const day = today.getDay() || 7;
    const monday = new Date(today);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(today.getDate() - day + 1 + offset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    function fmt(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    return { start: fmt(monday), end: fmt(sunday) };
  }

  function inDateRange(dateText, start, end) {
    const text = String(dateText || '').slice(0, 10);
    if (!text) return false;
    return text >= start && text <= end;
  }

  async function routeData(routePath, body) {
    const route = routes[routePath];
    if (!route) return { error: 'route not found: ' + routePath };
    return toPromise(route, body || {});
  }

  function pickRows(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.records || data.items || data.rows || data.list || data.data || data.tasks || [];
  }

  function sumField(rows, names) {
    return rows.reduce(function(total, row) {
      for (const name of names) {
        if (row && row[name] !== undefined && row[name] !== null && row[name] !== '') return total + (Number(row[name]) || 0);
      }
      return total;
    }, 0);
  }

  function numberField(row, names) {
    for (const name of names) {
      if (row && row[name] !== undefined && row[name] !== null && row[name] !== '') return Number(row[name]) || 0;
    }
    return 0;
  }

  function firstPositiveField(row, names) {
    for (const name of names) {
      if (!row || row[name] === undefined || row[name] === null || row[name] === '') continue;
      const num = Number(String(row[name]).replace(/,/g, '')) || 0;
      if (num) return num;
    }
    return 0;
  }

  const WEEKLY_GROUP_TARGETS = {
    '内容四组': 100200
  };

  function amountFromText(value, labels) {
    const text = String(value || '').replace(/,/g, '');
    if (!text) return 0;
    for (const label of labels) {
      const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped + '\\s*[：:=]?\\s*[¥￥]?\\s*(\\d+(?:\\.\\d+)?)', 'i');
      const match = text.match(re);
      if (match) return Number(match[1]) || 0;
    }
    return 0;
  }

  function targetMarginField(row) {
    const direct = numberField(row, [
      'target_margin',
      'targetMargin',
      'margin_target',
      'target_profit',
      'targetProfit',
      '目标毛利',
      '毛利目标'
    ]);
    if (direct) return direct;
    return amountFromText([
      row && row.remark,
      row && row.note,
      row && row.project,
      row && row.category
    ].filter(Boolean).join(' '), ['目标毛利', '毛利目标']);
  }

  function normalizeAccountNameForProfit(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s·丶_\-—]+/g, '');
  }

  function matchProfitRowAccount(row, accountName) {
    const a = normalizeAccountNameForProfit(canonicalWeeklyAccountName(row && (row.account || row.account_name || row.name || row['账号昵称'])));
    const b = normalizeAccountNameForProfit(canonicalWeeklyAccountName(accountName));
    return a && b && (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0);
  }

  function formatWeeklyRate(value) {
    const n = Number(value) || 0;
    const rounded = Math.round(n * 10) / 10;
    return (Number.isInteger(rounded) ? String(rounded) : String(rounded)) + '%';
  }

  function formatWeeklySignedRate(value) {
    if (value === null || value === undefined || value === '') return '\u5f85\u8865';
    const n = Number(value);
    if (!Number.isFinite(n)) return '\u5f85\u8865';
    const rounded = Math.round(n * 10) / 10;
    return (rounded >= 0 ? '+' : '') + (Number.isInteger(rounded) ? String(rounded) : String(rounded)) + '%';
  }

  function monthLabelFromRange(range) {
    const raw = String((range && range.start) || '');
    const match = raw.match(/^\d{4}-(\d{1,2})-/);
    return match ? Number(match[1]) + '月' : '';
  }

  function monthPartsFromRange(range) {
    const raw = String((range && range.start) || '');
    const match = raw.match(/^(\d{4})-(\d{1,2})-/);
    return match ? { year: Number(match[1]) || 0, month: Number(match[2]) || 0 } : { year: 0, month: 0 };
  }

  function currentMonthParts(payload) {
    const explicitYear = Number(payload && (payload.year || payload.reportYear || payload.report_year) || 0);
    const explicitMonth = Number(payload && (payload.month || payload.reportMonth || payload.report_month) || 0);
    if (explicitYear && explicitMonth) return { year: explicitYear, month: explicitMonth };
    const nowDate = new Date();
    return { year: nowDate.getFullYear(), month: nowDate.getMonth() + 1 };
  }

  function monthLabelFromParts(parts) {
    const month = Number(parts && parts.month || 0);
    return month ? month + '\u6708' : '';
  }

  function sameProfitMonth(row, monthLabel) {
    if (!monthLabel) return true;
    const month = String(row && (row.month || row.schedule || row.档期 || '') || '').replace(/\s+/g, '');
    return month === monthLabel || month.indexOf(monthLabel) >= 0;
  }

  function formatWeeklyNumber(value) {
    const n = Number(value) || 0;
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  function formatWeeklyWan(value) {
    return formatWeeklyNumber((Number(value) || 0) / 10000);
  }

  function formatWeeklyCount(value) {
    const n = Number(value) || 0;
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  function formatWeeklyWorkMetric(value) {
    const n = Number(value) || 0;
    if (n < 10000) return formatWeeklyCount(n);
    const wan = n >= 100000 ? Math.ceil(n / 10000) : Math.round(n / 1000) / 10;
    return String(wan).replace(/\.0$/, '') + 'w';
  }

  function cleanScheduleContent(value) {
    return String(value || '').trim().replace(/素材素材代做/g, '素材代做');
  }

  function isMaterialScheduleTask(task) {
    const haystack = [task && task.account, task && task.type, task && task.content, task && task.remark]
      .map(function(value) { return String(value || ''); })
      .join(' ');
    return /素材代做|素材|代做/.test(haystack);
  }

  function materialTaskUnits(task) {
    if (!isMaterialScheduleTask(task)) return 0;
    const stackCount = Number(task && (task.stack_count || task.stackCount || task.itemCount || task.quantity) || 0);
    if (Number.isFinite(stackCount) && stackCount > 0) return Math.max(1, Math.round(stackCount));
    const text = [task && task.content, task && task.remark, task && task.type].map(function(value) { return String(value || ''); }).join(' ');
    const match = text.match(/(?:[xX×＊*]\s*(\d{1,3})|(\d{1,3})\s*条)/);
    const value = match ? Number(match[1] || match[2] || 0) : 0;
    return value > 0 ? value : 1;
  }

  function materialStatsForTasks(tasks) {
    const materialTasks = (tasks || []).filter(isMaterialScheduleTask);
    return {
      count: materialTasks.length,
      units: materialTasks.reduce(function(total, task) { return total + materialTaskUnits(task); }, 0)
    };
  }

  function formatMaterialStats(count, units) {
    count = Number(count || 0);
    units = Number(units || 0);
    if (!count) return '';
    if (units && units !== count) return count + '次排期、预计' + units + '条素材';
    return count + '条';
  }

  function weeklySupplementalRevenueName(row) {
    const text = [
      row && row.project,
      row && row.category,
      row && row.business_type,
      row && row.product_line,
      row && row.remark,
      row && row.account
    ].map(function(value) { return String(value || ''); }).join(' ');
    const isNonOnePrice = /非一口价/.test(text) || /wecom:non_one_price/i.test(String(row && row.entry_source || ''));
    if (!isNonOnePrice) return '';
    if (/带货|电商|GMV/i.test(text)) return '电商带货';
    if (/素材|代做/.test(text)) return '素材';
    if (/星广|联投|CPI|CPA|CPM/i.test(text)) return '星广联投';
    return '其他非一口价';
  }

  function addWeeklyProfitItem(target, row) {
    target.revenue += numberField(row, ['fee', 'revenue', 'amount', 'group_revenue', '集团流水']);
    target.margin += numberField(row, ['margin', 'profit', 'department_margin', '部门毛利']);
    target.target_margin += targetMarginField(row);
    target.count += 1;
    if (row && row.project && target.projects.indexOf(row.project) < 0) target.projects.push(row.project);
  }

  function summarizeProfitRows(rows, monthLabel) {
    const scoped = (rows || []).filter(function(row) { return sameProfitMonth(row, monthLabel); });
    const byAccount = {};
    scoped.forEach(function(row) {
      const account = weeklySupplementalRevenueName(row)
        || canonicalWeeklyAccountName(row.account || row.account_name || row.name || row['账号昵称'] || '');
      if (!account) return;
      if (!byAccount[account]) byAccount[account] = { revenue: 0, margin: 0, target_margin: 0, count: 0, projects: [] };
      addWeeklyProfitItem(byAccount[account], row);
    });
    const targetMargin = scoped.reduce(function(total, row) { return total + targetMarginField(row); }, 0);
    const margin = sumField(scoped, ['margin', 'profit', 'department_margin', '部门毛利']);
    return {
      count: scoped.length,
      revenue: sumField(scoped, ['fee', 'revenue', 'amount', 'group_revenue', '集团流水']),
      margin: margin,
      target_margin: targetMargin,
      completion_rate: targetMargin ? margin / targetMargin * 100 : 0,
      by_account: byAccount,
      month_label: monthLabel
    };
  }

  function taskMatchesWeeklyGroup(task, groupName) {
    const group = weeklyRowsForGroup(groupName);
    const explicit = String(task && task.group_name || '').trim();
    if (explicit) return normalizeWeeklyGroup(explicit) === normalizeWeeklyGroup(groupName);
    const person = String(task && task.person || '').trim();
    if (person && group.members.indexOf(person) >= 0) return true;
    const account = String(task && task.account || '').trim();
    return account && group.accountRows.some(function(row) { return row[0] === account; });
  }

  function groupSchedule(tasks, start, end, groupName) {
    const scoped = tasks.filter(function(task) {
      return inDateRange(task.date, start, end)
        && (!groupName || taskMatchesWeeklyGroup(task, groupName))
        && !Number(task && task.schedule_hidden || 0);
    });
    const doneWords = /done|finish|completed|已完成|完成|done/i;
    const completed = scoped.filter(function(task) {
      return doneWords.test(String(task.status || '')) || doneWords.test(String(task.progress || ''));
    });
    const byType = {};
    const materialTasks = [];
    scoped.forEach(function(task) {
      const type = String(task.type || '未分类').trim() || '未分类';
      byType[type] = (byType[type] || 0) + 1;
      if (isMaterialScheduleTask(task)) materialTasks.push(task);
    });
    const byAccount = {};
    scoped.forEach(function(task) {
      const account = canonicalWeeklyAccountName(task.account || '');
      if (!account || account === '素材') return;
      if (!byAccount[account]) byAccount[account] = { commercial: 0, ecology: 0, daily: 0, total: 0 };
      const type = String(task.type || '');
      const content = String(task.content || '');
      const remark = String(task.remark || '');
      const haystack = type + content + remark;
      if (/生态/.test(haystack)) byAccount[account].ecology += 1;
      else if (/商单|商业|推广|合作|广告|植入/.test(haystack)) byAccount[account].commercial += 1;
      else if (/日常|周事件|事件|选题|发布/.test(haystack)) byAccount[account].daily += 1;
      else return;
      byAccount[account].total += 1;
    });
    return { tasks: scoped, completed: completed, byType: byType, byAccount: byAccount, materialTasks: materialTasks };
  }

  async function inspectAccountWithOpenCli(account, index, update) {
    if (!account.url) return Object.assign({}, account, { status: 'skipped', error: '未填写链接' });
    const session = ('weekly-account-' + index + '-' + Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g, '-');
    update('running', '打开账号页面：' + account.name);
    const opened = await runCommand(openCliBin(), ['browser', session, 'open', account.url], { timeout: 60000 });
    if (!opened.ok) {
      return Object.assign({}, account, { status: 'failed', error: (opened.stderr || opened.stdout || 'OpenCLI 打开失败').slice(0, 240) });
    }
    await runCommand(openCliBin(), ['browser', session, 'wait', 'time', '5'], { timeout: 20000 });
    update('running', '读取页面数据：' + account.name);
    const js = "(() => ({ url: location.href, title: document.title, text: document.body.innerText.slice(0, 8000), metas: Array.from(document.querySelectorAll('meta')).slice(0, 80).map(m => ({ name: m.getAttribute('name') || '', property: m.getAttribute('property') || '', content: m.getAttribute('content') || '' })) }))()";
    const result = await runCommand(openCliBin(), ['browser', session, 'eval', js], { timeout: 45000 });
    if (!result.ok) {
      return Object.assign({}, account, { status: 'failed', error: (result.stderr || result.stdout || 'OpenCLI 读取失败').slice(0, 240) });
    }
    const page = parseJsonLoose(result.stdout) || {};
    const metaText = (page.metas || []).map(function(meta) { return meta.content || ''; }).join('\n');
    const text = String(page.text || '');
    const title = stripText(page.title || '');
    const authorMatch = metaText.match(/-\s*([^-\n\r]{1,40}?)于\d{8}发布在抖音/) || text.match(/(?:^|\n)([^\n]{1,40})\s*\n认证徽章/);
    const fansMatch = text.match(/粉丝\s*([\d.,]+[万亿]?)/) || text.match(/([\d.,]+[万亿]?)\s*粉丝/);
    const likesMatch = text.match(/获赞\s*([\d.,]+[万亿]?)/) || text.match(/获赞([\d.,]+[万亿]?)/);
    const playsMatch = text.match(/播放\s*([\d.,]+[万亿]?)/) || text.match(/([\d.,]+[万亿]?)\s*播放/);
    return Object.assign({}, account, {
      status: 'done',
      page_url: page.url || account.url,
      title: title,
      name: stripText(authorMatch && authorMatch[1]) || account.name || title.replace(/\s*-\s*(抖音|哔哩哔哩|bilibili).*$/i, '').slice(0, 40),
      fans: fansMatch ? fansMatch[1] : '',
      likes: likesMatch ? likesMatch[1] : '',
      plays: playsMatch ? playsMatch[1] : '',
      fans_number: fansMatch ? toNumber(fansMatch[1]) : 0,
      likes_number: likesMatch ? toNumber(likesMatch[1]) : 0,
      plays_number: playsMatch ? toNumber(playsMatch[1]) : 0
    });
  }

  function renderWeeklyReportText(report) {
    const profit = report.profit || {};
    const schedule = report.schedule || {};
    const accounts = report.accounts || [];
    const workHours = report.work_hours || [];
    const plans = report.next_plans || [];
    const lines = [];
    lines.push(report.title);
    lines.push('');
    lines.push('1、截止当前本月的营收情况');
    lines.push('本月已录入流水 ' + (profit.revenue || 0) + '，部门毛利 ' + (profit.margin || 0) + '。');
    lines.push('订单/项目记录数：' + (profit.count || 0) + '。');
    lines.push('');
    lines.push('2、上周的账号数据情况');
    if (accounts.length) {
      accounts.forEach(function(item, idx) {
        lines.push((idx + 1) + '. ' + (item.name || '未命名账号') + '（' + (item.platform || '-') + '）：粉丝 ' + (item.fans || '待补') + '，获赞 ' + (item.likes || '待补') + '，播放 ' + (item.plays || '待补') + (item.error ? '，读取失败：' + item.error : ''));
      });
    } else {
      lines.push('账号数据暂未配置账号链接，本次未自动抓取。');
    }
    lines.push('');
    lines.push('总结：上周排期内任务 ' + (schedule.total || 0) + ' 条，已完成 ' + (schedule.completed || 0) + ' 条。' + (schedule.summary || '账号数据以 OpenCLI 页面读取结果为准，异常账号需人工复核。'));
    lines.push('');
    lines.push('3、工时情况');
    if (workHours.length) {
      workHours.forEach(function(item) { lines.push((item.name || '-') + '目前工时  ' + (item.hours || '')); });
    } else {
      lines.push('本周工时待从 ERP 补充。');
    }
    lines.push('');
    lines.push('4、当周工作计划');
    if (plans.length) {
      plans.forEach(function(plan, idx) { lines.push(String.fromCharCode(9312 + idx) + plan); });
    } else {
      lines.push('①本周计划待排期看板补充。');
    }
    return lines.join('\n');
  }

  function renderWeeklyReportHtml(report) {
    function row(cells) {
      return '<tr>' + cells.map(function(cell) { return '<td>' + htmlEscape(cell) + '</td>'; }).join('') + '</tr>';
    }
    const accountRows = (report.accounts || []).map(function(item) {
      return row([item.name || '-', item.platform || '-', item.fans || '待补', item.likes || '待补', item.plays || '待补', item.error || '']);
    }).join('') || row(['待配置账号链接', '-', '-', '-', '-', '']);
    const hourRows = (report.work_hours || []).map(function(item) {
      return row([item.name || '-', item.hours || '']);
    }).join('') || row(['ERP工时待补', '']);
    const planItems = (report.next_plans || ['本周计划待排期看板补充']).map(function(item) {
      return '<li>' + htmlEscape(item) + '</li>';
    }).join('');
    const strategyLines = weeklyStrategyLines(report);
    const strategyHtml = (strategyLines.length || weeklyStrategyStatus(report))
      ? '<h2>战略项及完成情况</h2>' + strategyLines.map(function(item) { return '<p>' + htmlEscape(item) + '</p>'; }).join('') + '<p>完成情况：' + htmlEscape(weeklyStrategyStatus(report) || '待补充') + '</p>'
      : '';
    return [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + htmlEscape(report.title) + '</title>',
      '<style>body{font-family:"Microsoft YaHei",Arial,sans-serif;color:#111827;line-height:1.65;}h1{font-size:24px;}h2{font-size:18px;margin-top:22px;}table{border-collapse:collapse;width:100%;margin:8px 0 14px;}td,th{border:1px solid #cbd5e1;padding:7px 9px;font-size:13px;}th{background:#eef2f7;}p{margin:6px 0;}li{margin:4px 0;}</style>',
      '</head><body>',
      '<h1>' + htmlEscape(report.title) + '</h1>',
      '<p>周期：' + htmlEscape(report.range.start) + ' 至 ' + htmlEscape(report.range.end) + '　小组：' + htmlEscape(report.group) + '</p>',
      '<h2>1、截止当前本月的营收情况</h2>',
      '<table><tr><th>项目数</th><th>集团流水</th><th>部门毛利</th><th>说明</th></tr>' + row([report.profit.count || 0, report.profit.revenue || 0, report.profit.margin || 0, report.profit.error || '来自流水看板']) + '</table>',
      '<h2>2、上周的账号数据情况</h2>',
      '<table><tr><th>账号昵称</th><th>平台</th><th>粉丝</th><th>获赞</th><th>播放</th><th>备注</th></tr>' + accountRows + '</table>',
      '<p>总结：上周排期内任务 ' + htmlEscape(report.schedule.total || 0) + ' 条，已完成 ' + htmlEscape(report.schedule.completed || 0) + ' 条。</p>',
      '<h2>3、工时情况</h2>',
      '<table><tr><th>成员</th><th>工时</th></tr>' + hourRows + '</table>',
      '<h2>4、当周工作计划</h2>',
      '<ol>' + planItems + '</ol>',
      '</body></html>'
    ].join('');
  }

  const STRICT_WEEKLY_REVENUE_ROWS = [
    ['报告砖家', '抖音'],
    ['痞仔伯爵', 'B站'],
    ['暴走星号键', 'B站'],
    ['雷鸭fist', 'B站'],
    ['灵梦小师妹', '抖音'],
    ['一条小梗梗', '抖音'],
    ['沙雕101', '抖音'],
    ['钱包收益', '抖音'],
    ['代做', '抖音']
  ];

  const STRICT_WEEKLY_ACCOUNT_ROWS = [
    ['痞仔伯爵', 'B站'],
    ['暴走星号键', 'B站'],
    ['雷鸭fist', 'B站'],
    ['报告砖家', '抖音'],
    ['沙雕101', '抖音'],
    ['灵梦小师妹', '抖音'],
    ['网瘾少女一条', '抖音']
  ];

  function strictWeeklyTitle(report) {
    const group = String(report.group || '内容二组').replace(/^内容/, '内容');
    return '内容事业部会议-' + group;
  }

  function strictAccountMap(accounts) {
    const map = {};
    (accounts || []).forEach(function(item) {
      const name = String(item.name || '').trim();
      if (name) map[name] = item;
    });
    return map;
  }

  function strictBlank(value) {
    return value === undefined || value === null || value === '' ? '' : value;
  }

  function renderStrictWeeklyReportText(report) {
    const accountMap = strictAccountMap(report.accounts || []);
    const lines = [];
    lines.push(strictWeeklyTitle(report));
    lines.push('');
    lines.push('截止当前本月的营收情况');
    lines.push('账号昵称 | 平台 | 已执行-集团流水 | 已执行-部门毛利 | 预估-集团流水 | 预估-部门毛利 | 合计-集团流水 | 合计-部门毛利 | 目标流水 | 流水完成率 | 目标毛利 | 毛利完成率');
    STRICT_WEEKLY_REVENUE_ROWS.forEach(function(row) {
      lines.push(row[0] + ' | ' + row[1] + ' |  |  |  |  |  |  |  | ');
    });
    lines.push('合计 |  | ' + strictBlank(report.profit && report.profit.revenue) + ' | ' + strictBlank(report.profit && report.profit.margin) + ' |  |  | ' + strictBlank(report.profit && report.profit.revenue) + ' | ' + strictBlank(report.profit && report.profit.margin) + ' |  | ');
    lines.push('');
    lines.push('1)本月业绩情况：');
    lines.push('');
    lines.push('2）落地项推进进度');
    lines.push('');
    lines.push('2.上周的账号数据情况');
    lines.push('账号昵称 | 平台 | 商业化条数 | 生态项目 | 日常条数 | 总发布条数 | 净增粉');
    STRICT_WEEKLY_ACCOUNT_ROWS.forEach(function(row) {
      const account = accountMap[row[0]] || {};
      lines.push(row[0] + ' | ' + row[1] + ' |  |  |  |  | ' + strictBlank(account.fans_delta || ''));
    });
    lines.push('合计 |  |  |  |  |  | ');
    lines.push('');
    lines.push('总结：');
    lines.push('');
    lines.push('');
    lines.push('');
    lines.push('3、工时情况');
    if ((report.work_hours || []).length) {
      (report.work_hours || []).forEach(function(item) {
        lines.push((item.name || '') + '目前工时  ' + (item.hours || ''));
      });
    } else {
      lines.push('目前工时  ');
    }
    lines.push('');
    lines.push('4、当周工作计划');
    if ((report.next_plans || []).length) {
      (report.next_plans || []).forEach(function(plan, idx) {
        lines.push(String.fromCharCode(9312 + idx) + plan);
      });
    } else {
      lines.push('①');
      lines.push('②');
      lines.push('③');
      lines.push('④');
      lines.push('⑤');
    }
    return lines.join('\n');
  }

  function renderStrictWeeklyReportHtml(report) {
    function td(value, attrs) {
      return '<td' + (attrs ? ' ' + attrs : '') + '>' + htmlEscape(strictBlank(value)) + '</td>';
    }
    function th(value, attrs) {
      return '<th' + (attrs ? ' ' + attrs : '') + '>' + htmlEscape(strictBlank(value)) + '</th>';
    }
    const accountMap = strictAccountMap(report.accounts || []);
    const revenueRows = STRICT_WEEKLY_REVENUE_ROWS.map(function(row) {
      return '<tr>' + td(row[0]) + td(row[1]) + td('') + td('') + td('') + td('') + td('') + td('') + td('') + td('') + td('') + td('') + '</tr>';
    }).join('');
    const profitTarget = weeklyProfitTargetSummary(report);
    const revenueTotal = '<tr>' + td('合计') + td('') + td(report.profit && report.profit.revenue || '') + td(report.profit && report.profit.margin || '') + td('') + td('') + td(report.profit && report.profit.revenue || '') + td(report.profit && report.profit.margin || '') + td(formatWeeklyNumber(profitTarget.revenueTarget)) + td(formatWeeklyRate(profitTarget.revenueRate)) + td(formatWeeklyNumber(profitTarget.target)) + td(formatWeeklyRate(profitTarget.rate)) + '</tr>';
    const accountRows = STRICT_WEEKLY_ACCOUNT_ROWS.map(function(row) {
      const account = accountMap[row[0]] || {};
      return '<tr>' + td(row[0]) + td(row[1]) + td('') + td('') + td('') + td('') + td(account.fans_delta || '') + '</tr>';
    }).join('');
    const workHourLines = (report.work_hours || []).length
      ? (report.work_hours || []).map(function(item) { return '<p>' + htmlEscape(item.name || '') + '目前工时&nbsp;&nbsp;' + htmlEscape(item.hours || '') + '</p>'; }).join('')
      : '<p>目前工时&nbsp;&nbsp;</p>';
    const planLines = (report.next_plans || []).length
      ? (report.next_plans || []).map(function(item, idx) { return '<p>' + htmlEscape(String.fromCharCode(9312 + idx) + item) + '</p>'; }).join('')
      : '<p>①</p><p>②</p><p>③</p><p>④</p><p>⑤</p>';
    const strategyLines = weeklyStrategyLines(report);
    const strategyHtml = (strategyLines.length || weeklyStrategyStatus(report))
      ? '<h2>战略项及完成情况</h2>' + strategyLines.map(function(item) { return '<p>' + htmlEscape(item) + '</p>'; }).join('') + '<p>完成情况：' + htmlEscape(weeklyStrategyStatus(report) || '待补充') + '</p>'
      : '';
    return [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + htmlEscape(strictWeeklyTitle(report)) + '</title>',
      '<style>@page{margin:1.7cm 1.7cm;}body{font-family:"Microsoft YaHei",SimSun,Arial,sans-serif;color:#111;line-height:1.55;font-size:12pt;}h1{font-size:20pt;text-align:center;margin:0 0 18px;font-weight:700;}h2{font-size:14pt;margin:18px 0 8px;font-weight:700;}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:6px 0 12px;}th,td{border:1px solid #111;padding:6px 5px;text-align:center;vertical-align:middle;font-size:10.5pt;}th{font-weight:700;background:#f2f2f2;}.fill{min-height:34px;border-bottom:1px solid transparent;}p{margin:4px 0;}</style>',
      '</head><body>',
      '<h1>' + htmlEscape(strictWeeklyTitle(report)) + '</h1>',
      '<h2>截止当前本月的营收情况</h2>',
      '<table>',
      '<tr>' + th('账号昵称', 'rowspan="2"') + th('平台', 'rowspan="2"') + th('已执行', 'colspan="2"') + th('预估', 'colspan="2"') + th('合计', 'colspan="2"') + th('目标流水', 'rowspan="2"') + th('流水完成率', 'rowspan="2"') + th('目标毛利', 'rowspan="2"') + th('目标完成率', 'rowspan="2"') + '</tr>',
      '<tr>' + th('集团流水') + th('部门毛利') + th('集团流水') + th('部门毛利') + th('集团流水') + th('部门毛利') + '</tr>',
      revenueRows,
      revenueTotal,
      '</table>',
      '<p>' + htmlEscape(weeklyPerCapitaMarginText(report)) + '</p>',
      '<p>' + htmlEscape(weeklyYoYText(report)) + '</p>',
      '<p>1)本月业绩情况：</p>',
      '<p class="fill">&nbsp;</p>',
      '<p>2）落地项推进进度</p>',
      '<p class="fill">&nbsp;</p>',
      ((weeklyStrategyLines(report).length || weeklyStrategyStatus(report)) ? '<h2>战略项及完成情况</h2>' + weeklyStrategyLines(report).map(function(item) { return '<p>' + htmlEscape(item) + '</p>'; }).join('') + '<p>完成情况：' + htmlEscape(weeklyStrategyStatus(report) || '待补充') + '</p>' : ''),
      '<h2>2.上周的账号数据情况</h2>',
      '<table>',
      '<tr>' + th('账号昵称') + th('平台') + th('商业化条数') + th('生态项目') + th('日常条数') + th('总发布条数') + th('净增粉') + '</tr>',
      accountRows,
      '<tr>' + td('合计') + td('') + td('') + td('') + td('') + td('') + td('') + '</tr>',
      '</table>',
      '<p>总结：</p>',
      '<p class="fill">&nbsp;</p><p class="fill">&nbsp;</p><p class="fill">&nbsp;</p>',
      '<h2>3、工时情况</h2>',
      workHourLines,
      '<h2>4、当周工作计划</h2>',
      planLines,
      '</body></html>'
    ].join('');
  }

  function schedulePlanLabel(task) {
    const account = String(task && task.account || '').trim();
    const type = String(task && task.type || '').trim();
    const cleanContent = cleanScheduleContent(task && task.content);
    return [task && task.person, account === '素材' ? '' : account, type, cleanContent]
      .map(function(value) { return String(value || '').trim(); })
      .filter(Boolean)
      .join(' - ');
  }

  function summarizeSchedulePlans(tasks, limit) {
    const groups = [];
    const byKey = {};
    (tasks || []).forEach(function(task) {
      const person = String(task && task.person || '').trim();
      const account = String(task && task.account || '').trim();
      const type = String(task && task.type || '').trim();
      const content = cleanScheduleContent(task && task.content);
      const material = isMaterialScheduleTask(task);
      const key = material ? [person, account, content].join('\u0001') : [person, account, type, content].join('\u0001');
      if (!byKey[key]) {
        byKey[key] = { person: person, account: account, type: type, content: content, count: 0, units: 0, material: material };
        groups.push(byKey[key]);
      }
      byKey[key].count += 1;
      byKey[key].units += material ? materialTaskUnits(task) : 0;
    });
    return groups.slice(0, limit || 5).map(function(item) {
      const cleanContent = cleanScheduleContent(item.content);
      const labelParts = item.material
        ? [item.person, item.account === '素材' ? '' : item.account, cleanContent]
        : [item.person, item.account === '素材' ? '' : item.account, item.type, cleanContent === item.type ? '' : cleanContent];
      const label = labelParts.filter(Boolean).join(' - ');
      if (item.material) {
        return label + '（' + item.units + '条）';
      }
      return item.count > 1 ? label + '（' + item.count + '条）' : label;
    }).filter(Boolean);
  }

  function aiWeeklyPayload(report, scheduleRows, range) {
    return {
      group: report.group,
      range: range,
      profit: report.profit,
      schedule: {
        by_account: report.schedule && report.schedule.by_account,
        material_count: report.schedule && report.schedule.material_units,
        material_schedule_count: report.schedule && report.schedule.material_count,
        material_samples: (report.schedule && report.schedule.material_tasks || []).slice(0, 12).map(schedulePlanLabel),
        next_samples: (report.schedule && report.schedule.plan_tasks || []).slice(0, 24).map(schedulePlanLabel)
      },
      next_plans: report.next_plans
    };
  }

  function hasBrokenText(value) {
    return /�|\uFFFD/.test(String(value || ''));
  }

  function applyWeeklyFallbackNarrative(report) {
    report.manual = report.manual || {};
    const profit = report.profit || {};
    const materialCount = Number(report.schedule && report.schedule.material_units || 0);
    const materialText = materialCount ? formatWeeklyCount(materialCount) + '条' : '';
    const totals = totalScheduleCounts(report);
    const targetRevenue = Number(profit.target_revenue || 0);
    const targetMargin = Number(profit.target_margin || 0);
    const revenueCompletionRate = Number(profit.revenue_completion_rate || 0);
    const completionRate = Number(profit.completion_rate || 0);
    const revenueGap = Math.max(0, targetRevenue - Number(profit.revenue || 0));
    const gap = Math.max(0, targetMargin - Number(profit.margin || 0));
    const accountEntries = Object.keys(profit.by_account || {}).map(function(name) {
      const item = profit.by_account[name] || {};
      return { name: name, revenue: Number(item.revenue || 0), margin: Number(item.margin || 0) };
    }).sort(function(a, b) { return b.margin - a.margin; });
    const topAccounts = accountEntries.slice(0, 3).map(function(item) {
      return item.name + '毛利' + formatWeeklyNumber(item.margin);
    }).join('；');
    if (!String(report.manual.performanceText || '').trim()) {
      report.manual.performanceText = '截止当前本月，' + (report.group || '本组') + '已执行集团流水' + formatWeeklyNumber(profit.revenue) + (targetRevenue ? '，目标流水' + formatWeeklyNumber(targetRevenue) + '，流水完成率' + formatWeeklyRate(revenueCompletionRate) + '，流水缺口' + formatWeeklyNumber(revenueGap) : '') + '；已执行部门毛利' + formatWeeklyNumber(profit.margin) + '，目标毛利' + formatWeeklyNumber(targetMargin) + '，毛利完成率' + formatWeeklyRate(completionRate) + (targetMargin ? '，毛利缺口' + formatWeeklyNumber(gap) : '') + '。' + (topAccounts ? '主要毛利贡献来自' + topAccounts + '。' : '');
    }
    if (!String(report.manual.landingText || '').trim()) {
      report.manual.landingText = '上周排期共' + formatWeeklyNumber(report.schedule && report.schedule.total) + '条，账号发布' + formatWeeklyNumber(totals.total) + '条' + (materialText ? '，素材代做' + materialText : '') + '；本周继续按排期推进商单、日常与素材交付。';
    }
    if (!String(report.manual.summaryText || '').trim()) {
      report.manual.summaryText = autoWeeklySummary(report);
    }
    return report;
  }

  async function refineWeeklyReportWithAi(report, scheduleRows, range) {
    if (!callModelText) return report;
    const manual = report.manual || {};
    if (manual.performanceText && manual.landingText && manual.summaryText && manual.nextPlansText) return report;
    const system = [
      '你是内容事业部周报助理，只做中文内部周会文案整理。',
      '根据给定流水和排期，补全周报中的本月业绩情况、落地项推进、账号数据总结和当周工作计划。',
      '要求：短、准、像运营周报；不要编造未给出的数据；素材代做按排期卡片的 stack_count 堆叠条数求和，不要只数卡片数量；输出严格 JSON。'
    ].join('\n');
    const user = [
      '请基于这些数据整理周报文字，输出 JSON：',
      '{"performanceText":"","landingText":"","summaryText":"","nextPlans":[""]}',
      '',
      JSON.stringify(aiWeeklyPayload(report, scheduleRows, range), null, 2)
    ].join('\n');
    try {
      const raw = await callModelText(system, user, { temperature: 0.2, maxTokens: 1200, timeoutMs: 90000 });
      const parsed = extractJsonLoose(raw);
      if (!parsed || typeof parsed !== 'object') return report;
      if (hasBrokenText(JSON.stringify(parsed))) {
        report.ai_error = 'AI 返回包含乱码，已回退规则文案';
        applyWeeklyFallbackNarrative(report);
        return report;
      }
      report.manual.performanceText = manual.performanceText || String(parsed.performanceText || '').trim();
      report.manual.landingText = manual.landingText || String(parsed.landingText || '').trim();
      report.manual.summaryText = manual.summaryText || String(parsed.summaryText || '').trim();
      if (!manual.nextPlansText && Array.isArray(parsed.nextPlans)) {
        report.next_plans = parsed.nextPlans.map(function(item) { return String(item || '').trim(); }).filter(Boolean).slice(0, 5);
      }
    } catch (e) {
      report.ai_error = e.message || String(e);
    }
    applyWeeklyFallbackNarrative(report);
    return report;
  }

  function strictWeeklyTitle(report) {
    return '内容事业部会议-' + normalizeWeeklyGroup(report.group || '内容二组');
  }

  function manualWeeklyText(report, key, fallback) {
    const manual = report.manual || {};
    return String(manual[key] || fallback || '').trim();
  }

  function weeklyStrategyLines(report) {
    return (report.strategy_items || []).map(function(item, index) {
      const text = String(item || '').trim();
      return text ? (index + 1) + '、' + text.replace(/^\d+[、.．\s]+/, '') : '';
    }).filter(Boolean);
  }

  function weeklyStrategyStatus(report) {
    return String(report.strategy_status || report.strategyStatus || '').trim();
  }

  function weeklyPerCapitaMarginText(report) {
    const profit = report.profit || {};
    const members = Number(profit.member_count || (weeklyRowsForGroup(report.group).members || []).length || 0);
    const margin = Number(profit.margin || 0);
    const perCapita = members ? margin / members : 0;
    return '人均毛利口径：部门毛利 ' + formatWeeklyNumber(margin) + ' / 在组人数 ' + formatWeeklyNumber(members) + ' = ' + formatWeeklyNumber(perCapita);
  }

  function weeklyYoYText(report) {
    const profit = report.profit || {};
    const lastYear = profit.last_year || {};
    const count = Number(lastYear.count || 0);
    const lastLabel = lastYear.year && lastYear.month ? (lastYear.year + '年' + lastYear.month + '月') : '去年同月';
    if (!count) {
      return '同比去年口径：按当前周报账号白名单对齐去年同月流水；未找到' + lastLabel + '同账号流水，待补充。';
    }
    return '同比去年口径：按当前周报账号白名单对齐去年同月流水；' + lastLabel
      + '部门毛利 ' + formatWeeklyNumber(lastYear.margin)
      + '，今年同月部门毛利 ' + formatWeeklyNumber(profit.margin)
      + '，同比 ' + formatWeeklySignedRate(profit.yoy_margin_rate)
      + '；去年同月集团流水 ' + formatWeeklyNumber(lastYear.revenue)
      + '，今年同月集团流水 ' + formatWeeklyNumber(profit.revenue)
      + '，同比 ' + formatWeeklySignedRate(profit.yoy_revenue_rate) + '。';
  }

  function weeklyRevenueFor(report, accountName) {
    const byAccount = report.profit && report.profit.by_account || {};
    let item = byAccount[accountName];
    if (!item) {
      const key = Object.keys(byAccount).find(function(name) {
        return matchProfitRowAccount({ account: name }, accountName);
      });
      item = key ? byAccount[key] : null;
    }
    return item || { revenue: 0, margin: 0, target_margin: 0 };
  }

  function weeklyRevenueDetailRows(report) {
    const rows = weeklyRowsForGroup(report.group).revenueRows.slice();
    const existing = new Set(rows.map(function(row) { return row[0]; }));
    ['星广联投', '电商带货', '素材'].forEach(function(name) {
      if (!existing.has(name)) rows.push([name, '']);
    });
    const other = weeklyRevenueFor(report, '其他非一口价');
    if (Number(other.revenue || 0) || Number(other.margin || 0)) rows.push(['其他非一口价', '']);
    return rows;
  }

  function weeklyTargetMarginFor(report, accountName) {
    const item = weeklyRevenueFor(report, accountName);
    return Number(item.target_margin || 0);
  }

  function weeklyCompletionRateFor(report, accountName) {
    const item = weeklyRevenueFor(report, accountName);
    const target = Number(item.target_margin || 0);
    if (!target) return 0;
    return Number(item.margin || 0) / target * 100;
  }

  function weeklyProfitTargetSummary(report) {
    const profit = report.profit || {};
    const revenueTarget = Number(profit.target_revenue || 0);
    const target = Number(profit.target_margin || 0);
    const revenue = Number(profit.revenue || 0);
    const margin = Number(profit.margin || 0);
    return {
      revenueTarget: revenueTarget,
      revenueRate: revenueTarget ? revenue / revenueTarget * 100 : 0,
      target: target,
      rate: target ? margin / target * 100 : 0
    };
  }

  function applyWeeklyProfitTarget(report, payload) {
    report.profit = report.profit || {};
    const payloadRevenueTarget = numberField(payload || {}, ['targetRevenue', 'target_revenue', 'revenueTarget', 'revenue_target', '流水目标', '目标流水']);
    const payloadTarget = numberField(payload || {}, ['targetMargin', 'target_margin', 'profitTarget', 'profit_target', '目标毛利', '毛利目标']);
    const existingRevenueTarget = Number(report.profit.target_revenue || 0);
    const existingTarget = Number(report.profit.target_margin || 0);
    const defaultTarget = Number(WEEKLY_GROUP_TARGETS[normalizeWeeklyGroup(report.group)] || 0);
    const revenueTarget = payloadRevenueTarget || existingRevenueTarget || 0;
    const target = payloadTarget || existingTarget || defaultTarget;
    report.profit.target_revenue = revenueTarget;
    report.profit.revenue_completion_rate = revenueTarget ? Number(report.profit.revenue || 0) / revenueTarget * 100 : 0;
    report.profit.target_margin = target;
    report.profit.completion_rate = target ? Number(report.profit.margin || 0) / target * 100 : 0;
    return report.profit;
  }

  function weeklyScheduleFor(report, accountName) {
    const canonicalAccount = canonicalWeeklyAccountName(accountName);
    if (String(accountName || '').trim() === '素材代做') {
      const units = Number(report.schedule && report.schedule.material_units || 0);
      return {
        commercial: units,
        ecology: 0,
        daily: 0,
        total: units
      };
    }
    const byAccount = report.schedule && report.schedule.by_account || {};
    const matches = Object.keys(byAccount).filter(function(name) {
      return canonicalWeeklyAccountName(name) === canonicalAccount || name === accountName;
    });
    if (!matches.length) return { commercial: 0, ecology: 0, daily: 0, total: 0 };
    return matches.reduce(function(total, name) {
      const item = byAccount[name] || {};
      total.commercial += Number(item.commercial || 0);
      total.ecology += Number(item.ecology || 0);
      total.daily += Number(item.daily || 0);
      total.total += Number(item.total || 0);
      return total;
    }, { commercial: 0, ecology: 0, daily: 0, total: 0 });
  }

  function weeklyMonthlyScheduleFor(report, accountName) {
    const canonicalAccount = canonicalWeeklyAccountName(accountName);
    const byAccount = report.schedule && report.schedule.monthly_by_account || {};
    return Object.keys(byAccount).filter(function(name) {
      return canonicalWeeklyAccountName(name) === canonicalAccount || name === accountName;
    }).reduce(function(total, name) {
      return total + Number(byAccount[name] && byAccount[name].total || 0);
    }, 0);
  }

  function weeklyAccountMetric(report, accountName) {
    const platform = weeklyPlatformFor(accountName);
    const key = canonicalWeeklyAccountName(accountName) + '|' + platform;
    return report.account_metrics && report.account_metrics[key]
      || weeklyDashboardMetric(accountName, platform)
      || { followers: 0, seven_day_fans: 0, month_posts: 0 };
  }

  function weeklyMonthPublishedFor(report, accountName) {
    if (/素材|代做/.test(String(accountName || ''))) {
      return Number(report.schedule && report.schedule.monthly_material_units || 0);
    }
    const metric = weeklyAccountMetric(report, accountName);
    const reportMonth = Number(report.profit && report.profit.month || 0);
    const reportYear = Number(report.profit && report.profit.year || 0);
    const today = new Date();
    if ((!reportYear || reportYear === today.getFullYear()) && (!reportMonth || reportMonth === today.getMonth() + 1)) {
      return Number(metric.month_posts || 0);
    }
    return weeklyMonthlyScheduleFor(report, accountName);
  }

  function totalScheduleCounts(report) {
    const result = { commercial: 0, ecology: 0, daily: 0, total: 0 };
    Object.values((report.schedule && report.schedule.by_account) || {}).forEach(function(item) {
      result.commercial += Number(item.commercial || 0);
      result.ecology += Number(item.ecology || 0);
      result.daily += Number(item.daily || 0);
      result.total += Number(item.total || 0);
    });
    result.commercial += Number(report.schedule && report.schedule.material_units || 0);
    result.total += Number(report.schedule && report.schedule.material_units || 0);
    return result;
  }

  function totalWeeklyMonthPublished(report) {
    return weeklyRowsForGroup(report.group).accountDataRows.reduce(function(total, row) {
      return total + Number(weeklyMonthPublishedFor(report, row[0]) || 0);
    }, 0);
  }

  function weeklyFollowerDeltaFor(report, accountName) {
    const accountMap = strictAccountMap(report.accounts || []);
    const account = accountMap[accountName] || accountMap[canonicalWeeklyAccountName(accountName)] || {};
    const metric = weeklyAccountMetric(report, accountName);
    if (metric.seven_day_fans !== undefined && metric.seven_day_fans !== null) {
      const delta = Number(metric.seven_day_fans || 0);
      return delta > 0 ? ('+' + formatWeeklyCount(delta)) : formatWeeklyCount(delta);
    }
    const raw = account.fans_delta;
    if (account.status && account.status !== 'estimated' && raw !== undefined && raw !== null && raw !== '') return String(raw);
    return '0';
  }

  function totalFollowerDelta(report) {
    const rows = weeklyRowsForGroup(report.group);
    const total = rows.accountDataRows.reduce(function(sum, row) {
      const n = Number(String(weeklyFollowerDeltaFor(report, row[0])).replace(/,/g, ''));
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    return formatWeeklyCount(total);
  }

  function totalWeeklyUpdateTarget(report) {
    return weeklyRowsForGroup(report.group).accountDataRows.reduce(function(total, row) {
      return total + Number(latestWeeklyUpdateTarget(report, row[0]) || 0);
    }, 0);
  }

  function totalWeeklyUpdateGap(report) {
    return weeklyRowsForGroup(report.group).accountDataRows.reduce(function(total, row) {
      return total + Number(latestWeeklyAccountGap(report, row[0]) || 0);
    }, 0);
  }

  function latestWeeklyTitle(report) {
    const group = normalizeWeeklyGroup(report && report.group || '');
    return 'MCN事业部-' + (group || '内容X组') + ' 周会材料';
  }

  function latestWeeklyMeetingDate(report) {
    const range = report && report.range || {};
    const date = String(range.end || range.start || '').trim();
    const match = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) return '周会日期：';
    return '周会日期：' + match[1] + '年' + Number(match[2]) + '月' + Number(match[3]) + '日';
  }

  function latestWeeklyMonthLabel(report) {
    const profit = report && report.profit || {};
    const month = Number(profit.month || (report.range && String(report.range.end || report.range.start || '').slice(5, 7)));
    return month ? month + '月份' : '本月';
  }

  function latestWeeklyAccountOwner(report) {
    const rows = weeklyRowsForGroup(report && report.group);
    return rows.leader || '';
  }

  function latestWeeklyUpdateTarget(report, accountName) {
    return formatWeeklyCount(weeklyPlanForAccount(accountName, weeklyPlatformFor(accountName)).monthlyTarget || 0);
  }

  function latestWeeklyAccountGap(report, accountName) {
    const target = Number(latestWeeklyUpdateTarget(report, accountName) || 0);
    return formatWeeklyCount(Math.max(target - weeklyMonthPublishedFor(report, accountName), 0));
  }

  function latestWeeklyAccountNote(report, accountName) {
    if (/素材|代做/.test(String(accountName || ''))) {
      const materialCount = Number(report && report.schedule && report.schedule.material_units || 0);
      return materialCount
        ? '本周素材代做' + formatWeeklyCount(materialCount) + '条。'
        : '本周暂无素材代做排期。';
    }
    const stats = weeklyScheduleFor(report, accountName);
    const workStats = weeklyWorksStatsFor(report, accountName);
    const parts = [];
    const published = workStats.total || stats.total;
    const commercial = workStats.total ? workStats.commercial : stats.commercial;
    const daily = workStats.total ? workStats.daily : (stats.daily + stats.ecology);
    if (published) parts.push('本周发布' + formatWeeklyCount(published) + '条');
    if (commercial) parts.push('商单' + formatWeeklyCount(commercial) + '条');
    if (daily) parts.push('日常' + formatWeeklyCount(daily) + '条');
    if (workStats.hotDaily.length && workStats.topDaily) {
      const top = workStats.topDaily;
      parts.push('日常侧热点爆款' + formatWeeklyCount(workStats.hotDaily.length) + '条，最高' + formatWeeklyWorkMetric(top.views) + '播放、' + formatWeeklyWorkMetric(top.likes) + '点赞（' + weeklyWorkTopicLabel(top) + '）');
    }
    return parts.length ? parts.join('，') + '。' : '本周主平台暂无已发布作品数据。';
  }

  function latestWeeklyProjectRows(report) {
    return Array.from({ length: 4 }, function() {
      return { product: '', target: '', role: '', owner: '', amount: '', progress: '' };
    });
  }

  function latestWeeklyWorkBenchLines(report) {
    const lines = normalizeWeeklyLines(manualWeeklyText(report, 'workbenchText', ''));
    return lines.length ? lines : ['1、', '2、'];
  }

  function latestWeeklyPlanGroups(report) {
    const plans = (report.next_plans || []).length ? report.next_plans : ['待补充'];
    return {
      account: plans.slice(0, 4),
      project: plans.slice(4, 8),
      workbench: latestWeeklyWorkBenchLines(report),
      other: []
    };
  }

  function weeklyNumberedItems(items) {
    return (items || []).filter(Boolean).map(function(item, index) {
      const text = String(item || '').trim().replace(/^(?:[一二三四五六七八九十]+|\d+|[①②③④⑤⑥⑦⑧⑨⑩])[、.．）)]\s*/, '');
      return '（' + (index + 1) + '）' + text;
    });
  }

  function autoWeeklySummary(report) {
    const accountTotals = { commercial: 0, ecology: 0, daily: 0, total: 0 };
    Object.values((report.schedule && report.schedule.by_account) || {}).forEach(function(item) {
      accountTotals.commercial += Number(item.commercial || 0);
      accountTotals.ecology += Number(item.ecology || 0);
      accountTotals.daily += Number(item.daily || 0);
      accountTotals.total += Number(item.total || 0);
    });
    const materialCount = Number(report.schedule && report.schedule.material_units || 0);
    const materialText = materialCount ? formatWeeklyCount(materialCount) + '条' : '';
    const parts = [];
    if (accountTotals.total) {
      parts.push('上周账号共发布视频' + accountTotals.total + '条，其中商单' + accountTotals.commercial + '条，生态项目' + accountTotals.ecology + '条，日常' + accountTotals.daily + '条。');
    }
    if (materialText) parts.push('上周素材代做共' + materialText + '。');
    return parts.join('\n');
  }

  function renderStrictWeeklyReportText(report) {
    const rows = weeklyRowsForGroup(report.group);
    const accountMap = strictAccountMap(report.accounts || []);
    const scheduleTotals = totalScheduleCounts(report);
    const lines = [];
    lines.push(strictWeeklyTitle(report));
    lines.push('');
    lines.push('截止当前本月的营收情况');
    lines.push('账号昵称 | 平台 | 已执行-集团流水 | 已执行-部门毛利 | 预估-集团流水 | 预估-部门毛利 | 合计-集团流水 | 合计-部门毛利 | 目标流水 | 流水完成率 | 目标毛利 | 毛利完成率');
    rows.revenueRows.forEach(function(row) {
      const item = weeklyRevenueFor(report, row[0]);
      lines.push(row[0] + ' | ' + row[1] + ' | ' + formatWeeklyNumber(item.revenue) + ' | ' + formatWeeklyNumber(item.margin) + ' | 0 | 0 | ' + formatWeeklyNumber(item.revenue) + ' | ' + formatWeeklyNumber(item.margin) + ' | 0 | 0% | ' + formatWeeklyNumber(weeklyTargetMarginFor(report, row[0])) + ' | ' + formatWeeklyRate(weeklyCompletionRateFor(report, row[0])));
    });
    const profitTarget = weeklyProfitTargetSummary(report);
    lines.push('合计 |  | ' + formatWeeklyNumber(report.profit && report.profit.revenue) + ' | ' + formatWeeklyNumber(report.profit && report.profit.margin) + ' | 0 | 0 | ' + formatWeeklyNumber(report.profit && report.profit.revenue) + ' | ' + formatWeeklyNumber(report.profit && report.profit.margin) + ' | ' + formatWeeklyNumber(profitTarget.revenueTarget) + ' | ' + formatWeeklyRate(profitTarget.revenueRate) + ' | ' + formatWeeklyNumber(profitTarget.target) + ' | ' + formatWeeklyRate(profitTarget.rate));
    lines.push(weeklyPerCapitaMarginText(report));
    lines.push(weeklyYoYText(report));
    lines.push('');
    lines.push('1)本月业绩情况：');
    lines.push(manualWeeklyText(report, 'performanceText', ''));
    lines.push('');
    lines.push('2）落地项推进进度');
    lines.push(manualWeeklyText(report, 'landingText', ''));
    const strategyLines = weeklyStrategyLines(report);
    if (strategyLines.length || weeklyStrategyStatus(report)) {
      lines.push('');
      lines.push('战略项及完成情况');
      strategyLines.forEach(function(item) { lines.push(item); });
      lines.push('完成情况：' + (weeklyStrategyStatus(report) || '待补充'));
    }
    lines.push('');
    lines.push('2.上周的账号数据情况');
    lines.push('账号昵称 | 平台 | 商业化条数 | 生态项目 | 日常条数 | 总发布条数 | 净增粉');
    rows.accountDataRows.forEach(function(row) {
      const stats = weeklyScheduleFor(report, row[0]);
      lines.push(row[0] + ' | ' + row[1] + ' | ' + formatWeeklyCount(stats.commercial) + ' | ' + formatWeeklyCount(stats.ecology) + ' | ' + formatWeeklyCount(stats.daily) + ' | ' + formatWeeklyCount(stats.total) + ' | ' + weeklyFollowerDeltaFor(report, row[0]));
    });
    lines.push('合计 |  | ' + formatWeeklyCount(scheduleTotals.commercial) + ' | ' + formatWeeklyCount(scheduleTotals.ecology) + ' | ' + formatWeeklyCount(scheduleTotals.daily) + ' | ' + formatWeeklyCount(scheduleTotals.total) + ' | ' + totalFollowerDelta(report));
    lines.push('');
    lines.push('总结：' + manualWeeklyText(report, 'summaryText', autoWeeklySummary(report)));
    lines.push('');
    lines.push('3、工时情况');
    if ((report.work_hours || []).length) {
      (report.work_hours || []).forEach(function(item) {
        lines.push((item.name || '') + '目前工时  ' + (item.hours || ''));
      });
    } else {
      lines.push(rows.leader + '目前工时  ');
    }
    lines.push('');
    lines.push('4、当周工作计划');
    if ((report.next_plans || []).length) {
      (report.next_plans || []).forEach(function(plan, idx) {
        lines.push(String.fromCharCode(9312 + idx) + plan);
      });
    } else {
      ['①', '②', '③', '④', '⑤'].forEach(function(prefix) { lines.push(prefix); });
    }
    return lines.join('\n');
  }

  function renderStrictWeeklyReportHtml(report) {
    function td(value, attrs) {
      return '<td' + (attrs ? ' ' + attrs : '') + '>' + htmlEscape(strictBlank(value)) + '</td>';
    }
    function th(value, attrs) {
      return '<th' + (attrs ? ' ' + attrs : '') + '>' + htmlEscape(strictBlank(value)) + '</th>';
    }
    function fillText(value, minLines) {
      const text = String(value || '').trim();
      if (!text) return Array.from({ length: minLines || 1 }).map(function() { return '<p class="fill">&nbsp;</p>'; }).join('');
      return text.split(/\r?\n/).map(function(line) { return '<p>' + htmlEscape(line) + '</p>'; }).join('');
    }
    const rows = weeklyRowsForGroup(report.group);
    const accountMap = strictAccountMap(report.accounts || []);
    const revenueRows = rows.revenueRows.map(function(row) {
      const item = weeklyRevenueFor(report, row[0]);
      return '<tr>' + td(row[0]) + td(row[1]) + td(formatWeeklyNumber(item.revenue)) + td(formatWeeklyNumber(item.margin)) + td('0') + td('0') + td(formatWeeklyNumber(item.revenue)) + td(formatWeeklyNumber(item.margin)) + td('0') + td('0%') + td(formatWeeklyNumber(weeklyTargetMarginFor(report, row[0]))) + td(formatWeeklyRate(weeklyCompletionRateFor(report, row[0]))) + '</tr>';
    }).join('');
    const profitTarget = weeklyProfitTargetSummary(report);
    const revenueTotal = '<tr class="total-row">' + td('合计') + td('') + td(formatWeeklyNumber(report.profit && report.profit.revenue)) + td(formatWeeklyNumber(report.profit && report.profit.margin)) + td('0') + td('0') + td(formatWeeklyNumber(report.profit && report.profit.revenue)) + td(formatWeeklyNumber(report.profit && report.profit.margin)) + td(formatWeeklyNumber(profitTarget.revenueTarget)) + td(formatWeeklyRate(profitTarget.revenueRate)) + td(formatWeeklyNumber(profitTarget.target)) + td(formatWeeklyRate(profitTarget.rate)) + '</tr>';
    const accountRows = rows.accountDataRows.map(function(row) {
      const stats = weeklyScheduleFor(report, row[0]);
      return '<tr>' + td(row[0]) + td(row[1]) + td(formatWeeklyCount(stats.commercial)) + td(formatWeeklyCount(stats.ecology)) + td(formatWeeklyCount(stats.daily)) + td(formatWeeklyCount(stats.total)) + td(weeklyFollowerDeltaFor(report, row[0])) + '</tr>';
    }).join('');
    const scheduleTotals = totalScheduleCounts(report);
    const workHourLines = (report.work_hours || []).length
      ? (report.work_hours || []).map(function(item) { return '<p>' + htmlEscape(item.name || '') + '目前工时&nbsp;&nbsp;' + htmlEscape(item.hours || '') + '</p>'; }).join('')
      : '<p>' + htmlEscape(rows.leader) + '目前工时&nbsp;&nbsp;</p>';
    const planLines = (report.next_plans || []).length
      ? (report.next_plans || []).map(function(item, idx) { return '<p>' + htmlEscape(String.fromCharCode(9312 + idx) + item) + '</p>'; }).join('')
      : '<p>①</p><p>②</p><p>③</p><p>④</p><p>⑤</p>';
    return [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + htmlEscape(strictWeeklyTitle(report)) + '</title>',
      '<style>@page{margin:1.7cm 1.7cm;}body{font-family:"Microsoft YaHei",SimSun,Arial,sans-serif;color:#111;line-height:1.55;font-size:12pt;}h1{font-size:20pt;text-align:center;margin:0 0 18px;font-weight:700;}h2{font-size:14pt;margin:18px 0 8px;font-weight:700;}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:6px 0 12px;}th,td{border:1px solid #111;padding:6px 5px;text-align:center;vertical-align:middle;font-size:10.5pt;}th{font-weight:700;background:#f2f2f2;}.total-row td{color:#ff0000;font-weight:700;}.fill{min-height:28px;}p{margin:4px 0;}</style>',
      '</head><body>',
      '<h1>' + htmlEscape(strictWeeklyTitle(report)) + '</h1>',
      '<h2>截止当前本月的营收情况</h2>',
      '<table>',
      '<tr>' + th('账号昵称', 'rowspan="2"') + th('平台', 'rowspan="2"') + th('已执行', 'colspan="2"') + th('预估', 'colspan="2"') + th('合计', 'colspan="2"') + th('目标流水', 'rowspan="2"') + th('流水完成率', 'rowspan="2"') + th('目标毛利', 'rowspan="2"') + th('目标完成率', 'rowspan="2"') + '</tr>',
      '<tr>' + th('集团流水') + th('部门毛利') + th('集团流水') + th('部门毛利') + th('集团流水') + th('部门毛利') + '</tr>',
      revenueRows,
      revenueTotal,
      '</table>',
      '<p>' + htmlEscape(weeklyPerCapitaMarginText(report)) + '</p>',
      '<p>' + htmlEscape(weeklyYoYText(report)) + '</p>',
      '<p>1)本月业绩情况：</p>',
      fillText(manualWeeklyText(report, 'performanceText', ''), 1),
      '<p>2）落地项推进进度</p>',
      fillText(manualWeeklyText(report, 'landingText', ''), 1),
      ((weeklyStrategyLines(report).length || weeklyStrategyStatus(report)) ? '<h2>战略项及完成情况</h2>' + weeklyStrategyLines(report).map(function(item) { return '<p>' + htmlEscape(item) + '</p>'; }).join('') + '<p>完成情况：' + htmlEscape(weeklyStrategyStatus(report) || '待补充') + '</p>' : ''),
      '<h2>2.上周的账号数据情况</h2>',
      '<table>',
      '<tr>' + th('账号昵称') + th('平台') + th('商业化条数') + th('生态项目') + th('日常条数') + th('总发布条数') + th('净增粉') + '</tr>',
      accountRows,
      '<tr class="total-row">' + td('合计') + td('') + td(formatWeeklyCount(scheduleTotals.commercial)) + td(formatWeeklyCount(scheduleTotals.ecology)) + td(formatWeeklyCount(scheduleTotals.daily)) + td(formatWeeklyCount(scheduleTotals.total)) + td(totalFollowerDelta(report)) + '</tr>',
      '</table>',
      '<p>总结：</p>',
      fillText(manualWeeklyText(report, 'summaryText', autoWeeklySummary(report)), 3),
      '<h2>3、工时情况</h2>',
      workHourLines,
      '<h2>4、当周工作计划</h2>',
      planLines,
      '</body></html>'
    ].join('');
  }

  function renderLatestWeeklyReportText(report) {
    const rows = weeklyRowsForGroup(report.group);
    const revenueDetailRows = weeklyRevenueDetailRows(report);
    const scheduleTotals = totalScheduleCounts(report);
    const profitTarget = weeklyProfitTargetSummary(report);
    const lines = [];
    lines.push(latestWeeklyTitle(report));
    lines.push(latestWeeklyMeetingDate(report));
    lines.push('');
    lines.push('一、本月业绩情况');
    lines.push('1、营收数据');
    lines.push('账号昵称 | 平台 | 已执行-集团流水 | 已执行-部门毛利 | 合计-集团流水 | 合计-部门毛利 | 目标流水 | 流水完成率 | 目标毛利 | 目标毛利完成率');
    revenueDetailRows.forEach(function(row, index) {
      const item = weeklyRevenueFor(report, row[0]);
      const goals = index === 0
        ? [profitTarget.revenueTarget ? formatWeeklyNumber(profitTarget.revenueTarget) : '', profitTarget.revenueTarget ? formatWeeklyRate(profitTarget.revenueRate) : '', profitTarget.target ? formatWeeklyNumber(profitTarget.target) : '', profitTarget.target ? formatWeeklyRate(profitTarget.rate) : '']
        : ['', '', '', ''];
      lines.push([row[0], row[1], formatWeeklyNumber(item.revenue), formatWeeklyNumber(item.margin), formatWeeklyNumber(item.revenue), formatWeeklyNumber(item.margin)].concat(goals).join(' | '));
    });
    lines.push('合计 |  | ' + formatWeeklyNumber(report.profit && report.profit.revenue) + ' | ' + formatWeeklyNumber(report.profit && report.profit.margin) + ' | ' + formatWeeklyNumber(report.profit && report.profit.revenue) + ' | ' + formatWeeklyNumber(report.profit && report.profit.margin) + ' |  |  |  | ');
    lines.push(latestWeeklyMonthLabel(report) + '截止目前共计锁档' + formatWeeklyCount(report.profit && report.profit.count) + '单，部门毛利预估' + formatWeeklyWan(report.profit && report.profit.margin) + '万，人均' + formatWeeklyWan(report.profit && report.profit.per_capita_margin) + '万（实习生除外）。');
    lines.push('');
    lines.push('二、战略执行项');
    lines.push('1、完成进度、预计完成时间及卡点');
    const strategyLines = weeklyStrategyLines(report);
    if (strategyLines.length) strategyLines.forEach(function(item) { lines.push(item); });
    else lines.push(weeklyStrategyStatus(report) || '待补充');
    lines.push('');
    lines.push('三、账号运营');
    lines.push('账号昵称 | 平台 | 负责人 | 月更新目标 | 已发布数量 | 缺口 | 净增粉 | 运营情况说明');
    rows.accountDataRows.forEach(function(row) {
      lines.push(row[0] + ' | ' + row[1] + ' | ' + latestWeeklyAccountOwner(report, row[0]) + ' | ' + latestWeeklyUpdateTarget(report, row[0]) + ' | ' + formatWeeklyCount(weeklyMonthPublishedFor(report, row[0])) + ' | ' + latestWeeklyAccountGap(report, row[0]) + ' | ' + weeklyFollowerDeltaFor(report, row[0]) + ' | ' + latestWeeklyAccountNote(report, row[0]));
    });
    lines.push('合计 |  |  | ' + formatWeeklyCount(totalWeeklyUpdateTarget(report)) + ' | ' + formatWeeklyCount(totalWeeklyMonthPublished(report)) + ' | ' + formatWeeklyCount(totalWeeklyUpdateGap(report)) + ' | ' + totalFollowerDelta(report) + ' | ' + manualWeeklyText(report, 'summaryText', autoWeeklySummary(report)));
    lines.push('');
    lines.push('四、项目进度');
    lines.push('产品 | 营销标的 | 参与角色 | 负责人 | 合同金额 | 项目进度说明');
    const projectRows = latestWeeklyProjectRows(report);
    if (projectRows.length) {
      projectRows.forEach(function(row) {
        lines.push([row.product, row.target, row.role, row.owner, row.amount, row.progress].join(' | '));
      });
    } else {
      lines.push('内容电商 | 产品方/资产方 |  |  |  | ');
    }
    lines.push('');
    lines.push('五、AI工作台开发');
    latestWeeklyWorkBenchLines(report).forEach(function(item) { lines.push(item); });
    lines.push('');
    lines.push('六、工时与人员情况');
    lines.push('姓名 | 工时 | 特殊情况说明');
    if ((report.work_hours || []).length) {
      (report.work_hours || []).forEach(function(item) {
        lines.push((item.name || '') + ' | ' + (item.hours || '') + ' | ');
      });
    } else {
      lines.push((rows.leader || '') + ' |  | ');
    }
    lines.push('实习生/新人的学习进度；老员工是否有异常等');
    lines.push('');
    lines.push('七、本周工作计划');
    const plans = latestWeeklyPlanGroups(report);
    const planOffset = report.schedule && report.schedule.snapshot_path ? 1 : 0;
    if (planOffset) lines.push('1、本周排期看板（见周报截图）');
    lines.push((1 + planOffset) + '、账号日常与商单');
    weeklyNumberedItems(plans.account).forEach(function(item) { lines.push(item); });
    lines.push((2 + planOffset) + '、项目跟进');
    weeklyNumberedItems(plans.project).forEach(function(item) { lines.push(item); });
    lines.push((3 + planOffset) + '、工作台开发与使用');
    weeklyNumberedItems(plans.workbench).forEach(function(item) { lines.push(item); });
    lines.push((4 + planOffset) + '、其他');
    weeklyNumberedItems(plans.other).forEach(function(item) { lines.push(item); });
    return lines.join('\n');
  }

  function renderLatestWeeklyReportHtml(report) {
    function td(value, attrs) {
      return '<td' + (attrs ? ' ' + attrs : '') + '>' + htmlEscape(strictBlank(value)) + '</td>';
    }
    function th(value, attrs) {
      return '<th' + (attrs ? ' ' + attrs : '') + '>' + htmlEscape(strictBlank(value)) + '</th>';
    }
    function pLines(lines) {
      return (lines || []).map(function(item) { return '<p>' + htmlEscape(item) + '</p>'; }).join('');
    }
    const rows = weeklyRowsForGroup(report.group);
    const scheduleTotals = totalScheduleCounts(report);
    const profitTarget = weeklyProfitTargetSummary(report);
    const revenueDetailRows = weeklyRevenueDetailRows(report);
    const revenueRows = revenueDetailRows.map(function(row, index) {
      const item = weeklyRevenueFor(report, row[0]);
      const goals = index === 0
        ? td(profitTarget.revenueTarget ? formatWeeklyNumber(profitTarget.revenueTarget) : '', 'rowspan="' + revenueDetailRows.length + '" class="goal-cell"')
          + td(profitTarget.revenueTarget ? formatWeeklyRate(profitTarget.revenueRate) : '', 'rowspan="' + revenueDetailRows.length + '" class="goal-cell"')
          + td(profitTarget.target ? formatWeeklyNumber(profitTarget.target) : '', 'rowspan="' + revenueDetailRows.length + '" class="goal-cell"')
          + td(profitTarget.target ? formatWeeklyRate(profitTarget.rate) : '', 'rowspan="' + revenueDetailRows.length + '" class="goal-cell"')
        : '';
      return '<tr class="detail-row">' + td(row[0]) + td(row[1]) + td(formatWeeklyNumber(item.revenue)) + td(formatWeeklyNumber(item.margin)) + td(formatWeeklyNumber(item.revenue)) + td(formatWeeklyNumber(item.margin)) + goals + '</tr>';
    }).join('');
    const accountRows = rows.accountDataRows.map(function(row) {
      return '<tr>' + td(row[0]) + td(row[1]) + td(latestWeeklyAccountOwner(report, row[0])) + td(latestWeeklyUpdateTarget(report, row[0])) + td(formatWeeklyCount(weeklyMonthPublishedFor(report, row[0]))) + td(latestWeeklyAccountGap(report, row[0])) + td(weeklyFollowerDeltaFor(report, row[0])) + td(latestWeeklyAccountNote(report, row[0])) + '</tr>';
    }).join('');
    const projectRows = latestWeeklyProjectRows(report);
    const projectHtml = (projectRows.length ? projectRows : [{ product: '内容电商', target: '产品方/资产方', role: '', owner: '', amount: '', progress: '' }]).map(function(row) {
      return '<tr>' + td(row.product) + td(row.target) + td(row.role) + td(row.owner) + td(row.amount) + td(row.progress) + '</tr>';
    }).join('');
    const workHours = (report.work_hours || []).length ? report.work_hours : [{ name: rows.leader || '', hours: '' }];
    const workHourHtml = workHours.map(function(item) { return '<tr>' + td(item.name || '') + td(item.hours || '') + td('') + '</tr>'; }).join('');
    const plans = latestWeeklyPlanGroups(report);
    const scheduleSnapshot = report.schedule && report.schedule.snapshot_url
      ? '<h3>1、本周排期看板</h3><img class="schedule-shot" src="' + htmlEscape(report.schedule.snapshot_url) + '" alt="本周排期看板">'
      : '';
    const planOffset = scheduleSnapshot ? 1 : 0;
    return [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + htmlEscape(latestWeeklyTitle(report)) + '</title>',
      '<style>@page{margin:1.35cm;}body{font-family:"Microsoft YaHei",SimSun,sans-serif;color:#243142;line-height:1.55;font-size:11.5pt;}h1{font-size:21pt;text-align:center;margin:0 0 8px;font-weight:700;color:#17365d;letter-spacing:.5px;}h2{font-size:14.5pt;margin:20px 0 8px;padding:5px 9px;border-left:5px solid #2f75b5;background:#eaf2f8;color:#17365d;}h3{font-size:12pt;margin:12px 0 6px;color:#2f5597;}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:7px 0 14px;box-shadow:0 1px 3px rgba(0,0,0,.08);}th,td{border:1px solid #9fbad0;padding:7px 5px;text-align:center;vertical-align:middle;font-size:9.3pt;}th{font-weight:700;background:#1f4e78;color:#fff;}.blue{background:#4472c4}.yellow{background:#bf9000}.detail-row:nth-child(even) td:not(.goal-cell){background:#f7fafc}.goal-cell{background:#fff2cc!important;color:#7f6000;font-weight:700;font-size:10pt;}.total-row td{background:#d9eaf7;color:#c00000;font-weight:700;border-top:2px solid #2f75b5;}.schedule-shot{display:block;width:100%;height:auto;border:1px solid #c8d8e5;border-radius:8px;margin:7px 0 14px;}p{margin:5px 0;}</style>',
      '</head><body>',
      '<h1>' + htmlEscape(latestWeeklyTitle(report)) + '</h1>',
      '<p>' + htmlEscape(latestWeeklyMeetingDate(report)) + '</p>',
      '<h2>一、本月业绩情况</h2>',
      '<h3>1、营收数据</h3>',
      '<table>',
      '<tr>' + th('账号昵称', 'rowspan="2"') + th('平台', 'rowspan="2"') + th('已执行', 'colspan="2" class="blue"') + th('合计', 'colspan="2" class="yellow"') + th('目标流水', 'rowspan="2"') + th('流水完成率', 'rowspan="2"') + th('目标毛利', 'rowspan="2"') + th('目标毛利完成率', 'rowspan="2"') + '</tr>',
      '<tr>' + th('集团流水', 'class="blue"') + th('部门毛利', 'class="blue"') + th('集团流水', 'class="yellow"') + th('部门毛利', 'class="yellow"') + '</tr>',
      revenueRows,
      '<tr class="total-row">' + td('合计') + td('') + td(formatWeeklyNumber(report.profit && report.profit.revenue)) + td(formatWeeklyNumber(report.profit && report.profit.margin)) + td(formatWeeklyNumber(report.profit && report.profit.revenue)) + td(formatWeeklyNumber(report.profit && report.profit.margin)) + td('') + td('') + td('') + td('') + '</tr>',
      '</table>',
      '<p>' + htmlEscape(latestWeeklyMonthLabel(report) + '截止目前共计锁档' + formatWeeklyCount(report.profit && report.profit.count) + '单，部门毛利预估' + formatWeeklyWan(report.profit && report.profit.margin) + '万，人均' + formatWeeklyWan(report.profit && report.profit.per_capita_margin) + '万（实习生除外）。') + '</p>',
      '<h2>二、战略执行项</h2>',
      '<h3>1、完成进度、预计完成时间及卡点</h3>',
      pLines(weeklyStrategyLines(report).length ? weeklyStrategyLines(report) : [weeklyStrategyStatus(report) || '待补充']),
      '<h2>三、账号运营</h2>',
      '<table><tr>' + th('账号昵称') + th('平台') + th('负责人') + th('月更新目标') + th('已发布数量') + th('缺口') + th('净增粉') + th('运营情况说明') + '</tr>',
      accountRows,
      '<tr class="total-row">' + td('合计') + td('') + td('') + td(formatWeeklyCount(totalWeeklyUpdateTarget(report))) + td(formatWeeklyCount(totalWeeklyMonthPublished(report))) + td(formatWeeklyCount(totalWeeklyUpdateGap(report))) + td(totalFollowerDelta(report)) + td(manualWeeklyText(report, 'summaryText', autoWeeklySummary(report))) + '</tr></table>',
      '<h2>四、项目进度</h2>',
      '<table><tr>' + th('产品') + th('营销标的') + th('参与角色') + th('负责人') + th('合同金额') + th('项目进度说明') + '</tr>' + projectHtml + '</table>',
      '<h2>五、AI工作台开发</h2>',
      pLines(latestWeeklyWorkBenchLines(report)),
      '<h2>六、工时与人员情况</h2>',
      '<table><tr>' + th('姓名') + th('工时') + th('特殊情况说明') + '</tr>' + workHourHtml + '</table>',
      '<p>实习生/新人的学习进度；老员工是否有异常等</p>',
      '<h2>七、本周工作计划</h2>',
      scheduleSnapshot,
      '<h3>' + (1 + planOffset) + '、账号日常与商单</h3>' + pLines(weeklyNumberedItems(plans.account)),
      '<h3>' + (2 + planOffset) + '、项目跟进</h3>' + pLines(weeklyNumberedItems(plans.project)),
      '<h3>' + (3 + planOffset) + '、工作台开发与使用</h3>' + pLines(weeklyNumberedItems(plans.workbench)),
      '<h3>' + (4 + planOffset) + '、其他</h3>' + pLines(weeklyNumberedItems(plans.other)),
      '</body></html>'
    ].join('');
  }

  const CRC_TABLE = (function() {
    const table = new Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(buffer) {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const d = date || new Date();
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
      date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  function u16(value) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value & 0xffff, 0);
    return b;
  }

  function u32(value) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0, 0);
    return b;
  }

  function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const stamp = dosDateTime(new Date());
    files.forEach(function(file) {
      const nameBuffer = Buffer.from(file.name, 'utf8');
      const source = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data || ''), 'utf8');
      const compressed = zlib.deflateRawSync(source, { level: 6 });
      const crc = crc32(source);
      const localHeader = Buffer.concat([
        u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(stamp.time), u16(stamp.date),
        u32(crc), u32(compressed.length), u32(source.length), u16(nameBuffer.length), u16(0), nameBuffer
      ]);
      localParts.push(localHeader, compressed);
      centralParts.push(Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(stamp.time), u16(stamp.date),
        u32(crc), u32(compressed.length), u32(source.length), u16(nameBuffer.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), nameBuffer
      ]));
      offset += localHeader.length + compressed.length;
    });
    const centralSize = centralParts.reduce(function(total, part) { return total + part.length; }, 0);
    return Buffer.concat(localParts.concat(centralParts, [
      Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0)])
    ]));
  }

  function docxParagraph(text, options) {
    options = options || {};
    const align = options.align ? '<w:jc w:val="' + options.align + '"/>' : '';
    const spacing = '<w:spacing w:after="' + (options.spacing === undefined ? 80 : options.spacing) + '"/>';
    const pPr = '<w:pPr>' + align + spacing + '</w:pPr>';
    const bold = options.bold ? '<w:b/>' : '';
    const size = '<w:sz w:val="' + (options.size || 24) + '"/>';
    const color = options.color ? '<w:color w:val="' + options.color + '"/>' : '';
    const rPr = '<w:rPr><w:rFonts w:eastAsia="Microsoft YaHei" w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>' + bold + size + color + '</w:rPr>';
    const lines = String(text || '').split(/\r?\n/);
    const runs = lines.map(function(line, index) {
      return '<w:r>' + rPr + (index ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + xmlEscape(line) + '</w:t></w:r>';
    }).join('');
    return '<w:p>' + pPr + (runs || ('<w:r>' + rPr + '<w:t></w:t></w:r>')) + '</w:p>';
  }

  function docxCell(text, options) {
    options = options || {};
    const span = options.gridSpan ? '<w:gridSpan w:val="' + options.gridSpan + '"/>' : '';
    const vMerge = options.vMerge === 'continue' ? '<w:vMerge/>' : (options.vMerge ? '<w:vMerge w:val="' + options.vMerge + '"/>' : '');
    const shade = options.shade ? '<w:shd w:fill="' + options.shade + '"/>' : '';
    const color = options.color || '';
    const width = Number(options.width || 1400);
    return '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/>' + span + vMerge + shade + '<w:vAlign w:val="center"/></w:tcPr>' +
      docxParagraph(text, { bold: options.bold, size: options.size || 18, align: 'center', spacing: 0, color: color }) +
      '</w:tc>';
  }

  function docxTable(rows, options) {
    options = options || {};
    const width = Number(options.width || 15000);
    const borders = '<w:tblBorders><w:top w:val="single" w:sz="6" w:color="111111"/><w:left w:val="single" w:sz="6" w:color="111111"/><w:bottom w:val="single" w:sz="6" w:color="111111"/><w:right w:val="single" w:sz="6" w:color="111111"/><w:insideH w:val="single" w:sz="6" w:color="111111"/><w:insideV w:val="single" w:sz="6" w:color="111111"/></w:tblBorders>';
    const grid = Array.isArray(options.grid) && options.grid.length
      ? '<w:tblGrid>' + options.grid.map(function(col) { return '<w:gridCol w:w="' + Number(col || 0) + '"/>'; }).join('') + '</w:tblGrid>'
      : '';
    return '<w:tbl><w:tblPr><w:tblW w:w="' + width + '" w:type="dxa"/>' + borders + '<w:tblLayout w:type="fixed"/></w:tblPr>' +
      grid +
      rows.map(function(row) { return '<w:tr>' + row.join('') + '</w:tr>'; }).join('') +
      '</w:tbl>' + docxParagraph('', { spacing: 80 });
  }

  function docxImage(relId, width, height) {
    const imageWidth = Math.max(Number(width || 1600), 1);
    const imageHeight = Math.max(Number(height || 900), 1);
    const cx = 5486400;
    const cy = Math.round(cx * imageHeight / imageWidth);
    return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:r><w:drawing>' +
      '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="1" name="本周排期看板"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="schedule.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  function edgeBinaryForWeeklyScreenshot() {
    const candidates = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ];
    return candidates.find(function(file) { return file && fs.existsSync(file); }) || '';
  }

  function weeklyScheduleSnapshotHtml(report) {
    const schedule = report.schedule || {};
    const range = schedule.plan_range || {};
    const tasks = Array.isArray(schedule.plan_tasks) ? schedule.plan_tasks : [];
    const dates = [];
    const start = new Date(String(range.start || '') + 'T00:00:00');
    if (Number.isFinite(start.getTime())) {
      for (let index = 0; index < 7; index += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        dates.push(date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'));
      }
    }
    const weekday = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const columns = dates.map(function(date, index) {
      const items = tasks.filter(function(task) { return String(task && task.date || '').slice(0, 10) === date; });
      const cards = items.length ? items.map(function(task) {
        const stackLabel = isMaterialScheduleTask(task) && materialTaskUnits(task) > 1 ? 'x' + materialTaskUnits(task) : '';
        const meta = [task.person, task.account, task.type, stackLabel].map(function(value) { return String(value || '').trim(); }).filter(Boolean).join(' · ');
        const content = cleanScheduleContent(task.content || task.remark || '待补充');
        return '<article><strong>' + htmlEscape(content) + '</strong><span>' + htmlEscape(meta) + '</span></article>';
      }).join('') : '<div class="empty">暂无排期</div>';
      return '<section><header><b>' + weekday[index] + '</b><small>' + htmlEscape(date.slice(5).replace('-', '/')) + '</small></header>' + cards + '</section>';
    }).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><style>' +
      '*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:#203040;font-family:"Microsoft YaHei",sans-serif;padding:34px}' +
      '.title{display:flex;justify-content:space-between;align-items:end;margin-bottom:22px}.title h1{margin:0;color:#17365d;font-size:30px}.title p{margin:0;color:#66788a;font-size:16px}' +
      '.board{display:grid;grid-template-columns:repeat(7,1fr);gap:12px;align-items:start}section{background:#fff;border:1px solid #c8d8e5;border-radius:14px;min-height:500px;overflow:hidden;box-shadow:0 5px 18px rgba(25,62,92,.08)}' +
      'header{padding:13px 14px;background:#1f4e78;color:#fff;display:flex;justify-content:space-between;align-items:center}header b{font-size:18px}header small{opacity:.82}' +
      'article{margin:10px;padding:11px;border-left:4px solid #e5a93d;border-radius:8px;background:#fff8e9;min-height:78px}article strong{display:block;font-size:14px;line-height:1.45;margin-bottom:8px}article span{display:block;color:#6b7785;font-size:12px;line-height:1.4}.empty{padding:22px 10px;text-align:center;color:#a0aab4;font-size:13px}' +
      '</style></head><body><div class="title"><h1>' + htmlEscape(report.group + ' · 本周排期看板') + '</h1><p>' + htmlEscape((range.start || '') + ' 至 ' + (range.end || '')) + '</p></div><div class="board">' + columns + '</div></body></html>';
  }

  async function createWeeklyScheduleSnapshot(report, req) {
    const edge = edgeBinaryForWeeklyScreenshot();
    if (!edge) return null;
    const outputDir = path.join(root, 'public', 'uploads', 'weekly-reports');
    fs.mkdirSync(outputDir, { recursive: true });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usagi-weekly-schedule-'));
    const htmlPath = path.join(tempDir, 'schedule.html');
    const filename = safeDocFileName('schedule-' + report.group + '-' + (report.schedule && report.schedule.plan_range && report.schedule.plan_range.start || '') + '-' + Date.now().toString(36)) + '.png';
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(htmlPath, weeklyScheduleSnapshotHtml(report), 'utf8');
    const planTasks = Array.isArray(report.schedule && report.schedule.plan_tasks) ? report.schedule.plan_tasks : [];
    const perDay = new Map();
    planTasks.forEach(function(task) {
      const date = String(task && task.date || '').slice(0, 10);
      if (date) perDay.set(date, (perDay.get(date) || 0) + 1);
    });
    const maxPerDay = Math.max(0, ...perDay.values());
    const height = Math.max(760, Math.min(1800, 230 + maxPerDay * 100));
    const ok = await new Promise(function(resolve) {
      const child = spawn(edge, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--run-all-compositor-stages-before-draw',
        '--user-data-dir=' + path.join(tempDir, 'edge-profile'),
        '--window-size=1600,' + height, '--screenshot=' + outputPath,
        'file:///' + htmlPath.replace(/\\/g, '/')
      ], { windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(function() { try { child.kill(); } catch (e) {} resolve(false); }, 20000);
      child.on('error', function() { clearTimeout(timer); resolve(false); });
      child.on('close', function(code) { clearTimeout(timer); resolve(code === 0 && fs.existsSync(outputPath)); });
    });
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    if (!ok) return null;
    const relativeUrl = '/uploads/weekly-reports/' + encodeURIComponent(filename);
    return { path: outputPath, relative_url: relativeUrl, url: absolutePublicUrl(relativeUrl, req), width: 1600, height: height };
  }

  function createLatestWeeklyDocumentXml(report) {
    const rows = weeklyRowsForGroup(report.group);
    const revenueDetailRows = weeklyRevenueDetailRows(report);
    const scheduleTotals = totalScheduleCounts(report);
    const revenueWidths = [1050, 620, 1100, 1100, 1100, 1100, 950, 950, 950, 1050];
    const accountWidths = [1200, 900, 900, 1100, 1100, 900, 900, 2800];
    const projectWidths = [900, 1200, 900, 900, 900, 4200];
    const workHourWidths = [2200, 2200, 7000];
    function revenueCell(index, text, options) {
      return docxCell(text, Object.assign({ width: revenueWidths[index] || 1200 }, options || {}));
    }
    function accountCell(index, text, options) {
      return docxCell(text, Object.assign({ width: accountWidths[index] || 1200 }, options || {}));
    }
    function projectCell(index, text, options) {
      return docxCell(text, Object.assign({ width: projectWidths[index] || 1200 }, options || {}));
    }
    function workHourCell(index, text, options) {
      return docxCell(text, Object.assign({ width: workHourWidths[index] || 1200 }, options || {}));
    }
    const revenueTable = [
      [
        revenueCell(0, '账号昵称', { bold: true, shade: '1F4E78', color: 'FFFFFF', vMerge: 'restart' }),
        revenueCell(1, '平台', { bold: true, shade: '1F4E78', color: 'FFFFFF', vMerge: 'restart' }),
        revenueCell(2, '已执行', { bold: true, shade: '4472C4', color: 'FFFFFF', gridSpan: 2, width: revenueWidths[2] + revenueWidths[3] }),
        revenueCell(4, '合计', { bold: true, shade: 'BF9000', color: 'FFFFFF', gridSpan: 2, width: revenueWidths[4] + revenueWidths[5] }),
        revenueCell(6, '目标流水', { bold: true, shade: '1F4E78', color: 'FFFFFF', vMerge: 'restart' }),
        revenueCell(7, '流水完成率', { bold: true, shade: '1F4E78', color: 'FFFFFF', vMerge: 'restart' }),
        revenueCell(8, '目标毛利', { bold: true, shade: '1F4E78', color: 'FFFFFF', vMerge: 'restart' }),
        revenueCell(9, '目标毛利完成率', { bold: true, shade: '1F4E78', color: 'FFFFFF', vMerge: 'restart' })
      ],
      [
        revenueCell(0, '', { bold: true, shade: 'F2F2F2', vMerge: 'continue' }),
        revenueCell(1, '', { bold: true, shade: 'F2F2F2', vMerge: 'continue' }),
        revenueCell(2, '集团流水', { bold: true, shade: 'D9EAF7', color: '17365D' }),
        revenueCell(3, '部门毛利', { bold: true, shade: 'D9EAF7', color: '17365D' }),
        revenueCell(4, '集团流水', { bold: true, shade: 'FFF2CC', color: '7F6000' }),
        revenueCell(5, '部门毛利', { bold: true, shade: 'FFF2CC', color: '7F6000' }),
        revenueCell(6, '', { bold: true, shade: 'F2F2F2', vMerge: 'continue' }),
        revenueCell(7, '', { bold: true, shade: 'F2F2F2', vMerge: 'continue' }),
        revenueCell(8, '', { bold: true, shade: 'F2F2F2', vMerge: 'continue' }),
        revenueCell(9, '', { bold: true, shade: 'F2F2F2', vMerge: 'continue' })
      ]
    ];
    const profitTarget = weeklyProfitTargetSummary(report);
    revenueDetailRows.forEach(function(row, index) {
      const item = weeklyRevenueFor(report, row[0]);
      const stripe = index % 2 ? 'F7FAFC' : 'FFFFFF';
      const merge = index === 0 ? 'restart' : 'continue';
      revenueTable.push([
        revenueCell(0, row[0], { shade: stripe }),
        revenueCell(1, row[1], { shade: stripe }),
        revenueCell(2, formatWeeklyNumber(item.revenue), { shade: stripe }),
        revenueCell(3, formatWeeklyNumber(item.margin), { shade: stripe }),
        revenueCell(4, formatWeeklyNumber(item.revenue), { shade: stripe }),
        revenueCell(5, formatWeeklyNumber(item.margin), { shade: stripe }),
        revenueCell(6, index === 0 && profitTarget.revenueTarget ? formatWeeklyNumber(profitTarget.revenueTarget) : '', { bold: true, shade: 'FFF2CC', color: '7F6000', vMerge: merge }),
        revenueCell(7, index === 0 && profitTarget.revenueTarget ? formatWeeklyRate(profitTarget.revenueRate) : '', { bold: true, shade: 'FFF2CC', color: '7F6000', vMerge: merge }),
        revenueCell(8, index === 0 && profitTarget.target ? formatWeeklyNumber(profitTarget.target) : '', { bold: true, shade: 'FFF2CC', color: '7F6000', vMerge: merge }),
        revenueCell(9, index === 0 && profitTarget.target ? formatWeeklyRate(profitTarget.rate) : '', { bold: true, shade: 'FFF2CC', color: '7F6000', vMerge: merge })
      ]);
    });
    revenueTable.push([
      revenueCell(0, '合计', { bold: true, color: 'C00000', shade: 'D9EAF7' }),
      revenueCell(1, '', { color: 'C00000', shade: 'D9EAF7' }),
      revenueCell(2, formatWeeklyNumber(report.profit && report.profit.revenue), { bold: true, color: 'C00000', shade: 'D9EAF7' }),
      revenueCell(3, formatWeeklyNumber(report.profit && report.profit.margin), { bold: true, color: 'C00000', shade: 'D9EAF7' }),
      revenueCell(4, formatWeeklyNumber(report.profit && report.profit.revenue), { bold: true, color: 'C00000', shade: 'D9EAF7' }),
      revenueCell(5, formatWeeklyNumber(report.profit && report.profit.margin), { bold: true, color: 'C00000', shade: 'D9EAF7' }),
      revenueCell(6, '', { shade: 'D9EAF7' }),
      revenueCell(7, '', { shade: 'D9EAF7' }),
      revenueCell(8, '', { shade: 'D9EAF7' }),
      revenueCell(9, '', { shade: 'D9EAF7' })
    ]);
    const accountTable = [['账号昵称', '平台', '负责人', '月更新目标', '已发布数量', '缺口', '净增粉', '运营情况说明'].map(function(text, index) { return accountCell(index, text, { bold: true, shade: '1F4E78', color: 'FFFFFF' }); })];
    rows.accountDataRows.forEach(function(row, index) {
      const shade = index % 2 ? 'F7FAFC' : 'FFFFFF';
      accountTable.push([accountCell(0, row[0], { shade: shade }), accountCell(1, row[1], { shade: shade }), accountCell(2, latestWeeklyAccountOwner(report, row[0]), { shade: shade }), accountCell(3, latestWeeklyUpdateTarget(report, row[0]), { shade: 'E2F0D9', bold: true }), accountCell(4, formatWeeklyCount(weeklyMonthPublishedFor(report, row[0])), { shade: shade }), accountCell(5, latestWeeklyAccountGap(report, row[0]), { shade: 'FFF2CC', bold: true }), accountCell(6, weeklyFollowerDeltaFor(report, row[0]), { shade: shade }), accountCell(7, latestWeeklyAccountNote(report, row[0]), { shade: shade })]);
    });
    accountTable.push([accountCell(0, '合计', { bold: true, color: 'C00000', shade: 'D9EAF7' }), accountCell(1, '', { shade: 'D9EAF7' }), accountCell(2, '', { shade: 'D9EAF7' }), accountCell(3, formatWeeklyCount(totalWeeklyUpdateTarget(report)), { bold: true, color: 'C00000', shade: 'D9EAF7' }), accountCell(4, formatWeeklyCount(totalWeeklyMonthPublished(report)), { bold: true, color: 'C00000', shade: 'D9EAF7' }), accountCell(5, formatWeeklyCount(totalWeeklyUpdateGap(report)), { bold: true, color: 'C00000', shade: 'D9EAF7' }), accountCell(6, totalFollowerDelta(report), { color: 'C00000', shade: 'D9EAF7' }), accountCell(7, manualWeeklyText(report, 'summaryText', autoWeeklySummary(report)), { color: 'C00000', shade: 'D9EAF7' })]);
    const projectRows = latestWeeklyProjectRows(report);
    const projectTable = [['产品', '营销标的', '参与角色', '负责人', '合同金额', '项目进度说明'].map(function(text, index) { return projectCell(index, text, { bold: true, shade: '1F4E78', color: 'FFFFFF' }); })];
    (projectRows.length ? projectRows : [{ product: '内容电商', target: '产品方/资产方', role: '', owner: '', amount: '', progress: '' }]).forEach(function(row) {
      projectTable.push([projectCell(0, row.product), projectCell(1, row.target), projectCell(2, row.role), projectCell(3, row.owner), projectCell(4, row.amount), projectCell(5, row.progress)]);
    });
    const workHours = (report.work_hours || []).length ? report.work_hours : [{ name: rows.leader || '', hours: '' }];
    const workHourTable = [['姓名', '工时', '特殊情况说明'].map(function(text, index) { return workHourCell(index, text, { bold: true, shade: '1F4E78', color: 'FFFFFF' }); })];
    workHours.forEach(function(item) { workHourTable.push([workHourCell(0, item.name || ''), workHourCell(1, item.hours || ''), workHourCell(2, '')]); });
    const strategyLines = weeklyStrategyLines(report);
    const plans = latestWeeklyPlanGroups(report);
    const hasScheduleSnapshot = Boolean(report.schedule && report.schedule.snapshot_path);
    const planOffset = hasScheduleSnapshot ? 1 : 0;
    const body = [
      docxParagraph(latestWeeklyTitle(report), { align: 'center', bold: true, size: 40, spacing: 160, color: '17365D' }),
      docxParagraph(latestWeeklyMeetingDate(report), { size: 22, color: '5B6573' }),
      docxParagraph('一、本月业绩情况', { bold: true, size: 28, color: '1F4E78' }),
      docxParagraph('1、营收数据', { bold: true, size: 24, color: '2F5597' }),
      docxTable(revenueTable, { width: 9950, grid: revenueWidths }),
      docxParagraph(latestWeeklyMonthLabel(report) + '截止目前共计锁档' + formatWeeklyCount(report.profit && report.profit.count) + '单，部门毛利预估' + formatWeeklyWan(report.profit && report.profit.margin) + '万，人均' + formatWeeklyWan(report.profit && report.profit.per_capita_margin) + '万（实习生除外）。', { size: 24 }),
      docxParagraph('二、战略执行项', { bold: true, size: 28, color: '1F4E78' }),
      docxParagraph('1、完成进度、预计完成时间及卡点', { bold: true, size: 24, color: '2F5597' })
    ];
    (strategyLines.length ? strategyLines : [weeklyStrategyStatus(report) || '待补充']).forEach(function(item) { body.push(docxParagraph(item, { size: 24 })); });
    body.push(docxParagraph('三、账号运营', { bold: true, size: 28, color: '1F4E78' }));
    body.push(docxTable(accountTable, { width: 11200, grid: accountWidths }));
    body.push(docxParagraph('四、项目进度', { bold: true, size: 28, color: '1F4E78' }));
    body.push(docxTable(projectTable, { width: 10000, grid: projectWidths }));
    body.push(docxParagraph('五、AI工作台开发', { bold: true, size: 28, color: '1F4E78' }));
    weeklyNumberedItems(latestWeeklyWorkBenchLines(report)).forEach(function(item) { body.push(docxParagraph(item, { size: 24 })); });
    body.push(docxParagraph('六、工时与人员情况', { bold: true, size: 28, color: '1F4E78' }));
    body.push(docxTable(workHourTable, { width: 11400, grid: workHourWidths }));
    body.push(docxParagraph('实习生/新人的学习进度；老员工是否有异常等', { size: 24 }));
    body.push(docxParagraph('七、本周工作计划', { bold: true, size: 28, color: '1F4E78' }));
    if (hasScheduleSnapshot) {
      body.push(docxParagraph('1、本周排期看板', { bold: true, size: 24, color: '2F5597' }));
      body.push(docxImage('rIdSchedule', report.schedule.snapshot_width, report.schedule.snapshot_height));
    }
    body.push(docxParagraph((1 + planOffset) + '、账号日常与商单', { bold: true, size: 24, color: '2F5597' }));
    weeklyNumberedItems(plans.account).forEach(function(item) { body.push(docxParagraph(item, { size: 24 })); });
    body.push(docxParagraph((2 + planOffset) + '、项目跟进', { bold: true, size: 24, color: '2F5597' }));
    weeklyNumberedItems(plans.project).forEach(function(item) { body.push(docxParagraph(item, { size: 24 })); });
    body.push(docxParagraph((3 + planOffset) + '、工作台开发与使用', { bold: true, size: 24, color: '2F5597' }));
    weeklyNumberedItems(plans.workbench).forEach(function(item) { body.push(docxParagraph(item, { size: 24 })); });
    body.push(docxParagraph((4 + planOffset) + '、其他', { bold: true, size: 24, color: '2F5597' }));
    weeklyNumberedItems(plans.other).forEach(function(item) { body.push(docxParagraph(item, { size: 24 })); });
    body.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body.join('') + '</w:body></w:document>';
  }

  function createWeeklyDocxBuffer(report) {
    const snapshotPath = report.schedule && report.schedule.snapshot_path;
    const hasSnapshot = snapshotPath && fs.existsSync(snapshotPath);
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + (hasSnapshot ? '<Default Extension="png" ContentType="image/png"/>' : '') + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/document.xml', data: createLatestWeeklyDocumentXml(report) }
    ];
    if (hasSnapshot) {
      files.push({ name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSchedule" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/schedule.png"/></Relationships>' });
      files.push({ name: 'word/media/schedule.png', data: fs.readFileSync(snapshotPath) });
    }
    return createZip(files);
  }

  function writeWeeklyWordFile(report, req) {
    const dir = path.join(root, 'public', 'uploads', 'weekly-reports');
    fs.mkdirSync(dir, { recursive: true });
    const basename = safeDocFileName((report.title || strictWeeklyTitle(report)) + '-' + Date.now().toString(36)) + '.docx';
    const filePath = path.join(dir, basename);
    const relativeUrl = '/uploads/weekly-reports/' + encodeURIComponent(basename);
    fs.writeFileSync(filePath, createWeeklyDocxBuffer(report));
    return {
      path: filePath,
      url: absolutePublicUrl(relativeUrl, req),
      relative_url: relativeUrl,
      filename: basename
    };
  }

  async function buildWeeklyReport(job) {
    const payload = job.payload || {};
    const range = payload.range && payload.range.start ? payload.range : weekRange(payload.weekOffset || 0);
    const group = normalizeWeeklyGroup(payload.group || '内容二组');
    const groupRows = weeklyRowsForGroup(group);
    const auth = payload._auth || {};
    const update = function(stage, message, patch) {
      Object.assign(job, patch || {}, {
        stage: stage || job.stage,
        message: message || job.message,
        updated_at: now()
      });
      if (typeof job.on_update === 'function') {
        try { job.on_update(job); } catch (e) {}
      }
    };

    update('collecting', '读取流水看板', { progress: 18 });
    const reportMonth = currentMonthParts(payload);
    const profitData = await routeData('/api/profit/list', { _auth: auth, grp: group, year: reportMonth.year, month: reportMonth.month, limit: 500 });
    const lastYearProfitData = await routeData('/api/profit/list', { _auth: auth, grp: group, year: reportMonth.year ? reportMonth.year - 1 : 0, month: reportMonth.month, limit: 500 });
    const profitRows = filterWeeklyProfitRows(pickRows(profitData), group);
    const lastYearProfitRows = filterWeeklyProfitRows(pickRows(lastYearProfitData), group);
    const monthLabel = monthLabelFromParts(reportMonth);
    const profit = Object.assign(summarizeProfitRows(profitRows, monthLabel), {
      last_year: summarizeProfitRows(lastYearProfitRows, monthLabel),
      yoy_basis: '按当前周报账号白名单对齐去年同月流水',
      error: profitData && profitData.error || ''
    });
    profit.year = reportMonth.year;
    profit.month = reportMonth.month;
    profit.last_year.year = reportMonth.year ? reportMonth.year - 1 : 0;
    profit.last_year.month = reportMonth.month;
    profit.last_year.error = lastYearProfitData && lastYearProfitData.error || '';
    profit.member_count = groupRows.members.length;
    profit.per_capita_margin = profit.member_count ? Number(profit.margin || 0) / profit.member_count : 0;
    profit.yoy_margin_rate = profit.last_year && profit.last_year.margin ? (Number(profit.margin || 0) - Number(profit.last_year.margin || 0)) / Number(profit.last_year.margin || 0) * 100 : null;
    profit.yoy_revenue_rate = profit.last_year && profit.last_year.revenue ? (Number(profit.revenue || 0) - Number(profit.last_year.revenue || 0)) / Number(profit.last_year.revenue || 0) * 100 : null;

    update('collecting', '读取排期看板', { progress: 35 });
    const scheduleData = await routeData('/api/schedule/load', { _auth: auth });
    const scheduleRows = pickRows(scheduleData);
    const scheduleStats = groupSchedule(scheduleRows, range.start, range.end, group);
    const monthStart = reportMonth.year && reportMonth.month
      ? reportMonth.year + '-' + String(reportMonth.month).padStart(2, '0') + '-01'
      : range.start;
    const monthEndDate = reportMonth.year && reportMonth.month
      ? new Date(reportMonth.year, reportMonth.month, 0)
      : new Date(String(range.end || range.start) + 'T00:00:00');
    const monthEnd = monthEndDate.getFullYear() + '-' + String(monthEndDate.getMonth() + 1).padStart(2, '0') + '-' + String(monthEndDate.getDate()).padStart(2, '0');
    const monthlyScheduleStats = groupSchedule(scheduleRows, monthStart, monthEnd, group);
    const planRange = weekRange(0);
    const planScheduleStats = groupSchedule(scheduleRows, planRange.start, planRange.end, group);

    update('accounts', '整理账号数据', { progress: 52 });
    const linkedAccounts = parseAccountLines(payload.accountsText || '');
    let accountResults = weeklyAccountDefaults(group);
    if (linkedAccounts.length) {
      accountResults = [];
      for (let i = 0; i < linkedAccounts.length; i += 1) {
        const account = linkedAccounts[i];
        update('accounts', 'OpenCLI 查询账号 ' + (i + 1) + '/' + linkedAccounts.length + '：' + account.name, {
          account_progress: { current: i + 1, total: linkedAccounts.length, name: account.name },
          account_results: accountResults,
          progress: 52 + Math.round((i / Math.max(linkedAccounts.length, 1)) * 18)
        });
        try {
          const result = await inspectAccountWithOpenCli(account, i, function(status, detail) {
            update('accounts', detail, { account_progress: { current: i + 1, total: linkedAccounts.length, name: account.name, status: status } });
          });
          accountResults.push(Object.assign({}, result, { fans_delta: result.fans_delta || '0' }));
        } catch (e) {
          accountResults.push(Object.assign({}, account, { status: 'failed', fans_delta: '0', error: e.message || String(e) }));
        }
        update('accounts', '账号完成 ' + (i + 1) + '/' + linkedAccounts.length, { account_results: accountResults });
      }
    }

    update('drafting', '汇总周报结构', { progress: 60, account_results: accountResults });
    const members = groupRows.members;
    const workHours = members.map(function(name) { return { name: name, hours: '' }; });
    const explicitPlans = Array.from(new Set(normalizeWeeklyLines(payload.nextPlansText || ''))).slice(0, 5);
    const scheduledPlans = summarizeSchedulePlans(planScheduleStats.tasks, 8);
    const nextPlans = explicitPlans.length ? explicitPlans : scheduledPlans;
    const strategyItems = normalizeWeeklyLines(payload.strategyText || payload.strategyItemsText || payload.strategy_items || '').slice(0, 12);
    const strategyStatus = String(payload.strategyStatusText || payload.strategyStatus || payload.strategy_status || '').trim();
    const materialStats = materialStatsForTasks(scheduleStats.materialTasks);
    const monthlyMaterialStats = materialStatsForTasks(monthlyScheduleStats.materialTasks);
    const accountMetrics = {};
    groupRows.accountDataRows.forEach(function(row) {
      const metric = weeklyDashboardMetric(row[0], row[1]);
      if (metric) accountMetrics[canonicalWeeklyAccountName(row[0]) + '|' + row[1]] = metric;
    });

    const report = {
      title: group + '周报-' + range.start + '至' + range.end,
      group: group,
      leader: groupRows.leader,
      range: range,
      profit: profit,
      schedule: {
        tasks: scheduleStats.tasks,
        total: scheduleStats.tasks.length,
        completed: scheduleStats.completed.length,
        by_type: scheduleStats.byType,
        by_account: scheduleStats.byAccount,
        monthly_by_account: monthlyScheduleStats.byAccount,
        material_count: materialStats.count,
        material_units: materialStats.units,
        monthly_material_count: monthlyMaterialStats.count,
        monthly_material_units: monthlyMaterialStats.units,
        material_tasks: scheduleStats.materialTasks,
        plan_range: planRange,
        plan_tasks: planScheduleStats.tasks,
        summary: ''
      },
      accounts: accountResults,
      account_metrics: accountMetrics,
      work_hours: workHours,
      strategy_items: strategyItems,
      strategy_status: strategyStatus,
      next_plans: nextPlans,
      manual: {
        performanceText: payload.performanceText || '',
        landingText: payload.landingText || '',
        summaryText: payload.summaryText || '',
        nextPlansText: payload.nextPlansText || '',
        strategyText: payload.strategyText || payload.strategyItemsText || '',
        strategyStatusText: strategyStatus,
        workbenchText: payload.workbenchText || ''
      },
      generated_at: now()
    };
    applyWeeklyProfitTarget(report, payload);
    update('ai', 'AI 整理周报表述', { progress: 72, account_results: accountResults });
    await refineWeeklyReportWithAi(report, scheduleRows, range);
    update('writing', '生成本周排期看板截图', { progress: 80, account_results: accountResults });
    const scheduleSnapshot = await createWeeklyScheduleSnapshot(report, payload._req);
    if (scheduleSnapshot) {
      report.schedule.snapshot_path = scheduleSnapshot.path;
      report.schedule.snapshot_url = scheduleSnapshot.url;
      report.schedule.snapshot_relative_url = scheduleSnapshot.relative_url;
      report.schedule.snapshot_width = scheduleSnapshot.width;
      report.schedule.snapshot_height = scheduleSnapshot.height;
    }
    update('writing', '生成周报文档', { progress: 84, account_results: accountResults });
    report.title = latestWeeklyTitle(report);
    report.text = renderLatestWeeklyReportText(report);
    report.html = renderLatestWeeklyReportHtml(report);
    const word = writeWeeklyWordFile(report, payload._req);
    report.filename = word.filename;
    report.word_path = word.path;
    report.word_url = word.url;
    report.word_relative_url = word.relative_url;
    update('writing', 'Word 已生成，正在写入飞书', { progress: 88 });
    const feishuRoute = routes['/api/to-feishu'];
    if (feishuRoute) {
      try {
        const feishuData = await toPromise(feishuRoute, {
          _auth: auth,
          title: strictWeeklyTitle(report),
          content: report.text,
          doc_id: payload.feishuDocId || payload.doc_id || '',
          tool: 'doc'
        });
        report.feishu = feishuData;
        report.feishu_url = feishuUrlFromResult(feishuData);
      } catch (e) {
        report.feishu = { error: e.message || String(e) };
        report.feishu_error = e.message || String(e);
      }
    }
    const record = await weeklyStore.save({
      group_name: group,
      leader_name: groupRows.leader,
      range_start: range.start,
      range_end: range.end,
      title: strictWeeklyTitle(report),
      status: 'done',
      report: report,
      text: report.text,
      html: report.html,
      word_path: report.word_path,
      word_url: report.word_url,
      feishu_url: report.feishu_url || '',
      created_by: auth.id || 0,
      created_by_name: auth.display_name || auth.username || ''
    });
    report.record_id = record.id;
    update('done', '周报已留存', { progress: 100 });
    return report;
  }

  function dayOffset(dateText, offset) {
    const base = dateText ? new Date(String(dateText).slice(0, 10) + 'T00:00:00') : new Date();
    if (Number.isNaN(base.getTime())) return '';
    base.setDate(base.getDate() + Number(offset || 0));
    return base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0') + '-' + String(base.getDate()).padStart(2, '0');
  }

  function defaultDailyDates(payload) {
    const reportDate = String(payload && (payload.date || payload.reportDate || payload.report_date) || '').slice(0, 10) || dayOffset('', 0);
    const dataDate = String(payload && (payload.dataDate || payload.data_date) || '').slice(0, 10) || dayOffset(reportDate, -1);
    const nextDate = String(payload && (payload.nextDate || payload.next_date) || '').slice(0, 10) || dayOffset(reportDate, 1);
    return { reportDate: reportDate, dataDate: dataDate, nextDate: nextDate };
  }

  function dailyTitle(group, reportDate) {
    return normalizeWeeklyGroup(group).replace(/^内容/, '') + '-日报 ' + reportDate;
  }

  function statusLabelFromTask(task) {
    const stage = String(task && task.workflow_stage || '').trim();
    const status = String(task && task.status || '').trim();
    const progress = String(task && task.progress || '').trim();
    if (stage) return stage;
    if (/done|finish|completed|已完成|完成/i.test(status + progress)) return '已完成';
    if (/delay|延期|逾期/i.test(status + progress)) return '延期中';
    if (/running|doing|执行|推进/i.test(status + progress)) return '执行中';
    return progress || status || '推进中';
  }

  function projectStatusFromTask(task) {
    const text = [task && task.progress, task && task.remark, task && task.status, task && task.workflow_stage].map(function(value) { return String(value || ''); }).join(' ');
    const date = String(task && task.date || '').slice(5).replace('-', '.');
    if (/延期/.test(text)) return text.match(/延期[^\s，。；、]*/)?.[0] || '延期中';
    if (/汇报|复盘|结案|对齐/.test(text)) return '汇报';
    if (/已发布/.test(text)) return '已发布';
    if (/待发布/.test(text)) return '待发布';
    if (/后期|剪辑|录制|素材/.test(text)) return '素材录制中';
    if (/文案|脚本|大纲/.test(text)) return '文案';
    return date ? '执行中-' + date : '执行中';
  }

  function taskDoneOrPublished(task) {
    const text = [task && task.status, task && task.progress, task && task.workflow_stage, task && task.remark]
      .map(function(value) { return String(value || ''); })
      .join(' ');
    return /已发布|已完成|完成|done|finish|completed/i.test(text);
  }

  function taskStillActive(task) {
    const text = [task && task.status, task && task.progress, task && task.workflow_stage, task && task.remark]
      .map(function(value) { return String(value || ''); })
      .join(' ');
    if (taskDoneOrPublished(task)) return false;
    if (/延期|逾期|执行中|推进中|文案|脚本|大纲|后期|剪辑|录制|待发布|素材录制|修改|反馈/.test(text)) return true;
    return true;
  }

  function platformFromTask(task) {
    const text = [task && task.platform, task && task.account, task && task.content, task && task.remark, task && task.type].map(function(value) { return String(value || ''); }).join(' ');
    if (/b站|bilibili|哔哩/i.test(text)) return 'B站';
    if (/抖音|douyin/i.test(text)) return '抖音';
    if (/带货|电商|GMV/i.test(text)) return '项目';
    return weeklyPlatformFor(task && task.account);
  }

  function extractProjectName(task) {
    const content = cleanScheduleContent(task && task.content);
    const remark = String(task && task.remark || '').trim();
    const text = content || remark || '未命名项目';
    const cleaned = text.replace(/^(商单|日常|星广联投|CPM|素材代做)[-｜|:：\s]*/i, '');
    return cleaned.split(/[，。；;\n]/)[0].trim() || text;
  }

  function dailyOutputLine(task) {
    return [
      String(task && task.type || '').trim() || '任务',
      String(task && task.account || '').trim(),
      cleanScheduleContent(task && task.content),
      statusLabelFromTask(task)
    ].filter(Boolean).join('-');
  }

  function dailyProjectLine(task) {
    return [
      String(task && task.type || '').trim() || '项目',
      String(task && task.account || '').trim(),
      extractProjectName(task),
      projectStatusFromTask(task)
    ].filter(Boolean).join('-');
  }

  function isDailyOutputTask(task) {
    const text = [task && task.type, task && task.content, task && task.workflow_stage].map(function(value) { return String(value || ''); }).join(' ');
    if (isMaterialScheduleTask(task)) return true;
    return /日常|商单|星广|CPM|发布|文案|后期|待发布|已发布/.test(text);
  }

  function isProjectProgressTask(task) {
    const type = String(task && task.type || '').trim();
    const business = [type, task && task.business_type, task && task.category, task && task.content, task && task.remark]
      .map(function(value) { return String(value || ''); })
      .join(' ');
    const allText = [business, task && task.progress, task && task.workflow_stage].map(function(value) { return String(value || ''); }).join(' ');
    if (/移交|handoff/i.test(allText)) return false;
    if (/日常|周事件|选题|热点/.test(type)) return false;
    if (isMaterialScheduleTask(task)) return true;
    return /商单|商业|星广|CPM|项目|带货|电商|GMV|推广|合作|广告|植入/.test(business);
  }

  function uniqueLines(lines, limit) {
    return Array.from(new Set((lines || []).map(function(line) { return String(line || '').trim(); }).filter(Boolean))).slice(0, limit || 50);
  }

  function groupDailySchedule(scheduleRows, group, dates) {
    const scoped = (scheduleRows || []).filter(function(task) {
      return taskMatchesWeeklyGroup(task, group) && !Number(task && task.schedule_hidden || 0);
    });
    const todayTasks = scoped.filter(function(task) { return String(task && task.date || '').slice(0, 10) === dates.reportDate; });
    const nextTasks = scoped.filter(function(task) { return String(task && task.date || '').slice(0, 10) === dates.nextDate; });
    const activeStart = dayOffset(dates.reportDate, -14);
    const recentProjectTasks = scoped.filter(function(task) {
      const date = String(task && task.date || '').slice(0, 10);
      if (!isProjectProgressTask(task)) return false;
      return date >= activeStart && date <= dates.reportDate && taskStillActive(task);
    });
    const outputs = uniqueLines(todayTasks.filter(isDailyOutputTask).map(dailyOutputLine), 12);
    const nextPlans = uniqueLines(nextTasks.filter(isDailyOutputTask).map(dailyOutputLine), 8);
    const projectRows = recentProjectTasks.map(function(task) {
      return {
        platform: platformFromTask(task),
        line: dailyProjectLine(task),
        date: String(task && task.date || '').slice(0, 10),
        account: String(task && task.account || '').trim(),
        type: String(task && task.type || '').trim(),
        status: projectStatusFromTask(task),
        raw: task
      };
    });
    const byPlatform = {};
    projectRows.forEach(function(row) {
      const key = row.platform || '项目';
      if (!byPlatform[key]) byPlatform[key] = [];
      if (!byPlatform[key].some(function(item) { return item.line === row.line; })) byPlatform[key].push(row);
    });
    return {
      outputs: outputs,
      next_plans: nextPlans,
      projects: projectRows,
      projects_by_platform: byPlatform,
      today_count: todayTasks.length,
      next_count: nextTasks.length
    };
  }

  function profitRowMatchesDailyGroup(row, group) {
    const target = normalizeWeeklyGroup(group);
    const groupFields = [
      row && row.grp,
      row && row.group,
      row && row.group_name,
      row && row['组别'],
      row && row.origin_group,
      row && row.producer_group
    ].map(function(value) { return String(value || '').trim(); }).filter(Boolean);
    if (groupFields.some(function(value) { return normalizeWeeklyGroup(value) === target; })) return true;
    const account = normalizeDailyAccountKey(row && (row.account || row.account_name || row.name || row['账号昵称']));
    return Boolean(account && dailyGroupAccountKeys(target).has(account));
  }

  function dailyRevenueSummary(profitRows, group, reportDate) {
    const monthLabel = monthLabelFromRange({ start: reportDate });
    const scoped = (profitRows || []).filter(function(row) {
      return profitRowMatchesDailyGroup(row, group) && profitRowInDailyMonth(row, reportDate, monthLabel);
    });
    const onePriceRows = scoped.filter(function(row) {
      const businessType = String(row && (row.business_type || row.category) || '').trim();
      if (businessType) return /一口价/.test(businessType) && !/非一口价/.test(businessType);
      return !/非一口价/.test(String(row && row.platform || ''));
    });
    const nonOnePriceRows = scoped.filter(function(row) { return onePriceRows.indexOf(row) < 0; });
    const locked = onePriceRows.reduce(function(total, row) {
      return total + firstPositiveField(row, ['order_amount', 'orderAmount', '锁档金额', '一口价']);
    }, 0);
    const executed = onePriceRows.reduce(function(total, row) {
      return total + firstPositiveField(row, ['revenue', 'fee', 'amount', 'tax_revenue', 'final_amount', 'group_revenue', '集团流水', '最终合作价格']);
    }, 0);
    const other = nonOnePriceRows.reduce(function(total, row) {
      return total + firstPositiveField(row, ['revenue', 'fee', 'amount', 'tax_revenue', 'final_amount', 'group_revenue', '集团流水', '最终合作价格']);
    }, 0);
    const margin = scoped.reduce(function(total, row) {
      return total + firstPositiveField(row, ['margin', 'profit', 'department_margin', '部门毛利']);
    }, 0);
    return {
      month_label: monthLabel,
      locked: locked,
      executed: executed,
      other: other,
      total: executed + other,
      gross_margin: margin,
      count: scoped.length,
      note: scoped.length ? '来自流水看板当月记录（按组别过滤）' : '流水看板暂无当月记录'
    };
  }

  function formatMoneyWan(value) {
    const n = Number(value) || 0;
    if (!n) return '0';
    const wan = n / 10000;
    return (Math.round(wan * 10) / 10) + 'w';
  }

  function formatWorkMetrics(work) {
    function metric(value) {
      const n = Number(value) || 0;
      if (n < 10000) return formatWeeklyCount(n);
      return String(Math.round(n / 1000) / 10).replace(/\.0$/, '') + 'w';
    }
    return [
      metric(work.views) + '播放',
      metric(work.likes) + '点赞',
      metric(work.comments) + '评论',
      metric(work.favorites) + '收藏',
      metric(work.shares) + '转发'
    ].join('，');
  }

  function shortDateLabel(dateText) {
    const text = String(dateText || '').slice(0, 10);
    if (!text) return '';
    return text.slice(5).replace('-', '.');
  }

  function workHotScore(work) {
    return Number(work && work.hotIndex || 0)
      || Number(work && work.views || 0)
      + Number(work && work.likes || 0) * 8
      + Number(work && work.comments || 0) * 30
      + Number(work && work.favorites || 0) * 12
      + Number(work && work.shares || 0) * 20;
  }

  function normalizeDailyAccountKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s·丶_\-—]+/g, '');
  }

  function normalizeDailyTitleKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[＃#][^\s#＃]+/g, '')
      .replace(/\s+/g, '')
      .replace(/[，。！？、,.!?;；:："'“”‘’（）()[\]【】]/g, '');
  }

  function dailyGroupAccountKeys(group) {
    const rows = weeklyRowsForGroup(group).accountRows || [];
    const keys = new Set(rows.map(function(row) { return normalizeDailyAccountKey(row[0]); }).filter(Boolean));
    if (normalizeWeeklyGroup(group) === '内容四组') {
      keys.add(normalizeDailyAccountKey('麦晓花'));
      keys.add(normalizeDailyAccountKey('麦小雯'));
      keys.add(normalizeDailyAccountKey('夏天丶cat'));
    }
    return keys;
  }

  function dedupeDailyWorks(works) {
    const map = new Map();
    (works || []).forEach(function(work) {
      const key = [
        normalizeDailyAccountKey(work && work.account),
        String(work && work.publishDate || '').slice(0, 10),
        normalizeDailyTitleKey(work && work.title)
      ].join('|');
      if (!key.replace(/\|/g, '')) return;
      const existing = map.get(key);
      if (!existing || workHotScore(work) > workHotScore(existing)) map.set(key, work);
    });
    return Array.from(map.values());
  }

  function mapDailyAccountWork(work, note) {
    const platform = work.platformLabel || work.platform || '';
    const accountPlatform = [work.account || '账号', platform].filter(Boolean).join('-');
    const linePrefix = accountPlatform + '- ' + (work.contentType || '作品') + '-';
    return {
      account: work.account || '',
      title: work.title || '',
      platform: platform,
      publish_date: work.publishDate || '',
      views: work.views || 0,
      likes: work.likes || 0,
      comments: work.comments || 0,
      favorites: work.favorites || 0,
      shares: work.shares || 0,
      note: note || '',
      line: linePrefix + (work.title || '未命名作品') + '：' + formatWorkMetrics(work) + (note ? '（' + note + '）' : '')
    };
  }

  function dailyAccountData(accountData, group, dataDate) {
    const works = Array.isArray(accountData && accountData.works) ? accountData.works : [];
    const accountKeys = dailyGroupAccountKeys(group);
    const scoped = works.filter(function(work) {
      const rawGroup = String(work && work.groupName || '').trim();
      const accountKey = normalizeDailyAccountKey(work && work.account);
      return String(work && work.publishDate || '').slice(0, 10)
        && (
          (rawGroup && normalizeWeeklyGroup(rawGroup) === normalizeWeeklyGroup(group))
          || (accountKey && accountKeys.has(accountKey))
        );
    });
    const exact = dedupeDailyWorks(scoped)
      .filter(function(work) { return String(work && work.publishDate || '').slice(0, 10) === dataDate; })
      .sort(function(a, b) { return workHotScore(b) - workHotScore(a); });
    if (exact.length) {
      return {
        label: shortDateLabel(dataDate),
        note: '昨日作品数据',
        rows: exact.slice(0, 12).map(function(work) { return mapDailyAccountWork(work); })
      };
    }
    function fallback(days) {
      const start = dayOffset(dataDate, -(Number(days || 1) - 1));
      return dedupeDailyWorks(scoped)
        .filter(function(work) {
          const date = String(work && work.publishDate || '').slice(0, 10);
          return date >= start && date <= dataDate;
        })
        .sort(function(a, b) {
          const aHit = Number(a.views || 0) >= 10000 || Number(a.likes || 0) >= 1000 ? 1 : 0;
          const bHit = Number(b.views || 0) >= 10000 || Number(b.likes || 0) >= 1000 ? 1 : 0;
          return bHit - aHit || workHotScore(b) - workHotScore(a);
        });
    }
    const threeDays = fallback(3);
    if (threeDays.length) {
      return {
        label: shortDateLabel(dayOffset(dataDate, -2)) + '-' + shortDateLabel(dataDate),
        note: '昨日无数据，已回看近3天并优先爆款',
        rows: threeDays.slice(0, 12).map(function(work) { return mapDailyAccountWork(work, shortDateLabel(work.publishDate)); })
      };
    }
    const sevenDays = fallback(7);
    return {
      label: shortDateLabel(dayOffset(dataDate, -6)) + '-' + shortDateLabel(dataDate),
      note: sevenDays.length ? '昨日无数据，已回看近7天并优先爆款' : '近7天暂无可用作品数据',
      rows: sevenDays.slice(0, 12).map(function(work) { return mapDailyAccountWork(work, shortDateLabel(work.publishDate)); })
    };
  }

  function parseDateKeyLoose(value, reportDate) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{10,13}$/.test(raw)) {
      const n = Number(raw);
      const date = new Date(raw.length === 13 ? n : n * 1000);
      if (!Number.isNaN(date.getTime())) {
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
      }
    }
    let match = raw.match(/(20\d{2})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/);
    if (match) {
      return match[1] + '-' + String(Number(match[2])).padStart(2, '0') + '-' + String(Number(match[3])).padStart(2, '0');
    }
    match = raw.match(/(?:^|[^\d])(\d{1,2})[\/月.。-](\d{1,2})(?:日)?(?:$|[^\d])/);
    if (match) {
      const year = String(reportDate || '').slice(0, 4) || String(new Date().getFullYear());
      return year + '-' + String(Number(match[1])).padStart(2, '0') + '-' + String(Number(match[2])).padStart(2, '0');
    }
    return '';
  }

  function profitRowMonthParts(row) {
    const raw = String(row && (row.month || row.schedule || row['档期'] || '') || '').replace(/\s+/g, '');
    if (!raw) return null;
    let match = raw.match(/(20\d{2})\D{0,3}(\d{1,2})\s*月?/);
    if (match) return { year: Number(match[1]), month: Number(match[2]) };
    match = raw.match(/(\d{1,2})\s*月/);
    if (match) return { year: 0, month: Number(match[1]) };
    return null;
  }

  function sameProfitReportMonth(row, reportDate, monthLabel) {
    const report = String(reportDate || '').slice(0, 10);
    const reportYear = Number(report.slice(0, 4)) || 0;
    const reportMonth = Number(report.slice(5, 7)) || 0;
    const parts = profitRowMonthParts(row);
    if (parts && parts.month) {
      if (parts.year) return parts.year === reportYear && parts.month === reportMonth;
      return parts.month === reportMonth;
    }
    return sameProfitMonth(row, monthLabel);
  }

  function profitRowDateYearContext(row, reportDate) {
    const parts = profitRowMonthParts(row);
    const reportYear = String(reportDate || '').slice(0, 4);
    return String((parts && parts.year) || reportYear || new Date().getFullYear());
  }

  function profitRowDate(row, names, reportDate) {
    const yearContext = profitRowDateYearContext(row, reportDate);
    for (const name of names) {
      const value = row && row[name];
      const parsed = parseDateKeyLoose(value, yearContext);
      if (parsed) return parsed;
    }
    return '';
  }

  function dateWithinReportMonthToDate(dateText, reportDate) {
    const date = String(dateText || '').slice(0, 10);
    const report = String(reportDate || '').slice(0, 10);
    return Boolean(date && report && date.slice(0, 7) === report.slice(0, 7) && date <= report);
  }

  function profitRowInDailyMonth(row, reportDate, monthLabel) {
    const parts = profitRowMonthParts(row);
    if (parts) return sameProfitReportMonth(row, reportDate, monthLabel);
    const lockDate = profitRowDate(row, ['lock_date', 'lockDate', '锁档日期', '锁定档期'], reportDate);
    const publishDate = profitRowDate(row, ['publish_date', 'publishDate', '发布日期', '发布时间'], reportDate);
    if (lockDate || publishDate) {
      return dateWithinReportMonthToDate(lockDate, reportDate) || dateWithinReportMonthToDate(publishDate, reportDate);
    }
    return false;
  }

  function normalizeDailyReportText(text) {
    let source = String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/^```(?:markdown|text)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    if (!source) return '';
    source = source
      .replace(/-\s*\n\s*(?:-\s*\n\s*)?(?:-\s*)?(日常|商单|素材代做)-/g, '- $1-')
      .replace(/([^\s\n-]+-[^\s\n-]+)-\s*(日常|商单|素材代做)-/g, '$1- $2-')
      .replace(/([^\n])\s*(1[.、．]\s*当日(?:产出|销售额))/g, '$1\n$2')
      .replace(/([^\n])\s*(账号数据（[^）\n]+）：)/g, '$1\n$2')
      .replace(/([^\n])\s*(2[.、．]\s*项目执行(?:进度|细节))/g, '$1\n$2')
      .replace(/([^\n])\s*(3[.、．]\s*(?:截止当月的营收情况|预设当月的网格情况已锁档))/g, '$1\n$2')
      .replace(/([^\n])\s*(4[.、．]\s*次日工作计划)/g, '$1\n$2')
      .replace(/([^\n])\s*(AI小结：)/g, '$1\n$2')
      .replace(/\n{3,}/g, '\n\n');
    return source.trim();
  }

  function compactDailyItems(items, fallback) {
    const values = (items || []).map(function(item) {
      return String(item && item.line || item || '').trim().replace(/^(?:[-*]\s+|\d+[）.)、]\s*)/, '');
    }).filter(Boolean);
    return values.length ? values.join('；') : fallback;
  }

  function renderDailyReportText(report) {
    const lines = [];
    lines.push(report.title);
    lines.push('');
    lines.push('1.当日产出（日常/商单）：');
    lines.push('');
    (report.outputs.length ? report.outputs : ['暂无当日产出']).forEach(function(item) {
      lines.push(item);
      lines.push('');
    });
    const accountNote = report.account_data_note ? '（' + report.account_data_note + '）' : '';
    lines.push('2.账号数据（' + (report.account_data_label || shortDateLabel(report.data_date)) + '）' + accountNote + '：');
    lines.push('');
    (report.account_data.length ? report.account_data.map(function(item) { return item.line; }) : ['暂无可用账号数据']).forEach(function(item) {
      lines.push(item);
      lines.push('');
    });
    const platforms = ['抖音', 'B站', '项目'].concat(Object.keys(report.projects_by_platform || {}).filter(function(key) { return ['抖音', 'B站', '项目'].indexOf(key) < 0; }));
    let projectLineCount = 0;
    const projectLineLimit = 6;
    const projectParts = [];
    platforms.forEach(function(platform) {
      const rows = (report.projects_by_platform && report.projects_by_platform[platform]) || [];
      if (!rows.length || projectLineCount >= projectLineLimit) return;
      const selected = rows.slice(0, projectLineLimit - projectLineCount);
      projectLineCount += selected.length;
      projectParts.push(platform + '：' + compactDailyItems(selected, ''));
    });
    if (projectLineCount) {
      lines.push('2.项目执行进度：');
      lines.push.apply(lines, projectParts);
    } else {
      lines.push('2.项目执行进度：暂无项目执行');
    }
    if (projectLineCount && report.project_note) {
      lines.push(String(report.project_note || '').trim());
    }
    lines.push('');
    lines.push('3.截止当月的营收情况：');
    lines.push('已锁档一口价：' + formatMoneyWan(report.revenue.locked) + '；');
    lines.push('已执行：' + formatMoneyWan(report.revenue.executed) + '；');
    lines.push('其他营收：' + formatMoneyWan(report.revenue.other) + '；');
    lines.push('合计：' + formatMoneyWan(report.revenue.total) + '；');
    lines.push('毛利：' + formatMoneyWan(report.revenue.gross_margin));
    lines.push('');
    const plans = report.next_plans.length ? report.next_plans : ['待补充次日工作计划'];
    lines.push('4.次日工作计划：');
    plans.forEach(function(item, idx) { lines.push((idx + 1) + '）' + item); });
    if (report.summary) {
      lines.push('AI小结：' + report.summary);
    }
    return normalizeDailyReportText(lines.join('\n'));
  }

  async function refineDailyReportWithAi(report) {
    if (!callModelText) return report;
    const system = '你是内容小组日报助理。日报必须简短。项目执行进度只允许写正在执行的商单、素材代做或明确商业项目，禁止把日常、选题、热点内容写入项目执行；没有项目时 projectNote 必须为空。只基于给定数据整理，不编造具体金额和账号数据。输出严格 JSON。';
    const user = [
      '请补充日报文案，输出 JSON：{"summary":"","projectNote":"","nextPlans":[""]}',
      JSON.stringify({
        group: report.group,
        report_date: report.report_date,
        data_date: report.data_date,
        outputs: report.outputs,
        account_data: report.account_data,
        projects: report.projects,
        revenue: report.revenue,
        manual: report.manual
      }, null, 2)
    ].join('\n');
    try {
      const raw = await callModelText(system, user, { temperature: 0.25, maxTokens: 900, timeoutMs: 90000 });
      const parsed = extractJsonLoose(raw);
      if (!parsed || typeof parsed !== 'object' || hasBrokenText(JSON.stringify(parsed))) return report;
      report.summary = report.manual.summaryText || String(parsed.summary || '').trim();
      report.project_note = report.projects.length ? (report.manual.projectNote || String(parsed.projectNote || '').trim()) : '';
      if (!report.manual.nextPlansText && Array.isArray(parsed.nextPlans) && parsed.nextPlans.length) {
        report.next_plans = parsed.nextPlans.map(function(item) { return String(item || '').trim(); }).filter(Boolean).slice(0, 5);
      }
    } catch (e) {
      report.ai_error = e.message || String(e);
    }
    if (!report.summary) {
      report.summary = report.projects.length ? '今日按排期推进内容产出与商单执行。' : '今日按排期完成内容产出，暂无项目执行。';
    }
    return report;
  }

  async function buildDailyReportDraft(payload) {
    payload = payload || {};
    const auth = payload._auth || {};
    const group = normalizeWeeklyGroup(payload.group || groupFromAuthUser(auth) || '内容二组');
    const dates = defaultDailyDates(payload);
    const scheduleData = await routeData('/api/schedule/load', { _auth: auth });
    const scheduleRows = pickRows(scheduleData);
    const schedule = groupDailySchedule(scheduleRows, group, dates);
    const reportYear = Number(String(dates.reportDate || '').slice(0, 4)) || 0;
    const reportMonth = Number(String(dates.reportDate || '').slice(5, 7)) || 0;
    const profitData = await routeData('/api/profit/list', { _auth: auth, grp: group, year: reportYear, month: reportMonth, limit: 800 });
    const profitRows = pickRows(profitData);
    const accountData = await routeData('/api/account-data/dashboard', { _auth: auth });
    const accountDataResult = dailyAccountData(accountData, group, dates.dataDate);
    const explicitOutputs = normalizeWeeklyLines(payload.outputsText || payload.outputs || '');
    const explicitPlans = normalizeWeeklyLines(payload.nextPlansText || payload.next_plans || '');
    const report = {
      title: payload.title || dailyTitle(group, dates.reportDate),
      group: group,
      report_date: dates.reportDate,
      data_date: dates.dataDate,
      next_date: dates.nextDate,
      outputs: explicitOutputs.length ? explicitOutputs : schedule.outputs,
      account_data: accountDataResult.rows,
      account_data_label: accountDataResult.label,
      account_data_note: accountDataResult.note,
      projects: schedule.projects,
      projects_by_platform: schedule.projects_by_platform,
      revenue: dailyRevenueSummary(profitRows, group, dates.reportDate),
      next_plans: explicitPlans.length ? explicitPlans : schedule.next_plans,
      manual: {
        outputsText: payload.outputsText || '',
        projectNote: payload.projectNote || '',
        summaryText: payload.summaryText || '',
        nextPlansText: payload.nextPlansText || ''
      },
      sources: {
        schedule_error: scheduleData && scheduleData.error || '',
        profit_error: profitData && profitData.error || '',
        account_error: accountData && accountData.error || ''
      },
      generated_at: now()
    };
    await refineDailyReportWithAi(report);
    report.text = renderDailyReportText(report);
    const record = await dailyStore.save({
      group_name: group,
      report_date: report.report_date,
      data_date: report.data_date,
      title: report.title,
      draft: report,
      text: report.text,
      created_by: auth.id || 0,
      created_by_name: auth.display_name || auth.username || ''
    });
    report.record_id = record.id;
    return report;
  }

  function dailyImagePrompt(report, text) {
    return [
      '生成一张中文运营日报长图，竖版 4:5，浅色工作台风格，信息密度高但清爽。',
      '标题：' + (report.title || '日报'),
      '必须使用清晰中文排版，分成四个区块：当日产出、项目执行进度、截止当月营收情况、次日工作计划。',
      '视觉要求：白底或极浅灰底，深色文字，少量蓝绿色强调，表格和分组线清晰，不要卡通形象，不要英文大标题。',
      '日报正文如下，请尽量完整排版，不要改写数字：',
      text || report.text || ''
    ].join('\n');
  }

  async function generateDailyReportImage(payload) {
    const route = routes['/api/gpt-image2/text2image'];
    if (!route) throw new Error('image2 route missing');
    const report = payload.report || {};
    const text = String(payload.text || report.text || '').trim();
    if (!text) throw new Error('日报正文为空，无法出图');
    const data = await toPromise(route, {
      _auth: payload._auth,
      prompt: payload.prompt || dailyImagePrompt(report, text),
      ratio: payload.ratio || '4:5',
      resolution: payload.resolution || '1K',
      quality: payload.quality || 'auto'
    });
    const imageUrl = data.url || data.result_url || data.image_url || '';
    if (!imageUrl) throw new Error(data.error || 'image2 没有返回图片链接');
    await dailyStore.save({
      group_name: report.group || payload.group || '',
      report_date: report.report_date || payload.reportDate || '',
      data_date: report.data_date || payload.dataDate || '',
      title: report.title || '日报',
      draft: report,
      text: text,
      image_url: imageUrl,
      created_by: payload._auth && payload._auth.id || 0,
      created_by_name: payload._auth && (payload._auth.display_name || payload._auth.username) || ''
    });
    return Object.assign({}, data, { ok: true, image_url: imageUrl, url: imageUrl });
  }

  function fallbackReviseDailyText(text, instruction) {
    const source = String(text || '').trim();
    const note = String(instruction || '').trim();
    if (!source) return note;
    if (!note) return source;
    const lines = source.split(/\r?\n/);
    const planIndex = lines.findIndex(function(line) { return /^4[\.、．]/.test(String(line || '').trim()); });
    const insertAt = planIndex >= 0 ? planIndex : lines.length;
    lines.splice(insertAt, 0, '', '补充：' + note);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function reviseDailyReportText(payload) {
    payload = payload || {};
    const report = payload.report || {};
    const currentText = String(payload.text || report.text || '').trim();
    const instruction = String(payload.instruction || payload.message || '').trim();
    if (!currentText) throw new Error('日报正文为空，无法修改');
    if (!instruction) throw new Error('请先输入要补充或修改的内容');
    let revised = '';
    if (callModelText) {
      const system = [
        '你是内容小组日报协作编辑。用户会给你一份当前日报正文和一条修改要求。',
        '你必须直接返回修改后的完整日报正文，不要解释，不要 Markdown 代码块。',
        '保留原有四段结构和已有真实数字；只按用户要求增删改，不要编造新数据。',
        '排版要整齐：标题和四个板块各自成行，每条作品或计划各占一行，不使用“- ”项目符号，也不插入空行。账号数据固定为“账号-平台- 类型-标题”，类型前保留一个空格，整条必须连续显示，禁止换行。',
        '项目执行进度只保留正在执行的商单、素材代做或明确商业项目，禁止写入日常、选题和热点；没有商单或商业项目时固定写“- 暂无项目执行”。',
        '如果用户只是补充一段事项，把它放进最合适的段落，例如项目执行进度或次日工作计划。'
      ].join('\n');
      const user = [
        '当前日报：',
        currentText,
        '',
        '修改要求：',
        instruction
      ].join('\n');
      try {
        revised = String(await callModelText(system, user, { temperature: 0.18, maxTokens: 1800, timeoutMs: 90000 }) || '').trim();
        revised = revised.replace(/^```(?:markdown|text)?\s*/i, '').replace(/```$/i, '').trim();
        if (hasBrokenText(revised) || revised.length < 20) revised = '';
      } catch (e) {
        revised = '';
      }
    }
    if (!revised) revised = fallbackReviseDailyText(currentText, instruction);
    revised = normalizeDailyReportText(revised);
    await dailyStore.save({
      group_name: report.group || payload.group || '',
      report_date: report.report_date || payload.reportDate || '',
      data_date: report.data_date || payload.dataDate || '',
      title: report.title || '日报',
      draft: Object.assign({}, report, { text: revised }),
      text: revised,
      created_by: payload._auth && payload._auth.id || 0,
      created_by_name: payload._auth && (payload._auth.display_name || payload._auth.username) || ''
    });
    return Object.assign({}, report, { text: revised });
  }

  function isDailyReportText(text) {
    const source = String(text || '').trim();
    return /日报/.test(source.slice(0, 80))
      && /1[\.、．]\s*当日产出/.test(source)
      && /2[\.、．]\s*项目执行进度/.test(source)
      && /4[\.、．]\s*次日工作计划/.test(source);
  }

  function latestDailyReportText(messages) {
    const normalized = normalizeAgentMessages(messages);
    for (let i = normalized.length - 1; i >= 0; i--) {
      if (normalized[i].role !== 'assistant') continue;
      const content = String(normalized[i].content || '').trim();
      if (isDailyReportText(content)) return content;
    }
    return '';
  }

  function wantsDailyRevision(input, taskType, messages) {
    if (!latestDailyReportText(messages)) return false;
    if (asksForImageGeneration(input)) return false;
    const text = compactIntentText(input);
    if (asksForDailyReport(input) && /(重新|再生成|新|今天|明天|昨天|\d{4})/.test(text)) return false;
    return taskType === 'daily_report' && /(改|修改|调整|换成|补充|加上|新增|删掉|删除|精简|压缩|润色|口吻|语气|图片前|出图前)/.test(text);
  }

  function wantsDailyImage(input, taskType, messages) {
    if (!latestDailyReportText(messages)) return false;
    const text = compactIntentText(input);
    return asksForImageGeneration(input)
      || (taskType === 'daily_report' && /(出图|生成图片|日报图|长图|海报|图片|配图|确认出图)/.test(text));
  }

  function parseDailyDateFromInput(input) {
    const text = String(input || '');
    let match = text.match(/(20\d{2})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/);
    if (match) {
      return match[1] + '-' + String(Number(match[2])).padStart(2, '0') + '-' + String(Number(match[3])).padStart(2, '0');
    }
    match = text.match(/(?:^|[^\d])(\d{1,2})[\/月.。-](\d{1,2})(?:日)?(?:$|[^\d])/);
    if (match) {
      const year = String(new Date().getFullYear());
      return year + '-' + String(Number(match[1])).padStart(2, '0') + '-' + String(Number(match[2])).padStart(2, '0');
    }
    if (/昨天|昨日/.test(text)) return dayOffset('', -1);
    if (/明天|次日/.test(text)) return dayOffset('', 1);
    if (/今天|今日|当天/.test(text)) return dayOffset('', 0);
    return '';
  }

  function dailyPayloadFromInput(body, input, auth) {
    const reportDate = parseDailyDateFromInput(input) || body.reportDate || body.report_date || '';
    const group = detectGroupScope(input) || body.group || groupFromAuthUser(auth) || '内容二组';
    return {
      _auth: auth,
      group: group,
      reportDate: reportDate,
      dataDate: body.dataDate || body.data_date || '',
      nextDate: body.nextDate || body.next_date || ''
    };
  }

  function dailyReportObjectFromText(text, input, auth) {
    const lines = String(text || '').trim().split(/\r?\n/);
    const title = lines.find(function(line) { return line.trim(); }) || '日报';
    const reportDate = parseDailyDateFromInput(title) || parseDailyDateFromInput(input) || '';
    return {
      title: title,
      group: detectGroupScope(title + '\n' + input) || groupFromAuthUser(auth) || '',
      report_date: reportDate,
      data_date: reportDate ? dayOffset(reportDate, -1) : '',
      text: String(text || '').trim()
    };
  }

  function dailyReportSources(report) {
    return [
      {
        label: '排期看板',
        module: 'schedule',
        route: '/api/schedule/load',
        summary: '当日产出 ' + ((report.outputs || []).length) + ' 项，项目推进 ' + ((report.projects || []).length) + ' 项'
      },
      {
        label: '账号数据看板',
        module: 'accountData',
        route: '/api/account-data/dashboard',
        summary: '账号作品 ' + ((report.account_data || []).length) + ' 条，口径 ' + (report.account_data_label || report.data_date || '')
      },
      {
        label: '流水看板',
        module: 'ops',
        route: '/api/profit/list',
        summary: '当月锁档 ' + formatMoneyWan(report.revenue && report.revenue.locked) + '，已执行 ' + formatMoneyWan(report.revenue && report.revenue.executed)
      }
    ];
  }

  async function runDailyReportDraftStream(body, res, input, auth, taskType) {
    const payload = dailyPayloadFromInput(body || {}, input, auth);
    const steps = [toolMeta('daily_report_pipeline', '日报取数与生成', 'projectAgent', 'running', normalizeWeeklyGroup(payload.group) + ' · ' + (payload.reportDate || '今天'))];
    writeSse(res, 'plan', {
      task_type: 'daily_report',
      agent_mode: 'platform',
      plan: { task_type: 'daily_report', group: payload.group, goal: input, tools: [{ id: 'daily_report_pipeline', args: payload }] },
      tools: steps
    });
    try {
      writeSse(res, 'status', { stage: 'daily_report', message: '正在读取排期、账号数据和流水' });
      const report = await buildDailyReportDraft(payload);
      const sources = dailyReportSources(report);
      steps[0].status = 'done';
      steps[0].detail = '日报草稿已生成';
      writeSse(res, 'context', { tools: steps, sources: sources });
      writeSse(res, 'delta', { delta: report.text });
      const draft = await saveAgentStreamDraft(body, auth, input, report.text, 'daily_report', steps, sources, {});
      writeSse(res, 'done', {
        ok: true,
        task_type: 'daily_report',
        agent_mode: 'platform',
        reply: report.text,
        output: report.text,
        tools: steps,
        sources: sources,
        draft: draft,
        report: report
      });
      res.end();
    } catch (e) {
      steps[0].status = 'failed';
      steps[0].detail = e.message || String(e);
      writeSse(res, 'error', { error: e.message || String(e), task_type: taskType || 'daily_report', tools: steps, sources: [] });
      res.end();
    }
  }

  async function runDailyReportReviseStream(body, res, input, auth) {
    const currentText = latestDailyReportText(body.history || []);
    const report = dailyReportObjectFromText(currentText, input, auth);
    const steps = [toolMeta('daily_report_revise', '日报正文修改', 'projectAgent', 'running')];
    writeSse(res, 'plan', { task_type: 'daily_report', agent_mode: 'platform', plan: { task_type: 'daily_report', tools: [{ id: 'daily_report_revise', args: { instruction: input } }] }, tools: steps });
    try {
      writeSse(res, 'status', { stage: 'daily_report_revise', message: '正在按你的要求修改日报' });
      const revised = await reviseDailyReportText({ _auth: auth, report: report, text: currentText, instruction: input });
      steps[0].status = 'done';
      steps[0].detail = '已修改';
      writeSse(res, 'delta', { delta: revised.text || '' });
      const draft = await saveAgentStreamDraft(body, auth, input, revised.text || '', 'daily_report', steps, [], {});
      writeSse(res, 'done', {
        ok: true,
        task_type: 'daily_report',
        agent_mode: 'platform',
        reply: revised.text || '',
        output: revised.text || '',
        tools: steps,
        sources: [],
        draft: draft,
        report: revised
      });
      res.end();
    } catch (e) {
      steps[0].status = 'failed';
      steps[0].detail = e.message || String(e);
      writeSse(res, 'error', { error: e.message || String(e), task_type: 'daily_report', tools: steps, sources: [] });
      res.end();
    }
  }

  async function runDailyReportImageStream(body, res, input, auth) {
    const currentText = latestDailyReportText(body.history || []);
    const report = dailyReportObjectFromText(currentText, input, auth);
    const steps = [toolMeta('daily_report_image', '日报确认出图', 'imagegen', 'running')];
    writeSse(res, 'plan', { task_type: 'daily_report', agent_mode: 'platform', plan: { task_type: 'daily_report', tools: [{ id: 'daily_report_image', args: { ratio: '4:5', resolution: '1K' } }] }, tools: steps });
    try {
      writeSse(res, 'status', { stage: 'daily_report_image', message: '正在用 image2 生成日报图' });
      const image = await generateDailyReportImage({ _auth: auth, report: report, text: currentText, ratio: '4:5', resolution: '1K' });
      const imageUrl = image.image_url || image.url || image.result_url || '';
      steps[0].status = 'done';
      steps[0].detail = imageUrl ? '图片已生成' : '完成';
      const reply = '日报图已生成：' + imageUrl + '\n\n需要改字、改排版或重新出图，可以继续在下面输入修改要求。';
      writeSse(res, 'delta', { delta: reply });
      const draft = await saveAgentStreamDraft(body, auth, input, reply, 'daily_report', steps, [], {});
      writeSse(res, 'done', {
        ok: true,
        task_type: 'daily_report',
        agent_mode: 'platform',
        reply: reply,
        output: reply,
        tools: steps,
        sources: [],
        draft: draft,
        image_url: imageUrl,
        url: imageUrl,
        image: image
      });
      res.end();
    } catch (e) {
      steps[0].status = 'failed';
      steps[0].detail = e.message || String(e);
      writeSse(res, 'error', { error: e.message || String(e), task_type: 'daily_report', tools: steps, sources: [] });
      res.end();
    }
  }

  function publicWeeklyJob(job) {
    return {
      id: job.id,
      ok: job.status === 'done',
      status: job.status,
      stage: job.stage,
      message: job.message,
      progress: job.progress || 0,
      created_at: job.created_at,
      updated_at: job.updated_at,
      account_progress: job.account_progress || null,
      account_results: job.account_results || [],
      report: job.report || null,
      error: job.error || ''
    };
  }

  function canSeeWeeklyReport(auth, record) {
    if (!record) return false;
    if (!auth || auth.role === 'admin') return true;
    const name = String(auth.display_name || auth.username || '').trim();
    if (!name) return false;
    if (name === String(record.leader_name || '').trim()) return true;
    if (Number(record.created_by || 0) && Number(record.created_by || 0) === Number(auth.id || 0)) return true;
    return false;
  }

  function publicWeeklyRecord(record, withReport) {
    const report = record && (record.report || {});
    const out = {
      id: record.id,
      group_name: record.group_name,
      leader_name: record.leader_name,
      range_start: record.range_start,
      range_end: record.range_end,
      title: record.title,
      status: record.status,
      word_url: record.word_url,
      word_relative_url: report.word_relative_url || relativeUploadUrl(record.word_url),
      feishu_url: record.feishu_url,
      created_by_name: record.created_by_name,
      created_at: record.created_at,
      updated_at: record.updated_at
    };
    if (withReport) out.report = Object.assign({}, report, {
      word_url: record.word_url || report.word_url || '',
      word_relative_url: report.word_relative_url || relativeUploadUrl(record.word_url || report.word_url),
      feishu_url: record.feishu_url || report.feishu_url || ''
    });
    return out;
  }

  async function compactAgentConversation(messages, previousSummary) {
    const normalized = normalizeAgentMessages(messages);
    if (!shouldCompactAgentMessages(normalized)) {
      return {
        messages: normalized,
        summary: previousSummary || '',
        compacted: false,
        message_count: normalized.length,
        last_compacted_at: 0
      };
    }
    const keep = normalized.slice(-AGENT_KEEP_RECENT_MESSAGES);
    const older = normalized.slice(0, Math.max(0, normalized.length - AGENT_KEEP_RECENT_MESSAGES));
    const fallbackSummary = [
      previousSummary ? '既有摘要：\n' + previousSummary : '',
      '本次压缩新增内容：',
      older.map(function(item) {
        return (item.role === 'assistant' ? '助手：' : '用户：') + clip(item.content, 700);
      }).join('\n')
    ].filter(Boolean).join('\n\n');
    let summary = clip(fallbackSummary, 9000);
    const prompt = [
      { role: 'system', content: '你负责压缩项目助手的长期会话上下文。保留用户目标、关键事实、已调用工具、结论、待办、约束和未解决问题。不要加入新事实。用中文，结构清晰，控制在 1200 字以内。' },
      { role: 'user', content: [
        previousSummary ? '已有会话摘要：\n' + previousSummary : '暂无已有摘要。',
        '',
        '需要压缩的较早消息：',
        older.map(function(item) {
          return (item.role === 'assistant' ? '助手：' : '用户：') + clip(item.content, 1800);
        }).join('\n\n')
      ].join('\n') }
    ];
    try {
      if (callOpenAICompatible) {
        summary = await callOpenAICompatible(prompt, { model: 'gpt-5.5', temperature: 0.15 });
      } else if (siliconflowApiKey) {
        summary = await callSiliconFlow(prompt, { temperature: 0.15 });
      } else if (callModelText) {
        summary = await callModelText(prompt[0].content, prompt[1].content, { temperature: 0.15 });
      }
    } catch (e) {
      logger.warn('agent conversation compact failed, using fallback summary', e);
    }
    return {
      messages: keep,
      summary: clip(summary || fallbackSummary, 10000),
      compacted: true,
      message_count: normalized.length,
      last_compacted_at: now()
    };
  }

  function canAccess(auth, moduleId) {
    if (!moduleId) return true;
    if (!authStore || !authStore.canAccess) return true;
    return authStore.canAccess(auth, moduleId);
  }

  const SITE_CONTEXT_TOOL_IDS = new Set([
    'platform_snapshot',
    'vector_search',
    'bf_list',
    'cases_list',
    'profit_list',
    'profit_stats',
    'account_monitor',
    'account_data_dashboard',
    'schedule_load',
    'daily_hot',
    'ideas_list',
    'materials_list',
    'materials_stats',
    'materials_storage',
    'smart_collect_status',
    'video_publish_accounts',
    'video_publish_jobs',
    'imagegen_history',
    'operation_logs',
    'users_list',
    'copygen_state',
    'copygen_records',
    'account_styles_list',
    'vector_list'
  ]);

  function parseBooleanOption(value, defaultValue) {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (value === false) return false;
    if (value === true) return true;
    const text = String(value).trim().toLowerCase();
    if (['false', '0', 'no', 'off', 'disabled'].includes(text)) return false;
    if (['true', '1', 'yes', 'on', 'enabled'].includes(text)) return true;
    return defaultValue;
  }

  function useSiteContextEnabled(body) {
    if (!body || typeof body !== 'object') return true;
    return parseBooleanOption(
      Object.prototype.hasOwnProperty.call(body, 'use_site_context') ? body.use_site_context
        : Object.prototype.hasOwnProperty.call(body, 'useSiteContext') ? body.useSiteContext
          : body.site_context,
      true
    );
  }

  function isSiteContextToolId(id) {
    return SITE_CONTEXT_TOOL_IDS.has(String(id || ''));
  }

  function filterSiteContextTools(tools, allowSiteContext) {
    return (Array.isArray(tools) ? tools : []).filter(function(tool) {
      const id = typeof tool === 'string' ? tool : tool && (tool.id || tool.tool);
      return allowSiteContext || !isSiteContextToolId(id);
    });
  }

  function availableAgentTools(auth, options) {
    const allowSiteContext = !options || options.allowSiteContext !== false;
    const defs = [
      { id: 'platform_snapshot', label: '读取平台总览', module: 'projectAgent', route: '__platform_snapshot__', args: { scope: 'auto' } },
      { id: 'douyin_transcribe', label: '读取/转写抖音链接', module: 'tools', route: '/api/douyin/downloader', args: { url: '抖音分享链接' } },
      { id: 'bilibili_transcribe', label: '读取/转写B站链接', module: 'tools', route: '/api/transcribe/bilibili', args: { url: 'B站视频链接' } },
      { id: 'feishu_read', label: '读取飞书文档', module: 'tools', route: '/api/feishu/read', args: { url: '飞书链接' } },
      { id: 'vector_search', label: '检索向量库/文案库', module: 'tools', route: '/api/vector/search', args: { query: '检索词', collection: 'wenan|bf|cases', limit: 5 } },
      { id: 'bf_list', label: '读取BF库', module: 'tools', route: '/api/bf/list', args: {} },
      { id: 'cases_list', label: '读取案例库', module: 'tools', route: '/api/cases/list', args: {} },
      { id: 'profit_list', label: '读取流水数据', module: 'ops', route: '/api/profit/list', args: { grp: '内容一部/内容二组/内容三组/内容四组/内容五组/内容六组/全部' } },
      { id: 'profit_stats', label: '读取流水统计', module: 'ops', route: '/api/profit/stats', args: { grp: '内容一部/内容二组/内容三组/内容四组/内容五组/内容六组/全部' } },
      { id: 'account_monitor', label: '读取账号监控数据', module: 'accountmonitor', route: '/api/account-monitor/list', args: { days: 7, limit: 120 } },
      { id: 'schedule_load', label: '读取排期/工时', module: 'schedule', route: '/api/schedule/load', args: {} },
      { id: 'daily_hot', label: '读取每日热点', module: 'dailyhot', route: '/api/daily-hot/list', args: {} },
      { id: 'ideas_list', label: '读取创意看板', module: 'ideoboard', route: '/api/ideas/list', args: {} },
      { id: 'materials_list', label: '读取素材库元数据', module: 'material', route: '/api/materials/list', args: { limit: 80 } },
      { id: 'materials_stats', label: '读取素材库统计', module: 'material', route: '/api/materials/stats', args: {} },
      { id: 'materials_storage', label: '读取素材库容量', module: 'material', route: '/api/materials/storage', args: {} },
      { id: 'smart_collect_status', label: '读取AI剪辑状态', module: 'smartcollect', route: '/api/smart-collect/downloader-status', args: {} },
      { id: 'video_publish_accounts', label: '读取发布账号配置', module: 'videopublish', route: '/api/video-publish/accounts/list', args: {} },
      { id: 'video_publish_jobs', label: '读取视频发布任务', module: 'videopublish', route: '/api/video-publish/jobs', args: { limit: 80, mineOnly: false } },
      { id: 'imagegen_history', label: '读取生图历史', module: 'imagegen', route: '/api/imagegen/history', args: { page: 1, limit: 20 } },
      { id: 'operation_logs', label: '读取操作日志', module: 'operationLogs', route: '/api/admin/logs', args: { limit: 80 } },
      { id: 'users_list', label: '读取成员列表', module: 'adminUsers', route: '/api/admin/users', args: {} },
      { id: 'copygen_state', label: '读取旧文案工作台状态', module: 'copygen', route: '/api/copygen/state', args: {} },
      { id: 'copygen_records', label: '读取旧文案记录', module: 'copygen', route: '/api/copygen/records', args: {} },
      { id: 'account_styles_list', label: '读取账号风格卡', module: 'copygen', route: '/api/account-styles/list', args: {} },
      { id: 'vector_list', label: '读取向量库条目', module: 'tools', route: '/api/vector/list', args: { limit: 80 } },
      { id: 'vision_analyze_image', label: '图片理解/视觉分析', module: 'projectAgent', route: '__vision_analyze_image__', args: { question: '需要看图分析的问题' } },
      { id: 'video_analyze', label: '视频打点/画面分析', module: 'tools', route: '/api/posttools/video-analyze', args: { url: '视频链接或上传路径', mode: 'auto' } },
      { id: 'gpt_image2_text2image', label: 'GPT-Image2 文生图', module: 'imagegen', route: '/api/gpt-image2/text2image', args: { prompt: '图片提示词', ratio: '1:1', resolution: '1K' } },
      { id: 'gpt_image2_image2image', label: 'GPT-Image2 图生图', module: 'imagegen', route: '/api/gpt-image2/image2image', args: { prompt: '图片修改提示词', image_base64: '参考图base64', ratio: '1:1', resolution: '2K' } },
      { id: 'codex_deep_analysis', label: 'Codex 深度分析', module: 'projectAgent', route: '__codex_deep_analysis__', args: { question: '需要深度分析的问题' } }
    ];
    return defs.filter(function(tool) {
      if (!allowSiteContext && isSiteContextToolId(tool.id)) return false;
      return canAccess(auth, tool.module);
    });
  }

  function extractJsonLoose(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) {}
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try { return JSON.parse(fenced[1]); } catch(e) {}
    }
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(raw.slice(first, last + 1)); } catch(e) {}
    }
    return null;
  }

  function normalizePlan(rawPlan, input, explicitType) {
    const fallbackTask = detectTask(input, explicitType);
    const fallbackGroup = detectGroupScope(input);
    const imageUnderstandingOnly = asksForImageUnderstanding(input) && !asksForImageEdit(input) && !asksForImageGeneration(input);
    const plan = rawPlan && typeof rawPlan === 'object' ? rawPlan : {};
    const allowedTasks = new Set(['transcribe_link', 'read_feishu', 'bf_analysis', 'weekly_report', 'daily_report', 'project_review', 'research', 'free_writing', 'image_generation', 'outline_writing']);
    const taskType = imageUnderstandingOnly ? 'research' : (allowedTasks.has(plan.task_type) ? plan.task_type : fallbackTask);
    const group = normalizeGroupScopeValue(plan.group || fallbackGroup, input);
    const tools = Array.isArray(plan.tools) ? plan.tools : [];
    const normalizedTools = tools.slice(0, 12).map(function(item) {
      if (typeof item === 'string') return { id: item, args: {} };
      return {
        id: String(item && (item.id || item.tool) || '').trim(),
        args: item && typeof item.args === 'object' && item.args ? item.args : {}
      };
    }).filter(function(item) { return item.id; });
    return {
      task_type: taskType,
      group: group,
      time_range: String(plan.time_range || '').trim(),
      goal: String(plan.goal || input || '').trim(),
      reasoning: String(plan.reasoning || '').trim(),
      tools: imageUnderstandingOnly
        ? normalizedTools.filter(function(item) { return item.id !== 'gpt_image2_text2image' && item.id !== 'gpt_image2_image2image'; })
        : normalizedTools
    };
  }

  function normalizeGroupScopeValue(value, input) {
    const detected = detectGroupScope(value || '');
    if (detected) return detected;
    const fallback = detectGroupScope(input || '');
    return fallback || String(value || '').trim();
  }

  async function callPlannerModel(messages) {
    const failures = [];
    if (callOpenAICompatible) {
      try {
        return await callOpenAICompatible(messages, { model: 'gpt-5.5', temperature: 0.05, timeoutMs: 45000 });
      } catch(e) {
        failures.push(e.message || String(e));
        logger.warn('agent planner primary failed, trying SiliconFlow', e);
      }
    }
    if (siliconflowApiKey) {
      try {
        return await callSiliconFlow(messages, { temperature: 0.05, timeoutMs: 45000 });
      } catch(e) {
        failures.push(e.message || String(e));
      }
    }
    throw new Error('planner model failed: ' + failures.join('; '));
  }

  async function planAgentRun(input, history, auth, explicitType, options) {
    const allowSiteContext = !options || options.allowSiteContext !== false;
    const tools = availableAgentTools(auth, { allowSiteContext: allowSiteContext });
    const fallback = normalizePlan(null, input, explicitType);
    const system = [
      '你是乌萨奇工作平台的 Agent 调度器。你只负责判断用户意图和选择工具，不写最终答案。',
      '必须只返回 JSON，不要解释。',
      '可用工具由系统提供，不能发明工具。',
      '如果用户问某组/某账号/某项目的工作情况、表现、周报、复盘、数据，请主动选择流水、账号监控、排期等平台数据工具。',
      '如果用户问平台整体、全局总结、项目复盘、周报、排查问题、最近情况，优先选择 platform_snapshot 读取全平台可见数据，再按需要补充细分工具。',
      '如果用户贴抖音/B站/飞书链接，请选择对应读取/转写工具。',
      '如果用户贴视频链接并要求视频打点、画面分析、抽帧、时间轴、剪辑点或素材文档，请选择 video_analyze；如果只是要转写口播/字幕，优先选择对应平台转写工具。',
      '如果需要资料、案例、文案参考，请选择向量库/BF/案例工具。',
      '如果用户要求生成图片、封面、海报、配图、插画，选择 gpt_image2_text2image；如果用户给了参考图片并要求改图/图生图，选择 gpt_image2_image2image。',
      '如果用户附带图片并要求看图、识图、分析截图、提取画面信息或判断图片问题，选择 vision_analyze_image。',
      '写操作规则：保存、删除、发布、写飞书、创建项目、改排期、改流水、改素材等必须用户明确要求；危险操作不要在普通分析里自动调用。',
      '如果用户要求写“达人推广大纲/视频大纲/商单大纲/内容大纲”，task_type 设为 outline_writing。',
      '输出格式：{"task_type":"weekly_report|daily_report|project_review|bf_analysis|outline_writing|transcribe_link|read_feishu|research|free_writing|image_generation","group":"","time_range":"","goal":"","reasoning":"","tools":[{"id":"tool_id","args":{}}]}'
    ].join('\n');
    const user = [
      '用户输入：' + input,
      '本地规则兜底：' + JSON.stringify(fallback),
      '最近对话：' + JSON.stringify((history || []).slice(-6).map(function(item) {
        return { role: item.role, content: clip(item.content || item.text || '', 600) };
      })),
      '可用工具：' + JSON.stringify(tools.map(function(tool) {
        return { id: tool.id, label: tool.label, args: tool.args };
      }))
    ].join('\n\n');
    try {
      const raw = await callPlannerModel([{ role: 'system', content: system }, { role: 'user', content: user }]);
      const parsed = extractJsonLoose(raw);
      const plan = normalizePlan(parsed, input, explicitType);
      plan.tools = filterSiteContextTools(plan.tools, allowSiteContext);
      if (!plan.tools.length) plan.tools = fallbackToolsForPlan(plan, input, auth, { allowSiteContext: allowSiteContext });
      return plan;
    } catch(e) {
      logger.warn('agent planner failed, using fallback rules', e);
      fallback.tools = fallbackToolsForPlan(fallback, input, auth, { allowSiteContext: allowSiteContext });
      fallback.reasoning = 'planner_failed_fallback: ' + (e.message || String(e)).slice(0, 160);
      return fallback;
    }
  }

  function fallbackToolsForPlan(plan, input, auth, options) {
    const visible = visibleToolsFor(input, plan.task_type, auth, options);
    const map = {
      platform_snapshot: 'platform_snapshot',
      douyin_transcribe: 'douyin_transcribe',
      bilibili_transcribe: 'bilibili_transcribe',
      feishu_read: 'feishu_read',
      vector_search: 'vector_search',
      profit_list: 'profit_list',
      account_monitor: 'account_monitor',
      schedule_load: 'schedule_load',
      daily_hot: 'daily_hot',
      ideas_list: 'ideas_list',
      materials_list: 'materials_list',
      materials_stats: 'materials_stats',
      materials_storage: 'materials_storage',
      smart_collect_status: 'smart_collect_status',
      video_publish_accounts: 'video_publish_accounts',
      video_publish_jobs: 'video_publish_jobs',
      imagegen_history: 'imagegen_history',
      operation_logs: 'operation_logs',
      users_list: 'users_list',
      copygen_state: 'copygen_state',
      copygen_records: 'copygen_records',
      account_styles_list: 'account_styles_list',
      vector_list: 'vector_list',
      vision_analyze_image: 'vision_analyze_image',
      video_analyze: 'video_analyze',
      gpt_image2_text2image: 'gpt_image2_text2image',
      gpt_image2_image2image: 'gpt_image2_image2image',
      codex_deep_analysis: 'codex_deep_analysis'
    };
    return visible.map(function(tool) {
      return { id: map[tool.id] || tool.id, args: {} };
    });
  }

  function visibleToolsFor(input, taskType, auth, options) {
    const allowSiteContext = !options || options.allowSiteContext !== false;
    const text = String(input || '');
    const links = extractLinks(text);
    const groupScope = detectGroupScope(text);
    const tools = [];
    const add = function(id, label, moduleId, detail) {
      if (!allowSiteContext && isSiteContextToolId(id)) return;
      if (canAccess(auth, moduleId)) tools.push(toolMeta(id, label, moduleId, 'pending', detail));
    };
    if (asksForPlatformSnapshot(text)) add('platform_snapshot', '读取平台总览', 'projectAgent');
    if (links.some(function(link) { return /douyin\.com|v\.douyin\.com/i.test(link); })) add('douyin_transcribe', '读取/转写抖音链接', 'tools');
    if (links.some(function(link) { return /bilibili\.com|b23\.tv/i.test(link); })) add('bilibili_transcribe', '读取/转写 B站链接', 'tools');
    if (links.some(function(link) { return /feishu\.cn|larksuite\.com/i.test(link); })) add('feishu_read', '读取飞书文档', 'tools');
    if (links.length && asksForVideoAnalysis(text)) add('video_analyze', '视频打点/画面分析', 'tools');
    if (['bf_analysis', 'outline_writing', 'research', 'free_writing', 'project_review'].indexOf(taskType) >= 0 || includesAny(text, ['案例', 'BF', 'bf', '资料', '文案库', '向量'])) {
      add('vector_search', '检索向量库 / BF / 案例', 'tools');
    }
    if (taskType === 'weekly_report' || groupScope || asksForWorkSummary(text) || asksForPlatformData(text) || includesAny(text, ['周报', '周会', '本周', '上周'])) {
      add('profit_list', '读取流水数据', 'ops');
      add('account_monitor', '读取账号数据', 'accountmonitor');
      add('schedule_load', '读取排期/工时', 'schedule');
      add('daily_hot', '读取每日热点', 'dailyhot');
    }
    if (taskType === 'project_review' || includesAny(text, ['复盘', '项目'])) {
      add('ideas_list', '读取创意看板', 'ideaboard');
      add('materials_list', '读取素材库元数据', 'material');
      add('schedule_load', '读取排期', 'schedule');
    }
    if (taskType === 'image_generation' || asksForImageGeneration(text)) {
      add(asksForImageEdit(text) ? 'gpt_image2_image2image' : 'gpt_image2_text2image', asksForImageEdit(text) ? 'GPT-Image2 图生图' : 'GPT-Image2 文生图', 'imagegen');
    }
    if (asksForImageUnderstanding(text)) {
      add('vision_analyze_image', '图片理解/视觉分析', 'projectAgent');
    }
    if (includesAny(text, ['素材库', '素材', '容量', '存储'])) {
      add('materials_list', '读取素材库元数据', 'material');
      add('materials_stats', '读取素材库统计', 'material');
      add('materials_storage', '读取素材库容量', 'material');
    }
    if (includesAny(text, ['发布', '分发', '视频发布', '发布任务', '账号绑定'])) {
      add('video_publish_jobs', '读取视频发布任务', 'videopublish');
      add('video_publish_accounts', '读取发布账号配置', 'videopublish');
    }
    if (includesAny(text, ['生图', '图片历史', '封面图', 'AI生图'])) {
      add('imagegen_history', '读取生图历史', 'imagegen');
    }
    if (includesAny(text, ['操作日志', '谁改了', '最近操作', '日志'])) {
      add('operation_logs', '读取操作日志', 'operationLogs');
    }
    if (includesAny(text, ['成员', '权限', '用户'])) {
      add('users_list', '读取成员列表', 'adminUsers');
    }
    if (wantsCodexDeepAnalysis(text)) {
      add('codex_deep_analysis', 'Codex 深度分析', 'projectAgent');
    }
    return tools;
  }

  async function runTool(routePath, body, steps, sources, label, moduleId) {
    const step = toolMeta(routePath.replace(/^\/api\//, '').replace(/[^\w-]/g, '_'), label, moduleId, 'running');
    steps.push(step);
    const route = routes[routePath];
    if (!route) {
      step.status = 'failed';
      step.detail = '接口不存在';
      return { error: 'route not found: ' + routePath };
    }
    if (moduleId && !canAccess(body._auth, moduleId)) {
      step.status = 'skipped';
      step.detail = '当前用户无权限';
      return { error: 'forbidden' };
    }
    const data = await toPromise(route, body);
    if (data && (data.error || data.ok === false || data.success === false)) {
      step.status = 'failed';
      step.detail = String(data.error || data.message || '调用失败').slice(0, 120);
    } else {
      step.status = 'done';
      step.detail = '完成';
    }
    sources.push({
      label: label,
      module: moduleId || '',
      route: routePath,
      summary: summarizeData(data)
    });
    return data;
  }

  async function readPlatformSnapshot(auth, input) {
    const groupScope = detectGroupScope(input);
    const monthScope = detectMonthScope(input);
    const profitBody = { limit: 120 };
    const profitStatsBody = {};
    if (groupScope && groupScope !== '全部') {
      profitBody.grp = groupScope;
      profitStatsBody.grp = groupScope;
    }
    if (monthScope && monthScope.year) {
      profitBody.year = monthScope.year;
      profitStatsBody.year = monthScope.year;
    }
    if (monthScope && monthScope.month) {
      profitBody.month = monthScope.month;
      profitStatsBody.month = monthScope.month;
    }
    const jobs = [
      { key: 'profit', module: 'ops', route: '/api/profit/list', body: profitBody },
      { key: 'profit_stats', module: 'ops', route: '/api/profit/stats', body: profitStatsBody },
      { key: 'schedule', module: 'schedule', route: '/api/schedule/load', body: {} },
      { key: 'daily_hot', module: 'dailyhot', route: '/api/daily-hot/list', body: {} },
      { key: 'account_monitor', module: 'accountmonitor', route: '/api/account-monitor/list', body: { limit: 120, days: 7 } },
      { key: 'ideas', module: 'ideoboard', route: '/api/ideas/list', body: {} },
      { key: 'materials', module: 'material', route: '/api/materials/list', body: { limit: 80 } },
      { key: 'materials_stats', module: 'material', route: '/api/materials/stats', body: {} },
      { key: 'materials_storage', module: 'material', route: '/api/materials/storage', body: {} },
      { key: 'smart_collect', module: 'smartcollect', route: '/api/smart-collect/downloader-status', body: {} },
      { key: 'video_publish_jobs', module: 'videopublish', route: '/api/video-publish/jobs', body: { limit: 80, mineOnly: false } },
      { key: 'video_publish_accounts', module: 'videopublish', route: '/api/video-publish/accounts/list', body: {} },
      { key: 'imagegen_history', module: 'imagegen', route: '/api/imagegen/history', body: { page: 1, limit: 20 } },
      { key: 'vector', module: 'tools', route: '/api/vector/list', body: { limit: 80 } },
      { key: 'bf', module: 'tools', route: '/api/bf/list', body: {} },
      { key: 'cases', module: 'tools', route: '/api/cases/list', body: {} },
      { key: 'copygen_state', module: 'copygen', route: '/api/copygen/state', body: {} },
      { key: 'copygen_records', module: 'copygen', route: '/api/copygen/records', body: {} },
      { key: 'account_styles', module: 'copygen', route: '/api/account-styles/list', body: {} },
      { key: 'operation_logs', module: 'operationLogs', route: '/api/admin/logs', body: { limit: 80 } },
      { key: 'users', module: 'adminUsers', route: '/api/admin/users', body: {} }
    ];
    const out = {
      input: String(input || '').slice(0, 500),
      generated_at: new Date().toISOString(),
      user: {
        id: auth && auth.id || 0,
        username: auth && auth.username || '',
        role: auth && auth.role || '',
        title: auth && auth.title || '',
        permissions: Array.isArray(auth && auth.permissions) ? auth.permissions : []
      },
      modules: {},
      agent_tools: availableAgentTools(auth).map(function(tool) {
        return {
          id: tool.id,
          label: tool.label,
          module: tool.module,
          route: tool.route
        };
      }),
      skipped: []
    };
    await Promise.all(jobs.map(async function(job) {
      if (!canAccess(auth, job.module)) {
        out.skipped.push({ key: job.key, module: job.module, reason: 'forbidden' });
        return;
      }
      const route = routes[job.route];
      if (!route) {
        out.skipped.push({ key: job.key, module: job.module, reason: 'route missing' });
        return;
      }
      const data = await toPromise(route, Object.assign({ _auth: auth }, job.body));
      out.modules[job.key] = summarizeSnapshotModule(job.key, data);
    }));
    return out;
  }

  function summarizeSnapshotModule(key, data) {
    if (!data) return null;
    if (data.error) return { error: String(data.error).slice(0, 300) };
    const pickArray = function(keys) {
      for (const name of keys) {
        if (Array.isArray(data[name])) return data[name];
      }
      return Array.isArray(data) ? data : [];
    };
    const arrays = {
      profit: ['records', 'items', 'data'],
      schedule: ['tasks', 'items'],
      daily_hot: ['items', 'list'],
      account_monitor: ['accounts', 'items'],
      ideas: ['ideas', 'items'],
      materials: ['items', 'materials', 'files'],
      video_publish_jobs: ['jobs', 'items'],
      video_publish_accounts: ['accounts', 'items'],
      imagegen_history: ['list', 'items'],
      vector: ['items', 'list'],
      bf: ['items', 'list'],
      cases: ['items', 'list'],
      copygen_records: ['records', 'items', 'list'],
      account_styles: ['styles', 'items', 'list'],
      users: ['users', 'items']
    };
    const arr = pickArray(arrays[key] || ['items', 'list', 'records']);
    if (arr.length) {
      return {
        count: arr.length,
        total: data.total || data.count || data.totalCount || arr.length,
        sample: arr.slice(0, 30)
      };
    }
    return data;
  }

  function withTimeout(promise, timeoutMs, message) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise(function(resolve) {
        timer = setTimeout(function() {
          resolve({ error: message || 'timeout' });
        }, timeoutMs);
      })
    ]).then(function(result) {
      if (timer) clearTimeout(timer);
      return result;
    }, function(error) {
      if (timer) clearTimeout(timer);
      return { error: error.message || String(error) };
    });
  }

  async function parseIncomingDocumentContext(documents, auth, steps, sources) {
    const docs = normalizeAgentDocuments(documents);
    if (!docs.length) return [];
    const route = routes['/api/workflow/parse-document'];
    const context = [];
    if (!route) {
      context.push({ title: '附件解析提示', text: '后端缺少 /api/workflow/parse-document，无法解析上传文件。', limit: 1000 });
      return context;
    }
    const timeoutMs = Math.max(8000, Number(process.env.AGENT_ATTACHMENT_PARSE_TIMEOUT_MS) || 25000);
    for (const doc of docs) {
      const stepId = 'attachment_parse_' + String(doc.filename || 'document').replace(/[^\w-]/g, '_').slice(0, 48);
      const step = toolMeta(stepId, '解析上传文件：' + doc.filename, 'projectAgent', 'running');
      steps.push(step);
      const result = await withTimeout(toPromise(route, {
        _auth: auth,
        filename: doc.filename,
        size: doc.size,
        mime: doc.mime,
        file_data: doc.file_data
      }), timeoutMs, '附件解析超过 ' + Math.round(timeoutMs / 1000) + ' 秒，已跳过正文解析');
      if (result && result.text) {
        step.status = 'done';
        step.detail = '已提取 ' + String(result.text || '').length + ' 字';
        context.push({
          title: '上传文件：' + (result.title || doc.filename),
          text: result.text,
          limit: 12000
        });
        sources.push({ label: doc.filename, module: 'projectAgent', route: '/api/workflow/parse-document', summary: '文件解析 ' + String(result.text || '').length + ' 字' });
      } else {
        const error = String(result && (result.error || result.message) || '没有提取到可用正文');
        step.status = 'failed';
        step.detail = error.slice(0, 160);
        context.push({
          title: '上传文件解析提示：' + doc.filename,
          text: '这个文件已经上传，但本轮未能提取正文：' + error + '。如果用户问题依赖文件正文，请说明需要重新解析或让用户粘贴关键段落。',
          limit: 1200
        });
        sources.push({ label: doc.filename, module: 'projectAgent', route: '/api/workflow/parse-document', summary: error.slice(0, 160) });
      }
    }
    return context;
  }

  function buildVisionContent(input, normalized) {
    const content = [{
      type: 'text',
      text: [
        '你是项目助手的图片理解工具。请根据用户问题分析图片，输出中文。',
        '优先覆盖：画面内容、图片里的可读文字、关键数据/品牌/人物/项目线索、潜在问题、可执行建议。',
        '如果图片是截图或运营日报素材，请特别检查日期、金额、账号数据、重复项和口径矛盾。',
        '',
        '用户问题：' + String(input || '请分析这张图片')
      ].join('\n')
    }];
    normalized.forEach(function(image, index) {
      content.push({ type: 'text', text: '图片 ' + (index + 1) + '：' + (image.name || '') });
      content.push({ type: 'image_url', image_url: { url: 'data:' + (image.mime || 'image/jpeg') + ';base64,' + image.base64 } });
    });
    return content;
  }

  function gptVisionModelName() {
    return process.env.AGENT_GPT_VISION_MODEL
      || process.env.AGENT_VISION_GPT_MODEL
      || process.env.FHL_VISION_MODEL
      || process.env.OPENAI_VISION_MODEL
      || process.env.FHL_DEFAULT_MODEL
      || process.env.OPENAI_MODEL
      || 'gpt-5.5';
  }

  function visionProviderLabel(data) {
    if (!data || !data.provider) return '完成';
    if (data.provider === 'gpt') return 'GPT 视觉理解完成';
    if (data.provider === 'siliconflow') return 'Qwen3-VL 视觉理解完成';
    return data.provider + ' 视觉理解完成';
  }

  async function runGptVisionImageAnalysis(content) {
    if (!callOpenAICompatible) throw new Error('GPT vision provider is not configured');
    const model = gptVisionModelName();
    const text = await callOpenAICompatible([
      {
        role: 'system',
        content: '你是一个严谨的多模态运营助手。你可以读取图片、截图、表格截图和设计图，请用中文回答，必要时指出不确定性。'
      },
      { role: 'user', content: content }
    ], {
      model: model,
      temperature: 0.15,
      maxTokens: 2600,
      timeoutMs: Number(process.env.AGENT_GPT_VISION_TIMEOUT_MS) || 180000
    });
    const clean = String(text || '').trim();
    if (!clean) throw new Error('GPT vision returned empty content');
    return { ok: true, text: clean, provider: 'gpt', model: model };
  }

  async function runVisionImageAnalysis(input, images, auth) {
    if (!canAccess(auth, 'projectAgent')) return { error: 'forbidden' };
    const normalized = normalizeAgentImages(images).slice(0, 4);
    if (!normalized.length) return { error: 'no image attached' };

    const content = buildVisionContent(input, normalized);
    const failures = [];

    if (process.env.AGENT_DISABLE_GPT_VISION !== '1') {
      try {
        return await runGptVisionImageAnalysis(content);
      } catch (e) {
        const message = e.message || String(e);
        failures.push('GPT vision: ' + message);
        logger.warn('agent GPT vision failed, trying SiliconFlow vision', e);
      }
    }

    if (!siliconflowApiKey) {
      failures.push('Qwen3-VL: SILICONFLOW_API_KEY is not configured');
      return { error: '图片理解失败：' + failures.join('；'), provider_errors: failures };
    }

    try {
      const model = process.env.AGENT_VISION_MODEL || process.env.MATERIAL_VISION_MODEL || 'Qwen/Qwen3-VL-30B-A3B-Instruct';
      const text = await callSiliconFlow([{ role: 'user', content: content }], {
        model: model,
        temperature: 0.15,
        maxTokens: 2600,
        timeoutMs: 180000
      });
      return { ok: true, text: text, provider: 'siliconflow', model: model, fallback_from: failures };
    } catch (e) {
      failures.push('Qwen3-VL: ' + (e.message || String(e)));
      return { error: '图片理解失败：' + failures.join('；'), provider_errors: failures };
    }
  }

  function runCodexDeepAnalysis(input, context, plan, auth) {
    return new Promise(function(resolve) {
      if (!canAccess(auth, 'projectAgent')) {
        resolve({ error: 'forbidden' });
        return;
      }
      const prompt = [
        '你是乌萨奇工作平台里的 Codex 深度分析工具。',
        '只做分析和写作建议，不要修改文件，不要执行破坏性命令，不要泄露密钥。',
        '请基于用户需求和平台上下文，给出更深入、更有判断力的中文分析。',
        '输出结构要清晰，可以包含：结论、依据、风险、下一步动作、可直接放进飞书的段落。',
        '',
        '用户需求：',
        input,
        '',
        'Agent 规划：',
        JSON.stringify(plan || {}, null, 2),
        '',
        '平台上下文摘要：',
        formatContext((context || []).slice(0, 8))
      ].join('\n');
      const outputFile = path.join(os.tmpdir(), 'usagi_codex_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.txt');
      const args = [
        'exec',
        '--cd', root,
        '--sandbox', 'read-only',
        '--ephemeral',
        '--color', 'never',
        '--output-last-message', outputFile,
        '-m', process.env.AGENT_CODEX_MODEL || 'gpt-5.5',
        '-'
      ];
      const useCmd = process.platform === 'win32' && /\.cmd$/i.test(codexCommand);
      const spawnCommand = useCmd ? (process.env.ComSpec || 'cmd.exe') : codexCommand;
      const spawnArgs = useCmd ? ['/d', '/s', '/c', codexCommand].concat(args) : args;
      let child = null;
      try {
        child = spawn(spawnCommand, spawnArgs, {
          cwd: root,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Usagi Web Agent'
          })
        });
      } catch (e) {
        resolve({ error: e.message || String(e) });
        return;
      }
      const stdout = [];
      const stderr = [];
      let settled = false;
      const timer = setTimeout(function() {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch(e) {}
        resolve({ error: 'Codex 深度分析超时' });
      }, Number(process.env.AGENT_CODEX_TIMEOUT_MS) || 180000);

      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { fs.unlinkSync(outputFile); } catch(e) {}
        resolve(result);
      }

      child.stdout.on('data', function(chunk) { stdout.push(chunk); });
      child.stderr.on('data', function(chunk) { stderr.push(chunk); });
      child.on('error', function(error) {
        finish({ error: error.message || String(error) });
      });
      child.on('close', function(code) {
        const out = Buffer.concat(stdout).toString('utf8').trim();
        const err = Buffer.concat(stderr).toString('utf8').trim();
        let finalMessage = '';
        try { finalMessage = fs.readFileSync(outputFile, 'utf8').trim(); } catch(e) {}
        if (code !== 0 && !out) {
          finish({ error: err || ('Codex exited with code ' + code) });
          return;
        }
        finish({
          ok: true,
          text: finalMessage || out || err,
          exit_code: code
        });
      });
      try {
        child.stdin.end(prompt, 'utf8');
      } catch (e) {
        finish({ error: e.message || String(e) });
      }
    });
  }

  function firstMatchingLink(input, pattern) {
    const links = extractLinks(input);
    return links.find(function(link) { return pattern.test(link); }) || '';
  }

  function cleanQuery(input) {
    return String(input || '').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320);
  }

  function textHasAny(text, words) {
    const raw = String(text || '').toLowerCase();
    return words.some(function(word) {
      return raw.indexOf(String(word || '').toLowerCase()) >= 0;
    });
  }

  function detectAgentDataNeeds(input, taskType) {
    const text = String(input || '');
    const weeklyLike = taskType === 'weekly_report' || taskType === 'daily_report' || textHasAny(text, [
      '\u5468\u62a5', '\u65e5\u62a5', '\u5468\u4f1a', '\u672c\u5468\u5de5\u4f5c', '\u4e0a\u5468\u5de5\u4f5c'
    ]);
    const finance = weeklyLike || textHasAny(text, [
      '\u6d41\u6c34', '\u6bdb\u5229', '\u8425\u6536', '\u4e0b\u5355', '\u9501\u6863', '\u4e00\u53e3\u4ef7', '\u975e\u4e00\u53e3\u4ef7',
      '\u5546\u5355\u6570', '\u540c\u6bd4', '\u73af\u6bd4', '\u76ee\u6807', '\u5229\u6da6', '\u91d1\u989d', '\u94b1'
    ]);
    const account = weeklyLike || textHasAny(text, [
      '\u6570\u636e\u770b\u677f', '\u8d26\u53f7', '\u53d1\u6587', '\u53d1\u5e03\u91cf', '\u64ad\u653e', '\u70b9\u8d5e', '\u7c89\u4e1d',
      '\u66f4\u65b0\u8ba1\u5212', '\u4e3b\u5e73\u53f0', '\u7206\u6b3e', '\u9690\u85cf\u6761\u6570'
    ]);
    const schedule = weeklyLike || taskType === 'project_review' || textHasAny(text, [
      '\u6392\u671f', '\u5de5\u65f6', '\u4efb\u52a1', '\u4ee3\u529e', '\u5f85\u529e', '\u63a8\u8fdb', '\u540e\u671f', '\u9009\u9898'
    ]);
    const hot = textHasAny(text, ['\u70ed\u70b9', '\u6bcf\u65e5\u70ed\u70b9']);
    const idea = taskType === 'project_review' || textHasAny(text, ['\u521b\u610f', '\u9009\u9898\u5e93', '\u590d\u76d8']);
    const material = textHasAny(text, ['\u7d20\u6750', '\u7d20\u6750\u5e93', '\u5bb9\u91cf', '\u5b58\u50a8']);
    const publish = textHasAny(text, ['\u53d1\u5e03\u4efb\u52a1', '\u53d1\u5e03\u961f\u5217', '\u5206\u53d1', '\u4e0a\u4f20\u89c6\u9891']);
    const logs = textHasAny(text, ['\u64cd\u4f5c\u65e5\u5fd7', '\u8c01\u6539\u4e86', '\u65e5\u5fd7']);
    const global = asksForPlatformSnapshot(text) || textHasAny(text, [
      '\u5168\u5e73\u53f0', '\u5168\u7ad9', '\u603b\u89c8', '\u6574\u4f53\u60c5\u51b5', '\u90fd\u6709\u54ea\u4e9b', '\u7cfb\u7edf\u72b6\u6001'
    ]);
    return { weeklyLike, finance, account, schedule, hot, idea, material, publish, logs, global };
  }

  function uniquePlannedTools(plan, input, auth, agentMode, options) {
    const allowSiteContext = !options || options.allowSiteContext !== false;
    const available = new Map(availableAgentTools(auth, { allowSiteContext: allowSiteContext }).map(function(tool) { return [tool.id, tool]; }));
    if (allowSiteContext && canAccess(auth, 'accountData')) {
      available.set('account_data_dashboard', {
        id: 'account_data_dashboard',
        label: '读取数据看板发布明细',
        module: 'accountData',
        route: '/api/account-data/dashboard',
        args: { historyMonth: '2026-06' }
      });
    }
    const merged = [];
    const seen = new Set();
    const imageUnderstandingOnly = asksForImageUnderstanding(input) && !asksForImageEdit(input) && !asksForImageGeneration(input);
    const taskType = plan.task_type || detectTask(input);
    const groupScope = normalizeGroupScopeValue(plan.group, input);
    const links = extractLinks(input);
    const needs = detectAgentDataNeeds(input, taskType);
    function add(id, args) {
      if (id === 'gpt_image2_image2image' && !(Array.isArray(plan.images) && plan.images.length)) id = 'gpt_image2_text2image';
      if (!id || seen.has(id) || !available.has(id)) return;
      if (!allowSiteContext && isSiteContextToolId(id)) return;
      if (id === 'platform_snapshot' && !needs.global) return;
      if (id === 'daily_hot' && !needs.hot && !needs.global) return;
      if (id === 'ideas_list' && !needs.idea && !needs.global) return;
      if (id === 'materials_list' && !needs.material && !needs.global && taskType !== 'project_review') return;
      if (imageUnderstandingOnly && (id === 'gpt_image2_text2image' || id === 'gpt_image2_image2image')) return;
      if (id === 'codex_deep_analysis' && agentMode === 'platform') return;
      seen.add(id);
      merged.push({ id: id, args: args && typeof args === 'object' ? args : {} });
    }
    (plan.tools || []).forEach(function(tool) { add(tool.id, tool.args); });

    const workLike = needs.weeklyLike || groupScope || asksForWorkSummary(input) || asksForPlatformData(input);
    if (links.some(function(link) { return /douyin\.com|v\.douyin\.com/i.test(link); })) add('douyin_transcribe', {});
    if (links.some(function(link) { return /bilibili\.com|b23\.tv/i.test(link); })) add('bilibili_transcribe', {});
    if (links.some(function(link) { return /feishu\.cn|larksuite\.com/i.test(link); })) add('feishu_read', {});
    if (links.length && asksForVideoAnalysis(input)) add('video_analyze', {});
    if (needs.global) {
      add('platform_snapshot', {});
    }
    if (workLike) {
      if (needs.finance) {
        add('profit_list', {});
        add('profit_stats', {});
      }
      if (needs.account) {
        add('account_data_dashboard', {});
        add('account_monitor', {});
      }
      if (needs.schedule) add('schedule_load', {});
      if (needs.hot) add('daily_hot', {});
    }
    const wantsImageOutput = taskType === 'image_generation'
      || (asksForImageGeneration(input) && !(asksForImageUnderstanding(input) && !asksForImageEdit(input)));
    if (wantsImageOutput) {
      add(asksForImageEdit(input) ? 'gpt_image2_image2image' : 'gpt_image2_text2image', {});
    }
    if (Array.isArray(plan.images) && plan.images.length && (asksForImageUnderstanding(input) || taskType !== 'image_generation')) {
      add('vision_analyze_image', { question: input });
    }
    if (taskType === 'project_review') {
      if (needs.idea) add('ideas_list', {});
      if (needs.material) add('materials_list', {});
    }
    if (agentMode === 'codex' || (agentMode !== 'platform' && wantsCodexDeepAnalysis(input))) {
      add('codex_deep_analysis', { question: input });
    }
    return merged.slice(0, 14);
  }

  function sanitizeToolArgs(toolId, rawArgs, plan, input) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const groupScope = normalizeGroupScopeValue(args.grp || args.group || plan.group, input);
    const query = cleanQuery(args.query || args.keyword || args.keywords || plan.goal || input);
    if (toolId === 'douyin_transcribe') {
      const url = String(args.url || firstMatchingLink(input, /douyin\.com|v\.douyin\.com/i) || '').trim();
      return {
        action: 'download',
        url: url,
        autoTranscript: true,
        downloadAssets: true,
        downloadType: 'all',
        transcriptModel: process.env.AGENT_DOUYIN_TRANSCRIPT_MODEL || 'FunAudioLLM/SenseVoiceSmall'
      };
    }
    if (toolId === 'bilibili_transcribe') {
      return { url: String(args.url || firstMatchingLink(input, /bilibili\.com|b23\.tv/i) || '').trim() };
    }
    if (toolId === 'feishu_read') {
      return { url: String(args.url || firstMatchingLink(input, /feishu\.cn|larksuite\.com/i) || '').trim() };
    }
    if (toolId === 'video_analyze') {
      return {
        url: String(args.url || firstMatchingLink(input, /https?:\/\//i) || '').trim(),
        mode: String(args.mode || (/转写|字幕|口播|文稿|transcript/i.test(input) ? 'transcript' : 'auto')).trim() || 'auto'
      };
    }
    if (toolId === 'vector_search') {
      const allowedCollections = new Set(['wenan', 'bf', 'cases', 'anythingllm_md_v2']);
      const collection = allowedCollections.has(String(args.collection || '')) ? String(args.collection) : (plan.task_type === 'bf_analysis' ? 'bf' : 'wenan');
      return { query: query, collection: collection, limit: Math.max(3, Math.min(Number(args.limit || args.top_k) || 6, 10)) };
    }
    if (toolId === 'profit_list') {
      const body = { limit: Math.max(20, Math.min(Number(args.limit) || 120, 300)) };
      if (groupScope && groupScope !== '全部') body.grp = groupScope;
      const monthScope = detectMonthScope(input);
      if (monthScope && monthScope.year) body.year = monthScope.year;
      if (monthScope && monthScope.month) body.month = monthScope.month;
      return body;
    }
    if (toolId === 'profit_stats') {
      const body = {};
      if (groupScope && groupScope !== '全部') body.grp = groupScope;
      const monthScope = detectMonthScope(input);
      if (monthScope && monthScope.year) body.year = monthScope.year;
      if (monthScope && monthScope.month) body.month = monthScope.month;
      return body;
    }
    if (toolId === 'account_monitor') {
      return {
        limit: Math.max(20, Math.min(Number(args.limit) || 120, 300)),
        days: Math.max(1, Math.min(Number(args.days) || 7, 31))
      };
    }
    if (toolId === 'materials_list') {
      return { limit: Math.max(20, Math.min(Number(args.limit) || 80, 200)) };
    }
    if (toolId === 'video_publish_jobs') {
      return {
        limit: Math.max(20, Math.min(Number(args.limit) || 80, 200)),
        mineOnly: args.mineOnly === undefined ? false : args.mineOnly
      };
    }
    if (toolId === 'imagegen_history') {
      return { page: Math.max(1, Number(args.page) || 1), limit: Math.max(5, Math.min(Number(args.limit) || 20, 50)) };
    }
    if (toolId === 'operation_logs' || toolId === 'vector_list') {
      return { limit: Math.max(20, Math.min(Number(args.limit) || 80, 200)) };
    }
    if (toolId === 'gpt_image2_text2image' || toolId === 'gpt_image2_image2image') {
      const prompt = String(args.prompt || args.image_prompt || plan.goal || input || '').trim();
      const defaultResolution = toolId === 'gpt_image2_text2image' ? '1K' : '2K';
      const body = {
        prompt: prompt,
        ratio: String(args.ratio || args.aspect_ratio || '1:1'),
        resolution: String(args.resolution || args.resolution_type || defaultResolution),
        quality: String(args.quality || 'auto')
      };
      if (toolId === 'gpt_image2_image2image') {
        const rawImages = []
          .concat(Array.isArray(args.image_base64_list) ? args.image_base64_list : [])
          .concat(Array.isArray(args.images) ? args.images : [])
          .concat(Array.isArray(args.reference_images) ? args.reference_images : [])
          .concat(args.image_base64 || args.image || [])
          .concat(Array.isArray(plan.images) ? plan.images : [])
          .map(function(item) {
            if (item && typeof item === 'object') return item.base64 || item.image_base64 || item.image || item.data || '';
            return item;
          })
          .map(function(item) { return String(item || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim(); })
          .filter(Boolean);
        body.image_base64_list = Array.from(new Set(rawImages)).slice(0, 4);
        body.image_base64 = body.image_base64_list[0] || '';
      }
      return body;
    }
    return {};
  }

  function contextItemForTool(toolId, tool, data, input) {
    if (!data) return null;
    if (toolId === 'douyin_transcribe') {
      const files = Array.isArray(data.files) ? data.files : [];
      const text = data.transcript_text || data.text || [
        data.message || data.error || '未拿到抖音转写文本',
        files.length ? ('已下载文件：\n' + files.map(function(file) {
          return '- ' + (file.type || 'file') + ' ' + (file.url || file.path || file.name || '');
        }).join('\n')) : '',
        data.stderr ? ('工具日志：' + clip(data.stderr, 800)) : ''
      ].filter(Boolean).join('\n');
      return { title: '抖音链接内容', text: text || JSON.stringify(data, null, 2), limit: 9000 };
    }
    if (toolId === 'bilibili_transcribe') {
      return { title: 'B站链接内容：' + (data.title || firstMatchingLink(input, /bilibili\.com|b23\.tv/i)), text: data.text || data.transcript_text || data.error || JSON.stringify(data, null, 2), limit: 7000 };
    }
    if (toolId === 'feishu_read') {
      return { title: '飞书文档：' + (data.title || firstMatchingLink(input, /feishu\.cn|larksuite\.com/i)), text: data.text || data.content || data.markdown || data.error || JSON.stringify(data, null, 2), limit: 7000 };
    }
    if (toolId === 'codex_deep_analysis') {
      return { title: 'Codex 深度分析', text: data.text || data.error || JSON.stringify(data, null, 2), limit: 14000 };
    }
    if (toolId === 'vision_analyze_image') {
      return { title: '图片理解/视觉分析', text: data.text || data.error || JSON.stringify(data, null, 2), limit: 7000 };
    }
    if (toolId === 'video_analyze') {
      return {
        title: '视频打点/画面分析：' + (data.title || data.videoTitle || firstMatchingLink(input, /https?:\/\//i)),
        text: data.error || JSON.stringify({
          summary: data.summary || data.text || '',
          segments: data.segments || [],
          transcript_text: data.transcript_text || data.transcript || '',
          meta: data.meta || {}
        }, null, 2),
        limit: 12000
      };
    }
    if (toolId === 'gpt_image2_text2image' || toolId === 'gpt_image2_image2image') {
      const url = data.url || data.image_url || data.result_url || '';
      return { title: toolId === 'gpt_image2_image2image' ? 'GPT-Image2 图生图结果' : 'GPT-Image2 文生图结果', text: url ? ('图片链接：' + url) : (data.error || JSON.stringify(data, null, 2)), limit: 2000 };
    }
    const titles = {
      vector_search: '向量库检索结果',
      bf_list: 'BF库列表',
      cases_list: '案例库列表',
      profit_list: '流水数据',
      profit_stats: '流水统计',
      account_monitor: '账号监控数据',
      schedule_load: '排期/工时数据',
      daily_hot: '每日热点数据',
      ideas_list: '创意看板数据',
      materials_list: '素材库元数据',
      materials_stats: '素材库统计',
      materials_storage: '素材库容量',
      smart_collect_status: 'AI剪辑状态',
      video_publish_accounts: '视频发布账号配置',
      video_publish_jobs: '视频发布任务',
      imagegen_history: 'AI生图历史',
      operation_logs: '操作日志',
      users_list: '成员列表',
      copygen_state: '旧文案工作台状态',
      copygen_records: '旧文案记录',
      account_styles_list: '账号风格卡',
      vector_list: '向量库条目',
      video_analyze: '视频打点/画面分析'
    };
    return {
      title: titles[toolId] || (tool && tool.label) || toolId,
      text: JSON.stringify(data, null, 2),
      limit: ['profit_list', 'account_monitor', 'schedule_load'].indexOf(toolId) >= 0 ? 7000 : 5000
    };
  }

  async function gatherContextFromPlan(input, plan, auth, steps, sources, agentMode, options) {
    const allowSiteContext = !options || options.allowSiteContext !== false;
    const context = [];
    const available = new Map(availableAgentTools(auth, { allowSiteContext: allowSiteContext }).map(function(tool) { return [tool.id, tool]; }));
    if (allowSiteContext && canAccess(auth, 'accountData')) {
      available.set('account_data_dashboard', {
        id: 'account_data_dashboard',
        label: '读取数据看板发布明细',
        module: 'accountData',
        route: '/api/account-data/dashboard',
        args: { historyMonth: '2026-06' }
      });
    }
    const planned = uniquePlannedTools(plan, input, auth, agentMode, { allowSiteContext: allowSiteContext });
    const results = {};

    for (const plannedTool of planned) {
      const tool = available.get(plannedTool.id);
      if (!tool) continue;
      if (plannedTool.id === 'codex_deep_analysis') continue;
      if (plannedTool.id === 'platform_snapshot') {
        const step = toolMeta('platform_snapshot', tool.label, tool.module, 'running');
        steps.push(step);
        const data = await readPlatformSnapshot(auth, input);
        results.platform_snapshot = data;
        step.status = 'done';
        step.detail = '完成';
        sources.push({ label: tool.label, module: tool.module, route: tool.route, summary: summarizeData(data) });
        context.push({ title: '平台总览快照', text: JSON.stringify(data, null, 2), limit: 18000 });
        continue;
      }
      if (plannedTool.id === 'vision_analyze_image') {
        const step = toolMeta('vision_analyze_image', tool.label, tool.module, 'running');
        steps.push(step);
        const data = await runVisionImageAnalysis(input, plan.images || [], auth);
        results.vision_analyze_image = data;
        if (data && data.error) {
          step.status = 'failed';
          step.detail = String(data.error).slice(0, 160);
        } else {
          step.status = 'done';
          step.detail = visionProviderLabel(data);
        }
        sources.push({ label: tool.label, module: tool.module, route: tool.route, summary: data && data.error ? data.error : visionProviderLabel(data) });
        const item = contextItemForTool(plannedTool.id, tool, data, input);
        if (item && item.text) context.push(item);
        continue;
      }
      const args = sanitizeToolArgs(plannedTool.id, plannedTool.args, plan, input);
      if ((plannedTool.id === 'douyin_transcribe' || plannedTool.id === 'bilibili_transcribe' || plannedTool.id === 'feishu_read' || plannedTool.id === 'video_analyze') && !args.url) {
        steps.push(toolMeta(plannedTool.id, tool.label, tool.module, 'skipped', '未找到可读取的链接'));
        continue;
      }
      const data = await runTool(tool.route, Object.assign({ _auth: auth }, args), steps, sources, tool.label, tool.module);
      results[plannedTool.id] = data;
      const item = contextItemForTool(plannedTool.id, tool, data, input);
      if (item && item.text) context.push(item);
    }

    const groupScope = normalizeGroupScopeValue(plan.group, input);
    if (groupScope && (results.profit_list || results.profit_stats || results.account_monitor || results.schedule_load)) {
      const monthScope = detectMonthScope(input);
      context.unshift({
        title: groupScope + '工作数据汇总',
        text: JSON.stringify({
          group: groupScope,
          period: monthScope || null,
          plan_reasoning: plan.reasoning || '',
          profit: summarizeGroupProfit(results.profit_list, results.profit_stats, groupScope),
          account_monitor: summarizeGroupMonitor(results.account_monitor, groupScope),
          schedule: summarizeGroupSchedule(results.schedule_load, groupScope)
        }, null, 2),
        limit: 12000
      });
    }

    if (planned.some(function(tool) { return tool.id === 'codex_deep_analysis'; })) {
      const tool = available.get('codex_deep_analysis');
      const step = toolMeta('codex_deep_analysis', tool ? tool.label : 'Codex 深度分析', 'projectAgent', 'running');
      steps.push(step);
      const codexResult = await runCodexDeepAnalysis(input, context, plan, auth);
      results.codex_deep_analysis = codexResult;
      if (codexResult && codexResult.error) {
        step.status = 'failed';
        step.detail = String(codexResult.error).slice(0, 160);
      } else {
        step.status = 'done';
        step.detail = '完成';
        context.push({
          title: 'Codex 深度分析',
          text: codexResult.text || JSON.stringify(codexResult, null, 2),
          limit: 14000
        });
      }
      sources.push({
        label: 'Codex 深度分析',
        module: 'projectAgent',
        route: 'codex exec',
        summary: codexResult && codexResult.error ? codexResult.error : '深度分析完成'
      });
    }

    if (allowSiteContext && !context.length && visibleToolsFor(input, plan.task_type, auth, { allowSiteContext: allowSiteContext }).length) {
      return gatherContext(input, plan.task_type, auth, steps, sources);
    }
    return context.filter(function(item) { return item.text; });
  }

  function summarizeData(data) {
    if (!data) return '';
    if (data.title) return String(data.title).slice(0, 80);
    if (data.text) return '文本 ' + String(data.text).length + ' 字';
    if (data.transcript_text) return '转写 ' + String(data.transcript_text).length + ' 字';
    if (Array.isArray(data.results)) return data.results.length + ' 条结果';
    if (Array.isArray(data.items)) return data.items.length + ' 条记录';
    if (Array.isArray(data.tasks)) return data.tasks.length + ' 条排期';
    if (Array.isArray(data.records)) return data.records.length + ' 条流水';
    if (Array.isArray(data.ideas)) return data.ideas.length + ' 条创意';
    if (data.total !== undefined) return '共 ' + data.total + ' 条';
    return JSON.stringify(data).slice(0, 120);
  }

  function feishuUrlFromResult(data) {
    if (!data) return '';
    return data.url || data.link || data.doc_url || data.document_url || data.feishu_url || data.feishuUrl || '';
  }

  async function writeFeishuDocument(auth, title, content, steps, sources) {
    const route = routes['/api/to-feishu'];
    if (!route) return { error: 'feishu writer route missing' };
    const data = await runTool('/api/to-feishu', {
      _auth: auth,
      title: title || '项目助手草稿',
      content: content || '',
      doc_id: '',
      tool: 'docx'
    }, steps, sources, '写入飞书文档', 'tools');
    return data;
  }

  function formatContext(context) {
    return context.map(function(item, index) {
      return [
        '【来源 ' + (index + 1) + '】' + item.title,
        clip(item.text, item.limit || 2200)
      ].join('\n');
    }).join('\n\n---\n\n');
  }

  function summarizeGroupSchedule(schedule, groupScope) {
    const tasks = Array.isArray(schedule && schedule.tasks) ? schedule.tasks : [];
    const members = Array.isArray(schedule && schedule.members) ? schedule.members : [];
    const groupHint = String(groupScope || '').replace(/^内容/, '').replace(/组$/, '');
    let picked = tasks;
    if (groupHint) {
      const scoped = tasks.filter(function(task) {
        const haystack = [task.group, task.group_name, task.person, task.account, task.content, task.remark, task.type]
          .map(function(v) { return String(v || ''); })
          .join(' ');
        return haystack.indexOf(groupScope) >= 0 || haystack.indexOf(groupHint + '组') >= 0;
      });
      if (scoped.length) picked = scoped;
    }
    const statusCount = {};
    const peopleCount = {};
    picked.forEach(function(task) {
      const status = String(task.status || '未标记');
      statusCount[status] = (statusCount[status] || 0) + 1;
      const person = String(task.person || '未分配');
      peopleCount[person] = (peopleCount[person] || 0) + 1;
    });
    return {
      group: groupScope || '未指定',
      total_tasks: picked.length,
      all_tasks_in_board: tasks.length,
      members: members,
      status_count: statusCount,
      people_count: peopleCount,
      sample_tasks: picked.slice(0, 80)
    };
  }

  function summarizeGroupProfit(profit, stats, groupScope) {
    const records = Array.isArray(profit && profit.records) ? profit.records
      : Array.isArray(profit && profit.items) ? profit.items
      : Array.isArray(profit && profit.data) ? profit.data
      : [];
    function pickNumber(row, keys) {
      for (const key of keys) {
        const value = row && row[key];
        const num = Number(String(value === undefined ? '' : value).replace(/[^\d.-]/g, ''));
        if (Number.isFinite(num) && num) return num;
      }
      return 0;
    }
    const byAccount = {};
    const projects = new Set();
    const totals = records.reduce(function(acc, row) {
      const account = String(row.account || row['账号'] || '未填账号').trim() || '未填账号';
      const project = String(row.project || row['项目'] || '').trim();
      const revenue = pickNumber(row, ['revenue', 'fee', 'amount', 'group_revenue', '流水', '集团流水']);
      const margin = pickNumber(row, ['margin', 'profit', 'gross_profit', 'department_margin', '部门毛利', '毛利']);
      const orderAmount = pickNumber(row, ['order_amount', 'orderAmount', '下单金额', '锁档金额']);
      const finalAmount = pickNumber(row, ['final_amount', 'finalAmount', '最终合作价', '最终合作价格']);
      acc.revenue += revenue;
      acc.margin += margin;
      acc.order_amount += orderAmount;
      acc.final_amount += finalAmount;
      if (project) projects.add(project);
      if (!byAccount[account]) byAccount[account] = { count: 0, revenue: 0, margin: 0, order_amount: 0, final_amount: 0 };
      byAccount[account].count += 1;
      byAccount[account].revenue += revenue;
      byAccount[account].margin += margin;
      byAccount[account].order_amount += orderAmount;
      byAccount[account].final_amount += finalAmount;
      return acc;
    }, { revenue: 0, margin: 0, order_amount: 0, final_amount: 0 });
    const statsCount = Number(stats && stats.count);
    const statsRevenue = Number(stats && stats.total_revenue);
    const statsMargin = Number(stats && stats.total_margin);
    const hasStats = Number.isFinite(statsCount) || Number.isFinite(statsRevenue) || Number.isFinite(statsMargin);
    return {
      group: groupScope || '全部',
      count: Number.isFinite(statsCount) ? statsCount : records.length,
      project_count: projects.size,
      revenue_total: Number.isFinite(statsRevenue) ? Math.round(statsRevenue) : Math.round(totals.revenue),
      margin_total: Number.isFinite(statsMargin) ? Math.round(statsMargin) : Math.round(totals.margin),
      order_amount_total: Math.round(totals.order_amount),
      final_amount_total: Math.round(totals.final_amount),
      api_stats_revenue: Number.isFinite(statsRevenue) ? Math.round(statsRevenue) : 0,
      api_stats_margin: Number.isFinite(statsMargin) ? Math.round(statsMargin) : 0,
      answer_guidance: hasStats
        ? '回答流水/营收/毛利必须优先使用 revenue_total、margin_total、count；下单情况可补充 order_amount_total、final_amount_total，但不要把订单金额或样本明细加总冒充流水。'
        : '未拿到流水统计接口时才可参考样本明细，必须说明数据可能不完整。',
      by_account: Object.keys(byAccount).sort(function(a, b) {
        return byAccount[b].margin - byAccount[a].margin;
      }).slice(0, 20).map(function(account) {
        const item = byAccount[account];
        return {
          account: account,
          count: item.count,
          revenue: Math.round(item.revenue),
          margin: Math.round(item.margin),
          order_amount: Math.round(item.order_amount),
          final_amount: Math.round(item.final_amount)
        };
      }),
      stats: stats || {},
      sample_records: records.slice(0, 80)
    };
  }

  function summarizeGroupMonitor(monitor, groupScope) {
    const accounts = Array.isArray(monitor && monitor.accounts) ? monitor.accounts : [];
    const items = Array.isArray(monitor && monitor.items) ? monitor.items : [];
    const groupHint = String(groupScope || '').replace(/^内容/, '').replace(/组$/, '');
    let scopedAccounts = accounts;
    if (groupHint) {
      const filtered = accounts.filter(function(account) {
        const text = [account.group, account.group_name, account.name, account.displayName, account.owner]
          .map(function(v) { return String(v || ''); }).join(' ');
        return text.indexOf(groupScope) >= 0 || text.indexOf(groupHint + '组') >= 0;
      });
      if (filtered.length) scopedAccounts = filtered;
    }
    const accountIds = new Set(scopedAccounts.map(function(account) { return account.id || account.accountId || account.name; }).filter(Boolean));
    const scopedItems = accountIds.size
      ? items.filter(function(item) {
          return accountIds.has(item.accountId) || accountIds.has(item.account_id) || accountIds.has(item.accountName) || accountIds.has(item.account);
        })
      : items;
    return {
      group: groupScope || '未指定',
      accounts: scopedAccounts.slice(0, 60),
      item_count: scopedItems.length,
      recent_items: scopedItems.slice(0, 120)
    };
  }

  async function gatherContext(input, taskType, auth, steps, sources) {
    const context = [];
    const links = extractLinks(input);
    const groupScope = detectGroupScope(input);
    const monthScope = detectMonthScope(input);
    for (const link of links.slice(0, 4)) {
      if (/douyin\.com|v\.douyin\.com/i.test(link)) {
        const data = await runTool('/api/douyin/downloader', {
          _auth: auth,
          action: 'download',
          url: link,
          autoTranscript: true,
          downloadAssets: true,
          downloadType: 'all',
          transcriptModel: process.env.AGENT_DOUYIN_TRANSCRIPT_MODEL || 'FunAudioLLM/SenseVoiceSmall'
        }, steps, sources, '抖音链接转写', 'tools');
        context.push({
          title: '抖音链接：' + link,
          text: data.transcript_text || data.text || data.message || data.error || '',
          limit: 5000
        });
      } else if (/bilibili\.com|b23\.tv/i.test(link)) {
        const data = await runTool('/api/transcribe/bilibili', { _auth: auth, url: link }, steps, sources, 'B站链接转写', 'tools');
        context.push({
          title: 'B站链接：' + (data.title || link),
          text: data.text || data.error || '',
          limit: 5000
        });
      } else if (/feishu\.cn|larksuite\.com/i.test(link)) {
        const data = await runTool('/api/feishu/read', { _auth: auth, url: link }, steps, sources, '飞书文档读取', 'tools');
        context.push({
          title: '飞书文档：' + (data.title || link),
          text: data.text || data.content || data.markdown || data.error || '',
          limit: 6000
        });
      }
    }

    if (taskType === 'weekly_report' || taskType === 'daily_report' || (groupScope && (asksForWorkSummary(input) || asksForPlatformData(input)))) {
      const profitArgs = { _auth: auth, limit: 120 };
      const statsArgs = { _auth: auth };
      if (monthScope && monthScope.year) {
        profitArgs.year = monthScope.year;
        statsArgs.year = monthScope.year;
      }
      if (monthScope && monthScope.month) {
        profitArgs.month = monthScope.month;
        statsArgs.month = monthScope.month;
      }
      const profit = await runTool('/api/profit/list', profitArgs, steps, sources, '流水数据', 'ops');
      const stats = await runTool('/api/profit/stats', statsArgs, steps, sources, '流水统计', 'ops');
      const monitor = await runTool('/api/account-monitor/list', { _auth: auth, limit: 120, days: 7 }, steps, sources, '账号数据', 'accountmonitor');
      const schedule = await runTool('/api/schedule/load', { _auth: auth }, steps, sources, '排期/工时', 'schedule');
      if (groupScope) {
        const scopedProfitArgs = Object.assign({}, profitArgs, { grp: groupScope });
        const scopedStatsArgs = Object.assign({}, statsArgs, { grp: groupScope });
        const scopedProfit = await runTool('/api/profit/list', scopedProfitArgs, steps, sources, groupScope + '流水数据', 'ops');
        const scopedStats = await runTool('/api/profit/stats', scopedStatsArgs, steps, sources, groupScope + '流水统计', 'ops');
        context.push({
          title: groupScope + '工作数据汇总',
          text: JSON.stringify({
            group: groupScope,
            period: monthScope || null,
            profit: summarizeGroupProfit(scopedProfit, scopedStats, groupScope),
            account_monitor: summarizeGroupMonitor(monitor, groupScope),
            schedule: summarizeGroupSchedule(schedule, groupScope)
          }, null, 2),
          limit: 10000
        });
      }
      if (!groupScope) {
        context.push({ title: '本周流水/营收数据', text: JSON.stringify({ period: monthScope || null, profit: profit, stats: stats }, null, 2), limit: 6000 });
      }
      context.push({ title: '账号发布与净增粉数据', text: JSON.stringify(monitor, null, 2), limit: 6000 });
      context.push({ title: '排期和工时数据', text: JSON.stringify(schedule, null, 2), limit: 6000 });
    }

    if (taskType === 'project_review') {
      const ideas = await runTool('/api/ideas/list', { _auth: auth }, steps, sources, '创意看板', 'ideaboard');
      const schedule = await runTool('/api/schedule/load', { _auth: auth }, steps, sources, '排期数据', 'schedule');
      const materials = await runTool('/api/materials/list', { _auth: auth, limit: 80 }, steps, sources, '素材库元数据', 'material');
      context.push({ title: '创意看板', text: JSON.stringify(ideas, null, 2), limit: 5000 });
      context.push({ title: '项目排期', text: JSON.stringify(schedule, null, 2), limit: 5000 });
      context.push({ title: '素材库元数据', text: JSON.stringify(materials, null, 2), limit: 4000 });
    }

    if (['bf_analysis', 'outline_writing', 'research', 'free_writing', 'project_review'].indexOf(taskType) >= 0) {
      const query = input.replace(/https?:\/\/\S+/g, ' ').slice(0, 240);
      if (query.trim()) {
        const vector = await runTool('/api/vector/search', { _auth: auth, query: query, collection: taskType === 'bf_analysis' ? 'bf' : 'wenan', limit: 5 }, steps, sources, '向量库检索', 'tools');
        const bf = taskType === 'bf_analysis' ? await runTool('/api/bf/list', { _auth: auth }, steps, sources, 'BF库列表', 'tools') : null;
        context.push({ title: '向量库命中', text: JSON.stringify(vector, null, 2), limit: 5000 });
        if (bf) context.push({ title: 'BF库参考', text: JSON.stringify(bf, null, 2), limit: 4000 });
      }
    }

    return context.filter(function(item) { return item.text; });
  }

  function systemPromptFor(taskType) {
    const base = [
      '你是乌萨奇工作平台里的项目助手，服务内容团队。',
      '回复使用中文，直接、可执行、有业务判断。',
      '你只能基于用户输入和给定平台数据作答；信息不足时说明缺口，不要编造。',
      '输出要适合保存成草稿或写入飞书。',
      '如果引用了平台数据，在末尾写“参考来源”。',
      '你是全平台 Agent：可以综合账号热榜、每日热点、文案工作台、文案工作流、创意看板、排期、运营、AI生图、素材库、AI剪辑、视频发布、反馈、向量库、操作日志等可见数据。',
      '权限规则：只能使用工具返回的可见数据；看不到的模块要说明没有权限或没有数据。',
      '飞书写入规则：如果用户明确要求“写入/同步/保存/导出到飞书”或“给我飞书链接”，平台会自动新建飞书文档并写入本次输出或上一条助手正文；你不要回答“没有可用飞书链接”，不要把向量库检索为空当成不能创建飞书文档。',
      '写操作规则：不要静默新增、删除、发布、改状态、改排期、改流水。用户明确要求写入飞书时，这是已确认的写入动作，可以继续生成内容，系统会在生成后写入飞书并返回链接。',
      '视频/链接规则：抖音/B站链接必须优先调用转写/读取工具；没有转写文本时明确说明工具失败、已下载文件或缺口，不要只凭标题标签当成视频内容。'
    ].join('\n');
    const modes = {
      transcribe_link: '任务：整理链接转写结果。先给干净原文，再给摘要、可复用观点、后续可写作方向。',
      read_feishu: '任务：读取并总结飞书文档。输出要保留文档重点、风险和下一步。',
      bf_analysis: '任务：做 BF 分析。关注客户诉求、卖点、目标人群、内容角度、风险、可执行脚本方向。',
      weekly_report: '任务：按内容团队周会/周报格式生成工作评价或周报。用户问“几组本周工作/做得怎么样”时，优先使用“工作数据汇总”、排期、流水、账号监控数据做判断；向量库没命中不等于平台没有数据。结构包含：本月营收/毛利概况、上周账号数据情况、工时/排期情况、本周工作计划、风险与需要协调事项。若数据不足，要明确列出已读到的数据和缺口。',
      daily_report: '任务：生成精简的内容小组日报草稿。结构固定为：1.当日产出（日常/商单），含昨日或指定数据日账号数据；2.项目执行进度，只写正在执行的商单、素材代做或明确商业项目，禁止写日常、选题和热点，没有商单或商业项目时写“暂无项目执行”；3.截止当月营收情况，包含锁档、已执行、其他营收、合计和毛利；4.次日工作计划。信息不足时保留“待补充”，不要编造具体数字。',
      project_review: '任务：做项目复盘。结构包含：目标、进展、数据表现、问题归因、可复用经验、下周动作。',
      research: '任务：查资料并整理。区分确定事实、平台库参考、创作启发。',
      image_generation: '任务：生成或修改图片。若工具已返回图片链接，直接把图片链接给用户，并简单说明提示词、比例和可继续修改方向；不要假装已经看到未返回的图片。',
      outline_writing: [
        '任务：生成客户版短视频推广大纲，用于达人商单、游戏推广、口播视频方向。必须输出“大纲”，不要写成完整脚本或分镜。',
        '固定格式必须包含：',
        '《项目名》-达人名-大纲V1',
        '达人：xxx',
        '发布平台：抖音/B站',
        '视频时长：60+ / 3min+',
        '',
        '【大纲内容】',
        '第一部分（情怀引入40%）',
        '第二部分（卖点输出50%）',
        '第三部分（玩家引导10%）',
        '',
        '如果用户给了不同占比或不同标题，以用户为准；否则默认使用上面的三段和占比。',
        '每一部分用 1-2 句话说明“以什么为切入点，带出什么内容”，语气要像给客户看的方案，客气、清晰、可执行。',
        '开头需要有一句可口播的概括钩子，再接“以……为切入点，带出……”；不要只写“以XX为切入点”。',
        '第一部分要尽早带到游戏/产品本体，不要只讲明星或热点；如果有联动/明星/素材混剪，可以写“切入素材混剪/实机画面”，不要写“客户给的素材/甲方素材”。',
        '第二部分要自然承接福利和核心卖点，核心卖点可以多讲一点，但仍保持大纲体。',
        '第三部分简单引导搜索、预约、下载或关注上线信息，不要为了押开头硬回扣梗。',
        '避免绝对化和风险词：少用“最、第一、唯一、史上、全网、无敌、绝对”；避免“罪、犯罪”等易违规词。',
        '输出字数尽量控制在 250-450 字；不要输出参考来源，除非确实引用了平台数据。'
      ].join('\n'),
      free_writing: '任务：自由写作。先理解用户目标，再输出可直接使用的版本。'
    };
    return base + '\n' + (modes[taskType] || modes.free_writing);
  }

  async function generateAnswer(input, taskType, history, context) {
    const messages = [{ role: 'system', content: systemPromptFor(taskType) }];
    (history || []).slice(-8).forEach(function(item) {
      messages.push({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: clip(item.content || item.text || '', 1200)
      });
    });
    messages.push({
      role: 'user',
      content: [
        '用户当前需求：',
        input,
        '',
        context.length ? '平台上下文：\n' + formatContext(context) : '平台上下文：本次没有读取到可用外部上下文。'
      ].join('\n')
    });

    const failures = [];
    if (callOpenAICompatible) {
      try {
        return await callOpenAICompatible(messages, { model: 'gpt-5.5', temperature: 0.55 });
      } catch (e) {
        failures.push('主模型：' + (e.message || String(e)));
        logger.warn('agent primary model failed, trying SiliconFlow', e);
      }
    }
    if (siliconflowApiKey) {
      try {
        return await callSiliconFlow(messages, { temperature: 0.55 });
      } catch (e) {
        failures.push('硅基流动：' + (e.message || String(e)));
        logger.warn('agent SiliconFlow fallback failed', e);
      }
    }
    if (callModelText) {
      try {
        return await callModelText(systemPromptFor(taskType), messages[messages.length - 1].content, { temperature: 0.55 });
      } catch (e) {
        failures.push('备用模型：' + (e.message || String(e)));
      }
    }
    const contextText = context.length
      ? '\n\n已读取到的上下文摘要：\n' + context.map(function(item) {
          return '- ' + item.title + '：' + clip(item.text, 260).replace(/\n+/g, ' ');
        }).join('\n')
      : '';
    return '模型服务这次没有连上，所以我先保留一个可继续处理的草稿。' + contextText + '\n\n错误摘要：' + failures.join('；');
  }

  function buildAnswerMessages(input, taskType, history, context) {
    const messages = [{ role: 'system', content: systemPromptFor(taskType) }];
    (history || []).slice(-8).forEach(function(item) {
      messages.push({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: clip(item.content || item.text || '', 1200)
      });
    });
    messages.push({
      role: 'user',
      content: [
        '用户当前需求：',
        input,
        '',
        context.length ? '平台上下文：\n' + formatContext(context) : '平台上下文：本次没有读取到可用外部上下文。'
      ].join('\n')
    });
    return messages;
  }

  async function streamAnswer(input, taskType, history, context, handlers) {
    handlers = handlers || {};
    const messages = buildAnswerMessages(input, taskType, history, context);
    if (callOpenAICompatibleStream) {
      try {
        return await callOpenAICompatibleStream(messages, { model: 'gpt-5.5', temperature: 0.55 }, handlers);
      } catch (e) {
        logger.warn('agent streaming model failed, falling back to non-stream', e);
      }
    }
    const output = await generateAnswer(input, taskType, history, context);
    if (handlers.onDelta && output) handlers.onDelta(output, null);
    if (handlers.onDone) handlers.onDone(output);
    return output;
  }

  async function runAgent(body, cb, useExplicitTask) {
    const auth = body._auth || {};
    const input = String(body.message || body.input || body.prompt || '').trim();
    const explicitTask = useExplicitTask ? (body.task_type || body.taskType) : null;
    const requestedMode = String(body.agent_mode || body.agentMode || 'auto').toLowerCase();
    const agentMode = requestedMode === 'codex' || requestedMode === 'platform' ? requestedMode : 'auto';
    const allowSiteContext = useSiteContextEnabled(body);
    let taskType = detectTask(input, explicitTask);
    if (!input) { cb({ error: 'message required' }); return; }
    const steps = [];
    const sources = [];
    let plan = null;
    try {
      const incomingHistory = normalizeAgentMessages(body.history);
      const incomingImages = normalizeAgentImages(body.images).slice(0, 4);
      const incomingDocuments = normalizeAgentDocuments(body.documents);
      let baseMessages = incomingHistory;
      let existingDraft = null;
      let sessionSummary = '';
      if (body.draft_id || body.draftId) {
        existingDraft = await draftStore.get(body.draft_id || body.draftId, auth);
        if (existingDraft && Array.isArray(existingDraft.messages) && existingDraft.messages.length) {
          baseMessages = normalizeAgentMessages(existingDraft.messages);
          sessionSummary = existingDraft.summary || '';
        }
      }
      const modelHistory = buildAgentHistory(sessionSummary, baseMessages);
      const documentContext = await parseIncomingDocumentContext(incomingDocuments, auth, steps, sources);
      const planningInput = input
        + (incomingImages.length ? '\n\n[用户本轮附带了图片，可作为本轮视觉输入。]' : '')
        + (documentContext.length ? '\n\n[用户本轮上传文件解析摘要]\n' + formatContext(documentContext) : (incomingDocuments.length ? '\n\n[用户本轮上传了文件，但正文还没有解析成功。]' : ''));
      if (wantsOnlyFeishuSync(input)) {
        const previousOutput = latestAssistantContent(baseMessages) || String((existingDraft && existingDraft.output) || '').trim();
        if (previousOutput) {
          const title = titleFor((existingDraft && existingDraft.task_type) || taskType, (existingDraft && existingDraft.input) || input);
          const writeStep = toolMeta('feishu_write', '写入飞书文档', 'tools', 'running');
          steps.push(writeStep);
          let feishuData = null;
          let feishuUrl = '';
          try {
            feishuData = await writeFeishuDocument(auth, title, previousOutput, steps, sources);
            feishuUrl = feishuUrlFromResult(feishuData);
            writeStep.status = feishuUrl ? 'done' : 'failed';
            writeStep.detail = feishuUrl ? '已创建飞书文档' : (feishuData && (feishuData.error || feishuData.msg)) || '未返回飞书链接';
          } catch (e) {
            feishuData = { error: e.message || String(e) };
            writeStep.status = 'failed';
            writeStep.detail = String(e.message || e).slice(0, 160);
          }
          const reply = feishuUrl
            ? '已同步到飞书文档：' + feishuUrl
            : '我尝试写入飞书，但没有拿到可用链接：' + ((feishuData && (feishuData.error || feishuData.msg)) || '未知错误');
          const nextMessages = baseMessages.concat([
            { role: 'user', content: input, images: incomingImages },
            { role: 'assistant', content: reply }
          ]);
          const compacted = await compactAgentConversation(nextMessages, sessionSummary);
          const draftPayload = {
            user_id: auth.id || 0,
            username: auth.username || '',
            task_type: (existingDraft && existingDraft.task_type) || taskType,
            input: (existingDraft && existingDraft.input) || input,
            tools: steps,
            sources: sources,
            output: previousOutput,
            title: existingDraft && existingDraft.title ? existingDraft.title : title,
            feishu_url: feishuUrl,
            messages: compacted.messages,
            summary: compacted.summary,
            message_count: compacted.message_count,
            last_compacted_at: compacted.last_compacted_at || (existingDraft && existingDraft.last_compacted_at) || 0
          };
          const draft = existingDraft
            ? await draftStore.update(existingDraft.id, auth, draftPayload)
            : await draftStore.save(draftPayload);
          cb({ ok: Boolean(feishuUrl), task_type: taskType, agent_mode: agentMode, reply: reply, output: previousOutput, tools: steps, sources: sources, draft: draft, feishu: feishuData, feishu_url: feishuUrl, doc_url: feishuUrl });
          return;
        }
      }
      const planStep = toolMeta('agent_plan', 'AI 规划工具', 'projectAgent', 'running');
      steps.push(planStep);
      plan = await planAgentRun(planningInput, modelHistory, auth, explicitTask, { allowSiteContext: allowSiteContext });
      plan.images = incomingImages;
      taskType = plan.task_type || taskType;
      planStep.status = 'done';
      planStep.detail = (plan.tools || []).map(function(tool) { return tool.id; }).join(', ') || '无外部工具';

      if (agentMode === 'codex' && !plan.tools.some(function(tool) { return tool.id === 'codex_deep_analysis'; })) {
        plan.tools.push({ id: 'codex_deep_analysis', args: { question: input } });
      }
      if (agentMode === 'platform') {
        plan.tools = plan.tools.filter(function(tool) { return tool.id !== 'codex_deep_analysis'; });
      }
      const context = documentContext.concat(await gatherContextFromPlan(input, plan, auth, steps, sources, agentMode, { allowSiteContext: allowSiteContext }));
      steps.push(toolMeta('model_generate', '生成草稿', 'projectAgent', 'running'));
      const output = await generateAnswer(planningInput, taskType, modelHistory, context);
      steps[steps.length - 1].status = 'done';
      steps[steps.length - 1].detail = '完成';
      const title = titleFor(taskType, input);
      let feishuData = null;
      let feishuUrl = '';
      if (wantsFeishuDocument(input) && output) {
        try {
          feishuData = await writeFeishuDocument(auth, title, output, steps, sources);
          feishuUrl = feishuUrlFromResult(feishuData);
        } catch (e) {
          feishuData = { error: e.message || String(e) };
          steps.push(toolMeta('feishu_write_error', '写入飞书文档', 'tools', 'failed', String(e.message || e).slice(0, 160)));
        }
      }
      const nextMessages = baseMessages.concat([
        { role: 'user', content: input, images: incomingImages },
        { role: 'assistant', content: output }
      ]);
      const compacted = await compactAgentConversation(nextMessages, sessionSummary);
      const draftPayload = {
        user_id: auth.id || 0,
        username: auth.username || '',
        task_type: taskType,
        input: input,
        tools: steps,
        sources: sources,
        output: output,
        title: existingDraft && existingDraft.title ? existingDraft.title : title,
        feishu_url: feishuUrl,
        messages: compacted.messages,
        summary: compacted.summary,
        message_count: compacted.message_count,
        last_compacted_at: compacted.last_compacted_at || (existingDraft && existingDraft.last_compacted_at) || 0
      };
      const draft = existingDraft
        ? await draftStore.update(existingDraft.id, auth, draftPayload)
        : await draftStore.save(draftPayload);
      cb({ ok: true, task_type: taskType, agent_mode: agentMode, plan: plan, reply: output, output: output, tools: steps, sources: sources, draft: draft, feishu: feishuData, feishu_url: feishuUrl, doc_url: feishuUrl });
    } catch (e) {
      logger.warn('agent run failed', e);
      cb({ error: e.message || String(e), task_type: taskType, agent_mode: agentMode, plan: plan, tools: steps, sources: sources });
    }
  }

  function writeSse(res, eventName, payload) {
    try {
      res.write('event: ' + eventName + '\n');
      res.write('data: ' + JSON.stringify(payload || {}) + '\n\n');
    } catch (e) {}
  }

  function isWeeklyReportOutputIntent(input, taskType) {
    const text = String(input || '');
    const compact = compactIntentText(text);
    if (taskType !== 'weekly_report') return false;
    if (!/(周报|周会)/i.test(text)) return false;
    if (/^(内容)?[一二三四五六123456]组(周报|周会)$/.test(compact)) return true;
    if (/^(周报|周会)$/.test(compact)) return true;
    return /(产出|生成|输出|出一下|出一份|做一下|做一份|写一下|整理|给我|确认生成|导出)/i.test(text)
      || /(周报|周会).*(产出|生成|输出|导出|给我|做|写|整理)/i.test(text);
  }

  function weeklyGroupFromInputOrAuth(input, auth) {
    return normalizeWeeklyGroup(detectGroupScope(input) || groupFromAuthUser(auth) || '内容二组');
  }

  function weeklyReportReply(report, job) {
    const group = report.group || (job && job.payload && job.payload.group) || '内容组';
    const range = report.range || (job && job.payload && job.payload.range) || {};
    const lines = [
      group + '周报已生成。',
      '周期：' + (range.start || '') + ' 至 ' + (range.end || ''),
      'Word文档已生成，见下方文件。'
    ];
    if (report.feishu_error) {
      lines.push('飞书写入提示：' + report.feishu_error);
    }
    return lines.join('\n');
  }

  async function saveAgentStreamDraft(body, auth, input, output, taskType, tools, sources, extra) {
    const incomingHistory = normalizeAgentMessages(body.history);
    let baseMessages = incomingHistory;
    let existingDraft = null;
    let sessionSummary = '';
    if (body.draft_id || body.draftId) {
      existingDraft = await draftStore.get(body.draft_id || body.draftId, auth);
      if (existingDraft && Array.isArray(existingDraft.messages) && existingDraft.messages.length) {
        baseMessages = normalizeAgentMessages(existingDraft.messages);
        sessionSummary = existingDraft.summary || '';
      }
    }
    const nextMessages = baseMessages.concat([
      { role: 'user', content: input },
      { role: 'assistant', content: output }
    ]);
    const compacted = await compactAgentConversation(nextMessages, sessionSummary);
    const draftPayload = {
      user_id: auth.id || 0,
      username: auth.username || '',
      task_type: taskType,
      input: input,
      tools: tools || [],
      sources: sources || [],
      output: output,
      title: existingDraft && existingDraft.title ? existingDraft.title : titleFor(taskType, input),
      feishu_url: extra && extra.feishu_url || '',
      messages: compacted.messages,
      summary: compacted.summary,
      message_count: compacted.message_count,
      last_compacted_at: compacted.last_compacted_at || (existingDraft && existingDraft.last_compacted_at) || 0
    };
    return existingDraft
      ? draftStore.update(existingDraft.id, auth, draftPayload)
      : draftStore.save(draftPayload);
  }

  async function runWeeklyReportStream(body, res, input, auth, taskType) {
    const group = weeklyGroupFromInputOrAuth(input, auth);
    const range = weekRange(-1);
    const id = jobId('weekly-stream');
    const payload = Object.assign({}, body || {}, {
      _auth: auth,
      group: group,
      range: range
    });
    const job = {
      id: id,
      status: 'running',
      stage: 'queued',
      message: '周报任务已创建',
      progress: 5,
      payload: payload,
      account_results: [],
      created_at: now(),
      updated_at: now()
    };
    job.on_update = function(current) {
      writeSse(res, 'status', publicWeeklyJob(current));
    };
    const steps = [
      toolMeta('weekly_report_pipeline', '周报生成流水线', 'projectAgent', 'running', group + ' · ' + range.start + ' 至 ' + range.end)
    ];
    const sources = [];
    weeklyReportJobs.set(id, job);
    writeSse(res, 'plan', {
      task_type: taskType,
      agent_mode: 'platform',
      plan: { task_type: taskType, group: group, time_range: range.start + ' 至 ' + range.end, tools: [{ id: 'weekly_report_pipeline', args: { group: group, range: range } }] },
      tools: steps
    });
    writeSse(res, 'delta', { delta: '我先按' + group + '、上周周期（' + range.start + ' 至 ' + range.end + '）检查流水和排期，生成过程中会实时回传进度。\n' });

    let lastStage = '';
    let lastMessage = '';
    const heartbeat = setInterval(function() {
      if (lastStage === job.stage && lastMessage === job.message) return;
      lastStage = job.stage;
      lastMessage = job.message;
      writeSse(res, 'status', publicWeeklyJob(job));
    }, 800);

    try {
      writeSse(res, 'status', publicWeeklyJob(job));
      const report = await buildWeeklyReport(job);
      clearInterval(heartbeat);
      job.status = 'done';
      job.stage = 'done';
      job.message = '周报已生成';
      job.progress = 100;
      job.report = report;
      job.updated_at = now();
      steps[0].status = 'done';
      steps[0].detail = 'Word 和飞书处理完成';
      const reply = weeklyReportReply(report, job);
      const draft = await saveAgentStreamDraft(body, auth, input, reply, taskType, steps, sources, {
        feishu_url: ''
      });
      writeSse(res, 'done', {
        ok: true,
        task_type: taskType,
        agent_mode: 'platform',
        reply: reply,
        output: reply,
        tools: steps,
        sources: sources,
        draft: draft,
        report: report,
        job: publicWeeklyJob(job),
        feishu_url: '',
        doc_url: '',
        word_url: report.word_url || ''
      });
      res.end();
    } catch (e) {
      clearInterval(heartbeat);
      job.status = 'failed';
      job.stage = 'failed';
      job.message = '周报生成失败';
      job.error = e.message || String(e);
      job.updated_at = now();
      steps[0].status = 'failed';
      steps[0].detail = job.error;
      writeSse(res, 'error', {
        error: job.error,
        task_type: taskType,
        agent_mode: 'platform',
        tools: steps,
        sources: sources,
        job: publicWeeklyJob(job)
      });
      res.end();
    }
  }

  async function runAgentStream(body, res, useExplicitTask) {
    const auth = body._auth || {};
    const input = String(body.message || body.input || body.prompt || '').trim();
    const explicitTask = useExplicitTask ? (body.task_type || body.taskType) : null;
    const requestedMode = String(body.agent_mode || body.agentMode || 'auto').toLowerCase();
    const agentMode = requestedMode === 'codex' || requestedMode === 'platform' ? requestedMode : 'auto';
    const allowSiteContext = useSiteContextEnabled(body);
    let taskType = detectTask(input, explicitTask);
    if (!input) {
      writeSse(res, 'error', { error: 'message required' });
      res.end();
      return;
    }
    if (allowSiteContext && isWeeklyReportOutputIntent(input, taskType)) {
      await runWeeklyReportStream(body, res, input, auth, taskType);
      return;
    }
    if (wantsDailyImage(input, taskType, body.history || [])) {
      await runDailyReportImageStream(body, res, input, auth);
      return;
    }
    if (wantsDailyRevision(input, taskType, body.history || [])) {
      await runDailyReportReviseStream(body, res, input, auth);
      return;
    }
    if (allowSiteContext && taskType === 'daily_report' && asksForDailyReport(input)) {
      await runDailyReportDraftStream(body, res, input, auth, taskType);
      return;
    }
    const steps = [];
    const sources = [];
    let plan = null;
    try {
      const incomingHistory = normalizeAgentMessages(body.history);
      const incomingImages = normalizeAgentImages(body.images).slice(0, 4);
      const incomingDocuments = normalizeAgentDocuments(body.documents);
      let baseMessages = incomingHistory;
      let existingDraft = null;
      let sessionSummary = '';
      if (body.draft_id || body.draftId) {
        existingDraft = await draftStore.get(body.draft_id || body.draftId, auth);
        if (existingDraft && Array.isArray(existingDraft.messages) && existingDraft.messages.length) {
          baseMessages = normalizeAgentMessages(existingDraft.messages);
          sessionSummary = existingDraft.summary || '';
        }
      }
      const modelHistory = buildAgentHistory(sessionSummary, baseMessages);
      const documentContext = await parseIncomingDocumentContext(incomingDocuments, auth, steps, sources);
      const planningInput = input
        + (incomingImages.length ? '\n\n[用户本轮附带了图片，可作为本轮视觉输入。]' : '')
        + (documentContext.length ? '\n\n[用户本轮上传文件解析摘要]\n' + formatContext(documentContext) : (incomingDocuments.length ? '\n\n[用户本轮上传了文件，但正文还没有解析成功。]' : ''));

      writeSse(res, 'status', { stage: 'planning', message: '正在规划工具' });
      const planStep = toolMeta('agent_plan', 'AI 规划工具', 'projectAgent', 'running');
      steps.push(planStep);
      plan = await planAgentRun(planningInput, modelHistory, auth, explicitTask, { allowSiteContext: allowSiteContext });
      plan.images = incomingImages;
      taskType = plan.task_type || taskType;
      planStep.status = 'done';
      planStep.detail = (plan.tools || []).map(function(tool) { return tool.id; }).join(', ') || '无外部工具';
      writeSse(res, 'plan', { task_type: taskType, agent_mode: agentMode, plan: plan, tools: steps });

      if (agentMode === 'codex' && !plan.tools.some(function(tool) { return tool.id === 'codex_deep_analysis'; })) {
        plan.tools.push({ id: 'codex_deep_analysis', args: { question: input } });
      }
      if (agentMode === 'platform') {
        plan.tools = plan.tools.filter(function(tool) { return tool.id !== 'codex_deep_analysis'; });
      }

      writeSse(res, 'status', { stage: 'context', message: '正在读取上下文' });
      const context = documentContext.concat(await gatherContextFromPlan(input, plan, auth, steps, sources, agentMode, { allowSiteContext: allowSiteContext }));
      writeSse(res, 'context', { tools: steps, sources: sources });

      steps.push(toolMeta('model_generate', '生成草稿', 'projectAgent', 'running'));
      writeSse(res, 'status', { stage: 'generating', message: '正在生成内容' });

      let output = '';
      output = await streamAnswer(planningInput, taskType, modelHistory, context, {
        onDelta: function(delta) {
          output += delta || '';
          writeSse(res, 'delta', { delta: delta || '' });
        }
      });

      steps[steps.length - 1].status = 'done';
      steps[steps.length - 1].detail = '完成';
      const title = titleFor(taskType, input);
      let feishuData = null;
      let feishuUrl = '';
      if (wantsFeishuDocument(input) && output) {
        writeSse(res, 'status', { stage: 'feishu', message: '正在写入飞书文档' });
        try {
          feishuData = await writeFeishuDocument(auth, title, output, steps, sources);
          feishuUrl = feishuUrlFromResult(feishuData);
        } catch (e) {
          feishuData = { error: e.message || String(e) };
          steps.push(toolMeta('feishu_write_error', '写入飞书文档', 'tools', 'failed', String(e.message || e).slice(0, 160)));
        }
        writeSse(res, 'context', { tools: steps, sources: sources });
      }
      const nextMessages = baseMessages.concat([
        { role: 'user', content: input, images: incomingImages },
        { role: 'assistant', content: output }
      ]);
      const compacted = await compactAgentConversation(nextMessages, sessionSummary);
      const draftPayload = {
        user_id: auth.id || 0,
        username: auth.username || '',
        task_type: taskType,
        input: input,
        tools: steps,
        sources: sources,
        output: output,
        title: existingDraft && existingDraft.title ? existingDraft.title : title,
        feishu_url: feishuUrl,
        messages: compacted.messages,
        summary: compacted.summary,
        message_count: compacted.message_count,
        last_compacted_at: compacted.last_compacted_at || (existingDraft && existingDraft.last_compacted_at) || 0
      };
      const draft = existingDraft
        ? await draftStore.update(existingDraft.id, auth, draftPayload)
        : await draftStore.save(draftPayload);

      writeSse(res, 'done', {
        ok: true,
        task_type: taskType,
        agent_mode: agentMode,
        reply: output,
        output: output,
        tools: steps,
        sources: sources,
        draft: draft,
        feishu: feishuData,
        feishu_url: feishuUrl,
        doc_url: feishuUrl
      });
      res.end();
    } catch (e) {
      logger.warn('agent stream failed', e);
      writeSse(res, 'error', {
        error: e.message || String(e),
        task_type: taskType,
        agent_mode: agentMode,
        plan: plan,
        tools: steps,
        sources: sources
      });
      res.end();
    }
  }

  function titleFor(taskType, input) {
    const names = {
      transcribe_link: '链接转写',
      read_feishu: '飞书读取',
      bf_analysis: 'BF分析',
      outline_writing: '推广大纲',
      weekly_report: '周报草稿',
      project_review: '项目复盘',
      research: '资料整理',
      free_writing: '自由写作'
    };
    const clean = input.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    return (names[taskType] || '项目助手') + (clean ? ' - ' + clean.slice(0, 28) : '');
  }

  return {
    '/api/agent/tools/preview': function(body, cb) {
      const input = String(body.message || body.input || body.prompt || '').trim();
      const auth = body._auth || {};
      const explicitTask = body.force_task ? (body.task_type || body.taskType) : null;
      const requestedMode = String(body.agent_mode || body.agentMode || 'auto').toLowerCase();
      const agentMode = requestedMode === 'codex' || requestedMode === 'platform' ? requestedMode : 'auto';
      const allowSiteContext = useSiteContextEnabled(body);
      const incomingImages = normalizeAgentImages(body.images).slice(0, 4);
      const incomingDocuments = normalizeAgentDocuments(body.documents);
      const planningInput = input
        + (incomingImages.length ? '\n\n[用户本轮附带了图片，可作为本轮视觉输入。]' : '')
        + (incomingDocuments.length ? '\n\n[用户本轮上传了文件，正式发送时可交给后端解析。]' : '');
      planAgentRun(planningInput, body.history || [], auth, explicitTask, { allowSiteContext: allowSiteContext }).then(function(plan) {
        plan.images = incomingImages;
        plan.documents = incomingDocuments.map(function(doc) {
          return { filename: doc.filename, size: doc.size, mime: doc.mime };
        });
        if (agentMode === 'codex' && !plan.tools.some(function(tool) { return tool.id === 'codex_deep_analysis'; })) {
          plan.tools.push({ id: 'codex_deep_analysis', args: { question: input } });
        }
        if (agentMode === 'platform') {
          plan.tools = plan.tools.filter(function(tool) { return tool.id !== 'codex_deep_analysis'; });
        }
        const defs = availableAgentTools(auth, { allowSiteContext: allowSiteContext });
        const tools = uniquePlannedTools(plan, input, auth, agentMode, { allowSiteContext: allowSiteContext }).map(function(item) {
          const def = defs.find(function(tool) { return tool.id === item.id; });
          return toolMeta(item.id, def ? def.label : item.id, def ? def.module : '', 'pending');
        });
        cb({ ok: true, task_type: plan.task_type, agent_mode: agentMode, plan: plan, tools: tools });
      }).catch(function(e) {
        const taskType = detectTask(input, body.task_type || body.taskType);
        cb({ ok: true, task_type: taskType, error: e.message || String(e), tools: visibleToolsFor(input, taskType, auth, { allowSiteContext: allowSiteContext }) });
      });
    },

    '/api/agent/chat': function(body, cb) {
      runAgent(body, cb, false);
    },

    '/api/agent/chat/stream': function(body, res) {
      runAgentStream(body, res, false);
    },

    '/api/agent/run': function(body, cb) {
      runAgent(body, cb, true);
    },

    '/api/agent/weekly-report/start': function(body, cb) {
      const id = jobId('weekly');
      const payload = Object.assign({}, body || {}, { _auth: body._auth || {} });
      const job = {
        id: id,
        status: 'running',
        stage: 'queued',
        message: '周报任务已创建',
        progress: 5,
        payload: payload,
        account_results: [],
        created_at: now(),
        updated_at: now()
      };
      weeklyReportJobs.set(id, job);
      buildWeeklyReport(job).then(function(report) {
        job.status = 'done';
        job.stage = 'done';
        job.message = '周报已生成';
        job.progress = 100;
        job.report = report;
        job.updated_at = now();
      }).catch(function(e) {
        job.status = 'failed';
        job.stage = 'failed';
        job.message = '周报生成失败';
        job.error = e.message || String(e);
        job.updated_at = now();
      });
      cb({ ok: true, job: publicWeeklyJob(job) });
    },

    '/api/agent/weekly-report/status': function(body, cb) {
      const id = body.id || body.job_id || body.jobId;
      const job = weeklyReportJobs.get(id);
      if (!job) {
        cb({ error: 'weekly report job not found' });
        return;
      }
      cb({ ok: true, job: publicWeeklyJob(job) });
    },

    '/api/agent/weekly-report/list': function(body, cb) {
      const auth = body._auth || {};
      weeklyStore.list(body.limit).then(function(records) {
        const visible = records.filter(function(record) { return canSeeWeeklyReport(auth, record); });
        cb({ ok: true, reports: visible.map(function(record) { return publicWeeklyRecord(record, false); }) });
      }).catch(function(e) {
        cb({ error: e.message || String(e), reports: [] });
      });
    },

    '/api/agent/weekly-report/get': function(body, cb) {
      const id = body.id || body.report_id || body.reportId;
      if (!id) { cb({ error: 'report id required' }); return; }
      weeklyStore.get(id).then(function(record) {
        if (!record || !canSeeWeeklyReport(body._auth || {}, record)) {
          cb({ error: 'weekly report not found' });
          return;
        }
        cb({ ok: true, report: publicWeeklyRecord(record, true) });
      }).catch(function(e) {
        cb({ error: e.message || String(e) });
      });
    },

    '/api/agent/daily-report/draft': function(body, cb) {
      body = body || {};
      buildDailyReportDraft(Object.assign({}, body, { _auth: body._auth || {} })).then(function(report) {
        cb({ ok: true, report: report });
      }).catch(function(e) {
        cb({ error: e.message || String(e) });
      });
    },

    '/api/agent/daily-report/image': function(body, cb) {
      body = body || {};
      generateDailyReportImage(Object.assign({}, body, { _auth: body._auth || {} })).then(function(result) {
        cb(result);
      }).catch(function(e) {
        cb({ error: e.message || String(e) });
      });
    },

    '/api/agent/daily-report/revise': function(body, cb) {
      body = body || {};
      reviseDailyReportText(Object.assign({}, body, { _auth: body._auth || {} })).then(function(report) {
        cb({ ok: true, report: report, text: report.text || '' });
      }).catch(function(e) {
        cb({ error: e.message || String(e) });
      });
    },

    '/api/agent/drafts/list': function(body, cb) {
      draftStore.list(body._auth || {}, body.limit).then(function(drafts) {
        cb({ ok: true, drafts: drafts });
      }).catch(function(e) {
        cb({ error: e.message || String(e), drafts: [] });
      });
    },

    '/api/agent/drafts/save': function(body, cb) {
      const auth = body._auth || {};
      draftStore.save({
        user_id: auth.id || 0,
        username: auth.username || '',
        task_type: body.task_type || body.taskType || 'manual',
        input: body.input || '',
        tools: body.tools || [],
        sources: body.sources || [],
        messages: body.messages || [],
        output: body.output || body.content || '',
        title: body.title || '项目助手草稿',
        feishu_url: body.feishu_url || body.feishuUrl || ''
      }).then(function(draft) {
        cb({ ok: true, draft: draft });
      }).catch(function(e) {
        cb({ error: e.message || String(e) });
      });
    },

    '/api/agent/drafts/update': function(body, cb) {
      const auth = body._auth || {};
      const id = body.id || body.draft_id || body.draftId;
      if (!id) { cb({ error: 'draft id required' }); return; }
      draftStore.update(id, auth, {
        title: body.title,
        task_type: body.task_type || body.taskType,
        input: body.input,
        output: body.output || body.content,
        feishu_url: body.feishu_url || body.feishuUrl,
        tools: body.tools,
        sources: body.sources,
        messages: body.messages
      }).then(function(draft) {
        if (!draft) cb({ error: 'draft not found' });
        else cb({ ok: true, draft: draft });
      }).catch(function(e) {
        cb({ error: e.message || String(e) });
      });
    },

    '/api/agent/drafts/delete': function(body, cb) {
      const id = body.id || body.draft_id || body.draftId;
      if (!id) { cb({ error: 'draft id required' }); return; }
      draftStore.remove(id, body._auth || {}).then(function(ok) {
        cb(ok ? { ok: true } : { error: 'draft not found' });
      }).catch(function(e) {
        cb({ error: e.message || String(e) });
      });
    },

    '/api/agent/feishu/write': async function(body, cb) {
      const content = String(body.content || body.output || '').trim();
      if (!content) { cb({ error: 'content required' }); return; }
      const route = routes['/api/to-feishu'];
      if (!route) { cb({ error: 'feishu writer route missing' }); return; }
      const data = await toPromise(route, {
        _auth: body._auth,
        title: body.title || '项目助手草稿',
        content: content,
        doc_id: body.doc_id || body.docId || '',
        tool: body.tool || 'doc'
      });
      cb(data);
    }
  };
};

module.exports._test = {
  compactIntentText: compactIntentText,
  detectGroupScope: detectGroupScope,
  asksForWorkSummary: asksForWorkSummary,
  asksForPlatformData: asksForPlatformData,
  detectTask: detectTask,
  previewIntent: previewIntent
};
