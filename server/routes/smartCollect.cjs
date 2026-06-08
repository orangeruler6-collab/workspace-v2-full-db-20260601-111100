const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const media = require('../materials/media.cjs');
const downloadAdapters = require('../lib/downloadAdapters.cjs');
const searchIntent = require('../lib/searchIntent.cjs');

const OPENCLI_CMD = 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\opencli.cmd';
const SMART_ROOT_NAME = '\u667a\u80fd\u91c7\u7247';
const DEFAULT_CATEGORY = '\u5f85\u526a\u7d20\u6750';
const SYSTEM_UPLOADER = '\u667a\u80fd\u91c7\u7f16';
const METAPHOR_WORDS = searchIntent.METAPHOR_TERMS;
const GENERIC_SEARCH_WORDS = searchIntent.GENERIC_TERMS;

function detectPlatform(url) {
  const text = String(url || '').toLowerCase();
  if (text.includes('bilibili.com') || text.includes('b23.tv') || /(^|\s)(bv[a-z0-9]+)/i.test(text)) return 'bilibili';
  if (text.includes('douyin.com') || text.includes('v.douyin.com')) return 'douyin';
  if (text.includes('youtube.com') || text.includes('youtu.be')) return 'youtube';
  return 'link';
}

function cleanProjectName(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 48) || SMART_ROOT_NAME + '\u9879\u76ee';
}

function cleanFsName(value) {
  return cleanProjectName(value).replace(/[^\u4e00-\u9fa5a-zA-Z0-9._ -]/g, '_');
}

function extractUrls(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const urls = [];
  lines.forEach(line => {
    const matches = line.match(/https?:\/\/[^\s]+/g);
    if (matches && matches.length) {
      matches.forEach(url => urls.push(url.replace(/[),，。]+$/g, '')));
      return;
    }
    if (/^BV[a-zA-Z0-9]+$/.test(line)) urls.push(line);
  });
  return Array.from(new Set(urls));
}

function extractBvid(value) {
  const text = String(value || '');
  const match = text.match(/BV[0-9A-Za-z]+/);
  return match ? match[0] : '';
}

function extractAid(value) {
  const text = String(value || '');
  const match = text.match(/(?:\/av|^av)(\d+)/i);
  return match ? match[1] : '';
}

function normalizeBiliUrl(value) {
  const bvid = extractBvid(value);
  if (bvid) return 'https://www.bilibili.com/video/' + bvid;
  return String(value || '');
}

function folderPathFor(name, parent) {
  return parent === '/' ? '/' + name : parent + '/' + name;
}

function ensureFolder(db, name, type, parent) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM folders WHERE name=? AND parent=? AND type=? ORDER BY id LIMIT 1', [name, parent, type], function(getErr, row) {
      if (getErr) { reject(getErr); return; }
      if (row) {
        resolve({ id: row.id, name: row.name, parent: row.parent, type: row.type, path: folderPathFor(row.name, row.parent), existed: true });
        return;
      }
      db.run('INSERT INTO folders (name,parent,type) VALUES (?,?,?)', [name, parent, type], function(insertErr) {
        if (insertErr) { reject(insertErr); return; }
        resolve({ id: this.lastID, name, parent, type, path: folderPathFor(name, parent), existed: false });
      });
    });
  });
}

async function ensureProjectFolder(db, projectName, type) {
  const root = await ensureFolder(db, SMART_ROOT_NAME, type, '/');
  const project = await ensureFolder(db, cleanProjectName(projectName), type, root.path);
  return {
    name: project.name,
    type,
    root_folder: root.path,
    folder: project.path,
    folder_id: project.id
  };
}

