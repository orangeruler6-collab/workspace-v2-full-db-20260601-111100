const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');
let XLSX = null;
try {
  XLSX = require('xlsx');
} catch (err) {
  XLSX = null;
}

const logger = createLogger('routes:trafficPlanV2');

const GROUP_ACCOUNTS = [
  { groupName: '内容一组', members: ['许树杰', '许梦婷', '刘登魁', '许国锬', '叶进生', '高明镇', '薛荐轩', '叶颖'], accounts: ['花无缺', '葵仔不想肝', '最翁说游', '薛定谔的机', '跑腿的包子', '李野王SG', '游电工厂', '硬件侠', '素材'] },
  { groupName: '内容二组', members: ['傅思敏', '赵良杰', '陈乐恒', '吴恒', '李扬林', '施律彬', '罗晓棋'], accounts: ['痞仔伯爵', '暴走星号键', '雷鸭Fist', '报告砖家', '沙雕101', '灵梦小师妹', '网瘾少女一条', '素材'] },
  { groupName: '内容三组', members: ['曹媛', '陈泓睿', '林文涛', '刘佳琳', '肖子璇'], accounts: ['苏大强', '中二探长', '团子好贵', '嘿小虎', '饭十七', '皮皮说游戏', '素材'] },
  { groupName: '内容四组', members: ['姚希', '陈健伊', '宋丽佳', '林宇辰'], accounts: ['天机妹', '花蛮楼', '麦晓花', '夏天丶Cat', '有事找学姐', '小张同学', '素材'] },
  { groupName: '内容五组', members: ['朱信宇', '林心语', '商光涵', '杨鸿霆', '吴楷煌'], accounts: ['游小妹', '游热娃子', '超玩教授', 'Lee小强', '尼大木', '麦冬冬', '素材'] },
  { groupName: '内容六组', members: ['廖李星', '吴皓轩', '林孝添', '林语婷', '张碧珊', '叶子健'], accounts: ['不玩就分手', '游点慌', '游戏永动机', '畅玩百晓生', '夏洛', '游侠蹦蹦', '王路飞cp', '上官北丶', '情风师兄', '素材'] }
];

const PRICE_TABLES = [
  {
    platform: 'douyin',
    items: [
      { id: 'douyin-play-qianchuan-10w', service: 'play', name: '普通千川', unitPrice: 30, quantityUnit: '万', minimumQuantity: 1, priceTiers: [{ min: 1, max: 49, unitPrice: 30 }, { min: 50, unitPrice: 28 }] },
      { id: 'douyin-play-qianchuan-high-10w', service: 'play', name: '商业流', unitPrice: 48, quantityUnit: '万', minimumQuantity: 1 },
      { id: 'douyin-play-tech', service: 'play', name: '千川无视版(hkj)', unitPrice: 55, quantityUnit: '万', minimumQuantity: 3 },
      { id: 'douyin-like-tech', service: 'like', name: '黑科技', unitPrice: 20, quantityUnit: '千' },
      { id: 'douyin-like-qianchuan-1000', service: 'like', name: '千川', unitPrice: 110, quantityUnit: '千', minimumQuantity: 1 },
      { id: 'douyin-comment-custom', service: 'comment', name: '自定义', unitPrice: 1, quantityUnit: '个' },
      { id: 'douyin-favorite-standard', service: 'favorite', name: '默认', unitPrice: 0.1, quantityUnit: '个' },
      { id: 'douyin-share-standard', service: 'share', name: '默认', unitPrice: 0.2, quantityUnit: '个' },
      { id: 'douyin-douplus-default', service: 'douPlus', name: 'dou+', unitPrice: 1, quantityUnit: '元' }
    ]
  },
  {
    platform: 'bilibili',
    items: [
      { id: 'bilibili-play-default', service: 'play', name: '正常通道', unitPrice: 60, quantityUnit: '万' },
      { id: 'bilibili-play-fast', service: 'play', name: '快速通道', unitPrice: 180, quantityUnit: '万' },
      { id: 'bilibili-like-default', service: 'like', name: '默认', unitPrice: 30, quantityUnit: '千' },
      { id: 'bilibili-comment-custom', service: 'comment', name: '自定义', unitPrice: 0.7, quantityUnit: '个' },
      { id: 'bilibili-danmaku-custom', service: 'danmaku', name: '自定义', unitPrice: 0.15, quantityUnit: '个' },
      { id: 'bilibili-coin-default', service: 'coin', name: '默认', unitPrice: 0.2, quantityUnit: '个' },
      { id: 'bilibili-favorite-standard', service: 'favorite', name: '默认', unitPrice: 0.02, quantityUnit: '个' },
      { id: 'bilibili-share-standard', service: 'share', name: '默认', unitPrice: 0.02, quantityUnit: '个' },
      { id: 'bilibili-blue-link-default', service: 'blueLink', name: '默认', unitPrice: 0.8, quantityUnit: '个' }
    ]
  }
];

const DEFAULT_PRESETS = [
  {
    id: 'douyin-standard',
    platform: 'douyin',
    name: '抖音常规预设',
    targetCpm: 30,
    quantities: { play: 5, like: 1, comment: 50, favorite: 100, share: 50, douPlus: 0 }
  },
  {
    id: 'douyin-qianchuan',
    platform: 'douyin',
    name: '抖音千川预设',
    targetCpm: 30,
    quantities: { play: 10, like: 1, comment: 50, favorite: 100, share: 50, douPlus: 0 }
  },
  {
    id: 'bilibili-standard',
    platform: 'bilibili',
    name: 'B站常规预设',
    targetCpm: 60,
    quantities: { play: 5, danmaku: 50, comment: 50, like: 1, favorite: 1, coin: 50, share: 1, blueLink: 0 }
  }
];

let defaultAccountStandardsCache = null;

function findMaintenanceWorkbook() {
  const candidates = [
    path.join(process.cwd(), 'data', 'account-maintenance-standards.xlsx')
  ];
  return candidates.find(function(file) { return fs.existsSync(file); }) || '';
}

function listCandidateXlsxFiles() {
  const dirs = [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Documents')];
  const files = [];
  dirs.forEach(function(dir) {
    try {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir).forEach(function(name) {
        if (/\.xlsx$/i.test(name) && !/^~\$/.test(name)) files.push(path.join(dir, name));
      });
    } catch (err) {}
  });
  return files;
}

function findInquiryWorkbook() {
  const candidates = [
    path.join(os.homedir(), 'Desktop', '【内容事业部】自孵化账号询单信息.xlsx'),
    path.join(os.homedir(), 'Documents', '【内容事业部】自孵化账号询单信息.xlsx')
  ];
  listCandidateXlsxFiles().forEach(function(file) {
    if (/自孵化账号询单信息.*\.xlsx$/i.test(path.basename(file))) candidates.push(file);
  });
  const direct = candidates.find(function(file) { return fs.existsSync(file); });
  if (direct) return direct;
  if (!XLSX) return '';
  return listCandidateXlsxFiles().find(function(file) {
    try {
      const workbook = XLSX.readFile(file, { sheetRows: 8 });
      return workbook.SheetNames.some(function(sheetName) {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
        const flat = rows.flat().map(function(cell) { return cleanCell(cell); }).join('|');
        return /星图ID|抖音ID|抖音合作码|植入视频报价|定制视频报价/.test(flat);
      });
    } catch (err) {
      return false;
    }
  }) || '';
}

function inquiryKey(platform, accountName) {
  return [normalizePlatform(platform), normalizeText(accountName)].join('::');
}

function readInquiryAccountInfo() {
  const result = new Map();
  if (!XLSX) return result;
  const file = findInquiryWorkbook();
  if (!file) return result;
  try {
    const workbook = XLSX.readFile(file, { cellDates: true });
    const douyinSheet = workbook.Sheets['抖音'] || workbook.Sheets[workbook.SheetNames[0]];
    const bilibiliSheet = workbook.Sheets['B站'] || workbook.Sheets[workbook.SheetNames.find(function(name) { return /B站|bilibili/i.test(name); })];
    if (douyinSheet) {
      const rows = XLSX.utils.sheet_to_json(douyinSheet, { header: 1, defval: '' });
      rows.slice(4).forEach(function(row) {
        const accountName = cleanCell(row[0]);
        if (!accountName) return;
        result.set(inquiryKey('douyin', accountName), {
          accountName: accountName,
          platform: 'douyin',
          xingtuId: cleanCell(row[5]),
          douyinId: cleanCell(row[6]),
          accountId: cleanCell(row[6]) || cleanCell(row[7]),
          uid: cleanCell(row[7]),
          originalPrice: cellNumber(row[10]),
          quotePrice: cellNumber(row[10]),
          longOriginalPrice: cellNumber(row[11]),
          longQuotePrice: cellNumber(row[11]),
          directPrice: cellNumber(row[13]),
          homepageUrl: cleanCell(row[14]),
          freeDistributePlatforms: cleanCell(row[17]),
          authorizationScope: cleanCell(row[18]),
          retentionPeriod: cleanCell(row[19]),
          cooperationCode: cleanCell(row[22]),
          sourceInquiry: 'excel'
        });
      });
    }
    if (bilibiliSheet) {
      const rows = XLSX.utils.sheet_to_json(bilibiliSheet, { header: 1, defval: '' });
      rows.slice(1).forEach(function(row) {
        const accountName = cleanCell(row[0]);
        if (!accountName) return;
        result.set(inquiryKey('bilibili', accountName), {
          accountName: accountName,
          platform: 'bilibili',
          uid: cleanCell(row[5]),
          accountId: cleanCell(row[5]),
          originalPrice: cellNumber(row[7]),
          quotePrice: cellNumber(row[7]),
          customOriginalPrice: cellNumber(row[8]),
          customQuotePrice: cellNumber(row[8]),
          homepageUrl: cleanCell(row[12]),
          freeDistributePlatforms: cleanCell(row[14]),
          authorizationScope: cleanCell(row[15]),
          retentionPeriod: cleanCell(row[16]),
          sourceInquiry: 'excel'
        });
      });
    }
  } catch (err) {
    logger.warn('读取账号询单信息失败', err && err.message || err);
  }
  return result;
}

function mergeInquiryAccountInfo(standards) {
  const rows = Array.isArray(standards) ? standards : [];
  const inquiry = readInquiryAccountInfo();
  if (!inquiry.size) return rows;
  const matchedKeys = new Set();
  const mergedRows = rows.map(function(standard) {
    const platform = normalizePlatform(standard.platform);
    const info = inquiry.get(inquiryKey(platform, standard.accountName));
    if (!info) return standard;
    matchedKeys.add(inquiryKey(platform, info.accountName));
    return Object.assign({}, standard, {
      xingtuId: info.xingtuId || standard.xingtuId || '',
      douyinId: info.douyinId || standard.douyinId || '',
      accountId: info.accountId || standard.accountId || '',
      uid: info.uid || standard.uid || '',
      cooperationCode: info.cooperationCode || standard.cooperationCode || '',
      originalPrice: info.originalPrice || standard.originalPrice || standard.quotePrice || 0,
      quotePrice: standard.quotePrice || info.quotePrice || 0,
      longOriginalPrice: info.longOriginalPrice || standard.longOriginalPrice || standard.longQuotePrice || 0,
      longQuotePrice: standard.longQuotePrice || info.longQuotePrice || 0,
      customOriginalPrice: info.customOriginalPrice || standard.customOriginalPrice || standard.customQuotePrice || 0,
      customQuotePrice: standard.customQuotePrice || info.customQuotePrice || 0,
      directPrice: info.directPrice || standard.directPrice || 0,
      homepageUrl: info.homepageUrl || standard.homepageUrl || '',
      freeDistributePlatforms: info.freeDistributePlatforms || standard.freeDistributePlatforms || '',
      authorizationScope: info.authorizationScope || standard.authorizationScope || '',
      retentionPeriod: info.retentionPeriod || standard.retentionPeriod || '',
      sourceInquiry: info.sourceInquiry || standard.sourceInquiry || ''
    });
  });
  inquiry.forEach(function(info, key) {
    if (matchedKeys.has(key)) return;
    mergedRows.push(Object.assign({
      id: standardRowId(info.platform, info.accountName, 'inquiry'),
      source: 'inquiry'
    }, info));
  });
  return mergedRows;
}

function cellNumber(value) {
  return money(value);
}

function standardRowId(platform, accountName, index) {
  return ['standard', normalizePlatform(platform), slug(accountName || 'account'), index || 0].join('-');
}

