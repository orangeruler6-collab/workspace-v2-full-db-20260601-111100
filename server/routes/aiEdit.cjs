const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const searchIntent = require('../lib/searchIntent.cjs');
const downloadAdapters = require('../lib/downloadAdapters.cjs');

const OPENCLI_CMD = 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\opencli.cmd';
const WORKSPACE_NAME = 'AI剪辑工作台';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanName(value, fallback) {
  return String(value || fallback || '未命名项目')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 56) || fallback || '未命名项目';
}

function safeFileName(value, fallback) {
  const ext = path.extname(String(value || ''));
  const base = path.basename(String(value || fallback || 'file'), ext)
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9._ -]/g, '_')
    .slice(0, 64) || 'file';
  return base + (ext || '');
}

function projectId() {
  return 'edit_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch(e) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function parseDataUrlBase64(value) {
  const text = String(value || '');
  const comma = text.indexOf(',');
  return comma >= 0 ? text.slice(comma + 1) : text;
}

function getAudioMeta(filePath) {
  return new Promise(resolve => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath
    ], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', chunk => { out += chunk.toString('utf8'); });
    proc.on('error', () => resolve({ duration: 0, available: false }));
    proc.on('close', () => {
      try {
        const data = JSON.parse(out || '{}');
        resolve({ duration: parseFloat(data.format && data.format.duration || 0) || 0, available: true });
      } catch(e) {
        resolve({ duration: 0, available: false });
      }
    });
  });
}

function splitScript(script) {
  const text = String(script || '').replace(/\r/g, '\n').trim();
  if (!text) return [];
  const raw = text
    .split(/\n{2,}|(?<=[。！？!?])\s+|(?<=[。！？!?])/)
    .map(item => item.trim())
    .filter(Boolean);
  const parts = [];
  raw.forEach(part => {
    if (!parts.length || parts[parts.length - 1].length > 52 || part.length > 44) parts.push(part);
    else parts[parts.length - 1] += part;
  });
  return parts.slice(0, 36);
}

function splitScriptForStyle(script, style) {
  const base = splitScript(script);
  if (style !== 'tianji') return base;
  const parts = [];
  base.forEach(part => {
    const chunks = String(part || '')
      .split(/(?<=[，,。！？!?；;：:])|(?<=但|而|却|结果|没想到|真正|所以)/)
      .map(item => item.trim())
      .filter(Boolean);
    chunks.forEach(chunk => {
      if (!parts.length || parts[parts.length - 1].length > 42 || chunk.length > 34) parts.push(chunk);
      else parts[parts.length - 1] += chunk;
    });
  });
  return parts.slice(0, 32);
}

function seconds(value) {
  return Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
}

function buildVisualNeed(text, index, style) {
  const raw = String(text || '');
  if (style === 'tianji') {
    if (index === 0) return '天机妹式开场：直接上核心人物/名场面截图，底部强字幕压钩子；画面必须一眼看懂人物和争议点，0-2 秒内建立好奇。';
    if (/排名|票|第一|中心位|数据|名次|冠军|榜|记录|成绩/.test(raw)) return '天机妹式数据论据：优先找排名页、票数页、节目计分板、战绩截图；可叠人物抠像，底部短字幕总结论据。';
    if (/采访|说|回应|发言|解释|问|为什么/.test(raw)) return '天机妹式采访论据：优先找采访/节目原片近景，保留人物表情；用底部字幕提炼一句话，1.5-2 秒切一次。';
    if (/梗|黑|笑|玩|评论|网友|小黑子|ikun|粉丝/.test(raw)) return '天机妹式梗图/评论：优先找评论区、弹幕、表情包、网友二创截图；允许主持人抠像或贴纸点题，制造轻喜剧停顿。';
    return '天机妹式视觉论据：原始节目/采访/人物截图 + 主持人抠像/贴纸 + 底部短字幕；不要长镜头，按一个信息点一张图切。';
  }
  if (index === 0) return '开场钩子画面：主体清楚、冲击强，前 3 秒能快速建立事件和情绪。';
  if (/数据|排名|冠军|纪录|金额|播放|点赞|比例|时间|年份/.test(raw)) return '数据论据画面：优先找榜单、截图、比赛/现场资料、字幕清楚的说明性镜头。';
  if (/争议|冲突|翻车|质疑|道歉|舆论|回应|爆料/.test(raw)) return '舆论冲突画面：优先找新闻标题、评论区、当事人回应、现场反应或情绪转折镜头。';
  if (/游戏|玩家|角色|关卡|版本|联动|赛事|战队/.test(raw)) return '游戏内容画面：优先找实机画面、官方 PV、玩家反应、赛事或角色关键动作。';
  if (/人物|博主|明星|选手|公司|品牌|账号/.test(raw)) return '人物/账号画面：优先找人物近景、采访、账号主页、代表作品或关键动作。';
  return style === 'fast'
    ? '快节奏过渡画面：找信息密度高、动作明确、可承接旁白节奏的素材。'
    : '叙事补充画面：找与这段文案主题相关的背景、环境、事件资料或情绪镜头。';
}

function inferAssetType(text, visualNeed, index, style) {
  const raw = [text, visualNeed].join('\n');
  if (style === 'tianji') {
    if (index === 0) return 'hook_famous_scene';
    if (/排名|票|第一|中心位|数据|名次|榜|计分|成绩|投票/.test(raw)) return 'ranking_screenshot';
    if (/采访|说|回应|发言|解释|问|为什么|麦克风|节目/.test(raw)) return 'interview_clip';
    if (/评论|网友|弹幕|粉丝|梗|黑|小黑子|ikun|表情包|二创/.test(raw)) return 'comment_meme';
    if (/舞台|节目|青春有你|偶像练习生|综艺|原片/.test(raw)) return 'show_original';
    return 'visual_proof';
  }
  if (/排名|数据|榜|截图/.test(raw)) return 'ranking_screenshot';
  if (/采访|回应|发言/.test(raw)) return 'interview_clip';
  if (/评论|网友|弹幕|梗/.test(raw)) return 'comment_meme';
  if (/游戏|实机|比赛|战队/.test(raw)) return 'gameplay_clip';
  return 'broll';
}

function assetTypeLabel(type) {
  return {
    hook_famous_scene: '开场名场面',
    ranking_screenshot: '排名/数据截图',
    interview_clip: '采访/发言片段',
    comment_meme: '评论/梗图',
    show_original: '综艺/原片',
    visual_proof: '视觉论据',
    gameplay_clip: '游戏/比赛画面',
    broll: '补充画面'
  }[type] || '补充画面';
}

function buildAssetQueries(part, intent, assetType, style) {
  const entities = intent && intent.entities || [];
  const base = intent && intent.queries || [];
  const head = entities.slice(0, 3).join(' ') || String(part || '').slice(0, 24);
  const suffixMap = {
    hook_famous_scene: ['名场面', '经典画面', '高能'],
    ranking_screenshot: ['排名', '票数', '榜单', '中心位'],
    interview_clip: ['采访', '发言', '回应', '节目'],
    comment_meme: ['评论', '弹幕', '表情包', '梗'],
    show_original: ['原片', '舞台', '节目', 'cut'],
    visual_proof: ['名场面', '资料', '片段'],
    gameplay_clip: ['实机', '比赛', '高光'],
    broll: ['资料', '画面']
  };
  const suffixes = suffixMap[assetType] || suffixMap.broll;
  const queries = []
    .concat(base)
    .concat(suffixes.map(suffix => [head, suffix].filter(Boolean).join(' ')));
  if (style === 'tianji' && entities.length) {
    queries.push(entities[0] + ' B站 cut');
  }
  return Array.from(new Set(queries.map(item => String(item || '').trim()).filter(Boolean))).slice(0, 6);
}

