const path = require('path');
const sqlite3 = require('sqlite3');

const PROFIT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'profit.db');

const PROFIT_ACCOUNTS = [
  '花无缺', '葵仔不想肝', '最翁Damnnn', '薛定谔的机', '跑腿的包子', '李野王SG', '游电工厂', '硬件侠',
  '痞仔伯爵', '暴走星号键', '雷鸭Fist', '报告砖家', '沙雕101', '灵梦小师妹', '网瘾少女一条',
  '策划克星阿强', '饭十七', '皮皮说游戏', '中二探长', '团子好贵',
  '天机妹', '麦小雯', '花蛮楼', '有事找学姐', '夏天丶cat',
  '游小妹', '游热娃子', '超玩教授', 'Lee小强', '木游话说', '麦冬冬',
  '不玩就分手', '游点慌', '游戏永动机', '畅玩百晓生', '夏洛', '游侠蹦蹦', '王路飞cp', '上官北丶', '情风师兄',
  '素材'
];

function normalizePlatform(value) {
  var text = String(value || '').trim();
  if (/代做/.test(text)) return '代做';
  if (/B站|哔哩|bilibili/i.test(text)) return 'B站';
  if (/快手/i.test(text)) return '快手';
  if (/抖音|douyin/i.test(text)) return '抖音';
  return text || '抖音';
}

function calcMargin(revenue, platform) {
  var fee = Number(revenue) || 0;
  var p = normalizePlatform(platform);
  if (p === '代做') return Math.round(fee);
  if (p === 'B站') return Math.round(fee * 0.6);
  return Math.round(fee * 0.5);
}

function pickAmount(text) {
  var source = String(text || '');
  var explicit = source.match(/[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|块|rmb|RMB)/);
  if (explicit) return { value: Math.round(Number(explicit[1]) || 0), raw: explicit[0] };
  var matches = Array.from(source.matchAll(/\d+(?:\.\d+)?/g))
    .filter(function(m) {
      var tail = source.slice(m.index + m[0].length, m.index + m[0].length + 1);
      return tail !== '月';
    })
    .map(function(m) { return { value: Number(m[0]) || 0, raw: m[0] }; })
    .filter(function(n) { return n.value >= 10; })
    .sort(function(a, b) { return b.value - a.value; });
  return matches[0] ? { value: Math.round(matches[0].value), raw: matches[0].raw } : { value: 0, raw: '' };
}

function extractProject(text) {
  var match = String(text || '').match(/(?:合作产品|项目|投放产品|推广产品)\s*[：:]\s*([^\n\r]+)/);
  return match ? match[1].trim() : '';
}

function extractPlatform(text) {
  var match = String(text || '').match(/(?:合作平台|平台)\s*[：:]\s*([^\n\r]+)/);
  return match ? normalizePlatform(match[1]) : '抖音';
}

function extractSchedule(text) {
  var match = String(text || '').match(/(?:推广档期|档期)\s*[：:]\s*([^\n\r]+)/);
  if (!match) return '';
  var m = String(match[1] || '').match(/(1[0-2]|0?[1-9])\s*月?/);
  return m ? Number(m[1]) + '月' : '';
}

function extractFeeSection(text) {
  var raw = String(text || '');
  var match = raw.match(/(?:^|\n)\s*(?:二[、.．]|2[、.．])?\s*费用\s*[：:]?\s*\n?([\s\S]*?)(?=\n\s*(?:三[、.．]|3[、.．])?\s*(?:备注|补充|其他)|$)/);
  return match ? match[1].trim() : '';
}

function parseFeeSection(text) {
  var section = extractFeeSection(text);
  if (!section) return [];
  var project = extractProject(text) || '未命名项目';
  var platform = extractPlatform(text);
  var schedule = extractSchedule(text);
  var records = [];
  PROFIT_ACCOUNTS.forEach(function(account) {
    if (!account || account === '素材') return;
    var escaped = account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp(escaped + '[^\\n\\r\\d¥￥]{0,20}[¥￥]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:元|块|rmb|RMB)?', 'i');
    var match = section.match(re);
    if (!match) return;
    var fee = Number(String(match[1]).replace(/,/g, '')) || 0;
    if (!fee) return;
    records.push({
      account: account,
      project: project,
      platform: platform,
      fee: fee,
      margin: calcMargin(fee, platform),
      schedule: schedule,
      note: account + fee + '元'
    });
  });
  return records;
}