function readGrossMarginAccountStandards() {
  const file = path.join(__dirname, '..', '..', 'data', 'style-library', 'gross-margin', 'accounts.json');
  if (!fs.existsSync(file)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (Array.isArray(rows) ? rows : []).map(function(row, index) {
      const platform = normalizePlatform(row.platform);
      const accountName = text(row.name || row.accountName);
      if (!accountName) return null;
      const defaultPrice = money(row.defaultPrice || row.quotePrice || row.originalPrice);
      const secondaryPrice = money(row.secondaryPrice || row.longQuotePrice || row.customQuotePrice);
      return {
        id: standardRowId(platform, accountName, 'gross-' + (index + 1)),
        platform: platform,
        accountName: accountName,
        xingtuId: text(row.xingtuId || row.xtId),
        douyinId: text(row.douyinId),
        accountId: text(row.douyinId || row.bilibiliUid || row.uid),
        uid: text(row.uid || row.bilibiliUid),
        cooperationCode: text(row.cooperationCode),
        originalPrice: defaultPrice,
        quotePrice: defaultPrice,
        longOriginalPrice: secondaryPrice,
        longQuotePrice: secondaryPrice,
        customOriginalPrice: secondaryPrice,
        customQuotePrice: secondaryPrice,
        homepageUrl: text(row.homepage || row.homepageUrl),
        source: 'gross-margin'
      };
    }).filter(Boolean);
  } catch (err) {
    logger.warn('璇诲彇鏁版嵁缁存姢璐﹀彿澶辫触', err && err.message || err);
    return [];
  }
}

function mergeAccountStandardRows(baseRows, extraRows) {
  const result = Array.isArray(baseRows) ? baseRows.slice() : [];
  (Array.isArray(extraRows) ? extraRows : []).forEach(function(extra) {
    const platform = normalizePlatform(extra.platform);
    const key = normalizeText(extra.accountName);
    if (!key) return;
    const index = result.findIndex(function(row) {
      return normalizePlatform(row.platform) === platform && normalizeText(row.accountName) === key;
    });
    if (index < 0) {
      result.push(extra);
      return;
    }
    const current = result[index] || {};
    result[index] = Object.assign({}, extra, current, {
      xingtuId: current.xingtuId || extra.xingtuId || '',
      douyinId: current.douyinId || extra.douyinId || '',
      accountId: current.accountId || extra.accountId || '',
      uid: current.uid || extra.uid || '',
      cooperationCode: current.cooperationCode || extra.cooperationCode || '',
      originalPrice: current.originalPrice || extra.originalPrice || 0,
      quotePrice: current.quotePrice || extra.quotePrice || 0,
      longOriginalPrice: current.longOriginalPrice || extra.longOriginalPrice || 0,
      longQuotePrice: current.longQuotePrice || extra.longQuotePrice || 0,
      customOriginalPrice: current.customOriginalPrice || extra.customOriginalPrice || 0,
      customQuotePrice: current.customQuotePrice || extra.customQuotePrice || 0,
      homepageUrl: current.homepageUrl || extra.homepageUrl || ''
    });
  });
  return result;
}