function collectCapability(assetType) {
  const imageTypes = ['ranking_screenshot', 'comment_meme', 'hook_famous_scene'];
  const auto = ['本地素材库'];
  if (!imageTypes.includes(assetType)) auto.push('B站关键词候选');
  else auto.push('B站关键词候选作为补充');
  return {
    auto_collect: auto,
    manual_collect: [
      '抖音关键词视频搜索暂不稳定：请粘贴单条抖音链接、账号主页/sec_uid，或直接拖入素材。',
      imageTypes.includes(assetType) ? '截图/榜单/评论梗图建议人工确认后拖入当前镜头。' : '关键原片建议人工确认画面语义后再选入。'
    ],
    platform_scope: '自动匹配范围：本地素材库 + B站关键词搜索；抖音仅支持链接/账号级采集与人工导入。'
  };
}

function buildCollectPlan(part, visualNeed, intent, index, style) {
  const assetType = inferAssetType(part, visualNeed, index, style);
  const label = assetTypeLabel(assetType);
  const queries = buildAssetQueries(part, intent, assetType, style);
  const capability = collectCapability(assetType);
  const sourceMap = {
    hook_famous_scene: ['抖音/B站热剪', '原始节目片段', '素材库名场面'],
    ranking_screenshot: ['节目排名截图', '榜单/票数截图', '搜索图片素材'],
    interview_clip: ['采访原片', '节目cut', '人物发言片段'],
    comment_meme: ['评论区截图', '弹幕截图', '表情包/二创截图'],
    show_original: ['综艺原片', '舞台cut', '节目片段'],
    visual_proof: ['原始视频资料', '人物近景', '事件截图'],
    gameplay_clip: ['实机录像', '赛事切片', '官方PV'],
    broll: ['素材库', 'B站资料', '公开素材']
  };
  const collectFrom = sourceMap[assetType] || sourceMap.broll;
  const matchTips = style === 'tianji'
    ? '优先选能在1.5-2秒内读懂的信息画面；字幕区不要被关键主体挡住；同一素材连续使用时要换角度/换时间点。'
    : '优先选主体清楚、和旁白信息直接对应的素材。';
  return {
    asset_type: assetType,
    asset_label: label,
    collect_from: collectFrom,
    search_queries: queries,
    match_tips: matchTips,
    auto_collect: capability.auto_collect,
    manual_collect: capability.manual_collect,
    platform_scope: capability.platform_scope
  };
}

function sceneIntent(text) {
  const intent = searchIntent.extractSearchIntent(String(text || ''), { queryLimit: 4 });
  const query = intent.query || (intent.entities || []).join(' ') || String(text || '').slice(0, 24);
  return {
    query,
    queries: Array.from(new Set([query].concat(intent.queries || []).filter(Boolean))).slice(0, 4),
    entities: intent.entities || [],
    exclude_terms: intent.exclude_terms || [],
    intent_terms: intent.intent_terms || []
  };
}

function planScenes(script, duration, options) {
  const style = options && options.edit_style;
  const parts = splitScriptForStyle(script, style);
  if (!parts.length) return [];
  const totalDuration = Number(duration) > 0
    ? Number(duration)
    : Math.max(parts.length * 4, Math.min(180, String(script || '').length / 4.5));
  const weights = parts.map(part => Math.max(8, part.length));
  const weightTotal = weights.reduce((sum, item) => sum + item, 0) || parts.length;
  const minLen = style === 'tianji' ? 1.25 : 1.6;
  const maxLen = style === 'tianji' ? 2.6 : Infinity;
  let cursor = 0;
  return parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    const weightedLen = Math.max(minLen, totalDuration * weights[index] / weightTotal);
    const len = isLast ? totalDuration - cursor : Math.min(maxLen, weightedLen);
    const start = seconds(cursor);
    const end = seconds(Math.min(totalDuration, cursor + len));
    cursor = end;
    const intent = sceneIntent(part);
    const visualNeed = buildVisualNeed(part, index, options && options.edit_style);
    const collectPlan = buildCollectPlan(part, visualNeed, intent, index, style);
    return {
      id: 'scene-' + (index + 1),
      index: index + 1,
      start,
      end,
      duration: seconds(end - start),
      script_text: part,
      script: part,
      visual_need: visualNeed,
      asset_type: collectPlan.asset_type,
      asset_label: collectPlan.asset_label,
      collect_from: collectPlan.collect_from,
      match_tips: collectPlan.match_tips,
      auto_collect: collectPlan.auto_collect,
      manual_collect: collectPlan.manual_collect,
      platform_scope: collectPlan.platform_scope,
      search_query: collectPlan.search_queries[0] || intent.query,
      search_queries: collectPlan.search_queries,
      entities: intent.entities,
      exclude_terms: intent.exclude_terms,
      intent_terms: intent.intent_terms,
      selected_material_id: '',
      selected_candidate: null,
      selected_candidates: [],
      status: 'need_candidates',
      candidates: []
    };
  });
}

function candidateIdentity(candidate) {
  if (!candidate) return '';
  return String(candidate.material_id || candidate.id || candidate.url || candidate.path || candidate.title || '');
}

function uniqueCandidates(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach(candidate => {
    const key = candidateIdentity(candidate);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  });
  return out;
}