function parseLine(line) {
  var text = String(line || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  var amount = pickAmount(text);
  if (!amount.value) return null;

  var account = PROFIT_ACCOUNTS.find(function(name) {
    return text.toLowerCase().indexOf(String(name).toLowerCase()) >= 0;
  }) || '';
  var monthMatch = text.match(/\d{1,2}\s*月(?:份|上旬|中旬|下旬|初|底|末)?/);
  var platform = /代做|B站|哔哩|bilibili|快手|抖音|douyin/i.test(text) ? normalizePlatform(text) : '抖音';
  var project = text;

  [account, amount.raw, monthMatch && monthMatch[0], platform].forEach(function(part) {
    if (part) project = project.replace(part, ' ');
  });
  project = project
    .replace(/账号|平台|项目|投放产品|确认|商单|流水|收入|营收|金额|费用|报价|下单金额|备注|链接/g, ' ')
    .replace(/[：:，,;；|｜]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!account) {
    var firstToken = text.split(/\s+/)[0] || '';
    account = firstToken.replace(/[：:，,;；]/g, '');
  }

  return {
    account: account,
    project: project,
    platform: platform,
    fee: amount.value,
    margin: calcMargin(amount.value, platform),
    schedule: monthMatch ? monthMatch[0].replace(/\s+/g, '') : '',
    note: text
  };
}

function parseText(text) {
  var feeRecords = parseFeeSection(text);
  if (feeRecords.length) return feeRecords;
  return String(text || '')
    .split(/\n|；|;/)
    .map(parseLine)
    .filter(Boolean);
}

function findHeaderIndex(headers, aliases) {
  for (var i = 0; i < aliases.length; i += 1) {
    var alias = aliases[i];
    var index = headers.findIndex(function(header) {
      return String(header || '').indexOf(alias) >= 0;
    });
    if (index >= 0) return index;
  }
  return -1;
}

function findExactHeaderIndex(headers, aliases) {
  for (var i = 0; i < aliases.length; i += 1) {
    var alias = aliases[i];
    var index = headers.findIndex(function(header) {
      return String(header || '').replace(/\s+/g, '').trim() === alias;
    });
    if (index >= 0) return index;
  }
  return -1;
}

function normalizeHeaderText(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function findProjectHeaderIndex(headers) {
  return findHeaderIndex(headers, ['投放产品/项目名', '投放产品', '项目名称', '项目名', '合作产品', '推广产品']);
}

function findCategoryHeaderIndex(headers) {
  var exact = findExactHeaderIndex(headers, ['产品', '产品类型', '项目类型', '业务类型', '类型']);
  if (exact >= 0) return exact;
  return findHeaderIndex(headers, ['产品类型', '项目类型', '业务类型']);
}

function findPlatformHeaderIndex(headers) {
  return headers.findIndex(function(header) {
    var text = String(header || '').replace(/\s+/g, '').trim();
    return text === '平台' || text === '合作平台' || text === '发布平台' || text === '平台名称';
  });
}

function findPreferredAmountHeaderIndex(headers) {
  var exactAliases = ['税后集团流水', '最终合作价格', '实际金额', '税后执行金额', '执行金额', '成交金额', '集团流水'];
  for (var i = 0; i < exactAliases.length; i += 1) {
    var alias = exactAliases[i];
    var index = headers.findIndex(function(header) {
      return normalizeHeaderText(header) === alias;
    });
    if (index >= 0) return index;
  }
  return findHeaderIndex(headers, ['税后集团流水', '最终合作价格', '实际金额', '税后执行金额', '执行金额', '集团流水']);
}

function amountFromCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  var text = String(value || '').replace(/,/g, '').replace(/[¥￥元]/g, '').trim();
  if (!text) return 0;
  var parsed = Number(text);
  if (Number.isFinite(parsed)) return parsed;
  return pickAmount(value).value;
}

function makeWorkbookColumnIndex(headers) {
  return {
    group: findHeaderIndex(headers, ['部门', '组别', '小组']),
    currentGroup: findHeaderIndex(headers, ['现账号归属']),
    account: findHeaderIndex(headers, ['账号名称', '账号昵称', '账号', '达人', '博主']),
    originalId: findExactHeaderIndex(headers, ['原ID', '原id']),
    project: findProjectHeaderIndex(headers),
    category: findCategoryHeaderIndex(headers),
    platform: findPlatformHeaderIndex(headers),
    fee: findPreferredAmountHeaderIndex(headers),
    margin: findHeaderIndex(headers, ['部门毛利', '集团毛利值', '毛利']),
    schedule: findHeaderIndex(headers, ['锁定档期', '档期', '月份', '月']),
    note: findHeaderIndex(headers, ['说明', '备注', '链接']),
    groupRevenue: findExactHeaderIndex(headers, ['集团流水']),
    taxRevenue: findExactHeaderIndex(headers, ['税后集团流水']),
    groupMargin: findExactHeaderIndex(headers, ['集团毛利']),
    departmentMargin: findExactHeaderIndex(headers, ['部门毛利']),
    orderAmount: findExactHeaderIndex(headers, ['下单金额']),
    rebateAmount: findExactHeaderIndex(headers, ['返点金额']),
    finalAmount: findExactHeaderIndex(headers, ['最终合作价格', '实际金额']),
    costTotal: findHeaderIndex(headers, ['成本合计']),
    projectedMargin: findHeaderIndex(headers, ['毛利预估']),
    lockDate: findHeaderIndex(headers, ['锁档日期', '锁定档期']),
    publishDate: findHeaderIndex(headers, ['实际发布日期']),
    status: findHeaderIndex(headers, ['执行状态', '项目状态', '发布状态', '状态', '是否发布']),
    productLine: findHeaderIndex(headers, ['游戏/非游']),
    link: findHeaderIndex(headers, ['链接', '发布链接']),
    orderNo: findExactHeaderIndex(headers, ['单号']),
    crmOrderNo: findExactHeaderIndex(headers, ['CRM单号', 'crm单号'])
  };
}

function isUsableWorkbookHeader(idx) {
  return idx.account >= 0 && idx.fee >= 0;
}

function findWorkbookHeaderRow(rows) {
  var best = null;
  rows.slice(0, Math.min(rows.length, 12)).forEach(function(row, rowIndex) {
    var headers = (row || []).map(function(value) { return String(value || '').trim(); });
    var idx = makeWorkbookColumnIndex(headers);
    var score = Object.keys(idx).filter(function(key) { return idx[key] >= 0; }).length;
    if (!isUsableWorkbookHeader(idx)) return;
    if (!best || score > best.score) best = { rowIndex: rowIndex, headers: headers, idx: idx, score: score };
  });
  return best;
}

function monthFromFileName(fileName) {
  var match = String(fileName || '').match(/(1[0-2]|0?[1-9])\s*月/);
  return match ? Number(match[1]) + '月' : '';
}

function projectFromFileName(fileName) {
  var base = path.basename(String(fileName || ''), path.extname(String(fileName || '')));
  var text = base.replace(/^【.*?】/, '').trim();
  if (!text) return '';
  if (/(维护标准|总表|汇总|提报|模板|明细|清单|报表|台账|数据表)/.test(text)) return '';
  return text;
}

function normalizeProjectLabel(value) {
  return String(value || '').trim();
}

function isGenericProjectName(value) {
  var text = normalizeProjectLabel(value);
  if (!text) return true;
  return /(维护标准|总表|汇总|提报|模板|明细|清单|报表|台账|数据表)/.test(text) || text === '未命名项目' || text === '自孵化账号维护标准';
}

function normalizeWorkbookGroup(value) {
  var text = String(value || '').trim();
  var aliases = {
    '内用二组': '内容二组',
    '内容2组': '内容二组',
    '内容4组': '内容四组'
  };
  return aliases[text] || text;
}

function cellText(row, index) {
  return index >= 0 ? String(row[index] || '').trim() : '';
}

function cellAmount(row, index) {
  return index >= 0 ? amountFromCell(row[index]) : 0;
}

function normalizePublishFlag(value, publishDate) {
  var text = String(value == null ? '' : value).trim();
  if (/^(1|true|yes|y|已|是|发布|已发布)$/i.test(text)) return 1;
  if (/^(0|false|no|n|否|未|未发布)$/i.test(text)) return 0;
  return publishDate ? 1 : 0;
}

function normalizePublishLink(value) {
  var text = String(value || '').trim();
  if (!text || /^(未发|未发布|待发|延期|无|暂无|未上线)$/i.test(text)) return '';
  return text;
}

function normalizeExecutionStatus(value, publishDate, link) {
  var text = String(value == null ? '' : value).trim();
  if (/已完成|完成|结案|执行完成/.test(text)) return '已发布';
  if (/^(1|true|yes|y|已|是|发布|已发布|已发|上线|已上线)$/i.test(text)) return '已发布';
  if (/未发布|未发|待发|未上线|延期|取消|^(0|false|no|n|否|未)$/i.test(text)) return '未发布';
  var linkText = String(link || '').trim();
  if (/未发布|未发|待发|未上线|延期|取消/.test(linkText)) return '未发布';
  if (publishDate || normalizePublishLink(linkText)) return '已发布';
  return '未发布';
}

function firstNonBlank() {
  for (var i = 0; i < arguments.length; i += 1) {
    var value = arguments[i];
    if (value == null) continue;
    if (String(value).trim() !== '') return value;
  }
  return '';
}

function parseWorkbookRow(row, idx, fallbackMonth, fallbackProject, fallbackPlatform) {
  if (!row || row.every(function(value) { return String(value || '').trim() === ''; })) return null;
  var groupRevenue = cellAmount(row, idx.groupRevenue);
  var taxRevenue = cellAmount(row, idx.taxRevenue);
  var orderAmount = cellAmount(row, idx.orderAmount);
  var finalAmount = cellAmount(row, idx.finalAmount);
  var fee = idx.fee >= 0 ? amountFromCell(row[idx.fee]) : 0;
  if (!fee) fee = taxRevenue || finalAmount || groupRevenue || orderAmount;
  if (!fee) return null;

  var platform = normalizePlatform(idx.platform >= 0 ? row[idx.platform] : (fallbackPlatform || row.join(' ')));
  var groupMargin = cellAmount(row, idx.groupMargin);
  var departmentMargin = cellAmount(row, idx.departmentMargin);
  var projectedMargin = cellAmount(row, idx.projectedMargin);
  var margin = idx.margin >= 0 ? amountFromCell(row[idx.margin]) : 0;
  if (!margin) margin = departmentMargin || groupMargin || projectedMargin;
  var category = idx.category >= 0 ? String(row[idx.category] || '').trim() : '';
  var project = idx.project >= 0 ? String(row[idx.project] || '').trim() : '';
  if (!project) project = category || fallbackProject || '';
  var publishDate = cellText(row, idx.publishDate);
  var rawLink = cellText(row, idx.link);
  var executionStatus = normalizeExecutionStatus(cellText(row, idx.status), publishDate, rawLink);
  return {
    grp: idx.currentGroup >= 0 ? normalizeWorkbookGroup(row[idx.currentGroup]) : (idx.group >= 0 ? normalizeWorkbookGroup(row[idx.group]) : ''),
    account: idx.account >= 0 ? String(row[idx.account] || '').trim() : '',
    original_id: cellText(row, idx.originalId),
    project: project,
    category: category,
    business_type: category,
    platform: platform,
    fee: fee,
    margin: margin || calcMargin(fee, platform),
    schedule: (idx.schedule >= 0 ? String(row[idx.schedule] || '').trim() : '') || fallbackMonth,
    note: idx.note >= 0 ? String(row[idx.note] || '').trim() : '',
    group_revenue: groupRevenue,
    tax_revenue: taxRevenue,
    group_margin: groupMargin,
    department_margin: departmentMargin,
    order_amount: orderAmount,
    rebate_amount: cellAmount(row, idx.rebateAmount),
    final_amount: finalAmount,
    cost_total: cellAmount(row, idx.costTotal),
    projected_margin: projectedMargin,
    lock_date: cellText(row, idx.lockDate),
    publish_date: publishDate,
    execution_status: executionStatus,
    is_published: executionStatus === '未发布' ? 0 : 1,
    product_line: cellText(row, idx.productLine),
    link: normalizePublishLink(rawLink),
    order_no: cellText(row, idx.orderNo),
    crm_order_no: cellText(row, idx.crmOrderNo)
  };
}

function normalizeSheetNameForMatch(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function isTargetWorkbookSheet(sheetName, targetYear, targetMonth) {
  if (!targetMonth) return true;
  var name = normalizeSheetNameForMatch(sheetName);
  var month = Number(targetMonth);
  var patterns = [
    month + '月',
    String(month).padStart(2, '0') + '月'
  ];
  return patterns.some(function(pattern) {
    return name === normalizeSheetNameForMatch(pattern);
  });
}

function isTargetYearWorkbookSheet(sheetName, targetYear, targetMonth) {
  if (!targetYear || !targetMonth) return false;
  var name = normalizeSheetNameForMatch(sheetName);
  var month = Number(targetMonth);
  var yy = String(Number(targetYear) % 100);
  var patterns = [
    yy + '.' + month + '月',
    yy + '.' + String(month).padStart(2, '0') + '月'
  ];
  return patterns.some(function(pattern) {
    return name === normalizeSheetNameForMatch(pattern);
  });
}

function parseWorkbook(fileData, fileName, options) {
  var XLSX;
  try { XLSX = require('xlsx'); }
  catch(e) { return { error: '缺少 xlsx 依赖，无法解析 Excel' }; }

  try {
    var buffer = Buffer.from(String(fileData || ''), 'base64');
    var workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    if (!workbook.SheetNames.length) return { records: [] };
    var targetYear = options && options.year;
    var targetMonth = options && options.month;
    var records = [];
    var fallbackMonth = monthFromFileName(fileName) || (targetMonth ? Number(targetMonth) + '月' : '');
    var fallbackProject = projectFromFileName(fileName);
    var yearSheetNames = workbook.SheetNames.filter(function(sheetName) {
      return isTargetYearWorkbookSheet(sheetName, targetYear, targetMonth);
    });
    var sheetNames = yearSheetNames.length
      ? yearSheetNames
      : workbook.SheetNames.filter(function(sheetName) {
        return isTargetWorkbookSheet(sheetName, targetYear, targetMonth);
      });
    if (targetMonth && !sheetNames.length) {
      return { error: '未找到 ' + targetYear + ' 年 ' + targetMonth + ' 月对应的工作表，请先切换年月或检查 sheet 名' };
    }

    sheetNames.forEach(function(sheetName, sheetIndex) {
      if (/先不看|不看|ignore/i.test(sheetName)) return;
      var rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
      if (!rows.length) return;

      var header = findWorkbookHeaderRow(rows);
      if (!header) {
        if (sheetIndex > 0) return;
        rows.forEach(function(row) {
          if (!row || row.every(function(value) { return String(value || '').trim() === ''; })) return;
          records = records.concat(parseText(row.join(' ')));
        });
        return;
      }

      rows.slice(header.rowIndex + 1).forEach(function(row) {
        var record = parseWorkbookRow(row, header.idx, fallbackMonth, fallbackProject, sheetName);
        if (record) records.push(record);
      });
    });

    return { records: records };
  } catch(e) {
    return { error: e.message };
  }
}
function methodOf(body) {
  return String((body && body._method) || 'POST').toUpperCase();
}

function openProfitDb() {
  return new sqlite3.Database(PROFIT_DB_PATH);
}

function initProfitDb(db, cb) {
  db.serialize(function() {
    db.run(`CREATE TABLE IF NOT EXISTS profits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grp TEXT NOT NULL,
      project TEXT,
      platform TEXT,
      account TEXT,
      revenue INTEGER DEFAULT 0,
      margin INTEGER DEFAULT 0,
      month TEXT,
      remark TEXT,
      created_at INTEGER
    )`);
    db.run('ALTER TABLE profits ADD COLUMN category TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN business_type TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN entry_source TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN origin_group TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN producer_group TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN origin_share INTEGER DEFAULT 30', function() {});
    db.run('ALTER TABLE profits ADD COLUMN producer_share INTEGER DEFAULT 70', function() {});
    db.run('ALTER TABLE profits ADD COLUMN split_enabled INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN group_revenue INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN tax_revenue INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN group_margin INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN department_margin INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN order_amount INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN rebate_amount INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN final_amount INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN cost_total INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN projected_margin INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN lock_date TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN publish_date TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN execution_status TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN is_published INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN original_id TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN product_line TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN link TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN order_no TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN crm_order_no TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN feishu_record_id TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN feishu_sync_status TEXT', function() {});
    db.run('ALTER TABLE profits ADD COLUMN feishu_synced_at INTEGER DEFAULT 0', function() {});
    db.run('ALTER TABLE profits ADD COLUMN feishu_sync_error TEXT', function() {});
    db.run('CREATE INDEX IF NOT EXISTS idx_profits_grp ON profits(grp)');
    db.run('CREATE INDEX IF NOT EXISTS idx_profits_month ON profits(month)');
    db.run('CREATE INDEX IF NOT EXISTS idx_profits_grp_month ON profits(grp, month)');
    db.run('CREATE INDEX IF NOT EXISTS idx_profits_created ON profits(created_at)', cb);
  });
}

function withProfitDb(cb) {
  var db = openProfitDb();
  initProfitDb(db, function(err) {
    if (err) {
      db.close();
      cb(err);
      return;
    }
    cb(null, db);
  });
}

function normalizeGroup(value) {
  var text = String(value || '').trim();
  return text && text !== '全部' ? text : '';
}

function normalizeSyncText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeAccountKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s·丶_\-—]+/g, '');
}

