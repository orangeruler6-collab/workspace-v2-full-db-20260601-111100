const METAPHOR_TERMS = [
  '哥布林', '小丑', '怪物', '恶魔', '牛马', '小仙女', '鬼',
  '顶流', '天花板', '神', '封神', '王炸', '炸裂', '离谱',
  'goblin', 'monster', 'clown'
];

const GENERIC_TERMS = [
  '视频', '画面', '素材', '镜头', '剪辑', '文案', '比喻', '背景搜索',
  '背景', '搜索', '结构', '分析', '内容', '原文', '摘要', '总结',
  '这个', '那个', '我们', '他们', '有人', '网友', '粉丝', '评论',
  '可以', '需要', '相关', '资料', '参考', '平台'
];

const EXTRA_GENERIC_TERMS = [
  '结果', '枪法', '熟练度', '超', '很强', '顶级', '操作', '水平', '能力',
  '表现', '选题', '切入', '切入点', '框架', '结尾', '方案', '论据', '观点',
  '叙事', '节奏', '名场面', '弹幕', '解说', '采访', '金句', '梗', '传播',
  '统治力', '压迫感', '舞台中心', '创意方向', '国内联赛', '世界冠军',
  '全球冠军', '冠军', '奖杯', '世界', '舞台', '一直站在',
  'MVP', 'mvp', '真C', '康神', '别尬黑',
  '小道消息', '混迹娱乐圈', '鸡头班', '直播间', '开播', '那个K', '凯哥',
  '穿搭', '加油', 'let', 'lets', 'go', '明星嘉宾', '随便玩玩', '划水',
  '凑个数', '走个流程', '高强度博弈', '有点东西', '高光', '明场面',
  '把把乱C', '收割全场', '路过看看', '看热闹', '你真会啊', '达瓦',
  'ok', 're', 'gas'
];

const CONNECTOR_RE = '(?:\\s*(?:和|与|跟|以及|还有|同框|联动|x|X|&|and)\\s*)';

const ALIASES = [
  { test: /faker|飞科|李相赫/i, value: 'Faker', alternates: ['飞科', '李相赫'] },
  { test: /柳智敏/i, value: '柳智敏', alternates: ['Karina'] },
  { test: /karina/i, value: 'Karina', alternates: ['柳智敏'] },
  { test: /aespa/i, value: 'aespa', alternates: [] },
  { test: /梅西/i, value: '梅西', alternates: ['Messi'] },
  { test: /内马尔/i, value: '内马尔', alternates: ['Neymar'] },
  { test: /苏亚雷斯/i, value: '苏亚雷斯', alternates: ['Suarez'] },
  { test: /巴萨|巴塞罗那/i, value: '巴萨', alternates: ['巴塞罗那'] },
  { test: /\bmsn\b/i, value: 'MSN', alternates: ['梅西 内马尔 苏亚雷斯'] }
];

const EXTRA_ALIASES = [
  { test: /zmjjkk|康康|郑永康/i, value: 'ZmjjKK', alternates: ['康康', '郑永康'] },
  { test: /\bedg\b/i, value: 'EDG', alternates: ['EDG电子竞技俱乐部'] },
  { test: /王俊凯|小凯|凯哥/i, value: '王俊凯', alternates: ['TFBOYS 王俊凯'] },
  { test: /无畏区|无畏契约|瓦罗兰特|valorant|达瓦/i, value: '无畏契约', alternates: ['VALORANT', '瓦罗兰特'] }
];

const ALL_GENERIC_TERMS = GENERIC_TERMS.concat(EXTRA_GENERIC_TERMS);
const ALL_ALIASES = ALIASES.concat(EXTRA_ALIASES);

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

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[，。！？；：、,.!?;:()[\]【】《》"'“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanToken(value) {
  return String(value || '')
    .replace(/^(关于|围绕|针对|这期|本期|这条|这个|一个|就是|讲的是|和|与|跟|以及|还有|的)+/g, '')
    .replace(/(的|了|和|与|跟|之间|相关|事件|话题|内容|视频|素材|画面|镜头|文案|传闻|绯闻)+$/g, '')
    .trim();
}

function isGeneric(value) {
  const word = cleanToken(value);
  if (!word || word.length < 2 || word.length > 28) return true;
  if (/^\d+$/.test(word)) return true;
  return ALL_GENERIC_TERMS.some(term => word === term || word.includes(term));
}

function findMetaphors(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const found = [];
  METAPHOR_TERMS.forEach(term => {
    if (!term) return;
    const key = term.toLowerCase();
    const pos = lower.indexOf(key);
    if (pos < 0) return;
    const start = Math.max(0, pos - 12);
    const end = Math.min(raw.length, pos + term.length + 12);
    const around = raw.slice(start, end);
    if (/像|好像|如同|仿佛|比喻|形容|调侃|骂|说|称|评价|吐槽|离谱/.test(around) || /goblin|monster|clown/i.test(term)) {
      found.push(term);
    }
  });
  return uniqueList(found, 8);
}