function sceneMaterials(scene) {
  const multi = uniqueCandidates(scene && scene.selected_candidates);
  if (multi.length) return multi;
  return scene && scene.selected_candidate ? [scene.selected_candidate] : [];
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSrtTime(value) {
  const totalMs = Math.max(0, Math.round((Number(value) || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hour = Math.floor(totalMin / 60);
  return String(hour).padStart(2, '0') + ':' +
    String(min).padStart(2, '0') + ':' +
    String(sec).padStart(2, '0') + ',' +
    String(ms).padStart(3, '0');
}

function cleanSubtitleText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSubtitleText(text, style) {
  const clean = cleanSubtitleText(text);
  if (!clean) return [];
  if (style !== 'tianji') return [clean];
  return clean
    .split(/(?<=[，,。！？!?；;])|\n+/)
    .map(item => item.trim())
    .filter(Boolean)
    .reduce((out, item) => {
      if (!out.length || out[out.length - 1].length > 16 || item.length > 18) out.push(item);
      else out[out.length - 1] += item;
      return out;
    }, []);
}

function buildSrt(project) {
  const cues = [];
  (project.scenes || []).forEach(scene => {
    const texts = splitSubtitleText(scene.script_text || scene.script, project.edit_style);
    if (!texts.length) return;
    const start = Number(scene.start) || 0;
    const end = Number(scene.end) > start ? Number(scene.end) : start + Math.max(1, Number(scene.duration) || 3);
    const span = Math.max(0.6, (end - start) / texts.length);
    texts.forEach((text, textIndex) => {
      const cueStart = start + span * textIndex;
      const cueEnd = textIndex === texts.length - 1 ? end : Math.min(end, cueStart + span);
      cues.push({ start: cueStart, end: cueEnd, text });
    });
  });
  return cues.map((cue, index) => {
    return [
      String(index + 1),
      formatSrtTime(cue.start) + ' --> ' + formatSrtTime(cue.end),
      cue.text,
      ''
    ].join('\n');
  }).join('\n');
}

function publicPathFromStorage(storagePath) {
  const clean = String(storagePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.startsWith('remote-file:')) return '';
  return clean ? '/uploads/' + clean : '';
}

function materialPublicPath(row) {
  const fromStorage = publicPathFromStorage(row && row.storage_path);
  if (fromStorage) return fromStorage;
  if (!row || !row.filename) return '';
  return '/uploads/' + (row.type || 'video') + '/' + encodeURIComponent(row.filename);
}

function normalizeTerms(scene) {
  const assetUseMap = {
    ranking_screenshot: ['排名/数据截图'],
    comment_meme: ['评论/梗图'],
    hook_famous_scene: ['开场名场面'],
    interview_clip: ['采访/发言片段'],
    show_original: ['综艺/原片'],
    gameplay_clip: ['游戏/比赛画面']
  };
  return Array.from(new Set([]
    .concat(scene && scene.search_query || [])
    .concat(scene && scene.search_queries || [])
    .concat(scene && scene.asset_label || [])
    .concat(scene && assetUseMap[scene.asset_type] || [])
    .concat(scene && scene.collect_from || [])
    .concat(scene && scene.entities || [])
    .concat(scene && scene.intent_terms || [])
    .join(' ')
    .split(/[\s,，、|/]+/)
    .map(item => item.trim())
    .filter(item => item && item.length >= 2)
  )).slice(0, 10);
}

function materialTypesForScene(scene) {
  const assetType = scene && scene.asset_type || '';
  const imageFirst = ['ranking_screenshot', 'comment_meme', 'hook_famous_scene'];
  const videoFirst = ['interview_clip', 'show_original', 'gameplay_clip'];
  if (imageFirst.includes(assetType)) return ['image', 'video'];
  if (videoFirst.includes(assetType)) return ['video', 'image'];
  return ['video', 'image'];
}

function queryMaterials(db, scene, limit) {
  return new Promise(resolve => {
    const terms = normalizeTerms(scene);
    const materialTypes = materialTypesForScene(scene);
    const placeholders = materialTypes.map(() => '?').join(',');
    const where = ['type IN (' + placeholders + ')', '(status IS NULL OR status != ?)'];
    const args = materialTypes.concat(['deleted']);
    if (terms.length) {
      const likeParts = [];
      terms.slice(0, 6).forEach(term => {
        likeParts.push('(original LIKE ? OR filename LIKE ? OR category LIKE ? OR tags LIKE ? OR folder LIKE ?)');
        const like = '%' + term + '%';
        args.push(like, like, like, like, like);
      });
      where.push('(' + likeParts.join(' OR ') + ')');
    }
    const orderCase = 'CASE type ' + materialTypes.map((type, index) => 'WHEN ? THEN ' + index).join(' ') + ' ELSE 99 END';
    const sql = 'SELECT * FROM materials WHERE ' + where.join(' AND ') + ' ORDER BY ' + orderCase + ', created_at DESC LIMIT ?';
    const queryArgs = args.concat(materialTypes, [Math.max(1, Math.min(20, Number(limit) || 6))]);
    db.all(sql, queryArgs, function(err, rows) {
      if (err) { resolve([]); return; }
      const lowerTerms = terms.map(term => term.toLowerCase());
      resolve((rows || []).map(row => {
        const haystack = [row.original, row.filename, row.category, row.tags, row.folder].join(' ').toLowerCase();
        const hit = lowerTerms.filter(term => haystack.includes(term));
        return {
          id: 'material-' + row.id,
          material_id: row.id,
          source: 'material-library',
          platform: 'material',
          platform_label: row.type === 'image' ? '素材库图片' : '素材库视频',
          title: row.original || row.filename || ('素材 #' + row.id),
          url: materialPublicPath(row),
          path: materialPublicPath(row),
          thumb: row.thumb || '',
          duration: row.duration || 0,
          type: row.type || 'video',
          storage_path: row.storage_path || '',
          folder: row.folder || '/',
          status: 'ready',
          match_reason: hit.length ? ('命中素材库关键词：' + hit.slice(0, 4).join(' / ')) : '素材库中较新的可用素材。',
          next_step: '可直接选入时间线'
        };
      }));
    });
  });
}

function runCommand(command, args, options) {
  return new Promise(resolve => {
    const useCmd = process.platform === 'win32' && /\.cmd$/i.test(command);
    const spawnCommand = useCmd ? (process.env.ComSpec || 'cmd.exe') : command;
    const spawnArgs = useCmd ? ['/d', '/s', '/c', command].concat(args || []) : (args || []);
    const proc = spawn(spawnCommand, spawnArgs, {
      cwd: options && options.cwd || process.cwd(),
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch(e) {}
      resolve({ ok: false, stdout, stderr: stderr + '\ntimeout' });
    }, options && options.timeout || 30000);
    proc.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: err.message });
    });
    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function runCommandLong(command, args, options) {
  return new Promise(resolve => {
    let proc;
    try {
      proc = spawn(command, args || [], {
        cwd: options && options.cwd || process.cwd(),
        windowsHide: true
      });
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: '', stderr: err.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill(); } catch(e) {}
      resolve({ ok: false, code: -1, stdout, stderr: stderr + '\ntimeout' });
    }, options && options.timeout || 30 * 60 * 1000);
    proc.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    proc.on('error', err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: stderr + '\n' + err.message });
    });
    proc.on('close', code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function ffmpegTargetSize(ratio) {
  if (ratio === '16:9') return { width: 1280, height: 720 };
  if (ratio === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

function quoteConcatPath(filePath) {
  return "file '" + String(filePath || '').replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
}

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch(e) {}
  }
  const firstArray = raw.indexOf('[');
  const lastArray = raw.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    try { return JSON.parse(raw.slice(firstArray, lastArray + 1)); } catch(e) {}
  }
  const firstObj = raw.indexOf('{');
  const lastObj = raw.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) {
    try { return JSON.parse(raw.slice(firstObj, lastObj + 1)); } catch(e) {}
  }
  return null;
}

