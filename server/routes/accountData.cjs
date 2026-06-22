const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { dashboardProfileMeta, dataMaintenanceProfile, publishAccountCatalog, publishVolumeExcluded } = require('../lib/accountCatalog.cjs');

let XLSX = null;
try { XLSX = require('xlsx'); } catch (e) { XLSX = null; }
let sqlite3 = null;
try { sqlite3 = require('sqlite3').verbose(); } catch (e) { sqlite3 = null; }

module.exports = function createAccountDataRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const repoRoot = path.join(__dirname, '..', '..');
  const exportDir = path.join(root, 'data', 'data-export-tests');
  const collectStateFile = path.join(root, 'data', 'account-data-collect-state.json');
  const collectIndexFile = path.join(root, 'data', 'account-data-collect-index.json');
  const scheduleDbFile = path.join(root, 'data', 'schedule.db');
  const profitDbFile = path.join(root, 'data', 'profit.db');
  const collectScript = path.join(repoRoot, 'scripts', 'collect-platform-data.cjs');
  const collectBatchScript = path.join(repoRoot, 'scripts', 'collect-account-data-batch.cjs');
  const scheduledHours = parseScheduledHours(process.env.ACCOUNT_DATA_SCHEDULE_HOURS) || [8, 16];
  let collectProcess = null;
  let collectScheduler = null;
  let lastScheduleSlot = '';
  let collectIndexCache = null;

  const profileMeta = dashboardProfileMeta();
  const allowedProfiles = new Set(Object.keys(profileMeta));

  const platformLabels = {
    douyin: '\u6296\u97f3',
    kuaishou: '\u5feb\u624b',
    bilibili: 'B\u7ad9',
    xiaohongshu: '\u5c0f\u7ea2\u4e66',
    wechatVideo: '\u89c6\u9891\u53f7',
  };
  const rangeKeys = ['yesterday', 'week', 'month', 'year', 'all'];
  const platformDefaultScopes = {
    douyin: {
      fans: '粉丝：账号总览近30天，总粉丝量/净增粉丝量',
      works: '作品：抖音创作者中心作品分析数据，按发布时间归入对应口径',
    },
    kuaishou: {
      fans: '粉丝：数据概览近30天，净增粉丝量',
      works: '作品：快手创作者服务平台作品数据，按发布时间归入对应口径',
    },
    bilibili: {
      fans: '粉丝：数据中心粉丝导出表',
      works: '作品：数据中心投稿/作品分析数据，按发布时间归入对应口径'
    },
    xiaohongshu: {
      fans: '粉丝：账号数据概览',
      works: '作品：小红书创作中心作品数据，按发布时间归入对应口径'
    },
    wechatVideo: {
      fans: '粉丝：账号数据概览',
      works: '作品：视频号助手作品数据，按发布时间归入对应口径'
    }
  };

  function safeReadJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  }

  function safeWriteJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    try {
      fs.renameSync(temp, file);
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error && error.code)) {
        fs.copyFileSync(temp, file);
        fs.unlinkSync(temp);
        return;
      }
      try { fs.unlinkSync(temp); } catch (e) {}
      throw error;
    }
  }

  function tailText(value, limit) {
    const text = String(value || '');
    return text.length > limit ? text.slice(text.length - limit) : text;
  }

  function splitArg(value) {
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  }

  function parseScheduledHours(value) {
    const hours = splitArg(value)
      .map(item => Number(item))
      .filter(item => Number.isInteger(item) && item >= 0 && item <= 23);
    return hours.length ? Array.from(new Set(hours)).sort((a, b) => a - b) : null;
  }

  function defaultCollectTargets(options) {
    const requestedPlatforms = splitArg(
      (options && options.platforms) || process.env.ACCOUNT_DATA_COLLECT_PLATFORMS || 'douyin,kuaishou,bilibili'
    );
    const seen = new Set();
    const targets = [];
    for (const platformId of requestedPlatforms) {
      for (const account of publishAccountCatalog()) {
        for (const platform of account.platforms || []) {
          if (platform.id !== platformId) continue;
          if (platform.runnable === false) continue;
          const alias = String(platform.profile_alias || platform.profile || '').trim();
          const key = [alias, platform.id].join(':');
          if (!alias || seen.has(key)) continue;
          seen.add(key);
          targets.push({
            profile: alias,
            platform: platform.id,
            account: account.dashboardName || account.name || alias
          });
        }
      }
    }
    return targets;
  }

  function defaultCollectProfiles() {
    const seen = new Set();
    const profiles = [];
    for (const target of defaultCollectTargets()) {
      const alias = String(target.profile || '').trim();
      if (!alias || seen.has(alias)) continue;
      seen.add(alias);
      profiles.push(alias);
    }
    return profiles;
  }

  function parseCollectTargets(value) {
    return splitArg(value).map(item => {
      const index = item.lastIndexOf(':');
      if (index <= 0 || index >= item.length - 1) return null;
      return {
        profile: item.slice(0, index).trim(),
        platform: item.slice(index + 1).trim()
      };
    }).filter(item => item && item.profile && item.platform);
  }

  function serializeCollectTarget(target) {
    return [target.profile, target.platform].join(':');
  }

  function uniqueProfiles(targets) {
    const seen = new Set();
    const profiles = [];
    for (const target of targets || []) {
      const alias = String(target.profile || '').trim();
      if (!alias || seen.has(alias)) continue;
      seen.add(alias);
      profiles.push(alias);
    }
    return profiles;
  }

  function selectCollectProfiles(options) {
    const requestedTargets = parseCollectTargets(options.targets || process.env.ACCOUNT_DATA_COLLECT_TARGETS || '');
    if (requestedTargets.length) {
      return {
        profiles: uniqueProfiles(requestedTargets),
        targets: requestedTargets,
        targetMode: true,
        queue: { explicit: true, unit: 'account_platform', total: requestedTargets.length, offset: 0, nextOffset: 0, max: requestedTargets.length }
      };
    }
    const requestedProfiles = splitArg(options.profiles || process.env.ACCOUNT_DATA_COLLECT_PROFILES || '');
    if (requestedProfiles.length) {
      return {
        profiles: requestedProfiles,
        targetMode: false,
        queue: { explicit: true, unit: 'profile', total: requestedProfiles.length, offset: 0, nextOffset: 0, max: requestedProfiles.length }
      };
    }
    if (options.profile) {
      return {
        profiles: [String(options.profile)],
        targetMode: false,
        queue: { explicit: true, unit: 'profile', total: 1, offset: 0, nextOffset: 0, max: 1 }
      };
    }
    const allTargets = defaultCollectTargets(options);
    const maxTargets = parseMaxProfiles(
      options.maxTargets || process.env.ACCOUNT_DATA_COLLECT_MAX_TARGETS || options.maxProfiles || process.env.ACCOUNT_DATA_COLLECT_MAX_PROFILES,
      allTargets.length,
      12
    );
    const state = readCollectState();
    const offset = allTargets.length
      ? ((Number(state.nextCollectTargetOffset ?? state.nextProfileOffset) || 0) % allTargets.length)
      : 0;
    const targets = [];
    for (let i = 0; i < Math.min(maxTargets, allTargets.length); i += 1) {
      targets.push(allTargets[(offset + i) % allTargets.length]);
    }
    const nextOffset = allTargets.length ? ((offset + targets.length) % allTargets.length) : 0;
    return {
      profiles: uniqueProfiles(targets),
      targets,
      targetMode: true,
      nextProfileOffset: nextOffset,
      nextCollectTargetOffset: nextOffset,
      queue: { explicit: false, unit: 'account_platform', total: allTargets.length, offset, nextOffset, max: maxTargets }
    };
  }

  function parseMaxProfiles(value, total, fallback) {
    const count = Math.max(1, Number(total) || 1);
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    if (raw === 'all' || raw === 'full' || raw === '*') return count;
    const parsed = Number(raw || fallback);
    return Math.max(1, Math.min(count, Number.isFinite(parsed) ? parsed : fallback));
  }

  function readCollectState() {
    return safeReadJson(collectStateFile) || {
      ok: true,
      running: false,
      scheduleHours: scheduledHours,
      lastRun: null,
      lastSummaryFile: ''
    };
  }

  function writeCollectState(patch) {
    const next = Object.assign({}, readCollectState(), patch || {}, {
      scheduleHours: scheduledHours,
      updatedAt: new Date().toISOString()
    });
    safeWriteJson(collectStateFile, next);
    return next;
  }

  function listSummaryFiles() {
    if (!fs.existsSync(exportDir)) return [];
    return fs.readdirSync(exportDir)
      .filter(name => /^platform-data-summary-.+\.json$/i.test(name))
      .map(name => {
        const full = path.join(exportDir, name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(full).mtimeMs; } catch (e) {}
        return { full, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  function latestSummaryAfter(startedMs) {
    return listSummaryFiles().find(item => item.mtimeMs >= startedMs - 1000) || null;
  }


  function listBatchSummaryFiles() {
    if (!fs.existsSync(exportDir)) return [];
    return fs.readdirSync(exportDir)
      .filter(name => /^account-data-batch-summary-\d+\.json$/i.test(name))
      .map(name => {
        const full = path.join(exportDir, name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(full).mtimeMs; } catch (e) {}
        return { full, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  function collectSourceStats(files) {
    let newestMtimeMs = 0;
    let newestFile = '';
    let totalMtimeMs = 0;
    for (const item of files || []) {
      const mtimeMs = Math.round(Number(item.mtimeMs) || 0);
      totalMtimeMs += mtimeMs;
      if (mtimeMs > newestMtimeMs) {
        newestMtimeMs = mtimeMs;
        newestFile = item.full || '';
      }
    }
    return {
      count: Array.isArray(files) ? files.length : 0,
      newestMtimeMs,
      totalMtimeMs,
      newestFile: newestFile ? path.basename(newestFile) : ''
    };
  }

  function collectSourceSnapshot() {
    const platformSummaries = listSummaryFiles();
    const batchSummaries = listBatchSummaryFiles();
    const platform = collectSourceStats(platformSummaries);
    const batch = collectSourceStats(batchSummaries);
    const digest = [
      platform.count,
      platform.newestMtimeMs,
      platform.totalMtimeMs,
      platform.newestFile,
      batch.count,
      batch.newestMtimeMs,
      batch.totalMtimeMs,
      batch.newestFile
    ].join('|');
    return { platformSummaries, batchSummaries, platform, batch, digest };
  }

  function collectIndexIsFresh(index, snapshot) {
    return Boolean(
      index
      && index.ok
      && index.version >= 3
      && index.sourceStats
      && index.sourceStats.digest === snapshot.digest
    );
  }

  function buildCollectIndex(sourceSnapshot) {
    const snapshot = sourceSnapshot || collectSourceSnapshot();
    const latestDatasets = {};
    const datasetHistory = [];
    const runs = [];
    const platformSummaries = snapshot.platformSummaries.slice().sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const item of platformSummaries) {
      const summary = safeReadJson(item.full);
      if (!summary) continue;
      const profile = profileKey(summary);
      const mismatch = summaryProfileMismatch(summary);
      const run = {
        type: 'platform',
        profile,
        ok: summary.ok !== false,
        skipped: Boolean(summary.skipped) || Boolean(mismatch),
        skipReason: mismatch ? 'profile_mismatch' : (summary.skipReason || ''),
        requestedProfile: String(summary.requestedProfile || '').trim(),
        actualProfile: actualProfileKey(summary),
        startedAt: summary.startedAt || '',
        finishedAt: summary.finishedAt || summary.startedAt || '',
        summaryFile: item.full,
        datasets: []
      };
      if (mismatch) {
        runs.push(run);
        continue;
      }
      for (const dataset of summary.datasets || []) {
        const row = {
          profile,
          platform: dataset.platform || '',
          dataset: dataset.dataset || '',
          ok: dataset.ok !== false,
          rows: dataset.rows,
          file: dataset.file || '',
          source: dataset.source || '',
          scope: dataset.sourceScope || '',
          collectedAt: summary.finishedAt || summary.startedAt || '',
          summaryFile: item.full
        };
        run.datasets.push(row);
        datasetHistory.push(row);
        if (!row.ok || !row.platform || !row.dataset || !row.file) continue;
        const key = [profile, row.platform, row.dataset].join(':');
        latestDatasets[key] = row;
      }
      runs.push(run);
    }
    for (const item of snapshot.batchSummaries.slice().sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      const summary = safeReadJson(item.full);
      if (!summary) continue;
      runs.push({
        type: 'batch',
        ok: summary.ok !== false,
        profiles: summary.profiles || [],
        startedAt: summary.startedAt || '',
        finishedAt: summary.finishedAt || summary.startedAt || '',
        summaryFile: item.full,
        skippedProfiles: (summary.results || []).filter(row => row && row.skipped).map(row => row.profile).filter(Boolean),
        resultCount: Array.isArray(summary.results) ? summary.results.length : 0
      });
    }
    runs.sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')));
    const index = {
      ok: true,
      version: 3,
      generatedAt: new Date().toISOString(),
      sourceDir: exportDir,
      sourceStats: {
        digest: snapshot.digest,
        platform: snapshot.platform,
        batch: snapshot.batch
      },
      latestDatasets,
      datasetHistory,
      runs
    };
    safeWriteJson(collectIndexFile, index);
    collectIndexCache = { digest: snapshot.digest, index };
    return index;
  }

  function readCollectIndex(options) {
    const force = Boolean(options && options.force);
    const snapshot = collectSourceSnapshot();
    if (!force && collectIndexCache && collectIndexCache.digest === snapshot.digest) return collectIndexCache.index;
    const existing = force ? null : safeReadJson(collectIndexFile);
    if (!force && collectIndexIsFresh(existing, snapshot)) {
      collectIndexCache = { digest: snapshot.digest, index: existing };
      return existing;
    }
    return buildCollectIndex(snapshot);
  }

  function readTable(file) {
    if (!XLSX || !file || !fs.existsSync(file)) return [];
    try {
      const workbook = XLSX.readFile(file, { cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    } catch (e) {
      return [];
    }
  }

  function pick(row, keys) {
    for (const key of keys) {
      if (row && row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
    }
    return '';
  }

  function pickByHeader(row, patterns) {
    if (!row) return '';
    const entries = Object.entries(row);
    for (const pattern of patterns) {
      for (const [key, value] of entries) {
        if (value === undefined || value === null || value === '') continue;
        if (pattern.test(String(key || ''))) return value;
      }
    }
    return '';
  }

  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    let raw = String(value || '').trim();
    if (!raw || raw === '-') return 0;
    raw = raw.replace(/,/g, '');
    let multiplier = 1;
    if (/[\u4e07\u842c]/.test(raw)) multiplier = 10000;
    if (/[\u4ebf\u5104]/.test(raw)) multiplier = 100000000;
    raw = raw.replace(/[^\d.-]/g, '');
    const num = Number(raw);
    return Number.isFinite(num) ? num * multiplier : 0;
  }

  function toPercent(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '-') return 0;
    const num = toNumber(raw);
    if (raw.indexOf('%') >= 0) return num;
    if (num > 0 && num <= 1) return num * 100;
    return num;
  }

  function parseDateTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/[\u5e74\u6708]/g, '/').replace(/[\u65e5]/g, '').replace(/-/g, '/');
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date;
    return null;
  }

  function dateKey(value) {
    const date = value instanceof Date ? value : parseDateTime(value);
    if (!date) return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function normalizeMatchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[\s\u200b\u200c\u200d]+/g, '')
      .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '');
  }

  function platformIdFromLabel(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/b站|bilibili|哔哩|B站/i.test(text)) return 'bilibili';
    if (/抖音|douyin|巨量|星图/i.test(text)) return 'douyin';
    if (/快手|kuaishou|磁力聚星|快接单/i.test(text)) return 'kuaishou';
    if (/小红书|xiaohongshu|蒲公英/i.test(text)) return 'xiaohongshu';
    if (/视频号|wechat/i.test(text)) return 'wechatVideo';
    return '';
  }

  function businessDateKey(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const parsed = dateKey(text);
    if (parsed && !parsed.startsWith('2001-')) return parsed;
    const monthDay = text.match(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*[月./-]\s*([12]?\d|3[01])\s*(?:日)?/);
    if (monthDay) {
      const year = new Date().getFullYear();
      return [
        year,
        String(Number(monthDay[1])).padStart(2, '0'),
        String(Number(monthDay[2])).padStart(2, '0')
      ].join('-');
    }
    return parsed || '';
  }

  function sqliteAll(file, sql, params) {
    return new Promise(resolve => {
      if (!sqlite3 || !fs.existsSync(file)) return resolve([]);
      const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, error => {
        if (error) return resolve([]);
        db.all(sql, params || [], (queryError, rows) => {
          try { db.close(); } catch (e) {}
          resolve(queryError ? [] : (rows || []));
        });
      });
    });
  }

  function scheduleDateKey(row) {
    return businessDateKey(row.publish_date || row.lock_date || row.date || row.month || row.schedule || '');
  }

  function monthKeyFromText(value) {
    const text = String(value || '');
    const full = text.match(/(20\d{2})\s*[年./-]\s*(1[0-2]|0?[1-9])/);
    if (full) return `${full[1]}-${String(Number(full[2])).padStart(2, '0')}`;
    const month = text.match(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*月/);
    if (month) return `2026-${String(Number(month[1])).padStart(2, '0')}`;
    const parsed = dateKey(text);
    return parsed ? parsed.slice(0, 7) : '';
  }

  function businessLikeType(value) {
    const text = String(value || '');
    return /商单|商务|广告|推广|一口价|星广|联投|CPM|合作|定制|种草|带货/i.test(text);
  }

  function cleanProjectName(value) {
    const text = String(value || '').trim();
    if (!text || text === '-' || text === '选题待定') return '';
    if (/日常|待定|无|未知/.test(text)) return '';
    return text.replace(/^(项目|产品|商单|推广|合作)\s*[：:]/, '').trim();
  }

  async function buildBusinessMatchContext() {
    const [scheduleRows, profitRows] = await Promise.all([
      sqliteAll(scheduleDbFile, 'SELECT account, type, content, remark, date, doc_title, doc_kind FROM schedules WHERE type IS NOT NULL AND TRIM(type) <> ""', []),
      sqliteAll(profitDbFile, 'SELECT account, project, platform, month, remark, business_type, category, publish_date, lock_date, execution_status, product_line FROM profits', [])
    ]);
    const refs = [];
    for (const row of scheduleRows) {
      if (!businessLikeType([row.type, row.content, row.remark, row.doc_title].join(' '))) continue;
      const account = String(row.account || '').trim();
      const project = cleanProjectName(row.content || row.doc_title || row.remark);
      if (!account || !project) continue;
      const haystack = [row.type, row.content, row.remark, row.doc_title, row.doc_kind].join(' ');
      refs.push({
        source: 'schedule',
        account,
        accountKey: normalizeMatchText(account),
        platform: platformIdFromLabel(haystack),
        project,
        projectKey: normalizeMatchText(project),
        date: scheduleDateKey(row),
        month: monthKeyFromText(row.date),
        reason: `命中排期：${project}`
      });
    }
    for (const row of profitRows) {
      if (!businessLikeType([row.business_type, row.category, row.remark, row.project].join(' '))) continue;
      const account = String(row.account || '').trim();
      const project = cleanProjectName(row.project || row.product_line || row.remark);
      if (!account || !project) continue;
      const platform = platformIdFromLabel([row.platform, row.remark].join(' '));
      refs.push({
        source: 'profit',
        account,
        accountKey: normalizeMatchText(account),
        platform,
        project,
        projectKey: normalizeMatchText(project),
        date: scheduleDateKey(row),
        month: monthKeyFromText(row.publish_date || row.lock_date || row.month),
        reason: `命中流水：${project}${platform ? ` · ${platformLabels[platform] || platform}` : ''}`
      });
    }
    return { refs };
  }

  function daysBetweenKeys(left, right) {
    if (!left || !right) return null;
    const leftDate = parseDateTime(left);
    const rightDate = parseDateTime(right);
    if (!leftDate || !rightDate) return null;
    return Math.abs(Math.round((startOfDay(leftDate) - startOfDay(rightDate)) / 86400000));
  }

  function projectMatchesTitle(projectKey, titleKey) {
    if (!projectKey || !titleKey || projectKey.length < 2) return false;
    const aliases = [projectKey];
    if (projectKey.includes('穿越火线')) aliases.push('cf');
    if (projectKey.includes('无畏契约')) aliases.push('瓦罗兰特', 'valorant');
    if (projectKey.includes('三角洲')) aliases.push('三角洲');
    if (projectKey.includes('守望先锋')) aliases.push('ow', '守望');
    if (projectKey.includes('英雄联盟')) aliases.push('lol', '英雄联盟');
    if (projectKey.includes('开心消消乐')) aliases.push('消消乐');
    if (projectKey.includes('苏泊尔')) aliases.push('苏泊尔');
    if (projectKey.includes('千问')) aliases.push('千问');
    if (projectKey.includes('心动小镇')) aliases.push('心动小镇');
    if (projectKey.includes('字节三端互通')) aliases.push('玩法世界', '穿梭直播');
    if (aliases.some(alias => alias && titleKey.includes(alias))) return true;
    if (titleKey.includes(projectKey) || projectKey.includes(titleKey)) return true;
    if (projectKey.length >= 4 && titleKey.includes(projectKey.slice(0, 4))) return true;
    return false;
  }

  function rowSignalText(row, title) {
    return Object.entries(row || {})
      .map(([key, value]) => `${key}:${value}`)
      .concat([title || ''])
      .join(' ');
  }

  function platformBusinessSignal(platform, row, title) {
    const text = rowSignalText(row, title);
    const signalsByPlatform = {
      bilibili: [/花火/, /B站商业|商业合作|广告合作|推广合作/, /平台商单/],
      douyin: [/星图|巨量星图/, /小黄车|商品组件|团购组件|抖音商城|橱窗/, /平台商单/],
      kuaishou: [/磁力聚星|快接单|快手小店/, /平台商单/],
      xiaohongshu: [/蒲公英|小红书商业|品牌合作/, /平台商单/],
      wechatVideo: [/视频号小店|平台商单/]
    };
    const negative = /非商单|非广告|无组件|无需组件|无商业化|日常/.test(text);
    if (negative) return null;
    const matched = (signalsByPlatform[platform] || []).map(re => {
      const hit = text.match(re);
      return hit && hit[0];
    }).filter(Boolean);
    if (!matched.length) return null;
    return {
      type: '商单',
      businessKind: '平台单',
      businessSource: 'platform_signal',
      businessReason: `命中平台字段：${matched.slice(0, 3).join('、')}`,
      businessSignals: matched.slice(0, 5)
    };
  }

  function matchBusinessReference(platform, title, publishAt, account, context) {
    const refs = (context && context.refs) || [];
    if (!refs.length) return null;
    const accountKey = normalizeMatchText(account.account || account.profile || '');
    const titleKey = normalizeMatchText(title);
    const workDate = dateKey(publishAt);
    const workMonth = workDate ? workDate.slice(0, 7) : '';
    let best = null;
    for (const ref of refs) {
      if (!ref.accountKey || ref.accountKey !== accountKey) continue;
      if (ref.platform && ref.platform !== platform) continue;
      if (!ref.platform && !['douyin', 'bilibili'].includes(platform)) continue;
      const distance = daysBetweenKeys(ref.date, workDate);
      const sameMonth = Boolean(workMonth && ref.month && workMonth === ref.month);
      const projectMatch = projectMatchesTitle(ref.projectKey, titleKey);
      const closeDate = distance !== null && distance <= (ref.source === 'schedule' ? 3 : 7);
      const looseDate = distance !== null && distance <= 14;
      if (!projectMatch && !closeDate) continue;
      if (ref.month && !sameMonth && !looseDate) continue;
      const score = (projectMatch ? 3 : 0) + (closeDate ? 2 : 0) + (ref.platform ? 1 : 0) + (ref.source === 'profit' ? 1 : 0);
      if (!best || score > best.score) best = { ref, score, projectMatch, closeDate, distance };
    }
    const isMainPlatform = ['douyin', 'bilibili'].includes(platform);
    if (!best) {
      const monthRef = refs.find(ref => {
        if (!ref.accountKey || ref.accountKey !== accountKey) return false;
        if (!ref.platform || ref.platform !== platform) return false;
        return Boolean(isMainPlatform && workMonth && ref.month && ref.month === workMonth);
      });
      if (!monthRef) return null;
      return {
        type: '日常',
        businessKind: '疑似平台单',
        businessSource: monthRef.source,
        businessReason: `${monthRef.reason}（同账号同平台同月）`,
        businessSignals: ['同账号同月流水/排期', '平台匹配']
      };
    }
    const confirmed = best.projectMatch || (best.ref.source === 'schedule' && best.closeDate);
    return {
      type: isMainPlatform && confirmed ? '商单' : '日常',
      businessKind: isMainPlatform && confirmed ? '平台单' : (isMainPlatform ? '疑似平台单' : '分发/待确认'),
      businessSource: best.ref.source,
      businessReason: confirmed ? best.ref.reason : `${best.ref.reason}（仅日期接近，待确认）`,
      businessSignals: [
        best.projectMatch ? '项目名匹配' : '',
        best.closeDate ? '日期接近' : '',
        best.ref.platform ? '平台匹配' : '主平台排期'
      ].filter(Boolean)
    };
  }

  function detectWorkContentType(platform, row, title, publishAt, account, context) {
    const platformSignal = platformBusinessSignal(platform, row, title);
    if (platformSignal) return platformSignal;
    const referenceMatch = matchBusinessReference(platform, title, publishAt, account, context);
    if (referenceMatch) return referenceMatch;
    return {
      type: '日常',
      businessKind: '',
      businessSource: '',
      businessReason: '',
      businessSignals: []
    };
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function rangeWindow(range, now = new Date()) {
    const today = startOfDay(now);
    if (range === 'yesterday') {
      const start = addDays(today, -1);
      return { start, end: today };
    }
    if (range === 'week') {
      const day = today.getDay() || 7;
      return { start: addDays(today, 1 - day), end: addDays(today, 1) };
    }
    if (range === 'month') {
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: addDays(today, 1) };
    }
    if (range === 'year') {
      return { start: new Date(today.getFullYear(), 0, 1), end: addDays(today, 1) };
    }
    return null;
  }

  function inRange(dateValue, range, now) {
    if (range === 'all') return true;
    const date = parseDateTime(dateValue);
    const window = rangeWindow(range, now);
    return Boolean(date && window && date >= window.start && date < window.end);
  }

  function sumRows(rows, range, key, dateField, now) {
    return rows.reduce((sum, row) => {
      if (!inRange(row[dateField], range, now)) return sum;
      return sum + (Number(row[key]) || 0);
    }, 0);
  }

  function countRows(rows, range, dateField, now) {
    if (range === 'all') return rows.length;
    return rows.filter(row => inRange(row[dateField], range, now)).length;
  }

  function scopeLabelFor(platform, sources) {
    const defaults = platformDefaultScopes[platform] || {};
    const work = sources.find(item => item.dataset === 'works') || {};
    const fans = sources.find(item => item.dataset === 'fans') || {};
    return [
      work.scope ? `作品：${work.scope}` : defaults.works,
      fans.scope ? `粉丝：${fans.scope}` : defaults.fans
    ].filter(Boolean).join('??');
  }

  function buildMetricsByRange(workRows, fanRows, latestFollowers, now) {
    const metrics = {};
    rangeKeys.forEach(range => {
      const postRows = workRows.filter(row => !publishVolumeExcluded(row.profile, row.platform));
      const posts = countRows(postRows, range, 'publishDate', now);
      const workFanGain = sumRows(workRows, range, 'fanGain', 'publishDate', now);
      const fanDelta = range === 'all'
        ? fanRows.reduce((sum, row) => sum + (Number(row.followerDelta) || 0), 0)
        : sumRows(fanRows, range, 'followerDelta', 'date', now);
      metrics[range] = {
        views: sumRows(workRows, range, 'views', 'publishDate', now),
        likes: sumRows(workRows, range, 'likes', 'publishDate', now),
        comments: sumRows(workRows, range, 'comments', 'publishDate', now),
        favorites: sumRows(workRows, range, 'favorites', 'publishDate', now),
        shares: sumRows(workRows, range, 'shares', 'publishDate', now),
        posts,
        fans: range === 'all' ? latestFollowers : (fanRows.length ? fanDelta : workFanGain)
      };
    });
    return metrics;
  }

  function profileKey(summary) {
    return String(summary.requestedProfile || summary.profile || 'unknown').trim() || 'unknown';
  }

  function actualProfileKey(summary) {
    return String(summary.resolvedProfile || summary.profile || '').trim();
  }

  function sameProfileAccount(left, right) {
    if (!left || !right) return true;
    if (left === right) return true;
    const leftMeta = profileMeta[left];
    const rightMeta = profileMeta[right];
    if (!leftMeta || !rightMeta) return false;
    return Boolean(leftMeta.accountId && leftMeta.accountId === rightMeta.accountId);
  }

  function summaryProfileMismatch(summary) {
    const requested = String(summary.requestedProfile || '').trim();
    const actual = actualProfileKey(summary);
    return Boolean(requested && actual && !sameProfileAccount(requested, actual));
  }

  function metaForProfile(profile) {
    return Object.assign({ known: Boolean(profileMeta[profile]) }, profileMeta[profile] || { account: profile, groupName: '待确认分组', groupId: 0, owner: '' });
  }

  function profileAllowsPlatform(profile, platform) {
    const meta = metaForProfile(profile);
    const platformIds = Array.isArray(meta.platformIds) ? meta.platformIds : [];
    return !platformIds.length || platformIds.includes(platform);
  }

  function collectFailureMessage(error, dataset) {
    const text = String(error || '').trim();
    if (/not connected|profile not connected|Browser profile/i.test(text)) return 'profile 未连接 opencli，需要重新绑定或启动浏览器扩展';
    if (/login|unauthorized|forbidden|cookie|\u672a\u767b\u5f55|\u767b\u5f55|401|403/i.test(text)) return '登录态失效或权限不足，需要复查平台登录';
    if (/timeout|\u8d85\u65f6/i.test(text)) return '采集超时，需要复查平台页面或网络';
    return text || (dataset ? `${dataset} 采集失败` : '采集失败');
  }

  function buildCollectionFailures(limit) {
    const failures = [];
    for (const item of listSummaryFiles().slice(0, Number(limit) || 12)) {
      const summary = safeReadJson(item.full);
      if (!summary) continue;
      const profile = String(summary.requestedProfile || summary.profile || '').trim();
      const meta = metaForProfile(profile);
      if (summary.profileState && summary.profileState.ok === false) {
        failures.push({
          account: meta.account || profile || '数据采集账号',
          groupName: meta.groupName || '待确认分组',
          groupId: meta.groupId || 0,
          owner: meta.owner || '',
          profile,
          platform: '',
          dataset: 'profile',
          message: collectFailureMessage(summary.profileState.error, 'profile'),
          error: summary.profileState.error || '',
          needsLogin: true,
          collectedAt: summary.finishedAt || summary.startedAt || '',
          summaryFile: item.full
        });
      }
      for (const dataset of summary.datasets || []) {
        if (!dataset || dataset.ok !== false) continue;
        if (dataset.platform && !profileAllowsPlatform(profile, dataset.platform)) continue;
        failures.push({
          account: meta.account || profile || '数据采集账号',
          groupName: meta.groupName || '待确认分组',
          groupId: meta.groupId || 0,
          owner: meta.owner || '',
          profile,
          platform: dataset.platform || '',
          dataset: dataset.dataset || '',
          message: collectFailureMessage(dataset.error, dataset.dataset),
          error: dataset.error || '',
          needsLogin: /not connected|login|unauthorized|forbidden|cookie|\u672a\u767b\u5f55|\u767b\u5f55|401|403/i.test(String(dataset.error || '')),
          collectedAt: summary.finishedAt || summary.startedAt || '',
          summaryFile: item.full
        });
      }
    }
    const seen = new Set();
    return failures.filter(item => {
      const key = [item.account, item.platform, item.dataset, item.message].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 30);
  }

  function normalizedCollectState() {
    const state = readCollectState();
    if (state.running && !collectProcess) {
      const startedMs = Date.parse(state.startedAt || '');
      if (!Number.isFinite(startedMs) || Date.now() - startedMs > 2 * 60 * 1000) {
        return writeCollectState({
          ok: false,
          running: false,
          finishedAt: new Date().toISOString(),
          error: '采集进程已中断',
          failures: buildCollectionFailures(8)
        });
      }
    }
    return state;
  }

  function runCollectJob(options) {
    options = options || {};
    if (collectProcess) {
      return { ok: false, running: true, message: '已有采集任务在运行', state: normalizedCollectState() };
    }
    const selection = selectCollectProfiles(options);
    const collectProfiles = selection.profiles;
    const collectTargets = selection.targets || [];
    const useBatch = selection.targetMode || collectProfiles.length > 1;
    const scriptToRun = useBatch ? collectBatchScript : collectScript;
    if (!fs.existsSync(scriptToRun)) {
      const state = writeCollectState({ ok: false, running: false, error: '采集脚本不存在：' + scriptToRun });
      return { ok: false, error: state.error, state };
    }
    const startedMs = Date.now();
    const trigger = String(options.trigger || 'manual');
    const profile = collectProfiles[0] || dataMaintenanceProfile.alias || 'collector-link-crawl';
    const platforms = String(options.platforms || process.env.ACCOUNT_DATA_COLLECT_PLATFORMS || 'douyin,kuaishou,bilibili');
    const datasets = String(options.datasets || process.env.ACCOUNT_DATA_COLLECT_DATASETS || 'fans,works');
    const closeProfile = options.closeProfile === undefined || options.closeProfile === null
      ? true
      : (options.closeProfile === true || options.closeProfile === 'true');
    const argv = useBatch
      ? [
        scriptToRun,
        '--profiles', collectProfiles.join(','),
        '--profileMode', 'direct',
        '--platforms', platforms,
        '--datasets', datasets,
        '--outDir', exportDir,
        '--sessionPrefix', `account-data-${trigger}-${startedMs}`
      ]
      : [
        scriptToRun,
        '--profile', profile,
        '--profileMode', 'direct',
        '--platforms', platforms,
        '--datasets', datasets,
        '--outDir', exportDir,
        '--sessionPrefix', `account-data-${trigger}-${startedMs}`
      ];
    if (useBatch && collectTargets.length) argv.push('--targets', collectTargets.map(serializeCollectTarget).join(','));
    if (options.launchProfile === false || options.launchProfile === 'false') argv.push('--launchProfile', 'false');
    if (closeProfile) argv.push('--closeProfile', 'true');
    argv.push('--profileConnectTimeoutMs', String(process.env.ACCOUNT_DATA_PROFILE_CONNECT_TIMEOUT_MS || 90000));
    argv.push('--browserOpenTimeoutMs', String(process.env.ACCOUNT_DATA_BROWSER_OPEN_TIMEOUT_MS || 120000));
    argv.push('--browserEvalTimeoutMs', String(process.env.ACCOUNT_DATA_BROWSER_EVAL_TIMEOUT_MS || 120000));
    argv.push('--browserClickTimeoutMs', String(process.env.ACCOUNT_DATA_BROWSER_CLICK_TIMEOUT_MS || 60000));
    argv.push('--postOpenWaitMs', String(process.env.ACCOUNT_DATA_POST_OPEN_WAIT_MS || 10000));
    argv.push('--downloadTimeoutMs', String(process.env.ACCOUNT_DATA_DOWNLOAD_TIMEOUT_MS || 180000));
    argv.push('--skipDisconnected', String(process.env.ACCOUNT_DATA_SKIP_DISCONNECTED || 'true'));
    if (useBatch) argv.push('--childTimeoutMs', String(process.env.ACCOUNT_DATA_CHILD_TIMEOUT_MS || 20 * 60 * 1000));

    const state = writeCollectState({
      ok: true,
      running: true,
      trigger,
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: '',
      profile,
      profiles: collectProfiles,
      targets: collectTargets.map(serializeCollectTarget),
      profileQueue: selection.queue,
      platforms,
      datasets,
      closeProfile,
      command: [process.execPath].concat(argv),
      error: '',
      stdoutTail: '',
      stderrTail: ''
    });

    let stdout = '';
    let stderr = '';
    collectProcess = spawn(process.execPath, argv, {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    collectProcess.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    collectProcess.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    collectProcess.on('error', err => {
      collectProcess = null;
      writeCollectState({
        ok: false,
        running: false,
        finishedAt: new Date().toISOString(),
        error: err.message || String(err),
        stdoutTail: tailText(stdout, 4000),
        stderrTail: tailText(stderr, 4000)
      });
    });
    collectProcess.on('close', code => {
      collectProcess = null;
      const latest = latestSummaryAfter(startedMs);
      const summary = latest ? safeReadJson(latest.full) : null;
      const patch = {
        ok: code === 0 && Boolean(summary && summary.ok !== false),
        running: false,
        exitCode: code,
        finishedAt: new Date().toISOString(),
        lastRun: new Date().toISOString(),
        lastSummaryFile: latest ? latest.full : '',
        profileQueue: selection.queue,
        failures: buildCollectionFailures(8),
          error: code === 0 ? '' : '采集进程退出 ' + code,
        stdoutTail: tailText(stdout, 4000),
        stderrTail: tailText(stderr, 4000)
      };
      if (!selection.queue || !selection.queue.explicit) patch.nextProfileOffset = selection.nextProfileOffset;
      if (!selection.queue || !selection.queue.explicit) patch.nextCollectTargetOffset = selection.nextCollectTargetOffset;
      try {
        const refreshedIndex = readCollectIndex({ force: true });
        patch.indexGeneratedAt = refreshedIndex.generatedAt || '';
        patch.indexDigest = refreshedIndex.sourceStats && refreshedIndex.sourceStats.digest || '';
        patch.indexLatestDatasetCount = Object.keys(refreshedIndex.latestDatasets || {}).length;
      } catch (e) {
        patch.indexError = e && e.message ? e.message : String(e || 'index refresh failed');
      }
      writeCollectState(patch);
    });
    return { ok: true, running: true, state };
  }

  function scheduleSlot(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      String(date.getHours()).padStart(2, '0')
    ].join('-');
  }

  function checkCollectSchedule() {
    const now = new Date();
    if (!scheduledHours.includes(now.getHours()) || now.getMinutes() > 5) return;
    const slot = scheduleSlot(now);
    if (lastScheduleSlot === slot) return;
    lastScheduleSlot = slot;
    runCollectJob({ trigger: 'schedule' });
  }

  function startCollectScheduler() {
    if (collectScheduler) return;
    writeCollectState({ scheduler: { ok: true, hours: scheduledHours, startedAt: new Date().toISOString() } });
    collectScheduler = setInterval(checkCollectSchedule, 60 * 1000);
    if (collectScheduler.unref) collectScheduler.unref();
    checkCollectSchedule();
  }
  function buildCollectedDatasets() {
    const index = readCollectIndex();
    return Object.values(index.latestDatasets || {}).map(entry => ({
      profile: entry.profile,
      summaryFile: entry.summaryFile,
      summaryStartedAt: entry.collectedAt || '',
      summaryFinishedAt: entry.collectedAt || '',
      dataset: {
        ok: true,
        platform: entry.platform,
        dataset: entry.dataset,
        file: entry.file,
        rows: entry.rows,
        source: entry.source,
        sourceScope: entry.scope
      }
    }));
  }

  function seedCatalogDashboardBuckets(bucket) {
    const supportedPlatforms = new Set(Object.keys(platformLabels));
    for (const account of publishAccountCatalog()) {
      const canonicalProfile = String(account.id || '').trim();
      if (!canonicalProfile) continue;
      for (const platform of account.platforms || []) {
        const platformId = String(platform && platform.id || '').trim();
        if (!platformId || !supportedPlatforms.has(platformId)) continue;
        const key = [canonicalProfile, platformId].join(':');
        if (bucket.has(key)) continue;
        const profile = String(platform.profile_alias || account.dataProfileAlias || canonicalProfile).trim() || canonicalProfile;
        bucket.set(key, {
          profile,
          canonicalProfile,
          latestProfileAt: 0,
          account: account.dashboardName || account.name || canonicalProfile,
          groupId: Number(account.groupId) || 0,
          groupName: account.groupName || '待确认分组',
          owner: account.owner || '',
          knownProfile: true,
          platform: platformId,
          platformLabel: platformLabels[platformId] || platform.name || platformId,
          datasets: {},
          works: [],
          fanTrendRows: [],
          sources: [],
          seededFromCatalog: true
        });
      }
    }
  }

  function normalizeWorkRow(platform, row, index, account, businessContext) {
    const title = String(pickByHeader(row, [/作品名称/, /^作品$/, /视频标题/, /^title$/i]) || '').trim();
    const publishAt = String(pickByHeader(row, [/发布时间/, /^pubtime$/i]) || '').trim();
    const views = toNumber(pickByHeader(row, [/播放量/, /^play$/i, /^views?$/i]));
    const likes = toNumber(pickByHeader(row, [/点赞量/, /^like$/i, /^likes$/i]));
    const comments = toNumber(pickByHeader(row, [/评论量/, /^comment$/i, /^comments$/i, /^reply$/i]));
    const favorites = toNumber(pickByHeader(row, [/收藏量/, /^fav$/i, /^favorite/i, /^collect/i]));
    const shares = toNumber(pickByHeader(row, [/分享量/, /转发量/, /^share$/i, /^shares$/i]));
    const fanGain = toNumber(pickByHeader(row, [/粉丝增量/, /涨粉量/, /^fan$/i, /fans?/i]));
    const completionRate = toPercent(pickByHeader(row, [/^完播率$/, /5s完播率/, /full.*play/i, /completion/i]));
    const interactionRate = views ? Number(((likes + comments + favorites + shares) / views * 100).toFixed(1)) : 0;
    const business = detectWorkContentType(platform, row, title, publishAt, account, businessContext);
    return {
      id: [account.profile, platform, index, title || publishAt].join('-'),
      profile: account.profile,
      account: account.account,
      groupId: account.groupId,
      groupName: account.groupName,
      owner: account.owner,
      platform,
      platformLabel: platformLabels[platform] || platform,
      title: title || '未命名作品',
      contentType: business.type,
      businessKind: business.businessKind,
      businessSource: business.businessSource,
      businessReason: business.businessReason,
      businessSignals: business.businessSignals,
      publishAt,
      publishDate: dateKey(publishAt),
      views,
      likes,
      comments,
      favorites,
      shares,
      fanGain,
      completionRate: Math.round(completionRate * 10) / 10,
      interactionRate,
      hotIndex: Math.round(views / 850 + likes * 0.42 + comments * 3.6 + shares * 3.2 + fanGain * 15 + completionRate * 28),
      level: views >= 100000 || likes >= 5000 ? 'S级' : views >= 30000 || likes >= 1000 ? 'A级' : views >= 8000 ? 'B级' : '普通'
    };
  }

  function valuesByRecentDates(rows, metricKey, points) {
    const byDate = new Map();
    rows.forEach(row => {
      const key = row.publishDate || dateKey(row.publishAt);
      if (!key) return;
      byDate.set(key, (byDate.get(key) || 0) + (Number(row[metricKey]) || 0));
    });
    const dates = Array.from(byDate.keys()).sort();
    const selected = dates.slice(-points);
    while (selected.length < points) selected.unshift('');
    return selected.map(key => key ? byDate.get(key) || 0 : 0);
  }

  function normalizeFanTrend(platform, rows) {
    return rows.map(row => {
      const date = String(pick(row, ['日期', 'date']) || '').trim();
      return {
        date: dateKey(date) || date,
        followers: toNumber(pick(row, ['总粉丝量', '粉丝总数', 'followers'])),
        followerDelta: toNumber(pick(row, ['净增粉丝量', '粉丝增量', '涨粉量', '新增粉丝'])),
        unfollow: toNumber(pick(row, ['取关粉丝量', '取关数'])),
        views: toNumber(pick(row, ['播放量'])),
        likes: toNumber(pick(row, ['点赞量'])),
        comments: toNumber(pick(row, ['评论量'])),
        shares: toNumber(pick(row, ['分享量']))
      };
    }).filter(row => row.date);
  }

  function buildDashboard(businessContext) {
    const collected = buildCollectedDatasets();
    const includedCollected = [];
    const excludedSources = [];
    collected.forEach(entry => {
      if (allowedProfiles.has(entry.profile) && profileAllowsPlatform(entry.profile, entry.dataset.platform)) {
        includedCollected.push(entry);
      } else {
        excludedSources.push({
          reason: allowedProfiles.has(entry.profile) ? 'platform_not_in_account_binding' : 'profile_not_in_account_list',
          profile: entry.profile,
          platform: entry.dataset.platform,
          dataset: entry.dataset.dataset,
          file: entry.dataset.file,
          rows: entry.dataset.rows,
          source: entry.dataset.source,
          scope: entry.dataset.sourceScope || '',
          collectedAt: entry.summaryFinishedAt || entry.summaryStartedAt || '',
          summaryFile: entry.summaryFile
        });
      }
    });
    const bucket = new Map();

    includedCollected.forEach(entry => {
      const meta = metaForProfile(entry.profile);
      const canonicalProfile = meta.accountId || entry.profile;
      const key = [canonicalProfile, entry.dataset.platform].join(':');
      const current = bucket.get(key) || {
        profile: entry.profile,
        canonicalProfile,
        latestProfileAt: 0,
        account: meta.account,
        groupId: meta.groupId,
        groupName: meta.groupName,
        owner: meta.owner,
        knownProfile: meta.known,
        platform: entry.dataset.platform,
        platformLabel: platformLabels[entry.dataset.platform] || entry.dataset.platform,
        datasets: {},
        works: [],
        fanTrendRows: [],
        sources: []
      };
      const rows = readTable(entry.dataset.file);
      const previous = current.datasets[entry.dataset.dataset];
      const previousTime = Date.parse(previous && previous.summaryFinishedAt || '') || 0;
      const nextTime = Date.parse(entry.summaryFinishedAt || entry.summaryStartedAt || '') || 0;
      if (previous && previousTime > nextTime) {
        return;
      }
      if (nextTime >= (current.latestProfileAt || 0)) {
        current.profile = entry.profile;
        current.latestProfileAt = nextTime;
      }
      current.datasets[entry.dataset.dataset] = {
        rows,
        meta: entry.dataset,
        summaryFile: entry.summaryFile,
        summaryFinishedAt: entry.summaryFinishedAt
      };
      current.sources.push({
        dataset: entry.dataset.dataset,
        profile: entry.profile,
        file: entry.dataset.file,
        rows: entry.dataset.rows,
        source: entry.dataset.source,
        scope: entry.dataset.sourceScope || '',
        collectedAt: entry.summaryFinishedAt || entry.summaryStartedAt || ''
      });
      if (entry.dataset.dataset === 'works') {
        current.works = rows.map((row, index) => normalizeWorkRow(entry.dataset.platform, row, index, current, businessContext));
      }
      if (entry.dataset.dataset === 'fans') {
        current.fanTrendRows = normalizeFanTrend(entry.dataset.platform, rows);
      }
      bucket.set(key, current);
    });

    seedCatalogDashboardBuckets(bucket);

    const accounts = [];
    const works = [];
    const unmapped = [];
    bucket.forEach(item => {
      if (!item.knownProfile) {
        unmapped.push({
          profile: item.profile,
          account: item.account,
          groupName: item.groupName,
          platform: item.platform,
          platformLabel: item.platformLabel,
          works: (item.works || []).length,
          fanRows: (item.fanTrendRows || []).length,
          sources: item.sources
        });
        return;
      }
      const workRows = item.works || [];
      const fanRows = item.fanTrendRows || [];
      const latestFan = fanRows[fanRows.length - 1] || {};
      const latestFollowerWithTotal = [...fanRows].reverse().find(row => row.followers > 0) || {};
      const totalViews = workRows.reduce((sum, row) => sum + row.views, 0);
      const totalLikes = workRows.reduce((sum, row) => sum + row.likes, 0);
      const comments = workRows.reduce((sum, row) => sum + row.comments, 0);
      const favorites = workRows.reduce((sum, row) => sum + row.favorites, 0);
      const shares = workRows.reduce((sum, row) => sum + row.shares, 0);
      const followerDelta = fanRows.length
        ? fanRows.reduce((sum, row) => sum + row.followerDelta, 0)
        : workRows.reduce((sum, row) => sum + row.fanGain, 0);
      const trend = valuesByRecentDates(workRows, 'views', 8);
      const likeTrend = valuesByRecentDates(workRows, 'likes', 8);
      const fanTrend = fanRows.slice(-8).map(row => row.followers || row.followerDelta || 0);
      while (fanTrend.length < 8) fanTrend.unshift(0);
      const followers = latestFollowerWithTotal.followers || latestFan.followers || 0;
      const metricsByRange = buildMetricsByRange(workRows, fanRows, followers, new Date());
      const completionValues = workRows.map(row => Number(row.completionRate) || 0).filter(Boolean);
      const completionValue = completionValues.length
        ? Math.round(completionValues.reduce((sum, value) => sum + value, 0) / completionValues.length)
        : 0;
      const latestWorkDate = workRows.map(row => row.publishDate).filter(Boolean).sort().pop() || '';
      const id = [item.platform, item.canonicalProfile || item.profile].join('-');
      const publishVolumeExcludedAccount = publishVolumeExcluded(item.profile, item.platform);
      const countedWorkRows = publishVolumeExcludedAccount ? [] : workRows;
      accounts.push({
        id,
        accountId: item.canonicalProfile || item.profile,
        account: item.account,
        groupId: item.groupId,
        groupName: item.groupName,
        owner: item.owner,
        knownProfile: item.knownProfile,
        platform: item.platform,
        platformLabel: item.platformLabel,
        enabled: true,
        profile: item.profile,
        publishVolumeExcluded: publishVolumeExcludedAccount,
        collectStatus: item.sources.length ? '???' : '?????',
        lastCollectedAt: item.sources.map(source => source.collectedAt).filter(Boolean).sort().pop() || '',
        totalViews,
        yesterdayViews: trend[trend.length - 1] || 0,
        totalLikes,
        yesterdayLikes: likeTrend[likeTrend.length - 1] || 0,
        followers,
        followerDelta,
        comments,
        favorites,
        shares,
        hitWorks: countedWorkRows.filter(row => row.views >= 10000 || row.likes >= 1000).length,
        postTotal: countedWorkRows.length,
        growthScore: Math.round((trend[trend.length - 1] || 0) * 0.72 + followerDelta * 18 + (likeTrend[likeTrend.length - 1] || 0) * 5),
        completionValue,
        trend,
        likeTrend,
        fanTrend,
        latestWorkDate,
        metricsByRange,
        scopeLabel: scopeLabelFor(item.platform, item.sources),
        sources: item.sources
      });
      workRows.forEach(row => {
        works.push(Object.assign({}, row, { accountId: id, publishVolumeExcluded: publishVolumeExcludedAccount }));
      });
    });

    works.sort((a, b) => b.hotIndex - a.hotIndex || b.views - a.views);
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      sourceDir: exportDir,
      usingMock: accounts.length === 0,
      accounts,
      works,
      unmapped,
      sources: includedCollected.map(entry => ({
        profile: entry.profile,
        platform: entry.dataset.platform,
        dataset: entry.dataset.dataset,
        file: entry.dataset.file,
        rows: entry.dataset.rows,
        source: entry.dataset.source,
        scope: entry.dataset.sourceScope || '',
        collectedAt: entry.summaryFinishedAt || entry.summaryStartedAt || '',
        summaryFile: entry.summaryFile
      })),
      excludedSources,
      collection: normalizedCollectState(),
      collectionIndex: readCollectIndex(),
      collectionFailures: buildCollectionFailures(12),
      businessRecognition: {
        ok: true,
        mode: 'platform_order_first',
        refs: ((businessContext && businessContext.refs) || []).length,
        rule: '平台字段优先；其次匹配排期/流水；只把抖音和B站主平台命中项计入商单'
      }
    };
  }

  return {
    _startCollectScheduler: startCollectScheduler,

    '/api/account-data/dashboard': function(body, reply) {
      if (!XLSX) return reply({ ok: false, error: '缺少 xlsx 依赖，无法解析账号数据导出表' });
      buildBusinessMatchContext()
        .then(context => reply(buildDashboard(context)))
        .catch(() => reply(buildDashboard({ refs: [] })));
    },

    '/api/account-data/collect/status': function(body, reply) {
      reply({
        ok: true,
        state: normalizedCollectState(),
        failures: buildCollectionFailures(12),
        index: readCollectIndex(),
        scheduleHours: scheduledHours
      });
    },

    '/api/account-data/collect/run': function(body, reply) {
      const result = runCollectJob({
        trigger: body.trigger || 'manual',
        profile: body.profile,
        profiles: body.profiles,
        maxProfiles: body.maxProfiles,
        maxTargets: body.maxTargets,
        targets: body.targets,
        platforms: body.platforms,
        datasets: body.datasets,
        launchProfile: body.launchProfile,
        closeProfile: body.closeProfile
      });
      reply(result);
    }
  };
};