function readDefaultAccountStandards() {
  if (defaultAccountStandardsCache) return defaultAccountStandardsCache;
  defaultAccountStandardsCache = [];
  if (XLSX) {
    const file = findMaintenanceWorkbook();
    if (file) {
      try {
        const workbook = XLSX.readFile(file, { cellDates: true });
        const douyinSheet = workbook.SheetNames[0] && workbook.Sheets[workbook.SheetNames[0]];
        const bilibiliSheet = workbook.SheetNames[1] && workbook.Sheets[workbook.SheetNames[1]];
        if (douyinSheet) {
          const rows = XLSX.utils.sheet_to_json(douyinSheet, { header: 1, defval: '' });
          rows.slice(2).forEach(function(row, index) {
            const accountName = cleanCell(row[0]);
            if (!accountName) return;
            defaultAccountStandardsCache.push({
              id: standardRowId('douyin', accountName, index + 1),
              platform: 'douyin',
              accountName: accountName,
              fansWan: cellNumber(row[1]),
              quotePrice: cellNumber(row[2]),
              longQuotePrice: cellNumber(row[3]),
              discountLabel: cleanCell(row[4]),
              discountedPrice: cellNumber(row[5]),
              targetCpm: cellNumber(row[6]) || 30,
              metrics: {
                play: Math.round(cellNumber(row[7])),
                like: Math.round(cellNumber(row[8])),
                comment: Math.round(cellNumber(row[9])),
                favorite: Math.round(cellNumber(row[10])),
                share: Math.round(cellNumber(row[11]))
              },
              source: 'excel'
            });
          });
        }
        if (bilibiliSheet) {
          const rows = XLSX.utils.sheet_to_json(bilibiliSheet, { header: 1, defval: '' });
          rows.slice(2).forEach(function(row, index) {
            const accountName = cleanCell(row[0]);
            if (!accountName) return;
            defaultAccountStandardsCache.push({
              id: standardRowId('bilibili', accountName, index + 1),
              platform: 'bilibili',
              accountName: accountName,
              fansWan: cellNumber(row[1]),
              quotePrice: cellNumber(row[2]),
              customQuotePrice: cellNumber(row[3]),
              discountedPrice: cellNumber(row[4]),
              targetCpm: cellNumber(row[5]) || 150,
              metrics: {
                play: Math.round(cellNumber(row[6])),
                like: Math.round(cellNumber(row[7])),
                coin: Math.round(cellNumber(row[8])),
                favorite: Math.round(cellNumber(row[9])),
                comment: Math.round(cellNumber(row[10])),
                share: Math.round(cellNumber(row[11])),
                danmaku: Math.round(cellNumber(row[12])),
                blueLink: Math.round(cellNumber(row[13]))
              },
              source: 'excel'
            });
          });
        }
      } catch (err) {
        logger.warn('璇诲彇璐﹀彿缁存姢鏍囧噯澶辫触', err && err.message || err);
      }
    }
  }
  defaultAccountStandardsCache = mergeAccountStandardRows(defaultAccountStandardsCache, readGrossMarginAccountStandards());
  defaultAccountStandardsCache = mergeInquiryAccountInfo(defaultAccountStandardsCache);
  return defaultAccountStandardsCache;
}
function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function text(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

function num(value) {
  if (typeof value === 'string') {
    const raw = value.replace(/,/g, '').trim();
    if (!raw) return 0;
    const match = raw.match(/(-?\d+(?:\.\d+)?)\s*([万千wWkK]?)/);
    if (match) {
      const base = Number(match[1]);
      if (!Number.isFinite(base)) return 0;
      const unit = match[2];
      if (unit === '万' || unit === 'w' || unit === 'W') return Math.round(base * 10000);
      if (unit === '千' || unit === 'k' || unit === 'K') return Math.round(base * 1000);
      return base;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function cleanCell(value) {
  return text(value).replace(/^\uFEFF/, '').replace(/\t/g, '').trim();
}

function parseCsv(textValue) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(textValue || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(cleanCell(cell));
      cell = '';
      continue;
    }
    if (char === '\n') {
      row.push(cleanCell(cell));
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (char !== '\r') cell += char;
  }
  if (cell || row.length) {
    row.push(cleanCell(cell));
    rows.push(row);
  }
  return rows.filter(function(item) {
    return item.some(function(cellValue) { return cleanCell(cellValue); });
  });
}

function decodeCsvBuffer(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (raw.length >= 2 && raw[0] === 0xFF && raw[1] === 0xFE) return raw.toString('utf16le');
  if (raw.length >= 2 && raw[0] === 0xFE && raw[1] === 0xFF) return Buffer.from(raw).swap16().toString('utf16le');
  return raw.toString('utf8');
}

function firstField(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && cleanCell(row[name])) return cleanCell(row[name]);
  }
  const normalized = Object.keys(row).find(function(key) {
    return names.some(function(name) { return normalizeText(key) === normalizeText(name); });
  });
  return normalized ? cleanCell(row[normalized]) : '';
}

function firstNumber(row, names) {
  return num(firstField(row, names));
}

function jsonValue(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (e) {
    fallback.localFallback = true;
    return fallback;
  }
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

function generatedId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function slug(value) {
  return normalizeText(value).replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 42) || 'item';
}

function userKey(body) {
  return 'traffic-plan-v2';
}

function groupFromUser(body) {
  const auth = body && body._auth || {};
  if (body && body.allGroups) return '';
  if (body && Object.prototype.hasOwnProperty.call(body, 'groupName')) return normalizeGroupName(body.groupName);
  if (body && Object.prototype.hasOwnProperty.call(body, 'group')) return normalizeGroupName(body.group);
  return normalizeGroupName(body && (body.groupName || body.group) || auth.group_name || auth.group || auth.groupName || inferGroup(auth.display_name || auth.username || auth.real_name));
}

function normalizeGroupName(value) {
  const group = text(value);
  if (!group || group === '全部' || group === '未分组') return '';
  return group;
}

function inferGroup(name) {
  const key = normalizeText(name);
  if (!key) return '';
  const found = GROUP_ACCOUNTS.find(function(group) {
    return group.members.some(function(member) { return normalizeText(member) === key; });
  });
  return found ? found.groupName : '';
}

function accountGroup(accountName) {
  const key = normalizeText(accountName);
  const found = GROUP_ACCOUNTS.find(function(group) {
    return group.accounts.some(function(account) { return normalizeText(account) === key; });
  });
  return found ? found.groupName : '';
}

function normalizePlatform(value) {
  const raw = text(value).toLowerCase();
  if (/b站|bilibili|哔哩/.test(raw)) return 'bilibili';
  if (/抖音|douyin/.test(raw)) return 'douyin';
  return raw || 'douyin';
}

function defaultTargetCpm(platform) {
  return normalizePlatform(platform) === 'bilibili' ? 150 : 30;
}

function platformLabel(platform) {
  return normalizePlatform(platform) === 'bilibili' ? 'B站' : '抖音';
}

function extractProjectName(raw) {
  const textValue = text(raw);
  const patterns = [
    /(?:项目|产品|合作产品|标的|游戏)\s*[：:]\s*([^\n\r；;]+)/i,
    /项目[：:]\s*《?([^》\n\r]+)》?/i,
    /《([^》]+)》/
  ];
  for (const pattern of patterns) {
    const match = textValue.match(pattern);
    if (match && text(match[1])) return text(match[1]).replace(/[；;。].*$/, '');
  }
  return '未命名项目';
}

function extractPlatform(raw) {
  const match = text(raw).match(/(?:平台|合作平台)\s*[：:]\s*([^\n\r]+)/i);
  return normalizePlatform(match && match[1] || raw);
}

function normalizeDate(value) {
  const raw = text(value);
  const match = raw.match(/(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (!match) return raw.replace(/日/g, '').slice(0, 20);
  return [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
}

function extractDefaultSchedule(raw) {
  const match = text(raw).match(/(?:档期|推广档期)\s*[：:]\s*([^\n\r]+)/);
  if (match && text(match[1])) return normalizeDate(match[1]);
  const any = text(raw).match(/20\d{2}[.\-/年]\d{1,2}[.\-/月]\d{1,2}/);
  return any ? normalizeDate(any[0]) : '';
}

function extractCpm(raw) {
  const patterns = [
    /cpm\s*([0-9]+(?:\.\d+)?)/i,
    /CPM\s*([0-9]+(?:\.\d+)?)/,
    /保\s*cpm\s*([0-9]+(?:\.\d+)?)/i,
    /保量[^\n\r]*?([0-9]+(?:\.\d+)?)/
  ];
  for (const pattern of patterns) {
    const match = text(raw).match(pattern);
    if (match) return money(match[1]);
  }
  return 0;
}

function splitNames(value) {
  return text(value)
    .replace(/[、，,；;]/g, '、')
    .split('、')
    .map(function(item) { return text(item).replace(/^【|】$/g, ''); })
    .filter(Boolean);
}

function cleanAccountName(value) {
  return text(value)
    .replace(/^【|】$/g, '')
    .replace(/\s+/g, '')
    .replace(/\d+\s*[-~－—]\s*\d+\s*s.*$/i, '')
    .replace(/(?:B站定制|bilibili定制|定制视频|定制报价|定制|植入视频|图文|视频|报价|合作价|折扣|实际合作|合作金额|金额|价格).*$/i, '')
    .replace(/[：:]+$/g, '');
}

function cleanAmountAccountName(value) {
  const raw = text(value);
  const known = findKnownAccountInText(raw);
  if (known) return known;
  return cleanAccountName(
    raw
      .split(/[，,：:]/)[0]
      .replace(/^\s*\d+[、.．]\s*/, '')
      .replace(/(?:抖音|快手|小红书|B站|bilibili)?(?:定制视频|定制报价|定制|植入视频|\d+\s*-\s*\d+\s*秒|21\s*-\s*60s|60s\+|60秒\+|平台报价|报价|合作价|对客返点|对客折扣|实际合作金额|实际合作价格|合作金额|金额).*$/i, '')
  );
}

function knownAccounts() {
  const map = new Map();
  GROUP_ACCOUNTS.forEach(function(group) {
    (group.accounts || []).forEach(function(account) {
      const key = normalizeText(account);
      if (key && key !== normalizeText('绱犳潗')) map.set(key, account);
    });
  });
  readDefaultAccountStandards().forEach(function(row) {
    const name = text(row && row.accountName);
    const key = normalizeText(name);
    if (key) map.set(key, name);
  });
  return Array.from(map.values()).sort(function(a, b) {
    return normalizeText(b).length - normalizeText(a).length;
  });
}

function findKnownAccountInText(value) {
  const key = normalizeText(value);
  if (!key) return '';
  const found = knownAccounts().find(function(account) {
    const accountKey = normalizeText(account);
    return accountKey && key.indexOf(accountKey) >= 0;
  });
  return found || '';
}

function compactAccountName(value) {
  let name = text(value).replace(/\s+/g, '');
  if (!name) return '';
  name = name
    .replace(/^[\d.,\uFF0C\u3001:\uFF1A;\uFF1B\-\s]+/g, '')
    .replace(/^(?:(?:\u0042\u7ad9|bilibili|\u54d4\u54e9\u54d4\u54e9|\u5b9a\u5236|\u89c6\u9891|\u56fe\u6587|\u8fbe\u4eba|\u8d26\u53f7|\u8d26\u53f7\u540d|\u8d39\u7528|\u62a5\u4ef7|\u91d1\u989d|\u4ef7\u683c|:|\uFF1A))+\/?/iu, '');
  const amountMatch = name.match(/[\uFFE5\u00A5]?\d[\d,.]*(?:\s*(?:\u5143|\u5757|\u4e07|w|W)|\s*\*)/iu);
  if (amountMatch && amountMatch.index > 0) name = name.slice(0, amountMatch.index);
  name = name
    .replace(/(?:\u0042\u7ad9|bilibili|\u54d4\u54e9\u54d4\u54e9|\u5b9a\u5236|\u89c6\u9891|\u56fe\u6587|\u62a5\u4ef7|\u5e73\u53f0\u62a5\u4ef7|\u5bf9\u5ba2\u8fd4\u70b9|\u5bf9\u5ba2\u6298\u6263|\u5b9e\u9645\u5408\u4f5c(?:\u91d1\u989d|\u4ef7\u683c)?|\u5408\u4f5c\u91d1\u989d|\u91d1\u989d|\u4ef7\u683c|\u6298\u6263|\u8fd4\u5229|\u8fd4\u70b9).*$/iu, '')
    .replace(/[.,\uFF0C\u3001:\uFF1A;\uFF1B\-]+$/g, '');
  return name || text(value);
}

function canonicalAccountName(name, candidates) {
  const key = normalizeText(name);
  if (!key) return '';
  const known = findKnownAccountInText(name);
  if (known) return known;
  const pool = (Array.isArray(candidates) ? candidates : [])
    .map(text)
    .filter(Boolean)
    .sort(function(a, b) { return normalizeText(a).length - normalizeText(b).length; });
  const contained = pool.find(function(candidate) {
    const candidateKey = normalizeText(candidate);
    return candidateKey && candidateKey !== key && key.indexOf(candidateKey) >= 0;
  });
  return contained || name;
}

function normalizedParsedAccountName(name, candidates) {
  const known = findKnownAccountInText(name);
  if (known) return known;
  const compact = compactAccountName(canonicalAccountName(name, candidates));
  const key = normalizeText(compact);
  if (!key) return text(name);
  const contained = (Array.isArray(candidates) ? candidates : [])
    .map(function(candidate) { return compactAccountName(candidate); })
    .filter(Boolean)
    .sort(function(a, b) { return normalizeText(a).length - normalizeText(b).length; })
    .find(function(candidate) {
      const candidateKey = normalizeText(candidate);
      return candidateKey && candidateKey !== key && key.indexOf(candidateKey) >= 0;
  });
  return contained || compact;
}

function cleanTrafficAccountName(value) {
  const known = findKnownAccountInText(value);
  if (known) return known;
  return cleanAccountName(compactAccountName(value));
}

function extractTalentNames(raw) {
  const source = text(raw);
  const match = source.match(/(?:达人|达人昵称)\s*[：:]\s*([^\n\r]+)/);
  const names = match ? splitNames(match[1]).map(function(name) {
    return cleanAccountName(name);
  }).filter(Boolean) : [];
  knownAccounts().forEach(function(account) {
    if (normalizeText(source).indexOf(normalizeText(account)) >= 0 &&
      !names.some(function(name) { return normalizeText(name) === normalizeText(account); })) {
      names.push(account);
    }
  });
  return names;
}

function extractAccountSchedules(raw) {
  const schedules = {};
  text(raw).split(/\r?\n/).forEach(function(line) {
    const dateMatch = line.match(/(20\d{2}[.\-/年]\d{1,2}[.\-/月]\d{1,2})/);
    if (!dateMatch) return;
    const date = normalizeDate(dateMatch[1]);
    splitNames(line.replace(dateMatch[0], '').replace(/^[-：:\s]+/, '')).forEach(function(name) {
      schedules[name] = date;
    });
    const single = line.match(/([\u4e00-\u9fa5A-Za-z0-9丶._-]+)\s*[-:：]\s*20\d{2}/);
    if (single) schedules[text(single[1])] = date;
  });
  return schedules;
}

function extractAmounts(raw) {
  const map = new Map();
  text(raw).split(/\r?\n/).forEach(function(line) {
    const clean = text(line);
    if (!clean || !/(元|报价|金额|价格|折扣|返点|\*)/.test(clean)) return;
    const name = cleanAmountAccountName(clean);
    if (!name) return;
    const expr = clean.match(/([0-9][\d,.]*)\s*\*\s*([0-9](?:\.\d+)?)/);
    const allMoney = Array.from(clean.matchAll(/([0-9][\d,.]*)\s*元/g)).map(function(match) { return money(match[1]); }).filter(Boolean);
    const original = expr ? money(expr[1]) : (allMoney[0] || 0);
    const rebate = clean.match(/(?:返点|返利)\s*([0-9]+(?:\.\d+)?)\s*%/);
    const discount = clean.match(/(?:折扣|对客折扣)\s*([0-9]+(?:\.\d+)?)\s*%/);
    const discountRate = expr
      ? Math.round(Number(expr[2]) * 10000) / 100
      : rebate
        ? Math.round((100 - Number(rebate[1])) * 100) / 100
        : discount
          ? Math.round(Number(discount[1]) * 100) / 100
          : 0;
    let discounted = allMoney.length > 1 ? allMoney[allMoney.length - 1] : 0;
    if (!discounted && expr) discounted = money(Number(String(expr[1]).replace(/,/g, '')) * Number(expr[2]));
    if (!discounted && original && discountRate) discounted = money(original * discountRate / 100);
    if (!discounted && allMoney.length) discounted = allMoney[allMoney.length - 1];
    if (name && (original || discounted)) {
      const next = {
        accountName: name,
        originalPrice: original || discounted,
        discountRate: discountRate || (original ? Math.round(discounted / original * 10000) / 100 : 100),
        discountedPrice: discounted || original
      };
      const key = normalizeText(name);
      map.set(key, mergeAccountAmount(map.get(key), next));
    }
  });
  return map;
}

function mergeAccountAmount(existing, incoming) {
  if (!existing) return incoming;
  return {
    accountName: existing.accountName || incoming.accountName,
    originalPrice: money(incoming.originalPrice || existing.originalPrice || 0),
    discountRate: money(incoming.discountRate || existing.discountRate || 0),
    discountedPrice: money(incoming.discountedPrice || existing.discountedPrice || 0)
  };
}

function pickAccountDisplayName(a, b) {
  const knownA = findKnownAccountInText(a);
  const knownB = findKnownAccountInText(b);
  if (knownA) return knownA;
  if (knownB) return knownB;
  const cleanA = compactAccountName(a);
  const cleanB = compactAccountName(b);
  const keyA = normalizeText(cleanA);
  const keyB = normalizeText(cleanB);
  if (keyA && keyB && keyA !== keyB) {
    if (keyA.indexOf(keyB) >= 0) return cleanB;
    if (keyB.indexOf(keyA) >= 0) return cleanA;
  }
  return keyA.length <= keyB.length ? cleanA : cleanB;
}

function mergeParsedAccounts(accounts, schedules, defaultScheduleDate, targetCpm) {
  const merged = [];
  accounts.forEach(function(account) {
    const displayName = pickAccountDisplayName(account.accountName, account.accountName);
    const displayKey = normalizeText(displayName);
    const index = merged.findIndex(function(item) {
      const itemKey = normalizeText(pickAccountDisplayName(item.accountName, displayName));
      return itemKey && displayKey && (
        itemKey === displayKey ||
        itemKey.indexOf(displayKey) >= 0 ||
        displayKey.indexOf(itemKey) >= 0
      );
    });
    const normalized = Object.assign({}, account, {
      accountName: displayName,
      scheduleDate: account.scheduleDate || schedules[displayName] || schedules[displayKey] || defaultScheduleDate
    });
    if (index < 0) {
      merged.push(normalized);
      return;
    }
    const previous = merged[index];
    const accountName = pickAccountDisplayName(previous.accountName, normalized.accountName);
    const originalPrice = money(normalized.originalPrice || previous.originalPrice || 0);
    const discountedPrice = money(normalized.discountedPrice || previous.discountedPrice || 0);
    merged[index] = Object.assign({}, previous, normalized, {
      accountName: accountName,
      accountGroup: accountGroup(accountName) || previous.accountGroup || normalized.accountGroup,
      scheduleDate: previous.scheduleDate || normalized.scheduleDate,
      originalPrice: originalPrice || discountedPrice,
      discountRate: money(normalized.discountRate || previous.discountRate || (originalPrice && discountedPrice ? discountedPrice / originalPrice * 100 : 100)),
      discountedPrice: discountedPrice,
      targetPlay: targetCpm && discountedPrice ? Math.round(discountedPrice / targetCpm * 1000) : (normalized.targetPlay || previous.targetPlay || 0)
    });
  });
  return merged;
}

function hasParsedAccountPrice(account) {
  return money(account && account.originalPrice) > 0 || money(account && account.discountedPrice) > 0;
}

function uniquePricedAccounts(accounts) {
  const map = new Map();
  (Array.isArray(accounts) ? accounts : []).filter(hasParsedAccountPrice).forEach(function(account) {
    const key = normalizeText(account && account.accountName);
    if (!key) return;
    map.set(key, mergeParsedAccounts([map.get(key), account].filter(Boolean), {}, '', money(account && account.targetCpm))[0]);
  });
  return Array.from(map.values()).filter(hasParsedAccountPrice);
}

function normalizeParsedAccountForSave(account, candidates) {
  const accountName = normalizedParsedAccountName(account && (account.accountName || account.name), candidates);
  const discountedPrice = money(account && (account.discountedPrice || account.amount || account.price));
  const originalPrice = money(account && (account.originalPrice || discountedPrice));
  if (!accountName || !discountedPrice || !originalPrice) return null;
  const discountRate = money(account && (account.discountRate || (originalPrice ? discountedPrice / originalPrice * 100 : 100)));
  return Object.assign({}, account, {
    accountName: accountName,
    originalPrice: originalPrice,
    discountRate: discountRate,
    discountedPrice: discountedPrice
  });
}

function accountStandardFor(accountName, platform) {
  return findAccountStandardInRows(readDefaultAccountStandards(), accountName, platform);
}

function findAccountStandardInRows(standards, accountName, platform) {
  const key = normalizeText(accountName);
  const platformKey = normalizePlatform(platform);
  if (!key) return null;
  const rows = (Array.isArray(standards) ? standards : []).filter(function(standard) {
    return normalizePlatform(standard.platform) === platformKey;
  });
  return rows.find(function(standard) { return normalizeText(standard.accountName) === key; })
    || rows.find(function(standard) {
      const standardKey = normalizeText(standard.accountName);
      return standardKey && (key.indexOf(standardKey) >= 0 || standardKey.indexOf(key) >= 0);
    })
    || null;
}

function identityText(value) {
  const raw = text(value);
  if (!raw || raw === '待补' || raw === '/' || raw === '-') return '';
  return raw;
}

function fieldIdentityText(field, platform, value) {
  const raw = identityText(value);
  if (!raw) return '';
  if (isSuspiciousIdentityValue(field, platform, raw)) return '';
  return raw;
}

function isSuspiciousIdentityValue(field, platform, value) {
  const raw = text(value);
  if (/^\d+\.\d+$/.test(raw)) return true;
  if (!/^\d+$/.test(raw)) return false;
  if (field === 'xingtuId' || field === 'uid' || field === 'cooperationCode') return raw.length < 8;
  if ((field === 'douyinId' || field === 'accountId') && normalizePlatform(platform) === 'douyin') return raw.length <= 3;
  return false;
}

function firstIdentityText(field, platform) {
  for (let i = 2; i < arguments.length; i += 1) {
    const value = fieldIdentityText(field, platform, arguments[i]);
    if (value) return value;
  }
  return '';
}

function enrichAccountIdentity(input, standards) {
  if (!input) return null;
  const item = Object.assign({}, input || {});
  const standard = findAccountStandardInRows(
    standards || readDefaultAccountStandards(),
    item.accountName,
    item.platform
  ) || {};
  const platform = normalizePlatform(item.platform);
  const douyinId = firstIdentityText('douyinId', platform, item.douyinId, item.accountId, standard.douyinId, standard.accountId);
  const accountId = firstIdentityText('accountId', platform, item.accountId, item.douyinId, standard.accountId, standard.douyinId);
  return Object.assign({}, item, {
    xingtuId: firstIdentityText('xingtuId', platform, item.xingtuId, standard.xingtuId),
    douyinId: douyinId,
    accountId: accountId,
    uid: firstIdentityText('uid', platform, item.uid, standard.uid),
    cooperationCode: firstIdentityText('cooperationCode', platform, item.cooperationCode, standard.cooperationCode)
  });
}

function resolveApplicationIdentity(execution, app, standards) {
  const executionSource = execution || {};
  const appSource = app || {};
  const platform = normalizePlatform(appSource.platform || executionSource.platform);
  return enrichAccountIdentity({
    accountName: cleanTrafficAccountName(appSource.accountName || executionSource.accountName),
    platform: platform,
    xingtuId: firstIdentityText('xingtuId', platform, executionSource.xingtuId, appSource.xingtuId),
    douyinId: firstIdentityText('douyinId', platform, executionSource.douyinId, executionSource.accountId, appSource.douyinId, appSource.accountId),
    accountId: firstIdentityText('accountId', platform, executionSource.accountId, executionSource.douyinId, appSource.accountId, appSource.douyinId),
    uid: firstIdentityText('uid', platform, executionSource.uid, appSource.uid),
    cooperationCode: firstIdentityText('cooperationCode', platform, executionSource.cooperationCode, appSource.cooperationCode)
  }, standards) || {};
}

function accountStandardTargetPlay(accountName, platform) {
  const standard = accountStandardFor(accountName, platform);
  return Math.round(num(standard && standard.metrics && standard.metrics.play));
}

function resolveTargetPlay(account, accountName, platform, discountedPrice, targetCpm) {
  return Math.round(
    num(account && account.targetPlay) ||
    num(account && account.targetMetrics && account.targetMetrics.play) ||
    accountStandardTargetPlay(accountName, platform) ||
    (targetCpm && discountedPrice ? discountedPrice / targetCpm * 1000 : 0)
  );
}

function parseProjectText(rawText, fallbackGroup) {
  const raw = text(rawText);
  const projectName = extractProjectName(raw);
  const platform = extractPlatform(raw);
  const targetCpm = extractCpm(raw);
  const scheduleDate = extractDefaultSchedule(raw);
  const names = [];
  extractTalentNames(raw).forEach(function(name) {
    const known = findKnownAccountInText(name) || name;
    if (known && !names.some(function(item) { return normalizeText(item) === normalizeText(known); })) names.push(known);
  });
  const schedules = extractAccountSchedules(raw);
  const amounts = extractAmounts(raw);
  const amountNames = [];
  amounts.forEach(function(item) {
    const canonical = canonicalAccountName(item.accountName, names);
    if (!names.some(function(name) { return normalizeText(name) === normalizeText(canonical); })) {
      names.push(canonical);
    }
    if (!amountNames.some(function(name) { return normalizeText(name) === normalizeText(canonical); })) {
      amountNames.push(canonical);
    }
  });
  const canonicalAmountMap = new Map();
  amounts.forEach(function(item) {
    const canonical = canonicalAccountName(item.accountName, names);
    const key = normalizeText(canonical);
    if (key) canonicalAmountMap.set(key, mergeAccountAmount(canonicalAmountMap.get(key), Object.assign({}, item, { accountName: canonical })));
  });
  const uniqueNames = Array.from(new Map(amountNames.map(function(name) {
    const canonical = canonicalAccountName(name, names);
    return [normalizeText(canonical), canonical];
  })).values());
  let accounts = uniqueNames.map(function(name) {
    const amount = canonicalAmountMap.get(normalizeText(name)) || {};
    const group = accountGroup(name) || fallbackGroup || '未分组';
    const discountedPrice = money(amount.discountedPrice || 0);
    return {
      accountName: name,
      accountGroup: group,
      platform: platform,
      scheduleDate: schedules[name] || schedules[normalizeText(name)] || scheduleDate,
      originalPrice: money(amount.originalPrice || discountedPrice),
      discountRate: money(amount.discountRate || (amount.originalPrice && discountedPrice ? discountedPrice / amount.originalPrice * 100 : 100)),
      discountedPrice: discountedPrice,
      targetCpm: targetCpm,
      targetPlay: targetCpm && discountedPrice ? Math.round(discountedPrice / targetCpm * 1000) : 0
    };
  });
  accounts = uniquePricedAccounts(mergeParsedAccounts(accounts, schedules, scheduleDate, targetCpm));
  return {
    projectName: projectName,
    platform: platform,
    scheduleDate: scheduleDate,
    targetCpm: targetCpm,
    accounts: accounts,
    warnings: accounts.length ? [] : ['没有解析到达人账号，请检查“达人：”或“费用：”格式。']
  };
}

function metricKeys(platform) {
  return normalizePlatform(platform) === 'bilibili'
    ? ['play', 'danmaku', 'comment', 'like', 'favorite', 'coin', 'share', 'blueLink']
    : ['play', 'like', 'comment', 'favorite', 'share'];
}

function emptyMetrics() {
  return { play: 0, like: 0, comment: 0, favorite: 0, share: 0, danmaku: 0, coin: 0, blueLink: 0 };
}

function latestCrmCsvFile(body) {
  const options = arguments[1] || {};
  const explicitPath = text(body && (body.csvPath || body.path || body.filePath));
  if (explicitPath && fs.existsSync(explicitPath)) {
    const stat = fs.statSync(explicitPath);
    return { path: explicitPath, name: path.basename(explicitPath), size: stat.size, mtimeMs: stat.mtimeMs, explicit: true };
  }
  if (explicitPath) return null;
  const dirs = Array.isArray(options.dirs) && options.dirs.length ? options.dirs : [
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Desktop')
  ];
  const maxAgeMs = num(options.maxAgeMs || body && body.fallbackMaxAgeMs) || 30 * 60 * 1000;
  const requireFresh = options.requireFresh !== false;
  const now = Date.now();
  const files = [];
  dirs.forEach(function(dir) {
    try {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
        if (!entry.isFile() || !/\.csv$/i.test(entry.name)) return;
        if (!/(达人执行效果列表|执行效果|crm|CRM)/.test(entry.name)) return;
        const fullPath = path.join(dir, entry.name);
        const stat = fs.statSync(fullPath);
        if (requireFresh && now - stat.mtimeMs > maxAgeMs) return;
        files.push({ path: fullPath, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs });
      });
    } catch (e) {}
  });
  files.sort(function(a, b) { return b.mtimeMs - a.mtimeMs; });
  return files[0] || null;
}

function cleanupCrmDownloadDir(dir) {
  const keep = 8;
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter(function(entry) {
      return entry.isFile() && /\.csv$/i.test(entry.name);
    }).map(function(entry) {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      return { path: fullPath, mtimeMs: stat.mtimeMs };
    }).sort(function(a, b) { return b.mtimeMs - a.mtimeMs; });
    files.slice(keep).forEach(function(file) {
      try { fs.unlinkSync(file.path); } catch (err) {}
    });
  } catch (err) {}
}

const CRM_EXPORT_URL = process.env.TRAFFIC_CRM_URL || 'https://erp.changwankeji.com:8188/dist/index.html?v=1779969316#/crmexection/list?atype=one&ptype=0&menuid=670&path=crmexection/list';

function crmRuntimePath(name) {
  const dir = path.join(process.cwd(), '.runtime', name);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (err) {}
  return dir;
}

function pythonExecutable() {
  const local = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
  return fs.existsSync(local) ? local : 'python';
}

function closeBusyCrmProfile(profileDir) {
  if (process.platform !== 'win32') return { ok: true, skipped: true };
  const profile = text(profileDir);
  if (!profile) return { ok: true, skipped: true };
  const profileLiteral = profile.replace(/'/g, "''");
  const script = [
    "$profile = '" + profileLiteral + "'",
    "$profileName = 'crm-chrome-profile'",
    "$items = Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" | Where-Object { $_.CommandLine -and ($_.CommandLine.Contains($profile) -or $_.CommandLine.Contains($profileName)) }",
    "$count = 0",
    "foreach ($item in $items) { $count += 1; $p = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { $null = $p.CloseMainWindow() } }",
    "if ($count -gt 0) { Start-Sleep -Milliseconds 1800 }",
    "Write-Output $count"
  ].join('; ');
  try {
    const result = childProcess.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true
    });
    return { ok: result.status === 0, closed: num(result.stdout), error: result.stderr || '' };
  } catch (err) {
    return { ok: false, closed: 0, error: err.message || String(err) };
  }
}