function normalizeAiScene(item, index, fallbackPart, totalDuration, options) {
  item = item || {};
  const style = options && options.edit_style;
  const part = String(item.script_text || item.script || fallbackPart || '').trim();
  const intent = sceneIntent([
    part,
    item.visual_need || '',
    item.search_query || '',
    Array.isArray(item.entities) ? item.entities.join(' ') : ''
  ].join('\n'));
  const startRaw = Number(item.start);
  const endRaw = Number(item.end);
  const start = Number.isFinite(startRaw) && startRaw >= 0 ? seconds(startRaw) : 0;
  const end = Number.isFinite(endRaw) && endRaw > start ? seconds(endRaw) : 0;
  const query = String(item.search_query || intent.query || '').trim();
  const visualNeed = String(item.visual_need || buildVisualNeed(part, index, style)).trim();
  const collectPlan = buildCollectPlan(part, visualNeed, intent, index, style);
  const queries = Array.from(new Set([query]
    .concat(item.search_queries || [])
    .concat(collectPlan.search_queries || [])
    .filter(Boolean))).slice(0, 4);
  return {
    id: 'scene-' + (index + 1),
    index: index + 1,
    start,
    end,
    duration: end > start ? seconds(end - start) : 0,
    script_text: part,
    script: part,
    visual_need: visualNeed,
    asset_type: item.asset_type || collectPlan.asset_type,
    asset_label: item.asset_label || collectPlan.asset_label,
    collect_from: Array.isArray(item.collect_from) && item.collect_from.length ? item.collect_from : collectPlan.collect_from,
    match_tips: item.match_tips || collectPlan.match_tips,
    auto_collect: Array.isArray(item.auto_collect) && item.auto_collect.length ? item.auto_collect : collectPlan.auto_collect,
    manual_collect: Array.isArray(item.manual_collect) && item.manual_collect.length ? item.manual_collect : collectPlan.manual_collect,
    platform_scope: item.platform_scope || collectPlan.platform_scope,
    search_query: queries[0] || query,
    search_queries: queries,
    entities: Array.isArray(item.entities) && item.entities.length ? item.entities : intent.entities,
    exclude_terms: Array.isArray(item.exclude_terms) ? item.exclude_terms : intent.exclude_terms,
    intent_terms: Array.isArray(item.intent_terms) ? item.intent_terms : intent.intent_terms,
    reason: String(item.reason || '').trim(),
    selected_material_id: '',
    selected_candidate: null,
    selected_candidates: [],
    status: 'need_candidates',
    candidates: []
  };
}

function alignSceneTimes(scenes, script, duration, options) {
  const fallback = planScenes(script, duration, options);
  const list = (scenes || []).slice(0, 20).map((scene, index) => {
    const fallbackScene = fallback[index] || {};
    return normalizeAiScene(scene, index, fallbackScene.script_text || fallbackScene.script || '', duration, options);
  }).filter(scene => scene.script_text);
  if (!list.length) return [];
  const minUsefulCount = Math.min(fallback.length, Math.max(6, Math.ceil(fallback.length * 0.6)));
  if (fallback.length >= 8 && list.length < minUsefulCount) {
    return fallback;
  }

  const totalDuration = Number(duration) > 0
    ? Number(duration)
    : Math.max(list.length * 4, Math.min(180, String(script || '').length / 4.5));
  const hasUsableTimes = list.every(scene => scene.end > scene.start) && list[list.length - 1].end <= totalDuration + 2;
  if (hasUsableTimes) {
    return list.map((scene, index) => Object.assign(scene, {
      index: index + 1,
      duration: seconds(scene.end - scene.start)
    }));
  }

  const style = options && options.edit_style;
  const weights = list.map(scene => Math.max(8, String(scene.script_text || '').length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || list.length;
  const minLen = style === 'tianji' ? 1.25 : 1.6;
  const maxLen = style === 'tianji' ? 2.6 : Infinity;
  let cursor = 0;
  return list.map((scene, index) => {
    const weightedLen = Math.max(minLen, totalDuration * weights[index] / totalWeight);
    const len = index === list.length - 1 ? totalDuration - cursor : Math.min(maxLen, weightedLen);
    const start = seconds(cursor);
    const end = seconds(Math.min(totalDuration, cursor + len));
    cursor = end;
    return Object.assign(scene, {
      id: 'scene-' + (index + 1),
      index: index + 1,
      start,
      end,
      duration: seconds(end - start)
    });
  });
}

function buildTimelinePrompt(script, duration, options) {
  const ratio = options && options.target_ratio || '9:16';
  const style = options && options.edit_style || 'story';
  const localParts = splitScriptForStyle(script, style).slice(0, style === 'tianji' ? 28 : 24);
  const parts = localParts.join('\n---\n');
  const system = [
    '你是短视频 AI 剪辑策划，负责把中文口播文案拆成可执行的粗剪分镜时间线。',
    '请输出严格 JSON，不要解释，不要 Markdown。',
    '每个分镜必须包含：script_text、visual_need、search_query、search_queries、entities、intent_terms、reason。',
    '分镜要细：一个镜头只承载一个信息点或一个情绪转折。参考分段有 ' + localParts.length + ' 段，请尽量接近这个数量；除非文案极短，不要只拆成 4 段。',
    'search_query 要用于素材库/B站搜索，必须提取真实主体、事件、人名、游戏名、品牌名，不要直接复制句首，不要把比喻词当搜索主体。',
    'visual_need 要写剪辑师能执行的画面需求。',
    style === 'tianji'
      ? '当前风格是“天机妹式热点故事”：40秒左右高密度热点叙事，平均1.5-2.2秒一个视觉论据；画面优先使用综艺/采访/排名截图/评论梗图/人物抠像，底部短字幕持续给信息点；不要长段落、不要空泛背景图。'
      : ''
  ].join('\n');
  const user = [
    '目标比例：' + ratio,
    '剪辑风格：' + style,
    '配音时长秒数：' + (Number(duration) > 0 ? Number(duration).toFixed(2) : '未知，请按文案长度估算'),
    '文案：',
    String(script || '').slice(0, 9000),
    '',
    '本地初步分段参考：',
    parts,
    '',
    '返回格式：{"scenes":[{"script_text":"该段文案","start":0,"end":4.2,"visual_need":"画面需求","search_query":"搜索关键词","search_queries":["关键词1","关键词2"],"entities":["主体"],"intent_terms":["画面类型"],"reason":"为什么这样拆"}]}'
  ].join('\n');
  return { system, user };
}

function requestSiliconFlowText(apiKey, system, user, requestOptions) {
  return new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('SILICONFLOW_API_KEY is not configured'));
      return;
    }
    const payload = JSON.stringify({
      model: requestOptions && requestOptions.model || process.env.SILICONFLOW_TEXT_MODEL || 'deepseek-ai/DeepSeek-V3',
      messages: [
        { role: 'system', content: system || '' },
        { role: 'user', content: user || '' }
      ],
      max_tokens: requestOptions && (requestOptions.maxTokens || requestOptions.maxOutputTokens) || 2800,
      temperature: requestOptions && requestOptions.temperature === undefined ? 0.25 : requestOptions.temperature
    });
    const req = https.request({
      hostname: 'api.siliconflow.cn',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Bearer ' + apiKey
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk.toString('utf8'); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('SiliconFlow HTTP ' + res.statusCode + ': ' + data.substring(0, 200)));
          return;
        }
        try {
          const json = JSON.parse(data);
          const message = json.choices && json.choices[0] && json.choices[0].message;
          resolve(message ? String(message.content || '').trim() : '');
        } catch(e) {
          reject(new Error('SiliconFlow JSON parse error: ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(requestOptions && requestOptions.timeoutMs || 120000, () => {
      req.destroy(new Error('SiliconFlow request timeout'));
    });
    req.write(payload);
    req.end();
  });
}