function removeTerms(query, terms) {
  let value = String(query || '').trim();
  uniqueList([].concat(terms || [], ALL_GENERIC_TERMS)).forEach(term => {
    if (!term) return;
    value = value.replace(new RegExp(escapeRegExp(term), 'ig'), ' ');
  });
  return value.replace(/\s+/g, ' ').trim();
}

function extractAliasEntities(text) {
  const raw = String(text || '');
  const out = [];
  ALL_ALIASES.forEach(item => {
    if (item.test.test(raw)) out.push(item.value);
  });
  return out;
}

function extractConnectedEntities(text) {
  const source = sanitizeText(text);
  const out = [];
  const patterns = [
    new RegExp('\\b([A-Za-z][A-Za-z0-9_-]{1,30})\\b' + CONNECTOR_RE + '([\\u4e00-\\u9fa5]{2,5})', 'ig'),
    new RegExp('([\\u4e00-\\u9fa5]{2,5})' + CONNECTOR_RE + '\\b([A-Za-z][A-Za-z0-9_-]{1,30})\\b', 'ig'),
    new RegExp('([\\u4e00-\\u9fa5]{2,5})' + CONNECTOR_RE + '([\\u4e00-\\u9fa5]{2,5})', 'ig')
  ];
  patterns.forEach(re => {
    let match;
    while ((match = re.exec(source))) {
      const left = cleanToken(match[1]);
      const right = cleanToken(match[2]);
      if (!isGeneric(left)) out.push(left);
      if (!isGeneric(right)) out.push(right);
    }
  });
  return out;
}

function extractNamedTokens(text) {
  const source = sanitizeText(text).slice(0, 600);
  const out = [];
  (source.match(/\b[A-Za-z][A-Za-z0-9_-]{1,30}\b/g) || []).forEach(word => {
    const clean = /^faker$/i.test(word) ? 'Faker' : cleanToken(word);
    if (!isGeneric(clean)) out.push(clean);
  });
  (source.match(/#[\u4e00-\u9fa5A-Za-z0-9_]{2,24}/g) || []).forEach(word => {
    const clean = cleanToken(word.slice(1));
    if (!isGeneric(clean)) out.push(clean);
  });
  (source.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,18}(?=广告|代言|同框|联动|官宣|回应|道歉|翻车|争议|热议|热搜|比赛|冠军|发射|归属|批评|追上|粉丝|舞台|采访|花絮)/g) || []).forEach(word => {
    const clean = cleanToken(word).replace(/^([A-Za-z][A-Za-z0-9_-]{1,30})全球$/i, '$1');
    if (!isGeneric(clean)) out.push(clean);
  });
  return out;
}

function inferIntentTerms(text) {
  const raw = String(text || '');
  const terms = [];
  if (/广告|代言|商务|宣传|品牌|ad\b|commercial/i.test(raw)) terms.push('广告');
  if (/同框|合作|联动|cp|组合/i.test(raw)) terms.push('同框');
  if (/粉丝|饭制|剪辑|reaction|二创/i.test(raw)) terms.push('粉丝剪辑');
  if (/舞台|直拍|live|stage/i.test(raw) && !/zmjjkk|康康|edg|电竞|战队|无畏契约|瓦罗兰特|valorant/i.test(raw)) terms.push('舞台');
  if (/采访|花絮|幕后|behind/i.test(raw)) terms.push('花絮');
  if (/表演赛|明星赛|明星表演赛|开场前的明星/i.test(raw)) terms.push('表演赛');
  if (/总决赛|决赛|第二赛段|赛段/i.test(raw)) terms.push('总决赛');
  if (/比赛|赛场|进球|冠军|电竞|战队/i.test(raw)) terms.push('比赛');
  if (/外网|国外|海外|韩国|日本|美国|网友|评论/i.test(raw)) terms.push('外网热议');
  return uniqueList(terms, 3);
}

function scoreEntity(entity, text) {
  const raw = String(text || '');
  const value = String(entity || '');
  let score = 1;
  if (!value) return 0;
  if (ALL_ALIASES.some(item => item.value.toLowerCase() === value.toLowerCase())) score += 8;
  if (new RegExp(escapeRegExp(value), 'i').test(raw.slice(0, 260))) score += 3;
  if (new RegExp(escapeRegExp(value) + '.{0,12}(广告|同框|联动|比赛|热议|批评|冠军|归属|发射)|(?:广告|同框|联动|比赛|热议|批评|冠军|归属|发射).{0,12}' + escapeRegExp(value), 'i').test(raw)) score += 5;
  if (METAPHOR_TERMS.some(term => normalizeToken(term) === normalizeToken(value))) score -= 12;
  if (isGeneric(value)) score -= 8;
  return score;
}

