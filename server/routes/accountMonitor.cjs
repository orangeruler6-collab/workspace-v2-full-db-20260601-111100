const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

module.exports = function createAccountMonitorRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const dataDir = path.join(root, 'data');
  const storePath = path.join(dataDir, 'account_monitor.json');
  const scheduleHours = [9, 13, 16];
  let scheduleTimer = null;
  let scheduledCollecting = false;
  let collectJob = {
    running: false,
    source: '',
    startedAt: 0,
    finishedAt: 0,
    total: 0,
    done: 0,
    currentAccountId: '',
    currentAccountName: '',
    error: '',
    results: []
  };

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  function emptyStore() {
    return { accounts: [], items: [], snapshots: [] };
  }

  function readStore() {
    if (!fs.existsSync(storePath)) return emptyStore();
    try {
      return Object.assign(emptyStore(), JSON.parse(fs.readFileSync(storePath, 'utf8')) || {});
    } catch (e) {
      return emptyStore();
    }
  }

  function writeStore(store) {
    const safe = {
      accounts: Array.isArray(store.accounts) ? store.accounts : [],
      items: Array.isArray(store.items) ? store.items.slice(-5000) : [],
      snapshots: Array.isArray(store.snapshots) ? store.snapshots.slice(-240) : []
    };
    const tmpPath = storePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(safe, null, 2), 'utf8');
    fs.renameSync(tmpPath, storePath);
  }

  function makeId() {
    return 'acct_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function normalizePlatform(value) {
    const raw = String(value || '').toLowerCase();
    if (raw.indexOf('bili') >= 0 || raw.indexOf('b站') >= 0 || raw.indexOf('哔') >= 0) return 'bilibili';
    return 'douyin';
  }

  function extractFirstUrl(value) {
    const match = String(value || '').match(/https?:\/\/[^\s，。；、]+/i);
    return match ? match[0].replace(/[)"'）】]+$/, '') : '';
  }

  function parseDouyinSecUid(value) {
    const raw = String(value || '');
    const direct = raw.match(/[?&]sec_uid=([^&#\s]+)/i);
    if (direct) return decodeURIComponent(direct[1]);
    const shareUser = raw.match(/\/share\/user\/([^/?#\s]+)/i);
    if (shareUser) return decodeURIComponent(shareUser[1]);
    const user = raw.match(/\/user\/([^/?#\s]+)/i);
    if (user) return decodeURIComponent(user[1]);
    if (/^MS4w\./.test(raw.trim())) return raw.trim();
    return '';
  }

  function extractDouyinAwemeId(value) {
    const raw = String(value || '');
    const direct = raw.match(/\/video\/(\d{8,})/i);
    if (direct) return direct[1];
    const note = raw.match(/\/note\/(\d{8,})/i);
    if (note) return note[1];
    const modal = raw.match(/[?&](?:modal_id|aweme_id|item_id)=([^&#\s]+)/i);
    if (modal && /^\d{8,}$/.test(modal[1])) return modal[1];
    return '';
  }

  function isDouyinVideoLinkInput(platform, value) {
    if (normalizePlatform(platform) !== 'douyin') return false;
    const url = extractFirstUrl(value) || String(value || '').trim();
    return /(?:^https?:\/\/)?(?:v\.douyin\.com|(?:www\.)?douyin\.com|(?:www\.)?iesdouyin\.com)\//i.test(url) && !parseDouyinSecUid(url);
  }

  function resolveRedirect(url, limit) {
    return new Promise(function(resolve) {
      const target = String(url || '').trim();
      if (!/^https?:\/\//i.test(target) || (limit || 0) > 5) return resolve(target);
      const client = target.indexOf('https://') === 0 ? https : http;
      const req = client.request(target, { method: 'HEAD', timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
        const location = res.headers.location;
        res.resume();
        if (location && res.statusCode >= 300 && res.statusCode < 400) {
          const nextUrl = new URL(location, target).toString();
          resolveRedirect(nextUrl, (limit || 0) + 1).then(resolve);
        } else {
          resolve(target);
        }
      });
      req.on('timeout', function() {
        try { req.destroy(); } catch (e) {}
        resolve(target);
      });
      req.on('error', function() { resolve(target); });
      req.end();
    });
  }

  function resolveRedirectWithCurl(url) {
    return new Promise(function(resolve) {
      if (!/^https?:\/\//i.test(String(url || ''))) return resolve('');
      const child = spawn('curl.exe', ['-s', '-L', '-I', '-o', 'NUL', '-w', '%{url_effective}', url], {
        cwd: root,
        shell: false,
        windowsHide: true
      });
      const out = [];
      child.stdout.on('data', function(chunk) { out.push(chunk); });
      child.on('error', function() { resolve(''); });
      child.on('close', function(code) {
        if (code !== 0) return resolve('');
        resolve(Buffer.concat(out).toString('utf8').trim());
      });
    });
  }

  function normalizeAccountInput(platform, value) {
    const raw = String(value || '').trim();
    let account = extractFirstUrl(raw) || raw;
    if (platform === 'douyin') {
      const secUid = parseDouyinSecUid(account);
      if (secUid) account = secUid;
    }
    if (platform === 'bilibili') {
      const match = account.match(/space\.bilibili\.com\/(\d+)/i);
      if (match) account = match[1];
    }
    return account;
  }

  function validateAccountInput(platform, value) {
    const raw = String(value || '').trim();
    const extractedUrl = extractFirstUrl(raw);
    const account = normalizeAccountInput(platform, raw);
    if (!account) return { ok: false, error: '请先填写账号ID或主页链接' };
    if (platform === 'douyin') {
      if (isDouyinVideoLinkInput(platform, raw)) return { ok: true, account: extractFirstUrl(raw) || account, sourceType: 'video_link' };
      if (/^https?:\/\//i.test(account) || (extractedUrl && !parseDouyinSecUid(account))) {
        return { ok: false, error: '未能从链接中识别到抖音用户 sec_uid，保存后扫描时会尝试自动解析短链。' };
      }
    }
    if (platform === 'bilibili' && /^https?:\/\//i.test(account)) {
      return { ok: false, error: '未能从链接中识别到 B站 mid，请使用 space.bilibili.com/数字ID 的主页链接。' };
    }
    return { ok: true, account: account };
  }

  function resolveAccountInput(platform, value) {
    const raw = String(value || '').trim();
    const first = validateAccountInput(platform, raw);
    if (first.ok) return Promise.resolve(first);
    const url = extractFirstUrl(raw);
    if (platform !== 'douyin' || !/v\.douyin\.com/i.test(url || '')) return Promise.resolve(first);
    return resolveRedirect(url).then(function(finalUrl) {
      const secUid = parseDouyinSecUid(finalUrl);
      if (secUid) return { ok: true, account: secUid, resolvedUrl: finalUrl };
      return resolveRedirectWithCurl(url).then(function(curlUrl) {
        const curlSecUid = parseDouyinSecUid(curlUrl);
        if (curlSecUid) return { ok: true, account: curlSecUid, resolvedUrl: curlUrl };
        const resolvedVideoUrl = curlUrl || finalUrl || url;
        if (isDouyinVideoLinkInput(platform, resolvedVideoUrl)) {
          return { ok: true, account: url, resolvedUrl: resolvedVideoUrl, sourceType: 'video_link' };
        }
        return { ok: false, error: '这个抖音短链没有解析出 sec_uid，请确认分享的是账号主页；如果是作品链接，可作为单链接来源保存后扫描。' };
      });
    });
  }

  function parseJsonLoose(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {}
    const firstArray = raw.indexOf('[');
    const lastArray = raw.lastIndexOf(']');
    if (firstArray >= 0 && lastArray > firstArray) {
      try { return JSON.parse(raw.slice(firstArray, lastArray + 1)); } catch (e) {}
    }
    const firstObject = raw.indexOf('{');
    const lastObject = raw.lastIndexOf('}');
    if (firstObject >= 0 && lastObject > firstObject) {
      try { return JSON.parse(raw.slice(firstObject, lastObject + 1)); } catch (e) {}
    }
    return null;
  }

  function runOpenCli(args, timeoutMs) {
    return new Promise(function(resolve) {
      const opencliBin = (function() {
        const npmDir = process.env.APPDATA
          ? path.join(process.env.APPDATA, 'npm')
          : path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'npm');
        const candidates = [
          process.env.OPENCLI_BIN,
          process.env.USAGI_OPENCLI_PATH,
          process.platform === 'win32' ? path.join(npmDir, 'opencli.cmd') : '',
          process.platform === 'win32' ? path.join(npmDir, 'opencli.ps1') : '',
          process.platform === 'win32' ? 'opencli.cmd' : 'opencli'
        ].filter(Boolean);
        for (let i = 0; i < candidates.length; i += 1) {
          if (path.isAbsolute(candidates[i]) && fs.existsSync(candidates[i])) return candidates[i];
        }
        return candidates[0] || (process.platform === 'win32' ? 'opencli.cmd' : 'opencli');
      })();
      const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : opencliBin;
      const commandArgs = process.platform === 'win32'
        ? ['/d', '/s', '/c', opencliBin].concat(args)
        : args;
      const child = spawn(command, commandArgs, {
        cwd: root,
        shell: false,
        windowsHide: true,
        env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' })
      });
      const out = [];
      const err = [];
      let done = false;
      const timer = setTimeout(function() {
        if (done) return;
        done = true;
        try { child.kill(); } catch (e) {}
        resolve({ ok: false, error: 'opencli timeout', stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
      }, timeoutMs || 180000);

      child.stdout.on('data', function(chunk) { out.push(chunk); });
      child.stderr.on('data', function(chunk) { err.push(chunk); });
      child.on('error', function(e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: e.message, stdout: '', stderr: '' });
      });
      child.on('close', function(code) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const stdout = Buffer.concat(out).toString('utf8');
        const stderr = Buffer.concat(err).toString('utf8');
        resolve({ ok: code === 0, code: code, stdout: stdout, stderr: stderr, error: code === 0 ? '' : (stderr || stdout || ('exit ' + code)).slice(0, 800) });
      });
    });
  }

  function rowsFromParsed(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (!parsed || typeof parsed !== 'object') return [];
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (parsed.data && Array.isArray(parsed.data.items)) return parsed.data.items;
    if (Array.isArray(parsed.results)) return parsed.results;
    if (Array.isArray(parsed.videos)) return parsed.videos;
    return [];
  }

  function numberValue() {
    for (let i = 0; i < arguments.length; i += 1) {
      const value = arguments[i];
      if (value === undefined || value === null || value === '') continue;
      const n = Number(String(value).replace(/,/g, ''));
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  function timeValue() {
    for (let i = 0; i < arguments.length; i += 1) {
      const value = arguments[i];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value === 'number') return value > 100000000000 ? value : value * 1000;
      const text = String(value).trim();
      if (/^\d{10}$/.test(text)) return Number(text) * 1000;
      if (/^\d{13}$/.test(text)) return Number(text);
      const parsed = Date.parse(text);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  function douyinAwemeTime(awemeId) {
    try {
      const id = String(awemeId || '').trim();
      if (!/^\d{16,22}$/.test(id)) return 0;
      const seconds = Number(BigInt(id) >> 32n);
      const ts = seconds * 1000;
      if (ts < Date.parse('2016-01-01') || ts > Date.now() + 86400000) return 0;
      return ts;
    } catch (e) {
      return 0;
    }
  }

  function normalizeVideo(platform, item, account, index) {
    const stat = item.statistics || item.stats || item.stat || {};
    const awemeId = item.aweme_id || item.awemeId || item.id || '';
    const bvidMatch = String(item.url || item.link || '').match(/BV[\w]+/i);
    const videoId = String(platform === 'bilibili'
      ? (item.bvid || item.id || (bvidMatch && bvidMatch[0]) || '')
      : (awemeId || item.video_id || item.id || ''));
    const rawUrl = item.url || item.link || item.video_url || item.share_url || item.arcurl || '';
    const url = platform === 'douyin' && awemeId ? ('https://www.douyin.com/video/' + awemeId) : rawUrl;
    const publishedTs = timeValue(item.published_at, item.publish_time, item.pubdate, item.created_at, item.create_time, item.date) || (platform === 'douyin' ? douyinAwemeTime(awemeId) : 0);
    return {
      id: videoId,
      platform: platform,
      account: account,
      title: String(item.title || item.desc || item.description || item.name || '未命名作品').trim(),
      url: url,
      publishedAt: item.published_at || item.publish_time || item.pubdate || item.created_at || item.create_time || item.date || (publishedTs ? new Date(publishedTs).toISOString().slice(0, 10) : ''),
      publishedTs: publishedTs,
      metrics: {
        play: numberValue(item.play, item.plays, item.view, item.views, item.play_count, stat.play_count, stat.view_count),
        like: numberValue(item.like, item.likes, item.like_count, stat.like_count, stat.digg_count, item.digg_count),
        comment: numberValue(item.comment, item.comments, item.comment_count, stat.comment_count),
        favorite: numberValue(item.favorite, item.favorites, item.collect, item.collects, item.collect_count, stat.collect_count, stat.favorite_count),
        share: numberValue(item.share, item.shares, item.share_count, stat.share_count)
      },
      raw: item
    };
  }

  function stableItemKey(item) {
    const platform = item.platform || '';
    if (item.id) return [platform, 'id', item.id].join('|').toLowerCase();
    if (item.url) return [platform, 'url', item.url].join('|').toLowerCase();
    return [platform, 'title', item.account || item.accountId || '', item.title || ''].join('|').toLowerCase();
  }

  function boolish(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    const text = String(value || '').trim().toLowerCase();
    return text === 'true' || text === 'yes' || text === '1' || text === 'private' || text === 'hidden';
  }

  function hasBadStatusText(value) {
    const text = String(value || '').toLowerCase();
    return Boolean(text && /hidden|private|delete|deleted|removed|unavailable|invisible|banned|blocked|forbidden|下架|删除|私密|隐藏|不可见|违规|审核不通过/.test(text));
  }

  function isHiddenVideo(raw) {
    const item = raw || {};
    if (item.visible === false || item.is_visible === false || item.is_public === false) return true;
    if (boolish(item.hidden) || boolish(item.is_hidden) || boolish(item.private) || boolish(item.is_private)) return true;
    if (boolish(item.deleted) || boolish(item.is_deleted) || boolish(item.removed) || boolish(item.is_removed)) return true;
    if (boolish(item.banned) || boolish(item.is_banned) || boolish(item.blocked) || boolish(item.is_blocked)) return true;
    if (Number.isFinite(Number(item.state)) && Number(item.state) < 0) return true;
    return [
      item.status,
      item.state_desc,
      item.video_status,
      item.aweme_status,
      item.item_status,
      item.review_status,
      item.visibility,
      item.privacy_status,
      item.error,
      item.message
    ].some(hasBadStatusText);
  }

  function isUsableVideo(item) {
    if (!item || typeof item !== 'object') return false;
    if (isHiddenVideo(item.raw || item)) return false;
    return Boolean(String(item.id || '').trim() || String(item.url || '').trim() || String(item.title || '').trim());
  }

  function inferCategory(text) {
    const value = String(text || '').toLowerCase();
    if (/游戏|手游|端游|二游|steam|lpl|lck|王者|原神|崩坏|鸣潮|主播/.test(value)) return '游戏杂谈';
    if (/数码|手机|电脑|ai|模型|芯片|汽车|新能源|苹果|华为|小米|英伟达|openai/.test(value)) return '数码科技';
    if (/影视|综艺|明星|女团|饭圈|娱乐|塌房|恋情/.test(value)) return '娱乐八卦';
    if (/体育|nba|足球|电竞|比赛|冠军/.test(value)) return '体育电竞';
    return '综合热点';
  }

  function hotScore(item) {
    const metrics = item.metrics || {};
    const platform = normalizePlatform(item.platform);
    const play = Number(metrics.play) || 0;
    const like = Number(metrics.like) || 0;
    const comment = Number(metrics.comment) || 0;
    const favorite = Number(metrics.favorite) || 0;
    const share = Number(metrics.share) || 0;
    const base = platform === 'douyin'
      ? like * 14 + comment * 24 + favorite * 12 + share * 28
      : play + like * 8 + comment * 18 + favorite * 10 + share * 24;
    const ageHours = Math.max(1, (Date.now() - (Number(item.publishedTs) || Date.now())) / 3600000);
    const freshnessBoost = ageHours <= 24
      ? 90
      : ageHours <= 72
        ? 60
        : Math.max(0, Math.round(40 * (1 - Math.min(ageHours, 168) / 168)));
    const velocity = base / Math.pow(ageHours, 0.42);
    const rawScore = Math.log10(velocity + 1) * 100 + freshnessBoost + breakoutBoost(item, ageHours);
    return Math.round(rawScore * accountHotScoreFactor(item));
  }

  function breakoutBoost(item, ageHours) {
    const metrics = item.metrics || {};
    const platform = normalizePlatform(item.platform);
    const play = Number(metrics.play) || 0;
    const like = Number(metrics.like) || 0;
    const comment = Number(metrics.comment) || 0;
    const share = Number(metrics.share) || 0;
    const hours = Math.max(1, ageHours || ((Date.now() - (Number(item.publishedTs) || Date.now())) / 3600000));
    const douyinVelocity = like / hours + comment * 8 / hours + share * 10 / hours;
    const biliVelocity = play / hours + like * 8 / hours + comment * 20 / hours;
    if (platform === 'douyin') {
      if (hours <= 6 && (like >= 50000 || comment >= 800 || douyinVelocity >= 12000)) return 150;
      if (hours <= 24 && (like >= 100000 || comment >= 1500 || douyinVelocity >= 6500)) return 120;
      if (hours <= 72 && (like >= 200000 || comment >= 3000 || douyinVelocity >= 4200)) return 70;
      return 0;
    }
    if (hours <= 6 && (play >= 150000 || like >= 12000 || biliVelocity >= 45000)) return 150;
    if (hours <= 24 && (play >= 300000 || like >= 25000 || biliVelocity >= 24000)) return 120;
    if (hours <= 72 && (play >= 500000 || like >= 50000 || biliVelocity >= 15000)) return 70;
    return 0;
  }

  function itemTime(item) {
    return Number(item.publishedTs) || timeValue(item.publishedAt) || 0;
  }

  function isInWindow(item, windowDays) {
    const days = Number(windowDays) || 7;
    if (days <= 0) return true;
    const ts = itemTime(item);
    if (!ts) return false;
    return Date.now() - ts <= days * 86400000;
  }

  function accountHotScoreFactor(item) {
    const accountText = [item.accountName, item.account, item.author, item.nickname].filter(Boolean).join(' ');
    if (accountText.indexOf('呼叫网管') >= 0) return 0.75;
    return 1;
  }

  function hotTags(item) {
    const metrics = item.metrics || {};
    const tags = [];
    const score = Number(item.hotScore) || hotScore(item);
    const play = Number(metrics.play) || 0;
    const like = Number(metrics.like) || 0;
    const comment = Number(metrics.comment) || 0;
    if (breakoutBoost(item) >= 120) tags.push('新发爆点');
    if (score >= 520 || play >= 500000 || like >= 30000) tags.push('爆款');
    if (score >= 430 || play >= 100000 || like >= 8000) tags.push('重点关注');
    if (comment >= 800 || (play && comment / play > 0.006)) tags.push('评论活跃');
    if (item.isNew) tags.push('新增');
    return tags.length ? tags : ['观察'];
  }

  function refreshStoredItems(store) {
    const accountNames = new Map((store.accounts || []).map(function(account) {
      return [account.id, account.name || account.account || ''];
    }));
    store.items = (store.items || []).filter(isUsableVideo).map(function(item) {
      const raw = item.raw || {};
      const normalized = normalizeVideo(item.platform || 'douyin', raw, item.account || '', 0);
      const next = Object.assign({}, item, {
        accountName: item.accountName || accountNames.get(item.accountId) || item.accountName,
        metrics: Object.assign({}, item.metrics || {}, normalized.metrics),
        publishedAt: item.publishedAt || normalized.publishedAt,
        publishedTs: item.publishedTs || normalized.publishedTs,
        updatedAt: item.updatedAt || Date.now()
      });
      next.hotScore = hotScore(next);
      next.tags = hotTags(next);
      return next;
    }).sort(function(a, b) { return (Number(b.hotScore) || 0) - (Number(a.hotScore) || 0); });
    store.snapshots = (store.snapshots || []).map(function(snapshot) {
      const items = (snapshot.items || []).filter(isUsableVideo).map(function(item) {
        return normalizeVideo(snapshot.platform || item.platform || 'douyin', item.raw || item, snapshot.account || item.account || '', 0);
      });
      snapshot.items = items;
      snapshot.stats = summarizeAccount(snapshot, [], items);
      return snapshot;
    });
  }

  function cleanupInvalidAccounts(store) {
    const badIds = new Set();
    store.accounts = (store.accounts || []).filter(function(account) {
      if (account.sourceType === 'video_link') return true;
      if (account.pendingResolve) return true;
      const validation = validateAccountInput(account.platform, account.account || account.url || account.name || '');
      if (validation.ok) return true;
      badIds.add(account.id);
      return false;
    });
    if (!badIds.size) return;
    store.items = (store.items || []).filter(function(item) { return !badIds.has(item.accountId); });
    store.snapshots = (store.snapshots || []).filter(function(snapshot) { return !badIds.has(snapshot.accountId); });
  }

  function firstObjectFromStats(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    if (Array.isArray(parsed)) return parsed[0] || null;
    const candidates = [
      parsed,
      parsed.data,
      parsed.item,
      parsed.aweme,
      parsed.aweme_detail,
      parsed.video,
      parsed.result
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      if (item && typeof item === 'object' && !Array.isArray(item)) return item;
    }
    return null;
  }

  function collectDouyinVideoLink(account) {
    const rawInput = String(account.sourceInput || account.url || account.account || account.name || '').trim();
    const sourceUrl = extractFirstUrl(rawInput) || rawInput;
    return resolveRedirect(sourceUrl)
      .then(function(finalUrl) {
        return resolveRedirectWithCurl(sourceUrl).then(function(curlUrl) {
          return curlUrl || finalUrl || sourceUrl;
        });
      })
      .then(function(resolvedUrl) {
        const awemeId = extractDouyinAwemeId(resolvedUrl) || extractDouyinAwemeId(sourceUrl);
        if (!awemeId) {
          const item = normalizeVideo('douyin', {
            id: sourceUrl,
            url: resolvedUrl || sourceUrl,
            title: account.name || '抖音链接',
            created_at: Date.now()
          }, account.name || sourceUrl, 0);
          return { ok: true, platform: 'douyin', account: sourceUrl, resolvedUrl: resolvedUrl || sourceUrl, items: [item], warning: '链接已保存，但暂未解析出作品 ID' };
        }
        return runOpenCli(['douyin', 'stats', awemeId, '-f', 'json'], 90000).then(function(result) {
          const parsed = result.ok ? parseJsonLoose(result.stdout) : null;
          const statItem = firstObjectFromStats(parsed) || {};
          const item = normalizeVideo('douyin', Object.assign({}, statItem, {
            id: statItem.id || statItem.aweme_id || awemeId,
            aweme_id: statItem.aweme_id || awemeId,
            url: resolvedUrl || ('https://www.douyin.com/video/' + awemeId),
            title: statItem.title || statItem.desc || statItem.description || account.name || '抖音作品'
          }), account.name || sourceUrl, 0);
          return {
            ok: true,
            platform: 'douyin',
            account: sourceUrl,
            resolvedUrl: resolvedUrl || item.url,
            items: [item],
            warning: result.ok ? '' : (result.stderr || result.stdout || result.error || 'opencli stats failed')
          };
        });
      });
  }

  function collectAccount(account) {
    const platform = normalizePlatform(account.platform);
    const limit = Math.max(1, Math.min(5, Number(account.limit) || 5));
    if (platform === 'douyin' && account.sourceType === 'video_link') {
      return collectDouyinVideoLink(account);
    }
    return resolveAccountInput(platform, account.account || account.url || account.name || '').then(function(validation) {
      if (!validation.ok) return { ok: false, error: validation.error, items: [] };
      const accountKey = validation.account;
      const args = platform === 'bilibili'
        ? ['bilibili', 'user-videos', accountKey, '--limit', String(limit), '-f', 'json']
        : ['douyin', 'user-videos', accountKey, '--limit', String(limit), '--with_comments', 'false', '-f', 'json'];
      return runOpenCli(args, platform === 'douyin' ? 240000 : 180000).then(function(result) {
      if (!result.ok) return { ok: false, error: result.error || 'opencli failed', stdout: result.stdout || '', stderr: result.stderr || '', items: [] };
      const parsed = parseJsonLoose(result.stdout);
      const rows = rowsFromParsed(parsed);
      if (!rows.length) {
        return {
          ok: false,
          error: '没有抓到作品。请确认账号ID是公开主页的 sec_uid/mid，并且 OpenCLI 当前账号有访问权限。',
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          items: []
        };
      }
      const items = rows.filter(function(item) {
        return !isHiddenVideo(item || {});
      }).map(function(item, index) {
        return normalizeVideo(platform, item || {}, accountKey, index);
      }).filter(isUsableVideo).slice(0, limit);
        return { ok: true, platform: platform, account: accountKey, resolvedUrl: validation.resolvedUrl || '', items: items };
      });
    });
  }

  function summarizeAccount(account, previousItems, nextItems) {
    const previousIds = new Set((previousItems || []).map(function(item) { return String(item.id || item.url || item.title); }));
    const newItems = (nextItems || []).filter(function(item) {
      return !previousIds.has(String(item.id || item.url || item.title));
    });
    const totalPlay = (nextItems || []).reduce(function(sum, item) { return sum + (Number(item.metrics && item.metrics.play) || 0); }, 0);
    return {
      videoCount: (nextItems || []).length,
      newCount: newItems.length,
      totalPlay: totalPlay,
      topTitle: nextItems && nextItems[0] ? nextItems[0].title : '',
      lastCollectedAt: Date.now(),
      status: 'ok'
    };
  }

  function splitItemsByWindow(items, windowDays) {
    const active = [];
    const archived = [];
    (items || []).forEach(function(item) {
      if (isInWindow(item, windowDays)) active.push(item);
      else archived.push(Object.assign({}, item, { archived: true }));
    });
    return { active: active, archived: archived };
  }

  function publicStore(store, options) {
    const windowDays = Math.max(1, Math.min(90, Number(options && options.windowDays) || 7));
    const latestByAccount = new Map();
    const allItems = (store.items || [])
      .slice()
      .sort(function(a, b) { return (Number(b.hotScore) || 0) - (Number(a.hotScore) || 0); });
    const split = splitItemsByWindow(allItems, windowDays);
    (store.snapshots || []).forEach(function(snapshot) {
      const prev = latestByAccount.get(snapshot.accountId);
      if (!prev || Number(snapshot.capturedAt) > Number(prev.capturedAt)) latestByAccount.set(snapshot.accountId, snapshot);
    });
    return {
      accounts: (store.accounts || []).map(function(account) {
        const snapshot = latestByAccount.get(account.id);
        return Object.assign({}, account, { latest: snapshot ? snapshot.items : [] });
      }),
      items: split.active.slice(0, 500),
      activeItems: split.active.slice(0, 500),
      archivedItems: split.archived.slice(0, 500),
      allItems: allItems.slice(0, 1000),
      windowDays: windowDays,
      archivedCount: split.archived.length,
      snapshots: (store.snapshots || []).slice(-40).reverse()
    };
  }

  function publicCollectJob() {
    return Object.assign({}, collectJob, {
      results: (collectJob.results || []).slice(-50)
    });
  }

  function withCollectJob(data) {
    return Object.assign({}, data || {}, { collectJob: publicCollectJob() });
  }

  function upsertAccount(body) {
    const store = readStore();
    const now = Date.now();
    const platform = normalizePlatform(body.platform);
    return resolveAccountInput(platform, body.account || body.url || body.name || '').then(function(validation) {
      const rawInput = String(body.account || body.url || body.name || '').trim();
      const pendingShortLink = !validation.ok && platform === 'douyin' && /v\.douyin\.com/i.test(extractFirstUrl(rawInput));
      if (!validation.ok && !pendingShortLink) return { error: validation.error };
      const accountKey = validation.ok ? validation.account : extractFirstUrl(rawInput);
      const sourceType = validation.sourceType || (platform === 'douyin' && isDouyinVideoLinkInput(platform, rawInput) ? 'video_link' : 'account');
      const account = {
        id: body.id || makeId(),
        platform: platform,
        name: String(body.name || accountKey).trim(),
        account: accountKey,
        sourceType: sourceType,
        sourceInput: rawInput,
        url: String(validation.resolvedUrl || body.url || '').trim(),
        limit: Math.max(1, Math.min(5, Number(body.limit) || 5)),
        category: String(body.category || body.zone || '').trim() || inferCategory(body.name || body.account || ''),
        intervalHours: Math.max(1, Math.min(168, Number(body.intervalHours) || 24)),
        enabled: body.enabled !== false,
        pendingResolve: sourceType === 'video_link' ? false : pendingShortLink,
        createdAt: now,
        updatedAt: now,
        lastCollectedAt: 0,
        lastStatus: sourceType === 'video_link' ? 'pending_link' : (pendingShortLink ? 'pending_resolve' : 'pending'),
        lastError: sourceType === 'video_link' ? '单链接采集源：扫描时采集这条作品' : (pendingShortLink ? '扫描时会自动解析抖音短链为 sec_uid' : ''),
        stats: {}
      };
      const index = store.accounts.findIndex(function(item) { return item.id === account.id; });
      if (index >= 0) {
        account.createdAt = store.accounts[index].createdAt || now;
        account.lastCollectedAt = store.accounts[index].lastCollectedAt || 0;
        account.lastStatus = sourceType === 'video_link' ? 'pending_link' : (pendingShortLink ? 'pending_resolve' : (store.accounts[index].lastStatus || 'pending'));
        account.lastError = sourceType === 'video_link' ? '单链接采集源：扫描时采集这条作品' : (pendingShortLink ? '扫描时会自动解析抖音短链为 sec_uid' : (store.accounts[index].lastError || ''));
        account.stats = store.accounts[index].stats || {};
        store.accounts[index] = Object.assign({}, store.accounts[index], account);
      } else {
        store.accounts.push(account);
      }
      writeStore(store);
      return publicStore(store);
    });
  }

  function collectAndSave(accountId) {
    const store = readStore();
    const index = store.accounts.findIndex(function(item) { return item.id === accountId; });
    if (index < 0) return Promise.resolve({ error: 'account not found' });
    const account = store.accounts[index];
    const previous = (store.snapshots || []).filter(function(snapshot) { return snapshot.accountId === account.id; }).sort(function(a, b) {
      return Number(b.capturedAt) - Number(a.capturedAt);
    })[0];
    return collectAccount(account).then(function(result) {
      const now = Date.now();
      if (!result.ok) {
        store.accounts[index] = Object.assign({}, account, {
          lastStatus: 'error',
          lastError: result.error || result.stderr || 'collect failed',
          updatedAt: now
        });
        writeStore(store);
        return Object.assign(publicStore(store), { collected: false, error: store.accounts[index].lastError });
      }
      if (result.account && result.account !== account.account) {
        account.account = result.account;
      }
      if (result.resolvedUrl) {
        account.url = result.resolvedUrl;
      }
      account.pendingResolve = false;
      const stats = summarizeAccount(account, previous && previous.items || [], result.items);
      const existingMap = new Map((store.items || []).map(function(item) {
        return [stableItemKey(item), item];
      }));
      let newCount = 0;
      result.items.forEach(function(rawItem) {
        const key = stableItemKey(rawItem);
        const prev = existingMap.get(key);
        const item = Object.assign({}, prev || {}, rawItem, {
          key: key,
          accountId: account.id,
          accountName: account.name || account.account,
          category: account.category || inferCategory((account.name || '') + ' ' + rawItem.title),
          firstSeenAt: prev && prev.firstSeenAt || now,
          updatedAt: now,
          isNew: !prev
        });
        item.hotScore = hotScore(item);
        item.tags = hotTags(item);
        if (!prev) newCount += 1;
        existingMap.set(key, item);
      });
      const latestKeys = new Set((result.items || []).map(stableItemKey));
      store.items = Array.from(existingMap.values())
        .filter(function(item) {
          if (!isUsableVideo(item)) return false;
          if (item.accountId === account.id && !latestKeys.has(stableItemKey(item))) return false;
          return true;
        })
        .sort(function(a, b) { return (Number(b.hotScore) || 0) - (Number(a.hotScore) || 0); })
        .slice(0, 3000)
        .map(function(item) {
          if (item.updatedAt !== now) return Object.assign({}, item, { isNew: false });
          return item;
        });
      stats.newCount = newCount;
      const snapshot = {
        id: makeId(),
        accountId: account.id,
        platform: account.platform,
        account: account.account,
        capturedAt: now,
        items: result.items,
        stats: stats
      };
      store.snapshots.push(snapshot);
      store.accounts[index] = Object.assign({}, account, {
        lastCollectedAt: now,
        lastStatus: 'ok',
        lastError: '',
        stats: stats,
        updatedAt: now
      });
      writeStore(store);
      return Object.assign(publicStore(store), { collected: true, snapshot: snapshot });
    });
  }

  function collectAllEnabledAccounts(options) {
    options = options || {};
    const store = readStore();
    const accounts = (store.accounts || []).filter(function(item) { return item.enabled !== false; });
    const ids = accounts.map(function(item) { return item.id; });
    let chain = Promise.resolve();
    ids.forEach(function(id) {
      const account = accounts.find(function(item) { return item.id === id; }) || {};
      chain = chain.then(function() {
        if (typeof options.onAccountStart === 'function') options.onAccountStart(account);
        return collectAndSave(id).then(function(result) {
          if (typeof options.onAccountDone === 'function') options.onAccountDone(account, result || {});
          return result;
        }).catch(function(e) {
          const result = { error: e && e.message || String(e) };
          if (typeof options.onAccountDone === 'function') options.onAccountDone(account, result);
          return result;
        });
      });
    });
    return chain.then(function() {
      return publicStore(readStore(), { windowDays: options.windowDays });
    });
  }

  function startCollectAllJob(options) {
    options = options || {};
    const store = readStore();
    const accounts = (store.accounts || []).filter(function(item) { return item.enabled !== false; });
    if (collectJob.running) {
      return withCollectJob(publicStore(store, { windowDays: options.windowDays }));
    }
    collectJob = {
      running: accounts.length > 0,
      source: options.source || 'manual',
      startedAt: Date.now(),
      finishedAt: accounts.length > 0 ? 0 : Date.now(),
      total: accounts.length,
      done: 0,
      currentAccountId: '',
      currentAccountName: '',
      error: '',
      results: []
    };
    if (!accounts.length) {
      return withCollectJob(publicStore(store, { windowDays: options.windowDays }));
    }
    collectAllEnabledAccounts({
      windowDays: options.windowDays,
      onAccountStart: function(account) {
        collectJob.currentAccountId = account.id || '';
        collectJob.currentAccountName = account.name || account.account || '';
        console.log('[account-monitor] collect start:', collectJob.currentAccountName || collectJob.currentAccountId);
      },
      onAccountDone: function(account, result) {
        collectJob.done = Math.min(collectJob.total, collectJob.done + 1);
        collectJob.results.push({
          accountId: account.id || '',
          name: account.name || account.account || '',
          platform: account.platform || '',
          ok: !(result && result.error),
          error: result && result.error || ''
        });
        collectJob.results = collectJob.results.slice(-50);
        console.log('[account-monitor] collect done:', account.name || account.account || account.id, result && result.error ? result.error : 'ok');
      }
    }).then(function() {
      collectJob.running = false;
      collectJob.finishedAt = Date.now();
      collectJob.currentAccountId = '';
      collectJob.currentAccountName = '';
    }).catch(function(e) {
      collectJob.running = false;
      collectJob.finishedAt = Date.now();
      collectJob.currentAccountId = '';
      collectJob.currentAccountName = '';
      collectJob.error = e && e.message || String(e);
      console.warn('[account-monitor] collect all failed:', collectJob.error);
    });
    return withCollectJob(publicStore(store, { windowDays: options.windowDays }));
  }

  function nextScheduleDelay(now) {
    const base = now || new Date();
    for (const hour of scheduleHours) {
      const next = new Date(base);
      next.setHours(hour, 0, 0, 0);
      if (next.getTime() > base.getTime()) return next.getTime() - base.getTime();
    }
    const next = new Date(base);
    next.setDate(next.getDate() + 1);
    next.setHours(scheduleHours[0], 0, 0, 0);
    return next.getTime() - base.getTime();
  }

  function scheduleNextCollect() {
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(function() {
      if (scheduledCollecting || collectJob.running) {
        scheduleNextCollect();
        return;
      }
      scheduledCollecting = true;
      collectAllEnabledAccounts()
        .catch(function(e) { console.warn('[account-monitor] scheduled collect failed:', e && e.message || e); })
        .finally(function() {
          scheduledCollecting = false;
          scheduleNextCollect();
        });
    }, nextScheduleDelay());
    if (scheduleTimer.unref) scheduleTimer.unref();
  }

  scheduleNextCollect();

  return {
    '/api/account-monitor/list': function(body, cb) {
      const store = readStore();
      cleanupInvalidAccounts(store);
      refreshStoredItems(store);
      writeStore(store);
      const data = publicStore(store, { windowDays: body.windowDays || body.days });
      data.items = data.items.slice(0, Math.max(1, Math.min(500, Number(body.limit) || 200)));
      cb(withCollectJob(data));
    },

    '/api/account-monitor/upsert': function(body, cb) {
      upsertAccount(body || {}).then(cb).catch(function(e) { cb({ error: e.message || String(e) }); });
    },

    '/api/account-monitor/delete': function(body, cb) {
      const store = readStore();
      const id = body.id || '';
      store.accounts = store.accounts.filter(function(item) { return item.id !== id; });
      store.snapshots = store.snapshots.filter(function(item) { return item.accountId !== id; });
      store.items = (store.items || []).filter(function(item) { return item.accountId !== id; });
      writeStore(store);
      cb(publicStore(store));
    },

    '/api/account-monitor/clear': function(body, cb) {
      const store = readStore();
      const scope = body.scope || 'active';
      if (scope === 'all') {
        store.items = [];
        store.snapshots = [];
        store.accounts = (store.accounts || []).map(function(account) {
          return Object.assign({}, account, { lastCollectedAt: 0, lastStatus: 'pending', lastError: '', stats: {} });
        });
      } else if (scope === 'archived') {
        store.items = (store.items || []).filter(function(item) { return isInWindow(item, body.windowDays || 7); });
      } else {
        store.items = (store.items || []).filter(function(item) { return !isInWindow(item, body.windowDays || 7); });
      }
      writeStore(store);
      cb(publicStore(store, { windowDays: body.windowDays || 7 }));
    },

    '/api/account-monitor/collect': function(body, cb) {
      collectAndSave(body.id || '').then(cb).catch(function(e) { cb({ error: e.message || String(e) }); });
    },

    '/api/account-monitor/collect-all': function(body, cb) {
      cb(startCollectAllJob({ source: 'manual', windowDays: body.windowDays || body.days }));
    },

    '/api/account-monitor/collect-status': function(body, cb) {
      cb(withCollectJob(publicStore(readStore(), { windowDays: body.windowDays || body.days })));
    }
  };
};