async function planScenesWithAi(script, duration, options) {
  const prompts = buildTimelinePrompt(script, duration, options);
  const errors = [];
  const sfKey = options && options.siliconflowApiKey || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '';
  if (sfKey) {
    try {
      const raw = await requestSiliconFlowText(sfKey, prompts.system, prompts.user, {
        model: options && options.model,
        temperature: 0.2,
        maxTokens: 3200,
        timeoutMs: 120000
      });
      const parsed = parseJsonLoose(raw);
      const scenes = alignSceneTimes(parsed && parsed.scenes, script, duration, options);
      if (scenes.length) return { scenes, planner: 'siliconflow', warning: '' };
      errors.push('SiliconFlow returned no usable scenes');
    } catch(e) {
      errors.push(e.message || 'SiliconFlow failed');
    }
  } else {
    errors.push('SILICONFLOW_API_KEY is not configured');
  }

  if (options && options.callModelText) {
    try {
      const raw = await options.callModelText(prompts.system, prompts.user, {
        model: process.env.AI_EDIT_MODEL || process.env.OPENAI_STYLE_MODEL || 'gpt-5.5',
        temperature: 0.2,
        maxTokens: 3200,
        timeoutMs: 120000
      });
      const parsed = parseJsonLoose(raw);
      const scenes = alignSceneTimes(parsed && parsed.scenes, script, duration, options);
      if (scenes.length) return { scenes, planner: 'model-gateway', warning: errors.join('；') };
      errors.push('model gateway returned no usable scenes');
    } catch(e) {
      errors.push(e.message || 'model gateway failed');
    }
  }

  return {
    scenes: planScenes(script, duration, options),
    planner: duration ? 'local-voiceover-duration' : 'local-script-length',
    warning: errors.filter(Boolean).join('；')
  };
}

async function searchOpenCli(query, limit) {
  if (!fs.existsSync(OPENCLI_CMD)) return { ok: false, error: 'opencli.cmd not found' };
  const result = await runCommand(OPENCLI_CMD, ['bilibili', 'search', query, '--limit', String(limit), '-f', 'json'], { timeout: 45000 });
  if (!result.ok) return { ok: false, error: result.stderr || 'OpenCLI search failed' };
  const parsed = parseJsonLoose(result.stdout);
  if (!Array.isArray(parsed)) return { ok: false, error: 'OpenCLI output is not JSON list' };
  return { ok: true, items: parsed };
}

function requestJson(url, timeout) {
  return new Promise(resolve => {
    const req = https.get(url, {
      timeout: timeout || 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 UsagiWorkspace/1.0',
        'Referer': 'https://www.bilibili.com/'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk.toString('utf8'); });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: JSON.parse(data), status: res.statusCode }); }
        catch(e) { resolve({ ok: false, error: e.message, status: res.statusCode }); }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', err => resolve({ ok: false, error: err.message }));
  });
}

async function searchBilibili(query, limit) {
  const opencli = await searchOpenCli(query, limit);
  if (opencli.ok && opencli.items.length) return { source: 'opencli:bilibili', items: opencli.items, warning: '' };
  const url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + encodeURIComponent(query) + '&page=1';
  const res = await requestJson(url, 12000);
  if (!res.ok || !res.data || !res.data.data) return { source: 'bilibili', items: [], warning: opencli.error || res.error || 'B站候选搜索不可用' };
  const list = Array.isArray(res.data.data.result) ? res.data.data.result : [];
  return {
    source: 'bilibili:public-api',
    warning: opencli.error ? 'OpenCLI 未返回结果，已用 B站公开搜索兜底。' : '',
    items: list.slice(0, limit).map((item, index) => ({
      rank: index + 1,
      title: String(item.title || '').replace(/<[^>]+>/g, ''),
      author: item.author || '',
      url: item.arcurl || (item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : ''),
      bvid: item.bvid || '',
      duration: item.duration || '',
      score: item.play || item.video_review || 0
    }))
  };
}

function mapBiliCandidate(item, index, sceneId, query, visualNeed, scene) {
  const label = scene && (scene.asset_label || assetTypeLabel(scene.asset_type));
  const tips = scene && scene.match_tips;
  return {
    id: 'bilibili-' + (sceneId || 'scene') + '-' + (item.bvid || index + 1),
    source: 'bilibili',
    platform: 'bilibili',
    platform_label: 'B站候选',
    title: item.title || ('B站候选 ' + (index + 1)),
    author: item.author || '',
    url: item.url || (item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : ''),
    bvid: item.bvid || '',
    duration: item.duration || '',
    score: item.score || 0,
    status: 'candidate',
    match_reason: [
      label ? '素材类型：' + label : '',
      '搜索词：' + (query || '-'),
      '画面需求：' + (visualNeed || '-'),
      tips ? '匹配提示：' + tips : ''
    ].filter(Boolean).join('；'),
    next_step: '确认后可沿用智能采编下载入库'
  };
}

function mediaFilePath(root, candidate) {
  if (!candidate) return '';
  if (candidate.storage_path) return path.join(root, 'public', 'uploads', String(candidate.storage_path).replace(/^\/+/, ''));
  const publicPath = candidate.path || candidate.url || '';
  if (String(publicPath).startsWith('/uploads/')) {
    try {
      return path.join(root, 'public', decodeURIComponent(String(publicPath).replace(/^\/+/, '')));
    } catch(e) {
      return path.join(root, 'public', String(publicPath).replace(/^\/+/, ''));
    }
  }
  return publicPath;
}

function requestToFile(url, headers, outFile, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const req = transport.request({
      method: 'GET',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: target.pathname + target.search,
      headers: headers || {}
    }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      const stream = fs.createWriteStream(outFile);
      res.pipe(stream);
      stream.on('finish', () => stream.close(() => resolve(outFile)));
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 180000, () => req.destroy(new Error('download timeout')));
    req.end();
  });
}

async function resolveRemoteFile(root, candidate, renderDir) {
  const storagePath = String(candidate.storage_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!storagePath.startsWith('remote-file:')) return null;
  const targetPath = storagePath.slice('remote-file:'.length);
  const token = process.env.INTERNAL_FILE_TOKEN || process.env.CONTENT_FILE_TOKEN || '';
  if (!token) return { ok: false, error: '远程素材缺少 INTERNAL_FILE_TOKEN，无法下载裁切' };
  const servers = String(process.env.INTERNAL_FILE_SERVERS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const base = (servers[0] || 'https://open-local-file1.changwankeji.com').replace(/\/+$/, '');
  const ext = path.extname(targetPath) || path.extname(candidate.title || '') || '.mp4';
  const dir = path.join(renderDir, 'remote');
  ensureDir(dir);
  const outFile = path.join(dir, 'remote_' + (candidate.material_id || candidate.id || Date.now()) + ext);
  if (fs.existsSync(outFile)) return { ok: true, file: outFile, source: 'remote-file-cache' };
  try {
    await requestToFile(base + '/api/download.php?file_path=' + encodeURIComponent(targetPath), {
      Authorization: 'Bearer ' + token
    }, outFile, 10 * 60 * 1000);
    return { ok: true, file: outFile, source: 'remote-file' };
  } catch(e) {
    return { ok: false, error: '远程素材下载失败：' + e.message };
  }
}

function isImageFile(filePath) {
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].includes(path.extname(String(filePath || '')).toLowerCase());
}