function isPreservedSyncRecord(record) {
  var text = [
    record.project,
    record.platform,
    record.account,
    record.remark,
    record.category,
    record.business_type
  ].filter(Boolean).join(' ');
  return /平台收益|代做|素材代做/.test(text);
}

function normalizeProfitMeta(record) {
  var publishDate = String(record.publish_date || record.publishDate || '').trim();
  var rawLink = String(record.link || record.url || '').trim();
  var statusSource = firstNonBlank(record.execution_status, record.executionStatus, record.status, record.project_status, record.projectStatus, record.publish_status, record.publishStatus, record.is_published, record.isPublished, record.published);
  var executionStatus = normalizeExecutionStatus(statusSource, publishDate, rawLink);
  return {
    business_type: String(record.business_type || record.businessType || record.category || '').trim(),
    entry_source: String(record.entry_source || record.entrySource || '').trim(),
    origin_group: normalizeGroup(record.origin_group || record.originGroup),
    producer_group: normalizeGroup(record.producer_group || record.producerGroup),
    origin_share: Math.max(0, Math.min(100, Math.round(Number(record.origin_share ?? record.originShare ?? 30) || 0))),
    producer_share: Math.max(0, Math.min(100, Math.round(Number(record.producer_share ?? record.producerShare ?? 70) || 0))),
    split_enabled: record.split_enabled || record.splitEnabled ? 1 : 0,
    group_revenue: Math.round(Number(record.group_revenue ?? record.groupRevenue ?? 0) || 0),
    tax_revenue: Math.round(Number(record.tax_revenue ?? record.taxRevenue ?? 0) || 0),
    group_margin: Math.round(Number(record.group_margin ?? record.groupMargin ?? 0) || 0),
    department_margin: Math.round(Number(record.department_margin ?? record.departmentMargin ?? 0) || 0),
    order_amount: Math.round(Number(record.order_amount ?? record.orderAmount ?? 0) || 0),
    rebate_amount: Math.round(Number(record.rebate_amount ?? record.rebateAmount ?? 0) || 0),
    final_amount: Math.round(Number(record.final_amount ?? record.finalAmount ?? 0) || 0),
    cost_total: Math.round(Number(record.cost_total ?? record.costTotal ?? 0) || 0),
    projected_margin: Math.round(Number(record.projected_margin ?? record.projectedMargin ?? 0) || 0),
    lock_date: String(record.lock_date || record.lockDate || '').trim(),
    publish_date: publishDate,
    execution_status: executionStatus,
    is_published: executionStatus === '未发布' ? 0 : 1,
    original_id: String(record.original_id || record.originalId || '').trim(),
    product_line: String(record.product_line || record.productLine || '').trim(),
    link: normalizePublishLink(rawLink),
    order_no: String(record.order_no || record.orderNo || '').trim(),
    crm_order_no: String(record.crm_order_no || record.crmOrderNo || '').trim()
  };
}