function candidateFromUrl(url, index, projectPath, sceneId) {
  const platform = detectPlatform(url);
  const labels = { bilibili: 'B\u7ad9', douyin: '\u6296\u97f3', youtube: 'YouTube', link: '\u94fe\u63a5' };
  const platformLabel = labels[platform] || '\u94fe\u63a5';
  return {
    id: `${platform}-${sceneId || 'manual'}-${index + 1}`,
    scene_id: sceneId || '',
    platform,
    platform_label: platformLabel,
    title: `${platformLabel}\u5019\u9009\u7d20\u6750 ${index + 1}`,
    url: platform === 'bilibili' ? normalizeBiliUrl(url) : url,
    bvid: platform === 'bilibili' ? extractBvid(url) : '',
    aid: platform === 'bilibili' ? extractAid(url) : '',
    status: 'candidate',
    duration: '',
    target_folder: projectPath,
    match_reason: '\u6765\u81ea\u4f60\u7c98\u8d34\u7684\u7d20\u6750\u94fe\u63a5\uff0c\u5efa\u8bae\u4eba\u5de5\u6253\u5f00\u9884\u89c8\u540e\u518d\u51b3\u5b9a\u662f\u5426\u4e0b\u8f7d\u5165\u5e93\u3002',
    usage: '\u53ef\u4f5c\u4e3a\u8865\u5145\u753b\u9762\u6216\u53c2\u8003\u7d20\u6750',
    next_step: platform === 'bilibili' ? '\u53ef\u5c1d\u8bd5\u4e0b\u8f7d\u5165\u5e93' : '\u6682\u9700\u4eba\u5de5\u4e0b\u8f7d\u540e\u5bfc\u5165'
  };
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function uniqueList(list, limit) {
  const seen = new Set();
  const out = [];
  (list || []).forEach(item => {
    const value = String(item || '').trim();
    const key = normalizeToken(value);
    if (!value || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return typeof limit === 'number' ? out.slice(0, limit) : out;
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').trim();
}

function splitQueryTerms(value) {
  return uniqueList(String(value || '')
    .split(/[\s,，、/|]+/)
    .map(item => item.trim())
    .filter(Boolean), 12);
}

function removeBannedTerms(query, bannedTerms) {
  let value = String(query || '').trim();
  uniqueList([].concat(METAPHOR_WORDS, GENERIC_SEARCH_WORDS, bannedTerms || [])).forEach(term => {
    if (!term) return;
    value = value.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  });
  return value.replace(/\s+/g, ' ').trim();
}

function hasAnyTerm(text, terms) {
  const haystack = String(text || '').toLowerCase();
  return (terms || []).some(term => {
    const value = normalizeToken(term);
    return value && haystack.includes(value);
  });
}

function extractCandidateEntities(text) {
  const raw = String(text || '');
  const aliases = [
    ['faker', 'Faker'],
    ['\u98de\u79d1', 'Faker'],
    ['\u674e\u76f8\u8d6b', 'Faker'],
    ['\u67f3\u667a\u654f', '\u67f3\u667a\u654f'],
    ['karina', 'Karina'],
    ['\u5b81\u5b81', '\u5b81\u5b81'],
    ['aespa', 'aespa'],
    ['\u6885\u897f', '\u6885\u897f'],
    ['\u5185\u9a6c\u5c14', '\u5185\u9a6c\u5c14'],
    ['\u82cf\u4e9a\u96f7\u65af', '\u82cf\u4e9a\u96f7\u65af']
  ];
  const entities = [];
  aliases.forEach(pair => {
    if (new RegExp(pair[0], 'i').test(raw)) entities.push(pair[1]);
  });
  const english = raw.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || [];
  const chineseNames = raw.match(/[\u4e00-\u9fa5]{2,4}(?:\u548c|\u4e0e|x|X|、|,|，)[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || [];
  return uniqueList(entities.concat(english, chineseNames), 6);
}

function inferVisualIntent(part, index, entities) {
  const text = String(part || '');
  if (/\u5e7f\u544a|\u4ee3\u8a00|\u5546\u52a1|\u5ba3\u4f20|\u54c1\u724c|ad\b|commercial/i.test(text)) {
    return '\u5e7f\u544a/\u4ee3\u8a00\u76f8\u5173\u753b\u9762\uff1a\u4f18\u5148\u627e\u771f\u5b9e\u4eba\u7269\u3001\u54c1\u724c\u7269\u6599\u3001\u5e7f\u544a\u82b1\u7d6e\u6216\u53d1\u5e03\u4f1a\uff0c\u4e0d\u8981\u641c\u6bd4\u55bb\u8bcd\u3002';
  }
  if (entities.length >= 2 || /\u5408\u4f5c|\u540c\u6846|\u8054\u52a8|\u7ec4\u5408|cp/i.test(text)) {
    return '\u4eba\u7269\u540c\u6846/\u5173\u8054\u753b\u9762\uff1a\u627e\u771f\u5b9e\u4e3b\u4f53\u76f8\u5173\u7684\u540c\u6846\u3001\u6d3b\u52a8\u3001\u5e7f\u544a\u6216\u7c89\u4e1d\u5411\u526a\u8f91\u3002';
  }
  return buildVisualNeed(part, index);
}

function inferSearchIntentTerms(text) {
  const raw = String(text || '');
  const terms = [];
  if (/\u5e7f\u544a|\u4ee3\u8a00|\u5546\u52a1|\u5ba3\u4f20|\u54c1\u724c|ad\b|commercial/i.test(raw)) terms.push('\u5e7f\u544a');
  if (/\u540c\u6846|\u5408\u4f5c|\u8054\u52a8|cp/i.test(raw)) terms.push('\u540c\u6846');
  if (/\u7c89\u4e1d|\u996d\u5236|\u526a\u8f91|reaction/i.test(raw)) terms.push('\u7c89\u4e1d\u526a\u8f91');
  if (/\u821e\u53f0|\u76f4\u62cd|live|stage/i.test(raw)) terms.push('\u821e\u53f0');
  if (/\u91c7\u8bbf|\u82b1\u7d6e|\u5e55\u540e|behind/i.test(raw)) terms.push('\u82b1\u7d6e');
  return uniqueList(terms, 3);
}

function strengthenQuery(query, entities, sourceText) {
  const clean = removeBannedTerms(query || '');
  const entityList = uniqueList(entities || [], 6);
  if (!entityList.length) return clean;
  if (hasAnyTerm(clean, entityList) && splitQueryTerms(clean).length >= Math.min(2, entityList.length)) return clean;
  return uniqueList(entityList.concat(inferSearchIntentTerms(sourceText)).concat(splitQueryTerms(clean)), 6).join(' ');
}

function buildSearchQuery(part) {
  const text = String(part || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9 ]/g, ' ');
  const stop = new Set([].concat(GENERIC_SEARCH_WORDS, METAPHOR_WORDS, ['\u4e00\u4e2a', '\u56e0\u4e3a', '\u6240\u4ee5', '\u7136\u540e', '\u4f46\u662f', '\u53ef\u4ee5']));
  const words = text.split(/\s+/).filter(Boolean).filter(word => !stop.has(word));
  const chinese = (text.match(/[\u4e00-\u9fa5]{2,8}/g) || []).filter(word => !stop.has(word));
  const entities = extractCandidateEntities(part);
  return strengthenQuery(uniqueList(entities.concat(words, chinese), 6).join(' '), entities, part);
}

function extractCandidateEntities(text) {
  return searchIntent.extractSearchIntent(text, { entityLimit: 6 }).entities;
}

function inferSearchIntentTerms(text) {
  return searchIntent.inferIntentTerms(text);
}

function strengthenQuery(query, entities, sourceText) {
  const intent = searchIntent.extractSearchIntent(sourceText || query || '', { queryLimit: 4 });
  const clean = removeBannedTerms(query || '', intent.exclude_terms);
  const entityList = uniqueList(entities && entities.length ? entities : intent.entities, 6);
  if (!entityList.length) return clean || intent.query;
  if (hasAnyTerm(clean, entityList)) return clean;
  return uniqueList(entityList.concat(inferSearchIntentTerms(sourceText)).concat(splitQueryTerms(clean)), 5).join(' ');
}

function buildSearchQuery(part) {
  const intent = searchIntent.extractSearchIntent(part, { queryLimit: 4 });
  return intent.query || removeBannedTerms(String(part || '').slice(0, 32), intent.exclude_terms);
}

function buildVisualNeed(part, index) {
  const text = String(part || '');
  if (index === 0) return '\u5f00\u573a\u94a9\u5b50\u753b\u9762\uff1a\u9700\u8981\u5f3a\u89c6\u89c9\u51b2\u51fb\u3001\u4eba\u7269/\u4e8b\u4ef6\u4e3b\u4f53\u6e05\u695a\uff0c\u9002\u5408\u505a\u524d3\u79d2\u5438\u5f15\u3002';
  if (/\u6570\u636e|\u51a0\u519b|\u7eaa\u5f55|\u6210\u7ee9|\u8fdb\u7403|\u6bd4\u5206|\u91d1\u989d|\u5e74\u4efd/.test(text)) return '\u6570\u636e\u8bba\u636e\u753b\u9762\uff1a\u4f18\u5148\u627e\u6bd4\u8d5b\u96c6\u9526\u3001\u699c\u5355\u3001\u5b57\u5e55\u6e05\u695a\u7684\u8d44\u6599\u753b\u9762\u3002';
  if (/\u51b2\u7a81|\u4e89\u8bae|\u5931\u8d25|\u4f4e\u8c37|\u8d28\u7591|\u60e8\u8d25|\u79bb\u961f/.test(text)) return '\u51b2\u7a81\u8f6c\u6298\u753b\u9762\uff1a\u9700\u8981\u60c5\u7eea\u660e\u663e\u7684\u6bd4\u8d5b\u73b0\u573a\u3001\u4eba\u7269\u53cd\u5e94\u6216\u65b0\u95fb\u6807\u9898\u3002';
  if (/\u4eba\u7269|\u6885\u897f|\u5185\u9a6c\u5c14|\u82cf\u4e9a\u96f7\u65af|\u660e\u661f|\u7403\u5458|\u89d2\u8272/.test(text)) return '\u4eba\u7269\u7279\u5199\u753b\u9762\uff1a\u4f18\u5148\u627e\u4eba\u7269\u8fd1\u666f\u3001\u5e86\u795d\u3001\u91c7\u8bbf\u3001\u5173\u952e\u52a8\u4f5c\u3002';
  return '\u53d9\u4e8b\u8fc7\u6e21\u753b\u9762\uff1a\u627e\u4e0e\u8fd9\u6bb5\u6587\u6848\u4e3b\u9898\u76f8\u5173\u7684\u6a2a\u5411\u8865\u5145\u7d20\u6750\u3002';
}

function splitScriptLocally(script) {
  const text = String(script || '').replace(/\r/g, '\n').trim();
  const rawParts = text
    .split(/\n{2,}|(?<=[\u3002\uff01\uff1f!?])\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  const parts = rawParts.length ? rawParts : [text];
  const merged = [];
  parts.forEach(part => {
    if (!merged.length || merged[merged.length - 1].length > 90) merged.push(part);
    else merged[merged.length - 1] += part;
  });
  return merged.slice(0, 12).map((part, index) => {
    const intent = searchIntent.extractSearchIntent(part, { queryLimit: 4 });
    const entities = intent.entities;
    const searchQuery = intent.query || buildSearchQuery(part) || entities.join(' ') || removeBannedTerms(part.slice(0, 24), intent.exclude_terms);
    return {
      id: 'scene-' + (index + 1),
      index: index + 1,
      script: part,
      visual_need: inferVisualIntent(part, index, entities),
      search_query: searchQuery,
      search_queries: uniqueList([searchQuery].concat(intent.queries || []), 4),
      entities,
      exclude_terms: intent.exclude_terms,
      intent_terms: intent.intent_terms,
      material_type: 'video',
      status: 'need_candidates',
      candidates: []
    };
  });
}

async function planScriptWithModel(script, options) {
  const callModelText = options && options.callModelText;
  if (!callModelText) return null;
  const documentIntent = searchIntent.extractSearchIntent(script, { queryLimit: 4 });
  const system = [
    '\u4f60\u662f\u77ed\u89c6\u9891\u667a\u80fd\u91c7\u7247\u7b56\u5212\u3002',
    '\u4efb\u52a1\uff1a\u628a\u6587\u6848\u62c6\u6210 3-8 \u4e2a\u753b\u9762\u9700\u6c42\uff0c\u5e76\u4e3a B\u7ad9/OpenCLI \u641c\u7d22\u751f\u6210\u51c6\u786e\u5173\u952e\u8bcd\u3002',
    '\u91cd\u8981\u89c4\u5219\uff1a\u533a\u5206\u771f\u5b9e\u4e3b\u4f53\u548c\u4fee\u8f9e\u6bd4\u55bb\u3002\u4f8b\u5982\u201c\u54e5\u5e03\u6797\u201d\u3001\u201c\u5c0f\u4e11\u201d\u3001\u201c\u602a\u7269\u201d\u5982\u679c\u662f\u8bc4\u4ef7/\u6bd4\u55bb\uff0c\u5fc5\u987b\u653e\u5165 exclude_terms\uff0c\u4e0d\u80fd\u653e\u5165 search_query\u3002',
    '\u641c\u7d22\u8bcd\u5fc5\u987b\u4f18\u5148\u4f7f\u7528\u4eba\u540d\u3001\u4e8b\u4ef6\u3001\u5e73\u53f0\u3001\u5e7f\u544a/\u821e\u53f0/\u91c7\u8bbf\u7b49\u53ef\u89c6\u5316\u8bcd\u3002',
    '\u53ea\u8fd4\u56de JSON\uff1a{"scenes":[{"script":"","visual_need":"","search_query":"","search_queries":[],"entities":[],"exclude_terms":[],"reason":""}]}'
  ].join('\n');
  const user = '\u6587\u6848\uff1a\n' + String(script || '').slice(0, 8000);
  try {
    const raw = await callModelText(system, user, {
      model: 'gpt-5.4',
      temperature: 0.2,
      maxTokens: 2600,
      timeoutMs: 120000
    });
    const parsed = parseJsonLoose(raw);
    if (!parsed || !Array.isArray(parsed.scenes)) return null;
    const scenes = parsed.scenes.slice(0, 8).map((item, index) => {
      const part = String(item.script || '').trim() || String(script || '').slice(0, 140);
      const sceneIntent = searchIntent.extractSearchIntent(part, { queryLimit: 4 });
      const modelIntent = searchIntent.extractSearchIntent([]
        .concat(item.entities || [])
        .concat(item.search_query || [])
        .concat(item.search_queries || [])
        .concat(item.visual_need || [])
        .join(' '), { queryLimit: 4 });
      const mergedIntent = searchIntent.mergeSceneIntent({
        entities: uniqueList([].concat(sceneIntent.entities, modelIntent.entities), 6),
        intent_terms: uniqueList([].concat(sceneIntent.intent_terms, modelIntent.intent_terms), 3),
        metaphors: uniqueList([].concat(sceneIntent.metaphors, modelIntent.metaphors), 8),
        exclude_terms: uniqueList([].concat(sceneIntent.exclude_terms, modelIntent.exclude_terms, item.exclude_terms || []), 10),
        queries: uniqueList([].concat(sceneIntent.queries, modelIntent.queries), 4),
        query: sceneIntent.query || modelIntent.query,
        confidence: Math.max(sceneIntent.confidence, modelIntent.confidence)
      }, documentIntent);
      const entities = mergedIntent.entities;
      const excludeTerms = mergedIntent.exclude_terms;
      let query = removeBannedTerms(item.search_query || '', excludeTerms);
      if (!query || !hasAnyTerm(query, entities)) query = mergedIntent.query || buildSearchQuery(part);
      query = strengthenQuery(query, entities, part);
      const queries = uniqueList([query]
        .concat(mergedIntent.queries || [])
        .concat(item.search_queries || [])
        .map(q => strengthenQuery(removeBannedTerms(q, excludeTerms), entities, part))
        .filter(Boolean), 4);
      return {
        id: 'scene-' + (index + 1),
        index: index + 1,
        script: part,
        visual_need: String(item.visual_need || inferVisualIntent(part, index, entities)).trim(),
        search_query: queries[0] || query,
        search_queries: queries.length ? queries : [query].filter(Boolean),
        entities,
        exclude_terms: excludeTerms,
        intent_terms: mergedIntent.intent_terms,
        reason: String(item.reason || '').trim(),
        material_type: 'video',
        status: 'need_candidates',
        candidates: []
      };
    }).filter(scene => scene.script && scene.search_query);
    return scenes.length ? scenes : null;
  } catch(e) {
    return null;
  }
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
      resolve({ ok: false, code: -1, stdout, stderr: stderr + '\ntimeout' });
    }, options && options.timeout || 30000);
    proc.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) {}
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

async function searchByOpenCli(query, limit) {
  if (!fs.existsSync(OPENCLI_CMD)) return { ok: false, error: 'opencli.cmd not found' };
  const result = await runCommand(OPENCLI_CMD, ['bilibili', 'search', query, '--limit', String(limit), '-f', 'json'], {
    timeout: 45000
  });
  if (!result.ok) return { ok: false, error: result.stderr || 'OpenCLI search failed' };
  const parsed = parseJsonLoose(result.stdout);
  if (!Array.isArray(parsed)) return { ok: false, error: 'OpenCLI output is not a candidate list' };
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

async function searchByPublicApi(query, limit) {
  const url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + encodeURIComponent(query) + '&page=1';
  const res = await requestJson(url, 12000);
  if (!res.ok || !res.data || !res.data.data) return { ok: false, error: res.error || 'Bilibili public search failed' };
  const list = Array.isArray(res.data.data.result) ? res.data.data.result : [];
  return {
    ok: true,
    items: list.slice(0, limit).map((item, index) => ({
      rank: index + 1,
      title: String(item.title || '').replace(/<[^>]+>/g, ''),
      author: item.author || '',
      score: item.play || item.video_review || 0,
      url: item.arcurl || (item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : ''),
      duration: item.duration || ''
    }))
  };
}

async function searchCandidates(input) {
  const excludeTerms = uniqueList([].concat(input.exclude_terms || [], METAPHOR_WORDS), 16);
  const baseQueries = uniqueList([]
    .concat(input.queries || [])
    .concat(input.query || [])
    .concat(input.visual_need || [])
    .concat(input.script || [])
    .map(query => removeBannedTerms(query, excludeTerms))
    .filter(Boolean), 4);
  const query = baseQueries[0] || '';
  const limit = Math.max(1, Math.min(12, Number(input.limit) || 6));
  if (!query) return { ok: false, error: 'missing query' };
  const errors = [];
  for (const currentQuery of baseQueries) {
    const opencli = await searchByOpenCli(currentQuery, limit);
    if (opencli.ok && opencli.items.length) {
      return { ok: true, source: 'opencli:bilibili', query: currentQuery, items: rankSearchItems(opencli.items, input, excludeTerms).slice(0, limit), warning: '' };
    }
    if (opencli.error) errors.push(opencli.error);

    const publicApi = await searchByPublicApi(currentQuery, limit);
    if (publicApi.ok && publicApi.items.length) {
      return {
        ok: true,
        source: 'bilibili:public-api',
        query: currentQuery,
        items: rankSearchItems(publicApi.items, input, excludeTerms).slice(0, limit),
        warning: opencli.error ? 'OpenCLI did not return results; using Bilibili public search fallback.' : ''
      };
    }
    if (publicApi.error) errors.push(publicApi.error);
  }
  return {
    ok: true,
    source: 'manual',
    items: [],
    query,
    warning: (errors[0] ? errors[0] + '. ' : '') + 'No usable result from OpenCLI or public search. Try another query or paste links manually.'
  };
}

function rankSearchItems(items, input, excludeTerms) {
  const entities = uniqueList([].concat(input.entities || []).concat(splitQueryTerms(input.query || '')), 12);
  const visualTerms = splitQueryTerms(input.visual_need || '');
  return (items || [])
    .map((item, index) => {
      const title = stripHtml(item.title || '');
      const author = stripHtml(item.author || item.owner || '');
      const haystack = (title + ' ' + author).toLowerCase();
      const hasBanned = hasAnyTerm(haystack, excludeTerms);
      let relevance = 0;
      entities.forEach(term => { if (term && haystack.includes(normalizeToken(term))) relevance += 8; });
      visualTerms.forEach(term => { if (term && haystack.includes(normalizeToken(term))) relevance += 2; });
      if (hasBanned) relevance -= 30;
      relevance += Math.min(6, Math.log10(Number(item.score || item.play || 0) + 1));
      return Object.assign({}, item, { _rank: relevance, _originalIndex: index, _banned: hasBanned });
    })
    .filter(item => !item._banned || item._rank > 0)
    .sort((a, b) => (b._rank - a._rank) || (a._originalIndex - b._originalIndex));
}

function mapSearchResult(item, index, sceneId, projectPath, visualNeed, meta) {
  const url = normalizeBiliUrl(item.url || item.bvid || '');
  const bvid = extractBvid(url);
  const aid = extractAid(item.url || '');
  const queryUsed = meta && meta.query ? meta.query : '';
  const entities = meta && Array.isArray(meta.entities) ? meta.entities : [];
  return {
    id: `bilibili-${sceneId || 'scene'}-${bvid || aid || index + 1}`,
    scene_id: sceneId || '',
    platform: 'bilibili',
    platform_label: 'B\u7ad9',
    title: item.title || `B\u7ad9\u5019\u9009\u7d20\u6750 ${index + 1}`,
    author: item.author || item.owner || '',
    url,
    bvid,
    aid,
    duration: item.duration || '',
    score: item.score || item.play || 0,
    status: 'candidate',
    target_folder: projectPath,
    match_reason: visualNeed
      ? `\u641c\u7d22\u8bcd\uff1a${queryUsed || '-'}\uff1b\u4e3b\u4f53\uff1a${entities.join(' / ') || '-'}\uff1b\u753b\u9762\u9700\u6c42\uff1a${visualNeed}`
      : '\u6839\u636e\u8be5\u6bb5\u6587\u6848\u641c\u7d22\u5230\u7684\u76f8\u5173\u89c6\u9891\u5019\u9009\u3002',
    usage: '\u5efa\u8bae\u4eba\u5de5\u9884\u89c8\u540e\u52fe\u9009\uff0c\u4e0b\u8f7d\u540e\u8fdb\u5165\u7d20\u6750\u5e93\u9879\u76ee\u6587\u4ef6\u5939',
    next_step: bvid ? '\u53ef\u5c1d\u8bd5\u4e0b\u8f7d\u5165\u5e93' : '\u53ef\u6253\u5f00\u9884\u89c8\uff0c\u4e0b\u8f7d\u9700\u5148\u8865 BV \u53f7'
  };
}

function getFileType(ext) {
  const value = String(ext || '').toLowerCase();
  if (['.mp4', '.mov', '.webm', '.avi', '.mkv', '.flv', '.wmv', '.m4v'].includes(value)) return 'video';
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(value)) return 'image';
  if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'].includes(value)) return 'bgm';
  return 'other';
}

function insertMaterial(db, payload) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM materials WHERE storage_path=? AND (status IS NULL OR status != ?) LIMIT 1', [payload.storage_path, 'deleted'], function(findErr, row) {
      if (findErr) { reject(findErr); return; }
      if (row) {
        resolve({ id: row.id, existed: true });
        return;
      }
      db.run(
        `INSERT INTO materials (filename,original,size,duration,width,height,thumb,category,tags,type,folder,uploader,status,storage_path,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          payload.filename,
          payload.original,
          payload.size || 0,
          payload.duration || 0,
          payload.width || 0,
          payload.height || 0,
          payload.thumb || '',
          payload.category || DEFAULT_CATEGORY,
          JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []),
          payload.type || 'video',
          payload.folder || '/',
          payload.uploader || SYSTEM_UPLOADER,
          'ready',
          payload.storage_path || '',
          Math.floor(Date.now() / 1000)
        ],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, existed: false });
        }
      );
    });
  });
}

async function registerDownloadedFile(db, root, uploadDir, thumbDir, filePath, folder, item, auth) {
  const ext = path.extname(filePath);
  const type = getFileType(ext);
  if (type !== 'video' && type !== 'image') return { ok: false, error: 'Downloaded result is not a recognized video/image file.' };
  const stat = fs.statSync(filePath);
  const relative = path.relative(uploadDir, filePath).replace(/\\/g, '/');
  let duration = 0;
  let width = 0;
  let height = 0;
  let thumb = '';
  if (type === 'video') {
    const meta = await media.getVideoMeta(filePath);
    duration = meta.duration || 0;
    width = meta.width || 0;
    height = meta.height || 0;
    const thumbName = media.safeName(path.basename(filePath, ext) || 'smartcollect') + '.jpg';
    const thumbPath = path.join(thumbDir, thumbName);
    const thumbOk = await media.extractThumb(filePath, thumbPath);
    thumb = thumbOk ? '/uploads/thumbs/' + thumbName : '';
  } else if (type === 'image') {
    const meta = await media.getImageMeta(filePath);
    width = meta.width || 0;
    height = meta.height || 0;
    const thumbName = media.safeName(path.basename(filePath, ext) || 'smartcollect') + '.jpg';
    const thumbPath = path.join(thumbDir, thumbName);
    const thumbOk = await media.extractImageThumb(filePath, thumbPath);
    thumb = thumbOk ? '/uploads/thumbs/' + thumbName : '';
  }
  const inserted = await insertMaterial(db, {
    filename: path.basename(filePath),
    original: item.title || path.basename(filePath),
    size: stat.size || 0,
    duration,
    width,
    height,
    thumb,
    category: DEFAULT_CATEGORY,
    tags: [SMART_ROOT_NAME, 'B\u7ad9', '\u5f85\u590d\u6838'],
    type,
    folder,
    uploader: auth && (auth.display_name || auth.username) || SYSTEM_UPLOADER,
    storage_path: relative
  });
  return {
    ok: true,
    id: inserted.id,
    existed: inserted.existed,
    filename: path.basename(filePath),
    storage_path: relative,
    thumb,
    size: stat.size || 0
  };
}

async function downloadBilibiliItem(db, options) {
  const item = options.item;
  const bvid = item.bvid || extractBvid(item.url);
  if (!bvid) return { ok: false, status: 'pending', error: 'Missing BV id; automatic Bilibili download cannot start.' };
  const outputDir = options.outputDir;
  fs.mkdirSync(outputDir, { recursive: true });
  const result = await downloadAdapters.downloadBilibili({
    root: options.root,
    bvid,
    url: item.url,
    outputDir,
    quality: '720P',
    timeout: 15 * 60 * 1000
  });
  const mediaFiles = result.files || [];
  if (!result.ok || !mediaFiles.length) {
    return {
      ok: false,
      status: 'pending',
      bvid,
      tools: result.tools,
      attempts: result.attempts,
      error: (result.error || 'Downloader did not produce a media file.').slice(0, 1000),
      hint: 'Install BBDown or repair yt-dlp as a real executable. Candidate is kept for manual download/import.'
    };
  }
  const registered = await registerDownloadedFile(db, options.root, options.uploadDir, options.thumbDir, mediaFiles[0], options.folder, item, options.auth);
  return Object.assign({ bvid, status: 'imported', downloader: result.tool, attempts: result.attempts }, registered);
}

module.exports = function createSmartCollectRoutes(deps) {
  const db = deps.db;
  const root = deps.root || path.join(__dirname, '..', '..');
  const uploadDir = deps.uploadDir || path.join(root, 'public', 'uploads');
  const thumbDir = deps.thumbDir || path.join(root, 'public', 'uploads', 'thumbs');

  return {
    '/api/smart-collect/downloader-status': function(body, cb) {
      try {
        cb({
          ok: true,
          tools: downloadAdapters.detectTools(root),
          priority: ['BBDown', 'yt-dlp', 'OpenCLI'],
          note: 'Bilibili download tries BBDown first, then yt-dlp, then OpenCLI.'
        });
      } catch(e) {
        cb({ error: e.message });
      }
    },

    '/api/smart-collect/prepare': async function(body, cb) {
      try {
        const projectName = cleanProjectName(body.project_name || body.projectName);
        const type = body.type || 'video';
        const urls = extractUrls(body.links || body.urls || body.text || '');
        if (!urls.length) { cb({ error: 'missing links' }); return; }
        const project = await ensureProjectFolder(db, projectName, type);
        const candidates = urls.map((url, index) => candidateFromUrl(url, index, project.folder, 'manual'));
        cb({ ok: true, project, total: candidates.length, candidates });
      } catch(e) {
        cb({ error: e.message });
      }
    },

    '/api/smart-collect/script-plan': async function(body, cb) {
      try {
        const projectName = cleanProjectName(body.project_name || body.projectName);
        const type = body.type || 'video';
        const script = String(body.script || body.text || '').trim();
        if (!script) { cb({ error: 'missing script' }); return; }
        const project = await ensureProjectFolder(db, projectName, type);
        const aiScenes = await planScriptWithModel(script, { callModelText: deps.callModelText });
        const scenes = aiScenes || splitScriptLocally(script);
        cb({
          ok: true,
          project,
          total: scenes.length,
          scenes,
          planner: aiScenes ? 'gpt-5.4' : 'local-fallback'
        });
      } catch(e) {
        cb({ error: e.message });
      }
    },

    '/api/smart-collect/search-candidates': async function(body, cb) {
      try {
        const projectName = cleanProjectName(body.project_name || body.projectName);
        const type = body.type || 'video';
        const project = body.folder ? { folder: body.folder, type } : await ensureProjectFolder(db, projectName, type);
        const result = await searchCandidates({
          query: body.query,
          queries: body.queries || body.search_queries,
          visual_need: body.visual_need,
          script: body.script,
          entities: body.entities,
          exclude_terms: body.exclude_terms,
          limit: body.limit
        });
        if (!result.ok) { cb({ error: result.error || 'search failed' }); return; }
        const candidates = (result.items || []).map((item, index) => mapSearchResult(item, index, body.scene_id, project.folder, body.visual_need, {
          query: result.query || body.query,
          entities: body.entities || []
        }));
        cb({
          ok: true,
          source: result.source,
          query: result.query || body.query || '',
          warning: result.warning || '',
          scene_id: body.scene_id || '',
          total: candidates.length,
          candidates
        });
      } catch(e) {
        cb({ error: e.message });
      }
    },

    '/api/smart-collect/download-selected': async function(body, cb) {
      try {
        const projectName = cleanProjectName(body.project_name || body.projectName);
        const type = body.type || 'video';
        const project = body.folder ? { folder: body.folder, type } : await ensureProjectFolder(db, projectName, type);
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) { cb({ error: 'missing selected items' }); return; }
        const outputDir = path.join(uploadDir, 'smartcollect', cleanFsName(projectName));
        const results = [];
        for (const item of items) {
          if (detectPlatform(item.url) !== 'bilibili' && item.platform !== 'bilibili') {
            results.push({ ok: false, status: 'pending', title: item.title, url: item.url, error: 'Only Bilibili automatic download is supported for now.' });
            continue;
          }
          const result = await downloadBilibiliItem(db, {
            root,
            uploadDir,
            thumbDir,
            outputDir,
            folder: project.folder,
            item,
            auth: body._auth
          });
          results.push(Object.assign({ title: item.title, url: item.url }, result));
        }
        const imported = results.filter(item => item.ok).length;
        const pending = results.length - imported;
        cb({
          ok: true,
          project,
          imported_count: imported,
          pending_count: pending,
          output_dir: outputDir,
          results,
          message: imported
            ? `\u5df2\u5165\u5e93 ${imported} \u6761\u7d20\u6750\uff0c${pending} \u6761\u9700\u8981\u4eba\u5de5\u5904\u7406\u3002`
            : `\u6682\u672a\u5b8c\u6210\u81ea\u52a8\u4e0b\u8f7d\uff0c${pending} \u6761\u5019\u9009\u5df2\u4fdd\u7559\u4e3a\u5f85\u5904\u7406\u3002`
        });
      } catch(e) {
        cb({ error: e.message });
      }
    },

    '/api/smart-collect/import-selected': function(body, cb) {
      const items = Array.isArray(body.items) ? body.items : [];
      cb({
        ok: true,
        imported_count: 0,
        pending_count: items.length,
        message: '\u8fd9\u4e9b\u94fe\u63a5\u5df2\u6574\u7406\u4e3a\u5019\u9009\u7d20\u6750\u3002\u81ea\u52a8\u4e0b\u8f7d\u8bf7\u4f7f\u7528\u201c\u4e0b\u8f7d\u5165\u5e93\u9009\u4e2d\u7d20\u6750\u201d\u3002'
      });
    }
  };
};