function buildTimeline(project) {
  const scenes = project.scenes || [];
  return {
    project_id: project.id,
    fps: 25,
    ratio: project.target_ratio || '9:16',
    collect_policy: {
      auto: ['本地素材库', 'B站关键词候选'],
      manual: ['抖音链接/账号主页/sec_uid', '截图/梗图/排名页拖入', '版权或语义关键画面人工确认'],
      note: '当前不做抖音关键词视频自动搜索，避免返回空结果或误匹配。'
    },
    audio: {
      src: project.voiceover_path || '',
      url: project.voiceover_url || '',
      duration: project.duration || 0
    },
    clips: scenes.map(scene => ({
      scene_id: scene.id,
      index: scene.index,
      start: scene.start,
      end: scene.end,
      duration: scene.duration,
      script_text: scene.script_text || scene.script || '',
      visual_need: scene.visual_need || '',
      asset_type: scene.asset_type || '',
      asset_label: scene.asset_label || '',
      collect_from: scene.collect_from || [],
      match_tips: scene.match_tips || '',
      auto_collect: scene.auto_collect || [],
      manual_collect: scene.manual_collect || [],
      platform_scope: scene.platform_scope || '',
      material: sceneMaterials(scene)[0] || null,
      materials: sceneMaterials(scene)
    })),
    tracks: [
      { id: 'v1', type: 'video', clips: scenes.map(scene => scene.id) },
      { id: 'a1', type: 'audio', src: project.voiceover_path || '' }
    ],
    updated_at: nowIso()
  };
}

function buildPrXml(project, timeline, root) {
  const fps = 25;
  const name = escapeXml(project.name || 'AI剪辑项目');
  const durationFrames = Math.max(1, Math.round((project.duration || Math.max(...(project.scenes || []).map(s => s.end || 0), 0) || 1) * fps));
  const videoClips = (timeline.clips || []).map((clip, index) => {
    const material = clip.material || {};
    const clipName = escapeXml(material.title || ('Scene ' + clip.index));
    const filePath = escapeXml(mediaFilePath(root, material));
    const start = Math.round((clip.start || 0) * fps);
    const end = Math.round((clip.end || 0) * fps);
    const dur = Math.max(1, end - start);
    return [
      '          <clipitem id="video-' + (index + 1) + '">',
      '            <name>' + clipName + '</name>',
      '            <enabled>TRUE</enabled>',
      '            <start>' + start + '</start>',
      '            <end>' + end + '</end>',
      '            <in>0</in>',
      '            <out>' + dur + '</out>',
      '            <file id="file-video-' + (index + 1) + '">',
      '              <name>' + clipName + '</name>',
      '              <pathurl>' + filePath + '</pathurl>',
      '            </file>',
      '            <comments>' + escapeXml(clip.script_text || '') + '</comments>',
      '          </clipitem>'
    ].join('\n');
  }).join('\n');
  const audioPath = escapeXml(project.voiceover_path || '');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmeml version="4">',
    '  <sequence id="sequence-1">',
    '    <name>' + name + '</name>',
    '    <duration>' + durationFrames + '</duration>',
    '    <rate><timebase>' + fps + '</timebase><ntsc>FALSE</ntsc></rate>',
    '    <media>',
    '      <video><track>',
    videoClips || '          <!-- No selected video clips yet -->',
    '      </track></video>',
    '      <audio><track>',
    '          <clipitem id="audio-1">',
    '            <name>voiceover</name>',
    '            <enabled>TRUE</enabled>',
    '            <start>0</start>',
    '            <end>' + durationFrames + '</end>',
    '            <in>0</in>',
    '            <out>' + durationFrames + '</out>',
    '            <file id="file-audio-1">',
    '              <name>voiceover</name>',
    '              <pathurl>' + audioPath + '</pathurl>',
    '            </file>',
    '          </clipitem>',
    '      </track></audio>',
    '    </media>',
    '  </sequence>',
    '</xmeml>'
  ].join('\n');
}

async function resolveSceneMedia(root, project, scene, renderDir) {
  const candidate = arguments.length >= 5 ? arguments[4] : scene && scene.selected_candidate || null;
  if (!candidate) return { ok: false, error: '镜头未选择素材' };
  const remote = await resolveRemoteFile(root, candidate, renderDir);
  if (remote) return remote;
  const existing = mediaFilePath(root, candidate);
  if (existing && fs.existsSync(existing)) return { ok: true, file: existing, source: 'local' };
  if (candidate.platform !== 'bilibili' && candidate.source !== 'bilibili') {
    return { ok: false, error: '素材不是本地文件，暂不能自动裁切：' + (candidate.title || '') };
  }
  const bvid = candidate.bvid || String(candidate.url || '').match(/BV[0-9A-Za-z]+/)?.[0] || '';
  if (!bvid) return { ok: false, error: 'B站候选缺少 BV 号，无法自动下载' };
  const outputDir = path.join(renderDir, 'downloads');
  ensureDir(outputDir);
  const result = await downloadAdapters.downloadBilibili({
    root,
    bvid,
    url: candidate.url,
    outputDir,
    quality: '720P',
    timeout: 15 * 60 * 1000
  });
  const file = result.files && result.files[0];
  if (!result.ok || !file || !fs.existsSync(file)) {
    return {
      ok: false,
      error: (result.error || 'B站素材下载失败').slice(0, 1200),
      attempts: result.attempts || []
    };
  }
  candidate.storage_path = path.relative(path.join(root, 'public', 'uploads'), file).replace(/\\/g, '/');
  candidate.path = publicPathFromStorage(candidate.storage_path);
  candidate.status = 'ready';
  return { ok: true, file, source: 'bilibili-download', candidate };
}

async function makeSceneClip(root, project, scene, sourceFile, outFile, sourceOffset) {
  const size = ffmpegTargetSize(project.target_ratio || '9:16');
  const duration = Math.max(0.6, Number(scene.duration) || Math.max(0.6, Number(scene.end) - Number(scene.start)) || 3);
  const vf = 'scale=' + size.width + ':' + size.height + ':force_original_aspect_ratio=increase,crop=' + size.width + ':' + size.height + ',setsar=1';
  const args = isImageFile(sourceFile)
    ? [
      '-y',
      '-loop', '1',
      '-i', sourceFile,
      '-t', String(duration),
      '-an',
      '-vf', vf,
      '-r', '25',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      outFile
    ]
    : [
      '-y',
      '-stream_loop', '-1',
      '-ss', String(Math.max(0, Number(sourceOffset) || 0)),
      '-i', sourceFile,
      '-t', String(duration),
      '-an',
      '-vf', vf,
      '-r', '25',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      outFile
    ];
  const result = await runCommandLong('ffmpeg', args, { cwd: root, timeout: 10 * 60 * 1000 });
  if (!result.ok) throw new Error((result.stderr || result.stdout || 'ffmpeg 裁切失败').slice(-1600));
  return outFile;
}