function extractEntities(text, options) {
  const raw = String(text || '');
  const metaphors = findMetaphors(raw);
  const candidates = []
    .concat(extractAliasEntities(raw))
    .concat(extractConnectedEntities(raw))
    .concat(extractNamedTokens(raw))
    .filter(item => !metaphors.some(term => normalizeToken(term) === normalizeToken(item)));
  const ranked = uniqueList(candidates)
    .map(entity => ({ entity, score: scoreEntity(entity, raw) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entity.length - b.entity.length)
    .map(item => item.entity);
  const limit = options && options.entityLimit || 5;
  return uniqueList(ranked, limit);
}

function expandEntityAlternates(entities) {
  const out = [];
  (entities || []).forEach(entity => {
    out.push(entity);
    const alias = ALL_ALIASES.find(item => item.value.toLowerCase() === String(entity).toLowerCase());
    if (alias) out.push.apply(out, alias.alternates || []);
  });
  return uniqueList(out, 8);
}

function buildQueries(entities, intentTerms, text, options) {
  const source = sanitizeText(text);
  const cleanEntities = uniqueList(entities || [], 5);
  const cleanIntent = uniqueList(intentTerms || [], 3);
  const queries = [];
  if (cleanEntities.length >= 2) queries.push(uniqueList(cleanEntities.slice(0, 2).concat(cleanIntent.slice(0, 2)), 4).join(' '));
  if (cleanEntities.length) queries.push(uniqueList(cleanEntities.slice(0, 3).concat(cleanIntent.slice(0, 1)), 4).join(' '));

  const expanded = expandEntityAlternates(cleanEntities);
  if (expanded.length >= 2) queries.push(uniqueList(expanded.slice(0, 2).concat(cleanIntent.slice(0, 1)), 4).join(' '));

  const topical = [];
  (source.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || []).forEach(word => {
    const clean = cleanToken(word);
    if (!isGeneric(clean)) topical.push(clean);
  });
  if (!queries.length && topical.length) queries.push(uniqueList(topical, 4).join(' '));
  if (cleanEntities.length && cleanIntent.length) queries.push(uniqueList([cleanEntities[0], cleanIntent[0]], 3).join(' '));

  const exclude = options && options.excludeTerms || [];
  return uniqueList(queries.map(query => removeTerms(query, exclude)).filter(Boolean), options && options.queryLimit || 4);
}

function extractSearchIntent(text, options) {
  const raw = String(text || '');
  const metaphors = findMetaphors(raw);
  const excludeTerms = uniqueList([].concat(metaphors), 10);
  const entities = extractEntities(raw, options);
  const intentTerms = inferIntentTerms(raw);
  const queries = buildQueries(entities, intentTerms, raw, {
    excludeTerms,
    queryLimit: options && options.queryLimit || 4
  });
  const confidence = Math.min(1, (entities.length ? 0.48 : 0) + (intentTerms.length ? 0.24 : 0) + (queries.length ? 0.2 : 0));
  return {
    entities,
    intent_terms: intentTerms,
    metaphors,
    exclude_terms: excludeTerms,
    queries,
    query: queries[0] || '',
    confidence
  };
}

function mergeSceneIntent(sceneIntent, documentIntent) {
  const scene = sceneIntent || extractSearchIntent('');
  const doc = documentIntent || extractSearchIntent('');
  const entities = scene.entities.length
    ? scene.entities
    : (doc.confidence >= 0.65 ? doc.entities.slice(0, 3) : []);
  const intentTerms = scene.intent_terms.length ? scene.intent_terms : doc.intent_terms.slice(0, 2);
  const excludeTerms = uniqueList([].concat(scene.exclude_terms, doc.exclude_terms), 10);
  const queries = buildQueries(entities, intentTerms, '', { excludeTerms, queryLimit: 4 });
  return {
    entities,
    intent_terms: intentTerms,
    metaphors: uniqueList([].concat(scene.metaphors, doc.metaphors), 8),
    exclude_terms: excludeTerms,
    queries: queries.length ? queries : scene.queries,
    query: (queries[0] || scene.query || ''),
    confidence: Math.max(scene.confidence, doc.confidence * 0.85)
  };
}

module.exports = {
  METAPHOR_TERMS,
  GENERIC_TERMS,
  EXTRA_GENERIC_TERMS,
  cleanToken,
  removeTerms,
  uniqueList,
  extractSearchIntent,
  inferIntentTerms,
  mergeSceneIntent
};