function downloadCrmCsv(body) {
  return new Promise(function(resolve) {
    const script = path.join(process.cwd(), 'scripts', 'crm_export_csv.py');
    if (!fs.existsSync(script)) {
      resolve({ ok: false, error: 'CRM 自动下载脚本不存在' });
      return;
    }
    const downloadDir = text(body && body.downloadDir) || crmRuntimePath('crm-downloads');
    const profileDir = text(body && body.profileDir) || process.env.TRAFFIC_CRM_PROFILE_DIR || crmRuntimePath('crm-chrome-profile');
    const chrome = text(body && body.chromePath) || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const closeResult = closeBusyCrmProfile(profileDir);
    const args = [
      script,
      '--url', text(body && body.crmUrl) || CRM_EXPORT_URL,
      '--profile', profileDir,
      '--download-dir', downloadDir,
      '--chrome', chrome
    ];
    if (body && body.headed) args.push('--headed');
    const child = childProcess.spawn(pythonExecutable(), args, {
      cwd: process.cwd(),
      windowsHide: !(body && body.headed)
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', function(chunk) { stdout += chunk.toString(); });
    child.stderr.on('data', function(chunk) { stderr += chunk.toString(); });
    child.on('close', function(code) {
      let parsed = null;
      try { parsed = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '{}'); } catch (err) {}
      if (parsed && parsed.ok) {
        resolve(Object.assign({ code: code, closeProfile: closeResult }, parsed));
        return;
      }
      resolve(Object.assign({
        ok: false,
        code: code,
        error: parsed && parsed.error || stderr.trim() || stdout.trim() || 'CRM 自动下载失败'
      }, parsed || {}, { closeProfile: closeResult }));
    });
    child.on('error', function(err) {
      resolve({ ok: false, error: err.message || String(err) });
    });
  });
}

function captureCrmLoginScreenshot(body) {
  return new Promise(function(resolve) {
    const script = path.join(process.cwd(), 'scripts', 'crm_login_screenshot.py');
    if (!fs.existsSync(script)) {
      resolve({ ok: false, error: 'CRM login screenshot script is missing' });
      return;
    }
    const profileDir = text(body && body.profileDir) || process.env.TRAFFIC_CRM_PROFILE_DIR || crmRuntimePath('crm-chrome-profile');
    const screenshotDir = crmRuntimePath('crm-login-screenshots');
    const screenshotPath = path.join(screenshotDir, 'crm-login-' + Date.now() + '.png');
    const chrome = text(body && body.chromePath) || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const port = num(body && body.port) || 9223;
    closeBusyCrmProfile(profileDir);
    const args = [
      script,
      '--url', text(body && body.crmUrl) || CRM_EXPORT_URL,
      '--profile', profileDir,
      '--screenshot', screenshotPath,
      '--chrome', chrome,
      '--port', String(port)
    ];
    const child = childProcess.spawn(pythonExecutable(), args, {
      cwd: process.cwd(),
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', function(chunk) { stdout += chunk.toString(); });
    child.stderr.on('data', function(chunk) { stderr += chunk.toString(); });
    child.on('close', function(code) {
      let parsed = null;
      try { parsed = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '{}'); } catch (err) {}
      if (!parsed || parsed.ok === false) {
        resolve(Object.assign({
          ok: false,
          code: code,
          error: parsed && parsed.error || stderr.trim() || stdout.trim() || 'CRM login screenshot failed'
        }, parsed || {}));
        return;
      }
      try {
        const image = fs.readFileSync(parsed.path);
        resolve(Object.assign({}, parsed, {
          imageDataUrl: 'data:image/png;base64,' + image.toString('base64'),
          profileDir: profileDir
        }));
      } catch (err) {
        resolve(Object.assign({}, parsed, { ok: false, error: err.message || String(err) }));
      }
    });
    child.on('error', function(err) {
      resolve({ ok: false, error: err.message || String(err) });
    });
  });
}

async function prepareCrmCsvFile(body) {
  const explicitPath = text(body && (body.csvPath || body.path || body.filePath));
  if (explicitPath) {
    const explicit = latestCrmCsvFile(body || {});
    return explicit || { failed: true, error: 'Selected CRM CSV file does not exist: ' + explicitPath };
  }
  if (body && body.skipDownload) {
    const downloadDir = text(body && body.downloadDir) || crmRuntimePath('crm-downloads');
    const cached = latestCrmCsvFile(body || {}, { dirs: [downloadDir], requireFresh: true });
    if (cached) {
      cached.cachedDownload = true;
      return cached;
    }
    if (body && body.allowLocalFallback) {
      const fallback = latestCrmCsvFile(body || {}, { requireFresh: true });
      if (fallback) {
        fallback.localFallback = true;
        return fallback;
      }
    }
    return { failed: true, error: 'No fresh CRM CSV is available. Please run CRM refresh again or choose a CSV file explicitly.' };
  }
  const downloaded = await downloadCrmCsv(body || {});
  if (downloaded && downloaded.ok && downloaded.path) {
    const stat = fs.statSync(downloaded.path);
    cleanupCrmDownloadDir(path.dirname(downloaded.path));
    return {
      path: downloaded.path,
      name: path.basename(downloaded.path),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      downloaded: downloaded
    };
  }
  const fallback = latestCrmCsvFile(body || {}, { requireFresh: true });
  if (fallback && body && body.allowLocalFallback) {
    fallback.downloadError = downloaded && downloaded.error || 'CRM 自动下载失败';
    return fallback;
  }
  return Object.assign({ error: downloaded && downloaded.error || 'CRM 自动下载失败' }, downloaded || {}, { failed: true });
}

function normalizeCrmRow(row) {
  const videoUrl = firstField(row, ['发布链接', '视频链接', '作品链接', '链接', 'url', 'URL']);
  const metrics = emptyMetrics();
  metrics.play = firstNumber(row, ['播放量', '播放', '有效播放', '总播放', '曝光播放', '播放数']);
  metrics.like = firstNumber(row, ['点赞量', '点赞', '点赞数']);
  metrics.comment = firstNumber(row, ['评论量', '评论', '评论数', '评论量7日', '评论数7日']);
  metrics.favorite = firstNumber(row, ['收藏量', '收藏', '收藏数', '收藏量7日', '收藏数7日']);
  metrics.share = firstNumber(row, ['分享量', '分享', '转发', '转发量', '分享数', '转发量7日']);
  metrics.danmaku = firstNumber(row, ['弹幕量', '弹幕', '弹幕数']);
  metrics.coin = firstNumber(row, ['投币量', '投币', '投币数']);
  metrics.blueLink = firstNumber(row, ['蓝链点击', '蓝链点击量', '组件点击', '组件点击量']);
  return {
    marketingTarget: firstField(row, ['营销标的', '标的', '项目', '项目名称', '产品', '产品名称']),
    accountName: firstField(row, ['昵称', '达人昵称', '账号', '账号名', '达人', '达人名称']),
    platform: normalizePlatform(firstField(row, ['平台', '平台名称'])),
    videoUrl: videoUrl,
    videoId: firstField(row, ['视频ID', '作品ID', 'item_id', 'BV号', 'bvid']),
    title: firstField(row, ['标题', '视频标题', '作品标题']),
    publishedAt: firstField(row, ['实际发布时间', '发布时间', '发布日期']),
    updatedAt: firstField(row, ['更新时间', '更新日期', '数据更新时间']),
    followStatus: firstField(row, ['保量跟进']),
    metrics: metrics,
    raw: row
  };
}

function crmCsvUpdatedRange(rows) {
  const values = (Array.isArray(rows) ? rows : []).map(function(row) {
    return text(row && row.updatedAt);
  }).filter(Boolean).sort();
  return {
    min: values[0] || '',
    max: values[values.length - 1] || ''
  };
}

async function readLatestCrmCsv(body) {
  const file = await prepareCrmCsvFile(body || {});
  if (!file) return { ok: false, error: '没有找到 CRM CSV，请先从 CRM 导出「达人执行效果列表」到下载目录' };
  if (file.failed) return { ok: false, error: file.error || 'CRM 自动下载失败', needLogin: file.needLogin || false, download: file };
  const parsed = parseCsv(decodeCsvBuffer(fs.readFileSync(file.path)));
  if (parsed.length < 2) return { ok: false, error: 'CRM CSV 内容为空', file: file };
  const headers = parsed[0].map(cleanCell);
  const rows = parsed.slice(1).map(function(cells) {
    const row = {};
    headers.forEach(function(header, index) {
      row[header] = cleanCell(cells[index]);
    });
    return row;
  }).map(normalizeCrmRow).filter(function(row) {
    return row.accountName || row.marketingTarget || row.videoUrl || row.videoId;
  });
  return { ok: true, source: file.downloaded ? 'crm-auto-download' : file.localFallback ? 'crm-local-fallback' : file.cachedDownload ? 'crm-cached-download' : 'crm-csv', file: file, downloadError: file.downloadError || '', headers: headers, rows: rows, count: rows.length, updatedRange: crmCsvUpdatedRange(rows) };
}

function normalizeUrlToken(value) {
  const raw = text(value);
  if (!raw) return '';
  const match = raw.match(/https?:\/\/[^\s"'<>，。；;、]+/i);
  return normalizeText(match ? match[0].replace(/[，。；;、,.!?！？]+$/g, '') : raw);
}

function videoIdentityToken(value) {
  const raw = text(value);
  if (!raw) return '';
  const direct = raw.match(/\b(BV[0-9A-Za-z]{8,}|av\d{4,}|\d{12,})\b/i);
  if (direct) return normalizeText(direct[1]);
  const url = normalizeUrlToken(raw);
  const fromUrl = url.match(/(?:video|note|aweme|item|opus|dynamic|read)\/([0-9A-Za-z_-]{6,})/i);
  if (fromUrl) return normalizeText(fromUrl[1]);
  const bv = url.match(/\bBV[0-9A-Za-z]{8,}\b/i);
  if (bv) return normalizeText(bv[0]);
  return '';
}

function crmLinkMatches(execution, row) {
  const execUrl = normalizeUrlToken(execution.videoUrl);
  const rowUrl = normalizeUrlToken(row.videoUrl);
  if (execUrl && rowUrl && (execUrl === rowUrl || execUrl.includes(rowUrl) || rowUrl.includes(execUrl))) return true;
  const execId = videoIdentityToken(execution.videoId || execution.videoUrl);
  const rowId = videoIdentityToken(row.videoId || row.videoUrl);
  return !!(execId && rowId && execId === rowId);
}

function hasExecutionLink(execution) {
  return !!(normalizeUrlToken(execution.videoUrl) || videoIdentityToken(execution.videoId));
}

function crmRowScore(execution, row) {
  const linkRequired = hasExecutionLink(execution);
  const linkMatched = crmLinkMatches(execution, row);
  if (linkRequired && !linkMatched) return -1;
  let score = 0;
  if (linkMatched) score += 120;
  const projectKey = normalizeText(execution.projectName);
  const targetKey = normalizeText(row.marketingTarget);
  if (projectKey && targetKey && (projectKey.includes(targetKey) || targetKey.includes(projectKey))) score += 40;
  const accountKey = normalizeText(execution.accountName);
  const rowAccountKey = normalizeText(row.accountName);
  if (accountKey && rowAccountKey && (accountKey === rowAccountKey || accountKey.includes(rowAccountKey) || rowAccountKey.includes(accountKey))) score += 45;
  const titleKey = normalizeText(row.title);
  if (projectKey && titleKey && titleKey.includes(projectKey)) score += 12;
  if (normalizePlatform(execution.platform) === normalizePlatform(row.platform)) score += 4;
  return score;
}

function pickCrmRow(execution, rows) {
  let best = null;
  let bestScore = 0;
  rows.forEach(function(row) {
    const score = crmRowScore(execution, row);
    if (score > bestScore || score === bestScore && best && num(row.metrics && row.metrics.play) > num(best.metrics && best.metrics.play)) {
      best = row;
      bestScore = score;
    }
  });
  const threshold = hasExecutionLink(execution) ? 120 : 80;
  return bestScore >= threshold ? { row: best, score: bestScore } : null;
}

function mergeNonDecreasingMetrics(existing, incoming) {
  const merged = Object.assign(emptyMetrics(), existing || {});
  const regressions = {};
  Object.keys(emptyMetrics()).forEach(function(metric) {
    const currentValue = num(merged[metric]);
    const incomingValue = num(incoming && incoming[metric]);
    if (incomingValue >= currentValue) {
      merged[metric] = incomingValue;
      return;
    }
    if (incomingValue > 0) {
      regressions[metric] = { from: currentValue, to: incomingValue };
    }
  });
  return { metrics: merged, regressions: regressions };
}

function normalizeProject(input, fallbackGroup) {
  const now = new Date().toISOString();
  const platform = normalizePlatform(input.platform);
  const projectId = text(input.projectId || input.id) || ('proj-' + slug(input.projectName || input.name) + '-' + Date.now().toString(36));
  const targetCpm = money(input.targetCpm || defaultTargetCpm(platform));
  const sourceAccounts = Array.isArray(input.accounts) ? input.accounts : [];
  const accountCandidates = sourceAccounts.map(function(account) {
    return text(account && (account.accountName || account.name));
  }).filter(Boolean);
  const accounts = sourceAccounts
    .map(function(account) { return normalizeParsedAccountForSave(account, accountCandidates); })
    .filter(Boolean);
  const executions = accounts.map(function(account, index) {
    const accountName = text(account.accountName || account.name);
    const discountedPrice = money(account.discountedPrice || account.amount || account.price);
    const originalPrice = money(account.originalPrice || discountedPrice);
    const discountRate = money(account.discountRate || (originalPrice ? discountedPrice / originalPrice * 100 : 100));
    const executionId = text(account.executionId || account.id) || ['exec', projectId, slug(accountName), index + 1].join('-');
    const targetPlay = resolveTargetPlay(account, accountName, normalizePlatform(account.platform || platform), discountedPrice, targetCpm);
    return enrichAccountIdentity({
      id: executionId,
      executionId: executionId,
      projectId: projectId,
      projectName: text(input.projectName || input.name || '未命名项目'),
      accountName: accountName,
      accountGroup: accountGroup(accountName) || normalizeGroupName(account.accountGroup || account.groupName || account.group) || fallbackGroup || '未分组',
      platform: normalizePlatform(account.platform || platform),
      scheduleDate: text(account.scheduleDate || input.scheduleDate),
      originalPrice: originalPrice,
      discountRate: discountRate,
      discountedPrice: discountedPrice,
      targetCpm: targetCpm,
      targetMetrics: Object.assign(emptyMetrics(), account.targetMetrics || {}, { play: targetPlay }),
      currentMetrics: Object.assign(emptyMetrics(), account.currentMetrics || account.current || {}),
      appliedMetrics: Object.assign(emptyMetrics(), account.appliedMetrics || {}),
      maintenanceCost: money(account.maintenanceCost || 0),
      videoUrl: text(account.videoUrl),
      notes: text(account.notes),
      createdAt: text(account.createdAt) || now,
      updatedAt: now
    });
  }).filter(function(item) { return item.accountName; });
  const totalAmount = executions.reduce(function(sum, item) { return sum + money(item.discountedPrice); }, 0);
  return {
    project: {
      id: projectId,
      projectId: projectId,
      projectName: text(input.projectName || input.name || '未命名项目'),
      platform: platform,
      groupName: normalizeGroupName(input.groupName || input.group) || fallbackGroup || '',
      scheduleDate: text(input.scheduleDate),
      targetCpm: targetCpm,
      status: text(input.status || input.projectStatus) || 'active',
      totalAmount: totalAmount,
      createdAt: text(input.createdAt) || now,
      updatedAt: now
    },
    executions: executions
  };
}

function normalizeExecution(input) {
  const execution = Object.assign({}, input || {});
  execution.id = text(execution.id || execution.executionId);
  execution.executionId = execution.id;
  execution.projectId = text(execution.projectId);
  execution.accountName = cleanTrafficAccountName(execution.accountName);
  execution.platform = normalizePlatform(execution.platform);
  execution.currentMetrics = Object.assign(emptyMetrics(), execution.currentMetrics || execution.current || {});
  execution.targetMetrics = Object.assign(emptyMetrics(), execution.targetMetrics || {});
  execution.appliedMetrics = Object.assign(emptyMetrics(), execution.appliedMetrics || {});
  execution.originalPrice = money(execution.originalPrice);
  execution.discountRate = money(execution.discountRate);
  execution.discountedPrice = money(execution.discountedPrice);
  execution.targetCpm = money(execution.targetCpm);
  execution.maintenanceCost = money(execution.maintenanceCost);
  execution.videoUrl = text(execution.videoUrl);
  execution.xingtuId = fieldIdentityText('xingtuId', execution.platform, execution.xingtuId);
  execution.douyinId = fieldIdentityText('douyinId', execution.platform, execution.douyinId);
  execution.accountId = fieldIdentityText('accountId', execution.platform, execution.accountId);
  execution.uid = fieldIdentityText('uid', execution.platform, execution.uid);
  execution.cooperationCode = fieldIdentityText('cooperationCode', execution.platform, execution.cooperationCode);
  execution.updatedAt = new Date().toISOString();
  return execution;
}

function applicationParentExecutionId(executionId) {
  const raw = text(executionId);
  const match = raw.match(/^(.+)-app-.+$/);
  return match ? match[1] : '';
}

function canonicalQuantityUnit(quantityUnit, service) {
  const unit = text(quantityUnit);
  if (/万|w/i.test(unit)) return '万';
  if (/千|k/i.test(unit)) return '千';
  if (/元|¥|rmb/i.test(unit) || service === 'douPlus') return '元';
  if (/个/.test(unit)) return '个';
  if (service === 'play') return '万';
  if (service === 'like') return '千';
  return '个';
}

function parseQuantityInput(quantity) {
  if (typeof quantity === 'number') return { amount: Number.isFinite(quantity) ? quantity : 0, suffix: '' };
  const raw = text(quantity).replace(/,/g, '').trim();
  if (!raw) return { amount: 0, suffix: '' };
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*([wWkK万千个元]?)$/);
  if (!match) return { amount: num(raw), suffix: '' };
  return { amount: num(match[1]), suffix: match[2] || '' };
}

function quantityToRaw(service, quantity, option) {
  const parsed = parseQuantityInput(quantity);
  const amount = parsed.amount;
  if (!amount) return 0;
  if (/[wW万]/.test(parsed.suffix)) return amount * 10000;
  if (/[kK千]/.test(parsed.suffix)) return amount * 1000;
  const unit = canonicalQuantityUnit(option && option.quantityUnit, service);
  if (unit === '万') return amount * 10000;
  if (unit === '千') return amount * 1000;
  return amount;
}

function rawToBillableAmount(rawQuantity, quantityUnit, service) {
  const raw = num(rawQuantity);
  if (!raw) return 0;
  const unit = canonicalQuantityUnit(quantityUnit, service);
  if (unit === '万') return raw / 10000;
  if (unit === '千') return raw / 1000;
  return raw;
}

function effectiveUnitPrice(option, billableQuantity) {
  const tiers = Array.isArray(option && option.priceTiers) ? option.priceTiers : [];
  const quantity = num(billableQuantity);
  if (tiers.length && quantity) {
    const matched = tiers.find(function(tier) {
      const min = num(tier.min || tier.from);
      const max = num(tier.max || tier.to);
      return quantity >= min && (!max || quantity <= max);
    });
    if (matched) return money(matched.unitPrice);
    const fallback = tiers.slice().sort(function(a, b) { return num(b.min || b.from) - num(a.min || a.from); }).find(function(tier) {
      return quantity >= num(tier.min || tier.from);
    });
    if (fallback) return money(fallback.unitPrice);
  }
  return money(option && option.unitPrice);
}

function optionFor(platform, optionId, service) {
  const table = PRICE_TABLES.find(function(item) { return item.platform === normalizePlatform(platform); }) || PRICE_TABLES[0];
  return table.items.find(function(item) { return item.id === optionId; }) || table.items.find(function(item) { return item.service === service; }) || null;
}

function optionForTables(priceTables, platform, optionId, service) {
  const tables = Array.isArray(priceTables) && priceTables.length ? priceTables : PRICE_TABLES;
  const table = tables.find(function(item) { return item.platform === normalizePlatform(platform); }) || tables[0] || { items: [] };
  return table.items.find(function(item) { return item.id === optionId; }) || table.items.find(function(item) { return item.service === service; }) || null;
}

function calculateMaintenance(platform, quantityInputs, selectedOptions, priceTables) {
  const lines = [];
  Object.keys(quantityInputs || {}).forEach(function(service) {
    const option = optionForTables(priceTables, platform, selectedOptions && selectedOptions[service], service);
    if (!option) return;
    const rawQuantity = quantityToRaw(service, quantityInputs[service], option);
    if (!rawQuantity) return;
    const quantity = rawToBillableAmount(rawQuantity, option.quantityUnit, service);
    const unitPrice = effectiveUnitPrice(option, quantity);
    lines.push({
      service: service,
      optionId: option.id,
      optionName: option.name,
      quantity: quantity,
      rawQuantity: rawQuantity,
      unitPrice: unitPrice,
      quantityUnit: canonicalQuantityUnit(option.quantityUnit, service),
      total: money(quantity * unitPrice)
    });
  });
  return {
    lines: lines,
    cost: money(lines.reduce(function(sum, line) { return sum + line.total; }, 0)),
    metrics: lines.reduce(function(out, line) {
      const key = line.service === 'blueLink' ? 'blueLink' : line.service;
      out[key] = Math.round(line.rawQuantity);
      return out;
    }, emptyMetrics())
  };
}

function nextPhase(records, executionId) {
  const nums = (records || []).filter(function(record) {
    return text(record.executionId) === text(executionId);
  }).map(function(record) {
    const phase = text(record.phaseName);
    if (/一|1/.test(phase)) return 1;
    if (/二|2/.test(phase)) return 2;
    if (/三|3/.test(phase)) return 3;
    if (/四|4/.test(phase)) return 4;
    const match = phase.match(/\d+/);
    return match ? Number(match[0]) : 0;
  });
  const max = Math.max(0, ...nums);
  return ['一期', '二期', '三期', '四期', '五期'][max] || ('第' + (max + 1) + '期');
}

function buildReviewText(app, execution, calc, cumulativeCost) {
  const platform = platformLabel(app.platform || execution.platform);
  const orderType = text(app.orderType || execution.orderType || execution.dealType) === 'private' ? '私单' : '星图单';
  const metricLine = calc.lines.map(function(line) {
    return line.service + '：' + line.quantity + line.quantityUnit;
  }).join('，') || '本期未填写维护数量';
  const originalPrice = money(app.originalPrice || execution.originalPrice);
  const discountedPrice = money(app.discountedPrice || execution.discountedPrice);
  const grossRate = originalPrice ? (discountedPrice - cumulativeCost) / originalPrice * 100 : 0;
  const grossProfit = discountedPrice - cumulativeCost;
  return [
    '标的：' + text(app.projectName || execution.projectName),
    '账号：' + text(app.accountName || execution.accountName),
    '订单类型：' + orderType,
    '平台：' + platform,
    '期数：' + text(app.phaseName || '一期'),
    '视频链接：' + (text(app.videoUrl || execution.videoUrl) || '待补'),
    '目标播放：' + Math.round(num(app.targetPlay || execution.targetMetrics && execution.targetMetrics.play)).toLocaleString('zh-CN'),
    '目标CPM：' + money(app.targetCpm || execution.targetCpm),
    '本期维护：' + metricLine,
    '本期维护成本：' + calc.cost.toLocaleString('zh-CN') + '元',
    '累计维护成本：' + cumulativeCost.toLocaleString('zh-CN') + '元',
    '折前价格：' + originalPrice.toLocaleString('zh-CN') + '元',
    '折后价格：' + discountedPrice.toLocaleString('zh-CN') + '元',
    '维护后毛利率：' + grossRate.toFixed(1) + '%',
    '集团毛利：' + grossProfit.toLocaleString('zh-CN') + '元',
    '',
    '@薛荐轩 @陈泓睿 @傅思敏 @刘登魁 @杨鸿霆 @商光涵 辛苦审核'
  ].join('\n');
}

function aggregateProject(project, executions, records) {
  const relevant = executions.filter(function(item) { return item.projectId === project.projectId; });
  const target = emptyMetrics();
  const actual = emptyMetrics();
  const applied = emptyMetrics();
  let maintenanceCost = 0;
  relevant.forEach(function(execution) {
    metricKeys(execution.platform).forEach(function(key) {
      target[key] += num(execution.targetMetrics && execution.targetMetrics[key]);
      actual[key] += num(execution.currentMetrics && execution.currentMetrics[key]);
      applied[key] += num(execution.appliedMetrics && execution.appliedMetrics[key]);
    });
    maintenanceCost += money(execution.maintenanceCost);
  });
  return Object.assign({}, project, {
    executions: relevant,
    records: records.filter(function(record) { return record.projectId === project.projectId; }),
    targetMetrics: target,
    currentMetrics: actual,
    appliedMetrics: applied,
    maintenanceCost: money(maintenanceCost)
  });
}

module.exports = function createTrafficPlanV2Routes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'traffic_plan_v2.db');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const adapter = createSqliteAdapter({ dbPath: dbPath, logger: logger });
  const autoRefreshState = { timer: null, lastRunAt: 0, lastResult: null };
  const crmRefreshStatusPath = path.join(dataDir, 'traffic_plan_v2_crm_status.json');

  function getDb() {
    return adapter.createDb();
  }

  function readCrmRefreshStatusFile() {
    try {
      return parseJson(fs.readFileSync(crmRefreshStatusPath, 'utf8'), null) || null;
    } catch (err) {
      return null;
    }
  }

  function writeCrmRefreshStatusFile(status) {
    try {
      fs.writeFileSync(crmRefreshStatusPath, jsonValue(status), 'utf8');
    } catch (err) {
      logger.warn('CRM refresh status write failed', err && err.message || err);
    }
  }

  async function initSchema() {
    const db = getDb();
    try {
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_v2_projects (
        user_key TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        group_name TEXT DEFAULT '',
        platform TEXT DEFAULT '',
        schedule_date TEXT DEFAULT '',
        target_cpm REAL DEFAULT 0,
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, project_id)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_v2_executions (
        user_key TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        account_group TEXT DEFAULT '',
        account_name TEXT DEFAULT '',
        platform TEXT DEFAULT '',
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, execution_id)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_v2_applications (
        user_key TEXT NOT NULL,
        application_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        phase_name TEXT DEFAULT '',
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, application_id)
      )`);
      await run(db, `CREATE TABLE IF NOT EXISTS traffic_v2_settings (
        user_key TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_key, setting_key)
      )`);
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_traffic_v2_project_group ON traffic_v2_projects(user_key, group_name, updated_at)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_traffic_v2_exec_project ON traffic_v2_executions(user_key, project_id)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_traffic_v2_app_exec ON traffic_v2_applications(user_key, execution_id)');
    } finally {
      closeDb(db);
    }
  }

  const ready = initSchema();

  const CRM_AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

  async function runCrmAutoRefresh() {
    autoRefreshState.lastRunAt = Date.now();
    autoRefreshState.lastResult = await refreshAllCrmCsvUsers().catch(function(err) {
      return { ok: false, error: err.message || String(err), at: new Date().toISOString() };
    });
    if (autoRefreshState.lastResult && autoRefreshState.lastResult.ok !== false) {
      writeCrmRefreshStatusFile(autoRefreshState.lastResult);
    }
    return autoRefreshState.lastResult;
  }

  async function refreshAllCrmCsvUsers() {
    const db = getDb();
    let keys = [];
    try {
      const rows = await all(db, 'SELECT DISTINCT user_key FROM traffic_v2_executions ORDER BY user_key');
      keys = rows.map(function(row) { return text(row.user_key); }).filter(Boolean);
    } finally {
      closeDb(db);
    }
    if (!keys.length) {
      return { ok: true, skipped: true, reason: '没有可自动更新的投流项目', at: new Date().toISOString() };
    }
    const results = [];
    for (const key of keys) {
      const result = await refreshFromCrmCsv(key, { auto: true });
      results.push({ key: key, ok: result.ok !== false, matched: result.matched || 0, unmatched: result.unmatched || 0, error: result.error || '', file: result.file || null, csvRows: result.csvRows || 0, csvUpdatedRange: result.csvUpdatedRange || null });
    }
    const sourceResult = results.find(function(item) { return item.file || item.csvUpdatedRange; }) || {};
    return {
      ok: results.every(function(item) { return item.ok; }),
      at: new Date().toISOString(),
      userKeys: keys.length,
      matched: results.reduce(function(sum, item) { return sum + num(item.matched); }, 0),
      unmatched: results.reduce(function(sum, item) { return sum + num(item.unmatched); }, 0),
      file: sourceResult.file || null,
      csvRows: sourceResult.csvRows || 0,
      csvUpdatedRange: sourceResult.csvUpdatedRange || null,
      results: results
    };
  }

  function startCrmAutoRefresh() {
    if (autoRefreshState.timer) return;
    autoRefreshState.timer = setInterval(function() {
      ready.then(runCrmAutoRefresh).catch(function(err) {
        logger.warn('CRM CSV 自动更新失败', err && err.message || err);
      });
    }, CRM_AUTO_REFRESH_INTERVAL_MS);
  }

  startCrmAutoRefresh();

  function withReady(fn, cb) {
    ready.then(fn).catch(function(err) {
      cb({ ok: false, error: err.message || String(err) });
    });
  }

  async function readState(key, groupName) {
    const db = getDb();
    try {
      const settings = await readSettings(db, key);
      const projectRows = await all(db, 'SELECT payload FROM traffic_v2_projects WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const executionRows = await all(db, 'SELECT payload FROM traffic_v2_executions WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const applicationRows = await all(db, 'SELECT payload FROM traffic_v2_applications WHERE user_key=? ORDER BY updated_at DESC', [key]);
      let projects = projectRows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean);
      let executions = executionRows.map(function(row) {
        return enrichAccountIdentity(parseJson(row.payload, null), settings.accountStandards);
      }).filter(Boolean);
      let applications = applicationRows.map(function(row) {
        return enrichAccountIdentity(parseJson(row.payload, null), settings.accountStandards);
      }).filter(Boolean);
      const applicationIds = new Set(applications.map(function(record) {
        return text(record.id || record.applicationId);
      }).filter(Boolean));
      executions = executions.filter(function(execution) {
        return !(applicationParentExecutionId(execution.executionId) && applicationIds.has(execution.executionId));
      });
      const applicationSummary = new Map();
      applications.forEach(function(record) {
        const id = text(record.executionId);
        if (!id) return;
        const summary = applicationSummary.get(id) || { metrics: emptyMetrics(), maintenanceCost: 0 };
        Object.keys(record.targetMetrics || {}).forEach(function(metric) {
          summary.metrics[metric] = num(summary.metrics[metric]) + num(record.targetMetrics[metric]);
        });
        summary.maintenanceCost += money(record.maintenanceCost);
        applicationSummary.set(id, summary);
      });
      executions = executions.map(function(execution) {
        const summary = applicationSummary.get(execution.executionId);
        if (!summary) return execution;
        return Object.assign({}, execution, {
          appliedMetrics: Object.assign(emptyMetrics(), summary.metrics),
          maintenanceCost: money(summary.maintenanceCost)
        });
      });
      if (groupName) {
        const groupKey = normalizeText(groupName);
        executions = executions.filter(function(execution) { return normalizeText(execution.accountGroup || execution.groupName) === groupKey; });
        const executionIds = new Set(executions.map(function(execution) { return execution.executionId; }));
        applications = applications.filter(function(record) {
          return executionIds.has(record.executionId) || normalizeText(record.accountGroup || record.groupName) === groupKey;
        });
        const projectIds = new Set(executions.map(function(execution) { return execution.projectId; }));
        projects = projects.filter(function(project) { return projectIds.has(project.projectId) || normalizeText(project.groupName) === groupKey; });
      }
      const aggregatedProjects = projects.map(function(project) {
        return aggregateProject(project, executions, applications);
      });
      return {
        ok: true,
        dbPath: dbPath,
        groupName: groupName || '',
        projects: aggregatedProjects,
        executions: executions,
        applications: applications,
        priceTables: settings.priceTables,
        presets: settings.presets,
        accountStandards: settings.accountStandards,
        groups: GROUP_ACCOUNTS
      };
    } finally {
      closeDb(db);
    }
  }

  async function readSettings(db, key) {
    const priceRow = await get(db, 'SELECT payload FROM traffic_v2_settings WHERE user_key=? AND setting_key=?', [key, 'priceTables']);
    const presetRow = await get(db, 'SELECT payload FROM traffic_v2_settings WHERE user_key=? AND setting_key=?', [key, 'presets']);
    const standardRow = await get(db, 'SELECT payload FROM traffic_v2_settings WHERE user_key=? AND setting_key=?', [key, 'accountStandards']);
    const savedAccountStandards = parseJson(standardRow && standardRow.payload, null);
    const accountStandards = Array.isArray(savedAccountStandards) && savedAccountStandards.length
      ? savedAccountStandards
      : readDefaultAccountStandards();
    return {
      priceTables: parseJson(priceRow && priceRow.payload, null) || PRICE_TABLES,
      presets: parseJson(presetRow && presetRow.payload, null) || DEFAULT_PRESETS,
      accountStandards: mergeInquiryAccountInfo(accountStandards)
    };
  }

  async function saveSettings(key, raw) {
    const db = getDb();
    const at = nowSec();
    try {
      if (raw && Array.isArray(raw.priceTables)) {
        await run(db, 'INSERT OR REPLACE INTO traffic_v2_settings (user_key,setting_key,payload,updated_at) VALUES (?,?,?,?)', [key, 'priceTables', jsonValue(raw.priceTables), at]);
      }
      if (raw && Array.isArray(raw.presets)) {
        await run(db, 'INSERT OR REPLACE INTO traffic_v2_settings (user_key,setting_key,payload,updated_at) VALUES (?,?,?,?)', [key, 'presets', jsonValue(raw.presets), at]);
      }
      if (raw && Array.isArray(raw.accountStandards)) {
        await run(db, 'INSERT OR REPLACE INTO traffic_v2_settings (user_key,setting_key,payload,updated_at) VALUES (?,?,?,?)', [key, 'accountStandards', jsonValue(raw.accountStandards), at]);
      }
      return Object.assign({ ok: true }, await readSettings(db, key));
    } finally {
      closeDb(db);
    }
  }

  async function insertProject(key, rawProject, groupName) {
    const normalized = normalizeProject(rawProject || {}, groupName);
    const db = getDb();
    const now = nowSec();
    try {
      await run(db, `INSERT OR REPLACE INTO traffic_v2_projects
        (user_key,project_id,project_name,group_name,platform,schedule_date,target_cpm,payload,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [
        key,
        normalized.project.projectId,
        normalized.project.projectName,
        normalized.project.groupName,
        normalized.project.platform,
        normalized.project.scheduleDate,
        normalized.project.targetCpm,
        jsonValue(normalized.project),
        now,
        now
      ]);
      for (const execution of normalized.executions) {
        await upsertExecution(db, key, execution, now);
      }
      return Object.assign({ ok: true }, await readState(key, ''));
    } finally {
      closeDb(db);
    }
  }

  async function upsertExecution(db, key, execution, at) {
    const item = normalizeExecution(execution);
    await run(db, `INSERT OR REPLACE INTO traffic_v2_executions
      (user_key,execution_id,project_id,account_group,account_name,platform,payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, [
      key,
      item.executionId,
      item.projectId,
      item.accountGroup || item.groupName || '',
      item.accountName,
      item.platform,
      jsonValue(item),
      at || nowSec(),
      at || nowSec()
    ]);
    return item;
  }

  async function deleteProject(key, projectId) {
    const id = text(projectId);
    if (!id) return { ok: false, error: '缺少项目 ID' };
    const db = getDb();
    try {
      await run(db, 'DELETE FROM traffic_v2_applications WHERE user_key=? AND project_id=?', [key, id]);
      await run(db, 'DELETE FROM traffic_v2_executions WHERE user_key=? AND project_id=?', [key, id]);
      await run(db, 'DELETE FROM traffic_v2_projects WHERE user_key=? AND project_id=?', [key, id]);
      return Object.assign({ ok: true }, await readState(key, ''));
    } finally {
      closeDb(db);
    }
  }

  async function updateProject(key, rawProject) {
    const id = text(rawProject && (rawProject.projectId || rawProject.id));
    if (!id) return { ok: false, error: '缺少项目 ID' };
    const db = getDb();
    const at = nowSec();
    try {
      const projectRow = await get(db, 'SELECT payload FROM traffic_v2_projects WHERE user_key=? AND project_id=?', [key, id]);
      const currentProject = parseJson(projectRow && projectRow.payload, null);
      if (!currentProject) return { ok: false, error: '项目不存在' };
      const targetCpm = money(rawProject.targetCpm || currentProject.targetCpm || defaultTargetCpm(rawProject.platform || currentProject.platform));
      const nextProject = Object.assign({}, currentProject, {
        projectName: text(rawProject.projectName || rawProject.name || currentProject.projectName),
        platform: normalizePlatform(rawProject.platform || currentProject.platform),
        scheduleDate: text(rawProject.scheduleDate || currentProject.scheduleDate),
        targetCpm: targetCpm,
        status: text(rawProject.status || rawProject.projectStatus || currentProject.status) || 'active',
        updatedAt: new Date().toISOString()
      });
      const executionRows = await all(db, 'SELECT payload FROM traffic_v2_executions WHERE user_key=? AND project_id=?', [key, id]);
      const executions = executionRows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean);
      const preserveTargetMetrics = Boolean(rawProject.preserveTargetMetrics);
      const rawTargetPlay = Math.round(num(rawProject.targetPlay || rawProject.targetMetrics && rawProject.targetMetrics.play));
      const originalTargetTotal = executions.reduce(function(sum, execution) {
        return sum + num(execution.targetMetrics && execution.targetMetrics.play);
      }, 0);
      const totalExecutionBudget = executions.reduce(function(sum, item) { return sum + money(item.discountedPrice); }, 0);
      let allocatedTargetPlay = 0;
      const normalizedExecutions = executions.map(function(execution, index) {
        const discountedPrice = money(execution.discountedPrice);
        let targetPlay = resolveTargetPlay(execution, execution.accountName, normalizePlatform(execution.platform || nextProject.platform), discountedPrice, targetCpm);
        if (preserveTargetMetrics) {
          targetPlay = num(execution.targetMetrics && execution.targetMetrics.play);
        } else if (rawTargetPlay > 0) {
          if (index === executions.length - 1) {
            targetPlay = Math.max(0, rawTargetPlay - allocatedTargetPlay);
          } else if (originalTargetTotal > 0) {
            targetPlay = Math.round(rawTargetPlay * num(execution.targetMetrics && execution.targetMetrics.play) / originalTargetTotal);
          } else {
            targetPlay = totalExecutionBudget ? Math.round(rawTargetPlay * discountedPrice / totalExecutionBudget) : Math.round(rawTargetPlay / executions.length);
          }
          allocatedTargetPlay += targetPlay;
        }
        return normalizeExecution(Object.assign({}, execution, {
          projectName: nextProject.projectName,
          platform: normalizePlatform(execution.platform || nextProject.platform),
          scheduleDate: text(execution.scheduleDate || nextProject.scheduleDate),
          targetCpm: targetCpm,
          targetMetrics: Object.assign(emptyMetrics(), execution.targetMetrics || {}, { play: targetPlay })
        }));
      });
      nextProject.totalAmount = normalizedExecutions.reduce(function(sum, execution) {
        return sum + money(execution.discountedPrice);
      }, 0) || money(nextProject.totalAmount);
      await run(db, `INSERT OR REPLACE INTO traffic_v2_projects
        (user_key,project_id,project_name,group_name,platform,schedule_date,target_cpm,payload,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [
        key,
        nextProject.projectId,
        nextProject.projectName,
        nextProject.groupName || '',
        nextProject.platform,
        nextProject.scheduleDate,
        nextProject.targetCpm,
        jsonValue(nextProject),
        at,
        at
      ]);
      for (const execution of normalizedExecutions) {
        await upsertExecution(db, key, execution, at);
      }
      return Object.assign({ ok: true }, await readState(key, ''));
    } finally {
      closeDb(db);
    }
  }

  async function saveExecution(key, execution) {
    const db = getDb();
    try {
      const requestedId = text(execution && (execution.executionId || execution.id));
      const parentId = applicationParentExecutionId(requestedId);
      if (parentId) {
        const parentRow = await get(db, 'SELECT payload FROM traffic_v2_executions WHERE user_key=? AND execution_id=?', [key, parentId]);
        if (parentRow) {
          const settings = await readSettings(db, key);
          return { ok: true, execution: normalizeExecution(enrichAccountIdentity(parseJson(parentRow.payload, null), settings.accountStandards)) };
        }
      }
      const item = await upsertExecution(db, key, execution, nowSec());
      return { ok: true, execution: item };
    } finally {
      closeDb(db);
    }
  }

  async function saveApplication(key, raw) {
    const db = getDb();
    const at = nowSec();
    try {
      const app = Object.assign({}, raw || {});
      const settings = await readSettings(db, key);
      let executionId = text(app.executionId);
      let row = executionId ? await get(db, 'SELECT payload FROM traffic_v2_executions WHERE user_key=? AND execution_id=?', [key, executionId]) : null;
      let execution = normalizeExecution(enrichAccountIdentity(parseJson(row && row.payload, null), settings.accountStandards));
      if (!execution.id) {
        const projectIdForNew = text(app.projectId) || 'unlinked-project';
        const accountName = cleanTrafficAccountName(app.accountName) || '未填账号';
        executionId = executionId || ['exec', projectIdForNew, slug(accountName), slug(app.videoUrl || app.phaseName || 'manual')].join('-');
        execution = normalizeExecution(enrichAccountIdentity({
          executionId: executionId,
          projectId: projectIdForNew,
          projectName: text(app.projectName) || '未关联项目',
          accountName: accountName,
          accountGroup: text(app.accountGroup) || accountGroup(accountName) || groupFromUser(raw || {}) || '未分组',
          platform: normalizePlatform(app.platform || 'douyin'),
          originalPrice: money(app.originalPrice),
          discountRate: money(app.discountRate || 100),
          discountedPrice: money(app.discountedPrice),
          targetCpm: money(app.targetCpm || defaultTargetCpm(app.platform || 'douyin')),
          targetMetrics: Object.assign(emptyMetrics(), { play: Math.round(num(app.targetPlay || 0)) }),
          currentMetrics: emptyMetrics(),
          appliedMetrics: emptyMetrics(),
          videoUrl: text(app.videoUrl),
          notes: '未关联项目'
        }, settings.accountStandards));
        await upsertExecution(db, key, execution, at);
      }
      const projectId = text(app.projectId || execution.projectId);
      const phaseName = text(app.phaseName) || '一期';
      const calc = calculateMaintenance(app.platform || execution.platform, app.quantityInputs || {}, app.selectedOptions || {}, settings.priceTables);
      const oldRows = await all(db, 'SELECT payload FROM traffic_v2_applications WHERE user_key=? AND execution_id=?', [key, executionId]);
      const oldRecords = oldRows.map(function(record) { return parseJson(record.payload, null); }).filter(Boolean);
      const samePhaseRecord = oldRecords
        .filter(function(record) { return text(record.phaseName) === phaseName; })
        .sort(function(a, b) { return text(b.updatedAt).localeCompare(text(a.updatedAt)); })[0] || null;
      const sameId = text(samePhaseRecord && (samePhaseRecord.id || samePhaseRecord.applicationId)) || text(app.id || app.applicationId) || [executionId, slug(phaseName)].join('-app-');
      const otherCost = oldRecords.filter(function(record) {
        return text(record.id || record.applicationId) !== sameId && text(record.phaseName) !== phaseName;
      }).reduce(function(sum, record) { return sum + money(record.maintenanceCost); }, 0);
      const cumulativeCost = money(otherCost + calc.cost);
      const targetPlay = Math.round(num(calc.metrics && calc.metrics.play) || num(app.targetPlay || app.targetPlayWan && Number(app.targetPlayWan) * 10000));
      const identity = resolveApplicationIdentity(execution, app, settings.accountStandards);
      const application = {
        id: sameId,
        applicationId: sameId,
        executionId: executionId,
        projectId: projectId,
        projectName: text(app.projectName || execution.projectName),
        accountName: cleanTrafficAccountName(app.accountName || execution.accountName),
        accountGroup: text(app.accountGroup || execution.accountGroup),
        platform: normalizePlatform(app.platform || execution.platform),
        xingtuId: identity.xingtuId,
        douyinId: identity.douyinId,
        accountId: identity.accountId,
        uid: identity.uid,
        cooperationCode: identity.cooperationCode,
        orderType: text(app.orderType || execution.orderType || execution.dealType || 'xingtu'),
        phaseName: phaseName,
        phaseRatio: text(app.phaseRatio || ''),
        videoUrl: text(app.videoUrl || execution.videoUrl),
        originalPrice: money(app.originalPrice || execution.originalPrice),
        discountRate: money(app.discountRate || execution.discountRate),
        discountedPrice: money(app.discountedPrice || execution.discountedPrice),
        targetCpm: money(app.targetCpm || execution.targetCpm),
        targetPlay: targetPlay,
        selectedOptions: app.selectedOptions || {},
        quantityInputs: app.quantityInputs || {},
        maintenanceLines: calc.lines,
        maintenanceCost: calc.cost,
        cumulativeCost: cumulativeCost,
        targetMetrics: Object.assign(emptyMetrics(), calc.metrics, { play: targetPlay || calc.metrics.play }),
        exportedReviewText: text(app.exportedReviewText) || buildReviewText(Object.assign({}, app, { phaseName: phaseName, targetPlay: targetPlay }), execution, calc, cumulativeCost),
        createdAt: text(app.createdAt || samePhaseRecord && samePhaseRecord.createdAt) || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await run(db, 'DELETE FROM traffic_v2_applications WHERE user_key=? AND execution_id=? AND phase_name=?', [key, executionId, phaseName]);
      await run(db, `INSERT OR REPLACE INTO traffic_v2_applications
        (user_key,application_id,execution_id,project_id,phase_name,payload,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`, [
        key,
        application.id,
        executionId,
        projectId,
        phaseName,
        jsonValue(application),
        at,
        at
      ]);

      const refreshedRows = await all(db, 'SELECT payload FROM traffic_v2_applications WHERE user_key=? AND execution_id=?', [key, executionId]);
      const records = refreshedRows.map(function(record) { return parseJson(record.payload, null); }).filter(Boolean);
      const applied = records.reduce(function(out, record) {
        Object.keys(record.targetMetrics || {}).forEach(function(metric) {
          out[metric] = num(out[metric]) + num(record.targetMetrics[metric]);
        });
        return out;
      }, emptyMetrics());
      const maintenanceCost = records.reduce(function(sum, record) { return sum + money(record.maintenanceCost); }, 0);
      const nextExecution = enrichAccountIdentity(Object.assign({}, execution, identity, {
        videoUrl: application.videoUrl || execution.videoUrl,
        appliedMetrics: applied,
        maintenanceCost: money(maintenanceCost),
        updatedAt: new Date().toISOString()
      }), settings.accountStandards);
      await upsertExecution(db, key, nextExecution, at);
      return { ok: true, application: application, execution: nextExecution, nextPhaseName: nextPhase(records, executionId) };
    } finally {
      closeDb(db);
    }
  }

  async function refreshFromCrmCsv(key, body) {
    const csv = await readLatestCrmCsv(body || {});
    if (!csv.ok) return csv;
    const db = getDb();
    const at = nowSec();
    try {
      const rows = await all(db, 'SELECT payload FROM traffic_v2_executions WHERE user_key=? ORDER BY updated_at DESC', [key]);
      const scopeGroup = groupFromUser(body || {});
      const scopeKey = normalizeText(scopeGroup);
      const executions = rows.map(function(row) { return parseJson(row.payload, null); }).filter(Boolean).filter(function(execution) {
        if (!scopeKey) return true;
        return normalizeText(execution.accountGroup || execution.groupName) === scopeKey;
      });
      const matched = [];
      const unmatched = [];
      for (const execution of executions) {
        const picked = pickCrmRow(execution, csv.rows);
        if (!picked) {
          unmatched.push({ executionId: execution.executionId, accountName: execution.accountName, projectName: execution.projectName });
          continue;
        }
        const mergedMetrics = mergeNonDecreasingMetrics(execution.currentMetrics, picked.row.metrics);
        const nextMetrics = mergedMetrics.metrics;
        const nextExecution = normalizeExecution(Object.assign({}, execution, {
          currentMetrics: nextMetrics,
          videoUrl: execution.videoUrl || picked.row.videoUrl,
          crmPublishedAt: picked.row.publishedAt || execution.crmPublishedAt || '',
          crmUpdatedAt: picked.row.updatedAt || new Date(csv.file.mtimeMs).toISOString(),
          crmFollowStatus: picked.row.followStatus || execution.crmFollowStatus || '',
          crmMatchedTitle: picked.row.title,
          crmMatchScore: picked.score,
          crmRegressionIgnored: mergedMetrics.regressions,
          updatedAt: new Date().toISOString()
        }));
        await upsertExecution(db, key, nextExecution, at);
        matched.push({
          executionId: nextExecution.executionId,
          projectName: nextExecution.projectName,
          accountName: nextExecution.accountName,
          score: picked.score,
          regressions: mergedMetrics.regressions,
          metrics: nextMetrics
        });
      }
      return Object.assign({
        ok: true,
        matched: matched.length,
        unmatched: unmatched.length,
        matchedItems: matched.slice(0, 30),
        unmatchedItems: unmatched.slice(0, 30)
      }, {
        source: csv.source,
        file: csv.file,
        csvRows: csv.count,
        csvUpdatedRange: csv.updatedRange,
        crmRefreshAt: new Date().toISOString()
      }, await readState(key, scopeGroup));
    } finally {
      closeDb(db);
    }
  }

  return {
    '/api/traffic-plan/v2/state': function(body, cb) {
      withReady(function() {
        readState(userKey(body || {}), groupFromUser(body || {})).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/v2/parse-project': function(body, cb) {
      try {
        cb({ ok: true, parsed: parseProjectText(body && body.text, groupFromUser(body || {})) });
      } catch (err) {
        cb({ ok: false, error: err.message || String(err) });
      }
    },

    '/api/traffic-plan/v2/project': function(body, cb) {
      withReady(function() {
        insertProject(userKey(body || {}), body && body.project, groupFromUser(body || {})).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/v2/update-project': function(body, cb) {
      withReady(function() {
        updateProject(userKey(body || {}), body && body.project).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/v2/delete-project': function(body, cb) {
      withReady(function() {
        deleteProject(userKey(body || {}), body && (body.projectId || body.id)).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/v2/execution': function(body, cb) {
      withReady(function() {
        saveExecution(userKey(body || {}), body && body.execution).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/v2/application': function(body, cb) {
      withReady(function() {
        saveApplication(userKey(body || {}), body && body.application).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/v2/crm-refresh-now': function(body, cb) {
      withReady(function() {
        refreshFromCrmCsv(userKey(body || {}), body || {}).then(function(result) {
          if (result && result.ok !== false) writeCrmRefreshStatusFile(result);
          cb(result);
        }).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/v2/crm-refresh-status': function(body, cb) {
      const stored = readCrmRefreshStatusFile();
      cb({
        ok: true,
        intervalMs: CRM_AUTO_REFRESH_INTERVAL_MS,
        quietHours: '',
        lastRunAt: autoRefreshState.lastRunAt,
        lastResult: autoRefreshState.lastResult || stored
      });
    },

    '/api/traffic-plan/v2/crm-login-screenshot': function(body, cb) {
      withReady(function() {
        captureCrmLoginScreenshot(body || {}).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    },

    '/api/traffic-plan/v2/settings': function(body, cb) {
      withReady(function() {
        saveSettings(userKey(body || {}), body && body.settings).then(cb).catch(function(err) {
          cb({ ok: false, error: err.message || String(err) });
        });
      }, cb);
    }
  };
};