async function renderRoughCut(root, project) {
  const scenes = (project.scenes || []).filter(scene => scene && sceneMaterials(scene).length);
  if (!scenes.length) throw new Error('没有已确认素材的镜头，无法生成粗剪。');
  const renderDir = path.join(root, 'public', 'uploads', 'ai-edit', project.id, 'renders');
  ensureDir(renderDir);
  const clipDir = path.join(renderDir, 'clips');
  ensureDir(clipDir);
  const failures = [];
  const skippedScenes = [];
  const clipFiles = [];
  const sourceUseCount = new Map();
  for (const scene of scenes) {
    const materials = sceneMaterials(scene);
    let renderedForScene = 0;
    for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
      const candidate = materials[materialIndex];
      const resolved = await resolveSceneMedia(root, project, scene, renderDir, candidate);
      if (!resolved.ok) {
        failures.push({ scene_id: scene.id, index: scene.index, material: candidate.title || candidate.id, error: resolved.error });
        continue;
      }
      if (resolved.candidate) materials[materialIndex] = resolved.candidate;
      const outFile = path.join(clipDir, 'scene_' + String(scene.index).padStart(2, '0') + '_' + String(materialIndex + 1).padStart(2, '0') + '.mp4');
      try {
        const sceneDuration = Math.max(0.6, Number(scene.duration) || Math.max(0.6, Number(scene.end) - Number(scene.start)) || 3);
        const clipDuration = materials.length > 1 ? Math.max(0.6, sceneDuration / materials.length) : sceneDuration;
        const clipScene = Object.assign({}, scene, { duration: clipDuration, end: Number(scene.start || 0) + clipDuration });
        const used = sourceUseCount.get(resolved.file) || 0;
        sourceUseCount.set(resolved.file, used + 1);
        const offset = project.edit_style === 'tianji' ? used * 1.4 : used * 2;
        await makeSceneClip(root, project, clipScene, resolved.file, outFile, offset);
        clipFiles.push(outFile);
        renderedForScene += 1;
      } catch (err) {
        failures.push({ scene_id: scene.id, index: scene.index, material: candidate.title || candidate.id, error: err.message });
      }
    }
    scene.selected_candidates = materials;
    scene.selected_candidate = materials[0] || null;
    if (!renderedForScene) {
      skippedScenes.push({ scene_id: scene.id, index: scene.index });
    }
  }
  if (!clipFiles.length) {
    throw new Error('所有镜头都没有成功生成裁片：' + failures.map(item => '镜头' + item.index + ' ' + item.error).join('；'));
  }

  const concatFile = path.join(renderDir, 'concat.txt');
  fs.writeFileSync(concatFile, clipFiles.map(quoteConcatPath).join('\n'), 'utf8');
  const silentVideo = path.join(renderDir, 'rough_silent.mp4');
  let result = await runCommandLong('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
    '-c', 'copy',
    silentVideo
  ], { cwd: root, timeout: 10 * 60 * 1000 });
  if (!result.ok) throw new Error((result.stderr || result.stdout || 'ffmpeg 拼接失败').slice(-1600));

  const finalPath = path.join(renderDir, 'rough_cut.mp4');
  const srtPath = path.join(renderDir, 'rough_cut.srt');
  fs.writeFileSync(srtPath, buildSrt(project), 'utf8');
  if (project.voiceover_path && fs.existsSync(project.voiceover_path)) {
    result = await runCommandLong('ffmpeg', [
      '-y',
      '-i', silentVideo,
      '-i', project.voiceover_path,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      finalPath
    ], { cwd: root, timeout: 10 * 60 * 1000 });
  } else {
    result = await runCommandLong('ffmpeg', ['-y', '-i', silentVideo, '-c', 'copy', finalPath], { cwd: root, timeout: 10 * 60 * 1000 });
  }
  if (!result.ok) throw new Error((result.stderr || result.stdout || 'ffmpeg 合成音频失败').slice(-1600));
  const url = '/uploads/ai-edit/' + project.id + '/renders/rough_cut.mp4';
  project.render_status = 'ready';
  project.rendered_at = nowIso();
  project.render_path = finalPath;
  project.render_url = url;
  project.render_srt_path = srtPath;
  project.render_srt_url = '/uploads/ai-edit/' + project.id + '/renders/rough_cut.srt';
  project.render_failures = failures;
  return {
    ok: true,
    path: finalPath,
    url,
    srt_url: project.render_srt_url,
    clip_count: clipFiles.length,
    skipped_count: skippedScenes.length,
    failures
  };
}