function normalizeSyncRecord(record) {
  var revenue = Number(record.revenue ?? record.fee ?? record.amount ?? 0) || 0;
  var margin = Number(record.margin ?? record.profit ?? 0) || 0;
  var grp = normalizeGroup(record.grp || record.group);
  var month = String(record.month || record.schedule || '').trim();
  var source = [record.project, record.platform, record.account, record.remark, record.note, record.category].filter(Boolean).join(' ');
  var account = String(record.account || '').trim();
  if (!account && /平台收益/.test(source)) account = '平台收益';
  if (!account && /代做|素材代做|素材/.test(source)) account = '素材';
  var meta = normalizeProfitMeta(record);
  return {
    local_id: Math.round(Number(record.local_id ?? record.localId ?? 0) || 0),
    grp: grp,
    project: String(record.project || '').trim(),
    platform: String(record.platform || '').trim(),
    account: account,
    revenue: Math.round(revenue),
    margin: Math.round(margin),
    month: month,
    remark: String(record.remark || record.note || '').trim(),
    category: record.category == null ? meta.business_type : String(record.category).trim(),
    business_type: meta.business_type,
    entry_source: meta.entry_source,
    origin_group: meta.origin_group,
    producer_group: meta.producer_group,
    origin_share: meta.origin_share,
    producer_share: meta.producer_share,
    split_enabled: meta.split_enabled,
    group_revenue: meta.group_revenue,
    tax_revenue: meta.tax_revenue,
    group_margin: meta.group_margin,
    department_margin: meta.department_margin,
    order_amount: meta.order_amount,
    rebate_amount: meta.rebate_amount,
    final_amount: meta.final_amount,
    cost_total: meta.cost_total,
    projected_margin: meta.projected_margin,
    lock_date: meta.lock_date,
    publish_date: meta.publish_date,
    execution_status: meta.execution_status,
    is_published: meta.is_published,
    original_id: meta.original_id,
    product_line: meta.product_line,
    link: meta.link,
    order_no: meta.order_no,
    crm_order_no: meta.crm_order_no
  };
}