function createAiEditRoutes(options) {
  const root = options.root;
  const db = options.db;
  const callModelText = options.callModelText;
  const siliconflowApiKey = options.siliconflowApiKey || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '';
  const dataDir = path.join(root, 'data', 'ai-edit');
  const uploadDir = path.join(root, 'public', 'uploads', 'ai-edit');
  ensureDir(dataDir);
  ensureDir(uploadDir);

  function projectPath(id) {
    return path.join(dataDir, cleanName(id, 'project') + '.json');
  }

  function loadProject(id) {
    const file = projectPath(id);
    const project = readJson(file, null);
    if (!project) throw new Error('项目不存在');
    return project;
  }

  function saveProject(project) {
    project.updated_at = nowIso();
    writeJson(projectPath(project.id), project);
    return project;
  }

  async function searchSceneCandidates(scene, limit) {
    const materialCandidates = await queryMaterials(db, scene, limit);
    const remaining = Math.max(0, Math.min(8, Number(limit) || 6) - materialCandidates.length);
    let biliCandidates = [];
    let warning = '';
    let source = 'material-library';
    if (remaining > 0 && (scene.search_query || (scene.search_queries || []).length)) {
      const queries = Array.from(new Set([scene.search_query].concat(scene.search_queries || []).filter(Boolean))).slice(0, 4);
      const seen = new Set();
      const warnings = [];
      for (const query of queries) {
        if (biliCandidates.length >= remaining) break;
        const bili = await searchBilibili(query, remaining - biliCandidates.length);
        if (bili.warning) warnings.push(bili.warning);
        source = bili.source || source;
        (bili.items || []).forEach((item, index) => {
          const key = item.bvid || item.url || item.title;
          if (!key || seen.has(key)) return;
          seen.add(key);
          biliCandidates.push(mapBiliCandidate(item, biliCandidates.length + index, scene.id, query, scene.visual_need, scene));
        });
      }
      warning = Array.from(new Set(warnings.filter(Boolean))).join('；');
    }
    return {
      candidates: materialCandidates.concat(biliCandidates),
      material_count: materialCandidates.length,
      external_count: biliCandidates.length,
      source,
      warning
    };
  }

  return {
    '/api/ai-edit/projects/create': function(body, cb) {
      try {
        const id = projectId();
        const name = cleanName(body.name || body.project_name, 'AI剪辑项目');
        const project = {
          id,
          name,
          script: String(body.script || ''),
          target_ratio: body.target_ratio || '9:16',
          edit_style: body.edit_style || 'story',
          voiceover_path: '',
          voiceover_url: '',
          duration: 0,
          duration_source: '',
          scenes: [],
          timeline: null,
          export_status: '',
          created_at: nowIso(),
          updated_at: nowIso(),
          workspace: WORKSPACE_NAME
        };
        saveProject(project);
        cb({ ok: true, project, project_id: id });
      } catch(e) {
        cb({ ok: false, error: e.message });
      }
    },

    '/api/ai-edit/voiceover/upload': async function(body, cb) {
      try {
        const project = loadProject(body.project_id);
        const original = safeFileName(body.filename || 'voiceover.mp3', 'voiceover.mp3');
        const ext = path.extname(original) || '.mp3';
        const dir = path.join(uploadDir, project.id);
        ensureDir(dir);
        const filename = 'voiceover' + ext;
        const filePath = path.join(dir, filename);
        const buffer = Buffer.from(parseDataUrlBase64(body.file_base64 || body.base64), 'base64');
        if (!buffer.length) throw new Error('配音文件为空');
        fs.writeFileSync(filePath, buffer);
        const meta = await getAudioMeta(filePath);
        const url = '/uploads/ai-edit/' + project.id + '/' + filename;
        project.voiceover_path = filePath;
        project.voiceover_url = url;
        project.voiceover_name = original;
        project.duration = meta.duration || Number(body.duration) || project.duration || 0;
        project.duration_source = meta.duration ? 'ffprobe' : 'manual-or-fallback';
        saveProject(project);
        cb({ ok: true, project_id: project.id, voiceover: {
          filename: original,
          path: filePath,
          url,
          duration: project.duration,
          duration_source: project.duration_source,
          ffprobe_available: meta.available
        }});
      } catch(e) {
        cb({ ok: false, error: e.message });
      }
    },

    '/api/ai-edit/timeline/plan': async function(body, cb) {
      try {
        const project = loadProject(body.project_id);
        project.script = String(body.script || project.script || '');
        project.target_ratio = body.target_ratio || project.target_ratio || '9:16';
        project.edit_style = body.edit_style || project.edit_style || 'story';
        const duration = Number(body.duration) || project.duration || 0;
        const planned = await planScenesWithAi(project.script, duration, {
          target_ratio: project.target_ratio,
          edit_style: project.edit_style,
          callModelText,
          siliconflowApiKey,
          model: body.model
        });
        const scenes = planned.scenes || [];
        project.duration = duration || (scenes.length ? scenes[scenes.length - 1].end : 0);
        project.scenes = scenes;
        project.timeline = buildTimeline(project);
        project.planner = planned.planner;
        project.planner_warning = planned.warning || '';
        saveProject(project);
        cb({
          ok: true,
          project_id: project.id,
          project,
          scenes,
          duration: project.duration,
          planner: planned.planner,
          warning: planned.warning || ''
        });
      } catch(e) {
        cb({ ok: false, error: e.message });
      }
    },

    '/api/ai-edit/scene/search': async function(body, cb) {
      try {
        const project = loadProject(body.project_id);
        const sceneId = body.scene_id;
        const scene = (project.scenes || []).find(item => item.id === sceneId) || {
          id: sceneId || 'scene-manual',
          search_query: body.query || '',
          search_queries: body.queries || [],
          visual_need: body.visual_need || '',
          script_text: body.script_text || body.script || '',
          entities: body.entities || [],
          intent_terms: body.intent_terms || []
        };
        if (body.query) scene.search_query = body.query;
        if (!scene.asset_type || !scene.asset_label || !scene.collect_from) {
          const intent = sceneIntent([scene.script_text || scene.script || '', scene.visual_need || '', scene.search_query || ''].join('\n'));
          const plan = buildCollectPlan(scene.script_text || scene.script || '', scene.visual_need || '', intent, Number(scene.index || 1) - 1, project.edit_style);
          scene.asset_type = scene.asset_type || plan.asset_type;
      scene.asset_label = scene.asset_label || plan.asset_label;
      scene.collect_from = scene.collect_from || plan.collect_from;
      scene.match_tips = scene.match_tips || plan.match_tips;
      scene.auto_collect = scene.auto_collect || plan.auto_collect;
      scene.manual_collect = scene.manual_collect || plan.manual_collect;
      scene.platform_scope = scene.platform_scope || plan.platform_scope;
      scene.search_queries = Array.from(new Set([scene.search_query].concat(scene.search_queries || []).concat(plan.search_queries || []).filter(Boolean))).slice(0, 6);
    }
    const result = await searchSceneCandidates(scene, body.limit || 6);
    scene.candidates = result.candidates;
    scene.status = result.candidates.length ? 'ready' : 'empty';
    scene.warning = result.warning || '已查本地素材库和B站候选；抖音关键词视频搜索暂不支持，抖音素材请粘贴单条链接/主页/sec_uid或拖入当前镜头。';
        const idx = (project.scenes || []).findIndex(item => item.id === scene.id);
        if (idx >= 0) project.scenes[idx] = scene;
        saveProject(project);
        cb(Object.assign({ ok: true, project_id: project.id, scene_id: scene.id }, result));
      } catch(e) {
        cb({ ok: false, error: e.message });
      }
    },

    '/api/ai-edit/timeline/save': function(body, cb) {
      try {
        const project = loadProject(body.project_id);
        if (Array.isArray(body.scenes)) project.scenes = body.scenes;
        project.timeline = body.timeline || buildTimeline(project);
        saveProject(project);
        cb({ ok: true, project_id: project.id, project, timeline: project.timeline });
      } catch(e) {
        cb({ ok: false, error: e.message });
      }
    },

    '/api/ai-edit/export/prxml': function(body, cb) {
      try {
        const project = loadProject(body.project_id);
        if (Array.isArray(body.scenes)) project.scenes = body.scenes;
        const timeline = buildTimeline(project);
        project.timeline = timeline;
        const exportDir = path.join(uploadDir, project.id, 'exports');
        ensureDir(exportDir);
        const base = cleanName(project.name, 'ai-edit-project').replace(/[^\u4e00-\u9fa5a-zA-Z0-9._ -]/g, '_');
        const timelinePath = path.join(exportDir, 'timeline.json');
        const xmlPath = path.join(exportDir, base + '.xml');
        const srtPath = path.join(exportDir, base + '.srt');
        writeJson(timelinePath, timeline);
        fs.writeFileSync(xmlPath, buildPrXml(project, timeline, root), 'utf8');
        fs.writeFileSync(srtPath, buildSrt(project), 'utf8');
        project.export_status = 'ready';
        project.exported_at = nowIso();
        project.export_xml_path = xmlPath;
        project.export_timeline_path = timelinePath;
        project.export_srt_path = srtPath;
        saveProject(project);
        cb({
          ok: true,
          project_id: project.id,
          xml_path: xmlPath,
          xml_url: '/uploads/ai-edit/' + project.id + '/exports/' + path.basename(xmlPath),
          timeline_path: timelinePath,
          timeline_url: '/uploads/ai-edit/' + project.id + '/exports/timeline.json',
          srt_path: srtPath,
          srt_url: '/uploads/ai-edit/' + project.id + '/exports/' + path.basename(srtPath)
        });
      } catch(e) {
        cb({ ok: false, error: e.message });
      }
    },

    '/api/ai-edit/render/rough-cut': async function(body, cb) {
      try {
        const project = loadProject(body.project_id);
        if (Array.isArray(body.scenes)) project.scenes = body.scenes;
        project.timeline = body.timeline || buildTimeline(project);
        project.render_status = 'running';
        saveProject(project);
        const result = await renderRoughCut(root, project);
        project.timeline = buildTimeline(project);
        saveProject(project);
        cb(Object.assign({ project_id: project.id }, result));
      } catch(e) {
        try {
          const project = body && body.project_id ? loadProject(body.project_id) : null;
          if (project) {
            project.render_status = 'failed';
            project.render_error = e.message;
            saveProject(project);
          }
        } catch(ignore) {}
        cb({ ok: false, error: e.message });
      }
    }
  };
}

module.exports = createAiEditRoutes;