function syncRecordKey(record) {
  return [
    normalizeSyncText(record.grp),
    normalizeSyncText(record.month),
    normalizeSyncText(record.account),
    normalizeSyncText(record.project),
    normalizeSyncText(record.platform),
    normalizeSyncText(record.category),
    normalizeSyncText(record.business_type),
    normalizeSyncText(record.origin_group),
    normalizeSyncText(record.producer_group)
  ].join('|');
}

module.exports = function createProfitRoutes(deps) {
  var runPython = deps.runPython;

  function triggerFeishuProfitSync(id) {
    if (!id || !runPython) return;
    runPython('feishu_profit.py', 'upsert_profit', { id: id }, 90).catch(function() {});
  }

  function appendDateFilters(where, params, year, month) {
    var normalizedYear = Number(year || 0) || 0;
    var normalizedMonth = Number(month || 0) || 0;
    if (normalizedYear) {
      where.push('month LIKE ?');
      params.push(String(normalizedYear) + '%');
    }
    if (normalizedMonth) {
      var monthText = String(normalizedMonth);
      var paddedMonthText = String(normalizedMonth).padStart(2, '0');
      where.push('(month LIKE ? OR month LIKE ? OR month LIKE ?)');
      params.push((normalizedYear ? String(normalizedYear) + '\u5e74' : '%') + monthText + '\u6708%');
      params.push((normalizedYear ? String(normalizedYear) + '\u5e74' : '%') + paddedMonthText + '\u6708%');
      params.push('%' + monthText + '\u6708%');
    }
  }

  function list(body, cb) {
    var grp = normalizeGroup(body.grp);
    var year = Number(body.year || 0) || 0;
    var month = Number(body.month || 0) || 0;
    withProfitDb(function(err, db) {
      if (err) { cb({ error: err.message }); return; }
      var where = [];
      var params = [];
      if (grp) {
        where.push('grp=?');
        params.push(grp);
      }
      appendDateFilters(where, params, year, month);
      var sql = 'SELECT * FROM profits' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC';
      db.all(sql, params, function(queryErr, rows) {
        db.close();
        if (queryErr) { cb({ error: queryErr.message }); return; }
        cb({ data: rows || [] });
      });
    });
  }

  function stats(body, cb) {
    var grp = normalizeGroup(body.grp);
    var year = Number(body.year || 0) || 0;
    var month = Number(body.month || 0) || 0;
    withProfitDb(function(err, db) {
      if (err) { cb({ error: err.message }); return; }
      var where = [];
      var params = [];
      if (grp) {
        where.push('grp=?');
        params.push(grp);
      }
      appendDateFilters(where, params, year, month);
      var sql = 'SELECT SUM(revenue) as total_revenue, SUM(margin) as total_margin, COUNT(*) as count FROM profits'
        + (where.length ? ' WHERE ' + where.join(' AND ') : '');
      db.get(sql, params, function(queryErr, row) {
        db.close();
        if (queryErr) { cb({ error: queryErr.message }); return; }
        cb({
          total_revenue: (row && row.total_revenue) || 0,
          total_margin: (row && row.total_margin) || 0,
          count: (row && row.count) || 0
        });
      });
    });
  }

  function add(body, cb) {
    withProfitDb(function(err, db) {
      if (err) { cb({ error: err.message }); return; }
      var meta = normalizeProfitMeta(body);
      db.run(
        `INSERT INTO profits (
          grp,project,platform,account,revenue,margin,month,remark,created_at,category,
          business_type,entry_source,origin_group,producer_group,origin_share,producer_share,split_enabled,
          group_revenue,tax_revenue,group_margin,department_margin,order_amount,rebate_amount,final_amount,
          cost_total,projected_margin,lock_date,publish_date,execution_status,is_published,original_id,product_line,link,order_no,crm_order_no
        ) VALUES (${Array(35).fill('?').join(',')})`,
        [
          body.grp || '',
          body.project || '',
          body.platform || '',
          body.account || '',
          Number(body.revenue) || 0,
          Number(body.margin) || 0,
          body.month || '',
          body.remark || '',
          Math.floor(Date.now() / 1000),
          body.category == null ? meta.business_type : String(body.category).trim(),
          meta.business_type,
          meta.entry_source,
          meta.origin_group,
          meta.producer_group,
          meta.origin_share,
          meta.producer_share,
          meta.split_enabled,
          meta.group_revenue,
          meta.tax_revenue,
          meta.group_margin,
          meta.department_margin,
          meta.order_amount,
          meta.rebate_amount,
          meta.final_amount,
          meta.cost_total,
          meta.projected_margin,
          meta.lock_date,
          meta.publish_date,
          meta.execution_status,
          meta.is_published,
          meta.original_id,
          meta.product_line,
          meta.link,
          meta.order_no,
          meta.crm_order_no
        ],
        function(insertErr) {
          var insertedId = this && this.lastID;
          db.close();
          if (insertErr) { cb({ error: insertErr.message }); return; }
          triggerFeishuProfitSync(insertedId);
          cb({ id: insertedId });
        }
      );
    });
  }

  function update(body, cb) {
    var id = body.id;
    if (!id) { cb({ error: 'id required' }); return; }
    withProfitDb(function(err, db) {
      if (err) { cb({ error: err.message }); return; }
      var meta = normalizeProfitMeta(body);
      db.run(
        `UPDATE profits SET
          grp=?,project=?,platform=?,account=?,revenue=?,margin=?,month=?,remark=?,category=?,
          business_type=?,entry_source=?,origin_group=?,producer_group=?,origin_share=?,producer_share=?,split_enabled=?,
          group_revenue=?,tax_revenue=?,group_margin=?,department_margin=?,order_amount=?,rebate_amount=?,final_amount=?,
          cost_total=?,projected_margin=?,lock_date=?,publish_date=?,execution_status=?,is_published=?,original_id=?,product_line=?,link=?,order_no=?,crm_order_no=?
         WHERE id=?`,
        [
          body.grp || '',
          body.project || '',
          body.platform || '',
          body.account || '',
          Number(body.revenue) || 0,
          Number(body.margin) || 0,
          body.month || '',
          body.remark || '',
          body.category == null ? meta.business_type : String(body.category).trim(),
          meta.business_type,
          meta.entry_source,
          meta.origin_group,
          meta.producer_group,
          meta.origin_share,
          meta.producer_share,
          meta.split_enabled,
          meta.group_revenue,
          meta.tax_revenue,
          meta.group_margin,
          meta.department_margin,
          meta.order_amount,
          meta.rebate_amount,
          meta.final_amount,
          meta.cost_total,
          meta.projected_margin,
          meta.lock_date,
          meta.publish_date,
          meta.execution_status,
          meta.is_published,
          meta.original_id,
          meta.product_line,
          meta.link,
          meta.order_no,
          meta.crm_order_no,
          id
        ],
        function(updateErr) {
          db.close();
          if (updateErr) { cb({ error: updateErr.message }); return; }
          triggerFeishuProfitSync(id);
          cb({ success: true });
        }
      );
    });
  }

  function remove(body, cb) {
    var id = body.id;
    if (!id) { cb({ error: 'id required' }); return; }
    withProfitDb(function(err, db) {
      if (err) { cb({ error: err.message }); return; }
      db.run('DELETE FROM profits WHERE id=?', [id], function(deleteErr) {
        db.close();
        if (deleteErr) { cb({ error: deleteErr.message }); return; }
        cb({ success: true });
      });
    });
  }

  function parse(body, cb) {
    if (body.file_data) {
      cb(parseWorkbook(body.file_data, body.file_name, { year: body.year, month: body.month }));
      return;
    }
    cb({ records: parseText(body.text || '') });
  }

  function sync(body, cb) {
    var syncMode = String(body.mode || 'sync').toLowerCase();
    var incrementalMode = syncMode === 'incremental' || syncMode === 'append';
    var mergeMode = syncMode === 'merge' || syncMode === 'pull';
    var sourceRecords = Array.isArray(body.records) ? body.records : [];
    var normalized = sourceRecords
      .map(normalizeSyncRecord)
      .filter(function(record) {
        return record.grp && record.account && record.month;
      });

    if (!normalized.length) {
      cb({ error: 'records required' });
      return;
    }

    withProfitDb(function(err, db) {
      if (err) { cb({ error: err.message }); return; }

      function run(sql, params) {
        return new Promise(function(resolve, reject) {
          db.run(sql, params || [], function(runErr) {
            if (runErr) reject(runErr);
            else resolve(this);
          });
        });
      }

      function all(sql, params) {
        return new Promise(function(resolve, reject) {
          db.all(sql, params || [], function(queryErr, rows) {
            if (queryErr) reject(queryErr);
            else resolve(rows || []);
          });
        });
      }

      function resolveHistoricalProjects(records) {
        var accountMap = new Map();
        records.forEach(function(record) {
          var rawAccount = normalizeProjectLabel(record.account);
          var key = normalizeAccountKey(rawAccount);
          if (!key) return;
          if (!accountMap.has(key)) accountMap.set(key, rawAccount);
        });
        var accountKeys = new Set(accountMap.keys());
        if (!accountKeys.size) return Promise.resolve(new Map());
        return (async function() {
          var historyRows = await all(
            'SELECT account, project FROM profits WHERE project IS NOT NULL AND TRIM(project) <> "" ORDER BY created_at DESC, id DESC',
            []
          );
          var history = new Map();
          historyRows.forEach(function(row) {
            var accountKey = normalizeAccountKey(row.account);
            if (!accountKeys.has(accountKey)) return;
            var project = normalizeProjectLabel(row.project);
            if (!accountKey || !project || isGenericProjectName(project) || history.has(accountKey)) return;
            history.set(accountKey, project);
          });
          accountKeys.forEach(function(accountKey) {
            if (history.has(accountKey)) return;
            var candidates = historyRows
              .filter(function(row) {
                var rowKey = normalizeAccountKey(row.account);
                return rowKey && (rowKey.indexOf(accountKey) >= 0 || accountKey.indexOf(rowKey) >= 0);
              })
              .map(function(row) {
                return normalizeProjectLabel(row.project);
              })
              .filter(function(project) {
                return project && !isGenericProjectName(project);
              });
            if (candidates.length === 1) history.set(accountKey, candidates[0]);
          });
          return history;
        })();
      }

      (async function() {
        normalized = normalized.map(function(record) {
          return Object.assign({}, record, { __genericSourceProject: isGenericProjectName(record.project) });
        });
        var historicalProjects = await resolveHistoricalProjects(normalized);
        normalized = normalized.map(function(record) {
          if (!isGenericProjectName(record.project)) return record;
          var resolvedProject = historicalProjects.get(normalizeAccountKey(record.account));
          if (!resolvedProject) return record;
          return Object.assign({}, record, { project: resolvedProject });
        });
        var normalizedTotal = normalized.length;

        var grouped = new Map();
        var stats = { inserted: 0, updated: 0, deleted: 0, preserved: 0, skipped: 0 };
        var directIdRecords = [];

        function updateStoredRecord(record, id) {
          return run(
            `UPDATE profits SET
              grp=?, project=?, platform=?, account=?, revenue=?, margin=?, month=?, remark=?, category=?,
              business_type=?, entry_source=?, origin_group=?, producer_group=?, origin_share=?, producer_share=?, split_enabled=?,
              group_revenue=?, tax_revenue=?, group_margin=?, department_margin=?, order_amount=?, rebate_amount=?, final_amount=?,
              cost_total=?, projected_margin=?, lock_date=?, publish_date=?, execution_status=?, is_published=?, original_id=?, product_line=?, link=?, order_no=?, crm_order_no=?
             WHERE id=?`,
            [
              record.grp,
              record.project,
              record.platform,
              record.account,
              record.revenue,
              record.margin,
              record.month,
              record.remark,
              record.category,
              record.business_type,
              record.entry_source,
              record.origin_group,
              record.producer_group,
              record.origin_share,
              record.producer_share,
              record.split_enabled,
              record.group_revenue,
              record.tax_revenue,
              record.group_margin,
              record.department_margin,
              record.order_amount,
              record.rebate_amount,
              record.final_amount,
              record.cost_total,
              record.projected_margin,
              record.lock_date,
              record.publish_date,
              record.execution_status,
              record.is_published,
              record.original_id,
              record.product_line,
              record.link,
              record.order_no,
              record.crm_order_no,
              id
            ]
          );
        }

        function insertStoredRecord(record) {
          return run(
            `INSERT INTO profits (
              grp, project, platform, account, revenue, margin, month, remark, created_at, category,
              business_type, entry_source, origin_group, producer_group, origin_share, producer_share, split_enabled,
              group_revenue, tax_revenue, group_margin, department_margin, order_amount, rebate_amount, final_amount,
              cost_total, projected_margin, lock_date, publish_date, execution_status, is_published, original_id, product_line, link, order_no, crm_order_no
            ) VALUES (${Array(35).fill('?').join(', ')})`,
            [
              record.grp,
              record.project,
              record.platform,
              record.account,
              record.revenue,
              record.margin,
              record.month,
              record.remark,
              Math.floor(Date.now() / 1000),
              record.category,
              record.business_type,
              record.entry_source,
              record.origin_group,
              record.producer_group,
              record.origin_share,
              record.producer_share,
              record.split_enabled,
              record.group_revenue,
              record.tax_revenue,
              record.group_margin,
              record.department_margin,
              record.order_amount,
              record.rebate_amount,
              record.final_amount,
              record.cost_total,
              record.projected_margin,
              record.lock_date,
              record.publish_date,
              record.execution_status,
              record.is_published,
              record.original_id,
              record.product_line,
              record.link,
              record.order_no,
              record.crm_order_no
            ]
          );
        }

        if (mergeMode) {
          normalized = normalized.filter(function(record) {
            if (!record.local_id) return true;
            directIdRecords.push(record);
            return false;
          });
        }

        normalized.forEach(function(record) {
          var key = record.grp + '\u0000' + record.month;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(record);
        });

        await run('BEGIN IMMEDIATE');
        try {
          for (var directIndex = 0; directIndex < directIdRecords.length; directIndex += 1) {
            var directRecord = directIdRecords[directIndex];
            var directRows = await all('SELECT id FROM profits WHERE id=? LIMIT 1', [directRecord.local_id]);
            if (directRows.length) {
              await updateStoredRecord(directRecord, directRecord.local_id);
              stats.updated += 1;
            } else {
              await insertStoredRecord(directRecord);
              stats.inserted += 1;
            }
          }

          for (var entry of grouped.entries()) {
            var scope = entry[0].split('\u0000');
            var grp = scope[0];
            var month = scope[1];
            var scopeRecords = entry[1];
            var isProjectlessImport = scopeRecords.every(function(record) {
              return record.__genericSourceProject;
            });
            var existingRows = await all('SELECT * FROM profits WHERE grp=? AND month=?', [grp, month]);
            var incomingByKey = new Map();
            var reusableExistingByKey = new Map();

            scopeRecords.forEach(function(record) {
              var key = syncRecordKey(record);
              if (!incomingByKey.has(key)) incomingByKey.set(key, []);
              incomingByKey.get(key).push(record);
            });

            for (var i = 0; i < existingRows.length; i += 1) {
              var existing = existingRows[i];
              var existingKey = syncRecordKey(existing);
              var incomingBucket = incomingByKey.get(existingKey);
              if (incomingBucket && incomingBucket.length) {
                incomingBucket.shift();
                if (!reusableExistingByKey.has(existingKey)) reusableExistingByKey.set(existingKey, []);
                reusableExistingByKey.get(existingKey).push(existing);
                continue;
              }
              if (incrementalMode || mergeMode) {
                stats.preserved += 1;
                continue;
              }
              if (isProjectlessImport && !isGenericProjectName(existing.project)) {
                stats.preserved += 1;
                continue;
              }
              if (isPreservedSyncRecord(existing)) {
                stats.preserved += 1;
                continue;
              }
              await run('DELETE FROM profits WHERE id=?', [existing.id]);
              stats.deleted += 1;
            }

            for (var j = 0; j < scopeRecords.length; j += 1) {
              var record = scopeRecords[j];
              var key = syncRecordKey(record);
              var existingBucket = reusableExistingByKey.get(key);
              var matched = existingBucket && existingBucket.length ? existingBucket.shift() : null;
              if (matched) {
                if (incrementalMode) {
                  stats.skipped += 1;
                  continue;
                }
                await updateStoredRecord(record, matched.id);
                stats.updated += 1;
                continue;
              }
              await insertStoredRecord(record);
              stats.inserted += 1;
            }
          }

          await run('COMMIT');
          cb({
            success: true,
            inserted: stats.inserted,
            updated: stats.updated,
            deleted: stats.deleted,
            preserved: stats.preserved,
            skipped: stats.skipped,
            total: normalizedTotal
          });
        } catch (syncErr) {
          await run('ROLLBACK').catch(function() {});
          cb({ error: syncErr.message || String(syncErr) });
        } finally {
          db.close();
        }
      })().catch(function(syncErr) {
        db.close();
        cb({ error: syncErr.message || String(syncErr) });
      });
    });
  }

  function collection(body, cb) {
    var method = methodOf(body);
    if (method === 'GET') { list(body, cb); return; }
    if (method === 'POST') { add(body, cb); return; }
    cb({ error: 'method not allowed' });
  }

  function item(body, cb) {
    var method = methodOf(body);
    if (method === 'PATCH' || method === 'PUT') { update(body, cb); return; }
    if (method === 'DELETE') { remove(body, cb); return; }
    cb({ error: 'method not allowed' });
  }

  function syncFeishu(body, cb) {
    if (!runPython) { cb({ error: 'python runtime not available' }); return; }
    runPython('feishu_profit.py', 'sync_all_profit', {
      limit: Number(body.limit) || 0,
      force: body.force !== false
    }, 10 * 60).then(cb).catch(function(err) {
      cb({ error: err && err.message || String(err) });
    });
  }

  function pullFeishuSpreadsheet(body, cb) {
    if (!runPython) { cb({ error: 'python runtime not available' }); return; }
    runPython('feishu_profit.py', 'read_profit_spreadsheet', {
      year: Number(body.year) || 0,
      month: Number(body.month) || 0
    }, 10 * 60).then(function(result) {
      if (result.error || (result.code && !Array.isArray(result.records))) {
        cb({ error: result.error || result.msg || '飞书读取失败', feishu: result });
        return;
      }
      var records = Array.isArray(result.records) ? result.records : [];
      if (!records.length) {
        cb({
          success: true,
          inserted: 0,
          updated: 0,
          deleted: 0,
          preserved: 0,
          skipped: 0,
          total: 0,
          feishu_total: 0,
          sheets: result.sheets || [],
          errors: result.errors || []
        });
        return;
      }
      sync({ records: records, mode: body.mode || 'merge' }, function(syncResult) {
        if (syncResult && syncResult.error) {
          cb(Object.assign({ feishu_total: records.length, sheets: result.sheets || [], errors: result.errors || [] }, syncResult));
          return;
        }
        cb(Object.assign({}, syncResult || {}, {
          feishu_total: records.length,
          sheets: result.sheets || [],
          errors: result.errors || [],
          url: result.url || ''
        }));
      });
    }).catch(function(err) {
      cb({ error: err && err.message || String(err) });
    });
  }

  return {
    '/api/feishu/profit': function(body, cb) {
      runPython('feishu_profit.py', 'read', {}, 60).then(cb);
    },

    // Legacy endpoints kept for current screens and compatibility.
    '/api/profit/list': list,
    '/api/profit/stats': stats,
    '/api/profit/add': add,
    '/api/profit/update': update,
    '/api/profit/delete': remove,
    '/api/profit/parse': parse,
    '/api/profit/sync': sync,

    // Preferred endpoints for new UI code.
    '/api/profits': collection,
    '/api/profits/:id': item,
    '/api/profits/stats': stats,
    '/api/profits/parse': parse,
    '/api/profits/sync': sync,
    '/api/profits/sync-feishu': syncFeishu,
    '/api/profits/pull-feishu': pullFeishuSpreadsheet
  };
};
